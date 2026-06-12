import { describe, expect, it, vi } from 'vitest'
import type { RuntimeDecision } from '../runtime/demoRuntimeFacade'
import type { LayoutDraft } from '@/types/orchestration'
import type { RuntimeBridgeSessionState } from '../runtime/runtimeSessionStore'
import { OpenClawHostAdapter, type OpenClawHostOutboundEnvelope } from '../openclaw/openClawHostAdapter'

const buildSessionState = (decision?: RuntimeDecision): RuntimeBridgeSessionState => ({
  sessionId: 'bridge-session-1',
  conversationId: 'agent:main:main',
  status: 'accepted',
  summary: '已收到请求',
  context: {
    conversationId: 'agent:main:main',
    channelId: 'dragon',
    channelName: '东方卫视',
    date: '2026-04-07',
    currentSchedule: [],
  },
  lastDecision: decision,
  updatedAt: new Date().toISOString(),
})

const buildDraft = (): LayoutDraft => ({
  id: 'draft-commit-1',
  channelId: 'dragon',
  date: '2026-04-07',
  version: 1,
  source: 'generated',
  userIntent: '下午电视剧',
  coverage: {
    start: '13:00:00',
    end: '18:00:00',
  },
  layoutReference: {
    id: 'layout-commit-1',
    name: '下午电视剧草案',
    slots: [
      {
        id: 'slot-1300',
        channelId: 'dragon',
        startTime: '2026-04-07T13:00:00+08:00',
        endTime: '2026-04-07T18:00:00+08:00',
        columnId: 'runtime-column:drama',
      },
    ],
  },
  columns: [
    {
      columnId: 'runtime-column:drama',
      columnName: '下午电视剧',
      channelId: 'dragon',
      defaultProgramType: 'drama',
      source: 'generated',
      semanticLabel: '下午电视剧',
      isSequential: true,
    },
  ],
})

class FakeBridge {
  session = buildSessionState()
  subscribeListener?: (state: RuntimeBridgeSessionState) => void

  async submitInstruction() {
    return {
      sessionId: this.session.sessionId,
      status: this.session.status,
      summary: this.session.summary,
    }
  }

  async confirm(sessionId: string) {
    return {
      sessionId,
      status: 'completed',
      summary: '已确认',
    }
  }

  async selectTarget(sessionId: string) {
    return {
      sessionId,
      status: 'completed',
      summary: '已选择',
    }
  }

  async cancel(sessionId: string) {
    return {
      sessionId,
      status: 'cancelled',
      summary: '已取消',
    }
  }

  getSessionState(sessionId: string) {
    return sessionId === this.session.sessionId ? this.session : null
  }

  findSessionByConversationId(conversationId: string) {
    return conversationId === this.session.conversationId ? this.session : null
  }

  subscribe(sessionId: string, listener: (state: RuntimeBridgeSessionState) => void) {
    if (sessionId === this.session.sessionId) {
      this.subscribeListener = listener
      listener(this.session)
    }
    return () => {
      this.subscribeListener = undefined
    }
  }
}

