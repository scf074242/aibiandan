import {
  getSchedulingAgentRuntimeFacade,
  summarizeRuntimeCommand,
  type RuntimeAnalysisContext,
  type RuntimeDecision,
  type RuntimeExecutePendingCommandInput,
  type RuntimeExecutedResult,
  type RuntimeFeedback,
  type RuntimeOrchestrationRequest,
  type RuntimePendingCommand,
  type RuntimeProgressEvent,
  type RuntimeReactOrchestrationOutcome,
  type RuntimeResolveInsertRecommendationInput,
  type RuntimeResolveTargetSelectionInput,
  type RuntimeScheduleItem,
  type RuntimeSubmitInput,
} from './schedulingAgentRuntimeFacade'
import { loadLLMConfig } from '@/services/llm/llmConfig'
import { isPlaceholderApiKey } from '@/services/llm/localDemoLlm'
import type {
  AgentServerReactRecoveryInput,
  AgentServerReactRecoveryResult,
} from './agentServerRuntime'
import { prepareFormalOrchestrationRecovery } from './formalOrchestrationRecovery'
import { buildFormalPlaylistSnapshot } from './formalPlaylistState'
import { buildScheduleWorkspaceSummary, resolveForegroundWorkspaceKey } from './foregroundWorkspaceState'
import { FormalPlaylistWriteAdapter } from './formalPlaylistWriteAdapter'
import { buildFormalWriteContext } from '@/services/agent/mutationPolicy'
import { FormalOrchestrationGrantAuthority } from './formalOrchestrationGrant'

export {
  summarizeRuntimeCommand,
  type RuntimeAnalysisContext,
  type RuntimeDecision,
  type RuntimeExecutePendingCommandInput,
  type RuntimeExecutedResult,
  type RuntimeFeedback,
  type RuntimeOrchestrationRequest,
  type RuntimePendingCommand,
  type RuntimeProgressEvent,
  type RuntimeReactOrchestrationOutcome,
  type RuntimeResolveInsertRecommendationInput,
  type RuntimeResolveTargetSelectionInput,
  type RuntimeScheduleItem,
  type RuntimeSubmitInput,
}

export interface AgentRuntimeClient {
  submitInstruction(input: RuntimeSubmitInput): Promise<RuntimeDecision>
  executePendingCommand(input: RuntimeExecutePendingCommandInput): Promise<RuntimeExecutedResult>
  resolvePendingTargetSelection(input: RuntimeResolveTargetSelectionInput): Promise<RuntimeDecision>
  resolvePendingInsertRecommendation(input: RuntimeResolveInsertRecommendationInput): Promise<RuntimeDecision>
  startReactOrchestration(request: RuntimeOrchestrationRequest, input: RuntimeSubmitInput): Promise<RuntimeReactOrchestrationOutcome>
  recoverReactOrchestration?(input: AgentServerReactRecoveryInput): Promise<AgentServerReactRecoveryResult>
  cancelActiveInstruction?(workspaceKey: string): Promise<{
    stopped: boolean
    reason: 'stopped' | 'not_found' | 'workspace_mismatch' | 'not_stoppable'
  }>
}

export type AgentRuntimeMode = 'local' | 'http'

type RuntimeEnvelope<T> = {
  sessionId?: string
  decision?: T
  result?: T
  /**
   * HTTP 模式下后端收集的进度事件数组。
   * 前端收到后按顺序回放给 input.onProgress，复用 Local 模式的多气泡渲染逻辑。
   */
  progressEvents?: RuntimeProgressEvent[]
}

type ServerLlmConfigStatus = {
  llm?: {
    configured?: boolean
  }
}

const HTTP_SESSION_STORAGE_KEY = 'aibiandan_agent_session_id'

