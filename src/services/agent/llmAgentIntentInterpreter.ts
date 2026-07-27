import type { ChatMessage } from '@/types/llm'
import type { LLMClient } from '@/services/llm/llmClient'
import { buildPendingLlmContext } from './agentSession'
import { STAGE_RESERVE_BUDGET, STAGE_TIMEOUT_BUDGET } from './agentDeadline'
import type { AgentDeadline } from './agentDeadline'
import type { AgentLlmStreamObserver } from './agentLlmStreaming'
import type {
  AgentIntentInterpretation,
  AgentIntentInterpreter,
  AgentIntentSlots,
  AgentKeywordStrategy,
  AgentPendingAction,
  AgentSubmitInput,
  AgentTaskPlanDraft,
  AgentTaskPlanStageDraft,
  AgentTaskPlanStageDraftType,
  AtomicCommandIntent,
  QueryCommandPlan,
} from './types'

const INTENTS: AtomicCommandIntent[] = [
  'move',
  'insert',
  'replace',
  'delete',
  'batch_move',
  'batch_delete',
  'query',
  'validate',
]

const PENDING_ACTIONS: AgentPendingAction[] = [
  'start_new_task',
  'cancel_pending',
  'select_candidate',
  'confirm',
  'reject',
]

const QUERY_KINDS: QueryCommandPlan['queryKind'][] = [
  'schedule_summary',
  'time_lookup',
  'program_lookup',
  'candidate_lookup',
]

const MIN_STRUCTURED_CONFIDENCE = 0.5
const ASSISTANT_FEEDBACK_TECHNICAL_PATTERN = /intent=|slots=|pendingAction|confidence|JSON|Agent Core|needs_|evidencePackage|pendingTask|taskPlan|runtime|policy|stage|候选源|结构化|置信度|匹配度|上下文包|策略ID|技术词/iu

/**
 * intent_interpreter 能力域 prompt 版本号
 * 修订 prompt 时必须同步升版本号，并在 commit message 注明 vX.Y → vA.B
 * - v1.0：初版，39 条规则扁平排列
 * - v2.0：prompt 分组重组（扁平 → 8 区块分组 + 硬约束前置），顺播旁注对齐标准文案
 */
const INTENT_INTERPRETER_PROMPT_VERSION = 'v2.5' as const

export class LlmAgentIntentInterpreter implements AgentIntentInterpreter {
  readonly usesLlm = true

  constructor(
    private readonly llmClient: Pick<LLMClient, 'chat'>,
    private readonly options: { onStreamEvent?: AgentLlmStreamObserver } = {},
  ) {}

  /**
   * 调用 LLM 解析用户输入为结构化意图。
   *
   * D1 接入：timeout 从写死的 30000 改为 deadline?.stageTimeoutMs(STAGE_TIMEOUT_BUDGET.intent_parse)，
   * 让方向 1 的 AgentDeadline 真正生效。未传 deadline 时沿用 30s 默认值（向后兼容）。
   *
   * @param input - agent 提交输入
   * @param deadline - 可选的统一 deadline 管理器，用于推导 stage timeout
   */
  async interpret(input: AgentSubmitInput, deadline?: AgentDeadline): Promise<AgentIntentInterpretation | null> {
    const startedAt = Date.now()
    let sequence = 0
    let receivedChars = 0
    let firstTokenLatencyMs: number | undefined
    const response = await this.llmClient.chat(this.buildMessages(input), {
      temperature: 0,
      maxTokens: 1_100,
      timeout: deadline?.stageTimeoutMs(
        STAGE_TIMEOUT_BUDGET.intent_parse,
        STAGE_RESERVE_BUDGET.after_intent_parse,
      ) ?? STAGE_TIMEOUT_BUDGET.intent_parse,
      maxRetries: 1,
      traceLabel: 'agent.intent_interpreter',
      promptVersion: INTENT_INTERPRETER_PROMPT_VERSION,
      responseFormat: 'json_object',
      ...(deadline ? { signal: deadline.signal() } : {}),
      onToken: (_delta, meta) => {
        receivedChars = meta.receivedChars
        firstTokenLatencyMs = meta.firstTokenLatencyMs
        this.options.onStreamEvent?.({
          stage: 'intent_parse',
          kind: meta.index === 0 ? 'first_token' : 'token_delta',
          sequence: sequence++,
          receivedChars,
          elapsedMs: meta.elapsedMs,
          firstTokenLatencyMs,
        })
      },
    })
    const interpretation = this.normalizeInterpretation(response.content, input, 'scenario_context')
    this.options.onStreamEvent?.({
      stage: 'intent_parse',
      kind: interpretation ? 'structured_complete' : 'structured_invalid',
      sequence: sequence++,
      receivedChars: receivedChars || response.content.length,
      elapsedMs: Date.now() - startedAt,
      firstTokenLatencyMs,
    })
    return interpretation
  }

