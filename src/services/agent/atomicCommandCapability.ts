import type { ScheduleItemSnapshot } from '@/types/orchestration'
import { parseAtomicOffset } from '@/services/atomicOffsetParser'
import { parseAtomicClockExpression, parseAtomicClockExpressions, parseAtomicTimeRange } from '@/services/atomicTimeParser'
import { continuePendingTask, createPendingTask } from './agentSession'
import { AgentConstraintEngine } from './constraintEngine'
import {
  buildAgentPendingContextFingerprint,
  buildAgentPendingContextSourceSnapshots,
  buildScheduleContextFingerprint,
} from './contextFingerprint'
import { AgentPlaylistPolicy } from './playlistPolicy'
import { buildSearchFacets as buildAgentSearchFacets } from './searchFacets'
import { AgentTvSequenceCandidateSelector } from './tvSequenceCandidateSelector'
import type {
  AgentCapability,
  AgentCapabilityRuntime,
  AgentCandidateRecommendation,
  AgentCandidateSelectionDiagnostics,
  AgentCandidateAssessmentSignal,
  AgentCandidateProfessionalAssessment,
  AgentConstraintIssue,
  AgentBroadcastReadinessEvidence,
  AgentExecutionResult,
  AgentPendingContextSourceSnapshot,
  AgentPendingTask,
  AgentQueryResult,
  AgentProgramCandidate,
  AgentPreview,
  AgentResult,
  AgentSlotBag,
  AgentSubmitInput,
  AgentTargetOption,
  AtomicCommandIntent,
  BatchDeleteCommandPlan,
  BatchMoveCommandPlan,
  DeleteCommandPlan,
  InsertCommandPlan,
  MoveCommandPlan,
  QueryCommandPlan,
  ReplaceCommandPlan,
  SchedulingContext,
  ValidateCommandPlan,
} from './types'
import { normalizeDateTime, offsetDateTime, sortScheduleItems, toClockText } from './time'

type InsertSlots = {
  targetTime?: string
  programHint?: string
  selectedCandidateId?: string
}

type MoveSlots = {
  targetTime?: string
  targetItemId?: string
  targetProgramName?: string
  offsetSeconds?: number
  newStartTime?: string
}

type BatchMoveSlots = {
  rangeStart?: string
  rangeEnd?: string
  targetRange?: { start: string; end: string }
  offsetSeconds?: number
}

type BatchDeleteSlots = {
  rangeStart?: string
  rangeEnd?: string
  targetRange?: { start: string; end: string }
}

type DeleteSlots = {
  targetTime?: string
  targetItemId?: string
  targetProgramName?: string
}

type ReplaceSlots = {
  targetTime?: string
  targetItemId?: string
  targetProgramName?: string
  replacementHint?: string
  selectedCandidateId?: string
}

type CandidateSelectionResult = {
  candidate: AgentProgramCandidate | null
  candidateOptions?: AgentProgramCandidate[]
  diagnostics: AgentCandidateSelectionDiagnostics
}

type CandidateJudgePool = {
  candidates: AgentProgramCandidate[]
  assessments: Record<string, AgentCandidateProfessionalAssessment>
}

type CandidateSearchAttempt = {
  keyword: string
  source: 'primary' | 'llm_alternative' | 'fallback'
  candidateCount: number
  candidateIds: string[]
}

type CandidatePoolResolution = {
  candidates: AgentProgramCandidate[]
  attempts: CandidateSearchAttempt[]
  matchedBy: 'primary' | 'rewritten_keywords' | 'none'
}

type RecommendationBuildOptions = {
  selectedCandidate?: AgentProgramCandidate
  assessmentByCandidateId?: Record<string, AgentCandidateProfessionalAssessment | undefined>
}

export class AtomicCommandCapability implements AgentCapability {
  readonly id = 'atomic_command'
  private readonly constraintEngine = new AgentConstraintEngine()
  private readonly playlistPolicy = new AgentPlaylistPolicy()
  private readonly tvSequenceSelector = new AgentTvSequenceCandidateSelector()

  canHandle(input: AgentSubmitInput): boolean {
    if (input.interpretation?.intent) return true
    if (input.pendingTask?.intent === 'move') return true
    if (input.pendingTask?.intent === 'insert') return true
    if (input.pendingTask?.intent === 'delete') return true
    if (input.pendingTask?.intent === 'replace') return true
    if (input.pendingTask?.intent === 'batch_move') return true
    if (input.pendingTask?.intent === 'batch_delete') return true
    return /(移动|移到|调到|调整到|改到|挪到|放到|排到|后移|前移|挪|推迟|推后|延后|提前|顺延|延迟|整体|批量|插入|添加|删除|删掉|替换|换成|改成|改为|换播|校验|检查|体检|问题|冲突|重叠|查询|查找|查看|看看|有哪些|是什么|在哪里|在哪儿|在哪|哪里|什么时候播|几点播|播出时间|排在几点|move|insert|delete|replace|validate|query)/iu.test(input.userInput)
  }

  async handle(input: AgentSubmitInput, runtime: AgentCapabilityRuntime): Promise<AgentResult> {
    runtime.trace.record('understanding', 'Recognize atomic scheduling command intent.', { userInput: input.userInput })
    if (input.pendingTask?.intent && input.interpretation?.pendingAction === 'cancel_pending') {
      return this.buildPendingCancelledResult(input, runtime, input.pendingTask.intent, 'pending task was cancelled by the user.')
    }

    if (input.pendingTask?.intent && input.interpretation?.pendingAction === 'start_new_task') {
      runtime.trace.record('understanding', 'pending task bypassed because the current input starts a new scheduling command', {
        pendingTaskId: input.pendingTask.id,
        pendingIntent: input.pendingTask.intent,
        newIntent: input.interpretation.intent,
      })
      input = {
        ...input,
        pendingTask: undefined,
      }
    }

    if (input.pendingTask) {
      const staleReason = this.getPendingTaskStaleReason(input.pendingTask)
      if (staleReason) {
        return this.buildPendingStaleResult(input, runtime, input.pendingTask, staleReason)
      }
    }

    if (input.pendingTask?.intent === 'move') {
      return this.continuePendingMove(input, runtime)
    }
    if (input.pendingTask?.intent === 'insert') {
      return this.continuePendingInsert(input, runtime)
    }
    if (input.pendingTask?.intent === 'delete') {
      return this.continuePendingDelete(input, runtime, input.pendingTask)
    }
    if (input.pendingTask?.intent === 'replace') {
      return this.continuePendingReplace(input, runtime)
    }
    if (input.pendingTask?.intent === 'batch_move') {
      return this.continuePendingBatchMove(input, runtime)
    }
    if (input.pendingTask?.intent === 'batch_delete') {
      if (input.pendingTask.phase !== 'needs_confirmation') {
        return this.continuePendingBatchDelete(input, runtime)
      }
      return this.confirmPendingBatchDelete(input, runtime, input.pendingTask)
    }

    const intent = input.interpretation?.intent ?? this.inferIntent(input.userInput)
    if (intent === 'batch_move') return this.handleBatchMove(input, runtime)
    if (intent === 'batch_delete') return this.handleBatchDelete(input, runtime)
    if (intent === 'insert') return this.handleInsert(input, runtime)
    if (intent === 'move') return this.handleMove(input, runtime)
    if (intent === 'delete') return this.handleDelete(input, runtime)
    if (intent === 'replace') return this.handleReplace(input, runtime)
    if (intent === 'validate') return this.handleValidate(input, runtime)
    if (intent === 'query') return this.handleQuery(input, runtime)

    return {
      status: 'needs_clarification',
      input,
      decision: {
        intent,
        constraintReport: {
          ok: false,
          issues: [{
            code: 'unsupported_intent',
            severity: 'critical',
            message: 'Agent Core needs more information or blocked this operation.',
          }],
        },
      },
      explanation: 'Agent Core needs more information or blocked this operation.',
      trace: runtime.trace.getTrace(),
    }
  }

  private async handleMove(input: AgentSubmitInput, runtime: AgentCapabilityRuntime): Promise<AgentResult> {
    const moveSlots = this.parseMove(input)
    if (!moveSlots || !this.hasMoveTargetSelector(moveSlots) || (typeof moveSlots.offsetSeconds !== 'number' && !moveSlots.newStartTime)) {
      return this.buildMoveClarificationResult(input, moveSlots ?? {}, runtime)
    }
    if (!moveSlots || !this.hasMoveTargetSelector(moveSlots) || (typeof moveSlots.offsetSeconds !== 'number' && !moveSlots.newStartTime)) {
      return {
        status: 'needs_clarification',
        input,
        decision: {
          intent: this.inferIntent(input.userInput),
          constraintReport: {
            ok: false,
            issues: [{
              code: 'missing_required_slot',
              severity: 'critical',
              message: 'Agent Core needs more information or blocked this operation.',
            }],
          },
        },
        explanation: 'Agent Core needs more information or blocked this operation.',
        trace: runtime.trace.getTrace(),
      }
    }

    return this.executeMoveWithSlots(input, runtime, moveSlots)
  }

  private async buildMoveClarificationResult(
    input: AgentSubmitInput,
    moveSlots: MoveSlots,
    runtime: AgentCapabilityRuntime,
  ): Promise<AgentResult> {
    const hasTargetSelector = this.hasMoveTargetSelector(moveSlots)
    const hasMoveOperation = typeof moveSlots.offsetSeconds === 'number' || Boolean(moveSlots.newStartTime)
    const missingSlots = [
      ...(!hasTargetSelector ? ['targetItemId'] : []),
      ...(!hasMoveOperation ? ['newStartTime'] : []),
    ]
    const context = await runtime.dataGateway.loadContext(input)
    const pendingTask = createPendingTask({
      intent: 'move',
      phase: 'needs_clarification',
      originalInput: input.userInput,
      collectedSlots: {
        ...this.buildTargetSelectorSlotPatch(moveSlots, input.userInput),
        ...this.buildMoveOperationSlotPatch(moveSlots, input.userInput),
      },
      missingSlots,
      contextFingerprint: this.buildPendingContextFingerprint(context),
      contextSources: this.buildPendingContextSourceSnapshots(context),
    })
    const message = !hasTargetSelector
      ? 'Move needs a target programme, time, or item before it can be executed.'
      : 'Move needs a destination time or offset before it can be executed.'

    return {
      status: 'needs_clarification',
      input,
      decision: {
        intent: 'move',
        pendingTask,
        constraintReport: {
          ok: false,
          issues: [{
            code: 'missing_required_slot',
            severity: 'critical',
            message,
          }],
        },
      },
      explanation: message,
      trace: runtime.trace.getTrace(),
    }
  }

  private async executeMoveWithSlots(
    input: AgentSubmitInput,
    runtime: AgentCapabilityRuntime,
    moveSlots: MoveSlots,
    pendingTask?: AgentSubmitInput['pendingTask'],
  ): Promise<AgentResult> {
    runtime.trace.record('resolving_context', 'Agent Core trace step.', {
      channelId: input.channelId,
      date: input.date,
      playlistId: input.playlistId,
    })
    const context = await runtime.dataGateway.loadContext(input)
    const contextChangedResult = this.buildPendingContextChangedResultIfNeeded(input, runtime, pendingTask, context)
    if (contextChangedResult) return contextChangedResult
    const missingScheduleSourceResult = this.buildScheduleSourceMissingResultIfNeeded(input, runtime, context, 'move', pendingTask)
    if (missingScheduleSourceResult) return missingScheduleSourceResult

    const targets = this.resolveTargets(context, moveSlots)

    if (targets.length !== 1) {
      const status = targets.length === 0 ? 'blocked' : 'needs_clarification'
      const code = targets.length === 0 ? 'target_not_found' : 'target_ambiguous'
      const targetLabel = this.describeTargetSelector(moveSlots)
      const message = targets.length === 0
        ? 'No matching target was found.'
        : 'Multiple targets matched; select one target.'
      const pendingTargetTask = targets.length > 1
        ? this.createTargetAmbiguityPendingTask(input, 'move', moveSlots, targets, context, {
            ...this.buildMoveOperationSlotPatch(moveSlots, input.userInput),
          })
        : pendingTask
      return {
        status,
        input,
        decision: {
          intent: 'move',
          resolvedTargets: targets,
          pendingTask: pendingTargetTask ?? undefined,
          constraintReport: {
            ok: false,
            issues: [{ code, severity: 'critical', message }],
          },
        },
        explanation: message,
        trace: runtime.trace.getTrace(),
      }
    }

    const target = targets[0]!
    runtime.trace.record('planning', 'Build move command plan.', {
      targetItemId: target.id,
      targetTime: moveSlots.targetTime ?? toClockText(target.startTime),
      offsetSeconds: moveSlots.offsetSeconds,
      newStartTime: moveSlots.newStartTime,
    })
    const command = this.buildMoveCommand(input.date, target, moveSlots)
    const preview = this.previewMove(command, context)

    runtime.trace.record('previewing', 'Agent Core trace step.', {
      command,
      affectedItemIds: preview.affectedItemIds,
    })
    const constraintReport = this.constraintEngine.checkMove(command, context, preview.after)
    if (!constraintReport.ok) {
      return {
        status: 'blocked',
        input,
        decision: {
          intent: 'move',
          command,
          resolvedTargets: [target],
          constraintReport,
          preview,
          pendingTask: pendingTask ?? undefined,
        },
        explanation: constraintReport.issues[0]?.message ?? 'Agent Core fallback message.',
        trace: runtime.trace.getTrace(),
      }
    }

    runtime.trace.record('executing', 'Agent Core trace step.', { command })
    const executionResult = await runtime.dataGateway.commitScheduleItems({
      channelId: input.channelId,
      date: input.date,
      playlistId: input.playlistId,
      items: preview.after,
      reason: `agent:${this.id}:move`,
      expectedContextFingerprint: this.buildContextFingerprint(context),
    })
    const commitConflictResult = this.buildCommitConflictResultIfNeeded(input, runtime, 'move', executionResult, command, [target], constraintReport, preview, pendingTask)
    if (commitConflictResult) return commitConflictResult

    runtime.trace.record('validating', 'Validate playlist after commit.', {
      affectedItemIds: executionResult.affectedItemIds,
    })
    const validationReport = this.constraintEngine.validateSchedule(executionResult.scheduleItems)

    return {
      status: validationReport.ok ? 'executed' : 'failed',
      input,
      decision: {
        intent: 'move',
        command,
        resolvedTargets: [target],
        constraintReport,
        preview,
        pendingTask: pendingTask ?? undefined,
      },
      executionResult,
      validationReport,
      explanation: validationReport.ok
        ? `已将 ${target.programName} 移动到 ${toClockText(command.newStartTime)}。`
        : validationReport.issues[0]?.message ?? 'Agent Core fallback message.',
      trace: runtime.trace.getTrace(),
    }
  }

  private async handleBatchMove(input: AgentSubmitInput, runtime: AgentCapabilityRuntime): Promise<AgentResult> {
    const batchSlots = this.parseBatchMove(input)
    if (!batchSlots?.targetRange || typeof batchSlots.offsetSeconds !== 'number') {
      return this.buildBatchMoveClarificationResult(input, batchSlots ?? {}, runtime)
    }
    if (!batchSlots) {
      return {
        status: 'needs_clarification',
        input,
        decision: {
          intent: 'batch_move',
          constraintReport: {
            ok: false,
            issues: [{
              code: 'missing_required_slot',
              severity: 'critical',
              message: 'Agent Core needs more information or blocked this operation.',
            }],
          },
        },
        explanation: 'Agent Core needs more information or blocked this operation.',
        trace: runtime.trace.getTrace(),
      }
    }

    runtime.trace.record('resolving_context', 'Load playlist and resolve batch move range.', {
      channelId: input.channelId,
      date: input.date,
      range: batchSlots.targetRange,
      offsetSeconds: batchSlots.offsetSeconds,
    })
    const context = await runtime.dataGateway.loadContext(input)
    const missingScheduleSourceResult = this.buildScheduleSourceMissingResultIfNeeded(input, runtime, context, 'batch_move')
    if (missingScheduleSourceResult) return missingScheduleSourceResult

    const targets = this.resolveRangeTargets(context, batchSlots.targetRange.start, batchSlots.targetRange.end)
    if (targets.length === 0) {
      const message = '我查了当前播单，这个范围内没有可移动的节目；请换一个时间范围或明确节目名称。'
      return {
        status: 'blocked',
        input,
        decision: {
          intent: 'batch_move',
          resolvedTargets: [],
          constraintReport: {
            ok: false,
            issues: [{ code: 'target_not_found', severity: 'critical', message }],
          },
        },
        explanation: message,
        trace: runtime.trace.getTrace(),
      }
    }

    const command = this.buildBatchMoveCommand(input.date, targets, batchSlots.targetRange, batchSlots.offsetSeconds)
    const preview = this.previewBatchMove(command, context)
    const constraintReport = this.constraintEngine.checkBatchMove(command, context, preview.after)

    runtime.trace.record('previewing', 'Agent Core trace step.', {
      command,
      affectedItemIds: preview.affectedItemIds,
    })
    if (!constraintReport.ok) {
      return {
        status: 'blocked',
        input,
        decision: {
          intent: 'batch_move',
          command,
          resolvedTargets: targets,
          constraintReport,
          preview,
        },
        explanation: constraintReport.issues[0]?.message ?? 'Agent Core fallback message.',
        trace: runtime.trace.getTrace(),
      }
    }

    runtime.trace.record('executing', 'Commit batch move playlist changes.', { command })
    const executionResult = await runtime.dataGateway.commitScheduleItems({
      channelId: input.channelId,
      date: input.date,
      playlistId: input.playlistId,
      items: preview.after,
      reason: `agent:${this.id}:batch_move`,
      expectedContextFingerprint: this.buildContextFingerprint(context),
    })
    const commitConflictResult = this.buildCommitConflictResultIfNeeded(input, runtime, 'batch_move', executionResult, command, targets, constraintReport, preview)
    if (commitConflictResult) return commitConflictResult
    runtime.trace.record('validating', 'Validate playlist after commit.', {
      affectedItemIds: executionResult.affectedItemIds,
    })
    const validationReport = this.constraintEngine.validateSchedule(executionResult.scheduleItems)

    return {
      status: validationReport.ok ? 'executed' : 'failed',
      input,
      decision: {
        intent: 'batch_move',
        command,
        resolvedTargets: targets,
        constraintReport,
        preview,
      },
      executionResult,
      validationReport,
      explanation: validationReport.ok
        ? `已批量移动 ${targets.length} 个节目。`
        : validationReport.issues[0]?.message ?? 'Agent Core fallback message.',
      trace: runtime.trace.getTrace(),
    }
  }

  private async buildBatchMoveClarificationResult(
    input: AgentSubmitInput,
    batchSlots: BatchMoveSlots,
    runtime: AgentCapabilityRuntime,
  ): Promise<AgentResult> {
    const missingSlots = [
      ...(!batchSlots.rangeStart ? ['rangeStart'] : []),
      ...(!batchSlots.rangeEnd ? ['rangeEnd'] : []),
      ...(typeof batchSlots.offsetSeconds !== 'number' ? ['offsetSeconds'] : []),
    ]
    const context = await runtime.dataGateway.loadContext(input)
    const pendingTask = createPendingTask({
      intent: 'batch_move',
      phase: 'needs_clarification',
      originalInput: input.userInput,
      collectedSlots: this.buildBatchMoveSlotPatch(batchSlots, input.userInput, 'user_initial'),
      missingSlots,
      contextFingerprint: this.buildPendingContextFingerprint(context),
      contextSources: this.buildPendingContextSourceSnapshots(context),
    })

    const message = missingSlots.includes('rangeStart') || missingSlots.includes('rangeEnd')
      ? 'Batch move needs a clear time range before it can be executed.'
      : 'Batch move needs a clear move offset before it can be executed.'

    return {
      status: 'needs_clarification',
      input,
      decision: {
        intent: 'batch_move',
        pendingTask,
        constraintReport: {
          ok: false,
          issues: [{
            code: 'missing_required_slot',
            severity: 'critical',
            message,
          }],
        },
      },
      explanation: message,
      trace: runtime.trace.getTrace(),
    }
  }

  private async continuePendingBatchMove(input: AgentSubmitInput, runtime: AgentCapabilityRuntime): Promise<AgentResult> {
    const pendingTask = input.pendingTask
    if (!pendingTask) return this.handleBatchMove(input, runtime)

    runtime.trace.record('understanding', 'continue structured pending batch_move context', {
      pendingTaskId: pendingTask.id,
      pendingPhase: pendingTask.phase,
      missingSlots: pendingTask.missingSlots,
    })

    if (this.isCancelInput(input)) {
      return this.buildPendingCancelledResult(input, runtime, 'batch_move', 'pending batch move task was cancelled by the user.')
    }

    const latestSlots = this.parseBatchMove(input) ?? {}
    const rangeStart = latestSlots.rangeStart ?? this.readStringSlot(pendingTask.collectedSlots.rangeStart)
    const rangeEnd = latestSlots.rangeEnd ?? this.readStringSlot(pendingTask.collectedSlots.rangeEnd)
    const offsetSeconds = typeof latestSlots.offsetSeconds === 'number'
      ? latestSlots.offsetSeconds
      : this.readNumberSlot(pendingTask.collectedSlots.offsetSeconds)
    const mergedSlots: BatchMoveSlots = {
      rangeStart,
      rangeEnd,
      targetRange: rangeStart && rangeEnd ? { start: rangeStart, end: rangeEnd } : undefined,
      offsetSeconds,
    }
    const missingSlots = [
      ...(!rangeStart ? ['rangeStart'] : []),
      ...(!rangeEnd ? ['rangeEnd'] : []),
      ...(typeof offsetSeconds !== 'number' ? ['offsetSeconds'] : []),
    ]
    const continuedTask = continuePendingTask({
      pendingTask,
      latestUserInput: input.userInput,
      slotPatch: this.buildBatchMoveSlotPatch(latestSlots, input.userInput, 'user_followup'),
      missingSlots,
    })

    if (missingSlots.length > 0 || !mergedSlots.targetRange || typeof mergedSlots.offsetSeconds !== 'number') {
      const message = missingSlots.includes('rangeStart') || missingSlots.includes('rangeEnd')
        ? 'Batch move still needs a clear time range.'
        : 'Batch move still needs a clear move offset.'
      return {
        status: 'needs_clarification',
        input,
        decision: {
          intent: 'batch_move',
          pendingTask: continuedTask,
          constraintReport: {
            ok: false,
            issues: [{
              code: 'missing_required_slot',
              severity: 'critical',
              message,
            }],
          },
        },
        explanation: message,
        trace: runtime.trace.getTrace(),
      }
    }

    const context = await runtime.dataGateway.loadContext(input)
    const contextChangedResult = this.buildPendingContextChangedResultIfNeeded(input, runtime, pendingTask, context)
    if (contextChangedResult) return contextChangedResult

    return this.handleBatchMove({
      ...input,
      pendingTask: undefined,
      interpretation: {
        intent: 'batch_move',
        confidence: input.interpretation?.confidence ?? 1,
        source: input.interpretation?.source ?? 'deterministic',
        slots: {
          rangeStart: mergedSlots.targetRange.start,
          rangeEnd: mergedSlots.targetRange.end,
          offsetSeconds: mergedSlots.offsetSeconds,
        },
      },
    }, runtime)
  }

  private async handleInsert(input: AgentSubmitInput, runtime: AgentCapabilityRuntime): Promise<AgentResult> {
    const insertSlots = this.parseInsert(input)
    if (!insertSlots.targetTime || !insertSlots.programHint) {
      return this.buildInsertClarificationResult(input, insertSlots, runtime)
    }

    return this.executeInsertWithSlots(input, runtime, {
      targetTime: insertSlots.targetTime,
      programHint: insertSlots.programHint,
      selectedCandidateId: insertSlots.selectedCandidateId,
      source: 'initial',
    })
  }

  private async handleReplace(input: AgentSubmitInput, runtime: AgentCapabilityRuntime): Promise<AgentResult> {
    const replaceSlots = this.parseReplace(input)
    if (!this.hasReplaceTargetSelector(replaceSlots) || !replaceSlots.replacementHint) {
      return this.buildReplaceClarificationResult(input, replaceSlots, runtime)
    }

    return this.executeReplaceWithSlots(input, runtime, {
      targetTime: replaceSlots.targetTime,
      targetItemId: replaceSlots.targetItemId,
      targetProgramName: replaceSlots.targetProgramName,
      replacementHint: replaceSlots.replacementHint,
      selectedCandidateId: replaceSlots.selectedCandidateId,
      source: 'initial',
    })
  }

  private async handleValidate(input: AgentSubmitInput, runtime: AgentCapabilityRuntime): Promise<AgentResult> {
    runtime.trace.record('resolving_context', 'Load current playlist for read-only validation.', {
      channelId: input.channelId,
      date: input.date,
      playlistId: input.playlistId,
    })
    const context = await runtime.dataGateway.loadContext(input)
    const command: ValidateCommandPlan = {
      intent: 'validate',
      scope: 'schedule',
    }
    const baseValidationReport = this.constraintEngine.validateContext(context)
    const validationReport = {
      ok: baseValidationReport.ok,
      issues: [
        ...baseValidationReport.issues,
        ...this.buildValidationSourceEvidenceIssues(context),
      ],
    }
    validationReport.ok = validationReport.issues.every((issue) => issue.severity !== 'critical')
    const issueCount = validationReport.issues.length

    runtime.trace.record('validating', 'Complete constraint validation for the current playlist.', {
      ok: validationReport.ok,
      issueCount,
      playlistType: context.playlistType,
    })

    return {
      status: 'executed',
      input,
      decision: {
        intent: 'validate',
        command,
        constraintReport: validationReport,
      },
      validationReport,
      explanation: validationReport.ok
        ? '校验完成，当前播单暂未发现会阻断写入的硬性问题。'
        : `校验完成，发现 ${issueCount} 个问题：${validationReport.issues[0]?.message ?? '请查看校验明细。'}`,
      trace: runtime.trace.getTrace(),
    }
  }

  private async handleQuery(input: AgentSubmitInput, runtime: AgentCapabilityRuntime): Promise<AgentResult> {
    runtime.trace.record('resolving_context', 'Load current playlist and candidate library for read-only query.', {
      channelId: input.channelId,
      date: input.date,
      playlistId: input.playlistId,
    })
    const context = await runtime.dataGateway.loadContext(input)
    const command = this.buildQueryCommand(input)
    const queryResult = this.executeQueryCommand(command, input, context, runtime)
    const sourceIssues = this.buildQuerySourceEvidenceIssues(command, context)

    runtime.trace.record('planning', 'Build query atomic command plan.', {
      queryKind: command.queryKind,
      targetTime: command.targetTime,
      keyword: command.keyword,
    })
    runtime.trace.record('validating', 'Finalize read-only query result.', {
      totalCount: queryResult.totalCount,
      scheduleItemCount: queryResult.scheduleItems.length,
      candidateCount: queryResult.candidates.length,
    })

    return {
      status: 'executed',
      input,
      decision: {
        intent: 'query',
        command,
        resolvedTargets: queryResult.scheduleItems,
        queryResult,
        constraintReport: {
          ok: sourceIssues.every((issue) => issue.severity !== 'critical'),
          issues: sourceIssues,
        },
      },
      explanation: sourceIssues[0]?.message ?? this.buildQueryExplanation(queryResult),
      trace: runtime.trace.getTrace(),
    }
  }

