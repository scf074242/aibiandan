import type { DeleteCommand, DraftFeasibilityReport, InsertCommand, LayoutDraft, LayoutReference, MoveCommand, OrchestrationCommand, ReplaceCommand, ScheduleState, TaskClassification, TaskMode, ValidationReport } from '@/types/orchestration'
import { getLLMClient } from '@/services/llm/llmClient'
import { getTaskClassifier } from '@/services/llm/taskClassifier'
import { buildDialogueContext } from '@/services/dialogueContext'
import { getIntentRecognizer } from '@/services/intentRecognizer'
import type { MicroEditIntent } from '@/services/intentRecognizer'
import { getParamExtractor } from '@/services/paramExtractor'
import type { DeleteParams, MoveParams, ReplaceParams } from '@/services/paramExtractor'
import { getEntityLinker } from '@/services/entityLinker'
import { getCandidateService } from '@/services/candidateService'
import { getCandidateSelectionService } from '@/services/candidateSelectionService'
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
import { getOrchestrationDemoLayout } from '@/mock/orchestrationMock'

export type RuntimeDetailMap = Record<string, unknown>
export type RuntimeProcessType = 'planning' | 'selection' | 'execution' | 'validation' | 'general'
export interface RuntimeFeedback { content: string; thinking?: string; explanation?: string; details?: RuntimeDetailMap; processType: RuntimeProcessType; processTypeLabel: string }
export interface RuntimeScheduleItem { id: string; programCode?: string; programName?: string; startTime: string; endTime: string; duration?: number; programType?: string }
export interface RuntimePendingCommand { command: OrchestrationCommand; summary: string; successMessage?: string; reasoning: string; details?: RuntimeDetailMap }
export interface RuntimePendingTargetSelection { action: 'delete' | 'move' | 'replace'; summary: string; reasoning: string; targetTime: string; programName?: string; candidates: RuntimeScheduleItem[]; selectedItemId: string | null; moveConfig?: { direction: 'forward' | 'backward'; offsetSeconds: number }; replaceProgramName?: string; resolutionDetails?: RuntimeDetailMap }
export interface RuntimeExecutionPlan { command: OrchestrationCommand; successMessage?: string; thinking?: string; explanation?: string; details?: RuntimeDetailMap }
export interface RuntimeExecutedResult { success: boolean; command: OrchestrationCommand; message: string; error?: string; summary: string; thinking?: string; explanation?: string; details?: RuntimeDetailMap; data?: unknown; affectedTimeRanges?: { start: string; end: string }[]; validationReport?: ValidationReport; validationSummary?: RuntimeDetailMap }
export interface RuntimeSubmitInput { scheduleState: ScheduleState; userInput: string; currentSchedule: RuntimeScheduleItem[]; currentLayoutDraft?: LayoutDraft | null; currentLayoutDraftMode?: Extract<TaskMode, 'full_generate' | 'partial_generate'> | null; history?: string[] }
export interface RuntimeResolveTargetSelectionInput { channelId: string; date: string; pendingTargetSelection: RuntimePendingTargetSelection }
export interface RuntimeExecutePendingCommandInput { pendingCommand: RuntimePendingCommand; scheduleDate: string; channelId: string }
export interface RuntimeOrchestrationRequest { userInput: string; mode: Extract<TaskMode, 'full_generate' | 'partial_generate'>; reasoning: string; layoutDraft?: LayoutDraft }
export type RuntimeDecision =
  | { kind: 'message'; feedback: RuntimeFeedback }
  | { kind: 'pending_command'; feedback: RuntimeFeedback; pendingCommand: RuntimePendingCommand }
  | { kind: 'pending_target_selection'; feedback: RuntimeFeedback; pendingTargetSelection: RuntimePendingTargetSelection }
  | { kind: 'execute_command'; execution: RuntimeExecutionPlan }
  | { kind: 'orchestration'; feedback: RuntimeFeedback; orchestrationRequest: RuntimeOrchestrationRequest }
  | { kind: 'layout_draft'; feedback: RuntimeFeedback; draft: LayoutDraft; feasibilityReport: DraftFeasibilityReport; orchestrationMode: Extract<TaskMode, 'full_generate' | 'partial_generate'> }
  | { kind: 'layout_commit'; feedback: RuntimeFeedback; draft: LayoutDraft; orchestrationRequest: RuntimeOrchestrationRequest }

