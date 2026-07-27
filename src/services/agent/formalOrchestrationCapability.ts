
import type {
  AgentCapability,
  AgentCapabilityRuntime,
  AgentPendingTask,
  AgentResult,
  AgentSubmitInput,
} from './types'
import type {
  RuntimeDecision,
  RuntimeFeedback,
  RuntimeOrchestrationLifecycle,
  RuntimeSubmitInput,
} from '@/services/runtime/demoRuntimeFacade'
import { getPendingAtomicContextService } from '@/services/runtime/pendingAtomicContextService'
import type { RuntimeFormalRebuildConfirmation } from '@/services/runtime/pendingAtomicContext'
import { getLLMClient } from '@/services/llm/llmClient'
import { LlmFormalOrchestrationDecider } from './formalOrchestrationDecider'
import { FormalOrchestrationActionAdapter } from '@/services/runtime/formalOrchestrationActionAdapter'
import { createFormalOrchestrationReadPorts } from '@/services/runtime/formalOrchestrationReadPorts'
import { createFormalOrchestrationAtomicPort } from '@/services/runtime/formalOrchestrationAtomicPort'
import {
  FormalOrchestrationRuntime,
  type FormalOrchestrationCheckpoint,
} from '@/services/runtime/formalOrchestrationRuntime'
import type { AgentPlannerAction } from '@/services/llm/agentPlanner'
import type { ReactTaskPlannerDraft } from '@/services/runtime/reactTaskTypes'
import type { AgentDeadline } from './agentDeadline'
import type { FormalOrchestrationGrantRequest } from '@/services/runtime/formalOrchestrationGrant'
import { buildRecoverableFailureEnvelope } from './recoverableFailureEnvelope'
import { resolveFormalOrchestrationSearchKeywords } from '@/services/retrievalConstraintCompiler'
import { evaluateLayoutDraftCompleteness, type LayoutDraftCompleteness } from '@/services/layoutDraftCompleteness'
import { parseAtomicTimeRange } from '@/services/atomicTimeParser'
import { parseSchedulingTimeRange } from '@/services/schedulingIntentHeuristics'
import type {
  GapInfo,
  PlanningSession,
  LayoutDraft,
  ScheduleState,
  TaskClassification,
  TaskMode,
} from '@/types/orchestration'

/**
 * Facade 提供的编排引导依赖适配器。
 *
 * 把 DemoRuntimeFacade 中无法直接迁移的版面解析、时间解析能力注入 capability，
 * 避免 capability 反向依赖 facade 的内部实现。
 */
export interface FormalOrchestrationAdapter {
  /**
   * 按当前播单状态解析已有版面草案（频道默认草案 / 上传版面）。
   */
  resolveExistingLayoutDraft: (
    input: RuntimeSubmitInput,
    userIntent: string,
    ignoreExistingLayout?: boolean,
  ) => { draft: LayoutDraft; label: string; sourceFileName?: string; sourceDate?: string } | null

  /**
   * 解析紧凑时段表达，如“9-12点”。
   */
  parseCompactHourRange: (userInput: string) => { start: string; end: string } | null
}

function resolveReactPendingTask(
  checkpoints: FormalOrchestrationCheckpoint<AgentPlannerAction>[],
): AgentPendingTask | undefined {
  for (let checkpointIndex = checkpoints.length - 1; checkpointIndex >= 0; checkpointIndex--) {
    const observations = checkpoints[checkpointIndex]?.observations ?? []
    for (let observationIndex = observations.length - 1; observationIndex >= 0; observationIndex--) {
      const pendingMutation = observations[observationIndex]?.data?.pendingMutation
      if (!pendingMutation || typeof pendingMutation !== 'object') continue
      const pendingTask = (pendingMutation as { pendingTask?: AgentPendingTask }).pendingTask
      if (pendingTask?.intent && pendingTask.phase) return pendingTask
    }
  }
  return undefined
}

export interface FormalOrchestrationPlannerSemantics {
  taskKind: RuntimeOrchestrationLifecycle['taskKind']
  useLayoutDraft: boolean
  targetTimeRange?: { start: string; end: string }
  searchKeywords?: string[]
}

