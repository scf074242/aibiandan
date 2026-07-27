import { computed, ref, shallowRef } from 'vue'
import type {
  GapInfo,
  OrchestrationProgress,
  PlanningLogEntry,
  PlanningSession,
  PlanningSessionStatus,
  ScheduleItemSnapshot,
  TaskClassification,
} from '@/types/orchestration'
import { getTaskClassifier } from '@/services/llm/taskClassifier'
import {
  getSchedulingAgentRuntimeFacade,
  SchedulingAgentRuntimeFacade,
} from '@/services/runtime/schedulingAgentRuntimeFacade'
import type { RuntimeOrchestrationRequest, RuntimeReactOrchestrationOutcome, RuntimeSubmitInput } from '@/services/runtime/schedulingAgentRuntimeFacade'
import { getAgentRuntimeClient } from '@/services/runtime/agentRuntimeClient'
import type { AgentServerReactRecoveryInput, AgentServerReactRecoveryResult } from '@/services/runtime/agentServerRuntime'
import { buildScheduleWorkspaceSummary, resolveForegroundWorkspaceKey } from '@/services/runtime/foregroundWorkspaceState'

export interface UseOrchestratorOptions {
  onProgress?: (progress: OrchestrationProgress) => void
  onLog?: (log: PlanningLogEntry) => void
  onGapStart?: (gap: GapInfo) => void
  onGapComplete?: (gap: GapInfo, item: ScheduleItemSnapshot) => void
  onGapFailed?: (gap: GapInfo, error: string) => void
  onComplete?: (session: PlanningSession) => void
  onError?: (error: Error) => void
  onStatusChange?: (status: PlanningSessionStatus, previousStatus: PlanningSessionStatus) => void
}

