import type { LLMClient } from './llm/llmClient'
import type { DialogueContext } from './dialogueContext'
import { STAGE_TIMEOUT_BUDGET } from '@/services/agent/agentDeadline'

/**
 * paramExtractor prompt 版本号（对齐 AGENTS.md Prompt 版本管理门禁）
 * - v1.0：初始版本（4 段内联 system prompt 共享同一版本基线）
 */
export const PARAM_EXTRACTOR_PROMPT_VERSION = 'v1.0' as const

export interface InsertParams {
  targetTime: string
  programName?: string
  rawProgramText?: string
  semanticLabel?: string
  programTypeHint?: string
  expectedDurationSeconds?: number
}

export interface MoveParams {
  targetTime: string
  offsetSeconds: number
  direction: 'forward' | 'backward'
}

export interface DeleteParams {
  targetTime: string
  programName?: string
}

export interface ReplaceParams {
  targetTime: string
  programName: string
}

export class ParamExtractor {
  constructor(private llmClient: LLMClient) {}

  async extractInsertParams(context: DialogueContext): Promise<InsertParams | null> {
    const canAcceptLlmTargetTime = this.canAcceptLlmTargetTime(context)

    try {
      const response = await this.llmClient.chat(
        [
          {
            role: 'system',
            content:
              `[prompt ${PARAM_EXTRACTOR_PROMPT_VERSION}] 你是广播电视节目串联单命令参数提取器。请结合当前编单候选和目标时间附近节目，从用户输入中提取 targetTime，以及可选的 programName、rawProgramText、semanticLabel、programTypeHint、expectedDurationSeconds，并且只返回 JSON。如果用户没有明确提到时间，不要猜测 targetTime。用户明确说30分钟、半小时、1小时等时长时，expectedDurationSeconds 必须换算为秒。`,
          },
          {
            role: 'user',
            content:
              `用户指令: ${context.userInput}\n` +
              this.buildContextPrompt(context) +
              '输出格式: {"targetTime":"09:00:00","programName":"看东方","rawProgramText":"看东方","semanticLabel":"新闻资讯","programTypeHint":"news_magazine","expectedDurationSeconds":1800}',
          },
        ],
        { temperature: 0, maxTokens: 120, timeout: STAGE_TIMEOUT_BUDGET.intent_parse, maxRetries: 1, traceLabel: 'atomic_insert_params', promptVersion: PARAM_EXTRACTOR_PROMPT_VERSION },
      )

      const match = response.content.match(/\{[\s\S]*\}/)
      if (!match) return null
      const parsed = JSON.parse(match[0]) as Partial<InsertParams>
      if (!parsed.targetTime) return null
      const normalizedTargetTime = this.normalizeTime(parsed.targetTime)
      if (!normalizedTargetTime) return null
      if (!canAcceptLlmTargetTime) return null
      return this.normalizeInsertParams({
        targetTime: normalizedTargetTime,
        programName: parsed.programName,
        rawProgramText: parsed.rawProgramText,
        semanticLabel: parsed.semanticLabel,
        programTypeHint: parsed.programTypeHint,
        expectedDurationSeconds: typeof parsed.expectedDurationSeconds === 'number'
          ? parsed.expectedDurationSeconds
          : this.extractInsertDurationSeconds(context.userInput) ?? undefined,
      })
    } catch {
      return null
    }
  }

