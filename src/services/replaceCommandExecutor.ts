import type { ProgramCandidate, ReplaceCommand, ScheduleItemSnapshot, ValidationReport } from '@/types/orchestration'
import { getAtomicCapabilities } from './atomicCapabilities'
import { getCandidateService } from './candidateService'
import { getScheduleValidationService } from './scheduleValidationService'
import { detectMovingItemSequenceViolation } from './scheduleSequenceGuard'

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
    const hasAvailableTime = atomicCapabilities.isTimeRangeAvailable(currentItem.startTime, nextEndTime, itemId)
    const sequenceViolation = hasAvailableTime
      ? this.detectSequenceOrderViolation(
        candidate,
        currentItem.startTime,
        nextEndTime,
        atomicCapabilities.getAllItems().filter((item) => item.id !== itemId),
      )
      : null

    return {
      canExecute: hasAvailableTime && !sequenceViolation,
      warnings: [
        ...(hasAvailableTime ? [] : ['替换后的节目时段与其他已编排记录重叠']),
        ...(sequenceViolation ? [sequenceViolation] : []),
      ],
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

  private detectSequenceOrderViolation(
    candidate: ProgramCandidate,
    startTime: string,
    endTime: string,
    existingItems: ScheduleItemSnapshot[],
  ): string | null {
    const sharedViolation = detectMovingItemSequenceViolation({
      id: `replace-preview:${candidate.id}`,
      programCode: candidate.programCode,
      programName: candidate.programName,
      startTime,
      endTime,
      duration: candidate.duration,
      programType: candidate.programType,
      sequence: 0,
      issueNo: candidate.issueNo,
    } as ScheduleItemSnapshot & { issueNo?: string }, existingItems, '替换')
    if (sharedViolation) {
      return sharedViolation.message
    }

    const candidateSeriesKey = this.buildSeriesKey(candidate.programName, candidate.programCode)
    const candidateSequence = this.extractSequenceNo(candidate)
    if (!candidateSeriesKey || typeof candidateSequence !== 'number') {
      return null
    }

    const replaceStartMs = new Date(startTime).getTime()
    const replaceEndMs = new Date(endTime).getTime()
    if (!Number.isFinite(replaceStartMs) || !Number.isFinite(replaceEndMs)) {
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

      if (replaceStartMs < itemStartMs && candidateSequence > itemSequence) {
        return `替换会造成顺播倒序：不能在 ${this.toClock(startTime)} 替换为第${candidateSequence}集，后面 ${this.toClock(item.startTime)} 已有第${itemSequence}集。`
      }
      if (replaceStartMs >= itemEndMs && candidateSequence < itemSequence) {
        return `替换会造成顺播倒序：前面 ${this.toClock(item.startTime)} 已有第${itemSequence}集，不能在 ${this.toClock(startTime)} 替换为第${candidateSequence}集。`
      }
      if (replaceStartMs >= itemEndMs && candidateSequence > itemSequence + 1) {
        return `替换会造成顺播跳集：前面 ${this.toClock(item.startTime)} 已有第${itemSequence}集，不能直接在 ${this.toClock(startTime)} 替换为第${candidateSequence}集。`
      }
      if (replaceStartMs < itemStartMs && candidateSequence + 1 < itemSequence) {
        return `替换会造成顺播跳集：后面 ${this.toClock(item.startTime)} 已有第${itemSequence}集，不能在 ${this.toClock(startTime)} 只补到第${candidateSequence}集。`
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
      .replace(/[《》“”"'（）()【】\[\]·•.。；;，,、_\-—]/g, '')
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
