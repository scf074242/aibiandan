/**
 * 回退管理器
 * 实现三级回退机制：条目级 / 空窗级 / 会话级
 *
 * 原则：
 * 1. 写入失败时触发条目级回退
 * 2. 连续失败时触发空窗级回退
 * 3. 达到阈值时转人工（会话级回退）
 */

import type {
  ScheduleItemSnapshot,
  GapInfo,
  PlanningSession,
  FallbackLevel,
  FallbackRecord,
} from '@/types/orchestration'
import type { AtomicCapabilities } from './atomicCapabilities'
import type { GapManager } from './gapManager'

/** 回退管理器配置 */
export interface FallbackManagerConfig {
  maxItemRetries: number // 条目级最大重试次数
  maxGapRetries: number // 空窗级最大重试次数
  enableAutoFallback: boolean // 是否启用自动回退
  snapshotLimit: number // 每个条目最大快照数
}

/** 默认配置 */
const DEFAULT_CONFIG: FallbackManagerConfig = {
  maxItemRetries: 3,
  maxGapRetries: 2,
  enableAutoFallback: true,
  snapshotLimit: 10,
}

/** 条目处理记录 */
interface ItemProcessingRecord {
  itemId: string
  gapId: string
  attemptCount: number
  snapshots: ItemSnapshot[]
  lastError?: string
}

/** 条目快照 */
interface ItemSnapshot {
  item: ScheduleItemSnapshot
  timestamp: string
  operation: string
}

/** 空窗处理记录 */
interface GapProcessingRecord {
  gapId: string
  itemIds: string[] // 该空窗内处理的条目ID列表
  attemptCount: number
  lastError?: string
}

/** 回退管理器 */
export class FallbackManager {
  private config: FallbackManagerConfig
  private atomicCapabilities: AtomicCapabilities
  private gapManager: GapManager

  // 处理记录
  private itemRecords: Map<string, ItemProcessingRecord> = new Map()
  private gapRecords: Map<string, GapProcessingRecord> = new Map()
  private fallbackHistory: FallbackRecord[] = []

  // 会话级状态
  private sessionPaused: boolean = false
  private pauseReason?: string

