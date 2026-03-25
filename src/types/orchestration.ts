/**
 * 编排系统类型定义（基于新技术方案）
 * 采用空窗驱动、系统控制、LLM局部决策架构
 */

import type { ChatMessage } from './llm'

// ==================== 任务判别相关 ====================

/** 任务模式类型 */
export type TaskMode =
  | 'full_generate'      // 从零生成完整编排单
  | 'partial_generate'   // 对当前空窗自动补排
  | 'micro_edit'         // 局部增删改查
  | 'validate_only'      // 只执行校验
  | 'repair_only'        // 只执行修复
  | 'clarify'            // 语义不明确，需澄清

/** 任务判别结果 */
export interface TaskClassification {
  mode: TaskMode
  confidence: number           // 置信度 0-1
  reasoning: string            // 判别理由
  suggestedParams?: {
    targetGaps?: string[]      // 目标空窗ID列表
    targetItems?: string[]     // 目标条目ID列表
    userIntent?: string        // 解析后的用户意图
  }
}

/** 节目单状态 */
export interface ScheduleState {
  channelId: string
  channelName: string
  date: string
  isEmpty: boolean
  itemCount: number
  gapCount: number
  hasSelectedTimeRange: boolean
}

/** 风险等级 */
export type RiskLevel = 'low' | 'medium' | 'high'

/** 风险评估 */
export interface RiskAssessment {
  level: RiskLevel
  factors: string[]
  affectedTimeRange?: { start: string; end: string }
  affectedItemCount?: number
}

// ==================== 空窗相关 ====================

/** 空窗约束 */
export interface GapConstraints {
  allowedTypes?: string[]      // 允许的节目类型
  minDuration?: number         // 最小时长（秒）
  maxDuration?: number         // 最大时长（秒）
  fixedStart?: boolean         // 开始时间是否固定
  fixedEnd?: boolean           // 结束时间是否固定
  preferredPrograms?: string[] // 优先节目列表
}

/** 空窗元数据 */
export interface GapMetadata {
  source: 'layout' | 'fixed' | 'manual' | 'generated'
  priority: number             // 处理优先级，数字越小优先级越高
  createdAt: string
  updatedAt: string
}

/** 空窗信息 */
export interface GapInfo {
  id: string                   // 空窗唯一标识
  startTime: string            // 开始时间 (ISO 8601)
  endTime: string              // 结束时间
  duration: number             // 时长（秒）
  precedingItemId?: string     // 前邻条目ID
  followingItemId?: string     // 后邻条目ID
  constraints: GapConstraints
  metadata: GapMetadata
}

/** 空窗状态 */
export type GapProcessingStatus = 'pending' | 'processing' | 'completed' | 'failed'

/** 空窗处理状态 */
export interface GapProcessingState {
  gapId: string
  status: GapProcessingStatus
  attemptCount: number         // 尝试次数
  selectedCandidateId?: string // 选中的候选ID
  filledItemId?: string        // 填充后的条目ID
  error?: string
  startedAt?: string
  completedAt?: string
}

// ==================== 编排会话相关 ====================

/** 编排策略 */
export interface PlanningStrategy {
  target: string
  referencePriority: string[]
  allowFiller: boolean
  sequentialPreference: boolean
  riskPreference: 'conservative' | 'balanced' | 'aggressive'
}

/** 编排执行统计 */
export interface ExecutionStats {
  totalCommands: number
  successfulCommands: number
  failedCommands: number
  fallbackCount: number
  repairRounds: number
}

/** 编排日志条目 */
export interface PlanningLogEntry {
  id: string
  timestamp: string
  level: 'info' | 'warn' | 'error'
  phase: string
  message: string
  details?: Record<string, any>
}

/** 编排会话状态 */
export type PlanningSessionStatus =
  | 'initializing'
  | 'planning'
  | 'filling'
  | 'repairing'
  | 'completed'
  | 'failed'
  | 'cancelled'

/** 编排会话 */
export interface PlanningSession {
  id: string
  channelId: string
  date: string
  status: PlanningSessionStatus
  strategy: PlanningStrategy
  gaps: {
    pending: GapInfo[]
    processing?: GapInfo
    completed: string[]
    failed: string[]
  }
  execution: ExecutionStats
  logs: PlanningLogEntry[]
  createdAt: string
  updatedAt: string
}

// ==================== 命令体系相关 ====================

/** 命令类型 */
export type OrchestrationCommandType =
  | 'plan'               // 策略初始化
  | 'query_candidates'   // 候选检索
  | 'fill_item'          // 单条选择
  | 'repair'             // 修复策略
  | 'insert'             // 插入条目
  | 'delete'             // 删除条目
  | 'replace'            // 替换条目
  | 'move'               // 移动条目
  | 'update_field'       // 更新字段
  | 'clarification'      // 请求澄清

/** 基础命令 */
export interface BaseCommand {
  action: OrchestrationCommandType
  reasoning?: string
}

/** 策略初始化命令 */
export interface PlanCommand extends BaseCommand {
  action: 'plan'
  data: {
    strategy: PlanningStrategy
    initialGapCount: number
    estimatedSteps: number
  }
}

