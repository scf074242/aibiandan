import type { ChatMessage } from '@/types/llm'
import type { LLMClient } from '@/services/llm/llmClient'
import type {
  AgentCandidateDecision,
  AgentCandidateDecisionType,
  AgentCandidateJudge,
  AgentCandidateJudgeInput,
  AgentProgramCandidate,
} from './types'

/**
 * LLM 候选决策器（LLM-only，禁止本地评分兜底）
 *
 * 替代历史遗留的 DefaultAgentCandidateJudge 本地评分实现。
 * 本地评分用关键词匹配打分替代 LLM 决策，违反 AGENTS.md 的 LLM-only 主路径原则（C1/C3/C9）。
 *
 * 决策流程：
 * 1. 构造候选决策 prompt（含候选列表、上下文、顺播证据、用户意图）
 * 2. 调用 LLM，要求返回 { candidateId, reasoning, considerations, decisionType } JSON
 * 3. 校验返回结构 + candidateId 在候选列表中（C2 模型返回结构校验）
 * 4. 失败/超时/结构无效 → 返回 unable_to_decide + 失败原因（C8 暴露失败，不本地兜底）
 *
 * LLM 自判 decisionType（本地不替 LLM 判断，C1/C9）：
 * - auto_select: 候选不多 + 唯一靠谱，可自动执行
 * - needs_clarification: 候选很多/无顺播基线/同一期多版本，需用户澄清
 * - unable_to_decide: LLM 失败/超时/结构无效
 */
export class LlmAgentCandidateJudge implements AgentCandidateJudge {
  constructor(private readonly options: { llmClient: Pick<LLMClient, 'chat'> }) {}

  /**
   * 调用 LLM 在候选中做决策，返回候选 + 决策理由 + 决策类型
   * 失败时暴露失败，不本地评分兜底
   */
  async selectBestCandidate(input: AgentCandidateJudgeInput): Promise<AgentCandidateDecision> {
    if (input.candidates.length === 0) {
      return {
        candidate: null,
        reasoning: '候选列表为空，无法决策。',
        decisionType: 'unable_to_decide',
      }
    }

    if (input.candidates.length === 1) {
      const only = input.candidates[0]!
      return {
        candidate: only,
        reasoning: '候选列表中只有一个可用节目，直接采用。',
        decisionType: 'auto_select',
      }
    }

    try {
      const response = await this.options.llmClient.chat(this.buildMessages(input), {
        temperature: 0,
        maxTokens: 800,
        timeout: 30000,
        maxRetries: 1,
        traceLabel: 'agent.candidate_judge',
      })
      return this.normalizeDecision(response.content, input.candidates)
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      return {
        candidate: null,
        reasoning: `LLM 候选决策失败：${reason}`,
        decisionType: 'unable_to_decide',
      }
    }
  }

