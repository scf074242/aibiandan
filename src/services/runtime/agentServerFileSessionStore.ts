import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import {
  AgentServerSessionStore,
  type AgentMaterialEvidenceRecord,
  type AgentServerSessionEvent,
  type AgentServerSessionState,
} from './agentServerSessionStore'

interface PersistedAgentSessionStore {
  schemaVersion: 1 | 2
  metadata?: {
    storeKind: 'agent-server-file-session-store'
    updatedAt: string
    sessionCount: number
    eventCount: number
    materialEvidenceCount: number
    activeCheckpointCount: number
  }
  sessions: AgentServerSessionState[]
}

const readPersistedSessions = (filePath: string): AgentServerSessionState[] => {
  if (!existsSync(filePath)) return []
  const raw = readFileSync(filePath, 'utf8')
  if (!raw.trim()) return []
  const parsed = JSON.parse(raw) as Partial<PersistedAgentSessionStore>
  if (![1, 2].includes(parsed.schemaVersion ?? 0) || !Array.isArray(parsed.sessions)) return []
  return parsed.sessions.filter((session): session is AgentServerSessionState => (
    typeof session?.id === 'string'
    && typeof session.createdAt === 'string'
    && typeof session.updatedAt === 'string'
    && Array.isArray(session.eventLog)
  ))
}

const isNodeError = (error: unknown): error is Error & { code?: string } => error instanceof Error

const isRecoverableReplaceError = (error: unknown): boolean => {
  if (!isNodeError(error)) return false
  return ['EACCES', 'EBUSY', 'ENOENT', 'EPERM'].includes(error.code ?? '')
}

const removeFileIfExists = (filePath: string): void => {
  try {
    unlinkSync(filePath)
  } catch (error) {
    if (!isNodeError(error) || error.code !== 'ENOENT') {
      throw error
    }
  }
}

const replacePersistedFile = (temporaryPath: string, filePath: string): void => {
  try {
    renameSync(temporaryPath, filePath)
    return
  } catch (error) {
    if (!isRecoverableReplaceError(error)) throw error
  }

  try {
    removeFileIfExists(filePath)
    renameSync(temporaryPath, filePath)
    return
  } catch (error) {
    if (!isRecoverableReplaceError(error)) throw error
  }

  copyFileSync(temporaryPath, filePath)
  removeFileIfExists(temporaryPath)
}

const buildTemporaryPath = (filePath: string): string => (
  `${filePath}.${Date.now()}-${Math.random().toString(36).slice(2, 8)}.tmp`
)

export class AgentServerFileSessionStore extends AgentServerSessionStore {
  constructor(private readonly filePath: string) {
    super(readPersistedSessions(filePath))
  }

  override createSession(): AgentServerSessionState {
    const session = super.createSession()
    this.persistSafely()
    return session
  }

  override updateSession(
    sessionId: string,
    patch: Partial<Omit<AgentServerSessionState, 'id' | 'createdAt' | 'eventLog'>>,
  ): AgentServerSessionState {
    const session = super.updateSession(sessionId, patch)
    this.persistSafely()
    return session
  }

  override appendEvent(
    sessionId: string,
    event: Omit<AgentServerSessionEvent, 'id' | 'createdAt'>,
  ): AgentServerSessionEvent {
    const nextEvent = super.appendEvent(sessionId, event)
    this.persistSafely()
    return nextEvent
  }

  override appendMaterialEvidence(
    sessionId: string,
    evidence: Omit<AgentMaterialEvidenceRecord, 'id' | 'createdAt'>,
  ): AgentMaterialEvidenceRecord {
    const record = super.appendMaterialEvidence(sessionId, evidence)
    this.persistSafely()
    return record
  }

  override reset(): void {
    super.reset()
    this.persistSafely()
  }

  private persistSafely(): void {
    try {
      this.persist()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`Agent session persistence failed; continuing with in-memory state: ${message}`)
    }
  }

  private persist(): void {
    mkdirSync(dirname(this.filePath), { recursive: true })
    const sessions = this.listSessions()
    const payload: PersistedAgentSessionStore = {
      schemaVersion: 2,
      metadata: {
        storeKind: 'agent-server-file-session-store',
        updatedAt: new Date().toISOString(),
        sessionCount: sessions.length,
        eventCount: sessions.reduce((sum, session) => sum + session.eventLog.length, 0),
        materialEvidenceCount: sessions.reduce((sum, session) => sum + (session.materialEvidence?.length ?? 0), 0),
        activeCheckpointCount: sessions.filter((session) => Boolean(session.activeExecutionCheckpoint)).length,
      },
      sessions,
    }
    const temporaryPath = buildTemporaryPath(this.filePath)
    writeFileSync(temporaryPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
    replacePersistedFile(temporaryPath, this.filePath)
  }
}
