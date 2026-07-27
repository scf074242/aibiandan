import type { AgentDeadline } from '@/services/agent/agentDeadline'
import {
  buildRecoverableFailureEnvelope,
  type RecoverableFailureKind,
  type RecoverableInterpretationFailure,
} from '@/services/agent/recoverableFailureEnvelope'
import { SchedulingReactTaskRuntime, type ReactTaskObservationDraft } from './reactTaskRuntime'
import type { ReactTaskObservation, ReactTaskPlannerDraft, ReactTaskRun } from './reactTaskTypes'
import {
  compactFormalOrchestrationContext,
  type FormalOrchestrationCompactedContext,
  type FormalOrchestrationContextCompactionTrace,
} from './formalOrchestrationContextCompactor'
import {
  createFormalOrchestrationActionKey,
  type FormalOrchestrationResumePlan,
} from './formalOrchestrationRecovery'

export type FormalOrchestrationDecision<ActionDraft> =
  | { kind: 'continue'; nextActions: ActionDraft[]; reason: string }
  | { kind: 'complete'; reason: string }
  | { kind: 'unable_to_decide'; reason: string }

export interface FormalOrchestrationCheckpoint<ActionDraft> {
  id: string
  runId: string
  objective: string
  turn: number
  actions: ActionDraft[]
  observations: ReactTaskObservation[]
  decision: FormalOrchestrationDecision<ActionDraft> | { kind: 'cancelled' | 'act_failed' | 'decide_failed' | 'waiting_user'; reason: string }
  failureReason?: string
  contextCompaction?: FormalOrchestrationContextCompactionTrace
  createdAt: string
}

export interface FormalOrchestrationFailure {
  kind: 'empty_plan' | 'act_failed' | 'decide_failed' | 'unable_to_decide' | 'invalid_decision' | 'max_turns'
  message: string
  turn: number
  retrySuggestions: string[]
  envelope: RecoverableInterpretationFailure
}

export interface FormalOrchestrationRunResult<ActionDraft> {
  status: 'completed' | 'waiting_user' | 'failed' | 'cancelled'
  run: ReactTaskRun<ActionDraft>
  checkpoints: FormalOrchestrationCheckpoint<ActionDraft>[]
  completedActionCount: number
  failure?: FormalOrchestrationFailure
}

export interface FormalOrchestrationActorContext<ActionDraft> {
  run: ReactTaskRun<ActionDraft>
  turn: number
  actionIndex: number
  actionKey: string
  signal?: AbortSignal
}

export interface FormalOrchestrationDecideInput<ActionDraft> {
  objective: string
  originalUserInput: string
  run: ReactTaskRun<ActionDraft>
  turn: number
  observations: ReactTaskObservation[]
  checkpoints: FormalOrchestrationCheckpoint<ActionDraft>[]
  compactedContext: FormalOrchestrationCompactedContext<ActionDraft>
  signal?: AbortSignal
}

export interface FormalOrchestrationRuntimeOptions<ActionDraft> {
  actor: (action: ActionDraft, context: FormalOrchestrationActorContext<ActionDraft>) => Promise<ReactTaskObservationDraft>
  decide: (input: FormalOrchestrationDecideInput<ActionDraft>) => Promise<FormalOrchestrationDecision<ActionDraft>>
  taskRuntime?: SchedulingReactTaskRuntime<ActionDraft>
}

export interface FormalOrchestrationRunInput<ActionDraft> {
  workspaceKey: string
  originalUserInput: string
  plannerTask: ReactTaskPlannerDraft<ActionDraft>
  deadline?: AgentDeadline
  resumeFrom?: FormalOrchestrationResumePlan<ActionDraft>
  onCheckpoint?: (checkpoint: FormalOrchestrationCheckpoint<ActionDraft>, run: ReactTaskRun<ActionDraft>) => void
}

const createCheckpointId = (runId: string, turn: number, decisionKind: string) => `${runId}:checkpoint:${turn}:${decisionKind}`

export class FormalOrchestrationRuntime<ActionDraft> {
  private readonly actor: FormalOrchestrationRuntimeOptions<ActionDraft>['actor']
  private readonly decide: FormalOrchestrationRuntimeOptions<ActionDraft>['decide']
  private readonly taskRuntime: SchedulingReactTaskRuntime<ActionDraft>