  /**
   * 构造候选决策 prompt
   * 明确要求 LLM 按"经验丰富编排人员"顺序评估（C5/C16）：
   * 硬条件 → 上下文连续性 → 内容匹配 → 时长适配 → 收视率/热播策略 → 拒绝理由
   */
  private buildMessages(input: AgentCandidateJudgeInput): ChatMessage[] {
    const candidateLines = input.candidates.map((candidate, index) => {
      const parts: string[] = [
        `[${index + 1}] id=${candidate.id}`,
        `programName=${candidate.programName}`,
        `instanceName=${candidate.instanceName}`,
        `programCode=${candidate.programCode}`,
        `programType=${candidate.programType}`,
        `duration=${candidate.duration}s`,
      ]
      if (candidate.columnName) parts.push(`column=${candidate.columnName}`)
      if (candidate.issueNo) parts.push(`issueNo=${candidate.issueNo}`)
      if (candidate.contentTags && candidate.contentTags.length > 0) {
        parts.push(`tags=${candidate.contentTags.join('/')}`)
      }
      if (typeof candidate.estimatedRating === 'number') parts.push(`rating=${candidate.estimatedRating}`)
      if (typeof candidate.popularityScore === 'number') parts.push(`popularity=${candidate.popularityScore}`)
      if (candidate.materialStatus) parts.push(`material=${candidate.materialStatus}`)
      if (candidate.rightsStatus) parts.push(`rights=${candidate.rightsStatus}`)
      const assessment = input.professionalAssessments?.[candidate.id]
      if (assessment && assessment.hardBlockCodes.length > 0) {
        parts.push(`hardBlocks=${assessment.hardBlockCodes.join(',')}`)
      }
      return parts.join(', ')
    })

    const evidenceLines = this.buildEvidenceLines(input)
    const playlistTypeText = input.playlistType === 'tv' ? '电视播单（时间格子，按期数顺播）' : '轮播单（内容队列）'
    const commandIntentText = input.commandIntent === 'insert' ? '插入' : '替换'

    return [
      {
        role: 'system',
        content: [
          '你是一名经验丰富的电视节目编排人员，负责在候选节目中选择最合适的一个排入编排单。',
          '你必须按以下顺序评估每个候选，并给出决策理由：',
          '1. 硬条件：素材状态、版权状态、时长是否适配目标时段',
          '2. 上下文连续性：如果是电视剧/系列节目，是否顺接上一期（不能跳集、倒序、重复）',
          '3. 内容匹配：节目名、栏目、内容标签是否匹配用户意图',
          '4. 时长适配：候选时长是否适合目标时段',
          '5. 收视率/热播策略：轮播单可参考收视率和热度',
          '6. 拒绝理由：如果无法决策，说明原因',
          '',
          `当前是${playlistTypeText}，用户命令意图：${commandIntentText}。`,
          '电视播单必须按期数顺播，不能跳集、倒序、重复。',
          '轮播单无顺播约束，按内容匹配或收视率/热播策略选择。',
          '',
          '你需要自判决策类型 decisionType：',
          '- auto_select：候选不多（通常 <= 5 个）且能选出唯一靠谱的候选',
          '- needs_clarification：候选很多难以给出有理有据回答，或同一期有多个版本需要用户选择',
          '- unable_to_decide：无法决策（候选都不合适或信息不足）',
          '',
          '顺播期数选择规则（重要）：',
          '- 有顺播基线时：必须选择期望下一集，不能跳集、倒序、重复',
          '- 无顺播基线时（今天和历史都没播过该系列）：如果用户给了明确节目名且候选有期数，auto_select 最早一期（期数最小的），因为顺播必须从最早未播出的开始，不能先排更新的',
          '- 无顺播基线且候选无期数信息或同一期有多个版本：needs_clarification',
          '',
          '只返回 JSON，不要 Markdown：',
          '{',
          '  "candidateId": "选中的候选 id，unable_to_decide 时为空字符串",',
          '  "reasoning": "决策思路，用中文，面向编排人员，不要出现置信度/匹配度等技术词",',
          '  "considerations": ["评估要点1", "评估要点2"],',
          '  "decisionType": "auto_select | needs_clarification | unable_to_decide"',
          '}',
          '',
          'candidateId 必须是下方候选列表中已列出的 id，不能虚构。',
          'reasoning 必须说明为什么选这个候选，或为什么需要用户澄清。',
        ].join('\n'),
      },
      {
        role: 'user',
        content: [
          `用户命令：${input.userInput}`,
          '',
          `候选节目（共 ${input.candidates.length} 个）：`,
          ...candidateLines,
          '',
          ...evidenceLines,
        ].join('\n'),
      },
    ]
  }

