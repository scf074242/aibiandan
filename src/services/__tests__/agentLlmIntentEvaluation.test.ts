import { describe, expect, it, vi } from 'vitest'

import { evaluateAgentLlmIntentCases } from '@/services/agent/llmIntentEvaluation'
import type { AgentIntentInterpreter } from '@/services/agent/types'

describe('Agent LLM intent evaluation', () => {
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
    ])

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
  })
})
