import { describe, expect, it, vi } from 'vitest'
import { AgentPlanner } from '@/services/llm/agentPlanner'

describe('AgentPlanner streaming progress', () => {
  it('emits first-token and structured events without exposing partial JSON as an action', async () => {
    const chat = vi.fn(async (_messages: unknown, options: { onToken?: (delta: string, meta: { index: number; receivedChars: number; elapsedMs: number; firstTokenLatencyMs?: number }) => void }) => {
      options.onToken?.('{"actions":', { index: 0, receivedChars: 11, elapsedMs: 3, firstTokenLatencyMs: 3 })
      options.onToken?.('[]}', { index: 1, receivedChars: 14, elapsedMs: 5, firstTokenLatencyMs: 3 })
      return { content: '{"actions":[]}' }
    })
    const events: string[] = []
    const planner = new AgentPlanner({ chat } as never)

    const result = await planner.plan({
      scheduleState: { channelId: 'dragon', date: '2026-03-25', playlistType: 'tv', isEmpty: true, itemCount: 0 } as never,
      userInput: '检查当前播单',
      currentSchedule: [],
    }, undefined, (event) => events.push(event.kind))

    expect(result.actions).toEqual([])
    expect(events).toEqual(['first_token', 'token_delta', 'structured_complete'])
  })
})
