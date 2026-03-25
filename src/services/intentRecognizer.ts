import type { LLMClient } from './llm/llmClient'
import type { DialogueContext } from './dialogueContext'

export type MicroEditIntentType = 'insert' | 'unsupported' | 'clarify'

export interface MicroEditIntent {
  type: MicroEditIntentType
  confidence: number
  reasoning: string
}

export class IntentRecognizer {
  constructor(private llmClient: LLMClient) {}

  async recognize(context: DialogueContext): Promise<MicroEditIntent> {
    const ruleBased = this.ruleBasedRecognize(context.userInput)
    if (ruleBased.confidence >= 0.9) {
      return ruleBased
    }

    try {
      const response = await this.llmClient.chat(
        [
          {
            role: 'system',
            content:
              '你是广电视节目串联单的微调意图识别器。只识别 insert、unsupported、clarify 三类意图，并只返回 JSON。',
          },
          {
            role: 'user',
            content:
              `用户指令: ${context.userInput}\n` +
              `频道: ${context.scheduleState.channelName}\n` +
              `日期: ${context.scheduleState.date}\n` +
              `当前节目单摘要:\n${context.scheduleSummary}\n` +
              '输出格式: {"type":"insert","confidence":0.95,"reasoning":"..."}',
          },
        ],
        { temperature: 0.1, maxTokens: 200 },
      )

      const parsed = this.parseIntentResponse(response.content)
      return parsed ?? ruleBased
    } catch {
      return ruleBased
    }
  }

  private ruleBasedRecognize(userInput: string): MicroEditIntent {
    const normalized = userInput.replace(/\s+/g, '')
    const hasInsertVerb = /(插入|加一条|添加节目|安排节目)/.test(normalized)
    const hasProgramCue = /(节目|看东方|电视剧|新闻|栏目)/.test(normalized)

    if (hasInsertVerb && hasProgramCue) {
      return {
        type: 'insert',
        confidence: 0.94,
        reasoning: '用户表达了按时间插入指定节目的微调需求。',
      }
    }

    return {
      type: 'unsupported',
      confidence: 0.45,
      reasoning: '当前输入不属于首批已支持的插入节目命令。',
    }
  }

  private parseIntentResponse(content: string): MicroEditIntent | null {
    try {
      const match = content.match(/\{[\s\S]*\}/)
      if (!match) return null
      const parsed = JSON.parse(match[0]) as MicroEditIntent
      if (!parsed.type || !parsed.reasoning) return null
      if (!['insert', 'unsupported', 'clarify'].includes(parsed.type)) return null
      return parsed
    } catch {
      return null
    }
  }
}

let globalIntentRecognizer: IntentRecognizer | null = null

export function getIntentRecognizer(llmClient: LLMClient): IntentRecognizer {
  if (!globalIntentRecognizer) {
    globalIntentRecognizer = new IntentRecognizer(llmClient)
  }
  return globalIntentRecognizer
}