export interface FormalOrchestrationDecisionOptions {
  skipFormalRebuildGate?: boolean
  plannerSemantics?: FormalOrchestrationPlannerSemantics
  reactTask?: ReactTaskPlannerDraft<AgentPlannerAction>
  authorizationRequest?: FormalOrchestrationGrantRequest
}

type RuntimeFormalOrchestrationBasis = {
  taskKind: RuntimeOrchestrationLifecycle['taskKind']
  playlistModel: RuntimeOrchestrationLifecycle['playlistModel']
  requiresLayoutDraft: boolean
  shouldUseLayoutDraft: boolean
  layoutDraft?: LayoutDraft
  completeness: LayoutDraftCompleteness
}

const toClockText = (value: string) =>
  value.includes('T') ? (value.split('T')[1]?.slice(0, 8) ?? value) : value.length === 5 ? `${value}:00` : value

const createFeedback = (
  content: string,
  processType: RuntimeFeedback['processType'],
  processTypeLabel: RuntimeFeedback['processTypeLabel'],
  extras?: Partial<Omit<RuntimeFeedback, 'content' | 'processType' | 'processTypeLabel'>>,
): RuntimeFeedback => ({ content, processType, processTypeLabel, ...extras })

/**
 * 正式长流程编排能力（D23/D10）。
 *
 * 承担两类职责：
 * 1. 编排引导（bootstrap）：把用户自然语言转换为正式编排请求（orchestrationRequest），
 *    包含草案缺失门控、已有节目重编确认等保护逻辑。
 * 2. 编排执行（execution）：只允许通过真 ReAct runtime 执行 full_generate /
 *    partial_generate 长流程。
 *
 * 编排引导逻辑原先散落在 DemoRuntimeFacade 中，现在统一收敛到本 capability，
 * facade 只保留提交循环与必要的 RuntimeDecision 转换。
 *
 */
export class FormalOrchestrationCapability implements AgentCapability {
  readonly id = 'orchestration'
  readonly metadata = {
    name: '正式长流程编排能力',
    intents: ['full_generate', 'partial_generate', 'formal_orchestration'],
    playlistTypes: ['all' as const],
    priority: 5,
  }

  private activeReactDeadline: AgentDeadline | null = null
  private readonly pendingAtomicContextService = getPendingAtomicContextService()

  /**
   * 判断是否为编排执行请求。
   *
   * @param input - Agent 提交输入
   * @returns true 当 input.orchestration 存在且模式为 full_generate / partial_generate
   */
  canHandle(input: AgentSubmitInput): boolean {
    return (
      input.orchestration?.mode === 'full_generate'
      || input.orchestration?.mode === 'partial_generate'
    )
  }

  /**
   * 执行编排请求。
   *
   * 内部统一使用 FormalOrchestrationRuntime + CapabilityRegistry 执行 ReAct；
   * 不回退到历史一次性 Orchestrator。
   *
   * @param input - 包含 orchestration 参数的提交输入
   * @param _runtime - Capability 运行时（编排能力暂不依赖外部 dataGateway）
   * @returns AgentResult
   */
  async handle(input: AgentSubmitInput, _runtime: AgentCapabilityRuntime): Promise<AgentResult> {
    const orchestration = input.orchestration
    if (!orchestration) {
      return this.buildFailureResult(input, '缺失编排参数')
    }

    // D23 deadline 传播：入口即检查是否已超时/取消，避免继续占用 LLM 资源。
    const deadlineSignal = _runtime.deadline?.signal()
    if (deadlineSignal?.aborted) {
      return this.buildFailureResult(input, '编排任务已超时或被取消')
    }

    if (!orchestration.reactTask) {
      return this.buildFailureResult(
        input,
        '正式长流程缺少 reactTask，已停止且不会回退旧编排器',
        this.buildMissingReactTaskEnvelope(input.userInput, orchestration.mode),
      )
    }
    return this.handleReactOrchestration(input, _runtime)
  }

  /**
   * 取消当前正在执行的编排任务。
   */
  cancel(): void {
    this.activeReactDeadline?.abort()
  }

