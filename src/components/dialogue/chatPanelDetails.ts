import {
  buildCandidateComparisonNote,
  formatCandidateDuration,
  formatMatchedBy,
  formatProgramTypeLabel,
  formatSelectionModeLabel,
  formatSequenceLabel,
  formatValidationSummaryText,
  normalizeDecisionExplanation,
  toDetailMap,
  toPreviewRecord,
  toProgramRecord,
  toValidationSummaryRecord,
  truncateText,
} from './chatPanelFormatting'
import type {
  CandidateComparisonItem,
  DetailMap,
  DetailSummaryItem,
} from './chatPanelFormatting'

type BuildDetailsSummaryDeps = {
  formatDisplayTime: (value: string) => string
  formatDisplayTimeRange: (start: string, end?: string) => string
  formatProgramLabel: (value: unknown) => string
  resolveMatchedColumnInfo: (details?: DetailMap) => { columnId: string; columnName: string }
  buildQueryCriteriaSummary: (criteria: DetailMap) => string
  formatOffset: (offsetSeconds: number) => string
}

export const isOrchestrationOverviewDetails = (details?: DetailMap): boolean =>
  details?.summaryKind === 'orchestration_overview'

export const isLayoutImportDetails = (details?: DetailMap): boolean =>
  details?.summaryKind === 'layout_import'

export const isLayoutAnalysisDetails = (details?: DetailMap): boolean =>
  details?.summaryKind === 'layout_analysis'

const formatLayoutAnalysisMode = (details?: DetailMap): string => {
  if (!details) return ''
  if (details.webResearchStatus === 'unavailable') return '用户要求联网，但当前仅按本地数据分析'
  if (details.webResearchStatus === 'provided') return '已结合外部补充材料分析'
  return ''
}

const NO_CANDIDATE_PREFIX = 'No candidates found'

const formatOverviewValidationText = (details: DetailMap): string => {
  const riskCount = typeof details.validationRiskCount === 'number' ? details.validationRiskCount : undefined
  const noticeCount = typeof details.validationNoticeCount === 'number' ? details.validationNoticeCount : undefined
  if (typeof riskCount === 'number' || typeof noticeCount === 'number') {
    const parts = [
      riskCount && riskCount > 0 ? `${riskCount} 个风险` : '',
      noticeCount && noticeCount > 0 ? `${noticeCount} 个空窗/边界提示` : '',
    ].filter(Boolean)
    return parts.length > 0 ? parts.join('，') : '未发现明显问题'
  }
  return formatValidationSummaryText(details.validationSummary)
}

const CANDIDATE_REJECTION_LABELS: Record<string, string> = {
  explicit_sequence_no_match: '指定集数或期数没有命中节目库，已保留空缺并中止自动填充',
  functional_keyword_no_match: '预热、导视、集锦等功能型要求没有命中节目库，已保留空缺并中止自动填充',
  hard_keyword_no_match: '明确关键词没有命中节目库，已保留空缺并中止自动填充',
  duration_mismatch: '候选节目时长不满足当前空窗',
  program_type_mismatch: '候选节目类型不符合版面要求',
  column_has_no_programs: '当前栏目节目池为空',
  channel_has_no_programs: '当前频道节目库为空',
  all_candidates_already_used: '可用候选都已在当前编排中使用',
  all_candidates_excluded_by_history: '候选被历史顺播/排重规则排除',
  no_candidate_after_ranking: '候选排序后没有留下可自动编排节目',
}

const getCandidateDiagnostics = (details?: DetailMap): DetailMap | undefined =>
  toDetailMap(details?.diagnostics)

export const getCandidateQueryRejectionReasons = (details?: DetailMap): string[] => {
  const diagnostics = getCandidateDiagnostics(details)
  const reasons = new Set<string>()

  if (Array.isArray(diagnostics?.rejectionReasons)) {
    diagnostics.rejectionReasons.forEach((item) => {
      if (typeof item === 'string' && item.trim()) {
        reasons.add(item.trim())
      }
    })
  }

  if (typeof details?.error === 'string' && details.error.startsWith(NO_CANDIDATE_PREFIX)) {
    const [, suffix = ''] = details.error.split(':')
    suffix.split(',').forEach((item) => {
      const normalized = item.trim()
      if (normalized) reasons.add(normalized)
    })
  }

  if (reasons.has('explicit_sequence_no_match')) {
    reasons.delete('hard_keyword_no_match')
  }

  return Array.from(reasons)
}

export const formatCandidateQueryDiagnosticText = (details?: DetailMap): string => {
  const reasons = getCandidateQueryRejectionReasons(details)
  if (reasons.length === 0) return ''
  return reasons
    .map((reason) => CANDIDATE_REJECTION_LABELS[reason] ?? reason)
    .join('；')
}

const formatCandidateQueryFunnelText = (details?: DetailMap): string => {
  const diagnostics = getCandidateDiagnostics(details)
  if (!diagnostics) return ''

  const parts = [
    typeof diagnostics.columnMatchedCount === 'number' ? `栏目${diagnostics.columnMatchedCount}` : '',
    typeof diagnostics.durationMatchedCount === 'number' ? `时长${diagnostics.durationMatchedCount}` : '',
    typeof diagnostics.keywordMatchedCount === 'number' ? `关键词${diagnostics.keywordMatchedCount}` : '',
    typeof diagnostics.finalCandidateCount === 'number' ? `最终${diagnostics.finalCandidateCount}` : '',
  ].filter(Boolean)

  return parts.length ? parts.join(' / ') : ''
}

const EDITORIAL_DIMENSION_LABELS: Record<string, string> = {
  content_match: '内容',
  duration_fit: '时长',
  rating: '收视',
  trend: '热度',
  sequence: '顺播',
  type_fit: '类型',
  schedule_context: '当前播单',
}

const getEditorialDecision = (details?: DetailMap): DetailMap | undefined => {
  const direct = toDetailMap(details?.editorialDecision)
  if (direct) return direct
  const selectedCandidate = toProgramRecord(details?.selectedCandidate)
  return toDetailMap(selectedCandidate?.editorialDecision)
}

const formatEditorialDecisionText = (details?: DetailMap): string => {
  const editorialDecision = getEditorialDecision(details)
  const summary = typeof editorialDecision?.summary === 'string'
    ? normalizeDecisionExplanation(editorialDecision.summary)
    : ''
  if (summary) return truncateText(summary, 56)
  return typeof editorialDecision?.totalScore === 'number'
    ? `综合评分 ${editorialDecision.totalScore}`
    : ''
}

