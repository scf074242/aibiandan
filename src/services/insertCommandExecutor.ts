import type { InsertCommand, MaterializeInput, ProgramCandidate, ScheduleItemSnapshot, ValidationReport } from '@/types/orchestration'
import { getAtomicCapabilities } from './atomicCapabilities'
import { getCandidateService } from './candidateService'
import { getMaterializer } from './materializer'
import { getScheduleValidationService } from './scheduleValidationService'
import { detectMovingItemSequenceViolation } from './scheduleSequenceGuard'

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

    const sequenceViolation = this.detectSequenceOrderViolation(
      candidate,
      startTime,
      endTime,
      atomicCapabilities.getAllItems(),
    )
    if (sequenceViolation) {
      return {
        success: false,
        message: sequenceViolation,
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
    const atomicCapabilities = getAtomicCapabilities()
    const canExecute = atomicCapabilities.isTimeRangeAvailable(startTime, endTime)
    const sequenceViolation = canExecute
      ? this.detectSequenceOrderViolation(candidate, startTime, endTime, atomicCapabilities.getAllItems())
      : null

    return {
      canExecute: canExecute && !sequenceViolation,
      warnings: [
        ...(canExecute ? [] : ['目标时间段已被现有节目占用']),
        ...(sequenceViolation ? [sequenceViolation] : []),
      ],
      timeRange: { start: startTime, end: endTime },
    }
  }

  private detectSequenceOrderViolation(
    candidate: ProgramCandidate,
    startTime: string,
    endTime: string,
    existingItems: ScheduleItemSnapshot[],
  ): string | null {
    const sharedViolation = detectMovingItemSequenceViolation({
      id: `insert-preview:${candidate.id}`,
      programCode: candidate.programCode,
      programName: candidate.programName,
      startTime,
      endTime,
      duration: candidate.duration,
      programType: candidate.programType,
      sequence: 0,
      issueNo: candidate.issueNo,
    } as ScheduleItemSnapshot & { issueNo?: string }, existingItems, '插入')
    if (sharedViolation) {
      return sharedViolation.message
    }

    const candidateSeriesKey = this.buildSeriesKey(candidate.programName, candidate.programCode)
    const candidateSequence = this.extractSequenceNo(candidate)
    if (!candidateSeriesKey || typeof candidateSequence !== 'number') {
      return null
    }

    const insertStartMs = new Date(startTime).getTime()
    const insertEndMs = new Date(endTime).getTime()
    if (!Number.isFinite(insertStartMs) || !Number.isFinite(insertEndMs)) {
      return null
    }

    for (const item of existingItems) {
      const itemSeriesKey = this.buildSeriesKey(item.programName, item.programCode)
      if (!itemSeriesKey || itemSeriesKey !== candidateSeriesKey) continue

      const itemSequence = this.extractSequenceNo(item)
      if (typeof itemSequence !== 'number') continue

      const itemStartMs = new Date(item.startTime).getTime()
      const itemEndMs = new Date(item.endTime).getTime()
      if (!Number.isFinite(itemStartMs) || !Number.isFinite(itemEndMs)) continue

      if (insertStartMs < itemStartMs && candidateSequence > itemSequence) {
        return `插入会造成顺播倒序：不能在 ${this.toClock(startTime)} 插入第${candidateSequence}集，后面 ${this.toClock(item.startTime)} 已有第${itemSequence}集。`
      }
      if (insertStartMs >= itemEndMs && candidateSequence < itemSequence) {
        return `插入会造成顺播倒序：前面 ${this.toClock(item.startTime)} 已有第${itemSequence}集，不能在 ${this.toClock(startTime)} 插入第${candidateSequence}集。`
      }
      if (insertStartMs >= itemEndMs && candidateSequence > itemSequence + 1) {
        return `插入会造成顺播跳集：前面 ${this.toClock(item.startTime)} 已有第${itemSequence}集，不能直接在 ${this.toClock(startTime)} 插入第${candidateSequence}集。`
      }
      if (insertStartMs < itemStartMs && candidateSequence + 1 < itemSequence) {
        return `插入会造成顺播跳集：后面 ${this.toClock(item.startTime)} 已有第${itemSequence}集，不能在 ${this.toClock(startTime)} 只补到第${candidateSequence}集。`
      }
    }

    return null
  }

  private buildSeriesKey(programName?: string, programCode?: string): string {
    const normalizedName = this.normalizeSeriesName(programName)
    if (normalizedName) {
      return `name:${normalizedName}`
    }
    return programCode ? `code:${programCode.replace(/\d{1,4}$/, '')}` : ''
  }

  private normalizeSeriesName(programName?: string): string {
    if (!programName) return ''
    return programName
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '')
      .replace(/^[^：:]+[：:]/u, '')
      .replace(/第\s*[0-9零〇一二两三四五六七八九十百]+\s*[集期]/gu, '')
      .replace(/[上中下][集期]/gu, '')
      .replace(/[《》“”"'（）()【】[\]·•.。；;，,、_\-—]/g, '')
  }

  private extractSequenceNo(candidate: ProgramCandidate | ScheduleItemSnapshot): number | null {
    const issueNo = 'issueNo' in candidate ? this.parsePositiveNumber(candidate.issueNo) : null
    if (issueNo !== null) {
      return issueNo
    }

    const codeMatch = candidate.programCode?.match(/(\d{1,4})$/)
    if (codeMatch) {
      const parsed = Number(codeMatch[1])
      if (Number.isFinite(parsed) && parsed > 0) {
        return parsed
      }
    }

    const nameText = 'instanceName' in candidate
      ? `${candidate.programName} ${candidate.instanceName}`
      : candidate.programName
    const nameMatch = nameText.match(/第\s*([0-9零〇一二两三四五六七八九十百]+)\s*[集期]/u)
    return nameMatch ? this.parseChineseNumber(nameMatch[1]!) : null
  }

  private parsePositiveNumber(value?: string): number | null {
    if (!value) return null
    const parsed = Number(value)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null
  }

  private parseChineseNumber(value: string): number | null {
    const direct = Number(value)
    if (Number.isFinite(direct) && direct > 0) return direct
    const digits: Record<string, number> = {
      零: 0,
      〇: 0,
      一: 1,
      二: 2,
      两: 2,
      三: 3,
      四: 4,
      五: 5,
      六: 6,
      七: 7,
      八: 8,
      九: 9,
    }
    if (value === '十') return 10
    const tenIndex = value.indexOf('十')
    if (tenIndex >= 0) {
      const high = tenIndex === 0 ? 1 : digits[value[tenIndex - 1]!] ?? 0
      const low = digits[value[tenIndex + 1]!] ?? 0
      return high * 10 + low
    }
    return value.split('').reduce((sum, char) => sum * 10 + (digits[char] ?? 0), 0) || null
  }

  private toClock(value: string): string {
    return value.includes('T') ? (value.split('T')[1]?.slice(0, 8) ?? value) : value
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
