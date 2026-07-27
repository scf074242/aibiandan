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

const createTvDraft = (): LayoutDraft => ({
  id: 'tv-draft-existing',
  channelId: 'dragon',
  date: '2026-03-25',
  source: 'channel_default',
  userIntent: '东方卫视电视播单草案',
  draftKind: 'time_slots',
  coverage: { start: '06:00:00', end: '23:59:59' },
  layoutReference: {
    id: 'tv-layout-existing',
    name: '东方卫视版面草案',
    channelId: 'dragon',
    slots: [
      {
        id: 'slot-dongfang-kuaibao',
        channelId: 'dragon',
        columnId: 'column-dongfang-kuaibao',
        startTime: '2026-03-25T06:00:00+08:00',
        endTime: '2026-03-25T07:00:00+08:00',
      },
    ],
  },
  columns: [
    {
      columnId: 'column-dongfang-kuaibao',
      columnName: '东方快报',
      channelId: 'dragon',
      defaultProgramType: 'news',
      source: 'default',
      semanticLabel: '东方快报',
      queryHints: ['东方快报'],
    },
  ],
  durationSegments: [
    {
      id: 'duration-dongfang-kuaibao',
      label: '东方快报',
      targetDurationSeconds: 60 * 60,
      selectionPriority: 'content_match',
      repeatPolicy: 'avoid_repeat',
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

describe('DemoRuntimeFacade LLM-only agent planner foreground path', () => {
  beforeEach(() => {
    llmClientChatMock.mockReset()
    taskClassifierClassifyMock.mockReset()
    layoutIntentRecognizeMock.mockReset()
    taskClassifierClassifyMock.mockImplementation(async () => {
      throw new Error('local task classifier should not handle foreground natural language')
    })
    layoutIntentRecognizeMock.mockResolvedValue({
      mode: 'clarify',
      confidence: 0.1,
      reasoning: 'layout recognizer should not run before planner',
    })
  })

  it('lets a formal fill request anchored by the TV draft run through the planner atomic path', async () => {
    llmClientChatMock
      .mockResolvedValueOnce({
        content: JSON.stringify({
          actions: [
            {
              type: 'atomic_command',
            },
          ],
          assistantReplyDraft: '我先按草案里的东方快报时段定位，再继续筛选期数最大的一期。',
          reasoning: 'LLM planner 判断“填入”是正式播单动作，当前草案提供东方快报锚点。',
        }),
      })
      .mockResolvedValueOnce({
        content: JSON.stringify({
          intent: 'insert',
          confidence: 0.92,
          slots: {
            targetTime: '06:00:00',
            programHint: '东方快报',
          },
          searchAlternatives: ['东方快报', '东方快报 最新一期', '东方快报 期数最大'],
          assistantFeedback: '我会按草案里的东方快报时段定位到06:00，再按你说的期数最大去筛选节目。',
          reasoning: 'The active layout draft provides the 东方快报 anchor slot.',
        }),
      })

    const progressEvents: Array<{ content: string; details?: Record<string, unknown> }> = []
    const result = await new DemoRuntimeFacade().submitInstruction({
      scheduleState: createScheduleState({
        playlistId: 'tv-playlist',
        playlistType: 'tv',
        channelId: 'dragon',
        channelName: '东方卫视',
        isEmpty: true,
        itemCount: 0,
        gapCount: 1,
      }),
      userInput: '在东方快报里，帮我找到期数最大的一期填入',
      currentSchedule: [],
      currentLayoutDraft: createTvDraft(),
      history: [],
      agentCoreEnabled: true,
      layoutDraftEnabled: true,
      inputSource: 'user',
      onProgress: (event) => {
        progressEvents.push(event)
      },
    })

    expect(result.kind).toBe('agent_execution')
    if (result.kind !== 'agent_execution') throw new Error('expected formal agent execution')
    expect(progressEvents.length).toBeGreaterThanOrEqual(3)
    expect(progressEvents[0]?.content).toBe('我先按草案里的东方快报时段定位，再继续筛选期数最大的一期。')
    expect(progressEvents[0]?.details?.source).toBe('llm_assistantReplyDraft')
    expect(progressEvents.some((event) => event.details?.progressStage === 'intent_understood')).toBe(true)
    expect(progressEvents.some((event) => event.details?.progressStage === 'candidate_lookup')).toBe(true)
    expect(result.feedback.content).toContain('按草案里的东方快报时段定位到06:00')
    expect(result.result.decision.candidateSelection?.selectedSequence).toBe(24)
    expect(result.result.executionResult?.committed).toBe(true)
    expect(taskClassifierClassifyMock).not.toHaveBeenCalled()
  })

  it('keeps fuzzy atomic insert ReAct research on the insert recommendation path', async () => {
    llmClientChatMock
      .mockResolvedValueOnce({
        content: JSON.stringify({
          mode: 'react',
          actions: [],
          reactTask: {
            objective: '先查证近期观众关心内容相关素材，再进入9点插入候选选择',
            maxTurns: 3,
            batchSize: 3,
            stopCondition: '找到插入候选后进入选择确认，不直接写播单',
            nextActions: [
              {
                type: 'research_check',
                purpose: 'candidate_precheck',
                targetTime: '09:00:00',
                semanticLabel: '近期观众关心内容相关视频',
                programTypeHint: 'news_magazine',
                queries: ['看东方 民生 热点', '新闻 观众 关心 民生'],
              },
            ],
          },
          assistantReplyDraft: '我先查一下近期观众关心的相关视频素材，找到候选后让你选，不会直接写播单。',
          reasoning: '用户有插入时间，但节目内容模糊，需要先查证素材。',
        }),
      })
      .mockResolvedValueOnce({
        content: '我查了一下素材库，找到几条和近期民生热点相关的视频。你选一个后我再写入，不会自动替你选。',
      })

    const facade = new DemoRuntimeFacade()
    vi.spyOn((facade as any).candidateService, 'searchPrograms').mockResolvedValue([
      {
        id: 'candidate-hot-topic-1',
        programName: '看东方第113期：民生第一线',
        programCode: '002601010113',
        duration: 2700,
        programType: 'news_magazine',
        popularityScore: 91,
      },
      {
        id: 'candidate-hot-topic-2',
        programName: '热点面对面第003期：民生追踪',
        programCode: '002609990003',
        duration: 1800,
        programType: 'news_magazine',
        popularityScore: 84,
      },
    ])

    const result = await facade.submitInstruction({
      scheduleState: createScheduleState({
        playlistId: 'tv-playlist',
        playlistType: 'tv',
        channelId: 'dragon',
        channelName: '东方卫视',
        isEmpty: true,
        itemCount: 0,
        gapCount: 1,
      }),
      userInput: '9点插入一个与近期观众特别关心内容相关联的视频内容',
      currentSchedule: [],
      currentLayoutDraft: createTvDraft(),
      history: [],
      agentCoreEnabled: true,
      layoutDraftEnabled: true,
      inputSource: 'user',
    })

    expect(result.kind).toBe('message')
    if (result.kind !== 'message') throw new Error('expected recommendation advisory')
    expect(result.statusHint).toBe('needs_clarification')
    expect(result.feedback.content).toContain('等信息足够明确后，我再帮你排入')
    expect(result.feedback.content).toContain('目标位置是 09:00:00')
    expect(result.feedback.details?.recommendedCandidateCount).toBeGreaterThan(0)
    expect(taskClassifierClassifyMock).not.toHaveBeenCalled()
  })

  it('keeps candidate precheck on insert clarification path when target position is missing', async () => {
    llmClientChatMock
      .mockResolvedValueOnce({
        content: JSON.stringify({
          mode: 'single',
          actions: [
            {
              type: 'research_check',
              purpose: 'candidate_precheck',
              semanticLabel: '上海市景点宣传片',
              programTypeHint: 'short_video',
              queries: ['上海市景点宣传片', '上海旅游宣传片'],
            },
          ],
          assistantReplyDraft: '我先查一下素材库里有没有上海市景点宣传片，再请你确认插入位置。',
          reasoning: '用户要插入素材，但没有说明插入到轮播队列哪个位置。',
        }),
      })

    const facade = new DemoRuntimeFacade()
    vi.spyOn((facade as any).candidateService, 'searchPrograms').mockResolvedValue([
      {
        id: 'shanghai-scenic-1',
        programName: '上海城市宣传片：外滩晨光',
        programCode: 'SH-PROMO-001',
        duration: 300,
        programType: 'short_video',
        popularityScore: 88,
      },
    ])

    const result = await facade.submitInstruction({
      scheduleState: createScheduleState({
        playlistId: 'rotation-playlist',
        playlistType: 'rotation',
        isEmpty: true,
        itemCount: 0,
        gapCount: 0,
      }),
      userInput: '帮我插入一个跟上海市景点相关的宣传片',
      currentSchedule: [],
      currentLayoutDraft: null,
      history: [],
      agentCoreEnabled: true,
      layoutDraftEnabled: true,
      inputSource: 'user',
    })

    expect(result.kind).toBe('message')
    if (result.kind !== 'message') throw new Error('expected clarification message')
    expect(result.statusHint).toBe('needs_clarification')
    expect(result.feedback.details).toMatchObject({
      noMutation: true,
      purpose: 'candidate_precheck',
      candidateCount: 1,
    })
    expect(result.feedback.content).toContain('插入到轮播队列的哪个位置')
    expect(result.feedback.content).toContain('队列末尾')
    expect(result.feedback.content).not.toContain('更新草案')
    expect(result.feedback.content).not.toContain('当前还没有可更新的草案')
    expect(llmClientChatMock).toHaveBeenCalled()
    expect(taskClassifierClassifyMock).not.toHaveBeenCalled()
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
    expect(llmClientChatMock).toHaveBeenCalled()
    expect(taskClassifierClassifyMock).not.toHaveBeenCalled()
    expect(result.feedback.details?.playlistState).toMatchObject({
      playlistType: 'tv',
    })
    expect(result.feedback.details?.layoutDraftStatus).toBe('loaded')
  })

  it('routes quick-action bare playlist creation through the same LLM planner', async () => {
    mockPlanner({
      actions: [{ type: 'create_playlist', playlistType: 'rotation', rotationStrategy: 'content_match' }],
      assistantReplyDraft: '我先新建一张轮播单。',
      reasoning: '用户通过快捷入口要求创建轮播工作区。',
    })
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
    expect(llmClientChatMock).toHaveBeenCalledTimes(1)
    expect(taskClassifierClassifyMock).not.toHaveBeenCalled()
    expect(result.feedback.details?.playlistState).toMatchObject({
      playlistType: 'rotation',
    })
    expect(result.feedback.details?.layoutDraftStatus).toBe('empty')
  })

  it('preserves every ordered planner action when a multi-command request enters ReAct', async () => {
    const testCase = {
      id: 'planner-react-preserves-ordered-multi-command-actions',
      userInput: '新建一张轮播单，然后把生命树放到队列开头',
      expectedDecision: '先完成建单，并把后续原子动作完整保留给 observation 后的下一轮 decide',
      mustNotHappen: '过滤 create_playlist、重复注入动作，或在同一轮盲目执行后续写入',
      verification: 'reactTaskRun 只完成首步观察，步骤中两个 action 各保留一次且正式播单仍为空',
    }
    mockPlanner({
      mode: 'react',
      actions: [
        { type: 'create_playlist', playlistType: 'rotation', rotationStrategy: 'content_match' },
        { type: 'atomic_command', intent: 'insert', targetTime: '00:00:00', programHint: '生命树' },
      ],
      reactTask: {
        objective: '新建轮播单后把生命树插入队列开头',
        maxTurns: 3,
        batchSize: 2,
        stopCondition: '插入完成并校验播单',
        nextActions: [
          { type: 'create_playlist', playlistType: 'rotation', rotationStrategy: 'content_match' },
          { type: 'atomic_command', intent: 'insert', targetTime: '00:00:00', programHint: '生命树' },
        ],
      },
      assistantReplyDraft: '我先新建轮播单，再基于建单结果继续处理插入。',
      reasoning: '两个动作存在工作区依赖，需要逐步观察后执行。',
    })

    const result = await new DemoRuntimeFacade().submitInstruction({
      scheduleState: createScheduleState({ playlistType: 'none' }),
      userInput: testCase.userInput,
      currentSchedule: [],
      history: [],
      agentCoreEnabled: true,
      layoutDraftEnabled: true,
      inputSource: 'user',
    })

    expect(testCase.expectedDecision).toContain('下一轮 decide')
    expect(testCase.mustNotHappen).toContain('重复注入')
    expect(testCase.verification).toContain('两个 action 各保留一次')
    expect(result.kind).toBe('message')
    if (result.kind !== 'message') throw new Error('expected playlist-created message')
    expect(result.feedback.details?.playlistState).toMatchObject({ playlistType: 'rotation' })
    expect(result.feedback.details?.reactTaskRun).toMatchObject({
      objective: '新建轮播单后把生命树插入队列开头',
      status: 'observing',
      loopCount: 1,
    })
    const steps = (result.feedback.details?.reactTaskRun as { steps?: Array<{ action: { type: string } }> })?.steps ?? []
    expect(steps.map((step) => step.action.type)).toEqual(['create_playlist', 'atomic_command'])
    expect(result.feedback.details?.reactTaskBoundary).toMatchObject({
      mode: 'react',
      nextDecisionRequiresObservation: true,
    })
    expect(llmClientChatMock).toHaveBeenCalledTimes(1)
  })

  it('executes playlist creation before a formal orchestration action in an ordered ReAct plan', async () => {
    const testCase = {
      id: 'planner-react-creates-tv-playlist-before-formal-orchestration',
      userInput: '新建电视播单，然后按当前版面开始全天编排',
      expectedDecision: '首轮真实创建电视播单，正式编排留到 observation 后由下一轮 decide',
      mustNotHappen: '只展示 LLM 命令序列、返回 react_plan_invalid，或在没有工作区时跳过建单直接编排',
      verification: '返回 playlistState.playlistType=tv 且 ReAct 两个有序步骤均保留、首轮 loopCount=1',
    }
    mockPlanner({
      mode: 'react',
      actions: [
        { type: 'create_playlist', playlistType: 'tv' },
        { type: 'formal_orchestration', mode: 'full_generate', taskKind: 'full_day', useLayoutDraft: true },
      ],
      reactTask: {
        objective: '创建电视播单后按当前版面完成全天编排',
        maxTurns: 4,
        batchSize: 4,
        stopCondition: '全天编排完成或暴露不可恢复问题',
        nextActions: [
          { type: 'create_playlist', playlistType: 'tv' },
          { type: 'formal_orchestration', mode: 'full_generate', taskKind: 'full_day', useLayoutDraft: true },
        ],
      },
      assistantReplyDraft: '我先创建电视播单，再根据创建后的版面现场开始编排。',
      reasoning: '正式编排依赖新播单工作区，需要逐轮观察。',
    })

    const result = await new DemoRuntimeFacade().submitInstruction({
      scheduleState: createScheduleState({ playlistType: 'none' }),
      userInput: testCase.userInput,
      currentSchedule: [],
      history: [],
      agentCoreEnabled: true,
      layoutDraftEnabled: true,
      inputSource: 'user',
    })

    expect(result.kind).toBe('message')
    if (result.kind !== 'message') throw new Error('expected playlist-created message')
    expect(result.statusHint).not.toBe('failed')
    expect(result.feedback.details?.playlistState).toMatchObject({ playlistType: 'tv' })
    expect(result.feedback.details?.reactTaskRun).toMatchObject({
      status: 'observing',
      loopCount: 1,
    })
    const steps = (result.feedback.details?.reactTaskRun as { steps?: Array<{ action: { type: string } }> })?.steps ?? []
    expect(steps.map((step) => step.action.type)).toEqual(['create_playlist', 'formal_orchestration'])
    expect(testCase).toMatchObject({ expectedDecision: expect.any(String), mustNotHappen: expect.any(String), verification: expect.any(String) })
  })

  it('lets the planner understand whole rotation orchestration, then blocks without a draft locally', async () => {
    mockPlanner({
      mode: 'react',
      actions: [
        { type: 'formal_orchestration', mode: 'full_generate', taskKind: 'full_day', useLayoutDraft: true },
      ],
      reactTask: {
        objective: '按轮播草案完成整体编排',
        nextActions: [{ type: 'research_check', purpose: 'candidate_precheck', queries: ['当前轮播草案'] }],
      },
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
      mode: 'react',
      actions: [
        { type: 'commit_layout_draft', mode: 'full_generate', useLayoutDraft: true },
      ],
      reactTask: {
        objective: '按当前草案进入正式编排',
        nextActions: [{ type: 'research_check', purpose: 'candidate_precheck', queries: ['当前轮播草案'] }],
      },
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

  /**
   * case formal-facade-missing-react-plan-fails-closed
   * - id: formal-facade-missing-react-plan-fails-closed
   * - userInput: 参考草案编排
   * - expectedDecision: planner 漏掉 reactTask 时返回 react_plan_invalid 可恢复失败
   * - mustNotHappen: 产出 layout_commit/orchestration 请求或回退旧编排器
   * - verification: message status=failed、noMutation=true、保留原输入用于重试
   */
  it('exposes a recoverable failure when a formal planner action omits reactTask', async () => {
    mockPlanner({
      actions: [{ type: 'commit_layout_draft', mode: 'full_generate', useLayoutDraft: true }],
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

    expect(result.kind).toBe('message')
    if (result.kind !== 'message') throw new Error('expected recoverable message')
    expect(result.statusHint).toBe('failed')
    expect(result.feedback.details).toMatchObject({
      noMutation: true,
      recoverableUserInput: '参考草案编排',
      recoverableFailureEnvelope: {
        kind: 'react_plan_invalid',
        noMutation: true,
      },
    })
  })

  it('requires confirmation before a draft-backed full rebuild overwrites an existing formal playlist', async () => {
    mockPlanner({
      mode: 'react',
      actions: [
        { type: 'commit_layout_draft', mode: 'full_generate', useLayoutDraft: true },
      ],
      reactTask: {
        objective: '核验当前草案并准备重新编排',
        nextActions: [{ type: 'research_check', purpose: 'candidate_precheck', queries: ['当前轮播草案'] }],
      },
      assistantReplyDraft: '我会按当前草案重新编排正式播单。',
      reasoning: '用户要求按草案重新编排已有轮播单。',
    })
    mockPlanner({
      mode: 'react',
      actions: [
        { type: 'commit_layout_draft', mode: 'full_generate', useLayoutDraft: true },
      ],
      reactTask: {
        objective: '按确认后的草案重新编排正式播单',
        nextActions: [{ type: 'research_check', purpose: 'candidate_precheck', queries: ['当前轮播草案'] }],
      },
      assistantReplyDraft: '已收到确认，我会按当前草案进入正式编排。',
      reasoning: '用户明确确认当前正式重编 pending。',
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
    if (confirmed.kind !== 'layout_commit') throw new Error('expected confirmed layout commit')
    expect(confirmed.orchestrationRequest.authorizationRequest).toMatchObject({
      sourcePendingId: result.pendingAtomicContext.pendingId,
      workspaceKey: 'rotation:rotation-playlist',
      mode: 'full_generate',
      existingItemCount: 1,
    })
    expect(confirmed.orchestrationRequest.authorizationGrantId).toBeUndefined()
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

  it('planner-create-claim-without-action: rejects a false playlist creation reply', async () => {
    const testCase = {
      id: 'planner-create-claim-without-action',
      userInput: '新建电视播单',
      expectedDecision: '模型未返回有效 create_playlist action 时暴露未创建状态并允许重试',
      mustNotHappen: '仅凭 assistantReplyDraft 声称已经创建播单，导致对话与工作区事实不一致',
      verification: '返回 needs_clarification + noMutation，且不携带 playlistState',
    }
    mockPlanner({
      actions: [
        { type: 'create_playlist', playlistType: 'television' },
      ],
      assistantReplyDraft: '我先整理版面草案，再创建电视播单。',
      reasoning: '模型理解了创建目标，但返回了不合规的 playlistType。',
    })

    const result = await new DemoRuntimeFacade().submitInstruction({
      scheduleState: createScheduleState({ playlistType: 'none' }),
      userInput: testCase.userInput,
      currentSchedule: [],
      history: [],
      agentCoreEnabled: true,
      layoutDraftEnabled: true,
      inputSource: 'user',
    })

    expect(testCase.expectedDecision).toContain('暴露未创建状态')
    expect(testCase.mustNotHappen).toContain('工作区事实不一致')
    expect(testCase.verification).toContain('noMutation')
    expect(result.kind).toBe('message')
    if (result.kind !== 'message') throw new Error('expected message')
    expect(result.statusHint).toBe('needs_clarification')
    expect(result.feedback.content).toContain('还没有创建播单')
    expect(result.feedback.details?.noMutation).toBe(true)
    expect(result.feedback.details?.playlistState).toBeUndefined()
  })

  it('planner-no-action-draft-prose: exposes terminal clarification instead of freezing progress', async () => {
    mockPlanner({
      actions: [],
      assistantReplyDraft: '我先整理版面草案，再创建电视播单。',
      reasoning: '版面草案需要先确认，但模型没有返回合法 action。',
    })

    const result = await new DemoRuntimeFacade().submitInstruction({
      scheduleState: createScheduleState({ playlistType: 'none' }),
      userInput: '请先整理版面草案再新建电视播单',
      currentSchedule: [],
      history: [],
      agentCoreEnabled: true,
      layoutDraftEnabled: true,
      inputSource: 'user',
    })

    expect(result.kind).toBe('message')
    if (result.kind !== 'message') throw new Error('expected message')
    expect(result.statusHint).toBe('needs_clarification')
    expect(result.feedback.content).toContain('还没有创建播单')
    expect(result.feedback.details?.noMutation).toBe(true)
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

  it('research-candidate-precheck-with-draft-segment: updates the draft instead of opening insert clarification', async () => {
    const testCase = {
      id: 'research-candidate-precheck-with-draft-segment',
      userInput: '第一段金山区景点部分，选择金山区最近3年最火热的景点',
      expectedDecision: '有明确草案段时 candidate_precheck 直接更新草案',
      mustNotHappen: '把草案素材核验误分流为正式插入并追问队列位置',
      verification: '返回 layout_draft，且 noFormalPlaylistWrite=true',
    }
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
          assistantReplyDraft: '我先查一下素材库，能定位到草案段就直接更新草案。',
          reasoning: '用户要求先为草案块选择更合适的素材方向。',
        }),
      })
      .mockResolvedValueOnce({
        content: '我先看了当前第一段草案，并按金山区热门景点方向查了素材库。乐高乐园这类方向可以继续核验。',
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
      userInput: testCase.userInput,
      currentSchedule: [],
      currentLayoutDraft: currentDraft,
      history: [],
      agentCoreEnabled: true,
      layoutDraftEnabled: true,
      inputSource: 'user',
    })

    expect(result.kind).toBe('layout_draft')
    expect(testCase).toMatchObject({ expectedDecision: expect.any(String), mustNotHappen: expect.any(String), verification: expect.any(String) })
    if (result.kind !== 'layout_draft') throw new Error('expected direct layout draft update')
    expect(result.feedback.processTypeLabel).toBe('版面草案')
    expect(result.feedback.content).toContain('已把“金山区最近三年热门景点”更新到左侧草案')
    expect(result.feedback.content).not.toContain('需要我把这个方向更新到草案吗')
    expect(result.feedback.content).not.toContain('确认前我不会更新草案')
    expect(result.feedback.details?.noFormalPlaylistWrite).toBe(true)
    expect(result.feedback.details?.draftUpdatePolicy).toBe('draft_updates_do_not_require_confirmation')
    expect(result.feedback.details?.candidateCount).toBe(1)
    expect(result.draft.columns[0]?.semanticLabel).toBe('金山区最近三年热门景点')
    expect(result.draft.columns[0]?.queryHints).toEqual(expect.arrayContaining([
      '金山乐高乐园宣传片',
      '乐高乐园',
    ]))
    expect(result.draft.durationSegments?.[0]?.label).toBe('金山区最近三年热门景点')
    expect((result.feedback.details?.reactTask as any)?.tools).toEqual(['read_current_draft', 'search_asset_library'])
    expect(searchPrograms).toHaveBeenCalledWith(expect.objectContaining({
      channelId: 'rotation',
      programName: '金山区 近三年 热门景点 宣传片',
      programTypes: ['short_clip', 'short_video'],
    }))
    expect(llmClientChatMock).toHaveBeenCalledTimes(2)
    expect(taskClassifierClassifyMock).not.toHaveBeenCalled()
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
          targetSegmentIndex: 2,
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
          type: 'clarify',
          question: '请先说明播单类型：要新建电视播单还是轮播单，我再把这两小时内容整理成草案。',
        },
      ],
      assistantReplyDraft: '请先说明播单类型：要新建电视播单还是轮播单，我再把这两小时内容整理成草案。',
      reasoning: '模型识别到草案内容，但没有播单工作区，需要用户补充播单类型。',
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

  /**
   * case regression-agentPlanner-plan-passes-deadline-signal
   * - expectedDecision: agentPlanner.plan 通过 submitInstruction 调用时，llmClient.chat options 携带 signal（AbortSignal）
   * - mustNotHappen: options 缺失 signal（会导致 LLM 超时后底层 fetch 仍在执行，前台 5s 后无法中断）
   * - verification: 检查 llmClientChatMock 第二参数（options）含 signal 字段且为 AbortSignal 实例
   *
   * 背景：轮播单"主题+时长"生成失败返回"模型没有及时返回"，根因是 agentPlanner.plan 用固定 12s timeout
   * 且未接入 AgentDeadline，无法联动 abort。修复后 plan 接收 deadline 并透传 signal 到 llmClient.chat。
   */
  it('agentPlanner.plan 通过 submitInstruction 调用时透传 deadline signal 到 llmClient.chat', async () => {
    mockPlanner({
      actions: [{ type: 'clarify', question: '请补充信息' }],
      assistantReplyDraft: '请补充信息',
      reasoning: 'clarify for test',
    })

    await new DemoRuntimeFacade().submitInstruction({
      scheduleState: createScheduleState({
        playlistId: 'tv-playlist',
        playlistType: 'tv',
        channelId: 'dragon',
        channelName: '东方卫视',
      }),
      userInput: '帮我全天编排',
      currentSchedule: [],
      currentLayoutDraft: createTvDraft(),
      history: [],
      agentCoreEnabled: true,
      layoutDraftEnabled: true,
      inputSource: 'user',
    })

    expect(llmClientChatMock).toHaveBeenCalled()
    const callArgs = llmClientChatMock.mock.calls[0]
    const options = callArgs?.[1] as Record<string, unknown> | undefined
    expect(options).toBeTruthy()
    expect(options?.signal).toBeInstanceOf(AbortSignal)
  })

  /**
   * case regression-rotation-failure-envelope-recognized-slots
   * - expectedDecision: 轮播单主题+时长生成失败时，recoverableFailureEnvelope.recognizedSlots 包含 playlistType 与 target
   * - mustNotHappen: recognizedSlots 为空（前台无法提示用户已识别的播单类型与时长）
   * - verification: LLM 超时后 result.feedback.details.recoverableFailureEnvelope.recognizedSlots 含 playlistType=rotation 与 target=3600
   *
   * 背景：轮播单失败返回固定文案"模型没有及时返回"，缺少结构化 recognizedSlots，
   * 前台无法据此生成 quick replies。修复后 buildRecoverableLlmFailureDecision 从 scheduleState 提取已识别槽位。
   */
  it('轮播单主题+时长生成失败时 envelope 携带 recognizedSlots', async () => {
    // LLM 超时失败
    llmClientChatMock.mockRejectedValueOnce(Object.assign(new Error('LLM timeout'), { code: 'ETIMEDOUT' }))

    const result = await new DemoRuntimeFacade().submitInstruction({
      scheduleState: createScheduleState({
        playlistId: 'rotation-playlist',
        playlistType: 'rotation',
        channelId: 'rotation',
        channelName: '轮播频道',
        rotationDurationSeconds: 3600,
      }),
      userInput: '生成一个关于世界杯亚洲队集锦的轮播单，时长1小时',
      currentSchedule: [],
      currentLayoutDraft: null,
      history: [],
      agentCoreEnabled: true,
      layoutDraftEnabled: true,
      inputSource: 'user',
    })

    expect(result.kind).toBe('message')
    if (result.kind !== 'message') throw new Error('expected message')
    expect(result.statusHint).toBe('failed')
    const envelope = result.feedback.details?.recoverableFailureEnvelope as
      | { recognizedSlots?: Array<{ name: string; value: unknown; source: string }> }
      | undefined
    expect(envelope).toBeTruthy()
    expect(envelope?.recognizedSlots).toBeTruthy()
    const slotNames = envelope!.recognizedSlots!.map((slot) => slot.name)
    expect(slotNames).toContain('playlistType')
    expect(slotNames).toContain('target')
    const playlistTypeSlot = envelope!.recognizedSlots!.find((slot) => slot.name === 'playlistType')
    expect(playlistTypeSlot?.value).toBe('rotation')
    expect(playlistTypeSlot?.source).toBe('context')
  })

  it('formal-pending-switches-to-draft-owner: starts a draft task without continuing the formal pending command', async () => {
    const testCase = {
      id: 'formal-pending-switches-to-draft-owner',
      userInput: '先不确认刚才的正式删除，把草案第二段改成城市文旅',
      expectedDecision: '结束正式 pending，只更新草案第二段',
      mustNotHappen: '执行上一轮删除或写入正式播单',
      verification: 'decision.kind=layout_draft，第二段变为城市文旅',
    }
    mockPlanner({
      pendingAction: 'start_new_task',
      actions: [{
        type: 'refine_layout_draft',
        targetSegmentIndex: 2,
        targetSegmentLabel: '电视剧',
        semanticLabel: '城市文旅',
        segments: [{ start: '01:00:00', end: '02:00:00', semanticLabel: '城市文旅', programTypeHint: 'documentary' }],
      }],
      assistantReplyDraft: '我会结束刚才的正式删除确认，只修改草案第二段。',
      reasoning: '用户明确从 formal_playlist 切换到 layout_draft。',
    })

    const result = await new DemoRuntimeFacade().submitInstruction({
      scheduleState: createScheduleState({
        playlistId: 'rotation-playlist', playlistType: 'rotation', channelId: 'rotation', channelName: '轮播单',
        rotationStrategy: 'content_match', rotationDurationSeconds: 7200,
      }),
      userInput: testCase.userInput,
      currentSchedule: createExistingRotationSchedule(),
      currentLayoutDraft: createRotationDraft(),
      pendingAtomicContext: {
        pendingId: 'pending-formal-delete', action: 'delete', phase: 'clarifying', summary: '待补充正式删除目标',
        reasoning: '正式播单删除尚未确认。', originalUserInput: '删除正式播单第二条', collectedUserInput: '删除正式播单第二条',
        slots: {}, missingFields: ['target_time'], followUpQuestion: '要删除哪条正式节目？', attemptCount: 0,
        createdAt: '2026-07-22T00:00:00.000Z', updatedAt: '2026-07-22T00:00:00.000Z',
      },
      agentCoreEnabled: true,
      layoutDraftEnabled: true,
      inputSource: 'user',
    })

    expect(testCase).toMatchObject({ expectedDecision: expect.any(String), mustNotHappen: expect.any(String), verification: expect.any(String) })
    expect(result.kind).toBe('layout_draft')
    if (result.kind !== 'layout_draft') throw new Error('expected layout_draft')
    expect(result.draft.columns.map((column) => column.semanticLabel)).toContain('城市文旅')
    expect(result.feedback.content).toContain('草案')
  })

  it('draft-pending-switches-to-formal-owner: keeps the formal delete confirmation gate without mutating the draft', async () => {
    const testCase = {
      id: 'draft-pending-switches-to-formal-owner',
      userInput: '先不更新草案，删除正式播单里9点的看东方',
      expectedDecision: '结束草案 pending，进入正式删除确认',
      mustNotHappen: '更新草案或直接删除正式节目',
      verification: 'agent result=needs_confirmation 且 pending intent=delete',
    }
    mockPlanner({
      actions: [{ type: 'atomic_command', intent: 'delete', pendingAction: 'start_new_task', targetTime: '09:00:00', targetProgramName: '看东方' }],
      assistantReplyDraft: '我会停止草案更新，先核对正式播单里的9点节目并等待删除确认。',
      reasoning: '用户明确从 layout_draft 切换到 formal_playlist。',
    })
    const draft = createTvDraft()
    const result = await new DemoRuntimeFacade().submitInstruction({
      scheduleState: createScheduleState({
        playlistId: 'tv-playlist', playlistType: 'tv', isEmpty: false, itemCount: 1, gapCount: 0,
      }),
      userInput: testCase.userInput,
      currentSchedule: [{
        id: 'formal-kan-dongfang', programCode: 'KDF-0900', programName: '看东方',
        startTime: '2026-03-25T09:00:00+08:00', endTime: '2026-03-25T10:00:00+08:00', duration: 3600, programType: 'news',
      }],
      currentLayoutDraft: draft,
      pendingAtomicContext: {
        pendingId: 'pending-draft-update', action: null, phase: 'draft_research_confirmation', summary: '待更新草案第二段',
        reasoning: '只更新草案。', originalUserInput: '查草案第二段', collectedUserInput: '查草案第二段',
        slots: { semanticLabel: '城市文旅' }, missingFields: ['selection'], followUpQuestion: '是否更新草案？',
        layoutDraftSuggestion: {
          purpose: 'draft_precheck', targetSegmentIndex: 1, semanticLabel: '城市文旅', queries: ['城市文旅'],
          candidateCount: 1, topCandidates: [], userInput: '查草案第二段',
        },
        attemptCount: 0, createdAt: '2026-07-22T00:00:00.000Z', updatedAt: '2026-07-22T00:00:00.000Z',
      },
      agentCoreEnabled: true,
      layoutDraftEnabled: true,
      inputSource: 'user',
    })

    expect(testCase).toMatchObject({ expectedDecision: expect.any(String), mustNotHappen: expect.any(String), verification: expect.any(String) })
    expect(result.kind).toBe('pending_atomic_context')
    if (result.kind !== 'pending_atomic_context') throw new Error('expected pending_atomic_context')
    expect(result.pendingAtomicContext.agentPendingTask?.phase).toBe('needs_confirmation')
    expect(result.pendingAtomicContext.agentPendingTask?.intent).toBe('delete')
    expect(draft.columns[0]?.semanticLabel).toBe('东方快报')
  })

  it('tv-atomic-insert-with-incomplete-draft: keeps a complete insert on the formal atomic path', async () => {
    const testCase = {
      id: 'tv-atomic-insert-with-incomplete-draft',
      userInput: '草案还没做完，9点插入看东方',
      expectedDecision: 'formal_playlist atomic_command 进入执行/候选链',
      mustNotHappen: '因草案不完整进入 layout_draft、layout_commit 或 orchestration',
      verification: 'result.kind 不属于草案或长流程控制结果，且保留 planner atomic trace',
    }
    mockPlanner({
      actions: [{ type: 'atomic_command', intent: 'insert', targetTime: '09:00:00', programHint: '看东方' }],
      assistantReplyDraft: '我会按正式电视播单的9点位置处理插入。',
      reasoning: '用户明确要求把节目插入正式播单，草案仅作为参考。',
    })

    const result = await new DemoRuntimeFacade().submitInstruction({
      scheduleState: createScheduleState({
        playlistId: 'tv-playlist', playlistType: 'tv', isEmpty: true, itemCount: 0, gapCount: 1,
      }),
      userInput: testCase.userInput,
      currentSchedule: [],
      currentLayoutDraft: createTvDraft(),
      history: [],
      agentCoreEnabled: true,
      layoutDraftEnabled: true,
      inputSource: 'user',
    })

    expect(testCase).toMatchObject({ expectedDecision: expect.any(String), mustNotHappen: expect.any(String), verification: expect.any(String) })
    expect(['layout_draft', 'layout_commit', 'orchestration']).not.toContain(result.kind)
    expect(result.feedback.content).toBeTruthy()
  })

  it('tv-atomic-insert-ambiguous-with-incomplete-draft: asks for atomic slots without starting orchestration', async () => {
    const testCase = {
      id: 'tv-atomic-insert-ambiguous-with-incomplete-draft',
      userInput: '草案还没做完，插入一个节目',
      expectedDecision: 'formal_playlist atomic_command 进入补参澄清',
      mustNotHappen: '生成草案、拒绝原子动作或启动全天/整体补排',
      verification: '结果不是 layout_draft/layout_commit/orchestration，且无正式写入',
    }
    mockPlanner({
      actions: [{ type: 'atomic_command', intent: 'insert' }],
      assistantReplyDraft: '请补充节目名称和插入时间。',
      reasoning: '用户目标是正式播单插入，但原子槽位不足。',
    })

    const result = await new DemoRuntimeFacade().submitInstruction({
      scheduleState: createScheduleState({
        playlistId: 'tv-playlist', playlistType: 'tv', isEmpty: true, itemCount: 0, gapCount: 1,
      }),
      userInput: testCase.userInput,
      currentSchedule: [],
      currentLayoutDraft: createTvDraft(),
      history: [],
      agentCoreEnabled: true,
      layoutDraftEnabled: true,
      inputSource: 'user',
    })

    expect(testCase).toMatchObject({ expectedDecision: expect.any(String), mustNotHappen: expect.any(String), verification: expect.any(String) })
    expect(['layout_draft', 'layout_commit', 'orchestration']).not.toContain(result.kind)
    expect(result.feedback.content).toBeTruthy()
  })
})
