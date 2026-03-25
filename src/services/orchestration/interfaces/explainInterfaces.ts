/**
 * 解释类接口
 * 提供编排决策的可解释性
 */

import type {
  OrchestrationCommand,
  ValidationReport,
  ValidationIssue,
  ExplanationResult,
  ProgramCandidate,
  ScheduleItemSnapshot,
} from '@/types/orchestration'
import type { LLMClient } from '@/services/llm/llmClient'
import type { DataService } from '../dataService'
import type { ChatMessage } from '@/types/llm'

/** 解释接口 */
export class ExplainInterfaces {
  private llmClient: LLMClient
  private dataService: DataService

  constructor(llmClient: LLMClient, dataService: DataService) {
    this.llmClient = llmClient
    this.dataService = dataService
  }

  /**
   * 解释候选选择
   */
  async explainCandidateSelection(
    candidateId: string,
    context: {
      gapDuration: number
      precedingItem?: ScheduleItemSnapshot
      followingItem?: ScheduleItemSnapshot
    },
  ): Promise<ExplanationResult> {
    // 获取候选详情
    const candidate = await this.dataService.getProgramDetails(candidateId)
    if (!candidate) {
      return {
        type: 'candidate_selection',
        targetId: candidateId,
        explanation: '未找到候选信息',
      }
    }

    // 构建解释Prompt
    const messages = this.buildCandidateExplanationPrompt(candidate, context)

    try {
      const response = await this.llmClient.chat(messages, {
        temperature: 0.5,
        maxTokens: 500,
      })

      return {
        type: 'candidate_selection',
        targetId: candidateId,
        explanation: response.content,
        details: {
          candidate,
          gapDuration: context.gapDuration,
          durationMatch: Math.abs(candidate.duration - context.gapDuration) < 60,
        },
      }
    } catch (error) {
      return {
        type: 'candidate_selection',
        targetId: candidateId,
        explanation: `选择 "${candidate.programName}" 的原因：时长 ${candidate.duration}秒 与空窗时长 ${context.gapDuration}秒 匹配度较高`,
      }
    }
  }

  /**
   * 汇总校验问题
   */
  summarizeValidationIssues(
    report: ValidationReport,
    scope: 'critical' | 'warning' | 'all' = 'all',
  ): {
    summary: string
    issuesByType: Record<string, ValidationIssue[]>
    suggestions: string[]
  } {
    let filteredIssues = report.issues

    if (scope === 'critical') {
      filteredIssues = report.issues.filter((i) => i.severity === 'critical')
    } else if (scope === 'warning') {
      filteredIssues = report.issues.filter((i) => i.severity !== 'info')
    }

    // 按类型分组
    const issuesByType: Record<string, ValidationIssue[]> = {}
    for (const issue of filteredIssues) {
      if (!issuesByType[issue.type]) {
        issuesByType[issue.type] = []
      }
      issuesByType[issue.type]!.push(issue)
    }

    // 生成汇总
    const summary = this.generateValidationSummary(filteredIssues, report.summary)

    // 收集建议
    const suggestions = filteredIssues
      .map((i) => i.suggestion)
      .filter((s): s is string => !!s)

    return {
      summary,
      issuesByType,
      suggestions: [...new Set(suggestions)],
    }
  }

  /**
   * 解释命令
   */
  async explainCommand(command: OrchestrationCommand): Promise<ExplanationResult> {
    const explanation = this.generateCommandExplanation(command)

    return {
      type: 'command',
      targetId: (command as any).data?.itemId || (command as any).data?.gapId || 'unknown',
      explanation,
      details: {
        commandType: command.action,
        reasoning: command.reasoning,
      },
    }
  }

  /**
   * 解释回退决策
   */
  explainFallbackDecision(
    level: 'item' | 'gap' | 'session',
    reason: string,
    attemptCount: number,
    maxAttempts: number,
  ): string {
    const levelNames = {
      item: '条目级',
      gap: '空窗级',
      session: '会话级',
    }

    return `${levelNames[level]}回退已触发：${reason}（尝试 ${attemptCount}/${maxAttempts} 次）`
  }

  /**
   * 解释修补决策
   */
  explainRepairDecision(
    round: number,
    maxRounds: number,
    issueCount: number,
    strategy: string,
  ): string {
    return `第 ${round}/${maxRounds} 轮修补：采用 "${strategy}" 策略处理 ${issueCount} 个问题`
  }

  // ==================== 辅助方法 ====================

  /**
   * 构建候选解释Prompt
   */
  private buildCandidateExplanationPrompt(
    candidate: ProgramCandidate,
    context: {
      gapDuration: number
      precedingItem?: ScheduleItemSnapshot
      followingItem?: ScheduleItemSnapshot
    },
  ): ChatMessage[] {
    const systemPrompt = `你是一位电视节目编排专家。
请解释为什么选择这个候选节目来填充空窗。

请用自然语言简要说明选择理由，包括：
1. 时长匹配度
2. 节目类型适宜性
3. 与前后节目的衔接

输出要求：简洁明了，50字以内。`

    const userPrompt = `【候选节目】
- 名称: ${candidate.programName}
- 时长: ${candidate.duration}秒
- 类型: ${candidate.programType}
- 评分: ${candidate.rating || 'N/A'}

【空窗信息】
- 空窗时长: ${context.gapDuration}秒

【上下文】
${context.precedingItem ? `- 前邻节目: ${context.precedingItem.programName} (${context.precedingItem.programType})` : '- 前邻节目: 无'}
${context.followingItem ? `- 后邻节目: ${context.followingItem.programName} (${context.followingItem.programType})` : '- 后邻节目: 无'}

请解释为什么选择这个节目。`

    return [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ]
  }

  /**
   * 生成校验汇总
   */
  private generateValidationSummary(
    issues: ValidationIssue[],
    summary: { totalIssues: number; criticalCount: number; warningCount: number; infoCount: number },
  ): string {
    if (issues.length === 0) {
      return '校验通过，未发现问题。'
    }

    const parts: string[] = []

    if (summary.criticalCount > 0) {
      parts.push(`发现 ${summary.criticalCount} 个严重问题`)
    }

    if (summary.warningCount > 0) {
      parts.push(`${summary.warningCount} 个警告`)
    }

    if (summary.infoCount > 0) {
      parts.push(`${summary.infoCount} 个提示`)
    }

    return `编排校验完成：${parts.join('，')}。`
  }

  /**
   * 生成命令解释
   */
  private generateCommandExplanation(command: OrchestrationCommand): string {
    const actionNames: Record<string, string> = {
      plan: '策略初始化',
      query_candidates: '候选检索',
      fill_item: '填充条目',
      repair: '修复',
      insert: '插入条目',
      delete: '删除条目',
      replace: '替换条目',
      move: '移动条目',
      update_field: '更新字段',
      clarification: '请求澄清',
    }

    const actionName = actionNames[command.action] || command.action

    if (command.reasoning) {
      return `${actionName}：${command.reasoning}`
    }

    return `执行${actionName}操作`
  }
}

// 导出工厂函数
let globalExplainInterfaces: ExplainInterfaces | null = null

export function getExplainInterfaces(
  llmClient?: LLMClient,
  dataService?: DataService,
): ExplainInterfaces {
  if (!globalExplainInterfaces) {
    if (!llmClient || !dataService) {
      throw new Error('LLM client and data service are required for first initialization')
    }
    globalExplainInterfaces = new ExplainInterfaces(llmClient, dataService)
  }
  return globalExplainInterfaces
}

export function resetExplainInterfaces(): void {
  globalExplainInterfaces = null
}
