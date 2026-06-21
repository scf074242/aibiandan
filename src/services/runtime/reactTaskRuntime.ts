import type { AgentPlannerAction } from '@/services/llm/agentPlanner'
import {
  DEFAULT_REACT_TASK_LIMITS,
  type ReactTaskLimits,
  type ReactTaskObservationType,
  type ReactTaskPlannerDraft,
  type ReactTaskRun,
  type ReactTaskStep,
} from './reactTaskTypes'

export interface StartReactTaskRunInput<ActionDraft = AgentPlannerAction> {
  originalUserInput: string
  plannerTask: ReactTaskPlannerDraft<ActionDraft>
  now?: string
}

export interface ReactTaskObservationInput<ActionDraft = AgentPlannerAction> {
  run: ReactTaskRun<ActionDraft>
  type?: ReactTaskObservationType
  summary: string
  data?: Record<string, unknown>
  risk?: string
}

export interface ContinueReactTaskInput<ActionDraft = AgentPlannerAction> {
  run: ReactTaskRun<ActionDraft>
  nextActions: ActionDraft[]
  reason?: string
  now?: string
}

const clampLimit = (value: number | undefined, fallback: number, min: number, max: number): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(min, Math.min(max, Math.floor(value)))
}

const createId = (prefix: string) => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

export class SchedulingReactTaskRuntime<ActionDraft = AgentPlannerAction> {
  startTask(input: StartReactTaskRunInput<ActionDraft>): ReactTaskRun<ActionDraft> {
    const now = input.now ?? new Date().toISOString()
    const limits: ReactTaskLimits = {
      maxTurns: clampLimit(input.plannerTask.maxTurns, DEFAULT_REACT_TASK_LIMITS.maxTurns, 1, 5),
      batchSize: clampLimit(input.plannerTask.batchSize, DEFAULT_REACT_TASK_LIMITS.batchSize, 1, 10),
    }
    const firstActions = input.plannerTask.nextActions.slice(0, limits.batchSize)
    const steps: ReactTaskStep<ActionDraft>[] = firstActions.map((action, index) => ({
      id: createId(`react_step_${index + 1}`),
      turn: 1,
      status: 'pending',
      action,
    }))

    return {
      id: createId('react_task'),
      objective: input.plannerTask.objective,
      originalUserInput: input.originalUserInput,
      status: steps.length ? 'acting' : 'waiting_user',
      loopCount: 0,
      limits,
      stopCondition: input.plannerTask.stopCondition,
      steps,
      observations: [],
      recovery: {
        canRetry: true,
        retryCount: 0,
      },
      createdAt: now,
      updatedAt: now,
    }
  }

  markObserved(
    run: ReactTaskRun<ActionDraft>,
    summary: string,
    data?: Record<string, unknown>,
  ): ReactTaskRun<ActionDraft> {
    return this.recordObservation({
      run,
      type: 'asset_search',
      summary,
      data,
    })
  }

  recordObservation(input: ReactTaskObservationInput<ActionDraft>): ReactTaskRun<ActionDraft> {
    const now = new Date().toISOString()
    const turn = input.run.loopCount + 1
    const observedStepIndex = input.run.steps.findIndex((step) => step.status === 'pending' || step.status === 'running')
    return {
      ...input.run,
      status: 'observing',
      loopCount: turn,
      steps: input.run.steps.map((step, index) => index === observedStepIndex ? { ...step, status: 'observed' } : step),
      observations: [
        ...input.run.observations,
        {
          id: createId('react_observation'),
          turn,
          type: input.type ?? 'asset_search',
          summary: input.summary,
          data: input.data,
          risk: input.risk,
          createdAt: now,
        },
      ],
      updatedAt: now,
    }
  }

  continueWithActions(input: ContinueReactTaskInput<ActionDraft>): ReactTaskRun<ActionDraft> {
    const now = input.now ?? new Date().toISOString()
    if (input.run.loopCount >= input.run.limits.maxTurns) {
      return this.markFailed(input.run, `已达到最多 ${input.run.limits.maxTurns} 轮处理上限。`, now)
    }
    const nextTurn = input.run.loopCount + 1
    const nextActions = input.nextActions.slice(0, input.run.limits.batchSize)
    if (!nextActions.length) {
      return {
        ...input.run,
        status: 'waiting_user',
        updatedAt: now,
      }
    }
    const steps: ReactTaskStep<ActionDraft>[] = nextActions.map((action, index) => ({
      id: createId(`react_step_${nextTurn}_${index + 1}`),
      turn: nextTurn,
      status: 'pending',
      action,
      reason: input.reason,
    }))
    return {
      ...input.run,
      status: 'acting',
      steps: [
        ...input.run.steps,
        ...steps,
      ],
      updatedAt: now,
    }
  }

  markCompleted(run: ReactTaskRun<ActionDraft>, now: string = new Date().toISOString()): ReactTaskRun<ActionDraft> {
    return {
      ...run,
      status: 'completed',
      recovery: {
        ...(run.recovery ?? { canRetry: false, retryCount: 0 }),
        canRetry: false,
      },
      updatedAt: now,
    }
  }

  markFailed(
    run: ReactTaskRun<ActionDraft>,
    lastFailure: string,
    now: string = new Date().toISOString(),
  ): ReactTaskRun<ActionDraft> {
    const retryCount = run.recovery?.retryCount ?? 0
    return {
      ...run,
      status: 'failed',
      recovery: {
        canRetry: retryCount < 1 && run.loopCount < run.limits.maxTurns,
        retryCount,
        lastFailure,
      },
      updatedAt: now,
    }
  }

  markRetry(run: ReactTaskRun<ActionDraft>, now: string = new Date().toISOString()): ReactTaskRun<ActionDraft> {
    const retryCount = (run.recovery?.retryCount ?? 0) + 1
    return {
      ...run,
      status: 'acting',
      recovery: {
        canRetry: false,
        retryCount,
        lastFailure: run.recovery?.lastFailure,
      },
      updatedAt: now,
    }
  }
}

let globalSchedulingReactTaskRuntime: SchedulingReactTaskRuntime | null = null

export function getSchedulingReactTaskRuntime(): SchedulingReactTaskRuntime {
  if (!globalSchedulingReactTaskRuntime) {
    globalSchedulingReactTaskRuntime = new SchedulingReactTaskRuntime()
  }
  return globalSchedulingReactTaskRuntime
}
