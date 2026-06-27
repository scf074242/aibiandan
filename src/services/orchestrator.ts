import type {
  FillItemCommand,
  GapInfo,
  OrchestrationCommand,
  OrchestrationProgress,
  PlanCommand,
  PlanningLogEntry,
  PlanningSession,
  PlanningSessionStatus,
  PlanningStrategy,
  ProgramCandidate,
  QueryCandidatesCommand,
  ScheduleItemSnapshot,
  TaskClassification,
  ValidationReport,
  LayoutReference,
} from '@/types/orchestration'
import type { ChatMessage } from '@/types/llm'
import { getAtomicCapabilities } from './atomicCapabilities'
import { getCandidateService } from './candidateService'
import { createGapManager, GapManager } from './gapManager'
import { getMaterializer } from './materializer'
import { getDataService } from './orchestration/dataService'
import { getOrchestrationStrategyService } from './orchestrationStrategyService'
import type { GapPlanningThought } from './orchestrationStrategyService'
import { getQueryIntentService } from './queryIntentService'
import { getCandidateSelectionService } from './candidateSelectionService'
import {
  applyAdInsertionPlan,
  buildAdInsertionPlan,
  collectAdInsertionOpportunities,
} from './adFillService'
import { LLMClient } from './llm/llmClient'
import { TaskClassifier } from './llm/taskClassifier'
import { getValidationEngine } from './validators/validationEngine'
import { getEffectiveColumnDefinition } from './orchestration/runtimeLayoutRegistry'
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
} from './candidateKeywordMatcher'

type EventPayloadMap = {
  'status-change': { status: PlanningSessionStatus; previousStatus: PlanningSessionStatus }
  'gap-start': { gap: GapInfo }
  'gap-complete': { gap: GapInfo; item: ScheduleItemSnapshot }
  'gap-failed': { gap: GapInfo; error: string }
  'command-execute': { command: OrchestrationCommand }
  'validation-complete': { report: ValidationReport }
  'repair-start': { round: number; issues: ValidationReport }
  'repair-complete': { round: number; success: boolean }
  'log': { entry: PlanningLogEntry }
  'error': { error: Error }
  'complete': { session: PlanningSession }
}

interface PreparedGapPlan {
  gap: GapInfo
  queryCommand: QueryCandidatesCommand
  thought?: GapPlanningThought
  candidates: ProgramCandidate[]
  fillCommand: FillItemCommand
  selectedCandidate: ProgramCandidate
}

interface ExecutedGapPlanResult {
  item: ScheduleItemSnapshot
  insertedItems: ScheduleItemSnapshot[]
}

interface PartialGenerationTarget {
  targetGapIds?: string[]
  targetTimeRange?: {
    start: string
    end: string
  }
  searchKeywords?: string[]
}

class EventEmitter {
  private listeners = new Map<keyof EventPayloadMap, Array<(payload: EventPayloadMap[keyof EventPayloadMap]) => void>>()

  on<K extends keyof EventPayloadMap>(event: K, listener: (payload: EventPayloadMap[K]) => void) {
    const current = this.listeners.get(event) ?? []
    current.push(listener as (payload: EventPayloadMap[keyof EventPayloadMap]) => void)
    this.listeners.set(event, current)
    return this
  }

  emit<K extends keyof EventPayloadMap>(event: K, payload: EventPayloadMap[K]) {
    ;(this.listeners.get(event) ?? []).forEach((listener) => listener(payload))
  }

  removeAllListeners() {
    this.listeners.clear()
  }
}

export interface OrchestratorConfig {
  maxRepairRounds: number
  enableAutoRepair: boolean
  maxGapItems: number
  planningConcurrency: number
  planningLlmTimeoutMs: number
}

const DEFAULT_CONFIG: OrchestratorConfig = {
  maxRepairRounds: 1,
  enableAutoRepair: true,
  maxGapItems: 10,
  planningConcurrency: 1,
  planningLlmTimeoutMs: 20000,
}

const AD_INSERTION_PACING_MS = 3000

export class Orchestrator extends EventEmitter {
  private readonly llmClient: LLMClient
  private readonly taskClassifier: TaskClassifier
  private readonly candidateService = getCandidateService()
  private readonly materializer = getMaterializer()
  private readonly validationEngine = getValidationEngine()
  private readonly atomicCapabilities = getAtomicCapabilities()
  private readonly dataService = getDataService()
  private readonly strategyService: ReturnType<typeof getOrchestrationStrategyService>
  private readonly queryIntentService: ReturnType<typeof getQueryIntentService>
  private readonly candidateSelectionService: ReturnType<typeof getCandidateSelectionService>
  private readonly config: OrchestratorConfig

  private gapManager: GapManager | null = null
  private session: PlanningSession | null = null
  private isRunning = false
  private isCancelled = false
  private currentGap: GapInfo | null = null
  private repairRound = 0
  private lastValidationReport: ValidationReport | null = null

