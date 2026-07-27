import { describe, expect, it, vi } from 'vitest'

import {
  AgentDeadline,
  DEFAULT_OVERALL_DEADLINE_MS,
  STAGE_RESERVE_BUDGET,
  STAGE_TIMEOUT_BUDGET,
} from '@/services/agent/agentDeadline'
import { LlmAgentCandidateJudge } from '@/services/agent/candidateJudge'
import { LlmAgentIntentInterpreter } from '@/services/agent/llmAgentIntentInterpreter'
import type { AgentCandidateJudgeInput, AgentProgramCandidate, AgentSubmitInput } from '@/services/agent/types'

const cases = {
  intentBudget: {
    id: 'agent-deadline-intent-uses-overall-remaining-budget',
    userInput: '在9点插入节目看东方',
    expectedDecision: '意图解析使用共享整体剩余预算并携带同一个 AbortSignal',
    mustNotHappen: '真实模型在固定8秒预算处被提前中止，或底层请求脱离统一中止信号继续运行',
    verification: '默认整体预算为90秒，intent 单阶段最多45秒、为后续阶段保留40秒且 signal 与 AgentDeadline.signal() 相同',
  },
  candidateBudget: {
    id: 'agent-deadline-candidate-judge-uses-overall-remaining-budget',
    userInput: '从两个看东方候选中选择合适的一条',
    expectedDecision: '候选 LLM 决策继续使用同一共享剩余预算和 AbortSignal',
    mustNotHappen: '候选决策重新创建独立8秒窗口或无法响应统一中止',
    verification: 'candidate judge 单阶段最多45秒、为写入保留10秒并使用同一 signal',
  },
} as const

const createInput = (userInput: string): AgentSubmitInput => ({
  userInput,
  channelId: 'dragon',
  date: '2026-03-25',
  playlistId: 'tv-playlist',
})

const candidate = (id: string, issueNo: number): AgentProgramCandidate => ({
  id,
  programId: 'program-see-oriental',
  programCode: `SEE-ORIENTAL-${issueNo}`,
  programName: '看东方',
  instanceName: `看东方第${issueNo}期`,
  programType: 'news_magazine',
  duration: 3600,
  issueNo,
})

describe('AgentDeadline LLM stage propagation', () => {
  it(`${cases.intentBudget.id}: does not cut real intent interpretation off at eight seconds`, async () => {
    const testCase = cases.intentBudget
    const chat = vi.fn(async () => ({
      content: JSON.stringify({
        intent: 'insert',
        confidence: 0.96,
        slots: { targetTime: '09:00:00', programHint: '看东方' },
        assistantFeedback: '我会核对9点时段并查找《看东方》。',
      }),
    }))
    const deadline = new AgentDeadline()

    await new LlmAgentIntentInterpreter({ chat }).interpret(createInput(testCase.userInput), deadline)

    expect(testCase).toMatchObject({
      expectedDecision: expect.any(String),
      mustNotHappen: expect.any(String),
      verification: expect.any(String),
    })
    expect(DEFAULT_OVERALL_DEADLINE_MS).toBe(180_000)
    expect(STAGE_TIMEOUT_BUDGET.intent_parse).toBe(90_000)
    const options = chat.mock.calls[0]?.[1]
    expect(options?.timeout).toBeGreaterThan(80_000)
    expect(options?.timeout).toBeLessThanOrEqual(
      STAGE_TIMEOUT_BUDGET.intent_parse,
    )
    expect(STAGE_RESERVE_BUDGET.after_intent_parse).toBe(60_000)
    expect(options?.signal).toBe(deadline.signal())
    expect(options?.responseFormat).toBe('json_object')
    expect(options?.promptVersion).toBe('v2.5')
    expect(options?.maxTokens).toBe(1_100)
    const systemPrompt = chat.mock.calls[0]?.[0]?.[0]?.content ?? ''
    expect(systemPrompt).toContain('it does NOT measure whether every required slot is present')
    expect(systemPrompt).toContain('Whenever you return pendingAction, you MUST also return numeric confidence')
    expect(systemPrompt).toContain('"assistantFeedback":"我收到你的删除确认，将先核对播单现场再写入。"')
    expect(systemPrompt).toContain('Never say a delete, insert, move, or replace has already completed')
    expect(systemPrompt).toContain('queryKind is a TOP-LEVEL field outside slots')
    expect(systemPrompt).toContain('slots.targetTime to the source time and slots.newStartTime to the destination time')
    expect(systemPrompt).toContain('use cancel_pending, not reject')
  })

  it(`${cases.candidateBudget.id}: keeps candidate judgment on the same deadline`, async () => {
    const testCase = cases.candidateBudget
    const candidates = [candidate('candidate-10', 10), candidate('candidate-11', 11)]
    const chat = vi.fn(async () => ({
      content: JSON.stringify({
        candidateId: 'candidate-10',
        decisionType: 'auto_select',
        reasoning: '第10期符合当前顺播基线。',
        considerations: ['顺播连续'],
      }),
    }))
    const deadline = new AgentDeadline()
    const input = {
      userInput: testCase.userInput,
      playlistType: 'tv',
      commandIntent: 'insert',
      candidates,
      context: {},
    } as AgentCandidateJudgeInput

    await new LlmAgentCandidateJudge({ llmClient: { chat } }).selectBestCandidate(input, deadline)

    expect(testCase).toMatchObject({
      expectedDecision: expect.any(String),
      mustNotHappen: expect.any(String),
      verification: expect.any(String),
    })
    expect(STAGE_TIMEOUT_BUDGET.candidate_judge).toBe(90_000)
    const options = chat.mock.calls[0]?.[1]
    expect(options?.timeout).toBeGreaterThan(80_000)
    expect(options?.timeout).toBeLessThanOrEqual(
      STAGE_TIMEOUT_BUDGET.candidate_judge,
    )
    expect(STAGE_RESERVE_BUDGET.after_candidate_judge).toBe(15_000)
    expect(options?.signal).toBe(deadline.signal())
  })
})