/**
 * 安全解析 SSE 推送的 progress 事件 payload。
 * data 结构来自 agentServerRuntime.appendEvent 写入的 event.data 字段；
 * SSE 消息体本身是整个 AgentServerSessionEvent 的 JSON（含 id / createdAt 顶层字段）。
 *
 * 时间戳过滤：submitStartTime 是本轮 POST 发送前的前端时间戳。
 * 如果 event.createdAt 早于 submitStartTime 超过 1s 容差，认为是上一轮残留的历史 progress，
 * 直接返回 null 跳过——这样无需依赖后端 ready 标志即可安全处理 SSE 历史事件阶段。
 *
 * @param raw SSE 消息 data 字段原始字符串
 * @param submitStartTime 本轮 submit 的前端起始时间戳（ms）；0 表示不进行时间戳过滤
 */
function safeParseProgressEvent(raw: string | null, submitStartTime = 0): RuntimeProgressEvent | null {
  if (!raw) return null
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>
    const data = (obj.data ?? obj) as Record<string, unknown>
    if (typeof data.content !== 'string') return null
    // 时间戳过滤：跳过本轮 submit 之前产生的 progress 事件（上一轮 SSE 残留）
    if (submitStartTime > 0 && typeof obj.createdAt === 'string') {
      const createdAt = Date.parse(obj.createdAt)
      if (!Number.isNaN(createdAt) && createdAt + 1000 < submitStartTime) return null
    }
    // id 优先取前端 progressId，回退到 SSE event 顶层 id（agent_event_xxx）
    const id = typeof data.progressId === 'string'
      ? data.progressId
      : (typeof obj.id === 'string' ? obj.id : undefined)
    return {
      id,
      content: data.content,
      thinking: typeof data.thinking === 'string' ? data.thinking : undefined,
      details: (data.details ?? undefined) as Record<string, unknown> | undefined,
      processType: (data.processType as RuntimeProgressEvent['processType']) ?? 'general',
      processTypeLabel: (data.processTypeLabel as string) ?? '进度',
    }
  } catch {
    return null
  }
}

const readViteEnv = (key: string): string | undefined => {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env
  return env?.[key]
}

export function resolveAgentRuntimeMode(): AgentRuntimeMode {
  const mode = readViteEnv('VITE_AGENT_RUNTIME_MODE')?.trim().toLowerCase()
  return mode === 'http' || mode === 'server' ? 'http' : 'local'
}

export function isHttpAgentRuntimeEnabled(): boolean {
  return resolveAgentRuntimeMode() === 'http'
}

const resolveAgentRuntimeBaseUrl = (): string => (
  readViteEnv('VITE_AGENT_RUNTIME_BASE_URL')?.replace(/\/$/, '')
  ?? (typeof window !== 'undefined' && window.location?.hostname
    ? `${window.location.protocol}//${window.location.hostname}:3000`
    : 'http://127.0.0.1:3000')
)

export class LocalAgentRuntimeClient implements AgentRuntimeClient {
  private readonly runtime = getSchedulingAgentRuntimeFacade()
  private readonly formalRebuildGrants = new FormalOrchestrationGrantAuthority()
  private readonly formalWriteAdapter = new FormalPlaylistWriteAdapter({
    executePendingCommand: (input) => this.runtime.executePendingCommand(input),
  })
  private activeWorkspaceContext: {
    workspaceKey: string
  } | null = null
  private activeReactContext: {
    request: RuntimeOrchestrationRequest
    workspaceKey: string
    playlistVersion: string
  } | null = null

  async submitInstruction(input: RuntimeSubmitInput): Promise<RuntimeDecision> {
    const workspaceKey = resolveForegroundWorkspaceKey(buildScheduleWorkspaceSummary(input.scheduleState))
    this.activeWorkspaceContext = workspaceKey === 'none'
      ? null
      : {
          workspaceKey,
        }
    const decision = await this.runtime.submitInstruction(input)
    return this.issueLocalFormalRebuildGrant(decision, input)
  }