  /**
   * 获取当前编排会话。
   *
   * @returns 当前 ReAct 编排会话，若无则返回 null
   */
  getSession(): PlanningSession | null {
    return null
  }

  /**
   * 获取当前编排进度。
   *
   * @returns 当前 ReAct 编排进度，若无则返回 null
   */
  getProgress() {
    return null
  }

  private async handleReactOrchestration(
    input: AgentSubmitInput,
    runtime: AgentCapabilityRuntime,
  ): Promise<AgentResult> {
    const reactTask = input.orchestration?.reactTask
    if (!reactTask) return this.buildFailureResult(input, '缺失 ReAct 编排计划')
    if (!reactTask.workspaceKey.trim()) return this.buildFailureResult(input, '缺失长流程 workspaceKey')
    if (!runtime.deadline) return this.buildFailureResult(input, 'ReAct 长流程必须显式提供统一 deadline')

    const llmClient = getLLMClient()
    const readPorts = createFormalOrchestrationReadPorts({
      workspaceKey: reactTask.workspaceKey,
      dataGateway: runtime.dataGateway,
      baseInput: input,
    })
    const atomicPorts = createFormalOrchestrationAtomicPort({
      workspaceKey: reactTask.workspaceKey,
      authorization: reactTask.authorization,
      dataGateway: runtime.dataGateway,
      baseInput: {
        ...input,
        pendingTask: reactTask.resumeFrom?.pendingTask,
      },
      candidateJudge: runtime.candidateJudge,
      deadline: runtime.deadline,
      capabilityRegistry: runtime.capabilityRegistry,
    })
    const actionAdapter = new FormalOrchestrationActionAdapter({
      workspaceKey: reactTask.workspaceKey,
      authorization: reactTask.authorization,
      ports: { ...readPorts, ...atomicPorts },
    })
    const decider = new LlmFormalOrchestrationDecider({
      llmClient,
      deadline: runtime.deadline,
      authorization: reactTask.authorization,
    })
    const reactRuntime = new FormalOrchestrationRuntime<AgentPlannerAction>({
      actor: (action, context) => actionAdapter.execute(action, context),
      decide: (decideInput) => decider.decide(decideInput),
    })

    this.activeReactDeadline = runtime.deadline
    runtime.trace.record('planning', '正式长流程进入 ReAct 执行内核。', {
      workspaceKey: reactTask.workspaceKey,
      maxTurns: reactTask.plannerTask.maxTurns,
      batchSize: reactTask.plannerTask.batchSize,
    })
    try {
      const result = await reactRuntime.run({
        workspaceKey: reactTask.workspaceKey,
        originalUserInput: input.userInput,
        plannerTask: reactTask.plannerTask,
        resumeFrom: reactTask.resumeFrom,
        deadline: runtime.deadline,
        onCheckpoint: (checkpoint) => {
          input.orchestration?.onCheckpoint?.(checkpoint)
          input.orchestration?.onEvent?.({
            type: 'log',
            payload: {
              entry: {
                id: checkpoint.id,
                timestamp: checkpoint.createdAt,
                level: checkpoint.failureReason ? 'error' : 'info',
                phase: 'react_checkpoint',
                message: `ReAct 第 ${checkpoint.turn} 轮已保存 checkpoint：${checkpoint.decision.kind}`,
                details: { checkpoint },
              },
            },
          })
        },
      })
      runtime.trace.record(
        result.status === 'completed' ? 'completed' : result.status === 'waiting_user' ? 'needs_confirmation' : 'failed',
        'ReAct 长流程执行结束。', {
        runId: result.run.id,
        status: result.status,
        completedActionCount: result.completedActionCount,
        checkpointCount: result.checkpoints.length,
        failure: result.failure,
      })
      if (result.status === 'waiting_user') {
        const pendingTask = resolveReactPendingTask(result.checkpoints)
        if (!pendingTask) {
          return this.buildFailureResult(input, 'ReAct 等待确认 checkpoint 缺少可续接 pendingTask。')
        }
        input.orchestration?.onEvent?.({
          type: 'status-change',
          payload: {
            runtime: 'react',
            runId: result.run.id,
            status: 'manual_review',
            previousStatus: 'filling',
            completedActionCount: result.completedActionCount,
            checkpoints: result.checkpoints,
          },
        })
        return {
          status: 'needs_confirmation',
          input,
          decision: { pendingTask },
          explanation: '当前动作已完成业务校验，正在等待你的明确确认；正式播单尚未写入。',
          trace: [],
        }
      }
      input.orchestration?.onEvent?.({
        type: result.status === 'completed' ? 'complete' : 'error',
        payload: {
          runtime: 'react',
          runId: result.run.id,
          status: result.status,
          completedActionCount: result.completedActionCount,
          checkpoints: result.checkpoints,
          failure: result.failure,
        },
      })
      if (result.status !== 'completed') {
        return this.buildFailureResult(
          input,
          result.failure?.message ?? (result.status === 'cancelled' ? '长流程已停止并保留最后 checkpoint' : 'ReAct 长流程失败'),
          result.failure?.envelope,
        )
      }
      return {
        status: 'executed',
        input,
        decision: {},
        explanation: `ReAct 长流程已完成，共执行 ${result.completedActionCount} 个动作并保存 ${result.checkpoints.length} 个 checkpoint。`,
        trace: [],
      }
    } finally {
      this.activeReactDeadline = null
    }
  }

