import type { ChatMessage } from '@/types/llm'
import type { LayoutDraft, LayoutDraftSpec, LayoutDraftSpecSegment, LayoutIntentSegment, PlaylistType } from '@/types/orchestration'
import type { LLMClient } from '@/services/llm/llmClient'
import { cleanLayoutDraftActionNoise, cleanLayoutDraftSemanticLabel } from '@/services/layoutDraftSemanticCleaner'
import { createRecoverableLlmError } from '@/services/llm/llmFailure'

export interface LayoutDraftGenerationInput {
  channelId: string
  channelName: string
  date: string
  userInput: string
  playlistType?: PlaylistType
  targetDurationSeconds?: number
  coverage?: { start: string; end: string }
  semanticLabel?: string
  programTypeHint?: string
  segments?: LayoutIntentSegment[]
}

export interface LayoutDraftRefineInput extends LayoutDraftGenerationInput {
  currentDraft: LayoutDraft
}

const DEFAULT_COVERAGE = {
  start: '06:00:00',
  end: '23:59:59',
}

const MAX_RELATIVE_COVERAGE_SECONDS = 24 * 60 * 60 - 1

const secondsToRelativeClock = (value: number): string => {
  const bounded = Math.max(1, Math.min(MAX_RELATIVE_COVERAGE_SECONDS, Math.floor(value)))
  const hours = Math.floor(bounded / 3600)
  const minutes = Math.floor((bounded % 3600) / 60)
  const seconds = bounded % 60
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
}

const resolveInputCoverage = (input: LayoutDraftGenerationInput): { start: string; end: string } => {
  if (input.coverage) return input.coverage
  if (input.playlistType === 'rotation' && input.targetDurationSeconds && input.targetDurationSeconds > 0) {
    return { start: '00:00:00', end: secondsToRelativeClock(input.targetDurationSeconds) }
  }
  return { ...DEFAULT_COVERAGE }
}

type ProgramTypeGuess = Pick<LayoutDraftSpecSegment, 'label' | 'programType' | 'queryHints' | 'sequential'>

const normalizeInput = (value: string) => value.trim().toLowerCase().replace(/\s+/g, '')

const shouldSurfaceDraftLlmFailure = (input: string): boolean => {
  const normalized = normalizeInput(input)
  return /(?:第[一二三四五六七八九十\d]+个?小时|第[一二三四五六七八九十\d]+段|第一小时|第二小时|第三小时|每条|每段|拆成|拆分|分成|策划|规划|不知道怎么排|怎么排|帮我排|帮我规划|优化一下)/u.test(normalized)
}

const DEFAULT_LABEL_BY_PROGRAM_TYPE: Record<string, string> = {
  drama: '电视剧',
  news: '新闻',
  news_magazine: '资讯',
  commentary: '评论',
  health: '健康',
  entertainment: '综艺',
  kids: '少儿',
  documentary: '纪录片',
}

