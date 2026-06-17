import type {
  RiskAssessment,
  RiskLevel,
  ScheduleState,
  TaskClassification,
  TaskMode,
} from '@/types/orchestration'
import type { ChatMessage } from '@/types/llm'
import { looksLikeProgramSchedulingRequest, parseSchedulingTimeRange } from '@/services/schedulingIntentHeuristics'
import { LLMClient } from './llmClient'

export interface TaskClassifierInput {
  scheduleState: ScheduleState
  userInput: string
  history?: string[]
}

export interface TaskClassifierConfig {
  confidenceThreshold: number
  defaultMode: TaskMode
  enableClarification: boolean
}

const DEFAULT_CONFIG: TaskClassifierConfig = {
  confidenceThreshold: 0.7,
  defaultMode: 'clarify',
  enableClarification: true,
}

const LAYOUT_SCOPE_KEYWORDS = [
  '全天',
  '整天',
  '全日',
  '上午',
  '中午',
  '午间',
  '下午',
  '晚间',
  '晚上',
  '夜间',
  '深夜',
  '凌晨',
]

const LAYOUT_CONTENT_KEYWORDS = [
  '电视剧',
  '剧场',
  '黄金剧场',
  '新闻',
  '资讯',
  '评论',
  '健康',
  '娱乐',
  '综艺',
  '少儿',
  '纪录片',
  '电影',
  '民生',
]

export class TaskClassifier {
  private llmClient: LLMClient
  private config: TaskClassifierConfig