  constructor(llmClient: LLMClient, taskClassifier: TaskClassifier, config?: Partial<OrchestratorConfig>) {
    super()
    this.llmClient = llmClient
    this.taskClassifier = taskClassifier
    this.strategyService = getOrchestrationStrategyService(llmClient)
    this.queryIntentService = getQueryIntentService(llmClient)
    this.candidateSelectionService = getCandidateSelectionService(llmClient)
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  createSession(channelId: string, date: string, strategy?: Partial<PlanningStrategy>): PlanningSession {
    const now = new Date().toISOString()
    this.session = {
      id: `session_${Date.now()}`,
      channelId,
      date,
      status: 'initializing',
      strategy: {
        target: strategy?.target ?? 'demo-orchestration',
        referencePriority: strategy?.referencePriority ?? ['layout', 'history', 'library'],
        allowFiller: strategy?.allowFiller ?? true,
        sequentialPreference: strategy?.sequentialPreference ?? true,
        riskPreference: strategy?.riskPreference ?? 'balanced',
      },
      gaps: {
        pending: [],
        completed: [],
        failed: [],
        failedReasons: {},
      },
      execution: {
        totalCommands: 0,
        successfulCommands: 0,
        failedCommands: 0,
        fallbackCount: 0,
        repairRounds: 0,
      },
      logs: [],
      createdAt: now,
      updatedAt: now,
    }

    this.gapManager = createGapManager(channelId, date)
    this.lastValidationReport = null
    return this.session
  }

  getSession(): PlanningSession | null {
    return this.session
  }

  getIsRunning(): boolean {
    return this.isRunning
  }

  async startFullGeneration(
    channelId: string,
    date: string,
    dayStartTime: string,
    dayEndTime: string,
    strategy?: Partial<PlanningStrategy>,
  ): Promise<void> {
    if (this.isRunning) throw new Error('Orchestrator is already running')
    this.isRunning = true
    this.isCancelled = false
    this.repairRound = 0
    this.lastValidationReport = null

    try {
      this.createSession(channelId, date, strategy)

      const generationContext = await this.dataService.getGenerationContext(channelId, date)
      if (!generationContext) throw new Error('Unable to load generation context')

      const existingItems = this.atomicCapabilities.getAllItems()
      const layoutSlots = generationContext.layoutReference?.slots ?? []
      const typedLayoutSlots = layoutSlots
        .map((slot) => {
          const column = getEffectiveColumnDefinition(slot.columnId)
          if (!column) return null
          return {
            startTime: slot.startTime,
            endTime: slot.endTime,
            programType: column.defaultProgramType,
            preferredProgramTypes: [column.defaultProgramType],
          }
        })
        .filter((slot): slot is NonNullable<typeof slot> => Boolean(slot))
      const defaultDayStartTime = this.combineDateTime(
        date,
        generationContext.channel.broadcastRules.defaultStartTime || dayStartTime,
      )
      const defaultDayEndTime = this.combineDateTime(
        date,
        generationContext.channel.broadcastRules.defaultEndTime || dayEndTime,
      )
      if (existingItems.length > 0) {
        this.gapManager!.calculateGapsFromItems(
          existingItems,
          generationContext.constraints.fixedItems,
          defaultDayStartTime,
          defaultDayEndTime,
        )
        this.gapManager!.alignGapsToLayoutBands(typedLayoutSlots)
        this.log('info', 'planning', `频道 ${channelId} 已保留现有编单，将基于剩余空窗继续编排`, {
          channelId,
          date,
          existingItemCount: existingItems.length,
        })
      } else if (typedLayoutSlots.length > 0) {
        this.gapManager!.initializeFromLayoutBands(typedLayoutSlots)
        this.log('info', 'planning', `频道 ${channelId} 已命中版面参考，开始按版面时段生成待编排空窗`, {
          channelId,
          date,
          layoutSlotCount: typedLayoutSlots.length,
        })
      } else {
        const errorMessage = `频道 ${channelId} 在 ${date} 未命中版面参考，无法从空白编单执行全天编排`
        this.log('warn', 'planning', errorMessage, {
          channelId,
          date,
          dayStartTime,
          dayEndTime,
        })
        throw new Error(errorMessage)
      }

      this.session!.gaps.pending = this.gapManager!.queryRemainingGaps()

      await this.phase1Planning()
      if (this.isCancelled) return
      await this.phase2Filling({ allowAdFill: true })
      if (this.isCancelled) return
      await this.phase3Repair()

      if (!this.isCancelled) {
        this.updateStatus(this.resolveTerminalStatus())
        this.emit('complete', { session: this.session! })
      }
    } catch (error) {
      this.handleError(error as Error)
      throw error
    } finally {
      this.isRunning = false
    }
  }

  async startPartialGeneration(channelId: string, date: string, target?: string[] | PartialGenerationTarget): Promise<void> {
    if (this.isRunning) throw new Error('Orchestrator is already running')
    this.isRunning = true
    this.isCancelled = false
    this.repairRound = 0
    this.lastValidationReport = null
    const targetGapIds = Array.isArray(target) ? target : target?.targetGapIds
    const targetTimeRange = Array.isArray(target) ? undefined : target?.targetTimeRange
    const targetSearchKeywords = Array.isArray(target) ? undefined : target?.searchKeywords

    try {
      this.createSession(channelId, date, { target: 'partial_fill' })
      const context = await this.dataService.getGenerationContext(channelId, date)
      if (!context) throw new Error('Unable to load generation context')

      const items = this.atomicCapabilities.getAllItems()
      this.gapManager!.calculateGapsFromItems(
        items,
        context.constraints.fixedItems,
        this.combineDateTime(date, context.channel.broadcastRules.defaultStartTime),
        this.combineDateTime(date, context.channel.broadcastRules.defaultEndTime),
      )
      const typedLayoutSlots = (context.layoutReference?.slots ?? [])
        .map((slot) => {
          const column = getEffectiveColumnDefinition(slot.columnId)
          if (!column) return null
          return {
            startTime: slot.startTime,
            endTime: slot.endTime,
            programType: column.defaultProgramType,
            preferredProgramTypes: [column.defaultProgramType],
          }
        })
        .filter((slot): slot is NonNullable<typeof slot> => Boolean(slot))
      this.gapManager!.alignGapsToLayoutBands(typedLayoutSlots)

      const gaps = this.gapManager!.queryRemainingGaps()
      const gapsById = targetGapIds?.length ? gaps.filter((gap) => targetGapIds.includes(gap.id)) : gaps
      this.session!.gaps.pending = targetTimeRange
        ? this.filterGapsByTargetTimeRange(gapsById, date, targetTimeRange)
        : gapsById
      const partialTargetGapIds = new Set(this.session!.gaps.pending.map((gap) => gap.id))
      const partialTargetSlotIds = this.resolveRelevantLayoutSlotIds(
        this.session!.gaps.pending,
        context.layoutReference,
      )
      this.log('info', 'planning', '局部补排已锁定版面范围，后续广告补位仅作用于相关版面时段', {
        pendingGapCount: this.session!.gaps.pending.length,
        targetGapIds: this.session!.gaps.pending.map((gap) => gap.id),
        targetTimeRange,
        searchKeywords: targetSearchKeywords,
        targetSlotIds: partialTargetSlotIds,
        layoutSource: context.layoutReference?.name,
      })

      await this.phase2Filling({
        allowAdFill: true,
        targetGapIds: partialTargetGapIds,
        targetSlotIds: partialTargetSlotIds,
        searchKeywords: targetSearchKeywords,
      })
      if (this.isCancelled) return
      await this.phase3Repair()

      if (!this.isCancelled) {
        this.updateStatus(this.resolveTerminalStatus(partialTargetGapIds))
        this.emit('complete', { session: this.session! })
      }
    } catch (error) {
      this.handleError(error as Error)
      throw error
    } finally {
      this.isRunning = false
    }
  }

  private filterGapsByTargetTimeRange(
    gaps: GapInfo[],
    date: string,
    targetTimeRange: { start: string; end: string },
  ): GapInfo[] {
    const targetStart = new Date(this.combineDateTime(date, targetTimeRange.start)).getTime()
    const targetEnd = new Date(this.combineDateTime(date, targetTimeRange.end)).getTime()
    if (!Number.isFinite(targetStart) || !Number.isFinite(targetEnd) || targetEnd <= targetStart) return gaps

    return gaps.filter((gap) => {
      const gapStart = new Date(gap.startTime).getTime()
      const gapEnd = new Date(gap.endTime).getTime()
      return gapStart < targetEnd && gapEnd > targetStart
    })
  }

  async executeCommand(command: OrchestrationCommand): Promise<boolean> {
    this.emit('command-execute', { command })
    return true
  }

  cancel(): void {
    this.isCancelled = true
    if (this.session) {
      this.log('warn', 'session', '用户已请求中止当前编排任务')
      this.updateStatus('cancelled')
    }
  }

  getProgress(): OrchestrationProgress | null {
    if (!this.session || !this.gapManager) return null
    const stats = this.gapManager.getStats()

    return {
      sessionId: this.session.id,
      status: this.session.status,
      currentPhase: this.currentGap ? 'filling' : this.session.status,
      gapProgress: {
        total: stats.total,
        pending: stats.pending,
        processing: stats.processing,
        completed: stats.completed,
        failed: stats.failed,
      },
      currentGap: this.currentGap ?? undefined,
      currentAction: this.currentGap ? `处理空窗 ${this.currentGap.id}` : undefined,
      liveGaps: this.gapManager.getActiveGaps(),
      stats: this.session.execution,
      recentLogs: this.session.logs.slice(-20),
      startedAt: this.session.createdAt,
      repairStatus: this.repairRound
        ? {
            currentRound: this.repairRound,
            maxRounds: this.config.maxRepairRounds,
            issuesByRound: [],
            actionsTaken: [],
            isComplete: this.session.status !== 'repairing',
            requiresManualIntervention: false,
          }
        : undefined,
    }
  }

  private async phase1Planning(): Promise<void> {
    this.updateStatus('planning')
    const prompt = this.buildPlanningPrompt(this.session!.gaps.pending.length)

    try {
      const response = await this.runWithTimeout(
        this.llmClient.chat(prompt, { temperature: 0.2, maxTokens: 800 }),
        this.config.planningLlmTimeoutMs,
        'LLM 策略规划超时',
      )
      const plan = this.parseJSONCommand<PlanCommand>(response.content)
      if (plan?.action === 'plan') {
        this.session!.strategy = { ...this.session!.strategy, ...plan.data.strategy }
      }
      this.log('info', 'planning', '已生成全局编排策略', {
        strategy: this.session!.strategy,
        initialGapCount: this.session!.gaps.pending.length,
      })
    } catch (error) {
      this.log('warn', 'planning', 'LLM 策略规划不可用，已回退到默认编排策略', {
        strategy: this.session!.strategy,
        reason: error instanceof Error ? error.message : 'unknown',
      })
    }
  }

  private resolveTerminalStatus(targetGapIds?: Set<string>): PlanningSessionStatus {
    if (this.getRelevantRemainingGaps(targetGapIds).length > 0) {
      return 'manual_review'
    }
    if ((this.session?.execution.failedCommands ?? 0) > 0 || (this.session?.gaps.failed.length ?? 0) > 0) {
      return 'manual_review'
    }
    if (this.lastValidationReport && !this.lastValidationReport.isValid) {
      return 'manual_review'
    }
    return 'completed'
  }

  private async phase2Filling(options?: { allowAdFill?: boolean; targetGapIds?: Set<string>; targetSlotIds?: string[]; searchKeywords?: string[] }): Promise<void> {
    this.updateStatus('filling')
    let processed = 0
    const generationContext = await this.dataService.getGenerationContext(this.session!.channelId, this.session!.date)
    const allowAdFill = options?.allowAdFill ?? true
    const targetGapIds = options?.targetGapIds

    while (!this.isCancelled && this.gapManager?.hasRemainingGaps()) {
      const batch = this.collectPlanningBatch(targetGapIds)
      if (batch.length === 0) break

      this.log('info', 'planning', `已启动 ${batch.length} 个空窗的并行规划任务`, {
        concurrency: this.getEffectivePlanningConcurrency(),
        configuredConcurrency: this.config.planningConcurrency,
        batchGapIds: batch.map((gap) => gap.id),
        gapRanges: batch.map((gap) => ({
          gapId: gap.id,
          startTime: gap.startTime,
          endTime: gap.endTime,
        })),
      })

      const preparedPlans = await this.prepareBatchPlans(batch, options?.searchKeywords)
      if (preparedPlans.length === 0) {
        this.session!.gaps.pending = this.getRelevantRemainingGaps(targetGapIds)
        if (this.session!.gaps.pending.length === 0) break
        continue
      }

      for (const plan of preparedPlans) {
        if (this.isCancelled) break
        this.currentGap = plan.gap

        try {
          const executionResult = await this.executePreparedPlan(plan)
          this.gapManager.onGapFilled(plan.gap.id, executionResult.insertedItems)
          this.session!.gaps.completed.push(plan.gap.id)
          this.session!.execution.totalCommands += 1
          this.session!.execution.successfulCommands += 1
          this.syncSessionGapStateFromManager()
          this.emit('gap-complete', { gap: plan.gap, item: executionResult.item })
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error'
          this.gapManager.markFailed(plan.gap.id, message)
          this.session!.gaps.failedReasons[plan.gap.id] = message
          this.session!.execution.totalCommands += 1
          this.session!.execution.failedCommands += 1
          this.syncSessionGapStateFromManager()
          this.log('error', 'execution', `空窗 ${plan.gap.id} 处理失败`, {
            gapId: plan.gap.id,
            startTime: plan.gap.startTime,
            endTime: plan.gap.endTime,
            error: message,
          })
          this.emit('gap-failed', { gap: plan.gap, error: message })
        }

        processed += 1
        this.syncSessionGapStateFromManager()
      }
    }

    if (!this.isCancelled && this.gapManager && allowAdFill) {
      const filledCount = await this.fillRemainingGapsWithAds(generationContext, options?.targetSlotIds)
      processed += filledCount
      this.syncSessionGapStateFromManager()
    }

    if (!this.isCancelled && this.gapManager?.hasRemainingGaps()) {
      const remainingGaps = this.getRelevantRemainingGaps(targetGapIds)
      if (remainingGaps.length === 0) {
        this.session!.gaps.pending = []
        this.currentGap = null
        return
      }
      this.log('warn', 'planning', '自动编排已结束，但仍有未完成空窗待人工确认', {
        remainingGapCount: remainingGaps.length,
        remainingGaps: remainingGaps.slice(0, 10).map((gap) => ({
          gapId: gap.id,
          startTime: gap.startTime,
          endTime: gap.endTime,
          allowedTypes: gap.constraints.allowedTypes,
          source: gap.metadata.source,
        })),
        processedCount: processed,
      })
      this.session!.gaps.pending = remainingGaps
    }

    this.currentGap = null
  }

  private getRelevantRemainingGaps(targetGapIds?: Set<string>): GapInfo[] {
    const remainingGaps = this.gapManager?.queryRemainingGaps() ?? []
    return targetGapIds ? remainingGaps.filter((gap) => targetGapIds.has(gap.id)) : remainingGaps
  }

  private async phase3Repair(): Promise<void> {
    if (!this.config.enableAutoRepair) return
    if (this.session!.execution.successfulCommands === 0) return

    this.updateStatus('repairing')
    this.repairRound = 1
    this.session!.execution.repairRounds = this.repairRound

    const report = await this.validateSchedule()
    this.lastValidationReport = report
    this.log(report.isValid ? 'info' : 'warn', 'validation', '本轮编排校验已完成', {
      reportId: report.id,
      isValid: report.isValid,
      summary: report.summary,
      issues: report.issues.slice(0, 8),
      issueCount: report.issues.length,
    })
    this.emit('validation-complete', { report })
    this.emit('repair-start', { round: this.repairRound, issues: report })
    this.emit('repair-complete', { round: this.repairRound, success: report.isValid })
  }

  private async validateSchedule(): Promise<ValidationReport> {
    const context = await this.dataService.getGenerationContext(this.session!.channelId, this.session!.date)
    if (!context) throw new Error('Missing validation context')

    return this.validationEngine.validate({
      items: this.atomicCapabilities.getAllItems(),
      gaps: this.gapManager?.queryRemainingGaps() ?? [],
      fixedItems: context.constraints.fixedItems,
      layoutSlots: [],
      dayStartTime: this.combineDateTime(this.session!.date, context.channel.broadcastRules.defaultStartTime),
      dayEndTime: this.combineDateTime(this.session!.date, context.channel.broadcastRules.defaultEndTime),
    })
  }

  private async generateQueryCandidatesCommand(
    gap: GapInfo,
    targetSearchKeywords?: string[],
  ): Promise<{ command: QueryCandidatesCommand; thought?: GapPlanningThought }> {
    const generationContext = await this.dataService.getGenerationContext(this.session!.channelId, this.session!.date)
    const defaultCommand: QueryCandidatesCommand = {
      action: 'query_candidates',
      data: {
        gapId: gap.id,
        criteria: {
          targetTimeRange: { start: gap.startTime, end: gap.endTime },
          expectedDuration: {
            min: Math.max(60, Math.floor(gap.duration * 0.4)),
            max: gap.duration,
          },
          channelId: this.session!.channelId,
          columnId: '',
          programTypePreference: gap.constraints.allowedTypes,
          excludeUsed: true,
        },
      },
    }

    if (!generationContext) {
      return { command: defaultCommand }
    }

    const thought = await this.strategyService.planGap(gap, this.session!.strategy, generationContext)
    this.log('info', 'planning', `空窗 ${gap.id} 已生成编排想法`, {
      gapId: gap.id,
      startTime: gap.startTime,
      endTime: gap.endTime,
      summary: thought.summary,
      targetSlotLabel: thought.targetSlotLabel,
      preferredProgramGroup: thought.preferredProgramGroup,
      targetProgramTypes: thought.targetProgramTypes,
      searchKeywords: thought.searchKeywords,
      durationPreference: thought.durationPreference,
      allowFiller: thought.allowFiller,
    })

    const criteria = await this.queryIntentService.generateCriteria(
      gap,
      thought,
      generationContext,
      this.session!.strategy,
    )
    const scopedCriteria = this.applyTargetSearchKeywords(criteria, gap, targetSearchKeywords)

    return {
      command: {
        action: 'query_candidates',
        reasoning: thought.summary,
        data: {
          gapId: gap.id,
          criteria: scopedCriteria,
        },
      },
      thought: targetSearchKeywords?.length
        ? { ...thought, searchKeywords: this.mergeSearchKeywords(thought.searchKeywords, targetSearchKeywords) }
        : thought,
    }
  }

  private applyTargetSearchKeywords(
    criteria: QueryCandidatesCommand['data']['criteria'],
    gap: GapInfo,
    targetSearchKeywords?: string[],
  ): QueryCandidatesCommand['data']['criteria'] {
    const keywords = this.normalizeSearchKeywords(targetSearchKeywords)
    if (keywords.length === 0) return criteria

    return {
      ...criteria,
      columnId: '',
      expectedDuration: {
        min: 60,
        max: gap.duration,
      },
      programTypePreference: this.inferProgramTypesFromTargetKeywords(keywords),
      searchKeywords: keywords,
      selectionPolicy: undefined,
      historyReference: undefined,
    }
  }

  private inferProgramTypesFromTargetKeywords(keywords: string[]): string[] | undefined {
    const text = keywords.join(' ')
    if (/(剧场|电视剧|连续剧|大剧|短剧|drama)/i.test(text)) return ['drama']
    if (/(新闻|资讯|快报|看东方|news)/i.test(text)) return ['news_magazine', 'news', 'current_affairs']
    if (/(少儿|儿童|动画|kids|cartoon)/i.test(text)) return ['kids']
    if (/(综艺|娱乐|晚会|variety)/i.test(text)) return ['variety']
    if (/(专题|纪录|纪实|documentary)/i.test(text)) return ['documentary']
    if (/(广告|ad)/i.test(text)) return ['ad']
    return undefined
  }

  private mergeSearchKeywords(left: string[] = [], right: string[] = []): string[] {
    return this.normalizeSearchKeywords([...left, ...right])
  }

  private normalizeSearchKeywords(values?: string[]): string[] {
    return Array.from(new Set((values ?? []).map((value) => value.trim()).filter(Boolean)))
  }

  private async generateFillItemCommand(
    gap: GapInfo,
    candidates: ProgramCandidate[],
    thought?: GapPlanningThought,
  ): Promise<{ command: FillItemCommand; selectedCandidate: ProgramCandidate }> {
    if (candidates.length === 0) {
      throw new Error('No candidates available for fill command')
    }

    const generationContext = await this.dataService.getGenerationContext(this.session!.channelId, this.session!.date)

    const selection = await this.candidateSelectionService.selectForGap(
      gap,
      generationContext?.channel.channelName ?? this.session!.channelId,
      this.session!.date,
      candidates,
      thought,
      {
        existingItems: this.atomicCapabilities.getAllItems(),
      },
    )

    if (selection.decision !== 'select' || !selection.selectedCandidate) {
      this.log('warn', 'selection', `空窗 ${gap.id} 候选未达到自动编排门槛，已保留空缺`, {
        gapId: gap.id,
        startTime: gap.startTime,
        endTime: gap.endTime,
        decision: selection.decision,
        reasoning: selection.reasoning,
        matchedRequirements: selection.matchedRequirements,
        missingRequirements: selection.missingRequirements,
        riskFlags: selection.riskFlags,
        editorialDecision: selection.editorialDecision,
      })
      throw new Error(selection.reasoning || 'No suitable candidate found')
    }

    return {
      command: {
        action: 'fill_item',
        data: {
          gapId: gap.id,
          selectedCandidateId: selection.selectedCandidate.id,
          selectionReason: selection.reasoning,
          suggestedNextAction: 'continue',
        },
      },
      selectedCandidate: selection.selectedCandidate,
    }
  }

  private collectPlanningBatch(targetGapIds?: Set<string>): GapInfo[] {
    const batchSize = this.getEffectivePlanningConcurrency()
    const batch: GapInfo[] = []
    const remainingGaps = this.gapManager?.queryRemainingGaps() ?? []
    const candidates = targetGapIds
      ? remainingGaps.filter((gap) => targetGapIds.has(gap.id))
      : remainingGaps

    for (const gap of candidates) {
      if (batch.length >= batchSize) break
      this.gapManager?.startProcessing(gap.id)
      batch.push(gap)
      this.emit('gap-start', { gap })
    }

    return batch
  }

  private getEffectivePlanningConcurrency(): number {
    const configuredConcurrency = Math.max(1, this.config.planningConcurrency)
    return this.session?.strategy.sequentialPreference ? 1 : configuredConcurrency
  }

  private async prepareBatchPlans(gaps: GapInfo[], targetSearchKeywords?: string[]): Promise<PreparedGapPlan[]> {
    const results = await Promise.all(
      gaps.map(async (gap) => {
        try {
          const plan = await this.prepareGapPlan(gap, targetSearchKeywords)
          return { ok: true as const, plan }
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error'
          this.gapManager?.markFailed(gap.id, message)
          this.session!.gaps.failed.push(gap.id)
          this.session!.gaps.failedReasons[gap.id] = message
          this.session!.execution.totalCommands += 1
          this.session!.execution.failedCommands += 1
          this.log('error', 'planning', `空窗 ${gap.id} 并行规划失败`, {
            gapId: gap.id,
            error: message,
          })
          this.emit('gap-failed', { gap, error: message })
          return { ok: false as const }
        }
      }),
    )

    return results
      .filter((entry): entry is { ok: true; plan: PreparedGapPlan } => entry.ok)
      .map((entry) => entry.plan)
      .sort((left, right) => new Date(left.gap.startTime).getTime() - new Date(right.gap.startTime).getTime())
  }

  private async prepareGapPlan(gap: GapInfo, targetSearchKeywords?: string[]): Promise<PreparedGapPlan> {
    const { command: queryCommand, thought } = await this.generateQueryCandidatesCommand(gap, targetSearchKeywords)
    this.log('info', 'query', `空窗 ${gap.id} 已生成接口查询参数`, {
      gapId: gap.id,
      startTime: gap.startTime,
      endTime: gap.endTime,
      criteria: queryCommand.data.criteria,
      reasoning: queryCommand.reasoning,
    })

    const candidatesResult = await this.candidateService.queryCandidates(gap, queryCommand.data.criteria)
    if (candidatesResult.candidates.length === 0) {
      this.log('warn', 'query', `空窗 ${gap.id} 候选检索未命中可自动编排节目`, {
        gapId: gap.id,
        startTime: gap.startTime,
        endTime: gap.endTime,
        criteria: queryCommand.data.criteria,
        targetSlotLabel: thought?.targetSlotLabel,
        candidateCount: 0,
        diagnostics: candidatesResult.diagnostics,
      })
      throw new Error(this.formatCandidateQueryFailure(candidatesResult.diagnostics?.rejectionReasons))
    }

    this.log('info', 'query', `空窗 ${gap.id} 已完成接口查询`, {
      gapId: gap.id,
      startTime: gap.startTime,
      endTime: gap.endTime,
      criteria: queryCommand.data.criteria,
      targetSlotLabel: thought?.targetSlotLabel,
      candidateCount: candidatesResult.candidates.length,
      diagnostics: candidatesResult.diagnostics,
      topCandidates: candidatesResult.candidates.slice(0, 3).map((item) => ({
        id: item.id,
        programCode: item.programCode,
        programName: item.programName,
        duration: item.duration,
        programType: item.programType,
        columnId: item.columnId,
        columnName: item.columnName,
        contentTags: item.contentTags,
        estimatedRating: item.estimatedRating,
        playCount: item.playCount,
        popularityScore: item.popularityScore,
        issueNo: item.issueNo,
        sequenceNo: (item as ProgramCandidate & { sequenceNo?: number }).sequenceNo,
        expectedSequenceNo: (item as ProgramCandidate & { expectedSequenceNo?: number }).expectedSequenceNo,
        selectionMode: (item as ProgramCandidate & { selectionMode?: string }).selectionMode,
        selectionNote: (item as ProgramCandidate & { selectionNote?: string }).selectionNote,
        editorialDecision: item.editorialDecision,
      })),
    })

    const fillSelection = await this.generateFillItemCommand(gap, candidatesResult.candidates, thought)
    const fillCommand = fillSelection.command
    const selectedCandidate =
      fillSelection.selectedCandidate ??
      candidatesResult.candidates.find((item) => item.id === fillCommand.data.selectedCandidateId) ??
      candidatesResult.candidates[0]

    if (!selectedCandidate) {
      throw new Error('No selected candidate')
    }

    this.log('info', 'selection', `空窗 ${gap.id} 已完成候选选择`, {
      gapId: gap.id,
      startTime: gap.startTime,
      endTime: gap.endTime,
      selectedCandidateId: selectedCandidate.id,
      selectedCandidateName: selectedCandidate.programName,
      selectedCandidate: this.toCandidateDetail(selectedCandidate),
      selectionReason: fillCommand.data.selectionReason,
      sequenceNo: (selectedCandidate as ProgramCandidate & { sequenceNo?: number }).sequenceNo,
      selectionMode: (selectedCandidate as ProgramCandidate & { selectionMode?: string }).selectionMode,
      selectionNote: (selectedCandidate as ProgramCandidate & { selectionNote?: string }).selectionNote,
      editorialDecision: selectedCandidate.editorialDecision,
    })

    return {
      gap,
      queryCommand,
      thought,
      candidates: candidatesResult.candidates,
      fillCommand,
      selectedCandidate,
    }
  }

  private toCandidateDetail(candidate: ProgramCandidate): Record<string, unknown> {
    return {
      id: candidate.id,
      programId: candidate.programId,
      programCode: candidate.programCode,
      programName: candidate.programName,
      instanceName: candidate.instanceName,
      duration: candidate.duration,
      programType: candidate.programType,
      columnId: candidate.columnId,
      columnName: candidate.columnName,
      issueNo: candidate.issueNo,
      contentTags: candidate.contentTags,
      estimatedRating: candidate.estimatedRating,
      playCount: candidate.playCount,
      popularityScore: candidate.popularityScore,
      sequenceNo: (candidate as ProgramCandidate & { sequenceNo?: number }).sequenceNo,
      expectedSequenceNo: (candidate as ProgramCandidate & { expectedSequenceNo?: number }).expectedSequenceNo,
      selectionMode: (candidate as ProgramCandidate & { selectionMode?: string }).selectionMode,
      selectionNote: (candidate as ProgramCandidate & { selectionNote?: string }).selectionNote,
      editorialDecision: candidate.editorialDecision,
    }
  }

  private formatCandidateQueryFailure(rejectionReasons?: string[]): string {
    const reasons = rejectionReasons ?? []
    if (reasons.includes('explicit_sequence_no_match')) {
      return 'No candidates found: explicit_sequence_no_match'
    }
    if (reasons.includes('functional_keyword_no_match')) {
      return 'No candidates found: functional_keyword_no_match'
    }
    if (reasons.includes('hard_keyword_no_match')) {
      return 'No candidates found: hard_keyword_no_match'
    }
    if (reasons.includes('duration_mismatch')) {
      return 'No candidates found: duration_mismatch'
    }
    if (reasons.includes('program_type_mismatch')) {
      return 'No candidates found: program_type_mismatch'
    }
    if (reasons.includes('column_has_no_programs')) {
      return 'No candidates found: column_has_no_programs'
    }
    return reasons.length ? `No candidates found: ${reasons.join(',')}` : 'No candidates found'
  }

  private async executePreparedPlan(plan: PreparedGapPlan): Promise<ExecutedGapPlanResult> {
    const context = await this.dataService.getGenerationContext(this.session!.channelId, this.session!.date)
    if (!context) {
      throw new Error('Missing generation context')
    }

    const materialized = this.materializer.materialize({
      gap: plan.gap,
      selectedCandidate: plan.selectedCandidate,
      channelContext: context.channel,
    })

    if (!materialized.success || !materialized.item || !materialized.items?.length) {
      throw new Error(materialized.error || 'Materialize failed')
    }

    const existingItems = this.atomicCapabilities.getAllItems()
    const intentError = this.detectSelectedCandidateIntentMismatch(plan.selectedCandidate, plan.thought)
    if (intentError) {
      this.log('warn', 'execution', `空窗 ${plan.gap.id} 命中明确编排意图冲突，已阻止写入`, {
        gapId: plan.gap.id,
        startTime: plan.gap.startTime,
        endTime: plan.gap.endTime,
        intentError,
        selectedCandidateId: plan.selectedCandidate.id,
        selectedCandidateName: plan.selectedCandidate.programName,
        searchKeywords: plan.thought?.searchKeywords,
      })
      throw new Error(intentError)
    }

    const strategyError = this.detectSelectedCandidateStrategyMismatch(
      plan.selectedCandidate,
      plan.candidates,
      plan.thought,
      plan.queryCommand,
    )
    if (strategyError) {
      this.log('warn', 'execution', `空窗 ${plan.gap.id} 命中编排策略冲突，已阻止写入`, {
        gapId: plan.gap.id,
        startTime: plan.gap.startTime,
        endTime: plan.gap.endTime,
        strategyError,
        selectedCandidateId: plan.selectedCandidate.id,
        selectedCandidateName: plan.selectedCandidate.programName,
        topCandidateId: plan.candidates[0]?.id,
        topCandidateName: plan.candidates[0]?.programName,
        selectionPolicy: plan.thought?.selectionPolicy ?? plan.queryCommand.data.criteria.selectionPolicy,
      })
      throw new Error(strategyError)
    }

    const conflictError = this.detectAppendConflict(materialized.items, existingItems, plan.gap)
    if (conflictError) {
      this.log('warn', 'execution', `空窗 ${plan.gap.id} 命中时间冲突，已阻止写入`, {
        gapId: plan.gap.id,
        startTime: plan.gap.startTime,
        endTime: plan.gap.endTime,
        conflictError,
        insertedItems: materialized.items.map((entry) => ({
          itemId: entry.id,
          programName: entry.programName,
          startTime: entry.startTime,
          endTime: entry.endTime,
          duration: entry.duration,
          programType: entry.programType,
        })),
      })
      throw new Error(conflictError)
    }

    const sequenceError = this.detectAppendSequenceOrderViolation(materialized.items, existingItems)
    if (sequenceError) {
      this.log('warn', 'execution', `空窗 ${plan.gap.id} 命中连续剧顺序冲突，已阻止写入`, {
        gapId: plan.gap.id,
        startTime: plan.gap.startTime,
        endTime: plan.gap.endTime,
        sequenceError,
        selectedCandidateId: plan.selectedCandidate.id,
        selectedCandidateName: plan.selectedCandidate.programName,
        insertedItems: materialized.items.map((entry) => ({
          itemId: entry.id,
          programName: entry.programName,
          programCode: entry.programCode,
          startTime: entry.startTime,
          endTime: entry.endTime,
        })),
      })
      throw new Error(sequenceError)
    }

    const appendResult = await this.atomicCapabilities.appendItems(materialized.items, { skipValidation: true })
    if (!appendResult.success) {
      throw new Error(appendResult.error || 'Append failed')
    }

    this.log('info', 'execution', `空窗 ${plan.gap.id} 已插入节目`, {
      gapId: plan.gap.id,
      insertedCount: materialized.items.length,
      itemId: materialized.item.id,
      programName: materialized.item.programName,
      startTime: materialized.items[0]?.startTime ?? materialized.item.startTime,
      endTime: materialized.item.endTime,
      insertedItems: materialized.items.map((entry) => ({
        itemId: entry.id,
        programName: entry.programName,
        startTime: entry.startTime,
        endTime: entry.endTime,
        duration: entry.duration,
        programType: entry.programType,
      })),
      selectionReason: plan.fillCommand.data.selectionReason,
      selectedCandidateId: plan.selectedCandidate.id,
      selectedCandidateName: plan.selectedCandidate.programName,
      selectedCandidate: this.toCandidateDetail(plan.selectedCandidate),
      sequenceNo: (plan.selectedCandidate as ProgramCandidate & { sequenceNo?: number }).sequenceNo,
      selectionMode: (plan.selectedCandidate as ProgramCandidate & { selectionMode?: string }).selectionMode,
      selectionNote: (plan.selectedCandidate as ProgramCandidate & { selectionNote?: string }).selectionNote,
      editorialDecision: plan.selectedCandidate.editorialDecision,
    })

    return {
      item: materialized.item,
      insertedItems: materialized.items,
    }
  }

  private async fillRemainingGapsWithAds(
    generationContext?: Awaited<ReturnType<ReturnType<typeof getDataService>['getGenerationContext']>> | null,
    targetSlotIds?: string[],
  ): Promise<number> {
    const layoutReference = generationContext?.layoutReference
    if (!layoutReference) return 0
    const slotIdFilter = Array.isArray(targetSlotIds) ? new Set(targetSlotIds) : null
    if (slotIdFilter && slotIdFilter.size === 0) return 0

    let insertedCount = 0
    let currentItems = this.atomicCapabilities.getAllItems()

    for (const slot of layoutReference.slots) {
      if (this.isCancelled) break
      if (slotIdFilter && !slotIdFilter.has(slot.id)) continue
      if (this.hasProtectedFailedGapInSlot(slot)) {
        this.log('info', 'execution', '版面 ' + slot.id + ' 存在明确编排意图失败空窗，已跳过广告补位', {
          slotId: slot.id,
          slotStartTime: slot.startTime,
          slotEndTime: slot.endTime,
          reason: 'protected_failed_gap',
        })
        continue
      }

      let slotChanged = true
      while (!this.isCancelled && slotChanged) {
        slotChanged = false
        const opportunities = collectAdInsertionOpportunities(
          { ...layoutReference, slots: [slot] },
          currentItems,
        )

        for (const opportunity of opportunities) {
          const plan = buildAdInsertionPlan(
            opportunity,
            slot,
            currentItems,
            generationContext?.constraints.fixedItems ?? [],
          )
          if (!plan) {
            this.log('info', 'execution', '版面 ' + slot.id + ' 的广告机会点已跳过', {
              slotId: slot.id,
              slotStartTime: slot.startTime,
              slotEndTime: slot.endTime,
              position: opportunity.position,
              insertAt: opportunity.insertAt,
              reason: 'slot_boundary_or_fixed_item_conflict',
            })
            continue
          }

          const replacedItems = applyAdInsertionPlan(plan, currentItems)
          const overlapError = this.detectScheduleConflicts(replacedItems)
          if (overlapError) {
            this.log('warn', 'execution', '版面 ' + slot.id + ' 广告插播命中时间冲突，已阻止写入', {
              slotId: slot.id,
              position: opportunity.position,
              insertAt: opportunity.insertAt,
              conflictError: overlapError,
            })
            continue
          }
          const replaceResult = await this.atomicCapabilities.replaceAllItems(replacedItems, { skipValidation: true })
          if (!replaceResult.success) {
            this.log('warn', 'execution', '版面 ' + slot.id + ' 广告插播写入失败', {
              slotId: slot.id,
              position: opportunity.position,
              insertAt: opportunity.insertAt,
              error: replaceResult.error || 'Replace failed',
            })
            continue
          }

          currentItems = this.atomicCapabilities.getAllItems()
          this.recalculateGapsFromCurrentItems(currentItems, generationContext)
          insertedCount += 1
          slotChanged = true
          this.session!.execution.totalCommands += 1
          this.session!.execution.successfulCommands += 1

          this.log('info', 'execution', '版面 ' + slot.id + ' 已插入广告并顺延后续节目', {
            slotId: slot.id,
            slotStartTime: slot.startTime,
            slotEndTime: slot.endTime,
            position: opportunity.position,
            insertAt: opportunity.insertAt,
            durationSeconds: plan.durationSeconds,
            shiftedItemCount: plan.shiftedItems.length,
            insertedItems: [plan.adItem],
            shiftedItems: plan.shiftedItems.map((item) => ({
              itemId: item.id,
              programName: item.programName,
              startTime: item.startTime,
              endTime: item.endTime,
              duration: item.duration,
              programType: item.programType,
            })),
          })

          await this.waitWithCancellation(AD_INSERTION_PACING_MS)
          await this.yieldToBrowser()

          break
        }
      }
    }

    return insertedCount
  }

  private hasProtectedFailedGapInSlot(slot: LayoutReference['slots'][number]): boolean {
    const protectedReasons = [
      'hard_keyword_no_match',
      'explicit_sequence_no_match',
      'functional_keyword_no_match',
      'sequence_context_order_conflict',
    ]
    return this.gapManager?.getActiveGaps().some((gap) => {
      if (gap.status !== 'failed') return false
      if (!gap.error || !protectedReasons.some((reason) => gap.error?.includes(reason))) return false
      return this.rangesOverlap(gap.startTime, gap.endTime, slot.startTime, slot.endTime)
    }) ?? false
  }

  private buildPlanningPrompt(gapCount: number): ChatMessage[] {
    return [
      {
        role: 'system',
        content: [
          '你是电视节目单编排助手。请只输出 JSON PlanCommand，用于描述全局编排策略，而不是直接输出节目单。',
          '必须严格输出一个 JSON 对象，不要使用 Markdown，不要输出解释文字。',
          'JSON 结构固定为：',
          '{"action":"plan","reasoning":"...","data":{"strategy":{"target":"demo-orchestration","referencePriority":["layout","history","library"],"allowFiller":true,"sequentialPreference":true,"riskPreference":"balanced"},"initialGapCount":1,"estimatedSteps":1}}',
          'riskPreference 只能是 conservative、balanced、aggressive 之一。',
        ].join('\n'),
      },
      {
        role: 'user',
        content: [
          `频道: ${this.session!.channelId}`,
          `日期: ${this.session!.date}`,
          `待处理空窗数: ${gapCount}`,
          '请根据空窗数量返回一份全局策略。estimatedSteps 通常等于待处理空窗数。',
        ].join('\n'),
      },
    ]
  }

  private async runWithTimeout<T>(task: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      return task
    }

    let timerId: ReturnType<typeof setTimeout> | null = null
    try {
      return await Promise.race([
        task,
        new Promise<never>((_, reject) => {
          timerId = setTimeout(() => {
            reject(new Error(timeoutMessage))
          }, timeoutMs)
        }),
      ])
    } finally {
      if (timerId) {
        clearTimeout(timerId)
      }
    }
  }

