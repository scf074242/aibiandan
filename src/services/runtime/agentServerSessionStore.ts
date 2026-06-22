import type { RuntimeDecision, RuntimePendingCommand } from './schedulingAgentRuntimeFacade'
import type { RuntimePendingAtomicContext } from './pendingAtomicContext'
import type { ForegroundAgentContextPackage } from './foregroundAgentContextPackage'
import type { ReactTaskRun } from './reactTaskTypes'
import type { FormalPlaylistSnapshot } from './formalPlaylistState'

export interface AgentMaterialEvidenceRecord {
  id: string
  source: 'react_observation' | 'runtime_feedback' | 'manual'
  summary: string
  query?: Record<string, unknown>
  candidateCount?: number
  createdAt: string
  data?: Record<string, unknown>
}

export interface AgentExecutionCheckpoint {
  id: string
  kind: 'formal_write_batch' | 'composite_task'
  status: 'waiting_continue' | 'failed_retryable' | 'blocked' | 'completed' | 'stopped'
  summary: string
  pendingId?: string
  taskId?: string
  completedCount?: number
  remainingCount?: number
  nextIndex?: number
  batchIndex?: number
  commandCount?: number
  lastError?: string
  suggestedActions: string[]
  createdAt: string
  updatedAt: string
  details?: Record<string, unknown>
}

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
  formalPlaylistSnapshot?: FormalPlaylistSnapshot | null
  formalPlaylistWorkspaceKey?: string | null
  activeExecutionCheckpoint?: AgentExecutionCheckpoint | null
  materialEvidence?: AgentMaterialEvidenceRecord[]
  eventLog: AgentServerSessionEvent[]
}

export interface AgentServerSessionEvent {
  id: string
  type: 'session' | 'context' | 'decision' | 'pending' | 'react_task' | 'execution' | 'formal_write' | 'material_evidence' | 'task_progress' | 'execution_checkpoint' | 'error'
  summary: string
  createdAt: string
  data?: Record<string, unknown>
}

const createId = (prefix: string): string => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

const nowIso = (): string => new Date().toISOString()

type AgentServerSessionEventListener = (event: AgentServerSessionEvent) => void

export class AgentServerSessionStore {
  private readonly sessions = new Map<string, AgentServerSessionState>()
  private readonly listeners = new Map<string, Set<AgentServerSessionEventListener>>()

  constructor(initialSessions: AgentServerSessionState[] = []) {
    initialSessions.forEach((session) => {
      this.sessions.set(session.id, {
        ...session,
        eventLog: [...session.eventLog],
        materialEvidence: session.materialEvidence ? [...session.materialEvidence] : undefined,
      })
    })
  }

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
    this.listeners.get(session.id)?.forEach((listener) => listener(nextEvent))
    return nextEvent
  }

  appendMaterialEvidence(
    sessionId: string,
    evidence: Omit<AgentMaterialEvidenceRecord, 'id' | 'createdAt'>,
  ): AgentMaterialEvidenceRecord {
    const session = this.getOrCreateSession(sessionId)
    const record: AgentMaterialEvidenceRecord = {
      id: createId('material_evidence'),
      createdAt: nowIso(),
      ...evidence,
    }
    const materialEvidence = [...(session.materialEvidence ?? []), record].slice(-50)
    this.sessions.set(session.id, {
      ...session,
      materialEvidence,
      updatedAt: nowIso(),
    })
    this.appendEvent(session.id, {
      type: 'material_evidence',
      summary: record.summary,
      data: {
        source: record.source,
        candidateCount: record.candidateCount,
        query: record.query,
      },
    })
    return record
  }

  subscribe(
    sessionId: string,
    listener: AgentServerSessionEventListener,
  ): () => void {
    const session = this.getOrCreateSession(sessionId)
    const listeners = this.listeners.get(session.id) ?? new Set<AgentServerSessionEventListener>()
    listeners.add(listener)
    this.listeners.set(session.id, listeners)
    return () => {
      const currentListeners = this.listeners.get(session.id)
      if (!currentListeners) return
      currentListeners.delete(listener)
      if (currentListeners.size === 0) {
        this.listeners.delete(session.id)
      }
    }
  }

  reset(): void {
    this.sessions.clear()
    this.listeners.clear()
  }

  listSessions(): AgentServerSessionState[] {
    return Array.from(this.sessions.values()).map((session) => ({
      ...session,
      eventLog: [...session.eventLog],
      materialEvidence: session.materialEvidence ? [...session.materialEvidence] : undefined,
    }))
  }
}

let globalAgentServerSessionStore: AgentServerSessionStore | null = null

export function getAgentServerSessionStore(): AgentServerSessionStore {
  if (!globalAgentServerSessionStore) {
    globalAgentServerSessionStore = new AgentServerSessionStore()
  }
  return globalAgentServerSessionStore
}
