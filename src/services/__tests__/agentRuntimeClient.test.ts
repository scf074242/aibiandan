import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  getAgentRuntimeClient,
  setAgentRuntimeClientForTests,
  type AgentRuntimeClient,
} from '@/services/runtime/agentRuntimeClient'

describe('AgentRuntimeClient migration boundary', () => {
  afterEach(() => {
    setAgentRuntimeClientForTests(null)
  })

  it('exposes the foreground runtime through a replaceable client interface', async () => {
    const client: AgentRuntimeClient = {
      submitInstruction: vi.fn(async () => ({
        kind: 'message',
        feedback: {
          content: '已进入服务端迁移边界。',
          processType: 'general',
          processTypeLabel: 'Agent Runtime',
        },
      })),
      executePendingCommand: vi.fn(),
      resolvePendingTargetSelection: vi.fn(),
      resolvePendingInsertRecommendation: vi.fn(),
    }
    setAgentRuntimeClientForTests(client)

    const resolved = getAgentRuntimeClient()
    expect(resolved).toBe(client)
    await expect(resolved.submitInstruction({
      scheduleState: {
        channelId: 'dragon',
        channelName: '东方卫视',
        date: '2026-03-25',
        isEmpty: true,
        itemCount: 0,
        gapCount: 0,
        hasSelectedTimeRange: false,
        playlistType: 'tv',
      },
      userInput: '查询当前播单',
      currentSchedule: [],
    })).resolves.toMatchObject({
      kind: 'message',
      feedback: {
        processTypeLabel: 'Agent Runtime',
      },
    })
    expect(client.submitInstruction).toHaveBeenCalledTimes(1)
  })
})
