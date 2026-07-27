import type { LLMClient } from './llm/llmClient'
import type { DialogueContext } from './dialogueContext'
import { STAGE_TIMEOUT_BUDGET } from '@/services/agent/agentDeadline'

/**
 * intentRecognizer prompt 版本号（对齐 AGENTS.md Prompt 版本管理门禁）
 * - v1.0：初始版本
 */
export const INTENT_RECOGNIZER_PROMPT_VERSION = 'v1.0' as const

export type MicroEditIntentType =
  | 'insert'
  | 'move'
  | 'delete'
  | 'replace'
  | 'unsupported'
  | 'clarify'

export interface MicroEditIntent {
  type: MicroEditIntentType
  confidence: number
  reasoning: string
}

export class IntentRecognizer {
  constructor(private llmClient: LLMClient) {}

  async recognize(context: DialogueContext): Promise<MicroEditIntent> {
    try {
      const response = await this.llmClient.chat(
        [
          {
            role: 'system',
            content:
              `[prompt ${INTENT_RECOGNIZER_PROMPT_VERSION}] 你是广播节目串联单的微调意图识别器。只识别 insert、move、delete、replace、unsupported、clarify 六类意图，并且只返回 JSON。请结合当前编单候选和目标时间附近节目理解用户指代，不要凭空假设不存在的节目。`,
          },
          {
            role: 'user',
            content:
              `用户指令: ${context.userInput}\n` +
              `频道: ${context.scheduleState.channelName}\n` +
              `日期: ${context.scheduleState.date}\n` +
              `当前节目单摘要:\n${context.scheduleSummary}\n` +
              `当前节目名候选:\n${context.scheduleNameCandidates}\n` +
              `目标时间提示: ${context.targetTimeHints.join('、') || '未识别到明确时间'}\n` +
              `目标时间附近节目:\n${context.nearbyScheduleSummary}\n` +
              '输出格式: {"type":"delete","confidence":0.95,"reasoning":"..."}',
          },
        ],
        { temperature: 0.1, maxTokens: 200, timeout: STAGE_TIMEOUT_BUDGET.intent_parse, maxRetries: 1, traceLabel: 'atomic_intent', promptVersion: INTENT_RECOGNIZER_PROMPT_VERSION },
      )

      const parsed = this.parseIntentResponse(response.content)
      if (!parsed) {
        return this.buildUnusableModelIntent()
      }

      return parsed
    } catch {
      return this.buildUnusableModelIntent()
    }
  }

  private buildUnusableModelIntent(): MicroEditIntent {
    return {
      type: 'clarify',
      confidence: 0,
      reasoning: '模型没有返回有效原子意图，已停止本地关键词兜底。',
    }
  }

  private parseIntentResponse(content: string): MicroEditIntent | null {
    try {
      const match = content.match(/\{[\s\S]*\}/)
      if (!match) return null
      const parsed = JSON.parse(match[0]) as MicroEditIntent
      if (!parsed.type || !parsed.reasoning) return null
      if (!['insert', 'move', 'delete', 'replace', 'unsupported', 'clarify'].includes(parsed.type)) {
        return null
      }
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
