import type {
  AgentPendingTask,
  AtomicCommandIntent,
} from '@/services/agent/types'
import type { PlaylistType, TaskMode } from '@/types/orchestration'
import type { SchedulingTaskRun } from './schedulingTaskPlan'
import type {
  RuntimeInsertRecommendationCandidate,
  RuntimePendingAtomicClarification,
  RuntimePendingInsertRecommendation,
  RuntimePendingTargetSelection,
  RuntimeScheduleItem,
} from './demoRuntimeFacade'

export type RuntimeAtomicAction = 'insert' | 'move' | 'delete' | 'replace'
export type RuntimePendingAtomicPhase = 'clarifying' | 'selecting_target' | 'recommending_insert' | 'draft_research_confirmation' | 'formal_rebuild_confirmation'
export type RuntimeAtomicMissingField =
  | 'target_time'
  | 'program_name'
  | 'offset'
  | 'direction'
  | 'replacement_program'
  | 'selection'

export interface RuntimeAtomicSlotBag {
  targetTime?: string
  newStartTime?: string
  targetTimeHint?: string
  programName?: string
  rawProgramText?: string
  semanticLabel?: string
  programTypeHint?: string
  expectedDurationSeconds?: number
  targetItemId?: string
  targetItemName?: string
  direction?: 'forward' | 'backward'
  offsetSeconds?: number
  replacementProgramName?: string
}

export type RuntimeResumeCompositeTask =
  | { kind: 'insert_with_shift' }
  | {
    kind: 'batch_replace'
    targetLabel: string
    matchKind: 'program' | 'time_range'
    replacementHint: string
    targetItems: RuntimeScheduleItem[]
  }

export interface RuntimeDraftResearchSuggestionCandidate {
  id: string
  programName: string
  programCode?: string
  duration?: number
  programType?: string
  columnName?: string
  contentTags?: string[]
  popularityScore?: number
}

export interface RuntimeDraftResearchSuggestion {
  purpose: 'draft_precheck' | 'candidate_precheck' | 'external_trend_check'
  targetSegmentIndex?: number
  targetSegmentLabel?: string
  semanticLabel: string
  programTypeHint?: string
  queries: string[]
  candidateCount: number
  topCandidates: RuntimeDraftResearchSuggestionCandidate[]
  userInput: string
  reasoning?: string
}

export interface RuntimeFormalRebuildConfirmation {
  actionKind: 'commit_layout_draft' | 'formal_orchestration'
  mode: Extract<TaskMode, 'full_generate' | 'partial_generate'>
  useLayoutDraft?: boolean
  targetTimeRange?: { start: string; end: string }
  existingItemCount: number
  playlistType?: PlaylistType
  userInput: string
  reasoning?: string
  draftId?: string
  draftSource?: string
}

export interface RuntimePendingAtomicContext {
  pendingId?: string
  action: RuntimeAtomicAction | null
  phase: RuntimePendingAtomicPhase
  summary: string
  reasoning: string
  confirmationNote?: string
  originalUserInput: string
  collectedUserInput: string
  slots: RuntimeAtomicSlotBag
  missingFields: RuntimeAtomicMissingField[]
  followUpQuestion: string
  targetCandidates?: RuntimeScheduleItem[]
  insertRecommendations?: RuntimeInsertRecommendationCandidate[]
  selectedItemId?: string | null
  selectedCandidateId?: string | null
  resumeCompositeTask?: RuntimeResumeCompositeTask
  layoutDraftSuggestion?: RuntimeDraftResearchSuggestion
  formalRebuildConfirmation?: RuntimeFormalRebuildConfirmation
  agentPendingTask?: AgentPendingTask
  agentIntent?: AtomicCommandIntent
  compositeTaskRun?: SchedulingTaskRun
  attemptCount: number
  createdAt: string
  updatedAt: string
  expiresAt?: string
}

export interface RuntimePendingAtomicContextSource {
  originalUserInput?: string
  collectedUserInput?: string
  slots?: Partial<RuntimeAtomicSlotBag>
  attemptCount?: number
  createdAt?: string
  expiresAt?: string
}

const nowIso = () => new Date().toISOString()

const mapClarificationMissingField = (field: string): RuntimeAtomicMissingField => {
  const normalized = field.trim().toLowerCase()
  if (normalized === 'target') return 'target_time'
  if (normalized === 'replacement') return 'replacement_program'
  if (normalized.includes('time')) return 'target_time'
  if (normalized.includes('program')) return 'program_name'
  if (normalized.includes('offset') || normalized.includes('duration')) return 'offset'
  if (normalized.includes('direction')) return 'direction'
  if (normalized.includes('replace')) return 'replacement_program'
  return 'selection'
}

