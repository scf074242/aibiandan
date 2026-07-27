import {
  DemoRuntimeFacade,
  type RuntimeAnalysisContext,
  type RuntimeDecision,
  type RuntimeExecutePendingCommandInput,
  type RuntimeExecutedResult,
  type RuntimeExecutionPlan,
  type RuntimeFeedback,
  type RuntimeInsertRecommendationCandidate,
  type RuntimeOrchestrationRequest,
  type RuntimePendingAtomicClarification,
  type RuntimePendingCommand,
  type RuntimePendingInsertRecommendation,
  type RuntimePendingTargetSelection,
  type RuntimePlaylistFactPack,
  type RuntimeProgressEvent,
  type RuntimeResolveInsertRecommendationInput,
  type RuntimeResolveTargetSelectionInput,
  type RuntimeScheduleItem,
  type RuntimeSubmitInput,
  formatRuntimeOffset,
  requiresRuntimeCommandConfirmation,
  summarizeRuntimeCommand,
} from './demoRuntimeFacade'
import { SchedulingAgentRuntime } from '@/services/agent/schedulingAgentRuntime'
import { FormalOrchestrationCapability } from '@/services/agent/formalOrchestrationCapability'
import { AtomicCommandCapability } from '@/services/agent/atomicCommandCapability'
import { AgentDeadline, LONG_RUNNING_DEADLINE_BUDGET } from '@/services/agent/agentDeadline'
import type { AgentPendingTask, AgentResult, AgentSubmitInput, SchedulingDataGateway } from '@/services/agent/types'
import { buildScheduleWorkspaceSummary, resolveForegroundWorkspaceKey } from './foregroundWorkspaceState'
import type { FormalOrchestrationCheckpoint } from './formalOrchestrationRuntime'
import type { AgentPlannerAction } from '@/services/llm/agentPlanner'
import { getAtomicCapabilities } from '@/services/atomicCapabilities'
import type {
  GapInfo,
  OrchestrationProgress,
  PlanningLogEntry,
  PlanningSession,
  PlanningSessionStatus,
  ScheduleItemSnapshot,
} from '@/types/orchestration'

export {
  formatRuntimeOffset,
  requiresRuntimeCommandConfirmation,
  summarizeRuntimeCommand,
  type RuntimeAnalysisContext,
  type RuntimeDecision,
  type RuntimeExecutePendingCommandInput,
  type RuntimeExecutedResult,
  type RuntimeExecutionPlan,
  type RuntimeFeedback,
  type RuntimeInsertRecommendationCandidate,
  type RuntimeOrchestrationRequest,
  type RuntimePendingAtomicClarification,
  type RuntimePendingCommand,
  type RuntimePendingInsertRecommendation,
  type RuntimePendingTargetSelection,
  type RuntimePlaylistFactPack,
  type RuntimeProgressEvent,
  type RuntimeResolveInsertRecommendationInput,
  type RuntimeResolveTargetSelectionInput,
  type RuntimeScheduleItem,
  type RuntimeSubmitInput,
}

export interface RuntimeReactOrchestrationOutcome {
  status: 'completed' | 'waiting_user' | 'cancelled' | 'failed'
  checkpointCount?: number
  pendingTask?: AgentPendingTask
  scheduleItems?: RuntimeScheduleItem[]
  failure?: {
    message: string
    recoverableFailure?: unknown
    checkpointCount: number
  }
}

type OrchestrationEventMap = {
  'status-change': { status: PlanningSessionStatus; previousStatus: PlanningSessionStatus }
  'gap-start': { gap: GapInfo }
  'gap-complete': { gap: GapInfo; item: ScheduleItemSnapshot }
  'gap-failed': { gap: GapInfo; error: string }
  'log': { entry: PlanningLogEntry }
  'error': { error: Error }
  'complete': { session: PlanningSession }
}

/**
 * 简化的类型安全事件发射器。
 *
 * 仅支持 on / off / emit / removeAllListeners，用于向前台 composable 透编排事件。
 */
class SimpleEventEmitter<T extends Record<string, unknown>> {
  private listeners = new Map<keyof T, Array<(payload: T[keyof T]) => void>>()

