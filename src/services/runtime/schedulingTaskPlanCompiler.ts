import type { AgentTaskPlanDraft, AgentTaskPlanStageDraft } from '@/services/agent/types'
import type { RuntimeScheduleItem } from './demoRuntimeFacade'
import type { RuntimePlaylistPolicy } from './playlistPolicy'
import {
  DEFAULT_SCHEDULING_TASK_LIMITS,
  type SchedulingTaskLimits,
  type SchedulingTaskRun,
  type SchedulingTaskStage,
} from './schedulingTaskPlan'

export type SchedulingTaskCompileStatus = 'compiled' | 'blocked' | 'unsupported'

export interface SchedulingTaskCompileInput {
  draft: AgentTaskPlanDraft
  userInput: string
  currentSchedule: RuntimeScheduleItem[]
  playlistPolicy?: RuntimePlaylistPolicy
  limits?: SchedulingTaskLimits
  now?: string
}

export type SchedulingTaskCompileResult =
  | {
    status: 'compiled'
    taskRun: SchedulingTaskRun
    matchedItems: RuntimeScheduleItem[]
  }
  | {
    status: 'blocked'
    reason: 'target_not_found' | 'too_many_matches' | 'missing_target' | 'needs_candidate_selection'
    message: string
    details: Record<string, unknown>
  }
  | {
    status: 'unsupported'
    reason: string
  }

export interface BatchDeleteTaskObservation<T extends RuntimeScheduleItem = RuntimeScheduleItem> {
  targetLabel: string
  targetText: string
  deleteIds: Set<string>
  affectedItems: T[]
  remainingItems: T[]
  previousRemaining: number
  expectedRemainingAfterBatch: number
  committed: boolean
}

export const compileSchedulingTaskPlanDraft = (
  input: SchedulingTaskCompileInput,
): SchedulingTaskCompileResult => {
  const firstStage = input.draft.stages[0]
  if (!firstStage) {
    return { status: 'unsupported', reason: 'empty_task_plan' }
  }
  const insertWithShift = resolveInsertWithShiftTask(input)
  if (insertWithShift) {
    return insertWithShift
  }
  const batchReplace = resolveBatchReplaceTask(input)
  if (batchReplace) {
    return batchReplace
  }
  if (firstStage.type !== 'batch_atomic' || !['delete', 'batch_delete'].includes(firstStage.action ?? '')) {
    return { status: 'unsupported', reason: 'only_batch_delete_insert_shift_or_batch_replace_supported' }
  }

  const batchTarget = resolveBatchDeleteTarget(firstStage, input.draft.goal, input.userInput)
  if (!batchTarget) {
    return {
      status: 'blocked',
      reason: 'missing_target',
      message: '我理解这是批量删除任务，但还缺少要删除的节目名、栏目名或明确时段。',
      details: {
        goal: input.draft.goal,
        stage: firstStage,
      },
    }
  }

  const limits = input.limits ?? DEFAULT_SCHEDULING_TASK_LIMITS
  const matchedItems = batchTarget.matchKind === 'time_range'
    ? findSchedulingTaskTimeRangeMatches(input.currentSchedule, batchTarget.rangeStart, batchTarget.rangeEnd)
    : findSchedulingTaskProgramMatches(input.currentSchedule, batchTarget.targetLabel)
  if (matchedItems.length === 0) {
    return {
      status: 'blocked',
      reason: 'target_not_found',
      message: batchTarget.matchKind === 'time_range'
        ? `我查了当前播单，${batchTarget.targetLabel} 时段里没有节目可删。`
        : `我查了当前播单，没有找到《${batchTarget.targetLabel}》。你可以换一个栏目名或节目名再试。`,
      details: {
        targetLabel: batchTarget.targetLabel,
        matchKind: batchTarget.matchKind,
        matchedCount: 0,
      },
    }
  }

  const batchItems = matchedItems.slice(0, limits.maxStepsPerStage)
  const includeDraftRefillAfterFinalBatch = input.draft.stages.some((stage) =>
    stage.type === 'draft_refill' || stage.requiresLayoutDraft === true || stage.layoutDraftReferenced === true,
  ) && input.playlistPolicy?.playlistType !== 'rotation'
  return {
    status: 'compiled',
    matchedItems,
    taskRun: buildBatchDeleteSchedulingTaskRun({
      userInput: input.userInput,
      matchKind: batchTarget.matchKind,
      targetLabel: batchTarget.targetLabel,
      matchedItems: batchItems,
      totalMatched: matchedItems.length,
      processedCount: 0,
      remainingCount: matchedItems.length,
      batchIndex: 1,
      includeDraftRefillAfterFinalBatch,
      playlistPolicy: input.playlistPolicy,
      limits,
      now: input.now,
    }),
  }
}

