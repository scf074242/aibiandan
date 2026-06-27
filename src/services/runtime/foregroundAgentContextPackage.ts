import type { LayoutDraft, PlaylistType, ScheduleState } from '@/types/orchestration'
import type { RuntimePendingCommand, RuntimeScheduleItem } from './demoRuntimeFacade'
import type { RuntimePendingAtomicContext } from './pendingAtomicContext'
import type { ReactTaskRun } from './reactTaskTypes'
import { buildScheduleWorkspaceSummary, resolveForegroundWorkspaceKey } from './foregroundWorkspaceState'
import { evaluateLayoutDraftCompleteness, type LayoutDraftCompleteness } from '@/services/layoutDraftCompleteness'

export type ForegroundAgentScenario =
  | 'atomic'
  | 'full_generate'
  | 'partial_generate'
  | 'layout_reference'
  | 'layout_draft_switch'
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
  action: string
  riskLevel: 'low' | 'medium' | 'high'
  allowedResponses: Array<'confirm' | 'cancel' | 'select' | 'clarify'>
  expiresOnNextNonAnswer: true
  summary: string
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

const ATOMIC_VERB_PATTERN = /(插入|插个|插一|插播|加播|添加|补点|填入|排入|放入|安排到|插到|排到|删除|删掉|移除|去掉|移动|移到|调到|调整到|放到|挪到|后移|前移|顺延|推迟|延迟|延后|提前|替换|换成|换播|改成|改为|查询|校验)/u
const FULL_GENERATE_PATTERN = /(全天|整天|全日).*(编排|排播|补排|生成)|帮我全天编排|全天编排/u
const PARTIAL_GENERATE_PATTERN = /(补齐|补全|填充).*(空窗|空档|缺口)|局部补排|补排/u
const FORMAL_DAYPART_GENERATE_PATTERN = /(上午|中午|午间|下午|晚间|晚上|夜间|黄金时段|黄金档|七点档|八点档).*(安排|编排|排入|排播|排满|铺满|补排|填充|改成|改为|统一成|调整为|主打|为主)/u
const FORMAL_TIME_RANGE_GENERATE_PATTERN = /\d{1,2}(?:点|时|:\d{2}|：\d{2})?(?:到|至|-|—|~)\d{1,2}(?:点|时|:\d{2}|：\d{2})?.*(安排|编排|排入|排播|排满|铺满|补排|填充|改成|改为|统一成|调整为|主打|为主)/u
const DRAFT_REFERENCE_PATTERN = /(参考|参照|依据|基于|按照|按|照|使用|用).*(草案|版面)|(?:当前|这个|该|刚才的|原来的).*(草案|版面).*(编排|补排|补齐|填充|生成正式编排单|开始编排)/u
const DRAFT_SWITCH_PATTERN = /(?:切换|切到|切回|换成|改用|启用|恢复).*(版面|草案)|(?:使用|用).*(上传|导入|默认|频道|固定|当前频道).*(版面|草案)/u
const PROMPT_PREFIX = '【统一前台上下文包】\n'
const SUMMARY_FIELD_LIMIT = 80

export const buildForegroundAgentContextPackage = (
  input: BuildForegroundAgentContextPackageInput,
): ForegroundAgentContextPackage => {
  const review = buildPendingReviewSnapshot(input.pendingCommand, input.pendingAtomicContext)
  const activeReactTaskRun = input.activeReactTaskRun ?? null
  const lastObservation = activeReactTaskRun?.observations.at(-1)
  const scenario = inferScenario(input.latestUserInput, review, input.pendingAtomicContext)
  const normalizedInput = normalizeText(input.latestUserInput)
  const referencedByCurrentTask = DRAFT_REFERENCE_PATTERN.test(normalizedInput)
    || (scenario === 'layout_draft_switch')
  const draft = input.currentLayoutDraft ?? null
  const draftCompleteness = evaluateLayoutDraftCompleteness(draft)
  const profile = resolveInjectionProfile(scenario, draftCompleteness.status)
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
    allowedActions: resolveAllowedActions(input.scheduleState.playlistType ?? 'none', scenario, draftCompleteness.status),
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

  if (input.pendingAtomicContext?.agentPendingTask) {
    return {
      hasPendingReview: true,
      canUsePendingReview: true,
      shouldExpire: false,
    }
  }

  const scenario = inferScenario(input.latestUserInput, review)
  if (scenario !== 'review') {
    return {
      hasPendingReview: true,
      canUsePendingReview: false,
      shouldExpire: true,
      expireReason: 'next_non_answer',
    }
  }

  return {
    hasPendingReview: true,
    canUsePendingReview: true,
    shouldExpire: false,
  }
}