  private issueLocalFormalRebuildGrant(decision: RuntimeDecision, input: RuntimeSubmitInput): RuntimeDecision {
    if (decision.kind !== 'orchestration' && decision.kind !== 'layout_commit') return decision
    const request = decision.orchestrationRequest
    const grantRequest = request.authorizationRequest
    if (!grantRequest) return decision
    if (!input.pendingAtomicContext?.pendingId || input.pendingAtomicContext.pendingId !== grantRequest.sourcePendingId) {
      throw new Error('Formal rebuild grant source pending mismatch.')
    }
    const snapshot = buildFormalPlaylistSnapshot(input.currentSchedule, 'foreground')
    const grant = this.formalRebuildGrants.issue({
      sessionId: 'local-agent-runtime',
      sourcePendingId: grantRequest.sourcePendingId,
      workspaceKey: grantRequest.workspaceKey,
      initialPlaylistVersion: snapshot.version,
      layoutDraft: request.layoutDraft ?? input.currentLayoutDraft,
      existingItemCount: grantRequest.existingItemCount,
      mode: grantRequest.mode,
      targetTimeRange: request.targetTimeRange,
      scope: {
        targetTimeRange: request.targetTimeRange,
        taskKind: request.lifecycle?.taskKind,
        objective: request.reactTask?.objective,
        searchKeywords: request.searchKeywords,
      },
    })
    const orchestrationRequest: RuntimeOrchestrationRequest = {
      ...request,
      authorizationRequest: undefined,
      authorizationGrantId: grant.grantId,
      resolvedAuthorization: undefined,
    }
    return { ...decision, orchestrationRequest }
  }

  executePendingCommand(input: RuntimeExecutePendingCommandInput): Promise<RuntimeExecutedResult> {
    const context = this.activeWorkspaceContext
    if (!context || !input.workspaceKey) {
      return Promise.resolve(this.buildLocalWriteBoundaryFailure(
        input,
        'formal_write_workspace_missing',
        '本地正式写入缺少可信工作区上下文，已拒绝执行。',
      ))
    }
    if (input.workspaceKey !== context.workspaceKey) {
      return Promise.resolve(this.buildLocalWriteBoundaryFailure(
        input,
        'formal_write_workspace_mismatch',
        '待执行操作不属于当前播单工作区，已拒绝执行。',
      ))
    }

    const currentSnapshot = buildFormalPlaylistSnapshot(input.currentSchedule ?? [], 'foreground')
    const mutationId = input.pendingId
      ?? input.pendingCommand.pendingId
      ?? input.idempotencyKey
      ?? `local_write_${currentSnapshot.version}`
    return this.formalWriteAdapter.execute(input, {
      sessionId: 'local-agent-runtime',
      workspaceKey: context.workspaceKey,
      transport: 'local',
      actualPlaylistVersion: currentSnapshot.version,
      currentSnapshot,
      mutationContext: buildFormalWriteContext(mutationId, context.workspaceKey, mutationId),
    })
  }

  private buildLocalWriteBoundaryFailure(
    input: RuntimeExecutePendingCommandInput,
    error: 'formal_write_workspace_missing' | 'formal_write_workspace_mismatch',
    message: string,
  ): RuntimeExecutedResult {
    return {
      success: false,
      command: input.pendingCommand.command,
      message,
      error,
      summary: input.pendingCommand.summary,
      thinking: '正式写入边界在 mutation 前阻断了不可信的工作区请求。',
      explanation: input.pendingCommand.reasoning,
      details: {
        formalWrite: {
          boundary: 'formal-playlist-write-adapter',
          transport: 'local',
          status: 'blocked',
          reused: false,
          workspaceKey: input.workspaceKey,
          pendingId: input.pendingId ?? input.pendingCommand.pendingId,
        },
      },
    }
  }

  resolvePendingTargetSelection(input: RuntimeResolveTargetSelectionInput): Promise<RuntimeDecision> {
    return this.runtime.resolvePendingTargetSelection(input)
  }

  resolvePendingInsertRecommendation(input: RuntimeResolveInsertRecommendationInput): Promise<RuntimeDecision> {
    return this.runtime.resolvePendingInsertRecommendation(input)
  }

