import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { AgentServerRuntime } from '@/services/runtime/agentServerRuntime'
import { AgentServerFileSessionStore } from '@/services/runtime/agentServerFileSessionStore'
import { AgentServerSessionStore } from '@/services/runtime/agentServerSessionStore'
import { getAtomicCapabilities, resetAtomicCapabilities } from '@/services/atomicCapabilities'
import type {
  RuntimeDecision,
  RuntimeExecutePendingCommandInput,
  RuntimePendingTargetSelection,
  RuntimeResolveInsertRecommendationInput,
  RuntimeResolveTargetSelectionInput,
  RuntimeSubmitInput,
} from '@/services/runtime/schedulingAgentRuntimeFacade'
import type { RuntimePendingAtomicContext } from '@/services/runtime/pendingAtomicContext'
import type { ReactTaskRun } from '@/services/runtime/reactTaskTypes'
import type { SchedulingTaskRun } from '@/services/runtime/schedulingTaskPlan'
import type { ScheduleState } from '@/types/orchestration'

afterEach(() => {
  resetAtomicCapabilities()
  vi.useRealTimers()
})

const rotationScheduleState: ScheduleState = {
  playlistId: 'rotation-1',
  playlistType: 'rotation',
  channelId: 'rotation',
  channelName: '轮播单',
  date: '2026-03-25',
  isEmpty: true,
  itemCount: 0,
  gapCount: 1,
  hasSelectedTimeRange: false,
  rotationStrategy: 'content_match',
  rotationDurationSeconds: 3600,
}

const baseSubmitInput = (userInput = '新建一个 1 小时世界杯亚洲球队介绍轮播单'): RuntimeSubmitInput => ({
  scheduleState: rotationScheduleState,
  userInput,
  currentSchedule: [],
  history: [],
  layoutDraftEnabled: true,
})

const messageDecision = (content = '我先整理上下文。'): RuntimeDecision => ({
  kind: 'message',
  feedback: {
    content,
    processType: 'planning',
    processTypeLabel: 'AI编审助手',
  },
})

const pendingValidateDecision = (): Extract<RuntimeDecision, { kind: 'pending_command' }> => ({
  kind: 'pending_command',
  feedback: {
    content: '请确认执行播单校验。',
    processType: 'selection',
    processTypeLabel: '待确认修改',
  },
  pendingCommand: {
    command: { action: 'validate' } as never,
    summary: '执行播单校验',
    reasoning: '用户确认后执行。',
  },
})

const pendingDeleteDecision = (): Extract<RuntimeDecision, { kind: 'pending_command' }> => ({
  kind: 'pending_command',
  feedback: {
    content: '删除节目需要确认。',
    processType: 'selection',
    processTypeLabel: '待确认修改',
  },
  pendingCommand: {
    command: { action: 'delete', data: { itemId: 'item-1' }, reasoning: '用户确认删除。' } as never,
    summary: '删除看东方',
    reasoning: '用户确认删除。',
    successMessage: '已删除。',
  },
})

const reactTaskRun: ReactTaskRun = {
  id: 'react-task-1',
  objective: '先核验世界杯亚洲球队素材',
  originalUserInput: '新建一个 1 小时世界杯亚洲球队介绍轮播单',
  status: 'observing',
  loopCount: 1,
  limits: {
    maxTurns: 4,
    batchSize: 5,
  },
  stopCondition: '素材方向明确后更新草案',
  steps: [],
  observations: [
    {
      id: 'obs-1',
      turn: 1,
      type: 'asset_search',
      summary: '已找到亚洲球队介绍方向。',
      createdAt: '2026-03-25T00:00:00.000Z',
    },
  ],
  recovery: {
    canRetry: true,
    retryCount: 0,
  },
  createdAt: '2026-03-25T00:00:00.000Z',
  updatedAt: '2026-03-25T00:00:00.000Z',
}

const batchDeleteTaskRun: SchedulingTaskRun = {
  id: 'task-batch-delete-1',
  goal: '删除全部看东方',
  originalUserInput: '把全部看东方节目删除掉',
  status: 'waiting_confirm',
  currentStageIndex: 0,
  loopCount: 1,
  limits: {
    maxStages: 5,
    maxStepsPerStage: 10,
    maxLoopTurns: 5,
    maxAutoExecutePerLoop: 5,
    maxMatchedItemsBeforeNarrowing: 30,
  },
  stages: [{
    id: 'stage-delete-2',
    type: 'batch_atomic',
    status: 'waiting_confirm',
    summary: '继续删除下一批看东方',
    action: 'delete',
    requiresConfirmation: true,
    steps: [],
  }],
  batch: {
    strategy: 'chunked',
    matchKind: 'program',
    targetLabel: '看东方',
    totalMatched: 37,
    processedCount: 10,
    remainingCount: 27,
    batchSize: 10,
    batchIndex: 2,
  },
  createdAt: '2026-03-25T00:00:00.000Z',
  updatedAt: '2026-03-25T00:00:00.000Z',
}

const batchDeletePendingContext = (taskRun: SchedulingTaskRun = batchDeleteTaskRun): RuntimePendingAtomicContext => ({
  action: 'delete',
  phase: 'clarifying',
  summary: '继续批量删除看东方',
  reasoning: '上一批已经完成，等待用户确认是否继续下一批。',
  originalUserInput: '把全部看东方节目删除掉',
  collectedUserInput: '继续',
  slots: {
    programName: '看东方',
  },
  missingFields: ['selection'],
  followUpQuestion: '要继续处理剩余节目吗？',
  compositeTaskRun: taskRun,
  attemptCount: 0,
  createdAt: '2026-03-25T00:00:00.000Z',
  updatedAt: '2026-03-25T00:00:00.000Z',
})

const createRuntime = (
  submitInstruction: (input: RuntimeSubmitInput) => Promise<RuntimeDecision>,
  executePendingCommand = vi.fn(async (_input: RuntimeExecutePendingCommandInput) => ({
    success: true,
    command: { action: 'validate' } as never,
    message: '已执行。',
    summary: '执行播单校验',
  })),
) => new AgentServerRuntime({
  sessions: new AgentServerSessionStore(),
  runtime: {
    submitInstruction,
    executePendingCommand,
    resolvePendingTargetSelection: vi.fn(async (_input: RuntimeResolveTargetSelectionInput) => messageDecision('已选择目标。')),
    resolvePendingInsertRecommendation: vi.fn(async (_input: RuntimeResolveInsertRecommendationInput) => messageDecision('已选择候选。')),
  },
})

