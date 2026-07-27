import type {
  AgentExecutionCheckpoint,
  AgentMaterialEvidenceRecord,
  AgentServerSessionEvent,
  AgentServerSessionState,
} from './agentServerSessionStore'
import type { FormalPlaylistSnapshot } from './formalPlaylistState'
import type { FormalOrchestrationCheckpoint } from './formalOrchestrationRuntime'
import type { AgentPlannerAction } from '@/services/llm/agentPlanner'

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
  formalOrchestration?: {
    workspaceKey?: string | null
    playlistVersion?: string | number | null
    request?: {
      userInput: string
      mode: 'full_generate' | 'partial_generate'
      reasoning: string
      targetTimeRange?: { start: string; end: string }
      searchKeywords?: string[]
      authorizationGrantId?: string
    }
    grant?: {
      grantId: string
      sourcePendingId: string
      workspaceKey: string
      initialPlaylistVersion: string
      currentPlaylistVersion: string
      draftFingerprint: string | null
      status: 'active' | 'consumed' | 'revoked'
    }
    checkpoints: FormalOrchestrationCheckpoint<AgentPlannerAction>[]
  }
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
    formalOrchestration: session.formalOrchestrationCheckpoints?.length
      ? {
          workspaceKey: session.formalOrchestrationWorkspaceKey ?? null,
          playlistVersion: session.formalOrchestrationPlaylistVersion ?? null,
          request: session.formalOrchestrationRequest
            ? {
                userInput: session.formalOrchestrationRequest.userInput,
                mode: session.formalOrchestrationRequest.mode,
                reasoning: session.formalOrchestrationRequest.reasoning,
                targetTimeRange: session.formalOrchestrationRequest.targetTimeRange,
                searchKeywords: session.formalOrchestrationRequest.searchKeywords,
                authorizationGrantId: session.formalOrchestrationRequest.authorizationGrantId,
              }
            : undefined,
          grant: session.formalOrchestrationGrant
            ? {
                grantId: session.formalOrchestrationGrant.grantId,
                sourcePendingId: session.formalOrchestrationGrant.sourcePendingId,
                workspaceKey: session.formalOrchestrationGrant.workspaceKey,
                initialPlaylistVersion: session.formalOrchestrationGrant.initialPlaylistVersion,
                currentPlaylistVersion: session.formalOrchestrationGrant.currentPlaylistVersion,
                draftFingerprint: session.formalOrchestrationGrant.draftFingerprint,
                status: session.formalOrchestrationGrant.status,
              }
            : undefined,
          checkpoints: [...session.formalOrchestrationCheckpoints],
        }
      : undefined,
    materialEvidence: session.materialEvidence ? [...session.materialEvidence] : [],
    eventSummary: {
      totalEvents: session.eventLog.length,
      byType: countEventsByType(session.eventLog),
      lastEventAt: session.eventLog.at(-1)?.createdAt,
    },
    recentEvents,
  }
}