  async startReactOrchestration(request: RuntimeOrchestrationRequest, input: RuntimeSubmitInput): Promise<RuntimeReactOrchestrationOutcome> {
    const workspaceKey = resolveForegroundWorkspaceKey(buildScheduleWorkspaceSummary(input.scheduleState))
    if (request.authorizationRequest || request.resolvedAuthorization) {
      throw new Error('Formal rebuild authorization must be resolved by the local runtime boundary.')
    }
    const playlistVersion = buildFormalPlaylistSnapshot(input.currentSchedule, 'foreground').version
    if (request.mode === 'full_generate' && input.currentSchedule.length > 0 && !request.authorizationGrantId) {
      throw new Error('Existing formal playlist rebuild requires a runtime-issued grant.')
    }
    const resolvedAuthorization = request.authorizationGrantId
      ? this.formalRebuildGrants.resolve(request.authorizationGrantId, {
          sessionId: 'local-agent-runtime', workspaceKey, playlistVersion,
          layoutDraft: request.layoutDraft ?? input.currentLayoutDraft,
          scope: {
            targetTimeRange: request.targetTimeRange,
            taskKind: request.lifecycle?.taskKind,
            objective: request.reactTask?.objective,
            searchKeywords: request.searchKeywords,
          },
        })
      : undefined
    const trustedRequest = { ...request, resolvedAuthorization }
    if (!request.reactRecovery) {
      this.activeReactContext = {
        request: { ...request, reactRecovery: undefined, resolvedAuthorization: undefined },
        workspaceKey,
        playlistVersion,
      }
    }
    const outcome = await this.runtime.startReactOrchestration(trustedRequest, input)
    if (outcome.status === 'waiting_user' && outcome.scheduleItems && this.activeReactContext) {
      this.activeReactContext.playlistVersion = buildFormalPlaylistSnapshot(outcome.scheduleItems, 'foreground').version
      if (request.authorizationGrantId) {
        this.formalRebuildGrants.advancePlaylistVersion(request.authorizationGrantId, this.activeReactContext.playlistVersion)
      }
    }
    if (outcome.status === 'completed' && !request.reactRecovery) {
      if (request.authorizationGrantId) this.formalRebuildGrants.setStatus(request.authorizationGrantId, 'consumed')
      this.activeReactContext = null
    }
    return outcome
  }

  async recoverReactOrchestration(input: AgentServerReactRecoveryInput): Promise<AgentServerReactRecoveryResult> {
    const context = this.activeReactContext
    const recovery = prepareFormalOrchestrationRecovery({
      sessionId: 'local-agent-runtime',
      action: input.action,
      requestedWorkspaceKey: input.workspaceKey,
      checkpointWorkspaceKey: context?.workspaceKey,
      expectedPlaylistVersion: context?.playlistVersion,
      actualPlaylistVersion: input.playlistVersion,
      checkpoints: this.runtime.getReactCheckpoints(),
    })
    if (recovery.status === 'cancelled') {
      this.activeReactContext = null
      return recovery
    }
    if (recovery.status !== 'ready' || !context || !input.runtimeInput || !recovery.resumePlan) {
      return recovery
    }
    const resolvedAuthorization = context.request.authorizationGrantId
      ? this.formalRebuildGrants.resolve(context.request.authorizationGrantId, {
          sessionId: 'local-agent-runtime', workspaceKey: context.workspaceKey,
          playlistVersion: context.playlistVersion,
          layoutDraft: context.request.layoutDraft ?? input.runtimeInput.currentLayoutDraft,
          scope: {
            targetTimeRange: context.request.targetTimeRange,
            taskKind: context.request.lifecycle?.taskKind,
            objective: context.request.reactTask?.objective,
            searchKeywords: context.request.searchKeywords,
          },
        })
      : undefined
    const outcome = await this.runtime.startReactOrchestration({
      ...context.request, reactRecovery: recovery.resumePlan, resolvedAuthorization,
    }, input.runtimeInput)
    if (outcome.status === 'waiting_user' && outcome.scheduleItems) {
      context.playlistVersion = buildFormalPlaylistSnapshot(outcome.scheduleItems, 'foreground').version
      if (context.request.authorizationGrantId) {
        this.formalRebuildGrants.advancePlaylistVersion(context.request.authorizationGrantId, context.playlistVersion)
      }
    }
    if (outcome.status === 'completed') {
      if (context.request.authorizationGrantId) this.formalRebuildGrants.setStatus(context.request.authorizationGrantId, 'consumed')
      this.activeReactContext = null
    }
    return {
      ...recovery,
      executionStatus: outcome.status,
      scheduleItems: outcome.scheduleItems,
    }
  }