const resolveBatchReplaceTask = (input: SchedulingTaskCompileInput): SchedulingTaskCompileResult | null => {
  const firstStage = input.draft.stages[0]
  if (firstStage?.type !== 'batch_atomic' || firstStage.action !== 'replace') return null

  const replaceTarget = resolveBatchReplaceTarget(firstStage, input.draft.goal, input.userInput)
  const replacementHint = firstStage.target?.replacementHint
    ?? extractReplacementHintFromText(firstStage.summary ?? '')
    ?? extractReplacementHintFromText(input.draft.goal)
    ?? extractReplacementHintFromText(input.userInput)
  if (!replaceTarget || !replacementHint) {
    return {
      status: 'blocked',
      reason: 'missing_target',
      message: '我理解这是批量替换任务，但还缺少要替换的节目范围，或要换成什么内容。',
      details: {
        goal: input.draft.goal,
        stage: firstStage,
        replacementHint,
      },
    }
  }

  const matchedItems = replaceTarget.matchKind === 'time_range'
    ? findSchedulingTaskTimeRangeMatches(input.currentSchedule, replaceTarget.rangeStart, replaceTarget.rangeEnd)
    : findSchedulingTaskProgramMatches(input.currentSchedule, replaceTarget.targetLabel)
  if (matchedItems.length === 0) {
    return {
      status: 'blocked',
      reason: 'target_not_found',
      message: replaceTarget.matchKind === 'time_range'
        ? `我查了当前播单，${replaceTarget.targetLabel} 时段里没有节目可替换。`
        : `我查了当前播单，没有找到要替换的《${replaceTarget.targetLabel}》。`,
      details: {
        targetLabel: replaceTarget.targetLabel,
        matchKind: replaceTarget.matchKind,
        replacementHint,
        matchedCount: 0,
      },
    }
  }

  const limits = input.limits ?? DEFAULT_SCHEDULING_TASK_LIMITS
  if (matchedItems.length > limits.maxStepsPerStage) {
    return {
      status: 'blocked',
      reason: 'too_many_matches',
      message: `我找到了 ${matchedItems.length} 条要替换的节目。批量替换会影响较大，请先缩小范围，或分时段处理。`,
      details: {
        targetLabel: replaceTarget.targetLabel,
        matchKind: replaceTarget.matchKind,
        replacementHint,
        matchedCount: matchedItems.length,
        taskLimit: limits.maxStepsPerStage,
      },
    }
  }

  return {
    status: 'blocked',
    reason: 'needs_candidate_selection',
    message: `我找到了 ${matchedItems.length} 条要替换的节目，也理解你想换成“${replacementHint}”。批量替换需要先逐条确认候选或选择替换策略，我不会自动套用候选。`,
    details: {
      targetLabel: replaceTarget.targetLabel,
      matchKind: replaceTarget.matchKind,
      replacementHint,
      matchedCount: matchedItems.length,
      matchedItems: matchedItems.map((item) => ({
        id: item.id,
        programName: item.programName,
        startTime: item.startTime,
        endTime: item.endTime,
        duration: item.duration,
      })),
      nextStep: 'candidate_selection_required',
    },
  }
}

