import type { LayoutDraft, PlaylistType, ScheduleState } from '@/types/orchestration'
import type { RuntimePendingCommand, RuntimeScheduleItem } from './demoRuntimeFacade'
import type { RuntimePendingAtomicContext } from './pendingAtomicContext'
import type { ReactTaskRun } from './reactTaskTypes'
import { buildScheduleWorkspaceSummary, resolveForegroundWorkspaceKey } from './foregroundWorkspaceState'
import { evaluateLayoutDraftCompleteness, type LayoutDraftCompleteness } from '@/services/layoutDraftCompleteness'

export type ForegroundAgentScenario =
  | 'atomic'
  | 'layout_reference'
  | 'review'
  | 'general'

export type PendingReviewKind =
  | 'command'
  | 'candidate_selection'
  | 'layout_commit'
  | 'layout_draft_update'
  | 'formal_rebuild'
  | 'parameter_clarification'

export interface PendingReviewSnapshot {
  kind: PendingReviewKind
  owner: 'layout_draft' | 'formal_playlist'
  phase?: RuntimePendingAtomicContext['phase']
  pendingId?: string
  action: string
  riskLevel: 'low' | 'medium' | 'high'
  allowedResponses: Array<'confirm' | 'cancel' | 'select' | 'clarify'>
  expiresOnNextNonAnswer: boolean
  summary: string
  formalRebuild?: {
    actionKind: 'commit_layout_draft' | 'formal_orchestration'
    mode: 'full_generate' | 'partial_generate'
    useLayoutDraft: boolean
  }
}

export interface PendingContextSnapshot {
  owner: 'layout_draft' | 'formal_playlist'
  phase: RuntimePendingAtomicContext['phase']
  pendingId?: string
  action: string
  summary: string
  missingFields: RuntimePendingAtomicContext['missingFields']
}

export interface ForegroundAgentContextPackage {
  latestUserInput: string
  scenario: ForegroundAgentScenario
  workspace: {
    workspaceKey: string
    playlistId?: string | null
    playlistType: PlaylistType
    channelId: string
    channelName: string
    date: string
    rotationStrategy?: ScheduleState['rotationStrategy']
    rotationDurationSeconds?: number
    itemCount: number
    gapCount: number
    scheduleSummary: Array<{
      id: string
      startTime: string
      endTime: string
      programName?: string
      programType?: string
    }>
  }
  layoutDraft: {
    visible: boolean
    available: boolean
    source?: LayoutDraft['source']
    effectiveFrom?: string
    effectiveTo?: string
    version?: number
    referencedByCurrentTask: boolean
    coverage?: LayoutDraft['coverage']
    segmentCount?: number
    completeness: LayoutDraftCompleteness
    segments?: Array<{
      id: string
      startTime: string
      endTime: string
      label: string
      constraintKind?: LayoutDraft['columns'][number]['draftConstraintKind']
    }>
  }
  review: PendingReviewSnapshot | null
  pending: PendingContextSnapshot | null
  reactTask: {
    active: boolean
    id?: string
    objective?: string
    status?: ReactTaskRun['status']
    loopCount?: number
    maxTurns?: number
    pendingStepCount?: number
    pendingSteps?: Array<{
      type?: string
      targetTime?: string
      semanticLabel?: string
      targetSegmentIndex?: number
      targetSegmentLabel?: string
      queries?: string[]
      reason?: string
    }>
    observationCount?: number
    lastObservation?: {
      type: string
      summary: string
      risk?: string
    }
    recovery?: ReactTaskRun['recovery']
  }
  allowedActions: string[]
  injectionProfile: {
    scheduleItemLimit: number
    layoutSegmentLimit: number
    latestUserInputLimit: number
    maxPromptChars: number
    includeLayoutSegments: boolean
    reason: string
  }
  budget: {
    estimatedPromptChars: number
    maxPromptChars: number
    truncated: boolean
    omittedScheduleItems: number
    omittedLayoutSegments: number
    omissions: Array<'latest_user_input' | 'schedule_summary' | 'layout_segments'>
  }
}

export interface BuildForegroundAgentContextPackageInput {
  latestUserInput: string
  scheduleState: ScheduleState
  currentSchedule: RuntimeScheduleItem[]
  currentLayoutDraft?: LayoutDraft | null
  pendingCommand?: RuntimePendingCommand | null
  pendingAtomicContext?: RuntimePendingAtomicContext | null
  activeReactTaskRun?: ReactTaskRun | null
}