  async cancelActiveInstruction(_workspaceKey: string): Promise<{ stopped: boolean; reason: 'stopped' }> {
    this.runtime.cancelOrchestration()
    return { stopped: true, reason: 'stopped' }
  }
}

export class HttpAgentRuntimeClient implements AgentRuntimeClient {
  private sessionId: string | null = this.readStoredSessionId()
  private llmConfigBridge: Promise<void> | null = null
  /**
   * 当前活跃的 SSE 订阅。null 表示无订阅。
   * 仅持有 EventSource 实例，便于 close 释放资源。
   */
  private activeSse: EventSource | null = null
  /**
   * 本轮 submit 已通过 SSE 送达的 progress 事件 dedupeKey 集合。
   *
   * 提升为实例字段（而非封装在 activeSse 内）的原因：
   * - SSE onerror 触发 closeProgressStream 时 activeSse 会被置 null，
   *   但 deliveredIds 必须保留，供 POST 返回后路径 B 回放按 id 去重，
   *   避免"已通过 SSE 实时展示的气泡被路径 B 重复回放"。
   * - 在 openProgressStream 入口重置为空 Set，标志新一轮开始。
   */
  private deliveredIds: Set<string> = new Set()

  constructor(private readonly baseUrl: string = resolveAgentRuntimeBaseUrl()) {}

  async submitInstruction(input: RuntimeSubmitInput): Promise<RuntimeDecision> {
    await this.ensureServerLlmConfig()
    const {
      foregroundContextPackage: _foregroundContextPackage,
      deadline: _deadline,
      onProgress,
      ...serverInput
    } = input

    // 路径 A 流式：仅在需要进度回调时，先确保有 sessionId 用于 SSE 订阅
    // 无 onProgress 时走原流程（POST submit 不带 sessionId，后端建 session 返回）
    if (onProgress) {
      const sessionId = await this.ensureServerSessionId()
      if (sessionId) {
        // submitStartTime 在 session 建立后、SSE 打开前记录，避免 ensureServerSessionId
        // 网络往返耗时让时间戳偏早、过滤容差变大。用于 SSE 时间戳过滤上一轮残留 progress。
        const submitStartTime = Date.now()
        const opened = this.openProgressStream(sessionId, onProgress, submitStartTime)
        if (opened) await this.awaitProgressStreamReady()
      }
    }

    // try/finally 保证 POST 抛异常（网络错误、500、JSON 解析失败）时 SSE 资源被释放，
    // 避免后端 subscribeSessionEvents listener 泄漏导致 session store 死键。
    try {
      const envelope = await this.post<RuntimeEnvelope<RuntimeDecision>>('/api/agent/submit', {
        sessionId: this.sessionId,
        input: serverInput,
      })
      this.syncSession(envelope.sessionId)

      // 路径 B 回放：SSE 已送达的按 id 去重，未送达的补推；SSE 失败时全量回放。
      // 用实例字段 this.deliveredIds 而非 activeSse?.deliveredIds，保证 onerror 关闭 SSE 后仍能去重。
      if (onProgress && Array.isArray(envelope.progressEvents)) {
        for (const event of envelope.progressEvents) {
          const dedupeKey = event.id || `${event.processTypeLabel}:${event.content}`
          if (this.deliveredIds.has(dedupeKey)) continue
          try {
            onProgress(event)
          } catch {
            // 进度事件只用于辅助展示，不能阻塞主流程
          }
        }
      }

      if (!envelope.decision) throw new Error('Agent server did not return a runtime decision.')
      return envelope.decision
    } finally {
      this.closeProgressStream()
    }
  }

