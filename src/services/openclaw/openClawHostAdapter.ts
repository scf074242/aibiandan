import type { RuntimeDecision, RuntimeOrchestrationRequest, RuntimeScheduleItem } from '@/services/runtime/demoRuntimeFacade'
import type { RuntimeBridgeSessionState } from '@/services/runtime/runtimeSessionStore'
import { getOpenClawBridge, type OpenClawBridge, type OpenClawBridgeResult } from './openClawBridge'

type OpenClawHostInboundType =
  | 'bigbiandan.ping'
  | 'bigbiandan.submit'
  | 'bigbiandan.confirm'
  | 'bigbiandan.selectTarget'
  | 'bigbiandan.cancel'
  | 'bigbiandan.getState'

type OpenClawHostOutboundType =
  | 'bigbiandan.ready'
  | 'bigbiandan.result'
  | 'bigbiandan.state'
  | 'bigbiandan.orchestration'
  | 'bigbiandan.error'

type OpenClawWindowLike = {
  addEventListener: (type: 'message', listener: (event: MessageEvent<unknown>) => void) => void
  removeEventListener: (type: 'message', listener: (event: MessageEvent<unknown>) => void) => void
}

type OpenClawMessageTarget = {
  postMessage: (message: unknown, targetOrigin?: string) => void
}

export interface OpenClawHostContext {
  channelId: string
  channelName: string
  date: string
  currentSchedule: RuntimeScheduleItem[]
  gapCount: number
}

export interface OpenClawHostOrchestrationSnapshot {
  channelId: string
  channelName: string
  date: string
  status: string
  isRunning: boolean
  sessionId?: string
  latestLog?: string
  progress?: Record<string, unknown> | null
}

export interface OpenClawHostSubmitPayload {
  conversationId: string
  text: string
  history?: string[]
}

export interface OpenClawHostConfirmPayload {
  sessionId?: string
  conversationId?: string
}

export interface OpenClawHostSelectTargetPayload extends OpenClawHostConfirmPayload {
  targetId: string
}

type OpenClawHostPayload =
  | undefined
  | OpenClawHostSubmitPayload
  | OpenClawHostConfirmPayload
  | OpenClawHostSelectTargetPayload

export interface OpenClawHostInboundEnvelope<TPayload extends OpenClawHostPayload = OpenClawHostPayload> {
  type: OpenClawHostInboundType
  requestId?: string
  payload?: TPayload
}

export interface OpenClawHostOutboundEnvelope<TPayload = unknown> {
  type: OpenClawHostOutboundType
  requestId?: string
  payload: TPayload
}

export interface OpenClawHostReadyPayload {
  protocol: 'bigbiandan.openclaw'
  version: '1.0'
  capabilities: Array<'submit' | 'confirm' | 'selectTarget' | 'cancel' | 'getState' | 'subscribe'>
  context: OpenClawHostContext
}

export interface OpenClawHostResultPayload {
  sessionId: string
  status: string
  summary: string
  result: OpenClawBridgeResult
  session: RuntimeBridgeSessionState | null
}

export interface OpenClawHostStatePayload {
  sessionId: string
  conversationId: string
  state: RuntimeBridgeSessionState
}

type OpenClawHostPeer = {
  key: string
  post: (message: OpenClawHostOutboundEnvelope) => void
}

type OpenClawHostAdapterOptions = {
  getContext: () => OpenClawHostContext
  onOrchestrationRequest?: (request: RuntimeOrchestrationRequest) => Promise<void> | void
  getOrchestrationSnapshot?: () => OpenClawHostOrchestrationSnapshot | null
  bridge?: OpenClawBridge
  hostWindow?: OpenClawWindowLike | null
}

type OpenClawHostGlobalApi = {
  ping: () => OpenClawHostReadyPayload
  submit: (payload: OpenClawHostSubmitPayload) => Promise<OpenClawHostResultPayload>
  confirm: (payload: OpenClawHostConfirmPayload) => Promise<OpenClawHostResultPayload>
  selectTarget: (payload: OpenClawHostSelectTargetPayload) => Promise<OpenClawHostResultPayload>
  cancel: (payload: OpenClawHostConfirmPayload) => Promise<OpenClawHostResultPayload>
  getSessionState: (payload: OpenClawHostConfirmPayload) => RuntimeBridgeSessionState | null
}

