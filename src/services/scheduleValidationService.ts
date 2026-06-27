import type { ValidationReport } from '@/types/orchestration'
import { getAtomicCapabilities } from './atomicCapabilities'
import { validateSchedule } from './validators/validationEngine'

export class ScheduleValidationService {
  validateCurrentSchedule(scheduleDate: string, channelId: string): ValidationReport {
    void scheduleDate
    void channelId
    const items = getAtomicCapabilities().getAllItems()

    return validateSchedule({
      items,
      gaps: [],
      fixedItems: [],
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