export type PendingReviewLifecycleExpireReason = 'workspace_changed' | 'next_non_answer'

export interface PendingReviewLifecycleDecision {
  hasPendingReview: boolean
  canUsePendingReview: boolean
  shouldExpire: boolean
  expireReason?: PendingReviewLifecycleExpireReason
}

export interface ResolvePendingReviewLifecycleInput {
  latestUserInput: string
  currentWorkspaceKey: string
  pendingWorkspaceKey?: string | null
  pendingCommand?: RuntimePendingCommand | null
  pendingAtomicContext?: RuntimePendingAtomicContext | null
}

const PROMPT_PREFIX = '【统一前台上下文包】\n'
const SUMMARY_FIELD_LIMIT = 80

export const buildForegroundAgentContextPackage = (
  input: BuildForegroundAgentContextPackageInput,
): ForegroundAgentContextPackage => {
  const review = buildPendingReviewSnapshot(input.pendingCommand, input.pendingAtomicContext)
  const pending = buildPendingContextSnapshot(input.pendingAtomicContext)
  const activeReactTaskRun = input.activeReactTaskRun ?? null
  const lastObservation = activeReactTaskRun?.observations.at(-1)
  const scenario = resolveContextScenario(review, input.pendingAtomicContext, input.currentLayoutDraft)
  // 上下文包不能替 LLM 判断“是否按草案执行”；这里只记录客观可用性。
  const referencedByCurrentTask = false
  const draft = input.currentLayoutDraft ?? null
  const draftCompleteness = evaluateLayoutDraftCompleteness(draft)
  const profile = resolveInjectionProfile(
    scenario,
    draftCompleteness.status,
    Boolean(draft),
    input.scheduleState.playlistType ?? 'none',
  )
  const workspaceSummary = buildScheduleWorkspaceSummary(input.scheduleState)
  const latestUserInput = compactText(input.latestUserInput, profile.latestUserInputLimit)
  const includedScheduleItems = input.currentSchedule.slice(0, profile.scheduleItemLimit)
  const scheduleTextCompacted = includedScheduleItems.some((item) =>
    isOverTextLimit(item.id, SUMMARY_FIELD_LIMIT)
    || isOverTextLimit(item.programName, SUMMARY_FIELD_LIMIT)
    || isOverTextLimit(item.programType, SUMMARY_FIELD_LIMIT),
  )
  const scheduleSummary = includedScheduleItems
    .map((item) => ({
      id: compactText(item.id, SUMMARY_FIELD_LIMIT),
      startTime: item.startTime,
      endTime: item.endTime,
      programName: compactOptionalText(item.programName, SUMMARY_FIELD_LIMIT),
      programType: compactOptionalText(item.programType, SUMMARY_FIELD_LIMIT),
    }))
  const includedLayoutSlots = draft?.layoutReference.slots.slice(0, profile.layoutSegmentLimit) ?? []
  const layoutTextCompacted = Boolean(draft && profile.includeLayoutSegments && includedLayoutSlots.some((slot, index) =>
    isOverTextLimit(slot.id, SUMMARY_FIELD_LIMIT)
    || isOverTextLimit(draft.columns[index]?.semanticLabel, SUMMARY_FIELD_LIMIT)
    || isOverTextLimit(draft.columns[index]?.columnName, SUMMARY_FIELD_LIMIT),
  ))
  const layoutSegments = draft && profile.includeLayoutSegments
    ? includedLayoutSlots.map((slot, index) => ({
      id: compactText(slot.id, SUMMARY_FIELD_LIMIT),
      startTime: slot.startTime,
      endTime: slot.endTime,
      label: compactText(
        draft.columns[index]?.semanticLabel ?? draft.columns[index]?.columnName ?? `segment ${index + 1}`,
        SUMMARY_FIELD_LIMIT,
      ),
      constraintKind: draft.columns[index]?.draftConstraintKind,
    }))
    : undefined

  const packageWithoutBudget: Omit<ForegroundAgentContextPackage, 'budget'> = {
    latestUserInput,
    scenario,
    workspace: {
      workspaceKey: resolveForegroundWorkspaceKey(workspaceSummary),
      playlistId: workspaceSummary.playlistId,
      playlistType: workspaceSummary.playlistType,
      channelId: workspaceSummary.channelId,
      channelName: workspaceSummary.channelName,
      date: workspaceSummary.date,
      ...(workspaceSummary.playlistType === 'rotation'
        ? {
            rotationStrategy: workspaceSummary.rotationStrategy,
            rotationDurationSeconds: workspaceSummary.rotationDurationSeconds ?? undefined,
          }
        : {}),
      itemCount: input.scheduleState.itemCount,
      gapCount: input.scheduleState.gapCount,
      scheduleSummary,
    },
    layoutDraft: {
      visible: input.scheduleState.playlistType === 'tv' || Boolean(draft),
      available: Boolean(draft),
      source: draft?.source,
      effectiveFrom: draft?.effectiveFrom,
      effectiveTo: draft?.effectiveTo,
      version: draft?.version,
      referencedByCurrentTask,
      coverage: draft?.coverage,
      segmentCount: draft?.layoutReference.slots.length,
      completeness: draftCompleteness,
      segments: layoutSegments,
    },
    review,
    pending,
    reactTask: activeReactTaskRun
      ? {
          active: !['completed', 'failed', 'cancelled'].includes(activeReactTaskRun.status),
          id: activeReactTaskRun.id,
          objective: compactText(activeReactTaskRun.objective, 120),
          status: activeReactTaskRun.status,
          loopCount: activeReactTaskRun.loopCount,
          maxTurns: activeReactTaskRun.limits.maxTurns,
          pendingStepCount: activeReactTaskRun.steps.filter((step) => step.status === 'pending' || step.status === 'running').length,
          pendingSteps: activeReactTaskRun.steps
            .filter((step) =>
              step.status === 'pending'
              || step.status === 'running'
              || (step.status === 'failed' && activeReactTaskRun.recovery?.canRetry === true),
            )
            .slice(0, 3)
            .map((step) => compactReactTaskStep(step)),
          observationCount: activeReactTaskRun.observations.length,
          lastObservation: lastObservation
            ? {
                type: lastObservation.type,
                summary: compactText(lastObservation.summary, 160),
                risk: lastObservation.risk,
              }
            : undefined,
          recovery: activeReactTaskRun.recovery,
        }
      : {
          active: false,
        },
    allowedActions: resolveAllowedActions(input.scheduleState.playlistType ?? 'none', scenario),
    injectionProfile: profile,
  }

  const budget = buildContextBudget({
    packageWithoutBudget,
    originalUserInput: input.latestUserInput,
    originalScheduleItemCount: input.currentSchedule.length,
    originalLayoutSegmentCount: draft?.layoutReference.slots.length ?? 0,
    scheduleTextCompacted,
    layoutTextCompacted,
  })
  const contextPackage = {
    ...packageWithoutBudget,
    budget,
  }
  const finalizedBudget = finalizeContextBudget(contextPackage)

  return {
    ...contextPackage,
    budget: finalizedBudget,
  }
}

