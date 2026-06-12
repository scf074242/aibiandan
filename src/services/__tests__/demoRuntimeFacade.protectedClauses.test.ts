import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ScheduleState } from '@/types/orchestration'

vi.mock('@/services/llm/llmClient', () => ({
  getLLMClient: () => ({
    chat: vi.fn(async () => {
      throw new Error('mock llm unavailable')
    }),
  }),
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

vi.mock('@/services/layoutDraftFeasibilityService', () => ({
  getLayoutDraftFeasibilityService: () => ({
    previewFeasibility: vi.fn(() => ({
      ok: true,
      summary: {
        readyCount: 1,
        warningCount: 0,
        blockedCount: 0,
      },
      segments: [],
    })),
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

describe('DemoRuntimeFacade protected scheduling clauses', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('保留性子句不参与本轮版面目标范围识别', async () => {
    const facade = new DemoRuntimeFacade()

    const result = await facade.submitInstruction({
      scheduleState: createScheduleState(),
      userInput: '保留上午节目，下午补齐电视剧',
      currentSchedule: [],
      history: [],
    })

    expect(result.kind).toBe('layout_draft')
    if (result.kind !== 'layout_draft') {
      throw new Error('expected layout draft decision')
    }

    expect(result.draft.coverage).toEqual({
      start: '13:00:00',
      end: '18:00:00',
    })
    expect(result.draft.layoutReference.slots).toHaveLength(1)
    expect(result.draft.layoutReference.slots[0]?.startTime).toContain('T13:00:00')
    expect(result.draft.layoutReference.slots[0]?.endTime).toContain('T18:00:00')
    expect(result.draft.columns[0]?.defaultProgramType).toBe('drama')
  })
})
