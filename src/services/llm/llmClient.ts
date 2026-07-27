/**
 * LLM 客户端封装
 * 使用 OpenAI SDK 兼容 Moonshot API
 */
import OpenAI from 'openai'
import type {
  LLMConfig,
  ChatMessage,
  LLMResponse,
  ChatOptions,
  LLMRequestTrace,
  TokenUsageStats,
} from '@/types/llm'
import { loadLLMConfig, validateLLMConfig } from './llmConfig'
import { createLocalDemoLlmResponse, isPlaceholderApiKey } from './localDemoLlm'
import {
  getLlmCallMonitor,
  inferLlmCallStatus,
  sanitizeErrorMessage,
} from '../agent/llmCallMonitor'

const DEFAULT_REQUEST_TIMEOUT_MS = 15000

const resolveRequestTimeout = (configuredTimeout?: number): number => {
  const timeout = configuredTimeout ?? DEFAULT_REQUEST_TIMEOUT_MS
  return Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_REQUEST_TIMEOUT_MS
}

type BrowserLlmMockInput = {
  messages: ChatMessage[]
  options?: ChatOptions
  config: LLMConfig
}

type BrowserLlmMockResult = LLMResponse | string | null | undefined

type BrowserLlmMock = (input: BrowserLlmMockInput) => BrowserLlmMockResult | Promise<BrowserLlmMockResult>

declare global {
  interface Window {
    __AIBIANDAN_LLM_MOCK__?: BrowserLlmMock
  }
}

const isViteDevRuntime = (): boolean => {
  const env = (import.meta as ImportMeta & { env?: { DEV?: boolean } }).env
  return env?.DEV === true
}

export class LLMClient {
  private client: OpenAI | null = null
  private config: LLMConfig
  private tokenUsage: TokenUsageStats = {
    totalPromptTokens: 0,
    totalCompletionTokens: 0,
    totalTokens: 0,
    requestCount: 0,
  }
  private recentRequestTraces: LLMRequestTrace[] = []
  private cachedFatalConfigError: Error | null = null

  constructor(config?: Partial<LLMConfig>) {
    this.config = config ? { ...loadLLMConfig(), ...config } : loadLLMConfig()
    this.initClient()
  }

  /**
   * 初始化 OpenAI 客户端
   */
  private initClient(): void {
    const validation = validateLLMConfig(this.config)
    if (!validation.valid) {
      const onlyMissingApiKey = validation.errors.every((error) => error.includes('API Key'))
      if (!onlyMissingApiKey) {
        console.warn('LLM config validation failed:', validation.errors)
      }
      return
    }

    this.client = new OpenAI({
      baseURL: this.config.baseURL,
      apiKey: this.config.apiKey,
      timeout: this.config.timeout,
      dangerouslyAllowBrowser: true,
    })
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<LLMConfig>): void {
    this.config = { ...this.config, ...config }
    this.cachedFatalConfigError = null
    this.initClient()
  }

