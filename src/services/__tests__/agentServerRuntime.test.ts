import { describe, expect, it, vi } from 'vitest'

import { AgentServerRuntime } from '@/services/runtime/agentServerRuntime'
import { AgentServerSessionStore } from '@/services/runtime/agentServerSessionStore'
import type {
  RuntimeDecision,
  RuntimeExecutePendingCommandInput,
  RuntimeResolveInsertRecommendationInput,
  RuntimeResolveTargetSelectionInput,
  RuntimeSubmitInput,
} from '@/services/runtime/schedulingAgentRuntimeFacade'
import type { ReactTaskRun } from '@/services/runtime/reactTaskTypes'
import type { ScheduleState } from '@/types/orchestration'

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
  stopCondition: '素材方向明确后进入草案确认',
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
})
