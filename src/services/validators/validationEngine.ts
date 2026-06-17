import { getEffectiveColumnDefinition } from '@/services/orchestration/runtimeLayoutRegistry'
import {
  extractEditorialKeywordRequirements,
  extractSpecificSearchKeywords,
  hasEditorialKeywordRequirements,
  hasFunctionalSearchKeywords,
  hasExplicitSequenceRequirements,
  matchesEditorialKeywordRequirementsByFields,
  matchesFunctionalSearchKeywords,
  matchesExplicitSequenceRequirements,
  matchesSpecificSearchKeywords,
} from '@/services/candidateKeywordMatcher'
import { detectMovingItemSequenceViolation } from '@/services/scheduleSequenceGuard'
import type {
  ColumnDefinition,
  FixedItem,
  GapInfo,
  LayoutSlot,
  ScheduleItemSnapshot,
  ValidationIssue,
  ValidationIssueType,
  ValidationReport,
  ValidationSeverity,
} from '@/types/orchestration'

export interface ValidationRule {
  id: string
  name: string
  type: ValidationIssueType
  severity: ValidationSeverity
  enabled: boolean
  check: (context: ValidationContext) => ValidationIssue[]
}

export interface ValidationContext {
  items: ScheduleItemSnapshot[]
  gaps: GapInfo[]
  fixedItems: FixedItem[]
  layoutSlots: LayoutSlot[]
  dayStartTime: string
  dayEndTime: string
}

export interface ValidationEngineConfig {
  enableAllRules: boolean
  customRules: ValidationRule[]
  stopOnCritical: boolean
}

const DEFAULT_CONFIG: ValidationEngineConfig = {
  enableAllRules: true,
  customRules: [],
  stopOnCritical: false,
}

export class ValidationEngine {
  private config: ValidationEngineConfig
  private rules: ValidationRule[] = []

  constructor(config?: Partial<ValidationEngineConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.initializeRules()
  }

  private initializeRules(): void {
    this.rules = [
      {
        id: 'gap-check',
        name: '空窗检测',
        type: 'gap',
        severity: 'warning',
        enabled: true,
        check: this.checkGaps.bind(this),
      },
      {
        id: 'overlap-check',
        name: '重叠检测',
        type: 'overlap',
        severity: 'critical',
        enabled: true,
        check: this.checkOverlaps.bind(this),
      },
      {
        id: 'boundary-check',
        name: '边界检查',
        type: 'boundary_mismatch',
        severity: 'warning',
        enabled: true,
        check: this.checkBoundaries.bind(this),
      },
      {
        id: 'duration-check',
        name: '时长一致性',
        type: 'duration_mismatch',
        severity: 'warning',
        enabled: true,
        check: this.checkDurationConsistency.bind(this),
      },
      {
        id: 'layout-check',
        name: '版面约束',
        type: 'constraint_violation',
        severity: 'warning',
        enabled: true,
        check: this.checkLayoutConstraints.bind(this),
      },
      {
        id: 'continuity-check',
        name: '连续性检查',
        type: 'gap',
        severity: 'info',
        enabled: true,
        check: this.checkContinuity.bind(this),
      },
      {
        id: 'sequence-order-check',
        name: '顺播顺序检查',
        type: 'constraint_violation',
        severity: 'critical',
        enabled: true,
        check: this.checkSequenceOrder.bind(this),
      },
      ...this.config.customRules,
    ]
  }

  validate(context: ValidationContext): ValidationReport {
    const issues: ValidationIssue[] = []
    const enabledRules = this.rules.filter((rule) => rule.enabled)

    for (const rule of enabledRules) {
      const ruleIssues = rule.check(context)
      issues.push(...ruleIssues)
      if (this.config.stopOnCritical && ruleIssues.some((issue) => issue.severity === 'critical')) {
        break
      }
    }

    return this.buildReport('full', 'schedule', issues)
  }

