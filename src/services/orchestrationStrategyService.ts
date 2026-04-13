import { getEffectiveColumnDefinition } from './orchestration/runtimeLayoutRegistry'
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
  constructor(private llmClient: LLMClient) {
    void this.llmClient
  }

  async planGap(
    gap: GapInfo,
    strategy: PlanningStrategy,
    context: GenerationContext,
  ): Promise<GapPlanningThought> {
    return this.buildFallbackThought(gap, strategy, context)
  }

  private buildFallbackThought(
    gap: GapInfo,
    strategy: PlanningStrategy,
    context: GenerationContext,
  ): GapPlanningThought {
    const layoutMatch = this.findLayoutMatch(gap, context)
    const column = layoutMatch?.columnId ? getEffectiveColumnDefinition(layoutMatch.columnId) : undefined
    const inferredTypes =
      gap.constraints.allowedTypes?.length
        ? gap.constraints.allowedTypes
        : column?.defaultProgramType
          ? [column.defaultProgramType]
          : context.channel.channelId === 'dragon'
            ? ['news', 'news_magazine', 'drama']
            : ['news']

    return {
      summary: column
        ? `空窗 ${this.formatRange(gap.startTime, gap.endTime)} 已命中栏目 ${column.columnName}，将按栏目节目实例进行查询。`
        : `空窗 ${this.formatRange(gap.startTime, gap.endTime)} 未命中栏目，将按类型进行保守查询。`,
      targetProgramTypes: inferredTypes,
      targetSlotLabel: column?.columnName,
      preferredProgramGroup: undefined,
      durationPreference: {
        min: Math.max(60, Math.floor(gap.duration * 0.5)),
        max: gap.duration,
      },
      searchKeywords: this.buildSearchKeywords(column?.queryHints, column?.semanticLabel ?? column?.columnName, inferredTypes),
      allowFiller: strategy.allowFiller,
      sequentialPreference: strategy.sequentialPreference,
    }
  }

  private buildSearchKeywords(
    queryHints: string[] | undefined,
    slotLabel: string | undefined,
    inferredTypes: string[],
  ): string[] {
    const typeFallbackMap: Record<string, string[]> = {
      drama: ['电视剧', '剧场'],
      news: ['新闻'],
      news_magazine: ['资讯', '栏目'],
      commentary: ['评论', '观察'],
      health: ['健康', '养生'],
      entertainment: ['娱乐', '综艺'],
      kids: ['少儿', '动画'],
      documentary: ['纪录片', '纪实'],
    }

    const keywords = new Set<string>()
    ;(queryHints ?? []).forEach((keyword) => {
      const normalized = keyword.trim()
      if (normalized) {
        keywords.add(normalized)
      }
    })

    const normalizedLabel = slotLabel?.trim()
    if (normalizedLabel) {
      keywords.add(normalizedLabel)
    }

    inferredTypes.forEach((type) => {
      for (const keyword of typeFallbackMap[type] ?? []) {
        keywords.add(keyword)
      }
    })

    return Array.from(keywords)
  }

  private findLayoutMatch(gap: GapInfo, context: GenerationContext) {
    const gapStart = new Date(gap.startTime).getTime()
    const gapEnd = new Date(gap.endTime).getTime()

    return (context.layoutReference?.slots ?? [])
      .map((slot) => {
        const slotStart = new Date(slot.startTime).getTime()
        const slotEnd = new Date(slot.endTime).getTime()
        const overlap = Math.min(gapEnd, slotEnd) - Math.max(gapStart, slotStart)
        return { slot, overlap, slotStart }
      })
      .filter((entry) => entry.overlap > 0)
      .sort((left, right) => {
        if (right.overlap !== left.overlap) {
          return right.overlap - left.overlap
        }
        return left.slotStart - right.slotStart
      })[0]?.slot
  }

  private formatRange(startTime: string, endTime: string): string {
    const start = startTime.split('T')[1]?.slice(0, 8) || startTime
    const end = endTime.split('T')[1]?.slice(0, 8) || endTime
    return `${start}-${end}`
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
