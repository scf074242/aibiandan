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
      console.warn('LLM config validation failed:', validation.errors)
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
    this.initClient()
  }

  /**
   * 发送聊天请求
   */
  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<LLMResponse> {
    if (!this.client) {
      throw new Error('LLM client not initialized. Please check your configuration.')
    }

    const maxRetries = 3
    let lastError: Error | null = null

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const response = await this.client.chat.completions.create({
          model: this.config.model,
          messages: messages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
          temperature: options?.temperature ?? this.config.temperature,
          max_tokens: options?.maxTokens ?? this.config.maxTokens,
        })

        const usage = response.usage
        if (usage) {
          this.tokenUsage.totalPromptTokens += usage.prompt_tokens
          this.tokenUsage.totalCompletionTokens += usage.completion_tokens
          this.tokenUsage.totalTokens += usage.total_tokens
          this.tokenUsage.requestCount++
        }

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

        // 指数退避
        if (attempt < maxRetries - 1) {
          const delay = Math.pow(2, attempt) * 1000
          await this.sleep(delay)
        }
      }
    }

    throw new Error(
      `LLM request failed after ${maxRetries} attempts: ${lastError?.message}`,
    )
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

  /**
   * 延迟函数
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
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
