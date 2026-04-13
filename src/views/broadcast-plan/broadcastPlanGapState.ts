import type { ScheduleItem } from './scheduleData'
import type {
  GapProcessingStatus,
  OrchestrationProgress,
} from '@/types/orchestration'

export type TimeDiscontinuity = {
  id: string
  from: string
  to: string
  prevId: string
  nextId: string
  prevSortOrder: number
  nextSortOrder: number
}

export type GapEntry = TimeDiscontinuity & {
  source: 'manual' | 'runtime'
  status: GapProcessingStatus
  error?: string
}

export const buildTimeDiscontinuities = (
  items: ScheduleItem[],
  timeToSeconds: (time: string) => number,
  broadcastWindow?: {
    startTime: string
    endTime: string
  },
): TimeDiscontinuity[] => {
  const editableItems = items.filter((item) => !item.isReference)
  const result: TimeDiscontinuity[] = []

  if (broadcastWindow?.startTime && broadcastWindow?.endTime && editableItems.length === 0) {
    const windowStart = timeToSeconds(broadcastWindow.startTime)
    const windowEnd = timeToSeconds(broadcastWindow.endTime)

    if (windowEnd > windowStart) {
      result.push({
        id: 'broadcast-start-broadcast-end',
        from: broadcastWindow.startTime,
        to: broadcastWindow.endTime,
        prevId: '',
        nextId: '',
        prevSortOrder: 0,
        nextSortOrder: 1,
      })
    }

    return result
  }

  if (editableItems.length === 0) return result

  if (broadcastWindow?.startTime) {
    const firstItem = editableItems[0]
    if (firstItem?.startTime) {
      const windowStart = timeToSeconds(broadcastWindow.startTime)
      const firstStart = timeToSeconds(firstItem.startTime)

      if (firstStart > windowStart) {
        result.push({
          id: `broadcast-start-${firstItem.id}`,
          from: broadcastWindow.startTime,
          to: firstItem.startTime,
          prevId: '',
          nextId: firstItem.id,
          prevSortOrder: 0,
          nextSortOrder: firstItem.sortOrder || 1,
        })
      }
    }
  }

  for (let index = 0; index < editableItems.length - 1; index += 1) {
    const previousItem = editableItems[index]
    const nextItem = editableItems[index + 1]

    if (!previousItem?.endTime || !nextItem?.startTime) continue

    const previousEnd = timeToSeconds(previousItem.endTime)
    const nextStart = timeToSeconds(nextItem.startTime)

    if (nextStart <= previousEnd) continue

    result.push({
      id: `${previousItem.id}-${nextItem.id}`,
      from: previousItem.endTime,
      to: nextItem.startTime,
      prevId: previousItem.id,
      nextId: nextItem.id,
      prevSortOrder: previousItem.sortOrder || 0,
      nextSortOrder: nextItem.sortOrder || 0,
    })
  }

  if (broadcastWindow?.endTime) {
    const lastItem = editableItems[editableItems.length - 1]
    if (lastItem?.endTime) {
      const lastEnd = timeToSeconds(lastItem.endTime)
      const windowEnd = timeToSeconds(broadcastWindow.endTime)

      if (windowEnd > lastEnd) {
        result.push({
          id: `${lastItem.id}-broadcast-end`,
          from: lastItem.endTime,
          to: broadcastWindow.endTime,
          prevId: lastItem.id,
          nextId: '',
          prevSortOrder: lastItem.sortOrder || 0,
          nextSortOrder: (lastItem.sortOrder || 0) + 1,
        })
      }
    }
  }

  return result
}

export const buildRuntimeGapEntries = (
  progress: OrchestrationProgress | null,
  normalizeClockText: (time: string) => string,
): GapEntry[] => {
  if (!progress) return []

  return progress.liveGaps
    .filter((gap) => gap.status !== 'completed')
    .map((gap) => ({
      id: gap.id,
      from: normalizeClockText(gap.startTime),
      to: normalizeClockText(gap.endTime),
      prevId: gap.precedingItemId || '',
      nextId: gap.followingItemId || '',
      prevSortOrder: 0,
      nextSortOrder: 0,
      source: 'runtime',
      status: gap.status,
      error: gap.error,
    }))
}

export const buildDisplayGapEntries = (
  runtimeGapEntries: GapEntry[],
  timeDiscontinuities: TimeDiscontinuity[],
): GapEntry[] => {
  if (runtimeGapEntries.length > 0) {
    return runtimeGapEntries
  }

  return timeDiscontinuities.map((gap) => ({
    ...gap,
    source: 'manual' as const,
    status: 'pending' as const,
  }))
}

export const resolveGapSummaryLabel = (runtimeGapEntries: GapEntry[]): string =>
  runtimeGapEntries.length > 0 ? '待处理空窗' : '时间空缺'