export const formatForegroundAgentContextForPrompt = (
  contextPackage: ForegroundAgentContextPackage | undefined,
): string | undefined => {
  if (!contextPackage) return undefined
  return `${PROMPT_PREFIX}${JSON.stringify(buildBusinessContextForPrompt(contextPackage), null, 2)}`
}

const buildBusinessContextForPrompt = (contextPackage: ForegroundAgentContextPackage) => ({
  latestUserInput: contextPackage.latestUserInput,
  // scenario 仅表示客观现场状态，不是本轮用户意图或 taskKind。
  // 用户意图、action、是否正式写入必须由 LLM 返回并经过结果校验。
  scenario: contextPackage.scenario,
  workspace: {
    playlistId: contextPackage.workspace.playlistId,
    playlistType: contextPackage.workspace.playlistType,
    channelName: contextPackage.workspace.channelName,
    date: contextPackage.workspace.date,
    rotationStrategy: contextPackage.workspace.rotationStrategy,
    rotationDurationSeconds: contextPackage.workspace.rotationDurationSeconds,
    itemCount: contextPackage.workspace.itemCount,
    gapCount: contextPackage.workspace.gapCount,
    scheduleSummary: contextPackage.workspace.scheduleSummary,
  },
  layoutDraft: {
    visible: contextPackage.layoutDraft.visible,
    available: contextPackage.layoutDraft.available,
    source: contextPackage.layoutDraft.source,
    effectiveFrom: contextPackage.layoutDraft.effectiveFrom,
    effectiveTo: contextPackage.layoutDraft.effectiveTo,
    referencedByCurrentTask: contextPackage.layoutDraft.referencedByCurrentTask,
    coverage: contextPackage.layoutDraft.coverage,
    segmentCount: contextPackage.layoutDraft.segmentCount,
    completeness: contextPackage.layoutDraft.completeness,
    segments: contextPackage.layoutDraft.segments,
  },
  pendingReview: contextPackage.review
    ? {
        kind: contextPackage.review.kind,
        action: contextPackage.review.action,
        riskLevel: contextPackage.review.riskLevel,
        allowedResponses: contextPackage.review.allowedResponses,
        expiresOnNextNonAnswer: contextPackage.review.expiresOnNextNonAnswer,
        summary: contextPackage.review.summary,
      }
    : null,
  pendingContext: contextPackage.pending,
  activeReactTask: contextPackage.reactTask.active || contextPackage.reactTask.recovery?.canRetry
    ? contextPackage.reactTask
    : null,
  allowedActions: contextPackage.allowedActions,
  contextNotes: {
    scheduleItemsIncluded: contextPackage.workspace.scheduleSummary.length,
    layoutSegmentsIncluded: contextPackage.layoutDraft.segments?.length ?? 0,
    omittedScheduleItems: contextPackage.budget.omittedScheduleItems,
    omittedLayoutSegments: contextPackage.budget.omittedLayoutSegments,
    omissions: contextPackage.budget.omissions,
  },
})

