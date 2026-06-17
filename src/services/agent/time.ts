import type { ScheduleItemSnapshot, TimeRange } from '@/types/orchestration'

export const toClockText = (value: string): string => {
  if (value.includes('T')) return value.split('T')[1]?.slice(0, 8) ?? value
  return value.length === 5 ? `${value}:00` : value
}

export const normalizeDateTime = (date: string, value: string): string => {
  if (value.includes('T')) {
    return value.includes('+08:00') ? value : `${value}+08:00`
  }
  return `${date}T${toClockText(value)}+08:00`
}

export const offsetDateTime = (dateTime: string, offsetSeconds: number): string => {
  const source = new Date(dateTime)
  const next = new Date(source.getTime() + offsetSeconds * 1000)
  return [
    next.getFullYear(),
    '-',
    `${next.getMonth() + 1}`.padStart(2, '0'),
    '-',
    `${next.getDate()}`.padStart(2, '0'),
    'T',
    `${next.getHours()}`.padStart(2, '0'),
    ':',
    `${next.getMinutes()}`.padStart(2, '0'),
    ':',
    `${next.getSeconds()}`.padStart(2, '0'),
    '+08:00',
  ].join('')
}

export const normalizeItemDateTimes = (item: ScheduleItemSnapshot, date: string): ScheduleItemSnapshot => ({
  ...item,
  startTime: normalizeDateTime(date, item.startTime),
  endTime: normalizeDateTime(date, item.endTime),
})

export const rangeOverlaps = (
  leftStart: string,
  leftEnd: string,
  rightStart: string,
  rightEnd: string,
): boolean => {
  const leftStartTs = new Date(leftStart).getTime()
  const leftEndTs = new Date(leftEnd).getTime()
  const rightStartTs = new Date(rightStart).getTime()
  const rightEndTs = new Date(rightEnd).getTime()
  return leftStartTs < rightEndTs && rightStartTs < leftEndTs
}

export const timeRangeToDateTimeRange = (range: TimeRange, date: string): TimeRange => ({
  start: normalizeDateTime(date, range.start),
  end: normalizeDateTime(date, range.end),
})

export const sortScheduleItems = (items: ScheduleItemSnapshot[]): ScheduleItemSnapshot[] => (
  [...items].sort((left, right) => new Date(left.startTime).getTime() - new Date(right.startTime).getTime())
)
