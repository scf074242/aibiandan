import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ScheduleState } from '@/types/orchestration'

const mockLayoutRecognize = vi.fn()
const mockGenerateSpec = vi.fn()
const mockRefineSpec = vi.fn()

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

vi.mock('@/services/layoutIntentRecognizer', () => ({
  getLayoutIntentRecognizer: () => ({
    recognize: mockLayoutRecognize,
  }),
}))

vi.mock('@/services/layoutDraftService', () => ({
  getLayoutDraftService: () => ({
    generateSpec: mockGenerateSpec,
    refineSpec: mockRefineSpec,
  }),
}))

vi.mock('@/services/layoutDraftFeasibilityService', () => ({
  getLayoutDraftFeasibilityService: () => ({
    previewFeasibility: vi.fn(() => ({
      ok: true,
      summary: {
        readyCount: 0,
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
  gapCount: 0,
  hasSelectedTimeRange: false,
})

describe('DemoRuntimeFacade full generate bootstrap', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('空表全天编排命中频道版面时直接复用现有草案，不走 refineSpec', async () => {
    mockLayoutRecognize.mockResolvedValue({
      mode: 'layout_prepare',
      confidence: 0.93,
      reasoning: 'start orchestration from current layout',
      ignoreExistingLayout: false,
      targetTimeRange: {
        start: '06:00:00',
        end: '23:59:59',
      },
    })

    const facade = new DemoRuntimeFacade()
    const result = await facade.submitInstruction({
      scheduleState: createScheduleState(),
      userInput: '帮我填充全天节目',
      currentSchedule: [],
      history: [],
    })

    expect(result.kind).toBe('layout_draft')
    if (result.kind !== 'layout_draft') {
      throw new Error('expected layout_draft decision')
    }

    expect(result.feedback.content).toContain('已命中当前频道版面参考')
    expect(result.draft.source).toBe('channel_default')
    expect(mockRefineSpec).not.toHaveBeenCalled()
    expect(mockGenerateSpec).not.toHaveBeenCalled()
  })
})
