import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ColumnDefinition, LayoutDraft, LayoutReference, ScheduleState } from '@/types/orchestration'
import { clearRuntimeLayout, setRuntimeLayout } from '@/services/orchestration/runtimeLayoutRegistry'

const taskClassifierClassifyMock = vi.hoisted(() => vi.fn())
const layoutIntentRecognizeMock = vi.hoisted(() => vi.fn())
const previewFeasibilityMock = vi.hoisted(() => vi.fn())
const llmClientChatMock = vi.hoisted(() => vi.fn())

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
    previewFeasibility: previewFeasibilityMock,
  }),
}))

import { DemoRuntimeFacade } from '@/services/runtime/demoRuntimeFacade'

afterEach(() => {
  clearRuntimeLayout('dragon', '2026-03-25')
})
beforeEach(() => {
  llmClientChatMock.mockReset()
  llmClientChatMock.mockImplementation(mockLayoutDraftLlmResponse)
  previewFeasibilityMock.mockReturnValue({
    ok: true,
    summary: {
      readyCount: 0,
      warningCount: 0,
      blockedCount: 0,
    },
    segments: [],
  })
  taskClassifierClassifyMock.mockResolvedValue({
    mode: 'clarify',
    confidence: 0.1,
    reasoning: 'unused',
  })
  layoutIntentRecognizeMock.mockResolvedValue({
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
  })
})

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

const buildMockLayoutDraftSpec = (coverage: { start: string; end: string }, segments: Array<{
  label: string
  startTime?: string
  endTime?: string
  programType?: string
  queryHints?: string[]
  sequential?: boolean
}>) => ({
  coverage,
  segments: segments.map((segment, index) => ({
    id: `mock-segment-${index + 1}`,
    label: segment.label,
    startTime: segment.startTime ?? coverage.start,
    endTime: segment.endTime ?? coverage.end,
    programType: segment.programType ?? 'news_magazine',
    queryHints: segment.queryHints ?? [segment.label],
    sequential: segment.sequential,
  })),
})

const mockLayoutDraftLlmResponse = async (messages: Array<{ content?: unknown }>) => {
  const prompt = messages.map((message) => String(message.content ?? '')).join('\n')

  if (prompt.includes('去掉23点的两说')) {
    return {
      content: JSON.stringify(buildMockLayoutDraftSpec({ start: '06:00:00', end: '23:59:59' }, [
        { label: '今晚', startTime: '22:00:00', endTime: '22:30:00', programType: 'commentary' },
        { label: '焦点', startTime: '22:30:00', endTime: '23:00:00', programType: 'commentary' },
        { label: '梦想剧场', startTime: '23:30:00', endTime: '23:59:59', programType: 'drama', queryHints: ['梦想剧场'], sequential: true },
      ])),
    }
  }

  if (prompt.includes('12:45到13:00')) {
    return { content: JSON.stringify(buildMockLayoutDraftSpec({ start: '12:45:00', end: '13:00:00' }, [
      { label: '生命树电视剧', programType: 'drama', queryHints: ['生命树电视剧', '电视剧'], sequential: true },
    ])) }
  }

  if (prompt.includes('9点到12点') || prompt.includes('9:00到12:00')) {
    return { content: JSON.stringify(buildMockLayoutDraftSpec({ start: '09:00:00', end: '12:00:00' }, [
      { label: '东方剧场', programType: 'drama', queryHints: ['东方剧场', '电视剧'], sequential: true },
    ])) }
  }

  if (prompt.includes('09:30到10:15')) {
    return { content: JSON.stringify(buildMockLayoutDraftSpec({ start: '09:30:00', end: '10:15:00' }, [
      { label: '品质剧场：纵有疾风起', programType: 'drama', queryHints: ['品质剧场：纵有疾风起', '纯电视频道', '顺播', '接昨天'], sequential: true },
    ])) }
  }

  if (prompt.includes('09:45到10:30')) {
    return { content: JSON.stringify(buildMockLayoutDraftSpec({ start: '09:45:00', end: '10:30:00' }, [
      { label: '品质剧场：纵有疾风起', programType: 'drama', queryHints: ['品质剧场：纵有疾风起', '顺播'], sequential: true },
    ])) }
  }

  if (prompt.includes('14:00到15:00')) {
    const label = prompt.includes('高收视率')
      ? '高收视率节目'
      : prompt.includes('热播')
        ? '当前热播节目'
        : '静安寺户外直播'
    const hints = prompt.includes('内容匹配优先')
      ? [label, '轮播单', '内容匹配优先', '静安寺', '直播', '外场直播']
      : prompt.includes('高收视率')
        ? [label, '轮播单', '收视率优先']
        : prompt.includes('热播')
          ? [label, '轮播单', '热播优先']
          : [label, '静安寺', '直播', '外场直播']
    return { content: JSON.stringify(buildMockLayoutDraftSpec({ start: '14:00:00', end: '15:00:00' }, [
      { label, programType: 'news_magazine', queryHints: hints },
    ])) }
  }

  if (prompt.includes('下午以城市服务')) {
    return { content: JSON.stringify(buildMockLayoutDraftSpec({ start: '13:00:00', end: '18:00:00' }, [
      { label: '城市服务', programType: 'news_magazine', queryHints: ['城市服务'] },
    ])) }
  }

  if (prompt.includes('黄金档主打综艺')) {
    return { content: JSON.stringify(buildMockLayoutDraftSpec({ start: '19:00:00', end: '20:00:00' }, [
      { label: '综艺', programType: 'entertainment', queryHints: ['综艺'] },
    ])) }
  }

  if (prompt.includes('晚间民生新闻')) {
    return { content: JSON.stringify(buildMockLayoutDraftSpec({ start: '18:00:00', end: '23:00:00' }, [
      { label: '民生新闻', programType: 'news', queryHints: ['民生新闻'] },
    ])) }
  }

  if (prompt.includes('发布会开播前')) {
    return { content: JSON.stringify(buildMockLayoutDraftSpec({ start: '18:00:00', end: '23:00:00' }, [
      { label: '现场导视', programType: 'news_magazine', queryHints: ['现场导视', '发布会'] },
    ])) }
  }

  if (prompt.includes('赛前给赛事直播')) {
    return { content: JSON.stringify(buildMockLayoutDraftSpec({ start: '18:00:00', end: '23:00:00' }, [
      { label: '赛事预热', programType: 'news_magazine', queryHints: ['赛事预热', '赛事直播'] },
    ])) }
  }

  if (prompt.includes('黄金档前后')) {
    return { content: JSON.stringify(buildMockLayoutDraftSpec({ start: '19:00:00', end: '20:00:00' }, [
      { label: '轻松过渡', programType: 'news_magazine', queryHints: ['轻松过渡'] },
    ])) }
  }

  if (prompt.includes('上海市16个区')) {
    return { content: JSON.stringify(buildMockLayoutDraftSpec({ start: '00:00:00', end: '03:00:00' }, [
      { label: '上海市16个区标志景点', startTime: '00:00:00', endTime: '03:00:00', programType: 'news_magazine', queryHints: ['上海市16个区', '标志景点'] },
    ])) }
  }

  return { content: JSON.stringify(buildMockLayoutDraftSpec({ start: '13:00:00', end: '18:00:00' }, [
    { label: '测试草案', programType: 'news_magazine', queryHints: ['测试草案'] },
  ])) }
}

