import {
  buildRecoverableFailureEnvelope,
  type RecoverableInterpretationFailure,
} from '@/services/agent/recoverableFailureEnvelope'
import type { FormalOrchestrationCheckpoint } from './formalOrchestrationRuntime'
import type { AgentPendingTask } from '@/services/agent/types'

type VersionValue = string | number

export type FormalOrchestrationRecoveryAction = 'inspect' | 'continue' | 'retry' | 'narrow_scope' | 'confirm_pending' | 'cancel'
export type FormalOrchestrationExecutableRecoveryAction = Exclude<FormalOrchestrationRecoveryAction, 'inspect'>

export interface FormalOrchestrationRecoveryInput<ActionDraft> {
  sessionId: string
  action: FormalOrchestrationRecoveryAction
  requestedWorkspaceKey: string
  checkpointWorkspaceKey?: string | null
  expectedPlaylistVersion?: VersionValue | null
  actualPlaylistVersion?: VersionValue | null
  checkpoints: FormalOrchestrationCheckpoint<ActionDraft>[]
}

export interface FormalOrchestrationResumePlan<ActionDraft> {
  runId: string
  workspaceKey: string
  objective: string
  nextTurn: number
  nextActions: ActionDraft[]
  skippedActionKeys: string[]
  checkpoints: FormalOrchestrationCheckpoint<ActionDraft>[]
  lastFailureReason?: string
  resumeAt: 'act' | 'decide'
  pendingTask?: AgentPendingTask
}

export interface FormalOrchestrationRecoveryResult<ActionDraft> {
  status: 'action_required' | 'ready' | 'cancelled' | 'rejected'
  action: FormalOrchestrationRecoveryAction
  allowedActions: FormalOrchestrationExecutableRecoveryAction[]
  envelope: RecoverableInterpretationFailure
  resumePlan?: FormalOrchestrationResumePlan<ActionDraft>
}

const ALLOWED_ACTIONS: FormalOrchestrationExecutableRecoveryAction[] = [
  'continue',
  'retry',
  'narrow_scope',
  'cancel',
]

const resolveWaitingPendingPlan = <ActionDraft>(
  checkpoint: FormalOrchestrationCheckpoint<ActionDraft>,
  checkpoints: FormalOrchestrationCheckpoint<ActionDraft>[],
  workspaceKey: string,
): FormalOrchestrationResumePlan<ActionDraft> | null => {
  if (checkpoint.decision.kind !== 'waiting_user') return null
  const pendingObservationIndex = checkpoint.observations.findIndex((observation) => {
    const pendingMutation = observation.data?.pendingMutation
    return Boolean(pendingMutation && typeof pendingMutation === 'object'
      && (pendingMutation as { mutationPolicy?: unknown }).mutationPolicy === 'pending_only')
  })
  if (pendingObservationIndex < 0) return null
  const pendingMutation = checkpoint.observations[pendingObservationIndex]?.data?.pendingMutation as {
    pendingTask?: AgentPendingTask
  } | undefined
  const pendingTask = pendingMutation?.pendingTask
  const pendingAction = checkpoint.actions[pendingObservationIndex]
  if (!pendingTask || !pendingAction || typeof pendingAction !== 'object') return null
  const confirmedAction = {
    ...(pendingAction as Record<string, unknown>),
    pendingAction: 'confirm',
    mutationPolicy: 'formal_write',
  } as ActionDraft
  return {
    runId: checkpoint.runId,
    workspaceKey,
    objective: checkpoint.objective,
    nextTurn: checkpoint.turn + 1,
    nextActions: [confirmedAction, ...checkpoint.actions.slice(pendingObservationIndex + 1)],
    skippedActionKeys: [],
    checkpoints: [...checkpoints],
    lastFailureReason: resolveLastFailureReason(checkpoints),
    resumeAt: 'act',
    pendingTask,
  }
}

