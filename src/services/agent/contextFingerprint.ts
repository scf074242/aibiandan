import type { ScheduleItemSnapshot } from '@/types/orchestration'
import type {
  AgentPendingContextSourceSnapshot,
  SchedulingContext,
  SchedulingContextSourceEvidence,
  SchedulingContextSourceKey,
} from './types'

export const buildScheduleContextFingerprint = (items: ScheduleItemSnapshot[]): string => {
  const payload = items
    .map((item) => [
      item.id,
      item.startTime,
      item.endTime,
      item.programCode,
      item.programName,
    ].join('|'))
    .sort()
    .join('||')
  return `schedule:${hashText(payload)}`
}

export const buildAgentPendingContextFingerprint = (context: SchedulingContext): string => {
  const payload = stableStringify(buildAgentPendingContextFingerprintPayload(context))
  return `agent_context:${hashText(payload)}`
}

export const buildAgentPendingContextSourceSnapshots = (
  context: SchedulingContext,
): AgentPendingContextSourceSnapshot[] => {
  const sections = buildAgentPendingContextFingerprintPayload(context)
  const sources = context.bundle.sources
  return sourceKeys.map((sourceKey) => {
    const source = sources[sourceKey]
    return {
      sourceKey,
      ...sourceFingerprint(source),
      digest: hashText(stableStringify(sections[sourceKey])),
      samples: buildContextSourceSamples(sourceKey, context),
    }
  })
}

const sourceKeys: SchedulingContextSourceKey[] = [
  'today',
  'candidates',
  'readiness',
  'history',
  'constraints',
  'policy',
]

const buildAgentPendingContextFingerprintPayload = (context: SchedulingContext) => ({
  today: context.scheduleItems.map((item) => ({
      id: item.id,
      programId: item.programId,
      startTime: item.startTime,
      endTime: item.endTime,
      programCode: item.programCode,
      programName: item.programName,
      duration: item.duration,
      programType: item.programType,
      columnId: item.columnId,
      columnName: item.columnName,
    })).sort(compareByStableJson),
  candidates: context.programCandidates.map((candidate) => ({
      id: candidate.id,
      programId: candidate.programId,
      programCode: candidate.programCode,
      programName: candidate.programName,
      instanceName: candidate.instanceName,
      duration: candidate.duration,
      programType: candidate.programType,
      columnId: candidate.columnId,
      columnName: candidate.columnName,
      contentTags: candidate.contentTags?.slice().sort(),
      materialStatus: candidate.materialStatus,
      rightsStatus: candidate.rightsStatus,
      issueNo: candidate.issueNo,
      sequence: (candidate as { sequence?: unknown }).sequence,
    })).sort(compareByStableJson),
  readiness: context.broadcastReadiness.map((record) => ({
      candidateId: record.candidateId,
      programId: record.programId,
      programCode: record.programCode,
      materialStatus: record.materialStatus,
      rightsStatus: record.rightsStatus,
      updatedAt: record.updatedAt,
      source: record.source,
    })).sort(compareByStableJson),
  history: (context.historySchedules ?? []).map((summary) => ({
      date: summary.date,
      itemCount: summary.itemCount,
      items: summary.items?.map((item) => ({
        id: item.id,
        programId: item.programId,
        startTime: item.startTime,
        endTime: item.endTime,
        programCode: item.programCode,
        programName: item.programName,
        duration: item.duration,
        programType: item.programType,
        columnId: item.columnId,
        columnName: item.columnName,
        sequence: item.sequence,
      })).sort(compareByStableJson),
    })).sort(compareByStableJson),
  constraints: {
      layoutBounds: context.layoutBounds,
      lockedItemIds: [...context.lockedItemIds].sort(),
      blockedTimeRanges: context.blockedTimeRanges.map((range) => ({ ...range })).sort(compareByStableJson),
    },
  policy: context.bundle.policy,
  sources: {
      today: sourceFingerprint(context.bundle.sources.today),
      candidates: sourceFingerprint(context.bundle.sources.candidates),
      readiness: sourceFingerprint(context.bundle.sources.readiness),
      history: sourceFingerprint(context.bundle.sources.history),
      constraints: sourceFingerprint(context.bundle.sources.constraints),
      policy: sourceFingerprint(context.bundle.sources.policy),
    },
})

