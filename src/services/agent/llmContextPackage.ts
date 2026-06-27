import { buildAgentPendingContextSourceSnapshots } from './contextFingerprint'
import type { AgentLlmContextPackage, AgentSubmitInput, SchedulingContext } from './types'

const DEFAULT_EVIDENCE_BUDGET = {
  scheduleItems: 6,
  candidates: 6,
  latestHistoryItems: 3,
  contentTagsPerCandidate: 4,
} as const

const FOCUSED_EVIDENCE_BUDGET = {
  scheduleItems: 8,
  candidates: 8,
  latestHistoryItems: 4,
  contentTagsPerCandidate: 4,
} as const

const PENDING_EVIDENCE_BUDGET = {
  scheduleItems: 10,
  candidates: 10,
  latestHistoryItems: 4,
  contentTagsPerCandidate: 4,
} as const

const getIssueNo = (value: { issueNo?: string }): string | undefined => value.issueNo
type FocusInput = Pick<AgentSubmitInput, 'userInput' | 'pendingTask'> | undefined
type EvidenceBudget = {
  scheduleItems: number
  candidates: number
  latestHistoryItems: number
  contentTagsPerCandidate: number
}

const formatRotationDurationScope = (seconds?: number): string => {
  if (!seconds || seconds <= 0) return 'duration not specified yet'
  const minutes = Math.max(1, Math.round(seconds / 60))
  const hours = Math.floor(minutes / 60)
  const remainMinutes = minutes % 60
  if (hours > 0 && remainMinutes > 0) return `内容队列总时长${hours}小时${remainMinutes}分钟`
  if (hours > 0) return `内容队列总时长${hours}小时`
  return `内容队列总时长${minutes}分钟`
}

const buildLlmVisibleIdentity = (context: SchedulingContext): AgentLlmContextPackage['identity'] => {
  const identity = context.bundle.identity
  if (identity.playlistType === 'rotation') {
    return {
      playlistId: identity.playlistId,
      playlistType: 'rotation',
      rotationStrategy: identity.rotationStrategy,
      rotationDurationSeconds: identity.rotationDurationSeconds,
      durationScope: formatRotationDurationScope(identity.rotationDurationSeconds),
      positionBasis: 'relative_from_zero',
    }
  }
  return {
    ...identity,
    positionBasis: 'broadcast_clock',
  }
}

const buildPlaylistSemantics = (context: SchedulingContext): AgentLlmContextPackage['playlistSemantics'] =>
  context.bundle.identity.playlistType === 'rotation'
    ? {
        model: 'content_queue',
        positionMeaning: '轮播单按内容队列处理，时间字段表示相对位置和持续时长，不绑定频道日期播出时段。',
        draftBoundary: '轮播整体编排和整体补排需要草案；单条插入、删除、移动、替换、查询、校验可以不依赖草案。',
        writeBoundary: '轮播候选自由度较高，插入和替换通常先给候选或待确认，不让模型直接替用户选最终节目。',
      }
    : {
        model: 'time_grid',
        positionMeaning: '电视播单按频道日期的播出时间格处理，时间表示真实播出时钟。',
        draftBoundary: '电视全天编排和整体补排需要频道版面草案；普通原子操作不因草案存在而改写草案。',
        writeBoundary: '电视写入必须守住时间冲突、顺播、锁定、版权和多候选确认边界。',
      }

