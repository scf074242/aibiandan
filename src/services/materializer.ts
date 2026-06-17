import type {
  BroadcastRules,
  GapInfo,
  MaterializeInput,
  MaterializeResult,
  ProgramAdBreak,
  ProgramCandidate,
  ScheduleItemSnapshot,
} from '@/types/orchestration'

export interface MaterializerConfig {
  defaultTimezone: string
  idPrefix: string
  sequenceStart: number
  enableAutoSequence: boolean
  enableDurationValidation: boolean
}

const DEFAULT_CONFIG: MaterializerConfig = {
  defaultTimezone: 'Asia/Shanghai',
  idPrefix: 'item',
  sequenceStart: 1,
  enableAutoSequence: true,
  enableDurationValidation: true,
}

export interface MaterializeOptions {
  forceStartTime?: string
  forceEndTime?: string
  customSequence?: number
  skipValidation?: boolean
}

export class Materializer {
  private config: MaterializerConfig

  constructor(config?: Partial<MaterializerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  materialize(input: MaterializeInput, options?: MaterializeOptions): MaterializeResult {
    const { gap, selectedCandidate, precedingItem, followingItem, channelContext } = input

    try {
      const timeBoundaries = this.calculateTimeBoundaries(
        gap,
        selectedCandidate,
        precedingItem,
        followingItem,
        options,
      )

      if (this.config.enableDurationValidation && !options?.skipValidation) {
        const validation = this.validateDuration(
          selectedCandidate,
          timeBoundaries.duration,
          gap,
          channelContext.broadcastRules,
        )

        if (!validation.valid) {
          return {
            success: false,
            error: validation.error,
            warnings: validation.warnings,
          }
        }
      }

      const sequenceStart = options?.customSequence
        ?? (precedingItem ? precedingItem.sequence + 1 : this.config.sequenceStart)
      const items = this.buildScheduleItems(selectedCandidate, timeBoundaries, sequenceStart)
      const item = items[items.length - 1]

      if (!item) {
        return {
          success: false,
          error: '物化失败: 未生成任何编排记录',
        }
      }

      const warnings = this.generateWarnings(input, item)

      return {
        success: true,
        item,
        items,
        warnings: warnings.length > 0 ? warnings : undefined,
      }
    } catch (error) {
      return {
        success: false,
        error: `物化失败: ${(error as Error).message}`,
      }
    }
  }

  materializeBatch(inputs: MaterializeInput[], options?: MaterializeOptions): MaterializeResult[] {
    return inputs.map((input, index) => this.materialize(input, {
      ...options,
      customSequence: options?.customSequence ? options.customSequence + index : undefined,
    }))
  }

  previewMaterialize(input: MaterializeInput, options?: MaterializeOptions): MaterializeResult {
    return this.materialize(input, {
      ...options,
      skipValidation: true,
    })
  }

  private calculateTimeBoundaries(
    gap: GapInfo,
    candidate: ProgramCandidate,
    precedingItem?: ScheduleItemSnapshot,
    _followingItem?: ScheduleItemSnapshot,
    options?: MaterializeOptions,
  ) {
    if (options?.forceStartTime && options?.forceEndTime) {
      return {
        startTime: options.forceStartTime,
        endTime: options.forceEndTime,
        duration: this.calculateDuration(options.forceStartTime, options.forceEndTime),
      }
    }

    let startTime: string
    if (options?.forceStartTime) {
      startTime = options.forceStartTime
    } else if (gap.constraints.fixedStart) {
      startTime = gap.startTime
    } else if (precedingItem) {
      startTime = precedingItem.endTime
    } else {
      startTime = gap.startTime
    }

    const computedEndTime = this.calculateEndTime(startTime, candidate.duration)
    let endTime = options?.forceEndTime ?? computedEndTime

    if (!options?.forceEndTime && gap.constraints.fixedEnd) {
      const gapEndMs = new Date(gap.endTime).getTime()
      const endTimeMs = new Date(endTime).getTime()
      if (endTimeMs > gapEndMs) {
        endTime = gap.endTime
      }
    }

    return {
      startTime,
      endTime,
      duration: this.calculateDuration(startTime, endTime),
    }
  }

  private validateDuration(
    candidate: ProgramCandidate,
    actualDuration: number,
    gap: GapInfo,
    rules: BroadcastRules,
  ) {
    const warnings: string[] = []

    if (rules.minProgramDuration && actualDuration < rules.minProgramDuration) {
      return {
        valid: false,
        error: `节目时长 ${actualDuration} 秒小于最小时长 ${rules.minProgramDuration} 秒`,
        warnings,
      }
    }

    if (rules.maxProgramDuration && actualDuration > rules.maxProgramDuration) {
      return {
        valid: false,
        error: `节目时长 ${actualDuration} 秒超过最大时长 ${rules.maxProgramDuration} 秒`,
        warnings,
      }
    }

    if (gap.constraints.minDuration && actualDuration < gap.constraints.minDuration) {
      warnings.push(`节目时长 ${actualDuration} 秒小于空窗建议最小时长 ${gap.constraints.minDuration} 秒`)
    }

    if (gap.constraints.maxDuration && actualDuration > gap.constraints.maxDuration) {
      warnings.push(`节目时长 ${actualDuration} 秒超过空窗建议最大时长 ${gap.constraints.maxDuration} 秒`)
    }

    const durationDiff = Math.abs(actualDuration - candidate.duration)
    const durationDiffPercent = candidate.duration > 0
      ? (durationDiff / candidate.duration) * 100
      : 0
    if (durationDiffPercent > 10) {
      warnings.push(
        `物化后时长 ${actualDuration} 秒与候选时长 ${candidate.duration} 秒差异 ${durationDiffPercent.toFixed(1)}%`,
      )
    }

    return {
      valid: true,
      warnings: warnings.length > 0 ? warnings : undefined,
    }
  }

  private buildScheduleItems(
    candidate: ProgramCandidate,
    timeBoundaries: { startTime: string; endTime: string; duration: number },
    sequenceStart: number,
  ): ScheduleItemSnapshot[] {
    const adBreaks = this.normalizeAdBreaks(candidate.adBreaks, timeBoundaries.duration)
    if (adBreaks.length === 0) {
      return [this.createProgramSegment(candidate, timeBoundaries.startTime, 0, timeBoundaries.duration, sequenceStart, 0)]
    }

    const items: ScheduleItemSnapshot[] = []
    let currentOffset = 0
    let currentSequence = sequenceStart
    let consumedContentDuration = 0

    adBreaks.forEach((adBreak, index) => {
      const contentDuration = adBreak.offsetSeconds - currentOffset
      if (contentDuration > 0) {
        items.push(this.createProgramSegment(
          candidate,
          timeBoundaries.startTime,
          currentOffset,
          contentDuration,
          currentSequence,
          consumedContentDuration,
        ))
        currentSequence += 1
        consumedContentDuration += contentDuration
      }

      items.push(this.createAdSegment(
        timeBoundaries.startTime,
        adBreak.offsetSeconds,
        adBreak.durationSeconds,
        currentSequence,
        index,
        consumedContentDuration,
      ))
      currentSequence += 1
      currentOffset = adBreak.offsetSeconds + adBreak.durationSeconds
    })

    const trailingDuration = timeBoundaries.duration - currentOffset
    if (trailingDuration > 0) {
      items.push(this.createProgramSegment(
        candidate,
        timeBoundaries.startTime,
        currentOffset,
        trailingDuration,
        currentSequence,
        consumedContentDuration,
      ))
    }

    return items
  }

  private normalizeAdBreaks(adBreaks: ProgramAdBreak[] | undefined, scheduledDuration: number): ProgramAdBreak[] {
    const normalized = [...(adBreaks ?? [])]
      .filter((item) => item.durationSeconds > 0)
      .sort((left, right) => left.offsetSeconds - right.offsetSeconds)

    if (normalized.length === 0) {
      return []
    }

    let previousEnd = 0
    for (const adBreak of normalized) {
      if (adBreak.offsetSeconds <= previousEnd) {
        return []
      }
      if (adBreak.offsetSeconds >= scheduledDuration) {
        return []
      }
      if (adBreak.offsetSeconds + adBreak.durationSeconds >= scheduledDuration) {
        return []
      }
      previousEnd = adBreak.offsetSeconds + adBreak.durationSeconds
    }

    return normalized
  }

  private createProgramSegment(
    candidate: ProgramCandidate,
    baseStartTime: string,
    offsetSeconds: number,
    durationSeconds: number,
    sequence: number,
    relativeStartSeconds: number,
  ): ScheduleItemSnapshot {
    const startTime = this.addSeconds(baseStartTime, offsetSeconds)
    const endTime = this.addSeconds(startTime, durationSeconds)

    return {
      id: this.generateItemId(),
      programId: candidate.programId,
      programCode: candidate.programCode,
      programName: candidate.programName,
      instanceName: candidate.instanceName,
      columnId: candidate.columnId,
      columnName: candidate.columnName,
      contentTags: candidate.contentTags,
      startTime,
      endTime,
      duration: durationSeconds,
      programType: candidate.programType,
      sequence,
      relativeStartSeconds,
    }
  }

  private createAdSegment(
    baseStartTime: string,
    offsetSeconds: number,
    durationSeconds: number,
    sequence: number,
    index: number,
    relativeStartSeconds: number,
  ): ScheduleItemSnapshot {
    const startTime = this.addSeconds(baseStartTime, offsetSeconds)
    const endTime = this.addSeconds(startTime, durationSeconds)
    const durationMinutes = Math.round(durationSeconds / 60)

    return {
      id: `ad_internal_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 8)}`,
      programCode: `AD-${durationMinutes}M-${String(sequence).padStart(3, '0')}`,
      programName: '广告',
      startTime,
      endTime,
      duration: durationSeconds,
      programType: 'ad',
      sequence,
      relativeStartSeconds,
    }
  }

  private generateItemId(): string {
    const timestamp = Date.now()
    const random = Math.random().toString(36).slice(2, 11)
    return `${this.config.idPrefix}_${timestamp}_${random}`
  }

  private generateWarnings(input: MaterializeInput, item: ScheduleItemSnapshot): string[] {
    const warnings: string[] = []
    const { gap, selectedCandidate } = input

    const durationDiff = Math.abs(item.duration - selectedCandidate.duration)
    if (durationDiff > 60 && !(selectedCandidate.adBreaks?.length)) {
      warnings.push(`物化后时长 ${item.duration} 秒与候选时长 ${selectedCandidate.duration} 秒差异较大`)
    }

    const gapStart = new Date(gap.startTime).getTime()
    const gapEnd = new Date(gap.endTime).getTime()
    const itemStart = new Date(item.startTime).getTime()
    const itemEnd = new Date(item.endTime).getTime()

    if (itemStart < gapStart) {
      warnings.push('节目开始时间早于空窗开始时间')
    }

    if (itemEnd > gapEnd) {
      warnings.push('节目结束时间晚于空窗结束时间')
    }

    if (
      gap.constraints.allowedTypes?.length
      && !gap.constraints.allowedTypes.includes(item.programType)
      && item.programType !== 'ad'
    ) {
      warnings.push(`节目类型 ${item.programType} 不在空窗允许类型内`)
    }

    return warnings
  }

  calculateEndTime(startTime: string, durationSeconds: number): string {
    return this.addSeconds(startTime, durationSeconds)
  }

  calculateDuration(startTime: string, endTime: string): number {
    return Math.floor((new Date(endTime).getTime() - new Date(startTime).getTime()) / 1000)
  }

  formatDuration(seconds: number): string {
    const hours = Math.floor(seconds / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    const secs = seconds % 60

    if (hours > 0) return `${hours}小时${minutes}分钟${secs}秒`
    if (minutes > 0) return `${minutes}分钟${secs}秒`
    return `${secs}秒`
  }

  checkTimeOverlap(range1: { start: string; end: string }, range2: { start: string; end: string }): boolean {
    const start1 = new Date(range1.start).getTime()
    const end1 = new Date(range1.end).getTime()
    const start2 = new Date(range2.start).getTime()
    const end2 = new Date(range2.end).getTime()
    return start1 < end2 && start2 < end1
  }

  adjustItemToGap(item: ScheduleItemSnapshot, gap: GapInfo): ScheduleItemSnapshot {
    const adjusted = { ...item }

    if (new Date(item.startTime).getTime() < new Date(gap.startTime).getTime()) {
      adjusted.startTime = gap.startTime
      adjusted.endTime = this.calculateEndTime(adjusted.startTime, item.duration)
    }

    if (new Date(adjusted.endTime).getTime() > new Date(gap.endTime).getTime()) {
      adjusted.endTime = gap.endTime
      adjusted.duration = this.calculateDuration(adjusted.startTime, adjusted.endTime)
    }

    return adjusted
  }

  private addSeconds(baseStartTime: string, seconds: number): string {
    const next = new Date(new Date(baseStartTime).getTime() + seconds * 1000)
    return this.formatLocalDateTime(next.getTime())
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

let globalMaterializer: Materializer | null = null

export function getMaterializer(config?: Partial<MaterializerConfig>): Materializer {
  if (!globalMaterializer) {
    globalMaterializer = new Materializer(config)
  }
  return globalMaterializer
}

export function resetMaterializer(): void {
  globalMaterializer = null
}

export function materializeItem(input: MaterializeInput, options?: MaterializeOptions): MaterializeResult {
  return getMaterializer().materialize(input, options)
}

export function previewItemMaterialize(input: MaterializeInput, options?: MaterializeOptions): MaterializeResult {
  return getMaterializer().previewMaterialize(input, options)
}
