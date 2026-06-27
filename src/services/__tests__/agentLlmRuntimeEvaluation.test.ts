import { describe, expect, it, vi } from 'vitest'

import { evaluateAgentLlmRuntimeCases, evaluateAgentLlmRuntimeConversationCases } from '@/services/agent/llmRuntimeEvaluation'
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

    const report = await evaluateAgentLlmRuntimeCases(interpreter, cases)
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

    const report = await evaluateAgentLlmRuntimeConversationCases(interpreter, cases.map((testCase) => ({
      ...testCase,
      input: {
        ...testCase.input,
        conversationId: testCase.id,
      },
    })))

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
  })
})
