import type { ChatMessage } from '@/types/llm'
import type { GapInfo, ProgramCandidate, ScheduleItemSnapshot } from '@/types/orchestration'
import type { GapPlanningThought } from './orchestrationStrategyService'
import type { DialogueContext } from './dialogueContext'
import type { InsertParams } from './paramExtractor'

/**
 * orchestration prompt 版本号（对齐 AGENTS.md Prompt 版本管理门禁）
 * - v1.0：初始版本，顺播规则引用标准文案核心点
 *
 * 本文件三个 build 函数只返回 ChatMessage[]，不直接调用 LLM；
 * 调用方需 import 本常量并透传到 llmClient.chat 的 promptVersion 字段。
 */
export const ORCHESTRATION_PROMPT_BUILDER_VERSION = 'v1.0' as const

export interface QueryIntentPromptInput {
  channelName: string
  channelId: string
  date: string
  gap: GapInfo
  planningThought: GapPlanningThought
  userIntent?: string
}

export interface GapCandidateSelectionPromptInput {
  channelName: string
  date: string
  gap: GapInfo
  planningThought?: GapPlanningThought
  candidates: ProgramCandidate[]
  existingItems?: ScheduleItemSnapshot[]
}

export function buildQueryIntentPrompt(input: QueryIntentPromptInput): ChatMessage[] {
  return [
    {
        role: 'system',
        content:
        `[prompt ${ORCHESTRATION_PROMPT_BUILDER_VERSION}] 你是电视节目编排查询参数生成器。请根据空窗和编排想法，只输出候选查询条件所需的 JSON，不要输出额外说明。`,
      },
    {
      role: 'user',
      content:
        `频道：${input.channelName}（${input.channelId}）\n` +
        `日期：${input.date}\n` +
        `空窗：${input.gap.startTime} - ${input.gap.endTime}\n` +
        `编排想法：${input.planningThought.summary}\n` +
        `目标栏目：${input.planningThought.targetSlotLabel ?? '未指定'}\n` +
        `类型偏好：${(input.planningThought.targetProgramTypes ?? []).join(', ') || '无'}\n` +
        `时长偏好：${input.planningThought.durationPreference.min}-${input.planningThought.durationPreference.max} 秒\n` +
        `${input.userIntent ? `用户补充要求：${input.userIntent}\n` : ''}` +
        '请只输出 criteria JSON，例如：' +
        '{"targetTimeRange":{"start":"...","end":"..."},"expectedDuration":{"min":1200,"max":3600},"channelId":"dragon","columnId":"101","programTypePreference":["news"],"excludeUsed":true}',
    },
  ]
}

export function buildGapCandidateSelectionPrompt(
  input: GapCandidateSelectionPromptInput,
): ChatMessage[] {
  const primary = input.planningThought?.selectionPolicy?.primary ?? 'default'
  const fallback = input.planningThought?.selectionPolicy?.fallback?.join(' > ') || '无'
  const strategyGuide = formatStrategyGuide(primary)
  const currentSchedule = formatExistingItems(input.existingItems ?? [])
  const candidateList = input.candidates
    .map((candidate, index) => formatCandidate(candidate, index, input.existingItems ?? []))
    .join('\n')

  return [
    {
      role: 'system',
      content:
        `[prompt ${ORCHESTRATION_PROMPT_BUILDER_VERSION}] 你是一名经验丰富的电视节目编排人员。请模拟资深编排的判断过程，只从给定候选里选择一个最适合当前空窗的节目实例，并只输出 JSON。若候选不满足硬性意图、会造成时间重叠、顺播倒序、跳集或重复集数，请返回 none 或 clarify。顺播期数选择是候选决策最高优先级硬规则：有基线选期望下一集，无基线选最早一期，同一期多版本返回 clarify；不能跳集、倒序、重复。`,
    },
    {
      role: 'user',
      content:
        `频道：${input.channelName}\n` +
        `日期：${input.date}\n` +
        `空窗：${input.gap.startTime} - ${input.gap.endTime}\n` +
        `${input.planningThought ? `编排想法：${input.planningThought.summary}\n` : ''}` +
        `目标栏目：${input.planningThought?.targetSlotLabel ?? '未指定'}\n` +
        `关键词：${input.planningThought?.searchKeywords.join('、') || '无'}\n` +
        `策略：主优先=${primary}; fallback=${fallback}; requiresPreviousSchedule=${Boolean(input.planningThought?.selectionPolicy?.requiresPreviousSchedule)}\n` +
        `策略判断口径：${strategyGuide}\n` +
        `当前已排节目：\n${currentSchedule}\n` +
        '顺播硬规则：有基线选期望下一集，无基线选最早一期，不能跳集、倒序、重复。\n' +
        '上下文规则：9 点已有第1集时，不应回填 8 点第2集；节目编号前缀、去掉集数后的节目名称、所属栏目相同只是判断上下节目的经验线索，不是绝对规则，必须综合标题、栏目、历史进度、当前节目单和播出风险判断。\n' +
        `候选列表：\n${candidateList}\n` +
        '请输出 JSON，例如：{"decision":"select","selectedCandidateId":"...","confidence":0.9,"reasoning":"...","matchedRequirements":["..."],"missingRequirements":[],"riskFlags":[]}',
    },
  ]
}

