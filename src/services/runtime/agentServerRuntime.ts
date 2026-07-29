import {
  SchedulingAgentRuntimeFacade,
  type RuntimeDecision,
  type RuntimeExecutePendingCommandInput,
  type RuntimeExecutedResult,
  type RuntimeFeedback,
  type RuntimePendingCommand,
  type RuntimePendingInsertRecommendation,
  type RuntimePendingTargetSelection,
  type RuntimeProgressEvent,
  type RuntimeReactOrchestrationOutcome,
  type RuntimeScheduleItem,
  type RuntimeOrchestrationRequest,
  type RuntimeResolveInsertRecommendationInput,
  type RuntimeResolveTargetSelectionInput,
  type RuntimeSubmitInput,
} from './schedulingAgentRuntimeFacade'
import {
  rehydratePendingInsertRecommendationFromAtomicContext,
  rehydratePendingTargetSelectionFromAtomicContext,
  type RuntimePendingAtomicContext,
} from './pendingAtomicContext'
import type { ForegroundAgentContextPackage } from './foregroundAgentContextPackage'
import type { ReactTaskRun } from './reactTaskTypes'
import {
  AgentServerSessionStore,
  getAgentServerSessionStore,
  type AgentExecutionCheckpoint,
  type AgentServerSessionEvent,
  type AgentServerSessionState,
} from './agentServerSessionStore'
import { FormalPlaylistWriteAdapter } from './formalPlaylistWriteAdapter'
import { AgentServerExecutionService } from './agentServerExecutionService'
import { AgentMaterialEvidenceService } from './agentMaterialEvidenceService'
import { getAtomicCapabilities } from '../atomicCapabilities'
import {
  buildFormalPlaylistSnapshot,
  buildScheduleItemSnapshotsFromFormalPlaylist,
} from './formalPlaylistState'
import {
  buildScheduleWorkspaceSummary,
  resolveForegroundWorkspaceKey,
} from './foregroundWorkspaceState'
import {
  buildAgentSessionReplayPackage,
  type AgentSessionReplayPackage,
} from './agentSessionReplayPackage'
import { AgentDeadline, LONG_RUNNING_DEADLINE_BUDGET } from '../agent/agentDeadline'
import {
  prepareFormalOrchestrationRecovery,
  type FormalOrchestrationRecoveryAction,
  type FormalOrchestrationRecoveryResult,
} from './formalOrchestrationRecovery'
import type { AgentPlannerAction } from '@/services/llm/agentPlanner'
import { buildFormalWriteContext } from '@/services/agent/mutationPolicy'
import { FormalOrchestrationGrantAuthority } from './formalOrchestrationGrant'
import { buildTrustedForegroundAgentContext } from './trustedForegroundAgentContext'

export interface AgentServerRuntimeOptions {
  runtime?: Pick<SchedulingAgentRuntimeFacade,
    | 'submitInstruction'
    | 'executePendingCommand'
    | 'resolvePendingTargetSelection'
    | 'resolvePendingInsertRecommendation'
    | 'startReactOrchestration'
  >
  sessions?: AgentServerSessionStore
  formalPlaylistWrites?: FormalPlaylistWriteAdapter
  executionService?: AgentServerExecutionService
  materialEvidenceService?: AgentMaterialEvidenceService
}

export interface AgentServerRuntimeEnvelope<T> {
  sessionId: string
  decision?: T
  result?: T
  contextPackage?: ForegroundAgentContextPackage
  session: AgentServerSessionPublicState
  /**
   * 本轮 submitInstruction 执行过程中收集的进度事件。
   * HTTP 模式下前端无法接收实时 onProgress 回调，通过此字段把进度事件打包返回，
   * 前端收到 envelope 后按序回放给 input.onProgress，复用 Local 模式的多气泡渲染逻辑。
   */
  progressEvents?: RuntimeProgressEvent[]
}

export interface AgentServerSessionPublicState {
  id: string
  createdAt: string
  updatedAt: string
  lastDecisionKind?: RuntimeDecision['kind']
  hasPendingCommand: boolean
  hasPendingAtomicContext: boolean
  activeReactTaskRun?: ReactTaskRun | null
  formalPlaylistVersion?: string | number
  formalPlaylistItemCount?: number
  formalPlaylistWorkspaceKey?: string | null
  activeExecutionCheckpoint?: AgentExecutionCheckpoint | null
  formalOrchestrationCheckpointCount: number
  formalOrchestrationWorkspaceKey?: string | null
  materialEvidenceCount: number
  eventCount: number
}

export interface StopActiveInstructionResult {
  stopped: boolean
  reason: 'stopped' | 'not_found' | 'workspace_mismatch' | 'not_stoppable'
  sessionId: string
  workspaceKey?: string
}

export interface AgentServerReactRecoveryInput {
  action: FormalOrchestrationRecoveryAction
  workspaceKey: string
  playlistVersion?: string | number | null
  runtimeInput?: RuntimeSubmitInput
}

export type AgentServerReactRecoveryResult = FormalOrchestrationRecoveryResult<AgentPlannerAction> & {
  executionStatus?: RuntimeReactOrchestrationOutcome['status']
  scheduleItems?: RuntimeScheduleItem[]
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null
)

