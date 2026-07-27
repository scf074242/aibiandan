import type { AgentDeadline } from './agentDeadline'
import { STAGE_TIMEOUT_BUDGET } from './agentDeadline'
import { normalizeAgentPlannerAction, type AgentPlannerAction } from '@/services/llm/agentPlanner'
import type { LLMClient } from '@/services/llm/llmClient'
import type {
  FormalOrchestrationDecision,
  FormalOrchestrationDecideInput,
} from '@/services/runtime/formalOrchestrationRuntime'
import type { FormalOrchestrationGrant } from '@/services/runtime/formalOrchestrationGrant'

export const FORMAL_ORCHESTRATION_DECIDER_PROMPT_VERSION = 'v1.4' as const

export class InvalidFormalOrchestrationDecisionError extends Error {
  readonly code = 'INVALID_FORMAL_ORCHESTRATION_DECISION'
}

export interface FormalOrchestrationDeciderOptions {
  llmClient: LLMClient
  deadline?: AgentDeadline
  authorization?: FormalOrchestrationGrant
}

/**
 * 长流程每批 observation 后的 LLM 决策适配器。
 * 它只返回结构化下一步，不执行 action，也不改写用户意图。
 */
export class LlmFormalOrchestrationDecider {
  private readonly llmClient: LLMClient
  private readonly deadline?: AgentDeadline
  private readonly authorization?: FormalOrchestrationGrant

  constructor(options: FormalOrchestrationDeciderOptions) {
    this.llmClient = options.llmClient
    this.deadline = options.deadline
    this.authorization = options.authorization
  }

  async decide(
    input: FormalOrchestrationDecideInput<AgentPlannerAction>,
  ): Promise<FormalOrchestrationDecision<AgentPlannerAction>> {
    const timeout = this.deadline?.stageTimeoutMs(STAGE_TIMEOUT_BUDGET.candidate_search) ?? STAGE_TIMEOUT_BUDGET.candidate_search
    const response = await this.llmClient.chat(this.buildPrompt(input), {
      temperature: 0.2,
      maxTokens: 1200,
      timeout,
      maxRetries: 2,
      traceLabel: 'formal_orchestration_decide',
      promptVersion: FORMAL_ORCHESTRATION_DECIDER_PROMPT_VERSION,
      ...(this.deadline ? { signal: this.deadline.signal() } : {}),
    })

    return this.parseDecision(response.content)
  }

  private buildPrompt(input: FormalOrchestrationDecideInput<AgentPlannerAction>) {
    return [
      {
        role: 'system' as const,
        content: `[prompt ${FORMAL_ORCHESTRATION_DECIDER_PROMPT_VERSION}] 你是广电节目编排长流程的 decide 阶段。你只能基于真实 observation 决定下一批动作。不要补造节目、候选、时间或写入结果；如果证据不足，返回 unable_to_decide。只返回 JSON：{"kind":"continue|complete|unable_to_decide","reason":"中文理由","nextActions":[]}。nextActions 中的 atomic_command 必须显式携带 mutationPolicy：只读检查用 preview_only，需要用户确认的待处理动作使用 pending_only，只有用户已明确授权且 observation 中写入条件完整时才可使用 formal_write；不得省略或本地默认。不要在 nextActions 中返回 formal_orchestration、commit_layout_draft、create_playlist 或草案控制动作，避免递归启动控制流程。`,
      },
      {
        role: 'user' as const,
        content: JSON.stringify({
          decisionContract: {
            continue: {
              requiredFields: ['kind', 'reason', 'nextActions'],
              nextActionsMustUseTypeField: true,
              examples: [
                { type: 'validate' },
                { type: 'research_check', purpose: 'candidate_precheck', queries: ['候选关键词'] },
                { type: 'read_only_analysis', analysisKind: 'playlist_analysis' },
              ],
            },
            complete: { requiredFields: ['kind', 'reason'], forbiddenFields: ['nextActions'] },
            unable_to_decide: { requiredFields: ['kind', 'reason'], forbiddenFields: ['nextActions'] },
          },
          objective: input.objective,
          authorization: this.authorization
            ? {
                grantId: this.authorization.grantId,
                workspaceKey: this.authorization.workspaceKey,
                mode: this.authorization.mode,
                targetTimeRange: this.authorization.targetTimeRange,
                allowedIntents: this.authorization.allowedIntents,
                expiresAt: this.authorization.expiresAt,
              }
            : undefined,
          authorizationGuidance: this.authorization
            ? '用户已经确认当前工作区的整批重编。证据与写入条件完整且动作属于 allowedIntents 时使用 formal_write，不要再次返回 pending_only；越出 workspace 或 allowedIntents 时停止并暴露。'
            : '没有整批重编授权凭证。敏感 mutation 仍按原规则使用 pending_only 等待明确确认。',
          originalUserInput: input.originalUserInput,
          turn: input.turn,
          observations: input.observations,
          compactedHistory: input.compactedContext,
          pendingSteps: input.run.steps
            .filter((step) => step.status === 'pending' || step.status === 'running')
            .map((step) => ({ id: step.id, turn: step.turn, action: step.action })),
        }),
      },
    ]
  }

  private parseDecision(content: string): FormalOrchestrationDecision<AgentPlannerAction> {
    const match = content.match(/\{[\s\S]*\}/)
    if (!match) throw new InvalidFormalOrchestrationDecisionError('decide 响应不是 JSON。')

    let parsed: unknown
    try {
      parsed = JSON.parse(match[0])
    } catch {
      throw new InvalidFormalOrchestrationDecisionError('decide 响应 JSON 无法解析。')
    }
    if (!parsed || typeof parsed !== 'object') throw new InvalidFormalOrchestrationDecisionError('decide 响应结构无效。')
    const value = parsed as Record<string, unknown>
    const reason = typeof value.reason === 'string' && value.reason.trim() ? value.reason.trim() : '模型没有提供可读决策理由。'
    if (value.kind === 'complete') return { kind: 'complete', reason }
    if (value.kind === 'unable_to_decide') return { kind: 'unable_to_decide', reason }
    if (value.kind !== 'continue') throw new InvalidFormalOrchestrationDecisionError('decide.kind 不是允许的值。')

    const rawActions = Array.isArray(value.nextActions) ? value.nextActions : []
    const nextActions = rawActions
      .map(normalizeAgentPlannerAction)
      .filter((action): action is AgentPlannerAction => Boolean(action))
    if (!nextActions.length) throw new InvalidFormalOrchestrationDecisionError('continue 决策没有合法 nextActions。')
    if (nextActions.length > 10) throw new InvalidFormalOrchestrationDecisionError('continue 决策超过单批动作上限。')
    return { kind: 'continue', reason, nextActions }
  }
}
