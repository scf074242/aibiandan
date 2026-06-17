import { describe, expect, it } from 'vitest'

import { buildAgentRealLlmEvaluationCases } from './fixtures/agentRealLlmEvaluationCases'

describe('Agent real LLM evaluation cases', () => {
  it('covers the v1.1 acceptance boundaries before running a real model', async () => {
    const cases = await buildAgentRealLlmEvaluationCases()
    const tags = new Set(cases.flatMap((testCase) => testCase.tags ?? []))

    expect(cases.length).toBeGreaterThanOrEqual(20)
    expect(Array.from(tags)).toEqual(expect.arrayContaining([
      'move',
      'insert',
      'replace',
      'delete',
      'batch_move',
      'batch_delete',
      'query',
      'validate',
      'tv_sequence',
      'rotation_short_clip',
      'pending_context',
      'missing_param',
      'target_occupied',
      'professional_refusal',
      'confirm',
      'cancel',
      'start_new_task',
    ]))
    expect(cases.some((testCase) => testCase.input.pendingTask?.phase === 'needs_clarification')).toBe(true)
    expect(cases.some((testCase) => testCase.input.pendingTask?.phase === 'needs_confirmation')).toBe(true)
    expect(cases.every((testCase) => testCase.input.llmContextPackage)).toBe(true)
    expect(cases.every((testCase) =>
      testCase.input.llmContextPackage?.guardrails.some((guardrail) =>
        guardrail.includes('occupied destination'),
      ),
    )).toBe(true)
    expect(cases.every((testCase) =>
      testCase.input.llmContextPackage?.guardrails.some((guardrail) =>
        guardrail.includes('layout drafts, full-day auto scheduling, and multi-user collaboration are out of scope'),
      ),
    )).toBe(true)

    const tvSequenceCase = cases.find((testCase) => testCase.id === 'insert-tv-next-episode')
    expect(tvSequenceCase?.input.llmContextPackage?.currentSchedule).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ issueNo: '1030' }),
      ]),
    )
    expect(tvSequenceCase?.input.llmContextPackage?.latestHistory?.samples).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ issueNo: '1030' }),
      ]),
    )
    expect(tvSequenceCase?.input.llmContextPackage?.candidateSummary).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ issueNo: '1031' }),
      ]),
    )

    const rotationShortClipCase = cases.find((testCase) => testCase.id === 'insert-rotation-short-clip')
    expect(rotationShortClipCase?.input.llmContextPackage?.candidateSummary).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          candidateId: 'asset-short-city-flower',
          programCode: '',
          programType: 'short_clip',
        }),
      ]),
    )
  })
})
