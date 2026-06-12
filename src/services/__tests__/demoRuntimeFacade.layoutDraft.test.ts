import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { LayoutDraft, ScheduleState } from '@/types/orchestration'

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
      mode: 'layout_refine',
      confidence: 0.95,
      reasoning: 'mock layout refine',
      ignoreExistingLayout: false,
      targetTimeRange: {
        start: '23:00:00',
        end: '23:30:00',
      },
      semanticLabel: '两说',
      programTypeHint: undefined,
    })),
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
  gapCount: 1,
  hasSelectedTimeRange: false,
})

const createDraft = (): LayoutDraft => ({
  id: 'draft-1',
  channelId: 'dragon',
  date: '2026-03-25',
  version: 1,
  source: 'channel_default',
  userIntent: '当前版面',
  coverage: {
    start: '06:00:00',
    end: '23:59:59',
  },
  layoutReference: {
    id: 'layout-1',
    name: '测试版面',
    slots: [
      {
        id: 'slot-1',
        channelId: 'dragon',
        startTime: '2026-03-25T17:30:00+08:00',
        endTime: '2026-03-25T18:00:00+08:00',
        columnId: 'runtime-column:ent',
      },
      {
        id: 'slot-2',
        channelId: 'dragon',
        startTime: '2026-03-25T18:30:00+08:00',
        endTime: '2026-03-25T19:00:00+08:00',
        columnId: 'runtime-column:news',
      },
      {
        id: 'slot-3',
        channelId: 'dragon',
        startTime: '2026-03-25T23:00:00+08:00',
        endTime: '2026-03-25T23:30:00+08:00',
        columnId: 'runtime-column:talk',
      },
      {
        id: 'slot-4',
        channelId: 'dragon',
        startTime: '2026-03-25T23:30:00+08:00',
        endTime: '2026-03-25T23:59:59+08:00',
        columnId: 'runtime-column:dream',
      },
    ],
  },
  columns: [
    {
      columnId: 'runtime-column:ent',
      columnName: '东方新娱乐',
      channelId: 'dragon',
      defaultProgramType: 'entertainment',
      semanticLabel: '东方新娱乐',
      source: 'default',
    },
    {
      columnId: 'runtime-column:news',
      columnName: '东方新闻',
      channelId: 'dragon',
      defaultProgramType: 'news',
      semanticLabel: '东方新闻',
      source: 'default',
    },
    {
      columnId: 'runtime-column:talk',
      columnName: '两说',
      channelId: 'dragon',
      defaultProgramType: 'commentary',
      semanticLabel: '两说',
      source: 'default',
    },
    {
      columnId: 'runtime-column:dream',
      columnName: '梦想剧场',
      channelId: 'dragon',
      defaultProgramType: 'drama',
      semanticLabel: '梦想剧场',
      source: 'default',
    },
  ],
})

describe('DemoRuntimeFacade layout draft refine', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('允许在已有空档的草案上删除一个栏目段', async () => {
    const facade = new DemoRuntimeFacade()

    const result = await facade.submitInstruction({
      scheduleState: createScheduleState(),
      userInput: '去掉23点的两说',
      currentSchedule: [],
      currentLayoutDraft: createDraft(),
      currentLayoutDraftMode: 'full_generate',
      history: [],
    })

    expect(result.kind).toBe('layout_draft')
    if (result.kind !== 'layout_draft') {
      throw new Error('expected layout draft decision')
    }

    expect(result.draft.source).toBe('channel_default')
    expect(result.draft.layoutReference.slots.some((slot) => slot.id === 'slot-3')).toBe(false)
    expect(result.draft.warnings?.some((warning) => warning.includes('空档'))).toBe(true)
  })

  it('会把放弃当前草案的上下文命令识别为清空待确认版面', async () => {
    const facade = new DemoRuntimeFacade()

    const result = await facade.submitInstruction({
      scheduleState: createScheduleState(),
      userInput: '不要这个草案',
      currentSchedule: [],
      currentLayoutDraft: createDraft(),
      currentLayoutDraftMode: 'full_generate',
      history: [],
    })

    expect(result.kind).toBe('layout_draft_clear')
    if (result.kind !== 'layout_draft_clear') {
      throw new Error('expected layout draft clear decision')
    }

    expect(result.feedback.content).toContain('已取消')
    expect(result.feedback.details?.draftId).toBe('draft-1')
  })
})
