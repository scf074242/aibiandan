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

const DEFAULT_REQUEST_TIMEOUT_MS = 15000
const MAX_REQUEST_TIMEOUT_MS = 60000

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
    const requestTimeout = Math.min(
      options?.timeout ?? this.config.timeout ?? DEFAULT_REQUEST_TIMEOUT_MS,
      MAX_REQUEST_TIMEOUT_MS,
    )
    const traceLabel = options?.traceLabel ?? 'chat'
    const startedAt = Date.now()
    const browserMockResponse = await this.tryBrowserMockChat(messages, options, requestTimeout, traceLabel, startedAt)
    if (browserMockResponse) {
      return browserMockResponse
    }

    if (!this.client && isPlaceholderApiKey(this.config.apiKey)) {
      const localResponse = createLocalDemoLlmResponse(messages)
      if (localResponse) {
        return localResponse
      }
    }
    if (!this.client) {
      throw new Error('LLM client not initialized. Please check your configuration.')
    }
    if (this.cachedFatalConfigError) {
      throw this.cachedFatalConfigError
    }

    const maxRetries = Math.max(1, options?.maxRetries ?? 1)
    let lastError: Error | null = null
    let attempts = 0

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      attempts = attempt + 1
      try {
        const response = await this.withTimeout(
          this.client.chat.completions.create({
            model: this.config.model,
            messages: messages.map((m) => ({
              role: m.role,
              content: m.content,
            })),
            temperature: options?.temperature ?? this.config.temperature,
            max_tokens: options?.maxTokens ?? this.config.maxTokens,
          }, { timeout: requestTimeout }),
          requestTimeout,
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
          success: true,
          startedAt: new Date(startedAt).toISOString(),
        })

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

        if (!this.isRetriableError(error)) {
          if (this.isFatalConfigError(error)) {
            this.cachedFatalConfigError = lastError
          }
          break
        }

        // 指数退避
        if (attempt < maxRetries - 1) {
          const delay = Math.pow(2, attempt) * 1000
          await this.sleep(delay)
        }
      }
    }

    this.recordRequestTrace({
      label: traceLabel,
      attemptCount: attempts,
      durationMs: Date.now() - startedAt,
      timeoutMs: requestTimeout,
      success: false,
      error: lastError?.message,
      startedAt: new Date(startedAt).toISOString(),
    })

    throw new Error(
      `LLM request failed after ${attempts} attempt${attempts === 1 ? '' : 's'}: ${lastError?.message}`,
    )
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

    try {
      const rawResponse = await this.withTimeout(
        Promise.resolve(mock({
          messages,
          options,
          config: { ...this.config },
        })),
        requestTimeout,
      )
      if (rawResponse === null || rawResponse === undefined) return null

      const response: LLMResponse = typeof rawResponse === 'string'
        ? { content: rawResponse }
        : rawResponse

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
        success: true,
        startedAt: new Date(startedAt).toISOString(),
      })

      return response
    } catch (error) {
      const normalized = this.normalizeError(error)
      this.recordRequestTrace({
        label: traceLabel,
        attemptCount: 1,
        durationMs: Date.now() - startedAt,
        timeoutMs: requestTimeout,
        success: false,
        error: normalized.message,
        startedAt: new Date(startedAt).toISOString(),
      })
      throw normalized
    }
  }

  /**
   * 流式聊天请求
   */
  async *chatStream(
    messages: ChatMessage[],
    options?: ChatOptions,
  ): AsyncGenerator<string, void, unknown> {
    if (!this.client) {
      throw new Error('LLM client not initialized. Please check your configuration.')
    }

    const stream = await this.client.chat.completions.create({
      model: this.config.model,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      temperature: options?.temperature ?? this.config.temperature,
      max_tokens: options?.maxTokens ?? this.config.maxTokens,
      stream: true,
    })

    let promptTokens = 0
    let completionTokens = 0

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content
      if (content) {
        completionTokens++
        yield content
      }
    }

    // 估算 prompt tokens
    promptTokens = messages.reduce((acc, m) => acc + Math.ceil(m.content.length / 4), 0)

    this.tokenUsage.totalPromptTokens += promptTokens
    this.tokenUsage.totalCompletionTokens += completionTokens
    this.tokenUsage.totalTokens += promptTokens + completionTokens
    this.tokenUsage.requestCount++
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

  private recordRequestTrace(trace: LLMRequestTrace): void {
    this.recentRequestTraces = [trace, ...this.recentRequestTraces].slice(0, 20)
  }

  /**
   * 延迟函数
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  private withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    let timeoutId: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(Object.assign(new Error(`LLM request timed out after ${timeoutMs}ms`), { code: 'ETIMEDOUT' }))
      }, timeoutMs)
    })

    return Promise.race([promise, timeout]).finally(() => {
      if (timeoutId) clearTimeout(timeoutId)
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
