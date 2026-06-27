import type { ScheduleItem } from './scheduleData'
import type { ScheduleItemSnapshot } from '@/types/orchestration'

type TimeUtils = {
  normalizeClockText: (value: string) => string
  timeToSeconds: (value: string) => number
}

type PageToAtomicDeps = TimeUtils & {
  resolveScheduleItemProgramType: (item: Partial<ScheduleItem>) => string
}

type AtomicToPageDeps = {
  scheduleId: string
  formatPlayLengthText: (durationSeconds: number) => string
  formatRelativeStart: (seconds: number) => string
}

type ChatScheduleDeps = TimeUtils & {
  resolveScheduleItemProgramType: (item: Partial<ScheduleItem>) => string
}

export type ChatScheduleUpdateItem = {
  id: string
  programCode?: string
  programName?: string
  startTime: string
  endTime: string
  duration?: number
  programType?: string
  sequence?: number
  relativeStartSeconds?: number
}

export const formatAtomicDateTime = (value: Date): string => {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  const hours = String(value.getHours()).padStart(2, '0')
  const minutes = String(value.getMinutes()).padStart(2, '0')
  const seconds = String(value.getSeconds()).padStart(2, '0')
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}+08:00`
}

export const normalizeAtomicDateTime = (
  value: string,
  fallbackDate: string,
  dayOffset = 0,
): string => {
  if (value.includes('T')) {
    return /([zZ]|[+-]\d{2}:\d{2})$/.test(value) ? value : `${value}+08:00`
  }

  const normalizedClock = value.length === 5 ? `${value}:00` : value
  const baseDate = new Date(`${fallbackDate}T00:00:00+08:00`)
  baseDate.setDate(baseDate.getDate() + dayOffset)
  const [hours = 0, minutes = 0, seconds = 0] = normalizedClock
    .split(':')
    .map((part) => parseInt(part || '0', 10) || 0)
  baseDate.setHours(hours, minutes, seconds, 0)
  return formatAtomicDateTime(baseDate)
}

export const buildAtomicTimeRange = (
  date: string,
  startTime: string,
  endTime: string,
  { normalizeClockText, timeToSeconds }: TimeUtils,
): {
  normalizedStartTime: string
  normalizedEndTime: string
  duration: number
} => {
  const startClock = normalizeClockText(startTime)
  const endClock = normalizeClockText(endTime)
  const startSeconds = timeToSeconds(startClock)
  const endSeconds = timeToSeconds(endClock)
  const endDayOffset = endSeconds <= startSeconds ? 1 : 0
  const normalizedStartTime = normalizeAtomicDateTime(startTime, date)
  const normalizedEndTime = normalizeAtomicDateTime(endTime, date, endDayOffset)
  const duration = Math.max(
    60,
    Math.floor((new Date(normalizedEndTime).getTime() - new Date(normalizedStartTime).getTime()) / 1000),
  )

  return {
    normalizedStartTime,
    normalizedEndTime,
    duration,
  }
}

export const mapPageItemToAtomicSnapshot = (
  item: ScheduleItem,
  index: number,
  date: string,
  deps: PageToAtomicDeps,
): ScheduleItemSnapshot => {
  const timeRange = buildAtomicTimeRange(date, item.startTime, item.endTime, deps)

  return {
    id: item.id,
    programCode: item.programCode || item.code18 || '',
    programName: item.programName || item.instanceName || '未命名节目',
    startTime: timeRange.normalizedStartTime,
    endTime: timeRange.normalizedEndTime,
    duration: timeRange.duration,
    programType: deps.resolveScheduleItemProgramType(item),
    sequence: index + 1,
    relativeStartSeconds: deps.timeToSeconds(item.relativeStart || '00:00:00'),
  }
}

export const mapAtomicItemToPageItem = (
  item: ScheduleItemSnapshot,
  index: number,
  deps: AtomicToPageDeps,
): ScheduleItem => ({
  id: item.id,
  scheduleId: deps.scheduleId,
  startTime: item.startTime.split('T')[1]?.slice(0, 8) || item.startTime,
  endTime: item.endTime.split('T')[1]?.slice(0, 8) || item.endTime,
  programType: item.programType,
  instanceName: item.programName,
  programName: item.programName,
  businessType: item.programType === 'ad' ? 'ad' : 'program',
  sourceType: item.programType === 'live' ? 'live' : 'record',
  sortOrder: index + 1,
  duration: Math.max(0, item.duration / 60),
  programCode: item.programCode,
  code18: item.programCode,
  materialStatus: item.programType === 'ad' ? 'pending' : 'ready',
  materialName: item.programType === 'ad'
    ? '待广告系统下发'
    : item.programCode
      ? `${item.programCode}-MAT`
      : '',
  playLength: deps.formatPlayLengthText(item.duration),
  relativeStart: deps.formatRelativeStart(item.relativeStartSeconds ?? 0),
  remark: '',
})

export const mapChatScheduleUpdateItemToAtomicSnapshot = (
  item: ChatScheduleUpdateItem,
  index: number,
  date: string,
  deps: TimeUtils,
): ScheduleItemSnapshot => {
  const timeRange = buildAtomicTimeRange(date, item.startTime, item.endTime, deps)
  const duration = typeof item.duration === 'number'
    ? item.duration
    : timeRange.duration

  return {
    id: item.id,
    programCode: item.programCode ?? item.id,
    programName: item.programName || item.programCode || item.id,
    startTime: timeRange.normalizedStartTime,
    endTime: timeRange.normalizedEndTime,
    duration,
    programType: item.programType || 'program',
    sequence: item.sequence ?? index + 1,
    relativeStartSeconds: item.relativeStartSeconds ?? 0,
  }
}

export const mapScheduleItemToChatSchedule = (
  item: ScheduleItem,
  deps: ChatScheduleDeps,
): {
  id: string
  programCode: string
  programName: string
  startTime: string
  endTime: string
  duration: number
  programType: string
} => ({
  id: item.id,
  programCode: item.programCode || item.code18 || '',
  programName: item.programName || item.instanceName || '未命名节目',
  startTime: item.startTime,
  endTime: item.endTime,
  duration: Math.max(60, deps.timeToSeconds(item.endTime) - deps.timeToSeconds(item.startTime)),
  programType: deps.resolveScheduleItemProgramType(item),
})
