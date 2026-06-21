import {
  SchedulingAgentRuntimeFacade,
  type RuntimeDecision,
  type RuntimeExecutePendingCommandInput,
  type RuntimeExecutedResult,
  type RuntimeFeedback,
  type RuntimeResolveInsertRecommendationInput,
  type RuntimeResolveTargetSelectionInput,
  type RuntimeSubmitInput,
} from './schedulingAgentRuntimeFacade'
import type { RuntimePendingAtomicContext } from './pendingAtomicContext'
import {
  buildForegroundAgentContextPackage,
  type ForegroundAgentContextPackage,
} from './foregroundAgentContextPackage'
import type { ReactTaskRun } from './reactTaskTypes'
import {
  AgentServerSessionStore,
  getAgentServerSessionStore,
  type AgentServerSessionState,
} from './agentServerSessionStore'
import { FormalPlaylistWriteAdapter } from './formalPlaylistWriteAdapter'

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
  eventCount: number
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null
)

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

  async submitInstruction(
    input: RuntimeSubmitInput,
    sessionId?: string | null,
  ): Promise<AgentServerRuntimeEnvelope<RuntimeDecision>> {
    const session = this.sessions.getOrCreateSession(sessionId)
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
    })
    this.sessions.appendEvent(session.id, {
      type: 'context',
      summary: '服务端已重新整理本轮编排上下文。',
      data: {
        scenario: contextPackage.scenario,
        playlistType: contextPackage.workspace.playlistType,
        hasLayoutDraft: contextPackage.layoutDraft.available,
        activeReactTask: contextPackage.reactTask.active,
      },
    })

    const decision = await this.runtime.submitInstruction({
      ...input,
      pendingAtomicContext,
      activeReactTaskRun,
      foregroundContextPackage: contextPackage,
      agentCoreEnabled: input.agentCoreEnabled ?? true,
    })
    const nextSession = this.syncDecision(session.id, decision, contextPackage)
    return {
      sessionId: session.id,
      decision,
      contextPackage,
      session: serializeSession(nextSession),
    }
  }

  async executePendingCommand(
    input: RuntimeExecutePendingCommandInput,
    sessionId?: string | null,
  ): Promise<AgentServerRuntimeEnvelope<RuntimeExecutedResult>> {
    const session = this.sessions.getOrCreateSession(sessionId)
    const result = await this.formalPlaylistWrites.execute(input, {
      sessionId: session.id,
      actualPlaylistVersion: session.formalPlaylistVersion,
    })
    const nextSession = this.sessions.updateSession(session.id, {
      pendingCommand: null,
      pendingAtomicContext: null,
    })
    this.sessions.appendEvent(session.id, {
      type: 'execution',
      summary: result.success ? '待确认操作已执行。' : '待确认操作执行失败。',
      data: {
        success: result.success,
        summary: result.summary,
        error: result.error,
        formalWrite: result.details?.formalWrite,
      },
    })
    return {
      sessionId: session.id,
      result,
      session: serializeSession(nextSession),
    }
  }

  async resolvePendingTargetSelection(
    input: RuntimeResolveTargetSelectionInput,
    sessionId?: string | null,
  ): Promise<AgentServerRuntimeEnvelope<RuntimeDecision>> {
    const session = this.sessions.getOrCreateSession(sessionId)
    const decision = await this.runtime.resolvePendingTargetSelection(input)
    const nextSession = this.syncDecision(session.id, decision)
    return {
      sessionId: session.id,
      decision,
      session: serializeSession(nextSession),
    }
  }

  async resolvePendingInsertRecommendation(
    input: RuntimeResolveInsertRecommendationInput,
    sessionId?: string | null,
  ): Promise<AgentServerRuntimeEnvelope<RuntimeDecision>> {
    const session = this.sessions.getOrCreateSession(sessionId)
    const decision = await this.runtime.resolvePendingInsertRecommendation(input)
    const nextSession = this.syncDecision(session.id, decision)
    return {
      sessionId: session.id,
      decision,
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
    }
    return nextSession
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