  private normalizeInterpretation(
    content: string,
    input: AgentSubmitInput,
    contextMode: AgentIntentInterpretation['contextMode'],
  ): AgentIntentInterpretation | null {
    const parsed = this.parseJson(content)
    if (!parsed || typeof parsed !== 'object') return null

    const record = parsed as Record<string, unknown>
    const requestedIntent = this.normalizeIntent(record.intent)
    const confidence = this.normalizeConfidence(record.confidence, requestedIntent)
    const assistantFeedback = this.normalizeAssistantFeedback(
      record.assistantFeedback ?? record.assistantReplyDraft,
    )
    const pendingAction = this.normalizePendingAction(
      record.pendingAction,
      input.pendingTask?.allowedActions,
      requestedIntent,
      input.pendingTask?.intent,
    )
    const intent = this.normalizeIntentForPending(requestedIntent, pendingAction, input.pendingTask?.intent)

    // 失败但带可读反馈：LLM 表达"无法理解"时 intent 可能缺失或 confidence<0.5，
    // 此时不丢弃 assistantFeedback，返回一个 intent=undefined 的失败结构，
    // 让上层（schedulingAgentRuntime）能把分类引导话术透传给用户。
    // 本地不做"缺时间/缺节目"的语义分类（分类由 LLM 在 prompt 里完成），
    // 仅做结构透传，符合 AGENTS.md LLM-only 原则。
    if (!intent || confidence < MIN_STRUCTURED_CONFIDENCE) {
      if (!assistantFeedback) return null
      return {
        intent: undefined,
        pendingAction: undefined,
        confidence: 0,
        source: 'llm',
        slots: undefined,
        taskPlanDraft: undefined,
        queryKind: undefined,
        keyword: undefined,
        searchAlternatives: undefined,
        keywordStrategies: undefined,
        suggestSecondaryReflection: undefined,
        reasoning: typeof record.reasoning === 'string' ? record.reasoning : undefined,
        assistantFeedback,
        streamingHint: this.normalizeStreamingHint(record.streamingHint),
        contextMode,
        rawText: content,
      }
    }

    return {
      intent,
      pendingAction,
      confidence,
      source: 'llm',
      slots: this.normalizeSlots(record.slots),
      taskPlanDraft: this.normalizeTaskPlanDraft(record.taskPlanDraft),
      queryKind: this.normalizeQueryKind(
        record.queryKind ?? this.readExplicitSlotValue(record.slots, 'queryKind'),
      ),
      keyword: typeof record.keyword === 'string' ? record.keyword : undefined,
      searchAlternatives: this.normalizeSearchAlternatives(record.searchAlternatives),
      keywordStrategies: this.normalizeKeywordStrategies(record.keywordStrategies, record),
      suggestSecondaryReflection: this.normalizeSuggestSecondaryReflection(record.suggestSecondaryReflection),
      reasoning: typeof record.reasoning === 'string' ? record.reasoning : undefined,
      assistantFeedback,
      streamingHint: this.normalizeStreamingHint(record.streamingHint),
      contextMode,
      rawText: content,
    }
  }