const formatEditorialDimensionText = (details?: DetailMap): string => {
  const editorialDecision = getEditorialDecision(details)
  const dimensions = Array.isArray(editorialDecision?.dimensions) ? editorialDecision.dimensions : []
  return dimensions
    .slice(0, 4)
    .map((dimension) => {
      const item = toDetailMap(dimension)
      const key = typeof item?.key === 'string' ? item.key : ''
      const label = EDITORIAL_DIMENSION_LABELS[key] ?? key
      const score = typeof item?.score === 'number' ? Math.round(item.score) : undefined
      return label && typeof score === 'number' ? `${label}${score}` : ''
    })
    .filter(Boolean)
    .join(' / ')
}

const getAgentAuditSummary = (details?: DetailMap): DetailMap | undefined =>
  toDetailMap(details?.auditSummary)

const getAuditStringList = (auditSummary: DetailMap | undefined, key: 'keyPoints' | 'warnings' | 'blockers'): string[] =>
  Array.isArray(auditSummary?.[key])
    ? (auditSummary[key] as unknown[]).filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : []

const getDetailStringList = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : []

const formatAgentProfessionalRuleSummaryText = (auditSummary?: DetailMap): string => {
  const summary = toDetailMap(auditSummary?.professionalRuleSummary)
  if (!summary) return ''

  const total = typeof summary.total === 'number' ? summary.total : undefined
  const blockingRuleIds = getDetailStringList(summary.blockingRuleIds)
  const warningRuleIds = getDetailStringList(summary.warningRuleIds)
  const positiveRuleIds = getDetailStringList(summary.positiveRuleIds)
  const evidenceSourceKeys = getDetailStringList(summary.evidenceSourceKeys)
  return truncateText([
    typeof total === 'number' ? `已检查 ${total} 条专业规则` : '',
    blockingRuleIds.length > 0 ? `阻断 ${blockingRuleIds.length} 条` : '',
    warningRuleIds.length > 0 ? `提醒 ${warningRuleIds.length} 条` : '',
    positiveRuleIds.length > 0 ? `支持依据：${formatMappedList(positiveRuleIds.slice(0, 4), PROFESSIONAL_RULE_LABELS)}` : '',
    evidenceSourceKeys.length > 0 ? `依据：${formatMappedList(evidenceSourceKeys, SOURCE_LABELS)}` : '',
  ].filter(Boolean).join('; '), 96)
}

const formatAgentAuditBasisText = (details?: DetailMap): string => {
  const auditSummary = getAgentAuditSummary(details)
  if (!auditSummary) return ''
  const title = typeof auditSummary.title === 'string' ? auditSummary.title : ''
  const keyPoints = [
    formatAgentProfessionalRuleSummaryText(auditSummary),
    ...getAuditStringList(auditSummary, 'keyPoints'),
  ].filter(Boolean).slice(0, 3)
  return [title, ...keyPoints].filter(Boolean).map((item) => truncateText(item, 48)).join('；')
}

const formatAgentAuditStringField = (
  details: DetailMap | undefined,
  key: 'professionalConclusion' | 'confirmationReason',
): string => {
  const auditSummary = getAgentAuditSummary(details)
  const value = auditSummary?.[key]
  return typeof value === 'string' ? truncateText(value, 96) : ''
}

const AUDIT_SOURCE_LABELS: Record<string, string> = {
  today: '今日编排',
  candidates: '候选节目',
  readiness: '播出就绪',
  history: '历史编排',
  constraints: '编排约束',
  policy: '播单策略',
}

const formatAgentAuditSourceText = (details?: DetailMap): string => {
  const auditSummary = getAgentAuditSummary(details)
  const contextSources = toDetailMap(auditSummary?.contextSources)
  if (!contextSources) return ''

  return Object.entries(AUDIT_SOURCE_LABELS)
    .map(([key, label]) => {
      const source = toDetailMap(contextSources[key])
      if (!source) return ''
      const sourceName = typeof source.source === 'string' ? source.source : 'unknown'
      const recordCount = typeof source.recordCount === 'number' ? source.recordCount : 0
      const status = typeof source.status === 'string' ? source.status : ''
      const errorCode = typeof source.errorCode === 'string' ? source.errorCode : ''
      const version = typeof source.version === 'string' ? source.version : ''
      const query = toDetailMap(source.query)
      const limit = typeof query?.limit === 'number' ? query.limit : undefined
      const state = sourceName === 'none'
        ? '缺失'
        : !source.available
          ? STATUS_LABELS[status] ?? '不可用'
          : '已读取'
      const meta = [
        errorCode ? `错误：${errorCode}` : '',
        version ? `版本 ${version}` : '',
        typeof limit === 'number' ? `上限 ${limit}` : '',
      ].filter(Boolean).join('，')
      const suffix = meta ? `（${meta}）` : ''
      return `${label}${state} ${recordCount} 条${suffix}`
    })
    .filter(Boolean)
    .join('；')
}

const formatAgentSignalSourceText = (details?: DetailMap): string => {
  const auditSummary = getAgentAuditSummary(details)
  const signalSourceSummary = Array.isArray(auditSummary?.signalSourceSummary)
    ? auditSummary.signalSourceSummary
    : []
  return signalSourceSummary
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .slice(0, 3)
    .map((item) => truncateText(item, 64))
    .join('；')
}

const getStringList = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : []

const INTENT_LABELS: Record<string, string> = {
  insert: '插入',
  move: '移动',
  replace: '替换',
  delete: '删除',
  batch_move: '批量移动',
  batch_delete: '批量删除',
  query: '查询',
  validate: '校验',
}

const PHASE_LABELS: Record<string, string> = {
  needs_clarification: '待补充信息',
  needs_selection: '待选择目标',
  needs_confirmation: '待确认执行',
}

const ACTION_LABELS: Record<string, string> = {
  confirm: '确认',
  reject: '拒绝',
  start_new_task: '开始新任务',
  cancel_pending: '取消当前任务',
  continue_pending: '继续补充',
  select_candidate: '选择候选',
}

const SLOT_LABELS: Record<string, string> = {
  targetTime: '目标时间',
  newStartTime: '新开始时间',
  rangeStart: '范围开始',
  rangeEnd: '范围结束',
  programHint: '节目线索',
  replacementHint: '替换节目线索',
  offsetSeconds: '移动幅度',
  direction: '移动方向',
  candidateId: '候选节目',
  targetItemId: '目标条目',
  targetProgramName: '目标节目',
  targetItemIds: '目标条目',
  confirmation: '确认',
}