  async startReactOrchestration(request: RuntimeOrchestrationRequest, input: RuntimeSubmitInput): Promise<RuntimeReactOrchestrationOutcome> {
    await this.ensureServerLlmConfig()
    const sessionId = await this.ensureServerSessionId()
    const { foregroundContextPackage: _foregroundContextPackage, deadline: _deadline, onProgress, ...serverInput } = input
    if (onProgress && sessionId) {
      const submitStartTime = Date.now()
      const opened = this.openProgressStream(sessionId, onProgress, submitStartTime)
      if (opened) await this.awaitProgressStreamReady()
    }
    try {
      const envelope = await this.post<RuntimeEnvelope<RuntimeReactOrchestrationOutcome>>('/api/agent/orchestration', {
        sessionId,
        request,
        input: serverInput,
      })
      this.syncSession(envelope.sessionId)
      this.replayProgressEvents(envelope.progressEvents, onProgress)
      if (!envelope.result) throw new Error('Agent server did not return a ReAct orchestration outcome.')
      return envelope.result
    } finally {
      this.closeProgressStream()
    }
  }

  async recoverReactOrchestration(input: AgentServerReactRecoveryInput): Promise<AgentServerReactRecoveryResult> {
    const sessionId = await this.ensureServerSessionId()
    if (!sessionId) throw new Error('Agent server session 不可用，无法恢复 ReAct 任务。')
    const runtimeInput = input.runtimeInput
      ? (() => {
          const {
            foregroundContextPackage: _foregroundContextPackage,
            deadline: _deadline,
            onProgress: _onProgress,
            ...serverInput
          } = input.runtimeInput!
          return serverInput
        })()
      : undefined
    const envelope = await this.post<RuntimeEnvelope<AgentServerReactRecoveryResult>>(
      `/api/agent/sessions/${encodeURIComponent(sessionId)}/orchestration/recover`,
      { ...input, runtimeInput },
    )
    if (!envelope.result) throw new Error('Agent server did not return a ReAct recovery result.')
    return envelope.result
  }

  async cancelActiveInstruction(workspaceKey: string): Promise<{
    stopped: boolean
    reason: 'stopped' | 'not_found' | 'workspace_mismatch' | 'not_stoppable'
  }> {
    const sessionId = await this.ensureServerSessionId()
    if (!sessionId) return { stopped: false, reason: 'not_found' }
    return await this.post(`/api/agent/sessions/${encodeURIComponent(sessionId)}/instruction/stop`, {
      workspaceKey,
    })
  }

  /**
   * 确保前端持有有效 sessionId。
   * 优先复用 sessionStorage 中的；不存在则 POST /api/agent/sessions 新建并落盘。
   */
  private async ensureServerSessionId(): Promise<string | null> {
    if (this.sessionId) return this.sessionId
    try {
      const envelope = await this.post<{ session: { id: string } }>('/api/agent/sessions', {})
      this.syncSession(envelope.session.id)
      return this.sessionId
    } catch {
      return null
    }
  }

