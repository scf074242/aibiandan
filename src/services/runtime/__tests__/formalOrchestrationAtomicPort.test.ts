import { describe, expect, it, vi } from 'vitest'

import type { AgentCapability } from '@/services/agent/types'
import { FormalOrchestrationGrantAuthority } from '../formalOrchestrationGrant'
import { createFormalOrchestrationAtomicPort } from '../formalOrchestrationAtomicPort'

const createContext = () => ({
  channelId: 'dragon', date: '2026-07-18', playlistId: 'playlist-a', playlistType: 'tv',
  scheduleItems: [{
    id: 'item-1', programId: 'p1', programCode: 'NEWS001', programName: '早间新闻',
    startTime: '2026-07-18T09:00:00', endTime: '2026-07-18T09:30:00', duration: 1800,
    programType: 'news', sequence: 1,
  }],
  programCandidates: [{
    id: 'candidate-1', programId: 'p2', programCode: 'NEWS002', programName: '晚间新闻',
    channelId: 'dragon', duration: 1800, programType: 'news', instanceName: '晚间新闻第1期',
    materialStatus: 'ready', rightsStatus: 'ready',
  }],
  broadcastReadiness: [], historySchedules: [], lockedItemIds: [], blockedTimeRanges: [],
  bundle: {
    identity: { channelId: 'dragon', date: '2026-07-18', playlistId: 'playlist-a', playlistType: 'tv' },
    sources: {
      today: { source: 'runtime_schedule_reader', available: true, recordCount: 1 },
      candidates: { source: 'program_candidate_reader', available: true, recordCount: 1 },
      readiness: { source: 'readiness_reader', available: true, recordCount: 0 },
      history: { source: 'history_schedule_reader', available: true, recordCount: 0 },
      constraints: { source: 'constraint_reader', available: true, recordCount: 0 },
      policy: { source: 'schedule_state', available: true, recordCount: 1 },
    },
    today: { scheduleItems: [], itemCount: 1 }, candidates: { programCandidates: [], totalCount: 1 },
    readiness: { records: [], totalCount: 0 }, history: { schedules: [], totalCount: 0, todayOverridesHistory: true },
    constraints: { lockedItemIds: [], blockedTimeRanges: [] },
    policy: {
      playlistType: 'tv', tvStrictFill: true, rotationCandidateWritesRequireConfirmation: true,
      sensitiveWriteIntentsRequireConfirmation: ['delete', 'batch_delete'],
    },
  },
})

const createPort = (
  commitScheduleItems = vi.fn(),
  capabilityRegistry?: { resolveAll: (input: any) => AgentCapability[] },
  authorization?: ReturnType<FormalOrchestrationGrantAuthority['issue']>,
) => {
  const loadContext = vi.fn(async () => createContext() as any)
  const ports = createFormalOrchestrationAtomicPort({
    workspaceKey: 'ws-a',
    dataGateway: { loadContext, commitScheduleItems },
    baseInput: { userInput: '处理当前播单', channelId: 'dragon', date: '2026-07-18', playlistId: 'playlist-a', conversationId: 'session-a' },
    candidateJudge: {} as any,
    capabilityRegistry,
    authorization,
  })
  return { atomicCommand: ports.atomicCommand!, loadContext, commitScheduleItems }
}

const portContext = { workspaceKey: 'ws-a', runId: 'run-1', turn: 1, actionKey: 'run-1:action:1:0:move-a' }