export const resolvePendingReviewLifecycle = (
  input: ResolvePendingReviewLifecycleInput,
): PendingReviewLifecycleDecision => {
  const review = buildPendingReviewSnapshot(input.pendingCommand, input.pendingAtomicContext)
  if (!review) {
    return {
      hasPendingReview: false,
      canUsePendingReview: false,
      shouldExpire: false,
    }
  }

  if (input.pendingWorkspaceKey && input.pendingWorkspaceKey !== input.currentWorkspaceKey) {
    return {
      hasPendingReview: true,
      canUsePendingReview: false,
      shouldExpire: true,
      expireReason: 'workspace_changed',
    }
  }

  return {
    hasPendingReview: true,
    canUsePendingReview: true,
    shouldExpire: false,
  }
}

const resolveContextScenario = (
  review: PendingReviewSnapshot | null,
  pendingAtomicContext?: RuntimePendingAtomicContext | null,
  currentLayoutDraft?: LayoutDraft | null,
): ForegroundAgentScenario => {
  if (review) return 'review'
  if (
    pendingAtomicContext
    && (
      pendingAtomicContext.phase === 'clarifying'
      || pendingAtomicContext.phase === 'selecting_target'
      || pendingAtomicContext.phase === 'recommending_insert'
      || Boolean(pendingAtomicContext.agentPendingTask)
    )
  ) return 'atomic'
  if (currentLayoutDraft) return 'layout_reference'
  return 'general'
}