  private buildMessages(input: AgentSubmitInput): ChatMessage[] {
    return [
      {
        role: 'system',
        content: [
          '',
          '===== HARD CONSTRAINTS (highest priority, must satisfy first) =====',
          'Return JSON only, without Markdown.',
          'Required envelope when intent is present: {"intent":"insert","confidence":0.95,"slots":{"targetTime":"11:00:00","programHint":"东方新闻"},"assistantFeedback":"..."}. All slot values MUST be nested inside slots; never return targetTime, newStartTime, targetProgramName, programHint, or other slot keys at the top level.',
          'intent must be one of: move, insert, replace, delete, batch_move, batch_delete, query, validate.',
          'Return confidence as a number from 0 to 1 whenever you return an intent. Confidence measures certainty about the intent identity and the slot values you actually extracted; it does NOT measure whether every required slot is present.',
          'When the action itself is clear but a required slot is missing, return the clear intent with confidence >= 0.8, preserve every known slot, and use assistantFeedback to ask only for the missing information. Example: "插入东方新闻" -> {"intent":"insert","confidence":0.95,"slots":{"programHint":"东方新闻"},"assistantFeedback":"你想插到几点？"}. The runtime, not you, decides whether the incomplete command becomes pending.',
          'slots may include: targetTime, newStartTime, rangeStart, rangeEnd, programHint, replacementHint, offsetSeconds, direction, candidateId, targetItemId, targetProgramName.',
          'For query intent, queryKind must be one of: schedule_summary, time_lookup, program_lookup, candidate_lookup.',
          'queryKind is a TOP-LEVEL field outside slots. Never put queryKind inside slots.',
          'Do not decide whether the command is safe, do not choose final programs, and do not modify the schedule.',
          'If a destination is occupied, do not infer auto-shift, auto-replace, or auto-reorder behavior; only extract the requested move or insert slots and leave blocking to the runtime.',
          'Use confidence=0 only when the intent identity itself is ambiguous, unsupported, or cannot be understood. Return {"confidence":0,"reasoning":"...","assistantFeedback":"一句话中文引导"} and do not invent executable slots. assistantFeedback must classify what is unclear in one short Chinese sentence and tell the editor what to say next: ambiguous intent -> "你是想插入还是替换？"; unsupported or unclear -> "我没能理解，请换一种说法。". Do not list internal fields or policy ids. Keep within the 180-char assistantFeedback limit.',
          '',
          '===== ROLE & TASK =====',
          'You are the intent interpreter for a broadcast scheduling agent that supports both TV playlists and rotation playlists.',
          'Convert currentTurn.userInput plus any pendingLlmContext.pendingContext into JSON.',
          'Use evidencePackage as compact evidence for current schedule, candidate library, readiness, history, constraints, and policy when extracting references such as programme names, time slots, candidate hints, and pending-turn actions.',
          '',
          '===== POSITION SEMANTICS (TV grid vs rotation queue) =====',
          'Read evidencePackage.playlistSemantics before interpreting positions: TV playlists are strict broadcast time grids, while rotation playlists are content queues with relative positions from zero.',
          'For rotation playlists, do not invent channel/date broadcast windows. A phrase like "3小时轮播" is duration scope, and positions usually mean queue position or relative time. For TV playlists, clock times mean broadcast slots.',
          'For rotation playlists, if currentSchedule is empty and the user asks to insert or add one item without a position, treat the queue start as the natural target: set slots.targetTime="00:00:00" and explain in assistantFeedback that the current queue is empty so the item will be placed at the beginning. Do not simultaneously ask for an insertion position.',
          'For rotation playlists, currentSchedule items are queue blocks. If the user says "在X后/在已插入的X后/X后继续插入Y", locate X in evidencePackage.currentSchedule and set intent=insert, slots.targetTime to that item endTime, and slots.programHint to Y. If Y is omitted but a pending insert already has a programme clue, keep the pending programme clue. assistantFeedback must explain the basis in plain Chinese, such as "我会接在当前轮播单里已排的《看东方》后面继续插入。"',
          'For rotation playlists, if the user says "1点的X向后移动1小时" or "X向后移动1小时", prefer the named existing programme as the target: set targetProgramName=X, offsetSeconds=3600, direction="forward". Do not rely only on targetTime when the programme name is present. In rotation playlists, "1点" without 下午/13点 usually means the relative +1 hour position, not a TV broadcast clock.',
          'evidencePackage.layoutDraftAnchors may list the active TV layout draft slots. If the user says "在X里/在X栏目里/在X格子里" with words like 填入、排入、插入、编排, treat it as a formal playlist insert anchored by the matching draft slot: set intent=insert, slots.targetTime to the anchor startTime, and slots.programHint to X or the requested programme clue. Do not treat that as editing the draft unless the user explicitly says 更新草案、改草案、调整版面草案.',
          'TV anchor example: if layoutDraftAnchors contains 东方快报 06:00:00-07:00:00 and the user says "在东方快报里，帮我找到期数最大的一期填入", return intent=insert, slots.targetTime="06:00:00", slots.targetProgramName="东方快报", slots.programHint="东方快报 期数最大"; add searchAlternatives such as ["东方快报 期数最大","东方快报 最新一期","东方快报"].',
          'When you use a layoutDraftAnchor, assistantFeedback must briefly explain the basis in plain Chinese, for example: "我会按草案里的东方快报时段定位到06:00，再按你说的期数最大去筛选节目。"',
          'Use HH:mm:ss for times. Use seconds for offsetSeconds. direction must be forward or backward.',
          'For commands like "把《看东方》移到10点" or "move Morning News to 10", set intent=move, slots.targetProgramName to the existing programme name, and slots.newStartTime to the destination time.',
          'For time-to-time moves such as "9点那档移到10点" or "move the 9:00 slot to 10:00", return slots.targetTime to the source time and slots.newStartTime to the destination time.',
          'For commands like "删除看东方" or "remove Morning News", set intent=delete and slots.targetProgramName to the existing programme name; do not invent targetItemId unless the user selected an item.',
          'For commands like "把09:00的节目换成东方新闻", set targetTime for the existing slot and replacementHint for the new programme.',
          '',
          '===== CANDIDATE KEYWORD STRATEGIES =====',
          'For insert, replace, and candidate_lookup turns, you MUST return keywordStrategies as an array of 2-6 groups. Each group must include strategy (one of: original, typo_fix, decompose, paraphrase, column_demote, broaden), keywords (1-3 short Chinese keyword rewrites), and reason (short Chinese sentence explaining why this group might hit). Strategy tag meanings: original=user raw keyword (MUST include exactly one original group); typo_fix=fix suspected typos directly without asking the user; decompose=split overly fine phrases into facets (e.g. "上海旅游宣传片" -> "上海 / 旅游 / 短片"); paraphrase=near-synonym rewrite or second-pass understanding (e.g. "晨间新闻" -> "早间新闻 / 东方快报"); column_demote=drop episode-number constraint (e.g. "东方快报 第10期" -> "东方快报"); broaden=relax type or topic hard constraints (e.g. "上海旅游纪录片" -> "上海 旅游"). This is the ONLY chance to generate keyword strategies; the retry stage will NOT call you again. You MUST return at least original + 1 other strategy. Do not invent a final candidate. Also return searchAlternatives as 2-5 short Chinese keyword rewrites (kept for backward compatibility, the runtime will prefer keywordStrategies). If you think a secondary reflection might help after all keywords miss, set suggestSecondaryReflection=true; otherwise set it to false. TV playlists must follow sequence continuity rules (highest priority hard rule): with a baseline, select the expected next episode (no skipping/reverse/repeat); without a baseline and the user named a programme with episodes, select the earliest episode; without a baseline and no episode info or multiple versions of the same episode, the candidate judge returns needs_clarification. Duration fit is not evaluated here. Rotation playlists prefer content match and rating.',
          '',
          '===== COMPOSITE TASK PLAN =====',
          'If the user request contains multiple ordered tasks, also return taskPlanDraft with isComposite=true, a short goal, and ordered stages. Keep intent as the first executable atomic stage, such as batch_delete or insert.',
          'taskPlanDraft.stages may include type atomic, batch_atomic, draft_refill, verify, ask_user. Use draft_refill only when the user explicitly asks to use/reference a layout draft or fill gaps. For batch replace stages, target.programName or target range is the existing content, and target.replacementHint is the desired replacement content. For insert stages, target may include candidateId, candidateCode, programType, and durationSeconds only when already known from context or user-selected candidate evidence. Do not claim any stage has executed.',
          'For full or overall scheduling requests, do not downgrade the user to atomic commands. If the request needs a layout draft, return low confidence and explain in assistantFeedback what is missing.',
          '',
          '===== PENDING TASK CONTINUATION =====',
          'Use pendingEvidenceSummary as compact evidence for the previous pending task when deciding whether the current turn continues, confirms, selects, cancels, or starts a new task.',
          'When pendingTask is present, set pendingAction only for explicit start_new_task, cancel_pending, select_candidate, confirm, or reject. Ordinary follow-up language should be interpreted from the full context as a fresh structured intent with slots, not as a hidden continuation switch.',
          'When the user explicitly cancels the pending task, use cancel_pending, not reject. Use pendingAction="reject" only when the user rejects the pending proposal or candidate without cancelling the pending task.',
          'Whenever you return pendingAction, you MUST also return numeric confidence, slots as an object (use {} when empty), and assistantFeedback. For confirm/select/cancel/reject, use the pending intent when known; do not return an empty response or prose-only response.',
          'Pending examples: previous insert missing time + current "放到11点" -> {"intent":"insert","confidence":0.95,"slots":{"targetTime":"11:00:00"},"assistantFeedback":"我会沿用上一轮的节目并放到11点，写入前先完成校验。"} while preserving the pending programme through context; previous delete awaiting confirmation + current "确认" -> {"intent":"delete","pendingAction":"confirm","confidence":1,"slots":{},"assistantFeedback":"我收到你的删除确认，将先核对播单现场再写入。"}. Never say a delete, insert, move, or replace has already completed before the runtime returns the write result.',
          'If pendingTask is an insert and the user replies "就在已插入的X节目后" or "接在X后面", use currentSchedule and the previous context to return a normal insert intent with targetTime set to the matched X item endTime and programHint kept only when the context still clearly points to the same requested content.',
          'For pending slot corrections, words like 换成、改成、改到、插入、排入 are action words, not programme names. Do not turn "换成1点插入" into programHint="换成插入".',
          '',
          '===== ASSISTANT FEEDBACK STYLE =====',
          'Also return assistantFeedback: one short Chinese sentence addressed to the scheduling editor. It should say what you understood and what will happen next, or what information is still needed. Do not include internal field names, JSON keys, policy ids, or technical terms.',
          'assistantFeedback is the main text the editor sees. Write like a scheduling colleague, not like a system log. Do not mention candidate source, structured intent, confidence, matching score, context package, taskPlan, stage, runtime, policy, evidencePackage, pendingTask, or Agent Core.',
          'When the command must be blocked or needs more information, assistantFeedback must include three plain-language parts: why I cannot continue yet, what is missing, and what the editor can say next.',
          'For destructive or schedule-changing commands such as delete, replace, move, and insert, use a warm confirmation-oriented sentence. If evidencePackage already identifies the target slot or programme, do not say you will first locate it; say the target has been understood and that confirmation or validation will happen before writing.',
          'assistantFeedback examples: "我理解你想把《看东方》移到10点，我会核对当前播单中的目标节目和10点是否空闲。", "我知道你想插入上海景点相关视频，还需要确认插入时间。", "这看起来是在确认上一条插入建议，我会继续沿用上一轮候选和目标时间。"',
          'You may return streamingHint as "thinking" when the UI can safely stream a short progress sentence; otherwise return "final".',
          '',
          '===== CAPABILITY SCOPE (fallback) =====',
          'Scheduling Agent Core v1.1 only covers atomic playlist commands: move, insert, replace, delete, batch_move, batch_delete, query, and validate.',
          'Do not turn layout drafts, full-day auto scheduling, or multi-user collaboration requests into executable atomic writes; return low confidence when the user request is outside this core scope.',
          '',
        ].join('\n'),
      },
      {
        role: 'user',
        content: JSON.stringify(this.buildUserPayload(input)),
      },
    ]
  }

