/**
 * 空窗管理器
 * 负责空窗的查询、维护、切分和消除
 * 是空窗驱动编排的核心组件
 */

import type {
  GapInfo,
  GapConstraints,
  GapMetadata,
  GapProcessingState,
  ProgressGapInfo,
  ScheduleItemSnapshot,
  FixedItem,
  TimeRange,
} from '@/types/orchestration'

/** 空窗管理器配置 */
export interface GapManagerConfig {
  minGapDuration: number      // 最小空窗时长（秒），小于此值的空窗将被忽略
  defaultPriority: number     // 默认优先级
  timezone: string           // 时区
}

/** 默认配置 */
const DEFAULT_CONFIG: GapManagerConfig = {
  minGapDuration: 60,        // 1分钟
  defaultPriority: 100,
  timezone: 'Asia/Shanghai',
}

/** 空窗管理器 */
export class GapManager {
  private gaps: Map<string, GapInfo> = new Map()
  private processingStates: Map<string, GapProcessingState> = new Map()
  private config: GapManagerConfig
  private channelId: string
  private date: string

  constructor(channelId: string, date: string, config?: Partial<GapManagerConfig>) {
    this.channelId = channelId
    this.date = date
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  // ==================== 空窗查询 ====================

  /**
   * 查询所有剩余空窗
   */
  queryRemainingGaps(): GapInfo[] {
    return Array.from(this.gaps.values())
      .filter((gap) => !this.isGapCompleted(gap.id) && !this.isGapFailed(gap.id))
      .sort((a, b) => {
        // 先按优先级排序，再按开始时间排序
        if (a.metadata.priority !== b.metadata.priority) {
          return a.metadata.priority - b.metadata.priority
        }
        return new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
      })
  }

  /**
   * 获取下一个待处理空窗
   */
  getNextGap(): GapInfo | undefined {
    const remaining = this.queryRemainingGaps()
    return remaining.find((gap) => !this.isGapProcessing(gap.id))
  }

  /**
   * 根据ID获取空窗
   */
  getGap(gapId: string): GapInfo | undefined {
    return this.gaps.get(gapId)
  }

  /**
   * 检查空窗是否存在
   */
  hasGap(gapId: string): boolean {
    return this.gaps.has(gapId)
  }

  // ==================== 空窗初始化 ====================

  /**
   * 从版面初始化空窗
   */
  initializeFromLayout(
    layoutSlots: Array<{
      startTime: string
      endTime: string
      programType: string
      preferredProgramTypes?: string[]
      fixedProgram?: string
    }>,
  ): void {
    this.gaps.clear()

    for (const slot of layoutSlots) {
      // 如果版面时段有固定节目，不产生空窗
      if (slot.fixedProgram) {
        continue
      }

      const gap = this.createGap({
        startTime: slot.startTime,
        endTime: slot.endTime,
        constraints: {
          allowedTypes: [slot.programType],
          maxDuration: (new Date(slot.endTime).getTime() - new Date(slot.startTime).getTime()) / 1000,
          fixedStart: true,
          fixedEnd: true,
        },
        metadata: {
          source: 'layout',
          priority: 50, // 版面时段优先级较高
        },
      })

      this.gaps.set(gap.id, gap)
    }
  }

  /**
   * 从现有条目和固定项计算空窗
   */
  calculateGapsFromItems(
    items: ScheduleItemSnapshot[],
    fixedItems: FixedItem[],
    dayStartTime: string,
    dayEndTime: string,
  ): void {
    this.gaps.clear()

    // 合并所有已占用时间段（包括固定项和已有条目）
    const occupiedRanges: TimeRange[] = [
      ...fixedItems.map((item) => ({ start: item.startTime, end: item.endTime })),
      ...items.map((item) => ({ start: item.startTime, end: item.endTime })),
    ]

    // 按开始时间排序
    occupiedRanges.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())

    // 合并重叠的时间段
    const mergedRanges = this.mergeTimeRanges(occupiedRanges)

    // 计算空窗
    let currentTime = dayStartTime

    for (const range of mergedRanges) {
      const rangeStart = new Date(range.start).getTime()
      const currentTimeMs = new Date(currentTime).getTime()

      if (rangeStart > currentTimeMs) {
        // 存在空窗
        const gapDuration = (rangeStart - currentTimeMs) / 1000

        if (gapDuration >= this.config.minGapDuration) {
          const gap = this.createGap({
            startTime: currentTime,
            endTime: range.start,
            constraints: {},
            metadata: {
              source: 'generated',
              priority: this.config.defaultPriority,
            },
          })
          this.gaps.set(gap.id, gap)
        }
      }

      // 移动当前时间到已占用时间段之后
      const rangeEnd = new Date(range.end).getTime()
      if (rangeEnd > new Date(currentTime).getTime()) {
        currentTime = range.end
      }
    }

    // 检查最后一个空窗（到日结束时间）
    const dayEndMs = new Date(dayEndTime).getTime()
    const currentTimeMs = new Date(currentTime).getTime()

    if (dayEndMs > currentTimeMs) {
      const gapDuration = (dayEndMs - currentTimeMs) / 1000
      if (gapDuration >= this.config.minGapDuration) {
        const gap = this.createGap({
          startTime: currentTime,
          endTime: dayEndTime,
          constraints: {},
          metadata: {
            source: 'generated',
            priority: this.config.defaultPriority,
          },
        })
        this.gaps.set(gap.id, gap)
      }
    }
  }

