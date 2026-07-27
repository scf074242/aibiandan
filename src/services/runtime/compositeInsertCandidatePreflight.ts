import type { AgentTaskPlanDraft } from '@/services/agent/types'
import type { ProgramCandidate } from '@/types/orchestration'

export interface CompositeInsertCandidateRequest {
  targetTime: string
  programName: string
  expectedDurationSeconds?: number
}

export const extractCompositeInsertCandidateRequest = (
  draft: AgentTaskPlanDraft,
): CompositeInsertCandidateRequest | null => {
  const hasShiftStage = draft.stages.some((stage) => stage.action === 'move')
  const insertStage = draft.stages.find((stage) => stage.action === 'insert')
  if (!hasShiftStage || !insertStage?.target || insertStage.target.candidateId) return null

  const targetTime = insertStage.target.targetTime?.trim()
  const programName = insertStage.target.programName?.trim()
  if (!targetTime || !programName) return null

  const expectedDurationSeconds = typeof insertStage.target.durationSeconds === 'number'
    && Number.isFinite(insertStage.target.durationSeconds)
    && insertStage.target.durationSeconds > 0
    ? insertStage.target.durationSeconds
    : undefined
  return { targetTime, programName, expectedDurationSeconds }
}

export const filterCompositeInsertCandidates = (
  candidates: ProgramCandidate[],
  request: CompositeInsertCandidateRequest,
): ProgramCandidate[] => request.expectedDurationSeconds
  ? candidates.filter((candidate) => candidate.duration === request.expectedDurationSeconds)
  : candidates
