import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ScheduleState } from '@/types/orchestration'
import type { LayoutDraft } from '@/types/orchestration'

const mockLayoutRecognize = vi.fn()
const mockGenerateSpec = vi.fn()
const mockRefineSpec = vi.fn()
const mockLlmChat = vi.fn()

vi.mock('@/services/llm/llmClient', () => ({
  getLLMClient: () => ({ chat: mockLlmChat }),
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
    recognize: mockLayoutRecognize,
  }),
}))

vi.mock('@/services/layoutDraftService', () => ({
  getLayoutDraftService: () => ({
    generateSpec: mockGenerateSpec,
    refineSpec: mockRefineSpec,
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
  playlistId: 'tv-dragon-2026-03-25',
  playlistType: 'tv',
  channelId: 'dragon',
  channelName: '东方卫视',
  date: '2026-03-25',
  isEmpty: true,
  itemCount: 0,
  gapCount: 0,
  hasSelectedTimeRange: false,
})

const createRotationScheduleState = (): ScheduleState => ({
  ...createScheduleState(),
  playlistType: 'rotation',
  playlistId: 'rotation-1',
  rotationStrategy: 'content_match',
  rotationDurationSeconds: 3 * 60 * 60,
})

const createEmptyLayoutDraft = (): LayoutDraft => ({
  id: 'draft-empty',
  channelId: 'dragon',
  date: '2026-03-25',
  source: 'uploaded',
  userIntent: '空草案',
  coverage: { start: '13:00:00', end: '13:00:00' },
  layoutReference: {
    id: 'layout-empty',
    name: '空草案',
    slots: [],
  },
  columns: [],
})

const createPartialLayoutDraft = (): LayoutDraft => ({
  ...createEmptyLayoutDraft(),
  id: 'draft-partial',
  userIntent: '下午草案',
  coverage: { start: '13:00:00', end: '18:00:00' },
  layoutReference: {
    id: 'layout-partial',
    name: '下午草案',
    slots: [{ id: 'slot-afternoon', columnId: 'column-afternoon', startTime: '13:00:00', endTime: '18:00:00' }],
  },
  columns: [{
    columnId: 'column-afternoon',
    columnName: '综合版面',
    defaultProgramType: 'news_magazine',
    source: 'uploaded',
    draftConstraintKind: 'unspecified',
  }],
})

const createCompleteRotationDurationDraft = (overrides: Partial<LayoutDraft> = {}): LayoutDraft => ({
  ...createEmptyLayoutDraft(),
  id: 'rotation-duration-draft',
  channelId: 'rotation',
  source: 'generated',
  userIntent: '上海市静安区景点，总时长30小时',
  coverage: { start: '00:00:00', end: '23:59:59' },
  draftKind: 'duration_segments',
  targetDurationSeconds: 30 * 60 * 60,
  layoutReference: {
    id: 'layout-rotation-duration',
    name: '轮播草案',
    slots: [{ id: 'segment-jingan', columnId: 'column-jingan', startTime: '00:00:00', endTime: '23:59:59' }],
  },
  columns: [{
    columnId: 'column-jingan',
    columnName: '上海市静安区景点',
    defaultProgramType: 'news_magazine',
    source: 'generated',
    semanticLabel: '上海市静安区景点',
    queryHints: ['上海市静安区景点', '静安寺', '张园', '苏河湾'],
    draftConstraintKind: 'unspecified',
  }],
  durationSegments: [{
    id: 'segment-jingan',
    label: '上海市静安区景点',
    contentHint: '上海市静安区景点',
    targetDurationSeconds: 30 * 60 * 60,
    selectionPriority: 'content_match',
    repeatPolicy: 'avoid_repeat',
    fallbackPolicy: 'ask_user',
  }],
  ...overrides,
})

const mockFormalPlanner = (input: {
  action: 'commit_layout_draft' | 'formal_orchestration'
  mode: 'full_generate' | 'partial_generate'
  taskKind: 'full_day' | 'overall_refill' | 'local_refill'
  useLayoutDraft: boolean
  query: string
}) => {
  mockLlmChat.mockResolvedValueOnce({
    content: JSON.stringify({
      mode: 'react',
      actions: [input.action === 'commit_layout_draft'
        ? { type: input.action, mode: input.mode, useLayoutDraft: input.useLayoutDraft }
        : { type: input.action, mode: input.mode, taskKind: input.taskKind, useLayoutDraft: input.useLayoutDraft, searchKeywords: [input.query] }],
      reactTask: {
        objective: input.query,
        maxTurns: 5,
        batchSize: 3,
        nextActions: [{ type: 'research_check', purpose: 'candidate_precheck', queries: [input.query] }],
      },
      assistantReplyDraft: '我会先查节目库，再逐批完成正式编排。',
      reasoning: '用户明确要求进入正式长流程。',
    }),
  })
}

describe('DemoRuntimeFacade full generate bootstrap', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('显式参考草案的空表全天编排会复用频道草案进入正式编排，不走 refineSpec', async () => {
    mockFormalPlanner({
      action: 'commit_layout_draft',
      mode: 'full_generate',
      taskKind: 'full_day',
      useLayoutDraft: true,
      query: '当前频道版面草案',
    })
    mockLayoutRecognize.mockResolvedValue({
      mode: 'layout_prepare',
      confidence: 0.93,
      reasoning: 'start orchestration from current layout',
      ignoreExistingLayout: false,
      targetTimeRange: {
        start: '06:00:00',
        end: '23:59:59',
      },
    })

    const facade = new DemoRuntimeFacade()
    const result = await facade.submitInstruction({
      scheduleState: createScheduleState(),
      userInput: '参考草案帮我填充全天节目',
      currentSchedule: [],
      history: [],
      agentCoreEnabled: true,
      layoutDraftEnabled: true,
      inputSource: 'user',
    })

    expect(result.kind).toBe('layout_commit')
    if (result.kind !== 'layout_commit') {
      throw new Error('expected layout_commit decision')
    }

    expect(result.orchestrationRequest.layoutDraft?.source).toBe('channel_default')
    expect(mockRefineSpec).not.toHaveBeenCalled()
    expect(mockGenerateSpec).not.toHaveBeenCalled()
  })

  it('post9-hybrid-overall-task-guides-draft-before-formal: 轮播单工作区直接发起全天编排会被阻拦并引导补充草案', async () => {
    mockFormalPlanner({
      action: 'formal_orchestration',
      mode: 'full_generate',
      taskKind: 'full_day',
      useLayoutDraft: false,
      query: '轮播单全天编排',
    })
    const facade = new DemoRuntimeFacade()
    const result = await facade.submitInstruction({
      scheduleState: createRotationScheduleState(),
      userInput: '帮我全天编排',
      currentSchedule: [],
      history: [],
      agentCoreEnabled: true,
      layoutDraftEnabled: true,
      inputSource: 'user',
    })

    expect(result.kind).toBe('message')
    if (result.kind !== 'message') {
      throw new Error('expected rotation all-day generation to be blocked')
    }
    expect(result.statusHint).toBe('needs_clarification')
    expect(result.feedback.processTypeLabel).toBe('先补草案')
    expect(result.feedback.content).toContain('轮播单还没有可用草案')
    expect(result.feedback.content).toContain('不能直接整体编排')
    expect(result.feedback.details?.suggestedActions).toEqual([
      '说明主题和总时长',
      '上传轮播草案',
      '生成轮播草案',
      '改为单条插入或调整',
    ])
    expect(mockRefineSpec).not.toHaveBeenCalled()
    expect(mockGenerateSpec).not.toHaveBeenCalled()
  })

  it('轮播单已有完整激活草案时可按草案进入整体补排请求', async () => {
    mockFormalPlanner({
      action: 'commit_layout_draft',
      mode: 'partial_generate',
      taskKind: 'overall_refill',
      useLayoutDraft: true,
      query: '当前轮播草案',
    })
    const rotationDraft = createCompleteRotationDurationDraft()
    const facade = new DemoRuntimeFacade()
    const result = await facade.submitInstruction({
      scheduleState: {
        ...createRotationScheduleState(),
        isEmpty: false,
        itemCount: 1,
        gapCount: 1,
      },
      userInput: '参考草案补齐当前所有空窗',
      currentSchedule: [],
      currentLayoutDraft: rotationDraft,
      history: [],
      agentCoreEnabled: true,
      layoutDraftEnabled: true,
      inputSource: 'user',
    })

    expect(result.kind).toBe('layout_commit')
    if (result.kind !== 'layout_commit') {
      throw new Error('expected rotation layout commit decision')
    }

    expect(result.orchestrationRequest.mode).toBe('partial_generate')
    expect(result.orchestrationRequest.layoutDraft).toBe(rotationDraft)
    expect(result.orchestrationRequest.lifecycle).toMatchObject({
      taskKind: 'overall_refill',
      playlistModel: 'content_queue',
      requiresLayoutDraft: true,
      writesFormalPlaylist: true,
      mutatesLayoutDraft: false,
    })
    expect(result.feedback.content).toContain('准备按该版面开始编排')
    expect(mockRefineSpec).not.toHaveBeenCalled()
    expect(mockGenerateSpec).not.toHaveBeenCalled()
  })

  it('轮播单主题加总时长会先生成草案，不直接写入正式轮播单', async () => {
    mockGenerateSpec.mockResolvedValue({
      coverage: { start: '00:00:00', end: '23:59:59' },
      segments: [{
        id: 'segment-jingan',
        label: '上海市静安区景点',
        startTime: '00:00:00',
        endTime: '23:59:59',
        programType: 'news_magazine',
        queryHints: ['上海市静安区景点', '静安寺', '张园', '苏河湾'],
      }],
    })

    const facade = new DemoRuntimeFacade()
    const result = await facade.submitInstruction({
      scheduleState: createRotationScheduleState(),
      userInput: '建立上海市静安区景点轮播编排，时长30小时',
      currentSchedule: [],
      history: [],
    })

    expect(result.kind).toBe('layout_draft')
    if (result.kind !== 'layout_draft') {
      throw new Error('expected rotation theme duration to prepare layout draft')
    }
    expect(result.feedback.content).toContain('确认前不会写入正式轮播单')
    expect(result.draft.draftKind).toBe('duration_segments')
    expect(result.draft.targetDurationSeconds).toBe(30 * 60 * 60)
    expect(result.draft.durationSegments?.[0]).toMatchObject({
      contentHint: expect.stringContaining('静安区景点'),
      targetDurationSeconds: 30 * 60 * 60,
      fallbackPolicy: 'ask_user',
    })
    expect('orchestrationRequest' in result).toBe(false)
    expect(mockGenerateSpec).toHaveBeenCalledTimes(1)
  })

  it('电视播单草案完全为空时会阻拦全天编排', async () => {
    mockFormalPlanner({
      action: 'formal_orchestration',
      mode: 'full_generate',
      taskKind: 'full_day',
      useLayoutDraft: true,
      query: '电视播单全天编排',
    })
    const facade = new DemoRuntimeFacade()
    const result = await facade.submitInstruction({
      scheduleState: createScheduleState(),
      userInput: '帮我全天编排',
      currentSchedule: [],
      currentLayoutDraft: createEmptyLayoutDraft(),
      history: [],
      agentCoreEnabled: true,
      layoutDraftEnabled: true,
      inputSource: 'user',
    })

    expect(result.kind).toBe('message')
    if (result.kind !== 'message') {
      throw new Error('expected tv all-day generation without layout draft to be blocked')
    }
    expect(result.statusHint).toBe('needs_clarification')
    expect(result.feedback.processTypeLabel).toBe('先补草案')
    expect(result.feedback.content).toContain('这张电视播单还没有草案')
    expect((result.feedback.details?.draftCompleteness as { status?: string } | undefined)?.status).toBe('empty')
    expect(result.feedback.details?.suggestedActions).toEqual([
      '加载当前频道默认草案',
      '上传版面文件',
      '切换到已有草案',
      '改为局部补排',
    ])
    expect(mockRefineSpec).not.toHaveBeenCalled()
    expect(mockGenerateSpec).not.toHaveBeenCalled()
  })

  it('电视播单只有部分草案时会引导继续补充草案信息', async () => {
    mockFormalPlanner({
      action: 'formal_orchestration',
      mode: 'full_generate',
      taskKind: 'full_day',
      useLayoutDraft: true,
      query: '电视播单全天编排',
    })
    const facade = new DemoRuntimeFacade()
    const result = await facade.submitInstruction({
      scheduleState: createScheduleState(),
      userInput: '帮我全天编排',
      currentSchedule: [],
      currentLayoutDraft: createPartialLayoutDraft(),
      history: [],
      agentCoreEnabled: true,
      layoutDraftEnabled: true,
      inputSource: 'user',
    })

    expect(result.kind).toBe('message')
    if (result.kind !== 'message') {
      throw new Error('expected tv all-day generation with partial layout draft to ask for continuation')
    }
    expect(result.statusHint).toBe('needs_clarification')
    expect(result.feedback.processTypeLabel).toBe('还要补草案')
    expect(result.feedback.content).toContain('这份草案只写了一部分')
    expect(result.feedback.content).toContain('缺的时段')
    expect((result.feedback.details?.draftCompleteness as { status?: string } | undefined)?.status).toBe('partial')
    expect(result.feedback.details?.suggestedActions).toEqual([
      '继续补充草案',
      '按现有草案做局部补排',
      '上传完整草案',
      '切换频道默认草案',
    ])
    expect(mockRefineSpec).not.toHaveBeenCalled()
    expect(mockGenerateSpec).not.toHaveBeenCalled()
  })

  it('部分草案提示后的用户反馈可在现有草案上继续新增编排信息', async () => {
    mockRefineSpec.mockResolvedValue({
      coverage: { start: '06:00:00', end: '18:00:00' },
      segments: [
        {
          id: 'segment-morning-news',
          label: '上午新闻',
          startTime: '06:00:00',
          endTime: '12:00:00',
          programType: 'news',
          queryHints: ['新闻'],
        },
        {
          id: 'segment-afternoon',
          label: '综合版面',
          startTime: '13:00:00',
          endTime: '18:00:00',
          programType: 'news_magazine',
          queryHints: ['综合版面'],
        },
      ],
    })

    const facade = new DemoRuntimeFacade()
    const result = await facade.submitInstruction({
      scheduleState: createScheduleState(),
      userInput: '上午补新闻',
      currentSchedule: [],
      currentLayoutDraft: createPartialLayoutDraft(),
      currentLayoutDraftMode: 'full_generate',
      preferLayoutDraftRefine: true,
      history: [],
    })

    expect(result.kind).toBe('layout_draft')
    if (result.kind !== 'layout_draft') {
      throw new Error('expected layout draft continuation')
    }
    expect(mockRefineSpec).toHaveBeenCalledTimes(1)
    expect(mockGenerateSpec).not.toHaveBeenCalled()
    expect(result.orchestrationMode).toBe('full_generate')
    expect(result.draft.layoutReference.slots.map((slot) => [slot.startTime.slice(11, 19), slot.endTime.slice(11, 19)])).toEqual([
      ['06:00:00', '12:00:00'],
      ['13:00:00', '18:00:00'],
    ])
    expect(result.draft.columns[0]?.semanticLabel).toBe('上午新闻')
  })

  it('电视播单有频道默认草案时全天编排会携带草案参考', async () => {
    mockFormalPlanner({
      action: 'formal_orchestration',
      mode: 'full_generate',
      taskKind: 'full_day',
      useLayoutDraft: true,
      query: '当前频道版面草案',
    })
    const facade = new DemoRuntimeFacade()
    const result = await facade.submitInstruction({
      scheduleState: createScheduleState(),
      userInput: '帮我全天编排',
      currentSchedule: [],
      history: [],
      agentCoreEnabled: true,
      layoutDraftEnabled: true,
      inputSource: 'user',
    })

    expect(result.kind).toBe('orchestration')
    if (result.kind !== 'orchestration') {
      throw new Error('expected tv all-day generation to continue with default layout draft')
    }
    expect(result.orchestrationRequest.mode).toBe('full_generate')
    expect(result.orchestrationRequest.layoutDraft?.source).toBe('channel_default')
    expect(result.orchestrationRequest.lifecycle).toMatchObject({
      taskKind: 'full_day',
      playlistModel: 'time_grid',
      requiresLayoutDraft: true,
      writesFormalPlaylist: true,
      mutatesLayoutDraft: false,
    })
    expect(result.feedback.details?.usesLayoutDraft).toBe(true)
    expect(mockRefineSpec).not.toHaveBeenCalled()
    expect(mockGenerateSpec).not.toHaveBeenCalled()
  })
})
