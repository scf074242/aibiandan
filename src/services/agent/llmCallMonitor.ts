/**
 * LLM 调用监控与审计（方向 1 D15）。
 *
 * 设计约束（AGENTS.md 本地只保护结果，LLM-first）：
 * - LlmCallMonitor 只做旁路记录，不改写 LLM 输入/输出，不影响 LLM 决策
 * - 监控数据用于排查 agent 链路问题、核算成本、回归归因
 * - 不保存用户原始输入或 API key，仅记录 stage / model / token / latency / status
 *
 * 接入点：llmClient.ts 的 recordRequestTrace 内部，单一收口。
 * 上层聚合点：schedulingAgentRuntime / demoRuntimeFacade 在 trace 落盘时读取 snapshot。
 */

/**
 * LLM 调用审计条目。
 * 单次 LLM 调用（含重试）的完整记录。
 */
export interface AgentLlmCallAuditItem {
  /** 单次调用的唯一 id（record 时生成） */
  callId: string
  /** 归属 stage（= traceLabel，如 'agent.intent_interpreter'） */
  stage: string
  /** 模型名称（= llmClient.config.model） */
  model: string
  /** token 用量（失败时为 0） */
  tokenUsage: {
    prompt: number
    completion: number
    total: number
  }
  /** 调用耗时（毫秒） */
  latencyMs: number
  /** 流式响应首个有效 token 的等待时间；非流式调用为空。 */
  firstTokenLatencyMs?: number
  /** 超时配置（毫秒） */
  timeoutMs: number
  /** 重试次数 */
  attemptCount: number
  /** 能力域 prompt 版本号 */
  promptVersion?: string
  /** prompt 体积统计 */
  messageCount?: number
  promptCharCount?: number
  systemCharCount?: number
  userCharCount?: number
  /** 调用状态 */
  status: 'success' | 'timeout' | 'error'
  /** 错误信息（已脱敏，不含用户输入） */
  errorMessage?: string
  /** 调用开始时间（ISO 字符串，与 LLMRequestTrace.startedAt 一致） */
  startedAt: string
  /** 落盘时间戳（Date.now()） */
  timestamp: number
}

/**
 * 按 stage 聚合的统计快照。
 */
export interface StageAggregate {
  /** 调用次数 */
  calls: number
  /** 总 token 消耗 */
  totalTokens: number
  /** 总耗时（毫秒） */
  totalLatencyMs: number
  /** 错误次数（status='error'） */
  errors: number
  /** 超时次数（status='timeout'） */
  timeouts: number
}

/**
 * LLM 调用监控器。
 * 内存级审计聚合，不持久化，不跨 session。
 * 上层在 agent submit 结束后读取 snapshot 做聚合或落盘，然后 clear。
 */
export class LlmCallMonitor {
  private items: AgentLlmCallAuditItem[] = []
  private counter = 0

  /**
   * 记录一次 LLM 调用审计条目。
   * 由 llmClient.recordRequestTrace 内部调用，外部不应直接调用。
   *
   * @param item - 审计条目（不含 callId/timestamp，由本方法填充）
   */
  record(item: Omit<AgentLlmCallAuditItem, 'callId' | 'timestamp'>): void {
    this.counter += 1
    this.items.push({
      ...item,
      callId: `llm_call_${Date.now()}_${this.counter}`,
      timestamp: Date.now(),
    })
  }

  /**
   * 获取当前审计快照（浅拷贝）。
   * 上层在 agent submit 结束后调用，读取本次运行的 LLM 调用记录。
   *
   * @returns 审计条目数组（按时间正序）
   */
  snapshot(): AgentLlmCallAuditItem[] {
    return [...this.items]
  }

  /**
   * 清空审计记录。
   * 上层读取 snapshot 后应调用 clear，避免无限增长。
   */
  clear(): void {
    this.items = []
  }

  /**
   * 按 stage 聚合统计。
   * 用于快速查看各 stage 的调用次数、token 消耗、错误率。
   *
   * @returns stage → 聚合统计 的映射
   */
  aggregateByStage(): Record<string, StageAggregate> {
    const result: Record<string, StageAggregate> = {}
    for (const item of this.items) {
      if (!result[item.stage]) {
        result[item.stage] = {
          calls: 0,
          totalTokens: 0,
          totalLatencyMs: 0,
          errors: 0,
          timeouts: 0,
        }
      }
      const agg = result[item.stage]!
      agg.calls += 1
      agg.totalTokens += item.tokenUsage.total
      agg.totalLatencyMs += item.latencyMs
      if (item.status === 'error') agg.errors += 1
      if (item.status === 'timeout') agg.timeouts += 1
    }
    return result
  }
}

/**
 * 全局 LlmCallMonitor 单例。
 * llmClient.ts 直接 import 并调用 record/snapshot/clear。
 * 上层（schedulingAgentRuntime / demoRuntimeFacade）调用 snapshot 读取审计数据。
 */
let globalLlmCallMonitor: LlmCallMonitor | null = null

/**
 * 获取全局 LlmCallMonitor 单例。
 * 首次调用时惰性创建，后续返回同一实例。
 *
 * @returns LlmCallMonitor 单例
 */
export function getLlmCallMonitor(): LlmCallMonitor {
  if (!globalLlmCallMonitor) {
    globalLlmCallMonitor = new LlmCallMonitor()
  }
  return globalLlmCallMonitor
}

/**
 * 推断 LLM 调用状态。
 * 根据成功标志与错误信息推断 status 字段。
 *
 * @param success - 是否成功
 * @param error - 错误信息（可选）
 * @returns status 枚举值
 */
export function inferLlmCallStatus(
  success: boolean,
  error?: string,
): AgentLlmCallAuditItem['status'] {
  if (success) return 'success'
  if (error && /timed?\s*out|ETIMEDOUT|超时/i.test(error)) return 'timeout'
  return 'error'
}

/**
 * 脱敏错误信息。
 * 移除可能包含的用户输入片段，仅保留错误类型与堆栈摘要。
 *
 * @param error - 原始错误信息
 * @returns 脱敏后的错误信息
 */
export function sanitizeErrorMessage(error?: string): string | undefined {
  if (!error) return undefined
  // 截断过长的错误信息（避免记录大量用户输入）
  const MAX_ERROR_LENGTH = 200
  if (error.length > MAX_ERROR_LENGTH) {
    return `${error.slice(0, MAX_ERROR_LENGTH)}...`
  }
  return error
}
