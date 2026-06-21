import type {
  AgentAuditOutcome,
  AgentAuditSummary,
  AgentCandidateAssessmentSignal,
  AgentConstraintHandling,
  AgentConstraintIssue,
  AgentEvidenceChainItem,
  AgentIntentInterpretationAudit,
  AgentLlmCallAuditItem,
  AgentLlmUsageAudit,
  AgentOperationAudit,
  AgentPlaylistPolicyAudit,
  AgentPendingTask,
  AgentPendingTaskAuditSnapshot,
  AgentProfessionalRuleSummary,
  AgentResult,
  SchedulingContext,
  SchedulingContextSourceContext,
  SchedulingContextSourceEvidence,
} from './types'
import { AgentPlaylistPolicy } from './playlistPolicy'

const playlistPolicy = new AgentPlaylistPolicy()

export const buildAgentAuditSummary = (
  result: AgentResult,
  contextSources?: SchedulingContextSourceContext,
  context?: SchedulingContext,
): AgentAuditSummary => {
  const candidateSelection = result.decision.candidateSelection
  const constraintIssues = result.decision.constraintReport?.issues ?? []
  const professionalSignals = candidateSelection?.professionalAssessment?.signals ?? []
  const signalSourceSummary = buildSignalSourceSummary(professionalSignals)
  const professionalRuleSummary = buildProfessionalRuleSummary(professionalSignals)
  const professionalConclusion = buildProfessionalConclusion(result)
  const confirmationReason = buildConfirmationReason(result)
  const blockerReason = buildBlockerReason(result)
  const pendingTask = buildPendingTaskSnapshot(result.decision.pendingTask)
  const intentInterpretation = buildIntentInterpretationAudit(result)
  const llmUsage = buildLlmUsageAudit(result)
  const sourceCoverageBlockers = buildContextSourceCoverageBlockers(result, contextSources)
  const constraintHandling = buildConstraintHandling(constraintIssues, result)
  const operation = buildOperationAudit(result)
  const playlistPolicy = buildPlaylistPolicyAudit(result, context)
  const evidenceChain = buildEvidenceChain(contextSources, professionalSignals, constraintIssues)
  const keyPoints = [
    describeIntent(result),
    describeIntentInterpretation(intentInterpretation),
    describeLlmUsage(llmUsage),
    describePlaylistPolicy(playlistPolicy),
    professionalConclusion,
    confirmationReason,
    describeOperation(operation),
    describePendingTask(pendingTask),
    describeContextSources(contextSources),
    describeEvidenceChain(evidenceChain),
    describeConstraintHandling(constraintHandling),
    describeSignalSources(signalSourceSummary),
    describeProfessionalRuleSummary(professionalRuleSummary),
    ...describeCandidate(candidateSelection),
    ...professionalSignals
      .filter((signal) => signal.verdict === 'prefer' || signal.verdict === 'pass')
      .slice(0, 3)
      .map(formatSignal),
  ].filter((item): item is string => Boolean(item))

  const warnings = [
    ...professionalSignals
      .filter((signal) => signal.verdict === 'warn')
      .map(formatSignal),
    ...constraintIssues
      .filter((issue) => issue.severity !== 'critical')
      .map((issue) => issue.message),
  ]

  const blockers = [
    blockerReason,
    ...sourceCoverageBlockers,
    ...professionalSignals
      .filter((signal) => signal.verdict === 'block')
      .map(formatSignal),
    ...constraintIssues
      .filter((issue) => issue.severity === 'critical')
      .map((issue) => issue.message),
  ].filter((item): item is string => Boolean(item))

  return {
    outcome: mapOutcome(result),
    title: buildTitle(result.status),
    professionalConclusion,
    confirmationReason,
    blockerReason,
    keyPoints,
    warnings,
    blockers,
    contextSources: cloneContextSources(contextSources),
    signalSourceSummary,
    pendingTask,
    candidate: candidateSelection
      ? {
          candidateId: candidateSelection.selectedCandidateId,
          programCode: candidateSelection.selectedProgramCode,
          method: candidateSelection.method,
          source: candidateSelection.source,
          reason: candidateSelection.reason,
          expectedSequence: candidateSelection.expectedSequence,
          selectedSequence: candidateSelection.selectedSequence,
          seriesKey: candidateSelection.seriesKey,
        }
      : undefined,
    professionalSignals,
    professionalRuleSummary,
    constraintIssueCodes: constraintIssues.map((issue) => issue.code),
    constraintHandling,
    evidenceChain,
    intentInterpretation,
    llmUsage,
    playlistPolicy,
    operation,
  }
}

