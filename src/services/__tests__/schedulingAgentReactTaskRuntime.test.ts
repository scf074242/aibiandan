import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { LayoutDraft, ScheduleState } from '@/types/orchestration'
import type { RuntimeScheduleItem } from '@/services/runtime/schedulingAgentRuntimeFacade'
import { canonicalSchedulingData } from '@/services/agent/canonicalSchedulingData'
import { AgentDeadline } from '@/services/agent/agentDeadline'
import { getAtomicCapabilities, resetAtomicCapabilities } from '@/services/atomicCapabilities'

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
import { getSchedulingReactTaskRuntime } from '@/services/runtime/reactTaskRuntime'

class InspectableSchedulingAgentRuntimeFacade extends SchedulingAgentRuntimeFacade {
  buildFormalGateway(input: Parameters<SchedulingAgentRuntimeFacade['submitInstruction']>[0]) {
    return this.buildAgentCoreDataGateway(input)
  }
}

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

const createThreeHourRotationDraft = (): LayoutDraft => {
  const draft = createRotationDraft()
  return {
    ...draft,
    id: 'rotation-draft-three-hours',
    userIntent: '三小时综合轮播草案',
    targetDurationSeconds: 3 * 60 * 60,
    coverage: { start: '00:00:00', end: '03:00:00' },
    layoutReference: {
      ...draft.layoutReference,
      slots: [
        ...draft.layoutReference.slots,
        {
          id: 'slot-pudong',
          channelId: 'rotation',
          columnId: 'column-pudong',
          startTime: '02:00:00',
          endTime: '03:00:00',
        },
      ],
    },
    columns: [
      ...draft.columns,
      {
        columnId: 'column-pudong',
        columnName: '浦东城市生活',
        channelId: 'rotation',
        defaultProgramType: 'documentary',
        source: 'generated',
        semanticLabel: '浦东城市生活',
        queryHints: ['浦东', '城市生活', '上海文旅'],
      },
    ],
    durationSegments: [
      ...(draft.durationSegments ?? []),
      {
        id: 'duration-pudong',
        label: '浦东城市生活',
        targetDurationSeconds: 3600,
        contentHint: '浦东、城市生活、上海文旅',
      },
    ],
  }
}

const emptySchedule = (): RuntimeScheduleItem[] => []