const isVersionValue = (value: unknown): value is VersionValue => (
  typeof value === 'string' || typeof value === 'number'
)

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalize(child)]),
  )
}

const hashText = (value: string): string => {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}

export const createFormalOrchestrationActionKey = (
  runId: string,
  turn: number,
  actionIndex: number,
  action: unknown,
): string => `${runId}:action:${turn}:${actionIndex}:${hashText(JSON.stringify(canonicalize(action)))}`

const createEnvelope = (
  kind: RecoverableInterpretationFailure['kind'],
  sessionId: string,
  humanSummary: string,
): RecoverableInterpretationFailure => buildRecoverableFailureEnvelope({
  kind,
  recognizedSlots: [],
  missingSlots: [],
  candidateEvidence: [],
  retrySuggestions: [
    { label: '继续', instructionTemplate: '继续刚才的任务', strategy: 'resubmit' },
    { label: '重试', instructionTemplate: '重试刚才失败的步骤', strategy: 'resubmit' },
    { label: '缩小范围', instructionTemplate: '请只处理 {timeRange}', strategy: 'narrow_target' },
  ],
  noMutation: true,
  humanSummary,
  traceId: sessionId,
})

const resolveLastFailureReason = <ActionDraft>(
  checkpoints: FormalOrchestrationCheckpoint<ActionDraft>[],
): string | undefined => {
  for (let index = checkpoints.length - 1; index >= 0; index--) {
    const checkpoint = checkpoints[index]
    if (checkpoint?.failureReason) return checkpoint.failureReason
    const risk = [...(checkpoint?.observations ?? [])].reverse().find((observation) => observation.risk)?.risk
    if (risk) return risk
  }
  return undefined
}

const resolveResumePlan = <ActionDraft>(
  checkpoints: FormalOrchestrationCheckpoint<ActionDraft>[],
  workspaceKey: string,
): FormalOrchestrationResumePlan<ActionDraft> | null => {
  const latest = checkpoints.at(-1)
  if (!latest) return null
  const lastContinue = [...checkpoints].reverse().find((checkpoint) => checkpoint.decision.kind === 'continue')
  const retryCheckpoint = latest.decision.kind === 'act_failed' ? latest : null
  const source = lastContinue ?? retryCheckpoint
  if (!source) {
    if (latest.decision.kind === 'decide_failed' || latest.decision.kind === 'unable_to_decide' || latest.decision.kind === 'cancelled') {
      return {
        runId: latest.runId,
        workspaceKey,
        objective: latest.objective,
        nextTurn: latest.turn,
        nextActions: [],
        skippedActionKeys: [],
        checkpoints: [...checkpoints],
        lastFailureReason: resolveLastFailureReason(checkpoints),
        resumeAt: 'decide',
      }
    }
    return null
  }

  const nextTurn = source.decision.kind === 'continue' ? source.turn + 1 : source.turn
  const candidateActions = source.decision.kind === 'continue'
    ? source.decision.nextActions
    : source.actions.slice(source.observations.length)
  const completedKeys = new Set<string>()
  checkpoints.forEach((checkpoint) => {
    checkpoint.actions.slice(0, checkpoint.observations.length).forEach((action, actionIndex) => {
      completedKeys.add(createFormalOrchestrationActionKey(checkpoint.runId, checkpoint.turn, actionIndex, action))
    })
  })
  const skippedActionKeys: string[] = []
  const nextActions = candidateActions.filter((action, actionIndex) => {
    const key = createFormalOrchestrationActionKey(source.runId, nextTurn, actionIndex, action)
    if (!completedKeys.has(key)) return true
    skippedActionKeys.push(key)
    return false
  })

  return {
    runId: source.runId,
    workspaceKey,
    objective: source.objective,
    nextTurn,
    nextActions,
    skippedActionKeys,
    checkpoints: [...checkpoints],
    lastFailureReason: resolveLastFailureReason(checkpoints),
    resumeAt: nextActions.length ? 'act' : 'decide',
  }
}

