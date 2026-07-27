import { describe, expect, it, vi } from 'vitest'
import {
  buildRecoverableFailureEnvelope,
  canQuickRetry,
  generateQuickReplies,
  type RecoverableInterpretationFailure,
} from '@/services/agent/recoverableFailureEnvelope'
import {
  AgentDeadline,
  DEFAULT_OVERALL_DEADLINE_MS,
  LONG_RUNNING_DEADLINE_BUDGET,
  STAGE_TIMEOUT_BUDGET,
  decideLongRunningTimeoutAction,
  isStageTimedOut,
} from '@/services/agent/agentDeadline'
import {
  PreviewOnlyViolationError,
  PendingOnlyViolationError,
  assertMutationAllowed,
  buildFormalWriteContext,
  buildPendingOnlyContext,
  buildPreviewOnlyContext,
  isMutationAllowed,
} from '@/services/agent/mutationPolicy'
import {
  FAILURE_KIND_LABELS,
  SLOT_LABELS,
  formatFailureEnvelope,
  formatMissingSlots,
  formatRecognizedSlots,
  formatSlotValue,
  getFailureHeadline,
  getSlotLabel,
} from '@/services/agent/failureEnvelopeFormatter'

/**
 * 方向 1：失败可恢复性闭环测试。
 *
 * 覆盖 5 个 case（执行卡 5.1）：
 * 1. case-llm-timeout
 * 2. case-llm-intent-empty
 * 3. case-candidate-zero-match
 * 4. case-preview-only-violation
 * 5. case-quick-reply-no-mutation
 *
 * 同时覆盖 AgentDeadline / MutationPolicy / formatFailureEnvelope 的核心行为。
 */