  async extractMoveParams(context: DialogueContext): Promise<MoveParams | null> {
    const canAcceptLlmTargetTime = this.canAcceptLlmTargetTime(context)

    try {
      const response = await this.llmClient.chat(
        [
          {
            role: 'system',
            content:
              `[prompt ${PARAM_EXTRACTOR_PROMPT_VERSION}] 你是广播电视节目串联单命令参数提取器。请结合当前编单候选和目标时间附近节目，从用户输入中提取 targetTime、direction 和 offsetSeconds，并且只返回 JSON。如果用户没有明确提到时间，不要猜测 targetTime。`,
          },
          {
            role: 'user',
            content:
              `用户指令: ${context.userInput}\n` +
              this.buildContextPrompt(context) +
              '输出格式: {"targetTime":"22:00:00","direction":"forward","offsetSeconds":3600}',
          },
        ],
        { temperature: 0, maxTokens: 120, timeout: STAGE_TIMEOUT_BUDGET.intent_parse, maxRetries: 1, traceLabel: 'atomic_move_params', promptVersion: PARAM_EXTRACTOR_PROMPT_VERSION },
      )

      const match = response.content.match(/\{[\s\S]*\}/)
      if (!match) return null
      const parsed = JSON.parse(match[0]) as Partial<MoveParams>
      if (!parsed.targetTime || !parsed.direction || !parsed.offsetSeconds) return null
      const normalizedTargetTime = this.normalizeTime(parsed.targetTime)
      if (!normalizedTargetTime) return null
      if (!canAcceptLlmTargetTime) return null
      const extracted: MoveParams = {
        targetTime: normalizedTargetTime,
        direction: parsed.direction === 'backward' ? 'backward' : 'forward',
        offsetSeconds: Math.max(60, Number(parsed.offsetSeconds)),
      }
      return extracted
    } catch {
      return null
    }
  }

  async extractDeleteParams(context: DialogueContext): Promise<DeleteParams | null> {
    const canAcceptLlmTargetTime = this.canAcceptLlmTargetTime(context)

    try {
      const response = await this.llmClient.chat(
        [
          {
            role: 'system',
            content:
              `[prompt ${PARAM_EXTRACTOR_PROMPT_VERSION}] 你是广播电视节目串联单命令参数提取器。请结合当前编单候选和目标时间附近节目，从用户输入中提取 targetTime 和可选 programName，并且只返回 JSON。如果用户没有明确提到时间，不要猜测 targetTime。`,
          },
          {
            role: 'user',
            content:
              `用户指令: ${context.userInput}\n` +
              this.buildContextPrompt(context) +
              '输出格式: {"targetTime":"12:00:00","programName":"午间30"}',
          },
        ],
        { temperature: 0, maxTokens: 120, timeout: STAGE_TIMEOUT_BUDGET.intent_parse, maxRetries: 1, traceLabel: 'atomic_delete_params', promptVersion: PARAM_EXTRACTOR_PROMPT_VERSION },
      )

      const match = response.content.match(/\{[\s\S]*\}/)
      if (!match) return null
      const parsed = JSON.parse(match[0]) as Partial<DeleteParams>
      if (!parsed.targetTime) return null
      const normalizedTargetTime = this.normalizeTime(parsed.targetTime)
      if (!normalizedTargetTime) return null
      if (!canAcceptLlmTargetTime) return null
      const extracted = {
        targetTime: normalizedTargetTime,
        programName: parsed.programName?.trim(),
      }
      return extracted
    } catch {
      return null
    }
  }

  async extractReplaceParams(context: DialogueContext): Promise<ReplaceParams | null> {
    const canAcceptLlmTargetTime = this.canAcceptLlmTargetTime(context)

    try {
      const response = await this.llmClient.chat(
        [
          {
            role: 'system',
            content:
              `[prompt ${PARAM_EXTRACTOR_PROMPT_VERSION}] 你是广播电视节目串联单命令参数提取器。请结合当前编单候选和目标时间附近节目，从用户输入中提取 targetTime 和 replacementProgramName，并且只返回 JSON。如果用户没有明确提到时间，不要猜测 targetTime。`,
          },
          {
            role: 'user',
            content:
              `用户指令: ${context.userInput}\n` +
              this.buildContextPrompt(context) +
              '输出格式: {"targetTime":"10:00:00","replacementProgramName":"中国考古报道"}',
          },
        ],
        { temperature: 0, maxTokens: 120, timeout: STAGE_TIMEOUT_BUDGET.intent_parse, maxRetries: 1, traceLabel: 'atomic_replace_params', promptVersion: PARAM_EXTRACTOR_PROMPT_VERSION },
      )

      const match = response.content.match(/\{[\s\S]*\}/)
      if (!match) return null
      const parsed = JSON.parse(match[0]) as {
        targetTime?: string
        replacementProgramName?: string
        programName?: string
      }
      const programName = parsed.replacementProgramName ?? parsed.programName
      if (!parsed.targetTime || !programName) return null
      const normalizedTargetTime = this.normalizeTime(parsed.targetTime)
      if (!normalizedTargetTime) return null
      if (!canAcceptLlmTargetTime) return null
      const extracted = {
        targetTime: normalizedTargetTime,
        programName: programName.trim(),
      }
      return extracted
    } catch {
      return null
    }
  }

