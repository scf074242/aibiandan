import {
  getSchedulingAgentRuntimeFacade,
  summarizeRuntimeCommand,
  type RuntimeAnalysisContext,
  type RuntimeDecision,
  type RuntimeExecutePendingCommandInput,
  type RuntimeExecutedResult,
  type RuntimeFeedback,
  type RuntimeOrchestrationRequest,
  type RuntimePendingCommand,
  type RuntimeResolveInsertRecommendationInput,
  type RuntimeResolveTargetSelectionInput,
  type RuntimeScheduleItem,
  type RuntimeSubmitInput,
} from './schedulingAgentRuntimeFacade'

export {
  summarizeRuntimeCommand,
  type RuntimeAnalysisContext,
  type RuntimeDecision,
  type RuntimeExecutedResult,
  type RuntimeFeedback,
  type RuntimeOrchestrationRequest,
  type RuntimePendingCommand,
  type RuntimeScheduleItem,
}

export interface AgentRuntimeClient {
  submitInstruction(input: RuntimeSubmitInput): Promise<RuntimeDecision>
  executePendingCommand(input: RuntimeExecutePendingCommandInput): Promise<RuntimeExecutedResult>
  resolvePendingTargetSelection(input: RuntimeResolveTargetSelectionInput): Promise<RuntimeDecision>
  resolvePendingInsertRecommendation(input: RuntimeResolveInsertRecommendationInput): Promise<RuntimeDecision>
}

class LocalAgentRuntimeClient implements AgentRuntimeClient {
  private readonly runtime = getSchedulingAgentRuntimeFacade()

  submitInstruction(input: RuntimeSubmitInput): Promise<RuntimeDecision> {
    return this.runtime.submitInstruction(input)
  }

  executePendingCommand(input: RuntimeExecutePendingCommandInput): Promise<RuntimeExecutedResult> {
    return this.runtime.executePendingCommand(input)
  }

  resolvePendingTargetSelection(input: RuntimeResolveTargetSelectionInput): Promise<RuntimeDecision> {
    return this.runtime.resolvePendingTargetSelection(input)
  }

  resolvePendingInsertRecommendation(input: RuntimeResolveInsertRecommendationInput): Promise<RuntimeDecision> {
    return this.runtime.resolvePendingInsertRecommendation(input)
  }
}

let globalAgentRuntimeClient: AgentRuntimeClient | null = null

export function getAgentRuntimeClient(): AgentRuntimeClient {
  if (!globalAgentRuntimeClient) {
    globalAgentRuntimeClient = new LocalAgentRuntimeClient()
  }
  return globalAgentRuntimeClient
}

export function setAgentRuntimeClientForTests(client: AgentRuntimeClient | null): void {
  globalAgentRuntimeClient = client
}
