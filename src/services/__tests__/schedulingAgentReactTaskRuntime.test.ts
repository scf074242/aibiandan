import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { LayoutDraft, ScheduleState } from '@/types/orchestration'
import type { RuntimeScheduleItem } from '@/services/runtime/schedulingAgentRuntimeFacade'

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
        readyCount: 2,
        warningCount: 0,
        blockedCount: 0,
      },
      segments: [],
    })),
  }),
}))

import { SchedulingAgentRuntimeFacade } from '@/services/runtime/schedulingAgentRuntimeFacade'

const createScheduleState = (overrides: Partial<ScheduleState> = {}): ScheduleState => ({
  channelId: 'rotation',
  channelName: '轮播单',
  date: '2026-03-25',
  isEmpty: true,
  itemCount: 0,
  gapCount: 1,
  hasSelectedTimeRange: false,
  playlistType: 'rotation',
  rotationStrategy: 'content_match',
  rotationDurationSeconds: 2 * 60 * 60,
  ...overrides,
})

const createRotationDraft = (): LayoutDraft => ({
  id: 'rotation-draft-existing',
  channelId: 'rotation',
  date: '2026-03-25',
  source: 'generated',
  userIntent: '两小时上海景点轮播草案',
  draftKind: 'duration_segments',
  targetDurationSeconds: 2 * 60 * 60,
  coverage: { start: '00:00:00', end: '02:00:00' },
  layoutReference: {
    id: 'rotation-layout-existing',
    name: '轮播草案',
    channelId: 'rotation',
    slots: [
      {
        id: 'slot-jinshan',
        channelId: 'rotation',
        columnId: 'column-jinshan',
        startTime: '00:00:00',
        endTime: '01:00:00',
      },
      {
        id: 'slot-jingan',
        channelId: 'rotation',
        columnId: 'column-jingan',
        startTime: '01:00:00',
        endTime: '02:00:00',
      },
    ],
  },
  columns: [
    {
      columnId: 'column-jinshan',
      columnName: '金山区景点',
      channelId: 'rotation',
      defaultProgramType: 'documentary',
      source: 'generated',
      semanticLabel: '金山区景点',
      queryHints: ['金山', '景点', '上海文旅'],
    },
    {
      columnId: 'column-jingan',
      columnName: '静安区景点',
      channelId: 'rotation',
      defaultProgramType: 'documentary',
      source: 'generated',
      semanticLabel: '静安区景点',
      queryHints: ['静安区', '景点', '上海文旅'],
    },
  ],
  durationSegments: [
    {
      id: 'duration-jinshan',
      label: '金山区景点',
      targetDurationSeconds: 60 * 60,
      selectionPriority: 'content_match',
      repeatPolicy: 'avoid_repeat',
      fallbackPolicy: 'ask_user',
    },
    {
      id: 'duration-jingan',
      label: '静安区景点',
      targetDurationSeconds: 60 * 60,
      selectionPriority: 'content_match',
      repeatPolicy: 'avoid_repeat',
      fallbackPolicy: 'ask_user',
    },
  ],
})

const emptySchedule = (): RuntimeScheduleItem[] => []

