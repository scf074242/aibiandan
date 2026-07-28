import { describe, expect, it, vi } from 'vitest'

import { AgentDeadline } from '@/services/agent/agentDeadline'
import { CapabilityRouteConflictError } from '@/services/agent/capabilityRegistry'
import { FormalOrchestrationRuntime } from '../formalOrchestrationRuntime'
import { prepareFormalOrchestrationRecovery } from '../formalOrchestrationRecovery'

interface TestAction { id: string }

const initialPlan = {
  objective: '补齐全天空窗',
  maxTurns: 3,
  batchSize: 2,
  nextActions: [{ id: 'a1' }, { id: 'a2' }],
}

describe('FormalOrchestrationRuntime true ReAct loop', () => {
  /**
   * case formal-react-observe-before-decide
   * - userInput: 补齐全天空窗
   * - expectedDecision: 第一批 act 完成后把 observation 交给 decider，再执行新动作并完成
   * - mustNotHappen: 一次性执行初始 plan；decider 未看到 observation；重复执行旧动作
   * - verification: actor 顺序为 a1/a2/a3，decider 调用两次且 checkpoint 保留每轮 observation
   */
  it('post9-rotation-compression-staged-react formal stage: calls decide after every observed batch and only executes newly decided actions', async () => {
    const actor = vi.fn(async (action: TestAction) => ({ type: 'formal_execution' as const, summary: `executed:${action.id}`, data: { actionId: action.id } }))
    const decide = vi.fn()
      .mockResolvedValueOnce({ kind: 'continue', nextActions: [{ id: 'a3' }], reason: '继续补剩余空窗' })
      .mockResolvedValueOnce({ kind: 'complete', reason: '所有空窗已处理' })
    const runtime = new FormalOrchestrationRuntime<TestAction>({ actor, decide })

    const result = await runtime.run({ originalUserInput: '补齐全天空窗', plannerTask: initialPlan })

    expect(actor.mock.calls.map(([action]) => action.id)).toEqual(['a1', 'a2', 'a3'])
    expect(decide).toHaveBeenCalledTimes(2)
    expect(decide.mock.calls[0]?.[0].observations.map((item: { summary: string }) => item.summary)).toEqual(['executed:a1', 'executed:a2'])
    expect(result.status).toBe('completed')
    expect(result.checkpoints).toHaveLength(2)
    expect(result.checkpoints[0]?.decision.kind).toBe('continue')
  })

  /**
   * case formal-react-unable-stops
   * - userInput: 按草案完成全天编排
   * - expectedDecision: LLM 返回 unable_to_decide 后停止并保留最后 checkpoint
   * - mustNotHappen: 假装完成；继续执行下一批；自动回滚已完成动作
   * - verification: status=failed，failure.kind=unable_to_decide，actor 只执行首批
   */
  it('stops and exposes unable_to_decide without executing another batch', async () => {
    const actor = vi.fn(async (action: TestAction) => ({ type: 'formal_execution' as const, summary: `executed:${action.id}` }))
    const runtime = new FormalOrchestrationRuntime<TestAction>({ actor, decide: vi.fn(async () => ({ kind: 'unable_to_decide', reason: '候选证据不足' })) })

    const result = await runtime.run({ originalUserInput: '按草案完成全天编排', plannerTask: initialPlan })

    expect(actor).toHaveBeenCalledTimes(2)
    expect(result.status).toBe('failed')
    expect(result.failure).toMatchObject({ kind: 'unable_to_decide', message: '候选证据不足' })
    expect(result.failure?.envelope).toMatchObject({
      kind: 'unable_to_decide',
      recognizedSlots: [],
      missingSlots: [],
      candidateEvidence: [],
      noMutation: false,
    })
    expect(result.checkpoints).toHaveLength(1)
  })

  /**
   * case formal-react-decide-failure-stops
   * - userInput: 补排晚间空窗
   * - expectedDecision: decider 异常时停止并暴露结构化失败
   * - mustNotHappen: 使用旧 plan 自动续跑；吞掉异常
   * - verification: failure.kind=decide_failed，checkpoint 保留异常原因
   */
  it('post9-react-decider-failure-exposes-structured-state: exposes decide failure and records it in the checkpoint', async () => {
    const runtime = new FormalOrchestrationRuntime<TestAction>({
      actor: vi.fn(async (action) => ({ type: 'formal_execution', summary: `executed:${action.id}` })),
      decide: vi.fn(async () => { throw new Error('model unavailable') }),
    })

    const result = await runtime.run({ originalUserInput: '补排晚间空窗', plannerTask: initialPlan })

    expect(result.status).toBe('failed')
    expect(result.failure).toMatchObject({ kind: 'decide_failed', message: 'model unavailable' })
    expect(result.failure?.envelope.kind).toBe('llm_decide_unavailable')
    expect(result.checkpoints[0]?.failureReason).toBe('model unavailable')
  })

  /**
   * case formal-react-runtime-preserves-capability-conflict-envelope
   * - userInput: 把 item-1 移到 10 点
   * - expectedDecision: actor 暴露的 capability_route_conflict 原样进入最终失败 envelope
   * - mustNotHappen: 降级为通用 runtime_action_failed；继续调用 decider 或后续 action
   * - verification: failure.kind=act_failed 且 envelope.kind=capability_route_conflict
   */
  it('preserves a structured capability route conflict from the actor', async () => {
    const conflict = new CapabilityRouteConflictError({
      intent: 'move',
      capabilityIds: ['move-owner-a', 'move-owner-b'],
      recognizedSlots: [],
      missingSlots: ['distinct_capability_owner'],
      candidateEvidence: [],
      retrySuggestions: ['resolve capability ownership'],
    })
    const decide = vi.fn()
    const runtime = new FormalOrchestrationRuntime<TestAction>({
      actor: vi.fn(async () => { throw conflict }),
      decide,
    })

    const result = await runtime.run({ originalUserInput: '把 item-1 移到 10 点', plannerTask: initialPlan })

    expect(result.status).toBe('failed')
    expect(result.failure).toMatchObject({
      kind: 'act_failed',
      envelope: {
        kind: 'capability_route_conflict',
        capabilityIds: ['move-owner-a', 'move-owner-b'],
      },
    })
    expect(decide).not.toHaveBeenCalled()
  })

  /**
   * case formal-react-pending-mutation-pauses-before-next-action
   * - userInput: 删除 item-1，后续动作等待我确认后再继续
   * - expectedDecision: 第一个 action 返回正式 pending mutation 后立即进入 waiting_user checkpoint
   * - mustNotHappen: 执行同批后续 action；调用 LLM decider 替用户确认；把等待误报为失败或完成
   * - verification: actor 仅执行一次，status=waiting_user/run.status=waiting_confirm，checkpoint 保留 pending observation
   */
  it('pauses immediately when an action requires explicit user confirmation', async () => {
    const actor = vi.fn(async (action: TestAction) => ({
      type: 'atomic_execution' as const,
      summary: `pending:${action.id}`,
      noMutation: true,
      data: {
        pendingMutation: {
          owner: 'formal_playlist',
          workspaceKey: 'ws-a',
          mutationId: 'mutation-1',
          mutationPolicy: 'pending_only',
          intent: 'delete',
        },
      },
    }))
    const decide = vi.fn()
    const runtime = new FormalOrchestrationRuntime<TestAction>({ actor, decide })

    const result = await runtime.run({ originalUserInput: '删除 item-1，后续动作等待我确认后再继续', plannerTask: initialPlan })

    expect(result.status).toBe('waiting_user')
    expect(result.run.status).toBe('waiting_confirm')
    expect(actor).toHaveBeenCalledTimes(1)
    expect(decide).not.toHaveBeenCalled()
    expect(result.checkpoints[0]).toMatchObject({
      decision: { kind: 'waiting_user' },
      observations: [expect.objectContaining({ data: expect.objectContaining({ pendingMutation: expect.any(Object) }) })],
    })
  })

  /**
   * case formal-react-abort-stops
   * - userInput: 开始全天编排后用户停止
   * - expectedDecision: AbortSignal 中止后不执行下一动作并保留已完成 observation
   * - mustNotHappen: 中止后继续调用 actor 或 decider；自动恢复
   * - verification: status=cancelled，actor 只执行 a1，decider 未调用
   */
  it('post9-react-stop-keeps-last-checkpoint: stops at the current checkpoint when the shared deadline is aborted', async () => {
    const deadline = new AgentDeadline({ overallDeadlineMs: 60_000 })
    const actor = vi.fn(async (action: TestAction) => {
      if (action.id === 'a1') deadline.abort()
      return { type: 'formal_execution' as const, summary: `executed:${action.id}` }
    })
    const decide = vi.fn()
    const runtime = new FormalOrchestrationRuntime<TestAction>({ actor, decide })

    const result = await runtime.run({ originalUserInput: '全天编排', plannerTask: initialPlan, deadline })

    expect(actor).toHaveBeenCalledTimes(1)
    expect(decide).not.toHaveBeenCalled()
    expect(result.status).toBe('cancelled')
    expect(result.checkpoints[0]?.observations[0]?.summary).toBe('executed:a1')
    expect(result.checkpoints[0]?.actions).toEqual([{ id: 'a1' }])
  })

  /**
   * case formal-react-overall-deadline-aborts-non-llm-actor
   * - userInput: 执行全天编排，动作执行器在整体预算耗尽后仍未返回
   * - expectedDecision: 共享 deadline 自动 abort，当前动作停止等待并保留取消现场
   * - mustNotHappen: deadline 到期后继续调用 decide 或执行下一批动作
   * - verification: actor 收到 aborted signal，decide 未被调用，结果为 cancelled
   */
  it('aborts a non-LLM actor when the overall deadline expires', async () => {
    const deadline = new AgentDeadline({ overallDeadlineMs: 10 })
    const actor = vi.fn(async (_action: TestAction, context: { signal?: AbortSignal }) => {
      await new Promise<void>((resolve) => {
        if (context.signal?.aborted) return resolve()
        context.signal?.addEventListener('abort', () => resolve(), { once: true })
        setTimeout(resolve, 50)
      })
      return {
        type: 'atomic_execution' as const,
        summary: 'actor stopped by deadline',
        noMutation: true,
      }
    })
    const decide = vi.fn(async () => ({ kind: 'complete' as const, reason: 'should not run' }))
    const runtime = new FormalOrchestrationRuntime<TestAction>({ actor, decide })

    const result = await runtime.run({
      originalUserInput: '执行全天编排',
      plannerTask: {
        objective: '执行全天编排',
        nextActions: [{ id: 'deadline-action' }],
        maxTurns: 2,
        batchSize: 1,
        stopCondition: '完成全部动作',
      },
      deadline,
    })

    expect(actor).toHaveBeenCalledTimes(1)
    expect(decide).not.toHaveBeenCalled()
    expect(result.status).toBe('cancelled')
    expect(result.run.status).toBe('cancelled')
  })

  /**
   * case formal-react-checkpoint-sink-per-turn
   * - userInput: 补齐全天空窗并逐轮保存进度
   * - expectedDecision: 每轮 decide 后立即把 checkpoint 交给持久化 sink
   * - mustNotHappen: 仅在整轮结束后批量返回，导致停止或进程中断时丢失最后现场
   * - verification: onCheckpoint 按 turn=1/2 收到与最终结果一致的两个 checkpoint
   */
  it('publishes each checkpoint as soon as the turn is decided', async () => {
    const onCheckpoint = vi.fn()
    const runtime = new FormalOrchestrationRuntime<TestAction>({
      actor: vi.fn(async (action) => ({ type: 'formal_execution', summary: `executed:${action.id}` })),
      decide: vi.fn()
        .mockResolvedValueOnce({ kind: 'continue', nextActions: [{ id: 'a3' }], reason: 'continue' })
        .mockResolvedValueOnce({ kind: 'complete', reason: 'done' }),
    })

    const result = await runtime.run({
      originalUserInput: '补齐全天空窗并逐轮保存进度',
      plannerTask: initialPlan,
      onCheckpoint,
    })

    expect(onCheckpoint.mock.calls.map(([checkpoint]) => checkpoint.turn)).toEqual([1, 2])
    expect(onCheckpoint.mock.calls.map(([checkpoint]) => checkpoint.id)).toEqual(result.checkpoints.map((checkpoint) => checkpoint.id))
  })

  /**
   * case formal-react-runtime-compacts-decider-history
   * - userInput: 连续多轮补齐全天空窗
   * - expectedDecision: 每轮 decide 使用稳定压缩包，第四轮只保留前两轮最近 raw checkpoint
   * - mustNotHappen: 把全部历史 raw trace 继续送给模型；checkpoint 不记录压缩证据
   * - verification: 第四次 decide 的 recentTurns=2/3，第四个 checkpoint dropped.rawTurnCount=1
   */
  it('compacts prior checkpoint history before every decide call', async () => {
    const decide = vi.fn()
      .mockResolvedValueOnce({ kind: 'continue', nextActions: [{ id: 'a2' }], reason: 'turn-1' })
      .mockResolvedValueOnce({ kind: 'continue', nextActions: [{ id: 'a3' }], reason: 'turn-2' })
      .mockResolvedValueOnce({ kind: 'continue', nextActions: [{ id: 'a4' }], reason: 'turn-3' })
      .mockResolvedValueOnce({ kind: 'complete', reason: 'turn-4' })
    const runtime = new FormalOrchestrationRuntime<TestAction>({
      actor: vi.fn(async (action) => ({ type: 'formal_execution', summary: `executed:${action.id}` })),
      decide,
    })

    const result = await runtime.run({
      originalUserInput: '连续多轮补齐全天空窗',
      plannerTask: {
        objective: '连续多轮补齐全天空窗',
        maxTurns: 5,
        batchSize: 1,
        nextActions: [{ id: 'a1' }],
      },
    })

    expect(result.status).toBe('completed')
    expect(decide.mock.calls[3]?.[0].compactedContext.recentTurns.map((item: { turn: number }) => item.turn)).toEqual([2, 3])
    expect(result.checkpoints[3]?.contextCompaction).toMatchObject({
      before: { checkpointCount: 3 },
      after: { rawTurnCount: 2, summarizedTurnCount: 3 },
      dropped: { rawTurnCount: 1 },
    })
  })

  /**
   * case formal-react-runtime-resumes-half-batch-with-stable-run
   * - userInput: 网络中断后继续刚才的补排
   * - expectedDecision: 保持原 runId/observation，只执行半批次中尚未完成的 action
   * - mustNotHappen: 新建无关 run、重复执行 a2、丢失上一轮拒绝证据
   * - verification: actor 仅收到 a3，actionKey 属于 run-1/turn-2，decider 能看到历史 observation
   */
  it('post9-recovery-half-batch-does-not-replay: resumes a half batch without replaying completed actions', async () => {
    const priorCheckpoints = [{
      id: 'run-1:checkpoint:1:continue', runId: 'run-1', objective: '补齐晚间空窗', turn: 1,
      actions: [{ id: 'a1' }],
      observations: [{ id: 'o1', turn: 1, type: 'validation' as const, summary: '候选被拒绝', risk: '版权未知', createdAt: '2026-07-19T00:00:00.000Z' }],
      decision: { kind: 'continue' as const, nextActions: [{ id: 'a2' }, { id: 'a3' }], reason: '换候选' },
      failureReason: '版权未知', createdAt: '2026-07-19T00:00:01.000Z',
    }, {
      id: 'run-1:checkpoint:2:cancelled', runId: 'run-1', objective: '补齐晚间空窗', turn: 2,
      actions: [{ id: 'a2' }],
      observations: [{ id: 'o2', turn: 2, type: 'formal_execution' as const, summary: 'a2 已完成', createdAt: '2026-07-19T00:00:02.000Z' }],
      decision: { kind: 'cancelled' as const, reason: '网络中断' }, createdAt: '2026-07-19T00:00:03.000Z',
    }]
    const recovery = prepareFormalOrchestrationRecovery({
      sessionId: 'session-1', action: 'continue', requestedWorkspaceKey: 'ws-a', checkpointWorkspaceKey: 'ws-a',
      expectedPlaylistVersion: 1, actualPlaylistVersion: 1, checkpoints: priorCheckpoints,
    })
    const actor = vi.fn(async (action: TestAction, context: { actionKey: string }) => ({
      type: 'formal_execution' as const,
      summary: `executed:${action.id}`,
      data: { actionKey: context.actionKey },
    }))
    const decide = vi.fn(async () => ({ kind: 'complete' as const, reason: 'done' }))
    const runtime = new FormalOrchestrationRuntime<TestAction>({ actor, decide })

    const result = await runtime.run({
      originalUserInput: '网络中断后继续刚才的补排',
      plannerTask: { objective: '补齐晚间空窗', maxTurns: 3, batchSize: 2, nextActions: [] },
      resumeFrom: recovery.resumePlan,
    })

    expect(actor.mock.calls.map(([action]) => action.id)).toEqual(['a3'])
    expect(actor.mock.calls[0]?.[1].actionKey).toContain('run-1:action:2:1:')
    expect(decide.mock.calls[0]?.[0].run.observations.map((item: { summary: string }) => item.summary)).toEqual([
      '候选被拒绝', 'a2 已完成', 'executed:a3',
    ])
    expect(result.run.id).toBe('run-1')
    expect(result.status).toBe('completed')
  })
})
