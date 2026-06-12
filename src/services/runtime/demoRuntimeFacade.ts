import type { DeleteCommand, DraftFeasibilityReport, InsertCommand, LayoutDraft, LayoutReference, MoveCommand, OrchestrationCommand, ReplaceCommand, ScheduleState, TaskClassification, TaskMode, ValidationReport } from '@/types/orchestration'
import { getLLMClient } from '@/services/llm/llmClient'
import type { LayoutIntentSegment } from '@/types/orchestration'
import { getTaskClassifier } from '@/services/llm/taskClassifier'
import { buildDialogueContext } from '@/services/dialogueContext'
import { getIntentRecognizer } from '@/services/intentRecognizer'
import type { MicroEditIntent } from '@/services/intentRecognizer'
import { getParamExtractor } from '@/services/paramExtractor'
import type { DeleteParams, InsertParams, MoveParams, ReplaceParams } from '@/services/paramExtractor'
import { getCandidateService } from '@/services/candidateService'
import { getAtomicContinuationClassifier } from '@/services/atomicContinuationClassifier'
import type { AtomicContinuationDecision } from '@/services/atomicContinuationClassifier'
import { getAtomicFollowUpParser } from '@/services/atomicFollowUpParser'
import { getInsertCandidateResolver } from '@/services/insertCandidateResolver'
import { getInsertCommandExecutor } from '@/services/insertCommandExecutor'
import { getReplaceCommandExecutor } from '@/services/replaceCommandExecutor'
import { getScheduleCommandBus } from '@/services/scheduleCommandBus'
import { getScheduleTargetResolver } from '@/services/scheduleTargetResolver'
import { getEffectiveColumnDefinition, getEffectiveLayoutReference, getRuntimeLayoutEntry } from '@/services/orchestration/runtimeLayoutRegistry'
import { getLayoutDraftService } from '@/services/layoutDraftService'
import { getLayoutDraftCompiler } from '@/services/layoutDraftCompiler'
import { getLayoutDraftValidator } from '@/services/layoutDraftValidator'
import { getLayoutDraftFeasibilityService } from '@/services/layoutDraftFeasibilityService'
import { getLayoutIntentRecognizer, type LayoutIntentRecognition } from '@/services/layoutIntentRecognizer'
import { getLayoutAnalysisService } from '@/services/layoutAnalysisService'
import { getAtomicCapabilities } from '@/services/atomicCapabilities'
import { parseAtomicOffset } from '@/services/atomicOffsetParser'
import { parseAtomicClockExpression, parseAtomicTimeRange } from '@/services/atomicTimeParser'
import { looksLikeProgramSchedulingRequest } from '@/services/schedulingIntentHeuristics'
import { getOrchestrationDemoLayout } from '@/mock/orchestrationMock'
import {
  buildPendingAtomicContextFromClarification,
  buildPendingAtomicContextFromInsertRecommendation,
  buildPendingAtomicContextFromTargetSelection,
  deriveAtomicMissingFieldsFromSlots,
  mergeRuntimeAtomicSlots,
  type RuntimeAtomicAction,
  type RuntimeAtomicMissingField,
  type RuntimePendingAtomicContext,
  type RuntimeAtomicSlotBag,
} from './pendingAtomicContext'
import {
  getPendingAtomicContextService,
  type PendingAtomicLifecycleBlockReason,
} from './pendingAtomicContextService'

export type RuntimeDetailMap = Record<string, unknown>
export type RuntimeProcessType = 'planning' | 'selection' | 'execution' | 'validation' | 'general'
export interface RuntimeFeedback { content: string; thinking?: string; explanation?: string; details?: RuntimeDetailMap; processType: RuntimeProcessType; processTypeLabel: string }
export interface RuntimeScheduleItem { id: string; programCode?: string; programName?: string; startTime: string; endTime: string; duration?: number; programType?: string }
export interface RuntimePendingCommand { command: OrchestrationCommand; commands?: OrchestrationCommand[]; summary: string; successMessage?: string; reasoning: string; details?: RuntimeDetailMap }
export interface RuntimePendingTargetSelection { action: 'delete' | 'move' | 'replace'; summary: string; reasoning: string; targetTime: string; programName?: string; candidates: RuntimeScheduleItem[]; selectedItemId: string | null; moveConfig?: { direction: 'forward' | 'backward'; offsetSeconds: number }; replaceProgramName?: string; resolutionDetails?: RuntimeDetailMap }
export interface RuntimeInsertRecommendationCandidate { candidateId: string; programName: string; programCode: string; duration: number; programType: string; score: number; confidence: number; reasonTags: string[] }
export interface RuntimePendingInsertRecommendation { action: 'insert'; summary: string; reasoning: string; originalUserInput: string; collectedUserInput: string; targetTime: string; rawProgramText?: string; semanticLabel?: string; programTypeHint?: string; recommendedCandidates: RuntimeInsertRecommendationCandidate[]; selectedCandidateId: string | null }
export interface RuntimePendingAtomicClarification { action: RuntimeAtomicAction | null; summary: string; reasoning: string; originalUserInput: string; collectedUserInput: string; targetTimeHint?: string; programNameHint?: string; slots?: Partial<RuntimeAtomicSlotBag>; missingFields: string[]; followUpQuestion: string }
export interface RuntimeExecutionPlan { command: OrchestrationCommand; successMessage?: string; thinking?: string; explanation?: string; details?: RuntimeDetailMap }
export interface RuntimeExecutedResult { success: boolean; command: OrchestrationCommand; message: string; error?: string; summary: string; thinking?: string; explanation?: string; details?: RuntimeDetailMap; data?: unknown; affectedTimeRanges?: { start: string; end: string }[]; validationReport?: ValidationReport; validationSummary?: RuntimeDetailMap }
export interface RuntimeSubmitInput { scheduleState: ScheduleState; userInput: string; currentSchedule: RuntimeScheduleItem[]; currentLayoutDraft?: LayoutDraft | null; currentLayoutDraftMode?: Extract<TaskMode, 'full_generate' | 'partial_generate'> | null; pendingTargetSelection?: RuntimePendingTargetSelection | null; pendingInsertRecommendation?: RuntimePendingInsertRecommendation | null; pendingAtomicClarification?: RuntimePendingAtomicClarification | null; pendingAtomicContext?: RuntimePendingAtomicContext | null; history?: string[] }
export interface RuntimeResolveTargetSelectionInput { channelId: string; date: string; pendingTargetSelection: RuntimePendingTargetSelection }
export interface RuntimeResolveInsertRecommendationInput { scheduleState: ScheduleState; pendingInsertRecommendation: RuntimePendingInsertRecommendation }
export interface RuntimeExecutePendingCommandInput { pendingCommand: RuntimePendingCommand; scheduleDate: string; channelId: string }
export interface RuntimeOrchestrationRequest { userInput: string; mode: Extract<TaskMode, 'full_generate' | 'partial_generate'>; reasoning: string; layoutDraft?: LayoutDraft }
export type RuntimeStatusHint = 'needs_clarification' | 'needs_selection' | 'needs_confirmation' | 'accepted' | 'in_progress' | 'completed' | 'failed' | 'cancelled'
export type RuntimeDecision =
  | { kind: 'message'; feedback: RuntimeFeedback; pendingAtomicClarification?: RuntimePendingAtomicClarification; statusHint?: RuntimeStatusHint }
  | { kind: 'pending_atomic_context'; feedback: RuntimeFeedback; pendingAtomicContext: RuntimePendingAtomicContext }
  | { kind: 'pending_command'; feedback: RuntimeFeedback; pendingCommand: RuntimePendingCommand }
  | { kind: 'pending_target_selection'; feedback: RuntimeFeedback; pendingTargetSelection: RuntimePendingTargetSelection }
  | { kind: 'pending_insert_recommendation'; feedback: RuntimeFeedback; pendingInsertRecommendation: RuntimePendingInsertRecommendation }
  | { kind: 'execute_command'; execution: RuntimeExecutionPlan }
  | { kind: 'orchestration'; feedback: RuntimeFeedback; orchestrationRequest: RuntimeOrchestrationRequest }
  | { kind: 'layout_draft'; feedback: RuntimeFeedback; draft: LayoutDraft; feasibilityReport: DraftFeasibilityReport; orchestrationMode: Extract<TaskMode, 'full_generate' | 'partial_generate'> }
  | { kind: 'layout_draft_clear'; feedback: RuntimeFeedback }
  | { kind: 'layout_commit'; feedback: RuntimeFeedback; draft: LayoutDraft; orchestrationRequest: RuntimeOrchestrationRequest }

type RuntimeMicroEditBuildResult = { command: OrchestrationCommand | null; message?: string; thinking?: string; explanation?: string; details?: RuntimeDetailMap; successMessage?: string; pendingTargetSelection?: RuntimePendingTargetSelection; pendingInsertRecommendation?: RuntimePendingInsertRecommendation }
type RuntimePendingAtomicContinuationResult =
  | { kind: 'decision'; decision: RuntimeDecision }
  | { kind: 'clear_pending_and_continue'; input: RuntimeSubmitInput }

const DEFAULT_BROADCAST_WINDOW = { start: '06:00:00', end: '23:59:59' }
const toClockText = (value: string) => value.includes('T') ? (value.split('T')[1]?.slice(0, 8) ?? value) : (value.length === 5 ? `${value}:00` : value)
const clockToSeconds = (value: string) => {
  const [hours = '0', minutes = '0', seconds = '0'] = toClockText(value).split(':')
  return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds)
}
const normalizeDateTime = (date: string, timeText: string) => timeText.includes('T') ? (timeText.includes('+08:00') ? timeText : `${timeText}+08:00`) : `${date}T${toClockText(timeText)}+08:00`
const formatLocalDateTime = (ts: number) => { const d = new Date(ts); return `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, '0')}-${`${d.getDate()}`.padStart(2, '0')}T${`${d.getHours()}`.padStart(2, '0')}:${`${d.getMinutes()}`.padStart(2, '0')}:${`${d.getSeconds()}`.padStart(2, '0')}+08:00` }
const offsetDateTime = (dateTime: string, offsetSeconds: number) => formatLocalDateTime(new Date(dateTime).getTime() + offsetSeconds * 1000)
const dedupeStrings = (values: string[]) => Array.from(new Set(values.filter(Boolean)))
const buildValidationSummary = (report?: ValidationReport): RuntimeDetailMap | undefined => report ? { totalIssues: report.summary.totalIssues, criticalCount: report.summary.criticalCount, warningCount: report.summary.warningCount, infoCount: report.summary.infoCount, isValid: report.isValid } : undefined
const createFeedback = (content: string, processType: RuntimeProcessType, processTypeLabel: string, extras?: Partial<Omit<RuntimeFeedback, 'content' | 'processType' | 'processTypeLabel'>>): RuntimeFeedback => ({ content, processType, processTypeLabel, ...extras })
const resolveBroadcastWindow = (channelId: string, date: string) => { const layout = getEffectiveLayoutReference(channelId, date); if (!layout?.slots.length) return DEFAULT_BROADCAST_WINDOW; const slots = [...layout.slots].sort((a, b) => a.startTime.localeCompare(b.startTime)); return { start: toClockText(slots[0]!.startTime), end: toClockText(slots.at(-1)!.endTime) } }
const findSlotColumnIdByTime = (channelId: string, date: string, dateTime: string) => getEffectiveLayoutReference(channelId, date)?.slots.find((slot) => { const target = new Date(dateTime).getTime(); const start = new Date(slot.startTime).getTime(); const end = new Date(slot.endTime).getTime(); return start <= target && target < end })?.columnId
const resolveItemColumnId = (item: RuntimeScheduleItem, channelId: string, date: string) => findSlotColumnIdByTime(channelId, date, normalizeDateTime(date, item.startTime))
const asRuntimeItem = (item: RuntimeScheduleItem) => ({ id: item.id, programCode: item.programCode, programName: item.programName, startTime: item.startTime, endTime: item.endTime, duration: item.duration, programType: item.programType })

export class DemoRuntimeFacade {
  private readonly llmClient = getLLMClient()
  private readonly taskClassifier = getTaskClassifier(this.llmClient)
  private readonly intentRecognizer = getIntentRecognizer(this.llmClient)
  private readonly layoutIntentRecognizer = getLayoutIntentRecognizer(this.llmClient)
  private readonly paramExtractor = getParamExtractor(this.llmClient)
  private readonly atomicContinuationClassifier = getAtomicContinuationClassifier()
  private readonly atomicFollowUpParser = getAtomicFollowUpParser()
  private readonly pendingAtomicContextService = getPendingAtomicContextService()
  private readonly candidateService = getCandidateService()
  private readonly insertCandidateResolver = getInsertCandidateResolver()
  private readonly insertCommandExecutor = getInsertCommandExecutor()
  private readonly replaceCommandExecutor = getReplaceCommandExecutor()
  private readonly scheduleCommandBus = getScheduleCommandBus()
  private readonly scheduleTargetResolver = getScheduleTargetResolver(this.llmClient)
  private readonly layoutDraftService = getLayoutDraftService(this.llmClient)
  private readonly layoutDraftCompiler = getLayoutDraftCompiler()
  private readonly layoutDraftValidator = getLayoutDraftValidator()
  private readonly layoutDraftFeasibilityService = getLayoutDraftFeasibilityService()
  private readonly layoutAnalysisService = getLayoutAnalysisService(this.llmClient)

  async submitInstruction(input: RuntimeSubmitInput): Promise<RuntimeDecision> {
    const initialFastSystemClassification = this.classifyFastSystemIntent(input.userInput)
    if (initialFastSystemClassification) {
      if (initialFastSystemClassification.mode === 'validate_only') {
        return this.buildValidationDecision(initialFastSystemClassification, input)
      }
      if (initialFastSystemClassification.mode === 'repair_only') {
        return this.buildRepairAnalysisDecision(initialFastSystemClassification, input)
      }
      if (initialFastSystemClassification.mode === 'layout_analysis') {
        return await this.buildLayoutAnalysisDecision(initialFastSystemClassification, input)
      }
    }

    let effectiveInput = input
    const pendingAtomicContextContinuation = await this.tryContinuePendingAtomicContext(input)
    if (pendingAtomicContextContinuation) {
      if (pendingAtomicContextContinuation.kind === 'decision') return pendingAtomicContextContinuation.decision
      effectiveInput = pendingAtomicContextContinuation.input
    }

    const pendingAtomicDecision = await this.tryContinuePendingAtomicClarification(effectiveInput)
    if (pendingAtomicDecision) return pendingAtomicDecision

    const layoutDraftClearDecision = this.tryClearLayoutDraft(effectiveInput)
    if (layoutDraftClearDecision) return layoutDraftClearDecision

    const batchRangeDecision = this.tryHandleBatchRangeInstruction(effectiveInput)
    if (batchRangeDecision) return batchRangeDecision

    const atomicDecision = await this.tryHandleAtomicInstruction(effectiveInput)
    if (atomicDecision) return atomicDecision

    const fastSystemClassification = this.classifyFastSystemIntent(effectiveInput.userInput)
    if (fastSystemClassification) {
      if (fastSystemClassification.mode === 'validate_only') {
        return this.buildValidationDecision(fastSystemClassification, effectiveInput)
      }
      if (fastSystemClassification.mode === 'repair_only') {
        return this.buildRepairAnalysisDecision(fastSystemClassification, effectiveInput)
      }
      if (fastSystemClassification.mode === 'layout_analysis') {
        return await this.buildLayoutAnalysisDecision(fastSystemClassification, effectiveInput)
      }
    }

    const layoutRecognition = await this.layoutIntentRecognizer.recognize({
      scheduleState: effectiveInput.scheduleState,
      userInput: effectiveInput.userInput,
      history: effectiveInput.history,
      currentLayoutDraft: effectiveInput.currentLayoutDraft,
      hasUploadedLayout: Boolean(getRuntimeLayoutEntry(effectiveInput.scheduleState.channelId, effectiveInput.scheduleState.date)?.templateMode),
      hasDefaultLayout: Boolean(getOrchestrationDemoLayout(effectiveInput.scheduleState.channelId, effectiveInput.scheduleState.date)),
    })
    if (this.isAtomicFallbackIntent(layoutRecognition)) {
      const pendingAtomicClarification = this.buildPendingAtomicClarification(effectiveInput, layoutRecognition.reasoning)
      return this.buildPendingAtomicClarificationDecision(pendingAtomicClarification)
    }
    if (this.isConfidentLayoutIntent(layoutRecognition)) {
      const classification = this.convertLayoutIntentToClassification(layoutRecognition, effectiveInput.userInput)
      if (classification.mode === 'layout_analysis') {
        return await this.buildLayoutAnalysisDecision(classification, effectiveInput)
      }
      return classification.mode === 'layout_commit'
        ? this.commitLayoutDraft(effectiveInput, classification)
        : this.prepareLayoutDraft(effectiveInput, classification, this.resolvePreferredOrchestrationMode(effectiveInput))
    }

    const classification = await this.taskClassifier.classify({ scheduleState: effectiveInput.scheduleState, userInput: effectiveInput.userInput, history: effectiveInput.history })
    if (classification.mode === 'micro_edit') {
      const result = await this.buildMicroEditCommand(effectiveInput, classification.reasoning)
      return this.buildMicroEditDecisionWithContinuationFallback(
        effectiveInput,
        result,
        classification.reasoning,
      )
    }
    if (classification.mode === 'validate_only') return this.buildValidationDecision(classification, effectiveInput)
    if (classification.mode === 'repair_only') return this.buildRepairAnalysisDecision(classification, effectiveInput)
    if (classification.mode === 'layout_analysis') return await this.buildLayoutAnalysisDecision(classification, effectiveInput)
    if (classification.mode === 'layout_prepare' || classification.mode === 'layout_refine' || classification.mode === 'layout_commit') {
      return classification.mode === 'layout_commit'
        ? this.commitLayoutDraft(effectiveInput, classification)
        : this.prepareLayoutDraft(effectiveInput, classification, this.resolvePreferredOrchestrationMode(effectiveInput))
    }
    if (classification.mode === 'full_generate' || classification.mode === 'partial_generate') {
      return this.prepareLayoutDraft(effectiveInput, classification, classification.mode === 'full_generate' ? 'full_generate' : 'partial_generate')
    }
    return { kind: 'message', feedback: this.buildClarifyFeedback(effectiveInput, classification.reasoning || layoutRecognition.reasoning) }
  }