const normalizeClock = (clock: string) => {
  const parts = clock.split(':')
  const hour = Math.max(0, Math.min(23, Number(parts[0] ?? '0')))
  const minute = Math.max(0, Math.min(59, Number(parts[1] ?? '00')))
  const second = Math.max(0, Math.min(59, Number(parts[2] ?? '00')))
  return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}:${second.toString().padStart(2, '0')}`
}

const toSlotClock = (value: string | undefined, fallback: string) => {
  if (!value) return normalizeClock(fallback)
  const clockText = value.includes('T') ? value.split('T')[1]?.slice(0, 8) : value
  return normalizeClock(clockText ?? fallback)
}

const hasDramaEpisodeCue = (value: string): boolean =>
  /第\s*[0-9零〇一二两三四五六七八九十百]+\s*集/u.test(value)

const extractFreeformLayoutLabel = (input: string): string | null => {
  const normalized = input
    .replace(/^(?:不参考当前版面参考|不要参考当前版面参考|不参考当前版面|不要参考当前版面|忽略当前版面参考)[,，、]*/u, '')
    .trim()
  const actionCleaned = cleanLayoutDraftActionNoise(normalized, { stripLeadingPoliteCue: true })
  const verbMatch = actionCleaned.match(/(?:排入|编入|改成|换成|替换成|替换为|调整为|改为|统一成|变成|安排|编排|排|继续播|接着播|续播|顺播)(.+)$/u)
  if (!verbMatch && !/(电视剧|剧场|新闻|资讯|评论|健康|娱乐|综艺|少儿|纪录|电影|栏目)/u.test(normalized)) {
    return null
  }
  const rawLabel = verbMatch?.[1] ?? actionCleaned
  const cleaned = cleanLayoutDraftSemanticLabel(rawLabel, { stripLeadingPoliteCue: true })
  return cleaned || null
}

const buildGuessFromFreeformLabel = (label: string): ProgramTypeGuess => {
  const normalized = label.trim()
  const lowered = normalized.toLowerCase()
  const withHints = (...hints: string[]) => Array.from(new Set([normalized, ...hints].filter(Boolean)))

  if (/(剧场|电视剧|影视|微短剧|连续剧)/u.test(normalized) || hasDramaEpisodeCue(normalized)) {
    return {
      label: normalized,
      programType: 'drama',
      queryHints: withHints('剧场', '电视剧'),
      sequential: true,
    }
  }
  if (/(新闻|播报|快报)/u.test(normalized)) {
    return {
      label: normalized,
      programType: 'news',
      queryHints: withHints('新闻'),
    }
  }
  if (/(资讯|栏目|专题)/u.test(normalized)) {
    return {
      label: normalized,
      programType: 'news_magazine',
      queryHints: withHints('资讯'),
    }
  }
  if (/(评论|观察|访谈|民生)/u.test(normalized)) {
    return {
      label: normalized,
      programType: 'commentary',
      queryHints: withHints('评论', '观察'),
    }
  }
  if (/(健康|养生|医疗)/u.test(normalized)) {
    return {
      label: normalized,
      programType: 'health',
      queryHints: withHints('健康', '养生'),
    }
  }
  if (/(娱乐|综艺|晚会)/u.test(normalized)) {
    return {
      label: normalized,
      programType: 'entertainment',
      queryHints: withHints('娱乐', '综艺'),
    }
  }
  if (/(少儿|儿童|动画)/u.test(normalized)) {
    return {
      label: normalized,
      programType: 'kids',
      queryHints: withHints('少儿', '动画'),
    }
  }
  if (/(纪录|纪实)/u.test(normalized)) {
    return {
      label: normalized,
      programType: 'documentary',
      queryHints: withHints('纪录片', '纪实'),
    }
  }

  return {
    label: normalized,
    programType: lowered.includes('电影') ? 'entertainment' : 'news_magazine',
    queryHints: withHints(),
  }
}

const buildGuessFromStructuredIntent = (
  semanticLabel?: string,
  programTypeHint?: string,
): ProgramTypeGuess | null => {
  const label = cleanLayoutDraftSemanticLabel(semanticLabel, { stripLeadingPoliteCue: true })
  if (!label && !programTypeHint) {
    return null
  }

  const resolvedLabel = label || (programTypeHint ? DEFAULT_LABEL_BY_PROGRAM_TYPE[programTypeHint] : undefined) || '自定义版面'
  const queryHints = buildStructuredQueryHints(resolvedLabel, programTypeHint)

  return {
    label: resolvedLabel,
    programType: normalizeStructuredProgramType(resolvedLabel, programTypeHint),
    queryHints,
    sequential: programTypeHint === 'drama' || /剧场|电视剧|连续剧/u.test(resolvedLabel) || hasDramaEpisodeCue(resolvedLabel),
  }
}

const cleanEditorialHintValue = (value: string): string => {
  let cleaned = value
    .replace(/^[:：，,、\s]+/u, '')
    .replace(/[。；;，,、\s]+$/u, '')
    .replace(/^(?:为|是|叫|名为|名称为)+/u, '')
    .trim()

  for (let index = 0; index < 3; index += 1) {
    cleaned = cleaned
      .replace(/(?:内容匹配优先|匹配优先|收视率优先|收视优先|高收视率|优先选择.*)$/u, '')
      .replace(/(?:的)?(?:轮播单|直播单|播单|节目单|编排单|串联单|版面|草案|节目|内容)$/u, '')
      .replace(/[。；;，,、\s]+$/u, '')
      .trim()
  }

  return cleaned
}

const extractEditorialHintPhrases = (label: string): string[] => {
  const normalized = label.replace(/\s+/g, '')
  const cuePattern = /(?:所属|属于)?栏目(?:名称|名)?|(?:节目)?标题|(?:节目)?内容/gu
  const cueMatches = [...normalized.matchAll(cuePattern)]
  if (cueMatches.length === 0) return []

  const hints = new Set<string>()
  cueMatches.forEach((match, index) => {
    const cue = match[0]
    const start = (match.index ?? 0) + cue.length
    const end = cueMatches[index + 1]?.index ?? normalized.length
    const value = cleanEditorialHintValue(normalized.slice(start, end))
    if (value.length < 2) return
    const prefix = cue.includes('栏目')
      ? '所属栏目'
      : cue.includes('标题')
        ? '节目标题'
        : '节目内容'
    hints.add(`${prefix}${value}`)
  })

  return [...hints]
}

const buildStructuredQueryHints = (label: string, programTypeHint?: string): string[] => {
  const editorialHints = extractEditorialHintPhrases(label)
  const hints = [
    ...(editorialHints.length > 0 ? [] : [label]),
    ...editorialHints,
    programTypeHint ? DEFAULT_LABEL_BY_PROGRAM_TYPE[programTypeHint] : undefined,
  ].filter(Boolean) as string[]
  const text = `${label}${programTypeHint ?? ''}`

  ;[
    '静安寺',
    '外滩',
    '商圈',
    '发布会',
    '会场',
    '展会',
    '论坛',
    '活动',
    '直播',
    '现场',
    '户外直播',
    '外场直播',
    '现场导视',
    '预热',
    '导视',
    '集锦',
    '回看',
    '服务提醒',
  ].forEach((keyword) => {
    if (text.includes(keyword)) {
      hints.push(keyword)
    }
  })

  if (/户外|外场|现场|直播/.test(text)) {
    hints.push('直播', '外场直播')
  }
  if (hasDramaEpisodeCue(text)) {
    hints.push('电视剧', '剧场')
  }

  return Array.from(new Set(hints))
}

const mergeStructuredQueryHints = (
  rawHints: string[] | undefined,
  label: string,
  programType?: string,
): string[] => {
  const normalizedLabel = label.replace(/\s+/g, '')
  const hasEditorialHints = extractEditorialHintPhrases(label).length > 0
  const safeRawHints = (rawHints ?? []).filter((hint) =>
    !(hasEditorialHints && hint.replace(/\s+/g, '') === normalizedLabel),
  )
  return Array.from(new Set([
    ...safeRawHints,
    ...buildStructuredQueryHints(label, programType),
  ]))
}

const normalizeStructuredProgramType = (label: string, programType?: string): string => {
  const text = `${label}${programType ?? ''}`
  if (programType === 'news' && /(快讯|新闻|快报|播报|报道)/.test(label)) {
    return 'news'
  }
  if (hasDramaEpisodeCue(text) || /剧场|电视剧|连续剧/u.test(text)) {
    return 'drama'
  }
  if (/(户外|外场|现场|直播|活动|会场|展会|论坛|峰会|发布会|预热|导视|集锦|回看|服务提醒)/.test(text)) {
    return 'news_magazine'
  }
  return programType || buildGuessFromFreeformLabel(label).programType
}

const resolveProgramGuess = (
  input: string,
  overrides?: { semanticLabel?: string; programTypeHint?: string },
): ProgramTypeGuess => {
  const freeformLabel = extractFreeformLayoutLabel(input)
  const cleanedOverrideLabel = cleanLayoutDraftSemanticLabel(overrides?.semanticLabel, { stripLeadingPoliteCue: true })
  const defaultProgramLabel = overrides?.programTypeHint ? DEFAULT_LABEL_BY_PROGRAM_TYPE[overrides.programTypeHint] : undefined
  const freeformIsOnlyDaypartWithDefaultType = Boolean(
    freeformLabel
    && defaultProgramLabel
    && freeformLabel !== defaultProgramLabel
    && freeformLabel.endsWith(defaultProgramLabel)
    && /^(?:上午|中午|午间|下午|晚间|晚上|夜间|深夜|凌晨|全天|整天|全日)/u.test(freeformLabel),
  )
  if (freeformLabel && !cleanedOverrideLabel && !freeformIsOnlyDaypartWithDefaultType) {
    return buildGuessFromFreeformLabel(freeformLabel)
  }

  const structuredGuess = buildGuessFromStructuredIntent(
    overrides?.semanticLabel,
    overrides?.programTypeHint,
  )
  if (structuredGuess) {
    return structuredGuess
  }

  if (freeformLabel) {
    return buildGuessFromFreeformLabel(freeformLabel)
  }
  if (input.includes('下午剧场')) {
    return {
      label: '下午剧场',
      programType: 'drama',
      queryHints: ['下午剧场', '剧场', '电视剧'],
      sequential: true,
    }
  }
  if (input.includes('黄金剧场')) {
    return {
      label: '黄金剧场',
      programType: 'drama',
      queryHints: ['黄金剧场', '剧场', '电视剧'],
      sequential: true,
    }
  }
  if (input.includes('电视剧') || input.includes('剧场')) {
    return {
      label: input.includes('剧场') ? '剧场' : '电视剧',
      programType: 'drama',
      queryHints: ['电视剧', '剧场'],
      sequential: true,
    }
  }
  if (input.includes('新闻栏目')) {
    return {
      label: '新闻栏目',
      programType: 'news',
      queryHints: ['新闻栏目', '新闻'],
    }
  }
  if (input.includes('新闻')) {
    return {
      label: '新闻',
      programType: 'news',
      queryHints: ['新闻'],
    }
  }
  if (input.includes('资讯')) {
    return {
      label: '资讯',
      programType: 'news_magazine',
      queryHints: ['资讯'],
    }
  }
  if (input.includes('健康')) {
    return {
      label: '健康',
      programType: 'health',
      queryHints: ['健康'],
    }
  }
  if (input.includes('评论') || input.includes('民生')) {
    return {
      label: '评论',
      programType: 'commentary',
      queryHints: ['评论', '民生'],
    }
  }
  if (input.includes('娱乐') || input.includes('综艺')) {
    return {
      label: '娱乐',
      programType: 'entertainment',
      queryHints: ['娱乐', '综艺'],
    }
  }
  if (input.includes('黄金剧场')) {
    return {
      label: '黄金剧场',
      programType: 'drama',
      queryHints: ['黄金剧场', '剧场', '电视剧'],
      sequential: true,
    }
  }
  if (input.includes('电视剧') || input.includes('剧场')) {
    return {
      label: '电视剧',
      programType: 'drama',
      queryHints: ['电视剧', '剧场'],
      sequential: true,
    }
  }
  if (input.includes('新闻')) {
    return {
      label: '新闻',
      programType: 'news',
      queryHints: ['新闻'],
    }
  }
  if (input.includes('资讯')) {
    return {
      label: '资讯',
      programType: 'news_magazine',
      queryHints: ['资讯'],
    }
  }
  if (input.includes('健康')) {
    return {
      label: '健康',
      programType: 'health',
      queryHints: ['健康'],
    }
  }
  if (input.includes('评论') || input.includes('民生')) {
    return {
      label: '评论',
      programType: 'commentary',
      queryHints: ['评论', '民生'],
    }
  }
  if (input.includes('娱乐') || input.includes('综艺')) {
    return {
      label: '娱乐',
      programType: 'entertainment',
      queryHints: ['娱乐', '综艺'],
    }
  }
  if (input.includes('少儿')) {
    return {
      label: '少儿',
      programType: 'kids',
      queryHints: ['少儿'],
    }
  }
  if (input.includes('纪录片')) {
    return {
      label: '纪录片',
      programType: 'documentary',
      queryHints: ['纪录片'],
    }
  }

  return {
    label: '综合版面',
    programType: 'news_magazine',
    queryHints: ['资讯'],
  }
}

const extractTimeRange = (input: string): { start: string; end: string } | undefined => {
  const actualColonRange = input.match(/(\d{1,2}:\d{2})(?:到|至|-)(\d{1,2}:\d{2})/)
  if (actualColonRange) {
    return {
      start: normalizeClock(actualColonRange[1]!),
      end: normalizeClock(actualColonRange[2]!),
    }
  }

  const actualPointRange = input.match(/(\d{1,2})(?::(\d{1,2}))?(?:点|點)?(?:到|至|-)(\d{1,2})(?::(\d{1,2}))?(?:点|點)?/)
  if (actualPointRange) {
    return {
      start: normalizeClock(`${actualPointRange[1]}:${actualPointRange[2] ?? '00'}:00`),
      end: normalizeClock(`${actualPointRange[3]}:${actualPointRange[4] ?? '00'}:00`),
    }
  }
  const colonRange = input.match(/(\d{1,2}:\d{2})(?:分)?(?:到|-|至)(\d{1,2}:\d{2})/)
  if (colonRange) {
    return {
      start: normalizeClock(colonRange[1]!),
      end: normalizeClock(colonRange[2]!),
    }
  }

  const pointRange = input.match(/(\d{1,2})(?::(\d{1,2}))?点(?:到|-|至)(\d{1,2})(?::(\d{1,2}))?点?/)
  if (pointRange) {
    return {
      start: normalizeClock(`${pointRange[1]}:${pointRange[2] ?? '00'}:00`),
      end: normalizeClock(`${pointRange[3]}:${pointRange[4] ?? '00'}:00`),
    }
  }

  if (input.includes('上午')) {
    return { start: '06:00:00', end: '12:00:00' }
  }
  if (input.includes('中午') || input.includes('午间')) {
    return { start: '12:00:00', end: '14:00:00' }
  }
  if (input.includes('下午')) {
    return { start: '13:00:00', end: '18:00:00' }
  }
  if (input.includes('晚间') || input.includes('晚上')) {
    return { start: '18:00:00', end: '23:00:00' }
  }
  if (input.includes('深夜') || input.includes('凌晨')) {
    return { start: '23:00:00', end: '23:59:59' }
  }
  if (input.includes('全天') || input.includes('整天') || input.includes('全日')) {
    return { ...DEFAULT_COVERAGE }
  }

  if (input.includes('上午')) {
    return { start: '06:00:00', end: '12:00:00' }
  }
  if (input.includes('中午') || input.includes('午间')) {
    return { start: '12:00:00', end: '14:00:00' }
  }
  if (input.includes('下午')) {
    return { start: '13:00:00', end: '18:00:00' }
  }
  if (input.includes('晚间') || input.includes('晚上')) {
    return { start: '18:00:00', end: '23:00:00' }
  }
  if (input.includes('深夜') || input.includes('凌晨')) {
    return { start: '23:00:00', end: '23:59:59' }
  }
  if (input.includes('全天') || input.includes('整天') || input.includes('全日')) {
    return { ...DEFAULT_COVERAGE }
  }

  return undefined
}

const isRemoveInstruction = (input: string): boolean => ['删除', '删掉', '移除', '去掉'].some((keyword) => input.includes(keyword))

const isDeterministicRemoveRefine = (
  input: LayoutDraftRefineInput,
): boolean => {
  const normalized = normalizeInput(input.userInput)
  if (!isRemoveInstruction(normalized)) {
    return false
  }
  return Boolean(
    extractTimeRange(normalized)
    || extractSingleTimePoint(normalized)
    || extractRefineSemanticLabel(input.userInput, input.semanticLabel),
  )
}

const extractSingleTimePoint = (input: string): string | undefined => {
  if (input.includes('到') || input.includes('至') || input.includes('-')) {
    return undefined
  }

  const colonSingle = input.match(/(\d{1,2}:\d{2})/)
  if (colonSingle) {
    return normalizeClock(`${colonSingle[1]}:00`)
  }

  const halfMatch = input.match(/(\d{1,2})点半/)
  if (halfMatch) {
    return normalizeClock(`${halfMatch[1]}:30:00`)
  }

  const pointMatch = input.match(/(\d{1,2})(?::(\d{1,2}))?点/)
  if (pointMatch) {
    return normalizeClock(`${pointMatch[1]}:${pointMatch[2] ?? '00'}:00`)
  }

  return undefined
}

const toSeconds = (clock: string) => {
  const parts = clock.split(':')
  const hour = Number(parts[0] ?? '0')
  const minute = Number(parts[1] ?? '0')
  const second = Number(parts[2] ?? '0')
  return hour * 3600 + minute * 60 + second
}

const extractRefineSemanticLabel = (input: string, semanticLabel?: string): string | undefined => {
  if (semanticLabel?.trim()) {
    return semanticLabel.trim()
  }

  const normalized = input.trim()
  const matched = normalized.match(/(?:删除|删掉|移除|去掉)(.+)$/u)
  const cleaned = matched?.[1]
    ?.replace(/^(\d{1,2}(?::\d{1,2})?点半?|\d{1,2}:\d{2})的?/u, '')
    ?.replace(/(?:节目|栏目|时段|草案|版面草案|版面)+$/u, '')
    ?.trim()
  return cleaned || undefined
}

const parseChineseOrdinalIndex = (value: string): number | null => {
  if (/^\d+$/.test(value)) {
    const index = Number(value) - 1
    return index >= 0 ? index : null
  }
  const map: Record<string, number> = {
    一: 0,
    二: 1,
    两: 1,
    三: 2,
    四: 3,
    五: 4,
    六: 5,
    七: 6,
    八: 7,
    九: 8,
    十: 9,
  }
  return Object.prototype.hasOwnProperty.call(map, value) ? map[value]! : null
}

const extractOrdinalRefineRequest = (input: string): { index: number; label: string } | null => {
  const normalized = input.replace(/\s+/g, '')
  const ordinalMatch = normalized.match(/第([一二两三四五六七八九十\d]+)(?:个)?(?:小时|时段|段|块|内容块)/u)
    ?? normalized.match(/([一二两三四五六七八九十\d]+)(?:个)?(?:小时|时段|段|块|内容块)/u)
  const index = ordinalMatch?.[1] ? parseChineseOrdinalIndex(ordinalMatch[1]) : null
  if (index === null) return null

  const targetMatch = normalized.match(/(?:改成|换成|调整为|调整成|改为|变成|替换成|替换为)(.+)$/u)
  const label = cleanLayoutDraftSemanticLabel(
    targetMatch?.[1]?.replace(/(?:再|然后|并且|，|。|；|;).*$/u, ''),
    { stripLeadingPoliteCue: true },
  )
  return label ? { index, label } : null
}

const segmentMatchesLabel = (segment: LayoutDraftSpecSegment, semanticLabel?: string) => {
  if (!semanticLabel) {
    return undefined
  }
  const normalizedLabel = semanticLabel.trim().toLowerCase()
  const segmentLabel = segment.label.trim().toLowerCase()
  if (segmentLabel.includes(normalizedLabel) || normalizedLabel.includes(segmentLabel)) {
    return true
  }
  return segment.queryHints?.some((hint) => {
    const normalizedHint = hint.trim().toLowerCase()
    return normalizedHint.includes(normalizedLabel) || normalizedLabel.includes(normalizedHint)
  }) ?? false
}

const segmentOverlapsRange = (segment: LayoutDraftSpecSegment, range?: { start: string; end: string }) => {
  if (!range) {
    return undefined
  }
  const segmentStart = toSeconds(segment.startTime)
  const segmentEnd = toSeconds(segment.endTime)
  const targetStart = toSeconds(range.start)
  const targetEnd = toSeconds(range.end)
  return segmentStart < targetEnd && segmentEnd > targetStart
}

const segmentContainsTimePoint = (segment: LayoutDraftSpecSegment, timePoint?: string) => {
  if (!timePoint) {
    return undefined
  }
  const point = toSeconds(timePoint)
  const segmentStart = toSeconds(segment.startTime)
  const segmentEnd = toSeconds(segment.endTime)
  return segmentStart <= point && point < segmentEnd
}

const specStaysWithinCoverage = (spec: LayoutDraftSpec, coverage: { start: string; end: string }): boolean => {
  const coverageStart = toSeconds(coverage.start)
  const coverageEnd = toSeconds(coverage.end)
  return spec.coverage.start === coverage.start
    && spec.coverage.end === coverage.end
    && spec.segments.every((segment) => {
      const segmentStart = toSeconds(segment.startTime)
      const segmentEnd = toSeconds(segment.endTime)
      return segmentStart >= coverageStart && segmentEnd <= coverageEnd && segmentStart < segmentEnd
    })
}

const matchSegmentsForRefine = (
  existingSegments: LayoutDraftSpecSegment[],
  cues: {
    range?: { start: string; end: string }
    timePoint?: string
    semanticLabel?: string
  },
) => existingSegments.filter((segment) => {
  const rangeMatched = segmentOverlapsRange(segment, cues.range)
  const timeMatched = segmentContainsTimePoint(segment, cues.timePoint)
  const labelMatched = segmentMatchesLabel(segment, cues.semanticLabel)
  const temporalMatched = rangeMatched ?? timeMatched

  if (temporalMatched !== undefined && labelMatched !== undefined) {
    return temporalMatched && labelMatched
  }
  if (temporalMatched !== undefined) {
    return temporalMatched
  }
  if (labelMatched !== undefined) {
    return labelMatched
  }
  return false
})

const replaceRange = (
  existingSegments: LayoutDraftSpecSegment[],
  range: { start: string; end: string },
  replacement: LayoutDraftSpecSegment,
): LayoutDraftSpecSegment[] => {
  const targetStart = toSeconds(range.start)
  const targetEnd = toSeconds(range.end)

  const nextSegments: LayoutDraftSpecSegment[] = []
  existingSegments.forEach((segment) => {
    const segmentStart = toSeconds(segment.startTime)
    const segmentEnd = toSeconds(segment.endTime)

    if (segmentEnd <= targetStart || segmentStart >= targetEnd) {
      nextSegments.push(segment)
      return
    }

    if (segmentStart < targetStart) {
      nextSegments.push({
        ...segment,
        endTime: range.start,
      })
    }

    if (segmentEnd > targetEnd) {
      nextSegments.push({
        ...segment,
        startTime: range.end,
      })
    }
  })

  nextSegments.push(replacement)
  return nextSegments.sort((left, right) => left.startTime.localeCompare(right.startTime))
}

const expandCoverageToSegments = (
  coverage: { start: string; end: string },
  segments: LayoutDraftSpecSegment[],
): { start: string; end: string } => {
  if (segments.length === 0) {
    return coverage
  }
  const starts = segments.map((segment) => segment.startTime)
  const ends = segments.map((segment) => segment.endTime)
  return {
    start: [coverage.start, ...starts].sort()[0]!,
    end: [coverage.end, ...ends].sort().at(-1)!,
  }
}

export class LayoutDraftService {
  constructor(private llmClient: LLMClient) {}

  async generateSpec(input: LayoutDraftGenerationInput): Promise<LayoutDraftSpec> {
    const fallback = this.buildFallbackSpec(input)
    if (input.segments?.length) {
      return fallback
    }

    try {
      const response = await this.llmClient.chat(this.buildGeneratePrompt(input), {
        temperature: 0.2,
        maxTokens: 1200,
        timeout: 60000,
        maxRetries: 1,
        traceLabel: 'layout_draft_generate',
      })

      return this.parseSpecResponse(response.content, fallback)
    } catch (error) {
      if (shouldSurfaceDraftLlmFailure(input.userInput)) {
        throw createRecoverableLlmError('layout_draft_generate', error)
      }
      return fallback
    }
  }

  async refineSpec(input: LayoutDraftRefineInput): Promise<LayoutDraftSpec> {
    const fallback = this.buildRefinedFallbackSpec(input)
    if (input.segments?.length) {
      return fallback
    }
    if (isDeterministicRemoveRefine(input)) {
      return fallback
    }
    const normalized = normalizeInput(input.userInput)

    try {
      const response = await this.llmClient.chat(this.buildRefinePrompt(input), {
        temperature: 0.2,
        maxTokens: 1400,
        timeout: 60000,
        maxRetries: 1,
        traceLabel: 'layout_draft_refine',
      })

      const parsed = this.parseSpecResponse(response.content, fallback)
      if (input.coverage && !extractTimeRange(normalized) && !specStaysWithinCoverage(parsed, input.coverage)) {
        return fallback
      }
      return parsed
    } catch (error) {
      if (shouldSurfaceDraftLlmFailure(input.userInput)) {
        throw createRecoverableLlmError('layout_draft_refine', error)
      }
      return fallback
    }
  }

  private buildSpecSegmentsFromStructuredIntent(segments: LayoutIntentSegment[]): LayoutDraftSpecSegment[] {
    return segments
      .map((segment, index) => {
        const guess = resolveProgramGuess(segment.semanticLabel ?? segment.programTypeHint ?? '', {
          semanticLabel: segment.semanticLabel,
          programTypeHint: segment.programTypeHint,
        })
        return {
          id: `draft-segment-${index + 1}`,
          label: segment.semanticLabel?.trim() || guess.label,
          startTime: normalizeClock(segment.start),
          endTime: normalizeClock(segment.end),
          programType: normalizeStructuredProgramType(segment.semanticLabel ?? guess.label, segment.programTypeHint ?? guess.programType),
          queryHints: guess.queryHints,
          sequential: segment.sequential ?? guess.sequential,
        }
      })
      .sort((left, right) => left.startTime.localeCompare(right.startTime))
  }

  private resolveStructuredCoverage(input: LayoutDraftGenerationInput, segments: LayoutIntentSegment[]): { start: string; end: string } {
    const ordered = [...segments].sort((left, right) => left.start.localeCompare(right.start))
    return {
      start: normalizeClock(ordered[0]!.start),
      end: normalizeClock(ordered.at(-1)!.end),
    }
  }

  private buildFallbackSpec(input: LayoutDraftGenerationInput): LayoutDraftSpec {
    if (input.segments?.length) {
      return {
        coverage: this.resolveStructuredCoverage(input, input.segments),
        segments: this.buildSpecSegmentsFromStructuredIntent(input.segments),
      }
    }

    const normalized = normalizeInput(input.userInput)
    const coverage = extractTimeRange(normalized) ?? resolveInputCoverage(input)
    const guess = resolveProgramGuess(normalized, {
      semanticLabel: input.semanticLabel,
      programTypeHint: input.programTypeHint,
    })

    return {
      coverage,
      segments: [
        {
          id: `draft-segment-1`,
          label: guess.label,
          startTime: coverage.start,
          endTime: coverage.end,
          programType: guess.programType,
          queryHints: guess.queryHints,
          sequential: guess.sequential,
        },
      ],
    }
  }

  private buildRefinedFallbackSpec(input: LayoutDraftRefineInput): LayoutDraftSpec {
    const normalized = normalizeInput(input.userInput)
    const semanticLabel = extractRefineSemanticLabel(input.userInput, input.semanticLabel)
    const singleTimePoint = extractSingleTimePoint(normalized)

    const existingSegments: LayoutDraftSpecSegment[] = input.currentDraft.layoutReference.slots.map((slot) => {
      const column = input.currentDraft.columns.find((item) => item.columnId === slot.columnId)
      return {
        id: slot.id,
        label: column?.semanticLabel ?? column?.columnName ?? slot.id,
        startTime: toSlotClock(slot.startTime, input.currentDraft.coverage.start),
        endTime: toSlotClock(slot.endTime, input.currentDraft.coverage.end),
        programType: column?.defaultProgramType ?? 'news_magazine',
        queryHints: column?.queryHints,
        sequential: column?.isSequential,
      }
    })

    if ((input.segments?.length ?? 0) > 1) {
      const replacements = this.buildSpecSegmentsFromStructuredIntent(input.segments ?? [])
      return {
        coverage: expandCoverageToSegments(input.currentDraft.coverage, replacements),
        segments: replacements,
      }
    }

    const ordinalRefine = extractOrdinalRefineRequest(input.userInput)
    if (ordinalRefine) {
      const orderedSegments = [...existingSegments].sort((left, right) => left.startTime.localeCompare(right.startTime))
      const target = orderedSegments[ordinalRefine.index]
      if (target) {
        const guess = resolveProgramGuess(normalized, {
          semanticLabel: ordinalRefine.label,
          programTypeHint: input.programTypeHint,
        })
        const nextSegments = replaceRange(existingSegments, {
          start: target.startTime,
          end: target.endTime,
        }, {
          id: target.id,
          label: ordinalRefine.label,
          startTime: target.startTime,
          endTime: target.endTime,
          programType: guess.programType,
          queryHints: guess.queryHints,
          sequential: guess.sequential,
        })
        return {
          coverage: expandCoverageToSegments(input.currentDraft.coverage, nextSegments),
          segments: nextSegments,
        }
      }
    }

    if (input.segments?.length) {
      let nextSegments = [...existingSegments]
      const replacements = this.buildSpecSegmentsFromStructuredIntent(input.segments)
      replacements.forEach((replacement) => {
        nextSegments = replaceRange(nextSegments, {
          start: replacement.startTime,
          end: replacement.endTime,
        }, replacement)
      })
      return {
        coverage: expandCoverageToSegments(input.currentDraft.coverage, nextSegments),
        segments: nextSegments,
      }
    }

    const guess = resolveProgramGuess(normalized, {
      semanticLabel,
      programTypeHint: input.programTypeHint,
    })

    const matchedSegments = matchSegmentsForRefine(existingSegments, {
      range: extractTimeRange(normalized) ?? input.coverage,
      timePoint: singleTimePoint,
      semanticLabel,
    })

    if (isRemoveInstruction(normalized) && matchedSegments.length > 0) {
      const matchedIds = new Set(matchedSegments.map((segment) => segment.id ?? `${segment.startTime}-${segment.endTime}-${segment.label}`))
      const nextSegments = existingSegments.filter((segment) => !matchedIds.has(segment.id ?? `${segment.startTime}-${segment.endTime}-${segment.label}`))
      return {
        coverage: expandCoverageToSegments(input.currentDraft.coverage, nextSegments),
        segments: nextSegments,
      }
    }

    const replacementRange = extractTimeRange(normalized)
      ?? (matchedSegments.length > 0
        ? {
            start: matchedSegments[0]!.startTime,
            end: matchedSegments.at(-1)!.endTime,
          }
        : input.currentDraft.coverage)

    const nextSegments = replaceRange(existingSegments, replacementRange, {
      id: `draft-refined-${Date.now()}`,
      label: guess.label,
      startTime: replacementRange.start,
      endTime: replacementRange.end,
      programType: guess.programType,
      queryHints: guess.queryHints,
      sequential: guess.sequential,
    })

    return {
      coverage: expandCoverageToSegments(input.currentDraft.coverage, nextSegments),
      segments: nextSegments,
    }
  }

  private buildGeneratePrompt(input: LayoutDraftGenerationInput): ChatMessage[] {
    const coverage = input.segments?.length ? this.resolveStructuredCoverage(input, input.segments) : resolveInputCoverage(input)
    return [
      {
        role: 'system',
        content: `你是电视播单版面草案生成器。
