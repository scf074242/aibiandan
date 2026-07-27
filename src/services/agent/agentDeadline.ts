/**
 * 统一 deadline 管理器（方向 1 核心交付）。
 *
 * 设计约束（AGENTS.md 本地只保护结果）：
 * - 一次 submit 内所有 stage（intent / candidate / selection / write）共享一个整体 deadline
 * - 各 stage 只能从中扣除自己的预算，不能独立设置超时
 * - 5s 后允许用户停止（前台显示停止按钮）
 * - 长流程采用整体 10 分钟 + 批次 90s 组合，不套用短链路 deadline
 *
 * 不涉及意图改写，只做时间预算与中止信号管理。
 */

/**
 * 短链路默认整体 deadline（毫秒）。
 * 真实复杂请求通常包含 intent 与 candidate judge 两次串行 LLM 调用，
 * 180s 是可配置默认值，不是模型必须在固定 30s 内返回的产品承诺。
 */
export const DEFAULT_OVERALL_DEADLINE_MS = 180_000

/** 单个 LLM stage 的上限，避免某一步独占整轮等待时间。 */
export const DEFAULT_LLM_STAGE_TIMEOUT_MS = 90_000

/**
 * 短链路 stage timeout 对齐表。
 * LLM stage 共享整体剩余预算，不能用更短的固定值提前截断真实模型。
 * 非 LLM 的写入适配器保留独立执行预算。
 */
export const STAGE_TIMEOUT_BUDGET = {
  /** LLM 意图解析 */
  intent_parse: DEFAULT_LLM_STAGE_TIMEOUT_MS,
  /** 候选检索（含 agentPlanner.plan） */
  candidate_search: DEFAULT_LLM_STAGE_TIMEOUT_MS,
  /** 候选 judge LLM */
  candidate_judge: DEFAULT_LLM_STAGE_TIMEOUT_MS,
  /** 写入适配器 */
  write_adapter: 5_000,
} as const

/**
 * 短链路后续阶段保留预算。
 * 当前 stage 只能使用 remainingMs 扣除保留值后的时间，避免意图解析耗尽整轮预算。
 */
export const STAGE_RESERVE_BUDGET = {
  /** intent 完成后仍需给候选检索、候选判断和写入留出时间 */
  after_intent_parse: 60_000,
  /** candidate judge 完成后仍需给写入校验与提交留出时间 */
  after_candidate_judge: 15_000,
} as const

/**
 * 长流程（formal_orchestration）timeout 预算。
 * v2 新增：长流程不能套用单次 submit 的短链 deadline，
 * 采用"整体 deadline + 分段 timeout + checkpoint 暂停"组合。
 */
export const LONG_RUNNING_DEADLINE_BUDGET = {
  /** 长流程整体 deadline（默认 10 分钟，可由 lifecycle.canInterrupt 与 UI 停止按钮提前中断） */
  overallDeadlineMs: 10 * 60 * 1000,
  /** 单批次 deadline（每批 checkpoint 不超过 90s，超时则暂停并保留 checkpoint） */
  batchDeadlineMs: 90 * 1000,
  /** 单个 stage 在长流程下沿用 STAGE_TIMEOUT_BUDGET，但允许从 batchDeadlineMs 中扣除 */
  stageInheritsShortBudget: true,
  /** 5s 后允许用户停止（与短链路一致） */
  stoppableAfterMs: 5_000,
} as const

/**
 * 5s 后允许用户停止的阈值（毫秒）。
 * 短链路与长流程共用。
 */
const STOPPABLE_THRESHOLD_MS = 5_000

/**
 * 长流程 timeout 决策结果。
 * - continue：继续执行
 * - pause_overall：整体 deadline 用尽，暂停并保留 checkpoint
 * - pause_batch：批次 deadline 用尽，暂停并保留 checkpoint，等用户"继续"
 * - expose_stage_failure：单 stage timeout，由调用方按 STAGE_TIMEOUT_BUDGET 自行判断
 */
export type LongRunningTimeoutAction =
  | 'continue'
  | 'pause_overall'
  | 'pause_batch'
  | 'expose_stage_failure'

/**
 * 长流程 timeout 决策器。
 * 整体 deadline 用尽 → 暂停并保留 checkpoint；
 * 批次 deadline 用尽 → 暂停并保留 checkpoint，等用户"继续"；
 * 单 stage timeout → 复用方向 1 的 RecoverableInterpretationFailure 暴露失败。
 *
 * @param elapsed - 已用时间（overallMs 整体已用 / batchMs 当前批次已用 / stageMs 当前 stage 已用）
 * @param budget - 长流程 timeout 预算
 * @returns 决策结果
 */
