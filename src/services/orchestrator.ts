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
import { getOrchestrationDemoColumn } from '@/mock/orchestrationMock'

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

class EventEmitter {
  private listeners = new Map<keyof EventPayloadMap, Array<(payload: any) => void>>()

  on<K extends keyof EventPayloadMap>(event: K, listener: (payload: EventPayloadMap[K]) => void) {
    const current = this.listeners.get(event) ?? []
    current.push(listener as (payload: any) => void)
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
}

const DEFAULT_CONFIG: OrchestratorConfig = {
  maxRepairRounds: 1,
  enableAutoRepair: true,
  maxGapItems: 10,
  planningConcurrency: 1,
}

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

    try {
      this.createSession(channelId, date, strategy)

      const generationContext = await this.dataService.getGenerationContext(channelId, date)
      if (!generationContext) throw new Error('Unable to load generation context')

      const existingItems = this.atomicCapabilities.getAllItems()
      const layoutSlots = generationContext.layoutReference?.slots ?? []
      const typedLayoutSlots = layoutSlots
        .map((slot) => {
          const column = getOrchestrationDemoColumn(slot.columnId)
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
      await this.phase2Filling()
      if (this.isCancelled) return
      await this.phase3Repair()

      if (!this.isCancelled) {
        this.updateStatus('completed')
        this.emit('complete', { session: this.session! })
      }
    } catch (error) {
      this.handleError(error as Error)
      throw error
    } finally {
      this.isRunning = false
    }
  }

  async startPartialGeneration(channelId: string, date: string, targetGapIds?: string[]): Promise<void> {
    if (this.isRunning) throw new Error('Orchestrator is already running')
    this.isRunning = true
    this.isCancelled = false
    this.repairRound = 0

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
          const column = getOrchestrationDemoColumn(slot.columnId)
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
      this.session!.gaps.pending = targetGapIds?.length ? gaps.filter((gap) => targetGapIds.includes(gap.id)) : gaps

      await this.phase2Filling()
      if (this.isCancelled) return
      await this.phase3Repair()

      if (!this.isCancelled) {
        this.updateStatus('completed')
        this.emit('complete', { session: this.session! })
      }
    } catch (error) {
      this.handleError(error as Error)
      throw error
    } finally {
      this.isRunning = false
    }
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
      const response = await this.llmClient.chat(prompt, { temperature: 0.2, maxTokens: 800 })
      const plan = this.parseJSONCommand<PlanCommand>(response.content)
      if (plan?.action === 'plan') {
        this.session!.strategy = { ...this.session!.strategy, ...plan.data.strategy }
      }
      this.log('info', 'planning', '已生成全局编排策略', {
        strategy: this.session!.strategy,
        initialGapCount: this.session!.gaps.pending.length,
      })
    } catch {
      this.log('warn', 'planning', 'LLM 策略规划不可用，已回退到默认编排策略', {
        strategy: this.session!.strategy,
      })
    }
  }

  private async phase2Filling(): Promise<void> {
    this.updateStatus('filling')
    let processed = 0
    const generationContext = await this.dataService.getGenerationContext(this.session!.channelId, this.session!.date)

    while (!this.isCancelled && this.gapManager && processed < this.config.maxGapItems) {
      const batch = this.collectPlanningBatch(this.config.maxGapItems - processed)
      if (batch.length === 0) break

      this.log('info', 'planning', `已启动 ${batch.length} 个空窗的并行规划任务`, {
        concurrency: this.config.planningConcurrency,
        batchGapIds: batch.map((gap) => gap.id),
        gapRanges: batch.map((gap) => ({
          gapId: gap.id,
          startTime: gap.startTime,
          endTime: gap.endTime,
        })),
      })

      const preparedPlans = await this.prepareBatchPlans(batch)
      if (preparedPlans.length === 0) {
        this.session!.gaps.pending = this.gapManager.queryRemainingGaps()
        break
      }

      for (const plan of preparedPlans) {
        if (this.isCancelled) break
        this.currentGap = plan.gap

        try {
          const item = await this.executePreparedPlan(plan)
          this.gapManager.onGapFilled(plan.gap.id, item)
          this.session!.gaps.completed.push(plan.gap.id)
          this.session!.execution.totalCommands += 1
          this.session!.execution.successfulCommands += 1
          this.emit('gap-complete', { gap: plan.gap, item })
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error'
          this.gapManager.markFailed(plan.gap.id, message)
          this.session!.gaps.failed.push(plan.gap.id)
          this.session!.execution.totalCommands += 1
          this.session!.execution.failedCommands += 1
          this.log('error', 'execution', `空窗 ${plan.gap.id} 处理失败`, {
            gapId: plan.gap.id,
            startTime: plan.gap.startTime,
            endTime: plan.gap.endTime,
            error: message,
          })
          this.emit('gap-failed', { gap: plan.gap, error: message })
        }

        processed += 1
        this.session!.gaps.pending = this.gapManager.queryRemainingGaps()
      }
    }

    if (!this.isCancelled && this.gapManager) {
      const filledCount = await this.fillRemainingGapsWithAds(generationContext)
      processed += filledCount
      if (filledCount > 0) {
        this.session!.gaps.pending = this.gapManager.queryRemainingGaps()
      }
    }

    this.currentGap = null
  }

  private async phase3Repair(): Promise<void> {
    if (!this.config.enableAutoRepair) return
    if (this.session!.execution.successfulCommands === 0) return

    this.updateStatus('repairing')
    this.repairRound = 1
    this.session!.execution.repairRounds = this.repairRound

    const report = await this.validateSchedule()
    this.log(report.isValid ? 'info' : 'warn', 'validation', '本轮编排校验已完成', {
      reportId: report.id,
      isValid: report.isValid,
      summary: report.summary,
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

    return {
      command: {
        action: 'query_candidates',
        reasoning: thought.summary,
        data: {
          gapId: gap.id,
          criteria,
        },
      },
      thought,
    }
  }

  private async generateFillItemCommand(
    gap: GapInfo,
    candidates: ProgramCandidate[],
    thought?: GapPlanningThought,
  ): Promise<FillItemCommand> {
    const defaultCandidate = candidates[0]
    if (!defaultCandidate) {
      throw new Error('No candidates available for fill command')
    }

    const defaultCommand: FillItemCommand = {
      action: 'fill_item',
      data: {
        gapId: gap.id,
        selectedCandidateId: defaultCandidate.id,
        selectionReason: '默认选择评分较高且时长最接近的候选节目。',
        suggestedNextAction: 'continue',
      },
    }

    const generationContext = await this.dataService.getGenerationContext(this.session!.channelId, this.session!.date)

    try {
      const selection = await this.candidateSelectionService.selectForGap(
        gap,
        generationContext?.channel.channelName ?? this.session!.channelId,
        this.session!.date,
        candidates,
        thought,
      )

      return {
        action: 'fill_item',
        data: {
          gapId: gap.id,
          selectedCandidateId: selection.selectedCandidate.id,
          selectionReason: selection.reasoning,
          suggestedNextAction: 'continue',
        },
      }
    } catch {
      return defaultCommand
    }
  }

  private collectPlanningBatch(remainingBudget: number): GapInfo[] {
    const batchSize = Math.max(1, Math.min(this.config.planningConcurrency, remainingBudget))
    const batch: GapInfo[] = []

    while (batch.length < batchSize) {
      const gap = this.gapManager?.getNextGap()
      if (!gap) break
      this.gapManager?.startProcessing(gap.id)
      batch.push(gap)
      this.emit('gap-start', { gap })
    }

    return batch
  }

  private async prepareBatchPlans(gaps: GapInfo[]): Promise<PreparedGapPlan[]> {
    const results = await Promise.all(
      gaps.map(async (gap) => {
        try {
          const plan = await this.prepareGapPlan(gap)
          return { ok: true as const, plan }
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error'
          this.gapManager?.markFailed(gap.id, message)
          this.session!.gaps.failed.push(gap.id)
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

  private async prepareGapPlan(gap: GapInfo): Promise<PreparedGapPlan> {
    const { command: queryCommand, thought } = await this.generateQueryCandidatesCommand(gap)
    this.log('info', 'query', `空窗 ${gap.id} 已生成接口查询参数`, {
      gapId: gap.id,
      startTime: gap.startTime,
      endTime: gap.endTime,
      criteria: queryCommand.data.criteria,
      reasoning: queryCommand.reasoning,
    })

    const candidatesResult = await this.candidateService.queryCandidates(gap, queryCommand.data.criteria)
    if (candidatesResult.candidates.length === 0) {
      throw new Error('No candidates found')
    }

    this.log('info', 'query', `空窗 ${gap.id} 已完成接口查询`, {
      gapId: gap.id,
      startTime: gap.startTime,
      endTime: gap.endTime,
      candidateCount: candidatesResult.candidates.length,
      topCandidates: candidatesResult.candidates.slice(0, 3).map((item) => ({
        id: item.id,
        programName: item.programName,
        duration: item.duration,
        programType: item.programType,
      })),
    })

    const fillCommand = await this.generateFillItemCommand(gap, candidatesResult.candidates, thought)
    const selectedCandidate =
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
      selectionReason: fillCommand.data.selectionReason,
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

  private async executePreparedPlan(plan: PreparedGapPlan): Promise<ScheduleItemSnapshot> {
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
    })

    return materialized.item
  }

  private async fillRemainingGapsWithAds(generationContext?: Awaited<ReturnType<ReturnType<typeof getDataService>['getGenerationContext']>> | null): Promise<number> {
    const layoutReference = generationContext?.layoutReference
    if (!layoutReference) return 0

    let insertedCount = 0
    let currentItems = this.atomicCapabilities.getAllItems()

    for (const slot of layoutReference.slots) {
      if (this.isCancelled) break

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

          break
        }
      }
    }

    return insertedCount
  }

  private buildPlanningPrompt(gapCount: number): ChatMessage[] {
    return [
      {
        role: 'system',
        content: '你是电视节目单编排助手。请只输出 JSON PlanCommand，用于描述全局编排策略，而不是直接输出节目单。',
      },
      {
        role: 'user',
        content: `频道: ${this.session!.channelId}\n日期: ${this.session!.date}\n待处理空窗数: ${gapCount}`,
      },
    ]
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




