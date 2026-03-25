import type { ScheduleState } from '@/types/orchestration'

export interface DialogueScheduleItem {
  id: string
  programCode?: string
  programName?: string
  startTime: string
  endTime: string
  duration?: number
  programType?: string
}

export interface DialogueContextInput {
  scheduleState: ScheduleState
  userInput: string
  currentSchedule: DialogueScheduleItem[]
}

export interface DialogueContext {
  scheduleState: ScheduleState
  userInput: string
  currentSchedule: DialogueScheduleItem[]
  scheduleSummary: string
}

export function buildDialogueContext(input: DialogueContextInput): DialogueContext {
  const scheduleSummary = input.currentSchedule.length
    ? input.currentSchedule
        .slice(0, 12)
        .map(
          (item, index) =>
            `${index + 1}. ${item.startTime}-${item.endTime} ${item.programName || item.programCode || item.id}`,
        )
        .join('\n')
    : '当前节目单为空'

  return {
    ...input,
    scheduleSummary,
  }
}
