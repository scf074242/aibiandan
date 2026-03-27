import { getOrchestrationDemoColumn } from '@/mock/orchestrationMock'
import type {
  CandidateQueryCriteria,
  GapInfo,
  GenerationContext,
  PlanningStrategy,
} from '@/types/orchestration'
import type { LLMClient } from './llm/llmClient'
import type { GapPlanningThought } from './orchestrationStrategyService'

export class QueryIntentService {
  constructor(private llmClient: LLMClient) {
    void this.llmClient
  }

  async generateCriteria(
    gap: GapInfo,
    thought: GapPlanningThought,
    context: GenerationContext,
    _strategy: PlanningStrategy,
    _userIntent?: string,
  ): Promise<CandidateQueryCriteria> {
    const layoutMatch = this.findLayoutMatch(gap, context)
    const columnId = layoutMatch?.columnId
    const column = columnId ? getOrchestrationDemoColumn(columnId) : undefined

    return {
      targetTimeRange: { start: gap.startTime, end: gap.endTime },
      expectedDuration: this.resolveExpectedDuration(gap, thought, column?.defaultProgramType),
      channelId: context.channel.channelId,
      columnId: columnId ?? '',
      programTypePreference:
        thought.targetProgramTypes.length > 0
          ? thought.targetProgramTypes
          : column?.defaultProgramType
            ? [column.defaultProgramType]
            : gap.constraints.allowedTypes,
      excludeUsed: true,
    }
  }

  private resolveExpectedDuration(
    gap: GapInfo,
    thought: GapPlanningThought,
    defaultProgramType?: string,
  ): CandidateQueryCriteria['expectedDuration'] {
    const preferredTypes = thought.targetProgramTypes.length > 0
      ? thought.targetProgramTypes
      : defaultProgramType
        ? [defaultProgramType]
        : []

    const isDramaLike = preferredTypes.includes('drama')
    if (!isDramaLike || gap.duration <= 3600) {
      return thought.durationPreference
    }

    return {
      min: 1200,
      max: Math.min(3600, gap.duration),
    }
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
}

let globalQueryIntentService: QueryIntentService | null = null

export function getQueryIntentService(llmClient: LLMClient): QueryIntentService {
  if (!globalQueryIntentService) {
    globalQueryIntentService = new QueryIntentService(llmClient)
  }
  return globalQueryIntentService
}
