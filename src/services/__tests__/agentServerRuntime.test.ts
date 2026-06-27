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
    const runtime = createRuntime(async () => messageDecision(), executePendingCommand)

    const result = await runtime.executePendingCommand({
      pendingCommand: {
        command: { action: 'validate' } as never,
        summary: '执行播单校验',
        reasoning: '用户确认执行。',
      },
      scheduleDate: '2026-03-25',
      channelId: 'rotation',
      idempotencyKey: 'pending-confirm-1',
    })

    expect(executePendingCommand).toHaveBeenCalledTimes(1)
    expect(result.result?.details?.formalWrite).toMatchObject({
      boundary: 'agent-server',
      status: 'applied',
      reused: false,
      idempotencyKey: 'pending-confirm-1',
    })
    expect(runtime.getSessionEvents(result.sessionId).some((event) => (
      event.type === 'execution'
      && (event.data?.formalWrite as { boundary?: string } | undefined)?.boundary === 'agent-server'
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
      expectedPlaylistVersion: first.session.formalPlaylistVersion,
    }, first.sessionId)

    expect(pendingId).toMatch(/^server_pending_command_/)
    expect(executePendingCommand).toHaveBeenCalledTimes(1)
    expect(result.result?.success).toBe(true)
    expect(result.session.formalPlaylistItemCount).toBe(0)
    expect(result.result?.details?.formalWrite).toMatchObject({
      boundary: 'agent-server',
      status: 'applied',
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
    const runtime = createRuntime(async () => messageDecision(), executePendingCommand)
    const input: RuntimeExecutePendingCommandInput = {
      pendingCommand: {
        command: { action: 'validate' } as never,
        summary: '执行播单校验',
        reasoning: '用户确认执行。',
      },
      scheduleDate: '2026-03-25',
      channelId: 'rotation',
      idempotencyKey: 'pending-confirm-1',
    }

    const first = await runtime.executePendingCommand(input)
    const second = await runtime.executePendingCommand(input, first.sessionId)

    expect(executePendingCommand).toHaveBeenCalledTimes(1)
    expect(second.result?.details?.formalWrite).toMatchObject({
      status: 'reused',
      reused: true,
    })
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
    const runtime = createRuntime(async () => messageDecision(), executePendingCommand)
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
      pendingCommand: {
        command: { action: 'delete', data: { itemId: 'item-1' }, reasoning: '用户确认删除。' } as never,
        summary: '删除看东方',
        reasoning: '用户确认删除。',
        successMessage: '已删除。',
      },
      scheduleDate: '2026-03-25',
      channelId: 'rotation',
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
    const runtime = createRuntime(async () => messageDecision(), executePendingCommand)
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
      pendingCommand: {
        command: { action: 'delete', data: { itemId: 'item-1' }, reasoning: '用户确认删除。' } as never,
        summary: '删除看东方',
        reasoning: '用户确认删除。',
      },
      scheduleDate: '2026-03-25',
      channelId: 'rotation',
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
})