  async resolvePendingTargetSelection(input: RuntimeResolveTargetSelectionInput): Promise<RuntimeDecision> {
    const { pendingTargetSelection, channelId, date } = input
    const selectedItem = pendingTargetSelection.candidates.find((item) => item.id === pendingTargetSelection.selectedItemId)
    if (!selectedItem) return { kind: 'message', feedback: createFeedback('当前未选中有效的目标节目，请重新选择。', 'selection', '目标选择', { explanation: pendingTargetSelection.reasoning, details: pendingTargetSelection.resolutionDetails }) }

    if (pendingTargetSelection.action === 'move') {
      const moveConfig = pendingTargetSelection.moveConfig
      if (!moveConfig) return { kind: 'message', feedback: createFeedback('移动命令缺少时间偏移配置，无法继续执行。', 'selection', '目标选择') }
      const currentStart = normalizeDateTime(date, selectedItem.startTime)
      const offsetSeconds = moveConfig.direction === 'backward' ? -Math.abs(moveConfig.offsetSeconds) : Math.abs(moveConfig.offsetSeconds)
      const newStartTime = offsetDateTime(currentStart, offsetSeconds)
      const violation = this.resolveMoveWindowViolation({ channelId, date, item: selectedItem, newStartTime })
      if (violation) return { kind: 'message', feedback: createFeedback(violation.message, 'execution', '时间范围校验', { thinking: violation.thinking, details: violation.details }) }
      const command: MoveCommand = { action: 'move', reasoning: pendingTargetSelection.reasoning, data: { itemId: selectedItem.id, newStartTime } }
      return { kind: 'execute_command', execution: { command, successMessage: `已将 ${selectedItem.programName || selectedItem.id} 移动到 ${toClockText(newStartTime)}`, explanation: pendingTargetSelection.reasoning, details: { ...(pendingTargetSelection.resolutionDetails ?? {}), matchedItem: asRuntimeItem(selectedItem), sourceTimeRange: { start: selectedItem.startTime, end: selectedItem.endTime }, proposedTimeRange: { start: toClockText(newStartTime), end: toClockText(newStartTime) } } } }
    }

    if (pendingTargetSelection.action === 'delete') {
      const command: DeleteCommand = { action: 'delete', reasoning: pendingTargetSelection.reasoning, data: { itemId: selectedItem.id } }
      return { kind: 'pending_command', feedback: createFeedback(`将删除 ${selectedItem.startTime} 的《${selectedItem.programName || selectedItem.id}》。`, 'selection', '待确认修改', { explanation: pendingTargetSelection.reasoning, details: { ...(pendingTargetSelection.resolutionDetails ?? {}), matchedItem: asRuntimeItem(selectedItem), targetTime: selectedItem.startTime } }), pendingCommand: { command, summary: `删除 ${selectedItem.startTime} 的《${selectedItem.programName || selectedItem.id}》`, successMessage: `已删除 ${selectedItem.startTime} 的《${selectedItem.programName || selectedItem.id}》`, reasoning: pendingTargetSelection.reasoning, details: { ...(pendingTargetSelection.resolutionDetails ?? {}), matchedItem: asRuntimeItem(selectedItem), targetTime: selectedItem.startTime } } }
    }

    const replaceProgramName = pendingTargetSelection.replaceProgramName?.trim()
    if (!replaceProgramName) return { kind: 'message', feedback: createFeedback('替换目标缺少新节目名称，请重新描述替换需求。', 'selection', '目标选择') }
    return this.buildReplaceDecisionForSelectedItem(selectedItem, replaceProgramName, channelId, date, pendingTargetSelection)
  }

  async resolvePendingInsertRecommendation(input: RuntimeResolveInsertRecommendationInput): Promise<RuntimeDecision> {
    const { pendingInsertRecommendation, scheduleState } = input
    const selectedCandidate = pendingInsertRecommendation.recommendedCandidates.find(
      (candidate) => candidate.candidateId === pendingInsertRecommendation.selectedCandidateId,
    )
    if (!selectedCandidate) {
      return {
        kind: 'message',
        feedback: createFeedback(
          '当前未选中有效的插入候选，请重新确认要插入的节目。',
          'selection',
          '插入推荐',
          {
            explanation: pendingInsertRecommendation.reasoning,
            details: {
              targetTime: pendingInsertRecommendation.targetTime,
              recommendedCandidateCount: pendingInsertRecommendation.recommendedCandidates.length,
            },
          },
        ),
      }
    }

    const result = this.buildInsertCommandResult(
      {
        scheduleState,
        userInput: pendingInsertRecommendation.collectedUserInput,
        currentSchedule: [],
      },
      {
        targetTime: pendingInsertRecommendation.targetTime,
        programName: selectedCandidate.programName,
        rawProgramText: pendingInsertRecommendation.rawProgramText,
        semanticLabel: pendingInsertRecommendation.semanticLabel,
        programTypeHint: pendingInsertRecommendation.programTypeHint,
      },
      {
        id: selectedCandidate.candidateId,
        programName: selectedCandidate.programName,
      },
      pendingInsertRecommendation.reasoning,
      {
        targetTime: pendingInsertRecommendation.targetTime,
        selectedCandidateName: selectedCandidate.programName,
        recommendedCandidateCount: pendingInsertRecommendation.recommendedCandidates.length,
      },
      '已按你的确认选择插入候选节目。',
    )

    return this.buildMicroEditDecision(result, pendingInsertRecommendation.reasoning)
  }

  async executePendingCommand(input: RuntimeExecutePendingCommandInput): Promise<RuntimeExecutedResult> {
    if (input.pendingCommand.commands?.length) {
      if (input.pendingCommand.details?.actionType === 'batch_move') {
        return this.executeBatchMovePendingCommand(input)
      }
      const result = await this.scheduleCommandBus.executeBatch(input.pendingCommand.commands, { scheduleDate: input.scheduleDate, channelId: input.channelId })
      return {
        success: result.success,
        command: input.pendingCommand.command,
        message: result.success ? (input.pendingCommand.successMessage || result.message) : (result.error || result.message),
        error: result.error,
        summary: input.pendingCommand.summary,
        thinking: result.success ? '批量命令已执行完成。' : '批量命令执行失败，未能完成本次修改。',
        explanation: input.pendingCommand.reasoning,
        details: input.pendingCommand.details,
        data: result.data,
        affectedTimeRanges: result.affectedTimeRanges,
        validationReport: result.validationReport,
        validationSummary: buildValidationSummary(result.validationReport),
      }
    }
    const result = await this.scheduleCommandBus.execute(input.pendingCommand.command, { scheduleDate: input.scheduleDate, channelId: input.channelId })
    return { success: result.success, command: input.pendingCommand.command, message: result.success ? (input.pendingCommand.successMessage || result.message) : (result.error || result.message), error: result.error, summary: input.pendingCommand.summary, thinking: result.success ? '命令已执行完成。' : '命令执行失败，未能完成本次修改。', explanation: input.pendingCommand.reasoning, details: input.pendingCommand.details, data: result.data, affectedTimeRanges: result.affectedTimeRanges, validationReport: result.validationReport, validationSummary: buildValidationSummary(result.validationReport) }
  }

  private async executeBatchMovePendingCommand(input: RuntimeExecutePendingCommandInput): Promise<RuntimeExecutedResult> {
    const commands = input.pendingCommand.commands?.filter((command): command is MoveCommand => command.action === 'move') ?? []
    if (commands.length === 0) {
      return {
        success: false,
        command: input.pendingCommand.command,
        message: '批量平移缺少可执行命令。',
        error: 'missing_batch_move_commands',
        summary: input.pendingCommand.summary,
        thinking: '批量平移执行前没有找到逐条移动命令。',
        explanation: input.pendingCommand.reasoning,
        details: input.pendingCommand.details,
      }
    }

    const atomicCapabilities = getAtomicCapabilities()
    const allItems = atomicCapabilities.getAllItems()
    const moveByItemId = new Map(commands.map((command) => [command.data.itemId, command]))
    const affectedTimeRanges: { start: string; end: string }[] = []
    const updatedItems = allItems.map((item) => {
      const command = moveByItemId.get(item.id)
      if (!command) return item
      const durationSeconds = item.duration ?? Math.max(0, (new Date(item.endTime).getTime() - new Date(item.startTime).getTime()) / 1000)
      const newStartMs = new Date(command.data.newStartTime).getTime()
      const newEndTime = formatLocalDateTime(newStartMs + durationSeconds * 1000)
      affectedTimeRanges.push({ start: item.startTime, end: item.endTime })
      affectedTimeRanges.push({ start: command.data.newStartTime, end: newEndTime })
      return {
        ...item,
        startTime: command.data.newStartTime,
        endTime: newEndTime,
      }
    })

    const missingIds = commands
      .map((command) => command.data.itemId)
      .filter((itemId) => !allItems.some((item) => item.id === itemId))
    if (missingIds.length > 0) {
      return {
        success: false,
        command: input.pendingCommand.command,
        message: `批量平移失败，找不到 ${missingIds.length} 条节目。`,
        error: `missing_items:${missingIds.join(',')}`,
        summary: input.pendingCommand.summary,
        thinking: '确认执行时节目单上下文已变化，预演中的部分节目不存在。',
        explanation: input.pendingCommand.reasoning,
        details: {
          ...(input.pendingCommand.details ?? {}),
          missingIds,
        },
      }
    }

    const result = await atomicCapabilities.replaceAllItems(updatedItems)
    const validationReport = this.scheduleCommandBus.validate({ scheduleDate: input.scheduleDate, channelId: input.channelId })

    return {
      success: result.success,
      command: input.pendingCommand.command,
      message: result.success ? (input.pendingCommand.successMessage || `已完成 ${commands.length} 条节目的批量平移。`) : (result.error || '批量平移执行失败。'),
      error: result.error,
      summary: input.pendingCommand.summary,
      thinking: result.success ? '已按预演文件一次性写回批量平移结果。' : '批量平移写回失败，节目单未完成更新。',
      explanation: input.pendingCommand.reasoning,
      details: input.pendingCommand.details,
      data: {
        ...(result.data ?? {}),
        commandCount: commands.length,
      },
      affectedTimeRanges,
      validationReport,
      validationSummary: buildValidationSummary(validationReport),
    }
  }

  private isConfidentLayoutIntent(recognition: LayoutIntentRecognition): boolean { return recognition.mode !== 'clarify' && recognition.mode !== 'atomic_fallback' && recognition.confidence >= 0.72 }
  private isAtomicFallbackIntent(recognition: LayoutIntentRecognition): boolean { return recognition.mode === 'atomic_fallback' && recognition.confidence >= 0.72 }
  private convertLayoutIntentToClassification(recognition: LayoutIntentRecognition, userInput: string): TaskClassification {
    const mode: TaskMode = recognition.mode === 'clarify' || recognition.mode === 'atomic_fallback'
      ? 'clarify'
      : recognition.mode
    return { mode, confidence: recognition.confidence, reasoning: recognition.reasoning, suggestedParams: { userIntent: recognition.semanticLabel || userInput, targetTimeRange: recognition.targetTimeRange, ignoreExistingLayout: recognition.ignoreExistingLayout, semanticLabel: recognition.semanticLabel, programTypeHint: recognition.programTypeHint, segments: recognition.segments } }
  }
  private shouldApplyIntentOnExistingDraft(classification: TaskClassification, currentDraft?: LayoutDraft | null): boolean {
    if (classification.suggestedParams?.segments?.length) return true
    if (classification.suggestedParams?.semanticLabel || classification.suggestedParams?.programTypeHint) return true
    const targetTimeRange = classification.suggestedParams?.targetTimeRange
    if (!targetTimeRange) return false
    if (!currentDraft) return true
    return targetTimeRange.start !== currentDraft.coverage.start || targetTimeRange.end !== currentDraft.coverage.end
  }
  private shouldPreferReferenceLayout(classification: TaskClassification, ignoreExistingLayout: boolean): boolean {
    if (ignoreExistingLayout) return false
    const suggested = classification.suggestedParams ?? {}
    if (suggested.segments?.length || suggested.semanticLabel || suggested.programTypeHint) return false
    const targetTimeRange = suggested.targetTimeRange
    if (!targetTimeRange) return true
    return targetTimeRange.start === DEFAULT_BROADCAST_WINDOW.start
      && targetTimeRange.end === DEFAULT_BROADCAST_WINDOW.end
  }
  private normalizeStructuredSegments(segments?: LayoutIntentSegment[]): LayoutIntentSegment[] | undefined { return segments?.filter((segment) => Boolean(segment.start && segment.end)) }
  private resolvePreferredOrchestrationMode(input: RuntimeSubmitInput): Extract<TaskMode, 'full_generate' | 'partial_generate'> {
    return input.currentLayoutDraftMode ?? (input.scheduleState.isEmpty || input.scheduleState.itemCount === 0 ? 'full_generate' : 'partial_generate')
  }

  private async tryContinuePendingAtomicContext(input: RuntimeSubmitInput): Promise<RuntimePendingAtomicContinuationResult | null> {
    const pendingContext = input.pendingAtomicContext
    if (!pendingContext) return null

    const continuationDecision = this.atomicContinuationClassifier.classify({
      pendingContext,
      userInput: input.userInput,
    })

    if (continuationDecision.kind === 'cancel') {
      return {
        kind: 'decision',
        decision: this.buildPendingAtomicCancelledDecision(pendingContext),
      }
    }
    if (continuationDecision.kind === 'interrupt_as_new_task') {
      return {
        kind: 'clear_pending_and_continue',
        input: this.clearPendingAtomicState(input),
      }
    }

    const lifecycleBlockReason = this.pendingAtomicContextService.getBlockReason(pendingContext)
    if (lifecycleBlockReason) {
      return {
        kind: 'decision',
        decision: this.buildPendingAtomicLifecycleBlockedDecision(pendingContext, lifecycleBlockReason),
      }
    }

    if (pendingContext.phase === 'clarifying') {
      return {
        kind: 'decision',
        decision: await this.continuePendingAtomicClarifyingContext(input, pendingContext),
      }
    }

    if (pendingContext.phase === 'selecting_target') {
      return {
        kind: 'decision',
        decision: await this.continuePendingTargetSelection(input, pendingContext, continuationDecision),
      }
    }

    if (pendingContext.phase === 'recommending_insert') {
      return {
        kind: 'decision',
        decision: await this.continuePendingInsertRecommendation(input, pendingContext, continuationDecision),
      }
    }

    return null
  }

  private clearPendingAtomicState(input: RuntimeSubmitInput): RuntimeSubmitInput {
    return {
      ...input,
      pendingTargetSelection: null,
      pendingInsertRecommendation: null,
      pendingAtomicClarification: null,
      pendingAtomicContext: null,
    }
  }

  private buildPendingAtomicCancelledDecision(pending: RuntimePendingAtomicContext): RuntimeDecision {
    return {
      kind: 'message',
      statusHint: 'cancelled',
      feedback: createFeedback(
        `${pending.summary}已取消。`,
        'general',
        '已取消',
        {
          explanation: pending.reasoning,
          details: {
            action: pending.action,
            phase: pending.phase,
          },
        },
      ),
    }
  }

  private buildPendingAtomicLifecycleBlockedDecision(
    pending: RuntimePendingAtomicContext,
    reason: PendingAtomicLifecycleBlockReason,
  ): RuntimeDecision {
    if (reason === 'expired') {
      return {
        kind: 'message',
        statusHint: 'cancelled',
        feedback: createFeedback(
          '上一条待补充的修改任务已经超时失效，请重新描述完整需求。',
          'general',
          '上下文已失效',
          {
            explanation: pending.reasoning,
            details: {
              action: pending.action,
              phase: pending.phase,
              expiresAt: pending.expiresAt,
            },
          },
        ),
      }
    }

    return {
      kind: 'message',
      statusHint: 'failed',
      feedback: createFeedback(
        `这条待处理的修改任务已经连续尝试 ${pending.attemptCount} 次仍未补齐，我先结束本轮上下文。请重新描述完整需求。`,
        'general',
        '补参失败',
        {
          explanation: pending.reasoning,
          details: {
            action: pending.action,
            phase: pending.phase,
            attemptCount: pending.attemptCount,
          },
        },
      ),
    }
  }

  private rehydratePendingAtomicClarification(pending: RuntimePendingAtomicContext): RuntimePendingAtomicClarification {
    const missingFields = pending.missingFields.map((field) => {
      switch (field) {
        case 'target_time':
          return 'target'
        case 'program_name':
          return 'program'
        case 'replacement_program':
          return 'replacement'
        case 'offset':
          return 'offset'
        default:
          return 'target'
      }
    })

    return {
      action: pending.action,
      summary: pending.summary,
      reasoning: pending.reasoning,
      originalUserInput: pending.originalUserInput,
      collectedUserInput: pending.collectedUserInput,
      targetTimeHint: pending.slots.targetTimeHint,
      programNameHint: pending.slots.programName ?? pending.slots.rawProgramText,
      slots: pending.slots,
      missingFields,
      followUpQuestion: pending.followUpQuestion,
    }
  }

  private rehydratePendingTargetSelection(pending: RuntimePendingAtomicContext): RuntimePendingTargetSelection | null {
    if (pending.phase !== 'selecting_target' || !pending.targetCandidates?.length || !pending.action || pending.action === 'insert') return null
    return {
      action: pending.action,
      summary: pending.summary,
      reasoning: pending.reasoning,
      targetTime: pending.slots.targetTime ?? pending.slots.targetTimeHint ?? '',
      programName: pending.slots.programName,
      candidates: pending.targetCandidates,
      selectedItemId: pending.selectedItemId ?? null,
      moveConfig: pending.slots.direction && typeof pending.slots.offsetSeconds === 'number'
        ? {
            direction: pending.slots.direction,
            offsetSeconds: pending.slots.offsetSeconds,
          }
        : undefined,
      replaceProgramName: pending.slots.replacementProgramName,
    }
  }

  private rehydratePendingInsertRecommendation(pending: RuntimePendingAtomicContext): RuntimePendingInsertRecommendation | null {
    if (pending.phase !== 'recommending_insert' || !pending.insertRecommendations?.length) return null
    return {
      action: 'insert',
      summary: pending.summary,
      reasoning: pending.reasoning,
      originalUserInput: pending.originalUserInput,
      collectedUserInput: pending.collectedUserInput,
      targetTime: pending.slots.targetTime ?? pending.slots.targetTimeHint ?? '',
      rawProgramText: pending.slots.rawProgramText,
      semanticLabel: pending.slots.semanticLabel,
      programTypeHint: pending.slots.programTypeHint,
      recommendedCandidates: pending.insertRecommendations,
      selectedCandidateId: pending.selectedCandidateId ?? null,
    }
  }

  private async continuePendingAtomicClarifyingContext(input: RuntimeSubmitInput, pendingContext: RuntimePendingAtomicContext): Promise<RuntimeDecision> {
    const parsedPatch = this.atomicFollowUpParser.parse({
      pendingContext,
      userInput: input.userInput,
    })

    if (parsedPatch) {
      const patchedContext = this.refreshClarifyingPendingAtomicContext(
        this.patchPendingAtomicContext(pendingContext, parsedPatch.slots, input.userInput),
      )

      if (patchedContext.missingFields.length === 0 && patchedContext.action) {
        const canonicalUserInput = this.buildCanonicalAtomicInstruction(patchedContext)
        const result = await this.buildMicroEditCommand(
          {
            ...this.clearPendingAtomicState(input),
            userInput: canonicalUserInput,
          },
          patchedContext.reasoning,
          {
            type: patchedContext.action,
            confidence: 0.85,
            reasoning: patchedContext.reasoning,
          },
        )
        return this.buildMicroEditDecision(result, patchedContext.reasoning, patchedContext)
      }

      return this.buildPendingAtomicContextDecision(patchedContext)
    }

    const pendingAtomicClarification = input.pendingAtomicClarification ?? this.rehydratePendingAtomicClarification(pendingContext)
    const decision = await this.tryContinuePendingAtomicClarification({
      ...input,
      pendingAtomicClarification,
      pendingAtomicContext: null,
    })
    if (decision?.kind === 'pending_atomic_context') {
      return this.buildPendingAtomicContextDecision(
        this.pendingAtomicContextService.recordAttempt(decision.pendingAtomicContext),
        decision.feedback,
      )
    }
    return decision ?? this.buildPendingAtomicContextDecision(
      this.pendingAtomicContextService.recordAttempt(pendingContext),
    )
  }

