import type { InsertCommand, MaterializeInput, ValidationReport } from '@/types/orchestration'
import { getAtomicCapabilities } from './atomicCapabilities'
import { getCandidateService } from './candidateService'
import { getMaterializer } from './materializer'
import { getScheduleValidationService } from './scheduleValidationService'

export interface InsertExecutionResult {
  success: boolean
  message: string
  error?: string
  validationReport?: ValidationReport
  data?: unknown
  affectedItems?: string[]
  affectedTimeRanges?: { start: string; end: string }[]
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
    const materializer = getMaterializer()
    const startTime = this.normalizeDateTime(scheduleDate, insertTime)
    const endTime = materializer.calculateEndTime(startTime, candidate.duration)

    if (!atomicCapabilities.isTimeRangeAvailable(startTime, endTime)) {
      return {
        success: false,
        message: `目标时间 ${insertTime} 已有节目占用，当前仅支持插入到空闲时间段`,
      }
    }

    const materializeInput: MaterializeInput = {
      gap: {
        id: `insert_gap_${Date.now()}`,
        startTime,
        endTime,
        duration: candidate.duration,
        constraints: {},
        metadata: {
          source: 'manual',
          priority: 1,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      },
      selectedCandidate: candidate,
      channelContext: {
        channelId,
        channelName: channelId,
        date: scheduleDate,
        timeZone: 'Asia/Shanghai',
        broadcastRules: {
          defaultStartTime: '06:00:00',
          defaultEndTime: '26:00:00',
          minProgramDuration: 60,
          maxProgramDuration: 7200,
          allowedTransitions: {},
        },
      },
    }

    const materializeResult = materializer.materialize(materializeInput, {
      forceStartTime: startTime,
      forceEndTime: endTime,
      customSequence: atomicCapabilities.getAllItems().length + 1,
    })

    if (!materializeResult.success || !materializeResult.items?.length || !materializeResult.item) {
      return {
        success: false,
        message: `物化失败: ${materializeResult.error}`,
      }
    }

    const result = await atomicCapabilities.appendItems(materializeResult.items)
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
        data: materializeResult.items,
        affectedItems: materializeResult.items.map((item) => item.id),
        affectedTimeRanges: materializeResult.items.map((item) => ({ start: item.startTime, end: item.endTime })),
      }
    }

    return {
      success: true,
      message: `已在 ${insertTime} 插入节目 ${candidate.programName}`,
      validationReport,
      data: materializeResult.items,
      affectedItems: materializeResult.items.map((item) => item.id),
      affectedTimeRanges: materializeResult.items.map((item) => ({ start: item.startTime, end: item.endTime })),
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

    const materializer = getMaterializer()
    const startTime = this.normalizeDateTime(scheduleDate, insertTime)
    const endTime = materializer.calculateEndTime(startTime, candidate.duration)
    const canExecute = getAtomicCapabilities().isTimeRangeAvailable(startTime, endTime)

    return {
      canExecute,
      warnings: canExecute ? [] : ['目标时间段已被现有节目占用'],
      timeRange: { start: startTime, end: endTime },
    }
  }

  private normalizeDateTime(scheduleDate: string, timeText: string): string {
    if (timeText.includes('T')) {
      return timeText.includes('+08:00') ? timeText : `${timeText}+08:00`
    }
    const normalizedTime = timeText.length === 5 ? `${timeText}:00` : timeText
    return `${scheduleDate}T${normalizedTime}+08:00`
  }
}

let globalInsertCommandExecutor: InsertCommandExecutor | null = null

export function getInsertCommandExecutor(): InsertCommandExecutor {
  if (!globalInsertCommandExecutor) {
    globalInsertCommandExecutor = new InsertCommandExecutor()
  }
  return globalInsertCommandExecutor
}