type RuntimeMicroEditBuildResult = { command: OrchestrationCommand | null; message?: string; thinking?: string; explanation?: string; details?: RuntimeDetailMap; successMessage?: string; pendingTargetSelection?: RuntimePendingTargetSelection }

const DEFAULT_BROADCAST_WINDOW = { start: '06:00:00', end: '23:59:59' }
const toClockText = (value: string) => value.includes('T') ? (value.split('T')[1]?.slice(0, 8) ?? value) : (value.length === 5 ? `${value}:00` : value)
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
  private readonly entityLinker = getEntityLinker()
  private readonly candidateService = getCandidateService()
  private readonly candidateSelectionService = getCandidateSelectionService(this.llmClient)
  private readonly insertCommandExecutor = getInsertCommandExecutor()
  private readonly replaceCommandExecutor = getReplaceCommandExecutor()
  private readonly scheduleCommandBus = getScheduleCommandBus()
  private readonly scheduleTargetResolver = getScheduleTargetResolver(this.llmClient)
  private readonly layoutDraftService = getLayoutDraftService(this.llmClient)
  private readonly layoutDraftCompiler = getLayoutDraftCompiler()
  private readonly layoutDraftValidator = getLayoutDraftValidator()
  private readonly layoutDraftFeasibilityService = getLayoutDraftFeasibilityService()

  async submitInstruction(input: RuntimeSubmitInput): Promise<RuntimeDecision> {
    const atomicDecision = await this.tryHandleAtomicInstruction(input)
    if (atomicDecision) return atomicDecision

    const layoutRecognition = await this.layoutIntentRecognizer.recognize({
      scheduleState: input.scheduleState,
      userInput: input.userInput,
      history: input.history,
      currentLayoutDraft: input.currentLayoutDraft,
      hasUploadedLayout: Boolean(getRuntimeLayoutEntry(input.scheduleState.channelId, input.scheduleState.date)?.templateMode),
      hasDefaultLayout: Boolean(getOrchestrationDemoLayout(input.scheduleState.channelId, input.scheduleState.date)),
    })
    if (this.isConfidentLayoutIntent(layoutRecognition)) {
      const classification = this.convertLayoutIntentToClassification(layoutRecognition, input.userInput)
      return classification.mode === 'layout_commit'
        ? this.commitLayoutDraft(input, classification)
        : this.prepareLayoutDraft(input, classification, input.currentLayoutDraftMode ?? 'full_generate')
    }

    const classification = await this.taskClassifier.classify({ scheduleState: input.scheduleState, userInput: input.userInput, history: input.history })
    if (classification.mode === 'micro_edit') return this.buildMicroEditDecision(await this.buildMicroEditCommand(input, classification.reasoning), classification.reasoning)
    if (classification.mode === 'validate_only') return this.buildValidationDecision(classification, input)
    if (classification.mode === 'full_generate' || classification.mode === 'partial_generate' || classification.mode === 'repair_only') {
      return this.prepareLayoutDraft(input, classification, classification.mode === 'full_generate' ? 'full_generate' : 'partial_generate')
    }
    return { kind: 'message', feedback: createFeedback('我还不能稳定理解这条指令。你可以直接说“全天编排”“补齐当前空窗”，或明确说明“下午改成新闻栏目”。', 'general', '需要澄清', { explanation: classification.reasoning || layoutRecognition.reasoning }) }
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

  async executePendingCommand(input: RuntimeExecutePendingCommandInput): Promise<RuntimeExecutedResult> {
    const result = await this.scheduleCommandBus.execute(input.pendingCommand.command, { scheduleDate: input.scheduleDate, channelId: input.channelId })
    return { success: result.success, command: input.pendingCommand.command, message: result.success ? (input.pendingCommand.successMessage || result.message) : (result.error || result.message), error: result.error, summary: input.pendingCommand.summary, thinking: result.success ? '命令已执行完成。' : '命令执行失败，未能完成本次修改。', explanation: input.pendingCommand.reasoning, details: input.pendingCommand.details, data: result.data, affectedTimeRanges: result.affectedTimeRanges, validationReport: result.validationReport, validationSummary: buildValidationSummary(result.validationReport) }
  }

  private isConfidentLayoutIntent(recognition: LayoutIntentRecognition): boolean { return recognition.mode !== 'clarify' && recognition.confidence >= 0.72 }
  private convertLayoutIntentToClassification(recognition: LayoutIntentRecognition, userInput: string): TaskClassification { return { mode: recognition.mode, confidence: recognition.confidence, reasoning: recognition.reasoning, suggestedParams: { userIntent: recognition.semanticLabel || userInput, targetTimeRange: recognition.targetTimeRange, ignoreExistingLayout: recognition.ignoreExistingLayout, semanticLabel: recognition.semanticLabel, programTypeHint: recognition.programTypeHint } } }
  private shouldApplyIntentOnExistingDraft(classification: TaskClassification): boolean { return Boolean(classification.suggestedParams?.targetTimeRange || classification.suggestedParams?.semanticLabel || classification.suggestedParams?.programTypeHint) }

  private async tryHandleAtomicInstruction(input: RuntimeSubmitInput): Promise<RuntimeDecision | null> {
    if (!this.shouldAttemptAtomicInstruction(input.userInput)) return null
    const context = buildDialogueContext({ scheduleState: input.scheduleState, userInput: input.userInput, currentSchedule: input.currentSchedule })
    const recognizedIntent = await this.intentRecognizer.recognize(context)
    if (!['insert', 'move', 'delete', 'replace'].includes(recognizedIntent.type)) return null
    return this.buildMicroEditDecision(await this.buildMicroEditCommand(input, recognizedIntent.reasoning, recognizedIntent), recognizedIntent.reasoning)
  }

  private shouldAttemptAtomicInstruction(userInput: string): boolean {
    const normalized = userInput.replace(/\s+/g, '')
    if (!/(插入|添加节目|安排节目|删除|删掉|移除|移动|后移|前移|顺延|延后|提前|换成|替换成|替换为|改成|改为)/.test(normalized)) return false
    const hasExactTime = /(\d{1,2})(点半|点(\d{1,2})分?|[:：]\d{2})/.test(normalized)
    const hasQuotedTitle = /《[^》]+》/.test(normalized)
    const hasBroadScope = /(全天|整天|全日|上午|中午|午间|下午|晚间|晚上|夜间|深夜|凌晨|全部|都|统一|整体)/.test(normalized)
    const hasLayoutCue = /(版面|栏目|剧场|时段)/.test(normalized)
    return !((hasBroadScope || hasLayoutCue) && !hasExactTime && !hasQuotedTitle)
  }

  private buildMicroEditDecision(result: RuntimeMicroEditBuildResult, fallbackReasoning: string): RuntimeDecision {
    if (result.pendingTargetSelection) {
      return { kind: 'pending_target_selection', feedback: createFeedback(result.message || result.pendingTargetSelection.summary, 'selection', '待选择目标', { thinking: result.thinking, explanation: result.explanation || fallbackReasoning, details: result.details }), pendingTargetSelection: result.pendingTargetSelection }
    }
    if (!result.command) {
      return { kind: 'message', feedback: createFeedback(result.message || '当前未能形成可执行命令。', 'selection', '命令解析', { thinking: result.thinking, explanation: result.explanation || fallbackReasoning, details: result.details }) }
    }
    if (requiresRuntimeCommandConfirmation(result.command)) {
      return { kind: 'pending_command', feedback: createFeedback(result.message || summarizeRuntimeCommand(result.command), 'selection', '待确认修改', { thinking: result.thinking, explanation: result.explanation || fallbackReasoning, details: result.details }), pendingCommand: { command: result.command, summary: result.message || summarizeRuntimeCommand(result.command), successMessage: result.successMessage, reasoning: result.explanation || fallbackReasoning, details: result.details } }
    }
    return { kind: 'execute_command', execution: { command: result.command, successMessage: result.successMessage, thinking: result.thinking, explanation: result.explanation || fallbackReasoning, details: result.details } }
  }

  private async prepareLayoutDraft(input: RuntimeSubmitInput, classification: TaskClassification, orchestrationMode: Extract<TaskMode, 'full_generate' | 'partial_generate'>): Promise<RuntimeDecision> {
    const suggested = classification.suggestedParams ?? {}
    const userIntent = typeof suggested.userIntent === 'string' && suggested.userIntent.trim() ? suggested.userIntent.trim() : input.userInput
    const ignoreExistingLayout = suggested.ignoreExistingLayout === true
    let draft: LayoutDraft
    let sourceLabel = '已根据你的要求生成版面草案。'
    let warnings: string[] = []

    if (classification.mode === 'layout_refine') {
      const baseDraft = input.currentLayoutDraft ?? this.resolveExistingLayoutDraft(input, userIntent, false)?.draft
      if (!baseDraft) return { kind: 'message', feedback: createFeedback('当前还没有可微调的版面草案，请先生成一份草案再继续调整。', 'planning', '版面草案', { explanation: classification.reasoning }) }
      const spec = await this.layoutDraftService.refineSpec({ channelId: input.scheduleState.channelId, channelName: input.scheduleState.channelName, date: input.scheduleState.date, userInput: input.userInput, currentDraft: baseDraft, coverage: suggested.targetTimeRange, semanticLabel: suggested.semanticLabel, programTypeHint: suggested.programTypeHint })
      const specValidation = this.layoutDraftValidator.validateSpec(spec)
      const specStructuralErrors = specValidation.errors.filter((issue) => issue.code !== 'segment_gap')
      if (specStructuralErrors.length > 0) return this.buildLayoutDraftValidationDecision('版面草案调整失败，请补充更明确的时段或内容要求。', classification.reasoning, { errors: specStructuralErrors, warnings: specValidation.warnings })
      warnings = dedupeStrings([...specValidation.warnings.map((item) => item.message), ...specValidation.errors.filter((issue) => issue.code === 'segment_gap').map((item) => item.message)])
      draft = this.layoutDraftCompiler.compile(spec, { channelId: input.scheduleState.channelId, channelName: input.scheduleState.channelName, date: input.scheduleState.date, userIntent, source: baseDraft.source, version: (baseDraft.version ?? 1) + 1 })
      draft.warnings = warnings
      sourceLabel = '已按你的要求更新当前版面草案。'
    } else {
      const existing = this.resolveExistingLayoutDraft(input, userIntent, ignoreExistingLayout)
      if (existing && this.shouldApplyIntentOnExistingDraft(classification)) {
        const spec = await this.layoutDraftService.refineSpec({ channelId: input.scheduleState.channelId, channelName: input.scheduleState.channelName, date: input.scheduleState.date, userInput: input.userInput, currentDraft: existing.draft, coverage: suggested.targetTimeRange, semanticLabel: suggested.semanticLabel, programTypeHint: suggested.programTypeHint })
        const specValidation = this.layoutDraftValidator.validateSpec(spec)
        const specStructuralErrors = specValidation.errors.filter((issue) => issue.code !== 'segment_gap')
        if (specStructuralErrors.length > 0) return this.buildLayoutDraftValidationDecision('基于当前版面参考生成调整方案失败，请补充更明确的时段或内容要求。', classification.reasoning, { errors: specStructuralErrors, warnings: specValidation.warnings })
        warnings = dedupeStrings([...specValidation.warnings.map((item) => item.message), ...specValidation.errors.filter((issue) => issue.code === 'segment_gap').map((item) => item.message)])
        draft = this.layoutDraftCompiler.compile(spec, { channelId: input.scheduleState.channelId, channelName: input.scheduleState.channelName, date: input.scheduleState.date, userIntent, source: existing.draft.source, version: (existing.draft.version ?? 1) + 1 })
        draft.warnings = warnings
        sourceLabel = '已基于当前版面参考按你的要求生成调整后的版面草案。'
      } else if (existing) {
        draft = existing.draft
        warnings = existing.draft.warnings ?? []
        sourceLabel = existing.label
      } else {
        const spec = await this.layoutDraftService.generateSpec({ channelId: input.scheduleState.channelId, channelName: input.scheduleState.channelName, date: input.scheduleState.date, userInput: input.userInput, coverage: suggested.targetTimeRange, semanticLabel: suggested.semanticLabel, programTypeHint: suggested.programTypeHint })
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
    if (!draft) return { kind: 'message', feedback: createFeedback('当前还没有可确认的版面草案，请先生成或导入版面后再开始编排。', 'planning', '版面草案', { explanation: classification.reasoning }) }
    const mode = input.currentLayoutDraftMode ?? (input.scheduleState.isEmpty || input.scheduleState.itemCount === 0 ? 'full_generate' : 'partial_generate')
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

  private async buildMicroEditCommand(input: RuntimeSubmitInput, fallbackReasoning: string, recognizedIntent?: MicroEditIntent): Promise<RuntimeMicroEditBuildResult> {
    const context = buildDialogueContext({ scheduleState: input.scheduleState, userInput: input.userInput, currentSchedule: input.currentSchedule })
    const intent = recognizedIntent ?? await this.intentRecognizer.recognize(context)
    const reasoning = intent.reasoning || fallbackReasoning

    if (intent.type === 'insert') {
      const params = await this.paramExtractor.extractInsertParams(context)
      if (!params) return { command: null, message: '未能识别插入目标时间和节目名称，请重新描述。', explanation: reasoning }
      const columnId = findSlotColumnIdByTime(input.scheduleState.channelId, input.scheduleState.date, normalizeDateTime(input.scheduleState.date, params.targetTime))
      const candidates = await this.candidateService.searchPrograms({ channelId: input.scheduleState.channelId, programName: params.programName, columnId, columnStrategy: 'prefer_channel', limit: 5 })
      if (candidates.length === 0) return { command: null, message: `未检索到适合在 ${params.targetTime} 插入的节目，请确认节目名称或栏目。`, explanation: reasoning, details: { targetTime: params.targetTime, selectedCandidateName: params.programName, candidateCount: 0 } }
      const selection = await this.candidateSelectionService.selectForInsert(context, params, candidates)
      const command = this.entityLinker.createInsertCommand(context, params, selection.selectedCandidate.id, selection.selectedCandidate.programName)
      const preview = this.insertCommandExecutor.preview(command)
      if (!preview.canExecute) return { command: null, message: `目标时间 ${params.targetTime} 已有节目占用，请先删除、替换，或换一个空闲时间点。`, thinking: selection.reasoning, explanation: reasoning, details: { targetTime: params.targetTime, selectedCandidateName: selection.selectedCandidate.programName, selectedCandidate: selection.selectedCandidate, preview } }
      return { command, message: `将在 ${params.targetTime} 插入《${selection.selectedCandidate.programName}》。`, successMessage: `已在 ${params.targetTime} 插入《${selection.selectedCandidate.programName}》`, thinking: selection.reasoning, explanation: reasoning, details: { targetTime: params.targetTime, selectedCandidateName: selection.selectedCandidate.programName, selectedCandidate: selection.selectedCandidate, preview } }
    }

    if (intent.type === 'delete' || intent.type === 'move' || intent.type === 'replace') {
      const params = intent.type === 'delete'
        ? await this.paramExtractor.extractDeleteParams(context)
        : intent.type === 'move'
          ? await this.paramExtractor.extractMoveParams(context)
          : await this.paramExtractor.extractReplaceParams(context)
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
        programName: deleteParams?.programName ?? replaceParams?.programName,
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
            programName: deleteParams?.programName ?? replaceParams?.programName,
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
}

export const requiresRuntimeCommandConfirmation = (command: OrchestrationCommand): boolean => command.action === 'delete' || command.action === 'replace'
export const summarizeRuntimeCommand = (command: OrchestrationCommand): string => command.action === 'insert' ? '插入节目' : command.action === 'delete' ? '删除已编排节目' : command.action === 'replace' ? '替换已编排节目' : command.action === 'move' ? '调整节目时间' : `执行 ${command.action} 命令`
export const formatRuntimeOffset = (offsetSeconds: number) => offsetSeconds % 3600 === 0 ? `${offsetSeconds / 3600}小时` : offsetSeconds % 60 === 0 ? `${offsetSeconds / 60}分钟` : `${offsetSeconds}秒`

let globalDemoRuntimeFacade: DemoRuntimeFacade | null = null
export function getDemoRuntimeFacade(): DemoRuntimeFacade { if (!globalDemoRuntimeFacade) globalDemoRuntimeFacade = new DemoRuntimeFacade(); return globalDemoRuntimeFacade }