  private buildUserPayload(input: AgentSubmitInput) {
    const pendingLlmContext = input.pendingTask
      ? buildPendingLlmContext(input.pendingTask, input.userInput)
      : null
    const evidencePackage = input.llmContextPackage ?? null
    const isRotationPlaylist = evidencePackage?.identity.playlistType === 'rotation'
    const currentTurn = isRotationPlaylist
      ? {
          userInput: input.userInput,
          conversationId: input.conversationId,
          playlistId: input.playlistId,
          playlistType: evidencePackage.identity.playlistType,
          rotationStrategy: evidencePackage.identity.rotationStrategy,
          rotationDurationSeconds: evidencePackage.identity.rotationDurationSeconds,
          durationScope: evidencePackage.identity.durationScope,
          positionBasis: evidencePackage.identity.positionBasis,
        }
      : {
          userInput: input.userInput,
          channelId: input.channelId,
          date: input.date,
          conversationId: input.conversationId,
          playlistId: input.playlistId,
        }

    return {
      userInput: input.userInput,
      ...(isRotationPlaylist ? {} : { channelId: input.channelId, date: input.date }),
      currentTurn,
      pendingLlmContext,
      evidencePackage,
      pendingEvidenceSummary: pendingLlmContext?.evidenceSummary ?? null,
      pendingTask: pendingLlmContext
        ? {
            ...pendingLlmContext.pendingContext,
            evidenceSummary: pendingLlmContext.evidenceSummary,
            latestUserInput: pendingLlmContext.latestUserInput,
            allowedActions: pendingLlmContext.allowedActions,
          }
        : null,
    }
  }