export const buildAgentLlmContextPackage = (
  context: SchedulingContext,
  focusInput?: FocusInput,
): AgentLlmContextPackage => {
  const evidenceBudget = resolveEvidenceBudget(focusInput)
  const currentSchedule = selectFocusedScheduleItems(context.scheduleItems, focusInput, evidenceBudget.scheduleItems)
  const candidateSummary = selectFocusedCandidates(context.programCandidates, focusInput, evidenceBudget.candidates)
  const includeLatestHistory = context.bundle.identity.playlistType !== 'rotation' && Boolean(context.bundle.history.latestSchedule)
  const latestHistoryItems = includeLatestHistory ? context.bundle.history.latestSchedule?.items ?? [] : []
  const latestHistorySamples = latestHistoryItems.slice(0, evidenceBudget.latestHistoryItems)

  return {
    identity: buildLlmVisibleIdentity(context),
    playlistSemantics: buildPlaylistSemantics(context),
    budget: {
      scheduleItems: {
        included: currentSchedule.length,
        total: context.scheduleItems.length,
        limit: evidenceBudget.scheduleItems,
        truncated: context.scheduleItems.length > evidenceBudget.scheduleItems,
      },
      candidates: {
        included: candidateSummary.length,
        total: context.programCandidates.length,
        limit: evidenceBudget.candidates,
        truncated: context.programCandidates.length > evidenceBudget.candidates,
      },
      latestHistoryItems: includeLatestHistory
        ? {
            included: latestHistorySamples.length,
            total: latestHistoryItems.length,
            limit: evidenceBudget.latestHistoryItems,
            truncated: latestHistoryItems.length > evidenceBudget.latestHistoryItems,
          }
        : undefined,
      contentTagsPerCandidate: {
        limit: evidenceBudget.contentTagsPerCandidate,
      },
    },
    sourceSummary: buildAgentLlmSourceSummary(context),
    currentSchedule: currentSchedule.map((item) => ({
    itemId: item.id,
    programId: item.programId,
    startTime: item.startTime,
    endTime: item.endTime,
    programName: item.programName,
    instanceName: item.instanceName,
    programCode: item.programCode,
    issueNo: getIssueNo(item),
    programType: item.programType,
    columnName: item.columnName,
    sequence: item.sequence,
    positionBasis: context.bundle.identity.playlistType === 'rotation' ? 'relative_from_zero' : undefined,
  })),
    candidateSummary: candidateSummary.map((candidate) => ({
    candidateId: candidate.id,
    programId: candidate.programId,
    programName: candidate.programName,
    instanceName: candidate.instanceName,
    programCode: candidate.programCode,
    issueNo: candidate.issueNo,
    duration: candidate.duration,
    programType: candidate.programType,
    columnName: candidate.columnName,
    materialStatus: candidate.materialStatus,
    rightsStatus: candidate.rightsStatus,
    contentTags: candidate.contentTags?.slice(0, evidenceBudget.contentTagsPerCandidate),
  })),
    latestHistory: includeLatestHistory && context.bundle.history.latestSchedule
      ? {
          date: context.bundle.history.latestSchedule.date,
          itemCount: context.bundle.history.latestSchedule.itemCount,
          samples: latestHistorySamples.map((item) => ({
          startTime: item.startTime,
          endTime: item.endTime,
          programId: item.programId,
          programName: item.programName,
          instanceName: item.instanceName,
          programCode: item.programCode,
          issueNo: getIssueNo(item),
          sequence: item.sequence,
        })),
        }
      : undefined,
    constraints: {
      layoutBounds: context.bundle.identity.playlistType === 'rotation' ? undefined : context.layoutBounds,
      lockedItemIds: context.lockedItemIds.slice(0, 20),
      blockedTimeRanges: context.bundle.identity.playlistType === 'rotation' ? [] : context.blockedTimeRanges.slice(0, 12),
    },
    policy: context.bundle.policy,
    guardrails: [
    'LLM only extracts intent, slots, pending action, and query kind; it does not approve writes.',
    'Scheduling Agent Core v1.1 only handles atomic playlist commands; layout drafts, full-day auto scheduling, and multi-user collaboration are out of scope.',
    'Destination occupation, overlap, locked item, bounds, readiness, rights, and sequence rules are deterministic runtime blockers.',
    'TV playlist inserts and replacements must preserve sequence using today and history evidence.',
    context.bundle.identity.playlistType === 'rotation'
      ? `Rotation playlists are duration-scope only (${formatRotationDurationScope(context.bundle.identity.rotationDurationSeconds)}); do not treat them as concrete channel/date broadcast time ranges.`
      : 'TV playlists are channel/date schedules with strict broadcast-time rules.',
    'Rotation playlists may use programme-code-less short clips, but candidate writes still require confirmation.',
    'When the user asks to move or insert into an occupied destination, keep the operation blocked instead of shifting, replacing, or reordering automatically.',
    ],
  }
}

const buildAgentLlmSourceSummary = (
  context: SchedulingContext,
): AgentLlmContextPackage['sourceSummary'] =>
  buildAgentPendingContextSourceSnapshots(context).map((source) => {
    const compact = { ...source }
    delete compact.samples
    return compact
  })

