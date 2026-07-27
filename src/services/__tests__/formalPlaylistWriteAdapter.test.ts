import { describe, expect, it, vi } from 'vitest'

import {
  FormalPlaylistWriteAdapter,
  type FormalPlaylistWriteContext,
} from '@/services/runtime/formalPlaylistWriteAdapter'
import {
  buildPreviewOnlyContext,
  buildPendingOnlyContext,
  buildFormalWriteContext,
} from '@/services/agent/mutationPolicy'
import type {
  RuntimeExecutePendingCommandInput,
  RuntimeExecutedResult,
} from '@/services/runtime/schedulingAgentRuntimeFacade'

const pendingInput = (overrides: Partial<RuntimeExecutePendingCommandInput> = {}): RuntimeExecutePendingCommandInput => ({
  pendingCommand: {
    command: { action: 'validate' } as never,
    summary: '执行播单校验',
    reasoning: '用户确认执行。',
    details: {
      source: 'test',
    },
  },
  scheduleDate: '2026-03-25',
  channelId: 'dragon',
  ...overrides,
})

const currentSnapshot = {
  version: 'formal_before',
  itemCount: 1,
  updatedAt: '2026-03-25T00:00:00.000Z',
  source: 'foreground' as const,
  items: [{
    id: 'item-1',
    programName: '看东方',
    programCode: 'news-1',
    startTime: '2026-03-25T09:00:00',
    endTime: '2026-03-25T09:30:00',
    duration: 1800,
    programType: 'news',
  }],
}

const executedResult = (overrides: Partial<RuntimeExecutedResult> = {}): RuntimeExecutedResult => ({
  success: true,
  command: { action: 'validate' } as never,
  message: '已执行。',
  summary: '执行播单校验',
  details: {
    source: 'delegate',
  },
  ...overrides,
})

const formalWriteContext = (workspaceKey = 'workspace-1') => ({
  workspaceKey,
  mutationContext: buildFormalWriteContext('msg-confirmed', workspaceKey, 'mutation-confirmed'),
})

const workspaceIdempotencyIsolationCase = {
  id: 'formal-write-idempotency-isolated-by-workspace',
  userInput: '在同一会话切换到另一张播单后确认写入',
  expectedDecision: '相同幂等键在不同 workspace 中分别执行，同一 workspace 内重试才复用',
  mustNotHappen: '不得回放上一张播单的正式写入结果',
  verification: 'delegate 在两个 workspace 各执行一次，第三次同 workspace 重试返回 reused',
} as const

