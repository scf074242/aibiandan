import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  getAgentRuntimeClient,
  HttpAgentRuntimeClient,
  setAgentRuntimeClientForTests,
  type AgentRuntimeClient,
} from '@/services/runtime/agentRuntimeClient'

describe('AgentRuntimeClient migration boundary', () => {
  afterEach(() => {
    setAgentRuntimeClientForTests(null)
    vi.unstubAllGlobals()
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

  it('keeps a server session across HTTP runtime calls', async () => {
    const storage = new Map<string, string>()
    vi.stubGlobal('sessionStorage', {
      getItem: vi.fn((key: string) => storage.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        storage.set(key, value)
      }),
    })
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { sessionId?: string | null }
      if (!body.sessionId) {
        return new Response(JSON.stringify({
          sessionId: 'agent-session-1',
          decision: {
            kind: 'message',
            feedback: {
              content: '服务端已接管上下文。',
              processType: 'planning',
              processTypeLabel: 'Agent Server',
            },
          },
        }), { status: 200 })
      }
      return new Response(JSON.stringify({
        sessionId: body.sessionId,
        result: {
          success: true,
          command: { action: 'validate' } as never,
          message: '已执行。',
        },
      }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const client = new HttpAgentRuntimeClient('http://agent.local')
    await client.submitInstruction({
      scheduleState: {
        channelId: 'rotation',
        channelName: '轮播单',
        date: '2026-03-25',
        isEmpty: true,
        itemCount: 0,
        gapCount: 0,
        hasSelectedTimeRange: false,
        playlistType: 'rotation',
      },
      userInput: '查询当前播单',
      currentSchedule: [],
      foregroundContextPackage: { latestUserInput: '前台不应上传这个上下文包' } as never,
    })
    await client.executePendingCommand({
      pendingCommand: {
        command: { action: 'validate' } as never,
        summary: '执行校验',
        reasoning: '用户确认执行。',
      },
      scheduleDate: '2026-03-25',
      channelId: 'rotation',
      currentSchedule: [{
        id: 'item-1',
        programName: '看东方',
        programCode: 'news-1',
        startTime: '2026-03-25T09:00:00',
        endTime: '2026-03-25T09:30:00',
        duration: 1800,
        programType: 'news',
      }],
      expectedPlaylistVersion: 'formal_frontend_v1',
      foregroundStateVersion: 'formal_frontend_v1',
    })

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'http://agent.local/api/agent/submit',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).input).not.toHaveProperty('foregroundContextPackage')
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toMatchObject({
      sessionId: 'agent-session-1',
      input: {
        expectedPlaylistVersion: 'formal_frontend_v1',
        foregroundStateVersion: 'formal_frontend_v1',
        currentSchedule: [{
          id: 'item-1',
          programName: '看东方',
        }],
      },
    })
    expect(storage.get('aibiandan_agent_session_id')).toBe('agent-session-1')
  })
})
