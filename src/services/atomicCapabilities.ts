/**
 * 原子能力服务
 * 提供编排单的基本操作能力
 * 
 * 原则：
 * 1. 每个操作都是原子的，可独立执行
 * 2. 操作前自动创建快照，支持回退
 * 3. 操作后自动触发校验
 * 4. 返回结构化结果，包含变更详情
 */

import type {
  ScheduleItemSnapshot,
  ValidationReport,
  GapInfo,
} from '@/types/orchestration'

/** 原子操作结果 */
export interface AtomicOperationResult<T = any> {
  success: boolean
  data?: T
  error?: string
  changes?: OperationChange[]
  affectedItems?: string[]
  affectedTimeRanges?: { start: string; end: string }[]
}

/** 操作变更 */
export interface OperationChange {
  type: 'insert' | 'delete' | 'update' | 'move'
  itemId: string
  field?: string
  oldValue?: any
  newValue?: any
}

/** 条目快照 */
export interface ItemSnapshot {
  item: ScheduleItemSnapshot
  timestamp: string
  operation: string
}

/** 原子能力配置 */
export interface AtomicCapabilitiesConfig {
  enableSnapshot: boolean
  enableAutoValidation: boolean
  maxSnapshotsPerItem: number
}

/** 默认配置 */
const DEFAULT_CONFIG: AtomicCapabilitiesConfig = {
  enableSnapshot: true,
  enableAutoValidation: true,
  maxSnapshotsPerItem: 10,
}

/** 原子能力服务 */
export class AtomicCapabilities {
  private items: Map<string, ScheduleItemSnapshot> = new Map()
  private snapshots: Map<string, ItemSnapshot[]> = new Map()
  private config: AtomicCapabilitiesConfig
  private onValidation?: (scope: 'item' | 'full') => Promise<ValidationReport>

  constructor(
    config?: Partial<AtomicCapabilitiesConfig>,
    onValidation?: (scope: 'item' | 'full') => Promise<ValidationReport>,
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.onValidation = onValidation
  }

  // ==================== 快照管理 ====================

  /**
   * 创建条目快照
   */
  private createSnapshot(itemId: string, operation: string): void {
    if (!this.config.enableSnapshot) return

    const item = this.items.get(itemId)
    if (!item) return

    const snapshotList = this.snapshots.get(itemId) || []
    
    // 添加新快照
    snapshotList.push({
      item: { ...item },
      timestamp: new Date().toISOString(),
      operation,
    })

    // 限制快照数量
    if (snapshotList.length > this.config.maxSnapshotsPerItem) {
      snapshotList.shift()
    }

    this.snapshots.set(itemId, snapshotList)
  }

  /**
   * 恢复到快照
   */
  restoreSnapshot(itemId: string, snapshotIndex?: number): AtomicOperationResult {
    const snapshotList = this.snapshots.get(itemId)
    if (!snapshotList || snapshotList.length === 0) {
      return {
        success: false,
        error: `未找到条目 ${itemId} 的快照`,
      }
    }

    const index = snapshotIndex !== undefined 
      ? snapshotIndex 
      : snapshotList.length - 1
    
    const snapshot = snapshotList[index]
    if (!snapshot) {
      return {
        success: false,
        error: `无效的快照索引: ${index}`,
      }
    }

    // 恢复条目
    this.items.set(itemId, { ...snapshot.item })

    return {
      success: true,
      data: snapshot.item,
      changes: [{
        type: 'update',
        itemId,
      }],
    }
  }

  /**
   * 获取条目快照列表
   */
  getSnapshots(itemId: string): ItemSnapshot[] {
    return this.snapshots.get(itemId) || []
  }

  /**
   * 清除快照
   */
  clearSnapshots(itemId?: string): void {
    if (itemId) {
      this.snapshots.delete(itemId)
    } else {
      this.snapshots.clear()
    }
  }

  // ==================== 原子操作 ====================

  /**
   * 批量添加条目
   */
  async appendItems(
    items: ScheduleItemSnapshot[],
    options?: { skipValidation?: boolean },
  ): Promise<AtomicOperationResult<{ items: ScheduleItemSnapshot[] }>> {
    try {
      const addedItems: ScheduleItemSnapshot[] = []
      const changes: OperationChange[] = []

      for (const item of items) {
        // 检查是否已存在
        if (this.items.has(item.id)) {
          console.warn(`条目 ${item.id} 已存在，跳过`)
          continue
        }

        // 添加条目
        this.items.set(item.id, { ...item })
        addedItems.push(item)
        
        changes.push({
          type: 'insert',
          itemId: item.id,
        })

        // 创建快照
        this.createSnapshot(item.id, 'append')
      }

      // 触发校验
      if (this.config.enableAutoValidation && !options?.skipValidation) {
        await this.triggerValidation('full')
      }

      return {
        success: true,
        data: { items: addedItems },
        changes,
        affectedItems: addedItems.map((i) => i.id),
        affectedTimeRanges: addedItems.map((i) => ({ start: i.startTime, end: i.endTime })),
      }
    } catch (error) {
      return {
        success: false,
        error: `批量添加失败: ${(error as Error).message}`,
      }
    }
  }

