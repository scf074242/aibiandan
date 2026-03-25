/**
 * 执行类接口
 * 提供命令执行和校验能力
 */

import type {
  OrchestrationCommand,
  ValidationReport,
  RepairAction,
  ScheduleItemSnapshot,
  ValidationContext,
} from '@/types/orchestration'
import type { CommandExecutor, ExecutionResult } from '@/services/commandExecutor'
import type { ValidationEngine } from '@/services/validators/validationEngine'
import type { RepairManager } from '@/services/repairManager'

/** 执行接口 */
export class ExecuteInterfaces {
  private commandExecutor: CommandExecutor
  private validationEngine: ValidationEngine
  private repairManager?: RepairManager

  constructor(
    commandExecutor: CommandExecutor,
    validationEngine: ValidationEngine,
    repairManager?: RepairManager,
  ) {
    this.commandExecutor = commandExecutor
    this.validationEngine = validationEngine
    this.repairManager = repairManager
  }

  /**
   * 执行命令
   */
  async executeCommand(command: OrchestrationCommand): Promise<ExecutionResult> {
    return this.commandExecutor.execute(command)
  }

  /**
   * 批量执行命令
   */
  async executeBatchCommands(commands: OrchestrationCommand[]): Promise<{
    results: ExecutionResult[]
    successCount: number
    failCount: number
  }> {
    const results: ExecutionResult[] = []

    for (const command of commands) {
      const result = await this.executeCommand(command)
      results.push(result)
    }

    const successCount = results.filter((r) => r.success).length
    const failCount = results.length - successCount

    return {
      results,
      successCount,
      failCount,
    }
  }

  /**
   * 校验编排
   */
  validateSchedule(
    scope: 'item' | 'full',
    context: ValidationContext,
  ): ValidationReport {
    if (scope === 'item' && context.items.length > 0) {
      // 校验第一个条目作为示例
      return this.validationEngine.validateItem(context.items[0]!, context)
    }
    return this.validationEngine.validate(context)
  }

  /**
   * 执行修复动作
   */
  async executeRepairAction(action: RepairAction): Promise<ExecutionResult> {
    // 将 RepairAction 转换为 RepairCommand 并执行
    const repairCommand = {
      action: 'repair' as const,
      data: {
        targetId: action.targetIssueId,
        targetType: 'item' as const,
        strategy: action.type,
        parameters: action.parameters,
      },
      reasoning: action.description,
    }

    return this.executeCommand(repairCommand)
  }

  /**
   * 批量执行修复
   */
  async executeBatchRepair(actions: RepairAction[]): Promise<{
    results: ExecutionResult[]
    successCount: number
    failCount: number
  }> {
    const results: ExecutionResult[] = []

    for (const action of actions) {
      const result = await this.executeRepairAction(action)
      results.push(result)
    }

    const successCount = results.filter((r) => r.success).length
    const failCount = results.length - successCount

    return {
      results,
      successCount,
      failCount,
    }
  }

  /**
   * 自动修复
   */
  async autoRepair(
    validationReport: ValidationReport,
    context: {
      items: ScheduleItemSnapshot[]
      candidates: any[]
    },
  ): Promise<{
    success: boolean
    message: string
    finalReport?: ValidationReport
  }> {
    if (!this.repairManager) {
      return {
        success: false,
        message: 'Repair manager not initialized',
      }
    }

    return this.repairManager.startRepair(validationReport, context)
  }
}

// 导出工厂函数
let globalExecuteInterfaces: ExecuteInterfaces | null = null

export function getExecuteInterfaces(
  commandExecutor?: CommandExecutor,
  validationEngine?: ValidationEngine,
  repairManager?: RepairManager,
): ExecuteInterfaces {
  if (!globalExecuteInterfaces) {
    if (!commandExecutor || !validationEngine) {
      throw new Error('Command executor and validation engine are required for first initialization')
    }
    globalExecuteInterfaces = new ExecuteInterfaces(commandExecutor, validationEngine, repairManager)
  }
  return globalExecuteInterfaces
}

export function resetExecuteInterfaces(): void {
  globalExecuteInterfaces = null
}
