import {
  DemoRuntimeFacade,
  type RuntimeAnalysisContext,
  type RuntimeDecision,
  type RuntimeExecutedResult,
  type RuntimeExecutionPlan,
  type RuntimeFeedback,
  type RuntimeInsertRecommendationCandidate,
  type RuntimeOrchestrationRequest,
  type RuntimePendingAtomicClarification,
  type RuntimePendingCommand,
  type RuntimePendingInsertRecommendation,
  type RuntimePendingTargetSelection,
  type RuntimePlaylistFactPack,
  type RuntimeScheduleItem,
  type RuntimeSubmitInput,
  formatRuntimeOffset,
  requiresRuntimeCommandConfirmation,
  summarizeRuntimeCommand,
} from './demoRuntimeFacade'

export {
  formatRuntimeOffset,
  requiresRuntimeCommandConfirmation,
  summarizeRuntimeCommand,
  type RuntimeAnalysisContext,
  type RuntimeDecision,
  type RuntimeExecutedResult,
  type RuntimeExecutionPlan,
  type RuntimeFeedback,
  type RuntimeInsertRecommendationCandidate,
  type RuntimeOrchestrationRequest,
  type RuntimePendingAtomicClarification,
  type RuntimePendingCommand,
  type RuntimePendingInsertRecommendation,
  type RuntimePendingTargetSelection,
  type RuntimePlaylistFactPack,
  type RuntimeScheduleItem,
  type RuntimeSubmitInput,
}

export class SchedulingAgentRuntimeFacade extends DemoRuntimeFacade {}

let globalSchedulingAgentRuntimeFacade: SchedulingAgentRuntimeFacade | null = null

export function getSchedulingAgentRuntimeFacade(): SchedulingAgentRuntimeFacade {
  if (!globalSchedulingAgentRuntimeFacade) {
    globalSchedulingAgentRuntimeFacade = new SchedulingAgentRuntimeFacade()
  }
  return globalSchedulingAgentRuntimeFacade
}
