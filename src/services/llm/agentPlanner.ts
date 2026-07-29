import type {
  LayoutIntentSegment,
  LayoutDraft,
  LlmFailureInfo,
  PlaylistType,
  RotationPlaylistStrategy,
  ScheduleState,
  TaskMode,
} from '@/types/orchestration'
import type { ChatMessage } from '@/types/llm'
import type { ForegroundAgentContextPackage } from '@/services/runtime/foregroundAgentContextPackage'
import type { ReactTaskPlannerDraft } from '@/services/runtime/reactTaskTypes'
import type { RuntimeScheduleItem } from '@/services/runtime/demoRuntimeFacade'
import type { LLMClient } from './llmClient'
import { buildLlmFailureInfo } from './llmFailure'
import { STAGE_TIMEOUT_BUDGET, type AgentDeadline } from '@/services/agent/agentDeadline'
import type { AgentLlmStreamObserver } from '@/services/agent/agentLlmStreaming'
import type { MutationPolicy } from '@/services/agent/mutationPolicy'
import type { AgentPendingAction } from '@/services/agent/types'

/**
 * agentPlanner prompt 版本号（对齐 AGENTS.md Prompt 版本管理门禁）
 * - v1.0：初始版本
 * - v1.1：formal_orchestration action 直接返回 taskKind / targetTimeRange / searchKeywords，禁止本地语义回填
 * - v1.2：formal_orchestration 同时返回结构化 reactTask，正式长流程进入真 ReAct runtime
 * - v1.3：atomic_command 显式返回 pendingAction，禁止本地关键词猜测确认/取消
 * - v1.4：formal rebuild pending 透传原动作结构，确认轮显式返回匹配的 confirmExistingRebuild
 * - v1.5：formal ReAct 首批 research_check 必须携带 LLM 提供的非空查询或语义标签
 * - v1.6：formal_orchestration / commit_layout_draft 正式执行必须携带 reactTask，禁止回退旧编排器
 * - v1.7：显式区分草案与正式播单 owner，并约束跨轮 pending 切换
 * - v1.8：明确草案完整度不阻断正式播单原子命令，缺槽位时保持原子 owner 追问
 * - v1.9：补充正式编排语义、重编确认与首批 research_check 契约
 * - v1.10：有顺序依赖的多动作必须进入 ReAct，禁止并列 action 被本地盲目串行执行
 * - v1.11：明确有限批量复数命令与整表正式编排边界，并要求候选预检提供受控查询组合
 * - v1.12：明确轮播总时长压缩的歧义澄清、有限删除与整表草案重构边界
 * - v1.13：约束轮播完整范围删除必须输出 batch_delete + pending_only，禁止正文确认与 formal_write 矛盾
 * - v1.14：明确“参考已有编单”的对象/维度澄清与草案优先边界，禁止假装读取或直接复制历史正式编单
 */
export const AGENT_PLANNER_PROMPT_VERSION = 'v1.14' as const

export type AgentPlannerAtomicIntent = 'move' | 'insert' | 'replace' | 'delete' | 'batch_move' | 'batch_delete' | 'query' | 'validate'

export type AgentPlannerAction =
  | {
      type: 'create_playlist'
      playlistType: Exclude<PlaylistType, 'none'>
      rotationStrategy?: RotationPlaylistStrategy
      rotationDurationSeconds?: number
    }
  | {
      type: 'prepare_layout_draft' | 'refine_layout_draft'
      userIntent?: string
      semanticLabel?: string
      programTypeHint?: string
      targetSegmentIndex?: number
      targetSegmentLabel?: string
      targetTimeRange?: { start: string; end: string }
      rotationDurationSeconds?: number
      ignoreExistingLayout?: boolean
      segments?: LayoutIntentSegment[]
    }
  | {
      type: 'commit_layout_draft'
      mode?: Extract<TaskMode, 'full_generate' | 'partial_generate'>
      useLayoutDraft?: boolean
    }
  | {
      type: 'formal_orchestration'
      mode: Extract<TaskMode, 'full_generate' | 'partial_generate'>
      taskKind: 'full_day' | 'overall_refill' | 'local_refill'
      useLayoutDraft?: boolean
      targetTimeRange?: { start: string; end: string }
      searchKeywords?: string[]
      confirmExistingRebuild?: boolean
    }
  | {
      type: 'atomic_command'
      intent?: AgentPlannerAtomicIntent
      pendingAction?: AgentPendingAction
      targetTime?: string
      newStartTime?: string
      rangeStart?: string
      rangeEnd?: string
      programHint?: string
      replacementHint?: string
      offsetSeconds?: number
      direction?: 'forward' | 'backward'
      candidateId?: string
      targetItemId?: string
      targetProgramName?: string
      keyword?: string
      searchAlternatives?: string[]
      mutationPolicy?: MutationPolicy
    }
  | {
      type: 'read_only_analysis'
      analysisKind?: 'playlist_analysis' | 'optimization_suggestion'
    }
  | {
      type: 'research_check'
      purpose?: 'draft_precheck' | 'candidate_precheck' | 'external_trend_check'
      targetTime?: string
      targetSegmentIndex?: number
      targetSegmentLabel?: string
      semanticLabel?: string
      programTypeHint?: string
      queries?: string[]
    }
  | {
      type: 'validate'
    }
  | {
      type: 'clarify'
      question?: string
    }

export type AgentPlanMode = 'single' | 'react'

export interface AgentPlannerInput {
  scheduleState: ScheduleState
  userInput: string
  currentSchedule: RuntimeScheduleItem[]
  currentLayoutDraft?: LayoutDraft | null
  history?: string[]
  contextPackage?: ForegroundAgentContextPackage
}

