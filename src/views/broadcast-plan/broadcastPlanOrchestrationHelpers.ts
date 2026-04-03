import type { ScheduleState, TaskMode } from '@/types/orchestration'

export const buildOrchestrationScheduleState = (input: {
  channelId: string
  channelName: string
  date: string
  itemCount: number
  gapCount: number
  hasSelectedTimeRange?: boolean
}): ScheduleState => ({
  channelId: input.channelId,
  channelName: input.channelName,
  date: input.date,
  isEmpty: input.itemCount === 0,
  itemCount: input.itemCount,
  gapCount: input.gapCount,
  hasSelectedTimeRange: input.hasSelectedTimeRange ?? false,
})

export const shouldStartPartialGeneration = (mode: TaskMode, itemCount: number): boolean =>
  mode === 'partial_generate' && itemCount > 0
