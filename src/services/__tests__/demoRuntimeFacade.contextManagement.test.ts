import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { LayoutDraft, ScheduleState } from '@/types/orchestration'
import type { RuntimePendingAtomicContext } from '@/services/runtime/pendingAtomicContext'

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

const createScheduleState = (overrides: Partial<ScheduleState> = {}): ScheduleState => ({
  channelId: 'dragon',
  channelName: '东方卫视',
  date: '2026-03-25',
  isEmpty: true,
  itemCount: 0,
  gapCount: 1,
  hasSelectedTimeRange: false,
  ...overrides,
})

const createLiveDraft = (): LayoutDraft => ({
  id: 'live-draft-1',
  channelId: 'dragon',
  date: '2026-03-25',
  version: 1,
  source: 'generated',
  userIntent: '静安寺外场直播播单',
  coverage: {
    start: '14:00:00',
    end: '15:00:00',
  },
  layoutReference: {
    id: 'live-layout-1',
    name: '直播草案',
    slots: [
      {
        id: 'slot-live',
        channelId: 'dragon',
        startTime: '2026-03-25T14:00:00+08:00',
        endTime: '2026-03-25T15:00:00+08:00',
        columnId: 'runtime-column:live',
      },
    ],
  },
  columns: [
    {
      columnId: 'runtime-column:live',
      columnName: '静安寺外场直播',
      channelId: 'dragon',
      defaultProgramType: 'news_magazine',
      semanticLabel: '静安寺外场直播',
      queryHints: ['静安寺', '外场直播', '直播'],
      source: 'generated',
    },
  ],
})

const createPendingAtomicContext = (): RuntimePendingAtomicContext => ({
  action: 'insert',
  phase: 'clarifying',
  summary: '请补充要插入的节目和时间',
  reasoning: '用户只说了插入，但缺少完整参数。',
  originalUserInput: '9点插入',
  collectedUserInput: '9点插入',
  slots: {
    targetTimeHint: '09:00:00',
  },
  missingFields: ['program_name'],
  followUpQuestion: '请补充要插入的节目名称。',
  attemptCount: 0,
  createdAt: '2026-04-15T10:00:00.000Z',
  updatedAt: '2026-04-15T10:00:00.000Z',
  expiresAt: '2099-04-16T16:13:00.000Z',
})

