import type {
  CandidateQueryCriteria,
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
} from '@/types/orchestration'
import type { ChatMessage } from '@/types/llm'
import { getAtomicCapabilities } from './atomicCapabilities'
import { getCandidateService } from './candidateService'
import { createGapManager, GapManager } from './gapManager'
import { getMaterializer } from './materializer'
import { getDataService } from './orchestration/dataService'
import { getOrchestrationStrategyService, type GapPlanningThought } from './orchestrationStrategyService'
import { getQueryIntentService } from './queryIntentService'
import { getCandidateSelectionService } from './candidateSelectionService'
import { LLMClient } from './llm/llmClient'
import { TaskClassifier } from './llm/taskClassifier'
import { getValidationEngine } from './validators/validationEngine'

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
}

const DEFAULT_CONFIG: OrchestratorConfig = {
  maxRepairRounds: 1,
  enableAutoRepair: true,
  maxGapItems: 10,
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
      this.atomicCapabilities.clearAll()
      const generationContext = await this.dataService.getGenerationContext(channelId, date)
      const layoutSlots = generationContext?.layoutReference?.slots ?? []
      if (layoutSlots.length > 0) {
        this.gapManager!.initializeFromLayout(layoutSlots)
        this.log('info', 'planning', `频道 ${channelId} 已基于版面初始化待编排空窗`, {
          channelId,
          date,
          layoutSlotCount: layoutSlots.length,
        })
      } else {
        this.gapManager!.createFullDayGap(this.combineDateTime(date, dayStartTime), this.combineDateTime(date, dayEndTime))
        this.log('warn', 'planning', `频道 ${channelId} 未找到版面参考，已退回全天大空窗模式`, {
          channelId,
          date,
          dayStartTime,
          dayEndTime,
        })
      }
      this.session!.gaps.pending = this.gapManager!.queryRemainingGaps()

      await this.phase1Planning()
      await this.phase2Filling()
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
      const gaps = this.gapManager!.queryRemainingGaps()
      this.session!.gaps.pending = targetGapIds?.length ? gaps.filter((gap) => targetGapIds.includes(gap.id)) : gaps
      await this.phase2Filling()
      await this.phase3Repair()
      this.updateStatus('completed')
      this.emit('complete', { session: this.session! })
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
        this.log('info', 'planning', '已生成全局编排策略', {
          strategy: this.session!.strategy,
          initialGapCount: this.session!.gaps.pending.length,
        })
      }
    } catch {
      this.log('warn', 'planning', 'LLM planning unavailable, using default strategy')
    }
  }

  private async phase2Filling(): Promise<void> {
    this.updateStatus('filling')
    let processed = 0
    while (!this.isCancelled && this.gapManager && processed < this.config.maxGapItems) {
      const gap = this.gapManager.getNextGap()
      if (!gap) break
      this.currentGap = gap
      this.emit('gap-start', { gap })

      try {
        this.gapManager.startProcessing(gap.id)
        const queryCommand = await this.generateQueryCandidatesCommand(gap)
        this.log('info', 'filling', `空窗 ${gap.id} 已生成候选查询命令`, {
          gapId: gap.id,
          criteria: queryCommand.data.criteria,
          reasoning: queryCommand.reasoning,
        })
        const candidates = await this.candidateService.queryCandidates(gap, queryCommand.data.criteria)
        if (candidates.candidates.length === 0) throw new Error('No candidates found')
        this.log('info', 'filling', `空窗 ${gap.id} 已完成候选检索`, {
          gapId: gap.id,
          candidateCount: candidates.candidates.length,
          topCandidates: candidates.candidates.slice(0, 3).map((item) => ({
            id: item.id,
            programName: item.programName,
            duration: item.duration,
            programType: item.programType,
          })),
        })

        const fillCommand = await this.generateFillItemCommand(gap, candidates.candidates)
        const selectedCandidate =
          candidates.candidates.find((item) => item.id === fillCommand.data.selectedCandidateId) ??
          candidates.candidates[0]
        if (!selectedCandidate) throw new Error('No selected candidate')
        this.log('info', 'filling', `空窗 ${gap.id} 已完成候选选择`, {
          gapId: gap.id,
          selectedCandidateId: selectedCandidate.id,
          selectedCandidateName: selectedCandidate.programName,
          selectionReason: fillCommand.data.selectionReason,
        })
        const context = await this.dataService.getGenerationContext(this.session!.channelId, this.session!.date)
        if (!context) throw new Error('Missing generation context')

        const materialized = this.materializer.materialize({
          gap,
          selectedCandidate,
          channelContext: context.channel,
        })
        if (!materialized.success || !materialized.item) throw new Error(materialized.error || 'Materialize failed')

        const appendResult = await this.atomicCapabilities.appendItems([materialized.item], { skipValidation: true })
        if (!appendResult.success) throw new Error(appendResult.error || 'Append failed')
        this.log('info', 'filling', `空窗 ${gap.id} 已插入节目`, {
          gapId: gap.id,
          itemId: materialized.item.id,
          programName: materialized.item.programName,
          startTime: materialized.item.startTime,
          endTime: materialized.item.endTime,
        })

        this.gapManager.onGapFilled(gap.id, materialized.item)
        this.session!.gaps.completed.push(gap.id)
        this.session!.execution.totalCommands += 1
        this.session!.execution.successfulCommands += 1
        this.emit('gap-complete', { gap, item: materialized.item })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        this.gapManager.markFailed(gap.id, message)
        this.session!.gaps.failed.push(gap.id)
        this.session!.execution.totalCommands += 1
        this.session!.execution.failedCommands += 1
        this.log('error', 'filling', `空窗 ${gap.id} 处理失败`, {
          gapId: gap.id,
          error: message,
        })
        this.emit('gap-failed', { gap, error: message })
      }

      processed += 1
      this.session!.gaps.pending = this.gapManager.queryRemainingGaps()
    }

    this.currentGap = null
  }

  private async phase3Repair(): Promise<void> {
    if (!this.config.enableAutoRepair) return
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
      layoutSlots: context.layoutReference?.slots ?? [],
      dayStartTime: this.combineDateTime(this.session!.date, context.channel.broadcastRules.defaultStartTime),
      dayEndTime: this.combineDateTime(this.session!.date, context.channel.broadcastRules.defaultEndTime),
    })
  }

  private async generateQueryCandidatesCommand(gap: GapInfo): Promise<QueryCandidatesCommand> {
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
          programTypePreference: gap.constraints.allowedTypes,
          sequentialPreference: this.session!.strategy.sequentialPreference,
          excludeUsed: true,
          considerRatings: true,
          allowShortFiller: this.session!.strategy.allowFiller,
        },
      },
    }

    if (!generationContext) {
      return defaultCommand
    }

    const thought = await this.strategyService.planGap(gap, this.session!.strategy, generationContext)
    this.log('info', 'planning', `?? ${gap.id} ???????`, {
      gapId: gap.id,
      summary: thought.summary,
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

    this.log('info', 'planning', `?? ${gap.id} ???????`, {
      gapId: gap.id,
      criteria,
      reasoning: thought.summary,
    })

    const strategyDrivenCommand: QueryCandidatesCommand = {
      action: 'query_candidates',
      reasoning: thought.summary,
      data: {
        gapId: gap.id,
        criteria,
      },
    }
    return strategyDrivenCommand
  }

  private async generateFillItemCommand(gap: GapInfo, candidates: ProgramCandidate[]): Promise<FillItemCommand> {
    const defaultCandidate = candidates[0]
    if (!defaultCandidate) {
      throw new Error('No candidates available for fill command')
    }
    const defaultCommand: FillItemCommand = {
      action: 'fill_item',
      data: {
        gapId: gap.id,
        selectedCandidateId: defaultCandidate.id,
        selectionReason: '默认选择评分较高且时长最接近的候选',
        suggestedNextAction: 'continue',
      },
    }

    const generationContext = await this.dataService.getGenerationContext(this.session!.channelId, this.session!.date)
    const thought = generationContext
      ? await this.strategyService.planGap(gap, this.session!.strategy, generationContext)
      : undefined

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

  private buildPlanningPrompt(gapCount: number): ChatMessage[] {
    return [
      {
        role: 'system',
        content: '你是一个广播节目单编排助手。请输出 JSON PlanCommand，只给策略，不给完整节目单。',
      },
      {
        role: 'user',
        content: `频道: ${this.session!.channelId}\n日期: ${this.session!.date}\n空窗数: ${gapCount}`,
      },
    ]
  }

  private buildGapPrompt(
    gap: GapInfo,
    mode: 'query' | 'fill',
    candidates: ProgramCandidate[] = [],
    planningThought?: GapPlanningThought,
  ): ChatMessage[] {
    if (mode === 'query') {
      const thoughtSummary = planningThought
        ? [
            `编排想法: ${planningThought.summary}`,
            `类型偏好: ${(planningThought.targetProgramTypes ?? []).join(', ') || '无'}`,
            `搜索关键词: ${(planningThought.searchKeywords ?? []).join(', ') || '无'}`,
            `时长范围: ${planningThought.durationPreference.min}-${planningThought.durationPreference.max} 秒`,
            `允许 filler: ${planningThought.allowFiller ? '是' : '否'}`,
          ].join('\n')
        : '编排想法: 无'

      return [
        {
          role: 'system',
          content:
            '输出 QueryCandidatesCommand JSON。先理解空窗的编排想法，再生成候选检索条件。请尽量在 criteria 中包含 expectedDuration、programTypePreference、searchKeywords、preferredChannelId。',
        },
        {
          role: 'user',
          content: `空窗 ${gap.id}: ${gap.startTime} - ${gap.endTime}, 时长 ${gap.duration} 秒\n${thoughtSummary}`,
        },
      ]
    }

    return [
      {
        role: 'system',
        content: '输出 FillItemCommand JSON，只选择一个最适合当前空窗的候选节目。',
      },
      {
        role: 'user',
        content: `空窗 ${gap.id}: ${gap.startTime} - ${gap.endTime}\n候选:\n${candidates
          .map((item) => `${item.id} | ${item.programName} | ${item.duration}s | ${item.programType} | ${item.rating ?? 0}`)
          .join('\n')}`,
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
      id: `log_${Date.now()}`,
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