  private buildContextPrompt(context: DialogueContext): string {
    return (
      `频道: ${context.scheduleState.channelName}\n` +
      `日期: ${context.scheduleState.date}\n` +
      `当前节目名候选: ${context.scheduleNameCandidates}\n` +
      `目标时间提示: ${context.targetTimeHints.join('、') || '未识别到明确时间'}\n` +
      `目标时间附近节目:\n${context.nearbyScheduleSummary}\n`
    )
  }

  private shouldRefineWithContext(
    context: DialogueContext,
    intentType: 'insert' | 'move' | 'delete' | 'replace',
    programName?: string,
    rawProgramText?: string,
  ): boolean {
    if (context.currentSchedule.length === 0) {
      return false
    }

    const hasTimeHints = context.targetTimeHints.length > 0
    const hasNearbyItems =
      context.nearbyScheduleSummary !== '当前节目单为空，没有可参考的附近节目。'
      && context.nearbyScheduleSummary !== '未从用户输入中识别到明确时间点。'
    const hasProgramHint = typeof programName === 'string' && programName.trim().length > 0

    if (intentType === 'delete' || intentType === 'replace') {
      if (hasTimeHints) return false
      return hasNearbyItems || hasProgramHint
    }

    if (intentType === 'insert') {
      if (context.targetTimeHints.length > 0 && rawProgramText?.trim()) {
        return false
      }
      return hasProgramHint || hasTimeHints
    }

    if (intentType === 'move' && hasTimeHints) return false

    return hasTimeHints && hasNearbyItems
  }

  private hasExplicitTargetTimeHint(context: DialogueContext): boolean {
    return context.targetTimeHints.length > 0
  }

  private canAcceptLlmTargetTime(context: DialogueContext): boolean {
    if (this.hasExplicitTargetTimeHint(context)) return true
    return /(它|这条|那条|这个|那个|这档|那档|刚才|刚刚|上一个|下一个|当前|选中)/.test(context.userInput)
  }

  private normalizeTime(timeText: string): string | null {
    const match = timeText.match(/(\d{1,2})[:：]?(\d{2})?(?:[:：]?(\d{2}))?/)
    if (!match) return null

    const hours = (match[1] ?? '09').padStart(2, '0')
    const minutes = (match[2] ?? '00').padStart(2, '0')
    const seconds = (match[3] ?? '00').padStart(2, '0')
    return `${hours}:${minutes}:${seconds}`
  }

  private normalizeInsertParams(params: InsertParams): InsertParams {
    const targetTime = this.normalizeTime(params.targetTime)
    if (!targetTime) {
      throw new Error('normalizeInsertParams requires a valid targetTime')
    }
    const rawProgramText = this.normalizeProgramFragment(params.rawProgramText)
    const explicitProgramName = this.normalizeProgramName(params.programName)
    const quotedProgramName = rawProgramText?.match(/《([^》]+)》/)?.[1]?.trim()
    const inferredProgramName = explicitProgramName || this.normalizeProgramName(quotedProgramName)
    const programTypeHint = this.normalizeProgramTypeHint(
      params.programTypeHint ?? this.inferProgramTypeHint(rawProgramText ?? inferredProgramName),
    )
    const expectedDurationSeconds = typeof params.expectedDurationSeconds === 'number' && params.expectedDurationSeconds > 0
      ? Math.round(params.expectedDurationSeconds)
      : undefined
    const semanticLabel = this.normalizeSemanticLabel(
      params.semanticLabel ?? this.inferSemanticLabel(rawProgramText ?? inferredProgramName, programTypeHint),
    )

    if (inferredProgramName && !this.isGenericProgramRequest(inferredProgramName)) {
      return {
        targetTime,
        programName: inferredProgramName,
        rawProgramText: rawProgramText ?? inferredProgramName,
        semanticLabel,
        programTypeHint,
        expectedDurationSeconds,
      }
    }

    if (rawProgramText && !this.isGenericProgramRequest(rawProgramText)) {
      return {
        targetTime,
        programName: rawProgramText,
        rawProgramText,
        semanticLabel,
        programTypeHint,
        expectedDurationSeconds,
      }
    }

    return {
      targetTime,
      rawProgramText,
      semanticLabel,
      programTypeHint,
      expectedDurationSeconds,
    }
  }

