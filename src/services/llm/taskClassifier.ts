/**
 * 任务判别器
 * 统一识别任务类型，支持6种模式：
 * - full_generate: 从零生成完整编排单
 * - partial_generate: 对当前空窗自动补排
 * - micro_edit: 局部增删改查
 * - validate_only: 只执行校验
 * - repair_only: 只执行修复
 * - clarify: 语义不明确，需澄清
 */

import type {
  TaskClassification,
  TaskMode,
  ScheduleState,
  RiskAssessment,
  RiskLevel,
} from '@/types/orchestration'
import type { ChatMessage } from '@/types/llm'
import { LLMClient } from './llmClient'

/** 任务判别输入 */
export interface TaskClassifierInput {
  scheduleState: ScheduleState
  userInput: string
  history?: string[]
}

/** 任务判别器配置 */
export interface TaskClassifierConfig {
  confidenceThreshold: number
  defaultMode: TaskMode
  enableClarification: boolean
}

/** 默认配置 */
const DEFAULT_CONFIG: TaskClassifierConfig = {
  confidenceThreshold: 0.7,
  defaultMode: 'clarify',
  enableClarification: true,
}

/** 任务判别器 */
export class TaskClassifier {
  private llmClient: LLMClient
  private config: TaskClassifierConfig

  constructor(llmClient: LLMClient, config?: Partial<TaskClassifierConfig>) {
    this.llmClient = llmClient
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * 判别任务类型
   */
  async classify(input: TaskClassifierInput): Promise<TaskClassification> {
    // 1. 基于规则快速判别
    const ruleBasedResult = this.ruleBasedClassification(input)
    if (ruleBasedResult.confidence >= this.config.confidenceThreshold) {
      return ruleBasedResult
    }

    // 2. 使用 LLM 进行语义判别
    const llmResult = await this.llmBasedClassification(input)
    
    // 3. 融合结果
    return this.mergeResults(ruleBasedResult, llmResult)
  }

  /**
   * 基于规则的快速判别
   */
  private ruleBasedClassification(input: TaskClassifierInput): TaskClassification {
    const { scheduleState, userInput } = input
    const lowerInput = userInput.toLowerCase()

    // 空节目单 + 生成意图 = full_generate
    if (scheduleState.isEmpty && this.hasGenerateIntent(lowerInput)) {
      return {
        mode: 'full_generate',
        confidence: 0.9,
        reasoning: '节目单为空且用户表达生成意图',
      }
    }

    // 校验关键词 = validate_only
    if (this.hasValidateIntent(lowerInput)) {
      return {
        mode: 'validate_only',
        confidence: 0.85,
        reasoning: '用户明确表达校验意图',
      }
    }

    // 修复关键词 = repair_only
    if (this.hasRepairIntent(lowerInput)) {
      return {
        mode: 'repair_only',
        confidence: 0.85,
        reasoning: '用户明确表达修复意图',
      }
    }

    // 增删改关键词 = micro_edit
    if (this.hasEditIntent(lowerInput)) {
      return {
        mode: 'micro_edit',
        confidence: 0.8,
        reasoning: '用户表达编辑意图',
        suggestedParams: {
          userIntent: this.extractEditIntent(lowerInput),
        },
      }
    }

    // 有空窗 + 补排关键词 = partial_generate
    if (scheduleState.gapCount > 0 && this.hasFillIntent(lowerInput)) {
      return {
        mode: 'partial_generate',
        confidence: 0.8,
        reasoning: '存在空窗且用户表达补排意图',
      }
    }

    // 默认需要澄清
    return {
      mode: 'clarify',
      confidence: 0.5,
      reasoning: '无法通过规则明确判别用户意图',
    }
  }

  /**
   * 基于 LLM 的语义判别
   */
  private async llmBasedClassification(
    input: TaskClassifierInput,
  ): Promise<TaskClassification> {
    const messages = this.buildClassificationPrompt(input)

    try {
      const response = await this.llmClient.chat(messages, {
        temperature: 0.3, // 低温度，更确定性
        maxTokens: 500,
      })

      return this.parseClassificationResponse(response.content)
    } catch (error) {
      console.error('LLM classification failed:', error)
      return {
        mode: 'clarify',
        confidence: 0,
        reasoning: 'LLM 判别失败，需要澄清',
      }
    }
  }

  /**
   * 构建判别 Prompt
   */
  private buildClassificationPrompt(input: TaskClassifierInput): ChatMessage[] {
    const { scheduleState, userInput, history } = input

    const systemPrompt = `你是一位电视节目编排系统的任务判别助手。
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

  /**
   * 解析 LLM 响应
   */
  private parseClassificationResponse(content: string): TaskClassification {
    try {
      // 提取 JSON
      const jsonMatch = content.match(/\{[\s\S]*\}/)
      if (!jsonMatch) {
        throw new Error('No JSON found in response')
      }

      const result = JSON.parse(jsonMatch[0])

      // 验证模式有效性
      const validModes: TaskMode[] = [
        'full_generate',
        'partial_generate',
        'micro_edit',
        'validate_only',
        'repair_only',
        'clarify',
      ]

      if (!validModes.includes(result.mode)) {
        throw new Error(`Invalid mode: ${result.mode}`)
      }

      return {
        mode: result.mode,
        confidence: result.confidence || 0.5,
        reasoning: result.reasoning || '',
        suggestedParams: result.suggestedParams,
      }
    } catch (error) {
      console.error('Failed to parse classification response:', error)
      return {
        mode: 'clarify',
        confidence: 0,
        reasoning: '解析响应失败，需要澄清',
      }
    }
  }

  /**
   * 融合规则和 LLM 结果
   */
  private mergeResults(
    ruleResult: TaskClassification,
    llmResult: TaskClassification,
  ): TaskClassification {
    // 如果规则判别置信度高，优先使用规则结果
    if (ruleResult.confidence >= 0.85) {
      return ruleResult
    }

    // 如果 LLM 判别置信度高，使用 LLM 结果
    if (llmResult.confidence >= this.config.confidenceThreshold) {
      return llmResult
    }

    // 如果两者一致，合并置信度
    if (ruleResult.mode === llmResult.mode) {
      return {
        mode: ruleResult.mode,
        confidence: Math.max(ruleResult.confidence, llmResult.confidence),
        reasoning: `${ruleResult.reasoning}; ${llmResult.reasoning}`,
        suggestedParams: { ...ruleResult.suggestedParams, ...llmResult.suggestedParams },
      }
    }

    // 不一致时，如果 LLM 置信度明显高于规则，使用 LLM
    if (llmResult.confidence > ruleResult.confidence + 0.2) {
      return llmResult
    }

    // 否则需要澄清
    return {
      mode: 'clarify',
      confidence: 0.5,
      reasoning: `规则判别为 ${ruleResult.mode}，LLM 判别为 ${llmResult.mode}，存在歧义需要澄清`,
      suggestedParams: {
        userIntent: '需要澄清用户意图',
      },
    }
  }

  /**
   * 评估风险等级
   */
  assessRisk(input: TaskClassifierInput): RiskAssessment {
    const { scheduleState, userInput } = input
    const factors: string[] = []
    let level: RiskLevel = 'low'

    // 评估影响范围
    const lowerInput = userInput.toLowerCase()

    // 批量操作风险
    if (lowerInput.includes('全部') || lowerInput.includes('所有') || lowerInput.includes('批量')) {
      factors.push('涉及批量操作')
      level = 'high'
    }

    // 长时间段风险
    if (lowerInput.includes('全天') || lowerInput.includes('整天')) {
      factors.push('影响长时间段')
      if (level !== 'high') level = 'medium'
    }

    // 删除操作风险
    if (lowerInput.includes('删除') || lowerInput.includes('清空')) {
      factors.push('涉及删除操作')
      level = 'high'
    }

    // 已有内容风险
    if (!scheduleState.isEmpty && lowerInput.includes('生成')) {
      factors.push('节目单已有内容，重新生成可能覆盖')
      level = 'high'
    }

    // 高风险命令
    if (this.hasHighRiskCommand(lowerInput)) {
      factors.push('涉及高风险命令')
      level = 'high'
    }

    return {
      level,
      factors: factors.length > 0 ? factors : ['无明显风险因素'],
    }
  }

  // ==================== 意图识别辅助方法 ====================

  private hasGenerateIntent(input: string): boolean {
    const keywords = ['生成', '编排', '排期', '创建', '制作', '排表', '自动排', 'ai排']
    return keywords.some((k) => input.includes(k))
  }

  private hasValidateIntent(input: string): boolean {
    const keywords = ['校验', '检查', '验证', '核对', '审查', '查看问题']
    return keywords.some((k) => input.includes(k))
  }

  private hasRepairIntent(input: string): boolean {
    const keywords = ['修复', '修正', '改正', '解决', '处理', '自动修复']
    return keywords.some((k) => input.includes(k))
  }

  private hasEditIntent(input: string): boolean {
    const keywords = ['插入', '删除', '替换', '移动', '修改', '调整', '改成', '换成', '添加']
    return keywords.some((k) => input.includes(k))
  }

  private hasFillIntent(input: string): boolean {
    const keywords = ['补', '填', '填充', '补齐', '补排', '补上', '自动补']
    return keywords.some((k) => input.includes(k))
  }

  private hasHighRiskCommand(input: string): boolean {
    const keywords = ['批量替换', '批量删除', '全部删除', '清空', '重置', '覆盖']
    return keywords.some((k) => input.includes(k))
  }

  private extractEditIntent(input: string): string {
    // 提取编辑意图的简化描述
    if (input.includes('插入')) return '插入节目'
    if (input.includes('删除')) return '删除节目'
    if (input.includes('替换')) return '替换节目'
    if (input.includes('移动')) return '移动节目'
    if (input.includes('修改')) return '修改节目属性'
    return '编辑操作'
  }
}

// 导出单例工厂函数
let globalClassifier: TaskClassifier | null = null

export function getTaskClassifier(llmClient?: LLMClient): TaskClassifier {
  if (!globalClassifier) {
    if (!llmClient) {
      throw new Error('LLM client is required for first initialization')
    }
    globalClassifier = new TaskClassifier(llmClient)
  }
  return globalClassifier
}

export function resetTaskClassifier(): void {
  globalClassifier = null
}