  /**
   * 尝试从用户输入构建正式编排引导决策。
   *
   * 这是 D23 迁移的核心入口：DemoRuntimeFacade 把原先内联的编排识别与门控逻辑
   * 委托给本 capability，facade 本身只负责提交循环与结果透传。
   *
   * @param input - Runtime 提交输入
   * @param adapter - Facade 提供的解析能力适配器
   * @returns RuntimeDecision，可能为 orchestration / layout_commit / message / pending_atomic_context
   */
  buildFormalOrchestrationDecision(
    input: RuntimeSubmitInput,
    adapter: FormalOrchestrationAdapter,
  ): RuntimeDecision | null {
    // 开放自然语言意图必须由 planner 返回 formal_orchestration action；
    // 此入口保留为兼容边界，但不再根据用户文本猜测任务类型。
    return null
  }

  /**
   * 给定 mode 构建正式编排决策。
   *
   * 供 facade 在 agentPlanner 返回 formal_orchestration action 后直接调用，
   * 也供 commitLayoutDraft 等路径调用。
   *
   * @param input - Runtime 提交输入
   * @param adapter - Facade 提供的解析能力适配器
   * @param mode - 编排模式
   * @param reasoning - 决策理由
   * @param options - 可选配置，如跳过已有节目重编确认门控
   * @returns RuntimeDecision
   */
  buildFormalOrchestrationDecisionForMode(
    input: RuntimeSubmitInput,
    adapter: FormalOrchestrationAdapter,
    mode: Extract<TaskMode, 'full_generate' | 'partial_generate'>,
    reasoning: string,
    options?: FormalOrchestrationDecisionOptions,
  ): RuntimeDecision {
    const basis = this.resolveFormalOrchestrationBasis(input, mode, adapter, options?.plannerSemantics)
    const missingBasisBlock = this.buildMissingFormalOrchestrationBasisBlock(input, mode, reasoning, basis)
    if (missingBasisBlock) return missingBasisBlock

    const layoutDraft = basis.shouldUseLayoutDraft ? basis.layoutDraft : undefined
    const targetTimeRange = options?.plannerSemantics
      ? options.plannerSemantics.targetTimeRange
      : this.resolveFormalOrchestrationTargetTimeRange(input.userInput.replace(/\s+/g, ''), adapter)
    const searchKeywords = options?.plannerSemantics
      ? options.plannerSemantics.searchKeywords ?? []
      : resolveFormalOrchestrationSearchKeywords(input.userInput)
    const modeLabel = mode === 'partial_generate' ? '补齐当前空窗' : '全天编排'
    const lifecycle = this.buildFormalOrchestrationLifecycle(basis)

    if (!options?.skipFormalRebuildGate && this.shouldRequireFormalRebuildConfirmation(input, mode)) {
      return this.buildFormalRebuildConfirmationDecision(input, {
        actionKind: 'formal_orchestration',
        mode,
        useLayoutDraft: Boolean(layoutDraft),
        targetTimeRange,
        existingItemCount: this.resolveExistingFormalItemCount(input),
        playlistType: input.scheduleState.playlistType,
        userInput: input.userInput,
        reasoning,
        draftId: layoutDraft?.id,
        draftSource: layoutDraft?.source,
      })
    }

    return {
      kind: 'orchestration',
      feedback: createFeedback(
        layoutDraft
          ? `已按当前版面草案进入正式编排：${modeLabel}。`
          : `已进入正式编排：${modeLabel}。`,
        'planning',
        '正式编排',
        {
          explanation: reasoning,
          details: {
            mode,
            usesLayoutDraft: Boolean(layoutDraft),
            draftId: layoutDraft?.id,
            layoutSource: layoutDraft?.source,
            targetTimeRange,
            searchKeywords,
            lifecycle,
            draftCompleteness: basis.completeness,
          },
        },
      ),
      orchestrationRequest: {
        userInput: input.userInput,
        mode,
        reasoning,
        layoutDraft,
        targetTimeRange,
        searchKeywords: searchKeywords.length ? searchKeywords : undefined,
        lifecycle,
        reactTask: options?.reactTask,
        authorizationRequest: options?.authorizationRequest,
      },
    } as RuntimeDecision
  }

