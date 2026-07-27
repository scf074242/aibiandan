import type { PlaylistType, ProgramCandidate, RotationPlaylistStrategy, ScheduleItemSnapshot, ScheduleSummary, TimeRange } from '@/types/orchestration'
import type { AgentDeadline } from './agentDeadline'
import type { ReactTaskPlannerDraft } from '@/services/runtime/reactTaskTypes'
import type { AgentPlannerAction } from '@/services/llm/agentPlanner'
import type { FormalOrchestrationCheckpoint } from '@/services/runtime/formalOrchestrationRuntime'
import type { FormalOrchestrationResumePlan } from '@/services/runtime/formalOrchestrationRecovery'
import type { FormalOrchestrationGrant } from '@/services/runtime/formalOrchestrationGrant'

export type AgentRuntimeStatus =
  | 'idle'
  | 'understanding'
  | 'resolving_context'
  | 'planning'
  | 'previewing'
  | 'needs_clarification'
  | 'needs_selection'
  | 'needs_confirmation'
  | 'blocked'
  | 'executing'
  | 'validating'
  | 'completed'
  | 'failed'

export type AgentResultStatus =
  | 'executed'
  | 'needs_selection'
  | 'needs_confirmation'
  | 'needs_clarification'
  | 'blocked'
  | 'failed'

export type AtomicCommandIntent =
  | 'move'
  | 'insert'
  | 'replace'
  | 'delete'
  | 'batch_move'
  | 'batch_delete'
  | 'query'
  | 'validate'

export interface AgentSubmitInput {
  userInput: string
  channelId: string
  date: string
  playlistId?: string
  conversationId?: string
  pendingTask?: AgentPendingTask | null
  interpretation?: AgentIntentInterpretation | null
  llmContextPackage?: AgentLlmContextPackage
  /**
   * 长流程编排参数（D23 三路径收口）。
   * 当存在此字段时，表示本次提交是全天编排或局部补排请求，
   * 由 OrchestrationCapability 处理，不再走原子命令能力。
   */
  orchestration?: {
    /** 编排模式 */
    mode: 'full_generate' | 'partial_generate'
    /** 目标频道 ID */
    channelId: string
    /** 目标日期 */
    date: string
    /** 日开始时间（full_generate 必填） */
    dayStartTime?: string
    /** 日结束时间（full_generate 必填） */
    dayEndTime?: string
    /** 局部编排目标（partial_generate 使用） */
    target?: string[] | {
      targetGapIds?: string[]
      targetTimeRange?: { start: string; end: string }
      searchKeywords?: string[]
    }
    /** 编排策略 */
    strategy?: Partial<{
      target?: string
      referencePriority?: string[]
      allowFiller?: boolean
      sequentialPreference?: boolean
      riskPreference?: string
    }>
    /** 编排事件回调，用于向前台透传进度 */
    onEvent?: (event: {
      type: 'status-change' | 'gap-start' | 'gap-complete' | 'gap-failed' | 'log' | 'error' | 'complete'
      payload: Record<string, unknown>
    }) => void
    onCheckpoint?: (checkpoint: FormalOrchestrationCheckpoint<AgentPlannerAction>) => void
    /**
     * 结构化 ReAct 计划。正式编排必须提供；缺省时返回 react_plan_invalid，不启动历史 Orchestrator。
     */
    reactTask?: {
      workspaceKey: string
      plannerTask: ReactTaskPlannerDraft<AgentPlannerAction>
      resumeFrom?: FormalOrchestrationResumePlan<AgentPlannerAction>
      authorization?: FormalOrchestrationGrant
    }
  }
}

export interface AgentIntentSlots {
  targetTime?: string
  newStartTime?: string
  rangeStart?: string
  rangeEnd?: string
  programHint?: string
  replacementHint?: string
  offsetSeconds?: number
  direction?: 'forward' | 'backward'
  candidateId?: string
  targetItemId?: string
  targetProgramName?: string
}