const mapOutcome = (result: AgentResult): AgentAuditOutcome => {
  if (result.status === 'executed' && (
    result.decision.intent === 'query'
    || result.decision.intent === 'validate'
  )) {
    return 'read_only'
  }
  if (result.status === 'executed') return 'executed'
  if (result.status === 'failed') return 'failed'
  if (result.status === 'blocked') return 'blocked'
  if (result.status === 'needs_confirmation' || result.status === 'needs_clarification') return 'pending'
  return 'read_only'
}

const buildTitle = (status: AgentResult['status']): string => {
  if (status === 'executed') return '已执行，约束校验通过'
  if (status === 'needs_confirmation') return '待确认，已完成候选判断'
  if (status === 'needs_clarification') return '待补参，已保存结构化上下文'
  if (status === 'blocked') return '已阻断，存在不可硬排风险'
  if (status === 'failed') return '执行后校验未通过'
  return '已完成只读判断'
}

const describeIntent = (result: AgentResult): string | undefined => {
  const intent = result.decision.intent
  if (!intent) return undefined
  return `原子命令：${intent}`
}

const buildLlmUsageAudit = (result: AgentResult): AgentLlmUsageAudit => {
  const calls = result.trace
    .map((step) => toLlmCallAuditItem(step.detail?.llmCall))
    .filter((item): item is AgentLlmCallAuditItem => Boolean(item))

  return {
    callsAttempted: calls.filter((call) => call.status === 'attempted').length,
    callsSucceeded: calls.filter((call) => call.status === 'succeeded').length,
    callsRejected: calls.filter((call) => call.status === 'rejected').length,
    callsFailed: calls.filter((call) => call.status === 'failed').length,
    calls,
  }
}

const toLlmCallAuditItem = (value: unknown): AgentLlmCallAuditItem | null => {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  if (record.stage !== 'intent_interpreter') return null
  if (
    record.status !== 'attempted'
    && record.status !== 'succeeded'
    && record.status !== 'rejected'
    && record.status !== 'failed'
  ) return null

  return {
    stage: 'intent_interpreter',
    status: record.status,
    reason: typeof record.reason === 'string' ? record.reason : undefined,
  }
}

const describeLlmUsage = (usage: AgentLlmUsageAudit): string =>
  `LLM 调用：尝试=${usage.callsAttempted}，成功=${usage.callsSucceeded}，拒绝=${usage.callsRejected}，失败=${usage.callsFailed}`

const buildPlaylistPolicyAudit = (
  result: AgentResult,
  context?: SchedulingContext,
): AgentPlaylistPolicyAudit | undefined => {
  if (!context) return undefined
  const commandIntent = result.decision.command?.intent ?? result.decision.intent
  if (!commandIntent) return undefined
  const executionMode = playlistPolicy.getExecutionMode(commandIntent, context)
  const decision = playlistPolicy.decideCommand({
    intent: commandIntent,
    context,
    forceExecute: result.executionResult?.committed === true,
  })
  return {
    playlistType: context.playlistType,
    rotationStrategy: context.rotationStrategy,
    commandIntent,
    executionMode,
    policyAction: decision.action,
    requiresConfirmation: decision.requiresConfirmation,
    reason: decision.reason,
  }
}

const describePlaylistPolicy = (
  policy: AgentPlaylistPolicyAudit | undefined,
): string | undefined => {
  if (!policy) return undefined
  return [
    `播单策略：类型=${policy.playlistType}`,
    policy.rotationStrategy ? `策略=${policy.rotationStrategy}` : '',
    policy.commandIntent ? `命令=${policy.commandIntent}` : '',
    `执行模式=${policy.executionMode}`,
    `动作=${policy.policyAction}`,
    `需确认=${policy.requiresConfirmation ? '是' : '否'}`,
  ].filter(Boolean).join(', ')
}

