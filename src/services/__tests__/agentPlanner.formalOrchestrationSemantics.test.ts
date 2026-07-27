import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { LayoutDraft, ScheduleState } from '@/types/orchestration'

const llmClientChatMock = vi.hoisted(() => vi.fn())

vi.mock('@/services/llm/llmClient', () => ({
  getLLMClient: () => ({ chat: llmClientChatMock }),
}))

vi.mock('@/services/llm/taskClassifier', () => ({
  getTaskClassifier: () => ({ classify: vi.fn() }),
}))

vi.mock('@/services/intentRecognizer', () => ({
  getIntentRecognizer: () => ({ recognize: vi.fn() }),
}))

vi.mock('@/services/paramExtractor', () => ({
  getParamExtractor: () => ({
    extractInsertParams: vi.fn(),
    extractDeleteParams: vi.fn(),
    extractMoveParams: vi.fn(),
    extractReplaceParams: vi.fn(),
  }),
}))

import { DemoRuntimeFacade } from '@/services/runtime/demoRuntimeFacade'

const cases = {
  overallRefill: {
    id: 'planner-formal-orchestration-keeps-overall-task-kind',
    userInput: '补齐当前所有空窗，9点到12点只是我举的例子',
    expectedDecision: '采用 planner action 的 overall_refill，不从示例时段改判为 local_refill',
    mustNotHappen: '本地正则覆盖 taskKind 或回填 targetTimeRange',
    verification: 'orchestration lifecycle.taskKind=overall_refill 且 targetTimeRange 未定义',
  },
  localRange: {
    id: 'planner-formal-orchestration-keeps-structured-range-and-keywords',
    userInput: '补齐9点到12点的新闻空窗',
    expectedDecision: '采用 planner action 给出的 14:00-16:00 与东方文化专题关键词',
    mustNotHappen: '从原话回填 09:00-12:00 或新闻关键词',
    verification: 'orchestrationRequest 精确透传 targetTimeRange 与 searchKeywords',
  },
  missingTaskKind: {
    id: 'planner-formal-orchestration-rejects-missing-task-kind',
    userInput: '帮我重新编排这张播单',
    expectedDecision: '缺少 taskKind 的 formal_orchestration action 不进入执行，返回澄清状态',
    mustNotHappen: '本地默认回填 full_day 并声称已经开始编排',
    verification: 'decision.kind=message、statusHint=needs_clarification 且 noMutation=true',
  },
} as const

const scheduleState: ScheduleState = {
  playlistId: 'tv-playlist',
  playlistType: 'tv',
  channelId: 'dragon',
  channelName: '东方卫视',
  date: '2026-03-25',
  isEmpty: false,
  itemCount: 1,
  gapCount: 3,
  hasSelectedTimeRange: false,
}

const layoutDraft: LayoutDraft = {
  id: 'tv-draft',
  channelId: 'dragon',
  date: '2026-03-25',
  source: 'channel_default',
  userIntent: '东方卫视全天版面',
  draftKind: 'time_slots',
  coverage: { start: '06:00:00', end: '23:59:59' },
  layoutReference: {
    id: 'tv-layout',
    name: '东方卫视版面',
    channelId: 'dragon',
    slots: [{
      id: 'slot-all-day',
      channelId: 'dragon',
      columnId: 'column-all-day',
      startTime: '2026-03-25T06:00:00+08:00',
      endTime: '2026-03-25T23:59:59+08:00',
    }],
  },
  columns: [{
    columnId: 'column-all-day',
    columnName: '全天版面',
    channelId: 'dragon',
    defaultProgramType: 'news_magazine',
    source: 'default',
  }],
}

const submit = (userInput: string) => new DemoRuntimeFacade().submitInstruction({
  scheduleState,
  userInput,
  currentSchedule: [],
  currentLayoutDraft: layoutDraft,
  history: [],
  agentCoreEnabled: true,
  layoutDraftEnabled: true,
  inputSource: 'user',
})