  private async handleDelete(input: AgentSubmitInput, runtime: AgentCapabilityRuntime): Promise<AgentResult> {
    const deleteSlots = this.parseDelete(input)
    if (!this.hasDeleteTargetSelector(deleteSlots)) {
      const context = await runtime.dataGateway.loadContext(input)
      const pendingTask = createPendingTask({
        intent: 'delete',
        phase: 'needs_clarification',
        originalInput: input.userInput,
        collectedSlots: {},
        missingSlots: ['targetTime'],
        contextFingerprint: this.buildPendingContextFingerprint(context),
        contextSources: this.buildPendingContextSourceSnapshots(context),
      })
      return {
        status: 'needs_clarification',
        input,
        decision: {
          intent: 'delete',
          pendingTask,
          constraintReport: {
            ok: false,
            issues: [{
              code: 'missing_required_slot',
              severity: 'critical',
              message: 'Agent Core needs more information or blocked this operation.',
            }],
          },
        },
        explanation: 'Agent Core needs more information or blocked this operation.',
        trace: runtime.trace.getTrace(),
      }
    }

    runtime.trace.record('resolving_context', 'Agent Core trace step.', {
      channelId: input.channelId,
      date: input.date,
      targetTime: deleteSlots.targetTime,
      targetItemId: deleteSlots.targetItemId,
      targetProgramName: deleteSlots.targetProgramName,
    })
    const context = await runtime.dataGateway.loadContext(input)
    const missingScheduleSourceResult = this.buildScheduleSourceMissingResultIfNeeded(input, runtime, context, 'delete')
    if (missingScheduleSourceResult) return missingScheduleSourceResult

    const targets = this.resolveTargets(context, deleteSlots)
    const targetTime = this.describeTargetSelector(deleteSlots)
    if (targets.length !== 1) {
      const status = targets.length === 0 ? 'blocked' : 'needs_clarification'
      const code = targets.length === 0 ? 'target_not_found' : 'target_ambiguous'
      const message = targets.length === 0
        ? 'No matching target was found.'
        : 'Multiple targets matched; select one target.'
      const pendingTargetTask = targets.length > 1
        ? this.createTargetAmbiguityPendingTask(input, 'delete', deleteSlots, targets, context)
        : undefined
      return {
        status,
        input,
        decision: {
          intent: 'delete',
          resolvedTargets: targets,
          pendingTask: pendingTargetTask,
          constraintReport: {
            ok: false,
            issues: [{ code, severity: 'critical', message }],
          },
        },
        explanation: message,
        trace: runtime.trace.getTrace(),
      }
    }

    const target = targets[0]!
    const deleteTargetTime = deleteSlots.targetTime ?? toClockText(target.startTime)
    const command = this.buildDeleteCommand(input.date, target, deleteTargetTime)
    const constraintReport = this.constraintEngine.checkDelete(command, context)
    const preview = this.previewDelete(command, context)
    const policyDecision = this.playlistPolicy.decideCommand({
      intent: 'delete',
      context,
    })
    runtime.trace.record('previewing', 'Agent Core trace step.', {
      command,
      affectedItemIds: preview.affectedItemIds,
      policyAction: policyDecision.action,
      policyReason: policyDecision.reason,
    })

    if (!constraintReport.ok) {
      return {
        status: 'blocked',
        input,
        decision: {
          intent: 'delete',
          command,
          resolvedTargets: [target],
          constraintReport,
          preview,
        },
        explanation: constraintReport.issues[0]?.message ?? 'Agent Core fallback message.',
        trace: runtime.trace.getTrace(),
      }
    }

    if (policyDecision.action === 'confirm') {
      const pendingTask = createPendingTask({
      intent: 'delete',
      phase: 'needs_confirmation',
      originalInput: input.userInput,
      collectedSlots: {
        targetTime: {
          value: deleteTargetTime,
          source: 'user_initial',
          confidence: 0.9,
        },
        targetItemId: {
          value: target.id,
          source: 'system_inferred',
          confidence: 1,
        },
      },
      missingSlots: ['confirmation'],
      contextFingerprint: this.buildPendingContextFingerprint(context),
      contextSources: this.buildPendingContextSourceSnapshots(context),
      })

      return {
        status: 'needs_confirmation',
        input,
        decision: {
          intent: 'delete',
          command,
          resolvedTargets: [target],
          constraintReport,
          preview,
          pendingTask,
        },
        explanation: '删除会改变当前播单，提交前需要确认。',
        trace: runtime.trace.getTrace(),
      }
    }

    return this.commitDelete(input, runtime, context, target, command, constraintReport, preview)
  }

  private async handleBatchDelete(input: AgentSubmitInput, runtime: AgentCapabilityRuntime): Promise<AgentResult> {
    const batchSlots = this.parseBatchDeleteSlots(input)
    const range = batchSlots.targetRange
    if (!range) {
      const missingSlots = [
        ...(!batchSlots.rangeStart ? ['rangeStart'] : []),
        ...(!batchSlots.rangeEnd ? ['rangeEnd'] : []),
      ]
      const context = await runtime.dataGateway.loadContext(input)
      const pendingTask = createPendingTask({
        intent: 'batch_delete',
        phase: 'needs_clarification',
        originalInput: input.userInput,
        collectedSlots: this.buildBatchDeleteSlotPatch(batchSlots, input.userInput, 'user_initial'),
        missingSlots,
        contextFingerprint: this.buildPendingContextFingerprint(context),
        contextSources: this.buildPendingContextSourceSnapshots(context),
      })
      return {
        status: 'needs_clarification',
        input,
        decision: {
          intent: 'batch_delete',
          pendingTask,
          constraintReport: {
            ok: false,
            issues: [{
              code: 'missing_required_slot',
              severity: 'critical',
              message: 'Agent Core needs more information or blocked this operation.',
            }],
          },
        },
        explanation: 'Agent Core needs more information or blocked this operation.',
        trace: runtime.trace.getTrace(),
      }
    }

    runtime.trace.record('resolving_context', 'Load playlist and resolve batch delete range.', {
      channelId: input.channelId,
      date: input.date,
      range,
    })
    const context = await runtime.dataGateway.loadContext(input)
    const missingScheduleSourceResult = this.buildScheduleSourceMissingResultIfNeeded(input, runtime, context, 'batch_delete')
    if (missingScheduleSourceResult) return missingScheduleSourceResult

    const targets = this.resolveRangeTargets(context, range.start, range.end)
    if (targets.length === 0) {
      const message = '我查了当前播单，这个范围内没有可删除的节目；请换一个时间范围或明确节目名称。'
      return {
        status: 'blocked',
        input,
        decision: {
          intent: 'batch_delete',
          resolvedTargets: [],
          constraintReport: {
            ok: false,
            issues: [{ code: 'target_not_found', severity: 'critical', message }],
          },
        },
        explanation: message,
        trace: runtime.trace.getTrace(),
      }
    }

    const command = this.buildBatchDeleteCommand(input.date, targets, range)
    const constraintReport = this.constraintEngine.checkBatchDelete(command, context)
    const preview = this.previewBatchDelete(command, context)
    const policyDecision = this.playlistPolicy.decideCommand({
      intent: 'batch_delete',
      context,
    })
    runtime.trace.record('previewing', 'Agent Core trace step.', {
      command,
      affectedItemIds: preview.affectedItemIds,
      policyAction: policyDecision.action,
      policyReason: policyDecision.reason,
    })

    if (!constraintReport.ok) {
      return {
        status: 'blocked',
        input,
        decision: {
          intent: 'batch_delete',
          command,
          resolvedTargets: targets,
          constraintReport,
          preview,
        },
        explanation: constraintReport.issues[0]?.message ?? 'Agent Core fallback message.',
        trace: runtime.trace.getTrace(),
      }
    }

    if (policyDecision.action === 'confirm') {
      const pendingTask = createPendingTask({
      intent: 'batch_delete',
      phase: 'needs_confirmation',
      originalInput: input.userInput,
      collectedSlots: {
        rangeStart: {
          value: range.start,
          source: 'user_initial',
          confidence: 0.9,
        },
        rangeEnd: {
          value: range.end,
          source: 'user_initial',
          confidence: 0.9,
        },
        targetItemIds: {
          value: targets.map((target) => target.id),
          source: 'system_inferred',
          confidence: 1,
        },
      },
      missingSlots: ['confirmation'],
      contextFingerprint: this.buildPendingContextFingerprint(context),
      contextSources: this.buildPendingContextSourceSnapshots(context),
      })

      return {
        status: 'needs_confirmation',
        input,
        decision: {
          intent: 'batch_delete',
          command,
          resolvedTargets: targets,
          constraintReport,
          preview,
          pendingTask,
        },
        explanation: '批量删除会改变多条播单记录，提交前需要确认。',
        trace: runtime.trace.getTrace(),
      }
    }

    return this.commitBatchDelete(input, runtime, context, targets, command, constraintReport, preview)
  }

  private async continuePendingMove(input: AgentSubmitInput, runtime: AgentCapabilityRuntime): Promise<AgentResult> {
    const pendingTask = input.pendingTask
    if (!pendingTask) return this.handleMove(input, runtime)

    runtime.trace.record('understanding', 'Agent Core trace step.', {
      pendingTaskId: pendingTask.id,
      pendingPhase: pendingTask.phase,
      missingSlots: pendingTask.missingSlots,
    })

    if (this.isCancelInput(input)) {
      return {
        status: 'needs_clarification',
        input,
        decision: {
          intent: 'move',
          constraintReport: {
            ok: false,
            issues: [{
              code: 'missing_required_slot',
              severity: 'info',
              message: 'Agent Core needs more information or blocked this operation.',
            }],
          },
        },
        explanation: 'Agent Core needs more information or blocked this operation.',
        trace: runtime.trace.getTrace(),
      }
    }

    if ((pendingTask.targetOptions?.length ?? 0) === 0) {
      const latestSlots = this.parseMove(input) ?? {}
      const targetTime = latestSlots.targetTime ?? this.readStringSlot(pendingTask.collectedSlots.targetTime)
      const targetItemId = latestSlots.targetItemId ?? this.readStringSlot(pendingTask.collectedSlots.targetItemId)
      const targetProgramName = latestSlots.targetProgramName ?? this.readStringSlot(pendingTask.collectedSlots.targetProgramName)
      const newStartTime = latestSlots.newStartTime ?? this.readStringSlot(pendingTask.collectedSlots.newStartTime)
      const offsetSeconds = typeof latestSlots.offsetSeconds === 'number'
        ? latestSlots.offsetSeconds
        : this.readNumberSlot(pendingTask.collectedSlots.offsetSeconds)
      const mergedSlots: MoveSlots = {
        targetTime,
        targetItemId,
        targetProgramName,
        newStartTime,
        offsetSeconds,
      }
      const hasTargetSelector = this.hasMoveTargetSelector(mergedSlots)
      const hasMoveOperation = typeof mergedSlots.offsetSeconds === 'number' || Boolean(mergedSlots.newStartTime)
      const continuedTask = continuePendingTask({
        pendingTask,
        latestUserInput: input.userInput,
        slotPatch: {
          ...this.buildTargetSelectorSlotPatch(latestSlots, input.userInput),
          ...this.buildMoveOperationSlotPatch(latestSlots, input.userInput),
        },
        missingSlots: [
          ...(!hasTargetSelector ? ['targetItemId'] : []),
          ...(!hasMoveOperation ? ['newStartTime'] : []),
        ],
      })

      if (!hasTargetSelector || !hasMoveOperation) {
        const message = !hasTargetSelector
          ? 'Move still needs a target programme, time, or item.'
          : 'Move still needs a destination time or offset.'
        return {
          status: 'needs_clarification',
          input,
          decision: {
            intent: 'move',
            pendingTask: continuedTask,
            constraintReport: {
              ok: false,
              issues: [{
                code: 'missing_required_slot',
                severity: 'critical',
                message,
              }],
            },
          },
          explanation: message,
          trace: runtime.trace.getTrace(),
        }
      }

      return this.executeMoveWithSlots(input, runtime, mergedSlots, pendingTask)
    }

    const invalidTargetSelectionResult = this.buildInvalidPendingTargetSelectionResultIfNeeded(input, runtime, pendingTask)
    if (invalidTargetSelectionResult) return invalidTargetSelectionResult

    const selectedTargetId = this.resolveSelectedTargetItemId(input, pendingTask)
    const newStartTime = input.interpretation?.slots?.newStartTime
      ?? this.readStringSlot(pendingTask.collectedSlots.newStartTime)
    const offsetSeconds = typeof input.interpretation?.slots?.offsetSeconds === 'number'
      ? this.resolveInterpretedOffsetSeconds(input.interpretation.slots.offsetSeconds, input.interpretation.slots.direction)
      : this.readNumberSlot(pendingTask.collectedSlots.offsetSeconds)

    if (!selectedTargetId || (!newStartTime && typeof offsetSeconds !== 'number')) {
      return {
        status: 'needs_clarification',
        input,
        decision: {
          intent: 'move',
          pendingTask,
          resolvedTargets: this.resolvePendingTargetSnapshots(pendingTask),
          constraintReport: {
            ok: false,
            issues: [{
              code: 'missing_required_slot',
              severity: 'critical',
              message: selectedTargetId
                ? 'Move still needs destination time or offset.'
                : 'Select one target item to move.',
            }],
          },
        },
        explanation: selectedTargetId
          ? 'Move still needs destination time or offset.'
          : 'Select one target item to move.',
        trace: runtime.trace.getTrace(),
      }
    }

    return this.executeMoveWithSlots(input, runtime, {
      targetItemId: selectedTargetId,
      targetTime: this.readStringSlot(pendingTask.collectedSlots.targetTime),
      newStartTime,
      offsetSeconds,
    }, pendingTask)
  }

  private async confirmPendingDelete(
    input: AgentSubmitInput,
    runtime: AgentCapabilityRuntime,
    pendingTask: NonNullable<AgentSubmitInput['pendingTask']>,
  ): Promise<AgentResult> {
    if (this.isCancelInput(input)) {
      return {
        status: 'needs_clarification',
        input,
        decision: {
          intent: 'delete',
          constraintReport: {
            ok: false,
            issues: [{
              code: 'missing_required_slot',
              severity: 'info',
              message: 'Agent Core needs more information or blocked this operation.',
            }],
          },
        },
        explanation: 'Agent Core needs more information or blocked this operation.',
        trace: runtime.trace.getTrace(),
      }
    }

    if (!this.isConfirmationInput(input)) {
      return {
        status: 'needs_confirmation',
        input,
        decision: {
          intent: 'delete',
          pendingTask,
          constraintReport: {
            ok: false,
            issues: [{
              code: 'missing_required_slot',
              severity: 'critical',
              message: 'Agent Core needs more information or blocked this operation.',
            }],
          },
        },
        explanation: 'Agent Core needs more information or blocked this operation.',
        trace: runtime.trace.getTrace(),
      }
    }

    const itemId = this.readStringSlot(pendingTask.collectedSlots.targetItemId)
    const targetTime = this.readStringSlot(pendingTask.collectedSlots.targetTime)
    if (!itemId || !targetTime) {
      return {
        status: 'needs_clarification',
        input,
        decision: {
          intent: 'delete',
          pendingTask,
          constraintReport: {
            ok: false,
            issues: [{
              code: 'missing_required_slot',
              severity: 'critical',
              message: 'Agent Core needs more information or blocked this operation.',
            }],
          },
        },
        explanation: 'Agent Core needs more information or blocked this operation.',
        trace: runtime.trace.getTrace(),
      }
    }

    runtime.trace.record('resolving_context', 'Agent Core trace step.', {
      itemId,
      targetTime,
    })
    const context = await runtime.dataGateway.loadContext(input)
    const contextChangedResult = this.buildPendingContextChangedResultIfNeeded(input, runtime, pendingTask, context)
    if (contextChangedResult) return contextChangedResult
    const missingScheduleSourceResult = this.buildScheduleSourceMissingResultIfNeeded(input, runtime, context, 'delete', pendingTask)
    if (missingScheduleSourceResult) return missingScheduleSourceResult

    const target = context.scheduleItems.find((item) => item.id === itemId)
    if (!target) {
      return {
        status: 'blocked',
        input,
        decision: {
          intent: 'delete',
          pendingTask,
          constraintReport: {
            ok: false,
            issues: [{
              code: 'target_not_found',
              severity: 'critical',
              message: 'Agent Core needs more information or blocked this operation.',
            }],
          },
        },
        explanation: 'Agent Core needs more information or blocked this operation.',
        trace: runtime.trace.getTrace(),
      }
    }

    const command = this.buildDeleteCommand(input.date, target, targetTime)
    const constraintReport = this.constraintEngine.checkDelete(command, context)
    const preview = this.previewDelete(command, context)
    if (!constraintReport.ok) {
      return {
        status: 'blocked',
        input,
        decision: {
          intent: 'delete',
          command,
          resolvedTargets: [target],
          constraintReport,
          preview,
          pendingTask,
        },
        explanation: constraintReport.issues[0]?.message ?? 'Agent Core fallback message.',
        trace: runtime.trace.getTrace(),
      }
    }

    return this.commitDelete(input, runtime, context, target, command, constraintReport, preview, pendingTask)
  }

  private async continuePendingDelete(
    input: AgentSubmitInput,
    runtime: AgentCapabilityRuntime,
    pendingTask: NonNullable<AgentSubmitInput['pendingTask']>,
  ): Promise<AgentResult> {
    if (pendingTask.phase === 'needs_confirmation') {
      return this.confirmPendingDelete(input, runtime, pendingTask)
    }

    if (this.isCancelInput(input)) {
      return {
        status: 'needs_clarification',
        input,
        decision: {
          intent: 'delete',
          constraintReport: {
            ok: false,
            issues: [{
              code: 'missing_required_slot',
              severity: 'info',
              message: 'Agent Core needs more information or blocked this operation.',
            }],
          },
        },
        explanation: 'Agent Core needs more information or blocked this operation.',
        trace: runtime.trace.getTrace(),
      }
    }

    if ((pendingTask.targetOptions?.length ?? 0) === 0) {
      const latestSlots = this.parseDelete(input)
      const targetTime = latestSlots.targetTime ?? this.readStringSlot(pendingTask.collectedSlots.targetTime)
      const targetItemId = latestSlots.targetItemId ?? this.readStringSlot(pendingTask.collectedSlots.targetItemId)
      const targetProgramName = latestSlots.targetProgramName ?? this.readStringSlot(pendingTask.collectedSlots.targetProgramName)
      const mergedSlots: DeleteSlots = {
        targetTime,
        targetItemId,
        targetProgramName,
      }
      const slotPatch = this.buildTargetSelectorSlotPatch(mergedSlots, input.userInput)
      const continuedTask = continuePendingTask({
        pendingTask,
        latestUserInput: input.userInput,
        slotPatch,
        missingSlots: this.hasDeleteTargetSelector(mergedSlots) ? [] : ['targetTime'],
      })

      if (!this.hasDeleteTargetSelector(mergedSlots)) {
        return {
          status: 'needs_clarification',
          input,
          decision: {
            intent: 'delete',
            pendingTask: continuedTask,
            constraintReport: {
              ok: false,
              issues: [{
                code: 'missing_required_slot',
                severity: 'critical',
                message: 'Delete still needs a target time, programme, or item.',
              }],
            },
          },
          explanation: 'Delete still needs a target time, programme, or item.',
          trace: runtime.trace.getTrace(),
        }
      }

      const context = await runtime.dataGateway.loadContext(input)
      const contextChangedResult = this.buildPendingContextChangedResultIfNeeded(input, runtime, pendingTask, context)
      if (contextChangedResult) return contextChangedResult

      return this.handleDelete({
        ...input,
        pendingTask: undefined,
        interpretation: {
          intent: 'delete',
          confidence: input.interpretation?.confidence ?? 1,
          source: input.interpretation?.source ?? 'deterministic',
          slots: {
            targetTime,
            targetItemId,
            targetProgramName,
          },
        },
      }, runtime)
    }

    const invalidTargetSelectionResult = this.buildInvalidPendingTargetSelectionResultIfNeeded(input, runtime, pendingTask)
    if (invalidTargetSelectionResult) return invalidTargetSelectionResult

    const selectedTargetId = this.resolveSelectedTargetItemId(input, pendingTask)
    if (!selectedTargetId) {
      return {
        status: 'needs_clarification',
        input,
        decision: {
          intent: 'delete',
          pendingTask,
          resolvedTargets: this.resolvePendingTargetSnapshots(pendingTask),
          constraintReport: {
            ok: false,
            issues: [{
              code: 'missing_required_slot',
              severity: 'critical',
              message: 'Agent Core needs more information or blocked this operation.',
            }],
          },
        },
        explanation: 'Agent Core needs more information or blocked this operation.',
        trace: runtime.trace.getTrace(),
      }
    }

    runtime.trace.record('resolving_context', 'Agent Core trace step.', {
      itemId: selectedTargetId,
    })
    const context = await runtime.dataGateway.loadContext(input)
    const contextChangedResult = this.buildPendingContextChangedResultIfNeeded(input, runtime, pendingTask, context)
    if (contextChangedResult) return contextChangedResult
    const missingScheduleSourceResult = this.buildScheduleSourceMissingResultIfNeeded(input, runtime, context, 'delete', pendingTask)
    if (missingScheduleSourceResult) return missingScheduleSourceResult
    const target = context.scheduleItems.find((item) => item.id === selectedTargetId)
    if (!target) {
      return {
        status: 'blocked',
        input,
        decision: {
          intent: 'delete',
          pendingTask,
          constraintReport: {
            ok: false,
            issues: [{
              code: 'target_not_found',
              severity: 'critical',
              message: 'Agent Core needs more information or blocked this operation.',
            }],
          },
        },
        explanation: 'Agent Core needs more information or blocked this operation.',
        trace: runtime.trace.getTrace(),
      }
    }

    const targetTime = toClockText(target.startTime)
    const command = this.buildDeleteCommand(input.date, target, targetTime)
    const constraintReport = this.constraintEngine.checkDelete(command, context)
    const preview = this.previewDelete(command, context)
    if (!constraintReport.ok) {
      return {
        status: 'blocked',
        input,
        decision: {
          intent: 'delete',
          command,
          resolvedTargets: [target],
          constraintReport,
          preview,
          pendingTask,
        },
        explanation: constraintReport.issues[0]?.message ?? 'Agent Core fallback message.',
        trace: runtime.trace.getTrace(),
      }
    }

    const confirmationTask = createPendingTask({
      intent: 'delete',
      phase: 'needs_confirmation',
      originalInput: pendingTask.originalInput || input.userInput,
      collectedSlots: {
        ...pendingTask.collectedSlots,
        targetTime: {
          value: targetTime,
          source: 'system_inferred',
          confidence: 1,
          rawText: input.userInput,
        },
        targetItemId: {
          value: target.id,
          source: 'system_inferred',
          confidence: 1,
          rawText: input.userInput,
        },
      },
      missingSlots: ['confirmation'],
      contextFingerprint: this.buildPendingContextFingerprint(context),
      contextSources: this.buildPendingContextSourceSnapshots(context),
    })

    return {
      status: 'needs_confirmation',
      input,
      decision: {
        intent: 'delete',
        command,
        resolvedTargets: [target],
        constraintReport,
        preview,
        pendingTask: {
          ...confirmationTask,
          collectedInput: [pendingTask.collectedInput, input.userInput].filter(Boolean).join('\n'),
          attemptCount: pendingTask.attemptCount + 1,
          createdAt: pendingTask.createdAt,
        },
      },
      explanation: '删除会改变当前播单，提交前需要确认。',
      trace: runtime.trace.getTrace(),
    }
  }

  private async confirmPendingBatchDelete(
    input: AgentSubmitInput,
    runtime: AgentCapabilityRuntime,
    pendingTask: NonNullable<AgentSubmitInput['pendingTask']>,
  ): Promise<AgentResult> {
    if (this.isCancelInput(input)) {
      return {
        status: 'needs_clarification',
        input,
        decision: {
          intent: 'batch_delete',
          constraintReport: {
            ok: false,
            issues: [{
              code: 'missing_required_slot',
              severity: 'info',
              message: 'Agent Core needs more information or blocked this operation.',
            }],
          },
        },
        explanation: 'Agent Core needs more information or blocked this operation.',
        trace: runtime.trace.getTrace(),
      }
    }

    if (!this.isConfirmationInput(input)) {
      return {
        status: 'needs_confirmation',
        input,
        decision: {
          intent: 'batch_delete',
          pendingTask,
          constraintReport: {
            ok: false,
            issues: [{
              code: 'missing_required_slot',
              severity: 'critical',
              message: 'Agent Core needs more information or blocked this operation.',
            }],
          },
        },
        explanation: 'Agent Core needs more information or blocked this operation.',
        trace: runtime.trace.getTrace(),
      }
    }

    const itemIds = this.readStringArraySlot(pendingTask.collectedSlots.targetItemIds)
    const rangeStart = this.readStringSlot(pendingTask.collectedSlots.rangeStart)
    const rangeEnd = this.readStringSlot(pendingTask.collectedSlots.rangeEnd)
    if (itemIds.length === 0 || !rangeStart || !rangeEnd) {
      return {
        status: 'needs_clarification',
        input,
        decision: {
          intent: 'batch_delete',
          pendingTask,
          constraintReport: {
            ok: false,
            issues: [{
              code: 'missing_required_slot',
              severity: 'critical',
              message: 'Agent Core needs more information or blocked this operation.',
            }],
          },
        },
        explanation: 'Agent Core needs more information or blocked this operation.',
        trace: runtime.trace.getTrace(),
      }
    }

    runtime.trace.record('resolving_context', 'Load playlist and restore pending batch delete targets.', {
      itemIds,
      rangeStart,
      rangeEnd,
    })
    const context = await runtime.dataGateway.loadContext(input)
    const contextChangedResult = this.buildPendingContextChangedResultIfNeeded(input, runtime, pendingTask, context)
    if (contextChangedResult) return contextChangedResult
    const missingScheduleSourceResult = this.buildScheduleSourceMissingResultIfNeeded(input, runtime, context, 'batch_delete', pendingTask)
    if (missingScheduleSourceResult) return missingScheduleSourceResult

    const targets = itemIds
      .map((itemId) => context.scheduleItems.find((item) => item.id === itemId))
      .filter((item): item is ScheduleItemSnapshot => Boolean(item))
    if (targets.length !== itemIds.length) {
      return {
        status: 'blocked',
        input,
        decision: {
          intent: 'batch_delete',
          pendingTask,
          resolvedTargets: targets,
          constraintReport: {
            ok: false,
            issues: [{
              code: 'target_not_found',
              severity: 'critical',
              message: 'Agent Core needs more information or blocked this operation.',
            }],
          },
        },
        explanation: 'Agent Core needs more information or blocked this operation.',
        trace: runtime.trace.getTrace(),
      }
    }

    const command: BatchDeleteCommandPlan = {
      intent: 'batch_delete',
      itemIds,
      targetRange: { start: rangeStart, end: rangeEnd },
    }
    const constraintReport = this.constraintEngine.checkBatchDelete(command, context)
    const preview = this.previewBatchDelete(command, context)
    if (!constraintReport.ok) {
      return {
        status: 'blocked',
        input,
        decision: {
          intent: 'batch_delete',
          command,
          resolvedTargets: targets,
          constraintReport,
          preview,
          pendingTask,
        },
        explanation: constraintReport.issues[0]?.message ?? 'Agent Core fallback message.',
        trace: runtime.trace.getTrace(),
      }
    }

    return this.commitBatchDelete(input, runtime, context, targets, command, constraintReport, preview, pendingTask)
  }