export function decideLongRunningTimeoutAction(
  elapsed: { overallMs: number; batchMs: number; stageMs: number },
  budget: typeof LONG_RUNNING_DEADLINE_BUDGET,
): LongRunningTimeoutAction {
  if (elapsed.overallMs >= budget.overallDeadlineMs) {
    return 'pause_overall'
  }
  if (elapsed.batchMs >= budget.batchDeadlineMs) {
    return 'pause_batch'
  }
  // 单 stage timeout 由调用方按 STAGE_TIMEOUT_BUDGET 自行判断
  return 'continue'
}

/**
 * 统一 deadline 管理器。
 * 一次 submit 内所有 stage 共享一个整体 deadline，各 stage 只能从中扣除自己的预算。
 */
export class AgentDeadline {
  /** 起始时间戳 */
  private readonly startedAt: number
  /** 整体 deadline（毫秒） */
  private readonly overallDeadlineMs: number
  /** AbortController，用于联动 fetch / LLM 调用 */
  private readonly controller: AbortController
  /** 整体预算到期时自动中止，确保非 LLM stage 也能收到统一 signal */
  private readonly expiryTimer: ReturnType<typeof setTimeout>
  /** 是否已中止 */
  private aborted: boolean

  /**
   * 构造 deadline 管理器。
   * @param opts.overallDeadlineMs - 整体 deadline，默认 180s（短链路）；长流程需显式传 LONG_RUNNING_DEADLINE_BUDGET.overallDeadlineMs
   */
  constructor(opts: { overallDeadlineMs?: number } = {}) {
    this.startedAt = Date.now()
    this.overallDeadlineMs = opts.overallDeadlineMs ?? DEFAULT_OVERALL_DEADLINE_MS
    this.controller = new AbortController()
    this.aborted = false
    this.expiryTimer = setTimeout(() => this.abort(), Math.max(0, this.overallDeadlineMs))
    // Node 进程不应因一个尚未结束的 deadline timer 被动等待退出。
    const unref = (this.expiryTimer as unknown as { unref?: () => void }).unref
    unref?.call(this.expiryTimer)
  }

  /**
   * 获取剩余预算（毫秒）。
   * 各 stage 用它判断是否还能继续。
   * @returns 剩余毫秒数（已用尽时为 0）
   */
  public remainingMs(): number {
    return Math.max(0, this.overallDeadlineMs - (Date.now() - this.startedAt))
  }

  /**
   * 5s 后触发 stoppable 信号（前台显示停止按钮）。
   * @returns 是否可停止
   */
  public isStoppable(): boolean {
    return Date.now() - this.startedAt >= STOPPABLE_THRESHOLD_MS
  }

  /**
   * 触发中止（用户点击停止）。
   * 触发后 AbortController.signal 会被置为 aborted 状态。
   */
  public abort(): void {
    if (this.aborted) {
      return
    }
    this.aborted = true
    clearTimeout(this.expiryTimer)
    this.controller.abort()
  }

  /**
   * 判断是否已中止。
   * @returns 是否已中止
   */
  public isAborted(): boolean {
    return this.aborted
  }

  /**
   * 获取 abort signal，传给 fetch / LLM 调用。
   * 调用方必须把此 signal 传入底层 fetch / openai 调用，否则超时后仍在执行。
   * @returns AbortSignal
   */
  public signal(): AbortSignal {
    return this.controller.signal
  }

  /**
   * 计算 stage 的实际 timeout（取 stage 预算与剩余预算的较小值）。
   * 调用方应使用此值作为 stage 的 timeout，不能直接用 STAGE_TIMEOUT_BUDGET。
   *
   * @param stageBudget - stage 预算（来自 STAGE_TIMEOUT_BUDGET）
   * @returns 实际 timeout（毫秒）
   */
  public stageTimeoutMs(stageBudget: number, reserveMs = 0): number {
    return Math.min(stageBudget, Math.max(0, this.remainingMs() - reserveMs))
  }
}

/**
 * 判断当前 stage 是否已超时。
 * 调用方在 stage 执行前后调用此函数，超时则暴露 RecoverableInterpretationFailure。
 *
 * @param deadline - AgentDeadline 实例
 * @param stageBudget - stage 预算（来自 STAGE_TIMEOUT_BUDGET）
 * @param stageStartedAt - stage 开始时间戳
 * @returns 是否已超时
 */
export function isStageTimedOut(
  deadline: AgentDeadline,
  stageBudget: number,
  stageStartedAt: number,
): boolean {
  if (deadline.isAborted()) {
    return true
  }
  if (deadline.remainingMs() <= 0) {
    return true
  }
  return Date.now() - stageStartedAt >= stageBudget
}