请把用户的自然语言需求翻译成一个显式时间版的 LayoutDraftSpec。
要求：
- 所有时段必须输出明确的 startTime 和 endTime，格式固定为 HH:mm:ss。
- 不能出现重叠时段。
- coverage 内的时段必须连续覆盖。
- programType 使用英文枚举值，例如 news、news_magazine、drama、health、commentary、entertainment、kids、documentary。
- 如果用户提到了语义栏目，例如黄金剧场，请写到 label，并在 queryHints 中保留关键词。
- 如果是轮播草案，HH:mm:ss 表示从 00:00:00 起算的相对位置，不表示电视播出日期时间。
- 用户给出多个阶段、多个小时、每条固定时长、拆成 N 条，或者让你帮忙策划怎么排时，必须由你输出多条 segments；不要把这些要求合并成一个大段描述。
- 用户不知道怎么排但给了主题和总时长时，请根据编排经验先提出一版可审看的结构化草案；正式节目不会在这里写入。
- 只返回 JSON，不要输出解释文字。`,
      },
      {
        role: 'user',
        content: `频道：${input.channelName} (${input.channelId})
日期：${input.date}
当前播单类型：${input.playlistType ?? 'tv'}
${input.playlistType === 'rotation' && input.targetDurationSeconds ? `轮播目标总时长：${input.targetDurationSeconds} 秒` : ''}
默认覆盖范围：${coverage.start} - ${coverage.end}
用户需求：${input.userInput}
${input.segments?.length ? `结构化时段需求：${JSON.stringify(input.segments)}` : ''}
${input.semanticLabel ? `LLM 识别出的版面标签：${input.semanticLabel}` : ''}
${input.programTypeHint ? `LLM 识别出的类型提示：${input.programTypeHint}` : ''}`,
      },
    ]
  }

  private buildRefinePrompt(input: LayoutDraftRefineInput): ChatMessage[] {
    return [
      {
        role: 'system',
        content: `你是电视播单版面草案微调器。
