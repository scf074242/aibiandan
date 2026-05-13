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

const isNoCandidateCase = (details: DetailMap) => details.error === 'No candidates found'

export const extractWarnings = (details?: DetailMap): string[] => {
  if (!details) return []
  const warnings: string[] = []
  const preview = toPreviewRecord(details.preview)
  const previewWarnings = Array.isArray(preview?.warnings)
    ? preview.warnings.filter((item): item is string => typeof item === 'string')
    : []
  warnings.push(...previewWarnings)

  if (preview?.canExecute === false) {
    warnings.push('预演显示当前方案会与现有编排冲突')
  }

  if (isNoCandidateCase(details)) {
    warnings.push('当前条件下没有命中可直接使用的候选节目')
  }

  if (typeof details.error === 'string' && details.error !== 'No candidates found') {
    warnings.push(details.error)
  }

  const validationSummary = toValidationSummaryRecord(details.validationSummary ?? details.summary)
  const totalIssues = validationSummary?.totalIssues ?? 0
  if (totalIssues > 0) {
    warnings.push(`校验仍发现 ${totalIssues} 个问题`)
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
    pushItem('校验结果', formatValidationSummaryText(details.validationSummary))
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

  if (typeof details.targetTime === 'string') {
    pushItem('目标时间', deps.formatDisplayTime(details.targetTime))
  }

  pushItem('目标节目', deps.formatProgramLabel(details.matchedItem))
  pushItem('选中节目', deps.formatProgramLabel(details.selectedCandidate))

  if (!details.selectedCandidate && typeof details.selectedCandidateName === 'string') {
    pushItem('选中节目', details.selectedCandidateName)
  }

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

  return items.slice(0, 6)
}
