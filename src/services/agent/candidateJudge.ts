import type { ChatMessage } from '@/types/llm'
import type { LLMClient } from '@/services/llm/llmClient'
import { STAGE_RESERVE_BUDGET, STAGE_TIMEOUT_BUDGET } from './agentDeadline'
import type { AgentDeadline } from './agentDeadline'
import type { AgentLlmStreamObserver } from './agentLlmStreaming'
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
 * - auto_select: 存在证据充分的唯一靠谱候选，可自动执行
 * - needs_clarification: 候选很多/无顺播基线/同一期多版本，需用户澄清
 * - unable_to_decide: LLM 失败/超时/结构无效
 *
 * Prompt 版本管理（对齐 AGENTS.md Verification Gates）：
 * - v1.0：初版，把"时长适配"列为硬条件，导致无基线场景 LLM 退回 needs_clarification
 * - v1.1：移除"时长适配"硬条件（时长适配由 FormalPlaylistWriteAdapter 写入校验把关），
 *         强化"无基线选最早一期"规则优先级，明确此规则优先于时长考量
 * - v1.2：顺播标准文案统一，补齐"经验线索非绝对规则"与"时长不在候选层评估"两条，
 *         与 orchestrationPromptBuilder / llmAgentIntentInterpreter 口径对齐
 * - v1.3：移除候选数量阈值；只要存在证据充分的唯一选择，LLM 可直接选择。
 */
const CANDIDATE_JUDGE_PROMPT_VERSION = 'v1.3'

export class LlmAgentCandidateJudge implements AgentCandidateJudge {
  constructor(private readonly options: {
    llmClient: Pick<LLMClient, 'chat'>
    onStreamEvent?: AgentLlmStreamObserver
  }) {}