declare global {
  interface Window {
    __BIGBIANDAN_OPENCLAW_HOST__?: OpenClawHostGlobalApi
  }
}

export class OpenClawHostAdapter {
  private readonly bridge: OpenClawBridge
  private readonly peerSubscriptions = new Map<string, () => void>()
  private readonly peersBySession = new Map<string, Map<string, OpenClawHostPeer>>()
  private readonly hostWindow: OpenClawWindowLike | null
  private installed = false

  constructor(private readonly options: OpenClawHostAdapterOptions) {
    this.bridge = options.bridge ?? getOpenClawBridge()
    this.hostWindow = options.hostWindow ?? (typeof window !== 'undefined' ? window : null)
  }

  install() {
    if (!this.hostWindow || this.installed) return
    this.hostWindow.addEventListener('message', this.handleMessageEvent)
    this.installGlobalApi()
    this.installed = true
  }

  dispose() {
    if (this.hostWindow && this.installed) {
      this.hostWindow.removeEventListener('message', this.handleMessageEvent)
    }
    this.installed = false
    this.peerSubscriptions.forEach((unsubscribe) => unsubscribe())
    this.peerSubscriptions.clear()
    this.peersBySession.clear()
    if (typeof window !== 'undefined' && window.__BIGBIANDAN_OPENCLAW_HOST__) {
      delete window.__BIGBIANDAN_OPENCLAW_HOST__
    }
  }

  getReadyPayload(): OpenClawHostReadyPayload {
    return {
      protocol: 'bigbiandan.openclaw',
      version: '1.0',
      capabilities: ['submit', 'confirm', 'selectTarget', 'cancel', 'getState', 'subscribe'],
      context: this.options.getContext(),
    }
  }

  getSessionState(payload: OpenClawHostConfirmPayload): RuntimeBridgeSessionState | null {
    return this.resolveSession(payload)
  }

  async submit(
    payload: OpenClawHostSubmitPayload,
    peer?: OpenClawHostPeer,
    requestId?: string,
  ): Promise<OpenClawHostResultPayload> {
    const context = this.options.getContext()
    const result = await this.bridge.submitInstruction({
      conversationId: payload.conversationId,
      channelId: context.channelId,
      channelName: context.channelName,
      date: context.date,
      text: payload.text,
      currentSchedule: context.currentSchedule,
      gapCount: context.gapCount,
      history: payload.history,
    })
    return this.finalizeResult(result, peer, requestId)
  }

  async confirm(
    payload: OpenClawHostConfirmPayload,
    peer?: OpenClawHostPeer,
    requestId?: string,
  ): Promise<OpenClawHostResultPayload> {
    const session = this.requireSession(payload)
    const result = await this.bridge.confirm(session.sessionId)
    return this.finalizeResult(result, peer, requestId)
  }

  async selectTarget(
    payload: OpenClawHostSelectTargetPayload,
    peer?: OpenClawHostPeer,
    requestId?: string,
  ): Promise<OpenClawHostResultPayload> {
    const session = this.requireSession(payload)
    const result = await this.bridge.selectTarget(session.sessionId, payload.targetId)
    return this.finalizeResult(result, peer, requestId)
  }

  async cancel(
    payload: OpenClawHostConfirmPayload,
    peer?: OpenClawHostPeer,
    requestId?: string,
  ): Promise<OpenClawHostResultPayload> {
    const session = this.requireSession(payload)
    const result = await this.bridge.cancel(session.sessionId)
    return this.finalizeResult(result, peer, requestId)
  }

  publishOrchestrationState(snapshot: OpenClawHostOrchestrationSnapshot | null) {
    if (!snapshot) return
    this.broadcast({
      type: 'bigbiandan.orchestration',
      payload: snapshot,
    })
  }