  /**
   * 打开 SSE 订阅，实时接收后端 progress 事件并回调 onProgress。
   * 仅在浏览器环境且支持 EventSource 时启用；返回是否成功建立。
   * 失败时调用方应回退到路径 B 的 envelope.progressEvents 数组回放。
   *
   * 实现要点（修复 SSE 流式推送不生效的关键设计）：
   * - 不再依赖后端 ready 标志过滤历史事件。SSE 历史事件阶段（ready 之前）也会触发 progress 监听器，
   *   由 safeParseProgressEvent 用 submitStartTime 时间戳过滤掉上一轮残留的 progress 事件。
   * - deliveredIds 作为实例字段，在所有阶段（历史 + live）都记录已送达事件 id；
   *   POST 返回后路径 B 回放按 id 去重，即使 SSE 中途 onerror 关闭也能正确去重。
   * - 这样即使 ready 事件延迟到达或丢失，新一轮 progress 事件仍能被实时处理，避免降级到批量回放。
   *
   * @param sessionId 后端 session id
   * @param onProgress progress 事件回调
   * @param submitStartTime 本轮 POST 之前的前端时间戳，用于过滤上一轮残留 progress
   */
  private openProgressStream(
    sessionId: string,
    onProgress: (event: RuntimeProgressEvent) => void,
    submitStartTime: number,
  ): boolean {
    if (typeof window === 'undefined' || typeof EventSource === 'undefined') return false
    // 关闭可能残留的上一轮订阅，避免重复推送
    this.closeProgressStream()
    // 重置 deliveredIds，标志新一轮 submit 开始（上一轮的去重集合不再需要）
    this.deliveredIds = new Set()
    const url = `${this.baseUrl}/api/agent/sessions/${encodeURIComponent(sessionId)}/events?follow=1`
    const source = new EventSource(url)
    // 所有 progress 事件统一处理：时间戳过滤上一轮残留 + deliveredIds 去重
    source.addEventListener('progress', (raw) => {
      const payload = safeParseProgressEvent(raw.data, submitStartTime)
      if (!payload) return
      const dedupeKey = payload.id || `${payload.processTypeLabel}:${payload.content}`
      if (this.deliveredIds.has(dedupeKey)) return
      this.deliveredIds.add(dedupeKey)
      try { onProgress(payload) } catch { /* 进度事件不能阻塞主流程 */ }
    })
    // onerror 时直接关闭，本轮后续走路径 B 回放（避免重连导致历史事件被当成 live 重复推送）
    source.onerror = () => { this.closeProgressStream() }
    this.activeSse = source
    return true
  }

  /**
   * 关闭 SSE 订阅并释放 EventSource 资源。POST 返回后或 onerror 后调用。
   *
   * 注意：不清空 this.deliveredIds。路径 B 回放仍需它去重已通过 SSE 送达的事件，
   * 避免 onerror 触发关闭后路径 B 把已展示的气泡再回放一遍。
   */
  private closeProgressStream(): void {
    if (!this.activeSse) return
    this.activeSse.close()
    this.activeSse = null
  }

  private replayProgressEvents(
    events: RuntimeProgressEvent[] | undefined,
    onProgress: RuntimeSubmitInput['onProgress'],
  ): void {
    if (!onProgress || !Array.isArray(events)) return
    for (const event of events) {
      const dedupeKey = event.id || `${event.processTypeLabel}:${event.content}`
      if (this.deliveredIds.has(dedupeKey)) continue
      this.deliveredIds.add(dedupeKey)
      try {
        onProgress(event)
      } catch {
        // 进度投影不能阻塞正式执行结果。
      }
    }
  }

  /**
   * 等待 SSE 连接就绪（收到后端 ready 事件），超时则降级到路径 B。
   *
   * ready 事件是后端在 subscribeSessionEvents 注册之后立即发送的标记。
   * 等待 ready 能保证 POST 在订阅注册之后到达后端，从而让本轮 progress 事件
   * 通过 SSE 实时推送（而不是被当成历史事件批量重放）。
   *
   * 超时阈值 3000ms：覆盖跨域握手 + 浏览器 SSE 流解析延迟。
   * 超时后仍继续 POST，本轮 progress 由路径 B envelope.progressEvents 回放补全。
   *
   * @param timeoutMs 超时毫秒数，默认 3000
   * @returns 是否在超时前收到 ready 事件
   */
  private awaitProgressStreamReady(timeoutMs = 3000): Promise<boolean> {
    const source = this.activeSse
    if (!source) return Promise.resolve(false)
    return new Promise((resolve) => {
      let settled = false
      const onReady = () => {
        if (settled) return
        settled = true
        cleanup()
        resolve(true)
      }
      const onTimeout = () => {
        if (settled) return
        settled = true
        cleanup()
        resolve(false)
      }
      const cleanup = () => {
        source.removeEventListener('ready', onReady)
        clearTimeout(timer)
      }
      source.addEventListener('ready', onReady)
      const timer = setTimeout(onTimeout, timeoutMs)
    })
  }

  async executePendingCommand(input: RuntimeExecutePendingCommandInput): Promise<RuntimeExecutedResult> {
    const {
      pendingCommand,
      currentSchedule: _currentSchedule,
      ...restInput
    } = input
    const envelope = await this.post<RuntimeEnvelope<RuntimeExecutedResult>>('/api/agent/pending/execute', {
      sessionId: this.sessionId,
      input: {
        ...restInput,
        pendingId: input.pendingId ?? pendingCommand.pendingId,
      },
    })
    this.syncSession(envelope.sessionId)
    if (!envelope.result) throw new Error('Agent server did not return a pending command result.')
    return envelope.result
  }