  private parseJSONCommand<T>(content: string): T | null {
    try {
      const match = content.match(/\{[\s\S]*\}/)
      if (!match) return null
      return JSON.parse(match[0]) as T
    } catch {
      return null
    }
  }

  private updateStatus(nextStatus: PlanningSessionStatus): void {
    if (!this.session) return
    const previousStatus = this.session.status
    this.session.status = nextStatus
    this.session.updatedAt = new Date().toISOString()
    this.emit('status-change', { status: nextStatus, previousStatus })
  }

  private log(level: PlanningLogEntry['level'], phase: string, message: string, details?: Record<string, unknown>): void {
    if (!this.session) return
    const entry: PlanningLogEntry = {
      id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
      level,
      phase,
      message,
      details,
    }
    this.session.logs.push(entry)
    this.emit('log', { entry })
  }

  private handleError(error: Error): void {
    this.log('error', 'session', error.message)
    this.updateStatus('failed')
    this.emit('error', { error })
  }

  private combineDateTime(date: string, time: string): string {
    return time.includes('T') ? time : `${date}T${time}+08:00`
  }

  private recalculateGapsFromCurrentItems(
    items: ScheduleItemSnapshot[],
    generationContext?: Awaited<ReturnType<ReturnType<typeof getDataService>['getGenerationContext']>> | null,
  ): void {
    if (!this.gapManager || !this.session || !generationContext) return

    this.gapManager.calculateGapsFromItems(
      items,
      generationContext.constraints.fixedItems,
      this.combineDateTime(this.session.date, generationContext.channel.broadcastRules.defaultStartTime),
      this.combineDateTime(this.session.date, generationContext.channel.broadcastRules.defaultEndTime),
    )

    const typedLayoutSlots = (generationContext.layoutReference?.slots ?? [])
      .map((slot) => {
        const column = getEffectiveColumnDefinition(slot.columnId)
        if (!column) return null
        return {
          startTime: slot.startTime,
          endTime: slot.endTime,
          programType: column.defaultProgramType,
          preferredProgramTypes: [column.defaultProgramType],
        }
      })
      .filter((slot): slot is NonNullable<typeof slot> => Boolean(slot))

    this.gapManager.alignGapsToLayoutBands(typedLayoutSlots)
    this.syncSessionGapStateFromManager()
  }