/** 候选检索条件 */
export interface CandidateQueryCriteria {
  targetTimeRange: { start: string; end: string }
  expectedDuration: { min: number; max: number }
  programTypePreference?: string[]
  searchKeywords?: string[]
  preferredChannelId?: string
  sequentialPreference: boolean
  excludeUsed: boolean
  considerRatings: boolean
  allowShortFiller: boolean
}

/** 候选检索命令 */
export interface QueryCandidatesCommand extends BaseCommand {
  action: 'query_candidates'
  data: {
    gapId: string
    criteria: CandidateQueryCriteria
  }
}

/** 单条选择命令 */
export interface FillItemCommand extends BaseCommand {
  action: 'fill_item'
  data: {
    gapId: string
    selectedCandidateId: string
    selectionReason: string
    suggestedNextAction?: 'continue' | 'fill_gap' | 'repair'
  }
}

/** 修复策略 */
export type RepairStrategy =
  | 'replace_candidate'  // 替换候选
  | 'add_filler'         // 补短片
  | 'adjust_item'        // 调整一条
  | 'local_fallback'     // 局部回退
  | 'request_manual'     // 请求人工确认

/** 修复命令 */
export interface RepairCommand extends BaseCommand {
  action: 'repair'
  data: {
    targetId: string
    targetType: 'item' | 'gap'
    strategy: RepairStrategy
    parameters?: Record<string, any>
  }
}

/** 插入命令 */
export interface InsertCommand extends BaseCommand {
  action: 'insert'
  data: {
    candidateId: string
    position?: 'before' | 'after'
    referenceItemId?: string
    insertTime?: string
    scheduleDate?: string
    channelId?: string
    candidateName?: string
  }
}

/** 删除命令 */
export interface DeleteCommand extends BaseCommand {
  action: 'delete'
  data: {
    itemId: string
    cascade?: boolean
  }
}

/** 替换命令 */
export interface ReplaceCommand extends BaseCommand {
  action: 'replace'
  data: {
    itemId: string
    newCandidateId: string
  }
}

/** 移动命令 */
export interface MoveCommand extends BaseCommand {
  action: 'move'
  data: {
    itemId: string
    newStartTime: string
  }
}

/** 更新字段命令 */
export interface UpdateFieldCommand extends BaseCommand {
  action: 'update_field'
  data: {
    itemId: string
    field: string
    value: any
  }
}

/** 澄清命令 */
export interface ClarificationCommand extends BaseCommand {
  action: 'clarification'
  data: {
    question: string
    suggestedOptions?: string[]
  }
}

/** 统一命令类型 */
export type OrchestrationCommand =
  | PlanCommand
  | QueryCandidatesCommand
  | FillItemCommand
  | RepairCommand
  | InsertCommand
  | DeleteCommand
  | ReplaceCommand
  | MoveCommand
  | UpdateFieldCommand
  | ClarificationCommand

// ==================== 节目候选相关 ====================

/** 节目候选 */
export interface ProgramCandidate {
  id: string
  programCode: string
  programName: string
  duration: number
  programType: string
  rating?: number
  description?: string
  tags?: string[]
  source: 'library' | 'history' | 'layout' | 'filler'
  metadata?: Record<string, any>
}

/** 候选检索结果 */
export interface CandidateQueryResult {
  gapId: string
  candidates: ProgramCandidate[]
  totalCount: number
  queryTime: string
}

// ==================== 校验相关 ====================

/** 校验问题类型 */
export type ValidationIssueType =
  | 'gap'                // 空窗
  | 'overlap'            // 重叠
  | 'boundary_mismatch'  // 边界不匹配
  | 'material_missing'   // 素材缺失
  | 'product_missing'    // 成品缺失
  | 'duration_mismatch'  // 时长不匹配
  | 'type_violation'     // 类型违规
  | 'constraint_violation' // 约束违规

/** 校验问题严重程度 */
export type ValidationSeverity = 'critical' | 'warning' | 'info'

/** 校验问题位置 */
export interface ValidationLocation {
  itemId?: string
  gapId?: string
  timeRange?: { start: string; end: string }
  field?: string
}

/** 校验问题 */
export interface ValidationIssue {
  id: string
  type: ValidationIssueType
  severity: ValidationSeverity
  message: string
  location: ValidationLocation
  suggestion?: string
  createdAt: string
}

/** 校验报告 */
export interface ValidationReport {
  id: string
  scope: 'item' | 'gap' | 'full'
  targetId: string
  timestamp: string
  issues: ValidationIssue[]
  summary: {
    totalIssues: number
    criticalCount: number
    warningCount: number
    infoCount: number
  }
  isValid: boolean
}

/** 修复动作 */
export interface RepairAction {
  id: string
  type: RepairStrategy
  description: string
  targetIssueId: string
  estimatedImpact: 'low' | 'medium' | 'high'
  parameters?: Record<string, any>
}

// ==================== 物化相关 ====================