function formatStrategyGuide(primary: string): string {
  if (primary === 'sequence') {
    return '电视频道顺播优先读取历史和当前编排上下文，按同系列下一集/期选择，避免跳集、倒序和回填后续集；无基线时选最早一期。'
  }
  if (primary === 'rating') {
    return '收视率优先只以候选的 estimatedRating 等统计数据为主要取舍依据，但仍必须先满足硬关键词、时长和上下文约束。'
  }
  if (primary === 'trending') {
    return '热播优先模拟当前时间点的舆论和话题热度判断，以 popularityScore、话题标签和节目内容热度证据为主要取舍依据，但仍必须先满足硬关键词、时长和上下文约束。'
  }
  if (primary === 'content_match') {
    return '内容匹配优先先看节目标题、所属栏目、节目内容和内容标签是否贴合用户意图，收视率或热度只作同等匹配下的兜底。'
  }
  return '综合判断时先满足硬约束，再在内容匹配、时长、类型、收视率、热播热度和当前节目单上下文之间平衡。'
}

export function buildInsertCandidateSelectionPrompt(
  context: DialogueContext,
  params: InsertParams,
  candidates: ProgramCandidate[],
): ChatMessage[] {
  const targetProgramText = params.programName ?? params.rawProgramText ?? params.semanticLabel ?? '未明确节目名'
  const insertDecisionRules =
    '插入编排判断规则：顺播期数选择是最高优先级硬规则——有基线选期望下一集，无基线选最早一期；明确节目名、主题、栏目、地点、集数/期数或功能要求未命中时返回 none；候选接近但可能造成时间重叠、顺播倒序、跳集、重复集数或播出上下文风险时返回 clarify；节目编号前缀、去掉集数后的节目名称、所属栏目相同只是经验线索，不是绝对规则，必须综合标题、栏目、当前进度和播出风险判断。'
  const insertScheduleContext = [
    context.scheduleSummary,
    `目标时间附近节目：${context.nearbyScheduleSummary}`,
    `当前节目名候选：${context.scheduleNameCandidates}`,
  ].join('\n')
  const candidateList = candidates
    .map((candidate, index) => formatCandidate(candidate, index, context.currentSchedule as ScheduleItemSnapshot[]))
    .join('\n')

  return [
    {
      role: 'system',
      content:
        `[prompt ${ORCHESTRATION_PROMPT_BUILDER_VERSION}] 你是电视节目插入候选选择器。请按经验丰富的编排人员方式判断候选是否真的适合插入，只输出 JSON。硬性节目名或上下文不匹配时返回 none，存在顺播风险时返回 clarify。顺播硬规则优先于时长考量。`,
    },
    {
      role: 'user',
      content:
        `频道：${context.scheduleState.channelName}\n` +
        `日期：${context.scheduleState.date}\n` +
        `插入时间：${params.targetTime}\n` +
        `目标节目名：${targetProgramText}\n` +
        `当前编单摘要：${insertScheduleContext}\n` +
        `候选列表：\n${candidateList}\n` +
        `${insertDecisionRules}\n` +
        '请输出 JSON，例如：{"decision":"select","selectedCandidateId":"...","confidence":0.9,"reasoning":"...","matchedRequirements":["..."],"missingRequirements":[],"riskFlags":[]}; 或 {"decision":"none","selectedCandidateId":null,"confidence":0.9,"reasoning":"候选均不满足明确节目名"}',
    },
  ]
}