const hashText = (value: string): string => {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

const sourceFingerprint = (source: SchedulingContextSourceEvidence) => ({
  source: source.source,
  available: source.available,
  recordCount: source.recordCount,
  status: source.status,
  errorCode: source.errorCode,
  version: source.version,
})

const buildContextSourceSamples = (
  sourceKey: SchedulingContextSourceKey,
  context: SchedulingContext,
): string[] | undefined => {
  if (sourceKey === 'today') {
    return compactSamples(context.scheduleItems.slice(0, 5).map((item) =>
      [
        clockRange(item.startTime, item.endTime),
        item.programName,
        item.programCode,
        item.programType,
      ].filter(Boolean).join(' '),
    ))
  }

  if (sourceKey === 'candidates') {
    return compactSamples(context.programCandidates.slice(0, 6).map((candidate) =>
      [
        candidate.programName,
        candidate.programCode,
        candidate.programType,
        candidate.materialStatus ? `material=${candidate.materialStatus}` : '',
        candidate.rightsStatus ? `rights=${candidate.rightsStatus}` : '',
      ].filter(Boolean).join(' '),
    ))
  }

  if (sourceKey === 'readiness') {
    return compactSamples(context.broadcastReadiness.slice(0, 5).map((record) =>
      [
        record.candidateId ?? record.programCode ?? record.programId,
        record.materialStatus ? `material=${record.materialStatus}` : '',
        record.rightsStatus ? `rights=${record.rightsStatus}` : '',
      ].filter(Boolean).join(' '),
    ))
  }

  if (sourceKey === 'history') {
    const latest = context.bundle.history.latestSchedule
    if (!latest) return undefined
    return compactSamples([
      `latest=${latest.date} items=${latest.itemCount}`,
      ...(latest.items ?? []).slice(0, 5).map((item) =>
        [
          clockRange(item.startTime, item.endTime),
          item.programName,
          item.programCode,
        ].filter(Boolean).join(' '),
      ),
    ])
  }

  if (sourceKey === 'constraints') {
    return compactSamples([
      context.layoutBounds ? `bounds=${clockRange(context.layoutBounds.start, context.layoutBounds.end)}` : '',
      context.lockedItemIds.length ? `locked=${context.lockedItemIds.slice(0, 5).join('|')}` : '',
      ...context.blockedTimeRanges.slice(0, 3).map((range) => `blocked=${clockRange(range.start, range.end)}`),
    ])
  }

  if (sourceKey === 'policy') {
    return compactSamples([
      `playlist=${context.playlistType}`,
      context.rotationStrategy ? `rotationStrategy=${context.rotationStrategy}` : '',
    ])
  }

  return undefined
}

const compactSamples = (samples: string[]): string[] | undefined => {
  const compacted = samples
    .map((sample) => sample.trim().replace(/\s+/g, ' '))
    .filter(Boolean)
    .map((sample) => sample.length > 120 ? `${sample.slice(0, 117)}...` : sample)
  return compacted.length > 0 ? compacted : undefined
}

const clockRange = (start?: string, end?: string): string => {
  const startClock = toClock(start)
  const endClock = toClock(end)
  return startClock && endClock ? `${startClock}-${endClock}` : startClock || endClock
}

const toClock = (value?: string): string => {
  if (!value) return ''
  const match = value.match(/T(\d{2}:\d{2}:\d{2})/) ?? value.match(/^(\d{2}:\d{2}:\d{2})/)
  return match?.[1] ?? value
}

const compareByStableJson = (left: unknown, right: unknown): number =>
  stableStringify(left).localeCompare(stableStringify(right))

const stableStringify = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`
  }
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, nested]) => nested !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stableStringify(nested)}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? 'undefined'
}
