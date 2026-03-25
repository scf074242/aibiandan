import type { LLMClient } from './llm/llmClient'
import type { DialogueContext } from './dialogueContext'

export interface InsertParams {
  targetTime: string
  programName: string
}

export class ParamExtractor {
  constructor(private llmClient: LLMClient) {}

  async extractInsertParams(context: DialogueContext): Promise<InsertParams | null> {
    const ruleBased = this.ruleBasedExtract(context.userInput)
    if (ruleBased) {
      return ruleBased
    }

    try {
      const response = await this.llmClient.chat(
        [
          {
            role: 'system',
            content:
              '你是广电视节目串联单命令参数提取器。请从用户输入中提取 targetTime 和 programName，并只返回 JSON。',
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

  private ruleBasedExtract(userInput: string): InsertParams | null {
    const normalized = userInput.replace(/\s+/g, '')
    const timeMatch =
      normalized.match(/在(\d{1,2})点(\d{1,2})分?/) ||
      normalized.match(/在(\d{1,2})[:：](\d{2})/) ||
      normalized.match(/在(\d{1,2})点/)

    const programMatch = normalized.match(/(?:插入节目|插入|添加节目|安排节目)(.+)$/)

    if (!timeMatch || !programMatch?.[1]) {
      return null
    }

    const hours = timeMatch[1] ?? '09'
    const minutes = timeMatch[2] ?? '00'

    return {
      targetTime: this.normalizeTime(`${hours}:${minutes}`),
      programName: programMatch[1].replace(/到.+$/, '').trim(),
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
