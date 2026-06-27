import { describe, expect, it, vi } from 'vitest'

import type { ScheduleState } from '@/types/orchestration'

vi.mock('@/services/llm/llmClient', () => ({
  getLLMClient: () => ({}),
}))

vi.mock('@/services/llm/taskClassifier', () => ({
  getTaskClassifier: () => ({
    classify: vi.fn(async () => ({
      mode: 'clarify',
      confidence: 0.1,
      reasoning: 'unused',
    })),
  }),
}))

vi.mock('@/services/intentRecognizer', () => ({
  getIntentRecognizer: () => ({
    recognize: vi.fn(async () => ({
      type: 'unsupported',
      confidence: 0.1,
      reasoning: 'not an atomic command',
    })),
  }),
}))

vi.mock('@/services/paramExtractor', () => ({
  getParamExtractor: () => ({
    extractInsertParams: vi.fn(async () => null),
    extractDeleteParams: vi.fn(async () => null),
    extractMoveParams: vi.fn(async () => null),
    extractReplaceParams: vi.fn(async () => null),
  }),
}))

import { DemoRuntimeFacade } from '@/services/runtime/demoRuntimeFacade'

const createScheduleState = (): ScheduleState => ({
  channelId: 'dragon',
  channelName: '东方卫视',
  date: '2026-03-25',
  isEmpty: true,
  itemCount: 0,
  gapCount: 1,
  hasSelectedTimeRange: false,
})

describe('DemoRuntimeFacade history-backed layout feasibility', () => {
  it('loads previous-day sequence progress into a pure TV channel draft preview', async () => {
    const facade = new DemoRuntimeFacade()

    const result = await facade.submitInstruction({
      scheduleState: createScheduleState(),
      userInput: '按纯电视频道，09:30到10:15继续播品质剧场：纵有疾风起，接昨天进度顺播',
      currentSchedule: [],
      history: [],
    })

    expect(result.kind).toBe('layout_draft')
    if (result.kind !== 'layout_draft') {
      throw new Error('expected layout draft decision')
    }

    expect(result.draft.strategyProfile?.kind).toBe('tv_channel')
    expect(result.draft.strategyProfile?.requiresPreviousSchedule).toBe(true)
    expect(result.feasibilityReport.segments[0]?.expectedSequenceNo).toBe(5)
    expect(result.feasibilityReport.segments[0]?.historyReferenceDate).toBe('2026-03-24')
    expect(result.feasibilityReport.segments[0]?.historyContextSummary).toContain('第4集')
    expect(result.feasibilityReport.segments[0]?.historyContextSummary).toContain('第5集')
  })
})
