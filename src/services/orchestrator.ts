/**
 * 编排调度器（重构版）
 * 采用空窗驱动、系统控制、LLM局部决策架构
 * 
 * 核心流程：
 * 1. 任务判别 -> 2. 策略初始化 -> 3. 空窗循环处理 -> 4. 校验修复 -> 5. 完成
 */

import type {
  PlanningSession,
  PlanningSessionStatus,
  PlanningStrategy,
  GapInfo,
  GapProcessingState,
  ProgramCandidate,
  OrchestrationCommand,
  QueryCandidatesCommand,
  FillItemCommand,
  RepairCommand,
  PlanCommand,
  CandidateQueryCriteria,
  ValidationReport,
  ScheduleItemSnapshot,
  PlanningLogEntry,
  ExecutionStats,
  OrchestrationProgress,
  TaskClassification,
  TaskMode,
} from '@/types/orchestration'
import type { ChatMessage } from '@/types/llm'
import { LLMClient } from './llm/llmClient'
import { TaskClassifier, type TaskClassifierInput } from './llm/taskClassifier'
import { GapManager } from './gapManager'
// 浏览器兼容的事件发射器
class EventEmitter {
  private listeners: Map<string, Function[]> = new Map()

  on(event: string, listener: Function) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, [])
    }
    this.listeners.get(event)!.push(listener)
    return this
  }

  emit(event: string, ...args: any[]) {
    const listeners = this.listeners.get(event)
    if (listeners) {
      listeners.forEach(listener => listener(...args))
    }
    return true
  }

  off(event: string, listener: Function) {
    const listeners = this.listeners.get(event)
    if (listeners) {
      const index = listeners.indexOf(listener)
      if (index > -1) {
        listeners.splice(index, 1)
      }
    }
    return this
  }
}

/** 编排器配置 */
export interface OrchestratorConfig {
  maxRepairRounds: number
  enableAutoRepair: boolean
  enableFallback: boolean
  maxItemRetries: number
  maxGapRetries: number
}

/** 默认配置 */
const DEFAULT_CONFIG: OrchestratorConfig = {
  maxRepairRounds: 3,
  enableAutoRepair: true,
  enableFallback: true,
  maxItemRetries: 3,
  maxGapRetries: 2,
}

/** 编排事件 */
export interface OrchestratorEvents {
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

/** 编排调度器 */
export class Orchestrator extends EventEmitter {
  private llmClient: LLMClient
  private taskClassifier: TaskClassifier
  private gapManager: GapManager | null = null
  private config: OrchestratorConfig
  
  private session: PlanningSession | null = null
  private isRunning = false
  private isCancelled = false
  private currentGap: GapInfo | null = null
  private repairRound = 0

