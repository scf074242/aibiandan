import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  getAgentRuntimeClient,
  HttpAgentRuntimeClient,
  LocalAgentRuntimeClient,
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

  it('http-agent-client-stop-active-instruction: asks the server to abort the active request', async () => {
    const testCase = {
      id: 'http-agent-client-stop-active-instruction',
      userInput: '停止当前请求',
      expectedDecision: '使用当前 sessionId 和 workspaceKey 调用服务端 instruction stop 端点',
      mustNotHappen: '只关闭浏览器请求而未通知服务端中断 LLM',
      verification: 'POST 路径包含 sessionId，body 携带 workspaceKey',
    }
    vi.stubGlobal('sessionStorage', {
      getItem: vi.fn(() => 'agent-session-stop-1'),
      setItem: vi.fn(),
    })
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      stopped: true,
      reason: 'stopped',
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const client = new HttpAgentRuntimeClient('http://agent.local')
    await expect(client.cancelActiveInstruction('workspace-tv-1')).resolves.toEqual({
      stopped: true,
      reason: 'stopped',
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'http://agent.local/api/agent/sessions/agent-session-stop-1/instruction/stop',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ workspaceKey: 'workspace-tv-1' }),
      }),
    )
    expect(testCase).toMatchObject({
      expectedDecision: expect.any(String),
      mustNotHappen: expect.any(String),
      verification: expect.any(String),
    })
  })
})

