import type { LayoutDraft, ScheduleState } from '@/types/orchestration'
import type { LLMClient } from '@/services/llm/llmClient'
import { normalizeAgentPlannerAction, type AgentPlan, type AgentPlannerAction } from '@/services/llm/agentPlanner'
import { STAGE_TIMEOUT_BUDGET, type AgentDeadline } from '@/services/agent/agentDeadline'

type DraftAction = Extract<AgentPlannerAction, { type: 'prepare_layout_draft' | 'refine_layout_draft' }>

export interface ReactDraftDecisionInput {
  llmClient: LLMClient
  promptVersion: string
  userInput: string
  scheduleState: ScheduleState
  currentSchedule: Array<{
    id: string
    programName?: string
    startTime: string
    endTime: string
    duration?: number
    programType?: string
  }>
  currentLayoutDraft?: LayoutDraft | null
  plan: AgentPlan
  researchAction: Extract<AgentPlannerAction, { type: 'research_check' }>
  observation: Record<string, unknown>
  deadline?: AgentDeadline
}

export type ReactDraftDecisionResult =
  | { ok: true; action: DraftAction; assistantReply?: string; reasoning?: string }
  | { ok: false; failureCode: 'research_decide_unavailable' | 'research_decide_invalid' | 'research_evidence_insufficient'; assistantReply?: string }

const clockToSeconds = (value: string): number => {
  const [hours = '0', minutes = '0', seconds = '0'] = value.split(':')
  return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds)
}

const toClockText = (value: string): string => (
  value.includes('T') ? (value.split('T')[1]?.slice(0, 8) ?? value) : value
)

const isCompleteWholeDraftAction = (action: DraftAction): boolean => {
  if (!action.rotationDurationSeconds || action.rotationDurationSeconds <= 0 || action.ignoreExistingLayout !== true) return false
  const segments = [...(action.segments ?? [])].sort((left, right) => left.start.localeCompare(right.start))
  if (!segments.length || clockToSeconds(segments[0]!.start) !== 0) return false
  let cursor = 0
  for (const segment of segments) {
    const start = clockToSeconds(segment.start)
    const end = clockToSeconds(segment.end)
    if (start !== cursor || end <= start) return false
    cursor = end
  }
  return cursor === action.rotationDurationSeconds
}

type ParsedDraftDecision =
  | { ok: true; action: DraftAction; assistantReply?: string; reasoning?: string }
  | { ok: false; assistantReply?: string }

const parseDecision = (content: string): ParsedDraftDecision | null => {
  const jsonMatch = content.match(/\{[\s\S]*\}/)
  if (!jsonMatch) return null
  try {
    const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>
    const assistantReply = typeof parsed.assistantReply === 'string' ? parsed.assistantReply.trim() : undefined
    const reasoning = typeof parsed.reasoning === 'string' ? parsed.reasoning.trim() : undefined
    if (!parsed.action) return { ok: false, assistantReply }
    const normalized = normalizeAgentPlannerAction(parsed.action)
    if (!normalized || (normalized.type !== 'prepare_layout_draft' && normalized.type !== 'refine_layout_draft')) return null
    if (!isCompleteWholeDraftAction(normalized)) return null
    return { ok: true, action: normalized, assistantReply, reasoning }
  } catch {
    return null
  }
}

export async function decideReactWholeDraft(input: ReactDraftDecisionInput): Promise<ReactDraftDecisionResult> {
  let responseContent = ''
  try {
    const response = await input.llmClient.chat([
      {
        role: 'system',
        content: [
          `[prompt ${input.promptVersion}] 你是 AI 编审助手。现在必须基于当前正式编单、当前草案和 research observation，决定整表草案的下一步。`,
          '只返回 JSON：{"action":{...},"assistantReply":"...","reasoning":"..."}。',
          'action 只能是 prepare_layout_draft 或 refine_layout_draft，必须包含 rotationDurationSeconds、ignoreExistingLayout 和覆盖完整目标时长的 segments。',
          'segments 每段必须有 start、end、semanticLabel，可带 programTypeHint；取舍由你基于节目事实、用户策略和 observation 决定，本地不会按候选排序替你拼草案。',
          '这一步只能生成供用户审看的草案，不能返回 atomic_command、formal_orchestration、commit_layout_draft，也不能声称已修改正式播单。',
          '证据不足或不能形成完整草案时，返回 {"action":null,"assistantReply":"说明缺少什么以及如何补充","reasoning":"..."}，不得伪造节目或硬凑时长。',
        ].join('\n'),
      },
      {
        role: 'user',
        content: JSON.stringify({
          userInput: input.userInput,
          playlistType: input.scheduleState.playlistType,
          rotationStrategy: input.scheduleState.rotationStrategy,
          rotationDurationSeconds: input.scheduleState.rotationDurationSeconds,
          currentSchedule: input.currentSchedule,
          currentDraft: input.currentLayoutDraft
            ? {
                targetDurationSeconds: input.currentLayoutDraft.targetDurationSeconds,
                coverage: input.currentLayoutDraft.coverage,
                segments: input.currentLayoutDraft.layoutReference.slots.map((slot, index) => ({
                  start: toClockText(slot.startTime),
                  end: toClockText(slot.endTime),
                  semanticLabel: input.currentLayoutDraft?.columns[index]?.semanticLabel,
                })),
              }
            : null,
          plannerReasoning: input.plan.reasoning,
          researchAction: input.researchAction,
          observation: input.observation,
        }),
      },
    ], {
      temperature: 0.2,
      maxTokens: 1400,
      timeout: input.deadline?.stageTimeoutMs(STAGE_TIMEOUT_BUDGET.candidate_search)
        ?? STAGE_TIMEOUT_BUDGET.candidate_search,
      maxRetries: 0,
      traceLabel: 'agent_react_draft_decide',
      promptVersion: input.promptVersion,
      ...(input.deadline ? { signal: input.deadline.signal() } : {}),
    })
    responseContent = response.content.trim()
  } catch {
    return { ok: false, failureCode: 'research_decide_unavailable' }
  }

  const parsed = parseDecision(responseContent)
  if (!parsed) return { ok: false, failureCode: 'research_decide_invalid' }
  if (!parsed.ok) return { ...parsed, failureCode: 'research_evidence_insufficient' }
  return parsed
}