const resolveInsertWithShiftTask = (input: SchedulingTaskCompileInput): SchedulingTaskCompileResult | null => {
  const stages = input.draft.stages
  const moveStage = stages.find((stage) => stage.type === 'batch_atomic' && stage.action === 'move')
  const insertStage = stages.find((stage) => stage.type === 'atomic' && stage.action === 'insert')
  if (!moveStage || !insertStage) return null

  const targetTime = normalizeSchedulingTaskClock(insertStage.target?.targetTime)
  const durationSeconds = insertStage.target?.durationSeconds
  const programName = insertStage.target?.programName
  if (!targetTime || !programName || !durationSeconds || durationSeconds <= 0) {
    return {
      status: 'blocked',
      reason: 'missing_target',
      message: '我理解这是插入并后移的任务，但还缺少插入时间、节目名称或节目时长。',
      details: {
        goal: input.draft.goal,
        insertStage,
      },
    }
  }

  const affectedItems = resolveInsertShiftAffectedItems(input.currentSchedule, moveStage, targetTime)
  if (affectedItems.length === 0) {
    return {
      status: 'blocked',
      reason: 'target_not_found',
      message: `${targetTime} 后没有找到需要后移的节目。你可以改成普通插入，或确认要插入的位置。`,
      details: {
        targetTime,
        matchedCount: 0,
        moveStage,
      },
    }
  }

  const limits = input.limits ?? DEFAULT_SCHEDULING_TASK_LIMITS
  if (affectedItems.length > limits.maxStepsPerStage) {
    return {
      status: 'blocked',
      reason: 'too_many_matches',
      message: `${targetTime} 后会影响 ${affectedItems.length} 条节目，单次最多先处理 ${limits.maxStepsPerStage} 条。请缩小时间范围，或改成分段后移。`,
      details: {
        targetTime,
        matchedCount: affectedItems.length,
        taskLimit: limits.maxStepsPerStage,
      },
    }
  }

  return {
    status: 'compiled',
    matchedItems: affectedItems,
    taskRun: buildInsertWithShiftSchedulingTaskRun({
      userInput: input.userInput,
      goal: input.draft.goal,
      targetTime,
      candidateId: insertStage.target?.candidateId ?? insertStage.target?.candidateCode ?? normalizeSchedulingTaskProgramName(programName),
      candidateCode: insertStage.target?.candidateCode,
      candidateProgramType: insertStage.target?.programType,
      programName,
      durationSeconds,
      affectedItems,
      playlistPolicy: input.playlistPolicy,
      limits,
      now: input.now,
    }),
  }
}

export const buildInsertWithShiftSchedulingTaskRun = (input: {
  userInput: string
  goal?: string
  targetTime: string
  candidateId: string
  candidateCode?: string
  candidateProgramType?: string
  programName: string
  durationSeconds: number
  affectedItems: RuntimeScheduleItem[]
  playlistPolicy?: RuntimePlaylistPolicy
  limits?: SchedulingTaskLimits
  now?: string
}): SchedulingTaskRun => {
  const limits = input.limits ?? DEFAULT_SCHEDULING_TASK_LIMITS
  const now = input.now ?? new Date().toISOString()
  const shiftStage: SchedulingTaskStage = {
    id: `stage_shift_${Date.now()}`,
    type: 'batch_atomic',
    status: 'waiting_confirm',
    summary: `将 ${input.targetTime} 起受影响的 ${input.affectedItems.length} 条节目后移 ${formatSchedulingTaskDuration(input.durationSeconds)}`,
    action: 'move',
    requiresConfirmation: true,
    steps: input.affectedItems.map((item, index) => ({
      id: `move_${item.id || index}`,
      action: 'move',
      itemId: item.id,
      targetTime: toClockTextForSchedulingTask(item.startTime),
      newStartTime: offsetSchedulingTaskTime(item.startTime, input.durationSeconds),
      programName: item.programName,
      durationSeconds: input.durationSeconds,
      slots: {
        targetTime: toClockTextForSchedulingTask(item.startTime),
        targetItemId: item.id,
        targetItemName: item.programName,
        offsetSeconds: input.durationSeconds,
        direction: 'forward',
      },
    })),
  }
  const insertStage: SchedulingTaskStage = {
    id: `stage_insert_${Date.now()}`,
    type: 'atomic',
    status: 'pending',
    summary: `在 ${input.targetTime} 插入《${input.programName}》`,
    action: 'insert',
    requiresConfirmation: true,
    steps: [{
      id: `insert_${input.candidateId}`,
      action: 'insert',
      candidateId: input.candidateId,
      candidateCode: input.candidateCode,
      candidateProgramType: input.candidateProgramType,
      targetTime: input.targetTime,
      programName: input.programName,
      durationSeconds: input.durationSeconds,
      slots: {
        targetTime: input.targetTime,
        programName: input.programName,
        rawProgramText: input.programName,
      },
    }],
  }
  return {
    id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    goal: input.goal ?? `${input.targetTime} 插入《${input.programName}》，已有节目顺延`,
    originalUserInput: input.userInput,
    playlistPolicy: input.playlistPolicy,
    status: 'waiting_confirm',
    currentStageIndex: 0,
    loopCount: 0,
    limits,
    stages: [
      shiftStage,
      insertStage,
      {
        id: `stage_verify_${Date.now()}`,
        type: 'verify',
        status: 'pending',
        summary: '检查顺延后的时间轴',
        requiresConfirmation: false,
        verification: { type: 'time_axis_valid' },
      },
    ],
    createdAt: now,
    updatedAt: now,
  }
}

