import type { ChatMessage } from '@/types/llm'
import type { LLMClient } from '@/services/llm/llmClient'
import { buildPendingLlmContext } from './agentSession'
import type {
  AgentIntentInterpretation,
  AgentIntentInterpreter,
  AgentIntentSlots,
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
  'continue_pending',
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

export class LlmAgentIntentInterpreter implements AgentIntentInterpreter {
  readonly usesLlm = true

  constructor(private readonly llmClient: Pick<LLMClient, 'chat'>) {}

  async interpret(input: AgentSubmitInput): Promise<AgentIntentInterpretation | null> {
    const response = await this.llmClient.chat(this.buildMessages(input), {
      temperature: 0,
      maxTokens: 700,
      timeout: 6000,
      maxRetries: 1,
      traceLabel: 'agent.intent_interpreter',
    })
    const parsed = this.parseJson(response.content)
    if (!parsed || typeof parsed !== 'object') return null

    const record = parsed as Record<string, unknown>
    const requestedIntent = this.normalizeIntent(record.intent)
    if (!requestedIntent) return null
    const confidence = this.normalizeConfidence(record.confidence)
    if (confidence < MIN_STRUCTURED_CONFIDENCE) return null
    const pendingAction = this.normalizePendingAction(
      record.pendingAction,
      input.pendingTask?.allowedActions,
      requestedIntent,
      input.pendingTask?.intent,
    )
    const intent = this.normalizeIntentForPending(requestedIntent, pendingAction, input.pendingTask?.intent)

    return {
      intent,
      pendingAction,
      confidence,
      source: 'llm',
      slots: this.normalizeSlots(record.slots),
      taskPlanDraft: this.normalizeTaskPlanDraft(record.taskPlanDraft),
      queryKind: this.normalizeQueryKind(record.queryKind),
      keyword: typeof record.keyword === 'string' ? record.keyword : undefined,
      searchAlternatives: this.normalizeSearchAlternatives(record.searchAlternatives),
      reasoning: typeof record.reasoning === 'string' ? record.reasoning : undefined,
      assistantFeedback: this.normalizeAssistantFeedback(record.assistantFeedback ?? record.assistantReplyDraft),
      streamingHint: this.normalizeStreamingHint(record.streamingHint),
      rawText: response.content,
    }
  }

  private buildMessages(input: AgentSubmitInput): ChatMessage[] {
    return [
      {
        role: 'system',
        content: [
          'You are the intent interpreter for a broadcast scheduling agent that supports both TV playlists and rotation playlists.',
          'Convert currentTurn.userInput plus any pendingLlmContext.pendingContext into JSON.',
          'Do not decide whether the command is safe, do not choose final programs, and do not modify the schedule.',
          'Use evidencePackage as compact evidence for current schedule, candidate library, readiness, history, constraints, and policy when extracting references such as programme names, time slots, candidate hints, and pending-turn actions.',
          'Read evidencePackage.playlistSemantics before interpreting positions: TV playlists are strict broadcast time grids, while rotation playlists are content queues with relative positions from zero.',
          'For rotation playlists, do not invent channel/date broadcast windows. A phrase like "3小时轮播" is duration scope, and positions usually mean queue position or relative time. For TV playlists, clock times mean broadcast slots.',
          'For full or overall scheduling requests, do not downgrade the user to atomic commands. If the request needs a layout draft, return low confidence and explain in assistantFeedback what is missing.',
          'Use pendingEvidenceSummary as compact evidence for the previous pending task when deciding whether the current turn continues, confirms, selects, cancels, or starts a new task.',
          'Scheduling Agent Core v1.1 only covers atomic playlist commands: move, insert, replace, delete, batch_move, batch_delete, query, and validate.',
          'If the user request contains multiple ordered tasks, also return taskPlanDraft with isComposite=true, a short goal, and ordered stages. Keep intent as the first executable atomic stage, such as batch_delete or insert.',
          'Do not turn layout drafts, full-day auto scheduling, or multi-user collaboration requests into executable atomic writes; return low confidence when the user request is outside this core scope.',
          'If a destination is occupied, do not infer auto-shift, auto-replace, or auto-reorder behavior; only extract the requested move or insert slots and leave blocking to the runtime.',
          'Return JSON only, without Markdown.',
          'intent must be one of: move, insert, replace, delete, batch_move, batch_delete, query, validate.',
          'When pendingTask is present, also set pendingAction to one of: continue_pending, start_new_task, cancel_pending, select_candidate, confirm, reject.',
          'slots may include: targetTime, newStartTime, rangeStart, rangeEnd, programHint, replacementHint, offsetSeconds, direction, candidateId, targetItemId, targetProgramName.',
          'taskPlanDraft.stages may include type atomic, batch_atomic, draft_refill, verify, ask_user. Use draft_refill only when the user explicitly asks to use/reference a layout draft or fill gaps. For batch replace stages, target.programName or target range is the existing content, and target.replacementHint is the desired replacement content. For insert stages, target may include candidateId, candidateCode, programType, and durationSeconds only when already known from context or user-selected candidate evidence. Do not claim any stage has executed.',
          'For insert, replace, and candidate_lookup turns, also return searchAlternatives as 2-5 short Chinese keyword rewrites when helpful. Use similar programme names, column names, content facets, and intent-preserving synonyms; do not invent a final candidate.',
          'Use HH:mm:ss for times. Use seconds for offsetSeconds. direction must be forward or backward.',
          'For commands like "把《看东方》移到10点" or "move Morning News to 10", set intent=move, slots.targetProgramName to the existing programme name, and slots.newStartTime to the destination time.',
          'For commands like "删除看东方" or "remove Morning News", set intent=delete and slots.targetProgramName to the existing programme name; do not invent targetItemId unless the user selected an item.',
          'For commands like "把09:00的节目换成东方新闻", set targetTime for the existing slot and replacementHint for the new programme.',
          'For query intent, queryKind must be one of: schedule_summary, time_lookup, program_lookup, candidate_lookup.',
          'Also return assistantFeedback: one short Chinese sentence addressed to the scheduling editor. It should say what you understood and what will happen next, or what information is still needed. Do not include internal field names, JSON keys, policy ids, or technical terms.',
          'assistantFeedback is the main text the editor sees. Write like a scheduling colleague, not like a system log. Do not mention candidate source, structured intent, confidence, matching score, context package, taskPlan, stage, runtime, policy, evidencePackage, pendingTask, or Agent Core.',
          'When the command must be blocked or needs more information, assistantFeedback must include three plain-language parts: why I cannot continue yet, what is missing, and what the editor can say next.',
          'For destructive or schedule-changing commands such as delete, replace, move, and insert, use a warm confirmation-oriented sentence. If evidencePackage already identifies the target slot or programme, do not say you will first locate it; say the target has been understood and that confirmation or validation will happen before writing.',
          'assistantFeedback examples: "我理解你想把《看东方》移到10点，我会核对当前播单中的目标节目和10点是否空闲。", "我知道你想插入上海景点相关视频，还需要确认插入时间。", "这看起来是在确认上一条插入建议，我会继续沿用上一轮候选和目标时间。"',
          'You may return streamingHint as "thinking" when the UI can safely stream a short progress sentence; otherwise return "final".',
          'If uncertain, return {"confidence":0,"reasoning":"..."} and do not invent executable slots.',
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
    requestedIntent: AtomicCommandIntent,
    pendingAction?: AgentPendingAction,
    pendingIntent?: AtomicCommandIntent,
  ): AtomicCommandIntent {
    if (!pendingIntent) return requestedIntent
    if (!pendingAction || pendingAction === 'start_new_task') return requestedIntent
    return pendingIntent
  }

  private normalizeQueryKind(value: unknown): QueryCommandPlan['queryKind'] | undefined {
    return typeof value === 'string' && QUERY_KINDS.includes(value as QueryCommandPlan['queryKind'])
      ? value as QueryCommandPlan['queryKind']
      : undefined
  }

  private normalizeConfidence(value: unknown): number {
    if (typeof value !== 'number' || Number.isNaN(value)) return 0
    return Math.max(0, Math.min(1, value))
  }

  private normalizeAssistantFeedback(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined
    const normalized = value.replace(/\s+/g, ' ').trim()
    if (!normalized) return undefined
    const sanitized = this.sanitizeAssistantFeedback(normalized)
    if (!sanitized) return undefined
    return sanitized.slice(0, 180)
  }

  private sanitizeAssistantFeedback(value: string): string | undefined {
    if (!ASSISTANT_FEEDBACK_TECHNICAL_PATTERN.test(value)) return value

    const sentenceChunks = value.match(/[^。！？!?；;]+[。！？!?；;]?/gu) ?? [value]
    const readableChunks = sentenceChunks
      .map((item) => item.trim())
      .filter((item) => item && !ASSISTANT_FEEDBACK_TECHNICAL_PATTERN.test(item))
    const readableText = readableChunks.join('')
    if (readableText.length >= 8) return readableText

    const cleaned = value
      .replace(/taskPlan\s*stage\s*已生成[，,；;]?\s*/giu, '我已经整理好这次修改，')
      .replace(/(?:taskPlan|stage|runtime|policy|evidencePackage|pendingTask|Agent Core|JSON)/giu, '')
      .replace(/(?:置信度和匹配度|confidence and matching score)/giu, '节目线索')
      .replace(/(?:置信度|匹配度|confidence|matching score)/giu, '节目线索')
      .replace(/(?:候选源|结构化|上下文包|策略ID|技术词)/gu, '')
      .replace(/会按节目线索和节目线索/gu, '会按节目线索')
      .replace(/\s+/g, ' ')
      .replace(/[，,；;]\s*[，,；;]/g, '，')
      .trim()

    if (!cleaned || cleaned.length < 8) return undefined
    if (ASSISTANT_FEEDBACK_TECHNICAL_PATTERN.test(cleaned)) return undefined
    return cleaned
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
