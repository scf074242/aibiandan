import type { ChatMessage } from '@/types/llm'
import type { GapInfo, GenerationContext, PlanningStrategy } from '@/types/orchestration'
import type { LLMClient } from './llm/llmClient'

export interface GapPlanningThought {
  summary: string
  targetProgramTypes: string[]
  durationPreference: {
    min: number
    max: number
  }
  searchKeywords: string[]
  allowFiller: boolean
  sequentialPreference: boolean
}

export class OrchestrationStrategyService {
  constructor(private llmClient: LLMClient) {}

  async planGap(
    gap: GapInfo,
    strategy: PlanningStrategy,
    context: GenerationContext,
  ): Promise<GapPlanningThought> {
    const fallback = this.buildFallbackThought(gap, strategy, context)

    try {
      const response = await this.llmClient.chat(this.buildPrompt(gap, strategy, context), {
        temperature: 0.2,
        maxTokens: 500,
      })

      const parsed = this.parseThought(response.content)
      return parsed ?? fallback
    } catch {
      return fallback
    }
  }

  private buildPrompt(gap: GapInfo, strategy: PlanningStrategy, context: GenerationContext): ChatMessage[] {
    const layoutSummary = (context.layoutReference?.slots ?? [])
      .slice(0, 8)
      .map((slot) => `${slot.startTime}-${slot.endTime} ${slot.programType}${slot.fixedProgram ? ` ${slot.fixedProgram}` : ''}`)
      .join('\n')

    const historySummary = (context.historyReference?.schedules ?? [])
      .slice(0, 4)
      .map((item) => `${item.date} itemCount=${item.itemCount} avgRating=${item.avgRating ?? 0}`)
      .join('\n')

    const fixedSummary = context.constraints.fixedItems
      .map((item) => `${item.startTime}-${item.endTime} ${item.programCode}${item.isLocked ? ' locked' : ''}`)
      .join('\n')

    return [
      {
        role: 'system',
        content:
          '你是广播电视节目串联单编排策略助手。你的任务不是直接给出节目，而是先针对单个空窗形成编排想法，再供系统生成候选检索命令。新闻综合频道默认优先新闻、资讯、民生、评论类节目，除非用户另行指定。请只返回 JSON。',
      },
      {
        role: 'user',
        content:
          `频道: ${context.channel.channelName}\n` +
          `日期: ${context.date}\n` +
          `全局策略: risk=${strategy.riskPreference}, allowFiller=${strategy.allowFiller}, sequential=${strategy.sequentialPreference}\n` +
          `当前空窗: ${gap.startTime} - ${gap.endTime}, duration=${gap.duration}\n` +
          `版面参考:\n${layoutSummary || '无'}\n` +
          `历史参考:\n${historySummary || '无'}\n` +
          `固定项:\n${fixedSummary || '无'}\n` +
          '输出格式: {"summary":"...","targetProgramTypes":["news"],"durationPreference":{"min":1200,"max":3600},"searchKeywords":["早间","新闻"],"allowFiller":false,"sequentialPreference":true}',
      },
    ]
  }

  private buildFallbackThought(gap: GapInfo, strategy: PlanningStrategy, context: GenerationContext): GapPlanningThought {
    const layoutMatch = (context.layoutReference?.slots ?? []).find((slot) => {
      const gapStart = new Date(gap.startTime).getTime()
      const slotStart = new Date(slot.startTime).getTime()
      const slotEnd = new Date(slot.endTime).getTime()
      return gapStart >= slotStart && gapStart < slotEnd
    })

    const inferredTypes = layoutMatch?.programType
      ? [layoutMatch.programType]
      : context.channel.channelId === 'news'
        ? ['news', 'news_magazine', 'livelihood']
        : gap.constraints.allowedTypes ?? ['news', 'variety']

    const defaultKeywords = context.channel.channelId === 'news'
      ? ['新闻', '资讯', '民生', '上海']
      : inferredTypes

    return {
      summary:
        context.channel.channelId === 'news'
          ? '基于新闻综合频道的默认编排倾向，优先选择新闻、新闻资讯、民生和评论类节目，再根据空窗时长筛选最匹配的真实节目。'
          : '基于版面参考和空窗时长的保守策略，优先选择类型匹配、时长接近的节目。',
      targetProgramTypes: inferredTypes,
      durationPreference: {
        min: Math.max(60, Math.floor(gap.duration * 0.5)),
        max: gap.duration,
      },
      searchKeywords: defaultKeywords,
      allowFiller: strategy.allowFiller,
      sequentialPreference: strategy.sequentialPreference,
    }
  }

  private parseThought(content: string): GapPlanningThought | null {
    try {
      const match = content.match(/\{[\s\S]*\}/)
      if (!match) return null
      const parsed = JSON.parse(match[0]) as GapPlanningThought
      if (!parsed.summary || !parsed.durationPreference) return null
      return {
        summary: parsed.summary,
        targetProgramTypes: parsed.targetProgramTypes ?? [],
        durationPreference: parsed.durationPreference,
        searchKeywords: parsed.searchKeywords ?? [],
        allowFiller: parsed.allowFiller ?? false,
        sequentialPreference: parsed.sequentialPreference ?? true,
      }
    } catch {
      return null
    }
  }
}

let globalOrchestrationStrategyService: OrchestrationStrategyService | null = null

export function getOrchestrationStrategyService(llmClient: LLMClient): OrchestrationStrategyService {
  if (!globalOrchestrationStrategyService) {
    globalOrchestrationStrategyService = new OrchestrationStrategyService(llmClient)
  }
  return globalOrchestrationStrategyService
}