describe('SchedulingAgentRuntimeFacade ReAct task execution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetAtomicCapabilities()
    taskClassifierClassifyMock.mockImplementation(async () => {
      throw new Error('local task classifier should not handle open scheduling language')
    })
    layoutIntentRecognizeMock.mockResolvedValue({
      mode: 'clarify',
      confidence: 0.1,
      reasoning: 'layout recognizer should not run before planner',
    })
  })

  /**
   * case post9-rotation-compression-staged-react
   * - userInput: 确认按2小时草案正式压缩当前3小时轮播单
   * - expectedDecision: 同一 ReAct 请求第一次正式写入后，下一轮读取最近提交的5条现场并继续处理
   * - mustNotHappen: 下一轮重新读取最初6条前台快照，导致后续删除覆盖第一次结果
   * - verification: facade 正式 gateway commit 一次后 loadContext 与 atomic 正式现场均为5条
   */
  it('post9-rotation-compression-staged-react: keeps the latest formal state between ReAct writes', async () => {
    const candidates = canonicalSchedulingData.candidates.filter((candidate) => candidate.duration === 1800).slice(0, 6)
    expect(candidates).toHaveLength(6)
    const currentSchedule = candidates.map((candidate, index) => ({
      id: candidate.id,
      programCode: candidate.programCode,
      programName: candidate.programName,
      startTime: `0${Math.floor(index / 2)}:${index % 2 === 0 ? '00' : '30'}:00`,
      endTime: `0${Math.floor((index + 1) / 2)}:${(index + 1) % 2 === 0 ? '00' : '30'}:00`,
      duration: candidate.duration,
      programType: candidate.programType,
      sequence: index + 1,
    }))
    getAtomicCapabilities().loadItems(currentSchedule)
    const facade = new InspectableSchedulingAgentRuntimeFacade()
    const gateway = facade.buildFormalGateway({
      scheduleState: createScheduleState({
        playlistId: 'rotation-compression',
        isEmpty: false,
        itemCount: 6,
        gapCount: 0,
        rotationStrategy: 'trending',
        rotationDurationSeconds: 10_800,
      }),
      userInput: '确认按2小时草案正式压缩当前3小时轮播单',
      currentSchedule,
      history: [],
      layoutDraftEnabled: true,
    })
    const initial = await gateway.loadContext({
      userInput: '删除最低热度节目',
      channelId: 'rotation',
      date: '2026-03-25',
      playlistId: 'rotation-compression',
    })

    const committed = await gateway.commitScheduleItems({
      channelId: 'rotation',
      date: '2026-03-25',
      playlistId: 'rotation-compression',
      items: initial.scheduleItems.slice(0, 5),
      reason: 'post9:first-formal-delete',
    })
    const nextTurn = await gateway.loadContext({
      userInput: '继续处理剩余节目',
      channelId: 'rotation',
      date: '2026-03-25',
      playlistId: 'rotation-compression',
    })

    expect(committed.committed).toBe(true)
    expect(getAtomicCapabilities().getAllItems()).toHaveLength(5)
    expect(nextTurn.scheduleItems).toHaveLength(5)
    expect(nextTurn.bundle.sources.today.source).toBe('agent_commit_cache')
  })

  it('replaces stale foreground steps after observation when the editor changes the target', () => {
    const testCase = {
      id: 'react-observation-replaces-stale-pending-step',
      userInput: '确认，但把生命树换成上海宣传片',
      expectedDecision: '新 LLM 决策替换尚未执行的旧插入步骤',
      mustNotHappen: '继续执行旧的生命树步骤，或把新动作追加到旧 pending 后面',
      verification: '旧步骤为 blocked，新步骤唯一 pending，且旧步骤仍保留在 trace',
    }
    const runtime = getSchedulingReactTaskRuntime()
    const initial = runtime.startTask({
      originalUserInput: '新建轮播单后插入生命树',
      plannerTask: {
        objective: '建单后插入节目',
        maxTurns: 3,
        batchSize: 2,
        nextActions: [
          { type: 'create_playlist', playlistType: 'rotation' },
          { type: 'atomic_command', intent: 'insert', programHint: '生命树' },
        ],
      },
    })
    const observed = runtime.recordObservation({
      run: initial,
      type: 'user_feedback',
      summary: '轮播单已创建，用户改换节目关键词。',
    })
    const replaced = runtime.replacePendingActions({
      run: observed,
      nextActions: [{ type: 'atomic_command', intent: 'insert', programHint: '上海宣传片' }],
      reason: 'LLM 根据最新用户输入替换未执行动作',
    })

    expect(testCase.expectedDecision).toContain('替换')
    expect(testCase.mustNotHappen).toContain('旧的生命树')
    expect(testCase.verification).toContain('唯一 pending')
    expect(replaced.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({
        status: 'blocked',
        action: expect.objectContaining({ type: 'atomic_command', programHint: '生命树' }),
      }),
      expect.objectContaining({
        status: 'pending',
        action: expect.objectContaining({ type: 'atomic_command', programHint: '上海宣传片' }),
      }),
    ]))
    expect(replaced.steps.filter((step) => step.status === 'pending')).toHaveLength(1)
  })

  it('runs a top-level ReAct research task through the formal foreground runtime without mutating the formal schedule', async () => {
    llmClientChatMock
      .mockResolvedValueOnce({
        content: JSON.stringify({
          mode: 'react',
          actions: [],
          reactTask: {
            objective: '先核验金山区热门景点素材，再更新草案',
            maxTurns: 3,
            batchSize: 4,
            stopCondition: '素材方向明确后更新草案，不直接写正式播单',
            nextActions: [
              {
                type: 'research_check',
                purpose: 'draft_precheck',
                targetSegmentIndex: 1,
                semanticLabel: '金山区最近三年热门景点',
                programTypeHint: 'documentary',
                queries: ['金山区 近三年 热门景点 宣传片'],
              },
            ],
          },
          assistantReplyDraft: '我先查素材，能定位到草案段就直接更新草案；正式播单不会被写入。',
          reasoning: '用户要求先查证素材，再调整草案。',
        }),
      })
      .mockResolvedValueOnce({
        content: '我先查了当前第一段草案和素材库，金山乐高乐园方向可以继续核验。',
      })

    const canonicalScenicCandidate = canonicalSchedulingData.candidates.find((candidate) => (
      candidate.contentTags?.some((tag) => tag.includes('景点'))
    ))
    if (!canonicalScenicCandidate) throw new Error('data_fixture_missing: canonical scenic candidate')
    const facade = new SchedulingAgentRuntimeFacade()
    const searchPrograms = vi.spyOn((facade as any).candidateService, 'searchPrograms').mockResolvedValue([canonicalScenicCandidate])

    const deadline = new AgentDeadline()
    const compressionDeadline = new AgentDeadline()
    const result = await facade.submitInstruction({
      scheduleState: createScheduleState(),
      userInput: '第一段金山区景点部分，选择金山区最近3年最火热的景点',
      currentSchedule: emptySchedule(),
      currentLayoutDraft: createRotationDraft(),
      history: [],
      agentCoreEnabled: true,
      layoutDraftEnabled: true,
      inputSource: 'user',
      deadline,
    })

    expect(result.kind).toBe('layout_draft')
    if (result.kind !== 'layout_draft') throw new Error('expected direct layout draft update')
    expect(result.feedback.processTypeLabel).toBe('版面草案')
    expect(result.feedback.content).toContain('已把“金山区最近三年热门景点”更新到左侧草案')
    expect(result.feedback.content).not.toContain('确认前我不会更新草案')
    expect(result.feedback.content).not.toContain('需要我把这个方向更新到草案吗')
    expect(result.feedback.details?.noFormalPlaylistWrite).toBe(true)
    expect(result.feedback.details?.draftUpdatePolicy).toBe('draft_updates_do_not_require_confirmation')
    expect(result.feedback.details?.candidateCount).toBe(1)
    expect(result.feedback.details?.reactTaskRun).toMatchObject({
      status: 'observing',
      loopCount: 1,
      objective: '先核验金山区热门景点素材，再更新草案',
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

  it('post9-rotation-compression-staged-react: returns whole-playlist research observation to LLM before drafting', async () => {
    const testCase = {
      id: 'rotation-compress-overall-observation-builds-reviewable-draft',
      userInput: '分析当前3小时轮播单，按热播优先形成压缩到2小时的方案',
      expectedDecision: 'research observation 回到 LLM，生成完整2小时草案供审看',
      mustNotHappen: '要求指定单一草案段或写入正式播单',
      verification: 'result.kind=layout_draft、coverage=00:00-02:00、noFormalPlaylistWrite=true',
    }
    llmClientChatMock
      .mockResolvedValueOnce({
        content: JSON.stringify({
          mode: 'react',
          actions: [],
          reactTask: {
            objective: '分析当前轮播内容和热度依据，形成2小时压缩草案',
            maxTurns: 3,
            batchSize: 4,
            stopCondition: '形成可审看的2小时草案，不写正式播单',
            nextActions: [{
              type: 'research_check',
              purpose: 'draft_precheck',
              semanticLabel: '当前轮播热播内容',
              queries: ['当前轮播 热播 内容', '上海文旅 热门节目'],
            }],
          },
          assistantReplyDraft: '我先结合当前编单查热度依据，再形成2小时压缩方案。',
          reasoning: '整表取舍需要先观察当前内容和候选证据。',
        }),
      })
      .mockResolvedValueOnce({
        content: JSON.stringify({
          action: {
            type: 'refine_layout_draft',
            rotationDurationSeconds: 7200,
            ignoreExistingLayout: true,
            userIntent: '按热播优先压缩当前轮播单到2小时',
            segments: [
              { start: '00:00:00', end: '01:00:00', semanticLabel: '高热度城市文旅', programTypeHint: 'documentary' },
              { start: '01:00:00', end: '02:00:00', semanticLabel: '热门城市生活', programTypeHint: 'news_magazine' },
            ],
          },
          assistantReply: '我结合当前编单和热度证据，整理成两段压缩草案供你审看。',
          reasoning: '保留热度较高且内容互补的两类节目方向。',
        }),
      })

    const canonicalHourCandidates = canonicalSchedulingData.candidates
      .filter((candidate) => candidate.duration === 3600)
      .slice(0, 3)
    if (canonicalHourCandidates.length < 3) throw new Error('data_fixture_missing: three canonical one-hour rotation candidates')
    const facade = new SchedulingAgentRuntimeFacade()
    vi.spyOn((facade as any).candidateService, 'searchPrograms').mockResolvedValue(canonicalHourCandidates.slice(0, 2))
    const currentSchedule: RuntimeScheduleItem[] = canonicalHourCandidates.map((candidate, index) => ({
      id: candidate.id,
      programCode: candidate.programCode,
      programName: candidate.programName,
      startTime: `0${index}:00:00`,
      endTime: `0${index + 1}:00:00`,
      duration: candidate.duration,
      programType: candidate.programType,
    }))

    const compressionDeadline = new AgentDeadline()
    const result = await facade.submitInstruction({
      scheduleState: createScheduleState({
        isEmpty: false,
        itemCount: currentSchedule.length,
        gapCount: 0,
        rotationStrategy: 'trending',
        rotationDurationSeconds: 3 * 60 * 60,
      }),
      userInput: testCase.userInput,
      currentSchedule,
      currentLayoutDraft: createThreeHourRotationDraft(),
      history: [],
      agentCoreEnabled: true,
      layoutDraftEnabled: true,
      inputSource: 'user',
      deadline: compressionDeadline,
    })

    expect(testCase).toMatchObject({ expectedDecision: expect.any(String), mustNotHappen: expect.any(String), verification: expect.any(String) })
    expect(result.kind).toBe('layout_draft')
    if (result.kind !== 'layout_draft') throw new Error('expected whole-playlist compression draft')
    expect(result.draft.targetDurationSeconds).toBe(7200)
    expect(result.draft.coverage).toEqual({ start: '00:00:00', end: '02:00:00' })
    expect(result.draft.columns.map((column) => column.semanticLabel)).toEqual(['高热度城市文旅', '热门城市生活'])
    expect(result.feedback.details?.noFormalPlaylistWrite).toBe(true)
    expect(result.feedback.details?.researchDecisionSource).toBe('llm_observation_decision')
    expect(result.feedback.details?.reactTaskRun).toMatchObject({
      status: 'observing',
      objective: '分析当前轮播内容和热度依据，形成2小时压缩草案',
      loopCount: 1,
    })
    expect(result.feedback.details?.reactTaskBoundary).toMatchObject({
      mode: 'react',
      nextDecisionRequiresObservation: true,
    })
    expect(currentSchedule).toHaveLength(3)
    expect(llmClientChatMock).toHaveBeenCalledTimes(2)
    expect(llmClientChatMock.mock.calls[1]?.[1]?.signal).toBe(compressionDeadline.signal())
  })

  it('rotation-compress-observation-invalid-decision: preserves the formal schedule and exposes a recoverable failure', async () => {
    const testCase = {
      id: 'rotation-compress-observation-invalid-decision',
      userInput: '分析当前3小时轮播单，按热播优先形成压缩到2小时的方案',
      expectedDecision: 'LLM 未给完整连续2小时草案时结构化停止并允许重试',
      mustNotHappen: '本地补齐缺失时段、写入正式播单或自动回滚',
      verification: 'failureCode=research_decide_invalid、noMutation=true、recoverableFailureEnvelope.kind=llm_decide_unavailable',
    }
    llmClientChatMock
      .mockResolvedValueOnce({
        content: JSON.stringify({
          mode: 'react', actions: [],
          reactTask: {
            objective: '形成2小时压缩草案', maxTurns: 3, batchSize: 3,
            nextActions: [{ type: 'research_check', purpose: 'draft_precheck', semanticLabel: '热播内容', queries: ['热播内容'] }],
          },
          assistantReplyDraft: '先查证再形成草案。', reasoning: '整表取舍需要 observation。',
        }),
      })
      .mockResolvedValueOnce({
        content: JSON.stringify({
          action: {
            type: 'refine_layout_draft', rotationDurationSeconds: 7200, ignoreExistingLayout: true,
            segments: [{ start: '00:00:00', end: '01:00:00', semanticLabel: '只有一小时的残缺方案' }],
          },
          assistantReply: '先这样处理。', reasoning: '模型遗漏了一小时。',
        }),
      })
    const canonicalHourCandidates = canonicalSchedulingData.candidates
      .filter((candidate) => candidate.duration === 3600)
      .slice(0, 3)
    if (canonicalHourCandidates.length < 3) throw new Error('data_fixture_missing: three canonical one-hour rotation candidates')
    const facade = new SchedulingAgentRuntimeFacade()
    vi.spyOn((facade as any).candidateService, 'searchPrograms').mockResolvedValue(canonicalHourCandidates.slice(0, 1))
    const currentSchedule: RuntimeScheduleItem[] = canonicalHourCandidates.map((candidate, index) => ({
      id: candidate.id,
      programCode: candidate.programCode,
      programName: candidate.programName,
      startTime: `0${index}:00:00`,
      endTime: `0${index + 1}:00:00`,
      duration: candidate.duration,
      programType: candidate.programType,
    }))

    const result = await facade.submitInstruction({
      scheduleState: createScheduleState({ isEmpty: false, itemCount: 3, gapCount: 0, rotationStrategy: 'trending', rotationDurationSeconds: 10800 }),
      userInput: testCase.userInput,
      currentSchedule,
      currentLayoutDraft: createThreeHourRotationDraft(),
      agentCoreEnabled: true,
      layoutDraftEnabled: true,
      inputSource: 'user',
    })

    expect(testCase).toMatchObject({ expectedDecision: expect.any(String), mustNotHappen: expect.any(String), verification: expect.any(String) })
    expect(result.kind).toBe('message')
    if (result.kind !== 'message') throw new Error('expected recoverable decision failure')
    expect(result.statusHint).toBe('failed')
    expect(result.feedback.details).toMatchObject({
      failureCode: 'research_decide_invalid',
      noMutation: true,
      noFormalPlaylistWrite: true,
      canRetry: true,
      recoverableFailureEnvelope: {
        kind: 'llm_decide_unavailable',
        noMutation: true,
      },
    })
    expect(currentSchedule.map((item) => item.id)).toEqual(canonicalHourCandidates.map((candidate) => candidate.id))
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