  validateItem(item: ScheduleItemSnapshot, context: ValidationContext): ValidationReport {
    const issues: ValidationIssue[] = []
    const calculatedDuration = this.calculateDuration(item.startTime, item.endTime)

    if (Math.abs(calculatedDuration - item.duration) > 1) {
      issues.push(this.createIssue(
        'duration_mismatch',
        'warning',
        `节目“${item.programName}”时长与时间轴不一致`,
        { itemId: item.id },
        '请检查开始时间、结束时间和时长字段。',
      ))
    }

    if (new Date(item.startTime).getTime() >= new Date(item.endTime).getTime()) {
      issues.push(this.createIssue(
        'constraint_violation',
        'critical',
        `节目“${item.programName}”的开始时间晚于或等于结束时间`,
        { itemId: item.id },
        '请修正节目时间范围。',
      ))
    }

    const layoutIssues = this.checkLayoutConstraints({
      ...context,
      items: [item],
    })
    issues.push(...layoutIssues)

    const sequenceViolation = detectMovingItemSequenceViolation(
      item,
      context.items.filter((existingItem) => existingItem.id !== item.id),
      '当前编排',
    )
    if (sequenceViolation) {
      issues.push(this.createIssue(
        'constraint_violation',
        'critical',
        sequenceViolation.message,
        {
          itemId: item.id,
          relatedItemIds: [
            item.id,
            ...context.items
              .filter((existingItem) => existingItem.id !== item.id)
              .map((existingItem) => existingItem.id),
          ],
          timeRange: { start: item.startTime, end: item.endTime },
        },
        '请调整同一剧集的播出顺序，或移除倒序/跳集节目后重新补排。',
      ))
    }

    return this.buildReport('item', item.id, issues)
  }

  private checkGaps(context: ValidationContext): ValidationIssue[] {
    return context.gaps
      .filter((gap) => gap.duration > 60)
      .map((gap) =>
        this.createIssue(
          'gap',
          'warning',
          `存在未填充空窗：${this.formatTime(gap.startTime)} - ${this.formatTime(gap.endTime)}`,
          { gapId: gap.id, timeRange: { start: gap.startTime, end: gap.endTime } },
          '请继续补排或人工处理该空窗。',
        ),
      )
  }

  private checkOverlaps(context: ValidationContext): ValidationIssue[] {
    const issues: ValidationIssue[] = []
    const items = [...context.items].sort(
      (left, right) => new Date(left.startTime).getTime() - new Date(right.startTime).getTime(),
    )

    for (let index = 0; index < items.length - 1; index += 1) {
      const current = items[index]!
      const next = items[index + 1]!
      if (new Date(current.endTime).getTime() > new Date(next.startTime).getTime()) {
        issues.push(this.createIssue(
          'overlap',
          'critical',
          `节目“${current.programName}”与“${next.programName}”发生重叠`,
          {
            itemId: current.id,
            relatedItemIds: [current.id, next.id],
            timeRange: { start: next.startTime, end: current.endTime },
          },
          '请调整节目时间，消除重叠。',
        ))
      }
    }

    return issues
  }

  private checkBoundaries(context: ValidationContext): ValidationIssue[] {
    const issues: ValidationIssue[] = []
    const items = [...context.items].sort(
      (left, right) => new Date(left.startTime).getTime() - new Date(right.startTime).getTime(),
    )
    if (items.length === 0) return issues

    const firstItem = items[0]!
    const lastItem = items[items.length - 1]!

    if (new Date(firstItem.startTime).getTime() > new Date(context.dayStartTime).getTime()) {
      issues.push(this.createIssue(
        'boundary_mismatch',
        'warning',
        '首条节目未对齐播出日开始时间',
        {
          itemId: firstItem.id,
          timeRange: { start: context.dayStartTime, end: firstItem.startTime },
        },
        '请确认是否需要补齐开播前空窗。',
      ))
    }

    if (new Date(lastItem.endTime).getTime() < new Date(context.dayEndTime).getTime()) {
      issues.push(this.createIssue(
        'boundary_mismatch',
        'warning',
        '末条节目未对齐播出日结束时间',
        {
          itemId: lastItem.id,
          timeRange: { start: lastItem.endTime, end: context.dayEndTime },
        },
        '请确认是否需要补齐收尾空窗。',
      ))
    }

    return issues
  }

  private checkDurationConsistency(context: ValidationContext): ValidationIssue[] {
    return context.items
      .filter((item) => Math.abs(this.calculateDuration(item.startTime, item.endTime) - item.duration) > 5)
      .map((item) =>
        this.createIssue(
          'duration_mismatch',
          'warning',
          `节目“${item.programName}”的时长与时间轴不一致`,
          { itemId: item.id },
          '请检查节目时长或时间范围。',
        ),
      )
  }

  private checkFixedItemConflicts(context: ValidationContext): ValidationIssue[] {
    const issues: ValidationIssue[] = []

    for (const fixedItem of context.fixedItems) {
      if (!fixedItem.isLocked) continue
      for (const item of context.items) {
        const isSameProgram = item.programCode === fixedItem.programCode
        const isSameTimeRange =
          new Date(item.startTime).getTime() === new Date(fixedItem.startTime).getTime()
          && new Date(item.endTime).getTime() === new Date(fixedItem.endTime).getTime()

        if (isSameProgram && isSameTimeRange) {
          continue
        }

        if (this.timeRangesOverlap(
          { start: item.startTime, end: item.endTime },
          { start: fixedItem.startTime, end: fixedItem.endTime },
        )) {
          issues.push(this.createIssue(
            'constraint_violation',
            'critical',
            `节目“${item.programName}”与固定播出项“${fixedItem.programCode}”发生冲突`,
            {
              itemId: item.id,
              timeRange: { start: item.startTime, end: item.endTime },
            },
            '请调整节目时间，避开固定播出项。',
          ))
        }
      }
    }

    return issues
  }