  private extractInsertDurationSeconds(userInput: string): number | null {
    const normalized = userInput.replace(/\s+/g, '')
    const durationToken = '(?:一刻钟|三刻钟|半个?小时|(?:(?:\\d+(?:\\.\\d+)?)|[零〇一二两三四五六七八九十]{1,3})(?:个)?小时|(?:(?:\\d+)|[零〇一二两三四五六七八九十]{1,3})(?:分钟|分))'
    const match = new RegExp(durationToken, 'u').exec(normalized)
    if (!match?.[0]) return null
    return this.parseDurationSeconds(match[0])
  }

  private parseDurationSeconds(value: string): number | null {
    if (/^一刻钟$/.test(value)) return 15 * 60
    if (/^三刻钟$/.test(value)) return 45 * 60
    if (/^半个?小时$/.test(value)) return 30 * 60

    const hourMatch = value.match(/^(\d+(?:\.\d+)?|[零〇一二两三四五六七八九十]{1,3})(?:个)?小时$/)
    if (hourMatch?.[1]) {
      const hours = this.parseChineseNumber(hourMatch[1])
      return hours === null ? null : Math.round(hours * 3600)
    }

    const minuteMatch = value.match(/^(\d+|[零〇一二两三四五六七八九十]{1,3})(?:分钟|分)$/)
    if (minuteMatch?.[1]) {
      const minutes = this.parseChineseNumber(minuteMatch[1])
      return minutes === null ? null : Math.round(minutes * 60)
    }

    return null
  }

  private parseChineseNumber(value: string): number | null {
    if (/^\d+(?:\.\d+)?$/.test(value)) return Number(value)
    const digitMap: Record<string, number> = {
      零: 0,
      〇: 0,
      一: 1,
      二: 2,
      两: 2,
      三: 3,
      四: 4,
      五: 5,
      六: 6,
      七: 7,
      八: 8,
      九: 9,
    }
    if (Object.prototype.hasOwnProperty.call(digitMap, value)) return digitMap[value]!
    if (value === '十') return 10
    const teen = value.match(/^十([一二两三四五六七八九])$/)
    if (teen?.[1]) return 10 + digitMap[teen[1]]!
    const tens = value.match(/^([一二两三四五六七八九])十([一二两三四五六七八九])?$/)
    if (tens?.[1]) return digitMap[tens[1]]! * 10 + (tens[2] ? digitMap[tens[2]]! : 0)
    return null
  }

  private normalizeProgramName(value?: string): string | undefined {
    if (!value) return undefined
    const normalized = value
      .replace(/^《/, '')
      .replace(/》$/, '')
      .replace(/[，。！？!?]/g, '')
      .replace(/^(?:我要|我想要|想要|我想看|想看|要看|来个|来一条|来一档|放个|上个)+/, '')
      .replace(/(?:吧|呀|啊|呢)$/u, '')
      .trim()
    return normalized || undefined
  }

