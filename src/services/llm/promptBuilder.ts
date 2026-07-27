/**
 * Prompt 构建器（重构版）
 * 基于新技术方案，构建不同阶段的 LLM Prompt
 *
 * 核心原则：
 * 1. 聚焦局部上下文（当前空窗 + 必要上下文）
 * 2. 输出结构化命令（非完整业务对象）
 * 3. 降低上下文漂移风险
 */

import type {
  GapInfo,
  ProgramCandidate,
  PlanningStrategy,
  ScheduleItemSnapshot,
  ValidationReport,
  ValidationIssue,
  CandidateQueryCriteria,
  ChannelContext,
  GenerationContext,
} from '@/types/orchestration'
import type { ChatMessage } from '@/types/llm'

/**
 * PromptBuilder 文件级 prompt 版本号（对齐 AGENTS.md Prompt 版本管理门禁）
 * 7 个 build 方法共享同一 prompt 基线，调用方需 import 并透传到 llmClient.chat 的 promptVersion 字段。
 * 修订任一 build 方法的 prompt 时必须同步升版本号。
 */
export const PROMPT_BUILDER_VERSION = 'v1.0' as const

/** Prompt 构建器 */
export class PromptBuilder {
  /**
   * 构建策略初始化 Prompt
   * PlanCommand：只描述编排策略，不输出完整节目单
   */
  buildPlanningPrompt(params: {
    channelId: string
    channelName: string
    date: string
    gapCount: number
    strategy?: Partial<PlanningStrategy>
  }): ChatMessage[] {
    const { channelId, channelName, date, gapCount, strategy } = params

    const systemPrompt = `[prompt ${PROMPT_BUILDER_VERSION}] 你是一位电视节目编排策略专家。
你的职责是根据频道、日期和空窗情况，制定编排策略。

策略应包括：
1. 编排目标（target）
2. 参考优先级（referencePriority）：版面 > 历史 > 节目库
3. 是否允许填充节目（allowFiller）
4. 是否优先顺排（sequentialPreference）
5. 风险偏好（riskPreference）：conservative（保守）/ balanced（平衡）/ aggressive（积极）

重要：
- 只输出策略描述，不输出具体节目单
- 策略将作为后续编排的指导原则

输出必须是 JSON 格式：
{
  "action": "plan",
  "data": {
    "strategy": {
      "target": "编排目标描述",
      "referencePriority": ["layout", "history", "library"],
      "allowFiller": true,
      "sequentialPreference": true,
      "riskPreference": "balanced"
    },
    "initialGapCount": ${gapCount},
    "estimatedSteps": 预估步骤数
  },
  "reasoning": "策略说明"
}`

    const userPrompt = `【编排任务】
- 频道：${channelName} (${channelId})
- 日期：${date}
- 初始空窗数：${gapCount}
${strategy ? `- 用户偏好：${JSON.stringify(strategy)}` : ''}

请制定编排策略，输出 JSON 格式。`

    return [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ]
  }

