/**
 * 确定性校验引擎
 * 负责编排单的规则校验
 * 
 * 校验规则：
 * 1. 空窗检测 - 是否还有未填充空窗
 * 2. 重叠检测 - 条目时间是否重叠
 * 3. 边界匹配 - 首尾条目是否对齐版面
 * 4. 时长一致性检测
 * 5. 素材/成品关联检测
 */

import type {
  ScheduleItemSnapshot,
  ValidationReport,
  ValidationIssue,
  ValidationIssueType,
  ValidationSeverity,
  GapInfo,
  FixedItem,
  LayoutSlot,
} from '@/types/orchestration'

/** 校验规则配置 */
export interface ValidationRule {
  id: string
  name: string
  type: ValidationIssueType
  severity: ValidationSeverity
  enabled: boolean
  check: (context: ValidationContext) => ValidationIssue[]
}

/** 校验上下文 */
export interface ValidationContext {
  items: ScheduleItemSnapshot[]
  gaps: GapInfo[]
  fixedItems: FixedItem[]
  layoutSlots: LayoutSlot[]
  dayStartTime: string
  dayEndTime: string
}

/** 校验引擎配置 */
export interface ValidationEngineConfig {
  enableAllRules: boolean
  customRules: ValidationRule[]
  stopOnCritical: boolean
}

/** 默认配置 */
const DEFAULT_CONFIG: ValidationEngineConfig = {
  enableAllRules: true,
  customRules: [],
  stopOnCritical: false,
}

/** 确定性校验引擎 */
export class ValidationEngine {
  private config: ValidationEngineConfig
  private rules: ValidationRule[] = []

  constructor(config?: Partial<ValidationEngineConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.initializeRules()
  }

  /**
   * 初始化内置规则
   */
  private initializeRules(): void {
    this.rules = [
      // 空窗检测
      {
        id: 'gap-check',
        name: '空窗检测',
        type: 'gap',
        severity: 'warning',
        enabled: true,
        check: this.checkGaps.bind(this),
      },
      // 重叠检测
      {
        id: 'overlap-check',
        name: '重叠检测',
        type: 'overlap',
        severity: 'critical',
        enabled: true,
        check: this.checkOverlaps.bind(this),
      },
      // 边界匹配
      {
        id: 'boundary-check',
        name: '边界匹配',
        type: 'boundary_mismatch',
        severity: 'warning',
        enabled: true,
        check: this.checkBoundaries.bind(this),
      },
      // 时长一致性
      {
        id: 'duration-check',
        name: '时长一致性',
        type: 'duration_mismatch',
        severity: 'warning',
        enabled: true,
        check: this.checkDurationConsistency.bind(this),
      },
      // 固定项冲突
      {
        id: 'fixed-item-check',
        name: '固定项冲突',
        type: 'constraint_violation',
        severity: 'critical',
        enabled: true,
        check: this.checkFixedItemConflicts.bind(this),
      },
      // 版面约束
      {
        id: 'layout-check',
        name: '版面约束',
        type: 'constraint_violation',
        severity: 'warning',
        enabled: true,
        check: this.checkLayoutConstraints.bind(this),
      },
      // 连续性问题
      {
        id: 'continuity-check',
        name: '连续性问题',
        type: 'gap',
        severity: 'info',
        enabled: true,
        check: this.checkContinuity.bind(this),
      },
      ...this.config.customRules,
    ]
  }

  /**
   * 执行完整校验
   */
  validate(context: ValidationContext): ValidationReport {
    const issues: ValidationIssue[] = []
    const enabledRules = this.rules.filter((r) => r.enabled)

    for (const rule of enabledRules) {
      try {
        const ruleIssues = rule.check(context)
        issues.push(...ruleIssues)

        // 如果配置为遇到严重错误停止
        if (this.config.stopOnCritical && ruleIssues.some((i) => i.severity === 'critical')) {
          break
        }
      } catch (error) {
        console.error(`Rule ${rule.id} failed:`, error)
      }
    }

    // 统计
    const criticalCount = issues.filter((i) => i.severity === 'critical').length
    const warningCount = issues.filter((i) => i.severity === 'warning').length
    const infoCount = issues.filter((i) => i.severity === 'info').length

    return {
      id: `validation_${Date.now()}`,
      scope: 'full',
      targetId: 'schedule',
      timestamp: new Date().toISOString(),
      issues,
      summary: {
        totalIssues: issues.length,
        criticalCount,
        warningCount,
        infoCount,
      },
      isValid: criticalCount === 0,
    }
  }