const resolveEvidenceBudget = (focusInput: FocusInput): EvidenceBudget => {
  if (focusInput?.pendingTask) return PENDING_EVIDENCE_BUDGET
  if (!focusInput) return DEFAULT_EVIDENCE_BUDGET

  const hasFocusedEvidence =
    buildScheduleFocusTerms(focusInput).length > 0
    || buildScheduleFocusClocks(focusInput).length > 0
    || buildCandidateFocusTerms(focusInput).length > 0

  if (!hasFocusedEvidence) return DEFAULT_EVIDENCE_BUDGET
  return FOCUSED_EVIDENCE_BUDGET
}

const selectFocusedScheduleItems = (
  items: SchedulingContext['scheduleItems'],
  focusInput: FocusInput,
  limit: number,
) => selectFocusedRecords(items, limit, (item) => scoreScheduleItemFocus(item, focusInput))

const selectFocusedCandidates = (
  candidates: SchedulingContext['programCandidates'],
  focusInput: FocusInput,
  limit: number,
) => selectFocusedRecords(candidates, limit, (candidate) => scoreCandidateFocus(candidate, focusInput))

const selectFocusedRecords = <T>(
  records: T[],
  limit: number,
  scoreRecord: (record: T) => number,
): T[] => {
  const scored = records.map((record, index) => ({
    record,
    index,
    score: scoreRecord(record),
  }))
  const hasFocus = scored.some((item) => item.score > 0)
  if (!hasFocus) return records.slice(0, limit)

  return scored
    .sort((left, right) => (right.score - left.score) || (left.index - right.index))
    .slice(0, limit)
    .sort((left, right) => left.index - right.index)
    .map((item) => item.record)
}

const scoreScheduleItemFocus = (
  item: SchedulingContext['scheduleItems'][number],
  focusInput: FocusInput,
): number => {
  if (!focusInput) return 0
  const terms = buildScheduleFocusTerms(focusInput)
  const clocks = buildScheduleFocusClocks(focusInput)
  let score = 0
  const itemId = readSlotString(focusInput.pendingTask?.collectedSlots.targetItemId)
  if (itemId && item.id === itemId) score += 1000

  const startSeconds = clockToSeconds(item.startTime)
  const endSeconds = clockToSeconds(item.endTime)
  for (const clock of clocks) {
    const clockSeconds = clockToSeconds(clock)
    if (clockSeconds === undefined || startSeconds === undefined || endSeconds === undefined) continue
    if (clockSeconds === startSeconds) score += 900
    else if (clockSeconds > startSeconds && clockSeconds < endSeconds) score += 800
    else {
      const distance = Math.min(Math.abs(clockSeconds - startSeconds), Math.abs(clockSeconds - endSeconds))
      if (distance <= 1800) score += 120
    }
  }

  const haystack = normalizeFocusText([
    item.id,
    item.programId,
    item.programCode,
    item.programName,
    item.instanceName,
    item.columnName,
    item.programType,
    getIssueNo(item),
  ].filter(Boolean).join(' '))
  for (const term of terms) {
    if (term && haystack.includes(term)) score += 500
  }
  return score
}

const scoreCandidateFocus = (
  candidate: SchedulingContext['programCandidates'][number],
  focusInput: FocusInput,
): number => {
  if (!focusInput) return 0
  const terms = buildCandidateFocusTerms(focusInput)
  let score = 0
  const selectedCandidateId = readSlotString(focusInput.pendingTask?.collectedSlots.candidateId)
  if (selectedCandidateId && candidate.id === selectedCandidateId) score += 1000

  const haystack = normalizeFocusText([
    candidate.id,
    candidate.programId,
    candidate.programCode,
    candidate.programName,
    candidate.instanceName,
    candidate.columnName,
    candidate.programType,
    candidate.issueNo,
    ...(candidate.contentTags ?? []),
  ].filter(Boolean).join(' '))
  for (const term of terms) {
    if (term && haystack.includes(term)) score += 500
  }
  return score
}

const buildScheduleFocusTerms = (focusInput: Exclude<FocusInput, undefined>): string[] => uniqueFocusTerms([
  readSlotString(focusInput.pendingTask?.collectedSlots.targetProgramName),
  readSlotString(focusInput.pendingTask?.collectedSlots.programHint),
  readSlotString(focusInput.pendingTask?.collectedSlots.replacementHint),
  ...extractQuotedTerms(focusInput.userInput),
  ...extractChineseTerms(focusInput.userInput),
])