  /**
   * 发送聊天请求
   */
  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<LLMResponse> {
    const requestTimeout = resolveRequestTimeout(options?.timeout ?? this.config.timeout)
    const traceLabel = options?.traceLabel ?? 'chat'
    const promptVersion = options?.promptVersion
    const startedAt = Date.now()
    const promptStats = this.buildPromptTraceStats(messages)
    const browserMockResponse = await this.tryBrowserMockChat(messages, options, requestTimeout, traceLabel, startedAt)
    if (browserMockResponse) {
      return browserMockResponse
    }

    if (!this.client && isPlaceholderApiKey(this.config.apiKey)) {
      const localResponse = createLocalDemoLlmResponse(messages)
      if (localResponse) {
        this.emitSingleToken(localResponse.content, options, startedAt)
        this.recordRequestTrace({
          label: traceLabel,
          attemptCount: 1,
          durationMs: Date.now() - startedAt,
          timeoutMs: requestTimeout,
          ...promptStats,
          success: true,
          startedAt: new Date(startedAt).toISOString(),
          promptVersion,
        }, localResponse.usage ? { prompt: localResponse.usage.promptTokens, completion: localResponse.usage.completionTokens, total: localResponse.usage.totalTokens } : undefined)
        return localResponse
      }
    }
    if (!this.client) {
      throw new Error('LLM client not initialized. Please check your configuration.')
    }
    if (this.cachedFatalConfigError) {
      throw this.cachedFatalConfigError
    }

    if (options?.onToken) {
      return this.chatWithStreaming(messages, options)
    }

    const maxRetries = Math.max(1, options?.maxRetries ?? 1)
    let lastError: Error | null = null
    let attempts = 0

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      attempts = attempt + 1
      try {
        const remainingRequestBudget = attempt === 0
          ? requestTimeout
          : Math.max(1, requestTimeout - (Date.now() - startedAt))
        const response = await this.withTimeout(
          this.client.chat.completions.create({
            model: this.config.model,
            messages: messages.map((m) => ({
              role: m.role,
              content: m.content,
            })),
            temperature: options?.temperature ?? this.config.temperature,
            max_tokens: options?.maxTokens ?? this.config.maxTokens,
            ...(options?.responseFormat
              ? { response_format: { type: options.responseFormat } }
              : {}),
          }, { timeout: remainingRequestBudget, ...(options?.signal ? { signal: options.signal } : {}) }),
          remainingRequestBudget,
          options?.signal,
        )

        const usage = response.usage
        if (usage) {
          this.tokenUsage.totalPromptTokens += usage.prompt_tokens
          this.tokenUsage.totalCompletionTokens += usage.completion_tokens
          this.tokenUsage.totalTokens += usage.total_tokens
          this.tokenUsage.requestCount++
        }

        this.recordRequestTrace({
          label: traceLabel,
          attemptCount: attempts,
          durationMs: Date.now() - startedAt,
          timeoutMs: requestTimeout,
          ...promptStats,
          success: true,
          startedAt: new Date(startedAt).toISOString(),
          promptVersion,
        }, usage ? { prompt: usage.prompt_tokens, completion: usage.completion_tokens, total: usage.total_tokens } : undefined)

        return {
          content: response.choices[0]?.message?.content || '',
          usage: usage
            ? {
                promptTokens: usage.prompt_tokens,
                completionTokens: usage.completion_tokens,
                totalTokens: usage.total_tokens,
              }
            : undefined,
        }
      } catch (error) {
        lastError = this.normalizeError(error)
        console.warn(`LLM request failed (attempt ${attempt + 1}/${maxRetries}):`, error)

        if (options?.signal?.aborted) break
        if (!this.isRetriableError(error)) {
          if (this.isFatalConfigError(error)) {
            this.cachedFatalConfigError = lastError
          }
          break
        }

        // 指数退避
        if (attempt < maxRetries - 1) {
          const delay = Math.pow(2, attempt) * 1000
          const remainingRequestBudget = requestTimeout - (Date.now() - startedAt)
          if (remainingRequestBudget <= delay) break
          await this.sleep(delay, options?.signal)
        }
      }
    }

    this.recordRequestTrace({
      label: traceLabel,
      attemptCount: attempts,
      durationMs: Date.now() - startedAt,
      timeoutMs: requestTimeout,
      ...promptStats,
      success: false,
      error: lastError?.message,
      startedAt: new Date(startedAt).toISOString(),
      promptVersion,
    }, undefined)

