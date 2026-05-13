import type { LLMClient } from './llm/llmClient'
import type { DialogueContext } from './dialogueContext'

export interface InsertParams {
  targetTime: string
  programName?: string
  rawProgramText?: string
  semanticLabel?: string
  programTypeHint?: string
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
    const ruleBased = this.ruleBasedExtractInsert(context.userInput)
    if (ruleBased && !this.shouldRefineWithContext(context, 'insert', ruleBased.programName)) {
      return ruleBased
    }
    if (!ruleBased && !this.hasExplicitTargetTimeHint(context)) {
      return null
    }

    try {
      const response = await this.llmClient.chat(
        [
          {
            role: 'system',
            content:
              '你是广播电视节目串联单命令参数提取器。请结合当前编单候选和目标时间附近节目，从用户输入中提取 targetTime，以及可选的 programName、rawProgramText、semanticLabel、programTypeHint，并且只返回 JSON。如果用户没有明确提到时间，不要猜测 targetTime。',
          },
          {
            role: 'user',
            content:
              `用户指令: ${context.userInput}\n` +
              this.buildContextPrompt(context) +
              '输出格式: {"targetTime":"09:00:00","programName":"看东方","rawProgramText":"看东方","semanticLabel":"新闻资讯","programTypeHint":"news_magazine"}',
          },
        ],
        { temperature: 0, maxTokens: 120 },
      )

      const match = response.content.match(/\{[\s\S]*\}/)
      if (!match) return ruleBased ?? null
      const parsed = JSON.parse(match[0]) as Partial<InsertParams>
      if (!parsed.targetTime) return ruleBased ?? null
      const normalizedTargetTime = this.normalizeTime(parsed.targetTime)
      if (!normalizedTargetTime) return ruleBased ?? null
      return this.normalizeInsertParams({
        targetTime: normalizedTargetTime,
        programName: parsed.programName,
        rawProgramText: parsed.rawProgramText,
        semanticLabel: parsed.semanticLabel,
        programTypeHint: parsed.programTypeHint,
      })
    } catch {
      return ruleBased ?? null
    }
  }

  async extractMoveParams(context: DialogueContext): Promise<MoveParams | null> {
    const ruleBased = this.ruleBasedExtractMove(context.userInput)
    if (ruleBased && !this.shouldRefineWithContext(context, 'move')) {
      return ruleBased
    }
    if (!ruleBased && !this.hasExplicitTargetTimeHint(context)) {
      return null
    }

    try {
      const response = await this.llmClient.chat(
        [
          {
            role: 'system',
            content:
              '你是广播电视节目串联单命令参数提取器。请结合当前编单候选和目标时间附近节目，从用户输入中提取 targetTime、direction 和 offsetSeconds，并且只返回 JSON。如果用户没有明确提到时间，不要猜测 targetTime。',
          },
          {
            role: 'user',
            content:
              `用户指令: ${context.userInput}\n` +
              this.buildContextPrompt(context) +
              '输出格式: {"targetTime":"22:00:00","direction":"forward","offsetSeconds":3600}',
          },
        ],
        { temperature: 0, maxTokens: 120 },
      )

      const match = response.content.match(/\{[\s\S]*\}/)
      if (!match) return ruleBased ?? null
      const parsed = JSON.parse(match[0]) as Partial<MoveParams>
      if (!parsed.targetTime || !parsed.direction || !parsed.offsetSeconds) return ruleBased ?? null
      const normalizedTargetTime = this.normalizeTime(parsed.targetTime)
      if (!normalizedTargetTime) return ruleBased ?? null
      const extracted: MoveParams = {
        targetTime: normalizedTargetTime,
        direction: parsed.direction === 'backward' ? 'backward' : 'forward',
        offsetSeconds: Math.max(60, Number(parsed.offsetSeconds)),
      }
      return extracted
    } catch {
      return ruleBased ?? null
    }
  }

  async extractDeleteParams(context: DialogueContext): Promise<DeleteParams | null> {
    const ruleBased = this.ruleBasedExtractDelete(context.userInput)
    if (ruleBased && !this.shouldRefineWithContext(context, 'delete', ruleBased.programName)) {
      return ruleBased
    }
    if (!ruleBased && !this.hasExplicitTargetTimeHint(context)) {
      return null
    }

    try {
      const response = await this.llmClient.chat(
        [
          {
            role: 'system',
            content:
              '你是广播电视节目串联单命令参数提取器。请结合当前编单候选和目标时间附近节目，从用户输入中提取 targetTime 和可选 programName，并且只返回 JSON。如果用户没有明确提到时间，不要猜测 targetTime。',
          },
          {
            role: 'user',
            content:
              `用户指令: ${context.userInput}\n` +
              this.buildContextPrompt(context) +
              '输出格式: {"targetTime":"12:00:00","programName":"午间30"}',
          },
        ],
        { temperature: 0, maxTokens: 120 },
      )

      const match = response.content.match(/\{[\s\S]*\}/)
      if (!match) return ruleBased ?? null
      const parsed = JSON.parse(match[0]) as Partial<DeleteParams>
      if (!parsed.targetTime) return ruleBased ?? null
      const normalizedTargetTime = this.normalizeTime(parsed.targetTime)
      if (!normalizedTargetTime) return ruleBased ?? null
      const extracted = {
        targetTime: normalizedTargetTime,
        programName: parsed.programName?.trim(),
      }
      return extracted
    } catch {
      return ruleBased ?? null
    }
  }

  async extractReplaceParams(context: DialogueContext): Promise<ReplaceParams | null> {
    const ruleBased = this.ruleBasedExtractReplace(context.userInput)
    if (ruleBased && !this.shouldRefineWithContext(context, 'replace', ruleBased.programName)) {
      return ruleBased
    }
    if (!ruleBased && !this.hasExplicitTargetTimeHint(context)) {
      return null
    }

    try {
      const response = await this.llmClient.chat(
        [
          {
            role: 'system',
            content:
              '你是广播电视节目串联单命令参数提取器。请结合当前编单候选和目标时间附近节目，从用户输入中提取 targetTime 和 replacementProgramName，并且只返回 JSON。如果用户没有明确提到时间，不要猜测 targetTime。',
          },
          {
            role: 'user',
            content:
              `用户指令: ${context.userInput}\n` +
              this.buildContextPrompt(context) +
              '输出格式: {"targetTime":"10:00:00","replacementProgramName":"中国考古报道"}',
          },
        ],
        { temperature: 0, maxTokens: 120 },
      )

      const match = response.content.match(/\{[\s\S]*\}/)
      if (!match) return ruleBased ?? null
      const parsed = JSON.parse(match[0]) as {
        targetTime?: string
        replacementProgramName?: string
        programName?: string
      }
      const programName = parsed.replacementProgramName ?? parsed.programName
      if (!parsed.targetTime || !programName) return ruleBased ?? null
      const normalizedTargetTime = this.normalizeTime(parsed.targetTime)
      if (!normalizedTargetTime) return ruleBased ?? null
      const extracted = {
        targetTime: normalizedTargetTime,
        programName: programName.trim(),
      }
      return extracted
    } catch {
      return ruleBased ?? null
    }
  }

  private ruleBasedExtractInsert(userInput: string): InsertParams | null {
    const normalized = userInput.replace(/\s+/g, '')
    const timeMatch =
      normalized.match(/在?(\d{1,2})点(?:(\d{1,2})分)?/) ||
      normalized.match(/在?(\d{1,2})[:：](\d{2})/)
    const insertVerbMatched = /(?:插入节目|插入|插个|插一|添加节目|安排节目|加一条|加个节目|插个节目|来个|来一条|来一档|放个|上个)/.test(normalized)
    const programMatch = normalized.match(/(?:插入节目|插入|插个|插一|添加节目|安排节目|加一条|加个节目|插个节目|来个|来一条|来一档|放个|上个)(.*)$/)

    if (!timeMatch || !insertVerbMatched) return null

    const normalizedTargetTime = this.normalizeTime(`${timeMatch[1] ?? '09'}:${timeMatch[2] ?? '00'}`)
    if (!normalizedTargetTime) return null

    return this.normalizeInsertParams({
      targetTime: normalizedTargetTime,
      rawProgramText: programMatch?.[1],
    })
  }

  private ruleBasedExtractMove(userInput: string): MoveParams | null {
    const normalized = userInput.replace(/\s+/g, '')
    if (!/(移动|后移|前移|顺延|延后|提前)/.test(normalized)) return null

    const timeMatch = this.findTimeExpression(normalized)
    const offset = this.extractOffsetFromNormalized(normalized)
    if (!timeMatch || !offset) return null

    return {
      targetTime: timeMatch.targetTime,
      direction: offset.direction,
      offsetSeconds: offset.offsetSeconds,
    }
  }

  private ruleBasedExtractDelete(userInput: string): DeleteParams | null {
    const normalized = userInput.replace(/\s+/g, '')
    if (!/(删除|删掉|移除|去掉)/.test(normalized)) return null

    const timeMatch = this.findTimeExpression(normalized)
    if (!timeMatch) return null

    const quotedProgramName = normalized.match(/《([^》]+)》/)?.[1]?.trim()
    const programFragment = quotedProgramName
      ?? this.normalizeProgramSelection(normalized.slice(timeMatch.index + timeMatch.matchedText.length))
      ?? this.normalizeProgramSelection(normalized.slice(0, timeMatch.index).replace(/^(?:删除|删掉|移除|去掉)/, ''))

    return {
      targetTime: timeMatch.targetTime,
      programName: programFragment,
    }
  }

  private ruleBasedExtractReplace(userInput: string): ReplaceParams | null {
    const normalized = userInput.replace(/\s+/g, '')
    const timeMatch = this.findTimeExpression(normalized)
    const replacementMatch = normalized.match(/(?:替换成|替换为|换成|改成|改为)(.+)$/)
    if (!timeMatch || !replacementMatch?.[1]) return null

    const replacementProgramName = this.normalizeProgramSelection(replacementMatch[1])
    if (!replacementProgramName) return null

    return {
      targetTime: timeMatch.targetTime,
      programName: replacementProgramName,
    }
  }

  private findTimeExpression(normalized: string): { targetTime: string; matchedText: string; index: number } | null {
    const patterns = [
      /(\d{1,2})[:：](\d{2})/,
      /(\d{1,2})点半/,
      /(\d{1,2})点(?:(\d{1,2})分?)?/,
    ]

    for (const pattern of patterns) {
      const match = pattern.exec(normalized)
      if (!match?.[0] || typeof match.index !== 'number') continue
      if (pattern.source.includes('点半')) {
        const targetTime = this.normalizeTime(`${match[1]}:30`)
        if (!targetTime) continue
        return {
          targetTime,
          matchedText: match[0],
          index: match.index,
        }
      }

      const targetTime = this.normalizeTime(`${match[1]}:${match[2] ?? '00'}`)
      if (!targetTime) continue
      return {
        targetTime,
        matchedText: match[0],
        index: match.index,
      }
    }

    return null
  }

  private extractOffsetFromNormalized(normalized: string): { direction: 'forward' | 'backward'; offsetSeconds: number } | null {
    const hourOffsetMatch =
      normalized.match(/([前后])移(\d{1,2})小时/) ||
      normalized.match(/(提前|延后|顺延)(\d{1,2})小时/)
    if (hourOffsetMatch) {
      const directionToken = hourOffsetMatch[1] ?? ''
      return {
        direction: directionToken === '前' || directionToken === '提前' ? 'backward' : 'forward',
        offsetSeconds: Number(hourOffsetMatch[2] ?? '1') * 3600,
      }
    }

    const minuteOffsetMatch =
      normalized.match(/([前后])移(\d{1,2})分钟/) ||
      normalized.match(/(提前|延后|顺延)(\d{1,2})分钟/)
    if (minuteOffsetMatch) {
      const directionToken = minuteOffsetMatch[1] ?? ''
      return {
        direction: directionToken === '前' || directionToken === '提前' ? 'backward' : 'forward',
        offsetSeconds: Number(minuteOffsetMatch[2] ?? '1') * 60,
      }
    }

    return null
  }

  private normalizeProgramSelection(value?: string): string | undefined {
    if (!value) return undefined
    const normalized = value
      .replace(/[，。！？!?]/g, '')
      .replace(/^(?:的|节目|栏目|补充说明[:：]?|要删除的|删除的|这条|那条|这个|那个)+/, '')
      .replace(/(?:补充说明[:：]?)+$/g, '')
      .trim()
    if (!normalized) return undefined
    if (/^(节目|栏目|这条|那条|这个节目|那个节目|补充说明[:：]?)$/.test(normalized)) return undefined
    return this.normalizeProgramName(normalized)
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
      return hasTimeHints || hasNearbyItems || hasProgramHint
    }

    if (intentType === 'insert') {
      return hasProgramHint || hasTimeHints
    }

    return hasTimeHints && hasNearbyItems
  }

  private hasExplicitTargetTimeHint(context: DialogueContext): boolean {
    return context.targetTimeHints.length > 0
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
      }
    }

    if (rawProgramText && !this.isGenericProgramRequest(rawProgramText)) {
      return {
        targetTime,
        programName: rawProgramText,
        rawProgramText,
        semanticLabel,
        programTypeHint,
      }
    }

    return {
      targetTime,
      rawProgramText,
      semanticLabel,
      programTypeHint,
    }
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
      .replace(/^(适合的|合适的|当前的)/, '')
      .replace(/^(节目名|节目|栏目|我要|我想要|想要|我想看|想看|要看|来个|来一条|来一档|放个|上个)\s*/, '')
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
    return /^(新闻|资讯|电视剧|剧场|综艺|纪录片|纪实|少儿|动画|评论|访谈|养生|健康|娱乐|电影|短剧)(节目|栏目|内容)?$/.test(normalized)
  }

  private inferProgramTypeHint(value?: string): string | undefined {
    if (!value) return undefined
    const normalized = value.replace(/\s+/g, '')
    const mappings: Array<{ pattern: RegExp; type: string }> = [
      { pattern: /(新闻|快报|联播)/, type: 'news' },
      { pattern: /(资讯|观察|Eye)/i, type: 'news_magazine' },
      { pattern: /(电视剧|剧场|短剧|剧情)/, type: 'drama' },
      { pattern: /(综艺|娱乐)/, type: 'entertainment' },
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
      if (/(资讯|观察|Eye)/i.test(normalized)) return '资讯'
      if (/(电视剧|剧场|短剧|剧情)/.test(normalized)) return '剧场'
      if (/(综艺|娱乐)/.test(normalized)) return '娱乐'
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