  private syncSessionGapStateFromManager(): void {
    if (!this.session || !this.gapManager) return

    this.session.gaps.pending = this.gapManager.queryRemainingGaps()
    const failedGaps = this.gapManager.getActiveGaps().filter((gap) => gap.status === 'failed')
    this.session.gaps.failed = failedGaps.map((gap) => gap.id)
    failedGaps.forEach((gap) => {
      if (gap.error) {
        this.session!.gaps.failedReasons[gap.id] = gap.error
      }
    })
  }

  private resolveRelevantLayoutSlotIds(gaps: GapInfo[], layoutReference?: LayoutReference | null): string[] {
    if (!layoutReference?.slots?.length || !gaps.length) {
      return []
    }

    const resolvedSlotIds = new Set<string>()
    for (const gap of gaps) {
      const gapStart = new Date(gap.startTime).getTime()
      const gapEnd = new Date(gap.endTime).getTime()
      layoutReference.slots.forEach((slot) => {
        const slotStart = new Date(slot.startTime).getTime()
        const slotEnd = new Date(slot.endTime).getTime()
        if (slotStart < gapEnd && slotEnd > gapStart) {
          resolvedSlotIds.add(slot.id)
        }
      })
    }

    return Array.from(resolvedSlotIds)
  }

  private detectAppendConflict(
    incomingItems: ScheduleItemSnapshot[],
    existingItems: ScheduleItemSnapshot[],
    gap: GapInfo,
  ): string | null {
    const batchConflict = this.detectScheduleConflicts(incomingItems)
    if (batchConflict) {
      return `待写入条目内部存在时间冲突：${batchConflict}`
    }

    for (const incomingItem of incomingItems) {
      const conflicts = existingItems.filter((item) => this.isTimeOverlapping(item, incomingItem))
      if (!conflicts.length) continue

      const conflict = conflicts[0]
      if (!conflict) continue
      const conflictName = conflict.programName || conflict.programCode || conflict.id
      return [
        `待写入节目《${incomingItem.programName}》与现有条目冲突`,
        `冲突时段 ${incomingItem.startTime} - ${incomingItem.endTime}`,
        `重叠条目《${conflictName}》(${conflict.startTime} - ${conflict.endTime})`,
        `目标空窗 ${gap.startTime} - ${gap.endTime}`,
      ].join('；')
    }

    return null
  }

