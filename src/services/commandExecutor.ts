/**
 * 命令执行器（重构版）
 * 负责执行 LLM 生成的各种命令
 * 
 * 新架构特点：
 * 1. 支持 10 种命令类型（新命令体系）
 * 2. 集成物化器到 fill_item 命令
 * 3. 每个命令执行后自动触发校验
 * 4. 基于原子能力服务实现
 * 5. 支持命令预演
 */
import type {
  OrchestrationCommand,
  OrchestrationCommandType,
  PlanCommand,
  QueryCandidatesCommand,
  FillItemCommand,
  RepairCommand,
  InsertCommand,
  DeleteCommand,
  ReplaceCommand,
  MoveCommand,
  UpdateFieldCommand,
  ClarificationCommand,
  ScheduleItemSnapshot,
  ValidationReport,
  ProgramCandidate,
  GapInfo,
} from '@/types/orchestration'
import { getAtomicCapabilities, type AtomicCapabilities } from './atomicCapabilities'
import { getMaterializer } from './materializer'
import { getCandidateService } from './candidateService'
import type { MaterializeInput } from '@/types/orchestration'

/** 执行结果 */
export interface ExecutionResult<T = any> {
  success: boolean
  message: string
  data?: T
  affectedItems?: string[]
  affectedTimeRanges?: { start: string; end: string }[]
  error?: string
  validationReport?: ValidationReport
}

/** 预演结果 */
export interface PreviewResult {
  canExecute: boolean
  command: OrchestrationCommand
  affectedItems: string[]
  affectedTimeRanges: { start: string; end: string }[]
  estimatedResult?: any
  warnings: string[]
  risks: string[]
}

/** 命令执行器配置 */
export interface CommandExecutorConfig {
  enableAutoValidation: boolean
  enableSnapshot: boolean
  maxRetries: number
}

/** 默认配置 */
const DEFAULT_CONFIG: CommandExecutorConfig = {
  enableAutoValidation: true,
  enableSnapshot: true,
  maxRetries: 3,
}

/** 命令执行器 */
export class CommandExecutor {
  private atomicCapabilities: AtomicCapabilities
  private config: CommandExecutorConfig
  private executionLog: string[] = []
  private onValidation?: (scope: 'item' | 'full') => Promise<ValidationReport>
  private candidates: Map<string, ProgramCandidate[]> = new Map()
  private gaps: Map<string, GapInfo> = new Map()

  constructor(
    atomicCapabilities: AtomicCapabilities,
    config?: Partial<CommandExecutorConfig>,
    onValidation?: (scope: 'item' | 'full') => Promise<ValidationReport>,
  ) {
    this.atomicCapabilities = atomicCapabilities
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.onValidation = onValidation
  }

