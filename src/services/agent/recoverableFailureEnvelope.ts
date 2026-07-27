/**
 * 可恢复失败信封结构（方向 1 核心交付）。
 *
 * 设计约束（AGENTS.md LLM-first / 本地只保护结果）：
 * - envelope 只描述失败现场与可重试线索，不替用户改写意图
 * - quick replies 由确定性纯函数生成，不调用 LLM
 * - noMutation 字段如实暴露失败前是否已产生 mutation，防止 quick retry 污染上下文
 *
 * 触发场景：
 * - LLM 意图解析失败 / 超时
 * - 候选 0 命中 / 字段级不匹配
 * - preview_only 写屏障违反
 * - 多候选无法决策
 * - capability 路由冲突
 */

/**
 * 可恢复失败类型枚举。
 * 与既有 AgentConstraintIssue.code 对齐，便于 trace 关联。
 */
export type RecoverableFailureKind =
  | 'llm_intent_unavailable'      // LLM 未返回有效意图
  | 'llm_timeout'                  // LLM 调用超时
  | 'candidate_zero_match'         // 候选 0 命中
  | 'candidate_field_conflict'     // 候选字段级不匹配
  | 'preview_only_violation'       // preview_only 被违反
  | 'unable_to_decide'             // 多候选无法决策
  | 'capability_route_conflict'    // capability 路由冲突
  | 'llm_decide_unavailable'       // 长流程 observation 后 LLM 无法返回有效 decide
  | 'runtime_action_failed'        // 长流程 act 执行失败并保留现场
  | 'react_plan_invalid'            // ReAct 初始计划或 continue decision 结构无效
  | 'react_max_turns_exhausted'     // ReAct 达到最大轮次后停止
  | 'react_resume_action_required'  // 已找到 checkpoint，但恢复需要显式用户动作
  | 'react_resume_ready'            // checkpoint 恢复校验通过
  | 'react_resume_workspace_mismatch' // 恢复请求与 checkpoint 工作区不一致
  | 'react_resume_version_conflict' // 正式播单版本已变化
  | 'react_resume_checkpoint_invalid' // checkpoint 缺失或无法恢复

/**
 * 已识别的槽位名枚举。
 * 用于 recognizedSlots 与 missingSlots，保证前后台字段对齐。
 */
export type RecognizedSlotName =
  | 'playlistType'
  | 'intent'
  | 'target'
  | 'timeRange'
  | 'programName'
  | 'column'
  | 'strategy'

/**
 * 槽位来源。
 * - llm：由 LLM 解析得到
 * - user_input：用户原文直接提取
 * - context：来自上下文（pending / history / draft）
 */
export type SlotSource = 'llm' | 'user_input' | 'context'

/**
 * 已识别槽位。
 * 即使整体失败，部分槽位可能已有效，前台据此提示用户已识别的线索。
 */
export interface RecognizedSlot {
  /** 槽位名 */
  name: RecognizedSlotName
  /** 槽位值（任意类型，前台按 name 决定渲染方式） */
  value: unknown
  /** 置信度 0-1 */
  confidence: number
  /** 来源 */
  source: SlotSource
}

/**
 * 缺失槽位。
 * 前台据此生成追问 quick replies。
 */
export interface MissingSlot {
  /** 槽位名 */
  name: RecognizedSlotName
  /** 为什么需要这个槽位（中文，前台直接展示） */
  reason: string
  /** 可选的建议值（用于 quick reply；不替用户做决策，仅展示可选项） */
  suggestedValues?: unknown[]
}

/**
 * 候选证据。
 * 候选 0 命中时为空数组；多候选时为候选摘要，供前台展示。
 */
export interface CandidateEvidence {
  /** 节目名称 */
  programName: string
  /** 节目编码 */
  programCode: string
  /** 时长（秒） */
  duration: number
  /** 匹配分数 0-1 */
  score: number
  /** 匹配原因标签（例如 ['内容匹配', '收视率优先']） */
  reasonTags: string[]
  /** 如果被拒绝，说明原因；未拒绝时为 undefined */
  rejectedReason?: string
}

/**
 * 重试策略枚举。
 * 用于 RetrySuggestion.strategy，描述该重试建议的策略类型。
 */
export type RetryStrategy =
  | 'resubmit'         // 重新提交同一指令
  | 'switch_strategy'  // 切换编排策略
  | 'narrow_target'    // 收窄目标（如指定具体节目名）
  | 'broaden_target'   // 放宽目标（如放宽关键词）

/**
 * 重试建议。
 * 用户可点击的重试按钮数据。
 */
export interface RetrySuggestion {
  /** 用户可点击的重试文案（中文） */
  label: string
  /** 点击后填充的指令模板（含占位符 {slot}，前台替换） */
  instructionTemplate: string
  /** 重试策略 */
  strategy: RetryStrategy
}

/**
 * Quick reply 行为枚举。
 * - fill_instruction：填充指令到输入框
 * - switch_strategy：切换编排策略
 * - cancel：取消当前 pending
 */
export type QuickReplyAction = 'fill_instruction' | 'switch_strategy' | 'cancel'

/**
 * 前台 quick reply。
 * 确定性生成，不调用 LLM。
 */
export interface QuickReply {
  /** 按钮文案（中文） */
  label: string
  /** 点击后行为 */
  action: QuickReplyAction
  /** 行为载荷（如填充的指令文本、切换的策略名） */
  payload: unknown
}

/**
 * 可恢复失败信封结构。
 * 前台据此生成 quick replies 与结构化失败展示。
 */