export const buildBatchDeleteSchedulingTaskRun = (input: {
  userInput: string
  targetLabel: string
  matchKind?: 'program' | 'time_range'
  matchedItems: RuntimeScheduleItem[]
  totalMatched?: number
  processedCount?: number
  remainingCount?: number
  batchIndex?: number
  includeDraftRefillAfterFinalBatch?: boolean
  playlistPolicy?: RuntimePlaylistPolicy
  limits?: SchedulingTaskLimits
  now?: string
}): SchedulingTaskRun => {
  const limits = input.limits ?? DEFAULT_SCHEDULING_TASK_LIMITS
  const now = input.now ?? new Date().toISOString()
  const totalMatched = input.totalMatched ?? input.matchedItems.length
  const processedCount = input.processedCount ?? 0
  const remainingCount = input.remainingCount ?? input.matchedItems.length
  const batchIndex = input.batchIndex ?? 1
  const matchKind = input.matchKind ?? 'program'
  const includeDraftRefillAfterFinalBatch = input.includeDraftRefillAfterFinalBatch ?? false
  const isChunked = totalMatched > input.matchedItems.length || batchIndex > 1 || matchKind === 'time_range'
  const expectedRemaining = Math.max(0, remainingCount - input.matchedItems.length)
  const targetText = formatSchedulingTaskTargetText(matchKind, input.targetLabel)
  const deleteStage: SchedulingTaskStage = {
    id: `stage_delete_${Date.now()}`,
    type: 'batch_atomic',
    status: 'waiting_confirm',
    summary: isChunked
      ? `先删除第 ${batchIndex} 批 ${input.matchedItems.length} 条${targetText}`
      : `删除当前播单里的 ${input.matchedItems.length} 条${targetText}`,
    action: 'delete',
    requiresConfirmation: true,
    steps: input.matchedItems.map((item, index) => ({
      id: `delete_${item.id || index}`,
      action: 'delete',
      itemId: item.id,
      targetTime: toClockTextForSchedulingTask(item.startTime),
      programName: item.programName,
      slots: {
        targetTime: toClockTextForSchedulingTask(item.startTime),
        targetItemId: item.id,
        targetItemName: item.programName,
        programName: matchKind === 'program' ? input.targetLabel : item.programName,
      },
    })),
    verification: {
      type: expectedRemaining > 0 ? 'batch_progress' : 'program_absent',
      programName: matchKind === 'program' ? input.targetLabel : undefined,
      expectedRemaining,
    },
  }
  const stages: SchedulingTaskStage[] = [deleteStage]
  if (includeDraftRefillAfterFinalBatch && expectedRemaining === 0) {
    stages.push({
      id: `stage_refill_${Date.now()}`,
      type: 'draft_refill',
      status: 'pending',
      summary: '按当前激活草案补齐删除后留下的空窗',
      requiresConfirmation: true,
      requiresLayoutDraft: true,
      verification: {
        type: 'gaps_handled',
      },
    })
  }
  if (input.playlistPolicy?.playlistType === 'rotation') {
    stages.push({
      id: `stage_rotation_verify_${Date.now()}`,
      type: 'verify',
      status: 'pending',
      summary: input.playlistPolicy.targetDurationSeconds
        ? '检查轮播单总时长差额和内容结构'
        : '检查轮播单队列串联和内容结构',
      requiresConfirmation: false,
      verification: {
        type: 'rotation_duration_balance',
        targetDurationSeconds: input.playlistPolicy.targetDurationSeconds,
      },
    })
  }
  stages.push({
    id: `stage_verify_${Date.now()}`,
    type: 'verify',
    status: 'pending',
    summary: expectedRemaining > 0
      ? `检查第 ${batchIndex} 批是否已经删完`
      : `检查当前播单里是否还剩${targetText}`,
    requiresConfirmation: false,
    verification: {
      type: expectedRemaining > 0 ? 'batch_progress' : 'program_absent',
      programName: input.targetLabel,
      expectedRemaining,
    },
  })

  return {
    id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    goal: stages.some((stage) => stage.type === 'draft_refill')
      ? `删除全部${targetText}，再按草案补齐空窗`
      : `删除全部${targetText}`,
    originalUserInput: input.userInput,
    playlistPolicy: input.playlistPolicy,
    status: 'waiting_confirm',
    currentStageIndex: 0,
    loopCount: 0,
    limits,
    stages,
    batch: isChunked
      ? {
          strategy: 'chunked',
          matchKind,
          targetLabel: input.targetLabel,
          totalMatched,
          processedCount,
          remainingCount,
          batchSize: limits.maxStepsPerStage,
          batchIndex,
          includeDraftRefillAfterFinalBatch,
        }
      : undefined,
    createdAt: now,
    updatedAt: now,
  }
}

