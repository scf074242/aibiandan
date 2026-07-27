import { describe, expect, it, vi } from 'vitest'

import { evaluateAgentLlmIntentCases } from '@/services/agent/llmIntentEvaluation'
import { AgentDeadline } from '@/services/agent/agentDeadline'
import type { AgentIntentInterpreter } from '@/services/agent/types'

describe('Agent LLM intent evaluation', () => {
  it('records one transport failure and continues evaluating later cases', async () => {
    const interpreter: AgentIntentInterpreter = {
      usesLlm: true,
      interpret: vi.fn(async (input) => {
        if (input.userInput === 'first') {
          throw new Error('LLM request timed out')
        }
        return {
          intent: 'delete',
          confidence: 0.95,
          source: 'llm',
          slots: { targetProgramName: 'Morning Anchor' },
        }
      }),
    }

    const report = await evaluateAgentLlmIntentCases(interpreter, [
      {
        id: 'transport-failure',
        userInput: 'first',
        input: { channelId: 'dragon', date: '2026-03-25' },
        expected: { intent: 'insert' },
      },
      {
        id: 'later-case',
        userInput: 'second',
        input: { channelId: 'dragon', date: '2026-03-25' },
        expected: { intent: 'delete', requiredSlotKeys: ['targetProgramName'] },
      },
    ])

    expect(report).toMatchObject({ total: 2, passed: 1, failed: 1, passRate: 0.5 })
    expect(report.results[0]).toMatchObject({
      id: 'transport-failure',
      passed: false,
      interpretation: null,
      failures: ['interpretation error: LLM request timed out'],
    })
    expect(report.results[1]).toMatchObject({ id: 'later-case', passed: true, failures: [] })
    expect(interpreter.interpret).toHaveBeenCalledTimes(2)
  })

  it('reports pass rate and per-case failures for structured LLM interpretation', async () => {
    const interpreter: AgentIntentInterpreter = {
      usesLlm: true,
      interpret: vi.fn(async (input) => {
        if (input.userInput.includes('delete')) {
          return {
            intent: 'delete',
            confidence: 0.91,
            source: 'llm',
            slots: { targetProgramName: 'Morning Anchor' },
          }
        }
        return {
          intent: 'move',
          confidence: 0.94,
          source: 'llm',
          slots: { targetProgramName: 'Morning Anchor' },
        }
      }),
    }

    const createDeadline = vi.fn(() => new AgentDeadline())
    const report = await evaluateAgentLlmIntentCases(interpreter, [
      {
        id: 'move-with-missing-destination',
        tags: ['move', 'target_occupied'],
        userInput: 'move Morning Anchor to 10',
        input: { channelId: 'dragon', date: '2026-03-25' },
        expected: {
          intent: 'move',
          requiredSlotKeys: ['targetProgramName', 'newStartTime'],
          minConfidence: 0.8,
        },
      },
      {
        id: 'delete-program-name',
        tags: ['delete'],
        userInput: 'delete Morning Anchor',
        input: { channelId: 'dragon', date: '2026-03-25' },
        expected: {
          intent: 'delete',
          requiredSlotKeys: ['targetProgramName'],
          minConfidence: 0.8,
        },
      },
    ], { createDeadline })

    expect(report).toMatchObject({
      total: 2,
      passed: 1,
      failed: 1,
      passRate: 0.5,
      tagCoverage: [
        { tag: 'delete', total: 1, passed: 1, failed: 0 },
        { tag: 'move', total: 1, passed: 0, failed: 1 },
        { tag: 'target_occupied', total: 1, passed: 0, failed: 1 },
      ],
    })
    expect(report.results).toEqual([
      expect.objectContaining({
        id: 'move-with-missing-destination',
        passed: false,
        failures: ['missing slot newStartTime'],
      }),
      expect.objectContaining({
        id: 'delete-program-name',
        passed: true,
        failures: [],
      }),
    ])
    expect(createDeadline).toHaveBeenCalledTimes(2)
    const deadlines = vi.mocked(interpreter.interpret).mock.calls.map((call) => call[1])
    expect(deadlines[0]).toBeInstanceOf(AgentDeadline)
    expect(deadlines[1]).toBeInstanceOf(AgentDeadline)
    expect(deadlines[0]).not.toBe(deadlines[1])
  })
})