const buildIntentInterpretationAudit = (result: AgentResult): AgentIntentInterpretationAudit | undefined => {
  const interpretation = result.input.interpretation
  if (!interpretation?.intent) return undefined
  const slots = interpretation.slots ?? {}
  return {
    source: interpretation.source,
    confidence: interpretation.confidence,
    llmUsed: interpretation.source === 'llm',
    pendingAction: interpretation.pendingAction,
    slotKeys: Object.keys(slots) as Array<keyof typeof slots>,
    queryKind: interpretation.queryKind,
    keyword: interpretation.keyword,
    reasoning: interpretation.reasoning,
    assistantFeedback: interpretation.assistantFeedback,
  }
}

const describeIntentInterpretation = (
  interpretation: AgentIntentInterpretationAudit | undefined,
): string | undefined => {
  if (!interpretation) return '意图理解：来源=能力包兜底'
  return [
    `意图理解：来源=${interpretation.source}`,
    `LLM=${interpretation.llmUsed ? '是' : '否'}`,
    interpretation.pendingAction ? `待处理动作=${interpretation.pendingAction}` : '',
    interpretation.slotKeys.length ? `槽位=${interpretation.slotKeys.join('|')}` : '',
    interpretation.queryKind ? `查询类型=${interpretation.queryKind}` : '',
  ].filter(Boolean).join(', ')
}

const buildOperationAudit = (result: AgentResult): AgentOperationAudit => {
  const executionResult = result.executionResult
  const preview = result.decision.preview
  const commandIntent = result.decision.command?.intent ?? result.decision.intent
  return {
    committed: executionResult?.committed === true,
    commitAttempted: Boolean(executionResult),
    commitGuardStatus: buildCommitGuardStatus(result),
    operationId: executionResult?.operationId,
    commandIntent,
    affectedItemIds: executionResult?.affectedItemIds ?? [],
    affectedCount: executionResult?.affectedItemIds.length ?? 0,
    previewAffectedItemIds: preview?.affectedItemIds ?? [],
    previewAffectedCount: preview?.affectedItemIds.length ?? 0,
    previewAffectedTimeRanges: preview?.affectedTimeRanges ?? [],
    previewSummary: buildPreviewSummary(result),
    validationOk: result.validationReport?.ok,
    reason: buildOperationReason(result),
  }
}

const buildPreviewSummary = (result: AgentResult): string[] => {
  const preview = result.decision.preview
  if (!preview) return []
  const command = preview.command
  const ranges = preview.affectedTimeRanges
    .map((range) => `${toAuditClock(range.start)}-${toAuditClock(range.end)}`)
    .slice(0, 4)
  return [
    `intent=${command.intent}`,
    `affectedItems=${preview.affectedItemIds.length}`,
    ranges.length ? `affectedRanges=${ranges.join('|')}` : '',
    `before=${preview.before.length}`,
    `after=${preview.after.length}`,
  ].filter(Boolean)
}

const toAuditClock = (value: string): string => {
  const match = value.match(/T(\d{2}:\d{2}:\d{2})/) ?? value.match(/^(\d{2}:\d{2}:\d{2})/)
  return match?.[1] ?? value
}

const buildOperationReason = (result: AgentResult): string => {
  if (result.executionResult?.committed) {
    return result.validationReport?.ok === false
      ? '操作已经写入，但提交后校验发现仍有风险需要复核。'
      : '操作已经写入当前工作播单。'
  }
  if (result.status === 'needs_confirmation') return '操作正在等待确认，尚未写入播单。'
  if (result.status === 'needs_clarification') return '操作还在补充参数阶段，尚未写入播单。'
  if (result.status === 'blocked') return '操作在提交前已被阻断。'
  if (result.status === 'failed') return '操作执行后未通过校验，需要复核。'
  if (result.decision.intent === 'query' || result.decision.intent === 'validate') {
    return '这是只读操作，没有尝试写入播单。'
  }
  return '本轮没有尝试写入播单。'
}