  constructor(options: FormalOrchestrationRuntimeOptions<ActionDraft>) {
    this.actor = options.actor
    this.decide = options.decide
    this.taskRuntime = options.taskRuntime ?? new SchedulingReactTaskRuntime<ActionDraft>()
  }

  async run(input: FormalOrchestrationRunInput<ActionDraft>): Promise<FormalOrchestrationRunResult<ActionDraft>> {
    let run = input.resumeFrom
      ? this.restoreRun(input.originalUserInput, input.plannerTask, input.resumeFrom)
      : this.taskRuntime.startTask(input)
    const checkpoints: FormalOrchestrationCheckpoint<ActionDraft>[] = input.resumeFrom
      ? [...input.resumeFrom.checkpoints]
      : []
    let completedActionCount = input.resumeFrom
      ? input.resumeFrom.checkpoints.reduce((count, checkpoint) => count + checkpoint.observations.length, 0)
      : 0

    if (!run.steps.length) {
      return this.fail(run, checkpoints, completedActionCount, 'empty_plan', '初始计划没有可执行动作。')
    }

    while (run.status === 'acting') {
      const signal = input.deadline?.signal()
      if (signal?.aborted) return this.cancel(input, run, checkpoints, completedActionCount, [], [])

      const turn = run.loopCount + 1
      const pendingSteps = run.steps.filter((step) => step.turn === turn && step.status === 'pending').slice(0, run.limits.batchSize)
      const actions = pendingSteps.map((step) => step.action)
      const actedActions: ActionDraft[] = []
      const observationDrafts: ReactTaskObservationDraft[] = []

      for (const [batchIndex, action] of actions.entries()) {
        if (signal?.aborted) return this.cancel(input, run, checkpoints, completedActionCount, actedActions, observationDrafts)
        try {
          const stepIndex = pendingSteps[batchIndex]
            ? run.steps.filter((step) => step.turn === turn).indexOf(pendingSteps[batchIndex]!)
            : batchIndex
          const observation = await this.actor(action, {
            run,
            turn,
            actionIndex: Math.max(0, stepIndex),
            actionKey: createFormalOrchestrationActionKey(run.id, turn, Math.max(0, stepIndex), action),
            signal,
          })
          observationDrafts.push(observation)
          actedActions.push(action)
          completedActionCount++
          if (hasPendingMutation(observation)) {
            run = this.observeBatch(run, observationDrafts)
            run = this.taskRuntime.markWaitingConfirm(run)
            this.appendCheckpoint(input, checkpoints, run, this.checkpoint(
              run,
              turn,
              actions,
              { kind: 'waiting_user', reason: observation.summary },
            ))
            return { status: 'waiting_user', run, checkpoints, completedActionCount }
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          run = this.observeBatch(run, observationDrafts)
          this.appendCheckpoint(input, checkpoints, run, this.checkpoint(run, turn, [...actedActions, action], { kind: 'act_failed', reason: message }, message))
          return this.fail(run, checkpoints, completedActionCount, 'act_failed', message, error)
        }
      }

      run = this.observeBatch(run, observationDrafts)
      const turnObservations = run.observations.filter((observation) => observation.turn === turn)
      if (signal?.aborted) return this.cancel(input, run, checkpoints, completedActionCount, actedActions, observationDrafts)
      run = { ...run, status: 'deciding', updatedAt: new Date().toISOString() }
      const compactedContext = compactFormalOrchestrationContext({
        objective: run.objective,
        checkpoints,
      })

      let decision: FormalOrchestrationDecision<ActionDraft>
      try {
        decision = await this.decide({
          objective: run.objective,
          originalUserInput: run.originalUserInput,
          run,
          turn,
          observations: turnObservations,
          checkpoints,
          compactedContext,
          signal,
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        this.appendCheckpoint(input, checkpoints, run, this.checkpoint(
          run,
          turn,
          actedActions,
          { kind: 'decide_failed', reason: message },
          message,
          compactedContext.trace,
        ))
        return this.fail(run, checkpoints, completedActionCount, 'decide_failed', message)
      }

      this.appendCheckpoint(input, checkpoints, run, this.checkpoint(
        run,
        turn,
        actedActions,
        decision,
        undefined,
        compactedContext.trace,
      ))
      if (signal?.aborted) return this.cancel(input, run, checkpoints, completedActionCount, [], [])
      if (decision.kind === 'complete') {
        run = this.taskRuntime.markCompleted(run)
        return { status: 'completed', run, checkpoints, completedActionCount }
      }
      if (decision.kind === 'unable_to_decide') {
        return this.fail(run, checkpoints, completedActionCount, 'unable_to_decide', decision.reason)
      }
      if (!decision.nextActions.length) {
        return this.fail(run, checkpoints, completedActionCount, 'invalid_decision', 'decider 返回 continue 但没有下一步动作。')
      }

      run = this.taskRuntime.continueWithActions({ run, nextActions: decision.nextActions, reason: decision.reason })
      if (run.status === 'failed') {
        return this.fail(run, checkpoints, completedActionCount, 'max_turns', run.recovery?.lastFailure ?? '已达到最大轮次。')
      }
    }

    return this.fail(run, checkpoints, completedActionCount, 'invalid_decision', `任务进入了不可继续的状态：${run.status}`)
  }

  private restoreRun(
    originalUserInput: string,
    plannerTask: ReactTaskPlannerDraft<ActionDraft>,
    resumeFrom: FormalOrchestrationResumePlan<ActionDraft>,
  ): ReactTaskRun<ActionDraft> {
    const now = new Date().toISOString()
    const historicalSteps = resumeFrom.checkpoints.flatMap((checkpoint) => checkpoint.actions.map((action, actionIndex) => ({
      id: createFormalOrchestrationActionKey(checkpoint.runId, checkpoint.turn, actionIndex, action),
      turn: checkpoint.turn,
      status: actionIndex < checkpoint.observations.length ? 'observed' as const : 'failed' as const,
      action,
    })))
    const pendingSteps = resumeFrom.nextActions.map((action, actionIndex) => ({
      id: createFormalOrchestrationActionKey(resumeFrom.runId, resumeFrom.nextTurn, actionIndex, action),
      turn: resumeFrom.nextTurn,
      status: 'pending' as const,
      action,
      reason: 'cross_request_resume',
    }))
    const observations = resumeFrom.checkpoints.flatMap((checkpoint) => checkpoint.observations)
    return {
      id: resumeFrom.runId,
      workspaceKey: resumeFrom.workspaceKey,
      objective: resumeFrom.objective,
      originalUserInput,
      status: 'acting',
      loopCount: Math.max(0, resumeFrom.nextTurn - 1),
      limits: {
        maxTurns: Math.max(resumeFrom.nextTurn, plannerTask.maxTurns ?? 4),
        batchSize: Math.max(1, plannerTask.batchSize ?? 5),
      },
      stopCondition: plannerTask.stopCondition,
      steps: [...historicalSteps, ...pendingSteps],
      observations,
      recovery: {
        canRetry: false,
        retryCount: 1,
        lastFailure: resumeFrom.lastFailureReason,
      },
      createdAt: resumeFrom.checkpoints[0]?.createdAt ?? now,
      updatedAt: now,
    }
  }

  private observeBatch(run: ReactTaskRun<ActionDraft>, observations: ReactTaskObservationDraft[]): ReactTaskRun<ActionDraft> {
    if (!observations.length) return run
    return this.taskRuntime.recordObservationBatch({ run, observations })
  }

  private checkpoint(
    run: ReactTaskRun<ActionDraft>,
    turn: number,
    actions: ActionDraft[],
    decision: FormalOrchestrationCheckpoint<ActionDraft>['decision'],
    failureReason?: string,
    contextCompaction?: FormalOrchestrationContextCompactionTrace,
  ): FormalOrchestrationCheckpoint<ActionDraft> {
    return {
      id: createCheckpointId(run.id, turn, decision.kind),
      runId: run.id,
      objective: run.objective,
      turn,
      actions: [...actions],
      observations: run.observations.filter((observation) => observation.turn === turn),
      decision,
      failureReason,
      contextCompaction,
      createdAt: new Date().toISOString(),
    }
  }

  private appendCheckpoint(
    input: FormalOrchestrationRunInput<ActionDraft>,
    checkpoints: FormalOrchestrationCheckpoint<ActionDraft>[],
    run: ReactTaskRun<ActionDraft>,
    checkpoint: FormalOrchestrationCheckpoint<ActionDraft>,
  ): void {
    checkpoints.push(checkpoint)
    input.onCheckpoint?.(checkpoint, run)
  }

  private cancel(
    input: FormalOrchestrationRunInput<ActionDraft>,
    run: ReactTaskRun<ActionDraft>,
    checkpoints: FormalOrchestrationCheckpoint<ActionDraft>[],
    completedActionCount: number,
    actions: ActionDraft[],
    observations: ReactTaskObservationDraft[],
  ): FormalOrchestrationRunResult<ActionDraft> {
    run = this.observeBatch(run, observations)
    const turn = Math.max(1, run.loopCount)
    if (!checkpoints.some((checkpoint) => checkpoint.decision.kind === 'cancelled')) {
      this.appendCheckpoint(input, checkpoints, run, this.checkpoint(run, turn, actions, { kind: 'cancelled', reason: '任务已由用户停止或 deadline 中止。' }))
    }
    run = this.taskRuntime.markCancelled(run)
    return { status: 'cancelled', run, checkpoints, completedActionCount }
  }

  private fail(
    run: ReactTaskRun<ActionDraft>,
    checkpoints: FormalOrchestrationCheckpoint<ActionDraft>[],
    completedActionCount: number,
    kind: FormalOrchestrationFailure['kind'],
    message: string,
    sourceError?: unknown,
  ): FormalOrchestrationRunResult<ActionDraft> {
    run = this.taskRuntime.markFailed(run, message)
    const envelopeKind: Record<FormalOrchestrationFailure['kind'], RecoverableFailureKind> = {
      empty_plan: 'react_plan_invalid',
      act_failed: 'runtime_action_failed',
      decide_failed: 'llm_decide_unavailable',
      unable_to_decide: 'unable_to_decide',
      invalid_decision: 'react_plan_invalid',
      max_turns: 'react_max_turns_exhausted',
    }
    const conflict = getCapabilityRouteConflict(sourceError)
    const envelope = buildRecoverableFailureEnvelope({
      kind: conflict ? 'capability_route_conflict' : envelopeKind[kind],
      recognizedSlots: conflict
        ? [{ name: 'intent', value: conflict.intent, confidence: 1, source: 'context' }]
        : [],
      missingSlots: [],
      candidateEvidence: [],
      retrySuggestions: [
        { label: '重试当前任务', instructionTemplate: '重试当前任务', strategy: 'resubmit' },
        { label: '缩小目标时段', instructionTemplate: '请只处理 {timeRange}', strategy: 'narrow_target' },
      ],
      noMutation: completedActionCount === 0,
      humanSummary: message,
      traceId: run.id,
    }) as RecoverableInterpretationFailure & { capabilityIds?: string[] }
    if (conflict) envelope.capabilityIds = [...conflict.capabilityIds]
    return {
      status: 'failed',
      run,
      checkpoints,
      completedActionCount,
      failure: {
        kind,
        message,
        turn: run.loopCount,
        retrySuggestions: ['重试当前任务', '补充编排条件', '缩小目标时段', '取消任务'],
        envelope,
      },
    }
  }
}

function hasPendingMutation(observation: ReactTaskObservationDraft): boolean {
  const pendingMutation = observation.data?.pendingMutation
  if (!pendingMutation || typeof pendingMutation !== 'object') return false
  const candidate = pendingMutation as Record<string, unknown>
  return candidate.mutationPolicy === 'pending_only'
    && typeof candidate.workspaceKey === 'string'
    && Boolean(candidate.workspaceKey.trim())
    && typeof candidate.mutationId === 'string'
    && Boolean(candidate.mutationId.trim())
}

function getCapabilityRouteConflict(error: unknown): { intent: string; capabilityIds: string[] } | null {
  if (!error || typeof error !== 'object') return null
  const candidate = error as {
    kind?: unknown
    intent?: unknown
    envelope?: { kind?: unknown; capabilityIds?: unknown }
  }
  if (candidate.kind !== 'capability_route_conflict' || candidate.envelope?.kind !== 'capability_route_conflict') return null
  const capabilityIds = Array.isArray(candidate.envelope.capabilityIds)
    ? candidate.envelope.capabilityIds.filter((id): id is string => typeof id === 'string' && Boolean(id.trim()))
    : []
  if (!capabilityIds.length) return null
  return {
    intent: typeof candidate.intent === 'string' && candidate.intent.trim() ? candidate.intent : 'unknown',
    capabilityIds,
  }
}