export interface AgentIntentInterpretation {
  intent?: AtomicCommandIntent
  pendingAction?: AgentPendingAction
  confidence: number
  source: 'llm' | 'deterministic' | 'test'
  slots?: AgentIntentSlots
  taskPlanDraft?: AgentTaskPlanDraft
  queryKind?: QueryCommandPlan['queryKind']
  keyword?: string
  searchAlternatives?: string[]
  /**
   * LLM 在意图解析阶段一次性生成的带策略标签的关键词组合（阶段 2 引入）。
   *
   * 设计约束（AGENTS.md LLM-first）：
   * - 策略标签、关键词、理由全部由 LLM 生成
   * - 本地只做结构校验与去重，不改写关键词
   * - 与 searchAlternatives 并存（本地优先使用 keywordStrategies，searchAlternatives 保留兼容）
   */
  keywordStrategies?: AgentKeywordStrategy[]
  /**
   * LLM 是否建议在所有关键词都 0 命中时启用二次反思（escape hatch 标志）。
   *
   * - 仅当 enableSecondaryReflection=true 时有意义
   * - 本地仅在所有策略 0 命中且此标志为 true 时触发二次反思
   */
  suggestSecondaryReflection?: boolean
  reasoning?: string
  assistantFeedback?: string
  streamingHint?: 'none' | 'thinking' | 'final'
  contextMode?: 'scenario_context'
  rawText?: string
}

/**
 * LLM 一次性生成的关键词策略组合单元（阶段 2 引入）。
 *
 * 设计约束（AGENTS.md LLM-first / LLM-only）：
 * - strategy 标签由 LLM 选择，覆盖 original/typo_fix/decompose/paraphrase/column_demote/broaden
 * - keywords 由 LLM 基于完整上下文生成，本地不做同义词扩展或错别字修复
 * - reason 由 LLM 给出，用于 trace 与失败暴露
 */
export interface AgentKeywordStrategy {
  /** 策略标签 */
  strategy: 'original' | 'typo_fix' | 'decompose' | 'paraphrase' | 'column_demote' | 'broaden'
  /** 该策略下的关键词组合（1-3 个关键词，去重） */
  keywords: string[]
  /** LLM 给出的"为什么这组可能命中"的简短理由（中文，用于 trace 和失败暴露） */
  reason: string
}

export type AgentTaskPlanStageDraftType = 'atomic' | 'batch_atomic' | 'draft_refill' | 'verify' | 'ask_user'

export interface AgentTaskPlanStageDraft {
  type: AgentTaskPlanStageDraftType
  action?: AtomicCommandIntent
  target?: {
    programName?: string
    replacementHint?: string
    candidateId?: string
    candidateCode?: string
    programType?: string
    durationSeconds?: number
    targetTime?: string
    rangeStart?: string
    rangeEnd?: string
    scope?: 'current_playlist' | 'current_gaps' | 'time_range'
  }
  layoutDraftReferenced?: boolean
  requiresLayoutDraft?: boolean
  requiresConfirmation?: boolean
  summary?: string
}

export interface AgentTaskPlanDraft {
  isComposite: boolean
  goal: string
  stages: AgentTaskPlanStageDraft[]
}

export interface AgentIntentInterpreter {
  usesLlm?: boolean
  /**
   * 解析用户输入为结构化意图。
   * @param input - agent 提交输入（含用户输入、上下文证据包、pending 任务等）
   * @param deadline - 可选的统一 deadline 管理器，用于从剩余预算中推导 stage timeout
   *                   未传时沿用各实现内部默认 timeout（向后兼容，D1 前的调用路径不受影响）
   */
  interpret(input: AgentSubmitInput, deadline?: AgentDeadline): Promise<AgentIntentInterpretation | null>
}

export type AgentPendingAction =
  | 'start_new_task'
  | 'cancel_pending'
  | 'select_candidate'
  | 'confirm'
  | 'reject'

export type AgentSlotSource = 'user_initial' | 'user_followup' | 'system_inferred' | 'candidate_selection'

export interface AgentSlotValue<T = unknown> {
  value: T
  source: AgentSlotSource
  confidence: number
  rawText?: string
}

