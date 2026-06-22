import type { RuntimeDecision, RuntimeFeedback } from './schedulingAgentRuntimeFacade'
import type { ReactTaskRun } from './reactTaskTypes'
import type {
  AgentMaterialEvidenceRecord,
  AgentServerSessionStore,
} from './agentServerSessionStore'

type MaterialEvidenceDraft = Omit<AgentMaterialEvidenceRecord, 'id' | 'createdAt'>

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null
)

const getRuntimeDecisionFeedback = (decision: RuntimeDecision): RuntimeFeedback | null => (
  'feedback' in decision ? decision.feedback : null
)

const resolveEvidenceQuery = (data: unknown): Record<string, unknown> | undefined => {
  if (!isRecord(data)) return undefined
  if (isRecord(data.query)) return data.query
  if (Array.isArray(data.keywords)) return { keywords: data.keywords }
  if (typeof data.keyword === 'string') return { keyword: data.keyword }
  return undefined
}

export class AgentMaterialEvidenceService {
  collectFromDecision(decision: RuntimeDecision): MaterialEvidenceDraft[] {
    const feedback = getRuntimeDecisionFeedback(decision)
    const details = feedback?.details
    if (!isRecord(details)) return []
    const materialEvidence = details.materialEvidence
    if (!isRecord(materialEvidence)) return []
    const summary = typeof materialEvidence.summary === 'string'
      ? materialEvidence.summary
      : '已记录素材查证结果。'
    return [{
      source: 'runtime_feedback',
      summary,
      candidateCount: typeof materialEvidence.candidateCount === 'number'
        ? materialEvidence.candidateCount
        : undefined,
      query: resolveEvidenceQuery(materialEvidence),
      data: materialEvidence,
    }]
  }

  collectFromReactTask(run: ReactTaskRun | null | undefined): MaterialEvidenceDraft[] {
    const latestObservation = run?.observations.at(-1)
    if (latestObservation?.type !== 'asset_search') return []
    return [{
      source: 'react_observation',
      summary: latestObservation.summary,
      candidateCount: typeof latestObservation.data?.candidateCount === 'number'
        ? latestObservation.data.candidateCount
        : undefined,
      query: resolveEvidenceQuery(latestObservation.data),
      data: latestObservation.data,
    }]
  }

  recordDecisionEvidence(
    sessions: AgentServerSessionStore,
    sessionId: string,
    decision: RuntimeDecision,
  ): AgentMaterialEvidenceRecord[] {
    return this.collectFromDecision(decision).map((evidence) =>
      sessions.appendMaterialEvidence(sessionId, evidence),
    )
  }

  recordReactTaskEvidence(
    sessions: AgentServerSessionStore,
    sessionId: string,
    run: ReactTaskRun | null | undefined,
  ): AgentMaterialEvidenceRecord[] {
    return this.collectFromReactTask(run).map((evidence) =>
      sessions.appendMaterialEvidence(sessionId, evidence),
    )
  }
}