  /**
   * 从版面草案确认进入正式编排。
   *
   * 对应 commitLayoutDraft 的编排决策分支：强制使用当前草案，targetTimeRange 缺省时回退到
   * draft.coverage，并返回 kind: 'layout_commit'。
   *
   * @param input - Runtime 提交输入（应已携带 currentLayoutDraft）
   * @param adapter - Facade 提供的解析能力适配器
   * @param mode - 已解析的编排模式
   * @param classification - 任务分类（含 reasoning 与建议参数）
   * @param options - 可选配置，如跳过已有节目重编确认门控
   * @returns RuntimeDecision，固定为 layout_commit / pending_atomic_context / message
   */
  buildCommitLayoutDraftDecision(
    input: RuntimeSubmitInput,
    adapter: FormalOrchestrationAdapter,
    mode: Extract<TaskMode, 'full_generate' | 'partial_generate'>,
    classification: TaskClassification,
    options?: FormalOrchestrationDecisionOptions,
  ): RuntimeDecision {
    const draft = input.currentLayoutDraft
      ?? adapter.resolveExistingLayoutDraft(input, input.userInput, false)?.draft
    if (!draft) {
      return {
        kind: 'message',
        feedback: createFeedback(
          '当前还没有可确认的版面草案，请先生成或导入版面后再开始编排。',
          'planning',
          '版面草案',
          { explanation: classification.reasoning },
        ),
      }
    }

    const formalInput = { ...input, currentLayoutDraft: draft }
    const basis = this.resolveFormalOrchestrationBasis(formalInput, mode, adapter)
    const missingBasisBlock = this.buildMissingFormalOrchestrationBasisBlock(
      formalInput,
      mode,
      classification.reasoning,
      basis,
    )
    if (missingBasisBlock) return missingBasisBlock

    const lifecycle = this.buildFormalOrchestrationLifecycle(basis)
    const explicitTargetTimeRange = this.resolveFormalOrchestrationTargetTimeRange(
      input.userInput.replace(/\s+/g, ''),
      adapter,
    )
    const targetTimeRange = explicitTargetTimeRange ?? draft.coverage
    const searchKeywords = resolveFormalOrchestrationSearchKeywords(input.userInput)

    if (!options?.skipFormalRebuildGate && this.shouldRequireFormalRebuildConfirmation(formalInput, mode)) {
      return this.buildFormalRebuildConfirmationDecision(formalInput, {
        actionKind: 'commit_layout_draft',
        mode,
        useLayoutDraft: true,
        targetTimeRange,
        existingItemCount: this.resolveExistingFormalItemCount(formalInput),
        playlistType: formalInput.scheduleState.playlistType,
        userInput: formalInput.userInput,
        reasoning: classification.reasoning,
        draftId: draft.id,
        draftSource: draft.source,
      })
    }

    return {
      kind: 'layout_commit',
      feedback: createFeedback(
        '已确认当前版面草案，准备按该版面开始编排。',
        'planning',
        '版面草案确认',
        {
          explanation: classification.reasoning,
          details: {
            draftId: draft.id,
            layoutSource: draft.source,
            targetTimeRange,
            searchKeywords,
            lifecycle,
            draftCompleteness: basis.completeness,
          },
        },
      ),
      draft,
      orchestrationRequest: {
        userInput: input.userInput,
        mode,
        reasoning: classification.reasoning,
        layoutDraft: draft,
        targetTimeRange,
        searchKeywords: searchKeywords.length ? searchKeywords : undefined,
        lifecycle,
        reactTask: options?.reactTask,
        authorizationRequest: options?.authorizationRequest,
      },
    } as RuntimeDecision
  }

