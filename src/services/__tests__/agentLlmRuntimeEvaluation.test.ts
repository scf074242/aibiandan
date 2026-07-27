import { describe, expect, it, vi } from 'vitest'

import { evaluateAgentLlmRuntimeCases, evaluateAgentLlmRuntimeConversationCases } from '@/services/agent/llmRuntimeEvaluation'
import { AgentDeadline } from '@/services/agent/agentDeadline'
import type { AgentIntentInterpreter } from '@/services/agent/types'
import {
  buildAgentRealLlmConversationEvaluationCases,
  buildAgentRealLlmRuntimeEvaluationCases,
} from './fixtures/agentRealLlmRuntimeCases'

describe('Agent LLM runtime evaluation', () => {
  it('runs the v1.1 end-to-end command loop from structured interpretation to runtime outcome', async () => {
    const cases = await buildAgentRealLlmRuntimeEvaluationCases()
    const interpretationByInput = new Map(cases.map((testCase) => [
      testCase.userInput,
      testCase.offlineInterpretation,
    ]))
    const interpreter: AgentIntentInterpreter = {
      usesLlm: true,
      interpret: vi.fn(async (input) => interpretationByInput.get(input.userInput) ?? null),
    }

    const createDeadline = vi.fn(() => new AgentDeadline())
    const report = await evaluateAgentLlmRuntimeCases(interpreter, cases, { createDeadline })
    const tags = new Set(cases.flatMap((testCase) => testCase.tags ?? []))

    expect(report).toMatchObject({
      total: cases.length,
      passed: cases.length,
      failed: 0,
      passRate: 1,
      llmCallsAttempted: cases.length,
      llmCallsSucceeded: cases.length,
      llmCallsFailed: 0,
    })
    expect(Array.from(tags)).toEqual(expect.arrayContaining([
      'preview',
      'target_occupied',
      'blocked',
      'pending_context',
      'rotation_short_clip',
      'professional_refusal',
      'tv_sequence',
      'missing_param',
    ]))
    expect(report.tagCoverage).toEqual(expect.arrayContaining([
      expect.objectContaining({ tag: 'tv_sequence', total: 1, passed: 1, failed: 0 }),
      expect.objectContaining({ tag: 'rotation_short_clip', total: 1, passed: 1, failed: 0 }),
      expect.objectContaining({ tag: 'target_occupied', total: 2, passed: 2, failed: 0 }),
      expect.objectContaining({ tag: 'professional_refusal', total: 3, passed: 3, failed: 0 }),
      expect.objectContaining({ tag: 'missing_param', total: 1, passed: 1, failed: 0 }),
    ]))
    expect(report.results.every((result) => Boolean(result.result.input.llmContextPackage))).toBe(true)
    expect(report.results.every((result) => result.llmCallsAttempted === 1)).toBe(true)
    expect(createDeadline).toHaveBeenCalledTimes(cases.length)
  })

  it('runs multi-turn conversations through pending context instead of injecting a final pending task', async () => {
    const cases = buildAgentRealLlmConversationEvaluationCases()
    const interpretationByInput = new Map(cases.flatMap((testCase) =>
      testCase.turns.map((turn, index) => [
        `${testCase.id}:${turn.userInput}`,
        testCase.offlineInterpretations[index] ?? null,
      ]),
    ))
    const interpreter: AgentIntentInterpreter = {
      usesLlm: true,
      interpret: vi.fn(async (input) => {
        const conversationId = input.conversationId ?? ''
        return interpretationByInput.get(`${conversationId}:${input.userInput}`) ?? null
      }),
    }

    const createDeadline = vi.fn(() => new AgentDeadline())
    const report = await evaluateAgentLlmRuntimeConversationCases(interpreter, cases.map((testCase) => ({
      ...testCase,
      input: {
        ...testCase.input,
        conversationId: testCase.id,
      },
    })), { createDeadline })

    expect(report).toMatchObject({
      total: cases.length,
      passed: cases.length,
      failed: 0,
      passRate: 1,
      llmCallsAttempted: cases.reduce((total, testCase) => total + testCase.turns.length, 0),
      llmCallsSucceeded: cases.reduce((total, testCase) => total + testCase.turns.length, 0),
      llmCallsFailed: 0,
    })
    expect(report.results.every((result) => result.results.length === 2)).toBe(true)
    expect(report.results.every((result) => result.results[0]?.decision.pendingTask)).toBe(true)
    expect(report.results.every((result) => result.results[1]?.status === 'executed')).toBe(true)
    expect(report.results.every((result) => result.llmCallsAttempted === result.results.length)).toBe(true)
    expect(report.results.every((result) => Boolean(result.results[1]?.input.pendingTask))).toBe(true)
    expect(report.results.every((result) => Boolean(result.results[1]?.input.llmContextPackage))).toBe(true)
    expect(report.tagCoverage).toEqual(expect.arrayContaining([
      expect.objectContaining({ tag: 'pending_context', total: 2, passed: 2, failed: 0 }),
      expect.objectContaining({ tag: 'missing_param', total: 1, passed: 1, failed: 0 }),
      expect.objectContaining({ tag: 'confirm', total: 1, passed: 1, failed: 0 }),
    ]))
    expect(createDeadline).toHaveBeenCalledTimes(cases.reduce((total, testCase) => total + testCase.turns.length, 0))
  })

  /**
   * case real-eval-counts-early-llm-failure
   * - userInput: pending 第二轮的 intent interpreter 在 capability 执行前失败
   * - expectedDecision: 真实评估仍统计该次 attempted/failed，并保留失败结果
   * - mustNotHappen: 因结果没有 auditSummary 而把失败调用统计成“未调用”
   * - verification: 两轮合计 attempted=2、succeeded=1、failed=1
   */
  it('counts an interpreter failure that exits before the capability audit summary is built', async () => {
    const [testCase] = buildAgentRealLlmConversationEvaluationCases()
    let callCount = 0
    const interpreter: AgentIntentInterpreter = {
      usesLlm: true,
      interpret: vi.fn(async () => {
        callCount += 1
        if (callCount === 2) throw new Error('transport timeout')
        return testCase!.offlineInterpretations[0] ?? null
      }),
    }

    const report = await evaluateAgentLlmRuntimeConversationCases(interpreter, [testCase!])

    expect(report).toMatchObject({
      llmCallsAttempted: 2,
      llmCallsSucceeded: 1,
      llmCallsFailed: 1,
    })
    expect(report.results[0]?.results[1]?.status).toBe('failed')
  })
})