const inferScenario = (
  latestUserInput: string,
  review: PendingReviewSnapshot | null,
  pendingAtomicContext?: RuntimePendingAtomicContext | null,
): ForegroundAgentScenario => {
  const normalized = normalizeText(latestUserInput)
  if (review && isStrongReviewResponse(normalized, review)) return 'review'
  if (
    pendingAtomicContext
    && (
      pendingAtomicContext.phase === 'clarifying'
      || pendingAtomicContext.phase === 'selecting_target'
      || pendingAtomicContext.phase === 'recommending_insert'
      || Boolean(pendingAtomicContext.agentPendingTask)
    )
  ) return 'atomic'
  if (DRAFT_SWITCH_PATTERN.test(normalized) && /版面|草案/u.test(normalized)) return 'layout_draft_switch'
  if (DRAFT_REFERENCE_PATTERN.test(normalized)) return 'layout_reference'
  if (FULL_GENERATE_PATTERN.test(normalized)) return 'full_generate'
  if (
    PARTIAL_GENERATE_PATTERN.test(normalized)
    || FORMAL_DAYPART_GENERATE_PATTERN.test(normalized)
    || FORMAL_TIME_RANGE_GENERATE_PATTERN.test(normalized)
  ) return 'partial_generate'
  if (ATOMIC_VERB_PATTERN.test(normalized)) return 'atomic'
  return 'general'
}

const buildPendingReviewSnapshot = (
  pendingCommand?: RuntimePendingCommand | null,
  pendingAtomicContext?: RuntimePendingAtomicContext | null,
): PendingReviewSnapshot | null => {
  if (pendingCommand) {
    return {
      kind: 'command',
      action: pendingCommand.command.action,
      riskLevel: pendingCommand.command.action === 'delete' || pendingCommand.command.action === 'replace' ? 'high' : 'medium',
      allowedResponses: ['confirm', 'cancel'],
      expiresOnNextNonAnswer: true,
      summary: pendingCommand.summary,
    }
  }

  if (!pendingAtomicContext) return null
  if (pendingAtomicContext.formalRebuildConfirmation || pendingAtomicContext.phase === 'formal_rebuild_confirmation') {
    return {
      kind: 'formal_rebuild',
      action: 'formal_rebuild',
      riskLevel: 'high',
      allowedResponses: ['confirm', 'cancel'],
      expiresOnNextNonAnswer: true,
      summary: pendingAtomicContext.summary,
    }
  }
  if (pendingAtomicContext.layoutDraftSuggestion) {
    return {
      kind: 'layout_draft_update',
      action: 'update_layout_draft',
      riskLevel: 'low',
      allowedResponses: ['confirm', 'cancel'],
      expiresOnNextNonAnswer: true,
      summary: pendingAtomicContext.summary,
    }
  }
  if (pendingAtomicContext.compositeTaskRun?.status === 'waiting_confirm') {
    return {
      kind: 'command',
      action: pendingAtomicContext.action ?? pendingAtomicContext.compositeTaskRun.stages[0]?.action ?? 'confirm',
      riskLevel: pendingAtomicContext.action === 'delete' || pendingAtomicContext.action === 'replace' ? 'high' : 'medium',
      allowedResponses: ['confirm', 'cancel'],
      expiresOnNextNonAnswer: true,
      summary: pendingAtomicContext.summary,
    }
  }
  if (pendingAtomicContext.agentPendingTask?.phase === 'needs_confirmation') {
    return {
      kind: 'command',
      action: pendingAtomicContext.action ?? pendingAtomicContext.agentPendingTask.intent ?? 'confirm',
      riskLevel: pendingAtomicContext.action === 'delete' || pendingAtomicContext.action === 'replace' ? 'high' : 'medium',
      allowedResponses: ['confirm', 'cancel'],
      expiresOnNextNonAnswer: true,
      summary: pendingAtomicContext.summary,
    }
  }
  return null
}