  private detectScheduleConflicts(items: ScheduleItemSnapshot[]): string | null {
    if (items.length <= 1) return null

    const sortedItems = [...items].sort(
      (left, right) => new Date(left.startTime).getTime() - new Date(right.startTime).getTime(),
    )

    for (let index = 1; index < sortedItems.length; index += 1) {
      const previous = sortedItems[index - 1]
      const current = sortedItems[index]
      if (!previous || !current) continue
      if (!this.isTimeOverlapping(previous, current)) continue

      const previousName = previous.programName || previous.programCode || previous.id
      const currentName = current.programName || current.programCode || current.id
      return `《${previousName}》与《${currentName}》在 ${current.startTime} 附近发生重叠`
    }

    return null
  }

  private detectSelectedCandidateIntentMismatch(
    candidate: ProgramCandidate,
    thought?: GapPlanningThought,
  ): string | null {
    const hardKeywords = extractSpecificSearchKeywords(thought?.searchKeywords ?? [])
    const sequenceRequired = hasExplicitSequenceRequirements(thought?.searchKeywords ?? [])
    const editorialRequirements = extractEditorialKeywordRequirements(thought?.searchKeywords ?? [])
    const editorialRequired = hasEditorialKeywordRequirements(thought?.searchKeywords ?? [])
    const functionalRequired = hasFunctionalSearchKeywords(thought?.searchKeywords ?? [])
    if (hardKeywords.length === 0 && !sequenceRequired && !editorialRequired && !functionalRequired) {
      return null
    }

    const haystack = this.buildCandidateSearchText(candidate)
    const titleMatched = hardKeywords.length === 0 || matchesSpecificSearchKeywords(haystack, thought?.searchKeywords ?? [])
    const sequenceMatched = !sequenceRequired || matchesExplicitSequenceRequirements(haystack, thought?.searchKeywords ?? [])
    const editorialMatched = !editorialRequired || this.matchesEditorialKeywordRequirements(candidate, thought?.searchKeywords ?? [])
    const functionalMatched = !functionalRequired || matchesFunctionalSearchKeywords(haystack, thought?.searchKeywords ?? [])
    if (titleMatched && sequenceMatched && editorialMatched && functionalMatched) {
      return null
    }

    return [
      `待写入节目《${candidate.programName}》未命中明确编排关键词`,
      `需要命中：${[
        ...hardKeywords,
        ...(sequenceRequired ? ['指定集数/期数'] : []),
        ...editorialRequirements.map((item) => `${item.kind}:${item.raw}`),
        ...(functionalRequired ? ['功能型内容要求'] : []),
      ].join('、')}`,
      '已保留空缺并中止自动写入',
    ].join('；')
  }

