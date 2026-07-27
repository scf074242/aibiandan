import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getAtomicCapabilities, resetAtomicCapabilities } from '@/services/atomicCapabilities'
import { DemoRuntimeFacade, type RuntimeScheduleItem } from '@/services/runtime/demoRuntimeFacade'
import type { LayoutDraft, ScheduleState } from '@/types/orchestration'

const createScheduleState = (patch: Partial<ScheduleState> = {}): ScheduleState => ({
  playlistId: 'playlist-tv-composite',
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

const createTvLayoutDraft = (): LayoutDraft => ({
  id: 'draft-tv-composite',
  channelId: 'dragon-tv',
  date: '2026-03-25',
  version: 1,
  source: 'generated',
  userIntent: '按东方卫视日常版面补齐空窗',
  coverage: { start: '06:00:00', end: '23:59:59' },
  layoutReference: {
    id: 'layout-tv-composite',
    name: '东方卫视日常版面',
    slots: [{
      id: 'slot-daytime',
      channelId: 'dragon-tv',
      startTime: '06:00:00',
      endTime: '23:59:59',
      columnId: 'col-daytime',
    }],
  },
  columns: [{
    columnId: 'col-daytime',
    columnName: '日间综合',
    channelId: 'dragon-tv',
    defaultProgramType: 'tv',
    semanticLabel: '日间综合节目',
    source: 'generated',
  }],
})

const createFacadeWithStructuredPendingPlanner = (): DemoRuntimeFacade => {
  const facade = new DemoRuntimeFacade()
  let activeSubmitInput: { pendingAtomicContext?: unknown } | undefined
  const planner = (facade as unknown as {
    agentPlanner: { plan: (input: { userInput: string; contextPackage?: unknown }, deadline?: unknown) => Promise<unknown> }
  }).agentPlanner
  const originalPlan = planner.plan.bind(planner)
  const llmClient = (facade as unknown as {
    llmClient: { chat: (messages: unknown[], options?: { traceLabel?: string }) => Promise<unknown> }
  }).llmClient
  const originalChat = llmClient.chat.bind(llmClient)

  vi.spyOn(llmClient, 'chat').mockImplementation(async (messages, options) => {
    if (options?.traceLabel !== 'agent.intent_interpreter') {
      return await originalChat(messages, options)
    }
    const userInput = activeSubmitInput && 'userInput' in activeSubmitInput
      ? String((activeSubmitInput as { userInput: string }).userInput)
      : ''
    if (userInput.includes('按草案补齐空窗')) {
      return {
        content: JSON.stringify({
          intent: 'batch_delete',
          confidence: 0.98,
          slots: { targetProgramName: '看东方' },
          taskPlanDraft: {
            isComposite: true,
            goal: '删除全部看东方，再按草案补齐空窗',
            stages: [{
              type: 'batch_atomic',
              action: 'delete',
              target: { programName: '看东方', scope: 'current_playlist' },
              requiresConfirmation: true,
              summary: '先删除全部看东方节目',
            }, {
              type: 'draft_refill',
              requiresLayoutDraft: true,
              layoutDraftReferenced: true,
              requiresConfirmation: true,
              summary: '下一步再按草案补齐空窗',
            }],
          },
          assistantFeedback: '我会先删除目标节目，下一步再按草案补齐空窗。',
        }),
      }
    }
    if (userInput.includes('已有节目就后移') || userInput.includes('其余节目可以后移')) {
      const programName = userInput.includes('东方新闻') ? '东方新闻' : '宣传片'
      return {
        content: JSON.stringify({
          intent: 'insert',
          confidence: 0.98,
          slots: { targetTime: '09:00:00', programHint: programName, durationSeconds: 1800 },
          taskPlanDraft: {
            isComposite: true,
            goal: `09:00:00 插入《${programName}》，已有节目顺延`,
            stages: [{
              type: 'batch_atomic',
              action: 'move',
              target: { targetTime: '09:00:00', scope: 'time_range' },
              requiresConfirmation: true,
              summary: '先把9点起受影响节目后移30分钟',
            }, {
              type: 'atomic',
              action: 'insert',
              target: { targetTime: '09:00:00', programName, durationSeconds: 1800 },
              requiresConfirmation: true,
              summary: `再在9点插入${programName}`,
            }, {
              type: 'verify',
              requiresConfirmation: false,
              summary: '检查顺延后的时间轴',
            }],
          },
          assistantFeedback: `我会先核对${programName}候选，再生成插入并顺延计划。`,
        }),
      }
    }
    return await originalChat(messages, options)
  })

  vi.spyOn(planner, 'plan').mockImplementation(async (input, deadline) => {
    const userInput = input.userInput.trim()
    const context = JSON.stringify(activeSubmitInput?.pendingAtomicContext ?? input.contextPackage ?? {})
    if (userInput === '确认' || userInput === '继续') {
      const pendingAction = (activeSubmitInput?.pendingAtomicContext as { action?: string } | undefined)?.action
      const intent = pendingAction === 'move'
        ? 'move'
        : pendingAction === 'insert' || context.includes('insert_with_shift')
          ? 'insert'
          : 'batch_delete'
      return {
        mode: 'single',
        pendingAction: 'confirm',
        actions: [{ type: 'atomic_command', intent, pendingAction: 'confirm', mutationPolicy: 'formal_write' }],
        assistantReplyDraft: '确认执行当前待处理任务。',
        reasoning: '用户确认当前结构化 pending。',
      }
    }
    if (userInput === '第二个') {
      return {
        mode: 'single',
        pendingAction: 'select_candidate',
        actions: [{ type: 'atomic_command', intent: 'insert', pendingAction: 'select_candidate', candidateId: 'candidate-promo-b', mutationPolicy: 'formal_write' }],
        assistantReplyDraft: '选择第二个候选。',
        reasoning: '用户选择当前候选列表中的第二项。',
      }
    }
    if (userInput.includes('按草案补齐空窗') || userInput.includes('已有节目就后移') || userInput.includes('其余节目可以后移')) {
      return {
        mode: 'single',
        actions: [{ type: 'atomic_command' }],
        assistantReplyDraft: '我先把这项复合修改拆成可校验步骤。',
        reasoning: '该请求需要由原子能力编译为复合任务计划。',
      }
    }
    return await originalPlan(input, deadline)
  })

  const originalSubmitInstruction = facade.submitInstruction.bind(facade)
  ;(facade as unknown as { submitInstruction: typeof facade.submitInstruction }).submitInstruction = async (input) => {
    activeSubmitInput = input
    const isPlannerTurn = ['确认', '继续', '第二个'].includes(input.userInput.trim())
      || input.userInput.includes('按草案补齐空窗')
      || input.userInput.includes('已有节目就后移')
      || input.userInput.includes('其余节目可以后移')
    return await originalSubmitInstruction({
      ...input,
      inputSource: isPlannerTurn ? 'user' : input.inputSource,
    })
  }

  return facade
}

describe('DemoRuntimeFacade composite scheduling tasks', () => {
  beforeEach(async () => {
    vi.restoreAllMocks()
    resetAtomicCapabilities()
    await getAtomicCapabilities().clearAll()
  })

  it('splits delete-all programme requests into a confirmed task plan and verifies no programme remains', async () => {
    const facade = createFacadeWithStructuredPendingPlanner()
    const currentSchedule = [
      createItem('item-east-1', '看东方', '2026-03-25T07:00:00+08:00', '2026-03-25T09:00:00+08:00'),
      createItem('item-news', '东方新闻', '2026-03-25T18:30:00+08:00', '2026-03-25T19:00:00+08:00'),
      createItem('item-east-2', '看东方 午间版', '2026-03-25T22:00:00+08:00', '2026-03-25T22:30:00+08:00'),
    ]

    const first = await facade.submitInstruction({
      scheduleState: createScheduleState({ itemCount: currentSchedule.length }),
      userInput: '把全部看东方节目删除掉',
      currentSchedule,
      history: [],
      agentCoreEnabled: true,
      layoutDraftEnabled: false,
    })

    expect(first.kind).toBe('pending_atomic_context')
    if (first.kind !== 'pending_atomic_context') throw new Error('expected pending composite task')
    expect(first.pendingAtomicContext.compositeTaskRun?.goal).toBe('删除全部《看东方》')
    expect(first.pendingAtomicContext.compositeTaskRun?.stages[0]?.steps).toHaveLength(2)
    expect(first.feedback.content).toContain('确认后我再写入播单')
    expect(getAtomicCapabilities().getAllItems()).toEqual([])

    const confirmed = await facade.submitInstruction({
      scheduleState: createScheduleState({ itemCount: currentSchedule.length }),
      userInput: '确认',
      currentSchedule,
      history: ['把全部看东方节目删除掉'],
      pendingAtomicContext: first.pendingAtomicContext,
      agentCoreEnabled: true,
      layoutDraftEnabled: false,
    })

    expect(confirmed.kind).toBe('agent_execution')
    if (confirmed.kind !== 'agent_execution') throw new Error('expected composite execution')
    expect(confirmed.result.status).toBe('executed')
    expect(confirmed.result.executionResult?.committed).toBe(true)
    expect(confirmed.feedback.content).toContain('已经没有这些目标节目')
    expect(confirmed.result.executionResult?.scheduleItems.map((item) => item.programName)).toEqual(['东方新闻'])
  })

  it('keeps a failed batch delete recoverable and retries the same batch on continue', async () => {
    const facade = createFacadeWithStructuredPendingPlanner()
    const currentSchedule = [
      createItem('item-east-1', '看东方', '2026-03-25T07:00:00+08:00', '2026-03-25T09:00:00+08:00'),
      createItem('item-news', '东方新闻', '2026-03-25T18:30:00+08:00', '2026-03-25T19:00:00+08:00'),
      createItem('item-east-2', '看东方 午间版', '2026-03-25T22:00:00+08:00', '2026-03-25T22:30:00+08:00'),
    ]

    const first = await facade.submitInstruction({
      scheduleState: createScheduleState({ itemCount: currentSchedule.length }),
      userInput: '把全部看东方节目删除掉',
      currentSchedule,
      history: [],
      agentCoreEnabled: true,
      layoutDraftEnabled: false,
    })

    expect(first.kind).toBe('pending_atomic_context')
    if (first.kind !== 'pending_atomic_context') throw new Error('expected pending composite task')

    const capabilities = getAtomicCapabilities()
    const replaceAllItemsSpy = vi.spyOn(capabilities, 'replaceAllItems').mockResolvedValueOnce({
      success: false,
      message: '模拟写回失败',
    } as any)

    const failed = await facade.submitInstruction({
      scheduleState: createScheduleState({ itemCount: currentSchedule.length }),
      userInput: '确认',
      currentSchedule,
      history: ['把全部看东方节目删除掉'],
      pendingAtomicContext: first.pendingAtomicContext,
      agentCoreEnabled: true,
      layoutDraftEnabled: false,
    })

    expect(failed.kind).toBe('agent_execution')
    if (failed.kind !== 'agent_execution') throw new Error('expected failed execution')
    expect(failed.result.status).toBe('failed')
    expect(failed.result.executionResult?.committed).toBe(false)
    expect((failed.result.executionResult?.scheduleItems ?? []).map((item) => item.programName)).toEqual([
      '看东方',
      '东方新闻',
      '看东方 午间版',
    ])
    expect(failed.pendingAtomicContext?.compositeTaskRun?.status).toBe('waiting_confirm')
    expect(failed.pendingAtomicContext?.compositeTaskRun?.loopCount).toBe(1)
    expect(failed.feedback.content).toContain('继续')
    expect((failed.feedback.details?.recovery as any)?.canRetry).toBe(true)

    replaceAllItemsSpy.mockRestore()

    const retried = await facade.submitInstruction({
      scheduleState: createScheduleState({ itemCount: currentSchedule.length }),
      userInput: '继续',
      currentSchedule,
      history: ['把全部看东方节目删除掉', '确认'],
      pendingAtomicContext: failed.pendingAtomicContext,
      agentCoreEnabled: true,
      layoutDraftEnabled: false,
    })

    expect(retried.kind).toBe('agent_execution')
    if (retried.kind !== 'agent_execution') throw new Error('expected retry execution')
    expect(retried.result.status).toBe('executed')
    expect(retried.pendingAtomicContext).toBeUndefined()
    expect(retried.result.executionResult?.scheduleItems.map((item) => item.programName)).toEqual(['东方新闻'])
  })

  it('compacts a rotation playlist queue after confirmed batch deletion', async () => {
    const facade = createFacadeWithStructuredPendingPlanner()
    const currentSchedule = [
      createItem('item-east-1', '看东方', '2026-03-25T00:00:00+08:00', '2026-03-25T00:30:00+08:00'),
      createItem('item-guide', '城市导视', '2026-03-25T00:30:00+08:00', '2026-03-25T01:00:00+08:00'),
      createItem('item-east-2', '看东方 午间版', '2026-03-25T01:00:00+08:00', '2026-03-25T01:30:00+08:00'),
    ]

    const first = await facade.submitInstruction({
      scheduleState: createScheduleState({
        playlistType: 'rotation',
        rotationStrategy: 'content_match',
        rotationDurationSeconds: 2 * 3600,
        itemCount: currentSchedule.length,
      }),
      userInput: '把全部看东方节目删除掉',
      currentSchedule,
      history: [],
      agentCoreEnabled: true,
      layoutDraftEnabled: false,
    })

    expect(first.kind).toBe('pending_atomic_context')
    if (first.kind !== 'pending_atomic_context') throw new Error('expected pending composite task')
    expect(first.pendingAtomicContext.compositeTaskRun?.playlistPolicy).toMatchObject({
      playlistType: 'rotation',
      deleteMode: 'compact_sequence',
      durationMode: 'target_total_duration',
    })
    expect(first.pendingAtomicContext.compositeTaskRun?.stages.map((stage) => stage.verification?.type)).toContain('rotation_duration_balance')

    const confirmed = await facade.submitInstruction({
      scheduleState: createScheduleState({
        playlistType: 'rotation',
        rotationStrategy: 'content_match',
        rotationDurationSeconds: 2 * 3600,
        itemCount: currentSchedule.length,
      }),
      userInput: '确认',
      currentSchedule,
      history: ['把全部看东方节目删除掉'],
      pendingAtomicContext: first.pendingAtomicContext,
      agentCoreEnabled: true,
      layoutDraftEnabled: false,
    })

    expect(confirmed.kind).toBe('agent_execution')
    if (confirmed.kind !== 'agent_execution') throw new Error('expected composite execution')
    expect(confirmed.feedback.content).toContain('队列会继续串联')
    expect(confirmed.feedback.content).toContain('目标总时长')
    const items = confirmed.result.executionResult?.scheduleItems ?? []
    expect(items).toHaveLength(1)
    expect(items[0]?.programName).toBe('城市导视')
    expect(items[0]?.startTime).toBe('2026-03-25T00:00:00+08:00')
    expect(items[0]?.endTime).toBe('2026-03-25T00:30:00+08:00')
  })

  it('keeps draft-refill as a separate stage after a delete stage so full scheduling rules stay separate', async () => {
    const facade = createFacadeWithStructuredPendingPlanner()
    const currentLayoutDraft = createTvLayoutDraft()
    const currentSchedule = [
      createItem('item-east-1', '看东方', '2026-03-25T07:00:00+08:00', '2026-03-25T09:00:00+08:00'),
      createItem('item-east-2', '看东方', '2026-03-25T10:00:00+08:00', '2026-03-25T11:00:00+08:00'),
    ]

    const first = await facade.submitInstruction({
      scheduleState: createScheduleState({ itemCount: currentSchedule.length, gapCount: 0 }),
      userInput: '把所有看东方删掉，然后按草案补齐空窗',
      currentSchedule,
      currentLayoutDraft,
      history: [],
      agentCoreEnabled: true,
      layoutDraftEnabled: true,
    })

    expect(first.kind).toBe('pending_atomic_context')
    if (first.kind !== 'pending_atomic_context') throw new Error('expected pending composite task')
    expect(first.pendingAtomicContext.compositeTaskRun?.stages.map((stage) => stage.type)).toEqual([
      'batch_atomic',
      'draft_refill',
      'verify',
    ])
    expect(first.feedback.content).toContain('下一步再按草案补齐')

    const confirmed = await facade.submitInstruction({
      scheduleState: createScheduleState({ itemCount: currentSchedule.length, gapCount: 0 }),
      userInput: '确认',
      currentSchedule,
      currentLayoutDraft,
      history: ['把所有看东方删掉，然后按草案补齐空窗'],
      pendingAtomicContext: first.pendingAtomicContext,
      agentCoreEnabled: true,
      layoutDraftEnabled: true,
    })

    expect(confirmed.kind).toBe('agent_execution')
    if (confirmed.kind !== 'agent_execution') throw new Error('expected composite execution')
    expect(confirmed.feedback.content).toContain('接下来可以按草案补齐')
    expect(confirmed.result.executionResult?.scheduleItems).toEqual([])
  })

  it('continues large batch deletes in chunks after each confirmed execution', async () => {
    const facade = createFacadeWithStructuredPendingPlanner()
    const currentSchedule = Array.from({ length: 12 }, (_, index) => {
      const hour = 6 + index
      return createItem(
        `item-east-${index + 1}`,
        index % 2 === 0 ? '看东方' : '看东方 午间版',
        `2026-03-25T${`${hour}`.padStart(2, '0')}:00:00+08:00`,
        `2026-03-25T${`${hour}`.padStart(2, '0')}:30:00+08:00`,
      )
    })

    const first = await facade.submitInstruction({
      scheduleState: createScheduleState({ itemCount: currentSchedule.length }),
      userInput: '把全部看东方节目删除掉',
      currentSchedule,
      history: [],
      agentCoreEnabled: true,
      layoutDraftEnabled: false,
    })

    expect(first.kind).toBe('pending_atomic_context')
    if (first.kind !== 'pending_atomic_context') throw new Error('expected pending composite task')
    expect(first.pendingAtomicContext.compositeTaskRun?.stages[0]?.steps).toHaveLength(10)
    expect(first.feedback.content).toContain('第 1 批')

    const firstConfirmed = await facade.submitInstruction({
      scheduleState: createScheduleState({ itemCount: currentSchedule.length }),
      userInput: '确认',
      currentSchedule,
      history: ['把全部看东方节目删除掉'],
      pendingAtomicContext: first.pendingAtomicContext,
      agentCoreEnabled: true,
      layoutDraftEnabled: false,
    })

    expect(firstConfirmed.kind).toBe('agent_execution')
    if (firstConfirmed.kind !== 'agent_execution') throw new Error('expected first batch execution')
    expect(firstConfirmed.result.status).toBe('executed')
    expect(firstConfirmed.pendingAtomicContext?.compositeTaskRun?.stages[0]?.steps).toHaveLength(2)
    expect(firstConfirmed.feedback.content).toContain('还剩 2 条')

    const remainingSchedule = firstConfirmed.result.executionResult?.scheduleItems as RuntimeScheduleItem[]
    const secondConfirmed = await facade.submitInstruction({
      scheduleState: createScheduleState({ itemCount: remainingSchedule.length }),
      userInput: '继续',
      currentSchedule: remainingSchedule,
      history: ['把全部看东方节目删除掉', '确认'],
      pendingAtomicContext: firstConfirmed.pendingAtomicContext,
      agentCoreEnabled: true,
      layoutDraftEnabled: false,
    })

    expect(secondConfirmed.kind).toBe('agent_execution')
    if (secondConfirmed.kind !== 'agent_execution') throw new Error('expected second batch execution')
    expect(secondConfirmed.pendingAtomicContext).toBeUndefined()
    expect(secondConfirmed.result.executionResult?.scheduleItems).toEqual([])
    expect(secondConfirmed.feedback.content).toContain('已经没有这些目标节目')
  })

  it('splits time-range delete requests into confirmed chunks and continues after user approval', async () => {
    const facade = createFacadeWithStructuredPendingPlanner()
    const currentSchedule = Array.from({ length: 12 }, (_, index) => {
      const hour = 4 + index
      return createItem(
        `item-range-${index + 1}`,
        `时段节目${index + 1}`,
        `2026-03-25T${`${hour}`.padStart(2, '0')}:00:00+08:00`,
        `2026-03-25T${`${hour + 1}`.padStart(2, '0')}:00:00+08:00`,
      )
    })

    const first = await facade.submitInstruction({
      scheduleState: createScheduleState({ itemCount: currentSchedule.length }),
      userInput: '删除4点到16点全部节目',
      currentSchedule,
      history: [],
      agentCoreEnabled: true,
      layoutDraftEnabled: false,
    })

    expect(first.kind).toBe('pending_atomic_context')
    if (first.kind !== 'pending_atomic_context') throw new Error('expected pending time-range composite task')
    expect(first.pendingAtomicContext.compositeTaskRun?.batch).toMatchObject({
      matchKind: 'time_range',
      targetLabel: '04:00:00-16:00:00',
      totalMatched: 12,
      remainingCount: 12,
      batchIndex: 1,
    })
    expect(first.pendingAtomicContext.compositeTaskRun?.stages[0]?.steps).toHaveLength(10)
    expect(first.feedback.content).toContain('第 1 批')

    const firstConfirmed = await facade.submitInstruction({
      scheduleState: createScheduleState({ itemCount: currentSchedule.length }),
      userInput: '确认',
      currentSchedule,
      history: ['删除4点到16点全部节目'],
      pendingAtomicContext: first.pendingAtomicContext,
      agentCoreEnabled: true,
      layoutDraftEnabled: false,
    })

    expect(firstConfirmed.kind).toBe('agent_execution')
    if (firstConfirmed.kind !== 'agent_execution') throw new Error('expected first time-range batch execution')
    expect(firstConfirmed.pendingAtomicContext?.compositeTaskRun?.batch).toMatchObject({
      matchKind: 'time_range',
      targetLabel: '04:00:00-16:00:00',
      remainingCount: 2,
      batchIndex: 2,
    })
    expect(firstConfirmed.feedback.content).toContain('还剩 2 条')

    const remainingSchedule = firstConfirmed.result.executionResult?.scheduleItems as RuntimeScheduleItem[]
    const secondConfirmed = await facade.submitInstruction({
      scheduleState: createScheduleState({ itemCount: remainingSchedule.length }),
      userInput: '继续',
      currentSchedule: remainingSchedule,
      history: ['删除4点到16点全部节目', '确认'],
      pendingAtomicContext: firstConfirmed.pendingAtomicContext,
      agentCoreEnabled: true,
      layoutDraftEnabled: false,
    })

    expect(secondConfirmed.kind).toBe('agent_execution')
    if (secondConfirmed.kind !== 'agent_execution') throw new Error('expected second time-range batch execution')
    expect(secondConfirmed.pendingAtomicContext).toBeUndefined()
    expect(secondConfirmed.result.executionResult?.scheduleItems).toEqual([])
    expect(secondConfirmed.feedback.content).toContain('已经没有这些目标节目')
  })

  it('stops a composite task when the loop limit is reached', async () => {
    const facade = createFacadeWithStructuredPendingPlanner()
    const currentSchedule = [
      createItem('item-east-1', '看东方', '2026-03-25T07:00:00+08:00', '2026-03-25T09:00:00+08:00'),
      createItem('item-east-2', '看东方 午间版', '2026-03-25T22:00:00+08:00', '2026-03-25T22:30:00+08:00'),
    ]

    const first = await facade.submitInstruction({
      scheduleState: createScheduleState({ itemCount: currentSchedule.length }),
      userInput: '把全部看东方节目删除掉',
      currentSchedule,
      history: [],
      agentCoreEnabled: true,
      layoutDraftEnabled: false,
    })

    expect(first.kind).toBe('pending_atomic_context')
    if (first.kind !== 'pending_atomic_context') throw new Error('expected pending composite task')
    const compositeTaskRun = first.pendingAtomicContext.compositeTaskRun
    if (!compositeTaskRun) throw new Error('expected composite task')
    const expiredPendingContext = {
      ...first.pendingAtomicContext,
      compositeTaskRun: {
        ...compositeTaskRun,
        loopCount: compositeTaskRun.limits.maxLoopTurns,
      },
    }

    const result = await facade.submitInstruction({
      scheduleState: createScheduleState({ itemCount: currentSchedule.length }),
      userInput: '继续',
      currentSchedule,
      history: ['把全部看东方节目删除掉'],
      pendingAtomicContext: expiredPendingContext,
      agentCoreEnabled: true,
      layoutDraftEnabled: false,
    })

    expect(result.kind).toBe('message')
    if (result.kind !== 'message') throw new Error('expected loop-limit message')
    expect(result.statusHint).toBe('failed')
    expect(result.feedback.content).toContain('我先停下')
    expect(getAtomicCapabilities().getAllItems()).toEqual([])
  })

  it('builds a confirmed insert-with-shift plan and verifies the final time axis', async () => {
    const facade = createFacadeWithStructuredPendingPlanner()
    vi.spyOn((facade as any).candidateService, 'searchPrograms').mockResolvedValue([{
      id: 'candidate-east-news',
      programId: 'candidate-east-news',
      programCode: 'candidate-east-news',
      programName: '东方新闻',
      instanceName: '东方新闻',
      channelId: 'dragon-tv',
      duration: 1800,
      programType: 'tv',
      columnName: '东方新闻',
      contentTags: ['新闻'],
    }])
    const currentSchedule = [
      createItem('item-0900', '看东方', '2026-03-25T09:00:00+08:00', '2026-03-25T09:30:00+08:00'),
      createItem('item-0930', '东方快报', '2026-03-25T09:30:00+08:00', '2026-03-25T10:00:00+08:00'),
    ]

    const first = await facade.submitInstruction({
      scheduleState: createScheduleState({ itemCount: currentSchedule.length }),
      userInput: '9点插入东方新闻，已有节目就后移',
      currentSchedule,
      history: [],
      agentCoreEnabled: true,
      layoutDraftEnabled: false,
    })

    expect(first.kind).toBe('pending_atomic_context')
    if (first.kind !== 'pending_atomic_context') throw new Error('expected pending insert-with-shift task')
    expect(first.pendingAtomicContext.compositeTaskRun?.stages.map((stage) => stage.action ?? stage.type)).toEqual([
      'move',
      'insert',
      'verify',
    ])
    expect(first.feedback.content).toContain('插入')

    const confirmed = await facade.submitInstruction({
      scheduleState: createScheduleState({ itemCount: currentSchedule.length }),
      userInput: '确认',
      currentSchedule,
      history: ['9点插入东方新闻，已有节目就后移'],
      pendingAtomicContext: first.pendingAtomicContext,
      agentCoreEnabled: true,
      layoutDraftEnabled: false,
    })

    expect(confirmed.kind).toBe('agent_execution')
    if (confirmed.kind !== 'agent_execution') throw new Error('expected insert-with-shift execution')
    expect(confirmed.result.status).toBe('executed')
    expect(confirmed.feedback.content).toContain('时间轴没有重叠')
    const items = confirmed.result.executionResult?.scheduleItems ?? []
    expect(items[0]?.programName).toContain('东方新闻')
    expect(items[0]?.startTime).toBe('2026-03-25T09:00:00+08:00')
    for (let index = 1; index < items.length; index += 1) {
      expect(new Date(items[index - 1]!.endTime).getTime()).toBeLessThanOrEqual(new Date(items[index]!.startTime).getTime())
    }
  })

  it('understands force-insert wording with affected programmes shifted back', async () => {
    const facade = createFacadeWithStructuredPendingPlanner()
    const searchPrograms = vi.spyOn((facade as any).candidateService, 'searchPrograms').mockResolvedValue([{
      id: 'candidate-promo-30m',
      programId: 'candidate-promo-30m',
      programCode: 'candidate-promo-30m',
      programName: '城市形象宣传片',
      instanceName: '城市形象宣传片',
      channelId: 'dragon-tv',
      duration: 1800,
      programType: 'tv',
      columnName: '宣传片',
      contentTags: ['宣传片'],
    }])
    const currentSchedule = [
      createItem('item-0900', '看东方', '2026-03-25T09:00:00+08:00', '2026-03-25T09:30:00+08:00'),
      createItem('item-0930', '东方快报', '2026-03-25T09:30:00+08:00', '2026-03-25T10:00:00+08:00'),
    ]

    const first = await facade.submitInstruction({
      scheduleState: createScheduleState({ itemCount: currentSchedule.length }),
      userInput: '9点强制插入一个30分钟宣传片，其余节目可以后移',
      currentSchedule,
      history: [],
      agentCoreEnabled: true,
      layoutDraftEnabled: false,
    })

    expect(searchPrograms).toHaveBeenCalledWith(expect.objectContaining({
      programName: '宣传片',
    }))
    expect(first.kind).toBe('pending_atomic_context')
    if (first.kind !== 'pending_atomic_context') throw new Error('expected pending insert-with-shift task')
    expect(first.pendingAtomicContext.compositeTaskRun?.goal).toContain('09:00:00 插入《城市形象宣传片》')
    expect(first.pendingAtomicContext.compositeTaskRun?.stages.map((stage) => stage.action ?? stage.type)).toEqual([
      'move',
      'insert',
      'verify',
    ])
    expect(first.feedback.content).toContain('顺延')
  })

  it('keeps insert-with-shift duration as a hard candidate constraint', async () => {
    const facade = createFacadeWithStructuredPendingPlanner()
    vi.spyOn((facade as any).candidateService, 'searchPrograms').mockResolvedValue([{
      id: 'candidate-promo-15m',
      programId: 'candidate-promo-15m',
      programCode: 'candidate-promo-15m',
      programName: '城市形象宣传片',
      instanceName: '城市形象宣传片',
      channelId: 'dragon-tv',
      duration: 900,
      programType: 'tv',
      columnName: '宣传片',
      contentTags: ['宣传片'],
    }])
    const currentSchedule = [
      createItem('item-0900', '看东方', '2026-03-25T09:00:00+08:00', '2026-03-25T09:30:00+08:00'),
    ]

    const result = await facade.submitInstruction({
      scheduleState: createScheduleState({ itemCount: currentSchedule.length }),
      userInput: '9点强制插入一个30分钟宣传片，其余节目可以后移',
      currentSchedule,
      history: [],
      agentCoreEnabled: true,
      layoutDraftEnabled: false,
    })

    expect(result.kind).toBe('message')
    if (result.kind !== 'message') throw new Error('expected duration mismatch block')
    expect(result.feedback.content).toContain('30分钟')
    expect(result.feedback.content).toContain('没有找到')
    expect(result.feedback.details?.rejectedReason ?? result.feedback.details?.expectedDurationSeconds).toBeTruthy()
    expect(getAtomicCapabilities().getAllItems()).toEqual([])
  })

  it('pauses insert-with-shift for candidate selection when several duration-matched candidates exist', async () => {
    const facade = createFacadeWithStructuredPendingPlanner()
    vi.spyOn((facade as any).candidateService, 'searchPrograms').mockResolvedValue([
      {
        id: 'candidate-promo-a',
        programId: 'candidate-promo-a',
        programCode: 'candidate-promo-a',
        programName: '城市形象宣传片A',
        instanceName: '城市形象宣传片A',
        channelId: 'dragon-tv',
        duration: 1800,
        programType: 'tv',
        columnName: '宣传片',
        contentTags: ['宣传片'],
      },
      {
        id: 'candidate-promo-b',
        programId: 'candidate-promo-b',
        programCode: 'candidate-promo-b',
        programName: '城市形象宣传片B',
        instanceName: '城市形象宣传片B',
        channelId: 'dragon-tv',
        duration: 1800,
        programType: 'tv',
        columnName: '宣传片',
        contentTags: ['宣传片'],
      },
    ])
    const currentSchedule = [
      createItem('item-0900', '看东方', '2026-03-25T09:00:00+08:00', '2026-03-25T09:30:00+08:00'),
    ]

    const selection = await facade.submitInstruction({
      scheduleState: createScheduleState({ itemCount: currentSchedule.length }),
      userInput: '9点强制插入一个30分钟宣传片，其余节目可以后移',
      currentSchedule,
      history: [],
      agentCoreEnabled: true,
      layoutDraftEnabled: false,
    })

    expect(selection.kind).toBe('pending_atomic_context')
    if (selection.kind !== 'pending_atomic_context') throw new Error('expected candidate selection pending')
    expect(selection.pendingAtomicContext.phase).toBe('recommending_insert')
    expect(selection.pendingAtomicContext.resumeCompositeTask).toEqual({ kind: 'insert_with_shift' })
    expect(selection.pendingAtomicContext.compositeTaskRun).toBeUndefined()
    expect(selection.pendingAtomicContext.insertRecommendations).toHaveLength(2)

    const planned = await facade.submitInstruction({
      scheduleState: createScheduleState({ itemCount: currentSchedule.length }),
      userInput: '第二个',
      currentSchedule,
      history: ['9点强制插入一个30分钟宣传片，其余节目可以后移'],
      pendingAtomicContext: selection.pendingAtomicContext,
      agentCoreEnabled: true,
      layoutDraftEnabled: false,
    })

    expect(planned.kind).toBe('pending_atomic_context')
    if (planned.kind !== 'pending_atomic_context') throw new Error('expected composite plan after candidate selection')
    expect(planned.pendingAtomicContext.compositeTaskRun?.goal).toContain('城市形象宣传片B')
    expect(planned.pendingAtomicContext.compositeTaskRun?.stages.map((stage) => stage.action ?? stage.type)).toEqual([
      'move',
      'insert',
      'verify',
    ])
  })
})
