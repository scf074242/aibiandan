import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ScheduleState } from '@/types/orchestration'

vi.mock('@/services/llm/llmClient', () => ({
  getLLMClient: () => ({
    chat: vi.fn(async () => {
      throw new Error('skip llm')
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
        readyCount: 2,
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

describe('DemoRuntimeFacade sequential duration segments', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('会把起播时间加连续时长的话术生成多段版面草案', async () => {
    const facade = new DemoRuntimeFacade()

    const result = await facade.submitInstruction({
      scheduleState: createScheduleState(),
      userInput: '14点先来10分钟导视，再50分钟静安寺直播',
      currentSchedule: [],
      history: [],
    })

    expect(result.kind).toBe('layout_draft')
    if (result.kind !== 'layout_draft') {
      throw new Error('expected layout_draft decision')
    }

    expect(result.draft.coverage).toEqual({
      start: '14:00:00',
      end: '15:00:00',
    })
    expect(result.draft.layoutReference.slots).toHaveLength(2)
    const slotRanges = result.draft.layoutReference.slots.map((slot) => (
      `${slot.startTime.slice(11, 19)}-${slot.endTime.slice(11, 19)}`
    ))
    expect(slotRanges).toEqual([
      '14:00:00-14:10:00',
      '14:10:00-15:00:00',
    ])
    expect(result.draft.columns.map((column) => column.semanticLabel)).toEqual([
      '导视',
      '静安寺直播',
    ])
  })
})