  private matchesEditorialKeywordRequirements(candidate: ProgramCandidate, searchKeywords: string[]): boolean {
    return matchesEditorialKeywordRequirementsByFields({
      column: [candidate.columnName, candidate.columnId].filter(Boolean).join(' '),
      title: [candidate.programName, candidate.instanceName].filter(Boolean).join(' '),
      content: [
        candidate.programName,
        candidate.instanceName,
        ...(candidate.contentTags ?? []),
      ].filter(Boolean).join(' '),
      all: this.buildCandidateSearchText(candidate),
    }, searchKeywords)
  }

  private detectSelectedCandidateStrategyMismatch(
    selectedCandidate: ProgramCandidate,
    rankedCandidates: ProgramCandidate[],
    thought: GapPlanningThought | undefined,
    queryCommand: QueryCandidatesCommand,
  ): string | null {
    const primary = thought?.selectionPolicy?.primary ?? queryCommand.data.criteria.selectionPolicy?.primary
    if (!primary || !['sequence', 'rating', 'trending', 'content_match'].includes(primary)) {
      return null
    }
    if (rankedCandidates.length <= 1) {
      return null
    }

    const selectedFromPool = rankedCandidates.find((candidate) => candidate.id === selectedCandidate.id)
    if (!selectedFromPool) {
      return [
        `待写入节目《${selectedCandidate.programName}》不在本段候选池中`,
        '已中止自动写入，避免绕过候选检索与策略排序',
      ].join('；')
    }

    const topCandidate = rankedCandidates[0]
    if (!topCandidate || topCandidate.id === selectedCandidate.id) {
      return null
    }

    const topScore = topCandidate.editorialDecision?.totalScore
    const selectedScore = selectedFromPool.editorialDecision?.totalScore ?? selectedCandidate.editorialDecision?.totalScore
    if (primary === 'content_match' && typeof topScore === 'number' && typeof selectedScore === 'number' && selectedScore >= topScore) {
      return null
    }

    const strategyLabel = primary === 'sequence'
      ? '电视顺播'
      : primary === 'rating'
        ? '轮播单收视率优先'
        : primary === 'trending'
          ? '轮播单热播优先'
          : '轮播单内容匹配优先'
    const scoreText = typeof topScore === 'number' || typeof selectedScore === 'number'
      ? `首选评分 ${topScore ?? '无'}，待写入评分 ${selectedScore ?? '无'}`
      : '候选池已按策略排序'

    return [
      `待写入节目《${selectedCandidate.programName}》不是本段${strategyLabel}策略下的首选候选`,
      `候选池首位为《${topCandidate.programName}》`,
      scoreText,
      '已中止自动写入，避免上游绕过策略判断',
    ].join('；')
  }

