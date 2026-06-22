import {
  SchedulingAgentRuntimeFacade,
  type RuntimeDecision,
  type RuntimeExecutePendingCommandInput,
  type RuntimeExecutedResult,
  type RuntimeFeedback,
  type RuntimePendingCommand,
  type RuntimePendingInsertRecommendation,
  type RuntimePendingTargetSelection,
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
  type AgentMaterialEvidenceRecord,
  type AgentServerSessionEvent,
  type AgentServerSessionState,
} from './agentServerSessionStore'
import { FormalPlaylistWriteAdapter } from './formalPlaylistWriteAdapter'
import { getAtomicCapabilities } from '../atomicCapabilities'
import {
  buildFormalPlaylistSnapshot,
  buildScheduleItemSnapshotsFromFormalPlaylist,
  type FormalPlaylistSnapshot,
} from './formalPlaylistState'
import {
  buildScheduleWorkspaceSummary,
  resolveForegroundWorkspaceKey,
} from './foregroundWorkspaceState'

export interface AgentServerRuntimeOptions {
  runtime?: Pick<SchedulingAgentRuntimeFacade,
    | 'submitInstruction'
    | 'executePendingCommand'
    | 'resolvePendingTargetSelection'
    | 'resolvePendingInsertRecommendation'
  >
  sessions?: AgentServerSessionStore
  formalPlaylistWrites?: FormalPlaylistWriteAdapter
}

export interface AgentServerRuntimeEnvelope<T> {
  sessionId: string
  decision?: T
  result?: T
  contextPackage?: ForegroundAgentContextPackage
  session: AgentServerSessionPublicState
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
  materialEvidenceCount: session.materialEvidence?.length ?? 0,
  eventCount: session.eventLog.length,
})

export class AgentServerRuntime {
  private readonly runtime: NonNullable<AgentServerRuntimeOptions['runtime']>
  private readonly sessions: AgentServerSessionStore
  private readonly formalPlaylistWrites: FormalPlaylistWriteAdapter

  constructor(options: AgentServerRuntimeOptions = {}) {
    this.runtime = options.runtime ?? new SchedulingAgentRuntimeFacade()
    this.sessions = options.sessions ?? getAgentServerSessionStore()
    this.formalPlaylistWrites = options.formalPlaylistWrites ?? new FormalPlaylistWriteAdapter({
      executePendingCommand: (input) => this.runtime.executePendingCommand(input),
      prepareSnapshotForExecution: (snapshot) => {
        getAtomicCapabilities().loadItems(buildScheduleItemSnapshotsFromFormalPlaylist(snapshot))
      },
    })
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
    const pendingAtomicContext = input.pendingAtomicContext ?? null
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

    const decision = await this.runtime.submitInstruction({
      ...input,
      pendingAtomicContext,
      activeReactTaskRun,
      foregroundContextPackage: contextPackage,
      agentCoreEnabled: input.agentCoreEnabled ?? true,
    })
    const serverOwnedDecision = this.attachServerPendingOwnership(decision)
    this.recordMaterialEvidenceFromDecision(session.id, serverOwnedDecision)
    const nextSession = this.syncDecision(session.id, serverOwnedDecision, contextPackage)
    return {
      sessionId: session.id,
      decision: serverOwnedDecision,
      contextPackage,
      session: serializeSession(nextSession),
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
    const result = await this.formalPlaylistWrites.execute(executionInput, {
      sessionId: session.id,
      actualPlaylistVersion,
      currentSnapshot,
    })
    const resultSnapshot = this.resolveResultSnapshot(result)
    const nextSession = this.sessions.updateSession(session.id, {
      pendingCommand: result.success ? null : pendingCommand,
      pendingAtomicContext: result.success ? null : session.pendingAtomicContext ?? null,
      formalPlaylistSnapshot: resultSnapshot ?? currentSnapshot,
      formalPlaylistVersion: resultSnapshot?.version ?? actualPlaylistVersion,
      formalPlaylistWorkspaceKey: session.formalPlaylistWorkspaceKey ?? null,
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

  private syncDecision(
    sessionId: string,
    decision: RuntimeDecision,
    contextPackage?: ForegroundAgentContextPackage,
  ): AgentServerSessionState {
    const reactTaskRun = extractReactTaskRun(decision)
    const pendingCommand = decision.kind === 'pending_command' ? decision.pendingCommand : null
    const pendingAtomicContext = this.resolvePendingAtomicContext(decision)
    const currentSession = this.sessions.getOrCreateSession(sessionId)
    const nextSession = this.sessions.updateSession(sessionId, {
      lastDecisionKind: decision.kind,
      lastContextPackage: contextPackage ?? currentSession.lastContextPackage,
      pendingCommand,
      pendingAtomicContext,
      activeReactTaskRun: reactTaskRun ?? currentSession.activeReactTaskRun ?? null,
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
      const latestObservation = reactTaskRun.observations.at(-1)
      if (latestObservation?.type === 'asset_search') {
        this.sessions.appendMaterialEvidence(sessionId, {
          source: 'react_observation',
          summary: latestObservation.summary,
          candidateCount: typeof latestObservation.data?.candidateCount === 'number'
            ? latestObservation.data.candidateCount
            : undefined,
          query: this.resolveEvidenceQuery(latestObservation.data),
          data: latestObservation.data,
        })
      }
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

  private resolveResultSnapshot(result: RuntimeExecutedResult): FormalPlaylistSnapshot | null {
    const snapshot = result.scheduleSnapshot
    if (!snapshot || !isRecord(snapshot)) return null
    if (typeof snapshot.version !== 'string' || !Array.isArray(snapshot.items)) return null
    return snapshot as unknown as FormalPlaylistSnapshot
  }

  private recordMaterialEvidenceFromDecision(sessionId: string, decision: RuntimeDecision): AgentMaterialEvidenceRecord | null {
    const feedback = getRuntimeDecisionFeedback(decision)
    const details = feedback?.details
    if (!isRecord(details)) return null
    const materialEvidence = details.materialEvidence
    if (!isRecord(materialEvidence)) return null
    const summary = typeof materialEvidence.summary === 'string'
      ? materialEvidence.summary
      : '已记录素材查证结果。'
    return this.sessions.appendMaterialEvidence(sessionId, {
      source: 'runtime_feedback',
      summary,
      candidateCount: typeof materialEvidence.candidateCount === 'number'
        ? materialEvidence.candidateCount
        : undefined,
      query: this.resolveEvidenceQuery(materialEvidence),
      data: materialEvidence,
    })
  }

  private resolveEvidenceQuery(data: unknown): Record<string, unknown> | undefined {
    if (!isRecord(data)) return undefined
    if (isRecord(data.query)) return data.query
    if (Array.isArray(data.keywords)) return { keywords: data.keywords }
    if (typeof data.keyword === 'string') return { keyword: data.keyword }
    return undefined
  }

  private resolvePendingAtomicContext(decision: RuntimeDecision): RuntimePendingAtomicContext | null {
    if (decision.kind === 'pending_atomic_context') return decision.pendingAtomicContext
    if (decision.kind === 'agent_execution') return decision.pendingAtomicContext ?? null
    return null
  }
}

let globalAgentServerRuntime: AgentServerRuntime | null = null

export function getAgentServerRuntime(): AgentServerRuntime {
  if (!globalAgentServerRuntime) {
    globalAgentServerRuntime = new AgentServerRuntime()
  }
  return globalAgentServerRuntime
}