  /**
   * 替换条目
   */
  async replaceItem(
    itemId: string,
    newItem: ScheduleItemSnapshot,
    options?: { skipValidation?: boolean },
  ): Promise<AtomicOperationResult<{ oldItem: ScheduleItemSnapshot; newItem: ScheduleItemSnapshot }>> {
    try {
      const oldItem = this.items.get(itemId)
      if (!oldItem) {
        return {
          success: false,
          error: `未找到条目: ${itemId}`,
        }
      }

      // 创建快照
      this.createSnapshot(itemId, 'replace')

      // 替换条目
      this.items.set(itemId, { ...newItem })

      // 触发校验
      if (this.config.enableAutoValidation && !options?.skipValidation) {
        await this.triggerValidation('item')
      }

      return {
        success: true,
        data: { oldItem, newItem },
        changes: [{
          type: 'update',
          itemId,
        }],
        affectedItems: [itemId],
        affectedTimeRanges: [{ start: newItem.startTime, end: newItem.endTime }],
      }
    } catch (error) {
      return {
        success: false,
        error: `替换失败: ${(error as Error).message}`,
      }
    }
  }

  /**
   * 删除条目
   */
  async deleteItem(
    itemId: string,
    options?: { skipValidation?: boolean },
  ): Promise<AtomicOperationResult<{ deletedItem: ScheduleItemSnapshot }>> {
    try {
      const item = this.items.get(itemId)
      if (!item) {
        return {
          success: false,
          error: `未找到条目: ${itemId}`,
        }
      }

      // 创建快照
      this.createSnapshot(itemId, 'delete')

      // 删除条目
      this.items.delete(itemId)

      // 触发校验
      if (this.config.enableAutoValidation && !options?.skipValidation) {
        await this.triggerValidation('full')
      }

      return {
        success: true,
        data: { deletedItem: item },
        changes: [{
          type: 'delete',
          itemId,
        }],
        affectedItems: [itemId],
        affectedTimeRanges: [{ start: item.startTime, end: item.endTime }],
      }
    } catch (error) {
      return {
        success: false,
        error: `删除失败: ${(error as Error).message}`,
      }
    }
  }

  /**
   * 移动条目
   */
  async moveItem(
    itemId: string,
    newStartTime: string,
    options?: { skipValidation?: boolean },
  ): Promise<AtomicOperationResult<{ item: ScheduleItemSnapshot; oldStartTime: string; oldEndTime: string }>> {
    try {
      const item = this.items.get(itemId)
      if (!item) {
        return {
          success: false,
          error: `未找到条目: ${itemId}`,
        }
      }

      // 保存旧时间
      const oldStartTime = item.startTime
      const oldEndTime = item.endTime

      // 创建快照
      this.createSnapshot(itemId, 'move')

      // 计算新的结束时间
      const duration = item.duration
      const newStartMs = new Date(newStartTime).getTime()
      const newEndMs = newStartMs + duration * 1000
      const newEndTime = new Date(newEndMs).toISOString()

      // 更新条目
      const updatedItem: ScheduleItemSnapshot = {
        ...item,
        startTime: newStartTime,
        endTime: newEndTime,
      }
      this.items.set(itemId, updatedItem)

      // 触发校验
      if (this.config.enableAutoValidation && !options?.skipValidation) {
        await this.triggerValidation('item')
      }

      return {
        success: true,
        data: { item: updatedItem, oldStartTime, oldEndTime },
        changes: [{
          type: 'move',
          itemId,
        }],
        affectedItems: [itemId],
        affectedTimeRanges: [
          { start: oldStartTime, end: oldEndTime },
          { start: newStartTime, end: newEndTime },
        ],
      }
    } catch (error) {
      return {
        success: false,
        error: `移动失败: ${(error as Error).message}`,
      }
    }
  }

  /**
   * 更新条目字段
   */
  async updateField(
    itemId: string,
    field: string,
    value: any,
    options?: { skipValidation?: boolean },
  ): Promise<AtomicOperationResult<{ item: ScheduleItemSnapshot; oldValue: any; newValue: any }>> {
    try {
      const item = this.items.get(itemId)
      if (!item) {
        return {
          success: false,
          error: `未找到条目: ${itemId}`,
        }
      }

      // 保存旧值
      const oldValue = (item as any)[field]

      // 创建快照
      this.createSnapshot(itemId, 'update_field')

      // 更新字段
      const updatedItem = { ...item, [field]: value }
      
      // 如果更新的是时间相关字段，需要重新计算
      if (field === 'startTime' || field === 'duration') {
        const startTime = field === 'startTime' ? value : item.startTime
        const duration = field === 'duration' ? value : item.duration
        const startMs = new Date(startTime).getTime()
        const endMs = startMs + duration * 1000
        updatedItem.endTime = new Date(endMs).toISOString()
      }

      this.items.set(itemId, updatedItem)

      // 触发校验
      if (this.config.enableAutoValidation && !options?.skipValidation) {
        await this.triggerValidation('item')
      }

      return {
        success: true,
        data: { item: updatedItem, oldValue, newValue: value },
        changes: [{
          type: 'update',
          itemId,
          field,
          oldValue,
          newValue: value,
        }],
        affectedItems: [itemId],
        affectedTimeRanges: [{ start: updatedItem.startTime, end: updatedItem.endTime }],
      }
    } catch (error) {
      return {
        success: false,
        error: `更新字段失败: ${(error as Error).message}`,
      }
    }
  }

