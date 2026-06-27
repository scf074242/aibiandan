import type { ValidationReport, LayoutReference } from '@/types/orchestration'
import type { LLMClient } from '@/services/llm/llmClient'
import { getLLMClient } from '@/services/llm/llmClient'
import type { RuntimeLayoutEntry } from '@/services/orchestration/runtimeLayoutRegistry'
import { getEffectiveColumnDefinition } from '@/services/orchestration/runtimeLayoutRegistry'

import { buildLayoutAnalysisPrompt } from './layoutAnalysisPromptBuilder'

const PROGRAM_TYPE_LABELS: Record<string, string> = {
  news: '新闻',
  news_magazine: '资讯',
  current_affairs: '时政',
  drama: '剧场',
  kids: '少儿',
  health: '健康',
  entertainment: '综艺娱乐',
  commentary: '评论观察',
  lifestyle: '生活服务',
  movie: '电影',
}

const DAYPARTS = [
  { label: '上午', start: '06:00:00', end: '12:00:00' },
  { label: '午间', start: '12:00:00', end: '14:00:00' },
  { label: '下午', start: '14:00:00', end: '18:00:00' },
  { label: '晚间', start: '18:00:00', end: '23:00:00' },
]

const WEB_RESEARCH_PATTERN = /(联网|网络|网上|搜索|检索|查一下|查查|热点|外部信息|结合外部|结合网络|上网)/u
const LOCAL_ONLY_RESEARCH_NOTICE = '你提到希望结合网络或外部信息分析，但当前系统没有提供外部检索材料，本次结论仅基于当前节目单、版面和校验结果。'

export interface LayoutAnalysisScheduleItem {
  id?: string
  programCode?: string
  programName?: string
  startTime: string
  endTime: string
  duration?: number
  programType?: string
}

type LayoutAnalysisSlotStatus = 'aligned' | 'mismatch' | 'empty'

type LayoutAnalysisPromptScheduleItem = LayoutAnalysisScheduleItem & {
  programTypeLabel: string
  matchedLayoutSlots: Array<{
    slotId: string
    timeRange: string
    columnId: string
    columnName: string
    defaultProgramType?: string
  }>
}

type LayoutAnalysisPromptSlot = {
  slotId: string
  startTime: string
  endTime: string
  columnId: string
  columnName: string
  defaultProgramType?: string
  defaultProgramTypeLabel?: string
  isSequential?: boolean
  matchedPrograms: string[]
  status: LayoutAnalysisSlotStatus
}

type LayoutAnalysisFacts = {
  itemCount: number
  slotCount: number
  alignedSlotCount: number
  mismatchSlotCount: number
  emptySlotCount: number
  dominantTypes: string[]
  daypartObservations: string[]
  mismatchSlots: string[]
  emptySlots: string[]
  topValidationIssues: string[]
  suggestedFocus: string[]
}

export interface LayoutAnalysisPromptContext {
  userIntent: string
  analysisModeLabel: string
  requestedWebResearch: boolean
  externalResearchProvided: boolean
  webResearchNotice?: string
  channel: {
    channelId: string
    channelName: string
    date: string
    weekdayLabel: string
    layoutSource: string
  }
  facts: LayoutAnalysisFacts
  schedule: LayoutAnalysisPromptScheduleItem[]
  layout: {
    source: 'uploaded' | 'channel_default' | 'none'
    name: string
    sourceName: string
    slotCount: number
    slots: LayoutAnalysisPromptSlot[]
  }
  validation: {
    summary: ValidationReport['summary']
    issues: Array<{
      severity: string
      message: string
      suggestion?: string
      location?: unknown
    }>
  }
  externalResearch?: Array<{
    title: string
    snippet: string
    url: string
    source: string
    publishDate?: string
  }>
}

export interface LayoutAnalysisRequest {
  channelId: string
  channelName: string
  date: string
  userInput: string
  currentSchedule: LayoutAnalysisScheduleItem[]
  validationReport: ValidationReport
  layoutReference?: LayoutReference | null
  runtimeLayoutEntry?: RuntimeLayoutEntry | null
  externalResearch?: LayoutAnalysisPromptContext['externalResearch']
}

export interface LayoutAnalysisResult {
  content: string
  details: Record<string, unknown>
}

type SlotInsight = {
  slotId: string
  slotLabel: string
  expectedType?: string
  matchedPrograms: string[]
  status: LayoutAnalysisSlotStatus
}

type LayoutAnalysisModeMeta = {
  requestedWebResearch: boolean
  externalResearchProvided: boolean
  webResearchStatus: 'not_requested' | 'provided' | 'unavailable'
  analysisModeLabel: string
  webResearchNotice?: string
}

