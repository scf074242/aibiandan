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
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/api/agent/llm-config/status')) {
        return new Response(JSON.stringify({
          llm: { configured: true },
        }), { status: 200 })
      }
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
        pendingId: 'server-pending-1',
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
      'http://agent.local/api/agent/llm-config/status',
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'http://agent.local/api/agent/submit',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body)).input).not.toHaveProperty('foregroundContextPackage')
    expect(JSON.parse(String(fetchMock.mock.calls[2][1]?.body))).toMatchObject({
      sessionId: 'agent-session-1',
      input: {
        pendingId: 'server-pending-1',
        expectedPlaylistVersion: 'formal_frontend_v1',
        foregroundStateVersion: 'formal_frontend_v1',
      },
    })
    expect(JSON.parse(String(fetchMock.mock.calls[2][1]?.body)).input).not.toHaveProperty('pendingCommand')
    expect(JSON.parse(String(fetchMock.mock.calls[2][1]?.body)).input).not.toHaveProperty('currentSchedule')
    expect(storage.get('aibiandan_agent_session_id')).toBe('agent-session-1')
  })

  it('bridges an existing foreground LLM key to the server once when HTTP runtime is missing backend config', async () => {
    const storage = new Map<string, string>()
    storage.set('llm_config', JSON.stringify({
      baseURL: 'https://api.siliconflow.cn/v1',
      apiKey: 'sk-existing-foreground',
      model: 'deepseek-ai/DeepSeek-V4-Flash',
      temperature: 0.3,
      maxTokens: 8192,
      timeout: 60000,
    }))
    vi.stubGlobal('localStorage', {
      getItem: vi.fn((key: string) => storage.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        storage.set(key, value)
      }),
      removeItem: vi.fn((key: string) => {
        storage.delete(key)
      }),
    })
    vi.stubGlobal('sessionStorage', {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
    })

    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/api/agent/llm-config/status')) {
        return new Response(JSON.stringify({
          llm: { configured: false },
        }), { status: 200 })
      }
      if (url.endsWith('/api/agent/llm-config/import')) {
        return new Response(JSON.stringify({
          imported: true,
          llm: { configured: true },
        }), { status: 200 })
      }
      return new Response(JSON.stringify({
        sessionId: 'agent-session-bridge',
        decision: {
          kind: 'message',
          feedback: {
            content: '服务端已接管。',
            processType: 'planning',
            processTypeLabel: 'Agent Server',
          },
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
    })

    const importBody = JSON.parse(String(fetchMock.mock.calls[1][1]?.body))
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      'http://agent.local/api/agent/llm-config/status',
      'http://agent.local/api/agent/llm-config/import',
      'http://agent.local/api/agent/submit',
    ])
    expect(importBody.config).toMatchObject({
      baseURL: 'https://api.siliconflow.cn/v1',
      apiKey: 'sk-existing-foreground',
      model: 'deepseek-ai/DeepSeek-V4-Flash',
    })
  })
})