  constructor(
    llmClient: LLMClient,
    taskClassifier: TaskClassifier,
    config?: Partial<OrchestratorConfig>,
  ) {
    super()
    this.llmClient = llmClient
    this.taskClassifier = taskClassifier
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  // ==================== 会话管理 ====================

  /**
   * 创建新会话
   */
  createSession(
    channelId: string,
    date: string,
    strategy?: Partial<PlanningStrategy>,
  ): PlanningSession {
    const now = new Date().toISOString()
    
    this.session = {
      id: this.generateSessionId(),
      channelId,
      date,
      status: 'initializing',
      strategy: {
        target: strategy?.target || 'standard',
        referencePriority: strategy?.referencePriority || ['layout', 'history', 'library'],
        allowFiller: strategy?.allowFiller ?? true,
        sequentialPreference: strategy?.sequentialPreference ?? true,
        riskPreference: strategy?.riskPreference || 'balanced',
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

    // 初始化空窗管理器
    this.gapManager = new GapManager(channelId, date)
    
    this.log('info', 'session', '编排会话已创建', { sessionId: this.session.id })
    
    return this.session
  }

  /**
   * 获取当前会话
   */
  getSession(): PlanningSession | null {
    return this.session
  }

  /**
   * 获取运行状态
   */
  getIsRunning(): boolean {
    return this.isRunning
  }

  // ==================== 主流程控制 ====================

  /**
   * 启动编排（完整生成）
   */
  async startFullGeneration(
    channelId: string,
    date: string,
    dayStartTime: string,
    dayEndTime: string,
    strategy?: Partial<PlanningStrategy>,
  ): Promise<void> {
    if (this.isRunning) {
      throw new Error('Orchestrator is already running')
    }

    this.isRunning = true
    this.isCancelled = false
    this.repairRound = 0

    try {
      // 1. 创建会话
      this.createSession(channelId, date, strategy)
      this.updateStatus('planning')

      // 2. 初始化全天空窗
      this.gapManager!.createFullDayGap(dayStartTime, dayEndTime)
      this.session!.gaps.pending = this.gapManager!.queryRemainingGaps()

      this.log('info', 'planning', '开始完整编排生成', {
        dayStartTime,
        dayEndTime,
        initialGapCount: this.session!.gaps.pending.length,
      })

      // 3. 策略初始化
      await this.phase1Planning()

      // 4. 空窗循环填充
      await this.phase2Filling()

      // 5. 校验和修补
      await this.phase3Repair()

      // 6. 完成
      if (!this.isCancelled) {
        this.updateStatus('completed')
        this.log('info', 'complete', '编排完成', {
          totalCommands: this.session!.execution.totalCommands,
          successfulCommands: this.session!.execution.successfulCommands,
        })
        this.emit('complete', { session: this.session! })
      }
    } catch (error) {
      this.handleError(error as Error)
    } finally {
      this.isRunning = false
    }
  }

  /**
   * 启动局部补排
   */
  async startPartialGeneration(
    channelId: string,
    date: string,
    targetGapIds?: string[],
  ): Promise<void> {
    if (this.isRunning) {
      throw new Error('Orchestrator is already running')
    }

    this.isRunning = true
    this.isCancelled = false

    try {
      this.createSession(channelId, date, { target: 'partial_fill' })
      this.updateStatus('filling')

      // 如果指定了目标空窗，只处理这些空窗
      if (targetGapIds && targetGapIds.length > 0) {
        // 从现有空窗中筛选
        const allGaps = this.gapManager!.queryRemainingGaps()
        const targetGaps = allGaps.filter((g) => targetGapIds.includes(g.id))
        this.session!.gaps.pending = targetGaps
      }

      this.log('info', 'filling', '开始局部补排', {
        targetGapCount: this.session!.gaps.pending.length,
      })

      // 执行空窗填充
      await this.phase2Filling()

      // 校验和修补
      await this.phase3Repair()

      if (!this.isCancelled) {
        this.updateStatus('completed')
        this.emit('complete', { session: this.session! })
      }
    } catch (error) {
      this.handleError(error as Error)
    } finally {
      this.isRunning = false
    }
  }

  /**
   * 执行单个命令（用于微调）
   */
  async executeCommand(command: OrchestrationCommand): Promise<boolean> {
    this.log('info', 'command', '执行命令', { command })
    this.emit('command-execute', { command })

    try {
      // 根据命令类型执行不同操作
      switch (command.action) {
        case 'insert':
          // TODO: 实现插入逻辑
          break
        case 'delete':
          // TODO: 实现删除逻辑
          break
        case 'replace':
          // TODO: 实现替换逻辑
          break
        case 'move':
          // TODO: 实现移动逻辑
          break
        case 'update_field':
          // TODO: 实现字段更新逻辑
          break
        default:
          throw new Error(`Unsupported command: ${command.action}`)
      }

      this.session!.execution.totalCommands++
      this.session!.execution.successfulCommands++
      return true
    } catch (error) {
      this.session!.execution.totalCommands++
      this.session!.execution.failedCommands++
      this.log('error', 'command', '命令执行失败', { command, error })
      return false
    }
  }

  /**
   * 取消编排
   */
  cancel(): void {
    if (!this.isRunning) return

    this.isCancelled = true
    this.log('warn', 'session', '编排已取消')
    this.updateStatus('cancelled')
  }

  // ==================== 阶段实现 ====================

  /**
   * 阶段1：策略初始化
   */
  private async phase1Planning(): Promise<void> {
    this.log('info', 'planning', '阶段1：策略初始化')

    const gapCount = this.gapManager!.queryRemainingGaps().length
    
    // 构建策略初始化Prompt
    const messages = this.buildPlanningPrompt(gapCount)

    try {
      const response = await this.llmClient.chat(messages, {
        temperature: 0.5,
        maxTokens: 1000,
      })

      // 解析策略响应
      const planCommand = this.parsePlanCommand(response.content)
      
      if (planCommand) {
        // 更新会话策略
        this.session!.strategy = {
          ...this.session!.strategy,
          ...planCommand.data.strategy,
        }
        
        this.log('info', 'planning', '策略初始化完成', {
          strategy: this.session!.strategy,
          reasoning: planCommand.reasoning,
        })
      }
    } catch (error) {
      this.log('warn', 'planning', '策略初始化失败，使用默认策略', { error })
      // 使用默认策略继续
    }
  }

  /**
   * 阶段2：空窗循环填充
   */
  private async phase2Filling(): Promise<void> {
    this.updateStatus('filling')
    this.log('info', 'filling', '阶段2：开始空窗循环填充')

    while (!this.isCancelled) {
      // 获取下一个空窗
      const gap = this.gapManager!.getNextGap()
      
      if (!gap) {
        this.log('info', 'filling', '所有空窗处理完成')
        break
      }

      this.currentGap = gap
      
      try {
        // 处理单个空窗
        await this.processSingleGap(gap)
      } catch (error) {
        this.log('error', 'filling', `空窗处理失败: ${gap.id}`, { error })
        this.gapManager!.markFailed(gap.id, (error as Error).message)
        this.session!.gaps.failed.push(gap.id)
        this.emit('gap-failed', { gap, error: (error as Error).message })
      }
    }

    this.currentGap = null
  }

  /**
   * 处理单个空窗
   */
  private async processSingleGap(gap: GapInfo): Promise<void> {
    this.log('info', 'filling', `开始处理空窗: ${gap.id}`, {
      startTime: gap.startTime,
      endTime: gap.endTime,
      duration: gap.duration,
    })

    this.emit('gap-start', { gap })
    this.gapManager!.startProcessing(gap.id)

    // 步骤1：生成候选检索条件
    const queryCommand = await this.generateQueryCandidatesCommand(gap)
    
    // 步骤2：检索候选（这里调用外部服务）
    const candidates = await this.queryCandidates(gap, queryCommand.data.criteria)
    
    if (candidates.length === 0) {
      throw new Error(`未找到适合空窗 ${gap.id} 的候选节目`)
    }

    this.log('info', 'filling', `找到 ${candidates.length} 个候选节目`)

    // 步骤3：选择候选
    const fillCommand = await this.generateFillItemCommand(gap, candidates)
    
    // 步骤4：物化和写入（这里调用外部服务）
    const item = await this.fillGap(gap, fillCommand, candidates)

    // 步骤5：更新空窗状态
    this.gapManager!.onGapFilled(gap.id, item)
    this.session!.gaps.completed.push(gap.id)
    
    this.session!.execution.totalCommands++
    this.session!.execution.successfulCommands++

    this.log('info', 'filling', `空窗处理完成: ${gap.id}`, {
      itemId: item.id,
      programName: item.programName,
    })

    this.emit('gap-complete', { gap, item })
  }

  /**
   * 阶段3：校验和修补
   */
  private async phase3Repair(): Promise<void> {
    if (!this.config.enableAutoRepair) {
      this.log('info', 'repair', '自动修补已禁用，跳过')
      return
    }

    this.updateStatus('repairing')
    this.log('info', 'repairing', '阶段3：开始校验和修补')

    for (let round = 1; round <= this.config.maxRepairRounds; round++) {
      if (this.isCancelled) break

      this.repairRound = round
      this.session!.execution.repairRounds = round

      this.log('info', 'repairing', `第 ${round} 轮校验`)

      // 执行校验
      const validationReport = await this.validateSchedule()
      this.emit('validation-complete', { report: validationReport })

      if (validationReport.isValid) {
        this.log('info', 'repairing', '校验通过，无需修补')
        break
      }

      this.log('warn', 'repairing', `发现 ${validationReport.issues.length} 个问题`, {
        critical: validationReport.summary.criticalCount,
        warning: validationReport.summary.warningCount,
      })

      this.emit('repair-start', { round, issues: validationReport })

      // 执行修补
      const repairSuccess = await this.executeRepair(validationReport)
      
      this.emit('repair-complete', { round, success: repairSuccess })

      if (!repairSuccess) {
        this.log('error', 'repairing', `第 ${round} 轮修补失败`)
        if (round === this.config.maxRepairRounds) {
          this.log('error', 'repairing', '达到最大修补轮次，需要人工介入')
          // TODO: 转人工处理
        }
      }
    }
  }

  // ==================== LLM 交互 ====================

  /**
   * 生成策略初始化Prompt
   */
  private buildPlanningPrompt(gapCount: number): ChatMessage[] {
    const systemPrompt = `你是一位电视节目编排策略专家。
你的职责是根据频道、日期和空窗情况，制定编排策略。

请输出 JSON 格式：
{
  "action": "plan",
  "data": {
    "strategy": {
      "target": "编排目标描述",
      "referencePriority": ["layout", "history", "library"],
      "allowFiller": true,
      "sequentialPreference": true,
      "riskPreference": "conservative" | "balanced" | "aggressive"
    },
    "initialGapCount": ${gapCount},
    "estimatedSteps": 预估步骤数
  },
  "reasoning": "策略说明"
}`

    const userPrompt = `【编排任务】
- 频道：${this.session!.channelId}
- 日期：${this.session!.date}
- 初始空窗数：${gapCount}

请制定编排策略。`

    return [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ]
  }

  /**
   * 解析策略命令
   */
  private parsePlanCommand(content: string): PlanCommand | null {
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/)
      if (!jsonMatch) return null

      const result = JSON.parse(jsonMatch[0])
      
      if (result.action === 'plan') {
        return result as PlanCommand
      }
      
      return null
    } catch {
      return null
    }
  }

  /**
   * 生成候选检索命令
   */
  private async generateQueryCandidatesCommand(gap: GapInfo): Promise<QueryCandidatesCommand> {
    const systemPrompt = `你是一位电视节目编排助手。
请为当前空窗生成候选检索条件。

输出 JSON 格式：
{
  "action": "query_candidates",
  "data": {
    "gapId": "空窗ID",
    "criteria": {
      "targetTimeRange": { "start": "开始时间", "end": "结束时间" },
      "expectedDuration": { "min": 最小时长, "max": 最大时长 },
      "programTypePreference": ["类型1", "类型2"],
      "sequentialPreference": true|false,
      "excludeUsed": true|false,
      "considerRatings": true|false,
      "allowShortFiller": true|false
    }
  },
  "reasoning": "检索策略说明"
}`

    const userPrompt = `【当前空窗】
- ID: ${gap.id}
- 时间段: ${gap.startTime} - ${gap.endTime}
- 时长: ${gap.duration}秒
- 约束: ${JSON.stringify(gap.constraints)}

请生成候选检索条件。`

    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ]

    const response = await this.llmClient.chat(messages, {
      temperature: 0.3,
      maxTokens: 800,
    })

    const result = this.parseQueryCandidatesCommand(response.content)
    if (result) {
      return result
    }

    // 默认检索条件
    return {
      action: 'query_candidates',
      data: {
        gapId: gap.id,
        criteria: {
          targetTimeRange: { start: gap.startTime, end: gap.endTime },
          expectedDuration: { 
            min: gap.constraints.minDuration || Math.floor(gap.duration * 0.8),
            max: gap.constraints.maxDuration || gap.duration,
          },
          programTypePreference: gap.constraints.allowedTypes,
          sequentialPreference: this.session!.strategy.sequentialPreference,
          excludeUsed: true,
          considerRatings: true,
          allowShortFiller: this.session!.strategy.allowFiller,
        },
      },
    }
  }

