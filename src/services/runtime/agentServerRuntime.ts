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
  type RuntimeResolveInsertRecommendationInput,
  type RuntimeResolveTargetSelectionInput,
  type RuntimeSubmitInput,
} from './schedulingAgentRuntimeFacade'
import {
  rehydratePendingInsertRecommendationFromAtomicContext,
  rehydratePendingTargetSelectionFromAtomicContext,
  type RuntimePendingAtomicContext,
} from './pendingAtomicContext'
import {
  buildForegroundAgentContextPackage,
  type ForegroundAgentContextPackage,
} from './foregroundAgentContextPackage'
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

export interface AgentServerRuntimeOptions {
  runtime?: Pick<SchedulingAgentRuntimeFacade,
    | 'submitInstruction'
    | 'executePendingCommand'
    | 'resolvePendingTargetSelection'
    | 'resolvePendingInsertRecommendation'
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
  materialEvidenceCount: number
  eventCount: number
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
  materialEvidenceCount: session.materialEvidence?.length ?? 0,
  eventCount: session.eventLog.length,
})

export class AgentServerRuntime {
  private readonly runtime: NonNullable<AgentServerRuntimeOptions['runtime']>
  private readonly sessions: AgentServerSessionStore
  private readonly executionService: AgentServerExecutionService
  private readonly materialEvidenceService: AgentMaterialEvidenceService

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

  async submitInstruction(
    input: RuntimeSubmitInput,
    sessionId?: string | null,
  ): Promise<AgentServerRuntimeEnvelope<RuntimeDecision>> {
    const session = this.sessions.getOrCreateSession(sessionId)
    const foregroundSnapshot = buildFormalPlaylistSnapshot(input.currentSchedule, 'foreground')
    const workspaceKey = resolveForegroundWorkspaceKey(buildScheduleWorkspaceSummary(input.scheduleState))
    const knownSnapshot = session.formalPlaylistWorkspaceKey === workspaceKey && session.formalPlaylistSnapshot
      ? session.formalPlaylistSnapshot
      : foregroundSnapshot
    const activeReactTaskRun = session.activeReactTaskRun ?? input.activeReactTaskRun ?? null
    const sameWorkspaceForPending = !session.formalPlaylistWorkspaceKey
      || session.formalPlaylistWorkspaceKey === workspaceKey
    const pendingAtomicContext = input.pendingAtomicContext
      ?? (sameWorkspaceForPending ? session.pendingAtomicContext ?? null : null)
    const contextPackage = buildForegroundAgentContextPackage({
      latestUserInput: input.userInput,
      scheduleState: input.scheduleState,
      currentSchedule: input.currentSchedule,
      currentLayoutDraft: input.currentLayoutDraft,
      pendingAtomicContext,
      activeReactTaskRun,
    })
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
    const decision = await this.runtime.submitInstruction({
      ...input,
      pendingAtomicContext,
      activeReactTaskRun,
      foregroundContextPackage: contextPackage,
      agentCoreEnabled: input.agentCoreEnabled ?? true,
      onProgress: (event) => collectedProgressEvents.push(event),
    })
    const serverOwnedDecision = this.attachServerPendingOwnership(decision)
    this.materialEvidenceService.recordDecisionEvidence(this.sessions, session.id, serverOwnedDecision)
    const nextSession = this.syncDecision(session.id, serverOwnedDecision, contextPackage)
    return {
      sessionId: session.id,
      decision: serverOwnedDecision,
      contextPackage,
      session: serializeSession(nextSession),
      progressEvents: collectedProgressEvents,
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
      actualPlaylistVersion,
      currentSnapshot,
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
    const serverOwnedDecision = this.attachServerPendingOwnership(decision)
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
    const serverOwnedDecision = this.attachServerPendingOwnership(decision)
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

  private attachServerPendingOwnership(decision: RuntimeDecision): RuntimeDecision {
    if (decision.kind === 'pending_command') {
      const pendingId = decision.pendingCommand.pendingId ?? createServerPendingId('command')
      return {
        ...decision,
        pendingCommand: {
          ...decision.pendingCommand,
          pendingId,
          details: {
            ...(decision.pendingCommand.details ?? {}),
            serverPendingId: pendingId,
            serverOwned: true,
          },
        },
      }
    }
    if (decision.kind === 'pending_atomic_context') {
      return {
        ...decision,
        pendingAtomicContext: this.attachServerPendingAtomicContext(decision.pendingAtomicContext),
      }
    }
    if (decision.kind === 'agent_execution' && decision.pendingAtomicContext) {
      return {
        ...decision,
        pendingAtomicContext: this.attachServerPendingAtomicContext(decision.pendingAtomicContext),
      }
    }
    return decision
  }

  private attachServerPendingAtomicContext(context: RuntimePendingAtomicContext): RuntimePendingAtomicContext {
    return {
      ...context,
      pendingId: context.pendingId ?? createServerPendingId(context.phase),
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