describe('DemoRuntimeFacade context management', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('确认前的短句会承接当前版面草案做微调，不直接改实际节目单', async () => {
    const facade = new DemoRuntimeFacade()

    const result = await facade.submitInstruction({
      scheduleState: createScheduleState(),
      userInput: '就按刚才那个主题加一点预热',
      currentSchedule: [],
      currentLayoutDraft: createLiveDraft(),
      currentLayoutDraftMode: 'full_generate',
      history: ['用户：麻烦来个14-15点静安寺外场直播播单'],
    })

    expect(result.kind).toBe('layout_draft')
    if (result.kind !== 'layout_draft') {
      throw new Error('expected layout_draft decision')
    }

    expect(result.orchestrationMode).toBe('full_generate')
    expect(result.draft.coverage).toEqual({
      start: '14:00:00',
      end: '15:00:00',
    })
    expect(result.draft.columns[0]?.semanticLabel).toBe('预热')
    expect(result.draft.columns[0]?.defaultProgramType).toBe('news_magazine')
  })

  it('确认前的短确认会提交当前版面草案进入实际编排', async () => {
    const facade = new DemoRuntimeFacade()
    const draft = createLiveDraft()

    const result = await facade.submitInstruction({
      scheduleState: createScheduleState(),
      userInput: '可以了',
      currentSchedule: [],
      currentLayoutDraft: draft,
      currentLayoutDraftMode: 'full_generate',
      history: ['用户：麻烦来个14-15点静安寺外场直播播单', '助手：已根据你的要求生成版面草案。'],
    })

    expect(result.kind).toBe('layout_commit')
    if (result.kind !== 'layout_commit') {
      throw new Error('expected layout_commit decision')
    }

    expect(result.draft).toBe(draft)
    expect(result.orchestrationRequest.mode).toBe('full_generate')
    expect(result.orchestrationRequest.layoutDraft).toBe(draft)
  })

  it.each([
    '就按这个生成正式编排单',
    '把这份草案落到节目单里',
    '确认并输出编排单',
    '按这个执行',
  ])('确认前的编排产物口语“%s”会提交草案进入实际编排', async (userInput) => {
    const facade = new DemoRuntimeFacade()
    const draft = createLiveDraft()

    const result = await facade.submitInstruction({
      scheduleState: createScheduleState(),
      userInput,
      currentSchedule: [],
      currentLayoutDraft: draft,
      currentLayoutDraftMode: 'full_generate',
      history: ['用户：麻烦来个14-15点静安寺外场直播播单', '助手：已根据你的要求生成版面草案。'],
    })

    expect(result.kind).toBe('layout_commit')
    if (result.kind !== 'layout_commit') {
      throw new Error('expected layout_commit decision')
    }

    expect(result.draft).toBe(draft)
    expect(result.orchestrationRequest.mode).toBe('full_generate')
    expect(result.orchestrationRequest.layoutDraft).toBe(draft)
  })

  it('放弃当前草案并重做的复合表达会生成新的待确认草案', async () => {
    const facade = new DemoRuntimeFacade()

    const result = await facade.submitInstruction({
      scheduleState: createScheduleState(),
      userInput: '这个草案不要了，重新做晚间新闻',
      currentSchedule: [],
      currentLayoutDraft: createLiveDraft(),
      currentLayoutDraftMode: 'full_generate',
      history: ['用户：麻烦来个14-15点静安寺外场直播播单', '助手：已根据你的要求生成版面草案。'],
    })

    expect(result.kind).toBe('layout_draft')
    if (result.kind !== 'layout_draft') {
      throw new Error('expected layout_draft decision')
    }

    expect(result.draft.coverage).toEqual({
      start: '18:00:00',
      end: '23:00:00',
    })
    expect(result.draft.columns[0]?.defaultProgramType).toBe('news')
    expect(result.draft.columns[0]?.semanticLabel).toBe('新闻')
    expect(result.draft.source).toBe('generated')
  })

  it('新的编排类自然语言会打断旧原子补参上下文并生成版面草案', async () => {
    const facade = new DemoRuntimeFacade()

    const result = await facade.submitInstruction({
      scheduleState: createScheduleState({
        isEmpty: false,
        itemCount: 1,
      }),
      userInput: '麻烦来个14-15点静安寺外场直播播单',
      currentSchedule: [
        {
          id: 'item-0900',
          programName: '看东方',
          startTime: '09:00:00',
          endTime: '10:00:00',
          duration: 3600,
          programType: 'news',
        },
      ],
      pendingAtomicContext: createPendingAtomicContext(),
      history: ['用户：9点插入', '助手：请补充要插入的节目名称。'],
    })

    expect(result.kind).toBe('layout_draft')
    if (result.kind !== 'layout_draft') {
      throw new Error('expected layout_draft decision')
    }

    expect(result.orchestrationMode).toBe('partial_generate')
    expect(result.draft.coverage).toEqual({
      start: '14:00:00',
      end: '15:00:00',
    })
    expect(result.draft.columns[0]?.semanticLabel).toContain('静安寺')
    expect(result.draft.columns[0]?.defaultProgramType).toBe('news_magazine')
  })

  it('确认编排后没有草案上下文时会基于实际节目单继续做局部补排', async () => {
    const facade = new DemoRuntimeFacade()

    const result = await facade.submitInstruction({
      scheduleState: createScheduleState({
        isEmpty: false,
        itemCount: 2,
        gapCount: 1,
      }),
      userInput: '保留现有上午节目，下午补齐电视剧',
      currentSchedule: [
        {
          id: 'item-0600',
          programName: '东方快报',
          startTime: '06:00:00',
          endTime: '07:00:00',
          duration: 3600,
          programType: 'news',
        },
        {
          id: 'item-0900',
          programName: '看东方',
          startTime: '09:00:00',
          endTime: '10:00:00',
          duration: 3600,
          programType: 'news_magazine',
        },
      ],
      currentLayoutDraft: null,
      currentLayoutDraftMode: null,
      history: [
        '用户：上午新闻',
        '助手：已确认当前版面草案，准备按该版面开始编排。',
        '助手：已完成上午新闻编排。',
      ],
    })

    expect(result.kind).toBe('layout_draft')
    if (result.kind !== 'layout_draft') {
      throw new Error('expected layout_draft decision')
    }

    expect(result.orchestrationMode).toBe('partial_generate')
    expect(result.draft.coverage).toEqual({
      start: '13:00:00',
      end: '18:00:00',
    })
    expect(result.draft.columns[0]?.defaultProgramType).toBe('drama')
    expect(result.draft.userIntent).toBe('保留现有上午节目，下午补齐电视剧')
  })
})