describe('FormalPlaylistWriteAdapter', () => {
  it('delegates to the existing pending command executor and adds formal write metadata', async () => {
    const executePendingCommand = vi.fn(async () => executedResult())
    const adapter = new FormalPlaylistWriteAdapter({
      executePendingCommand,
      createRunId: () => 'formal-write-1',
    })

    const result = await adapter.execute(pendingInput({
      pendingId: 'pending-1',
      idempotencyKey: 'idem-1',
      expectedPlaylistVersion: 'v1',
    }), {
      ...formalWriteContext(),
      sessionId: 'session-1',
      actualPlaylistVersion: 'v1',
    })

    expect(executePendingCommand).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({
      success: true,
      message: '已执行。',
      details: {
        source: 'delegate',
        formalWrite: {
          boundary: 'formal-playlist-write-adapter',
          transport: 'agent-server',
          writeRunId: 'formal-write-1',
          status: 'applied',
          reused: false,
          sessionId: 'session-1',
          pendingId: 'pending-1',
          idempotencyKey: 'idem-1',
          expectedPlaylistVersion: 'v1',
          actualPlaylistVersion: 'v1',
        },
      },
    })
  })

  it('prepares the current server snapshot before delegating to the old executor', async () => {
    const callOrder: string[] = []
    const prepareSnapshotForExecution = vi.fn(async () => {
      callOrder.push('prepare')
    })
    const executePendingCommand = vi.fn(async () => {
      callOrder.push('delegate')
      return executedResult()
    })
    const adapter = new FormalPlaylistWriteAdapter({
      executePendingCommand,
      prepareSnapshotForExecution,
      createRunId: () => 'formal-write-1',
    })

    const result = await adapter.execute(pendingInput(), {
      ...formalWriteContext(),
      sessionId: 'session-1',
      currentSnapshot,
    })

    expect(result.success).toBe(true)
    expect(prepareSnapshotForExecution).toHaveBeenCalledWith(currentSnapshot)
    expect(callOrder).toEqual(['prepare', 'delegate'])
  })

  it('reuses an idempotent write result without executing the delegate twice', async () => {
    const executePendingCommand = vi.fn(async () => executedResult())
    const adapter = new FormalPlaylistWriteAdapter({
      executePendingCommand,
      createRunId: () => 'formal-write-1',
    })
    const input = pendingInput({ idempotencyKey: 'idem-1' })

    const first = await adapter.execute(input, { ...formalWriteContext(), sessionId: 'session-1' })
    const second = await adapter.execute(input, { ...formalWriteContext(), sessionId: 'session-1' })

    expect(executePendingCommand).toHaveBeenCalledTimes(1)
    expect(first.details?.formalWrite).toMatchObject({
      status: 'applied',
      reused: false,
    })
    expect(second.details?.formalWrite).toMatchObject({
      status: 'reused',
      reused: true,
      writeRunId: 'formal-write-1',
    })
  })

  /**
   * case formal-write-retry-does-not-cache-transient-failure
   * - userInput: 正式写入因网络中断失败后重试相同确认动作
   * - expectedDecision: 失败结果暴露但不占用幂等缓存，第二次真正再次调用执行器
   * - mustNotHappen: 把临时失败结果标记 reused，阻断用户重试
   * - verification: delegate 调用两次，第二次成功结果为 applied
   */
  it('does not cache a transient failure as an idempotent success', async () => {
    const executePendingCommand = vi
      .fn()
      .mockResolvedValueOnce(executedResult({ success: false, error: 'network_error', message: '网络中断。' }))
      .mockResolvedValueOnce(executedResult())
    const adapter = new FormalPlaylistWriteAdapter({
      executePendingCommand,
      createRunId: () => 'formal-write-retry',
    })
    const input = pendingInput({ idempotencyKey: 'idem-retry' })
    const context = { ...formalWriteContext(), sessionId: 'session-1' }

    const first = await adapter.execute(input, context)
    const second = await adapter.execute(input, context)

    expect(executePendingCommand).toHaveBeenCalledTimes(2)
    expect(first).toMatchObject({ success: false, error: 'network_error' })
    expect(first.details?.formalWrite).toMatchObject({ status: 'failed', reused: false })
    expect(second).toMatchObject({ success: true })
    expect(second.details?.formalWrite).toMatchObject({ status: 'applied', reused: false })
  })

  /**
   * case formal-write-concurrent-same-key-executes-once
   * - userInput: 同一确认请求因前端重发而并发到达
   * - expectedDecision: 两个请求共享同一次执行结果，正式写入只发生一次
   * - mustNotHappen: 两个并发请求同时调用旧 delegate 造成重复写入
   * - verification: delegate 一次调用，一个结果 applied，另一个 reused
   */
  it('coalesces concurrent writes with the same idempotency key', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const executePendingCommand = vi.fn(async () => {
      await gate
      return executedResult()
    })
    const adapter = new FormalPlaylistWriteAdapter({ executePendingCommand, createRunId: () => 'formal-write-concurrent' })
    const input = pendingInput({ idempotencyKey: 'idem-concurrent' })
    const context = { ...formalWriteContext(), sessionId: 'session-1' }
    const firstPromise = adapter.execute(input, context)
    const secondPromise = adapter.execute(input, context)
    release()
    const [first, second] = await Promise.all([firstPromise, secondPromise])

    expect(executePendingCommand).toHaveBeenCalledTimes(1)
    expect([first.details?.formalWrite?.status, second.details?.formalWrite?.status].sort()).toEqual(['applied', 'reused'])
  })

  /**
   * case formal-write-pending-id-is-default-idempotency-key
   * - userInput: 普通待确认操作只带 pendingId 重复提交
   * - expectedDecision: pendingId 作为稳定幂等身份，第二次复用成功结果
   * - mustNotHappen: 因前台未显式传 idempotencyKey 而重复写入
   * - verification: delegate 一次调用，metadata 暴露 pendingId 对应的幂等键
   */
  it('uses pendingId as the default idempotency key', async () => {
    const executePendingCommand = vi.fn(async () => executedResult())
    const adapter = new FormalPlaylistWriteAdapter({ executePendingCommand, createRunId: () => 'formal-write-pending-id' })
    const input = pendingInput({ pendingId: 'pending-stable-1' })
    const context = { ...formalWriteContext(), sessionId: 'session-1' }

    const first = await adapter.execute(input, context)
    const second = await adapter.execute(input, context)

    expect(executePendingCommand).toHaveBeenCalledTimes(1)
    expect(first.details?.formalWrite).toMatchObject({ idempotencyKey: 'pending-stable-1', status: 'applied' })
    expect(second.details?.formalWrite).toMatchObject({ idempotencyKey: 'pending-stable-1', status: 'reused' })
  })

  it(`${workspaceIdempotencyIsolationCase.id}: isolates idempotent results by workspace`, async () => {
    const executePendingCommand = vi.fn(async () => executedResult())
    const adapter = new FormalPlaylistWriteAdapter({
      executePendingCommand,
      createRunId: () => 'formal-write-1',
    })
    const input = pendingInput({ idempotencyKey: 'idem-shared' })

    const televisionResult = await adapter.execute(input, {
      ...formalWriteContext('television:channel-1'),
      sessionId: 'session-1',
      workspaceKey: 'television:channel-1',
    })
    const rotationResult = await adapter.execute(input, {
      ...formalWriteContext('rotation:playlist-1'),
      sessionId: 'session-1',
      workspaceKey: 'rotation:playlist-1',
    })
    const rotationRetry = await adapter.execute(input, {
      ...formalWriteContext('rotation:playlist-1'),
      sessionId: 'session-1',
      workspaceKey: 'rotation:playlist-1',
    })

    expect(workspaceIdempotencyIsolationCase).toMatchObject({
      userInput: expect.any(String),
      expectedDecision: expect.any(String),
      mustNotHappen: expect.any(String),
      verification: expect.any(String),
    })
    expect(executePendingCommand).toHaveBeenCalledTimes(2)
    expect(televisionResult.details?.formalWrite).toMatchObject({
      status: 'applied',
      reused: false,
      workspaceKey: 'television:channel-1',
    })
    expect(rotationResult.details?.formalWrite).toMatchObject({
      status: 'applied',
      reused: false,
      workspaceKey: 'rotation:playlist-1',
    })
    expect(rotationRetry.details?.formalWrite).toMatchObject({
      status: 'reused',
      reused: true,
      workspaceKey: 'rotation:playlist-1',
    })
  })

  it('blocks a formal write when the known playlist version no longer matches', async () => {
    const executePendingCommand = vi.fn(async () => executedResult())
    const prepareSnapshotForExecution = vi.fn()
    const adapter = new FormalPlaylistWriteAdapter({
      executePendingCommand,
      prepareSnapshotForExecution,
      createRunId: () => 'formal-write-1',
    })

    const result = await adapter.execute(pendingInput({
      expectedPlaylistVersion: 'v1',
    }), {
      ...formalWriteContext(),
      sessionId: 'session-1',
      actualPlaylistVersion: 'v2',
    })

    expect(executePendingCommand).not.toHaveBeenCalled()
    expect(prepareSnapshotForExecution).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      success: false,
      error: 'formal_playlist_version_conflict',
      details: {
        formalWrite: {
          status: 'blocked',
          expectedPlaylistVersion: 'v1',
          actualPlaylistVersion: 'v2',
        },
      },
    })
  })

  it('keeps old behavior open when the frontend has not started sending versions yet', async () => {
    const executePendingCommand = vi.fn(async () => executedResult())
    const adapter = new FormalPlaylistWriteAdapter({
      executePendingCommand,
      createRunId: () => 'formal-write-1',
    })

    const result = await adapter.execute(pendingInput(), { ...formalWriteContext(), sessionId: 'session-1' })

    expect(executePendingCommand).toHaveBeenCalledTimes(1)
    expect(result.success).toBe(true)
    expect(result.details?.formalWrite).toMatchObject({
      status: 'applied',
    })
  })

  it('returns a formal playlist patch when the delegated write changes the known snapshot', async () => {
    const executePendingCommand = vi.fn(async () => executedResult({
      data: {
        deletedItem: currentSnapshot.items[0],
      },
    }))
    const adapter = new FormalPlaylistWriteAdapter({
      executePendingCommand,
      createRunId: () => 'formal-write-1',
    })

    const result = await adapter.execute(pendingInput({
      pendingCommand: {
        command: { action: 'delete', data: { itemId: 'item-1' }, reasoning: '用户确认删除。' } as never,
        summary: '删除看东方',
        reasoning: '用户确认删除。',
      },
    }), {
      ...formalWriteContext(),
      sessionId: 'session-1',
      currentSnapshot,
    })

    expect(result.scheduleSnapshot).toMatchObject({
      itemCount: 0,
      items: [],
    })
    expect(result.playlistPatch).toMatchObject({
      type: 'formal_playlist_patch',
      previousVersion: 'formal_before',
      itemCount: 0,
      changedItemIds: ['item-1'],
    })
    expect(result.details?.formalWrite).toMatchObject({
      playlistPatch: {
        changedItemIds: ['item-1'],
      },
    })
  })

  it('can stop oversized batches before writing when a server batch limit is provided', async () => {
    const executePendingCommand = vi.fn(async () => executedResult())
    const adapter = new FormalPlaylistWriteAdapter({
      executePendingCommand,
      createRunId: () => 'formal-write-1',
    })

    const result = await adapter.execute(pendingInput({
      maxBatchCommands: 1,
      pendingCommand: {
        command: { action: 'delete', data: { itemId: 'item-1' }, reasoning: '批量删除。' } as never,
        commands: [
          { action: 'delete', data: { itemId: 'item-1' }, reasoning: '批量删除。' } as never,
          { action: 'delete', data: { itemId: 'item-2' }, reasoning: '批量删除。' } as never,
        ],
        summary: '批量删除',
        reasoning: '批量删除。',
      },
    }), { ...formalWriteContext(), sessionId: 'session-1' })

    expect(executePendingCommand).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      success: false,
      error: 'formal_playlist_batch_limit_exceeded',
      details: {
        formalWrite: {
          status: 'blocked',
          batch: {
            commandCount: 2,
            maxBatchCommands: 1,
            requiresContinuation: true,
          },
        },
      },
    })
  })

  it('formal-write-mutation-policy-required: blocks every unclassified formal write', async () => {
    const regressionCase = {
      id: 'formal-write-mutation-policy-required',
      userInput: '执行一条未携带 mutation policy 的正式播单写入',
      expectedDecision: '统一写入边界拒绝执行并返回 mutation_policy_required',
      mustNotHappen: '任何同类正式写入因调用路径未传 policy 而绕过门禁',
      verification: 'delegate 不被调用，formalWrite metadata 标记 blocked',
    } as const
    const executePendingCommand = vi.fn(async () => executedResult())
    const adapter = new FormalPlaylistWriteAdapter({
      executePendingCommand,
      createRunId: () => 'formal-write-policy-required',
    })

    const result = await adapter.execute(
      pendingInput(),
      { sessionId: 'session-1' } as unknown as FormalPlaylistWriteContext,
    )

    expect(executePendingCommand).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      success: false,
      error: 'mutation_policy_required',
      details: { formalWrite: { status: 'blocked' } },
    })
    expect(regressionCase).toMatchObject({
      expectedDecision: expect.any(String),
      mustNotHappen: expect.any(String),
      verification: expect.any(String),
    })
  })

  it('blocks a formal write when mutation policy is preview_only (D2 write barrier)', async () => {
    const executePendingCommand = vi.fn(async () => executedResult())
    const adapter = new FormalPlaylistWriteAdapter({
      executePendingCommand,
      createRunId: () => 'formal-write-1',
    })

    const result = await adapter.execute(pendingInput(), {
      sessionId: 'session-1',
      mutationContext: buildPreviewOnlyContext('msg-1', 'workspace-1', 'mutation-1'),
    })

    expect(executePendingCommand).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      success: false,
      error: 'preview_only_violation',
      message: '当前为预览模式，不能写入正式播单。',
      details: {
        mutationPolicy: 'preview_only',
        mutationId: 'mutation-1',
        formalWrite: {
          status: 'blocked',
          reused: false,
        },
      },
    })
  })

  it('blocks a formal write when mutation policy is pending_only (D2 write barrier)', async () => {
    const executePendingCommand = vi.fn(async () => executedResult())
    const adapter = new FormalPlaylistWriteAdapter({
      executePendingCommand,
      createRunId: () => 'formal-write-1',
    })

    const result = await adapter.execute(pendingInput(), {
      sessionId: 'session-1',
      mutationContext: buildPendingOnlyContext('msg-1', 'workspace-1', 'mutation-2'),
    })

    expect(executePendingCommand).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      success: false,
      error: 'pending_only_violation',
      message: '当前为待确认模式，不能写入正式播单。',
      details: {
        mutationPolicy: 'pending_only',
        mutationId: 'mutation-2',
        formalWrite: {
          status: 'blocked',
          reused: false,
        },
      },
    })
  })

  it('allows a formal write when mutation policy is formal_write (D2 write barrier)', async () => {
    const executePendingCommand = vi.fn(async () => executedResult())
    const adapter = new FormalPlaylistWriteAdapter({
      executePendingCommand,
      createRunId: () => 'formal-write-1',
    })

    const result = await adapter.execute(pendingInput(), {
      sessionId: 'session-1',
      mutationContext: buildFormalWriteContext('msg-1', 'workspace-1', 'mutation-3'),
    })

    expect(executePendingCommand).toHaveBeenCalledTimes(1)
    expect(result.success).toBe(true)
    expect(result.details?.formalWrite).toMatchObject({
      status: 'applied',
    })
  })
})