  async resolvePendingTargetSelection(input: RuntimeResolveTargetSelectionInput): Promise<RuntimeDecision> {
    await this.ensureServerLlmConfig()
    const {
      pendingTargetSelection,
      ...restInput
    } = input
    const envelope = await this.post<RuntimeEnvelope<RuntimeDecision>>('/api/agent/pending/target-selection', {
      sessionId: this.sessionId,
      input: {
        ...restInput,
        pendingId: pendingTargetSelection.pendingId,
        selectedItemId: pendingTargetSelection.selectedItemId,
      },
    })
    this.syncSession(envelope.sessionId)
    if (!envelope.decision) throw new Error('Agent server did not return a target-selection decision.')
    return envelope.decision
  }

  async resolvePendingInsertRecommendation(input: RuntimeResolveInsertRecommendationInput): Promise<RuntimeDecision> {
    await this.ensureServerLlmConfig()
    const {
      pendingInsertRecommendation,
      currentSchedule: _currentSchedule,
      ...restInput
    } = input
    const envelope = await this.post<RuntimeEnvelope<RuntimeDecision>>('/api/agent/pending/insert-recommendation', {
      sessionId: this.sessionId,
      input: {
        ...restInput,
        pendingId: pendingInsertRecommendation.pendingId,
        selectedCandidateId: pendingInsertRecommendation.selectedCandidateId,
      },
    })
    this.syncSession(envelope.sessionId)
    if (!envelope.decision) throw new Error('Agent server did not return an insert-recommendation decision.')
    return envelope.decision
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    })
    if (!response.ok) {
      const message = await response.text().catch(() => '')
      throw new Error(message || `Agent server request failed: ${response.status}`)
    }
    return await response.json() as T
  }

  private async get<T>(path: string): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`)
    if (!response.ok) {
      const message = await response.text().catch(() => '')
      throw new Error(message || `Agent server request failed: ${response.status}`)
    }
    return await response.json() as T
  }

  private async ensureServerLlmConfig(): Promise<void> {
    if (!this.llmConfigBridge) {
      this.llmConfigBridge = this.bridgeExistingForegroundLlmConfig()
    }
    await this.llmConfigBridge
  }

  private async bridgeExistingForegroundLlmConfig(): Promise<void> {
    const status = await this.get<ServerLlmConfigStatus>('/api/agent/llm-config/status').catch(() => null)
    if (status?.llm?.configured) return

    const localConfig = loadLLMConfig()
    if (isPlaceholderApiKey(localConfig.apiKey)) return

    await this.post('/api/agent/llm-config/import', {
      config: localConfig,
    }).catch(() => undefined)
  }

  private syncSession(sessionId?: string): void {
    if (sessionId) {
      this.sessionId = sessionId
      this.writeStoredSessionId(sessionId)
    }
  }

  private readStoredSessionId(): string | null {
    if (typeof sessionStorage === 'undefined') return null
    return sessionStorage.getItem(HTTP_SESSION_STORAGE_KEY)
  }

  private writeStoredSessionId(sessionId: string): void {
    if (typeof sessionStorage === 'undefined') return
    sessionStorage.setItem(HTTP_SESSION_STORAGE_KEY, sessionId)
  }
}

let globalAgentRuntimeClient: AgentRuntimeClient | null = null

export function getAgentRuntimeClient(): AgentRuntimeClient {
  if (!globalAgentRuntimeClient) {
    globalAgentRuntimeClient = isHttpAgentRuntimeEnabled()
      ? new HttpAgentRuntimeClient()
      : new LocalAgentRuntimeClient()
  }
  return globalAgentRuntimeClient
}

export function setAgentRuntimeClientForTests(client: AgentRuntimeClient | null): void {
  globalAgentRuntimeClient = client
}
