import type { ReactTaskObservation } from './reactTaskTypes'

export interface FormalOrchestrationContextCheckpoint<ActionDraft> {
  turn: number
  actions: ActionDraft[]
  observations: ReactTaskObservation[]
  decision: {
    kind: string
    reason: string
  }
  failureReason?: string
}

export interface FormalOrchestrationDecidedActionSummary {
  turn: number
  actionSummaries: string[]
  decisionKind: string
  decisionReason: string
}

export interface FormalOrchestrationRecentContextTurn<ActionDraft> {
  turn: number
  actions: ActionDraft[]
  observations: ReactTaskObservation[]
  decision: {
    kind: string
    reason: string
  }
  failureReason?: string
}

export interface FormalOrchestrationContextCompactionTrace {
  strategy: 'recent_raw_plus_decided_summary'
  retainRecentTurns: number
  before: {
    checkpointCount: number
    observationCount: number
    actionCount: number
  }
  after: {
    rawTurnCount: number
    rawObservationCount: number
    rawActionCount: number
    summarizedTurnCount: number
    failureReasonCount: number
  }
  dropped: {
    rawTurnCount: number
    rawObservationCount: number
    rawActionCount: number
  }
}

export interface FormalOrchestrationCompactedContext<ActionDraft> {
  schemaVersion: 1
  objective: string
  recentTurns: FormalOrchestrationRecentContextTurn<ActionDraft>[]
  decidedActionSummaries: FormalOrchestrationDecidedActionSummary[]
  failureReasons: string[]
  trace: FormalOrchestrationContextCompactionTrace
}

export interface CompactFormalOrchestrationContextInput<ActionDraft> {
  objective: string
  checkpoints: FormalOrchestrationContextCheckpoint<ActionDraft>[]
  retainRecentTurns?: number
}

const SUMMARY_FIELDS = [
  'type',
  'intent',
  'purpose',
  'mutationPolicy',
  'targetTime',
  'targetProgramName',
  'candidateId',
] as const

const isRecord = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
)

const stableValue = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableValue).join(',')}]`
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableValue(item)}`)
    .join(',')}}`
}

const summarizeAction = (action: unknown): string => {
  if (!isRecord(action)) return stableValue(action)
  const fields = SUMMARY_FIELDS
    .filter((key) => action[key] !== undefined)
    .map((key) => `${key}=${String(action[key])}`)
  return fields.length ? fields.join(', ') : stableValue(action)
}

const uniqueNonEmpty = (values: Array<string | undefined>): string[] => (
  Array.from(new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value))))
)

export const compactFormalOrchestrationContext = <ActionDraft>(
  input: CompactFormalOrchestrationContextInput<ActionDraft>,
): FormalOrchestrationCompactedContext<ActionDraft> => {
  const retainRecentTurns = Math.max(1, Math.min(5, Math.floor(input.retainRecentTurns ?? 2)))
  const checkpoints = [...input.checkpoints].sort((left, right) => left.turn - right.turn)
  const recentCheckpoints = checkpoints.slice(-retainRecentTurns)
  const observationCount = checkpoints.reduce((total, item) => total + item.observations.length, 0)
  const actionCount = checkpoints.reduce((total, item) => total + item.actions.length, 0)
  const rawObservationCount = recentCheckpoints.reduce((total, item) => total + item.observations.length, 0)
  const rawActionCount = recentCheckpoints.reduce((total, item) => total + item.actions.length, 0)
  const failureReasons = uniqueNonEmpty(checkpoints.flatMap((item) => [
    item.failureReason,
    item.decision.kind === 'continue' || item.decision.kind === 'complete'
      ? undefined
      : item.decision.reason,
  ]))

  return {
    schemaVersion: 1,
    objective: input.objective,
    recentTurns: recentCheckpoints.map((item) => ({
      turn: item.turn,
      actions: [...item.actions],
      observations: [...item.observations],
      decision: { ...item.decision },
      failureReason: item.failureReason,
    })),
    decidedActionSummaries: checkpoints.map((item) => ({
      turn: item.turn,
      actionSummaries: item.actions.map(summarizeAction),
      decisionKind: item.decision.kind,
      decisionReason: item.decision.reason,
    })),
    failureReasons,
    trace: {
      strategy: 'recent_raw_plus_decided_summary',
      retainRecentTurns,
      before: {
        checkpointCount: checkpoints.length,
        observationCount,
        actionCount,
      },
      after: {
        rawTurnCount: recentCheckpoints.length,
        rawObservationCount,
        rawActionCount,
        summarizedTurnCount: checkpoints.length,
        failureReasonCount: failureReasons.length,
      },
      dropped: {
        rawTurnCount: Math.max(0, checkpoints.length - recentCheckpoints.length),
        rawObservationCount: Math.max(0, observationCount - rawObservationCount),
        rawActionCount: Math.max(0, actionCount - rawActionCount),
      },
    },
  }
}