describe('AgentServerRuntime migration boundary', () => {
  it('agent-server-pending-workspace-mismatch: rejects a pending context from another playlist', async () => {
    const testCase = {
      id: 'agent-server-pending-workspace-mismatch',
      userInput: '继续刚才的插入',
      expectedDecision: 'pending.workspaceKey 与当前播单不一致时拒绝续接',
      mustNotHappen: '覆盖 pending workspaceKey、调用运行时或复用其他播单的候选/槽位',
      verification: '返回 failed message 且 serverPending=missing、noMutation=true',
    }
    const submit = vi.fn(async () => messageDecision('不应进入运行时。'))
    const runtime = createRuntime(submit)
    const result = await runtime.submitInstruction({
      ...baseSubmitInput(testCase.userInput),
      pendingAtomicContext: {
        ...batchDeletePendingContext(),
        pendingId: 'pending-other-workspace',
        workspaceKey: 'tv:other-playlist',
        owner: 'formal_playlist',
        mutationId: 'mutation-other-workspace',
        mutationPolicy: 'pending_only',
      },
    })

    expect(testCase).toMatchObject({ expectedDecision: expect.any(String), mustNotHappen: expect.any(String), verification: expect.any(String) })
    expect(submit).not.toHaveBeenCalled()
    expect(result.decision).toMatchObject({
      kind: 'message',
      statusHint: 'failed',
      feedback: { details: { serverPending: 'missing', noMutation: true } },
    })
  })

  it('agent-server-waiting-progress-after-five-seconds: emits waiting progress while a real model is still analyzing', async () => {
    const testCase = {
      id: 'agent-server-waiting-progress-after-five-seconds',
      userInput: '在9点插入节目看东方',
      expectedDecision: '模型调用超过5秒时通过 session progress 发出仍在分析提示，最终决策完成后停止计时器',
      mustNotHappen: '用户在完整 timeout 期间只能看到无阶段信息的静态等待状态',
      verification: 'envelope.progressEvents 含 llm_waiting 且 noMutation=true',
    }
    vi.useFakeTimers()
    let resolveDecision!: (decision: RuntimeDecision) => void
    const runtime = createRuntime(() => new Promise<RuntimeDecision>((resolve) => {
      resolveDecision = resolve
    }))

    const pendingResult = runtime.submitInstruction(baseSubmitInput(testCase.userInput))
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(5_000)
    resolveDecision(messageDecision('已理解并完成本轮判断。'))
    const result = await pendingResult

    expect(testCase).toMatchObject({
      expectedDecision: expect.any(String),
      mustNotHappen: expect.any(String),
      verification: expect.any(String),
    })
    expect(result.progressEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        processTypeLabel: '理解需求',
        details: expect.objectContaining({
          progressStage: 'llm_waiting',
          noMutation: true,
        }),
      }),
    ]))
  })

  it('agent-server-stop-active-instruction-is-session-isolated: stops only the matching session and workspace', async () => {
    const testCase = {
      id: 'agent-server-stop-active-instruction-is-session-isolated',
      userInput: '停止当前仍在分析的插入请求',
      expectedDecision: '停止信号只中断匹配 sessionId 与 workspaceKey 的活动请求，其他会话继续运行',
      mustNotHappen: '停止一个会话时中断另一个会话，或只关闭前台请求而服务端 LLM 继续执行',
      verification: 'session A 的 deadline signal 被 abort，session B 保持未中止并可正常完成',
    }
    vi.useFakeTimers()
    const resolvers = new Map<string, (decision: RuntimeDecision) => void>()
    const observedSignals = new Map<string, AbortSignal>()
    const runtime = createRuntime((input) => new Promise<RuntimeDecision>((resolve) => {
      const playlistId = input.scheduleState.playlistId ?? 'unknown'
      resolvers.set(playlistId, resolve)
      observedSignals.set(playlistId, input.deadline!.signal())
      input.deadline!.signal().addEventListener('abort', () => {
        resolve(messageDecision(`请求 ${playlistId} 已停止。`))
      }, { once: true })
    }))
    const sessionA = runtime.createSession()
    const sessionB = runtime.createSession()
    const pendingA = runtime.submitInstruction(baseSubmitInput(testCase.userInput), sessionA.id)
    const pendingB = runtime.submitInstruction({
      ...baseSubmitInput('继续分析另一个播单'),
      scheduleState: { ...rotationScheduleState, playlistId: 'rotation-2' },
    }, sessionB.id)
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(5_001)

    const workspaceA = runtime.getSession(sessionA.id)?.formalPlaylistWorkspaceKey
    const workspaceB = runtime.getSession(sessionB.id)?.formalPlaylistWorkspaceKey
    expect(workspaceA).toBeTruthy()
    expect(workspaceB).toBeTruthy()

    const stopped = runtime.stopActiveInstruction(sessionA.id, workspaceA!)
    expect(stopped).toMatchObject({ stopped: true, reason: 'stopped' })
    expect(observedSignals.get('rotation-1')?.aborted).toBe(true)
    expect(observedSignals.get('rotation-2')?.aborted).toBe(false)

    resolvers.get('rotation-2')?.(messageDecision('另一个会话正常完成。'))
    await expect(pendingA).resolves.toMatchObject({ sessionId: sessionA.id })
    await expect(pendingB).resolves.toMatchObject({ sessionId: sessionB.id })
    expect(testCase).toMatchObject({
      expectedDecision: expect.any(String),
      mustNotHappen: expect.any(String),
      verification: expect.any(String),
    })
  })

  it('agent-server-stop-active-instruction-rejects-workspace-mismatch: refuses cross-workspace stop', async () => {
    const testCase = {
      id: 'agent-server-stop-active-instruction-rejects-workspace-mismatch',
      userInput: '停止当前请求',
      expectedDecision: 'workspaceKey 不匹配时拒绝停止并保留当前请求',
      mustNotHappen: '旧播单页面使用残留 sessionId 中断新播单请求',
      verification: '返回 workspace_mismatch 且 deadline signal 仍未中止',
    }
    let resolveDecision!: (decision: RuntimeDecision) => void
    let observedSignal!: AbortSignal
    const runtime = createRuntime((input) => new Promise<RuntimeDecision>((resolve) => {
      resolveDecision = resolve
      observedSignal = input.deadline!.signal()
    }))
    const session = runtime.createSession()
    const pending = runtime.submitInstruction(baseSubmitInput(testCase.userInput), session.id)
    await vi.waitFor(() => expect(observedSignal).toBeDefined())

    const result = runtime.stopActiveInstruction(session.id, 'workspace-from-another-playlist')
    expect(result).toMatchObject({ stopped: false, reason: 'workspace_mismatch' })
    expect(observedSignal.aborted).toBe(false)
    resolveDecision(messageDecision('当前请求继续并正常完成。'))
    await pending
    expect(testCase).toMatchObject({
      expectedDecision: expect.any(String),
      mustNotHappen: expect.any(String),
      verification: expect.any(String),
    })
  })

  it('rebuilds the foreground context package on the server before calling the runtime', async () => {
    let capturedInput: RuntimeSubmitInput | null = null
    const runtime = createRuntime(async (input) => {
      capturedInput = input
      return messageDecision()
    })

    const result = await runtime.submitInstruction(baseSubmitInput())

    expect(result.sessionId).toMatch(/^agent_session_/)
    expect(result.contextPackage).toMatchObject({
      latestUserInput: '新建一个 1 小时世界杯亚洲球队介绍轮播单',
      workspace: {
        playlistType: 'rotation',
        rotationDurationSeconds: 3600,
      },
      layoutDraft: {
        available: false,
      },
    })
    expect(capturedInput?.foregroundContextPackage).toEqual(result.contextPackage)
    expect(capturedInput?.agentCoreEnabled).toBe(true)
    expect(result.session.formalPlaylistItemCount).toBe(0)
    expect(result.session.formalPlaylistVersion).toMatch(/^formal_/)
  })

  it('persists ReAct task state in the server session and injects it into the next turn', async () => {
    const capturedInputs: RuntimeSubmitInput[] = []
    const runtime = createRuntime(async (input) => {
      capturedInputs.push(input)
      return capturedInputs.length === 1
        ? {
            kind: 'message',
            feedback: {
              content: '我先查素材。',
              processType: 'planning',
              processTypeLabel: 'ReAct',
              details: {
                reactTaskRun,
              },
            },
          }
        : messageDecision('继续处理。')
    })

    const first = await runtime.submitInstruction(baseSubmitInput())
    const staleTaskRun: ReactTaskRun = {
      ...reactTaskRun,
      id: 'stale-foreground-task',
      objective: '前台旧任务',
    }
    const second = await runtime.submitInstruction({
      ...baseSubmitInput('继续'),
      activeReactTaskRun: staleTaskRun,
    }, first.sessionId)

    expect(first.session.activeReactTaskRun?.id).toBe('react-task-1')
    expect(second.contextPackage?.reactTask.active).toBe(true)
    expect(capturedInputs[1].activeReactTaskRun?.id).toBe('react-task-1')
    expect(runtime.getSessionEvents(first.sessionId).some((event) => event.type === 'react_task')).toBe(true)
  })

  it('reuses server pending context for natural follow-up in the same workspace', async () => {
    const pendingInsertContext: RuntimePendingAtomicContext = {
      action: 'insert',
      phase: 'recommending_insert',
      summary: '待确认插入节目',
      reasoning: '候选较多，需要用户选择。',
      originalUserInput: '在9点插入节目看东方',
      collectedUserInput: '在9点插入节目看东方',
      slots: {
        targetTime: '09:00:00',
        programName: '看东方',
      },
      missingFields: ['selection'],
      followUpQuestion: '请选择要插入的候选。',
      targetCandidates: [],
      agentPendingTask: {
        id: 'pending-agent-insert-1',
        intent: 'insert',
        phase: 'needs_selection',
        originalInput: '在9点插入节目看东方',
        collectedInput: '在9点插入节目看东方',
        collectedSlots: {
          targetTime: { value: '09:00:00', source: 'user' },
          programHint: { value: '看东方', source: 'user' },
        },
        missingSlots: ['candidateId'],
        allowedActions: ['continue_pending', 'select_candidate', 'confirm', 'cancel_pending', 'reject'],
        attemptCount: 0,
        maxAttempts: 3,
        updatedAt: '2026-03-25T00:00:00.000Z',
        createdAt: '2026-03-25T00:00:00.000Z',
      },
      attemptCount: 0,
      createdAt: '2026-03-25T00:00:00.000Z',
      updatedAt: '2026-03-25T00:00:00.000Z',
    }
    const capturedInputs: RuntimeSubmitInput[] = []
    const runtime = createRuntime(async (input) => {
      capturedInputs.push(input)
      return capturedInputs.length === 1
        ? {
            kind: 'pending_atomic_context',
            feedback: {
              content: '我找到了多个可插入候选，需要你确认。',
              processType: 'selection',
              processTypeLabel: '待确认',
            },
            pendingAtomicContext: pendingInsertContext,
          }
        : messageDecision('继续处理。')
    })

    const first = await runtime.submitInstruction(baseSubmitInput('在9点插入节目看东方'))
    await runtime.submitInstruction({
      ...baseSubmitInput('就你推荐的那个'),
      pendingAtomicContext: undefined,
    }, first.sessionId)

    expect(capturedInputs[1].pendingAtomicContext).toMatchObject({
      action: 'insert',
      slots: {
        targetTime: '09:00:00',
        programName: '看东方',
      },
    })
    expect(capturedInputs[1].foregroundContextPackage?.scenario).toBe('atomic')
  })

  it('can stop a server-owned ReAct task without requiring a foreground rollback', async () => {
    const runtime = createRuntime(async () => ({
      kind: 'message',
      feedback: {
        content: '我先查素材。',
        processType: 'planning',
        processTypeLabel: 'ReAct',
        details: {
          reactTaskRun,
        },
      },
    }))

    const first = await runtime.submitInstruction(baseSubmitInput())
    const stopped = runtime.stopReactTask(first.sessionId)

    expect(stopped?.activeReactTaskRun?.status).toBe('cancelled')
  })

  it('keeps a simple server checkpoint for the next batch and can continue from server pending context', async () => {
    const capturedInputs: RuntimeSubmitInput[] = []
    const runtime = createRuntime(async (input) => {
      capturedInputs.push(input)
      return capturedInputs.length === 1
        ? {
            kind: 'agent_execution',
            feedback: {
              content: '已先删除 10 条看东方，还剩 27 条。你说继续，我再处理下一批。',
              processType: 'execution',
              processTypeLabel: '执行完成',
              details: {
                taskRun: {
                  ...batchDeleteTaskRun,
                  status: 'completed',
                  batch: {
                    ...batchDeleteTaskRun.batch!,
                    processedCount: 10,
                    remainingCount: 27,
                    batchIndex: 1,
                  },
                },
                nextTaskRun: batchDeleteTaskRun,
              },
            },
            result: {
              status: 'executed',
              input: {
                userInput: input.userInput,
                channelId: input.scheduleState.channelId,
                date: input.scheduleState.date,
              },
              decision: {
                intent: 'batch_delete',
              },
              executionResult: {
                committed: true,
                operationId: 'task-batch-delete-1',
                affectedItemIds: [],
              },
              trace: [],
            },
            pendingAtomicContext: batchDeletePendingContext(),
          }
        : messageDecision('继续下一批。')
    })

    const first = await runtime.submitInstruction(baseSubmitInput('把全部看东方节目删除掉'))
    const second = await runtime.submitInstruction(baseSubmitInput('继续'), first.sessionId)

    expect(first.session.activeExecutionCheckpoint).toMatchObject({
      kind: 'composite_task',
      status: 'waiting_continue',
      completedCount: 10,
      remainingCount: 27,
    })
    expect(capturedInputs[1].pendingAtomicContext?.compositeTaskRun?.id).toBe('task-batch-delete-1')
    expect(second.decision?.kind).toBe('message')
    expect(runtime.getSessionEvents(first.sessionId).some((event) => event.type === 'execution_checkpoint')).toBe(true)
  })

  it('can stop a server checkpoint without rolling back completed playlist work', async () => {
    const runtime = createRuntime(async () => ({
      kind: 'agent_execution',
      feedback: {
        content: '已先删除 10 条看东方，还剩 27 条。你说继续，我再处理下一批。',
        processType: 'execution',
        processTypeLabel: '执行完成',
        details: {
          nextTaskRun: batchDeleteTaskRun,
        },
      },
      result: {
        status: 'executed',
        input: {
          userInput: '把全部看东方节目删除掉',
          channelId: 'rotation',
          date: '2026-03-25',
        },
        decision: {
          intent: 'batch_delete',
        },
        executionResult: {
          committed: true,
          operationId: 'task-batch-delete-1',
          affectedItemIds: [],
        },
        trace: [],
      },
      pendingAtomicContext: batchDeletePendingContext(),
    }))

    const first = await runtime.submitInstruction(baseSubmitInput('把全部看东方节目删除掉'))
    const stopped = runtime.stopExecutionCheckpoint(first.sessionId)

    expect(stopped?.activeExecutionCheckpoint).toMatchObject({
      status: 'stopped',
      remainingCount: 27,
    })
    expect(stopped?.hasPendingAtomicContext).toBe(false)
    expect(runtime.getSessionEvents(first.sessionId).some((event) => (
      event.type === 'execution_checkpoint'
      && event.summary.includes('已停止后续处理')
    ))).toBe(true)
  })

  it('executes pending formal writes through the server write boundary', async () => {
    const executePendingCommand = vi.fn(async (_input: RuntimeExecutePendingCommandInput) => ({
      success: true,
      command: { action: 'validate' } as never,
      message: '已执行。',
      summary: '执行播单校验',
    }))
    const runtime = createRuntime(async () => pendingValidateDecision(), executePendingCommand)
    const submitted = await runtime.submitInstruction(baseSubmitInput('执行播单校验'))
    const pendingId = submitted.decision?.kind === 'pending_command'
      ? submitted.decision.pendingCommand.pendingId
      : undefined

    const result = await runtime.executePendingCommand({
      pendingId,
      scheduleDate: '2026-03-25',
      channelId: 'rotation',
      workspaceKey: submitted.session.formalPlaylistWorkspaceKey ?? undefined,
      idempotencyKey: 'pending-confirm-1',
    }, submitted.sessionId)

    expect(executePendingCommand).toHaveBeenCalledTimes(1)
    expect(result.result?.details?.formalWrite).toMatchObject({
      boundary: 'formal-playlist-write-adapter',
      transport: 'agent-server',
      status: 'applied',
      reused: false,
      idempotencyKey: 'pending-confirm-1',
    })
    expect(runtime.getSessionEvents(result.sessionId).some((event) => (
      event.type === 'execution'
      && (event.data?.formalWrite as { boundary?: string } | undefined)?.boundary === 'formal-playlist-write-adapter'
    ))).toBe(true)
  })

  it('can execute a server-owned pending command when the foreground only sends pending id', async () => {
    const executePendingCommand = vi.fn(async (input: RuntimeExecutePendingCommandInput) => {
      expect(input.pendingCommand.summary).toBe('删除看东方')
      expect(input.currentSchedule).toBeUndefined()
      expect(getAtomicCapabilities().getItem('item-1')?.programName).toBe('看东方')
      return {
        success: true,
        command: input.pendingCommand.command,
        message: '已删除。',
        summary: input.pendingCommand.summary,
        data: {
          deletedItem: {
            id: 'item-1',
            programName: '看东方',
            startTime: '2026-03-25T09:00:00',
            endTime: '2026-03-25T09:30:00',
            duration: 1800,
            programType: 'news',
          },
        },
      }
    })
    const runtime = createRuntime(async () => ({
      kind: 'pending_command',
      feedback: {
        content: '这会删除《看东方》，请确认。',
        processType: 'selection',
        processTypeLabel: '待确认修改',
      },
      pendingCommand: {
        command: { action: 'delete', data: { itemId: 'item-1' }, reasoning: '用户确认删除。' } as never,
        summary: '删除看东方',
        reasoning: '用户确认删除。',
      },
    }), executePendingCommand)

    const first = await runtime.submitInstruction({
      ...baseSubmitInput('删除看东方'),
      currentSchedule: [{
        id: 'item-1',
        programName: '看东方',
        programCode: 'news-1',
        startTime: '2026-03-25T09:00:00',
        endTime: '2026-03-25T09:30:00',
        duration: 1800,
        programType: 'news',
      }],
    })
    const pendingId = first.decision?.kind === 'pending_command'
      ? first.decision.pendingCommand.pendingId
      : ''

    const result = await runtime.executePendingCommand({
      pendingId,
      scheduleDate: '2026-03-25',
      channelId: 'rotation',
      workspaceKey: first.session.formalPlaylistWorkspaceKey ?? undefined,
      expectedPlaylistVersion: first.session.formalPlaylistVersion,
    }, first.sessionId)

    expect(pendingId).toMatch(/^server_pending_command_/)
    expect(executePendingCommand).toHaveBeenCalledTimes(1)
    expect(result.result?.success).toBe(true)
    expect(result.session.formalPlaylistItemCount).toBe(0)
    expect(result.result?.details?.formalWrite).toMatchObject({
      boundary: 'formal-playlist-write-adapter',
      transport: 'agent-server',
      status: 'applied',
      workspaceKey: first.session.formalPlaylistWorkspaceKey,
    })
  })

  it('rehydrates server-owned target selection pending from the session', async () => {
    let capturedSelection: RuntimePendingTargetSelection | null = null
    const pendingAtomicContext: RuntimePendingAtomicContext = {
      action: 'delete',
      phase: 'selecting_target',
      summary: '请选择要删除的节目',
      reasoning: '用户要求删除节目，但当前有多个匹配。',
      originalUserInput: '删除看东方',
      collectedUserInput: '删除看东方',
      slots: {
        targetTime: '09:00:00',
        programName: '看东方',
      },
      missingFields: ['selection'],
      followUpQuestion: '请选择要删除的节目。',
      targetCandidates: [
        {
          id: 'item-1',
          programName: '看东方',
          startTime: '09:00:00',
          endTime: '09:30:00',
          duration: 1800,
          programType: 'news',
        },
      ],
      selectedItemId: null,
      attemptCount: 0,
      createdAt: '2026-03-25T00:00:00.000Z',
      updatedAt: '2026-03-25T00:00:00.000Z',
    }
    const runtime = new AgentServerRuntime({
      sessions: new AgentServerSessionStore(),
      runtime: {
        submitInstruction: vi.fn(async () => ({
          kind: 'pending_atomic_context',
          feedback: {
            content: '请选择要删除的节目。',
            processType: 'selection',
            processTypeLabel: '需选择',
          },
          pendingAtomicContext,
        })),
        executePendingCommand: vi.fn(),
        resolvePendingTargetSelection: vi.fn(async (input: RuntimeResolveTargetSelectionInput) => {
          capturedSelection = input.pendingTargetSelection
          return messageDecision('已按选择生成待确认。')
        }),
        resolvePendingInsertRecommendation: vi.fn(async () => messageDecision('已选择候选。')),
      },
    })

    const first = await runtime.submitInstruction(baseSubmitInput('删除看东方'))
    const pendingId = first.decision?.kind === 'pending_atomic_context'
      ? first.decision.pendingAtomicContext.pendingId
      : ''
    const second = await runtime.resolvePendingTargetSelection({
      pendingId,
      selectedItemId: 'item-1',
      channelId: 'rotation',
      date: '2026-03-25',
    }, first.sessionId)

    expect(pendingId).toMatch(/^server_pending_selecting_target_/)
    expect(capturedSelection).toMatchObject({
      pendingId,
      selectedItemId: 'item-1',
      candidates: [{ id: 'item-1' }],
    })
    expect(second.decision?.kind).toBe('message')
  })

  it('does not execute the same idempotent pending write twice in one server session', async () => {
    const executePendingCommand = vi.fn(async (_input: RuntimeExecutePendingCommandInput) => ({
      success: true,
      command: { action: 'validate' } as never,
      message: '已执行。',
      summary: '执行播单校验',
    }))
    const runtime = createRuntime(async () => pendingValidateDecision(), executePendingCommand)
    const submitted = await runtime.submitInstruction(baseSubmitInput('执行播单校验'))
    const pendingId = submitted.decision?.kind === 'pending_command'
      ? submitted.decision.pendingCommand.pendingId
      : undefined
    const input: RuntimeExecutePendingCommandInput = {
      pendingCommand: submitted.decision?.kind === 'pending_command'
        ? submitted.decision.pendingCommand
        : pendingValidateDecision().pendingCommand,
      pendingId,
      scheduleDate: '2026-03-25',
      channelId: 'rotation',
      workspaceKey: submitted.session.formalPlaylistWorkspaceKey ?? undefined,
      idempotencyKey: 'pending-confirm-1',
    }

    const first = await runtime.executePendingCommand(input, submitted.sessionId)
    const second = await runtime.executePendingCommand(input, first.sessionId)

    expect(executePendingCommand).toHaveBeenCalledTimes(1)
    expect(second.result?.details?.formalWrite).toMatchObject({
      status: 'reused',
      reused: true,
    })
  })

  it('agent-server-formal-write-rejects-missing-or-cross-workspace', async () => {
    const testCase = {
      id: 'agent-server-formal-write-rejects-missing-or-cross-workspace',
      userInput: '确认执行当前待处理操作',
      expectedDecision: '服务端在解析 pending 与 mutation 前校验请求 workspace 和 session workspace 一致',
      mustNotHappen: '缺失 workspace 或切换播单后仍复用旧 pending 写入',
      verification: '缺失与跨工作区均阻断，delegate 不执行',
    }
    const executePendingCommand = vi.fn()
    const runtime = createRuntime(async () => pendingValidateDecision(), executePendingCommand)
    const submitted = await runtime.submitInstruction(baseSubmitInput(testCase.userInput))
    const pendingId = submitted.decision?.kind === 'pending_command'
      ? submitted.decision.pendingCommand.pendingId
      : undefined
    const baseInput = { pendingId, scheduleDate: '2026-03-25', channelId: 'rotation' }

    const missing = await runtime.executePendingCommand(baseInput, submitted.sessionId)
    const mismatch = await runtime.executePendingCommand({
      ...baseInput,
      workspaceKey: 'rotation:another-playlist',
    }, submitted.sessionId)

    expect(testCase).toMatchObject({ expectedDecision: expect.any(String), mustNotHappen: expect.any(String), verification: expect.any(String) })
    expect(missing.result).toMatchObject({ success: false, error: 'formal_write_workspace_missing' })
    expect(mismatch.result).toMatchObject({ success: false, error: 'formal_write_workspace_mismatch' })
    expect(executePendingCommand).not.toHaveBeenCalled()
  })

  it('keeps a server-side formal playlist snapshot and returns a patch after confirmed writes', async () => {
    const executePendingCommand = vi.fn(async (_input: RuntimeExecutePendingCommandInput) => {
      expect(getAtomicCapabilities().getItem('item-1')?.programName).toBe('看东方')
      return {
        success: true,
        command: { action: 'delete', data: { itemId: 'item-1' }, reasoning: '用户确认删除。' } as never,
        message: '已删除。',
        summary: '删除看东方',
      }
    })
    const runtime = createRuntime(async () => pendingDeleteDecision(), executePendingCommand)
    const first = await runtime.submitInstruction({
      ...baseSubmitInput('查询当前播单'),
      currentSchedule: [{
        id: 'item-1',
        programName: '看东方',
        programCode: 'news-1',
        startTime: '2026-03-25T09:00:00',
        endTime: '2026-03-25T09:30:00',
        duration: 1800,
        programType: 'news',
      }],
    })

    const result = await runtime.executePendingCommand({
      pendingId: first.decision?.kind === 'pending_command' ? first.decision.pendingCommand.pendingId : undefined,
      scheduleDate: '2026-03-25',
      channelId: 'rotation',
      workspaceKey: first.session.formalPlaylistWorkspaceKey ?? undefined,
      expectedPlaylistVersion: first.session.formalPlaylistVersion,
    }, first.sessionId)

    expect(result.result?.playlistPatch).toMatchObject({
      type: 'formal_playlist_patch',
      previousVersion: first.session.formalPlaylistVersion,
      itemCount: 0,
      changedItemIds: ['item-1'],
    })
    expect(result.session.formalPlaylistItemCount).toBe(0)
    expect(result.session.formalPlaylistVersion).not.toBe(first.session.formalPlaylistVersion)
    expect(runtime.getSessionEvents(first.sessionId).some((event) => event.type === 'formal_write')).toBe(true)
  })

  it('blocks confirmed writes when the foreground playlist version no longer matches the server session', async () => {
    const executePendingCommand = vi.fn(async (_input: RuntimeExecutePendingCommandInput) => ({
      success: true,
      command: { action: 'delete', data: { itemId: 'item-1' }, reasoning: '用户确认删除。' } as never,
      message: '已删除。',
      summary: '删除看东方',
    }))
    const runtime = createRuntime(async () => pendingDeleteDecision(), executePendingCommand)
    const first = await runtime.submitInstruction({
      ...baseSubmitInput('删除看东方'),
      currentSchedule: [{
        id: 'item-1',
        programName: '看东方',
        programCode: 'news-1',
        startTime: '2026-03-25T09:00:00',
        endTime: '2026-03-25T09:30:00',
        duration: 1800,
        programType: 'news',
      }],
    })

    const staleForegroundVersion = 'formal_foreground_changed'
    const result = await runtime.executePendingCommand({
      pendingId: first.decision?.kind === 'pending_command' ? first.decision.pendingCommand.pendingId : undefined,
      scheduleDate: '2026-03-25',
      channelId: 'rotation',
      workspaceKey: first.session.formalPlaylistWorkspaceKey ?? undefined,
      expectedPlaylistVersion: staleForegroundVersion,
      currentSchedule: [{
        id: 'item-2',
        programName: '新插入节目',
        programCode: 'news-2',
        startTime: '2026-03-25T09:30:00',
        endTime: '2026-03-25T10:00:00',
        duration: 1800,
        programType: 'news',
      }],
    }, first.sessionId)

    expect(executePendingCommand).not.toHaveBeenCalled()
    expect(result.result).toMatchObject({
      success: false,
      error: 'formal_playlist_version_conflict',
    })
    expect(result.session.formalPlaylistVersion).toBe(first.session.formalPlaylistVersion)
  })

  it('can persist server sessions, formal playlist snapshots and events to disk', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'aibiandan-agent-session-'))
    const filePath = join(tempDir, 'sessions.json')
    try {
      const store = new AgentServerFileSessionStore(filePath)
      const session = store.createSession()
      store.updateSession(session.id, {
        formalPlaylistVersion: 'formal_before',
        formalPlaylistWorkspaceKey: 'rotation:rotation-1',
        formalPlaylistSnapshot: {
          version: 'formal_before',
          itemCount: 1,
          updatedAt: '2026-03-25T00:00:00.000Z',
          source: 'foreground',
          items: [{
            id: 'item-1',
            programName: '看东方',
            programCode: 'news-1',
            startTime: '2026-03-25T09:00:00',
            endTime: '2026-03-25T09:30:00',
            duration: 1800,
            programType: 'news',
          }],
        },
        pendingCommand: {
          pendingId: 'server_pending_command_restore',
          command: { action: 'delete', data: { itemId: 'item-1' }, reasoning: '用户确认删除。' } as never,
          summary: '删除看东方',
          reasoning: '用户确认删除。',
        },
        activeExecutionCheckpoint: {
          id: 'agent_checkpoint_restore',
          kind: 'composite_task',
          status: 'waiting_continue',
          taskId: 'task-batch-delete-1',
          summary: '已处理 10 条，还剩 27 条，等待继续确认。',
          completedCount: 10,
          remainingCount: 27,
          commandCount: 37,
          batchIndex: 2,
          suggestedActions: ['继续', '停止'],
          createdAt: '2026-03-25T00:00:00.000Z',
          updatedAt: '2026-03-25T00:00:00.000Z',
        },
      })
      store.appendEvent(session.id, {
        type: 'formal_write',
        summary: '正式播单写入边界已完成。',
      })

      const restored = new AgentServerFileSessionStore(filePath)
      const restoredSession = restored.getSession(session.id)

      expect(restoredSession).toMatchObject({
        id: session.id,
        formalPlaylistVersion: 'formal_before',
        formalPlaylistWorkspaceKey: 'rotation:rotation-1',
        formalPlaylistSnapshot: {
          itemCount: 1,
        },
        pendingCommand: {
          pendingId: 'server_pending_command_restore',
          summary: '删除看东方',
        },
        activeExecutionCheckpoint: {
          id: 'agent_checkpoint_restore',
          status: 'waiting_continue',
          remainingCount: 27,
        },
      })
      expect(restoredSession?.eventLog.some((event) => event.type === 'formal_write')).toBe(true)
      const persisted = JSON.parse(readFileSync(filePath, 'utf8')) as {
        schemaVersion: number
        metadata?: {
          storeKind?: string
          sessionCount?: number
          eventCount?: number
          activeCheckpointCount?: number
        }
      }
      expect(persisted).toMatchObject({
        schemaVersion: 2,
        metadata: {
          storeKind: 'agent-server-file-session-store',
          sessionCount: 1,
          activeCheckpointCount: 1,
        },
      })
      expect(persisted.metadata?.eventCount).toBeGreaterThan(0)
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('does not fail the runtime turn when trial session persistence is temporarily blocked', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'aibiandan-agent-session-blocked-'))
    const blockedPath = join(tempDir, 'blocked-target')
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      const store = new AgentServerFileSessionStore(blockedPath)
      mkdirSync(blockedPath, { recursive: true })

      expect(() => store.createSession()).not.toThrow()
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Agent session persistence failed'))
    } finally {
      warnSpy.mockRestore()
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('builds a lightweight replay package for trial feedback', async () => {
    const runtime = createRuntime(async () => ({
      kind: 'message',
      feedback: {
        content: '我先查素材。此轮不会写入正式播单。',
        processType: 'planning',
        processTypeLabel: 'AI编审助手',
        details: {
          materialEvidence: {
            summary: '已找到世界杯亚洲球队介绍素材方向。',
            candidateCount: 4,
            query: {
              keywords: ['世界杯', '亚洲球队', '球队介绍'],
            },
          },
        },
      },
    }))

    const result = await runtime.submitInstruction(baseSubmitInput('新建一个 1 小时世界杯亚洲球队介绍轮播单'))
    const replayPackage = runtime.getSessionReplayPackage(result.sessionId)

    expect(replayPackage).toMatchObject({
      schemaVersion: 1,
      session: {
        id: result.sessionId,
      },
      latestUserInput: '新建一个 1 小时世界杯亚洲球队介绍轮播单',
      pending: {
        hasPendingCommand: false,
      },
      eventSummary: {
        byType: {
          context: 1,
          decision: 1,
          material_evidence: 1,
        },
      },
    })
    expect(replayPackage?.materialEvidence[0]).toMatchObject({
      summary: '已找到世界杯亚洲球队介绍素材方向。',
      candidateCount: 4,
    })
    expect(replayPackage?.recentEvents.length).toBeGreaterThan(0)
  })

  it('records material evidence from ReAct observations as server events', async () => {
    const runtime = createRuntime(async () => ({
      kind: 'message',
      feedback: {
        content: '我先查素材。',
        processType: 'planning',
        processTypeLabel: 'ReAct',
        details: {
          reactTaskRun: {
            ...reactTaskRun,
            observations: [{
              ...reactTaskRun.observations[0]!,
              type: 'asset_search',
              summary: '已找到金山区景点素材 3 条。',
              data: {
                keyword: '金山区热门景点',
                candidateCount: 3,
              },
            }],
          },
        },
      },
    }))

    const result = await runtime.submitInstruction(baseSubmitInput('第一段金山区景点部分，选择最近3年最火热的景点'))

    expect(result.session.materialEvidenceCount).toBe(1)
    expect(runtime.getSessionEvents(result.sessionId).some((event) => (
      event.type === 'material_evidence'
      && event.summary.includes('金山区景点素材')
    ))).toBe(true)
  })

  it('formal-react-server-checkpoint-stop: persists the last workspace-scoped checkpoint when stopped', async () => {
    const testCase = {
      id: 'formal-react-server-checkpoint-stop',
      userInput: '补齐当前轮播单空窗并在第一轮后停止',
      expectedDecision: '服务端按 sessionId + workspaceKey 保存 checkpoint 与上下文压缩证据，停止后仍可回放',
      mustNotHappen: '跨工作区保存、停止后清空 checkpoint、丢失压缩 trace、自动回滚已完成动作',
      verification: 'stopActiveInstruction=stopped，session/replay 均保留最后 checkpoint 及 contextCompaction',
    }
    vi.useFakeTimers()
    const runtime = new AgentServerRuntime({
      sessions: new AgentServerSessionStore(),
      runtime: {
        submitInstruction: vi.fn(async () => messageDecision()),
        executePendingCommand: vi.fn(),
        resolvePendingTargetSelection: vi.fn(),
        resolvePendingInsertRecommendation: vi.fn(),
        startReactOrchestration: vi.fn(async (_request, _input, deadline, onCheckpoint) => {
          onCheckpoint?.({
            id: 'react-run:checkpoint:1:continue', runId: 'react-run', objective: '补齐当前轮播单空窗', turn: 1,
            actions: [{ type: 'validate' }], observations: [],
            decision: { kind: 'continue', nextActions: [{ type: 'research_check', queries: ['新闻'] }], reason: '继续检查候选' },
            contextCompaction: {
              strategy: 'recent_raw_plus_decided_summary', retainRecentTurns: 2,
              before: { checkpointCount: 3, observationCount: 3, actionCount: 3 },
              after: { rawTurnCount: 2, rawObservationCount: 2, rawActionCount: 2, summarizedTurnCount: 3, failureReasonCount: 1 },
              dropped: { rawTurnCount: 1, rawObservationCount: 1, rawActionCount: 1 },
            },
            createdAt: '2026-07-18T00:00:00.000Z',
          })
          await new Promise<void>((resolve) => deadline.signal().addEventListener('abort', () => resolve(), { once: true }))
          return { status: 'cancelled' as const }
        }),
      },
    })
    const session = runtime.createSession()
    const pending = runtime.executeReactOrchestration({
      userInput: testCase.userInput,
      mode: 'partial_generate',
      reasoning: '需要逐批观察',
      reactTask: { objective: '补齐当前轮播单空窗', nextActions: [{ type: 'validate' }] },
    }, baseSubmitInput(testCase.userInput), session.id)
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(5_000)

    const stop = runtime.stopActiveInstruction(session.id, 'rotation:rotation-1')
    await pending

    expect(testCase).toMatchObject({ expectedDecision: expect.any(String), mustNotHappen: expect.any(String), verification: expect.any(String) })
    expect(stop.reason).toBe('stopped')
    expect(runtime.getSession(session.id)?.formalOrchestrationCheckpointCount).toBe(1)
    expect(runtime.getSessionReplayPackage(session.id)?.formalOrchestration?.checkpoints[0]?.id).toBe('react-run:checkpoint:1:continue')
    expect(runtime.getSessionReplayPackage(session.id)?.formalOrchestration?.checkpoints[0]?.contextCompaction).toMatchObject({
      before: { checkpointCount: 3 },
      after: { rawTurnCount: 2, summarizedTurnCount: 3 },
      dropped: { rawTurnCount: 1 },
    })
  })

  it('formal-react-server-workspace-mismatch: rejects execution against another playlist session', async () => {
    const testCase = {
      id: 'formal-react-server-workspace-mismatch',
      userInput: '在电视播单执行上一张轮播单的长流程',
      expectedDecision: '服务端拒绝跨工作区正式编排',
      mustNotHappen: '复用上一张播单 checkpoint、素材证据或正式快照',
      verification: 'executeReactOrchestration rejects 且 runtime 未启动',
    }
    const sessions = new AgentServerSessionStore()
    const session = sessions.createSession()
    sessions.updateSession(session.id, { formalPlaylistWorkspaceKey: 'rotation:rotation-1' })
    const startReactOrchestration = vi.fn()
    const runtime = new AgentServerRuntime({
      sessions,
      runtime: {
        submitInstruction: vi.fn(), executePendingCommand: vi.fn(), resolvePendingTargetSelection: vi.fn(),
        resolvePendingInsertRecommendation: vi.fn(), startReactOrchestration,
      },
    })

    await expect(runtime.executeReactOrchestration({
      userInput: testCase.userInput,
      mode: 'partial_generate',
      reasoning: '测试隔离',
      reactTask: { objective: '电视播单补排', nextActions: [{ type: 'validate' }] },
    }, {
      scheduleState: {
        playlistId: 'tv-2', playlistType: 'tv', channelId: 'dragon', channelName: '东方卫视', date: '2026-07-18',
        isEmpty: true, itemCount: 0, gapCount: 1, hasSelectedTimeRange: false,
      },
      userInput: testCase.userInput,
      currentSchedule: [],
    }, session.id)).rejects.toThrow('工作区')

    expect(testCase).toMatchObject({ expectedDecision: expect.any(String), mustNotHappen: expect.any(String), verification: expect.any(String) })
    expect(startReactOrchestration).not.toHaveBeenCalled()
  })

  it('formal-react-server-recovery-inspection-does-not-run: exposes explicit actions without auto resume', async () => {
    const sessions = new AgentServerSessionStore()
    const session = sessions.createSession()
    const startReactOrchestration = vi.fn()
    sessions.updateSession(session.id, {
      formalOrchestrationWorkspaceKey: 'rotation:rotation-1',
      formalOrchestrationPlaylistVersion: 'version-1',
      formalOrchestrationRequest: {
        userInput: '补齐空窗', mode: 'partial_generate', reasoning: '逐轮补排',
        reactTask: { objective: '补齐空窗', nextActions: [{ type: 'validate' }] },
      },
      formalOrchestrationCheckpoints: [{
        id: 'run-1:checkpoint:1:continue', runId: 'run-1', objective: '补齐空窗', turn: 1,
        actions: [{ type: 'validate' }], observations: [],
        decision: { kind: 'continue', nextActions: [{ type: 'research_check', queries: ['新闻'] }], reason: '继续检索' },
        createdAt: '2026-07-19T00:00:00.000Z',
      }],
    })
    const runtime = new AgentServerRuntime({
      sessions,
      runtime: {
        submitInstruction: vi.fn(), executePendingCommand: vi.fn(), resolvePendingTargetSelection: vi.fn(),
        resolvePendingInsertRecommendation: vi.fn(), startReactOrchestration,
      },
    })

    const result = await runtime.recoverReactOrchestration({
      action: 'inspect', workspaceKey: 'rotation:rotation-1', playlistVersion: 'version-1',
    }, session.id)

    expect(result.result).toMatchObject({ status: 'action_required', allowedActions: ['continue', 'retry', 'narrow_scope', 'cancel'] })
    expect(startReactOrchestration).not.toHaveBeenCalled()
    expect(runtime.getSessionEvents(session.id).at(-1)?.type).toBe('react_recovery')
  })

  /**
   * case formal-rebuild-grant-is-issued-and-resolved-by-server
   * - userInput: 确认重新编排已有轮播单
   * - expectedDecision: server 只根据当前 session 的确认 pending 签发 Grant，返回前台的 request 仅含 grantId
   * - mustNotHappen: 把完整 Grant 暴露给客户端；接受伪造 resolvedAuthorization；绕过 sourcePendingId 校验
   * - verification: session 保存 Grant，decision 不含 authorizationRequest/resolvedAuthorization，执行时 runtime 收到服务端解析的 Grant
   */
  it('post9-rotation-compression-staged-react formal stage: keeps the rebuild grant behind the server boundary', async () => {
    const sessions = new AgentServerSessionStore()
    const session = sessions.createSession()
    const pendingAtomicContext = {
      pendingId: 'server-pending-rebuild-1', action: null, phase: 'formal_rebuild_confirmation' as const,
      summary: '待确认重新编排轮播单', reasoning: '已有节目',
      originalUserInput: '重新编排', collectedUserInput: '重新编排', slots: {},
      missingFields: ['selection' as const], followUpQuestion: '确认吗', attemptCount: 0,
      formalRebuildConfirmation: {
        actionKind: 'formal_orchestration' as const, mode: 'full_generate' as const,
        existingItemCount: 1, playlistType: 'rotation' as const, userInput: '重新编排',
      },
      createdAt: '2026-07-21T00:00:00.000Z', updatedAt: '2026-07-21T00:00:00.000Z',
    }
    sessions.updateSession(session.id, { pendingAtomicContext })
    const startReactOrchestration = vi.fn(async (_request, _input, _deadline, onCheckpoint) => {
      onCheckpoint?.({
        id: 'grant-run:checkpoint:1:complete', runId: 'grant-run', objective: '整批重编', turn: 1,
        actions: [{ type: 'validate' }], observations: [], decision: { kind: 'complete', reason: '完成' },
        createdAt: '2026-07-21T00:00:01.000Z',
      })
      return { status: 'completed' as const }
    })
    const runtime = new AgentServerRuntime({
      sessions,
      runtime: {
        submitInstruction: vi.fn(async () => ({
          kind: 'orchestration' as const,
          feedback: { content: '开始重编', processType: 'planning' as const, processTypeLabel: '任务规划' },
          orchestrationRequest: {
            userInput: '确认重新编排', mode: 'full_generate' as const, reasoning: '已确认',
            authorizationRequest: {
              sourcePendingId: 'server-pending-rebuild-1', workspaceKey: 'rotation:rotation-1',
              mode: 'full_generate' as const, existingItemCount: 1,
            },
          },
        })),
        executePendingCommand: vi.fn(), resolvePendingTargetSelection: vi.fn(),
        resolvePendingInsertRecommendation: vi.fn(), startReactOrchestration,
      },
    })
    const input = baseSubmitInput('确认重新编排')

    const submitted = await runtime.submitInstruction(input, session.id)

    expect(submitted.decision?.kind).toBe('orchestration')
    if (submitted.decision?.kind !== 'orchestration') throw new Error('expected orchestration decision')
    expect(submitted.decision.orchestrationRequest).toMatchObject({ authorizationGrantId: expect.stringMatching(/^formal_rebuild_grant_/) })
    expect(submitted.decision.orchestrationRequest.authorizationRequest).toBeUndefined()
    expect(submitted.decision.orchestrationRequest.resolvedAuthorization).toBeUndefined()
    expect(sessions.getSession(session.id)?.formalOrchestrationGrant).toMatchObject({
      sourcePendingId: 'server-pending-rebuild-1', sessionId: session.id, workspaceKey: 'rotation:rotation-1', status: 'active',
    })

    const resumedRuntime = new AgentServerRuntime({
      sessions,
      runtime: {
        submitInstruction: vi.fn(), executePendingCommand: vi.fn(), resolvePendingTargetSelection: vi.fn(),
        resolvePendingInsertRecommendation: vi.fn(), startReactOrchestration,
      },
    })
    await resumedRuntime.executeReactOrchestration(submitted.decision.orchestrationRequest, input, session.id)

    expect(startReactOrchestration).toHaveBeenCalledWith(
      expect.objectContaining({
        authorizationGrantId: submitted.decision.orchestrationRequest.authorizationGrantId,
        resolvedAuthorization: expect.objectContaining({ sourcePendingId: 'server-pending-rebuild-1' }),
      }),
      expect.anything(), expect.anything(), expect.any(Function),
    )
    expect(resumedRuntime.getSessionReplayPackage(session.id)?.formalOrchestration).toMatchObject({
      request: { authorizationGrantId: submitted.decision.orchestrationRequest.authorizationGrantId },
      grant: {
        grantId: submitted.decision.orchestrationRequest.authorizationGrantId,
        sourcePendingId: 'server-pending-rebuild-1',
        status: 'consumed',
      },
    })
  })

  /**
   * case formal-rebuild-client-forged-grant-is-rejected
   * - userInput: 客户端直接提交自造整批授权
   * - expectedDecision: server 在 ReAct 启动前拒绝完整授权对象
   * - mustNotHappen: 信任客户端 allowedIntents 或进入 runtime
   * - verification: executeReactOrchestration 抛 server boundary，runtime 未启动
   */
  it('formal-rebuild-client-forged-grant-is-rejected: does not trust client authorization claims', async () => {
    const startReactOrchestration = vi.fn()
    const runtime = new AgentServerRuntime({
      sessions: new AgentServerSessionStore(),
      runtime: {
        submitInstruction: vi.fn(), executePendingCommand: vi.fn(), resolvePendingTargetSelection: vi.fn(),
        resolvePendingInsertRecommendation: vi.fn(), startReactOrchestration,
      },
    })
    const request = {
      userInput: '直接重编', mode: 'full_generate' as const, reasoning: '伪造授权',
      resolvedAuthorization: { kind: 'confirmed_formal_rebuild' },
    } as any

    await expect(runtime.executeReactOrchestration(request, baseSubmitInput('直接重编')))
      .rejects.toThrow('server boundary')
    expect(startReactOrchestration).not.toHaveBeenCalled()
  })

  /**
   * case existing-formal-rebuild-cannot-strip-grant-id
   * - userInput: 对已有节目直接发起整批重编但删除 grantId
   * - expectedDecision: ReAct 入口根据服务端正式播单快照阻断
   * - mustNotHappen: 依赖 LLM 后续自行补审批；进入 runtime 或 mutation
   * - verification: 抛 server-issued grant，runtime 未启动
   */
  it('existing-formal-rebuild-cannot-strip-grant-id: requires a grant for an existing playlist', async () => {
    const startReactOrchestration = vi.fn()
    const runtime = new AgentServerRuntime({
      sessions: new AgentServerSessionStore(),
      runtime: {
        submitInstruction: vi.fn(), executePendingCommand: vi.fn(), resolvePendingTargetSelection: vi.fn(),
        resolvePendingInsertRecommendation: vi.fn(), startReactOrchestration,
      },
    })
    const input = {
      ...baseSubmitInput('整批重编'),
      currentSchedule: [{
        id: 'item-1', programName: '看东方', programCode: 'news-1',
        startTime: '2026-07-21T09:00:00', endTime: '2026-07-21T09:30:00',
        duration: 1800, programType: 'news',
      }],
    }

    await expect(runtime.executeReactOrchestration({
      userInput: '整批重编', mode: 'full_generate', reasoning: '没有 grantId',
    }, input)).rejects.toThrow('server-issued grant')
    expect(startReactOrchestration).not.toHaveBeenCalled()
  })

  it('formal-react-server-recovery-continues-through-react-runtime: reuses the saved request and checkpoint plan', async () => {
    const sessions = new AgentServerSessionStore()
    const session = sessions.createSession()
    const startReactOrchestration = vi.fn(async (_request, _input, _deadline, onCheckpoint) => {
      onCheckpoint?.({
        id: 'run-1:checkpoint:2:complete', runId: 'run-1', objective: '补齐空窗', turn: 2,
        actions: [{ type: 'research_check', queries: ['新闻'] }], observations: [],
        decision: { kind: 'complete', reason: '完成' }, createdAt: '2026-07-19T00:00:01.000Z',
      })
      return { status: 'completed' as const }
    })
    sessions.updateSession(session.id, {
      formalOrchestrationWorkspaceKey: 'rotation:rotation-1',
      formalOrchestrationPlaylistVersion: 'version-1',
      formalOrchestrationRequest: {
        userInput: '补齐空窗', mode: 'partial_generate', reasoning: '逐轮补排',
        reactTask: { objective: '补齐空窗', nextActions: [{ type: 'validate' }] },
      },
      formalOrchestrationCheckpoints: [{
        id: 'run-1:checkpoint:1:continue', runId: 'run-1', objective: '补齐空窗', turn: 1,
        actions: [{ type: 'validate' }], observations: [],
        decision: { kind: 'continue', nextActions: [{ type: 'research_check', queries: ['新闻'] }], reason: '继续检索' },
        createdAt: '2026-07-19T00:00:00.000Z',
      }],
    })
    const runtime = new AgentServerRuntime({
      sessions,
      runtime: {
        submitInstruction: vi.fn(), executePendingCommand: vi.fn(), resolvePendingTargetSelection: vi.fn(),
        resolvePendingInsertRecommendation: vi.fn(), startReactOrchestration,
      },
    })

    const result = await runtime.recoverReactOrchestration({
      action: 'continue', workspaceKey: 'rotation:rotation-1', playlistVersion: 'version-1',
      runtimeInput: baseSubmitInput('继续刚才的任务'),
    }, session.id)

    expect(result.result).toMatchObject({ status: 'ready', executionStatus: 'completed' })
    expect(startReactOrchestration).toHaveBeenCalledWith(
      expect.objectContaining({
        userInput: '补齐空窗',
        reactRecovery: expect.objectContaining({ runId: 'run-1', nextActions: [{ type: 'research_check', queries: ['新闻'] }] }),
      }),
      expect.anything(), expect.anything(), expect.any(Function),
    )
    expect(runtime.getSession(session.id)?.formalOrchestrationCheckpointCount).toBe(2)
  })

  it('formal-react-server-progress-branches: emits replayable research and decision progress', async () => {
    const runtime = new AgentServerRuntime({
      sessions: new AgentServerSessionStore(),
      runtime: {
        submitInstruction: vi.fn(), executePendingCommand: vi.fn(), resolvePendingTargetSelection: vi.fn(),
        resolvePendingInsertRecommendation: vi.fn(),
        startReactOrchestration: vi.fn(async (_request, _input, _deadline, onCheckpoint) => {
          onCheckpoint?.({
            id: 'run-progress:checkpoint:1:continue', runId: 'run-progress', objective: '补齐空窗', turn: 1,
            actions: [{ type: 'research_check', queries: ['新闻'] }], observations: [],
            decision: { kind: 'continue', nextActions: [{ type: 'validate' }], reason: '候选仍需校验' },
            createdAt: '2026-07-19T00:00:00.000Z',
          })
          return { status: 'completed' as const }
        }),
      },
    })

    const result = await runtime.executeReactOrchestration({
      userInput: '补齐空窗', mode: 'partial_generate', reasoning: '逐轮执行',
      reactTask: { objective: '补齐空窗', nextActions: [{ type: 'research_check', queries: ['新闻'] }] },
    }, baseSubmitInput('补齐空窗'))

    expect(result.progressEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({ processTypeLabel: '查节目库' }),
      expect.objectContaining({ processTypeLabel: '候选决策' }),
    ]))
    expect(runtime.getSessionEvents(result.sessionId).filter((event) => event.type === 'progress')).toHaveLength(3)
  })

  /**
   * case formal-react-server-waiting-user-outcome
   * - userInput: 删除 item-1，先等我确认
   * - expectedDecision: 服务端返回 waiting_user，通过统一 progress 展示等待确认，并保存此前已完成批次快照
   * - mustNotHappen: 返回 completed/failed；重复保存 checkpoint；丢失已完成批次；把 pending 当成已写入
   * - verification: POST outcome、progress label、session checkpoint 与正式播单快照版本一致
   */
  it('formal-react-server-waiting-user-outcome: exposes approval pause without failure', async () => {
    const runtime = new AgentServerRuntime({
      sessions: new AgentServerSessionStore(),
      runtime: {
        submitInstruction: vi.fn(), executePendingCommand: vi.fn(), resolvePendingTargetSelection: vi.fn(),
        resolvePendingInsertRecommendation: vi.fn(),
        startReactOrchestration: vi.fn(async (_request, _input, _deadline, onCheckpoint) => {
          onCheckpoint?.({
            id: 'run-waiting:checkpoint:1:waiting_user', runId: 'run-waiting', objective: '删除前等待确认', turn: 1,
            actions: [{ type: 'atomic_command', intent: 'delete', targetItemId: 'item-1', mutationPolicy: 'pending_only' }],
            observations: [{
              id: 'observation-waiting', turn: 1, type: 'atomic_execution', summary: '删除等待用户确认',
              data: { noMutation: true, pendingMutation: { workspaceKey: 'rotation:rotation-1', mutationPolicy: 'pending_only' } },
              createdAt: '2026-07-20T00:00:00.000Z',
            }],
            decision: { kind: 'waiting_user', reason: '删除等待用户确认' },
            createdAt: '2026-07-20T00:00:00.000Z',
          })
          return {
            status: 'waiting_user' as const,
            checkpointCount: 1,
            pendingTask: { intent: 'delete', phase: 'needs_confirmation', originalInput: '删除 item-1', collectedSlots: {}, missingSlots: ['confirmation'] },
            scheduleItems: [{
              id: 'completed-before-waiting', programName: '已完成批次节目',
              startTime: '2026-07-20T19:00:00', endTime: '2026-07-20T19:30:00', duration: 1800,
            }],
          }
        }),
      },
    })

    const result = await runtime.executeReactOrchestration({
      userInput: '删除 item-1，先等我确认', mode: 'partial_generate', reasoning: '敏感删除需要确认',
      reactTask: { objective: '删除前等待确认', nextActions: [{ type: 'atomic_command', intent: 'delete', targetItemId: 'item-1', mutationPolicy: 'pending_only' }] },
    }, baseSubmitInput('删除 item-1，先等我确认'))

    expect(result.result).toMatchObject({ status: 'waiting_user', checkpointCount: 1 })
    expect(result.result?.scheduleItems).toEqual([
      expect.objectContaining({ id: 'completed-before-waiting' }),
    ])
    expect(result.progressEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({ processTypeLabel: '等待用户确认', details: expect.objectContaining({ noMutation: true }) }),
    ]))
    expect(runtime.getSession(result.sessionId)?.formalOrchestrationCheckpointCount).toBe(1)
    expect(runtime.getSession(result.sessionId)).toMatchObject({
      formalPlaylistItemCount: 1,
      formalPlaylistVersion: expect.stringMatching(/^formal_/),
    })
  })

  it('formal-react-server-failure-envelope: exposes failed outcome and replayable recovery progress', async () => {
    const testCase = {
      id: 'formal-react-server-failure-envelope',
      userInput: '帮我全天编排',
      expectedDecision: 'decide 失败后返回 failed，并通过 SSE/POST progress 暴露结构化可恢复失败',
      mustNotHappen: '把 failed 映射成 completed、只保留 planner 承诺文案、自动回滚或静默续跑',
      verification: 'result.status=failed，processTypeLabel=可恢复失败，recoverableFailure 原样保留',
    }
    const recoverableFailure = {
      kind: 'llm_decide_unavailable', recognizedSlots: [], missingSlots: [], candidateEvidence: [],
      retrySuggestions: [{ label: '重试当前任务', instructionTemplate: '重试当前任务', strategy: 'resubmit' }],
      noMutation: true,
    }
    const runtime = new AgentServerRuntime({
      sessions: new AgentServerSessionStore(),
      runtime: {
        submitInstruction: vi.fn(), executePendingCommand: vi.fn(), resolvePendingTargetSelection: vi.fn(),
        resolvePendingInsertRecommendation: vi.fn(),
        startReactOrchestration: vi.fn(async (_request, _input, _deadline, onCheckpoint) => {
          onCheckpoint?.({
            id: 'run-failed:checkpoint:1:decide_failed', runId: 'run-failed', objective: '全天编排', turn: 1,
            actions: [{ type: 'research_check', queries: ['新闻'] }], observations: [],
            decision: { kind: 'decide_failed', reason: 'LLM 网络请求超时' }, failureReason: 'LLM 网络请求超时',
            createdAt: '2026-07-19T00:00:00.000Z',
          })
          return { status: 'failed' as const, failure: { message: 'LLM 网络请求超时', recoverableFailure, checkpointCount: 1 } }
        }),
      },
    })

    const result = await runtime.executeReactOrchestration({
      userInput: testCase.userInput, mode: 'full_generate', reasoning: '逐轮执行',
      reactTask: { objective: '全天编排', nextActions: [{ type: 'research_check', queries: ['新闻'] }] },
    }, baseSubmitInput(testCase.userInput))

    expect(testCase).toMatchObject({ expectedDecision: expect.any(String), mustNotHappen: expect.any(String), verification: expect.any(String) })
    expect(result.result).toMatchObject({ status: 'failed', failure: { message: 'LLM 网络请求超时', recoverableFailure } })
    expect(result.progressEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        processType: 'error', processTypeLabel: '可恢复失败', content: 'LLM 网络请求超时',
        details: expect.objectContaining({ recoverableFailure, checkpointCount: 1 }),
      }),
    ]))
  })
})