  private async continuePendingTargetSelection(
    input: RuntimeSubmitInput,
    pendingContext: RuntimePendingAtomicContext,
    continuationDecision?: AtomicContinuationDecision,
  ): Promise<RuntimeDecision> {
    const pendingTargetSelection = input.pendingTargetSelection ?? this.rehydratePendingTargetSelection(pendingContext)
    if (!pendingTargetSelection) {
      return {
        kind: 'message',
        feedback: createFeedback('当前未找到可继续的目标选择上下文，请重新描述你的修改需求。', 'selection', '目标选择'),
      }
    }

    const selectedItemId = this.resolvePendingTargetSelectionReply(
      pendingTargetSelection,
      continuationDecision?.kind === 'selection_reply' && continuationDecision.selection.mode === 'raw_text'
        ? continuationDecision.selection.value
        : input.userInput,
    )
    if (!selectedItemId) {
      return this.buildPendingTargetSelectionDecision(
        pendingTargetSelection,
        '我还不能确定你选的是哪一个目标。你可以回复“第一个”、具体节目名，或直接点选列表项。',
        this.pendingAtomicContextService.recordAttempt(pendingContext),
      )
    }

    return this.resolvePendingTargetSelection({
      channelId: input.scheduleState.channelId,
      date: input.scheduleState.date,
      pendingTargetSelection: {
        ...pendingTargetSelection,
        selectedItemId,
      },
    })
  }

  private async continuePendingInsertRecommendation(
    input: RuntimeSubmitInput,
    pendingContext: RuntimePendingAtomicContext,
    continuationDecision?: AtomicContinuationDecision,
  ): Promise<RuntimeDecision> {
    const pendingInsertRecommendation = input.pendingInsertRecommendation ?? this.rehydratePendingInsertRecommendation(pendingContext)
    if (!pendingInsertRecommendation) {
      return {
        kind: 'message',
        feedback: createFeedback('当前未找到可继续的插入推荐上下文，请重新描述插入需求。', 'selection', '插入推荐'),
      }
    }

    const selectedCandidateId = this.resolvePendingInsertRecommendationReply(
      pendingInsertRecommendation,
      continuationDecision?.kind === 'selection_reply' && continuationDecision.selection.mode === 'raw_text'
        ? continuationDecision.selection.value
        : input.userInput,
    )
    if (selectedCandidateId) {
      return this.resolvePendingInsertRecommendation({
        scheduleState: input.scheduleState,
        pendingInsertRecommendation: {
          ...pendingInsertRecommendation,
          selectedCandidateId,
        },
      })
    }

    const correctionPatch = this.atomicFollowUpParser.parse({
      pendingContext,
      userInput: continuationDecision?.kind === 'correction_reply'
        ? continuationDecision.value
        : input.userInput,
    })
    const patchedContext = correctionPatch
      ? this.patchPendingAtomicContext(
          pendingContext,
          correctionPatch.slots,
          continuationDecision?.kind === 'correction_reply' ? continuationDecision.value : input.userInput,
        )
      : pendingContext

    const mergedUserInput = correctionPatch
      ? this.buildCanonicalAtomicInstruction(patchedContext)
      : this.mergePendingCollectedInput(pendingInsertRecommendation.collectedUserInput, input.userInput)
    const retriedInput: RuntimeSubmitInput = {
      ...this.clearPendingAtomicState(input),
      userInput: mergedUserInput,
    }
    const result = await this.buildMicroEditCommand(
      retriedInput,
      pendingInsertRecommendation.reasoning,
      {
        type: 'insert',
        confidence: 0.6,
        reasoning: pendingInsertRecommendation.reasoning,
      },
    )

    if (result.command || result.pendingInsertRecommendation) {
      return this.buildMicroEditDecision(result, pendingInsertRecommendation.reasoning)
    }

    return this.buildPendingInsertRecommendationDecision(
      {
        ...pendingInsertRecommendation,
        collectedUserInput: correctionPatch ? patchedContext.collectedUserInput : mergedUserInput,
      },
      result.message || '还没确认具体要插入的节目。你可以回复“第一个”、直接说候选节目名，或补充更明确的节目描述。',
      this.pendingAtomicContextService.recordAttempt(correctionPatch ? patchedContext : pendingContext),
    )
  }

  private resolvePendingTargetSelectionReply(pending: RuntimePendingTargetSelection, userInput: string): string | null {
    const ordinalIndex = this.resolveSelectionOrdinalIndex(userInput)
    if (ordinalIndex !== null) {
      return pending.candidates[ordinalIndex]?.id ?? null
    }

    const normalizedInput = this.normalizeSelectionText(userInput)
    if (!normalizedInput) return null

    const matchedByName = pending.candidates.find((candidate) => {
      const name = this.normalizeSelectionText(candidate.programName ?? '')
      return name && (normalizedInput.includes(name) || name.includes(normalizedInput))
    })
    if (matchedByName) return matchedByName.id

    const matchedByTime = pending.candidates.find((candidate) => normalizedInput.includes(this.normalizeSelectionText(candidate.startTime)))
    return matchedByTime?.id ?? null
  }

  private resolvePendingInsertRecommendationReply(pending: RuntimePendingInsertRecommendation, userInput: string): string | null {
    const ordinalIndex = this.resolveSelectionOrdinalIndex(userInput)
    if (ordinalIndex !== null) {
      return pending.recommendedCandidates[ordinalIndex]?.candidateId ?? null
    }

    const normalizedInput = this.normalizeSelectionText(userInput)
    if (!normalizedInput) return null

    const matched = pending.recommendedCandidates.find((candidate) => {
      const name = this.normalizeSelectionText(candidate.programName)
      return normalizedInput.includes(name) || name.includes(normalizedInput)
    })
    return matched?.candidateId ?? null
  }

  private resolveSelectionOrdinalIndex(userInput: string): number | null {
    const normalized = userInput.replace(/\s+/g, '')
    const cleaned = normalized.replace(/(我选|选|就|那就|吧|啊|呀|呢|节目|条|项|个)/g, '')
    const mapping: Record<string, number> = {
      '第一': 0,
      '第1': 0,
      '一': 0,
      '1': 0,
      '第二': 1,
      '第2': 1,
      '二': 1,
      '2': 1,
      '第三': 2,
      '第3': 2,
      '三': 2,
      '3': 2,
      '第四': 3,
      '第4': 3,
      '四': 3,
      '4': 3,
      '第五': 4,
      '第5': 4,
      '五': 4,
      '5': 4,
    }
    return Object.prototype.hasOwnProperty.call(mapping, cleaned) ? mapping[cleaned]! : null
  }

  private normalizeSelectionText(value: string): string {
    return value.replace(/[\s:：-]/g, '').toLowerCase()
  }

  private mergePendingCollectedInput(collectedUserInput: string, userInput: string): string {
    const normalizedFollowUp = userInput.trim()
    if (!normalizedFollowUp) return collectedUserInput
    if (collectedUserInput.includes(normalizedFollowUp)) return collectedUserInput
    return `${collectedUserInput}，补充说明：${normalizedFollowUp}`
  }

  private async tryContinuePendingAtomicClarification(input: RuntimeSubmitInput): Promise<RuntimeDecision | null> {
    const pending = input.pendingAtomicClarification
    if (!pending) return null
    if (this.shouldBypassPendingAtomicClarification(input.userInput)) return null
    const sourcePendingContext = input.pendingAtomicContext ?? buildPendingAtomicContextFromClarification(pending)

    const mergedUserInput = this.mergeAtomicClarificationInput(pending, input.userInput)
    const mergedInput: RuntimeSubmitInput = {
      ...input,
      userInput: mergedUserInput,
      pendingAtomicClarification: null,
    }
    const context = buildDialogueContext({ scheduleState: mergedInput.scheduleState, userInput: mergedInput.userInput, currentSchedule: mergedInput.currentSchedule })
    const recognized = await this.intentRecognizer.recognize(context)
    const recognizedAction = this.asRuntimeAtomicAction(recognized.type)
    const fallbackIntent = pending.action
      ? {
          type: pending.action,
          confidence: 0.6,
          reasoning: recognized.reasoning || pending.reasoning,
        } satisfies MicroEditIntent
      : null
    const intent = recognizedAction ? recognized : fallbackIntent

    if (!intent || !this.asRuntimeAtomicAction(intent.type)) {
      return this.buildPendingAtomicClarificationDecision(
        this.buildPendingAtomicClarification({
          ...mergedInput,
          userInput: mergedUserInput,
          pendingAtomicClarification: pending,
        }, recognized.reasoning || pending.reasoning, pending.action),
        recognized.reasoning || pending.reasoning,
        undefined,
        sourcePendingContext,
      )
    }

    const result = await this.buildMicroEditCommand(mergedInput, intent.reasoning || pending.reasoning, intent)
    if (result.command || result.pendingTargetSelection || result.pendingInsertRecommendation) {
      return this.buildMicroEditDecision(result, intent.reasoning || pending.reasoning, sourcePendingContext)
    }

    if (this.shouldStayInAtomicClarification(result.message)) {
      return this.buildPendingAtomicClarificationDecision(
        this.buildPendingAtomicClarification({
          ...mergedInput,
          userInput: mergedUserInput,
          pendingAtomicClarification: pending,
        }, result.explanation || intent.reasoning || pending.reasoning, pending.action),
        result.explanation || intent.reasoning || pending.reasoning,
        result.message,
        sourcePendingContext,
      )
    }

    return this.buildMicroEditDecision(result, intent.reasoning || pending.reasoning, sourcePendingContext)
  }

  private async tryHandleAtomicInstruction(input: RuntimeSubmitInput): Promise<RuntimeDecision | null> {
    if (input.currentLayoutDraft && this.shouldRouteToLayoutDraftRefine(input.userInput)) return null
    if (!this.shouldAttemptAtomicInstruction(input.userInput)) return null
    const context = buildDialogueContext({ scheduleState: input.scheduleState, userInput: input.userInput, currentSchedule: input.currentSchedule })
    const recognizedIntent = await this.intentRecognizer.recognize(context)
    const recognizedAction = this.asRuntimeAtomicAction(recognizedIntent?.type)
    const detectedAction = this.detectAtomicAction(input.userInput.replace(/\s+/g, ''))
    const fallbackIntent = detectedAction
      ? {
          type: detectedAction,
          confidence: 0.55,
          reasoning: recognizedIntent?.reasoning || `fallback:${detectedAction}`,
        } satisfies MicroEditIntent
      : null
    const intent = recognizedAction ? recognizedIntent : fallbackIntent
    if (!intent || !this.asRuntimeAtomicAction(intent.type)) return null

    const result = await this.buildMicroEditCommand(input, intent.reasoning, intent)
    return this.buildMicroEditDecisionWithContinuationFallback(
      input,
      result,
      intent.reasoning,
      this.asRuntimeAtomicAction(intent.type),
    )
  }

  private shouldAttemptAtomicInstruction(userInput: string): boolean {
    const normalized = userInput.replace(/\s+/g, '')
    if (!/(插入|插个|插一|加一条|加一档|加个|加一段|加一些|添加节目|安排节目|来个|来一条|来一档|放个|放一段|上个|上点|上一段|垫点|垫一点|垫一段|垫一条|补点|补一段|推荐(?:几个|几条|几档)?|找(?:几个|几条|几档)?|查(?:几个|几条|几档)?|有没有(?:适合|可用|候选)|删除|删掉|移除|去掉|撤掉|拿掉|移动|后移|前移|顺延|延后|提前|往后挪|往前挪|替换|换成|换掉|替换成|替换为|改成|改为)/.test(normalized)) return false
    const hasExactTime = Boolean(parseAtomicClockExpression(normalized))
    const hasExplicitAtomicVerb = /(插入|插个|插一|加一条|加一档|加个|加一段|加一些|添加节目|添加|放个|放一段|上个|上点|上一段|垫点|垫一点|垫一段|垫一条|补点|补一段|推荐(?:几个|几条|几档)?|找(?:几个|几条|几档)?|查(?:几个|几条|几档)?|有没有(?:适合|可用|候选)|删除|删掉|移除|去掉|撤掉|拿掉|移动|后移|前移|顺延|延后|提前|往后挪|往前挪|替换|换成|换掉|替换成|替换为|改成|改为)/.test(normalized)
    const hasStrongAtomicVerb = /(插入|插个|插一|添加节目|添加|推荐(?:几个|几条|几档)?|找(?:几个|几条|几档)?|查(?:几个|几条|几档)?|有没有(?:适合|可用|候选)|删除|删掉|移除|去掉|撤掉|拿掉|移动|后移|前移|顺延|延后|提前|往后挪|往前挪|替换|换成|换掉|替换成|替换为|改成|改为)/.test(normalized)
    const hasSchedulingDeliverableCue = /(轮播单|直播单|播单|节目单|编排单|串联单|排单|版面|一版|一份)/.test(normalized)
    const hasRelativeInsertAnchor = Boolean(this.extractRelativeInsertAnchor(userInput))
    if (hasRelativeInsertAnchor) return true
    if (looksLikeProgramSchedulingRequest(userInput) && !hasExactTime && !hasStrongAtomicVerb) {
      return false
    }
    if (
      looksLikeProgramSchedulingRequest(userInput)
      && !hasExplicitAtomicVerb
      && (!hasExactTime || hasSchedulingDeliverableCue)
    ) {
      return false
    }
    const hasQuotedTitle = /《[^》]+》/.test(normalized)
    const hasBroadScope = /(全天|整天|全日|上午|中午|午间|下午|晚间|晚上|夜间|深夜|凌晨|全部|都|统一|整体)/.test(normalized)
    const hasLayoutCue = /(版面|栏目|剧场|时段)/.test(normalized)
    const detectedAction = this.detectAtomicAction(normalized)
    const hasNonInsertProgramAnchor = Boolean(
      detectedAction && detectedAction !== 'insert' && this.extractAtomicProgramHint(userInput, detectedAction),
    )
    return !((hasBroadScope || hasLayoutCue) && !hasExactTime && !hasQuotedTitle && !hasNonInsertProgramAnchor)
  }

  private shouldRouteToLayoutDraftRefine(userInput: string): boolean {
    const normalized = userInput.replace(/\s+/g, '')
    const hasDraftCue = /(草案|版面草案|当前版面|版面|时段)/.test(normalized)
    const hasDraftRefineVerb = /(删除|删掉|移除|去掉|撤掉|拿掉|替换|换成|换掉|替换成|替换为|改成|改为|调整为)/.test(normalized)
    const hasTimeOrDaypartCue = Boolean(parseAtomicClockExpression(normalized))
      || /(全天|整天|全日|上午|中午|午间|下午|晚间|晚上|夜间|深夜|凌晨)/.test(normalized)
    return hasDraftRefineVerb && (hasDraftCue || hasTimeOrDaypartCue)
  }

  private tryHandleBatchRangeInstruction(input: RuntimeSubmitInput): RuntimeDecision | null {
    const normalized = input.userInput.replace(/\s+/g, '')
    const action = this.detectBatchRangeAction(normalized)
    if (!action) return null

    const range = this.extractBatchRange(normalized)
    if (!range) return null

    const matchedItems = this.findItemsFullyInsideRange(input.currentSchedule, range)
    const offset = action === 'move'
      ? this.extractAtomicOffsetSlot(input.userInput)
      : null

    if (action === 'move' && !offset) {
      return {
        kind: 'message',
        feedback: createFeedback(
          `已识别为 ${range.start}-${range.end} 范围内节目的批量平移，但还缺少移动幅度，例如“整体后移5分钟”。`,
          'execution',
          '批量预演',
          {
            explanation: '范围批量平移必须先生成可确认的预演，不能拆成不可见的单条移动命令。',
            details: {
              actionType: 'batch_move',
              scope: range,
              matchedCount: matchedItems.length,
              matchedItems: matchedItems.map(asRuntimeItem),
              isExecutable: false,
              validation: {
                status: 'missing_offset',
                message: '缺少整体前移或后移的时间幅度。',
              },
            },
          },
        ),
      }
    }

    if (matchedItems.length === 0) {
      return {
        kind: 'message',
        feedback: createFeedback(
          `当前 ${range.start}-${range.end} 范围内没有可批量${action === 'delete' ? '删除' : '平移'}的已编排节目。`,
          'execution',
          '批量预演',
          {
            explanation: '范围批量命令已被识别，但命中集合为空，因此不能生成可执行批量处理文件。',
            details: {
              actionType: action === 'delete' ? 'batch_delete' : 'batch_move',
              scope: range,
              matchedCount: 0,
              matchedItems: [],
              isExecutable: false,
              validation: {
                status: 'empty_scope',
                message: '当前范围内没有命中的节目。',
              },
            },
          },
        ),
      }
    }

    const operations = action === 'delete'
      ? matchedItems.map((item) => ({
          action: 'delete',
          itemId: item.id,
          programName: item.programName,
          sourceTimeRange: { start: toClockText(item.startTime), end: toClockText(item.endTime) },
        }))
      : matchedItems.map((item) => {
          const shift = offset!.direction === 'backward' ? -Math.abs(offset!.offsetSeconds) : Math.abs(offset!.offsetSeconds)
          const newStartTime = offsetDateTime(normalizeDateTime(input.scheduleState.date, item.startTime), shift)
          const newEndTime = offsetDateTime(normalizeDateTime(input.scheduleState.date, item.endTime), shift)
          return {
            action: 'move',
            itemId: item.id,
            programName: item.programName,
            sourceTimeRange: { start: toClockText(item.startTime), end: toClockText(item.endTime) },
            proposedTimeRange: { start: toClockText(newStartTime), end: toClockText(newEndTime) },
          }
        })
    const commands: OrchestrationCommand[] = action === 'delete'
      ? matchedItems.map((item): DeleteCommand => ({
          action: 'delete',
          reasoning: '范围批量删除预演确认后执行。',
          data: { itemId: item.id },
        }))
      : matchedItems.map((item): MoveCommand => {
          const shift = offset!.direction === 'backward' ? -Math.abs(offset!.offsetSeconds) : Math.abs(offset!.offsetSeconds)
          const newStartTime = offsetDateTime(normalizeDateTime(input.scheduleState.date, item.startTime), shift)
          return {
            action: 'move',
            reasoning: '范围批量平移预演确认后执行。',
            data: { itemId: item.id, newStartTime },
          }
        })

    if (action === 'move') {
      const validation = this.validateBatchMovePreview(input, range, matchedItems, operations)
      if (!validation.ok) {
        return {
          kind: 'message',
          feedback: createFeedback(
            `已生成 ${range.start}-${range.end} 的批量平移预演，但发现 ${validation.issues.length} 个风险，暂不能执行。`,
            'execution',
            '批量预演',
            {
              explanation: '批量平移在确认前必须通过范围外冲突和播出边界校验。',
              details: {
                fileId: `batch-preview:${input.scheduleState.date}:${range.start}-${range.end}:${action}`,
                actionType: 'batch_move',
                scope: range,
                matchedCount: matchedItems.length,
                matchedItems: matchedItems.map(asRuntimeItem),
                operations,
                previewSummary: {
                  affectedRange: range,
                  actionText: `整体${offset!.direction === 'backward' ? '前移' : '后移'}${this.formatAtomicOffset(offset!.offsetSeconds)}`,
                  operationCount: operations.length,
                },
                validation: {
                  status: 'blocked',
                  issues: validation.issues,
                },
                isExecutable: false,
              },
            },
          ),
        }
      }
    }

    const actionText = action === 'delete'
      ? '批量删除'
      : `整体${offset!.direction === 'backward' ? '前移' : '后移'}${this.formatAtomicOffset(offset!.offsetSeconds)}`

    const pendingCommand: RuntimePendingCommand = {
      command: commands[0]!,
      commands,
      summary: `${range.start}-${range.end} ${actionText} ${matchedItems.length} 条节目`,
      successMessage: `已完成 ${range.start}-${range.end} ${matchedItems.length} 条节目的${actionText}。`,
      reasoning: '范围批量命令需要先预演并确认，再统一执行。',
      details: {
        fileId: `batch-preview:${input.scheduleState.date}:${range.start}-${range.end}:${action}`,
        actionType: action === 'delete' ? 'batch_delete' : 'batch_move',
        scope: range,
        matchedCount: matchedItems.length,
        matchedItems: matchedItems.map(asRuntimeItem),
        operations,
        previewSummary: {
          affectedRange: range,
          actionText,
          operationCount: operations.length,
        },
        validation: {
          status: 'passed',
          message: '预演校验通过，等待用户确认后执行。',
        },
        isExecutable: true,
      },
    }

    return {
      kind: 'pending_command',
      feedback: createFeedback(
        `已生成 ${range.start}-${range.end} 的${actionText}预演，命中 ${matchedItems.length} 条节目。请确认后执行批量处理。`,
        'execution',
        '待确认修改',
        {
          explanation: '范围批量命令需要先展示批量处理文件和预演结果，避免静默修改多条节目。',
          details: pendingCommand.details,
        },
      ),
      pendingCommand,
    }
  }

