import type { ValidationReport } from '@/types/orchestration'
import { demoFixedItems, demoLayouts } from '@/mock/demoData'
import { getAtomicCapabilities } from './atomicCapabilities'
import { validateSchedule } from './validators/validationEngine'

export class ScheduleValidationService {
  validateCurrentSchedule(scheduleDate: string, channelId: string): ValidationReport {
    const layoutKey = `${channelId}_${scheduleDate}`
    const layout = demoLayouts[layoutKey]
    const fixedItems = demoFixedItems[layoutKey] || []
    const items = getAtomicCapabilities().getAllItems()

    return validateSchedule({
      items,
      gaps: [],
      fixedItems,
      layoutSlots: layout?.slots || [],
      dayStartTime: `${scheduleDate}T06:00:00`,
      dayEndTime: `${scheduleDate}T23:59:59`,
    })
  }
}

let globalScheduleValidationService: ScheduleValidationService | null = null

export function getScheduleValidationService(): ScheduleValidationService {
  if (!globalScheduleValidationService) {
    globalScheduleValidationService = new ScheduleValidationService()
  }
  return globalScheduleValidationService
}