请在保留 coverage 的前提下，根据用户的新要求返回完整的、更新后的 LayoutDraftSpec。
要求：
- 所有时段都必须保留显式的 HH:mm:ss 开始结束时间。
- 不要出现时段重叠或覆盖空洞。
- 如果用户要求拆分、分段、按每条时长细化，或者说第一小时/第二小时/第三小时，请由你返回更新后的多条 segments；不要把修改需求合并成一个大段描述。
- 如果当前草案是轮播草案，HH:mm:ss 表示从 00:00:00 起算的相对位置。
- 只返回 JSON，不要输出解释文字。`,
      },
      {
        role: 'user',
        content: `当前草案：
${JSON.stringify(
          {
            coverage: input.currentDraft.coverage,
            segments: input.currentDraft.layoutReference.slots.map((slot) => {
              const column = input.currentDraft.columns.find((item) => item.columnId === slot.columnId)
              return {
                id: slot.id,
                label: column?.semanticLabel ?? column?.columnName ?? slot.id,
                startTime: toSlotClock(slot.startTime, input.currentDraft.coverage.start),
                endTime: toSlotClock(slot.endTime, input.currentDraft.coverage.end),
                programType: column?.defaultProgramType,
                queryHints: column?.queryHints,
              }
            }),
          },
          null,
          2,
        )}