const SOURCE_LABELS: Record<string, string> = {
  today: '今日编排',
  candidates: '候选节目',
  readiness: '播出就绪',
  history: '历史编排',
  constraints: '编排约束',
  policy: '播单策略',
}

const STATUS_LABELS: Record<string, string> = {
  ready: '可执行',
  blocked: '已阻断',
  limited: '有限可用',
  advisory: '需注意',
  available: '已读取',
  missing: '缺失',
  unavailable: '不可用',
}

const SAFETY_GATE_LABELS: Record<string, string> = {
  playlist_policy: '播单策略',
  source_coverage: '数据完整性',
  pending_lifecycle: '多轮处理',
  context_fingerprint: '播单变更校验',
  commit_fingerprint: '提交前复核',
  tv_sequence_selector: '电视顺播判断',
  llm_intent_contract: '理解用户要求',
  pending_llm_context: '合并待办信息',
  llm_usage_audit: '思考记录',
  candidate_query_facets: '拆开线索查找',
  professional_slot_policy: '时段规则',
  evidence_audit_chain: '查找过程',
}

const PROFESSIONAL_RULE_LABELS: Record<string, string> = {
  time_slot_fit: '时段匹配',
  replacement_duty_fit: '替换职责匹配',
  same_day_duplicate: '同日重复阻断',
  recent_replay_interval: '近期重播间隔',
  rotation_priority: '轮播素材优先级',
}

const formatMappedList = (values: string[], labels: Record<string, string>): string =>
  values.map((value) => labels[value] ?? value).join('、')

const formatAgentPendingTaskText = (details?: DetailMap): string => {
  const auditSummary = getAgentAuditSummary(details)
  const pendingTask = toDetailMap(auditSummary?.pendingTask)
  if (!pendingTask) return ''

  const intent = typeof pendingTask.intent === 'string' ? pendingTask.intent : ''
  const phase = typeof pendingTask.phase === 'string' ? pendingTask.phase : ''
  const missingSlots = getStringList(pendingTask.missingSlots)
  const collectedSlotKeys = getStringList(pendingTask.collectedSlotKeys)
  const allowedActions = getStringList(pendingTask.allowedActions)
  const attemptCount = typeof pendingTask.attemptCount === 'number' ? pendingTask.attemptCount : undefined
  const maxAttempts = typeof pendingTask.maxAttempts === 'number' ? pendingTask.maxAttempts : undefined

  const parts = [
    intent ? `${INTENT_LABELS[intent] ?? intent}` : '',
    phase ? `${PHASE_LABELS[phase] ?? phase}` : '',
    missingSlots.length > 0 ? `还需：${formatMappedList(missingSlots, SLOT_LABELS)}` : '参数已齐',
    collectedSlotKeys.length > 0 ? `已收集：${formatMappedList(collectedSlotKeys, SLOT_LABELS)}` : '',
    allowedActions.length > 0 ? `可选：${formatMappedList(allowedActions, ACTION_LABELS)}` : '',
    typeof attemptCount === 'number' && typeof maxAttempts === 'number'
      ? `第 ${attemptCount}/${maxAttempts} 轮`
      : '',
  ].filter(Boolean)

  return truncateText(parts.join('；'), 96)
}

const formatAgentPendingLlmContextText = (details?: DetailMap): string => {
  const context = toDetailMap(details?.agentLlmContextUsed) ?? toDetailMap(details?.agentPendingLlmContext)
  if (!context) return ''

  const pendingContext = toDetailMap(context.pendingContext)
  if (!pendingContext) return ''

  const mode = details?.agentLlmContextUsed ? '本轮已合并' : '下一轮将合并'
  const intent = typeof pendingContext.intent === 'string' ? pendingContext.intent : ''
  const phase = typeof pendingContext.phase === 'string' ? pendingContext.phase : ''
  const missingSlots = getStringList(pendingContext.missingSlots)
  const allowedActions = getStringList(context.allowedActions)
  const collectedSlots = toDetailMap(pendingContext.collectedSlots)
  const collectedSlotKeys = collectedSlots
    ? Object.keys(collectedSlots).filter((key) => collectedSlots[key] !== undefined && collectedSlots[key] !== null)
    : []
  const recommendations = Array.isArray(pendingContext.recommendations) ? pendingContext.recommendations : []
  const targetOptions = Array.isArray(pendingContext.targetOptions) ? pendingContext.targetOptions : []
  const sourceKeys = formatAgentPendingContextSourceKeys(pendingContext.contextSources)
  const evidenceText = formatAgentPendingContextEvidenceText(pendingContext.contextSources)
  const latestUserInput = typeof context.latestUserInput === 'string' && context.latestUserInput.trim()
    ? '已结合本轮输入'
    : ''

  return truncateText([
    mode,
    intent ? `${INTENT_LABELS[intent] ?? intent}` : '',
    phase ? `${PHASE_LABELS[phase] ?? phase}` : '',
    missingSlots.length > 0 ? `还需：${formatMappedList(missingSlots, SLOT_LABELS)}` : '参数已齐',
    collectedSlotKeys.length > 0 ? `已收集：${formatMappedList(collectedSlotKeys, SLOT_LABELS)}` : '',
    recommendations.length > 0 ? `候选 ${recommendations.length} 个` : '',
    targetOptions.length > 0 ? `目标 ${targetOptions.length} 个` : '',
    sourceKeys.length > 0 ? `参考：${formatMappedList(sourceKeys, SOURCE_LABELS)}` : '',
    evidenceText,
    allowedActions.length > 0 ? `可选：${formatMappedList(allowedActions, ACTION_LABELS)}` : '',
    latestUserInput,
  ].filter(Boolean).join('; '), 420)
}

const formatAgentConstraintHandlingText = (details?: DetailMap): string => {
  const auditSummary = getAgentAuditSummary(details)
  const handling = Array.isArray(auditSummary?.constraintHandling)
    ? auditSummary.constraintHandling
    : []
  return handling
    .slice(0, 3)
    .map((item) => {
      const record = toDetailMap(item)
      const code = typeof record?.code === 'string' ? record.code : ''
      const action = typeof record?.action === 'string' ? record.action : ''
      const actionLabel = action === 'block'
        ? '已阻断'
        : action === 'confirm'
          ? '需确认'
          : action === 'warn'
            ? '提醒'
            : action
      return code && action ? `${code}：${actionLabel}` : ''
    })
    .filter(Boolean)
    .join('；')
}