  private validateBatchMovePreview(
    input: RuntimeSubmitInput,
    range: { start: string; end: string },
    matchedItems: RuntimeScheduleItem[],
    operations: Array<Record<string, unknown>>,
  ): { ok: boolean; issues: string[] } {
    const issues: string[] = []
    const window = resolveBroadcastWindow(input.scheduleState.channelId, input.scheduleState.date)
    const windowStart = clockToSeconds(window.start)
    const windowEnd = clockToSeconds(window.end)
    const matchedIds = new Set(matchedItems.map((item) => item.id))
    const proposedRanges = operations
      .map((operation) => ({
        itemId: String(operation.itemId ?? ''),
        programName: String(operation.programName ?? ''),
        range: operation.proposedTimeRange as { start: string; end: string } | undefined,
      }))
      .filter((item): item is { itemId: string; programName: string; range: { start: string; end: string } } => Boolean(item.range))

    for (const proposed of proposedRanges) {
      const proposedStart = clockToSeconds(proposed.range.start)
      const proposedEnd = clockToSeconds(proposed.range.end)
      if (proposedStart < windowStart || proposedEnd > windowEnd || proposedEnd <= proposedStart) {
        issues.push(`《${proposed.programName || proposed.itemId}》平移后超出编单时间范围 ${window.start}-${window.end}`)
      }
    }

    for (let index = 0; index < proposedRanges.length; index += 1) {
      const current = proposedRanges[index]!
      const currentStart = clockToSeconds(current.range.start)
      const currentEnd = clockToSeconds(current.range.end)
      for (const next of proposedRanges.slice(index + 1)) {
        if (currentStart < clockToSeconds(next.range.end) && currentEnd > clockToSeconds(next.range.start)) {
          issues.push(`批量平移后《${current.programName || current.itemId}》与《${next.programName || next.itemId}》发生重叠`)
        }
      }
    }

    const outsideItems = input.currentSchedule.filter((item) => !matchedIds.has(item.id))
    for (const proposed of proposedRanges) {
      const proposedStart = clockToSeconds(proposed.range.start)
      const proposedEnd = clockToSeconds(proposed.range.end)
      for (const item of outsideItems) {
        const outsideStart = clockToSeconds(item.startTime)
        const outsideEnd = clockToSeconds(item.endTime)
        if (proposedStart < outsideEnd && proposedEnd > outsideStart) {
          issues.push(`批量平移后《${proposed.programName || proposed.itemId}》将与范围外节目《${item.programName || item.id}》重叠`)
        }
      }
    }

    return { ok: issues.length === 0, issues }
  }

  private detectBatchRangeAction(normalized: string): 'delete' | 'move' | null {
    const hasBatchCue = /(全部|所有|整体|批量|一并|一起|整段|范围内|这段里|这段的|已排节目|已编排|现有.*节目)/.test(normalized)
    if (!hasBatchCue) return null
    if (/(删除|删掉|移除|去掉|撤掉|拿掉|清掉|清除)/.test(normalized)) return 'delete'
    if (/(整体)?(后移|前移|顺延|延后|提前|往后挪|往前挪|平移|移动)/.test(normalized)) return 'move'
    return null
  }

  private extractBatchRange(normalized: string): { start: string; end: string } | null {
    const explicitRange = this.extractExplicitAtomicTimeRange(normalized)
    if (explicitRange) return explicitRange

    if (/上午/.test(normalized)) return { start: '06:00:00', end: '12:00:00' }
    if (/(中午|午间)/.test(normalized)) return { start: '12:00:00', end: '14:00:00' }
    if (/下午/.test(normalized)) return { start: '13:00:00', end: '18:00:00' }
    if (/(晚间|晚上|夜间)/.test(normalized)) return { start: '18:00:00', end: '23:00:00' }
    if (/(全天|整天|全日)/.test(normalized)) return { start: '06:00:00', end: '23:59:59' }
    return null
  }

  private findItemsFullyInsideRange(
    items: RuntimeScheduleItem[],
    range: { start: string; end: string },
  ): RuntimeScheduleItem[] {
    const rangeStart = clockToSeconds(range.start)
    const rangeEnd = clockToSeconds(range.end)
    return [...items]
      .filter((item) => {
        const itemStart = clockToSeconds(item.startTime)
        const itemEnd = clockToSeconds(item.endTime)
        return itemStart >= rangeStart && itemEnd <= rangeEnd
      })
      .sort((a, b) => clockToSeconds(a.startTime) - clockToSeconds(b.startTime))
  }

  private tryClearLayoutDraft(input: RuntimeSubmitInput): RuntimeDecision | null {
    if (!input.currentLayoutDraft) return null
    const normalized = input.userInput.replace(/\s+/g, '')
    const isClearDraftIntent = /^(不要|不用|取消|清掉|清除|删除|删掉|放弃|先不用|先不要)(这个|当前|刚才的|原来的)?(版面草案|草案|版面)$/.test(normalized)
      || /^(这个|当前|刚才的|原来的)?(版面草案|草案|版面)(不要了|不用了|取消掉|删掉|删除|清掉|清除|放弃)$/.test(normalized)
      || /^(先)?不用这个版面(了)?$/.test(normalized)
    if (!isClearDraftIntent) return null
    return {
      kind: 'layout_draft_clear',
      feedback: createFeedback(
        '已取消当前待确认版面草案。你可以重新描述版面需求，或继续上传/选择新的版面参考。',
        'planning',
        '已取消',
        {
          explanation: '用户明确表示放弃当前待确认版面草案，因此清空草案上下文，不再进入编排确认或草案微调。',
          details: {
            draftId: input.currentLayoutDraft.id,
            layoutSource: input.currentLayoutDraft.source,
            coverage: input.currentLayoutDraft.coverage,
          },
        },
      ),
    }
  }

  private shouldBypassPendingAtomicClarification(userInput: string): boolean {
    const normalized = userInput.replace(/\s+/g, '')
    if (/(按这个版面开始编排|按该版面开始编排|确认版面|采用这个版面|用这个版面编排|就按这个版面|就按这个草案|按这个版面|按这个草案|照这个版面|照这个草案|这个版面可以|这个草案可以|可以开始编排|没问题开始编排)/.test(normalized)) return true
    if (/(帮我全天编排|全天编排|整天编排|帮我填充全天节目|填充全天节目|补齐当前所有空窗|补齐当前空窗|补齐空窗|补齐当前所有空缺|补齐当前空缺)/.test(normalized)) return true
    if (/(版面|栏目|剧场|时段|上午|中午|午间|下午|晚间|晚上|夜间|深夜|凌晨|全天|整天|全日)/.test(normalized)) return true
    return /(\d{1,2}(?::\d{2})?点?.*)(到|至|-).*(\d{1,2}(?::\d{2})?点?)/.test(normalized)
      && /(新闻|栏目|剧场|电视剧|综艺|专题|资讯|纪录片|纪实|少儿|动画)/.test(normalized)
  }

  private mergeAtomicClarificationInput(pending: RuntimePendingAtomicClarification, userInput: string): string {
    return this.mergePendingCollectedInput(pending.collectedUserInput, userInput)
  }

  private asRuntimeAtomicAction(type?: MicroEditIntent['type']): RuntimeAtomicAction | null {
    return type && ['insert', 'move', 'delete', 'replace'].includes(type) ? type as RuntimeAtomicAction : null
  }

  private classifyFastSystemIntent(userInput: string): TaskClassification | null {
    const normalized = userInput.replace(/\s+/g, '')
    const hasScheduleTarget = /(节目单|编排单|串联单|播单|编单|单子|这张单|这份单|排期|播出表|当前编排|节目编排|版面编排|当前版面|编排情况|当前)/.test(normalized)
    const hasProblemCue = /(问题|异常|冲突|风险|重叠|撞播|空窗|空缺|断档|缺口|时长不对|非法时间|负时长|素材缺失|素材为空|未关联)/.test(normalized)
    const hasFillCue = /(补齐|补上|补掉|补排|填充|填满|排满).*(空窗|空缺|缺口|节目)|(空窗|空缺|缺口).*(补齐|补上|补掉|补排|填充|填满|排满)/.test(normalized)

    const hasAnalysisVerb = /(分析|评估|研判|诊断|梳理|复盘|报告|编辑视角|业务分析|业务视角|编导视角)/.test(normalized)
    const hasAnalysisTarget = /(当前版面|版面编排|当前编排|当前节目单|节目单编排|节目编排|编排情况|播单|编排单|串联单)/.test(normalized)
    if (hasAnalysisVerb && hasAnalysisTarget) {
      return {
        mode: 'layout_analysis',
        confidence: 0.94,
        reasoning: '规则快速识别到用户需要分析当前编排，应直接进入编排分析流程。',
      }
    }

    const hasRepairVerb = /(修复|修正|改正|解决|处理问题|自动修复|修一下|修一修|修掉|消掉|处理掉)/.test(normalized)
    const hasRepairTarget = /(节目单|编排|版面|播单|单子|问题|异常|冲突|风险|重叠|撞播|空窗|空缺|断档|缺口)/.test(normalized)
    if (hasRepairVerb && hasRepairTarget) {
      return {
        mode: 'validate_only',
        confidence: 0.88,
        reasoning: '规则快速识别到用户提出修复诉求，当前流程先输出问题分析结果。',
      }
    }

    const hasValidationVerb = /(校验|检查|验证|核对|审查|体检|查看问题|看看问题|有没有问题|有无问题|有没有.*(问题|空窗|空缺|冲突|重叠|风险|断档)|有无.*(问题|空窗|空缺|冲突|重叠|风险|断档)|找出问题|排查问题|查问题|查一下|查查|看看|看一下|冲突|风险|重叠|断档)/.test(normalized)
    if (!hasFillCue && hasValidationVerb && (hasScheduleTarget || hasProblemCue)) {
      return {
        mode: 'validate_only',
        confidence: 0.9,
        reasoning: '规则快速识别到用户需要校验或检查当前编排问题。',
      }
    }

    return null
  }

  private buildPendingAtomicClarification(input: RuntimeSubmitInput, reasoning: string, preferredAction?: RuntimeAtomicAction | null): RuntimePendingAtomicClarification {
    const normalized = input.userInput.replace(/\s+/g, '')
    const action = preferredAction ?? this.detectAtomicAction(normalized)
    const slots = mergeRuntimeAtomicSlots(
      input.pendingAtomicClarification?.slots ?? {},
      this.extractAtomicSlotHints(input.userInput, action),
    )
    const targetTimeHint = slots.targetTimeHint ?? slots.targetTime
    const programNameHint = slots.programName ?? slots.rawProgramText
    const runtimeMissingFields = action
      ? deriveAtomicMissingFieldsFromSlots(action, slots)
      : ['target_time'] satisfies RuntimeAtomicMissingField[]
    const missingFields = this.mapAtomicMissingFieldsToLegacy(runtimeMissingFields)
    const followUpQuestion = this.buildAtomicClarificationPrompt(action, {
      targetTimeHint,
      programNameHint,
      replacementProgramName: slots.replacementProgramName,
      direction: slots.direction,
      offsetSeconds: slots.offsetSeconds,
      missingFields,
    })
    const summaryTarget = targetTimeHint || programNameHint || '当前目标节目'
    return {
      action,
      summary: action ? `请补充${summaryTarget}的${this.describeAtomicAction(action)}参数` : '请补充节目调整参数',
      reasoning,
      originalUserInput: input.pendingAtomicClarification?.originalUserInput ?? input.userInput,
      collectedUserInput: input.userInput,
      targetTimeHint,
      programNameHint,
      slots,
      missingFields,
      followUpQuestion,
    }
  }

  private buildPendingAtomicClarificationDecision(
    pending: RuntimePendingAtomicClarification,
    explanation?: string,
    contentOverride?: string,
    sourcePendingContext?: RuntimePendingAtomicContext,
  ): RuntimeDecision {
    const pendingAtomicContext = buildPendingAtomicContextFromClarification(
      pending,
      undefined,
      sourcePendingContext ? {
        originalUserInput: sourcePendingContext.originalUserInput,
        collectedUserInput: sourcePendingContext.collectedUserInput,
        slots: sourcePendingContext.slots,
        attemptCount: sourcePendingContext.attemptCount,
        createdAt: sourcePendingContext.createdAt,
        expiresAt: sourcePendingContext.expiresAt,
      } : undefined,
    )
    return this.buildPendingAtomicContextDecision(
      pendingAtomicContext,
      this.buildAtomicFallbackFeedback(pending, contentOverride ?? pending.followUpQuestion, explanation),
    )
  }

  private buildPendingTargetSelectionDecision(
    pending: RuntimePendingTargetSelection,
    contentOverride?: string,
    sourcePendingContext?: RuntimePendingAtomicContext,
  ): RuntimeDecision {
    const pendingAtomicContext = buildPendingAtomicContextFromTargetSelection(
      pending,
      undefined,
      sourcePendingContext ? {
        originalUserInput: sourcePendingContext.originalUserInput,
        collectedUserInput: sourcePendingContext.collectedUserInput,
        slots: sourcePendingContext.slots,
        attemptCount: sourcePendingContext.attemptCount,
        createdAt: sourcePendingContext.createdAt,
        expiresAt: sourcePendingContext.expiresAt,
      } : undefined,
    )
    return this.buildPendingAtomicContextDecision(
      pendingAtomicContext,
      createFeedback(
        contentOverride ?? pending.summary,
        'selection',
        '待选择目标',
        {
          explanation: pending.reasoning,
          details: {
            targetTime: pending.targetTime,
            candidateCount: pending.candidates.length,
          },
        },
      ),
    )
  }

  private buildPendingInsertRecommendationDecision(
    pending: RuntimePendingInsertRecommendation,
    contentOverride?: string,
    sourcePendingContext?: RuntimePendingAtomicContext,
  ): RuntimeDecision {
    const pendingAtomicContext = buildPendingAtomicContextFromInsertRecommendation(
      pending,
      undefined,
      sourcePendingContext ? {
        originalUserInput: sourcePendingContext.originalUserInput,
        collectedUserInput: sourcePendingContext.collectedUserInput,
        slots: sourcePendingContext.slots,
        attemptCount: sourcePendingContext.attemptCount,
        createdAt: sourcePendingContext.createdAt,
        expiresAt: sourcePendingContext.expiresAt,
      } : undefined,
    )
    return this.buildPendingAtomicContextDecision(
      pendingAtomicContext,
      createFeedback(
        contentOverride ?? pending.summary,
        'selection',
        '插入推荐',
        {
          explanation: pending.reasoning,
          details: {
            targetTime: pending.targetTime,
            recommendedCandidateCount: pending.recommendedCandidates.length,
          },
        },
      ),
    )
  }

  private buildPendingAtomicContextDecision(
    pendingAtomicContext: RuntimePendingAtomicContext,
    feedback?: RuntimeFeedback,
  ): RuntimeDecision {
    const lifecycleContext = this.pendingAtomicContextService.initialize(pendingAtomicContext)
    return {
      kind: 'pending_atomic_context',
      feedback: feedback ?? createFeedback(
        lifecycleContext.followUpQuestion,
        'selection',
        this.describeAtomicPhaseProcessLabel(lifecycleContext.phase),
        {
          explanation: lifecycleContext.reasoning,
          details: {
            action: lifecycleContext.action,
            phase: lifecycleContext.phase,
            missingFields: lifecycleContext.missingFields,
            attemptCount: lifecycleContext.attemptCount,
          },
        },
      ),
      pendingAtomicContext: lifecycleContext,
    }
  }

  private patchPendingAtomicContext(
    pendingContext: RuntimePendingAtomicContext,
    slotPatch: Partial<RuntimePendingAtomicContext['slots']>,
    followUpUserInput: string,
  ): RuntimePendingAtomicContext {
    return this.pendingAtomicContextService.touch(pendingContext, {
      collectedUserInput: this.mergePendingCollectedInput(pendingContext.collectedUserInput, followUpUserInput),
      slots: mergeRuntimeAtomicSlots(pendingContext.slots, slotPatch),
    })
  }