  private resolveFormalOrchestrationTargetTimeRange(normalized: string, adapter: FormalOrchestrationAdapter): { start: string; end: string } | undefined {
    if (/(全天|整天|全日)/.test(normalized)) return undefined
    return parseAtomicTimeRange(normalized)
      ?? adapter.parseCompactHourRange(normalized)
      ?? parseSchedulingTimeRange(normalized)
  }

  private shouldRequireFormalRebuildConfirmation(
    input: RuntimeSubmitInput,
    mode: Extract<TaskMode, 'full_generate' | 'partial_generate'>,
  ): boolean {
    return mode === 'full_generate' && this.resolveExistingFormalItemCount(input) > 0
  }

  private resolveExistingFormalItemCount(input: RuntimeSubmitInput): number {
    return Math.max(input.currentSchedule.length, input.scheduleState.itemCount ?? 0)
  }

  private buildFormalRebuildConfirmationDecision(
    input: RuntimeSubmitInput,
    confirmation: RuntimeFormalRebuildConfirmation,
  ): RuntimeDecision {
    const playlistLabel = confirmation.playlistType === 'rotation' ? '轮播单' : '电视播单'
    const basisLabel = confirmation.actionKind === 'commit_layout_draft' || confirmation.useLayoutDraft
      ? '当前草案'
      : '这次要求'
    const now = new Date().toISOString()
    const pendingContext = this.pendingAtomicContextService.initialize({
      action: null,
      phase: 'formal_rebuild_confirmation',
      summary: `待确认重新编排${playlistLabel}`,
      reasoning: `当前${playlistLabel}已经有 ${confirmation.existingItemCount} 条节目。确认后我会按${basisLabel}重新写入正式播单；取消则不改动。`,
      confirmationNote: `确认后会按${basisLabel}重新生成正式播单，已有节目可能被替换；取消则保留当前播单。`,
      originalUserInput: input.userInput,
      collectedUserInput: input.userInput,
      slots: {},
      missingFields: ['selection'],
      followUpQuestion: `请确认是否重新编排这张${playlistLabel}。`,
      formalRebuildConfirmation: confirmation,
      attemptCount: 0,
      createdAt: now,
      updatedAt: now,
    })

    return {
      kind: 'pending_atomic_context',
      feedback: createFeedback(
        `当前${playlistLabel}已经有 ${confirmation.existingItemCount} 条节目。我可以按${basisLabel}重新编排，但这会改动正式播单；请先确认。`,
        'selection',
        '重新编排确认',
        {
          explanation: confirmation.reasoning,
          details: {
            playlistType: confirmation.playlistType,
            mode: confirmation.mode,
            usesLayoutDraft: confirmation.useLayoutDraft,
            existingItemCount: confirmation.existingItemCount,
            draftId: confirmation.draftId,
            draftSource: confirmation.draftSource,
            noMutationBeforeConfirm: true,
          },
        },
      ),
      pendingAtomicContext: pendingContext,
    }
  }