const formatAgentContextConflictText = (details?: DetailMap): string => {
  const constraintReport = toDetailMap(details?.constraintReport)
  const issues = Array.isArray(constraintReport?.issues) ? constraintReport.issues : []
  const contextConflict = issues
    .map((item) => toDetailMap(item))
    .find((item) => item?.code === 'context_conflict')
  const detail = toDetailMap(contextConflict?.detail)
  const summary = Array.isArray(detail?.sourceChangeSummary)
    ? detail.sourceChangeSummary
    : []

  return summary
    .map((item) => toDetailMap(item))
    .map((item) => {
      const sourceKey = typeof item?.sourceKey === 'string' ? item.sourceKey : ''
      const previousSamples = Array.isArray(item?.previousSamples)
        ? item.previousSamples.filter((sample): sample is string => typeof sample === 'string' && sample.trim().length > 0)
        : []
      const currentSamples = Array.isArray(item?.currentSamples)
        ? item.currentSamples.filter((sample): sample is string => typeof sample === 'string' && sample.trim().length > 0)
        : []
      const previous = previousSamples[0] ? truncateText(previousSamples[0], 38) : 'empty'
      const current = currentSamples[0] ? truncateText(currentSamples[0], 38) : 'empty'
      return sourceKey ? `${sourceKey}: ${previous} -> ${current}` : ''
    })
    .filter(Boolean)
    .slice(0, 3)
    .join(' | ')
}

const formatAgentIssueClock = (value: unknown): string => {
  if (typeof value !== 'string') return ''
  const text = value.includes('T') ? value.split('T')[1]?.slice(0, 8) : value
  return text || ''
}

const formatAgentTimeOverlapText = (
  details: DetailMap | undefined,
  formatDisplayTimeRange: (start: string, end?: string) => string,
): string => {
  const constraintReport = toDetailMap(details?.constraintReport)
  const issues = Array.isArray(constraintReport?.issues) ? constraintReport.issues : []
  const overlapIssue = issues
    .map((item) => toDetailMap(item))
    .find((item) => item?.code === 'time_overlap')
  const detail = toDetailMap(overlapIssue?.detail)
  if (!overlapIssue || !detail) return ''

  const conflictProgramName = typeof detail.conflictProgramName === 'string'
    ? detail.conflictProgramName.trim()
    : ''
  const conflictRange = toDetailMap(detail.conflictRange)
  const conflictStart = formatAgentIssueClock(conflictRange?.start)
  const conflictEnd = formatAgentIssueClock(conflictRange?.end)
  const conflictRangeText = conflictStart && conflictEnd
    ? formatDisplayTimeRange(conflictStart, conflictEnd)
    : ''
  const policy = detail.blockedPolicy === 'no_auto_shift_replace_reorder'
    ? '不自动下移/替换/重排'
    : ''
  return truncateText([
    conflictProgramName ? `占用：${conflictProgramName}` : '目标位置已有节目',
    conflictRangeText,
    policy,
  ].filter(Boolean).join('；'), 180)
}

const getAgentCandidateRetryDetail = (details?: DetailMap): DetailMap | undefined => {
  const constraintReport = toDetailMap(details?.constraintReport)
  const issues = Array.isArray(constraintReport?.issues) ? constraintReport.issues : []
  return issues
    .map((item) => toDetailMap(item))
    .filter((item): item is DetailMap => Boolean(item))
    .filter((item) => item.code === 'program_not_found')
    .map((item) => toDetailMap(item.detail))
    .find((detail): detail is DetailMap => Boolean(detail))
}

const formatAgentCandidateSearchText = (details?: DetailMap): string => {
  const retry = getAgentCandidateRetryDetail(details)
  if (!retry) {
    return formatAgentCandidateAuditSearchText(details)
  }

  const searchedKeyword = typeof retry.searchedKeyword === 'string' ? retry.searchedKeyword.trim() : ''
  const searchedFacets = getStringList(retry.searchedFacets).slice(0, 5)
  const candidateRecordCount = typeof retry.candidateRecordCount === 'number'
    ? retry.candidateRecordCount
    : undefined
  const candidateSourceStatus = typeof retry.candidateSourceStatus === 'string'
    ? retry.candidateSourceStatus
    : ''

  const parts = [
    searchedKeyword ? `主关键词：${searchedKeyword}` : '',
    searchedFacets.length > 0 ? `拆分词：${searchedFacets.join('、')}` : '',
    typeof candidateRecordCount === 'number' ? `候选源返回 ${candidateRecordCount} 条` : '',
    candidateSourceStatus ? `数据源：${STATUS_LABELS[candidateSourceStatus] ?? candidateSourceStatus}` : '',
  ].filter(Boolean)

  return truncateText(parts.join('；'), 180)
}

const formatAgentCandidateAuditSearchText = (details?: DetailMap): string => {
  const auditSummary = getAgentAuditSummary(details)
  const contextSources = toDetailMap(auditSummary?.contextSources)
  const candidateSource = toDetailMap(contextSources?.candidates)
  const query = toDetailMap(candidateSource?.query)
  if (!candidateSource || !query) return ''

  const searchedKeyword = typeof query.keyword === 'string' ? query.keyword.trim() : ''
  const searchedFacets = getStringList(query.facets).slice(0, 5)
  const candidateRecordCount = typeof candidateSource.recordCount === 'number'
    ? candidateSource.recordCount
    : undefined
  const candidateSourceStatus = typeof candidateSource.status === 'string'
    ? candidateSource.status
    : ''

  const parts = [
    searchedKeyword ? `主关键词：${searchedKeyword}` : '',
    searchedFacets.length > 0 ? `拆分词：${searchedFacets.join('、')}` : '',
    typeof candidateRecordCount === 'number' ? `候选源返回 ${candidateRecordCount} 条` : '',
    candidateSourceStatus ? `数据源：${STATUS_LABELS[candidateSourceStatus] ?? candidateSourceStatus}` : '',
  ].filter(Boolean)

  return truncateText(parts.join('；'), 180)
}

const formatAgentCandidateRetryText = (details?: DetailMap): string => {
  const retry = getAgentCandidateRetryDetail(details)
  if (!retry) return ''

  const suggestedKeywords = getStringList(retry.suggestedKeywords).slice(0, 5)
  const nextAction = typeof retry.nextAction === 'string' ? retry.nextAction : ''
  const nextActionText = nextAction === 'rewrite_keywords_and_retry'
    ? '保留任务，换关键词继续找'
    : nextAction
  return truncateText([
    nextActionText,
    suggestedKeywords.length > 0 ? `下一组：${suggestedKeywords.join('、')}` : '',
  ].filter(Boolean).join('；'), 180)
}

