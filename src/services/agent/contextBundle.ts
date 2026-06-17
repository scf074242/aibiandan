import type { ScheduleSummary, TimeRange } from '@/types/orchestration'
import type {
  AgentProgramCandidate,
  SchedulingContext,
  SchedulingContextBundle,
  SchedulingContextSourceEvidence,
  SchedulingContextSourceHints,
  SchedulingContextSourceKind,
  SchedulingContextSourceMetadataHints,
} from './types'

export const buildSchedulingContextBundle = (
  context: Omit<SchedulingContext, 'bundle'>,
): SchedulingContextBundle => {
  const historySchedules = cloneHistorySchedules(context.historySchedules ?? [])
  return {
    identity: {
      channelId: context.channelId,
      date: context.date,
      playlistId: context.playlistId,
      playlistType: context.playlistType,
      rotationStrategy: context.rotationStrategy,
      rotationDurationSeconds: context.rotationDurationSeconds,
    },
    sources: buildSourceContext(context),
    today: {
      scheduleItems: context.scheduleItems.map((item) => ({ ...item })),
      itemCount: context.scheduleItems.length,
    },
    candidates: {
      programCandidates: cloneCandidates(context.programCandidates),
      totalCount: context.programCandidates.length,
    },
    readiness: {
      records: context.broadcastReadiness.map((item) => ({ ...item })),
      totalCount: context.broadcastReadiness.length,
    },
    history: {
      schedules: historySchedules,
      totalCount: historySchedules.length,
      latestSchedule: resolveLatestHistorySchedule(historySchedules, context.date),
      todayOverridesHistory: true,
    },
    constraints: {
      layoutBounds: cloneTimeRange(context.layoutBounds),
      lockedItemIds: [...context.lockedItemIds],
      blockedTimeRanges: context.blockedTimeRanges.map(cloneTimeRange),
    },
    policy: {
      playlistType: context.playlistType,
      rotationStrategy: context.rotationStrategy,
      rotationDurationSeconds: context.rotationDurationSeconds,
      tvStrictFill: context.playlistType === 'tv',
      rotationCandidateWritesRequireConfirmation: context.playlistType === 'rotation',
      sensitiveWriteIntentsRequireConfirmation: ['delete', 'batch_delete'],
    },
  }
}

export const attachSchedulingContextBundle = (
  context: Omit<SchedulingContext, 'bundle'>,
): SchedulingContext => ({
  ...context,
  bundle: buildSchedulingContextBundle(context),
})

const buildSourceContext = (
  context: Omit<SchedulingContext, 'bundle'>,
): SchedulingContextBundle['sources'] => {
  const hints = context.sourceHints ?? {}
  const metadata = context.sourceMetadata ?? {}
  const constraintCount = [
    context.layoutBounds,
    ...context.lockedItemIds,
    ...context.blockedTimeRanges,
  ].filter(Boolean).length

  return {
    today: buildSourceEvidence(hints, metadata, 'today', context.scheduleItems.length),
    candidates: buildSourceEvidence(hints, metadata, 'candidates', context.programCandidates.length),
    readiness: buildSourceEvidence(hints, metadata, 'readiness', context.broadcastReadiness.length),
    history: buildSourceEvidence(hints, metadata, 'history', context.historySchedules?.length ?? 0),
    constraints: buildSourceEvidence(hints, metadata, 'constraints', constraintCount),
    policy: buildSourceEvidence(hints, metadata, 'policy', 1),
  }
}

const buildSourceEvidence = (
  hints: SchedulingContextSourceHints,
  metadata: SchedulingContextSourceMetadataHints,
  key: keyof SchedulingContextSourceHints,
  recordCount: number,
): SchedulingContextSourceEvidence => {
  const source = hints[key] ?? resolveDefaultSource(key, recordCount)
  const sourceMetadata = metadata[key] ?? {}
  const available = recordCount > 0 || source !== 'none'
  return {
    source,
    available,
    recordCount,
    status: sourceMetadata.status ?? resolveSourceStatus(source, available, recordCount),
    errorCode: sourceMetadata.errorCode,
    errorMessage: sourceMetadata.errorMessage,
    version: sourceMetadata.version,
    query: cloneSourceQuery(sourceMetadata.query),
  }
}

const resolveSourceStatus = (
  source: SchedulingContextSourceKind,
  available: boolean,
  recordCount: number,
): SchedulingContextSourceEvidence['status'] => {
  if (source === 'none') return 'missing'
  if (!available) return 'unavailable'
  if (recordCount === 0) return 'empty'
  return 'available'
}

const cloneSourceQuery = (
  query: SchedulingContextSourceEvidence['query'],
): SchedulingContextSourceEvidence['query'] =>
  query
    ? {
        ...query,
        facets: query.facets ? [...query.facets] : undefined,
        filters: query.filters ? { ...query.filters } : undefined,
      }
    : undefined

const resolveDefaultSource = (
  key: keyof SchedulingContextSourceHints,
  recordCount: number,
): SchedulingContextSourceKind => {
  if (recordCount === 0) return 'none'
  if (key === 'today') return 'runtime_schedule_reader'
  if (key === 'candidates') return 'program_candidate_reader'
  if (key === 'readiness') return 'readiness_reader'
  if (key === 'history') return 'history_schedule_reader'
  if (key === 'constraints') return 'constraint_reader'
  return 'schedule_state'
}

const cloneCandidates = (candidates: AgentProgramCandidate[]): AgentProgramCandidate[] =>
  candidates.map((candidate) => ({ ...candidate }))

const cloneHistorySchedules = (schedules: ScheduleSummary[]): ScheduleSummary[] =>
  schedules.map((summary) => ({
    ...summary,
    items: summary.items?.map((item) => ({ ...item })),
  }))

const cloneTimeRange = <T extends TimeRange | undefined>(range: T): T =>
  (range ? { ...range } : undefined) as T

const resolveLatestHistorySchedule = (
  schedules: ScheduleSummary[],
  currentDate: string,
): ScheduleSummary | undefined => {
  return schedules
    .filter((summary) => summary.date < currentDate)
    .sort((a, b) => b.date.localeCompare(a.date))[0]
}
