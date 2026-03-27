import type {
  ClarificationCommand,
  DeleteCommand,
  FillItemCommand,
  GapInfo,
  InsertCommand,
  MoveCommand,
  OrchestrationCommand,
  PlanCommand,
  ProgramCandidate,
  QueryCandidatesCommand,
  RepairCommand,
  ReplaceCommand,
  ScheduleItemSnapshot,
  UpdateFieldCommand,
  ValidationReport,
} from '@/types/orchestration'
import type { MaterializeInput } from '@/types/orchestration'
import { getAtomicCapabilities, type AtomicCapabilities } from './atomicCapabilities'
import { getCandidateService } from './candidateService'
import { getMaterializer } from './materializer'

export interface ExecutionResult<T = any> {
  success: boolean
  message: string
  data?: T
  affectedItems?: string[]
  affectedTimeRanges?: { start: string; end: string }[]
  error?: string
  validationReport?: ValidationReport
}

export interface PreviewResult {
  canExecute: boolean
  command: OrchestrationCommand
  affectedItems: string[]
  affectedTimeRanges: { start: string; end: string }[]
  estimatedResult?: any
  warnings: string[]
  risks: string[]
}

export interface CommandExecutorConfig {
  enableAutoValidation: boolean
  enableSnapshot: boolean
  maxRetries: number
}

const DEFAULT_CONFIG: CommandExecutorConfig = {
  enableAutoValidation: true,
  enableSnapshot: true,
  maxRetries: 3,
}

export class CommandExecutor {
  private atomicCapabilities: AtomicCapabilities
  private config: CommandExecutorConfig
  private executionLog: string[] = []
  private onValidation?: (scope: 'item' | 'full') => Promise<ValidationReport>
  private candidates = new Map<string, ProgramCandidate[]>()
  private gaps = new Map<string, GapInfo>()

  constructor(
    atomicCapabilities: AtomicCapabilities,
    config?: Partial<CommandExecutorConfig>,
    onValidation?: (scope: 'item' | 'full') => Promise<ValidationReport>,
  ) {
    this.atomicCapabilities = atomicCapabilities
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.onValidation = onValidation
  }

