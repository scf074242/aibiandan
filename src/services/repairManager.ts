/**
 * 修补管理器
 * 实现有限轮次修补机制
 *
 * 原则：
 * 1. 校验发现问题后，最多尝试 N 轮修补（默认3轮）
 * 2. 每轮修补后重新校验
 * 3. 达到最大轮次仍未修复，转人工处理
 * 4. 检测修补是否收敛（问题是否在减少）
 */

import type {
  ValidationReport,
  ValidationIssue,
  RepairAction,
  RepairState,
  RepairConfig,
  OrchestrationCommand,
  RepairCommand,
  ScheduleItemSnapshot,
  ProgramCandidate,
} from '@/types/orchestration'
import type { CommandExecutor } from './commandExecutor'
import type { ValidationEngine } from './validators/validationEngine'
import type { LLMClient } from './llm/llmClient'
import type { ChatMessage } from '@/types/llm'

/** 修补管理器 */
export class RepairManager {
  private config: RepairConfig
  private commandExecutor: CommandExecutor
  private validationEngine: ValidationEngine
  private llmClient: LLMClient

  // 修补状态
  private repairState: RepairState | null = null
  private repairHistory: RepairState[] = []

  constructor(
    commandExecutor: CommandExecutor,
    validationEngine: ValidationEngine,
    llmClient: LLMClient,
    config?: Partial<RepairConfig>,
  ) {
    this.commandExecutor = commandExecutor
    this.validationEngine = validationEngine
    this.llmClient = llmClient
    this.config = {
      maxRepairRounds: 3,
      autoRepair: true,
      requireConfirmation: false,
      ...config,
    }
  }

  /**
   * 开始修补流程
   */
  async startRepair(
    validationReport: ValidationReport,
    context: {
      items: ScheduleItemSnapshot[]
      candidates: ProgramCandidate[]
    },
  ): Promise<{
    success: boolean
    message: string
    finalReport?: ValidationReport
    repairState: RepairState
  }> {
    // 初始化修补状态
    this.repairState = {
      currentRound: 0,
      maxRounds: this.config.maxRepairRounds,
      issuesByRound: [],
      actionsTaken: [],
      isComplete: false,
      requiresManualIntervention: false,
    }

    let currentReport = validationReport

    // 修补循环
    while (this.repairState.currentRound < this.repairState.maxRounds) {
      this.repairState.currentRound++

      // 记录当前问题
      this.repairState.issuesByRound.push([...currentReport.issues])

      // 检查是否已经修复
      if (currentReport.isValid) {
        this.repairState.isComplete = true
        return {
          success: true,
          message: `修补完成，共 ${this.repairState.currentRound} 轮`,
          finalReport: currentReport,
          repairState: this.repairState,
        }
      }

      // 检查是否收敛
      if (!this.isConverging()) {
        this.repairState.requiresManualIntervention = true
        return {
          success: false,
          message: `修补未收敛，问题数量未减少，需要人工介入`,
          finalReport: currentReport,
          repairState: this.repairState,
        }
      }

      // 生成修复策略
      const repairCommand = await this.generateRepairCommand(
        currentReport,
        context,
      )

      if (!repairCommand) {
        this.repairState.requiresManualIntervention = true
        return {
          success: false,
          message: `无法生成有效的修复策略，需要人工介入`,
          finalReport: currentReport,
          repairState: this.repairState,
        }
      }

      // 执行修复
      const repairResult = await this.executeRepair(repairCommand)

      if (!repairResult.success) {
        this.repairState.requiresManualIntervention = true
        return {
          success: false,
          message: `修复执行失败: ${repairResult.message}，需要人工介入`,
          finalReport: currentReport,
          repairState: this.repairState,
        }
      }

      // 记录修复动作
      this.repairState.actionsTaken.push({
        id: `action_${Date.now()}`,
        type: repairCommand.data.strategy,
        description: `第 ${this.repairState.currentRound} 轮修复`,
        targetIssueId: repairCommand.data.targetId,
        estimatedImpact: 'medium',
      })

      // 重新校验
      currentReport = await this.revalidate(context.items)
    }

    // 达到最大轮次
    this.repairState.requiresManualIntervention = true
    return {
      success: false,
      message: `达到最大修补轮次 ${this.config.maxRepairRounds}，仍有 ${currentReport.issues.length} 个问题未修复，需要人工介入`,
      finalReport: currentReport,
      repairState: this.repairState,
    }
  }

  /**
   * 生成修复命令
   */
  private async generateRepairCommand(
    validationReport: ValidationReport,
    context: {
      items: ScheduleItemSnapshot[]
      candidates: ProgramCandidate[]
    },
  ): Promise<RepairCommand | null> {
    // 构建修复策略 Prompt
    const messages = this.buildRepairPrompt(validationReport, context)

    try {
      const response = await this.llmClient.chat(messages, {
        temperature: 0.4,
        maxTokens: 800,
      })

      return this.parseRepairCommand(response.content)
    } catch (error) {
      console.error('生成修复策略失败:', error)
      return null
    }
  }