export const findSchedulingTaskProgramMatches = <T extends RuntimeScheduleItem>(
  items: T[],
  programName: string,
): T[] => {
  const target = normalizeSchedulingTaskProgramName(programName)
  return items.filter((item) => {
    const itemName = normalizeSchedulingTaskProgramName(item.programName ?? '')
    return Boolean(itemName && target && itemName.includes(target))
  })
}

export const observeBatchDeleteSchedulingTask = <T extends RuntimeScheduleItem>(input: {
  before: T[]
  after: T[]
  taskRun: SchedulingTaskRun
  stage: SchedulingTaskStage
  writeSucceeded: boolean
}): BatchDeleteTaskObservation<T> => {
  const matchKind = input.taskRun.batch?.matchKind ?? 'program'
  const targetLabel = input.taskRun.batch?.targetLabel ?? input.stage.verification?.programName ?? ''
  const deleteIds = new Set((input.stage.steps ?? []).map((step) => step.itemId).filter((value): value is string => Boolean(value)))
  const affectedItems = input.before.filter((item) => deleteIds.has(item.id))
  const remainingItems = targetLabel
    ? matchKind === 'time_range'
      ? findSchedulingTaskTimeRangeMatchesByLabel(input.after, targetLabel)
      : findSchedulingTaskProgramMatches(input.after, targetLabel)
    : []
  const previousRemaining = input.taskRun.batch?.remainingCount
    ?? (targetLabel
      ? matchKind === 'time_range'
        ? findSchedulingTaskTimeRangeMatchesByLabel(input.before, targetLabel).length
        : findSchedulingTaskProgramMatches(input.before, targetLabel).length
      : affectedItems.length)
  const expectedRemainingAfterBatch = Math.max(0, previousRemaining - affectedItems.length)
  return {
    targetLabel,
    targetText: targetLabel ? formatSchedulingTaskTargetText(matchKind, targetLabel) : '目标节目',
    deleteIds,
    affectedItems,
    remainingItems,
    previousRemaining,
    expectedRemainingAfterBatch,
    committed: input.writeSucceeded
      && affectedItems.length === deleteIds.size
      && remainingItems.length <= expectedRemainingAfterBatch,
  }
}