export type AgentSlotBag = Partial<{
  targetTime: AgentSlotValue<string>
  newStartTime: AgentSlotValue<string>
  rangeStart: AgentSlotValue<string>
  rangeEnd: AgentSlotValue<string>
  programHint: AgentSlotValue<string>
  replacementHint: AgentSlotValue<string>
  offsetSeconds: AgentSlotValue<number>
  direction: AgentSlotValue<'forward' | 'backward'>
  candidateId: AgentSlotValue<string>
  targetItemId: AgentSlotValue<string>
  targetProgramName: AgentSlotValue<string>
  targetItemIds: AgentSlotValue<string[]>
}>

export interface AgentPendingTask {
  id: string
  intent: AtomicCommandIntent
  phase: 'needs_clarification' | 'needs_selection' | 'needs_confirmation'
  originalInput: string
  collectedInput: string
  collectedSlots: AgentSlotBag
  missingSlots: string[]
  allowedActions: AgentPendingAction[]
  recommendations?: AgentCandidateRecommendation[]
  targetOptions?: AgentTargetOption[]
  attemptCount: number
  maxAttempts: number
  createdAt: string
  updatedAt: string
  expiresAt?: string
  contextFingerprint?: string
  contextSources?: AgentPendingContextSourceSnapshot[]
}

export interface AgentPendingTaskAuditSnapshot {
  id: string
  intent: AtomicCommandIntent
  phase: AgentPendingTask['phase']
  collectedSlotKeys: string[]
  missingSlots: string[]
  allowedActions: AgentPendingAction[]
  attemptCount: number
  maxAttempts: number
  expiresAt?: string
  contextFingerprint?: string
  contextSources?: AgentPendingContextSourceSnapshot[]
  contextSourceSummary: string[]
  recommendationCount: number
  targetOptionCount: number
}

export interface AgentPendingContextSourceSnapshot {
  sourceKey: SchedulingContextSourceKey
  source: SchedulingContextSourceKind
  available: boolean
  recordCount: number
  status?: SchedulingContextSourceStatus
  errorCode?: string
  version?: string
  digest: string
  samples?: string[]
}

export interface AgentLlmContextIdentity {
  playlistId?: string
  playlistType: PlaylistType
  channelId?: string
  date?: string
  rotationStrategy?: RotationPlaylistStrategy
  rotationDurationSeconds?: number
  durationScope?: string
  positionBasis?: 'relative_from_zero' | 'broadcast_clock'
}

export interface AgentLlmContextPackage {
  identity: AgentLlmContextIdentity
  playlistSemantics: {
    model: 'time_grid' | 'content_queue'
    positionMeaning: string
    draftBoundary: string
    writeBoundary: string
  }
  budget: {
    scheduleItems: {
      included: number
      total: number
      limit: number
      truncated: boolean
    }
    candidates: {
      included: number
      total: number
      limit: number
      truncated: boolean
    }
    latestHistoryItems?: {
      included: number
      total: number
      limit: number
      truncated: boolean
    }
    contentTagsPerCandidate: {
      limit: number
    }
  }
  sourceSummary: AgentPendingContextSourceSnapshot[]
  layoutDraftAnchors?: Array<{
    label: string
    startTime: string
    endTime: string
    queryHints?: string[]
  }>
  currentSchedule: Array<{
    itemId: string
    programId?: string
    startTime: string
    endTime: string
    programName?: string
    instanceName?: string
    programCode?: string
    issueNo?: string
    programType?: string
    columnName?: string
    sequence?: number
    positionBasis?: 'relative_from_zero'
  }>
  candidateSummary: Array<{
    candidateId: string
    programId: string
    programName: string
    instanceName?: string
    programCode?: string
    issueNo?: string
    duration: number
    programType?: string
    columnName?: string
    materialStatus?: AgentBroadcastReadinessStatus
    rightsStatus?: AgentBroadcastReadinessStatus
    contentTags?: string[]
  }>
  latestHistory?: {
    date: string
    itemCount: number
    samples: Array<{
        startTime: string
        endTime: string
        programId?: string
        programName?: string
        instanceName?: string
        programCode?: string
        issueNo?: string
        sequence?: number
      }>
  }
  constraints: {
    layoutBounds?: TimeRange
    lockedItemIds: string[]
    blockedTimeRanges: TimeRange[]
  }
  policy: SchedulingPolicyContext
  guardrails: string[]
}

