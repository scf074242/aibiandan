import type { ChatMessage } from '@/types/llm'
import type { LLMClient } from '@/services/llm/llmClient'
import { buildPendingLlmContext } from './agentSession'
import type {
  AgentIntentInterpretation,
  AgentIntentInterpreter,
  AgentIntentSlots,
  AgentPendingAction,
  AgentSubmitInput,
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
      queryKind: this.normalizeQueryKind(record.queryKind),
      keyword: typeof record.keyword === 'string' ? record.keyword : undefined,
      searchAlternatives: this.normalizeSearchAlternatives(record.searchAlternatives),
      reasoning: typeof record.reasoning === 'string' ? record.reasoning : undefined,
      assistantFeedback: this.normalizeAssistantFeedback(record.assistantFeedback),
      streamingHint: this.normalizeStreamingHint(record.streamingHint),
      rawText: response.content,
    }
  }

  private buildMessages(input: AgentSubmitInput): ChatMessage[] {
    return [
      {
        role: 'system',
        content: [
          'You are the intent interpreter for a TV scheduling agent.',
          'Convert currentTurn.userInput plus any pendingLlmContext.pendingContext into JSON.',
          'Do not decide whether the command is safe, do not choose final programs, and do not modify the schedule.',
          'Use evidencePackage as compact evidence for current schedule, candidate library, readiness, history, constraints, and policy when extracting references such as programme names, time slots, candidate hints, and pending-turn actions.',
          'Use pendingEvidenceSummary as compact evidence for the previous pending task when deciding whether the current turn continues, confirms, selects, cancels, or starts a new task.',
          'Scheduling Agent Core v1.1 only covers atomic playlist commands: move, insert, replace, delete, batch_move, batch_delete, query, and validate.',
          'Do not turn layout drafts, full-day auto scheduling, or multi-user collaboration requests into executable atomic writes; return low confidence when the user request is outside this core scope.',
          'If a destination is occupied, do not infer auto-shift, auto-replace, or auto-reorder behavior; only extract the requested move or insert slots and leave blocking to the runtime.',
          'Return JSON only, without Markdown.',
          'intent must be one of: move, insert, replace, delete, batch_move, batch_delete, query, validate.',
          'When pendingTask is present, also set pendingAction to one of: continue_pending, start_new_task, cancel_pending, select_candidate, confirm, reject.',
          'slots may include: targetTime, newStartTime, rangeStart, rangeEnd, programHint, replacementHint, offsetSeconds, direction, candidateId, targetItemId, targetProgramName.',
          'For insert, replace, and candidate_lookup turns, also return searchAlternatives as 2-5 short Chinese keyword rewrites when helpful. Use similar programme names, column names, content facets, and intent-preserving synonyms; do not invent a final candidate.',
          'Use HH:mm:ss for times. Use seconds for offsetSeconds. direction must be forward or backward.',
          'For commands like "把《看东方》移到10点" or "move Morning News to 10", set intent=move, slots.targetProgramName to the existing programme name, and slots.newStartTime to the destination time.',
          'For commands like "删除看东方" or "remove Morning News", set intent=delete and slots.targetProgramName to the existing programme name; do not invent targetItemId unless the user selected an item.',
          'For commands like "把09:00的节目换成东方新闻", set targetTime for the existing slot and replacementHint for the new programme.',
          'For query intent, queryKind must be one of: schedule_summary, time_lookup, program_lookup, candidate_lookup.',
          'Also return assistantFeedback: one short Chinese sentence addressed to the scheduling editor. It should say what you understood and what will happen next, or what information is still needed. Do not include internal field names, JSON keys, policy ids, or technical terms.',
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
    if (/intent=|slots=|pendingAction|confidence|JSON|Agent Core|needs_/iu.test(normalized)) return undefined
    return normalized.slice(0, 180)
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