export const buildPendingAtomicContextFromClarification = (
  pending: RuntimePendingAtomicClarification,
  timestamp: string = nowIso(),
  source?: RuntimePendingAtomicContextSource,
): RuntimePendingAtomicContext => {
  const mergedSlots: RuntimeAtomicSlotBag = {
    ...(source?.slots ?? {}),
    ...(pending.slots ?? {}),
  }

  if (!mergedSlots.targetTimeHint && pending.targetTimeHint) {
    mergedSlots.targetTimeHint = pending.targetTimeHint
  }
  if (!mergedSlots.programName && pending.programNameHint) {
    mergedSlots.programName = pending.programNameHint
  }
  if (!mergedSlots.rawProgramText && pending.action === 'insert' && mergedSlots.programName) {
    mergedSlots.rawProgramText = mergedSlots.programName
  }

  return {
    pendingId: pending.pendingId,
    action: pending.action,
    phase: 'clarifying',
    summary: pending.summary,
    reasoning: pending.reasoning,
    originalUserInput: source?.originalUserInput ?? pending.originalUserInput,
    collectedUserInput: source?.collectedUserInput ?? pending.collectedUserInput,
    slots: mergedSlots,
    missingFields: pending.missingFields.map(mapClarificationMissingField),
    followUpQuestion: pending.followUpQuestion,
    attemptCount: source?.attemptCount ?? 0,
    createdAt: source?.createdAt ?? timestamp,
    updatedAt: timestamp,
    expiresAt: source?.expiresAt,
  }
}

export const rehydratePendingAtomicClarificationFromAtomicContext = (
  pending: RuntimePendingAtomicContext,
): RuntimePendingAtomicClarification | null => {
  if (pending.phase !== 'clarifying') return null

  const missingFields = pending.missingFields.map((field) => {
    switch (field) {
      case 'target_time':
        return 'target'
      case 'program_name':
        return 'program'
      case 'replacement_program':
        return 'replacement'
      case 'offset':
        return 'offset'
      default:
        return 'target'
    }
  })

  return {
    pendingId: pending.pendingId,
    action: pending.action,
    summary: pending.summary,
    reasoning: pending.reasoning,
    originalUserInput: pending.originalUserInput,
    collectedUserInput: pending.collectedUserInput,
    targetTimeHint: pending.slots.targetTimeHint ?? pending.slots.targetTime,
    programNameHint: pending.slots.programName ?? pending.slots.rawProgramText,
    slots: pending.slots,
    missingFields,
    followUpQuestion: pending.followUpQuestion,
  }
}

export const buildPendingAtomicContextFromTargetSelection = (
  pending: RuntimePendingTargetSelection,
  timestamp: string = nowIso(),
  source?: RuntimePendingAtomicContextSource,
): RuntimePendingAtomicContext => ({
  action: pending.action,
  phase: 'selecting_target',
  summary: pending.summary,
  reasoning: pending.reasoning,
  originalUserInput: source?.originalUserInput ?? pending.summary,
  collectedUserInput: source?.collectedUserInput ?? pending.summary,
  slots: {
    ...(source?.slots ?? {}),
    targetTime: pending.targetTime,
    programName: pending.programName,
    direction: pending.moveConfig?.direction,
    offsetSeconds: pending.moveConfig?.offsetSeconds,
    replacementProgramName: pending.replaceProgramName,
  },
  missingFields: ['selection'],
  followUpQuestion: pending.summary,
  targetCandidates: pending.candidates,
  selectedItemId: pending.selectedItemId,
  attemptCount: source?.attemptCount ?? 0,
  createdAt: source?.createdAt ?? timestamp,
  updatedAt: timestamp,
  expiresAt: source?.expiresAt,
})