describe('OpenClawHostAdapter', () => {
  it('会返回 ready 能力描述', async () => {
    const adapter = new OpenClawHostAdapter({
      bridge: new FakeBridge() as never,
      getContext: () => ({
        channelId: 'dragon',
        channelName: '东方卫视',
        date: '2026-04-07',
        currentSchedule: [],
        gapCount: 1,
      }),
      hostWindow: null,
    })

    const response = await adapter.handleEnvelope({
      type: 'bigbiandan.ping',
      requestId: 'req-ready',
    })

    expect(response).toEqual({
      type: 'bigbiandan.ready',
      requestId: 'req-ready',
      payload: {
        protocol: 'bigbiandan.openclaw',
        version: '1.0',
        capabilities: ['submit', 'confirm', 'selectTarget', 'cancel', 'getState', 'subscribe'],
        context: {
          channelId: 'dragon',
          channelName: '东方卫视',
          date: '2026-04-07',
          currentSchedule: [],
          gapCount: 1,
        },
      },
    })
  })

  it('会在编排请求被接受后触发页面侧 orchestration 回调', async () => {
    const orchestrationDecision: RuntimeDecision = {
      kind: 'orchestration',
      feedback: {
        content: '开始编排',
        processType: 'planning',
        processTypeLabel: '编排',
      },
      orchestrationRequest: {
        userInput: '补齐当前空窗',
        mode: 'partial_generate',
        reasoning: '存在空窗，走局部补排',
      },
    }
    const bridge = new FakeBridge()
    bridge.session = buildSessionState(orchestrationDecision)
    const onOrchestrationRequest = vi.fn()
    const peerMessages: OpenClawHostOutboundEnvelope[] = []

    const adapter = new OpenClawHostAdapter({
      bridge: bridge as never,
      getContext: () => ({
        channelId: 'dragon',
        channelName: '东方卫视',
        date: '2026-04-07',
        currentSchedule: [],
        gapCount: 1,
      }),
      onOrchestrationRequest,
      getOrchestrationSnapshot: () => ({
        channelId: 'dragon',
        channelName: '东方卫视',
        date: '2026-04-07',
        status: 'running',
        isRunning: true,
      }),
      hostWindow: null,
    })

    const response = await adapter.handleEnvelope(
      {
        type: 'bigbiandan.submit',
        requestId: 'req-submit',
        payload: {
          conversationId: 'agent:main:main',
          text: '补齐当前空窗',
        },
      },
      {
        key: 'peer-1',
        post: (message) => {
          peerMessages.push(message)
        },
      },
    )

    expect(response?.type).toBe('bigbiandan.result')
    expect(onOrchestrationRequest).toHaveBeenCalledWith(orchestrationDecision.orchestrationRequest)
    expect(peerMessages.some((message) => message.type === 'bigbiandan.state')).toBe(true)
    expect(peerMessages.some((message) => message.type === 'bigbiandan.orchestration')).toBe(true)
  })

  it('会在自然语言确认版面后把 layout_commit 转发为页面侧编排请求', async () => {
    const draft = buildDraft()
    const commitDecision: RuntimeDecision = {
      kind: 'layout_commit',
      feedback: {
        content: '已确认当前版面草案，准备按该版面开始编排。',
        processType: 'planning',
        processTypeLabel: '版面草案确认',
      },
      draft,
      orchestrationRequest: {
        userInput: '确认版面',
        mode: 'full_generate',
        reasoning: '用户确认当前版面草案并开始编排。',
        layoutDraft: draft,
      },
    }
    const bridge = new FakeBridge()
    bridge.session = buildSessionState(commitDecision)
    const onOrchestrationRequest = vi.fn()

    const adapter = new OpenClawHostAdapter({
      bridge: bridge as never,
      getContext: () => ({
        channelId: 'dragon',
        channelName: '东方卫视',
        date: '2026-04-07',
        currentSchedule: [],
        gapCount: 1,
      }),
      onOrchestrationRequest,
      getOrchestrationSnapshot: () => ({
        channelId: 'dragon',
        channelName: '东方卫视',
        date: '2026-04-07',
        status: 'running',
        isRunning: true,
      }),
      hostWindow: null,
    })

    const response = await adapter.handleEnvelope({
      type: 'bigbiandan.submit',
      requestId: 'req-layout-commit',
      payload: {
        conversationId: 'agent:main:main',
        text: '确认版面',
      },
    })

    expect(response?.type).toBe('bigbiandan.result')
    expect(onOrchestrationRequest).toHaveBeenCalledWith(commitDecision.orchestrationRequest)
  })

  it('支持仅通过 conversationId 查询当前会话状态', async () => {
    const adapter = new OpenClawHostAdapter({
      bridge: new FakeBridge() as never,
      getContext: () => ({
        channelId: 'dragon',
        channelName: '东方卫视',
        date: '2026-04-07',
        currentSchedule: [],
        gapCount: 0,
      }),
      hostWindow: null,
    })

    const response = await adapter.handleEnvelope({
      type: 'bigbiandan.getState',
      requestId: 'req-state',
      payload: {
        conversationId: 'agent:main:main',
      },
    })

    expect(response?.type).toBe('bigbiandan.state')
    expect(response?.payload).toMatchObject({
      sessionId: 'bridge-session-1',
      conversationId: 'agent:main:main',
    })
  })
})