const buildCommitGuardStatus = (result: AgentResult): AgentOperationAudit['commitGuardStatus'] => {
  const intent = result.decision.command?.intent ?? result.decision.intent
  if (intent === 'query' || intent === 'validate') return 'not_applicable'
  if (!result.executionResult) return 'not_attempted'
  if (result.executionResult.committed) return 'passed'
  const issueCodes = result.decision.constraintReport?.issues.map((issue) => issue.code) ?? []
  return issueCodes.includes('context_conflict') ? 'blocked' : 'not_attempted'
}

const describeOperation = (operation: AgentOperationAudit): string =>
  operation.committed
    ? `写入状态：已写入，操作=${operation.operationId ?? '未知'}，影响 ${operation.affectedCount} 条，校验=${operation.validationOk === false ? '未通过' : '通过'}，提交门禁=${operation.commitGuardStatus}`
    : `写入状态：未写入，预演影响 ${operation.previewAffectedCount} 条，提交门禁=${operation.commitGuardStatus}`

const buildProfessionalConclusion = (result: AgentResult): string | undefined => {
  const intent = result.decision.intent
  if (!intent) return undefined
  if (result.status === 'executed' && (intent === 'query' || intent === 'validate')) {
    return '专业判断：只读检查已完成，没有写入播单。'
  }
  if (result.status === 'executed') {
    return '专业判断：约束校验通过，操作已写入当前工作播单。'
  }
  if (result.status === 'needs_confirmation') {
    return '专业判断：方案可行，但写入前需要编排人员确认。'
  }
  if (result.status === 'blocked') {
    return '专业判断：存在阻断级编排风险，解决前不应写入播单。'
  }
  if (result.status === 'needs_clarification') {
    return '专业判断：当前还缺少关键编排参数，补齐前不能执行。'
  }
  if (result.status === 'failed') {
    return '专业判断：执行已结束，但后置校验没有通过。'
  }
  return undefined
}

const buildConfirmationReason = (result: AgentResult): string | undefined => {
  if (result.status !== 'needs_confirmation') return undefined
  const intent = result.decision.intent
  if (intent === 'delete' || intent === 'batch_delete') {
    return '确认原因：删除会改变正式播单记录，写入前需要确认目标和可恢复预期。'
  }
  if (intent === 'insert' || intent === 'replace') {
    const candidateName = result.decision.recommendations?.[0]?.programName
    return candidateName
      ? `确认原因：候选节目《${candidateName}》已进入预演，写入该位置前需要确认。`
      : '确认原因：候选写入已进入预演，写入位置前需要确认所选节目。'
  }
  return '确认原因：这类操作写入前需要明确确认。'
}

const buildBlockerReason = (result: AgentResult): string | undefined => {
  if (result.status !== 'blocked') return undefined
  const issueCodes = result.decision.constraintReport?.issues.map((issue) => issue.code) ?? []
  const signalCodes = result.decision.candidateSelection?.professionalAssessment?.hardBlockCodes ?? []
  const codes = new Set([...issueCodes, ...signalCodes])

  if (codes.has('locked_item')) {
    return '阻断原因：目标节目被锁定或受保护，需要先解除锁定或选择其他节目。'
  }
  if (codes.has('time_overlap')) {
    return '阻断原因：目标位置已有节目占用，需要调整时间或时长后再提交。'
  }
  if (codes.has('blocked_time_range')) {
    return '阻断原因：目标位置落在禁排时段内，不能直接写入。'
  }
  if (codes.has('out_of_layout_bounds')) {
    return '阻断原因：节目越出了播出边界，需要保持在当前播出窗口内。'
  }
  if (codes.has('schedule_source_missing')) {
    return '阻断原因：缺少当前播单数据，无法证明写入安全。'
  }
  if (codes.has('sequence_violation')) {
    return '阻断原因：该方案会破坏顺播顺序，必须从期望集数继续，不能跳集或倒排。'
  }
  if (codes.has('candidate_source_missing')) {
    return '阻断原因：缺少候选节目库，无法证明节目选择安全。'
  }
  if (codes.has('context_conflict')) {
    return '阻断原因：提交前播单已变化，必须基于最新播单重新预演。'
  }
  if (codes.has('capability_route_conflict')) {
    return '阻断原因：多个能力都匹配了这条请求，系统在选择命令归属前停止执行。'
  }
  if (codes.has('program_not_found') || codes.has('program_ambiguous')) {
    return '阻断原因：节目库证据还不足，需要先明确候选节目。'
  }
  if (codes.has('material_not_ready') || codes.has('material_readiness')) {
    return '阻断原因：所选素材尚未达到可播状态，不能排入播单。'
  }
  if (codes.has('rights_not_ready') || codes.has('rights_readiness')) {
    return '阻断原因：播出权利尚未满足，不能写入该节目。'
  }
  return '阻断原因：关键编排约束阻止了本次操作。'
}