const buildCandidateFocusTerms = (focusInput: Exclude<FocusInput, undefined>): string[] => uniqueFocusTerms([
  readSlotString(focusInput.pendingTask?.collectedSlots.programHint),
  readSlotString(focusInput.pendingTask?.collectedSlots.replacementHint),
  readSlotString(focusInput.pendingTask?.collectedSlots.targetProgramName),
  ...extractQuotedTerms(focusInput.userInput),
  ...extractChineseTerms(focusInput.userInput),
])

const buildScheduleFocusClocks = (focusInput: Exclude<FocusInput, undefined>): string[] => {
  const values = [
    readSlotString(focusInput.pendingTask?.collectedSlots.targetTime),
    readSlotString(focusInput.pendingTask?.collectedSlots.newStartTime),
    readSlotString(focusInput.pendingTask?.collectedSlots.rangeStart),
    readSlotString(focusInput.pendingTask?.collectedSlots.rangeEnd),
    ...extractClockTerms(focusInput.userInput),
  ].filter((value): value is string => Boolean(value))
  return [...new Set(values.map((value) => normalizeClock(value)).filter((value): value is string => Boolean(value)))]
}

const readSlotString = (slot: unknown): string | undefined => {
  if (!slot || typeof slot !== 'object') return undefined
  const value = (slot as { value?: unknown }).value
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

const extractQuotedTerms = (value: string): string[] => {
  const matches = [...value.matchAll(/[《“"]([^》”"]{2,})[》”"]/gu)]
  return matches.map((match) => match[1] ?? '')
}

const extractChineseTerms = (value: string): string[] => {
  const cleaned = value
    .replace(/\d{1,2}[:：]\d{1,2}(?::\d{1,2})?/gu, ' ')
    .replace(/\d{1,2}点(?:\d{1,2}分?)?/gu, ' ')
    .replace(/[^\p{Script=Han}A-Za-z0-9]+/gu, ' ')
    .trim()
  return cleaned
    .split(/\s+/u)
    .map((term) => term.replace(/^(?:请|帮我|把|将|在|到|的|要|想|确认|执行|删除|移动|移到|插入|替换|换成|节目|素材|候选)+/u, ''))
    .map((term) => term.replace(/(?:节目|素材|候选|一下|确认|执行)$/u, ''))
    .filter((term) => term.length >= 2)
}

const extractClockTerms = (value: string): string[] => [
  ...[...value.matchAll(/\d{1,2}[:：]\d{1,2}(?::\d{1,2})?/gu)].map((match) => match[0]),
  ...[...value.matchAll(/\d{1,2}点(?:\d{1,2}分?)?/gu)].map((match) => match[0]),
]

const uniqueFocusTerms = (values: Array<string | undefined>): string[] => {
  const terms = values
    .map((value) => normalizeFocusText(value ?? ''))
    .filter((value) => value.length >= 2)
  return [...new Set(terms)].slice(0, 8)
}

const normalizeFocusText = (value: string): string => value
  .trim()
  .toLowerCase()
  .replace(/\s+/g, '')
  .replace(/[《》"'“”‘’、，。！？；：,.!?;:()[\]【】_-]/gu, '')

const normalizeClock = (value: string): string | undefined => {
  const normalized = value.trim().replace('：', ':')
  const colonMatch = /^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/u.exec(normalized)
  if (colonMatch) {
    const hours = Number(colonMatch[1])
    const minutes = Number(colonMatch[2])
    const seconds = Number(colonMatch[3] ?? 0)
    if (hours <= 23 && minutes <= 59 && seconds <= 59) {
      return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    }
  }
  const pointMatch = /^(\d{1,2})点(?:(\d{1,2})分?)?$/u.exec(normalized)
  if (pointMatch) {
    const hours = Number(pointMatch[1])
    const minutes = Number(pointMatch[2] ?? 0)
    if (hours <= 23 && minutes <= 59) {
      return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`
    }
  }
  if (/^\d{4}-\d{2}-\d{2}T/u.test(normalized)) {
    return normalized.split('T')[1]?.slice(0, 8)
  }
  return undefined
}

const clockToSeconds = (value?: string): number | undefined => {
  const clock = value ? normalizeClock(value) : undefined
  if (!clock) return undefined
  const [hours = 0, minutes = 0, seconds = 0] = clock.split(':').map((part) => Number(part) || 0)
  return hours * 3600 + minutes * 60 + seconds
}
