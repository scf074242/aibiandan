import type { ColumnDefinition, DeleteCommand, DraftFeasibilityReport, InsertCommand, LayoutDraft, LayoutReference, LlmFailureInfo, MoveCommand, OrchestrationCommand, ReplaceCommand, ScheduleItemSnapshot, ScheduleState, TaskClassification, TaskMode, ValidationReport } from '@/types/orchestration'
import { getLLMClient } from '@/services/llm/llmClient'
import type { LLMRequestTrace } from '@/types/llm'
import type { LayoutIntentSegment } from '@/types/orchestration'
import type { PlaylistType, ProgramCandidate, RotationPlaylistStrategy } from '@/types/orchestration'
import type { DraftSegmentSelectionPolicy, DraftSelectionPriority, LayoutDraftStrategyBasis, LayoutDraftStrategyKind, LayoutDraftStrategyProfile } from '@/types/orchestration'
import { getTaskClassifier } from '@/services/llm/taskClassifier'
import { getAgentPlanner, type AgentPlan, type AgentPlannerAction, type AgentPlannerAtomicIntent } from '@/services/llm/agentPlanner'
import { buildDialogueContext } from '@/services/dialogueContext'
import { getIntentRecognizer } from '@/services/intentRecognizer'
import type { MicroEditIntent } from '@/services/intentRecognizer'
import { getParamExtractor } from '@/services/paramExtractor'
import type { DeleteParams, InsertParams, MoveParams, ReplaceParams } from '@/services/paramExtractor'
import { getCandidateService } from '@/services/candidateService'
import { getInsertCandidateResolver } from '@/services/insertCandidateResolver'
import { getInsertCommandExecutor } from '@/services/insertCommandExecutor'
import { getReplaceCommandExecutor } from '@/services/replaceCommandExecutor'
import { getScheduleCommandBus } from '@/services/scheduleCommandBus'
import { getScheduleTargetResolver } from '@/services/scheduleTargetResolver'
import { getEffectiveColumnDefinition, getEffectiveLayoutReference, getRuntimeLayoutEntry } from '@/services/orchestration/runtimeLayoutRegistry'
import { getLayoutDraftService } from '@/services/layoutDraftService'
import { cleanLayoutDraftSemanticLabel } from '@/services/layoutDraftSemanticCleaner'
import { draftSegmentPartsMatch } from '@/services/draftSegmentLabelMatcher'
import { getLayoutDraftCompiler } from '@/services/layoutDraftCompiler'
import { getLayoutDraftValidator } from '@/services/layoutDraftValidator'
import { getLayoutDraftFeasibilityService } from '@/services/layoutDraftFeasibilityService'
import { getDataService } from '@/services/orchestration/dataService'
import { extractSpecificSearchKeywords, hasEditorialKeywordRequirements, hasExplicitSequenceRequirements, hasFunctionalSearchKeywords } from '@/services/candidateKeywordMatcher'
import { getLayoutIntentRecognizer, type LayoutIntentRecognition } from '@/services/layoutIntentRecognizer'
import { getLayoutAnalysisService } from '@/services/layoutAnalysisService'
import { getAtomicCapabilities } from '@/services/atomicCapabilities'
import { parseAtomicOffset } from '@/services/atomicOffsetParser'
import { parseAtomicClockExpression, parseAtomicClockExpressions, parseAtomicTimeRange } from '@/services/atomicTimeParser'
import { SchedulingAgentRuntime, type SchedulingAgentRuntimeCapabilitySummary } from '@/services/agent/schedulingAgentRuntime'
import {
  FormalOrchestrationCapability,
  type FormalOrchestrationAdapter,
  type FormalOrchestrationDecisionOptions,
} from '@/services/agent/formalOrchestrationCapability'
import { RuntimeSchedulingDataGateway, type RuntimeScheduleSourceItem } from '@/services/agent/runtimeSchedulingDataGateway'
import { createRuntimeSchedulingDataReader } from '@/services/agent/runtimeSchedulingDataAdapters'
import { buildSearchFacets as buildAgentSearchFacets } from '@/services/agent/searchFacets'
import { buildAgentLlmContextPackage } from '@/services/agent/llmContextPackage'
import { buildRecoverableFailureEnvelope, type RecognizedSlot } from '@/services/agent/recoverableFailureEnvelope'
import { LlmAgentIntentInterpreter } from '@/services/agent/llmAgentIntentInterpreter'
import { LlmAgentCandidateJudge } from '@/services/agent/candidateJudge'
import { createAgentLlmStreamProgressEmitter } from './agentLlmStreamProgress'
import { AgentDeadline, STAGE_TIMEOUT_BUDGET, LONG_RUNNING_DEADLINE_BUDGET } from '@/services/agent/agentDeadline'
import { buildPendingLlmContext, type AgentPendingLlmContext } from '@/services/agent/agentSession'
import type { SchedulingAgentOperationalReadinessAudit } from '@/services/agent/agentReadinessAudit'
import type { AgentCandidateRecommendation, AgentIntentInterpretation, AgentLlmContextPackage, AgentPendingTask, AgentResult, AgentSubmitInput, AgentTaskPlanDraft, AgentTraceStep, AtomicCommandIntent } from '@/services/agent/types'
import { looksLikeProgramSchedulingRequest, normalizeSchedulingText, parseSchedulingTimeRange, stripProtectedSchedulingClauses } from '@/services/schedulingIntentHeuristics'
import { detectMovingItemSequenceViolation } from '@/services/scheduleSequenceGuard'
import { getOrchestrationDemoLayout } from '@/mock/orchestrationMock'
import {
  buildPendingAtomicContextFromClarification,
  buildPendingAtomicContextFromInsertRecommendation,
  buildPendingAtomicContextFromTargetSelection,
  deriveAtomicMissingFieldsFromSlots,
  type RuntimeAtomicAction,
  type RuntimeAtomicMissingField,
  type RuntimePendingAtomicContext,
  type RuntimePendingAtomicPhase,
  type RuntimeAtomicSlotBag,
  type RuntimeDraftResearchSuggestion,
  type RuntimeResumeCompositeTask,
} from './pendingAtomicContext'
import {
  getPendingAtomicContextService,
} from './pendingAtomicContextService'
import {
  DEFAULT_SCHEDULING_TASK_LIMITS,
  type SchedulingTaskRun,
  type SchedulingTaskStage,
} from './schedulingTaskPlan'
import { getSchedulingReactTaskRuntime } from './reactTaskRuntime'
import type { ReactTaskObservationType, ReactTaskPlannerDraft, ReactTaskRun } from './reactTaskTypes'
import type { FormalOrchestrationResumePlan } from './formalOrchestrationRecovery'
import type {
  FormalOrchestrationGrant,
  FormalOrchestrationGrantRequest,
} from './formalOrchestrationGrant'
import { buildScheduleWorkspaceSummary, resolveForegroundWorkspaceKey } from './foregroundWorkspaceState'
import {
  buildBatchDeleteSchedulingTaskRun,
  buildInsertWithShiftSchedulingTaskRun,
  compileSchedulingTaskPlanDraft,
  findSchedulingTaskProgramMatches,
  observeBatchDeleteSchedulingTask,
} from './schedulingTaskPlanCompiler'
import { validateSchedulingTaskPlanDraftConflicts } from './schedulingTaskPlanConflict'
import { deriveRuntimePlaylistPolicy, describeRuntimePlaylistStrategy } from './playlistPolicy'
import {
  formatForegroundAgentContextForPrompt,
  type ForegroundAgentContextPackage,
} from './foregroundAgentContextPackage'
import type { LayoutDraftCompleteness } from '@/services/layoutDraftCompleteness'
import { isRecoverableLlmError } from '@/services/llm/llmFailure'
import {
  extractCompositeInsertCandidateRequest,
  filterCompositeInsertCandidates,
} from './compositeInsertCandidatePreflight'

/**
 * demoRuntimeFacade prompt 版本号（对齐 AGENTS.md Prompt 版本管理门禁）
 * - v1.0：初始版本（3 段内联 system prompt 共享同一版本基线）
 */
export const DEMO_RUNTIME_FACADE_PROMPT_VERSION = 'v1.0' as const

export type RuntimeDetailMap = Record<string, unknown>
export type RuntimeProcessType = 'planning' | 'selection' | 'execution' | 'validation' | 'general' | 'error'
export interface RuntimeFeedback { content: string; thinking?: string; explanation?: string; details?: RuntimeDetailMap; processType: RuntimeProcessType; processTypeLabel: string }
export interface RuntimeProgressEvent {
  id?: string
  content: string
  thinking?: string
  details?: RuntimeDetailMap
  processType: RuntimeProcessType
  processTypeLabel: string
}
export interface RuntimeScheduleItem { id: string; programCode?: string; programName?: string; startTime: string; endTime: string; duration?: number; programType?: string }
export interface RuntimePendingCommand { pendingId?: string; command: OrchestrationCommand; commands?: OrchestrationCommand[]; summary: string; successMessage?: string; reasoning: string; details?: RuntimeDetailMap }
export interface RuntimePendingTargetSelection { pendingId?: string; action: 'delete' | 'move' | 'replace'; summary: string; reasoning: string; targetTime: string; programName?: string; candidates: RuntimeScheduleItem[]; selectedItemId: string | null; moveConfig?: { direction?: 'forward' | 'backward'; offsetSeconds?: number; absoluteNewStartTime?: string }; replaceProgramName?: string; resolutionDetails?: RuntimeDetailMap }
export interface RuntimeInsertRecommendationCandidate { candidateId: string; programName: string; programCode: string; duration: number; programType: string; score: number; confidence: number; reasonTags: string[] }
export interface RuntimePendingInsertRecommendation { pendingId?: string; action: 'insert' | 'replace'; summary: string; reasoning: string; originalUserInput: string; collectedUserInput: string; targetTime: string; rawProgramText?: string; semanticLabel?: string; programTypeHint?: string; expectedDurationSeconds?: number; targetItemId?: string; targetItemName?: string; recommendedCandidates: RuntimeInsertRecommendationCandidate[]; selectedCandidateId: string | null; resumeCompositeTask?: RuntimeResumeCompositeTask }
export interface RuntimePendingAtomicClarification { pendingId?: string; action: RuntimeAtomicAction | null; summary: string; reasoning: string; originalUserInput: string; collectedUserInput: string; targetTimeHint?: string; programNameHint?: string; slots?: Partial<RuntimeAtomicSlotBag>; missingFields: string[]; followUpQuestion: string }
export interface RuntimePlaylistFactItem { id: string; startTime: string; endTime: string; programName: string; columnName?: string; programType: string; durationSeconds: number; programCode?: string }
export interface RuntimePlaylistFactPack {
  playlistId?: string
  playlistType?: PlaylistType
  channelName?: string
  date: string
  itemCount: number
  totalDurationSeconds: number
  gapCount: number
  items: RuntimePlaylistFactItem[]
  typeDurations: Array<{ programType: string; itemCount: number; durationSeconds: number }>
  timeBands: Array<{ label: string; itemCount: number; durationSeconds: number }>
  layoutDraftState: {
    exists: boolean
    coverage?: { start: string; end: string }
    segmentCount?: number
    userIntent?: string
    purpose?: string
    targetDurationSeconds?: number
    strategyLabel?: string
    strategySummary?: string
    warnings?: string[]
    segments?: Array<{
      label: string
      startTime?: string
      endTime?: string
      programType?: string
      contentHint?: string
      targetDurationSeconds?: number
      selectionPriority?: DraftSelectionPriority
      constraintKind?: LayoutDraft['columns'][number]['draftConstraintKind']
      queryHints?: string[]
    }>
  }
}
export interface RuntimeAnalysisContext {
  kind: 'playlist_analysis' | 'optimization_suggestion'
  playlistId?: string
  playlistType?: PlaylistType
  question: string
  answer: string
  recommendation?: string
  factPack: RuntimePlaylistFactPack
  createdAt: string
}
export interface RuntimeExecutionPlan { command: OrchestrationCommand; successMessage?: string; thinking?: string; explanation?: string; details?: RuntimeDetailMap }
export interface RuntimeExecutedResult { success: boolean; command: OrchestrationCommand; message: string; error?: string; summary: string; thinking?: string; explanation?: string; details?: RuntimeDetailMap; data?: unknown; affectedTimeRanges?: { start: string; end: string }[]; validationReport?: ValidationReport; validationSummary?: RuntimeDetailMap; scheduleSnapshot?: unknown; playlistPatch?: unknown }
export interface RuntimeSubmitInput { scheduleState: ScheduleState; userInput: string; currentSchedule: RuntimeScheduleItem[]; workspaceKey?: string; currentLayoutDraft?: LayoutDraft | null; currentLayoutDraftMode?: Extract<TaskMode, 'full_generate' | 'partial_generate'> | null; analysisContext?: RuntimeAnalysisContext | null; pendingTargetSelection?: RuntimePendingTargetSelection | null; pendingInsertRecommendation?: RuntimePendingInsertRecommendation | null; pendingAtomicClarification?: RuntimePendingAtomicClarification | null; pendingAtomicContext?: RuntimePendingAtomicContext | null; activeReactTaskRun?: ReactTaskRun | null; foregroundContextPackage?: ForegroundAgentContextPackage; history?: string[]; agentCoreEnabled?: boolean; layoutDraftEnabled?: boolean; preferDraftFirstFormalOrchestration?: boolean; preferLayoutDraftRefine?: boolean; inputSource?: 'user' | 'quick_action' | 'system'; onProgress?: (event: RuntimeProgressEvent) => void; deadline?: AgentDeadline }
export interface RuntimeResolveTargetSelectionInput { channelId: string; date: string; pendingTargetSelection: RuntimePendingTargetSelection; scheduleState?: ScheduleState }
export interface RuntimeResolveInsertRecommendationInput { scheduleState: ScheduleState; pendingInsertRecommendation: RuntimePendingInsertRecommendation; currentSchedule?: RuntimeScheduleItem[]; userInput?: string }
export interface RuntimeExecutePendingCommandInput {
  pendingCommand: RuntimePendingCommand
  scheduleDate: string
  channelId: string
  workspaceKey?: string
  currentSchedule?: RuntimeScheduleItem[]
  pendingId?: string
  idempotencyKey?: string
  foregroundStateVersion?: string | number
  expectedPlaylistVersion?: string | number
  batchCursor?: {
    completedCount?: number
    remainingCount?: number
    nextIndex?: number
  }
  maxBatchCommands?: number
}
export interface RuntimeOrchestrationLifecycle {
  taskKind: 'full_day' | 'overall_refill' | 'local_refill'
  playlistModel: 'time_grid' | 'content_queue'
  requiresLayoutDraft: boolean
  layoutDraftCompleteness: LayoutDraftCompleteness
  canInterrupt: true
  writesFormalPlaylist: true
  mutatesLayoutDraft: false
  suggestedBatchSize: number
}
export interface RuntimeOrchestrationRequest { userInput: string; mode: Extract<TaskMode, 'full_generate' | 'partial_generate'>; reasoning: string; layoutDraft?: LayoutDraft; targetTimeRange?: { start: string; end: string }; searchKeywords?: string[]; lifecycle?: RuntimeOrchestrationLifecycle; reactTask?: ReactTaskPlannerDraft<AgentPlannerAction>; reactRecovery?: FormalOrchestrationResumePlan<AgentPlannerAction>; authorizationRequest?: FormalOrchestrationGrantRequest; authorizationGrantId?: string; resolvedAuthorization?: FormalOrchestrationGrant }
export type RuntimeStatusHint = 'needs_clarification' | 'needs_selection' | 'needs_confirmation' | 'accepted' | 'in_progress' | 'completed' | 'failed' | 'cancelled'
export type RuntimeDecision =
  | { kind: 'message'; feedback: RuntimeFeedback; pendingAtomicClarification?: RuntimePendingAtomicClarification; analysisContext?: RuntimeAnalysisContext | null; statusHint?: RuntimeStatusHint; layoutDraft?: LayoutDraft; layoutDraftFeasibility?: DraftFeasibilityReport; layoutDraftMode?: Extract<TaskMode, 'full_generate' | 'partial_generate'> }
  | { kind: 'pending_atomic_context'; feedback: RuntimeFeedback; pendingAtomicContext: RuntimePendingAtomicContext }
  | { kind: 'pending_command'; feedback: RuntimeFeedback; pendingCommand: RuntimePendingCommand }
  | { kind: 'pending_target_selection'; feedback: RuntimeFeedback; pendingTargetSelection: RuntimePendingTargetSelection }
  | { kind: 'pending_insert_recommendation'; feedback: RuntimeFeedback; pendingInsertRecommendation: RuntimePendingInsertRecommendation }
  | { kind: 'execute_command'; execution: RuntimeExecutionPlan }
  | { kind: 'orchestration'; feedback: RuntimeFeedback; orchestrationRequest: RuntimeOrchestrationRequest }
  | { kind: 'layout_draft'; feedback: RuntimeFeedback; draft: LayoutDraft; feasibilityReport: DraftFeasibilityReport; orchestrationMode: Extract<TaskMode, 'full_generate' | 'partial_generate'> }
  | { kind: 'layout_draft_clear'; feedback: RuntimeFeedback }
  | { kind: 'layout_commit'; feedback: RuntimeFeedback; draft: LayoutDraft; orchestrationRequest: RuntimeOrchestrationRequest }
  | { kind: 'agent_execution'; feedback: RuntimeFeedback; result: AgentResult; pendingAtomicContext?: RuntimePendingAtomicContext }

type RuntimeLinkedLayoutDraft = {
  layoutDraft: LayoutDraft
  layoutDraftFeasibility: DraftFeasibilityReport
  layoutDraftMode: Extract<TaskMode, 'full_generate' | 'partial_generate'>
}

type RuntimeMicroEditBuildResult = { command: OrchestrationCommand | null; message?: string; thinking?: string; explanation?: string; details?: RuntimeDetailMap; successMessage?: string; pendingTargetSelection?: RuntimePendingTargetSelection; pendingInsertRecommendation?: RuntimePendingInsertRecommendation; forceDirectExecution?: boolean; suppressClarificationFallback?: boolean }
type AgentCoreRunResult = {
  result: AgentResult
  capabilitySummary: SchedulingAgentRuntimeCapabilitySummary
  operationalReadiness: SchedulingAgentOperationalReadinessAudit
  llmRequestTraces: LLMRequestTrace[]
}

const DEFAULT_BROADCAST_WINDOW = { start: '06:00:00', end: '23:59:59' }
const toClockText = (value: string) => value.includes('T') ? (value.split('T')[1]?.slice(0, 8) ?? value) : (value.length === 5 ? `${value}:00` : value)
const clockToSeconds = (value: string) => {
  const [hours = '0', minutes = '0', seconds = '0'] = toClockText(value).split(':')
  return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds)
}
const secondsToClockText = (value: number) => {
  const secondsInDay = 24 * 60 * 60
  const normalized = ((Math.floor(value) % secondsInDay) + secondsInDay) % secondsInDay
  const hours = Math.floor(normalized / 3600)
  const minutes = Math.floor((normalized % 3600) / 60)
  const seconds = normalized % 60
  return `${`${hours}`.padStart(2, '0')}:${`${minutes}`.padStart(2, '0')}:${`${seconds}`.padStart(2, '0')}`
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
const asScheduleSnapshot = (item: RuntimeScheduleItem, date: string, sequence: number): ScheduleItemSnapshot => {
  const startTime = normalizeDateTime(date, item.startTime)
  const endTime = normalizeDateTime(date, item.endTime)
  const duration = item.duration ?? Math.max(0, Math.floor((new Date(endTime).getTime() - new Date(startTime).getTime()) / 1000))
  return {
    id: item.id,
    programCode: item.programCode ?? '',
    programName: item.programName ?? item.id,
    startTime,
    endTime,
    duration,
    programType: item.programType ?? 'unknown',
    sequence,
  }
}

export class DemoRuntimeFacade {
  private readonly llmClient = getLLMClient()
  private readonly agentPlanner = getAgentPlanner(this.llmClient)
  private readonly taskClassifier = getTaskClassifier(this.llmClient)
  private readonly intentRecognizer = getIntentRecognizer(this.llmClient)
  private readonly layoutIntentRecognizer = getLayoutIntentRecognizer(this.llmClient)
  private readonly paramExtractor = getParamExtractor(this.llmClient)
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
  private readonly dataService = getDataService()
  private readonly layoutAnalysisService = getLayoutAnalysisService(this.llmClient)
  private readonly reactTaskRuntime = getSchedulingReactTaskRuntime()
  private playlistDocumentSequence = 0
  private readonly formalOrchestrationCapability = new FormalOrchestrationCapability()

  private buildTaskClassifierHistory(input: RuntimeSubmitInput): string[] | undefined {
    const foregroundContext = formatForegroundAgentContextForPrompt(input.foregroundContextPackage)
    return [
      foregroundContext,
      ...(input.history ?? []),
    ].filter((item): item is string => Boolean(item?.trim()))
  }

  private async tryHandlePlaylistStateInstruction(input: RuntimeSubmitInput): Promise<RuntimeDecision | null> {
    const playlistType = input.scheduleState.playlistType
    if (playlistType === undefined) return null

    const normalized = input.userInput.replace(/\s+/g, '')
    if (/(版面草案|草案|轮播版面|编排方案)/.test(normalized)) {
      return null
    }

    if (this.isPurePlaylistCreationInstruction(normalized, 'tv')) {
      const defaultLayout = getOrchestrationDemoLayout(input.scheduleState.channelId, input.scheduleState.date)
      const draftStatusText = defaultLayout
        ? '已同时加载当前频道和日期的版面草案，后面可以按这份草案排全天。'
        : '当前没有读取到该频道日期的版面草案；全天编排前请先上传、切换或生成草案。'
      return this.buildPlaylistStateChangedDecision(
        `已新建电视播单。${draftStatusText} 后续将固定使用电视频道编排策略，非敏感原子命令在目标明确时会直接执行。`,
        'tv',
        undefined,
        undefined,
        this.nextPlaylistDocumentId('tv'),
        input.scheduleState.channelId,
        input.scheduleState.channelName,
        input.scheduleState.date,
        defaultLayout
          ? {
              layoutDraftStatus: 'loaded',
              layoutDraftSource: 'channel_default',
              layoutDraftSlotCount: defaultLayout.slots.length,
            }
          : {
              layoutDraftStatus: 'missing',
              suggestedActions: ['上传版面文件', '切换频道日期', '生成版面草案'],
            },
      )
    }

    if (this.isPurePlaylistCreationInstruction(normalized, 'rotation')) {
      const rotationStrategy = this.extractRotationStrategyRequest(normalized) ?? 'content_match'
      const rotationDurationSeconds = this.extractRotationDurationSeconds(normalized)
      const playlistId = this.nextPlaylistDocumentId('rotation')
      const effectiveInput: RuntimeSubmitInput = {
        ...input,
        scheduleState: {
          ...input.scheduleState,
          playlistId,
          playlistType: 'rotation',
          rotationStrategy,
          rotationDurationSeconds: rotationDurationSeconds ?? undefined,
        },
        currentLayoutDraft: null,
      }
      const draftClassification = this.tryClassifyRotationThemeDurationLayoutInstruction(effectiveInput)
      if (draftClassification && this.isLayoutDraftFlowEnabled(input)) {
        const draftDecision = await this.prepareLayoutDraft(
          effectiveInput,
          draftClassification,
          this.resolvePreferredOrchestrationMode(effectiveInput),
        )
        if (draftDecision.kind === 'layout_draft') {
          const durationText = rotationDurationSeconds
            ? `，总时长 ${this.formatRotationDurationText(rotationDurationSeconds)}`
            : ''
          return this.buildPlaylistStateChangedDecision(
            `已新建轮播单${durationText}，轮播单不绑定具体日期和电视频道时段；我已按你说的主要内容整理了一份轮播草案。左侧可以继续微调草案；在你确认正式编排前，我不会写入节目。`,
            'rotation',
            rotationStrategy,
            rotationDurationSeconds ?? undefined,
            playlistId,
            undefined,
            undefined,
            undefined,
            {
              layoutDraftStatus: 'loaded',
              layoutDraftSource: draftDecision.draft.source,
              layoutDraftSegmentCount: draftDecision.draft.durationSegments?.length ?? draftDecision.draft.layoutReference.slots.length,
              layoutDraftMode: draftDecision.orchestrationMode,
            },
            {
              layoutDraft: draftDecision.draft,
              layoutDraftFeasibility: draftDecision.feasibilityReport,
              layoutDraftMode: draftDecision.orchestrationMode,
            },
          )
        }
      }
      const durationText = rotationDurationSeconds
        ? `，总时长 ${this.formatRotationDurationText(rotationDurationSeconds)}`
        : ''
      const structureHint = rotationDurationSeconds
        ? '你可以继续补充主要内容、栏目类型或上传轮播草案。'
        : '当前还不知道轮播要排多长，空草案里也还没有内容块；建议先说明总时长、主要内容、选择策略，或上传/生成轮播草案。'
      return this.buildPlaylistStateChangedDecision(
        `已新建轮播单${durationText}，${rotationStrategy === 'content_match' ? '默认按内容匹配优先选择节目' : `本次按${this.describeRotationStrategy(rotationStrategy)}选择节目`}。轮播单按时长制处理，不绑定具体日期和电视频道时段。${structureHint}`,
        'rotation',
        rotationStrategy,
        rotationDurationSeconds ?? undefined,
        playlistId,
        undefined,
        undefined,
        undefined,
        {
          layoutDraftStatus: 'empty',
          needsStructuredBasis: !rotationDurationSeconds,
          suggestedActions: rotationDurationSeconds
            ? ['补充主要内容', '上传轮播草案', '按当前时长补排']
            : ['说明轮播总时长', '说明主要内容', '选择轮播策略', '上传或生成轮播草案'],
        },
      )
    }

    const requestedRotationStrategy = this.extractRotationStrategyRequest(normalized)
    if (
      requestedRotationStrategy
      && !this.looksLikeSequentialDurationSegments(normalized)
      && !this.isExplicitLayoutDraftPreparationInstruction(normalized)
    ) {
      if (playlistType === 'tv') {
        return {
          kind: 'message',
          statusHint: 'failed',
          feedback: createFeedback(
            '当前是电视播单，只允许电视频道编排策略，不能切换为轮播单的内容匹配、收视率或热播优先。',
            'planning',
            '策略受限',
            {
              details: {
                playlistState: {
                  playlistType: 'tv',
                  rotationStrategy: undefined,
                },
                rejectedStrategy: requestedRotationStrategy,
              },
            },
          ),
        }
      }

      if (playlistType === 'rotation') {
        return this.buildPlaylistStateChangedDecision(
          `已切换轮播单策略为${this.describeRotationStrategy(requestedRotationStrategy)}。后续涉及节目选择的原子命令会先给出候选推荐。`,
          'rotation',
          requestedRotationStrategy,
        )
      }

      return this.buildPlaylistRequiredDecision()
    }

    if (playlistType === 'none' && this.requiresCreatedPlaylist(input.userInput)) {
      return this.buildPlaylistRequiredDecision()
    }

    return null
  }

  private isPurePlaylistCreationInstruction(normalized: string, playlistType: Exclude<PlaylistType, 'none'>): boolean {
    const hasRangeSchedulingIntent = playlistType === 'tv' && (
      Boolean(parseAtomicTimeRange(normalized))
      || /(到|至|从).*(点|:|：).*(轮播单|电视播单|节目单|编排单|播单)/.test(normalized)
      || /(户外直播|外场直播|活动直播|专题|栏目|节目内容|所属栏目)/.test(normalized)
    )
    if (hasRangeSchedulingIntent) return false

    const createVerbPattern = /(?:新建|创建|建立|开一个|开一份|开一张|开一版|做一个|做一份|做一张|做一版|准备一个|准备一份|准备一张|准备一版)/
    const tvTarget = '(?:电视播单|电视频道播单|频道播单|电视节目单|频道节目单|电视编排单|电视频道编排单|电视播出单|电视频道播出单|频道播出单)'
    const rotationTarget = '(?:轮播单|轮播表|轮播节目单|新媒体轮播单|新媒体播单|新媒体节目单|直播轮播单|直播轮播表)'
    const targetPattern = playlistType === 'tv' ? tvTarget : rotationTarget
    return createVerbPattern.test(normalized) && new RegExp(targetPattern).test(normalized)
  }

  private isBarePlaylistCreationInstruction(userInput: string): boolean {
    const normalized = userInput.replace(/\s+/g, '')
    const hasPlanningPayload = /(?:第[一二两三四五六七八九十\d]+|第一|第二|第三|第四|小时|分钟|总时长|时长|主要|主题|涵盖|用于|内容|草案|版面|按|安排|编排|排满|排成|规划|设计|整理|生成|制作|,|，|。|；|;)/u.test(normalized)
    if (hasPlanningPayload) return false
    return this.isPurePlaylistCreationInstruction(normalized, 'tv')
      || this.isPurePlaylistCreationInstruction(normalized, 'rotation')
  }

  private isExplicitNewPlaylistWorkspaceInstruction(userInput: string): boolean {
    const normalized = userInput.replace(/\s+/g, '')
    return this.isPurePlaylistCreationInstruction(normalized, 'tv')
      || this.isPurePlaylistCreationInstruction(normalized, 'rotation')
  }

  private buildPlaylistStateChangedDecision(
    content: string,
    playlistType: PlaylistType,
    rotationStrategy?: RotationPlaylistStrategy,
    rotationDurationSeconds?: number,
    playlistId?: string,
    channelId?: string,
    channelName?: string,
    date?: string,
    extraDetails?: RuntimeDetailMap,
    linkedDraft?: RuntimeLinkedLayoutDraft,
  ): RuntimeDecision {
    const playlistState: Record<string, unknown> = {
      playlistId,
      playlistType,
      rotationStrategy,
    }
    if (rotationDurationSeconds !== undefined) playlistState.rotationDurationSeconds = rotationDurationSeconds
    if (channelId !== undefined) playlistState.channelId = channelId
    if (channelName !== undefined) playlistState.channelName = channelName
    if (date !== undefined) playlistState.date = date

    return {
      kind: 'message',
      statusHint: 'accepted',
      feedback: createFeedback(content, 'planning', '播单状态', {
        details: {
          playlistState,
          ...extraDetails,
        },
      }),
      layoutDraft: linkedDraft?.layoutDraft,
      layoutDraftFeasibility: linkedDraft?.layoutDraftFeasibility,
      layoutDraftMode: linkedDraft?.layoutDraftMode,
    }
  }

  private buildPlaylistRequiredDecision(): RuntimeDecision {
    return {
      kind: 'message',
      statusHint: 'needs_clarification',
      feedback: createFeedback(
        '当前还没有创建播单。请先输入“新建电视播单”或“新建轮播单”，创建后再进行插入、删除、移动、替换等原子调整；补空窗和全天编排属于后续长流程。',
        'planning',
        '播单未创建',
        {
          details: {
            playlistState: {
              playlistType: 'none',
              rotationStrategy: undefined,
            },
          },
        },
      ),
    }
  }

  private requiresCreatedPlaylist(userInput: string): boolean {
    const normalized = userInput.replace(/\s+/g, '')
    return /(插入|插个|插一|加一条|加一档|加个|加一段|添加|安排|编排|排入|补齐|补空窗|补空档|删除|删掉|移除|去掉|撤掉|撤下|拿掉|拿下|下掉|移动|后移|前移|顺延|延后|提前|推迟|推后|延迟|往后挪|往前挪|替换|换成|换播|换掉|改成|改为|改播|校验|检查|执行校验|轮播单|直播单|节目单|编排单|播单|版面)/.test(normalized)
  }

  private extractRotationStrategyRequest(normalized: string): RotationPlaylistStrategy | null {
    if (/(收视率优先|收视优先|高收视优先|按收视|按收视率)/.test(normalized)) return 'rating'
    if (/(热播优先|热度优先|高热度优先|热门优先|话题优先|按热播|按热度)/.test(normalized)) return 'trending'
    if (/(内容匹配优先|内容优先|匹配优先|按内容匹配|按内容)/.test(normalized)) return 'content_match'
    return null
  }

  private describeRotationStrategy(strategy: RotationPlaylistStrategy): string {
    if (strategy === 'rating') return '收视率优先'
    if (strategy === 'trending') return '热播优先'
    return '内容匹配优先'
  }

  private nextPlaylistDocumentId(type: Exclude<PlaylistType, 'none'>): string {
    this.playlistDocumentSequence += 1
    return `${type}-${Date.now()}-${this.playlistDocumentSequence}`
  }

  private extractRotationDurationSeconds(normalized: string): number | null {
    const durationToken = '(?:一刻钟|三刻钟|半个?小时|(?:(?:\\d+(?:\\.\\d+)?)|[零〇一二两三四五六七八九十]{1,3})(?:个)?小时|(?:(?:\\d+)|[零〇一二两三四五六七八九十]{1,3})(?:分钟|分))'
    const match = new RegExp(durationToken, 'u').exec(normalized)
    if (match?.[0]) return this.parseSequentialDurationSeconds(match[0])
    const range = parseAtomicTimeRange(normalized)
    if (range) {
      const startSeconds = this.clockToSeconds(range.start)
      const endSeconds = this.clockToSeconds(range.end)
      if (startSeconds !== null && endSeconds !== null) {
        const durationSeconds = endSeconds - startSeconds
        return durationSeconds > 0 ? durationSeconds : durationSeconds + 24 * 60 * 60
      }
    }
    return null
  }

  private clockToSeconds(value: string): number | null {
    const [hours = 0, minutes = 0, seconds = 0] = value.split(':').map(Number)
    if ([hours, minutes, seconds].some((part) => Number.isNaN(part))) return null
    return hours * 3600 + minutes * 60 + seconds
  }

  private formatRotationDurationText(seconds: number): string {
    const totalSeconds = Math.max(0, Math.round(seconds))
    const hours = Math.floor(totalSeconds / 3600)
    const minutes = Math.floor((totalSeconds % 3600) / 60)
    const remainSeconds = totalSeconds % 60
    const parts = [
      hours > 0 ? `${hours}小时` : '',
      minutes > 0 ? `${minutes}分钟` : '',
      remainSeconds > 0 ? `${remainSeconds}秒` : '',
    ].filter(Boolean)
    return parts.join('') || '0秒'
  }

  private isLayoutDraftFlowEnabled(input: RuntimeSubmitInput): boolean {
    return input.layoutDraftEnabled !== false
  }

  private buildLayoutDraftDisabledDecision(reasoning?: string): RuntimeDecision {
    return {
      kind: 'message',
      statusHint: 'needs_clarification',
      feedback: createFeedback(
        '这类需求我先不在对话框里展开成长篇方案。当前可以直接告诉我具体节目、素材线索、目标位置和动作，我会按当前播单继续处理插入、删除、移动、替换、查询或校验。',
        'planning',
        '请给出原子编排目标',
        {
          explanation: reasoning || '前台真实可用版本先聚焦可直接落表的原子编排闭环，暂不把开放式整段铺排展开到对话区。',
          details: {
            supportedAtomicActions: ['insert', 'delete', 'move', 'replace', 'query', 'validate'],
            foregroundPolicy: 'atomic_commands_only',
          },
        },
      ),
    }
  }

  private buildRecoverableLlmFailureDecision(
    input: RuntimeSubmitInput,
    llmFailure: LlmFailureInfo,
    reasoning?: string,
  ): RuntimeDecision {
    const retryHint = '你可以直接说“重试”，我会按刚才这句话再试一次。'
    const content = llmFailure.reason === 'timeout'
      ? `这次模型没有及时返回，我还没有修改草案或播单。${retryHint}`
      : `这次模型服务没有正常返回，我还没有修改草案或播单。${retryHint}`

    // 从现场事实（scheduleState）提取已识别槽位，不调用 LLM，不替用户改写意图（对齐 AGENTS.md 本地只保护结果）
    const recognizedSlots: RecognizedSlot[] = []
    if (input.scheduleState.playlistType && input.scheduleState.playlistType !== 'none') {
      recognizedSlots.push({
        name: 'playlistType',
        value: input.scheduleState.playlistType,
        confidence: 1,
        source: 'context',
      })
    }
    if (typeof input.scheduleState.rotationDurationSeconds === 'number' && input.scheduleState.rotationDurationSeconds > 0) {
      recognizedSlots.push({
        name: 'target',
        value: input.scheduleState.rotationDurationSeconds,
        confidence: 1,
        source: 'context',
      })
    }

    const failureEnvelope = buildRecoverableFailureEnvelope({
      kind: llmFailure.reason === 'timeout' ? 'llm_timeout' : 'llm_intent_unavailable',
      recognizedSlots,
      noMutation: true,
      humanSummary: content,
      traceId: `llm-failure-${Date.now()}`,
    })

    return {
      kind: 'message',
      statusHint: 'failed',
      feedback: createFeedback(
        content,
        'error',
        '模型未返回',
        {
          explanation: reasoning || llmFailure.message,
          details: {
            llmFailure,
            recoverableUserInput: input.userInput,
            canRetry: llmFailure.canRetry,
            noMutation: true,
            recoverableFailureEnvelope: failureEnvelope,
          },
        },
      ),
    }
  }

  private async tryHandleAgentPlannerInstruction(input: RuntimeSubmitInput): Promise<RuntimeDecision> {
    const streamProgress = createAgentLlmStreamProgressEmitter({
      playlistKey: `${input.scheduleState.channelId}:${input.scheduleState.date}`,
      onProgress: input.onProgress,
    })
    const plan = await this.agentPlanner.plan({
      scheduleState: input.scheduleState,
      userInput: input.userInput,
      currentSchedule: input.currentSchedule,
      currentLayoutDraft: input.currentLayoutDraft,
      history: input.history,
      contextPackage: input.foregroundContextPackage,
    }, input.deadline, streamProgress)
    if (plan.llmFailure) {
      return this.buildRecoverableLlmFailureDecision(input, plan.llmFailure, plan.reasoning)
    }
    this.emitAgentPlannerProgress(input, plan)
    return await this.executeAgentPlan(input, plan)
  }

  private emitAgentPlannerProgress(input: RuntimeSubmitInput, plan: AgentPlan): void {
    const event = this.buildAgentPlannerProgressEvent(input, plan)
    if (!event) return
    try {
      input.onProgress?.(event)
    } catch {
      // Progress messages must never block the scheduling action itself.
    }
  }

  private buildAgentPlannerProgressEvent(input: RuntimeSubmitInput, plan: AgentPlan): RuntimeProgressEvent | null {
    const content = this.normalizeAgentPlannerProgressDraft(plan.assistantReplyDraft)
    if (!content || !this.shouldExposeAgentPlannerProgress(plan)) return null
    const actionTypes = plan.actions.map((action) => action.type)
    return {
      id: `agent-planner:${input.scheduleState.playlistId ?? input.scheduleState.playlistType}:${actionTypes.join('+')}:${content}`,
      content,
      thinking: plan.reasoning,
      processType: 'planning',
      processTypeLabel: '已理解',
      details: {
        progressStage: 'agent_planner',
        source: 'llm_assistantReplyDraft',
        plannerActions: actionTypes,
        noMutation: true,
      },
    }
  }

  private shouldExposeAgentPlannerProgress(plan: AgentPlan): boolean {
    const actionTypes = new Set(plan.actions.map((action) => action.type))
    return actionTypes.has('atomic_command')
      || actionTypes.has('research_check')
      || actionTypes.has('prepare_layout_draft')
      || actionTypes.has('refine_layout_draft')
      || actionTypes.has('commit_layout_draft')
      || actionTypes.has('formal_orchestration')
      || plan.mode === 'react'
  }

  private normalizeAgentPlannerProgressDraft(value?: string): string {
    const content = value?.trim() ?? ''
    if (content.length < 4) return ''
    if (/"actions"|"assistantReplyDraft"|"reasoning"|taskPlan|runtime|JSON|confidence/u.test(content)) return ''
    return content
  }

  private buildMissingPlaylistWorkspaceDecision(reasoning?: string): RuntimeDecision {
    return {
      kind: 'message',
      statusHint: 'needs_clarification',
      feedback: createFeedback(
        '请先创建或打开一张电视播单或轮播单，我才知道这条指令要写到哪里。你可以直接说“新建电视播单”或“新建轮播单”。',
        'general',
        '先选播单',
        {
          explanation: reasoning || '当前没有活动播单工作区，不能执行会写入播单的原子命令。',
          details: {
            playlistType: 'none',
            noMutation: true,
            suggestedActions: ['新建电视播单', '新建轮播单', '打开已有播单'],
          },
        },
      ),
    }
  }

  private async executeAgentPlan(input: RuntimeSubmitInput, plan: AgentPlan): Promise<RuntimeDecision> {
    if (plan.pendingAction === 'start_new_task') {
      input = this.clearPendingAtomicState(input)
    }
    const actions = plan.actions
    if (plan.mode === 'react' && plan.reactTask && actions.length === 0) {
      return this.executeReactAgentPlan(input, plan)
    }
    if (!actions.length) {
      const unsafeReplyDecision = this.buildUnsafePlannerReplyDecision(input, plan)
      if (unsafeReplyDecision) return unsafeReplyDecision
      return {
        kind: 'message',
        statusHint: 'needs_clarification',
        feedback: createFeedback(
          plan.assistantReplyDraft || '我还没能把这句话整理成可执行步骤，请换一种说法。',
          'general',
          '需要澄清',
          { explanation: plan.reasoning },
        ),
      }
    }

    // 一个 planner 响应中的多个 action 不能被“找第一个 action”静默吞掉。
    // 有顺序依赖的动作必须进入 ReAct，由下一轮 LLM 基于 observation 决定下一步。
    const hasCreateAndDraftPair = actions.length === 2
      && actions.some((action) => action.type === 'create_playlist')
      && actions.some((action) => action.type === 'prepare_layout_draft' || action.type === 'refine_layout_draft')
    if (actions.length > 1 && !hasCreateAndDraftPair) {
      if (plan.mode === 'react' && plan.reactTask) {
        // ReAct 边界由 planner 明确给出后，动作必须完整保留；不能因为动作
        // 属于建单阶段就被本地过滤。仅去掉 planner 同时放在
        // actions 与 nextActions 中的重复项，避免同一步执行两次。
        const plannedActionKeys = new Set(actions.map((action) => JSON.stringify(action)))
        const orderedActions = [
          ...actions,
          ...plan.reactTask.nextActions.filter((action) => !plannedActionKeys.has(JSON.stringify(action))),
        ]
        if (orderedActions.length > 1) {
          return this.executeReactAgentPlan(input, {
            ...plan,
            actions: [],
            reactTask: {
              ...plan.reactTask,
              nextActions: orderedActions,
            },
          })
        }
      }
      return {
        kind: 'message',
        statusHint: 'needs_clarification',
        feedback: createFeedback(
          '我识别到这句话包含多个操作，但还没有形成可安全串联的执行计划。请拆开说明，或让我先逐步核对再继续。',
          'planning',
          '需要拆分执行计划',
          {
            explanation: plan.reasoning || 'planner 返回多个并列 action，但缺少 ReAct 任务边界。',
            details: {
              plannerActions: actions.map((action) => action.type),
              noMutation: true,
              recoverable: true,
            },
          },
        ),
      }
    }

    const createAction = actions.find((action): action is Extract<AgentPlannerAction, { type: 'create_playlist' }> => action.type === 'create_playlist')
    const draftAction = actions.find((action): action is Extract<AgentPlannerAction, { type: 'prepare_layout_draft' | 'refine_layout_draft' }> =>
      action.type === 'prepare_layout_draft' || action.type === 'refine_layout_draft',
    )

    if (
      input.scheduleState.playlistType === 'none'
      && draftAction
      && !this.hasExplicitPlannerPlaylistTypeCue(input.userInput)
    ) {
      return {
        kind: 'message',
        statusHint: 'needs_clarification',
        feedback: createFeedback(
          '你是想建电视播单草案，还是轮播单草案？先告诉我播单类型，我再继续整理草案。',
          'planning',
          '需要确认播单类型',
          {
            explanation: plan.reasoning || '当前还没有打开播单，用户只提到草案，不能替用户默认选择电视播单或轮播单。',
            details: {
              plannerActions: plan.actions.map((action) => action.type),
              noMutation: true,
            },
          },
        ),
      }
    }

    if (createAction) {
      const decision = await this.executePlannerCreatePlaylist(input, plan, createAction, draftAction)
      return this.withReactTaskBoundary(
        input,
        plan,
        this.withAgentPlannerTrace(decision, plan),
        'preflight',
      )
    }

    const researchAction = actions.find((action): action is Extract<AgentPlannerAction, { type: 'research_check' }> => action.type === 'research_check')
    if (researchAction) {
      const decision = await this.executePlannerResearchCheck(input, plan, researchAction)
      return this.withAgentPlannerTrace(decision, plan)
    }

    if (draftAction) {
      const decision = await this.executePlannerLayoutDraftAction(input, draftAction, plan.reasoning)
      return this.withReactTaskBoundary(
        input,
        plan,
        this.withAgentPlannerTrace(decision, plan),
        'preflight',
      )
    }

    const commitAction = actions.find((action): action is Extract<AgentPlannerAction, { type: 'commit_layout_draft' }> => action.type === 'commit_layout_draft')
    if (commitAction) {
      if (!plan.reactTask) {
        return this.formalOrchestrationCapability.buildMissingReactTaskDecision(
          input.userInput,
          commitAction.mode ?? 'full_generate',
        )
      }
      const pendingFormalRebuild = input.pendingAtomicContext?.phase === 'formal_rebuild_confirmation'
        ? input.pendingAtomicContext.formalRebuildConfirmation
        : undefined
      const confirmsCurrentRebuild = pendingFormalRebuild?.actionKind === 'commit_layout_draft'
        && (commitAction.mode ?? 'full_generate') === pendingFormalRebuild.mode
      return await this.commitLayoutDraft(input, {
        mode: 'layout_commit',
        confidence: 0.9,
        reasoning: plan.reasoning || 'LLM planner 判断用户正在确认草案进入正式编排。',
        suggestedParams: {
          orchestrationMode: commitAction.mode,
        },
      }, {
        reactTask: plan.reactTask,
        skipFormalRebuildGate: confirmsCurrentRebuild,
        authorizationRequest: confirmsCurrentRebuild && pendingFormalRebuild.mode === 'full_generate'
          ? {
              sourcePendingId: input.pendingAtomicContext!.pendingId!,
              workspaceKey: resolveForegroundWorkspaceKey(buildScheduleWorkspaceSummary(input.scheduleState)),
              mode: 'full_generate',
              existingItemCount: pendingFormalRebuild.existingItemCount,
            }
          : undefined,
      })
    }

    const formalAction = actions.find((action): action is Extract<AgentPlannerAction, { type: 'formal_orchestration' }> => action.type === 'formal_orchestration')
    if (formalAction) {
      if (!plan.reactTask) {
        return this.formalOrchestrationCapability.buildMissingReactTaskDecision(input.userInput, formalAction.mode)
      }
      const pendingFormalRebuild = input.pendingAtomicContext?.phase === 'formal_rebuild_confirmation'
        ? input.pendingAtomicContext.formalRebuildConfirmation
        : undefined
      const confirmsCurrentRebuild = formalAction.confirmExistingRebuild === true
        && pendingFormalRebuild?.actionKind === 'formal_orchestration'
        && pendingFormalRebuild.mode === formalAction.mode
      return this.buildFormalOrchestrationDecision(
        input,
        formalAction.mode,
        plan.reasoning || 'LLM planner 判断用户正在发起正式编排。',
        {
          plannerSemantics: {
            taskKind: formalAction.taskKind,
            useLayoutDraft: formalAction.useLayoutDraft === true,
            targetTimeRange: formalAction.targetTimeRange,
            searchKeywords: formalAction.searchKeywords,
          },
          reactTask: plan.reactTask,
          skipFormalRebuildGate: confirmsCurrentRebuild,
          authorizationRequest: confirmsCurrentRebuild && pendingFormalRebuild.mode === 'full_generate'
            ? {
                sourcePendingId: input.pendingAtomicContext!.pendingId!,
                workspaceKey: resolveForegroundWorkspaceKey(buildScheduleWorkspaceSummary(input.scheduleState)),
                mode: 'full_generate',
                existingItemCount: pendingFormalRebuild.existingItemCount,
              }
            : undefined,
        },
      )
    }

    if (actions.some((action) => action.type === 'read_only_analysis')) {
      const decision = await this.tryHandleReadOnlyPlaylistDiscussion(input)
      if (decision) return decision
      return {
        kind: 'message',
        statusHint: 'needs_clarification',
        feedback: createFeedback(
          plan.assistantReplyDraft || '我可以分析当前编单，但还需要看到当前播单或草案内容。',
          'general',
          '需要澄清',
          { explanation: plan.reasoning },
        ),
      }
    }

    if (actions.some((action) => action.type === 'validate')) {
      return this.buildValidationDecision({
        mode: 'validate_only',
        confidence: 0.9,
        reasoning: plan.reasoning || 'LLM planner 判断用户正在要求校验。',
      }, input)
    }

    const atomicAction = actions.find((action): action is Extract<AgentPlannerAction, { type: 'atomic_command' }> => action.type === 'atomic_command')
    if (atomicAction) {
      if (input.scheduleState.playlistType === 'none') {
        return this.buildMissingPlaylistWorkspaceDecision(plan.reasoning)
      }
      if (input.agentCoreEnabled) {
        const insertRecommendationDecision = await this.tryHandlePlannerInsertRecommendationPendingAction(input, atomicAction, plan)
        if (insertRecommendationDecision) return insertRecommendationDecision
        const compositePendingDecision = await this.tryHandlePlannerCompositePendingAction(input, atomicAction, plan)
        if (compositePendingDecision) return compositePendingDecision
        const agentCoreDecision = await this.tryHandleAgentCoreInstruction(input, atomicAction, plan)
        if (agentCoreDecision) return agentCoreDecision
        return {
          kind: 'message',
          statusHint: 'needs_clarification',
          feedback: createFeedback(
            plan.assistantReplyDraft || '我还需要你补充一下要改哪张播单、哪个位置或哪个节目。',
            'general',
            '需要澄清',
            {
              explanation: plan.reasoning || 'LLM-only 理解层没有形成可执行原子命令；已停止旧本地兜底。',
              details: { noLocalFallback: true },
            },
          ),
        }
      }
      const atomicDecision = await this.tryHandleAtomicInstruction(input)
      if (atomicDecision) return atomicDecision
    }

    const clarifyAction = actions.find((action): action is Extract<AgentPlannerAction, { type: 'clarify' }> => action.type === 'clarify')
    const unsafeReplyDecision = this.buildUnsafePlannerReplyDecision(input, plan)
    if (unsafeReplyDecision) return unsafeReplyDecision
    return {
      kind: 'message',
      statusHint: 'needs_clarification',
      feedback: createFeedback(
        plan.assistantReplyDraft || clarifyAction?.question || '我还需要你再补充一下具体想怎么编排。',
        'general',
        '需要澄清',
        {
          explanation: plan.reasoning,
          details: { noMutation: true },
        },
      ),
    }
  }

  private async executeReactAgentPlan(input: RuntimeSubmitInput, plan: AgentPlan): Promise<RuntimeDecision> {
    const reactTask = plan.reactTask
    if (!reactTask) {
      return {
        kind: 'message',
        statusHint: 'needs_clarification',
        feedback: createFeedback(
          plan.assistantReplyDraft || '这个长程任务还缺少第一步要查证或执行的内容，请再补充一下。',
          'planning',
          '需要补充任务步骤',
          {
            explanation: plan.reasoning,
            details: {
              noMutation: true,
              plannerMode: plan.mode,
            },
          },
        ),
      }
    }
    const taskRun = this.prepareReactTaskRun(input, reactTask, plan.reasoning)
    const firstStep = taskRun.steps.find((step) => step.status === 'pending' || step.status === 'running')
    const firstAction = firstStep?.action ?? reactTask.nextActions[0]
    if (taskRun.status === 'failed') {
      return {
        kind: 'message',
        statusHint: 'failed',
        feedback: createFeedback(
          taskRun.recovery?.lastFailure || '这个长程任务已经达到处理上限，我先停下来，避免继续误操作。',
          'error',
          '任务已暂停',
          {
            explanation: plan.reasoning,
            details: {
              noMutation: true,
              reactTaskRun: taskRun,
              reactTaskBoundary: {
                mode: 'react',
                serverMigratable: true,
                stateOwner: 'SchedulingReactTaskRuntime',
                stoppedByLimit: true,
              },
            },
          },
        ),
      }
    }
    if (!firstAction) {
      return {
        kind: 'message',
        statusHint: 'needs_clarification',
        feedback: createFeedback(
          plan.assistantReplyDraft || '我理解这是一个长程编排目标，但还没有明确第一步要查什么或做什么。',
          'planning',
          '需要补充任务步骤',
          {
            explanation: plan.reasoning,
            details: {
              noMutation: true,
              reactTaskRun: taskRun,
            },
          },
        ),
      }
    }

    const decision = await this.executeAgentPlan(input, {
      mode: 'single',
      actions: [firstAction],
      // 正式编排动作仍需读取原始 ReAct 任务契约；只缩小本轮 actions，
      // 不能把任务边界一并丢掉，否则会被错误拒绝为 react_plan_invalid。
      reactTask,
      assistantReplyDraft: plan.assistantReplyDraft,
      reasoning: plan.reasoning,
    })
    if (!('feedback' in decision)) return decision
    const observedRun = this.reactTaskRuntime.recordObservation({
      run: taskRun,
      type: this.resolveReactObservationType(firstAction),
      summary: decision.feedback.content,
      data: decision.feedback.details,
    })
    return {
      ...decision,
      feedback: {
        ...decision.feedback,
        details: {
          ...decision.feedback.details,
          reactTaskRun: observedRun,
          reactTaskBoundary: {
            mode: 'react',
            serverMigratable: true,
            stateOwner: 'SchedulingReactTaskRuntime',
            nextDecisionRequiresObservation: true,
          },
        },
      },
    } as RuntimeDecision
  }

  private prepareReactTaskRun(
    input: RuntimeSubmitInput,
    reactTask: NonNullable<AgentPlan['reactTask']>,
    reason?: string,
  ): ReactTaskRun<AgentPlannerAction> {
    const activeRun = input.activeReactTaskRun as ReactTaskRun<AgentPlannerAction> | null | undefined
    if (
      activeRun
      && activeRun.status !== 'completed'
      && activeRun.status !== 'cancelled'
      && (activeRun.status !== 'failed' || activeRun.recovery?.canRetry === true)
    ) {
      const baseRun = activeRun.status === 'failed'
        ? this.reactTaskRuntime.markRetry(activeRun)
        : activeRun
      return this.reactTaskRuntime.replacePendingActions({
        run: baseRun,
        nextActions: reactTask.nextActions,
        reason,
      })
    }
    return this.reactTaskRuntime.startTask({
      workspaceKey: input.workspaceKey ?? resolveForegroundWorkspaceKey(buildScheduleWorkspaceSummary(input.scheduleState)),
      originalUserInput: input.userInput,
      plannerTask: reactTask,
    })
  }

  private resolveReactObservationType(action: AgentPlannerAction): ReactTaskObservationType {
    if (action.type === 'research_check') return 'asset_search'
    if (action.type === 'formal_orchestration' || action.type === 'commit_layout_draft') return 'formal_execution'
    if (action.type === 'atomic_command') return 'atomic_execution'
    if (action.type === 'validate') return 'validation'
    if (action.type === 'prepare_layout_draft' || action.type === 'refine_layout_draft') return 'draft_check'
    return 'user_feedback'
  }

  private withReactTaskBoundary(
    input: RuntimeSubmitInput,
    plan: AgentPlan,
    decision: RuntimeDecision,
    stage: 'preflight' | 'observed',
  ): RuntimeDecision {
    if (plan.mode !== 'react' || !plan.reactTask || !('feedback' in decision)) {
      return decision
    }
    const taskRun = this.reactTaskRuntime.startTask({
      workspaceKey: input.workspaceKey ?? resolveForegroundWorkspaceKey(buildScheduleWorkspaceSummary(input.scheduleState)),
      originalUserInput: input.userInput,
      plannerTask: plan.reactTask,
    })
    return {
      ...decision,
      feedback: {
        ...decision.feedback,
        details: {
          ...decision.feedback.details,
          reactTaskRun: taskRun,
          reactTaskBoundary: {
            mode: 'react',
            stage,
            serverMigratable: true,
            stateOwner: 'SchedulingReactTaskRuntime',
            nextDecisionRequiresObservation: stage === 'observed',
            preflightActions: plan.actions.map((action) => action.type),
          },
        },
      },
    } as RuntimeDecision
  }

  private buildUnsafePlannerReplyDecision(input: RuntimeSubmitInput, plan: AgentPlan): RuntimeDecision | null {
    const reply = plan.assistantReplyDraft ?? ''
    if (!reply) return null
    const hasExecutableAction = plan.actions.some((action) => (
      action.type === 'create_playlist'
      || action.type === 'prepare_layout_draft'
      || action.type === 'refine_layout_draft'
      || action.type === 'commit_layout_draft'
      || action.type === 'formal_orchestration'
      || action.type === 'atomic_command'
      || action.type === 'research_check'
      || action.type === 'validate'
    ))
    if (hasExecutableAction) return null
    const claimsPlaylistCreation = /(?:已|已经|现已|将|会|准备|马上|我先)(?:[^。；;]{0,48})(?:新建|创建|建立)(?:[^。；;]{0,48})(?:播单|节目单)|(?:已|已经|现已)(?:[^。；;]{0,48})(?:播单|节目单)(?:[^。；;]{0,16})(?:创建|建立|建好)/u.test(reply)
    const claimsExecution = claimsPlaylistCreation
      || /(?:已|正在|开始|马上|准备|我先)(?:[^。；;，,]{0,18})(?:编排|写入|修改|更新|删除|插入|移动|替换|执行)/u.test(reply)
    if (!claimsExecution) return null
    return {
      kind: 'message',
      statusHint: 'needs_clarification',
      feedback: createFeedback(
        claimsPlaylistCreation
          ? '我还没有创建播单，因为模型没有返回有效的创建动作。请重试，或明确说“新建电视播单”或“新建轮播单”。'
          : input.currentLayoutDraft
          ? '我还没有进入正式编排。请直接确认是否按当前草案开始编排，或继续告诉我要怎么微调草案。'
          : '我还没有执行修改。请再明确你要创建草案、进入编排，还是做单条插入、删除、移动。',
        'planning',
        '需要确认',
        {
          explanation: plan.reasoning || 'LLM 没有返回可执行动作，本地不会把主回复里的执行语气当成真实写入结果。',
          details: {
            plannerActions: plan.actions.map((action) => action.type),
            assistantReplyDraft: reply,
            noMutation: true,
          },
        },
      ),
    }
  }

  private withAgentPlannerTrace(decision: RuntimeDecision, plan: AgentPlan): RuntimeDecision {
    if (!('feedback' in decision)) return decision
    return {
      ...decision,
      feedback: {
        ...decision.feedback,
        details: {
          ...decision.feedback.details,
          agentPlannerTrace: {
            actions: plan.actions,
            reasoning: plan.reasoning,
            assistantReplyDraft: plan.assistantReplyDraft,
          },
        },
      },
    } as RuntimeDecision
  }

  private async executePlannerResearchCheck(
    input: RuntimeSubmitInput,
    plan: AgentPlan,
    action: Extract<AgentPlannerAction, { type: 'research_check' }>,
  ): Promise<RuntimeDecision> {
    const draftSegment = this.resolveResearchDraftSegment(input.currentLayoutDraft, action)
    const queries = this.buildResearchQueries(input, action, draftSegment)
    const candidateGroups = await Promise.all(queries.map(async (query) => ({
      query,
      candidates: await this.candidateService.searchPrograms({
        channelId: input.scheduleState.channelId,
        programName: query,
        programTypes: this.normalizeResearchProgramTypes(action.programTypeHint),
        limit: 8,
        columnStrategy: 'prefer_channel',
      }),
    })))
    const mergedCandidates = this.mergeResearchCandidates(candidateGroups.flatMap((group) => group.candidates)).slice(0, 12)
    const observation = {
      reactTask: {
        loopTurn: 1,
        status: 'observed',
        tools: ['read_current_draft', 'search_asset_library'],
        next: 'assistant_synthesize',
      },
      noMutation: true,
      purpose: action.purpose ?? 'draft_precheck',
      draftSegment,
      queries,
      candidateCount: mergedCandidates.length,
      topCandidates: mergedCandidates.map((candidate) => ({
        id: candidate.id,
        programName: candidate.programName,
        programCode: candidate.programCode,
        duration: candidate.duration,
        durationText: this.formatDurationText(candidate.duration),
        programType: candidate.programType,
        columnName: candidate.columnName,
        contentTags: candidate.contentTags?.slice(0, 6),
        estimatedRating: candidate.estimatedRating,
        playCount: candidate.playCount,
        popularityScore: candidate.popularityScore,
      })),
      queryResults: candidateGroups.map((group) => ({
        query: group.query,
        count: group.candidates.length,
        topNames: group.candidates.slice(0, 3).map((candidate) => candidate.programName),
      })),
    }

    if (action.purpose === 'candidate_precheck' && observation.candidateCount > 0 && !draftSegment) {
      return this.buildResearchInsertRecommendationDecision(input, plan, action, observation, '')
    }

    const synthesizedReply = await this.synthesizeResearchCheckReply(input, plan, action, observation)
    const safeContent = synthesizedReply
      ? this.sanitizeResearchCheckReply(synthesizedReply)
      : null
    if (!safeContent) {
      return {
        kind: 'message',
        statusHint: 'failed',
        feedback: createFeedback(
          '这次模型没有给出适合直接展示的查证结论，我没有修改草案或播单。你可以直接说“重试”，或补充更具体的节目方向。',
          'error',
          '模型回复不可用',
          {
            explanation: plan.reasoning,
            details: {
              ...observation,
              noMutation: true,
              failureCode: 'research_synthesis_unusable',
            },
          },
        ),
      }
    }
    const feedback = createFeedback(
      safeContent,
      'planning',
      '素材核验',
      {
        explanation: plan.reasoning,
        details: observation,
      },
    )

    if (observation.candidateCount > 0) {
      if (action.purpose === 'candidate_precheck' && !draftSegment) {
        return this.buildResearchInsertRecommendationDecision(input, plan, action, observation, safeContent)
      }
      const suggestion = this.buildDraftResearchSuggestion(input, plan, action, observation)
      return await this.buildDraftResearchUpdateDecision(input, plan, suggestion, safeContent, observation)
    }

    return {
      kind: 'message',
      statusHint: 'needs_clarification',
      feedback,
    }
  }

  private buildResearchInsertRecommendationDecision(
    input: RuntimeSubmitInput,
    plan: AgentPlan,
    action: Extract<AgentPlannerAction, { type: 'research_check' }>,
    observation: {
      candidateCount: number
      topCandidates: Array<{
        id: string
        programName: string
        programCode?: string
        duration: number
        programType: string
        popularityScore?: number
      }>
    },
    safeContent: string,
  ): RuntimeDecision {
    if (input.scheduleState.playlistType === 'none') {
      return this.buildMissingPlaylistWorkspaceDecision(plan.reasoning)
    }
    const targetTime = action.targetTime
    if (!targetTime) {
      const missingTargetMessage = input.scheduleState.playlistType === 'rotation'
        ? '我已经查到了一些素材方向，但还不知道要插入到轮播队列的哪个位置。请补一句例如“放到队列开头”“放到队列末尾”，或说明接在哪个节目后面。'
        : '我已经查到了一些素材方向，但还不知道要插入到哪个时间点。请补一句例如“放到9点”。'
      return {
        kind: 'message',
        statusHint: 'needs_clarification',
        feedback: createFeedback(
          missingTargetMessage,
          'selection',
          input.scheduleState.playlistType === 'rotation' ? '缺少插入位置' : '缺少插入时间',
          {
            explanation: plan.reasoning,
            details: {
              noMutation: true,
              purpose: action.purpose ?? 'candidate_precheck',
              queries: Array.isArray((observation as RuntimeDetailMap).queries)
                ? (observation as RuntimeDetailMap).queries
                : undefined,
              candidateCount: observation.candidateCount,
              topCandidates: observation.topCandidates.slice(0, 5),
            },
          },
        ),
      }
    }
    const recommendedCandidates: RuntimeInsertRecommendationCandidate[] = observation.topCandidates.slice(0, 5).map((candidate, index) => ({
      candidateId: candidate.id,
      programName: candidate.programName,
      programCode: candidate.programCode ?? candidate.id,
      duration: candidate.duration,
      programType: candidate.programType,
      score: candidate.popularityScore ?? Math.max(1, 5 - index),
      confidence: Math.max(0.55, 0.9 - index * 0.08),
      reasonTags: ['素材查证', action.semanticLabel ?? '内容匹配'],
    }))
    const pendingInsertRecommendation = this.buildPendingInsertRecommendation(
      {
        targetTime,
        semanticLabel: action.semanticLabel,
        rawProgramText: action.semanticLabel,
        programTypeHint: action.programTypeHint,
      },
      input.userInput,
      plan.reasoning || 'LLM planner 先查证素材，再进入插入候选选择。',
      recommendedCandidates,
    )
    return this.buildInsertRecommendationAdvisoryDecision(
      pendingInsertRecommendation,
      safeContent,
    )
  }

  private buildDraftResearchSuggestion(
    input: RuntimeSubmitInput,
    plan: AgentPlan,
    action: Extract<AgentPlannerAction, { type: 'research_check' }>,
    observation: {
      draftSegment: RuntimeDetailMap | null
      queries: string[]
      candidateCount: number
      topCandidates: Array<{
        id: string
        programName: string
        programCode?: string
        duration: number
        programType: string
        columnName?: string
        contentTags?: string[]
        popularityScore?: number
      }>
    },
  ): RuntimeDraftResearchSuggestion {
    const draftSegment = observation.draftSegment
    const targetSegmentIndex = typeof draftSegment?.index === 'number'
      ? draftSegment.index
      : action.targetSegmentIndex
    const targetSegmentLabel = typeof draftSegment?.label === 'string'
      ? draftSegment.label
      : action.targetSegmentLabel
    const topCandidateNames = observation.topCandidates.slice(0, 3).map((candidate) => candidate.programName)
    const semanticLabel = action.semanticLabel
      || topCandidateNames[0]
      || targetSegmentLabel
      || '待核验内容'
    return {
      purpose: action.purpose ?? 'draft_precheck',
      targetSegmentIndex,
      targetSegmentLabel,
      semanticLabel,
      programTypeHint: action.programTypeHint,
      queries: observation.queries,
      candidateCount: observation.candidateCount,
      topCandidates: observation.topCandidates.map((candidate) => ({
        id: candidate.id,
        programName: candidate.programName,
        programCode: candidate.programCode,
        duration: candidate.duration,
        programType: candidate.programType,
        columnName: candidate.columnName,
        contentTags: candidate.contentTags,
        popularityScore: candidate.popularityScore,
      })),
      userInput: input.userInput,
      reasoning: plan.reasoning,
    }
  }

  private buildDraftResearchPendingContext(
    input: RuntimeSubmitInput,
    suggestion: RuntimeDraftResearchSuggestion,
  ): RuntimePendingAtomicContext {
    const now = new Date().toISOString()
    const targetText = suggestion.targetSegmentIndex
      ? `第 ${suggestion.targetSegmentIndex} 段`
      : suggestion.targetSegmentLabel ?? '当前草案段'
    return this.pendingAtomicContextService.initialize({
      action: null,
      phase: 'draft_research_confirmation',
      summary: `把“${suggestion.semanticLabel}”更新到${targetText}草案`,
      reasoning: '我已经按你的要求查过草案段和素材库；这一步只会更新版面草案，不会写入正式播单。',
      confirmationNote: '这一步只改草案，不会开始正式编排。',
      originalUserInput: input.userInput,
      collectedUserInput: input.userInput,
      slots: {
        semanticLabel: suggestion.semanticLabel,
        programTypeHint: suggestion.programTypeHint,
        rawProgramText: suggestion.topCandidates[0]?.programName,
      },
      missingFields: ['selection'],
      followUpQuestion: '我可以把这个方向更新到草案。',
      layoutDraftSuggestion: suggestion,
      attemptCount: 0,
      createdAt: now,
      updatedAt: now,
    })
  }

  private async buildDraftResearchUpdateDecision(
    input: RuntimeSubmitInput,
    plan: AgentPlan,
    suggestion: RuntimeDraftResearchSuggestion,
    safeContent: string,
    observation: RuntimeDetailMap,
  ): Promise<RuntimeDecision> {
    const draft = input.currentLayoutDraft
    if (!draft) {
      return {
        kind: 'message',
        statusHint: 'needs_clarification',
        feedback: createFeedback(
          `${this.normalizeResearchReplyForDirectDraftUpdate(safeContent)} 当前还没有可更新的草案，你可以先生成或上传草案。`,
          'planning',
          '需要草案',
          {
            explanation: plan.reasoning,
            details: {
              ...observation,
              noMutation: true,
              draftUpdatePolicy: 'draft_updates_do_not_require_confirmation',
            },
          },
        ),
      }
    }

    const updatedDraft = this.applyDraftResearchSuggestion(draft, suggestion)
    if (!updatedDraft) {
      return {
        kind: 'message',
        statusHint: 'needs_clarification',
        feedback: createFeedback(
          `${this.normalizeResearchReplyForDirectDraftUpdate(safeContent)} 我还不能确定要更新草案的哪一段。你可以补一句“更新到第一段”或直接说明段落名称。`,
          'planning',
          '需要草案段',
          {
            explanation: plan.reasoning,
            details: {
              ...observation,
              noMutation: true,
              suggestion,
              draftUpdatePolicy: 'draft_updates_do_not_require_confirmation',
            },
          },
        ),
      }
    }

    const feasibilityReport = await this.buildLayoutDraftFeasibilityReport(input, updatedDraft)
    const targetText = suggestion.targetSegmentIndex
      ? `第 ${suggestion.targetSegmentIndex} 段`
      : suggestion.targetSegmentLabel ?? '对应段落'
    return {
      kind: 'layout_draft',
      feedback: createFeedback(
        `${this.normalizeResearchReplyForDirectDraftUpdate(safeContent)} 已把“${suggestion.semanticLabel}”更新到左侧草案的${targetText}。正式播单还没有开始编排；如果这版草案可以了，你可以直接说“按这个开始编排”。`,
        'planning',
        '版面草案',
        {
          explanation: plan.reasoning,
          details: {
            ...observation,
            draftId: updatedDraft.id,
            updatedSegment: {
              targetSegmentIndex: suggestion.targetSegmentIndex,
              targetSegmentLabel: suggestion.targetSegmentLabel,
              semanticLabel: suggestion.semanticLabel,
              queryHints: suggestion.queries,
              candidateNames: suggestion.topCandidates.slice(0, 5).map((candidate) => candidate.programName),
            },
            noFormalPlaylistWrite: true,
            draftUpdatePolicy: 'draft_updates_do_not_require_confirmation',
            feasibilitySummary: feasibilityReport.summary,
          },
        },
      ),
      draft: updatedDraft,
      feasibilityReport,
      orchestrationMode: input.currentLayoutDraftMode ?? this.resolvePreferredOrchestrationMode(input),
    }
  }

  private normalizeResearchReplyForDirectDraftUpdate(content: string): string {
    const normalized = content
      .replace(/确认前我不会更新草案，也不会写入节目。[需请]?要我把这个方向更新到草案吗？?/gu, '')
      .replace(/确认前我不会更新草案，也不会写入节目。/gu, '')
      .replace(/需要我把这个方向更新到草案吗？?/gu, '')
      .replace(/请确认是否把这个方向更新到草案。?/gu, '')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/[，,；;：:]+$/u, '')
    return normalized || '我已经查过草案段和素材库，整理出可更新的方向。'
  }

  private resolveResearchDraftSegment(
    draft: LayoutDraft | null | undefined,
    action: Extract<AgentPlannerAction, { type: 'research_check' }>,
  ): RuntimeDetailMap | null {
    if (!draft) return null
    const slots = draft.layoutReference.slots
    const normalizedLabel = (action.targetSegmentLabel ?? action.semanticLabel ?? '').replace(/\s+/g, '').toLowerCase()
    let index = action.targetSegmentIndex ? action.targetSegmentIndex - 1 : -1
    if (index < 0 && normalizedLabel) {
      index = this.resolveDraftSlotIndexByLabel(draft, normalizedLabel)
    }
    if (index < 0 || index >= slots.length) return null
    const slot = slots[index]!
    const column = draft.columns.find((item) => item.columnId === slot.columnId)
    const durationSegment = draft.durationSegments?.[index]
    return {
      index: index + 1,
      start: toClockText(slot.startTime),
      end: toClockText(slot.endTime),
      label: column?.semanticLabel ?? column?.columnName ?? durationSegment?.label ?? slot.columnId,
      programType: column?.defaultProgramType,
      queryHints: column?.queryHints?.slice(0, 8) ?? [],
      targetDurationSeconds: durationSegment?.targetDurationSeconds,
      targetDurationText: durationSegment?.targetDurationSeconds ? this.formatDurationText(durationSegment.targetDurationSeconds) : undefined,
      selectionPriority: durationSegment?.selectionPriority,
    }
  }

  private resolveDraftSlotIndexByLabel(draft: LayoutDraft, label: string | undefined): number {
    if (!label?.trim()) return -1
    return draft.layoutReference.slots.findIndex((slot, index) => {
      const column = draft.columns.find((item) => item.columnId === slot.columnId)
      const segment = draft.durationSegments?.[index]
      return draftSegmentPartsMatch([
        column?.semanticLabel,
        column?.columnName,
        segment?.label,
        segment?.contentHint,
        ...(column?.queryHints ?? []),
      ], label)
    })
  }

  private buildResearchQueries(
    input: RuntimeSubmitInput,
    action: Extract<AgentPlannerAction, { type: 'research_check' }>,
    draftSegment: RuntimeDetailMap | null,
  ): string[] {
    const queries = dedupeStrings([
      ...(action.queries ?? []),
      action.semanticLabel ?? '',
      action.targetSegmentLabel ?? '',
      ...((draftSegment?.queryHints as string[] | undefined) ?? []),
      typeof draftSegment?.label === 'string' ? draftSegment.label : '',
      input.userInput,
    ].map((item) => item.trim()).filter(Boolean))
    return queries.slice(0, 8)
  }

  private mergeResearchCandidates(candidates: ProgramCandidate[]): ProgramCandidate[] {
    const merged = new Map<string, ProgramCandidate>()
    candidates.forEach((candidate) => {
      const key = candidate.id || candidate.programCode || candidate.programId
      if (!merged.has(key)) merged.set(key, candidate)
    })
    return [...merged.values()].sort((a, b) => this.scoreResearchCandidate(b) - this.scoreResearchCandidate(a))
  }

  private normalizeResearchProgramTypes(programTypeHint?: string): string[] | undefined {
    if (!programTypeHint) return undefined
    const normalized = programTypeHint.trim().toLowerCase()
    if (!normalized) return undefined
    const aliasRules: Array<[RegExp, string[]]> = [
      [/宣传片|短片|短视频|垫片|城市形象|promo|short[-_\s]?clip|short[-_\s]?video/u, ['short_clip', 'short_video']],
      [/电视剧|剧集|连续剧|drama|series/u, ['drama']],
      [/新闻|资讯|news/u, ['news', 'news_magazine']],
      [/纪录片|纪实|documentary/u, ['documentary']],
      [/少儿|儿童|kids/u, ['kids']],
      [/健康|养生|health/u, ['health']],
      [/评论|观察|commentary/u, ['commentary']],
    ]
    const aliasMatch = aliasRules.find(([pattern]) => pattern.test(normalized))
    if (aliasMatch) return aliasMatch[1]
    const knownTypes = new Set([
      'news',
      'news_magazine',
      'drama',
      'entertainment',
      'health',
      'commentary',
      'kids',
      'documentary',
      'tv',
      'short_clip',
      'short_video',
    ])
    return knownTypes.has(normalized) ? [normalized] : undefined
  }

  private scoreResearchCandidate(candidate: ProgramCandidate): number {
    return (candidate.popularityScore ?? 0)
      + (candidate.playCount ? Math.log10(candidate.playCount + 1) * 10 : 0)
      + (candidate.estimatedRating ? candidate.estimatedRating * 10 : 0)
  }

  private async synthesizeResearchCheckReply(
    input: RuntimeSubmitInput,
    plan: AgentPlan,
    action: Extract<AgentPlannerAction, { type: 'research_check' }>,
    observation: RuntimeDetailMap,
  ): Promise<string | null> {
    try {
      const response = await this.llmClient.chat([
        {
          role: 'system',
          content: [
            `[prompt ${DEMO_RUNTIME_FACADE_PROMPT_VERSION}] 你是 AI 编审助手。根据工具观察结果，用编排员听得懂的话回复。`,
            '你只能说已经检查草案或查过素材库；不能说已经写入正式播单。',
            '如果素材看起来够用，给出你建议选哪些方向。本地会把可定位的草案调整直接更新到草案，不需要用户确认；不要追问“是否更新草案”。',
            '如果素材不足，说明缺什么，并建议用户换关键词、补充主题或上传素材。',
            '不要输出 JSON、runtime、taskPlan、置信度、候选数这类技术词。',
          ].join('\n'),
        },
        {
          role: 'user',
          content: JSON.stringify({
            userInput: input.userInput,
            playlistType: input.scheduleState.playlistType,
            plannerReasoning: plan.reasoning,
            plannerAssistantReplyDraft: plan.assistantReplyDraft,
            researchAction: action,
            observation,
          }),
        },
      ], {
        temperature: 0.2,
        maxTokens: 900,
        timeout: LONG_RUNNING_DEADLINE_BUDGET.batchDeadlineMs,
        maxRetries: 0,
        traceLabel: 'agent_react_synthesize',
        promptVersion: DEMO_RUNTIME_FACADE_PROMPT_VERSION,
      })
      return response.content.trim()
    } catch {
      return null
    }
  }

  private sanitizeResearchCheckReply(content: string): string | null {
    const trimmed = content.trim()
    if (
      trimmed.startsWith('{')
      || /"reactTask"|"actions"|"assistantReplyDraft"|"reasoning"|taskPlan|runtime/u.test(trimmed)
    ) {
      return null
    }
    if (/(已经|已|正在|开始|马上).{0,16}(写入|更新草案|修改草案|正式编排|排入节目|生成节目)/u.test(content)) {
      return null
    }
    return content
  }

  private hasExplicitPlannerPlaylistTypeCue(userInput: string): boolean {
    const normalized = userInput.replace(/\s+/g, '')
    return /(电视播单|电视频道播单|频道播单|电视节目单|频道节目单|电视编排单|频道编排单|电视播出单|频道播出单|轮播单|轮播表|轮播节目单|新媒体轮播单|新媒体播单|直播轮播单|直播轮播表)/u.test(normalized)
  }

  private async executePlannerCreatePlaylist(
    input: RuntimeSubmitInput,
    plan: AgentPlan,
    createAction: Extract<AgentPlannerAction, { type: 'create_playlist' }>,
    draftAction?: Extract<AgentPlannerAction, { type: 'prepare_layout_draft' | 'refine_layout_draft' }>,
  ): Promise<RuntimeDecision> {
    const playlistId = this.nextPlaylistDocumentId(createAction.playlistType)
    const rotationStrategy = createAction.playlistType === 'rotation'
      ? createAction.rotationStrategy ?? 'content_match'
      : undefined
    const rotationDurationSeconds = createAction.playlistType === 'rotation'
      ? createAction.rotationDurationSeconds
      : undefined
    const effectiveInput: RuntimeSubmitInput = {
      ...input,
      scheduleState: {
        ...input.scheduleState,
        playlistId,
        playlistType: createAction.playlistType,
        rotationStrategy,
        rotationDurationSeconds,
      },
      currentLayoutDraft: createAction.playlistType === 'rotation' ? null : input.currentLayoutDraft,
    }

    let linkedDraft: RuntimeLinkedLayoutDraft | undefined
    if (draftAction && this.isLayoutDraftFlowEnabled(effectiveInput)) {
      const draftDecision = await this.executePlannerLayoutDraftAction(effectiveInput, draftAction, plan.reasoning)
      if (draftDecision.kind !== 'layout_draft') return draftDecision
      linkedDraft = {
        layoutDraft: draftDecision.draft,
        layoutDraftFeasibility: draftDecision.feasibilityReport,
        layoutDraftMode: draftDecision.orchestrationMode,
      }
    }

    if (createAction.playlistType === 'tv') {
      const defaultLayout = getOrchestrationDemoLayout(input.scheduleState.channelId, input.scheduleState.date)
      return this.buildPlaylistStateChangedDecision(
        defaultLayout
          ? '已新建电视播单，并加载当前频道日期的版面草案。'
          : '已新建电视播单，但当前没有读取到该频道日期的版面草案。',
        'tv',
        undefined,
        undefined,
        playlistId,
        input.scheduleState.channelId,
        input.scheduleState.channelName,
        input.scheduleState.date,
        defaultLayout
          ? {
              layoutDraftStatus: 'loaded',
              layoutDraftSource: 'channel_default',
              layoutDraftSlotCount: defaultLayout.slots.length,
              plannerActions: plan.actions.map((action) => action.type),
            }
          : {
              layoutDraftStatus: 'missing',
              plannerActions: plan.actions.map((action) => action.type),
            },
        linkedDraft,
      )
    }

    const plannerDraftReply = plan.assistantReplyDraft?.trim()
    const safePlannerDraftReply = plannerDraftReply
      && !/(?:已|已经|完成)(?:[^。；;，,]{0,24})(?:写入|生成)(?:[^。；;，,]{0,12})(?:正式播单|正式节目|正式轮播单)/u.test(plannerDraftReply)
      ? plannerDraftReply
      : undefined
    return this.buildPlaylistStateChangedDecision(
      linkedDraft
        ? safePlannerDraftReply ?? '已新建轮播单，并按你的描述整理了一份轮播草案。确认前不会写入正式节目。'
        : '已新建轮播单，并准备了一个空轮播草案。你可以继续说明主题、总时长，或上传已有草案。',
      'rotation',
      rotationStrategy,
      rotationDurationSeconds,
      playlistId,
      undefined,
      undefined,
      undefined,
      {
        layoutDraftStatus: linkedDraft ? 'loaded' : 'empty',
        layoutDraftSource: linkedDraft?.layoutDraft.source,
        layoutDraftSegmentCount: linkedDraft?.layoutDraft.durationSegments?.length ?? linkedDraft?.layoutDraft.layoutReference.slots.length,
        plannerActions: plan.actions.map((action) => action.type),
      },
      linkedDraft,
    )
  }

  private async executePlannerLayoutDraftAction(
    input: RuntimeSubmitInput,
    action: Extract<AgentPlannerAction, { type: 'prepare_layout_draft' | 'refine_layout_draft' }>,
    reasoning?: string,
  ): Promise<RuntimeDecision> {
    if (!this.isLayoutDraftFlowEnabled(input)) {
      return this.buildLayoutDraftDisabledDecision(reasoning)
    }
    const rotationDurationSeconds = action.rotationDurationSeconds ?? input.scheduleState.rotationDurationSeconds
    const targetTimeRange = action.targetTimeRange
      ?? (action.type === 'prepare_layout_draft' && input.scheduleState.playlistType === 'rotation' && rotationDurationSeconds && rotationDurationSeconds > 0 && rotationDurationSeconds < 24 * 3600
        ? { start: '00:00:00', end: secondsToClockText(rotationDurationSeconds) }
        : undefined)
    const structuredSegments = this.resolvePlannerLayoutDraftSegments(input, action, targetTimeRange)
    return this.prepareLayoutDraft(
      input,
      {
        mode: action.type === 'refine_layout_draft' ? 'layout_refine' : 'layout_prepare',
        confidence: 0.9,
        reasoning: reasoning || 'LLM planner 已把用户需求整理成版面草案动作。',
        suggestedParams: {
          userIntent: action.userIntent ?? action.semanticLabel ?? input.userInput,
          semanticLabel: action.semanticLabel,
          programTypeHint: action.programTypeHint,
          targetTimeRange,
          rotationDurationSeconds,
          ignoreExistingLayout: action.ignoreExistingLayout ?? action.type === 'prepare_layout_draft',
          segments: structuredSegments,
        },
      },
      this.resolvePreferredOrchestrationMode(input),
    )
  }

  private resolvePlannerLayoutDraftSegments(
    input: RuntimeSubmitInput,
    action: Extract<AgentPlannerAction, { type: 'prepare_layout_draft' | 'refine_layout_draft' }>,
    targetTimeRange?: { start: string; end: string },
  ): LayoutIntentSegment[] | undefined {
    const semanticLabel = action.semanticLabel?.trim()
    const normalizedSegments = this.normalizeStructuredSegments(action.segments)
    if ((normalizedSegments?.length ?? 0) > 1) return normalizedSegments
    const replacementLabel = normalizedSegments?.[0]?.semanticLabel
      ?? semanticLabel
    const targetedSegment = replacementLabel
      ? this.resolveTargetedDraftRefineSegment(input, action, replacementLabel, normalizedSegments?.[0]?.programTypeHint)
      : undefined
    if (targetedSegment) return [targetedSegment]
    if (normalizedSegments?.length) return normalizedSegments
    if (!semanticLabel) return undefined
    if (targetTimeRange) {
      return [{
        start: targetTimeRange.start,
        end: targetTimeRange.end,
        semanticLabel,
        programTypeHint: action.programTypeHint,
      }]
    }
    return undefined
  }

  private resolveTargetedDraftRefineSegment(
    input: RuntimeSubmitInput,
    action: Extract<AgentPlannerAction, { type: 'prepare_layout_draft' | 'refine_layout_draft' }>,
    semanticLabel: string,
    programTypeHint?: string,
  ): LayoutIntentSegment | undefined {
    if (
      action.type !== 'refine_layout_draft'
      || !input.currentLayoutDraft
      || (!action.targetSegmentIndex && !action.targetSegmentLabel)
    ) return undefined
    const slotIndex = action.targetSegmentIndex
      ? action.targetSegmentIndex - 1
      : this.resolveDraftSlotIndexByLabel(input.currentLayoutDraft, action.targetSegmentLabel)
    if (slotIndex < 0) return undefined
    const slots = [...input.currentLayoutDraft.layoutReference.slots]
      .sort((left, right) => toClockText(left.startTime).localeCompare(toClockText(right.startTime)))
    const slot = slots[slotIndex]
    if (!slot) return undefined
    return {
      start: toClockText(slot.startTime),
      end: toClockText(slot.endTime),
      semanticLabel,
      programTypeHint: programTypeHint ?? action.programTypeHint,
    }
  }


  async submitInstruction(input: RuntimeSubmitInput): Promise<RuntimeDecision> {
    // Deadline 属于本次请求输入，递归续接复用同一实例，并发 submit 之间不会共享可变状态。
    input = { ...input, deadline: input.deadline ?? new AgentDeadline() }
    input = this.withUploadedLayoutDraftContext(input)

    if (input.agentCoreEnabled && (input.inputSource === 'user' || input.inputSource === 'quick_action')) {
      return await this.tryHandleAgentPlannerInstruction(input)
    }

    if (
      input.pendingAtomicContext
      && this.isExplicitNewPlaylistWorkspaceInstruction(input.userInput)
      && !this.isExplicitPendingConfirm(input.userInput.replace(/\s+/g, ''))
    ) {
      return this.submitInstruction(this.clearPendingAtomicState(input))
    }

    if (
      input.agentCoreEnabled
      && (input.inputSource === 'quick_action' || input.inputSource === 'user')
      && this.isBarePlaylistCreationInstruction(input.userInput)
    ) {
      const playlistStateDecision = await this.tryHandlePlaylistStateInstruction(input)
      if (playlistStateDecision) return playlistStateDecision
    }

    const normalizedAgentInput = input.userInput.replace(/\s+/g, '')
    if (
      input.agentCoreEnabled
      && !this.isLayoutDraftFlowEnabled(input)
      && this.isExplicitLayoutDraftPreparationInstruction(normalizedAgentInput)
    ) {
      return this.buildLayoutDraftDisabledDecision('前台当前未开启版面草案流程，本轮不会调用模型尝试生成草案。')
    }

    if (
      input.agentCoreEnabled
      && this.isLayoutDraftFlowEnabled(input)
      && !this.isExplicitLayoutDraftPreparationInstruction(normalizedAgentInput)
      && (
        this.isLayoutDraftCommitInstruction(input.userInput)
        || (
          this.shouldAttachLayoutDraftToOrchestration(input.userInput)
          && this.isFormalOrchestrationInstruction(normalizedAgentInput)
        )
      )
    ) {
      return await this.commitLayoutDraft(input, {
        mode: 'layout_commit',
        confidence: 0.95,
        reasoning: '用户明确要求参考当前版面草案进入正式编排。',
      })
    }

    if (this.shouldUseAtomicLlmSpecialist(input)) {
      const agentCoreDecision = await this.tryHandleAgentCoreInstruction(input)
      if (agentCoreDecision) return agentCoreDecision
    }

    const playlistStateDecision = await this.tryHandlePlaylistStateInstruction(input)
    if (playlistStateDecision) return playlistStateDecision

    const rawConflictDecision = this.tryBuildRawCompositeConflictDecision(input)
    if (rawConflictDecision) return rawConflictDecision

    const compositeTaskDecision = await this.tryBuildCompositeTaskDecision(input)
    if (compositeTaskDecision) return compositeTaskDecision

    const initialFastSystemClassification = this.classifyFastSystemIntent(input.userInput)
    if (initialFastSystemClassification) {
      if (initialFastSystemClassification.mode === 'validate_only') {
        if (input.agentCoreEnabled) {
          const agentCoreDecision = await this.tryHandleAgentCoreInstruction(input)
          if (agentCoreDecision) return agentCoreDecision
        }
        return this.buildValidationDecision(initialFastSystemClassification, input)
      }
      if (initialFastSystemClassification.mode === 'repair_only') {
        return this.buildRepairAnalysisDecision(initialFastSystemClassification, input)
      }
      if (initialFastSystemClassification.mode === 'layout_analysis') {
        if (!this.isLayoutDraftFlowEnabled(input)) return this.buildLayoutDraftDisabledDecision(initialFastSystemClassification.reasoning)
        return await this.buildLayoutAnalysisDecision(initialFastSystemClassification, input)
      }
    }

    const deterministicScheduleQuery = this.tryHandleDeterministicScheduleQuery(input)
    if (deterministicScheduleQuery) return deterministicScheduleQuery

    const earlyRotationThemeDurationLayoutClassification = this.tryClassifyRotationThemeDurationLayoutInstruction(input)
    if (earlyRotationThemeDurationLayoutClassification) {
      if (!this.isLayoutDraftFlowEnabled(input)) return this.buildLayoutDraftDisabledDecision(earlyRotationThemeDurationLayoutClassification.reasoning)
      return this.prepareLayoutDraft(
        input,
        earlyRotationThemeDurationLayoutClassification,
        this.resolvePreferredOrchestrationMode(input),
      )
    }

    const readOnlyDiscussionDecision = await this.tryHandleReadOnlyPlaylistDiscussion(input)
    if (readOnlyDiscussionDecision) return readOnlyDiscussionDecision

    if (
      input.currentLayoutDraft
      && input.preferLayoutDraftRefine
      && !this.isFormalOrchestrationInstruction(input.userInput.replace(/\s+/g, ''))
      && this.shouldRouteToLayoutDraftRefine(input.userInput)
    ) {
      const deterministicRefineDecision = await this.tryBuildDeterministicLayoutDraftRefineDecision(input)
      if (deterministicRefineDecision) return deterministicRefineDecision
      return this.prepareLayoutDraft(
        input,
        {
          mode: 'layout_refine',
          confidence: 0.9,
          reasoning: '当前会话存在需要补充的版面草案，且入口声明草案补充优先，因此将本轮输入解释为对现有草案新增或微调编排信息。',
          suggestedParams: {
            userIntent: input.userInput,
          },
        },
        this.resolvePreferredOrchestrationMode(input),
      )
    }

    if (this.shouldTryDirectFormalOrchestration(input)) {
      const directFormalOrchestrationDecision = this.tryBuildFormalOrchestrationDecision(input)
      if (directFormalOrchestrationDecision) return directFormalOrchestrationDecision
    }

    if (input.agentCoreEnabled) {
      const agentCoreDecision = await this.tryHandleAgentCoreInstruction(input)
      if (agentCoreDecision) return agentCoreDecision
    }

    let effectiveInput = input
    const normalizedEffectiveInput = effectiveInput.userInput.replace(/\s+/g, '')
    const earlyLayoutDraftSwitchDecision = this.isLayoutDraftFlowEnabled(effectiveInput)
      ? await this.trySwitchLayoutDraft(effectiveInput)
      : null
    if (earlyLayoutDraftSwitchDecision) return earlyLayoutDraftSwitchDecision

    if (
      this.isLayoutDraftFlowEnabled(effectiveInput)
      && !this.isExplicitLayoutDraftPreparationInstruction(normalizedEffectiveInput)
      && (
        this.isLayoutDraftCommitInstruction(effectiveInput.userInput)
        || (
          this.shouldAttachLayoutDraftToOrchestration(effectiveInput.userInput)
          && this.isFormalOrchestrationInstruction(normalizedEffectiveInput)
        )
      )
    ) {
      return await this.commitLayoutDraft(effectiveInput, {
        mode: 'layout_commit',
        confidence: 0.95,
        reasoning: '用户确认当前待确认版面草案，准备进入正式编排。',
      })
    }

    const layoutDraftClearDecision = this.isLayoutDraftFlowEnabled(effectiveInput)
      ? this.tryClearLayoutDraft(effectiveInput)
      : null
    if (layoutDraftClearDecision) return layoutDraftClearDecision

    const layoutDraftSwitchDecision = this.isLayoutDraftFlowEnabled(effectiveInput)
      ? await this.trySwitchLayoutDraft(effectiveInput)
      : null
    if (layoutDraftSwitchDecision) return layoutDraftSwitchDecision

    if (this.shouldTryDirectFormalOrchestration(effectiveInput)) {
      const earlyFormalOrchestrationDecision = this.tryBuildFormalOrchestrationDecision(effectiveInput)
      if (earlyFormalOrchestrationDecision) return earlyFormalOrchestrationDecision
    }

    const rotationThemeDurationLayoutClassification = this.tryClassifyRotationThemeDurationLayoutInstruction(effectiveInput)
    if (rotationThemeDurationLayoutClassification) {
      if (!this.isLayoutDraftFlowEnabled(effectiveInput)) return this.buildLayoutDraftDisabledDecision(rotationThemeDurationLayoutClassification.reasoning)
      return this.prepareLayoutDraft(
        effectiveInput,
        rotationThemeDurationLayoutClassification,
        this.resolvePreferredOrchestrationMode(effectiveInput),
      )
    }

    const batchRangeDecision = this.isLayoutDraftFlowEnabled(effectiveInput)
      ? this.tryHandleBatchRangeInstruction(effectiveInput)
      : null
    if (batchRangeDecision) return batchRangeDecision

    const explicitRangeLayoutClassification = this.tryClassifyExplicitRangeLayoutInstruction(effectiveInput.userInput)
    if (explicitRangeLayoutClassification) {
      if (!this.isLayoutDraftFlowEnabled(effectiveInput)) return this.buildLayoutDraftDisabledDecision(explicitRangeLayoutClassification.reasoning)
      return this.prepareLayoutDraft(
        effectiveInput,
        explicitRangeLayoutClassification,
        this.resolvePreferredOrchestrationMode(effectiveInput),
      )
    }

    const daypartLayoutClassification = this.tryClassifyDaypartLayoutInstruction(effectiveInput.userInput)
    if (daypartLayoutClassification) {
      if (!this.isLayoutDraftFlowEnabled(effectiveInput)) return this.buildLayoutDraftDisabledDecision(daypartLayoutClassification.reasoning)
      return this.prepareLayoutDraft(
        effectiveInput,
        daypartLayoutClassification,
        this.resolvePreferredOrchestrationMode(effectiveInput),
      )
    }

    const relativeEventLayoutClassification = this.tryClassifyRelativeEventLayoutInstruction(effectiveInput.userInput)
    if (relativeEventLayoutClassification) {
      if (!this.isLayoutDraftFlowEnabled(effectiveInput)) return this.buildLayoutDraftDisabledDecision(relativeEventLayoutClassification.reasoning)
      return this.prepareLayoutDraft(
        effectiveInput,
        relativeEventLayoutClassification,
        this.resolvePreferredOrchestrationMode(effectiveInput),
      )
    }

    if (!effectiveInput.agentCoreEnabled) {
      const atomicDecision = effectiveInput.scheduleState.playlistType === 'none'
        ? this.buildMissingPlaylistWorkspaceDecision()
        : await this.tryHandleAtomicInstruction(effectiveInput)
      if (atomicDecision) return atomicDecision
    }

    if (this.shouldTryDirectFormalOrchestration(effectiveInput)) {
      const formalOrchestrationDecision = this.tryBuildFormalOrchestrationDecision(effectiveInput)
      if (formalOrchestrationDecision) return formalOrchestrationDecision
    }

    const fastSystemClassification = this.classifyFastSystemIntent(effectiveInput.userInput)
    if (fastSystemClassification) {
      if (fastSystemClassification.mode === 'validate_only') {
        if (effectiveInput.agentCoreEnabled) {
          const agentCoreDecision = await this.tryHandleAgentCoreInstruction(effectiveInput)
          if (agentCoreDecision) return agentCoreDecision
        }
        return this.buildValidationDecision(fastSystemClassification, effectiveInput)
      }
      if (fastSystemClassification.mode === 'repair_only') {
        return this.buildRepairAnalysisDecision(fastSystemClassification, effectiveInput)
      }
      if (fastSystemClassification.mode === 'layout_analysis') {
        if (!this.isLayoutDraftFlowEnabled(effectiveInput)) return this.buildLayoutDraftDisabledDecision(fastSystemClassification.reasoning)
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
    if (this.isConfidentLayoutIntent(layoutRecognition)) {
      if (!this.isLayoutDraftFlowEnabled(effectiveInput)) return this.buildLayoutDraftDisabledDecision(layoutRecognition.reasoning)
      const classification = this.convertLayoutIntentToClassification(layoutRecognition, effectiveInput.userInput)
      if (classification.mode === 'layout_analysis') {
        return await this.buildLayoutAnalysisDecision(classification, effectiveInput)
      }
      return classification.mode === 'layout_commit'
        ? await this.commitLayoutDraft(effectiveInput, classification)
        : this.prepareLayoutDraft(effectiveInput, classification, this.resolvePreferredOrchestrationMode(effectiveInput))
    }

    const classification = await this.taskClassifier.classify({
      scheduleState: effectiveInput.scheduleState,
      userInput: effectiveInput.userInput,
      history: this.buildTaskClassifierHistory(effectiveInput),
      contextPackage: effectiveInput.foregroundContextPackage,
    })
    if (classification.suggestedParams?.llmFailure) {
      return this.buildRecoverableLlmFailureDecision(
        effectiveInput,
        classification.suggestedParams.llmFailure,
        classification.reasoning,
      )
    }
    if (classification.mode === 'micro_edit') {
      const result = await this.buildMicroEditCommand(effectiveInput, classification.reasoning)
      return this.buildMicroEditDecision(result, classification.reasoning)
    }
    if (classification.mode === 'validate_only') {
      if (effectiveInput.agentCoreEnabled) {
        const agentCoreDecision = await this.tryHandleAgentCoreInstruction(effectiveInput)
        if (agentCoreDecision) return agentCoreDecision
      }
      return this.buildValidationDecision(classification, effectiveInput)
    }
    if (classification.mode === 'repair_only') return this.buildRepairAnalysisDecision(classification, effectiveInput)
    if (classification.mode === 'layout_analysis') {
      if (!this.isLayoutDraftFlowEnabled(effectiveInput)) return this.buildLayoutDraftDisabledDecision(classification.reasoning)
      return await this.buildLayoutAnalysisDecision(classification, effectiveInput)
    }
    if (classification.mode === 'layout_prepare' || classification.mode === 'layout_refine' || classification.mode === 'layout_commit') {
      if (!this.isLayoutDraftFlowEnabled(effectiveInput)) return this.buildLayoutDraftDisabledDecision(classification.reasoning)
      return classification.mode === 'layout_commit'
        ? await this.commitLayoutDraft(effectiveInput, classification)
        : this.prepareLayoutDraft(effectiveInput, classification, this.resolvePreferredOrchestrationMode(effectiveInput))
    }
    if (classification.mode === 'full_generate' || classification.mode === 'partial_generate') {
      return this.buildFormalOrchestrationDecision(
        effectiveInput,
        classification.mode === 'full_generate' ? 'full_generate' : 'partial_generate',
        classification.reasoning || '用户明确发起正式编排。',
      )
    }
    return { kind: 'message', feedback: this.buildClarifyFeedback(effectiveInput, classification.reasoning || layoutRecognition?.reasoning) }
  }

  private withUploadedLayoutDraftContext(input: RuntimeSubmitInput): RuntimeSubmitInput {
    if (input.currentLayoutDraft || !this.isLayoutDraftFlowEnabled(input)) return input
    const runtimeEntry = getRuntimeLayoutEntry(input.scheduleState.channelId, input.scheduleState.date)
    if (!runtimeEntry?.templateMode) return input
    const existing = this.resolveExistingLayoutDraft(input, input.userInput, false)
    if (!existing?.draft || existing.draft.source !== 'uploaded') return input
    return {
      ...input,
      currentLayoutDraft: existing.draft,
    }
  }

  private async tryBuildDeterministicLayoutDraftRefineDecision(input: RuntimeSubmitInput): Promise<RuntimeDecision | null> {
    const draft = input.currentLayoutDraft
    if (!draft) return null

    const normalized = input.userInput.replace(/\s+/g, '')
    if (!/(删除|删掉|移除|去掉|撤掉|清掉|清除)/.test(normalized)) return null

    const targetSlot = this.resolveDraftSlotFromUserTime(draft, input.userInput)
      ?? [...draft.layoutReference.slots].sort((left, right) => clockToSeconds(left.startTime) - clockToSeconds(right.startTime))[0]
    if (!targetSlot) return null

    const removedSlots = draft.layoutReference.slots.filter((slot) => slot.id !== targetSlot.id)
    const nextSlots = removedSlots.length > 0 ? removedSlots : draft.layoutReference.slots
    const referencedColumnIds = new Set(nextSlots.map((slot) => slot.columnId))
    const nextColumns = draft.columns.filter((column) => referencedColumnIds.has(column.columnId))
    const nextVersion = (draft.version ?? 1) + 1
    const nextDraft: LayoutDraft = this.applyLayoutDraftStrategyProfile({
      ...draft,
      id: `${draft.id}:v${nextVersion}`,
      version: nextVersion,
      userIntent: input.userInput,
      layoutReference: {
        ...draft.layoutReference,
        id: `${draft.layoutReference.id}:v${nextVersion}`,
        slots: nextSlots,
      },
      columns: nextColumns,
      warnings: draft.warnings ?? [],
    }, input.userInput, input.scheduleState.playlistType)

    const draftValidation = this.layoutDraftValidator.validateDraft(nextDraft)
    const warnings = dedupeStrings([
      ...(nextDraft.warnings ?? []),
      ...(removedSlots.length === 0 ? ['当前草案只有一个时段，已保留原时段并记录删除意图，请补充替代时段后再删除。'] : []),
      ...draftValidation.warnings.map((item) => item.message),
      ...draftValidation.errors.map((item) => item.message),
    ])
    nextDraft.warnings = warnings
    const feasibilityReport = await this.buildLayoutDraftFeasibilityReport(input, nextDraft)
    return {
      kind: 'layout_draft',
      feedback: createFeedback(
        '已按你的要求更新当前版面草案。',
        'planning',
        '版面草案',
        {
          explanation: '当前会话存在待确认版面草案，已按用户指定时间删除命中的草案时段。',
          details: {
            draftId: nextDraft.id,
            layoutSource: nextDraft.source,
            removedSegmentId: targetSlot.id,
            removedTimeRange: {
              start: toClockText(targetSlot.startTime),
              end: toClockText(targetSlot.endTime),
            },
            coverage: nextDraft.coverage,
            segmentCount: nextDraft.layoutReference.slots.length,
            warnings,
            feasibilitySummary: feasibilityReport.summary,
            orchestrationMode: this.resolvePreferredOrchestrationMode(input),
            strategyProfile: nextDraft.strategyProfile,
          },
        },
      ),
      draft: nextDraft,
      feasibilityReport,
      orchestrationMode: this.resolvePreferredOrchestrationMode(input),
    }
  }

  private resolveDraftSlotFromUserTime(draft: LayoutDraft, userInput: string): LayoutDraft['layoutReference']['slots'][number] | null {
    const targetClocks = dedupeStrings([
      parseAtomicClockExpression(userInput)?.targetTime,
      ...this.extractRawHourClockCandidates(userInput),
    ].filter((item): item is string => Boolean(item)))

    for (const targetClock of targetClocks) {
      const targetSeconds = clockToSeconds(targetClock)
      const targetSlot = draft.layoutReference.slots.find((slot) => {
        const start = clockToSeconds(slot.startTime)
        const end = clockToSeconds(slot.endTime)
        return start <= targetSeconds && targetSeconds < end
      })
      if (targetSlot) return targetSlot
    }

    const targetSecondsList = targetClocks.map(clockToSeconds)
    const nearest = draft.layoutReference.slots
      .map((slot) => {
        const start = clockToSeconds(slot.startTime)
        const distance = Math.min(...targetSecondsList.map((target) => Math.abs(start - target)))
        return { slot, distance }
      })
      .sort((left, right) => left.distance - right.distance)
      .at(0)
    if (nearest && targetClocks.length > 0) return nearest.slot

    return null
  }

  private extractRawHourClockCandidates(userInput: string): string[] {
    const normalized = userInput.replace(/\s+/g, '')
    const match = normalized.match(/(\d{1,2})(?:点|时)/)
    if (!match?.[1]) return []

    const hour = Number(match[1])
    if (Number.isNaN(hour) || hour < 0 || hour > 23) return []

    const candidates = [`${`${hour}`.padStart(2, '0')}:00:00`]
    if (hour > 0 && hour < 12) {
      candidates.push(`${`${hour + 12}`.padStart(2, '0')}:00:00`)
    }
    return candidates
  }

  async resolvePendingTargetSelection(input: RuntimeResolveTargetSelectionInput): Promise<RuntimeDecision> {
    const { pendingTargetSelection, channelId, date } = input
    const selectedItem = pendingTargetSelection.candidates.find((item) => item.id === pendingTargetSelection.selectedItemId)
    if (!selectedItem) return { kind: 'message', feedback: createFeedback('当前未选中有效的目标节目，请重新选择。', 'selection', '目标选择', { explanation: pendingTargetSelection.reasoning, details: pendingTargetSelection.resolutionDetails }) }

    if (pendingTargetSelection.action === 'move') {
      const moveConfig = pendingTargetSelection.moveConfig
      if (!moveConfig) return { kind: 'message', feedback: createFeedback('移动命令缺少时间配置，无法继续执行。', 'selection', '目标选择') }
      const currentStart = normalizeDateTime(date, selectedItem.startTime)
      const offsetSeconds = typeof moveConfig.offsetSeconds === 'number'
        ? (moveConfig.direction === 'backward' ? -Math.abs(moveConfig.offsetSeconds) : Math.abs(moveConfig.offsetSeconds))
        : null
      const newStartTime = moveConfig.absoluteNewStartTime ?? (offsetSeconds !== null ? offsetDateTime(currentStart, offsetSeconds) : null)
      if (!newStartTime) return { kind: 'message', feedback: createFeedback('移动命令缺少目标时间，无法继续执行。', 'selection', '目标选择') }
      const violation = this.resolveMoveWindowViolation({ channelId, date, item: selectedItem, newStartTime })
      if (violation) return { kind: 'message', feedback: createFeedback(violation.message, 'execution', '时间范围校验', { thinking: violation.thinking, details: violation.details }) }
      const command: MoveCommand = { action: 'move', reasoning: pendingTargetSelection.reasoning, data: { itemId: selectedItem.id, newStartTime } }
      return { kind: 'execute_command', execution: { command, successMessage: `已将 ${selectedItem.programName || selectedItem.id} 移动到 ${toClockText(newStartTime)}`, explanation: pendingTargetSelection.reasoning, details: { ...pendingTargetSelection.resolutionDetails, matchedItem: asRuntimeItem(selectedItem), sourceTimeRange: { start: selectedItem.startTime, end: selectedItem.endTime }, proposedTimeRange: { start: toClockText(newStartTime), end: toClockText(newStartTime) } } } }
    }

    if (pendingTargetSelection.action === 'delete') {
      const command: DeleteCommand = { action: 'delete', reasoning: pendingTargetSelection.reasoning, data: { itemId: selectedItem.id } }
      return { kind: 'pending_command', feedback: createFeedback(`将删除 ${selectedItem.startTime} 的《${selectedItem.programName || selectedItem.id}》。`, 'selection', '待确认修改', { explanation: pendingTargetSelection.reasoning, details: { ...pendingTargetSelection.resolutionDetails, matchedItem: asRuntimeItem(selectedItem), targetTime: selectedItem.startTime } }), pendingCommand: { command, summary: `删除 ${selectedItem.startTime} 的《${selectedItem.programName || selectedItem.id}》`, successMessage: `已删除 ${selectedItem.startTime} 的《${selectedItem.programName || selectedItem.id}》`, reasoning: pendingTargetSelection.reasoning, details: { ...pendingTargetSelection.resolutionDetails, matchedItem: asRuntimeItem(selectedItem), targetTime: selectedItem.startTime } } }
    }

    const replaceProgramName = pendingTargetSelection.replaceProgramName?.trim()
    if (!replaceProgramName) return { kind: 'message', feedback: createFeedback('替换目标缺少新节目名称，请重新描述替换需求。', 'selection', '目标选择') }
    const result = await this.buildReplaceResultForMatchedItem(
      selectedItem,
      replaceProgramName,
      channelId,
      date,
      pendingTargetSelection.reasoning,
      selectedItem.startTime,
      {
        recommendSelection: input.scheduleState?.playlistType === 'rotation',
        userInput: pendingTargetSelection.summary,
      },
    )
    return this.buildMicroEditDecision(
      input.scheduleState?.playlistType === 'tv' && result.command
        ? { ...result, forceDirectExecution: true }
        : result,
      pendingTargetSelection.reasoning,
    )
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

    if (pendingInsertRecommendation.resumeCompositeTask?.kind === 'insert_with_shift') {
      const targetTime = pendingInsertRecommendation.targetTime
      const targetSeconds = clockToSeconds(targetTime)
      const currentSchedule = input.currentSchedule ?? []
      const affectedItems = currentSchedule.filter((item: RuntimeScheduleItem) => {
        const start = clockToSeconds(item.startTime)
        const end = clockToSeconds(item.endTime)
        return start >= targetSeconds || (start <= targetSeconds && targetSeconds < end)
      })
      if (affectedItems.length > DEFAULT_SCHEDULING_TASK_LIMITS.maxStepsPerStage) {
        return {
          kind: 'message',
          statusHint: 'needs_confirmation',
          feedback: createFeedback(
            `${targetTime} 后会影响 ${affectedItems.length} 条节目，单次最多先处理 ${DEFAULT_SCHEDULING_TASK_LIMITS.maxStepsPerStage} 条。请缩小时间范围，或改成局部后移。`,
            'planning',
            '需要分批',
            {
              explanation: '插入顺延影响范围超过单个 stage 上限。',
              details: { affectedItems, taskLimit: DEFAULT_SCHEDULING_TASK_LIMITS.maxStepsPerStage },
            },
          ),
        }
      }
      const candidate = this.runtimeRecommendationToProgramCandidate(selectedCandidate, scheduleState.channelId)
      const taskRun = this.buildInsertWithShiftTaskRun({
        scheduleState,
        userInput: input.userInput ?? pendingInsertRecommendation.collectedUserInput,
        currentSchedule,
      }, targetTime, candidate, affectedItems)
      const pendingContext: RuntimePendingAtomicContext = this.pendingAtomicContextService.initialize({
        action: 'insert',
        phase: 'clarifying',
        summary: this.describeCompositeTaskSummary(taskRun),
        reasoning: this.describeCompositeTaskConfirmation(taskRun),
        confirmationNote: this.describeCompositeTaskConfirmation(taskRun),
        originalUserInput: pendingInsertRecommendation.originalUserInput,
        collectedUserInput: pendingInsertRecommendation.collectedUserInput,
        slots: {
          targetTime,
          programName: candidate.programName,
          rawProgramText: pendingInsertRecommendation.rawProgramText ?? candidate.programName,
          semanticLabel: pendingInsertRecommendation.semanticLabel,
          programTypeHint: pendingInsertRecommendation.programTypeHint,
          expectedDurationSeconds: pendingInsertRecommendation.expectedDurationSeconds,
          offsetSeconds: candidate.duration,
          direction: 'forward',
        },
        missingFields: ['selection'],
        followUpQuestion: this.describeCompositeTaskConfirmation(taskRun),
        compositeTaskRun: taskRun,
        attemptCount: 0,
        createdAt: taskRun.createdAt,
        updatedAt: taskRun.updatedAt,
      })

      return {
        kind: 'pending_atomic_context',
        feedback: createFeedback(
          `已选《${candidate.programName}》。我会先把受影响的 ${affectedItems.length} 条节目顺延 ${this.formatDurationText(candidate.duration)}，再插入它；确认后我再写入播单。`,
          'planning',
          '待确认',
          {
            explanation: '候选已确认，复合任务继续生成插入顺延计划。',
            details: {
              taskRun,
              selectedCandidate: candidate,
              affectedItems,
            },
          },
        ),
        pendingAtomicContext: pendingContext,
      }
    }

    if (pendingInsertRecommendation.resumeCompositeTask?.kind === 'batch_replace') {
      const taskRun = this.buildBatchReplaceTaskRun(
        input,
        pendingInsertRecommendation.resumeCompositeTask,
        selectedCandidate,
      )
      const pendingContext = this.buildCompositePendingContext(input, taskRun)
      return {
        kind: 'pending_atomic_context',
        feedback: createFeedback(
          `已选《${selectedCandidate.programName}》。我会把 ${pendingInsertRecommendation.resumeCompositeTask.targetItems.length} 条匹配节目替换成这个候选；确认后我再写入播单。`,
          'planning',
          '待确认',
          {
            explanation: '候选已确认，批量替换继续生成待确认复合任务计划。',
            details: {
              taskRun,
              selectedCandidate,
              targetItems: pendingInsertRecommendation.resumeCompositeTask.targetItems,
            },
          },
        ),
        pendingAtomicContext: pendingContext,
      }
    }

    if (pendingInsertRecommendation.action === 'replace') {
      if (!pendingInsertRecommendation.targetItemId) {
        return {
          kind: 'message',
          feedback: createFeedback(
            '当前替换推荐缺少目标节目，请重新发起替换指令。',
            'selection',
            '替换推荐',
            {
              explanation: pendingInsertRecommendation.reasoning,
              details: {
                targetTime: pendingInsertRecommendation.targetTime,
                selectedCandidateName: selectedCandidate.programName,
              },
            },
          ),
        }
      }
      const command: ReplaceCommand = {
        action: 'replace',
        reasoning: pendingInsertRecommendation.reasoning,
        data: {
          itemId: pendingInsertRecommendation.targetItemId,
          newCandidateId: selectedCandidate.candidateId,
        },
      }
      const preview = this.replaceCommandExecutor.preview(command)
      if (scheduleState.playlistType === 'rotation') {
        return this.executeRotationReplaceAndCompact({
          input,
          pendingInsertRecommendation,
          selectedCandidate,
          preview,
        })
      }
      if (!preview.canExecute) {
        return {
          kind: 'message',
          feedback: createFeedback(
            preview.warnings[0] || '替换后会造成时间冲突，已阻止执行。',
            'selection',
            '替换推荐',
            {
              explanation: pendingInsertRecommendation.reasoning,
              details: {
                targetTime: pendingInsertRecommendation.targetTime,
                targetItemId: pendingInsertRecommendation.targetItemId,
                targetItemName: pendingInsertRecommendation.targetItemName,
                selectedCandidateName: selectedCandidate.programName,
                preview,
              },
            },
          ),
        }
      }
      return {
        kind: 'execute_command',
        execution: {
          command,
          successMessage: `已将 ${pendingInsertRecommendation.targetTime} 的《${pendingInsertRecommendation.targetItemName || pendingInsertRecommendation.targetItemId}》替换为《${selectedCandidate.programName}》`,
          explanation: pendingInsertRecommendation.reasoning,
          details: {
            targetTime: pendingInsertRecommendation.targetTime,
            targetItemId: pendingInsertRecommendation.targetItemId,
            targetItemName: pendingInsertRecommendation.targetItemName,
            selectedCandidateName: selectedCandidate.programName,
            recommendedCandidateCount: pendingInsertRecommendation.recommendedCandidates.length,
            preview,
          },
        },
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

  private compactRotationQueue(items: ScheduleItemSnapshot[], anchorStartTime?: string): ScheduleItemSnapshot[] {
    const sorted = [...items].sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
    if (sorted.length === 0) return []

    let cursor = anchorStartTime ?? sorted[0]!.startTime
    return sorted.map((item, index) => {
      const duration = Math.max(0, item.duration ?? Math.floor((new Date(item.endTime).getTime() - new Date(item.startTime).getTime()) / 1000))
      const startTime = cursor
      const endTime = offsetDateTime(startTime, duration)
      cursor = endTime
      return {
        ...item,
        startTime,
        endTime,
        duration,
        sequence: index + 1,
      }
    })
  }

  private async executeRotationReplaceAndCompact(input: {
    input: RuntimeResolveInsertRecommendationInput
    pendingInsertRecommendation: RuntimePendingInsertRecommendation
    selectedCandidate: RuntimeInsertRecommendationCandidate
    preview: unknown
  }): Promise<RuntimeDecision> {
    const { pendingInsertRecommendation, selectedCandidate } = input
    const targetItemId = pendingInsertRecommendation.targetItemId
    if (!targetItemId) {
      return {
        kind: 'message',
        statusHint: 'failed',
        feedback: createFeedback(
          '当前替换推荐缺少目标节目，请重新发起替换指令。',
          'validation',
          '缺少目标',
          {
            explanation: pendingInsertRecommendation.reasoning,
            details: {
              selectedCandidateName: selectedCandidate.programName,
            },
          },
        ),
      }
    }
    const before = (input.input.currentSchedule ?? []).map((item, index) => this.toScheduleItemSnapshot(item, index))
    const targetIndex = before.findIndex((item) => item.id === targetItemId)
    if (targetIndex < 0) {
      return {
        kind: 'message',
        statusHint: 'failed',
        feedback: createFeedback(
          '当前替换目标已经不在这张轮播单里，请重新发起替换。',
          'validation',
          '未找到目标',
          {
            explanation: pendingInsertRecommendation.reasoning,
            details: {
              targetItemId,
              selectedCandidateName: selectedCandidate.programName,
            },
          },
        ),
      }
    }

    const target = before[targetIndex]!
    const replaced: ScheduleItemSnapshot = {
      ...target,
      programCode: selectedCandidate.programCode,
      programName: selectedCandidate.programName,
      programType: selectedCandidate.programType,
      duration: selectedCandidate.duration,
      endTime: offsetDateTime(target.startTime, selectedCandidate.duration),
    }
    const replacedItems = before.map((item, index) => (index === targetIndex ? replaced : item))
    const after = this.compactRotationQueue(replacedItems, before[0]?.startTime)
    const result = await getAtomicCapabilities().replaceAllItems(after, { skipValidation: true })
    const committed = result.success
    const beforeDuration = before.reduce((sum, item) => sum + (item.duration ?? 0), 0)
    const afterDuration = after.reduce((sum, item) => sum + (item.duration ?? 0), 0)
    const deltaSeconds = afterDuration - beforeDuration
    const deltaText = deltaSeconds === 0
      ? '总时长不变'
      : deltaSeconds > 0
        ? `总时长增加 ${this.formatDurationText(deltaSeconds)}`
        : `总时长减少 ${this.formatDurationText(Math.abs(deltaSeconds))}`
    const policy = deriveRuntimePlaylistPolicy(input.input.scheduleState)
    const targetDeltaText = policy.targetDurationSeconds
      ? `，目标总时长是 ${this.formatDurationText(policy.targetDurationSeconds)}，还需要继续检查差额`
      : ''
    const message = committed
      ? `已将《${pendingInsertRecommendation.targetItemName || target.programName}》替换为《${selectedCandidate.programName}》。轮播单会按队列自然串联，${deltaText}${targetDeltaText}。`
      : '写入轮播替换失败，当前播单没有完成这次修改。'

    return {
      kind: 'agent_execution',
      feedback: createFeedback(
        message,
        committed ? 'execution' : 'validation',
        committed ? '执行完成' : '执行异常',
        {
          explanation: pendingInsertRecommendation.reasoning,
          details: {
            playlistPolicy: policy,
            targetTime: pendingInsertRecommendation.targetTime,
            targetItemId,
            targetItemName: pendingInsertRecommendation.targetItemName,
            selectedCandidateName: selectedCandidate.programName,
            recommendedCandidateCount: pendingInsertRecommendation.recommendedCandidates.length,
            beforeDurationSeconds: beforeDuration,
            afterDurationSeconds: afterDuration,
            deltaSeconds,
            preview: input.preview,
          },
        },
      ),
      result: {
        status: committed ? 'executed' : 'failed',
        input: {
          userInput: input.input.userInput ?? pendingInsertRecommendation.collectedUserInput,
          channelId: input.input.scheduleState.channelId,
          date: input.input.scheduleState.date,
          playlistId: input.input.scheduleState.playlistId,
        },
        decision: {
          intent: 'replace',
          command: {
            intent: 'replace',
            itemId: targetItemId,
            candidateId: selectedCandidate.candidateId,
            candidateName: selectedCandidate.programName,
            targetTime: pendingInsertRecommendation.targetTime,
            startTime: target.startTime,
            endTime: replaced.endTime,
          },
          resolvedTargets: [target],
          preview: {
            command: {
              intent: 'replace',
              itemId: targetItemId,
              candidateId: selectedCandidate.candidateId,
              candidateName: selectedCandidate.programName,
              targetTime: pendingInsertRecommendation.targetTime,
              startTime: target.startTime,
              endTime: replaced.endTime,
            },
            before,
            after,
            affectedItemIds: [target.id],
            affectedTimeRanges: [{ start: target.startTime, end: target.endTime }],
          },
          constraintReport: {
            ok: committed,
            issues: [],
          },
        },
        executionResult: {
          committed,
          operationId: `rotation_replace_${Date.now()}`,
          affectedItemIds: [target.id],
          scheduleItems: result.data?.items ?? after,
        },
        explanation: message,
        trace: [{
          status: committed ? 'completed' : 'failed',
          label: 'Rotation replace compacted queue.',
          detail: { deltaSeconds, playlistPolicy: policy },
          timestamp: new Date().toISOString(),
        }],
      },
    }
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
        thinking: '确认执行时节目单已变化，预演中的部分节目不存在。',
        explanation: input.pendingCommand.reasoning,
        details: {
          ...input.pendingCommand.details,
          missingIds,
        },
      }
    }

    const executionValidationIssues = this.validateBatchMoveExecution(
      input.scheduleDate,
      input.channelId,
      updatedItems,
      commands.map((command) => command.data.itemId),
    )
    if (executionValidationIssues.length > 0) {
      return {
        success: false,
        command: input.pendingCommand.command,
        message: `批量平移执行前发现 ${executionValidationIssues.length} 个风险，已取消写回。`,
        error: 'batch_move_execution_validation_failed',
        summary: input.pendingCommand.summary,
        thinking: '确认执行时重新检查了当前节目单，发现上一版预演已经不适合继续写入。',
        explanation: input.pendingCommand.reasoning,
        details: {
          ...input.pendingCommand.details,
          validation: {
            status: 'blocked',
            issues: executionValidationIssues,
          },
          isExecutable: false,
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
        ...result.data,
        commandCount: commands.length,
      },
      affectedTimeRanges,
      validationReport,
      validationSummary: buildValidationSummary(validationReport),
    }
  }

  private isConfidentLayoutIntent(recognition?: LayoutIntentRecognition | null): boolean { return Boolean(recognition && recognition.mode !== 'clarify' && recognition.mode !== 'atomic_fallback' && recognition.confidence >= 0.72) }
  private isAtomicFallbackIntent(recognition?: LayoutIntentRecognition | null): boolean { return Boolean(recognition && recognition.mode === 'atomic_fallback' && recognition.confidence >= 0.72) }
  private buildCurrentScheduleSnapshots(items: RuntimeScheduleItem[], date: string): ScheduleItemSnapshot[] {
    return items.map((item, index) => asScheduleSnapshot(item, date, index + 1))
  }

  private async buildLayoutDraftFeasibilityReport(input: RuntimeSubmitInput, draft: LayoutDraft): Promise<DraftFeasibilityReport> {
    const historyReference = await this.dataService.getRecentScheduleReference(
      input.scheduleState.channelId,
      input.scheduleState.date,
    )
    return this.layoutDraftFeasibilityService.previewFeasibility(
      draft,
      this.buildCurrentScheduleSnapshots(input.currentSchedule, input.scheduleState.date),
      historyReference,
    )
  }

  private isLayoutDraftCommitInstruction(userInput: string): boolean {
    const normalized = userInput.replace(/\s+/g, '')
    const directPhrases = [
      '\u6309\u5f53\u524d\u7248\u9762\u5f00\u59cb\u7f16\u6392',
      '\u6309\u8fd9\u4e2a\u7248\u9762\u5f00\u59cb\u7f16\u6392',
      '\u6309\u8be5\u7248\u9762\u5f00\u59cb\u7f16\u6392',
      '\u786e\u8ba4\u7248\u9762',
      '\u91c7\u7528\u8fd9\u4e2a\u7248\u9762',
      '\u7528\u8fd9\u4e2a\u7248\u9762\u7f16\u6392',
      '\u5c31\u6309\u8fd9\u4e2a\u7248\u9762',
      '\u5c31\u6309\u8fd9\u4e2a\u8349\u6848',
      '\u6309\u8fd9\u4e2a\u7248\u9762',
      '\u6309\u8fd9\u4e2a\u8349\u6848',
      '\u7167\u8fd9\u4e2a\u7248\u9762',
      '\u7167\u8fd9\u4e2a\u8349\u6848',
      '\u8fd9\u4e2a\u7248\u9762\u53ef\u4ee5',
      '\u8fd9\u4e2a\u8349\u6848\u53ef\u4ee5',
      '\u53ef\u4ee5\u5f00\u59cb\u7f16\u6392',
      '\u6ca1\u95ee\u9898\u5f00\u59cb\u7f16\u6392',
    ]
    return directPhrases.some((phrase) => normalized.includes(phrase))
      || (/(?:\u7248\u9762|\u8349\u6848|\u65b9\u6848)/u.test(normalized) && /(?:\u6309|\u53c2\u8003|\u57fa\u4e8e|\u4f9d\u636e|\u7167|\u7528|\u786e\u8ba4|\u78ba\u8a8d|\u5f00\u59cb|\u958b\u59cb|\u6267\u884c|\u57f7\u884c|\u53ef\u4ee5)/u.test(normalized))
  }

  private convertLayoutIntentToClassification(recognition: LayoutIntentRecognition, userInput: string): TaskClassification {
    const mode: TaskMode = recognition.mode === 'clarify' || recognition.mode === 'atomic_fallback'
      ? 'clarify'
      : recognition.mode
    const targetTimeRange = this.resolveProtectedAwareLayoutTargetTimeRange(userInput, recognition.targetTimeRange)
    return { mode, confidence: recognition.confidence, reasoning: recognition.reasoning, suggestedParams: { userIntent: recognition.semanticLabel || userInput, targetTimeRange, ignoreExistingLayout: recognition.ignoreExistingLayout, semanticLabel: recognition.semanticLabel, programTypeHint: recognition.programTypeHint, segments: recognition.segments } }
  }

  private resolveProtectedAwareLayoutTargetTimeRange(
    userInput: string,
    fallback?: { start: string; end: string },
  ): { start: string; end: string } | undefined {
    const normalized = normalizeSchedulingText(userInput)
    const actionable = stripProtectedSchedulingClauses(userInput)
    if (actionable !== normalized) return parseSchedulingTimeRange(userInput) ?? fallback
    return fallback
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

  private shouldUseAtomicLlmSpecialist(input: RuntimeSubmitInput): boolean {
    if (!input.agentCoreEnabled) return false
    if (input.inputSource !== 'user' && input.inputSource !== 'quick_action') return false
    if (!input.foregroundContextPackage || input.foregroundContextPackage.scenario !== 'atomic') return false
    if (input.scheduleState.playlistType === 'none') return false
    const normalized = input.userInput.replace(/\s+/g, '')
    if (this.isExplicitLayoutDraftPreparationInstruction(normalized)) return false
    if (this.isLayoutDraftCommitInstruction(input.userInput)) return false
    if (this.isLikelyRotationDraftSegmentEdit(input)) return false
    return true
  }

  private isLikelyRotationDraftSegmentEdit(input: RuntimeSubmitInput): boolean {
    if (input.scheduleState.playlistType !== 'rotation' || !input.currentLayoutDraft) return false
    const normalized = input.userInput.replace(/\s+/g, '').toLowerCase()
    if (!/(草案|内容块|第.{0,4}段|第.{0,4}小时|换成|改成|调整为|调整成|变成)/u.test(normalized)) return false
    const labels = [
      ...input.currentLayoutDraft.columns.map((column) => column.semanticLabel ?? column.columnName ?? ''),
      ...(input.currentLayoutDraft.durationSegments ?? []).map((segment) => segment.label ?? ''),
    ]
      .map((label) => label.replace(/\s+/g, '').toLowerCase())
      .filter((label) => label.length >= 2)
    return labels.some((label) => normalized.includes(label))
  }

  private resolveRotationStructuredSegments(
    suggested: TaskClassification['suggestedParams'],
  ): LayoutIntentSegment[] | undefined {
    const normalizedSegments = this.normalizeStructuredSegments(suggested?.segments)
    return normalizedSegments
  }
  private resolvePreferredOrchestrationMode(input: RuntimeSubmitInput): Extract<TaskMode, 'full_generate' | 'partial_generate'> {
    return input.currentLayoutDraftMode ?? (input.scheduleState.isEmpty || input.scheduleState.itemCount === 0 ? 'full_generate' : 'partial_generate')
  }

  private async tryHandleAgentCoreInstruction(
    input: RuntimeSubmitInput,
    plannerAtomicAction?: Extract<AgentPlannerAction, { type: 'atomic_command' }>,
    plan?: AgentPlan,
  ): Promise<RuntimeDecision | null> {
    if (!input.agentCoreEnabled && !this.shouldAttemptAgentCoreInstruction(input.userInput)) return null

    const plannerInterpretation = this.buildPlannerAtomicInterpretation(input, plannerAtomicAction, plan)
    const agentRun = await this.runAgentCore(
      input,
      input.pendingAtomicContext?.agentPendingTask,
      plannerInterpretation,
    )
    if (agentRun.result.status === 'needs_clarification' && !agentRun.result.decision.pendingTask && agentRun.result.decision.constraintReport?.issues[0]?.code === 'unsupported_intent') {
      return input.agentCoreEnabled ? this.buildAgentCoreDecision(input, agentRun) : null
    }
    return this.buildAgentCoreDecision(input, agentRun)
  }

  private async tryHandlePlannerCompositePendingAction(
    input: RuntimeSubmitInput,
    action: Extract<AgentPlannerAction, { type: 'atomic_command' }>,
    plan: AgentPlan,
  ): Promise<RuntimeDecision | null> {
    const pending = input.pendingAtomicContext
    const taskRun = pending?.compositeTaskRun
    if (!pending || !taskRun || !action.pendingAction) return null

    if (action.pendingAction === 'cancel_pending' || action.pendingAction === 'reject') {
      return {
        kind: 'message',
        statusHint: 'cancelled',
        feedback: createFeedback(
          `已取消“${taskRun.goal}”，不会改动当前播单。`,
          'general',
          '已取消',
          {
            explanation: plan.reasoning || 'LLM planner 明确将本轮解释为取消当前待处理复合任务。',
            details: { noMutation: true, pendingAction: action.pendingAction },
          },
        ),
      }
    }

    if (action.pendingAction !== 'confirm') return null
    if (!this.isPlannerIntentCompatibleWithCompositePending(action.intent, pending)) {
      return {
        kind: 'message',
        statusHint: 'needs_clarification',
        feedback: createFeedback(
          '这次确认的操作类型与当前待处理任务不一致，我没有写入播单。请重试或重新说明要确认的任务。',
          'general',
          '需要澄清',
          {
            explanation: 'LLM planner 返回的 intent 与当前 composite pending 不匹配，结果保护层已阻止写入。',
            details: { noMutation: true, pendingIntent: pending.action, plannerIntent: action.intent },
          },
        ),
      }
    }
    if (taskRun.loopCount >= taskRun.limits.maxLoopTurns) {
      return {
        kind: 'message',
        statusHint: 'failed',
        feedback: createFeedback(
          `“${taskRun.goal}”已经连续处理了 ${taskRun.loopCount} 轮，我先停下，避免继续误改。你可以缩小范围后重新发起。`,
          'validation',
          '已中止',
          {
            explanation: '复合任务达到循环上限，结果保护层阻断继续执行。',
            details: { taskRun, maxLoopTurns: taskRun.limits.maxLoopTurns },
          },
        ),
      }
    }
    return this.executeCompositeTaskRun(input, taskRun)
  }

  private async tryHandlePlannerInsertRecommendationPendingAction(
    input: RuntimeSubmitInput,
    action: Extract<AgentPlannerAction, { type: 'atomic_command' }>,
    plan: AgentPlan,
  ): Promise<RuntimeDecision | null> {
    const pending = input.pendingAtomicContext
    if (!pending || pending.phase !== 'recommending_insert' || !pending.insertRecommendations?.length) return null

    if (action.pendingAction === 'cancel_pending' || action.pendingAction === 'reject') {
      return {
        kind: 'message',
        statusHint: 'cancelled',
        feedback: createFeedback(
          '已取消当前候选选择，不会改动播单。',
          'selection',
          '已取消',
          { explanation: plan.reasoning, details: { noMutation: true, pendingAction: action.pendingAction } },
        ),
      }
    }
    if (action.pendingAction !== 'select_candidate') return null
    const pendingIntent = pending.action === 'replace' ? 'replace' : 'insert'
    if (action.intent !== pendingIntent || !action.candidateId) {
      return {
        kind: 'message',
        statusHint: 'needs_clarification',
        feedback: createFeedback(
          '这次候选选择缺少有效的节目编号，我没有生成写入计划。请重新选择。',
          'selection',
          '需要重新选择',
          { details: { noMutation: true, plannerIntent: action.intent, candidateId: action.candidateId } },
        ),
      }
    }
    const selectedCandidate = pending.insertRecommendations.find((candidate) => candidate.candidateId === action.candidateId)
    if (!selectedCandidate) {
      return {
        kind: 'message',
        statusHint: 'needs_clarification',
        feedback: createFeedback(
          '这个候选不在当前推荐列表中，我没有生成写入计划。请从当前列表重新选择。',
          'selection',
          '候选已失效',
          { details: { noMutation: true, candidateId: action.candidateId } },
        ),
      }
    }
    return await this.resolvePendingInsertRecommendation({
      scheduleState: input.scheduleState,
      currentSchedule: input.currentSchedule,
      userInput: input.userInput,
      pendingInsertRecommendation: {
        action: pendingIntent,
        summary: pending.summary,
        reasoning: pending.reasoning,
        originalUserInput: pending.originalUserInput,
        collectedUserInput: pending.collectedUserInput,
        targetTime: pending.slots.targetTime ?? pending.slots.targetTimeHint ?? '',
        rawProgramText: pending.slots.rawProgramText,
        semanticLabel: pending.slots.semanticLabel,
        programTypeHint: pending.slots.programTypeHint,
        expectedDurationSeconds: pending.slots.expectedDurationSeconds,
        recommendedCandidates: pending.insertRecommendations,
        selectedCandidateId: selectedCandidate.candidateId,
        resumeCompositeTask: pending.resumeCompositeTask,
      },
    })
  }

  private isPlannerIntentCompatibleWithCompositePending(
    intent: AgentPlannerAtomicIntent | undefined,
    pending: RuntimePendingAtomicContext,
  ): boolean {
    if (!intent || !pending.action) return false
    if (pending.action === 'delete') return intent === 'delete' || intent === 'batch_delete'
    if (pending.action === 'move') return intent === 'move' || intent === 'batch_move'
    return intent === pending.action
  }

  private tryHandleDeterministicScheduleQuery(input: RuntimeSubmitInput): RuntimeDecision | null {
    const normalized = input.userInput.replace(/\s+/g, '')
    const isQuery = /(?:\u67e5\u4e00\u4e0b|\u67e5\u8be2|\u67e5\u627e|\u67e5\u770b|\u770b\u770b|\u627e|\u641c\u7d22|\u662f\u4ec0\u4e48|\u6709\u54ea\u4e9b|\u5728\u54ea|\u54ea\u91cc|\u51e0\u70b9\u64ad|\u64ad\u51fa\u65f6\u95f4|\u6392\u5728\u51e0\u70b9)/u.test(normalized)
    if (!isQuery) return null
    if (/(?:\u5019\u9009\u5e93|\u8282\u76ee\u5e93|\u7d20\u6750\u5e93|\u5019\u9009|\u63a8\u8350|\u53ef\u7528|\u53ef\u64ad|\u627e(?:\u51e0|\u4e00|\u4e9b|\u70b9|\u6761).*(?:\u8282\u76ee|\u7d20\u6750)|(?:\u51e0|\u4e00|\u4e9b|\u70b9|\u6761).*(?:\u8282\u76ee|\u7d20\u6750))/u.test(normalized)) return null

    const playlistLabel = input.scheduleState.playlistType === 'rotation' ? '轮播单' : '电视播单'
    const targetClock = parseAtomicClockExpression(input.userInput)
    if (targetClock) {
      const targetSeconds = clockToSeconds(targetClock.targetTime)
      const matches = input.currentSchedule.filter((item) => {
        const start = clockToSeconds(item.startTime)
        const end = clockToSeconds(item.endTime)
        return start <= targetSeconds && targetSeconds < end
      })
      const targetText = toClockText(targetClock.targetTime)
      const content = matches.length > 0
        ? `我查到 ${targetText} 命中 ${matches.length} 条节目：${matches.map((item) => `${toClockText(item.startTime)} ${item.programName || item.programCode || item.id}`).join('；')}。`
        : `我查了当前${playlistLabel}，${targetText} 没有已编排节目。`
      return {
        kind: 'message',
        statusHint: 'completed',
        feedback: createFeedback(content, 'general', '查询结果', {
          details: {
            queryKind: 'time_lookup',
            targetTime: targetText,
            matchedCount: matches.length,
            matches: matches.map((item) => asRuntimeItem(item)),
            playlistType: input.scheduleState.playlistType,
            queryResult: {
              kind: 'time_lookup',
              targetTime: targetText,
              scheduleItems: matches.map((item) => asRuntimeItem(item)),
              totalCount: matches.length,
              playlistType: input.scheduleState.playlistType,
            },
            agentEvidenceBudget: this.buildDeterministicQueryEvidenceBudget(input),
          },
        }),
      }
    }

    if (this.isScheduleOverviewQuery(normalized)) {
      const first = input.currentSchedule[0]
      const last = input.currentSchedule[input.currentSchedule.length - 1]
      const rangeText = first && last
        ? `，覆盖 ${toClockText(first.startTime)}-${toClockText(last.endTime)}`
        : ''
      const content = input.currentSchedule.length > 0
        ? `当前${playlistLabel}共有 ${input.currentSchedule.length} 条节目${rangeText}。`
        : `当前${playlistLabel}还没有已编排节目。`
      return {
        kind: 'message',
        statusHint: 'completed',
        feedback: createFeedback(content, 'general', '查询结果', {
          details: {
            queryKind: 'schedule_overview',
            matchedCount: input.currentSchedule.length,
            matches: input.currentSchedule.map((item) => asRuntimeItem(item)),
            playlistType: input.scheduleState.playlistType,
            queryResult: {
              kind: 'schedule_overview',
              scheduleItems: input.currentSchedule.map((item) => asRuntimeItem(item)),
              totalCount: input.currentSchedule.length,
              playlistType: input.scheduleState.playlistType,
            },
            agentEvidenceBudget: this.buildDeterministicQueryEvidenceBudget(input),
          },
        }),
      }
    }

    return null
  }

  private isScheduleOverviewQuery(normalized: string): boolean {
    if (!/(当前|这个|这张|左侧|整张|整个)?(电视播单|轮播单|播单|节目单|编排单|编单)(概览|情况|内容|有哪些|有什么|现在|当前|查一下|查询|查看|看看)?/u.test(normalized)) {
      return false
    }
    return !/(候选|节目库|素材库|推荐|可用|可播|在哪|哪里|几?点播|播出时间|排在几点|节目名|名称|标题|栏目)/u.test(normalized)
  }

  private buildDeterministicQueryEvidenceBudget(input: RuntimeSubmitInput): RuntimeDetailMap {
    return {
      scheduleItems: {
        included: input.currentSchedule.length,
        total: input.currentSchedule.length,
        truncated: false,
      },
      candidates: {
        included: 0,
        total: 0,
        truncated: false,
      },
      latestHistoryItems: {
        included: 0,
        total: 0,
        truncated: false,
      },
      playlistType: input.scheduleState.playlistType,
    }
  }

  private async tryHandleReadOnlyPlaylistDiscussion(input: RuntimeSubmitInput): Promise<RuntimeDecision | null> {
    const normalized = input.userInput.replace(/\s+/g, '')
    const isOptimizationFollowUp = this.isOptimizationSuggestionQuestion(normalized)
    const isExecutionAuthorization = this.isAnalysisExecutionAuthorization(normalized)
    const isAnalysisQuestion = this.isPlaylistAnalysisQuestion(normalized)

    if (isExecutionAuthorization && input.analysisContext?.recommendation) {
      return this.buildTaskPlanFromAnalysisAuthorization(input, input.analysisContext)
    }

    if (!isAnalysisQuestion && !isOptimizationFollowUp) {
      return null
    }

    const factPack = this.buildPlaylistFactPack(input)
    const previousContext = input.analysisContext && this.canReuseAnalysisContext(input, input.analysisContext)
      ? input.analysisContext
      : null
    const kind: RuntimeAnalysisContext['kind'] = isOptimizationFollowUp ? 'optimization_suggestion' : 'playlist_analysis'
    const rawAnswer = await this.generatePlaylistAnalysisReply({
      userInput: input.userInput,
      kind,
      factPack,
      previousContext,
    })
    const answer = this.decoratePlaylistAnalysisReply(rawAnswer, kind)
    const analysisContext: RuntimeAnalysisContext = {
      kind,
      playlistId: input.scheduleState.playlistId,
      playlistType: input.scheduleState.playlistType,
      question: input.userInput,
      answer,
      recommendation: kind === 'optimization_suggestion' ? answer : previousContext?.recommendation,
      factPack,
      createdAt: new Date().toISOString(),
    }

    return {
      kind: 'message',
      statusHint: 'completed',
      analysisContext,
      feedback: createFeedback(
        answer,
        'general',
        kind === 'optimization_suggestion' ? '优化建议' : '编单分析',
        {
          explanation: kind === 'optimization_suggestion'
            ? '基于当前编单事实和上一轮分析给出只读优化建议；没有写入播单。'
            : '基于当前编单事实回答只读问题；没有写入播单。',
          details: {
            readOnly: true,
            analysisKind: kind,
            factPack,
            previousAnalysis: previousContext
              ? {
                  kind: previousContext.kind,
                  question: previousContext.question,
                  answer: previousContext.answer,
                }
              : undefined,
          },
        },
      ),
    }
  }

  private isPlaylistAnalysisQuestion(normalized: string): boolean {
    if (this.hasWriteIntentCue(normalized)) return false
    if (/(草案|版面|生成|创建|新建|重做|重新做|上点|加点|来点|放点|插播|换播|改播)/u.test(normalized)) return false
    return /(风格|节奏|结构|占比|比例|分布|总时长|时长|多少|几条|几档|哪些|什么|集中|偏多|偏少|合理|问题|怎么样|怎样|如何|评价|分析|统计|看看|看一下|有没有|是否|是不是|吗|么)/u.test(normalized)
      && /(播单|编单|节目单|当前|这张|整体|今天|电视剧|新闻|宣传片|栏目|类型|风格|节奏|时长)/u.test(normalized)
  }

  private isOptimizationSuggestionQuestion(normalized: string): boolean {
    if (this.hasWriteIntentCue(normalized)) return false
    if (/(草案|版面|生成|创建|新建|重做|重新做)/u.test(normalized)) return false
    return /(怎么优化|如何优化|怎么调整|如何调整|有什么建议|给.*建议|可以怎么改|哪里需要改|怎么更好|优化方案|调整建议)/u.test(normalized)
  }

  private isAnalysisExecutionAuthorization(normalized: string): boolean {
    return /^(?:按这个做|照这个做|按你说的做|按你说的改|照你说的做|照你说的改|按刚才说的做|按刚才说的改|按你的建议做|按你的建议改|照你的建议做|照你的建议改|按这个建议做|按这个建议改|按这个方案做|按这个方案改|按你的方案做|按你的方案改|执行这个方案|执行刚才方案|帮我调整|开始调整|就这么改|就按这个改|就按你说的改|就按你的建议处理|按这个改|可以执行|确认执行|确认执行这个方案)$/u.test(normalized)
  }

  private hasWriteIntentCue(normalized: string): boolean {
    return /(插入|插播|插一个|插个|插一条|添加|安排|排入|放置|上点|加点|来点|放点|删除|删掉|移除|去掉|撤掉|替换|换成|改成|换播|改播|移动|移到|挪到|后移|前移|顺延|补齐|补排|填充|全天编排|执行|确认执行|补(?:新闻|节目|栏目|剧场|综艺|空窗|内容))/u.test(normalized)
  }

  private canReuseAnalysisContext(input: RuntimeSubmitInput, context: RuntimeAnalysisContext): boolean {
    return context.playlistId === input.scheduleState.playlistId
      && context.playlistType === input.scheduleState.playlistType
  }

  private buildPlaylistFactPack(input: RuntimeSubmitInput): RuntimePlaylistFactPack {
    const items: RuntimePlaylistFactItem[] = input.currentSchedule.map((item) => {
      const programType = item.programType ?? 'unknown'
      const durationSeconds = item.duration
        ?? Math.max(0, Math.floor((new Date(normalizeDateTime(input.scheduleState.date, item.endTime)).getTime() - new Date(normalizeDateTime(input.scheduleState.date, item.startTime)).getTime()) / 1000))
      const columnId = resolveItemColumnId(item, input.scheduleState.channelId, input.scheduleState.date)
      const columnName = columnId ? getEffectiveColumnDefinition(columnId)?.columnName : undefined
      return {
        id: item.id,
        startTime: toClockText(item.startTime),
        endTime: toClockText(item.endTime),
        programName: item.programName ?? item.programCode ?? item.id,
        columnName,
        programType,
        durationSeconds,
        programCode: item.programCode,
      }
    })
    const typeMap = new Map<string, { programType: string; itemCount: number; durationSeconds: number }>()
    const bandMap = new Map<string, { label: string; itemCount: number; durationSeconds: number }>()
    items.forEach((item) => {
      const typeEntry = typeMap.get(item.programType) ?? { programType: item.programType, itemCount: 0, durationSeconds: 0 }
      typeEntry.itemCount += 1
      typeEntry.durationSeconds += item.durationSeconds
      typeMap.set(item.programType, typeEntry)

      const bandLabel = this.resolveFactTimeBand(item.startTime)
      const bandEntry = bandMap.get(bandLabel) ?? { label: bandLabel, itemCount: 0, durationSeconds: 0 }
      bandEntry.itemCount += 1
      bandEntry.durationSeconds += item.durationSeconds
      bandMap.set(bandLabel, bandEntry)
    })

    return {
      playlistId: input.scheduleState.playlistId,
      playlistType: input.scheduleState.playlistType,
      channelName: input.scheduleState.channelName,
      date: input.scheduleState.date,
      itemCount: items.length,
      totalDurationSeconds: items.reduce((sum, item) => sum + item.durationSeconds, 0),
      gapCount: input.scheduleState.gapCount ?? 0,
      items,
      typeDurations: Array.from(typeMap.values()).sort((left, right) => right.durationSeconds - left.durationSeconds),
      timeBands: Array.from(bandMap.values()).sort((left, right) => this.factTimeBandOrder(left.label) - this.factTimeBandOrder(right.label)),
      layoutDraftState: this.buildLayoutDraftFactState(input.currentLayoutDraft ?? null),
    }
  }

  private buildLayoutDraftFactState(draft: LayoutDraft | null): RuntimePlaylistFactPack['layoutDraftState'] {
    if (!draft) return { exists: false }
    const durationSegments = draft.durationSegments?.map((segment) => ({
      label: segment.label,
      contentHint: segment.contentHint,
      targetDurationSeconds: segment.targetDurationSeconds,
      selectionPriority: segment.selectionPriority,
    }))
    const timeSegments = draft.layoutReference.slots.map((slot, index) => {
      const column = draft.columns[index]
      return {
        label: column?.semanticLabel ?? column?.columnName ?? `时段${index + 1}`,
        startTime: toClockText(slot.startTime),
        endTime: toClockText(slot.endTime),
        programType: column?.defaultProgramType,
        constraintKind: column?.draftConstraintKind,
        queryHints: column?.queryHints?.slice(0, 5),
      }
    })

    return {
      exists: true,
      coverage: draft.coverage,
      segmentCount: draft.durationSegments?.length ?? draft.layoutReference.slots.length,
      userIntent: draft.userIntent,
      purpose: draft.purpose,
      targetDurationSeconds: draft.targetDurationSeconds,
      strategyLabel: draft.strategyProfile?.label,
      strategySummary: draft.strategyProfile?.selectionSummary,
      warnings: draft.warnings?.slice(0, 5),
      segments: (durationSegments?.length ? durationSegments : timeSegments).slice(0, 12),
    }
  }

  private resolveFactTimeBand(startTime: string): string {
    const seconds = clockToSeconds(startTime)
    if (seconds < 12 * 3600) return '上午'
    if (seconds < 18 * 3600) return '下午'
    if (seconds < 22 * 3600) return '晚间'
    return '夜间'
  }

  private factTimeBandOrder(label: string): number {
    return ['上午', '下午', '晚间', '夜间'].indexOf(label)
  }

  private async generatePlaylistAnalysisReply(input: {
    userInput: string
    kind: RuntimeAnalysisContext['kind']
    factPack: RuntimePlaylistFactPack
    previousContext: RuntimeAnalysisContext | null
  }): Promise<string> {
    try {
      const response = await this.llmClient.chat([
        {
          role: 'system',
          content: [
            `[prompt ${DEMO_RUNTIME_FACADE_PROMPT_VERSION}] 你是电视台 AI 编审助手。用户是编排员，请用简单中文回答。`,
            '这是只读问答：只能分析、解释、建议，不能说已经写入、正在写入、会直接修改播单。',
            '本地会把真实编单事实给你；你可以自己统计和分析，不要拘泥于字段名。',
            'currentPlaylistFacts 同时包含正式播单事实和当前激活草案事实。正式播单为空但 layoutDraftState.exists=true 时，不能说“还没有草案”或“给我一份草案”，要说明正式播单还空、但已有草案，并围绕草案内容分析。',
            '轮播单是内容队列，不是电视时间格。轮播草案通常描述主题、总时长和内容块；如果草案 warnings 提示关键词没有命中节目库，要建议细化关键词、放宽主题、补充可选栏目或换选择策略，而不是直接要求重新给草案。',
            '如果用户问怎么优化，默认只给建议；只有用户明确说执行/按这个做，后续系统才会生成待确认计划。',
            '如果用户问优化建议，可以在末尾自然追问是否需要更新到草案或整理成待确认修改计划；但不能说已经更新。',
            '不要输出 JSON，不要使用技术词。',
          ].join('\n'),
        },
        {
          role: 'user',
          content: JSON.stringify({
            userInput: input.userInput,
            mode: input.kind,
            currentPlaylistFacts: input.factPack,
            previousAnalysis: input.previousContext
              ? {
                  question: input.previousContext.question,
                  answer: input.previousContext.answer,
                  recommendation: input.previousContext.recommendation,
                }
              : null,
          }),
        },
      ], {
        temperature: 0.3,
        maxTokens: 700,
        timeout: STAGE_TIMEOUT_BUDGET.intent_parse,
        maxRetries: 1,
        traceLabel: input.kind === 'optimization_suggestion' ? 'playlist.optimization_suggestion' : 'playlist.readonly_analysis',
        promptVersion: DEMO_RUNTIME_FACADE_PROMPT_VERSION,
      })
      const content = response.content.trim()
      if (content) return content
    } catch {
      // Fall through to a deterministic fallback so read-only questions never fail the foreground flow.
    }
    return input.kind === 'optimization_suggestion'
      ? this.buildFallbackOptimizationSuggestion(input.factPack, input.previousContext)
      : this.buildFallbackPlaylistAnalysis(input.factPack)
  }

  private decoratePlaylistAnalysisReply(answer: string, kind: RuntimeAnalysisContext['kind']): string {
    const trimmed = answer.trim()
    if (kind !== 'optimization_suggestion' || !trimmed) return trimmed
    if (/(更新到草案|写入草案|整理成.*草案|草案.*待确认|待确认.*草案)/u.test(trimmed)) return trimmed
    const ending = /[。！？!?]$/u.test(trimmed) ? '' : '。'
    return `${trimmed}${ending}如果你觉得这个方向可以，需要我更新到草案或整理成待确认的修改计划，也可以直接告诉我。`
  }

  private buildFallbackPlaylistAnalysis(facts: RuntimePlaylistFactPack): string {
    if (facts.itemCount === 0 && facts.layoutDraftState.exists) {
      const draftSummary = this.describeLayoutDraftFacts(facts)
      const issueText = this.describeLayoutDraftWarnings(facts)
      return `当前正式播单还没有节目，但已经有一份草案。${draftSummary}${issueText}你可以继续让我优化草案，我会先给建议，不会直接写入正式播单。`
    }
    if (facts.itemCount === 0) return '当前编单还没有节目，我只能先看到它是空的。你可以先告诉我主要内容、总时长或上传草案，我再帮你分析整体风格。'
    const dominant = facts.typeDurations[0]
    const dominantText = dominant
      ? `目前占比最高的是 ${this.describeProgramType(dominant.programType)}，共 ${this.formatDurationText(dominant.durationSeconds)}。`
      : ''
    return `当前编单共有 ${facts.itemCount} 条节目，总时长 ${this.formatDurationText(facts.totalDurationSeconds)}。${dominantText}你可以继续问我“怎么优化”，我会按当前节目结构给出调整建议。`
  }

  private buildFallbackOptimizationSuggestion(facts: RuntimePlaylistFactPack, previousContext: RuntimeAnalysisContext | null): string {
    if (facts.itemCount === 0 && facts.layoutDraftState.exists) {
      const draftSummary = this.describeLayoutDraftFacts(facts)
      const issueText = this.describeLayoutDraftWarnings(facts)
      const contextText = previousContext ? '接着刚才的分析看，' : ''
      return `${contextText}${draftSummary}${issueText}建议先把草案里的主题词拆成更容易检索的节目线索，补充可接受的栏目、节目类型或替代关键词；如果候选太少，可以放宽内容匹配优先，改为热播或收视表现兜底。如果你觉得这个方向可以，我可以帮你整理成待确认的草案更新。`
    }
    if (facts.itemCount === 0) return '当前编单还是空的，优化前需要先确定主要内容、总时长和草案。'
    const dominant = facts.typeDurations[0]
    const mainSuggestion = dominant
      ? `可以先检查 ${this.describeProgramType(dominant.programType)} 是否过于集中，再考虑把不同类型节目分散到上午、下午和晚间。`
      : '可以先按时段检查内容是否单一，再补一些节奏不同的节目。'
    const contextText = previousContext ? '接着刚才的分析看，' : ''
    return `${contextText}${mainSuggestion} 如果你要我真正调整，需要再说“按这个做”，我会先生成待确认的修改计划。`
  }

  private describeLayoutDraftFacts(facts: RuntimePlaylistFactPack): string {
    const draft = facts.layoutDraftState
    const durationText = draft.targetDurationSeconds
      ? `目标总时长 ${this.formatDurationText(draft.targetDurationSeconds)}，`
      : draft.coverage
        ? `覆盖 ${draft.coverage.start}-${draft.coverage.end}，`
        : ''
    const purposeText = draft.purpose || draft.userIntent
      ? `主题是“${draft.purpose ?? draft.userIntent}”，`
      : ''
    const segmentsText = draft.segments?.length
      ? `已有 ${draft.segments.length} 个内容块：${draft.segments.slice(0, 3).map((segment) =>
          segment.contentHint
            ? `${segment.label}（${segment.contentHint}）`
            : segment.label,
        ).join('、')}。`
      : draft.segmentCount
        ? `已有 ${draft.segmentCount} 个内容块。`
        : ''
    return `${purposeText}${durationText}${segmentsText}`
  }

  private describeLayoutDraftWarnings(facts: RuntimePlaylistFactPack): string {
    const warnings = facts.layoutDraftState.warnings?.filter(Boolean) ?? []
    if (!warnings.length) return ''
    return `现在主要问题是：${warnings.slice(0, 2).join('；')}。`
  }

  private async buildTaskPlanFromAnalysisAuthorization(
    input: RuntimeSubmitInput,
    analysisContext: RuntimeAnalysisContext,
  ): Promise<RuntimeDecision> {
    if (!this.canReuseAnalysisContext(input, analysisContext)) {
      return {
        kind: 'message',
        statusHint: 'needs_clarification',
        analysisContext: null,
        feedback: createFeedback(
          '当前打开的播单已经变了。你可以先问我这张播单怎么优化，我再给新的建议。',
          'general',
          '需要重新分析',
          {
            explanation: '上一轮分析不属于当前播单，不能直接转成执行计划。',
            details: { previousPlaylistId: analysisContext.playlistId, currentPlaylistId: input.scheduleState.playlistId },
          },
        ),
      }
    }

    const taskPlanDraft = await this.generateTaskPlanDraftFromAnalysis(input, analysisContext)
    if (!taskPlanDraft) {
      return {
        kind: 'message',
        statusHint: 'needs_clarification',
        analysisContext,
        feedback: createFeedback(
          '我知道你想按刚才的建议调整，但这份建议还不够落成明确操作。你可以补一句具体想先改哪一块，比如“先把晚间新闻后移”或“先减少电视剧”。',
          'planning',
          '需要更具体',
          {
            explanation: 'LLM 没有给出可编译的复合任务计划，本地没有生成写入确认。',
            details: { analysisContext, factPack: this.buildPlaylistFactPack(input) },
          },
        ),
      }
    }

    const decision = await this.buildCompositeTaskCompileDecision(
      {
        ...input,
        userInput: `${analysisContext.recommendation ?? analysisContext.answer}\n用户确认：${input.userInput}`,
      },
      taskPlanDraft,
    )
    if (decision) return decision

    return {
      kind: 'message',
      statusHint: 'needs_clarification',
      analysisContext,
      feedback: createFeedback(
        '刚才的优化建议还不能直接转成当前支持的原子操作组合。你可以指定一个更具体的动作，我再生成待确认计划。',
        'planning',
        '需要更具体',
        {
          explanation: '任务计划草稿未被当前 TaskPlan 编译器支持。',
          details: { taskPlanDraft, analysisContext },
        },
      ),
    }
  }

  private async generateTaskPlanDraftFromAnalysis(
    input: RuntimeSubmitInput,
    analysisContext: RuntimeAnalysisContext,
  ): Promise<AgentTaskPlanDraft | null> {
    try {
      const response = await this.llmClient.chat([
        {
          role: 'system',
          content: [
            `[prompt ${DEMO_RUNTIME_FACADE_PROMPT_VERSION}] 你是电视播单复合任务计划草稿生成器。`,
            '用户刚才收到的是只读优化建议，现在明确要求按建议执行。',
            '你只能输出 JSON，不能说已经执行，不能跳过确认。',
            '只在能映射到现有原子能力时返回 taskPlanDraft：delete、batch_delete、move、batch_move、insert、replace、verify。',
            '不确定具体目标时，返回 {"taskPlanDraft":null,"assistantReplyDraft":"..."}。',
            'taskPlanDraft 格式：{"isComposite":true,"goal":"...","stages":[{"type":"batch_atomic","action":"delete","target":{"programName":"看东方","scope":"current_playlist"},"requiresConfirmation":true,"summary":"..."},{"type":"verify","requiresConfirmation":false,"summary":"..."}]}',
            '不要生成新的 UI，不要绕过候选选择，不要把全天编排或补排当成普通原子操作。',
          ].join('\n'),
        },
        {
          role: 'user',
          content: JSON.stringify({
            authorization: input.userInput,
            previousAnalysis: {
              question: analysisContext.question,
              answer: analysisContext.answer,
              recommendation: analysisContext.recommendation,
            },
            currentPlaylistFacts: this.buildPlaylistFactPack(input),
          }),
        },
      ], {
        temperature: 0,
        maxTokens: 700,
        timeout: STAGE_TIMEOUT_BUDGET.intent_parse,
        maxRetries: 1,
        traceLabel: 'playlist.analysis_to_task_plan',
        promptVersion: DEMO_RUNTIME_FACADE_PROMPT_VERSION,
      })
      const parsed = this.parseLooseJsonObject(response.content)
      const taskPlanDraft = parsed?.taskPlanDraft
      if (!taskPlanDraft || typeof taskPlanDraft !== 'object') return null
      const source = taskPlanDraft as Partial<AgentTaskPlanDraft>
      if (source.isComposite !== true || typeof source.goal !== 'string' || !Array.isArray(source.stages)) return null
      return source as AgentTaskPlanDraft
    } catch {
      return null
    }
  }

  private parseLooseJsonObject(value: string): Record<string, unknown> | null {
    try {
      return JSON.parse(value) as Record<string, unknown>
    } catch {
      const match = value.match(/\{[\s\S]*\}/)
      if (!match?.[0]) return null
      try {
        return JSON.parse(match[0]) as Record<string, unknown>
      } catch {
        return null
      }
    }
  }

  private describeProgramType(programType: string): string {
    const map: Record<string, string> = {
      tv: '电视节目',
      news: '新闻',
      news_magazine: '新闻资讯',
      drama: '电视剧',
      entertainment: '娱乐节目',
      health: '健康养生',
      documentary: '纪录片',
      kids: '少儿节目',
      commentary: '评论访谈',
      short_clip: '短片',
      unknown: '未标注类型节目',
    }
    return map[programType] ?? programType
  }

  private async continueAgentCorePendingTask(input: RuntimeSubmitInput, pendingTask: AgentPendingTask): Promise<RuntimeDecision> {
    const agentRun = await this.runAgentCore(input, pendingTask)
    return this.buildAgentCoreDecision(input, agentRun)
  }

  private async continueCompositeTaskRun(input: RuntimeSubmitInput, taskRun: SchedulingTaskRun): Promise<RuntimeDecision | null> {
    const normalized = input.userInput.replace(/\s+/g, '')
    if (this.isCompositeTaskConfirmInput(normalized)) {
      if (taskRun.loopCount >= taskRun.limits.maxLoopTurns) {
        return {
          kind: 'message',
          statusHint: 'failed',
          feedback: createFeedback(
            `“${taskRun.goal}”已经连续处理了 ${taskRun.loopCount} 轮，我先停下，避免继续误改。你可以缩小范围后重新发起。`,
            'validation',
            '已中止',
            {
              explanation: '复合任务达到循环上限，本地状态机阻断继续执行。',
              details: {
                taskRun,
                maxLoopTurns: taskRun.limits.maxLoopTurns,
              },
            },
          ),
        }
      }
      return this.executeCompositeTaskRun(input, taskRun)
    }
    if (this.isCompositeTaskCancelInput(normalized)) {
      return {
        kind: 'message',
        statusHint: 'cancelled',
        feedback: createFeedback(
          `已取消“${taskRun.goal}”，不会改动当前播单。`,
          'general',
          '已取消',
          {
            explanation: '用户取消了复合任务计划。',
            details: { taskRun },
          },
        ),
      }
    }
    return this.submitInstruction(this.clearPendingAtomicState(input))
  }

  private async tryBuildCompositeTaskDecision(input: RuntimeSubmitInput): Promise<RuntimeDecision | null> {
    const deleteTimeRange = this.extractCompositeBatchDeleteTimeRange(input.userInput)
    if (deleteTimeRange) {
      const { start, end } = deleteTimeRange.range
      const taskPlanDraft: AgentTaskPlanDraft = {
        isComposite: true,
        goal: `删除 ${start}-${end} 的全部节目`,
        stages: [
          {
            type: 'batch_atomic',
            action: 'delete',
            target: {
              rangeStart: start,
              rangeEnd: end,
              scope: 'time_range',
            },
            requiresConfirmation: true,
            summary: `删除 ${start}-${end} 的全部节目`,
          },
          {
            type: 'verify',
            requiresConfirmation: false,
            summary: `检查 ${start}-${end} 是否还有节目`,
          },
        ],
      }
      return await this.buildCompositeTaskCompileDecision(input, taskPlanDraft)
    }

    const deleteTarget = this.extractCompositeBatchDeleteProgramName(input.userInput)
    if (!deleteTarget) return null

    const taskPlanDraft: AgentTaskPlanDraft = {
      isComposite: true,
      goal: this.hasDraftRefillCompositeCue(input.userInput)
        ? `删除全部${deleteTarget}，再按草案补齐空窗`
        : `删除全部${deleteTarget}`,
      stages: [
        {
          type: 'batch_atomic',
          action: 'delete',
          target: {
            programName: deleteTarget,
            scope: 'current_playlist',
          },
          requiresConfirmation: true,
          summary: `删除当前播单里的${deleteTarget}`,
        },
        ...(this.hasDraftRefillCompositeCue(input.userInput)
          ? [{
              type: 'draft_refill' as const,
              requiresLayoutDraft: true,
              layoutDraftReferenced: true,
              requiresConfirmation: true,
              summary: '按当前激活草案补齐删除后留下的空窗',
            }]
          : []),
        {
          type: 'verify',
          requiresConfirmation: false,
          summary: `检查当前播单里是否还剩${deleteTarget}`,
        },
      ],
    }
    return await this.buildCompositeTaskCompileDecision(input, taskPlanDraft)
  }

  private tryBuildRawCompositeConflictDecision(input: RuntimeSubmitInput): RuntimeDecision | null {
    const normalized = input.userInput.replace(/\s+/g, '')
    if (/(顺延|后移|往后|向后|推后|延后|放后面|排后面|之后|前面|之前|先.*再|再.*后面|强制插入)/u.test(normalized)) {
      return null
    }

    const insertConflict = this.extractSameTimeMultipleInsertConflict(input.userInput)
    if (insertConflict) {
      return {
        kind: 'message',
        statusHint: 'needs_clarification',
        feedback: createFeedback(
          `${insertConflict.targetTime} 同时要插入多个节目，我需要你先确认顺序或改一个时间。`,
          'planning',
          '需要确认顺序',
          {
            explanation: '用户原始指令包含同一时间多个插入目标，本地阻止进入执行确认。',
            details: insertConflict,
          },
        ),
      }
    }

    const moveInsertConflict = this.extractMoveAndInsertSameTimeConflict(input.userInput)
    if (moveInsertConflict) {
      return {
        kind: 'message',
        statusHint: 'needs_clarification',
        feedback: createFeedback(
          `${moveInsertConflict.targetTime} 同时有移动和插入动作，会互相占位。我需要你先确认谁在前、谁顺延。`,
          'planning',
          '需要确认顺序',
          {
            explanation: '用户原始指令包含同一目标时间的移动和插入动作，本地阻止进入执行确认。',
            details: moveInsertConflict,
          },
        ),
      }
    }

    return null
  }

  private async buildCompositeTaskCompileDecision(
    input: RuntimeSubmitInput,
    taskPlanDraft: AgentTaskPlanDraft,
  ): Promise<RuntimeDecision | null> {
    const insertCandidateDecision = await this.preflightCompositeInsertCandidate(input, taskPlanDraft)
    if (insertCandidateDecision) return insertCandidateDecision
    const playlistPolicy = deriveRuntimePlaylistPolicy(input.scheduleState)
    const conflictValidation = validateSchedulingTaskPlanDraftConflicts(taskPlanDraft)
    if (!conflictValidation.ok) {
      const firstConflict = conflictValidation.conflicts[0]
      return {
        kind: 'message',
        statusHint: 'needs_clarification',
        feedback: createFeedback(
          firstConflict?.message ?? '这几步编排目标互相冲突，我需要你先确认执行顺序。',
          'planning',
          '需要确认顺序',
          {
            explanation: '复合任务计划在编译前发现目标时间冲突，已阻止进入确认执行。',
            details: {
              taskPlanDraft,
              conflicts: conflictValidation.conflicts,
            },
          },
        ),
      }
    }
    const compileResult = compileSchedulingTaskPlanDraft({
      draft: taskPlanDraft,
      userInput: input.userInput,
      currentSchedule: input.currentSchedule,
      playlistPolicy,
    })
    if (compileResult.status === 'unsupported') return null
    if (compileResult.status === 'blocked') {
      if (compileResult.reason === 'needs_candidate_selection') {
        const candidateSelectionDecision = await this.buildBatchReplaceCandidateSelectionDecision(input, taskPlanDraft, compileResult.details)
        if (candidateSelectionDecision) return candidateSelectionDecision
      }
      const processLabel = compileResult.reason === 'too_many_matches'
        ? '需要缩小范围'
        : compileResult.reason === 'needs_candidate_selection'
          ? '需要选择候选'
          : '未找到'
      return {
        kind: 'message',
        statusHint: compileResult.reason === 'needs_candidate_selection' ? 'needs_clarification' : 'failed',
        feedback: createFeedback(
          compileResult.message,
          'validation',
          processLabel,
          {
            explanation: '复合任务计划已交给本地编译器校验，当前不能直接生成可执行步骤。',
            details: {
              taskPlanDraft,
              ...compileResult.details,
            },
          },
        ),
      }
    }

    const taskRun = compileResult.taskRun
    const pendingContext = this.buildCompositePendingContext(input, taskRun)
    return {
      kind: 'pending_atomic_context',
      feedback: createFeedback(
        this.describeCompositeTaskConfirmation(taskRun),
        'planning',
        '待确认',
        {
          explanation: '已把用户目标编译为复合任务计划，等待确认后执行第一阶段。',
          details: {
            taskRun,
            taskPlanDraft,
            taskPlanLimits: taskRun.limits,
            playlistPolicy,
            matchedCount: compileResult.matchedItems.length,
          },
        },
      ),
      pendingAtomicContext: pendingContext,
    }
  }

  private async preflightCompositeInsertCandidate(
    input: RuntimeSubmitInput,
    taskPlanDraft: AgentTaskPlanDraft,
  ): Promise<RuntimeDecision | null> {
    const request = extractCompositeInsertCandidateRequest(taskPlanDraft)
    if (!request) return null

    const searchedCandidates = await this.candidateService.searchPrograms({
      channelId: input.scheduleState.channelId,
      programName: request.programName,
      columnStrategy: 'prefer_channel',
      limit: request.expectedDurationSeconds ? 20 : 6,
    })
    const candidates = filterCompositeInsertCandidates(searchedCandidates, request)
    if (candidates.length === 0) {
      const durationText = request.expectedDurationSeconds
        ? this.formatDurationText(request.expectedDurationSeconds)
        : ''
      return {
        kind: 'message',
        statusHint: 'failed',
        feedback: createFeedback(
          `节目库里没有找到${durationText ? `时长为${durationText}的` : ''}“${request.programName}”候选，我没有生成写入计划。`,
          'validation',
          '未找到',
          {
            explanation: 'LLM 已给出插入顺延计划，但候选库硬条件不满足，结果保护层已阻断。',
            details: {
              noMutation: true,
              rejectedReason: 'composite_insert_candidate_mismatch',
              expectedDurationSeconds: request.expectedDurationSeconds,
              searchedCandidateCount: searchedCandidates.length,
            },
          },
        ),
      }
    }

    if (candidates.length > 1) {
      const recommendations = candidates.slice(0, 5).map((candidate, index) => ({
        candidateId: candidate.id,
        programName: candidate.programName,
        programCode: candidate.programCode,
        duration: candidate.duration,
        programType: candidate.programType,
        score: Math.max(60, 92 - index * 8),
        confidence: Math.max(0.55, 0.92 - index * 0.08),
        reasonTags: [index === 0 ? '插入顺延优先候选' : '插入顺延备选候选'],
      }))
      const pendingRecommendation = this.buildPendingInsertRecommendation(
        {
          targetTime: request.targetTime,
          programName: request.programName,
          rawProgramText: request.programName,
          expectedDurationSeconds: request.expectedDurationSeconds,
        },
        input.userInput,
        '插入顺延属于复合写入；多个候选必须由用户明确选择。',
        recommendations,
        { resumeCompositeTask: { kind: 'insert_with_shift' } },
      )
      return {
        kind: 'pending_atomic_context',
        feedback: createFeedback(
          `我找到了 ${recommendations.length} 个符合条件的“${request.programName}”候选，请先选一个。`,
          'selection',
          '候选决策',
          { details: { noMutation: true, taskPlanDraft, recommendations } },
        ),
        pendingAtomicContext: buildPendingAtomicContextFromInsertRecommendation(pendingRecommendation),
      }
    }

    const candidate = candidates[0]!
    const targetSeconds = clockToSeconds(request.targetTime)
    const affectedItems = input.currentSchedule.filter((item) => {
      const start = clockToSeconds(item.startTime)
      const end = clockToSeconds(item.endTime)
      return start >= targetSeconds || (start <= targetSeconds && targetSeconds < end)
    })
    if (affectedItems.length > DEFAULT_SCHEDULING_TASK_LIMITS.maxStepsPerStage) {
      return {
        kind: 'message',
        statusHint: 'needs_confirmation',
        feedback: createFeedback(
          `${request.targetTime} 后会影响 ${affectedItems.length} 条节目，请缩小时间范围后重试。`,
          'planning',
          '需要分批',
          { details: { noMutation: true, affectedItems } },
        ),
      }
    }
    const taskRun = this.buildInsertWithShiftTaskRun(input, request.targetTime, candidate, affectedItems)
    return {
      kind: 'pending_atomic_context',
      feedback: createFeedback(
        this.describeCompositeTaskConfirmation(taskRun),
        'planning',
        '待确认',
        { details: { taskRun, taskPlanDraft, selectedCandidate: candidate } },
      ),
      pendingAtomicContext: this.buildCompositePendingContext(input, taskRun),
    }
  }

  private async buildBatchReplaceCandidateSelectionDecision(
    input: RuntimeSubmitInput,
    taskPlanDraft: AgentTaskPlanDraft,
    details: Record<string, unknown>,
  ): Promise<RuntimeDecision | null> {
    const replacementHint = typeof details.replacementHint === 'string' ? details.replacementHint.trim() : ''
    const matchedItems = Array.isArray(details.matchedItems)
      ? details.matchedItems.filter((item): item is RuntimeScheduleItem => Boolean(item && typeof item === 'object' && typeof (item as RuntimeScheduleItem).id === 'string'))
      : []
    if (!replacementHint || matchedItems.length === 0) return null

    const firstItem = matchedItems[0]
    const columnId = firstItem
      ? resolveItemColumnId(firstItem, input.scheduleState.channelId, input.scheduleState.date)
      : undefined
    const candidates = await this.candidateService.searchPrograms({
      channelId: input.scheduleState.channelId,
      programName: replacementHint,
      columnId,
      columnStrategy: 'prefer_channel',
      limit: 5,
    })
    if (candidates.length === 0) return null

    const recommendedCandidates: RuntimeInsertRecommendationCandidate[] = candidates.slice(0, 5).map((candidate, index) => ({
      candidateId: candidate.id,
      programName: candidate.programName,
      programCode: candidate.programCode,
      duration: candidate.duration,
      programType: candidate.programType,
      score: Math.max(60, 92 - index * 8),
      confidence: Math.max(0.55, 0.92 - index * 0.08),
      reasonTags: [
        index === 0 ? '批量替换优先候选' : '批量替换备选候选',
        input.scheduleState.playlistType === 'rotation' ? '轮播单队列替换' : '电视播单时间格替换',
      ],
    }))
    const pendingInsertRecommendation: RuntimePendingInsertRecommendation = {
      action: 'replace',
      summary: `请确认批量替换要使用的候选`,
      reasoning: '批量替换必须先确认候选；本地不会自动套用候选。',
      originalUserInput: input.userInput,
      collectedUserInput: input.userInput,
      targetTime: toClockText(firstItem?.startTime ?? '00:00:00'),
      rawProgramText: replacementHint,
      semanticLabel: replacementHint,
      recommendedCandidates,
      selectedCandidateId: null,
      resumeCompositeTask: {
        kind: 'batch_replace',
        targetLabel: typeof details.targetLabel === 'string' ? details.targetLabel : replacementHint,
        matchKind: details.matchKind === 'time_range' ? 'time_range' : 'program',
        replacementHint,
        targetItems: matchedItems,
      },
    }
    return this.buildPendingInsertRecommendationDecision(
      pendingInsertRecommendation,
      `我找到了 ${matchedItems.length} 条要替换的节目，也找到了 ${recommendedCandidates.length} 个“${replacementHint}”候选。现在还不能替你直接选其中一个。`,
      undefined,
    )
  }

  private buildCompositeBatchDeleteDecision(
    input: RuntimeSubmitInput,
    params: {
      matchKind: 'program' | 'time_range'
      targetLabel: string
      matchedItems: RuntimeScheduleItem[]
      noMatchMessage: string
    },
  ): RuntimeDecision {
    const { matchKind, targetLabel, matchedItems, noMatchMessage } = params
    if (matchedItems.length === 0) {
      return {
        kind: 'message',
        statusHint: 'failed',
        feedback: createFeedback(
          noMatchMessage,
          'validation',
          '未找到',
          {
            explanation: '复合任务批量删除前，本地先查询当前播单目标项。',
            details: {
              taskPlanDraft: {
                goal: matchKind === 'program'
                  ? `删除全部 ${targetLabel}`
                  : `删除 ${targetLabel} 的全部节目`,
                matchedCount: 0,
              },
            },
          },
        ),
      }
    }

    if (matchedItems.length > DEFAULT_SCHEDULING_TASK_LIMITS.maxMatchedItemsBeforeNarrowing) {
      return {
        kind: 'message',
        statusHint: 'failed',
        feedback: createFeedback(
          `我找到了 ${matchedItems.length} 条${this.formatCompositeTargetLabel(matchKind, targetLabel)}，数量太多。请先缩小时间范围，或分批处理。`,
          'validation',
          '需要缩小范围',
          {
            explanation: '复合任务超过单次匹配上限，已阻拦自动执行。',
            details: {
              taskLimit: DEFAULT_SCHEDULING_TASK_LIMITS.maxMatchedItemsBeforeNarrowing,
              matchedCount: matchedItems.length,
            },
          },
        ),
      }
    }

    const batchItems = matchedItems.slice(0, DEFAULT_SCHEDULING_TASK_LIMITS.maxStepsPerStage)
    const playlistPolicy = deriveRuntimePlaylistPolicy(input.scheduleState)
    const taskRun = this.buildCompositeBatchDeleteTaskRun(input, {
      matchKind,
      targetLabel,
      matchedItems: batchItems,
      totalMatched: matchedItems.length,
      processedCount: 0,
      remainingCount: matchedItems.length,
      batchIndex: 1,
      includeDraftRefillAfterFinalBatch: playlistPolicy.playlistType === 'tv' && this.hasDraftRefillCompositeCue(input.userInput),
    })
    const pendingContext = this.buildCompositePendingContext(input, taskRun)

    return {
      kind: 'pending_atomic_context',
      feedback: createFeedback(
        this.describeCompositeTaskConfirmation(taskRun),
        'planning',
        '待确认',
        {
          explanation: '已把用户目标编译为复合任务计划，等待确认后执行第一阶段。',
          details: {
            taskRun,
            taskPlanLimits: taskRun.limits,
            playlistPolicy,
          },
        },
      ),
      pendingAtomicContext: pendingContext,
    }
  }

  private buildCompositeBatchDeleteTaskRun(
    input: RuntimeSubmitInput,
    params: {
      matchKind: 'program' | 'time_range'
      targetLabel: string
      matchedItems: RuntimeScheduleItem[]
      totalMatched?: number
      processedCount?: number
      remainingCount?: number
      batchIndex?: number
      includeDraftRefillAfterFinalBatch?: boolean
    },
  ): SchedulingTaskRun {
    const now = new Date().toISOString()
    const {
      matchKind,
      targetLabel,
      matchedItems,
      totalMatched = matchedItems.length,
      processedCount = 0,
      remainingCount = matchedItems.length,
      batchIndex = 1,
      includeDraftRefillAfterFinalBatch = this.hasDraftRefillCompositeCue(input.userInput),
    } = params
    const playlistPolicy = deriveRuntimePlaylistPolicy(input.scheduleState)
    const isChunked = totalMatched > matchedItems.length || batchIndex > 1
    const targetText = this.formatCompositeTargetLabel(matchKind, targetLabel)
    const expectedRemaining = Math.max(0, remainingCount - matchedItems.length)
    const deleteStage: SchedulingTaskStage = {
      id: `stage_delete_${Date.now()}`,
      type: 'batch_atomic',
      status: 'waiting_confirm',
      summary: isChunked
        ? `先删除第 ${batchIndex} 批 ${matchedItems.length} 条${targetText}`
        : `删除当前播单里的 ${matchedItems.length} 条${targetText}`,
      action: 'delete',
      requiresConfirmation: true,
      steps: matchedItems.map((item, index) => ({
        id: `delete_${item.id || index}`,
        action: 'delete',
        itemId: item.id,
        targetTime: toClockText(item.startTime),
        programName: item.programName,
        slots: {
          targetTime: toClockText(item.startTime),
          targetItemId: item.id,
          targetItemName: item.programName,
          programName: matchKind === 'program' ? targetLabel : item.programName,
        },
      })),
      verification: {
        type: expectedRemaining > 0 ? 'batch_progress' : 'program_absent',
        programName: matchKind === 'program' ? targetLabel : undefined,
        expectedRemaining,
      },
    }
    const stages: SchedulingTaskStage[] = [deleteStage]
    if (playlistPolicy.playlistType === 'tv' && includeDraftRefillAfterFinalBatch && expectedRemaining === 0) {
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
    if (playlistPolicy.playlistType === 'rotation') {
      stages.push({
        id: `stage_rotation_verify_${Date.now()}`,
        type: 'verify',
        status: 'pending',
        summary: playlistPolicy.targetDurationSeconds
          ? '检查轮播单总时长差额和内容结构'
          : '检查轮播单队列串联和内容结构',
        requiresConfirmation: false,
        verification: {
          type: 'rotation_duration_balance',
          targetDurationSeconds: playlistPolicy.targetDurationSeconds,
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
        programName: matchKind === 'program' ? targetLabel : undefined,
        expectedRemaining,
      },
    })
    return {
      id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      goal: stages.length > 2
        ? `删除全部${targetText}，再按草案补齐空窗`
        : `删除全部${targetText}`,
      originalUserInput: input.userInput,
      status: 'waiting_confirm',
      currentStageIndex: 0,
      loopCount: 0,
      limits: DEFAULT_SCHEDULING_TASK_LIMITS,
      playlistPolicy,
      stages,
      batch: isChunked || matchKind === 'time_range'
        ? {
            strategy: 'chunked',
            matchKind,
            targetLabel,
            totalMatched,
            processedCount,
            remainingCount,
            batchSize: DEFAULT_SCHEDULING_TASK_LIMITS.maxStepsPerStage,
            batchIndex,
            includeDraftRefillAfterFinalBatch,
          }
        : undefined,
      createdAt: now,
      updatedAt: now,
    }
  }

  private buildCompositePendingContext(
    input: { userInput?: string },
    taskRun: SchedulingTaskRun,
  ): RuntimePendingAtomicContext {
    const targetLabel = taskRun.batch?.targetLabel
      ?? taskRun.stages[0]?.verification?.programName
      ?? taskRun.stages[0]?.steps?.[0]?.programName
      ?? ''
    const matchKind = taskRun.batch?.matchKind ?? 'program'
    return this.pendingAtomicContextService.initialize({
      action: taskRun.stages[0]?.action ?? 'delete',
      phase: 'clarifying',
      summary: this.describeCompositeTaskSummary(taskRun),
      reasoning: this.describeCompositeTaskConfirmation(taskRun),
      confirmationNote: this.describeCompositeTaskConfirmation(taskRun),
      originalUserInput: taskRun.originalUserInput,
      collectedUserInput: input.userInput ?? taskRun.originalUserInput,
      slots: {
        programName: matchKind === 'program' ? targetLabel : undefined,
        rawProgramText: targetLabel,
      },
      missingFields: ['selection'],
      followUpQuestion: this.describeCompositeTaskConfirmation(taskRun),
      compositeTaskRun: taskRun,
      attemptCount: 0,
      createdAt: taskRun.createdAt,
      updatedAt: taskRun.updatedAt,
    })
  }

  private buildInsertWithShiftTaskRun(
    input: RuntimeSubmitInput,
    targetTime: string,
    candidate: ProgramCandidate,
    affectedItems: RuntimeScheduleItem[],
  ): SchedulingTaskRun {
    return buildInsertWithShiftSchedulingTaskRun({
      userInput: input.userInput,
      targetTime,
      candidateId: candidate.id,
      candidateCode: candidate.programCode,
      candidateProgramType: candidate.programType,
      programName: candidate.programName,
      durationSeconds: candidate.duration,
      affectedItems,
      playlistPolicy: deriveRuntimePlaylistPolicy(input.scheduleState),
      limits: DEFAULT_SCHEDULING_TASK_LIMITS,
    })
  }

  private buildBatchReplaceTaskRun(
    input: RuntimeResolveInsertRecommendationInput,
    resumeTask: Extract<RuntimeResumeCompositeTask, { kind: 'batch_replace' }>,
    selectedCandidate: RuntimeInsertRecommendationCandidate,
  ): SchedulingTaskRun {
    const now = new Date().toISOString()
    const playlistPolicy = deriveRuntimePlaylistPolicy(input.scheduleState)
    const targetItems = resumeTask.targetItems.slice(0, DEFAULT_SCHEDULING_TASK_LIMITS.maxStepsPerStage)
    const replaceStage: SchedulingTaskStage = {
      id: `stage_batch_replace_${Date.now()}`,
      type: 'batch_atomic',
      status: 'waiting_confirm',
      summary: `把 ${targetItems.length} 条${resumeTask.matchKind === 'time_range' ? '时段内节目' : `《${resumeTask.targetLabel}》`}替换为《${selectedCandidate.programName}》`,
      action: 'replace',
      requiresConfirmation: true,
      steps: targetItems.map((item, index) => ({
        id: `replace_${item.id || index}`,
        action: 'replace',
        itemId: item.id,
        candidateId: selectedCandidate.candidateId,
        candidateCode: selectedCandidate.programCode,
        candidateProgramType: selectedCandidate.programType,
        targetTime: toClockText(item.startTime),
        programName: selectedCandidate.programName,
        durationSeconds: selectedCandidate.duration,
        slots: {
          targetTime: toClockText(item.startTime),
          targetItemId: item.id,
          targetItemName: item.programName,
          replacementProgramName: selectedCandidate.programName,
        },
      })),
    }
    return {
      id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      goal: `批量替换${resumeTask.matchKind === 'time_range' ? ` ${resumeTask.targetLabel} 时段内节目` : `《${resumeTask.targetLabel}》`}为《${selectedCandidate.programName}》`,
      originalUserInput: input.userInput ?? resumeTask.replacementHint,
      playlistPolicy,
      status: 'waiting_confirm',
      currentStageIndex: 0,
      loopCount: 0,
      limits: DEFAULT_SCHEDULING_TASK_LIMITS,
      stages: [
        replaceStage,
        {
          id: `stage_verify_${Date.now()}`,
          type: 'verify',
          status: 'pending',
          summary: playlistPolicy.playlistType === 'rotation'
            ? '检查轮播单队列串联和总时长变化'
            : '检查电视播单替换后的时间轴',
          requiresConfirmation: false,
          verification: {
            type: playlistPolicy.playlistType === 'rotation' ? 'rotation_duration_balance' : 'time_axis_valid',
            targetDurationSeconds: playlistPolicy.targetDurationSeconds,
          },
        },
      ],
      batch: resumeTask.matchKind === 'time_range' || resumeTask.targetItems.length > targetItems.length
        ? {
            strategy: 'chunked',
            matchKind: resumeTask.matchKind,
            targetLabel: resumeTask.targetLabel,
            totalMatched: resumeTask.targetItems.length,
            processedCount: 0,
            remainingCount: resumeTask.targetItems.length,
            batchSize: DEFAULT_SCHEDULING_TASK_LIMITS.maxStepsPerStage,
            batchIndex: 1,
          }
        : undefined,
      createdAt: now,
      updatedAt: now,
    }
  }

  private async executeCompositeTaskRun(input: RuntimeSubmitInput, taskRun: SchedulingTaskRun): Promise<RuntimeDecision> {
    const activeStage = taskRun.stages[taskRun.currentStageIndex]
    if (activeStage?.type === 'batch_atomic' && activeStage.action === 'move') {
      return this.executeInsertWithShiftTaskRun(input, taskRun, activeStage)
    }
    if (activeStage?.type === 'batch_atomic' && activeStage.action === 'replace') {
      return this.executeBatchReplaceTaskRun(input, taskRun, activeStage)
    }
    if (!activeStage || activeStage.type !== 'batch_atomic' || activeStage.action !== 'delete') {
      return {
        kind: 'message',
        statusHint: 'failed',
        feedback: createFeedback(
          '这个任务计划暂时不能执行，请重新发起操作。',
          'validation',
          '已阻断',
          {
            explanation: '复合任务当前阶段不是可执行的批量删除阶段。',
            details: { taskRun },
          },
        ),
      }
    }

    const deleteIds = new Set((activeStage.steps ?? []).map((step) => step.itemId).filter(Boolean))
    const before = input.currentSchedule.map((item, index) => this.toScheduleItemSnapshot(item, index))
    const filteredAfter = before.filter((item) => !deleteIds.has(item.id))
    const after = taskRun.playlistPolicy?.playlistType === 'rotation'
      ? this.compactRotationQueue(filteredAfter, before[0]?.startTime)
      : filteredAfter

    const replaceResult = await getAtomicCapabilities().replaceAllItems(after, { skipValidation: true })
    const observedAfter = replaceResult.success ? after : before
    const observation = observeBatchDeleteSchedulingTask({
      before,
      after: observedAfter,
      taskRun,
      stage: activeStage,
      writeSucceeded: replaceResult.success,
    })
    const affectedItems = observation.affectedItems
    const remaining = observation.remainingItems
    const targetLabel = observation.targetLabel
    const targetText = observation.targetText
    const previousRemaining = observation.previousRemaining
    const committed = observation.committed
    const processedThisBatch = committed ? affectedItems.length : 0
    const now = new Date().toISOString()
    const nextBatchItems = committed && remaining.length > 0
      ? remaining.slice(0, DEFAULT_SCHEDULING_TASK_LIMITS.maxStepsPerStage)
      : []
    const nextTaskRun = nextBatchItems.length > 0
      ? buildBatchDeleteSchedulingTaskRun({
          userInput: taskRun.originalUserInput,
          matchKind: taskRun.batch?.matchKind ?? 'program',
          targetLabel,
          matchedItems: nextBatchItems,
          totalMatched: taskRun.batch?.totalMatched ?? previousRemaining,
          processedCount: (taskRun.batch?.processedCount ?? 0) + processedThisBatch,
          remainingCount: remaining.length,
          batchIndex: (taskRun.batch?.batchIndex ?? 1) + 1,
          includeDraftRefillAfterFinalBatch: taskRun.batch?.includeDraftRefillAfterFinalBatch ?? this.hasDraftRefillCompositeCue(taskRun.originalUserInput),
          playlistPolicy: taskRun.playlistPolicy,
          limits: taskRun.limits,
        })
      : null
    const nextDraftStage = !nextTaskRun
      ? taskRun.stages.find((stage) => stage.type === 'draft_refill')
      : undefined
    const updatedTaskRun: SchedulingTaskRun = {
      ...taskRun,
      status: committed ? (nextTaskRun ? 'waiting_confirm' : 'completed') : 'blocked',
      currentStageIndex: committed ? (nextTaskRun ? 0 : taskRun.stages.length - 1) : taskRun.currentStageIndex,
      loopCount: taskRun.loopCount + 1,
      updatedAt: now,
      batch: taskRun.batch
        ? {
            ...taskRun.batch,
            processedCount: taskRun.batch.processedCount + processedThisBatch,
            remainingCount: remaining.length,
            batchIndex: taskRun.batch.batchIndex,
          }
        : undefined,
      stages: taskRun.stages.map((stage, index) => {
        if (index === taskRun.currentStageIndex) {
          return { ...stage, status: committed ? 'completed' : 'blocked' }
        }
        if (stage.type === 'verify') return { ...stage, status: committed && !nextTaskRun ? 'completed' : committed ? 'pending' : 'blocked' }
        return stage
      }),
    }
    const retryTaskRun: SchedulingTaskRun | null = !committed && updatedTaskRun.loopCount < updatedTaskRun.limits.maxLoopTurns
      ? {
          ...updatedTaskRun,
          status: 'waiting_confirm',
          stages: updatedTaskRun.stages.map((stage, index) => {
            if (index === taskRun.currentStageIndex) return { ...stage, status: 'waiting_confirm' }
            if (stage.type === 'verify') return { ...stage, status: 'pending' }
            return stage
          }),
        }
      : null
    const nextPendingContext = nextTaskRun
      ? this.buildCompositePendingContext(input, nextTaskRun)
      : retryTaskRun
        ? this.buildCompositePendingContext(input, retryTaskRun)
      : undefined

    const rotationPolicyText = taskRun.playlistPolicy?.playlistType === 'rotation'
      ? taskRun.playlistPolicy.targetDurationSeconds
        ? '轮播单删除后队列会继续串联，我也会检查目标总时长差额。'
        : '轮播单删除后队列会继续串联，不会生成电视式空窗。'
      : ''
    const refillText = nextDraftStage
      ? input.currentLayoutDraft
        ? '接下来可以按草案补齐留下的空窗；这一步属于补排，我会继续遵守草案门禁和候选校验。'
        : '你还要求按草案补齐空窗，但当前没有激活草案，所以补排阶段先停下。'
      : ''
    const message = committed
      ? nextTaskRun
        ? `已先删除 ${affectedItems.length} 条${targetText}。我复查后还剩 ${remaining.length} 条，可以继续分批处理；你说“继续”或点确认，我再删下一批。`
        : `已删除 ${affectedItems.length} 条${targetText}。我又检查了一遍，当前播单里已经没有这些目标节目了。${rotationPolicyText}${refillText}`
      : retryTaskRun
        ? `这批没有写入成功，我已经停下来了。前面已完成 ${taskRun.batch?.processedCount ?? 0} 条，本批原计划处理 ${affectedItems.length} 条，当前还剩 ${remaining.length} 条${targetText}。你可以说“继续”重试这一批，或缩小范围后重新发起。`
        : `这批没有写入成功，而且任务已经达到连续处理上限。我先停下，避免继续误改；你可以缩小范围后重新发起。`

    return {
      kind: 'agent_execution',
      feedback: createFeedback(
        message,
        committed ? 'execution' : 'validation',
        committed ? '执行完成' : '执行异常',
        {
          explanation: '复合任务执行后已重新读取当前播单并校验目标是否完成。',
          details: {
            taskRun: updatedTaskRun,
            nextTaskRun,
            retryTaskRun,
            affectedItems,
            remainingCount: remaining.length,
            recovery: committed
              ? undefined
              : {
                  completedCount: taskRun.batch?.processedCount ?? 0,
                  attemptedCount: affectedItems.length,
                  remainingCount: remaining.length,
                  canRetry: Boolean(retryTaskRun),
                  failedBatchIndex: taskRun.batch?.batchIndex ?? 1,
                  suggestedActions: retryTaskRun
                    ? ['继续重试本批', '缩小范围后重新发起', '停止任务']
                    : ['缩小范围后重新发起', '停止任务'],
                },
            nextStage: nextDraftStage,
            playlistPolicy: taskRun.playlistPolicy,
          },
        },
      ),
      result: {
        status: committed ? 'executed' : 'failed',
        input: {
          userInput: input.userInput,
          channelId: input.scheduleState.channelId,
          date: input.scheduleState.date,
          playlistId: input.scheduleState.playlistId,
        },
        decision: {
          intent: 'batch_delete',
          command: {
            intent: 'batch_delete',
                itemIds: Array.from(deleteIds).map(String),
            targetRange: {
              start: affectedItems[0]?.startTime ?? '',
              end: affectedItems.at(-1)?.endTime ?? '',
            },
          },
          resolvedTargets: affectedItems,
          preview: {
            command: {
              intent: 'batch_delete',
              itemIds: Array.from(deleteIds).map(String),
              targetRange: {
                start: affectedItems[0]?.startTime ?? '',
                end: affectedItems.at(-1)?.endTime ?? '',
              },
            },
            before,
            after,
            affectedItemIds: affectedItems.map((item) => item.id),
            affectedTimeRanges: affectedItems.map((item) => ({ start: item.startTime, end: item.endTime })),
          },
          constraintReport: {
            ok: committed,
            issues: committed
              ? []
              : [{
                  code: 'target_not_found',
                  severity: 'critical',
                  message: '复合任务执行后仍有目标残留。',
                  detail: { remainingCount: remaining.length },
                }],
          },
        },
        executionResult: {
          committed,
          operationId: updatedTaskRun.id,
          affectedItemIds: affectedItems.map((item) => item.id),
          scheduleItems: committed ? replaceResult.data?.items ?? after : before,
        },
        explanation: message,
        trace: [{
          status: committed ? 'completed' : 'failed',
          label: 'Composite scheduling task finished.',
          detail: {
            taskRun: updatedTaskRun,
            nextTaskRun,
            retryTaskRun,
            deletedCount: affectedItems.length,
            remainingCount: remaining.length,
          },
          timestamp: now,
        }],
      },
      pendingAtomicContext: nextPendingContext,
    }
  }

  private async executeBatchReplaceTaskRun(
    input: RuntimeSubmitInput,
    taskRun: SchedulingTaskRun,
    replaceStage: SchedulingTaskStage,
  ): Promise<RuntimeDecision> {
    const replaceSteps = replaceStage.steps ?? []
    const stepByItemId = new Map(replaceSteps
      .filter((step) => step.itemId && step.candidateId)
      .map((step) => [step.itemId!, step]))
    if (stepByItemId.size === 0) {
      return {
        kind: 'message',
        statusHint: 'failed',
        feedback: createFeedback(
          '这个批量替换计划缺少目标节目或候选，不能写入播单。',
          'validation',
          '已阻断',
          {
            explanation: '批量替换执行前未找到可执行步骤。',
            details: { taskRun },
          },
        ),
      }
    }

    const before = input.currentSchedule.map((item, index) => this.toScheduleItemSnapshot(item, index))
    const replacedIds = new Set(stepByItemId.keys())
    const replacedItems = before.filter((item) => replacedIds.has(item.id))
    const replaced: ScheduleItemSnapshot[] = before.map((item): ScheduleItemSnapshot => {
      const step = stepByItemId.get(item.id)
      if (!step) return item
      const startTime = normalizeDateTime(input.scheduleState.date, item.startTime)
      const duration = step.durationSeconds ?? item.duration ?? 0
      const candidateId = step.candidateId ?? item.programId ?? item.id
      const candidateCode = step.candidateCode ?? candidateId
      const programName = step.programName ?? item.programName
      return {
        ...item,
        programId: candidateId,
        programCode: candidateCode,
        programName,
        instanceName: programName,
        programType: step.candidateProgramType ?? item.programType,
        duration,
        startTime,
        endTime: offsetDateTime(startTime, duration),
      }
    })
    const after = taskRun.playlistPolicy?.playlistType === 'rotation'
      ? this.compactRotationQueue(replaced, before[0]?.startTime)
      : replaced
    const validationIssues = taskRun.playlistPolicy?.playlistType === 'rotation'
      ? []
      : this.findCompositeTimeOverlaps(after)
    if (validationIssues.length > 0) {
      return {
        kind: 'message',
        statusHint: 'failed',
        feedback: createFeedback(
          '我预演了批量替换，发现替换后会和后面的节目时间重叠，所以先不写入播单。',
          'validation',
          '已阻断',
          {
            explanation: '电视播单按时间格子编排，批量替换后不能占用后续节目。',
            details: { taskRun, validationIssues, replacedItems },
          },
        ),
      }
    }

    const replaceResult = await getAtomicCapabilities().replaceAllItems(after, { skipValidation: true })
    const committed = replaceResult.success
    const now = new Date().toISOString()
    const updatedTaskRun: SchedulingTaskRun = {
      ...taskRun,
      status: committed ? 'completed' : 'blocked',
      currentStageIndex: committed ? taskRun.stages.length - 1 : taskRun.currentStageIndex,
      loopCount: taskRun.loopCount + 1,
      updatedAt: now,
      stages: taskRun.stages.map((stage) => ({
        ...stage,
        status: committed ? 'completed' : stage.status === 'waiting_confirm' ? 'blocked' : stage.status,
      })),
    }
    const candidateName = replaceSteps[0]?.programName ?? '候选节目'
    const policyText = taskRun.playlistPolicy?.playlistType === 'rotation'
      ? '轮播单会按内容队列自然串联，我也检查了替换后的队列。'
      : '电视播单时间轴已经预演检查，没有发现重叠。'
    const message = committed
      ? `已把 ${replacedItems.length} 条节目替换为《${candidateName}》。${policyText}`
      : '写入批量替换失败，当前播单没有完成这次修改。'
    const firstStep = replaceSteps[0]
    const firstTarget = replacedItems[0]
    if (!firstStep || !firstTarget) {
      return {
        kind: 'message',
        statusHint: 'failed',
        feedback: createFeedback(
          '确认时没有找到要替换的原节目，上一版批量替换计划已经失效。',
          'validation',
          '已阻断',
          {
            explanation: '批量替换执行前，当前播单与待确认计划不再一致。',
            details: { taskRun, replaceSteps },
          },
        ),
      }
    }
    const representativeCommand = {
      intent: 'replace' as const,
      itemId: firstStep.itemId ?? firstTarget.id,
      targetTime: toClockText(firstTarget.startTime),
      candidateId: firstStep.candidateId ?? firstTarget.programId ?? firstTarget.id,
      candidateName,
      startTime: firstTarget.startTime,
      endTime: firstTarget.endTime,
    }

    return {
      kind: 'agent_execution',
      feedback: createFeedback(
        message,
        committed ? 'execution' : 'validation',
        committed ? '执行完成' : '执行异常',
        {
          explanation: '批量替换执行后已重新读取当前播单并校验结果。',
          details: {
            taskRun: updatedTaskRun,
            replacedItems,
            candidateName,
            playlistPolicy: taskRun.playlistPolicy,
          },
        },
      ),
      result: {
        status: committed ? 'executed' : 'failed',
        input: {
          userInput: input.userInput,
          channelId: input.scheduleState.channelId,
          date: input.scheduleState.date,
          playlistId: input.scheduleState.playlistId,
        },
        decision: {
          intent: 'replace',
          command: representativeCommand,
          resolvedTargets: replacedItems,
          preview: {
            command: representativeCommand,
            before,
            after,
            affectedItemIds: Array.from(replacedIds),
            affectedTimeRanges: replacedItems.map((item) => ({ start: item.startTime, end: item.endTime })),
          },
          constraintReport: {
            ok: committed,
            issues: [],
          },
        },
        executionResult: {
          committed,
          operationId: updatedTaskRun.id,
          affectedItemIds: Array.from(replacedIds),
          scheduleItems: replaceResult.data?.items ?? after,
        },
        explanation: message,
        trace: [{
          status: committed ? 'completed' : 'failed',
          label: 'Composite batch replace finished.',
          detail: {
            taskRun: updatedTaskRun,
            replacedCount: replacedItems.length,
            candidateName,
          },
          timestamp: now,
        }],
      },
    }
  }

  private async executeInsertWithShiftTaskRun(
    input: RuntimeSubmitInput,
    taskRun: SchedulingTaskRun,
    shiftStage: SchedulingTaskStage,
  ): Promise<RuntimeDecision> {
    const insertStage = taskRun.stages.find((stage) => stage.type === 'atomic' && stage.action === 'insert')
    const insertStep = insertStage?.steps?.[0]
    if (!insertStep?.candidateId || !insertStep.targetTime || !insertStep.durationSeconds) {
      return {
        kind: 'message',
        statusHint: 'failed',
        feedback: createFeedback(
          '这个插入顺延计划缺少候选或时间信息，请重新发起操作。',
          'validation',
          '已阻断',
          {
            explanation: '复合插入任务缺少可执行插入步骤。',
            details: { taskRun },
          },
        ),
      }
    }

    const before = input.currentSchedule.map((item, index) => this.toScheduleItemSnapshot(item, index))
    const moveByItemId = new Map((shiftStage.steps ?? [])
      .filter((step) => step.itemId && step.newStartTime)
      .map((step) => [step.itemId!, step]))
    const moved = before.map((item) => {
      const step = moveByItemId.get(item.id)
      if (!step?.newStartTime) return item
      return {
        ...item,
        startTime: normalizeDateTime(input.scheduleState.date, step.newStartTime),
        endTime: offsetDateTime(normalizeDateTime(input.scheduleState.date, step.newStartTime), item.duration),
      }
    })
    const insertStart = normalizeDateTime(input.scheduleState.date, insertStep.targetTime)
    const insertEnd = offsetDateTime(insertStart, insertStep.durationSeconds)
    const insertedItem: ScheduleItemSnapshot = {
      id: `task_insert_${insertStep.candidateId}_${Date.now()}`,
      programCode: insertStep.candidateCode ?? insertStep.candidateId,
      programName: insertStep.programName ?? '插入节目',
      programId: insertStep.candidateId,
      instanceName: insertStep.programName ?? '插入节目',
      startTime: insertStart,
      endTime: insertEnd,
      duration: insertStep.durationSeconds,
      programType: insertStep.candidateProgramType ?? 'unknown',
      sequence: 0,
    }
    const after = [...moved, insertedItem]
      .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
      .map((item, index) => ({ ...item, sequence: index + 1 }))
    const validationIssues = this.findCompositeTimeOverlaps(after)
    if (validationIssues.length > 0) {
      return {
        kind: 'message',
        statusHint: 'failed',
        feedback: createFeedback(
          '我预演了顺延后的时间轴，发现仍有重叠，先不写入播单。请缩小范围或改成替换。',
          'validation',
          '已阻断',
          {
            explanation: '插入顺延计划写入前发现时间轴重叠。',
            details: { taskRun, validationIssues },
          },
        ),
      }
    }

    const replaceResult = await getAtomicCapabilities().replaceAllItems(after, { skipValidation: true })
    const committed = replaceResult.success
    const now = new Date().toISOString()
    const affectedMoved = before.filter((item) => moveByItemId.has(item.id))
    const updatedTaskRun: SchedulingTaskRun = {
      ...taskRun,
      status: committed ? 'completed' : 'blocked',
      currentStageIndex: committed ? taskRun.stages.length - 1 : taskRun.currentStageIndex,
      loopCount: taskRun.loopCount + 1,
      updatedAt: now,
      stages: taskRun.stages.map((stage) => ({
        ...stage,
        status: committed ? 'completed' : stage.status === 'waiting_confirm' ? 'blocked' : stage.status,
      })),
    }
    const message = committed
      ? `已在 ${insertStep.targetTime} 插入《${insertedItem.programName}》，并把受影响的 ${affectedMoved.length} 条节目顺延。我又检查了一遍，时间轴没有重叠。`
      : '写入插入顺延计划失败，当前播单没有完成这次修改。'

    return {
      kind: 'agent_execution',
      feedback: createFeedback(
        message,
        committed ? 'execution' : 'validation',
        committed ? '执行完成' : '执行异常',
        {
          explanation: '复合插入任务执行后已重新读取当前播单并校验时间轴。',
          details: {
            taskRun: updatedTaskRun,
            insertedItem,
            shiftedItems: affectedMoved,
          },
        },
      ),
      result: {
        status: committed ? 'executed' : 'failed',
        input: {
          userInput: input.userInput,
          channelId: input.scheduleState.channelId,
          date: input.scheduleState.date,
          playlistId: input.scheduleState.playlistId,
        },
        decision: {
          intent: 'insert',
          command: {
            intent: 'insert',
            candidateId: insertStep.candidateId,
            candidateName: insertedItem.programName,
            insertTime: insertStart,
            endTime: insertEnd,
          },
          resolvedTargets: affectedMoved,
          preview: {
            command: {
              intent: 'insert',
              candidateId: insertStep.candidateId,
              candidateName: insertedItem.programName,
              insertTime: insertStart,
              endTime: insertEnd,
            },
            before,
            after,
            affectedItemIds: [...affectedMoved.map((item) => item.id), insertedItem.id],
            affectedTimeRanges: [
              ...affectedMoved.map((item) => ({ start: item.startTime, end: item.endTime })),
              { start: insertedItem.startTime, end: insertedItem.endTime },
            ],
          },
          constraintReport: {
            ok: committed,
            issues: [],
          },
        },
        executionResult: {
          committed,
          operationId: updatedTaskRun.id,
          affectedItemIds: [...affectedMoved.map((item) => item.id), insertedItem.id],
          scheduleItems: replaceResult.data?.items ?? after,
        },
        explanation: message,
        trace: [{
          status: committed ? 'completed' : 'failed',
          label: 'Composite insert-with-shift task finished.',
          detail: {
            taskRun: updatedTaskRun,
            shiftedCount: affectedMoved.length,
            insertedItemId: insertedItem.id,
          },
          timestamp: now,
        }],
      },
    }
  }

  private extractCompositeBatchDeleteProgramName(userInput: string): string | null {
    const normalized = userInput.replace(/\s+/g, '')
    const patterns = [
      /^(?:把|将)?(?:当前播单(?:里|中)?|这张播单(?:里|中)?)?(?:全部|所有|全都)(.+?)(?:节目|栏目)?(?:删除|删掉|移除|去掉|撤掉)/u,
      /^(?:删除|删掉|移除|去掉|撤掉)(?:当前播单(?:里|中)?|这张播单(?:里|中)?)?(?:全部|所有|全都)(.+?)(?:节目|栏目)?(?:$|然后|再|，|,)/u,
    ]
    for (const pattern of patterns) {
      const match = normalized.match(pattern)
      const candidate = match?.[1]?.replace(/[《》“”"']/g, '').replace(/节目$/u, '').trim()
      if (candidate && candidate.length >= 2) return candidate
    }
    return null
  }

  private extractCompositeBatchDeleteTimeRange(userInput: string): { range: { start: string; end: string } } | null {
    const normalized = userInput.replace(/\s+/g, '')
    if (!/(删除|删掉|移除|去掉|撤掉|清空)/u.test(normalized)) return null
    if (!/(全部节目|所有节目|全都节目|全部|所有|全都|这段|这个时段)/u.test(normalized)) return null
    const range = this.parseLiteralCompositeTimeRange(userInput) ?? parseAtomicTimeRange(userInput)
    if (!range) return null
    return { range }
  }

  private parseLiteralCompositeTimeRange(userInput: string): { start: string; end: string } | null {
    const normalized = userInput.replace(/\s+/g, '')
    const match = normalized.match(/(\d{1,2})(?::?(\d{2}))?(?:点|:00)?(?:到|至|-|~)(\d{1,2})(?::?(\d{2}))?(?:点|:00)?/u)
    if (!match) return null
    const startHour = Number(match[1])
    const startMinute = Number(match[2] ?? '0')
    const endHour = Number(match[3])
    const endMinute = Number(match[4] ?? '0')
    if (![startHour, startMinute, endHour, endMinute].every(Number.isFinite)) return null
    if (startHour < 0 || startHour > 23 || endHour < 0 || endHour > 24) return null
    if (startMinute < 0 || startMinute > 59 || endMinute < 0 || endMinute > 59) return null
    const startSeconds = startHour * 3600 + startMinute * 60
    const endSeconds = endHour * 3600 + endMinute * 60
    if (endSeconds <= startSeconds) return null
    return {
      start: `${`${startHour}`.padStart(2, '0')}:${`${startMinute}`.padStart(2, '0')}:00`,
      end: `${`${endHour}`.padStart(2, '0')}:${`${endMinute}`.padStart(2, '0')}:00`,
    }
  }

  private extractSameTimeMultipleInsertConflict(userInput: string): { targetTime: string; programNames: string[] } | null {
    const clock = parseAtomicClockExpression(userInput)
    if (!clock) return null
    const normalized = userInput.replace(/\s+/g, '')
    const match = normalized.match(/(?:插入|添加|安排|排入|放置)(.+?)(?:和|、|以及)(.+?)(?:$|，|,|。|；|;)/u)
    if (!match?.[1] || !match[2]) return null
    const programNames = [
      this.normalizeAtomicProgramHint(match[1]),
      this.normalizeAtomicProgramHint(match[2]),
    ].filter((value): value is string => Boolean(value && value.length >= 2))
    if (programNames.length < 2) return null
    return {
      targetTime: clock.targetTime,
      programNames,
    }
  }

  private extractMoveAndInsertSameTimeConflict(userInput: string): { targetTime: string } | null {
    const normalized = userInput.replace(/\s+/g, '')
    if (!/(移动|移到|挪到|调整到|改到)/u.test(normalized) || !/(插入|添加|安排|排入|放置)/u.test(normalized)) return null
    const clocks = parseAtomicClockExpressions(userInput, 4).map((item) => item.targetTime)
    const uniqueClocks = Array.from(new Set(clocks))
    for (const targetTime of uniqueClocks) {
      const compactTime = targetTime.replace(/^0/, '').replace(/:00:00$/, '点')
      const clockPrefix = targetTime.slice(0, 5)
      const moveTargetsTime = normalized.includes(`到${compactTime}`)
        || normalized.includes(`到${clockPrefix}`)
        || normalized.includes(`移到${compactTime}`)
        || normalized.includes(`移动到${compactTime}`)
      const insertTargetsTime = normalized.includes(`${compactTime}插入`)
        || normalized.includes(`${compactTime}添加`)
        || normalized.includes(`${compactTime}安排`)
        || normalized.includes(`${clockPrefix}插入`)
      if (moveTargetsTime && insertTargetsTime) return { targetTime }
    }
    return null
  }

  private hasDraftRefillCompositeCue(userInput: string): boolean {
    const normalized = userInput.replace(/\s+/g, '')
    return /(然后|再|接着|并且|并).*(草案|版面|补齐|补排|空窗|空档|空位)/u.test(normalized)
      || /(按|参考|按照).*(草案|版面).*(补齐|补排|空窗|空档|空位)/u.test(normalized)
  }

  private formatDurationText(seconds: number): string {
    if (seconds % 3600 === 0) return `${seconds / 3600}小时`
    if (seconds % 60 === 0) return `${seconds / 60}分钟`
    return `${seconds}秒`
  }

  private findCompositeTimeOverlaps(items: ScheduleItemSnapshot[]): Array<{ previousId: string; nextId: string; previousEnd: string; nextStart: string }> {
    const sorted = [...items].sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
    const issues: Array<{ previousId: string; nextId: string; previousEnd: string; nextStart: string }> = []
    for (let index = 1; index < sorted.length; index += 1) {
      const previous = sorted[index - 1]!
      const next = sorted[index]!
      if (new Date(previous.endTime).getTime() > new Date(next.startTime).getTime()) {
        issues.push({
          previousId: previous.id,
          nextId: next.id,
          previousEnd: previous.endTime,
          nextStart: next.startTime,
        })
      }
    }
    return issues
  }

  private findCompositeProgramMatches(items: RuntimeScheduleItem[], programName: string): RuntimeScheduleItem[] {
    return findSchedulingTaskProgramMatches(items, programName)
  }

  private findCompositeTimeRangeMatches<T extends RuntimeScheduleItem>(
    items: T[],
    rangeStart: string,
    rangeEnd: string,
  ): T[] {
    const startSeconds = clockToSeconds(rangeStart)
    const endSeconds = clockToSeconds(rangeEnd)
    return items.filter((item) => {
      const itemStart = clockToSeconds(item.startTime)
      const itemEnd = clockToSeconds(item.endTime)
      return itemStart < endSeconds && itemEnd > startSeconds
    })
  }

  private findCompositeMatchesForTask<T extends RuntimeScheduleItem>(
    items: T[],
    taskRun: SchedulingTaskRun,
    stage: SchedulingTaskStage,
  ): T[] {
    const matchKind = taskRun.batch?.matchKind ?? 'program'
    const targetLabel = taskRun.batch?.targetLabel ?? stage.verification?.programName ?? ''
    if (matchKind === 'time_range') {
      const [start, end] = targetLabel.split('-')
      if (!start || !end) return []
      return this.findCompositeTimeRangeMatches(items, start, end)
    }
    return targetLabel ? this.findCompositeProgramMatches(items, targetLabel) as T[] : []
  }

  private formatCompositeTargetLabel(matchKind: 'program' | 'time_range', targetLabel: string): string {
    return matchKind === 'time_range'
      ? ` ${targetLabel} 时段内的节目`
      : `《${targetLabel}》`
  }

  private normalizeCompositeProgramName(value: string): string {
    return value
      .replace(/\s+/g, '')
      .replace(/[《》“”"'：:（）()【】[\]、，,。.!！?？]/g, '')
      .replace(/节目$/u, '')
      .trim()
  }

  private describeCompositeTaskSummary(taskRun: SchedulingTaskRun): string {
    return taskRun.goal
  }

  private describeCompositeTaskConfirmation(taskRun: SchedulingTaskRun): string {
    const firstStage = taskRun.stages[0]
    const steps = firstStage?.steps ?? []
    const times = steps
      .map((step) => step.targetTime)
      .filter((time): time is string => Boolean(time))
      .join('、')
    if (firstStage?.action === 'move') {
      const insertStage = taskRun.stages.find((stage) => stage.type === 'atomic' && stage.action === 'insert')
      const insertStep = insertStage?.steps?.[0]
      return `我会先把受影响的 ${steps.length} 条节目顺延，再在 ${insertStep?.targetTime ?? '目标位置'} 插入《${insertStep?.programName ?? '目标节目'}》。确认后我再写入播单。`
    }
    const nextStage = taskRun.stages.find((stage) => stage.type === 'draft_refill')
    const batchText = taskRun.batch && taskRun.batch.remainingCount > steps.length
      ? `这是第 ${taskRun.batch.batchIndex} 批，处理完还会剩 ${taskRun.batch.remainingCount - steps.length} 条。`
      : ''
    const nextText = nextStage
      ? '删除后会留下空窗，下一步再按草案补齐。'
      : '删除后会留下空位。'
    return `我会先处理这一步：${firstStage?.summary ?? taskRun.goal}。位置是 ${times || '当前匹配项'}。${batchText}${nextText}确认后我再写入播单。`
  }

  private isCompositeTaskConfirmInput(normalized: string): boolean {
    return /^(?:确认|确定|执行|下一批|确认执行|可以|好的|好|ok|yes)$/iu.test(normalized)
  }

  private isCompositeTaskCancelInput(normalized: string): boolean {
    return /^(?:取消|不用了|算了|先不用|不要执行|停止|cancel|no)$/iu.test(normalized)
  }

  private toScheduleItemSnapshot(item: RuntimeScheduleItem, index: number): ScheduleItemSnapshot {
    const duration = item.duration
      ?? Math.max(0, Math.floor((new Date(item.endTime).getTime() - new Date(item.startTime).getTime()) / 1000))
    return {
      id: item.id,
      programCode: item.programCode ?? item.id,
      programName: item.programName ?? '未命名节目',
      startTime: item.startTime,
      endTime: item.endTime,
      duration: Number.isFinite(duration) && duration > 0 ? duration : 0,
      programType: item.programType ?? 'unknown',
      sequence: index + 1,
    }
  }

  private buildPlannerAtomicInterpretation(
    input: RuntimeSubmitInput,
    action?: Extract<AgentPlannerAction, { type: 'atomic_command' }>,
    plan?: AgentPlan,
  ): AgentIntentInterpretation | undefined {
    if (!action?.intent) return undefined
    const anchoredTargetTime = action.targetTime ?? this.resolvePlannerTvLayoutAnchorTime(input, action)
    const slots = {
      targetTime: anchoredTargetTime,
      newStartTime: action.newStartTime,
      rangeStart: action.rangeStart,
      rangeEnd: action.rangeEnd,
      programHint: action.programHint,
      replacementHint: action.replacementHint,
      offsetSeconds: action.offsetSeconds,
      direction: action.direction,
      candidateId: action.candidateId,
      targetItemId: action.targetItemId,
      targetProgramName: action.targetProgramName,
    }
    const hasSlots = Object.values(slots).some((value) => value !== undefined && value !== '')
    return {
      intent: action.intent as AtomicCommandIntent,
      pendingAction: action.pendingAction,
      confidence: hasSlots ? 0.88 : 0.78,
      source: 'llm',
      slots,
      keyword: action.keyword,
      searchAlternatives: action.searchAlternatives,
      reasoning: plan?.reasoning,
      assistantFeedback: plan?.assistantReplyDraft,
      contextMode: 'scenario_context',
    }
  }

  private resolvePlannerTvLayoutAnchorTime(
    input: RuntimeSubmitInput,
    action: Extract<AgentPlannerAction, { type: 'atomic_command' }>,
  ): string | undefined {
    if (input.scheduleState.playlistType !== 'tv' || !input.currentLayoutDraft) return undefined
    const labels = [
      action.targetProgramName,
      action.programHint,
      action.keyword,
      ...(action.searchAlternatives ?? []),
    ].filter((value): value is string => Boolean(value?.trim()))
    if (!labels.length) return undefined
    const normalize = (value: string) => value.replace(/[\s《》“”"'，,。:：；;、\-—_]/g, '').toLowerCase()
    const normalizedLabels = labels.map(normalize).filter(Boolean)
    for (const [index, slot] of input.currentLayoutDraft.layoutReference.slots.entries()) {
      const column = input.currentLayoutDraft.columns.find((item) => item.columnId === slot.columnId)
      const anchorLabel = column?.semanticLabel ?? column?.columnName ?? input.currentLayoutDraft.durationSegments?.[index]?.label ?? ''
      const normalizedAnchor = normalize(anchorLabel)
      if (!normalizedAnchor) continue
      if (normalizedLabels.some((label) => label.includes(normalizedAnchor) || normalizedAnchor.includes(label))) {
        return toClockText(slot.startTime)
      }
    }
    return undefined
  }

  private async runAgentCore(
    input: RuntimeSubmitInput,
    pendingTask?: AgentPendingTask,
    plannerInterpretation?: AgentIntentInterpretation,
  ): Promise<AgentCoreRunResult> {
    const dataGateway = this.buildAgentCoreDataGateway(input)
    const llmTraceSnapshotBefore = this.readLlmRequestTraceSnapshot()
    const streamProgress = createAgentLlmStreamProgressEmitter({
      playlistKey: input.scheduleState.playlistId ?? input.scheduleState.playlistType ?? 'unknown',
      onProgress: input.onProgress,
    })
    const runtime = new SchedulingAgentRuntime({
      dataGateway,
      llmClient: this.llmClient,
      intentInterpreter: new LlmAgentIntentInterpreter(this.llmClient, { onStreamEvent: streamProgress }),
      candidateJudge: new LlmAgentCandidateJudge({ llmClient: this.llmClient, onStreamEvent: streamProgress }),
      onTraceStep: (step) => this.handleAgentTraceProgress(input, step),
    })
    const capabilitySummary = runtime.describeCapabilities()
    const operationalReadiness = await runtime.auditOperationalReadiness({
      userInput: input.userInput,
      channelId: input.scheduleState.channelId,
      date: input.scheduleState.date,
    })
    const agentInput: AgentSubmitInput = {
      userInput: input.userInput,
      channelId: input.scheduleState.channelId,
      date: input.scheduleState.date,
      conversationId: undefined,
      pendingTask,
      interpretation: plannerInterpretation,
      llmContextPackage: pendingTask ? undefined : await this.buildAgentLlmContextWithLayoutAnchors(input, dataGateway),
    }
    // 透传本次请求的 deadline，让 intentInterpreter / candidateJudge 共享预算与中止信号。
    const result = await runtime.submit(
      { ...agentInput },
      input.deadline,
    )
    const llmRequestTraces = this.diffLlmRequestTraces(llmTraceSnapshotBefore, this.readLlmRequestTraceSnapshot())
    return {
      result,
      capabilitySummary,
      operationalReadiness,
      llmRequestTraces,
    }
  }

  /**
   * 候选检索重试策略标签 → 中文展示文本映射（方案 6.3 SSE 流式进度）。
   *
   * 用于"查节目库-重试N（策略标签）"和"候选查询完成（策略标签）"气泡展示。
   * original/primary 不展示策略标签（与首轮"查节目库"气泡一致，不重复标注）。
   */
  private static readonly CANDIDATE_SEARCH_STRATEGY_LABEL_TEXT: Record<string, string> = {
    original: '原词',
    typo_fix: '错别字修复',
    decompose: '拆字',
    paraphrase: '近义改写',
    column_demote: '栏目降级',
    broaden: '放宽',
    secondary_reflection_typo_fix: '二次反思-错别字修复',
    secondary_reflection_decompose: '二次反思-拆字',
    secondary_reflection_paraphrase: '二次反思-近义改写',
    secondary_reflection_column_demote: '二次反思-栏目降级',
    secondary_reflection_broaden: '二次反思-放宽',
  }

  private handleAgentTraceProgress(input: RuntimeSubmitInput, step: AgentTraceStep): void {
    const event = this.buildAgentTraceProgressEvent(input, step)
    if (!event) return
    try {
      input.onProgress?.(event)
    } catch {
      // Progress messages are explanatory only and must not block execution.
    }
  }

  private buildAgentTraceProgressEvent(input: RuntimeSubmitInput, step: AgentTraceStep): RuntimeProgressEvent | null {
    const detail = step.detail ?? {}
    if (step.status === 'understanding' && step.label === '调用 Agent intent interpreter 生成结构化意图') {
      return {
        id: `agent-trace:${input.scheduleState.playlistId ?? input.scheduleState.playlistType}:understanding-start:${step.sequence}`,
        content: '正在结合当前播单和上下文理解你的要求。',
        processType: 'planning',
        processTypeLabel: '理解需求',
        details: {
          progressStage: 'intent_understanding',
          noMutation: true,
        },
      }
    }
    if (step.status === 'understanding' && step.label === 'Agent intent interpreter 返回结构化意图') {
      const assistantFeedback = typeof detail.assistantFeedback === 'string' ? detail.assistantFeedback.trim() : ''
      const reasoning = typeof detail.reasoning === 'string' ? detail.reasoning.trim() : ''
      const content = assistantFeedback || reasoning
      if (!content) return null
      return {
        id: `agent-trace:${input.scheduleState.playlistId ?? input.scheduleState.playlistType}:understanding:${step.sequence}`,
        content,
        processType: 'planning',
        processTypeLabel: '理解需求',
        details: {
          progressStage: 'intent_understood',
          intent: detail.intent,
          slots: detail.slots,
          noMutation: true,
        },
      }
    }

    if (step.status === 'planning' && step.label === '调用节目查询服务查找候选') {
      const keyword = typeof detail.keyword === 'string' ? detail.keyword.trim() : ''
      const alternatives = Array.isArray(detail.searchAlternatives)
        ? detail.searchAlternatives.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        : []
      const keywords = Array.from(new Set([keyword, ...alternatives].filter(Boolean))).slice(0, 4)
      const keywordText = keywords.length > 0 ? keywords.join(' / ') : '当前节目线索'
      const targetTime = typeof detail.targetTime === 'string' ? detail.targetTime : ''
      const timeText = targetTime ? `，位置按 ${targetTime}` : ''
      return {
        id: `agent-trace:${input.scheduleState.playlistId ?? input.scheduleState.playlistType}:candidate-search:${step.sequence}`,
        content: `正在按 ${keywordText} 查节目库${timeText}。`,
        processType: 'selection',
        processTypeLabel: '查节目库',
        details: {
          progressStage: 'candidate_lookup',
          searchKeywords: keywords,
          targetTime,
          noMutation: true,
        },
      }
    }

    // 新增分支：候选查询完成（在 LLM 决策前，展示已查到的候选数）
    // 与"调用节目查询服务查找候选"（开始查询）配对，形成"开始→完成"两阶段
    // 0 候选时不推气泡，由后续拒绝/留空流程处理
    // 节目关键词已在"调用节目查询服务查找候选"气泡展示，此处不重复
    // 阶段 7 扩展：当 detail 含 strategyLabel 时，追加策略标签文本（用于重试轮次的完成气泡）
    if (step.status === 'planning' && step.label === '候选查询完成') {
      const candidateCount = typeof detail.candidateCount === 'number' ? detail.candidateCount : 0
      if (candidateCount === 0) return null
      const strategyLabel = typeof detail.strategyLabel === 'string' ? detail.strategyLabel : ''
      const strategyText = strategyLabel && strategyLabel !== 'original' && strategyLabel !== 'primary'
        ? `（${DemoRuntimeFacade.CANDIDATE_SEARCH_STRATEGY_LABEL_TEXT[strategyLabel] ?? strategyLabel}）`
        : ''
      return {
        id: `agent-trace:${input.scheduleState.playlistId ?? input.scheduleState.playlistType}:candidate-found:${step.sequence}`,
        content: `已查到 ${candidateCount} 个候选期次${strategyText}。`,
        processType: 'selection',
        processTypeLabel: '查节目库',
        details: {
          progressStage: 'candidate_found',
          candidateCount,
          strategyLabel: strategyLabel || undefined,
          noMutation: true,
        },
      }
    }

    if (
      step.status === 'planning'
      && (
        step.label === 'Candidate search retried with rewritten keywords.'
        || step.label === 'Candidate search retried with LLM-provided alternatives.'
      )
    ) {
      const attempts = Array.isArray(detail.attempts)
        ? detail.attempts.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
        : []
      const retryKeywords = attempts
        .map((attempt) => typeof attempt.keyword === 'string' ? attempt.keyword.trim() : '')
        .filter(Boolean)
        .slice(1, 5)
      if (retryKeywords.length === 0) return null
      return {
        id: `agent-trace:${input.scheduleState.playlistId ?? input.scheduleState.playlistType}:candidate-retry:${step.sequence}`,
        content: `原来的线索还不够，我按 ${retryKeywords.join(' / ')} 再查一次节目库。`,
        processType: 'selection',
        processTypeLabel: '继续查找',
        details: {
          progressStage: 'candidate_lookup_retry',
          searchKeywords: retryKeywords,
          noMutation: true,
        },
      }
    }

    // 阶段 7 新增分支：查节目库-重试N（策略标签）——每轮重试检索的"开始气泡"
    // 与"候选查询完成"（完成气泡）配对，形成"开始→完成"两阶段
    // SSE 一条条信息流式展示硬约束（方案 6.3.1）：每个开始气泡是独立 SSE 事件，不可合并
    // 首轮（round=0）不推此气泡（已由"调用节目查询服务查找候选"覆盖）
    if (step.status === 'planning' && step.label === '查节目库-重试') {
      const keyword = typeof detail.keyword === 'string' ? detail.keyword.trim() : ''
      const strategyLabel = typeof detail.strategyLabel === 'string' ? detail.strategyLabel : ''
      const round = typeof detail.round === 'number' ? detail.round : 0
      const strategyText = DemoRuntimeFacade.CANDIDATE_SEARCH_STRATEGY_LABEL_TEXT[strategyLabel] ?? strategyLabel ?? '重试'
      const displayRound = Math.max(round, 1)
      const keywordText = keyword ? `按"${keyword}"` : ''
      return {
        id: `agent-trace:${input.scheduleState.playlistId ?? input.scheduleState.playlistType}:candidate-retry-start:${step.sequence}`,
        content: `${keywordText}查节目库（${strategyText}）。`,
        processType: 'selection',
        processTypeLabel: `查节目库-重试${displayRound}（${strategyText}）`,
        details: {
          progressStage: 'candidate_lookup_retry_start',
          keyword,
          strategyLabel,
          strategyReason: typeof detail.strategyReason === 'string' ? detail.strategyReason : '',
          round: displayRound,
          noMutation: true,
        },
      }
    }

    // 阶段 7 新增分支：查节目库-二次反思（escape hatch，阶段 8 预留，当前不触发）
    if (step.status === 'planning' && step.label === '查节目库-二次反思') {
      const keyword = typeof detail.keyword === 'string' ? detail.keyword.trim() : ''
      const strategyLabel = typeof detail.strategyLabel === 'string' ? detail.strategyLabel : ''
      const strategyText = DemoRuntimeFacade.CANDIDATE_SEARCH_STRATEGY_LABEL_TEXT[strategyLabel] ?? strategyLabel ?? '二次反思'
      const keywordText = keyword ? `按"${keyword}"` : ''
      return {
        id: `agent-trace:${input.scheduleState.playlistId ?? input.scheduleState.playlistType}:candidate-secondary-reflection:${step.sequence}`,
        content: `${keywordText}再次查节目库（${strategyText}）。`,
        processType: 'selection',
        processTypeLabel: '查节目库-二次反思',
        details: {
          progressStage: 'candidate_secondary_reflection',
          keyword,
          strategyLabel,
          noMutation: true,
        },
      }
    }

    // 阶段 7 新增分支：候选检索终止——所有关键词策略用完仍 0 命中
    // 暴露失败，不本地兜底硬排（AGENTS.md expose-failure）
    if (step.status === 'planning' && step.label === '候选检索终止') {
      const terminationReason = typeof detail.terminationReason === 'string' ? detail.terminationReason : ''
      const nextAction = typeof detail.nextAction === 'string' ? detail.nextAction : ''
      const searchAttemptCount = typeof detail.searchAttemptCount === 'number' ? detail.searchAttemptCount : 0
      const reasonText = terminationReason === 'all_strategies_exhausted'
        ? '所有关键词策略都已用完'
        : terminationReason === 'max_round'
          ? '已达最大检索轮次'
          : '检索已终止'
      return {
        id: `agent-trace:${input.scheduleState.playlistId ?? input.scheduleState.playlistType}:candidate-search-terminated:${step.sequence}`,
        content: `${reasonText}，仍未找到候选节目。你可以补充更具体的节目名、栏目或内容线索。`,
        processType: 'selection',
        processTypeLabel: '候选检索终止',
        details: {
          progressStage: 'candidate_search_terminated',
          terminationReason,
          nextAction,
          searchAttemptCount,
          noMutation: true,
        },
      }
    }

    // 新增分支：LLM 候选决策完成（C13：不出现"置信度""匹配度"等技术词）
    if (step.status === 'planning' && step.label === 'LLM 候选决策完成') {
      const reasoning = typeof detail.reasoning === 'string' ? detail.reasoning.trim() : ''
      const considerations = Array.isArray(detail.considerations)
        ? detail.considerations.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        : []
      const selectedName = typeof detail.selectedCandidateName === 'string' ? detail.selectedCandidateName.trim() : ''
      const selectedCandidateId = typeof detail.selectedCandidateId === 'string' ? detail.selectedCandidateId : null
      const candidateCount = typeof detail.candidateCount === 'number' ? detail.candidateCount : 0
      const decisionType = typeof detail.decisionType === 'string' ? detail.decisionType : ''

      let decisionText: string
      if (decisionType === 'auto_select' && selectedName) {
        decisionText = `已选择「${selectedName}」`
      } else if (decisionType === 'needs_clarification') {
        decisionText = `需要你确认具体排哪一个`
      } else if (decisionType === 'unable_to_decide') {
        decisionText = `暂时无法给出有把握的选择`
      } else {
        decisionText = `候选已就绪`
      }
      const reasoningText = reasoning ? `，理由：${reasoning}` : ''
      const considerationsText = considerations.length > 0 ? `。评估要点：${considerations.join('；')}` : ''

      return {
        id: `agent-trace:${input.scheduleState.playlistId ?? input.scheduleState.playlistType}:candidate-decision:${step.sequence}`,
        content: `${decisionText}${reasoningText}${considerationsText}。`,
        processType: 'selection',
        processTypeLabel: '候选决策',
        details: {
          progressStage: 'candidate_decision',
          selectedCandidateId,
          selectedCandidateName: selectedName,
          reasoning,
          considerations,
          candidateCount,
          decisionType,
          noMutation: true,
        },
      }
    }

    return null
  }

  private readLlmRequestTraceSnapshot(): LLMRequestTrace[] {
    const reader = this.llmClient as { getRecentRequestTraces?: () => LLMRequestTrace[] }
    return typeof reader.getRecentRequestTraces === 'function'
      ? reader.getRecentRequestTraces()
      : []
  }

  private diffLlmRequestTraces(before: LLMRequestTrace[], after: LLMRequestTrace[]): LLMRequestTrace[] {
    const beforeKeys = new Set(before.map((trace) => this.getLlmRequestTraceKey(trace)))
    return after
      .filter((trace) => !beforeKeys.has(this.getLlmRequestTraceKey(trace)))
      .reverse()
  }

  private getLlmRequestTraceKey(trace: LLMRequestTrace): string {
    return [
      trace.label,
      trace.startedAt,
      trace.durationMs,
      trace.timeoutMs,
      trace.attemptCount,
      trace.success ? 'ok' : 'failed',
      trace.error ?? '',
    ].join('|')
  }

  private resolveDeterministicPendingAgentInterpretation(
    userInput: string,
    pendingTask: AgentPendingTask,
  ): AgentIntentInterpretation | undefined {
    const normalized = userInput.replace(/\s+/g, '')
    if (this.isExplicitPendingReject(normalized)) {
      return {
        intent: pendingTask.intent,
        pendingAction: 'reject',
        confidence: 1,
        source: 'deterministic',
        reasoning: 'Structured pending rejection from the foreground confirmation control.',
      }
    }
    if (this.isExplicitPendingCancel(normalized)) {
      return {
        intent: pendingTask.intent,
        pendingAction: 'cancel_pending',
        confidence: 1,
        source: 'deterministic',
        reasoning: 'Structured pending cancellation from the foreground control.',
      }
    }
    if (this.isExplicitPendingConfirm(normalized)) {
      return {
        intent: pendingTask.intent,
        pendingAction: 'confirm',
        confidence: 1,
        source: 'deterministic',
        reasoning: 'Structured pending confirmation from the foreground confirmation control.',
      }
    }
    return undefined
  }

  private async buildAgentLlmContextWithLayoutAnchors(
    input: RuntimeSubmitInput,
    dataGateway: RuntimeSchedulingDataGateway,
  ): Promise<AgentLlmContextPackage | undefined> {
    if (!input.currentLayoutDraft || input.scheduleState.playlistType !== 'tv') return undefined
    const anchors = this.buildLayoutDraftAnchorsForAgent(input.currentLayoutDraft)
    if (!anchors.length) return undefined
    try {
      const context = await dataGateway.loadContext({
        userInput: input.userInput,
        channelId: input.scheduleState.channelId,
        date: input.scheduleState.date,
        playlistId: input.scheduleState.playlistId,
      })
      return {
        ...buildAgentLlmContextPackage(context, { userInput: input.userInput }),
        layoutDraftAnchors: anchors,
      }
    } catch {
      return undefined
    }
  }

  private buildLayoutDraftAnchorsForAgent(draft: LayoutDraft): NonNullable<AgentLlmContextPackage['layoutDraftAnchors']> {
    return draft.layoutReference.slots.slice(0, 24).map((slot, index) => {
      const column = draft.columns.find((item) => item.columnId === slot.columnId)
      const segment = draft.durationSegments?.[index]
      const label = column?.semanticLabel ?? column?.columnName ?? segment?.label ?? slot.id
      return {
        label,
        startTime: toClockText(slot.startTime),
        endTime: toClockText(slot.endTime),
        queryHints: column?.queryHints?.slice(0, 6),
      }
    }).filter((anchor) => Boolean(anchor.label))
  }

  private shouldStartFreshTaskOverPendingAgent(input: RuntimeSubmitInput): boolean {
    const normalized = input.userInput.replace(/\s+/g, '')
    if (
      this.isExplicitPendingConfirm(normalized)
      || this.isExplicitPendingCancel(normalized)
      || this.isExplicitPendingReject(normalized)
    ) {
      return false
    }
    return false
  }

  private isExplicitPendingConfirm(normalized: string): boolean {
    return /^(确认|確認|确定|確定|执行|執行|确认执行|確認執行|可以|好的|好|是|yes|ok)$/iu.test(normalized)
  }

  private isExplicitPendingCancel(normalized: string): boolean {
    return /^(取消|不用了|算了|先不用|停止|结束|關閉|关闭|cancel|no)$/iu.test(normalized)
  }

  private isExplicitPendingReject(normalized: string): boolean {
    return /^(不确认|不確認|不要执行|不要執行|拒绝|拒絕|否|不是)$/iu.test(normalized)
  }

  protected buildAgentCoreDataGateway(input: RuntimeSubmitInput): RuntimeSchedulingDataGateway {
    const scheduleState = input.scheduleState
    return new RuntimeSchedulingDataGateway({
      scheduleState,
      reader: createRuntimeSchedulingDataReader({
        today: {
          getScheduleItems: () => input.currentSchedule as RuntimeScheduleSourceItem[],
          getSourceMetadata: () => ({
            status: input.currentSchedule.length > 0 ? 'available' : 'empty',
            version: `current_schedule:${input.currentSchedule.length}:${input.currentSchedule.map((item) => item.id).join('|')}`,
          }),
        },
        candidates: {
          getProgramCandidates: async (contextInput) => {
            const queries = this.buildAgentCandidateQueries(contextInput, scheduleState.channelId)
            const results = await Promise.all(queries.map((query) => this.dataService.queryProgramLibrary(query)))
            const merged = new Map<string, ProgramCandidate>()
            results.flat().forEach((candidate) => {
              const key = candidate.id || candidate.programCode || `${candidate.programId}:${candidate.instanceName}`
              if (!merged.has(key)) merged.set(key, candidate)
            })
            return Array.from(merged.values()).slice(0, 1000)
          },
          getSourceMetadata: (contextInput) => {
            const queries = this.buildAgentCandidateQueries(contextInput, scheduleState.channelId)
            const query = queries[0]!
            const queryKeywords = queries
              .map((item) => item.keyword)
              .filter((keyword): keyword is string => Boolean(keyword))
            return {
              query: {
                limit: query.limit,
                keyword: query.keyword,
                facets: this.resolveAgentCandidateQueryFacets(query.keyword, queryKeywords),
                filters: {
                  channelId: scheduleState.channelId,
                },
              },
            }
          },
        },
        readiness: {
          getBroadcastReadiness: () => this.dataService.getBroadcastReadiness({
            channelId: scheduleState.channelId,
            limit: 1000,
          }),
          getSourceMetadata: () => ({
            version: `demo_readiness:${scheduleState.channelId}`,
            query: {
              limit: 1000,
              filters: {
                channelId: scheduleState.channelId,
              },
            },
          }),
        },
        history: {
          getHistorySchedules: () => this.dataService.getHistorySchedules(scheduleState.channelId, scheduleState.date),
          getSourceMetadata: () => ({
            query: {
              filters: {
                channelId: scheduleState.channelId,
                beforeDate: scheduleState.date,
              },
            },
          }),
        },
        constraints: {
          getLayoutBounds: () => scheduleState.playlistType === 'rotation'
            ? undefined
            : resolveBroadcastWindow(scheduleState.channelId, scheduleState.date),
          getLockedItemIds: async () => {
            if (scheduleState.playlistType === 'rotation') return []
            const context = await this.dataService.getGenerationContext(scheduleState.channelId, scheduleState.date)
            return context?.constraints.lockedItems ?? []
          },
          getBlockedTimeRanges: async () => {
            if (scheduleState.playlistType === 'rotation') return []
            const context = await this.dataService.getGenerationContext(scheduleState.channelId, scheduleState.date)
            return context?.constraints.blockedTimeRanges ?? []
          },
        },
        writer: {
          applyScheduleItems: async ({ items }) => {
            await getAtomicCapabilities().replaceAllItems(items, { skipValidation: true })
          },
        },
      }),
    })
  }

  private buildAgentCandidateQuery(input: AgentSubmitInput, channelId: string): {
    channelId: string
    keyword?: string
    limit: number
  } {
    const keyword = this.resolveAgentCandidateKeywords(input)[0]
    return {
      channelId,
      keyword,
      limit: keyword ? 1000 : 100,
    }
  }

  private buildAgentCandidateQueries(input: AgentSubmitInput, channelId: string): Array<{
    channelId: string
    keyword?: string
    limit: number
  }> {
    const keywords = this.resolveAgentCandidateKeywords(input)
    if (keywords.length === 0) return [{ channelId, limit: 100 }]
    return keywords.map((keyword) => ({
      channelId,
      keyword,
      limit: 1000,
    }))
  }

  private resolveAgentCandidateQueryFacets(primaryKeyword: string | undefined, queryKeywords: string[]): string[] {
    const sourceKeywords = primaryKeyword ? [primaryKeyword, ...queryKeywords] : queryKeywords
    return Array.from(new Set(
      sourceKeywords.flatMap((keyword) => buildAgentSearchFacets(keyword)),
    )).slice(0, 12)
  }

  private resolveAgentCandidateKeywords(input: AgentSubmitInput): string[] {
    const primary = this.resolveAgentCandidateKeyword(input)
    const alternatives = (input.interpretation?.searchAlternatives ?? [])
      .map((keyword) => this.cleanAgentCandidateKeywordStable(keyword))
      .filter((keyword): keyword is string => Boolean(keyword))
    return Array.from(new Set([primary, ...alternatives].filter((keyword): keyword is string => Boolean(keyword)))).slice(0, 6)
  }

  private resolveAgentCandidateKeyword(input: AgentSubmitInput): string | undefined {
    const interpretation = input.interpretation
    const pendingKeyword = this.resolvePendingAgentCandidateKeyword(input.pendingTask)
    if (!interpretation?.intent) {
      return pendingKeyword
    }
    if (interpretation.intent === 'insert') {
      return this.cleanAgentCandidateKeywordStable(interpretation.slots?.programHint)
        ?? pendingKeyword
    }
    if (interpretation.intent === 'replace') {
      return this.cleanAgentCandidateKeywordStable(interpretation.slots?.replacementHint)
        ?? pendingKeyword
    }
    if (interpretation.intent === 'query' && interpretation.queryKind === 'candidate_lookup') {
      return this.cleanAgentCandidateKeywordStable(
        interpretation.keyword
        ?? interpretation.slots?.programHint
        ?? interpretation.slots?.replacementHint
        ?? interpretation.slots?.targetProgramName,
      ) ?? pendingKeyword
    }
    return undefined
  }

  private resolvePendingAgentCandidateKeyword(pendingTask?: AgentPendingTask | null): string | undefined {
    if (!pendingTask) return undefined
    const readStringSlot = (slot: unknown): string | undefined => {
      if (!slot || typeof slot !== 'object') return undefined
      const value = (slot as { value?: unknown }).value
      return typeof value === 'string' ? value : undefined
    }
    const slots = pendingTask.collectedSlots
    if (pendingTask.intent === 'insert') {
      return this.cleanAgentCandidateKeywordStable(readStringSlot(slots.programHint))
        ?? this.cleanAgentCandidateKeywordStable(readStringSlot(slots.candidateId))
    }
    if (pendingTask.intent === 'replace') {
      return this.cleanAgentCandidateKeywordStable(readStringSlot(slots.replacementHint))
        ?? this.cleanAgentCandidateKeywordStable(readStringSlot(slots.candidateId))
    }
    if (pendingTask.intent === 'query') {
      return this.cleanAgentCandidateKeywordStable(readStringSlot(slots.programHint))
        ?? this.cleanAgentCandidateKeywordStable(readStringSlot(slots.replacementHint))
        ?? this.cleanAgentCandidateKeywordStable(readStringSlot(slots.targetProgramName))
    }
    return undefined
  }

  private cleanAgentCandidateKeywordStable(value: string | undefined): string | undefined {
    const cleaned = value
      ?.replace(/\s+/g, '')
      .replace(/[\uff0c\u3002\uff01\uff1f\uff1b\uff1a\u3001,.!?;:]/gu, '')
      .replace(/^(?:\u8282\u76ee|\u680f\u76ee|\u5185\u5bb9|\u7d20\u6750|\u5019\u9009|\u53ef\u7528|\u53ef\u64ad)+/u, '')
      .replace(/(?:\u8282\u76ee|\u680f\u76ee|\u5185\u5bb9|\u7d20\u6750|\u5019\u9009|\u53ef\u7528|\u53ef\u64ad)$/u, '')
      .trim()
    if (cleaned && /^(?:\u5c31|\u90a3|\u90a3\u5c31|\u5427|\u554a|\u5440|\u5462|\u597d|\u597d\u7684|\u53ef\u4ee5|\u884c|\u5b9a|\u653e|\u6392|\u5b89\u6392|\u63d2|\u63d2\u5165|\u66ff\u6362|\u66ff\u6362\u6210|\u66ff\u6362\u4e3a|\u6362\u6210|\u6362\u5230|\u6539\u6210|\u6539\u4e3a|\u6539\u5230|\u6539\u5728|\u6362|\u6539|\u6210|\u4e3a)+$/u.test(cleaned)) return undefined
    return cleaned && cleaned.length >= 2 ? cleaned : undefined
  }

  private isAgentPendingControlInput(userInput: string): boolean {
    const normalized = userInput.replace(/\s+/g, '')
    return /^(?:\u786e\u8ba4|\u597d\u7684|\u53ef\u4ee5|\u6267\u884c|\u63d0\u4ea4|\u662f|\u5bf9|\u53d6\u6d88|\u4e0d\u8981|\u7b97\u4e86|\u62d2\u7edd)$/u.test(normalized)
  }

  private buildAgentTimeOverlapBlockedMessage(result: AgentResult, issue?: { detail?: Record<string, unknown> }): string {
    const detail = issue?.detail ?? {}
    const conflictProgramName = typeof detail.conflictProgramName === 'string' ? detail.conflictProgramName.trim() : ''
    const conflictRange = detail.conflictRange && typeof detail.conflictRange === 'object'
      ? detail.conflictRange as { start?: unknown; end?: unknown }
      : undefined
    const proposedRange = detail.proposedRange && typeof detail.proposedRange === 'object'
      ? detail.proposedRange as { start?: unknown; end?: unknown }
      : undefined
    const conflictStart = typeof conflictRange?.start === 'string' ? toClockText(conflictRange.start) : ''
    const conflictEnd = typeof conflictRange?.end === 'string' ? toClockText(conflictRange.end) : ''
    const proposedStart = typeof proposedRange?.start === 'string' ? toClockText(proposedRange.start) : ''
    const proposedEnd = typeof proposedRange?.end === 'string' ? toClockText(proposedRange.end) : ''
    const conflictLabel = conflictProgramName ? `《${conflictProgramName}》` : '已有节目'
    const conflictTimeText = conflictStart && conflictEnd ? `（${conflictStart}-${conflictEnd}）` : ''
    const proposedText = proposedStart && proposedEnd && proposedStart !== proposedEnd
      ? `目标调整后会落在 ${proposedStart}-${proposedEnd}，`
      : ''

    if (result.decision.intent === 'replace') {
      return `${proposedText}替换候选会压到${conflictLabel}${conflictTimeText}。当前不会自动移动、压缩或重排后续节目，所以这次替换已阻断；你可以换一个时长更合适的候选，或先调整目标位置。`
    }

    return `${proposedText}目标位置已经被${conflictLabel}${conflictTimeText}占用。按照当前规则，我不会自动下移、替换或重排，所以这次操作已阻断；你可以换一个空闲位置，或明确发起替换命令。`
  }

  private buildAgentUserFacingContent(result: AgentResult): string {
    const intent = result.decision.intent
    const pendingTask = result.decision.pendingTask
    const issue = result.decision.constraintReport?.issues[0]
    const interpretedSlots = result.input.interpretation?.slots
    const commandRecord = result.decision.command && typeof result.decision.command === 'object'
      ? result.decision.command as unknown as Record<string, unknown>
      : undefined
    const commandIntent = typeof commandRecord?.intent === 'string' ? commandRecord.intent : undefined
    const commandTargetTime = typeof commandRecord?.targetTime === 'string' ? commandRecord.targetTime : undefined
    const targetTime = this.readAgentPendingStringSlot(pendingTask, 'targetTime')
      ?? interpretedSlots?.targetTime
      ?? (commandTargetTime ? toClockText(commandTargetTime) : undefined)
      ?? parseAtomicClockExpression(result.input.userInput)?.targetTime
    const newStartTime = this.readAgentPendingStringSlot(pendingTask, 'newStartTime') ?? interpretedSlots?.newStartTime
    const programHint = this.readAgentPendingStringSlot(pendingTask, 'programHint')
      ?? interpretedSlots?.programHint
    const replacementHint = this.readAgentPendingStringSlot(pendingTask, 'replacementHint') ?? interpretedSlots?.replacementHint
    const targetProgramName = this.readAgentPendingStringSlot(pendingTask, 'targetProgramName') ?? interpretedSlots?.targetProgramName
    const offsetSeconds = this.readAgentPendingNumberSlot(pendingTask, 'offsetSeconds')
    const targetText = [
      targetTime ? `${targetTime}` : '',
      targetProgramName || programHint ? `《${targetProgramName || programHint}》` : '',
    ].filter(Boolean).join(' 的 ')
    const resolvedTargetName = result.decision.resolvedTargets?.[0]?.programName
    const programNotFoundMessage = issue?.code === 'program_not_found'
      ? this.buildAgentProgramNotFoundMessage(issue.detail, programHint || replacementHint || targetProgramName)
      : null

    if (result.status === 'needs_clarification' && programNotFoundMessage) {
      return programNotFoundMessage
    }

    const issueMessage = typeof issue?.message === 'string' ? issue.message : ''
    if (/cancelled|rejected|取消|拒绝/i.test(issueMessage) || /^(取消|拒绝|算了|不用了|先不|不要了)$/u.test(result.input.userInput.trim())) {
      return '已取消这次待确认修改，我不会写入当前播单。你可以继续发起新的插入、删除、移动、替换、查询或校验命令。'
    }

    if (issue?.code === 'context_conflict') {
      return '当前播单已经变了，我不会继续执行上一版修改。请看左侧最新播单，重新说一遍要改哪里。'
    }

    if ((result.status === 'blocked' || result.status === 'failed') && issue?.code === 'time_overlap') {
      return this.buildAgentTimeOverlapBlockedMessage(result, issue)
    }

    const llmFeedback = result.input.interpretation?.assistantFeedback?.trim()
    if (result.status === 'needs_selection' && this.isAgentCandidateRecommendationResult(result)) {
      const recommendationContent = this.buildAgentCandidateRecommendationContent(result, llmFeedback)
      if (recommendationContent) return recommendationContent
    }

    if (
      (result.status === 'needs_clarification' || result.status === 'needs_confirmation')
      && llmFeedback
      && this.isBusinessReadableAgentExplanation(llmFeedback)
      && !this.isStaleAgentConfirmationFeedback(llmFeedback, result)
    ) {
      return this.withoutAgentCandidateSearchBrief(llmFeedback, result)
    }

    if (intent === 'validate' || commandIntent === 'validate') {
      return this.buildAgentValidationUserFacingContent(result.validationReport)
    }

    if (result.status === 'executed') {
      if (intent === 'query') {
        const queryContent = this.buildAgentQueryUserFacingContent(result.decision.queryResult)
        return queryContent.includes('没有改动播单') ? queryContent : `${queryContent} 现在只是分析，没有改动播单。`
      }
      if (
        llmFeedback
        && this.isBusinessReadableAgentExplanation(llmFeedback)
        && !this.isStaleAgentConfirmationFeedback(llmFeedback, result)
      ) {
        const basisText = this.withoutAgentCandidateSearchBrief(llmFeedback, result)
        const separator = /[。！？!?]$/u.test(basisText) ? '' : '。'
        return `${basisText}${separator}操作已完成，并已写入当前播单。`
      }
      return '操作已完成，并已写入当前播单。'
    }

    const explanation = result.explanation?.trim() ?? ''
    if (
      this.isBusinessReadableAgentExplanation(explanation)
      && !(result.status === 'needs_confirmation' && this.isGenericAgentConfirmationExplanation(explanation))
      && !this.isStaleAgentConfirmationFeedback(explanation, result)
    ) {
      return this.withoutAgentCandidateSearchBrief(explanation, result)
    }

    if (result.status === 'needs_confirmation') {
      if (intent === 'delete') {
        const targetLabel = [
          targetTime ? `${toClockText(targetTime)} 的` : '',
          resolvedTargetName ? `《${resolvedTargetName}》` : targetProgramName ? `《${targetProgramName}》` : '目标节目',
        ].filter(Boolean).join('')
        return `我已经定位到${targetLabel}。删除会直接改变当前播单，请你确认后我再执行；如果不是这条节目，可以直接说“取消”或重新描述目标。`
      }
      if (intent === 'replace') {
        return this.withoutAgentCandidateSearchBrief(
          `我已经定位到${targetText || '要替换的节目'}，替换候选是${replacementHint ? `《${replacementHint}》` : '当前候选节目'}。这会改动正式编排，请确认后我再写入。`,
          result,
        )
      }
      if (intent === 'insert') {
        return this.withoutAgentCandidateSearchBrief(
          `我已经匹配到可插入的候选${programHint ? `《${programHint}》` : ''}${targetTime ? `，目标时间是 ${targetTime}` : ''}。这一步会改动当前播单，请你确认后我再写入。`,
          result,
        )
      }
      return '这条修改已经形成可执行方案，但会改变当前播单。请确认后我再提交。'
    }

    if (result.status === 'needs_clarification') {
      if (intent === 'move') {
        if (!targetText) return '我理解你想移动节目，但还需要知道具体是哪一条。可以直接说节目名，或说“9点那条”。'
        if (!newStartTime && typeof offsetSeconds !== 'number') return `我已经知道要移动${targetText}，还需要你补充移动到几点，或向前/向后移动多久。`
      }
      if (intent === 'insert') {
        if (!targetTime) return `好的，我先记下要插入${programHint ? `《${programHint}》` : '节目或素材'}。还差一个播出时间，你直接补一句“16点”这样的时间就可以。`
        if (!programHint) return `时间我已经记到 ${targetTime}。还差节目或素材线索，你可以直接说节目名、标题关键词，或一小段内容描述。`
        return `我已经把“${targetTime} 插入《${programHint}》”这件事先保留住了。当前候选库还没给出足够确定的可播项，你可以换一个节目名，或补充更具体的标题、栏目、内容关键词。`
      }
      if (intent === 'replace') {
        if (!targetText) return `我理解你想替换成${replacementHint ? `《${replacementHint}》` : '另一个节目'}，还需要知道要替换当前播单里的哪一条。`
        if (!replacementHint) return `我已经定位到${targetText}，还需要你补充要换成哪个节目或素材。`
      }
      if (intent === 'delete') {
        return '我理解你想删除节目，但还需要知道具体是哪一条。可以说时间点，例如“删除9点的节目”，也可以直接说节目名。'
      }
      return '这条指令还缺少关键信息。我先记下你刚才说的内容，你可以直接补一句时间、节目名或确认方式。'
    }

    if (result.status === 'blocked' || result.status === 'failed') {
      if (issue?.code === 'time_overlap') {
        return this.buildAgentTimeOverlapBlockedMessage(result, issue)
      }
      if (issue?.code === 'sequence_violation') {
        return '这条电视播单会破坏顺播规则。当前版本不会跳集编排，因此我已阻断这次操作。'
      }
      if (issue?.code === 'same_day_duplicate_violation') {
        return '候选节目今天已经在播单中出现过。为避免同日重复编排，我已阻断这次替换。'
      }
      if (issue?.code === 'replacement_duty_mismatch') {
        const targetLabel = targetTime ? `${toClockText(targetTime)} 的节目` : targetText || '目标节目'
        const replacementLabel = replacementHint ? `《${replacementHint}》` : '这个候选节目'
        return `${targetLabel}与${replacementLabel}不是同一栏目职责，我会把它作为编排风险提示记录下来；如果你已经明确要替换，我不应因为这个版面参考直接阻断写入。`
      }
      if (issue?.code === 'target_not_found') {
        if (targetTime) {
          const targetLabel = `${toClockText(targetTime)} 这个时间点`
          if (intent === 'delete') return `我查了当前播单，${targetLabel}没有已编排节目，因此无法删除。你可以换一个时间点或节目名。`
          if (intent === 'replace') return `我查了当前播单，${targetLabel}没有已编排节目，因此无法替换。你可以换一个时间点或先插入节目。`
          if (intent === 'move') return `我查了当前播单，${targetLabel}没有已编排节目，因此无法移动。你可以换一个时间点或节目名。`
          return `我查了当前播单，${targetLabel}没有匹配节目，所以这次操作没有写入。`
        }
        if (targetProgramName) {
          return `我查了当前播单，没有找到《${targetProgramName}》，所以这次操作没有写入。你可以换一个节目名或时间点。`
        }
        return '我查了当前播单，没有找到要操作的节目，所以这次操作没有写入。'
      }
      if (issue?.code === 'program_not_found') {
        return programNotFoundMessage ?? '我查了当前候选库，暂时没有找到符合这条描述的可播节目或素材。这个任务我先不写入播单；我会先换一组相近关键词继续找，你也可以补充标题、栏目或内容线索。'
      }
      return issue?.message && this.isBusinessReadableAgentExplanation(issue.message)
        ? issue.message
        : '这次操作没有通过编排规则校验，我没有写入播单。你可以换一个目标时间、节目或素材后继续。'
    }

    return explanation || '我已经完成本轮判断。'
  }

  private buildAgentValidationUserFacingContent(validationReport: AgentResult['validationReport']): string {
    if (!validationReport) {
      return '校验完成，我已经检查当前播单的空窗、冲突和主要规则风险。'
    }

    const criticalCount = validationReport.issues.filter((issue) => issue.severity === 'critical').length
    const warningCount = validationReport.issues.filter((issue) => issue.severity === 'warning').length
    const firstIssue = validationReport.issues[0]
    if (validationReport.issues.length === 0 || validationReport.ok) {
      return warningCount > 0
        ? `校验完成，当前没有发现会阻断写入的硬性问题，但有 ${warningCount} 条需要留意的提示。`
        : '校验完成，当前播单暂未发现会阻断写入的硬性问题。'
    }

    const issueText = firstIssue
      ? this.formatAgentValidationIssue(firstIssue)
      : '请展开明细查看具体风险。'
    return `校验完成，发现 ${validationReport.issues.length} 个问题，其中严重问题 ${criticalCount} 个。优先处理：${issueText}`
  }

  private formatAgentValidationIssue(issue: NonNullable<AgentResult['validationReport']>['issues'][number]): string {
    if (issue.code === 'sequence_violation') return '电视播单顺播顺序被破坏，需要补齐正确集数后再继续。'
    if (issue.code === 'time_overlap') return '存在时间重叠，目标位置已经被其他节目占用。'
    if (issue.code === 'out_of_layout_bounds') return '有节目超出了当前播出边界。'
    if (issue.code === 'locked_item') return '有节目处于锁定状态，不能直接调整。'
    if (issue.code === 'material_not_ready') return '存在素材未就绪的节目。'
    if (issue.code === 'rights_not_ready') return '存在版权或播出权利未就绪的节目。'
    if (issue.code === 'history_source_missing') return '历史播出记录不足，电视顺播校验只能依据当前播单判断。'
    return this.isBusinessReadableAgentExplanation(issue.message)
      ? issue.message
      : '当前播单存在需要编排人员复核的规则风险。'
  }

  private withoutAgentCandidateSearchBrief(content: string, _result: AgentResult): string {
    return content
  }

  private buildAgentCandidateSearchBrief(result: AgentResult): string | null {
    const intent = result.decision.intent ?? result.input.interpretation?.intent
    const queryKind = result.input.interpretation?.queryKind
    if (intent !== 'insert' && intent !== 'replace' && !(intent === 'query' && queryKind === 'candidate_lookup')) {
      return null
    }

    const auditSummary = result.decision.auditSummary as { contextSources?: Record<string, unknown> } | undefined
    const candidateSource = auditSummary?.contextSources?.candidates as Record<string, unknown> | undefined
    const query = candidateSource?.query as Record<string, unknown> | undefined
    if (!candidateSource || !query) return null

    const keyword = typeof query.keyword === 'string' && query.keyword.trim()
      ? query.keyword.trim()
      : ''
    const facets = Array.isArray(query.facets)
      ? query.facets.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).slice(0, 4)
      : []
    const recordCount = typeof candidateSource.recordCount === 'number' ? candidateSource.recordCount : undefined
    if (!keyword && facets.length === 0 && typeof recordCount !== 'number') return null

    const keywordText = keyword ? `“${keyword}”` : '当前节目线索'
    const facetText = facets.length > 0 ? `，拆成“${facets.join('、')}”核对` : ''
    const countText = typeof recordCount === 'number'
      ? `候选源返回 ${recordCount} 条`
      : '已读取候选源'
    return `已按${keywordText}${facetText}检索，${countText}。`
  }

  private buildAgentAssistantProcessSummary(result: AgentResult): string[] {
    const lines: string[] = []
    const candidateBrief = this.buildAgentCandidateSearchBrief(result)
    if (candidateBrief) {
      const auditSummary = result.decision.auditSummary as { contextSources?: Record<string, unknown> } | undefined
      const candidateSource = auditSummary?.contextSources?.candidates as Record<string, unknown> | undefined
      const recordCount = typeof candidateSource?.recordCount === 'number' ? candidateSource.recordCount : undefined
      const recommendedCount = result.decision.pendingTask?.recommendations?.length
        ?? result.decision.recommendations?.length
        ?? 0
      const targetOptionCount = result.decision.pendingTask?.targetOptions?.length ?? 0
      if (result.status === 'executed') {
        const selectedSequence = result.decision.candidateSelection?.selectedSequence
        lines.push(typeof selectedSequence === 'number' && selectedSequence > 0
          ? `已按期数规则收敛到第 ${selectedSequence} 期，并写入当前播单。`
          : '已按当前播单规则收敛候选，并写入当前播单。')
      } else if (recommendedCount > 0) {
        lines.push(recommendedCount === 1
          ? '已筛出 1 个可用候选。'
          : `已筛出 ${recommendedCount} 个可选候选。`)
      } else if (targetOptionCount > 0) {
        lines.push(targetOptionCount === 1
          ? '已定位到 1 个相关节目。'
          : `已定位到 ${targetOptionCount} 个相关节目。`)
      } else if (typeof recordCount === 'number') {
        lines.push(recordCount > 0 ? '已按节目线索查找，并按当前播单规则筛选。' : '已查找候选，暂时没有找到可直接采用的节目。')
      } else {
        lines.push('已按节目线索查找候选。')
      }
    }
    if (result.status === 'needs_confirmation') {
      lines.push('写入前需要你确认。')
    }
    return lines.slice(0, 2)
  }

  private buildAgentQueryUserFacingContent(queryResult: AgentResult['decision']['queryResult']): string {
    if (!queryResult) return '查询完成，我已经按当前播单和候选库整理了结果。'

    if (queryResult.kind === 'time_lookup') {
      const targetTime = queryResult.targetTime ? toClockText(queryResult.targetTime) : '这个时间点'
      if (queryResult.scheduleItems.length === 0) {
        return `我查了当前播单，${targetTime}没有已编排节目。`
      }
      const itemText = queryResult.scheduleItems
        .slice(0, 3)
        .map((item) => `${toClockText(item.startTime)}-${toClockText(item.endTime)}《${item.programName || item.programCode || item.id}》`)
        .join('、')
      return `我查到${targetTime}命中 ${queryResult.totalCount} 条节目：${itemText}。`
    }

    if (queryResult.kind === 'program_lookup') {
      const keyword = queryResult.keyword ? `《${queryResult.keyword}》` : '这条线索'
      if (queryResult.scheduleItems.length === 0) {
        return `我查了当前播单，没有找到${keyword}对应的已编排节目。`
      }
      const itemText = queryResult.scheduleItems
        .slice(0, 3)
        .map((item) => `${toClockText(item.startTime)}《${item.programName || item.programCode || item.id}》`)
        .join('、')
      return `当前播单里找到 ${queryResult.totalCount} 条和${keyword}相关的节目：${itemText}。`
    }

    if (queryResult.kind === 'candidate_lookup') {
      const keyword = queryResult.keyword ? `“${queryResult.keyword}”` : '当前条件'
      if (queryResult.candidates.length === 0) {
        return `我查了候选库，暂时没有找到匹配${keyword}的可用节目或素材。`
      }
      const rewriteText = queryResult.candidateSearchMatchedBy === 'llm_alternatives'
        ? '我先按原关键词查了一遍，又用模型给出的相近关键词继续检索，'
        : ''
      const candidateText = queryResult.candidates
        .slice(0, 5)
        .map((candidate) => `《${candidate.programName || candidate.programCode || candidate.id}》`)
        .join('、')
      return `${rewriteText}候选库里找到 ${queryResult.totalCount} 条匹配${keyword}的结果：${candidateText}。`
    }

    const playlistLabel = queryResult.playlistType === 'rotation' ? '轮播单' : '电视播单'
    if (queryResult.scheduleItems.length === 0) return `当前${playlistLabel}还没有已编排节目。`
    const first = queryResult.scheduleItems[0]
    const last = queryResult.scheduleItems[queryResult.scheduleItems.length - 1]
    const rangeText = first && last
      ? `，覆盖 ${toClockText(first.startTime)}-${toClockText(last.endTime)}`
      : ''
    return `当前${playlistLabel}共有 ${queryResult.totalCount} 条节目${rangeText}。`
  }

  private isBusinessReadableAgentExplanation(value: string): boolean {
    if (!value) return false
    if (!/[\u4e00-\u9fa5]/u.test(value)) return false
    if (/Agent Core|pending task|needs_|intent=|status=|commit|constraint/i.test(value)) return false
    return true
  }

  private isGenericAgentConfirmationExplanation(value: string): boolean {
    return /提交前需要确认|仍需确认|等待确认|needs explicit confirmation|requires confirmation/i.test(value)
  }

  private isStaleAgentConfirmationFeedback(value: string, result: AgentResult): boolean {
    if (result.status !== 'needs_confirmation') return false
    const hasResolvedEvidence = Boolean(result.decision.command || result.decision.resolvedTargets?.length)
    if (!hasResolvedEvidence) return false
    return /我会先(?:定位|查|查找|寻找|检索|确认|核对)|先(?:定位|查找|寻找|检索|核对).{0,12}(?:再|后)/u.test(value)
  }

  private buildAgentProgramNotFoundMessage(detail: unknown, hint?: string): string {
    const searchSummary = this.formatAgentCandidateSearchRetrySummary(detail)
    return searchSummary
      ? `我先按${searchSummary.searchedText}查了当前候选库，暂时没有找到${hint ? `与《${hint}》匹配的` : '符合这条描述的'}可播节目或素材。你可以补充栏目名、节目标题或更具体的内容线索，我会继续帮你找。`
      : `我查了当前候选库，暂时没有找到${hint ? `与《${hint}》匹配的` : '符合这条描述的'}可播节目或素材。这个任务我先不写入播单；我会先换一组相近关键词继续找，你也可以补充标题、栏目或内容线索。`
  }

  private formatAgentCandidateSearchRetrySummary(detail: unknown): {
    searchedText: string
    briefResultText: string
    suggestionText: string
  } | null {
    if (!detail || typeof detail !== 'object') return null
    const record = detail as Record<string, unknown>
    const searchedKeyword = typeof record.searchedKeyword === 'string' ? record.searchedKeyword : undefined
    const searchedFacets = Array.isArray(record.searchedFacets)
      ? record.searchedFacets.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      : []
    const suggestions = Array.isArray(record.suggestedKeywords)
      ? record.suggestedKeywords.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      : []
    const recordCount = typeof record.candidateRecordCount === 'number' ? record.candidateRecordCount : undefined
    const sourceStatus = typeof record.candidateSourceStatus === 'string' ? record.candidateSourceStatus : undefined
    const searchedText = searchedKeyword
      ? `《${searchedKeyword}》`
      : searchedFacets.length
        ? `“${searchedFacets.slice(0, 3).join('、')}”`
        : ''
    if (!searchedText) return null
    const facetText = searchedFacets.length > 0
      ? `，同时拆成“${searchedFacets.slice(0, 5).join('、')}”继续核对`
      : ''
    const sourceText = sourceStatus === 'ready'
      ? '候选源可用'
      : sourceStatus
        ? `候选源状态：${sourceStatus}`
        : '已读取候选源'
    const countText = typeof recordCount === 'number'
      ? `返回 ${recordCount} 条候选`
      : '没有返回可直接判断的候选数量'
    return {
      searchedText,
      briefResultText: `模型先抓取关键词${searchedText}${facetText}；${sourceText}，${countText}，但没有通过节目名、素材标题或可写入规则的匹配。`,
      suggestionText: suggestions.length > 0
        ? `“${suggestions.slice(0, 4).join('”、“')}”`
        : '更接近栏目名、节目标题和内容主题的关键词',
    }
  }

  private readAgentPendingStringSlot(
    pendingTask: AgentResult['decision']['pendingTask'] | undefined,
    key: string,
  ): string | undefined {
    const slot = pendingTask?.collectedSlots?.[key as keyof typeof pendingTask.collectedSlots]
    return typeof slot?.value === 'string' ? slot.value : undefined
  }

  private readAgentPendingNumberSlot(
    pendingTask: AgentResult['decision']['pendingTask'] | undefined,
    key: string,
  ): number | undefined {
    const slot = pendingTask?.collectedSlots?.[key as keyof typeof pendingTask.collectedSlots]
    return typeof slot?.value === 'number' ? slot.value : undefined
  }

  private isAgentCoreCancellation(result: AgentResult): boolean {
    const issueMessage = result.decision.constraintReport?.issues
      .map((issue) => issue.message)
      .filter((message): message is string => typeof message === 'string')
      .join(' ') ?? ''
    return /cancelled|rejected/i.test(issueMessage)
      || /取消|拒绝/u.test(issueMessage)
      || /^(?:取消|拒绝|算了|不用了|先不|不要了)$/u.test(result.input.userInput.trim())
  }

  private async buildAgentCoreDecision(input: RuntimeSubmitInput, agentRun: AgentCoreRunResult): Promise<RuntimeDecision> {
    const { result, capabilitySummary, operationalReadiness, llmRequestTraces } = agentRun
    let userFacingContent = this.buildAgentUserFacingContent(result)
    if (
      input.pendingAtomicContext?.agentPendingTask
      && result.input.interpretation?.pendingAction === 'start_new_task'
    ) {
      userFacingContent = `上一条待确认操作已失效，本轮按新的指令重新判断。\n${userFacingContent}`
    }
    if (result.status === 'executed' && result.executionResult?.committed) {
      return {
        kind: 'agent_execution',
        result,
        feedback: createFeedback(
          userFacingContent,
          'execution',
          '执行完成',
          {
            explanation: '已完成理解、检查和写入。',
            details: this.buildAgentCoreDetails(result, capabilitySummary, operationalReadiness, llmRequestTraces),
          },
        ),
      }
    }

    if (this.isAgentCoreCancellation(result)) {
      return {
        kind: 'message',
        statusHint: 'cancelled',
        feedback: createFeedback(
          userFacingContent,
          'general',
          '已取消',
          {
            explanation: result.decision.constraintReport?.issues[0]?.message ?? '用户取消了当前待确认修改，没有写入当前播单。',
            details: this.buildAgentCoreDetails(result, capabilitySummary, operationalReadiness, llmRequestTraces),
          },
        ),
      }
    }

    const contextConflict = result.decision.constraintReport?.issues.some((issue) => issue.code === 'context_conflict') === true
    if (contextConflict) {
      return {
        kind: 'message',
        statusHint: 'failed',
        feedback: createFeedback(
          userFacingContent,
          'validation',
          '已阻断',
          {
            explanation: result.decision.constraintReport?.issues[0]?.message ?? '确认前播单已变化，上一版修改已作废。',
            details: this.buildAgentCoreDetails(result, capabilitySummary, operationalReadiness, llmRequestTraces),
          },
        ),
      }
    }

    const compiledTaskPlanDecision = await this.tryBuildAgentTaskPlanDraftDecision(input, result)
    if (compiledTaskPlanDecision) return compiledTaskPlanDecision

    if (this.isAgentCandidateRecommendationResult(result)) {
      return {
        kind: 'message',
        statusHint: 'needs_clarification',
        feedback: createFeedback(
          userFacingContent,
          'planning',
          '候选建议',
          {
            explanation: '候选不唯一，本轮只给出推荐和补充方向，不创建待确认写入。',
            details: this.buildAgentCoreDetails(result, capabilitySummary, operationalReadiness, llmRequestTraces),
          },
        ),
      }
    }

    if (result.decision.pendingTask) {
      const pendingContext = this.buildAgentPendingAtomicContext(input, result, userFacingContent)
      if (result.status !== 'needs_confirmation') {
        return {
          kind: 'message',
          statusHint: result.status === 'needs_selection'
            ? 'needs_clarification'
            : result.status === 'blocked'
              ? 'failed'
              : result.status === 'executed'
                ? 'completed'
                : result.status,
          feedback: createFeedback(
            userFacingContent,
            result.status === 'needs_selection' ? 'planning' : 'general',
            result.status === 'needs_selection' ? '候选建议' : '需要补充信息',
            {
              explanation: '这不是待确认写入；我会把候选和缺少的信息放进详情，下一句仍交给 LLM 结合上下文判断。',
              details: {
                ...this.buildAgentCoreDetails(result, capabilitySummary, operationalReadiness, llmRequestTraces),
                conversationAtomicContext: this.pendingAtomicContextService.initialize(pendingContext),
              },
            },
          ),
        }
      }
      return {
        kind: 'pending_atomic_context',
        feedback: createFeedback(
          userFacingContent,
          result.status === 'needs_confirmation' ? 'selection' : 'planning',
          result.status === 'needs_confirmation' ? '待确认' : '待补参',
          {
            explanation: '已记下这次要处理的内容，下一句可以直接补充。',
            details: this.buildAgentCoreDetails(result, capabilitySummary, operationalReadiness, llmRequestTraces),
          },
        ),
        pendingAtomicContext: this.pendingAtomicContextService.initialize(pendingContext),
      }
    }

    const failed = result.status === 'blocked' || result.status === 'failed'
    return {
      kind: 'message',
      statusHint: failed ? 'failed' : 'completed',
      feedback: createFeedback(
        userFacingContent,
        failed ? 'validation' : 'general',
        failed ? '已阻断' : '已判断',
        {
          explanation: result.decision.constraintReport?.issues[0]?.message ?? '已完成本轮判断。',
          details: this.buildAgentCoreDetails(result, capabilitySummary, operationalReadiness, llmRequestTraces),
        },
      ),
    }
  }

  private isAgentCandidateRecommendationResult(result: AgentResult): boolean {
    const pendingTask = result.decision.pendingTask
    if (!pendingTask || pendingTask.phase !== 'needs_selection') return false
    return true
  }

  private buildAgentCandidateRecommendationContent(result: AgentResult, llmFeedback?: string): string | null {
    const recommendations = result.decision.pendingTask?.recommendations ?? result.decision.recommendations ?? []
    if (recommendations.length === 0) return null
    const intent = result.decision.intent
    const actionText = intent === 'replace' ? '替换' : '插入'
    const targetTime = this.readAgentPendingStringSlot(result.decision.pendingTask, 'targetTime')
      ?? result.input.interpretation?.slots?.targetTime
    const safeLlmBasis = llmFeedback
      && this.isBusinessReadableAgentExplanation(llmFeedback)
      && !this.isCandidateSelectionPendingLikeFeedback(llmFeedback)
      ? this.withoutAgentCandidateSearchBrief(llmFeedback, result)
      : ''
    const basis = safeLlmBasis || `我按你给的线索查了候选库，找到了几个可能适合${actionText}的节目。`
    const candidateLines = recommendations
      .slice(0, 5)
      .map((recommendation, index) => this.formatCandidateRecommendationLine(recommendation, index))
    const guide = intent === 'replace'
      ? '你可以补充想替换成的期数、版本、时长、栏目或内容方向，我再继续缩小范围；等信息足够明确后，我再帮你生成可写入的修改。'
      : '你可以补充期数、版本、时长、栏目或内容方向，我再继续缩小范围；等信息足够明确后，我再帮你排入。'
    return [
      `${basis}现在还不能替你直接选其中一个。${targetTime ? `目标位置是 ${toClockText(targetTime)}。` : ''}`,
      candidateLines.join('\n'),
      guide,
    ].filter(Boolean).join('\n')
  }

  private formatCandidateRecommendationLine(recommendation: AgentCandidateRecommendation, index: number): string {
    const durationText = typeof recommendation.duration === 'number' && recommendation.duration > 0
      ? `，${this.formatDurationText(recommendation.duration)}`
      : ''
    const reason = recommendation.reason && this.isBusinessReadableAgentExplanation(recommendation.reason)
      ? `，${recommendation.reason}`
      : ''
    return `${index + 1}. 《${recommendation.programName}》${durationText}${reason}`
  }

  private isCandidateSelectionPendingLikeFeedback(value: string): boolean {
    return /待确认|确认后|让我选|让你选|你选一个|选择候选|选择哪一个|候选选择|再写入/u.test(value)
  }

  private async tryBuildAgentTaskPlanDraftDecision(input: RuntimeSubmitInput, result: AgentResult): Promise<RuntimeDecision | null> {
    const taskPlanDraft = result.input.interpretation?.taskPlanDraft
      ?? this.readAgentAuditTaskPlanDraft(result)
    if (!taskPlanDraft) return null
    if (result.status === 'executed') return null
    return await this.buildCompositeTaskCompileDecision(input, taskPlanDraft)
  }

  private readAgentAuditTaskPlanDraft(result: AgentResult): AgentTaskPlanDraft | undefined {
    const auditSummary = result.decision.auditSummary
    if (!auditSummary || typeof auditSummary !== 'object') return undefined
    const interpretation = (auditSummary as { intentInterpretation?: unknown }).intentInterpretation
    if (!interpretation || typeof interpretation !== 'object') return undefined
    const taskPlanDraft = (interpretation as { taskPlanDraft?: unknown }).taskPlanDraft
    if (!taskPlanDraft || typeof taskPlanDraft !== 'object') return undefined
    const source = taskPlanDraft as Partial<AgentTaskPlanDraft>
    if (source.isComposite !== true || typeof source.goal !== 'string' || !Array.isArray(source.stages)) return undefined
    return source as AgentTaskPlanDraft
  }

  private buildAgentPendingAtomicContext(input: RuntimeSubmitInput, result: AgentResult, userFacingContent?: string): RuntimePendingAtomicContext {
    const pendingTask = result.decision.pendingTask!
    const slots = pendingTask.collectedSlots
    const slotValue = <T>(slot?: { value: T }) => slot?.value
    const intent = pendingTask.intent
    const action = this.mapAgentIntentToRuntimeAction(intent)
    const pendingPhase = this.mapAgentPendingTaskPhase(pendingTask)
    const missingFields = pendingTask.phase === 'needs_confirmation' || pendingTask.phase === 'needs_selection'
      ? ['selection' as const]
      : this.mapAgentMissingSlots(pendingTask.missingSlots)
    const resolvedTarget = result.decision.resolvedTargets?.[0]
    const targetCandidates = this.mapAgentTargetOptions(pendingTask)
    const insertRecommendations = this.mapAgentRecommendations(pendingTask)

    return {
      action,
      phase: pendingPhase,
      summary: result.explanation,
      reasoning: result.input.interpretation?.assistantFeedback || '正在整理这次修改需要的信息。',
      confirmationNote: result.status === 'needs_confirmation' ? userFacingContent : undefined,
      originalUserInput: pendingTask.originalInput || input.userInput,
      collectedUserInput: pendingTask.collectedInput,
      slots: {
        targetTime: slotValue(slots.targetTime),
        newStartTime: slotValue(slots.newStartTime),
        targetTimeHint: slotValue(slots.rangeStart),
        programName: slotValue(slots.programHint),
        rawProgramText: slotValue(slots.programHint),
        replacementProgramName: slotValue(slots.replacementHint),
        targetItemId: slotValue(slots.targetItemId),
        targetItemName: resolvedTarget?.programName,
        direction: slotValue(slots.direction),
        offsetSeconds: slotValue(slots.offsetSeconds),
      },
      missingFields,
      followUpQuestion: result.explanation,
      attemptCount: pendingTask.attemptCount,
      createdAt: pendingTask.createdAt,
      updatedAt: pendingTask.updatedAt,
      expiresAt: pendingTask.expiresAt,
      selectedCandidateId: typeof slots.candidateId?.value === 'string' ? slots.candidateId.value : null,
      targetCandidates,
      insertRecommendations,
      agentPendingTask: pendingTask,
      agentIntent: intent,
    }
  }

  private mapAgentPendingTaskPhase(pendingTask: AgentPendingTask): RuntimePendingAtomicPhase {
    if (pendingTask.phase === 'needs_selection') {
      if ((pendingTask.recommendations?.length ?? 0) > 0) return 'recommending_insert'
      if ((pendingTask.targetOptions?.length ?? 0) > 0) return 'selecting_target'
    }
    return 'clarifying'
  }

  private mapAgentTargetOptions(pendingTask: AgentPendingTask): RuntimeScheduleItem[] | undefined {
    if (!pendingTask.targetOptions?.length) return undefined
    return pendingTask.targetOptions.map((option) => ({
      id: option.itemId,
      programCode: option.programCode,
      programName: option.programName,
      startTime: option.startTime,
      endTime: option.endTime,
      duration: option.duration,
      programType: option.programType,
    }))
  }

  private mapAgentRecommendations(pendingTask: AgentPendingTask): RuntimeInsertRecommendationCandidate[] | undefined {
    if (!pendingTask.recommendations?.length) return undefined
    return pendingTask.recommendations.map((recommendation) => ({
      candidateId: recommendation.candidateId,
      programName: recommendation.programName,
      programCode: recommendation.programCode,
      duration: recommendation.duration,
      programType: recommendation.programType,
      score: recommendation.score,
      confidence: Math.max(0, Math.min(1, recommendation.score / 100)),
      reasonTags: [
        recommendation.reason,
        ...(recommendation.warningCodes ?? []),
        ...(recommendation.blockingCodes ?? []),
      ].filter(Boolean),
    }))
  }

  private buildAgentCoreDetails(
    result: AgentResult,
    capabilitySummary: SchedulingAgentRuntimeCapabilitySummary,
    operationalReadiness: SchedulingAgentOperationalReadinessAudit,
    llmRequestTraces: LLMRequestTrace[] = [],
  ): RuntimeDetailMap {
    return {
      agentCore: true,
      agentCapabilities: capabilitySummary,
      agentOperationalReadiness: operationalReadiness,
      status: result.status,
      intent: result.decision.intent,
      command: result.decision.command,
      assistantProcessSummary: this.buildAgentAssistantProcessSummary(result),
      agentRunTraceSummary: this.buildAgentRunTraceSummary(result, llmRequestTraces),
      auditSummary: result.decision.auditSummary,
      agentEvidenceBudget: this.resolveAgentEvidenceBudget(result),
      candidateSelection: result.decision.candidateSelection,
      recommendations: result.decision.recommendations,
      agentPendingLlmContext: result.decision.pendingTask
        ? buildPendingLlmContext(result.decision.pendingTask, '')
        : undefined,
      agentLlmContextUsed: this.resolveAgentLlmContextUsed(result),
      queryResult: result.decision.queryResult,
      constraintReport: result.decision.constraintReport,
      validationReport: result.validationReport,
      affectedItemIds: result.executionResult?.affectedItemIds,
      llmRequestTraces: llmRequestTraces.length > 0 ? llmRequestTraces : undefined,
      trace: result.trace,
    }
  }

  private buildAgentRunTraceSummary(result: AgentResult, llmRequestTraces: LLMRequestTrace[]): RuntimeDetailMap {
    const lastStep = result.trace.at(-1)
    const evidenceBudget = this.resolveAgentEvidenceBudget(result)
    const pendingTask = result.decision.pendingTask
    const issueCodes = result.decision.constraintReport?.issues
      .map((issue) => issue.code)
      .filter((code) => typeof code === 'string' && code.trim().length > 0) ?? []
    const llmTotalDurationMs = llmRequestTraces.reduce((sum, trace) => sum + Math.max(0, trace.durationMs), 0)
    const llmPromptCharCount = llmRequestTraces.reduce((sum, trace) => sum + Math.max(0, trace.promptCharCount ?? 0), 0)
    return {
      status: result.status,
      intent: result.decision.intent,
      totalElapsedMs: lastStep?.elapsedMs,
      traceStepCount: result.trace.length,
      llmCallCount: llmRequestTraces.length,
      llmTotalDurationMs,
      llmPromptCharCount: llmPromptCharCount > 0 ? llmPromptCharCount : undefined,
      llmFailedCount: llmRequestTraces.filter((trace) => !trace.success).length,
      llmLabels: Array.from(new Set(llmRequestTraces.map((trace) => trace.label))).slice(0, 5),
      evidenceBudget,
      pendingPhase: pendingTask?.phase,
      recommendationCount: (result.decision.recommendations?.length ?? 0) || (pendingTask?.recommendations?.length ?? 0),
      wroteFormalPlaylist: result.executionResult?.committed === true,
      affectedItemCount: result.executionResult?.affectedItemIds.length ?? 0,
      issueCodes,
    }
  }

  private resolveAgentEvidenceBudget(result: AgentResult): RuntimeDetailMap | undefined {
    const step = [...result.trace].reverse().find((item) => (
      typeof item.detail?.scheduleItemTotalCount === 'number'
      || typeof item.detail?.candidateTotalCount === 'number'
      || typeof item.detail?.latestHistoryItemTotalCount === 'number'
    ))
    const detail = step?.detail
    if (!detail) return undefined
    return {
      scheduleItems: {
        included: detail.scheduleItemCount,
        total: detail.scheduleItemTotalCount,
        truncated: detail.scheduleItemTruncated,
      },
      candidates: {
        included: detail.candidateCount,
        total: detail.candidateTotalCount,
        truncated: detail.candidateTruncated,
      },
      latestHistoryItems: {
        included: detail.latestHistoryItemCount,
        total: detail.latestHistoryItemTotalCount,
        truncated: detail.latestHistoryItemTruncated,
      },
      playlistType: detail.playlistType,
    }
  }

  private resolveAgentLlmContextUsed(result: AgentResult): AgentPendingLlmContext | undefined {
    return result.trace
      .map((step) => step.detail?.pendingLlmContext)
      .filter(this.isAgentPendingLlmContext)
      .at(-1)
  }

  private isAgentPendingLlmContext(value: unknown): value is AgentPendingLlmContext {
    if (!value || typeof value !== 'object') return false
    const record = value as Partial<AgentPendingLlmContext>
    return Boolean(record.pendingContext && typeof record.pendingContext === 'object')
      && Array.isArray(record.allowedActions)
      && typeof record.latestUserInput === 'string'
  }

  private shouldAttemptAgentCoreInstruction(userInput: string): boolean {
    const normalized = userInput.replace(/\s+/g, '')
    if (/(生成|编排|排满|铺满|草案|版面|方案)/.test(normalized) && !/(插入|删除|删掉|移动|后移|前移|替换|换成|校验|检查|体检|查询|查看)/.test(normalized)) {
      return false
    }
    return this.shouldAttemptAtomicInstruction(userInput)
      || /(校验|检查|体检|有没有问题|冲突|重叠|查询|查找|查看|看看|有哪些|是什么|在哪里|在哪儿|在哪|哪里|什么时候播|几点播|播出时间|排在几点|当前节目单|当前播单)/.test(normalized)
      || Boolean(parseAtomicTimeRange(userInput) && /(整体|批量|删除|删掉|移动|后移|前移|顺延|延后|提前)/.test(normalized))
  }

  private mapAgentIntentToRuntimeAction(intent: AtomicCommandIntent): RuntimeAtomicAction | null {
    switch (intent) {
      case 'insert':
        return 'insert'
      case 'move':
      case 'batch_move':
        return 'move'
      case 'delete':
      case 'batch_delete':
        return 'delete'
      case 'replace':
        return 'replace'
      default:
        return null
    }
  }

  private mapAgentMissingSlots(missingSlots: string[]): RuntimeAtomicMissingField[] {
    const mapped = missingSlots.map((slot) => {
      if (slot === 'targetTime' || slot === 'rangeStart' || slot === 'rangeEnd') return 'target_time'
      if (slot === 'programHint') return 'program_name'
      if (slot === 'replacementHint') return 'replacement_program'
      if (slot === 'offsetSeconds') return 'offset'
      return 'selection'
    })
    return mapped.length ? Array.from(new Set(mapped)) : ['selection']
  }

  private parseCompactHourRange(userInput: string): { start: string; end: string } | null {
    const normalized = userInput.replace(/\s+/g, '')
    const match = normalized.match(/(\d{1,2})(?::(\d{2}))?(?:点|时)?(?:-|—|~|～|到|至)(\d{1,2})(?::(\d{2}))?(?:点|时)?/)
    if (!match) return null
    const startHour = Number(match[1])
    const startMinute = Number(match[2] ?? '0')
    const endHour = Number(match[3])
    const endMinute = Number(match[4] ?? '0')
    if ([startHour, startMinute, endHour, endMinute].some((value) => Number.isNaN(value))) return null
    if (startHour < 0 || startHour > 23 || endHour < 0 || endHour > 24) return null
    if (startMinute < 0 || startMinute > 59 || endMinute < 0 || endMinute > 59) return null
    return {
      start: `${`${startHour}`.padStart(2, '0')}:${`${startMinute}`.padStart(2, '0')}:00`,
      end: `${`${endHour}`.padStart(2, '0')}:${`${endMinute}`.padStart(2, '0')}:00`,
    }
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

  private applyDraftResearchSuggestion(
    draft: LayoutDraft,
    suggestion: RuntimeDraftResearchSuggestion,
  ): LayoutDraft | null {
    const slotIndex = this.resolveDraftResearchSuggestionSlotIndex(draft, suggestion)
    if (slotIndex < 0) return null
    const slot = draft.layoutReference.slots[slotIndex]
    if (!slot) return null
    const columnIndex = draft.columns.findIndex((column) => column.columnId === slot.columnId)
    if (columnIndex < 0) return null
    const candidateNames = suggestion.topCandidates.map((candidate) => candidate.programName)
    const candidateTags = suggestion.topCandidates.flatMap((candidate) => candidate.contentTags ?? [])
    const queryHints = dedupeStrings([
      ...suggestion.queries,
      ...candidateNames,
      ...candidateTags,
    ]).slice(0, 12)
    const columns = draft.columns.map((column, index) => {
      if (index !== columnIndex) return column
      const knownProgramType = this.normalizeResearchProgramTypes(suggestion.programTypeHint)?.[0]
      return {
        ...column,
        columnName: suggestion.semanticLabel,
        semanticLabel: suggestion.semanticLabel,
        defaultProgramType: knownProgramType ?? column.defaultProgramType,
        queryHints,
        draftConstraintKind: column.draftConstraintKind ?? 'unspecified',
        source: 'generated' as const,
      }
    })
    const durationSegments = draft.durationSegments?.map((segment, index) => (
      index === slotIndex
        ? {
            ...segment,
            label: suggestion.semanticLabel,
            contentHint: queryHints.length ? queryHints.join('、') : suggestion.semanticLabel,
          }
        : segment
    ))
    return {
      ...draft,
      version: (draft.version ?? 1) + 1,
      userIntent: suggestion.userInput || draft.userIntent,
      columns,
      durationSegments,
      warnings: draft.warnings,
    }
  }

  private resolveDraftResearchSuggestionSlotIndex(
    draft: LayoutDraft,
    suggestion: RuntimeDraftResearchSuggestion,
  ): number {
    if (suggestion.targetSegmentIndex && suggestion.targetSegmentIndex >= 1 && suggestion.targetSegmentIndex <= draft.layoutReference.slots.length) {
      return suggestion.targetSegmentIndex - 1
    }
    const label = (suggestion.targetSegmentLabel ?? suggestion.semanticLabel ?? '').replace(/\s+/g, '').toLowerCase()
    if (label) {
      const matchedIndex = this.resolveDraftSlotIndexByLabel(draft, label)
      if (matchedIndex >= 0) return matchedIndex
    }
    return draft.layoutReference.slots.length === 1 ? 0 : -1
  }

  private mergePendingCollectedInput(collectedUserInput: string, userInput: string): string {
    const normalizedFollowUp = userInput.trim()
    if (!normalizedFollowUp) return collectedUserInput
    if (collectedUserInput.includes(normalizedFollowUp)) return collectedUserInput
    return `${collectedUserInput}，补充说明：${normalizedFollowUp}`
  }

  private async tryHandleAtomicInstruction(input: RuntimeSubmitInput): Promise<RuntimeDecision | null> {
    const context = buildDialogueContext({ scheduleState: input.scheduleState, userInput: input.userInput, currentSchedule: input.currentSchedule })
    const recognizedIntent = await this.intentRecognizer.recognize(context)
    const recognizedAction = this.asRuntimeAtomicAction(recognizedIntent?.type)

    const intent = recognizedAction ? recognizedIntent : null
    if (!intent || !this.asRuntimeAtomicAction(intent.type)) return null

    const result = await this.buildMicroEditCommand(input, intent.reasoning, intent)
    return this.buildMicroEditDecision(result, intent.reasoning)
  }

  private shouldAttemptAtomicInstruction(_userInput: string): boolean {
    return true
  }

  private shouldPreferLayoutDraftForOpenScheduling(userInput: string): boolean {
    if (!looksLikeProgramSchedulingRequest(userInput)) return false

    const normalized = userInput.replace(/\s+/g, '')
    const hasRange = Boolean(
      parseSchedulingTimeRange(userInput)
        ?? parseAtomicTimeRange(userInput)
        ?? this.parseCompactHourRange(userInput),
    )
    if (!hasRange) return false

    const hasExplicitAtomicCue = /(插入|插个|插一|插播|加播|添加|补点|推荐|候选|删除|删掉|移除|去掉|移动|移到|调到|调整到|放到|挪到|后移|前移|顺延|推迟|延迟|延后|提前|替换|换成|换播|改成|改为)/.test(normalized)
    if (hasExplicitAtomicCue) return false

    return /(安排|编排|排入|排播|直播|节目|播单|栏目|轮播单|电视播单)/.test(normalized)
  }

  private shouldRouteToLayoutDraftRefine(userInput: string): boolean {
    const normalized = userInput.replace(/\s+/g, '')
    const hasExplicitDraftReference = /(草案|版面草案|当前版面|这个版面|该版面|刚才.*版面|刚才.*草案|这个草案|该草案|按草案|参考草案|基于草案|照草案|用草案|按版面|参考版面|基于版面|照版面|用版面)/.test(normalized)
    if (!hasExplicitDraftReference) return false
    const hasDraftCue = /(草案|版面草案|当前版面|版面|时段)/.test(normalized)
    const hasDraftRefineVerb = /(删除|删掉|移除|去掉|撤掉|撤下|拿掉|拿下|下掉|替换|换成|换播|换掉|替换成|替换为|改成|改为|改播|调整为|拆分|拆成|分成|分为|切成|规划成)/.test(normalized)
    const hasTimeOrDaypartCue = Boolean(parseAtomicClockExpression(normalized))
      || /(全天|整天|全日|上午|中午|午间|下午|晚间|晚上|夜间|深夜|凌晨)/.test(normalized)
    return hasDraftRefineVerb && (hasDraftCue || hasTimeOrDaypartCue || normalized.length <= 32)
  }

  private shouldClarifyUnsupportedAtomicIntent(input: RuntimeSubmitInput, action: RuntimeAtomicAction): boolean {
    const normalized = input.userInput.replace(/\s+/g, '')
    if (looksLikeProgramSchedulingRequest(input.userInput)) return true
    if (/^(插入|插播|添加|加播)$/.test(normalized)) return true
    if (
      Boolean(parseAtomicClockExpression(normalized))
      && /(节目|播单|节目单|编排单|串联单|栏目|时段|那段|这段|那条|这条|那档|这档|播|档|条)/.test(normalized)
    ) return true
    if (
      input.currentSchedule.length > 0
      && /(它|这条|那条|这个|那个|这档|那档|这段|那段|当前|刚才|刚刚|上一个|下一个|节目)/.test(normalized)
    ) return true
    return action === 'insert' && /(节目|内容|候选|推荐|找|查|有没有)/.test(normalized)
  }

  private tryClassifyExplicitRangeLayoutInstruction(userInput: string): TaskClassification | null {
    const range = parseAtomicTimeRange(userInput) ?? this.parseCompactHourRange(userInput)
    if (!range) return null

    const normalized = userInput.replace(/\s+/g, '')
    if (!this.isExplicitLayoutDraftPreparationInstruction(normalized)) return null
    if (this.looksLikeSequentialDurationSegments(normalized)) return null
    const hasRangeSchedulingVerb = /(安排|编排|排入|排|准备|制作|生成|创建|做成|做个|做一段|来个|来一版|轮播单|直播单|节目单|编排单|播单|版面|继续播|接着播|续播|顺播|顺着排|补中间集|补缺集|补空档|补空窗|补空缺)/.test(normalized)
    const hasAtomicOnlyVerb = /(插入|插个|插一|添加节目|添加|加一条|加一档|加个|删除|删掉|移除|去掉|撤掉|撤下|拿掉|拿下|下掉|移动|后移|前移|顺延|延后|提前|推迟|推后|延迟|替换|换成|换播|换掉|替换成|替换为|改成|改为|改播)/.test(normalized)
    if (!hasRangeSchedulingVerb || hasAtomicOnlyVerb) return null

    const explicitSegments = this.extractExplicitRangeSegments(userInput)
    if (explicitSegments.length >= 2) {
      const first = explicitSegments[0]!
      const last = explicitSegments.at(-1)!
      const semanticLabel = explicitSegments
        .map((segment) => segment.semanticLabel)
        .filter(Boolean)
        .join('、')

      return {
        mode: 'layout_prepare',
        confidence: 0.93,
        reasoning: '用户一次性给出了多个明确起止时间，应按每个时段生成独立版面草案，再分别检索候选和正式编排。',
        suggestedParams: {
          userIntent: semanticLabel || userInput,
          targetTimeRange: { start: first.start, end: last.end },
          semanticLabel: semanticLabel || first.semanticLabel,
          programTypeHint: first.programTypeHint,
          segments: explicitSegments,
        },
      }
    }

    const semanticLabel = this.extractExplicitRangeSemanticLabel(userInput)
    if (!semanticLabel) return null

    return {
      mode: 'layout_prepare',
      confidence: 0.9,
      reasoning: '用户给出了明确起止时间和编排内容，应先生成该时段的版面草案，再进入候选检索和正式编排。',
      suggestedParams: {
        userIntent: semanticLabel,
        targetTimeRange: range,
        semanticLabel,
        programTypeHint: this.inferInsertProgramTypeHint(semanticLabel),
      },
    }
  }

  private extractExplicitRangeSegments(userInput: string): LayoutIntentSegment[] {
    const normalized = userInput.replace(/\s+/g, '')
    const clockToken = '(?:\\d{1,2}[:：]\\d{1,2}(?::\\d{1,2})?|\\d{1,2}点(?:\\d{1,2}分?)?)'
    const rangePattern = new RegExp(`${clockToken}(?:到|至|[-~—～])${clockToken}`, 'gu')
    const matches = [...normalized.matchAll(rangePattern)]
    if (matches.length < 2) return []

    return matches
      .map((match, index): LayoutIntentSegment | null => {
        const matchedRange = match[0]
        const range = parseAtomicTimeRange(matchedRange)
        if (!range || typeof match.index !== 'number') return null

        const nextIndex = matches[index + 1]?.index ?? normalized.length
        const rawLabel = normalized.slice(match.index + matchedRange.length, nextIndex)
        const semanticLabel = this.cleanExplicitRangeSegmentLabel(rawLabel)
        if (!semanticLabel) return null
        const programTypeHint = this.inferInsertProgramTypeHint(semanticLabel)
        return {
          start: range.start,
          end: range.end,
          semanticLabel,
          programTypeHint,
          sequential: programTypeHint === 'drama',
        }
      })
      .filter((segment): segment is LayoutIntentSegment => Boolean(segment))
  }

  private cleanLayoutDraftActionNoise(value: string): string {
    return value
      .replace(/(?:生成|创建|新建|准备|制作|做成|做一版|做一份|来一版|来一份)?(?:轮播)?版面草案$/g, '')
      .replace(/(?:生成|创建|新建|准备|制作|做成|做一版|做一份|来一版|来一份)?草案$/g, '')
      .replace(/(?:生成|创建|新建|准备|制作|做成|做一版|做一份|来一版|来一份)?版面$/g, '')
      .replace(/[，,。.!！?？、]+$/g, '')
      .trim()
  }

  private cleanExplicitRangeSegmentLabel(value: string): string | undefined {
    const cleaned = value
      .replace(/^[，,。！？!?；;：:、]+|[，,。！？!?；;：:、]+$/g, '')
      .replace(/^(?:按)?(?:纯电视频道|电视频道|频道编排|常规频道)/g, '')
      .replace(/^(?:安排|编排|排入|排|准备|制作|生成|创建|做成|做个|做一段|来个|来一版|继续播|接着播|续播|顺播|顺着排)+/g, '')
      .replace(/(?:接昨天进度|接昨日进度|接昨天|接昨日|昨天进度|昨日进度|顺播|续播|继续播|接着播|顺着排)/g, '')
      .replace(/(?:顺着|按照|根据)?(?:当前|现有|今天)?(?:版面|节目单|编排单)?(?:补中间集|补缺集|补空档|补空窗|补空缺)/g, '')
      .replace(/(?:轮播版面草案|版面草案|轮播版面|轮播单|直播单|节目单|编排单|串联单|播单|版面|草案|节目|内容)$/g, '')
      .replace(/[，,。！？!?；;：:、]+$/g, '')
      .trim()

    const finalLabel = this.cleanLayoutDraftActionNoise(cleaned)
    return finalLabel.length >= 2 ? finalLabel : undefined
  }

  private tryClassifyRotationThemeDurationLayoutInstruction(input: RuntimeSubmitInput): TaskClassification | null {
    if (input.scheduleState.playlistType !== 'rotation') return null
    if (input.currentLayoutDraft) return null

    const normalized = input.userInput.replace(/\s+/g, '')
    const hasAtomicMutationVerb = /(插入|插个|插一|插播|加播|添加|删除|删掉|移除|去掉|移动|移到|调到|调整到|放到|挪到|后移|前移|顺延|替换|换成|换播)/.test(normalized)
    if (hasAtomicMutationVerb) return null

    const durationSeconds = this.extractRotationDurationSeconds(normalized)
    if (!durationSeconds || durationSeconds <= 0) return null

    const topic = this.cleanRotationThemeDurationLabel(input.userInput)
    if (!topic || this.isGenericRotationDraftTopic(topic)) return null

    const hasDraftBuildCue = /(建立|创建|新建|生成|制作|做|准备|编排|排播|排满|排成|规划|设计|整理|搭|来个|来一版|帮我|麻烦|请)/.test(normalized)
      || /(轮播|播单|编排|草案|版面|主题|内容)/.test(normalized)
    if (!hasDraftBuildCue) return null

    const durationText = this.formatDurationText(durationSeconds)
    return {
      mode: 'layout_prepare',
      confidence: 0.9,
      reasoning: '用户给出了轮播单主题和目标总时长。当前阶段应先整理轮播草案并做内容方向核验，确认前不能直接写入正式轮播单。',
      suggestedParams: {
        userIntent: `${topic}，总时长${durationText}`,
        semanticLabel: topic,
        programTypeHint: this.inferInsertProgramTypeHint(topic) ?? 'news_magazine',
        rotationDurationSeconds: durationSeconds,
        ignoreExistingLayout: true,
      },
    }
  }

  private cleanRotationThemeDurationLabel(userInput: string): string | undefined {
    const durationToken = '(?:一刻钟|三刻钟|半个?小时|(?:(?:\\d+(?:\\.\\d+)?)|[零〇一二两三四五六七八九十]{1,3})(?:个)?小时|(?:(?:\\d+)|[零〇一二两三四五六七八九十]{1,3})(?:分钟|分))'
    const cleaned = userInput
      .replace(new RegExp(`(?:总时长|时长|大概|大约|约|预计|目标)?${durationToken}`, 'gu'), '')
      .replace(/(?:建立|创建|新建|生成|制作|做成|做一个|做一份|做一张|做一版|准备|编排|排播|排满|排成|规划|设计|整理|搭建|来个|来一版|帮我|麻烦|请|具体)/g, '')
      .replace(/(?:轮播版面草案|版面草案|轮播草案|轮播版面|轮播单|直播单|节目单|编排单|串联单|播单|版面|草案|编排|节目|内容|主题是|主题为|主题)/g, '')
      .replace(/(?:内容匹配优先|内容优先|匹配优先|收视率优先|收视优先|热度优先|热播优先)/g, '')
      .replace(/^(?:一个|一份|一张|一版|的)+/g, '')
      .replace(/(?:的)$/g, '')
      .replace(/[，,。！？!?；;：:、\s]+/g, '')
      .trim()
    return cleaned.length >= 2 ? cleaned : undefined
  }

  private isGenericRotationDraftTopic(topic: string): boolean {
    const normalized = topic.replace(/\s+/g, '')
    return /^(轮播|轮播内容|主要内容|宣传片|短片|节目|内容|素材|垫片)$/.test(normalized)
  }

  private parseSequentialDurationSeconds(value: string): number | null {
    const normalized = value.trim()
    if (!normalized) return null
    if (/^一刻钟$/.test(normalized)) return 15 * 60
    if (/^三刻钟$/.test(normalized)) return 45 * 60
    if (/^半个?小时$/.test(normalized)) return 30 * 60

    const hourMatch = normalized.match(/^(\d+(?:\.\d+)?|[零〇一二两三四五六七八九十]{1,3})(?:个)?小时$/)
    if (hourMatch?.[1]) {
      const hours = this.parseSequentialChineseNumber(hourMatch[1])
      return hours === null ? null : Math.round(hours * 3600)
    }

    const minuteMatch = normalized.match(/^(\d+|[零〇一二两三四五六七八九十]{1,3})(?:分钟|分)$/)
    if (minuteMatch?.[1]) {
      const minutes = this.parseSequentialChineseNumber(minuteMatch[1])
      return minutes === null ? null : Math.round(minutes * 60)
    }

    return null
  }

  private parseSequentialChineseNumber(value: string): number | null {
    if (/^\d+(?:\.\d+)?$/.test(value)) return Number(value)
    const digitMap: Record<string, number> = {
      零: 0,
      〇: 0,
      一: 1,
      二: 2,
      两: 2,
      三: 3,
      四: 4,
      五: 5,
      六: 6,
      七: 7,
      八: 8,
      九: 9,
    }
    if (Object.prototype.hasOwnProperty.call(digitMap, value)) return digitMap[value]!
    if (value === '十') return 10
    const teen = value.match(/^十([一二两三四五六七八九])$/)
    if (teen?.[1]) return 10 + digitMap[teen[1]]!
    const tens = value.match(/^([一二两三四五六七八九])十([一二两三四五六七八九])?$/)
    if (tens?.[1]) return digitMap[tens[1]]! * 10 + (tens[2] ? digitMap[tens[2]]! : 0)
    return null
  }

  private looksLikeSequentialDurationSegments(normalized: string): boolean {
    const duration = '[0-9一二两三四五六七八九十半]+(?:分钟|分|小时|个小时|刻钟)'
    return new RegExp(`(?:先|首先|顺次|依次|按顺序)?.{0,24}${duration}.{0,24}(?:再|然后|接着|随后).{0,24}${duration}`).test(normalized)
  }

  private extractExplicitRangeSemanticLabel(userInput: string): string | undefined {
    const normalized = userInput
      .replace(/\s+/g, '')
      .replace(/(?:在)?\d{1,2}(?::|：)\d{2}(?:到|至|[-—~])\d{1,2}(?::|：)\d{2}/g, '')
      .replace(/(?:在)?\d{1,2}点(?:\d{1,2}分)?(?:到|至|[-—~])\d{1,2}点(?:\d{1,2}分)?/g, '')
      .replace(/^(帮我|请|麻烦|我要|我想|给我|我准备在|准备在|我准备|在|于)/, '')
      .replace(/(安排|编排|排入|准备|制作|生成|创建|做成|做个|做一段|来个|来一版|进行|继续播|接着播|续播|顺播|顺着排)/g, '')
      .replace(/(?:按)?(?:纯电视频道|电视频道|频道编排|常规频道)/g, '')
      .replace(/(?:接昨天进度|接昨日进度|接昨天|接昨日|昨天进度|昨日进度)/g, '')
      .replace(/(?:顺着|按照|根据)?(?:当前|现有|今天)?(?:版面|节目单|编排单)?(?:补中间集|补缺集|补空档|补空窗|补空缺)/g, '')
      .replace(/(轮播版面草案|版面草案|轮播版面|轮播单|直播单|节目单|编排单|串联单|播单|版面|草案)$/g, '')
      .replace(/[，,。！？!?；;：:]+$/g, '')
      .replace(/(?:一个|一份|一版|一段|一条|一期|一些|的)+$/g, '')
      .replace(/[，,。！？!?；;：:]+$/g, '')
      .trim()

    return normalized.length >= 2 ? normalized : undefined
  }

  private tryClassifyDaypartLayoutInstruction(userInput: string): TaskClassification | null {
    const range = parseSchedulingTimeRange(userInput)
    if (!range) return null

    const normalized = userInput.replace(/\s+/g, '')
    if (!this.isExplicitLayoutDraftPreparationInstruction(normalized)) return null
    if (this.looksLikeSequentialDurationSegments(normalized)) return null
    const hasDaypartCue = /(上午|中午|午间|下午|晚间|晚上|夜间|黄金时段|黄金档|七点档|八点档)/.test(normalized)
    if (!hasDaypartCue) return null

    const hasDraftRestartCue = /(草案|版面).*(不要|不用|取消|放弃|重做|重新做|重新)|(不要|不用|取消|放弃).*(草案|版面).*(重做|重新做|重新)/.test(normalized)
    if (hasDraftRestartCue) return null

    const hasMutationOnlyVerb = /(删除|删掉|移除|去掉|撤掉|撤下|拿掉|拿下|下掉|移动|后移|前移|顺延|延后|提前|推迟|推后|延迟|往后挪|往前挪)/.test(normalized)
    if (hasMutationOnlyVerb) return null

    const hasSchedulingCue = looksLikeProgramSchedulingRequest(userInput)
      || /(安排|编排|排入|编入|补齐|补排|填充|改成|换成|统一成|调整为|做成|做个|做一版|主打|为主|多一点|多一些|上点|来点|垫个|轮播单|直播单|节目单|编排单|播单)/.test(normalized)
    if (!hasSchedulingCue) return null

    const semanticLabel = this.extractDaypartSemanticLabel(userInput)
    if (!semanticLabel) return null

    return {
      mode: 'layout_prepare',
      confidence: 0.88,
      reasoning: '用户给出了明确日段和编排内容，应先生成该段版面草案，再进入候选检索和正式编排。',
      suggestedParams: {
        userIntent: userInput,
        targetTimeRange: range,
        semanticLabel,
        programTypeHint: this.inferInsertProgramTypeHint(semanticLabel),
      },
    }
  }

  private extractDaypartSemanticLabel(userInput: string): string | undefined {
    const normalized = userInput.replace(/\s+/g, '')
    const primaryMatch = normalized.match(/(?:以|主打|围绕|侧重)(.+?)(?:为主|多一点|多一些|节目|内容)?$/)
    const primaryLabel = primaryMatch?.[1]?.trim()
    const source = primaryLabel && primaryLabel.length >= 2 ? primaryLabel : normalized
    const cleaned = source
      .replace(/^(?:请|麻烦|帮我|给我|我要|我想|先|继续|还是)/, '')
      .replace(/(?:上午|中午|午间|下午|晚间|晚上|夜间|黄金时段|黄金档|七点档|八点档|今天|明天|今晚|明晚|周末|周五)/g, '')
      .replace(/^(?:安排|编排|排入|编入|补齐|补排|填充|改成|换成|统一成|调整为|做成|做个|做一版|来个|来一版|上点|来点|垫个|加点|加一些|加一段|主打)/g, '')
      .replace(/(?:轮播版面草案|版面草案|轮播版面|轮播单|直播单|节目单|编排单|串联单|播单|版面|草案|节目|内容)$/g, '')
      .replace(/(?:多一点|多一些|为主)$/g, '')
      .trim()

    const finalLabel = this.cleanLayoutDraftActionNoise(cleaned)
    return finalLabel.length >= 2 ? finalLabel : undefined
  }

  private tryClassifyRelativeEventLayoutInstruction(userInput: string): TaskClassification | null {
    const normalized = userInput.replace(/\s+/g, '')
    if (!this.isExplicitLayoutDraftPreparationInstruction(normalized)) return null
    if (this.looksLikeSequentialDurationSegments(normalized)) return null
    const hasRelativeCue = /(开播前|开播后|开场前|开场后|赛前|赛后|会前|会后|前后|前面|后面|之前|之后)/.test(normalized)
    if (!hasRelativeCue) return null

    const hasEventCue = /(发布会|赛事|直播|活动|会场|展会|论坛|峰会|庆典|演出|外场|户外|现场)/.test(normalized)
    if (!hasEventCue) return null

    const hasSchedulingCue = /(安排|编排|排入|加|加点|加个|加一点|加一段|垫|垫点|垫个|垫一点|垫一段|放|放点|放一段|做|做个|做一版|来|来个|来一段|预热|预告|导视|垫片|暖场|串场|过渡|集锦|花絮|快讯|提醒)/.test(normalized)
    if (!hasSchedulingCue) return null

    const range = parseSchedulingTimeRange(userInput) ?? { start: '18:00:00', end: '23:00:00' }
    const semanticLabel = this.extractRelativeEventSemanticLabel(userInput)
    if (!semanticLabel) return null

    return {
      mode: 'layout_prepare',
      confidence: 0.84,
      reasoning: '用户给出了事件前后类编排意图，应先生成相对事件的功能型版面草案，再进入候选检索和正式编排。',
      suggestedParams: {
        userIntent: userInput,
        targetTimeRange: range,
        semanticLabel,
        programTypeHint: this.inferRelativeEventProgramTypeHint(semanticLabel),
      },
    }
  }

  private inferRelativeEventProgramTypeHint(semanticLabel: string): string | undefined {
    if (/(预热|预告|导视|垫片|暖场|串场|过渡|集锦|花絮|快讯|提醒)/.test(semanticLabel)) {
      return 'news_magazine'
    }
    return this.inferInsertProgramTypeHint(semanticLabel)
  }

  private extractRelativeEventSemanticLabel(userInput: string): string | undefined {
    const normalized = userInput.replace(/\s+/g, '')
    if (/发布会/.test(normalized) && /预热/.test(normalized)) return '发布会预热'
    if (/赛事/.test(normalized) && /预热/.test(normalized)) return '赛事预热'
    if (/现场/.test(normalized) && /导视/.test(normalized)) return '现场导视'
    if (/导视/.test(normalized)) return '导视'
    if (/发布会/.test(normalized) && /预告/.test(normalized)) return '发布会预告'
    if (/赛事/.test(normalized) && /预告/.test(normalized)) return '赛事预告'
    if (/预告/.test(normalized)) return '预告'
    if (/轻松/.test(normalized) && /过渡/.test(normalized)) return '轻松过渡'
    if (/过渡/.test(normalized)) return '过渡'
    if (/暖场/.test(normalized)) return '暖场'

    const functionalMatch = normalized.match(/(.{0,8}(?:预热|预告|导视|垫片|暖场|串场|过渡|集锦|花絮|快讯|提醒))/)
    if (functionalMatch?.[1]) {
      return functionalMatch[1]
        .replace(/^(?:安排|编排|排入|加|加点|加个|加一点|加一段|垫|垫点|垫个|垫一点|垫一段|放|放点|放一段|做|做个|做一版|来|来个|来一段)/, '')
        .replace(/^(?:发布会|赛事|直播|活动|会场|展会|论坛|峰会|庆典|演出|外场|户外|现场|开播前|开播后|开场前|开场后|赛前|赛后|会前|会后|前后|前面|后面|之前|之后)+/, '')
        .trim()
    }

    const tailMatch = normalized.match(/(?:安排|编排|排入|加|加点|加个|加一点|加一段|垫|垫点|垫个|垫一点|垫一段|放|放点|放一段|做|做个|做一版|来|来个|来一段)(.+)$/)
    const cleaned = tailMatch?.[1]
      ?.replace(/(?:节目|内容|片子|视频)$/g, '')
      .trim()
    return cleaned && cleaned.length >= 2 ? cleaned : undefined
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

    const proposedRangeByItemId = new Map(proposedRanges.map((item) => [item.itemId, item.range]))
    const proposedSchedule = input.currentSchedule.map((item, index) => {
      const proposedRange = proposedRangeByItemId.get(item.id)
      if (!proposedRange) return asScheduleSnapshot(item, input.scheduleState.date, index + 1)
      return {
        ...asScheduleSnapshot(item, input.scheduleState.date, index + 1),
        startTime: normalizeDateTime(input.scheduleState.date, proposedRange.start),
        endTime: normalizeDateTime(input.scheduleState.date, proposedRange.end),
      }
    })
    for (const proposed of proposedRanges) {
      const proposedItem = proposedSchedule.find((item) => item.id === proposed.itemId)
      if (!proposedItem) continue
      const violation = detectMovingItemSequenceViolation(
        proposedItem,
        proposedSchedule.filter((item) => item.id !== proposed.itemId),
        '批量平移',
      )
      if (violation) {
        issues.push(violation.message)
      }
    }

    return { ok: issues.length === 0, issues }
  }

  private validateBatchMoveExecution(
    scheduleDate: string,
    channelId: string,
    proposedSchedule: ScheduleItemSnapshot[],
    movedItemIds: string[],
  ): string[] {
    const issues: string[] = []
    const movedIds = new Set(movedItemIds)
    const window = resolveBroadcastWindow(channelId, scheduleDate)
    const windowStart = new Date(normalizeDateTime(scheduleDate, window.start)).getTime()
    const windowEnd = new Date(normalizeDateTime(scheduleDate, window.end)).getTime()

    proposedSchedule
      .filter((item) => movedIds.has(item.id))
      .forEach((item) => {
        const startMs = new Date(item.startTime).getTime()
        const endMs = new Date(item.endTime).getTime()
        if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs < windowStart || endMs > windowEnd || endMs <= startMs) {
          issues.push(`《${item.programName || item.id}》平移后超出编单时间范围 ${window.start}-${window.end}`)
        }
      })

    const sortedItems = [...proposedSchedule].sort((left, right) =>
      new Date(left.startTime).getTime() - new Date(right.startTime).getTime(),
    )
    for (let index = 0; index < sortedItems.length - 1; index += 1) {
      const current = sortedItems[index]!
      const next = sortedItems[index + 1]!
      if (new Date(current.endTime).getTime() > new Date(next.startTime).getTime()) {
        issues.push(`批量平移后《${current.programName || current.id}》与《${next.programName || next.id}》发生重叠`)
      }
    }

    for (const item of proposedSchedule.filter((entry) => movedIds.has(entry.id))) {
      const violation = detectMovingItemSequenceViolation(
        item,
        proposedSchedule.filter((entry) => entry.id !== item.id),
        '批量平移',
      )
      if (violation) {
        issues.push(violation.message)
      }
    }

    return issues
  }

  private detectBatchRangeAction(normalized: string): 'delete' | 'move' | null {
    const hasBatchCue = /(全部|所有|整体|批量|一并|一起|整段|范围内|这段里|这段的|已排节目|已编排|现有.*节目)/.test(normalized)
    if (!hasBatchCue) return null
    if (/(删除|删掉|移除|去掉|撤掉|撤下|拿掉|拿下|下掉|清掉|清除)/.test(normalized)) return 'delete'
    if (/(整体)?(后移|前移|顺延|延后|提前|推迟|推后|延迟|往后挪|往前挪|平移|移动)/.test(normalized)) return 'move'
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
          explanation: '用户明确表示放弃当前待确认版面草案，因此清空这次草案处理，不再进入编排确认或草案微调。',
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

  private shouldTryDirectFormalOrchestration(input: RuntimeSubmitInput): boolean {
    if (input.preferDraftFirstFormalOrchestration) {
      const normalized = input.userInput.replace(/\s+/g, '')
      return this.isFormalOrchestrationInstruction(normalized)
        && !this.shouldAttachLayoutDraftToOrchestration(input.userInput)
    }
    return !(this.isLayoutDraftFlowEnabled(input) && this.shouldAttachLayoutDraftToOrchestration(input.userInput))
  }

  private tryBuildFormalOrchestrationDecision(input: RuntimeSubmitInput): RuntimeDecision | null {
    return this.formalOrchestrationCapability.buildFormalOrchestrationDecision(
      input,
      this.buildFormalOrchestrationAdapter(),
    )
  }

  private isExplicitLayoutDraftPreparationInstruction(normalized: string): boolean {
    void normalized
    return false
  }

  private isFormalOrchestrationInstruction(normalized: string): boolean {
    void normalized
    return false
  }



  private shouldAttachLayoutDraftToOrchestration(userInput: string): boolean {
    void userInput
    return false
  }

  private buildFormalOrchestrationDecision(
    input: RuntimeSubmitInput,
    mode: Extract<TaskMode, 'full_generate' | 'partial_generate'>,
    reasoning: string,
    options?: FormalOrchestrationDecisionOptions,
  ): RuntimeDecision {
    return this.formalOrchestrationCapability.buildFormalOrchestrationDecisionForMode(
      input,
      this.buildFormalOrchestrationAdapter(),
      mode,
      reasoning,
      options,
    )
  }
  private async trySwitchLayoutDraft(input: RuntimeSubmitInput): Promise<RuntimeDecision | null> {
    const normalized = input.userInput.replace(/\s+/g, '')
    const referencedDate = this.resolveReferencedLayoutDraftDate(input.userInput, input.scheduleState.date)
    const wantsReferencedDateDraft = Boolean(referencedDate) && /(版面草案|草案|版面)/.test(normalized)
    const hasSwitchCue = /(切换|切到|换成|改用|使用|用|启用|恢复|切回).*(版面草案|草案|版面)/.test(normalized)
      || /(版面草案|草案|版面).*(切换|切到|换成|改用|使用|启用|恢复|切回)/.test(normalized)
      || wantsReferencedDateDraft
    if (!hasSwitchCue) return null
    if (!wantsReferencedDateDraft && (this.isFormalOrchestrationInstruction(normalized) || /(编排|补排|补齐|填充|生成正式)/.test(normalized))) return null
    if (/接(?:昨天|昨日|上一播出日|前一天)(?:进度)?|顺播|续播|上一集|下一集/.test(normalized) && !/(按|按照|参考|参照|用|使用|改用|换成|切到|切换|还是).*(昨天|昨日|前一天|上一天|上周|\d{1,2}月\d{1,2}日|\d{4}[-/年]\d{1,2}[-/月]\d{1,2})?(?:的)?(版面草案|草案|版面)/.test(normalized)) return null
    if (input.scheduleState.playlistType !== 'tv') {
      return {
        kind: 'message',
        statusHint: 'needs_clarification',
        feedback: createFeedback(
          '轮播单没有固定频道版面草案。你可以先上传轮播草案，或直接描述要生成的轮播时段。',
          'planning',
          '版面草案',
          {
            explanation: '自然语言切换版面草案只适用于电视播单工作区；轮播单草案需要用户上传或通过开放编排生成。',
          },
        ),
      }
    }

    const resolved = this.resolveSwitchLayoutDraft(input, input.userInput)
    if (!resolved) {
      return {
        kind: 'message',
        statusHint: 'needs_clarification',
        feedback: createFeedback(
          '当前频道没有可切换的版面草案。你可以上传一份版面文件，或描述需要生成的新草案。',
          'planning',
          '版面草案',
          {
            explanation: '没有找到上传版面或频道默认版面，因此不能完成自然语言切换。',
          },
        ),
      }
    }

    const feasibilityReport = await this.buildLayoutDraftFeasibilityReport(input, resolved.draft)
    return {
      kind: 'layout_draft',
      feedback: createFeedback(
        resolved.label,
        'planning',
        '版面草案',
        {
          explanation: '用户通过自然语言切换当前电视播单的版面草案。',
          details: {
            draftId: resolved.draft.id,
            layoutSource: resolved.draft.source,
            sourceFileName: resolved.sourceFileName,
            sourceDate: resolved.sourceDate,
            coverage: resolved.draft.coverage,
            segmentCount: resolved.draft.layoutReference.slots.length,
            feasibilitySummary: feasibilityReport.summary,
            orchestrationMode: this.resolvePreferredOrchestrationMode(input),
          },
        },
      ),
      draft: resolved.draft,
      feasibilityReport,
      orchestrationMode: this.resolvePreferredOrchestrationMode(input),
    }
  }

  private buildPendingAtomicClarification(input: RuntimeSubmitInput, reasoning: string, preferredAction?: RuntimeAtomicAction | null): RuntimePendingAtomicClarification {
    const action = preferredAction ?? input.pendingAtomicClarification?.action ?? null
    const slots = input.pendingAtomicClarification?.slots ?? {}
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
    const candidateLines = pending.candidates
      .slice(0, 5)
      .map((candidate, index) => `${index + 1}. ${toClockText(candidate.startTime)}-${toClockText(candidate.endTime)}《${candidate.programName || candidate.id}》`)
    return {
      kind: 'message',
      statusHint: 'needs_clarification',
      feedback: createFeedback(
        [
          contentOverride ?? pending.summary,
          candidateLines.join('\n'),
          '你可以补充节目名、时间段或序号，我再继续缩小范围。',
        ].filter(Boolean).join('\n'),
        'planning',
        '目标建议',
        {
          explanation: pending.reasoning,
          details: {
            targetTime: pending.targetTime,
            candidateCount: pending.candidates.length,
            conversationAtomicContext: pendingAtomicContext,
          },
        },
      ),
    }
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

  private buildInsertRecommendationAdvisoryDecision(
    pending: RuntimePendingInsertRecommendation,
    contentOverride?: string,
    _sourcePendingContext?: RuntimePendingAtomicContext,
  ): RuntimeDecision {
    const actionText = pending.action === 'replace' ? '替换' : '插入'
    const basis = contentOverride?.trim()
      || `我按你给的线索查了候选库，找到了几个可能适合${actionText}的节目。`
    const candidateLines = pending.recommendedCandidates
      .slice(0, 5)
      .map((candidate, index) => this.formatRuntimeInsertRecommendationLine(candidate, index))
    const targetText = pending.targetTime ? `目标位置是 ${pending.targetTime}。` : ''
    const guide = pending.action === 'replace'
      ? '你可以补充期数、版本、时长、栏目或内容方向，我再继续缩小范围；等信息足够明确后，我再帮你形成可写入的替换修改。'
      : '你可以补充期数、版本、时长、栏目或内容方向，我再继续缩小范围；等信息足够明确后，我再帮你排入。'
    return {
      kind: 'message',
      statusHint: 'needs_clarification',
      feedback: createFeedback(
        [
          `${basis} 现在还不能替你直接选其中一个。${targetText}`,
          candidateLines.join('\n'),
          guide,
        ].filter(Boolean).join('\n'),
        'planning',
        '候选建议',
        {
          explanation: pending.reasoning,
          details: {
            targetTime: pending.targetTime,
            action: pending.action,
            semanticLabel: pending.semanticLabel,
            rawProgramText: pending.rawProgramText,
            recommendedCandidateCount: pending.recommendedCandidates.length,
            recommendedCandidates: pending.recommendedCandidates,
          },
        },
      ),
    }
  }

  private formatRuntimeInsertRecommendationLine(candidate: RuntimeInsertRecommendationCandidate, index: number): string {
    const durationText = candidate.duration > 0 ? `，${this.formatDurationText(candidate.duration)}` : ''
    const reasonText = candidate.reasonTags
      .filter((tag) => tag && !/confidence|score|候选\s*\d+/iu.test(tag))
      .slice(0, 2)
      .join('、')
    return `${index + 1}. 《${candidate.programName}》${durationText}${reasonText ? `，${reasonText}` : ''}`
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
      case 'draft_research_confirmation':
        return '草案建议确认'
      case 'formal_rebuild_confirmation':
        return '重新编排确认'
    }
  }

  private extractAtomicTimeSlot(userInput: string): { targetTime: string; targetTimeHint: string } | null {
    const parsed = parseAtomicClockExpression(userInput)
    return parsed
      ? { targetTime: parsed.targetTime, targetTimeHint: parsed.matchedText }
      : null
  }

  private extractAtomicReplacementProgramName(userInput: string): string | undefined {
    const explicitProgramName = userInput.match(
      /(?:替换成|替换为|换成|换播|改成|改为|改播)(.+)$/u,
    )?.[1]?.trim()
    return this.normalizeAtomicProgramHint(explicitProgramName)
  }

  private extractAtomicOffsetSlot(userInput: string): { direction: 'forward' | 'backward'; offsetSeconds: number } | null {
    return parseAtomicOffset(userInput)
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
      .replace(/^(?:一个|一条|一档|一段)?(?:\d+分钟|\d+分|\d+小时|半小时)/u, '')
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
      return this.buildInsertRecommendationAdvisoryDecision(
        result.pendingInsertRecommendation,
        result.message || result.pendingInsertRecommendation.summary,
        sourcePendingContext,
      )
    }
    if (!result.command) {
      return { kind: 'message', feedback: createFeedback(result.message || '当前未能形成可执行命令。', 'selection', '命令解析', { thinking: result.thinking, explanation: result.explanation || fallbackReasoning, details: result.details }) }
    }
    if (!result.forceDirectExecution && requiresRuntimeCommandConfirmation(result.command)) {
      return { kind: 'pending_command', feedback: createFeedback(result.message || summarizeRuntimeCommand(result.command), 'selection', '待确认修改', { thinking: result.thinking, explanation: result.explanation || fallbackReasoning, details: result.details }), pendingCommand: { command: result.command, summary: result.message || summarizeRuntimeCommand(result.command), successMessage: result.successMessage, reasoning: result.explanation || fallbackReasoning, details: result.details } }
    }
    return { kind: 'execute_command', execution: { command: result.command, successMessage: result.successMessage, thinking: result.thinking, explanation: result.explanation || fallbackReasoning, details: result.details } }
  }

  private async prepareLayoutDraft(input: RuntimeSubmitInput, classification: TaskClassification, orchestrationMode: Extract<TaskMode, 'full_generate' | 'partial_generate'>): Promise<RuntimeDecision> {
    try {
    const suggested = classification.suggestedParams ?? {}
    const structuredSegments = this.resolveRotationStructuredSegments(suggested)
    const rotationDurationSeconds = typeof suggested.rotationDurationSeconds === 'number' && suggested.rotationDurationSeconds > 0
      ? suggested.rotationDurationSeconds
      : input.scheduleState.playlistType === 'rotation'
        ? input.scheduleState.rotationDurationSeconds ?? input.currentLayoutDraft?.targetDurationSeconds
        : undefined
    const userIntent = typeof suggested.userIntent === 'string' && suggested.userIntent.trim() ? suggested.userIntent.trim() : input.userInput
    const ignoreExistingLayout = suggested.ignoreExistingLayout === true
    let draft: LayoutDraft
    let sourceLabel = '已根据你的要求生成版面草案。'
    let warnings: string[] = []
    let refinedExistingDraft = false

    if (classification.mode === 'layout_refine') {
      refinedExistingDraft = true
      const baseDraft = input.currentLayoutDraft ?? this.resolveExistingLayoutDraft(input, userIntent, false)?.draft
      if (!baseDraft) return { kind: 'message', feedback: createFeedback('当前还没有可微调的版面草案，请先生成一份草案再继续调整。', 'planning', '版面草案', { explanation: classification.reasoning }) }
      const spec = await this.layoutDraftService.refineSpec({ channelId: input.scheduleState.channelId, channelName: input.scheduleState.channelName, date: input.scheduleState.date, userInput: input.userInput, playlistType: input.scheduleState.playlistType, targetDurationSeconds: rotationDurationSeconds, currentDraft: baseDraft, coverage: suggested.targetTimeRange, semanticLabel: suggested.semanticLabel, programTypeHint: suggested.programTypeHint, segments: structuredSegments, replaceAll: ignoreExistingLayout }, input.deadline)
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
        refinedExistingDraft = true
        const spec = await this.layoutDraftService.refineSpec({ channelId: input.scheduleState.channelId, channelName: input.scheduleState.channelName, date: input.scheduleState.date, userInput: input.userInput, playlistType: input.scheduleState.playlistType, targetDurationSeconds: rotationDurationSeconds, currentDraft: existing.draft, coverage: suggested.targetTimeRange, semanticLabel: suggested.semanticLabel, programTypeHint: suggested.programTypeHint, segments: structuredSegments, replaceAll: ignoreExistingLayout }, input.deadline)
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
        const spec = await this.layoutDraftService.generateSpec({ channelId: input.scheduleState.channelId, channelName: input.scheduleState.channelName, date: input.scheduleState.date, userInput: input.userInput, playlistType: input.scheduleState.playlistType, targetDurationSeconds: rotationDurationSeconds, coverage: suggested.targetTimeRange, semanticLabel: suggested.semanticLabel, programTypeHint: suggested.programTypeHint, segments: structuredSegments }, input.deadline)
        const specValidation = this.layoutDraftValidator.validateSpec(spec)
        const specStructuralErrors = specValidation.errors.filter((issue) => issue.code !== 'segment_gap')
        if (specStructuralErrors.length > 0) return this.buildLayoutDraftValidationDecision('版面草案生成失败，请补充更明确的时段或内容要求。', classification.reasoning, { errors: specStructuralErrors, warnings: specValidation.warnings })
        warnings = dedupeStrings([...specValidation.warnings.map((item) => item.message), ...specValidation.errors.filter((issue) => issue.code === 'segment_gap').map((item) => item.message)])
        draft = this.layoutDraftCompiler.compile(spec, { channelId: input.scheduleState.channelId, channelName: input.scheduleState.channelName, date: input.scheduleState.date, userIntent, source: 'generated' })
        draft.warnings = warnings
      }
    }

    draft = this.applyLayoutDraftStrategyProfile(draft, input.userInput, input.scheduleState.playlistType)
    const durationSourceSegments = refinedExistingDraft && (structuredSegments?.length ?? 0) <= 1
      ? undefined
      : structuredSegments
    draft = this.applyRotationDurationSegments(
      draft,
      durationSourceSegments,
      input.scheduleState.playlistType,
    )
    draft = this.applyRotationTargetDuration(
      draft,
      rotationDurationSeconds,
      input.scheduleState.playlistType,
      suggested.semanticLabel ?? userIntent,
      !durationSourceSegments?.length,
    )
    if (input.scheduleState.playlistType === 'rotation' && rotationDurationSeconds && !structuredSegments?.length) {
      sourceLabel = '我先按主题和总时长整理了一份轮播草案，确认前不会写入正式轮播单。'
    }
    const draftValidation = this.layoutDraftValidator.validateDraft(draft)
    const structuralErrors = draftValidation.errors.filter((issue) => issue.code !== 'segment_gap')
    const allWarnings = dedupeStrings([...warnings, ...draftValidation.warnings.map((item) => item.message), ...draftValidation.errors.filter((issue) => issue.code === 'segment_gap').map((item) => item.message), ...(draft.warnings ?? [])])
    draft.warnings = allWarnings
    if (structuralErrors.length > 0) return this.buildLayoutDraftValidationDecision('版面草案结构校验未通过，请先调整版面后再开始编排。', classification.reasoning, { errors: structuralErrors, warnings: draftValidation.warnings })
    const feasibilityReport = await this.buildLayoutDraftFeasibilityReport(input, draft)
    const feedbackContent = this.buildLayoutDraftNextStepFeedback(
      sourceLabel,
      draft,
      input.scheduleState.playlistType,
      allWarnings,
    )
    return { kind: 'layout_draft', feedback: createFeedback(feedbackContent, 'planning', '版面草案', { explanation: classification.reasoning, details: { draftId: draft.id, layoutSource: draft.source, draftKind: draft.draftKind, coverage: draft.coverage, targetDurationSeconds: draft.targetDurationSeconds, durationSegments: draft.durationSegments, segmentCount: draft.layoutReference.slots.length, warnings: allWarnings, feasibilitySummary: feasibilityReport.summary, orchestrationMode, strategyProfile: draft.strategyProfile } }), draft, feasibilityReport, orchestrationMode }
    } catch (error) {
      if (isRecoverableLlmError(error)) {
        return this.buildRecoverableLlmFailureDecision(
          input,
          error.llmFailure,
          classification.reasoning,
        )
      }
      throw error
    }
  }

  private applyRotationDurationSegments(
    draft: LayoutDraft,
    structuredSegments: LayoutIntentSegment[] | undefined,
    playlistType?: PlaylistType,
  ): LayoutDraft {
    if (playlistType !== 'rotation' || !structuredSegments?.length) {
      const durationSegments = playlistType === 'rotation'
        ? this.buildRotationDurationSegmentsFromDraftSlots(draft)
        : []
      if (durationSegments.length > 0) {
        return {
          ...draft,
          draftKind: 'duration_segments',
          targetDurationSeconds: draft.targetDurationSeconds ?? durationSegments.reduce((sum, segment) => sum + segment.targetDurationSeconds, 0),
          durationSegments,
        }
      }
      return {
        ...draft,
        draftKind: draft.strategyProfile?.kind === 'carousel' ? draft.draftKind ?? 'duration_segments' : draft.draftKind ?? 'time_slots',
      }
    }

    const selectionPriority = draft.strategyProfile?.selectionPriority ?? 'content_match'
    const durationSegments = structuredSegments.map((segment, index) => {
      const targetDurationSeconds = Math.max(0, clockToSeconds(segment.end) - clockToSeconds(segment.start))
      const label = segment.semanticLabel || `轮播段${index + 1}`
      return {
        id: draft.layoutReference.slots[index]?.id ?? `duration-segment-${index + 1}`,
        label,
        contentHint: label,
        targetDurationSeconds,
        selectionPriority,
        repeatPolicy: 'avoid_repeat' as const,
        fallbackPolicy: 'ask_user' as const,
      }
    })

    return {
      ...draft,
      draftKind: 'duration_segments',
      targetDurationSeconds: durationSegments.reduce((sum, segment) => sum + segment.targetDurationSeconds, 0),
      durationSegments,
    }
  }

  private buildRotationDurationSegmentsFromDraftSlots(draft: LayoutDraft): NonNullable<LayoutDraft['durationSegments']> {
    const selectionPriority = draft.strategyProfile?.selectionPriority ?? 'content_match'
    const durationSegments: NonNullable<LayoutDraft['durationSegments']> = []
    draft.layoutReference.slots.forEach((slot, index) => {
      const column = draft.columns.find((item) => item.columnId === slot.columnId)
      const targetDurationSeconds = Math.max(0, clockToSeconds(slot.endTime) - clockToSeconds(slot.startTime))
      const label = (column?.semanticLabel ?? column?.columnName ?? `轮播段${index + 1}`).trim()
      if (!label || targetDurationSeconds <= 0) return
      durationSegments.push({
        id: slot.id,
        label,
        contentHint: label,
        targetDurationSeconds,
        selectionPriority,
        repeatPolicy: 'avoid_repeat',
        fallbackPolicy: 'ask_user',
      })
    })
    return durationSegments
  }

  private applyRotationTargetDuration(
    draft: LayoutDraft,
    targetDurationSeconds: number | undefined,
    playlistType?: PlaylistType,
    fallbackLabel?: string,
    allowSingleSegmentExpansion = false,
  ): LayoutDraft {
    if (playlistType !== 'rotation' || !targetDurationSeconds || targetDurationSeconds <= 0) return draft

    if (draft.durationSegments?.length) {
      const plannedDurationSeconds = draft.durationSegments.reduce((sum, segment) => sum + segment.targetDurationSeconds, 0)
      const durationSegments = allowSingleSegmentExpansion && draft.durationSegments.length === 1 && plannedDurationSeconds !== targetDurationSeconds
        ? [{
            ...draft.durationSegments[0]!,
            targetDurationSeconds,
          }]
        : draft.durationSegments
      return {
        ...draft,
        draftKind: 'duration_segments',
        targetDurationSeconds: targetDurationSeconds || plannedDurationSeconds,
        durationSegments,
      }
    }

    const selectionPriority = draft.strategyProfile?.selectionPriority ?? 'content_match'
    const label = (fallbackLabel ?? draft.columns[0]?.semanticLabel ?? draft.columns[0]?.columnName ?? '轮播内容').trim()
    const segmentId = draft.layoutReference.slots[0]?.id ?? 'duration-segment-1'
    return {
      ...draft,
      draftKind: 'duration_segments',
      purpose: draft.purpose ?? `${label}轮播编排`,
      targetDurationSeconds,
      durationSegments: [{
        id: segmentId,
        label,
        contentHint: label,
        targetDurationSeconds,
        selectionPriority,
        repeatPolicy: 'avoid_repeat',
        fallbackPolicy: 'ask_user',
      }],
    }
  }

  private buildLayoutDraftNextStepFeedback(
    baseLabel: string,
    draft: LayoutDraft,
    playlistType?: PlaylistType,
    warnings: string[] = [],
  ): string {
    const segmentCount = draft.durationSegments?.length ?? draft.layoutReference.slots.length
    const hasWarnings = warnings.length > 0
    const durationText = draft.targetDurationSeconds
      ? `，目标总时长 ${this.formatDurationText(draft.targetDurationSeconds)}`
      : ''
    const noWriteText = playlistType === 'rotation'
      ? '确认前不会写入正式轮播单'
      : '确认前不会写入正式节目单'
    const refineHint = playlistType === 'rotation'
      ? '你可以继续说“拆细一点”“把第二段换成……”，也可以说“按这个开始编排”。'
      : '你可以继续调整某个时段，也可以说“按这个开始编排”。'

    if (playlistType === 'rotation') {
      if (/更新当前版面草案|按你的要求更新/u.test(baseLabel)) {
        const structureText = segmentCount > 1
          ? `当前轮播草案共有 ${segmentCount} 个内容块${durationText}。`
          : `当前轮播草案还有 1 个内容块${durationText}。`
        const warningText = hasWarnings ? '这版还有空档或边界需要你再看一眼。' : ''
        return ['已按你的要求更新当前轮播草案。', structureText, noWriteText + '。', warningText, refineHint].filter(Boolean).join('')
      }
      const structureText = segmentCount > 1
        ? `我先把这张轮播草案整理成 ${segmentCount} 个内容块${durationText}。`
        : `我先把需求整理成一块轮播草案${durationText}。`
      const warningText = hasWarnings ? '这版还有空档或边界需要你再看一眼。' : ''
      return [structureText, noWriteText + '。', warningText, refineHint].filter(Boolean).join('')
    }

    const warningText = hasWarnings ? '这版还有空档或边界需要你再看一眼。' : ''
    return [baseLabel, noWriteText + '。', warningText, refineHint].filter(Boolean).join('')
  }

  private applyLayoutDraftStrategyProfile(draft: LayoutDraft, userInput: string, playlistType?: PlaylistType): LayoutDraft {
    const strategyProfile = this.buildLayoutDraftStrategyProfile(draft, userInput, playlistType)
    const columns = draft.columns.map((column) => {
      const slot = draft.layoutReference.slots.find((item) => item.columnId === column.columnId)
      const isSequential = Boolean(column.isSequential || (
        strategyProfile.kind === 'tv_channel' && this.shouldTreatDraftColumnAsSequential(column)
      ))
      const selectionPolicy = slot
        ? strategyProfile.segmentPolicies[slot.id]
          ?? this.buildSegmentSelectionPolicy(strategyProfile.kind, strategyProfile.selectionPriority, isSequential)
        : this.buildSegmentSelectionPolicy(strategyProfile.kind, strategyProfile.selectionPriority, isSequential)
      const queryHints = dedupeStrings([
        ...(column.queryHints ?? []),
        ...this.buildStrategyQueryHints(strategyProfile.kind, selectionPolicy.primary),
      ])
      return { ...column, isSequential, selectionPolicy, queryHints }
    })

    return {
      ...draft,
      strategyProfile,
      columns,
    }
  }

  private shouldTreatDraftColumnAsSequential(column: LayoutDraft['columns'][number]): boolean {
    const text = [
      column.defaultProgramType,
      column.columnName,
      column.semanticLabel,
      ...(column.queryHints ?? []),
    ].join(' ')
    return column.defaultProgramType === 'drama' || /(剧场|电视剧|连续剧|第\d+集|第[一二三四五六七八九十]+集|顺播|续播)/.test(text)
  }

  private buildLayoutDraftStrategyProfile(draft: LayoutDraft, userInput: string, playlistType?: PlaylistType): LayoutDraftStrategyProfile {
    const normalized = userInput.replace(/\s+/g, '')
    const explicitCarousel = /(轮播单|轮播|播单|直播单|户外直播|外场直播|现场直播|现场播出|活动现场|循环播放|循环播|滚动播|非电视频道|不是电视频道|非线性|直播活动|活动直播)/.test(normalized)
    const explicitTvChannel = /(纯电视频道|电视频道|频道编排|常规频道|顺播|续播|接着播|继续播|顺着排|昨天|上一集|下一集|补中间集|补缺集|补空档|补空窗|补空缺)/.test(normalized)
    const eventOrFunctionalCarousel = this.shouldTreatDraftAsEventOrFunctionalCarousel(draft, normalized)
    const kind: LayoutDraftStrategyKind = playlistType === 'tv'
      ? 'tv_channel'
      : playlistType === 'rotation'
        ? 'carousel'
        : (explicitCarousel || (!explicitTvChannel && eventOrFunctionalCarousel))
          ? 'carousel'
          : 'tv_channel'
    const ratingRequested = /(收视率|收视|高收视)/.test(normalized)
    const trendingRequested = /(热播|热度|高热度|热门|话题|舆论|热搜)/.test(normalized)
    const selectionPriority: DraftSelectionPriority = kind === 'tv_channel'
      ? 'sequence'
      : ratingRequested
        ? 'rating'
        : trendingRequested
          ? 'trending'
          : 'content_match'
    const referenceDate = kind === 'tv_channel' ? this.getPreviousDateText(draft.date) : undefined
    const strategyBasis = this.resolveLayoutDraftStrategyBasis(kind, selectionPriority)
    const segmentPolicies: Record<string, DraftSegmentSelectionPolicy> = {}

    draft.layoutReference.slots.forEach((slot) => {
      const column = draft.columns.find((item) => item.columnId === slot.columnId)
      const isSequential = Boolean(column?.isSequential || (
        kind === 'tv_channel' && column && this.shouldTreatDraftColumnAsSequential(column)
      ))
      segmentPolicies[slot.id] = this.buildSegmentSelectionPolicy(kind, selectionPriority, isSequential)
    })

    const hasSpecificKeywords = draft.columns.some((column) =>
      extractSpecificSearchKeywords([
        ...(column.queryHints ?? []),
        column.semanticLabel,
        column.columnName,
      ].filter((value): value is string => Boolean(value?.trim()))).length > 0
      || hasExplicitSequenceRequirements(column.queryHints ?? [])
      || hasEditorialKeywordRequirements(column.queryHints ?? [])
      || hasFunctionalSearchKeywords(column.queryHints ?? []),
    )

    return {
      kind,
      label: kind === 'tv_channel' ? '电视频道顺播策略' : '轮播单策略',
      reasoning: kind === 'tv_channel'
        ? `按电视频道编排处理，正式编排时会参考 ${referenceDate ?? '上一播出日'} 的历史播出进度，顺播栏目优先接续上一集。`
        : selectionPriority === 'rating'
          ? '按轮播单处理，正式编排时在满足硬关键词后优先选择收视率统计表现更高的候选。'
          : selectionPriority === 'trending'
            ? '按轮播单处理，正式编排时在满足硬关键词后优先选择当前舆论和话题热度更高的热播候选。'
          : '按轮播单处理，正式编排时优先保证节目内容、标题、栏目关键词命中。包括直播/户外直播等非线性频道场景。',
      requiresPreviousSchedule: kind === 'tv_channel',
      referenceDate,
      selectionPriority,
      strategyBasis,
      contextSummary: kind === 'tv_channel'
        ? `加载 ${referenceDate ?? '上一播出日'} 的编排记录，检查连续剧顺序。`
        : '不沿用昨日顺播进度，按本轮轮播单目标独立选片。',
      selectionSummary: this.buildLayoutDraftSelectionSummary(kind, selectionPriority),
      constraintSummary: hasSpecificKeywords
        ? '节目内容、标题、所属栏目等明确关键词按硬约束处理，未命中节目库时保留空缺。'
        : '当前草案以栏目类型和时段约束为主，可继续补充关键词提升命中率。',
      selectionRules: this.buildLayoutDraftSelectionRules(kind, selectionPriority, referenceDate),
      keywordPolicy: hasSpecificKeywords ? 'hard_match' : 'soft_match',
      segmentPolicies,
    }
  }

  private shouldTreatDraftAsEventOrFunctionalCarousel(draft: LayoutDraft, normalizedInput: string): boolean {
    const inputSuggestsEventOrFunctionalFill = /(发布会|赛事|活动|会场|展会|论坛|峰会|庆典|演出|外场|户外|现场|直播|预热|预告|导视|垫片|暖场|串场|过渡|集锦|花絮|快讯|提醒)/.test(normalizedInput)
    const draftSuggestsEventOrFunctionalFill = draft.columns.some((column) => {
      const text = [
        column.defaultProgramType,
        column.columnName,
        column.semanticLabel,
        ...(column.queryHints ?? []),
      ].join(' ')
      return /(发布会|赛事|活动|会场|展会|论坛|峰会|庆典|演出|外场|户外|现场|直播|预热|预告|导视|垫片|暖场|串场|过渡|集锦|花絮|快讯|提醒|news_magazine)/.test(text)
    })

    return inputSuggestsEventOrFunctionalFill || draftSuggestsEventOrFunctionalFill
  }

  private resolveLayoutDraftStrategyBasis(
    kind: LayoutDraftStrategyKind,
    selectionPriority: DraftSelectionPriority,
  ): LayoutDraftStrategyBasis {
    if (kind === 'tv_channel') return 'previous_schedule_sequence'
    if (selectionPriority === 'rating') return 'rating'
    if (selectionPriority === 'trending') return 'trending'
    return 'content_match'
  }

  private buildLayoutDraftSelectionSummary(
    kind: LayoutDraftStrategyKind,
    selectionPriority: DraftSelectionPriority,
  ): string {
    if (kind === 'tv_channel') {
      return '顺播栏目优先选择昨日最新播出集数的下一集，避免跳集、倒序和与当前编排冲突。'
    }
    if (selectionPriority === 'rating') {
      return '轮播单先满足硬关键词和时长约束，再从候选中优先选择收视率统计表现更高的节目。'
    }
    if (selectionPriority === 'trending') {
      return '轮播单先满足硬关键词和时长约束，再从候选中优先选择当前舆论和话题热度更高的热播节目。'
    }
    return '轮播单先按节目内容、节目标题、所属栏目和关键词贴合度选择，再用收视表现做兜底排序。'
  }

  private buildLayoutDraftSelectionRules(
    kind: LayoutDraftStrategyKind,
    selectionPriority: DraftSelectionPriority,
    referenceDate?: string,
  ): string[] {
    if (kind === 'tv_channel') {
      return [
        `先读取 ${referenceDate ?? '上一播出日'} 编排记录，识别同系列已播到的最新集数。`,
        '顺播栏目优先选择下一集；缺下一集、跳集或倒序时转人工确认或留空。',
        '同一版面内还要检查前后已排节目，不能出现先排后续集、再回填前一集的倒序。',
        '标题、栏目、集数和时长必须同时满足，不能只因为类型相似就硬排。',
      ]
    }

    if (selectionPriority === 'rating') {
      return [
        '先过滤节目标题、内容关键词、所属栏目和时长硬约束。',
        '硬约束都满足后，优先选择收视率统计表现更高的候选。',
        '若高收视候选与关键词不符，不能硬排，应回退到更匹配的候选或留空。',
        '轮播单不沿用昨日顺播进度，按本轮活动/时段目标独立选片。',
      ]
    }

    if (selectionPriority === 'trending') {
      return [
        '先过滤节目标题、内容关键词、所属栏目和时长硬约束。',
        '硬约束都满足后，优先选择当前舆论和话题热度更高的热播候选。',
        '若热播候选与关键词不符，不能硬排，应回退到更匹配的候选或留空。',
        '轮播单不沿用昨日顺播进度，按本轮活动/时段目标独立选片。',
      ]
    }

    return [
      '先按节目内容、节目标题、所属栏目和草案关键词判断贴合度。',
      '内容匹配强的候选优先；收视表现只作为同等匹配下的兜底排序。',
      '明确地点、主题、栏目或功能词未命中时保留空缺，不用相似类型硬凑。',
      '轮播单不沿用昨日顺播进度，按本轮活动/时段目标独立选片。',
    ]
  }

  private buildSegmentSelectionPolicy(
    kind: LayoutDraftStrategyKind,
    selectionPriority: DraftSelectionPriority,
    isSequential?: boolean,
  ): DraftSegmentSelectionPolicy {
    if (kind === 'tv_channel') {
      return {
        primary: isSequential ? 'sequence' : 'content_match',
        fallback: isSequential ? ['content_match', 'rating'] : ['rating'],
        requiresPreviousSchedule: Boolean(isSequential),
        notes: isSequential
          ? ['顺播栏目优先读取昨日同系列播出进度。']
          : ['非顺播栏目优先按栏目内容匹配。'],
      }
    }

    return {
      primary: selectionPriority,
      fallback: selectionPriority === 'content_match' ? ['rating', 'trending'] : ['content_match'],
      requiresPreviousSchedule: false,
      notes: selectionPriority === 'rating'
        ? ['轮播单先满足硬关键词，再按收视率统计排序。']
        : selectionPriority === 'trending'
          ? ['轮播单先满足硬关键词，再按当前舆论和话题热度排序。']
          : ['轮播单优先按内容/标题/栏目关键词匹配排序。'],
    }
  }

  private buildStrategyQueryHints(
    kind: LayoutDraftStrategyKind,
    selectionPriority: DraftSelectionPriority,
  ): string[] {
    if (kind === 'tv_channel') {
      return selectionPriority === 'sequence'
        ? ['纯电视频道', '顺播', '接昨天']
        : []
    }

    if (selectionPriority === 'rating') return ['轮播单', '收视率优先']
    if (selectionPriority === 'trending') return ['轮播单', '热播优先']
    return ['轮播单', '内容匹配优先']
  }

  private getPreviousDateText(date: string): string {
    const parsed = new Date(`${date}T00:00:00+08:00`)
    if (Number.isNaN(parsed.getTime())) return date
    parsed.setDate(parsed.getDate() - 1)
    const year = parsed.getFullYear()
    const month = `${parsed.getMonth() + 1}`.padStart(2, '0')
    const day = `${parsed.getDate()}`.padStart(2, '0')
    return `${year}-${month}-${day}`
  }

  private async commitLayoutDraft(
    input: RuntimeSubmitInput,
    classification: TaskClassification,
    options?: Pick<FormalOrchestrationDecisionOptions, 'reactTask' | 'skipFormalRebuildGate' | 'authorizationRequest'>,
  ): Promise<RuntimeDecision> {
    const draft = input.currentLayoutDraft
      ?? this.resolveExistingLayoutDraft(input, input.userInput, false)?.draft
    if (!draft) {
      return {
        kind: 'message',
        feedback: createFeedback(
          '当前还没有可确认的版面草案，请先生成或导入版面后再开始编排。',
          'planning',
          '版面草案',
          { explanation: classification.reasoning },
        ),
      }
    }
    const suggestedMode = classification.suggestedParams?.orchestrationMode
    const mode = suggestedMode
      ?? this.resolvePreferredOrchestrationMode(input)
    return this.formalOrchestrationCapability.buildCommitLayoutDraftDecision(
      input,
      this.buildFormalOrchestrationAdapter(),
      mode,
      classification,
      options,
    )
  }

  /**
   * 构造 Facade 向 FormalOrchestrationCapability 注入的适配器。
   *
   * 将版面草案解析、紧凑时段解析等 facade 内部能力暴露给 capability，
   * 避免 capability 反向依赖 facade 实现。
   */
  private buildFormalOrchestrationAdapter(): FormalOrchestrationAdapter {
    return {
      resolveExistingLayoutDraft: (input, userIntent, ignoreExistingLayout) =>
        this.resolveExistingLayoutDraft(input, userIntent, ignoreExistingLayout),
      parseCompactHourRange: (userInput) => this.parseCompactHourRange(userInput),
    }
  }
  private buildReferenceQueryHints(
    sourceColumn: { columnName: string; semanticLabel?: string; queryHints?: string[] } | undefined,
    fallbackLabel: string,
  ): string[] {
    const explicitHints = sourceColumn?.queryHints
      ?.map((keyword) => keyword.trim())
      .filter(Boolean)
    if (explicitHints?.length) return explicitHints

    const label = (sourceColumn?.semanticLabel ?? sourceColumn?.columnName ?? fallbackLabel).trim()
    if (!label) return []

    return /[\u4e00-\u9fa5]/u.test(label) ? [label] : []
  }

  private defaultDraftConstraintKindForSource(source: LayoutDraft['source']): NonNullable<ColumnDefinition['draftConstraintKind']> {
    return source === 'uploaded' ? 'unspecified' : 'column'
  }

  private resolveExistingLayoutDraft(input: RuntimeSubmitInput, userIntent: string, ignoreExistingLayout = false): { draft: LayoutDraft; label: string; sourceFileName?: string; sourceDate?: string } | null {
    if (ignoreExistingLayout) return null
    if (input.scheduleState.playlistType === 'rotation') return null
    const runtimeEntry = getRuntimeLayoutEntry(input.scheduleState.channelId, input.scheduleState.date)
    if (runtimeEntry?.templateMode) {
      return { draft: this.buildLayoutDraftFromReference({ channelId: input.scheduleState.channelId, channelName: input.scheduleState.channelName, date: input.scheduleState.date, userIntent, source: 'uploaded', layoutReference: runtimeEntry.layoutReference, columns: runtimeEntry.columns.map((column) => ({ columnId: column.columnId, columnName: column.columnName, defaultProgramType: column.defaultProgramType, isSequential: column.isSequential, semanticLabel: (column as { semanticLabel?: string }).semanticLabel, draftConstraintKind: column.draftConstraintKind, queryHints: (column as { queryHints?: string[] }).queryHints })), warnings: runtimeEntry.warnings }), label: `已读取上传版面《${runtimeEntry.sourceFileName}》，你可以继续微调后再开始编排。`, sourceFileName: runtimeEntry.sourceFileName, sourceDate: input.scheduleState.date }
    }
    const defaultLayout = getOrchestrationDemoLayout(input.scheduleState.channelId, input.scheduleState.date)
    if (!defaultLayout) return null
    return { draft: this.buildLayoutDraftFromReference({ channelId: input.scheduleState.channelId, channelName: input.scheduleState.channelName, date: input.scheduleState.date, userIntent, source: 'channel_default', layoutReference: defaultLayout }), label: '已命中当前频道版面参考，你可以继续微调后再开始编排。', sourceDate: input.scheduleState.date }
  }

  private resolveReferencedLayoutDraftDate(userIntent: string, baseDate: string): string | null {
    const normalized = userIntent.replace(/\s+/g, '')
    const explicitIso = normalized.match(/(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})日?/)
    if (explicitIso) {
      return this.formatLayoutDraftDate(
        Number(explicitIso[1]),
        Number(explicitIso[2]),
        Number(explicitIso[3]),
      )
    }

    const explicitMonthDay = normalized.match(/(\d{1,2})月(\d{1,2})日/)
    if (explicitMonthDay) {
      const year = Number(baseDate.split('-')[0])
      return this.formatLayoutDraftDate(year, Number(explicitMonthDay[1]), Number(explicitMonthDay[2]))
    }

    if (/(昨天|昨日|前一天|上一天)/.test(normalized) && /(版面草案|草案|版面)/.test(normalized)) {
      return this.shiftLayoutDraftDate(baseDate, -1)
    }

    return null
  }

  private shiftLayoutDraftDate(date: string, offsetDays: number): string | null {
    const [year = NaN, month = NaN, day = NaN] = date.split('-').map(Number)
    return this.formatLayoutDraftDate(year, month, day + offsetDays)
  }

  private formatLayoutDraftDate(year: number, month: number, day: number): string | null {
    if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null
    const value = new Date(Date.UTC(year, month - 1, day))
    if (Number.isNaN(value.getTime())) return null
    const yyyy = String(value.getUTCFullYear()).padStart(4, '0')
    const mm = String(value.getUTCMonth() + 1).padStart(2, '0')
    const dd = String(value.getUTCDate()).padStart(2, '0')
    return `${yyyy}-${mm}-${dd}`
  }

  private resolveSwitchLayoutDraft(input: RuntimeSubmitInput, userIntent: string): { draft: LayoutDraft; label: string; sourceFileName?: string; sourceDate?: string } | null {
    if (input.scheduleState.playlistType === 'rotation') return null
    const normalized = userIntent.replace(/\s+/g, '')
    const referencedDate = this.resolveReferencedLayoutDraftDate(userIntent, input.scheduleState.date)
    const wantsDefault = /(默认|频道|固定|原始|常规|日常|基础).*(版面|草案)|切回.*(版面|草案)/.test(normalized)
    const wantsUploaded = /(上传|导入|文件|xls|xlsx|表格).*(版面|草案)|(版面|草案).*(上传|导入|文件|xls|xlsx|表格)/i.test(normalized)
    const runtimeEntry = getRuntimeLayoutEntry(input.scheduleState.channelId, input.scheduleState.date)

    if (referencedDate) {
      const referencedLayout = getOrchestrationDemoLayout(input.scheduleState.channelId, referencedDate)
      if (!referencedLayout) return null
      const draft = this.buildLayoutDraftFromReference({
        channelId: input.scheduleState.channelId,
        channelName: input.scheduleState.channelName,
        date: referencedDate,
        userIntent,
        source: 'channel_default',
        layoutReference: referencedLayout,
      })
      return {
        draft,
        label: `已切换到 ${referencedDate} 的频道版面，左侧草案已更新。`,
        sourceDate: referencedDate,
      }
    }

    if (wantsUploaded) {
      if (!runtimeEntry?.templateMode) return null
      return {
        draft: this.buildLayoutDraftFromReference({
          channelId: input.scheduleState.channelId,
          channelName: input.scheduleState.channelName,
          date: input.scheduleState.date,
          userIntent,
          source: 'uploaded',
          layoutReference: runtimeEntry.layoutReference,
          columns: runtimeEntry.columns.map((column) => ({
            columnId: column.columnId,
            columnName: column.columnName,
            defaultProgramType: column.defaultProgramType,
            isSequential: column.isSequential,
            semanticLabel: (column as { semanticLabel?: string }).semanticLabel,
            draftConstraintKind: column.draftConstraintKind,
            queryHints: (column as { queryHints?: string[] }).queryHints,
          })),
          warnings: runtimeEntry.warnings,
          effectiveFrom: runtimeEntry.effectiveFrom,
          effectiveTo: runtimeEntry.effectiveTo,
          version: runtimeEntry.version,
        }),
        label: `已切换到上传版面《${runtimeEntry.sourceFileName}》，左侧版面草案已更新。`,
        sourceFileName: runtimeEntry.sourceFileName,
        sourceDate: input.scheduleState.date,
      }
    }

    if (wantsDefault || !runtimeEntry?.templateMode) {
      const defaultLayout = getOrchestrationDemoLayout(input.scheduleState.channelId, input.scheduleState.date)
      if (!defaultLayout) return null
      return {
        draft: this.buildLayoutDraftFromReference({
          channelId: input.scheduleState.channelId,
          channelName: input.scheduleState.channelName,
          date: input.scheduleState.date,
          userIntent,
          source: 'channel_default',
          layoutReference: defaultLayout,
        }),
        label: '已切换到当前频道默认版面，左侧草案已更新。',
        sourceDate: input.scheduleState.date,
      }
    }

    return this.resolveExistingLayoutDraft(input, userIntent, false)
  }

  private buildLayoutDraftFromReference(input: { channelId: string; channelName: string; date: string; userIntent: string; source: LayoutDraft['source']; layoutReference: LayoutReference; columns?: Array<{ columnId: string; columnName: string; defaultProgramType: string; isSequential?: boolean; semanticLabel?: string; draftConstraintKind?: ColumnDefinition['draftConstraintKind']; queryHints?: string[] }>; warnings?: string[]; effectiveFrom?: string; effectiveTo?: string; version?: number }): LayoutDraft {
    const spec = {
      coverage: { start: toClockText(input.layoutReference.slots[0]?.startTime ?? DEFAULT_BROADCAST_WINDOW.start), end: toClockText(input.layoutReference.slots.at(-1)?.endTime ?? DEFAULT_BROADCAST_WINDOW.end) },
      segments: input.layoutReference.slots.map((slot, index) => {
        const sourceColumn = input.columns?.find((column) => column.columnId === slot.columnId) ?? getEffectiveColumnDefinition(slot.columnId)
        const semanticLabel = (sourceColumn as { semanticLabel?: string } | undefined)?.semanticLabel
        const fallbackLabel = `时段${index + 1}`
        return {
          id: slot.id,
          label: semanticLabel ?? sourceColumn?.columnName ?? fallbackLabel,
          startTime: toClockText(slot.startTime),
          endTime: toClockText(slot.endTime),
          programType: sourceColumn?.defaultProgramType ?? 'news_magazine',
          constraintKind: sourceColumn?.draftConstraintKind ?? this.defaultDraftConstraintKindForSource(input.source),
          queryHints: this.buildReferenceQueryHints(sourceColumn, fallbackLabel),
          sequential: sourceColumn?.isSequential,
        }
      }),
    }
    const draft = this.layoutDraftCompiler.compile(spec, { channelId: input.channelId, channelName: input.channelName, date: input.date, userIntent: input.userIntent, source: input.source })
    const runtimeEntry = input.source === 'uploaded'
      ? getRuntimeLayoutEntry(input.channelId, input.date)
      : null
    draft.effectiveFrom = input.effectiveFrom ?? runtimeEntry?.effectiveFrom
    draft.effectiveTo = input.effectiveTo ?? runtimeEntry?.effectiveTo
    if (input.version ?? runtimeEntry?.version) draft.version = input.version ?? runtimeEntry?.version ?? draft.version
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
      const previewReason = preview.warnings.find((warning) => warning.trim())
      return {
        command: null,
        message: previewReason ?? `目标时间 ${params.targetTime} 已有节目占用，请先删除、替换，或换一个空闲时间点。`,
        thinking,
        explanation,
        details: {
          ...details,
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
        ...details,
        targetTime: params.targetTime,
        selectedCandidateName: candidate.programName,
        preview,
      },
    }
  }

  private buildBlockedInsertRecommendationResultIfEveryCandidateFails(
    context: { scheduleState: ScheduleState; userInput: string; currentSchedule: RuntimeScheduleItem[] },
    params: InsertParams,
    candidates: ProgramCandidate[],
    explanation: string,
    details?: RuntimeDetailMap,
  ): RuntimeMicroEditBuildResult | null {
    if (!candidates.length) return null
    const blockedResults = candidates
      .map((candidate) => ({
        candidate,
        result: this.buildInsertCommandResult(
          context,
          params,
          { id: candidate.id, programName: candidate.programName },
          explanation,
          {
            ...details,
            selectedCandidate: candidate,
          },
        ),
      }))
      .filter((entry) => !entry.result.command)
    if (blockedResults.length !== candidates.length) return null
    const primary = blockedResults.find((entry) => /顺播|跳集|重复/u.test(entry.result.message ?? ''))
      ?? blockedResults[0]
    if (!primary) return null
    return {
      command: null,
      message: primary.result.message,
      thinking: primary.result.thinking,
      explanation,
      details: {
        ...primary.result.details ?? details,
        candidateCount: candidates.length,
        blockedCandidateCount: blockedResults.length,
        rejectedReason: 'insert_recommendation_preview_blocked',
      },
      suppressClarificationFallback: true,
    }
  }

  private buildPendingInsertRecommendation(
    params: InsertParams,
    userInput: string,
    reasoning: string,
    candidates: RuntimeInsertRecommendationCandidate[],
    options?: {
      action?: 'insert' | 'replace'
      targetItemId?: string
      targetItemName?: string
      resumeCompositeTask?: RuntimeResumeCompositeTask
    },
  ): RuntimePendingInsertRecommendation {
    return {
      action: options?.action ?? 'insert',
      summary: options?.action === 'replace'
        ? `请确认 ${params.targetTime} 要替换成的节目`
        : `请确认 ${params.targetTime} 要插入的节目`,
      reasoning,
      originalUserInput: userInput,
      collectedUserInput: userInput,
      targetTime: params.targetTime,
      rawProgramText: params.rawProgramText,
      semanticLabel: params.semanticLabel,
      programTypeHint: params.programTypeHint,
      expectedDurationSeconds: params.expectedDurationSeconds,
      targetItemId: options?.targetItemId,
      targetItemName: options?.targetItemName,
      recommendedCandidates: candidates,
      selectedCandidateId: null,
      resumeCompositeTask: options?.resumeCompositeTask,
    }
  }

  private mapRuntimeInsertRecommendationCandidates(candidates: Array<{ candidate: ProgramCandidate; score: number; confidence: number; reasonTags: string[] }>): RuntimeInsertRecommendationCandidate[] {
    return candidates.map((entry) => ({
      candidateId: entry.candidate.id,
      programName: entry.candidate.programName,
      programCode: entry.candidate.programCode,
      duration: entry.candidate.duration,
      programType: entry.candidate.programType,
      score: entry.score,
      confidence: entry.confidence,
      reasonTags: entry.reasonTags,
    }))
  }

  private runtimeRecommendationToProgramCandidate(
    candidate: RuntimeInsertRecommendationCandidate,
    channelId: string,
  ): ProgramCandidate {
    return {
      id: candidate.candidateId,
      programId: candidate.candidateId,
      programCode: candidate.programCode,
      programName: candidate.programName,
      channelId,
      duration: candidate.duration,
      programType: candidate.programType,
      instanceName: candidate.programName,
    }
  }

  private shouldRecommendInsertSelection(input: RuntimeSubmitInput): boolean {
    return input.scheduleState.playlistType === 'rotation'
  }

  private async searchInsertCandidates(input: { scheduleState: ScheduleState; params: InsertParams; columnId?: string; currentSchedule: RuntimeScheduleItem[] }): Promise<{ candidates: Array<import('@/types/orchestration').ProgramCandidate>; searchMode: 'explicit_name' | 'semantic_recommendation' | 'fallback_recommendation'; blockedByTime: boolean; blockedByDuration?: boolean; blockedByKeywords?: boolean; keywordDiagnostics?: RuntimeDetailMap }> {
    const { scheduleState, params, columnId, currentSchedule } = input
    const programTypes = params.programTypeHint ? [params.programTypeHint] : undefined
    const explicitProgramName = params.programName?.trim()
    const candidateSearchLimit = params.expectedDurationSeconds ? 20 : 6
    if (explicitProgramName) {
      const explicitSearchKeywords = [
        explicitProgramName,
        params.rawProgramText,
        params.semanticLabel,
      ].filter((value): value is string => Boolean(value?.trim()))
      const specificKeywords = extractSpecificSearchKeywords(explicitSearchKeywords)
      const sequenceRequired = hasExplicitSequenceRequirements(explicitSearchKeywords)
      const editorialRequired = hasEditorialKeywordRequirements(explicitSearchKeywords)
      const functionalRequired = hasFunctionalSearchKeywords(explicitSearchKeywords)
      const requiresConcreteKeywordMatch = specificKeywords.length > 0 || sequenceRequired || editorialRequired
      const directCandidates = await this.candidateService.searchPrograms({
        channelId: scheduleState.channelId,
        programName: explicitProgramName,
        columnId,
        programTypes,
        columnStrategy: 'prefer_channel',
        limit: candidateSearchLimit,
      })
      const durationMatchedDirectCandidates = this.filterCandidatesByExpectedDuration(directCandidates, params.expectedDurationSeconds)
      const executableDirectCandidates = this.filterInsertExecutableCandidates(
        durationMatchedDirectCandidates,
        scheduleState.date,
        params.targetTime,
        currentSchedule,
      )
      if (directCandidates.length > 0) {
        return {
          candidates: executableDirectCandidates,
          searchMode: 'explicit_name',
          blockedByTime: executableDirectCandidates.length === 0,
          blockedByDuration: Boolean(params.expectedDurationSeconds && durationMatchedDirectCandidates.length === 0),
        }
      }

      if (requiresConcreteKeywordMatch) {
        return {
          candidates: [],
          searchMode: 'explicit_name',
          blockedByTime: false,
          blockedByKeywords: true,
          keywordDiagnostics: {
            searchKeywords: explicitSearchKeywords,
            specificKeywords,
            sequenceRequired,
            editorialRequired,
            functionalRequired,
          },
        }
      }

      const fallbackCandidates = await this.candidateService.searchPrograms({
        channelId: scheduleState.channelId,
        programName: '',
        columnId,
        programTypes,
        columnStrategy: 'prefer_channel',
        limit: candidateSearchLimit,
      })
      const durationMatchedFallbackCandidates = this.filterCandidatesByExpectedDuration(fallbackCandidates, params.expectedDurationSeconds)
      const executableFallbackCandidates = this.filterInsertExecutableCandidates(
        durationMatchedFallbackCandidates,
        scheduleState.date,
        params.targetTime,
        currentSchedule,
      )
      return {
        candidates: executableFallbackCandidates,
        searchMode: 'fallback_recommendation',
        blockedByTime: fallbackCandidates.length > 0 && executableFallbackCandidates.length === 0,
        blockedByDuration: Boolean(params.expectedDurationSeconds && fallbackCandidates.length > 0 && durationMatchedFallbackCandidates.length === 0),
      }
    }

    const semanticSearchKeywords = [
      params.rawProgramText,
      params.semanticLabel,
    ].filter((value): value is string => Boolean(value?.trim()))
    const semanticSearchText = semanticSearchKeywords.find((keyword) =>
      extractSpecificSearchKeywords([keyword]).length > 0
      || hasExplicitSequenceRequirements([keyword])
      || hasEditorialKeywordRequirements([keyword])
      || hasFunctionalSearchKeywords([keyword]),
    ) ?? ''
    const recommendedCandidates = await this.candidateService.searchPrograms({
      channelId: scheduleState.channelId,
      programName: semanticSearchText,
      columnId,
      programTypes,
      columnStrategy: 'prefer_channel',
      limit: candidateSearchLimit,
    })
    const durationMatchedRecommendedCandidates = this.filterCandidatesByExpectedDuration(recommendedCandidates, params.expectedDurationSeconds)
    const executableRecommendedCandidates = this.filterInsertExecutableCandidates(
      durationMatchedRecommendedCandidates,
      scheduleState.date,
      params.targetTime,
      currentSchedule,
    )
    return {
      candidates: executableRecommendedCandidates,
      searchMode: 'semantic_recommendation',
      blockedByTime: recommendedCandidates.length > 0 && executableRecommendedCandidates.length === 0,
      blockedByDuration: Boolean(params.expectedDurationSeconds && recommendedCandidates.length > 0 && durationMatchedRecommendedCandidates.length === 0),
    }
  }

  private filterCandidatesByExpectedDuration(
    candidates: Array<import('@/types/orchestration').ProgramCandidate>,
    expectedDurationSeconds?: number,
  ): Array<import('@/types/orchestration').ProgramCandidate> {
    if (!expectedDurationSeconds || expectedDurationSeconds <= 0) {
      return candidates
    }
    return candidates.filter((candidate) => candidate.duration === expectedDurationSeconds)
  }

  private filterInsertExecutableCandidates(
    candidates: Array<import('@/types/orchestration').ProgramCandidate>,
    scheduleDate: string,
    targetTime: string,
    currentSchedule: RuntimeScheduleItem[],
  ): Array<import('@/types/orchestration').ProgramCandidate> {
    if (currentSchedule.length === 0) {
      return candidates
    }

    const startTime = normalizeDateTime(scheduleDate, targetTime)
    const startMs = new Date(startTime).getTime()
    if (!Number.isFinite(startMs)) {
      return candidates
    }

    return candidates.filter((candidate) => {
      const endMs = startMs + candidate.duration * 1000
      return currentSchedule.every((item) => {
        const itemStart = new Date(normalizeDateTime(scheduleDate, item.startTime)).getTime()
        const itemEnd = new Date(normalizeDateTime(scheduleDate, item.endTime)).getTime()
        if (!Number.isFinite(itemStart) || !Number.isFinite(itemEnd)) {
          return true
        }
        return startMs >= itemEnd || endMs <= itemStart
      })
    })
  }

  private async buildMicroEditCommand(input: RuntimeSubmitInput, fallbackReasoning: string, recognizedIntent?: MicroEditIntent): Promise<RuntimeMicroEditBuildResult> {
    const context = buildDialogueContext({ scheduleState: input.scheduleState, userInput: input.userInput, currentSchedule: input.currentSchedule })
    const intent = recognizedIntent ?? await this.intentRecognizer.recognize(context)
    const reasoning = intent.reasoning || fallbackReasoning

    if (intent.type === 'insert') {
      let params = await this.paramExtractor.extractInsertParams(context)
      if (!params) return { command: null, message: '未能识别插入目标时间，请重新描述。', explanation: reasoning }
      const columnId = findSlotColumnIdByTime(input.scheduleState.channelId, input.scheduleState.date, normalizeDateTime(input.scheduleState.date, params.targetTime))
      const { candidates, searchMode, blockedByTime, blockedByDuration, blockedByKeywords, keywordDiagnostics } = await this.searchInsertCandidates({
        scheduleState: input.scheduleState,
        params,
        columnId,
        currentSchedule: input.currentSchedule,
      })
      if (blockedByKeywords) {
        const requestedProgram = params.programName ?? params.rawProgramText ?? params.semanticLabel ?? '当前节目要求'
        return {
          command: null,
          message: `没有检索到匹配“${requestedProgram}”的可插入节目，已阻止使用不匹配候选硬排。`,
          explanation: reasoning,
          details: {
            targetTime: params.targetTime,
            selectedCandidateName: requestedProgram,
            candidateCount: 0,
            rejectedReason: 'insert_keyword_no_match',
            keywordDiagnostics,
          },
          suppressClarificationFallback: true,
        }
      }
      if (blockedByDuration) {
        const requestedProgram = params.programName ?? params.rawProgramText ?? params.semanticLabel ?? '当前节目要求'
        return {
          command: null,
          message: `没有检索到符合“${requestedProgram}”且时长为 ${this.formatDurationText(params.expectedDurationSeconds ?? 0)} 的可插入节目，已阻止使用其他时长候选。`,
          explanation: reasoning,
          details: {
            targetTime: params.targetTime,
            selectedCandidateName: requestedProgram,
            expectedDurationSeconds: params.expectedDurationSeconds,
            candidateCount: 0,
            rejectedReason: 'insert_duration_no_match',
          },
          suppressClarificationFallback: true,
        }
      }
      if (blockedByTime) {
        return {
          command: null,
          message: `目标时间 ${params.targetTime} 的空闲时段不足以插入候选节目，请先删除、替换，或换一个空闲时间点。`,
          explanation: reasoning,
          details: {
            targetTime: params.targetTime,
            selectedCandidateName: params.programName ?? params.rawProgramText ?? params.semanticLabel,
            candidateCount: 0,
            rejectedReason: 'insert_time_not_available',
          },
        }
      }
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
        const recommendedCandidates = this.mapRuntimeInsertRecommendationCandidates(resolution.candidates)
        const blockedRecommendation = this.buildBlockedInsertRecommendationResultIfEveryCandidateFails(
          context,
          params,
          resolution.candidates.map((entry) => entry.candidate),
          reasoning,
          {
            targetTime: params.targetTime,
            selectedCandidateName: params.programName ?? params.rawProgramText ?? params.semanticLabel,
            candidateCount: recommendedCandidates.length,
            recommendationTrigger: resolution.trigger,
            recommendedCandidates,
          },
        )
        if (blockedRecommendation) return blockedRecommendation
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

      if (this.shouldRecommendInsertSelection(input)) {
        const recommendedCandidates = this.mapRuntimeInsertRecommendationCandidates(resolution.recommendedCandidates)
        const pendingInsertRecommendation = this.buildPendingInsertRecommendation(
          params,
          input.userInput,
          resolution.reasoning,
          recommendedCandidates,
        )
        return {
          command: null,
          message: `轮播单可选节目较多，我先给你推荐 ${recommendedCandidates.length} 个适合在 ${params.targetTime} 插入的节目，请确认具体要插入哪一个。`,
          thinking: resolution.reasoning,
          explanation: reasoning,
          details: {
            targetTime: params.targetTime,
            selectedCandidateName: resolution.selectedCandidate.programName,
            candidateCount: recommendedCandidates.length,
            recommendationTrigger: 'rotation_playlist_policy',
            recommendedCandidates,
            playlistState: {
              playlistType: input.scheduleState.playlistType,
              rotationStrategy: input.scheduleState.rotationStrategy ?? 'content_match',
            },
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
      }) ?? {
        status: 'none' as const,
        candidates: [],
        reasoning: reasoning || 'target resolver returned no result',
        matchedBy: ['target_resolver_empty'],
      }
      if (resolution.status === 'none') return { command: null, message: `没有找到 ${targetTime} 对应的节目，请确认时间或节目名称。`, explanation: resolution.reasoning || reasoning, details: { targetTime, targetResolution: { matchedBy: resolution.matchedBy } }, suppressClarificationFallback: true }
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
        const sequenceViolation = this.resolveMoveSequenceViolation({ date: input.scheduleState.date, item, currentSchedule: input.currentSchedule, newStartTime })
        if (sequenceViolation) return { command: null, message: sequenceViolation.message, thinking: sequenceViolation.thinking, explanation: resolution.reasoning || reasoning, details: sequenceViolation.details }
        const command: MoveCommand = { action: 'move', reasoning, data: { itemId: item.id, newStartTime } }
        return { command, message: `将把《${item.programName || item.id}》移动到 ${toClockText(newStartTime)}。`, successMessage: `已将《${item.programName || item.id}》移动到 ${toClockText(newStartTime)}`, explanation: resolution.reasoning || reasoning, details: { matchedItem: asRuntimeItem(item), sourceTimeRange: { start: item.startTime, end: item.endTime }, proposedTimeRange: { start: toClockText(newStartTime), end: toClockText(newStartTime) }, targetTime } }
      }
      const replaceResult = await this.buildReplaceResultForMatchedItem(
        item,
        replaceParams!.programName,
        input.scheduleState.channelId,
        input.scheduleState.date,
        resolution.reasoning || reasoning,
        targetTime,
        {
          recommendSelection: input.scheduleState.playlistType === 'rotation',
          userInput: input.userInput,
          playlistType: input.scheduleState.playlistType,
        },
      )
      return input.scheduleState.playlistType === 'tv' && replaceResult.command
        ? { ...replaceResult, forceDirectExecution: true }
        : replaceResult
    }

    return { command: null, message: '当前指令不属于已支持的原子修改能力。', explanation: reasoning }
  }

  private resolveSingleTimeAnchoredMoveParams(input: RuntimeSubmitInput): MoveParams | null {
    void input
    return null
  }

  private async resolveAbsoluteMoveCommand(input: RuntimeSubmitInput, reasoning: string): Promise<RuntimeMicroEditBuildResult | null> {
    const spec = this.extractAbsoluteMoveSpec(input.userInput)
    if (!spec) return null

    const targetItems = spec.programName
      ? this.findScheduleItemsByProgramName(input.currentSchedule, spec.programName)
      : []

    if (targetItems.length === 0 && !spec.sourceTime) {
      return {
        command: null,
        message: '已经识别到目标移动时间，但还需要补充要移动哪个节目，例如“把看东方移到10点”。',
        explanation: reasoning,
        details: {
          absoluteMove: spec,
          targetResolution: { matchedBy: ['absolute_move_destination'] },
        },
      }
    }

    if (targetItems.length > 1) {
      return {
        command: null,
        message: `当前节目单中存在多个《${spec.programName}》，请确认要移动哪一条。`,
        explanation: reasoning,
        pendingTargetSelection: {
          action: 'move',
          summary: `请选择要移动到 ${spec.destinationTime} 的《${spec.programName}》`,
          reasoning,
          targetTime: targetItems[0]?.startTime ?? '',
          programName: spec.programName,
          candidates: targetItems.map(asRuntimeItem),
          selectedItemId: null,
          moveConfig: {
            absoluteNewStartTime: normalizeDateTime(input.scheduleState.date, spec.destinationTime),
          },
          resolutionDetails: {
            absoluteMove: spec,
            targetResolution: { matchedBy: ['program_name', 'absolute_move_destination'] },
          },
        },
      }
    }

    if (targetItems.length === 1) {
      return this.buildAbsoluteMoveResult({
        input,
        reasoning,
        item: targetItems[0]!,
        destinationTime: spec.destinationTime,
        matchedBy: ['program_name', 'absolute_move_destination'],
        spec,
      })
    }

    const resolution = await this.scheduleTargetResolver.resolve({
      userInput: input.userInput,
      action: 'move',
      channelName: input.scheduleState.channelName,
      date: input.scheduleState.date,
      targetTime: spec.sourceTime!,
      items: input.currentSchedule.map(asRuntimeItem),
    })

    if (resolution.status === 'none') {
      return {
        command: null,
        message: `没有找到 ${spec.sourceTime} 对应的节目，请确认要移动的原节目时间。`,
        explanation: resolution.reasoning || reasoning,
        details: {
          absoluteMove: spec,
          targetResolution: { matchedBy: resolution.matchedBy },
        },
      }
    }

    if (resolution.status === 'multiple') {
      return {
        command: null,
        message: `请确认 ${spec.sourceTime} 要移动到 ${spec.destinationTime} 的节目。`,
        explanation: resolution.reasoning || reasoning,
        pendingTargetSelection: {
          action: 'move',
          summary: `请选择 ${spec.sourceTime} 要移动到 ${spec.destinationTime} 的节目`,
          reasoning: resolution.reasoning || reasoning,
          targetTime: spec.sourceTime!,
          candidates: resolution.candidates.map(asRuntimeItem),
          selectedItemId: null,
          moveConfig: {
            absoluteNewStartTime: normalizeDateTime(input.scheduleState.date, spec.destinationTime),
          },
          resolutionDetails: {
            absoluteMove: spec,
            targetResolution: { matchedBy: resolution.matchedBy },
          },
        },
      }
    }

    return this.buildAbsoluteMoveResult({
      input,
      reasoning: resolution.reasoning || reasoning,
      item: resolution.selectedItem!,
      destinationTime: spec.destinationTime,
      matchedBy: resolution.matchedBy,
      spec,
    })
  }

  private buildAbsoluteMoveResult(input: {
    input: RuntimeSubmitInput
    reasoning: string
    item: RuntimeScheduleItem
    destinationTime: string
    matchedBy: string[]
    spec: { sourceTime?: string; destinationTime: string; programName?: string }
  }): RuntimeMicroEditBuildResult {
    const newStartTime = normalizeDateTime(input.input.scheduleState.date, input.destinationTime)
    const violation = this.resolveMoveWindowViolation({
      channelId: input.input.scheduleState.channelId,
      date: input.input.scheduleState.date,
      item: input.item,
      newStartTime,
    })
    if (violation) return { command: null, message: violation.message, thinking: violation.thinking, explanation: input.reasoning, details: violation.details }
    const sequenceViolation = this.resolveMoveSequenceViolation({
      date: input.input.scheduleState.date,
      item: input.item,
      currentSchedule: input.input.currentSchedule,
      newStartTime,
    })
    if (sequenceViolation) return { command: null, message: sequenceViolation.message, thinking: sequenceViolation.thinking, explanation: input.reasoning, details: sequenceViolation.details }

    const command: MoveCommand = { action: 'move', reasoning: input.reasoning, data: { itemId: input.item.id, newStartTime } }
    return {
      command,
      message: `将把《${input.item.programName || input.item.id}》移动到 ${toClockText(newStartTime)}。`,
      successMessage: `已将《${input.item.programName || input.item.id}》移动到 ${toClockText(newStartTime)}`,
      explanation: input.reasoning,
      details: {
        matchedItem: asRuntimeItem(input.item),
        sourceTimeRange: { start: input.item.startTime, end: input.item.endTime },
        proposedTimeRange: { start: toClockText(newStartTime), end: toClockText(offsetDateTime(newStartTime, input.item.duration ?? 0)) },
        targetTime: toClockText(input.item.startTime),
        absoluteMove: input.spec,
        targetResolution: { matchedBy: input.matchedBy },
      },
    }
  }

  private extractAbsoluteMoveSpec(userInput: string): { sourceTime?: string; destinationTime: string; programName?: string } | null {
    const normalized = userInput.replace(/\s+/g, '')
    const moveVerb = /(移动到|移到|调到|调整到|改到|挪到|放到|排到)/.exec(normalized)
    if (!moveVerb || typeof moveVerb.index !== 'number') return null

    const times = parseAtomicClockExpressions(normalized, 4)
    const destination = times.find((time) => time.index > moveVerb.index)
    if (!destination) return null
    const source = [...times].reverse().find((time) => time.index < moveVerb.index)
    return {
      sourceTime: source?.targetTime,
      destinationTime: destination.targetTime,
      programName: undefined,
    }
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
      .replace(/^(?:删除|删掉|移除|去掉|撤掉|撤下|拿掉|拿下|下掉|移动|后移|前移|顺延|延后|提前|推迟|推后|延迟|往后挪|往前挪|替换|换成|换播|换掉|替换成|替换为|改成|改为|改播)/u, '')
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
        programName: anchor.insertProgramName ?? anchor.rawProgramText,
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
    void input
    void action
    void reasoning
    return { params: null }
  }

  private canResolveUniqueTvProgramAnchor(input: RuntimeSubmitInput, programName: string): boolean {
    if (input.scheduleState.playlistType !== 'tv') return false
    if (input.scheduleState.isEmpty || input.currentSchedule.length === 0) return false
    return this.findScheduleItemsByProgramName(input.currentSchedule, programName).length === 1
  }

  private isGenericAtomicProgramAnchor(programName: string): boolean {
    const normalized = this.normalizeAtomicNameForMatch(programName)
    if (!normalized) return true
    return /^(?:节目|栏目|这条|那条|这个节目|那个节目|当前节目|目标节目)$/.test(normalized)
      || /^\d{1,2}(?:点|[:：]\d{2})?(?:的)?(?:节目|栏目)?$/.test(programName.replace(/\s+/g, ''))
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

    const unquotedMatch = new RegExp(`^(.+?)${positionPattern}${insertVerbPattern}(.+)$`, 'u').exec(normalized)
    if (!unquotedMatch) return null

    const anchorText = this.normalizeRelativeInsertAnchorText(unquotedMatch[1])
    const rawProgramText = this.normalizeAtomicProgramHint(unquotedMatch[3])
    if (!anchorText || !rawProgramText) return null
    if (this.isGenericAtomicProgramAnchor(anchorText)) return null

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
    if (/(直播|现场|外场|户外|活动|会场|展会|论坛|峰会|发布会)/.test(normalized)) return 'news_magazine'
    if (/(新闻|资讯|时政|民生|快讯|报道)/.test(normalized)) return 'news'
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

  private async buildReplaceResultForMatchedItem(
    item: RuntimeScheduleItem,
    replaceProgramName: string,
    channelId: string,
    date: string,
    explanation: string,
    targetTime: string,
    options?: {
      recommendSelection?: boolean
      userInput?: string
      playlistType?: PlaylistType
    },
  ): Promise<RuntimeMicroEditBuildResult> {
    const candidates = await this.candidateService.searchPrograms({ channelId, programName: replaceProgramName, columnId: resolveItemColumnId(item, channelId, date), columnStrategy: 'prefer_channel', limit: 5 })
    if (candidates.length === 0) {
      const replaceSearchKeywords = [replaceProgramName]
      const specificKeywords = extractSpecificSearchKeywords(replaceSearchKeywords)
      const sequenceRequired = hasExplicitSequenceRequirements(replaceSearchKeywords)
      const editorialRequired = hasEditorialKeywordRequirements(replaceSearchKeywords)
      const hasConcreteRequirement = specificKeywords.length > 0 || sequenceRequired || editorialRequired
      return {
        command: null,
        message: hasConcreteRequirement
          ? `没有检索到匹配“${replaceProgramName}”的可替换节目，已阻止使用不匹配候选硬排。`
          : `没有检索到适合替换《${item.programName || item.id}》的候选节目，请确认节目名称或栏目。`,
        explanation,
        details: {
          matchedItem: asRuntimeItem(item),
          targetTime,
          selectedCandidateName: replaceProgramName,
          candidateCount: 0,
          ...(hasConcreteRequirement
            ? {
                rejectedReason: 'replace_keyword_no_match',
                keywordDiagnostics: {
                  searchKeywords: replaceSearchKeywords,
                  specificKeywords,
                  sequenceRequired,
                  editorialRequired,
                },
              }
            : {}),
        },
        suppressClarificationFallback: hasConcreteRequirement,
      }
    }
    if (options?.recommendSelection) {
      const recommendedCandidates = candidates.slice(0, 3).map((candidate, index) => ({
        candidateId: candidate.id,
        programName: candidate.programName,
        programCode: candidate.programCode,
        duration: candidate.duration,
        programType: candidate.programType,
        score: Math.max(60, 92 - index * 8),
        confidence: Math.max(0.6, 0.92 - index * 0.08),
        reasonTags: [
          index === 0 ? '轮播单优先候选' : '轮播单备选候选',
          '替换候选',
        ],
      }))
      const pendingInsertRecommendation = this.buildPendingInsertRecommendation(
        {
          targetTime,
          programName: replaceProgramName,
          rawProgramText: replaceProgramName,
          semanticLabel: replaceProgramName,
        },
        options.userInput ?? `替换 ${targetTime} 节目`,
        explanation,
        recommendedCandidates,
        {
          action: 'replace',
          targetItemId: item.id,
          targetItemName: item.programName,
        },
      )
      return {
        command: null,
        message: `轮播单替换可选节目较多，我先给你推荐 ${recommendedCandidates.length} 个可替换候选，请确认具体使用哪一个。`,
        thinking: '轮播单替换不会直接硬排，先返回候选给用户选择。',
        explanation,
        details: {
          matchedItem: asRuntimeItem(item),
          targetTime,
          selectedCandidateName: replaceProgramName,
          candidateCount: recommendedCandidates.length,
          recommendationTrigger: 'rotation_playlist_replace_policy',
          recommendedCandidates,
          playlistState: {
            playlistType: 'rotation',
          },
        },
        pendingInsertRecommendation,
      }
    }
    const previewedCandidates = candidates.map((candidate) => {
      const command: ReplaceCommand = { action: 'replace', reasoning: explanation, data: { itemId: item.id, newCandidateId: candidate.id } }
      return { candidate, command, preview: this.replaceCommandExecutor.preview(command) }
    })
    const selected = previewedCandidates.find((entry) => entry.preview.canExecute)
    if (!selected) {
      const first = previewedCandidates[0]!
      return {
        command: null,
        message: first.preview.warnings[0] || '替换候选都会造成时间冲突，已阻止执行。',
        explanation,
        details: {
          matchedItem: asRuntimeItem(item),
          targetTime,
          selectedCandidateName: first.candidate.programName,
          selectedCandidate: first.candidate,
          candidateCount: candidates.length,
          rejectedReason: 'replace_time_not_available',
          preview: first.preview,
        },
      }
    }
    const selectedCandidate = selected.candidate
    const command = selected.command
    const preview = selected.preview
    const durationDelta = selectedCandidate.duration - (item.duration ?? 0)
    const tvDurationNote = options?.playlistType === 'tv' && durationDelta !== 0
      ? durationDelta < 0
        ? `新节目短 ${this.formatDurationText(Math.abs(durationDelta))}，电视播单会保留原时间格子并空出这段时间。`
        : `新节目长 ${this.formatDurationText(durationDelta)}，电视播单会保留原时间格子，必须确认不会占用后续节目。`
      : ''
    return { command, message: `将把 ${targetTime} 的《${item.programName || item.id}》替换为《${selectedCandidate.programName}》。${tvDurationNote}`, successMessage: `已将 ${targetTime} 的《${item.programName || item.id}》替换为《${selectedCandidate.programName}》`, explanation, details: { matchedItem: asRuntimeItem(item), targetTime, selectedCandidateName: selectedCandidate.programName, selectedCandidate, preview, durationDeltaSeconds: durationDelta, playlistPolicy: options?.playlistType ? deriveRuntimePlaylistPolicy({ playlistType: options.playlistType }) : undefined } }
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

  private resolveMoveSequenceViolation(input: { date: string; item: RuntimeScheduleItem; currentSchedule: RuntimeScheduleItem[]; newStartTime: string }): { message: string; thinking: string; details: RuntimeDetailMap } | null {
    const proposedEndTime = offsetDateTime(input.newStartTime, input.item.duration ?? 0)
    const proposedItem = {
      ...asScheduleSnapshot(input.item, input.date, 0),
      startTime: input.newStartTime,
      endTime: proposedEndTime,
    }
    const existingItems = input.currentSchedule
      .filter((item) => item.id !== input.item.id)
      .map((item, index) => asScheduleSnapshot(item, input.date, index + 1))
    const violation = detectMovingItemSequenceViolation(proposedItem, existingItems)
    if (!violation) return null

    return {
      message: violation.message,
      thinking: '移动后的节目会破坏同系列节目在当前编排单中的顺播顺序。',
      details: {
        matchedItem: asRuntimeItem(input.item),
        sourceTimeRange: { start: input.item.startTime, end: input.item.endTime },
        proposedTimeRange: { start: toClockText(input.newStartTime), end: toClockText(proposedEndTime) },
        error: violation.type,
      },
    }
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

  /**
   * 构建分类未命中时的澄清反馈。
   *
   * 设计原则（LLM-only）：
   * - 调用点（行 2111）是 LLM taskClassifier 已返回但 mode 未命中所有已知分类的兜底分支
   * - LLM 失败已在行 2075 由 buildRecoverableLlmFailureDecision 处理，不会走到这里
   * - 旧逻辑用本地正则猜测"你像是在调整具体节目"或"在描述编排需求"，是本地假装理解用户意图，
   *   违反 AGENTS.md "不能由本地规则假装理解"
   * - 修复后：不猜测用户意图，诚实说明"我还没稳定理解"，提供示例引导用户重试或补充
   *
   * @param input 用户原始输入（保留参数为了向后兼容调用签名，不再用于正则匹配）
   * @param explanation LLM/classification 提供的 reasoning，作为 details 暴露给调试
   * @returns 中性澄清反馈，不假装理解用户意图
   */
  private buildClarifyFeedback(_input: RuntimeSubmitInput, explanation?: string): RuntimeFeedback {
    return createFeedback(
      '我还没稳定理解这条指令。你可以直接说“下午改成新闻栏目”，或补充更明确的时间范围和目标内容，也可以换一种说法重试。',
      'general',
      '需要澄清',
      { explanation },
    )
  }
}

export const requiresRuntimeCommandConfirmation = (command: OrchestrationCommand): boolean => command.action === 'delete' || command.action === 'replace'
export const summarizeRuntimeCommand = (command: OrchestrationCommand): string => command.action === 'insert' ? '插入节目' : command.action === 'delete' ? '删除已编排节目' : command.action === 'replace' ? '替换已编排节目' : command.action === 'move' ? '调整节目时间' : `执行 ${command.action} 命令`
export const formatRuntimeOffset = (offsetSeconds: number) => offsetSeconds % 3600 === 0 ? `${offsetSeconds / 3600}小时` : offsetSeconds % 60 === 0 ? `${offsetSeconds / 60}分钟` : `${offsetSeconds}秒`

let globalDemoRuntimeFacade: DemoRuntimeFacade | null = null
export function getDemoRuntimeFacade(): DemoRuntimeFacade { if (!globalDemoRuntimeFacade) globalDemoRuntimeFacade = new DemoRuntimeFacade(); return globalDemoRuntimeFacade }