  private parseJson(content: string): unknown {
    const trimmed = content.trim()
    if (!trimmed) return null
    try {
      return JSON.parse(trimmed)
    } catch {
      const match = trimmed.match(/\{[\s\S]*\}/)
      if (!match) return null
      try {
        return JSON.parse(match[0])
      } catch {
        return null
      }
    }
  }

  private normalizeIntent(value: unknown): AtomicCommandIntent | undefined {
    return typeof value === 'string' && INTENTS.includes(value as AtomicCommandIntent)
      ? value as AtomicCommandIntent
      : undefined
  }

  private normalizePendingAction(
    value: unknown,
    allowedActions?: AgentPendingAction[],
    requestedIntent?: AtomicCommandIntent,
    pendingIntent?: AtomicCommandIntent,
  ): AgentPendingAction | undefined {
    if (!allowedActions?.length) return undefined
    const explicit = typeof value === 'string'
      && PENDING_ACTIONS.includes(value as AgentPendingAction)
      && allowedActions.includes(value as AgentPendingAction)
      ? value as AgentPendingAction
      : undefined
    if (explicit) return explicit
    if (pendingIntent && requestedIntent && requestedIntent !== pendingIntent && allowedActions.includes('start_new_task')) {
      return 'start_new_task'
    }
    return undefined
  }

  private normalizeIntentForPending(
    requestedIntent: AtomicCommandIntent | undefined,
    pendingAction?: AgentPendingAction,
    pendingIntent?: AtomicCommandIntent,
  ): AtomicCommandIntent | undefined {
    if (!pendingIntent) return requestedIntent
    if (!pendingAction || pendingAction === 'start_new_task') return requestedIntent
    return pendingIntent
  }