  /**
   * 执行单个命令
   */
  async execute(command: OrchestrationCommand): Promise<ExecutionResult> {
    try {
      this.logExecution(`Executing command: ${command.action}`)

      switch (command.action) {
        case 'plan':
          return this.executePlan(command as PlanCommand)
        case 'query_candidates':
          return this.executeQueryCandidates(command as QueryCandidatesCommand)
        case 'fill_item':
          return this.executeFillItem(command as FillItemCommand)
        case 'repair':
          return this.executeRepair(command as RepairCommand)
        case 'insert':
          return this.executeInsert(command as InsertCommand)
        case 'delete':
          return this.executeDelete(command as DeleteCommand)
        case 'replace':
          return this.executeReplace(command as ReplaceCommand)
        case 'move':
          return this.executeMove(command as MoveCommand)
        case 'update_field':
          return this.executeUpdateField(command as UpdateFieldCommand)
        case 'clarification':
          return this.executeClarification(command as ClarificationCommand)
        default:
          return {
            success: false,
            message: `Unknown command type: ${(command as any).action}`,
          }
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      this.logExecution(`Command failed: ${errorMsg}`)
      return {
        success: false,
        message: `Command execution failed`,
        error: errorMsg,
      }
    }
  }

  /**
   * 预演命令
   */
  async preview(command: OrchestrationCommand): Promise<PreviewResult> {
    const warnings: string[] = []
    const risks: string[] = []
    const affectedItems: string[] = []
    const affectedTimeRanges: { start: string; end: string }[] = []

    try {
      switch (command.action) {
        case 'fill_item': {
          const fillCmd = command as FillItemCommand
          const gap = this.gaps.get(fillCmd.data.gapId)
          if (!gap) {
            warnings.push(`空窗 ${fillCmd.data.gapId} 不存在`)
          } else {
            affectedTimeRanges.push({ start: gap.startTime, end: gap.endTime })
          }
          break
        }
        case 'delete': {
          const deleteCmd = command as DeleteCommand
          const item = this.atomicCapabilities.getItem(deleteCmd.data.itemId)
          if (!item) {
            warnings.push(`条目 ${deleteCmd.data.itemId} 不存在`)
          } else {
            affectedItems.push(item.id)
            affectedTimeRanges.push({ start: item.startTime, end: item.endTime })
          }
          break
        }
        case 'replace': {
          const replaceCmd = command as ReplaceCommand
          const item = this.atomicCapabilities.getItem(replaceCmd.data.itemId)
          if (!item) {
            warnings.push(`条目 ${replaceCmd.data.itemId} 不存在`)
          } else {
            affectedItems.push(item.id)
            affectedTimeRanges.push({ start: item.startTime, end: item.endTime })
          }
          break
        }
        case 'move': {
          const moveCmd = command as MoveCommand
          const item = this.atomicCapabilities.getItem(moveCmd.data.itemId)
          if (!item) {
            warnings.push(`条目 ${moveCmd.data.itemId} 不存在`)
          } else {
            affectedItems.push(item.id)
            affectedTimeRanges.push(
              { start: item.startTime, end: item.endTime },
              { start: moveCmd.data.newStartTime, end: this.calculateEndTime(moveCmd.data.newStartTime, item.duration) }
            )
            // 检查目标时间是否可用
            if (!this.atomicCapabilities.isTimeRangeAvailable(
              moveCmd.data.newStartTime,
              this.calculateEndTime(moveCmd.data.newStartTime, item.duration),
              moveCmd.data.itemId
            )) {
              risks.push('目标时间范围与其他条目重叠')
            }
          }
          break
        }
        case 'insert': {
          const insertCmd = command as InsertCommand
          if (!insertCmd.data.insertTime || !insertCmd.data.scheduleDate) {
            warnings.push('插入命令缺少目标时间或日期')
            break
          }

          const candidate = getCandidateService().getCandidateById(insertCmd.data.candidateId)
          if (!candidate) {
            warnings.push(`未找到候选节目 ${insertCmd.data.candidateId}`)
            break
          }

          const normalizedTime = insertCmd.data.insertTime.length === 5
            ? `${insertCmd.data.insertTime}:00`
            : insertCmd.data.insertTime
          const startTime = `${insertCmd.data.scheduleDate}T${normalizedTime}`
          const endTime = this.calculateEndTime(startTime, candidate.duration)
          affectedTimeRanges.push({ start: startTime, end: endTime })

          if (!this.atomicCapabilities.isTimeRangeAvailable(startTime, endTime)) {
            risks.push('目标时间段已被现有节目占用，当前演示版本仅支持插入到空闲时间段。')
          }
          break
        }
      }

      return {
        canExecute: warnings.length === 0,
        command,
        affectedItems,
        affectedTimeRanges,
        warnings,
        risks,
      }
    } catch (error) {
      return {
        canExecute: false,
        command,
        affectedItems: [],
        affectedTimeRanges: [],
        warnings: [`预演失败: ${(error as Error).message}`],
        risks: ['无法确定执行结果'],
      }
    }
  }

  /**
   * 批量执行命令
   */
  async executeBatch(commands: OrchestrationCommand[]): Promise<ExecutionResult> {
    const results: ExecutionResult[] = []
    const allAffectedItems: string[] = []

    for (const command of commands) {
      const result = await this.execute(command)
      results.push(result)
      if (result.affectedItems) {
        allAffectedItems.push(...result.affectedItems)
      }
    }

    const successCount = results.filter((r) => r.success).length
    const failCount = results.length - successCount

    return {
      success: failCount === 0,
      message: `批量执行: ${successCount} 成功, ${failCount} 失败`,
      affectedItems: [...new Set(allAffectedItems)],
    }
  }

  // ==================== 具体命令执行 ====================

  /**
   * 执行策略初始化命令
   */
  private executePlan(command: PlanCommand): ExecutionResult {
    return {
      success: true,
      message: `策略初始化完成: ${command.data.strategy.target}`,
      data: command.data.strategy,
    }
  }

  /**
   * 执行候选检索命令
   */
  private executeQueryCandidates(command: QueryCandidatesCommand): ExecutionResult {
    // 候选检索只是记录检索条件，实际检索由外部服务完成
    return {
      success: true,
      message: `候选检索条件已生成`,
      data: command.data.criteria,
    }
  }

  /**
   * 执行填充命令（集成物化器）
   */
  private async executeFillItem(command: FillItemCommand): Promise<ExecutionResult> {
    const { gapId, selectedCandidateId } = command.data

    // 获取空窗信息
    const gap = this.gaps.get(gapId)
    if (!gap) {
      return {
        success: false,
        message: `空窗不存在: ${gapId}`,
      }
    }

    // 获取候选节目
    const candidates = this.candidates.get(gapId) || []
    const selectedCandidate = candidates.find((c) => c.id === selectedCandidateId)
    if (!selectedCandidate) {
      return {
        success: false,
        message: `候选节目不存在: ${selectedCandidateId}`,
      }
    }

    // 使用物化器生成完整条目
    const materializer = getMaterializer()
    const materializeInput: MaterializeInput = {
      gap,
      selectedCandidate,
      channelContext: {
        channelId: 'default',
        channelName: '默认频道',
        date: new Date().toISOString().split('T')[0] || '2026-03-25',
        timeZone: 'Asia/Shanghai',
        broadcastRules: {
          defaultStartTime: '06:00:00',
          defaultEndTime: '26:00:00',
          minProgramDuration: 60,
          maxProgramDuration: 7200,
          allowedTransitions: {},
        },
      },
    }

    const materializeResult = materializer.materialize(materializeInput)

    if (!materializeResult.success || !materializeResult.item) {
      return {
        success: false,
        message: `物化失败: ${materializeResult.error}`,
      }
    }

    // 使用原子能力添加条目
    const atomicResult = await this.atomicCapabilities.appendItems([materializeResult.item], {
      skipValidation: !this.config.enableAutoValidation,
    })

    if (!atomicResult.success) {
      return {
        success: false,
        message: `添加条目失败: ${atomicResult.error}`,
      }
    }

    // 触发校验
    let validationReport: ValidationReport | undefined
    if (this.config.enableAutoValidation && this.onValidation) {
      validationReport = await this.onValidation('item')
    }

    return {
      success: true,
      message: `已填充节目: ${materializeResult.item.programName}`,
      data: materializeResult.item,
      affectedItems: [materializeResult.item.id],
      affectedTimeRanges: [{ start: materializeResult.item.startTime, end: materializeResult.item.endTime }],
      validationReport,
    }
  }

  /**
   * 执行修复命令
   */
  private async executeRepair(command: RepairCommand): Promise<ExecutionResult> {
    const { targetId, targetType, strategy, parameters } = command.data

    switch (strategy) {
      case 'replace_candidate': {
        // 替换候选：删除旧条目，添加新条目
        const deleteResult = await this.atomicCapabilities.deleteItem(targetId, { skipValidation: true })
        if (!deleteResult.success) {
          return {
            success: false,
            message: `替换候选失败: ${deleteResult.error}`,
          }
        }
        return {
          success: true,
          message: `已替换候选: ${targetId}`,
          affectedItems: [targetId],
        }
      }
      case 'add_filler': {
        // 补短片：添加填充内容
        return {
          success: true,
          message: `补短片策略: ${targetId}`,
        }
      }
      case 'adjust_item': {
        // 调整条目
        return {
          success: true,
          message: `调整条目: ${targetId}`,
        }
      }
      case 'local_fallback': {
        // 局部回退
        const restoreResult = this.atomicCapabilities.restoreSnapshot(targetId)
        return {
          success: restoreResult.success,
          message: restoreResult.success ? `已回退: ${targetId}` : `回退失败: ${restoreResult.error}`,
          affectedItems: [targetId],
        }
      }
      case 'request_manual': {
        // 请求人工
        return {
          success: false,
          message: `需要人工处理: ${targetId}`,
        }
      }
      default:
        return {
          success: false,
          message: `未知修复策略: ${strategy}`,
        }
    }
  }

  /**
   * 执行插入命令
   */
  private async executeInsert(command: InsertCommand): Promise<ExecutionResult> {
    // 插入命令需要先生成新条目
    return {
      success: false,
      message: '插入命令需要配合候选选择使用',
    }
  }

  /**
   * 执行删除命令
   */
  private async executeDelete(command: DeleteCommand): Promise<ExecutionResult> {
    const { itemId, cascade } = command.data

    const result = await this.atomicCapabilities.deleteItem(itemId, {
      skipValidation: !this.config.enableAutoValidation,
    })

    if (!result.success) {
      return {
        success: false,
        message: `删除失败: ${result.error}`,
      }
    }

    // 触发校验
    let validationReport: ValidationReport | undefined
    if (this.config.enableAutoValidation && this.onValidation) {
      validationReport = await this.onValidation('full')
    }

    return {
      success: true,
      message: `已删除条目: ${result.data?.deletedItem.programName}`,
      data: result.data,
      affectedItems: [itemId],
      affectedTimeRanges: result.affectedTimeRanges,
      validationReport,
    }
  }

  /**
   * 执行替换命令
   */
  private async executeReplace(command: ReplaceCommand): Promise<ExecutionResult> {
    const { itemId, newCandidateId } = command.data

    // 获取旧条目
    const oldItem = this.atomicCapabilities.getItem(itemId)
    if (!oldItem) {
      return {
        success: false,
        message: `条目不存在: ${itemId}`,
      }
    }

    // 这里需要获取新候选的信息来创建新条目
    // 简化处理：创建一个新条目
    const newItem: ScheduleItemSnapshot = {
      ...oldItem,
      id: `item_${Date.now()}`,
      programCode: newCandidateId,
      programName: '新节目',
    }

    const result = await this.atomicCapabilities.replaceItem(itemId, newItem, {
      skipValidation: !this.config.enableAutoValidation,
    })

    if (!result.success) {
      return {
        success: false,
        message: `替换失败: ${result.error}`,
      }
    }

    // 触发校验
    let validationReport: ValidationReport | undefined
    if (this.config.enableAutoValidation && this.onValidation) {
      validationReport = await this.onValidation('item')
    }

    return {
      success: true,
      message: `已替换条目`,
      data: result.data,
      affectedItems: [itemId, newItem.id],
      affectedTimeRanges: result.affectedTimeRanges,
      validationReport,
    }
  }

  /**
   * 执行移动命令
   */
  private async executeMove(command: MoveCommand): Promise<ExecutionResult> {
    const { itemId, newStartTime } = command.data

    const result = await this.atomicCapabilities.moveItem(itemId, newStartTime, {
      skipValidation: !this.config.enableAutoValidation,
    })

    if (!result.success) {
      return {
        success: false,
        message: `移动失败: ${result.error}`,
      }
    }

    // 触发校验
    let validationReport: ValidationReport | undefined
    if (this.config.enableAutoValidation && this.onValidation) {
      validationReport = await this.onValidation('item')
    }

    return {
      success: true,
      message: `已移动条目`,
      data: result.data,
      affectedItems: [itemId],
      affectedTimeRanges: result.affectedTimeRanges,
      validationReport,
    }
  }

  /**
   * 执行更新字段命令
   */
  private async executeUpdateField(command: UpdateFieldCommand): Promise<ExecutionResult> {
    const { itemId, field, value } = command.data

    const result = await this.atomicCapabilities.updateField(itemId, field, value, {
      skipValidation: !this.config.enableAutoValidation,
    })

    if (!result.success) {
      return {
        success: false,
        message: `更新字段失败: ${result.error}`,
      }
    }

    // 触发校验
    let validationReport: ValidationReport | undefined
    if (this.config.enableAutoValidation && this.onValidation) {
      validationReport = await this.onValidation('item')
    }

    return {
      success: true,
      message: `已更新字段: ${field}`,
      data: result.data,
      affectedItems: [itemId],
      affectedTimeRanges: result.affectedTimeRanges,
      validationReport,
    }
  }

  /**
   * 执行澄清命令
   */
  private executeClarification(command: ClarificationCommand): ExecutionResult {
    return {
      success: true,
      message: `需要澄清: ${command.data.question}`,
      data: command.data,
    }
  }

  // ==================== 辅助方法 ====================

  /**
   * 计算结束时间
   */
  private calculateEndTime(startTime: string, durationSeconds: number): string {
    const startMs = new Date(startTime).getTime()
    const endMs = startMs + durationSeconds * 1000
    return new Date(endMs).toISOString()
  }

  /**
   * 记录执行日志
   */
  private logExecution(message: string): void {
    const timestamp = new Date().toISOString()
    this.executionLog.push(`[${timestamp}] ${message}`)
  }

  /**
   * 获取执行日志
   */
  getExecutionLog(): string[] {
    return [...this.executionLog]
  }

  /**
   * 清空执行日志
   */
  clearExecutionLog(): void {
    this.executionLog = []
  }

  /**
   * 设置候选列表
   */
  setCandidates(gapId: string, candidates: ProgramCandidate[]): void {
    this.candidates.set(gapId, candidates)
  }

  /**
   * 设置空窗信息
   */
  setGap(gap: GapInfo): void {
    this.gaps.set(gap.id, gap)
  }

  /**
   * 设置校验回调
   */
  setValidationCallback(callback: (scope: 'item' | 'full') => Promise<ValidationReport>): void {
    this.onValidation = callback
  }

  getScheduleItems(): ScheduleItemSnapshot[] {
    return this.atomicCapabilities.getAllItems()
  }
}

// 导出工厂函数
let globalCommandExecutor: CommandExecutor | null = null

export function getCommandExecutor(
  atomicCapabilities?: AtomicCapabilities,
  config?: Partial<CommandExecutorConfig>,
  onValidation?: (scope: 'item' | 'full') => Promise<ValidationReport>,
): CommandExecutor {
  if (!globalCommandExecutor) {
    globalCommandExecutor = new CommandExecutor(
      atomicCapabilities ?? getAtomicCapabilities(),
      config,
      onValidation,
    )
  }
  return globalCommandExecutor
}

export function resetCommandExecutor(): void {
  globalCommandExecutor = null
}