export const buildPendingAtomicContextFromInsertRecommendation = (
  pending: RuntimePendingInsertRecommendation,
  timestamp: string = nowIso(),
  source?: RuntimePendingAtomicContextSource,
): RuntimePendingAtomicContext => ({
  action: pending.action,
  phase: 'recommending_insert',
  summary: pending.summary,
  reasoning: pending.reasoning,
  originalUserInput: source?.originalUserInput ?? pending.originalUserInput,
  collectedUserInput: source?.collectedUserInput ?? pending.collectedUserInput,
  slots: {
    ...(source?.slots ?? {}),
    targetTime: pending.targetTime,
    rawProgramText: pending.rawProgramText,
    semanticLabel: pending.semanticLabel,
    programTypeHint: pending.programTypeHint,
    expectedDurationSeconds: pending.expectedDurationSeconds,
    targetItemId: pending.targetItemId,
    targetItemName: pending.targetItemName,
  },
  missingFields: ['selection'],
  followUpQuestion: pending.summary,
  insertRecommendations: pending.recommendedCandidates,
  selectedCandidateId: pending.selectedCandidateId,
  resumeCompositeTask: pending.resumeCompositeTask,
  attemptCount: source?.attemptCount ?? 0,
  createdAt: source?.createdAt ?? timestamp,
  updatedAt: timestamp,
  expiresAt: source?.expiresAt,
})

export const mergeRuntimeAtomicSlots = (
  base: RuntimeAtomicSlotBag,
  patch?: Partial<RuntimeAtomicSlotBag>,
): RuntimeAtomicSlotBag => ({
  ...base,
  ...(patch ?? {}),
})

export const deriveAtomicMissingFieldsFromSlots = (
  action: RuntimeAtomicAction | null,
  slots: RuntimeAtomicSlotBag,
): RuntimeAtomicMissingField[] => {
  const hasTargetTime = Boolean(slots.targetTime || slots.targetTimeHint)
  const hasProgramHint = Boolean(slots.programName || slots.rawProgramText)
  switch (action) {
    case 'move': {
      const missing: RuntimeAtomicMissingField[] = []
      if (!hasTargetTime) missing.push('target_time')
      if (!slots.direction) missing.push('direction')
      if (typeof slots.offsetSeconds !== 'number') missing.push('offset')
      return missing
    }
    case 'delete':
      return hasTargetTime ? [] : ['target_time']
    case 'replace': {
      const missing: RuntimeAtomicMissingField[] = []
      if (!hasTargetTime) missing.push('target_time')
      if (!slots.replacementProgramName) missing.push('replacement_program')
      return missing
    }
    case 'insert': {
      const missing: RuntimeAtomicMissingField[] = []
      if (!hasTargetTime) missing.push('target_time')
      if (!hasProgramHint && !slots.semanticLabel && !slots.programTypeHint) missing.push('program_name')
      return missing
    }
    default:
      return ['target_time']
  }
}

export const rehydratePendingTargetSelectionFromAtomicContext = (
  pending: RuntimePendingAtomicContext,
): RuntimePendingTargetSelection | null => {
  if (pending.phase !== 'selecting_target' || !pending.targetCandidates?.length || !pending.action || pending.action === 'insert') {
    return null
  }

  return {
    pendingId: pending.pendingId,
    action: pending.action,
    summary: pending.summary,
    reasoning: pending.reasoning,
    targetTime: pending.slots.targetTime ?? pending.slots.targetTimeHint ?? '',
    programName: pending.slots.programName,
    candidates: pending.targetCandidates,
    selectedItemId: pending.selectedItemId ?? null,
    moveConfig: pending.slots.direction && typeof pending.slots.offsetSeconds === 'number'
      ? {
          direction: pending.slots.direction,
          offsetSeconds: pending.slots.offsetSeconds,
        }
      : undefined,
    replaceProgramName: pending.slots.replacementProgramName,
  }
}

export const rehydratePendingInsertRecommendationFromAtomicContext = (
  pending: RuntimePendingAtomicContext,
): RuntimePendingInsertRecommendation | null => {
  if (pending.phase !== 'recommending_insert' || !pending.insertRecommendations?.length) {
    return null
  }

  return {
    pendingId: pending.pendingId,
    action: pending.action === 'replace' ? 'replace' : 'insert',
    summary: pending.summary,
    reasoning: pending.reasoning,
    originalUserInput: pending.originalUserInput,
    collectedUserInput: pending.collectedUserInput,
    targetTime: pending.slots.targetTime ?? pending.slots.targetTimeHint ?? '',
    rawProgramText: pending.slots.rawProgramText,
    semanticLabel: pending.slots.semanticLabel,
    programTypeHint: pending.slots.programTypeHint,
    expectedDurationSeconds: pending.slots.expectedDurationSeconds,
    targetItemId: pending.slots.targetItemId,
    targetItemName: pending.slots.targetItemName,
    recommendedCandidates: pending.insertRecommendations,
    selectedCandidateId: pending.selectedCandidateId ?? null,
    resumeCompositeTask: pending.resumeCompositeTask,
  }
}