  private async continuePendingBatchDelete(input: AgentSubmitInput, runtime: AgentCapabilityRuntime): Promise<AgentResult> {
    const pendingTask = input.pendingTask
    if (!pendingTask) return this.handleBatchDelete(input, runtime)

    runtime.trace.record('understanding', 'continue structured pending batch_delete context', {
      pendingTaskId: pendingTask.id,
      pendingPhase: pendingTask.phase,
      missingSlots: pendingTask.missingSlots,
    })

    if (this.isCancelInput(input)) {
      return this.buildPendingCancelledResult(input, runtime, 'batch_delete', 'pending batch delete task was cancelled by the user.')
    }

    const latestSlots = this.parseBatchDeleteSlots(input)
    const rangeStart = latestSlots.rangeStart ?? this.readStringSlot(pendingTask.collectedSlots.rangeStart)
    const rangeEnd = latestSlots.rangeEnd ?? this.readStringSlot(pendingTask.collectedSlots.rangeEnd)
    const missingSlots = [
      ...(!rangeStart ? ['rangeStart'] : []),
      ...(!rangeEnd ? ['rangeEnd'] : []),
    ]
    const continuedTask = continuePendingTask({
      pendingTask,
      latestUserInput: input.userInput,
      slotPatch: this.buildBatchDeleteSlotPatch(latestSlots, input.userInput, 'user_followup'),
      missingSlots,
    })

    if (missingSlots.length > 0 || !rangeStart || !rangeEnd) {
      const message = 'Batch delete still needs a clear time range.'
      return {
        status: 'needs_clarification',
        input,
        decision: {
          intent: 'batch_delete',
          pendingTask: continuedTask,
          constraintReport: {
            ok: false,
            issues: [{
              code: 'missing_required_slot',
              severity: 'critical',
              message,
            }],
          },
        },
        explanation: message,
        trace: runtime.trace.getTrace(),
      }
    }

    const context = await runtime.dataGateway.loadContext(input)
    const contextChangedResult = this.buildPendingContextChangedResultIfNeeded(input, runtime, pendingTask, context)
    if (contextChangedResult) return contextChangedResult

    return this.handleBatchDelete({
      ...input,
      pendingTask: undefined,
      interpretation: {
        intent: 'batch_delete',
        confidence: input.interpretation?.confidence ?? 1,
        source: input.interpretation?.source ?? 'deterministic',
        slots: {
          rangeStart,
          rangeEnd,
        },
      },
    }, runtime)
  }

  private async commitDelete(
    input: AgentSubmitInput,
    runtime: AgentCapabilityRuntime,
    _context: SchedulingContext,
    target: ScheduleItemSnapshot,
    command: DeleteCommandPlan,
    constraintReport: NonNullable<AgentResult['decision']['constraintReport']>,
    preview: AgentPreview,
    pendingTask?: AgentSubmitInput['pendingTask'],
  ): Promise<AgentResult> {
    runtime.trace.record('executing', 'Agent Core trace step.', {
      command,
    })
    const executionResult = await runtime.dataGateway.commitScheduleItems({
      channelId: input.channelId,
      date: input.date,
      playlistId: input.playlistId,
      items: preview.after,
      reason: `agent:${this.id}:delete`,
      expectedContextFingerprint: this.buildContextFingerprint(_context),
    })
    const commitConflictResult = this.buildCommitConflictResultIfNeeded(input, runtime, 'delete', executionResult, command, [target], constraintReport, preview, pendingTask)
    if (commitConflictResult) return commitConflictResult
    runtime.trace.record('validating', 'Validate playlist after commit.', {
      affectedItemIds: executionResult.affectedItemIds,
    })
    const validationReport = this.constraintEngine.validateSchedule(executionResult.scheduleItems)

    return {
      status: validationReport.ok ? 'executed' : 'failed',
      input,
      decision: {
        intent: 'delete',
        command,
        resolvedTargets: [target],
        constraintReport,
        preview,
        pendingTask: pendingTask ?? undefined,
      },
      executionResult,
      validationReport,
      explanation: validationReport.ok
        ? `已删除 ${target.programName}。`
        : validationReport.issues[0]?.message ?? 'Agent Core fallback message.',
      trace: runtime.trace.getTrace(),
    }
  }

  private async commitBatchDelete(
    input: AgentSubmitInput,
    runtime: AgentCapabilityRuntime,
    _context: SchedulingContext,
    targets: ScheduleItemSnapshot[],
    command: BatchDeleteCommandPlan,
    constraintReport: NonNullable<AgentResult['decision']['constraintReport']>,
    preview: AgentPreview,
    pendingTask?: AgentSubmitInput['pendingTask'],
  ): Promise<AgentResult> {
    runtime.trace.record('executing', 'Agent Core trace step.', {
      command,
    })
    const executionResult = await runtime.dataGateway.commitScheduleItems({
      channelId: input.channelId,
      date: input.date,
      playlistId: input.playlistId,
      items: preview.after,
      reason: `agent:${this.id}:batch_delete`,
      expectedContextFingerprint: this.buildContextFingerprint(_context),
    })
    const commitConflictResult = this.buildCommitConflictResultIfNeeded(input, runtime, 'batch_delete', executionResult, command, targets, constraintReport, preview, pendingTask)
    if (commitConflictResult) return commitConflictResult
    runtime.trace.record('validating', 'Validate playlist after commit.', {
      affectedItemIds: executionResult.affectedItemIds,
    })
    const validationReport = this.constraintEngine.validateSchedule(executionResult.scheduleItems)

    return {
      status: validationReport.ok ? 'executed' : 'failed',
      input,
      decision: {
        intent: 'batch_delete',
        command,
        resolvedTargets: targets,
        constraintReport,
        preview,
        pendingTask: pendingTask ?? undefined,
      },
      executionResult,
      validationReport,
      explanation: validationReport.ok
        ? `已批量删除 ${targets.length} 个节目。`
        : validationReport.issues[0]?.message ?? 'Agent Core fallback message.',
      trace: runtime.trace.getTrace(),
    }
  }

  private async continuePendingReplace(input: AgentSubmitInput, runtime: AgentCapabilityRuntime): Promise<AgentResult> {
    const pendingTask = input.pendingTask
    if (!pendingTask) return this.handleReplace(input, runtime)

    runtime.trace.record('understanding', 'Agent Core trace step.', {
      pendingTaskId: pendingTask.id,
      pendingPhase: pendingTask.phase,
      missingSlots: pendingTask.missingSlots,
    })

    if (this.isCancelInput(input)) {
      return {
        status: 'needs_clarification',
        input,
        decision: {
          intent: 'replace',
          constraintReport: {
            ok: false,
            issues: [{
              code: 'missing_required_slot',
              severity: 'info',
              message: 'Agent Core needs more information or blocked this operation.',
            }],
          },
        },
        explanation: 'Agent Core needs more information or blocked this operation.',
        trace: runtime.trace.getTrace(),
      }
    }

    if (pendingTask.phase === 'needs_confirmation') {
      return this.confirmPendingReplace(input, runtime, pendingTask)
    }

    const latestSlots = this.parseReplace(input)
    const invalidTargetSelectionResult = this.buildInvalidPendingTargetSelectionResultIfNeeded(input, runtime, pendingTask)
    if (invalidTargetSelectionResult) return invalidTargetSelectionResult
    const selectedTargetId = this.resolveSelectedTargetItemId(input, pendingTask)
    const targetTime = latestSlots.targetTime ?? this.readStringSlot(pendingTask.collectedSlots.targetTime)
    const targetItemId = latestSlots.targetItemId
      ?? selectedTargetId
      ?? this.readStringSlot(pendingTask.collectedSlots.targetItemId)
    const pendingTargetProgramName = this.readStringSlot(pendingTask.collectedSlots.targetProgramName)
    const targetProgramName = pendingTargetProgramName
      ?? (!targetTime && !targetItemId ? latestSlots.targetProgramName : undefined)
    const replacementHint = latestSlots.replacementHint ?? this.readStringSlot(pendingTask.collectedSlots.replacementHint)
    const selectedCandidateId = this.resolveSelectedCandidateId(input, pendingTask)
      ?? (this.isPendingCandidateSelectionOpen(pendingTask) ? undefined : latestSlots.selectedCandidateId)
      ?? this.readStringSlot(pendingTask.collectedSlots.candidateId)
    const hasTargetSelector = Boolean(targetTime || targetItemId || targetProgramName)
    const missingSlots = [
      ...(!hasTargetSelector ? ['targetItemId'] : []),
      ...(!replacementHint ? ['replacementHint'] : []),
    ]
    const continuedTask = continuePendingTask({
      pendingTask,
      latestUserInput: input.userInput,
      slotPatch: {
        ...(latestSlots.targetTime
          ? {
              targetTime: {
                value: latestSlots.targetTime,
                source: 'user_followup' as const,
                confidence: 0.9,
                rawText: input.userInput,
              },
            }
          : {}),
        ...(targetItemId
          ? {
              targetItemId: {
                value: targetItemId,
                source: 'user_followup' as const,
                confidence: 0.95,
                rawText: input.userInput,
              },
            }
          : {}),
        ...(!pendingTargetProgramName && latestSlots.targetProgramName && !targetTime && !targetItemId
          ? {
              targetProgramName: {
                value: latestSlots.targetProgramName,
                source: 'user_followup' as const,
                confidence: 0.9,
                rawText: input.userInput,
              },
            }
          : {}),
        ...(latestSlots.replacementHint
          ? {
              replacementHint: {
                value: latestSlots.replacementHint,
                source: 'user_followup' as const,
                confidence: 0.85,
                rawText: input.userInput,
              },
            }
          : {}),
        ...(selectedCandidateId
          ? {
              candidateId: {
                value: selectedCandidateId,
                source: 'user_followup' as const,
                confidence: 0.95,
                rawText: input.userInput,
              },
            }
          : {}),
      },
      missingSlots,
    })

    if (!hasTargetSelector || !replacementHint) {
      return {
        status: 'needs_clarification',
        input,
        decision: {
          intent: 'replace',
          pendingTask: continuedTask,
          constraintReport: {
            ok: false,
            issues: [{
              code: 'missing_required_slot',
              severity: 'critical',
              message: missingSlots.includes('targetItemId') ? 'Select one target item to replace.' : 'Replacement still needs a candidate programme.',
            }],
          },
        },
        explanation: missingSlots.includes('targetItemId')
          ? 'Select one target item to replace.'
          : 'Replacement still needs a candidate programme.',
        trace: runtime.trace.getTrace(),
      }
    }

    return this.executeReplaceWithSlots(input, runtime, {
      targetTime,
      replacementHint,
      source: 'pending',
      targetItemId,
      targetProgramName,
      selectedCandidateId,
      pendingTask: continuedTask,
    })
  }

  private async confirmPendingReplace(
    input: AgentSubmitInput,
    runtime: AgentCapabilityRuntime,
    pendingTask: NonNullable<AgentSubmitInput['pendingTask']>,
  ): Promise<AgentResult> {
    if (this.isCancelInput(input)) {
      return this.buildPendingCancelledResult(input, runtime, 'replace', 'replace confirmation was rejected or cancelled.')
    }

    const invalidCandidateSelectionResult = this.buildInvalidPendingCandidateSelectionResultIfNeeded(input, runtime, pendingTask)
    if (invalidCandidateSelectionResult) return invalidCandidateSelectionResult

    const explicitSelectedCandidateId = this.resolveSelectedCandidateId(input, pendingTask)
    if (!this.isConfirmationInput(input)) {
      const nextPendingTask = explicitSelectedCandidateId
        ? this.updatePendingCandidateSelection(pendingTask, explicitSelectedCandidateId, input.userInput)
        : pendingTask
      return {
        status: 'needs_confirmation',
        input,
        decision: {
          intent: 'replace',
          pendingTask: nextPendingTask,
          recommendations: nextPendingTask.recommendations,
          constraintReport: {
            ok: false,
            issues: [{
              code: 'missing_required_slot',
              severity: 'warning',
              message: 'Replacement is ready but still needs explicit confirmation before writing.',
            }],
          },
        },
        explanation: 'Replacement is ready; please confirm before the agent writes the playlist.',
        trace: runtime.trace.getTrace(),
      }
    }

    const selectedCandidateId = explicitSelectedCandidateId
      ?? this.readStringSlot(pendingTask.collectedSlots.candidateId)

    if (!selectedCandidateId) {
      return {
        status: 'needs_confirmation',
        input,
        decision: {
          intent: 'replace',
          pendingTask,
          recommendations: pendingTask.recommendations,
          constraintReport: {
            ok: false,
            issues: [{
              code: 'missing_required_slot',
              severity: 'critical',
              message: 'Agent Core needs more information or blocked this operation.',
            }],
          },
        },
        explanation: 'Agent Core needs more information or blocked this operation.',
        trace: runtime.trace.getTrace(),
      }
    }

    const targetTime = this.readStringSlot(pendingTask.collectedSlots.targetTime)
    const replacementHint = this.readStringSlot(pendingTask.collectedSlots.replacementHint)
    const targetItemId = this.readStringSlot(pendingTask.collectedSlots.targetItemId)
    if (!targetTime || !replacementHint || !targetItemId) {
      return {
        status: 'needs_clarification',
        input,
        decision: {
          intent: 'replace',
          pendingTask,
          constraintReport: {
            ok: false,
            issues: [{
              code: 'missing_required_slot',
              severity: 'critical',
              message: 'Agent Core needs more information or blocked this operation.',
            }],
          },
        },
        explanation: 'Agent Core needs more information or blocked this operation.',
        trace: runtime.trace.getTrace(),
      }
    }

    return this.executeReplaceWithSlots(input, runtime, {
      targetTime,
      replacementHint,
      source: 'pending',
      targetItemId,
      selectedCandidateId,
      forceExecute: true,
      pendingTask,
    })
  }

  private async buildReplaceClarificationResult(
    input: AgentSubmitInput,
    replaceSlots: ReplaceSlots,
    runtime: AgentCapabilityRuntime,
  ): Promise<AgentResult> {
    const hasTargetSelector = this.hasReplaceTargetSelector(replaceSlots)
    const missingSlots = [
      ...(!hasTargetSelector ? ['targetItemId'] : []),
      ...(!replaceSlots.replacementHint ? ['replacementHint'] : []),
    ]
    const context = await runtime.dataGateway.loadContext(input)
    const pendingTask = createPendingTask({
      intent: 'replace',
      phase: 'needs_clarification',
      originalInput: input.userInput,
      collectedSlots: {
        ...(replaceSlots.targetTime
          ? {
              targetTime: {
                value: replaceSlots.targetTime,
                source: 'user_initial' as const,
                confidence: 0.9,
              },
            }
          : {}),
        ...(replaceSlots.targetItemId
          ? {
              targetItemId: {
                value: replaceSlots.targetItemId,
                source: 'user_initial' as const,
                confidence: 0.95,
              },
            }
          : {}),
        ...(replaceSlots.targetProgramName
          ? {
              targetProgramName: {
                value: replaceSlots.targetProgramName,
                source: 'user_initial' as const,
                confidence: 0.9,
              },
            }
          : {}),
        ...(replaceSlots.replacementHint
          ? {
              replacementHint: {
                value: replaceSlots.replacementHint,
                source: 'user_initial' as const,
                confidence: 0.85,
              },
            }
          : {}),
        ...(replaceSlots.selectedCandidateId
          ? {
              candidateId: {
                value: replaceSlots.selectedCandidateId,
                source: 'user_initial' as const,
                confidence: 0.95,
              },
            }
          : {}),
      },
      missingSlots,
      contextFingerprint: this.buildPendingContextFingerprint(context),
      contextSources: this.buildPendingContextSourceSnapshots(context),
    })

    return {
      status: 'needs_clarification',
      input,
      decision: {
        intent: 'replace',
        pendingTask,
        constraintReport: {
          ok: false,
          issues: [{
            code: 'missing_required_slot',
            severity: 'critical',
            message: missingSlots.includes('targetItemId') ? 'Replacement still needs the target item.' : 'Replacement still needs the replacement programme.',
          }],
        },
      },
      explanation: missingSlots.includes('targetItemId')
        ? 'Replacement still needs the target item.'
        : 'Replacement still needs the replacement programme.',
      trace: runtime.trace.getTrace(),
    }
  }

  private async executeReplaceWithSlots(
    input: AgentSubmitInput,
    runtime: AgentCapabilityRuntime,
    replaceSlots: {
      targetTime?: string
      replacementHint: string
      source: 'initial' | 'pending'
      targetItemId?: string
      targetProgramName?: string
      selectedCandidateId?: string
      forceExecute?: boolean
      pendingTask?: AgentSubmitInput['pendingTask']
    },
  ): Promise<AgentResult> {
    runtime.trace.record('resolving_context', 'Agent Core trace step.', {
      channelId: input.channelId,
      date: input.date,
      playlistId: input.playlistId,
      source: replaceSlots.source,
    })
    const context = await runtime.dataGateway.loadContext(input)
    const contextChangedResult = this.buildPendingContextChangedResultIfNeeded(input, runtime, replaceSlots.pendingTask, context)
    if (contextChangedResult) return contextChangedResult
    const missingScheduleSourceResult = this.buildScheduleSourceMissingResultIfNeeded(input, runtime, context, 'replace', replaceSlots.pendingTask)
    if (missingScheduleSourceResult) return missingScheduleSourceResult

    const targets = this.resolveTargets(context, replaceSlots)

    if (targets.length !== 1) {
      const status = targets.length === 0 ? 'blocked' : 'needs_clarification'
      const code = targets.length === 0 ? 'target_not_found' : 'target_ambiguous'
      const targetLabel = this.describeTargetSelector(replaceSlots)
      const message = targets.length === 0
        ? 'No matching target was found.'
        : 'Multiple targets matched; select one target.'
      const pendingTargetTask = targets.length > 1
        ? this.createTargetAmbiguityPendingTask(input, 'replace', replaceSlots, targets, context, {
            replacementHint: {
              value: replaceSlots.replacementHint,
              source: replaceSlots.source === 'pending' ? 'user_followup' : 'user_initial',
              confidence: 0.85,
              rawText: input.userInput,
            },
          })
        : replaceSlots.pendingTask ?? undefined
      return {
        status,
        input,
        decision: {
          intent: 'replace',
          resolvedTargets: targets,
          pendingTask: pendingTargetTask,
          constraintReport: {
            ok: false,
            issues: [{ code, severity: 'critical', message }],
          },
        },
        explanation: message,
        trace: runtime.trace.getTrace(),
      }
    }

    const target = targets[0]!
    const targetTime = replaceSlots.targetTime ?? toClockText(target.startTime)
    const missingCandidateSourceResult = this.buildCandidateSourceMissingResultIfNeeded(input, runtime, context, 'replace', replaceSlots.pendingTask, [target])
    if (missingCandidateSourceResult) return missingCandidateSourceResult

    const candidatePool = this.resolveCandidatePool(
      context.programCandidates,
      replaceSlots.replacementHint,
      input,
      runtime,
    )
    const explicitCandidate = replaceSlots.selectedCandidateId
      ? context.programCandidates.find((candidate) => candidate.id === replaceSlots.selectedCandidateId)
      : undefined
    const effectiveCandidates = replaceSlots.selectedCandidateId
      ? explicitCandidate ? [explicitCandidate] : []
      : candidatePool.candidates

    if (effectiveCandidates.length === 0) {
      const searchRetryPlan = this.buildCandidateSearchRetryPlan(input, context, replaceSlots.replacementHint, candidatePool.attempts)
      return {
        status: 'needs_clarification',
        input,
        decision: {
          intent: 'replace',
          resolvedTargets: [target],
          pendingTask: replaceSlots.pendingTask ?? undefined,
          constraintReport: {
            ok: false,
            issues: [{
              code: 'program_not_found',
              severity: 'critical',
              message: '我查了当前候选库，暂时没有找到可用于替换的节目或素材。',
              detail: searchRetryPlan,
            }],
          },
        },
        explanation: '我会先保留这次替换任务，并尝试换一组相近关键词继续检索；你也可以补充更具体的节目名、栏目或内容线索。',
        trace: runtime.trace.getTrace(),
      }
    }

    runtime.trace.record('planning', 'Choose replace strategy by playlist type.', {
      playlistType: context.playlistType,
      rotationStrategy: context.rotationStrategy,
      targetItemId: target.id,
      candidateCount: effectiveCandidates.length,
      candidateSearchMatchedBy: candidatePool.matchedBy,
      forceExecute: replaceSlots.forceExecute,
    })
    const candidateSelection = replaceSlots.selectedCandidateId
      ? this.buildExplicitCandidateSelection(effectiveCandidates[0]!, effectiveCandidates.length, input, context, 'replace', targetTime, target)
      : await this.selectCandidate(input, runtime, context, 'replace', effectiveCandidates, targetTime, target)
    const candidateSelectionPendingResult = this.buildCandidateSelectionPendingResultIfNeeded(input, runtime, {
      intent: 'replace',
      context,
      diagnostics: candidateSelection.diagnostics,
      candidates: candidateSelection.candidateOptions,
      collectedSlots: {
        targetTime: {
          value: targetTime,
          source: replaceSlots.source === 'initial' ? 'user_initial' : 'user_followup',
          confidence: 0.9,
        },
        replacementHint: {
          value: replaceSlots.replacementHint,
          source: replaceSlots.source === 'initial' ? 'user_initial' : 'user_followup',
          confidence: 0.85,
        },
        targetItemId: {
          value: target.id,
          source: 'system_inferred',
          confidence: 1,
        },
      },
      resolvedTargets: [target],
    })
    if (candidateSelectionPendingResult) return candidateSelectionPendingResult
    const selectedCandidate = candidateSelection.candidate
    if (!selectedCandidate) {
      const issue = this.buildCandidateSelectionBlockedIssue(candidateSelection.diagnostics, replaceSlots.replacementHint)
      return {
        status: 'blocked',
        input,
        decision: {
          intent: 'replace',
          resolvedTargets: [target],
          candidateSelection: candidateSelection.diagnostics,
          constraintReport: {
            ok: false,
            issues: [issue],
          },
        },
        explanation: issue.message,
        trace: runtime.trace.getTrace(),
      }
    }
    const professionalBlockIssue = this.buildCandidateProfessionalBlockIssueIfNeeded(candidateSelection.diagnostics, {
      allowedSignalCodes: ['material_readiness', 'rights_readiness'],
    })
    if (professionalBlockIssue) {
      return {
        status: 'blocked',
        input,
        decision: {
          intent: 'replace',
          resolvedTargets: [target],
          candidateSelection: candidateSelection.diagnostics,
          constraintReport: {
            ok: false,
            issues: [professionalBlockIssue],
          },
          pendingTask: replaceSlots.pendingTask ?? undefined,
        },
        explanation: professionalBlockIssue.message,
        trace: runtime.trace.getTrace(),
      }
    }

    const command = this.buildReplaceCommand(input.date, target, targetTime, selectedCandidate)
    const preview = this.previewReplace(command, context)
    const constraintReport = this.constraintEngine.checkReplace(command, context, preview.after)
    const recommendations = this.buildRecommendations(effectiveCandidates, input.userInput, context, {
      selectedCandidate,
      assessmentByCandidateId: this.buildRecommendationAssessmentMap(candidateSelection.diagnostics),
    })
    const policyDecision = this.playlistPolicy.decideCandidateWrite({
      intent: 'replace',
      context,
      forceExecute: replaceSlots.forceExecute,
    })

    runtime.trace.record('previewing', 'Agent Core trace step.', {
      command,
      playlistType: context.playlistType,
      recommendationCount: recommendations.length,
      policyAction: policyDecision.action,
      policyReason: policyDecision.reason,
    })
    if (!constraintReport.ok) {
      return {
        status: 'blocked',
        input,
        decision: {
          intent: 'replace',
          command,
          resolvedTargets: [target],
          recommendations,
          candidateSelection: candidateSelection.diagnostics,
          constraintReport,
          preview,
          pendingTask: replaceSlots.pendingTask ?? undefined,
        },
        explanation: constraintReport.issues[0]?.message ?? 'Agent Core fallback message.',
        trace: runtime.trace.getTrace(),
      }
    }

    const postPreviewProfessionalBlockIssue = context.playlistType === 'tv'
      ? this.buildCandidateProfessionalBlockIssueIfNeeded(candidateSelection.diagnostics, {
          allowedSignalCodes: ['same_day_duplicate', 'recent_replay_interval'],
        })
      : null
    if (postPreviewProfessionalBlockIssue) {
      return {
        status: 'blocked',
        input,
        decision: {
          intent: 'replace',
          command,
          resolvedTargets: [target],
          recommendations,
          candidateSelection: candidateSelection.diagnostics,
          constraintReport: {
            ok: false,
            issues: [postPreviewProfessionalBlockIssue],
          },
          preview,
          pendingTask: replaceSlots.pendingTask ?? undefined,
        },
        explanation: postPreviewProfessionalBlockIssue.message,
        trace: runtime.trace.getTrace(),
      }
    }

    if (policyDecision.action === 'confirm') {
      const previousPendingTask = replaceSlots.pendingTask
      const pendingTask = createPendingTask({
        intent: 'replace',
        phase: 'needs_confirmation',
        originalInput: previousPendingTask?.originalInput || input.userInput,
        collectedInput: this.mergeCollectedInput(previousPendingTask?.collectedInput, input.userInput),
        collectedSlots: {
          ...(previousPendingTask?.collectedSlots ?? {}),
          targetTime: {
            value: targetTime,
            source: replaceSlots.source === 'initial' ? 'user_initial' : 'user_followup',
            confidence: 0.9,
          },
          replacementHint: {
            value: replaceSlots.replacementHint,
            source: replaceSlots.source === 'initial' ? 'user_initial' : 'user_followup',
            confidence: 0.85,
          },
          targetItemId: {
            value: target.id,
            source: 'system_inferred',
            confidence: 1,
          },
          candidateId: {
            value: selectedCandidate.id,
            source: 'system_inferred',
            confidence: 0.8,
          },
        },
        missingSlots: ['confirmation'],
        recommendations,
        contextFingerprint: this.buildPendingContextFingerprint(context),
        contextSources: this.buildPendingContextSourceSnapshots(context),
      })

      return {
        status: 'needs_confirmation',
        input,
        decision: {
          intent: 'replace',
          command,
          resolvedTargets: [target],
          recommendations,
          candidateSelection: candidateSelection.diagnostics,
          constraintReport,
          preview,
          pendingTask: {
            ...pendingTask,
            attemptCount: previousPendingTask ? previousPendingTask.attemptCount + 1 : pendingTask.attemptCount,
            createdAt: previousPendingTask?.createdAt ?? pendingTask.createdAt,
          },
        },
        explanation: `轮播单替换《${selectedCandidate.programName}》前需要确认。`,
        trace: runtime.trace.getTrace(),
      }
    }

    runtime.trace.record(
      'executing',
      context.playlistType === 'rotation'
        ? 'Rotation replace candidate confirmed; committing playlist replacement.'
        : 'TV replace candidate passed deterministic checks; committing replacement.',
      {
        command,
        selectedCandidateId: selectedCandidate.id,
      },
    )
    const executionResult = await runtime.dataGateway.commitScheduleItems({
      channelId: input.channelId,
      date: input.date,
      playlistId: input.playlistId,
      items: preview.after,
      reason: `agent:${this.id}:replace:${context.playlistType}`,
      expectedContextFingerprint: this.buildContextFingerprint(context),
    })
    const commitConflictResult = this.buildCommitConflictResultIfNeeded(input, runtime, 'replace', executionResult, command, [target], constraintReport, preview, replaceSlots.pendingTask)
    if (commitConflictResult) return commitConflictResult
    runtime.trace.record('validating', 'Validate playlist after commit.', {
      affectedItemIds: executionResult.affectedItemIds,
    })
    const validationReport = this.constraintEngine.validateSchedule(executionResult.scheduleItems)

    return {
      status: validationReport.ok ? 'executed' : 'failed',
      input,
      decision: {
        intent: 'replace',
        command,
        resolvedTargets: [target],
        recommendations,
        candidateSelection: candidateSelection.diagnostics,
        constraintReport,
        preview,
        pendingTask: replaceSlots.pendingTask ?? undefined,
      },
      executionResult,
      validationReport,
      explanation: validationReport.ok
        ? context.playlistType === 'rotation'
          ? `轮播单已确认，将 ${target.programName} 替换为 ${selectedCandidate.programName}。`
          : `电视播单已将 ${target.programName} 替换为 ${selectedCandidate.programName}。`
        : validationReport.issues[0]?.message ?? 'Agent Core fallback message.',
      trace: runtime.trace.getTrace(),
    }
  }