const resolveInjectionProfile = (
  scenario: ForegroundAgentScenario,
  draftCompletenessStatus: LayoutDraftCompleteness['status'] = 'missing',
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
  if (scenario === 'layout_reference' || scenario === 'layout_draft_switch') {
    return {
      scheduleItemLimit: 12,
      layoutSegmentLimit: 12,
      latestUserInputLimit: 1200,
      maxPromptChars: 12000,
      includeLayoutSegments: true,
      reason: 'explicit draft tasks need draft structure plus a compact schedule summary',
    }
  }
  if (scenario === 'full_generate') {
    if (draftCompletenessStatus === 'partial' || draftCompletenessStatus === 'complete') {
      return {
        scheduleItemLimit: 12,
        layoutSegmentLimit: 12,
        latestUserInputLimit: 1200,
        maxPromptChars: 12000,
        includeLayoutSegments: true,
        reason: 'full playlist generation needs the loaded draft structure as the all-day planning basis',
      }
    }
    return {
      scheduleItemLimit: 12,
      layoutSegmentLimit: 0,
      latestUserInputLimit: 1000,
      maxPromptChars: 7000,
      includeLayoutSegments: false,
      reason: 'full playlist generation uses the active playlist unless the user explicitly references a draft',
    }
  }
  if (scenario === 'partial_generate') {
    return {
      scheduleItemLimit: 12,
      layoutSegmentLimit: 0,
      latestUserInputLimit: 1000,
      maxPromptChars: 7000,
      includeLayoutSegments: false,
      reason: 'gap filling needs current playlist and gap counts without full draft expansion',
    }
  }
  return {
    scheduleItemLimit: 6,
    layoutSegmentLimit: 0,
    latestUserInputLimit: 600,
    maxPromptChars: 4500,
    includeLayoutSegments: false,
    reason: 'general routing keeps context small until intent is clear',
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
  draftCompletenessStatus: LayoutDraftCompleteness['status'],
): string[] => {
  if (playlistType === 'none') return ['create_tv_playlist', 'create_rotation_playlist']
  if (scenario === 'layout_draft_switch') return ['switch_layout_draft', 'generate_layout_draft', 'upload_layout_draft', 'cancel']
  if (scenario === 'full_generate') {
    if (playlistType === 'rotation') {
      return ['create_tv_playlist', 'open_tv_playlist', 'set_rotation_duration', 'switch_rotation_strategy', 'upload_layout_draft', 'generate_layout_draft', 'cancel']
    }
    if (playlistType === 'tv' && (draftCompletenessStatus === 'missing' || draftCompletenessStatus === 'empty')) {
      return ['load_channel_layout_draft', 'upload_layout_draft', 'switch_layout_draft', 'partial_generate', 'cancel']
    }
    if (playlistType === 'tv' && draftCompletenessStatus === 'partial') {
      return ['continue_layout_draft', 'partial_generate', 'upload_layout_draft', 'switch_layout_draft', 'cancel']
    }
    return ['full_generate', 'cancel']
  }
  if (scenario === 'partial_generate') {
    if (playlistType === 'rotation' && (draftCompletenessStatus === 'missing' || draftCompletenessStatus === 'empty')) {
      return ['upload_layout_draft', 'generate_layout_draft', 'cancel']
    }
    return ['partial_generate', 'cancel']
  }
  if (scenario === 'review') return ['confirm', 'cancel', 'select', 'clarify', 'start_new_task']
  const base = ['insert', 'delete', 'move', 'replace', 'query', 'validate']
  return playlistType === 'tv'
    ? [...base, 'prepare_layout', 'full_generate', 'partial_generate']
    : base
}

const isStrongReviewResponse = (normalized: string, review: PendingReviewSnapshot): boolean => {
  if (
    review.kind === 'formal_rebuild'
    && /^(确认重新编排|确认重排|重新编排|重排|确认覆盖|覆盖吧|开始重新编排|开始重排|开始编排|按这个重新编排|按草案重新编排|按当前草案重新编排|按这个开始编排|可以重新编排|可以重排)$/iu.test(normalized)
  ) return review.allowedResponses.includes('confirm')
  if (
    review.kind === 'layout_draft_update'
    && /^(可以|好的|好|确认|确定|更新|更新草案|更新到草案|写入草案|改到草案|改进草案|就按这个|就这个|用这个|用这个方向|按这个方向|没问题|ok|yes)$/iu.test(normalized)
  ) return review.allowedResponses.includes('confirm')
  if (/^(确认|确定|执行|可以|好的|好|ok|yes)$/iu.test(normalized)) return review.allowedResponses.includes('confirm')
  if (/^(取消|不用了|算了|先不用|no|cancel)$/iu.test(normalized)) return review.allowedResponses.includes('cancel')
  if (/^(第?[一二三四五六七八九十123456789]|选.+|用.+)$/iu.test(normalized)) return review.allowedResponses.includes('select')
  return false
}

const normalizeText = (value: string): string => value.replace(/\s+/g, '')
