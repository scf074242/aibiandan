import type { RuntimeDecision, RuntimePendingCommand } from './schedulingAgentRuntimeFacade'
import type { RuntimePendingAtomicContext } from './pendingAtomicContext'
import type { ForegroundAgentContextPackage } from './foregroundAgentContextPackage'
import type { ReactTaskRun } from './reactTaskTypes'

export interface AgentServerSessionState {
  id: string
  createdAt: string
  updatedAt: string
  lastDecisionKind?: RuntimeDecision['kind']
  lastContextPackage?: ForegroundAgentContextPackage
  pendingCommand?: RuntimePendingCommand | null
  pendingAtomicContext?: RuntimePendingAtomicContext | null
  activeReactTaskRun?: ReactTaskRun | null
  formalPlaylistVersion?: string | number
  eventLog: AgentServerSessionEvent[]
}

export interface AgentServerSessionEvent {
  id: string
  type: 'session' | 'context' | 'decision' | 'pending' | 'react_task' | 'execution' | 'error'
  summary: string
  createdAt: string
  data?: Record<string, unknown>
}

const createId = (prefix: string): string => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

const nowIso = (): string => new Date().toISOString()

export class AgentServerSessionStore {
  private readonly sessions = new Map<string, AgentServerSessionState>()

  createSession(): AgentServerSessionState {
    const now = nowIso()
    const session: AgentServerSessionState = {
      id: createId('agent_session'),
      createdAt: now,
      updatedAt: now,
      eventLog: [],
    }
    this.sessions.set(session.id, session)
    this.appendEvent(session.id, {
      type: 'session',
      summary: '已创建 AI 编审助手会话。',
    })
    return this.getSession(session.id) ?? session
  }

  getSession(sessionId: string): AgentServerSessionState | null {
    return this.sessions.get(sessionId) ?? null
  }

  getOrCreateSession(sessionId?: string | null): AgentServerSessionState {
    if (sessionId) {
      const existing = this.getSession(sessionId)
      if (existing) return existing
    }
    return this.createSession()
  }

  updateSession(
    sessionId: string,
    patch: Partial<Omit<AgentServerSessionState, 'id' | 'createdAt' | 'eventLog'>>,
  ): AgentServerSessionState {
    const session = this.getOrCreateSession(sessionId)
    const next = {
      ...session,
      ...patch,
      updatedAt: nowIso(),
    }
    this.sessions.set(session.id, next)
    return next
  }

  appendEvent(
    sessionId: string,
    event: Omit<AgentServerSessionEvent, 'id' | 'createdAt'>,
  ): AgentServerSessionEvent {
    const session = this.getOrCreateSession(sessionId)
    const nextEvent: AgentServerSessionEvent = {
      id: createId('agent_event'),
      createdAt: nowIso(),
      ...event,
    }
    const eventLog = [...session.eventLog, nextEvent].slice(-100)
    this.sessions.set(session.id, {
      ...session,
      eventLog,
      updatedAt: nowIso(),
    })
    return nextEvent
  }

  reset(): void {
    this.sessions.clear()
  }
}

let globalAgentServerSessionStore: AgentServerSessionStore | null = null

export function getAgentServerSessionStore(): AgentServerSessionStore {
  if (!globalAgentServerSessionStore) {
    globalAgentServerSessionStore = new AgentServerSessionStore()
  }
  return globalAgentServerSessionStore
}
