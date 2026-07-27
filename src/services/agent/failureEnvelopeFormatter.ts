/**
 * 失败信封前台渲染数据转换（方向 1 核心交付）。
 *
 * 设计约束（AGENTS.md 本地只保护结果）：
 * - formatFailureEnvelope 是纯函数，不调用 LLM，不修改 envelope
 * - 仅做数据形状转换，便于前台 FailureFormatter.vue 直接渲染
 * - 不替用户做决策，quick replies 仍由 generateQuickReplies 生成
 */

import type {
  CandidateEvidence,
  QuickReply,
  RecoverableInterpretationFailure,
  RecognizedSlot,
} from './recoverableFailureEnvelope'

/**
 * 槽位名 → 中文标签映射。
 * 前台渲染 recognizedSlots / missingSlots 时使用。
 */
export const SLOT_LABELS: Record<string, string> = {
  playlistType: '播单类型',
  intent: '命令意图',
  target: '目标',
  timeRange: '时段',
  programName: '节目名',
  column: '栏目',
  strategy: '策略',
}

/**
 * 失败类型 → 中文标题映射。
 * 前台渲染失败信封标题时使用。
 */
export const FAILURE_KIND_LABELS: Record<string, string> = {
  llm_intent_unavailable: '无法理解指令',
  llm_timeout: '理解超时',
  candidate_zero_match: '未找到匹配节目',
  candidate_field_conflict: '节目字段不匹配',
  preview_only_violation: '预览模式禁止写入',
  unable_to_decide: '无法决策',
  capability_route_conflict: '能力路由冲突',
}

/**
 * 已识别线索的渲染数据。
 */
export interface RecognizedHint {
  /** 槽位中文标签 */
  label: string
  /** 槽位值（已格式化为字符串） */
  value: string
}

/**
 * 缺失槽位的渲染数据。
 */
export interface MissingHint {
  /** 槽位中文标签 */
  label: string
  /** 为什么需要这个槽位（中文） */
  reason: string
}

/**
 * 前台失败信封渲染数据。
 * ChatPanel 收到 envelope 后转换为该结构，传给 FailureFormatter.vue。
 */
export interface FailureRenderData {
  /** 一句话失败标题（来自 FAILURE_KIND_LABELS） */
  headline: string
  /** 人类可读的失败摘要（来自 envelope.humanSummary） */
  summary: string
  /** 已识别线索（槽位名 → 值） */
  recognizedHints: RecognizedHint[]
  /** 缺失槽位（红色高亮） */
  missingHints: MissingHint[]
  /** 候选证据（如果有） */
  candidateCards: CandidateEvidence[]
  /** quick replies */
  quickReplies: QuickReply[]
  /** traceId（折叠展示） */
  traceId: string
  /** 失败类型（用于前台样式区分） */
  kind: RecoverableInterpretationFailure['kind']
}

/**
 * 格式化槽位值为字符串。
 * 数组 → 逗号分隔；对象 → JSON；其他 → String()。
 *
 * @param value - 槽位值
 * @returns 格式化后的字符串
 */
export function formatSlotValue(value: unknown): string {
  if (value === null || value === undefined) {
    return ''
  }
  if (Array.isArray(value)) {
    return value.map((v) => String(v)).join(', ')
  }
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }
  return String(value)
}

/**
 * 获取槽位的中文标签。
 * 未知槽位名返回原值。
 *
 * @param slotName - 槽位名
 * @returns 中文标签
 */
export function getSlotLabel(slotName: string): string {
  return SLOT_LABELS[slotName] ?? slotName
}

/**
 * 获取失败类型的中文标题。
 * 未知类型返回兜底文案。
 *
 * @param kind - 失败类型
 * @returns 中文标题
 */
export function getFailureHeadline(kind: RecoverableInterpretationFailure['kind']): string {
  return FAILURE_KIND_LABELS[kind] ?? '处理失败'
}

/**
 * 把已识别槽位转换为前台渲染数据。
 *
 * @param slots - 已识别槽位数组
 * @returns 渲染数据数组
 */
export function formatRecognizedSlots(slots: RecognizedSlot[]): RecognizedHint[] {
  return slots.map((s) => ({
    label: getSlotLabel(s.name),
    value: formatSlotValue(s.value),
  }))
}

/**
 * 把缺失槽位转换为前台渲染数据。
 *
 * @param slots - 缺失槽位数组
 * @returns 渲染数据数组
 */
export function formatMissingSlots(
  slots: RecoverableInterpretationFailure['missingSlots'],
): MissingHint[] {
  return slots.map((s) => ({
    label: getSlotLabel(s.name),
    reason: s.reason,
  }))
}

/**
 * envelope → 渲染数据转换函数（纯函数，便于单测）。
 *
 * @param env - 可恢复失败信封
 * @returns 前台渲染数据
 */
export function formatFailureEnvelope(env: RecoverableInterpretationFailure): FailureRenderData {
  return {
    headline: getFailureHeadline(env.kind),
    summary: env.humanSummary,
    recognizedHints: formatRecognizedSlots(env.recognizedSlots),
    missingHints: formatMissingSlots(env.missingSlots),
    candidateCards: env.candidateEvidence,
    quickReplies: env.quickReplies,
    traceId: env.traceId,
    kind: env.kind,
  }
}