describe('LocalAgentRuntimeClient formal write boundary', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('local-pending-write-uses-formal-boundary', async () => {
    const testCase = {
      id: 'local-pending-write-uses-formal-boundary',
      userInput: '确认删除当前选中的节目',
      expectedDecision: '本地运行模式也必须携带可信 workspace 并经过 FormalPlaylistWriteAdapter',
      mustNotHappen: 'LocalAgentRuntimeClient 直接调用 facade 写入正式播单',
      verification: '执行结果包含 formalWrite boundary 与 applied 状态',
    }
    const client = new LocalAgentRuntimeClient()
    const runtime = (client as unknown as {
      runtime: {
        submitInstruction: (input: unknown) => Promise<unknown>
        executePendingCommand: (input: unknown) => Promise<unknown>
      }
    }).runtime
    vi.spyOn(runtime, 'submitInstruction').mockResolvedValue({
      kind: 'message',
      feedback: { content: 'ready', processType: 'general', processTypeLabel: 'Agent' },
    })
    const executeSpy = vi.spyOn(runtime, 'executePendingCommand').mockImplementation(async (input: any) => ({
      success: true,
      command: input.pendingCommand.command,
      message: '已执行',
      summary: input.pendingCommand.summary,
    }))
    await client.submitInstruction({
      scheduleState: {
        playlistId: 'tv-playlist-1', playlistType: 'tv', channelId: 'dragon', channelName: '东方卫视',
        date: '2026-07-21', isEmpty: false, itemCount: 1, gapCount: 0, hasSelectedTimeRange: false,
      },
      userInput: testCase.userInput,
      currentSchedule: [],
    })
    const result = await client.executePendingCommand({
      workspaceKey: 'tv:tv-playlist-1',
      pendingCommand: {
        pendingId: 'pending-delete-1',
        command: { action: 'delete', target: { itemId: 'item-1' } } as never,
        summary: '删除节目',
        reasoning: '用户已经显式确认',
      },
      scheduleDate: '2026-07-21',
      channelId: 'dragon',
      currentSchedule: [],
    })

    expect(testCase).toMatchObject({ expectedDecision: expect.any(String), mustNotHappen: expect.any(String), verification: expect.any(String) })
    expect(executeSpy).toHaveBeenCalledTimes(1)
    expect(result.details?.formalWrite).toMatchObject({
      boundary: 'formal-playlist-write-adapter',
      transport: 'local',
      status: 'applied',
    })
  })

  it('formal-write-workspace-missing-is-blocked', async () => {
    const testCase = {
      id: 'formal-write-workspace-missing-is-blocked',
      userInput: '确认执行',
      expectedDecision: '缺少或跨 workspace 的本地正式写入必须在 mutation 前阻断',
      mustNotHappen: '为兼容本地模式伪造 workspaceKey 后继续写入',
      verification: '返回 formal_write_workspace_missing 且 delegate 未执行',
    }
    const client = new LocalAgentRuntimeClient()
    const runtime = (client as unknown as { runtime: { executePendingCommand: (input: unknown) => Promise<unknown> } }).runtime
    const executeSpy = vi.spyOn(runtime, 'executePendingCommand')
    const result = await client.executePendingCommand({
      pendingCommand: {
        pendingId: 'pending-without-workspace',
        command: { action: 'delete', target: { itemId: 'item-1' } } as never,
        summary: '删除节目',
        reasoning: '缺少工作区上下文',
      },
      scheduleDate: '2026-07-21',
      channelId: 'dragon',
      currentSchedule: [],
    })

    expect(testCase).toMatchObject({ expectedDecision: expect.any(String), mustNotHappen: expect.any(String), verification: expect.any(String) })
    expect(result).toMatchObject({ success: false, error: 'formal_write_workspace_missing' })
    expect(executeSpy).not.toHaveBeenCalled()
  })

  /**
   * case local-formal-rebuild-grant-survives-recoverable-failure
   * - userInput: 确认整批重编后模型暂时失败
   * - expectedDecision: Local 边界签发 Grant，只返回 grantId；失败时保留任务与 Grant 供显式重试
   * - mustNotHappen: 暴露完整 Grant；把 failed 当完成并消费授权；清空恢复上下文
   * - verification: decision 仅含 grantId，failed 后 activeReactContext 仍存在
   */
  it('local-formal-rebuild-grant-survives-recoverable-failure', async () => {
    const client = new LocalAgentRuntimeClient()
    const runtime = (client as unknown as {
      runtime: {
        submitInstruction: (input: unknown) => Promise<unknown>
        startReactOrchestration: (request: unknown, input: unknown) => Promise<unknown>
      }
      activeReactContext: unknown
    }).runtime
    vi.spyOn(runtime, 'submitInstruction').mockResolvedValue({
      kind: 'orchestration',
      feedback: { content: '开始整批重编', processType: 'planning', processTypeLabel: '任务规划' },
      orchestrationRequest: {
        userInput: '确认整批重编', mode: 'full_generate', reasoning: '用户已确认',
        authorizationRequest: {
          sourcePendingId: 'pending-local-rebuild', workspaceKey: 'rotation:rotation-1',
          mode: 'full_generate', existingItemCount: 1,
        },
      },
    } as any)
    vi.spyOn(runtime, 'startReactOrchestration').mockResolvedValue({
      status: 'failed', failure: { message: 'LLM 暂时不可用', checkpointCount: 0 },
    } as any)
    const scheduleItem = {
      id: 'item-1', programName: '看东方', programCode: 'news-1',
      startTime: '2026-07-21T09:00:00', endTime: '2026-07-21T09:30:00', duration: 1800, programType: 'news',
    }
    const input = {
      scheduleState: {
        playlistId: 'rotation-1', playlistType: 'rotation' as const, channelId: 'rotation', channelName: '轮播单',
        date: '2026-07-21', isEmpty: false, itemCount: 1, gapCount: 0, hasSelectedTimeRange: false,
      },
      userInput: '确认整批重编', currentSchedule: [scheduleItem],
      pendingAtomicContext: {
        pendingId: 'pending-local-rebuild', action: null, phase: 'formal_rebuild_confirmation' as const,
        summary: '待确认整批重编', reasoning: '已有节目', originalUserInput: '整批重编',
        collectedUserInput: '整批重编', slots: {}, missingFields: ['selection' as const],
        followUpQuestion: '确认吗', attemptCount: 0,
        formalRebuildConfirmation: {
          actionKind: 'formal_orchestration' as const, mode: 'full_generate' as const,
          existingItemCount: 1, playlistType: 'rotation' as const, userInput: '整批重编',
        },
        createdAt: '2026-07-21T00:00:00.000Z', updatedAt: '2026-07-21T00:00:00.000Z',
      },
    }

    const decision = await client.submitInstruction(input)
    expect(decision.kind).toBe('orchestration')
    if (decision.kind !== 'orchestration') throw new Error('expected orchestration decision')
    expect(decision.orchestrationRequest.authorizationGrantId).toMatch(/^formal_rebuild_grant_/)
    expect(decision.orchestrationRequest.authorizationRequest).toBeUndefined()
    expect(decision.orchestrationRequest.resolvedAuthorization).toBeUndefined()

    await expect(client.startReactOrchestration(decision.orchestrationRequest, input)).resolves.toMatchObject({ status: 'failed' })
    expect((client as unknown as { activeReactContext: unknown }).activeReactContext).not.toBeNull()
  })
})