  /**
   * 创建全天空窗（用于从零生成）
   */
  createFullDayGap(dayStartTime: string, dayEndTime: string): void {
    this.gaps.clear()

    const gap = this.createGap({
      startTime: dayStartTime,
      endTime: dayEndTime,
      constraints: {},
      metadata: {
        source: 'manual',
        priority: 1, // 最高优先级
      },
    })

    this.gaps.set(gap.id, gap)
  }

  initializeFromLayoutBands(
    layoutSlots: Array<{
      startTime: string
      endTime: string
      programType: string
      preferredProgramTypes?: string[]
      priority?: number
    }>,
  ): void {
    this.gaps.clear()

    for (const slot of layoutSlots) {
      const gap = this.createGap({
        startTime: slot.startTime,
        endTime: slot.endTime,
        constraints: {
          allowedTypes: slot.preferredProgramTypes?.length ? slot.preferredProgramTypes : [slot.programType],
          maxDuration: (new Date(slot.endTime).getTime() - new Date(slot.startTime).getTime()) / 1000,
          fixedStart: true,
          fixedEnd: true,
        },
        metadata: {
          source: 'layout',
          priority: slot.priority ?? 50,
        },
      })
      this.gaps.set(gap.id, gap)
    }
  }

  alignGapsToLayoutBands(
    layoutSlots: Array<{
      startTime: string
      endTime: string
      programType: string
      preferredProgramTypes?: string[]
      priority?: number
    }>,
  ): void {
    if (!layoutSlots.length || this.gaps.size === 0) return

    const originalGaps = Array.from(this.gaps.values())
    this.gaps.clear()

    for (const gap of originalGaps) {
      const gapStart = new Date(gap.startTime).getTime()
      const gapEnd = new Date(gap.endTime).getTime()
      const overlapSlots = layoutSlots
        .map((slot) => {
          const slotStart = new Date(slot.startTime).getTime()
          const slotEnd = new Date(slot.endTime).getTime()
          return { slot, slotStart, slotEnd }
        })
        .filter(({ slotStart, slotEnd }) => slotStart < gapEnd && slotEnd > gapStart)
        .sort((left, right) => left.slotStart - right.slotStart)

      if (!overlapSlots.length) {
        continue
      }

      for (const { slot, slotStart, slotEnd } of overlapSlots) {
        const segmentStart = Math.max(gapStart, slotStart)
        const segmentEnd = Math.min(gapEnd, slotEnd)

        if (segmentEnd > segmentStart) {
          const alignedGap = this.createGap({
            startTime: this.formatLocalDateTime(segmentStart),
            endTime: this.formatLocalDateTime(segmentEnd),
            constraints: {
              ...gap.constraints,
              allowedTypes: slot.preferredProgramTypes?.length ? slot.preferredProgramTypes : [slot.programType],
              maxDuration: (segmentEnd - segmentStart) / 1000,
              fixedStart: true,
              fixedEnd: true,
            },
            metadata: {
              source: 'layout',
              priority: slot.priority ?? gap.metadata.priority,
            },
          })
          this.gaps.set(alignedGap.id, alignedGap)
        }
      }
    }
  }

  // ==================== 空窗更新 ====================

