import type { ReplaceCommand, ValidationReport } from '@/types/orchestration'
import { getAtomicCapabilities } from './atomicCapabilities'
import { getCandidateService } from './candidateService'
import { getScheduleValidationService } from './scheduleValidationService'

export interface ReplaceExecutionResult {
  success: boolean
  message: string
  error?: string
  validationReport?: ValidationReport
}

export class ReplaceCommandExecutor {
  async execute(command: ReplaceCommand, context: { scheduleDate: string; channelId: string }): Promise<ReplaceExecutionResult> {
    const { itemId, newCandidateId } = command.data
    const atomicCapabilities = getAtomicCapabilities()
    const currentItem = atomicCapabilities.getItem(itemId)

    if (!currentItem) {
      return {
        success: false,
        message: `条目不存在 ${itemId}`,
      }
    }

    const candidate = getCandidateService().getCandidateById(newCandidateId)
    if (!candidate) {
      return {
        success: false,
        message: `未找到替换候选节目 ${newCandidateId}`,
      }
    }

    const replacedItem = {
      ...currentItem,
      programCode: candidate.programCode,
      programName: candidate.programName,
      programType: candidate.programType,
      duration: candidate.duration,
      endTime: this.calculateEndTime(currentItem.startTime, candidate.duration),
    }

    const result = await atomicCapabilities.replaceItem(itemId, replacedItem)
    if (!result.success) {
      return {
        success: false,
        message: `替换失败: ${result.error}`,
      }
    }

    const validationReport = getScheduleValidationService().validateCurrentSchedule(context.scheduleDate, context.channelId)
    return {
      success: true,
      message: `已替换节目为 ${candidate.programName}`,
      validationReport,
    }
  }

  private calculateEndTime(startTime: string, durationSeconds: number): string {
    const start = new Date(startTime).getTime()
    return this.formatLocalDateTime(start + durationSeconds * 1000)
  }

  private formatLocalDateTime(timestampMs: number): string {
    const date = new Date(timestampMs)
    const year = date.getFullYear()
    const month = `${date.getMonth() + 1}`.padStart(2, '0')
    const day = `${date.getDate()}`.padStart(2, '0')
    const hours = `${date.getHours()}`.padStart(2, '0')
    const minutes = `${date.getMinutes()}`.padStart(2, '0')
    const seconds = `${date.getSeconds()}`.padStart(2, '0')
    return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}+08:00`
  }
}

let globalReplaceCommandExecutor: ReplaceCommandExecutor | null = null

export function getReplaceCommandExecutor(): ReplaceCommandExecutor {
  if (!globalReplaceCommandExecutor) {
    globalReplaceCommandExecutor = new ReplaceCommandExecutor()
  }
  return globalReplaceCommandExecutor
}
