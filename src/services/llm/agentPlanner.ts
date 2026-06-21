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
      useLayoutDraft?: boolean
      targetTimeRange?: { start: string; end: string }
    }
  | {
      type: 'atomic_command'
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
          action: contextPackage.review.action,
          summary: contextPackage.review.summary,
        }
      : null,
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

const normalizeAction = (value: unknown): AgentPlannerAction | null => {
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
    return {
      type: value.type,
      userIntent: typeof value.userIntent === 'string' ? value.userIntent.trim() : undefined,
      semanticLabel: typeof value.semanticLabel === 'string'
        ? value.semanticLabel.trim()
        : typeof value.theme === 'string'
          ? value.theme.trim()
          : undefined,
      programTypeHint: typeof value.programTypeHint === 'string' ? value.programTypeHint.trim() : undefined,
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
    return {
      type: 'formal_orchestration',
      mode: value.mode === 'partial_generate' ? 'partial_generate' : 'full_generate',
      useLayoutDraft: value.useLayoutDraft === true,
      targetTimeRange: normalizeTimeRange(value.targetTimeRange),
    }
  }
  if (value.type === 'atomic_command' || value.type === 'validate' || value.type === 'read_only_analysis') {
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
    .map(normalizeAction)
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

  async plan(input: AgentPlannerInput): Promise<AgentPlan> {
    try {
      const response = await this.llmClient.chat(this.buildPrompt(input), {
        temperature: 0.2,
        maxTokens: 1800,
        timeout: 60000,
        maxRetries: 1,
        traceLabel: 'agent_planner',
      })
      return this.parsePlan(response.content)
    } catch (error) {
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
        content: [
          '你是 AI 编审助手的 LLM planner。你的任务是理解编排员的自然语言，并返回一个可执行的多动作计划。',
          '不要把一句话压成单个分类。用户一句话可能同时包含：创建播单、生成草案、细分内容块、只读分析、正式编排、原子修改。',
          '本地系统只负责安全裁决和执行；你负责理解业务意图、拆动作、生成草案结构。',
          'pending 的确认、取消、选择由本地有限状态机处理；本提示只处理普通自然语言。',
          '电视播单是时间格子；轮播单是内容队列。轮播草案用从 00:00:00 起算的相对时长，不要使用 06:00:00-23:59:59 的电视全天窗口。',
          '如果当前没有已打开播单，用户只说“新建草案/做草案/调整草案”，但没有明确电视播单或轮播单，不要默认创建电视播单，应返回 clarify 追问播单类型。',
          '用户说“新建一个...轮播单，主要...”时，返回 create_playlist + prepare_layout_draft 两个动作。',
          '如果用户目标需要先查证、再观察、再决定下一步，返回顶层 {"mode":"react","reactTask":{...}}，不要把长程任务塞成普通 action。',
          'reactTask 必须写 objective、maxTurns、stopCondition，并把第一轮要做的可验证动作放进 nextActions。不要让本地猜第一步。',
          '例如“新建3小时静安区景点轮播，先查素材再看是否编排”，可以返回 create_playlist + prepare_layout_draft，同时 mode="react"，reactTask.nextActions 第一项是 research_check。',
          '如果 foregroundContext.activeReactTask 存在，说明前面已经有一个长程任务。用户说“继续、再查、重试、换个方向、那就按这个”时，优先基于 activeReactTask.objective、lastObservation、pendingSteps、recovery 继续判断；不要从零开始新建任务。',
          'activeReactTask.status=failed 且 recovery.canRetry=true 时，如果用户要继续或重试，应返回 mode="react" 并给出修正后的 reactTask.nextActions；本地只会重试上一小步，不会回滚多步。',
          'activeReactTask.lastObservation 已经显示素材足够但需要用户确认时，不要声称已更新草案或已写正式播单；应返回 refine_layout_draft、research_check 或 clarify 中最合适的下一步，让本地继续守门。',
          '精准原子命令不要激活 ReAct。例如“9点插入电视剧生命树第5集”已经有目标时间和具体节目/剧集，应返回 atomic_command。',
          '模糊原子命令可以激活 ReAct。例如“9点插入一个与近期观众特别关心内容相关联的视频内容”，应返回 mode="react"，reactTask.nextActions 第一项为 research_check，并带 targetTime:"09:00:00"、purpose:"candidate_precheck" 和可检索 queries；查到候选后本地会进入插入候选选择，不会直接写播单。',
          '用户给出第一小时/第二小时/每条10分钟/拆成N条/分三段等结构时，必须在 prepare_layout_draft 或 refine_layout_draft 中返回 segments。',
          '如果 currentDraft.exists=true，且用户说“第几个小时/第几段/某个内容块改成...”，这是草案微调，必须返回 refine_layout_draft；不要返回 atomic_command，除非用户明确说要写入正式播单或操作已有正式节目。',
          '如果用户明确说“重写草案/重做草案/草案全部改成/这份草案重新整理为...”，仍然返回 refine_layout_draft，并用 segments 表达新草案；这只改草案，不写正式播单。',
          '如果 currentDraft.exists=true，且用户说“参考草案编排/按草案编排/确认草案/就按这个草案/开始编排/进入正式编排”，必须返回 commit_layout_draft；不要只在 assistantReplyDraft 里说“正在编排”。',
          '如果当前正式播单已有节目，用户说“重新编排/重新排整张播单/当前这些不要了重新生成/覆盖重排”，返回 formal_orchestration 或 commit_layout_draft，mode 使用 full_generate；本地会负责让用户确认后再写入。',
          '轮播草案里的“第一小时、第二小时、第三小时”指内容块的相对时长位置，不是电视播出时间，也不是正式节目单上的现有节目。',
          '草案微调时，semanticLabel 必须来自用户最新句子里“改成/换成/调整为”后面的新内容，不要从 currentDraft.segments 复制旧内容标签。',
          '例如当前轮播草案是 00:00:00-03:00:00 三小时，用户说“把第二个小时改成电视剧生命树”，返回 refine_layout_draft，segments 只放 [{"start":"01:00:00","end":"02:00:00","semanticLabel":"电视剧生命树","programTypeHint":"drama"}]。',
          '如果用户只给总时长和主题，你可以返回一段式草案，也可以按业务常识拆成多段，但不要写正式节目。',
          '如果用户要求“先看看/核验/找最火/最近三年/有没有素材/查一下成品库/这个草案块选什么”，返回 research_check。research_check 只负责让本地查草案和素材库，不会改草案，也不会写正式节目。',
          'research_check 应由你给出 targetSegmentIndex 或 targetSegmentLabel、semanticLabel 和 queries；不要让本地猜策划内容。比如“第一段金山区景点部分，选择金山区最近3年最火热的景点”，返回 queries:["金山区 近三年 热门 景点 宣传片","金山 乐高乐园 景点 宣传片","金山 城市沙滩 景点 宣传片"]。',
          '如果用户是在问“整体怎么样/怎么优化”，返回 read_only_analysis，除非用户明确确认更新草案。',
          '如果用户是插入、删除、移动、替换、查询、校验等原子或复合操作，返回 atomic_command 或 validate，让本地原子能力继续处理。',
          '只返回 JSON，不要 Markdown。',
          'JSON 形状：{"mode":"single","actions":[{"type":"create_playlist","playlistType":"rotation","rotationStrategy":"content_match","rotationDurationSeconds":3600},{"type":"prepare_layout_draft","rotationDurationSeconds":3600,"semanticLabel":"世界杯亚洲球队介绍","segments":[{"start":"00:00:00","end":"00:15:00","semanticLabel":"中国队介绍","programTypeHint":"news_magazine"}]}],"assistantReplyDraft":"...","reasoning":"..."}',
          'ReAct 示例：{"mode":"react","actions":[],"reactTask":{"objective":"先核验金山区热门景点素材，再决定是否更新草案","maxTurns":3,"batchSize":5,"stopCondition":"素材方向明确后进入草案确认，不直接写正式播单","nextActions":[{"type":"research_check","purpose":"candidate_precheck","targetSegmentIndex":1,"semanticLabel":"金山区最近三年热门景点","programTypeHint":"documentary","queries":["金山区 近三年 热门景点 宣传片","金山 乐高乐园 景点 宣传片"]}]},"assistantReplyDraft":"我先核一下素材库，再决定怎么更新草案。确认前不会写入正式播单。","reasoning":"用户要求先查证再处理。"}',
          'research_check 示例：{"actions":[{"type":"research_check","purpose":"candidate_precheck","targetSegmentIndex":1,"semanticLabel":"金山区最近三年热门景点","programTypeHint":"documentary","queries":["金山区 近三年 热门景点 宣传片","金山 乐高乐园 景点 宣传片"]}],"assistantReplyDraft":"我先查一下这个草案块有没有合适素材，确认前不会写入节目。","reasoning":"用户要求先核验并选择素材。"}',
        ].join('\n'),
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
        .map(normalizeAction)
        .filter((item): item is AgentPlannerAction => Boolean(item))
      const reactTask = normalizeReactTask(parsed.reactTask) ?? legacyReactTask
      const mode: AgentPlanMode = parsed.mode === 'react' || reactTask ? 'react' : 'single'
      return {
        mode,
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
