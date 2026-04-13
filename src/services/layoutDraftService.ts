import type { ChatMessage } from '@/types/llm'
import type { LayoutDraft, LayoutDraftSpec, LayoutDraftSpecSegment } from '@/types/orchestration'
import type { LLMClient } from '@/services/llm/llmClient'

export interface LayoutDraftGenerationInput {
  channelId: string
  channelName: string
  date: string
  userInput: string
  coverage?: { start: string; end: string }
  semanticLabel?: string
  programTypeHint?: string
}

export interface LayoutDraftRefineInput extends LayoutDraftGenerationInput {
  currentDraft: LayoutDraft
}

const DEFAULT_COVERAGE = {
  start: '06:00:00',
  end: '23:59:59',
}

type ProgramTypeGuess = Pick<LayoutDraftSpecSegment, 'label' | 'programType' | 'queryHints' | 'sequential'>

const normalizeInput = (value: string) => value.trim().toLowerCase().replace(/\s+/g, '')

const normalizeClock = (clock: string) => {
  const parts = clock.split(':')
  const hour = Math.max(0, Math.min(23, Number(parts[0] ?? '0')))
  const minute = Math.max(0, Math.min(59, Number(parts[1] ?? '00')))
  const second = Math.max(0, Math.min(59, Number(parts[2] ?? '00')))
  return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}:${second.toString().padStart(2, '0')}`
}

const extractFreeformLayoutLabel = (input: string): string | null => {
  const normalized = input
    .replace(/^(?:不参考当前版面参考|不要参考当前版面参考|不参考当前版面|不要参考当前版面|忽略当前版面参考)[,，、]*/u, '')
    .trim()
  const verbMatch = normalized.match(/(?:排入|编入|改成|换成|替换成|替换为|调整为|改为|统一成|变成)(.+)$/u)
  if (!verbMatch && !/(电视剧|剧场|新闻|资讯|评论|健康|娱乐|综艺|少儿|纪录|电影|栏目)/u.test(normalized)) {
    return null
  }
  const rawLabel = verbMatch?.[1] ?? normalized
  const cleaned = rawLabel
    .replace(/^(?:全部|都|统一|整体)+/u, '')
    .replace(/(?:节目|栏目|版面|内容)+$/u, '')
    .trim()
  return cleaned || null
}

const buildGuessFromFreeformLabel = (label: string): ProgramTypeGuess => {
  const normalized = label.trim()
  const lowered = normalized.toLowerCase()
  const withHints = (...hints: string[]) => Array.from(new Set([normalized, ...hints].filter(Boolean)))

  if (/(剧场|电视剧|影视|微短剧|连续剧)/u.test(normalized)) {
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
  if (!semanticLabel && !programTypeHint) {
    return null
  }

  const label = semanticLabel?.trim() || '自定义版面'
  const queryHints = Array.from(new Set([
    label,
    programTypeHint === 'drama' ? '电视剧' : undefined,
    programTypeHint === 'news' ? '新闻' : undefined,
    programTypeHint === 'news_magazine' ? '资讯' : undefined,
    programTypeHint === 'commentary' ? '评论' : undefined,
    programTypeHint === 'health' ? '健康' : undefined,
    programTypeHint === 'entertainment' ? '娱乐' : undefined,
    programTypeHint === 'kids' ? '少儿' : undefined,
    programTypeHint === 'documentary' ? '纪录片' : undefined,
  ].filter(Boolean) as string[]))

  return {
    label,
    programType: programTypeHint ?? buildGuessFromFreeformLabel(label).programType,
    queryHints,
    sequential: programTypeHint === 'drama' || /剧场|电视剧|连续剧/u.test(label),
  }
}

const resolveProgramGuess = (
  input: string,
  overrides?: { semanticLabel?: string; programTypeHint?: string },
): ProgramTypeGuess => {
  const structuredGuess = buildGuessFromStructuredIntent(
    overrides?.semanticLabel,
    overrides?.programTypeHint,
  )
  if (structuredGuess) {
    return structuredGuess
  }

  const freeformLabel = extractFreeformLayoutLabel(input)
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
    ?.replace(/(?:节目|栏目|时段)+$/u, '')
    ?.trim()
  return cleaned || undefined
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

export class LayoutDraftService {
  constructor(private llmClient: LLMClient) {}

  async generateSpec(input: LayoutDraftGenerationInput): Promise<LayoutDraftSpec> {
    const fallback = this.buildFallbackSpec(input)

    try {
      const response = await this.llmClient.chat(this.buildGeneratePrompt(input), {
        temperature: 0.2,
        maxTokens: 1200,
      })

      return this.parseSpecResponse(response.content, fallback)
    } catch {
      return fallback
    }
  }

  async refineSpec(input: LayoutDraftRefineInput): Promise<LayoutDraftSpec> {
    const fallback = this.buildRefinedFallbackSpec(input)

    try {
      const response = await this.llmClient.chat(this.buildRefinePrompt(input), {
        temperature: 0.2,
        maxTokens: 1400,
      })

      return this.parseSpecResponse(response.content, fallback)
    } catch {
      return fallback
    }
  }

  private buildFallbackSpec(input: LayoutDraftGenerationInput): LayoutDraftSpec {
    const normalized = normalizeInput(input.userInput)
    const coverage = input.coverage ?? extractTimeRange(normalized) ?? { ...DEFAULT_COVERAGE }
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
    const guess = resolveProgramGuess(normalized, {
      semanticLabel,
      programTypeHint: input.programTypeHint,
    })

    const existingSegments: LayoutDraftSpecSegment[] = input.currentDraft.layoutReference.slots.map((slot) => {
      const column = input.currentDraft.columns.find((item) => item.columnId === slot.columnId)
      return {
        id: slot.id,
        label: column?.semanticLabel ?? column?.columnName ?? slot.id,
        startTime: slot.startTime.split('T')[1]?.slice(0, 8) ?? input.currentDraft.coverage.start,
        endTime: slot.endTime.split('T')[1]?.slice(0, 8) ?? input.currentDraft.coverage.end,
        programType: column?.defaultProgramType ?? 'news_magazine',
        queryHints: column?.queryHints,
        sequential: column?.isSequential,
      }
    })

    const matchedSegments = matchSegmentsForRefine(existingSegments, {
      range: extractTimeRange(normalized) ?? input.coverage,
      timePoint: singleTimePoint,
      semanticLabel,
    })

    if (isRemoveInstruction(normalized) && matchedSegments.length > 0) {
      const matchedIds = new Set(matchedSegments.map((segment) => segment.id ?? `${segment.startTime}-${segment.endTime}-${segment.label}`))
      return {
        coverage: input.currentDraft.coverage,
        segments: existingSegments.filter((segment) => !matchedIds.has(segment.id ?? `${segment.startTime}-${segment.endTime}-${segment.label}`)),
      }
    }

    const replacementRange = extractTimeRange(normalized)
      ?? (matchedSegments.length > 0
        ? {
            start: matchedSegments[0]!.startTime,
            end: matchedSegments.at(-1)!.endTime,
          }
        : input.currentDraft.coverage)

    return {
      coverage: input.currentDraft.coverage,
      segments: replaceRange(existingSegments, replacementRange, {
        id: `draft-refined-${Date.now()}`,
        label: guess.label,
        startTime: replacementRange.start,
        endTime: replacementRange.end,
        programType: guess.programType,
        queryHints: guess.queryHints,
        sequential: guess.sequential,
      }),
    }
  }

  private buildGeneratePrompt(input: LayoutDraftGenerationInput): ChatMessage[] {
    const coverage = input.coverage ?? DEFAULT_COVERAGE
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
- 只返回 JSON，不要输出解释文字。`,
      },
      {
        role: 'user',
        content: `频道：${input.channelName} (${input.channelId})
日期：${input.date}
默认覆盖范围：${coverage.start} - ${coverage.end}
用户需求：${input.userInput}
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
                startTime: slot.startTime.split('T')[1]?.slice(0, 8),
                endTime: slot.endTime.split('T')[1]?.slice(0, 8),
                programType: column?.defaultProgramType,
                queryHints: column?.queryHints,
              }
            }),
          },
          null,
          2,
        )}

用户新要求：${input.userInput}
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
        segments: parsed.segments.map((segment, index) => ({
          id: segment.id ?? `draft-segment-${index + 1}`,
          label: segment.label,
          startTime: normalizeClock(segment.startTime),
          endTime: normalizeClock(segment.endTime),
          programType: segment.programType,
          queryHints: segment.queryHints,
          sequential: segment.sequential,
        })),
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