  /**
   * 填充空窗后更新
   * 当空窗被节目填充后，空窗被消除
   */
  onGapFilled(gapId: string, items: ScheduleItemSnapshot | ScheduleItemSnapshot[]): void {
    const gap = this.gaps.get(gapId)
    if (!gap) return

    const insertedItems = Array.isArray(items) ? items : [items]
    const lastInsertedItem = insertedItems[insertedItems.length - 1]
    if (!lastInsertedItem) return

    // 更新处理状态
    const state = this.processingStates.get(gapId)
    if (state) {
      state.status = 'completed'
      state.filledItemId = lastInsertedItem.id
      state.completedAt = new Date().toISOString()
    }

    // 从待处理列表中移除
    this.gaps.delete(gapId)

    // 检查是否需要创建新的空窗（当填充节目未完全填满原空窗时）
    this.checkAndSplitGap(gap, insertedItems)
  }

  /**
   * 检查并切分空窗
   * 当填充节目未完全填满原空窗时，创建新的空窗
   */
  private checkAndSplitGap(
    originalGap: GapInfo,
    filledItems: ScheduleItemSnapshot | ScheduleItemSnapshot[],
  ): void {
    const gapStart = new Date(originalGap.startTime).getTime()
    const gapEnd = new Date(originalGap.endTime).getTime()
    const insertedItems = Array.isArray(filledItems) ? filledItems : [filledItems]
    const occupiedRanges = this.mergeTimeRanges(
      insertedItems
        .map((item) => {
          const itemStart = new Date(item.startTime).getTime()
          const itemEnd = new Date(item.endTime).getTime()
          const clippedStart = Math.max(gapStart, itemStart)
          const clippedEnd = Math.min(gapEnd, itemEnd)

          if (clippedEnd <= clippedStart) {
            return null
          }

          return {
            start: this.formatLocalDateTime(clippedStart),
            end: this.formatLocalDateTime(clippedEnd),
          }
        })
        .filter((range): range is TimeRange => Boolean(range)),
    )

    if (occupiedRanges.length === 0) {
      return
    }

    let cursor = gapStart

    for (const range of occupiedRanges) {
      const rangeStart = new Date(range.start).getTime()
      const rangeEnd = new Date(range.end).getTime()

      if (rangeStart > cursor) {
        const gapDuration = (rangeStart - cursor) / 1000
        if (gapDuration >= this.config.minGapDuration) {
          const generatedGap = this.createGap({
            startTime: this.formatLocalDateTime(cursor),
            endTime: this.formatLocalDateTime(rangeStart),
            constraints: originalGap.constraints,
            metadata: {
              ...originalGap.metadata,
              source: 'generated',
              priority: this.resolveSplitGapPriority(originalGap),
            },
          })
          this.gaps.set(generatedGap.id, generatedGap)
        }
      }

      if (rangeEnd > cursor) {
        cursor = rangeEnd
      }
    }

    if (cursor < gapEnd) {
      const trailingGapDuration = (gapEnd - cursor) / 1000
      if (trailingGapDuration >= this.config.minGapDuration) {
        const trailingGap = this.createGap({
          startTime: this.formatLocalDateTime(cursor),
          endTime: originalGap.endTime,
          constraints: originalGap.constraints,
          metadata: {
            ...originalGap.metadata,
            source: 'generated',
            priority: this.resolveSplitGapPriority(originalGap),
          },
        })
        this.gaps.set(trailingGap.id, trailingGap)
      }
    }
  }

  private resolveSplitGapPriority(originalGap: GapInfo): number {
    const isSequentialDramaBand = originalGap.constraints.allowedTypes?.includes('drama')
      && originalGap.constraints.fixedEnd
    return isSequentialDramaBand
      ? originalGap.metadata.priority
      : originalGap.metadata.priority + 1
  }

  /**
   * 删除条目后重新计算空窗
   */
  onItemDeleted(deletedItem: ScheduleItemSnapshot, neighborItems: ScheduleItemSnapshot[]): void {
    // 找到被删除条目周围的时间段
    const affectedRange: TimeRange = {
      start: deletedItem.startTime,
      end: deletedItem.endTime,
    }

    // 移除与该时间段重叠的空窗
    this.removeOverlappingGaps(affectedRange)

    // 重新计算该区域的空窗
    this.recalculateGapInRange(affectedRange, neighborItems)
  }