    throw new Error(
      `LLM request failed after ${attempts} attempt${attempts === 1 ? '' : 's'}: ${lastError?.message}`,
    )
  }

  private async chatWithStreaming(messages: ChatMessage[], options: ChatOptions): Promise<LLMResponse> {
    const startedAt = Date.now()
    let content = ''
    let index = 0
    let firstTokenLatencyMs = 0
    for await (const delta of this.chatStream(messages, options)) {
      content += delta
      const elapsedMs = Date.now() - startedAt
      if (index === 0) firstTokenLatencyMs = elapsedMs
      try {
        options.onToken?.(delta, {
          index,
          receivedChars: content.length,
          elapsedMs,
          firstTokenLatencyMs,
        })
      } catch {
        // 展示回调不能阻断结构化 LLM 主链路。
      }
      index += 1
    }
    return { content }
  }

  private emitSingleToken(content: string, options: ChatOptions | undefined, startedAt: number): void {
    if (!content || !options?.onToken) return
    const elapsedMs = Date.now() - startedAt
    try {
      options.onToken(content, {
        index: 0,
        receivedChars: content.length,
        elapsedMs,
        firstTokenLatencyMs: elapsedMs,
      })
    } catch {
      // 展示回调不能改变模型结果。
    }
  }

  private async tryBrowserMockChat(
    messages: ChatMessage[],
    options: ChatOptions | undefined,
    requestTimeout: number,
    traceLabel: string,
    startedAt: number,
  ): Promise<LLMResponse | null> {
    if (!isViteDevRuntime() || typeof window === 'undefined') return null
    const mock = window.__AIBIANDAN_LLM_MOCK__
    if (typeof mock !== 'function') return null
    const promptStats = this.buildPromptTraceStats(messages)
    const promptVersion = options?.promptVersion

    try {
      // 传播 options.signal 到 mock 路径，保证 AgentDeadline abort 时 mock 请求也能被中止，
      // 与主链路（this.client.chat.completions.create）的 signal 传播保持一致。
      const rawResponse = await this.withTimeout(
        Promise.resolve(mock({
          messages,
          options,
          config: { ...this.config },
        })),
        requestTimeout,
        options?.signal,
      )
      if (rawResponse === null || rawResponse === undefined) return null

      const response: LLMResponse = typeof rawResponse === 'string'
        ? { content: rawResponse }
        : rawResponse

      this.emitSingleToken(response.content, options, startedAt)

      if (response.usage) {
        this.tokenUsage.totalPromptTokens += response.usage.promptTokens
        this.tokenUsage.totalCompletionTokens += response.usage.completionTokens
        this.tokenUsage.totalTokens += response.usage.totalTokens
        this.tokenUsage.requestCount++
      }

      this.recordRequestTrace({
        label: traceLabel,
        attemptCount: 1,
        durationMs: Date.now() - startedAt,
        timeoutMs: requestTimeout,
        ...promptStats,
        success: true,
        startedAt: new Date(startedAt).toISOString(),
        promptVersion,
      }, response.usage ? { prompt: response.usage.promptTokens, completion: response.usage.completionTokens, total: response.usage.totalTokens } : undefined)

      return response
    } catch (error) {
      const normalized = this.normalizeError(error)
      this.recordRequestTrace({
        label: traceLabel,
        attemptCount: 1,
        durationMs: Date.now() - startedAt,
        timeoutMs: requestTimeout,
        ...promptStats,
        success: false,
        error: normalized.message,
        startedAt: new Date(startedAt).toISOString(),
        promptVersion,
      }, undefined)
      throw normalized
    }
  }

  /**
   * 流式聊天请求
   *
   * trace 落盘：在 finally 块调用 recordRequestTrace，保证成功 / 失败 / 提前 break 都能审计。
   * 流式语义保持不变：yield 顺序 / 时机 / 内容与 token 计数公式均与未接入前一致。
   */
  async *chatStream(
    messages: ChatMessage[],
    options?: ChatOptions,
  ): AsyncGenerator<string, void, unknown> {
    const traceLabel = options?.traceLabel ?? 'chat_stream'
    const promptVersion = options?.promptVersion
    const requestTimeout = resolveRequestTimeout(options?.timeout ?? this.config.timeout)
    const startedAt = Date.now()
    const promptStats = this.buildPromptTraceStats(messages)
    let success = true
    let errorMessage: string | undefined

    let promptTokens = 0
    let completionTokens = 0
    let firstTokenLatencyMs: number | undefined

    try {
      if (!this.client) {
        throw new Error('LLM client not initialized. Please check your configuration.')
      }

      const stream = await this.withTimeout(
        this.client.chat.completions.create({
          model: this.config.model,
          messages: messages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
          temperature: options?.temperature ?? this.config.temperature,
          max_tokens: options?.maxTokens ?? this.config.maxTokens,
          stream: true,
          ...(options?.responseFormat
            ? { response_format: { type: options.responseFormat } }
            : {}),
        }, {
          timeout: requestTimeout,
          ...(options?.signal ? { signal: options.signal } : {}),
        }),
        requestTimeout,
        options?.signal,
      )

      // SDK 的 create timeout 只覆盖建连；每次 next 也必须受同一整体 deadline 约束，
      // 防止连接成功后模型在迭代阶段无限等待。停止或超时后主动关闭迭代器，保留失败现场。
      const iterator = stream[Symbol.asyncIterator]()
      try {
        while (true) {
          const remainingMs = Math.max(1, requestTimeout - (Date.now() - startedAt))
          const next = await this.withTimeout(iterator.next(), remainingMs, options?.signal)
          if (next.done) break
          const content = next.value.choices[0]?.delta?.content
          if (content) {
            if (firstTokenLatencyMs === undefined) firstTokenLatencyMs = Date.now() - startedAt
            completionTokens++
            yield content
          }
        }
      } finally {
        if (typeof iterator.return === 'function') {
          // 某些 SDK iterator 在 abort 后的 return 也可能等待底层连接；关闭是
          // best-effort，不能让清理动作重新阻塞已经触发的 deadline。
          void iterator.return()
        }
      }

      // 估算 prompt tokens
      promptTokens = messages.reduce((acc, m) => acc + Math.ceil(m.content.length / 4), 0)

      this.tokenUsage.totalPromptTokens += promptTokens
      this.tokenUsage.totalCompletionTokens += completionTokens
      this.tokenUsage.totalTokens += promptTokens + completionTokens
      this.tokenUsage.requestCount++
    } catch (error) {
      success = false
      errorMessage = this.normalizeError(error).message
      throw error
    } finally {
      this.recordRequestTrace({
        label: traceLabel,
        attemptCount: 1,
        durationMs: Date.now() - startedAt,
        timeoutMs: requestTimeout,
        ...promptStats,
        success,
        error: errorMessage,
        startedAt: new Date(startedAt).toISOString(),
        promptVersion,
        firstTokenLatencyMs,
      }, { prompt: promptTokens, completion: completionTokens, total: promptTokens + completionTokens })
    }
  }

  /**
   * 测试连接
   */
  async testConnection(): Promise<boolean> {
    try {
      await this.chat(
        [
          {
            role: 'user',
            content: 'Hello',
          },
        ],
        { maxTokens: 10 },
      )
      return true
    } catch (error) {
      console.error('LLM connection test failed:', this.normalizeError(error))
      return false
    }
  }

  /**
   * 获取 Token 使用统计
   */
  getTokenUsage(): TokenUsageStats {
    return { ...this.tokenUsage }
  }

  /**
   * 重置 Token 使用统计
   */
  resetTokenUsage(): void {
    this.tokenUsage = {
      totalPromptTokens: 0,
      totalCompletionTokens: 0,
      totalTokens: 0,
      requestCount: 0,
    }
  }

  /**
   * 获取当前配置
   */
  getConfig(): LLMConfig {
    return { ...this.config }
  }

  getRecentRequestTraces(): LLMRequestTrace[] {
    return [...this.recentRequestTraces]
  }

  /**
   * 记录 LLM 请求 trace，并同步到 LLM 调用监控器
   *
   * @param trace - 请求 trace 对象
   * @param tokenUsage - 可选的 token 使用统计
   */
  private recordRequestTrace(
    trace: LLMRequestTrace,
    tokenUsage?: { prompt: number; completion: number; total: number },
  ): void {
    this.recentRequestTraces = [trace, ...this.recentRequestTraces].slice(0, 20)

    getLlmCallMonitor().record({
      stage: trace.label,
      model: this.config.model,
      tokenUsage: tokenUsage ?? { prompt: 0, completion: 0, total: 0 },
      latencyMs: trace.durationMs,
      firstTokenLatencyMs: trace.firstTokenLatencyMs,
      timeoutMs: trace.timeoutMs,
      attemptCount: trace.attemptCount,
      promptVersion: trace.promptVersion,
      messageCount: trace.messageCount,
      promptCharCount: trace.promptCharCount,
      systemCharCount: trace.systemCharCount,
      userCharCount: trace.userCharCount,
      status: inferLlmCallStatus(trace.success, trace.error),
      errorMessage: sanitizeErrorMessage(trace.error),
      startedAt: trace.startedAt,
    })
  }

  private buildPromptTraceStats(messages: ChatMessage[]): Pick<
    LLMRequestTrace,
    'messageCount' | 'promptCharCount' | 'systemCharCount' | 'userCharCount'
  > {
    return messages.reduce((stats, message) => {
      const length = message.content.length
      stats.messageCount += 1
      stats.promptCharCount += length
      if (message.role === 'system') stats.systemCharCount += length
      if (message.role === 'user') stats.userCharCount += length
      return stats
    }, {
      messageCount: 0,
      promptCharCount: 0,
      systemCharCount: 0,
      userCharCount: 0,
    })
  }

  /**
   * 延迟函数
   */
  private sleep(ms: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) {
      return Promise.reject(Object.assign(new Error('LLM retry aborted before backoff'), { code: 'EABORTED' }))
    }
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        signal?.removeEventListener('abort', abortHandler)
        resolve()
      }, ms)
      const abortHandler = () => {
        clearTimeout(timeoutId)
        reject(Object.assign(new Error('LLM retry aborted during backoff'), { code: 'EABORTED' }))
      }
      signal?.addEventListener('abort', abortHandler, { once: true })
    })
  }

  private withTimeout<T>(promise: Promise<T>, timeoutMs: number, signal?: AbortSignal): Promise<T> {
    // signal 已中止时立即 reject，避免继续占用底层 LLM 请求资源
    if (signal?.aborted) {
      return Promise.reject(Object.assign(new Error('LLM request aborted before start'), { code: 'EABORTED' }))
    }
    let timeoutId: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(Object.assign(new Error(`LLM request timed out after ${timeoutMs}ms`), { code: 'ETIMEDOUT' }))
      }, timeoutMs)
    })

    // 监听外部 signal，aborted 时立即 reject，联动 AgentDeadline 中止。
    // 在 finally 中 removeEventListener，避免长流程下多个 LLM 调用累积监听器导致内存泄漏
    // （{ once: true } 仅在 abort 触发时自动移除；正常完成时监听器仍挂在 signal 上直到 AbortController 被 GC）
    let abortHandler: (() => void) | undefined
    const abortPromise = signal
      ? new Promise<never>((_, reject) => {
          abortHandler = () => {
            reject(Object.assign(new Error('LLM request aborted'), { code: 'EABORTED' }))
          }
          signal.addEventListener('abort', abortHandler, { once: true })
        })
      : null

    const racers: Promise<T>[] = [promise, timeout as Promise<T>]
    if (abortPromise) racers.push(abortPromise as Promise<T>)

    return Promise.race(racers).finally(() => {
      if (timeoutId) clearTimeout(timeoutId)
      if (signal && abortHandler) {
        signal.removeEventListener('abort', abortHandler)
      }
    })
  }

  /**
   * 将底层 SDK / HTTP 错误转换为更适合界面展示的提示
   */
  private normalizeError(error: unknown): Error {
    if (error instanceof Error) {
      const maybeStatus = (error as Error & { status?: number; code?: string }).status
      const maybeCode = (error as Error & { status?: number; code?: string }).code

      if (maybeStatus === 401) {
        return new Error('LLM 认证失败，请检查 API Key 是否正确。')
      }

      if (maybeStatus === 429) {
        return new Error('LLM 请求过于频繁或额度不足，请稍后重试。')
      }

      if (maybeStatus === 400) {
        return new Error(`LLM 请求参数无效：${error.message}`)
      }

      if (maybeStatus && maybeStatus >= 500) {
        return new Error('LLM 服务暂时不可用，请稍后重试。')
      }

      if (maybeCode === 'ETIMEDOUT' || maybeCode === 'ECONNRESET') {
        return new Error('LLM 网络请求超时，请检查网络或稍后重试。')
      }

      return error
    }

    return new Error('LLM 请求失败，请检查配置和网络连接。')
  }

  private isRetriableError(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return true
    }

    const maybeStatus = (error as Error & { status?: number }).status
    if (!maybeStatus) {
      return true
    }

    if (maybeStatus === 400 || maybeStatus === 401 || maybeStatus === 403) {
      return false
    }

    return maybeStatus === 408 || maybeStatus === 409 || maybeStatus === 429 || maybeStatus >= 500
  }

  private isFatalConfigError(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false
    }

    const maybeStatus = (error as Error & { status?: number }).status
    return maybeStatus === 401 || maybeStatus === 403
  }
}

// 导出单例实例
let globalClient: LLMClient | null = null

export function getLLMClient(): LLMClient {
  if (!globalClient) {
    globalClient = new LLMClient()
  }
  return globalClient
}

export function resetLLMClient(): void {
  globalClient = null
}
