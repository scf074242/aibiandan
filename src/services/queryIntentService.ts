import type { CandidateQueryCriteria, GapInfo, GenerationContext, PlanningStrategy } from '@/types/orchestration'
import type { LLMClient } from './llm/llmClient'
import type { GapPlanningThought } from './orchestrationStrategyService'
import { buildQueryIntentPrompt } from './orchestrationPromptBuilder'

export class QueryIntentService {
  constructor(private llmClient: LLMClient) {}

  async generateCriteria(
    gap: GapInfo,
    thought: GapPlanningThought,
    context: GenerationContext,
    strategy: PlanningStrategy,
    userIntent?: string,
  ): Promise<CandidateQueryCriteria> {
    const fallback = this.buildFallbackCriteria(gap, thought, context, strategy)

    try {
      const response = await this.llmClient.chat(
        buildQueryIntentPrompt({
          channelName: context.channel.channelName,
          channelId: context.channel.channelId,
          date: context.date,
          gap,
          planningThought: thought,
          userIntent,
        }),
        { temperature: 0.1, maxTokens: 420 },
      )

      const parsed = this.parseCriteria(response.content)
      return parsed ? { ...fallback, ...parsed } : fallback
    } catch {
      return fallback
    }
  }

  private buildFallbackCriteria(
    gap: GapInfo,
    thought: GapPlanningThought,
    context: GenerationContext,
    strategy: PlanningStrategy,
  ): CandidateQueryCriteria {
    return {
      targetTimeRange: { start: gap.startTime, end: gap.endTime },
      expectedDuration: thought.durationPreference,
      programTypePreference: thought.targetProgramTypes.length > 0 ? thought.targetProgramTypes : gap.constraints.allowedTypes,
      searchKeywords: thought.searchKeywords,
      preferredChannelId: context.channel.channelId,
      sequentialPreference: thought.sequentialPreference,
      excludeUsed: true,
      considerRatings: true,
      allowShortFiller: strategy.allowFiller && thought.allowFiller,
    }
  }

  private parseCriteria(content: string): Partial<CandidateQueryCriteria> | null {
    try {
      const match = content.match(/\{[\s\S]*\}/)
      if (!match) return null
      const parsed = JSON.parse(match[0]) as Partial<CandidateQueryCriteria>
      if (!parsed.expectedDuration || !parsed.targetTimeRange) return null
      return parsed
    } catch {
      return null
    }
  }
}

let globalQueryIntentService: QueryIntentService | null = null

export function getQueryIntentService(llmClient: LLMClient): QueryIntentService {
  if (!globalQueryIntentService) {
    globalQueryIntentService = new QueryIntentService(llmClient)
  }
  return globalQueryIntentService
}