  /**
   * 更新条目时间后重新计算空窗
   */
  onItemTimeChanged(
    item: ScheduleItemSnapshot,
    oldTimeRange: TimeRange,
    neighborItems: ScheduleItemSnapshot[],
  ): void {
    // 移除与旧时间和新时间都重叠的空窗
    this.removeOverlappingGaps(oldTimeRange)

    const newTimeRange: TimeRange = {
      start: item.startTime,
      end: item.endTime,
    }
    this.removeOverlappingGaps(newTimeRange)

    // 重新计算受影响区域的空窗
    const affectedRange: TimeRange = {
      start: oldTimeRange.start < newTimeRange.start ? oldTimeRange.start : newTimeRange.start,
      end: oldTimeRange.end > newTimeRange.end ? oldTimeRange.end : newTimeRange.end,
    }

    this.recalculateGapInRange(affectedRange, neighborItems)
  }

  // ==================== 状态管理 ====================

  /**
   * 开始处理空窗
   */
  startProcessing(gapId: string): GapProcessingState | undefined {
    const gap = this.gaps.get(gapId)
    if (!gap) return undefined

    const state: GapProcessingState = {
      gapId,
      status: 'processing',
      attemptCount: 0,
      startedAt: new Date().toISOString(),
    }

    this.processingStates.set(gapId, state)
    return state
  }

  /**
   * 记录尝试
   */
  recordAttempt(gapId: string, selectedCandidateId?: string): void {
    const state = this.processingStates.get(gapId)
    if (state) {
      state.attemptCount++
      if (selectedCandidateId) {
        state.selectedCandidateId = selectedCandidateId
      }
    }
  }

  /**
   * 标记空窗处理失败
   */
  markFailed(gapId: string, error: string): void {
    const state = this.processingStates.get(gapId)
    if (state) {
      state.status = 'failed'
      state.error = error
      state.completedAt = new Date().toISOString()
    }
  }

  /**
   * 获取空窗处理状态
   */
  getProcessingState(gapId: string): GapProcessingState | undefined {
    return this.processingStates.get(gapId)
  }

  /**
   * 检查空窗是否正在处理
   */
  isGapProcessing(gapId: string): boolean {
    const state = this.processingStates.get(gapId)
    return state?.status === 'processing'
  }

  /**
   * 检查空窗是否已完成
   */
  isGapCompleted(gapId: string): boolean {
    const state = this.processingStates.get(gapId)
    return state?.status === 'completed'
  }

  /**
   * 检查空窗是否失败
   */
  isGapFailed(gapId: string): boolean {
    const state = this.processingStates.get(gapId)
    return state?.status === 'failed'
  }

  // ==================== 统计信息 ====================

  /**
   * 获取空窗统计
   */
  getStats(): {
    total: number
    pending: number
    processing: number
    completed: number
    failed: number
  } {
    const states = Array.from(this.processingStates.values())

    return {
      total: this.gaps.size + states.filter((s) => s.status === 'completed' || s.status === 'failed').length,
      pending: this.gaps.size,
      processing: states.filter((s) => s.status === 'processing').length,
      completed: states.filter((s) => s.status === 'completed').length,
      failed: states.filter((s) => s.status === 'failed').length,
    }
  }

  /**
   * 检查是否还有未完成的空窗
   */
  hasRemainingGaps(): boolean {
    return this.queryRemainingGaps().length > 0
  }

  /**
   * 获取总空窗时长
   */
  getTotalGapDuration(): number {
    return Array.from(this.gaps.values()).reduce((sum, gap) => sum + gap.duration, 0)
  }

  getActiveGaps(): ProgressGapInfo[] {
    return Array.from(this.gaps.values())
      .map((gap) => {
        const state = this.processingStates.get(gap.id)
        return {
          ...gap,
          status: state?.status ?? 'pending',
          error: state?.error,
        }
      })
      .sort((a, b) => {
        if (a.metadata.priority !== b.metadata.priority) {
          return a.metadata.priority - b.metadata.priority
        }
        return new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
      })
  }

  // ==================== 辅助方法 ====================

