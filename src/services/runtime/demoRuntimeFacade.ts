import type { DeleteCommand, DraftFeasibilityReport, InsertCommand, LayoutDraft, LayoutReference, MoveCommand, OrchestrationCommand, ReplaceCommand, ScheduleItemSnapshot, ScheduleState, TaskClassification, TaskMode, ValidationReport } from '@/types/orchestration'
import { getLLMClient } from '@/services/llm/llmClient'
import type { LayoutIntentSegment } from '@/types/orchestration'
import type { PlaylistType, ProgramCandidate, RotationPlaylistStrategy } from '@/types/orchestration'
import type { DraftSegmentSelectionPolicy, DraftSelectionPriority, LayoutDraftStrategyBasis, LayoutDraftStrategyKind, LayoutDraftStrategyProfile } from '@/types/orchestration'
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
import { getDataService } from '@/services/orchestration/dataService'
import { extractSpecificSearchKeywords, hasEditorialKeywordRequirements, hasExplicitSequenceRequirements, hasFunctionalSearchKeywords } from '@/services/candidateKeywordMatcher'
import { getLayoutIntentRecognizer, type LayoutIntentRecognition } from '@/services/layoutIntentRecognizer'
import { getLayoutAnalysisService } from '@/services/layoutAnalysisService'
import { getAtomicCapabilities } from '@/services/atomicCapabilities'
import { parseAtomicOffset } from '@/services/atomicOffsetParser'
import { parseAtomicClockExpression, parseAtomicClockExpressions, parseAtomicTimeRange } from '@/services/atomicTimeParser'
import { SchedulingAgentRuntime, type SchedulingAgentRuntimeCapabilitySummary } from '@/services/agent/schedulingAgentRuntime'
import { RuntimeSchedulingDataGateway, type RuntimeScheduleSourceItem } from '@/services/agent/runtimeSchedulingDataGateway'
import { createRuntimeSchedulingDataReader } from '@/services/agent/runtimeSchedulingDataAdapters'
import { LlmAgentIntentInterpreter } from '@/services/agent/llmAgentIntentInterpreter'
import { buildPendingLlmContext, type AgentPendingLlmContext } from '@/services/agent/agentSession'
import type { SchedulingAgentOperationalReadinessAudit } from '@/services/agent/agentReadinessAudit'
import type { AgentPendingTask, AgentResult, AgentSubmitInput, AtomicCommandIntent } from '@/services/agent/types'
import { looksLikeProgramSchedulingRequest, parseSchedulingTimeRange } from '@/services/schedulingIntentHeuristics'
import { detectMovingItemSequenceViolation } from '@/services/scheduleSequenceGuard'
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
  type RuntimePendingAtomicPhase,
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
export interface RuntimePendingTargetSelection { action: 'delete' | 'move' | 'replace'; summary: string; reasoning: string; targetTime: string; programName?: string; candidates: RuntimeScheduleItem[]; selectedItemId: string | null; moveConfig?: { direction?: 'forward' | 'backward'; offsetSeconds?: number; absoluteNewStartTime?: string }; replaceProgramName?: string; resolutionDetails?: RuntimeDetailMap }
export interface RuntimeInsertRecommendationCandidate { candidateId: string; programName: string; programCode: string; duration: number; programType: string; score: number; confidence: number; reasonTags: string[] }
export interface RuntimePendingInsertRecommendation { action: 'insert' | 'replace'; summary: string; reasoning: string; originalUserInput: string; collectedUserInput: string; targetTime: string; rawProgramText?: string; semanticLabel?: string; programTypeHint?: string; targetItemId?: string; targetItemName?: string; recommendedCandidates: RuntimeInsertRecommendationCandidate[]; selectedCandidateId: string | null }
export interface RuntimePendingAtomicClarification { action: RuntimeAtomicAction | null; summary: string; reasoning: string; originalUserInput: string; collectedUserInput: string; targetTimeHint?: string; programNameHint?: string; slots?: Partial<RuntimeAtomicSlotBag>; missingFields: string[]; followUpQuestion: string }
export interface RuntimeExecutionPlan { command: OrchestrationCommand; successMessage?: string; thinking?: string; explanation?: string; details?: RuntimeDetailMap }
export interface RuntimeExecutedResult { success: boolean; command: OrchestrationCommand; message: string; error?: string; summary: string; thinking?: string; explanation?: string; details?: RuntimeDetailMap; data?: unknown; affectedTimeRanges?: { start: string; end: string }[]; validationReport?: ValidationReport; validationSummary?: RuntimeDetailMap }
export interface RuntimeSubmitInput { scheduleState: ScheduleState; userInput: string; currentSchedule: RuntimeScheduleItem[]; currentLayoutDraft?: LayoutDraft | null; currentLayoutDraftMode?: Extract<TaskMode, 'full_generate' | 'partial_generate'> | null; pendingTargetSelection?: RuntimePendingTargetSelection | null; pendingInsertRecommendation?: RuntimePendingInsertRecommendation | null; pendingAtomicClarification?: RuntimePendingAtomicClarification | null; pendingAtomicContext?: RuntimePendingAtomicContext | null; history?: string[]; agentCoreEnabled?: boolean; layoutDraftEnabled?: boolean }
export interface RuntimeResolveTargetSelectionInput { channelId: string; date: string; pendingTargetSelection: RuntimePendingTargetSelection; scheduleState?: ScheduleState }
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
  | { kind: 'agent_execution'; feedback: RuntimeFeedback; result: AgentResult }

