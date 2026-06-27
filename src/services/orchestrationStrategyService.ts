import { getEffectiveColumnDefinition } from './orchestration/runtimeLayoutRegistry'
import type { DraftSegmentSelectionPolicy, GapInfo, GenerationContext, PlanningStrategy } from '@/types/orchestration'
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
  selectionPolicy?: DraftSegmentSelectionPolicy
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
    const rangeText = this.formatRange(gap.startTime, gap.endTime)
    const summary = column
      ? `\u7a7a\u7a97 ${rangeText} \u5df2\u547d\u4e2d\u680f\u76ee ${column.columnName}\uff0c\u5c06\u6309\u680f\u76ee\u8282\u76ee\u5b9e\u4f8b\u8fdb\u884c\u67e5\u8be2\u3002`
      : `\u7a7a\u7a97 ${rangeText} \u672a\u547d\u4e2d\u680f\u76ee\uff0c\u5c06\u6309\u7c7b\u578b\u8fdb\u884c\u4fdd\u5b88\u67e5\u8be2\u3002`

    return {
      summary,
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
      selectionPolicy: column?.selectionPolicy,
    }
  }

  private buildSearchKeywords(
    queryHints: string[] | undefined,
    slotLabel: string | undefined,
    inferredTypes: string[],
  ): string[] {
    const typeFallbackMap: Record<string, string[]> = {
      drama: ['\u7535\u89c6\u5267', '\u5267\u573a'],
      news: ['\u65b0\u95fb'],
      news_magazine: ['\u8d44\u8baf', '\u680f\u76ee'],
      commentary: ['\u8bc4\u8bba', '\u89c2\u5bdf'],
      health: ['\u5065\u5eb7', '\u517b\u751f'],
      entertainment: ['\u5a31\u4e50', '\u7efc\u827a'],
      kids: ['\u5c11\u513f', '\u52a8\u753b'],
      documentary: ['\u7eaa\u5f55\u7247', '\u7eaa\u5b9e'],
    }

    const keywords = new Set<string>()
    ;(queryHints ?? []).forEach((keyword) => {
      const normalized = keyword.trim()
      if (normalized) {
        keywords.add(normalized)
      }
    })

    const normalizedLabel = slotLabel?.trim()
    const hasExplicitHints = (queryHints ?? []).some((keyword) => keyword.trim())
    const hasStructuredEditorialHints = (queryHints ?? []).some((keyword) =>
      /(?:所属|属于)?栏目(?:名称|名)?|(?:节目)?标题|(?:节目)?内容/u.test(keyword),
    )
    if (normalizedLabel && !hasStructuredEditorialHints && (hasExplicitHints || /[\u4e00-\u9fa5]/u.test(normalizedLabel))) {
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