const normalizeDateTime = (date: string, timeText: string) =>
  timeText.includes('T')
    ? (timeText.includes('+08:00') ? timeText : `${timeText}+08:00`)
    : `${date}T${timeText.length === 5 ? `${timeText}:00` : timeText}+08:00`

const toClockText = (value: string) =>
  value.includes('T') ? (value.split('T')[1]?.slice(0, 8) ?? value) : (value.length === 5 ? `${value}:00` : value)

const formatTimeRange = (startTime: string, endTime: string) => `${toClockText(startTime)}-${toClockText(endTime)}`

const dedupeStrings = (values: string[]) => Array.from(new Set(values.filter(Boolean)))

const formatProgramTypeLabel = (value?: string) => (value ? (PROGRAM_TYPE_LABELS[value] ?? value) : '未标注类型')

const normalizeAnalysisText = (content: string): string =>
  content
    .replace(/```[\w-]*\n?/g, '')
    .replace(/```/g, '')
    .trim()

const detectWebResearchRequest = (input: string) => WEB_RESEARCH_PATTERN.test(input)

const formatWeekday = (date: string) => {
  const day = new Date(`${date}T00:00:00+08:00`).getDay()
  const labels = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
  return labels[day] ?? ''
}

const isItemOverlappingSlot = (
  item: LayoutAnalysisScheduleItem,
  slot: LayoutReference['slots'][number],
  date: string,
) => {
  const itemStart = new Date(normalizeDateTime(date, item.startTime)).getTime()
  const itemEnd = new Date(normalizeDateTime(date, item.endTime)).getTime()
  const slotStart = new Date(slot.startTime).getTime()
  const slotEnd = new Date(slot.endTime).getTime()
  return itemStart < slotEnd && itemEnd > slotStart
}

const buildSlotColumns = (
  layoutReference: LayoutReference | null | undefined,
  runtimeLayoutEntry?: RuntimeLayoutEntry | null,
) => {
  const runtimeColumnMap = new Map(
    (runtimeLayoutEntry?.columns ?? []).map((column) => [column.columnId, column] as const),
  )

  return (layoutReference?.slots ?? []).map((slot) => {
    const column = runtimeColumnMap.get(slot.columnId) ?? getEffectiveColumnDefinition(slot.columnId)
    return {
      slot,
      column,
    }
  })
}

const buildProgramTypeSummary = (schedule: LayoutAnalysisScheduleItem[]) => {
  const counts = new Map<string, number>()
  schedule.forEach((item) => {
    const key = item.programType || 'unknown'
    counts.set(key, (counts.get(key) ?? 0) + 1)
  })
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => ({
      type,
      count,
      label: formatProgramTypeLabel(type),
    }))
}

const buildDaypartObservations = (schedule: LayoutAnalysisScheduleItem[]) =>
  DAYPARTS.map((daypart) => {
    const items = schedule.filter((item) => item.startTime < daypart.end && item.endTime > daypart.start)
    if (items.length === 0) return ''
    const primaryType = buildProgramTypeSummary(items)[0]
    if (!primaryType) return ''
    return `${daypart.label}以${primaryType.label}为主，涉及 ${primaryType.count} 条节目`
  }).filter(Boolean)

const buildSuggestedFocus = (facts: Pick<LayoutAnalysisFacts, 'mismatchSlots' | 'emptySlots' | 'topValidationIssues'>) => {
  const suggestions: string[] = []
  if (facts.mismatchSlots.length > 0) {
    suggestions.push('优先梳理与版面定位不一致的重点时段')
  }
  if (facts.emptySlots.length > 0) {
    suggestions.push('先补足空缺时段，避免版面骨架断裂')
  }
  if (facts.topValidationIssues.length > 0) {
    suggestions.push('同步处理校验暴露出的播出风险')
  }
  suggestions.push('如果方向明确，可继续生成新的版面草案')
  return dedupeStrings(suggestions).slice(0, 4)
}

