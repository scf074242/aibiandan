export interface DetailSummaryItem {
  label: string
  value: string
}

export interface ExplanationSection {
  title: string
  body: string
  tone?: 'default' | 'secondary' | 'risk'
}

export interface CandidateComparisonItem {
  id: string
  name: string
  meta: string
  note: string
  selected: boolean
}

export type DetailMap = Record<string, unknown>
export type ProgramRecord = Record<string, unknown>
export type ValidationSummaryRecord = {
  totalIssues?: number
  criticalCount?: number
  warningCount?: number
  infoCount?: number
}
export type PreviewRecord = {
  warnings?: unknown[]
  canExecute?: boolean
}

export const toDetailMap = (value: unknown): DetailMap | undefined =>
  value && typeof value === 'object' ? value as DetailMap : undefined

export const toProgramRecord = (value: unknown): ProgramRecord | undefined =>
  value && typeof value === 'object' ? value as ProgramRecord : undefined

export const toValidationSummaryRecord = (value: unknown): ValidationSummaryRecord | undefined =>
  value && typeof value === 'object' ? value as ValidationSummaryRecord : undefined

export const toPreviewRecord = (value: unknown): PreviewRecord | undefined =>
  value && typeof value === 'object' ? value as PreviewRecord : undefined

export const sanitizeDetails = (
  value: unknown,
  formatDisplayTime: (value: string) => string,
): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeDetails(item, formatDisplayTime))
  }

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    const cloned: Record<string, unknown> = {}

    for (const [key, nestedValue] of Object.entries(record)) {
      if (
        typeof nestedValue === 'string'
        && ['startTime', 'endTime', 'newStartTime', 'targetTime', 'from', 'to'].includes(key)
      ) {
        cloned[key] = formatDisplayTime(nestedValue)
      } else {
        cloned[key] = sanitizeDetails(nestedValue, formatDisplayTime)
      }
    }

    return cloned
  }

  return value
}

export const formatDetails = (
  details: DetailMap,
  formatDisplayTime: (value: string) => string,
): string => JSON.stringify(sanitizeDetails(details, formatDisplayTime), null, 2)

export const normalizeDecisionExplanation = (text?: string): string | undefined => {
  if (!text) return undefined

  return text
    .replace(/\s+/g, ' ')
    .replace(/^我把你的要求理解为/, '已理解为')
    .replace(/^我已根据你确认的目标节目继续/, '已根据你确认的目标继续')
    .replace(/^我已根据你确认的修改目标和风险提示继续执行本次操作。$/, '已根据你的确认结果继续执行本次操作。')
    .replace(/^我已根据你的选择停止/, '已按你的选择停止')
    .replace(/^我已停止这次目标选择，不会继续执行后续修改。$/, '已停止这次目标选择，不会继续执行后续修改。')
    .replace(/^我尝试根据/, '已尝试根据')
    .replace(/^我先按/, '已先按')
    .replace(/^我已根据你选择的目标节目继续完成移动操作。$/, '已根据你确认的目标完成这次移动操作。')
    .trim()
}

export const formatProgramLabel = (
  value: unknown,
  formatDisplayTimeRange: (start: string, end?: string) => string,
): string => {
  if (!value || typeof value !== 'object') return ''
  const item = value as ProgramRecord
  const name = item.programName || item.instanceName || item.programCode || item.id
  if (!name) return ''
  if (typeof item.startTime === 'string') {
    return `${name}（${formatDisplayTimeRange(item.startTime, typeof item.endTime === 'string' ? item.endTime : undefined)}）`
  }
  return String(name)
}

export const formatProgramTypeLabel = (value?: string): string => {
  const mapping: Record<string, string> = {
    news: '新闻',
    news_magazine: '新闻杂志',
    current_affairs: '时政',
    drama: '剧场',
    kids: '少儿',
    health: '健康',
    entertainment: '娱乐',
    commentary: '评论',
    lifestyle: '生活',
    movie: '电影',
  }

  return value ? (mapping[value] ?? value) : ''
}

export const formatCandidateDuration = (duration?: number): string => {
  if (typeof duration !== 'number' || duration <= 0) return ''
  if (duration % 3600 === 0) return `${duration / 3600}小时`
  if (duration % 60 === 0) return `${duration / 60}分钟`
  return `${duration}秒`
}

export const formatSequenceLabel = (candidate: ProgramRecord): string => {
  const sequenceNo = typeof candidate.sequenceNo === 'number'
    ? candidate.sequenceNo
    : typeof candidate.issueNo === 'string' && Number.isFinite(Number(candidate.issueNo))
      ? Number(candidate.issueNo)
      : null
  if (sequenceNo === null) return ''

  if (typeof candidate.programType === 'string' && candidate.programType.includes('drama')) {
    return `第${sequenceNo}集`
  }

  return `第${sequenceNo}期`
}

export const formatSelectionModeLabel = (value?: string): string => {
  if (value === 'sequential') return '顺播推荐'
  if (value === 'rerun') return '重播候选'
  return '匹配候选'
}

export const truncateText = (text: string, maxLength = 42): string => {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, maxLength)}...`
}

export const buildCandidateComparisonNote = (
  candidate: ProgramRecord,
  selected: boolean,
  fallbackSelectionReason: string,
): string => {
  const selectionMode = typeof candidate.selectionMode === 'string' ? candidate.selectionMode : 'default'
  const explicitNote = normalizeDecisionExplanation(
    typeof candidate.selectionNote === 'string' ? candidate.selectionNote : undefined,
  )

  if (selected) {
    return truncateText(explicitNote || fallbackSelectionReason, 40)
  }

  if (explicitNote) {
    return truncateText(explicitNote, 36)
  }

  if (selectionMode === 'sequential') {
    return '按当前已播进度继续顺播，可作为后续候选。'
  }

  if (selectionMode === 'rerun') {
    return '当前栏目不按顺播推进，可作为重播备选。'
  }

  return '可作为备选方案继续比较'
}

export const formatMatchedBy = (value: unknown): string => {
  if (!Array.isArray(value)) return ''
  const labels: Record<string, string> = {
    time_window: '时间窗口',
    name_match: '节目名称',
    llm_nomination: '语义理解',
    local_safety: '本地校验',
  }
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => labels[item] ?? item)
    .join('、')
}

export const formatValidationSummaryText = (value: unknown): string => {
  if (!value || typeof value !== 'object') return ''
  const summary = value as ValidationSummaryRecord
  const total = summary.totalIssues ?? 0
  if (total <= 0) return '未发现明显问题'

  const parts = [`共 ${total} 个问题`]
  if ((summary.criticalCount ?? 0) > 0) {
    parts.push(`严重 ${summary.criticalCount} 个`)
  }
  if ((summary.warningCount ?? 0) > 0) {
    parts.push(`提示 ${summary.warningCount} 个`)
  }
  return parts.join('，')
}

export const formatOffset = (offsetSeconds: number): string => {
  if (offsetSeconds % 3600 === 0) return `${offsetSeconds / 3600}小时`
  if (offsetSeconds % 60 === 0) return `${offsetSeconds / 60}分钟`
  return `${offsetSeconds}秒`
}
