import type { RuntimeAtomicAction, RuntimeAtomicSlotBag } from './pendingAtomicContext'
import type { RuntimePlaylistPolicy } from './playlistPolicy'

export type SchedulingTaskStageType = 'batch_atomic' | 'atomic' | 'draft_refill' | 'verify' | 'ask_user'
export type SchedulingTaskStageStatus = 'pending' | 'waiting_confirm' | 'running' | 'completed' | 'blocked' | 'cancelled'
export type SchedulingTaskRunStatus = 'draft' | 'waiting_confirm' | 'running' | 'completed' | 'blocked' | 'cancelled'

export interface SchedulingTaskLimits {
  maxStages: number
  maxStepsPerStage: number
  maxLoopTurns: number
  maxAutoExecutePerLoop: number
  maxMatchedItemsBeforeNarrowing: number
}

export interface SchedulingTaskAtomicStep {
  id: string
  action: RuntimeAtomicAction
  itemId?: string
  candidateId?: string
  candidateCode?: string
  candidateProgramType?: string
  durationSeconds?: number
  targetTime?: string
  newStartTime?: string
  programName?: string
  slots?: RuntimeAtomicSlotBag
}

export interface SchedulingTaskVerification {
  type: 'program_absent' | 'batch_progress' | 'gaps_handled' | 'time_axis_valid' | 'rotation_duration_balance'
  programName?: string
  expectedRemaining?: number
  targetDurationSeconds?: number
}

export interface SchedulingTaskStage {
  id: string
  type: SchedulingTaskStageType
  status: SchedulingTaskStageStatus
  summary: string
  action?: RuntimeAtomicAction
  requiresConfirmation: boolean
  requiresLayoutDraft?: boolean
  steps?: SchedulingTaskAtomicStep[]
  verification?: SchedulingTaskVerification
}

export interface SchedulingTaskRun {
  id: string
  goal: string
  originalUserInput: string
  playlistPolicy?: RuntimePlaylistPolicy
  status: SchedulingTaskRunStatus
  currentStageIndex: number
  loopCount: number
  limits: SchedulingTaskLimits
  stages: SchedulingTaskStage[]
  batch?: {
    strategy: 'chunked'
    matchKind: 'program' | 'time_range'
    targetLabel: string
    totalMatched: number
    processedCount: number
    remainingCount: number
    batchSize: number
    batchIndex: number
    includeDraftRefillAfterFinalBatch?: boolean
  }
  createdAt: string
  updatedAt: string
}

export const DEFAULT_SCHEDULING_TASK_LIMITS: SchedulingTaskLimits = {
  maxStages: 5,
  maxStepsPerStage: 10,
  maxLoopTurns: 5,
  maxAutoExecutePerLoop: 5,
  maxMatchedItemsBeforeNarrowing: 30,
}

export const isSchedulingTaskConfirmationOpen = (task?: SchedulingTaskRun | null): boolean =>
  task?.status === 'waiting_confirm'
  && task.stages.some((stage) => stage.status === 'waiting_confirm')