const formatAgentOperationText = (details?: DetailMap): string => {
  const auditSummary = getAgentAuditSummary(details)
  const operation = toDetailMap(auditSummary?.operation)
  if (!operation) return ''
  const committed = operation.committed === true
  const operationId = typeof operation.operationId === 'string' ? operation.operationId : ''
  const affectedCount = typeof operation.affectedCount === 'number' ? operation.affectedCount : 0
  const previewAffectedCount = typeof operation.previewAffectedCount === 'number' ? operation.previewAffectedCount : 0
  const reason = typeof operation.reason === 'string' ? operation.reason : ''
  const parts = [
    committed ? '已写入' : '未写入',
    operationId ? `操作=${operationId}` : '',
    committed ? `影响 ${affectedCount} 条` : `预演 ${previewAffectedCount} 条`,
    reason,
  ].filter(Boolean)
  return truncateText(parts.join('；'), 96)
}

const formatAgentAuditWarningText = (details?: DetailMap): string =>
  getAuditStringList(getAgentAuditSummary(details), 'warnings')
    .slice(0, 2)
    .map((item) => truncateText(item, 48))
    .join('；')

const formatAgentAuditBlockerText = (details?: DetailMap): string =>
  getAuditStringList(getAgentAuditSummary(details), 'blockers')
    .slice(0, 2)
    .map((item) => truncateText(item, 48))
    .join('；')

const formatAgentCapabilityText = (details?: DetailMap): string => {
  const capabilities = toDetailMap(details?.agentCapabilities)
  if (!capabilities) return ''

  const dataRequirements = Array.isArray(capabilities.dataRequirements)
    ? capabilities.dataRequirements
    : []
  const requirementMaps = dataRequirements
    .map((item) => toDetailMap(item))
    .filter((item): item is DetailMap => Boolean(item))
  const formatRequirement = (sourceKey: string) => {
    const requirement = requirementMaps.find((item) => item.sourceKey === sourceKey)
    const requiredFor = getStringList(requirement?.requiredFor)
    const guardCode = typeof requirement?.guardCode === 'string' ? requirement.guardCode : ''
    const requiredText = sourceKey === 'today' && requiredFor.length > 5
      ? '写入/查询/校验'
      : formatMappedList(requiredFor, INTENT_LABELS)
    return requiredFor.length > 0
      ? `${SOURCE_LABELS[sourceKey] ?? sourceKey}支撑${requiredText}${guardCode ? `（${guardCode}）` : ''}`
      : ''
  }
  const sourceText = [
    formatRequirement('today'),
    formatRequirement('candidates'),
  ].filter(Boolean).join('; ')

  const safetyGates = Array.isArray(capabilities.safetyGates)
    ? capabilities.safetyGates
    : []
  const visibleGateIds = [
    'playlist_policy',
    'source_coverage',
    'pending_lifecycle',
    'context_fingerprint',
    'commit_fingerprint',
    'tv_sequence_selector',
    'llm_intent_contract',
    'pending_llm_context',
    'llm_usage_audit',
    'candidate_query_facets',
    'professional_slot_policy',
    'evidence_audit_chain',
  ]
  const gateText = safetyGates
    .map((item) => toDetailMap(item))
    .map((item) => typeof item?.id === 'string' ? item.id : '')
    .filter((id) => visibleGateIds.includes(id))
    .slice(0, 12)
    .map((id) => SAFETY_GATE_LABELS[id] ?? id)
    .join('、')

  const professionalRules = Array.isArray(capabilities.professionalRules)
    ? capabilities.professionalRules
    : []
  const visibleRuleIds = [
    'time_slot_fit',
    'replacement_duty_fit',
    'same_day_duplicate',
    'recent_replay_interval',
    'rotation_priority',
  ]
  const ruleText = professionalRules
    .map((item) => toDetailMap(item))
    .map((item) => typeof item?.id === 'string' ? item.id : '')
    .filter((id) => visibleRuleIds.includes(id))
    .slice(0, 5)
    .map((id) => PROFESSIONAL_RULE_LABELS[id] ?? id)
    .join('、')

  return truncateText([
    sourceText,
    gateText ? `安全门禁：${gateText}` : '',
    ruleText ? `专业规则：${ruleText}` : '',
  ].filter(Boolean).join('; '), 520)
}

const getAgentOperationalReadiness = (details?: DetailMap): DetailMap | undefined =>
  toDetailMap(details?.agentOperationalReadiness)

const formatAgentPendingContextSourceKeys = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value
      .map((item) => toDetailMap(item))
      .map((item) => {
        const sourceKey = typeof item?.sourceKey === 'string' ? item.sourceKey : ''
        const key = typeof item?.key === 'string' ? item.key : ''
        return sourceKey || key
      })
      .filter(Boolean)
      .slice(0, 6)
  }

  const contextSources = toDetailMap(value)
  return contextSources
    ? Object.entries(contextSources)
      .filter(([, source]) => Boolean(source))
      .map(([key]) => key)
      .slice(0, 6)
    : []
}

const formatAgentPendingContextEvidenceText = (value: unknown): string => {
  const entries = Array.isArray(value)
    ? value.map((item) => {
        const source = toDetailMap(item)
        const sourceKey = typeof source?.sourceKey === 'string'
          ? source.sourceKey
          : typeof source?.key === 'string'
            ? source.key
            : ''
        return { sourceKey, source }
      })
    : Object.entries(toDetailMap(value) ?? {}).map(([sourceKey, source]) => ({
        sourceKey,
        source: toDetailMap(source),
      }))

  const evidence = entries
    .map(({ sourceKey, source }) => {
      const samples = Array.isArray(source?.samples)
        ? source.samples.filter((sample): sample is string => typeof sample === 'string' && sample.trim().length > 0)
        : []
      const sample = samples[0]
      const label = SOURCE_LABELS[sourceKey] ?? sourceKey
      return sourceKey && sample ? `${label}示例：${truncateText(sample, 52)}` : ''
    })
    .filter(Boolean)
    .slice(0, 4)
    .join('；')

  return evidence
}