  /**
   * 调用 LLM 在候选中做决策，返回候选 + 决策理由 + 决策类型
   * 失败时暴露失败，不本地评分兜底。
   *
   * D1 接入：timeout 从写死的 30000 改为 deadline?.stageTimeoutMs(STAGE_TIMEOUT_BUDGET.candidate_judge)，
   * 让方向 1 的 AgentDeadline 真正生效。未传 deadline 时沿用 30s 默认值（向后兼容）。
   *
   * @param input - 候选决策输入
   * @param deadline - 可选的统一 deadline 管理器，用于推导 stage timeout
   */
  async selectBestCandidate(input: AgentCandidateJudgeInput, deadline?: AgentDeadline): Promise<AgentCandidateDecision> {
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
      const startedAt = Date.now()
      let sequence = 0
      let receivedChars = 0
      let firstTokenLatencyMs: number | undefined
      const response = await this.options.llmClient.chat(this.buildMessages(input), {
        temperature: 0,
        maxTokens: 800,
        timeout: deadline?.stageTimeoutMs(
          STAGE_TIMEOUT_BUDGET.candidate_judge,
          STAGE_RESERVE_BUDGET.after_candidate_judge,
        ) ?? 30_000,
        maxRetries: 1,
        traceLabel: 'agent.candidate_judge',
        promptVersion: CANDIDATE_JUDGE_PROMPT_VERSION,
        ...(deadline ? { signal: deadline.signal() } : {}),
        onToken: (_delta, meta) => {
          receivedChars = meta.receivedChars
          firstTokenLatencyMs = meta.firstTokenLatencyMs
          this.options.onStreamEvent?.({
            stage: 'candidate_judge',
            kind: meta.index === 0 ? 'first_token' : 'token_delta',
            sequence: sequence++,
            receivedChars,
            elapsedMs: meta.elapsedMs,
            firstTokenLatencyMs,
          })
        },
      })
      const decision = this.normalizeDecision(response.content, input.candidates)
      this.options.onStreamEvent?.({
        stage: 'candidate_judge',
        kind: 'structured_complete',
        sequence: sequence++,
        receivedChars: receivedChars || response.content.length,
        elapsedMs: Date.now() - startedAt,
        firstTokenLatencyMs,
      })
      return decision
    } catch (error) {
      this.options.onStreamEvent?.({
        stage: 'candidate_judge',
        kind: 'structured_invalid',
        sequence: 0,
        receivedChars: 0,
        elapsedMs: 0,
      })
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
   * 硬条件（素材/版权） → 上下文连续性 → 内容匹配 → 收视率/热播策略 → 拒绝理由
   * 注：时长适配不在候选决策层评估，由 FormalPlaylistWriteAdapter 写入校验把关（prompt v1.1）
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
          `[prompt ${CANDIDATE_JUDGE_PROMPT_VERSION}] 你是一名经验丰富的电视节目编排人员，负责在候选节目中选择最合适的一个排入编排单。`,
          '你必须按以下顺序评估每个候选，并给出决策理由：',
          '1. 硬条件：素材状态、版权状态（候选必须素材就绪且版权可用，否则不选）',
          '2. 上下文连续性：如果是电视剧/系列节目，是否顺接上一期（不能跳集、倒序、重复）',
          '3. 内容匹配：节目名、栏目、内容标签是否匹配用户意图',
          '4. 收视率/热播策略：轮播单可参考收视率和热度',
          '5. 拒绝理由：如果无法决策，说明原因',
          '注意：时长是否适配目标时段不在候选决策层评估，由本地写入校验（FormalPlaylistWriteAdapter）最终把关。你不要因为"目标时段时长未知"或"候选时长可能不适配"而退回 needs_clarification。',
          '',
          `当前是${playlistTypeText}，用户命令意图：${commandIntentText}。`,
          '电视播单必须按期数顺播，不能跳集、倒序、重复。',
          '轮播单无顺播约束，按内容匹配或收视率/热播策略选择。',
          '',
          '你需要自判决策类型 decisionType：',
          '- auto_select：无论候选数量，只要能基于硬条件、上下文和业务策略选出证据充分的唯一候选即可直接选择',
          '- needs_clarification：候选很多难以给出有理有据回答，或同一期有多个版本需要用户选择。此时 reasoning 必须用一句话说清为什么需要用户澄清（例："库里有两个版本的《琅琊榜》第5集，请确认要哪个"），不要逐个候选罗列维度差异，不要复述候选字段。',
          '- unable_to_decide：无法决策（候选都不合适或信息不足）。此时 reasoning 末尾必须用一句话点出"最接近的候选是什么、差在哪"（例："库里没有《琅琊榜》，但有《琅琊榜之风起长林》是否考虑？"），给编排人员一个可继续的入口。如果候选列表中确实没有任何相近节目，不强制加，保持简洁即可。',
          '',
          '顺播期数选择规则（重要，是电视播单候选决策的最高优先级硬规则，优先于任何时长考量）：',
          '- 有顺播基线时：必须选择期望下一集，不能跳集、倒序、重复。',
          '- 无顺播基线时（今天和历史都没播过该系列）：如果用户给了明确节目名且候选有期数，必须 auto_select 最早一期（期数最小的）。这是顺播硬约束，顺播必须从最早未播出的开始，不能先排更新的。',
          '- 无顺播基线且候选无期数信息或同一期有多个版本：needs_clarification 让用户选择。',
          '- 经验线索（节目编号前缀、去掉集数后的节目名称、所属栏目相同）只是判断上下节目的辅助线索，不是绝对规则，必须综合标题、栏目、历史进度、当前节目单和播出风险判断。',
          '- 时长是否适配目标时段不在候选决策层评估，由本地写入校验（FormalPlaylistWriteAdapter）最终把关。',
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
          'reasoning 必须说明为什么选这个候选，或为什么需要用户澄清。needs_clarification 时 reasoning 只用一句话点出"差在哪个关键维度/哪个候选分叉点"，让编排人员知道下一步该补什么；unable_to_decide 时 reasoning 末尾用一句话点出最接近的候选（无相近候选时可不加），不要堆候选列表。',
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