const buildAnalysisModeMeta = (request: Pick<LayoutAnalysisRequest, 'userInput' | 'externalResearch'>): LayoutAnalysisModeMeta => {
  const requestedWebResearch = detectWebResearchRequest(request.userInput)
  const externalResearchProvided = Array.isArray(request.externalResearch) && request.externalResearch.length > 0

  if (!requestedWebResearch) {
    return {
      requestedWebResearch: false,
      externalResearchProvided,
      webResearchStatus: externalResearchProvided ? 'provided' : 'not_requested',
      analysisModeLabel: externalResearchProvided ? '基于本地节目单、版面、校验结果，并结合外部补充材料分析。' : '基于本地节目单、版面和校验结果分析。',
    }
  }

  if (externalResearchProvided) {
    return {
      requestedWebResearch: true,
      externalResearchProvided: true,
      webResearchStatus: 'provided',
      analysisModeLabel: '用户希望结合外部信息，当前已提供外部补充材料，可在本地数据基础上综合分析。',
    }
  }

  return {
    requestedWebResearch: true,
    externalResearchProvided: false,
    webResearchStatus: 'unavailable',
    analysisModeLabel: '用户希望结合外部信息，但当前未提供外部检索材料，本次必须明确说明仍基于本地数据分析。',
    webResearchNotice: LOCAL_ONLY_RESEARCH_NOTICE,
  }
}

const resolveSlotStatus = (
  overlappingItems: LayoutAnalysisScheduleItem[],
  expectedType?: string,
): LayoutAnalysisSlotStatus => {
  if (overlappingItems.length === 0) return 'empty'
  if (!expectedType) return 'aligned'

  const matchedCount = overlappingItems.filter((item) => item.programType === expectedType).length
  return matchedCount === overlappingItems.length ? 'aligned' : 'mismatch'
}

const buildStrengths = (
  facts: LayoutAnalysisFacts,
  validationSummary: ValidationReport['summary'],
): string[] => {
  const strengths: string[] = []

  if (facts.alignedSlotCount > 0 && facts.slotCount > 0) {
    strengths.push(`已有 ${facts.alignedSlotCount}/${facts.slotCount} 个版面时段与预期栏目定位保持一致`)
  }
  if (facts.dominantTypes.length > 0) {
    strengths.push(`当前内容主线相对清晰，主要由 ${facts.dominantTypes.slice(0, 2).join('、')} 构成`)
  }
  if (validationSummary.totalIssues === 0) {
    strengths.push('校验侧暂未发现明显硬风险')
  } else if (validationSummary.criticalCount === 0) {
    strengths.push('当前校验问题以一般提醒为主，暂未出现严重播出风险')
  }

  return strengths.slice(0, 3)
}

const withResearchNotice = (content: string, notice?: string): string => {
  const normalized = content.trim()
  if (!notice) return normalized
  if (normalized.includes(notice) || normalized.includes('说明：')) {
    return normalized
  }
  return `说明：${notice}\n\n${normalized}`.trim()
}

const buildAnalysisDetails = (
  context: LayoutAnalysisPromptContext,
  analysisSource: string,
): Record<string, unknown> => ({
  summaryKind: 'layout_analysis',
  itemCount: context.facts.itemCount,
  slotCount: context.facts.slotCount,
  alignedSlotCount: context.facts.alignedSlotCount,
  mismatchSlotCount: context.facts.mismatchSlotCount,
  emptySlotCount: context.facts.emptySlotCount,
  validationSummary: context.validation.summary,
  dominantTypes: context.facts.dominantTypes,
  daypartObservations: context.facts.daypartObservations,
  strengths: buildStrengths(context.facts, context.validation.summary),
  issues: [...context.facts.mismatchSlots, ...context.facts.topValidationIssues].slice(0, 6),
  suggestions: context.facts.suggestedFocus,
  nextStep: '如果愿意，可以继续优化并生成新的版面草案。',
  analysisSource,
  requestedWebResearch: context.requestedWebResearch,
  externalResearchProvided: context.externalResearchProvided,
  webResearchStatus: context.requestedWebResearch
    ? (context.externalResearchProvided ? 'provided' : 'unavailable')
    : 'not_requested',
  webResearchNotice: context.webResearchNotice,
})