  private normalizeQueryKind(value: unknown): QueryCommandPlan['queryKind'] | undefined {
    return typeof value === 'string' && QUERY_KINDS.includes(value as QueryCommandPlan['queryKind'])
      ? value as QueryCommandPlan['queryKind']
      : undefined
  }

  private readExplicitSlotValue(value: unknown, key: string): unknown {
    if (!value || typeof value !== 'object') return undefined
    return (value as Record<string, unknown>)[key]
  }

  /**
   * 归一化 LLM 返回的 confidence 字段。
   *
   * 设计原则（LLM-only）：
   * - LLM prompt 第 127 行已强制要求"Return confidence as a number from 0 to 1 whenever you return an intent"
   * - 漏返回 confidence 属于 LLM 未遵守 prompt 的异常情况，不应由本地"盖章"默认值让其通过门禁
   * - 旧逻辑默认 0.75 会让不完整的理解静默通过 MIN_STRUCTURED_CONFIDENCE=0.5 门禁，违反
   *   "模型无法返回有效理解或可读解释，应像 Codex 一样暴露失败并允许用户重试或补充"
   *
   * 修复后行为：
   * - LLM 漏返回 confidence 或返回非数字 → 返回 0，让 normalizeInterpretation 的
   *   confidence < MIN_STRUCTURED_CONFIDENCE 判断触发 return null，整体暴露失败
   * - LLM 返回合法数字 → 限制在 [0, 1] 区间
   *
   * @param value LLM 返回的原始 confidence 字段
   * @param requestedIntent 已识别的 intent，保留参数为了向后兼容调用签名
   * @returns 归一化后的 confidence，异常情况返回 0
   */
  private normalizeConfidence(value: unknown, _requestedIntent?: AtomicCommandIntent): number {
    if (typeof value !== 'number' || Number.isNaN(value)) return 0
    return Math.max(0, Math.min(1, value))
  }

  private normalizeAssistantFeedback(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined
    const normalized = value.replace(/\s+/g, ' ').trim()
    if (!normalized) return undefined
    if (this.hasPrematureCompletionClaim(normalized)) return undefined
    const sanitized = this.sanitizeAssistantFeedback(normalized)
    if (!sanitized) return undefined
    return sanitized.slice(0, 180)
  }

  private hasPrematureCompletionClaim(value: string): boolean {
    const claimsWriteCompleted = /^(?:好的?[，,]?\s*)?已(?:经)?[^。！？!?]*(?:插入|删除|移动|替换|更新|写入|改好|完成)/u
    return claimsWriteCompleted.test(value)
  }

  private sanitizeAssistantFeedback(value: string): string | undefined {
    if (!ASSISTANT_FEEDBACK_TECHNICAL_PATTERN.test(value)) return value

    const sentenceChunks = value.match(/[^。！？!?；;]+[。！？!?；;]?/gu) ?? [value]
    const readableChunks = sentenceChunks
      .map((item) => item.trim())
      .filter((item) => item && !ASSISTANT_FEEDBACK_TECHNICAL_PATTERN.test(item))
    const readableText = readableChunks.join('')
    if (readableText.length >= 8) return readableText

    return undefined
  }

