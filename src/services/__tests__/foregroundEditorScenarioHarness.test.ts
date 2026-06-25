import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { LayoutDraft, ScheduleState } from '@/types/orchestration'
import type {
  RuntimeAnalysisContext,
  RuntimeDecision,
  RuntimeScheduleItem,
} from '@/services/runtime/demoRuntimeFacade'
import { getAtomicCapabilities, resetAtomicCapabilities } from '@/services/atomicCapabilities'
import { clearRuntimeLayout } from '@/services/orchestration/runtimeLayoutRegistry'

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
        readyCount: 1,
        warningCount: 0,
        blockedCount: 0,
      },
      segments: [],
    })),
  }),
}))

import { DemoRuntimeFacade } from '@/services/runtime/demoRuntimeFacade'

type UnifiedScenarioPath =
  | 'workspace'
  | 'layout_draft_gate'
  | 'layout_draft_prepare'
  | 'formal_orchestration'
  | 'read_only_analysis'
  | 'composite_task'
  | 'recoverable_failure'

const executableScenarioContracts: Array<{
  id: string
  path: UnifiedScenarioPath
  forbidden: string[]
}> = [
  { id: 'workspace-tv-create-autoloads-draft', path: 'workspace', forbidden: ['OpenClaw', 'formal_write'] },
  { id: 'workspace-rotation-create-does-not-invent-draft', path: 'workspace', forbidden: ['invent_rotation_draft', 'formal_write'] },
  { id: 'rotation-full-without-draft-blocks-gently', path: 'layout_draft_gate', forbidden: ['orchestration_without_draft', 'formal_write'] },
  { id: 'rotation-theme-duration-creates-reviewable-draft', path: 'layout_draft_prepare', forbidden: ['formal_write'] },
  { id: 'rotation-structured-refine-uses-llm-segments', path: 'layout_draft_prepare', forbidden: ['local_business_guess', 'formal_write'] },
  { id: 'ambiguous-draft-without-workspace-asks-playlist-type', path: 'layout_draft_prepare', forbidden: ['default_tv_workspace', 'draft_write', 'formal_write'] },
  { id: 'tv-reference-draft-becomes-formal-basis', path: 'formal_orchestration', forbidden: ['mutate_layout_draft'] },
  { id: 'formal-gap-fill-does-not-mutate-draft', path: 'formal_orchestration', forbidden: ['implicit_draft_reference'] },
  { id: 'read-only-analysis-never-writes', path: 'read_only_analysis', forbidden: ['pending_write', 'formal_write'] },
  { id: 'optimization-follow-up-is-read-only', path: 'read_only_analysis', forbidden: ['draft_write_without_confirmation', 'formal_write'] },
  { id: 'composite-delete-all-same-name', path: 'composite_task', forbidden: ['write_without_confirmation'] },
  { id: 'conflicting-command-blocks', path: 'composite_task', forbidden: ['silent_overwrite', 'write_without_confirmation'] },
  { id: 'recoverable-llm-timeout-retry', path: 'recoverable_failure', forbidden: ['silent_failure', 'ordinary_clarify', 'mutation'] },
  { id: 'recoverable-retry-restores-original-draft-request', path: 'recoverable_failure', forbidden: ['lost_original_request', 'classifier_fallback', 'mutation_before_retry'] },
]

const createScheduleState = (overrides: Partial<ScheduleState> = {}): ScheduleState => ({
  playlistId: 'playlist-editor-harness',
  channelId: 'dragon',
  channelName: '东方卫视',
  date: '2026-03-25',
  isEmpty: false,
  itemCount: 2,
  gapCount: 1,
  hasSelectedTimeRange: false,
  playlistType: 'tv',
  ...overrides,
})

const createItem = (
  id: string,
  programName: string,
  startTime: string,
  endTime: string,
  programType = 'news',
): RuntimeScheduleItem => ({
  id,
  programCode: id,
  programName,
  startTime,
  endTime,
  duration: Math.max(0, (new Date(endTime).getTime() - new Date(startTime).getTime()) / 1000),
  programType,
})