const formatAgentOperationalReadinessText = (details?: DetailMap): string => {
  const readiness = getAgentOperationalReadiness(details)
  if (!readiness) return ''

  const status = typeof readiness.status === 'string' ? readiness.status : ''
  const executablePercent = typeof readiness.executablePercent === 'number'
    ? `${readiness.executablePercent}%`
    : ''
  const executableCommands = typeof readiness.executableCommands === 'number' ? readiness.executableCommands : undefined
  const totalCommands = typeof readiness.totalCommands === 'number' ? readiness.totalCommands : undefined
  const commandText = typeof executableCommands === 'number' && typeof totalCommands === 'number'
    ? `${executableCommands}/${totalCommands}`
    : ''
  const playlistType = typeof readiness.playlistType === 'string' ? readiness.playlistType : ''
  const commandReadiness = Array.isArray(readiness.commandReadiness) ? readiness.commandReadiness : []
  const limitedCommands = commandReadiness
    .map((item) => toDetailMap(item))
    .filter((item): item is DetailMap => Boolean(item))
    .filter((item) => item.status === 'blocked' || item.status === 'advisory')
    .slice(0, 4)
    .map((item) => {
      const intent = typeof item.intent === 'string' ? item.intent : ''
      const itemStatus = typeof item.status === 'string' ? item.status : ''
      return intent && itemStatus ? `${INTENT_LABELS[intent] ?? intent}：${STATUS_LABELS[itemStatus] ?? itemStatus}` : ''
    })
    .filter(Boolean)
    .join('、')
  const sourceCoverage = Array.isArray(readiness.sourceCoverage) ? readiness.sourceCoverage : []
  const limitedSources = sourceCoverage
    .map((item) => toDetailMap(item))
    .filter((item): item is DetailMap => Boolean(item))
    .filter((item) => item.status === 'missing' || item.status === 'unavailable')
    .slice(0, 4)
    .map((item) => {
      const sourceKey = typeof item.sourceKey === 'string' ? item.sourceKey : ''
      const sourceStatus = typeof item.status === 'string' ? item.status : ''
      return sourceKey && sourceStatus ? `${SOURCE_LABELS[sourceKey] ?? sourceKey}：${STATUS_LABELS[sourceStatus] ?? sourceStatus}` : ''
    })
    .filter(Boolean)
    .join('、')
  const commandRuleReadiness = Array.isArray(readiness.commandProfessionalRuleReadiness)
    ? readiness.commandProfessionalRuleReadiness
    : []
  const professionalRuleEffectSummary = toDetailMap(readiness.professionalRuleEffectSummary)
  const topLevelRuleText = professionalRuleEffectSummary
    ? [
        typeof professionalRuleEffectSummary.blockingGuardCount === 'number' && professionalRuleEffectSummary.blockingGuardCount > 0
          ? `阻断${professionalRuleEffectSummary.blockingGuardCount}`
          : '',
        typeof professionalRuleEffectSummary.warningCount === 'number' && professionalRuleEffectSummary.warningCount > 0
          ? `提醒${professionalRuleEffectSummary.warningCount}`
          : '',
        typeof professionalRuleEffectSummary.confirmationGuardCount === 'number' && professionalRuleEffectSummary.confirmationGuardCount > 0
          ? `确认${professionalRuleEffectSummary.confirmationGuardCount}`
          : '',
        typeof professionalRuleEffectSummary.partialEvidenceCount === 'number' && professionalRuleEffectSummary.partialEvidenceCount > 0
          ? `依据不足${professionalRuleEffectSummary.partialEvidenceCount}`
          : '',
      ].filter(Boolean).join(',')
    : ''
  const ruleText = commandRuleReadiness
    .map((item) => toDetailMap(item))
    .filter((item): item is DetailMap => Boolean(item))
    .filter((item) => Array.isArray(item.rules) && item.rules.length > 0)
    .slice(0, 2)
    .map((item) => {
      const intent = typeof item.intent === 'string' ? item.intent : ''
      const rules = Array.isArray(item.rules)
        ? item.rules.map((rule) => toDetailMap(rule)).filter((rule): rule is DetailMap => Boolean(rule))
        : []
      const blockingCount = rules.filter((rule) => rule.effect === 'blocking_guard').length
      const warningCount = rules.filter((rule) => rule.effect === 'warning').length
      const partialCount = rules.filter((rule) => rule.evidenceStatus === 'partial').length
      const parts = [
        blockingCount > 0 ? `阻断${blockingCount}` : '',
        warningCount > 0 ? `提醒${warningCount}` : '',
        partialCount > 0 ? `依据不足${partialCount}` : '',
      ].filter(Boolean)
      return intent && parts.length > 0 ? `${INTENT_LABELS[intent] ?? intent}：${parts.join(',')}` : ''
    })
    .filter(Boolean)
    .join('、')

  return truncateText([
    status ? `状态：${STATUS_LABELS[status] ?? status}` : '',
    commandText ? `可执行：${commandText}${executablePercent ? `（${executablePercent}）` : ''}` : executablePercent ? `可执行：${executablePercent}` : '',
    playlistType ? `播单：${playlistType === 'rotation' ? '轮播单' : playlistType === 'tv' ? '电视播单' : playlistType}` : '',
    limitedCommands ? `受限：${limitedCommands}` : '',
    limitedSources ? `缺少：${limitedSources}` : '',
    topLevelRuleText ? `规则：${topLevelRuleText}` : ruleText ? `规则：${ruleText}` : '',
  ].filter(Boolean).join('; '), 240)
}

const formatAgentOperationalReadinessWarningText = (details?: DetailMap): string[] => {
  const readiness = getAgentOperationalReadiness(details)
  if (!readiness) return []

  const commandReadiness = Array.isArray(readiness.commandReadiness) ? readiness.commandReadiness : []
  return commandReadiness
    .map((item) => toDetailMap(item))
    .filter((item): item is DetailMap => Boolean(item))
    .filter((item) => item.status === 'blocked' || item.status === 'advisory')
    .slice(0, 3)
    .map((item) => {
      const intent = typeof item.intent === 'string' ? item.intent : ''
      const status = typeof item.status === 'string' ? item.status : ''
      const blockingSources = getStringList(item.blockingSources)
      const advisorySources = getStringList(item.advisorySources)
      const sourceText = blockingSources.length > 0
        ? `缺少${formatMappedList(blockingSources, SOURCE_LABELS)}`
        : advisorySources.length > 0
          ? `${formatMappedList(advisorySources, SOURCE_LABELS)}需注意`
          : ''
      return intent && status && sourceText
        ? `${INTENT_LABELS[intent] ?? intent}${STATUS_LABELS[status] ?? status}：${sourceText}`
        : ''
    })
    .filter(Boolean)
}

export const isNoCandidateCase = (details: DetailMap) =>
  (typeof details.error === 'string' && details.error.startsWith(NO_CANDIDATE_PREFIX))
  || (details.candidateCount === 0 && getCandidateQueryRejectionReasons(details).length > 0)

