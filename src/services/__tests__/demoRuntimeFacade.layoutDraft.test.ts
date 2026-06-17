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

describe('DemoRuntimeFacade explicit range layout routing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('routes explicit time-range scheduling intent to a layout draft instead of atomic insert clarification', async () => {
    const facade = new DemoRuntimeFacade()

    const result = await facade.submitInstruction({
      scheduleState: createScheduleState(),
      userInput: '12:45到13:00安排生命树电视剧',
      currentSchedule: [],
      history: [],
    })

    expect(result.kind).toBe('layout_draft')
    if (result.kind !== 'layout_draft') {
      throw new Error('expected layout draft decision')
    }

    expect(result.draft.coverage).toEqual({ start: '12:45:00', end: '13:00:00' })
    expect(result.draft.columns[0]?.semanticLabel).toContain('生命树')
    expect(result.feedback.details?.orchestrationMode).toBe('full_generate')
  })

  it('front foreground mode blocks layout drafts and asks for atomic scheduling details', async () => {
    const facade = new DemoRuntimeFacade()

    const result = await facade.submitInstruction({
      scheduleState: createScheduleState(),
      userInput: '12:45到13:00安排生命树电视剧',
      currentSchedule: [],
      history: [],
      agentCoreEnabled: true,
      layoutDraftEnabled: false,
    })

    expect(result.kind).toBe('message')
    if (result.kind !== 'message') {
      throw new Error('expected layout draft disabled message')
    }

    expect(result.statusHint).toBe('needs_clarification')
    expect(result.feedback.content).toContain('具体节目')
    expect(result.feedback.content).toContain('目标位置')
    expect(result.feedback.content).toContain('插入、删除、移动、替换、查询或校验')
    expect(result.feedback.content).not.toContain('版面草案')
    expect(result.feedback.details).not.toHaveProperty('disabledFlows')
    expect(result.feedback.details?.foregroundPolicy).toBe('atomic_commands_only')
    expect(result.feedback.details?.supportedAtomicActions).toContain('insert')
  })

  it('splits multiple explicit time ranges before creating the layout draft', async () => {
    const facade = new DemoRuntimeFacade()

    const result = await facade.submitInstruction({
      scheduleState: createScheduleState(),
      userInput: '按纯电视频道，09:00到12:00继续播品质剧场：纵有疾风起，接昨天进度顺播；12:00到12:30安排午间新闻',
      currentSchedule: [],
      history: [],
    })

    expect(result.kind).toBe('layout_draft')
    if (result.kind !== 'layout_draft') {
      throw new Error('expected layout draft decision')
    }

    expect(result.draft.coverage).toEqual({ start: '09:00:00', end: '12:30:00' })
    expect(result.draft.layoutReference.slots).toHaveLength(2)
    expect(result.draft.layoutReference.slots.map((slot) => [
      slot.startTime.slice(11, 19),
      slot.endTime.slice(11, 19),
    ])).toEqual([
      ['09:00:00', '12:00:00'],
      ['12:00:00', '12:30:00'],
    ])
    expect(result.draft.columns[0]).toMatchObject({
      defaultProgramType: 'drama',
      semanticLabel: '品质剧场：纵有疾风起',
      isSequential: true,
    })
    expect(result.draft.columns[1]).toMatchObject({
      defaultProgramType: 'news',
      semanticLabel: '午间新闻',
    })
    expect(result.draft.strategyProfile?.kind).toBe('tv_channel')
    expect(result.draft.strategyProfile?.selectionPriority).toBe('sequence')
  })

  it('marks outdoor live carousel drafts as content-match-first when the user asks for matching content', async () => {
    const facade = new DemoRuntimeFacade()

    const result = await facade.submitInstruction({
      scheduleState: createScheduleState(),
      userInput: '我准备在静安寺进行户外直播，准备一个14:00到15:00的轮播单，内容匹配优先',
      currentSchedule: [],
      history: [],
    })

    expect(result.kind).toBe('layout_draft')
    if (result.kind !== 'layout_draft') {
      throw new Error('expected layout draft decision')
    }

    expect(result.draft.strategyProfile?.kind).toBe('carousel')
    expect(result.draft.strategyProfile?.selectionPriority).toBe('content_match')
    expect(result.draft.strategyProfile?.strategyBasis).toBe('content_match')
    expect(result.draft.strategyProfile?.requiresPreviousSchedule).toBe(false)
    expect(result.draft.strategyProfile?.selectionRules).toEqual(expect.arrayContaining([
      expect.stringContaining('节目内容'),
      expect.stringContaining('不沿用昨日顺播进度'),
    ]))
    expect(result.draft.strategyProfile?.contextSummary).toContain('独立选片')
    expect(result.draft.columns.every((column) => column.selectionPolicy?.primary === 'content_match')).toBe(true)
    expect(result.draft.columns[0]?.queryHints).toEqual(expect.arrayContaining(['轮播单', '内容匹配优先']))
  })

  it('cleans explicit range carousel labels and keeps searchable outdoor live hints', async () => {
    const facade = new DemoRuntimeFacade()

    const result = await facade.submitInstruction({
      scheduleState: createScheduleState(),
      userInput: '我准备在静安寺进行户外直播，准备一个14:00到15:00的轮播单',
      currentSchedule: [],
      history: [],
    })

    expect(result.kind).toBe('layout_draft')
    if (result.kind !== 'layout_draft') {
      throw new Error('expected layout draft decision')
    }

    expect(result.draft.coverage).toEqual({ start: '14:00:00', end: '15:00:00' })
    expect(result.draft.columns[0]?.semanticLabel).toBe('静安寺户外直播')
    expect(result.draft.columns[0]?.defaultProgramType).toBe('news_magazine')
    expect(result.draft.columns[0]?.queryHints).toEqual(expect.arrayContaining([
      '静安寺户外直播',
      '静安寺',
      '直播',
      '外场直播',
    ]))
    expect(result.draft.columns[0]?.queryHints).not.toEqual(expect.arrayContaining(['一个的']))
    expect(result.draft.strategyProfile?.kind).toBe('carousel')
    expect(result.draft.strategyProfile?.selectionPriority).toBe('content_match')
  })

  it('marks carousel drafts as rating-first when the user asks for rating priority', async () => {
    const facade = new DemoRuntimeFacade()

    const result = await facade.submitInstruction({
      scheduleState: createScheduleState(),
      userInput: '14:00到15:00做一版轮播单，优先选择高收视率节目',
      currentSchedule: [],
      history: [],
    })

    expect(result.kind).toBe('layout_draft')
    if (result.kind !== 'layout_draft') {
      throw new Error('expected layout draft decision')
    }

    expect(result.draft.strategyProfile?.kind).toBe('carousel')
    expect(result.draft.strategyProfile?.selectionPriority).toBe('rating')
    expect(result.draft.strategyProfile?.selectionRules).toEqual(expect.arrayContaining([
      expect.stringContaining('收视率'),
      expect.stringContaining('关键词不符'),
    ]))
    expect(result.draft.strategyProfile?.strategyBasis).toBe('rating')
    expect(result.draft.strategyProfile?.selectionSummary).toContain('收视率')
    expect(result.draft.columns.every((column) => column.selectionPolicy?.primary === 'rating')).toBe(true)
    expect(result.draft.columns[0]?.queryHints).toEqual(expect.arrayContaining(['轮播单', '收视率优先']))
  })

  it('marks carousel drafts as trending-first when the user asks for currently hot programs', async () => {
    const facade = new DemoRuntimeFacade()

    const result = await facade.submitInstruction({
      scheduleState: createScheduleState(),
      userInput: '14:00到15:00做一版轮播单，优先选择当前热播节目',
      currentSchedule: [],
      history: [],
    })

    expect(result.kind).toBe('layout_draft')
    if (result.kind !== 'layout_draft') {
      throw new Error('expected layout draft decision')
    }

    expect(result.draft.strategyProfile?.kind).toBe('carousel')
    expect(result.draft.strategyProfile?.selectionPriority).toBe('trending')
    expect(result.draft.strategyProfile?.strategyBasis).toBe('trending')
    expect(result.draft.strategyProfile?.selectionSummary).toContain('热播')
    expect(result.draft.strategyProfile?.selectionRules).toEqual(expect.arrayContaining([
      expect.stringContaining('舆论'),
      expect.stringContaining('话题热度'),
    ]))
    expect(result.draft.columns.every((column) => column.selectionPolicy?.primary === 'trending')).toBe(true)
    expect(result.draft.columns[0]?.queryHints).toEqual(expect.arrayContaining(['轮播单', '热播优先']))
  })

  it('marks pure TV channel drafts as sequence-first and requiring previous-day schedule context', async () => {
    const facade = new DemoRuntimeFacade()

    const result = await facade.submitInstruction({
      scheduleState: createScheduleState(),
      userInput: '按纯电视频道编排，09:30到10:15品质剧场顺着昨天继续播',
      currentSchedule: [],
      history: [],
    })

    expect(result.kind).toBe('layout_draft')
    if (result.kind !== 'layout_draft') {
      throw new Error('expected layout draft decision')
    }

    expect(result.draft.strategyProfile?.kind).toBe('tv_channel')
    expect(result.draft.strategyProfile?.selectionPriority).toBe('sequence')
    expect(result.draft.strategyProfile?.strategyBasis).toBe('previous_schedule_sequence')
    expect(result.draft.strategyProfile?.requiresPreviousSchedule).toBe(true)
    expect(result.draft.strategyProfile?.referenceDate).toBe('2026-03-24')
    expect(result.draft.strategyProfile?.selectionRules).toEqual(expect.arrayContaining([
      expect.stringContaining('2026-03-24'),
      expect.stringContaining('跳集'),
      expect.stringContaining('倒序'),
    ]))
    expect(result.draft.strategyProfile?.contextSummary).toContain('2026-03-24')
    expect(result.draft.columns.every((column) => column.selectionPolicy?.requiresPreviousSchedule)).toBe(true)
    expect(result.draft.columns[0]?.queryHints).toEqual(expect.arrayContaining(['纯电视频道', '顺播', '接昨天']))
  })

  it('treats middle-gap episode fill wording as pure TV sequence context', async () => {
    const facade = new DemoRuntimeFacade()

    const result = await facade.submitInstruction({
      scheduleState: createScheduleState(),
      userInput: '按纯电视频道，09:45到10:30继续播品质剧场：纵有疾风起，顺着当前版面补中间集',
      currentSchedule: [],
      history: [],
    })

    expect(result.kind).toBe('layout_draft')
    if (result.kind !== 'layout_draft') {
      throw new Error('expected layout draft decision')
    }

    expect(result.draft.coverage).toEqual({ start: '09:45:00', end: '10:30:00' })
    expect(result.draft.strategyProfile?.kind).toBe('tv_channel')
    expect(result.draft.strategyProfile?.selectionPriority).toBe('sequence')
    expect(result.draft.strategyProfile?.requiresPreviousSchedule).toBe(true)
    expect(result.draft.columns[0]?.defaultProgramType).toBe('drama')
    expect(result.draft.columns[0]?.selectionPolicy?.primary).toBe('sequence')
    expect(result.draft.columns[0]?.queryHints?.join(' ')).toContain('纵有疾风起')
    expect(result.draft.columns[0]?.queryHints?.join(' ')).not.toContain('补中间集')
  })

  it.each([
    {
      userInput: '下午以城市服务为主',
      coverage: { start: '13:00:00', end: '18:00:00' },
      label: '城市服务',
    },
    {
      userInput: '黄金档主打综艺',
      coverage: { start: '19:00:00', end: '20:00:00' },
      label: '综艺',
    },
    {
      userInput: '晚间民生新闻多一点',
      coverage: { start: '18:00:00', end: '23:00:00' },
      label: '民生新闻',
    },
  ])('routes daypart segment intent to a layout draft without relying on LLM: $userInput', async ({ userInput, coverage, label }) => {
    const facade = new DemoRuntimeFacade()

    const result = await facade.submitInstruction({
      scheduleState: createScheduleState(),
      userInput,
      currentSchedule: [],
      history: [],
    })

    expect(result.kind).toBe('layout_draft')
    if (result.kind !== 'layout_draft') {
      throw new Error('expected layout draft decision')
    }

    expect(result.draft.coverage).toEqual(coverage)
    expect(result.draft.columns[0]?.semanticLabel).toContain(label)
    expect(result.feedback.details?.orchestrationMode).toBe('full_generate')
  })

  it.each([
    {
      userInput: '发布会开播前垫一点现场导视',
      coverage: { start: '18:00:00', end: '23:00:00' },
      label: '现场导视',
      programType: 'news_magazine',
    },
    {
      userInput: '赛前给赛事直播加一段预热',
      coverage: { start: '18:00:00', end: '23:00:00' },
      label: '赛事预热',
      programType: 'news_magazine',
    },
    {
      userInput: '黄金档前后加个轻松过渡',
      coverage: { start: '19:00:00', end: '20:00:00' },
      label: '轻松过渡',
      programType: 'news_magazine',
    },
  ])('routes relative event scheduling intent to a layout draft without relying on LLM: $userInput', async ({ userInput, coverage, label, programType }) => {
    const facade = new DemoRuntimeFacade()

    const result = await facade.submitInstruction({
      scheduleState: createScheduleState(),
      userInput,
      currentSchedule: [],
      history: [],
    })

    expect(result.kind).toBe('layout_draft')
    if (result.kind !== 'layout_draft') {
      throw new Error('expected layout draft decision')
    }

    expect(result.draft.coverage).toEqual(coverage)
    expect(result.draft.columns[0]?.semanticLabel).toContain(label)
    expect(result.draft.columns[0]?.defaultProgramType).toBe(programType)
    expect(result.draft.strategyProfile?.kind).toBe('carousel')
    expect(result.draft.strategyProfile?.selectionPriority).toBe('content_match')
    expect(result.draft.strategyProfile?.requiresPreviousSchedule).toBe(false)
    expect(result.draft.strategyProfile?.contextSummary).toContain('独立选片')
    expect(result.draft.columns[0]?.selectionPolicy?.primary).toBe('content_match')
    expect(result.draft.columns[0]?.selectionPolicy?.requiresPreviousSchedule).toBe(false)
  })
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