  async handleEnvelope(
    envelope: OpenClawHostInboundEnvelope,
    peer?: OpenClawHostPeer,
  ): Promise<OpenClawHostOutboundEnvelope | null> {
    switch (envelope.type) {
      case 'bigbiandan.ping':
        return {
          type: 'bigbiandan.ready',
          requestId: envelope.requestId,
          payload: this.getReadyPayload(),
        }
      case 'bigbiandan.submit':
        return {
          type: 'bigbiandan.result',
          requestId: envelope.requestId,
          payload: await this.submit(assertSubmitPayload(envelope.payload), peer, envelope.requestId),
        }
      case 'bigbiandan.confirm':
        return {
          type: 'bigbiandan.result',
          requestId: envelope.requestId,
          payload: await this.confirm(assertSessionPayload(envelope.payload), peer, envelope.requestId),
        }
      case 'bigbiandan.selectTarget':
        return {
          type: 'bigbiandan.result',
          requestId: envelope.requestId,
          payload: await this.selectTarget(assertSelectTargetPayload(envelope.payload), peer, envelope.requestId),
        }
      case 'bigbiandan.cancel':
        return {
          type: 'bigbiandan.result',
          requestId: envelope.requestId,
          payload: await this.cancel(assertSessionPayload(envelope.payload), peer, envelope.requestId),
        }
      case 'bigbiandan.getState': {
        const session = this.resolveSession(assertSessionPayload(envelope.payload))
        return {
          type: 'bigbiandan.state',
          requestId: envelope.requestId,
          payload: session
            ? {
                sessionId: session.sessionId,
                conversationId: session.conversationId,
                state: session,
              }
            : null,
        }
      }
      default:
        return null
    }
  }

  private readonly handleMessageEvent = async (event: MessageEvent<unknown>) => {
    const envelope = parseInboundEnvelope(event.data)
    if (!envelope) return

    const peer = createPeer(event, envelope)
    if (!peer) return

    try {
      const response = await this.handleEnvelope(envelope, peer)
      if (response) {
        peer.post(response)
      }
    } catch (error) {
      peer.post({
        type: 'bigbiandan.error',
        requestId: envelope.requestId,
        payload: {
          message: error instanceof Error ? error.message : 'OpenClaw 接入失败',
        },
      })
    }
  }

  private async finalizeResult(
    result: OpenClawBridgeResult,
    peer?: OpenClawHostPeer,
    requestId?: string,
  ): Promise<OpenClawHostResultPayload> {
    const session = this.bridge.getSessionState(result.sessionId)
    if (peer && session) {
      this.attachPeer(session.sessionId, peer)
      this.ensureSessionSubscription(session.sessionId)
    }

    if (session?.lastDecision?.kind === 'orchestration' || session?.lastDecision?.kind === 'layout_commit') {
      await this.options.onOrchestrationRequest?.(session.lastDecision.orchestrationRequest)
      this.publishOrchestrationState(this.options.getOrchestrationSnapshot?.() ?? null)
    }

    void requestId
    return {
      sessionId: result.sessionId,
      status: result.status,
      summary: result.summary,
      result,
      session,
    }
  }

  private installGlobalApi() {
    if (typeof window === 'undefined') return
    window.__BIGBIANDAN_OPENCLAW_HOST__ = {
      ping: () => this.getReadyPayload(),
      submit: (payload) => this.submit(payload),
      confirm: (payload) => this.confirm(payload),
      selectTarget: (payload) => this.selectTarget(payload),
      cancel: (payload) => this.cancel(payload),
      getSessionState: (payload) => this.getSessionState(payload),
    }
  }

  private resolveSession(payload: OpenClawHostConfirmPayload): RuntimeBridgeSessionState | null {
    if (payload.sessionId) {
      return this.bridge.getSessionState(payload.sessionId)
    }
    if (payload.conversationId) {
      return this.bridge.findSessionByConversationId(payload.conversationId)
    }
    return null
  }

  private requireSession(payload: OpenClawHostConfirmPayload): RuntimeBridgeSessionState {
    const session = this.resolveSession(payload)
    if (!session) {
      throw new Error('未找到对应的 OpenClaw 会话')
    }
    return session
  }

  private attachPeer(sessionId: string, peer: OpenClawHostPeer) {
    const peers = this.peersBySession.get(sessionId) ?? new Map<string, OpenClawHostPeer>()
    peers.set(peer.key, peer)
    this.peersBySession.set(sessionId, peers)
  }

