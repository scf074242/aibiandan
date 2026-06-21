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
})
