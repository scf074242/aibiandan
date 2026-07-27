export type AgentLlmStreamStage = 'intent_parse' | 'candidate_judge' | 'planner'

export interface AgentLlmStreamEvent {
  stage: AgentLlmStreamStage
  kind: 'first_token' | 'token_delta' | 'structured_complete' | 'structured_invalid'
  sequence: number
  receivedChars: number
  elapsedMs: number
  firstTokenLatencyMs?: number
}

export type AgentLlmStreamObserver = (event: AgentLlmStreamEvent) => void