  /**
   * 构造顺播证据文案（透传给 LLM）
   */
  private buildEvidenceLines(input: AgentCandidateJudgeInput): string[] {
    const evidence = input.tvSequenceEvidence
    if (!evidence || evidence.playlistType !== 'tv') {
      return input.playlistType === 'tv'
        ? ['顺播证据：未提供顺播基线信息。']
        : []
    }
    if (!evidence.hasBaseline) {
      return ['顺播证据：今天和历史编排中没有找到同系列基线，无法判断期望下一集。']
    }
    const sourceText = evidence.source === 'today' ? '今天编排' : '历史编排'
    const maxSeq = evidence.source === 'today' ? evidence.todayMaxSequence : evidence.historyMaxSequence
    return [
      `顺播证据：${sourceText}中同系列（${evidence.seriesKey ?? '未知'}）最大期数为 ${maxSeq}，期望下一集期数为 ${evidence.expectedSequence}。`,
      '候选必须符合期数顺播规则：不能跳集（期数不能大于期望值）、不能倒序（期数不能小于期望值）、不能重复。',
    ]
  }

  /**
   * 解析 LLM 返回内容为 AgentCandidateDecision
   * 校验返回结构 + candidateId 有效性（C2 模型返回结构校验）
   * 失败时返回 unable_to_decide（C8 暴露失败）
   */
  private normalizeDecision(content: string, candidates: AgentProgramCandidate[]): AgentCandidateDecision {
    const parsed = this.parseJson(content)
    if (!parsed || typeof parsed !== 'object') {
      return {
        candidate: null,
        reasoning: 'LLM 返回内容不是有效 JSON，无法解析候选决策。',
        decisionType: 'unable_to_decide',
      }
    }

    const record = parsed as Record<string, unknown>
    const decisionType = this.normalizeDecisionType(record.decisionType)
    const reasoning = typeof record.reasoning === 'string' ? record.reasoning.trim() : ''
    const considerations = this.normalizeConsiderations(record.considerations)

    if (decisionType === 'unable_to_decide') {
      return {
        candidate: null,
        reasoning: reasoning || 'LLM 判定无法决策。',
        considerations,
        decisionType,
      }
    }

    if (decisionType === 'needs_clarification') {
      return {
        candidate: null,
        reasoning: reasoning || '候选较多或无顺播基线，需要编排人员确认。',
        considerations,
        decisionType,
        candidateOptions: candidates,
      }
    }

    // auto_select：校验 candidateId 有效性
    const candidateId = typeof record.candidateId === 'string' ? record.candidateId.trim() : ''
    if (!candidateId) {
      return {
        candidate: null,
        reasoning: 'LLM 返回 auto_select 但未提供 candidateId。',
        considerations,
        decisionType: 'unable_to_decide',
      }
    }

    const candidate = candidates.find((item) => item.id === candidateId)
    if (!candidate) {
      return {
        candidate: null,
        reasoning: `LLM 返回的 candidateId (${candidateId}) 不在候选列表中。`,
        considerations,
        decisionType: 'unable_to_decide',
      }
    }

    return {
      candidate,
      reasoning: reasoning || `LLM 选择候选 ${candidate.programName}。`,
      considerations,
      decisionType: 'auto_select',
    }
  }

  /**
   * 解析 JSON（容忍前后多余文本和 Markdown 代码块）
   */
  private parseJson(content: string): unknown {
    if (!content) return null
    const trimmed = content.trim()
    try {
      return JSON.parse(trimmed)
    } catch {
      // 尝试提取 ```json ... ``` 或 { ... } 片段
      const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/u)
      if (codeBlockMatch) {
        try {
          return JSON.parse(codeBlockMatch[1]!.trim())
        } catch {
          // 继续尝试
        }
      }
      const objectMatch = trimmed.match(/\{[\s\S]*\}/u)
      if (objectMatch) {
        try {
          return JSON.parse(objectMatch[0])
        } catch {
          // 继续失败
        }
      }
      return null
    }
  }

  /**
   * 校验 decisionType 字段
   */
  private normalizeDecisionType(value: unknown): AgentCandidateDecisionType {
    if (value === 'auto_select' || value === 'needs_clarification' || value === 'unable_to_decide') {
      return value
    }
    return 'unable_to_decide'
  }

  /**
   * 校验 considerations 字段
   */
  private normalizeConsiderations(value: unknown): string[] | undefined {
    if (!Array.isArray(value)) return undefined
    const result = value
      .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      .map((item) => item.trim())
    return result.length > 0 ? result : undefined
  }
}