const buildPendingReviewSnapshot = (
  pendingCommand?: RuntimePendingCommand | null,
  pendingAtomicContext?: RuntimePendingAtomicContext | null,
): PendingReviewSnapshot | null => {
  if (pendingCommand) {
    return {
      kind: 'command',
      owner: 'formal_playlist',
      action: pendingCommand.command.action,
      riskLevel: pendingCommand.command.action === 'delete' || pendingCommand.command.action === 'replace' ? 'high' : 'medium',
      allowedResponses: ['confirm', 'cancel'],
      expiresOnNextNonAnswer: false,
      summary: pendingCommand.summary,
    }
  }

  if (!pendingAtomicContext) return null
  if (pendingAtomicContext.formalRebuildConfirmation || pendingAtomicContext.phase === 'formal_rebuild_confirmation') {
    const confirmation = pendingAtomicContext.formalRebuildConfirmation
    return {
      kind: 'formal_rebuild',
      owner: 'formal_playlist',
      phase: pendingAtomicContext.phase,
      pendingId: pendingAtomicContext.pendingId,
      action: 'formal_rebuild',
      riskLevel: 'high',
      allowedResponses: ['confirm', 'cancel'],
      expiresOnNextNonAnswer: false,
      summary: pendingAtomicContext.summary,
      formalRebuild: confirmation
        ? {
            actionKind: confirmation.actionKind,
            mode: confirmation.mode,
            useLayoutDraft: confirmation.useLayoutDraft === true,
          }
        : undefined,
    }
  }
  if (pendingAtomicContext.layoutDraftSuggestion) {
    return {
      kind: 'layout_draft_update',
      owner: 'layout_draft',
      phase: pendingAtomicContext.phase,
      pendingId: pendingAtomicContext.pendingId,
      action: 'update_layout_draft',
      riskLevel: 'low',
      allowedResponses: ['confirm', 'cancel'],
      expiresOnNextNonAnswer: false,
      summary: pendingAtomicContext.summary,
    }
  }
  if (pendingAtomicContext.compositeTaskRun?.status === 'waiting_confirm') {
    return {
      kind: 'command',
      owner: 'formal_playlist',
      phase: pendingAtomicContext.phase,
      pendingId: pendingAtomicContext.pendingId,
      action: pendingAtomicContext.action ?? pendingAtomicContext.compositeTaskRun.stages[0]?.action ?? 'confirm',
      riskLevel: pendingAtomicContext.action === 'delete' || pendingAtomicContext.action === 'replace' ? 'high' : 'medium',
      allowedResponses: ['confirm', 'cancel'],
      expiresOnNextNonAnswer: false,
      summary: pendingAtomicContext.summary,
    }
  }
  if (pendingAtomicContext.agentPendingTask?.phase === 'needs_confirmation') {
    return {
      kind: 'command',
      owner: 'formal_playlist',
      phase: pendingAtomicContext.phase,
      pendingId: pendingAtomicContext.pendingId,
      action: pendingAtomicContext.action ?? pendingAtomicContext.agentPendingTask.intent ?? 'confirm',
      riskLevel: pendingAtomicContext.action === 'delete' || pendingAtomicContext.action === 'replace' ? 'high' : 'medium',
      allowedResponses: ['confirm', 'cancel'],
      expiresOnNextNonAnswer: false,
      summary: pendingAtomicContext.summary,
    }
  }
  return null
}

const buildPendingContextSnapshot = (
  pendingAtomicContext?: RuntimePendingAtomicContext | null,
): PendingContextSnapshot | null => {
  if (!pendingAtomicContext) return null
  const owner = pendingAtomicContext.layoutDraftSuggestion || pendingAtomicContext.phase === 'draft_research_confirmation'
    ? 'layout_draft' as const
    : 'formal_playlist' as const
  return {
    owner,
    phase: pendingAtomicContext.phase,
    pendingId: pendingAtomicContext.pendingId,
    action: pendingAtomicContext.action
      ?? pendingAtomicContext.agentIntent
      ?? pendingAtomicContext.agentPendingTask?.intent
      ?? (owner === 'layout_draft' ? 'update_layout_draft' : 'clarify'),
    summary: pendingAtomicContext.summary,
    missingFields: [...pendingAtomicContext.missingFields],
  }
}

const resolveInjectionProfile = (
  scenario: ForegroundAgentScenario,
  _draftCompletenessStatus: LayoutDraftCompleteness['status'] = 'missing',
  hasDraft = false,
  playlistType: PlaylistType = 'none',
): ForegroundAgentContextPackage['injectionProfile'] => {
  if (scenario === 'atomic' || scenario === 'review') {
    return {
      scheduleItemLimit: 8,
      layoutSegmentLimit: 0,
      latestUserInputLimit: 800,
      maxPromptChars: 6000,
      includeLayoutSegments: false,
      reason: 'atomic and review tasks only need nearby playlist facts',
    }
  }
  if (scenario === 'layout_reference' && hasDraft && playlistType === 'tv') {
    return {
      scheduleItemLimit: 12,
      layoutSegmentLimit: 12,
      latestUserInputLimit: 1200,
      maxPromptChars: 12000,
      includeLayoutSegments: true,
      reason: 'explicit draft tasks need draft structure plus a compact schedule summary',
    }
  }
  return {
    scheduleItemLimit: 12,
    layoutSegmentLimit: 0,
    latestUserInputLimit: 1200,
    maxPromptChars: 7000,
    includeLayoutSegments: false,
    reason: 'intent is decided by LLM; context includes neutral current workspace facts',
  }
}

const compactText = (value: string, limit: number): string => {
  if (value.length <= limit) return value
  return `${value.slice(0, Math.max(0, limit - 12))}...已截断`
}