  private normalizeProgramFragment(value?: string): string | undefined {
    if (!value) return undefined
    const normalized = value
      .replace(/^(一档|一个|一条|一期|一部|个|条|档|期|部)/, '')
      .replace(/^(?:\d+分钟|\d+分|\d+小时|半小时|半个小时|一刻钟|三刻钟)/u, '')
      .replace(/^(适合的|合适的|当前的)/, '')
      .replace(/^(节目名|节目|栏目|我要|我想要|想要|我想看|想看|要看|来个|来一条|来一档|放个|上个|推荐|找|查|有没有适合的?|有没有可用的?|有没有候选的?)\s*/, '')
      .replace(/(?:候选节目|候选|可选节目|可用节目)$/u, '')
      .replace(/[，。！？!?]/g, '')
      .replace(/(?:吧|呀|啊|呢)$/u, '')
      .trim()
    return normalized || undefined
  }

  private normalizeProgramTypeHint(value?: string): string | undefined {
    if (!value) return undefined
    const normalized = value.trim().toLowerCase()
    return normalized || undefined
  }

  private normalizeSemanticLabel(value?: string): string | undefined {
    if (!value) return undefined
    const normalized = value.trim()
    return normalized || undefined
  }

  private isGenericProgramRequest(value?: string): boolean {
    if (!value) return true
    const normalized = value.replace(/\s+/g, '')
    if (!normalized) return true
    if (/^(节目|栏目|内容|片子|合适的节目|当前的节目)$/.test(normalized)) return true
    return /^(新闻|资讯|预告|导视|垫片|现场导视|电视剧|剧场|综艺|纪录片|纪实|少儿|动画|评论|访谈|养生|健康|娱乐|电影|短剧|热闹|轻松|热闹的内容|轻松的内容)(节目|栏目|内容)?$/.test(normalized)
  }

  private inferProgramTypeHint(value?: string): string | undefined {
    if (!value) return undefined
    const normalized = value.replace(/\s+/g, '')
    const mappings: Array<{ pattern: RegExp; type: string }> = [
      { pattern: /(新闻|快报|联播)/, type: 'news' },
      { pattern: /(资讯|观察|预告|导视|垫片|Eye)/i, type: 'news_magazine' },
      { pattern: /(电视剧|剧场|短剧|剧情)/, type: 'drama' },
      { pattern: /(综艺|娱乐|热闹|轻松)/, type: 'entertainment' },
      { pattern: /(养生|健康)/, type: 'health' },
      { pattern: /(评论|访谈|观点)/, type: 'commentary' },
      { pattern: /(少儿|动画|童)/, type: 'kids' },
      { pattern: /(纪录片|纪实)/, type: 'documentary' },
    ]
    return mappings.find((item) => item.pattern.test(normalized))?.type
  }

  private inferSemanticLabel(value?: string, programTypeHint?: string): string | undefined {
    if (value) {
      const normalized = value.replace(/\s+/g, '')
      if (/(新闻|快报|联播)/.test(normalized)) return '新闻'
      if (/(资讯|观察|预告|导视|垫片|Eye)/i.test(normalized)) return '资讯'
      if (/(电视剧|剧场|短剧|剧情)/.test(normalized)) return '剧场'
      if (/(综艺|娱乐|热闹|轻松)/.test(normalized)) return '娱乐'
      if (/(养生|健康)/.test(normalized)) return '养生'
      if (/(评论|访谈|观点)/.test(normalized)) return '评论'
      if (/(少儿|动画|童)/.test(normalized)) return '少儿'
      if (/(纪录片|纪实)/.test(normalized)) return '纪实'
    }

    const typeToLabel: Record<string, string> = {
      news: '新闻',
      news_magazine: '资讯',
      drama: '剧场',
      entertainment: '娱乐',
      health: '养生',
      commentary: '评论',
      kids: '少儿',
      documentary: '纪实',
    }

    return programTypeHint ? typeToLabel[programTypeHint] : undefined
  }
}

let globalParamExtractor: ParamExtractor | null = null

export function getParamExtractor(llmClient: LLMClient): ParamExtractor {
  if (!globalParamExtractor) {
    globalParamExtractor = new ParamExtractor(llmClient)
  }
  return globalParamExtractor
}