  private async continuePendingInsert(input: AgentSubmitInput, runtime: AgentCapabilityRuntime): Promise<AgentResult> {
    const pendingTask = input.pendingTask
    if (!pendingTask) return this.handleInsert(input, runtime)

    runtime.trace.record('understanding', 'Agent Core trace step.', {
      pendingTaskId: pendingTask.id,
      pendingPhase: pendingTask.phase,
      missingSlots: pendingTask.missingSlots,
    })

    if (this.isCancelInput(input)) {
      return {
        status: 'needs_clarification',
        input,
        decision: {
          intent: 'insert',
          constraintReport: {
            ok: false,
            issues: [{
              code: 'missing_required_slot',
              severity: 'info',
              message: 'Agent Core needs more information or blocked this operation.',
            }],
          },
        },
        explanation: 'Agent Core needs more information or blocked this operation.',
        trace: runtime.trace.getTrace(),
      }
    }

    if (pendingTask.phase === 'needs_confirmation') {
      return this.confirmPendingInsert(input, runtime, pendingTask)
    }

    const invalidCandidateSelectionResult = this.buildInvalidPendingCandidateSelectionResultIfNeeded(input, runtime, pendingTask)
    if (invalidCandidateSelectionResult) return invalidCandidateSelectionResult

    const latestSlots = this.parseInsert(input)
    const targetTime = latestSlots.targetTime ?? this.readStringSlot(pendingTask.collectedSlots.targetTime)
    const programHint = latestSlots.programHint ?? this.readStringSlot(pendingTask.collectedSlots.programHint)
    const selectedCandidateId = this.resolveSelectedCandidateId(input, pendingTask)
      ?? (this.isPendingCandidateSelectionOpen(pendingTask) ? undefined : latestSlots.selectedCandidateId)
      ?? this.readStringSlot(pendingTask.collectedSlots.candidateId)
    const missingSlots = [
      ...(!targetTime ? ['targetTime'] : []),
      ...(!programHint ? ['programHint'] : []),
    ]
    const continuedTask = continuePendingTask({
      pendingTask,
      latestUserInput: input.userInput,
      slotPatch: {
        ...(latestSlots.targetTime
          ? {
              targetTime: {
                value: latestSlots.targetTime,
                source: 'user_followup' as const,
                confidence: 0.9,
                rawText: input.userInput,
              },
            }
          : {}),
        ...(latestSlots.programHint
          ? {
              programHint: {
                value: latestSlots.programHint,
                source: 'user_followup' as const,
                confidence: 0.85,
                rawText: input.userInput,
              },
            }
          : {}),
        ...(selectedCandidateId
          ? {
              candidateId: {
                value: selectedCandidateId,
                source: 'user_followup' as const,
                confidence: 0.95,
                rawText: input.userInput,
              },
            }
          : {}),
      },
      missingSlots,
    })

    if (!targetTime || !programHint) {
      return {
        status: 'needs_clarification',
        input,
        decision: {
          intent: 'insert',
          pendingTask: continuedTask,
          constraintReport: {
            ok: false,
            issues: [{
              code: 'missing_required_slot',
              severity: 'critical',
              message: missingSlots.includes('targetTime') ? '还需要补充插入节目的播出时间。' : '还需要补充节目名、短片标题或素材关键词。',
            }],
          },
        },
        explanation: missingSlots.includes('targetTime')
          ? '还需要补充插入节目的播出时间。'
          : '还需要补充节目名、短片标题或素材关键词。',
        trace: runtime.trace.getTrace(),
      }
    }

    return this.executeInsertWithSlots(input, runtime, {
      targetTime,
      programHint,
      source: 'pending',
      selectedCandidateId,
      pendingTask: continuedTask,
    })
  }

  private async confirmPendingInsert(
    input: AgentSubmitInput,
    runtime: AgentCapabilityRuntime,
    pendingTask: NonNullable<AgentSubmitInput['pendingTask']>,
  ): Promise<AgentResult> {
    if (this.isCancelInput(input)) {
      return this.buildPendingCancelledResult(input, runtime, 'insert', 'insert confirmation was rejected or cancelled.')
    }

    const invalidCandidateSelectionResult = this.buildInvalidPendingCandidateSelectionResultIfNeeded(input, runtime, pendingTask)
    if (invalidCandidateSelectionResult) return invalidCandidateSelectionResult

    const explicitSelectedCandidateId = this.resolveSelectedCandidateId(input, pendingTask)
    if (!this.isConfirmationInput(input)) {
      const nextPendingTask = explicitSelectedCandidateId
        ? this.updatePendingCandidateSelection(pendingTask, explicitSelectedCandidateId, input.userInput)
        : pendingTask
      return {
        status: 'needs_confirmation',
        input,
        decision: {
          intent: 'insert',
          pendingTask: nextPendingTask,
          recommendations: nextPendingTask.recommendations,
          constraintReport: {
            ok: false,
            issues: [{
              code: 'missing_required_slot',
              severity: 'warning',
              message: '插入方案已经预演完成，写入当前播单前还需要明确确认。',
            }],
          },
        },
        explanation: '插入方案已经预演完成，请确认后我再写入当前播单。',
        trace: runtime.trace.getTrace(),
      }
    }

    const selectedCandidateId = explicitSelectedCandidateId
      ?? this.readStringSlot(pendingTask.collectedSlots.candidateId)

    const targetTime = this.readStringSlot(pendingTask.collectedSlots.targetTime)
    const programHint = this.readStringSlot(pendingTask.collectedSlots.programHint)
    if (!targetTime || !programHint || !selectedCandidateId) {
      return {
        status: 'needs_clarification',
        input,
        decision: {
          intent: 'insert',
          pendingTask,
          constraintReport: {
            ok: false,
            issues: [{
              code: 'missing_required_slot',
              severity: 'critical',
              message: '这次插入还缺少关键信息，或已被编排约束阻断。',
            }],
          },
        },
        explanation: '这次插入还缺少关键信息，或已被编排约束阻断。',
        trace: runtime.trace.getTrace(),
      }
    }

    return this.executeInsertWithSlots(input, runtime, {
      targetTime,
      programHint,
      source: 'pending',
      selectedCandidateId,
      forceExecute: true,
      pendingTask,
    })
  }

  private async buildInsertClarificationResult(
    input: AgentSubmitInput,
    insertSlots: InsertSlots,
    runtime: AgentCapabilityRuntime,
  ): Promise<AgentResult> {
    const missingSlots = [
      ...(!insertSlots.targetTime ? ['targetTime'] : []),
      ...(!insertSlots.programHint ? ['programHint'] : []),
    ]
    const context = await runtime.dataGateway.loadContext(input)
    const pendingTask = createPendingTask({
      intent: 'insert',
      phase: 'needs_clarification',
      originalInput: input.userInput,
      collectedSlots: {
        ...(insertSlots.targetTime
          ? {
              targetTime: {
                value: insertSlots.targetTime,
                source: 'user_initial' as const,
                confidence: 0.9,
              },
            }
          : {}),
        ...(insertSlots.programHint
          ? {
              programHint: {
                value: insertSlots.programHint,
                source: 'user_initial' as const,
                confidence: 0.85,
              },
            }
          : {}),
        ...(insertSlots.selectedCandidateId
          ? {
              candidateId: {
                value: insertSlots.selectedCandidateId,
                source: 'user_initial' as const,
                confidence: 0.95,
              },
            }
          : {}),
      },
      missingSlots,
      contextFingerprint: this.buildPendingContextFingerprint(context),
      contextSources: this.buildPendingContextSourceSnapshots(context),
    })

    return {
      status: 'needs_clarification',
      input,
      decision: {
        intent: 'insert',
        pendingTask,
        constraintReport: {
          ok: false,
          issues: [{
            code: 'missing_required_slot',
            severity: 'critical',
            message: missingSlots.includes('targetTime') ? '还需要补充插入节目的播出时间。' : '还需要补充节目名、短片标题或素材关键词。',
          }],
        },
      },
      explanation: missingSlots.includes('targetTime')
        ? '还需要补充插入节目的播出时间。'
        : '还需要补充节目名、短片标题或素材关键词。',
      trace: runtime.trace.getTrace(),
    }
  }

  private async executeInsertWithSlots(
    input: AgentSubmitInput,
    runtime: AgentCapabilityRuntime,
    insertSlots: {
      targetTime: string
      programHint: string
      source: 'initial' | 'pending'
      selectedCandidateId?: string
      forceExecute?: boolean
      pendingTask?: AgentSubmitInput['pendingTask']
    },
  ): Promise<AgentResult> {
    runtime.trace.record('resolving_context', 'Agent Core trace step.', {
      channelId: input.channelId,
      date: input.date,
      playlistId: input.playlistId,
      source: insertSlots.source,
    })
    const context = await runtime.dataGateway.loadContext(input)
    const contextChangedResult = this.buildPendingContextChangedResultIfNeeded(input, runtime, insertSlots.pendingTask, context)
    if (contextChangedResult) return contextChangedResult
    const missingScheduleSourceResult = this.buildScheduleSourceMissingResultIfNeeded(input, runtime, context, 'insert', insertSlots.pendingTask)
    if (missingScheduleSourceResult) return missingScheduleSourceResult

    const occupiedItems = this.resolveMoveTargets(context, insertSlots.targetTime)
    if (occupiedItems.length > 0) {
      const occupiedItem = occupiedItems[0]!
      return {
        status: 'blocked',
        input,
        decision: {
          intent: 'insert',
          pendingTask: insertSlots.pendingTask ?? undefined,
          constraintReport: {
            ok: false,
            issues: [{
              code: 'time_overlap',
              severity: 'critical',
              message: `目标位置已被《${occupiedItem.programName}》占用，本次插入已阻断；系统不会自动下移、替换或重排现有节目。`,
              detail: {
                conflictItemId: occupiedItem.id,
                conflictProgramName: occupiedItem.programName,
                conflictRange: { start: occupiedItem.startTime, end: occupiedItem.endTime },
                proposedRange: {
                  start: normalizeDateTime(input.date, insertSlots.targetTime),
                  end: normalizeDateTime(input.date, insertSlots.targetTime),
                },
                blockedPolicy: 'no_auto_shift_replace_reorder',
              },
            }],
          },
        },
        explanation: `目标位置已被《${occupiedItem.programName}》占用，本次写入已阻断。`,
        trace: runtime.trace.getTrace(),
      }
    }

    const missingCandidateSourceResult = this.buildCandidateSourceMissingResultIfNeeded(input, runtime, context, 'insert', insertSlots.pendingTask)
    if (missingCandidateSourceResult) return missingCandidateSourceResult

    const candidatePool = this.resolveCandidatePool(
      context.programCandidates,
      insertSlots.programHint,
      input,
      runtime,
    )
    const explicitCandidate = insertSlots.selectedCandidateId
      ? context.programCandidates.find((candidate) => candidate.id === insertSlots.selectedCandidateId)
      : undefined
    const effectiveCandidates = insertSlots.selectedCandidateId
      ? explicitCandidate ? [explicitCandidate] : []
      : candidatePool.candidates

    if (effectiveCandidates.length === 0) {
      const previousPendingTask = insertSlots.pendingTask
      const searchRetryPlan = this.buildCandidateSearchRetryPlan(input, context, insertSlots.programHint, candidatePool.attempts)
      const pendingTask = createPendingTask({
        intent: 'insert',
        phase: 'needs_clarification',
        originalInput: previousPendingTask?.originalInput || input.userInput,
        collectedInput: this.mergeCollectedInput(previousPendingTask?.collectedInput, input.userInput),
        collectedSlots: {
          ...(previousPendingTask?.collectedSlots ?? {}),
          targetTime: {
            value: insertSlots.targetTime,
            source: insertSlots.source === 'initial' ? 'user_initial' : 'user_followup',
            confidence: 0.9,
          },
          programHint: {
            value: insertSlots.programHint,
            source: insertSlots.source === 'initial' ? 'user_initial' : 'user_followup',
            confidence: 0.75,
          },
        },
        missingSlots: ['programHint'],
        contextFingerprint: this.buildPendingContextFingerprint(context),
        contextSources: this.buildPendingContextSourceSnapshots(context),
      })
      return {
        status: 'needs_clarification',
        input,
        decision: {
          intent: 'insert',
          pendingTask: {
            ...pendingTask,
            attemptCount: previousPendingTask ? previousPendingTask.attemptCount + 1 : pendingTask.attemptCount,
            createdAt: previousPendingTask?.createdAt ?? pendingTask.createdAt,
          },
          constraintReport: {
            ok: false,
            issues: [{
              code: 'program_not_found',
              severity: 'critical',
              message: '我查了当前候选库，暂时没有找到可插入的节目或素材。',
              detail: searchRetryPlan,
            }],
          },
        },
        explanation: '我会先保留这次插入任务；你可以换一个节目名，或补充标题、栏目、内容关键词后继续。',
        trace: runtime.trace.getTrace(),
      }
    }

    runtime.trace.record('planning', 'Choose insert strategy by playlist type.', {
      playlistType: context.playlistType,
      rotationStrategy: context.rotationStrategy,
      candidateCount: effectiveCandidates.length,
      candidateSearchMatchedBy: candidatePool.matchedBy,
      forceExecute: insertSlots.forceExecute,
    })
    const candidateSelection = insertSlots.selectedCandidateId
      ? this.buildExplicitCandidateSelection(effectiveCandidates[0]!, effectiveCandidates.length, input, context, 'insert', insertSlots.targetTime)
      : await this.selectCandidate(input, runtime, context, 'insert', effectiveCandidates, insertSlots.targetTime)
    const candidateSelectionPendingResult = this.buildCandidateSelectionPendingResultIfNeeded(input, runtime, {
      intent: 'insert',
      context,
      diagnostics: candidateSelection.diagnostics,
      candidates: candidateSelection.candidateOptions,
      collectedSlots: {
        targetTime: {
          value: insertSlots.targetTime,
          source: insertSlots.source === 'initial' ? 'user_initial' : 'user_followup',
          confidence: 0.9,
        },
        programHint: {
          value: insertSlots.programHint,
          source: insertSlots.source === 'initial' ? 'user_initial' : 'user_followup',
          confidence: 0.85,
        },
      },
    })
    if (candidateSelectionPendingResult) return candidateSelectionPendingResult
    const selectedCandidate = candidateSelection.candidate
    if (!selectedCandidate) {
      const issue = this.buildCandidateSelectionBlockedIssue(candidateSelection.diagnostics, insertSlots.programHint)
      return {
        status: 'blocked',
        input,
        decision: {
          intent: 'insert',
          candidateSelection: candidateSelection.diagnostics,
          constraintReport: {
            ok: false,
            issues: [issue],
          },
        },
        explanation: issue.message,
        trace: runtime.trace.getTrace(),
      }
    }
    const professionalBlockIssue = this.buildCandidateProfessionalBlockIssueIfNeeded(candidateSelection.diagnostics, {
      allowedSignalCodes: ['material_readiness', 'rights_readiness'],
    })
    if (professionalBlockIssue) {
      return {
        status: 'blocked',
        input,
        decision: {
          intent: 'insert',
          candidateSelection: candidateSelection.diagnostics,
          constraintReport: {
            ok: false,
            issues: [professionalBlockIssue],
          },
          pendingTask: insertSlots.pendingTask ?? undefined,
        },
        explanation: professionalBlockIssue.message,
        trace: runtime.trace.getTrace(),
      }
    }

    const command = this.buildInsertCommand(input.date, insertSlots.targetTime, selectedCandidate)
    const preview = this.previewInsert(command, context)
    const constraintReport = this.constraintEngine.checkInsert(command, context, preview.after)
    const recommendations = this.buildRecommendations(effectiveCandidates, input.userInput, context, {
      selectedCandidate,
      assessmentByCandidateId: this.buildRecommendationAssessmentMap(candidateSelection.diagnostics),
    })
    const policyDecision = this.playlistPolicy.decideCandidateWrite({
      intent: 'insert',
      context,
      forceExecute: insertSlots.forceExecute,
    })

    runtime.trace.record('previewing', 'Agent Core trace step.', {
      command,
      playlistType: context.playlistType,
      recommendationCount: recommendations.length,
      policyAction: policyDecision.action,
      policyReason: policyDecision.reason,
    })
    if (!constraintReport.ok) {
      return {
        status: 'blocked',
        input,
        decision: {
          intent: 'insert',
          command,
          recommendations,
          candidateSelection: candidateSelection.diagnostics,
          constraintReport,
          preview,
          pendingTask: insertSlots.pendingTask ?? undefined,
        },
        explanation: constraintReport.issues[0]?.message ?? 'Agent Core fallback message.',
        trace: runtime.trace.getTrace(),
      }
    }

    const postPreviewProfessionalBlockIssue = context.playlistType === 'tv'
      ? this.buildCandidateProfessionalBlockIssueIfNeeded(candidateSelection.diagnostics, {
          allowedSignalCodes: ['same_day_duplicate', 'recent_replay_interval'],
        })
      : null
    if (postPreviewProfessionalBlockIssue) {
      return {
        status: 'blocked',
        input,
        decision: {
          intent: 'insert',
          command,
          recommendations,
          candidateSelection: candidateSelection.diagnostics,
          constraintReport: {
            ok: false,
            issues: [postPreviewProfessionalBlockIssue],
          },
          preview,
          pendingTask: insertSlots.pendingTask ?? undefined,
        },
        explanation: postPreviewProfessionalBlockIssue.message,
        trace: runtime.trace.getTrace(),
      }
    }

    if (policyDecision.action === 'confirm') {
      const previousPendingTask = insertSlots.pendingTask
      const pendingTask = createPendingTask({
        intent: 'insert',
        phase: 'needs_confirmation',
        originalInput: previousPendingTask?.originalInput || input.userInput,
        collectedInput: this.mergeCollectedInput(previousPendingTask?.collectedInput, input.userInput),
        collectedSlots: {
          ...(previousPendingTask?.collectedSlots ?? {}),
          targetTime: {
            value: insertSlots.targetTime,
            source: insertSlots.source === 'initial' ? 'user_initial' : 'user_followup',
            confidence: 0.9,
          },
          programHint: {
            value: insertSlots.programHint,
            source: insertSlots.source === 'initial' ? 'user_initial' : 'user_followup',
            confidence: 0.85,
          },
          candidateId: {
            value: selectedCandidate.id,
            source: 'system_inferred',
            confidence: 0.8,
          },
        },
        missingSlots: ['confirmation'],
        recommendations,
        contextFingerprint: this.buildPendingContextFingerprint(context),
        contextSources: this.buildPendingContextSourceSnapshots(context),
      })

      return {
        status: 'needs_confirmation',
        input,
        decision: {
          intent: 'insert',
          command,
          recommendations,
          candidateSelection: candidateSelection.diagnostics,
          constraintReport,
          preview,
          pendingTask: {
            ...pendingTask,
            attemptCount: previousPendingTask ? previousPendingTask.attemptCount + 1 : pendingTask.attemptCount,
            createdAt: previousPendingTask?.createdAt ?? pendingTask.createdAt,
          },
        },
        explanation: `轮播单插入《${selectedCandidate.programName}》前需要确认。`,
        trace: runtime.trace.getTrace(),
      }
    }

    runtime.trace.record(
      'executing',
      context.playlistType === 'rotation'
        ? 'Rotation candidate confirmed; committing playlist change.'
        : 'TV insert candidate passed deterministic checks; committing playlist change.',
      {
        command,
        selectedCandidateId: selectedCandidate.id,
      },
    )
    const executionResult = await runtime.dataGateway.commitScheduleItems({
      channelId: input.channelId,
      date: input.date,
      playlistId: input.playlistId,
      items: preview.after,
      reason: `agent:${this.id}:insert:${context.playlistType}`,
      expectedContextFingerprint: this.buildContextFingerprint(context),
    })
    const commitConflictResult = this.buildCommitConflictResultIfNeeded(input, runtime, 'insert', executionResult, command, undefined, constraintReport, preview, insertSlots.pendingTask)
    if (commitConflictResult) return commitConflictResult
    runtime.trace.record('validating', 'Validate playlist after commit.', {
      affectedItemIds: executionResult.affectedItemIds,
    })
    const validationReport = this.constraintEngine.validateSchedule(executionResult.scheduleItems)

    return {
      status: validationReport.ok ? 'executed' : 'failed',
      input,
      decision: {
        intent: 'insert',
        command,
        recommendations,
        candidateSelection: candidateSelection.diagnostics,
        constraintReport,
        preview,
        pendingTask: insertSlots.pendingTask ?? undefined,
      },
      executionResult,
      validationReport,
      explanation: validationReport.ok
        ? context.playlistType === 'rotation'
          ? `轮播单已确认，已插入 ${selectedCandidate.programName}。`
          : `电视播单已插入 ${selectedCandidate.programName}。`
        : validationReport.issues[0]?.message ?? 'Agent Core fallback message.',
      trace: runtime.trace.getTrace(),
    }
  }

  private parseMove(input: AgentSubmitInput): MoveSlots | null {
    const interpreted = this.readInterpretedSlots(input)
    if (input.interpretation?.intent === 'move') {
      return {
        targetTime: interpreted?.targetTime,
        targetItemId: interpreted?.targetItemId,
        targetProgramName: interpreted?.targetProgramName,
        offsetSeconds: typeof interpreted?.offsetSeconds === 'number'
          ? this.resolveInterpretedOffsetSeconds(interpreted.offsetSeconds, interpreted.direction)
          : undefined,
        newStartTime: interpreted?.newStartTime,
      }
    }
    const clock = parseAtomicClockExpression(input.userInput)
    const hasMoveVerb = /(移动|移到|调到|调整到|改到|挪到|放到|排到|后移|前移|挪|推迟|推后|延后|提前|顺延|延迟|move)/iu.test(input.userInput)
    if (!hasMoveVerb) {
      if (input.pendingTask?.intent === 'move' && clock && this.isMoveDestinationOnlyFollowUp(input.userInput, clock.matchedText)) {
        return {
          newStartTime: clock.targetTime,
        }
      }
      return null
    }
    const absoluteMove = this.parseAbsoluteMoveFallback(input.userInput)
    if (absoluteMove) return absoluteMove
    const offset = parseAtomicOffset(input.userInput)
    if (clock && offset) {
      const signedOffsetSeconds = offset.direction === 'backward' ? -offset.offsetSeconds : offset.offsetSeconds
      return {
        targetTime: clock.targetTime,
        offsetSeconds: signedOffsetSeconds,
      }
    }
    const targetProgramName = this.extractMoveTargetProgramName(input.userInput, clock?.matchedText)
    if (offset && targetProgramName) {
      const signedOffsetSeconds = offset.direction === 'backward' ? -offset.offsetSeconds : offset.offsetSeconds
      return {
        targetProgramName,
        offsetSeconds: signedOffsetSeconds,
      }
    }
    if (clock) {
      return {
        targetProgramName,
        newStartTime: clock.targetTime,
      }
    }
    if (!targetProgramName) return null
    return {
      targetProgramName,
    }
  }

  private parseAbsoluteMoveFallback(userInput: string): MoveSlots | null {
    if (!/(移动到|移到|调到|调整到|改到|挪到|放到|排到|move\s+.+\s+to)/iu.test(userInput)) return null
    const clocks = parseAtomicClockExpressions(userInput, 4)
    const destination = clocks.at(-1)
    if (!destination) return null
    const source = clocks.length >= 2 ? clocks[0] : undefined
    const targetProgramName = this.extractAbsoluteMoveProgramHint(userInput, destination.matchedText)
    if (!source && !targetProgramName) return null
    return {
      targetTime: source?.targetTime,
      targetProgramName,
      newStartTime: destination.targetTime,
    }
  }

  private extractAbsoluteMoveProgramHint(userInput: string, destinationText?: string): string | undefined {
    const quoted = /[《「『](.+?)[》」』]/u.exec(userInput)?.[1]?.trim()
    if (quoted) return quoted

    let normalized = userInput.replace(/\s+/g, '')
    if (destinationText) normalized = normalized.replace(destinationText, '')
    const match = /(?:把|将)?(.+?)(?:移动到|移到|调到|调整到|改到|挪到|放到|排到)/u.exec(normalized)
    const raw = match?.[1]?.trim()
    if (!raw) return undefined

    const cleaned = raw
      .replace(/\d{1,2}[:：]\d{1,2}(?::\d{1,2})?/g, '')
      .replace(/\d{1,2}点(?:\d{1,2}分?)?/g, '')
      .replace(/^(?:把|将)/u, '')
      .replace(/(?:的)?(?:节目|栏目|内容|素材|这条|那条|当前)$/u, '')
      .trim()
    if (!cleaned || /^(?:节目|栏目|内容|素材|这条|那条|当前|目标)$/u.test(cleaned)) return undefined
    return cleaned
  }

  private extractMoveTargetProgramName(userInput: string, clockText?: string): string | undefined {
    const quoted = /[《「『](.+?)[》」』]/u.exec(userInput)?.[1]?.trim()
    if (quoted) return quoted

    let normalized = userInput.replace(/\s+/g, '')
    if (clockText) normalized = normalized.replace(clockText, '')
    const match = /(?:移动|调动|调整|挪动|后移|前移|推迟|推后|延后|提前|顺延|延迟|move)(?:节目|栏目|内容|素材)?(.+?)?$/iu.exec(normalized)
    const raw = (match?.[1] ?? normalized)
      .replace(/^(?:请|帮我|帮忙|把|将|这个|那个|当前|今天|今日|播单里|节目单里|的)+/u, '')
      .replace(/(?:移动|调动|调整|挪动|后移|前移|推迟|推后|延后|提前|顺延|延迟|move)/giu, '')
      .replace(/^(?:到|至|去到|放到|排到|移到|调到|改到|挪到)+/u, '')
      .replace(/(?:这个|那个|当前|今天|今日|的)?(?:节目|栏目|内容|素材|条目|这条|那条)$/u, '')
      .replace(/[，。！？；：、,.!?;:]/gu, '')
      .trim()
    if (!raw || /^(?:节目|栏目|内容|素材|条目|这条|那条|当前|目标)$/u.test(raw)) return undefined
    return raw
  }

  private isMoveDestinationOnlyFollowUp(userInput: string, clockText: string): boolean {
    const residue = userInput
      .replace(/\s+/g, '')
      .replace(clockText, '')
      .replace(/[，。！？；：、,.!?;:]/gu, '')
      .replace(/^(?:就|那|那就|好的|好|可以|行|定|放|排|安排|移动|移到|到|至|去到|吧|啊|呀|呢)+/u, '')
      .replace(/(?:就|吧|啊|呀|呢|可以|行|好的|好)$/u, '')
      .trim()
    return residue.length === 0
  }

  private parseBatchMove(input: AgentSubmitInput): BatchMoveSlots | null {
    const interpreted = this.readInterpretedSlots(input)
    if (input.interpretation?.intent === 'batch_move') {
      const rangeStart = interpreted?.rangeStart
      const rangeEnd = interpreted?.rangeEnd
      const offsetSeconds = typeof interpreted?.offsetSeconds === 'number'
        ? this.resolveInterpretedOffsetSeconds(interpreted.offsetSeconds, interpreted.direction)
        : undefined
      return {
        rangeStart,
        rangeEnd,
        targetRange: rangeStart && rangeEnd ? { start: rangeStart, end: rangeEnd } : undefined,
        offsetSeconds,
      }
    }
    if (!/(整体|批量|全部|范围|这段|这一段|programmes?|items?)/iu.test(input.userInput)) return null
    if (!/(移动|后移|前移|挪|推迟|推后|延后|提前|顺延|延迟|move)/iu.test(input.userInput)) return null
    const range = parseAtomicTimeRange(input.userInput)
    const offset = parseAtomicOffset(input.userInput)
    if (!range || !offset) return null
    const signedOffsetSeconds = offset.direction === 'backward' ? -offset.offsetSeconds : offset.offsetSeconds
    return {
      rangeStart: range.start,
      rangeEnd: range.end,
      targetRange: range,
      offsetSeconds: signedOffsetSeconds,
    }
  }