export const extractWarnings = (details?: DetailMap): string[] => {
  if (!details) return []
  const warnings: string[] = []
  const auditSummary = getAgentAuditSummary(details)
  warnings.push(...getAuditStringList(auditSummary, 'blockers'))
  warnings.push(...getAuditStringList(auditSummary, 'warnings'))
  warnings.push(...formatAgentOperationalReadinessWarningText(details))
  const preview = toPreviewRecord(details.preview)
  const previewWarnings = Array.isArray(preview?.warnings)
    ? preview.warnings.filter((item): item is string => typeof item === 'string')
    : []
  warnings.push(...previewWarnings)

  if (preview?.canExecute === false) {
    warnings.push('预演显示当前方案会与现有编排冲突')
  }

  if (isNoCandidateCase(details)) {
    const diagnosticText = formatCandidateQueryDiagnosticText(details)
    if (diagnosticText) {
      warnings.push(diagnosticText)
    }
    warnings.push('当前条件下没有命中可直接使用的候选节目')
  }

  if (typeof details.error === 'string' && !details.error.startsWith(NO_CANDIDATE_PREFIX)) {
    warnings.push(details.error)
  }

  const validationSummary = toValidationSummaryRecord(details.validationSummary ?? details.summary)
  const totalIssues = validationSummary?.totalIssues ?? 0
  if (totalIssues > 0) {
    if (isOrchestrationOverviewDetails(details)) {
      const riskCount = typeof details.validationRiskCount === 'number' ? details.validationRiskCount : totalIssues
      const noticeCount = typeof details.validationNoticeCount === 'number' ? details.validationNoticeCount : 0
      if (riskCount > 0) {
        warnings.push(`校验仍提示 ${riskCount} 个风险`)
      }
      if (noticeCount > 0) {
        warnings.push(`另有 ${noticeCount} 个空窗或边界提示`)
      }
    } else {
      warnings.push(`校验仍发现 ${totalIssues} 个问题`)
    }
  }

  return Array.from(new Set(warnings.filter(Boolean))).slice(0, 3)
}

export const buildCandidateComparisonItems = (details?: DetailMap): CandidateComparisonItem[] => {
  if (!details) return []

  const selectedCandidate = toProgramRecord(details.selectedCandidate)
  const targetResolution = toDetailMap(details.targetResolution)
  const selectedId = selectedCandidate?.id ?? details.selectedCandidateId
  const selectedName = selectedCandidate?.programName ?? details.selectedCandidateName
  const selectionReason =
    normalizeDecisionExplanation(
      typeof details.selectionReason === 'string'
        ? details.selectionReason
        : typeof targetResolution?.reasoning === 'string'
          ? targetResolution.reasoning
          : undefined,
    ) || '更贴合当前时间、类型和约束条件。'

  const rawCandidates = Array.isArray(details.candidateOptions)
    ? details.candidateOptions
    : Array.isArray(details.topCandidates)
      ? details.topCandidates
      : []

  return rawCandidates
    .slice(0, 3)
    .map((candidate, index) => {
      const item = candidate as Record<string, unknown>
      const id = String(item.id ?? item.programCode ?? `candidate-${index}`)
      const name = String(item.programName ?? item.instanceName ?? item.programCode ?? id)
      const selected =
        (typeof selectedId === 'string' && selectedId === id)
        || (typeof selectedName === 'string' && selectedName === name)
        || (index === 0 && !selectedId && !selectedName)
      const sequenceLabel = formatSequenceLabel(item)
      const selectionModeLabel = formatSelectionModeLabel(
        typeof item.selectionMode === 'string' ? item.selectionMode : undefined,
      )
      const metaParts = [
        sequenceLabel,
        formatProgramTypeLabel(typeof item.programType === 'string' ? item.programType : undefined),
        formatCandidateDuration(typeof item.duration === 'number' ? item.duration : undefined),
        typeof item.estimatedRating === 'number' ? `收视${item.estimatedRating.toFixed(1)}` : '',
        typeof item.popularityScore === 'number' ? `热度${item.popularityScore.toFixed(1)}` : '',
        selectionModeLabel,
      ].filter(Boolean)

      return {
        id,
        name,
        meta: metaParts.join(' · ') || '可作为当前时段候选',
        note: buildCandidateComparisonNote(item, selected, selectionReason),
        selected,
      }
    })
}