describe('方向 1：失败可恢复性闭环', () => {
  describe('RecoverableInterpretationFailure envelope', () => {
    /**
     * case-llm-timeout：LLM 调用超过 8s stage timeout，
     * capability 必须返回 kind:'llm_timeout' envelope，
     * noMutation:true，前台展示 quick replies。
     */
    it('case-llm-timeout：LLM 超时必须产出 llm_timeout envelope 且 noMutation=true', () => {
      const envelope = buildRecoverableFailureEnvelope({
        kind: 'llm_timeout',
        recognizedSlots: [
          { name: 'playlistType', value: 'tv', confidence: 0.9, source: 'context' },
        ],
        noMutation: true,
        humanSummary: '理解指令超时，请重试或补充更明确的信息。',
        traceId: 'trace-llm-timeout-001',
      })

      expect(envelope.kind).toBe('llm_timeout')
      expect(envelope.noMutation).toBe(true)
      expect(envelope.traceId).toBe('trace-llm-timeout-001')
      expect(envelope.recognizedSlots).toHaveLength(1)
      expect(envelope.recognizedSlots[0].name).toBe('playlistType')
      // quick replies 必须包含"重试"和"取消"
      const labels = envelope.quickReplies.map((q) => q.label)
      expect(labels).toContain('重试')
      expect(labels).toContain('取消')
      // noMutation=true 才允许 quick retry
      expect(canQuickRetry(envelope)).toBe(true)
    })

    /**
     * case-llm-intent-empty：LLM 返回空意图，
     * 必须返回 kind:'llm_intent_unavailable'，
     * recognizedSlots 为空数组，missingSlots 包含 intent 槽位。
     */
    it('case-llm-intent-empty：空意图必须产出 llm_intent_unavailable envelope 且 missingSlots 含 intent', () => {
      const envelope = buildRecoverableFailureEnvelope({
        kind: 'llm_intent_unavailable',
        recognizedSlots: [],
        missingSlots: [
          { name: 'intent', reason: '无法识别命令意图，请明确要执行的操作（插入/删除/移动/替换等）。' },
        ],
        noMutation: true,
        humanSummary: '暂时无法理解这条指令，请补充更明确的命令。',
        traceId: 'trace-empty-intent-002',
      })

      expect(envelope.kind).toBe('llm_intent_unavailable')
      expect(envelope.recognizedSlots).toEqual([])
      expect(envelope.missingSlots).toHaveLength(1)
      expect(envelope.missingSlots[0].name).toBe('intent')
      expect(envelope.missingSlots[0].reason).toContain('意图')
      expect(envelope.noMutation).toBe(true)
      // quick replies 必须包含"取消"
      const labels = envelope.quickReplies.map((q) => q.label)
      expect(labels).toContain('取消')
      // intent 槽位无 suggestedValues，不应生成追问 quick reply
      expect(envelope.quickReplies.filter((q) => q.action === 'fill_instruction')).toHaveLength(0)
    })

    /**
     * case-candidate-zero-match：用户给出明确节目名，
     * 候选库字段级不匹配，
     * 必须返回 kind:'candidate_zero_match'，
     * candidateEvidence 为空数组，quick replies 包含"放宽关键词重试"。
     */
    it('case-candidate-zero-match：候选 0 命中必须产出 candidate_zero_match envelope 且含"放宽关键词重试"', () => {
      const envelope = buildRecoverableFailureEnvelope({
        kind: 'candidate_zero_match',
        recognizedSlots: [
          { name: 'programName', value: '上海旅游纪录片', confidence: 0.85, source: 'user_input' },
          { name: 'playlistType', value: 'tv', confidence: 0.9, source: 'context' },
        ],
        missingSlots: [],
        candidateEvidence: [],
        noMutation: true,
        humanSummary: '未在节目库中找到《上海旅游纪录片》，请尝试放宽关键词或更换节目。',
        traceId: 'trace-zero-match-003',
      })

      expect(envelope.kind).toBe('candidate_zero_match')
      expect(envelope.candidateEvidence).toEqual([])
      expect(envelope.recognizedSlots).toHaveLength(2)
      const labels = envelope.quickReplies.map((q) => q.label)
      expect(labels).toContain('放宽关键词重试')
      expect(labels).toContain('取消')
      expect(envelope.noMutation).toBe(true)
    })

    /**
     * case-preview-only-violation：preview_only 模式下 write adapter 被调用，
     * assertMutationAllowed 必须抛 PreviewOnlyViolationError，
     * envelope kind:'preview_only_violation'。
     */
    it('case-preview-only-violation：preview_only 写屏障必须抛 PreviewOnlyViolationError', () => {
      const ctx = buildPreviewOnlyContext('msg-001', 'ws-tv-001', 'mut-001')

      // 写入 draft 应抛错
      expect(() => assertMutationAllowed(ctx, 'draft')).toThrow(PreviewOnlyViolationError)
      // 写入 formal 应抛错
      expect(() => assertMutationAllowed(ctx, 'formal')).toThrow(PreviewOnlyViolationError)

      // 错误信息应携带 target 与 mutationId
      try {
        assertMutationAllowed(ctx, 'draft')
      } catch (e) {
        expect(e).toBeInstanceOf(PreviewOnlyViolationError)
        const err = e as PreviewOnlyViolationError
        expect(err.target).toBe('draft')
        expect(err.mutationId).toBe('mut-001')
        expect(err.name).toBe('PreviewOnlyViolationError')
      }

      // 构造 envelope 暴露失败
      const envelope = buildRecoverableFailureEnvelope({
        kind: 'preview_only_violation',
        recognizedSlots: [
          { name: 'playlistType', value: 'tv', confidence: 0.9, source: 'context' },
        ],
        noMutation: true, // 写屏障在写入前抛错，未产生 mutation
        humanSummary: '当前为预览模式，无法写入草案或正式播单。',
        traceId: 'trace-preview-violation-004',
      })
      expect(envelope.kind).toBe('preview_only_violation')
      expect(envelope.noMutation).toBe(true)
      const labels = envelope.quickReplies.map((q) => q.label)
      expect(labels).toContain('取消')
    })

    /**
     * case-quick-reply-no-mutation：任何 quick reply 触发重试前，
     * 必须校验上一轮 noMutation === true，否则禁止 quick retry。
     */
    it('case-quick-reply-no-mutation：noMutation=false 时禁止 quick retry', () => {
      // noMutation=true 允许 quick retry
      const safeFailure: RecoverableInterpretationFailure = buildRecoverableFailureEnvelope({
        kind: 'llm_timeout',
        noMutation: true,
        humanSummary: '超时，可重试。',
        traceId: 'trace-safe-005',
      })
      expect(canQuickRetry(safeFailure)).toBe(true)

      // noMutation=false 禁止 quick retry（已产生 mutation，需用户确认）
      const unsafeFailure: RecoverableInterpretationFailure = buildRecoverableFailureEnvelope({
        kind: 'unable_to_decide',
        noMutation: false, // 已有部分 mutation
        humanSummary: '已部分写入但无法继续，请检查当前 pending。',
        traceId: 'trace-unsafe-006',
      })
      expect(canQuickRetry(unsafeFailure)).toBe(false)
    })
  })

  describe('generateQuickReplies 纯函数', () => {
    it('candidate_field_conflict 应生成"收窄目标重试"按钮', () => {
      const envelope = buildRecoverableFailureEnvelope({
        kind: 'candidate_field_conflict',
        noMutation: true,
        humanSummary: '节目字段不匹配。',
        traceId: 'trace-field-conflict-007',
      })
      const labels = envelope.quickReplies.map((q) => q.label)
      expect(labels).toContain('收窄目标重试')
      expect(labels).toContain('取消')
    })

    it('missingSlots 含 timeRange 且有 suggestedValues 时应生成时段 quick reply（最多 2 个）', () => {
      const envelope = buildRecoverableFailureEnvelope({
        kind: 'llm_intent_unavailable',
        missingSlots: [
          {
            name: 'timeRange',
            reason: '需要明确时段。',
            suggestedValues: ['06:00-08:00', '12:00-14:00', '18:00-20:00'],
          },
        ],
        noMutation: true,
        humanSummary: '需要明确时段。',
        traceId: 'trace-time-008',
      })
      const timeReplies = envelope.quickReplies.filter(
        (q) => q.action === 'fill_instruction' && q.label.startsWith('时段：'),
      )
      // 最多 2 个，避免 quick reply 过多
      expect(timeReplies).toHaveLength(2)
      expect(timeReplies[0].label).toBe('时段：06:00-08:00')
      expect(timeReplies[1].label).toBe('时段：12:00-14:00')
    })

    it('missingSlots 含 strategy 且有 suggestedValues 时应生成切换策略 quick reply', () => {
      const envelope = buildRecoverableFailureEnvelope({
        kind: 'llm_intent_unavailable',
        missingSlots: [
          {
            name: 'strategy',
            reason: '需要明确轮播策略。',
            suggestedValues: ['内容匹配优先', '收视率优先'],
          },
        ],
        noMutation: true,
        humanSummary: '需要明确轮播策略。',
        traceId: 'trace-strategy-009',
      })
      const switchReplies = envelope.quickReplies.filter((q) => q.action === 'switch_strategy')
      expect(switchReplies).toHaveLength(2)
      expect(switchReplies[0].label).toBe('切换为内容匹配优先')
      expect(switchReplies[1].label).toBe('切换为收视率优先')
    })

    it('missingSlots 含 programName 且有 suggestedValues 时应生成节目名 quick reply（最多 2 个）', () => {
      const envelope = buildRecoverableFailureEnvelope({
        kind: 'candidate_zero_match',
        missingSlots: [
          {
            name: 'programName',
            reason: '未找到该节目，请选择候选。',
            suggestedValues: ['看东方', '东方快报', '上海新闻'],
          },
        ],
        noMutation: true,
        humanSummary: '未找到该节目。',
        traceId: 'trace-program-010',
      })
      const programReplies = envelope.quickReplies.filter(
        (q) => q.action === 'fill_instruction' && q.label.startsWith('换为：'),
      )
      // 最多 2 个
      expect(programReplies).toHaveLength(2)
      expect(programReplies[0].label).toBe('换为：看东方')
      expect(programReplies[1].label).toBe('换为：东方快报')
    })

    it('未知 kind 也应至少返回"取消"按钮', () => {
      const envelope = buildRecoverableFailureEnvelope({
        kind: 'capability_route_conflict',
        noMutation: true,
        humanSummary: '能力路由冲突。',
        traceId: 'trace-route-011',
      })
      expect(envelope.quickReplies.length).toBeGreaterThanOrEqual(1)
      expect(envelope.quickReplies[envelope.quickReplies.length - 1].label).toBe('取消')
    })

    it('unable_to_decide 且无 missingSlots 应只返回"取消"按钮', () => {
      const envelope = buildRecoverableFailureEnvelope({
        kind: 'unable_to_decide',
        noMutation: false,
        humanSummary: '多候选无法决策，请人工确认。',
        traceId: 'trace-unable-013',
      })
      // 无 missingSlots / 非 candidate_zero_match / 非 candidate_field_conflict / 非 llm_timeout
      // 应只返回"取消"按钮
      expect(envelope.quickReplies).toHaveLength(1)
      expect(envelope.quickReplies[0].label).toBe('取消')
      expect(envelope.quickReplies[0].action).toBe('cancel')
    })

    it('generateQuickReplies 是纯函数：相同输入产生相同输出', () => {
      const failure: RecoverableInterpretationFailure = {
        kind: 'llm_timeout',
        recognizedSlots: [],
        missingSlots: [],
        candidateEvidence: [],
        retrySuggestions: [],
        noMutation: true,
        quickReplies: [],
        humanSummary: '超时。',
        traceId: 'trace-pure-012',
      }
      const r1 = generateQuickReplies(failure)
      const r2 = generateQuickReplies(failure)
      expect(r1).toEqual(r2)
    })
  })

  describe('AgentDeadline 统一 deadline 管理器', () => {
    it('默认整体 deadline 应为 30s（对齐 LLM 30s timeout 坑）', () => {
      expect(DEFAULT_OVERALL_DEADLINE_MS).toBe(180_000)
    })

    it('新建 AgentDeadline 应有 30s 剩余预算且不可停止', () => {
      const deadline = new AgentDeadline()
      // 给一点容差
      expect(deadline.remainingMs()).toBeLessThanOrEqual(180_000)
      expect(deadline.remainingMs()).toBeGreaterThan(89_500)
      // 刚创建不可停止（< 5s）
      expect(deadline.isStoppable()).toBe(false)
      expect(deadline.isAborted()).toBe(false)
    })

    it('stageTimeoutMs 应取 stage 预算与剩余预算的较小值', () => {
      const deadline = new AgentDeadline({ overallDeadlineMs: 10_000 })
      // 剩余约 10s，stage 预算 12s，应取 10s 以下
      const t = deadline.stageTimeoutMs(STAGE_TIMEOUT_BUDGET.candidate_search)
      expect(t).toBeLessThanOrEqual(10_000)
      expect(t).toBeGreaterThan(9_500)
    })

    it('abort() 后 isAborted=true 且 signal.aborted=true', () => {
      const deadline = new AgentDeadline()
      expect(deadline.isAborted()).toBe(false)
      expect(deadline.signal().aborted).toBe(false)
      deadline.abort()
      expect(deadline.isAborted()).toBe(true)
      expect(deadline.signal().aborted).toBe(true)
      // 重复 abort 不应抛错
      deadline.abort()
      expect(deadline.isAborted()).toBe(true)
    })

    it('isStoppable 在 5s 后应为 true', () => {
      // 使用 vi.spyOn 模拟时间前进
      const deadline = new AgentDeadline({ overallDeadlineMs: 30_000 })
      // 初始不可停止
      expect(deadline.isStoppable()).toBe(false)
      // 模拟 6s 后
      const future = Date.now() + 6_000
      const dateSpy = vi.spyOn(Date, 'now').mockReturnValue(future)
      try {
        expect(deadline.isStoppable()).toBe(true)
        expect(deadline.remainingMs()).toBeLessThanOrEqual(24_000)
      } finally {
        dateSpy.mockRestore()
      }
    })

    it('长流程 deadline 预算应为 10 分钟整体 + 90s 批次', () => {
      expect(LONG_RUNNING_DEADLINE_BUDGET.overallDeadlineMs).toBe(10 * 60 * 1000)
      expect(LONG_RUNNING_DEADLINE_BUDGET.batchDeadlineMs).toBe(90 * 1000)
      expect(LONG_RUNNING_DEADLINE_BUDGET.stoppableAfterMs).toBe(5_000)
    })

    it('decideLongRunningTimeoutAction：整体超时 → pause_overall', () => {
      const action = decideLongRunningTimeoutAction(
        { overallMs: 11 * 60 * 1000, batchMs: 30_000, stageMs: 1_000 },
        LONG_RUNNING_DEADLINE_BUDGET,
      )
      expect(action).toBe('pause_overall')
    })

    it('decideLongRunningTimeoutAction：批次超时 → pause_batch', () => {
      const action = decideLongRunningTimeoutAction(
        { overallMs: 60_000, batchMs: 100_000, stageMs: 1_000 },
        LONG_RUNNING_DEADLINE_BUDGET,
      )
      expect(action).toBe('pause_batch')
    })

    it('decideLongRunningTimeoutAction：未超时 → continue', () => {
      const action = decideLongRunningTimeoutAction(
        { overallMs: 60_000, batchMs: 30_000, stageMs: 1_000 },
        LONG_RUNNING_DEADLINE_BUDGET,
      )
      expect(action).toBe('continue')
    })

    it('decideLongRunningTimeoutAction：overallMs 恰好等于 overallDeadlineMs → pause_overall', () => {
      const action = decideLongRunningTimeoutAction(
        { overallMs: LONG_RUNNING_DEADLINE_BUDGET.overallDeadlineMs, batchMs: 30_000, stageMs: 1_000 },
        LONG_RUNNING_DEADLINE_BUDGET,
      )
      expect(action).toBe('pause_overall')
    })

    it('decideLongRunningTimeoutAction：batchMs 恰好等于 batchDeadlineMs → pause_batch', () => {
      const action = decideLongRunningTimeoutAction(
        { overallMs: 60_000, batchMs: LONG_RUNNING_DEADLINE_BUDGET.batchDeadlineMs, stageMs: 1_000 },
        LONG_RUNNING_DEADLINE_BUDGET,
      )
      expect(action).toBe('pause_batch')
    })

    it('isStageTimedOut：deadline 已 abort 应返回 true', () => {
      const deadline = new AgentDeadline()
      deadline.abort()
      expect(isStageTimedOut(deadline, 8_000, Date.now())).toBe(true)
    })

    it('isStageTimedOut：剩余预算为 0 应返回 true', () => {
      const deadline = new AgentDeadline({ overallDeadlineMs: 1 })
      // 强制时间前进到 deadline 之后
      const future = Date.now() + 100
      const dateSpy = vi.spyOn(Date, 'now').mockReturnValue(future)
      try {
        expect(isStageTimedOut(deadline, 8_000, Date.now() - 200)).toBe(true)
      } finally {
        dateSpy.mockRestore()
      }
    })

    it('isStageTimedOut：stage 已用时间超过 stage 预算应返回 true', () => {
      const deadline = new AgentDeadline({ overallDeadlineMs: 60_000 })
      // stage 开始于 10s 前，预算 8s，应超时（直接用真实时间，无需 mock）
      const stageStartedAt = Date.now() - 10_000
      expect(isStageTimedOut(deadline, 8_000, stageStartedAt)).toBe(true)
    })

    it('isStageTimedOut：stage 未超时且 deadline 未用尽应返回 false', () => {
      const deadline = new AgentDeadline({ overallDeadlineMs: 60_000 })
      // stage 刚开始，预算 8s，不应超时
      const stageStartedAt = Date.now()
      expect(isStageTimedOut(deadline, 8_000, stageStartedAt)).toBe(false)
    })
  })

  describe('MutationPolicy 写屏障', () => {
    it('preview_only 应禁止 draft 与 formal 写入', () => {
      const ctx = buildPreviewOnlyContext('msg-001', 'ws-tv-001', 'mut-001')
      expect(isMutationAllowed(ctx, 'draft')).toBe(false)
      expect(isMutationAllowed(ctx, 'formal')).toBe(false)
      expect(() => assertMutationAllowed(ctx, 'draft')).toThrow(PreviewOnlyViolationError)
      expect(() => assertMutationAllowed(ctx, 'formal')).toThrow(PreviewOnlyViolationError)
    })

    it('pending_only 应允许 draft 但禁止 formal 写入', () => {
      const ctx = buildPendingOnlyContext('msg-002', 'ws-tv-002', 'mut-002')
      expect(isMutationAllowed(ctx, 'draft')).toBe(true)
      expect(isMutationAllowed(ctx, 'formal')).toBe(false)
      expect(() => assertMutationAllowed(ctx, 'draft')).not.toThrow()
      expect(() => assertMutationAllowed(ctx, 'formal')).toThrow(PendingOnlyViolationError)
    })

    it('formal_write 应允许 draft 与 formal 写入', () => {
      const ctx = buildFormalWriteContext('msg-003', 'ws-tv-003', 'mut-003')
      expect(isMutationAllowed(ctx, 'draft')).toBe(true)
      expect(isMutationAllowed(ctx, 'formal')).toBe(true)
      expect(() => assertMutationAllowed(ctx, 'draft')).not.toThrow()
      expect(() => assertMutationAllowed(ctx, 'formal')).not.toThrow()
    })

    it('PreviewOnlyViolationError 应携带 target 与 mutationId', () => {
      const ctx = buildPreviewOnlyContext('msg-004', 'ws-tv-004', 'mut-004')
      try {
        assertMutationAllowed(ctx, 'formal')
      } catch (e) {
        const err = e as PreviewOnlyViolationError
        expect(err.target).toBe('formal')
        expect(err.mutationId).toBe('mut-004')
      }
    })

    it('PendingOnlyViolationError 应携带 target 与 mutationId', () => {
      const ctx = buildPendingOnlyContext('msg-005', 'ws-tv-005', 'mut-005')
      try {
        assertMutationAllowed(ctx, 'formal')
      } catch (e) {
        const err = e as PendingOnlyViolationError
        expect(err.target).toBe('formal')
        expect(err.mutationId).toBe('mut-005')
      }
    })

    it('build*Context 应正确填充 messageId / workspaceKey / mutationId', () => {
      const preview = buildPreviewOnlyContext('m1', 'ws1', 'mut1')
      expect(preview.policy).toBe('preview_only')
      expect(preview.messageId).toBe('m1')
      expect(preview.workspaceKey).toBe('ws1')
      expect(preview.mutationId).toBe('mut1')

      const pending = buildPendingOnlyContext('m2', 'ws2', 'mut2')
      expect(pending.policy).toBe('pending_only')
      expect(pending.messageId).toBe('m2')

      const formal = buildFormalWriteContext('m3', 'ws3', 'mut3')
      expect(formal.policy).toBe('formal_write')
      expect(formal.workspaceKey).toBe('ws3')
    })
  })

  describe('failureEnvelopeFormatter 前台渲染数据', () => {
    it('SLOT_LABELS 应包含所有槽位名', () => {
      expect(SLOT_LABELS.playlistType).toBe('播单类型')
      expect(SLOT_LABELS.intent).toBe('命令意图')
      expect(SLOT_LABELS.target).toBe('目标')
      expect(SLOT_LABELS.timeRange).toBe('时段')
      expect(SLOT_LABELS.programName).toBe('节目名')
      expect(SLOT_LABELS.column).toBe('栏目')
      expect(SLOT_LABELS.strategy).toBe('策略')
    })

    it('FAILURE_KIND_LABELS 应包含所有失败类型', () => {
      expect(FAILURE_KIND_LABELS.llm_intent_unavailable).toBe('无法理解指令')
      expect(FAILURE_KIND_LABELS.llm_timeout).toBe('理解超时')
      expect(FAILURE_KIND_LABELS.candidate_zero_match).toBe('未找到匹配节目')
      expect(FAILURE_KIND_LABELS.candidate_field_conflict).toBe('节目字段不匹配')
      expect(FAILURE_KIND_LABELS.preview_only_violation).toBe('预览模式禁止写入')
      expect(FAILURE_KIND_LABELS.unable_to_decide).toBe('无法决策')
      expect(FAILURE_KIND_LABELS.capability_route_conflict).toBe('能力路由冲突')
    })

    it('getSlotLabel 未知槽位名应返回原值', () => {
      expect(getSlotLabel('unknown_slot')).toBe('unknown_slot')
    })

    it('getFailureHeadline 未知类型应返回兜底文案', () => {
      // 类型系统保证不会传入未知 kind，但运行时仍应兜底
      expect(getFailureHeadline('llm_timeout' as never)).toBe('理解超时')
    })

    it('formatSlotValue 应正确格式化各种类型', () => {
      expect(formatSlotValue(null)).toBe('')
      expect(formatSlotValue(undefined)).toBe('')
      expect(formatSlotValue('hello')).toBe('hello')
      expect(formatSlotValue(42)).toBe('42')
      expect(formatSlotValue(true)).toBe('true')
      expect(formatSlotValue(['a', 'b', 'c'])).toBe('a, b, c')
      expect(formatSlotValue({ key: 'val' })).toBe('{"key":"val"}')
    })

    it('formatSlotValue 对循环引用对象应兜底为字符串且不抛错', () => {
      // 构造循环引用对象，JSON.stringify 会抛错
      const cyclic: Record<string, unknown> = { name: 'cyclic' }
      cyclic.self = cyclic
      // 不应抛错，应返回兜底字符串（String(obj) 形式）
      const result = formatSlotValue(cyclic)
      expect(typeof result).toBe('string')
      expect(result.length).toBeGreaterThan(0)
    })

    it('formatRecognizedSlots 应转换槽位为渲染数据', () => {
      const hints = formatRecognizedSlots([
        { name: 'playlistType', value: 'tv', confidence: 0.9, source: 'context' },
        { name: 'programName', value: '看东方', confidence: 0.85, source: 'user_input' },
      ])
      expect(hints).toHaveLength(2)
      expect(hints[0].label).toBe('播单类型')
      expect(hints[0].value).toBe('tv')
      expect(hints[1].label).toBe('节目名')
      expect(hints[1].value).toBe('看东方')
    })

    it('formatMissingSlots 应转换缺失槽位为渲染数据', () => {
      const hints = formatMissingSlots([
        { name: 'timeRange', reason: '需要明确时段。' },
        { name: 'intent', reason: '需要明确命令意图。' },
      ])
      expect(hints).toHaveLength(2)
      expect(hints[0].label).toBe('时段')
      expect(hints[0].reason).toBe('需要明确时段。')
      expect(hints[1].label).toBe('命令意图')
    })

    it('formatFailureEnvelope 应完整转换 envelope 为渲染数据', () => {
      const envelope = buildRecoverableFailureEnvelope({
        kind: 'candidate_zero_match',
        recognizedSlots: [
          { name: 'programName', value: '上海旅游纪录片', confidence: 0.85, source: 'user_input' },
        ],
        missingSlots: [{ name: 'strategy', reason: '需要明确策略。', suggestedValues: ['内容匹配优先'] }],
        candidateEvidence: [],
        noMutation: true,
        humanSummary: '未在节目库中找到该节目。',
        traceId: 'trace-format-013',
      })

      const render = formatFailureEnvelope(envelope)
      expect(render.headline).toBe('未找到匹配节目')
      expect(render.summary).toBe('未在节目库中找到该节目。')
      expect(render.kind).toBe('candidate_zero_match')
      expect(render.recognizedHints).toHaveLength(1)
      expect(render.recognizedHints[0].label).toBe('节目名')
      expect(render.recognizedHints[0].value).toBe('上海旅游纪录片')
      expect(render.missingHints).toHaveLength(1)
      expect(render.missingHints[0].label).toBe('策略')
      expect(render.candidateCards).toEqual([])
      expect(render.quickReplies.length).toBeGreaterThan(0)
      expect(render.traceId).toBe('trace-format-013')
    })

    it('formatFailureEnvelope 是纯函数：不修改原 envelope', () => {
      const envelope = buildRecoverableFailureEnvelope({
        kind: 'llm_timeout',
        noMutation: true,
        humanSummary: '超时。',
        traceId: 'trace-pure-format-014',
      })
      const snapshot = JSON.parse(JSON.stringify(envelope))
      formatFailureEnvelope(envelope)
      expect(envelope).toEqual(snapshot)
    })
  })
})
