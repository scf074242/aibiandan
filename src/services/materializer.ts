/**
 * 确定性物化器
 * 将 LLM 的候选选择结果转换为完整的业务对象
 * 
 * 核心职责：
 * 1. 补齐系统字段（ID、时间、序号等）
 * 2. 计算精确时间边界
 * 3. 生成完整的 ScheduleItem / RundownItem
 * 
 * 原则：LLM 只负责"选什么"，物化器负责"怎么填"
 */

import type {
  MaterializeInput,
  MaterializeResult,
  ScheduleItemSnapshot,
  ChannelContext,
  ProgramCandidate,
  GapInfo,
  BroadcastRules,
} from '@/types/orchestration'

/** 物化器配置 */
export interface MaterializerConfig {
  defaultTimezone: string
  idPrefix: string
  sequenceStart: number
  enableAutoSequence: boolean
  enableDurationValidation: boolean
}

/** 默认配置 */
const DEFAULT_CONFIG: MaterializerConfig = {
  defaultTimezone: 'Asia/Shanghai',
  idPrefix: 'item',
  sequenceStart: 1,
  enableAutoSequence: true,
  enableDurationValidation: true,
}

/** 物化选项 */
export interface MaterializeOptions {
  forceStartTime?: string    // 强制指定开始时间
  forceEndTime?: string      // 强制指定结束时间
  customSequence?: number    // 自定义序号
  skipValidation?: boolean   // 跳过验证
}

/** 确定性物化器 */
export class Materializer {
  private config: MaterializerConfig