/**
 * Mock EventSource，用于测试 SSE 流式推送。
 * 构造时 queueMicrotask dispatch ready，模拟后端 subscribeSessionEvents 注册后立即推 ready。
 * dispatch/triggerError 供测试代码同步触发事件，便于精确断言。
 */
class MockEventSource {
  static lastInstance: MockEventSource | null = null
  url: string
  private readonly listeners = new Map<string, Set<(event: { data: string }) => void>>()
  onerror: (() => void) | null = null
  closeCalls = 0

  constructor(url: string) {
    this.url = url
    MockEventSource.lastInstance = this
    queueMicrotask(() => {
      this.dispatch('ready', { ok: true, time: new Date().toISOString() })
    })
  }

  addEventListener(type: string, listener: (event: { data: string }) => void): void {
    const set = this.listeners.get(type) ?? new Set()
    set.add(listener)
    this.listeners.set(type, set)
  }

  removeEventListener(type: string, listener: (event: { data: string }) => void): void {
    this.listeners.get(type)?.delete(listener)
  }

  close(): void {
    this.closeCalls++
  }

  /** 测试辅助：触发指定类型监听器，data 自动 JSON.stringify */
  dispatch(type: string, data: unknown): void {
    const payload = typeof data === 'string' ? data : JSON.stringify(data)
    this.listeners.get(type)?.forEach((l) => l({ data: payload } as MessageEvent))
  }

  /** 测试辅助：触发 onerror 回调 */
  triggerError(): void {
    this.onerror?.()
  }
}