  // ==================== 查询方法 ====================

  /**
   * 获取所有条目
   */
  getAllItems(): ScheduleItemSnapshot[] {
    return Array.from(this.items.values()).sort(
      (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime(),
    )
  }

  /**
   * 获取单个条目
   */
  getItem(itemId: string): ScheduleItemSnapshot | undefined {
    return this.items.get(itemId)
  }

  /**
   * 根据时间范围查询条目
   */
  getItemsInTimeRange(startTime: string, endTime: string): ScheduleItemSnapshot[] {
    const startMs = new Date(startTime).getTime()
    const endMs = new Date(endTime).getTime()

    return this.getAllItems().filter((item) => {
      const itemStart = new Date(item.startTime).getTime()
      const itemEnd = new Date(item.endTime).getTime()
      return itemStart < endMs && itemEnd > startMs
    })
  }

  /**
   * 检查时间范围是否可用（无重叠）
   */
  isTimeRangeAvailable(startTime: string, endTime: string, excludeItemId?: string): boolean {
    const items = this.getItemsInTimeRange(startTime, endTime)
    if (excludeItemId) {
      return items.filter((i) => i.id !== excludeItemId).length === 0
    }
    return items.length === 0
  }

  /**
   * 获取条目数量
   */
  getItemCount(): number {
    return this.items.size
  }

  // ==================== 批量操作 ====================

  /**
   * 批量删除
   */
  async batchDelete(
    itemIds: string[],
    options?: { skipValidation?: boolean },
  ): Promise<AtomicOperationResult<{ deletedItems: ScheduleItemSnapshot[] }>> {
    const deletedItems: ScheduleItemSnapshot[] = []
    const errors: string[] = []

    for (const itemId of itemIds) {
      const result = await this.deleteItem(itemId, { skipValidation: true })
      if (result.success) {
        deletedItems.push(result.data!.deletedItem)
      } else {
        errors.push(result.error!)
      }
    }

    // 触发校验
    if (this.config.enableAutoValidation && !options?.skipValidation && deletedItems.length > 0) {
      await this.triggerValidation('full')
    }

    return {
      success: errors.length === 0,
      data: { deletedItems },
      error: errors.length > 0 ? `部分删除失败: ${errors.join('; ')}` : undefined,
      affectedItems: deletedItems.map((i) => i.id),
    }
  }

  /**
   * 清空所有条目
   */
  async clearAll(): Promise<AtomicOperationResult<{ count: number }>> {
    const count = this.items.size
    
    // 为每个条目创建快照
    for (const [itemId] of this.items) {
      this.createSnapshot(itemId, 'clear')
    }

    this.items.clear()

    return {
      success: true,
      data: { count },
    }
  }

  // ==================== 辅助方法 ====================

  /**
   * 触发校验
   */
  private async triggerValidation(scope: 'item' | 'full'): Promise<ValidationReport | undefined> {
    if (!this.onValidation) return undefined
    return this.onValidation(scope)
  }

  /**
   * 设置校验回调
   */
  setValidationCallback(callback: (scope: 'item' | 'full') => Promise<ValidationReport>): void {
    this.onValidation = callback
  }

  /**
   * 从外部数据加载条目
   */
  loadItems(items: ScheduleItemSnapshot[]): void {
    this.items.clear()
    for (const item of items) {
      this.items.set(item.id, { ...item })
    }
  }

  /**
   * 导出条目数据
   */
  exportItems(): ScheduleItemSnapshot[] {
    return this.getAllItems()
  }
}

// 导出工厂函数
let globalAtomicCapabilities: AtomicCapabilities | null = null

export function getAtomicCapabilities(
  config?: Partial<AtomicCapabilitiesConfig>,
  onValidation?: (scope: 'item' | 'full') => Promise<ValidationReport>,
): AtomicCapabilities {
  if (!globalAtomicCapabilities) {
    globalAtomicCapabilities = new AtomicCapabilities(config, onValidation)
  }
  return globalAtomicCapabilities
}

export function resetAtomicCapabilities(): void {
  globalAtomicCapabilities = null
}