function formatCandidate(
  candidate: ProgramCandidate,
  index: number,
  existingItems: ScheduleItemSnapshot[],
): string {
  const editorial = candidate.editorialDecision
  const dimensions = editorial?.dimensions
    .map((dimension) => `${dimension.key}:${dimension.score}/w${dimension.weight}`)
    .join('|')
  const evidence = buildSeriesEvidence(candidate, existingItems)
  const tags = candidate.contentTags?.join('|') || '无'

  return [
    `${index + 1}. id=${candidate.id}`,
    `name=${candidate.programName}`,
    `code=${candidate.programCode}`,
    `type=${candidate.programType}`,
    `column=${candidate.columnName ?? '无'}`,
    `tags=${tags}`,
    `duration=${candidate.duration}`,
    typeof candidate.estimatedRating === 'number' ? `estimatedRating=${candidate.estimatedRating}` : undefined,
    typeof candidate.playCount === 'number' ? `playCount=${candidate.playCount}` : undefined,
    typeof candidate.popularityScore === 'number' ? `popularityScore=${candidate.popularityScore}` : undefined,
    `instance=${candidate.instanceName}`,
    editorial ? `editorialStrategy=${editorial.strategy}` : undefined,
    editorial ? `editorialScore=${editorial.totalScore}` : undefined,
    dimensions ? `editorialDimensions=${dimensions}` : undefined,
    evidence,
  ]
    .filter((part): part is string => Boolean(part))
    .join('; ')
}

function formatExistingItems(items: ScheduleItemSnapshot[]): string {
  if (!items.length) return '当前已排节目为空'

  return items
    .slice(0, 12)
    .map((item, index) => {
      const sequence = readSequence(item)
      return `${index + 1}. ${toClock(item.startTime)}-${toClock(item.endTime)} ${item.programName}; code=${item.programCode}; type=${item.programType}; existingSequence=${sequence ?? 'unknown'}`
    })
    .join('\n')
}

function buildSeriesEvidence(
  candidate: ProgramCandidate,
  existingItems: ScheduleItemSnapshot[],
): string | undefined {
  const candidateSeriesKey = normalizeSeriesName(candidate.programName)
  const candidateCodePrefix = getProgramCodePrefix(candidate.programCode)
  const candidateSequence = readSequence(candidate)
  const related = existingItems.find((item) => {
    const sameName = normalizeSeriesName(item.programName) === candidateSeriesKey
    const sameCodePrefix = getProgramCodePrefix(item.programCode) === candidateCodePrefix
    const sameColumn = Boolean(candidate.columnName && item.programName.includes(candidate.columnName))
    return sameName || sameCodePrefix || sameColumn
  })

  if (!related) return undefined

  const existingSequence = readSequence(related)
  return [
    'seriesEvidence=possible_same_series(name_without_episode+program_code_prefix)',
    `candidateSequence=${candidateSequence ?? 'unknown'}`,
    `existingSequence=${existingSequence ?? 'unknown'}`,
    `relatedExisting=${toClock(related.startTime)} ${related.programName}`,
  ].join('; ')
}

function readSequence(item: Pick<ProgramCandidate, 'programName' | 'programCode'> | ScheduleItemSnapshot): number | null {
  const explicit = 'sequence' in item ? item.sequence : undefined
  if (typeof explicit === 'number' && Number.isFinite(explicit)) return explicit

  const episodeMatch = item.programName.match(/第\s*([一二三四五六七八九十百\d]+)\s*[集期]/u)
  if (episodeMatch?.[1]) {
    const parsed = parseChineseNumber(episodeMatch[1])
    if (parsed !== null) return parsed
  }

  const codeMatch = item.programCode.match(/(\d{1,4})$/)
  if (!codeMatch?.[1]) return null
  const parsedCode = Number(codeMatch[1])
  return Number.isFinite(parsedCode) && parsedCode > 0 ? parsedCode : null
}

function parseChineseNumber(value: string): number | null {
  if (/^\d+$/.test(value)) return Number(value)
  const digits: Record<string, number> = {
    一: 1,
    二: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
    零: 0,
  }
  if (value === '十') return 10
  const tenIndex = value.indexOf('十')
  if (tenIndex >= 0) {
    const high = tenIndex === 0 ? 1 : digits[value[tenIndex - 1]!] ?? 0
    const low = digits[value[tenIndex + 1]!] ?? 0
    return high * 10 + low
  }
  const parsed = value.split('').reduce((sum, char) => sum * 10 + (digits[char] ?? 0), 0)
  return parsed > 0 ? parsed : null
}

function normalizeSeriesName(programName: string): string {
  return programName
    .replace(/第\s*[一二三四五六七八九十百\d]+\s*[集期]/gu, '')
    .replace(/\s+/g, '')
    .trim()
}

function getProgramCodePrefix(programCode: string): string {
  return programCode.replace(/\d{1,4}$/, '')
}

function toClock(value: string): string {
  return value.includes('T') ? value.split('T')[1]?.slice(0, 8) ?? value : value
}