  constructor(
    atomicCapabilities: AtomicCapabilities,
    gapManager: GapManager,
    config?: Partial<FallbackManagerConfig>,
  ) {
    this.atomicCapabilities = atomicCapabilities
    this.gapManager = gapManager
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  // ==================== 条目级回退 ====================

  /**
   * 记录条目处理开始
   */
  recordItemStart(itemId: string, gapId: string): void {
    const record = this.itemRecords.get(itemId)
    if (record) {
      record.attemptCount++
    } else {
      this.itemRecords.set(itemId, {
        itemId,
        gapId,
        attemptCount: 1,
        snapshots: [],
      })
    }
  }

  /**
   * 创建条目快照
   */
  createItemSnapshot(itemId: string, item: ScheduleItemSnapshot, operation: string): void {
    const record = this.itemRecords.get(itemId)
    if (!record) return

    record.snapshots.push({
      item: { ...item },
      timestamp: new Date().toISOString(),
      operation,
    })

    // 限制快照数量
    if (record.snapshots.length > this.config.snapshotLimit) {
      record.snapshots.shift()
    }
  }

  /**
   * 记录条目处理失败
   */
  recordItemFailure(itemId: string, error: string): void {
    const record = this.itemRecords.get(itemId)
    if (record) {
      record.lastError = error
    }
  }

  /**
   * 条目级回退
   * 返回：是否成功回退
   */
  async fallbackItem(itemId: string): Promise<{
    success: boolean
    canRetry: boolean
    message: string
    restoredItem?: ScheduleItemSnapshot
  }> {
    if (!this.config.enableAutoFallback) {
      return {
        success: false,
        canRetry: false,
        message: '自动回退已禁用',
      }
    }

    const record = this.itemRecords.get(itemId)
    if (!record) {
      return {
        success: false,
        canRetry: false,
        message: `未找到条目记录: ${itemId}`,
      }
    }

    // 检查是否超过最大重试次数
    if (record.attemptCount >= this.config.maxItemRetries) {
      // 触发空窗级回退
      return {
        success: false,
        canRetry: false,
        message: `条目 ${itemId} 已达到最大重试次数 ${this.config.maxItemRetries}，需要空窗级回退`,
      }
    }

    // 恢复到上一个快照
    if (record.snapshots.length === 0) {
      return {
        success: false,
        canRetry: false,
        message: `条目 ${itemId} 没有可用的快照`,
      }
    }

    const lastSnapshot = record.snapshots[record.snapshots.length - 1]!

    // 使用原子能力恢复
    const restoreResult = await this.atomicCapabilities.replaceItem(
      itemId,
      lastSnapshot.item,
      { skipValidation: true },
    )

    if (!restoreResult.success) {
      return {
        success: false,
        canRetry: false,
        message: `回退失败: ${restoreResult.error}`,
      }
    }

    // 记录回退历史
    this.recordFallback('item', itemId, `条目级回退到 ${lastSnapshot.operation} 状态`)

    return {
      success: true,
      canRetry: true,
      message: `条目 ${itemId} 已回退，可尝试新候选（尝试 ${record.attemptCount}/${this.config.maxItemRetries}）`,
      restoredItem: lastSnapshot.item,
    }
  }

  // ==================== 空窗级回退 ====================

  /**
   * 记录空窗处理开始
   */
  recordGapStart(gapId: string): void {
    const record = this.gapRecords.get(gapId)
    if (record) {
      record.attemptCount++
    } else {
      this.gapRecords.set(gapId, {
        gapId,
        itemIds: [],
        attemptCount: 1,
      })
    }
  }

  /**
   * 记录空窗内条目
   */
  recordGapItem(gapId: string, itemId: string): void {
    const record = this.gapRecords.get(gapId)
    if (record && !record.itemIds.includes(itemId)) {
      record.itemIds.push(itemId)
    }
  }

  /**
   * 记录空窗处理失败
   */
  recordGapFailure(gapId: string, error: string): void {
    const record = this.gapRecords.get(gapId)
    if (record) {
      record.lastError = error
    }
  }

  /**
   * 空窗级回退
   * 回退该空窗内最近若干条
   */
  async fallbackGap(gapId: string): Promise<{
    success: boolean
    canRetry: boolean
    message: string
    restoredItems?: ScheduleItemSnapshot[]
  }> {
    if (!this.config.enableAutoFallback) {
      return {
        success: false,
        canRetry: false,
        message: '自动回退已禁用',
      }
    }

    const record = this.gapRecords.get(gapId)
    if (!record) {
      return {
        success: false,
        canRetry: false,
        message: `未找到空窗记录: ${gapId}`,
      }
    }

    // 检查是否超过最大重试次数
    if (record.attemptCount >= this.config.maxGapRetries) {
      // 触发会话级回退
      return {
        success: false,
        canRetry: false,
        message: `空窗 ${gapId} 已达到最大重试次数 ${this.config.maxGapRetries}，需要会话级回退（转人工）`,
      }
    }

    // 批量回退空窗内的条目
    const restoredItems: ScheduleItemSnapshot[] = []
    const failedItems: string[] = []

    for (const itemId of record.itemIds) {
      const itemRecord = this.itemRecords.get(itemId)
      if (itemRecord && itemRecord.snapshots.length > 0) {
        const lastSnapshot = itemRecord.snapshots[itemRecord.snapshots.length - 1]!
        const restoreResult = await this.atomicCapabilities.replaceItem(
          itemId,
          lastSnapshot.item,
          { skipValidation: true },
        )

        if (restoreResult.success) {
          restoredItems.push(lastSnapshot.item)
        } else {
          failedItems.push(itemId)
        }
      }
    }

    // 重新计算空窗
    // 这里简化处理，实际应该根据恢复后的条目重新计算
    this.gapManager.resetGapState(gapId)

    // 记录回退历史
    this.recordFallback('gap', gapId, `空窗级回退，恢复了 ${restoredItems.length} 个条目`)

    return {
      success: failedItems.length === 0,
      canRetry: true,
      message: `空窗 ${gapId} 已回退（尝试 ${record.attemptCount}/${this.config.maxGapRetries}），恢复 ${restoredItems.length} 个条目${failedItems.length > 0 ? `，${failedItems.length} 个失败` : ''}`,
      restoredItems,
    }
  }

  // ==================== 会话级回退 ====================

  /**
   * 会话级回退（转人工）
   */
  async fallbackSession(session: PlanningSession, reason: string): Promise<{
    success: boolean
    message: string
    report: {
      sessionId: string
      pauseReason: string
      processedGaps: number
      failedGaps: number
      fallbackHistory: FallbackRecord[]
    }
  }> {
    this.sessionPaused = true
    this.pauseReason = reason

    // 生成问题报告
    const report = {
      sessionId: session.id,
      pauseReason: reason,
      processedGaps: session.gaps.completed.length,
      failedGaps: session.gaps.failed.length,
      fallbackHistory: this.fallbackHistory,
    }

    // 记录回退历史
    this.recordFallback('session', session.id, `会话级回退（转人工）: ${reason}`)

    return {
      success: true,
      message: `会话已暂停并转人工处理: ${reason}`,
      report,
    }
  }

  /**
   * 检查会话是否已暂停
   */
  isSessionPaused(): boolean {
    return this.sessionPaused
  }

  /**
   * 获取暂停原因
   */
  getPauseReason(): string | undefined {
    return this.pauseReason
  }

  /**
   * 恢复会话
   */
  resumeSession(): void {
    this.sessionPaused = false
    this.pauseReason = undefined
  }

  // ==================== 自动回退决策 ====================

  /**
   * 自动决定回退级别
   */
  async autoFallback(
    itemId: string,
    gapId: string,
    error: string,
  ): Promise<{
    level: FallbackLevel
    success: boolean
    message: string
    canContinue: boolean
  }> {
    // 记录失败
    this.recordItemFailure(itemId, error)
    this.recordGapFailure(gapId, error)

    const itemRecord = this.itemRecords.get(itemId)
    const gapRecord = this.gapRecords.get(gapId)

    // 决策逻辑
    if (!itemRecord || itemRecord.attemptCount < this.config.maxItemRetries) {
      // 尝试条目级回退
      const result = await this.fallbackItem(itemId)
      return {
        level: 'item',
        success: result.success,
        message: result.message,
        canContinue: result.canRetry,
      }
    }

    if (!gapRecord || gapRecord.attemptCount < this.config.maxGapRetries) {
      // 尝试空窗级回退
      const result = await this.fallbackGap(gapId)
      return {
        level: 'gap',
        success: result.success,
        message: result.message,
        canContinue: result.canRetry,
      }
    }

    // 需要会话级回退（转人工）
    return {
      level: 'session',
      success: false,
      message: `条目 ${itemId} 和空窗 ${gapId} 均已达到最大重试次数，需要人工介入`,
      canContinue: false,
    }
  }

  // ==================== 记录管理 ====================

  /**
   * 记录回退历史
   */
  private recordFallback(level: FallbackLevel, targetId: string, reason: string): void {
    const record: FallbackRecord = {
      id: `fallback_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      level,
      timestamp: new Date().toISOString(),
      reason,
      affectedItems: [targetId],
      snapshot: {}, // 简化处理
    }

    this.fallbackHistory.push(record)
  }

  /**
   * 获取回退历史
   */
  getFallbackHistory(): FallbackRecord[] {
    return [...this.fallbackHistory]
  }

  /**
   * 获取条目处理记录
   */
  getItemRecord(itemId: string): ItemProcessingRecord | undefined {
    return this.itemRecords.get(itemId)
  }

  /**
   * 获取空窗处理记录
   */
  getGapRecord(gapId: string): GapProcessingRecord | undefined {
    return this.gapRecords.get(gapId)
  }

  /**
   * 获取统计信息
   */
  getStats(): {
    totalItemAttempts: number
    totalGapAttempts: number
    fallbackCount: number
    itemLevelFallbacks: number
    gapLevelFallbacks: number
    sessionLevelFallbacks: number
  } {
    const itemAttempts = Array.from(this.itemRecords.values()).reduce(
      (sum, r) => sum + r.attemptCount,
      0,
    )
    const gapAttempts = Array.from(this.gapRecords.values()).reduce(
      (sum, r) => sum + r.attemptCount,
      0,
    )

    return {
      totalItemAttempts: itemAttempts,
      totalGapAttempts: gapAttempts,
      fallbackCount: this.fallbackHistory.length,
      itemLevelFallbacks: this.fallbackHistory.filter((f) => f.level === 'item').length,
      gapLevelFallbacks: this.fallbackHistory.filter((f) => f.level === 'gap').length,
      sessionLevelFallbacks: this.fallbackHistory.filter((f) => f.level === 'session').length,
    }
  }

  // ==================== 清理 ====================

  /**
   * 清理记录
   */
  clear(): void {
    this.itemRecords.clear()
    this.gapRecords.clear()
    this.fallbackHistory = []
    this.sessionPaused = false
    this.pauseReason = undefined
  }

  /**
   * 清理指定空窗的记录
   */
  clearGapRecords(gapId: string): void {
    this.gapRecords.delete(gapId)
    // 清理该空窗相关的条目记录
    for (const [itemId, record] of this.itemRecords.entries()) {
      if (record.gapId === gapId) {
        this.itemRecords.delete(itemId)
      }
    }
  }
}

// 导出工厂函数
let globalFallbackManager: FallbackManager | null = null

export function getFallbackManager(
  atomicCapabilities?: AtomicCapabilities,
  gapManager?: GapManager,
  config?: Partial<FallbackManagerConfig>,
): FallbackManager {
  if (!globalFallbackManager) {
    if (!atomicCapabilities || !gapManager) {
      throw new Error('Atomic capabilities and gap manager are required for first initialization')
    }
    globalFallbackManager = new FallbackManager(atomicCapabilities, gapManager, config)
  }
  return globalFallbackManager
}

export function resetFallbackManager(): void {
  globalFallbackManager = null
}
// @ts-nocheck