export const buildDetailsSummary = (
  details: DetailMap | undefined,
  deps: BuildDetailsSummaryDeps,
): DetailSummaryItem[] => {
  if (!details) return []

  if (isOrchestrationOverviewDetails(details)) {
    const items: DetailSummaryItem[] = []
    const pushItem = (label: string, value?: string) => {
      const normalized = value?.trim()
      if (!normalized) return
      items.push({ label, value: normalized })
    }

    pushItem('版面来源', typeof details.layoutSourceFileName === 'string' ? details.layoutSourceFileName : '')
    pushItem('版面时段', typeof details.layoutSlotCount === 'number' ? `${details.layoutSlotCount} 个` : '')
    pushItem('补排轮次', typeof details.completedGapCount === 'number' ? `${details.completedGapCount} 轮` : '')
    pushItem('选中节目', typeof details.insertedItemCount === 'number' ? `${details.insertedItemCount} 次` : '')
    pushItem('实际写入', typeof details.writtenItemCount === 'number' ? `${details.writtenItemCount} 条` : '')
    pushItem('顺播推进', typeof details.sequentialFillCount === 'number' && details.sequentialFillCount > 0 ? `${details.sequentialFillCount} 次` : '')
    pushItem('重播补位', typeof details.rerunFillCount === 'number' && details.rerunFillCount > 0 ? `${details.rerunFillCount} 次` : '')
    pushItem('校验结果', formatOverviewValidationText(details))
    return items.slice(0, 6)
  }

  if (isLayoutImportDetails(details)) {
    const items: DetailSummaryItem[] = []
    const pushItem = (label: string, value?: string) => {
      const normalized = value?.trim()
      if (!normalized) return
      items.push({ label, value: normalized })
    }

    pushItem('版面文件', typeof details.fileName === 'string' ? details.fileName : '')
    pushItem('命中星期', typeof details.matchedWeekdayLabel === 'string' ? details.matchedWeekdayLabel : '')
    pushItem('命中列', typeof details.matchedColumnLabel === 'string' ? details.matchedColumnLabel : '')
    pushItem('工作表', typeof details.matchedSheetName === 'string' ? details.matchedSheetName : '')
    pushItem('版面时段', typeof details.slotCount === 'number' ? `${details.slotCount} 个` : '')
    pushItem('栏目数量', typeof details.columnCount === 'number' ? `${details.columnCount} 个` : '')
    pushItem('顺播栏目', typeof details.sequentialColumnCount === 'number' ? `${details.sequentialColumnCount} 个` : '')
    pushItem(
      '导入提醒',
      Array.isArray(details.warnings)
        ? details.warnings.filter((item: unknown): item is string => typeof item === 'string').join('；')
        : '',
    )
    return items.slice(0, 6)
  }

  if (isLayoutAnalysisDetails(details)) {
    const items: DetailSummaryItem[] = []
    const pushItem = (label: string, value?: string) => {
      const normalized = value?.trim()
      if (!normalized) return
      items.push({ label, value: normalized })
    }

    pushItem('编排条目', typeof details.itemCount === 'number' ? `${details.itemCount} 条` : '')
    pushItem('版面命中', typeof details.alignedSlotCount === 'number' && typeof details.slotCount === 'number' ? `${details.alignedSlotCount}/${details.slotCount}` : '')
    pushItem('结构偏差', typeof details.mismatchSlotCount === 'number' ? `${details.mismatchSlotCount} 个时段` : '')
    pushItem('空缺时段', typeof details.emptySlotCount === 'number' && details.emptySlotCount > 0 ? `${details.emptySlotCount} 个` : '')
    pushItem('校验结果', formatValidationSummaryText(details.validationSummary))
    pushItem('分析方式', formatLayoutAnalysisMode(details))
    pushItem(
      '优化建议',
      Array.isArray(details.suggestions)
        ? details.suggestions.filter((item: unknown): item is string => typeof item === 'string').slice(0, 2).join('；')
        : '',
    )
    return items.slice(0, 6)
  }

  const items: DetailSummaryItem[] = []
  const pushItem = (label: string, value?: string) => {
    const normalized = value?.trim()
    if (!normalized) return
    if (items.some((item) => item.label === label && item.value === normalized)) return
    items.push({ label, value: normalized })
  }

  pushItem('专业结论', formatAgentAuditStringField(details, 'professionalConclusion'))
  pushItem('提交状态', formatAgentOperationText(details))
  pushItem('编排依据', formatAgentAuditBasisText(details))
  pushItem('待处理状态', formatAgentPendingTaskText(details))
  pushItem('播单变化', formatAgentContextConflictText(details))
  pushItem('占用检查', formatAgentTimeOverlapText(details, deps.formatDisplayTimeRange))
  pushItem('参考信息', formatAgentPendingLlmContextText(details))
  pushItem('约束处置', formatAgentConstraintHandlingText(details))
  pushItem('检索动作', formatAgentCandidateSearchText(details))
  pushItem('继续检索', formatAgentCandidateRetryText(details))
  pushItem('数据来源', formatAgentAuditSourceText(details))
  pushItem('判断来源', formatAgentSignalSourceText(details))
  pushItem('确认理由', formatAgentAuditStringField(details, 'confirmationReason'))
  pushItem('阻断原因', formatAgentAuditBlockerText(details))
  pushItem('专业警示', formatAgentAuditWarningText(details))
  pushItem('可执行性', formatAgentOperationalReadinessText(details))
  pushItem('能力边界', formatAgentCapabilityText(details))

  if (typeof details.targetTime === 'string') {
    pushItem('目标时间', deps.formatDisplayTime(details.targetTime))
  }

  pushItem('目标节目', deps.formatProgramLabel(details.matchedItem))
  pushItem('选中节目', deps.formatProgramLabel(details.selectedCandidate))

  if (!details.selectedCandidate && typeof details.selectedCandidateName === 'string') {
    pushItem('选中节目', details.selectedCandidateName)
  }
  pushItem('专业判断', formatEditorialDecisionText(details))
  pushItem('评分维度', formatEditorialDimensionText(details))

  const matchedColumn = deps.resolveMatchedColumnInfo(details)
  pushItem('命中栏目', matchedColumn.columnName)
  pushItem('栏目ID', matchedColumn.columnId)

  const queryCommand = toDetailMap(details.queryCommand)
  const queryCommandData = toDetailMap(queryCommand?.data)
  const targetResolution = toDetailMap(details.targetResolution)
  const criteria = details.criteria ?? queryCommandData?.criteria
  if (criteria && typeof criteria === 'object') {
    pushItem('检索条件', deps.buildQueryCriteriaSummary(criteria as DetailMap).replace(/^查询：/, ''))
  }

  if (typeof details.candidateCount === 'number') {
    pushItem('候选结果', `${details.candidateCount} 个`)
  }

  pushItem('未填充原因', formatCandidateQueryDiagnosticText(details))
  pushItem('检索漏斗', formatCandidateQueryFunnelText(details))

  const candidateStrategy = (() => {
    const candidateOptions = Array.isArray(details.candidateOptions) ? details.candidateOptions : []
    const topCandidates = Array.isArray(details.topCandidates) ? details.topCandidates : []
    const source = details.selectedCandidate ?? candidateOptions[0] ?? topCandidates[0]
    const item = toProgramRecord(source)
    if (!item) return ''
    return formatSelectionModeLabel(typeof item.selectionMode === 'string' ? item.selectionMode : undefined)
  })()
  pushItem('候选策略', candidateStrategy)

  if (typeof details.replacementProgramName === 'string') {
    pushItem('替换目标', details.replacementProgramName)
  }

  const matchedBy = formatMatchedBy(targetResolution?.matchedBy)
  pushItem('定位依据', matchedBy)

  if (typeof targetResolution?.reasoning === 'string') {
    pushItem('定位结论', truncateText(normalizeDecisionExplanation(targetResolution.reasoning) || '', 48))
  }

  if (typeof details.direction === 'string') {
    pushItem('调整方向', details.direction === 'forward' ? '向后' : '向前')
  }

  if (typeof details.offsetSeconds === 'number') {
    pushItem('调整幅度', deps.formatOffset(details.offsetSeconds))
  }

  if (typeof details.newStartTime === 'string') {
    pushItem('新的开始时间', deps.formatDisplayTime(details.newStartTime))
  }

  const validationSummary = details.validationSummary ?? details.summary
  pushItem('校验结果', formatValidationSummaryText(validationSummary))

  if (Array.isArray(details.issues) && details.issues.length > 0) {
    const issueText = (details.issues as Array<{ message?: string }>)
      .slice(0, 3)
      .map((item) => item?.message)
      .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      .join('；')
    pushItem('主要问题', issueText)
  }

  const warnings = extractWarnings(details)
  pushItem('风险提示', warnings.join('；'))

  return items.slice(0, 15)
}
