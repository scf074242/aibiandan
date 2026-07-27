import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getAtomicCapabilities, resetAtomicCapabilities } from '@/services/atomicCapabilities'
import { DemoRuntimeFacade, type RuntimeScheduleItem } from '@/services/runtime/demoRuntimeFacade'
import { findCanonicalCandidate } from '@/services/agent/canonicalSchedulingData'
import type { ProgramCandidate } from '@/types/orchestration'
import type { ScheduleState } from '@/types/orchestration'

const llmMocks = vi.hoisted(() => ({
  chat: vi.fn(),
}))
let activeUserInput = ''
let activePendingContextForLlm: unknown

const requireCanonicalCandidate = (query: string): ProgramCandidate => {
  const candidate = findCanonicalCandidate(query)
  if (!candidate) throw new Error(`data_fixture_missing:${query}`)
  return candidate
}

vi.mock('@/services/llm/llmClient', () => ({
  getLLMClient: () => ({
    chat: llmMocks.chat,
  }),
}))

vi.mock('@/services/llm/taskClassifier', () => ({
  getTaskClassifier: () => ({
    classify: vi.fn(async () => ({
      mode: 'clarify',
      confidence: 0.1,
      reasoning: 'test keeps routing in Agent Core',
    })),
  }),
}))

const createScheduleState = (patch: Partial<ScheduleState> = {}): ScheduleState => ({
  playlistId: 'playlist-tv-task-plan-draft',
  channelId: 'dragon-tv',
  channelName: '东方卫视',
  date: '2026-03-25',
  isEmpty: false,
  itemCount: 0,
  gapCount: 0,
  hasSelectedTimeRange: false,
  playlistType: 'tv',
  ...patch,
})

const createItem = (
  id: string,
  programName: string,
  startTime: string,
  endTime: string,
): RuntimeScheduleItem => ({
  id,
  programCode: id,
  programName,
  startTime,
  endTime,
  duration: Math.max(0, (new Date(endTime).getTime() - new Date(startTime).getTime()) / 1000),
  programType: 'tv',
})

const createFacadeWithStructuredPendingPlanner = (): DemoRuntimeFacade => {
  const facade = new DemoRuntimeFacade()
  let activePendingContext: unknown
  const planner = (facade as unknown as {
    agentPlanner: { plan: (input: { userInput: string; contextPackage?: unknown }, deadline?: unknown) => Promise<unknown> }
  }).agentPlanner
  const originalPlan = planner.plan.bind(planner)

  vi.spyOn(planner, 'plan').mockImplementation(async (input, deadline) => {
    const userInput = input.userInput.trim()
    const pending = activePendingContext as {
      action?: string
      resumeCompositeTask?: { kind?: string }
      insertRecommendations?: Array<{ candidateId?: string }>
    } | undefined
    const intent = pending?.action === 'move'
      ? 'move'
      : pending?.action === 'insert'
        ? 'insert'
        : pending?.action === 'replace'
          ? 'replace'
      : pending?.resumeCompositeTask?.kind === 'batch_replace'
        ? 'replace'
        : JSON.stringify(activePendingContext).includes('insert_with_shift')
          ? 'insert'
          : 'batch_delete'

    if (userInput === '确认') {
      return {
        mode: 'single',
        pendingAction: 'confirm',
        actions: [{ type: 'atomic_command', intent, pendingAction: 'confirm', mutationPolicy: 'formal_write' }],
        assistantReplyDraft: '确认执行当前待处理任务。',
        reasoning: '用户确认当前结构化 pending。',
      }
    }
    if (userInput === '第一个') {
      return {
        mode: 'single',
        pendingAction: 'select_candidate',
        actions: [{
          type: 'atomic_command',
          intent: 'replace',
          pendingAction: 'select_candidate',
          candidateId: pending?.insertRecommendations?.[0]?.candidateId,
          mutationPolicy: 'formal_write',
        }],
        assistantReplyDraft: '选择第一个候选。',
        reasoning: '用户选择当前候选列表中的第一项。',
      }
    }
    return await originalPlan(input, deadline)
  })

  const originalSubmitInstruction = facade.submitInstruction.bind(facade)
  ;(facade as unknown as { submitInstruction: typeof facade.submitInstruction }).submitInstruction = async (input) => {
    activeUserInput = input.userInput.trim()
    activePendingContext = input.pendingAtomicContext
    activePendingContextForLlm = input.pendingAtomicContext
    const isPlannerTurn = activeUserInput === '确认' || activeUserInput === '第一个'
    return await originalSubmitInstruction({
      ...input,
      inputSource: isPlannerTurn ? 'user' : input.inputSource,
    })
  }
  return facade
}

