import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ScheduleState } from '@/types/orchestration'
import { getAtomicCapabilities, resetAtomicCapabilities } from '@/services/atomicCapabilities'
import { resetCandidateService } from '@/services/candidateService'
import { DemoRuntimeFacade, type RuntimeDecision, type RuntimeScheduleItem } from '@/services/runtime/demoRuntimeFacade'
import type { RuntimePendingAtomicContext } from '@/services/runtime/pendingAtomicContext'
import type { AgentPendingTask, AgentResult } from '@/services/agent/types'
import {
  mapAtomicItemToPageItem,
  mapChatScheduleUpdateItemToAtomicSnapshot,
  type ChatScheduleUpdateItem,
} from '@/views/broadcast-plan/broadcastPlanScheduleBridge'

vi.mock('@/services/llm/llmClient', () => ({
  getLLMClient: () => ({}),
}))

vi.mock('@/services/llm/taskClassifier', () => ({
  getTaskClassifier: () => ({
    classify: vi.fn(async () => ({
      mode: 'clarify',
      confidence: 0.1,
      reasoning: 'foreground harness uses Agent Core path',
    })),
  }),
}))

const createScheduleState = (overrides: Partial<ScheduleState> = {}): ScheduleState => ({
  channelId: 'dragon',
  channelName: '东方卫视',
  date: '2026-03-25',
  isEmpty: true,
  itemCount: 0,
  gapCount: 0,
  hasSelectedTimeRange: false,
  ...overrides,
})

const tvEpisode1: RuntimeScheduleItem = {
  id: 'tv-episode-1',
  programCode: '002601120001',
  programName: '品质剧场：纵有疾风起 第1集',
  startTime: '09:00:00',
  endTime: '09:45:00',
  duration: 2700,
  programType: 'drama',
}

const tvEpisode3: RuntimeScheduleItem = {
  id: 'tv-episode-3',
  programCode: '002601120003',
  programName: '品质剧场：纵有疾风起 第3集',
  startTime: '10:30:00',
  endTime: '11:15:00',
  duration: 2700,
  programType: 'drama',
}

const tvMorningNews: RuntimeScheduleItem = {
  id: 'tv-news-0900',
  programCode: '002601010111',
  programName: '看东方第111期：新春特别行动',
  startTime: '09:00:00',
  endTime: '10:00:00',
  duration: 3600,
  programType: 'news_magazine',
}

const tvNoonNews: RuntimeScheduleItem = {
  id: 'tv-news-1000',
  programCode: '002601030001',
  programName: '东方新闻第001期：晚间要闻',
  startTime: '10:00:00',
  endTime: '10:30:00',
  duration: 1800,
  programType: 'news',
}

const normalizeClockText = (value: string): string => {
  if (value.includes('T')) return value.split('T')[1]?.slice(0, 8) || value
  return value.length === 5 ? `${value}:00` : value
}

const createAgentPendingTask = (patch: Partial<AgentPendingTask>): AgentPendingTask => ({
  id: 'pending-test',
  intent: 'insert',
  phase: 'needs_selection',
  originalInput: 'insert candidate',
  collectedInput: 'insert candidate',
  collectedSlots: {},
  missingSlots: ['candidateId'],
  allowedActions: ['select_candidate', 'cancel_pending', 'start_new_task'],
  attemptCount: 0,
  maxAttempts: 3,
  createdAt: '2026-03-25T00:00:00.000Z',
  updatedAt: '2026-03-25T00:00:00.000Z',
  ...patch,
})

const createAgentResultWithPendingTask = (pendingTask: AgentPendingTask, patch: Partial<AgentResult> = {}): AgentResult => ({
  status: pendingTask.phase === 'needs_selection' ? 'needs_selection' : 'needs_clarification',
  input: {
    userInput: pendingTask.originalInput,
    channelId: 'dragon',
    date: '2026-03-25',
    interpretation: {
      intent: pendingTask.intent,
      confidence: 1,
      source: 'test',
      slots: {},
      assistantFeedback: '我已经保留这次选择任务，需要你确认具体选项。',
    },
  } as AgentResult['input'],
  decision: {
    intent: pendingTask.intent,
    pendingTask,
    recommendations: pendingTask.recommendations,
  },
  explanation: '我找到了多个可用选项，需要你确认具体使用哪一个。',
  trace: [],
  ...patch,
})

const timeToSeconds = (value: string): number => {
  const [hours = 0, minutes = 0, seconds = 0] = normalizeClockText(value)
    .split(':')
    .map((part) => Number(part) || 0)
  return hours * 3600 + minutes * 60 + seconds
}

const formatPlayLengthText = (durationSeconds: number): string => {
  if (durationSeconds % 3600 === 0) return `${durationSeconds / 3600}小时`
  if (durationSeconds % 60 === 0) return `${durationSeconds / 60}分钟`
  return `${durationSeconds}秒`
}

const formatRelativeStart = (seconds: number): string => {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remainSeconds = seconds % 60
  return [hours, minutes, remainSeconds]
    .map((part) => String(part).padStart(2, '0'))
    .join(':')
}

const isRuntimeScheduleItemList = (value: unknown): value is RuntimeScheduleItem[] => (
  Array.isArray(value)
  && value.every((item) => (
    item
    && typeof item === 'object'
    && typeof (item as RuntimeScheduleItem).id === 'string'
    && typeof (item as RuntimeScheduleItem).startTime === 'string'
    && typeof (item as RuntimeScheduleItem).endTime === 'string'
  ))
)

const resolveScheduleItemsLikeChatPanel = (executionData: unknown, currentSchedule: RuntimeScheduleItem[]) => {
  if (isRuntimeScheduleItemList(executionData)) return executionData
  if (executionData && typeof executionData === 'object') {
    const record = executionData as Record<string, unknown>
    if (isRuntimeScheduleItemList(record.scheduleItems)) return record.scheduleItems
    if (isRuntimeScheduleItemList(record.items)) return record.items
  }

  const atomicItems = getAtomicCapabilities().getAllItems()
  if (atomicItems.length > 0 || currentSchedule.length > 0) return atomicItems
  return []
}