const mockPlannerDraftAction = (action: Record<string, unknown> = { type: 'prepare_layout_draft' }) => {
  llmClientChatMock.mockResolvedValueOnce({
    content: JSON.stringify({
      mode: 'single',
      actions: [action],
      assistantReplyDraft: '我会先整理版面草案，确认前不写入正式播单。',
      reasoning: 'LLM planner 明确判断本轮只处理草案。',
    }),
  })
}

const mockPlannerFormalAction = (input: {
  action?: 'commit_layout_draft' | 'formal_orchestration'
  mode: 'full_generate' | 'partial_generate'
  taskKind: 'full_day' | 'overall_refill' | 'local_refill'
  useLayoutDraft: boolean
  targetTimeRange?: { start: string; end: string }
  searchKeywords?: string[]
}) => {
  const action = input.action ?? 'formal_orchestration'
  llmClientChatMock.mockResolvedValueOnce({
    content: JSON.stringify({
      mode: 'react',
      actions: [action === 'commit_layout_draft'
        ? { type: action, mode: input.mode, useLayoutDraft: input.useLayoutDraft }
        : { type: action, ...input }],
      reactTask: {
        objective: '按当前用户目标执行正式编排',
        maxTurns: 5,
        batchSize: 3,
        nextActions: [{
          type: 'research_check',
          purpose: 'candidate_precheck',
          queries: input.searchKeywords?.length ? input.searchKeywords : ['当前播单编排需求'],
        }],
      },
      assistantReplyDraft: '我会先核对节目库与当前播单，再逐批执行。',
      reasoning: 'LLM planner 明确判断本轮进入正式编排。',
    }),
  })
}

const createLayoutDraft = (): LayoutDraft => ({
  id: 'draft-test',
  channelId: 'dragon',
  date: '2026-03-25',
  source: 'generated',
  userIntent: '测试草案',
  coverage: { start: '13:00:00', end: '18:00:00' },
  layoutReference: {
    id: 'layout-test',
    name: '测试版面',
    channelId: 'dragon',
    slots: [
      {
        id: 'slot-test',
        channelId: 'dragon',
        columnId: 'column-test',
        startTime: '2026-03-25T13:00:00+08:00',
        endTime: '2026-03-25T18:00:00+08:00',
      },
    ],
  },
  columns: [
    {
      columnId: 'column-test',
      columnName: '综合版面',
      channelId: 'dragon',
      defaultProgramType: 'news_magazine',
      source: 'generated',
    },
  ],
})

const createRotationDurationDraft = (): LayoutDraft => ({
  id: 'rotation-duration-draft',
  channelId: 'rotation',
  date: '2026-03-25',
  source: 'generated',
  userIntent: '轮播草案',
  coverage: { start: '00:00:00', end: '23:59:59' },
  draftKind: 'duration_segments',
  targetDurationSeconds: 3 * 60 * 60,
  layoutReference: {
    id: 'rotation-layout-test',
    name: '轮播版面',
    slots: [{
      id: 'rotation-segment-test',
      channelId: 'rotation',
      columnId: 'rotation-column-test',
      startTime: '00:00:00',
      endTime: '23:59:59',
    }],
  },
  columns: [{
    columnId: 'rotation-column-test',
    columnName: '综合版面',
    channelId: 'rotation',
    defaultProgramType: 'news_magazine',
    source: 'generated',
    draftConstraintKind: 'unspecified',
    semanticLabel: '综合版面',
    queryHints: ['综合版面'],
  }],
  durationSegments: [{
    id: 'rotation-segment-test',
    label: '综合版面',
    contentHint: '综合版面',
    targetDurationSeconds: 3 * 60 * 60,
    selectionPriority: 'content_match',
    repeatPolicy: 'avoid_repeat',
    fallbackPolicy: 'ask_user',
  }],
})

const formatRelativeClock = (minutes: number): string => {
  const hours = Math.floor(minutes / 60)
  const restMinutes = minutes % 60
  return `${hours.toString().padStart(2, '0')}:${restMinutes.toString().padStart(2, '0')}:00`
}

const createNumberedRotationDraft = (): LayoutDraft => {
  const slots = Array.from({ length: 10 }, (_, index) => {
    const segmentNumber = index + 1
    return {
      id: `asian-team-slot-${segmentNumber}`,
      channelId: 'rotation',
      columnId: `asian-team-column-${segmentNumber}`,
      startTime: formatRelativeClock(index * 10),
      endTime: formatRelativeClock((index + 1) * 10),
    }
  })
  return {
    id: 'numbered-rotation-draft',
    channelId: 'rotation',
    date: '2026-03-25',
    source: 'generated',
    userIntent: '亚洲队介绍轮播草案',
    coverage: { start: '00:00:00', end: '01:40:00' },
    draftKind: 'duration_segments',
    targetDurationSeconds: 100 * 60,
    layoutReference: {
      id: 'numbered-rotation-layout',
      name: '亚洲队介绍轮播版面',
      slots,
    },
    columns: slots.map((slot, index) => {
      const segmentNumber = index + 1
      const label = `亚洲队${segmentNumber}介绍`
      return {
        columnId: slot.columnId,
        columnName: label,
        channelId: 'rotation',
        defaultProgramType: 'news_magazine',
        source: 'generated' as const,
        draftConstraintKind: 'unspecified' as const,
        semanticLabel: label,
        queryHints: [label],
      }
    }),
    durationSegments: slots.map((slot, index) => {
      const segmentNumber = index + 1
      const label = `亚洲队${segmentNumber}介绍`
      return {
        id: slot.id,
        label,
        contentHint: label,
        targetDurationSeconds: 10 * 60,
        selectionPriority: 'content_match' as const,
        repeatPolicy: 'avoid_repeat' as const,
        fallbackPolicy: 'ask_user' as const,
      }
    }),
  }
}