  constructor(config?: Partial<MaterializerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * 物化单个条目
   * 将 LLM 选择的候选节目转换为完整的 ScheduleItem
   */
  materialize(input: MaterializeInput, options?: MaterializeOptions): MaterializeResult {
    const { gap, selectedCandidate, precedingItem, followingItem, channelContext } = input

    try {
      // 1. 计算时间边界
      const timeBoundaries = this.calculateTimeBoundaries(
        gap,
        selectedCandidate,
        precedingItem,
        followingItem,
        options,
      )

      // 2. 验证时长
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

      // 3. 生成系统字段
      const systemFields = this.generateSystemFields(
        selectedCandidate,
        timeBoundaries,
        precedingItem,
      )

      // 4. 组装完整条目
      const item: ScheduleItemSnapshot = {
        id: systemFields.id,
        programCode: selectedCandidate.programCode,
        programName: selectedCandidate.programName,
        startTime: timeBoundaries.startTime,
        endTime: timeBoundaries.endTime,
        duration: timeBoundaries.duration,
        programType: selectedCandidate.programType,
        sequence: systemFields.sequence,
      }

      // 5. 生成警告信息
      const warnings = this.generateWarnings(input, item)

      return {
        success: true,
        item,
        warnings: warnings.length > 0 ? warnings : undefined,
      }
    } catch (error) {
      return {
        success: false,
        error: `物化失败: ${(error as Error).message}`,
      }
    }
  }

  /**
   * 批量物化
   */
  materializeBatch(
    inputs: MaterializeInput[],
    options?: MaterializeOptions,
  ): MaterializeResult[] {
    return inputs.map((input, index) => {
      // 批量物化时，自动计算序号
      const batchOptions: MaterializeOptions = {
        ...options,
        customSequence: options?.customSequence
          ? options.customSequence + index
          : undefined,
      }
      return this.materialize(input, batchOptions)
    })
  }

  /**
   * 预演物化结果（不实际生成）
   */
  previewMaterialize(input: MaterializeInput, options?: MaterializeOptions): MaterializeResult {
    // 预览模式跳过部分验证
    const previewOptions: MaterializeOptions = {
      ...options,
      skipValidation: true,
    }
    return this.materialize(input, previewOptions)
  }

  // ==================== 时间计算 ====================

  /**
   * 计算时间边界
   */
  private calculateTimeBoundaries(
    gap: GapInfo,
    candidate: ProgramCandidate,
    precedingItem?: ScheduleItemSnapshot,
    followingItem?: ScheduleItemSnapshot,
    options?: MaterializeOptions,
  ): {
    startTime: string
    endTime: string
    duration: number
  } {
    // 优先使用强制指定的时间
    if (options?.forceStartTime && options?.forceEndTime) {
      const duration =
        (new Date(options.forceEndTime).getTime() - new Date(options.forceStartTime).getTime()) /
        1000
      return {
        startTime: options.forceStartTime,
        endTime: options.forceEndTime,
        duration,
      }
    }

    // 确定开始时间
    let startTime: string
    if (options?.forceStartTime) {
      startTime = options.forceStartTime
    } else if (gap.constraints.fixedStart) {
      // 空窗开始时间固定
      startTime = gap.startTime
    } else if (precedingItem) {
      // 紧接前一条目
      startTime = precedingItem.endTime
    } else {
      // 使用空窗开始时间
      startTime = gap.startTime
    }

    // 计算结束时间（基于节目时长）
    const startTimeMs = new Date(startTime).getTime()
    const endTimeMs = startTimeMs + candidate.duration * 1000
    let endTime = new Date(endTimeMs).toISOString()

    // 如果指定了强制结束时间
    if (options?.forceEndTime) {
      endTime = options.forceEndTime
    } else if (gap.constraints.fixedEnd) {
      // 如果空窗结束时间固定，需要调整
      const gapEndMs = new Date(gap.endTime).getTime()
      if (endTimeMs > gapEndMs) {
        // 节目超出空窗，截断到空窗结束时间
        endTime = gap.endTime
      }
    }

    // 重新计算实际时长
    const actualDuration =
      (new Date(endTime).getTime() - new Date(startTime).getTime()) / 1000

    return {
      startTime,
      endTime,
      duration: actualDuration,
    }
  }

  /**
   * 验证时长
   */
  private validateDuration(
    candidate: ProgramCandidate,
    actualDuration: number,
    gap: GapInfo,
    rules: BroadcastRules,
  ): {
    valid: boolean
    error?: string
    warnings?: string[]
  } {
    const warnings: string[] = []

    // 1. 检查是否满足最小时长要求
    if (rules.minProgramDuration && actualDuration < rules.minProgramDuration) {
      return {
        valid: false,
        error: `节目时长 ${actualDuration}秒 小于最小时长 ${rules.minProgramDuration}秒`,
      }
    }

    // 2. 检查是否超过最大时长限制
    if (rules.maxProgramDuration && actualDuration > rules.maxProgramDuration) {
      return {
        valid: false,
        error: `节目时长 ${actualDuration}秒 超过最大时长 ${rules.maxProgramDuration}秒`,
      }
    }

    // 3. 检查空窗约束
    if (gap.constraints.minDuration && actualDuration < gap.constraints.minDuration) {
      warnings.push(`节目时长 ${actualDuration}秒 小于空窗建议最小时长 ${gap.constraints.minDuration}秒`)
    }

    if (gap.constraints.maxDuration && actualDuration > gap.constraints.maxDuration) {
      warnings.push(`节目时长 ${actualDuration}秒 超过空窗建议最大时长 ${gap.constraints.maxDuration}秒`)
    }

    // 4. 检查与候选节目时长的差异
    const durationDiff = Math.abs(actualDuration - candidate.duration)
    const durationDiffPercent = (durationDiff / candidate.duration) * 100

    if (durationDiffPercent > 10) {
      warnings.push(
        `实际时长 ${actualDuration}秒 与候选节目时长 ${candidate.duration}秒 差异 ${durationDiffPercent.toFixed(1)}%`,
      )
    }

    return {
      valid: true,
      warnings: warnings.length > 0 ? warnings : undefined,
    }
  }

  // ==================== 系统字段生成 ====================

  /**
   * 生成系统字段
   */
  private generateSystemFields(
    candidate: ProgramCandidate,
    timeBoundaries: { startTime: string; endTime: string; duration: number },
    precedingItem?: ScheduleItemSnapshot,
  ): {
    id: string
    sequence: number
  } {
    // 生成唯一ID
    const id = this.generateItemId()

    // 计算序号
    let sequence: number
    if (precedingItem) {
      sequence = precedingItem.sequence + 1
    } else {
      sequence = this.config.sequenceStart
    }

    return {
      id,
      sequence,
    }
  }

  /**
   * 生成条目ID
   */
  private generateItemId(): string {
    const timestamp = Date.now()
    const random = Math.random().toString(36).substr(2, 9)
    return `${this.config.idPrefix}_${timestamp}_${random}`
  }

  // ==================== 警告生成 ====================

  /**
   * 生成警告信息
   */
  private generateWarnings(
    input: MaterializeInput,
    item: ScheduleItemSnapshot,
  ): string[] {
    const warnings: string[] = []
    const { gap, selectedCandidate } = input

    // 1. 时长不匹配警告
    const durationDiff = Math.abs(item.duration - selectedCandidate.duration)
    if (durationDiff > 60) {
      warnings.push(
        `物化后时长 ${item.duration}秒 与候选时长 ${selectedCandidate.duration}秒 差异较大`,
      )
    }

    // 2. 时间边界警告
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

    // 3. 类型约束警告
    if (
      gap.constraints.allowedTypes &&
      gap.constraints.allowedTypes.length > 0 &&
      !gap.constraints.allowedTypes.includes(item.programType)
    ) {
      warnings.push(
        `节目类型 ${item.programType} 不在空窗允许类型 [${gap.constraints.allowedTypes.join(', ')}] 中`,
      )
    }

    return warnings
  }

  // ==================== 公共工具方法 ====================

  /**
   * 计算节目结束时间
   */
  calculateEndTime(startTime: string, durationSeconds: number): string {
    const startTimeMs = new Date(startTime).getTime()
    const endTimeMs = startTimeMs + durationSeconds * 1000
    return new Date(endTimeMs).toISOString()
  }

  /**
   * 计算两个时间点之间的时长（秒）
   */
  calculateDuration(startTime: string, endTime: string): number {
    const startMs = new Date(startTime).getTime()
    const endMs = new Date(endTime).getTime()
    return Math.floor((endMs - startMs) / 1000)
  }

  /**
   * 格式化时长为可读字符串
   */
  formatDuration(seconds: number): string {
    const hours = Math.floor(seconds / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    const secs = seconds % 60

    if (hours > 0) {
      return `${hours}小时${minutes}分钟${secs}秒`
    } else if (minutes > 0) {
      return `${minutes}分钟${secs}秒`
    } else {
      return `${secs}秒`
    }
  }

  /**
   * 检查时间范围是否重叠
   */
  checkTimeOverlap(
    range1: { start: string; end: string },
    range2: { start: string; end: string },
  ): boolean {
    const start1 = new Date(range1.start).getTime()
    const end1 = new Date(range1.end).getTime()
    const start2 = new Date(range2.start).getTime()
    const end2 = new Date(range2.end).getTime()

    return start1 < end2 && start2 < end1
  }

  /**
   * 调整条目时间以适应空窗
   */
  adjustItemToGap(
    item: ScheduleItemSnapshot,
    gap: GapInfo,
  ): ScheduleItemSnapshot {
    const adjusted = { ...item }

    // 确保开始时间不早于空窗开始
    if (new Date(item.startTime).getTime() < new Date(gap.startTime).getTime()) {
      adjusted.startTime = gap.startTime
      adjusted.endTime = this.calculateEndTime(adjusted.startTime, item.duration)
    }

    // 确保结束时间不晚于空窗结束
    if (new Date(adjusted.endTime).getTime() > new Date(gap.endTime).getTime()) {
      adjusted.endTime = gap.endTime
      adjusted.duration = this.calculateDuration(adjusted.startTime, adjusted.endTime)
    }

    return adjusted
  }
}

// 导出工厂函数
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

// 导出便捷函数
export function materializeItem(
  input: MaterializeInput,
  options?: MaterializeOptions,
): MaterializeResult {
  return getMaterializer().materialize(input, options)
}

export function previewItemMaterialize(
  input: MaterializeInput,
  options?: MaterializeOptions,
): MaterializeResult {
  return getMaterializer().previewMaterialize(input, options)
}