export const normalizeSchedulingTaskProgramName = (value: string): string =>
  value
    .replace(/\s+/g, '')
    .replace(/[《》“”"'：:（）()【】\[\]、，,。.!！?？]/g, '')
    .replace(/节目$/u, '')
    .trim()

export const findSchedulingTaskTimeRangeMatches = <T extends RuntimeScheduleItem>(
  items: T[],
  rangeStart: string,
  rangeEnd: string,
): T[] => {
  const startSeconds = clockTextToSecondsForSchedulingTask(rangeStart)
  const endSeconds = clockTextToSecondsForSchedulingTask(rangeEnd)
  if (endSeconds <= startSeconds) return []
  return items.filter((item) => {
    const itemStart = clockTextToSecondsForSchedulingTask(item.startTime)
    const itemEnd = clockTextToSecondsForSchedulingTask(item.endTime)
    return itemStart < endSeconds && itemEnd > startSeconds
  })
}

const resolveInsertShiftAffectedItems = (
  items: RuntimeScheduleItem[],
  moveStage: AgentTaskPlanStageDraft,
  targetTime: string,
): RuntimeScheduleItem[] => {
  const structuredRange = normalizeSchedulingTaskRange(moveStage.target?.rangeStart, moveStage.target?.rangeEnd)
  if (structuredRange) {
    return findSchedulingTaskTimeRangeMatches(items, structuredRange.rangeStart, structuredRange.rangeEnd)
  }
  const targetSeconds = clockTextToSecondsForSchedulingTask(targetTime)
  return items.filter((item) => {
    const start = clockTextToSecondsForSchedulingTask(item.startTime)
    const end = clockTextToSecondsForSchedulingTask(item.endTime)
    return start >= targetSeconds || (start <= targetSeconds && targetSeconds < end)
  })
}

const resolveBatchDeleteTarget = (
  stage: AgentTaskPlanStageDraft,
  goal: string,
  userInput: string,
): { matchKind: 'program'; targetLabel: string } | { matchKind: 'time_range'; targetLabel: string; rangeStart: string; rangeEnd: string } | null => {
  const structuredRange = normalizeSchedulingTaskRange(stage.target?.rangeStart, stage.target?.rangeEnd)
  if (structuredRange && stage.target?.scope === 'time_range') {
    return {
      matchKind: 'time_range',
      targetLabel: formatSchedulingTaskRangeLabel(structuredRange.rangeStart, structuredRange.rangeEnd),
      ...structuredRange,
    }
  }
  const textRange = extractDeleteRangeFromText(userInput)
    ?? extractDeleteRangeFromText(stage.summary ?? '')
    ?? extractDeleteRangeFromText(goal)
  if (textRange) {
    return {
      matchKind: 'time_range',
      targetLabel: formatSchedulingTaskRangeLabel(textRange.rangeStart, textRange.rangeEnd),
      ...textRange,
    }
  }
  const structured = stage.target?.programName
  if (structured && normalizeSchedulingTaskProgramName(structured).length >= 2) {
    return { matchKind: 'program', targetLabel: normalizeSchedulingTaskProgramName(structured) }
  }
  const fromStage = extractDeleteTargetFromText(stage.summary ?? '')
  if (fromStage) return { matchKind: 'program', targetLabel: fromStage }
  const fromGoal = extractDeleteTargetFromText(goal)
  if (fromGoal) return { matchKind: 'program', targetLabel: fromGoal }
  const fromUserInput = extractDeleteTargetFromText(userInput)
  return fromUserInput ? { matchKind: 'program', targetLabel: fromUserInput } : null
}

const resolveBatchReplaceTarget = (
  stage: AgentTaskPlanStageDraft,
  goal: string,
  userInput: string,
): { matchKind: 'program'; targetLabel: string } | { matchKind: 'time_range'; targetLabel: string; rangeStart: string; rangeEnd: string } | null => {
  const structuredRange = normalizeSchedulingTaskRange(stage.target?.rangeStart, stage.target?.rangeEnd)
  if (structuredRange && stage.target?.scope === 'time_range') {
    return {
      matchKind: 'time_range',
      targetLabel: formatSchedulingTaskRangeLabel(structuredRange.rangeStart, structuredRange.rangeEnd),
      ...structuredRange,
    }
  }
  const textRange = extractReplaceRangeFromText(userInput)
    ?? extractReplaceRangeFromText(stage.summary ?? '')
    ?? extractReplaceRangeFromText(goal)
  if (textRange) {
    return {
      matchKind: 'time_range',
      targetLabel: formatSchedulingTaskRangeLabel(textRange.rangeStart, textRange.rangeEnd),
      ...textRange,
    }
  }
  const structured = stage.target?.programName
  if (structured && normalizeSchedulingTaskProgramName(structured).length >= 2) {
    return { matchKind: 'program', targetLabel: normalizeSchedulingTaskProgramName(structured) }
  }
  const fromStage = extractReplaceTargetFromText(stage.summary ?? '')
  if (fromStage) return { matchKind: 'program', targetLabel: fromStage }
  const fromGoal = extractReplaceTargetFromText(goal)
  if (fromGoal) return { matchKind: 'program', targetLabel: fromGoal }
  const fromUserInput = extractReplaceTargetFromText(userInput)
  return fromUserInput ? { matchKind: 'program', targetLabel: fromUserInput } : null
}

const extractDeleteTargetFromText = (value: string): string | null => {
  const normalized = value.replace(/\s+/g, '')
  const patterns = [
    /(?:删除|删掉|移除|去掉|撤掉)(?:当前播单(?:里|中)?|这张播单(?:里|中)?)?(?:全部|所有|全都)?(.+?)(?:节目|栏目)?(?:$|然后|再|，|,|。|；|;)/u,
    /(?:全部|所有|全都)(.+?)(?:节目|栏目)?(?:删除|删掉|移除|去掉|撤掉)/u,
  ]
  for (const pattern of patterns) {
    const candidate = pattern.exec(normalized)?.[1]
      ?.replace(/[《》“”"']/g, '')
      .replace(/节目$/u, '')
      .trim()
    if (candidate && candidate.length >= 2) return candidate
  }
  return null
}

const extractReplaceTargetFromText = (value: string): string | null => {
  const normalized = value.replace(/\s+/g, '')
  const patterns = [
    /(?:把|将)?(?:当前播单(?:里|中)?|这张播单(?:里|中)?)?(?:全部|所有|全都)?(.+?)(?:节目|栏目)?(?:替换成|替换为|换成|换为|改成|改为|换掉)/u,
    /(?:替换|换掉|改掉)(?:当前播单(?:里|中)?|这张播单(?:里|中)?)?(?:全部|所有|全都)?(.+?)(?:节目|栏目)?(?:为|成)/u,
  ]
  for (const pattern of patterns) {
    const candidate = pattern.exec(normalized)?.[1]
      ?.replace(/[《》“”"']/g, '')
      .replace(/节目$/u, '')
      .trim()
    if (candidate && candidate.length >= 2 && !/^\d{1,2}(点|:)/u.test(candidate)) return candidate
  }
  return null
}

const extractReplacementHintFromText = (value: string): string | null => {
  const normalized = value.replace(/\s+/g, '')
  const candidate = normalized.match(/(?:替换成|替换为|换成|换为|改成|改为)(.+?)(?:节目|栏目)?(?:$|，|,|。|；|;)/u)?.[1]
    ?? normalized.match(/(?:替换|换掉|改掉).+?(?:为|成)(.+?)(?:节目|栏目)?(?:$|，|,|。|；|;)/u)?.[1]
  const cleaned = candidate
    ?.replace(/[《》“”"']/g, '')
    .replace(/节目$/u, '')
    .trim()
  return cleaned && cleaned.length >= 2 ? cleaned : null
}

const toClockTextForSchedulingTask = (value: string): string =>
  value.includes('T') ? (value.split('T')[1]?.slice(0, 8) ?? value) : (value.length === 5 ? `${value}:00` : value)

const normalizeSchedulingTaskClock = (value?: string): string | null => {
  if (!value) return null
  const clock = toClockTextForSchedulingTask(value)
  if (!/^\d{1,2}(?::\d{2}){0,2}$/.test(clock)) return null
  const [hourText = '0', minuteText = '0', secondText = '0'] = clock.split(':')
  const hour = Number(hourText)
  const minute = Number(minuteText)
  const second = Number(secondText)
  if (![hour, minute, second].every(Number.isFinite)) return null
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) return null
  return `${`${hour}`.padStart(2, '0')}:${`${minute}`.padStart(2, '0')}:${`${second}`.padStart(2, '0')}`
}

const offsetSchedulingTaskTime = (value: string, offsetSeconds: number): string => {
  if (value.includes('T')) {
    const [datePart, timePart = ''] = value.split('T')
    const zoneMatch = timePart.match(/(Z|[+-]\d{2}:\d{2})$/)
    const zone = zoneMatch?.[1] ?? ''
    const clock = timePart.replace(/(Z|[+-]\d{2}:\d{2})$/, '')
    return `${datePart}T${offsetSchedulingTaskTime(clock, offsetSeconds)}${zone}`
  }
  const total = clockTextToSecondsForSchedulingTask(value) + offsetSeconds
  const normalized = ((total % (24 * 3600)) + 24 * 3600) % (24 * 3600)
  const hours = Math.floor(normalized / 3600)
  const minutes = Math.floor((normalized % 3600) / 60)
  const seconds = normalized % 60
  return `${`${hours}`.padStart(2, '0')}:${`${minutes}`.padStart(2, '0')}:${`${seconds}`.padStart(2, '0')}`
}

const formatSchedulingTaskDuration = (seconds: number): string => {
  if (seconds % 3600 === 0) return `${seconds / 3600}小时`
  if (seconds % 60 === 0) return `${seconds / 60}分钟`
  return `${seconds}秒`
}

const clockTextToSecondsForSchedulingTask = (value: string): number => {
  const [hours = '0', minutes = '0', seconds = '0'] = toClockTextForSchedulingTask(value).split(':')
  return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds)
}

const normalizeSchedulingTaskRange = (
  rangeStart?: string,
  rangeEnd?: string,
): { rangeStart: string; rangeEnd: string } | null => {
  if (!rangeStart || !rangeEnd) return null
  const start = toClockTextForSchedulingTask(rangeStart)
  const end = toClockTextForSchedulingTask(rangeEnd)
  if (!/^\d{2}:\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}:\d{2}$/.test(end)) return null
  if (clockTextToSecondsForSchedulingTask(end) <= clockTextToSecondsForSchedulingTask(start)) return null
  return { rangeStart: start, rangeEnd: end }
}

const parseSchedulingTaskRangeLabel = (value: string): { rangeStart: string; rangeEnd: string } | null => {
  const [rangeStart, rangeEnd] = value.split('-')
  return normalizeSchedulingTaskRange(rangeStart, rangeEnd)
}

const findSchedulingTaskTimeRangeMatchesByLabel = <T extends RuntimeScheduleItem>(
  items: T[],
  targetLabel: string,
): T[] => {
  const range = parseSchedulingTaskRangeLabel(targetLabel)
  if (!range) return []
  return findSchedulingTaskTimeRangeMatches(items, range.rangeStart, range.rangeEnd)
}

const formatSchedulingTaskRangeLabel = (rangeStart: string, rangeEnd: string): string =>
  `${rangeStart}-${rangeEnd}`

const formatSchedulingTaskTargetText = (
  matchKind: 'program' | 'time_range',
  targetLabel: string,
): string => matchKind === 'time_range' ? ` ${targetLabel} 时段内的节目` : `《${targetLabel}》`

const extractDeleteRangeFromText = (value: string): { rangeStart: string; rangeEnd: string } | null => {
  const normalized = value.replace(/\s+/g, '')
  if (!/(删除|删掉|移除|去掉|撤掉|清空|清掉)/u.test(normalized)) return null
  return extractSchedulingTaskRange(normalized)
}

const extractReplaceRangeFromText = (value: string): { rangeStart: string; rangeEnd: string } | null => {
  const normalized = value.replace(/\s+/g, '')
  if (!/(替换|换成|换为|换掉|改成|改为|改掉)/u.test(normalized)) return null
  return extractSchedulingTaskRange(normalized)
}

const extractSchedulingTaskRange = (normalized: string): { rangeStart: string; rangeEnd: string } | null => {
  const match = normalized.match(/(\d{1,2})(?::?(\d{2}))?(?:点|:00)?(?:到|至|-|~)(\d{1,2})(?::?(\d{2}))?(?:点|:00)?/u)
  if (!match) return null
  const startHour = Number(match[1])
  const startMinute = Number(match[2] ?? '0')
  const endHour = Number(match[3])
  const endMinute = Number(match[4] ?? '0')
  if (![startHour, startMinute, endHour, endMinute].every(Number.isFinite)) return null
  if (startHour < 0 || startHour > 23 || endHour < 0 || endHour > 24) return null
  if (startMinute < 0 || startMinute > 59 || endMinute < 0 || endMinute > 59) return null
  const rangeStart = `${`${startHour}`.padStart(2, '0')}:${`${startMinute}`.padStart(2, '0')}:00`
  const rangeEnd = `${`${endHour}`.padStart(2, '0')}:${`${endMinute}`.padStart(2, '0')}:00`
  return normalizeSchedulingTaskRange(rangeStart, rangeEnd)
}