const currentSchedule: RuntimeScheduleItem[] = [
  createItem('item-east-1', '看东方111期新春特别行动', '2026-03-25T09:00:00+08:00', '2026-03-25T10:00:00+08:00', 'news'),
  createItem('item-drama-1', '东方剧场：纵有疾风起 第5集', '2026-03-25T13:00:00+08:00', '2026-03-25T13:45:00+08:00', 'drama'),
  createItem('item-drama-2', '东方剧场：纵有疾风起 第6集', '2026-03-25T13:45:00+08:00', '2026-03-25T14:30:00+08:00', 'drama'),
  createItem('item-east-2', '看东方 午间版', '2026-03-25T22:00:00+08:00', '2026-03-25T22:30:00+08:00', 'news'),
]

const createLayoutDraft = (): LayoutDraft => ({
  id: 'editor-harness-draft',
  channelId: 'dragon',
  date: '2026-03-25',
  version: 1,
  source: 'channel_default',
  userIntent: '东方卫视版面草案',
  coverage: { start: '06:00:00', end: '23:59:59' },
  layoutReference: {
    id: 'editor-harness-layout',
    name: '东方卫视全天版面草案',
    channelId: 'dragon',
    slots: [
      {
        id: 'slot-morning',
        channelId: 'dragon',
        columnId: 'column-kdf',
        startTime: '06:00:00',
        endTime: '12:00:00',
      },
      {
        id: 'slot-afternoon',
        channelId: 'dragon',
        columnId: 'column-drama',
        startTime: '12:00:00',
        endTime: '18:00:00',
      },
      {
        id: 'slot-evening',
        channelId: 'dragon',
        columnId: 'column-news',
        startTime: '18:00:00',
        endTime: '23:59:59',
      },
    ],
  },
  columns: [
    {
      columnId: 'column-kdf',
      columnName: '看东方',
      channelId: 'dragon',
      defaultProgramType: 'news_magazine',
      source: 'default',
      draftConstraintKind: 'column',
    },
    {
      columnId: 'column-drama',
      columnName: '品质剧场',
      channelId: 'dragon',
      defaultProgramType: 'drama',
      source: 'default',
      draftConstraintKind: 'column',
    },
    {
      columnId: 'column-news',
      columnName: '东方新闻',
      channelId: 'dragon',
      defaultProgramType: 'news',
      source: 'default',
      draftConstraintKind: 'column',
    },
  ],
})

const createRotationDraft = (): LayoutDraft => ({
  id: 'editor-harness-rotation-draft',
  channelId: 'rotation-channel',
  date: '2026-03-25',
  version: 1,
  source: 'generated',
  userIntent: '世界杯精彩画面回顾',
  draftKind: 'duration_segments',
  purpose: '世界杯精彩画面回顾',
  coverage: { start: '00:00:00', end: '03:00:00' },
  targetDurationSeconds: 3 * 60 * 60,
  layoutReference: {
    id: 'editor-harness-rotation-layout',
    name: '轮播草案',
    slots: [{
      id: 'rotation-segment',
      channelId: 'rotation-channel',
      columnId: 'rotation-column',
      startTime: '00:00:00',
      endTime: '03:00:00',
    }],
  },
  columns: [{
    columnId: 'rotation-column',
    columnName: '世界杯精彩回顾',
    channelId: 'rotation-channel',
    defaultProgramType: 'news_magazine',
    source: 'generated',
    semanticLabel: '世界杯精彩回顾',
  }],
  durationSegments: [{
    id: 'rotation-segment',
    label: '世界杯精彩回顾',
    contentHint: '世界杯足球精彩画面',
    targetDurationSeconds: 3 * 60 * 60,
    selectionPriority: 'content_match',
    fallbackPolicy: 'ask_user',
  }],
})

const mockPlanner = (plan: unknown) => {
  llmClientChatMock.mockResolvedValueOnce({
    content: JSON.stringify(plan),
  })
}