const buildConstraintHandling = (
  issues: AgentConstraintIssue[],
  result: AgentResult,
): AgentConstraintHandling[] =>
  issues.map((issue) => ({
    code: issue.code,
    severity: issue.severity,
    action: mapConstraintHandlingAction(issue, result),
    reason: buildConstraintHandlingReason(issue, result),
  }))

const mapConstraintHandlingAction = (
  issue: AgentConstraintIssue,
  result: AgentResult,
): AgentConstraintHandling['action'] => {
  if (issue.code === 'context_conflict') return 'block'
  if (issue.severity === 'critical') return 'block'
  if (issue.severity === 'warning' && result.status === 'needs_confirmation') return 'confirm'
  if (issue.severity === 'warning') return 'warn'
  return 'record'
}

const buildConstraintHandlingReason = (
  issue: AgentConstraintIssue,
  result: AgentResult,
): string => {
  if (issue.code === 'locked_item') return '锁定或受保护的节目需要先人工解除保护，才能写入。'
  if (issue.code === 'blocked_time_range') return '禁排时段属于硬约束，不能跨越。'
  if (issue.code === 'out_of_layout_bounds') return '播出边界限定了本次可编排窗口。'
  if (issue.code === 'time_overlap') return '节目重叠会造成无效的播单时间线。'
  if (issue.code === 'schedule_source_missing') return '写入前必须具备当前播单证据。'
  if (issue.code === 'constraint_source_missing') return '完整校验需要边界、锁定和禁排等约束证据。'
  if (issue.code === 'history_source_missing') return '完整电视顺播校验需要历史播出证据。'
  if (issue.code === 'sequence_violation') return '顺播节目必须保持集数连续。'
  if (issue.code === 'material_not_ready') return '节目写入前必须满足素材可播。'
  if (issue.code === 'rights_not_ready') return '节目写入前必须满足权利可播。'
  if (issue.code === 'candidate_source_missing') return '候选写入前必须具备候选节目库证据。'
  if (issue.code === 'context_conflict') return '提交前播单已变化，需要基于最新播单重新预演。'
  if (issue.code === 'capability_route_conflict') return '执行前必须把请求归属到唯一命令能力。'
  if (issue.code === 'program_not_found' || issue.code === 'program_ambiguous') {
    return '排入播单前，节目库证据必须明确到一个可用候选。'
  }
  if (issue.code === 'missing_required_slot') return '命令还缺少必要的编排参数。'
  if (issue.code === 'target_not_found' || issue.code === 'target_ambiguous') {
    return '执行前必须把目标节目定位到播单中的唯一条目。'
  }
  if (result.status === 'needs_confirmation') return '该风险需要编排人员确认后才能提交。'
  if (issue.severity === 'critical') return '严重约束会阻止本次操作。'
  if (issue.severity === 'warning') return '警告约束会保留给编排人员复核。'
  return '信息类约束会记录在审计证据中。'
}

const describeConstraintHandling = (
  handling: AgentConstraintHandling[],
): string | undefined => {
  if (handling.length === 0) return undefined
  return `约束处理：${handling.map((item) => `${item.code}=${item.action}`).join(', ')}`
}

const sourceLabels: Record<keyof SchedulingContextSourceContext, string> = {
  today: 'today',
  candidates: 'candidates',
  readiness: 'readiness',
  history: 'history',
  constraints: 'constraints',
  policy: 'policy',
}

const sourceRoles: Record<keyof SchedulingContextSourceContext, string> = {
  today: 'current playlist and target-slot evidence',
  candidates: 'candidate programme lookup evidence',
  readiness: 'material, rights, and broadcast readiness evidence',
  history: 'previous schedule and sequence continuity evidence',
  constraints: 'layout bounds, locks, and blocked-range evidence',
  policy: 'TV or rotation playlist execution policy evidence',
}