  private resolveFormalOrchestrationBasis(
    input: RuntimeSubmitInput,
    mode: Extract<TaskMode, 'full_generate' | 'partial_generate'>,
    adapter: FormalOrchestrationAdapter,
    plannerSemantics?: FormalOrchestrationPlannerSemantics,
  ): RuntimeFormalOrchestrationBasis {
    const normalized = input.userInput.replace(/\s+/g, '')
    const playlistType = input.scheduleState.playlistType ?? 'tv'
    const playlistModel: RuntimeOrchestrationLifecycle['playlistModel'] = playlistType === 'rotation'
      ? 'content_queue'
      : 'time_grid'
    const taskKind = plannerSemantics?.taskKind
      ?? (mode === 'full_generate' ? 'full_day' : 'overall_refill')
    const explicitDraftReference = plannerSemantics?.useLayoutDraft === true
    const requiresLayoutDraft = playlistType === 'rotation'
      ? true
      : taskKind === 'full_day' || explicitDraftReference
    const layoutDraft = playlistType === 'rotation'
      ? input.currentLayoutDraft ?? undefined
      : requiresLayoutDraft || explicitDraftReference
        ? input.currentLayoutDraft ?? adapter.resolveExistingLayoutDraft(input, input.userInput, false)?.draft
        : undefined
    const completeness = evaluateLayoutDraftCompleteness(layoutDraft)

    return {
      taskKind,
      playlistModel,
      requiresLayoutDraft,
      shouldUseLayoutDraft: Boolean(layoutDraft && (requiresLayoutDraft || explicitDraftReference)),
      layoutDraft,
      completeness,
    }
  }

  private buildFormalOrchestrationLifecycle(basis: RuntimeFormalOrchestrationBasis): RuntimeOrchestrationLifecycle {
    return {
      taskKind: basis.taskKind,
      playlistModel: basis.playlistModel,
      requiresLayoutDraft: basis.requiresLayoutDraft,
      layoutDraftCompleteness: basis.completeness,
      canInterrupt: true,
      writesFormalPlaylist: true,
      mutatesLayoutDraft: false,
      suggestedBatchSize: basis.playlistModel === 'content_queue' ? 5 : 3,
    }
  }