export interface AgentTraceStep {
  status: AgentRuntimeStatus
  label: string
  detail?: Record<string, unknown>
  timestamp: string
  elapsedMs?: number
  sequence?: number
}

export interface AgentConstraintIssue {
  code:
    | 'target_not_found'
    | 'target_ambiguous'
    | 'locked_item'
    | 'out_of_layout_bounds'
    | 'blocked_time_range'
    | 'time_overlap'
    | 'sequence_violation'
    | 'unsupported_intent'
    | 'llm_intent_unavailable'
    | 'missing_required_slot'
    | 'schedule_source_missing'
    | 'candidate_source_missing'
    | 'history_source_missing'
    | 'constraint_source_missing'
    | 'context_conflict'
    | 'capability_route_conflict'
    | 'program_not_found'
    | 'program_ambiguous'
    | 'time_slot_mismatch'
    | 'replacement_duty_mismatch'
    | 'same_day_duplicate_violation'
    | 'recent_replay_violation'
    | 'material_not_ready'
    | 'rights_not_ready'
  severity: 'critical' | 'warning' | 'info'
  message: string
  detail?: Record<string, unknown>
}

export interface AgentConstraintReport {
  ok: boolean
  issues: AgentConstraintIssue[]
}

export interface AgentPreview {
  command: AgentCommandPlan
  before: ScheduleItemSnapshot[]
  after: ScheduleItemSnapshot[]
  affectedItemIds: string[]
  affectedTimeRanges: TimeRange[]
}

export interface AgentExecutionResult {
  committed: boolean
  operationId: string
  affectedItemIds: string[]
  scheduleItems: ScheduleItemSnapshot[]
}

export interface AgentValidationReport {
  ok: boolean
  issues: AgentConstraintIssue[]
}

export interface MoveCommandPlan {
  intent: 'move'
  itemId: string
  targetTime: string
  newStartTime: string
  newEndTime: string
  offsetSeconds: number
}

export interface InsertCommandPlan {
  intent: 'insert'
  candidateId: string
  candidateName: string
  insertTime: string
  endTime: string
}

export interface DeleteCommandPlan {
  intent: 'delete'
  itemId: string
  targetTime: string
}

export interface BatchMoveCommandPlan {
  intent: 'batch_move'
  itemIds: string[]
  targetRange: TimeRange
  offsetSeconds: number
}

export interface BatchDeleteCommandPlan {
  intent: 'batch_delete'
  itemIds: string[]
  targetRange: TimeRange
}

export interface QueryCommandPlan {
  intent: 'query'
  queryKind: 'schedule_summary' | 'time_lookup' | 'program_lookup' | 'candidate_lookup'
  targetTime?: string
  keyword?: string
}

export interface ValidateCommandPlan {
  intent: 'validate'
  scope: 'schedule'
}

export interface ReplaceCommandPlan {
  intent: 'replace'
  itemId: string
  targetTime: string
  candidateId: string
  candidateName: string
  startTime: string
  endTime: string
}

export type AgentCommandPlan =
  | MoveCommandPlan
  | InsertCommandPlan
  | DeleteCommandPlan
  | BatchMoveCommandPlan
  | BatchDeleteCommandPlan
  | QueryCommandPlan
  | ValidateCommandPlan
  | ReplaceCommandPlan

export interface AgentProgramCandidate extends ProgramCandidate {
  materialStatus?: 'ready' | 'missing' | 'expired' | 'blocked'
  rightsStatus?: 'ready' | 'missing' | 'expired' | 'blocked'
}

export type AgentBroadcastReadinessStatus = NonNullable<AgentProgramCandidate['materialStatus']>

export interface AgentBroadcastReadinessEvidence {
  candidateId?: string
  programId?: string
  programCode?: string
  materialStatus?: AgentBroadcastReadinessStatus
  rightsStatus?: AgentBroadcastReadinessStatus
  updatedAt?: string
  source?: string
}