  private parseBatchDeleteSlots(input: AgentSubmitInput): BatchDeleteSlots {
    const interpreted = this.readInterpretedSlots(input)
    if (input.interpretation?.intent === 'batch_delete') {
      const rangeStart = interpreted?.rangeStart
      const rangeEnd = interpreted?.rangeEnd
      const textRange = parseAtomicTimeRange(input.userInput)
      return {
        rangeStart: rangeStart ?? textRange?.start,
        rangeEnd: rangeEnd ?? textRange?.end,
        targetRange: rangeStart && rangeEnd
          ? { start: rangeStart, end: rangeEnd }
          : textRange ?? undefined,
      }
    }
    const range = parseAtomicTimeRange(input.userInput)
    return range
      ? {
          rangeStart: range.start,
          rangeEnd: range.end,
          targetRange: range,
        }
      : {}
  }

  private parseBatchDeleteRange(input: AgentSubmitInput): { start: string; end: string } | null {
    const batchSlots = this.parseBatchDeleteSlots(input)
    if (batchSlots.targetRange) return batchSlots.targetRange
    const interpreted = this.readInterpretedSlots(input)
    if (input.interpretation?.intent === 'batch_delete' && interpreted?.rangeStart && interpreted.rangeEnd) {
      return {
        start: interpreted.rangeStart,
        end: interpreted.rangeEnd,
      }
    }
    if (!/(删除|删掉|移除|去掉|撤掉|delete|remove)/iu.test(input.userInput)) return null
    return parseAtomicTimeRange(input.userInput)
  }

  private parseDeleteTargetTime(input: AgentSubmitInput): string | undefined {
    const interpreted = this.readInterpretedSlots(input)
    if (input.interpretation?.intent === 'delete' && interpreted?.targetTime) return interpreted.targetTime
    if (!/(删除|删掉|移除|去掉|撤掉|delete|remove)/iu.test(input.userInput)) return undefined
    return parseAtomicClockExpression(input.userInput)?.targetTime
  }

  private parseDelete(input: AgentSubmitInput): DeleteSlots {
    const interpreted = this.readInterpretedSlots(input)
    if (input.interpretation?.intent === 'delete') {
      return {
        targetTime: interpreted?.targetTime ?? this.parseDeleteTargetTime(input),
        targetItemId: interpreted?.targetItemId,
        targetProgramName: interpreted?.targetProgramName,
      }
    }
    const clock = parseAtomicClockExpression(input.userInput)
    return {
      targetTime: this.parseDeleteTargetTime(input),
      targetProgramName: this.extractDeleteTargetProgramName(input.userInput, clock?.matchedText),
    }
  }

  private parseReplace(input: AgentSubmitInput): ReplaceSlots {
    const interpreted = this.readInterpretedSlots(input)
    if (input.interpretation?.intent === 'replace') {
      return {
        targetTime: interpreted?.targetTime,
        targetItemId: interpreted?.targetItemId,
        targetProgramName: interpreted?.targetProgramName,
        replacementHint: interpreted?.replacementHint,
        selectedCandidateId: interpreted?.candidateId,
      }
    }
    const clock = parseAtomicClockExpression(input.userInput)
    const reverseReplace = this.extractReverseReplaceSlots(input.userInput, clock?.matchedText)
    return {
      targetTime: clock?.targetTime,
      targetProgramName: reverseReplace?.targetProgramName
        ?? this.extractReplaceTargetProgramName(input.userInput, clock?.matchedText),
      replacementHint: reverseReplace?.replacementHint
        ?? this.extractReplaceProgramHint(input.userInput, clock?.matchedText),
    }
  }

  private inferIntent(userInput: string): AtomicCommandIntent | undefined {
    if (this.looksLikeBatchMove(userInput)) return 'batch_move'
    if (this.looksLikeBatchDelete(userInput)) return 'batch_delete'
    if (/(移动|移到|调到|调整到|改到|挪到|放到|排到|后移|前移|挪|推迟|推后|延后|提前|顺延|延迟|move)/iu.test(userInput)) return 'move'
    if (/(插入|添加|安排|排入|放置|加一条|加个|insert|add)/iu.test(userInput)) return 'insert'
    if (/(替换|换成|改成|改为|换播|replace)/iu.test(userInput)) return 'replace'
    if (/(删除|删掉|移除|去掉|撤掉|delete|remove)/iu.test(userInput)) return 'delete'
    if (/(校验|检查|体检|有没有问题|问题|冲突|重叠|validate|check)/iu.test(userInput)) return 'validate'
    if (/(查询|查找|查看|看看|有哪些|是什么|在哪里|在哪儿|在哪|哪里|什么时候播|几点播|播出时间|排在几点|当前节目单|当前播单|候选|节目库|素材库|query|find|show|list)/iu.test(userInput)) return 'query'
    return undefined
  }

  private looksLikeBatchMove(userInput: string): boolean {
    return Boolean(parseAtomicTimeRange(userInput))
      && /(移动|移到|调到|调整到|改到|挪到|放到|排到|后移|前移|挪|推迟|推后|延后|提前|顺延|延迟|move)/iu.test(userInput)
      && /(整体|批量|全部|范围|这段|这一段|节目|programmes?|items?)/iu.test(userInput)
  }

  private looksLikeBatchDelete(userInput: string): boolean {
    return Boolean(parseAtomicTimeRange(userInput))
      && /(删除|删掉|移除|去掉|撤掉|delete|remove)/iu.test(userInput)
  }

  private buildQueryCommand(input: AgentSubmitInput): QueryCommandPlan {
    const interpreted = input.interpretation
    if (interpreted?.intent === 'query' && interpreted.queryKind) {
      return {
        intent: 'query',
        queryKind: interpreted.queryKind,
        targetTime: interpreted.slots?.targetTime ? normalizeDateTime(input.date, interpreted.slots.targetTime) : undefined,
        keyword: interpreted.keyword ?? interpreted.slots?.programHint,
      }
    }
    const clock = parseAtomicClockExpression(input.userInput)
    const keyword = this.extractQueryKeyword(input.userInput, clock?.matchedText)

    if (/(候选|节目库|素材库|可用|可播|candidate|library|available)/iu.test(input.userInput)) {
      return {
        intent: 'query',
        queryKind: 'candidate_lookup',
        keyword,
      }
    }

    if (clock?.targetTime) {
      return {
        intent: 'query',
        queryKind: 'time_lookup',
        targetTime: normalizeDateTime(input.date, clock.targetTime),
        keyword,
      }
    }

    if (keyword) {
      return {
        intent: 'query',
        queryKind: 'program_lookup',
        keyword,
      }
    }

    return {
      intent: 'query',
      queryKind: 'schedule_summary',
    }
  }

  private executeQueryCommand(
    command: QueryCommandPlan,
    input: AgentSubmitInput,
    context: SchedulingContext,
    runtime: AgentCapabilityRuntime,
  ): AgentQueryResult {
    if (command.queryKind === 'candidate_lookup') {
      const candidatePool = command.keyword
        ? this.resolveCandidatePool(context.programCandidates, command.keyword, input, runtime)
        : {
            candidates: context.programCandidates,
            attempts: [],
            matchedBy: 'primary' as const,
          }
      return {
        kind: command.queryKind,
        queryText: input.userInput,
        playlistType: context.playlistType,
        totalCount: candidatePool.candidates.length,
        scheduleItems: [],
        candidates: candidatePool.candidates,
        keyword: command.keyword,
        searchAttempts: candidatePool.attempts,
        candidateSearchMatchedBy: candidatePool.matchedBy,
      }
    }

    if (command.queryKind === 'time_lookup' && command.targetTime) {
      const scheduleItems = this.resolveMoveTargets(context, command.targetTime)
      return {
        kind: command.queryKind,
        queryText: input.userInput,
        playlistType: context.playlistType,
        totalCount: scheduleItems.length,
        scheduleItems,
        candidates: [],
        targetTime: command.targetTime,
        keyword: command.keyword,
      }
    }

    if (command.queryKind === 'program_lookup' && command.keyword) {
      const normalizedKeyword = this.normalizeSearchText(command.keyword)
      const scheduleItems = context.scheduleItems.filter((item) => {
        const haystack = this.buildScheduleItemSearchHaystack(item)
        return haystack.includes(normalizedKeyword) || normalizedKeyword.includes(this.normalizeSearchText(item.programName))
      })
      return {
        kind: command.queryKind,
        queryText: input.userInput,
        playlistType: context.playlistType,
        totalCount: scheduleItems.length,
        scheduleItems,
        candidates: [],
        keyword: command.keyword,
      }
    }

    return {
      kind: 'schedule_summary',
      queryText: input.userInput,
      playlistType: context.playlistType,
      totalCount: context.scheduleItems.length,
      scheduleItems: context.scheduleItems,
      candidates: [],
    }
  }

  private buildQuerySourceEvidenceIssues(command: QueryCommandPlan, context: SchedulingContext): AgentConstraintIssue[] {
    if (command.queryKind === 'candidate_lookup') {
      const candidateSource = context.bundle.sources.candidates
      if (candidateSource.source === 'none' || !candidateSource.available) {
        return [{
          code: 'candidate_source_missing',
          severity: 'critical',
          message: 'Candidate programme source is missing; query result cannot distinguish an empty library from unavailable evidence.',
          detail: {
            source: candidateSource.source,
            recordCount: candidateSource.recordCount,
            available: candidateSource.available,
            status: candidateSource.status,
            errorCode: candidateSource.errorCode,
          },
        }]
      }
      return []
    }

    const todaySource = context.bundle.sources.today
    if (todaySource.source === 'none' || !todaySource.available) {
      return [{
        code: 'schedule_source_missing',
        severity: 'critical',
        message: 'Current playlist source is missing; query result cannot prove the active schedule state.',
        detail: {
          source: todaySource.source,
          recordCount: todaySource.recordCount,
          available: todaySource.available,
          status: todaySource.status,
          errorCode: todaySource.errorCode,
        },
      }]
    }

    return []
  }

  private buildQueryExplanation(queryResult: AgentQueryResult): string {
    if (queryResult.kind === 'candidate_lookup') {
      if (queryResult.totalCount === 0) return '没有找到匹配的候选节目。'
      const names = queryResult.candidates.slice(0, 3).map((candidate) => candidate.programName).join(', ')
      return `候选库找到 ${queryResult.totalCount} 个节目：${names}。`
    }

    if (queryResult.kind === 'time_lookup') {
      if (queryResult.totalCount === 0) return `${toClockText(queryResult.targetTime ?? '')} 没有匹配的播单节目。`
      const names = queryResult.scheduleItems.map((item) => `${toClockText(item.startTime)}-${toClockText(item.endTime)} ${item.programName}`).join(', ')
      return `${toClockText(queryResult.targetTime ?? '')} 命中 ${queryResult.totalCount} 个节目：${names}。`
    }

    if (queryResult.kind === 'program_lookup') {
      if (queryResult.totalCount === 0) return `没有找到匹配 ${queryResult.keyword ?? '查询条件'} 的播单节目。`
      const names = queryResult.scheduleItems.slice(0, 3).map((item) => `${toClockText(item.startTime)} ${item.programName}`).join(', ')
      return `播单中找到 ${queryResult.totalCount} 个匹配节目：${names}。`
    }

    const playlistLabel = queryResult.playlistType === 'rotation' ? '轮播单' : '电视播单'
    if (queryResult.totalCount === 0) return `当前${playlistLabel}没有节目。`
    const first = queryResult.scheduleItems[0]
    const last = queryResult.scheduleItems[queryResult.scheduleItems.length - 1]
    return `当前${playlistLabel}共有 ${queryResult.totalCount} 个节目，范围 ${toClockText(first?.startTime ?? '')}-${toClockText(last?.endTime ?? '')}。`
  }

  private resolveMoveTargets(context: SchedulingContext, targetTime: string): ScheduleItemSnapshot[] {
    const targetDateTime = normalizeDateTime(context.date, targetTime)
    const targetTs = new Date(targetDateTime).getTime()
    return context.scheduleItems.filter((item) => {
      const startTs = new Date(normalizeDateTime(context.date, item.startTime)).getTime()
      const endTs = new Date(normalizeDateTime(context.date, item.endTime)).getTime()
      return startTs <= targetTs && targetTs < endTs
    })
  }

  private resolveTargets(
    context: SchedulingContext,
    selector: {
      targetTime?: string
      targetItemId?: string
      targetProgramName?: string
    },
  ): ScheduleItemSnapshot[] {
    if (selector.targetItemId) {
      return context.scheduleItems.filter((item) => item.id === selector.targetItemId)
    }
    if (selector.targetProgramName) {
      const normalizedTarget = this.normalizeSearchText(selector.targetProgramName)
      return context.scheduleItems.filter((item) => {
        const haystack = this.buildScheduleItemTargetHaystack(item)
        return haystack.includes(normalizedTarget)
          || this.normalizedTextIncludesField(normalizedTarget, item.programName)
          || this.normalizedTextIncludesField(normalizedTarget, item.instanceName)
          || this.normalizedTextIncludesField(normalizedTarget, item.programCode)
      })
    }
    if (selector.targetTime) {
      return this.resolveMoveTargets(context, selector.targetTime)
    }
    return []
  }

  private createTargetAmbiguityPendingTask(
    input: AgentSubmitInput,
    intent: AtomicCommandIntent,
    selector: {
      targetTime?: string
      targetItemId?: string
      targetProgramName?: string
    },
    targets: ScheduleItemSnapshot[],
    context: SchedulingContext,
    extraSlots: AgentSlotBag = {},
  ): AgentPendingTask {
    return createPendingTask({
      intent,
      phase: 'needs_clarification',
      originalInput: input.userInput,
      collectedSlots: {
        ...this.buildTargetSelectorSlotPatch(selector, input.userInput),
        ...extraSlots,
      },
      missingSlots: ['targetItemId'],
      targetOptions: this.buildTargetOptions(targets),
      contextFingerprint: this.buildPendingContextFingerprint(context),
      contextSources: this.buildPendingContextSourceSnapshots(context),
    })
  }

  private buildTargetSelectorSlotPatch(
    selector: {
      targetTime?: string
      targetItemId?: string
      targetProgramName?: string
    },
    rawText: string,
  ): AgentSlotBag {
    return {
      ...(selector.targetTime
        ? {
            targetTime: {
              value: selector.targetTime,
              source: 'user_initial' as const,
              confidence: 0.9,
              rawText,
            },
          }
        : {}),
      ...(selector.targetItemId
        ? {
            targetItemId: {
              value: selector.targetItemId,
              source: 'user_initial' as const,
              confidence: 0.95,
              rawText,
            },
          }
        : {}),
      ...(selector.targetProgramName
        ? {
            targetProgramName: {
              value: selector.targetProgramName,
              source: 'user_initial' as const,
              confidence: 0.9,
              rawText,
            },
          }
        : {}),
    }
  }

  private buildMoveOperationSlotPatch(moveSlots: MoveSlots, rawText: string): AgentSlotBag {
    return {
      ...(typeof moveSlots.offsetSeconds === 'number'
        ? {
            offsetSeconds: {
              value: moveSlots.offsetSeconds,
              source: 'user_initial' as const,
              confidence: 0.9,
              rawText,
            },
          }
        : {}),
      ...(moveSlots.newStartTime
        ? {
            newStartTime: {
              value: moveSlots.newStartTime,
              source: 'user_initial' as const,
              confidence: 0.9,
              rawText,
            },
          }
        : {}),
    }
  }

  private buildBatchMoveSlotPatch(
    batchSlots: BatchMoveSlots,
    rawText: string,
    source: 'user_initial' | 'user_followup',
  ): AgentSlotBag {
    return {
      ...(batchSlots.rangeStart
        ? {
            rangeStart: {
              value: batchSlots.rangeStart,
              source,
              confidence: 0.9,
              rawText,
            },
          }
        : {}),
      ...(batchSlots.rangeEnd
        ? {
            rangeEnd: {
              value: batchSlots.rangeEnd,
              source,
              confidence: 0.9,
              rawText,
            },
          }
        : {}),
      ...(typeof batchSlots.offsetSeconds === 'number'
        ? {
            offsetSeconds: {
              value: batchSlots.offsetSeconds,
              source,
              confidence: 0.9,
              rawText,
            },
          }
        : {}),
    }
  }

  private buildBatchDeleteSlotPatch(
    batchSlots: BatchDeleteSlots,
    rawText: string,
    source: 'user_initial' | 'user_followup',
  ): AgentSlotBag {
    return {
      ...(batchSlots.rangeStart
        ? {
            rangeStart: {
              value: batchSlots.rangeStart,
              source,
              confidence: 0.9,
              rawText,
            },
          }
        : {}),
      ...(batchSlots.rangeEnd
        ? {
            rangeEnd: {
              value: batchSlots.rangeEnd,
              source,
              confidence: 0.9,
              rawText,
            },
          }
        : {}),
    }
  }

  private buildTargetOptions(targets: ScheduleItemSnapshot[]): AgentTargetOption[] {
    return targets.map((target) => ({
      itemId: target.id,
      programName: target.programName,
      programCode: target.programCode,
      startTime: target.startTime,
      endTime: target.endTime,
      duration: target.duration,
      programType: target.programType,
    }))
  }

  private resolvePendingTargetSnapshots(pendingTask: AgentPendingTask): ScheduleItemSnapshot[] {
    return (pendingTask.targetOptions ?? []).map((option, index) => ({
      id: option.itemId,
      programCode: option.programCode ?? option.itemId,
      programName: option.programName ?? option.itemId,
      startTime: option.startTime,
      endTime: option.endTime,
      duration: option.duration ?? Math.max(0, (new Date(option.endTime).getTime() - new Date(option.startTime).getTime()) / 1000),
      programType: option.programType ?? 'unknown',
      sequence: index + 1,
    }))
  }

  private buildInvalidPendingTargetSelectionResultIfNeeded(
    input: AgentSubmitInput,
    runtime: AgentCapabilityRuntime,
    pendingTask: AgentPendingTask,
  ): AgentResult | null {
    const targetOptions = pendingTask.targetOptions ?? []
    if (targetOptions.length === 0) return null

    const interpretedTargetId = input.interpretation?.slots?.targetItemId
    if (interpretedTargetId && !targetOptions.some((option) => option.itemId === interpretedTargetId)) {
      return this.buildInvalidPendingTargetSelectionResult(input, runtime, pendingTask, {
        targetItemId: interpretedTargetId,
      })
    }

    const interpretedTargetTime = input.interpretation?.slots?.targetTime
    const parsedTargetTime = parseAtomicClockExpression(input.userInput)?.targetTime
    const targetTime = interpretedTargetTime ?? parsedTargetTime
    if (targetTime && !targetOptions.some((option) => toClockText(option.startTime) === targetTime)) {
      return this.buildInvalidPendingTargetSelectionResult(input, runtime, pendingTask, {
        targetTime,
      })
    }

    return null
  }

  private buildInvalidPendingTargetSelectionResult(
    input: AgentSubmitInput,
    runtime: AgentCapabilityRuntime,
    pendingTask: AgentPendingTask,
    detail: { targetItemId?: string, targetTime?: string },
  ): AgentResult {
    const allowedTargetItemIds = (pendingTask.targetOptions ?? []).map((option) => option.itemId)
    const message = 'target selection is outside the pending target options; choose one listed target or start a new scheduling command.'
    return {
      status: 'needs_clarification',
      input,
      decision: {
        intent: pendingTask.intent,
        pendingTask,
        resolvedTargets: this.resolvePendingTargetSnapshots(pendingTask),
        constraintReport: {
          ok: false,
          issues: [{
            code: 'target_ambiguous',
            severity: 'warning',
            message,
            detail: {
              ...detail,
              allowedTargetItemIds,
            },
          }],
        },
      },
      explanation: message,
      trace: runtime.trace.getTrace(),
    }
  }

  private resolveSelectedTargetItemId(input: AgentSubmitInput, pendingTask: AgentPendingTask): string | undefined {
    const targetOptions = pendingTask.targetOptions ?? []
    const interpretedTargetId = input.interpretation?.slots?.targetItemId
    if (interpretedTargetId && targetOptions.some((option) => option.itemId === interpretedTargetId)) {
      return interpretedTargetId
    }

    const collectedTargetId = this.readStringSlot(pendingTask.collectedSlots.targetItemId)
    if (collectedTargetId && targetOptions.some((option) => option.itemId === collectedTargetId)) {
      return collectedTargetId
    }

    const interpretedTargetTime = input.interpretation?.slots?.targetTime
    const parsedTargetTime = parseAtomicClockExpression(input.userInput)?.targetTime
    const targetTime = interpretedTargetTime ?? parsedTargetTime
    if (targetTime) {
      const matchedByTime = targetOptions.find((option) => toClockText(option.startTime) === targetTime)
      if (matchedByTime) return matchedByTime.itemId
    }

    const ordinalIndex = this.parseOrdinalSelection(input.userInput)
    if (typeof ordinalIndex === 'number' && targetOptions[ordinalIndex]) {
      return targetOptions[ordinalIndex].itemId
    }

    return undefined
  }

  private parseOrdinalSelection(userInput: string): number | undefined {
    const match = /(?:第)?([一二三四五六七八九123456789])(?:个|条|项|条目)?/u.exec(userInput.trim())
    if (!match) return undefined
    const indexMap: Record<string, number> = {
      一: 0,
      二: 1,
      三: 2,
      四: 3,
      五: 4,
      六: 5,
      七: 6,
      八: 7,
      九: 8,
      '1': 0,
      '2': 1,
      '3': 2,
      '4': 3,
      '5': 4,
      '6': 5,
      '7': 6,
      '8': 7,
      '9': 8,
    }
    return indexMap[match[1]!]
  }

  private hasMoveTargetSelector(moveSlots: MoveSlots): boolean {
    return Boolean(moveSlots.targetTime || moveSlots.targetItemId || moveSlots.targetProgramName)
  }

  private hasDeleteTargetSelector(deleteSlots: DeleteSlots): boolean {
    return Boolean(deleteSlots.targetTime || deleteSlots.targetItemId || deleteSlots.targetProgramName)
  }

  private hasReplaceTargetSelector(replaceSlots: ReplaceSlots): boolean {
    return Boolean(replaceSlots.targetTime || replaceSlots.targetItemId || replaceSlots.targetProgramName)
  }

  private describeTargetSelector(selector: {
    targetTime?: string
    targetItemId?: string
    targetProgramName?: string
  }): string {
    if (selector.targetProgramName) return selector.targetProgramName
    if (selector.targetTime) return selector.targetTime
    if (selector.targetItemId) return `programme ${selector.targetItemId}`
    return 'target'
  }

  private resolveRangeTargets(context: SchedulingContext, rangeStart: string, rangeEnd: string): ScheduleItemSnapshot[] {
    const startDateTime = normalizeDateTime(context.date, rangeStart)
    const endDateTime = normalizeDateTime(context.date, rangeEnd)
    const startTs = new Date(startDateTime).getTime()
    const endTs = new Date(endDateTime).getTime()
    return context.scheduleItems.filter((item) => {
      const itemStartTs = new Date(item.startTime).getTime()
      return itemStartTs >= startTs && itemStartTs < endTs
    })
  }

  private buildMoveCommand(
    date: string,
    item: ScheduleItemSnapshot,
    moveSlots: MoveSlots,
  ): MoveCommandPlan {
    const startTime = normalizeDateTime(date, item.startTime)
    const endTime = normalizeDateTime(date, item.endTime)
    const newStartTime = moveSlots.newStartTime
      ? normalizeDateTime(date, moveSlots.newStartTime)
      : offsetDateTime(startTime, moveSlots.offsetSeconds ?? 0)
    const newEndTime = moveSlots.newStartTime
      ? offsetDateTime(newStartTime, item.duration)
      : offsetDateTime(endTime, moveSlots.offsetSeconds ?? 0)
    return {
      intent: 'move',
      itemId: item.id,
      targetTime: normalizeDateTime(date, moveSlots.targetTime ?? item.startTime),
      newStartTime,
      newEndTime,
      offsetSeconds: Math.floor((new Date(newStartTime).getTime() - new Date(startTime).getTime()) / 1000),
    }
  }

  private previewMove(command: MoveCommandPlan, context: SchedulingContext): AgentPreview {
    const after = sortScheduleItems(context.scheduleItems.map((item) =>
      item.id === command.itemId
        ? { ...item, startTime: command.newStartTime, endTime: command.newEndTime }
        : { ...item },
    ))

    return {
      command,
      before: context.scheduleItems.map((item) => ({ ...item })),
      after,
      affectedItemIds: [command.itemId],
      affectedTimeRanges: [{ start: command.newStartTime, end: command.newEndTime }],
    }
  }

  private buildBatchMoveCommand(
    date: string,
    items: ScheduleItemSnapshot[],
    targetRange: { start: string; end: string },
    offsetSeconds: number,
  ): BatchMoveCommandPlan {
    return {
      intent: 'batch_move',
      itemIds: items.map((item) => item.id),
      targetRange: {
        start: normalizeDateTime(date, targetRange.start),
        end: normalizeDateTime(date, targetRange.end),
      },
      offsetSeconds,
    }
  }

  private previewBatchMove(command: BatchMoveCommandPlan, context: SchedulingContext): AgentPreview {
    const movedItemIds = new Set(command.itemIds)
    const beforeById = new Map(context.scheduleItems.map((item) => [item.id, item]))
    const after = sortScheduleItems(context.scheduleItems.map((item) => {
      if (!movedItemIds.has(item.id)) return { ...item }
      const startTime = normalizeDateTime(context.date, item.startTime)
      const endTime = normalizeDateTime(context.date, item.endTime)
      return {
        ...item,
        startTime: offsetDateTime(startTime, command.offsetSeconds),
        endTime: offsetDateTime(endTime, command.offsetSeconds),
      }
    }))
    const affectedTimeRanges = command.itemIds
      .map((itemId) => {
        const before = beforeById.get(itemId)
        const moved = after.find((item) => item.id === itemId)
        return before && moved ? { start: moved.startTime, end: moved.endTime } : null
      })
      .filter((range): range is { start: string; end: string } => Boolean(range))

    return {
      command,
      before: context.scheduleItems.map((item) => ({ ...item })),
      after,
      affectedItemIds: command.itemIds,
      affectedTimeRanges,
    }
  }

  private buildDeleteCommand(date: string, item: ScheduleItemSnapshot, targetTime: string): DeleteCommandPlan {
    return {
      intent: 'delete',
      itemId: item.id,
      targetTime: normalizeDateTime(date, targetTime),
    }
  }

  private previewDelete(command: DeleteCommandPlan, context: SchedulingContext): AgentPreview {
    const target = context.scheduleItems.find((item) => item.id === command.itemId)
    const after = context.scheduleItems
      .filter((item) => item.id !== command.itemId)
      .map((item) => ({ ...item }))

    return {
      command,
      before: context.scheduleItems.map((item) => ({ ...item })),
      after,
      affectedItemIds: [command.itemId],
      affectedTimeRanges: target ? [{ start: target.startTime, end: target.endTime }] : [],
    }
  }