const constraintIssueSourceHints: Partial<Record<AgentConstraintIssue['code'], Array<keyof SchedulingContextSourceContext>>> = {
  target_not_found: ['today'],
  target_ambiguous: ['today'],
  locked_item: ['today', 'constraints'],
  out_of_layout_bounds: ['constraints'],
  blocked_time_range: ['constraints'],
  time_overlap: ['today', 'constraints'],
  sequence_violation: ['today', 'history'],
  missing_required_slot: ['policy'],
  schedule_source_missing: ['today'],
  candidate_source_missing: ['candidates'],
  history_source_missing: ['history'],
  constraint_source_missing: ['constraints'],
  context_conflict: ['today', 'candidates', 'readiness', 'history', 'constraints', 'policy'],
  capability_route_conflict: ['policy'],
  program_not_found: ['candidates'],
  program_ambiguous: ['candidates'],
  time_slot_mismatch: ['candidates', 'policy'],
  replacement_duty_mismatch: ['today', 'candidates', 'policy'],
  material_not_ready: ['readiness'],
  rights_not_ready: ['readiness'],
}

const buildEvidenceChain = (
  sources: SchedulingContextSourceContext | undefined,
  signals: AgentCandidateAssessmentSignal[],
  issues: AgentConstraintIssue[],
): AgentEvidenceChainItem[] => {
  if (!sources) return []

  return (Object.keys(sourceLabels) as Array<keyof SchedulingContextSourceContext>)
    .map((sourceKey) => {
      const evidence = sources[sourceKey]
      const signalCodes = signals
        .filter((signal) => signal.sourceKeys?.includes(sourceKey))
        .map((signal) => signal.code)
      const issueCodes = issues
        .filter((issue) => constraintIssueSourceHints[issue.code]?.includes(sourceKey))
        .map((issue) => `issue:${issue.code}`)
      const codes = Array.from(new Set([...signalCodes, ...issueCodes])).sort()

      return {
        sourceKey,
        role: sourceRoles[sourceKey],
        source: evidence.source,
        available: evidence.available,
        recordCount: evidence.recordCount,
        status: evidence.status,
        signalCodes: codes,
        conclusion: buildEvidenceConclusion(sourceKey, evidence, codes),
      }
    })
}

const buildEvidenceConclusion = (
  sourceKey: keyof SchedulingContextSourceContext,
  evidence: SchedulingContextSourceEvidence,
  signalCodes: string[],
): string => {
  if (evidence.source === 'none' || !evidence.available) {
    return `${sourceRoles[sourceKey]}缺失或不可用，这一类判断证据会变少。`
  }
  if (signalCodes.length > 0) {
    return `${sourceRoles[sourceKey]}参与了 ${signalCodes.join(', ')} 判断。`
  }
  return `${sourceRoles[sourceKey]}已加载，用于审计覆盖。`
}

const describeEvidenceChain = (chain: AgentEvidenceChainItem[]): string | undefined => {
  if (chain.length === 0) return undefined
  const used = chain
    .filter((item) => item.signalCodes.length > 0 || !item.available || item.source === 'none')
    .map((item) => `${item.sourceKey}[${item.signalCodes.length > 0 ? item.signalCodes.join('|') : item.available ? 'loaded' : 'missing'}]`)
  return used.length > 0 ? `证据链：${used.join(', ')}` : undefined
}

const describeContextSources = (sources?: SchedulingContextSourceContext): string | undefined => {
  if (!sources) return undefined
  const parts = (Object.keys(sourceLabels) as Array<keyof SchedulingContextSourceContext>)
    .map((key) => {
      const evidence = sources[key]
      const metadata = [
        evidence.status ? `status=${evidence.status}` : '',
        evidence.errorCode ? `error=${evidence.errorCode}` : '',
        evidence.version ? `version=${evidence.version}` : '',
        evidence.query?.limit ? `limit=${evidence.query.limit}` : '',
        evidence.query?.facets?.length ? `facets=${evidence.query.facets.join('|')}` : '',
      ].filter(Boolean).join(';')
      const suffix = metadata ? `(${metadata})` : ''
      if (evidence.source === 'none') return `${sourceLabels[key]}=missing:0${suffix}`
      if (!evidence.available) return `${sourceLabels[key]}=unavailable:${evidence.recordCount}${suffix}`
      return `${sourceLabels[key]}=${evidence.source}:${evidence.recordCount}${suffix}`
    })
    .filter(Boolean)

  return parts.length > 0 ? `上下文来源：${parts.join(', ')}` : undefined
}