用户新要求：${input.userInput}
${input.segments?.length ? `结构化时段需求：${JSON.stringify(input.segments)}` : ''}
${input.semanticLabel ? `LLM 识别出的版面标签：${input.semanticLabel}` : ''}
${input.programTypeHint ? `LLM 识别出的类型提示：${input.programTypeHint}` : ''}`,
      },
    ]
  }

  private parseSpecResponse(content: string, fallback: LayoutDraftSpec): LayoutDraftSpec {
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/)
      if (!jsonMatch) {
        return fallback
      }

      const parsed = JSON.parse(jsonMatch[0]) as LayoutDraftSpec
      if (!parsed.coverage?.start || !parsed.coverage?.end || !Array.isArray(parsed.segments)) {
        return fallback
      }

      return {
        coverage: {
          start: normalizeClock(parsed.coverage.start),
          end: normalizeClock(parsed.coverage.end),
        },
        segments: parsed.segments.map((segment, index) => {
          const fallbackSegment = fallback.segments[index]
          const parsedLabel = cleanLayoutDraftSemanticLabel(segment.label, { stripLeadingPoliteCue: true })
          const fallbackLabel = fallbackSegment?.label
          const label = parsedLabel
            && fallbackLabel
            && parsedLabel !== fallbackLabel
            && parsedLabel.endsWith(fallbackLabel)
            && /^(?:上午|中午|午间|下午|晚间|晚上|夜间|深夜|凌晨|全天|整天|全日)/u.test(parsedLabel)
            ? fallbackLabel
            : parsedLabel
              ?? fallbackLabel
            ?? DEFAULT_LABEL_BY_PROGRAM_TYPE[segment.programType]
            ?? '自定义版面'
          const programType = normalizeStructuredProgramType(label, segment.programType ?? fallbackSegment?.programType)
          const queryHints = (segment.queryHints ?? [])
            .map((hint) => cleanLayoutDraftSemanticLabel(hint, { stripLeadingPoliteCue: true }))
            .filter((hint): hint is string => Boolean(hint))
          const fallbackHints = fallbackSegment?.queryHints ?? []

          return {
            id: segment.id ?? `draft-segment-${index + 1}`,
            label,
            startTime: normalizeClock(segment.startTime),
            endTime: normalizeClock(segment.endTime),
            programType,
            queryHints: mergeStructuredQueryHints(queryHints.length > 0 ? queryHints : fallbackHints, label, programType),
            sequential: segment.sequential,
          }
        }),
      }
    } catch {
      return fallback
    }
  }
}

let globalLayoutDraftService: LayoutDraftService | null = null

export function getLayoutDraftService(llmClient: LLMClient): LayoutDraftService {
  if (!globalLayoutDraftService) {
    globalLayoutDraftService = new LayoutDraftService(llmClient)
  }
  return globalLayoutDraftService
}
