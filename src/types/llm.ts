/**
 * LLM 相关类型定义
 */

// LLM 配置
export interface LLMConfig {
  baseURL: string
  apiKey: string
  model: string
  temperature: number
  maxTokens: number
  timeout: number
}

// 聊天消息
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

// LLM 响应
export interface LLMResponse {
  content: string
  usage?: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
}

// Token 使用统计
export interface TokenUsageStats {
  totalPromptTokens: number
  totalCompletionTokens: number
  totalTokens: number
  requestCount: number
}

// 聊天选项
export interface ChatOptions {
  temperature?: number
  maxTokens?: number
  timeout?: number
}

// Command 类型
export type CommandType =
  | 'plan' // 规划模式
  | 'query_candidates' // 查询候选
  | 'fill_item' // 填充节目
  | 'insert' // 插入
  | 'delete' // 删除
  | 'replace' // 替换
  | 'swap' // 交换
  | 'move' // 移动
  | 'update_field' // 更新字段
  | 'batch' // 批量操作
  | 'clarification' // 澄清问题

// 编排命令
export interface ScheduleCommand {
  action: CommandType
  data: unknown
  reasoning?: string
}

// 解析结果
export interface ParseResult<T> {
  success: boolean
  data?: T
  error?: string
  rawResponse?: string
}

// 验证结果
export interface ValidationResult {
  valid: boolean
  errors: string[]
}

// 时段块信息
export interface GapInfo {
  gapId: string
  startTime: string
  endTime: string
  duration: number
  programType?: string
}

// 节目候选
export interface ProgramCandidate {
  programCode: string
  programName: string
  duration: number
  programType: string
  rating?: number
}

// 编排上下文
export interface PlanningContext {
  channelId: string
  channelName: string
  date: string
  layoutReference: string
  historySummary: string
  constraints: string[]
}

// 填充上下文
export interface FillingContext {
  gap: GapInfo
  currentSchedule: string
  availablePrograms: ProgramCandidate[]
}

// 修复上下文
export interface RepairContext {
  errors: ValidationError[]
  items: ScheduleItem[]
}

// 对话上下文
export interface DialogueContext {
  userInput: string
  history: ChatMessage[]
  currentSchedule: string
}

// 验证错误
export interface ValidationError {
  type: string
  message: string
  itemId?: string
  field?: string
}

// 串联单项
export interface ScheduleItem {
  id: string
  programCode: string
  programName: string
  startTime: string
  endTime: string
  duration: number
  programType: string
}

// 编排状态
export type OrchestrationStatus =
  | 'idle'
  | 'planning'
  | 'filling'
  | 'repairing'
  | 'completed'
  | 'error'
  | 'cancelled'

// 时段块状态
export interface GapStatus {
  gapId: string
  status: 'pending' | 'processing' | 'completed' | 'error'
  selectedProgram?: ProgramCandidate
  error?: string
}

// 编排进度
export interface OrchestrationProgress {
  status: OrchestrationStatus
  totalGaps: number
  completedGaps: number
  currentGapId?: string
  gaps: GapStatus[]
  errors: string[]
  logs: string[]
}
