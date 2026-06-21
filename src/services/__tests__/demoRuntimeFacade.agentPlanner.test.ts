import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { LayoutDraft, ScheduleState } from '@/types/orchestration'
import type { RuntimeScheduleItem } from '@/services/runtime/demoRuntimeFacade'

const llmClientChatMock = vi.hoisted(() => vi.fn())
const taskClassifierClassifyMock = vi.hoisted(() => vi.fn())
const layoutIntentRecognizeMock = vi.hoisted(() => vi.fn())

vi.mock('@/services/llm/llmClient', () => ({
  getLLMClient: () => ({
    chat: llmClientChatMock,
  }),
}))

vi.mock('@/services/llm/taskClassifier', () => ({
  getTaskClassifier: () => ({
    classify: taskClassifierClassifyMock,
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
    recognize: layoutIntentRecognizeMock,
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

const createScheduleState = (overrides: Partial<ScheduleState> = {}): ScheduleState => ({
  channelId: 'dragon',
  channelName: '东方卫视',
  date: '2026-03-25',
  isEmpty: true,
  itemCount: 0,
  gapCount: 1,
  hasSelectedTimeRange: false,
  playlistType: 'none',
  ...overrides,
})

const createRotationDraft = (): LayoutDraft => ({
  id: 'rotation-draft-existing',
  channelId: 'rotation',
  date: '2026-03-25',
  source: 'generated',
  userIntent: '两小时轮播草案',
  draftKind: 'duration_segments',
  targetDurationSeconds: 2 * 60 * 60,
  coverage: { start: '00:00:00', end: '02:00:00' },
  layoutReference: {
    id: 'rotation-layout-existing',
    name: '轮播草案',
    channelId: 'rotation',
    slots: [
      {
        id: 'slot-news',
        channelId: 'rotation',
        columnId: 'column-news',
        startTime: '00:00:00',
        endTime: '01:00:00',
      },
      {
        id: 'slot-drama',
        channelId: 'rotation',
        columnId: 'column-drama',
        startTime: '01:00:00',
        endTime: '02:00:00',
      },
    ],
  },
  columns: [
    {
      columnId: 'column-news',
      columnName: '新闻',
      channelId: 'rotation',
      defaultProgramType: 'news',
      source: 'generated',
      semanticLabel: '新闻',
      queryHints: ['新闻'],
    },
    {
      columnId: 'column-drama',
      columnName: '电视剧',
      channelId: 'rotation',
      defaultProgramType: 'drama',
      source: 'generated',
      semanticLabel: '电视剧',
      queryHints: ['电视剧'],
    },
  ],
  durationSegments: [
    {
      id: 'duration-news',
      label: '新闻',
      targetDurationSeconds: 60 * 60,
      selectionPriority: 'content_match',
      repeatPolicy: 'avoid_repeat',
      fallbackPolicy: 'ask_user',
    },
    {
      id: 'duration-drama',
      label: '电视剧',
      targetDurationSeconds: 60 * 60,
      selectionPriority: 'content_match',
      repeatPolicy: 'content_fill',
      fallbackPolicy: 'ask_user',
    },
  ],
})

const createExistingRotationSchedule = (): RuntimeScheduleItem[] => [
  {
    id: 'rotation-existing-1',
    programCode: 'rotation-existing-1',
    programName: '现有世界杯回顾短片',
    startTime: '00:00:00',
    endTime: '00:30:00',
    duration: 30 * 60,
    programType: 'documentary',
  },
]

const mockPlanner = (plan: unknown) => {
  llmClientChatMock.mockResolvedValueOnce({
    content: JSON.stringify(plan),
  })
}

describe('DemoRuntimeFacade LLM-first agent planner foreground path', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    taskClassifierClassifyMock.mockImplementation(async () => {
      throw new Error('local task classifier should not handle foreground natural language')
    })
    layoutIntentRecognizeMock.mockResolvedValue({
      mode: 'clarify',
      confidence: 0.1,
      reasoning: 'layout recognizer should not run before planner',
    })
  })

  it('routes typed bare playlist creation through the LLM planner', async () => {
    mockPlanner({
      actions: [
        { type: 'create_playlist', playlistType: 'tv' },
      ],
      assistantReplyDraft: '已新建电视播单，并加载当前频道日期的版面草案。',
      reasoning: '用户要新建电视播单。',
    })

    const result = await new DemoRuntimeFacade().submitInstruction({
      scheduleState: createScheduleState({ playlistType: 'none' }),
      userInput: '新建电视播单',
      currentSchedule: [],
      history: [],
      agentCoreEnabled: true,
      layoutDraftEnabled: true,
      inputSource: 'user',
    })

    expect(result.kind).toBe('message')
    if (result.kind !== 'message') throw new Error('expected message')
    expect(llmClientChatMock).toHaveBeenCalledTimes(1)
    expect(taskClassifierClassifyMock).not.toHaveBeenCalled()
    expect(result.feedback.details?.playlistState).toMatchObject({
      playlistType: 'tv',
    })
    expect(result.feedback.details?.layoutDraftStatus).toBe('loaded')
  })

  it('keeps quick-action bare playlist creation as a fast workspace button action', async () => {
    const result = await new DemoRuntimeFacade().submitInstruction({
      scheduleState: createScheduleState({ playlistType: 'none' }),
      userInput: '新建轮播单',
      currentSchedule: [],
      history: [],
      agentCoreEnabled: true,
      layoutDraftEnabled: true,
      inputSource: 'quick_action',
    })

    expect(result.kind).toBe('message')
    if (result.kind !== 'message') throw new Error('expected message')
    expect(llmClientChatMock).not.toHaveBeenCalled()
    expect(taskClassifierClassifyMock).not.toHaveBeenCalled()
    expect(result.feedback.details?.playlistState).toMatchObject({
      playlistType: 'rotation',
    })
    expect(result.feedback.details?.layoutDraftStatus).toBe('missing')
  })

  it('lets the planner understand whole rotation orchestration, then blocks without a draft locally', async () => {
    mockPlanner({
      actions: [
        { type: 'formal_orchestration', mode: 'full_generate', useLayoutDraft: true },
      ],
      assistantReplyDraft: '我会先检查这张轮播单能不能按草案整体编排。',
      reasoning: '用户要把当前轮播单整体排完整。',
    })

    const result = await new DemoRuntimeFacade().submitInstruction({
      scheduleState: createScheduleState({
        playlistId: 'rotation-playlist',
        playlistType: 'rotation',
        channelId: 'rotation',
        channelName: '轮播单',
        rotationStrategy: 'content_match',
      }),
      userInput: '帮我把这张轮播单排完整',
      currentSchedule: [],
      currentLayoutDraft: null,
      history: [],
      agentCoreEnabled: true,
      layoutDraftEnabled: true,
      inputSource: 'user',
    })

    expect(result.kind).toBe('message')
    if (result.kind !== 'message') throw new Error('expected message')
    expect(result.statusHint).toBe('needs_clarification')
    expect(result.feedback.content).toContain('还没有可用草案')
    expect(result.feedback.details?.atomicCommandsAllowed).toBe(true)
    expect(llmClientChatMock).toHaveBeenCalledTimes(1)
    expect(layoutIntentRecognizeMock).not.toHaveBeenCalled()
    expect(taskClassifierClassifyMock).not.toHaveBeenCalled()
  })

  it('lets the LLM planner commit an explicit draft-backed orchestration request', async () => {
    mockPlanner({
      actions: [
        { type: 'commit_layout_draft', mode: 'full_generate', useLayoutDraft: true },
      ],
      assistantReplyDraft: '我会按当前草案进入正式编排。',
      reasoning: '用户明确要求参考草案编排。',
    })

    const result = await new DemoRuntimeFacade().submitInstruction({
      scheduleState: createScheduleState({
        playlistId: 'rotation-playlist',
        playlistType: 'rotation',
        channelId: 'rotation',
        channelName: '轮播单',
        rotationStrategy: 'content_match',
        rotationDurationSeconds: 2 * 60 * 60,
      }),
      userInput: '参考草案编排',
      currentSchedule: [],
      currentLayoutDraft: createRotationDraft(),
      history: [],
      agentCoreEnabled: true,
      layoutDraftEnabled: true,
      inputSource: 'user',
    })

    expect(result.kind).toBe('layout_commit')
    expect(llmClientChatMock).toHaveBeenCalledTimes(1)
    expect(taskClassifierClassifyMock).not.toHaveBeenCalled()
  })

  it('requires confirmation before a draft-backed full rebuild overwrites an existing formal playlist', async () => {
    mockPlanner({
      actions: [
        { type: 'commit_layout_draft', mode: 'full_generate', useLayoutDraft: true },
      ],
      assistantReplyDraft: '我会按当前草案重新编排正式播单。',
      reasoning: '用户要求按草案重新编排已有轮播单。',
    })

    const currentSchedule = createExistingRotationSchedule()
    const facade = new DemoRuntimeFacade()
    const result = await facade.submitInstruction({
      scheduleState: createScheduleState({
        playlistId: 'rotation-playlist',
        playlistType: 'rotation',
        channelId: 'rotation',
        channelName: '轮播单',
        rotationStrategy: 'content_match',
        rotationDurationSeconds: 2 * 60 * 60,
        isEmpty: false,
        itemCount: currentSchedule.length,
        gapCount: 0,
      }),
      userInput: '按草案重新编排这张轮播单',
      currentSchedule,
      currentLayoutDraft: createRotationDraft(),
      history: [],
      agentCoreEnabled: true,
      layoutDraftEnabled: true,
      inputSource: 'user',
    })

    expect(result.kind).toBe('pending_atomic_context')
    if (result.kind !== 'pending_atomic_context') throw new Error('expected formal rebuild pending context')
    expect(result.pendingAtomicContext.phase).toBe('formal_rebuild_confirmation')
    expect(result.pendingAtomicContext.formalRebuildConfirmation).toMatchObject({
      actionKind: 'commit_layout_draft',
      mode: 'full_generate',
      existingItemCount: 1,
    })
    expect(result.feedback.content).toContain('已经有 1 条节目')
    expect(result.feedback.details?.noMutationBeforeConfirm).toBe(true)
    expect(taskClassifierClassifyMock).not.toHaveBeenCalled()

    const confirmed = await facade.submitInstruction({
      scheduleState: createScheduleState({
        playlistId: 'rotation-playlist',
        playlistType: 'rotation',
        channelId: 'rotation',
        channelName: '轮播单',
        rotationStrategy: 'content_match',
        rotationDurationSeconds: 2 * 60 * 60,
        isEmpty: false,
        itemCount: currentSchedule.length,
        gapCount: 0,
      }),
      userInput: '确认重新编排',
      currentSchedule,
      currentLayoutDraft: createRotationDraft(),
      pendingAtomicContext: result.pendingAtomicContext,
      history: ['按草案重新编排这张轮播单'],
      agentCoreEnabled: true,
      layoutDraftEnabled: true,
      inputSource: 'user',
    })

    expect(confirmed.kind).toBe('layout_commit')
    expect(taskClassifierClassifyMock).not.toHaveBeenCalled()
  })

  it('does not require formal rebuild confirmation when the user only rewrites the draft description', async () => {
    mockPlanner({
      actions: [
        {
          type: 'refine_layout_draft',
          ignoreExistingLayout: true,
          rotationDurationSeconds: 2 * 60 * 60,
          semanticLabel: '新闻与电视剧生命树',
          segments: [
            { start: '00:00:00', end: '01:00:00', semanticLabel: '新闻', programTypeHint: 'news' },
            { start: '01:00:00', end: '02:00:00', semanticLabel: '电视剧生命树', programTypeHint: 'drama' },
          ],
        },
      ],
      assistantReplyDraft: '我只重写左侧草案，不会动正式播单。',
      reasoning: '用户是在要求重写草案。',
    })

    const currentSchedule = createExistingRotationSchedule()
    const result = await new DemoRuntimeFacade().submitInstruction({
      scheduleState: createScheduleState({
        playlistId: 'rotation-playlist',
        playlistType: 'rotation',
        channelId: 'rotation',
        channelName: '轮播单',
        rotationStrategy: 'content_match',
        rotationDurationSeconds: 2 * 60 * 60,
        isEmpty: false,
        itemCount: currentSchedule.length,
        gapCount: 0,
      }),
      userInput: '把这份草案重写成第一小时新闻，第二小时电视剧生命树',
      currentSchedule,
      currentLayoutDraft: createRotationDraft(),
      history: [],
      agentCoreEnabled: true,
      layoutDraftEnabled: true,
      inputSource: 'user',
    })

    expect(result.kind).toBe('layout_draft')
    if (result.kind !== 'layout_draft') throw new Error('expected direct draft rewrite')
    expect(result.draft.columns.map((column) => column.semanticLabel)).toEqual(['新闻', '电视剧生命树'])
    expect(result.feedback.content).toContain('确认前不会写入正式轮播单')
    expect(taskClassifierClassifyMock).not.toHaveBeenCalled()
  })

  it('expires the formal rebuild review when the user starts a different task', async () => {
    const currentSchedule = createExistingRotationSchedule()
    const pending = {
      action: null,
      phase: 'formal_rebuild_confirmation' as const,
      summary: '待确认重新编排轮播单',
      reasoning: '当前轮播单已有节目。',
      originalUserInput: '按草案重新编排这张轮播单',
      collectedUserInput: '按草案重新编排这张轮播单',
      slots: {},
      missingFields: ['selection' as const],
      followUpQuestion: '请确认是否重新编排这张轮播单。',
      formalRebuildConfirmation: {
        actionKind: 'commit_layout_draft' as const,
        mode: 'full_generate' as const,
        useLayoutDraft: true,
        existingItemCount: 1,
        playlistType: 'rotation' as const,
        userInput: '按草案重新编排这张轮播单',
        reasoning: '用户要求按草案重新编排。',
      },
      attemptCount: 0,
      createdAt: '2026-03-25T00:00:00.000Z',
      updatedAt: '2026-03-25T00:00:00.000Z',
    }

    mockPlanner({
      actions: [
        { type: 'read_only_analysis', analysisKind: 'playlist_analysis' },
      ],
      assistantReplyDraft: '我先帮你看当前轮播单内容。',
      reasoning: '用户换成查询当前内容。',
    })

    const result = await new DemoRuntimeFacade().submitInstruction({
      scheduleState: createScheduleState({
        playlistId: 'rotation-playlist',
        playlistType: 'rotation',
        channelId: 'rotation',
        channelName: '轮播单',
        rotationStrategy: 'content_match',
        rotationDurationSeconds: 2 * 60 * 60,
        isEmpty: false,
        itemCount: currentSchedule.length,
        gapCount: 0,
      }),
      userInput: '先查询当前有哪些节目',
      currentSchedule,
      currentLayoutDraft: createRotationDraft(),
      pendingAtomicContext: pending,
      history: ['按草案重新编排这张轮播单'],
      agentCoreEnabled: true,
      layoutDraftEnabled: true,
      inputSource: 'user',
    })

    expect(result.kind).toBe('message')
    expect(llmClientChatMock).toHaveBeenCalledTimes(2)
    expect(taskClassifierClassifyMock).not.toHaveBeenCalled()
  })

  it('does not display a false execution reply when the planner returns no executable action', async () => {
    mockPlanner({
      actions: [
        { type: 'clarify', question: '是否开始编排？' },
      ],
      assistantReplyDraft: '已收到您的指令，正在参考当前轮播草案进行编排。',
      reasoning: '模型漏掉了 commit_layout_draft 动作。',
    })

    const result = await new DemoRuntimeFacade().submitInstruction({
      scheduleState: createScheduleState({
        playlistId: 'rotation-playlist',
        playlistType: 'rotation',
        channelId: 'rotation',
        channelName: '轮播单',
        rotationStrategy: 'content_match',
        rotationDurationSeconds: 2 * 60 * 60,
      }),
      userInput: '参考草案编排',
      currentSchedule: [],
      currentLayoutDraft: createRotationDraft(),
      history: [],
      agentCoreEnabled: true,
      layoutDraftEnabled: true,
      inputSource: 'user',
    })

    expect(result.kind).toBe('message')
    if (result.kind !== 'message') throw new Error('expected message')
    expect(result.feedback.content).toContain('还没有进入正式编排')
    expect(result.feedback.details?.noMutation).toBe(true)
    expect(llmClientChatMock).toHaveBeenCalledTimes(1)
    expect(taskClassifierClassifyMock).not.toHaveBeenCalled()
  })

  it('lets the LLM planner create a rotation workspace and attach a one-hour draft', async () => {
    mockPlanner({
      actions: [
        {
          type: 'create_playlist',
          playlistType: 'rotation',
          rotationStrategy: 'content_match',
          rotationDurationSeconds: 3600,
        },
        {
          type: 'prepare_layout_draft',
          rotationDurationSeconds: 3600,
          semanticLabel: '世界杯亚洲球队介绍',
          segments: [
            {
              start: '00:00:00',
              end: '01:00:00',
              semanticLabel: '世界杯亚洲球队介绍',
              programTypeHint: 'news_magazine',
            },
          ],
        },
      ],
      assistantReplyDraft: '我先建立轮播单，并把世界杯亚洲球队介绍整理成一小时草案。',
      reasoning: '用户同时要求新建轮播单和准备主题草案。',
    })

    const result = await new DemoRuntimeFacade().submitInstruction({
      scheduleState: createScheduleState({ playlistType: 'none' }),
      userInput: '新建一个世界杯的轮播单，主要涵盖亚洲各个球队的球队介绍，时长约1小时',
      currentSchedule: [],
      history: [],
      agentCoreEnabled: true,
      layoutDraftEnabled: true,
      inputSource: 'user',
    })

    expect(result.kind).toBe('message')
    if (result.kind !== 'message') throw new Error('expected message')
    expect(taskClassifierClassifyMock).not.toHaveBeenCalled()
    expect(result.feedback.details?.playlistState).toMatchObject({
      playlistType: 'rotation',
      rotationStrategy: 'content_match',
      rotationDurationSeconds: 3600,
    })
    expect(result.layoutDraft?.coverage).toEqual({ start: '00:00:00', end: '01:00:00' })
    expect(result.layoutDraft?.targetDurationSeconds).toBe(3600)
    expect(result.layoutDraft?.columns.map((column) => column.semanticLabel)).toEqual(['世界杯亚洲球队介绍'])
  })

  it('keeps multi-hour rotation draft structure from the LLM plan instead of collapsing it into one label', async () => {
    mockPlanner({
      actions: [
        {
          type: 'create_playlist',
          playlistType: 'rotation',
          rotationStrategy: 'content_match',
          rotationDurationSeconds: 3 * 60 * 60,
        },
        {
          type: 'prepare_layout_draft',
          rotationDurationSeconds: 3 * 60 * 60,
          semanticLabel: '静安徐汇专题轮播',
          segments: [
            { start: '00:00:00', end: '01:00:00', semanticLabel: '静安区静安寺宣传片', programTypeHint: 'documentary' },
            { start: '01:00:00', end: '02:00:00', semanticLabel: '徐汇区仙鹤墓园介绍', programTypeHint: 'documentary' },
            { start: '02:00:00', end: '03:00:00', semanticLabel: '徐汇区天主教堂介绍', programTypeHint: 'documentary' },
          ],
        },
      ],
      assistantReplyDraft: '我先按三个小时拆成三个草案块。',
    })

    const result = await new DemoRuntimeFacade().submitInstruction({
      scheduleState: createScheduleState({ playlistType: 'none' }),
      userInput: '新建一个3小时时长的轮播单，第一个小时是静安区静安寺宣传片，第二个小时是徐汇区的仙鹤墓园，第三个小时是徐汇区的天主教堂',
      currentSchedule: [],
      history: [],
      agentCoreEnabled: true,
      layoutDraftEnabled: true,
      inputSource: 'user',
    })

    expect(result.kind).toBe('message')
    if (result.kind !== 'message') throw new Error('expected message')
    expect(taskClassifierClassifyMock).not.toHaveBeenCalled()
    expect(result.layoutDraft?.coverage).toEqual({ start: '00:00:00', end: '03:00:00' })
    expect(result.layoutDraft?.layoutReference.slots).toHaveLength(3)
    expect(result.layoutDraft?.columns.map((column) => column.semanticLabel)).toEqual([
      '静安区静安寺宣传片',
      '徐汇区仙鹤墓园介绍',
      '徐汇区天主教堂介绍',
    ])
    expect(result.layoutDraft?.durationSegments?.map((segment) => segment.label)).toEqual([
      '静安区静安寺宣传片',
      '徐汇区仙鹤墓园介绍',
      '徐汇区天主教堂介绍',
    ])

    mockPlanner({
      actions: [
        {
          type: 'refine_layout_draft',
          rotationDurationSeconds: 3 * 60 * 60,
          semanticLabel: '静安区静安寺宣传片',
          programTypeHint: 'drama',
          segments: [
            { start: '00:00:00', end: '01:00:00', semanticLabel: '静安区静安寺宣传片', programTypeHint: 'documentary' },
            { start: '01:00:00', end: '02:00:00', semanticLabel: '电视剧生命树', programTypeHint: 'drama' },
            { start: '02:00:00', end: '03:00:00', semanticLabel: '徐汇区天主教堂介绍', programTypeHint: 'documentary' },
          ],
        },
      ],
      assistantReplyDraft: '我把第二小时调整成电视剧生命树。',
    })

    const refined = await new DemoRuntimeFacade().submitInstruction({
      scheduleState: createScheduleState({
        playlistId: 'rotation-playlist',
        playlistType: 'rotation',
        channelId: 'rotation',
        channelName: '轮播单',
        rotationStrategy: 'content_match',
        rotationDurationSeconds: 3 * 60 * 60,
      }),
      userInput: '把第二个小时改成电视剧生命树',
      currentSchedule: [],
      currentLayoutDraft: result.layoutDraft,
      history: [],
      agentCoreEnabled: true,
      layoutDraftEnabled: true,
      inputSource: 'user',
    })

    expect(refined.kind).toBe('layout_draft')
    if (refined.kind !== 'layout_draft') throw new Error('expected layout draft')
    expect(refined.draft.columns.map((column) => column.semanticLabel)).toEqual([
      '静安区静安寺宣传片',
      '电视剧生命树',
      '徐汇区天主教堂介绍',
    ])
    expect(refined.draft.durationSegments?.map((segment) => segment.label)).toEqual([
      '静安区静安寺宣传片',
      '电视剧生命树',
      '徐汇区天主教堂介绍',
    ])
  })

  it('lets the LLM planner refine an existing rotation draft using current draft context', async () => {
    mockPlanner({
      actions: [
        {
          type: 'refine_layout_draft',
          rotationDurationSeconds: 2 * 60 * 60,
          semanticLabel: '第二小时改成电视剧生命树',
          segments: [
            {
              start: '01:00:00',
              end: '02:00:00',
              semanticLabel: '电视剧生命树',
              programTypeHint: 'drama',
            },
          ],
        },
      ],
      assistantReplyDraft: '我先把第二小时调整成电视剧生命树草案块。',
    })

    const currentDraft = createRotationDraft()
    const result = await new DemoRuntimeFacade().submitInstruction({
      scheduleState: createScheduleState({
        playlistId: 'rotation-playlist',
        playlistType: 'rotation',
        channelId: 'rotation',
        channelName: '轮播单',
        rotationStrategy: 'content_match',
        rotationDurationSeconds: 2 * 60 * 60,
      }),
      userInput: '把第二个小时改成电视剧生命树',
      currentSchedule: [],
      currentLayoutDraft: currentDraft,
      history: [],
      agentCoreEnabled: true,
      layoutDraftEnabled: true,
      preferLayoutDraftRefine: true,
      inputSource: 'user',
    })

    expect(result.kind).toBe('layout_draft')
    if (result.kind !== 'layout_draft') throw new Error('expected layout draft')
    expect(taskClassifierClassifyMock).not.toHaveBeenCalled()
    expect(result.draft.coverage).toEqual({ start: '00:00:00', end: '02:00:00' })
    expect(result.draft.columns.map((column) => column.semanticLabel)).toContain('电视剧生命树')
    expect(result.draft.strategyProfile?.kind).toBe('carousel')
    expect(result.draft.strategyProfile?.label).toBe('轮播单策略')

    const plannerUserMessage = llmClientChatMock.mock.calls[0]?.[0]?.[1]?.content
    expect(plannerUserMessage).toContain('电视剧')
    expect(plannerUserMessage).toContain('00:00:00')
    expect(plannerUserMessage).toContain('02:00:00')
  })

  it('lets the planner ask for a ReAct-style draft and asset-library check before changing a draft', async () => {
    llmClientChatMock
      .mockResolvedValueOnce({
        content: JSON.stringify({
          actions: [
            {
              type: 'research_check',
              purpose: 'candidate_precheck',
              targetSegmentIndex: 1,
              semanticLabel: '金山区最近三年热门景点',
              programTypeHint: '宣传片',
              queries: ['金山区 近三年 热门景点 宣传片', '金山 乐高乐园 景点 宣传片'],
            },
          ],
          assistantReplyDraft: '我先查一下素材库，确认前不会改草案。',
          reasoning: '用户要求先为草案块选择更合适的素材方向。',
        }),
      })
      .mockResolvedValueOnce({
        content: '我先看了当前第一段草案，并按金山区热门景点方向查了素材库。乐高乐园这类方向可以继续核验；确认前我不会更新草案，也不会写入节目。需要我把这个方向更新到草案吗？',
      })

    const facade = new DemoRuntimeFacade()
    const searchPrograms = vi.spyOn((facade as any).candidateService, 'searchPrograms').mockResolvedValue([
      {
        id: 'candidate-jinshan-legoland',
        programId: 'candidate-jinshan-legoland',
        programCode: 'candidate-jinshan-legoland',
        programName: '金山乐高乐园宣传片',
        instanceName: '金山乐高乐园宣传片',
        channelId: 'rotation',
        duration: 600,
        programType: 'documentary',
        columnName: '文旅宣传',
        contentTags: ['金山', '乐高乐园', '景点'],
        popularityScore: 96,
      },
    ])

    const currentDraft = createRotationDraft()
    const result = await facade.submitInstruction({
      scheduleState: createScheduleState({
        playlistId: 'rotation-playlist',
        playlistType: 'rotation',
        channelId: 'rotation',
        channelName: '轮播单',
        rotationStrategy: 'content_match',
        rotationDurationSeconds: 2 * 60 * 60,
      }),
      userInput: '第一段金山区景点部分，选择金山区最近3年最火热的景点',
      currentSchedule: [],
      currentLayoutDraft: currentDraft,
      history: [],
      agentCoreEnabled: true,
      layoutDraftEnabled: true,
      inputSource: 'user',
    })

    expect(result.kind).toBe('pending_atomic_context')
    if (result.kind !== 'pending_atomic_context') throw new Error('expected pending research context')
    expect(result.feedback.processTypeLabel).toBe('素材核验')
    expect(result.feedback.content).toContain('需要我把这个方向更新到草案吗')
    expect(result.feedback.details?.noMutation).toBe(true)
    expect(result.feedback.details?.candidateCount).toBe(1)
    expect(result.pendingAtomicContext.phase).toBe('draft_research_confirmation')
    expect(result.pendingAtomicContext.layoutDraftSuggestion?.semanticLabel).toBe('金山区最近三年热门景点')
    expect((result.feedback.details?.reactTask as any)?.tools).toEqual(['read_current_draft', 'search_asset_library'])
    expect(searchPrograms).toHaveBeenCalledWith(expect.objectContaining({
      channelId: 'rotation',
      programName: '金山区 近三年 热门景点 宣传片',
      programTypes: undefined,
    }))
    expect(llmClientChatMock).toHaveBeenCalledTimes(2)
    expect(taskClassifierClassifyMock).not.toHaveBeenCalled()

    const confirmed = await facade.submitInstruction({
      scheduleState: createScheduleState({
        playlistId: 'rotation-playlist',
        playlistType: 'rotation',
        channelId: 'rotation',
        channelName: '轮播单',
        rotationStrategy: 'content_match',
        rotationDurationSeconds: 2 * 60 * 60,
      }),
      userInput: '更新到草案',
      currentSchedule: [],
      currentLayoutDraft: currentDraft,
      currentLayoutDraftMode: 'full_generate',
      pendingAtomicContext: result.pendingAtomicContext,
      history: ['第一段金山区景点部分，选择金山区最近3年最火热的景点'],
      agentCoreEnabled: true,
      layoutDraftEnabled: true,
      inputSource: 'user',
    })

    expect(confirmed.kind).toBe('layout_draft')
    if (confirmed.kind !== 'layout_draft') throw new Error('expected layout draft update')
    expect(confirmed.feedback.content).toContain('正式播单还没有开始编排')
    expect(confirmed.draft.columns[0]?.semanticLabel).toBe('金山区最近三年热门景点')
    expect(confirmed.draft.columns[0]?.queryHints).toEqual(expect.arrayContaining([
      '金山乐高乐园宣传片',
      '乐高乐园',
    ]))
    expect(confirmed.draft.durationSegments?.[0]?.label).toBe('金山区最近三年热门景点')
    expect(llmClientChatMock).toHaveBeenCalledTimes(2)
  })

  it('keeps the prompt contract that ordinal-hour changes on an existing draft are draft refinements', async () => {
    mockPlanner({
      actions: [{ type: 'clarify', question: 'mock' }],
    })

    await new DemoRuntimeFacade().submitInstruction({
      scheduleState: createScheduleState({
        playlistId: 'rotation-playlist',
        playlistType: 'rotation',
        channelId: 'rotation',
        channelName: '轮播单',
        rotationStrategy: 'content_match',
        rotationDurationSeconds: 2 * 60 * 60,
      }),
      userInput: '把第二个小时改成电视剧生命树',
      currentSchedule: [],
      currentLayoutDraft: createRotationDraft(),
      history: [],
      agentCoreEnabled: true,
      layoutDraftEnabled: true,
      inputSource: 'user',
    })

    const plannerSystemPrompt = llmClientChatMock.mock.calls[0]?.[0]?.[0]?.content
    expect(plannerSystemPrompt).toContain('这是草案微调')
    expect(plannerSystemPrompt).toContain('不要返回 atomic_command')
  })

  it('normalizes ordinal-hour draft refinements from the planner into a single safe segment replacement', async () => {
    mockPlanner({
      actions: [
        {
          type: 'refine_layout_draft',
          rotationDurationSeconds: 2 * 60 * 60,
          semanticLabel: '电视剧生命树',
          programTypeHint: 'drama',
        },
      ],
      assistantReplyDraft: '我把第二小时调整成电视剧生命树。',
    })

    const result = await new DemoRuntimeFacade().submitInstruction({
      scheduleState: createScheduleState({
        playlistId: 'rotation-playlist',
        playlistType: 'rotation',
        channelId: 'rotation',
        channelName: '轮播单',
        rotationStrategy: 'content_match',
        rotationDurationSeconds: 2 * 60 * 60,
      }),
      userInput: '把第二个小时改成电视剧生命树',
      currentSchedule: [],
      currentLayoutDraft: createRotationDraft(),
      history: [],
      agentCoreEnabled: true,
      layoutDraftEnabled: true,
      inputSource: 'user',
    })

    expect(result.kind).toBe('layout_draft')
    if (result.kind !== 'layout_draft') throw new Error('expected layout draft')
    expect(result.draft.layoutReference.slots).toHaveLength(2)
    expect(result.draft.coverage).toEqual({ start: '00:00:00', end: '02:00:00' })
    expect(result.draft.columns.map((column) => column.semanticLabel)).toEqual([
      '新闻',
      '电视剧生命树',
    ])
    expect(result.draft.strategyProfile?.kind).toBe('carousel')
  })

  it('routes quick-action natural language through the planner instead of legacy classifiers', async () => {
    mockPlanner({
      actions: [
        {
          type: 'refine_layout_draft',
          semanticLabel: '电视剧生命树',
          programTypeHint: 'drama',
          segments: [
            { start: '01:00:00', end: '02:00:00', semanticLabel: '电视剧生命树', programTypeHint: 'drama' },
          ],
        },
      ],
      assistantReplyDraft: '我把第二个小时改成电视剧生命树。',
      reasoning: '用户在微调当前轮播草案。',
    })

    const result = await new DemoRuntimeFacade().submitInstruction({
      scheduleState: createScheduleState({
        playlistId: 'rotation-playlist',
        playlistType: 'rotation',
        channelId: 'rotation',
        channelName: '轮播单',
        rotationStrategy: 'content_match',
        rotationDurationSeconds: 2 * 60 * 60,
      }),
      userInput: '把第二个小时改成电视剧生命树',
      currentSchedule: [],
      currentLayoutDraft: createRotationDraft(),
      history: [],
      agentCoreEnabled: true,
      layoutDraftEnabled: true,
      inputSource: 'quick_action',
    })

    expect(result.kind).toBe('layout_draft')
    if (result.kind !== 'layout_draft') throw new Error('expected layout draft')
    expect(llmClientChatMock).toHaveBeenCalledTimes(1)
    expect(layoutIntentRecognizeMock).not.toHaveBeenCalled()
    expect(taskClassifierClassifyMock).not.toHaveBeenCalled()
    expect(result.draft.columns.map((column) => column.semanticLabel)).toEqual([
      '新闻',
      '电视剧生命树',
    ])
    expect(result.draft.durationSegments?.map((segment) => segment.label)).toEqual([
      '新闻',
      '电视剧生命树',
    ])
  })

  it('turns planner timeout into a recoverable retry without falling back to local classification', async () => {
    llmClientChatMock.mockRejectedValueOnce(new Error('LLM 网络请求超时'))

    const result = await new DemoRuntimeFacade().submitInstruction({
      scheduleState: createScheduleState({
        playlistId: 'rotation-playlist',
        playlistType: 'rotation',
        channelId: 'rotation',
        channelName: '轮播单',
      }),
      userInput: '新建草案，第一个小时是新闻，第二个小时是电视剧生命树',
      currentSchedule: [],
      history: [],
      agentCoreEnabled: true,
      layoutDraftEnabled: true,
      inputSource: 'user',
    })

    expect(result.kind).toBe('message')
    if (result.kind !== 'message') throw new Error('expected message')
    expect(taskClassifierClassifyMock).not.toHaveBeenCalled()
    expect(result.statusHint).toBe('failed')
    expect(result.feedback.details?.canRetry).toBe(true)
    expect(result.feedback.details?.recoverableUserInput).toBe('新建草案，第一个小时是新闻，第二个小时是电视剧生命树')
  })

  it('lets the planner inspect an ambiguous draft request but still refuses to default to a TV playlist', async () => {
    mockPlanner({
      actions: [
        {
          type: 'prepare_layout_draft',
          mode: 'full_generate',
          semanticLabel: '新闻和电视剧生命树',
          segments: [
            {
              start: '00:00:00',
              end: '01:00:00',
              semanticLabel: '新闻',
            },
            {
              start: '01:00:00',
              end: '02:00:00',
              semanticLabel: '电视剧生命树',
            },
          ],
        },
      ],
      assistantReplyDraft: '我先帮你整理草案。',
      reasoning: '模型识别到草案内容，但没有播单工作区。',
    })

    const result = await new DemoRuntimeFacade().submitInstruction({
      scheduleState: createScheduleState({ playlistType: 'none' }),
      userInput: '新建草案，第一个小时是新闻，第二个小时是电视剧生命树',
      currentSchedule: [],
      history: [],
      agentCoreEnabled: true,
      layoutDraftEnabled: true,
      inputSource: 'user',
    })

    expect(result.kind).toBe('message')
    if (result.kind !== 'message') throw new Error('expected message')
    expect(result.statusHint).toBe('needs_clarification')
    expect(result.feedback.content).toContain('播单类型')
    expect(llmClientChatMock).toHaveBeenCalledTimes(1)
    expect(layoutIntentRecognizeMock).not.toHaveBeenCalled()
    expect(taskClassifierClassifyMock).not.toHaveBeenCalled()
    expect(result.layoutDraft).toBeUndefined()
    expect(result.feedback.details?.noMutation).toBe(true)
  })
})