describe('SchedulingAgentRuntimeFacade ReAct task execution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    taskClassifierClassifyMock.mockImplementation(async () => {
      throw new Error('local task classifier should not handle open scheduling language')
    })
    layoutIntentRecognizeMock.mockResolvedValue({
      mode: 'clarify',
      confidence: 0.1,
      reasoning: 'layout recognizer should not run before planner',
    })
  })

  it('runs a top-level ReAct research task through the formal foreground runtime without mutating the formal schedule', async () => {
    llmClientChatMock
      .mockResolvedValueOnce({
        content: JSON.stringify({
          mode: 'react',
          actions: [],
          reactTask: {
            objective: '先核验金山区热门景点素材，再决定是否更新草案',
            maxTurns: 3,
            batchSize: 4,
            stopCondition: '素材方向明确后进入草案确认，不直接写正式播单',
            nextActions: [
              {
                type: 'research_check',
                purpose: 'candidate_precheck',
                targetSegmentIndex: 1,
                semanticLabel: '金山区最近三年热门景点',
                programTypeHint: 'documentary',
                queries: ['金山区 近三年 热门景点 宣传片'],
              },
            ],
          },
          assistantReplyDraft: '我先查素材，确认前不会写入正式播单。',
          reasoning: '用户要求先查证素材，再决定是否调整草案。',
        }),
      })
      .mockResolvedValueOnce({
        content: '我先查了当前第一段草案和素材库，金山乐高乐园方向可以继续核验。确认前我不会更新草案，也不会写入节目。需要我把这个方向更新到草案吗？',
      })

    const facade = new SchedulingAgentRuntimeFacade()
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

    const result = await facade.submitInstruction({
      scheduleState: createScheduleState(),
      userInput: '第一段金山区景点部分，选择金山区最近3年最火热的景点',
      currentSchedule: emptySchedule(),
      currentLayoutDraft: createRotationDraft(),
      history: [],
      agentCoreEnabled: true,
      layoutDraftEnabled: true,
      inputSource: 'user',
    })

    expect(result.kind).toBe('pending_atomic_context')
    if (result.kind !== 'pending_atomic_context') throw new Error('expected pending research context')
    expect(result.pendingAtomicContext.phase).toBe('draft_research_confirmation')
    expect(result.pendingAtomicContext.layoutDraftSuggestion?.semanticLabel).toBe('金山区最近三年热门景点')
    expect(result.feedback.processTypeLabel).toBe('素材核验')
    expect(result.feedback.content).toContain('确认前我不会更新草案')
    expect(result.feedback.content).toContain('需要我把这个方向更新到草案吗')
    expect(result.feedback.details?.noMutation).toBe(true)
    expect(result.feedback.details?.candidateCount).toBe(1)
    expect(result.feedback.details?.reactTaskRun).toMatchObject({
      status: 'observing',
      loopCount: 1,
      objective: '先核验金山区热门景点素材，再决定是否更新草案',
      limits: {
        maxTurns: 3,
        batchSize: 4,
      },
    })
    expect(result.feedback.details?.reactTaskBoundary).toMatchObject({
      mode: 'react',
      serverMigratable: true,
      stateOwner: 'SchedulingReactTaskRuntime',
      nextDecisionRequiresObservation: true,
    })
    expect(searchPrograms).toHaveBeenCalledWith(expect.objectContaining({
      channelId: 'rotation',
      programName: '金山区 近三年 热门景点 宣传片',
      programTypes: ['documentary'],
      columnStrategy: 'prefer_channel',
    }))
    expect(taskClassifierClassifyMock).not.toHaveBeenCalled()
    expect(llmClientChatMock).toHaveBeenCalledTimes(2)
  })

  it('keeps ReAct state when the LLM also creates a rotation workspace and draft first', async () => {
    llmClientChatMock.mockResolvedValueOnce({
      content: JSON.stringify({
        mode: 'react',
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
                programTypeHint: 'documentary',
              },
            ],
          },
        ],
        reactTask: {
          objective: '新建草案后继续核验世界杯亚洲球队介绍素材',
          maxTurns: 3,
          batchSize: 3,
          stopCondition: '素材方向明确后引导用户是否正式编排',
          nextActions: [
            {
              type: 'research_check',
              purpose: 'candidate_precheck',
              targetSegmentIndex: 1,
              semanticLabel: '世界杯亚洲球队介绍',
              programTypeHint: 'documentary',
              queries: ['世界杯 亚洲球队 球队介绍'],
            },
          ],
        },
        assistantReplyDraft: '我先建立轮播单，并把世界杯亚洲球队介绍整理成一小时草案。',
        reasoning: '用户同时要求新建轮播单、整理草案，并希望后续查证素材。',
      }),
    })

    const result = await new SchedulingAgentRuntimeFacade().submitInstruction({
      scheduleState: createScheduleState({ playlistType: 'none' }),
      userInput: '新建一个世界杯的轮播单，主要涵盖亚洲各个球队的球队介绍，时长约1小时',
      currentSchedule: emptySchedule(),
      history: [],
      agentCoreEnabled: true,
      layoutDraftEnabled: true,
      inputSource: 'user',
    })

    expect(result.kind).toBe('message')
    if (result.kind !== 'message') throw new Error('expected playlist-created message')
    expect(result.feedback.details?.playlistState).toMatchObject({
      playlistType: 'rotation',
      rotationStrategy: 'content_match',
      rotationDurationSeconds: 3600,
    })
    expect(result.layoutDraft?.targetDurationSeconds).toBe(3600)
    expect(result.layoutDraft?.columns.map((column) => column.semanticLabel)).toEqual(['世界杯亚洲球队介绍'])
    expect(result.feedback.details?.reactTaskRun).toMatchObject({
      status: 'acting',
      objective: '新建草案后继续核验世界杯亚洲球队介绍素材',
      limits: {
        maxTurns: 3,
        batchSize: 3,
      },
    })
    expect(result.feedback.details?.reactTaskBoundary).toMatchObject({
      mode: 'react',
      stage: 'preflight',
      serverMigratable: true,
      stateOwner: 'SchedulingReactTaskRuntime',
      nextDecisionRequiresObservation: false,
      preflightActions: ['create_playlist', 'prepare_layout_draft'],
    })
    expect(taskClassifierClassifyMock).not.toHaveBeenCalled()
    expect(llmClientChatMock).toHaveBeenCalledTimes(1)
  })
})
