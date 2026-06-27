import { beforeEach, describe, expect, it, vi } from 'vitest'

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

vi.mock('@/services/layoutIntentRecognizer', () => ({
  getLayoutIntentRecognizer: () => ({
    recognize: vi.fn(async () => ({
      mode: 'layout_prepare',
      confidence: 0.96,
      reasoning: 'mock multi-segment layout prepare',
      ignoreExistingLayout: true,
      targetTimeRange: {
        start: '06:00:00',
        end: '23:00:00',
      },
      segments: [
        {
          start: '06:00:00',
          end: '12:00:00',
          semanticLabel: '新闻',
          programTypeHint: 'news',
        },
        {
          start: '13:00:00',
          end: '18:00:00',
          semanticLabel: '剧场',
          programTypeHint: 'drama',
        },
        {
          start: '18:00:00',
          end: '23:00:00',
          semanticLabel: '综艺',
          programTypeHint: 'entertainment',
        },
      ],
    })),
  }),
}))

vi.mock('@/services/layoutDraftFeasibilityService', () => ({
  getLayoutDraftFeasibilityService: () => ({
    previewFeasibility: vi.fn(() => ({
      ok: true,
      summary: {
        readyCount: 3,
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

describe('DemoRuntimeFacade multi segment layout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('会按 segments 生成多段版面草案', async () => {
    const facade = new DemoRuntimeFacade()

    const result = await facade.submitInstruction({
      scheduleState: createScheduleState(),
      userInput: '上午新闻，下午剧场，晚间综艺',
      currentSchedule: [],
      history: [],
    })

    expect(result.kind).toBe('layout_draft')
    if (result.kind !== 'layout_draft') {
      throw new Error('expected layout_draft decision')
    }

    expect(result.draft.layoutReference.slots).toHaveLength(3)
    expect(result.draft.coverage).toEqual({
      start: '06:00:00',
      end: '23:00:00',
    })
    expect(result.draft.columns.map((column) => column.semanticLabel)).toEqual([
      '新闻',
      '剧场',
      '综艺',
    ])
    expect(result.draft.columns.map((column) => column.defaultProgramType)).toEqual([
      'news',
      'drama',
      'entertainment',
    ])
  })
})