describe('DemoRuntimeFacade LLM taskPlanDraft integration', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    activeUserInput = ''
    activePendingContextForLlm = undefined
    resetAtomicCapabilities()
    await getAtomicCapabilities().clearAll()
    llmMocks.chat.mockImplementation(async () => ({
      content: JSON.stringify(activeUserInput === '确认'
        ? {
            intent: JSON.stringify(activePendingContextForLlm).includes('batch_replace')
              ? 'replace'
              : (activePendingContextForLlm as { action?: string } | undefined)?.action === 'replace'
                ? 'replace'
              : (activePendingContextForLlm as { action?: string } | undefined)?.action === 'move'
                ? 'move'
                : 'insert',
            pendingAction: 'confirm',
            confidence: 1,
            slots: {},
            assistantFeedback: '确认执行当前待处理任务。',
          }
        : activeUserInput === '第一个'
          ? {
              intent: 'replace',
              pendingAction: 'select_candidate',
              confidence: 1,
              slots: {
                candidateId: (activePendingContextForLlm as { insertRecommendations?: Array<{ candidateId?: string }> } | undefined)
                  ?.insertRecommendations?.[0]?.candidateId,
              },
              assistantFeedback: '选择第一个候选。',
            }
          : {
        intent: 'batch_delete',
        confidence: 0.93,
        slots: {
          targetProgramName: '看东方',
        },
        assistantReplyDraft: '我理解你想清掉当前播单里的看东方，我会先拆成批量删除任务，确认后再写入。',
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
    }))
  })

  it('compiles LLM taskPlanDraft into the same foreground pending confirmation path', async () => {
    const facade = createFacadeWithStructuredPendingPlanner()
    const currentSchedule = [
      createItem('item-east-1', '看东方', '2026-03-25T07:00:00+08:00', '2026-03-25T09:00:00+08:00'),
      createItem('item-news', '东方新闻', '2026-03-25T18:30:00+08:00', '2026-03-25T19:00:00+08:00'),
      createItem('item-east-2', '看东方 午间版', '2026-03-25T22:00:00+08:00', '2026-03-25T22:30:00+08:00'),
    ]

    const decision = await facade.submitInstruction({
      scheduleState: createScheduleState({ itemCount: currentSchedule.length }),
      userInput: '清掉当前播单里所有看东方',
      currentSchedule,
      history: [],
      agentCoreEnabled: true,
      layoutDraftEnabled: false,
    })

    expect(llmMocks.chat).toHaveBeenCalled()
    expect(decision.kind).toBe('pending_atomic_context')
    if (decision.kind !== 'pending_atomic_context') throw new Error('expected pending task plan')
    expect(decision.pendingAtomicContext.compositeTaskRun?.goal).toBe('删除全部《看东方》')
    expect(decision.pendingAtomicContext.compositeTaskRun?.stages[0]?.steps).toHaveLength(2)
    expect(decision.pendingAtomicContext.compositeTaskRun?.stages.at(-1)?.type).toBe('verify')
    expect(decision.feedback.content).toContain('确认后我再写入播单')
    expect(getAtomicCapabilities().getAllItems()).toEqual([])
  })

  it('blocks conflicting LLM taskPlanDraft before it reaches confirmation', async () => {
    llmMocks.chat.mockResolvedValueOnce({
      content: JSON.stringify({
        intent: 'insert',
        confidence: 0.9,
        slots: {
          targetTime: '09:00:00',
          programHint: '看东方',
        },
        assistantReplyDraft: '我理解你想在9点插入两个节目。',
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
    const facade = createFacadeWithStructuredPendingPlanner()
    const currentSchedule = [
      createItem('item-news', '东方新闻', '2026-03-25T18:30:00+08:00', '2026-03-25T19:00:00+08:00'),
    ]

    const decision = await facade.submitInstruction({
      scheduleState: createScheduleState({ itemCount: currentSchedule.length }),
      userInput: '请把看东方和百姓大讲堂都安排到同一个9点播出点',
      currentSchedule,
      history: [],
      agentCoreEnabled: true,
      layoutDraftEnabled: false,
    })

    expect(llmMocks.chat).toHaveBeenCalled()
    expect(decision.kind).toBe('message')
    if (decision.kind !== 'message') throw new Error('expected conflict message')
    expect(decision.statusHint).toBe('needs_clarification')
    expect(decision.feedback.processTypeLabel).toBe('需要确认顺序')
    expect(decision.feedback.content).toContain('同时要插入多个节目')
    expect(getAtomicCapabilities().getAllItems()).toEqual([])
  })

  it('compiles an LLM insert-with-shift taskPlanDraft into pending confirmation and executes it after approval', async () => {
    llmMocks.chat.mockResolvedValueOnce({
      content: JSON.stringify({
        intent: 'insert',
        confidence: 0.91,
        slots: {
          targetTime: '09:00:00',
          programHint: '城市形象宣传片',
        },
        assistantReplyDraft: '我理解你想在9点插入30分钟宣传片，并把后面的节目顺延；我会先生成待确认计划。',
        taskPlanDraft: {
          isComposite: true,
          goal: '9点插入30分钟宣传片，已有节目顺延',
          stages: [{
            type: 'batch_atomic',
            action: 'move',
            target: {
              targetTime: '09:00:00',
              scope: 'time_range',
            },
            requiresConfirmation: true,
            summary: '先把9点起受影响节目后移30分钟',
          }, {
            type: 'atomic',
            action: 'insert',
            target: {
              targetTime: '09:00:00',
              programName: '城市形象宣传片',
              candidateId: 'candidate-promo-30m',
              candidateCode: 'candidate-promo-30m',
              programType: 'tv',
              durationSeconds: 1800,
            },
            requiresConfirmation: true,
            summary: '再在9点插入城市形象宣传片',
          }, {
            type: 'verify',
            requiresConfirmation: false,
            summary: '检查顺延后的时间轴',
          }],
        },
      }),
    })
    const facade = createFacadeWithStructuredPendingPlanner()
    const currentSchedule = [
      createItem('item-0900', '看东方', '2026-03-25T09:00:00+08:00', '2026-03-25T09:30:00+08:00'),
      createItem('item-0930', '东方快报', '2026-03-25T09:30:00+08:00', '2026-03-25T10:00:00+08:00'),
    ]

    const decision = await facade.submitInstruction({
      scheduleState: createScheduleState({ itemCount: currentSchedule.length }),
      userInput: '请按计划在9点插入30分钟宣传片，后面的节目顺延',
      currentSchedule,
      history: [],
      agentCoreEnabled: true,
      layoutDraftEnabled: false,
    })

    expect(llmMocks.chat).toHaveBeenCalled()
    expect(decision.kind).toBe('pending_atomic_context')
    if (decision.kind !== 'pending_atomic_context') throw new Error('expected insert-with-shift pending task')
    expect(decision.pendingAtomicContext.compositeTaskRun?.stages.map((stage) => stage.action ?? stage.type)).toEqual([
      'move',
      'insert',
      'verify',
    ])
    expect(decision.pendingAtomicContext.compositeTaskRun?.stages[0]?.steps).toHaveLength(2)
    expect(decision.feedback.content).toContain('确认后我再写入播单')
    expect(getAtomicCapabilities().getAllItems()).toEqual([])

    const confirmed = await facade.submitInstruction({
      scheduleState: createScheduleState({ itemCount: currentSchedule.length }),
      userInput: '确认',
      currentSchedule,
      history: ['请按计划在9点插入30分钟宣传片，后面的节目顺延'],
      pendingAtomicContext: decision.pendingAtomicContext,
      agentCoreEnabled: true,
      layoutDraftEnabled: false,
    })

    expect(confirmed.kind).toBe('agent_execution')
    if (confirmed.kind !== 'agent_execution') throw new Error('expected insert-with-shift execution')
    expect(confirmed.result.status).toBe('executed')
    expect(confirmed.feedback.content).toContain('时间轴没有重叠')
    const items = confirmed.result.executionResult?.scheduleItems ?? []
    expect(items.map((item) => item.programName)).toEqual([
      '城市形象宣传片',
      '看东方',
      '东方快报',
    ])
    expect(items[0]?.startTime).toBe('2026-03-25T09:00:00+08:00')
    expect(items[1]?.startTime).toBe('2026-03-25T09:30:00+08:00')
    expect(items[2]?.startTime).toBe('2026-03-25T10:00:00+08:00')
  })

  it('routes LLM batch replace taskPlanDraft through candidate selection before confirmed execution', async () => {
    llmMocks.chat.mockResolvedValueOnce({
      content: JSON.stringify({
        intent: 'replace',
        confidence: 0.9,
        slots: {
          targetProgramName: '东方剧场',
          replacementHint: '轻量资讯',
        },
        assistantReplyDraft: '我理解你想把下午的东方剧场换成轻量资讯，但需要先确认候选。',
        taskPlanDraft: {
          isComposite: true,
          goal: '把下午东方剧场换成轻量资讯',
          stages: [{
            type: 'batch_atomic',
            action: 'replace',
            target: {
              programName: '东方剧场',
              replacementHint: '轻量资讯',
              scope: 'current_playlist',
            },
            requiresConfirmation: true,
            summary: '把当前播单里的东方剧场批量替换成轻量资讯',
          }, {
            type: 'verify',
            requiresConfirmation: false,
            summary: '检查下午内容结构是否变轻',
          }],
        },
      }),
    })
    const facade = createFacadeWithStructuredPendingPlanner()
    vi.spyOn((facade as any).candidateService, 'searchPrograms').mockResolvedValue([
      requireCanonicalCandidate('生命树 第1集'),
    ])
    const currentSchedule = [
      createItem('item-drama-1', '东方剧场：纵有疾风起 第5集', '2026-03-25T13:00:00+08:00', '2026-03-25T13:45:00+08:00'),
      createItem('item-drama-2', '东方剧场：纵有疾风起 第6集', '2026-03-25T13:45:00+08:00', '2026-03-25T14:30:00+08:00'),
      createItem('item-news', '东方新闻', '2026-03-25T18:30:00+08:00', '2026-03-25T19:00:00+08:00'),
    ]

    const decision = await facade.submitInstruction({
      scheduleState: createScheduleState({ itemCount: currentSchedule.length }),
      userInput: '把下午的东方剧场都换成轻量资讯',
      currentSchedule,
      history: [],
      agentCoreEnabled: true,
      layoutDraftEnabled: false,
    })

    expect(llmMocks.chat).toHaveBeenCalled()
    expect(decision.kind).toBe('pending_atomic_context')
    if (decision.kind !== 'pending_atomic_context') throw new Error('expected batch replace candidate selection')
    expect(decision.pendingAtomicContext.phase).toBe('recommending_insert')
    expect(decision.pendingAtomicContext.resumeCompositeTask).toMatchObject({
      kind: 'batch_replace',
      replacementHint: '轻量资讯',
      targetLabel: '东方剧场',
    })
    expect(decision.feedback.content).toContain('不能替你直接选')
    expect(decision.pendingAtomicContext.insertRecommendations).toHaveLength(1)

    const planned = await facade.submitInstruction({
      scheduleState: createScheduleState({ itemCount: currentSchedule.length }),
      userInput: '第一个',
      currentSchedule,
      history: ['把下午的东方剧场都换成轻量资讯'],
      pendingAtomicContext: decision.pendingAtomicContext,
      agentCoreEnabled: true,
      layoutDraftEnabled: false,
    })

    expect(planned.kind).toBe('pending_atomic_context')
    if (planned.kind !== 'pending_atomic_context') throw new Error('expected confirmed batch replace plan')
    expect(planned.pendingAtomicContext.compositeTaskRun?.stages[0]?.action).toBe('replace')
    expect(planned.pendingAtomicContext.compositeTaskRun?.stages[0]?.steps).toHaveLength(2)
    expect(planned.feedback.content).toContain('确认后我再写入播单')

    const confirmed = await facade.submitInstruction({
      scheduleState: createScheduleState({ itemCount: currentSchedule.length }),
      userInput: '确认',
      currentSchedule,
      history: ['把下午的东方剧场都换成轻量资讯', '第一个'],
      pendingAtomicContext: planned.pendingAtomicContext,
      agentCoreEnabled: true,
      layoutDraftEnabled: false,
    })

    expect(confirmed.kind).toBe('agent_execution')
    if (confirmed.kind !== 'agent_execution') throw new Error('expected batch replace execution')
    expect(confirmed.result.status).toBe('executed')
    expect(confirmed.feedback.content).toContain('已把 2 条节目替换为《生命树 第1集》')
    expect(confirmed.result.executionResult?.scheduleItems?.map((item) => item.programName)).toEqual([
      '生命树 第1集',
      '生命树 第1集',
      '东方新闻',
    ])
    expect(getAtomicCapabilities().getAllItems().map((item) => item.programName)).toEqual([
      '生命树 第1集',
      '生命树 第1集',
      '东方新闻',
    ])
  })

  it('blocks confirmed TV batch replace when the selected candidate would overlap later programmes', async () => {
    llmMocks.chat.mockResolvedValueOnce({
      content: JSON.stringify({
        intent: 'replace',
        confidence: 0.9,
        slots: {
          targetProgramName: '东方剧场',
          replacementHint: '长时段资讯',
        },
        assistantReplyDraft: '我先找到要替换的东方剧场，再让你确认候选。',
        taskPlanDraft: {
          isComposite: true,
          goal: '把下午东方剧场换成长时段资讯',
          stages: [{
            type: 'batch_atomic',
            action: 'replace',
            target: {
              programName: '东方剧场',
              replacementHint: '长时段资讯',
              scope: 'current_playlist',
            },
            requiresConfirmation: true,
            summary: '把当前播单里的东方剧场批量替换成长时段资讯',
          }, {
            type: 'verify',
            requiresConfirmation: false,
            summary: '检查替换后时间轴',
          }],
        },
      }),
    })
    const facade = createFacadeWithStructuredPendingPlanner()
    vi.spyOn((facade as any).candidateService, 'searchPrograms').mockResolvedValue([
      requireCanonicalCandidate('静安寺户外直播'),
    ])
    const currentSchedule = [
      createItem('item-drama-1', '东方剧场：纵有疾风起 第5集', '2026-03-25T13:00:00+08:00', '2026-03-25T13:45:00+08:00'),
      createItem('item-drama-2', '东方剧场：纵有疾风起 第6集', '2026-03-25T13:45:00+08:00', '2026-03-25T14:30:00+08:00'),
      createItem('item-news', '东方新闻', '2026-03-25T18:30:00+08:00', '2026-03-25T19:00:00+08:00'),
    ]

    const selection = await facade.submitInstruction({
      scheduleState: createScheduleState({ itemCount: currentSchedule.length }),
      userInput: '把下午的东方剧场都换成长时段资讯',
      currentSchedule,
      history: [],
      agentCoreEnabled: true,
      layoutDraftEnabled: false,
    })
    expect(selection.kind).toBe('pending_atomic_context')
    if (selection.kind !== 'pending_atomic_context') throw new Error('expected candidate selection')

    const planned = await facade.submitInstruction({
      scheduleState: createScheduleState({ itemCount: currentSchedule.length }),
      userInput: '第一个',
      currentSchedule,
      history: ['把下午的东方剧场都换成长时段资讯'],
      pendingAtomicContext: selection.pendingAtomicContext,
      agentCoreEnabled: true,
      layoutDraftEnabled: false,
    })
    expect(planned.kind).toBe('pending_atomic_context')
    if (planned.kind !== 'pending_atomic_context') throw new Error('expected pending batch replace plan')

    const blocked = await facade.submitInstruction({
      scheduleState: createScheduleState({ itemCount: currentSchedule.length }),
      userInput: '确认',
      currentSchedule,
      history: ['把下午的东方剧场都换成长时段资讯', '第一个'],
      pendingAtomicContext: planned.pendingAtomicContext,
      agentCoreEnabled: true,
      layoutDraftEnabled: false,
    })

    expect(blocked.kind).toBe('message')
    if (blocked.kind !== 'message') throw new Error('expected overlap block')
    expect(blocked.statusHint).toBe('failed')
    expect(blocked.feedback.content).toContain('时间重叠')
    expect(getAtomicCapabilities().getAllItems()).toEqual([])
  })

  it('compacts a rotation queue after confirmed batch replace', async () => {
    llmMocks.chat.mockResolvedValueOnce({
      content: JSON.stringify({
        intent: 'replace',
        confidence: 0.9,
        slots: {
          targetProgramName: '城市短片',
          replacementHint: '轻松导视',
        },
        assistantReplyDraft: '我先找出轮播单里的城市短片，再让你确认替换候选。',
        taskPlanDraft: {
          isComposite: true,
          goal: '把轮播单里的城市短片换成轻松导视',
          stages: [{
            type: 'batch_atomic',
            action: 'replace',
            target: {
              programName: '城市短片',
              replacementHint: '轻松导视',
              scope: 'current_playlist',
            },
            requiresConfirmation: true,
            summary: '把当前轮播单里的城市短片批量替换成轻松导视',
          }, {
            type: 'verify',
            requiresConfirmation: false,
            summary: '检查轮播单队列串联',
          }],
        },
      }),
    })
    const facade = createFacadeWithStructuredPendingPlanner()
    vi.spyOn((facade as any).candidateService, 'searchPrograms').mockResolvedValue([
      requireCanonicalCandidate('频道导视：黄金剧场预告 30秒'),
    ])
    const currentSchedule = [
      createItem('item-short-1', '城市短片 上海地标', '2026-03-25T00:00:00+08:00', '2026-03-25T00:30:00+08:00'),
      createItem('item-guide', '频道导视', '2026-03-25T00:30:00+08:00', '2026-03-25T01:00:00+08:00'),
      createItem('item-short-2', '城市短片 夜景', '2026-03-25T01:00:00+08:00', '2026-03-25T01:30:00+08:00'),
    ]

    const selection = await facade.submitInstruction({
      scheduleState: createScheduleState({ playlistType: 'rotation', itemCount: currentSchedule.length }),
      userInput: '把轮播单里的城市短片都换成轻松导视',
      currentSchedule,
      history: [],
      agentCoreEnabled: true,
      layoutDraftEnabled: false,
    })
    expect(selection.kind).toBe('pending_atomic_context')
    if (selection.kind !== 'pending_atomic_context') throw new Error('expected rotation candidate selection')

    const planned = await facade.submitInstruction({
      scheduleState: createScheduleState({ playlistType: 'rotation', itemCount: currentSchedule.length }),
      userInput: '第一个',
      currentSchedule,
      history: ['把轮播单里的城市短片都换成轻松导视'],
      pendingAtomicContext: selection.pendingAtomicContext,
      agentCoreEnabled: true,
      layoutDraftEnabled: false,
    })
    expect(planned.kind).toBe('pending_atomic_context')
    if (planned.kind !== 'pending_atomic_context') throw new Error('expected rotation pending batch replace plan')

    const confirmed = await facade.submitInstruction({
      scheduleState: createScheduleState({ playlistType: 'rotation', itemCount: currentSchedule.length }),
      userInput: '确认',
      currentSchedule,
      history: ['把轮播单里的城市短片都换成轻松导视', '第一个'],
      pendingAtomicContext: planned.pendingAtomicContext,
      agentCoreEnabled: true,
      layoutDraftEnabled: false,
    })

    expect(confirmed.kind).toBe('agent_execution')
    if (confirmed.kind !== 'agent_execution') throw new Error('expected rotation batch replace execution')
    expect(confirmed.result.status).toBe('executed')
    expect(confirmed.feedback.content).toContain('轮播单会按内容队列自然串联')
    const items = confirmed.result.executionResult?.scheduleItems ?? []
    expect(items.map((item) => item.programName)).toEqual([
      '频道导视：黄金剧场预告 30秒',
      '频道导视',
      '频道导视：黄金剧场预告 30秒',
    ])
    for (let index = 1; index < items.length; index += 1) {
      expect(new Date(items[index - 1]!.endTime).getTime()).toBe(new Date(items[index]!.startTime).getTime())
    }
  })
})
