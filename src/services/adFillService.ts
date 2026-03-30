import { getEffectiveColumnDefinition } from '@/services/orchestration/runtimeLayoutRegistry'
import type {
  AdInsertionOpportunity,
  AdInsertionPlan,
  FixedItem,
  LayoutReference,
  LayoutSlot,
  ScheduleItemSnapshot,
} from '@/types/orchestration'

const AD_DURATIONS = [1800, 900, 300]
const ALLOWED_SLOT_TYPES = new Set(['drama', 'entertainment', 'variety'])

const formatDateTime = (value: Date): string => {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  const hours = String(value.getHours()).padStart(2, '0')
  const minutes = String(value.getMinutes()).padStart(2, '0')
  const seconds = String(value.getSeconds()).padStart(2, '0')
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}+08:00`
}

const addSeconds = (dateTime: string, seconds: number): string => {
  const next = new Date(new Date(dateTime).getTime() + seconds * 1000)
  return formatDateTime(next)
}

const toMs = (value: string) => new Date(value).getTime()

const isAdItem = (item: ScheduleItemSnapshot) => item.programType === 'ad'

const isSameProgramType = (left: ScheduleItemSnapshot, right: ScheduleItemSnapshot) =>
  left.programType === right.programType && !isAdItem(left) && !isAdItem(right)

const findSlotType = (slot: LayoutSlot): string | undefined =>
  slot.columnId ? getEffectiveColumnDefinition(slot.columnId)?.defaultProgramType : undefined

const isAllowedSlot = (slot: LayoutSlot) => {
  const slotType = findSlotType(slot)
  return Boolean(slotType && ALLOWED_SLOT_TYPES.has(slotType))
}

const getItemsInSlot = (items: ScheduleItemSnapshot[], slot: LayoutSlot) =>
  items
    .filter((item) => toMs(item.startTime) >= toMs(slot.startTime) && toMs(item.endTime) <= toMs(slot.endTime))
    .sort((a, b) => toMs(a.startTime) - toMs(b.startTime))

const createAdItem = (
  slot: LayoutSlot,
  insertAt: string,
  durationSeconds: number,
  sequence: number,
): ScheduleItemSnapshot => {
  const startTime = insertAt
  const endTime = addSeconds(startTime, durationSeconds)
  const durationMinutes = Math.round(durationSeconds / 60)
  const slotSuffix = slot.id.replace(/[^a-zA-Z0-9]/g, '').slice(-8) || 'slot'

  return {
    id: `ad_external_${Date.now()}_${slotSuffix}_${Math.random().toString(36).slice(2, 8)}`,
    programCode: `AD-${durationMinutes}M-${String(sequence).padStart(3, '0')}`,
    programName: '广告',
    startTime,
    endTime,
    duration: durationSeconds,
    programType: 'ad',
    sequence,
    relativeStartSeconds: 0,
  }
}

const canShiftWithoutBreakingFixedItems = (
  shiftedItems: ScheduleItemSnapshot[],
  fixedItems: FixedItem[],
): boolean => {
  if (fixedItems.length === 0) return true

  const fixedRanges = fixedItems.map((item) => ({
    programCode: item.programCode,
    startMs: toMs(item.startTime),
    endMs: toMs(item.endTime),
  }))

  return shiftedItems.every((item) => {
    const startMs = toMs(item.startTime)
    const endMs = toMs(item.endTime)
    return !fixedRanges.some((fixed) => {
      const overlaps = startMs < fixed.endMs && endMs > fixed.startMs
      const sameRecord = item.programCode === fixed.programCode
      return overlaps && !sameRecord
    })
  })
}

export function collectAdInsertionOpportunities(
  layoutReference: LayoutReference | undefined,
  items: ScheduleItemSnapshot[],
): AdInsertionOpportunity[] {
  if (!layoutReference) return []

  const opportunities: AdInsertionOpportunity[] = []

  for (const slot of layoutReference.slots) {
    if (!isAllowedSlot(slot)) continue

    const slotItems = getItemsInSlot(items, slot)
    const nonAdItems = slotItems.filter((item) => !isAdItem(item))
    if (nonAdItems.length === 0) continue

    const slotStartMs = toMs(slot.startTime)
    const slotEndMs = toMs(slot.endTime)

    const firstItem = slotItems[0]
    if (firstItem && !isAdItem(firstItem)) {
      const availableSeconds = Math.floor((toMs(firstItem.startTime) - slotStartMs) / 1000)
      if (availableSeconds >= 0) {
        opportunities.push({
          slotId: slot.id,
          slotStartTime: slot.startTime,
          slotEndTime: slot.endTime,
          insertAt: slot.startTime,
          availableSeconds,
          position: 'before_first',
          nextItemId: firstItem.id,
        })
      }
    }

    for (let index = 0; index < slotItems.length - 1; index += 1) {
      const current = slotItems[index]
      const next = slotItems[index + 1]
      if (!current || !next) continue
      if (!isSameProgramType(current, next)) continue

      const availableSeconds = Math.floor((toMs(next.startTime) - toMs(current.endTime)) / 1000)
      if (availableSeconds < 0) continue

      opportunities.push({
        slotId: slot.id,
        slotStartTime: slot.startTime,
        slotEndTime: slot.endTime,
        insertAt: current.endTime,
        availableSeconds,
        position: 'between_items',
        previousItemId: current.id,
        nextItemId: next.id,
      })
    }

    const lastItem = slotItems[slotItems.length - 1]
    if (lastItem && !isAdItem(lastItem)) {
      const availableSeconds = Math.floor((slotEndMs - toMs(lastItem.endTime)) / 1000)
      if (availableSeconds > 0) {
        opportunities.push({
          slotId: slot.id,
          slotStartTime: slot.startTime,
          slotEndTime: slot.endTime,
          insertAt: lastItem.endTime,
          availableSeconds,
          position: 'after_last',
          previousItemId: lastItem.id,
        })
      }
    }
  }

  return opportunities.sort((a, b) => toMs(a.insertAt) - toMs(b.insertAt))
}

export function selectAdDurationForOpportunity(opportunity: AdInsertionOpportunity): number | null {
  return AD_DURATIONS.find((duration) => duration <= opportunity.availableSeconds) ?? null
}

const resolveMaximumInsertableSeconds = (
  opportunity: AdInsertionOpportunity,
  slotItems: ScheduleItemSnapshot[],
): number => {
  if (slotItems.length === 0) return 0

  if (opportunity.position === 'after_last') {
    return opportunity.availableSeconds
  }

  const lastItem = slotItems[slotItems.length - 1]
  if (!lastItem) return opportunity.availableSeconds

  const tailSlack = Math.max(0, Math.floor((toMs(opportunity.slotEndTime) - toMs(lastItem.endTime)) / 1000))
  return opportunity.availableSeconds + tailSlack
}

export function buildAdInsertionPlan(
  opportunity: AdInsertionOpportunity,
  slot: LayoutSlot,
  allItems: ScheduleItemSnapshot[],
  fixedItems: FixedItem[],
): AdInsertionPlan | null {
  const slotItems = getItemsInSlot(allItems, slot)
  const maximumInsertableSeconds = resolveMaximumInsertableSeconds(opportunity, slotItems)
  const durationSeconds =
    AD_DURATIONS.find((duration) => duration <= maximumInsertableSeconds) ?? null
  if (!durationSeconds) return null

  const insertAtMs = toMs(opportunity.insertAt)
  const slotEndMs = toMs(slot.endTime)
  const adGapSeconds = Math.max(0, opportunity.availableSeconds)
  const shiftSeconds = Math.max(0, durationSeconds - adGapSeconds)

  const slotItemsAfterInsert = slotItems.filter((item) => toMs(item.startTime) >= insertAtMs)
  const shiftedItems = slotItemsAfterInsert.map((item) => ({
    ...item,
    startTime: addSeconds(item.startTime, shiftSeconds),
    endTime: addSeconds(item.endTime, shiftSeconds),
  }))

  if (shiftedItems.some((item) => toMs(item.endTime) > slotEndMs)) {
    return null
  }

  if (!canShiftWithoutBreakingFixedItems(shiftedItems, fixedItems)) {
    return null
  }

  const sequenceBase = allItems.length + 1
  const adItem = createAdItem(slot, opportunity.insertAt, durationSeconds, sequenceBase)
  const affectedItemIds = [adItem.id, ...shiftedItems.map((item) => item.id)]

  return {
    slotId: slot.id,
    opportunity,
    adItem,
    shiftedItems,
    affectedItemIds,
    durationSeconds,
  }
}

export function applyAdInsertionPlan(
  plan: AdInsertionPlan,
  allItems: ScheduleItemSnapshot[],
): ScheduleItemSnapshot[] {
  const shiftedMap = new Map(plan.shiftedItems.map((item) => [item.id, item]))
  const updatedItems = allItems
    .map((item) => shiftedMap.get(item.id) ?? item)
    .concat(plan.adItem)
    .sort((a, b) => toMs(a.startTime) - toMs(b.startTime))
    .map((item, index) => ({
      ...item,
      sequence: index + 1,
    }))

  return updatedItems
}