const expectNoFormalMutation = () => {
  expect(getAtomicCapabilities().getAllItems()).toEqual([])
}

const expectNoWriteDecision = (decision: RuntimeDecision) => {
  expect(decision.kind).not.toBe('execute_command')
  expect(decision.kind).not.toBe('agent_execution')
  expectNoFormalMutation()
}

describe('foreground editor scenario harness', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    llmClientChatMock.mockReset()
    taskClassifierClassifyMock.mockReset()
    layoutIntentRecognizeMock.mockReset()
    resetAtomicCapabilities()
    await getAtomicCapabilities().clearAll()
    clearRuntimeLayout('dragon', '2026-03-25')
    taskClassifierClassifyMock.mockResolvedValue({
      mode: 'clarify',
      confidence: 0.1,
      reasoning: 'scenario harness default: deterministic foreground route',
    })
    layoutIntentRecognizeMock.mockResolvedValue({
      mode: 'clarify',
      confidence: 0.1,
      reasoning: 'scenario harness default: no layout intent',
    })
    llmClientChatMock.mockRejectedValue(new Error('LLM not configured for this scenario unless explicitly mocked'))
  })

  it('keeps every executable scenario mapped to a unified path with forbidden boundaries', () => {
    expect(executableScenarioContracts).toHaveLength(14)
    executableScenarioContracts.forEach((item) => {
      expect(item.id.trim()).not.toBe('')
      expect(item.forbidden.length, `${item.id} forbidden boundaries`).toBeGreaterThan(0)
      expect(item.forbidden.join('\n'), `${item.id} should not use OpenClaw as a blocker`).not.toMatch(/OpenClaw.*(block|阻塞|前置)/i)
    })
    expect(new Set(executableScenarioContracts.map((item) => item.path))).toEqual(new Set<UnifiedScenarioPath>([
      'workspace',
      'layout_draft_gate',
      'layout_draft_prepare',
      'formal_orchestration',
      'read_only_analysis',
      'composite_task',
      'recoverable_failure',
    ]))
  })

  it('covers workspace creation for TV and rotation without mixing draft rules', async () => {
    const facade = new DemoRuntimeFacade()

    const tv = await facade.submitInstruction({
      scheduleState: createScheduleState({ playlistType: 'none', playlistId: undefined, isEmpty: true, itemCount: 0, gapCount: 0 }),
      userInput: '新建电视播单',
      currentSchedule: [],
      history: [],
      layoutDraftEnabled: true,
    })
    const rotation = await facade.submitInstruction({
      scheduleState: createScheduleState({ playlistType: 'none', playlistId: undefined, isEmpty: true, itemCount: 0, gapCount: 0 }),
      userInput: '新建轮播单',
      currentSchedule: [],
      history: [],
      layoutDraftEnabled: true,
    })

    expect(tv.kind).toBe('message')
    if (tv.kind !== 'message') throw new Error('expected tv workspace message')
    expect(tv.feedback.details?.playlistState).toMatchObject({ playlistType: 'tv' })
    expect(tv.feedback.details?.layoutDraftStatus).toBe('loaded')
    expect(tv.feedback.content).toContain('电视播单')

    expect(rotation.kind).toBe('message')
    if (rotation.kind !== 'message') throw new Error('expected rotation workspace message')
    expect(rotation.feedback.details?.playlistState).toMatchObject({
      playlistType: 'rotation',
      rotationStrategy: 'content_match',
    })
    expect(rotation.feedback.details?.layoutDraftStatus).toBe('empty')
    expect(rotation.feedback.content).toContain('当前还不知道轮播要排多长')
    expectNoFormalMutation()
  })

  it('blocks full rotation orchestration without a draft but allows creating a reviewable rotation draft from theme and duration', async () => {
    const facade = new DemoRuntimeFacade()
    const rotationState = createScheduleState({
      playlistId: 'playlist-rotation-harness',
      channelId: 'rotation-channel',
      channelName: '轮播单',
      playlistType: 'rotation',
      isEmpty: true,
      itemCount: 0,
      gapCount: 1,
      rotationStrategy: 'content_match',
      rotationDurationSeconds: 3 * 60 * 60,
    })
    taskClassifierClassifyMock.mockResolvedValueOnce({
      mode: 'full_generate',
      confidence: 0.9,
      reasoning: 'LLM-only scenario: user is asking to complete the whole rotation playlist.',
      suggestedParams: {
        userIntent: '完整编排当前轮播单',
      },
    })

    const blocked = await facade.submitInstruction({
      scheduleState: rotationState,
      userInput: '帮我把全天轮播单编排完整',
      currentSchedule: [],
      history: [],
      layoutDraftEnabled: true,
    })
    const draft = await facade.submitInstruction({
      scheduleState: rotationState,
      userInput: '新建一个3小时的轮播草案，主要用于世界杯精彩画面回顾',
      currentSchedule: [],
      history: [],
      layoutDraftEnabled: true,
    })

    expect(blocked.kind).toBe('message')
    if (blocked.kind !== 'message') throw new Error('expected rotation gate message')
    expect(blocked.feedback.content).toContain('草案')
    expect(blocked.statusHint).toBe('needs_clarification')
    expectNoWriteDecision(blocked)

    expect(draft.kind).toBe('layout_draft')
    if (draft.kind !== 'layout_draft') throw new Error(`expected rotation draft: ${draft.feedback.content}`)
    expect(draft.draft.draftKind).toBe('duration_segments')
    expect(draft.draft.targetDurationSeconds).toBe(3 * 60 * 60)
    expect(draft.feedback.content).toContain('确认前不会写入正式轮播单')
    expectNoFormalMutation()
  })

  it('uses LLM-generated segments for rotation draft refinement instead of local business guessing', async () => {
    mockPlanner({
      actions: [{
        type: 'refine_layout_draft',
        rotationDurationSeconds: 3 * 60 * 60,
        semanticLabel: '静安宣传片轮播',
        segments: [
          { start: '00:00:00', end: '01:00:00', semanticLabel: '静安寺宣传片', programTypeHint: 'news_magazine' },
          { start: '01:00:00', end: '02:00:00', semanticLabel: '商圈宣传片', programTypeHint: 'news_magazine' },
          { start: '02:00:00', end: '03:00:00', semanticLabel: '天主教堂宣传片', programTypeHint: 'news_magazine' },
        ],
      }],
      assistantReplyDraft: '我按三个小时重新拆成三段草案。',
      reasoning: '用户明确给出了三个小时内容块，应由 planner 返回结构化草案段。',
    })
    const facade = new DemoRuntimeFacade()

    const decision = await facade.submitInstruction({
      scheduleState: createScheduleState({
        playlistId: 'playlist-rotation-harness',
        channelId: 'rotation-channel',
        channelName: '轮播单',
        playlistType: 'rotation',
        rotationDurationSeconds: 3 * 60 * 60,
      }),
      userInput: '草案改成第一小时静安寺宣传片，第二小时商圈宣传片，第三小时天主教堂宣传片',
      currentSchedule: [],
      currentLayoutDraft: createRotationDraft(),
      history: [],
      agentCoreEnabled: true,
      layoutDraftEnabled: true,
      preferLayoutDraftRefine: true,
      inputSource: 'user',
    })

    expect(decision.kind).toBe('layout_draft')
    if (decision.kind !== 'layout_draft') throw new Error(`expected refined draft: ${decision.feedback.content}`)
    expect(decision.draft.durationSegments?.map((segment) => segment.label)).toEqual([
      '静安寺宣传片',
      '商圈宣传片',
      '天主教堂宣传片',
    ])
    expect(decision.draft.durationSegments?.map((segment) => segment.targetDurationSeconds)).toEqual([
      3600,
      3600,
      3600,
    ])
    expect(taskClassifierClassifyMock).not.toHaveBeenCalled()
    expect(layoutIntentRecognizeMock).not.toHaveBeenCalled()
    expectNoFormalMutation()
  })

  it('asks for playlist type when the planner understands a draft request but no workspace is open', async () => {
    mockPlanner({
      actions: [{
        type: 'prepare_layout_draft',
        semanticLabel: '新闻和电视剧生命树',
        segments: [
          { start: '00:00:00', end: '01:00:00', semanticLabel: '新闻', programTypeHint: 'news' },
          { start: '01:00:00', end: '02:00:00', semanticLabel: '电视剧生命树', programTypeHint: 'drama' },
        ],
      }],
      assistantReplyDraft: '我可以先整理这份草案。',
      reasoning: '用户给了草案内容，但没有说明要建电视播单还是轮播单。',
    })
    const facade = new DemoRuntimeFacade()

    const decision = await facade.submitInstruction({
      scheduleState: createScheduleState({
        playlistId: undefined,
        playlistType: 'none',
        isEmpty: true,
        itemCount: 0,
        gapCount: 0,
      }),
      userInput: '新建草案，第一个小时是新闻，第二个小时是电视剧生命树',
      currentSchedule: [],
      history: [],
      agentCoreEnabled: true,
      layoutDraftEnabled: true,
      inputSource: 'user',
    })

    expect(decision.kind).toBe('message')
    if (decision.kind !== 'message') throw new Error('expected clarification message')
    expect(decision.statusHint).toBe('needs_clarification')
    expect(decision.feedback.content).toContain('播单类型')
    expect(decision.feedback.details?.noMutation).toBe(true)
    expect(decision.layoutDraft).toBeUndefined()
    expect(taskClassifierClassifyMock).not.toHaveBeenCalled()
    expect(layoutIntentRecognizeMock).not.toHaveBeenCalled()
    expectNoFormalMutation()
  })

  it('keeps draft-backed formal orchestration explicit and normal gap fill draft-independent', async () => {
    const facade = new DemoRuntimeFacade()
    const draft = createLayoutDraft()

    const explicitDraft = await facade.submitInstruction({
      scheduleState: createScheduleState({ itemCount: currentSchedule.length }),
      userInput: '参考草案补齐当前所有空窗',
      currentSchedule,
      currentLayoutDraft: draft,
      history: [],
      layoutDraftEnabled: true,
    })
    const normalGapFill = await facade.submitInstruction({
      scheduleState: createScheduleState({ itemCount: currentSchedule.length }),
      userInput: '补齐当前所有空窗',
      currentSchedule,
      currentLayoutDraft: draft,
      history: [],
      layoutDraftEnabled: true,
    })

    expect(explicitDraft.kind).toBe('layout_commit')
    if (explicitDraft.kind !== 'layout_commit') throw new Error('expected layout commit')
    expect(explicitDraft.orchestrationRequest.layoutDraft).toBe(draft)
    expect(explicitDraft.feedback.details?.layoutSource).toBe('channel_default')

    expect(normalGapFill.kind).toBe('orchestration')
    if (normalGapFill.kind !== 'orchestration') throw new Error('expected normal formal orchestration')
    expect(normalGapFill.orchestrationRequest.layoutDraft).toBeUndefined()
    expect(normalGapFill.feedback.details?.usesLayoutDraft).toBe(false)
    expectNoFormalMutation()
  })

  it('keeps read-only analysis and optimization follow-up out of draft and formal writes', async () => {
    llmClientChatMock
      .mockResolvedValueOnce({
        content: '当前编单新闻开场，下午连续电视剧，整体偏稳，但中后段内容类型比较集中。',
      })
      .mockResolvedValueOnce({
        content: '可以把下午连续剧之间加一段轻量资讯，并把晚间新闻前的节奏放缓。',
      })
    const facade = new DemoRuntimeFacade()

    const analysis = await facade.submitInstruction({
      scheduleState: createScheduleState({ itemCount: currentSchedule.length }),
      userInput: '这张编单整体风格怎么样',
      currentSchedule,
      currentLayoutDraft: createLayoutDraft(),
      history: [],
      agentCoreEnabled: true,
      layoutDraftEnabled: true,
    })
    if (analysis.kind !== 'message') throw new Error('expected analysis message')

    const followUp = await facade.submitInstruction({
      scheduleState: createScheduleState({ itemCount: currentSchedule.length }),
      userInput: '那怎么优化',
      currentSchedule,
      currentLayoutDraft: createLayoutDraft(),
      analysisContext: analysis.analysisContext as RuntimeAnalysisContext,
      history: ['用户：这张编单整体风格怎么样', `AI：${analysis.feedback.content}`],
      agentCoreEnabled: true,
      layoutDraftEnabled: true,
    })

    expect(analysis.analysisContext?.kind).toBe('playlist_analysis')
    expect(analysis.feedback.details?.readOnly).toBe(true)
    expect(analysis.feedback.content).toContain('整体偏稳')
    expect(followUp.kind).toBe('message')
    if (followUp.kind !== 'message') throw new Error('expected optimization message')
    expect(followUp.analysisContext?.kind).toBe('optimization_suggestion')
    expect(followUp.feedback.content).toContain('需要我更新到草案')
    expectNoFormalMutation()
  })

  it('routes composite delete and conflicting insert through task plan confirmation or blocking', async () => {
    llmClientChatMock.mockResolvedValueOnce({
      content: JSON.stringify({
        intent: 'batch_delete',
        confidence: 0.92,
        slots: { targetProgramName: '看东方' },
        assistantReplyDraft: '我先把当前播单里的看东方整理成批量删除任务，确认后再写入。',
        taskPlanDraft: {
          isComposite: true,
          goal: '删除全部看东方',
          stages: [{
            type: 'batch_atomic',
            action: 'delete',
            target: {
              programName: '看东方',
              scope: 'current_playlist',
            },
            requiresConfirmation: true,
            summary: '删除当前播单里的看东方',
          }, {
            type: 'verify',
            requiresConfirmation: false,
            summary: '检查当前播单里是否还剩看东方',
          }],
        },
      }),
    })
    const facade = new DemoRuntimeFacade()
    const batchDelete = await facade.submitInstruction({
      scheduleState: createScheduleState({ itemCount: currentSchedule.length }),
      userInput: '把全部看东方节目删除掉',
      currentSchedule,
      history: [],
      agentCoreEnabled: true,
      layoutDraftEnabled: false,
    })

    llmClientChatMock.mockResolvedValueOnce({
      content: JSON.stringify({
        intent: 'insert',
        confidence: 0.9,
        slots: {
          targetTime: '09:00:00',
          programHint: '看东方',
        },
        assistantReplyDraft: '我看到你想把两个节目都放到9点。',
        taskPlanDraft: {
          isComposite: true,
          goal: '9点插入看东方和百姓大讲堂',
          stages: [{
            type: 'atomic',
            action: 'insert',
            target: {
              targetTime: '09:00:00',
              programName: '看东方',
            },
            requiresConfirmation: true,
          }, {
            type: 'atomic',
            action: 'insert',
            target: {
              targetTime: '09:00:00',
              programName: '百姓大讲堂',
            },
            requiresConfirmation: true,
          }],
        },
      }),
    })
    const conflict = await facade.submitInstruction({
      scheduleState: createScheduleState({ itemCount: currentSchedule.length }),
      userInput: '9点插入看东方和百姓大讲堂',
      currentSchedule,
      history: [],
      agentCoreEnabled: true,
      layoutDraftEnabled: false,
    })

    expect(batchDelete.kind).toBe('pending_atomic_context')
    if (batchDelete.kind !== 'pending_atomic_context') throw new Error('expected composite pending task')
    expect(batchDelete.pendingAtomicContext.compositeTaskRun?.stages[0]?.steps.length).toBe(2)
    expect(batchDelete.feedback.content).toContain('确认后我再写入播单')

    expect(conflict.kind).toBe('message')
    if (conflict.kind !== 'message') throw new Error('expected conflict message')
    expect(conflict.statusHint).toBe('needs_clarification')
    expect(conflict.feedback.content).toContain('同时要插入多个节目')
    expectNoFormalMutation()
  })

  it('surfaces recoverable LLM failures as no-mutation retryable feedback', async () => {
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

    const decision = await facade.submitInstruction({
      scheduleState: createScheduleState({ itemCount: currentSchedule.length }),
      userInput: '继续按刚才的要求处理',
      currentSchedule,
      history: [],
      agentCoreEnabled: false,
      layoutDraftEnabled: true,
    })

    expect(decision.kind).toBe('message')
    if (decision.kind !== 'message') throw new Error('expected recoverable failure message')
    expect(decision.statusHint).toBe('failed')
    expect(decision.feedback.content).toContain('没有修改草案或播单')
    expect(decision.feedback.content).toContain('重试')
    expect(decision.feedback.details).toMatchObject({
      canRetry: true,
      noMutation: true,
      recoverableUserInput: '继续按刚才的要求处理',
    })
    expectNoFormalMutation()
  })

  it('restores the original draft request on retry and lets the planner finish it', async () => {
    const originalUserInput = '新建草案，第一个小时是新闻，第二个小时是电视剧生命树'
    llmClientChatMock
      .mockRejectedValueOnce(new Error('LLM 网络请求超时'))
      .mockResolvedValueOnce({
        content: JSON.stringify({
          actions: [{
            type: 'prepare_layout_draft',
            rotationDurationSeconds: 2 * 60 * 60,
            semanticLabel: '新闻和电视剧生命树',
            segments: [
              { start: '00:00:00', end: '01:00:00', semanticLabel: '新闻', programTypeHint: 'news' },
              { start: '01:00:00', end: '02:00:00', semanticLabel: '电视剧生命树', programTypeHint: 'drama' },
            ],
          }],
          assistantReplyDraft: '我重新按刚才的要求整理草案。',
          reasoning: '用户重试上一条草案请求。',
        }),
      })
    const facade = new DemoRuntimeFacade()
    const rotationState = createScheduleState({
      playlistId: 'playlist-rotation-retry',
      channelId: 'rotation-channel',
      channelName: '轮播单',
      playlistType: 'rotation',
      rotationStrategy: 'content_match',
      rotationDurationSeconds: 2 * 60 * 60,
      isEmpty: true,
      itemCount: 0,
      gapCount: 1,
    })

    const failed = await facade.submitInstruction({
      scheduleState: rotationState,
      userInput: originalUserInput,
      currentSchedule: [],
      history: [],
      agentCoreEnabled: true,
      layoutDraftEnabled: true,
      inputSource: 'user',
    })
    if (failed.kind !== 'message') throw new Error('expected retryable failure')
    expect(failed.statusHint).toBe('failed')
    expect(failed.feedback.details?.recoverableUserInput).toBe(originalUserInput)
    expect(failed.feedback.details?.noMutation).toBe(true)

    const retried = await facade.submitInstruction({
      scheduleState: rotationState,
      userInput: failed.feedback.details?.recoverableUserInput as string,
      currentSchedule: [],
      history: ['用户：继续'],
      agentCoreEnabled: true,
      layoutDraftEnabled: true,
      inputSource: 'user',
    })

    expect(retried.kind).toBe('layout_draft')
    if (retried.kind !== 'layout_draft') throw new Error(`expected recovered layout draft: ${retried.feedback.content}`)
    expect(retried.draft.coverage).toEqual({ start: '00:00:00', end: '02:00:00' })
    expect(retried.draft.columns.map((column) => column.semanticLabel)).toEqual([
      '新闻',
      '电视剧生命树',
    ])
    expect(taskClassifierClassifyMock).not.toHaveBeenCalled()
    expect(layoutIntentRecognizeMock).not.toHaveBeenCalled()
    expectNoFormalMutation()
  })
})