const buildContextSourceCoverageBlockers = (
  result: AgentResult,
  sources?: SchedulingContextSourceContext,
): string[] => {
  if (!sources) return []
  const intent = result.decision.intent
  if (intent !== 'insert' && intent !== 'replace') return []
  if (sources.candidates.source !== 'none' && sources.candidates.available) return []
  return [
    '数据源缺失：候选节目库未配置，无法证明节目选择安全。',
  ]
}

const cloneContextSources = (
  sources?: SchedulingContextSourceContext,
): SchedulingContextSourceContext | undefined => {
  if (!sources) return undefined
  return {
    today: cloneSourceEvidence(sources.today),
    candidates: cloneSourceEvidence(sources.candidates),
    readiness: cloneSourceEvidence(sources.readiness),
    history: cloneSourceEvidence(sources.history),
    constraints: cloneSourceEvidence(sources.constraints),
    policy: cloneSourceEvidence(sources.policy),
  }
}

const cloneSourceEvidence = (
  evidence: SchedulingContextSourceEvidence,
): SchedulingContextSourceEvidence => ({ ...evidence })

const buildPendingTaskSnapshot = (
  pendingTask?: AgentPendingTask,
): AgentPendingTaskAuditSnapshot | undefined => {
  if (!pendingTask) return undefined
  return {
    id: pendingTask.id,
    intent: pendingTask.intent,
    phase: pendingTask.phase,
    collectedSlotKeys: Object.keys(pendingTask.collectedSlots).sort(),
    missingSlots: [...pendingTask.missingSlots],
    allowedActions: [...pendingTask.allowedActions],
    attemptCount: pendingTask.attemptCount,
    maxAttempts: pendingTask.maxAttempts,
    expiresAt: pendingTask.expiresAt,
    contextFingerprint: pendingTask.contextFingerprint,
    contextSources: pendingTask.contextSources?.map((source) => ({ ...source })),
    contextSourceSummary: buildPendingContextSourceSummary(pendingTask.contextSources),
    recommendationCount: pendingTask.recommendations?.length ?? 0,
    targetOptionCount: pendingTask.targetOptions?.length ?? 0,
  }
}

const describePendingTask = (
  pendingTask?: AgentPendingTaskAuditSnapshot,
): string | undefined => {
  if (!pendingTask) return undefined
  const missing = pendingTask.missingSlots.length > 0
    ? pendingTask.missingSlots.join('|')
    : 'none'
  const collected = pendingTask.collectedSlotKeys.length > 0
    ? pendingTask.collectedSlotKeys.join('|')
    : 'none'
  return [
    `待处理任务：阶段=${pendingTask.phase}`,
    `缺少=${missing}`,
    `已收集=${collected}`,
    `可用动作=${pendingTask.allowedActions.join('|')}`,
    `轮次=${pendingTask.attemptCount}/${pendingTask.maxAttempts}`,
    pendingTask.contextSourceSummary.length > 0
      ? `上下文来源=${pendingTask.contextSourceSummary.join('|')}`
      : undefined,
  ].filter((item): item is string => Boolean(item)).join(', ')
}

const buildPendingContextSourceSummary = (
  sources?: AgentPendingTask['contextSources'],
): string[] => {
  if (!sources?.length) return []
  return sources
    .map((source) => {
      const state = source.source === 'none'
        ? 'missing'
        : source.available
          ? source.source
          : 'unavailable'
      const digest = source.digest.slice(0, 12)
      return `${source.sourceKey}=${state}:${source.recordCount}#${digest}`
    })
    .sort()
}

