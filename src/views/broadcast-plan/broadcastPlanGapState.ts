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
): TimeDiscontinuity[] => {
  const editableItems = items.filter((item) => !item.isReference)
  if (editableItems.length < 2) return []

  const result: TimeDiscontinuity[] = []

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
