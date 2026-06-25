import type { PlaylistType, ProgramCandidate, RotationPlaylistStrategy, ScheduleItemSnapshot, ScheduleSummary, TimeRange } from '@/types/orchestration'

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
  reasoning?: string
  assistantFeedback?: string
  streamingHint?: 'none' | 'thinking' | 'final'
  contextMode?: 'scenario_context'
  rawText?: string
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
  interpret(input: AgentSubmitInput): Promise<AgentIntentInterpretation | null>
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

export interface AgentCapability {
  id: string
  canHandle(input: AgentSubmitInput): boolean
  handle(input: AgentSubmitInput, runtime: AgentCapabilityRuntime): Promise<AgentResult>
}

export interface AgentCapabilityRuntime {
  dataGateway: SchedulingDataGateway
  candidateJudge: AgentCandidateJudge
  trace: AgentTraceRecorder
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
  selectBestCandidate(input: AgentCandidateJudgeInput): Promise<AgentCandidateDecision>
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