const buildSignalSourceSummary = (signals: AgentCandidateAssessmentSignal[]): string[] => {
  const summary = new Map<string, Set<string>>()
  signals.forEach((signal) => {
    signal.sourceKeys?.forEach((sourceKey) => {
      if (!summary.has(sourceKey)) summary.set(sourceKey, new Set())
      summary.get(sourceKey)?.add(signal.code)
    })
  })

  return [...summary.entries()]
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([sourceKey, signalCodes]) => `${sourceKey}:${[...signalCodes].sort().join('|')}`)
}

const buildProfessionalRuleSummary = (
  signals: AgentCandidateAssessmentSignal[],
): AgentProfessionalRuleSummary => {
  const sourceKeys = new Set<string>()
  signals.forEach((signal) => {
    signal.sourceKeys?.forEach((sourceKey) => sourceKeys.add(sourceKey))
  })

  return {
    total: signals.length,
    blockingRuleIds: collectSignalRuleIds(signals, ['block']),
    warningRuleIds: collectSignalRuleIds(signals, ['warn']),
    positiveRuleIds: collectSignalRuleIds(signals, ['prefer', 'pass']),
    neutralRuleIds: collectSignalRuleIds(signals, ['neutral']),
    evidenceSourceKeys: [...sourceKeys].sort() as AgentProfessionalRuleSummary['evidenceSourceKeys'],
  }
}

const collectSignalRuleIds = (
  signals: AgentCandidateAssessmentSignal[],
  verdicts: AgentCandidateAssessmentSignal['verdict'][],
): string[] => Array.from(new Set(
  signals
    .filter((signal) => verdicts.includes(signal.verdict))
    .map((signal) => signal.code),
)).sort()

const describeSignalSources = (signalSourceSummary: string[]): string | undefined =>
  signalSourceSummary.length > 0
    ? `信号来源：${signalSourceSummary.join(', ')}`
    : undefined

const describeProfessionalRuleSummary = (
  summary: AgentProfessionalRuleSummary,
): string | undefined => {
  if (summary.total === 0) return undefined
  const parts = [
    `总数=${summary.total}`,
    summary.blockingRuleIds.length > 0 ? `阻断=${summary.blockingRuleIds.join('|')}` : '',
    summary.warningRuleIds.length > 0 ? `警告=${summary.warningRuleIds.join('|')}` : '',
    summary.positiveRuleIds.length > 0 ? `通过=${summary.positiveRuleIds.join('|')}` : '',
  ].filter(Boolean)
  return `专业规则：${parts.join(', ')}`
}

const describeCandidate = (
  candidateSelection: AgentResult['decision']['candidateSelection'],
): string[] => {
  if (!candidateSelection) return []
  const points = [
    `候选选择：${candidateSelection.method}/${candidateSelection.source}`,
  ]
  if (candidateSelection.selectedCandidateId) {
    points.push(`选中候选：${candidateSelection.selectedCandidateId}`)
  }
  if (
    typeof candidateSelection.expectedSequence === 'number'
    || typeof candidateSelection.selectedSequence === 'number'
  ) {
    points.push(`顺播判断：期望 ${candidateSelection.expectedSequence ?? '-'}，候选 ${candidateSelection.selectedSequence ?? '-'}`)
  }
  return points
}

const formatSignal = (signal: AgentCandidateAssessmentSignal): string =>
  `${formatSignalCode(signal.code)}：${formatSignalVerdict(signal.verdict)}`

const formatSignalCode = (code: string): string => {
  const labels: Record<string, string> = {
    material_readiness: '素材可播',
    rights_readiness: '权利可播',
    playlist_policy: '播单策略',
    content_alignment: '内容匹配',
    time_slot_fit: '时段职责',
    neighbor_column_fit: '相邻栏目',
    replacement_duty_fit: '替换职责',
    duration_fit: '时长匹配',
    same_day_duplicate: '同日重复',
    recent_replay_interval: '近期重播',
    rotation_priority: '轮播优先级',
  }
  return labels[code] ?? code
}

const formatSignalVerdict = (verdict: AgentCandidateAssessmentSignal['verdict']): string => {
  if (verdict === 'block') return '阻断'
  if (verdict === 'warn') return '提示风险'
  if (verdict === 'prefer') return '优先'
  if (verdict === 'pass') return '通过'
  return '已记录'
}