  private detectAppendSequenceOrderViolation(
    incomingItems: ScheduleItemSnapshot[],
    existingItems: ScheduleItemSnapshot[],
  ): string | null {
    const incomingIds = new Set(incomingItems.map((item) => item.id))
    const items = [...existingItems, ...incomingItems].sort(
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
        const involvesIncoming = incomingIds.has(item.id) || incomingIds.has(previous.id)
        if (typeof previousSequence === 'number' && involvesIncoming) {
          if (sequenceNo < previousSequence) {
            return [
              `待写入节目《${item.programName}》会造成顺播倒序`,
              `前面 ${this.toClock(previous.startTime)} 已有第${previousSequence}集`,
              `后面 ${this.toClock(item.startTime)} 出现第${sequenceNo}集`,
            ].join('；')
          }
          if (sequenceNo > previousSequence + 1) {
            return [
              `待写入节目《${item.programName}》会造成顺播跳集`,
              `前面 ${this.toClock(previous.startTime)} 已有第${previousSequence}集`,
              `后面 ${this.toClock(item.startTime)} 直接出现第${sequenceNo}集`,
            ].join('；')
          }
        }
      }

      previousBySeries.set(seriesKey, item)
    }

    return null
  }

  private buildCandidateSearchText(candidate: ProgramCandidate): string {
    return [
      candidate.programName,
      candidate.instanceName,
      candidate.programCode,
      candidate.issueNo,
      candidate.columnName,
      candidate.columnId,
      ...(candidate.contentTags ?? []),
    ].filter(Boolean).join(' ')
  }

  private isTimeOverlapping(left: ScheduleItemSnapshot, right: ScheduleItemSnapshot): boolean {
    return this.rangesOverlap(left.startTime, left.endTime, right.startTime, right.endTime)
  }

  private rangesOverlap(leftStartTime: string, leftEndTime: string, rightStartTime: string, rightEndTime: string): boolean {
    const leftStart = new Date(leftStartTime).getTime()
    const leftEnd = new Date(leftEndTime).getTime()
    const rightStart = new Date(rightStartTime).getTime()
    const rightEnd = new Date(rightEndTime).getTime()
    return leftStart < rightEnd && rightStart < leftEnd
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
      .replace(/^[^:：]+[:：]/u, '')
      .replace(/第\s*[0-9零〇一二两三四五六七八九十百]+\s*[集期]/gu, '')
      .replace(/[上中下][集期]/gu, '')
      .replace(/[《》“”"'（）()【】·、。；;：:\-—]/g, '')
  }

  private extractSequenceNo(item: ScheduleItemSnapshot): number | null {
    const issueNo = this.parsePositiveNumber((item as ScheduleItemSnapshot & { issueNo?: string }).issueNo)
    if (issueNo !== null) {
      return issueNo
    }

    const codeMatch = item.programCode?.match(/(\d{1,4})$/)
    if (codeMatch) {
      const parsed = Number(codeMatch[1])
      if (Number.isFinite(parsed) && parsed > 0) {
        return parsed
      }
    }

    const nameMatch = item.programName?.match(/第\s*([0-9零〇一二两三四五六七八九十百]+)\s*[集期]/u)
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
    return value.split('T')[1]?.slice(0, 8) ?? value
  }

  private async yieldToBrowser(): Promise<void> {
    await new Promise<void>((resolve) => {
      setTimeout(() => resolve(), 0)
    })
  }

  private async waitWithCancellation(durationMs: number, stepMs = 100): Promise<void> {
    if (durationMs <= 0) return

    let remainingMs = durationMs
    while (!this.isCancelled && remainingMs > 0) {
      const currentStep = Math.min(stepMs, remainingMs)
      await new Promise<void>((resolve) => {
        setTimeout(() => resolve(), currentStep)
      })
      remainingMs -= currentStep
    }
  }
}

let globalOrchestrator: Orchestrator | null = null

export function getOrchestrator(
  llmClient?: LLMClient,
  taskClassifier?: TaskClassifier,
  config?: Partial<OrchestratorConfig>,
): Orchestrator {
  if (!globalOrchestrator) {
    if (!llmClient || !taskClassifier) {
      throw new Error('LLM client and task classifier are required for first initialization')
    }
    globalOrchestrator = new Orchestrator(llmClient, taskClassifier, config)
  }
  return globalOrchestrator
}

export function resetOrchestrator(): void {
  globalOrchestrator = null
}