  private checkLayoutConstraints(context: ValidationContext): ValidationIssue[] {
    const issues: ValidationIssue[] = []

    for (const slot of context.layoutSlots) {
      const column = getEffectiveColumnDefinition(slot.columnId)
      if (!column) continue

      const itemsInSlot = context.items.filter((item) =>
        this.timeRangesOverlap(
          { start: item.startTime, end: item.endTime },
          { start: slot.startTime, end: slot.endTime },
        ),
      )

      for (const item of itemsInSlot) {
        if (!item.programType || item.programType === 'ad') continue
        const rawIntentKeywords = this.extractColumnRawIntentKeywords(column)
        const intentKeywords = extractSpecificSearchKeywords(rawIntentKeywords)
        const hasIntentRequirement = intentKeywords.length > 0
          || hasExplicitSequenceRequirements(rawIntentKeywords)
          || hasEditorialKeywordRequirements(rawIntentKeywords)
          || hasFunctionalSearchKeywords(rawIntentKeywords)
        if (hasIntentRequirement && !this.itemMatchesColumnIntent(item, rawIntentKeywords)) {
          const editorialRequirements = extractEditorialKeywordRequirements(rawIntentKeywords)
          const intentLabel = [
            ...intentKeywords,
            ...(hasExplicitSequenceRequirements(rawIntentKeywords) ? ['指定集数/期数'] : []),
            ...editorialRequirements.map((requirement) => `${requirement.kind}:${requirement.raw}`),
            ...(hasFunctionalSearchKeywords(rawIntentKeywords) ? ['功能型内容要求'] : []),
          ].join('、')
          issues.push(this.createIssue(
            'constraint_violation',
            'critical',
            `节目《${item.programName}》未命中版面栏目“${column.columnName}”的明确关键词：${intentLabel}`,
            {
              itemId: item.id,
              timeRange: { start: slot.startTime, end: slot.endTime },
            },
            '请保留该时段为空缺并中止自动填充，或改选标题、栏目、内容关键词明确命中的节目。',
          ))
        }
        if (item.programType !== column.defaultProgramType) {
          issues.push(this.createIssue(
            'constraint_violation',
            'warning',
            `节目“${item.programName}”与版面栏目“${column.columnName}”类型不匹配`,
            {
              itemId: item.id,
              timeRange: { start: slot.startTime, end: slot.endTime },
            },
            `版面栏目期望类型为：${column.defaultProgramType}`,
          ))
        }
      }
    }

    return issues
  }

  private extractColumnRawIntentKeywords(column: ColumnDefinition): string[] {
    return [
      ...(column.queryHints ?? []),
      column.semanticLabel,
      column.columnName,
    ].filter((value): value is string => Boolean(value?.trim()))
  }

  private itemMatchesColumnIntent(item: ScheduleItemSnapshot, intentKeywords: string[]): boolean {
    const haystack = [
      item.programName,
      item.instanceName,
      item.programCode,
      item.columnName,
      item.columnId,
      ...(item.contentTags ?? []),
    ].filter(Boolean).join(' ')
    return matchesSpecificSearchKeywords(haystack, intentKeywords)
      && matchesExplicitSequenceRequirements(haystack, intentKeywords)
      && matchesEditorialKeywordRequirementsByFields({
        column: [item.columnName, item.columnId].filter(Boolean).join(' '),
        title: [item.programName, item.instanceName].filter(Boolean).join(' '),
        content: [
          item.programName,
          item.instanceName,
          ...(item.contentTags ?? []),
        ].filter(Boolean).join(' '),
        all: haystack,
      }, intentKeywords)
      && matchesFunctionalSearchKeywords(haystack, intentKeywords)
  }

  private checkContinuity(context: ValidationContext): ValidationIssue[] {
    const issues: ValidationIssue[] = []
    const items = [...context.items].sort(
      (left, right) => new Date(left.startTime).getTime() - new Date(right.startTime).getTime(),
    )

    for (let index = 0; index < items.length - 1; index += 1) {
      const current = items[index]!
      const next = items[index + 1]!
      const gapMs = new Date(next.startTime).getTime() - new Date(current.endTime).getTime()

      if (gapMs > 0 && gapMs <= 60_000) {
        issues.push(this.createIssue(
          'gap',
          'info',
          `节目“${current.programName}”与“${next.programName}”之间存在短间隙`,
          {
            timeRange: { start: current.endTime, end: next.startTime },
          },
          '请确认这是否为正常过渡时间。',
        ))
      }
    }

    return issues
  }