  /**
   * 创建空窗
   */
  private createGap(params: {
    startTime: string
    endTime: string
    constraints?: GapConstraints
    precedingItemId?: string
    followingItemId?: string
    metadata?: Partial<GapMetadata>
  }): GapInfo {
    const now = new Date().toISOString()
    const duration = (new Date(params.endTime).getTime() - new Date(params.startTime).getTime()) / 1000

    return {
      id: this.generateGapId(),
      startTime: params.startTime,
      endTime: params.endTime,
      duration,
      precedingItemId: params.precedingItemId,
      followingItemId: params.followingItemId,
      constraints: params.constraints || {},
      metadata: {
        source: params.metadata?.source || 'generated',
        priority: params.metadata?.priority || this.config.defaultPriority,
        createdAt: now,
        updatedAt: now,
      },
    }
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

  /**
   * 生成空窗ID
   */
  private generateGapId(): string {
    return `gap_${this.channelId}_${this.date}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }

  /**
   * 合并重叠的时间段
   */
  private mergeTimeRanges(ranges: TimeRange[]): TimeRange[] {
    if (ranges.length === 0) return []

    const sorted = [...ranges].sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())
    const merged: TimeRange[] = [sorted[0]!]

    for (let i = 1; i < sorted.length; i++) {
      const current = sorted[i]!
      const last = merged[merged.length - 1]!

      const currentStart = new Date(current.start).getTime()
      const lastEnd = new Date(last.end).getTime()

      if (currentStart <= lastEnd) {
        // 有重叠，合并
        const currentEnd = new Date(current.end).getTime()
        if (currentEnd > lastEnd) {
          last.end = current.end
        }
      } else {
        // 无重叠，添加新段
        merged.push(current)
      }
    }

    return merged
  }

  /**
   * 移除与时间段重叠的空窗
   */
  private removeOverlappingGaps(range: TimeRange): void {
    const rangeStart = new Date(range.start).getTime()
    const rangeEnd = new Date(range.end).getTime()

    for (const [gapId, gap] of this.gaps.entries()) {
      const gapStart = new Date(gap.startTime).getTime()
      const gapEnd = new Date(gap.endTime).getTime()

      // 检查是否有重叠
      if (gapStart < rangeEnd && gapEnd > rangeStart) {
        this.gaps.delete(gapId)
      }
    }
  }

  /**
   * 在指定范围内重新计算空窗
   */
  private recalculateGapInRange(range: TimeRange, neighborItems: ScheduleItemSnapshot[]): void {
    // 简化的重新计算逻辑
    // 实际实现中需要根据邻居条目重新计算空窗边界
    const rangeStart = new Date(range.start).getTime()
    const rangeEnd = new Date(range.end).getTime()

    // 找到范围内的条目
    const itemsInRange = neighborItems.filter((item) => {
      const itemStart = new Date(item.startTime).getTime()
      const itemEnd = new Date(item.endTime).getTime()
      return itemStart < rangeEnd && itemEnd > rangeStart
    })

    // 按时间排序
    itemsInRange.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())

    // 计算空窗
    let currentTime = range.start

    for (const item of itemsInRange) {
      const itemStart = new Date(item.startTime).getTime()
      const currentTimeMs = new Date(currentTime).getTime()

      if (itemStart > currentTimeMs) {
        const gapDuration = (itemStart - currentTimeMs) / 1000
        if (gapDuration >= this.config.minGapDuration) {
          const gap = this.createGap({
            startTime: currentTime,
            endTime: item.startTime,
            constraints: {},
            metadata: {
              source: 'generated',
              priority: this.config.defaultPriority,
            },
          })
          this.gaps.set(gap.id, gap)
        }
      }

      currentTime = item.endTime
    }

    // 检查末尾空窗
    const rangeEndMs = new Date(range.end).getTime()
    const currentTimeMs = new Date(currentTime).getTime()

    if (rangeEndMs > currentTimeMs) {
      const gapDuration = (rangeEndMs - currentTimeMs) / 1000
      if (gapDuration >= this.config.minGapDuration) {
        const gap = this.createGap({
          startTime: currentTime,
          endTime: range.end,
          constraints: {},
          metadata: {
            source: 'generated',
            priority: this.config.defaultPriority,
          },
        })
        this.gaps.set(gap.id, gap)
      }
    }
  }

  /**
   * 清空所有空窗
   */
  clear(): void {
    this.gaps.clear()
    this.processingStates.clear()
  }

  /**
   * 重置空窗状态（用于重试）
   */
  resetGapState(gapId: string): void {
    this.processingStates.delete(gapId)
  }
}

// 导出工厂函数
export function createGapManager(
  channelId: string,
  date: string,
  config?: Partial<GapManagerConfig>,
): GapManager {
  return new GapManager(channelId, date, config)
}
// @ts-nocheck