export interface AgentCandidateRecommendation {
  candidateId: string
  programName: string
  programCode: string
  duration: number
  programType: string
  score: number
  reason: string
  warningCodes?: string[]
  blockingCodes?: string[]
  evidenceSourceKeys?: SchedulingContextSourceKey[]
  professionalSignals?: AgentCandidateAssessmentSignal[]
}

export type AgentCandidateSelectionMethod = 'explicit' | 'tv_sequence' | 'candidate_judge' | 'candidate_judge_llm'
export type AgentCandidateSelectionSource = 'explicit' | 'today' | 'history' | 'fallback' | 'none'
export type AgentCandidateAssessmentVerdict = 'prefer' | 'pass' | 'neutral' | 'warn' | 'block'
export type SchedulingContextSourceKey = 'today' | 'candidates' | 'readiness' | 'history' | 'constraints' | 'policy'

export interface AgentCandidateAssessmentSignal {
  code: string
  verdict: AgentCandidateAssessmentVerdict
  score: number
  reason: string
  sourceKeys?: SchedulingContextSourceKey[]
  detail?: Record<string, unknown>
}

export interface AgentCandidateProfessionalAssessment {
  totalScore: number
  hardBlockCodes: string[]
  signals: AgentCandidateAssessmentSignal[]
}

export interface AgentCandidateSelectionDiagnostics {
  method: AgentCandidateSelectionMethod
  source: AgentCandidateSelectionSource
  selectedCandidateId?: string
  selectedProgramCode?: string
  candidateCount: number
  expectedSequence?: number
  selectedSequence?: number
  seriesKey?: string
  candidateOptionIds?: string[]
  professionalAssessment?: AgentCandidateProfessionalAssessment
  reason: string
  decisionType?: AgentCandidateDecisionType
  failureReason?: string
  reasoning?: string
  considerations?: string[]
}

export type AgentAuditOutcome = 'executed' | 'pending' | 'blocked' | 'failed' | 'read_only'
export type AgentConstraintHandlingAction = 'block' | 'confirm' | 'warn' | 'record'

export interface AgentConstraintHandling {
  code: AgentConstraintIssue['code']
  severity: AgentConstraintIssue['severity']
  action: AgentConstraintHandlingAction
  reason: string
}

export interface AgentOperationAudit {
  committed: boolean
  commitAttempted: boolean
  commitGuardStatus: 'not_applicable' | 'not_attempted' | 'passed' | 'blocked'
  operationId?: string
  commandIntent?: AtomicCommandIntent
  affectedItemIds: string[]
  affectedCount: number
  previewAffectedItemIds: string[]
  previewAffectedCount: number
  previewAffectedTimeRanges: TimeRange[]
  previewSummary: string[]
  validationOk?: boolean
  reason: string
}

export interface AgentPlaylistPolicyAudit {
  playlistType: PlaylistType
  rotationStrategy?: RotationPlaylistStrategy
  commandIntent?: AtomicCommandIntent
  executionMode: 'direct_execute' | 'confirm_before_commit' | 'read_only'
  policyAction: 'execute' | 'confirm' | 'read'
  requiresConfirmation: boolean
  reason: string
}

export interface AgentIntentInterpretationAudit {
  source: AgentIntentInterpretation['source']
  confidence: number
  llmUsed: boolean
  pendingAction?: AgentPendingAction
  slotKeys: Array<keyof AgentIntentSlots>
  queryKind?: QueryCommandPlan['queryKind']
  keyword?: string
  reasoning?: string
  assistantFeedback?: string
}

export type AgentLlmCallAuditStatus = 'attempted' | 'succeeded' | 'rejected' | 'failed'

export interface AgentLlmCallAuditItem {
  stage: 'intent_interpreter'
  status: AgentLlmCallAuditStatus
  reason?: string
}

export interface AgentLlmUsageAudit {
  callsAttempted: number
  callsSucceeded: number
  callsRejected: number
  callsFailed: number
  calls: AgentLlmCallAuditItem[]
}

