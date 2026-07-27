/**
 * Mutation 策略与写屏障（方向 1 核心交付）。
 *
 * 设计约束（AGENTS.md 本地只保护结果）：
 * - MutationPolicy 从 intent 解析层一路传递到 write adapter，任何层都不能私自降级
 * - assertMutationAllowed 在 write adapter 入口校验，preview_only 时直接抛错
 * - 不替用户改写意图，只做写入边界保护
 *
 * 与既有 AgentConstraintIssue.code='preview_only_violation' 对齐（方向 1 不修改既有类型，仅新增）。
 */

/**
 * Mutation 策略枚举。
 * - preview_only：仅预览，禁止任何 mutation（含 layout_draftUpdated）
 * - pending_only：只写 pending 状态，不写正式播单
 * - formal_write：写正式播单（受 safety gates 保护）
 */
export type MutationPolicy =
  | 'preview_only'
  | 'pending_only'
  | 'formal_write'

/**
 * Mutation 写入目标。
 * - draft：写入草案（layout_draftUpdated 等）
 * - formal：写入正式播单
 */
export type MutationTarget = 'draft' | 'formal'

/**
 * Mutation 策略上下文。
 * 在 intent → planner → pending → write adapter 全链路传递。
 */
export interface MutationContext {
  /** mutation 策略 */
  policy: MutationPolicy
  /** 触发该 mutation 的 message id */
  messageId: string
  /** 所属 workspace */
  workspaceKey: string
  /**
   * mutation 唯一 id（用于 trace 关联与幂等性校验）。
   * v2 修订：不用于 journal 回滚，失败暴露而非回滚。
   */
  mutationId: string
}

/**
 * Preview_only 写屏障违反错误。
 * preview_only 模式下 write adapter 被调用时抛出。
 */
export class PreviewOnlyViolationError extends Error {
  /** 写入目标 */
  public readonly target: MutationTarget
  /** 关联的 mutationId */
  public readonly mutationId: string

  constructor(target: MutationTarget, mutationId: string) {
    super(`Preview-only violation: cannot write to ${target} (mutationId=${mutationId})`)
    this.name = 'PreviewOnlyViolationError'
    this.target = target
    this.mutationId = mutationId
  }
}

/**
 * Pending_only 写屏障违反错误。
 * pending_only 模式下 write adapter 试图写入正式播单时抛出。
 */
export class PendingOnlyViolationError extends Error {
  /** 写入目标 */
  public readonly target: MutationTarget
  /** 关联的 mutationId */
  public readonly mutationId: string

  constructor(target: MutationTarget, mutationId: string) {
    super(`Pending-only violation: cannot write to ${target} (mutationId=${mutationId})`)
    this.name = 'PendingOnlyViolationError'
    this.target = target
    this.mutationId = mutationId
  }
}

/**
 * 写屏障：write adapter 入口校验。
 * 任何 write adapter 调用前必须经过此校验：
 * - preview_only 时直接抛 PreviewOnlyViolationError
 * - pending_only 且 target=formal 时抛 PendingOnlyViolationError
 * - formal_write 时放行（受 safety gates 保护）
 *
 * @param ctx - mutation 上下文
 * @param target - 写入目标（draft / formal）
 * @throws {PreviewOnlyViolationError} preview_only 模式下被调用
 * @throws {PendingOnlyViolationError} pending_only 模式下试图写入正式播单
 */
export function assertMutationAllowed(ctx: MutationContext, target: MutationTarget): void {
  if (ctx.policy === 'preview_only') {
    throw new PreviewOnlyViolationError(target, ctx.mutationId)
  }
  if (ctx.policy === 'pending_only' && target === 'formal') {
    throw new PendingOnlyViolationError(target, ctx.mutationId)
  }
}

/**
 * 判断当前 policy 是否允许写入指定目标。
 * 与 assertMutationAllowed 的区别：不抛错，返回布尔值，便于调用方提前判断。
 *
 * @param ctx - mutation 上下文
 * @param target - 写入目标（draft / formal）
 * @returns 是否允许写入
 */
export function isMutationAllowed(ctx: MutationContext, target: MutationTarget): boolean {
  if (ctx.policy === 'preview_only') {
    return false
  }
  if (ctx.policy === 'pending_only' && target === 'formal') {
    return false
  }
  return true
}

/**
 * 构造默认的 preview_only mutation 上下文。
 * 用于候选检索阶段，确保不触发任何草案 mutation。
 *
 * @param messageId - 触发 message id
 * @param workspaceKey - 所属 workspace
 * @param mutationId - mutation 唯一 id
 * @returns preview_only 的 MutationContext
 */
export function buildPreviewOnlyContext(
  messageId: string,
  workspaceKey: string,
  mutationId: string,
): MutationContext {
  return {
    policy: 'preview_only',
    messageId,
    workspaceKey,
    mutationId,
  }
}

/**
 * 构造 pending_only mutation 上下文。
 * 用于 pending mutation 阶段，只写 pending 状态，不写正式播单。
 *
 * @param messageId - 触发 message id
 * @param workspaceKey - 所属 workspace
 * @param mutationId - mutation 唯一 id
 * @returns pending_only 的 MutationContext
 */
export function buildPendingOnlyContext(
  messageId: string,
  workspaceKey: string,
  mutationId: string,
): MutationContext {
  return {
    policy: 'pending_only',
    messageId,
    workspaceKey,
    mutationId,
  }
}

/**
 * 构造 formal_write mutation 上下文。
 * 用于正式播单写入阶段，受 safety gates 保护。
 *
 * @param messageId - 触发 message id
 * @param workspaceKey - 所属 workspace
 * @param mutationId - mutation 唯一 id
 * @returns formal_write 的 MutationContext
 */
export function buildFormalWriteContext(
  messageId: string,
  workspaceKey: string,
  mutationId: string,
): MutationContext {
  return {
    policy: 'formal_write',
    messageId,
    workspaceKey,
    mutationId,
  }
}