  /**
   * 注册事件监听器。
   *
   * @param event - 事件名
   * @param listener - 监听器
   * @returns 取消注册的函数
   */
  on<K extends keyof T>(event: K, listener: (payload: T[K]) => void): () => void {
    const current = this.listeners.get(event) ?? []
    current.push(listener as (payload: T[keyof T]) => void)
    this.listeners.set(event, current)
    return () => this.off(event, listener)
  }

  /**
   * 移除事件监听器。
   *
   * @param event - 事件名
   * @param listener - 要移除的监听器
   */
  off<K extends keyof T>(event: K, listener: (payload: T[K]) => void): void {
    const current = this.listeners.get(event) ?? []
    this.listeners.set(
      event,
      current.filter((l) => l !== (listener as (payload: T[keyof T]) => void)),
    )
  }

  /**
   * 触发事件。
   *
   * @param event - 事件名
   * @param payload - 事件载荷
   */
  emit<K extends keyof T>(event: K, payload: T[K]): void {
    ;(this.listeners.get(event) ?? []).forEach((listener) => listener(payload))
  }

  /**
   * 移除所有监听器。
   */
  removeAllListeners(): void {
    this.listeners.clear()
  }
}

/**
 * SchedulingAgentRuntime 门面（D23 三路径收口）。
 *
 * 继承 DemoRuntimeFacade 的原子命令能力，同时提供 FormalOrchestrationRuntime
 * 的长流程 ReAct 入口。新代码应通过此门面发起全天编排 / 局部补排。
 */
export class SchedulingAgentRuntimeFacade extends DemoRuntimeFacade {
  /** 编排事件发射器，用于向 useOrchestrator 等前台 composable 透传进度。 */
  readonly orchestrationEventEmitter = new SimpleEventEmitter<OrchestrationEventMap>()

  private activeOrchestrationCapability: FormalOrchestrationCapability | null = null
  private activeReactCheckpoints: FormalOrchestrationCheckpoint<AgentPlannerAction>[] = []

  async startReactOrchestration(
    request: RuntimeOrchestrationRequest,
    runtimeInput: RuntimeSubmitInput,
    deadline = new AgentDeadline({ overallDeadlineMs: LONG_RUNNING_DEADLINE_BUDGET.overallDeadlineMs }),
    onCheckpoint?: (checkpoint: FormalOrchestrationCheckpoint<AgentPlannerAction>) => void,
  ): Promise<RuntimeReactOrchestrationOutcome> {
    if (!request.reactTask) {
      throw new Error('正式 ReAct 编排缺少 planner reactTask，已停止且不会回退旧编排器。')
    }
    const workspaceKey = resolveForegroundWorkspaceKey(buildScheduleWorkspaceSummary(runtimeInput.scheduleState))
    if (workspaceKey === 'none') {
      throw new Error('当前没有可执行正式编排的播单工作区。')
    }
    this.activeReactCheckpoints = []
    const result = await this.submitOrchestration({
      mode: request.mode,
      channelId: runtimeInput.scheduleState.channelId,
      date: runtimeInput.scheduleState.date,
      dayStartTime: request.targetTimeRange?.start,
      dayEndTime: request.targetTimeRange?.end,
      target: request.mode === 'partial_generate'
        ? {
            targetTimeRange: request.targetTimeRange,
            searchKeywords: request.searchKeywords,
          }
        : undefined,
      reactTask: {
        workspaceKey,
        plannerTask: request.reactTask,
        resumeFrom: request.reactRecovery,
        authorization: request.resolvedAuthorization,
      },
      onCheckpoint: (checkpoint) => {
        if (this.activeReactCheckpoints.some((current) => current.id === checkpoint.id)) return
        this.activeReactCheckpoints.push(checkpoint)
        onCheckpoint?.(checkpoint)
      },
    }, deadline, this.buildAgentCoreDataGateway({ ...runtimeInput, deadline }), { exposeFailureResult: true })
    if (result.status === 'needs_confirmation') {
      return {
        status: 'waiting_user',
        checkpointCount: this.activeReactCheckpoints.length,
        pendingTask: result.decision.pendingTask,
        scheduleItems: getAtomicCapabilities().getAllItems().map((item) => ({ ...item })),
      }
    }
    if (result.status !== 'failed') {
      return {
        status: 'completed',
        scheduleItems: getAtomicCapabilities().getAllItems().map((item) => ({ ...item })),
      }
    }
    if (deadline.isAborted()) return { status: 'cancelled' }
    const issue = result.decision.constraintReport?.issues[0]
    const detail = issue?.detail && typeof issue.detail === 'object'
      ? issue.detail as Record<string, unknown>
      : undefined
    return {
      status: 'failed',
      failure: {
        message: issue?.message ?? result.explanation ?? 'ReAct 长流程失败',
        recoverableFailure: detail?.recoverableFailure,
        checkpointCount: this.activeReactCheckpoints.length,
      },
    }
  }