export function useOrchestrator(options: UseOrchestratorOptions = {}) {
  const isRunning = ref(false)
  const session = shallowRef<PlanningSession | null>(null)
  const currentGap = shallowRef<GapInfo | null>(null)
  const logs = ref<PlanningLogEntry[]>([])
  const MAX_LOG_ENTRIES = 200

  let facade: SchedulingAgentRuntimeFacade | null = null
  let activeReactWorkspaceKey: string | null = null

  const initialize = () => {
    if (facade) {
      facade.orchestrationEventEmitter.removeAllListeners()
    }
    facade = getSchedulingAgentRuntimeFacade()

    facade.orchestrationEventEmitter.on('status-change', ({ status, previousStatus }) => {
      session.value = facade?.getOrchestrationSession() ?? null
      if (['completed', 'manual_review', 'failed', 'cancelled'].includes(status)) {
        isRunning.value = false
        currentGap.value = null
      }
      options.onStatusChange?.(status, previousStatus)
      const progress = facade?.getOrchestrationProgress()
      if (progress) options.onProgress?.(progress)
    })

    facade.orchestrationEventEmitter.on('gap-start', ({ gap }) => {
      currentGap.value = gap
      options.onGapStart?.(gap)
      const progress = facade?.getOrchestrationProgress()
      if (progress) options.onProgress?.(progress)
    })

    facade.orchestrationEventEmitter.on('gap-complete', ({ gap, item }) => {
      currentGap.value = null
      options.onGapComplete?.(gap, item)
      const progress = facade?.getOrchestrationProgress()
      if (progress) options.onProgress?.(progress)
    })

    facade.orchestrationEventEmitter.on('gap-failed', ({ gap, error }) => {
      currentGap.value = null
      options.onGapFailed?.(gap, error)
      const progress = facade?.getOrchestrationProgress()
      if (progress) options.onProgress?.(progress)
    })

    facade.orchestrationEventEmitter.on('log', ({ entry }) => {
      session.value = facade?.getOrchestrationSession() ?? null
      logs.value.push(entry)
      if (logs.value.length > MAX_LOG_ENTRIES) {
        logs.value.splice(0, logs.value.length - MAX_LOG_ENTRIES)
      }
      options.onLog?.(entry)
      const progress = facade?.getOrchestrationProgress()
      if (progress) options.onProgress?.(progress)
    })

    facade.orchestrationEventEmitter.on('complete', ({ session: value }) => {
      session.value = value
      isRunning.value = false
      options.onComplete?.(value)
    })

    facade.orchestrationEventEmitter.on('error', ({ error }) => {
      isRunning.value = false
      options.onError?.(error)
    })
  }

  const progress = computed<OrchestrationProgress | null>(() => facade?.getOrchestrationProgress() ?? null)
  const status = computed<PlanningSessionStatus>(() => session.value?.status ?? 'initializing')
  const canCancel = computed(() => isRunning.value)
  const recentLogs = computed(() => logs.value.slice(-20))
  const progressPercentage = computed(() => {
    const value = progress.value
    if (!value || value.gapProgress.total === 0) return 0
    return Math.round((value.gapProgress.completed / value.gapProgress.total) * 100)
  })
  const isCompleted = computed(() => ['completed', 'manual_review'].includes(status.value))
  const isFailed = computed(() => status.value === 'failed')
  const isCancelled = computed(() => status.value === 'cancelled')
  const canStart = computed(() => !isRunning.value)
  const gapStats = computed(() => progress.value?.gapProgress ?? { total: 0, pending: 0, processing: 0, completed: 0, failed: 0 })

  const classifyTask = async (
    scheduleState: {
      channelId: string
      channelName: string
      date: string
      isEmpty: boolean
      itemCount: number
      gapCount: number
      hasSelectedTimeRange: boolean
    },
    userInput: string,
  ): Promise<TaskClassification> => {
    if (!facade) initialize()
    return getTaskClassifier().classify({ scheduleState, userInput })
  }

  const startReactOrchestration = async (
    request: RuntimeOrchestrationRequest,
    runtimeInput: RuntimeSubmitInput,
  ): Promise<RuntimeReactOrchestrationOutcome> => {
    if (!facade) initialize()
    isRunning.value = true
    currentGap.value = null
    logs.value = []
    activeReactWorkspaceKey = resolveForegroundWorkspaceKey(buildScheduleWorkspaceSummary(runtimeInput.scheduleState))
    try {
      const outcome = await getAgentRuntimeClient().startReactOrchestration(request, runtimeInput)
      isRunning.value = false
      return outcome
    } catch (error) {
      isRunning.value = false
      throw error
    } finally {
      activeReactWorkspaceKey = null
    }
  }

  const recoverReactOrchestration = async (
    input: AgentServerReactRecoveryInput,
  ): Promise<AgentServerReactRecoveryResult> => {
    const client = getAgentRuntimeClient()
    if (!client.recoverReactOrchestration) {
      throw new Error('当前 Agent runtime 不支持 ReAct checkpoint 恢复。')
    }
    isRunning.value = input.action === 'confirm_pending'
    activeReactWorkspaceKey = input.workspaceKey
    try {
      return await client.recoverReactOrchestration(input)
    } finally {
      isRunning.value = false
      activeReactWorkspaceKey = null
    }
  }

  const cancel = () => {
    if (activeReactWorkspaceKey) {
      void getAgentRuntimeClient().cancelActiveInstruction?.(activeReactWorkspaceKey)
      return
    }
    facade?.cancelOrchestration()
  }

  const reset = () => {
    facade?.orchestrationEventEmitter.removeAllListeners()
    facade?.cancelOrchestration()
    facade = null
    isRunning.value = false
    session.value = null
    currentGap.value = null
    logs.value = []
  }

  return {
    isRunning,
    session,
    currentGap,
    logs,
    recentLogs,
    progress,
    progressPercentage,
    status,
    isCompleted,
    isFailed,
    isCancelled,
    canStart,
    canCancel,
    gapStats,
    initialize,
    classifyTask,
    startReactOrchestration,
    recoverReactOrchestration,
    cancel,
    reset,
  }
}
