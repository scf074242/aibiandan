import type {
  AgentExecutionCheckpoint,
  AgentMaterialEvidenceRecord,
  AgentServerSessionEvent,
  AgentServerSessionState,
} from './agentServerSessionStore'
import type { FormalPlaylistSnapshot } from './formalPlaylistState'

export interface AgentSessionReplayPackage {
  schemaVersion: 1
  generatedAt: string
  session: {
    id: string
    createdAt: string
    updatedAt: string
    lastDecisionKind?: string
  }
  latestUserInput?: string
  workspace?: {
    playlistType?: string
    playlistId?: string | null
    channelId?: string
    date?: string
    workspaceKey?: string | null
  }
  pending: {
    hasPendingCommand: boolean
    pendingCommandSummary?: string
    hasPendingAtomicContext: boolean
    pendingAtomicSummary?: string
  }
  formalPlaylist?: Pick<FormalPlaylistSnapshot, 'version' | 'itemCount' | 'updatedAt' | 'source'>
  activeExecutionCheckpoint?: AgentExecutionCheckpoint | null
  materialEvidence: AgentMaterialEvidenceRecord[]
  eventSummary: {
    totalEvents: number
    byType: Record<string, number>
    lastEventAt?: string
  }
  recentEvents: AgentServerSessionEvent[]
}

const countEventsByType = (events: AgentServerSessionEvent[]): Record<string, number> => (
  events.reduce<Record<string, number>>((acc, event) => {
    acc[event.type] = (acc[event.type] ?? 0) + 1
    return acc
  }, {})
)

export const buildAgentSessionReplayPackage = (
  session: AgentServerSessionState,
  options: { eventLimit?: number } = {},
): AgentSessionReplayPackage => {
  const eventLimit = options.eventLimit ?? 50
  const recentEvents = session.eventLog.slice(-eventLimit)
  const workspace = session.lastContextPackage?.workspace
  const latestUserInput = session.lastContextPackage?.latestUserInput
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    session: {
      id: session.id,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      lastDecisionKind: session.lastDecisionKind,
    },
    latestUserInput,
    workspace: workspace
      ? {
          playlistType: workspace.playlistType,
          playlistId: workspace.playlistId,
          channelId: workspace.channelId,
          date: workspace.date,
          workspaceKey: session.formalPlaylistWorkspaceKey ?? null,
        }
      : undefined,
    pending: {
      hasPendingCommand: Boolean(session.pendingCommand),
      pendingCommandSummary: session.pendingCommand?.summary,
      hasPendingAtomicContext: Boolean(session.pendingAtomicContext),
      pendingAtomicSummary: session.pendingAtomicContext?.summary,
    },
    formalPlaylist: session.formalPlaylistSnapshot
      ? {
          version: session.formalPlaylistSnapshot.version,
          itemCount: session.formalPlaylistSnapshot.itemCount,
          updatedAt: session.formalPlaylistSnapshot.updatedAt,
          source: session.formalPlaylistSnapshot.source,
        }
      : undefined,
    activeExecutionCheckpoint: session.activeExecutionCheckpoint ?? null,
    materialEvidence: session.materialEvidence ? [...session.materialEvidence] : [],
    eventSummary: {
      totalEvents: session.eventLog.length,
      byType: countEventsByType(session.eventLog),
      lastEventAt: session.eventLog.at(-1)?.createdAt,
    },
    recentEvents,
  }
}