  async execute(command: OrchestrationCommand): Promise<ExecutionResult> {
    try {
      this.logExecution(`Executing command: ${command.action}`)
      switch (command.action) {
        case 'plan':
          return this.executePlan(command)
        case 'query_candidates':
          return this.executeQueryCandidates(command)
        case 'fill_item':
          return this.executeFillItem(command)
        case 'repair':
          return this.executeRepair(command)
        case 'insert':
          return this.executeInsert(command)
        case 'delete':
          return this.executeDelete(command)
        case 'replace':
          return this.executeReplace(command)
        case 'move':
          return this.executeMove(command)
        case 'update_field':
          return this.executeUpdateField(command)
        case 'clarification':
          return this.executeClarification(command)
        default:
          return { success: false, message: `Unknown command type: ${(command as OrchestrationCommand).action}` }
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      this.logExecution(`Command failed: ${errorMsg}`)
      return {
        success: false,
        message: 'Command execution failed',
        error: errorMsg,
      }
    }
  }

  async preview(command: OrchestrationCommand): Promise<PreviewResult> {
    const warnings: string[] = []
    const risks: string[] = []
    const affectedItems: string[] = []
    const affectedTimeRanges: { start: string; end: string }[] = []

    switch (command.action) {
      case 'fill_item': {
        const gap = this.gaps.get(command.data.gapId)
        if (!gap) {
          warnings.push(`Gap not found: ${command.data.gapId}`)
        } else {
          affectedTimeRanges.push({ start: gap.startTime, end: gap.endTime })
        }
        break
      }
      case 'delete': {
        const item = this.atomicCapabilities.getItem(command.data.itemId)
        if (!item) {
          warnings.push(`Item not found: ${command.data.itemId}`)
        } else {
          affectedItems.push(item.id)
          affectedTimeRanges.push({ start: item.startTime, end: item.endTime })
        }
        break
      }
      case 'move': {
        const item = this.atomicCapabilities.getItem(command.data.itemId)
        if (!item) {
          warnings.push(`Item not found: ${command.data.itemId}`)
        } else {
          affectedItems.push(item.id)
          const endTime = this.calculateEndTime(command.data.newStartTime, item.duration)
          affectedTimeRanges.push({ start: item.startTime, end: item.endTime })
          affectedTimeRanges.push({ start: command.data.newStartTime, end: endTime })
          if (!this.atomicCapabilities.isTimeRangeAvailable(command.data.newStartTime, endTime, command.data.itemId)) {
            risks.push('目标时间段与其他条目重叠')
          }
        }
        break
      }
      case 'insert': {
        if (!command.data.insertTime || !command.data.scheduleDate) {
          warnings.push('插入命令缺少目标时间或日期')
          break
        }
        const candidate = getCandidateService().getCandidateById(command.data.candidateId)
        if (!candidate) {
          warnings.push(`未找到候选节目: ${command.data.candidateId}`)
          break
        }
        const normalizedTime = command.data.insertTime.length === 5
          ? `${command.data.insertTime}:00`
          : command.data.insertTime
        const startTime = `${command.data.scheduleDate}T${normalizedTime}`
        const endTime = this.calculateEndTime(startTime, candidate.duration)
        affectedTimeRanges.push({ start: startTime, end: endTime })
        if (!this.atomicCapabilities.isTimeRangeAvailable(startTime, endTime)) {
          risks.push('目标时间段已被占用')
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
  }

  async executeBatch(commands: OrchestrationCommand[]): Promise<ExecutionResult> {
    const results = await Promise.all(commands.map((command) => this.execute(command)))
    const successCount = results.filter((result) => result.success).length
    const failCount = results.length - successCount
    const affectedItems = [...new Set(results.flatMap((result) => result.affectedItems ?? []))]

    return {
      success: failCount === 0,
      message: `Batch executed: ${successCount} succeeded, ${failCount} failed`,
      data: results,
      affectedItems,
    }
  }

  private executePlan(command: PlanCommand): ExecutionResult {
    return {
      success: true,
      message: `Strategy initialized: ${command.data.strategy.target}`,
      data: command.data.strategy,
    }
  }

  private executeQueryCandidates(command: QueryCandidatesCommand): ExecutionResult {
    return {
      success: true,
      message: 'Candidate query criteria generated',
      data: command.data.criteria,
    }
  }

  private async executeFillItem(command: FillItemCommand): Promise<ExecutionResult> {
    const gap = this.gaps.get(command.data.gapId)
    if (!gap) {
      return { success: false, message: `Gap not found: ${command.data.gapId}` }
    }

    const candidates = this.candidates.get(command.data.gapId) ?? []
    const selectedCandidate = candidates.find((item) => item.id === command.data.selectedCandidateId)
    if (!selectedCandidate) {
      return { success: false, message: `Candidate not found: ${command.data.selectedCandidateId}` }
    }

    const materializer = getMaterializer()
    const materializeInput: MaterializeInput = {
      gap,
      selectedCandidate,
      channelContext: {
        channelId: 'default',
        channelName: '默认频道',
        date: '2026-03-25',
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
    if (!materializeResult.success || !materializeResult.item || !materializeResult.items?.length) {
      return {
        success: false,
        message: `物化失败: ${materializeResult.error}`,
      }
    }

    const atomicResult = await this.atomicCapabilities.appendItems(materializeResult.items, {
      skipValidation: !this.config.enableAutoValidation,
    })
    if (!atomicResult.success) {
      return {
        success: false,
        message: `添加条目失败: ${atomicResult.error}`,
      }
    }

    let validationReport: ValidationReport | undefined
    if (this.config.enableAutoValidation && this.onValidation) {
      validationReport = await this.onValidation('item')
    }

    return {
      success: true,
      message: `已填充节目: ${materializeResult.item.programName}`,
      data: materializeResult.items,
      affectedItems: materializeResult.items.map((entry) => entry.id),
      affectedTimeRanges: materializeResult.items.map((entry) => ({ start: entry.startTime, end: entry.endTime })),
      validationReport,
    }
  }

  private async executeRepair(command: RepairCommand): Promise<ExecutionResult> {
    const { targetId, strategy } = command.data

    switch (strategy) {
      case 'replace_candidate': {
        const deleteResult = await this.atomicCapabilities.deleteItem(targetId, { skipValidation: true })
        if (!deleteResult.success) {
          return { success: false, message: `Replace repair failed: ${deleteResult.error}` }
        }
        return { success: true, message: `Replaced candidate for ${targetId}`, affectedItems: [targetId] }
      }
      case 'local_fallback': {
        const restoreResult = this.atomicCapabilities.restoreSnapshot(targetId)
        return {
          success: restoreResult.success,
          message: restoreResult.success ? `Rolled back: ${targetId}` : `Rollback failed: ${restoreResult.error}`,
          affectedItems: [targetId],
        }
      }
      case 'add_filler':
      case 'adjust_item':
        return { success: true, message: `Repair strategy applied: ${strategy}` }
      case 'request_manual':
      default:
        return { success: false, message: `Manual action required: ${targetId}` }
    }
  }

  private async executeInsert(_command: InsertCommand): Promise<ExecutionResult> {
    return {
      success: false,
      message: 'Insert command should be handled by InsertCommandExecutor',
    }
  }

  private async executeDelete(command: DeleteCommand): Promise<ExecutionResult> {
    const result = await this.atomicCapabilities.deleteItem(command.data.itemId, {
      skipValidation: !this.config.enableAutoValidation,
    })
    if (!result.success) {
      return { success: false, message: `Delete failed: ${result.error}` }
    }

    let validationReport: ValidationReport | undefined
    if (this.config.enableAutoValidation && this.onValidation) {
      validationReport = await this.onValidation('full')
    }

    return {
      success: true,
      message: `Deleted item: ${result.data?.deletedItem.programName}`,
      data: result.data,
      affectedItems: [command.data.itemId],
      affectedTimeRanges: result.affectedTimeRanges,
      validationReport,
    }
  }

  private async executeReplace(command: ReplaceCommand): Promise<ExecutionResult> {
    const oldItem = this.atomicCapabilities.getItem(command.data.itemId)
    if (!oldItem) {
      return { success: false, message: `Item not found: ${command.data.itemId}` }
    }

    const newItem: ScheduleItemSnapshot = {
      ...oldItem,
      id: `item_${Date.now()}`,
      programCode: command.data.newCandidateId,
      programName: '新节目',
    }

    const result = await this.atomicCapabilities.replaceItem(command.data.itemId, newItem, {
      skipValidation: !this.config.enableAutoValidation,
    })
    if (!result.success) {
      return { success: false, message: `Replace failed: ${result.error}` }
    }

    let validationReport: ValidationReport | undefined
    if (this.config.enableAutoValidation && this.onValidation) {
      validationReport = await this.onValidation('item')
    }

    return {
      success: true,
      message: 'Item replaced',
      data: result.data,
      affectedItems: [command.data.itemId, newItem.id],
      affectedTimeRanges: result.affectedTimeRanges,
      validationReport,
    }
  }

  private async executeMove(command: MoveCommand): Promise<ExecutionResult> {
    const result = await this.atomicCapabilities.moveItem(command.data.itemId, command.data.newStartTime, {
      skipValidation: !this.config.enableAutoValidation,
    })
    if (!result.success) {
      return { success: false, message: `Move failed: ${result.error}` }
    }

    let validationReport: ValidationReport | undefined
    if (this.config.enableAutoValidation && this.onValidation) {
      validationReport = await this.onValidation('item')
    }

    return {
      success: true,
      message: `Moved item: ${command.data.itemId}`,
      data: result.data,
      affectedItems: [command.data.itemId],
      affectedTimeRanges: result.affectedTimeRanges,
      validationReport,
    }
  }

  private async executeUpdateField(command: UpdateFieldCommand): Promise<ExecutionResult> {
    const result = await this.atomicCapabilities.updateField(
      command.data.itemId,
      command.data.field,
      command.data.value,
      { skipValidation: !this.config.enableAutoValidation },
    )
    if (!result.success) {
      return { success: false, message: `Update field failed: ${result.error}` }
    }

    let validationReport: ValidationReport | undefined
    if (this.config.enableAutoValidation && this.onValidation) {
      validationReport = await this.onValidation('item')
    }

    return {
      success: true,
      message: `Field updated: ${command.data.field}`,
      data: result.data,
      affectedItems: [command.data.itemId],
      affectedTimeRanges: result.affectedTimeRanges,
      validationReport,
    }
  }

  private executeClarification(command: ClarificationCommand): ExecutionResult {
    return {
      success: true,
      message: command.data.question,
      data: command.data,
    }
  }

  private calculateEndTime(startTime: string, durationSeconds: number): string {
    const startMs = new Date(startTime).getTime()
    const end = new Date(startMs + durationSeconds * 1000)
    return this.formatLocalDateTime(end)
  }

  private formatLocalDateTime(value: Date): string {
    const year = value.getFullYear()
    const month = String(value.getMonth() + 1).padStart(2, '0')
    const day = String(value.getDate()).padStart(2, '0')
    const hours = String(value.getHours()).padStart(2, '0')
    const minutes = String(value.getMinutes()).padStart(2, '0')
    const seconds = String(value.getSeconds()).padStart(2, '0')
    return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}+08:00`
  }

  private logExecution(message: string): void {
    this.executionLog.push(`${new Date().toISOString()} ${message}`)
    if (this.executionLog.length > 200) {
      this.executionLog.shift()
    }
  }

  getExecutionLog(): string[] {
    return [...this.executionLog]
  }

  getScheduleItems(): ScheduleItemSnapshot[] {
    return this.atomicCapabilities.getAllItems()
  }

  setCandidates(gapId: string, candidates: ProgramCandidate[]): void {
    this.candidates.set(gapId, candidates)
  }

  setGaps(gaps: GapInfo[]): void {
    this.gaps.clear()
    gaps.forEach((gap) => this.gaps.set(gap.id, gap))
  }
}

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