  /**
   * 解析候选检索命令
   */
  private parseQueryCandidatesCommand(content: string): QueryCandidatesCommand | null {
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/)
      if (!jsonMatch) return null

      const result = JSON.parse(jsonMatch[0])
      
      if (result.action === 'query_candidates') {
        return result as QueryCandidatesCommand
      }
      
      return null
    } catch {
      return null
    }
  }

  /**
   * 生成单条选择命令
   */
  private async generateFillItemCommand(
    gap: GapInfo,
    candidates: ProgramCandidate[],
  ): Promise<FillItemCommand> {
    const systemPrompt = `你是一位电视节目编排专家。
请从候选节目中选择最适合当前空窗的一项。

选择标准：
1. 时长匹配度（优先选择时长接近空窗时长的节目）
2. 类型适宜性（符合空窗约束的节目类型）
3. 收视率表现
4. 与前后节目的衔接

输出 JSON 格式：
{
  "action": "fill_item",
  "data": {
    "gapId": "空窗ID",
    "selectedCandidateId": "选中的候选ID",
    "selectionReason": "选择理由（简短）",
    "suggestedNextAction": "continue" | "fill_gap" | "repair"
  },
  "reasoning": "详细选择逻辑"
}`

    const candidatesStr = candidates.map((c, i) => 
      `${i + 1}. ${c.programName} (ID: ${c.id}, 时长: ${c.duration}秒, 类型: ${c.programType}, 评分: ${c.rating || 'N/A'})`
    ).join('\n')

    const userPrompt = `【当前空窗】
- ID: ${gap.id}
- 时间段: ${gap.startTime} - ${gap.endTime}
- 时长: ${gap.duration}秒
- 允许类型: ${gap.constraints.allowedTypes?.join(', ') || '不限'}

【候选节目】
${candidatesStr}

请选择最适合的节目，输出 JSON 格式。`

    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ]

    const response = await this.llmClient.chat(messages, {
      temperature: 0.4,
      maxTokens: 800,
    })

    const result = this.parseFillItemCommand(response.content)
    if (result) {
      return result
    }

    // 默认选择第一个候选
    return {
      action: 'fill_item',
      data: {
        gapId: gap.id,
        selectedCandidateId: candidates[0]?.id || '',
        selectionReason: '默认选择',
      },
    }
  }

  /**
   * 解析单条选择命令
   */
  private parseFillItemCommand(content: string): FillItemCommand | null {
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/)
      if (!jsonMatch) return null

      const result = JSON.parse(jsonMatch[0])
      
      if (result.action === 'fill_item') {
        return result as FillItemCommand
      }
      
      return null
    } catch {
      return null
    }
  }

  // ==================== 外部服务调用（占位） ====================

  /**
   * 检索候选节目（需要接入实际服务）
   */
  private async queryCandidates(
    gap: GapInfo,
    criteria: CandidateQueryCriteria,
  ): Promise<ProgramCandidate[]> {
    // TODO: 接入实际的候选检索服务
    // 这里返回模拟数据
    this.log('info', 'filling', '检索候选节目', { gapId: gap.id, criteria })
    
    // 模拟候选数据
    return [
      {
        id: `candidate_${Date.now()}_1`,
        programCode: 'NEWS001',
        programName: '新闻联播',
        duration: 1800,
        programType: 'news',
        rating: 8.5,
        source: 'library',
      },
      {
        id: `candidate_${Date.now()}_2`,
        programCode: 'TVS001',
        programName: '电视剧',
        duration: 2700,
        programType: 'drama',
        rating: 7.8,
        source: 'library',
      },
    ].filter((c) => c.duration <= gap.duration)
  }

  /**
   * 填充空窗（需要接入实际服务）
   */
  private async fillGap(
    gap: GapInfo,
    command: FillItemCommand,
    candidates: ProgramCandidate[],
  ): Promise<ScheduleItemSnapshot> {
    // TODO: 接入实际的物化器和写入服务
    this.log('info', 'filling', '填充空窗', { 
      gapId: gap.id, 
      candidateId: command.data.selectedCandidateId,
    })

    const selectedCandidate = candidates.find((c) => c.id === command.data.selectedCandidateId)
    
    if (!selectedCandidate) {
      throw new Error(`未找到候选: ${command.data.selectedCandidateId}`)
    }

    // 模拟物化结果
    const item: ScheduleItemSnapshot = {
      id: `item_${Date.now()}`,
      programCode: selectedCandidate.programCode,
      programName: selectedCandidate.programName,
      startTime: gap.startTime,
      endTime: new Date(new Date(gap.startTime).getTime() + selectedCandidate.duration * 1000).toISOString(),
      duration: selectedCandidate.duration,
      programType: selectedCandidate.programType,
      sequence: this.session!.gaps.completed.length + 1,
    }

    return item
  }

  /**
   * 校验编排（需要接入实际服务）
   */
  private async validateSchedule(): Promise<ValidationReport> {
    // TODO: 接入实际的校验服务
    this.log('info', 'repairing', '执行编排校验')

    // 模拟校验通过
    return {
      id: `validation_${Date.now()}`,
      scope: 'full',
      targetId: this.session!.id,
      timestamp: new Date().toISOString(),
      issues: [],
      summary: {
        totalIssues: 0,
        criticalCount: 0,
        warningCount: 0,
        infoCount: 0,
      },
      isValid: true,
    }
  }

  /**
   * 执行修复（需要接入实际服务）
   */
  private async executeRepair(report: ValidationReport): Promise<boolean> {
    // TODO: 接入实际的修复服务
    this.log('info', 'repairing', '执行修复', { issueCount: report.issues.length })
    return true
  }

  // ==================== 辅助方法 ====================

  /**
   * 更新会话状态
   */
  private updateStatus(newStatus: PlanningSessionStatus): void {
    if (!this.session) return

    const previousStatus = this.session.status
    this.session.status = newStatus
    this.session.updatedAt = new Date().toISOString()

    this.emit('status-change', { status: newStatus, previousStatus })
  }

  /**
   * 记录日志
   */
  private log(
    level: PlanningLogEntry['level'],
    phase: string,
    message: string,
    details?: Record<string, any>,
  ): void {
    if (!this.session) return

    const entry: PlanningLogEntry = {
      id: `log_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date().toISOString(),
      level,
      phase,
      message,
      details,
    }

    this.session.logs.push(entry)
    this.emit('log', { entry })
  }

  /**
   * 处理错误
   */
  private handleError(error: Error): void {
    this.log('error', 'session', error.message, { stack: error.stack })
    this.updateStatus('failed')
    this.emit('error', { error })
  }

  /**
   * 生成会话ID
   */
  private generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }

  /**
   * 获取当前进度
   */
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
      currentGap: this.currentGap || undefined,
      currentAction: this.currentGap ? `处理空窗 ${this.currentGap.id}` : undefined,
      stats: this.session.execution,
      repairStatus: this.repairRound > 0 ? {
        currentRound: this.repairRound,
        maxRounds: this.config.maxRepairRounds,
        issuesByRound: [],
        actionsTaken: [],
        isComplete: this.session.status !== 'repairing',
        requiresManualIntervention: false,
      } : undefined,
      recentLogs: this.session.logs.slice(-10),
      startedAt: this.session.createdAt,
    }
  }
}

// 导出工厂函数
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