  private ensureSessionSubscription(sessionId: string) {
    if (this.peerSubscriptions.has(sessionId)) {
      return
    }
    const unsubscribe = this.bridge.subscribe(sessionId, (state) => {
      this.broadcastToSession(sessionId, {
        type: 'bigbiandan.state',
        payload: {
          sessionId: state.sessionId,
          conversationId: state.conversationId,
          state,
        },
      })
    })
    this.peerSubscriptions.set(sessionId, unsubscribe)
  }

  private broadcastToSession(sessionId: string, message: OpenClawHostOutboundEnvelope) {
    const peers = this.peersBySession.get(sessionId)
    if (!peers || peers.size === 0) return
    peers.forEach((peer) => {
      peer.post(message)
    })
  }

  private broadcast(message: OpenClawHostOutboundEnvelope) {
    this.peersBySession.forEach((peers) => {
      peers.forEach((peer) => {
        peer.post(message)
      })
    })
  }
}

const parseInboundEnvelope = (data: unknown): OpenClawHostInboundEnvelope | null => {
  if (!data || typeof data !== 'object') {
    return null
  }
  const candidate = data as Partial<OpenClawHostInboundEnvelope>
  if (typeof candidate.type !== 'string' || !candidate.type.startsWith('bigbiandan.')) {
    return null
  }
  return candidate as OpenClawHostInboundEnvelope
}

const createPeer = (
  event: MessageEvent<unknown>,
  envelope: OpenClawHostInboundEnvelope,
): OpenClawHostPeer | null => {
  const target = event.source as OpenClawMessageTarget | null
  if (!target || typeof target.postMessage !== 'function') {
    return null
  }
  const conversationId = extractConversationId(envelope.payload)
  const origin = event.origin || '*'
  return {
    key: `${origin}:${conversationId || 'anonymous'}`,
    post: (message) => {
      target.postMessage(message, origin)
    },
  }
}

const extractConversationId = (payload: OpenClawHostPayload): string | null => {
  if (!payload || typeof payload !== 'object') {
    return null
  }
  if ('conversationId' in payload && typeof payload.conversationId === 'string' && payload.conversationId) {
    return payload.conversationId
  }
  return null
}

const assertSubmitPayload = (payload: OpenClawHostPayload): OpenClawHostSubmitPayload => {
  if (!payload || typeof payload !== 'object') {
    throw new Error('缺少提交参数')
  }
  const candidate = payload as Partial<OpenClawHostSubmitPayload>
  if (!candidate.conversationId || !candidate.text) {
    throw new Error('提交参数不完整')
  }
  return {
    conversationId: candidate.conversationId,
    text: candidate.text,
    history: Array.isArray(candidate.history) ? candidate.history.filter((item): item is string => typeof item === 'string') : undefined,
  }
}

const assertSessionPayload = (payload: OpenClawHostPayload): OpenClawHostConfirmPayload => {
  if (!payload || typeof payload !== 'object') {
    throw new Error('缺少会话参数')
  }
  const candidate = payload as Partial<OpenClawHostConfirmPayload>
  if (!candidate.sessionId && !candidate.conversationId) {
    throw new Error('缺少 sessionId 或 conversationId')
  }
  return {
    sessionId: candidate.sessionId,
    conversationId: candidate.conversationId,
  }
}

const assertSelectTargetPayload = (payload: OpenClawHostPayload): OpenClawHostSelectTargetPayload => {
  if (!payload || typeof payload !== 'object') {
    throw new Error('缺少目标选择参数')
  }
  const candidate = payload as Partial<OpenClawHostSelectTargetPayload>
  if (!candidate.targetId) {
    throw new Error('缺少 targetId')
  }
  const sessionPayload = assertSessionPayload(candidate)
  return {
    ...sessionPayload,
    targetId: candidate.targetId,
  }
}

let globalOpenClawHostAdapter: OpenClawHostAdapter | null = null

export function getOpenClawHostAdapter(options: OpenClawHostAdapterOptions): OpenClawHostAdapter {
  if (!globalOpenClawHostAdapter) {
    globalOpenClawHostAdapter = new OpenClawHostAdapter(options)
  }
  return globalOpenClawHostAdapter
}
