import type { InsertCommand, ScheduleItemSnapshot, ValidationReport } from '@/types/orchestration'
import { getAtomicCapabilities } from './atomicCapabilities'
import { getCandidateService } from './candidateService'
import { getScheduleValidationService } from './scheduleValidationService'

export interface InsertExecutionResult {
  success: boolean
  message: string
  error?: string
  validationReport?: ValidationReport
}

export class InsertCommandExecutor {
  async execute(command: InsertCommand): Promise<InsertExecutionResult> {
    const { candidateId, insertTime, scheduleDate, channelId } = command.data
    if (!candidateId || !insertTime || !scheduleDate || !channelId) {
      return {
        success: false,
        message: '插入命令缺少必要参数',
      }
    }

    const candidate = getCandidateService().getCandidateById(candidateId)
    if (!candidate) {
      return {
        success: false,
        message: `未找到候选节目 ${candidateId}`,
      }
    }

    const atomicCapabilities = getAtomicCapabilities()
    const startTime = this.normalizeDateTime(scheduleDate, insertTime)
    const endTime = this.calculateEndTime(startTime, candidate.duration)

    if (!atomicCapabilities.isTimeRangeAvailable(startTime, endTime)) {
      return {
        success: false,
        message: `目标时间 ${insertTime} 已有节目占用，当前演示版本仅支持插入到空闲时间段`,
      }
    }

    const newItem: ScheduleItemSnapshot = {
      id: `insert_${candidate.id}_${Date.now()}`,
      programCode: candidate.programCode,
      programName: candidate.programName,
      startTime,
      endTime,
      duration: candidate.duration,
      programType: candidate.programType,
      sequence: atomicCapabilities.getAllItems().length + 1,
    }

    const result = await atomicCapabilities.appendItems([newItem])
    if (!result.success) {
      return {
        success: false,
        message: `插入失败: ${result.error}`,
      }
    }

    const validationReport = getScheduleValidationService().validateCurrentSchedule(scheduleDate, channelId)
    if (!validationReport.isValid) {
      return {
        success: true,
        message: `已插入节目 ${candidate.programName}，但校验发现 ${validationReport.summary.totalIssues} 个问题`,
        validationReport,
      }
    }

    return {
      success: true,
      message: `已在 ${insertTime} 插入节目 ${candidate.programName}`,
      validationReport,
    }
  }

  preview(command: InsertCommand): { canExecute: boolean; warnings: string[]; timeRange?: { start: string; end: string } } {
    const { candidateId, insertTime, scheduleDate } = command.data
    if (!candidateId || !insertTime || !scheduleDate) {
      return {
        canExecute: false,
        warnings: ['插入命令缺少必要参数'],
      }
    }

    const candidate = getCandidateService().getCandidateById(candidateId)
    if (!candidate) {
      return {
        canExecute: false,
        warnings: [`未找到候选节目 ${candidateId}`],
      }
    }

    const startTime = this.normalizeDateTime(scheduleDate, insertTime)
    const endTime = this.calculateEndTime(startTime, candidate.duration)
    const canExecute = getAtomicCapabilities().isTimeRangeAvailable(startTime, endTime)

    return {
      canExecute,
      warnings: canExecute ? [] : ['目标时间段已被现有节目占用'],
      timeRange: { start: startTime, end: endTime },
    }
  }

  private normalizeDateTime(scheduleDate: string, timeText: string): string {
    if (timeText.includes('T')) return timeText
    const normalizedTime = timeText.length === 5 ? `${timeText}:00` : timeText
    return `${scheduleDate}T${normalizedTime}`
  }

  private calculateEndTime(startTime: string, durationSeconds: number): string {
    const start = new Date(startTime).getTime()
    return new Date(start + durationSeconds * 1000).toISOString()
  }
}

let globalInsertCommandExecutor: InsertCommandExecutor | null = null

export function getInsertCommandExecutor(): InsertCommandExecutor {
  if (!globalInsertCommandExecutor) {
    globalInsertCommandExecutor = new InsertCommandExecutor()
  }
  return globalInsertCommandExecutor
}