  /**
   * 构建修复策略 Prompt
   */
  private buildRepairPrompt(
    validationReport: ValidationReport,
    context: {
      items: ScheduleItemSnapshot[]
      candidates: ProgramCandidate[]
    },
  ): ChatMessage[] {
    const systemPrompt = `你是一位电视节目编排修复专家。
当校验发现问题时，请选择合适的修复策略。

可选修复策略：
1. replace_candidate - 替换候选（用其他候选替换当前节目）
2. add_filler - 补短片（在空窗中添加填充内容）
3. adjust_item - 调整一条（调整节目时间或属性）
4. local_fallback - 局部回退（回退该空窗的最近若干条）
5. request_manual - 请求人工确认（问题复杂，需要人工处理）

重要：
- 只选择修复策略，不输出修复后的完整节目单
- 系统将根据策略执行具体修复

输出必须是 JSON 格式：
{
  "action": "repair",
  "data": {
    "targetId": "目标ID（条目ID或空窗ID）",
    "targetType": "item" | "gap",
    "strategy": "replace_candidate" | "add_filler" | "adjust_item" | "local_fallback" | "request_manual",
    "parameters": {
      // 策略特定参数
    }
  },
  "reasoning": "修复策略说明"
}`

    const issuesStr = validationReport.issues
      .map(
        (issue, i) =>
          `${i + 1}. [${issue.severity}] ${issue.type}: ${issue.message}${issue.suggestion ? ` (建议: ${issue.suggestion})` : ''}`,
      )
      .join('\n')

    const userPrompt = `【校验报告】
- 范围: ${validationReport.scope}
- 总问题数: ${validationReport.summary.totalIssues}
- 严重: ${validationReport.summary.criticalCount}, 警告: ${validationReport.summary.warningCount}, 信息: ${validationReport.summary.infoCount}

【问题列表】
${issuesStr}

【当前编排】
${context.items.map((item) => `- ${item.programName} (${item.startTime} - ${item.endTime})`).join('\n')}

【可用候选】
${context.candidates.map((c) => `- ${c.programName} (${c.duration}秒)`).join('\n')}

请选择修复策略，输出 JSON 格式。`

    return [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ]
  }

  /**
   * 解析修复命令
   */
  private parseRepairCommand(content: string): RepairCommand | null {
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/)
      if (!jsonMatch) return null

      const result = JSON.parse(jsonMatch[0])

      if (result.action === 'repair') {
        return result as RepairCommand
      }

      return null
    } catch {
      return null
    }
  }

  /**
   * 执行修复
   */
  private async executeRepair(
    repairCommand: RepairCommand,
  ): Promise<{ success: boolean; message: string }> {
    const result = await this.commandExecutor.execute(repairCommand)

    return {
      success: result.success,
      message: result.message,
    }
  }

  /**
   * 重新校验
   */
  private async revalidate(
    items: ScheduleItemSnapshot[],
  ): Promise<ValidationReport> {
    const context = {
      items,
      gaps: [],
      fixedItems: [],
      layoutSlots: [],
      dayStartTime: '00:00:00',
      dayEndTime: '23:59:59',
    }

    return this.validationEngine.validate(context)
  }

  /**
   * 检查是否收敛
   * 问题数量是否在减少
   */
  private isConverging(): boolean {
    const rounds = this.repairState!.issuesByRound
    if (rounds.length < 2) return true

    const current = rounds[rounds.length - 1]!.length
    const previous = rounds[rounds.length - 2]!.length

    // 问题数量减少或在可接受范围内波动
    return current <= previous + 1
  }

  /**
   * 获取当前修补状态
   */
  getRepairState(): RepairState | null {
    return this.repairState
  }

  /**
   * 获取修补历史
   */
  getRepairHistory(): RepairState[] {
    return [...this.repairHistory]
  }

  /**
   * 重置修补状态
   */
  reset(): void {
    if (this.repairState) {
      this.repairHistory.push({ ...this.repairState })
    }
    this.repairState = null
  }

  /**
   * 是否需要人工介入
   */
  requiresManualIntervention(): boolean {
    return this.repairState?.requiresManualIntervention || false
  }

  /**
   * 获取修复建议（基于校验报告生成）
   */
  generateRepairSuggestions(validationReport: ValidationReport): RepairAction[] {
    const suggestions: RepairAction[] = []

    for (const issue of validationReport.issues) {
      switch (issue.type) {
        case 'gap':
          suggestions.push({
            id: `suggestion_${Date.now()}_gap`,
            type: 'add_filler',
            description: `填充空窗: ${issue.message}`,
            targetIssueId: issue.id,
            estimatedImpact: 'low',
          })
          break
        case 'overlap':
          suggestions.push({
            id: `suggestion_${Date.now()}_overlap`,
            type: 'adjust_item',
            description: `调整重叠条目: ${issue.message}`,
            targetIssueId: issue.id,
            estimatedImpact: 'high',
          })
          break
        case 'duration_mismatch':
          suggestions.push({
            id: `suggestion_${Date.now()}_duration`,
            type: 'replace_candidate',
            description: `替换时长不匹配的候选: ${issue.message}`,
            targetIssueId: issue.id,
            estimatedImpact: 'medium',
          })
          break
        default:
          suggestions.push({
            id: `suggestion_${Date.now()}_default`,
            type: 'request_manual',
            description: `需要人工处理: ${issue.message}`,
            targetIssueId: issue.id,
            estimatedImpact: 'medium',
          })
      }
    }

    return suggestions
  }
}

// 导出工厂函数
let globalRepairManager: RepairManager | null = null

export function getRepairManager(
  commandExecutor?: CommandExecutor,
  validationEngine?: ValidationEngine,
  llmClient?: LLMClient,
  config?: Partial<RepairConfig>,
): RepairManager {
  if (!globalRepairManager) {
    if (!commandExecutor || !validationEngine || !llmClient) {
      throw new Error(
        'Command executor, validation engine and LLM client are required for first initialization',
      )
    }
    globalRepairManager = new RepairManager(
      commandExecutor,
      validationEngine,
      llmClient,
      config,
    )
  }
  return globalRepairManager
}

export function resetRepairManager(): void {
  globalRepairManager = null
}
