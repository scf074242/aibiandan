import {
  getOrchestrationDemoColumn,
  getOrchestrationDemoInstancesByColumn,
  getOrchestrationDemoProgramsByColumn,
} from '@/mock/orchestrationMock'
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
    const columnInstances = columnId
      ? getOrchestrationDemoInstancesByColumn(context.channel.channelId, columnId)
      : []
    const columnPrograms = columnId
      ? getOrchestrationDemoProgramsByColumn(context.channel.channelId, columnId)
      : []

    return {
      targetTimeRange: { start: gap.startTime, end: gap.endTime },
      expectedDuration: this.resolveExpectedDuration(gap, thought, columnId, context.channel.channelId),
      channelId: context.channel.channelId,
      columnId: columnId ?? '',
      programTypePreference:
        thought.targetProgramTypes.length > 0
          ? thought.targetProgramTypes
          : columnInstances.length > 0
            ? Array.from(new Set(columnPrograms.map((program) => program.programType)))
            : gap.constraints.allowedTypes,
      excludeUsed: true,
    }
  }

  private resolveExpectedDuration(
    gap: GapInfo,
    thought: GapPlanningThought,
    columnId?: string,
    channelId?: string,
  ): CandidateQueryCriteria['expectedDuration'] {
    const columnInstances =
      columnId && channelId
        ? getOrchestrationDemoInstancesByColumn(channelId, columnId)
        : []

    if (columnInstances.length > 0) {
      const durations = columnInstances.map((item) => item.duration)
      return {
        min: Math.min(...durations),
        max: Math.min(gap.duration, Math.max(...durations)),
      }
    }

    const preferredTypes = thought.targetProgramTypes.length > 0 ? thought.targetProgramTypes : []

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
