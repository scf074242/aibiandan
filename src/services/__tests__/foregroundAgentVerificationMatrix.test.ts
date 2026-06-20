import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { LayoutDraft, ScheduleState } from '@/types/orchestration'
import { DemoRuntimeFacade } from '@/services/runtime/demoRuntimeFacade'
import { buildForegroundAgentContextPackage } from '@/services/runtime/foregroundAgentContextPackage'
import { resolveForegroundLayoutDraft } from '@/services/runtime/foregroundLayoutDraft'
import { clearRuntimeLayout } from '@/services/orchestration/runtimeLayoutRegistry'

vi.mock('@/services/llm/llmClient', () => ({
  getLLMClient: () => ({}),
}))

vi.mock('@/services/llm/taskClassifier', () => ({
  getTaskClassifier: () => ({
    classify: vi.fn(async () => ({
      mode: 'clarify',
      confidence: 0.1,
      reasoning: 'verification matrix relies on deterministic foreground routing',
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

const tvState = (overrides: Partial<ScheduleState> = {}): ScheduleState => ({
  playlistId: 'playlist-tv-matrix',
  playlistType: 'tv',
  channelId: 'dragon',
  channelName: '东方卫视',
  date: '2026-03-25',
  isEmpty: false,
  itemCount: 2,
  gapCount: 1,
  hasSelectedTimeRange: false,
  ...overrides,
})

const rotationState = (overrides: Partial<ScheduleState> = {}): ScheduleState => ({
  playlistId: 'playlist-rotation-matrix',
  playlistType: 'rotation',
  channelId: 'rotation',
  channelName: '轮播单',
  date: '2026-03-25',
  isEmpty: false,
  itemCount: 0,
  gapCount: 1,
  hasSelectedTimeRange: false,
  rotationStrategy: 'content_match',
  rotationDurationSeconds: 3 * 60 * 60,
  ...overrides,
})

const createTvDraft = (): LayoutDraft => ({
  id: 'matrix-draft',
  channelId: 'dragon',
  date: '2026-03-25',
  source: 'channel_default',
  effectiveFrom: '2026-03-01',
  effectiveTo: '2026-06-30',
  version: 1,
  userIntent: '频道默认版面草案',
  coverage: { start: '06:00:00', end: '23:59:59' },
  layoutReference: {
    id: 'matrix-layout',
    name: '东方卫视版面草案',
    channelId: 'dragon',
    slots: [
      {
        id: 'slot-morning-news',
        channelId: 'dragon',
        columnId: 'column-morning-news',
        startTime: '06:00:00',
        endTime: '12:00:00',
      },
      {
        id: 'slot-afternoon-drama',
        channelId: 'dragon',
        columnId: 'column-afternoon-drama',
        startTime: '12:00:00',
        endTime: '18:00:00',
      },
      {
        id: 'slot-evening-news',
        channelId: 'dragon',
        columnId: 'column-evening-news',
        startTime: '18:00:00',
        endTime: '23:59:59',
      },
    ],
  },
  columns: [
    {
      columnId: 'column-morning-news',
      columnName: '看东方',
      channelId: 'dragon',
      defaultProgramType: 'news_magazine',
      source: 'default',
      draftConstraintKind: 'column',
    },
    {
      columnId: 'column-afternoon-drama',
      columnName: '品质剧场',
      channelId: 'dragon',
      defaultProgramType: 'drama',
      source: 'default',
      draftConstraintKind: 'column',
    },
    {
      columnId: 'column-evening-news',
      columnName: '东方新闻',
      channelId: 'dragon',
      defaultProgramType: 'news',
      source: 'default',
      draftConstraintKind: 'column',
    },
  ],
})

describe('foreground Agent verification matrix', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearRuntimeLayout('dragon', '2026-03-25')
  })

  it.each([
    {
      name: 'TV normal full-day generation',
      state: tvState({ isEmpty: false, itemCount: 2, gapCount: 1 }),
      userInput: '帮我全天编排',
      expectedScenario: 'full_generate',
      expectedMode: 'full_generate',
    },
    {
      name: 'TV normal local gap filling',
      state: tvState({ isEmpty: false, itemCount: 2, gapCount: 1 }),
      userInput: '补齐当前所有空窗',
      expectedScenario: 'partial_generate',
      expectedMode: 'partial_generate',
    },
    {
      name: 'TV normal daypart scheduling',
      state: tvState({ isEmpty: false, itemCount: 2, gapCount: 1 }),
      userInput: '下午改成新闻栏目',
      expectedScenario: 'partial_generate',
      expectedMode: 'partial_generate',
    },
  ])('$name stays on the formal playlist path with draft usage only when required', async (item) => {
    const facade = new DemoRuntimeFacade()
    const draft = createTvDraft()
    const context = buildForegroundAgentContextPackage({
      latestUserInput: item.userInput,
      scheduleState: item.state,
      currentSchedule: [],
      currentLayoutDraft: draft,
    })

    const decision = await facade.submitInstruction({
      scheduleState: item.state,
      userInput: item.userInput,
      currentSchedule: [],
      currentLayoutDraft: draft,
      history: [],
      layoutDraftEnabled: true,
    })

    expect(context.scenario).toBe(item.expectedScenario)
    expect(context.layoutDraft.available).toBe(true)
    expect(context.layoutDraft.referencedByCurrentTask).toBe(false)
    expect(context.allowedActions).not.toContain('prepare_layout')
    expect(decision.kind).toBe('orchestration')
    if (decision.kind !== 'orchestration') throw new Error('expected formal orchestration')
    expect(decision.orchestrationRequest.mode).toBe(item.expectedMode)
    if (item.expectedMode === 'full_generate') {
      expect(context.layoutDraft.completeness.status).toBe('complete')
      expect(context.layoutDraft.segments).toHaveLength(3)
      expect(decision.orchestrationRequest.layoutDraft).toBe(draft)
      expect(decision.feedback.details?.usesLayoutDraft).toBe(true)
    } else {
      expect(context.layoutDraft.segments).toBeUndefined()
      expect(decision.orchestrationRequest.layoutDraft).toBeUndefined()
      expect(decision.feedback.details?.usesLayoutDraft).toBe(false)
    }
  })

  it('uses the draft only for an explicit draft-reference foreground request', async () => {
    const facade = new DemoRuntimeFacade()
    const draft = createTvDraft()
    const context = buildForegroundAgentContextPackage({
      latestUserInput: '参考草案补齐当前所有空窗',
      scheduleState: tvState(),
      currentSchedule: [],
      currentLayoutDraft: draft,
    })

    const decision = await facade.submitInstruction({
      scheduleState: tvState(),
      userInput: '参考草案补齐当前所有空窗',
      currentSchedule: [],
      currentLayoutDraft: draft,
      history: [],
      layoutDraftEnabled: true,
    })

    expect(context.scenario).toBe('layout_reference')
    expect(context.layoutDraft.referencedByCurrentTask).toBe(true)
    expect(context.layoutDraft.segments).toEqual([
      {
        id: 'slot-morning-news',
        startTime: '06:00:00',
        endTime: '12:00:00',
        label: '看东方',
        constraintKind: 'column',
      },
      {
        id: 'slot-afternoon-drama',
        startTime: '12:00:00',
        endTime: '18:00:00',
        label: '品质剧场',
        constraintKind: 'column',
      },
      {
        id: 'slot-evening-news',
        startTime: '18:00:00',
        endTime: '23:59:59',
        label: '东方新闻',
        constraintKind: 'column',
      },
    ])
    expect(decision.kind).toBe('layout_commit')
    if (decision.kind !== 'layout_commit') throw new Error('expected draft-backed orchestration')
    expect(decision.orchestrationRequest.mode).toBe('partial_generate')
    expect(decision.orchestrationRequest.layoutDraft).toBe(draft)
  })

  it('resolves the TV channel draft for explicit draft-reference requests even before the prop draft is synced', async () => {
    const facade = new DemoRuntimeFacade()
    const context = buildForegroundAgentContextPackage({
      latestUserInput: '参考草案补齐当前所有空窗',
      scheduleState: tvState(),
      currentSchedule: [],
      currentLayoutDraft: null,
    })

    const decision = await facade.submitInstruction({
      scheduleState: tvState(),
      userInput: '参考草案补齐当前所有空窗',
      currentSchedule: [],
      currentLayoutDraft: null,
      history: [],
      agentCoreEnabled: true,
      layoutDraftEnabled: true,
    })

    expect(context.scenario).toBe('layout_reference')
    expect(context.layoutDraft.available).toBe(false)
    expect(decision.kind).toBe('layout_commit')
    if (decision.kind !== 'layout_commit') throw new Error('expected resolved draft-backed orchestration')
    expect(decision.orchestrationRequest.mode).toBe('partial_generate')
    expect(decision.orchestrationRequest.layoutDraft?.source).toBe('channel_default')
    expect(decision.orchestrationRequest.layoutDraft?.layoutReference.name).toContain('东方卫视')
  })

  it('auto-resolves a TV channel draft but never invents a rotation draft before upload', () => {
    const defaultTvDraft = resolveForegroundLayoutDraft({
      playlistType: 'tv',
      channelId: 'dragon',
      channelName: '东方卫视',
      date: '2026-03-25',
    })
    const defaultRotationDraft = resolveForegroundLayoutDraft({
      playlistType: 'rotation',
      channelId: 'rotation',
      channelName: '轮播单',
      date: '2026-03-25',
    })
    const rotationContext = buildForegroundAgentContextPackage({
      latestUserInput: '补齐当前所有空窗',
      scheduleState: rotationState(),
      currentSchedule: [],
      currentLayoutDraft: defaultRotationDraft,
    })
    const uploadedRotationDraft: LayoutDraft = {
      ...createTvDraft(),
      id: 'matrix-rotation-draft',
      channelId: 'rotation',
      source: 'uploaded',
      userIntent: '轮播草案',
    }
    const rotationWithDraftContext = buildForegroundAgentContextPackage({
      latestUserInput: '补齐当前所有空窗',
      scheduleState: rotationState(),
      currentSchedule: [],
      currentLayoutDraft: uploadedRotationDraft,
    })

    expect(defaultTvDraft?.source).toBe('channel_default')
    expect(defaultTvDraft?.effectiveFrom).toBeTruthy()
    expect(defaultTvDraft?.effectiveTo).toBeTruthy()
    expect(defaultRotationDraft).toBeNull()
    expect(rotationContext.layoutDraft.visible).toBe(false)
    expect(rotationContext.layoutDraft.available).toBe(false)
    expect(rotationContext.allowedActions).toEqual(['upload_layout_draft', 'generate_layout_draft', 'cancel'])
    expect(rotationWithDraftContext.layoutDraft.visible).toBe(true)
    expect(rotationWithDraftContext.layoutDraft.available).toBe(true)
    expect(rotationWithDraftContext.allowedActions).toEqual(['partial_generate', 'cancel'])
  })
})