/** 物化输入 */
export interface MaterializeInput {
  gap: GapInfo
  selectedCandidate: ProgramCandidate
  precedingItem?: ScheduleItemSnapshot
  followingItem?: ScheduleItemSnapshot
  channelContext: ChannelContext
}

/** 频道上下文 */
export interface ChannelContext {
  channelId: string
  channelName: string
  date: string
  timeZone: string
  broadcastRules: BroadcastRules
}

/** 播出规则 */
export interface BroadcastRules {
  defaultStartTime: string
  defaultEndTime: string
  minProgramDuration: number
  maxProgramDuration: number
  allowedTransitions: Record<string, string[]>
}

/** 编排条目快照 */
export interface ScheduleItemSnapshot {
  id: string
  programCode: string
  programName: string
  startTime: string
  endTime: string
  duration: number
  programType: string
  sequence: number
}

/** 物化结果 */
export interface MaterializeResult {
  success: boolean
  item?: ScheduleItemSnapshot
  error?: string
  warnings?: string[]
}

// ==================== 回退相关 ====================

/** 回退级别 */
export type FallbackLevel = 'item' | 'gap' | 'session'

/** 回退记录 */
export interface FallbackRecord {
  id: string
  level: FallbackLevel
  timestamp: string
  reason: string
  affectedItems: string[]
  snapshot: any
}

/** 回退策略配置 */
export interface FallbackConfig {
  maxItemRetries: number      // 条目级最大重试次数
  maxGapRetries: number       // 空窗级最大重试次数
  enableAutoFallback: boolean // 是否启用自动回退
}

// ==================== 修补相关 ====================

/** 修补配置 */
export interface RepairConfig {
  maxRepairRounds: number     // 最大修补轮次（默认3轮）
  autoRepair: boolean         // 是否自动修补
  requireConfirmation: boolean // 是否需要确认
}

/** 修补状态 */
export interface RepairState {
  currentRound: number
  maxRounds: number
  issuesByRound: ValidationIssue[][]
  actionsTaken: RepairAction[]
  isComplete: boolean
  requiresManualIntervention: boolean
}

// ==================== 进度相关 ====================

/** 编排进度 */
export interface OrchestrationProgress {
  sessionId: string
  status: PlanningSessionStatus
  currentPhase: string
  
  // 空窗进度
  gapProgress: {
    total: number
    pending: number
    processing: number
    completed: number
    failed: number
  }
  
  // 当前处理
  currentGap?: GapInfo
  currentAction?: string
  
  // 统计
  stats: ExecutionStats
  
  // 回退状态
  fallbackStatus?: {
    level: FallbackLevel
    count: number
    reason: string
  }
  
  // 修补状态
  repairStatus?: RepairState
  
  // 日志
  recentLogs: PlanningLogEntry[]
  
  // 时间戳
  startedAt: string
  estimatedCompletionAt?: string
}

// ==================== 接口层相关 ====================

/** 生成上下文 */
export interface GenerationContext {
  channel: ChannelContext
  date: string
  layoutReference?: LayoutReference
  historyReference?: HistoryReference
  constraints: ScheduleConstraints
}

/** 版面参考 */
export interface LayoutReference {
  id: string
  name: string
  slots: LayoutSlot[]
}

/** 版面时段 */
export interface LayoutSlot {
  id: string
  startTime: string
  endTime: string
  programType: string
  fixedProgram?: string
}

/** 历史编排参考 */
export interface HistoryReference {
  dates: string[]
  schedules: ScheduleSummary[]
}

/** 编排摘要 */
export interface ScheduleSummary {
  date: string
  itemCount: number
  programTypes: Record<string, number>
  avgRating?: number
}

/** 编排约束 */
export interface ScheduleConstraints {
  fixedItems: FixedItem[]
  lockedItems: string[]
  blockedTimeRanges: TimeRange[]
  mandatoryPrograms: string[]
}

/** 固定条目 */
export interface FixedItem {
  id: string
  programCode: string
  startTime: string
  endTime: string
  isLocked: boolean
}

/** 时间范围 */
export interface TimeRange {
  start: string
  end: string
}

/** 候选检索参数 */
export interface CandidateQueryParams {
  gapId: string
  timeRange: TimeRange
  durationRange: { min: number; max: number }
  programTypes?: string[]
  excludePrograms?: string[]
  sources?: ('library' | 'history' | 'layout' | 'filler')[]
  limit?: number
}

/** 命令预演结果 */
export interface CommandPreview {
  command: OrchestrationCommand
  affectedItems: string[]
  affectedTimeRanges: TimeRange[]
  estimatedResult?: any
  warnings?: string[]
  canExecute: boolean
}

/** 解释结果 */
export interface ExplanationResult {
  type: 'candidate_selection' | 'validation_issue' | 'command'
  targetId: string
  explanation: string
  details?: Record<string, any>
}

export interface ValidationContext {
  items: ScheduleItemSnapshot[]
  gaps: GapInfo[]
  fixedItems: FixedItem[]
  layoutSlots: LayoutSlot[]
  dayStartTime: string
  dayEndTime: string
}
