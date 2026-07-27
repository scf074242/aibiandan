import { describe, expect, it, vi } from 'vitest'

import { AgentDeadline, LONG_RUNNING_DEADLINE_BUDGET } from '../agentDeadline'
import { FormalOrchestrationCapability } from '../formalOrchestrationCapability'
import { prepareFormalOrchestrationRecovery } from '@/services/runtime/formalOrchestrationRecovery'
import type { FormalOrchestrationCheckpoint } from '@/services/runtime/formalOrchestrationRuntime'
import type { AgentPlannerAction } from '@/services/llm/agentPlanner'

const mocks = vi.hoisted(() => ({ chat: vi.fn(), getTaskClassifier: vi.fn() }))

vi.mock('@/services/llm/llmClient', () => ({ getLLMClient: () => ({ chat: mocks.chat }) }))
vi.mock('@/services/llm/taskClassifier', () => ({ getTaskClassifier: mocks.getTaskClassifier }))

const createContext = () => ({
  channelId: 'dragon', date: '2026-07-18', playlistId: 'playlist-a', playlistType: 'tv',
  scheduleItems: [],
  programCandidates: [{
    id: 'candidate-1', programId: 'p1', programCode: 'NEWS001', programName: '晚间新闻',
    channelId: 'dragon', duration: 1800, programType: 'news', materialStatus: 'ready', rightsStatus: 'ready',
  }],
  broadcastReadiness: [], historySchedules: [], lockedItemIds: [], blockedTimeRanges: [],
  bundle: {
    identity: { channelId: 'dragon', date: '2026-07-18', playlistId: 'playlist-a', playlistType: 'tv' },
    sources: {
      today: { source: 'runtime_schedule_reader', available: true, recordCount: 0 },
      candidates: { source: 'program_candidate_reader', available: true, recordCount: 1 },
      readiness: { source: 'readiness_reader', available: true, recordCount: 0 },
      history: { source: 'history_schedule_reader', available: true, recordCount: 0 },
      constraints: { source: 'constraint_reader', available: true, recordCount: 0 },
      policy: { source: 'schedule_state', available: true, recordCount: 1 },
    },
    today: { scheduleItems: [], itemCount: 0 },
    candidates: { programCandidates: [], totalCount: 1 },
    readiness: { records: [], totalCount: 0 },
    history: { schedules: [], totalCount: 0, todayOverridesHistory: true },
    constraints: { lockedItemIds: [], blockedTimeRanges: [] },
    policy: {
      playlistType: 'tv', tvStrictFill: true, rotationCandidateWritesRequireConfirmation: true,
      sensitiveWriteIntentsRequireConfirmation: ['delete', 'batch_delete'],
    },
  },
})