  getReactCheckpoints(): FormalOrchestrationCheckpoint<AgentPlannerAction>[] {
    return [...this.activeReactCheckpoints]
  }

  /**
   * 取消当前正在执行的编排任务。
   */
  cancelOrchestration(): void {
    this.activeOrchestrationCapability?.cancel()
  }

  /**
   * 获取当前编排会话。
   *
   * @returns 当前 ReAct 编排会话，若无则返回 null
   */
  getOrchestrationSession(): PlanningSession | null {
    return this.activeOrchestrationCapability?.getSession() ?? null
  }

  /**
   * 获取当前编排进度。
   *
   * @returns 当前 ReAct 编排进度，若无则返回 null
   */
  getOrchestrationProgress(): OrchestrationProgress | null {
    return this.activeOrchestrationCapability?.getProgress() ?? null
  }

  private async submitOrchestration(
    params: NonNullable<AgentSubmitInput['orchestration']>,
    deadline?: AgentDeadline,
    dataGateway?: SchedulingDataGateway,
    options?: { exposeFailureResult?: boolean },
  ): Promise<AgentResult> {
    const orchestrationCapability = new FormalOrchestrationCapability()
    this.activeOrchestrationCapability = orchestrationCapability

    const runtime = new SchedulingAgentRuntime({
      dataGateway: dataGateway ?? this.buildMinimalDataGateway(),
      capabilities: [new AtomicCommandCapability(), orchestrationCapability],
    })

    const onEvent = (event: { type: keyof OrchestrationEventMap; payload: Record<string, unknown> }) => {
      if (event.payload.runtime === 'react' && event.type === 'complete') {
        this.orchestrationEventEmitter.emit('status-change', { status: 'completed', previousStatus: 'filling' })
        return
      }
      if (event.payload.runtime === 'react' && event.type === 'error') {
        const failure = event.payload.failure as { message?: string } | undefined
        const cancelled = event.payload.status === 'cancelled'
        this.orchestrationEventEmitter.emit('status-change', {
          status: cancelled ? 'cancelled' : 'failed',
          previousStatus: 'filling',
        })
        if (cancelled) return
        this.orchestrationEventEmitter.emit('error', {
          error: new Error(failure?.message ?? 'ReAct 长流程执行失败。'),
        })
        return
      }
      this.orchestrationEventEmitter.emit(
        event.type,
        event.payload as OrchestrationEventMap[keyof OrchestrationEventMap],
      )
    }

    const result = await runtime.submit(
      {
        userInput: `orchestration:${params.mode}`,
        channelId: params.channelId,
        date: params.date,
        orchestration: { ...params, onEvent },
      },
      deadline,
    )

    if (result.status === 'failed') {
      if (deadline?.isAborted()) return result
      if (options?.exposeFailureResult) return result
      throw new Error(result.explanation || '编排任务失败')
    }
    return result
  }

  private buildMinimalDataGateway(): SchedulingDataGateway {
    return {
      loadContext: async () =>
        ({} as Awaited<ReturnType<SchedulingDataGateway['loadContext']>>),
      commitScheduleItems: async () => ({
        committed: false,
        operationId: '',
        affectedItemIds: [],
        scheduleItems: [],
      }),
    }
  }
}

let globalSchedulingAgentRuntimeFacade: SchedulingAgentRuntimeFacade | null = null

export function getSchedulingAgentRuntimeFacade(): SchedulingAgentRuntimeFacade {
  if (!globalSchedulingAgentRuntimeFacade) {
    globalSchedulingAgentRuntimeFacade = new SchedulingAgentRuntimeFacade()
  }
  return globalSchedulingAgentRuntimeFacade
}