const createServerPendingId = (kind: string): string => `server_pending_${kind}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

const isRuntimeReactTaskRun = (value: unknown): value is ReactTaskRun => {
  if (!isRecord(value)) return false
  return typeof value.id === 'string'
    && typeof value.objective === 'string'
    && typeof value.status === 'string'
    && typeof value.loopCount === 'number'
    && Array.isArray(value.steps)
    && Array.isArray(value.observations)
}

const getRuntimeDecisionFeedback = (decision: RuntimeDecision): RuntimeFeedback | null => (
  'feedback' in decision ? decision.feedback : null
)

const extractReactTaskRun = (decision: RuntimeDecision): ReactTaskRun | null => {
  const feedback = getRuntimeDecisionFeedback(decision)
  if (!feedback) return null
  const details = feedback.details
  const taskRun = isRecord(details) ? details.reactTaskRun : null
  return isRuntimeReactTaskRun(taskRun) ? taskRun : null
}

const serializeSession = (session: AgentServerSessionState): AgentServerSessionPublicState => ({
  id: session.id,
  createdAt: session.createdAt,
  updatedAt: session.updatedAt,
  lastDecisionKind: session.lastDecisionKind,
  hasPendingCommand: Boolean(session.pendingCommand),
  hasPendingAtomicContext: Boolean(session.pendingAtomicContext),
  activeReactTaskRun: session.activeReactTaskRun ?? null,
  formalPlaylistVersion: session.formalPlaylistVersion,
  formalPlaylistItemCount: session.formalPlaylistSnapshot?.itemCount,
  formalPlaylistWorkspaceKey: session.formalPlaylistWorkspaceKey ?? null,
  activeExecutionCheckpoint: session.activeExecutionCheckpoint ?? null,
  formalOrchestrationCheckpointCount: session.formalOrchestrationCheckpoints?.length ?? 0,
  formalOrchestrationWorkspaceKey: session.formalOrchestrationWorkspaceKey ?? null,
  materialEvidenceCount: session.materialEvidence?.length ?? 0,
  eventCount: session.eventLog.length,
})

export class AgentServerRuntime {
  private readonly runtime: NonNullable<AgentServerRuntimeOptions['runtime']>
  private readonly sessions: AgentServerSessionStore
  private readonly executionService: AgentServerExecutionService
  private readonly materialEvidenceService: AgentMaterialEvidenceService
  private readonly formalRebuildGrants = new FormalOrchestrationGrantAuthority()
  private readonly activeInstructions = new Map<string, {
    workspaceKey: string
    deadline: AgentDeadline
  }>()

  private static readonly WAITING_PROGRESS_DELAY_MS = 5_000

  constructor(options: AgentServerRuntimeOptions = {}) {
    this.runtime = options.runtime ?? new SchedulingAgentRuntimeFacade()
    this.sessions = options.sessions ?? getAgentServerSessionStore()
    const formalPlaylistWrites = options.formalPlaylistWrites ?? new FormalPlaylistWriteAdapter({
      executePendingCommand: (input) => this.runtime.executePendingCommand(input),
      prepareSnapshotForExecution: (snapshot) => {
        getAtomicCapabilities().loadItems(buildScheduleItemSnapshotsFromFormalPlaylist(snapshot))
      },
    })
    this.executionService = options.executionService ?? new AgentServerExecutionService(formalPlaylistWrites)
    this.materialEvidenceService = options.materialEvidenceService ?? new AgentMaterialEvidenceService()
  }

  createSession(): AgentServerSessionPublicState {
    return serializeSession(this.sessions.createSession())
  }

  getSession(sessionId: string): AgentServerSessionPublicState | null {
    const session = this.sessions.getSession(sessionId)
    return session ? serializeSession(session) : null
  }

  getSessionEvents(sessionId: string) {
    return this.sessions.getSession(sessionId)?.eventLog ?? []
  }

  getSessionReplayPackage(sessionId: string): AgentSessionReplayPackage | null {
    const session = this.sessions.getSession(sessionId)
    return session ? buildAgentSessionReplayPackage(session) : null
  }

  subscribeSessionEvents(
    sessionId: string,
    listener: (event: AgentServerSessionEvent) => void,
  ): () => void {
    return this.sessions.subscribe(sessionId, listener)
  }

  stopActiveInstruction(sessionId: string, workspaceKey: string): StopActiveInstructionResult {
    const active = this.activeInstructions.get(sessionId)
    if (!active) {
      return { stopped: false, reason: 'not_found', sessionId, workspaceKey }
    }
    if (active.workspaceKey !== workspaceKey) {
      return { stopped: false, reason: 'workspace_mismatch', sessionId, workspaceKey }
    }
    if (!active.deadline.isStoppable()) {
      return { stopped: false, reason: 'not_stoppable', sessionId, workspaceKey }
    }

    active.deadline.abort()
    this.sessions.appendEvent(sessionId, {
      type: 'progress',
      summary: '用户已停止当前模型请求，已完成的播单状态保持不变。',
      data: {
        progressStage: 'instruction_stopped',
        workspaceKey,
        noMutation: true,
      },
    })
    return { stopped: true, reason: 'stopped', sessionId, workspaceKey }
  }

  async submitInstruction(
    input: RuntimeSubmitInput,
    sessionId?: string | null,
  ): Promise<AgentServerRuntimeEnvelope<RuntimeDecision>> {
    const session = this.sessions.getOrCreateSession(sessionId)
    const foregroundSnapshot = buildFormalPlaylistSnapshot(input.currentSchedule, 'foreground')
    const workspaceKey = input.scheduleState
      ? resolveForegroundWorkspaceKey(buildScheduleWorkspaceSummary(input.scheduleState))
      : session.formalPlaylistWorkspaceKey ?? 'none'
    if (input.pendingAtomicContext?.workspaceKey && input.pendingAtomicContext.workspaceKey !== workspaceKey) {
      const decision = this.buildMissingServerPendingDecision('待处理操作不属于当前播单工作区，已拒绝继续。')
      return {
        sessionId: session.id,
        decision,
        contextPackage: await buildTrustedForegroundAgentContext({
          ...input,
          pendingAtomicContext: null,
          activeReactTaskRun: null,
        }),
        session: serializeSession(session),
        progressEvents: [],
      }
    }
    const deadline = new AgentDeadline()
    this.activeInstructions.set(session.id, { workspaceKey, deadline })
    const knownSnapshot = session.formalPlaylistWorkspaceKey === workspaceKey && session.formalPlaylistSnapshot
      ? session.formalPlaylistSnapshot
      : foregroundSnapshot
    const activeReactTaskRun = session.activeReactTaskRun ?? input.activeReactTaskRun ?? null
    const sameWorkspaceForPending = !session.formalPlaylistWorkspaceKey
      || session.formalPlaylistWorkspaceKey === workspaceKey
    const pendingAtomicContext = input.pendingAtomicContext
      ?? (sameWorkspaceForPending ? session.pendingAtomicContext ?? null : null)
    let contextPackage: ForegroundAgentContextPackage
    try {
      contextPackage = await buildTrustedForegroundAgentContext({
        ...input,
        pendingAtomicContext,
        activeReactTaskRun,
      })
    } catch (error) {
      if (this.activeInstructions.get(session.id)?.deadline === deadline) {
        this.activeInstructions.delete(session.id)
      }
      throw error
    }
    this.sessions.updateSession(session.id, {
      lastContextPackage: contextPackage,
      pendingCommand: null,
      pendingAtomicContext,
      activeReactTaskRun,
      formalPlaylistSnapshot: knownSnapshot,
      formalPlaylistVersion: knownSnapshot.version,
      formalPlaylistWorkspaceKey: workspaceKey,
    })
    this.sessions.appendEvent(session.id, {
      type: 'context',
      summary: '服务端已重新整理本轮编排上下文。',
      data: {
        scenario: contextPackage.scenario,
        playlistType: contextPackage.workspace.playlistType,
        hasLayoutDraft: contextPackage.layoutDraft.available,
        activeReactTask: contextPackage.reactTask.active,
        formalPlaylistVersion: knownSnapshot.version,
        formalPlaylistItemCount: knownSnapshot.itemCount,
        formalPlaylistWorkspaceKey: workspaceKey,
      },
    })

    const collectedProgressEvents: RuntimeProgressEvent[] = []
    const appendProgress = (event: RuntimeProgressEvent) => {
        // 路径 B 降级：收集到数组随 envelope 返回，供 SSE 不可用时批量回放
        collectedProgressEvents.push(event)
        // 路径 A 流式：把 progress 事件记入 session eventLog，触发 SSE 订阅者实时推送
        this.sessions.appendEvent(session.id, {
          type: 'progress',
          summary: event.content,
          data: {
            progressId: event.id,
            content: event.content,
            thinking: event.thinking,
            processType: event.processType,
            processTypeLabel: event.processTypeLabel,
            details: event.details,
          },
        })
    }
    const waitingTimer = setTimeout(() => {
      appendProgress({
        id: `agent-waiting:${session.id}:${Date.now()}`,
        content: '模型仍在分析当前播单上下文，我会在本轮时限内继续等待。',
        processType: 'planning',
        processTypeLabel: '理解需求',
        details: {
          progressStage: 'llm_waiting',
          elapsedMs: AgentServerRuntime.WAITING_PROGRESS_DELAY_MS,
          noMutation: true,
        },
      })
    }, AgentServerRuntime.WAITING_PROGRESS_DELAY_MS)
    let decision: RuntimeDecision
    try {
      decision = await this.runtime.submitInstruction({
        ...input,
        pendingAtomicContext,
        activeReactTaskRun,
        foregroundContextPackage: contextPackage,
        agentCoreEnabled: input.agentCoreEnabled ?? true,
        onProgress: appendProgress,
        deadline,
      })
    } finally {
      clearTimeout(waitingTimer)
      if (this.activeInstructions.get(session.id)?.deadline === deadline) {
        this.activeInstructions.delete(session.id)
      }
    }
    const serverOwnedDecision = this.attachServerPendingOwnership(decision, workspaceKey)
    const trustedDecision = this.issueServerFormalRebuildGrant(
      serverOwnedDecision,
      input,
      session,
      session.pendingAtomicContext ?? null,
      knownSnapshot.version,
    )
    this.materialEvidenceService.recordDecisionEvidence(this.sessions, session.id, trustedDecision)
    const nextSession = this.syncDecision(session.id, trustedDecision, contextPackage)
    return {
      sessionId: session.id,
      decision: trustedDecision,
      contextPackage,
      session: serializeSession(nextSession),
      progressEvents: collectedProgressEvents,
    }
  }

  private issueServerFormalRebuildGrant(
    decision: RuntimeDecision,
    input: RuntimeSubmitInput,
    session: AgentServerSessionState,
    pendingAtomicContext: RuntimePendingAtomicContext | null,
    playlistVersion: string,
  ): RuntimeDecision {
    if (decision.kind !== 'orchestration' && decision.kind !== 'layout_commit') return decision
    const request = decision.orchestrationRequest
    const grantRequest = request.authorizationRequest
    if (!grantRequest) return decision
    if (
      pendingAtomicContext?.phase !== 'formal_rebuild_confirmation'
      || !pendingAtomicContext.pendingId
      || pendingAtomicContext.pendingId !== grantRequest.sourcePendingId
    ) {
      throw new Error('Formal rebuild grant source pending mismatch.')
    }
    const workspaceKey = input.scheduleState
      ? resolveForegroundWorkspaceKey(buildScheduleWorkspaceSummary(input.scheduleState))
      : session.formalPlaylistWorkspaceKey ?? 'none'
    if (grantRequest.workspaceKey !== workspaceKey) {
      throw new Error('Formal rebuild grant workspace mismatch.')
    }
    const grant = this.formalRebuildGrants.issue({
      sessionId: session.id,
      sourcePendingId: grantRequest.sourcePendingId,
      workspaceKey,
      initialPlaylistVersion: playlistVersion,
      layoutDraft: request.layoutDraft ?? input.currentLayoutDraft,
      existingItemCount: grantRequest.existingItemCount,
      mode: grantRequest.mode,
      targetTimeRange: request.targetTimeRange,
      scope: {
        targetTimeRange: request.targetTimeRange,
        taskKind: request.lifecycle?.taskKind,
        objective: request.reactTask?.objective,
        searchKeywords: request.searchKeywords,
      },
    })
    this.sessions.updateSession(session.id, { formalOrchestrationGrant: grant })
    const orchestrationRequest: RuntimeOrchestrationRequest = {
      ...request,
      authorizationRequest: undefined,
      authorizationGrantId: grant.grantId,
      resolvedAuthorization: undefined,
    }
    return { ...decision, orchestrationRequest }
  }

  async executeReactOrchestration(
    request: RuntimeOrchestrationRequest,
    input: RuntimeSubmitInput,
    sessionId?: string | null,
  ): Promise<AgentServerRuntimeEnvelope<RuntimeReactOrchestrationOutcome>> {
    const session = this.sessions.getOrCreateSession(sessionId)
    if (request.authorizationRequest || request.resolvedAuthorization) {
      throw new Error('Formal rebuild authorization must be resolved by the Agent server boundary.')
    }
    const workspaceKey = resolveForegroundWorkspaceKey(buildScheduleWorkspaceSummary(input.scheduleState))
    if (workspaceKey === 'none') {
      throw new Error('当前没有可执行正式编排的播单工作区。')
    }
    if (session.formalPlaylistWorkspaceKey && session.formalPlaylistWorkspaceKey !== workspaceKey) {
      throw new Error('正式编排工作区与服务端 session 播单快照不一致，已拒绝执行。')
    }
    const foregroundSnapshot = buildFormalPlaylistSnapshot(input.currentSchedule, 'foreground')
    const workingSnapshot = session.formalPlaylistWorkspaceKey === workspaceKey && session.formalPlaylistSnapshot
      ? session.formalPlaylistSnapshot
      : foregroundSnapshot
    if (request.mode === 'full_generate' && workingSnapshot.itemCount > 0 && !request.authorizationGrantId) {
      throw new Error('Existing formal playlist rebuild requires a server-issued grant.')
    }
    if (session.formalOrchestrationGrant) this.formalRebuildGrants.restore(session.formalOrchestrationGrant)
    const resolvedAuthorization = request.authorizationGrantId
      ? this.formalRebuildGrants.resolve(request.authorizationGrantId, {
          sessionId: session.id,
          workspaceKey,
          playlistVersion: workingSnapshot.version,
          layoutDraft: request.layoutDraft ?? input.currentLayoutDraft,
          scope: {
            targetTimeRange: request.targetTimeRange,
            taskKind: request.lifecycle?.taskKind,
            objective: request.reactTask?.objective,
            searchKeywords: request.searchKeywords,
          },
        })
      : undefined
    const trustedRequest: RuntimeOrchestrationRequest = { ...request, resolvedAuthorization }
    getAtomicCapabilities().loadItems(buildScheduleItemSnapshotsFromFormalPlaylist(workingSnapshot))

    const deadline = new AgentDeadline({ overallDeadlineMs: LONG_RUNNING_DEADLINE_BUDGET.overallDeadlineMs })
    const collectedProgressEvents: RuntimeProgressEvent[] = []
    const appendProgress = (event: RuntimeProgressEvent) => {
      collectedProgressEvents.push(event)
      this.sessions.appendEvent(session.id, {
        type: 'progress',
        summary: event.content,
        data: {
          progressId: event.id,
          content: event.content,
          thinking: event.thinking,
          processType: event.processType,
          processTypeLabel: event.processTypeLabel,
          details: event.details,
        },
      })
    }
    this.activeInstructions.set(session.id, { workspaceKey, deadline })
    const isRecovery = Boolean(request.reactRecovery)
    const foregroundVersion = foregroundSnapshot.version
    this.sessions.updateSession(session.id, {
      formalOrchestrationWorkspaceKey: workspaceKey,
      formalOrchestrationCheckpoints: isRecovery ? session.formalOrchestrationCheckpoints ?? [] : [],
      formalOrchestrationPlaylistVersion: isRecovery
        ? session.formalOrchestrationPlaylistVersion ?? foregroundVersion
        : session.formalPlaylistVersion ?? foregroundVersion,
      formalOrchestrationRequest: isRecovery
        ? session.formalOrchestrationRequest ?? { ...request, reactRecovery: undefined }
        : { ...request, reactRecovery: undefined, resolvedAuthorization: undefined },
    })
    this.sessions.appendEvent(session.id, {
      type: 'react_task',
      summary: '正式 ReAct 编排已进入服务端执行。',
      data: { workspaceKey, canInterrupt: true, objective: request.reactTask?.objective },
    })
    appendProgress({
      id: `react:${session.id}:planning`,
      content: '正式编排已进入 ReAct 任务规划。',
      processType: 'planning',
      processTypeLabel: '任务规划',
      details: { workspaceKey, progressStage: 'react_planning', noMutation: true },
    })

    let executionOutcome: RuntimeReactOrchestrationOutcome = { status: 'completed' }
    try {
      const outcome = await this.runtime.startReactOrchestration(trustedRequest, input, deadline, (checkpoint) => {
        const current = this.sessions.getSession(session.id)
        if (!current || current.formalOrchestrationWorkspaceKey !== workspaceKey) {
          deadline.abort()
          throw new Error('checkpoint 工作区发生变化，已停止正式编排。')
        }
        this.sessions.updateSession(session.id, {
          formalOrchestrationCheckpoints: [...(current.formalOrchestrationCheckpoints ?? []), checkpoint].slice(-50),
        })
        this.sessions.appendEvent(session.id, {
          type: 'react_checkpoint',
          summary: `ReAct 第 ${checkpoint.turn} 轮 checkpoint 已保存：${checkpoint.decision.kind}`,
          data: { workspaceKey, checkpoint },
        })
        if (checkpoint.actions.some((action) => action.type === 'research_check')) {
          appendProgress({
            id: `${checkpoint.id}:research`,
            content: `ReAct 第 ${checkpoint.turn} 轮正在根据计划查节目库。`,
            processType: 'planning',
            processTypeLabel: '查节目库',
            details: { workspaceKey, checkpointId: checkpoint.id, turn: checkpoint.turn, noMutation: true },
          })
        }
        appendProgress({
          id: `${checkpoint.id}:decision`,
          content: `ReAct 第 ${checkpoint.turn} 轮候选决策：${checkpoint.decision.reason}`,
          processType: 'selection',
          processTypeLabel: '候选决策',
          details: {
            workspaceKey,
            checkpointId: checkpoint.id,
            turn: checkpoint.turn,
            decisionKind: checkpoint.decision.kind,
            noMutation: checkpoint.observations.every((observation) => observation.data?.noMutation !== false),
          },
        })
      })
      executionOutcome = outcome
      if (outcome.status === 'waiting_user') {
        appendProgress({
          id: `react:${session.id}:waiting-user:${Date.now()}`,
          content: '当前动作已完成业务校验，正在等待你的明确确认；正式播单尚未写入。',
          processType: 'planning',
          processTypeLabel: '等待用户确认',
          details: {
            workspaceKey,
            progressStage: 'react_waiting_user',
            noMutation: true,
            checkpointCount: outcome.checkpointCount ?? 0,
            pendingTask: outcome.pendingTask,
          },
        })
      } else if (outcome.status === 'failed') {
        appendProgress({
          id: `react:${session.id}:failed:${Date.now()}`,
          content: outcome.failure?.message ?? 'ReAct 长流程失败，已保留最后 checkpoint。',
          processType: 'error',
          processTypeLabel: '可恢复失败',
          details: {
            workspaceKey,
            progressStage: 'react_failed',
            noMutation: (outcome.failure?.checkpointCount ?? 0) === 0,
            checkpointCount: outcome.failure?.checkpointCount ?? 0,
            recoverableFailure: outcome.failure?.recoverableFailure,
          },
        })
      }
    } finally {
      if (this.activeInstructions.get(session.id)?.deadline === deadline) {
        this.activeInstructions.delete(session.id)
      }
    }

    if (executionOutcome.scheduleItems) {
      const snapshot = buildFormalPlaylistSnapshot(executionOutcome.scheduleItems, 'write_result')
      const advancedGrant = request.authorizationGrantId
        ? this.formalRebuildGrants.advancePlaylistVersion(request.authorizationGrantId, snapshot.version)
        : null
      this.sessions.updateSession(session.id, {
        formalPlaylistSnapshot: snapshot,
        formalPlaylistVersion: snapshot.version,
        formalPlaylistWorkspaceKey: workspaceKey,
        formalOrchestrationPlaylistVersion: snapshot.version,
        formalOrchestrationGrant: advancedGrant ?? session.formalOrchestrationGrant,
      })
    }

    if (request.authorizationGrantId && executionOutcome.status === 'completed') {
      this.formalRebuildGrants.setStatus(request.authorizationGrantId, 'consumed')
      const consumedGrant = this.sessions.getSession(session.id)?.formalOrchestrationGrant
      if (consumedGrant?.grantId === request.authorizationGrantId) {
        consumedGrant.status = 'consumed'
        this.sessions.updateSession(session.id, { formalOrchestrationGrant: consumedGrant })
      }
    }

    return {
      sessionId: session.id,
      result: executionOutcome,
      session: serializeSession(this.sessions.getOrCreateSession(session.id)),
      progressEvents: collectedProgressEvents,
    }
  }

  async recoverReactOrchestration(
    input: AgentServerReactRecoveryInput,
    sessionId: string,
  ): Promise<AgentServerRuntimeEnvelope<AgentServerReactRecoveryResult>> {
    const session = this.sessions.getSession(sessionId)
    if (!session) {
      throw new Error('没有找到可恢复的 Agent session。')
    }
    const recovery = prepareFormalOrchestrationRecovery({
      sessionId,
      action: input.action,
      requestedWorkspaceKey: input.workspaceKey,
      checkpointWorkspaceKey: session.formalOrchestrationWorkspaceKey,
      expectedPlaylistVersion: session.formalOrchestrationPlaylistVersion,
      actualPlaylistVersion: input.playlistVersion,
      checkpoints: session.formalOrchestrationCheckpoints ?? [],
    })
    this.sessions.appendEvent(sessionId, {
      type: 'react_recovery',
      summary: recovery.envelope.humanSummary,
      data: {
        action: input.action,
        status: recovery.status,
        workspaceKey: input.workspaceKey,
        failureKind: recovery.envelope.kind,
        noMutation: true,
      },
    })

    if (recovery.status !== 'ready') {
      return {
        sessionId,
        result: recovery,
        session: serializeSession(this.sessions.getOrCreateSession(sessionId)),
      }
    }
    if (!input.runtimeInput || !session.formalOrchestrationRequest || !recovery.resumePlan) {
      const inspected = prepareFormalOrchestrationRecovery({
        sessionId,
        action: 'inspect',
        requestedWorkspaceKey: input.workspaceKey,
        checkpointWorkspaceKey: session.formalOrchestrationWorkspaceKey,
        expectedPlaylistVersion: session.formalOrchestrationPlaylistVersion,
        actualPlaylistVersion: input.playlistVersion,
        checkpoints: session.formalOrchestrationCheckpoints ?? [],
      })
      return {
        sessionId,
        result: inspected,
        session: serializeSession(this.sessions.getOrCreateSession(sessionId)),
      }
    }

    const execution = await this.executeReactOrchestration({
      ...session.formalOrchestrationRequest,
      reactRecovery: recovery.resumePlan,
    }, input.runtimeInput, sessionId)
    return {
      sessionId,
      result: {
        ...recovery,
        executionStatus: execution.result?.status,
        scheduleItems: execution.result?.scheduleItems,
      },
      session: execution.session,
    }
  }

  async executePendingCommand(
    input: RuntimeExecutePendingCommandInput | (Partial<RuntimeExecutePendingCommandInput> & {
      pendingId?: string
      scheduleDate: string
      channelId: string
    }),
    sessionId?: string | null,
  ): Promise<AgentServerRuntimeEnvelope<RuntimeExecutedResult>> {
    const session = this.sessions.getOrCreateSession(sessionId)
    const requestedWorkspaceKey = input.workspaceKey?.trim()
    const activeWorkspaceKey = session.formalPlaylistWorkspaceKey?.trim()
    if (!requestedWorkspaceKey || !activeWorkspaceKey || requestedWorkspaceKey !== activeWorkspaceKey) {
      const result = this.buildFormalWriteWorkspaceFailure(
        requestedWorkspaceKey,
        activeWorkspaceKey,
      )
      this.sessions.appendEvent(session.id, {
        type: 'error',
        summary: result.message,
        data: {
          error: result.error,
          requestedWorkspaceKey,
          activeWorkspaceKey,
          noMutation: true,
        },
      })
      return {
        sessionId: session.id,
        result,
        session: serializeSession(session),
      }
    }
    const pendingCommand = this.resolveServerPendingCommand(session, input)
    if (!pendingCommand) {
      const result = this.buildMissingServerPendingResult(input.pendingId)
      this.sessions.appendEvent(session.id, {
        type: 'error',
        summary: result.message,
        data: {
          error: result.error,
          pendingId: input.pendingId,
        },
      })
      return {
        sessionId: session.id,
        result,
        session: serializeSession(session),
      }
    }
    const executionInput: RuntimeExecutePendingCommandInput = {
      ...input,
      pendingCommand,
      scheduleDate: input.scheduleDate,
      channelId: input.channelId,
      pendingId: input.pendingId ?? pendingCommand.pendingId,
    }
    const foregroundSnapshot = input.currentSchedule
      ? buildFormalPlaylistSnapshot(input.currentSchedule, 'foreground')
      : null
    const currentSnapshot = session.formalPlaylistSnapshot ?? foregroundSnapshot ?? null
    const actualPlaylistVersion = session.formalPlaylistVersion ?? currentSnapshot?.version
    const executionOutcome = await this.executionService.executePendingCommand(executionInput, {
      sessionId: session.id,
      workspaceKey: session.formalPlaylistWorkspaceKey ?? undefined,
      transport: 'agent-server',
      actualPlaylistVersion,
      currentSnapshot,
      mutationContext: buildFormalWriteContext(
        `server-confirm:${session.id}`,
        session.formalPlaylistWorkspaceKey ?? 'workspace:unknown',
        input.pendingId ?? pendingCommand.pendingId ?? `pending:${session.id}`,
      ),
    })
    const result = executionOutcome.result
    const resultSnapshot = executionOutcome.resultSnapshot
    const activeExecutionCheckpoint = this.resolveActiveExecutionCheckpoint(executionOutcome.checkpoint)
    const nextSession = this.sessions.updateSession(session.id, {
      pendingCommand: result.success ? null : pendingCommand,
      pendingAtomicContext: result.success ? null : session.pendingAtomicContext ?? null,
      formalPlaylistSnapshot: resultSnapshot ?? currentSnapshot,
      formalPlaylistVersion: resultSnapshot?.version ?? actualPlaylistVersion,
      formalPlaylistWorkspaceKey: session.formalPlaylistWorkspaceKey ?? null,
      activeExecutionCheckpoint,
    })
    this.sessions.appendEvent(session.id, {
      type: 'execution',
      summary: result.success ? '待确认操作已执行。' : '待确认操作执行失败。',
      data: {
        success: result.success,
        summary: result.summary,
        error: result.error,
        formalWrite: result.details?.formalWrite,
        playlistPatch: result.playlistPatch,
      },
    })
    if (result.details?.formalWrite) {
      this.sessions.appendEvent(session.id, {
        type: 'formal_write',
        summary: result.success ? '正式播单写入边界已完成。' : '正式播单写入边界已停止。',
        data: {
          formalWrite: result.details.formalWrite,
          playlistPatch: result.playlistPatch,
          nextVersion: resultSnapshot?.version,
        },
      })
    }
    if (executionOutcome.checkpoint) {
      this.sessions.appendEvent(session.id, {
        type: 'execution_checkpoint',
        summary: executionOutcome.checkpoint.summary,
        data: {
          checkpoint: executionOutcome.checkpoint,
        },
      })
    }
    return {
      sessionId: session.id,
      result,
      session: serializeSession(nextSession),
    }
  }

  async resolvePendingTargetSelection(
    input: RuntimeResolveTargetSelectionInput | (Omit<Partial<RuntimeResolveTargetSelectionInput>, 'pendingTargetSelection'> & {
      pendingId?: string
      selectedItemId?: string | null
    }),
    sessionId?: string | null,
  ): Promise<AgentServerRuntimeEnvelope<RuntimeDecision>> {
    const session = this.sessions.getOrCreateSession(sessionId)
    const pendingTargetSelection = this.resolveServerPendingTargetSelection(session, input)
    const decision = pendingTargetSelection
      ? await this.runtime.resolvePendingTargetSelection({
          ...(input as RuntimeResolveTargetSelectionInput),
          pendingTargetSelection,
        })
      : this.buildMissingServerPendingDecision('当前目标选择已失效，请重新发起操作。')
    const workspaceKey = input.scheduleState
      ? resolveForegroundWorkspaceKey(buildScheduleWorkspaceSummary(input.scheduleState))
      : session.formalPlaylistWorkspaceKey ?? 'none'
    const serverOwnedDecision = this.attachServerPendingOwnership(decision, workspaceKey)
    const nextSession = this.syncDecision(session.id, serverOwnedDecision)
    return {
      sessionId: session.id,
      decision: serverOwnedDecision,
      session: serializeSession(nextSession),
    }
  }

  async resolvePendingInsertRecommendation(
    input: RuntimeResolveInsertRecommendationInput | (Omit<Partial<RuntimeResolveInsertRecommendationInput>, 'pendingInsertRecommendation'> & {
      pendingId?: string
      selectedCandidateId?: string | null
    }),
    sessionId?: string | null,
  ): Promise<AgentServerRuntimeEnvelope<RuntimeDecision>> {
    const session = this.sessions.getOrCreateSession(sessionId)
    const pendingInsertRecommendation = this.resolveServerPendingInsertRecommendation(session, input)
    const decision = pendingInsertRecommendation
      ? await this.runtime.resolvePendingInsertRecommendation({
          ...(input as RuntimeResolveInsertRecommendationInput),
          pendingInsertRecommendation,
        })
      : this.buildMissingServerPendingDecision('当前插入推荐已失效，请重新发起操作。')
    const workspaceKey = input.scheduleState
      ? resolveForegroundWorkspaceKey(buildScheduleWorkspaceSummary(input.scheduleState))
      : session.formalPlaylistWorkspaceKey ?? 'none'
    const serverOwnedDecision = this.attachServerPendingOwnership(decision, workspaceKey)
    const nextSession = this.syncDecision(session.id, serverOwnedDecision)
    return {
      sessionId: session.id,
      decision: serverOwnedDecision,
      session: serializeSession(nextSession),
    }
  }

  stopReactTask(sessionId: string): AgentServerSessionPublicState | null {
    const session = this.sessions.getSession(sessionId)
    if (!session) return null
    const activeReactTaskRun = session.activeReactTaskRun
      ? {
          ...session.activeReactTaskRun,
          status: 'cancelled' as const,
          updatedAt: new Date().toISOString(),
        }
      : null
    const nextSession = this.sessions.updateSession(session.id, {
      activeReactTaskRun,
    })
    this.sessions.appendEvent(session.id, {
      type: 'react_task',
      summary: '已停止当前长程编排任务。',
    })
    return serializeSession(nextSession)
  }

  stopExecutionCheckpoint(sessionId: string): AgentServerSessionPublicState | null {
    const session = this.sessions.getSession(sessionId)
    if (!session) return null
    if (!session.activeExecutionCheckpoint) {
      this.sessions.appendEvent(session.id, {
        type: 'execution_checkpoint',
        summary: '当前没有需要继续处理的批量任务。',
      })
      return serializeSession(session)
    }
    const stoppedCheckpoint = this.executionService.stopCheckpoint(session.activeExecutionCheckpoint)
    const nextSession = this.sessions.updateSession(session.id, {
      activeExecutionCheckpoint: stoppedCheckpoint,
      pendingAtomicContext: null,
      pendingCommand: null,
    })
    this.sessions.appendEvent(session.id, {
      type: 'execution_checkpoint',
      summary: stoppedCheckpoint.summary,
      data: {
        checkpoint: stoppedCheckpoint,
      },
    })
    return serializeSession(nextSession)
  }

  private syncDecision(
    sessionId: string,
    decision: RuntimeDecision,
    contextPackage?: ForegroundAgentContextPackage,
  ): AgentServerSessionState {
    const reactTaskRun = extractReactTaskRun(decision)
    const pendingCommand = decision.kind === 'pending_command' ? decision.pendingCommand : null
    const pendingAtomicContext = this.resolvePendingAtomicContext(decision)
    const executionCheckpoint = this.executionService.extractCheckpointFromDecision(decision)
    const currentSession = this.sessions.getOrCreateSession(sessionId)
    const nextSession = this.sessions.updateSession(sessionId, {
      lastDecisionKind: decision.kind,
      lastContextPackage: contextPackage ?? currentSession.lastContextPackage,
      pendingCommand,
      pendingAtomicContext,
      activeReactTaskRun: reactTaskRun ?? currentSession.activeReactTaskRun ?? null,
      activeExecutionCheckpoint: executionCheckpoint
        ? this.resolveActiveExecutionCheckpoint(executionCheckpoint)
        : currentSession.activeExecutionCheckpoint ?? null,
    })
    const feedback = getRuntimeDecisionFeedback(decision)
    this.sessions.appendEvent(sessionId, {
      type: 'decision',
      summary: feedback?.content ?? '已生成执行计划。',
      data: {
        kind: decision.kind,
        processType: feedback?.processType,
        processTypeLabel: feedback?.processTypeLabel,
      },
    })
    if (pendingCommand || pendingAtomicContext) {
      this.sessions.appendEvent(sessionId, {
        type: 'pending',
        summary: pendingCommand?.summary ?? '等待用户确认或选择。',
      })
    }
    if (reactTaskRun) {
      this.sessions.appendEvent(sessionId, {
        type: 'react_task',
        summary: `${reactTaskRun.objective}：${reactTaskRun.status}`,
        data: {
          taskId: reactTaskRun.id,
          status: reactTaskRun.status,
          loopCount: reactTaskRun.loopCount,
          observationCount: reactTaskRun.observations.length,
        },
      })
      this.materialEvidenceService.recordReactTaskEvidence(this.sessions, sessionId, reactTaskRun)
    }
    if (executionCheckpoint) {
      this.sessions.appendEvent(sessionId, {
        type: 'execution_checkpoint',
        summary: executionCheckpoint.summary,
        data: {
          checkpoint: executionCheckpoint,
        },
      })
    }
    return this.sessions.getOrCreateSession(nextSession.id)
  }

  private attachServerPendingOwnership(decision: RuntimeDecision, workspaceKey: string): RuntimeDecision {
    if (decision.kind === 'pending_command') {
      const pendingId = decision.pendingCommand.pendingId ?? createServerPendingId('command')
      return {
        ...decision,
        pendingCommand: {
          ...decision.pendingCommand,
          pendingId,
          details: {
            ...decision.pendingCommand.details,
            serverPendingId: pendingId,
            serverOwned: true,
          },
        },
      }
    }
    if (decision.kind === 'pending_atomic_context') {
      return {
        ...decision,
        pendingAtomicContext: this.attachServerPendingAtomicContext(decision.pendingAtomicContext, workspaceKey),
      }
    }
    if (decision.kind === 'agent_execution' && decision.pendingAtomicContext) {
      return {
        ...decision,
        pendingAtomicContext: this.attachServerPendingAtomicContext(decision.pendingAtomicContext, workspaceKey),
      }
    }
    return decision
  }

  private attachServerPendingAtomicContext(context: RuntimePendingAtomicContext, workspaceKey: string): RuntimePendingAtomicContext {
    const pendingId = context.pendingId ?? createServerPendingId(context.phase)
    const owner = context.owner
      ?? (context.phase === 'draft_research_confirmation' ? 'layout_draft' : 'formal_playlist')
    return {
      ...context,
      pendingId,
      owner,
      workspaceKey: context.workspaceKey ?? workspaceKey,
      mutationId: context.mutationId ?? `mutation_${pendingId}`,
      mutationPolicy: context.mutationPolicy ?? 'pending_only',
    }
  }

  private resolveServerPendingCommand(
    session: AgentServerSessionState,
    input: Partial<RuntimeExecutePendingCommandInput> & { pendingId?: string },
  ): RuntimePendingCommand | null {
    const sessionPending = session.pendingCommand ?? null
    if (sessionPending && (!input.pendingId || sessionPending.pendingId === input.pendingId)) {
      return sessionPending
    }
    return input.pendingCommand ?? null
  }

  private resolveServerPendingTargetSelection(
    session: AgentServerSessionState,
    input: Partial<RuntimeResolveTargetSelectionInput> & { pendingId?: string; selectedItemId?: string | null },
  ): RuntimePendingTargetSelection | null {
    if (input.pendingTargetSelection) return input.pendingTargetSelection
    const context = session.pendingAtomicContext
    if (!context || (input.pendingId && context.pendingId !== input.pendingId)) return null
    const selection = rehydratePendingTargetSelectionFromAtomicContext({
      ...context,
      selectedItemId: input.selectedItemId ?? context.selectedItemId ?? null,
    })
    return selection
  }

  private resolveServerPendingInsertRecommendation(
    session: AgentServerSessionState,
    input: Partial<RuntimeResolveInsertRecommendationInput> & { pendingId?: string; selectedCandidateId?: string | null },
  ): RuntimePendingInsertRecommendation | null {
    if (input.pendingInsertRecommendation) return input.pendingInsertRecommendation
    const context = session.pendingAtomicContext
    if (!context || (input.pendingId && context.pendingId !== input.pendingId)) return null
    const recommendation = rehydratePendingInsertRecommendationFromAtomicContext({
      ...context,
      selectedCandidateId: input.selectedCandidateId ?? context.selectedCandidateId ?? null,
    })
    return recommendation
  }

  private buildMissingServerPendingDecision(content: string): RuntimeDecision {
    return {
      kind: 'message',
      statusHint: 'failed',
      feedback: {
        content,
        processType: 'error',
        processTypeLabel: '待确认已失效',
        details: {
          serverPending: 'missing',
          noMutation: true,
        },
      },
    }
  }

  private buildMissingServerPendingResult(pendingId?: string): RuntimeExecutedResult {
    return {
      success: false,
      command: { action: 'validate' } as never,
      message: '当前待确认操作已失效，请重新发起操作。',
      error: 'server_pending_not_found',
      summary: '待确认操作已失效',
      thinking: '服务端没有找到可执行的待确认操作，本轮不会修改正式播单。',
      explanation: '服务端 pending 已不存在、已过期，或与当前确认不匹配。',
      details: {
        serverPending: 'missing',
        pendingId,
        noMutation: true,
      },
    }
  }

  private buildFormalWriteWorkspaceFailure(
    requestedWorkspaceKey?: string,
    activeWorkspaceKey?: string,
  ): RuntimeExecutedResult {
    const missing = !requestedWorkspaceKey || !activeWorkspaceKey
    return {
      success: false,
      command: { action: 'validate' } as never,
      message: missing
        ? '正式写入缺少可信工作区上下文，已拒绝执行。'
        : '待执行操作不属于当前播单工作区，已拒绝执行。',
      error: missing ? 'formal_write_workspace_missing' : 'formal_write_workspace_mismatch',
      summary: '正式写入工作区校验失败',
      thinking: '服务端在解析 pending 与 mutation 前阻断了不可信的工作区请求。',
      explanation: '请刷新当前播单后重新发起操作；系统不会自动回滚或跨工作区续跑。',
      details: {
        requestedWorkspaceKey,
        activeWorkspaceKey,
        noMutation: true,
        formalWrite: {
          boundary: 'formal-playlist-write-adapter',
          transport: 'agent-server',
          status: 'blocked',
          reused: false,
          workspaceKey: requestedWorkspaceKey,
        },
      },
    }
  }

  private resolvePendingAtomicContext(decision: RuntimeDecision): RuntimePendingAtomicContext | null {
    if (decision.kind === 'pending_atomic_context') return decision.pendingAtomicContext
    if (decision.kind === 'agent_execution') return decision.pendingAtomicContext ?? null
    return null
  }

  private resolveActiveExecutionCheckpoint(
    checkpoint: AgentExecutionCheckpoint | null,
  ): AgentExecutionCheckpoint | null {
    if (!checkpoint) return null
    return ['waiting_continue', 'failed_retryable', 'blocked'].includes(checkpoint.status)
      ? checkpoint
      : null
  }

}

let globalAgentServerRuntime: AgentServerRuntime | null = null

export function getAgentServerRuntime(): AgentServerRuntime {
  if (!globalAgentServerRuntime) {
    globalAgentServerRuntime = new AgentServerRuntime()
  }
  return globalAgentServerRuntime
}