  private normalizeSearchAlternatives(value: unknown): string[] | undefined {
    if (!Array.isArray(value)) return undefined
    const alternatives = value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.replace(/\s+/g, ' ').trim())
      .filter((item) => item.length >= 2 && item.length <= 40)
      .filter((item) => !/intent=|slots=|pendingAction|JSON|Agent Core|needs_/iu.test(item))
    const unique = Array.from(new Set(alternatives)).slice(0, 5)
    return unique.length > 0 ? unique : undefined
  }

  /**
   * 归一化 LLM 返回的 keywordStrategies 字段（阶段 2 引入）。
   *
   * 设计原则（AGENTS.md LLM-first / 本地只保护）：
   * - 策略标签、关键词、理由全部由 LLM 生成，本地不做关键词改写、不做同义词扩展、不做错别字修复
   * - 本地只做结构校验、长度校验、去重
   * - 校验规则：必须含 original + 至少 1 个其它策略，关键词去重、长度≥2
   * - 校验失败时返回仅含 original 的退化结构（用 record.keyword 或 record.slots?.programHint 作为 original）
   * - 退化结构仍允许首轮检索正常进行，但不进入重试循环（由 candidateSearchRetryService.generateKeywordStrategies 判断）
   *
   * @param value LLM 返回的原始 keywordStrategies 字段
   * @param record LLM 返回的完整 JSON 对象（用于退化时取 original 关键词）
   * @returns 校验后的 keywordStrategies（至少含 original），失败时返回退化结构或 undefined
   */
  private normalizeKeywordStrategies(
    value: unknown,
    record: Record<string, unknown>,
  ): AgentKeywordStrategy[] | undefined {
    if (!Array.isArray(value)) return undefined

    const validStrategies = new Set<AgentKeywordStrategy['strategy']>([
      'original',
      'typo_fix',
      'decompose',
      'paraphrase',
      'column_demote',
      'broaden',
    ])

    const seenKeywords = new Set<string>()
    const result: AgentKeywordStrategy[] = []

    for (const item of value) {
      if (!item || typeof item !== 'object') continue
      const source = item as Record<string, unknown>
      const strategy = source.strategy
      if (typeof strategy !== 'string' || !validStrategies.has(strategy as AgentKeywordStrategy['strategy'])) {
        continue
      }
      const reason = typeof source.reason === 'string'
        ? source.reason.replace(/\s+/g, ' ').trim().slice(0, 120)
        : ''
      const rawKeywords = Array.isArray(source.keywords) ? source.keywords : []
      const uniqueKeywords: string[] = []
      for (const keyword of rawKeywords) {
        if (typeof keyword !== 'string') continue
        const trimmed = keyword.replace(/\s+/g, ' ').trim()
        if (trimmed.length < 2 || trimmed.length > 40) continue
        const normalized = this.normalizeKeywordForKeywordStrategy(trimmed)
        if (!normalized || seenKeywords.has(normalized)) continue
        if (/intent=|slots=|pendingAction|JSON|Agent Core|needs_/iu.test(trimmed)) continue
        seenKeywords.add(normalized)
        uniqueKeywords.push(trimmed)
      }
      if (uniqueKeywords.length === 0) continue
      result.push({
        strategy: strategy as AgentKeywordStrategy['strategy'],
        keywords: uniqueKeywords.slice(0, 3),
        reason,
      })
    }

    const hasOriginal = result.some((item) => item.strategy === 'original')
    const hasOther = result.some((item) => item.strategy !== 'original')

    if (hasOriginal && hasOther) {
      return result.slice(0, 6)
    }

    // 校验失败：退化为仅含 original 的结构（用 record.keyword 或 slots.programHint 作为 original）
    const fallbackOriginal = this.resolveFallbackOriginal(record)
    if (!fallbackOriginal) return undefined
    return [
      {
        strategy: 'original',
        keywords: [fallbackOriginal],
        reason: 'LLM keywordStrategies 校验失败，退化为用户原词',
      },
    ]
  }

  /**
   * 归一化 LLM 返回的 suggestSecondaryReflection 字段（escape hatch 标志）。
   *
   * 设计约束（AGENTS.md 本地只保护）：
   * - 仅做布尔值校验，不改变 LLM 决策
   * - 默认 false（escape hatch 关闭时本地忽略此标志）
   *
   * @param value LLM 返回的原始 suggestSecondaryReflection 字段
   * @returns 归一化后的布尔值
   */
  private normalizeSuggestSecondaryReflection(value: unknown): boolean | undefined {
    if (value === true || value === false) return value
    return undefined
  }

  /**
   * 解析退化时使用的 original 关键词。
   *
   * 优先级：record.keyword → record.slots?.programHint → record.slots?.replacementHint → record.slots?.targetProgramName
   *
   * @param record LLM 返回的完整 JSON 对象
   * @returns 退化用的 original 关键词（长度≥2），无则 undefined
   */
  private resolveFallbackOriginal(record: Record<string, unknown>): string | undefined {
    const directKeyword = typeof record.keyword === 'string' ? record.keyword.trim() : ''
    if (directKeyword.length >= 2) return directKeyword

    const slots = record.slots
    if (slots && typeof slots === 'object') {
      const slotRecord = slots as Record<string, unknown>
      const programHint = typeof slotRecord.programHint === 'string' ? slotRecord.programHint.trim() : ''
      if (programHint.length >= 2) return programHint
      const replacementHint = typeof slotRecord.replacementHint === 'string' ? slotRecord.replacementHint.trim() : ''
      if (replacementHint.length >= 2) return replacementHint
      const targetProgramName = typeof slotRecord.targetProgramName === 'string' ? slotRecord.targetProgramName.trim() : ''
      if (targetProgramName.length >= 2) return targetProgramName
    }

    return undefined
  }

  /**
   * 归一化关键词（用于 keywordStrategies 去重比对，不改写原词）。
   *
   * 与 AtomicCommandCapability.normalizeSearchText 保持一致，确保跨模块去重比对一致。
   */
  private normalizeKeywordForKeywordStrategy(value: string): string {
    return value
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '')
      .replace(/[《》"'“”‘’、，。！？；：,.!?;:()[\]【】_-]/gu, '')
  }

  private normalizeStreamingHint(value: unknown): AgentIntentInterpretation['streamingHint'] | undefined {
    if (value === 'thinking' || value === 'final' || value === 'none') return value
    return undefined
  }

  private normalizeSlots(value: unknown): AgentIntentSlots | undefined {
    if (!value || typeof value !== 'object') return undefined
    const source = value as Record<string, unknown>
    const slots: AgentIntentSlots = {}
    this.copyStringSlot(source, slots, 'targetTime')
    this.copyStringSlot(source, slots, 'newStartTime')
    this.copyStringSlot(source, slots, 'rangeStart')
    this.copyStringSlot(source, slots, 'rangeEnd')
    this.copyStringSlot(source, slots, 'programHint')
    this.copyStringSlot(source, slots, 'replacementHint')
    this.copyStringSlot(source, slots, 'candidateId')
    this.copyStringSlot(source, slots, 'targetItemId')
    this.copyStringSlot(source, slots, 'targetProgramName')
    if (typeof source.offsetSeconds === 'number' && Number.isFinite(source.offsetSeconds)) {
      slots.offsetSeconds = Math.trunc(source.offsetSeconds)
    }
    if (source.direction === 'forward' || source.direction === 'backward') {
      slots.direction = source.direction
    }
    return Object.keys(slots).length ? slots : undefined
  }

  private normalizeTaskPlanDraft(value: unknown): AgentTaskPlanDraft | undefined {
    if (!value || typeof value !== 'object') return undefined
    const source = value as Record<string, unknown>
    const goal = typeof source.goal === 'string' ? source.goal.replace(/\s+/g, ' ').trim() : ''
    const stages = this.normalizeTaskPlanStages(source.stages)
    const isComposite = source.isComposite === true || stages.length > 1
    if (!isComposite || !goal || stages.length === 0) return undefined
    return {
      isComposite: true,
      goal: goal.slice(0, 80),
      stages,
    }
  }

  private normalizeTaskPlanStages(value: unknown): AgentTaskPlanStageDraft[] {
    if (!Array.isArray(value)) return []
    return value
      .map((item): AgentTaskPlanStageDraft | null => {
        if (!item || typeof item !== 'object') return null
        const source = item as Record<string, unknown>
        const type = this.normalizeTaskPlanStageType(source.type)
        if (!type) return null
        const action = this.normalizeIntent(source.action)
        const target = source.target && typeof source.target === 'object'
          ? source.target as Record<string, unknown>
          : {}
        const summary = typeof source.summary === 'string'
          ? source.summary.replace(/\s+/g, ' ').trim().slice(0, 80)
          : undefined
        return {
          type,
          action,
          target: {
            programName: typeof target.programName === 'string' ? target.programName.trim().slice(0, 40) : undefined,
            replacementHint: typeof target.replacementHint === 'string' ? target.replacementHint.trim().slice(0, 60) : undefined,
            candidateId: typeof target.candidateId === 'string' ? target.candidateId.trim().slice(0, 80) : undefined,
            candidateCode: typeof target.candidateCode === 'string' ? target.candidateCode.trim().slice(0, 80) : undefined,
            programType: typeof target.programType === 'string' ? target.programType.trim().slice(0, 40) : undefined,
            durationSeconds: typeof target.durationSeconds === 'number' && Number.isFinite(target.durationSeconds)
              ? target.durationSeconds
              : undefined,
            targetTime: typeof target.targetTime === 'string' ? target.targetTime.trim() : undefined,
            rangeStart: typeof target.rangeStart === 'string' ? target.rangeStart.trim() : undefined,
            rangeEnd: typeof target.rangeEnd === 'string' ? target.rangeEnd.trim() : undefined,
            scope: target.scope === 'current_playlist' || target.scope === 'current_gaps' || target.scope === 'time_range'
              ? target.scope
              : undefined,
          },
          layoutDraftReferenced: source.layoutDraftReferenced === true,
          requiresLayoutDraft: source.requiresLayoutDraft === true,
          requiresConfirmation: source.requiresConfirmation === true,
          summary,
        }
      })
      .filter((item): item is AgentTaskPlanStageDraft => Boolean(item))
      .slice(0, 5)
  }

  private normalizeTaskPlanStageType(value: unknown): AgentTaskPlanStageDraftType | undefined {
    return value === 'atomic'
      || value === 'batch_atomic'
      || value === 'draft_refill'
      || value === 'verify'
      || value === 'ask_user'
      ? value
      : undefined
  }

  private copyStringSlot(
    source: Record<string, unknown>,
    target: AgentIntentSlots,
    key: keyof AgentIntentSlots,
  ): void {
    const value = source[key]
    if (typeof value === 'string' && value.trim()) {
      ;(target as Record<string, string>)[key] = value.trim()
    }
  }
}
