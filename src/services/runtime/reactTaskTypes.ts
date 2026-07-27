export type ReactTaskStatus =
  | 'planning'
  | 'acting'
  | 'observing'
  | 'deciding'
  | 'waiting_confirm'
  | 'waiting_user'
  | 'completed'
  | 'failed'
  | 'cancelled'

export type ReactTaskObservationType =
  | 'asset_search'
  | 'draft_check'
  | 'formal_execution'
  | 'atomic_execution'
  | 'validation'
  | 'llm_failure'
  | 'runtime_failure'
  | 'user_feedback'

export interface ReactTaskLimits {
  maxTurns: number
  batchSize: number
}

export interface ReactTaskPlannerDraft<ActionDraft = unknown> {
  objective: string
  maxTurns?: number
  batchSize?: number
  stopCondition?: string
  nextActions: ActionDraft[]
}

export interface ReactTaskStep<ActionDraft = unknown> {
  id: string
  turn: number
  status: 'pending' | 'running' | 'observed' | 'blocked' | 'completed' | 'failed'
  action: ActionDraft
  reason?: string
}

export interface ReactTaskObservation {
  id: string
  turn: number
  type: ReactTaskObservationType
  summary: string
  data?: Record<string, unknown>
  risk?: string
  createdAt: string
}

export interface ReactTaskRun<ActionDraft = unknown> {
  id: string
  workspaceKey: string
  objective: string
  originalUserInput: string
  status: ReactTaskStatus
  loopCount: number
  limits: ReactTaskLimits
  stopCondition?: string
  steps: ReactTaskStep<ActionDraft>[]
  observations: ReactTaskObservation[]
  recovery?: {
    canRetry: boolean
    retryCount: number
    lastFailure?: string
  }
  createdAt: string
  updatedAt: string
}

export const DEFAULT_REACT_TASK_LIMITS: ReactTaskLimits = {
  maxTurns: 4,
  batchSize: 5,
}