export interface AgentPlan {
  mode?: AgentPlanMode
  pendingAction?: AgentPendingAction
  actions: AgentPlannerAction[]
  reactTask?: ReactTaskPlannerDraft<AgentPlannerAction>
  assistantReplyDraft?: string
  reasoning?: string
  llmFailure?: LlmFailureInfo
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null
)

const normalizeClock = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined
  const match = value.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/)
  if (!match) return undefined
  const hour = Number(match[1])
  const minute = Number(match[2])
  const second = Number(match[3] ?? '0')
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) return undefined
  return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}:${second.toString().padStart(2, '0')}`
}

const normalizeTimeRange = (value: unknown): { start: string; end: string } | undefined => {
  if (!isRecord(value)) return undefined
  const start = normalizeClock(value.start)
  const end = normalizeClock(value.end)
  return start && end ? { start, end } : undefined
}

const buildPlannerForegroundContext = (contextPackage?: ForegroundAgentContextPackage) => {
  if (!contextPackage) return undefined
  return {
    scenario: contextPackage.scenario,
    workspace: {
      playlistType: contextPackage.workspace.playlistType,
      channelName: contextPackage.workspace.channelName,
      date: contextPackage.workspace.date,
      rotationStrategy: contextPackage.workspace.rotationStrategy,
      rotationDurationSeconds: contextPackage.workspace.rotationDurationSeconds,
      itemCount: contextPackage.workspace.itemCount,
      gapCount: contextPackage.workspace.gapCount,
      scheduleSummary: contextPackage.workspace.scheduleSummary.slice(0, 8),
    },
    layoutDraft: {
      available: contextPackage.layoutDraft.available,
      referencedByCurrentTask: contextPackage.layoutDraft.referencedByCurrentTask,
      coverage: contextPackage.layoutDraft.coverage,
      segmentCount: contextPackage.layoutDraft.segmentCount,
      completeness: contextPackage.layoutDraft.completeness,
      segments: contextPackage.layoutDraft.segments?.slice(0, 12),
    },
    review: contextPackage.review
      ? {
          kind: contextPackage.review.kind,
          owner: contextPackage.review.owner,
          phase: contextPackage.review.phase,
          pendingId: contextPackage.review.pendingId,
          action: contextPackage.review.action,
          summary: contextPackage.review.summary,
          allowedResponses: contextPackage.review.allowedResponses,
          formalRebuild: contextPackage.review.formalRebuild,
        }
      : null,
    pending: contextPackage.pending,
    activeReactTask: contextPackage.reactTask.active || contextPackage.reactTask.recovery?.canRetry
      ? contextPackage.reactTask
      : null,
    allowedActions: contextPackage.allowedActions.slice(0, 12),
  }
}

const normalizeSegment = (value: unknown): LayoutIntentSegment | null => {
  if (!isRecord(value)) return null
  const start = normalizeClock(value.start)
  const end = normalizeClock(value.end)
  const semanticLabel = typeof value.semanticLabel === 'string'
    ? value.semanticLabel.trim()
    : typeof value.label === 'string'
      ? value.label.trim()
      : ''
  if (!start || !end || !semanticLabel) return null
  return {
    start,
    end,
    semanticLabel,
    programTypeHint: typeof value.programTypeHint === 'string' ? value.programTypeHint.trim() : undefined,
    sequential: typeof value.sequential === 'boolean' ? value.sequential : undefined,
  }
}

export const normalizeAgentPlannerAction = (value: unknown): AgentPlannerAction | null => {
  if (!isRecord(value) || typeof value.type !== 'string') return null
  if (value.type === 'create_playlist') {
    const playlistType = value.playlistType === 'tv' || value.playlistType === 'rotation'
      ? value.playlistType
      : null
    if (!playlistType) return null
    const rotationStrategy = value.rotationStrategy === 'rating' || value.rotationStrategy === 'trending' || value.rotationStrategy === 'content_match'
      ? value.rotationStrategy
      : undefined
    return {
      type: 'create_playlist',
      playlistType,
      rotationStrategy,
      rotationDurationSeconds: typeof value.rotationDurationSeconds === 'number'
        ? value.rotationDurationSeconds
        : typeof value.targetDurationSeconds === 'number'
          ? value.targetDurationSeconds
          : undefined,
    }
  }
  if (value.type === 'prepare_layout_draft' || value.type === 'refine_layout_draft') {
    const segments = Array.isArray(value.segments)
      ? value.segments.map(normalizeSegment).filter((item): item is LayoutIntentSegment => Boolean(item))
      : undefined
    const targetSegmentIndex = typeof value.targetSegmentIndex === 'number' && Number.isFinite(value.targetSegmentIndex)
      ? Math.max(1, Math.floor(value.targetSegmentIndex))
      : undefined
    return {
      type: value.type,
      userIntent: typeof value.userIntent === 'string' ? value.userIntent.trim() : undefined,
      semanticLabel: typeof value.semanticLabel === 'string'
        ? value.semanticLabel.trim()
        : typeof value.theme === 'string'
          ? value.theme.trim()
          : undefined,
      programTypeHint: typeof value.programTypeHint === 'string' ? value.programTypeHint.trim() : undefined,
      targetSegmentIndex,
      targetSegmentLabel: typeof value.targetSegmentLabel === 'string' ? value.targetSegmentLabel.trim() : undefined,
      targetTimeRange: normalizeTimeRange(value.targetTimeRange),
      rotationDurationSeconds: typeof value.rotationDurationSeconds === 'number'
        ? value.rotationDurationSeconds
        : typeof value.targetDurationSeconds === 'number'
          ? value.targetDurationSeconds
          : undefined,
      ignoreExistingLayout: value.ignoreExistingLayout === true,
      segments,
    }
  }
  if (value.type === 'commit_layout_draft') {
    return {
      type: 'commit_layout_draft',
      mode: value.mode === 'full_generate' || value.mode === 'partial_generate' ? value.mode : undefined,
      useLayoutDraft: value.useLayoutDraft === true,
    }
  }
  if (value.type === 'formal_orchestration') {
    const mode = value.mode === 'full_generate' || value.mode === 'partial_generate'
      ? value.mode
      : null
    const taskKind = value.taskKind === 'full_day'
      || value.taskKind === 'overall_refill'
      || value.taskKind === 'local_refill'
      ? value.taskKind
      : null
    const hasConsistentTaskKind = mode === 'full_generate'
      ? taskKind === 'full_day'
      : taskKind === 'overall_refill' || taskKind === 'local_refill'
    if (!mode || !taskKind || !hasConsistentTaskKind) return null
    const searchKeywords = Array.isArray(value.searchKeywords)
      ? value.searchKeywords
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 8)
      : undefined
    return {
      type: 'formal_orchestration',
      mode,
      taskKind,
      useLayoutDraft: value.useLayoutDraft === true,
      targetTimeRange: normalizeTimeRange(value.targetTimeRange),
      searchKeywords,
      confirmExistingRebuild: value.confirmExistingRebuild === true,
    }
  }
  if (value.type === 'atomic_command') {
    const searchAlternatives = Array.isArray(value.searchAlternatives)
      ? value.searchAlternatives
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 8)
      : undefined
    const intent = (
      value.intent === 'move'
      || value.intent === 'insert'
      || value.intent === 'replace'
      || value.intent === 'delete'
      || value.intent === 'batch_move'
      || value.intent === 'batch_delete'
      || value.intent === 'query'
      || value.intent === 'validate'
    )
      ? value.intent
      : undefined
    return {
      type: 'atomic_command',
      intent,
      pendingAction: typeof value.pendingAction === 'string' && [
        'start_new_task',
        'cancel_pending',
        'select_candidate',
        'confirm',
        'reject',
      ].includes(value.pendingAction)
        ? value.pendingAction as AgentPendingAction
        : undefined,
      targetTime: normalizeClock(value.targetTime),
      newStartTime: normalizeClock(value.newStartTime),
      rangeStart: normalizeClock(value.rangeStart),
      rangeEnd: normalizeClock(value.rangeEnd),
      programHint: typeof value.programHint === 'string' ? value.programHint.trim() : undefined,
      replacementHint: typeof value.replacementHint === 'string' ? value.replacementHint.trim() : undefined,
      offsetSeconds: typeof value.offsetSeconds === 'number' && Number.isFinite(value.offsetSeconds) ? value.offsetSeconds : undefined,
      direction: value.direction === 'forward' || value.direction === 'backward' ? value.direction : undefined,
      candidateId: typeof value.candidateId === 'string' ? value.candidateId.trim() : undefined,
      targetItemId: typeof value.targetItemId === 'string' ? value.targetItemId.trim() : undefined,
      targetProgramName: typeof value.targetProgramName === 'string' ? value.targetProgramName.trim() : undefined,
      keyword: typeof value.keyword === 'string' ? value.keyword.trim() : undefined,
      searchAlternatives,
      mutationPolicy: value.mutationPolicy === 'preview_only' || value.mutationPolicy === 'pending_only' || value.mutationPolicy === 'formal_write'
        ? value.mutationPolicy
        : undefined,
    }
  }
  if (value.type === 'validate' || value.type === 'read_only_analysis') {
    return value.type === 'read_only_analysis'
      ? {
          type: 'read_only_analysis',
          analysisKind: value.analysisKind === 'optimization_suggestion' ? 'optimization_suggestion' : 'playlist_analysis',
        }
      : { type: value.type }
  }
  if (value.type === 'research_check') {
    const purpose = value.purpose === 'candidate_precheck' || value.purpose === 'external_trend_check'
      ? value.purpose
      : 'draft_precheck'
    const targetSegmentIndex = typeof value.targetSegmentIndex === 'number' && Number.isFinite(value.targetSegmentIndex)
      ? Math.max(1, Math.floor(value.targetSegmentIndex))
      : undefined
    const queries = Array.isArray(value.queries)
      ? value.queries
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 8)
      : undefined
    return {
      type: 'research_check',
      purpose,
      targetTime: normalizeClock(value.targetTime),
      targetSegmentIndex,
      targetSegmentLabel: typeof value.targetSegmentLabel === 'string' ? value.targetSegmentLabel.trim() : undefined,
      semanticLabel: typeof value.semanticLabel === 'string' ? value.semanticLabel.trim() : undefined,
      programTypeHint: typeof value.programTypeHint === 'string' ? value.programTypeHint.trim() : undefined,
      queries,
    }
  }
  if (value.type === 'clarify') {
    return {
      type: 'clarify',
      question: typeof value.question === 'string' ? value.question.trim() : undefined,
    }
  }
  return null
}

const normalizeReactTask = (value: unknown): ReactTaskPlannerDraft<AgentPlannerAction> | undefined => {
  if (!isRecord(value)) return undefined
  const rawActions = Array.isArray(value.nextActions)
    ? value.nextActions
    : Array.isArray(value.actions)
      ? value.actions
      : []
  const nextActions = rawActions
    .map(normalizeAgentPlannerAction)
    .filter((item): item is AgentPlannerAction => Boolean(item))
  if (!nextActions.length) return undefined
  const objective = typeof value.objective === 'string' && value.objective.trim()
    ? value.objective.trim()
    : '长程编排任务'
  return {
    objective,
    maxTurns: typeof value.maxTurns === 'number' ? Math.max(1, Math.min(5, Math.floor(value.maxTurns))) : undefined,
    batchSize: typeof value.batchSize === 'number' ? Math.max(1, Math.min(10, Math.floor(value.batchSize))) : undefined,
    stopCondition: typeof value.stopCondition === 'string' ? value.stopCondition.trim() : undefined,
    nextActions,
  }
}

export class AgentPlanner {
  constructor(private llmClient: LLMClient) {}

  async plan(input: AgentPlannerInput, deadline?: AgentDeadline, onStreamEvent?: AgentLlmStreamObserver): Promise<AgentPlan> {
    const startedAt = Date.now()
    let sequence = 0
    let receivedChars = 0
    let firstTokenLatencyMs: number | undefined
    try {
      // deadline 接入：stage timeout 从 deadline 剩余预算推导，signal 联动底层 fetch 中止
      const stageTimeout = deadline?.stageTimeoutMs(STAGE_TIMEOUT_BUDGET.candidate_search) ?? STAGE_TIMEOUT_BUDGET.candidate_search
      const response = await this.llmClient.chat(this.buildPrompt(input), {
        temperature: 0.2,
        maxTokens: 1100,
        timeout: stageTimeout,
        maxRetries: 1,
        traceLabel: 'agent_planner',
        promptVersion: AGENT_PLANNER_PROMPT_VERSION,
        ...(deadline ? { signal: deadline.signal() } : {}),
        onToken: (_delta, meta) => {
          receivedChars = meta.receivedChars
          firstTokenLatencyMs = meta.firstTokenLatencyMs
          onStreamEvent?.({
            stage: 'planner',
            kind: meta.index === 0 ? 'first_token' : 'token_delta',
            sequence: sequence++,
            receivedChars,
            elapsedMs: meta.elapsedMs,
            firstTokenLatencyMs,
          })
        },
      })
      const plan = this.parsePlan(response.content)
      // 浏览器 mock 可能只返回完整内容而不产生 token；没有真实流事件时不插入
      // “结构完成”进度，避免改变原有计划说明的展示顺序。
      if (sequence > 0) {
        onStreamEvent?.({
          stage: 'planner',
          kind: plan.llmFailure ? 'structured_invalid' : 'structured_complete',
          sequence: sequence++,
          receivedChars: receivedChars || response.content.length,
          elapsedMs: Date.now() - startedAt,
          firstTokenLatencyMs,
        })
      }
      return plan
    } catch (error) {
      onStreamEvent?.({
        stage: 'planner',
        kind: 'structured_invalid',
        sequence: sequence++,
        receivedChars,
        elapsedMs: Date.now() - startedAt,
        firstTokenLatencyMs,
      })
      return {
        actions: [],
        llmFailure: buildLlmFailureInfo('agent_planning', error),
      }
    }
  }

  private buildPrompt(input: AgentPlannerInput): ChatMessage[] {
    const schedule = input.scheduleState
    const draft = input.currentLayoutDraft
    const currentDraft = draft
      ? {
          exists: true,
          draftKind: draft.draftKind,
          targetDurationSeconds: draft.targetDurationSeconds,
          coverage: draft.coverage,
          segments: draft.layoutReference.slots.slice(0, 24).map((slot) => {
            const column = draft.columns.find((item) => item.columnId === slot.columnId)
            return {
              start: slot.startTime.split('T')[1]?.slice(0, 8) ?? slot.startTime,
              end: slot.endTime.split('T')[1]?.slice(0, 8) ?? slot.endTime,
              label: column?.semanticLabel ?? column?.columnName ?? slot.columnId,
              programType: column?.defaultProgramType,
              queryHints: column?.queryHints?.slice(0, 6),
            }
          }),
        }
      : { exists: false }
    return [
      {
        role: 'system',
        content: `[prompt ${AGENT_PLANNER_PROMPT_VERSION}] ${this.buildSystemInstructions(input).join('\n')}`,
      },
      {
        role: 'user',
        content: JSON.stringify({
          workspace: {
            playlistType: schedule.playlistType ?? 'none',
            channelId: schedule.channelId,
            channelName: schedule.channelName,
            date: schedule.date,
            itemCount: schedule.itemCount,
            gapCount: schedule.gapCount,
            rotationStrategy: schedule.rotationStrategy,
            rotationDurationSeconds: schedule.rotationDurationSeconds,
          },
          currentDraft,
          currentSchedulePreview: input.currentSchedule.slice(0, 12).map((item) => ({
            id: item.id,
            programName: item.programName,
            startTime: item.startTime,
            endTime: item.endTime,
            duration: item.duration,
            programType: item.programType,
          })),
          history: input.history?.slice(-8) ?? [],
          userInput: input.userInput,
          foregroundContext: buildPlannerForegroundContext(input.contextPackage),
        }),
      },
    ]
  }

  private buildSystemInstructions(input: AgentPlannerInput): string[] {
    const playlistType = input.scheduleState.playlistType ?? 'none'
    const hasDraft = Boolean(input.currentLayoutDraft)
    const hasActiveReactTask = Boolean(input.contextPackage?.reactTask.active || input.contextPackage?.reactTask.recovery?.canRetry)
    return [
      ...this.buildCorePlannerPolicy(),
      ...this.buildWorkspacePlannerPolicy(playlistType),
      ...this.buildDraftPlannerPolicy({ playlistType, hasDraft }),
      ...this.buildReactPlannerPolicy({ hasActiveReactTask }),
      ...this.buildOutputPlannerPolicy({ playlistType, hasDraft }),
    ]
  }

  private buildCorePlannerPolicy(): string[] {
    return [
      'formal_orchestration 是长流程控制动作，必须同时返回顶层 mode:"react" 和 reactTask；actions 中保留 formal_orchestration 用于 bootstrap 与业务语义，reactTask.nextActions 给出第一批实际动作，本地不会替你生成第一步。',
      'commit_layout_draft 会启动正式编排时同样是长流程控制动作，也必须同时返回顶层 mode:"react" 和 reactTask；不能只返回 commit_layout_draft 让本地旧编排器补做后续。',
      '正式编排 reactTask.nextActions 的第一批只能包含 research_check、validate 等可观察动作。观察之后再由 decide 决定是否进入 atomic_command；atomic_command 必须显式携带 mutationPolicy（preview_only / pending_only / formal_write），不得依赖本地默认值。',
      '只有用户本轮是在确认当前 formal rebuild pending 时，formal_orchestration action 才返回 confirmExistingRebuild:true；首次发起或没有对应 pending 时不得返回。',
      '当 foregroundContext.review.kind="formal_rebuild" 且用户本轮确认时，必须复用 review.formalRebuild 的 actionKind、mode、useLayoutDraft：actionKind="formal_orchestration" 时返回顶层 mode:"react"、匹配 mode/useLayoutDraft 的 formal_orchestration action、confirmExistingRebuild:true 和 reactTask；actionKind="commit_layout_draft" 时返回匹配 mode 的 commit_layout_draft。不要再次发起一个未确认的新重编请求。',
      '你是 AI 编审助手的 LLM planner。你的任务是理解编排员的自然语言，并返回一个可执行的多动作计划。',
      '不要把一句话压成单个分类。用户一句话可能同时包含：创建播单、生成草案、细分内容块、只读分析、正式编排、原子修改。',
      '多动作输出有严格边界：只有“创建播单并生成对应草案”可以在 single 模式返回两个 actions；多个原子动作、查询后再写入、先查证再修改等有顺序依赖的任务必须返回 mode:"react" + reactTask，由每轮 observation 后重新 decide，不要在 single actions 中并列返回后期待本地串行执行。',
      '批量与整体编排按影响范围界定：删除、移动、替换有限、可定位的目标集合，仍属于 batch_delete / batch_move 或复合原子命令；即使动作不止一个，也不等于 formal_orchestration。不能因为草案缺失或不完整，把这类正式播单批量操作改成完善草案。',
      '只有目标覆盖整张播单、全部空窗或完整目标时长，且需要持续检索、观察和回判时，才使用 formal_orchestration；如果该 taskKind 按播单类型需要草案而草案缺失或不完整，应明确引导完善草案，不能降级成一组猜测的插入命令。',
      '本地系统只负责安全裁决和执行；你负责理解业务意图、拆动作、生成草案结构。',
      '上一轮候选、缺参或确认信息会作为上下文提供给你；普通自然语言追问、选择和修正都由你结合上下文理解，不要假设本地会用关键词替你续接。',
      'assistantReplyDraft 必须承接当前上下文并给出下一步引导：说明“我正在做什么/已完成什么/下一步会做什么”，但不得承诺尚未通过候选、业务门禁或正式写入校验的结果。',
      '当前存在 pending 且用户在确认、取消、拒绝或开始新任务时，atomic_command 必须显式返回 pendingAction（confirm / cancel_pending / reject / start_new_task）和与 pending 一致的 intent。本地不会从“确认”“继续”等文字猜测。',
      '如果新任务不是 atomic_command（例如 read_only_analysis 或草案操作），但需要结束当前 pending，在 AgentPlan 顶层返回 pendingAction:"start_new_task"。本地只依据该结构化字段处置 pending。',
      'foregroundContext.pending.owner 明确表示当前 pending 属于 layout_draft 还是 formal_playlist。用户本轮明确切换 owner 时，必须结束旧 pending：非 atomic 新任务在顶层返回 pendingAction:"start_new_task"；atomic 新任务在 atomic_command 中返回 pendingAction:"start_new_task"。不得把上一 owner 的槽位、候选或确认复用到新 owner。',
      '如果草案和正式播单同时存在，而“第二段”“那条”“删掉这个”等指代无法判断目标属于草案还是正式播单，返回 clarify 追问目标对象；不要默认选择任一 owner。',
      '用户要求“参考某张已有编单进行编排”时，必须先确认两个事实：参考对象能否由明确日期、频道或工作区定位，以及参考维度是版面结构、节目内容分布还是连续节目顺播进度。任一事实缺失时返回 clarify，并说明当前草案和正式播单不修改；不得从“之前那张”“某某编单”等模糊表达猜参考对象。',
      '参考版面结构应进入既有版面草案引用，参考连续节目进度应使用历史编排证据；参考某张正式编单的内容分布属于整表方案证据，只有上下文已提供可验证的参考编单事实时才可先形成草案供审看。没有结构化参考事实时继续 clarify，不得声称已读取；即使事实完整，也不得直接复制历史正式编单、让历史覆盖当前现场，或绕过草案确认启动正式写入。',
      '当你返回 atomic_command 时，如果你已经从本轮或历史上下文理解到动作、时间/队列位置、节目线索、替换线索或候选选择，必须写入 action 字段：intent、targetTime、programHint、replacementHint、candidateId、targetItemId、targetProgramName、searchAlternatives 等。不要只返回 {"type":"atomic_command"} 后让下一层重新猜。',
      '当你返回 formal_orchestration 时，必须直接给出 mode、taskKind、useLayoutDraft、targetTimeRange 和 searchKeywords；本地不会再从用户原话猜这些语义。taskKind 只能是 full_day / overall_refill / local_refill：全天重编用 full_day，补齐整张播单的全部空窗用 overall_refill，指定时段或局部范围补排用 local_refill。',
      'formal_orchestration 的 mode 与 taskKind 必须一致：full_generate 只能搭配 full_day；partial_generate 只能搭配 overall_refill 或 local_refill。local_refill 应给出 targetTimeRange；没有明确关键词时 searchKeywords 返回空数组，不要编造。',
      '多轮补充也一样：如果上一轮是“插入上海景点宣传片”且系统追问位置，用户本轮说“队列最开始”，应返回 {"type":"atomic_command","intent":"insert","targetTime":"00:00:00","programHint":"上海市景点相关的宣传片"}。轮播单队列开头用 targetTime:"00:00:00" 表示。',
      '如果用户是在问“整体怎么样/怎么优化”，返回 read_only_analysis，除非用户明确确认更新草案。',
      '只返回 JSON，不要 Markdown。',
    ]
  }

  private buildWorkspacePlannerPolicy(playlistType: PlaylistType): string[] {
    if (playlistType === 'none') {
      return [
        '当前没有已打开播单。用户只说“新建草案/做草案/调整草案”，但没有明确电视播单或轮播单时，不要默认创建电视播单，应返回 clarify 追问播单类型。',
        '用户说“新建一个...轮播单，主要...”时，返回 create_playlist + prepare_layout_draft 两个动作；如果他说了总时长，也把 rotationDurationSeconds 写进动作。',
        '如果用户只给总时长和主题，你可以返回一段式草案，也可以按业务常识拆成多段，但不要写正式节目。',
      ]
    }
    if (playlistType === 'rotation') {
      return [
        '当前工作区是轮播单。轮播单是内容队列，不是电视时间格；轮播草案用从 00:00:00 起算的相对时长，不要使用 06:00:00-23:59:59 的电视全天窗口。',
        '轮播单“压缩 N 小时”可能表示减少 N 小时，也可能表示压缩到 N 小时；例如当前 3 小时时，“减少 2 小时”得到 1 小时，“压缩到 2 小时”得到 2 小时。用户没有说清时必须返回 clarify，同时追问目标总时长和内容取舍方式，不能静默选择一种解释。',
        '轮播总时长压缩不能解释为 batch_move，因为平移不会改变队列总时长。用户明确删除队尾或明确相对范围，且边界落在完整节目之间时，属于有限、可定位的 batch_delete，action 必须返回 intent:"batch_delete"、rangeStart、rangeEnd 和 mutationPolicy:"pending_only"；涉及多个节目或一个范围时不得降成 delete，初次提出的批量删除不得使用 formal_write。删除仍需确认；边界会穿过节目时必须追问，不得裁切节目或直接改写节目时长。',
        '用户要求按热播、收视率、内容匹配等策略压缩整张轮播单到明确目标时长时，属于整表内容重构：先准备或调整轮播草案，使目标时长和取舍策略明确；本轮只更新草案，不写正式播单。草案完整后由用户确认再启动正式 ReAct 重编，并遵守已有节目整批重编授权。',
        '已打开播单时，用户说“插入/排入/放入/放到队列开头/队列末尾/后面接着放”等正式节目动作，就是原子或复合操作；不要因为轮播草案为空而改成草案生成或整体编排门禁。',
        '如果用户说“插入/排入/放入”但只给了内容描述或主题，没有给具体节目，也没有给明确位置，不要返回裸 atomic_command；返回 research_check，purpose:"candidate_precheck"，queries 写可检索关键词，并在 assistantReplyDraft 里说明还需要确认插入位置。',
        '没有给具体节目，也没有给明确位置，不要返回裸 atomic_command。',
        '不要擅自把缺少位置的轮播插入理解成“队列末尾”或“队列开头”。只有用户明确说了开头、末尾、某节目后、某相对位置，才把它作为目标位置。',
        '精准原子命令不要激活 ReAct。例如“9点插入电视剧生命树第5集”已经有目标时间和具体节目/剧集，应返回 atomic_command。',
        '模糊原子命令可以激活 ReAct。例如“9点插入一个与近期观众特别关心内容相关联的视频内容”，应返回 mode:"react"，reactTask.nextActions 第一项为 research_check，并带 targetTime:"09:00:00"、purpose:"candidate_precheck" 和可检索 queries；查到候选后本地会进入插入候选选择，不会直接写播单。',
      ]
    }
    if (playlistType === 'tv') {
      return [
        '当前工作区是电视播单。电视播单是时间格子，电视草案里的栏目/时段可帮助定位正式播单的编排位置。',
        '已打开电视播单时，正式播单的插入、删除、移动、替换与草案完整度无关：即使草案为空或只完成一部分，也必须保持 atomic_command；信息完整时进入原子执行链，缺少时间、节目或目标时进入原子补参/候选澄清，不能改成 refine_layout_draft、commit_layout_draft 或 formal_orchestration。',
        '如果用户说“填入/排入/插入/编排/放到播单里”，默认是正式播单动作，应返回 atomic_command；如果他说“在某栏目/某草案格子里填入期数最大的一期”，也应返回 atomic_command，并让本地借当前草案定位栏目或时段。',
        '例如当前电视草案有“东方快报”时，用户说“在东方快报里，帮我找到期数最大的一期填入”，这是正式编排请求，应返回 atomic_command，并写出 intent:"insert"、targetTime:"06:00:00"（如果 currentDraft 能定位到该栏目开始时间）、targetProgramName:"东方快报"、programHint:"东方快报 期数最大"、searchAlternatives:["东方快报 期数最大","东方快报 最新一期","东方快报"]。不要返回 research_check，也不要说已更新草案。',
        '如果用户是插入、删除、移动、替换、查询、校验等原子或复合操作，返回 atomic_command 或 validate，让本地原子能力继续处理。',
      ]
    }
    return []
  }

  private buildDraftPlannerPolicy(input: { playlistType: PlaylistType; hasDraft: boolean }): string[] {
    const base = [
      '“草案查证/草案改写”和“正式填入节目”必须分清。只有用户明确说“更新草案/改草案/调整版面草案/写到草案”时，才把结果停留在 refine_layout_draft 或 draft_precheck。',
      '用户明确操作草案段、草案块、版面时，即使使用“插入、删除、移动、替换”等原子动词，也属于 layout_draft owner：返回 refine_layout_draft，并用 segments 表达更新后的草案结构；不得返回 formal playlist 的 atomic_command。',
      '用户明确操作正式播单、编排单、串联单或已有正式节目时，属于 formal_playlist owner：返回 atomic_command；草案只能作为定位参考，不能被修改。',
      '用户给出第一小时/第二小时/每条10分钟/拆成N条/分三段等结构时，必须在 prepare_layout_draft 或 refine_layout_draft 中返回 segments。',
      '如果用户要求“先看看/核验/找最火/最近三年/有没有素材/查一下成品库/这个草案块选什么”，返回 research_check。research_check 只负责让本地查草案和素材库，不会改草案，也不会写正式节目。',
      'research_check 应由你给出 targetSegmentIndex 或 targetSegmentLabel、semanticLabel 和非空 queries；queries 或语义标签至少一项必须可直接检索，不要让本地猜策划内容，也不要返回 queries:[]。',
      '候选预检的 queries 应提供 2-6 个受控查询：先保留用户明确节目名、主题和硬条件，再给同义改写、拆分词或逐步放宽的查询；不得删除用户明确要求后用弱相关节目冒充命中。运行时会逐个读取这些真实查询并去重，不会替你补造关键词。',
    ]
    if (!input.hasDraft) return base
    return [
      ...base,
      '如果 currentDraft.exists=true，且用户说“第几个小时/第几段/某个内容块改成...”，这是草案微调，必须返回 refine_layout_draft；不要返回 atomic_command，除非用户明确说要写入正式播单或操作已有正式节目。',
      '如果用户明确说“重写草案/重做草案/草案全部改成/这份草案重新整理为...”，仍然返回 refine_layout_draft，并用 segments 表达新草案；这只改草案，不写正式播单。',
      '如果 currentDraft.exists=true，且用户说“参考草案编排/按草案编排/确认草案/就按这个草案/开始编排/进入正式编排”，必须返回 commit_layout_draft；不要只在 assistantReplyDraft 里说“正在编排”。',
      input.playlistType === 'rotation'
        ? '轮播草案里的“第一小时、第二小时、第三小时”指内容块的相对时长位置，不是电视播出时间，也不是正式节目单上的现有节目。'
        : '',
      '草案微调时，semanticLabel 必须来自用户最新句子里“改成/换成/调整为”后面的新内容，不要从 currentDraft.segments 复制旧内容标签。',
      '如果用户按现有草案块名称来改，例如“亚洲队10介绍换成中国队介绍”，返回 refine_layout_draft，并带 targetSegmentLabel:"亚洲队10介绍"、semanticLabel:"中国队介绍"；如果 foregroundContext.layoutDraft.segments 能看出它是第 10 段，也带 targetSegmentIndex:10。不要把它当成重新生成整张草案。',
    ].filter(Boolean)
  }

  private buildReactPlannerPolicy(input: { hasActiveReactTask: boolean }): string[] {
    const lines = [
      '如果用户目标需要先查证、再观察、再决定下一步，返回顶层 {"mode":"react","reactTask":{...}}，不要把长程任务塞成普通 action。',
      'reactTask 必须写 objective、maxTurns、stopCondition，并把第一轮要做的可验证动作放进 nextActions。不要让本地猜第一步。',
    ]
    if (input.hasActiveReactTask) {
      lines.push(
        '如果 foregroundContext.activeReactTask 存在，说明前面已经有一个长程任务。不要把“继续”这类短词当成本地续接开关；必须结合用户本轮话、activeReactTask.objective、lastObservation、pendingSteps、recovery 判断是否仍在同一任务。',
        'activeReactTask.status=failed 且 recovery.canRetry=true 时，只有用户明确要求“重试/再试一次/重新试”才应返回 mode:"react" 并给出修正后的 reactTask.nextActions；本地不会把“继续”当成隐藏续接开关，也不会回滚多步。',
        'activeReactTask.lastObservation 已经显示素材足够但需要用户确认时，不要声称已更新草案或已写正式播单；应返回 refine_layout_draft、research_check 或 clarify 中最合适的下一步，让本地继续守门。',
      )
    }
    return lines
  }

  private buildOutputPlannerPolicy(input: { playlistType: PlaylistType; hasDraft: boolean }): string[] {
    const examples = [
      'JSON 形状：{"mode":"single","actions":[{"type":"create_playlist","playlistType":"rotation","rotationStrategy":"content_match","rotationDurationSeconds":3600},{"type":"prepare_layout_draft","rotationDurationSeconds":3600,"semanticLabel":"世界杯亚洲球队介绍","segments":[{"start":"00:00:00","end":"00:15:00","semanticLabel":"中国队介绍","programTypeHint":"news_magazine"}]}],"assistantReplyDraft":"...","reasoning":"..."}',
      '原子槽位示例：{"mode":"single","actions":[{"type":"atomic_command","intent":"insert","targetTime":"00:00:00","programHint":"上海市景点相关的宣传片","searchAlternatives":["上海景点宣传片","上海文旅宣传片","上海地标短片"]}],"assistantReplyDraft":"我会按轮播队列开头继续找上海景点相关宣传片候选。","reasoning":"用户补充了上一轮缺少的插入位置。"}',
      '正式重编确认示例：当 foregroundContext.review={"kind":"formal_rebuild","formalRebuild":{"actionKind":"formal_orchestration","mode":"full_generate","useLayoutDraft":true}} 且用户确认时，返回 {"mode":"react","actions":[{"type":"formal_orchestration","mode":"full_generate","taskKind":"full_day","useLayoutDraft":true,"searchKeywords":["东方卫视 当前版面 栏目候选"],"confirmExistingRebuild":true}],"reactTask":{"objective":"按当前草案重新编排正式播单","maxTurns":5,"batchSize":5,"stopCondition":"完成目标范围并通过最终校验","nextActions":[{"type":"research_check","purpose":"candidate_precheck","semanticLabel":"按当前版面草案检索各栏目候选","queries":["东方卫视 当前版面 栏目候选"]}]},"assistantReplyDraft":"我会先查节目库并逐批校验。","reasoning":"用户确认当前待处理的正式重编。"}',
    ]
    if (input.playlistType === 'tv') {
      examples.push('电视草案定位示例：{"mode":"single","actions":[{"type":"atomic_command","intent":"insert","targetTime":"06:00:00","targetProgramName":"东方快报","programHint":"东方快报 期数最大","searchAlternatives":["东方快报 期数最大","东方快报 最新一期","东方快报"]}],"assistantReplyDraft":"我会按草案里的东方快报栏目定位时段，再按期数最大的要求去筛节目，确认可用后写入正式播单。","reasoning":"用户是在电视草案栏目里要求正式填入节目，不是修改草案。"}')
      examples.push('参考编单澄清示例：用户说“参考东方卫视之前那张已有编单，重新规划今天整张播单”但没有明确参考日期和参考维度时，返回 {"mode":"single","actions":[{"type":"clarify","question":"请说明要参考哪一天或哪个工作区的编单，以及参考版面结构、节目内容分布还是连续节目进度。"}],"assistantReplyDraft":"我先定位参考编单和参考维度；确认前不会修改当前草案或正式播单。","reasoning":"参考事实不足，不能猜测或直接复制历史正式编单。"}')
    }
    if (input.playlistType === 'rotation') {
      examples.push('轮播完整范围删除示例：当前3小时轮播单由完整节目组成，用户说“把队尾完整的2小时内容删掉，保留第1小时”时，返回 {"mode":"single","actions":[{"type":"atomic_command","intent":"batch_delete","rangeStart":"01:00:00","rangeEnd":"03:00:00","mutationPolicy":"pending_only"}],"assistantReplyDraft":"1小时边界落在完整节目之间，我会先列出01:00到03:00的待删除节目，请你确认后再写入。","reasoning":"这是有限且边界完整的范围删除，不是单条delete、batch_move或整体重编。"}')
    }
    if (input.hasDraft) {
      examples.push('草案块名称微调示例：{"mode":"single","actions":[{"type":"refine_layout_draft","targetSegmentIndex":10,"targetSegmentLabel":"亚洲队10介绍","semanticLabel":"中国队介绍"}],"assistantReplyDraft":"我会把第10段从亚洲队10介绍调整为中国队介绍，只更新草案，不写正式节目。","reasoning":"用户按草案块名称提出局部微调。"}')
    }
    examples.push('正式编排示例：{"mode":"react","actions":[{"type":"formal_orchestration","mode":"partial_generate","taskKind":"overall_refill","useLayoutDraft":false,"searchKeywords":["新闻","纪录片"]}],"reactTask":{"objective":"补齐当前播单的全部空窗","maxTurns":5,"batchSize":3,"stopCondition":"所有目标空窗完成或暴露无法填充原因","nextActions":[{"type":"research_check","purpose":"candidate_precheck","queries":["新闻","纪录片"]}]},"assistantReplyDraft":"我会先查节目库，再逐批补齐当前空窗。","reasoning":"用户要求整体补空，不是指定时段的局部补排。"}')
    if (input.playlistType !== 'tv') {
      examples.push('ReAct 示例：{"mode":"react","actions":[],"reactTask":{"objective":"先核验金山区热门景点素材，再更新草案方向","maxTurns":3,"batchSize":5,"stopCondition":"素材方向明确后更新草案，不直接写正式播单","nextActions":[{"type":"research_check","purpose":"candidate_precheck","targetSegmentIndex":1,"semanticLabel":"金山区最近三年热门景点","programTypeHint":"documentary","queries":["金山区 近三年 热门景点 宣传片","金山 乐高乐园 景点 宣传片"]}]},"assistantReplyDraft":"我先核一下素材库，再把可用方向整理到草案里。正式播单不会被写入。","reasoning":"用户要求先查证再处理草案。"}')
    }
    return examples
  }

  private parsePlan(content: string): AgentPlan {
    const jsonMatch = content.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      return {
        actions: [{ type: 'clarify', question: '我还没能把这句话整理成可执行步骤，请换一种说法。' }],
        assistantReplyDraft: '我还没能把这句话整理成可执行步骤，请换一种说法。',
      }
    }
    try {
      const parsed = JSON.parse(jsonMatch[0])
      const rawActions = Array.isArray(parsed.actions) ? parsed.actions as unknown[] : []
      const legacyReactTask = rawActions
        .map((item) => isRecord(item) && item.type === 'react_task' ? normalizeReactTask(item) : undefined)
        .find(Boolean)
      const actions = rawActions
        .filter((item) => !(isRecord(item) && item.type === 'react_task'))
        .map(normalizeAgentPlannerAction)
        .filter((item): item is AgentPlannerAction => Boolean(item))
      const reactTask = normalizeReactTask(parsed.reactTask) ?? legacyReactTask
      const mode: AgentPlanMode = parsed.mode === 'react' || reactTask ? 'react' : 'single'
      return {
        mode,
        pendingAction: typeof parsed.pendingAction === 'string' && [
          'start_new_task',
          'cancel_pending',
          'select_candidate',
          'confirm',
          'reject',
        ].includes(parsed.pendingAction)
          ? parsed.pendingAction as AgentPendingAction
          : undefined,
        actions,
        reactTask,
        assistantReplyDraft: typeof parsed.assistantReplyDraft === 'string' ? parsed.assistantReplyDraft.trim() : undefined,
        reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning.trim() : undefined,
      }
    } catch {
      return {
        actions: [{ type: 'clarify', question: '我还没能把这句话整理成可执行步骤，请换一种说法。' }],
        assistantReplyDraft: '我还没能把这句话整理成可执行步骤，请换一种说法。',
      }
    }
  }
}

let globalAgentPlanner: AgentPlanner | null = null

export function getAgentPlanner(llmClient: LLMClient): AgentPlanner {
  if (!globalAgentPlanner) {
    globalAgentPlanner = new AgentPlanner(llmClient)
  }
  return globalAgentPlanner
}