  /**
   * 校验单个条目
   */
  validateItem(item: ScheduleItemSnapshot, context: ValidationContext): ValidationReport {
    const issues: ValidationIssue[] = []

    // 时长校验
    const calculatedDuration = this.calculateDuration(item.startTime, item.endTime)
    if (Math.abs(calculatedDuration - item.duration) > 1) {
      issues.push({
        id: `issue_${Date.now()}_duration`,
        type: 'duration_mismatch',
        severity: 'warning',
        message: `条目 "${item.programName}" 时长不一致: 声明 ${item.duration}秒, 实际 ${calculatedDuration}秒`,
        location: { itemId: item.id },
        suggestion: '检查开始时间和结束时间',
        createdAt: new Date().toISOString(),
      })
    }

    // 时间范围校验
    if (new Date(item.startTime) >= new Date(item.endTime)) {
      issues.push({
        id: `issue_${Date.now()}_time`,
        type: 'constraint_violation',
        severity: 'critical',
        message: `条目 "${item.programName}" 开始时间晚于或等于结束时间`,
        location: { itemId: item.id },
        suggestion: '修正时间设置',
        createdAt: new Date().toISOString(),
      })
    }

    return {
      id: `validation_${Date.now()}`,
      scope: 'item',
      targetId: item.id,
      timestamp: new Date().toISOString(),
      issues,
      summary: {
        totalIssues: issues.length,
        criticalCount: issues.filter((i) => i.severity === 'critical').length,
        warningCount: issues.filter((i) => i.severity === 'warning').length,
        infoCount: issues.filter((i) => i.severity === 'info').length,
      },
      isValid: issues.filter((i) => i.severity === 'critical').length === 0,
    }
  }

  // ==================== 具体校验规则 ====================

  /**
   * 空窗检测
   */
  private checkGaps(context: ValidationContext): ValidationIssue[] {
    const issues: ValidationIssue[] = []

    for (const gap of context.gaps) {
      if (gap.duration > 60) {
        // 大于1分钟的空窗
        issues.push({
          id: `issue_${Date.now()}_gap_${gap.id}`,
          type: 'gap',
          severity: 'warning',
          message: `存在未填充空窗: ${this.formatTime(gap.startTime)} - ${this.formatTime(gap.endTime)} (${this.formatDuration(gap.duration)})`,
          location: { gapId: gap.id, timeRange: { start: gap.startTime, end: gap.endTime } },
          suggestion: '添加节目填充空窗',
          createdAt: new Date().toISOString(),
        })
      }
    }

    return issues
  }