  private refreshClarifyingPendingAtomicContext(pendingContext: RuntimePendingAtomicContext): RuntimePendingAtomicContext {
    const targetTimeHint = pendingContext.slots.targetTimeHint ?? pendingContext.slots.targetTime
    const programNameHint = pendingContext.slots.programName ?? pendingContext.slots.rawProgramText
    const missingFields = deriveAtomicMissingFieldsFromSlots(pendingContext.action, pendingContext.slots)
    const followUpQuestion = this.buildAtomicClarificationPrompt(
      pendingContext.action,
      {
        targetTimeHint,
        programNameHint,
        replacementProgramName: pendingContext.slots.replacementProgramName,
        direction: pendingContext.slots.direction,
        offsetSeconds: pendingContext.slots.offsetSeconds,
        missingFields: this.mapAtomicMissingFieldsToLegacy(missingFields),
      },
    )
    const summaryTarget = targetTimeHint || programNameHint || '当前目标节目'

    return this.pendingAtomicContextService.recordAttempt(pendingContext, {
      summary: pendingContext.action ? `请补充${summaryTarget}的${this.describeAtomicAction(pendingContext.action)}参数` : '请补充节目调整参数',
      slots: {
        ...pendingContext.slots,
        targetTimeHint,
      },
      missingFields,
      followUpQuestion,
    })
  }

  private buildCanonicalAtomicInstruction(pendingContext: RuntimePendingAtomicContext): string {
    const targetTimeText = pendingContext.slots.targetTime ?? pendingContext.slots.targetTimeHint ?? ''
    const targetProgram = pendingContext.slots.programName ?? pendingContext.slots.rawProgramText ?? ''
    const replacementProgramName = pendingContext.slots.replacementProgramName ?? ''
    switch (pendingContext.action) {
      case 'delete':
        return `删除${targetTimeText}${targetProgram ? `的《${targetProgram}》` : '的节目'}`
      case 'move': {
        const directionText = pendingContext.slots.direction === 'backward' ? '前移' : '后移'
        const offsetText = this.formatAtomicOffset(pendingContext.slots.offsetSeconds)
        return `把${targetTimeText}${targetProgram ? `的《${targetProgram}》` : '的节目'}${directionText}${offsetText}`
      }
      case 'replace':
        return `把${targetTimeText}${targetProgram ? `的《${targetProgram}》` : '的节目'}替换成《${replacementProgramName}》`
      case 'insert': {
        const programText = pendingContext.slots.programName
          ?? pendingContext.slots.rawProgramText
          ?? pendingContext.slots.semanticLabel
          ?? '节目'
        return `在${targetTimeText}插入节目${programText}`
      }
      default:
        return pendingContext.collectedUserInput
    }
  }

  private formatAtomicOffset(offsetSeconds?: number): string {
    if (typeof offsetSeconds !== 'number' || offsetSeconds <= 0) return '30分钟'
    if (offsetSeconds % 3600 === 0) return `${offsetSeconds / 3600}小时`
    if (offsetSeconds % 60 === 0) return `${offsetSeconds / 60}分钟`
    return `${offsetSeconds}秒`
  }

  private mapAtomicMissingFieldsToLegacy(missingFields: RuntimeAtomicMissingField[]): string[] {
    return missingFields.map((field) => {
      switch (field) {
        case 'target_time':
          return 'target'
        case 'program_name':
          return 'program'
        case 'replacement_program':
          return 'replacement'
        case 'direction':
        case 'offset':
          return 'offset'
        default:
          return 'target'
      }
    })
  }

  private describeAtomicPhaseProcessLabel(phase: RuntimePendingAtomicContext['phase']): string {
    switch (phase) {
      case 'clarifying':
        return '原子参数澄清'
      case 'selecting_target':
        return '待选择目标'
      case 'recommending_insert':
        return '插入推荐'
    }
  }

  private detectAtomicAction(normalized: string): RuntimeAtomicAction | null {
    if (/(后移|前移|移动|顺一下|顺一个|挪一下|往后挪|往前挪|顺延|延后|提前)/.test(normalized)) return 'move'
    if (/(删除|删掉|移除|去掉|撤掉|拿掉)/.test(normalized)) return 'delete'
    if (/(替换|换成|替换成|替换为|换掉|改掉|改成|改为)/.test(normalized)) return 'replace'
    if (/(插入|插个|插一|加一条|加一档|加个|加一段|加一些|添加节目|添加|安排节目|安排|来个|来一条|来一档|放个|放一段|上个|上点|上一段|垫点|垫一点|垫一段|垫一条|补点|补一段|推荐(?:几个|几条|几档)?|找(?:几个|几条|几档)?|查(?:几个|几条|几档)?|有没有(?:适合|可用|候选))/.test(normalized)) return 'insert'
    return null
  }

  private extractAtomicSlotHints(userInput: string, action: RuntimeAtomicAction | null): Partial<RuntimeAtomicSlotBag> {
    const slots: Partial<RuntimeAtomicSlotBag> = {}
    const timeSlot = this.extractAtomicTimeSlot(userInput)
    if (timeSlot) {
      slots.targetTime = timeSlot.targetTime
      slots.targetTimeHint = timeSlot.targetTimeHint
    }

    const programNameHint = this.extractAtomicProgramHint(userInput, action)
    if (programNameHint) {
      slots.programName = programNameHint
      if (action === 'insert') {
        slots.rawProgramText = programNameHint
      }
    }

    if (action === 'move') {
      const offsetSlot = this.extractAtomicOffsetSlot(userInput)
      if (offsetSlot) {
        slots.direction = offsetSlot.direction
        slots.offsetSeconds = offsetSlot.offsetSeconds
      } else {
        const directionHint = this.extractAtomicDirectionHint(userInput)
        if (directionHint) {
          slots.direction = directionHint
        }
      }
    }

    if (action === 'replace') {
      const replacementProgramName = this.extractAtomicReplacementProgramName(userInput)
      if (replacementProgramName) {
        slots.replacementProgramName = replacementProgramName
      }
    }

    return slots
  }

  private extractAtomicTimeSlot(userInput: string): { targetTime: string; targetTimeHint: string } | null {
    const parsed = parseAtomicClockExpression(userInput)
    return parsed
      ? { targetTime: parsed.targetTime, targetTimeHint: parsed.matchedText }
      : null
  }

  private extractAtomicTimeHint(userInput: string): string | undefined {
    const match = userInput.match(/(\d{1,2})(点半|点(\d{1,2})分?|点|[:：]\d{2})/)
    return match?.[0]
  }

  private extractQuotedProgramName(userInput: string): string | undefined {
    const match = userInput.match(/《([^》]+)》/)
    return match?.[1]?.trim()
  }

  private extractAtomicProgramHint(userInput: string, action: RuntimeAtomicAction | null): string | undefined {
    const quotedProgramName = this.extractQuotedProgramName(userInput)
    if (quotedProgramName) return quotedProgramName

    switch (action) {
      case 'insert':
        return this.extractAtomicProgramHintFromPatterns(userInput, [
          /(?:插入节目|插入|插个|插一|加一条|加一档|加个|加一段|加一些|添加节目|添加|安排节目|安排|来个|来一条|来一档|放个|放一段|上个|上点|上一段|垫点|垫一点|垫一段|垫一条|补点|补一段|推荐(?:几个|几条|几档)?|找(?:几个|几条|几档)?|查(?:几个|几条|几档)?|有没有(?:适合|可用|候选)(?:的)?)(.+)$/u,
        ])
      case 'delete':
        return this.extractAtomicProgramHintFromPatterns(userInput, [
          /(?:删除|删掉|移除|去掉|撤掉|拿掉)(.+)$/u,
          /把(.+?)(?:删除|删掉|移除|去掉|撤掉|拿掉)/u,
        ])
      case 'move':
        return this.extractAtomicProgramHintFromPatterns(userInput, [
          /把(.+?)(?:后移|前移|移动|顺一下|顺一个|挪一下|往后挪|往前挪|顺延|延后|提前)/u,
          /(.+?)(?:后移|前移|移动|顺一下|顺一个|挪一下|往后挪|往前挪|顺延|延后|提前)/u,
        ])
      case 'replace':
        return this.extractAtomicProgramHintFromPatterns(userInput, [
          /把(.+?)(?:替换成|替换为|换成|换掉|改掉|改成|改为)/u,
        ])
      default:
        return undefined
    }
  }

  private extractAtomicProgramHintFromPatterns(userInput: string, patterns: RegExp[]): string | undefined {
    for (const pattern of patterns) {
      const matched = pattern.exec(userInput)?.[1]?.trim()
      const normalized = this.normalizeAtomicProgramHint(matched)
      if (normalized) {
        return normalized
      }
    }
    return undefined
  }

  private extractAtomicReplacementProgramName(userInput: string): string | undefined {
    const explicitProgramName = userInput.match(
      /(?:替换成|替换为|换成|改成|改为)(.+)$/u,
    )?.[1]?.trim()
    return this.normalizeAtomicProgramHint(explicitProgramName)
  }

  private extractAtomicOffsetSlot(userInput: string): { direction: 'forward' | 'backward'; offsetSeconds: number } | null {
    return parseAtomicOffset(userInput)
  }

  private extractAtomicDirectionHint(userInput: string): 'forward' | 'backward' | undefined {
    const normalized = userInput.replace(/\s+/g, '')
    if (/(前移|提前|往前挪)/.test(normalized)) return 'backward'
    if (/(后移|延后|顺延|往后挪|顺一下|顺一个|挪一下)/.test(normalized)) return 'forward'
    return undefined
  }

  private normalizeAtomicTime(timeText: string): string | null {
    const match = timeText.match(/(\d{1,2})[:：]?(\d{2})?(?:[:：]?(\d{2}))?/)
    if (!match) return null

    const hours = (match[1] ?? '00').padStart(2, '0')
    const minutes = (match[2] ?? '00').padStart(2, '0')
    const seconds = (match[3] ?? '00').padStart(2, '0')
    return `${hours}:${minutes}:${seconds}`
  }

  private normalizeAtomicProgramHint(value?: string): string | undefined {
    if (!value) return undefined
    const normalized = value
      .replace(/^[，,：:\s]+/, '')
      .replace(/^(?:把|将|在|于)\s*/u, '')
      .replace(/^(?:当前节目单|当前编排|当前播单|当前编单|左侧节目单|左侧表|表里|单子里|节目单里|编排单里|播单里|已排节目|已经排的)(?:中|里|里的|内|上)?(?:的)?/u, '')
      .replace(/^(?:按节目名|按名称|名字叫|名称叫)(?:的)?/u, '')
      .replace(/^(?:\d{1,2}(?:[:：]\d{2})?|\d{1,2}点(?:半|\d{1,2}分?)?)(?:的)?/u, '')
      .replace(/[，。！？!?]/g, '')
      .replace(/^(?:的|节目名|节目|栏目|我要|我想要|想要|我想看|想看|要看|加一条|加一档|加个|加一段|来个|来一条|来一档|放个|放一段|上个|上点|上一段|垫点|垫一点|垫一段|垫一条|补点|补一段|推荐|找|查|有没有适合的?|有没有可用的?|有没有候选的?|这条|那条|这个|那个)+/, '')
      .replace(/(?:候选节目|候选|可选节目|可用节目)$/u, '')
      .replace(/(?:吧|呀|啊|呢)$/u, '')
      .trim()

    if (!normalized) return undefined
    if (/^\d{1,2}(?:[:：]\d{2})?$/.test(normalized)) return undefined
    if (/^\d{1,2}点(?:半|\d{1,2}分?)?$/.test(normalized)) return undefined
    if (/^(节目|栏目|这条|那条|这个节目|那个节目)$/.test(normalized)) return undefined
    return normalized
  }

  private buildAtomicClarificationPrompt(action: RuntimeAtomicAction | null, input: { targetTimeHint?: string; programNameHint?: string; replacementProgramName?: string; direction?: 'forward' | 'backward'; offsetSeconds?: number; missingFields: string[] }): string {
    if (action === 'move') {
      if (input.missingFields.includes('target') && input.missingFields.includes('offset')) return '这句话更像是在调整具体节目，但现在还缺少目标节目和移动幅度。请补充准确时间点或节目名称，以及前移/后移多久，例如“把 09:00 的《看东方》后移 30 分钟”。'
      if (input.missingFields.includes('target')) {
        const moveText = input.direction ? `${input.direction === 'backward' ? '前移' : '后移'}${this.formatAtomicOffset(input.offsetSeconds)}` : '移动'
        if (input.programNameHint) {
          return `已经识别到你想把《${input.programNameHint}》${moveText}，还缺少准确时间点，例如“把 09:00 的《${input.programNameHint}》${moveText}”。`
        }
        return '已经识别到你是在移动节目，但还缺少明确目标。请补充准确时间点或节目名称，例如“把 09:00 的《看东方》后移 30 分钟”。'
      }
      return `已经定位到 ${input.targetTimeHint || input.programNameHint || '目标节目'}，还需要你补充移动幅度，例如“后移 30 分钟”。`
    }
    if (action === 'delete') {
      if (input.programNameHint && input.missingFields.includes('target')) {
        return `已经识别到你想删除《${input.programNameHint}》，还缺少准确时间点，例如“删除 09:30 的《${input.programNameHint}》”。`
      }
      return '这句话更像是在删除某条已排节目。请补充准确时间点或节目名称，例如“删除 09:30 的《午间30分》”。'
    }
    if (action === 'replace') {
      if (input.missingFields.includes('target') && input.missingFields.includes('replacement')) return '这句话更像是在替换某条已排节目。请补充准确时间点或节目名称，以及要换成的新节目，例如“把 10:00 的《看东方》替换成《东方新闻》”。'
      if (input.missingFields.includes('target')) {
        if (input.programNameHint || input.replacementProgramName) {
          return `已经识别到你要把${input.programNameHint ? `《${input.programNameHint}》` : '当前节目'}替换成《${input.replacementProgramName ?? '新节目'}》，还缺少目标时间点，例如“把 10:00 的${input.programNameHint ? `《${input.programNameHint}》` : '节目'}替换成《${input.replacementProgramName ?? '新节目'}》”。`
        }
        return '已经识别到你是在替换节目，但还缺少准确的目标时间点或节目名称。'
      }
      return `已经定位到 ${input.targetTimeHint || input.programNameHint || '目标节目'}，还需要你补充替换后的新节目名称，例如“替换成《东方新闻》”。`
    }
    if (action === 'insert') {
      if (input.missingFields.includes('target') && input.missingFields.includes('program')) return '这句话更像是在插入节目。请补充目标时间点和节目名称，例如“在 09:00 插入《看东方》”。'
      if (input.missingFields.includes('target')) {
        return `已经识别到你想插入《${input.programNameHint || '节目'}》，还缺少目标时间点，例如“在 09:00 插入《${input.programNameHint || '看东方'}》”。`
      }
      return `已经定位到 ${input.targetTimeHint || '目标时间'}，还需要你补充节目名称，例如“在 ${input.targetTimeHint || '09:00'} 插入《看东方》”。`
    }
    return '这句话更像是在调整具体节目，但现在还不够形成可执行命令。请补充明确的时间点、节目名称或动作，例如“把 09:00 的《看东方》后移 30 分钟”。'
  }

  private describeAtomicAction(action: RuntimeAtomicAction): string {
    switch (action) {
      case 'move':
        return '移动'
      case 'delete':
        return '删除'
      case 'replace':
        return '替换'
      case 'insert':
        return '插入'
    }
  }

  private shouldStayInAtomicClarification(message?: string): boolean {
    if (!message) return true
    return ['未能识别', '请重新描述', '请确认', '没有找到', '缺少', '未检索到'].some((keyword) => message.includes(keyword))
  }

  private buildMicroEditDecision(
    result: RuntimeMicroEditBuildResult,
    fallbackReasoning: string,
    sourcePendingContext?: RuntimePendingAtomicContext,
  ): RuntimeDecision {
    if (result.pendingTargetSelection) {
      return this.buildPendingTargetSelectionDecision(
        result.pendingTargetSelection,
        result.message || result.pendingTargetSelection.summary,
        sourcePendingContext,
      )
    }
    if (result.pendingInsertRecommendation) {
      return this.buildPendingInsertRecommendationDecision(
        result.pendingInsertRecommendation,
        result.message || result.pendingInsertRecommendation.summary,
        sourcePendingContext,
      )
    }
    if (!result.command) {
      return { kind: 'message', feedback: createFeedback(result.message || '当前未能形成可执行命令。', 'selection', '命令解析', { thinking: result.thinking, explanation: result.explanation || fallbackReasoning, details: result.details }) }
    }
    if (requiresRuntimeCommandConfirmation(result.command)) {
      return { kind: 'pending_command', feedback: createFeedback(result.message || summarizeRuntimeCommand(result.command), 'selection', '待确认修改', { thinking: result.thinking, explanation: result.explanation || fallbackReasoning, details: result.details }), pendingCommand: { command: result.command, summary: result.message || summarizeRuntimeCommand(result.command), successMessage: result.successMessage, reasoning: result.explanation || fallbackReasoning, details: result.details } }
    }
    return { kind: 'execute_command', execution: { command: result.command, successMessage: result.successMessage, thinking: result.thinking, explanation: result.explanation || fallbackReasoning, details: result.details } }
  }

  private buildMicroEditDecisionWithContinuationFallback(
    input: RuntimeSubmitInput,
    result: RuntimeMicroEditBuildResult,
    fallbackReasoning: string,
    preferredAction?: RuntimeAtomicAction | null,
  ): RuntimeDecision {
    if (!result.command && !result.pendingTargetSelection && !result.pendingInsertRecommendation && this.shouldStayInAtomicClarification(result.message)) {
      const pendingAtomicClarification = this.buildPendingAtomicClarification(
        input,
        result.explanation || fallbackReasoning,
        preferredAction,
      )
      return this.buildPendingAtomicClarificationDecision(
        pendingAtomicClarification,
        result.explanation || fallbackReasoning,
        result.message,
      )
    }

    return this.buildMicroEditDecision(result, fallbackReasoning)
  }