export function prepareFormalOrchestrationRecovery<ActionDraft>(
  input: FormalOrchestrationRecoveryInput<ActionDraft>,
): FormalOrchestrationRecoveryResult<ActionDraft> {
  const latestCheckpoint = input.checkpoints.at(-1)
  const waitingForUser = latestCheckpoint?.decision.kind === 'waiting_user'
  const base = {
    action: input.action,
    allowedActions: waitingForUser
      ? [...ALLOWED_ACTIONS, 'confirm_pending' as const]
      : [...ALLOWED_ACTIONS],
  }
  if (!input.checkpoints.length) {
    return {
      ...base,
      status: 'rejected',
      envelope: createEnvelope('react_resume_checkpoint_invalid', input.sessionId, '没有可恢复的 ReAct checkpoint。'),
    }
  }
  if (!input.checkpointWorkspaceKey || input.checkpointWorkspaceKey !== input.requestedWorkspaceKey) {
    return {
      ...base,
      status: 'rejected',
      envelope: createEnvelope('react_resume_workspace_mismatch', input.sessionId, '恢复请求与 checkpoint 所属工作区不一致。'),
    }
  }
  if (
    !isVersionValue(input.expectedPlaylistVersion)
    || !isVersionValue(input.actualPlaylistVersion)
    || String(input.expectedPlaylistVersion) !== String(input.actualPlaylistVersion)
  ) {
    return {
      ...base,
      status: 'rejected',
      envelope: createEnvelope('react_resume_version_conflict', input.sessionId, '正式播单版本缺失或已发生变化，请刷新现场后重新确认。'),
    }
  }
  if (input.action === 'inspect') {
    return {
      ...base,
      status: 'action_required',
      envelope: createEnvelope('react_resume_action_required', input.sessionId, '已找到可恢复现场，请明确选择继续、重试、缩小范围或取消。'),
    }
  }
  if (input.action === 'cancel') {
    return {
      ...base,
      status: 'cancelled',
      envelope: createEnvelope('react_resume_action_required', input.sessionId, '已取消恢复，checkpoint 仍保留供审计。'),
    }
  }

  if (waitingForUser) {
    if (input.action !== 'confirm_pending') {
      return {
        ...base,
        status: 'action_required',
        envelope: createEnvelope('react_resume_action_required', input.sessionId, '当前动作涉及正式播单确认，请明确选择确认待处理动作或取消。'),
      }
    }
    const resumePlan = latestCheckpoint
      ? resolveWaitingPendingPlan(latestCheckpoint, input.checkpoints, input.requestedWorkspaceKey)
      : null
    if (!resumePlan) {
      return {
        ...base,
        status: 'rejected',
        envelope: createEnvelope('react_resume_checkpoint_invalid', input.sessionId, '等待确认 checkpoint 缺少可恢复的 pending mutation。'),
      }
    }
    return {
      ...base,
      status: 'ready',
      envelope: createEnvelope('react_resume_ready', input.sessionId, '待处理动作已由用户明确确认，可以从 checkpoint 继续。'),
      resumePlan,
    }
  }
  if (input.action === 'confirm_pending') {
    return {
      ...base,
      status: 'rejected',
      envelope: createEnvelope('react_resume_action_required', input.sessionId, '当前 checkpoint 没有等待确认的 pending mutation。'),
    }
  }

  const resumePlan = resolveResumePlan(input.checkpoints, input.requestedWorkspaceKey)
  if (!resumePlan) {
    return {
      ...base,
      status: 'rejected',
      envelope: createEnvelope('react_resume_checkpoint_invalid', input.sessionId, '最后 checkpoint 不包含可恢复的动作或 decide 现场。'),
    }
  }
  return {
    ...base,
    status: 'ready',
    envelope: createEnvelope('react_resume_ready', input.sessionId, '恢复校验已通过，可以从最后 checkpoint 继续。'),
    resumePlan,
  }
}