  private checkSequenceOrder(context: ValidationContext): ValidationIssue[] {
    const issues: ValidationIssue[] = []
    const items = [...context.items].sort(
      (left, right) => new Date(left.startTime).getTime() - new Date(right.startTime).getTime(),
    )
    const previousBySeries = new Map<string, ScheduleItemSnapshot>()

    for (const item of items) {
      const seriesKey = this.buildSeriesKey(item.programName, item.programCode)
      const sequenceNo = this.extractSequenceNo(item)
      if (!seriesKey || typeof sequenceNo !== 'number') {
        continue
      }

      const previous = previousBySeries.get(seriesKey)
      if (previous) {
        const previousSequence = this.extractSequenceNo(previous)
        if (typeof previousSequence === 'number' && sequenceNo < previousSequence) {
          issues.push(this.createIssue(
            'constraint_violation',
            'critical',
            `节目《${item.programName}》顺播倒序：前面已有第${previousSequence}集，后面出现第${sequenceNo}集。`,
            {
              itemId: item.id,
              relatedItemIds: [previous.id, item.id],
              timeRange: { start: previous.startTime, end: item.endTime },
            },
            '请调整同一剧集的播出顺序，或移除倒序节目后重新补排。',
          ))
        }
        if (typeof previousSequence === 'number' && sequenceNo > previousSequence + 1) {
          issues.push(this.createIssue(
            'constraint_violation',
            'critical',
            `节目《${item.programName}》顺播跳集：前面已有第${previousSequence}集，后面直接出现第${sequenceNo}集。`,
            {
              itemId: item.id,
              relatedItemIds: [previous.id, item.id],
              timeRange: { start: previous.startTime, end: item.endTime },
            },
            `请先补排第${previousSequence + 1}集，或人工确认跳集播出的业务原因。`,
          ))
        }
      }

      previousBySeries.set(seriesKey, item)
    }

    return issues
  }

  private buildReport(
    scope: 'full' | 'item',
    targetId: string,
    issues: ValidationIssue[],
  ): ValidationReport {
    const criticalCount = issues.filter((issue) => issue.severity === 'critical').length
    const warningCount = issues.filter((issue) => issue.severity === 'warning').length
    const infoCount = issues.filter((issue) => issue.severity === 'info').length

    return {
      id: `validation_${Date.now()}`,
      scope,
      targetId,
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

  private createIssue(
    type: ValidationIssueType,
    severity: ValidationSeverity,
    message: string,
    location: ValidationIssue['location'],
    suggestion?: string,
  ): ValidationIssue {
    return {
      id: `issue_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type,
      severity,
      message,
      location,
      suggestion,
      createdAt: new Date().toISOString(),
    }
  }

  private calculateDuration(startTime: string, endTime: string): number {
    return Math.floor((new Date(endTime).getTime() - new Date(startTime).getTime()) / 1000)
  }

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

  private formatTime(isoTime: string): string {
    return new Date(isoTime).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
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

  private extractSequenceNo(item: ScheduleItemSnapshot): number | null {
    const codeMatch = item.programCode?.match(/(\d{1,4})$/)
    const nameMatch = item.programName.match(/第\s*([0-9零〇一二两三四五六七八九十百]+)\s*[集期]/u)
    if (nameMatch) {
      return this.parseChineseNumber(nameMatch[1]!)
    }
    if (codeMatch) {
      const parsed = Number(codeMatch[1])
      if (Number.isFinite(parsed) && parsed > 0) {
        return parsed
      }
    }
    return null
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

  enableRule(ruleId: string): void {
    const rule = this.rules.find((item) => item.id === ruleId)
    if (rule) rule.enabled = true
  }

  disableRule(ruleId: string): void {
    const rule = this.rules.find((item) => item.id === ruleId)
    if (rule) rule.enabled = false
  }

  addCustomRule(rule: ValidationRule): void {
    this.rules.push(rule)
  }

  getRules(): ValidationRule[] {
    return [...this.rules]
  }

  resetRules(): void {
    this.initializeRules()
  }
}

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

export function validateSchedule(context: ValidationContext): ValidationReport {
  return getValidationEngine().validate(context)
}

export function validateItem(item: ScheduleItemSnapshot, context: ValidationContext): ValidationReport {
  return getValidationEngine().validateItem(item, context)
}