  private buildMissingFormalOrchestrationBasisBlock(
    input: RuntimeSubmitInput,
    mode: Extract<TaskMode, 'full_generate' | 'partial_generate'>,
    reasoning: string,
    basis: RuntimeFormalOrchestrationBasis,
  ): RuntimeDecision | null {
    if (!basis.requiresLayoutDraft || input.scheduleState.playlistType === 'none') return null
    if (basis.completeness.status === 'complete') return null
    if (basis.taskKind === 'local_refill' && basis.completeness.status === 'partial') return null

    const playlistType = input.scheduleState.playlistType ?? 'tv'
    if (playlistType === 'rotation') {
      if (basis.completeness.status === 'partial') {
        return {
          kind: 'message',
          statusHint: 'needs_clarification',
          feedback: createFeedback(
            '这份轮播草案还只覆盖了一部分目标时长，不能直接整体编排。你可以继续补充内容块，或让我先按已有内容块给出补充建议。',
            'planning',
            '还要补草案',
            {
              explanation: reasoning,
              details: {
                playlistType: 'rotation',
                blockedMode: mode,
                draftId: basis.layoutDraft?.id,
                draftCompleteness: basis.completeness,
                lifecycle: this.buildFormalOrchestrationLifecycle(basis),
                suggestedActions: ['继续补充轮播草案', '说明缺少的内容方向', '允许加入垫片', '改为单条插入或调整'],
              },
            },
          ),
        }
      }
      return {
        kind: 'message',
        statusHint: 'needs_clarification',
        feedback: createFeedback(
          '这张轮播单还没有可用草案，不能直接整体编排。你可以先告诉我主题和总时长，我先整理草案；单条插入、删除、移动、替换可以直接说。',
          'planning',
          '先补草案',
          {
            explanation: reasoning,
            details: {
              playlistType: 'rotation',
              blockedMode: mode,
              draftCompleteness: basis.completeness,
              lifecycle: this.buildFormalOrchestrationLifecycle(basis),
              atomicCommandsAllowed: true,
              suggestedActions: ['说明主题和总时长', '上传轮播草案', '生成轮播草案', '改为单条插入或调整'],
            },
          },
        ),
      }
    }

    if (
      basis.completeness.status === 'partial'
      && mode === 'partial_generate'
      && basis.shouldUseLayoutDraft
    ) return null

    if (basis.completeness.status === 'partial') {
      return {
        kind: 'message',
        statusHint: 'needs_clarification',
        feedback: createFeedback(
          '这份草案只写了一部分，还不能直接排一整天。你可以继续告诉我缺的时段要排什么；也可以先按已有时段补排，或上传更完整的草案。',
          'planning',
          '还要补草案',
          {
            explanation: '这份草案还没把一天写全。我会先帮你把缺的时段补清楚，再继续正式编排。',
            details: {
              playlistType: 'tv',
              blockedMode: mode,
              draftId: basis.layoutDraft?.id,
              layoutSource: basis.layoutDraft?.source,
              draftCompleteness: basis.completeness,
              lifecycle: this.buildFormalOrchestrationLifecycle(basis),
              suggestedActions: ['继续补充草案', '按现有草案做局部补排', '上传完整草案', '切换频道默认草案'],
            },
          },
        ),
      }
    }

    return {
      kind: 'message',
      statusHint: 'needs_clarification',
      feedback: createFeedback(
        '这张电视播单还没有草案，不能直接排一整天。请先上传草案，或切换到这个频道已有的草案。',
        'planning',
        '先补草案',
        {
          explanation: '电视全天编排要先看当天大致排什么。现在没有草案，我不能替你凭空排满一整天。',
          details: {
            playlistType: 'tv',
            blockedMode: mode,
            draftCompleteness: basis.completeness,
            lifecycle: this.buildFormalOrchestrationLifecycle(basis),
            suggestedActions: ['加载当前频道默认草案', '上传版面文件', '切换到已有草案', '改为局部补排'],
          },
        },
      ),
    }
  }

  buildMissingReactTaskDecision(
    userInput: string,
    mode: Extract<TaskMode, 'full_generate' | 'partial_generate'>,
  ): RuntimeDecision {
    const content = '模型返回的正式编排计划不完整，缺少 ReAct 动作计划；我没有修改播单。请重试刚才的要求。'
    return {
      kind: 'message',
      statusHint: 'failed',
      feedback: createFeedback(content, 'error', '编排计划不完整', {
        explanation: '正式长流程必须包含可观察、可中断的 reactTask，不能回退旧编排器继续执行。',
        details: {
          noMutation: true,
          canRetry: true,
          recoverableUserInput: userInput,
          recoverableFailureEnvelope: this.buildMissingReactTaskEnvelope(userInput, mode),
        },
      }),
    }
  }

  private buildMissingReactTaskEnvelope(
    userInput: string,
    mode: Extract<TaskMode, 'full_generate' | 'partial_generate'>,
  ) {
    return buildRecoverableFailureEnvelope({
      kind: 'react_plan_invalid',
      recognizedSlots: [{
        name: 'intent',
        value: mode,
        confidence: 1,
        source: 'llm',
      }],
      retrySuggestions: [{
        label: '重试正式编排',
        instructionTemplate: userInput,
        strategy: 'resubmit',
      }],
      noMutation: true,
      humanSummary: '正式编排计划缺少 reactTask，未执行任何写入。',
      traceId: `formal-react-plan-invalid-${Date.now()}`,
    })
  }

  private buildFailureResult(input: AgentSubmitInput, message: string, envelope?: unknown): AgentResult {
    return {
      status: 'failed',
      input,
      decision: {
        constraintReport: {
          ok: false,
          issues: [
            {
              code: 'unsupported_intent',
              severity: 'critical',
              message,
              detail: envelope ? { recoverableFailure: envelope } : undefined,
            },
          ],
        },
      },
      explanation: `编排任务失败：${message}`,
      trace: [],
    }
  }
}

