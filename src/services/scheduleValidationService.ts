import type { ValidationReport } from '@/types/orchestration'
import { getDemoFixedItems } from '@/mock/demoData'
import { getAtomicCapabilities } from './atomicCapabilities'
import { validateSchedule } from './validators/validationEngine'

export class ScheduleValidationService {
  validateCurrentSchedule(scheduleDate: string, channelId: string): ValidationReport {
    const fixedItems = getDemoFixedItems(channelId, scheduleDate)
    const items = getAtomicCapabilities().getAllItems()

    return validateSchedule({
      items,
      gaps: [],
      fixedItems,
      layoutSlots: [],
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