  private buildBatchDeleteCommand(
    date: string,
    items: ScheduleItemSnapshot[],
    targetRange: { start: string; end: string },
  ): BatchDeleteCommandPlan {
    return {
      intent: 'batch_delete',
      itemIds: items.map((item) => item.id),
      targetRange: {
        start: normalizeDateTime(date, targetRange.start),
        end: normalizeDateTime(date, targetRange.end),
      },
    }
  }

  private previewBatchDelete(command: BatchDeleteCommandPlan, context: SchedulingContext): AgentPreview {
    const targetItemIds = new Set(command.itemIds)
    const targets = context.scheduleItems.filter((item) => targetItemIds.has(item.id))
    const after = context.scheduleItems
      .filter((item) => !targetItemIds.has(item.id))
      .map((item) => ({ ...item }))

    return {
      command,
      before: context.scheduleItems.map((item) => ({ ...item })),
      after,
      affectedItemIds: command.itemIds,
      affectedTimeRanges: targets.map((item) => ({ start: item.startTime, end: item.endTime })),
    }
  }

  private buildReplaceCommand(
    date: string,
    item: ScheduleItemSnapshot,
    targetTime: string,
    candidate: AgentProgramCandidate,
  ): ReplaceCommandPlan {
    const startTime = normalizeDateTime(date, item.startTime)
    return {
      intent: 'replace',
      itemId: item.id,
      targetTime: normalizeDateTime(date, targetTime),
      candidateId: candidate.id,
      candidateName: candidate.programName,
      startTime,
      endTime: offsetDateTime(startTime, candidate.duration),
    }
  }

  private previewReplace(command: ReplaceCommandPlan, context: SchedulingContext): AgentPreview {
    const candidate = context.programCandidates.find((item) => item.id === command.candidateId)
    const after = sortScheduleItems(context.scheduleItems.map((item) =>
      item.id === command.itemId
        ? {
            ...item,
            programId: candidate?.programId,
            programCode: candidate?.programCode ?? command.candidateId,
            programName: candidate?.programName ?? command.candidateName,
            instanceName: candidate?.instanceName,
            columnId: candidate?.columnId,
            columnName: candidate?.columnName,
            contentTags: candidate?.contentTags,
            startTime: command.startTime,
            endTime: command.endTime,
            duration: candidate?.duration ?? Math.max(0, (new Date(command.endTime).getTime() - new Date(command.startTime).getTime()) / 1000),
            programType: candidate?.programType ?? item.programType,
          }
        : { ...item },
    ))

    return {
      command,
      before: context.scheduleItems.map((item) => ({ ...item })),
      after,
      affectedItemIds: [command.itemId],
      affectedTimeRanges: [{ start: command.startTime, end: command.endTime }],
    }
  }

  private parseInsert(input: AgentSubmitInput): InsertSlots {
    const interpreted = this.readInterpretedSlots(input)
    const clock = parseAtomicClockExpression(input.userInput)
    const isTimeOnlyFollowUp = this.isInsertTimeOnlyFollowUp(input.userInput, clock?.matchedText)
    const textProgramHint = isTimeOnlyFollowUp
      ? undefined
      : this.extractInsertProgramHint(input.userInput, clock?.matchedText)
    if (input.interpretation?.intent === 'insert') {
      const shouldPreservePendingProgramHint = Boolean(
        input.pendingTask
        && interpreted?.targetTime
        && !interpreted?.programHint
      )
      return {
        targetTime: interpreted?.targetTime ?? clock?.targetTime,
        programHint: isTimeOnlyFollowUp || shouldPreservePendingProgramHint
          ? undefined
          : this.cleanInsertProgramHint(interpreted?.programHint) ?? textProgramHint,
        selectedCandidateId: interpreted?.candidateId,
      }
    }
    return {
      targetTime: clock?.targetTime,
      programHint: textProgramHint,
    }
  }

  private extractInsertProgramHint(userInput: string, clockText?: string): string | undefined {
    let normalized = userInput.replace(/\s+/g, '')
    if (clockText) normalized = normalized.replace(clockText, '')
    const match = /(?:插入|添加|安排|排入|放置|加一条|加个)(?:节目|栏目|内容)?(.+)$/u.exec(normalized)
    const raw = (match?.[1] ?? normalized)
      .replace(/^(?:在|到|给|把|一个|一条|一段|节目|栏目|内容)+/u, '')
      .replace(/(?:节目|栏目|内容)$/u, '')
      .trim()
    return this.cleanInsertProgramHint(raw)
  }

  private isInsertTimeOnlyFollowUp(userInput: string, clockText?: string): boolean {
    const clock = clockText ? { matchedText: clockText } : parseAtomicClockExpression(userInput)
    if (!clock) return false
    const residue = userInput
      .replace(/\s+/g, '')
      .replace(clock.matchedText, '')
      .replace(/[，。！？；：、,.!?;:]/gu, '')
      .replace(/^(?:就|那|那就|好的|好|可以|行|定|放|排|安排|插|插入|在|到|吧|啊|呀|呢)+/u, '')
      .replace(/(?:就|吧|啊|呀|呢|可以|行|好的|好)$/u, '')
      .trim()
    return residue.length === 0
  }

  private cleanInsertProgramHint(value?: string): string | undefined {
    const cleaned = value
      ?.replace(/\s+/g, ' ')
      .replace(/[，。！？；：、,.!?;:]/gu, '')
      .replace(/^(?:请|帮我|帮忙|在|到|给|把|将|的|一个|一条|一段|节目|栏目|内容|素材|候选|可用|可播)+/u, '')
      .replace(/(?:节目|栏目|内容|素材|候选|可用|可播|一下)$/u, '')
      .trim()
    if (!cleaned || cleaned.length < 2) return undefined
    if (/^(?:就|那|那就|吧|啊|呀|呢|好|好的|可以|行|定|放|排|安排|插|插入)+$/u.test(cleaned)) return undefined
    return cleaned
  }

  private extractDeleteTargetProgramName(userInput: string, clockText?: string): string | undefined {
    const quoted = /[《「『](.+?)[》」』]/u.exec(userInput)?.[1]?.trim()
    if (quoted) return quoted

    let normalized = userInput.replace(/\s+/g, '')
    if (clockText) normalized = normalized.replace(clockText, '')
    const match = /(?:删除|删掉|移除|去掉|撤掉|delete|remove)(?:节目|栏目|内容|素材)?(.+)$/iu.exec(normalized)
    const raw = (match?.[1] ?? '')
      .replace(/^(?:把|将|这个|那个|当前|今天|今日|播单里|节目单里|的)+/u, '')
      .replace(/(?:这个|那个|当前|今天|今日|的)?(?:节目|栏目|内容|素材|条目|这一条|这条|那条)$/u, '')
      .replace(/[，。！？；：、,.!?;:]/gu, '')
      .trim()
    if (!raw || /^(?:节目|栏目|内容|素材|条目|这条|那条|当前|目标)$/u.test(raw)) return undefined
    return raw
  }

  private extractReplaceTargetProgramName(userInput: string, clockText?: string): string | undefined {
    const quoted = /[《「『](.+?)[》」』]/u.exec(userInput)?.[1]?.trim()
    if (quoted) return quoted

    let normalized = userInput.replace(/\s+/g, '')
    if (clockText) normalized = normalized.replace(clockText, '')
    const beforeReplacement = normalized.split(/替换成|替换为|换成|改成|改为|换播|替换/iu)[0] ?? ''
    const raw = beforeReplacement
      .replace(/^(?:请|帮我|帮忙|把|将|在|到|给|这个|那个|当前|今天|今日|播单里|节目单里|的)+/u, '')
      .replace(/(?:这个|那个|当前|今天|今日|的)?(?:节目|栏目|内容|素材|条目|这条|那条)$/u, '')
      .replace(/[，。！？；：、,.!?;:]/gu, '')
      .trim()
    if (!raw || /^(?:节目|栏目|内容|素材|条目|这条|那条|当前|目标)$/u.test(raw)) return undefined
    return raw
  }

  private extractReverseReplaceSlots(
    userInput: string,
    clockText?: string,
  ): { targetProgramName?: string, replacementHint?: string } | null {
    let normalized = userInput.replace(/\s+/g, '')
    if (clockText) normalized = normalized.replace(clockText, '')
    const match = /^(?:请|帮我|帮忙)?(?:用|拿|以)(.+?)(?:替换|换掉)(.+)$/u.exec(normalized)
    if (!match) return null
    const replacementHint = match[1]
      ?.replace(/[，。！？；：、,.!?;:]/gu, '')
      .trim()
    const targetProgramName = match[2]
      ?.replace(/^(?:把|将|这个|那个|当前|今天|今日|播单里|节目单里|的)+/u, '')
      .replace(/(?:这个|那个|当前|今天|今日|的)?(?:节目|栏目|内容|素材|条目|这条|那条)$/u, '')
      .replace(/[，。！？；：、,.!?;:]/gu, '')
      .trim()
    return {
      targetProgramName: targetProgramName || undefined,
      replacementHint: replacementHint || undefined,
    }
  }

  private extractReplaceProgramHint(userInput: string, clockText?: string): string | undefined {
    let normalized = userInput.replace(/\s+/g, '')
    if (clockText) normalized = normalized.replace(clockText, '')
    const match = /(?:替换成|替换为|换成|改成|改为|换播|替换)(?:节目|栏目|内容)?(.+)$/u.exec(normalized)
    const raw = (match?.[1] ?? normalized)
      .replace(/^(?:把|将|在|到|给|的|节目|栏目|内容)+/u, '')
      .replace(/^(?:替换成|替换为|换成|改成|改为|换播|替换)+/u, '')
      .replace(/(?:节目|栏目|内容)$/u, '')
      .trim()
    return raw || undefined
  }

  private extractQueryKeyword(userInput: string, clockText?: string): string | undefined {
    let normalized = userInput.replace(/\s+/g, '')
    if (clockText) normalized = normalized.replace(clockText, '')
    const raw = normalized
      .replace(/^(?:请|帮我|帮忙|查一下|查询|查找|查看|看看|当前|现在|一个)+/u, '')
      .replace(/(?:当前节目单|当前播单|节目单|播单|节目库|素材库|候选库|候选|可用|可播|有哪些|是什么|有什么|在哪里|在哪儿|在哪|什么时候播|几点播|播在几点|排在几点|播出时间|播出位置|里面|的节目|节目|栏目|内容|情况)+/gu, '')
      .replace(/[，。！？；：、,.!?;:]/gu, '')
      .trim()
    return raw || undefined
  }

  private resolveInsertCandidates(candidates: AgentProgramCandidate[], programHint: string): AgentProgramCandidate[] {
    const normalizedHint = this.normalizeSearchText(programHint)
    const facets = this.buildInsertSearchFacets(programHint)
    const matched = candidates.filter((candidate) => {
      const haystack = this.normalizeSearchText([
        candidate.programName,
        candidate.instanceName,
        candidate.programCode,
        candidate.columnName,
        candidate.columnId,
        ...(candidate.contentTags ?? []),
      ].filter(Boolean).join(' '))
      return haystack.includes(normalizedHint)
        || normalizedHint.includes(this.normalizeSearchText(candidate.programName))
        || (facets.length > 0 && facets.every((facet) => haystack.includes(facet)))
    })
    const titleMatches = matched.filter((candidate) => {
      const titleHaystack = this.normalizeSearchText([
        candidate.programName,
        candidate.instanceName,
      ].filter(Boolean).join(' '))
      return titleHaystack.includes(normalizedHint)
        || normalizedHint.includes(this.normalizeSearchText(candidate.programName))
        || (facets.length > 0 && facets.every((facet) => titleHaystack.includes(facet)))
    })
    return titleMatches.length > 0 ? titleMatches : matched
  }

  private resolveCandidatePool(
    candidates: AgentProgramCandidate[],
    primaryHint: string,
    input: AgentSubmitInput,
    runtime: AgentCapabilityRuntime,
  ): CandidatePoolResolution {
    const primaryCandidates = this.resolveInsertCandidates(candidates, primaryHint)
    const attempts: CandidateSearchAttempt[] = [
      this.buildCandidateSearchAttempt(primaryHint, 'primary', primaryCandidates),
    ]
    if (primaryCandidates.length > 0) {
      return {
        candidates: primaryCandidates,
        attempts,
        matchedBy: 'primary',
      }
    }

    const retryKeywords = this.buildCandidateRetryKeywords(primaryHint, input)
    const merged = new Map<string, AgentProgramCandidate>()
    retryKeywords.forEach(({ keyword, source }) => {
      const retryCandidates = this.resolveInsertCandidates(candidates, keyword)
      attempts.push(this.buildCandidateSearchAttempt(keyword, source, retryCandidates))
      retryCandidates.forEach((candidate) => {
        const key = candidate.id || candidate.programCode || candidate.programId || candidate.programName
        if (!merged.has(key)) merged.set(key, candidate)
      })
    })

    const resolved = Array.from(merged.values())
    runtime.trace.record('planning', 'Candidate search retried with rewritten keywords.', {
      originalKeyword: primaryHint,
      matchedBy: resolved.length > 0 ? 'rewritten_keywords' : 'none',
      attempts,
    })

    return {
      candidates: resolved,
      attempts,
      matchedBy: resolved.length > 0 ? 'rewritten_keywords' : 'none',
    }
  }

  private buildCandidateRetryKeywords(
    primaryHint: string,
    input: AgentSubmitInput,
  ): Array<{ keyword: string; source: 'llm_alternative' | 'fallback' }> {
    const normalizedPrimary = this.normalizeSearchText(primaryHint)
    const keywords = [
      ...(input.interpretation?.searchAlternatives ?? []).map((keyword) => ({ keyword, source: 'llm_alternative' as const })),
      ...this.buildFallbackSearchAlternatives(primaryHint).map((keyword) => ({ keyword, source: 'fallback' as const })),
    ]
    const seen = new Set<string>([normalizedPrimary])
    const result: Array<{ keyword: string; source: 'llm_alternative' | 'fallback' }> = []
    keywords.forEach((item) => {
      const keyword = item.keyword.trim()
      const normalized = this.normalizeSearchText(keyword)
      if (!keyword || normalized.length < 2 || seen.has(normalized)) return
      seen.add(normalized)
      result.push({ keyword, source: item.source })
    })
    return result.slice(0, 8)
  }

  private buildCandidateSearchAttempt(
    keyword: string,
    source: CandidateSearchAttempt['source'],
    candidates: AgentProgramCandidate[],
  ): CandidateSearchAttempt {
    return {
      keyword,
      source,
      candidateCount: candidates.length,
      candidateIds: candidates.slice(0, 8).map((candidate) => candidate.id),
    }
  }

  private buildInsertSearchFacets(programHint: string): string[] {
    const normalized = this.normalizeSearchText(programHint)
    const phraseFacets = [
      normalized.includes('城市形象') ? '城市形象' : '',
      normalized.includes('春日花路') ? '春日花路' : '',
      normalized.includes('上海') ? '上海' : '',
      normalized.includes('旅游景点') ? '旅游景点' : '',
      normalized.includes('景点') ? '景点' : '',
      normalized.includes('宣传片') ? '宣传片' : '',
      normalized.includes('短片') ? '短片' : '',
      normalized.includes('视频') ? '视频' : '',
      normalized.includes('无节目编号') ? '无节目编号' : '',
    ].map((facet) => this.normalizeSearchText(facet)).filter((facet) => facet.length > 1)
    const fallbackFacets = buildAgentSearchFacets(programHint)
      .map((facet) => this.normalizeSearchText(facet))
      .filter((facet) => facet.length > 1)
    return Array.from(new Set(phraseFacets.length > 0 ? phraseFacets : fallbackFacets))
  }

  private buildCandidateSearchRetryPlan(
    input: AgentSubmitInput,
    context: SchedulingContext,
    keyword: string,
    attempts: CandidateSearchAttempt[] = [],
  ): Record<string, unknown> {
    const query = context.bundle.sources.candidates.query
    const searchedFacets = query?.facets?.length
      ? query.facets
      : this.buildInsertSearchFacets(keyword)
    const llmAlternatives = input.interpretation?.searchAlternatives ?? []
    const suggestedKeywords = Array.from(new Set([
      ...llmAlternatives,
      ...this.buildFallbackSearchAlternatives(keyword),
      ...searchedFacets,
    ].map((item) => item.trim()).filter((item) => item.length >= 2))).slice(0, 5)

    return {
      searchedKeyword: query?.keyword ?? keyword,
      searchedFacets,
      candidateSourceStatus: context.bundle.sources.candidates.status,
      candidateRecordCount: context.bundle.sources.candidates.recordCount,
      searchAttempts: attempts,
      suggestedKeywords,
      nextAction: 'rewrite_keywords_and_retry',
    }
  }

  private buildFallbackSearchAlternatives(keyword: string): string[] {
    const normalized = keyword.replace(/\s+/g, '').trim()
    const suggestions: string[] = []
    if (!normalized) return suggestions
    if (normalized.includes('上海')) suggestions.push('上海 新闻', '上海 早间 新闻')
    if (normalized.includes('早新闻')) suggestions.push('早间新闻', '东方卫视 早新闻')
    if (normalized.includes('看东方')) suggestions.push('看东方', '东方卫视 看东方')
    if (normalized.includes('东方新闻')) suggestions.push('东方新闻', '东方卫视 新闻')
    if (normalized.includes('城市形象')) suggestions.push('城市形象 短片', '城市宣传片')
    if (normalized.includes('春日花路')) suggestions.push('春日花路', '春日 花路 短片')
    if (normalized.includes('景点')) suggestions.push('上海 景点 视频', '旅游景点 短片')
    suggestions.push(...buildAgentSearchFacets(keyword))
    return suggestions
  }

  private buildValidationSourceEvidenceIssues(context: SchedulingContext): AgentConstraintIssue[] {
    const issues: AgentConstraintIssue[] = []
    const todaySource = context.bundle.sources.today
    if (todaySource.source === 'none' || !todaySource.available) {
      issues.push({
        code: 'schedule_source_missing',
        severity: 'critical',
        message: 'Current playlist source is missing; validation cannot prove the active schedule state.',
        detail: {
          source: todaySource.source,
          recordCount: todaySource.recordCount,
          available: todaySource.available,
          status: todaySource.status,
          errorCode: todaySource.errorCode,
        },
      })
    }

    const constraintSource = context.bundle.sources.constraints
    if (constraintSource.source === 'none' || !constraintSource.available) {
      issues.push({
        code: 'constraint_source_missing',
        severity: 'warning',
        message: 'Constraint source is missing; validation cannot fully verify layout bounds, locked items, or blocked ranges.',
        detail: {
          source: constraintSource.source,
          recordCount: constraintSource.recordCount,
          available: constraintSource.available,
          status: constraintSource.status,
          errorCode: constraintSource.errorCode,
        },
      })
    }

    const historySource = context.bundle.sources.history
    if (context.playlistType === 'tv' && (historySource.source === 'none' || !historySource.available)) {
      issues.push({
        code: 'history_source_missing',
        severity: 'warning',
        message: '缺少历史播出记录，电视播单的顺播校验只能依据当前播单判断，结果可能不完整。',
        detail: {
          source: historySource.source,
          recordCount: historySource.recordCount,
          available: historySource.available,
          status: historySource.status,
          errorCode: historySource.errorCode,
        },
      })
    }

    return issues
  }

  private buildCandidateSourceMissingResultIfNeeded(
    input: AgentSubmitInput,
    runtime: AgentCapabilityRuntime,
    context: SchedulingContext,
    intent: 'insert' | 'replace',
    pendingTask?: AgentSubmitInput['pendingTask'],
    resolvedTargets?: ScheduleItemSnapshot[],
  ): AgentResult | null {
    const candidateSource = context.bundle.sources.candidates
    if (candidateSource.source !== 'none' && candidateSource.available) return null

    const message = '当前候选节目库不可用，我还不能安全选择要写入的节目或素材；请刷新或接入候选库后再继续。'
    return {
      status: 'blocked',
      input,
      decision: {
        intent,
        resolvedTargets,
        pendingTask: pendingTask ?? undefined,
        constraintReport: {
          ok: false,
          issues: [{
            code: 'candidate_source_missing',
            severity: 'critical',
            message,
            detail: {
              source: candidateSource.source,
              recordCount: candidateSource.recordCount,
              available: candidateSource.available,
            },
          }],
        },
      },
      explanation: message,
      trace: runtime.trace.getTrace(),
    }
  }

  private buildScheduleSourceMissingResultIfNeeded(
    input: AgentSubmitInput,
    runtime: AgentCapabilityRuntime,
    context: SchedulingContext,
    intent: AtomicCommandIntent,
    pendingTask?: AgentSubmitInput['pendingTask'],
  ): AgentResult | null {
    const scheduleSource = context.bundle.sources.today
    if (scheduleSource.source !== 'none' && scheduleSource.available) return null

    const message = '当前播单数据不可用，我不能在无法确认最新编排状态时写入；请刷新播单后再继续。'
    return {
      status: 'blocked',
      input,
      decision: {
        intent,
        pendingTask: pendingTask ?? undefined,
        constraintReport: {
          ok: false,
          issues: [{
            code: 'schedule_source_missing',
            severity: 'critical',
            message,
            detail: {
              source: scheduleSource.source,
              recordCount: scheduleSource.recordCount,
              available: scheduleSource.available,
            },
          }],
        },
      },
      explanation: message,
      trace: runtime.trace.getTrace(),
    }
  }

  private buildCommitConflictResultIfNeeded(
    input: AgentSubmitInput,
    runtime: AgentCapabilityRuntime,
    intent: AtomicCommandIntent,
    executionResult: AgentExecutionResult,
    command: NonNullable<AgentResult['decision']['command']>,
    resolvedTargets: ScheduleItemSnapshot[] | undefined,
    constraintReport: NonNullable<AgentResult['decision']['constraintReport']>,
    preview: AgentPreview,
    pendingTask?: AgentSubmitInput['pendingTask'],
  ): AgentResult | null {
    if (executionResult.committed) return null

    const message = '提交前播单已经发生变化，旧预演不再可靠；我不会继续写入，请基于最新播单重新发起这次操作。'
    runtime.trace.record('blocked', 'commit rejected because playlist context changed before write', {
      operationId: executionResult.operationId,
      affectedItemIds: executionResult.affectedItemIds,
    })
    return {
      status: 'blocked',
      input,
      decision: {
        intent,
        command,
        resolvedTargets,
        constraintReport: {
          ok: false,
          issues: [
            ...constraintReport.issues,
            {
              code: 'context_conflict',
              severity: 'critical',
              message,
              detail: {
                operationId: executionResult.operationId,
              },
            },
          ],
        },
        preview,
        pendingTask: pendingTask ?? undefined,
      },
      executionResult,
      explanation: message,
      trace: runtime.trace.getTrace(),
    }
  }

  private async selectCandidate(
    input: AgentSubmitInput,
    runtime: AgentCapabilityRuntime,
    context: SchedulingContext,
    commandIntent: 'insert' | 'replace',
    candidates: AgentProgramCandidate[],
    targetTime?: string,
    replacementTarget?: ScheduleItemSnapshot,
  ): Promise<CandidateSelectionResult> {
    const sequenceSelection = this.tvSequenceSelector.selectBestCandidate(context, candidates)
    if (sequenceSelection.candidateOptions?.length) {
      runtime.trace.record('needs_selection', '电视播单续集候选存在多个精确匹配，等待编排人员选择。', {
        commandIntent,
        candidateOptionIds: sequenceSelection.candidateOptions.map((candidate) => candidate.id),
        diagnostics: sequenceSelection.diagnostics,
      })
      return {
        candidate: null,
        candidateOptions: sequenceSelection.candidateOptions,
        diagnostics: {
          method: 'tv_sequence',
          source: sequenceSelection.diagnostics.source === 'none' ? 'none' : sequenceSelection.diagnostics.source,
          candidateCount: candidates.length,
          expectedSequence: sequenceSelection.diagnostics.expectedSequence,
          selectedSequence: sequenceSelection.diagnostics.selectedSequence,
          seriesKey: sequenceSelection.diagnostics.seriesKey,
          candidateOptionIds: sequenceSelection.diagnostics.candidateOptionIds,
          reason: sequenceSelection.diagnostics.reason,
        },
      }
    }

    if (sequenceSelection.candidate) {
      runtime.trace.record('planning', '电视播单续集候选命中，按今天/历史编排证据选择下一集。', {
        selectedCandidateId: sequenceSelection.candidate.id,
        selectedProgramCode: sequenceSelection.candidate.programCode,
        diagnostics: sequenceSelection.diagnostics,
      })
      return {
        candidate: sequenceSelection.candidate,
        diagnostics: {
          method: 'tv_sequence',
          source: sequenceSelection.diagnostics.source === 'none' ? 'none' : sequenceSelection.diagnostics.source,
          selectedCandidateId: sequenceSelection.candidate.id,
          selectedProgramCode: sequenceSelection.candidate.programCode,
          candidateCount: candidates.length,
          expectedSequence: sequenceSelection.diagnostics.expectedSequence,
          selectedSequence: sequenceSelection.diagnostics.selectedSequence,
          seriesKey: sequenceSelection.diagnostics.seriesKey,
          professionalAssessment: this.buildProfessionalAssessment(sequenceSelection.candidate, input, context, commandIntent, targetTime, replacementTarget),
          reason: sequenceSelection.diagnostics.reason,
        },
      }
    }

    runtime.trace.record('planning', '电视播单续集候选证据检查。', {
      commandIntent,
      candidateCount: candidates.length,
      diagnostics: sequenceSelection.diagnostics,
    })
    if (context.playlistType === 'tv' && sequenceSelection.diagnostics.source !== 'none') {
      runtime.trace.record('planning', '电视播单已有顺播证据，但候选库缺少期望下一集，因此不能跳集。', {
        commandIntent,
        candidateCount: candidates.length,
        diagnostics: sequenceSelection.diagnostics,
      })
      return {
        candidate: null,
        diagnostics: {
          method: 'tv_sequence',
          source: sequenceSelection.diagnostics.source,
          candidateCount: candidates.length,
          expectedSequence: sequenceSelection.diagnostics.expectedSequence,
          selectedSequence: sequenceSelection.diagnostics.selectedSequence,
          seriesKey: sequenceSelection.diagnostics.seriesKey,
          reason: sequenceSelection.diagnostics.reason,
        },
      }
    }
    const sequentialCandidateOptionCount = sequenceSelection.diagnostics.candidateOptionIds?.length ?? 0
    if (context.playlistType === 'tv' && sequentialCandidateOptionCount > 0 && sequentialCandidateOptionCount === candidates.length) {
      const professionalBlockedCandidate = this.findProfessionalHardBlockedCandidate(
        candidates,
        input,
        context,
        commandIntent,
        targetTime,
        replacementTarget,
      )
      if (professionalBlockedCandidate) {
        return professionalBlockedCandidate
      }
      runtime.trace.record('planning', 'TV sequential candidates require today or latest history baseline; do not fall back to candidate judge.', {
        commandIntent,
        candidateCount: candidates.length,
        diagnostics: sequenceSelection.diagnostics,
      })
      return {
        candidate: null,
        diagnostics: {
          method: 'tv_sequence',
          source: 'none',
          candidateCount: candidates.length,
          candidateOptionIds: sequenceSelection.diagnostics.candidateOptionIds,
          reason: sequenceSelection.diagnostics.reason,
        },
      }
    }

    const judgePool = this.prepareCandidateJudgePool(candidates, input, context, commandIntent, targetTime, replacementTarget)
    const candidate = await runtime.candidateJudge.selectBestCandidate({
      userInput: input.userInput,
      playlistType: context.playlistType,
      commandIntent,
      candidates: judgePool.candidates,
      context,
      professionalAssessments: judgePool.assessments,
    })
    return {
      candidate,
      diagnostics: {
        method: 'candidate_judge',
        source: candidate ? 'fallback' : 'none',
        selectedCandidateId: candidate?.id,
        selectedProgramCode: candidate?.programCode,
        candidateCount: candidates.length,
        professionalAssessment: candidate
          ? judgePool.assessments[candidate.id] ?? this.buildProfessionalAssessment(candidate, input, context, commandIntent, targetTime, replacementTarget)
          : undefined,
        reason: candidate
          ? '没有更强的顺播证据，因此由候选判断选择最贴合的内容。'
          : '顺播检查和候选判断后，仍没有匹配到可用候选。',
      },
    }
  }

