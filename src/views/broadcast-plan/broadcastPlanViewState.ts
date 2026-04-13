import type { LayoutReferenceItem } from './layoutReferenceData'
import type { ScheduleItem } from './scheduleData'
import type { LayoutDraft } from '@/types/orchestration'

type ReferenceItemDeps = {
  normalizeDemoDisplayName: (name?: string) => string
  getTimeDiff: (startTime: string, endTime: string) => number
}

export const sortScheduleItems = (
  items: ScheduleItem[],
  timeToMinutes: (time: string) => number,
): ScheduleItem[] => {
  return [...items].sort((left, right) => {
    if (left.sortOrder !== right.sortOrder) {
      return (left.sortOrder || 0) - (right.sortOrder || 0)
    }
    return timeToMinutes(left.startTime) - timeToMinutes(right.startTime)
  })
}

export const buildReferenceItems = (
  references: LayoutReferenceItem[],
  deps: ReferenceItemDeps,
): ScheduleItem[] => {
  return references.map((reference, index): ScheduleItem => ({
    id: `ref-${index}`,
    scheduleId: '',
    startTime: `${reference.startTime}:00`,
    endTime: `${reference.endTime}:00`,
    programType: reference.programType,
    instanceName: deps.normalizeDemoDisplayName(reference.programName),
    indexingSheetCode: `IDX${reference.code18 || String(index + 1).padStart(6, '0')}`,
    materialStatus: 'ready',
    businessType: reference.type,
    programName: deps.normalizeDemoDisplayName(reference.programName),
    sourceType: reference.sourceType,
    remark: reference.remark || '',
    sortOrder: index,
    duration: deps.getTimeDiff(reference.startTime || '', reference.endTime || ''),
    isReference: true,
    code18: reference.code18 || '',
  }))
}

export const buildLayoutDraftItems = (
  draft: LayoutDraft,
  deps: ReferenceItemDeps,
): ScheduleItem[] => {
  const sortedSlots = [...draft.layoutReference.slots].sort((left, right) =>
    left.startTime.localeCompare(right.startTime),
  )

  return sortedSlots.map((slot, index): ScheduleItem => {
    const column = draft.columns.find((item) => item.columnId === slot.columnId)
    const startTime = slot.startTime.split('T')[1]?.slice(0, 8) ?? draft.coverage.start
    const endTime = slot.endTime.split('T')[1]?.slice(0, 8) ?? draft.coverage.end
    const label = column?.semanticLabel ?? column?.columnName ?? `时段${index + 1}`

    return {
      id: `draft-${slot.id}`,
      scheduleId: '',
      startTime,
      endTime,
      programType: column?.defaultProgramType,
      instanceName: deps.normalizeDemoDisplayName(label),
      materialStatus: 'ready',
      businessType: 'program',
      programName: deps.normalizeDemoDisplayName(label),
      sourceType: 'imported',
      remark: column?.queryHints?.join(' / ') ?? '',
      sortOrder: index,
      duration: deps.getTimeDiff(startTime, endTime),
      isReference: true,
      keySlot: label,
    }
  })
}

export const selectDisplayItems = (
  showLayoutReference: boolean,
  referenceItems: ScheduleItem[],
  sortedItems: ScheduleItem[],
): ScheduleItem[] => (showLayoutReference ? referenceItems : sortedItems)

export const countUnlinkedItems = (items: ScheduleItem[]): number =>
  items.filter((item) => item.isUnlinkedProduct).length

export const countEmptyMaterialItems = (
  items: ScheduleItem[],
  shouldWarnEmptyMaterialFields: (item: ScheduleItem) => boolean,
): number => items.filter((item) => shouldWarnEmptyMaterialFields(item)).length
