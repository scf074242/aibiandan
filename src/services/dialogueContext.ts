import type { ScheduleState } from '@/types/orchestration'
import { parseAtomicClockExpressions } from '@/services/atomicTimeParser'

export interface DialogueScheduleItem {
  id: string
  programCode?: string
  programName?: string
  startTime: string
  endTime: string
  duration?: number
  programType?: string
}

export interface DialogueContextInput {
  scheduleState: ScheduleState
  userInput: string
  currentSchedule: DialogueScheduleItem[]
}

export interface DialogueContext {
  scheduleState: ScheduleState
  userInput: string
  currentSchedule: DialogueScheduleItem[]
  scheduleSummary: string
  scheduleNameCandidates: string
  nearbyScheduleSummary: string
  targetTimeHints: string[]
}

export function buildDialogueContext(input: DialogueContextInput): DialogueContext {
  const scheduleSummary = input.currentSchedule.length
    ? input.currentSchedule
        .slice(0, 12)
        .map(
          (item, index) =>
            `${index + 1}. ${item.startTime}-${item.endTime} ${item.programName || item.programCode || item.id}`,
        )
        .join('\n')
    : '当前节目单为空'

  const targetTimeHints = extractTargetTimeHints(input.userInput)
  const nearbyScheduleSummary = buildNearbyScheduleSummary(input.currentSchedule, targetTimeHints)
  const scheduleNameCandidates = buildScheduleNameCandidates(input.currentSchedule)

  return {
    ...input,
    scheduleSummary,
    scheduleNameCandidates,
    nearbyScheduleSummary,
    targetTimeHints,
  }
}

function extractTargetTimeHints(userInput: string): string[] {
  const hints = new Set<string>(
    parseAtomicClockExpressions(userInput).map((item) => item.targetTime),
  )

  return Array.from(hints).slice(0, 3)
}

function buildNearbyScheduleSummary(
  schedule: DialogueScheduleItem[],
  targetTimeHints: string[],
): string {
  if (!schedule.length) return '当前节目单为空，没有可参考的附近节目。'
  if (!targetTimeHints.length) return '未从用户输入中识别到明确时间点。'

  const nearbyItems = new Map<string, DialogueScheduleItem>()

  for (const targetTime of targetTimeHints) {
    const targetSeconds = timeToSeconds(targetTime)
    for (const item of schedule) {
      const start = normalizeClock(item.startTime)
      const end = normalizeClock(item.endTime)
      const startSeconds = timeToSeconds(start)
      const endSeconds = timeToSeconds(end)
      const isCovering = startSeconds <= targetSeconds && targetSeconds < endSeconds
      const isNearby =
        Math.abs(startSeconds - targetSeconds) <= 1800 || Math.abs(endSeconds - targetSeconds) <= 1800

      if (isCovering || isNearby) {
        nearbyItems.set(item.id, item)
      }
    }
  }

  if (nearbyItems.size === 0) {
    return `未找到 ${targetTimeHints.join('、')} 附近的节目。`
  }

  return Array.from(nearbyItems.values())
    .sort((a, b) => timeToSeconds(normalizeClock(a.startTime)) - timeToSeconds(normalizeClock(b.startTime)))
    .slice(0, 6)
    .map(
      (item, index) =>
        `${index + 1}. ${normalizeClock(item.startTime)}-${normalizeClock(item.endTime)} ${item.programName || item.programCode || item.id}`,
    )
    .join('\n')
}

function buildScheduleNameCandidates(schedule: DialogueScheduleItem[]): string {
  const candidates = Array.from(
    new Set(
      schedule
        .map((item) => item.programName?.trim())
        .filter((name): name is string => Boolean(name)),
    ),
  )

  if (candidates.length === 0) {
    return '当前节目单为空，没有可参考的节目名候选。'
  }

  return candidates.slice(0, 20).join('、')
}

function normalizeClock(timeText: string): string {
  if (timeText.includes('T')) {
    return timeText.split('T')[1]?.slice(0, 8) || timeText
  }

  if (/^\d{2}:\d{2}$/.test(timeText)) {
    return `${timeText}:00`
  }

  return timeText
}

function timeToSeconds(timeText: string): number {
  const [hours = 0, minutes = 0, seconds = 0] = normalizeClock(timeText).split(':').map(Number)
  return hours * 3600 + minutes * 60 + seconds
}
