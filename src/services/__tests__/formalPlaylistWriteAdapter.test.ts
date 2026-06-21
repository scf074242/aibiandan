import { describe, expect, it, vi } from 'vitest'

import { FormalPlaylistWriteAdapter } from '@/services/runtime/formalPlaylistWriteAdapter'
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
          boundary: 'agent-server',
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

  it('reuses an idempotent write result without executing the delegate twice', async () => {
    const executePendingCommand = vi.fn(async () => executedResult())
    const adapter = new FormalPlaylistWriteAdapter({
      executePendingCommand,
      createRunId: () => 'formal-write-1',
    })
    const input = pendingInput({ idempotencyKey: 'idem-1' })

    const first = await adapter.execute(input, { sessionId: 'session-1' })
    const second = await adapter.execute(input, { sessionId: 'session-1' })

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

  it('blocks a formal write when the known playlist version no longer matches', async () => {
    const executePendingCommand = vi.fn(async () => executedResult())
    const adapter = new FormalPlaylistWriteAdapter({
      executePendingCommand,
      createRunId: () => 'formal-write-1',
    })

    const result = await adapter.execute(pendingInput({
      expectedPlaylistVersion: 'v1',
    }), {
      sessionId: 'session-1',
      actualPlaylistVersion: 'v2',
    })

    expect(executePendingCommand).not.toHaveBeenCalled()
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

    const result = await adapter.execute(pendingInput(), { sessionId: 'session-1' })

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
    }), { sessionId: 'session-1' })

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
})