  private async prepareLayoutDraft(input: RuntimeSubmitInput, classification: TaskClassification, orchestrationMode: Extract<TaskMode, 'full_generate' | 'partial_generate'>): Promise<RuntimeDecision> {
    const suggested = classification.suggestedParams ?? {}
    const structuredSegments = this.normalizeStructuredSegments(suggested.segments)
    const userIntent = typeof suggested.userIntent === 'string' && suggested.userIntent.trim() ? suggested.userIntent.trim() : input.userInput
    const ignoreExistingLayout = suggested.ignoreExistingLayout === true
    let draft: LayoutDraft
    let sourceLabel = '已根据你的要求生成版面草案。'
    let warnings: string[] = []

    if (classification.mode === 'layout_refine') {
      const baseDraft = input.currentLayoutDraft ?? this.resolveExistingLayoutDraft(input, userIntent, false)?.draft
      if (!baseDraft) return { kind: 'message', feedback: createFeedback('当前还没有可微调的版面草案，请先生成一份草案再继续调整。', 'planning', '版面草案', { explanation: classification.reasoning }) }
      const spec = await this.layoutDraftService.refineSpec({ channelId: input.scheduleState.channelId, channelName: input.scheduleState.channelName, date: input.scheduleState.date, userInput: input.userInput, currentDraft: baseDraft, coverage: suggested.targetTimeRange, semanticLabel: suggested.semanticLabel, programTypeHint: suggested.programTypeHint, segments: structuredSegments })
      const specValidation = this.layoutDraftValidator.validateSpec(spec)
      const specStructuralErrors = specValidation.errors.filter((issue) => issue.code !== 'segment_gap')
      if (specStructuralErrors.length > 0) return this.buildLayoutDraftValidationDecision('版面草案调整失败，请补充更明确的时段或内容要求。', classification.reasoning, { errors: specStructuralErrors, warnings: specValidation.warnings })
      warnings = dedupeStrings([...specValidation.warnings.map((item) => item.message), ...specValidation.errors.filter((issue) => issue.code === 'segment_gap').map((item) => item.message)])
      draft = this.layoutDraftCompiler.compile(spec, { channelId: input.scheduleState.channelId, channelName: input.scheduleState.channelName, date: input.scheduleState.date, userIntent, source: baseDraft.source, version: (baseDraft.version ?? 1) + 1 })
      draft.warnings = warnings
      sourceLabel = '已按你的要求更新当前版面草案。'
    } else {
      const referenceLayout = !ignoreExistingLayout && !input.currentLayoutDraft
        ? this.resolveExistingLayoutDraft(input, userIntent, false)
        : null
      const existing = !ignoreExistingLayout && input.currentLayoutDraft
        ? { draft: input.currentLayoutDraft, label: '已基于当前版面草案按你的要求生成调整后的版面草案。' }
        : referenceLayout?.draft.source === 'uploaded' || this.shouldPreferReferenceLayout(classification, ignoreExistingLayout)
          ? referenceLayout
          : null
      if (existing && this.shouldApplyIntentOnExistingDraft(classification, existing.draft)) {
        const spec = await this.layoutDraftService.refineSpec({ channelId: input.scheduleState.channelId, channelName: input.scheduleState.channelName, date: input.scheduleState.date, userInput: input.userInput, currentDraft: existing.draft, coverage: suggested.targetTimeRange, semanticLabel: suggested.semanticLabel, programTypeHint: suggested.programTypeHint, segments: structuredSegments })
        const specValidation = this.layoutDraftValidator.validateSpec(spec)
        const specStructuralErrors = specValidation.errors.filter((issue) => issue.code !== 'segment_gap')
        if (specStructuralErrors.length > 0) return this.buildLayoutDraftValidationDecision('基于当前版面参考生成调整方案失败，请补充更明确的时段或内容要求。', classification.reasoning, { errors: specStructuralErrors, warnings: specValidation.warnings })
        warnings = dedupeStrings([...specValidation.warnings.map((item) => item.message), ...specValidation.errors.filter((issue) => issue.code === 'segment_gap').map((item) => item.message)])
        draft = this.layoutDraftCompiler.compile(spec, { channelId: input.scheduleState.channelId, channelName: input.scheduleState.channelName, date: input.scheduleState.date, userIntent, source: existing.draft.source, version: (existing.draft.version ?? 1) + 1 })
        draft.warnings = warnings
        sourceLabel = existing.draft === input.currentLayoutDraft
          ? '已按你的要求更新当前版面草案。'
          : '已基于当前版面参考按你的要求生成调整后的版面草案。'
      } else if (existing) {
        draft = existing.draft
        warnings = existing.draft.warnings ?? []
        sourceLabel = existing.label
      } else {
        const spec = await this.layoutDraftService.generateSpec({ channelId: input.scheduleState.channelId, channelName: input.scheduleState.channelName, date: input.scheduleState.date, userInput: input.userInput, coverage: suggested.targetTimeRange, semanticLabel: suggested.semanticLabel, programTypeHint: suggested.programTypeHint, segments: structuredSegments })
        const specValidation = this.layoutDraftValidator.validateSpec(spec)
        const specStructuralErrors = specValidation.errors.filter((issue) => issue.code !== 'segment_gap')
        if (specStructuralErrors.length > 0) return this.buildLayoutDraftValidationDecision('版面草案生成失败，请补充更明确的时段或内容要求。', classification.reasoning, { errors: specStructuralErrors, warnings: specValidation.warnings })
        warnings = dedupeStrings([...specValidation.warnings.map((item) => item.message), ...specValidation.errors.filter((issue) => issue.code === 'segment_gap').map((item) => item.message)])
        draft = this.layoutDraftCompiler.compile(spec, { channelId: input.scheduleState.channelId, channelName: input.scheduleState.channelName, date: input.scheduleState.date, userIntent, source: 'generated' })
        draft.warnings = warnings
      }
    }

    const draftValidation = this.layoutDraftValidator.validateDraft(draft)
    const structuralErrors = draftValidation.errors.filter((issue) => issue.code !== 'segment_gap')
    const allWarnings = dedupeStrings([...warnings, ...draftValidation.warnings.map((item) => item.message), ...draftValidation.errors.filter((issue) => issue.code === 'segment_gap').map((item) => item.message), ...(draft.warnings ?? [])])
    draft.warnings = allWarnings
    if (structuralErrors.length > 0) return this.buildLayoutDraftValidationDecision('版面草案结构校验未通过，请先调整版面后再开始编排。', classification.reasoning, { errors: structuralErrors, warnings: draftValidation.warnings })
    const feasibilityReport = this.layoutDraftFeasibilityService.previewFeasibility(draft)
    return { kind: 'layout_draft', feedback: createFeedback(sourceLabel, 'planning', '版面草案', { explanation: classification.reasoning, details: { draftId: draft.id, layoutSource: draft.source, coverage: draft.coverage, segmentCount: draft.layoutReference.slots.length, warnings: allWarnings, feasibilitySummary: feasibilityReport.summary, orchestrationMode } }), draft, feasibilityReport, orchestrationMode }
  }

  private commitLayoutDraft(input: RuntimeSubmitInput, classification: TaskClassification): RuntimeDecision {
    const draft = input.currentLayoutDraft
      ?? this.resolveExistingLayoutDraft(input, input.userInput, false)?.draft
    if (!draft) return { kind: 'message', feedback: createFeedback('当前还没有可确认的版面草案，请先生成或导入版面后再开始编排。', 'planning', '版面草案', { explanation: classification.reasoning }) }
    const mode = this.resolvePreferredOrchestrationMode(input)
    return { kind: 'layout_commit', feedback: createFeedback('已确认当前版面草案，准备按该版面开始编排。', 'planning', '版面草案确认', { explanation: classification.reasoning, details: { draftId: draft.id, layoutSource: draft.source } }), draft, orchestrationRequest: { userInput: input.userInput, mode, reasoning: classification.reasoning, layoutDraft: draft } }
  }

  private resolveExistingLayoutDraft(input: RuntimeSubmitInput, userIntent: string, ignoreExistingLayout = false): { draft: LayoutDraft; label: string; sourceFileName?: string } | null {
    if (ignoreExistingLayout) return null
    const runtimeEntry = getRuntimeLayoutEntry(input.scheduleState.channelId, input.scheduleState.date)
    if (runtimeEntry?.templateMode) {
      return { draft: this.buildLayoutDraftFromReference({ channelId: input.scheduleState.channelId, channelName: input.scheduleState.channelName, date: input.scheduleState.date, userIntent, source: 'uploaded', layoutReference: runtimeEntry.layoutReference, columns: runtimeEntry.columns.map((column) => ({ columnId: column.columnId, columnName: column.columnName, defaultProgramType: column.defaultProgramType, isSequential: column.isSequential, semanticLabel: (column as { semanticLabel?: string }).semanticLabel, queryHints: (column as { queryHints?: string[] }).queryHints })), warnings: runtimeEntry.warnings }), label: `已读取上传版面《${runtimeEntry.sourceFileName}》，你可以继续微调后再开始编排。`, sourceFileName: runtimeEntry.sourceFileName }
    }
    const defaultLayout = getOrchestrationDemoLayout(input.scheduleState.channelId, input.scheduleState.date)
    if (!defaultLayout) return null
    return { draft: this.buildLayoutDraftFromReference({ channelId: input.scheduleState.channelId, channelName: input.scheduleState.channelName, date: input.scheduleState.date, userIntent, source: 'channel_default', layoutReference: defaultLayout }), label: '已命中当前频道版面参考，你可以继续微调后再开始编排。' }
  }

  private buildLayoutDraftFromReference(input: { channelId: string; channelName: string; date: string; userIntent: string; source: LayoutDraft['source']; layoutReference: LayoutReference; columns?: Array<{ columnId: string; columnName: string; defaultProgramType: string; isSequential?: boolean; semanticLabel?: string; queryHints?: string[] }>; warnings?: string[] }): LayoutDraft {
    const spec = {
      coverage: { start: toClockText(input.layoutReference.slots[0]?.startTime ?? DEFAULT_BROADCAST_WINDOW.start), end: toClockText(input.layoutReference.slots.at(-1)?.endTime ?? DEFAULT_BROADCAST_WINDOW.end) },
      segments: input.layoutReference.slots.map((slot, index) => {
        const sourceColumn = input.columns?.find((column) => column.columnId === slot.columnId) ?? getEffectiveColumnDefinition(slot.columnId)
        const semanticLabel = (sourceColumn as { semanticLabel?: string } | undefined)?.semanticLabel
        const queryHints = (sourceColumn as { queryHints?: string[] } | undefined)?.queryHints
        return { id: slot.id, label: semanticLabel ?? sourceColumn?.columnName ?? `时段${index + 1}`, startTime: toClockText(slot.startTime), endTime: toClockText(slot.endTime), programType: sourceColumn?.defaultProgramType ?? 'news_magazine', queryHints: queryHints ?? [semanticLabel ?? sourceColumn?.columnName ?? `时段${index + 1}`], sequential: sourceColumn?.isSequential }
      }),
    }
    const draft = this.layoutDraftCompiler.compile(spec, { channelId: input.channelId, channelName: input.channelName, date: input.date, userIntent: input.userIntent, source: input.source })
    draft.warnings = input.warnings
    return draft
  }

  private buildLayoutDraftValidationDecision(content: string, reasoning: string, validation: { errors: Array<{ message: string }>; warnings: Array<{ message: string }> }): RuntimeDecision {
    return { kind: 'message', feedback: createFeedback(content, 'planning', '草案校验', { explanation: reasoning, details: { errors: validation.errors.map((item) => item.message), warnings: validation.warnings.map((item) => item.message) } }) }
  }

  private buildInsertCommandResult(
    context: { scheduleState: ScheduleState; userInput: string; currentSchedule: RuntimeScheduleItem[] },
    params: InsertParams,
    candidate: { id: string; programName: string },
    explanation: string,
    details?: RuntimeDetailMap,
    thinking?: string,
  ): RuntimeMicroEditBuildResult {
    const command: InsertCommand = {
      action: 'insert',
      reasoning: explanation,
      data: {
        candidateId: candidate.id,
        candidateName: candidate.programName,
        insertTime: params.targetTime,
        scheduleDate: context.scheduleState.date,
        channelId: context.scheduleState.channelId,
      },
    }
    const preview = this.insertCommandExecutor.preview(command)
    if (!preview.canExecute) {
      return {
        command: null,
        message: `目标时间 ${params.targetTime} 已有节目占用，请先删除、替换，或换一个空闲时间点。`,
        thinking,
        explanation,
        details: {
          ...(details ?? {}),
          targetTime: params.targetTime,
          selectedCandidateName: candidate.programName,
          preview,
        },
      }
    }

    return {
      command,
      message: `将在 ${params.targetTime} 插入《${candidate.programName}》。`,
      successMessage: `已在 ${params.targetTime} 插入《${candidate.programName}》`,
      thinking,
      explanation,
      details: {
        ...(details ?? {}),
        targetTime: params.targetTime,
        selectedCandidateName: candidate.programName,
        preview,
      },
    }
  }

  private buildPendingInsertRecommendation(params: InsertParams, userInput: string, reasoning: string, candidates: RuntimeInsertRecommendationCandidate[]): RuntimePendingInsertRecommendation {
    return {
      action: 'insert',
      summary: `请确认 ${params.targetTime} 要插入的节目`,
      reasoning,
      originalUserInput: userInput,
      collectedUserInput: userInput,
      targetTime: params.targetTime,
      rawProgramText: params.rawProgramText,
      semanticLabel: params.semanticLabel,
      programTypeHint: params.programTypeHint,
      recommendedCandidates: candidates,
      selectedCandidateId: null,
    }
  }

  private async searchInsertCandidates(input: { scheduleState: ScheduleState; params: InsertParams; columnId?: string }): Promise<{ candidates: Array<import('@/types/orchestration').ProgramCandidate>; searchMode: 'explicit_name' | 'semantic_recommendation' | 'fallback_recommendation' }> {
    const { scheduleState, params, columnId } = input
    const programTypes = params.programTypeHint ? [params.programTypeHint] : undefined
    const explicitProgramName = params.programName?.trim()
    if (explicitProgramName) {
      const directCandidates = await this.candidateService.searchPrograms({
        channelId: scheduleState.channelId,
        programName: explicitProgramName,
        columnId,
        programTypes,
        columnStrategy: 'prefer_channel',
        limit: 6,
      })
      if (directCandidates.length > 0) {
        return {
          candidates: directCandidates,
          searchMode: 'explicit_name',
        }
      }

      const fallbackCandidates = await this.candidateService.searchPrograms({
        channelId: scheduleState.channelId,
        programName: '',
        columnId,
        programTypes,
        columnStrategy: 'prefer_channel',
        limit: 6,
      })
      return {
        candidates: fallbackCandidates,
        searchMode: 'fallback_recommendation',
      }
    }

    const recommendedCandidates = await this.candidateService.searchPrograms({
      channelId: scheduleState.channelId,
      programName: '',
      columnId,
      programTypes,
      columnStrategy: 'prefer_channel',
      limit: 6,
    })
    return {
      candidates: recommendedCandidates,
      searchMode: 'semantic_recommendation',
    }
  }

  private async buildMicroEditCommand(input: RuntimeSubmitInput, fallbackReasoning: string, recognizedIntent?: MicroEditIntent): Promise<RuntimeMicroEditBuildResult> {
    const context = buildDialogueContext({ scheduleState: input.scheduleState, userInput: input.userInput, currentSchedule: input.currentSchedule })
    const intent = recognizedIntent ?? await this.intentRecognizer.recognize(context)
    const reasoning = intent.reasoning || fallbackReasoning

    if (intent.type === 'insert') {
      let params = await this.paramExtractor.extractInsertParams(context)
      if (!params) {
        const programAnchored = this.resolveProgramAnchoredInsertParams(input, reasoning)
        if (programAnchored.result) return programAnchored.result
        params = programAnchored.params
      }
      if (!params) return { command: null, message: '未能识别插入目标时间，请重新描述。', explanation: reasoning }
      const columnId = findSlotColumnIdByTime(input.scheduleState.channelId, input.scheduleState.date, normalizeDateTime(input.scheduleState.date, params.targetTime))
      const { candidates, searchMode } = await this.searchInsertCandidates({
        scheduleState: input.scheduleState,
        params,
        columnId,
      })
      const resolution = this.insertCandidateResolver.resolve({
        channelId: input.scheduleState.channelId,
        columnId,
        params,
        candidates,
        searchMode,
      })

      if (resolution.status === 'needs_clarification') {
        return {
          command: null,
          message: resolution.reasoning,
          explanation: reasoning,
          details: {
            targetTime: params.targetTime,
            selectedCandidateName: params.programName ?? params.rawProgramText,
            candidateCount: 0,
          },
        }
      }

      if (resolution.status === 'needs_recommendation') {
        const recommendedCandidates = resolution.candidates.map((entry) => ({
          candidateId: entry.candidate.id,
          programName: entry.candidate.programName,
          programCode: entry.candidate.programCode,
          duration: entry.candidate.duration,
          programType: entry.candidate.programType,
          score: entry.score,
          confidence: entry.confidence,
          reasonTags: entry.reasonTags,
        }))
        const pendingInsertRecommendation = this.buildPendingInsertRecommendation(
          params,
          input.userInput,
          resolution.reasoning,
          recommendedCandidates,
        )
        return {
          command: null,
          message: `我先给你推荐 ${recommendedCandidates.length} 个适合在 ${params.targetTime} 插入的节目，请确认具体要插入哪一个。`,
          thinking: resolution.reasoning,
          explanation: reasoning,
          details: {
            targetTime: params.targetTime,
            selectedCandidateName: params.programName ?? params.rawProgramText ?? params.semanticLabel,
            candidateCount: recommendedCandidates.length,
            recommendationTrigger: resolution.trigger,
            recommendedCandidates,
          },
          pendingInsertRecommendation,
        }
      }

      return this.buildInsertCommandResult(
        context,
        params,
        {
          id: resolution.selectedCandidate.id,
          programName: resolution.selectedCandidate.programName,
        },
        reasoning,
        {
          targetTime: params.targetTime,
          selectedCandidateName: resolution.selectedCandidate.programName,
          selectedCandidate: resolution.selectedCandidate,
          candidateCount: resolution.recommendedCandidates.length,
        },
        resolution.reasoning,
      )
    }

    if (intent.type === 'delete' || intent.type === 'move' || intent.type === 'replace') {
      let params = intent.type === 'delete'
        ? await this.paramExtractor.extractDeleteParams(context)
        : intent.type === 'move'
          ? await this.paramExtractor.extractMoveParams(context)
          : await this.paramExtractor.extractReplaceParams(context)
      const rangeAnchored = this.resolveTimeRangeAnchoredAtomicParams(input, intent.type, reasoning)
      if (rangeAnchored.result) return rangeAnchored.result
      if (rangeAnchored.params) {
        params = rangeAnchored.params
      }
      if (!params) {
        const adjacentAnchored = this.resolveAdjacentProgramAnchoredAtomicParams(input, intent.type, reasoning)
        if (adjacentAnchored.result) return adjacentAnchored.result
        params = adjacentAnchored.params
      }
      if (!params) {
        const ordinalAnchored = this.resolveOrdinalAnchoredAtomicParams(input, intent.type, reasoning)
        if (ordinalAnchored.result) return ordinalAnchored.result
        params = ordinalAnchored.params
      }
      if (!params) {
        const programAnchored = this.resolveProgramAnchoredAtomicParams(input, intent.type, reasoning)
        if (programAnchored.result) return programAnchored.result
        params = programAnchored.params
      }
      if (!params) return { command: null, message: '未能识别目标时间，请重新描述。', explanation: reasoning }
      const targetTime = params.targetTime
      const deleteParams = intent.type === 'delete' ? params as DeleteParams : null
      const moveParams = intent.type === 'move' ? params as MoveParams : null
      const replaceParams = intent.type === 'replace' ? params as ReplaceParams : null
      const resolution = await this.scheduleTargetResolver.resolve({
        userInput: input.userInput,
        action: intent.type,
        channelName: input.scheduleState.channelName,
        date: input.scheduleState.date,
        targetTime,
        programName: deleteParams?.programName,
        items: input.currentSchedule.map(asRuntimeItem),
      })
      if (resolution.status === 'none') return { command: null, message: `没有找到 ${targetTime} 对应的节目，请确认时间或节目名称。`, explanation: resolution.reasoning || reasoning, details: { targetTime, targetResolution: { matchedBy: resolution.matchedBy } } }
      if (resolution.status === 'multiple') {
        return {
          command: null,
          message: `请确认 ${targetTime} 要${intent.type === 'delete' ? '删除' : intent.type === 'move' ? '移动' : '替换'}的节目。`,
          explanation: resolution.reasoning || reasoning,
          pendingTargetSelection: {
            action: intent.type,
            summary: `请选择 ${targetTime} 要${intent.type === 'delete' ? '删除' : intent.type === 'move' ? '移动' : '替换'}的节目`,
            reasoning: resolution.reasoning || reasoning,
            targetTime,
            programName: deleteParams?.programName,
            candidates: resolution.candidates.map(asRuntimeItem),
            selectedItemId: null,
            moveConfig: moveParams
              ? { direction: moveParams.direction, offsetSeconds: moveParams.offsetSeconds }
              : undefined,
            replaceProgramName: replaceParams?.programName,
            resolutionDetails: { targetTime, targetResolution: { matchedBy: resolution.matchedBy } },
          },
        }
      }
      const item = resolution.selectedItem!
      if (intent.type === 'delete') {
        const command: DeleteCommand = { action: 'delete', reasoning, data: { itemId: item.id } }
        return { command, message: `将删除 ${targetTime} 的《${item.programName || item.id}》。`, successMessage: `已删除 ${targetTime} 的《${item.programName || item.id}》`, explanation: resolution.reasoning || reasoning, details: { matchedItem: asRuntimeItem(item), targetTime, targetResolution: { matchedBy: resolution.matchedBy } } }
      }
      if (intent.type === 'move') {
        const currentStart = normalizeDateTime(input.scheduleState.date, item.startTime)
        const shift = moveParams!.direction === 'backward' ? -Math.abs(moveParams!.offsetSeconds) : Math.abs(moveParams!.offsetSeconds)
        const newStartTime = offsetDateTime(currentStart, shift)
        const violation = this.resolveMoveWindowViolation({ channelId: input.scheduleState.channelId, date: input.scheduleState.date, item, newStartTime })
        if (violation) return { command: null, message: violation.message, thinking: violation.thinking, explanation: resolution.reasoning || reasoning, details: violation.details }
        const command: MoveCommand = { action: 'move', reasoning, data: { itemId: item.id, newStartTime } }
        return { command, message: `将把《${item.programName || item.id}》移动到 ${toClockText(newStartTime)}。`, successMessage: `已将《${item.programName || item.id}》移动到 ${toClockText(newStartTime)}`, explanation: resolution.reasoning || reasoning, details: { matchedItem: asRuntimeItem(item), sourceTimeRange: { start: item.startTime, end: item.endTime }, proposedTimeRange: { start: toClockText(newStartTime), end: toClockText(newStartTime) }, targetTime } }
      }
      return this.buildReplaceResultForMatchedItem(item, replaceParams!.programName, input.scheduleState.channelId, input.scheduleState.date, resolution.reasoning || reasoning, targetTime)
    }

    return { command: null, message: '当前指令不属于已支持的原子修改能力。', explanation: reasoning }
  }