  /**
   * 构建候选检索条件 Prompt
   * QueryCandidatesCommand：生成检索条件，不直接检索
   */
  buildQueryCandidatesPrompt(params: {
    gap: GapInfo
    precedingItem?: ScheduleItemSnapshot
    followingItem?: ScheduleItemSnapshot
    strategy: PlanningStrategy
    usedProgramCodes: string[]
  }): ChatMessage[] {
    const { gap, precedingItem, followingItem, strategy, usedProgramCodes } = params

    const systemPrompt = `[prompt ${PROMPT_BUILDER_VERSION}] 你是一位电视节目编排助手。
请为当前空窗生成候选检索条件。

检索条件应包括：
1. 目标时间段（targetTimeRange）
2. 期望时长范围（expectedDuration）
3. 节目类型偏好（programTypePreference）
4. 是否优先顺排（sequentialPreference）
5. 是否排除已用内容（excludeUsed）
6. 是否参考收视率（considerRatings）
7. 是否允许短内容补齐（allowShortFiller）

重要：
- 只生成检索条件，不输出候选节目
- 系统将根据这些条件执行检索

输出必须是 JSON 格式：
{
  "action": "query_candidates",
  "data": {
    "gapId": "空窗ID",
    "criteria": {
      "targetTimeRange": { "start": "开始时间", "end": "结束时间" },
      "expectedDuration": { "min": 最小时长, "max": 最大时长 },
      "programTypePreference": ["类型1", "类型2"],
      "sequentialPreference": true|false,
      "excludeUsed": true|false,
      "considerRatings": true|false,
      "allowShortFiller": true|false
    }
  },
  "reasoning": "检索策略说明"
}`

    const gapInfoStr = `【当前空窗】
- ID: ${gap.id}
- 时间段: ${gap.startTime} - ${gap.endTime}
- 时长: ${this.formatDuration(gap.duration)}
- 约束: ${JSON.stringify(gap.constraints)}

【上下文】
${precedingItem ? `- 前邻节目: ${precedingItem.programName} (${this.formatDuration(precedingItem.duration)})` : '- 前邻节目: 无'}
${followingItem ? `- 后邻节目: ${followingItem.programName} (${this.formatDuration(followingItem.duration)})` : '- 后邻节目: 无'}

【策略配置】
- 优先顺排: ${strategy.sequentialPreference ? '是' : '否'}
- 允许填充: ${strategy.allowFiller ? '是' : '否'}
- 风险偏好: ${strategy.riskPreference}

【已用节目】
${usedProgramCodes.length > 0 ? usedProgramCodes.join(', ') : '无'}

请生成候选检索条件，输出 JSON 格式。`

    return [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: gapInfoStr },
    ]
  }

  /**
   * 构建单条选择 Prompt
   * FillItemCommand：从候选中选择一项，不输出完整业务对象
   */
  buildFillItemPrompt(params: {
    gap: GapInfo
    candidates: ProgramCandidate[]
    precedingItem?: ScheduleItemSnapshot
    followingItem?: ScheduleItemSnapshot
    strategy: PlanningStrategy
  }): ChatMessage[] {
    const { gap, candidates, precedingItem, followingItem, strategy } = params

    const systemPrompt = `[prompt ${PROMPT_BUILDER_VERSION}] 你是一位电视节目编排专家。
请从候选节目中选择最适合当前空窗的一项。

选择标准（按优先级）：
1. 时长匹配度（优先选择时长接近空窗时长的节目）
2. 类型适宜性（符合空窗约束的节目类型）
3. 收视率表现
4. 与前后节目的衔接
5. 是否符合版面要求

重要：
- 只输出选中的候选ID和理由
- 不输出完整的节目业务对象（时间、序号等由系统计算）
- 简要说明选择理由

输出必须是 JSON 格式：
{
  "action": "fill_item",
  "data": {
    "gapId": "空窗ID",
    "selectedCandidateId": "选中的候选ID",
    "selectionReason": "选择理由（简短，30字以内）",
    "suggestedNextAction": "continue" | "fill_gap" | "repair"
  },
  "reasoning": "详细选择逻辑"
}`

    const candidatesStr = candidates.map((c, i) => 
      `${i + 1}. ${c.programName} (ID: ${c.id}, 时长: ${this.formatDuration(c.duration)}, 类型: ${c.programType}, 节目编码: ${c.programCode})`
    ).join('\n')

    const contextStr = `【当前空窗】
- ID: ${gap.id}
- 时间段: ${gap.startTime} - ${gap.endTime}
- 时长: ${this.formatDuration(gap.duration)}
- 允许类型: ${gap.constraints.allowedTypes?.join(', ') || '不限'}

【候选节目】
${candidatesStr}

【上下文】
${precedingItem ? `- 前邻节目: ${precedingItem.programName} (${precedingItem.programType})` : '- 前邻节目: 无'}
${followingItem ? `- 后邻节目: ${followingItem.programName} (${followingItem.programType})` : '- 后邻节目: 无'}

【策略】
- 优先顺排: ${strategy.sequentialPreference ? '是' : '否'}
- 风险偏好: ${strategy.riskPreference}

请选择最适合的节目，输出 JSON 格式。`

    return [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: contextStr },
    ]
  }

  /**
   * 构建修复策略 Prompt
   * RepairCommand：选择修复策略，不直接执行修复
   */
  buildRepairPrompt(params: {
    validationReport: ValidationReport
    currentItems: ScheduleItemSnapshot[]
    availableCandidates: ProgramCandidate[]
    repairRound: number
    maxRepairRounds: number
  }): ChatMessage[] {
    const { validationReport, currentItems, availableCandidates, repairRound, maxRepairRounds } = params

    const systemPrompt = `[prompt ${PROMPT_BUILDER_VERSION}] 你是一位电视节目编排修复专家。
当校验发现问题时，请选择合适的修复策略。

可选修复策略：
1. replace_candidate - 替换候选（用其他候选替换当前节目）
2. add_filler - 补短片（在空窗中添加填充内容）
3. adjust_item - 调整一条（调整节目时间或属性）
4. local_fallback - 局部回退（回退该空窗的最近若干条）
5. request_manual - 请求人工确认（问题复杂，需要人工处理）

重要：
- 只选择修复策略，不输出修复后的完整节目单
- 系统将根据策略执行具体修复

输出必须是 JSON 格式：
{
  "action": "repair",
  "data": {
    "targetId": "目标ID（条目ID或空窗ID）",
    "targetType": "item" | "gap",
    "strategy": "replace_candidate" | "add_filler" | "adjust_item" | "local_fallback" | "request_manual",
    "parameters": {
      // 策略特定参数
    }
  },
  "reasoning": "修复策略说明"
}`

    const issuesStr = validationReport.issues.map((issue, i) => 
      `${i + 1}. [${issue.severity}] ${issue.type}: ${issue.message}${issue.suggestion ? ` (建议: ${issue.suggestion})` : ''}`
    ).join('\n')

    const contextStr = `【校验报告】
- 范围: ${validationReport.scope}
- 总问题数: ${validationReport.summary.totalIssues}
- 严重: ${validationReport.summary.criticalCount}, 警告: ${validationReport.summary.warningCount}, 信息: ${validationReport.summary.infoCount}
- 当前修补轮次: ${repairRound}/${maxRepairRounds}

【问题列表】
${issuesStr}

【当前编排】
${currentItems.map(item => `- ${item.programName} (${item.startTime} - ${item.endTime})`).join('\n')}

【可用候选】
${availableCandidates.map(c => `- ${c.programName} (${this.formatDuration(c.duration)})`).join('\n')}

请选择修复策略，输出 JSON 格式。`

    return [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: contextStr },
    ]
  }

  /**
   * 构建澄清 Prompt
   * ClarificationCommand：当意图不明确时请求澄清
   */
  buildClarificationPrompt(params: {
    userInput: string
    scheduleState: {
      isEmpty: boolean
      itemCount: number
      gapCount: number
    }
    suggestedModes?: string[]
  }): ChatMessage[] {
    const { userInput, scheduleState, suggestedModes } = params

    const systemPrompt = `[prompt ${PROMPT_BUILDER_VERSION}] 你是一位电视节目编排助手。
当用户意图不明确时，请礼貌地请求澄清。

可选任务模式：
1. full_generate - 从零生成完整编排单
2. partial_generate - 对当前空窗自动补排
3. micro_edit - 局部增删改查（插入、删除、替换、移动）
4. validate_only - 只执行校验
5. repair_only - 只执行修复

输出必须是 JSON 格式：
{
  "action": "clarification",
  "data": {
    "question": "澄清问题",
    "suggestedOptions": ["选项1", "选项2", "选项3"]
  },
  "reasoning": "为什么需要澄清"
}`

    const contextStr = `【用户输入】
${userInput}

【当前节目单状态】
- 是否为空: ${scheduleState.isEmpty ? '是' : '否'}
- 条目数: ${scheduleState.itemCount}
- 空窗数: ${scheduleState.gapCount}

${suggestedModes ? `【可能的意图】\n${suggestedModes.join(', ')}` : ''}

请生成澄清问题，输出 JSON 格式。`

    return [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: contextStr },
    ]
  }

  /**
   * 构建解释 Prompt
   * 用于解释候选选择或校验问题
   */
  buildExplanationPrompt(params: {
    type: 'candidate_selection' | 'validation_issue'
    targetId: string
    targetName: string
    context: Record<string, unknown>
  }): ChatMessage[] {
    const { type, targetId, targetName, context } = params

    let systemPrompt = ''
    let userPrompt = ''

    if (type === 'candidate_selection') {
      systemPrompt = `[prompt ${PROMPT_BUILDER_VERSION}] 你是一位电视节目编排专家。
请解释为什么选择某个候选节目。

输出要求：
- 用自然语言解释
- 说明选择理由
- 可以提及考虑的其他因素

输出格式：纯文本，不需要 JSON`

      const gapDuration = typeof context.gapDuration === 'number' ? context.gapDuration : undefined
      const candidateDuration = typeof context.candidateDuration === 'number' ? context.candidateDuration : undefined
      const candidateType = typeof context.candidateType === 'string' ? context.candidateType : '未知'
      const candidateRating = typeof context.candidateRating === 'number' || typeof context.candidateRating === 'string'
        ? String(context.candidateRating)
        : '未知'

      userPrompt = `【选择解释】
- 选中节目: ${targetName} (ID: ${targetId})
- 空窗时长: ${gapDuration !== undefined ? this.formatDuration(gapDuration) : '未知'}
- 节目时长: ${candidateDuration !== undefined ? this.formatDuration(candidateDuration) : '未知'}
- 节目类型: ${candidateType}
- 收视率: ${candidateRating}

请解释为什么选择这个节目。`
    } else if (type === 'validation_issue') {
      systemPrompt = `[prompt ${PROMPT_BUILDER_VERSION}] 你是一位电视节目编排专家。
请解释校验问题的含义和影响。

输出要求：
- 用自然语言解释
- 说明问题的影响
- 提供解决建议

输出格式：纯文本，不需要 JSON`

      userPrompt = `【问题解释】
- 问题类型: ${context.issueType || '未知'}
- 问题描述: ${context.issueMessage || '未知'}
- 严重程度: ${context.severity || '未知'}
- 位置: ${context.location || '未知'}

请解释这个问题及其影响。`
    }

    return [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ]
  }

  /**
   * 构建任务判别 Prompt
   * 用于识别用户意图和任务类型
   */
  buildTaskClassificationPrompt(params: {
    userInput: string
    scheduleState: {
      channelId: string
      channelName: string
      date: string
      isEmpty: boolean
      itemCount: number
      gapCount: number
      hasSelectedTimeRange: boolean
    }
    history?: string[]
  }): ChatMessage[] {
    const { userInput, scheduleState, history } = params

    const systemPrompt = `[prompt ${PROMPT_BUILDER_VERSION}] 你是一位电视节目编排系统的任务判别助手。
你的职责是分析用户意图和当前节目单状态，准确判断任务类型。

可选任务模式：
1. full_generate - 从零生成完整编排单（节目单为空或用户要求重新生成全天）
2. partial_generate - 对当前空窗自动补排（存在空窗，需要自动填充）
3. micro_edit - 局部增删改查（插入、删除、替换、移动某条节目）
4. validate_only - 只执行校验（检查编排是否正确）
5. repair_only - 只执行修复（修复已知问题）
6. clarify - 语义不明确，需要向用户澄清

判别原则：
- 优先根据用户明确意图判断
- 结合节目单当前状态
- 如果不确定，选择 clarify

输出必须是 JSON 格式：
{
  "mode": "任务模式",
  "confidence": 0.95,
  "reasoning": "判别理由",
  "suggestedParams": {
    "userIntent": "解析后的用户意图",
    "targetGaps": ["目标空窗ID"],
    "targetItems": ["目标条目ID"]
  }
}`

    const userPrompt = `【当前节目单状态】
- 频道：${scheduleState.channelName} (${scheduleState.channelId})
- 日期：${scheduleState.date}
- 节目单状态：${scheduleState.isEmpty ? '空表' : '已有内容'}
- 已编排条目数：${scheduleState.itemCount}
- 当前空窗数：${scheduleState.gapCount}
- 是否有选中时间段：${scheduleState.hasSelectedTimeRange ? '是' : '否'}

【用户输入】
${userInput}

${history ? `【历史对话】\n${history.join('\n')}` : ''}

请判断任务类型，输出 JSON 格式。`

    return [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ]
  }

  // ==================== 辅助方法 ====================

  /**
   * 格式化时长为可读字符串
   */
  private formatDuration(seconds: number): string {
    const hours = Math.floor(seconds / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    const secs = seconds % 60

    if (hours > 0) {
      return `${hours}小时${minutes}分${secs}秒`
    } else if (minutes > 0) {
      return `${minutes}分${secs}秒`
    } else {
      return `${secs}秒`
    }
  }

  /**
   * 构建局部上下文摘要
   * 用于限制上下文长度
   */
  buildLocalContextSummary(params: {
    gap: GapInfo
    precedingItem?: ScheduleItemSnapshot
    followingItem?: ScheduleItemSnapshot
    recentItems?: ScheduleItemSnapshot[]
  }): string {
    const { gap, precedingItem, followingItem, recentItems } = params

    const parts: string[] = []

    // 当前空窗
    parts.push(`【当前空窗】${gap.startTime} - ${gap.endTime} (${this.formatDuration(gap.duration)})`)

    // 前邻条目
    if (precedingItem) {
      parts.push(`【前邻】${precedingItem.programName} (${precedingItem.programType})`)
    }

    // 后邻条目
    if (followingItem) {
      parts.push(`【后邻】${followingItem.programName} (${followingItem.programType})`)
    }

    // 最近条目（限制数量）
    if (recentItems && recentItems.length > 0) {
      const limited = recentItems.slice(-5)
      parts.push(`【最近已排】${limited.map(i => i.programName).join(', ')}`)
    }

    return parts.join('\n')
  }
}

// 导出单例工厂函数
let globalPromptBuilder: PromptBuilder | null = null

export function getPromptBuilder(): PromptBuilder {
  if (!globalPromptBuilder) {
    globalPromptBuilder = new PromptBuilder()
  }
  return globalPromptBuilder
}

export function resetPromptBuilder(): void {
  globalPromptBuilder = null
}

export const promptBuilder = getPromptBuilder()