  constructor(llmClient: LLMClient, config?: Partial<TaskClassifierConfig>) {
    this.llmClient = llmClient
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  async classify(input: TaskClassifierInput): Promise<TaskClassification> {
    const ruleBasedResult = this.ruleBasedClassification(input)
    const llmResult = await this.llmBasedClassification(input)
    return this.normalizeRotationDurationScope(
      this.mergeResults(ruleBasedResult, llmResult),
      input.userInput,
    )
  }

  assessRisk(input: TaskClassifierInput): RiskAssessment {
    const normalized = this.normalizeInput(input.userInput)
    const factors: string[] = []
    let level: RiskLevel = 'low'

    if (this.hasAny(normalized, ['全部', '所有', '整天', '全天', '批量'])) {
      factors.push('涉及较大范围的批量操作')
      level = 'high'
    }

    if (this.hasAny(normalized, ['删除', '清空'])) {
      factors.push('包含删除类操作')
      level = 'high'
    }

    if (this.shouldPrepareLayout(normalized) || this.shouldRefineLayout(normalized)) {
      factors.push('操作对象是版面结构，可能影响后续整段编排结果')
      if (level !== 'high') {
        level = 'medium'
      }
    }

    if (!input.scheduleState.isEmpty && this.hasAny(normalized, ['生成', '重排', '重新编排'])) {
      factors.push('当前节目单已有内容，重新编排可能覆盖已有结果')
      level = 'high'
    }

    return {
      level,
      factors: factors.length > 0 ? factors : ['未发现明显高风险因素'],
    }
  }

  private ruleBasedClassification(input: TaskClassifierInput): TaskClassification {
    const { scheduleState, userInput } = input
    const normalized = this.normalizeInput(userInput)
    const targetTimeRange = this.extractTimeRange(normalized)

    if (this.isClearlyOutsideSchedulingDomain(normalized, userInput)) {
      return {
        mode: 'clarify',
        confidence: 0.94,
        reasoning: '当前只支持电视、广播、新媒体轮播、演播室等节目编排相关任务；该请求与节目编排无关，已拒绝进入编排流程。',
      }
    }

    if (this.isBareConfirmation(normalized)) {
      return {
        mode: 'clarify',
        confidence: 0.9,
        reasoning: '检测到空确认表达，但缺少明确的版面草案或编排对象引用，需要先确认用户要执行哪一个编排方案。',
      }
    }

    if (this.shouldCommitLayout(normalized)) {
      return {
        mode: 'layout_commit',
        confidence: 0.95,
        reasoning: '用户正在确认当前版面草案，并希望据此开始编排。',
      }
    }

    if (this.hasLayoutAnalysisIntent(normalized)) {
      return {
        mode: 'layout_analysis',
        confidence: 0.94,
        reasoning: '用户明确希望从业务视角分析当前版面编排，应先输出分析报告，再决定是否进入优化草案流程。',
      }
    }

    if (this.hasLayoutOptimizationIntent(normalized)) {
      return {
        mode: 'layout_prepare',
        confidence: 0.9,
        reasoning: '用户明确提出优化当前版面编排，按产品流程应先生成一份新的待确认版面草案。',
        suggestedParams: {
          userIntent: userInput.trim() || '优化当前版面编排',
          ignoreExistingLayout: true,
          targetTimeRange,
        },
      }
    }

    if (this.isVagueLayoutRequest(normalized)) {
      return {
        mode: 'clarify',
        confidence: looksLikeProgramSchedulingRequest(userInput) ? 0.55 : 0.92,
        reasoning: looksLikeProgramSchedulingRequest(userInput)
          ? '检测到节目编排相关表达，但规则信息不足，应交给 LLM 判断是生成草案还是追问。'
          : '检测到版面相关表达，但缺少明确范围或内容偏好，需要先补充版面信息。',
      }
    }

    if (this.shouldStartOrchestrationFromLayout(normalized, scheduleState)) {
      return {
        mode: 'layout_prepare',
        confidence: 0.92,
        reasoning: '用户正在发起编排或补排流程，按产品规则应先生成待确认的版面草案。',
        suggestedParams: {
          userIntent: userInput.trim() || '生成版面草案',
          targetTimeRange: targetTimeRange ?? (scheduleState.isEmpty ? { start: '06:00:00', end: '23:59:59' } : undefined),
        },
      }
    }

    if (this.hasValidateIntent(normalized)) {
      return {
        mode: 'validate_only',
        confidence: 0.85,
        reasoning: '用户明确要求执行校验。',
      }
    }

    if (this.hasRepairIntent(normalized)) {
      return {
        mode: 'validate_only',
        confidence: 0.88,
        reasoning: '用户提到了修复，但当前产品流程会先输出问题分析结果，再决定后续处理方案。',
      }
    }

    if (
      looksLikeProgramSchedulingRequest(userInput)
      && !LAYOUT_CONTENT_KEYWORDS.some((keyword) => normalized.includes(keyword))
    ) {
      return {
        mode: 'clarify',
        confidence: 0.55,
        reasoning: '检测到节目编排领域的开放标签，固定规则不足以安全区分版面草案、草案调整或追问，应交给 LLM 判别。',
        suggestedParams: {
          userIntent: userInput.trim(),
          targetTimeRange,
        },
      }
    }

    if (
      this.matchesActualLayoutScope(normalized)
      && this.matchesActualLayoutContent(normalized)
      && this.matchesActualLayoutRefineVerb(normalized)
      && this.matchesActualLayoutContext(normalized)
    ) {
      return {
        mode: 'layout_refine',
        confidence: 0.95,
        reasoning: '检测到用户正在用自然语言微调当前版面草案。',
        suggestedParams: {
          userIntent: this.extractLayoutIntent(normalized),
          targetTimeRange,
          ignoreExistingLayout:
            this.shouldIgnoreExistingLayout(normalized) || this.matchesExplicitIgnoreCurrentLayout(normalized),
        },
      }
    }

    if (
      (this.matchesActualLayoutScope(normalized) && this.matchesActualLayoutContent(normalized))
      || (
        this.matchesActualLayoutContent(normalized)
        && (this.matchesActualLayoutPrepareVerb(normalized) || this.matchesExplicitIgnoreCurrentLayout(normalized))
      )
    ) {
      return {
        mode: 'layout_prepare',
        confidence: 0.95,
        reasoning: '检测到用户正在描述一份新的版面草案需求。',
        suggestedParams: {
          userIntent: this.extractLayoutIntent(normalized),
          targetTimeRange,
          ignoreExistingLayout:
            this.shouldIgnoreExistingLayout(normalized) || this.matchesExplicitIgnoreCurrentLayout(normalized),
        },
      }
    }

    if (this.shouldRefineLayout(normalized)) {
      return {
        mode: 'layout_refine',
        confidence: 0.9,
        reasoning: '用户正在对已有版面草案做局部调整。',
        suggestedParams: {
          userIntent: this.extractLayoutIntent(normalized),
          targetTimeRange,
          ignoreExistingLayout:
            this.shouldIgnoreExistingLayout(normalized) || this.matchesExplicitIgnoreCurrentLayout(normalized),
        },
      }
    }

    if (this.shouldPrepareLayout(normalized)) {
      return {
        mode: 'layout_prepare',
        confidence: 0.92,
        reasoning: '用户明确提出了按内容要求生成或覆盖版面的需求。',
        suggestedParams: {
          userIntent: this.extractLayoutIntent(normalized),
          targetTimeRange,
          ignoreExistingLayout:
            this.shouldIgnoreExistingLayout(normalized) || this.matchesExplicitIgnoreCurrentLayout(normalized),
        },
      }
    }

    if (looksLikeProgramSchedulingRequest(userInput)) {
      return {
        mode: 'clarify',
        confidence: 0.55,
        reasoning: LAYOUT_CONTENT_KEYWORDS.some((keyword) => normalized.includes(keyword))
          ? '检测到节目编排领域的开放表达，但规则信息不足，应交给 LLM 映射到版面草案、草案调整或追问。'
          : '检测到节目编排领域的开放标签，固定规则不足以安全区分版面草案、草案调整或追问，应交给 LLM 判别。',
        suggestedParams: {
          userIntent: userInput.trim(),
          targetTimeRange,
        },
      }
    }

    if (this.hasEditIntent(normalized)) {
      return {
        mode: 'clarify',
        confidence: 0.9,
        reasoning: '用户像是在调整具体节目条目，但当前描述还没有形成可执行的原子命令，需要补充更精确的时间点或节目名称。',
        suggestedParams: {
          userIntent: `请补充更精确的节目调整信息：${this.extractEditIntent(normalized)}`,
          targetTimeRange,
        },
      }
    }

    if (scheduleState.gapCount > 0 && this.hasStrongFillIntent(normalized)) {
      return {
        mode: 'layout_prepare',
        confidence: 0.9,
        reasoning: '用户明确要求补齐当前空窗，按产品流程应先生成待确认的版面草案。',
        suggestedParams: {
          userIntent: userInput.trim() || '补齐当前空窗',
        },
      }
    }

    if (scheduleState.gapCount > 0 && this.hasWeakFillIntent(normalized)) {
      return {
        mode: 'clarify',
        confidence: 0.55,
        reasoning: '用户可能在表达补空窗，但目标范围还不够清晰，需要进一步确认。',
      }
    }

    return {
      mode: 'clarify',
      confidence: 0.5,
      reasoning: '无法通过规则明确判断用户当前任务意图。',
    }
  }

  private async llmBasedClassification(
    input: TaskClassifierInput,
  ): Promise<TaskClassification> {
    const messages = this.buildClassificationPrompt(input)

    try {
      const response = await this.llmClient.chat(messages, {
        temperature: 0.3,
        maxTokens: 500,
        timeout: 8000,
        maxRetries: 1,
        traceLabel: 'task_classification',
      })

      return this.parseClassificationResponse(response.content)
    } catch (error) {
      console.error('LLM classification failed:', error)
      return {
        mode: 'clarify',
        confidence: 0,
        reasoning: 'LLM 分类失败，需要进一步澄清。',
      }
    }
  }

  private buildClassificationPrompt(input: TaskClassifierInput): ChatMessage[] {
    const { scheduleState, userInput, history } = input

    const systemPrompt = `你是电视播单系统的任务分类助手。请根据用户输入和当前节目单状态，把任务归类为以下模式之一：
1. layout_prepare：先准备版面草案，再让用户确认
2. layout_refine：微调当前版面草案
3. layout_commit：用户确认当前版面草案，可以开始编排
4. layout_analysis：分析当前实际编排并输出业务报告
5. validate_only：仅做校验或问题分析
6. clarify：信息不足，需要追问

识别原则：
- 原子节目单命令（插入、删除、移动、替换）已经在上游处理，这里不要再返回 micro_edit。
- 用户提到“全天编排”“补齐空窗”“填充节目单”这类启动编排的话术时，也要先返回 layout_prepare，而不是直接执行编排。
- 如果用户在描述“某个时段按某类内容铺排版面”，优先判断为 layout_prepare 或 layout_refine。
- 如果用户说“准备一个/制作一份/生成一份”某个时长的轮播单、直播轮播单、户外直播轮播单，轮播单只表示总时长，不绑定具体日期和频道时间段；例如“14:00到15:00的静安寺户外直播轮播单”应理解为总时长 1 小时，从 0 点起算。
- 对地点、活动、户外直播等开放业务短语，不要要求用户改成固定节目类型；可把 suggestedParams.userIntent 保留为原始业务意图。电视播单可给 targetTimeRange；轮播单不要给 targetTimeRange，应给 rotationDurationSeconds。
- 对节目单、编排单、串联单、特别报道、主题活动、商圈/会场直播、节庆/赛事预热等开放业务话术，只要用户是在请求排播、生成、补排、调整、校验、分析或修复，都必须映射到上述已有模式；信息不足时返回 clarify，但不要当成非编排闲聊。
- 只处理电视、广播、新媒体轮播、演播室、节目单/版面/素材排播相关任务。写文案、订票、股票、天气查询、写代码、做 PPT、做海报、闲聊等非编排域请求返回 clarify，并说明不进入编排流程。
- 如果用户要求“分析当前版面编排/当前节目单结构/从编辑视角出报告”，返回 layout_analysis。
- 如果用户要求“优化当前版面/优化当前编排”，优先返回 layout_prepare，让系统先生成新的版面草案。
- 如果用户像是在调整具体节目条目，但缺少足够的时间点、节目名或动作参数，返回 clarify。
- 如果用户表达过于模糊，例如既没有范围也没有内容偏好，返回 clarify。

请只输出 JSON：
{
  "mode": "任务模式",
  "confidence": 0.95,
  "reasoning": "判断理由",
  "suggestedParams": {
    "userIntent": "解析后的用户意图",
    "targetTimeRange": { "start": "13:00:00", "end": "18:00:00" },
    "rotationDurationSeconds": 3600,
    "ignoreExistingLayout": false
  }
}`

    const userPrompt = `【当前节目单状态】
- 频道: ${scheduleState.channelName} (${scheduleState.channelId})
- 日期: ${scheduleState.date}
- 节目单状态: ${scheduleState.isEmpty ? '空表' : '已有内容'}
- 已编排条目数: ${scheduleState.itemCount}
- 当前空窗数: ${scheduleState.gapCount}
- 是否有选中时间段: ${scheduleState.hasSelectedTimeRange ? '是' : '否'}

【用户输入】
${userInput}

${history?.length ? `【历史对话】\n${history.join('\n')}` : ''}`

    return [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ]
  }

  private parseClassificationResponse(content: string): TaskClassification {
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/)
      if (!jsonMatch) {
        throw new Error('No JSON found in response')
      }

      const result = JSON.parse(jsonMatch[0])
      const validModes: TaskMode[] = ['validate_only', 'repair_only', 'layout_analysis', 'clarify', 'layout_prepare', 'layout_refine', 'layout_commit', 'full_generate', 'partial_generate', 'micro_edit']

      if (!validModes.includes(result.mode)) {
        throw new Error(`Invalid mode: ${result.mode}`)
      }

      return this.normalizeLegacyLlmClassification({
        mode: result.mode,
        confidence: typeof result.confidence === 'number' ? result.confidence : 0.5,
        reasoning: result.reasoning || '',
        suggestedParams: result.suggestedParams,
      })
    } catch (error) {
      console.error('Failed to parse classification response:', error)
      return {
        mode: 'clarify',
        confidence: 0,
        reasoning: '解析分类结果失败，需要进一步澄清。',
      }
    }
  }

  private mergeResults(
    ruleResult: TaskClassification,
    llmResult: TaskClassification,
  ): TaskClassification {
    if (llmResult.confidence >= 0.6) {
      return {
        ...llmResult,
        suggestedParams: {
          ...ruleResult.suggestedParams,
          ...llmResult.suggestedParams,
          targetTimeRange:
            llmResult.suggestedParams?.targetTimeRange
            ?? ruleResult.suggestedParams?.targetTimeRange,
        },
      }
    }

    return ruleResult

    if (ruleResult.confidence >= 0.85) {
      return ruleResult
    }

    if (llmResult.confidence >= this.config.confidenceThreshold) {
      return {
        ...llmResult,
        suggestedParams: {
          ...ruleResult.suggestedParams,
          ...llmResult.suggestedParams,
          targetTimeRange:
            llmResult.suggestedParams?.targetTimeRange
            ?? ruleResult.suggestedParams?.targetTimeRange,
        },
      }
    }

    if (ruleResult.mode === llmResult.mode) {
      return {
        mode: ruleResult.mode,
        confidence: Math.max(ruleResult.confidence, llmResult.confidence),
        reasoning: `${ruleResult.reasoning}; ${llmResult.reasoning}`,
        suggestedParams: { ...ruleResult.suggestedParams, ...llmResult.suggestedParams },
      }
    }

    return {
      mode: 'clarify',
      confidence: 0.5,
      reasoning: `规则分类为 ${ruleResult.mode}，LLM 分类为 ${llmResult.mode}，当前存在歧义，需要用户进一步确认。`,
      suggestedParams: {
        userIntent: '需要补充更明确的范围、内容类型或是否沿用现有版面。',
      },
    }
  }

  private normalizeInput(input: string): string {
    return input.trim().toLowerCase().replace(/\s+/g, '')
  }

  private hasAny(input: string, keywords: string[]): boolean {
    return keywords.some((keyword) => input.includes(keyword))
  }

  private isClearlyOutsideSchedulingDomain(normalized: string, rawInput: string): boolean {
    const nonSchedulingPatterns = [
      /写.*(文案|文章|新闻稿|稿子|脚本|代码)/,
      /(生成|做|制作|设计|画).*(ppt|幻灯片|海报|图片|图|logo|表情包)/i,
      /(订|买|预订).*(票|机票|火车票|酒店|咖啡|外卖|餐)/,
      /(股票|基金|汇率|财报|理财|投资)/,
      /(天气怎么样|查.*天气|今天.*天气|明天.*天气)/,
      /(开.*会|会议纪要|会议材料|发布会材料|简历|邮件|合同|论文)/,
      /(按钮|页面|背景|颜色|滤镜|动画|ui|界面)/i,
      /^(你好|谢谢|辛苦了|在吗|hello|hi)$/i,
    ]
    const hasNonSchedulingRequest = nonSchedulingPatterns.some((pattern) => pattern.test(normalized))
    const hasNonSchedulingArtifact = /(文案|文章|新闻稿|稿子|脚本|代码|ppt|幻灯片|海报|图片|logo|表情包|票|机票|火车票|酒店|咖啡|外卖|餐|股票|基金|汇率|财报|理财|投资|天气|会议纪要|会议材料|发布会材料|简历|邮件|合同|论文|按钮|页面|背景|颜色|滤镜|动画|ui|界面)/i.test(normalized)
    if (hasNonSchedulingRequest && hasNonSchedulingArtifact) return true

    const hasSchedulingWorkflow = /(?:编排|排播|播出|补排|排入|插播|顺播|校验|检查|核对|审查|修复|分析|优化).*(?:节目单|节目|编排单|串联单|播单|轮播单|直播单|版面|栏目|时段|空窗|空缺)|(?:节目单|节目|编排单|串联单|播单|轮播单|直播单|版面|栏目|时段|空窗|空缺).*(?:编排|排播|播出|补排|排入|插播|顺播|校验|检查|核对|审查|修复|分析|优化)/.test(normalized)
    if (hasNonSchedulingRequest && !hasSchedulingWorkflow) return true
    if (looksLikeProgramSchedulingRequest(rawInput)) return false

    const hasSchedulingContext = this.hasAny(normalized, [
      '节目',
      '节目单',
      '编排',
      '编排单',
      '串联单',
      '播单',
      '轮播单',
      '直播单',
      '版面',
      '栏目',
      '演播室',
      '排播',
      '播出',
      '素材',
      '空窗',
      '空缺',
    ])
    if (hasSchedulingContext) return false

    return hasNonSchedulingRequest
  }

  private hasGenerateIntent(input: string): boolean {
    return this.hasAny(input, ['生成', '编排', '排期', '创建', '制作', '排表', '自动排', 'ai排'])
  }

  private hasValidateIntent(input: string): boolean {
    return this.hasAny(input, ['校验', '检查', '验证', '核对', '审查', '体检', '查看问题', '看看问题', '有没有问题', '有无问题', '找出问题', '排查问题', '查问题', '查一下', '查查', '看看', '看一下'])
      || /(?:有没有|有无).*(?:问题|空窗|空缺|冲突|重叠|风险|断档)/.test(input)
  }

  private hasLayoutAnalysisIntent(input: string): boolean {
    const hasAnalysisVerb = this.hasAny(input, ['分析', '评估', '研判', '诊断', '梳理', '复盘'])
    const hasLayoutTarget = this.hasAny(input, ['当前版面', '版面编排', '当前编排', '当前节目单', '节目单编排', '节目编排', '编排情况', '播单', '编排单', '串联单'])
    const hasEditorialCue = /编辑视角|业务分析|业务视角|编导视角|文字版报告|分析报告/.test(input)
    return (hasAnalysisVerb && hasLayoutTarget) || (hasLayoutTarget && hasEditorialCue) || (hasAnalysisVerb && hasEditorialCue)
  }

  private hasLayoutOptimizationIntent(input: string): boolean {
    const hasOptimizeVerb = this.hasAny(input, ['优化', '调优', '重构', '重新梳理', '重做'])
    const hasTarget = this.hasAny(input, ['当前版面', '版面', '当前编排', '编排', '节目单'])
    return hasOptimizeVerb && hasTarget
  }

  private hasRepairIntent(input: string): boolean {
    return this.hasAny(input, ['修复', '修正', '改正', '解决', '处理问题', '自动修复', '修一下', '修一修', '修掉', '消掉', '处理掉'])
  }

  private hasEditIntent(input: string): boolean {
    return this.hasAny(input, ['插入', '删除', '替换', '移动', '修改', '调整', '改成', '换成', '添加', '顺一下', '挪一下'])
  }

  private hasStrongFillIntent(input: string): boolean {
    const exactKeywords = [
      '补齐空窗',
      '补空窗',
      '补掉空窗',
      '空窗补排',
      '补排',
      '自动补排',
      '补齐当前所有空窗',
      '补齐当前空窗',
      '填充节目单',
      '补齐编单',
      '补全编单',
      '填满节目单',
    ]

    if (exactKeywords.some((keyword) => input.includes(keyword))) {
      return true
    }

    const hasDomainTarget = ['空窗', '节目单', '编单'].some((keyword) => input.includes(keyword))
    const hasFillVerb = ['补齐', '补全', '填充', '补上', '补掉'].some((keyword) => input.includes(keyword))
    return hasDomainTarget && hasFillVerb
  }

  private hasWeakFillIntent(input: string): boolean {
    return this.hasAny(input, ['补', '填', '填补', '补一补', '补一个', '空白位置', '空位'])
  }

  private shouldStartOrchestrationFromLayout(input: string, scheduleState: ScheduleState): boolean {
    if (
      input.includes('帮我全天编排')
      || input.includes('全天编排')
      || input.includes('整天编排')
      || input.includes('帮我填充全天节目')
      || input.includes('填充全天节目')
    ) {
      return true
    }

    if (scheduleState.gapCount > 0 && this.hasStrongFillIntent(input)) {
      return true
    }

    return scheduleState.isEmpty && this.hasGenerateIntent(input)
  }

  private shouldPrepareLayout(input: string): boolean {
    const hasScope = this.hasLayoutScope(input)
    const hasContent = this.hasLayoutContent(input)
    const hasLayoutVerb = this.hasAny(input, [
      '版面',
      '单独排版',
      '独立排版',
      '局部排版',
      '不要参考已有版面',
      '不参考已有版面',
      '按',
      '全部排入',
      '都排',
      '都改成',
      '统一成',
    ])

    return (hasScope && hasContent) || (hasContent && hasLayoutVerb)
  }

  private shouldRefineLayout(input: string): boolean {
    const hasScope = this.hasLayoutScope(input)
    const hasContent = this.hasLayoutContent(input)
    const hasRefineVerb = this.hasAny(input, ['改成', '换成', '调整为', '改为', '替换成', '变成'])
    const hasLayoutContext = this.hasAny(input, ['版面', '时段', '下午', '上午', '晚间', '全天'])
    return hasScope && hasContent && hasRefineVerb && hasLayoutContext
  }

  private shouldCommitLayout(input: string): boolean {
    const hasCommitVerb = this.hasAny(input, ['开始编排', '开始排', '确认版面', '采用这个版面', '按这个版面', '按该版面'])
    const hasDraftReference = this.hasAny(input, ['版面', '草案', '当前版面', '这个版面', '该版面'])
    return hasCommitVerb && hasDraftReference
  }

  private isBareConfirmation(input: string): boolean {
    return /^(开始吧|开始|就这样|可以了|可以|确认|执行|生成吧|排吧|按这个来|就按这个|走这个|用这个)$/.test(input)
  }

  private shouldIgnoreExistingLayout(input: string): boolean {
    return this.hasAny(input, ['不要参考已有版面', '不参考已有版面', '忽略现有版面', '不要沿用当前版面'])
  }

  private isVagueLayoutRequest(input: string): boolean {
    const hasLayoutWord = this.hasAny(input, ['版面', '排单', '排一个', '下一版排单', '单独排版'])
    if (!hasLayoutWord) {
      return false
    }

    return !this.hasLayoutScope(input) || !this.hasLayoutContent(input)
  }

  private hasLayoutScope(input: string): boolean {
    return this.matchesActualLayoutScope(input)
      || LAYOUT_SCOPE_KEYWORDS.some((keyword) => input.includes(keyword))
      || this.containsExplicitTimeRange(input)
  }

  private hasLayoutContent(input: string): boolean {
    return this.matchesActualLayoutContent(input)
      || LAYOUT_CONTENT_KEYWORDS.some((keyword) => input.includes(keyword))
  }

  private containsExplicitTimeRange(input: string): boolean {
    return Boolean(parseSchedulingTimeRange(input))
  }

  private extractEditIntent(input: string): string {
    if (input.includes('插入')) return '插入节目'
    if (input.includes('删除')) return '删除节目'
    if (input.includes('替换')) return '替换节目'
    if (input.includes('移动')) return '移动节目'
    if (input.includes('修改')) return '修改节目属性'
    return '编辑操作'
  }

  private extractLayoutIntent(input: string): string {
    const scope = LAYOUT_SCOPE_KEYWORDS.find((keyword) => input.includes(keyword))
    const content = this.extractActualLayoutLabel(input)
      ?? LAYOUT_CONTENT_KEYWORDS.find((keyword) => input.includes(keyword))
    if (scope && content) {
      return `${scope}以${content}为主`
    }
    if (content) {
      return `以${content}为主`
    }
    return '生成版面草案'
  }

  private extractTimeRange(input: string): { start: string; end: string } | undefined {
    return parseSchedulingTimeRange(input)
  }

  private normalizeRotationDurationScope(
    classification: TaskClassification,
    userInput: string,
  ): TaskClassification {
    if (!classification.suggestedParams || !this.isRotationPlaylistIntent(userInput, classification)) {
      return classification
    }

    const suggestedParams = { ...classification.suggestedParams }
    const durationSeconds = typeof suggestedParams.rotationDurationSeconds === 'number'
      ? suggestedParams.rotationDurationSeconds
      : this.resolveRotationDurationSeconds(userInput, suggestedParams.targetTimeRange)
    if (!durationSeconds) {
      return classification
    }

    delete suggestedParams.targetTimeRange
    suggestedParams.rotationDurationSeconds = durationSeconds

    return {
      ...classification,
      reasoning: classification.reasoning.includes('轮播单按时长制')
        ? classification.reasoning
        : `${classification.reasoning}；轮播单按时长制处理，已转为从 0 点起算的总时长。`,
      suggestedParams,
    }
  }

  private isRotationPlaylistIntent(userInput: string, classification: TaskClassification): boolean {
    const text = [
      userInput,
      classification.reasoning,
      classification.suggestedParams?.userIntent,
      classification.suggestedParams?.semanticLabel,
    ].filter(Boolean).join('')
    return /(轮播单|轮播|直播轮播单|直播播单|直播单|户外直播|外场直播|新媒体播单|新媒体节目单)/.test(text)
  }

  private resolveRotationDurationSeconds(
    userInput: string,
    targetTimeRange?: { start: string; end: string },
  ): number | null {
    const explicitDuration = this.extractDurationSeconds(userInput)
    if (explicitDuration) return explicitDuration

    const range = targetTimeRange ?? this.extractTimeRange(this.normalizeInput(userInput))
    if (!range) return null
    return this.calculateRangeDurationSeconds(range.start, range.end)
  }

  private extractDurationSeconds(userInput: string): number | null {
    const normalized = this.normalizeInput(userInput)
    const numericHourMatch = normalized.match(/(\d+(?:\.\d+)?)(?:个)?小时/u)
    if (numericHourMatch?.[1]) return Math.round(Number(numericHourMatch[1]) * 3600)
    const numericMinuteMatch = normalized.match(/(\d+)(?:分钟|分)/u)
    if (numericMinuteMatch?.[1]) return Number(numericMinuteMatch[1]) * 60
    if (/半个?小时/u.test(normalized)) return 30 * 60
    if (/一刻钟/u.test(normalized)) return 15 * 60
    if (/三刻钟/u.test(normalized)) return 45 * 60
    return null
  }

  private calculateRangeDurationSeconds(start: string, end: string): number | null {
    const startSeconds = this.clockToSeconds(start)
    const endSeconds = this.clockToSeconds(end)
    if (startSeconds === null || endSeconds === null) return null
    const rawDuration = endSeconds - startSeconds
    return rawDuration > 0 ? rawDuration : rawDuration + 24 * 60 * 60
  }

  private clockToSeconds(value: string): number | null {
    const [hours = 0, minutes = 0, seconds = 0] = value.split(':').map(Number)
    if ([hours, minutes, seconds].some((part) => Number.isNaN(part))) return null
    return hours * 3600 + minutes * 60 + seconds
  }

  private extractActualLayoutLabel(input: string): string | null {
    const normalized = input
      .replace(/^(?:不参考当前版面参考|不要参考当前版面参考|不参考当前版面|不要参考当前版面|忽略当前版面参考)[,，、\s]*/u, '')
      .trim()
    const verbMatch = normalized.match(/(?:排入|编入|改成|换成|替换成|替换为|调整为|改为|统一成|变成)(.+)$/u)
    if (!verbMatch && !/(电视剧|剧场|新闻|资讯|评论|健康|娱乐|综艺|少儿|纪录|电影|栏目)/u.test(normalized)) {
      return null
    }
    const rawLabel = verbMatch?.[1] ?? normalized
    const cleaned = rawLabel
      .replace(/^(?:全部|都|统一|整体)+/u, '')
      .replace(/(?:节目|栏目|版面|内容)+$/u, '')
      .trim()
    return cleaned || null
  }

  private matchesActualLayoutScope(input: string): boolean {
    return ['全天', '整天', '全日', '上午', '中午', '午间', '下午', '晚间', '晚上', '夜间', '深夜', '凌晨']
      .some((keyword) => input.includes(keyword))
  }

  private matchesActualLayoutContent(input: string): boolean {
    if (this.extractActualLayoutLabel(input)) {
      return true
    }
    return [
      '电视剧',
      '剧场',
      '黄金剧场',
      '下午剧场',
      '新闻',
      '新闻栏目',
      '资讯',
      '评论',
      '健康',
      '娱乐',
      '综艺',
      '少儿',
      '纪录片',
      '电影',
      '民生',
    ].some((keyword) => input.includes(keyword))
  }

  private matchesActualLayoutPrepareVerb(input: string): boolean {
    return [
      '版面',
      '单独排版',
      '独立排版',
      '局部排版',
      '全部排入',
      '排入',
      '都排',
      '统一成',
      '编入',
      '铺成',
      '按',
      '不参考当前版面参考',
      '不参考当前版面',
    ].some((keyword) => input.includes(keyword))
  }

  private matchesActualLayoutRefineVerb(input: string): boolean {
    return ['改成', '换成', '调整为', '改为', '替换成', '变成'].some((keyword) => input.includes(keyword))
  }

  private matchesActualLayoutContext(input: string): boolean {
    return ['版面', '草案', '当前版面', '这个版面', '该版面', '时段', '下午', '上午', '晚间', '晚上', '全天']
      .some((keyword) => input.includes(keyword))
  }

  private matchesExplicitIgnoreCurrentLayout(input: string): boolean {
    return [
      '不参考当前版面参考',
      '不要参考当前版面参考',
      '不参考当前版面',
      '不要参考当前版面',
      '不参考当前频道版面参考',
      '不参考当前频道版面',
      '不要参考当前频道版面',
      '不参考现有版面参考',
      '不要参考现有版面参考',
      '忽略当前版面参考',
      '忽略当前版面',
    ].some((keyword) => input.includes(keyword))
  }

  private normalizeLegacyLlmClassification(result: TaskClassification): TaskClassification {
    if (result.mode === 'full_generate' || result.mode === 'partial_generate') {
      return {
        mode: 'layout_prepare',
        confidence: result.confidence,
        reasoning: `${result.reasoning || 'LLM 判断为直接编排'}；按当前产品流程已转成先准备版面草案。`,
        suggestedParams: result.suggestedParams,
      }
    }

    if (result.mode === 'repair_only') {
      return {
        mode: 'validate_only',
        confidence: result.confidence,
        reasoning: `${result.reasoning || 'LLM 判断为修复请求'}；当前先进入问题分析，再决定后续处理。`,
        suggestedParams: result.suggestedParams,
      }
    }

    if (result.mode === 'micro_edit') {
      return {
        mode: 'clarify',
        confidence: result.confidence,
        reasoning: `${result.reasoning || 'LLM 判断为局部节目调整'}；但当前描述未形成可执行的原子命令，需要进一步补充节目或时间信息。`,
        suggestedParams: result.suggestedParams,
      }
    }

    return result
  }
}

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