  private findProfessionalHardBlockedCandidate(
    candidates: AgentProgramCandidate[],
    input: AgentSubmitInput,
    context: SchedulingContext,
    commandIntent: 'insert' | 'replace',
    targetTime?: string,
    replacementTarget?: ScheduleItemSnapshot,
  ): CandidateSelectionResult | null {
    for (const candidate of candidates) {
      const assessment = this.buildProfessionalAssessment(candidate, input, context, commandIntent, targetTime, replacementTarget)
      if (assessment.hardBlockCodes.length === 0) continue
      return {
        candidate,
        diagnostics: {
          method: 'candidate_judge',
          source: 'fallback',
          selectedCandidateId: candidate.id,
          selectedProgramCode: candidate.programCode,
          candidateCount: candidates.length,
          professionalAssessment: assessment,
          reason: 'Candidate is already blocked by professional scheduling constraints; surface that blocker before sequence-baseline diagnostics.',
        },
      }
    }
    return null
  }

  private buildCandidateSelectionPendingResultIfNeeded(
    input: AgentSubmitInput,
    runtime: AgentCapabilityRuntime,
    options: {
      intent: 'insert' | 'replace'
      context: SchedulingContext
      diagnostics: AgentCandidateSelectionDiagnostics
      candidates?: AgentProgramCandidate[]
      collectedSlots: AgentSlotBag
      resolvedTargets?: ScheduleItemSnapshot[]
    },
  ): AgentResult | null {
    if (!options.candidates?.length) return null
    const recommendations = this.buildRecommendations(options.candidates, input.userInput, options.context)
    const pendingTask = createPendingTask({
      intent: options.intent,
      phase: 'needs_selection',
      originalInput: input.userInput,
      collectedSlots: options.collectedSlots,
      missingSlots: ['candidateId'],
      recommendations,
      contextFingerprint: this.buildPendingContextFingerprint(options.context),
      contextSources: this.buildPendingContextSourceSnapshots(options.context),
    })
    const message = options.intent === 'insert'
      ? '我找到了多个都符合顺播规则的候选节目，还需要你确认要插入哪一个。'
      : '我找到了多个都符合顺播规则的候选节目，还需要你确认要替换成哪一个。'

    return {
      status: 'needs_selection',
      input,
      decision: {
        intent: options.intent,
        resolvedTargets: options.resolvedTargets,
        recommendations,
        candidateSelection: options.diagnostics,
        pendingTask,
        constraintReport: {
          ok: false,
          issues: [{
            code: 'program_ambiguous',
            severity: 'warning',
            message,
            detail: {
              method: options.diagnostics.method,
              source: options.diagnostics.source,
              expectedSequence: options.diagnostics.expectedSequence,
              seriesKey: options.diagnostics.seriesKey,
              candidateOptionIds: options.diagnostics.candidateOptionIds,
            },
          }],
        },
      },
      explanation: message,
      trace: runtime.trace.getTrace(),
    }
  }

  private buildCandidateSelectionBlockedIssue(
    diagnostics: AgentCandidateSelectionDiagnostics,
    programHint?: string,
  ): AgentConstraintIssue {
    if (diagnostics.method === 'tv_sequence' && diagnostics.source !== 'none') {
      return {
        code: 'sequence_violation',
        severity: 'critical',
        message: diagnostics.expectedSequence
          ? `这条电视播单会破坏顺播规则：当前需要顺播到第 ${diagnostics.expectedSequence} 集，不能直接跳到第 ${diagnostics.selectedSequence ?? '未知'} 集。我已阻断本次写入。`
          : '当前已有顺播线索，但候选库里没有可安全承接的下一集；为避免跳集编排，我已阻断本次写入。',
        detail: {
          source: diagnostics.source,
          expectedSequence: diagnostics.expectedSequence,
          selectedSequence: diagnostics.selectedSequence,
          seriesKey: diagnostics.seriesKey,
          reason: diagnostics.reason,
        },
      }
    }
    if (diagnostics.method === 'tv_sequence' && (diagnostics.candidateOptionIds?.length ?? 0) > 0) {
      return {
        code: 'history_source_missing',
        severity: 'critical',
        message: '候选库里有顺播节目，但缺少今天或最近一次播出的同系列依据，我还不能自行判断下一集。',
        detail: {
          source: diagnostics.source,
          candidateOptionIds: diagnostics.candidateOptionIds,
          reason: diagnostics.reason,
        },
      }
    }

    return {
      code: 'program_not_found',
      severity: 'critical',
      message: `候选库里暂时没有找到符合${programHint ? `“${programHint}”` : '这条需求'}的可播节目或素材。`,
    }
  }

  private buildCandidateProfessionalBlockIssueIfNeeded(
    diagnostics: AgentCandidateSelectionDiagnostics,
    options?: { allowedSignalCodes?: string[] },
  ): AgentConstraintIssue | null {
    const assessment = diagnostics.professionalAssessment
    if (!assessment?.hardBlockCodes.length) return null

    const blockingPriority = [
      'material_readiness',
      'rights_readiness',
      'same_day_duplicate',
      'recent_replay_interval',
    ]
    const blockingSignal = blockingPriority
      .map((code) => assessment.signals.find((signal) => signal.verdict === 'block' && signal.code === code))
      .filter((signal) => !options?.allowedSignalCodes || (signal && options.allowedSignalCodes.includes(signal.code)))
      .find((signal): signal is AgentCandidateAssessmentSignal => Boolean(signal))
    if (!blockingSignal) return null

    const issueCode = (() => {
      if (blockingSignal.code === 'material_readiness') return 'material_not_ready'
      if (blockingSignal.code === 'rights_readiness') return 'rights_not_ready'
      if (blockingSignal.code === 'same_day_duplicate') return 'same_day_duplicate_violation'
      if (blockingSignal.code === 'recent_replay_interval') return 'recent_replay_violation'
      return 'replacement_duty_mismatch'
    })()

    return {
      code: issueCode,
      severity: 'critical',
      message: blockingSignal?.reason ?? '候选节目未通过专业编排约束，不能写入播单。',
      detail: {
        ...(blockingSignal.detail ?? {}),
        selectedCandidateId: diagnostics.selectedCandidateId,
        selectedProgramCode: diagnostics.selectedProgramCode,
        hardBlockCodes: assessment.hardBlockCodes,
        signalCode: blockingSignal?.code,
        sourceKeys: blockingSignal?.sourceKeys,
      },
    }
  }

  private buildExplicitCandidateSelection(
    candidate: AgentProgramCandidate,
    candidateCount: number,
    input: AgentSubmitInput,
    context: SchedulingContext,
    commandIntent: 'insert' | 'replace',
    targetTime?: string,
    replacementTarget?: ScheduleItemSnapshot,
  ): CandidateSelectionResult {
    const sequenceSelection = this.tvSequenceSelector.selectBestCandidate(context, [candidate])
    if (
      context.playlistType === 'tv'
      && (
        (sequenceSelection.diagnostics.candidateOptionIds?.length ?? 0) > 0
        || sequenceSelection.diagnostics.source !== 'none'
      )
      && !sequenceSelection.candidate
    ) {
      const professionalAssessment = this.buildProfessionalAssessment(candidate, input, context, commandIntent, targetTime, replacementTarget)
      if (professionalAssessment.hardBlockCodes.length > 0) {
        return {
          candidate,
          diagnostics: {
            method: 'explicit',
            source: 'explicit',
            selectedCandidateId: candidate.id,
            selectedProgramCode: candidate.programCode,
            candidateCount,
            professionalAssessment,
            reason: 'Explicit candidate is already blocked by professional scheduling constraints; surface that blocker before sequence-baseline diagnostics.',
          },
        }
      }
      return {
        candidate: null,
        diagnostics: {
          method: 'tv_sequence',
          source: sequenceSelection.diagnostics.source === 'none' ? 'none' : sequenceSelection.diagnostics.source,
          selectedCandidateId: candidate.id,
          selectedProgramCode: candidate.programCode,
          candidateCount,
          expectedSequence: sequenceSelection.diagnostics.expectedSequence,
          selectedSequence: sequenceSelection.diagnostics.selectedSequence,
          seriesKey: sequenceSelection.diagnostics.seriesKey,
          candidateOptionIds: sequenceSelection.diagnostics.candidateOptionIds,
          reason: sequenceSelection.diagnostics.reason,
        },
      }
    }

    return {
      candidate,
      diagnostics: {
        method: 'explicit',
        source: 'explicit',
        selectedCandidateId: candidate.id,
        selectedProgramCode: candidate.programCode,
        candidateCount,
        professionalAssessment: this.buildProfessionalAssessment(candidate, input, context, commandIntent, targetTime, replacementTarget),
        reason: 'User or pending task explicitly selected this candidate.',
      },
    }
  }

  private buildProfessionalAssessment(
    candidate: AgentProgramCandidate,
    input: AgentSubmitInput,
    context: SchedulingContext,
    commandIntent: 'insert' | 'replace',
    targetTime?: string,
    replacementTarget?: ScheduleItemSnapshot,
  ): AgentCandidateProfessionalAssessment {
    const signals: AgentCandidateAssessmentSignal[] = [
      this.assessMaterialReadiness(candidate, context),
      this.assessRightsReadiness(candidate, context),
      this.assessPlaylistPolicy(candidate, context, commandIntent),
      this.assessContentAlignment(candidate, input.userInput),
      this.assessTimeSlotFit(candidate, context, targetTime),
      this.assessNeighborColumnFit(candidate, context, targetTime),
      this.assessReplacementDutyFit(candidate, context, commandIntent, replacementTarget),
      this.assessDurationFit(candidate, context),
      this.assessSameDayDuplicate(candidate, context, replacementTarget),
      this.assessRecentReplayInterval(candidate, context),
    ]

    if (context.playlistType === 'rotation') {
      signals.push(this.assessRotationPriority(candidate, context))
    }

    const hardBlockCodes = signals
      .filter((signal) => signal.verdict === 'block')
      .map((signal) => signal.code)

    return {
      totalScore: signals.reduce((sum, signal) => sum + signal.score, 0),
      hardBlockCodes,
      signals,
    }
  }

  private resolveCandidateReadiness(
    candidate: AgentProgramCandidate,
    context: SchedulingContext,
  ): AgentBroadcastReadinessEvidence {
    const explicit = context.broadcastReadiness.find((record) =>
      (record.candidateId && record.candidateId === candidate.id)
      || (record.programId && record.programId === candidate.programId)
      || (record.programCode && record.programCode === candidate.programCode),
    )
    return {
      candidateId: candidate.id,
      programId: candidate.programId,
      programCode: candidate.programCode,
      materialStatus: explicit?.materialStatus ?? candidate.materialStatus,
      rightsStatus: explicit?.rightsStatus ?? candidate.rightsStatus,
      updatedAt: explicit?.updatedAt,
      source: explicit?.source,
    }
  }

  private prepareCandidateJudgePool(
    candidates: AgentProgramCandidate[],
    input: AgentSubmitInput,
    context: SchedulingContext,
    commandIntent: 'insert' | 'replace',
    targetTime?: string,
    replacementTarget?: ScheduleItemSnapshot,
  ): CandidateJudgePool {
    const assessed = candidates
      .map((candidate, index) => ({
        candidate,
        index,
        assessment: this.buildProfessionalAssessment(candidate, input, context, commandIntent, targetTime, replacementTarget),
      }))
      .sort((left, right) =>
        right.assessment.totalScore - left.assessment.totalScore
        || left.index - right.index,
      )

    const playable = assessed.filter((item) => item.assessment.hardBlockCodes.length === 0)
    const pool = playable.length > 0 ? playable : assessed
    return {
      candidates: pool.map((item) => item.candidate),
      assessments: Object.fromEntries(pool.map((item) => [item.candidate.id, item.assessment])),
    }
  }

  private assessMaterialReadiness(candidate: AgentProgramCandidate, context: SchedulingContext): AgentCandidateAssessmentSignal {
    const readiness = this.resolveCandidateReadiness(candidate, context)
    if (readiness.materialStatus && readiness.materialStatus !== 'ready') {
      return {
        code: 'material_readiness',
        verdict: 'block',
        score: -100,
        reason: `Material status is ${readiness.materialStatus}; constraints must block the write.`,
        sourceKeys: ['readiness'],
        detail: {
          materialStatus: readiness.materialStatus,
        },
      }
    }

    return {
      code: 'material_readiness',
      verdict: 'pass',
      score: 20,
      reason: '素材状态可播，或当前没有素材阻断信息。',
      sourceKeys: ['readiness'],
    }
  }

  private assessRightsReadiness(candidate: AgentProgramCandidate, context: SchedulingContext): AgentCandidateAssessmentSignal {
    const readiness = this.resolveCandidateReadiness(candidate, context)
    if (readiness.rightsStatus && readiness.rightsStatus !== 'ready') {
      return {
        code: 'rights_readiness',
        verdict: 'block',
        score: -100,
        reason: `Rights status is ${readiness.rightsStatus}; constraints must block the write.`,
        sourceKeys: ['readiness'],
        detail: {
          rightsStatus: readiness.rightsStatus,
        },
      }
    }

    return {
      code: 'rights_readiness',
      verdict: 'pass',
      score: 20,
      reason: '权利状态可播，或当前没有权利阻断信息。',
      sourceKeys: ['readiness'],
    }
  }

  private assessPlaylistPolicy(
    candidate: AgentProgramCandidate,
    context: SchedulingContext,
    commandIntent: 'insert' | 'replace',
  ): AgentCandidateAssessmentSignal {
    if (context.playlistType === 'tv') {
      return {
        code: 'playlist_policy',
        verdict: 'pass',
        score: 25,
        reason: `TV ${commandIntent} can commit after deterministic channel constraints pass.`,
        sourceKeys: ['policy', 'constraints'],
      }
    }

    return {
      code: 'playlist_policy',
      verdict: 'warn',
      score: 5,
      reason: `Rotation ${commandIntent} should recommend and request confirmation before writing ${candidate.programName}.`,
      sourceKeys: ['policy', 'candidates'],
    }
  }

  private assessContentAlignment(candidate: AgentProgramCandidate, userInput: string): AgentCandidateAssessmentSignal {
    const normalizedInput = this.normalizeSearchText(userInput)
    const searchable = this.normalizeSearchText([
      candidate.programName,
      candidate.instanceName,
      candidate.programCode,
      candidate.columnName,
      candidate.columnId,
      ...(candidate.contentTags ?? []),
    ].filter(Boolean).join(' '))

    if (searchable && normalizedInput && (
      searchable.includes(normalizedInput)
      || normalizedInput.includes(this.normalizeSearchText(candidate.programName))
      || (candidate.contentTags ?? []).some((tag) => normalizedInput.includes(this.normalizeSearchText(tag)))
    )) {
      return {
        code: 'content_alignment',
        verdict: 'prefer',
        score: 30,
        reason: '候选元数据与用户需求、栏目或内容标签匹配。',
        sourceKeys: ['candidates'],
      }
    }

    return {
      code: 'content_alignment',
      verdict: 'neutral',
      score: 0,
      reason: 'No direct metadata match was found beyond the candidate filter.',
      sourceKeys: ['candidates'],
    }
  }

  private assessTimeSlotFit(
    candidate: AgentProgramCandidate,
    context: SchedulingContext,
    targetTime?: string,
  ): AgentCandidateAssessmentSignal {
    if (!targetTime) {
      return {
        code: 'time_slot_fit',
        verdict: 'neutral',
        score: 0,
        reason: 'No target time is available for slot suitability assessment.',
        sourceKeys: ['candidates'],
      }
    }

    const hour = this.resolveClockHour(targetTime)
    const profile = this.buildCandidateProfile(candidate)
    const morningNews = hour >= 6 && hour < 10
    const earlyEveningNews = hour >= 17 && hour < 19
    const primeTime = hour >= 19 && hour < 22
    const lateNight = hour >= 22 || hour < 6

    if ((morningNews || earlyEveningNews) && this.profileMatches(profile, ['news', 'weather', 'finance', 'traffic'])) {
      return {
        code: 'time_slot_fit',
        verdict: 'prefer',
        score: 80,
        reason: 'News-oriented candidate fits the morning or early-evening information slot.',
        sourceKeys: ['candidates'],
      }
    }

    if ((morningNews || earlyEveningNews) && this.profileMatches(profile, ['drama', 'movie', 'series'])) {
      if (context.playlistType === 'tv') {
        return {
          code: 'time_slot_fit',
          verdict: 'warn',
          score: -60,
          reason: 'Long-form fiction is usually weak for TV information slots; for an explicit atomic command this remains a weighting warning, not a hard blocker.',
          sourceKeys: ['candidates', 'policy'],
        }
      }
      return {
        code: 'time_slot_fit',
        verdict: 'warn',
        score: -60,
        reason: 'Long-form fiction is usually weaker for morning or early-evening information slots.',
        sourceKeys: ['candidates'],
      }
    }

    if (primeTime && this.profileMatches(profile, ['drama', 'documentary', 'entertainment', 'variety', 'movie'])) {
      return {
        code: 'time_slot_fit',
        verdict: 'prefer',
        score: 45,
        reason: 'Candidate type fits the evening prime-time viewing pattern.',
        sourceKeys: ['candidates'],
      }
    }

    if (primeTime && this.profileMatches(profile, ['news', 'weather', 'finance', 'traffic', 'service'])) {
      if (context.playlistType === 'tv') {
        return {
          code: 'time_slot_fit',
          verdict: 'warn',
          score: -45,
          reason: 'Information-service content is usually weak for TV prime-time placement; for an explicit atomic command this remains a weighting warning, not a hard blocker.',
          sourceKeys: ['candidates', 'policy'],
        }
      }
      return {
        code: 'time_slot_fit',
        verdict: 'warn',
        score: -45,
        reason: 'Information-service content is usually weak for prime-time placement and should be reviewed before rotation confirmation.',
        sourceKeys: ['candidates'],
      }
    }

    if (lateNight && this.profileMatches(profile, ['children', 'kids'])) {
      if (context.playlistType === 'tv') {
        return {
          code: 'time_slot_fit',
          verdict: 'warn',
          score: -35,
          reason: 'Children-oriented content is usually weak for TV late-night placement; for an explicit atomic command this remains a weighting warning, not a hard blocker.',
          sourceKeys: ['candidates', 'policy'],
        }
      }
      return {
        code: 'time_slot_fit',
        verdict: 'warn',
        score: -35,
        reason: 'Children-oriented content is usually weak for late-night placement.',
        sourceKeys: ['candidates'],
      }
    }

    return {
      code: 'time_slot_fit',
      verdict: 'neutral',
      score: 0,
      reason: 'No strong time-slot preference was detected for this candidate.',
      sourceKeys: ['candidates'],
    }
  }

  private assessNeighborColumnFit(
    candidate: AgentProgramCandidate,
    context: SchedulingContext,
    targetTime?: string,
  ): AgentCandidateAssessmentSignal {
    if (!targetTime || context.scheduleItems.length === 0) {
      return {
        code: 'neighbor_column_fit',
        verdict: 'neutral',
        score: 0,
        reason: 'No nearby schedule context is available for column continuity assessment.',
        sourceKeys: ['today', 'candidates'],
      }
    }

    const targetMs = new Date(normalizeDateTime(context.date, targetTime)).getTime()
    const nearby = context.scheduleItems.filter((item) => {
      const startMs = new Date(item.startTime).getTime()
      const endMs = new Date(item.endTime).getTime()
      const nearestDistance = Math.min(Math.abs(startMs - targetMs), Math.abs(endMs - targetMs))
      return nearestDistance <= 90 * 60 * 1000
    })

    if (nearby.length === 0) {
      return {
        code: 'neighbor_column_fit',
        verdict: 'neutral',
        score: 0,
        reason: 'No neighboring item is close enough to indicate a column pattern.',
        sourceKeys: ['today', 'candidates'],
      }
    }

    const candidateKeys = this.buildColumnContinuityKeys(candidate)
    const nearbyKeys = nearby.flatMap((item) => this.buildColumnContinuityKeys(item))
    const dominantKey = this.resolveDominantKey(nearbyKeys)

    if (!dominantKey) {
      return {
        code: 'neighbor_column_fit',
        verdict: 'neutral',
        score: 0,
        reason: 'Nearby items do not expose a stable column or type pattern.',
        sourceKeys: ['today', 'candidates'],
      }
    }

    if (candidateKeys.includes(dominantKey)) {
      return {
        code: 'neighbor_column_fit',
        verdict: 'prefer',
        score: 60,
        reason: 'Candidate matches the dominant nearby column or programme type.',
        sourceKeys: ['today', 'candidates'],
      }
    }

    return {
      code: 'neighbor_column_fit',
      verdict: 'warn',
      score: -20,
      reason: 'Candidate differs from the dominant nearby column or programme type.',
      sourceKeys: ['today', 'candidates'],
    }
  }

  private assessReplacementDutyFit(
    candidate: AgentProgramCandidate,
    context: SchedulingContext,
    commandIntent: 'insert' | 'replace',
    replacementTarget?: ScheduleItemSnapshot,
  ): AgentCandidateAssessmentSignal {
    if (commandIntent !== 'replace' || !replacementTarget) {
      return {
        code: 'replacement_duty_fit',
        verdict: 'neutral',
        score: 0,
        reason: 'No replacement target is present, so slot-duty continuity is not assessed.',
        sourceKeys: ['today', 'candidates'],
      }
    }

    const candidateKeys = this.buildColumnContinuityKeys(candidate)
    const targetKeys = this.buildColumnContinuityKeys(replacementTarget)
    if (targetKeys.length === 0) {
      return {
        code: 'replacement_duty_fit',
        verdict: 'neutral',
        score: 0,
        reason: 'The replaced item has no stable column or type metadata to preserve.',
        sourceKeys: ['today', 'candidates'],
      }
    }

    const columnKeys = targetKeys.filter((key) => key.startsWith('column:'))
    const typeKeys = targetKeys.filter((key) => key.startsWith('type:'))
    const columnMatch = columnKeys.some((key) => candidateKeys.includes(key))
    const typeMatch = typeKeys.some((key) => candidateKeys.includes(key))

    if (columnMatch) {
      return {
        code: 'replacement_duty_fit',
        verdict: 'prefer',
        score: 90,
        reason: 'Replacement candidate preserves the target slot column responsibility.',
        sourceKeys: ['today', 'candidates'],
      }
    }

    if (typeMatch) {
      return {
        code: 'replacement_duty_fit',
        verdict: 'pass',
        score: 45,
        reason: 'Replacement candidate preserves the target slot programme type.',
        sourceKeys: ['today', 'candidates'],
      }
    }

    if (context.playlistType === 'tv') {
      return {
        code: 'replacement_duty_fit',
        verdict: 'warn',
        score: -45,
        reason: 'Replacement candidate changes the target slot column and programme type; use this as candidate ranking evidence, not a hard blocker for an explicit replacement command.',
        sourceKeys: ['today', 'candidates', 'policy'],
      }
    }

    return {
      code: 'replacement_duty_fit',
      verdict: 'warn',
      score: -45,
      reason: 'Replacement candidate changes the target slot column and programme type.',
      sourceKeys: ['today', 'candidates'],
    }
  }

  private assessDurationFit(candidate: AgentProgramCandidate, context: SchedulingContext): AgentCandidateAssessmentSignal {
    const comparableDurations = context.scheduleItems
      .filter((item) => item.programType === candidate.programType && typeof item.duration === 'number')
      .map((item) => item.duration)

    if (comparableDurations.length === 0) {
      return {
        code: 'duration_fit',
        verdict: 'neutral',
        score: 0,
        reason: 'No same-type item exists today to compare duration fit.',
        sourceKeys: ['today', 'candidates'],
      }
    }

    const average = comparableDurations.reduce((sum, duration) => sum + duration, 0) / comparableDurations.length
    const tolerance = Math.max(300, average * 0.25)
    const diff = Math.abs(candidate.duration - average)

    if (diff <= tolerance) {
      return {
        code: 'duration_fit',
      verdict: 'pass',
      score: 10,
      reason: 'Candidate duration is close to same-type items already scheduled today.',
      sourceKeys: ['today', 'candidates'],
    }
  }

    return {
      code: 'duration_fit',
      verdict: 'warn',
      score: -5,
      reason: 'Candidate duration differs from same-type items today and may need slot review.',
      sourceKeys: ['today', 'candidates'],
    }
  }

  private assessSameDayDuplicate(
    candidate: AgentProgramCandidate,
    context: SchedulingContext,
    replacementTarget?: ScheduleItemSnapshot,
  ): AgentCandidateAssessmentSignal {
    const duplicate = context.scheduleItems.find((item) =>
      item.id !== replacementTarget?.id && this.isExactCandidateScheduleMatch(candidate, item)
    )

    if (!duplicate) {
      return {
        code: 'same_day_duplicate',
        verdict: 'pass',
        score: 12,
        reason: '当前播单中没有同一成片的同日重复编排。',
        sourceKeys: ['today', 'candidates'],
      }
    }

    return {
      code: 'same_day_duplicate',
      verdict: context.playlistType === 'tv' ? 'block' : 'warn',
      score: context.playlistType === 'tv' ? -100 : -30,
      reason: `Candidate is already scheduled today at ${toClockText(duplicate.startTime)}; avoid same-day duplicate placement unless explicitly approved.`,
      sourceKeys: context.playlistType === 'tv' ? ['today', 'candidates', 'policy'] : ['today', 'candidates'],
    }
  }

  private assessRecentReplayInterval(candidate: AgentProgramCandidate, context: SchedulingContext): AgentCandidateAssessmentSignal {
    const latestMatch = this.findLatestHistoricalCandidateMatch(candidate, context)
    if (!latestMatch) {
      return {
        code: 'recent_replay_interval',
        verdict: 'pass',
        score: 10,
        reason: 'No recent exact replay evidence was found in history schedules.',
        sourceKeys: ['history', 'candidates'],
      }
    }

    const daysSince = Math.floor((this.resolveDateStartMs(context.date) - this.resolveDateStartMs(latestMatch.date)) / (24 * 60 * 60 * 1000))
    const minimumGapDays = context.playlistType === 'tv' ? 7 : 3
    if (daysSince >= 0 && daysSince < minimumGapDays) {
      return {
        code: 'recent_replay_interval',
        verdict: context.playlistType === 'tv' ? 'block' : 'warn',
        score: context.playlistType === 'tv' ? -100 : -35,
        reason: `Candidate was already scheduled ${daysSince} day(s) ago in history; minimum replay gap is ${minimumGapDays} day(s).`,
        sourceKeys: ['history', 'candidates', 'policy'],
      }
    }

    return {
      code: 'recent_replay_interval',
      verdict: 'pass',
      score: 10,
      reason: `Latest exact historical replay is ${daysSince} day(s) before the target date, outside the minimum replay gap.`,
      sourceKeys: ['history', 'candidates'],
    }
  }