export interface RecoverableInterpretationFailure {
  /** 失败类型 */
  kind: RecoverableFailureKind
  /** LLM 已识别出的槽位（即使整体失败，部分槽位可能已有效） */
  recognizedSlots: RecognizedSlot[]
  /** 仍缺失的槽位（前台据此生成追问 quick replies） */
  missingSlots: MissingSlot[]
  /** 候选证据（候选 0 命中时为空数组；多候选时为候选摘要） */
  candidateEvidence: CandidateEvidence[]
  /** 重试建议（基于 recognizedSlots 推导出的可点击重试按钮） */
  retrySuggestions: RetrySuggestion[]
  /** 本次失败是否产生了任何 mutation（必须为 false 才允许 quick retry） */
  noMutation: boolean
  /** 前台可点击的 quick replies */
  quickReplies: QuickReply[]
  /** 人类可读的失败摘要（仅用于无 quick reply 时的兜底展示） */
  humanSummary: string
  /** 关联的 traceId，便于排查 */
  traceId: string
}

/**
 * 构造可恢复失败信封的最小入参。
 * 调用方只需提供必要字段，quickReplies 由 generateQuickReplies 自动填充。
 */
export interface BuildFailureEnvelopeInput {
  kind: RecoverableFailureKind
  recognizedSlots?: RecognizedSlot[]
  missingSlots?: MissingSlot[]
  candidateEvidence?: CandidateEvidence[]
  retrySuggestions?: RetrySuggestion[]
  noMutation: boolean
  humanSummary: string
  traceId: string
}

/**
 * 构造可恢复失败信封。
 * 如果未提供 quickReplies，则由 generateQuickReplies 自动生成。
 * @param input - 构造入参
 * @returns 完整的可恢复失败信封
 */
export function buildRecoverableFailureEnvelope(
  input: BuildFailureEnvelopeInput,
): RecoverableInterpretationFailure {
  const recognizedSlots = input.recognizedSlots ?? []
  const missingSlots = input.missingSlots ?? []
  const candidateEvidence = input.candidateEvidence ?? []
  const retrySuggestions = input.retrySuggestions ?? []

  const envelope: RecoverableInterpretationFailure = {
    kind: input.kind,
    recognizedSlots,
    missingSlots,
    candidateEvidence,
    retrySuggestions,
    noMutation: input.noMutation,
    quickReplies: [],
    humanSummary: input.humanSummary,
    traceId: input.traceId,
  }

  envelope.quickReplies = generateQuickReplies(envelope)
  return envelope
}

/**
 * 基于已识别槽位生成 quick replies（纯确定性函数）。
 *
 * 设计约束（AGENTS.md 本地只保护结果）：
 * - 不调用 LLM，避免在失败路径上再引入 LLM 不稳定
 * - 不替用户改写意图，只基于已识别线索提供可点击选项
 * - 始终提供"取消"按钮，让用户可以放弃当前 pending
 *
 * @param failure - 可恢复失败信封
 * @returns quick replies 数组（至少包含"取消"）
 */
export function generateQuickReplies(failure: RecoverableInterpretationFailure): QuickReply[] {
  const replies: QuickReply[] = []

  // 缺失槽位 → 追问 quick reply
  for (const slot of failure.missingSlots) {
    if (slot.name === 'timeRange' && slot.suggestedValues?.length) {
      // 时段建议值最多取 2 个，避免 quick reply 过多
      for (const v of slot.suggestedValues.slice(0, 2)) {
        replies.push({
          label: `时段：${String(v)}`,
          action: 'fill_instruction',
          payload: { slot: 'timeRange', value: v },
        })
      }
    }
    if (slot.name === 'strategy' && slot.suggestedValues?.length) {
      // 策略建议值全部展示
      for (const v of slot.suggestedValues) {
        replies.push({
          label: `切换为${String(v)}`,
          action: 'switch_strategy',
          payload: { strategy: v },
        })
      }
    }
    if (slot.name === 'programName' && slot.suggestedValues?.length) {
      // 节目名建议值最多取 2 个
      for (const v of slot.suggestedValues.slice(0, 2)) {
        replies.push({
          label: `换为：${String(v)}`,
          action: 'fill_instruction',
          payload: { slot: 'programName', value: v },
        })
      }
    }
  }

  // 候选 0 命中 → 放宽关键词重试
  if (failure.kind === 'candidate_zero_match') {
    replies.push({
      label: '放宽关键词重试',
      action: 'fill_instruction',
      payload: { strategy: 'broaden_target' },
    })
  }

  // 候选字段级不匹配 → 收窄目标
  if (failure.kind === 'candidate_field_conflict') {
    replies.push({
      label: '收窄目标重试',
      action: 'fill_instruction',
      payload: { strategy: 'narrow_target' },
    })
  }

  // LLM 超时 → 重试上一小步
  if (failure.kind === 'llm_timeout') {
    replies.push({
      label: '重试',
      action: 'fill_instruction',
      payload: { strategy: 'resubmit' },
    })
  }

  // 始终提供取消
  replies.push({ label: '取消', action: 'cancel', payload: {} })
  return replies
}

/**
 * 校验 quick retry 是否被允许。
 * 任何 quick reply 触发重试前，必须校验上一轮 noMutation === true，否则禁止 quick retry。
 *
 * @param failure - 上一轮的可恢复失败信封
 * @returns 是否允许 quick retry
 */
export function canQuickRetry(failure: RecoverableInterpretationFailure): boolean {
  return failure.noMutation === true
}