  private resolveOrdinalAnchoredAtomicParams(
    input: RuntimeSubmitInput,
    action: 'delete' | 'move' | 'replace',
    reasoning: string,
  ): { params: DeleteParams | MoveParams | ReplaceParams | null; result?: RuntimeMicroEditBuildResult } {
    const selected = this.findScheduleItemByOrdinalReference(input.userInput, input.currentSchedule)
    if (!selected) return { params: null }

    const targetTime = toClockText(selected.startTime)
    if (action === 'delete') {
      return {
        params: {
          targetTime,
          programName: selected.programName,
        },
      }
    }

    if (action === 'move') {
      const offset = this.extractAtomicOffsetSlot(input.userInput)
      if (!offset) {
        return {
          params: null,
          result: {
            command: null,
            message: `已经定位到第${this.describeScheduleOrdinal(selected, input.currentSchedule)}条《${selected.programName || selected.id}》，还需要补充移动幅度，例如“后移30分钟”。`,
            explanation: reasoning,
            details: {
              matchedItem: asRuntimeItem(selected),
              targetTime,
              targetResolution: { matchedBy: ['schedule_ordinal'] },
            },
          },
        }
      }
      return {
        params: {
          targetTime,
          direction: offset.direction,
          offsetSeconds: offset.offsetSeconds,
        },
      }
    }

    const replacementProgramName = this.extractAtomicReplacementProgramName(input.userInput)
    if (!replacementProgramName) {
      return {
        params: null,
        result: {
          command: null,
          message: `已经定位到第${this.describeScheduleOrdinal(selected, input.currentSchedule)}条《${selected.programName || selected.id}》，还需要补充要替换成的新节目。`,
          explanation: reasoning,
          details: {
            matchedItem: asRuntimeItem(selected),
            targetTime,
            targetResolution: { matchedBy: ['schedule_ordinal'] },
          },
        },
      }
    }

    return {
      params: {
        targetTime,
        programName: replacementProgramName,
      },
    }
  }

  private resolveTimeRangeAnchoredAtomicParams(
    input: RuntimeSubmitInput,
    action: 'delete' | 'move' | 'replace',
    reasoning: string,
  ): { params: DeleteParams | MoveParams | ReplaceParams | null; result?: RuntimeMicroEditBuildResult } {
    const range = this.extractExplicitAtomicTimeRange(input.userInput)
    if (!range) return { params: null }

    const matchedItems = input.currentSchedule.filter((item) => (
      toClockText(item.startTime) === range.start
      && toClockText(item.endTime) === range.end
    ))

    if (matchedItems.length === 0) {
      return {
        params: null,
        result: {
          command: null,
          message: `没有找到与 ${range.start}-${range.end} 完整匹配的节目，请补充准确时间点或节目名称。`,
          explanation: reasoning,
          details: {
            targetTimeRange: range,
            targetResolution: { matchedBy: ['exact_time_range'] },
          },
        },
      }
    }

    const moveConfig = action === 'move'
      ? this.extractAtomicOffsetSlot(input.userInput) ?? undefined
      : undefined
    const replaceProgramName = action === 'replace'
      ? this.extractAtomicReplacementProgramName(input.userInput)
      : undefined

    if (action === 'move' && !moveConfig) {
      return {
        params: null,
        result: {
          command: null,
          message: `已经定位到 ${range.start}-${range.end} 这段节目，还需要补充移动幅度，例如“后移30分钟”。`,
          explanation: reasoning,
          details: {
            targetTimeRange: range,
            targetCandidates: matchedItems.map(asRuntimeItem),
            targetResolution: { matchedBy: ['exact_time_range'] },
          },
        },
      }
    }

    if (action === 'replace' && !replaceProgramName) {
      return {
        params: null,
        result: {
          command: null,
          message: `已经定位到 ${range.start}-${range.end} 这段节目，还需要补充要替换成的新节目。`,
          explanation: reasoning,
          details: {
            targetTimeRange: range,
            targetCandidates: matchedItems.map(asRuntimeItem),
            targetResolution: { matchedBy: ['exact_time_range'] },
          },
        },
      }
    }

    if (matchedItems.length > 1) {
      return {
        params: null,
        result: {
          command: null,
          message: `当前节目单中存在多个 ${range.start}-${range.end} 候选，请确认要${action === 'delete' ? '删除' : action === 'move' ? '移动' : '替换'}哪一条。`,
          explanation: reasoning,
          pendingTargetSelection: {
            action,
            summary: `请选择 ${range.start}-${range.end} 要${action === 'delete' ? '删除' : action === 'move' ? '移动' : '替换'}的节目`,
            reasoning,
            targetTime: range.start,
            candidates: matchedItems.map(asRuntimeItem),
            selectedItemId: null,
            moveConfig,
            replaceProgramName,
            resolutionDetails: {
              targetTimeRange: range,
              targetResolution: { matchedBy: ['exact_time_range'] },
            },
          },
        },
      }
    }

    const selected = matchedItems[0]!
    if (action === 'delete') {
      return {
        params: {
          targetTime: range.start,
          programName: selected.programName,
        },
      }
    }

    if (action === 'move') {
      return {
        params: {
          targetTime: range.start,
          direction: moveConfig!.direction,
          offsetSeconds: moveConfig!.offsetSeconds,
        },
      }
    }

    return {
      params: {
        targetTime: range.start,
        programName: replaceProgramName!,
      },
    }
  }

  private extractExplicitAtomicTimeRange(userInput: string): { start: string; end: string } | null {
    return parseAtomicTimeRange(userInput)
  }

  private resolveAdjacentProgramAnchoredAtomicParams(
    input: RuntimeSubmitInput,
    action: 'delete' | 'move' | 'replace',
    reasoning: string,
  ): { params: DeleteParams | MoveParams | ReplaceParams | null; result?: RuntimeMicroEditBuildResult } {
    const reference = this.extractAdjacentProgramReference(input.userInput)
    if (!reference) return { params: null }

    const anchorItems = this.findScheduleItemsByProgramName(input.currentSchedule, reference.programName)
    if (anchorItems.length === 0) {
      return {
        params: null,
        result: {
          command: null,
          message: `没有在当前节目单中找到相邻锚点《${reference.programName}》，请补充准确时间点或节目名称。`,
          explanation: reasoning,
          details: {
            anchorProgramName: reference.programName,
            adjacentDirection: reference.direction,
            targetResolution: { matchedBy: ['adjacent_program_anchor'] },
          },
        },
      }
    }

    const sortedItems = this.sortScheduleItemsForOrdinal(input.currentSchedule)
    const adjacentTargets = anchorItems
      .map((anchor) => this.findAdjacentScheduleItem(anchor, sortedItems, reference.direction))
      .filter((item): item is RuntimeScheduleItem => Boolean(item))
    const uniqueTargets = Array.from(new Map(adjacentTargets.map((item) => [item.id, item])).values())

    if (uniqueTargets.length === 0) {
      return {
        params: null,
        result: {
          command: null,
          message: `《${reference.programName}》${reference.direction === 'before' ? '前面' : '后面'}没有可操作的相邻节目，请重新描述目标。`,
          explanation: reasoning,
          details: {
            anchorProgramName: reference.programName,
            adjacentDirection: reference.direction,
            anchorCandidates: anchorItems.map(asRuntimeItem),
            targetResolution: { matchedBy: ['adjacent_program_anchor'] },
          },
        },
      }
    }

    const moveConfig = action === 'move'
      ? this.extractAtomicOffsetSlot(input.userInput) ?? undefined
      : undefined
    const replaceProgramName = action === 'replace'
      ? this.extractAtomicReplacementProgramName(input.userInput)
      : undefined

    if (action === 'move' && !moveConfig) {
      return {
        params: null,
        result: {
          command: null,
          message: `已经定位到《${reference.programName}》${reference.direction === 'before' ? '前面' : '后面'}的节目，还需要补充移动幅度，例如“后移30分钟”。`,
          explanation: reasoning,
          details: {
            anchorProgramName: reference.programName,
            adjacentDirection: reference.direction,
            targetCandidates: uniqueTargets.map(asRuntimeItem),
            targetResolution: { matchedBy: ['adjacent_program_anchor'] },
          },
        },
      }
    }

    if (action === 'replace' && !replaceProgramName) {
      return {
        params: null,
        result: {
          command: null,
          message: `已经定位到《${reference.programName}》${reference.direction === 'before' ? '前面' : '后面'}的节目，还需要补充要替换成的新节目。`,
          explanation: reasoning,
          details: {
            anchorProgramName: reference.programName,
            adjacentDirection: reference.direction,
            targetCandidates: uniqueTargets.map(asRuntimeItem),
            targetResolution: { matchedBy: ['adjacent_program_anchor'] },
          },
        },
      }
    }

    if (uniqueTargets.length > 1) {
      const targetTime = toClockText(uniqueTargets[0]?.startTime ?? '')
      return {
        params: null,
        result: {
          command: null,
          message: `当前节目单中存在多个《${reference.programName}》相邻候选，请确认要${action === 'delete' ? '删除' : action === 'move' ? '移动' : '替换'}哪一条。`,
          explanation: reasoning,
          pendingTargetSelection: {
            action,
            summary: `请选择要${action === 'delete' ? '删除' : action === 'move' ? '移动' : '替换'}的相邻节目`,
            reasoning,
            targetTime,
            candidates: uniqueTargets.map(asRuntimeItem),
            selectedItemId: null,
            moveConfig,
            replaceProgramName,
            resolutionDetails: {
              anchorProgramName: reference.programName,
              adjacentDirection: reference.direction,
              targetResolution: { matchedBy: ['adjacent_program_anchor'] },
            },
          },
        },
      }
    }

    const selected = uniqueTargets[0]!
    const targetTime = toClockText(selected.startTime)
    if (action === 'delete') {
      return {
        params: {
          targetTime,
          programName: selected.programName,
        },
      }
    }

    if (action === 'move') {
      return {
        params: {
          targetTime,
          direction: moveConfig!.direction,
          offsetSeconds: moveConfig!.offsetSeconds,
        },
      }
    }

    return {
      params: {
        targetTime,
        programName: replaceProgramName!,
      },
    }
  }

  private extractAdjacentProgramReference(userInput: string): { programName: string; direction: 'before' | 'after' } | null {
    const normalized = userInput.replace(/\s+/g, '')
    const relationPattern = '(前一条|后一条|前面那条|后面那条|前面的那条|后面的那条|前面那个节目|后面那个节目|前一个节目|后一个节目|上一条|下一条)'
    const quoted = new RegExp(`《([^》]+)》(?:的)?${relationPattern}`, 'u').exec(normalized)
    if (quoted?.[1] && quoted[2]) {
      return {
        programName: quoted[1].trim(),
        direction: this.normalizeAdjacentDirection(quoted[2]),
      }
    }

    const unquoted = new RegExp(`^(.+?)(?:的)?${relationPattern}`, 'u').exec(normalized)
    if (!unquoted?.[1] || !unquoted[2]) return null

    const programName = this.normalizeAdjacentProgramAnchorText(unquoted[1])
    if (!programName) return null
    return {
      programName,
      direction: this.normalizeAdjacentDirection(unquoted[2]),
    }
  }

  private normalizeAdjacentDirection(token: string): 'before' | 'after' {
    return /(前|上)/.test(token) ? 'before' : 'after'
  }

  private normalizeAdjacentProgramAnchorText(value: string): string | undefined {
    const normalized = value
      .replace(/^(?:把|将|在|于|对|给)?/u, '')
      .replace(/^(?:删除|删掉|移除|去掉|撤掉|拿掉|移动|后移|前移|顺延|延后|提前|往后挪|往前挪|替换|换成|换掉|替换成|替换为|改成|改为)/u, '')
      .replace(/^(?:当前节目单|当前编排|当前播单|当前编单|左侧节目单|左侧表|表里|单子里|节目单里|编排单里|播单里|已排节目|已经排的)(?:中|里|里的|内|上)?(?:的)?/u, '')
      .replace(/[，。！？!?]/g, '')
      .replace(/(?:节目|栏目)$/u, '')
      .trim()
    if (/^(?:最|第?[一二三四五六七八九十\d]+)$/.test(normalized)) return undefined
    return normalized || undefined
  }

  private findAdjacentScheduleItem(anchor: RuntimeScheduleItem, sortedItems: RuntimeScheduleItem[], direction: 'before' | 'after'): RuntimeScheduleItem | null {
    const index = sortedItems.findIndex((item) => item.id === anchor.id)
    if (index < 0) return null
    return direction === 'before'
      ? sortedItems[index - 1] ?? null
      : sortedItems[index + 1] ?? null
  }

  private findScheduleItemByOrdinalReference(userInput: string, items: RuntimeScheduleItem[]): RuntimeScheduleItem | null {
    if (items.length === 0) return null
    const normalized = userInput.replace(/\s+/g, '')
    if (!/(第[一二三四五六七八九十\d]+(?:条|档|个|项|个节目|节目)?|[一二三四五六七八九十\d]+(?:条|档|个节目)|首条|第一条|第一个|最后一条|最后一个|末条|末尾|最末)/.test(normalized)) {
      return null
    }

    const sortedItems = this.sortScheduleItemsForOrdinal(items)
    if (/(最后一条|最后一个|末条|末尾|最末)/.test(normalized)) {
      return sortedItems.at(-1) ?? null
    }
    if (/(首条|第一条|第一个)/.test(normalized)) {
      return sortedItems[0] ?? null
    }

    const ordinalMatch =
      normalized.match(/第([一二三四五六七八九十\d]+)(?:条|档|个|项|个节目|节目)?/)
      || normalized.match(/([一二三四五六七八九十\d]+)(?:条|档|个节目)/)
    const ordinalIndex = this.parseScheduleOrdinalIndex(ordinalMatch?.[1])
    return ordinalIndex === null ? null : sortedItems[ordinalIndex] ?? null
  }

  private sortScheduleItemsForOrdinal(items: RuntimeScheduleItem[]): RuntimeScheduleItem[] {
    return [...items].sort((a, b) => {
      const byStart = toClockText(a.startTime).localeCompare(toClockText(b.startTime))
      if (byStart !== 0) return byStart
      return a.id.localeCompare(b.id)
    })
  }

  private parseScheduleOrdinalIndex(token?: string): number | null {
    if (!token) return null
    if (/^\d+$/.test(token)) {
      const numeric = Number(token)
      return numeric > 0 ? numeric - 1 : null
    }
    const normalized = token.replace(/^第/, '')
    const mapping: Record<string, number> = {
      一: 0,
      二: 1,
      三: 2,
      四: 3,
      五: 4,
      六: 5,
      七: 6,
      八: 7,
      九: 8,
      十: 9,
    }
    return Object.prototype.hasOwnProperty.call(mapping, normalized) ? mapping[normalized]! : null
  }

  private describeScheduleOrdinal(selected: RuntimeScheduleItem, items: RuntimeScheduleItem[]): string {
    const index = this.sortScheduleItemsForOrdinal(items).findIndex((item) => item.id === selected.id)
    return index >= 0 ? `${index + 1}` : ''
  }