describe('formal orchestration atomic port', () => {
  /**
   * case formal-react-atomic-query-preview-only
   * - userInput: 查询晚间新闻候选
   * - expectedDecision: 复用 AtomicCommandCapability 返回只读 query observation
   * - mustNotHappen: 调用正式 commit；把 preview_only 改为其他 policy
   * - verification: queryResult 含候选且 commit 为 0 次
   */
  it('executes query through the atomic capability without mutation', async () => {
    const { atomicCommand, commitScheduleItems } = createPort()
    const result = await atomicCommand({
      type: 'atomic_command', intent: 'query', keyword: '晚间新闻', mutationPolicy: 'preview_only',
    }, portContext)

    expect(result).toMatchObject({ noMutation: true, mutationPolicy: 'preview_only', workspaceKey: 'ws-a' })
    expect(result.data?.decision).toMatchObject({ queryResult: { candidates: [expect.objectContaining({ id: 'candidate-1' })] } })
    expect(commitScheduleItems).not.toHaveBeenCalled()
  })

  /**
   * case formal-react-atomic-pending-captures-validated-preview
   * - userInput: 将 item-1 移到 10 点，先待确认
   * - expectedDecision: 原子校验通过后在 commit 边界生成 pending mutation
   * - mustNotHappen: 写入真实 gateway；缺失 owner/workspaceKey/mutationId/mutationPolicy
   * - verification: pendingMutation 字段完整且 commit 为 0 次
   */
  it('captures a validated pending_only mutation before formal commit', async () => {
    const { atomicCommand, commitScheduleItems } = createPort()
    const result = await atomicCommand({
      type: 'atomic_command', intent: 'move', targetItemId: 'item-1', newStartTime: '10:00:00', mutationPolicy: 'pending_only',
    }, portContext)

    expect(result).toMatchObject({ noMutation: true, mutationPolicy: 'pending_only' })
    expect(result.data?.pendingMutation).toMatchObject({
      owner: 'formal_playlist', workspaceKey: 'ws-a', mutationId: portContext.actionKey, mutationPolicy: 'pending_only', intent: 'move',
    })
    expect(commitScheduleItems).not.toHaveBeenCalled()
  })

  /**
   * case formal-react-sensitive-pending-preserves-state-machine-identity
   * - userInput: 删除 item-1，等待用户确认
   * - expectedDecision: 删除门禁返回 needs_confirmation 时仍形成完整 formal pending mutation
   * - mustNotHappen: 因 capability 未调用 commit 而丢失 owner/workspaceKey/mutationId/mutationPolicy；直接删除
   * - verification: pendingMutation 身份字段完整，原始 pendingTask 可续接，commit 为 0 次
   */
  it('wraps a policy-gated pending task with formal pending mutation identity', async () => {
    const { atomicCommand, commitScheduleItems } = createPort()
    const result = await atomicCommand({
      type: 'atomic_command', intent: 'delete', targetItemId: 'item-1', mutationPolicy: 'pending_only',
    }, portContext)

    expect(result).toMatchObject({ noMutation: true, mutationPolicy: 'pending_only' })
    expect(result.data?.pendingMutation).toMatchObject({
      owner: 'formal_playlist',
      workspaceKey: 'ws-a',
      mutationId: portContext.actionKey,
      mutationPolicy: 'pending_only',
      intent: 'delete',
      pendingTask: expect.objectContaining({ intent: 'delete', phase: 'needs_confirmation' }),
    })
    expect(commitScheduleItems).not.toHaveBeenCalled()
  })

  /**
   * case formal-react-atomic-formal-write-adapter
   * - userInput: 将 item-1 移到 10 点并正式写入
   * - expectedDecision: 原子校验后的 commit 必须经过 FormalPlaylistWriteAdapter
   * - mustNotHappen: 丢失 workspaceKey/formal_write；绕过幂等与写入 metadata
   * - verification: observation 包含统一 write adapter boundary/status=applied，gateway 仅调用一次
   */
  it('routes formal_write through FormalPlaylistWriteAdapter', async () => {
    const commitScheduleItems = vi.fn(async (input: any) => ({
      committed: true, operationId: 'op-1', affectedItemIds: ['item-1'], scheduleItems: input.items,
    }))
    const { atomicCommand } = createPort(commitScheduleItems)
    const result = await atomicCommand({
      type: 'atomic_command', intent: 'move', targetItemId: 'item-1', newStartTime: '10:00:00', mutationPolicy: 'formal_write',
    }, portContext)

    expect(result).toMatchObject({ noMutation: false, mutationPolicy: 'formal_write' })
    expect(result.data?.formalWrite).toMatchObject({
      boundary: 'formal-playlist-write-adapter', transport: 'agent-server', workspaceKey: 'ws-a', status: 'applied', reused: false,
    })
    expect(commitScheduleItems).toHaveBeenCalledTimes(1)
  })

  /**
   * case post9-rotation-compression-staged-react
   * - userInput: 已确认整表压缩后删除低热度节目
   * - expectedDecision: 有效整表 grant 作用域内的 delete 不再逐项确认，经 capability 与 WriteAdapter 正式写入
   * - mustNotHappen: grant 在 atomic port 丢失；重新生成 pending；绕过 capability 或 WriteAdapter
   * - verification: delete formal_write 返回 applied，gateway 只提交一次且没有 pendingMutation
   */
  it('post9-rotation-compression-staged-react: applies a granted delete without duplicate item approval', async () => {
    const authorization = new FormalOrchestrationGrantAuthority().issue({
      sessionId: 'session-a',
      sourcePendingId: 'compression-confirmation',
      workspaceKey: 'ws-a',
      initialPlaylistVersion: 'formal-v1',
      existingItemCount: 1,
      mode: 'full_generate',
    })
    const commitScheduleItems = vi.fn(async (input: any) => ({
      committed: true,
      operationId: 'delete-op',
      affectedItemIds: ['item-1'],
      scheduleItems: input.items,
    }))
    const { atomicCommand } = createPort(commitScheduleItems, undefined, authorization)

    const result = await atomicCommand({
      type: 'atomic_command',
      intent: 'delete',
      targetItemId: 'item-1',
      mutationPolicy: 'formal_write',
    }, portContext)

    expect(result).toMatchObject({
      noMutation: false,
      mutationPolicy: 'formal_write',
      data: {
        pendingMutation: undefined,
        formalWrite: { boundary: 'formal-playlist-write-adapter', status: 'applied' },
      },
    })
    expect(commitScheduleItems).toHaveBeenCalledTimes(1)
  })

  /**
   * case formal-react-atomic-action-routes-through-capability-registry
   * - userInput: 查询晚间新闻候选
   * - expectedDecision: 正式 ReAct 原子动作由 CapabilityRegistry 返回的唯一 owner 执行
   * - mustNotHappen: 直接实例化 AtomicCommandCapability；忽略 registry owner 后走旧路径
   * - verification: resolveAll 与唯一 owner 各调用一次，结果来自该 owner
   */
  it('routes every ReAct atomic action through the injected capability registry', async () => {
    const owner: AgentCapability = {
      id: 'query-owner',
      canHandle: vi.fn(() => true),
      handle: vi.fn(async (input) => ({
        status: 'executed',
        input,
        decision: { queryResult: { candidates: [], totalCount: 0, keyword: '晚间新闻' } },
        explanation: 'registry owner handled query',
        trace: [],
      })),
    }
    const capabilityRegistry = { resolveAll: vi.fn(() => [owner]) }
    const { atomicCommand } = createPort(vi.fn(), capabilityRegistry)

    const result = await atomicCommand({
      type: 'atomic_command', intent: 'query', keyword: '晚间新闻', mutationPolicy: 'preview_only',
    }, portContext)

    expect(capabilityRegistry.resolveAll).toHaveBeenCalledTimes(1)
    expect(owner.handle).toHaveBeenCalledTimes(1)
    expect(result.summary).toBe('registry owner handled query')
  })

  /**
   * case formal-react-atomic-route-conflict-stops-before-execution
   * - userInput: 把 item-1 移到 10 点
   * - expectedDecision: 多个 capability owner 同时命中时暴露 capability_route_conflict
   * - mustNotHappen: 任意选择一个 owner 继续执行；触发正式写入
   * - verification: 两个 owner 均未执行，错误保留结构化 conflict envelope
   */
  it('blocks a ReAct atomic action when capability routing is ambiguous', async () => {
    const firstHandle = vi.fn()
    const secondHandle = vi.fn()
    const capabilityRegistry = {
      resolveAll: vi.fn(() => [
        { id: 'move-owner-a', canHandle: () => true, handle: firstHandle },
        { id: 'move-owner-b', canHandle: () => true, handle: secondHandle },
      ] as AgentCapability[]),
    }
    const commitScheduleItems = vi.fn()
    const { atomicCommand } = createPort(commitScheduleItems, capabilityRegistry)

    const failure = await atomicCommand({
      type: 'atomic_command', intent: 'move', targetItemId: 'item-1', newStartTime: '10:00:00', mutationPolicy: 'formal_write',
    }, portContext).catch((error) => error)

    expect(failure).toMatchObject({
      kind: 'capability_route_conflict',
      envelope: {
        kind: 'capability_route_conflict',
        capabilityIds: ['move-owner-a', 'move-owner-b'],
      },
    })
    expect(firstHandle).not.toHaveBeenCalled()
    expect(secondHandle).not.toHaveBeenCalled()
    expect(commitScheduleItems).not.toHaveBeenCalled()
  })
})
