import type {
  AgentPendingAction,
  AgentPendingTask,
  AgentSlotBag,
  AtomicCommandIntent,
} from './types'

export interface PendingTaskDraft {
  intent: AtomicCommandIntent
  phase: AgentPendingTask['phase']
  originalInput: string
  collectedInput?: string
  collectedSlots: AgentSlotBag
  missingSlots: string[]
  recommendations?: AgentPendingTask['recommendations']
  targetOptions?: AgentPendingTask['targetOptions']
  contextFingerprint?: string
  contextSources?: AgentPendingTask['contextSources']
}

export interface PendingContinuationInput {
  pendingTask: AgentPendingTask
  latestUserInput: string
  slotPatch: AgentSlotBag
  missingSlots: string[]
}

export interface AgentPendingLlmContext {
  pendingContext: {
    phase: AgentPendingTask['phase']
    intent: AgentPendingTask['intent']
    originalInput: string
    collectedInput: string
    attemptCount: number
    maxAttempts: number
    expiresAt?: string
    contextFingerprint?: string
    contextSources?: AgentPendingTask['contextSources']
    collectedSlots: Record<string, unknown>
    missingSlots: string[]
    recommendations?: AgentPendingTask['recommendations']
    targetOptions?: AgentPendingTask['targetOptions']
  }
  evidenceSummary?: AgentPendingEvidenceSummaryItem[]
  latestUserInput: string
  allowedActions: AgentPendingAction[]
}

export interface AgentPendingEvidenceSummaryItem {
  sourceKey: string
  recordCount: number
  status?: string
  samples: string[]
}

export const createPendingTask = (draft: PendingTaskDraft): AgentPendingTask => {
  const now = new Date().toISOString()
  return {
    id: `pending_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    intent: draft.intent,
    phase: draft.phase,
    originalInput: draft.originalInput,
    collectedInput: draft.collectedInput ?? draft.originalInput,
    collectedSlots: draft.collectedSlots,
    missingSlots: draft.missingSlots,
    allowedActions: buildAllowedActions(draft.phase),
    recommendations: draft.recommendations,
    targetOptions: draft.targetOptions,
    attemptCount: 0,
    maxAttempts: 3,
    createdAt: now,
    updatedAt: now,
    contextFingerprint: draft.contextFingerprint,
    contextSources: draft.contextSources,
  }
}

export const continuePendingTask = (input: PendingContinuationInput): AgentPendingTask => ({
  ...input.pendingTask,
  collectedInput: [input.pendingTask.collectedInput, input.latestUserInput].filter(Boolean).join('\n'),
  collectedSlots: {
    ...input.pendingTask.collectedSlots,
    ...input.slotPatch,
  },
  missingSlots: input.missingSlots,
  phase: input.missingSlots.length > 0 ? 'needs_clarification' : input.pendingTask.phase,
  allowedActions: buildAllowedActions(input.missingSlots.length > 0 ? 'needs_clarification' : input.pendingTask.phase),
  attemptCount: input.pendingTask.attemptCount + 1,
  updatedAt: new Date().toISOString(),
})

export const buildPendingLlmContext = (pendingTask: AgentPendingTask, latestUserInput: string): AgentPendingLlmContext => ({
  pendingContext: {
    phase: pendingTask.phase,
    intent: pendingTask.intent,
    originalInput: pendingTask.originalInput,
    collectedInput: pendingTask.collectedInput,
    attemptCount: pendingTask.attemptCount,
    maxAttempts: pendingTask.maxAttempts,
    expiresAt: pendingTask.expiresAt,
    contextFingerprint: pendingTask.contextFingerprint,
    contextSources: pendingTask.contextSources,
    collectedSlots: Object.fromEntries(
      Object.entries(pendingTask.collectedSlots).map(([key, slot]) => [key, slot?.value]),
    ),
    missingSlots: pendingTask.missingSlots,
    recommendations: pendingTask.recommendations,
    targetOptions: pendingTask.targetOptions,
  },
  evidenceSummary: buildPendingEvidenceSummary(pendingTask),
  latestUserInput,
  allowedActions: pendingTask.allowedActions,
})

const buildPendingEvidenceSummary = (pendingTask: AgentPendingTask): AgentPendingEvidenceSummaryItem[] | undefined => {
  const summary = (pendingTask.contextSources ?? [])
    .map((source) => {
      const samples = (source.samples ?? [])
        .map((sample) => sample.trim())
        .filter(Boolean)
        .slice(0, 3)
      return {
        sourceKey: source.sourceKey,
        recordCount: source.recordCount,
        status: source.status,
        samples,
      }
    })
    .filter((item) => item.samples.length > 0)
    .slice(0, 6)

  return summary.length > 0 ? summary : undefined
}

const buildAllowedActions = (phase: AgentPendingTask['phase']): AgentPendingAction[] => {
  if (phase === 'needs_selection') {
    return ['select_candidate', 'start_new_task', 'cancel_pending']
  }
  if (phase === 'needs_confirmation') {
    return ['confirm', 'reject', 'start_new_task', 'cancel_pending']
  }
  return ['start_new_task', 'cancel_pending']
}