const applyRuntimeScheduleItemsLikeBroadcastPlan = (items: ChatScheduleUpdateItem[]) => {
  getAtomicCapabilities().loadItems(
    items.map((item, index) => mapChatScheduleUpdateItemToAtomicSnapshot(item, index, '2026-03-25', {
      normalizeClockText,
      timeToSeconds,
    })),
  )

  return getAtomicCapabilities().getAllItems().map((item, index) => mapAtomicItemToPageItem(item, index, {
    scheduleId: 'foreground-harness',
    formatPlayLengthText,
    formatRelativeStart,
  }))
}

const applyDecisionLikeChatPanel = (decision: RuntimeDecision, pending: RuntimePendingAtomicContext | null) => {
  if (decision.kind === 'pending_atomic_context') return decision.pendingAtomicContext
  if (decision.kind === 'message') return decision.pendingAtomicClarification ? pending : null
  if (decision.kind === 'agent_execution') return null
  return pending
}

describe('foreground ChatPanel to broadcast-plan Agent flow', () => {
  beforeEach(async () => {
    resetCandidateService()
    resetAtomicCapabilities()
    await getAtomicCapabilities().clearAll()
  })

  it('keeps rotation short-clip writes pending until confirmation, then maps the committed schedule to the foreground page', async () => {
    const facade = new DemoRuntimeFacade()
    const scheduleState = createScheduleState({
      playlistType: 'rotation',
      rotationStrategy: 'content_match',
      rotationDurationSeconds: 3 * 60 * 60,
      isEmpty: true,
      itemCount: 0,
    })

    const first = await facade.submitInstruction({
      scheduleState,
      userInput: '0点插入城市形象春日花路短片',
      currentSchedule: [],
      history: [],
      agentCoreEnabled: true,
      layoutDraftEnabled: false,
    })

    expect(first.kind).toBe('pending_atomic_context')
    if (first.kind !== 'pending_atomic_context') throw new Error('expected pending context')
    expect(first.pendingAtomicContext.agentPendingTask?.phase).toBe('needs_confirmation')
    expect(first.feedback.content).not.toContain('检索结果')
    expect(first.feedback.content).not.toContain('候选源')
    expect(first.feedback.content).not.toContain('拆成')
    expect(first.feedback.details?.assistantProcessSummary).toContain('已筛出 1 个可用候选。')
    expect(getAtomicCapabilities().getAllItems()).toEqual([])

    const confirmed = await facade.submitInstruction({
      scheduleState,
      userInput: '确认',
      currentSchedule: [],
      history: ['0点插入城市形象春日花路短片'],
      pendingAtomicContext: first.pendingAtomicContext,
      agentCoreEnabled: true,
      layoutDraftEnabled: false,
    })

    if (confirmed.kind !== 'agent_execution') {
      throw new Error(`unexpected confirmed decision: ${JSON.stringify(confirmed)}`)
    }
    expect(confirmed.kind).toBe('agent_execution')
    expect(confirmed.result.status).toBe('executed')
    expect(confirmed.result.executionResult?.committed).toBe(true)
    expect(
      confirmed.result.trace.some((step) => step.detail?.llmCall?.stage === 'intent_interpreter'),
    ).toBe(false)

    const emittedItems = resolveScheduleItemsLikeChatPanel(confirmed.result.executionResult, [])
    const pageItems = applyRuntimeScheduleItemsLikeBroadcastPlan(emittedItems)

    expect(pageItems).toHaveLength(1)
    expect(pageItems[0]).toMatchObject({
      startTime: '00:00:00',
      programType: 'short_clip',
    })
    expect(pageItems[0]?.programName).toContain('春日花路')
    expect(pageItems[0]?.programCode).toBe('')
    expect(pageItems[0]?.code18).toBe('')
    expect(pageItems[0]?.materialName).toBe('')
  })

  it('commits an explicit rotation short-clip insert even before total duration is set', async () => {
    const facade = new DemoRuntimeFacade()
    const scheduleState = createScheduleState({
      playlistType: 'rotation',
      rotationStrategy: 'content_match',
      rotationDurationSeconds: undefined,
      isEmpty: true,
      itemCount: 0,
    })

    const first = await facade.submitInstruction({
      scheduleState,
      userInput: '0点插入城市形象春日花路短片',
      currentSchedule: [],
      history: [],
      agentCoreEnabled: true,
      layoutDraftEnabled: false,
    })

    expect(first.kind).toBe('pending_atomic_context')
    if (first.kind !== 'pending_atomic_context') throw new Error('expected pending context')

    const confirmed = await facade.submitInstruction({
      scheduleState,
      userInput: '确认',
      currentSchedule: [],
      history: ['0点插入城市形象春日花路短片'],
      pendingAtomicContext: first.pendingAtomicContext,
      agentCoreEnabled: true,
      layoutDraftEnabled: false,
    })

    expect(confirmed.kind).toBe('agent_execution')
    if (confirmed.kind !== 'agent_execution') throw new Error('expected execution')
    expect(confirmed.result.status).toBe('executed')

    const emittedItems = resolveScheduleItemsLikeChatPanel(confirmed.result.executionResult, [])
    const pageItems = applyRuntimeScheduleItemsLikeBroadcastPlan(emittedItems)

    expect(pageItems).toHaveLength(1)
    expect(pageItems[0]?.startTime).toBe('00:00:00')
    expect(pageItems[0]?.programName).toContain('春日花路')
  })

  it('does not emit a foreground schedule write when the pending Agent task is cancelled', async () => {
    const facade = new DemoRuntimeFacade()
    const scheduleState = createScheduleState({
      playlistType: 'rotation',
      rotationStrategy: 'content_match',
      rotationDurationSeconds: 3 * 60 * 60,
      isEmpty: true,
      itemCount: 0,
    })

    const first = await facade.submitInstruction({
      scheduleState,
      userInput: '0点插入城市形象春日花路短片',
      currentSchedule: [],
      history: [],
      agentCoreEnabled: true,
      layoutDraftEnabled: false,
    })
    expect(first.kind).toBe('pending_atomic_context')
    if (first.kind !== 'pending_atomic_context') throw new Error('expected pending context')

    const cancelled = await facade.submitInstruction({
      scheduleState,
      userInput: '取消',
      currentSchedule: [],
      history: ['0点插入城市形象春日花路短片'],
      pendingAtomicContext: first.pendingAtomicContext,
      agentCoreEnabled: true,
      layoutDraftEnabled: false,
    })

    expect(cancelled.kind).toBe('message')
    expect(getAtomicCapabilities().getAllItems()).toEqual([])
    expect(resolveScheduleItemsLikeChatPanel(undefined, [])).toEqual([])
  })

  it('clears stale pending confirmations when the foreground playlist changes before commit', async () => {
    const facade = new DemoRuntimeFacade()
    const initialState = createScheduleState({
      playlistType: 'rotation',
      rotationStrategy: 'content_match',
      rotationDurationSeconds: 3 * 60 * 60,
      isEmpty: true,
      itemCount: 0,
    })

    const first = await facade.submitInstruction({
      scheduleState: initialState,
      userInput: '0点插入城市形象春日花路短片',
      currentSchedule: [],
      history: [],
      agentCoreEnabled: true,
      layoutDraftEnabled: false,
    })
    expect(first.kind).toBe('pending_atomic_context')
    if (first.kind !== 'pending_atomic_context') throw new Error('expected pending context')

    const changedSchedule: RuntimeScheduleItem[] = [{
      id: 'manual-refresh-item',
      programCode: '',
      programName: '人工刷新后的轮播素材',
      startTime: '00:30:00',
      endTime: '00:31:00',
      duration: 60,
      programType: 'short_clip',
    }]

    const blocked = await facade.submitInstruction({
      scheduleState: createScheduleState({
        playlistType: 'rotation',
        rotationStrategy: 'content_match',
        rotationDurationSeconds: 3 * 60 * 60,
        isEmpty: false,
        itemCount: changedSchedule.length,
      }),
      userInput: '确认',
      currentSchedule: changedSchedule,
      history: ['0点插入城市形象春日花路短片'],
      pendingAtomicContext: first.pendingAtomicContext,
      agentCoreEnabled: true,
      layoutDraftEnabled: false,
    })

    expect(blocked.kind).toBe('message')
    if (blocked.kind !== 'message') throw new Error('expected stale context message')
    expect(blocked.statusHint).toBe('failed')
    expect(blocked.feedback.content).toContain('最新播单')
    expect(blocked.feedback.details?.constraintReport).toMatchObject({
      issues: [
        expect.objectContaining({
          code: 'context_conflict',
        }),
      ],
    })
    expect(applyDecisionLikeChatPanel(blocked, first.pendingAtomicContext)).toBeNull()
    expect(getAtomicCapabilities().getAllItems()).toEqual([])
  })

  it('clears the foreground pending context when the user starts a new playlist document', async () => {
    const facade = new DemoRuntimeFacade()
    const rotationState = createScheduleState({
      playlistType: 'rotation',
      rotationStrategy: 'content_match',
      rotationDurationSeconds: 3 * 60 * 60,
      isEmpty: true,
      itemCount: 0,
    })

    const first = await facade.submitInstruction({
      scheduleState: rotationState,
      userInput: '0点插入城市形象春日花路短片',
      currentSchedule: [],
      history: [],
      agentCoreEnabled: true,
      layoutDraftEnabled: false,
    })
    expect(first.kind).toBe('pending_atomic_context')
    if (first.kind !== 'pending_atomic_context') throw new Error('expected pending context')

    const switched = await facade.submitInstruction({
      scheduleState: rotationState,
      userInput: '新建电视播单',
      currentSchedule: [],
      history: ['0点插入城市形象春日花路短片'],
      pendingAtomicContext: first.pendingAtomicContext,
      agentCoreEnabled: true,
      layoutDraftEnabled: false,
    })

    expect(switched.kind).toBe('message')
    if (switched.kind !== 'message') throw new Error('expected playlist state message')
    expect(switched.feedback.details?.playlistState).toMatchObject({
      playlistType: 'tv',
    })
    expect(applyDecisionLikeChatPanel(switched, first.pendingAtomicContext)).toBeNull()
  })

  it('blocks explicit TV episode skipping in the foreground flow and does not write a schedule update', async () => {
    const facade = new DemoRuntimeFacade()
    const scheduleState = createScheduleState({
      playlistType: 'tv',
      isEmpty: false,
      itemCount: 1,
    })

    const result = await facade.submitInstruction({
      scheduleState,
      userInput: '10点插入品质剧场：纵有疾风起 第3集',
      currentSchedule: [tvEpisode1],
      history: [],
      agentCoreEnabled: true,
      layoutDraftEnabled: false,
    })

    expect(result.kind).toBe('message')
    if (result.kind !== 'message') throw new Error('expected blocked message')
    expect(result.statusHint).toBe('failed')
    expect(result.feedback.content).toContain('顺播规则')
    expect(result.feedback.content).toContain('阻断')
    expect(result.feedback.details?.constraintReport).toMatchObject({
      issues: [
        expect.objectContaining({
          code: 'sequence_violation',
        }),
      ],
    })
    expect(resolveScheduleItemsLikeChatPanel(undefined, [])).toEqual([])
  })

  it('continues a TV sequential programme through the foreground path and writes the next episode', async () => {
    const facade = new DemoRuntimeFacade()
    const currentSchedule = [tvEpisode1]
    const scheduleState = createScheduleState({
      playlistType: 'tv',
      isEmpty: false,
      itemCount: currentSchedule.length,
    })

    const result = await facade.submitInstruction({
      scheduleState,
      userInput: '\u0039\u70b9\u0034\u0035\u5206\u63d2\u5165\u54c1\u8d28\u5267\u573a\uff1a\u7eb5\u6709\u75be\u98ce\u8d77',
      currentSchedule,
      history: [],
      agentCoreEnabled: true,
      layoutDraftEnabled: false,
    })

    expect(result.kind).toBe('agent_execution')
    if (result.kind !== 'agent_execution') throw new Error('expected execution')
    expect(result.result.status).toBe('executed')
    expect(result.result.executionResult?.committed).toBe(true)

    const emittedItems = resolveScheduleItemsLikeChatPanel(result.result.executionResult, currentSchedule)
    const pageItems = applyRuntimeScheduleItemsLikeBroadcastPlan(emittedItems)

    expect(pageItems).toHaveLength(2)
    expect(pageItems[0]).toMatchObject({
      id: tvEpisode1.id,
      startTime: '09:00:00',
      endTime: '09:45:00',
      programName: tvEpisode1.programName,
      programCode: tvEpisode1.programCode,
    })
    expect(pageItems[1]).toMatchObject({
      startTime: '09:45:00',
      endTime: '10:30:00',
      programName: '\u54c1\u8d28\u5267\u573a\uff1a\u7eb5\u6709\u75be\u98ce\u8d77 \u7b2c\u0032\u96c6',
      programCode: '002601120002',
    })
    expect(pageItems[1]?.programName).not.toContain('\u7b2c\u0033\u96c6')
  })

  it('moves a TV playlist item through the foreground path and maps the committed schedule back to the page', async () => {
    const facade = new DemoRuntimeFacade()
    const currentSchedule = [tvMorningNews]
    const scheduleState = createScheduleState({
      playlistType: 'tv',
      isEmpty: false,
      itemCount: currentSchedule.length,
    })

    const result = await facade.submitInstruction({
      scheduleState,
      userInput: '\u628a9\u70b9\u7684\u8282\u76ee\u79fb\u523010\u70b9',
      currentSchedule,
      history: [],
      agentCoreEnabled: true,
      layoutDraftEnabled: false,
    })

    expect(result.kind).toBe('agent_execution')
    if (result.kind !== 'agent_execution') throw new Error('expected execution')
    expect(result.result.status).toBe('executed')
    expect(result.result.executionResult?.committed).toBe(true)

    const emittedItems = resolveScheduleItemsLikeChatPanel(result.result.executionResult, currentSchedule)
    const pageItems = applyRuntimeScheduleItemsLikeBroadcastPlan(emittedItems)

    expect(pageItems).toHaveLength(1)
    expect(pageItems[0]).toMatchObject({
      id: tvMorningNews.id,
      startTime: '10:00:00',
      endTime: '11:00:00',
      programName: tvMorningNews.programName,
    })
  })

  it('inserts a TV programme through the foreground path and maps the committed schedule back to the page', async () => {
    const facade = new DemoRuntimeFacade()
    const currentSchedule: RuntimeScheduleItem[] = []
    const scheduleState = createScheduleState({
      playlistType: 'tv',
      isEmpty: true,
      itemCount: currentSchedule.length,
    })

    const result = await facade.submitInstruction({
      scheduleState,
      userInput: '\u57289\u70b9\u63d2\u5165\u4e1c\u65b9\u65b0\u95fb',
      currentSchedule,
      history: [],
      agentCoreEnabled: true,
      layoutDraftEnabled: false,
    })

    expect(result.kind).toBe('pending_atomic_context')
    if (result.kind !== 'pending_atomic_context') throw new Error('expected pending candidate selection')
    expect(result.pendingAtomicContext.agentPendingTask?.phase).toBe('needs_selection')
    expect(result.pendingAtomicContext.insertRecommendations.length).toBeGreaterThan(1)

    const confirmed = await facade.submitInstruction({
      scheduleState,
      userInput: '第一个',
      currentSchedule,
      history: ['在9点插入东方新闻'],
      pendingAtomicContext: result.pendingAtomicContext,
      agentCoreEnabled: true,
      layoutDraftEnabled: false,
    })

    expect(confirmed.kind).toBe('agent_execution')
    if (confirmed.kind !== 'agent_execution') throw new Error('expected execution')
    expect(confirmed.result.status).toBe('executed')
    expect(confirmed.result.executionResult?.committed).toBe(true)

    const emittedItems = resolveScheduleItemsLikeChatPanel(confirmed.result.executionResult, currentSchedule)
    const pageItems = applyRuntimeScheduleItemsLikeBroadcastPlan(emittedItems)

    expect(pageItems).toHaveLength(1)
    expect(pageItems[0]).toMatchObject({
      startTime: '09:00:00',
      endTime: '09:30:00',
      programName: tvNoonNews.programName,
      programCode: tvNoonNews.programCode,
    })
  })

  it('continues a missing-parameter TV insert from foreground pending context and writes the completed command', async () => {
    const facade = new DemoRuntimeFacade()
    const currentSchedule: RuntimeScheduleItem[] = []
    const scheduleState = createScheduleState({
      playlistType: 'tv',
      isEmpty: true,
      itemCount: currentSchedule.length,
    })

    const first = await facade.submitInstruction({
      scheduleState,
      userInput: '\u63d2\u5165\u4e1c\u65b9\u65b0\u95fb',
      currentSchedule,
      history: [],
      agentCoreEnabled: true,
      layoutDraftEnabled: false,
    })

    expect(first.kind).toBe('pending_atomic_context')
    if (first.kind !== 'pending_atomic_context') throw new Error('expected pending context')
    expect(first.pendingAtomicContext.agentPendingTask).toMatchObject({
      intent: 'insert',
      phase: 'needs_clarification',
      missingSlots: ['targetTime'],
    })
    expect(first.pendingAtomicContext.slots.programName).toBe('\u4e1c\u65b9\u65b0\u95fb')
    expect(getAtomicCapabilities().getAllItems()).toEqual([])

    const second = await facade.submitInstruction({
      scheduleState,
      userInput: '9\u70b9',
      currentSchedule,
      history: ['\u63d2\u5165\u4e1c\u65b9\u65b0\u95fb'],
      pendingAtomicContext: first.pendingAtomicContext,
      agentCoreEnabled: true,
      layoutDraftEnabled: false,
    })

    expect(second.kind).toBe('pending_atomic_context')
    if (second.kind !== 'pending_atomic_context') throw new Error('expected pending candidate selection')
    expect(second.pendingAtomicContext.agentPendingTask).toMatchObject({
      intent: 'insert',
      phase: 'needs_selection',
      collectedSlots: expect.objectContaining({
        targetTime: expect.objectContaining({
          value: '09:00:00',
        }),
        programHint: expect.objectContaining({
          value: '\u4e1c\u65b9\u65b0\u95fb',
        }),
      }),
      missingSlots: ['candidateId'],
    })

    const confirmed = await facade.submitInstruction({
      scheduleState,
      userInput: '第一个',
      currentSchedule,
      history: ['插入东方新闻', '9点'],
      pendingAtomicContext: second.pendingAtomicContext,
      agentCoreEnabled: true,
      layoutDraftEnabled: false,
    })

    if (confirmed.kind !== 'agent_execution') {
      throw new Error(`unexpected confirmed decision: ${JSON.stringify(confirmed)}`)
    }
    expect(confirmed.kind).toBe('agent_execution')
    expect(confirmed.result.status).toBe('executed')
    expect(confirmed.result.executionResult?.committed).toBe(true)

    const emittedItems = resolveScheduleItemsLikeChatPanel(confirmed.result.executionResult, currentSchedule)
    const pageItems = applyRuntimeScheduleItemsLikeBroadcastPlan(emittedItems)

    expect(pageItems).toHaveLength(1)
    expect(pageItems[0]).toMatchObject({
      startTime: '09:00:00',
      endTime: '09:30:00',
      programName: tvNoonNews.programName,
      programCode: tvNoonNews.programCode,
    })
    expect(applyDecisionLikeChatPanel(second, first.pendingAtomicContext)?.agentPendingTask?.phase).toBe('needs_selection')
  })

  it('maps Agent candidate selection pending tasks to foreground recommendation context', () => {
    const facade = new DemoRuntimeFacade()
    const pendingTask = createAgentPendingTask({
      intent: 'insert',
      recommendations: [
        {
          candidateId: 'candidate-drama-clean',
          programName: 'Prime Drama 第5集',
          programCode: 'DRAMA0005A',
          duration: 2700,
          programType: 'drama',
          score: 92,
          reason: '顺播候选',
        },
        {
          candidateId: 'candidate-drama-subtitled',
          programName: 'Prime Drama 第5集 字幕版',
          programCode: 'DRAMA0005B',
          duration: 2700,
          programType: 'drama',
          score: 88,
          reason: '同集备选',
        },
      ],
    })
    const result = createAgentResultWithPendingTask(pendingTask)

    const context = (facade as unknown as {
      buildAgentPendingAtomicContext(input: { userInput: string }, result: AgentResult, userFacingContent?: string): RuntimePendingAtomicContext
    }).buildAgentPendingAtomicContext({ userInput: pendingTask.originalInput }, result, result.explanation)

    expect(context.phase).toBe('recommending_insert')
    expect(context.missingFields).toEqual(['selection'])
    expect(context.insertRecommendations).toHaveLength(2)
    expect(context.insertRecommendations?.[0]).toMatchObject({
      candidateId: 'candidate-drama-clean',
      programName: 'Prime Drama 第5集',
      confidence: 0.92,
    })
    expect(context.targetCandidates).toBeUndefined()
  })

  it('maps Agent target selection pending tasks to foreground target-selection context', () => {
    const facade = new DemoRuntimeFacade()
    const pendingTask = createAgentPendingTask({
      intent: 'delete',
      recommendations: undefined,
      targetOptions: [
        {
          itemId: tvMorningNews.id,
          programName: tvMorningNews.programName,
          programCode: tvMorningNews.programCode,
          startTime: tvMorningNews.startTime,
          endTime: tvMorningNews.endTime,
          duration: tvMorningNews.duration,
          programType: tvMorningNews.programType,
        },
      ],
    })
    const result = createAgentResultWithPendingTask(pendingTask, {
      decision: {
        intent: 'delete',
        pendingTask,
      },
    })

    const context = (facade as unknown as {
      buildAgentPendingAtomicContext(input: { userInput: string }, result: AgentResult, userFacingContent?: string): RuntimePendingAtomicContext
    }).buildAgentPendingAtomicContext({ userInput: pendingTask.originalInput }, result, result.explanation)

    expect(context.phase).toBe('selecting_target')
    expect(context.missingFields).toEqual(['selection'])
    expect(context.targetCandidates).toEqual([
      expect.objectContaining({
        id: tvMorningNews.id,
        programName: tvMorningNews.programName,
      }),
    ])
    expect(context.insertRecommendations).toBeUndefined()
  })

  it('does not let stale LLM confirmation wording override resolved Agent evidence', () => {
    const facade = new DemoRuntimeFacade()
    const pendingTask = createAgentPendingTask({
      intent: 'delete',
      phase: 'needs_confirmation',
      originalInput: '\u5220\u96649\u70b9\u7684\u8282\u76ee',
      collectedInput: '\u5220\u96649\u70b9\u7684\u8282\u76ee',
      collectedSlots: {
        targetTime: {
          value: '09:00:00',
          source: 'user_initial',
          confidence: 1,
          rawText: '\u5220\u96649\u70b9\u7684\u8282\u76ee',
        },
        targetItemId: {
          value: tvMorningNews.id,
          source: 'system_inferred',
          confidence: 1,
          rawText: '\u5220\u96649\u70b9\u7684\u8282\u76ee',
        },
      },
      missingSlots: ['confirmation'],
      allowedActions: ['confirm', 'reject', 'cancel_pending'],
      targetOptions: undefined,
    })
    const result = createAgentResultWithPendingTask(pendingTask, {
      status: 'needs_confirmation',
      input: {
        userInput: pendingTask.originalInput,
        channelId: 'dragon',
        date: '2026-03-25',
        interpretation: {
          intent: 'delete',
          confidence: 1,
          source: 'test',
          slots: { targetTime: '09:00:00' },
          assistantFeedback: '\u6211\u7406\u89e3\u4f60\u60f3\u5220\u96649\u70b9\u7684\u8282\u76ee\uff0c\u6211\u4f1a\u5148\u5b9a\u4f4d\u8fd9\u6761\u8282\u76ee\u518d\u6267\u884c\u5220\u9664\u3002',
        },
      } as AgentResult['input'],
      decision: {
        intent: 'delete',
        pendingTask,
        resolvedTargets: [{
          ...tvMorningNews,
          sequence: 1,
          columnId: 'news',
          columnName: '新闻',
        }],
        command: {
          intent: 'delete',
          itemId: tvMorningNews.id,
          targetTime: '2026-03-25T09:00:00+08:00',
        } as AgentResult['decision']['command'],
      },
      explanation: '删除会改变当前播单，提交前需要确认。',
    })

    const content = (facade as unknown as {
      buildAgentUserFacingContent(result: AgentResult): string
    }).buildAgentUserFacingContent(result)

    expect(content).toContain('\u6211\u5df2\u7ecf\u5b9a\u4f4d\u5230')
    expect(content).toContain(tvMorningNews.programName)
    expect(content).not.toContain('\u6211\u4f1a\u5148\u5b9a\u4f4d')
    expect(content).not.toContain('\u518d\u6267\u884c\u5220\u9664')
  })

  it('blocks occupied move destinations in the foreground path and does not write a schedule update', async () => {
    const facade = new DemoRuntimeFacade()
    const currentSchedule = [tvMorningNews, tvNoonNews]
    const scheduleState = createScheduleState({
      playlistType: 'tv',
      isEmpty: false,
      itemCount: currentSchedule.length,
    })

    const result = await facade.submitInstruction({
      scheduleState,
      userInput: '\u628a9\u70b9\u7684\u8282\u76ee\u79fb\u523010\u70b9',
      currentSchedule,
      history: [],
      agentCoreEnabled: true,
      layoutDraftEnabled: false,
    })

    expect(result.kind).toBe('message')
    if (result.kind !== 'message') throw new Error('expected blocked message')
    expect(result.statusHint).toBe('failed')
    expect(result.feedback.content).toContain('\u4e1c\u65b9\u65b0\u95fb')
    expect(result.feedback.content).toContain('\u4e0d\u4f1a\u81ea\u52a8\u4e0b\u79fb')
    expect(result.feedback.details?.constraintReport).toMatchObject({
      issues: [
        expect.objectContaining({
          code: 'time_overlap',
          detail: expect.objectContaining({
            conflictItemId: tvNoonNews.id,
            blockedPolicy: 'no_auto_shift_replace_reorder',
          }),
        }),
      ],
    })
    expect(resolveScheduleItemsLikeChatPanel(undefined, [])).toEqual([])
  })

  it('blocks occupied insert destinations in the foreground path before writing a schedule update', async () => {
    const facade = new DemoRuntimeFacade()
    const currentSchedule = [tvNoonNews]
    const scheduleState = createScheduleState({
      playlistType: 'tv',
      isEmpty: false,
      itemCount: currentSchedule.length,
    })

    const result = await facade.submitInstruction({
      scheduleState,
      userInput: '\u572810\u70b9\u63d2\u5165\u770b\u4e1c\u65b9',
      currentSchedule,
      history: [],
      agentCoreEnabled: true,
      layoutDraftEnabled: false,
    })

    expect(result.kind).toBe('message')
    if (result.kind !== 'message') throw new Error('expected blocked message')
    expect(result.statusHint).toBe('failed')
    expect(result.feedback.content).toContain('\u4e1c\u65b9\u65b0\u95fb')
    expect(result.feedback.content).toContain('\u4e0d\u4f1a\u81ea\u52a8\u4e0b\u79fb')
    expect(result.feedback.details?.constraintReport).toMatchObject({
      issues: [
        expect.objectContaining({
          code: 'time_overlap',
          detail: expect.objectContaining({
            conflictItemId: tvNoonNews.id,
            blockedPolicy: 'no_auto_shift_replace_reorder',
          }),
        }),
      ],
    })
    expect(resolveScheduleItemsLikeChatPanel(undefined, [])).toEqual([])
  })

  it('allows explicit foreground TV replacements across columns when the target slot is otherwise writable', async () => {
    const facade = new DemoRuntimeFacade()
    const currentSchedule = [tvMorningNews]
    const scheduleState = createScheduleState({
      playlistType: 'tv',
      isEmpty: false,
      itemCount: currentSchedule.length,
    })

    const result = await facade.submitInstruction({
      scheduleState,
      userInput: '\u628a9\u70b9\u7684\u8282\u76ee\u66ff\u6362\u6210\u4e1c\u65b9\u65b0\u95fb',
      currentSchedule,
      history: [],
      agentCoreEnabled: true,
      layoutDraftEnabled: false,
    })

    expect(result.kind).toBe('pending_atomic_context')
    if (result.kind !== 'pending_atomic_context') throw new Error('expected pending candidate selection')
    expect(result.pendingAtomicContext.agentPendingTask?.phase).toBe('needs_selection')
    expect(result.pendingAtomicContext.insertRecommendations.length).toBeGreaterThan(1)

    const confirmed = await facade.submitInstruction({
      scheduleState,
      userInput: '第一个',
      currentSchedule,
      history: ['把9点的节目替换成东方新闻'],
      pendingAtomicContext: result.pendingAtomicContext,
      agentCoreEnabled: true,
      layoutDraftEnabled: false,
    })

    expect(confirmed.kind).toBe('agent_execution')
    if (confirmed.kind !== 'agent_execution') throw new Error('expected execution')
    expect(confirmed.result.status).toBe('executed')
    expect(confirmed.result.executionResult?.committed).toBe(true)

    const emittedItems = resolveScheduleItemsLikeChatPanel(confirmed.result.executionResult, currentSchedule)
    const pageItems = applyRuntimeScheduleItemsLikeBroadcastPlan(emittedItems)

    expect(pageItems).toHaveLength(1)
    expect(pageItems[0]).toMatchObject({
      id: tvMorningNews.id,
      startTime: '09:00:00',
      endTime: '09:30:00',
      programName: tvNoonNews.programName,
      programCode: tvNoonNews.programCode,
    })
  })

  it('blocks foreground replacements when the selected candidate would overlap the following programme', async () => {
    const facade = new DemoRuntimeFacade()
    const shortTarget: RuntimeScheduleItem = {
      ...tvNoonNews,
      id: 'tv-target-0900',
      programName: '\u5348\u95f430\u5206',
      startTime: '09:00:00',
      endTime: '09:30:00',
      duration: 1800,
    }
    const followingItem: RuntimeScheduleItem = {
      ...tvMorningNews,
      id: 'tv-following-0930',
      programName: '\u4e1c\u65b9\u65b0\u95fb',
      startTime: '09:30:00',
      endTime: '10:00:00',
      duration: 1800,
    }
    const currentSchedule = [shortTarget, followingItem]
    const scheduleState = createScheduleState({
      playlistType: 'tv',
      isEmpty: false,
      itemCount: currentSchedule.length,
    })

    const result = await facade.submitInstruction({
      scheduleState,
      userInput: '把9点的节目替换成看东方第111期：新春特别行动',
      currentSchedule,
      history: [],
      agentCoreEnabled: true,
      layoutDraftEnabled: false,
    })

    expect(result.kind).toBe('message')
    if (result.kind !== 'message') throw new Error('expected blocked message')
    expect(result.statusHint).toBe('failed')
    expect(result.feedback.content).toContain('\u4e1c\u65b9\u65b0\u95fb')
    expect(result.feedback.content).toContain('\u4e0d\u4f1a\u81ea\u52a8\u79fb\u52a8')
    expect(result.feedback.details?.constraintReport).toMatchObject({
      issues: [
        expect.objectContaining({
          code: 'time_overlap',
          detail: expect.objectContaining({
            conflictItemId: followingItem.id,
            blockedPolicy: 'no_auto_shift_replace_reorder',
          }),
        }),
      ],
    })
    expect(resolveScheduleItemsLikeChatPanel(undefined, [])).toEqual([])
  })

  it('keeps TV deletes pending until confirmation, then maps the deletion back to the foreground page', async () => {
    const facade = new DemoRuntimeFacade()
    const currentSchedule = [tvMorningNews]
    const scheduleState = createScheduleState({
      playlistType: 'tv',
      isEmpty: false,
      itemCount: currentSchedule.length,
    })

    const first = await facade.submitInstruction({
      scheduleState,
      userInput: '\u5220\u96649\u70b9\u7684\u8282\u76ee',
      currentSchedule,
      history: [],
      agentCoreEnabled: true,
      layoutDraftEnabled: false,
    })

    expect(first.kind).toBe('pending_atomic_context')
    if (first.kind !== 'pending_atomic_context') throw new Error('expected pending context')
    expect(first.pendingAtomicContext.agentPendingTask?.phase).toBe('needs_confirmation')
    expect(first.feedback.content).toContain('确认后')
    expect(first.feedback.content).not.toContain('先定位')
    expect(first.pendingAtomicContext.confirmationNote).toBe(first.feedback.content)
    expect(first.pendingAtomicContext.slots.targetItemName).toBe(tvMorningNews.programName)
    expect(getAtomicCapabilities().getAllItems()).toEqual([])

    const confirmed = await facade.submitInstruction({
      scheduleState,
      userInput: '\u786e\u8ba4',
      currentSchedule,
      history: ['\u5220\u96649\u70b9\u7684\u8282\u76ee'],
      pendingAtomicContext: first.pendingAtomicContext,
      agentCoreEnabled: true,
      layoutDraftEnabled: false,
    })

    expect(confirmed.kind).toBe('agent_execution')
    if (confirmed.kind !== 'agent_execution') throw new Error('expected execution')
    expect(confirmed.result.status).toBe('executed')
    expect(confirmed.result.executionResult?.committed).toBe(true)
    expect(
      confirmed.result.trace.some((step) => step.detail?.llmCall?.stage === 'intent_interpreter'),
    ).toBe(false)

    const emittedItems = resolveScheduleItemsLikeChatPanel(confirmed.result.executionResult, currentSchedule)
    const pageItems = applyRuntimeScheduleItemsLikeBroadcastPlan(emittedItems)

    expect(pageItems).toEqual([])
  })

  it('keeps TV deletes pending and leaves the foreground page unchanged when rejected', async () => {
    const facade = new DemoRuntimeFacade()
    const currentSchedule = [tvMorningNews]
    const scheduleState = createScheduleState({
      playlistType: 'tv',
      isEmpty: false,
      itemCount: currentSchedule.length,
    })

    const first = await facade.submitInstruction({
      scheduleState,
      userInput: '\u5220\u96649\u70b9\u7684\u8282\u76ee',
      currentSchedule,
      history: [],
      agentCoreEnabled: true,
      layoutDraftEnabled: false,
    })

    expect(first.kind).toBe('pending_atomic_context')
    if (first.kind !== 'pending_atomic_context') throw new Error('expected pending context')
    expect(first.pendingAtomicContext.agentPendingTask?.phase).toBe('needs_confirmation')
    expect(getAtomicCapabilities().getAllItems()).toEqual([])

    const rejected = await facade.submitInstruction({
      scheduleState,
      userInput: '\u53d6\u6d88',
      currentSchedule,
      history: ['\u5220\u96649\u70b9\u7684\u8282\u76ee'],
      pendingAtomicContext: first.pendingAtomicContext,
      agentCoreEnabled: true,
      layoutDraftEnabled: false,
    })

    expect(rejected.kind).toBe('message')
    if (rejected.kind !== 'message') throw new Error('expected cancellation message')
    expect(rejected.statusHint).toBe('cancelled')
    expect(rejected.feedback.content).toContain('\u4e0d\u4f1a\u5199\u5165\u5f53\u524d\u64ad\u5355')
    expect(getAtomicCapabilities().getAllItems()).toEqual([])

    const pageItems = applyRuntimeScheduleItemsLikeBroadcastPlan(currentSchedule)
    expect(pageItems).toHaveLength(1)
    expect(pageItems[0]).toMatchObject({
      startTime: '09:00:00',
      programName: tvMorningNews.programName,
    })
  })

  it('answers foreground schedule queries without writing back to the page', async () => {
    const facade = new DemoRuntimeFacade()
    const currentSchedule = [tvMorningNews]

    const result = await facade.submitInstruction({
      scheduleState: createScheduleState({
        playlistType: 'tv',
        isEmpty: false,
        itemCount: currentSchedule.length,
      }),
      userInput: '9\u70b9\u662f\u4ec0\u4e48\u8282\u76ee',
      currentSchedule,
      history: [],
      agentCoreEnabled: true,
      layoutDraftEnabled: false,
    })

    expect(result.kind).toBe('message')
    if (result.kind !== 'message') throw new Error('expected query message')
    expect(result.statusHint).toBe('completed')
    expect(result.feedback.content).toContain('09:00:00')
    expect(result.feedback.content).toContain('\u770b\u4e1c\u65b9')
    expect(result.feedback.details?.queryResult).toMatchObject({
      kind: 'time_lookup',
      totalCount: 1,
    })
    expect(result.feedback.details?.agentEvidenceBudget).toMatchObject({
      scheduleItems: expect.objectContaining({
        included: 1,
        total: 1,
        truncated: false,
      }),
    })
    expect(getAtomicCapabilities().getAllItems()).toEqual([])
    expect(result.feedback.details?.affectedItemIds).toBeUndefined()
  })

  it('routes natural programme-location questions through the foreground Agent path', async () => {
    const facade = new DemoRuntimeFacade()
    const currentSchedule = [tvMorningNews]

    const result = await facade.submitInstruction({
      scheduleState: createScheduleState({
        playlistType: 'tv',
        isEmpty: false,
        itemCount: currentSchedule.length,
      }),
      userInput: '\u770b\u4e1c\u65b9\u5728\u54ea',
      currentSchedule,
      history: [],
      agentCoreEnabled: true,
      layoutDraftEnabled: false,
    })

    expect(result.kind).toBe('message')
    if (result.kind !== 'message') throw new Error('expected programme-location query message')
    expect(result.statusHint).toBe('completed')
    expect(result.feedback.content).toContain('09:00:00')
    expect(result.feedback.content).toContain('\u770b\u4e1c\u65b9')
    expect(result.feedback.details?.queryResult).toMatchObject({
      kind: 'program_lookup',
      totalCount: 1,
    })
    expect(getAtomicCapabilities().getAllItems()).toEqual([])
    expect(result.feedback.details?.affectedItemIds).toBeUndefined()
  })

  it('runs foreground validation as a read-only Agent decision without writing back to the page', async () => {
    const facade = new DemoRuntimeFacade()
    const currentSchedule = [tvMorningNews]

    const result = await facade.submitInstruction({
      scheduleState: createScheduleState({
        playlistType: 'tv',
        isEmpty: false,
        itemCount: currentSchedule.length,
      }),
      userInput: '\u6821\u9a8c\u5f53\u524d\u64ad\u5355',
      currentSchedule,
      history: [],
      agentCoreEnabled: true,
      layoutDraftEnabled: false,
    })

    expect(result.kind).toBe('message')
    if (result.kind !== 'message') throw new Error('expected validation message')
    expect(result.statusHint).toBe('completed')
    expect(result.feedback.content).toContain('\u6821\u9a8c')
    expect(result.feedback.details?.validationReport).toBeTruthy()
    expect(getAtomicCapabilities().getAllItems()).toEqual([])
    expect(result.feedback.details?.affectedItemIds).toBeUndefined()
  })

  it('describes foreground validation issues in Chinese business language', async () => {
    const facade = new DemoRuntimeFacade()
    const currentSchedule = [tvEpisode1, tvEpisode3]

    const result = await facade.submitInstruction({
      scheduleState: createScheduleState({
        playlistType: 'tv',
        isEmpty: false,
        itemCount: currentSchedule.length,
      }),
      userInput: '校验当前播单',
      currentSchedule,
      history: [],
      agentCoreEnabled: true,
      layoutDraftEnabled: false,
    })

    expect(result.kind).toBe('message')
    if (result.kind !== 'message') throw new Error('expected validation message')
    expect(result.statusHint).toBe('completed')
    expect(result.feedback.content).toContain('校验完成')
    expect(result.feedback.content).toContain('顺播')
    expect(result.feedback.content).not.toContain('Validation found')
    expect(result.feedback.details?.validationReport).toMatchObject({
      ok: false,
      issues: [
        expect.objectContaining({
          code: 'sequence_violation',
        }),
      ],
    })
    expect(getAtomicCapabilities().getAllItems()).toEqual([])
  })
})