const uploadedLayoutReference: LayoutReference = {
  id: 'uploaded-layout',
  name: '上传版面草案',
  slots: [
    {
      id: 'uploaded-slot-news',
      channelId: 'dragon',
      columnId: 'runtime-column:uploaded-news',
      startTime: '2026-03-25T18:00:00+08:00',
      endTime: '2026-03-25T19:00:00+08:00',
    },
  ],
}

const uploadedColumns: ColumnDefinition[] = [
  {
    columnId: 'runtime-column:uploaded-news',
    columnName: '晚间新闻',
    channelId: 'dragon',
    defaultProgramType: 'news',
    source: 'imported',
    draftConstraintKind: 'program',
  },
]

describe('DemoRuntimeFacade explicit range layout routing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('turns LLM timeout into recoverable foreground feedback without mutating draft or playlist', async () => {
    layoutIntentRecognizeMock.mockResolvedValueOnce({
      mode: 'clarify',
      confidence: 0.1,
      reasoning: 'not enough layout signal',
    })
    taskClassifierClassifyMock.mockResolvedValueOnce({
      mode: 'clarify',
      confidence: 0,
      reasoning: '模型这次没有及时返回。',
      suggestedParams: {
        llmFailure: {
          stage: 'task_classification',
          reason: 'timeout',
          message: '模型这次没有及时返回。',
          rawMessage: 'LLM request failed after 1 attempt: LLM 网络请求超时，请检查网络或稍后重试。',
          canRetry: true,
        },
      },
    })
    const facade = new DemoRuntimeFacade()

    const result = await facade.submitInstruction({
      scheduleState: createScheduleState({ playlistType: 'rotation', rotationDurationSeconds: 3 * 60 * 60 }),
      userInput: '这张轮播单按前面想法继续策划一下',
      currentSchedule: [],
      history: [],
      layoutDraftEnabled: true,
    })

    expect(result.kind).toBe('message')
    if (result.kind !== 'message') {
      throw new Error('expected recoverable message decision')
    }
    expect(result.statusHint).toBe('failed')
    expect(result.feedback.processType).toBe('error')
    expect(result.feedback.content).toContain('没有修改草案或播单')
    expect(result.feedback.content).toContain('重试')
    expect(result.feedback.details).toMatchObject({
      canRetry: true,
      noMutation: true,
      recoverableUserInput: '这张轮播单按前面想法继续策划一下',
    })
    // 验证失败信封数据流已打通（A18）
    const envelope = (result.feedback.details as Record<string, unknown>).recoverableFailureEnvelope as Record<string, unknown> | undefined
    expect(envelope).toBeDefined()
    expect(envelope?.kind).toBe('llm_timeout')
    expect(envelope?.noMutation).toBe(true)
    expect(Array.isArray(envelope?.quickReplies)).toBe(true)
    expect(envelope?.quickReplies).toContainEqual(expect.objectContaining({ label: '重试' }))
    expect(result.layoutDraft).toBeUndefined()
  })

  it('routes explicit time-range scheduling intent to formal orchestration unless the user asks for a draft', async () => {
    mockPlannerFormalAction({
      mode: 'partial_generate',
      taskKind: 'local_refill',
      useLayoutDraft: false,
      targetTimeRange: { start: '12:45:00', end: '13:00:00' },
      searchKeywords: ['生命树电视剧'],
    })
    const facade = new DemoRuntimeFacade()

    const result = await facade.submitInstruction({
      scheduleState: createScheduleState(),
      userInput: '12:45到13:00安排生命树电视剧',
      currentSchedule: [],
      history: [],
      layoutDraftEnabled: true,
      agentCoreEnabled: true,
      inputSource: 'user',
    })

    expect(result.kind).toBe('orchestration')
    if (result.kind !== 'orchestration') {
      throw new Error('expected formal orchestration decision')
    }

    expect(result.orchestrationRequest.mode).toBe('partial_generate')
    expect(result.orchestrationRequest.layoutDraft).toBeUndefined()
    expect(result.feedback.details?.usesLayoutDraft).toBe(false)
  })

  it('still creates a layout draft when an explicit time-range request asks for a draft', async () => {
    mockPlannerDraftAction({
      type: 'prepare_layout_draft',
      targetTimeRange: { start: '12:45:00', end: '13:00:00' },
      semanticLabel: '生命树电视剧',
      programTypeHint: 'drama',
    })
    const facade = new DemoRuntimeFacade()

    const result = await facade.submitInstruction({
      scheduleState: createScheduleState(),
      userInput: '生成12:45到13:00的版面草案，安排生命树电视剧',
      currentSchedule: [],
      history: [],
      layoutDraftEnabled: true,
      agentCoreEnabled: true,
      inputSource: 'user',
    })

    if (result.kind !== 'layout_draft') {
      throw new Error(`expected layout draft decision: ${result.feedback.content}`)
    }
    expect(result.kind).toBe('layout_draft')

    expect(result.draft.coverage).toEqual({ start: '12:45:00', end: '13:00:00' })
    expect(result.draft.columns[0]?.semanticLabel).toContain('生命树')
    expect(result.feedback.details?.orchestrationMode).toBe('full_generate')
  })

  it('routes rotation gap filling to formal orchestration only when a draft exists', async () => {
    mockPlannerFormalAction({ mode: 'partial_generate', taskKind: 'overall_refill', useLayoutDraft: true })
    const facade = new DemoRuntimeFacade()
    const currentLayoutDraft = createRotationDurationDraft()

    const result = await facade.submitInstruction({
      scheduleState: createScheduleState({
        playlistType: 'rotation',
        isEmpty: false,
        itemCount: 1,
        gapCount: 2,
        rotationStrategy: 'content_match',
      }),
      userInput: '补齐当前所有空窗',
      currentSchedule: [],
      currentLayoutDraft,
      history: [],
      agentCoreEnabled: true,
      layoutDraftEnabled: true,
      preferDraftFirstFormalOrchestration: true,
      inputSource: 'user',
    })

    expect(result.kind).toBe('orchestration')
    if (result.kind !== 'orchestration') {
      throw new Error('expected formal orchestration decision')
    }

    expect(result.orchestrationRequest.mode).toBe('partial_generate')
    expect(result.orchestrationRequest.layoutDraft).toBe(currentLayoutDraft)
    expect(result.feedback.content).toContain('正式编排')
    expect(result.feedback.details?.usesLayoutDraft).toBe(true)
  })

  it('blocks rotation formal orchestration when there is no draft but still leaves atomic commands to the atomic path', async () => {
    mockPlannerFormalAction({ mode: 'partial_generate', taskKind: 'overall_refill', useLayoutDraft: false })
    const facade = new DemoRuntimeFacade()

    const result = await facade.submitInstruction({
      scheduleState: createScheduleState({
        playlistType: 'rotation',
        isEmpty: false,
        itemCount: 1,
        gapCount: 2,
        rotationStrategy: 'content_match',
      }),
      userInput: '补齐当前所有空窗',
      currentSchedule: [],
      history: [],
      agentCoreEnabled: true,
      layoutDraftEnabled: true,
      preferDraftFirstFormalOrchestration: true,
      inputSource: 'user',
    })

    expect(result.kind).toBe('message')
    if (result.kind !== 'message') {
      throw new Error('expected rotation draft requirement message')
    }

    expect(result.feedback.content).toContain('轮播单还没有可用草案')
    expect(result.feedback.content).toContain('单条插入、删除、移动、替换可以直接说')
    expect(result.feedback.details?.atomicCommandsAllowed).toBe(true)
  })

  it('blocks rotation all-day orchestration without a draft', async () => {
    mockPlannerFormalAction({ mode: 'full_generate', taskKind: 'full_day', useLayoutDraft: false })
    const facade = new DemoRuntimeFacade()

    const result = await facade.submitInstruction({
      scheduleState: createScheduleState({
        playlistType: 'rotation',
        isEmpty: false,
        itemCount: 1,
        gapCount: 2,
        rotationStrategy: 'content_match',
      }),
      userInput: '帮我全天编排',
      currentSchedule: [],
      history: [],
      agentCoreEnabled: true,
      layoutDraftEnabled: true,
      preferDraftFirstFormalOrchestration: true,
      inputSource: 'user',
    })

    expect(result.kind).toBe('message')
    if (result.kind !== 'message') {
      throw new Error('expected rotation all-day draft requirement message')
    }

    expect(result.feedback.content).toContain('轮播单还没有可用草案')
    expect(result.feedback.content).toContain('不能直接整体编排')
    expect(result.feedback.details?.atomicCommandsAllowed).toBe(true)
  })

  it('keeps classifier gap-filling fallback on formal orchestration when draft-first routing is enabled', async () => {
    const facade = new DemoRuntimeFacade()
    const currentLayoutDraft = createLayoutDraft()
    layoutIntentRecognizeMock.mockResolvedValueOnce({
      mode: 'clarify',
      confidence: 0.1,
      reasoning: 'not a layout draft request',
    })
    taskClassifierClassifyMock.mockResolvedValueOnce({
      mode: 'partial_generate',
      confidence: 0.9,
      reasoning: 'LLM recognized this as formal gap filling.',
    })

    const result = await facade.submitInstruction({
      scheduleState: createScheduleState({
        playlistType: 'tv',
        isEmpty: false,
        itemCount: 2,
        gapCount: 3,
      }),
      userInput: '把剩余空白都安排掉',
      currentSchedule: [],
      currentLayoutDraft,
      history: [],
      layoutDraftEnabled: true,
      preferDraftFirstFormalOrchestration: true,
    })

    expect(result.kind).toBe('orchestration')
    if (result.kind !== 'orchestration') {
      throw new Error('expected formal orchestration decision')
    }

    expect(result.orchestrationRequest.mode).toBe('partial_generate')
    expect(result.orchestrationRequest.layoutDraft).toBeUndefined()
    expect(result.feedback.content).toContain('正式编排')
    expect(result.feedback.details?.usesLayoutDraft).toBe(false)
  })

  it('attaches the current draft only when formal orchestration explicitly references the draft', async () => {
    mockPlannerFormalAction({
      action: 'commit_layout_draft',
      mode: 'partial_generate',
      taskKind: 'local_refill',
      useLayoutDraft: true,
      targetTimeRange: { start: '13:00:00', end: '18:00:00' },
    })
    const facade = new DemoRuntimeFacade()
    const currentLayoutDraft = createLayoutDraft()

    const result = await facade.submitInstruction({
      scheduleState: createScheduleState({
        playlistType: 'tv',
        isEmpty: false,
        itemCount: 3,
        gapCount: 2,
      }),
      userInput: '参考草案补齐13点到18点空窗',
      currentSchedule: [],
      currentLayoutDraft,
      currentLayoutDraftMode: 'full_generate',
      history: [],
      layoutDraftEnabled: true,
      agentCoreEnabled: true,
      inputSource: 'user',
    })

    expect(result.kind).toBe('layout_commit')
    if (result.kind !== 'layout_commit') {
      throw new Error('expected layout-backed orchestration decision')
    }

    expect(result.orchestrationRequest.mode).toBe('partial_generate')
    expect(result.orchestrationRequest.layoutDraft).toBe(currentLayoutDraft)
    expect(result.orchestrationRequest.targetTimeRange).toEqual(currentLayoutDraft.coverage)
    expect(result.feedback.details?.layoutSource).toBe(currentLayoutDraft.source)
  })

  it('does not attach the current draft when partial scheduling does not reference the draft', async () => {
    mockPlannerFormalAction({
      mode: 'partial_generate',
      taskKind: 'local_refill',
      useLayoutDraft: false,
      targetTimeRange: { start: '13:00:00', end: '18:00:00' },
      searchKeywords: ['电视剧'],
    })
    const facade = new DemoRuntimeFacade()
    const currentLayoutDraft = createLayoutDraft()
    taskClassifierClassifyMock.mockResolvedValueOnce({
      mode: 'partial_generate',
      confidence: 0.9,
      reasoning: 'formal scheduling without layout draft reference',
    })

    const result = await facade.submitInstruction({
      scheduleState: createScheduleState({
        playlistType: 'tv',
        isEmpty: false,
        itemCount: 2,
        gapCount: 1,
      }),
      userInput: '下午排入电视剧',
      currentSchedule: [],
      currentLayoutDraft,
      history: [],
      layoutDraftEnabled: true,
      agentCoreEnabled: true,
      inputSource: 'user',
    })

    expect(result.kind).toBe('orchestration')
    if (result.kind !== 'orchestration') {
      throw new Error('expected formal orchestration decision')
    }

    expect(result.orchestrationRequest.mode).toBe('partial_generate')
    expect(result.orchestrationRequest.layoutDraft).toBeUndefined()
    expect(result.feedback.details?.usesLayoutDraft).toBe(false)
  })

  it('allows explicit draft-backed local gap filling even when one draft segment has no candidate', async () => {
    const facade = new DemoRuntimeFacade()
    const currentLayoutDraft = createLayoutDraft()
    previewFeasibilityMock.mockReturnValue({
      ok: false,
      summary: {
        readyCount: currentLayoutDraft.layoutReference.slots.length - 1,
        warningCount: 0,
        blockedCount: 1,
      },
      segments: currentLayoutDraft.layoutReference.slots.map((slot, index) => ({
        segmentId: slot.id,
        label: currentLayoutDraft.columns[index]?.semanticLabel ?? currentLayoutDraft.columns[index]?.columnName ?? slot.id,
        startTime: slot.startTime,
        endTime: slot.endTime,
        status: index === currentLayoutDraft.layoutReference.slots.length - 1 ? 'blocked' : 'ready',
        blockerKind: index === currentLayoutDraft.layoutReference.slots.length - 1 ? 'keyword' : undefined,
        matchedCandidateCount: index === currentLayoutDraft.layoutReference.slots.length - 1 ? 0 : 3,
        reasons: index === currentLayoutDraft.layoutReference.slots.length - 1 ? ['当前栏目暂未命中候选。'] : [],
      })),
    })

    const result = await facade.submitInstruction({
      scheduleState: createScheduleState({
        playlistType: 'tv',
        isEmpty: false,
        itemCount: 3,
        gapCount: 2,
      }),
      userInput: '参考草案补齐13点到18点空窗',
      currentSchedule: [],
      currentLayoutDraft,
      history: [],
      layoutDraftEnabled: true,
    })

    expect(result.kind).toBe('layout_commit')
    if (result.kind !== 'layout_commit') {
      throw new Error('expected layout-backed partial orchestration decision')
    }

    expect(result.orchestrationRequest.mode).toBe('partial_generate')
    expect(result.orchestrationRequest.layoutDraft).toBe(currentLayoutDraft)
  })

  it('switches to the channel default layout draft from natural language without starting formal orchestration', async () => {
    const facade = new DemoRuntimeFacade()

    const result = await facade.submitInstruction({
      scheduleState: createScheduleState({
        playlistType: 'tv',
        isEmpty: false,
        itemCount: 2,
        gapCount: 1,
      }),
      userInput: '切回频道默认版面草案',
      currentSchedule: [],
      history: [],
      layoutDraftEnabled: true,
    })

    if (result.kind !== 'layout_draft') {
      throw new Error(`expected layout draft decision: ${result.feedback.content}`)
    }
    expect(result.kind).toBe('layout_draft')

    expect(result.draft.source).toBe('channel_default')
    expect(result.feedback.content).toContain('当前频道默认版面')
    expect(result.feedback.details?.layoutSource).toBe('channel_default')
  })

  it('switches the active TV draft to yesterday from natural language without starting formal orchestration', async () => {
    const facade = new DemoRuntimeFacade()

    const result = await facade.submitInstruction({
      scheduleState: createScheduleState({
        playlistType: 'tv',
        date: '2026-03-25',
        isEmpty: false,
        itemCount: 2,
        gapCount: 1,
      }),
      userInput: '还是按照昨天的版面草案来',
      currentSchedule: [],
      history: [],
      layoutDraftEnabled: true,
    })

    expect(result.kind).toBe('layout_draft')
    if (result.kind !== 'layout_draft') {
      throw new Error('expected yesterday layout draft switch')
    }

    expect(result.draft.source).toBe('channel_default')
    expect(result.feedback.content).toContain('2026-03-24 的频道版面')
    expect(result.feedback.details?.sourceDate).toBe('2026-03-24')
    expect(result.feedback.details?.layoutSource).toBe('channel_default')
    expect('orchestrationRequest' in result).toBe(false)
  })

  it('switches to an uploaded layout draft from natural language and preserves uploaded constraints', async () => {
    setRuntimeLayout({
      sourceFileName: 'dragon-uploaded-layout.xlsx',
      channelId: 'dragon',
      date: '2026-03-25',
      effectiveFrom: '2026-03-01',
      effectiveTo: '2026-06-30',
      version: 5,
      templateMode: 'weekday_sheet',
      warnings: [],
      layoutReference: uploadedLayoutReference,
      columns: uploadedColumns,
    })

    const facade = new DemoRuntimeFacade()

    const result = await facade.submitInstruction({
      scheduleState: createScheduleState({
        playlistType: 'tv',
        isEmpty: false,
        itemCount: 2,
        gapCount: 1,
      }),
      userInput: '切换到上传版面草案',
      currentSchedule: [],
      history: [],
      layoutDraftEnabled: true,
    })

    expect(result.kind).toBe('layout_draft')
    if (result.kind !== 'layout_draft') {
      throw new Error('expected layout draft decision')
    }

    expect(result.draft.source).toBe('uploaded')
    expect(result.draft.effectiveFrom).toBe('2026-03-01')
    expect(result.draft.effectiveTo).toBe('2026-06-30')
    expect(result.draft.columns[0]?.draftConstraintKind).toBe('program')
    expect(result.feedback.content).toContain('dragon-uploaded-layout.xlsx')
    expect(result.feedback.details?.sourceFileName).toBe('dragon-uploaded-layout.xlsx')
  })

  it('switches from uploaded layout back to the default TV draft and commits that active draft', async () => {
    setRuntimeLayout({
      sourceFileName: 'dragon-uploaded-layout.xlsx',
      channelId: 'dragon',
      date: '2026-03-25',
      effectiveFrom: '2026-03-01',
      effectiveTo: '2026-06-30',
      version: 5,
      templateMode: 'weekday_sheet',
      warnings: [],
      layoutReference: uploadedLayoutReference,
      columns: uploadedColumns,
    })

    const facade = new DemoRuntimeFacade()
    const scheduleState = createScheduleState({
      playlistType: 'tv',
      isEmpty: false,
      itemCount: 2,
      gapCount: 1,
    })

    const uploadedDecision = await facade.submitInstruction({
      scheduleState,
      userInput: '切换到上传版面草案',
      currentSchedule: [],
      history: [],
      layoutDraftEnabled: true,
    })
    expect(uploadedDecision.kind).toBe('layout_draft')
    if (uploadedDecision.kind !== 'layout_draft') {
      throw new Error('expected uploaded draft switch')
    }
    expect(uploadedDecision.draft.source).toBe('uploaded')

    const defaultDecision = await facade.submitInstruction({
      scheduleState,
      userInput: '切回频道默认版面草案',
      currentSchedule: [],
      currentLayoutDraft: uploadedDecision.draft,
      history: [],
      layoutDraftEnabled: true,
    })
    expect(defaultDecision.kind).toBe('layout_draft')
    if (defaultDecision.kind !== 'layout_draft') {
      throw new Error('expected default draft switch')
    }
    expect(defaultDecision.draft.source).toBe('channel_default')
    expect(defaultDecision.feedback.content).toContain('当前频道默认版面')
    expect(defaultDecision.feedback.details?.layoutSource).toBe('channel_default')
    expect(defaultDecision.feedback.details?.sourceFileName).toBeUndefined()

    const commitDecision = await facade.submitInstruction({
      scheduleState,
      userInput: '参考草案补齐当前所有空窗',
      currentSchedule: [],
      currentLayoutDraft: defaultDecision.draft,
      history: [],
      layoutDraftEnabled: true,
    })
    expect(commitDecision.kind).toBe('layout_commit')
    if (commitDecision.kind !== 'layout_commit') {
      throw new Error('expected active default draft commit')
    }
    expect(commitDecision.draft.source).toBe('channel_default')
    expect(commitDecision.orchestrationRequest.layoutDraft?.source).toBe('channel_default')
  })

  it('front foreground mode blocks layout drafts and asks for atomic scheduling details', async () => {
    mockPlannerDraftAction({ type: 'prepare_layout_draft' })
    const facade = new DemoRuntimeFacade()

    const result = await facade.submitInstruction({
      scheduleState: createScheduleState(),
      userInput: '生成12:45到13:00的版面草案，安排生命树电视剧',
      currentSchedule: [],
      history: [],
      agentCoreEnabled: true,
      layoutDraftEnabled: false,
      inputSource: 'user',
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
    mockPlannerDraftAction({
      type: 'prepare_layout_draft',
      segments: [
        { start: '09:00:00', end: '12:00:00', semanticLabel: '品质剧场：纵有疾风起', programTypeHint: 'drama', sequential: true },
        { start: '12:00:00', end: '12:30:00', semanticLabel: '午间新闻', programTypeHint: 'news' },
      ],
    })
    llmClientChatMock.mockResolvedValueOnce({
      content: JSON.stringify(buildMockLayoutDraftSpec({ start: '09:00:00', end: '12:30:00' }, [
        { label: '品质剧场：纵有疾风起', startTime: '09:00:00', endTime: '12:00:00', programType: 'drama', queryHints: ['品质剧场：纵有疾风起', '纯电视频道', '顺播', '接昨天'], sequential: true },
        { label: '午间新闻', startTime: '12:00:00', endTime: '12:30:00', programType: 'news', queryHints: ['午间新闻'] },
      ])),
    })
    const facade = new DemoRuntimeFacade()

    const result = await facade.submitInstruction({
      scheduleState: createScheduleState(),
      userInput: '生成版面草案：按纯电视频道，09:00到12:00继续播品质剧场：纵有疾风起，接昨天进度顺播；12:00到12:30安排午间新闻',
      currentSchedule: [],
      history: [],
      agentCoreEnabled: true,
      layoutDraftEnabled: true,
      inputSource: 'user',
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

  it('keeps explicit range drafts on the TV channel strategy inside a TV playlist', async () => {
    mockPlannerDraftAction({ type: 'prepare_layout_draft' })
    const facade = new DemoRuntimeFacade()

    const result = await facade.submitInstruction({
      scheduleState: {
        ...createScheduleState(),
        playlistType: 'tv',
      },
      userInput: '生成9点到12点的版面草案，编排东方剧场',
      currentSchedule: [],
      history: [],
      agentCoreEnabled: true,
      layoutDraftEnabled: true,
      inputSource: 'user',
    })

    expect(result.kind).toBe('layout_draft')
    if (result.kind !== 'layout_draft') {
      throw new Error('expected layout draft decision')
    }

    expect(result.draft.strategyProfile?.kind).toBe('tv_channel')
    expect(result.draft.strategyProfile?.label).toBe('电视频道顺播策略')
    expect(result.draft.strategyProfile?.requiresPreviousSchedule).toBe(true)
  })

  it('marks outdoor live carousel drafts as content-match-first when the user asks for matching content', async () => {
    mockPlannerDraftAction({ type: 'prepare_layout_draft' })
    const facade = new DemoRuntimeFacade()

    const result = await facade.submitInstruction({
      scheduleState: createScheduleState(),
      userInput: '我准备在静安寺进行户外直播，准备一个14:00到15:00的轮播版面草案，内容匹配优先',
      currentSchedule: [],
      history: [],
      agentCoreEnabled: true,
      layoutDraftEnabled: true,
      inputSource: 'user',
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
    mockPlannerDraftAction({
      type: 'prepare_layout_draft',
      targetTimeRange: { start: '14:00:00', end: '15:00:00' },
      semanticLabel: '静安寺户外直播',
      programTypeHint: 'news_magazine',
    })
    const facade = new DemoRuntimeFacade()

    const result = await facade.submitInstruction({
      scheduleState: createScheduleState(),
      userInput: '我准备在静安寺进行户外直播，准备一个14:00到15:00的轮播版面草案',
      currentSchedule: [],
      history: [],
      agentCoreEnabled: true,
      layoutDraftEnabled: true,
      inputSource: 'user',
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
    mockPlannerDraftAction({ type: 'prepare_layout_draft' })
    const facade = new DemoRuntimeFacade()

    const result = await facade.submitInstruction({
      scheduleState: createScheduleState(),
      userInput: '14:00到15:00做一版轮播版面草案，优先选择高收视率节目',
      currentSchedule: [],
      history: [],
      agentCoreEnabled: true,
      layoutDraftEnabled: true,
      inputSource: 'user',
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

  it('keeps explicit carousel layout draft requests from being swallowed by rotation strategy switching', async () => {
    const facade = new DemoRuntimeFacade()

    const result = await facade.submitInstruction({
      scheduleState: {
        ...createScheduleState(),
        playlistType: 'rotation',
        rotationStrategy: 'content_match',
      },
      userInput: '生成一个14:00到15:00的轮播版面草案，主题是静安寺户外直播花絮，内容匹配优先',
      currentSchedule: [],
      history: [],
      layoutDraftEnabled: true,
    })

    expect(result.kind).toBe('layout_draft')
    if (result.kind !== 'layout_draft') {
      throw new Error('expected layout draft decision')
    }

    expect(result.draft.strategyProfile?.kind).toBe('carousel')
    expect(result.draft.strategyProfile?.selectionPriority).toBe('content_match')
    expect(result.draft.coverage).toEqual({ start: '14:00:00', end: '15:00:00' })
  })

  it('marks carousel drafts as trending-first when the user asks for currently hot programs', async () => {
    mockPlannerDraftAction({ type: 'prepare_layout_draft' })
    const facade = new DemoRuntimeFacade()

    const result = await facade.submitInstruction({
      scheduleState: createScheduleState(),
      userInput: '14:00到15:00做一版轮播版面草案，优先选择当前热播节目',
      currentSchedule: [],
      history: [],
      agentCoreEnabled: true,
      layoutDraftEnabled: true,
      inputSource: 'user',
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
    mockPlannerDraftAction({
      type: 'prepare_layout_draft',
      targetTimeRange: { start: '09:30:00', end: '10:15:00' },
      semanticLabel: '品质剧场：纵有疾风起',
      programTypeHint: 'drama',
      segments: [{
        start: '09:30:00',
        end: '10:15:00',
        semanticLabel: '品质剧场：纵有疾风起',
        programTypeHint: 'drama',
        sequential: true,
      }],
    })
    const facade = new DemoRuntimeFacade()

    const result = await facade.submitInstruction({
      scheduleState: createScheduleState(),
      userInput: '生成版面草案：按纯电视频道编排，09:30到10:15品质剧场顺着昨天继续播',
      currentSchedule: [],
      history: [],
      agentCoreEnabled: true,
      layoutDraftEnabled: true,
      inputSource: 'user',
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
    mockPlannerDraftAction({
      type: 'prepare_layout_draft',
      targetTimeRange: { start: '09:45:00', end: '10:30:00' },
      semanticLabel: '品质剧场：纵有疾风起',
      programTypeHint: 'drama',
      segments: [{
        start: '09:45:00',
        end: '10:30:00',
        semanticLabel: '品质剧场：纵有疾风起',
        programTypeHint: 'drama',
        sequential: true,
      }],
    })
    const facade = new DemoRuntimeFacade()

    const result = await facade.submitInstruction({
      scheduleState: createScheduleState(),
      userInput: '生成版面草案：按纯电视频道，09:45到10:30继续播品质剧场：纵有疾风起，顺着当前版面补中间集',
      currentSchedule: [],
      history: [],
      agentCoreEnabled: true,
      layoutDraftEnabled: true,
      inputSource: 'user',
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
      userInput: '生成下午以城市服务为主的版面草案',
      coverage: { start: '13:00:00', end: '18:00:00' },
      label: '城市服务',
    },
    {
      userInput: '生成黄金档主打综艺的版面草案',
      coverage: { start: '19:00:00', end: '20:00:00' },
      label: '综艺',
    },
    {
      userInput: '生成晚间民生新闻多一点的版面草案',
      coverage: { start: '18:00:00', end: '23:00:00' },
      label: '民生新闻',
    },
  ])('routes daypart segment intent to a layout draft from LLM-structured output: $userInput', async ({ userInput, coverage, label }) => {
    mockPlannerDraftAction({
      type: 'prepare_layout_draft',
      targetTimeRange: coverage,
      semanticLabel: label,
    })
    const facade = new DemoRuntimeFacade()

    const result = await facade.submitInstruction({
      scheduleState: createScheduleState(),
      userInput,
      currentSchedule: [],
      history: [],
      agentCoreEnabled: true,
      layoutDraftEnabled: true,
      inputSource: 'user',
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
      userInput: '生成发布会开播前垫一点现场导视的版面草案',
      coverage: { start: '18:00:00', end: '23:00:00' },
      label: '现场导视',
      programType: 'news_magazine',
    },
    {
      userInput: '生成赛前给赛事直播加一段预热的版面草案',
      coverage: { start: '18:00:00', end: '23:00:00' },
      label: '赛事预热',
      programType: 'news_magazine',
    },
    {
      userInput: '生成黄金档前后加个轻松过渡的版面草案',
      coverage: { start: '19:00:00', end: '20:00:00' },
      label: '轻松过渡',
      programType: 'news_magazine',
    },
  ])('routes relative event scheduling intent to a layout draft from LLM-structured output: $userInput', async ({ userInput, coverage, label, programType }) => {
    mockPlannerDraftAction({
      type: 'prepare_layout_draft',
      targetTimeRange: coverage,
      semanticLabel: label,
      programTypeHint: programType,
    })
    const facade = new DemoRuntimeFacade()

    const result = await facade.submitInstruction({
      scheduleState: createScheduleState(),
      userInput,
      currentSchedule: [],
      history: [],
      agentCoreEnabled: true,
      layoutDraftEnabled: true,
      inputSource: 'user',
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

  it('builds rotation duration-segment drafts without requiring fixed clock slots', async () => {
    const facade = new DemoRuntimeFacade()
    llmClientChatMock.mockResolvedValueOnce({
      content: JSON.stringify({
        coverage: { start: '00:00:00', end: '06:00:00' },
        segments: [
          {
            id: 'draft-segment-1',
            label: '景点宣传片',
            startTime: '00:00:00',
            endTime: '03:00:00',
            programType: 'news_magazine',
            queryHints: ['景点宣传片'],
          },
          {
            id: 'draft-segment-2',
            label: '垫片',
            startTime: '03:00:00',
            endTime: '06:00:00',
            programType: 'news_magazine',
            queryHints: ['垫片'],
          },
        ],
      }),
    })

    const result = await facade.submitInstruction({
      scheduleState: createScheduleState({
        playlistType: 'rotation',
        channelName: '轮播单',
        rotationStrategy: 'content_match',
      }),
      userInput: '制作一份总时长6小时的轮播草案，先放景点宣传片，再放垫片，内容匹配优先',
      currentSchedule: [],
      history: [],
    })

    if (result.kind !== 'layout_draft') throw new Error(`expected rotation duration draft: ${result.feedback.content}`)
    expect(result.kind).toBe('layout_draft')
    expect(result.draft.strategyProfile?.kind).toBe('carousel')
    expect(result.draft.draftKind).toBe('duration_segments')
    expect(result.draft.targetDurationSeconds).toBe(6 * 3600)
    expect(result.draft.coverage).toEqual({ start: '00:00:00', end: '06:00:00' })
    expect(result.draft.durationSegments).toEqual([
      expect.objectContaining({
        label: '景点宣传片',
        contentHint: '景点宣传片',
        targetDurationSeconds: 3 * 3600,
        selectionPriority: 'content_match',
        repeatPolicy: 'avoid_repeat',
      }),
      expect.objectContaining({
        label: '垫片',
        contentHint: '垫片',
        targetDurationSeconds: 3 * 3600,
        selectionPriority: 'content_match',
        fallbackPolicy: 'ask_user',
      }),
    ])
    expect(result.feedback.details?.draftKind).toBe('duration_segments')
    expect(result.feedback.content).toContain('确认前不会写入正式轮播单')
    expect(result.feedback.content).toContain('按这个开始编排')
    expect(result.feedback.content).not.toContain('候选')
  })

  it('does not invent rotation segments when the LLM returns only a broad draft direction', async () => {
    const facade = new DemoRuntimeFacade()

    const result = await facade.submitInstruction({
      scheduleState: createScheduleState({
        playlistType: 'rotation',
        channelName: '轮播单',
        rotationStrategy: 'content_match',
        rotationDurationSeconds: 3 * 3600,
      }),
      userInput: '生成一个时长3小时，由上海市16个区标志景点组成的轮播单，每个区的时长是10分钟',
      currentSchedule: [],
      history: [],
    })

    if (result.kind !== 'layout_draft') throw new Error(`expected rotation duration draft: ${result.feedback.content}`)
    expect(result.draft.draftKind).toBe('duration_segments')
    expect(result.draft.targetDurationSeconds).toBe(3 * 3600)
    expect(result.draft.durationSegments).toHaveLength(1)
    expect(result.draft.durationSegments?.[0]?.label).toContain('上海市16个区')
    expect(result.feedback.content).toContain('一块轮播草案')
    expect(result.feedback.content).toContain('继续')
    expect(result.feedback.content).not.toContain('候选')
  })

  it('applies LLM-generated structured refinements to the current rotation draft', async () => {
    const facade = new DemoRuntimeFacade()
    const currentLayoutDraft = createRotationDurationDraft()
    llmClientChatMock.mockResolvedValueOnce({
      content: JSON.stringify({
        actions: [
          {
            type: 'refine_layout_draft',
            rotationDurationSeconds: 3 * 3600,
            semanticLabel: '静安区静安寺宣传片、闵行区仙鹤墓园、徐汇区天主教堂',
            segments: [
              {
                start: '00:00:00',
                end: '01:00:00',
                semanticLabel: '静安区静安寺宣传片',
                programTypeHint: 'news_magazine',
              },
              {
                start: '01:00:00',
                end: '02:00:00',
                semanticLabel: '闵行区仙鹤墓园',
                programTypeHint: 'news_magazine',
              },
              {
                start: '02:00:00',
                end: '03:00:00',
                semanticLabel: '徐汇区天主教堂',
                programTypeHint: 'news_magazine',
              },
            ],
          },
        ],
        assistantReplyDraft: '我按三个小时重新整理草案。',
        reasoning: '用户明确要求三段轮播草案。',
      }),
    })

    const result = await facade.submitInstruction({
      scheduleState: createScheduleState({
        playlistType: 'rotation',
        channelName: '轮播单',
        rotationStrategy: 'content_match',
        rotationDurationSeconds: 3 * 3600,
      }),
      userInput: '草案改成第一小时静安区静安寺宣传片，第二小时闵行区仙鹤墓园，第三小时徐汇区天主教堂',
      currentSchedule: [],
      currentLayoutDraft,
      preferLayoutDraftRefine: true,
      history: [],
      agentCoreEnabled: true,
      layoutDraftEnabled: true,
      inputSource: 'user',
    })

    if (result.kind !== 'layout_draft') throw new Error(`expected rotation draft refine: ${result.feedback.content}`)
    expect(result.draft.durationSegments).toHaveLength(3)
    expect(result.draft.durationSegments?.map((segment) => segment.label)).toEqual([
      '静安区静安寺宣传片',
      '闵行区仙鹤墓园',
      '徐汇区天主教堂',
    ])
    expect(result.draft.durationSegments?.map((segment) => segment.targetDurationSeconds)).toEqual([
      3600,
      3600,
      3600,
    ])
  })

  it('uses LLM target segment fields without confusing segment 10 with segment 1', async () => {
    const facade = new DemoRuntimeFacade()
    const currentLayoutDraft = createNumberedRotationDraft()
    llmClientChatMock.mockResolvedValueOnce({
      content: JSON.stringify({
        actions: [
          {
            type: 'refine_layout_draft',
            rotationDurationSeconds: 100 * 60,
            targetSegmentIndex: 10,
            targetSegmentLabel: '亚洲队10介绍',
            semanticLabel: '中国队介绍',
            programTypeHint: 'news_magazine',
          },
        ],
        assistantReplyDraft: '我会把第10段从亚洲队10介绍调整为中国队介绍，只更新草案，不写正式节目。',
        reasoning: '用户按草案块名称提出局部微调。',
      }),
    })

    const result = await facade.submitInstruction({
      scheduleState: createScheduleState({
        playlistType: 'rotation',
        channelName: '轮播单',
        rotationStrategy: 'content_match',
        rotationDurationSeconds: 100 * 60,
      }),
      userInput: '亚洲队10介绍换成中国队介绍',
      currentSchedule: [],
      currentLayoutDraft,
      preferLayoutDraftRefine: true,
      history: [],
      agentCoreEnabled: true,
      layoutDraftEnabled: true,
      inputSource: 'user',
    })

    if (result.kind !== 'layout_draft') throw new Error(`expected numbered rotation draft refine: ${result.feedback.content}`)
    expect(result.draft.durationSegments).toHaveLength(10)
    expect(result.draft.durationSegments?.[0]?.label).toBe('亚洲队1介绍')
    expect(result.draft.durationSegments?.[8]?.label).toBe('亚洲队9介绍')
    expect(result.draft.durationSegments?.[9]?.label).toBe('中国队介绍')
    expect(result.draft.durationSegments?.[9]?.targetDurationSeconds).toBe(10 * 60)
    expect(new Set(result.draft.layoutReference.slots.map((slot) => slot.id)).size).toBe(10)
    const visibleLabels = result.draft.layoutReference.slots.map((slot, index) => {
      const durationSegment = result.draft.durationSegments?.find((segment) => segment.id === slot.id)
        ?? result.draft.durationSegments?.[index]
      return durationSegment?.label
    })
    expect(visibleLabels[0]).toBe('亚洲队1介绍')
    expect(visibleLabels[9]).toBe('中国队介绍')
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
    llmClientChatMock.mockImplementation(mockLayoutDraftLlmResponse)
    previewFeasibilityMock.mockReturnValue({
      ok: true,
      summary: {
        readyCount: 0,
        warningCount: 0,
        blockedCount: 0,
      },
      segments: [],
    })
    taskClassifierClassifyMock.mockResolvedValue({
      mode: 'clarify',
      confidence: 0.1,
      reasoning: 'unused',
    })
    layoutIntentRecognizeMock.mockResolvedValue({
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
    })
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

    if (result.kind !== 'layout_draft') {
      throw new Error(`expected layout draft decision: ${result.feedback.content}`)
    }
    expect(result.kind).toBe('layout_draft')

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
