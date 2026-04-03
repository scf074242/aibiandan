import type { ScheduleItem } from './scheduleData'
import type { TimeDiscontinuity } from './broadcastPlanGapState'

export type GapDialogDefaults = {
  startTime: string
  endTime: string
  sortOrder: number
}

type NormalizeScheduleItemDeps = {
  generateId: () => string
  resolveScheduleItemProgramType: (item: Partial<ScheduleItem>) => string
  normalizeClockText: (value: string) => string
  formatRelativeStart: (seconds?: number) => string
  formatPlayLengthText: (durationSeconds: number) => string
  timeToSeconds: (time: string) => number
}

export const buildGapDialogDefaults = (gap: TimeDiscontinuity): GapDialogDefaults => {
  const previousSortOrder = gap.prevSortOrder
  const nextSortOrder = gap.nextSortOrder
  const sortOrder = nextSortOrder > previousSortOrder
    ? (previousSortOrder + nextSortOrder) / 2
    : previousSortOrder + 0.5

  return {
    startTime: gap.from,
    endTime: gap.to,
    sortOrder,
  }
}

export const normalizeScheduleItemForSave = (
  item: Partial<ScheduleItem>,
  deps: NormalizeScheduleItemDeps,
): ScheduleItem => {
  const resolvedProgramType = deps.resolveScheduleItemProgramType(item)
  const normalizedEndTime = deps.normalizeClockText(item.endTime || '')
  const normalizedStartTime = deps.normalizeClockText(item.startTime || '')
  const durationSeconds = Math.max(60, deps.timeToSeconds(normalizedEndTime) - deps.timeToSeconds(normalizedStartTime))

  return {
    ...item,
    id: item.id || deps.generateId(),
    programType: resolvedProgramType,
    startTime: normalizedStartTime,
    endTime: normalizedEndTime,
    relativeStart: item.relativeStart || deps.formatRelativeStart(),
    playLength: item.playLength || deps.formatPlayLengthText(durationSeconds),
    materialStatus: item.materialStatus || (resolvedProgramType === 'ad' ? 'pending' : item.materialStatus),
    materialName:
      item.materialName
      || (resolvedProgramType === 'ad' ? '待广告系统下发' : item.programCode ? `${item.programCode}-MAT` : ''),
  }
}

export const buildInsertableScheduleItem = (
  item: ScheduleItem,
  gapDialogDefaults: GapDialogDefaults | null,
  scheduleId: string,
): ScheduleItem => ({
  ...item,
  sortOrder: gapDialogDefaults?.sortOrder ?? item.sortOrder,
  startTime: item.startTime || gapDialogDefaults?.startTime || item.startTime,
  endTime: item.endTime || gapDialogDefaults?.endTime || item.endTime,
  scheduleId,
})
