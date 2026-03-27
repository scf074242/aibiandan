import type {
  ExplanationResult,
  OrchestrationCommand,
  ProgramCandidate,
  ScheduleItemSnapshot,
  ValidationIssue,
  ValidationReport,
} from '@/types/orchestration'
import type { LLMClient } from '@/services/llm/llmClient'
import type { DataService } from '../dataService'
import type { ChatMessage } from '@/types/llm'

export class ExplainInterfaces {
  private llmClient: LLMClient
  private dataService: DataService

  constructor(llmClient: LLMClient, dataService: DataService) {
    this.llmClient = llmClient
    this.dataService = dataService
  }

  async explainCandidateSelection(
    candidateId: string,
    context: {
      gapDuration: number
      precedingItem?: ScheduleItemSnapshot
      followingItem?: ScheduleItemSnapshot
    },
  ): Promise<ExplanationResult> {
    const candidate = await this.dataService.getProgramDetails(candidateId)
    if (!candidate) {
      return {
        type: 'candidate_selection',
        targetId: candidateId,
        explanation: '未找到候选节目信息。',
      }
    }

    const messages = this.buildCandidateExplanationPrompt(candidate, context)

    try {
      const response = await this.llmClient.chat(messages, {
        temperature: 0.5,
        maxTokens: 300,
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
    } catch {
      return {
        type: 'candidate_selection',
        targetId: candidateId,
        explanation: `选择《${candidate.programName}》是因为它与当前空窗时长更接近，且节目类型更匹配。`,
      }
    }
  }

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
      filteredIssues = report.issues.filter((issue) => issue.severity === 'critical')
    } else if (scope === 'warning') {
      filteredIssues = report.issues.filter((issue) => issue.severity !== 'info')
    }

    const issuesByType: Record<string, ValidationIssue[]> = {}
    for (const issue of filteredIssues) {
      if (!issuesByType[issue.type]) {
        issuesByType[issue.type] = []
      }
      issuesByType[issue.type]!.push(issue)
    }

    const suggestions = filteredIssues
      .map((issue) => issue.suggestion)
      .filter((suggestion): suggestion is string => Boolean(suggestion))

    return {
      summary: this.generateValidationSummary(filteredIssues, report.summary),
      issuesByType,
      suggestions: [...new Set(suggestions)],
    }
  }

  async explainCommand(command: OrchestrationCommand): Promise<ExplanationResult> {
    return {
      type: 'command',
      targetId: (command as { data?: { itemId?: string; gapId?: string } }).data?.itemId
        || (command as { data?: { itemId?: string; gapId?: string } }).data?.gapId
        || 'unknown',
      explanation: this.generateCommandExplanation(command),
      details: {
        commandType: command.action,
        reasoning: command.reasoning,
      },
    }
  }

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

  explainRepairDecision(
    round: number,
    maxRounds: number,
    issueCount: number,
    strategy: string,
  ): string {
    return `第 ${round}/${maxRounds} 轮修补：采用“${strategy}”策略处理 ${issueCount} 个问题。`
  }

  private buildCandidateExplanationPrompt(
    candidate: ProgramCandidate,
    context: {
      gapDuration: number
      precedingItem?: ScheduleItemSnapshot
      followingItem?: ScheduleItemSnapshot
    },
  ): ChatMessage[] {
    return [
      {
        role: 'system',
        content:
          '你是一位电视节目编排助手。请用一句简短中文说明为什么选择该候选节目填充当前空窗，重点说明时长匹配、类型匹配和上下文衔接。',
      },
      {
        role: 'user',
        content:
          `候选节目：${candidate.programName}\n` +
          `节目编码：${candidate.programCode}\n` +
          `节目类型：${candidate.programType}\n` +
          `节目时长：${candidate.duration} 秒\n` +
          `空窗时长：${context.gapDuration} 秒\n` +
          `${context.precedingItem ? `前邻节目：${context.precedingItem.programName}\n` : ''}` +
          `${context.followingItem ? `后邻节目：${context.followingItem.programName}\n` : ''}`,
      },
    ]
  }

  private generateValidationSummary(
    issues: ValidationIssue[],
    summary: { totalIssues: number; criticalCount: number; warningCount: number; infoCount: number },
  ): string {
    if (issues.length === 0) {
      return '校验通过，未发现问题。'
    }

    const parts: string[] = []
    if (summary.criticalCount > 0) parts.push(`${summary.criticalCount} 个严重问题`)
    if (summary.warningCount > 0) parts.push(`${summary.warningCount} 个警告`)
    if (summary.infoCount > 0) parts.push(`${summary.infoCount} 个提示`)
    return `校验完成，发现 ${parts.join('，')}。`
  }

  private generateCommandExplanation(command: OrchestrationCommand): string {
    const actionNames: Record<string, string> = {
      plan: '策略初始化',
      query_candidates: '候选查询',
      fill_item: '填充节目',
      repair: '修补',
      insert: '插入节目',
      delete: '删除节目',
      replace: '替换节目',
      move: '移动节目',
      update_field: '更新字段',
      clarification: '请求澄清',
    }

    const actionName = actionNames[command.action] || command.action
    return command.reasoning ? `${actionName}：${command.reasoning}` : `执行${actionName}操作`
  }
}

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