  private resolveProgramAnchoredInsertParams(
    input: RuntimeSubmitInput,
    reasoning: string,
  ): { params: InsertParams | null; result?: RuntimeMicroEditBuildResult } {
    const anchor = this.extractRelativeInsertAnchor(input.userInput)
    if (!anchor) return { params: null }

    const candidates = this.findScheduleItemsByProgramName(input.currentSchedule, anchor.programName)
    if (candidates.length === 0) {
      return {
        params: null,
        result: {
          command: null,
          message: `没有在当前节目单中找到《${anchor.programName}》，请补充准确时间点或节目名称。`,
          explanation: reasoning,
          details: {
            anchorProgramName: anchor.programName,
            insertPosition: anchor.position,
            rawProgramText: anchor.rawProgramText,
            targetResolution: { matchedBy: ['program_name', 'relative_position'] },
          },
        },
      }
    }

    if (candidates.length > 1) {
      return {
        params: null,
        result: {
          command: null,
          message: `未能识别唯一插入位置：当前节目单中存在多个《${anchor.programName}》，请补充准确时间点或更具体节目名称。`,
          explanation: reasoning,
          details: {
            anchorProgramName: anchor.programName,
            candidateCount: candidates.length,
            insertPosition: anchor.position,
            rawProgramText: anchor.rawProgramText,
            targetCandidates: candidates.map(asRuntimeItem),
            targetResolution: { matchedBy: ['program_name', 'relative_position'] },
          },
        },
      }
    }

    const selected = candidates[0]!
    const targetTime = anchor.position === 'before'
      ? toClockText(selected.startTime)
      : toClockText(selected.endTime)
    const programTypeHint = anchor.programTypeHint ?? this.inferInsertProgramTypeHint(anchor.rawProgramText)
    return {
      params: {
        targetTime,
        programName: anchor.insertProgramName,
        rawProgramText: anchor.rawProgramText,
        semanticLabel: anchor.semanticLabel ?? anchor.rawProgramText,
        programTypeHint,
      },
    }
  }

  private resolveProgramAnchoredAtomicParams(
    input: RuntimeSubmitInput,
    action: 'delete' | 'move' | 'replace',
    reasoning: string,
  ): { params: DeleteParams | MoveParams | ReplaceParams | null; result?: RuntimeMicroEditBuildResult } {
    if (!this.shouldResolveTargetByProgramAnchor(input.userInput)) {
      return { params: null }
    }

    const programName = this.extractAtomicProgramHint(input.userInput, action)
    if (!programName) {
      return { params: null }
    }

    const candidates = this.findScheduleItemsByProgramName(input.currentSchedule, programName)
    if (candidates.length === 0) {
      return {
        params: null,
        result: {
          command: null,
          message: `没有在当前节目单中找到《${programName}》，请补充准确时间点或节目名称。`,
          explanation: reasoning,
          details: {
            programName,
            targetResolution: { matchedBy: ['program_name'] },
          },
        },
      }
    }

    if (candidates.length > 1) {
      const targetTime = candidates[0]?.startTime ?? ''
      const moveConfig = action === 'move'
        ? this.extractAtomicOffsetSlot(input.userInput) ?? undefined
        : undefined
      const replaceProgramName = action === 'replace'
        ? this.extractAtomicReplacementProgramName(input.userInput)
        : undefined
      if (action === 'move' && !moveConfig) {
        return {
          params: null,
          result: {
            command: null,
            message: `已经找到多个《${programName}》候选，还需要补充移动幅度。`,
            explanation: reasoning,
            details: { programName, candidateCount: candidates.length },
          },
        }
      }
      if (action === 'replace' && !replaceProgramName) {
        return {
          params: null,
          result: {
            command: null,
            message: `已经找到多个《${programName}》候选，还需要补充要替换成的新节目。`,
            explanation: reasoning,
            details: { programName, candidateCount: candidates.length },
          },
        }
      }
      return {
        params: null,
        result: {
          command: null,
          message: `当前节目单中存在多个《${programName}》，请确认要${action === 'delete' ? '删除' : action === 'move' ? '移动' : '替换'}哪一条。`,
          explanation: reasoning,
          pendingTargetSelection: {
            action,
            summary: `请选择要${action === 'delete' ? '删除' : action === 'move' ? '移动' : '替换'}的《${programName}》`,
            reasoning,
            targetTime,
            programName,
            candidates: candidates.map(asRuntimeItem),
            selectedItemId: null,
            moveConfig,
            replaceProgramName,
            resolutionDetails: {
              programName,
              targetResolution: { matchedBy: ['program_name'] },
            },
          },
        },
      }
    }

    const selected = candidates[0]!
    const targetTime = toClockText(selected.startTime)
    if (action === 'delete') {
      return {
        params: {
          targetTime,
          programName,
        },
      }
    }

    if (action === 'move') {
      const offset = this.extractAtomicOffsetSlot(input.userInput)
      if (!offset) {
        return {
          params: null,
          result: {
            command: null,
            message: `已经定位到 ${targetTime} 的《${selected.programName || programName}》，还需要补充移动幅度，例如“后移30分钟”。`,
            explanation: reasoning,
            details: {
              matchedItem: asRuntimeItem(selected),
              programName,
              targetTime,
            },
          },
        }
      }
      return {
        params: {
          targetTime,
          direction: offset.direction,
          offsetSeconds: offset.offsetSeconds,
        },
      }
    }

    const replacementProgramName = this.extractAtomicReplacementProgramName(input.userInput)
    if (!replacementProgramName) {
      return {
        params: null,
        result: {
          command: null,
          message: `已经定位到 ${targetTime} 的《${selected.programName || programName}》，还需要补充要替换成的新节目。`,
          explanation: reasoning,
          details: {
            matchedItem: asRuntimeItem(selected),
            programName,
            targetTime,
          },
        },
      }
    }

    return {
      params: {
        targetTime,
        programName: replacementProgramName,
      },
    }
  }

  private shouldResolveTargetByProgramAnchor(userInput: string): boolean {
    const normalized = userInput.replace(/\s+/g, '')
    return /(当前节目单|当前编排|当前播单|当前编单|左侧节目单|左侧表|表里|单子里|节目单里|编排单里|播单里|已排节目|已经排的|按节目名|按名称|名字叫|名称叫)/.test(normalized)
  }

  private extractRelativeInsertAnchor(userInput: string): {
    programName: string
    position: 'before' | 'after'
    rawProgramText?: string
    semanticLabel?: string
    programTypeHint?: string
    insertProgramName?: string
  } | null {
    const normalized = userInput.replace(/\s+/g, '')
    const quotedMatches = Array.from(normalized.matchAll(/《([^》]+)》/g))
    const insertVerbPattern = '(?:插入|插个|插一|加一条|加一档|加个|加一段|加一些|添加节目|添加|安排节目|安排|来个|来一条|来一档|放个|放一段|上个|上点|上一段|垫点|垫一点|垫一段|垫一条|补点|补一段)'
    const positionPattern = '(后面|之后|前面|之前|后|前)'

    if (quotedMatches.length > 0) {
      const anchorMatch = quotedMatches[0]!
      const token = anchorMatch[0]
      const anchorName = anchorMatch[1]?.trim()
      const afterQuote = normalized.slice((anchorMatch.index ?? 0) + token.length)
      const relativeMatch = new RegExp(`^(?:的)?${positionPattern}${insertVerbPattern}?(.*)$`, 'u').exec(afterQuote)
      if (anchorName && relativeMatch) {
        const position = this.normalizeRelativeInsertPosition(relativeMatch[1])
        const rawProgramText = this.normalizeAtomicProgramHint(relativeMatch[2])
        const insertProgramName = quotedMatches[1]?.[1]?.trim()
        return {
          programName: anchorName,
          position,
          rawProgramText: insertProgramName ?? rawProgramText,
          semanticLabel: rawProgramText,
          programTypeHint: this.inferInsertProgramTypeHint(insertProgramName ?? rawProgramText),
          insertProgramName,
        }
      }
    }

    if (!this.shouldResolveTargetByProgramAnchor(userInput)) return null

    const unquotedMatch = new RegExp(`^(.+?)${positionPattern}${insertVerbPattern}(.+)$`, 'u').exec(normalized)
    if (!unquotedMatch) return null

    const anchorText = this.normalizeRelativeInsertAnchorText(unquotedMatch[1])
    const rawProgramText = this.normalizeAtomicProgramHint(unquotedMatch[3])
    if (!anchorText || !rawProgramText) return null

    return {
      programName: anchorText,
      position: this.normalizeRelativeInsertPosition(unquotedMatch[2]),
      rawProgramText,
      semanticLabel: rawProgramText,
      programTypeHint: this.inferInsertProgramTypeHint(rawProgramText),
    }
  }

  private normalizeRelativeInsertPosition(token?: string): 'before' | 'after' {
    return token && /前/.test(token) ? 'before' : 'after'
  }

  private normalizeRelativeInsertAnchorText(value?: string): string | undefined {
    if (!value) return undefined
    const normalized = value
      .replace(/^(?:在|把|给|将|从|对)?/u, '')
      .replace(/^(?:当前节目单|当前编排|当前播单|当前编单|左侧节目单|左侧表|表里|单子里|节目单里|编排单里|播单里|已排节目|已经排的)(?:中|里|里的|内|上)?(?:的)?/u, '')
      .replace(/^(?:节目|栏目|名称叫|名字叫|按节目名|按名称)(?:的)?/u, '')
      .replace(/[，。！？!?]/g, '')
      .replace(/(?:节目|栏目)$/u, '')
      .trim()
    return normalized || undefined
  }

  private inferInsertProgramTypeHint(value?: string): string | undefined {
    const normalized = value?.replace(/\s+/g, '') ?? ''
    if (!normalized) return undefined
    if (/(天气|服务|便民|生活|交通|出行|提醒|提示)/.test(normalized)) return 'news_magazine'
    if (/(新闻|资讯|时政|民生|直播|现场|快讯|报道)/.test(normalized)) return 'news'
    if (/(纪录|纪实|人文|历史|自然)/.test(normalized)) return 'documentary'
    if (/(电视剧|剧场|连续剧|大剧)/.test(normalized)) return 'drama'
    if (/(综艺|娱乐|访谈|脱口秀|真人秀)/.test(normalized)) return 'variety'
    if (/(体育|赛事|球赛|运动)/.test(normalized)) return 'sports'
    if (/(动画|少儿|儿童|卡通)/.test(normalized)) return 'kids'
    return undefined
  }

  private findScheduleItemsByProgramName(items: RuntimeScheduleItem[], programName: string): RuntimeScheduleItem[] {
    const normalizedHint = this.normalizeAtomicNameForMatch(programName)
    if (!normalizedHint) return []
    return items.filter((item) => {
      const normalizedName = this.normalizeAtomicNameForMatch(item.programName || item.programCode || item.id)
      return normalizedName.includes(normalizedHint) || normalizedHint.includes(normalizedName)
    })
  }

  private normalizeAtomicNameForMatch(value: string): string {
    return value
      .trim()
      .toLowerCase()
      .replace(/[《》"'“”‘’、，。！？!?:：()（）[\]【】\-_.\s]/g, '')
      .replace(/(?:节目|栏目|版)$/g, '')
  }

  private async buildReplaceDecisionForSelectedItem(selectedItem: RuntimeScheduleItem, replaceProgramName: string, channelId: string, date: string, pendingTargetSelection: RuntimePendingTargetSelection): Promise<RuntimeDecision> {
    const result = await this.buildReplaceResultForMatchedItem(selectedItem, replaceProgramName, channelId, date, pendingTargetSelection.reasoning, selectedItem.startTime)
    return this.buildMicroEditDecision(result, pendingTargetSelection.reasoning)
  }

  private async buildReplaceResultForMatchedItem(item: RuntimeScheduleItem, replaceProgramName: string, channelId: string, date: string, explanation: string, targetTime: string): Promise<RuntimeMicroEditBuildResult> {
    const candidates = await this.candidateService.searchPrograms({ channelId, programName: replaceProgramName, columnId: resolveItemColumnId(item, channelId, date), columnStrategy: 'prefer_channel', limit: 5 })
    if (candidates.length === 0) return { command: null, message: `没有检索到适合替换《${item.programName || item.id}》的候选节目，请确认节目名称或栏目。`, explanation, details: { matchedItem: asRuntimeItem(item), targetTime, selectedCandidateName: replaceProgramName, candidateCount: 0 } }
    const selectedCandidate = candidates[0]!
    const command: ReplaceCommand = { action: 'replace', reasoning: explanation, data: { itemId: item.id, newCandidateId: selectedCandidate.id } }
    const preview = this.replaceCommandExecutor.preview(command)
    if (!preview.canExecute) return { command: null, message: preview.warnings[0] || '替换后会造成时间冲突，已阻止执行。', explanation, details: { matchedItem: asRuntimeItem(item), targetTime, selectedCandidateName: selectedCandidate.programName, selectedCandidate, preview } }
    return { command, message: `将把 ${targetTime} 的《${item.programName || item.id}》替换为《${selectedCandidate.programName}》。`, successMessage: `已将 ${targetTime} 的《${item.programName || item.id}》替换为《${selectedCandidate.programName}》`, explanation, details: { matchedItem: asRuntimeItem(item), targetTime, selectedCandidateName: selectedCandidate.programName, selectedCandidate, preview } }
  }

  private resolveMoveWindowViolation(input: { channelId: string; date: string; item: RuntimeScheduleItem; newStartTime: string }): { message: string; thinking: string; details: RuntimeDetailMap } | null {
    const window = resolveBroadcastWindow(input.channelId, input.date)
    const newStartClock = toClockText(input.newStartTime)
    const duration = input.item.duration ?? 0
    const newEndTime = offsetDateTime(input.newStartTime, duration)
    const newEndClock = toClockText(newEndTime)
    const windowStart = normalizeDateTime(input.date, window.start)
    const windowEnd = normalizeDateTime(input.date, window.end)
    if (new Date(input.newStartTime).getTime() < new Date(windowStart).getTime() || new Date(newEndTime).getTime() > new Date(windowEnd).getTime()) {
      return { message: `移动后将落到 ${newStartClock}-${newEndClock}，已超出编单时间范围 ${window.start}-${window.end}，已拒绝执行。`, thinking: '移动后的节目时段超出了当前频道当天的编单时间范围。', details: { matchedItem: asRuntimeItem(input.item), sourceTimeRange: { start: input.item.startTime, end: input.item.endTime }, proposedTimeRange: { start: newStartClock, end: newEndClock }, error: '超出编单时间范围' } }
    }
    return null
  }

  private buildValidationDecision(classification: TaskClassification, input: RuntimeSubmitInput): RuntimeDecision {
    const report = this.scheduleCommandBus.validate({ scheduleDate: input.scheduleState.date, channelId: input.scheduleState.channelId })
    return { kind: 'message', feedback: createFeedback(report.isValid ? '当前节目单校验通过，未发现明显风险。' : `校验完成，发现 ${report.summary.totalIssues} 个问题，其中严重问题 ${report.summary.criticalCount} 个。`, 'validation', '校验结果', { explanation: classification.reasoning, details: { summary: report.summary, issues: report.issues.slice(0, 5) } }) }
  }

  private buildRepairAnalysisDecision(classification: TaskClassification, input: RuntimeSubmitInput): RuntimeDecision {
    const report = this.scheduleCommandBus.validate({ scheduleDate: input.scheduleState.date, channelId: input.scheduleState.channelId })
    const content = report.isValid
      ? '当前节目单暂未发现明显问题，暂时没有可执行的自动修复项。'
      : `已先完成问题分析，发现 ${report.summary.totalIssues} 个问题。当前自动修复仍需按问题清单逐步处理，建议先确认修复范围。`
    return { kind: 'message', feedback: createFeedback(content, 'validation', '问题分析', { explanation: classification.reasoning, details: { summary: report.summary, issues: report.issues.slice(0, 5), nextStep: '如需继续处理，请明确要修复的时段、问题类型，或先调整版面草案。' } }) }
  }

  private async buildLayoutAnalysisDecision(classification: TaskClassification, input: RuntimeSubmitInput): Promise<RuntimeDecision> {
    const report = this.scheduleCommandBus.validate({
      scheduleDate: input.scheduleState.date,
      channelId: input.scheduleState.channelId,
    })
    const layoutReference = getEffectiveLayoutReference(input.scheduleState.channelId, input.scheduleState.date)
    const runtimeLayoutEntry = getRuntimeLayoutEntry(input.scheduleState.channelId, input.scheduleState.date)
    const analysis = await this.layoutAnalysisService.analyze({
      channelId: input.scheduleState.channelId,
      channelName: input.scheduleState.channelName,
      date: input.scheduleState.date,
      userInput: input.userInput,
      currentSchedule: input.currentSchedule,
      validationReport: report,
      layoutReference,
      runtimeLayoutEntry,
    })

    return {
      kind: 'message',
      feedback: createFeedback(
        analysis.content,
        'planning',
        '版面分析',
        {
          explanation: classification.reasoning,
          details: analysis.details,
        },
      ),
    }
  }

  private buildAtomicFallbackFeedback(pending: RuntimePendingAtomicClarification, contentOverride?: string, explanation?: string): RuntimeFeedback {
    const content = contentOverride && contentOverride !== pending.followUpQuestion
      ? `${contentOverride} ${pending.followUpQuestion}`
      : (contentOverride ?? pending.followUpQuestion)
    return createFeedback(content, 'selection', '原子参数澄清', {
      explanation,
      details: {
        action: pending.action,
        targetTimeHint: pending.targetTimeHint,
        programNameHint: pending.programNameHint,
        missingFields: pending.missingFields,
      },
    })
  }

  private buildClarifyFeedback(input: RuntimeSubmitInput, explanation?: string): RuntimeFeedback {
    const normalized = input.userInput.replace(/\s+/g, '')
    if (/(改|调整|换|替换|移动|删除|插入|添加|顺一下|挪一下)/.test(normalized) && !/(版面|栏目|剧场|时段|上午|下午|晚间|晚上|全天)/.test(normalized)) {
      return createFeedback('这句话更像是在调整具体节目。请补充明确的时间点或节目名称，例如“把 09:00 的《看东方》后移 30 分钟”。', 'general', '需要澄清', { explanation })
    }
    if (/(编排|补齐|补全|填充|排表|排期|空窗|空缺)/.test(normalized)) {
      return createFeedback('这条指令更像是在描述编排需求。请补充版面范围和内容偏好，例如“下午改成新闻栏目”或“全天按新闻资讯版面生成草案”。', 'general', '需要澄清', { explanation })
    }
    return createFeedback('我还不能稳定理解这条指令。你可以直接说“下午改成新闻栏目”，或补充更明确的时间范围和目标内容。', 'general', '需要澄清', { explanation })
  }
}

export const requiresRuntimeCommandConfirmation = (command: OrchestrationCommand): boolean => command.action === 'delete' || command.action === 'replace'
export const summarizeRuntimeCommand = (command: OrchestrationCommand): string => command.action === 'insert' ? '插入节目' : command.action === 'delete' ? '删除已编排节目' : command.action === 'replace' ? '替换已编排节目' : command.action === 'move' ? '调整节目时间' : `执行 ${command.action} 命令`
export const formatRuntimeOffset = (offsetSeconds: number) => offsetSeconds % 3600 === 0 ? `${offsetSeconds / 3600}小时` : offsetSeconds % 60 === 0 ? `${offsetSeconds / 60}分钟` : `${offsetSeconds}秒`

let globalDemoRuntimeFacade: DemoRuntimeFacade | null = null
export function getDemoRuntimeFacade(): DemoRuntimeFacade { if (!globalDemoRuntimeFacade) globalDemoRuntimeFacade = new DemoRuntimeFacade(); return globalDemoRuntimeFacade }