export interface AgentEvidenceChainItem {
  sourceKey: SchedulingContextSourceKey
  role: string
  source: SchedulingContextSourceEvidence['source']
  available: boolean
  recordCount: number
  status?: SchedulingContextSourceEvidence['status']
  signalCodes: string[]
  conclusion: string
}

export interface AgentProfessionalRuleSummary {
  total: number
  blockingRuleIds: string[]
  warningRuleIds: string[]
  positiveRuleIds: string[]
  neutralRuleIds: string[]
  evidenceSourceKeys: SchedulingContextSourceKey[]
}

export interface AgentAuditSummary {
  outcome: AgentAuditOutcome
  title: string
  professionalConclusion?: string
  confirmationReason?: string
  blockerReason?: string
  keyPoints: string[]
  warnings: string[]
  blockers: string[]
  contextSources?: SchedulingContextSourceContext
  signalSourceSummary: string[]
  pendingTask?: AgentPendingTaskAuditSnapshot
  candidate?: {
    candidateId?: string
    programCode?: string
    method: AgentCandidateSelectionMethod
    source: AgentCandidateSelectionSource
    reason: string
    expectedSequence?: number
    selectedSequence?: number
    seriesKey?: string
  }
  professionalSignals: AgentCandidateAssessmentSignal[]
  professionalRuleSummary: AgentProfessionalRuleSummary
  constraintIssueCodes: string[]
  constraintHandling: AgentConstraintHandling[]
  evidenceChain: AgentEvidenceChainItem[]
  intentInterpretation?: AgentIntentInterpretationAudit
  llmUsage: AgentLlmUsageAudit
  playlistPolicy?: AgentPlaylistPolicyAudit
  operation: AgentOperationAudit
}

export interface AgentTargetOption {
  itemId: string
  programName?: string
  programCode?: string
  startTime: string
  endTime: string
  duration?: number
  programType?: string
}

export interface AgentQueryResult {
  kind: QueryCommandPlan['queryKind']
  queryText: string
  playlistType: PlaylistType
  totalCount: number
  scheduleItems: ScheduleItemSnapshot[]
  candidates: AgentProgramCandidate[]
  targetTime?: string
  keyword?: string
  searchAttempts?: Array<{
    keyword: string
    source: 'primary' | 'llm_alternative'
    candidateCount: number
    candidateIds: string[]
  }>
  candidateSearchMatchedBy?: 'primary' | 'llm_alternatives' | 'none'
}

export interface AgentDecision {
  intent?: AtomicCommandIntent
  command?: AgentCommandPlan
  resolvedTargets?: ScheduleItemSnapshot[]
  recommendations?: AgentCandidateRecommendation[]
  candidateSelection?: AgentCandidateSelectionDiagnostics
  auditSummary?: AgentAuditSummary
  queryResult?: AgentQueryResult
  constraintReport?: AgentConstraintReport
  preview?: AgentPreview
  pendingTask?: AgentPendingTask
}

export interface AgentResult {
  status: AgentResultStatus
  input: AgentSubmitInput
  decision: AgentDecision
  executionResult?: AgentExecutionResult
  validationReport?: AgentValidationReport
  explanation: string
  trace: AgentTraceStep[]
}


/**
 * Capability 元数据，用于基于意图和播单类型的路由分发。
 */
export interface CapabilityMetadata {
  /** 能力名称 */
  name: string
  /** 该能力处理的原子命令意图列表 */
  intents: string[]
  /** 适用的播单类型；'all' 表示不限 */
  playlistTypes?: ('tv' | 'carousel' | 'all')[]
  /** 是否需要用户确认 */
  requiresConfirmation?: boolean
  /** 路由优先级，数值越高越优先 */
  priority?: number
}

export interface AgentCapability {
  id: string
  /** 可选的 capability 元数据，支持基于意图/播单类型的显式路由 */
  metadata?: CapabilityMetadata
  canHandle(input: AgentSubmitInput): boolean
  handle(input: AgentSubmitInput, runtime: AgentCapabilityRuntime): Promise<AgentResult>
}

export interface AgentCapabilityResolver {
  resolveAll(input: AgentSubmitInput): AgentCapability[]
}

