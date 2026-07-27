import { describe, expect, it, vi } from 'vitest'

import { ExplainInterfaces, EXPLAIN_INTERFACES_PROMPT_VERSION } from '@/services/orchestration/interfaces/explainInterfaces'

describe('ExplainInterfaces promptVersion 透传', () => {
  /**
   * case c16-explain-interfaces-passes-version
   * - expectedDecision: explainCandidateSelection 调用 LLM 时透传 promptVersion + traceLabel
   * - mustNotHappen: options 缺失 promptVersion 或 traceLabel
   * - verification: chat.mock.calls[0][1] 含 promptVersion + traceLabel: 'candidate_explanation'
   */
  it('c16-explain-interfaces-passes-version: explainCandidateSelection 透传 promptVersion', async () => {
    const chat = vi.fn(async () => ({ content: '选择该节目是因为时长匹配且类型合适。' }))
    const dataService = {
      getProgramDetails: vi.fn(async () => ({
        id: 'c-1',
        programName: '测试节目',
        programCode: 'P001',
        duration: 1800,
        programType: 'commentary',
      })),
    }
    const explain = new ExplainInterfaces({ chat } as never, dataService as never)

    await explain.explainCandidateSelection('c-1', { gapDuration: 1800 })

    expect(chat).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        promptVersion: EXPLAIN_INTERFACES_PROMPT_VERSION,
        traceLabel: 'candidate_explanation',
      }),
    )
  })
})