describe('HttpAgentRuntimeClient SSE streaming', () => {
  const baseScheduleState = {
    channelId: 'rotation',
    channelName: '轮播单',
    date: '2026-03-25',
    isEmpty: true,
    itemCount: 0,
    gapCount: 0,
    hasSelectedTimeRange: false,
    playlistType: 'rotation' as const,
  }

  afterEach(() => {
    vi.unstubAllGlobals()
    MockEventSource.lastInstance = null
  })

  /**
   * 辅助：搭建带预置 sessionId + EventSource mock + 可控 POST 的测试环境。
   * 预置 sessionId 跳过 ensureServerSessionId 的 POST /api/agent/sessions 调用，
   * 让 fetchMock 只处理 llm-config/status 和 submit。
   * postPromise 由测试代码通过 resolvePost 手动 resolve，便于在 POST 飞行期间 dispatch SSE 事件。
   */
  const setupStreamingTest = () => {
    const storage = new Map<string, string>([['aibiandan_agent_session_id', 'sess-existing']])
    vi.stubGlobal('sessionStorage', {
      getItem: vi.fn((key: string) => storage.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => storage.set(key, value)),
    })
    // node 环境无 window/EventSource；stubGlobal 让源代码的 typeof 检查通过
    vi.stubGlobal('window', {})
    vi.stubGlobal('EventSource', MockEventSource)

    const progressCalls: string[] = []
    let resolvePost!: (response: Response) => void
    const postPromise = new Promise<Response>((resolve) => { resolvePost = resolve })
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/api/agent/llm-config/status')) {
        return new Response(JSON.stringify({ llm: { configured: true } }), { status: 200 })
      }
      if (url.endsWith('/api/agent/submit')) {
        return postPromise
      }
      return new Response('{}', { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const client = new HttpAgentRuntimeClient('http://agent.local')
    const submitPromise = client.submitInstruction({
      scheduleState: baseScheduleState,
      userInput: '在10点插入看东方',
      currentSchedule: [],
      onProgress: (event) => progressCalls.push(event.content),
    })
    return { submitPromise, resolvePost, progressCalls, fetchMock }
  }

  /** 辅助：等待 POST /api/agent/submit 被调用（意味着 SSE ready 已触发，POST 已发出） */
  const waitForSubmitPosted = (fetchMock: ReturnType<typeof vi.fn>) =>
    vi.waitFor(() => {
      if (!fetchMock.mock.calls.some((c) => String(c[0]).endsWith('/api/agent/submit'))) {
        throw new Error('submit not posted yet')
      }
    })

  it('filters stale progress events from previous round using submitStartTime timestamp', async () => {
    const { submitPromise, resolvePost, progressCalls, fetchMock } = setupStreamingTest()
    await waitForSubmitPosted(fetchMock)
    const sse = MockEventSource.lastInstance!

    // 上一轮残留事件：createdAt 比 submitStartTime 早 2s，应被时间戳过滤掉
    sse.dispatch('progress', {
      id: 'evt-stale',
      createdAt: new Date(Date.now() - 2000).toISOString(),
      type: 'progress',
      summary: 'stale',
      data: { progressId: 'evt-stale', content: 'stale-event', processType: 'general', processTypeLabel: 'old' },
    })
    // 本轮事件：createdAt 为当前时间，应被处理
    sse.dispatch('progress', {
      id: 'evt-fresh',
      createdAt: new Date().toISOString(),
      type: 'progress',
      summary: 'fresh',
      data: { progressId: 'evt-fresh', content: 'fresh-event', processType: 'general', processTypeLabel: 'new' },
    })

    // stale 被时间戳过滤，只有 fresh 进入 onProgress
    expect(progressCalls).toEqual(['fresh-event'])

    resolvePost(new Response(JSON.stringify({
      sessionId: 'sess-existing',
      decision: { kind: 'message', feedback: { content: 'ok', processType: 'general', processTypeLabel: 'Agent' } },
      progressEvents: [],
    }), { status: 200 }))
    await submitPromise
  })

  it('dedupes progress events between SSE and envelope fallback after SSE error', async () => {
    const { submitPromise, resolvePost, progressCalls, fetchMock } = setupStreamingTest()
    await waitForSubmitPosted(fetchMock)
    const sse = MockEventSource.lastInstance!

    // SSE 推送 2 个本轮 progress 事件
    const now = new Date().toISOString()
    sse.dispatch('progress', {
      id: 'evt-1', createdAt: now, type: 'progress', summary: 'p1',
      data: { progressId: 'evt-1', content: 'sse-p1', processType: 'general', processTypeLabel: 'L' },
    })
    sse.dispatch('progress', {
      id: 'evt-2', createdAt: now, type: 'progress', summary: 'p2',
      data: { progressId: 'evt-2', content: 'sse-p2', processType: 'general', processTypeLabel: 'L' },
    })
    expect(progressCalls).toEqual(['sse-p1', 'sse-p2'])

    // 触发 SSE onerror：closeProgressStream 会把 activeSse 置 null，但 deliveredIds 保留
    sse.triggerError()

    // POST 返回相同 2 个 progressEvents，路径 B 应按 id 去重，不重复回放
    resolvePost(new Response(JSON.stringify({
      sessionId: 'sess-existing',
      decision: { kind: 'message', feedback: { content: 'ok', processType: 'general', processTypeLabel: 'Agent' } },
      progressEvents: [
        { id: 'evt-1', content: 'sse-p1', processType: 'general', processTypeLabel: 'L' },
        { id: 'evt-2', content: 'sse-p2', processType: 'general', processTypeLabel: 'L' },
      ],
    }), { status: 200 }))
    await submitPromise

    // 总共被调用 2 次（SSE 2 次 + 路径 B 0 次），不是 4 次——验证 onerror 后 deliveredIds 去重生效
    expect(progressCalls).toEqual(['sse-p1', 'sse-p2'])
  })

  it('closes SSE stream when POST fails to prevent resource leak', async () => {
    const { submitPromise, resolvePost, fetchMock } = setupStreamingTest()
    await waitForSubmitPosted(fetchMock)
    const sse = MockEventSource.lastInstance!

    // POST 返回 500，submitInstruction 应抛出，try/finally 应调用 closeProgressStream 释放 SSE
    resolvePost(new Response('Agent server request failed: 500', { status: 500 }))

    await expect(submitPromise).rejects.toThrow()
    // 验证 EventSource.close 被调用，避免后端 subscribeSessionEvents listener 泄漏
    expect(sse.closeCalls).toBeGreaterThan(0)
  })

  /**
   * case formal-react-sse-live-progress-with-post-replay
   * - userInput: 补齐当前播单空窗
   * - expectedDecision: 正式 ReAct POST 飞行期间通过 SSE 展示首个 checkpoint，结束后由 envelope 补全未送达进度
   * - mustNotHappen: 长流程退化为等待 POST 完成后的单气泡；SSE 与 POST 重复展示同一事件
   * - verification: onProgress 顺序为 live-checkpoint/post-decision，各出现一次
   */
  it('streams formal ReAct progress and replays only missing POST events', async () => {
    const storage = new Map<string, string>([['aibiandan_agent_session_id', 'sess-react-stream']])
    vi.stubGlobal('sessionStorage', {
      getItem: vi.fn((key: string) => storage.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => storage.set(key, value)),
    })
    vi.stubGlobal('window', {})
    vi.stubGlobal('EventSource', MockEventSource)
    let resolvePost!: (response: Response) => void
    const postPromise = new Promise<Response>((resolve) => { resolvePost = resolve })
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/api/agent/llm-config/status')) return new Response(JSON.stringify({ llm: { configured: true } }), { status: 200 })
      if (url.endsWith('/api/agent/orchestration')) return postPromise
      return new Response('{}', { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const progressCalls: string[] = []
    const client = new HttpAgentRuntimeClient('http://agent.local')
    const pending = client.startReactOrchestration({
      userInput: '补齐当前播单空窗', mode: 'partial_generate', reasoning: '逐轮执行',
      reactTask: { objective: '补齐空窗', nextActions: [{ type: 'research_check', queries: ['新闻'] }] },
    }, {
      scheduleState: baseScheduleState, userInput: '补齐当前播单空窗', currentSchedule: [],
      onProgress: (event) => progressCalls.push(event.content),
    })
    await vi.waitFor(() => {
      if (!fetchMock.mock.calls.some((call) => String(call[0]).endsWith('/api/agent/orchestration'))) throw new Error('orchestration not posted')
    })
    MockEventSource.lastInstance!.dispatch('progress', {
      id: 'react-progress-1', createdAt: new Date().toISOString(), type: 'progress', summary: 'live',
      data: { progressId: 'react-progress-1', content: 'live-checkpoint', processType: 'planning', processTypeLabel: '查节目库' },
    })
    expect(progressCalls).toEqual(['live-checkpoint'])

    resolvePost(new Response(JSON.stringify({
      sessionId: 'sess-react-stream', result: { status: 'completed' },
      progressEvents: [
        { id: 'react-progress-1', content: 'live-checkpoint', processType: 'planning', processTypeLabel: '查节目库' },
        { id: 'react-progress-2', content: 'post-decision', processType: 'selection', processTypeLabel: '候选决策' },
      ],
    }), { status: 200 }))
    await pending

    expect(progressCalls).toEqual(['live-checkpoint', 'post-decision'])
  })

  /**
   * case formal-react-sse-disconnect-dedupes-post-replay
   * - userInput: 长流程执行中 SSE 断开
   * - expectedDecision: 保留已送达事件 id，POST envelope 补齐未送达 checkpoint
   * - mustNotHappen: 断流后清空去重集合、丢失进度或重复展示
   * - verification: SSE 事件和 POST 新事件各一次
   */
  it('keeps formal ReAct dedupe state after SSE disconnect', async () => {
    const storage = new Map<string, string>([['aibiandan_agent_session_id', 'sess-react-disconnect']])
    vi.stubGlobal('sessionStorage', { getItem: vi.fn((key: string) => storage.get(key) ?? null), setItem: vi.fn() })
    vi.stubGlobal('window', {})
    vi.stubGlobal('EventSource', MockEventSource)
    let resolvePost!: (response: Response) => void
    const postPromise = new Promise<Response>((resolve) => { resolvePost = resolve })
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/api/agent/llm-config/status')) return new Response(JSON.stringify({ llm: { configured: true } }), { status: 200 })
      if (url.endsWith('/api/agent/orchestration')) return postPromise
      return new Response('{}', { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const progressCalls: string[] = []
    const client = new HttpAgentRuntimeClient('http://agent.local')
    const pending = client.startReactOrchestration({
      userInput: '补齐空窗', mode: 'partial_generate', reasoning: '逐轮执行',
      reactTask: { objective: '补齐空窗', nextActions: [{ type: 'validate' }] },
    }, {
      scheduleState: baseScheduleState, userInput: '补齐空窗', currentSchedule: [],
      onProgress: (event) => progressCalls.push(event.content),
    })
    await vi.waitFor(() => {
      if (!fetchMock.mock.calls.some((call) => String(call[0]).endsWith('/api/agent/orchestration'))) throw new Error('orchestration not posted')
    })
    const sse = MockEventSource.lastInstance!
    sse.dispatch('progress', {
      id: 'react-live-1', createdAt: new Date().toISOString(), type: 'progress', summary: 'live',
      data: { progressId: 'react-live-1', content: 'first-live', processType: 'planning', processTypeLabel: '任务规划' },
    })
    sse.triggerError()
    resolvePost(new Response(JSON.stringify({
      sessionId: 'sess-react-disconnect', result: { status: 'completed' },
      progressEvents: [
        { id: 'react-live-1', content: 'first-live', processType: 'planning', processTypeLabel: '任务规划' },
        { id: 'react-post-2', content: 'second-replayed', processType: 'selection', processTypeLabel: '候选决策' },
      ],
    }), { status: 200 }))
    await pending

    expect(progressCalls).toEqual(['first-live', 'second-replayed'])
  })

  it('formal-react-http-client-port: sends the structured request to the server orchestration endpoint', async () => {
    const testCase = {
      id: 'formal-react-http-client-port',
      userInput: '补齐当前播单空窗',
      expectedDecision: 'HTTP 客户端复用当前 session 调用服务端正式 ReAct 端口',
      mustNotHappen: '在浏览器内执行长流程或把 deadline/回调序列化到服务端',
      verification: 'POST /api/agent/orchestration 同时携带 request、input 和 sessionId',
    }
    const storage = new Map<string, string>([['aibiandan_agent_session_id', 'sess-react']])
    vi.stubGlobal('sessionStorage', {
      getItem: vi.fn((key: string) => storage.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => storage.set(key, value)),
    })
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/api/agent/llm-config/status')) {
        return new Response(JSON.stringify({ llm: { configured: true } }), { status: 200 })
      }
      return new Response(JSON.stringify({ sessionId: 'sess-react', result: { status: 'completed' } }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const client = new HttpAgentRuntimeClient('http://agent.local')

    await client.startReactOrchestration({
      userInput: testCase.userInput,
      mode: 'partial_generate',
      reasoning: '逐批观察',
      reactTask: { objective: '补齐空窗', nextActions: [{ type: 'validate' }] },
    }, {
      scheduleState: baseScheduleState,
      userInput: testCase.userInput,
      currentSchedule: [],
    })

    const orchestrationCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/api/agent/orchestration'))
    const body = JSON.parse(String(orchestrationCall?.[1]?.body))
    expect(testCase).toMatchObject({ expectedDecision: expect.any(String), mustNotHappen: expect.any(String), verification: expect.any(String) })
    expect(body).toMatchObject({ sessionId: 'sess-react', request: { reactTask: { objective: '补齐空窗' } }, input: { userInput: testCase.userInput } })
    expect(body.input).not.toHaveProperty('deadline')
    expect(body.input).not.toHaveProperty('onProgress')
  })

  it('formal-react-http-failed-outcome: returns the server failure instead of treating it as completed', async () => {
    const testCase = {
      id: 'formal-react-http-failed-outcome',
      userInput: '帮我全天编排',
      expectedDecision: 'HTTP client 返回 failed outcome，并回放可恢复失败事件',
      mustNotHappen: '吞掉 result、转换为 void/completed 或丢失 recovery envelope',
      verification: 'outcome.status=failed 且 onProgress 收到可恢复失败',
    }
    const storage = new Map<string, string>([['aibiandan_agent_session_id', 'sess-react-failed']])
    vi.stubGlobal('sessionStorage', { getItem: vi.fn((key: string) => storage.get(key) ?? null), setItem: vi.fn() })
    const recoverableFailure = { kind: 'llm_decide_unavailable', retrySuggestions: [], noMutation: true }
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/api/agent/llm-config/status')) return new Response(JSON.stringify({ llm: { configured: true } }), { status: 200 })
      return new Response(JSON.stringify({
        sessionId: 'sess-react-failed',
        result: { status: 'failed', failure: { message: 'LLM 网络请求超时', recoverableFailure, checkpointCount: 1 } },
        progressEvents: [{
          id: 'react-failed', content: 'LLM 网络请求超时', processType: 'error', processTypeLabel: '可恢复失败',
          details: { recoverableFailure, checkpointCount: 1 },
        }],
      }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const progress: RuntimeProgressEvent[] = []
    const outcome = await new HttpAgentRuntimeClient('http://agent.local').startReactOrchestration({
      userInput: testCase.userInput, mode: 'full_generate', reasoning: '逐轮执行',
      reactTask: { objective: '全天编排', nextActions: [{ type: 'validate' }] },
    }, {
      scheduleState: baseScheduleState, userInput: testCase.userInput, currentSchedule: [],
      onProgress: (event) => progress.push(event),
    })

    expect(testCase).toMatchObject({ expectedDecision: expect.any(String), mustNotHappen: expect.any(String), verification: expect.any(String) })
    expect(outcome).toMatchObject({ status: 'failed', failure: { recoverableFailure } })
    expect(progress).toEqual([expect.objectContaining({ processTypeLabel: '可恢复失败', details: expect.objectContaining({ recoverableFailure }) })])
  })

  it('formal-react-http-recovery-port: sends explicit recovery action and strips runtime-only fields', async () => {
    const storage = new Map<string, string>([['aibiandan_agent_session_id', 'sess-react']])
    vi.stubGlobal('sessionStorage', {
      getItem: vi.fn((key: string) => storage.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => storage.set(key, value)),
    })
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}'))
      return new Response(JSON.stringify({
        sessionId: 'sess-react',
        result: {
          status: 'action_required', action: body.action,
          allowedActions: ['continue', 'retry', 'narrow_scope', 'cancel'],
          envelope: { noMutation: true },
        },
      }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const client = new HttpAgentRuntimeClient('http://agent.local')

    const result = await client.recoverReactOrchestration({
      action: 'inspect', workspaceKey: 'rotation:rotation-1', playlistVersion: 'version-1',
      runtimeInput: {
        scheduleState: baseScheduleState, userInput: '继续', currentSchedule: [],
        onProgress: vi.fn(), deadline: {} as any,
      },
    })

    const recoveryCall = fetchMock.mock.calls.find(([url]) => String(url).includes('/orchestration/recover'))
    const body = JSON.parse(String(recoveryCall?.[1]?.body))
    expect(result.status).toBe('action_required')
    expect(body).toMatchObject({ action: 'inspect', workspaceKey: 'rotation:rotation-1', runtimeInput: { userInput: '继续' } })
    expect(body.runtimeInput).not.toHaveProperty('deadline')
    expect(body.runtimeInput).not.toHaveProperty('onProgress')
  })
})
