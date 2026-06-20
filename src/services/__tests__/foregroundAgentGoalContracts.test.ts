import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { LayoutDraft, ScheduleState } from '@/types/orchestration'
import { DemoRuntimeFacade, type RuntimePendingCommand } from '@/services/runtime/demoRuntimeFacade'
import { buildForegroundAgentContextPackage } from '@/services/runtime/foregroundAgentContextPackage'
import { resolveForegroundLayoutDraft } from '@/services/runtime/foregroundLayoutDraft'
import { clearRuntimeLayout } from '@/services/orchestration/runtimeLayoutRegistry'
import { loadLLMConfig, saveLLMConfig } from '@/services/llm/llmConfig'

vi.mock('@/services/llm/llmClient', () => ({
  getLLMClient: () => ({}),
}))

vi.mock('@/services/llm/taskClassifier', () => ({
  getTaskClassifier: () => ({
    classify: vi.fn(async () => ({
      mode: 'clarify',
      confidence: 0.1,
      reasoning: 'goal contract uses deterministic foreground routes',
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

const storage = new Map<string, string>()
let cookieValue = ''

const installBrowserStorageMocks = () => {
  vi.stubGlobal('localStorage', {
    getItem: vi.fn((key: string) => storage.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      storage.set(key, value)
    }),
    removeItem: vi.fn((key: string) => {
      storage.delete(key)
    }),
  })

  vi.stubGlobal('document', {
    get cookie() {
      return cookieValue
    },
    set cookie(value: string) {
      const [pair = ''] = value.split(';')
      const [key = '', rawCookieValue = ''] = pair.split('=')
      if (!key) return
      if (/max-age=0/i.test(value)) {
        cookieValue = cookieValue
          .split(';')
          .map((item) => item.trim())
          .filter((item) => item && !item.startsWith(`${key}=`))
          .join('; ')
        return
      }
      const cookies = cookieValue
        .split(';')
        .map((item) => item.trim())
        .filter((item) => item && !item.startsWith(`${key}=`))
      cookies.push(`${key}=${rawCookieValue}`)
      cookieValue = cookies.join('; ')
    },
  })
}

const createScheduleState = (overrides: Partial<ScheduleState> = {}): ScheduleState => ({
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

const createLayoutDraft = (): LayoutDraft => ({
  id: 'goal-draft',
  channelId: 'dragon',
  date: '2026-03-25',
  effectiveFrom: '2026-03-01',
  effectiveTo: '2026-06-30',
  version: 3,
  source: 'channel_default',
  userIntent: '频道默认版面草案',
  coverage: { start: '09:00:00', end: '12:00:00' },
  layoutReference: {
    id: 'goal-layout',
    name: '东方卫视版面草案',
    channelId: 'dragon',
    slots: [
      {
        id: 'slot-news',
        channelId: 'dragon',
        columnId: 'column-news',
        startTime: '09:00:00',
        endTime: '12:00:00',
      },
    ],
  },
  columns: [
    {
      columnId: 'column-news',
      columnName: '看东方',
      channelId: 'dragon',
      defaultProgramType: 'news_magazine',
      source: 'default',
      draftConstraintKind: 'column',
    },
  ],
})

const createCompleteLayoutDraft = (): LayoutDraft => ({
  ...createLayoutDraft(),
  id: 'goal-complete-draft',
  coverage: { start: '06:00:00', end: '23:59:59' },
  layoutReference: {
    id: 'goal-complete-layout',
    name: '东方卫视全天版面草案',
    channelId: 'dragon',
    slots: [
      {
        id: 'slot-morning',
        channelId: 'dragon',
        columnId: 'column-news',
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
        columnId: 'column-evening-news',
        startTime: '18:00:00',
        endTime: '23:59:59',
      },
    ],
  },
  columns: [
    ...createLayoutDraft().columns,
    {
      columnId: 'column-drama',
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

describe('foreground agent goal contracts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    storage.clear()
    cookieValue = ''
    installBrowserStorageMocks()
    clearRuntimeLayout('dragon', '2026-03-25')
  })

  it('keeps a normal fill-gaps request on the formal playlist path even when a draft exists', async () => {
    const facade = new DemoRuntimeFacade()
    const draft = createCompleteLayoutDraft()

    const decision = await facade.submitInstruction({
      scheduleState: createScheduleState(),
      userInput: '补齐当前所有空窗',
      currentSchedule: [],
      currentLayoutDraft: draft,
      history: [],
      layoutDraftEnabled: true,
    })

    expect(decision.kind).toBe('orchestration')
    if (decision.kind !== 'orchestration') throw new Error('expected formal orchestration')
    expect(decision.orchestrationRequest.mode).toBe('partial_generate')
    expect(decision.orchestrationRequest.layoutDraft).toBeUndefined()
    expect(decision.orchestrationRequest.targetTimeRange).toBeUndefined()
    expect(decision.feedback.details?.usesLayoutDraft).toBe(false)
    expect(decision.feedback.details?.targetTimeRange).toBeUndefined()
  })

  it('treats normal time-range scheduling as formal playlist orchestration, not draft mutation', async () => {
    const facade = new DemoRuntimeFacade()
    const draft = createCompleteLayoutDraft()

    const decision = await facade.submitInstruction({
      scheduleState: createScheduleState({ isEmpty: true, itemCount: 0, gapCount: 1 }),
      userInput: '9点到12点编排东方剧场',
      currentSchedule: [],
      currentLayoutDraft: draft,
      history: [],
      layoutDraftEnabled: true,
    })

    expect(decision.kind).toBe('orchestration')
    if (decision.kind !== 'orchestration') throw new Error('expected formal orchestration')
    expect(decision.orchestrationRequest.mode).toBe('partial_generate')
    expect(decision.orchestrationRequest.layoutDraft).toBeUndefined()
    expect(decision.orchestrationRequest.targetTimeRange).toEqual({ start: '09:00:00', end: '12:00:00' })
    expect(decision.orchestrationRequest.searchKeywords).toEqual(['东方剧场'])
    expect(decision.feedback.details?.usesLayoutDraft).toBe(false)
    expect(decision.feedback.details?.searchKeywords).toEqual(['东方剧场'])
  })

  it('treats normal daypart scheduling as formal partial orchestration unless the draft is explicit', async () => {
    const facade = new DemoRuntimeFacade()
    const draft = createLayoutDraft()

    const decision = await facade.submitInstruction({
      scheduleState: createScheduleState({ isEmpty: false, itemCount: 2, gapCount: 1 }),
      userInput: '下午改成新闻栏目',
      currentSchedule: [],
      currentLayoutDraft: draft,
      history: [],
      layoutDraftEnabled: true,
    })

    expect(decision.kind).toBe('orchestration')
    if (decision.kind !== 'orchestration') throw new Error('expected formal orchestration')
    expect(decision.orchestrationRequest.mode).toBe('partial_generate')
    expect(decision.orchestrationRequest.layoutDraft).toBeUndefined()
    expect(decision.orchestrationRequest.targetTimeRange).toEqual({ start: '13:00:00', end: '18:00:00' })
    expect(decision.orchestrationRequest.searchKeywords).toEqual(['栏目=新闻'])
    expect(decision.feedback.details?.usesLayoutDraft).toBe(false)
  })

  it('keeps formal scheduling on the playlist path even after the draft workspace was active', async () => {
    const facade = new DemoRuntimeFacade()
    const draft = createLayoutDraft()

    const fillDecision = await facade.submitInstruction({
      scheduleState: createScheduleState({ isEmpty: false, itemCount: 2, gapCount: 1 }),
      userInput: '补齐当前所有空窗',
      currentSchedule: [],
      currentLayoutDraft: draft,
      history: [],
      layoutDraftEnabled: true,
      preferLayoutDraftRefine: true,
    })
    const daypartDecision = await facade.submitInstruction({
      scheduleState: createScheduleState({ isEmpty: false, itemCount: 2, gapCount: 1 }),
      userInput: '下午改成新闻栏目',
      currentSchedule: [],
      currentLayoutDraft: draft,
      history: [],
      layoutDraftEnabled: true,
      preferLayoutDraftRefine: true,
    })

    expect(fillDecision.kind).toBe('orchestration')
    if (fillDecision.kind !== 'orchestration') throw new Error('expected formal fill orchestration')
    expect(fillDecision.orchestrationRequest.layoutDraft).toBeUndefined()
    expect(fillDecision.feedback.details?.usesLayoutDraft).toBe(false)

    expect(daypartDecision.kind).toBe('orchestration')
    if (daypartDecision.kind !== 'orchestration') throw new Error('expected formal daypart orchestration')
    expect(daypartDecision.orchestrationRequest.layoutDraft).toBeUndefined()
    expect(daypartDecision.orchestrationRequest.targetTimeRange).toEqual({ start: '13:00:00', end: '18:00:00' })
    expect(daypartDecision.feedback.details?.usesLayoutDraft).toBe(false)
  })

  it('uses the draft only when the user explicitly references the draft for formal scheduling', async () => {
    const facade = new DemoRuntimeFacade()
    const draft = createLayoutDraft()

    const decision = await facade.submitInstruction({
      scheduleState: createScheduleState(),
      userInput: '参考草案补齐当前所有空窗',
      currentSchedule: [],
      currentLayoutDraft: draft,
      history: [],
      layoutDraftEnabled: true,
    })

    expect(decision.kind).toBe('layout_commit')
    if (decision.kind !== 'layout_commit') throw new Error('expected draft-backed orchestration')
    expect(decision.orchestrationRequest.mode).toBe('partial_generate')
    expect(decision.orchestrationRequest.layoutDraft).toBe(draft)
    expect(decision.feedback.details?.layoutSource).toBe('channel_default')
  })

  it('injects layout segments into the LLM context only for explicit draft-reference tasks', () => {
    const draft = createLayoutDraft()

    const atomicContext = buildForegroundAgentContextPackage({
      latestUserInput: '删除9点的节目',
      scheduleState: createScheduleState({ playlistId: 'playlist-tv-1' }),
      currentSchedule: [],
      currentLayoutDraft: draft,
    })
    const draftContext = buildForegroundAgentContextPackage({
      latestUserInput: '参考草案全天编排',
      scheduleState: createScheduleState({ playlistId: 'playlist-tv-1' }),
      currentSchedule: [],
      currentLayoutDraft: draft,
    })

    expect(atomicContext.workspace.workspaceKey).toBe('tv:playlist-tv-1')
    expect(atomicContext.layoutDraft.available).toBe(true)
    expect(atomicContext.layoutDraft.segments).toBeUndefined()
    expect(atomicContext.injectionProfile.includeLayoutSegments).toBe(false)
    expect(draftContext.layoutDraft.referencedByCurrentTask).toBe(true)
    expect(draftContext.layoutDraft.segments).toEqual([
      {
        id: 'slot-news',
        startTime: '09:00:00',
        endTime: '12:00:00',
        label: '看东方',
        constraintKind: 'column',
      },
    ])
    expect(draftContext.injectionProfile.includeLayoutSegments).toBe(true)
  })

  it.each([
    ['insert', '在9点插入节目看东方'],
    ['replace', '把9点的节目替换成东方新闻'],
    ['delete', '删除9点的节目'],
    ['move', '把9点的节目向后移动1小时'],
    ['query', '查询9点的节目'],
    ['validate', '执行校验'],
  ])('keeps old atomic %s wording out of layout-draft routing', (_action, userInput) => {
    const context = buildForegroundAgentContextPackage({
      latestUserInput: userInput,
      scheduleState: createScheduleState({ playlistId: 'playlist-tv-atomic' }),
      currentSchedule: [],
      currentLayoutDraft: createLayoutDraft(),
    })

    expect(context.scenario).toBe('atomic')
    expect(context.layoutDraft.available).toBe(true)
    expect(context.layoutDraft.segments).toBeUndefined()
    expect(context.injectionProfile.includeLayoutSegments).toBe(false)
    expect(context.allowedActions).toEqual(expect.arrayContaining(['insert', 'delete', 'move', 'replace', 'query', 'validate']))
  })

  it('expires a pending review when the user starts a different foreground task', () => {
    const pendingCommand: RuntimePendingCommand = {
      command: {
        action: 'delete',
        reasoning: 'delete requires user review',
        data: { itemId: 'item-1' },
      },
      summary: '删除 09:00 的《看东方》',
      reasoning: '删除会改变播单，需要确认。',
    }

    const confirmContext = buildForegroundAgentContextPackage({
      latestUserInput: '确认',
      scheduleState: createScheduleState({ playlistId: 'playlist-tv-review' }),
      currentSchedule: [],
      pendingCommand,
    })
    const unrelatedContext = buildForegroundAgentContextPackage({
      latestUserInput: '查询9点的节目',
      scheduleState: createScheduleState({ playlistId: 'playlist-tv-review' }),
      currentSchedule: [],
      pendingCommand,
    })

    expect(confirmContext.scenario).toBe('review')
    expect(confirmContext.review).toMatchObject({
      action: 'delete',
      expiresOnNextNonAnswer: true,
      allowedResponses: ['confirm', 'cancel'],
    })
    expect(unrelatedContext.scenario).toBe('atomic')
    expect(unrelatedContext.review).toMatchObject({
      action: 'delete',
      expiresOnNextNonAnswer: true,
    })
    expect(unrelatedContext.allowedActions).toContain('query')
  })

  it('keeps full-day and local refill as formal-generation scenarios rather than draft edits', () => {
    const draft = createCompleteLayoutDraft()
    const fullContext = buildForegroundAgentContextPackage({
      latestUserInput: '帮我全天编排',
      scheduleState: createScheduleState({ playlistId: 'playlist-tv-generate' }),
      currentSchedule: [],
      currentLayoutDraft: draft,
    })
    const partialContext = buildForegroundAgentContextPackage({
      latestUserInput: '局部补排当前空窗',
      scheduleState: createScheduleState({ playlistId: 'playlist-tv-generate' }),
      currentSchedule: [],
      currentLayoutDraft: draft,
    })

    expect(fullContext.scenario).toBe('full_generate')
    expect(fullContext.allowedActions).toEqual(['full_generate', 'cancel'])
    expect(fullContext.layoutDraft.available).toBe(true)
    expect(fullContext.layoutDraft.referencedByCurrentTask).toBe(false)
    expect(fullContext.layoutDraft.completeness.status).toBe('complete')
    expect(fullContext.layoutDraft.segments?.length).toBeGreaterThan(0)
    expect(fullContext.injectionProfile.includeLayoutSegments).toBe(true)
    expect(partialContext.scenario).toBe('partial_generate')
    expect(partialContext.allowedActions).toEqual(['partial_generate', 'cancel'])
    expect(partialContext.layoutDraft.segments).toBeUndefined()
    expect(partialContext.injectionProfile.includeLayoutSegments).toBe(false)
  })

  it('auto-loads TV drafts but does not invent a rotation draft before upload', () => {
    const tvDraft = resolveForegroundLayoutDraft({
      channelId: 'dragon',
      channelName: '东方卫视',
      date: '2026-03-25',
      playlistType: 'tv',
    })
    const rotationDraft = resolveForegroundLayoutDraft({
      channelId: 'dragon',
      channelName: '轮播单',
      date: '2026-03-25',
      playlistType: 'rotation',
    })

    expect(tvDraft?.source).toBe('channel_default')
    expect(tvDraft?.strategyProfile?.kind).toBe('tv_channel')
    expect(rotationDraft).toBeNull()
  })

  it('keeps the existing local API key when saving shared LLM settings without a key', () => {
    saveLLMConfig({
      apiKey: 'sk-existing',
      model: 'deepseek-ai/DeepSeek-V4-Flash',
      timeout: 15000,
    })

    saveLLMConfig({
      apiKey: '',
      model: 'deepseek-ai/DeepSeek-R1',
      timeout: 60000,
    })

    expect(loadLLMConfig()).toMatchObject({
      apiKey: 'sk-existing',
      model: 'deepseek-ai/DeepSeek-R1',
      timeout: 60000,
    })
    expect(document.cookie).toContain('llm_config_shared=')
  })
})
