import type { LLMClient } from './llm/llmClient'
import type { DialogueContext } from './dialogueContext'

export interface InsertParams {
  targetTime: string
  programName: string
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
    if (ruleBased) return ruleBased

    try {
      const response = await this.llmClient.chat(
        [
          {
            role: 'system',
            content:
              '你是广播电视节目串联单命令参数提取器。请从用户输入中提取 targetTime 和 programName，并且只返回 JSON。',
          },
          {
            role: 'user',
            content:
              `用户指令: ${context.userInput}\n` +
              '输出格式: {"targetTime":"09:00:00","programName":"看东方"}',
          },
        ],
        { temperature: 0, maxTokens: 120 },
      )

      const match = response.content.match(/\{[\s\S]*\}/)
      if (!match) return null
      const parsed = JSON.parse(match[0]) as Partial<InsertParams>
      if (!parsed.targetTime || !parsed.programName) return null
      return {
        targetTime: this.normalizeTime(parsed.targetTime),
        programName: parsed.programName.trim(),
      }
    } catch {
      return null
    }
  }

  async extractMoveParams(context: DialogueContext): Promise<MoveParams | null> {
    const ruleBased = this.ruleBasedExtractMove(context.userInput)
    if (ruleBased) return ruleBased

    try {
      const response = await this.llmClient.chat(
        [
          {
            role: 'system',
            content:
              '你是广播电视节目串联单命令参数提取器。请从用户输入中提取 targetTime、direction 和 offsetSeconds，并且只返回 JSON。',
          },
          {
            role: 'user',
            content:
              `用户指令: ${context.userInput}\n` +
              '输出格式: {"targetTime":"22:00:00","direction":"forward","offsetSeconds":3600}',
          },
        ],
        { temperature: 0, maxTokens: 120 },
      )

      const match = response.content.match(/\{[\s\S]*\}/)
      if (!match) return null
      const parsed = JSON.parse(match[0]) as Partial<MoveParams>
      if (!parsed.targetTime || !parsed.direction || !parsed.offsetSeconds) return null
      return {
        targetTime: this.normalizeTime(parsed.targetTime),
        direction: parsed.direction === 'backward' ? 'backward' : 'forward',
        offsetSeconds: Math.max(60, Number(parsed.offsetSeconds)),
      }
    } catch {
      return null
    }
  }

  async extractDeleteParams(context: DialogueContext): Promise<DeleteParams | null> {
    const ruleBased = this.ruleBasedExtractDelete(context.userInput)
    if (ruleBased) return ruleBased

    try {
      const response = await this.llmClient.chat(
        [
          {
            role: 'system',
            content:
              '你是广播电视节目串联单命令参数提取器。请从用户输入中提取 targetTime 和可选 programName，并且只返回 JSON。',
          },
          {
            role: 'user',
            content:
              `用户指令: ${context.userInput}\n` +
              '输出格式: {"targetTime":"12:00:00","programName":"午间30"}',
          },
        ],
        { temperature: 0, maxTokens: 120 },
      )

      const match = response.content.match(/\{[\s\S]*\}/)
      if (!match) return null
      const parsed = JSON.parse(match[0]) as Partial<DeleteParams>
      if (!parsed.targetTime) return null
      return {
        targetTime: this.normalizeTime(parsed.targetTime),
        programName: parsed.programName?.trim(),
      }
    } catch {
      return null
    }
  }

  async extractReplaceParams(context: DialogueContext): Promise<ReplaceParams | null> {
    const ruleBased = this.ruleBasedExtractReplace(context.userInput)
    if (ruleBased) return ruleBased

    try {
      const response = await this.llmClient.chat(
        [
          {
            role: 'system',
            content:
              '你是广播电视节目串联单命令参数提取器。请从用户输入中提取 targetTime 和 replacementProgramName，并且只返回 JSON。',
          },
          {
            role: 'user',
            content:
              `用户指令: ${context.userInput}\n` +
              '输出格式: {"targetTime":"10:00:00","replacementProgramName":"中国考古报道"}',
          },
        ],
        { temperature: 0, maxTokens: 120 },
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
      return {
        targetTime: this.normalizeTime(parsed.targetTime),
        programName: programName.trim(),
      }
    } catch {
      return null
    }
  }

  private ruleBasedExtractInsert(userInput: string): InsertParams | null {
    const normalized = userInput.replace(/\s+/g, '')
    const timeMatch =
      normalized.match(/在?(\d{1,2})点(?:(\d{1,2})分)?/) ||
      normalized.match(/在?(\d{1,2})[:：](\d{2})/)
    const programMatch = normalized.match(/(?:插入节目|插入|添加节目|安排节目)(.+)$/)

    if (!timeMatch || !programMatch?.[1]) return null

    return {
      targetTime: this.normalizeTime(`${timeMatch[1] ?? '09'}:${timeMatch[2] ?? '00'}`),
      programName: programMatch[1].replace(/[，。？?]/g, '').trim(),
    }
  }

  private ruleBasedExtractMove(userInput: string): MoveParams | null {
    const normalized = userInput.replace(/\s+/g, '')
    const timeMatch =
      normalized.match(/(\d{1,2})点(?:(\d{1,2})分)?的节目/) ||
      normalized.match(/(\d{1,2})[:：](\d{2})的节目/)

    const hourOffsetMatch =
      normalized.match(/([前后])移(\d{1,2})小时/) ||
      normalized.match(/(提前|延后|顺延)(\d{1,2})小时/)
    const minuteOffsetMatch =
      normalized.match(/([前后])移(\d{1,2})分钟/) ||
      normalized.match(/(提前|延后|顺延)(\d{1,2})分钟/)

    if (!timeMatch) return null

    const hours = timeMatch[1] ?? '00'
    const minutes = timeMatch[2] ?? '00'

    if (hourOffsetMatch) {
      const directionToken = hourOffsetMatch[1] ?? ''
      return {
        targetTime: this.normalizeTime(`${hours}:${minutes}`),
        direction: directionToken === '前' || directionToken === '提前' ? 'backward' : 'forward',
        offsetSeconds: Number(hourOffsetMatch[2] ?? '1') * 3600,
      }
    }

    if (minuteOffsetMatch) {
      const directionToken = minuteOffsetMatch[1] ?? ''
      return {
        targetTime: this.normalizeTime(`${hours}:${minutes}`),
        direction: directionToken === '前' || directionToken === '提前' ? 'backward' : 'forward',
        offsetSeconds: Number(minuteOffsetMatch[2] ?? '1') * 60,
      }
    }

    return null
  }

  private ruleBasedExtractDelete(userInput: string): DeleteParams | null {
    const normalized = userInput.replace(/\s+/g, '')
    const timePatterns = [
      /(?:删除|删掉|移除)(\d{1,2})点半的?(.+)?/,
      /(?:删除|删掉|移除)(\d{1,2})点(?:(\d{1,2})分)?的?(.+)?/,
      /(?:删除|删掉|移除)(\d{1,2})[:：](\d{2})的?(.+)?/,
    ]

    for (const pattern of timePatterns) {
      const match = normalized.match(pattern)
      if (!match?.[1]) continue

      if (pattern.source.includes('点半')) {
        const programName = (match[2] || '').replace(/[，。？?]/g, '').replace(/节目/g, '').replace(/^的/, '').trim()
        return {
          targetTime: this.normalizeTime(`${match[1]}:30`),
          programName: programName || undefined,
        }
      }

      const minutes = match[2] ?? '00'
      const programName = (match[3] || '').replace(/[，。？?]/g, '').replace(/节目/g, '').replace(/^的/, '').trim()
      return {
        targetTime: this.normalizeTime(`${match[1]}:${minutes}`),
        programName: programName || undefined,
      }
    }

    return null
  }

  private ruleBasedExtractReplace(userInput: string): ReplaceParams | null {
    const normalized = userInput.replace(/\s+/g, '')
    const timeMatch =
      normalized.match(/把(\d{1,2})点(?:(\d{1,2})分)?的节目(?:换成|替换成|改成|替换为|改为)(.+)$/) ||
      normalized.match(/把(\d{1,2})[:：](\d{2})的节目(?:换成|替换成|改成|替换为|改为)(.+)$/)

    if (!timeMatch?.[1] || !timeMatch[3]) return null

    return {
      targetTime: this.normalizeTime(`${timeMatch[1]}:${timeMatch[2] ?? '00'}`),
      programName: timeMatch[3].replace(/[，。？?]/g, '').trim(),
    }
  }

  private normalizeTime(timeText: string): string {
    const match = timeText.match(/(\d{1,2})[:：]?(\d{2})?(?:[:：]?(\d{2}))?/) 
    if (!match) return '09:00:00'

    const hours = (match[1] ?? '09').padStart(2, '0')
    const minutes = (match[2] ?? '00').padStart(2, '0')
    const seconds = (match[3] ?? '00').padStart(2, '0')
    return `${hours}:${minutes}:${seconds}`
  }
}

let globalParamExtractor: ParamExtractor | null = null

export function getParamExtractor(llmClient: LLMClient): ParamExtractor {
  if (!globalParamExtractor) {
    globalParamExtractor = new ParamExtractor(llmClient)
  }
  return globalParamExtractor
}