type RuntimeMicroEditBuildResult = { command: OrchestrationCommand | null; message?: string; thinking?: string; explanation?: string; details?: RuntimeDetailMap; successMessage?: string; pendingTargetSelection?: RuntimePendingTargetSelection; pendingInsertRecommendation?: RuntimePendingInsertRecommendation; forceDirectExecution?: boolean; suppressClarificationFallback?: boolean }
type AgentCoreRunResult = {
  result: AgentResult
  capabilitySummary: SchedulingAgentRuntimeCapabilitySummary
  operationalReadiness: SchedulingAgentOperationalReadinessAudit
}
type RuntimePendingAtomicContinuationResult =
  | { kind: 'decision'; decision: RuntimeDecision }
  | { kind: 'clear_pending_and_continue'; input: RuntimeSubmitInput }

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
  private readonly dataService = getDataService()
  private readonly layoutAnalysisService = getLayoutAnalysisService(this.llmClient)
  private playlistDocumentSequence = 0

  private tryHandlePlaylistStateInstruction(input: RuntimeSubmitInput): RuntimeDecision | null {
    const playlistType = input.scheduleState.playlistType
    if (playlistType === undefined) return null

    const normalized = input.userInput.replace(/\s+/g, '')
    if (this.isPurePlaylistCreationInstruction(normalized, 'tv')) {
      return this.buildPlaylistStateChangedDecision(
        '已新建电视播单。后续将固定使用电视频道编排策略，非敏感原子命令在目标明确时会直接执行。',
        'tv',
        undefined,
        undefined,
        this.nextPlaylistDocumentId('tv'),
        input.scheduleState.channelId,
        input.scheduleState.channelName,
        input.scheduleState.date,
      )
    }

    if (this.isPurePlaylistCreationInstruction(normalized, 'rotation')) {
      const rotationStrategy = this.extractRotationStrategyRequest(normalized) ?? 'content_match'
      const rotationDurationSeconds = this.extractRotationDurationSeconds(normalized)
      const durationText = rotationDurationSeconds
        ? `，总时长 ${this.formatRotationDurationText(rotationDurationSeconds)}，按 0 点起算`
        : ''
      return this.buildPlaylistStateChangedDecision(
        `已新建轮播单${durationText}，${rotationStrategy === 'content_match' ? '默认按内容匹配优先选择节目' : `本次按${this.describeRotationStrategy(rotationStrategy)}选择节目`}。轮播单按时长制处理，不绑定具体日期和电视频道时段。`,
        'rotation',
        rotationStrategy,
        rotationDurationSeconds ?? undefined,
        this.nextPlaylistDocumentId('rotation'),
        undefined,
        undefined,
        undefined,
      )
    }

    const requestedRotationStrategy = this.extractRotationStrategyRequest(normalized)
    if (requestedRotationStrategy) {
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

  private buildPlaylistStateChangedDecision(
    content: string,
    playlistType: PlaylistType,
    rotationStrategy?: RotationPlaylistStrategy,
    rotationDurationSeconds?: number,
    playlistId?: string,
    channelId?: string,
    channelName?: string,
    date?: string,
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
        },
      }),
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
        '这类需求我先不在对话框里展开成长篇方案。当前可以直接告诉我具体节目、素材线索、目标位置和动作，我会按当前播单上下文继续处理插入、删除、移动、替换、查询或校验。',
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

  async submitInstruction(input: RuntimeSubmitInput): Promise<RuntimeDecision> {
    const playlistStateDecision = this.tryHandlePlaylistStateInstruction(input)
    if (playlistStateDecision) return playlistStateDecision

    if (input.pendingAtomicContext?.agentPendingTask) {
      return this.continueAgentCorePendingTask(input, input.pendingAtomicContext.agentPendingTask)
    }

    if (input.agentCoreEnabled) {
      const agentCoreDecision = await this.tryHandleAgentCoreInstruction(input)
      if (agentCoreDecision) return agentCoreDecision
    }

    const initialFastSystemClassification = this.classifyFastSystemIntent(input.userInput)
    if (initialFastSystemClassification) {
      if (initialFastSystemClassification.mode === 'validate_only') {
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

    let effectiveInput = input
    const pendingAtomicContextContinuation = await this.tryContinuePendingAtomicContext(input)
    if (pendingAtomicContextContinuation) {
      if (pendingAtomicContextContinuation.kind === 'decision') return pendingAtomicContextContinuation.decision
      effectiveInput = pendingAtomicContextContinuation.input
    }

    if (this.isLayoutDraftFlowEnabled(effectiveInput) && effectiveInput.currentLayoutDraft && this.isLayoutDraftCommitInstruction(effectiveInput.userInput)) {
      return await this.commitLayoutDraft(effectiveInput, {
        mode: 'layout_commit',
        confidence: 0.95,
        reasoning: '用户确认当前待确认版面草案，准备进入正式编排。',
      })
    }

    const pendingAtomicDecision = await this.tryContinuePendingAtomicClarification(effectiveInput)
    if (pendingAtomicDecision) return pendingAtomicDecision

    const layoutDraftClearDecision = this.isLayoutDraftFlowEnabled(effectiveInput)
      ? this.tryClearLayoutDraft(effectiveInput)
      : null
    if (layoutDraftClearDecision) return layoutDraftClearDecision

    const sequentialDurationLayoutClassification = this.tryClassifySequentialDurationLayoutInstruction(effectiveInput.userInput)
    if (sequentialDurationLayoutClassification) {
      if (!this.isLayoutDraftFlowEnabled(effectiveInput)) return this.buildLayoutDraftDisabledDecision(sequentialDurationLayoutClassification.reasoning)
      return this.prepareLayoutDraft(
        effectiveInput,
        sequentialDurationLayoutClassification,
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
    if (this.isAtomicFallbackIntent(layoutRecognition)) {
      const pendingAtomicClarification = this.buildPendingAtomicClarification(effectiveInput, layoutRecognition.reasoning)
      return this.buildPendingAtomicClarificationDecision(pendingAtomicClarification)
    }
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
      if (!this.isLayoutDraftFlowEnabled(effectiveInput)) return this.buildLayoutDraftDisabledDecision(classification.reasoning)
      return this.prepareLayoutDraft(effectiveInput, classification, classification.mode === 'full_generate' ? 'full_generate' : 'partial_generate')
    }
    return { kind: 'message', feedback: this.buildClarifyFeedback(effectiveInput, classification.reasoning || layoutRecognition?.reasoning) }
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
      return { kind: 'execute_command', execution: { command, successMessage: `已将 ${selectedItem.programName || selectedItem.id} 移动到 ${toClockText(newStartTime)}`, explanation: pendingTargetSelection.reasoning, details: { ...(pendingTargetSelection.resolutionDetails ?? {}), matchedItem: asRuntimeItem(selectedItem), sourceTimeRange: { start: selectedItem.startTime, end: selectedItem.endTime }, proposedTimeRange: { start: toClockText(newStartTime), end: toClockText(newStartTime) } } } }
    }

    if (pendingTargetSelection.action === 'delete') {
      const command: DeleteCommand = { action: 'delete', reasoning: pendingTargetSelection.reasoning, data: { itemId: selectedItem.id } }
      return { kind: 'pending_command', feedback: createFeedback(`将删除 ${selectedItem.startTime} 的《${selectedItem.programName || selectedItem.id}》。`, 'selection', '待确认修改', { explanation: pendingTargetSelection.reasoning, details: { ...(pendingTargetSelection.resolutionDetails ?? {}), matchedItem: asRuntimeItem(selectedItem), targetTime: selectedItem.startTime } }), pendingCommand: { command, summary: `删除 ${selectedItem.startTime} 的《${selectedItem.programName || selectedItem.id}》`, successMessage: `已删除 ${selectedItem.startTime} 的《${selectedItem.programName || selectedItem.id}》`, reasoning: pendingTargetSelection.reasoning, details: { ...(pendingTargetSelection.resolutionDetails ?? {}), matchedItem: asRuntimeItem(selectedItem), targetTime: selectedItem.startTime } } }
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
        thinking: '确认执行时重新检查了当前节目单，发现预演后上下文已不再满足硬约束。',
        explanation: input.pendingCommand.reasoning,
        details: {
          ...(input.pendingCommand.details ?? {}),
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
        ...(result.data ?? {}),
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
      || (/(?:\u7248\u9762|\u8349\u6848|\u65b9\u6848)/u.test(normalized) && /(?:\u6309|\u786e\u8ba4|\u78ba\u8a8d|\u5f00\u59cb|\u958b\u59cb|\u6267\u884c|\u57f7\u884c|\u53ef\u4ee5)/u.test(normalized))
  }

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

  private async tryHandleAgentCoreInstruction(input: RuntimeSubmitInput): Promise<RuntimeDecision | null> {
    if (input.currentLayoutDraft && this.shouldRouteToLayoutDraftRefine(input.userInput)) return null
    if (!this.shouldAttemptAgentCoreInstruction(input.userInput)) return null

    const agentRun = await this.runAgentCore(input)
    if (agentRun.result.status === 'needs_clarification' && !agentRun.result.decision.pendingTask && agentRun.result.decision.constraintReport?.issues[0]?.code === 'unsupported_intent') {
      return null
    }
    return this.buildAgentCoreDecision(input, agentRun)
  }

  private async continueAgentCorePendingTask(input: RuntimeSubmitInput, pendingTask: AgentPendingTask): Promise<RuntimeDecision> {
    const agentRun = await this.runAgentCore(input, pendingTask)
    return this.buildAgentCoreDecision(input, agentRun)
  }

  private async runAgentCore(input: RuntimeSubmitInput, pendingTask?: AgentPendingTask): Promise<AgentCoreRunResult> {
    const dataGateway = this.buildAgentCoreDataGateway(input)
    const runtime = new SchedulingAgentRuntime({
      dataGateway,
      intentInterpreter: new LlmAgentIntentInterpreter(this.llmClient),
    })
    const capabilitySummary = runtime.describeCapabilities()
    const operationalReadiness = await runtime.auditOperationalReadiness({
      userInput: input.userInput,
      channelId: input.scheduleState.channelId,
      date: input.scheduleState.date,
    })
    const result = await runtime.submit({
      userInput: input.userInput,
      channelId: input.scheduleState.channelId,
      date: input.scheduleState.date,
      conversationId: undefined,
      pendingTask,
    })
    return {
      result,
      capabilitySummary,
      operationalReadiness,
    }
  }

  private buildAgentCoreDataGateway(input: RuntimeSubmitInput): RuntimeSchedulingDataGateway {
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
            return {
              query: {
                limit: query.limit,
                keyword: query.keyword,
                facets: queries
                  .map((item) => item.keyword)
                  .filter((keyword): keyword is string => Boolean(keyword)),
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
    const pendingTimeOnlyFollowUp = Boolean(input.pendingTask && this.isAgentPendingTimeOnlyFollowUp(input.userInput))
    const pendingFollowUpKeyword = input.pendingTask
      && !this.isAgentPendingControlInput(input.userInput)
      && !pendingTimeOnlyFollowUp
      ? this.extractAgentCandidateKeywordFallbackStable(input.userInput, input.pendingTask.intent)
      : undefined
    if (!interpretation?.intent) {
      return pendingFollowUpKeyword ?? pendingKeyword ?? this.extractAgentCandidateKeywordFallbackStable(input.userInput)
    }
    if (interpretation.intent === 'insert') {
      return (pendingTimeOnlyFollowUp ? undefined : this.cleanAgentCandidateKeywordStable(interpretation.slots?.programHint))
        ?? pendingFollowUpKeyword
        ?? pendingKeyword
        ?? (pendingTimeOnlyFollowUp ? undefined : this.extractAgentCandidateKeywordFallbackStable(input.userInput, interpretation.intent))
    }
    if (interpretation.intent === 'replace') {
      return (pendingTimeOnlyFollowUp ? undefined : this.cleanAgentCandidateKeywordStable(interpretation.slots?.replacementHint))
        ?? pendingFollowUpKeyword
        ?? pendingKeyword
        ?? (pendingTimeOnlyFollowUp ? undefined : this.extractAgentCandidateKeywordFallbackStable(input.userInput, interpretation.intent))
    }
    if (interpretation.intent === 'query' && interpretation.queryKind === 'candidate_lookup') {
      return this.cleanAgentCandidateKeywordStable(
        interpretation.keyword
        ?? interpretation.slots?.programHint
        ?? interpretation.slots?.replacementHint
        ?? interpretation.slots?.targetProgramName,
      ) ?? pendingFollowUpKeyword ?? pendingKeyword ?? this.extractAgentCandidateKeywordFallbackStable(input.userInput, interpretation.intent)
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

  private cleanAgentCandidateKeyword(value: string | undefined): string | undefined {
    const cleaned = value
      ?.replace(/\s+/g, '')
      .replace(/^(?:节目|栏目|内容|素材|候选|可用|可播)+/u, '')
      .replace(/(?:节目|栏目|内容|素材|候选|可用|可播)$/u, '')
      .trim()
    return cleaned && cleaned.length >= 2 ? cleaned : undefined
  }

  private extractAgentCandidateKeywordFallback(
    userInput: string,
    intent?: AtomicCommandIntent,
  ): string | undefined {
    let normalized = userInput
      .replace(/\s+/g, '')
      .replace(/\d{1,2}[:：]\d{1,2}(?::\d{1,2})?/g, '')
      .replace(/\d{1,2}点(?:\d{1,2}分?)?/g, '')
      .replace(/[，。！？；：、,.!?;:]/gu, '')

    const resolvedIntent = intent ?? this.inferAgentCandidateKeywordIntent(normalized)
    if (!resolvedIntent) return undefined

    if (resolvedIntent === 'replace') {
      normalized = /(?:替换成|替换为|换成|改成|改为|换播|替换)(?:节目|栏目|内容|素材)?(.+)$/u.exec(normalized)?.[1] ?? normalized
    } else if (resolvedIntent === 'insert') {
      normalized = /(?:插入|添加|安排|排入|放置|加一条|加个|来一段|放一段)(?:节目|栏目|内容|素材)?(.+)$/u.exec(normalized)?.[1] ?? normalized
    } else if (resolvedIntent === 'query') {
      normalized = normalized
        .replace(/^(?:请|帮我|帮忙|查一下|查询|查找|查看|看看|找|搜索|当前|现在)+/u, '')
        .replace(/(?:节目库|素材库|候选库|候选|可用|可播|有哪些|是什么|有什么|里面|情况)+/gu, '')
    }

    const cleaned = normalized
      .replace(/^(?:请|帮我|帮忙|在|到|给|把|将|的|一个|一条|一段|节目|栏目|内容|素材|候选|可用|可播)+/u, '')
      .replace(/(?:节目|栏目|内容|素材|候选|可用|可播|一下)$/u, '')
      .trim()
    return this.cleanAgentCandidateKeyword(cleaned)
  }

  private inferAgentCandidateKeywordIntent(userInput: string): Extract<AtomicCommandIntent, 'insert' | 'replace' | 'query'> | undefined {
    if (/(?:替换成|替换为|换成|改成|改为|换播|替换)/u.test(userInput)) return 'replace'
    if (/(?:插入|添加|安排|排入|放置|加一条|加个|来一段|放一段)/u.test(userInput)) return 'insert'
    if (/(?:查一下|查询|查找|查看|看看|找|搜索|候选|可用|可播|有哪些|是什么|有什么|节目库|素材库|候选库)/u.test(userInput)) return 'query'
    return undefined
  }

  private cleanAgentCandidateKeywordStable(value: string | undefined): string | undefined {
    const cleaned = value
      ?.replace(/\s+/g, '')
      .replace(/[\uff0c\u3002\uff01\uff1f\uff1b\uff1a\u3001,.!?;:]/gu, '')
      .replace(/^(?:\u8282\u76ee|\u680f\u76ee|\u5185\u5bb9|\u7d20\u6750|\u5019\u9009|\u53ef\u7528|\u53ef\u64ad)+/u, '')
      .replace(/(?:\u8282\u76ee|\u680f\u76ee|\u5185\u5bb9|\u7d20\u6750|\u5019\u9009|\u53ef\u7528|\u53ef\u64ad)$/u, '')
      .trim()
    if (cleaned && /^(?:\u5c31|\u90a3|\u90a3\u5c31|\u5427|\u554a|\u5440|\u5462|\u597d|\u597d\u7684|\u53ef\u4ee5|\u884c|\u5b9a|\u653e|\u6392|\u5b89\u6392|\u63d2|\u63d2\u5165)+$/u.test(cleaned)) return undefined
    return cleaned && cleaned.length >= 2 ? cleaned : undefined
  }

  private extractAgentCandidateKeywordFallbackStable(
    userInput: string,
    intent?: AtomicCommandIntent,
  ): string | undefined {
    let normalized = userInput
      .replace(/\s+/g, '')
      .replace(/\d{1,2}[:\uff1a]\d{1,2}(?::\d{1,2})?/g, '')
      .replace(/\d{1,2}\u70b9(?:\d{1,2}\u5206?)?/g, '')
      .replace(/[\uff0c\u3002\uff01\uff1f\uff1b\uff1a\u3001,.!?;:]/gu, '')

    const resolvedIntent = intent ?? this.inferAgentCandidateKeywordIntentStable(normalized)
    if (!resolvedIntent) return undefined

    if (resolvedIntent === 'replace') {
      normalized = /(?:\u66ff\u6362\u6210|\u66ff\u6362\u4e3a|\u6362\u6210|\u6539\u6210|\u6539\u4e3a|\u6362\u64ad|\u66ff\u6362)(?:\u8282\u76ee|\u680f\u76ee|\u5185\u5bb9|\u7d20\u6750)?(.+)$/u.exec(normalized)?.[1] ?? normalized
    } else if (resolvedIntent === 'insert') {
      normalized = /(?:\u63d2\u5165|\u6dfb\u52a0|\u5b89\u6392|\u6392\u5165|\u653e\u7f6e|\u52a0\u4e00\u6761|\u52a0\u4e2a|\u6765\u4e00\u6bb5|\u653e\u4e00\u6bb5)(?:\u8282\u76ee|\u680f\u76ee|\u5185\u5bb9|\u7d20\u6750)?(.+)$/u.exec(normalized)?.[1] ?? normalized
    } else if (resolvedIntent === 'query') {
      normalized = normalized
        .replace(/^(?:\u8bf7|\u5e2e\u6211|\u5e2e\u5fd9|\u67e5\u4e00\u4e0b|\u67e5\u8be2|\u67e5\u627e|\u67e5\u770b|\u770b\u770b|\u627e|\u641c\u7d22|\u5f53\u524d|\u73b0\u5728)+/u, '')
        .replace(/(?:\u8282\u76ee\u5e93|\u7d20\u6750\u5e93|\u5019\u9009\u5e93|\u5019\u9009|\u53ef\u7528|\u53ef\u64ad|\u6709\u54ea\u4e9b|\u662f\u4ec0\u4e48|\u6709\u4ec0\u4e48|\u91cc\u9762|\u60c5\u51b5)+/gu, '')
    }

    const cleaned = normalized
      .replace(/^(?:\u8bf7|\u5e2e\u6211|\u5e2e\u5fd9|\u5728|\u5230|\u7ed9|\u628a|\u5c06|\u7684|\u4e00\u4e2a|\u4e00\u6761|\u4e00\u6bb5|\u8282\u76ee|\u680f\u76ee|\u5185\u5bb9|\u7d20\u6750|\u5019\u9009|\u53ef\u7528|\u53ef\u64ad)+/u, '')
      .replace(/(?:\u8282\u76ee|\u680f\u76ee|\u5185\u5bb9|\u7d20\u6750|\u5019\u9009|\u53ef\u7528|\u53ef\u64ad|\u4e00\u4e0b)$/u, '')
      .trim()
    return this.cleanAgentCandidateKeywordStable(cleaned)
  }

  private inferAgentCandidateKeywordIntentStable(userInput: string): Extract<AtomicCommandIntent, 'insert' | 'replace' | 'query'> | undefined {
    if (/(?:\u66ff\u6362\u6210|\u66ff\u6362\u4e3a|\u6362\u6210|\u6539\u6210|\u6539\u4e3a|\u6362\u64ad|\u66ff\u6362)/u.test(userInput)) return 'replace'
    if (/(?:\u63d2\u5165|\u6dfb\u52a0|\u5b89\u6392|\u6392\u5165|\u653e\u7f6e|\u52a0\u4e00\u6761|\u52a0\u4e2a|\u6765\u4e00\u6bb5|\u653e\u4e00\u6bb5)/u.test(userInput)) return 'insert'
    if (/(?:\u67e5\u4e00\u4e0b|\u67e5\u8be2|\u67e5\u627e|\u67e5\u770b|\u770b\u770b|\u627e|\u641c\u7d22|\u5019\u9009|\u53ef\u7528|\u53ef\u64ad|\u6709\u54ea\u4e9b|\u662f\u4ec0\u4e48|\u6709\u4ec0\u4e48|\u8282\u76ee\u5e93|\u7d20\u6750\u5e93|\u5019\u9009\u5e93)/u.test(userInput)) return 'query'
    return undefined
  }

  private isAgentPendingControlInput(userInput: string): boolean {
    const normalized = userInput.replace(/\s+/g, '')
    return /^(?:\u786e\u8ba4|\u597d\u7684|\u53ef\u4ee5|\u6267\u884c|\u63d0\u4ea4|\u662f|\u5bf9|\u53d6\u6d88|\u4e0d\u8981|\u7b97\u4e86|\u62d2\u7edd)$/u.test(normalized)
  }

  private isAgentPendingTimeOnlyFollowUp(userInput: string): boolean {
    const clock = parseAtomicClockExpression(userInput)
    if (!clock) return false
    const residue = userInput
      .replace(/\s+/g, '')
      .replace(clock.matchedText, '')
      .replace(/[\uff0c\u3002\uff01\uff1f\uff1b\uff1a\u3001,.!?;:]/gu, '')
      .replace(/^(?:\u5c31|\u90a3|\u90a3\u5c31|\u597d\u7684|\u597d|\u53ef\u4ee5|\u884c|\u5b9a|\u653e|\u6392|\u5b89\u6392|\u63d2|\u63d2\u5165|\u5728|\u5230|\u5427|\u554a|\u5440|\u5462)+/u, '')
      .replace(/(?:\u5c31|\u5427|\u554a|\u5440|\u5462|\u53ef\u4ee5|\u884c|\u597d\u7684|\u597d)$/u, '')
      .trim()
    return residue.length === 0
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
      return '当前播单或取证上下文已经发生变化，我不会继续执行旧的预演结果。请基于左侧最新播单重新发起这次操作。'
    }

    if ((result.status === 'blocked' || result.status === 'failed') && issue?.code === 'time_overlap') {
      return this.buildAgentTimeOverlapBlockedMessage(result, issue)
    }

    const llmFeedback = result.input.interpretation?.assistantFeedback?.trim()
    if (
      (result.status === 'needs_clarification' || result.status === 'needs_confirmation')
      && llmFeedback
      && this.isBusinessReadableAgentExplanation(llmFeedback)
      && !this.isStaleAgentConfirmationFeedback(llmFeedback, result)
    ) {
      return this.appendAgentCandidateSearchBrief(llmFeedback, result)
    }

    const explanation = result.explanation?.trim() ?? ''
    if (
      this.isBusinessReadableAgentExplanation(explanation)
      && !(result.status === 'needs_confirmation' && this.isGenericAgentConfirmationExplanation(explanation))
      && !this.isStaleAgentConfirmationFeedback(explanation, result)
    ) {
      return this.appendAgentCandidateSearchBrief(explanation, result)
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
        return this.appendAgentCandidateSearchBrief(
          `我已经定位到${targetText || '要替换的节目'}，替换候选是${replacementHint ? `《${replacementHint}》` : '当前候选节目'}。这会改动正式编排，请确认后我再写入。`,
          result,
        )
      }
      if (intent === 'insert') {
        return this.appendAgentCandidateSearchBrief(
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
      return '这条指令还缺少关键信息。我已经保留当前上下文，你可以直接补一句时间、节目名或确认方式。'
    }

    if (intent === 'validate' || commandIntent === 'validate') {
      return this.buildAgentValidationUserFacingContent(result.validationReport)
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

    if (result.status === 'executed') {
      if (intent === 'query') return this.buildAgentQueryUserFacingContent(result.decision.queryResult)
      return '操作已完成，并已写入当前播单。'
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

  private appendAgentCandidateSearchBrief(content: string, result: AgentResult): string {
    const brief = this.buildAgentCandidateSearchBrief(result)
    if (!brief || content.includes('检索结果')) return content
    return `${content}\n\n检索结果：${brief}`
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
      const rewriteText = queryResult.candidateSearchMatchedBy === 'rewritten_keywords'
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
      ? `我先按${searchSummary.searchedText}查了当前候选库，暂时没有找到${hint ? `与《${hint}》匹配的` : '符合这条描述的'}可播节目或素材。\n\n简要检索结果：${searchSummary.briefResultText}\n\n我会继续保留这个任务，并优先尝试${searchSummary.suggestionText}这些相近关键词。`
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

  private buildAgentCoreDecision(input: RuntimeSubmitInput, agentRun: AgentCoreRunResult): RuntimeDecision {
    const { result, capabilitySummary, operationalReadiness } = agentRun
    const userFacingContent = this.buildAgentUserFacingContent(result)
    if (result.status === 'executed' && result.executionResult?.committed) {
      return {
        kind: 'agent_execution',
        result,
        feedback: createFeedback(
          userFacingContent,
          'execution',
          '执行完成',
          {
            explanation: '已完成结构化解析、约束校验和事务提交。',
            details: this.buildAgentCoreDetails(result, capabilitySummary, operationalReadiness),
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
            details: this.buildAgentCoreDetails(result, capabilitySummary, operationalReadiness),
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
            explanation: result.decision.constraintReport?.issues[0]?.message ?? '确认前上下文已变化，旧预演已作废。',
            details: this.buildAgentCoreDetails(result, capabilitySummary, operationalReadiness),
          },
        ),
      }
    }

    if (result.decision.pendingTask) {
      const pendingContext = this.buildAgentPendingAtomicContext(input, result, userFacingContent)
      return {
        kind: 'pending_atomic_context',
        feedback: createFeedback(
          userFacingContent,
          result.status === 'needs_confirmation' ? 'selection' : 'planning',
          result.status === 'needs_confirmation' ? '待确认' : '待补参',
          {
            explanation: '已保存结构化上下文，下一轮会基于该上下文和你的新输入继续判断。',
            details: this.buildAgentCoreDetails(result, capabilitySummary, operationalReadiness),
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
          details: this.buildAgentCoreDetails(result, capabilitySummary, operationalReadiness),
        },
      ),
    }
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
      reasoning: result.input.interpretation?.assistantFeedback || '正在维护本轮原子命令的结构化上下文。',
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
  ): RuntimeDetailMap {
    return {
      agentCore: true,
      agentCapabilities: capabilitySummary,
      agentOperationalReadiness: operationalReadiness,
      status: result.status,
      intent: result.decision.intent,
      command: result.decision.command,
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
      trace: result.trace,
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

    if (pendingContext.agentPendingTask) {
      return {
        kind: 'decision',
        decision: await this.continueAgentCorePendingTask(input, pendingContext.agentPendingTask),
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
      action: pending.action === 'replace' ? 'replace' : 'insert',
      summary: pending.summary,
      reasoning: pending.reasoning,
      originalUserInput: pending.originalUserInput,
      collectedUserInput: pending.collectedUserInput,
      targetTime: pending.slots.targetTime ?? pending.slots.targetTimeHint ?? '',
      rawProgramText: pending.slots.rawProgramText,
      semanticLabel: pending.slots.semanticLabel,
      programTypeHint: pending.slots.programTypeHint,
      targetItemId: pending.slots.targetItemId,
      targetItemName: pending.slots.targetItemName,
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
      scheduleState: input.scheduleState,
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
    const context = buildDialogueContext({ scheduleState: input.scheduleState, userInput: input.userInput, currentSchedule: input.currentSchedule })
    const recognizedIntent = await this.intentRecognizer.recognize(context)
    const recognizedAction = this.asRuntimeAtomicAction(recognizedIntent?.type)
    const normalizedAtomicInput = input.userInput.replace(/\s+/g, '')
    const unsupportedActionHint = recognizedIntent && !recognizedAction
      ? this.detectAtomicAction(normalizedAtomicInput)
      : null
    if (
      unsupportedActionHint
      && (recognizedIntent.type === 'unsupported' || recognizedIntent.type === 'clarify')
      && this.shouldClarifyUnsupportedAtomicIntent(input, unsupportedActionHint)
    ) {
      const pendingAtomicClarification = this.buildPendingAtomicClarification(
        input,
        recognizedIntent.reasoning,
        unsupportedActionHint,
      )
      return this.buildPendingAtomicClarificationDecision(pendingAtomicClarification)
    }

    const detectedAction = !recognizedIntent
      ? this.detectAtomicAction(normalizedAtomicInput)
      : null
    const fallbackIntent = detectedAction
      ? {
          type: detectedAction,
          confidence: 0.55,
          reasoning: `fallback:${detectedAction}`,
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
    if (!/(插入|插个|插一|插播|加播|加一条|加一档|加个|加一段|加一些|添加节目|安排节目|排入|排个|排一条|排一档|来个|来一条|来一档|放个|放一段|上个|上点|上一段|垫点|垫一点|垫一段|垫一条|补点|补一段|推荐(?:几个|几条|几档)?|找(?:几个|几条|几档)?|查(?:几个|几条|几档)?|有没有(?:适合|可用|候选)|删除|删掉|移除|去掉|撤掉|撤下|拿掉|拿下|下掉|移动到|移到|调到|调整到|改到|挪到|放到|排到|移动|后移|前移|顺延|延后|提前|推迟|推后|延迟|往后挪|往前挪|替换|换成|换播|换掉|替换成|替换为|改成|改为|改播)/.test(normalized)) return false
    const hasExactTime = Boolean(parseAtomicClockExpression(normalized))
    const hasExplicitAtomicVerb = /(插入|插个|插一|插播|加播|加一条|加一档|加个|加一段|加一些|添加节目|添加|排入|排个|排一条|排一档|放个|放一段|上个|上点|上一段|垫点|垫一点|垫一段|垫一条|补点|补一段|推荐(?:几个|几条|几档)?|找(?:几个|几条|几档)?|查(?:几个|几条|几档)?|有没有(?:适合|可用|候选)|删除|删掉|移除|去掉|撤掉|撤下|拿掉|拿下|下掉|移动到|移到|调到|调整到|改到|挪到|放到|排到|移动|后移|前移|顺延|延后|提前|推迟|推后|延迟|往后挪|往前挪|替换|换成|换播|换掉|替换成|替换为|改成|改为|改播)/.test(normalized)
    const hasStrongAtomicVerb = /(插入|插个|插一|插播|加播|添加节目|添加|推荐(?:几个|几条|几档)?|找(?:几个|几条|几档)?|查(?:几个|几条|几档)?|有没有(?:适合|可用|候选)|删除|删掉|移除|去掉|撤掉|撤下|拿掉|拿下|下掉|移动到|移到|调到|调整到|改到|挪到|放到|排到|移动|后移|前移|顺延|延后|提前|推迟|推后|延迟|往后挪|往前挪|替换|换成|换播|换掉|替换成|替换为|改成|改为|改播)/.test(normalized)
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
    const hasDraftRefineVerb = /(删除|删掉|移除|去掉|撤掉|撤下|拿掉|拿下|下掉|替换|换成|换播|换掉|替换成|替换为|改成|改为|改播|调整为)/.test(normalized)
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
    const range = parseAtomicTimeRange(userInput)
    if (!range) return null

    const normalized = userInput.replace(/\s+/g, '')
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

  private cleanExplicitRangeSegmentLabel(value: string): string | undefined {
    const cleaned = value
      .replace(/^[，,。！？!?；;：:、]+|[，,。！？!?；;：:、]+$/g, '')
      .replace(/^(?:按)?(?:纯电视频道|电视频道|频道编排|常规频道)/g, '')
      .replace(/^(?:安排|编排|排入|排|准备|制作|生成|创建|做成|做个|做一段|来个|来一版|继续播|接着播|续播|顺播|顺着排)+/g, '')
      .replace(/(?:接昨天进度|接昨日进度|接昨天|接昨日|昨天进度|昨日进度|顺播|续播|继续播|接着播|顺着排)/g, '')
      .replace(/(?:顺着|按照|根据)?(?:当前|现有|今天)?(?:版面|节目单|编排单)?(?:补中间集|补缺集|补空档|补空窗|补空缺)/g, '')
      .replace(/(?:轮播单|直播单|节目单|编排单|串联单|播单|版面|草案|节目|内容)$/g, '')
      .replace(/[，,。！？!?；;：:、]+$/g, '')
      .trim()

    return cleaned.length >= 2 ? cleaned : undefined
  }

  private tryClassifySequentialDurationLayoutInstruction(userInput: string): TaskClassification | null {
    const normalized = userInput.replace(/\s+/g, '')
    if (!this.looksLikeSequentialDurationSegments(normalized)) return null

    const anchor = parseAtomicClockExpression(userInput) ?? this.parseSequentialAnchorClock(userInput)
    if (!anchor) return null

    const tail = normalized.slice(anchor.index + anchor.matchedText.length)
    const segments = this.extractSequentialDurationSegments(tail, anchor.targetTime)
    if (segments.length < 2) return null

    const first = segments[0]!
    const last = segments.at(-1)!
    const semanticLabel = segments
      .map((segment) => segment.semanticLabel)
      .filter(Boolean)
      .join('、')

    return {
      mode: 'layout_prepare',
      confidence: 0.92,
      reasoning: '用户给出了连续时长段落，应按每个段落生成独立版面草案，并在正式编排时分别检索和命中节目。',
      suggestedParams: {
        userIntent: semanticLabel || userInput,
        targetTimeRange: { start: first.start, end: last.end },
        semanticLabel: semanticLabel || first.semanticLabel,
        programTypeHint: first.programTypeHint,
        segments,
      },
    }
  }

  private extractSequentialDurationSegments(tail: string, startTime: string): LayoutIntentSegment[] {
    const durationToken = '(?:一刻钟|三刻钟|半个?小时|(?:(?:\\d+(?:\\.\\d+)?)|[零〇一二两三四五六七八九十]{1,3})(?:个)?小时|(?:(?:\\d+)|[零〇一二两三四五六七八九十]{1,3})(?:分钟|分))'
    const pattern = new RegExp(`(?:先|首先|再|然后|接着|随后)?(?:来一段|来|做一段|做|安排|排|垫一段|垫|加一段|加|补一段|补)?(${durationToken})([\\s\\S]*?)(?=(?:再|然后|接着|随后)(?:来一段|来|做一段|做|安排|排|垫一段|垫|加一段|加|补一段|补)?${durationToken}|$)`, 'gu')
    const segments: LayoutIntentSegment[] = []
    let cursor = clockToSeconds(startTime)
    let match: RegExpExecArray | null = null

    while ((match = pattern.exec(tail)) !== null) {
      const duration = this.parseSequentialDurationSeconds(match[1] ?? '')
      const semanticLabel = this.cleanSequentialSegmentLabel(match[2] ?? '')
      if (!duration || !semanticLabel) continue
      const segmentStart = cursor
      const segmentEnd = cursor + duration
      cursor = segmentEnd
      segments.push({
        start: secondsToClockText(segmentStart),
        end: secondsToClockText(segmentEnd),
        semanticLabel,
        programTypeHint: this.inferInsertProgramTypeHint(semanticLabel),
        sequential: this.inferInsertProgramTypeHint(semanticLabel) === 'tv_drama',
      })
    }

    return segments
  }

  private parseSequentialAnchorClock(userInput: string): { targetTime: string; matchedText: string; index: number } | null {
    const normalized = userInput.replace(/\s+/g, '')
    const match = /(?:上午|早上|清晨|下午|午后|傍晚|晚上|晚间)?(\d{1,2})(?:点|:|：)(?:(\d{1,2})分?)?/.exec(normalized)
    if (!match?.[1] || typeof match.index !== 'number') return null
    const cue = match[0]
    let hour = Number(match[1])
    const minute = Number(match[2] ?? '0')
    if (Number.isNaN(hour) || Number.isNaN(minute) || minute < 0 || minute > 59) return null
    if (hour < 12 && /(?:下午|午后|傍晚|晚上|晚间)/.test(cue)) hour += 12
    if (hour < 0 || hour > 23) return null
    return {
      targetTime: `${`${hour}`.padStart(2, '0')}:${`${minute}`.padStart(2, '0')}:00`,
      matchedText: cue,
      index: match.index,
    }
  }

  private cleanSequentialSegmentLabel(value: string): string {
    return value
      .replace(/^[，,。！？!?；;：:、]+|[，,。！？!?；;：:、]+$/g, '')
      .replace(/^(?:先|首先|再|然后|接着|随后|来一段|来|做一段|做|安排|排|垫一段|垫|加一段|加|补一段|补)+/g, '')
      .replace(/(?:节目|内容|片子|视频)$/g, '')
      .trim()
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
    return new RegExp(`(?:先|首先).{0,24}${duration}.{0,24}(?:再|然后|接着|随后).{0,24}${duration}`).test(normalized)
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
      .replace(/(轮播单|直播单|节目单|编排单|串联单|播单|版面|草案)$/g, '')
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
      .replace(/(?:轮播单|直播单|节目单|编排单|串联单|播单|版面|草案|节目|内容)$/g, '')
      .replace(/(?:多一点|多一些|为主)$/g, '')
      .trim()

    return cleaned.length >= 2 ? cleaned : undefined
  }

  private tryClassifyRelativeEventLayoutInstruction(userInput: string): TaskClassification | null {
    const normalized = userInput.replace(/\s+/g, '')
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
    if (/(向后移动|向前移动|向后移|向前移|移动到|移到|调到|调整到|改到|挪到|放到|排到|后移|前移|移动|顺一下|顺一个|挪一下|往后挪|往前挪|顺延|延后|提前|推迟|推后|延迟)/.test(normalized)) return 'move'
    if (/(删除|删掉|移除|去掉|撤掉|撤下|拿掉|拿下|下掉)/.test(normalized)) return 'delete'
    if (/(替换|换成|换播|替换成|替换为|换掉|改掉|改成|改为|改播)/.test(normalized)) return 'replace'
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
          /(?:删除|删掉|移除|去掉|撤掉|撤下|拿掉|拿下|下掉)(.+)$/u,
          /把(.+?)(?:删除|删掉|移除|去掉|撤掉|撤下|拿掉|拿下|下掉)/u,
        ])
      case 'move':
        return this.extractAtomicProgramHintFromPatterns(userInput, [
          /把(.+?)(?:向后移动|向前移动|向后移|向前移|移动到|移到|调到|调整到|改到|挪到|放到|排到|后移|前移|移动|顺一下|顺一个|挪一下|往后挪|往前挪|顺延|延后|提前|推迟|推后|延迟)/u,
          /(.+?)(?:向后移动|向前移动|向后移|向前移|移动到|移到|调到|调整到|改到|挪到|放到|排到|后移|前移|移动|顺一下|顺一个|挪一下|往后挪|往前挪|顺延|延后|提前|推迟|推后|延迟)/u,
        ])
      case 'replace':
        return this.extractAtomicProgramHintFromPatterns(userInput, [
          /把(.+?)(?:替换成|替换为|换成|换播|换掉|改掉|改成|改为|改播)/u,
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
      /(?:替换成|替换为|换成|换播|改成|改为|改播)(.+)$/u,
    )?.[1]?.trim()
    return this.normalizeAtomicProgramHint(explicitProgramName)
  }

  private extractAtomicOffsetSlot(userInput: string): { direction: 'forward' | 'backward'; offsetSeconds: number } | null {
    return parseAtomicOffset(userInput)
  }

  private extractAtomicDirectionHint(userInput: string): 'forward' | 'backward' | undefined {
    const normalized = userInput.replace(/\s+/g, '')
    if (/(向前移动|向前移|前移|提前|往前挪)/.test(normalized)) return 'backward'
    if (/(向后移动|向后移|后移|延后|顺延|推迟|推后|延迟|往后挪|顺一下|顺一个|挪一下)/.test(normalized)) return 'forward'
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
    if (!result.forceDirectExecution && requiresRuntimeCommandConfirmation(result.command)) {
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
    if (!result.suppressClarificationFallback && !result.command && !result.pendingTargetSelection && !result.pendingInsertRecommendation && this.shouldStayInAtomicClarification(result.message)) {
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

    draft = this.applyLayoutDraftStrategyProfile(draft, input.userInput)
    const draftValidation = this.layoutDraftValidator.validateDraft(draft)
    const structuralErrors = draftValidation.errors.filter((issue) => issue.code !== 'segment_gap')
    const allWarnings = dedupeStrings([...warnings, ...draftValidation.warnings.map((item) => item.message), ...draftValidation.errors.filter((issue) => issue.code === 'segment_gap').map((item) => item.message), ...(draft.warnings ?? [])])
    draft.warnings = allWarnings
    if (structuralErrors.length > 0) return this.buildLayoutDraftValidationDecision('版面草案结构校验未通过，请先调整版面后再开始编排。', classification.reasoning, { errors: structuralErrors, warnings: draftValidation.warnings })
    const feasibilityReport = await this.buildLayoutDraftFeasibilityReport(input, draft)
    return { kind: 'layout_draft', feedback: createFeedback(sourceLabel, 'planning', '版面草案', { explanation: classification.reasoning, details: { draftId: draft.id, layoutSource: draft.source, coverage: draft.coverage, segmentCount: draft.layoutReference.slots.length, warnings: allWarnings, feasibilitySummary: feasibilityReport.summary, orchestrationMode, strategyProfile: draft.strategyProfile } }), draft, feasibilityReport, orchestrationMode }
  }

  private applyLayoutDraftStrategyProfile(draft: LayoutDraft, userInput: string): LayoutDraft {
    const strategyProfile = this.buildLayoutDraftStrategyProfile(draft, userInput)
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

  private buildLayoutDraftStrategyProfile(draft: LayoutDraft, userInput: string): LayoutDraftStrategyProfile {
    const normalized = userInput.replace(/\s+/g, '')
    const explicitCarousel = /(轮播单|轮播|播单|直播单|户外直播|外场直播|现场直播|现场播出|活动现场|循环播放|循环播|滚动播|非电视频道|不是电视频道|非线性|直播活动|活动直播)/.test(normalized)
    const explicitTvChannel = /(纯电视频道|电视频道|频道编排|常规频道|顺播|续播|接着播|继续播|顺着排|昨天|上一集|下一集|补中间集|补缺集|补空档|补空窗|补空缺)/.test(normalized)
    const eventOrFunctionalCarousel = this.shouldTreatDraftAsEventOrFunctionalCarousel(draft, normalized)
    const kind: LayoutDraftStrategyKind = explicitCarousel || (!explicitTvChannel && eventOrFunctionalCarousel)
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
        ? `加载 ${referenceDate ?? '上一播出日'} 的编排记录作为顺播上下文。`
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

  private async commitLayoutDraft(input: RuntimeSubmitInput, classification: TaskClassification): Promise<RuntimeDecision> {
    const draft = input.currentLayoutDraft
      ?? this.resolveExistingLayoutDraft(input, input.userInput, false)?.draft
    if (!draft) return { kind: 'message', feedback: createFeedback('当前还没有可确认的版面草案，请先生成或导入版面后再开始编排。', 'planning', '版面草案', { explanation: classification.reasoning }) }
    const mode = this.resolvePreferredOrchestrationMode(input)
    const feasibilityReport = await this.buildLayoutDraftFeasibilityReport(input, draft)
    const blockedSegments = feasibilityReport.segments.filter((segment) => segment.status === 'blocked')
    const mustFixBlockedSegments = blockedSegments.filter((segment) =>
      segment.blockerKind !== 'keyword' || this.hasConcreteDraftSegmentRequirement(draft, segment.segmentId),
    )
    if (mustFixBlockedSegments.length > 0) {
      const blockedText = mustFixBlockedSegments
        .map((segment) => `${segment.startTime}-${segment.endTime} ${segment.label}`)
        .join('；')
      return {
        kind: 'layout_draft',
        feedback: createFeedback(
          `当前版面草案还有 ${blockedSegments.length} 个段落没有可用节目支撑，已先保留草案，不会进入正式编排。${blockedText ? `请调整：${blockedText}` : '请调整不可编排段落。'}`,
          'planning',
          '版面草案待调整',
          {
            explanation: classification.reasoning,
            details: {
              draftId: draft.id,
              layoutSource: draft.source,
              feasibilitySummary: feasibilityReport.summary,
              blockedSegments: mustFixBlockedSegments,
              orchestrationMode: mode,
            },
          },
        ),
        draft,
        feasibilityReport,
        orchestrationMode: mode,
      }
    }
    return { kind: 'layout_commit', feedback: createFeedback('已确认当前版面草案，准备按该版面开始编排。', 'planning', '版面草案确认', { explanation: classification.reasoning, details: { draftId: draft.id, layoutSource: draft.source } }), draft, orchestrationRequest: { userInput: input.userInput, mode, reasoning: classification.reasoning, layoutDraft: draft } }
  }

  private hasConcreteDraftSegmentRequirement(draft: LayoutDraft, segmentId: string): boolean {
    const index = draft.layoutReference.slots.findIndex((slot) => slot.id === segmentId)
    const column = index >= 0 ? draft.columns[index] : undefined
    if (!column) return false
    const specificKeywords = extractSpecificSearchKeywords(column.queryHints ?? [])
    const sequenceRequired = hasExplicitSequenceRequirements(column.queryHints ?? [])
    const editorialRequired = hasEditorialKeywordRequirements(column.queryHints ?? [])
    const functionalRequired = hasFunctionalSearchKeywords(column.queryHints ?? [])
    if (specificKeywords.length === 0 && !sequenceRequired && !editorialRequired && !functionalRequired) return false
    if (!sequenceRequired && !editorialRequired && !functionalRequired && (column.source === 'default' || column.source === 'imported')) {
      const labelKeywords = extractSpecificSearchKeywords([
        column.semanticLabel ?? '',
        column.columnName,
      ])
      if (specificKeywords.every((keyword) => labelKeywords.includes(keyword))) {
        return false
      }
    }
    return true
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
        const fallbackLabel = `时段${index + 1}`
        return {
          id: slot.id,
          label: semanticLabel ?? sourceColumn?.columnName ?? fallbackLabel,
          startTime: toClockText(slot.startTime),
          endTime: toClockText(slot.endTime),
          programType: sourceColumn?.defaultProgramType ?? 'news_magazine',
          queryHints: this.buildReferenceQueryHints(sourceColumn, fallbackLabel),
          sequential: sourceColumn?.isSequential,
        }
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
      const previewReason = preview.warnings.find((warning) => warning.trim())
      return {
        command: null,
        message: previewReason ?? `目标时间 ${params.targetTime} 已有节目占用，请先删除、替换，或换一个空闲时间点。`,
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

  private buildPendingInsertRecommendation(
    params: InsertParams,
    userInput: string,
    reasoning: string,
    candidates: RuntimeInsertRecommendationCandidate[],
    options?: {
      action?: 'insert' | 'replace'
      targetItemId?: string
      targetItemName?: string
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
      targetItemId: options?.targetItemId,
      targetItemName: options?.targetItemName,
      recommendedCandidates: candidates,
      selectedCandidateId: null,
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

  private shouldRecommendInsertSelection(input: RuntimeSubmitInput): boolean {
    return input.scheduleState.playlistType === 'rotation'
  }

  private isVagueSemanticInsertParams(params: InsertParams): boolean {
    if (params.programName?.trim()) return false
    const text = [params.rawProgramText, params.semanticLabel].filter(Boolean).join('')
    return params.programTypeHint === 'entertainment'
      && /(\u70ed\u95f9|\u8f7b\u677e|\u5a31\u4e50|\u7efc\u827a|\u5185\u5bb9)/u.test(text)
  }

  private async searchInsertCandidates(input: { scheduleState: ScheduleState; params: InsertParams; columnId?: string; currentSchedule: RuntimeScheduleItem[] }): Promise<{ candidates: Array<import('@/types/orchestration').ProgramCandidate>; searchMode: 'explicit_name' | 'semantic_recommendation' | 'fallback_recommendation'; blockedByTime: boolean; blockedByKeywords?: boolean; keywordDiagnostics?: RuntimeDetailMap }> {
    const { scheduleState, params, columnId, currentSchedule } = input
    const programTypes = params.programTypeHint ? [params.programTypeHint] : undefined
    const explicitProgramName = params.programName?.trim()
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
        limit: 6,
      })
      const executableDirectCandidates = this.filterInsertExecutableCandidates(
        directCandidates,
        scheduleState.date,
        params.targetTime,
        currentSchedule,
      )
      if (directCandidates.length > 0) {
        return {
          candidates: executableDirectCandidates,
          searchMode: 'explicit_name',
          blockedByTime: executableDirectCandidates.length === 0,
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
        limit: 6,
      })
      const executableFallbackCandidates = this.filterInsertExecutableCandidates(
        fallbackCandidates,
        scheduleState.date,
        params.targetTime,
        currentSchedule,
      )
      return {
        candidates: executableFallbackCandidates,
        searchMode: 'fallback_recommendation',
        blockedByTime: fallbackCandidates.length > 0 && executableFallbackCandidates.length === 0,
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
      limit: 6,
    })
    const executableRecommendedCandidates = this.filterInsertExecutableCandidates(
      recommendedCandidates,
      scheduleState.date,
      params.targetTime,
      currentSchedule,
    )
    return {
      candidates: executableRecommendedCandidates,
      searchMode: 'semantic_recommendation',
      blockedByTime: recommendedCandidates.length > 0 && executableRecommendedCandidates.length === 0,
    }
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
      if (!params) {
        const programAnchored = this.resolveProgramAnchoredInsertParams(input, reasoning)
        if (programAnchored.result) return programAnchored.result
        params = programAnchored.params
      }
      if (!params) return { command: null, message: '未能识别插入目标时间，请重新描述。', explanation: reasoning }
      const columnId = findSlotColumnIdByTime(input.scheduleState.channelId, input.scheduleState.date, normalizeDateTime(input.scheduleState.date, params.targetTime))
      const { candidates, searchMode, blockedByTime, blockedByKeywords, keywordDiagnostics } = await this.searchInsertCandidates({
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
        const directTvCandidate = input.scheduleState.playlistType === 'tv'
          && (searchMode === 'explicit_name' || searchMode === 'semantic_recommendation')
          && !(searchMode === 'semantic_recommendation' && this.isVagueSemanticInsertParams(params))
          && recommendedCandidates[0]
          && recommendedCandidates[0].confidence >= (searchMode === 'semantic_recommendation' ? 0.55 : 0.75)
          ? resolution.candidates[0]?.candidate
          : null
        if (directTvCandidate) {
          return this.buildInsertCommandResult(
            context,
            params,
            {
              id: directTvCandidate.id,
              programName: directTvCandidate.programName,
            },
            reasoning,
            {
              targetTime: params.targetTime,
              selectedCandidateName: directTvCandidate.programName,
              selectedCandidate: directTvCandidate,
              candidateCount: recommendedCandidates.length,
              recommendationTrigger: resolution.trigger,
              playlistState: {
                playlistType: input.scheduleState.playlistType,
              },
            },
            `电视播单采用固定频道编排策略，${searchMode === 'explicit_name' ? '显式节目名' : '语义内容'}已命中高匹配候选，直接采用排序第一的《${directTvCandidate.programName}》。`,
          )
        }
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
      if (!params && intent.type === 'move') {
        const absoluteMove = await this.resolveAbsoluteMoveCommand(input, reasoning)
        if (absoluteMove) return absoluteMove
      }
      if (!params) {
        const programAnchored = this.resolveProgramAnchoredAtomicParams(input, intent.type, reasoning)
        if (programAnchored.result) return programAnchored.result
        params = programAnchored.params
      }
      if (!params && intent.type === 'move') {
        params = this.resolveSingleTimeAnchoredMoveParams(input)
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
        },
      )
      return input.scheduleState.playlistType === 'tv' && replaceResult.command
        ? { ...replaceResult, forceDirectExecution: true }
        : replaceResult
    }

    return { command: null, message: '当前指令不属于已支持的原子修改能力。', explanation: reasoning }
  }

  private resolveSingleTimeAnchoredMoveParams(input: RuntimeSubmitInput): MoveParams | null {
    const slots = this.extractAtomicSlotHints(input.userInput, 'move')
    if (!slots.targetTime || !slots.direction || typeof slots.offsetSeconds !== 'number') {
      return null
    }

    return {
      targetTime: slots.targetTime,
      direction: slots.direction,
      offsetSeconds: slots.offsetSeconds,
    }
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
    const programName = this.extractAtomicProgramHint(userInput, 'move')
    return {
      sourceTime: source?.targetTime,
      destinationTime: destination.targetTime,
      programName: programName && !this.isGenericAtomicProgramAnchor(programName) ? programName : undefined,
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
    const programName = this.extractAtomicProgramHint(input.userInput, action)
    if (!programName) {
      return { params: null }
    }
    const hasExplicitTargetTime = Boolean(this.extractAtomicTimeSlot(input.userInput))
    const hasExplicitProgramAnchorCue = this.shouldResolveTargetByProgramAnchor(input.userInput)
    if (hasExplicitTargetTime && !hasExplicitProgramAnchorCue) {
      return { params: null }
    }
    if (this.isGenericAtomicProgramAnchor(programName)) {
      return { params: null }
    }

    if (!hasExplicitProgramAnchorCue && input.currentSchedule.length === 0) {
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
