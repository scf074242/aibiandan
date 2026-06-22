import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import {
  AgentServerSessionStore,
  type AgentMaterialEvidenceRecord,
  type AgentServerSessionEvent,
  type AgentServerSessionState,
} from './agentServerSessionStore'

interface PersistedAgentSessionStore {
  schemaVersion: 1
  sessions: AgentServerSessionState[]
}

const readPersistedSessions = (filePath: string): AgentServerSessionState[] => {
  if (!existsSync(filePath)) return []
  const raw = readFileSync(filePath, 'utf8')
  if (!raw.trim()) return []
  const parsed = JSON.parse(raw) as Partial<PersistedAgentSessionStore>
  if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.sessions)) return []
  return parsed.sessions.filter((session): session is AgentServerSessionState => (
    typeof session?.id === 'string'
    && typeof session.createdAt === 'string'
    && typeof session.updatedAt === 'string'
    && Array.isArray(session.eventLog)
  ))
}

export class AgentServerFileSessionStore extends AgentServerSessionStore {
  constructor(private readonly filePath: string) {
    super(readPersistedSessions(filePath))
  }

  override createSession(): AgentServerSessionState {
    const session = super.createSession()
    this.persist()
    return session
  }

  override updateSession(
    sessionId: string,
    patch: Partial<Omit<AgentServerSessionState, 'id' | 'createdAt' | 'eventLog'>>,
  ): AgentServerSessionState {
    const session = super.updateSession(sessionId, patch)
    this.persist()
    return session
  }

  override appendEvent(
    sessionId: string,
    event: Omit<AgentServerSessionEvent, 'id' | 'createdAt'>,
  ): AgentServerSessionEvent {
    const nextEvent = super.appendEvent(sessionId, event)
    this.persist()
    return nextEvent
  }

  override appendMaterialEvidence(
    sessionId: string,
    evidence: Omit<AgentMaterialEvidenceRecord, 'id' | 'createdAt'>,
  ): AgentMaterialEvidenceRecord {
    const record = super.appendMaterialEvidence(sessionId, evidence)
    this.persist()
    return record
  }

  override reset(): void {
    super.reset()
    this.persist()
  }

  private persist(): void {
    mkdirSync(dirname(this.filePath), { recursive: true })
    const payload: PersistedAgentSessionStore = {
      schemaVersion: 1,
      sessions: this.listSessions(),
    }
    const temporaryPath = `${this.filePath}.tmp`
    writeFileSync(temporaryPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
    renameSync(temporaryPath, this.filePath)
  }
}