describe('AgentPlanner formal orchestration semantic ownership', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it(`${cases.overallRefill.id}: keeps LLM taskKind instead of reparsing user text`, async () => {
    const testCase = cases.overallRefill
    llmClientChatMock.mockResolvedValueOnce({
      content: JSON.stringify({
        mode: 'react',
        actions: [{
          type: 'formal_orchestration',
          mode: 'partial_generate',
          taskKind: 'overall_refill',
          useLayoutDraft: false,
          searchKeywords: ['城市更新'],
        }],
        reactTask: {
          objective: '补齐当前播单的全部空窗',
          nextActions: [{ type: 'research_check', purpose: 'candidate_precheck', queries: ['城市更新'] }],
        },
        assistantReplyDraft: '我会补齐当前播单的全部空窗。',
        reasoning: '用户目标是整体补空，提到的时段只是例子。',
      }),
    })

    const result = await submit(testCase.userInput)

    expect(testCase).toMatchObject({
      expectedDecision: expect.any(String),
      mustNotHappen: expect.any(String),
      verification: expect.any(String),
    })
    if (result.kind !== 'orchestration') throw new Error(`expected orchestration decision: ${JSON.stringify(result)}`)
    expect(result.orchestrationRequest.lifecycle?.taskKind).toBe('overall_refill')
    expect(result.orchestrationRequest.targetTimeRange).toBeUndefined()
    expect(result.orchestrationRequest.searchKeywords).toEqual(['城市更新'])
  })

  it(`${cases.localRange.id}: keeps LLM range and keywords instead of local rewrites`, async () => {
    const testCase = cases.localRange
    llmClientChatMock.mockResolvedValueOnce({
      content: JSON.stringify({
        mode: 'react',
        actions: [{
          type: 'formal_orchestration',
          mode: 'partial_generate',
          taskKind: 'local_refill',
          useLayoutDraft: false,
          targetTimeRange: { start: '14:00:00', end: '16:00:00' },
          searchKeywords: ['东方文化专题'],
        }],
        reactTask: {
          objective: '补齐14点到16点的东方文化专题空窗',
          nextActions: [{ type: 'research_check', purpose: 'candidate_precheck', queries: ['东方文化专题'] }],
        },
        assistantReplyDraft: '我会按确认后的时段和主题做局部补排。',
        reasoning: '结合会话上下文，实际目标是14点到16点的东方文化专题。',
      }),
    })

    const result = await submit(testCase.userInput)

    expect(testCase).toMatchObject({
      expectedDecision: expect.any(String),
      mustNotHappen: expect.any(String),
      verification: expect.any(String),
    })
    expect(result.kind).toBe('orchestration')
    if (result.kind !== 'orchestration') throw new Error('expected orchestration decision')
    expect(result.orchestrationRequest.lifecycle?.taskKind).toBe('local_refill')
    expect(result.orchestrationRequest.targetTimeRange).toEqual({ start: '14:00:00', end: '16:00:00' })
    expect(result.orchestrationRequest.searchKeywords).toEqual(['东方文化专题'])
  })

  it(`${cases.missingTaskKind.id}: exposes an invalid planner action instead of filling semantics locally`, async () => {
    const testCase = cases.missingTaskKind
    llmClientChatMock.mockResolvedValueOnce({
      content: JSON.stringify({
        actions: [{
          type: 'formal_orchestration',
          mode: 'full_generate',
          useLayoutDraft: true,
        }],
        assistantReplyDraft: '我现在开始重新编排整张播单。',
        reasoning: '模型漏掉了必须的 taskKind。',
      }),
    })

    const result = await submit(testCase.userInput)

    expect(testCase).toMatchObject({
      expectedDecision: expect.any(String),
      mustNotHappen: expect.any(String),
      verification: expect.any(String),
    })
    expect(result.kind).toBe('message')
    if (result.kind !== 'message') throw new Error('expected clarification message')
    expect(result.statusHint).toBe('needs_clarification')
    expect(result.feedback.details?.noMutation).toBe(true)
    expect(result.feedback.content).not.toContain('开始重新编排')
  })

  it('planner-formal-confirm-existing-rebuild: skips exactly the matching pending rebuild gate', async () => {
    const testCase = {
      id: 'planner-formal-confirm-existing-rebuild',
      userInput: '确认重新编排',
      expectedDecision: 'LLM 显式确认当前 formal rebuild pending 后进入 orchestration',
      mustNotHappen: '再次生成同一确认卡、用本地关键词绕过门禁、确认其他 pending',
      verification: 'decision.kind=orchestration 且 reactTask 原样透传',
    }
    llmClientChatMock.mockResolvedValueOnce({
      content: JSON.stringify({
        mode: 'react',
        actions: [{
          type: 'formal_orchestration', mode: 'full_generate', taskKind: 'full_day', useLayoutDraft: true,
          searchKeywords: [], confirmExistingRebuild: true,
        }],
        reactTask: { objective: '确认后重新编排', nextActions: [{ type: 'validate' }] },
        reasoning: '用户确认当前待处理的正式重编。',
      }),
    })

    const result = await new DemoRuntimeFacade().submitInstruction({
      scheduleState,
      userInput: testCase.userInput,
      currentSchedule: [],
      currentLayoutDraft: {
        ...layoutDraft,
        coverage: { start: '00:00:00', end: '24:00:00' },
        layoutReference: {
          ...layoutDraft.layoutReference,
          slots: [
            { ...layoutDraft.layoutReference.slots[0]!, id: 'slot-1', startTime: '2026-03-25T00:00:00+08:00', endTime: '2026-03-25T08:00:00+08:00' },
            { ...layoutDraft.layoutReference.slots[0]!, id: 'slot-2', startTime: '2026-03-25T08:00:00+08:00', endTime: '2026-03-25T16:00:00+08:00' },
            { ...layoutDraft.layoutReference.slots[0]!, id: 'slot-3', startTime: '2026-03-25T16:00:00+08:00', endTime: '2026-03-26T00:00:00+08:00' },
          ],
        },
      },
      pendingAtomicContext: {
        action: null,
        phase: 'formal_rebuild_confirmation',
        summary: '待确认重新编排',
        reasoning: '已有节目',
        originalUserInput: '帮我全天编排',
        collectedUserInput: '确认重新编排',
        slots: {},
        missingFields: [],
        followUpQuestion: '是否确认',
        formalRebuildConfirmation: {
          actionKind: 'formal_orchestration', mode: 'full_generate', useLayoutDraft: true,
          existingItemCount: 1, playlistType: 'tv', userInput: '帮我全天编排',
        },
        attemptCount: 0,
        createdAt: '2026-07-18T00:00:00.000Z',
        updatedAt: '2026-07-18T00:00:00.000Z',
      },
      agentCoreEnabled: true,
      layoutDraftEnabled: true,
      inputSource: 'user',
    })

    expect(testCase).toMatchObject({ expectedDecision: expect.any(String), mustNotHappen: expect.any(String), verification: expect.any(String) })
    if (result.kind !== 'orchestration') throw new Error(`expected orchestration decision: ${JSON.stringify(result)}`)
    expect(result.orchestrationRequest.reactTask?.objective).toBe('确认后重新编排')
  })
})