describe('FormalOrchestrationCapability ReAct production entry', () => {
  /**
   * case formal-capability-missing-react-plan-fails-closed
   * - id: formal-capability-missing-react-plan-fails-closed
   * - userInput: 补齐晚间空窗
   * - expectedDecision: 缺少 reactTask 时返回结构化 react_plan_invalid 失败
   * - mustNotHappen: 启动旧 Orchestrator、查询候选或写入正式播单
   * - verification: result.status=failed，gateway/LLM/taskClassifier 均不调用
   */
  it('fails closed when formal orchestration reaches the capability without a reactTask', async () => {
    const loadContext = vi.fn()
    const commitScheduleItems = vi.fn()

    const result = await new FormalOrchestrationCapability().handle({
      userInput: '补齐晚间空窗',
      channelId: 'dragon',
      date: '2026-07-18',
      playlistId: 'playlist-a',
      orchestration: {
        mode: 'partial_generate',
        channelId: 'dragon',
        date: '2026-07-18',
      },
    }, {
      dataGateway: { loadContext, commitScheduleItems },
      candidateJudge: {} as any,
      trace: { record: vi.fn(), getTrace: vi.fn(() => []) },
      deadline: new AgentDeadline({ overallDeadlineMs: LONG_RUNNING_DEADLINE_BUDGET.overallDeadlineMs }),
    })

    expect(result.status).toBe('failed')
    expect(result.decision.constraintReport?.issues[0]?.detail).toMatchObject({
      recoverableFailure: {
        kind: 'react_plan_invalid',
        noMutation: true,
      },
    })
    expect(loadContext).not.toHaveBeenCalled()
    expect(commitScheduleItems).not.toHaveBeenCalled()
    expect(mocks.chat).not.toHaveBeenCalled()
    expect(mocks.getTaskClassifier).not.toHaveBeenCalled()
  })

  /**
   * case formal-capability-react-production-entry
   * - userInput: 补齐晚间空窗，先查晚间新闻候选再决定
   * - expectedDecision: 正式 capability 使用真实 gateway 形成 observation，并回到 LLM decide 后完成
   * - mustNotHappen: 启动旧 Orchestrator；调用 commit；跳过 observation 直接宣告完成
   * - verification: gateway 与 decide 各调用一次，decide prompt 含候选证据，结果含 checkpoint
   */
  it('routes an explicit reactTask through observation and LLM decide without legacy fallback', async () => {
    mocks.chat.mockResolvedValueOnce({ content: '{"kind":"complete","reason":"候选证据已完成本轮只读核验"}' })
    const loadContext = vi.fn(async () => createContext() as any)
    const commitScheduleItems = vi.fn()
    const onEvent = vi.fn()
    const trace = { record: vi.fn(), getTrace: vi.fn(() => []) }
    const input = {
      userInput: '补齐晚间空窗，先查晚间新闻候选再决定', channelId: 'dragon', date: '2026-07-18', playlistId: 'playlist-a',
      orchestration: {
        mode: 'partial_generate' as const, channelId: 'dragon', date: '2026-07-18', onEvent,
        reactTask: {
          workspaceKey: 'tv:dragon:2026-07-18:playlist-a',
          plannerTask: {
            objective: '核验晚间新闻候选并决定下一步', maxTurns: 3, batchSize: 1,
            nextActions: [{ type: 'research_check' as const, purpose: 'candidate_precheck' as const, queries: ['晚间新闻'] }],
          },
        },
      },
    }

    const result = await new FormalOrchestrationCapability().handle(input, {
      dataGateway: { loadContext, commitScheduleItems }, candidateJudge: {} as any, trace,
      deadline: new AgentDeadline({ overallDeadlineMs: LONG_RUNNING_DEADLINE_BUDGET.overallDeadlineMs }),
    })

    expect(result.status).toBe('executed')
    expect(loadContext).toHaveBeenCalledTimes(1)
    expect(commitScheduleItems).not.toHaveBeenCalled()
    expect(mocks.getTaskClassifier).not.toHaveBeenCalled()
    expect(mocks.chat).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(mocks.chat.mock.calls[0]?.[0])).toContain('晚间新闻')
    expect(JSON.stringify(mocks.chat.mock.calls[0]?.[0])).toContain('candidate-1')
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: 'complete', payload: expect.objectContaining({ runtime: 'react', status: 'completed' }),
    }))
    expect(result.explanation).toContain('checkpoint')
  })

  /**
   * case formal-capability-react-pending-is-not-failure
   * - userInput: 删除 item-1，先等我确认
   * - expectedDecision: 业务确认门禁使正式 ReAct 返回 needs_confirmation 并保留 pendingTask
   * - mustNotHappen: 调用 decider 替用户确认；发送 error 事件；把等待确认映射为 failed
   * - verification: result.status=needs_confirmation、commit/LLM 均为 0 次、事件进入 manual_review
   */
  it('returns needs_confirmation when the ReAct runtime pauses for a pending mutation', async () => {
    const context = createContext() as any
    context.scheduleItems = [{
      id: 'item-1', programId: 'p0', programCode: 'NEWS000', programName: '早间新闻',
      startTime: '2026-07-18T09:00:00', endTime: '2026-07-18T09:30:00', duration: 1800,
      programType: 'news', sequence: 1,
    }]
    const loadContext = vi.fn(async () => context)
    const commitScheduleItems = vi.fn()
    const onEvent = vi.fn()
    const trace = { record: vi.fn(), getTrace: vi.fn(() => []) }
    const input = {
      userInput: '删除 item-1，先等我确认', channelId: 'dragon', date: '2026-07-18', playlistId: 'playlist-a',
      orchestration: {
        mode: 'partial_generate' as const, channelId: 'dragon', date: '2026-07-18', onEvent,
        reactTask: {
          workspaceKey: 'tv:dragon:2026-07-18:playlist-a',
          plannerTask: {
            objective: '删除 item-1 前等待用户确认', maxTurns: 3, batchSize: 2,
            nextActions: [
              { type: 'atomic_command' as const, intent: 'delete' as const, targetItemId: 'item-1', mutationPolicy: 'pending_only' as const },
              { type: 'validate' as const },
            ],
          },
        },
      },
    }

    const result = await new FormalOrchestrationCapability().handle(input, {
      dataGateway: { loadContext, commitScheduleItems }, candidateJudge: {} as any, trace,
      deadline: new AgentDeadline({ overallDeadlineMs: LONG_RUNNING_DEADLINE_BUDGET.overallDeadlineMs }),
    })

    expect(result.status).toBe('needs_confirmation')
    expect(result.decision.pendingTask).toMatchObject({ intent: 'delete', phase: 'needs_confirmation' })
    expect(commitScheduleItems).not.toHaveBeenCalled()
    expect(mocks.chat).not.toHaveBeenCalled()
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: 'status-change', payload: expect.objectContaining({ runtime: 'react', status: 'manual_review' }),
    }))
    expect(onEvent).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }))
  })

  /**
   * case formal-capability-react-confirm-pending-resumes-write
   * - userInput: 确认删除 item-1
   * - expectedDecision: 显式 confirm_pending 恢复保存的 pendingTask，经原子 capability 和正式写入边界完成删除
   * - mustNotHappen: 首轮待确认时写入；确认后再次等待；跳过 observation/decide；重建无关 run
   * - verification: 首轮 commit=0，恢复轮 commit=1，最终 status=executed 且沿用原 runId
   */
  it('resumes an explicitly confirmed pending action through the formal write boundary', async () => {
    mocks.chat.mockReset()
    const context = createContext() as any
    context.scheduleItems = [{
      id: 'item-1', programId: 'p0', programCode: 'NEWS000', programName: '早间新闻',
      startTime: '2026-07-18T09:00:00', endTime: '2026-07-18T09:30:00', duration: 1800,
      programType: 'news', sequence: 1,
    }]
    const loadContext = vi.fn(async () => context)
    const commitScheduleItems = vi.fn(async (commitInput: any) => ({
      committed: true, operationId: 'delete-op', affectedItemIds: ['item-1'], scheduleItems: commitInput.items,
    }))
    const checkpoints: FormalOrchestrationCheckpoint<AgentPlannerAction>[] = []
    const baseOrchestration = {
      mode: 'partial_generate' as const,
      channelId: 'dragon',
      date: '2026-07-18',
      onCheckpoint: (checkpoint: FormalOrchestrationCheckpoint<AgentPlannerAction>) => checkpoints.push(checkpoint),
    }
    const plannerTask = {
      objective: '删除 item-1 前等待用户确认', maxTurns: 3, batchSize: 1,
      nextActions: [{ type: 'atomic_command' as const, intent: 'delete' as const, targetItemId: 'item-1', mutationPolicy: 'pending_only' as const }],
    }
    const capability = new FormalOrchestrationCapability()
    const runtime = {
      dataGateway: { loadContext, commitScheduleItems }, candidateJudge: {} as any,
      trace: { record: vi.fn(), getTrace: vi.fn(() => []) },
      deadline: new AgentDeadline({ overallDeadlineMs: LONG_RUNNING_DEADLINE_BUDGET.overallDeadlineMs }),
    }

    const first = await capability.handle({
      userInput: '删除 item-1，先等我确认', channelId: 'dragon', date: '2026-07-18', playlistId: 'playlist-a',
      orchestration: {
        ...baseOrchestration,
        reactTask: { workspaceKey: 'tv:dragon:2026-07-18:playlist-a', plannerTask },
      },
    }, runtime)

    expect(first.status).toBe('needs_confirmation')
    expect(commitScheduleItems).not.toHaveBeenCalled()
    const recovery = prepareFormalOrchestrationRecovery({
      sessionId: 'session-a', action: 'confirm_pending',
      requestedWorkspaceKey: 'tv:dragon:2026-07-18:playlist-a',
      checkpointWorkspaceKey: 'tv:dragon:2026-07-18:playlist-a',
      expectedPlaylistVersion: 'version-1', actualPlaylistVersion: 'version-1', checkpoints,
    })
    expect(recovery.status).toBe('ready')
    mocks.chat.mockResolvedValueOnce({ content: '{"kind":"complete","reason":"删除已确认并通过写入后校验"}' })

    const resumed = await capability.handle({
      userInput: '确认删除 item-1', channelId: 'dragon', date: '2026-07-18', playlistId: 'playlist-a',
      orchestration: {
        ...baseOrchestration,
        reactTask: {
          workspaceKey: 'tv:dragon:2026-07-18:playlist-a',
          plannerTask: { ...plannerTask, nextActions: [] },
          resumeFrom: recovery.resumePlan,
        },
      },
    }, runtime)

    expect(resumed.status).toBe('executed')
    expect(commitScheduleItems).toHaveBeenCalledTimes(1)
    expect(mocks.chat).toHaveBeenCalledTimes(1)
    expect(checkpoints.at(-1)?.runId).toBe(checkpoints[0]?.runId)
  })
})