const buildPromptContext = (request: LayoutAnalysisRequest): LayoutAnalysisPromptContext => {
  const sortedSchedule = [...request.currentSchedule].sort((a, b) => a.startTime.localeCompare(b.startTime))
  const slotColumns = buildSlotColumns(request.layoutReference, request.runtimeLayoutEntry)
  const modeMeta = buildAnalysisModeMeta(request)

  const slotInsights: SlotInsight[] = slotColumns.map(({ slot, column }) => {
    const overlappingItems = sortedSchedule.filter((item) => isItemOverlappingSlot(item, slot, request.date))
    return {
      slotId: slot.id,
      slotLabel: column?.columnName ?? slot.id,
      expectedType: column?.defaultProgramType,
      matchedPrograms: overlappingItems.map((item) => item.programName || item.programCode || item.id || '未命名节目'),
      status: resolveSlotStatus(overlappingItems, column?.defaultProgramType),
    }
  })

  const scheduleForPrompt: LayoutAnalysisPromptScheduleItem[] = sortedSchedule.map((item) => {
    const matchedLayoutSlots = slotColumns
      .filter(({ slot }) => isItemOverlappingSlot(item, slot, request.date))
      .map(({ slot, column }) => ({
        slotId: slot.id,
        timeRange: formatTimeRange(slot.startTime, slot.endTime),
        columnId: slot.columnId,
        columnName: column?.columnName ?? slot.columnId,
        defaultProgramType: column?.defaultProgramType,
      }))

    return {
      ...item,
      programTypeLabel: formatProgramTypeLabel(item.programType),
      matchedLayoutSlots,
    }
  })

  const layoutSlotsForPrompt: LayoutAnalysisPromptSlot[] = slotColumns.map(({ slot, column }) => {
    const insight = slotInsights.find((item) => item.slotId === slot.id)
    return {
      slotId: slot.id,
      startTime: toClockText(slot.startTime),
      endTime: toClockText(slot.endTime),
      columnId: slot.columnId,
      columnName: column?.columnName ?? slot.columnId,
      defaultProgramType: column?.defaultProgramType,
      defaultProgramTypeLabel: formatProgramTypeLabel(column?.defaultProgramType),
      isSequential: column?.isSequential,
      matchedPrograms: insight?.matchedPrograms ?? [],
      status: insight?.status ?? 'empty',
    }
  })

  const typeSummary = buildProgramTypeSummary(sortedSchedule)
  const mismatchSlots = slotInsights
    .filter((item) => item.status === 'mismatch')
    .map((item) => `${item.slotLabel}（预期${formatProgramTypeLabel(item.expectedType)}）`)
  const emptySlots = slotInsights
    .filter((item) => item.status === 'empty')
    .map((item) => item.slotLabel)
  const topValidationIssues = request.validationReport.issues
    .slice(0, 6)
    .map((issue) => issue.message)

  const facts: LayoutAnalysisFacts = {
    itemCount: sortedSchedule.length,
    slotCount: slotInsights.length,
    alignedSlotCount: slotInsights.filter((item) => item.status === 'aligned').length,
    mismatchSlotCount: mismatchSlots.length,
    emptySlotCount: emptySlots.length,
    dominantTypes: typeSummary.slice(0, 5).map((item) => `${item.label}${item.count}条`),
    daypartObservations: buildDaypartObservations(sortedSchedule),
    mismatchSlots: mismatchSlots.slice(0, 6),
    emptySlots: emptySlots.slice(0, 6),
    topValidationIssues,
    suggestedFocus: buildSuggestedFocus({
      mismatchSlots,
      emptySlots,
      topValidationIssues,
    }),
  }

  const layoutSource = request.runtimeLayoutEntry
    ? 'uploaded'
    : request.layoutReference
      ? 'channel_default'
      : 'none'
  const layoutName = request.runtimeLayoutEntry?.sourceFileName
    ?? request.layoutReference?.name
    ?? '未提供版面参考'
  const layoutSourceName = request.runtimeLayoutEntry?.sourceFileName
    ?? (request.layoutReference ? `当前频道默认版面（${request.layoutReference.name}）` : '未提供版面参考')

  return {
    userIntent: request.userInput,
    analysisModeLabel: modeMeta.analysisModeLabel,
    requestedWebResearch: modeMeta.requestedWebResearch,
    externalResearchProvided: modeMeta.externalResearchProvided,
    webResearchNotice: modeMeta.webResearchNotice,
    channel: {
      channelId: request.channelId,
      channelName: request.channelName,
      date: request.date,
      weekdayLabel: formatWeekday(request.date),
      layoutSource: layoutSourceName,
    },
    facts,
    schedule: scheduleForPrompt,
    layout: {
      source: layoutSource,
      name: layoutName,
      sourceName: layoutSourceName,
      slotCount: layoutSlotsForPrompt.length,
      slots: layoutSlotsForPrompt,
    },
    validation: {
      summary: request.validationReport.summary,
      issues: request.validationReport.issues.map((issue) => ({
        severity: issue.severity,
        message: issue.message,
        suggestion: issue.suggestion,
        location: issue.location,
      })),
    },
    externalResearch: request.externalResearch,
  }
}

