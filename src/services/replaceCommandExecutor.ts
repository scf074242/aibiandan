import type { ReplaceCommand, ValidationReport } from '@/types/orchestration'
import { getAtomicCapabilities } from './atomicCapabilities'
import { getCandidateService } from './candidateService'
import { getScheduleValidationService } from './scheduleValidationService'

export interface ReplaceExecutionResult {
  success: boolean
  message: string
  error?: string
  validationReport?: ValidationReport
  data?: unknown
  affectedItems?: string[]
  affectedTimeRanges?: { start: string; end: string }[]
}

export interface ReplacePreviewResult {
  canExecute: boolean
  warnings: string[]
  timeRange?: { start: string; end: string }
}

export class ReplaceCommandExecutor {
  preview(command: ReplaceCommand): ReplacePreviewResult {
    const { itemId, newCandidateId } = command.data
    const atomicCapabilities = getAtomicCapabilities()
    const currentItem = atomicCapabilities.getItem(itemId)

    if (!currentItem) {
      return {
        canExecute: false,
        warnings: [`未找到待替换节目 ${itemId}`],
      }
    }

    const candidate = getCandidateService().getCandidateById(newCandidateId)
    if (!candidate) {
      return {
        canExecute: false,
        warnings: [`未找到替换候选节目 ${newCandidateId}`],
      }
    }

    const nextEndTime = this.calculateEndTime(currentItem.startTime, candidate.duration)
    const canExecute = atomicCapabilities.isTimeRangeAvailable(currentItem.startTime, nextEndTime, itemId)

    return {
      canExecute,
      warnings: canExecute ? [] : ['替换后的节目时段与其他已编排记录重叠'],
      timeRange: { start: currentItem.startTime, end: nextEndTime },
    }
  }

  async execute(
    command: ReplaceCommand,
    context: { scheduleDate: string; channelId: string },
  ): Promise<ReplaceExecutionResult> {
    const { itemId, newCandidateId } = command.data
    const atomicCapabilities = getAtomicCapabilities()
    const currentItem = atomicCapabilities.getItem(itemId)

    if (!currentItem) {
      return {
        success: false,
        message: `未找到待替换节目 ${itemId}`,
      }
    }

    const candidate = getCandidateService().getCandidateById(newCandidateId)
    if (!candidate) {
      return {
        success: false,
        message: `未找到替换候选节目 ${newCandidateId}`,
      }
    }

    const preview = this.preview(command)
    if (!preview.canExecute) {
      return {
        success: false,
        message: preview.warnings[0] || '替换后的节目与现有编排冲突，无法执行',
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

    const validationReport = getScheduleValidationService().validateCurrentSchedule(
      context.scheduleDate,
      context.channelId,
    )

    if (!validationReport.isValid) {
      atomicCapabilities.restoreSnapshot(itemId)
      return {
        success: false,
        message: `替换后校验未通过，已撤销本次修改（发现 ${validationReport.summary.totalIssues} 个问题）`,
        validationReport,
      }
    }

    return {
      success: true,
      message: `已替换节目为 ${candidate.programName}`,
      validationReport,
      data: result.data,
      affectedItems: result.affectedItems,
      affectedTimeRanges: result.affectedTimeRanges,
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