  private assessRotationPriority(
    candidate: AgentProgramCandidate,
    context: SchedulingContext,
  ): AgentCandidateAssessmentSignal {
    if (context.rotationStrategy === 'rating') {
      return {
        code: 'rotation_priority',
        verdict: candidate.estimatedRating ? 'prefer' : 'neutral',
        score: candidate.estimatedRating ?? 0,
        reason: candidate.estimatedRating
          ? 'Rotation strategy prioritizes rating, and candidate has estimated rating signal.'
          : 'Rotation strategy prioritizes rating, but candidate has no rating signal.',
        sourceKeys: ['policy', 'candidates'],
      }
    }

    if (context.rotationStrategy === 'trending') {
      const popularity = candidate.popularityScore ?? candidate.playCount ?? 0
      return {
        code: 'rotation_priority',
        verdict: popularity > 0 ? 'prefer' : 'neutral',
        score: popularity,
        reason: popularity > 0
          ? 'Rotation strategy prioritizes trending content, and candidate has popularity signal.'
          : 'Rotation strategy prioritizes trending content, but candidate has no popularity signal.',
        sourceKeys: ['policy', 'candidates'],
      }
    }

    return {
      code: 'rotation_priority',
      verdict: 'neutral',
      score: 0,
      reason: 'Rotation strategy uses content match, so no extra rating or trending boost was applied.',
      sourceKeys: ['policy', 'candidates'],
    }
  }

  private buildCandidateProfile(candidate: AgentProgramCandidate): string {
    return this.normalizeSignalText([
      candidate.programType,
      candidate.columnName,
      candidate.columnId,
      candidate.programName,
      candidate.instanceName,
      ...(candidate.contentTags ?? []),
    ].filter(Boolean).join(' '))
  }

  private findLatestHistoricalCandidateMatch(
    candidate: AgentProgramCandidate,
    context: SchedulingContext,
  ): { date: string, item: ScheduleItemSnapshot } | null {
    const matches = (context.historySchedules ?? [])
      .flatMap((schedule) => (schedule.items ?? []).map((item) => ({
        date: schedule.date,
        item,
      })))
      .filter((record) => this.isExactHistoricalReplay(candidate, record.item))
      .sort((left, right) => this.resolveDateStartMs(right.date) - this.resolveDateStartMs(left.date))

    return matches[0] ?? null
  }

  private isExactHistoricalReplay(candidate: AgentProgramCandidate, item: ScheduleItemSnapshot): boolean {
    return this.isExactCandidateScheduleMatch(candidate, item)
  }

  private isExactCandidateScheduleMatch(candidate: AgentProgramCandidate, item: ScheduleItemSnapshot): boolean {
    if (candidate.programCode && item.programCode && candidate.programCode === item.programCode) return true
    const candidateIssueNo = Number(candidate.issueNo)
    const itemIssueNo = Number(item.issueNo)
    if (
      Number.isFinite(candidateIssueNo)
      && candidateIssueNo > 0
      && Number.isFinite(itemIssueNo)
      && itemIssueNo > 0
      && candidateIssueNo !== itemIssueNo
    ) {
      return false
    }
    if (candidate.programName && item.programName) {
      const candidateHasExplicitIssue = this.hasComparableAssetIssueMarker(candidate)
      const itemHasExplicitIssue = this.hasComparableAssetIssueMarker(item)
      if (candidateHasExplicitIssue || itemHasExplicitIssue) {
        const candidateIssue = this.extractComparableIssueNumber(candidate)
        const itemIssue = this.extractComparableIssueNumber(item)
        if (typeof candidateIssue === 'number' && typeof itemIssue === 'number' && candidateIssue !== itemIssue) {
          return false
        }
        return this.normalizeSearchText(candidate.programName) === this.normalizeSearchText(item.programName)
      }
      if (candidate.programCode && item.programCode && candidate.programCode !== item.programCode) {
        const candidateName = this.normalizeSearchText(candidate.programName)
        const itemName = this.normalizeSearchText(item.programName)
        if (candidateName && itemName && candidateName === itemName) return true
        if (!candidateHasExplicitIssue && !itemHasExplicitIssue) {
          const candidateBaseName = this.normalizeComparableProgramTitle(candidate.programName)
          const itemBaseName = this.normalizeComparableProgramTitle(item.programName)
          return Boolean(candidateBaseName && itemBaseName && candidateBaseName === itemBaseName)
        }
        return false
      }
      const candidateName = this.normalizeComparableProgramTitle(candidate.programName)
      const itemName = this.normalizeComparableProgramTitle(item.programName)
      if (candidateName && itemName && candidateName === itemName) return true
      if (!candidate.programCode && this.normalizeSearchText(candidate.programName) === this.normalizeSearchText(item.programName)) return true
    }
    return false
  }

  private hasComparableTitleIssueMarker(value: string): boolean {
    return /第\s*(?:\d+|[一二三四五六七八九十百千万]+)\s*[集期]/u.test(value)
      || /\b(?:ep|episode)\.?\s*\d{1,4}\b/iu.test(value)
  }

  private hasComparableAssetIssueMarker(
    item: Pick<AgentProgramCandidate | ScheduleItemSnapshot, 'programName' | 'instanceName' | 'programType' | 'programCode'> & { issueNo?: string },
  ): boolean {
    if (!this.isComparableSequentialType(item.programType)) return false
    if (this.hasComparableTitleIssueMarker(`${item.programName ?? ''} ${item.instanceName ?? ''}`)) return true
    if (item.issueNo && Number(item.issueNo) > 0) return true
    return Boolean(item.programCode?.match(/(\d{1,4})$/))
  }

  private extractComparableIssueNumber(
    item: Pick<AgentProgramCandidate | ScheduleItemSnapshot, 'programName' | 'instanceName' | 'programType' | 'programCode'> & { issueNo?: string },
  ): number | undefined {
    if (!this.isComparableSequentialType(item.programType)) return undefined
    const explicitIssue = Number(item.issueNo)
    if (Number.isFinite(explicitIssue) && explicitIssue > 0) return explicitIssue

    const title = `${item.programName ?? ''} ${item.instanceName ?? ''}`
    const titleMatch = title.match(/第\s*(\d+)\s*[集期]/u)
    if (titleMatch) {
      const parsed = Number(titleMatch[1])
      if (Number.isFinite(parsed) && parsed > 0) return parsed
    }

    const codeMatch = item.programCode?.match(/(\d{1,4})$/)
    if (!codeMatch) return undefined
    const parsed = Number(codeMatch[1])
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
  }

  private isComparableSequentialType(programType?: string): boolean {
    if (!programType) return false
    return [
      'drama',
      'series',
      'tv_series',
      'cartoon',
      'animation',
      'documentary',
      'documentary_series',
      'kids_series',
    ].includes(programType.trim().toLowerCase())
  }

  private normalizeComparableProgramTitle(value: string): string {
    return this.normalizeSearchText(value
      .replace(/第\s*\d+\s*[集期]/gu, '')
      .replace(/第\s*[一二三四五六七八九十百千万]+\s*[集期]/gu, '')
      .replace(/\d+\s*(秒|分钟|分)/gu, '')
      .replace(/[：:·\-—_].*$/u, (suffix) => suffix.includes('第') ? '' : suffix))
  }

  private resolveDateStartMs(date: string): number {
    const rawDate = date.includes('T') ? date.split('T')[0] : date
    const time = new Date(`${rawDate}T00:00:00`).getTime()
    return Number.isFinite(time) ? time : 0
  }

  private profileMatches(profile: string, tokens: string[]): boolean {
    return tokens.some((token) => {
      const normalizedToken = this.normalizeSignalText(token)
      return Boolean(normalizedToken) && profile.includes(normalizedToken)
    })
  }

  private resolveClockHour(targetTime: string): number {
    const clock = toClockText(targetTime)
    const match = /^(\d{1,2}):/.exec(clock)
    const hour = match ? Number(match[1]) : Number.NaN
    return Number.isFinite(hour) ? hour : new Date(targetTime).getHours()
  }

  private buildColumnContinuityKeys(
    item: Pick<ScheduleItemSnapshot, 'columnId' | 'columnName' | 'programType'>,
  ): string[] {
    const keys: string[] = []
    const columnId = item.columnId ? this.normalizeSignalText(item.columnId) : ''
    const columnName = item.columnName ? this.normalizeSignalText(item.columnName) : ''
    const programType = item.programType ? this.normalizeSignalText(item.programType) : ''

    if (columnId) keys.push(`column:${columnId}`)
    if (columnName) keys.push(`column:${columnName}`)
    if (programType) keys.push(`type:${programType}`)
    return keys
  }

  private resolveDominantKey(keys: string[]): string | undefined {
    const counts = new Map<string, number>()
    keys.forEach((key) => counts.set(key, (counts.get(key) ?? 0) + 1))
    return [...counts.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0]
  }

  private normalizeSignalText(value: string): string {
    return Array.from(value.trim().toLowerCase())
      .filter((char) => /[a-z0-9]/.test(char) || (char >= '\u4e00' && char <= '\u9fff'))
      .join('')
  }

  private buildInsertCommand(date: string, targetTime: string, candidate: AgentProgramCandidate): InsertCommandPlan {
    const insertTime = normalizeDateTime(date, targetTime)
    return {
      intent: 'insert',
      candidateId: candidate.id,
      candidateName: candidate.programName,
      insertTime,
      endTime: offsetDateTime(insertTime, candidate.duration),
    }
  }

  private previewInsert(command: InsertCommandPlan, context: SchedulingContext): AgentPreview {
    const candidate = context.programCandidates.find((item) => item.id === command.candidateId)
    const insertedItem: ScheduleItemSnapshot = {
      id: this.buildInsertedItemId(command),
      programId: candidate?.programId,
      programCode: candidate?.programCode ?? command.candidateId,
      programName: candidate?.programName ?? command.candidateName,
      instanceName: candidate?.instanceName,
      columnId: candidate?.columnId,
      columnName: candidate?.columnName,
      contentTags: candidate?.contentTags,
      startTime: command.insertTime,
      endTime: command.endTime,
      duration: candidate?.duration ?? Math.max(0, (new Date(command.endTime).getTime() - new Date(command.insertTime).getTime()) / 1000),
      programType: candidate?.programType ?? 'unknown',
      sequence: context.scheduleItems.length + 1,
    }
    const after = sortScheduleItems([
      ...context.scheduleItems.map((item) => ({ ...item })),
      insertedItem,
    ])

    return {
      command,
      before: context.scheduleItems.map((item) => ({ ...item })),
      after,
      affectedItemIds: [insertedItem.id],
      affectedTimeRanges: [{ start: command.insertTime, end: command.endTime }],
    }
  }

  private buildRecommendations(
    candidates: AgentProgramCandidate[],
    userInput: string,
    context: SchedulingContext,
    options: RecommendationBuildOptions = {},
  ): AgentCandidateRecommendation[] {
    void userInput
    return this.orderRecommendationCandidates(candidates, options.selectedCandidate)
      .slice(0, 3)
      .map((candidate, index) => this.buildRecommendationItem(
        candidate,
        index,
        context,
        options.assessmentByCandidateId?.[candidate.id],
      ))
  }

  private buildRecommendationAssessmentMap(
    diagnostics: AgentCandidateSelectionDiagnostics,
  ): RecommendationBuildOptions['assessmentByCandidateId'] {
    if (!diagnostics.selectedCandidateId || !diagnostics.professionalAssessment) return {}
    return {
      [diagnostics.selectedCandidateId]: diagnostics.professionalAssessment,
    }
  }

  private orderRecommendationCandidates(
    candidates: AgentProgramCandidate[],
    selectedCandidate?: AgentProgramCandidate,
  ): AgentProgramCandidate[] {
    if (!selectedCandidate) return candidates
    return [
      selectedCandidate,
      ...candidates.filter((candidate) => candidate.id !== selectedCandidate.id),
    ]
  }

  private buildRecommendationItem(
    candidate: AgentProgramCandidate,
    index: number,
    context: SchedulingContext,
    assessment?: AgentCandidateProfessionalAssessment,
  ): AgentCandidateRecommendation {
    const visibleSignals = this.buildRecommendationVisibleSignals(assessment)
    return {
      candidateId: candidate.id,
      programName: candidate.programName,
      programCode: candidate.programCode,
      duration: candidate.duration,
      programType: candidate.programType,
      score: Math.max(60, 95 - index * 8),
      reason: this.buildRecommendationReason(context, visibleSignals),
      warningCodes: visibleSignals
        .filter((signal) => signal.verdict === 'warn')
        .map((signal) => signal.code),
      blockingCodes: visibleSignals
        .filter((signal) => signal.verdict === 'block')
        .map((signal) => signal.code),
      evidenceSourceKeys: this.collectSignalSourceKeys(assessment?.signals ?? visibleSignals),
      professionalSignals: visibleSignals,
    }
  }

  private buildRecommendationVisibleSignals(
    assessment?: AgentCandidateProfessionalAssessment,
  ): AgentCandidateAssessmentSignal[] {
    return assessment?.signals.filter((signal) =>
      signal.code !== 'playlist_policy' && (signal.verdict === 'warn' || signal.verdict === 'block'),
    ) ?? []
  }

  private collectSignalSourceKeys(signals: AgentCandidateAssessmentSignal[]): AgentCandidateRecommendation['evidenceSourceKeys'] {
    const sourceKeys = signals.flatMap((signal) => signal.sourceKeys ?? [])
    return Array.from(new Set(sourceKeys)).sort()
  }

  private buildRecommendationReason(
    context: SchedulingContext,
    visibleSignals: AgentCandidateAssessmentSignal[],
  ): string {
    const baseReason = context.playlistType === 'tv'
      ? 'Matches TV playlist policy and candidate conditions'
      : `Matches rotation playlist ${context.rotationStrategy === 'rating' ? 'rating-first' : context.rotationStrategy === 'trending' ? 'trending-first' : 'content-match'} policy`
    if (visibleSignals.length === 0) return baseReason
    return `${baseReason}; confirm professional risk: ${visibleSignals.map((signal) => signal.code).join(', ')}`
  }

  private buildInsertedItemId(command: InsertCommandPlan): string {
    return `agent_insert_${command.candidateId}_${command.insertTime}`
      .replace(/[^a-zA-Z0-9_]/g, '_')
  }

  private readStringSlot(slot?: { value: unknown }): string | undefined {
    return typeof slot?.value === 'string' && slot.value.trim() ? slot.value : undefined
  }

  private readStringArraySlot(slot?: { value: unknown }): string[] {
    return Array.isArray(slot?.value)
      ? slot.value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      : []
  }

  private readNumberSlot(slot?: { value: unknown }): number | undefined {
    return typeof slot?.value === 'number' && Number.isFinite(slot.value) ? slot.value : undefined
  }

  private readInterpretedSlots(input: AgentSubmitInput) {
    return input.interpretation?.slots
  }

  private resolveInterpretedOffsetSeconds(
    offsetSeconds: number,
    direction?: 'forward' | 'backward',
  ): number {
    if (direction === 'backward' && offsetSeconds > 0) return -offsetSeconds
    return offsetSeconds
  }

  private mergeCollectedInput(previousInput: string | undefined, nextInput: string): string {
    const previous = previousInput?.trim()
    const next = nextInput.trim()
    if (!previous) return next
    if (!next) return previous

    const existingTurns = previous
      .split('\n')
      .map((turn) => turn.trim())
      .filter(Boolean)
    if (existingTurns.includes(next)) return previous
    return `${previous}\n${next}`
  }

  private isCancelInput(input: AgentSubmitInput | string): boolean {
    if (typeof input !== 'string' && (
      input.interpretation?.pendingAction === 'cancel_pending'
      || input.interpretation?.pendingAction === 'reject'
    )) return true
    const userInput = typeof input === 'string' ? input : input.userInput
    return /^(算了|不用了|取消|先不|不要了|撤销|拒绝|不确认)$/u.test(userInput.trim())
  }

  private buildPendingCancelledResult(
    input: AgentSubmitInput,
    runtime: AgentCapabilityRuntime,
    intent: AtomicCommandIntent,
    message: string,
  ): AgentResult {
    return {
      status: 'needs_clarification',
      input,
      decision: {
        intent,
        constraintReport: {
          ok: false,
          issues: [{
            code: 'missing_required_slot',
            severity: 'info',
            message,
          }],
        },
      },
      explanation: message,
      trace: runtime.trace.getTrace(),
    }
  }

  private getPendingTaskStaleReason(pendingTask: AgentPendingTask): string | null {
    if (pendingTask.expiresAt) {
      const expiresAtTime = new Date(pendingTask.expiresAt).getTime()
      if (Number.isFinite(expiresAtTime) && expiresAtTime <= Date.now()) {
        return 'pending task expired'
      }
    }
    if (pendingTask.attemptCount >= pendingTask.maxAttempts) {
      return 'pending task reached max attempts'
    }
    return null
  }

  private buildPendingStaleResult(
    input: AgentSubmitInput,
    runtime: AgentCapabilityRuntime,
    pendingTask: AgentPendingTask,
    reason: string,
  ): AgentResult {
    const message = `${reason}; please start a fresh scheduling command.`
    return {
      status: 'needs_clarification',
      input,
      decision: {
        intent: pendingTask.intent,
        constraintReport: {
          ok: false,
          issues: [{
            code: 'missing_required_slot',
            severity: 'info',
            message,
            detail: {
              pendingTaskId: pendingTask.id,
              phase: pendingTask.phase,
              attemptCount: pendingTask.attemptCount,
              maxAttempts: pendingTask.maxAttempts,
              expiresAt: pendingTask.expiresAt,
            },
          }],
        },
      },
      explanation: message,
      trace: runtime.trace.getTrace(),
    }
  }

  private buildPendingContextChangedResultIfNeeded(
    input: AgentSubmitInput,
    runtime: AgentCapabilityRuntime,
    pendingTask: AgentPendingTask | null | undefined,
    context: SchedulingContext,
  ): AgentResult | null {
    if (!pendingTask?.contextFingerprint) return null
    const currentFingerprint = this.buildPendingContextFingerprint(context)
    if (currentFingerprint === pendingTask.contextFingerprint) return null
    const currentSources = this.buildPendingContextSourceSnapshots(context)
    const sourceChanges = this.describePendingContextSourceChanges(pendingTask.contextSources, currentSources)
    if (
      sourceChanges.length > 0
      && sourceChanges.every((change) => !this.isRelevantPendingContextSourceChange(pendingTask.intent, change.sourceKey))
    ) {
      runtime.trace.record('planning', 'Ignored pending context source changes that do not affect this atomic command.', {
        pendingTaskId: pendingTask.id,
        intent: pendingTask.intent,
        ignoredSourceKeys: sourceChanges.map((change) => change.sourceKey),
      })
      return null
    }

    const message = 'pending task context changed; please review the latest playlist and start a fresh scheduling command.'
    return {
      status: 'needs_clarification',
      input,
      decision: {
        intent: pendingTask.intent,
        pendingTask,
        constraintReport: {
          ok: false,
          issues: [{
            code: 'context_conflict',
            severity: 'info',
            message,
            detail: {
              pendingTaskId: pendingTask.id,
              expectedContextFingerprint: pendingTask.contextFingerprint,
              currentContextFingerprint: currentFingerprint,
              changedSourceKeys: sourceChanges.map((change) => change.sourceKey),
              sourceChanges,
              sourceChangeSummary: this.buildPendingContextSourceChangeSummary(sourceChanges),
            },
          }],
        },
      },
      explanation: message,
      trace: runtime.trace.getTrace(),
    }
  }

  private buildContextFingerprint(context: SchedulingContext): string {
    return buildScheduleContextFingerprint(context.scheduleItems)
  }

  private buildPendingContextFingerprint(context: SchedulingContext): string {
    return buildAgentPendingContextFingerprint(context)
  }

  private buildPendingContextSourceSnapshots(context: SchedulingContext): AgentPendingContextSourceSnapshot[] {
    return buildAgentPendingContextSourceSnapshots(context)
  }

  private isRelevantPendingContextSourceChange(intent: AtomicCommandIntent, sourceKey: string): boolean {
    if (intent === 'insert' || intent === 'replace') {
      return ['today', 'candidates', 'readiness', 'history', 'constraints', 'policy'].includes(sourceKey)
    }
    if (intent === 'move' || intent === 'batch_move' || intent === 'delete' || intent === 'batch_delete') {
      return ['today', 'constraints', 'policy'].includes(sourceKey)
    }
    return ['today', 'constraints', 'policy'].includes(sourceKey)
  }

  private describePendingContextSourceChanges(
    previous: AgentPendingContextSourceSnapshot[] | undefined,
    current: AgentPendingContextSourceSnapshot[],
  ): Array<{
    sourceKey: string
    previous?: AgentPendingContextSourceSnapshot
    current: AgentPendingContextSourceSnapshot
  }> {
    if (!previous?.length) return []
    const previousByKey = new Map(previous.map((snapshot) => [snapshot.sourceKey, snapshot]))
    const changes: Array<{
      sourceKey: string
      previous?: AgentPendingContextSourceSnapshot
      current: AgentPendingContextSourceSnapshot
    }> = []
    current.forEach((snapshot) => {
      const before = previousByKey.get(snapshot.sourceKey)
      if (!before) {
        changes.push({
          sourceKey: snapshot.sourceKey,
          current: snapshot,
        })
        return
      }
      if (
        before.digest === snapshot.digest
        && before.source === snapshot.source
        && before.available === snapshot.available
        && before.recordCount === snapshot.recordCount
        && before.status === snapshot.status
        && before.errorCode === snapshot.errorCode
        && before.version === snapshot.version
      ) {
        return
      }
      changes.push({
        sourceKey: snapshot.sourceKey,
        previous: before,
        current: snapshot,
      })
    })
    return changes
  }

  private buildPendingContextSourceChangeSummary(
    sourceChanges: Array<{
      sourceKey: string
      previous?: AgentPendingContextSourceSnapshot
      current: AgentPendingContextSourceSnapshot
    }>,
  ): Array<{
    sourceKey: string
    previousSamples: string[]
    currentSamples: string[]
  }> {
    return sourceChanges
      .map((change) => ({
        sourceKey: change.sourceKey,
        previousSamples: (change.previous?.samples ?? []).slice(0, 3),
        currentSamples: (change.current.samples ?? []).slice(0, 3),
      }))
      .filter((change) => change.previousSamples.length > 0 || change.currentSamples.length > 0)
  }

  private isConfirmationInput(input: AgentSubmitInput | string): boolean {
    if (typeof input !== 'string' && input.interpretation?.pendingAction === 'confirm') return true
    const userInput = typeof input === 'string' ? input : input.userInput
    return /^(确认|确定|可以|执行|就这个|用这个|第[一二三123]个)$/u.test(userInput.trim())
  }

  private isPendingCandidateSelectionOpen(pendingTask: NonNullable<AgentSubmitInput['pendingTask']>): boolean {
    return pendingTask.phase === 'needs_selection' && (pendingTask.recommendations?.length ?? 0) > 0
  }

  private isPendingCandidateSelectionConstrained(pendingTask: NonNullable<AgentSubmitInput['pendingTask']>): boolean {
    return (pendingTask.recommendations?.length ?? 0) > 0
  }

  private isPendingCandidateIdAllowed(
    pendingTask: NonNullable<AgentSubmitInput['pendingTask']>,
    candidateId: string,
  ): boolean {
    if (!this.isPendingCandidateSelectionConstrained(pendingTask)) return true
    const collectedCandidateId = this.readStringSlot(pendingTask.collectedSlots.candidateId)
    if (pendingTask.phase === 'needs_confirmation' && collectedCandidateId) {
      return candidateId === collectedCandidateId
    }
    return candidateId === collectedCandidateId
      || (pendingTask.recommendations?.some((recommendation) => recommendation.candidateId === candidateId) ?? false)
  }

  private updatePendingCandidateSelection(
    pendingTask: NonNullable<AgentSubmitInput['pendingTask']>,
    candidateId: string,
    rawText: string,
  ): NonNullable<AgentSubmitInput['pendingTask']> {
    return {
      ...pendingTask,
      collectedSlots: {
        ...pendingTask.collectedSlots,
        candidateId: {
          value: candidateId,
          source: 'candidate_selection',
          confidence: 0.95,
          rawText,
        },
      },
      missingSlots: ['confirmation'],
      updatedAt: new Date().toISOString(),
    }
  }

  private buildInvalidPendingCandidateSelectionResultIfNeeded(
    input: AgentSubmitInput,
    runtime: AgentCapabilityRuntime,
    pendingTask: NonNullable<AgentSubmitInput['pendingTask']>,
  ): AgentResult | null {
    const interpretedCandidateId = input.interpretation?.slots?.candidateId
    if (!interpretedCandidateId) return null
    if (
      input.interpretation?.pendingAction !== 'select_candidate'
      && input.interpretation?.pendingAction !== 'confirm'
    ) return null
    if (this.isPendingCandidateIdAllowed(pendingTask, interpretedCandidateId)) return null

    const message = 'candidate selection is outside the pending candidate options; confirm the planned candidate or start a new scheduling command.'
    return {
      status: pendingTask.phase === 'needs_selection' ? 'needs_selection' : 'needs_confirmation',
      input,
      decision: {
        intent: pendingTask.intent,
        pendingTask,
        recommendations: pendingTask.recommendations,
        candidateSelection: pendingTask.recommendations?.length
          ? {
              method: 'tv_sequence',
              source: 'none',
              candidateCount: pendingTask.recommendations.length,
              candidateOptionIds: pendingTask.recommendations.map((recommendation) => recommendation.candidateId),
              reason: 'The selected candidate is outside the current pending candidate options.',
            }
          : undefined,
        constraintReport: {
          ok: false,
          issues: [{
            code: 'program_ambiguous',
            severity: 'warning',
            message,
            detail: {
              candidateId: interpretedCandidateId,
              allowedCandidateIds: pendingTask.recommendations?.map((recommendation) => recommendation.candidateId) ?? [],
              plannedCandidateId: this.readStringSlot(pendingTask.collectedSlots.candidateId),
            },
          }],
        },
      },
      explanation: message,
      trace: runtime.trace.getTrace(),
    }
  }

  private resolveSelectedCandidateId(input: AgentSubmitInput | string, pendingTask: NonNullable<AgentSubmitInput['pendingTask']>): string | undefined {
    if (typeof input !== 'string') {
      const interpretedCandidateId = input.interpretation?.slots?.candidateId
      if (interpretedCandidateId && (
        input.interpretation?.pendingAction === 'select_candidate'
        || input.interpretation?.pendingAction === 'confirm'
      )) {
        return this.isPendingCandidateIdAllowed(pendingTask, interpretedCandidateId)
          ? interpretedCandidateId
          : undefined
      }
    }
    const userInput = typeof input === 'string' ? input : input.userInput
    const ordinalMatch = /第?([一二三123])个?/u.exec(userInput.trim())
    if (!ordinalMatch) return undefined
    const indexMap: Record<string, number> = {
      一: 0,
      '1': 0,
      二: 1,
      '2': 1,
      三: 2,
      '3': 2,
    }
    const index = indexMap[ordinalMatch[1]!]
    return typeof index === 'number' ? pendingTask.recommendations?.[index]?.candidateId : undefined
  }

  private buildScheduleItemSearchHaystack(item: ScheduleItemSnapshot): string {
    return this.normalizeSearchText([
      item.id,
      item.programName,
      item.instanceName,
      item.programCode,
      item.columnName,
      item.columnId,
      item.programType,
      ...(item.contentTags ?? []),
    ].filter(Boolean).join(' '))
  }

  private buildScheduleItemTargetHaystack(item: ScheduleItemSnapshot): string {
    return this.normalizeSearchText([
      item.id,
      item.programName,
      item.instanceName,
      item.programCode,
      item.columnName,
      item.columnId,
    ].filter(Boolean).join(' '))
  }

  private normalizedTextIncludesField(normalizedText: string, field?: string): boolean {
    const normalizedField = this.normalizeSearchText(field ?? '')
    return normalizedField.length > 0 && normalizedText.includes(normalizedField)
  }

  private normalizeSearchText(value: string): string {
    return value
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '')
      .replace(/[《》"'“”‘’、，。！？；：,.!?;:()[\]【】_-]/gu, '')
  }
}