const buildFallbackAnalysisText = (context: LayoutAnalysisPromptContext): string => {
  const { facts, validation, channel } = context
  const overview = `已从广电节目编辑视角完成当前版面编排分析。${channel.channelName}${channel.date}${channel.weekdayLabel ? `（${channel.weekdayLabel}）` : ''} 当前节目单共 ${facts.itemCount} 条，版面时段命中 ${facts.alignedSlotCount}/${facts.slotCount} 个。`
  const observation = [
    facts.daypartObservations.length > 0 ? `从时段节奏看，${facts.daypartObservations.join('；')}。` : '',
    facts.dominantTypes.length > 0 ? `从内容结构看，当前主要由 ${facts.dominantTypes.slice(0, 3).join('、')} 构成。` : '',
  ].filter(Boolean).join('')
  const risk = [
    facts.mismatchSlots.length > 0 ? `需要优先关注的偏差时段包括：${facts.mismatchSlots.slice(0, 3).join('；')}。` : '',
    facts.emptySlots.length > 0 ? `当前仍有空缺时段：${facts.emptySlots.slice(0, 3).join('；')}。` : '',
    validation.summary.totalIssues > 0 ? `校验侧共发现 ${validation.summary.totalIssues} 个问题，其中严重 ${validation.summary.criticalCount} 个。` : '当前校验未发现明显硬风险。',
  ].filter(Boolean).join('')
  const suggestion = '建议下一步优先修复骨架断裂和关键偏差时段；如果你愿意，我可以继续基于这份分析优化当前版面，并生成新的版面草案。'

  const content = [
    overview,
    observation || '当前节奏与内容层次信息较少，建议结合更多已排时段继续观察。',
    `${risk}${suggestion}`,
  ].join('\n\n')

  return withResearchNotice(content, context.webResearchNotice)
}

export class LayoutAnalysisService {
  constructor(
    private readonly llmClient: Pick<LLMClient, 'chat'> = getLLMClient(),
  ) {}

  async analyze(request: LayoutAnalysisRequest): Promise<LayoutAnalysisResult> {
    const modeMeta = buildAnalysisModeMeta(request)
    if (request.currentSchedule.length === 0) {
      return {
        content: withResearchNotice(
          [
            '当前节目单还没有实际编排内容，暂时无法从节目编辑视角分析现状。',
            '如果你愿意，我可以先为你生成一份新的版面草案，再继续后续编排流程。',
          ].join('\n\n'),
          modeMeta.webResearchNotice,
        ),
        details: {
          summaryKind: 'layout_analysis',
          itemCount: 0,
          slotCount: request.layoutReference?.slots.length ?? 0,
          alignedSlotCount: 0,
          mismatchSlotCount: 0,
          emptySlotCount: request.layoutReference?.slots.length ?? 0,
          validationSummary: request.validationReport.summary,
          suggestions: ['如需继续，我可以先生成新的版面草案，再按既有流程进入后续编排。'],
          nextStep: '如需继续，我可以先生成新的版面草案，再按既有流程进入后续编排。',
          analysisSource: 'empty_schedule',
          requestedWebResearch: modeMeta.requestedWebResearch,
          externalResearchProvided: modeMeta.externalResearchProvided,
          webResearchStatus: modeMeta.webResearchStatus,
          webResearchNotice: modeMeta.webResearchNotice,
        },
      }
    }

    const context = buildPromptContext(request)
    try {
      const response = await this.llmClient.chat(buildLayoutAnalysisPrompt(context), {
        temperature: 0.5,
        maxTokens: 1800,
      })
      const normalized = normalizeAnalysisText(response.content)
      if (normalized) {
        return {
          content: withResearchNotice(normalized, context.webResearchNotice),
          details: buildAnalysisDetails(
            context,
            context.requestedWebResearch && !context.externalResearchProvided ? 'llm_local_only' : 'llm',
          ),
        }
      }
    } catch (error) {
      console.warn('Layout analysis LLM generation failed, using fallback:', error)
    }

  return {
      content: buildFallbackAnalysisText(context),
      details: buildAnalysisDetails(
        context,
        context.requestedWebResearch && !context.externalResearchProvided ? 'fallback_local_only' : 'fallback',
      ),
    }
  }
}

let globalLayoutAnalysisService: LayoutAnalysisService | null = null

export function getLayoutAnalysisService(llmClient?: Pick<LLMClient, 'chat'>): LayoutAnalysisService {
  if (!globalLayoutAnalysisService) {
    globalLayoutAnalysisService = new LayoutAnalysisService(llmClient ?? getLLMClient())
  }
  return globalLayoutAnalysisService
}

export function resetLayoutAnalysisService(): void {
  globalLayoutAnalysisService = null
}