  /**
   * 重叠检测
   */
  private checkOverlaps(context: ValidationContext): ValidationIssue[] {
    const issues: ValidationIssue[] = []
    const items = [...context.items].sort(
      (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime(),
    )

    for (let i = 0; i < items.length - 1; i++) {
      const current = items[i]!
      const next = items[i + 1]!

      const currentEnd = new Date(current.endTime).getTime()
      const nextStart = new Date(next.startTime).getTime()

      if (currentEnd > nextStart) {
        const overlapDuration = Math.floor((currentEnd - nextStart) / 1000)
        issues.push({
          id: `issue_${Date.now()}_overlap_${current.id}_${next.id}`,
          type: 'overlap',
          severity: 'critical',
          message: `条目重叠: "${current.programName}" 与 "${next.programName}" 重叠 ${this.formatDuration(overlapDuration)}`,
          location: {
            itemId: current.id,
            timeRange: { start: next.startTime, end: current.endTime },
          },
          suggestion: '调整条目时间，消除重叠',
          createdAt: new Date().toISOString(),
        })
      }
    }

    return issues
  }

  /**
   * 边界匹配检测
   */
  private checkBoundaries(context: ValidationContext): ValidationIssue[] {
    const issues: ValidationIssue[] = []
    const items = context.items

    if (items.length === 0) return issues

    // 检查首条
    const firstItem = items[0]!
    const dayStart = new Date(context.dayStartTime).getTime()
    const firstStart = new Date(firstItem.startTime).getTime()

    if (firstStart > dayStart) {
      const gapDuration = Math.floor((firstStart - dayStart) / 1000)
      issues.push({
        id: `issue_${Date.now()}_boundary_start`,
        type: 'boundary_mismatch',
        severity: 'warning',
        message: `首条节目开始时间晚于日开始时间，空窗 ${this.formatDuration(gapDuration)}`,
        location: {
          itemId: firstItem.id,
          timeRange: { start: context.dayStartTime, end: firstItem.startTime },
        },
        suggestion: '调整首条节目开始时间或添加开场节目',
        createdAt: new Date().toISOString(),
      })
    }

    // 检查末条
    const lastItem = items[items.length - 1]!
    const dayEnd = new Date(context.dayEndTime).getTime()
    const lastEnd = new Date(lastItem.endTime).getTime()

    if (lastEnd < dayEnd) {
      const gapDuration = Math.floor((dayEnd - lastEnd) / 1000)
      issues.push({
        id: `issue_${Date.now()}_boundary_end`,
        type: 'boundary_mismatch',
        severity: 'warning',
        message: `末条节目结束时间早于日结束时间，空窗 ${this.formatDuration(gapDuration)}`,
        location: {
          itemId: lastItem.id,
          timeRange: { start: lastItem.endTime, end: context.dayEndTime },
        },
        suggestion: '调整末条节目结束时间或添加收尾节目',
        createdAt: new Date().toISOString(),
      })
    }

    return issues
  }

  /**
   * 时长一致性检测
   */
  private checkDurationConsistency(context: ValidationContext): ValidationIssue[] {
    const issues: ValidationIssue[] = []

    for (const item of context.items) {
      const calculatedDuration = this.calculateDuration(item.startTime, item.endTime)
      const diff = Math.abs(calculatedDuration - item.duration)

      if (diff > 5) {
        // 差异大于5秒
        issues.push({
          id: `issue_${Date.now()}_duration_${item.id}`,
          type: 'duration_mismatch',
          severity: 'warning',
          message: `条目 "${item.programName}" 时长不一致: 声明 ${item.duration}秒, 实际 ${calculatedDuration}秒, 差异 ${diff}秒`,
          location: { itemId: item.id },
          suggestion: '检查并修正时长设置',
          createdAt: new Date().toISOString(),
        })
      }
    }

    return issues
  }

  /**
   * 固定项冲突检测
   */
  private checkFixedItemConflicts(context: ValidationContext): ValidationIssue[] {
    const issues: ValidationIssue[] = []

    for (const fixedItem of context.fixedItems) {
      if (!fixedItem.isLocked) continue

      // 检查是否有普通条目与固定项冲突
      for (const item of context.items) {
        if (this.timeRangesOverlap(
          { start: item.startTime, end: item.endTime },
          { start: fixedItem.startTime, end: fixedItem.endTime },
        )) {
          issues.push({
            id: `issue_${Date.now()}_fixed_${fixedItem.id}_${item.id}`,
            type: 'constraint_violation',
            severity: 'critical',
            message: `条目 "${item.programName}" 与固定项 "${fixedItem.programCode}" 时间冲突`,
            location: {
              itemId: item.id,
              timeRange: { start: item.startTime, end: item.endTime },
            },
            suggestion: '调整条目时间，避开固定项',
            createdAt: new Date().toISOString(),
          })
        }
      }
    }

    return issues
  }

  /**
   * 版面约束检测
   */
  private checkLayoutConstraints(context: ValidationContext): ValidationIssue[] {
    const issues: ValidationIssue[] = []

    for (const slot of context.layoutSlots) {
      if (slot.fixedProgram) {
        // 版面有固定节目，检查是否匹配
        const itemsInSlot = context.items.filter((item) =>
          this.timeRangesOverlap(
            { start: item.startTime, end: item.endTime },
            { start: slot.startTime, end: slot.endTime },
          ),
        )

        for (const item of itemsInSlot) {
          if (item.programCode !== slot.fixedProgram) {
            issues.push({
              id: `issue_${Date.now()}_layout_${slot.id}_${item.id}`,
              type: 'constraint_violation',
              severity: 'warning',
              message: `条目 "${item.programName}" 与版面时段 "${slot.programType}" 不匹配`,
              location: {
                itemId: item.id,
                timeRange: { start: slot.startTime, end: slot.endTime },
              },
              suggestion: `版面要求节目: ${slot.fixedProgram}`,
              createdAt: new Date().toISOString(),
            })
          }
        }
      }
    }

    return issues
  }

  /**
   * 连续性检测
   */
  private checkContinuity(context: ValidationContext): ValidationIssue[] {
    const issues: ValidationIssue[] = []
    const items = [...context.items].sort(
      (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime(),
    )

    for (let i = 0; i < items.length - 1; i++) {
      const current = items[i]!
      const next = items[i + 1]!

      const currentEnd = new Date(current.endTime).getTime()
      const nextStart = new Date(next.startTime).getTime()
      const gap = nextStart - currentEnd

      if (gap > 0 && gap <= 60000) {
        // 小于1分钟的间隙，可能是正常过渡
        issues.push({
          id: `issue_${Date.now()}_continuity_${current.id}_${next.id}`,
          type: 'gap',
          severity: 'info',
          message: `"${current.programName}" 与 "${next.programName}" 之间有 ${this.formatDuration(Math.floor(gap / 1000))} 间隙`,
          location: {
            timeRange: { start: current.endTime, end: next.startTime },
          },
          suggestion: '检查是否为正常过渡时间',
          createdAt: new Date().toISOString(),
        })
      }
    }

    return issues
  }

  // ==================== 辅助方法 ====================

  /**
   * 计算时长（秒）
   */
  private calculateDuration(startTime: string, endTime: string): number {
    const start = new Date(startTime).getTime()
    const end = new Date(endTime).getTime()
    return Math.floor((end - start) / 1000)
  }

  /**
   * 检查时间范围是否重叠
   */
  private timeRangesOverlap(
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
   * 格式化时长
   */
  private formatDuration(seconds: number): string {
    const hours = Math.floor(seconds / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    const secs = seconds % 60

    if (hours > 0) {
      return `${hours}小时${minutes}分${secs}秒`
    } else if (minutes > 0) {
      return `${minutes}分${secs}秒`
    } else {
      return `${secs}秒`
    }
  }

  /**
   * 格式化时间（只显示时分）
   */
  private formatTime(isoTime: string): string {
    const date = new Date(isoTime)
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  }

  // ==================== 规则管理 ====================

  /**
   * 启用规则
   */
  enableRule(ruleId: string): void {
    const rule = this.rules.find((r) => r.id === ruleId)
    if (rule) {
      rule.enabled = true
    }
  }

  /**
   * 禁用规则
   */
  disableRule(ruleId: string): void {
    const rule = this.rules.find((r) => r.id === ruleId)
    if (rule) {
      rule.enabled = false
    }
  }

  /**
   * 添加自定义规则
   */
  addCustomRule(rule: ValidationRule): void {
    this.rules.push(rule)
  }

  /**
   * 获取所有规则
   */
  getRules(): ValidationRule[] {
    return [...this.rules]
  }

  /**
   * 重置规则
   */
  resetRules(): void {
    this.initializeRules()
  }
}

// 导出工厂函数
let globalValidationEngine: ValidationEngine | null = null

export function getValidationEngine(config?: Partial<ValidationEngineConfig>): ValidationEngine {
  if (!globalValidationEngine) {
    globalValidationEngine = new ValidationEngine(config)
  }
  return globalValidationEngine
}

export function resetValidationEngine(): void {
  globalValidationEngine = null
}

// 导出便捷函数
export function validateSchedule(context: ValidationContext): ValidationReport {
  return getValidationEngine().validate(context)
}

export function validateItem(item: ScheduleItemSnapshot, context: ValidationContext): ValidationReport {
  return getValidationEngine().validateItem(item, context)
}