export interface AgentCapabilityRuntime {
  dataGateway: SchedulingDataGateway
  candidateJudge: AgentCandidateJudge
  trace: AgentTraceRecorder
  /** 当前请求使用的统一 capability 注册表，只暴露路由能力。 */
  capabilityRegistry?: AgentCapabilityResolver
  /**
   * 统一 deadline 管理器（per-submit）。
   * capability 调用 candidateJudge 等下游 LLM 调用时应透传此 deadline，
   * 由下游实现从剩余预算中推导 stage timeout。
   * 未传时下游沿用默认 timeout（向后兼容）。
   */
  deadline?: AgentDeadline
}

/**
 * TV 顺播证据（由 AgentTvSequenceCandidateSelector.buildEvidence 提取，不含决策）
 * 用于透传给 LLM 候选决策器，让 LLM 看到顺播上下文
 */
export interface AgentTvSequenceEvidence {
  playlistType: PlaylistType
  /** 期望下一集期数（todayMaxSequence 或 historyMaxSequence + 1） */
  expectedSequence?: number
  /** 系列标识 */
  seriesKey?: string
  /** 证据来源：今天编排 / 历史编排 / 无基线 */
  source: 'today' | 'history' | 'none'
  /** 今天编排中同系列最大期数 */
  todayMaxSequence?: number
  /** 历史编排中同系列最大期数 */
  historyMaxSequence?: number
  /** 是否有顺播基线（today 或 history 命中） */
  hasBaseline: boolean
}

/**
 * LLM 候选决策类型
 * - auto_select: 候选不多 + 唯一靠谱，可自动执行
 * - needs_clarification: 候选很多/无顺播基线/同一期多版本，需用户澄清
 * - unable_to_decide: LLM 失败/超时/结构无效
 */
export type AgentCandidateDecisionType =
  | 'auto_select'
  | 'needs_clarification'
  | 'unable_to_decide'

/**
 * LLM 候选决策结果（含理由 + 决策类型）
 */
export interface AgentCandidateDecision {
  /** 选中的候选（auto_select 时非 null） */
  candidate: AgentProgramCandidate | null
  /** 决策思路（用于第三条进度消息） */
  reasoning: string
  /** 评估要点（可选，用于进度消息 details） */
  considerations?: string[]
  /** 决策类型 */
  decisionType: AgentCandidateDecisionType
  /** needs_clarification 时的推荐列表 */
  candidateOptions?: AgentProgramCandidate[]
}

export interface AgentCandidateJudgeInput {
  userInput: string
  playlistType: PlaylistType
  commandIntent: AtomicCommandIntent
  candidates: AgentProgramCandidate[]
  context: SchedulingContext
  professionalAssessments?: Record<string, AgentCandidateProfessionalAssessment>
  /** TV 顺播证据（透传给 LLM 辅助决策） */
  tvSequenceEvidence?: AgentTvSequenceEvidence
}

export interface AgentCandidateJudge {
  /**
   * 在候选节目中做决策，返回选中候选 + 决策理由 + 决策类型。
   * @param input - 候选决策输入（候选列表、上下文、顺播证据等）
   * @param deadline - 可选的统一 deadline 管理器，用于从剩余预算中推导 stage timeout
   *                   未传时沿用实现内部默认 timeout（向后兼容）
   */
  selectBestCandidate(input: AgentCandidateJudgeInput, deadline?: AgentDeadline): Promise<AgentCandidateDecision>
}

export interface AgentTraceRecorder {
  record(status: AgentRuntimeStatus, label: string, detail?: Record<string, unknown>): void
  getTrace(): AgentTraceStep[]
}

export interface SchedulingContext {
  channelId: string
  date: string
  playlistId?: string
  playlistType: PlaylistType
  rotationStrategy?: RotationPlaylistStrategy
  rotationDurationSeconds?: number
  scheduleItems: ScheduleItemSnapshot[]
  programCandidates: AgentProgramCandidate[]
  broadcastReadiness: AgentBroadcastReadinessEvidence[]
  historySchedules?: ScheduleSummary[]
  layoutBounds?: TimeRange
  lockedItemIds: string[]
  blockedTimeRanges: TimeRange[]
  sourceHints?: SchedulingContextSourceHints
  sourceMetadata?: SchedulingContextSourceMetadataHints
  bundle: SchedulingContextBundle
}

