import type { ChatMessage } from '@/types/llm'
import type { GapInfo, GenerationContext, PlanningStrategy } from '@/types/orchestration'
import type { LLMClient } from './llm/llmClient'

export interface GapPlanningThought {
  summary: string
  targetProgramTypes: string[]
  targetSlotLabel?: string
  preferredProgramGroup?: string
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
    const layoutMatch = this.findLayoutMatch(gap, context)
    const shouldLockToLayout = Boolean(layoutMatch && !layoutMatch.isWeakConstraint)

    if (shouldLockToLayout) {
      return fallback
    }

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

  private buildPrompt(
    gap: GapInfo,
    strategy: PlanningStrategy,
    context: GenerationContext,
  ): ChatMessage[] {
    const layoutSummary = (context.layoutReference?.slots ?? [])
      .slice(0, 10)
      .map((slot) => {
        const slotName = slot.slotLabel ?? slot.columnName ?? slot.programType
        return `${slot.startTime}-${slot.endTime} ${slotName}${slot.fixedProgram ? ` / 参考节目 ${slot.fixedProgram}` : ''}`
      })
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
          '你是电视节目串联单编排策略助手。你的任务不是直接给出节目单，而是根据频道、版面参考和空窗生成结构化编排想法。' +
          '版面中的栏目/时段只是参考，不是排入后的持续约束。请只返回 JSON。',
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
          '输出格式: {"summary":"...","targetProgramTypes":["news"],"targetSlotLabel":"早间资讯带","preferredProgramGroup":"看东方","durationPreference":{"min":1200,"max":3600},"searchKeywords":["早间","新闻"],"allowFiller":false,"sequentialPreference":true}',
      },
    ]
  }

  private buildFallbackThought(
    gap: GapInfo,
    strategy: PlanningStrategy,
    context: GenerationContext,
  ): GapPlanningThought {
    const layoutMatch = this.findLayoutMatch(gap, context)

    const inferredTypes =
      layoutMatch?.preferredProgramTypes?.length
        ? layoutMatch.preferredProgramTypes
        : layoutMatch?.programType
          ? [layoutMatch.programType]
          : context.channel.channelId === 'dragon'
            ? ['news', 'news_magazine', 'documentary', 'drama']
            : gap.constraints.allowedTypes ?? ['news', 'variety']

    const slotLabel = layoutMatch?.slotLabel ?? layoutMatch?.columnName
    const preferredProgramGroup =
      layoutMatch?.preferredProgramGroup ?? layoutMatch?.fixedProgram ?? layoutMatch?.columnName
    const searchKeywords =
      layoutMatch?.preferredKeywords?.length
        ? layoutMatch.preferredKeywords
        : layoutMatch?.editorialBias?.length
          ? [...layoutMatch.editorialBias, slotLabel ?? context.channel.channelName]
          : [context.channel.channelName, ...inferredTypes]

    return {
      summary: `优先命中${context.channel.channelName}${slotLabel ? `版面参考时段 ${slotLabel}` : '当前时段'}，再按时长接近、类型匹配和关键词相近去检索节目。`,
      targetProgramTypes: inferredTypes,
      targetSlotLabel: slotLabel,
      preferredProgramGroup,
      durationPreference: {
        min: Math.max(60, Math.floor(gap.duration * 0.5)),
        max: gap.duration,
      },
      searchKeywords,
      allowFiller: strategy.allowFiller,
      sequentialPreference: strategy.sequentialPreference,
    }
  }

  private findLayoutMatch(gap: GapInfo, context: GenerationContext) {
    return (context.layoutReference?.slots ?? []).find((slot) => {
      const gapStart = new Date(gap.startTime).getTime()
      const slotStart = new Date(slot.startTime).getTime()
      const slotEnd = new Date(slot.endTime).getTime()
      return gapStart >= slotStart && gapStart < slotEnd
    })
  }

  private parseThought(content: string): GapPlanningThought | null {
    try {
      const match = content.match(/\{[\s\S]*\}/)
      if (!match) return null
      const parsed = JSON.parse(match[0]) as Partial<GapPlanningThought>
      if (!parsed.summary || !parsed.durationPreference) return null
      return {
        summary: parsed.summary,
        targetProgramTypes: parsed.targetProgramTypes ?? [],
        targetSlotLabel: parsed.targetSlotLabel,
        preferredProgramGroup: parsed.preferredProgramGroup,
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

export function getOrchestrationStrategyService(
  llmClient: LLMClient,
): OrchestrationStrategyService {
  if (!globalOrchestrationStrategyService) {
    globalOrchestrationStrategyService = new OrchestrationStrategyService(llmClient)
  }
  return globalOrchestrationStrategyService
}
