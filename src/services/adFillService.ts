import { getOrchestrationDemoColumn } from '@/mock/orchestrationMock'
import type { GapInfo, LayoutReference, ScheduleItemSnapshot } from '@/types/orchestration'

const AD_DURATIONS = [1800, 900, 300]
const ALLOWED_SLOT_TYPES = new Set(['drama', 'entertainment', 'variety'])

export interface AdFillResult {
  success: boolean
  items: ScheduleItemSnapshot[]
  reason?: string
}

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

const findPrimarySlotType = (gap: GapInfo, layoutReference?: LayoutReference): string | undefined => {
  if (gap.constraints.allowedTypes?.length) {
    return gap.constraints.allowedTypes[0]
  }

  const matchedSlot = layoutReference?.slots.find((slot) => slot.startTime <= gap.startTime && slot.endTime >= gap.endTime)
  return matchedSlot?.columnId ? getOrchestrationDemoColumn(matchedSlot.columnId)?.defaultProgramType : undefined
}

export function canAutoInsertAd(gap: GapInfo, layoutReference?: LayoutReference): boolean {
  const slotType = findPrimarySlotType(gap, layoutReference)
  return Boolean(slotType && ALLOWED_SLOT_TYPES.has(slotType))
}

export function resolveAdFillPlan(remainingSeconds: number): number[] | null {
  if (remainingSeconds <= 0) return null

  const plan: number[] = []
  let balance = remainingSeconds

  for (const duration of AD_DURATIONS) {
    while (balance >= duration) {
      plan.push(duration)
      balance -= duration
    }
  }

  return balance === 0 && plan.length > 0 ? plan : null
}

export function createAdFillItems(gap: GapInfo, durations: number[], sequenceStart: number): ScheduleItemSnapshot[] {
  let currentStart = gap.startTime

  return durations.map((duration, index) => {
    const currentEnd = addSeconds(currentStart, duration)
    const durationMinutes = Math.round(duration / 60)
    const sequence = sequenceStart + index
    const item: ScheduleItemSnapshot = {
      id: `ad_fill_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 8)}`,
      programCode: `AD-${durationMinutes}M-${String(sequence).padStart(3, '0')}`,
      programName: '广告',
      startTime: currentStart,
      endTime: currentEnd,
      duration,
      programType: 'ad',
      sequence,
    }

    currentStart = currentEnd
    return item
  })
}

export function tryBuildAdFillItems(
  gap: GapInfo,
  layoutReference: LayoutReference | undefined,
  sequenceStart: number,
): AdFillResult {
  if (!canAutoInsertAd(gap, layoutReference)) {
    return { success: false, items: [], reason: 'slot_not_allowed' }
  }

  const plan = resolveAdFillPlan(gap.duration)
  if (!plan) {
    return { success: false, items: [], reason: 'duration_not_match' }
  }

  return {
    success: true,
    items: createAdFillItems(gap, plan, sequenceStart),
  }
}