export interface SchedulingContextBundle {
  identity: SchedulingContextIdentity
  sources: SchedulingContextSourceContext
  today: SchedulingTodayContext
  candidates: SchedulingCandidateContext
  readiness: SchedulingReadinessContext
  history: SchedulingHistoryContext
  constraints: SchedulingConstraintContext
  policy: SchedulingPolicyContext
}

export interface SchedulingContextIdentity {
  channelId: string
  date: string
  playlistId?: string
  playlistType: PlaylistType
  rotationStrategy?: RotationPlaylistStrategy
  rotationDurationSeconds?: number
}

export type SchedulingContextSourceKind =
  | 'runtime_schedule_reader'
  | 'program_candidate_reader'
  | 'readiness_reader'
  | 'history_schedule_reader'
  | 'constraint_reader'
  | 'schedule_state'
  | 'explicit_runtime_option'
  | 'agent_commit_cache'
  | 'in_memory_seed'
  | 'empty_context'
  | 'none'

export type SchedulingContextSourceHints = Partial<Record<
  SchedulingContextSourceKey,
  SchedulingContextSourceKind
>>

export type SchedulingContextSourceStatus =
  | 'available'
  | 'empty'
  | 'missing'
  | 'unavailable'

export interface SchedulingContextSourceQueryEvidence {
  keyword?: string
  facets?: string[]
  limit?: number
  cursor?: string
  filters?: Record<string, unknown>
}

export interface SchedulingContextSourceMetadata {
  status?: SchedulingContextSourceStatus
  errorCode?: string
  errorMessage?: string
  version?: string
  query?: SchedulingContextSourceQueryEvidence
}

export type SchedulingContextSourceMetadataHints = Partial<Record<
  SchedulingContextSourceKey,
  SchedulingContextSourceMetadata
>>

export interface SchedulingContextSourceEvidence {
  source: SchedulingContextSourceKind
  available: boolean
  recordCount: number
  status?: SchedulingContextSourceStatus
  errorCode?: string
  errorMessage?: string
  version?: string
  query?: SchedulingContextSourceQueryEvidence
}

export interface SchedulingContextSourceContext {
  today: SchedulingContextSourceEvidence
  candidates: SchedulingContextSourceEvidence
  readiness: SchedulingContextSourceEvidence
  history: SchedulingContextSourceEvidence
  constraints: SchedulingContextSourceEvidence
  policy: SchedulingContextSourceEvidence
}

export interface SchedulingTodayContext {
  scheduleItems: ScheduleItemSnapshot[]
  itemCount: number
}

export interface SchedulingCandidateContext {
  programCandidates: AgentProgramCandidate[]
  totalCount: number
}

export interface SchedulingReadinessContext {
  records: AgentBroadcastReadinessEvidence[]
  totalCount: number
}

export interface SchedulingHistoryContext {
  schedules: ScheduleSummary[]
  totalCount: number
  latestSchedule?: ScheduleSummary
  todayOverridesHistory: boolean
}

export interface SchedulingConstraintContext {
  layoutBounds?: TimeRange
  lockedItemIds: string[]
  blockedTimeRanges: TimeRange[]
}

export interface SchedulingPolicyContext {
  playlistType: PlaylistType
  rotationStrategy?: RotationPlaylistStrategy
  rotationDurationSeconds?: number
  tvStrictFill: boolean
  rotationCandidateWritesRequireConfirmation: boolean
  sensitiveWriteIntentsRequireConfirmation: Array<Extract<AtomicCommandIntent, 'delete' | 'batch_delete'>>
}

export interface SchedulingDataGateway {
  loadContext(input: AgentSubmitInput): Promise<SchedulingContext>
  commitScheduleItems(input: {
    channelId: string
    date: string
    playlistId?: string
    items: ScheduleItemSnapshot[]
    reason: string
    expectedContextFingerprint?: string
  }): Promise<AgentExecutionResult>
}