const compactOptionalText = (value: string | undefined, limit: number): string | undefined =>
  value === undefined ? undefined : compactText(value, limit)

const compactReactTaskStep = (
  step: ReactTaskRun['steps'][number],
): NonNullable<ForegroundAgentContextPackage['reactTask']['pendingSteps']>[number] => {
  const action = typeof step.action === 'object' && step.action !== null
    ? step.action as Record<string, unknown>
    : {}
  const queries = Array.isArray(action.queries)
    ? action.queries
      .filter((item): item is string => typeof item === 'string')
      .map((item) => compactText(item, 60))
      .slice(0, 5)
    : undefined
  return {
    type: typeof action.type === 'string' ? action.type : undefined,
    targetTime: typeof action.targetTime === 'string' ? action.targetTime : undefined,
    semanticLabel: typeof action.semanticLabel === 'string' ? compactText(action.semanticLabel, 80) : undefined,
    targetSegmentIndex: typeof action.targetSegmentIndex === 'number' ? action.targetSegmentIndex : undefined,
    targetSegmentLabel: typeof action.targetSegmentLabel === 'string' ? compactText(action.targetSegmentLabel, 80) : undefined,
    queries,
    reason: step.reason ? compactText(step.reason, 100) : undefined,
  }
}

const isOverTextLimit = (value: string | undefined, limit: number): boolean =>
  typeof value === 'string' && value.length > limit

const estimatePromptChars = (contextPackage: ForegroundAgentContextPackage): number =>
  PROMPT_PREFIX.length + JSON.stringify(buildBusinessContextForPrompt(contextPackage), null, 2).length

const finalizeContextBudget = (
  contextPackage: ForegroundAgentContextPackage,
): ForegroundAgentContextPackage['budget'] => {
  let budget = contextPackage.budget
  for (let index = 0; index < 4; index += 1) {
    const estimatedPromptChars = estimatePromptChars({
      ...contextPackage,
      budget,
    })
    const nextBudget = {
      ...budget,
      estimatedPromptChars,
      truncated: budget.truncated || estimatedPromptChars > budget.maxPromptChars,
    }
    if (
      nextBudget.estimatedPromptChars === budget.estimatedPromptChars
      && nextBudget.truncated === budget.truncated
    ) {
      return nextBudget
    }
    budget = nextBudget
  }
  return budget
}

const buildContextBudget = (input: {
  packageWithoutBudget: Omit<ForegroundAgentContextPackage, 'budget'>
  originalUserInput: string
  originalScheduleItemCount: number
  originalLayoutSegmentCount: number
  scheduleTextCompacted: boolean
  layoutTextCompacted: boolean
}): ForegroundAgentContextPackage['budget'] => {
  const omittedScheduleItems = Math.max(
    0,
    input.originalScheduleItemCount - input.packageWithoutBudget.workspace.scheduleSummary.length,
  )
  const omittedLayoutSegments = Math.max(
    0,
    input.originalLayoutSegmentCount - (input.packageWithoutBudget.layoutDraft.segments?.length ?? 0),
  )
  const omissions: ForegroundAgentContextPackage['budget']['omissions'] = []
  if (input.originalUserInput !== input.packageWithoutBudget.latestUserInput) omissions.push('latest_user_input')
  if (omittedScheduleItems > 0 || input.scheduleTextCompacted) omissions.push('schedule_summary')
  if (
    (omittedLayoutSegments > 0 && input.packageWithoutBudget.injectionProfile.includeLayoutSegments)
    || input.layoutTextCompacted
  ) omissions.push('layout_segments')
  return {
    estimatedPromptChars: 0,
    maxPromptChars: input.packageWithoutBudget.injectionProfile.maxPromptChars,
    truncated: omissions.length > 0,
    omittedScheduleItems,
    omittedLayoutSegments,
    omissions,
  }
}

const resolveAllowedActions = (
  playlistType: PlaylistType,
  scenario: ForegroundAgentScenario,
): string[] => {
  if (playlistType === 'none') return ['create_tv_playlist', 'create_rotation_playlist']
  if (scenario === 'review') return ['confirm', 'cancel', 'select', 'clarify', 'start_new_task']
  const base = ['insert', 'delete', 'move', 'replace', 'query', 'validate']
  return [...base, 'prepare_layout', 'full_generate', 'partial_generate', 'switch_layout_draft', 'generate_layout_draft', 'upload_layout_draft']
}
