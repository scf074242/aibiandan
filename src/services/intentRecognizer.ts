import type { LLMClient } from './llm/llmClient'
import type { DialogueContext } from './dialogueContext'

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
    const ruleBased = this.ruleBasedRecognize(context.userInput)
    if (!this.shouldUseContextualReview(context, ruleBased)) {
      return ruleBased
    }

    try {
      const response = await this.llmClient.chat(
        [
          {
            role: 'system',
            content:
              '你是广播节目串联单的微调意图识别器。只识别 insert、move、delete、replace、unsupported、clarify 六类意图，并且只返回 JSON。请结合当前编单候选和目标时间附近节目理解用户指代，不要凭空假设不存在的节目。',
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
        { temperature: 0.1, maxTokens: 200 },
      )

      const parsed = this.parseIntentResponse(response.content)
      if (!parsed) {
        return ruleBased
      }

      const ruleBasedActionable = ['insert', 'move', 'delete', 'replace'].includes(ruleBased.type)
      const parsedActionable = ['insert', 'move', 'delete', 'replace'].includes(parsed.type)

      if (ruleBasedActionable && !parsedActionable) {
        return ruleBased
      }

      return parsed
    } catch {
      return ruleBased
    }
  }

  private shouldUseContextualReview(context: DialogueContext, ruleBased: MicroEditIntent): boolean {
    if (ruleBased.type === 'unsupported' || ruleBased.type === 'clarify') {
      return true
    }

    const hasSchedule = context.currentSchedule.length > 0
    const hasTimeHints = context.targetTimeHints.length > 0
    const hasNearbyItems =
      context.nearbyScheduleSummary !== '当前节目单为空，没有可参考的附近节目。'
      && context.nearbyScheduleSummary !== '未从用户输入中识别到明确时间点。'
    const isHighRiskIntent = ruleBased.type === 'delete' || ruleBased.type === 'replace'

    return hasSchedule && (isHighRiskIntent || hasTimeHints || hasNearbyItems)
  }

  private ruleBasedRecognize(userInput: string): MicroEditIntent {
    const normalized = userInput.replace(/\s+/g, '')
    const hasInsertVerb = /(插入|加一条|添加节目|安排节目)/.test(normalized)
    const hasMoveVerb = /(移动|后移|前移|顺延|延后|提前)/.test(normalized)
    const hasDeleteVerb = /(删除|删掉|去掉|移除)/.test(normalized)
    const hasReplaceVerb = /(换成|替换成|改成|替换为|改为)/.test(normalized)
    const hasProgramCue = /(节目|看东方|电视剧|新闻|栏目|午间30|中国考古)/.test(normalized)

    if (hasDeleteVerb && hasProgramCue) {
      return {
        type: 'delete',
        confidence: 0.97,
        reasoning: '用户表达了删除某个已编排节目的微调需求。',
      }
    }

    if (hasReplaceVerb && hasProgramCue) {
      return {
        type: 'replace',
        confidence: 0.96,
        reasoning: '用户表达了将某个已编排节目替换成另一档节目的微调需求。',
      }
    }

    if (hasMoveVerb && hasProgramCue) {
      return {
        type: 'move',
        confidence: 0.95,
        reasoning: '用户表达了对某个时间点节目进行前移或后移的微调需求。',
      }
    }

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
      reasoning: '当前输入不属于首批已支持的插入、移动、删除或替换命令。',
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
