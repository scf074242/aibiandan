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
import { getLLMClient } from '@/services/llm/llmClient'
import { getTaskClassifier } from '@/services/llm/taskClassifier'
import { getOrchestrator, Orchestrator } from '@/services/orchestrator'

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

  let orchestrator: Orchestrator | null = null

  const initialize = () => {
    if (orchestrator) {
      orchestrator.removeAllListeners()
    }
    const llmClient = getLLMClient()
    const taskClassifier = getTaskClassifier(llmClient)
    orchestrator = getOrchestrator(llmClient, taskClassifier)

    orchestrator.on('status-change', ({ status, previousStatus }) => {
      session.value = orchestrator!.getSession()
      if (['completed', 'failed', 'cancelled'].includes(status)) {
        isRunning.value = false
        currentGap.value = null
      }
      options.onStatusChange?.(status, previousStatus)
      options.onProgress?.(orchestrator!.getProgress()!)
    })

    orchestrator.on('gap-start', ({ gap }) => {
      currentGap.value = gap
      options.onGapStart?.(gap)
      if (orchestrator?.getProgress()) options.onProgress?.(orchestrator.getProgress()!)
    })

    orchestrator.on('gap-complete', ({ gap, item }) => {
      currentGap.value = null
      options.onGapComplete?.(gap, item)
      if (orchestrator?.getProgress()) options.onProgress?.(orchestrator.getProgress()!)
    })

    orchestrator.on('gap-failed', ({ gap, error }) => {
      currentGap.value = null
      options.onGapFailed?.(gap, error)
      if (orchestrator?.getProgress()) options.onProgress?.(orchestrator.getProgress()!)
    })

    orchestrator.on('log', ({ entry }) => {
      logs.value.push(entry)
      if (logs.value.length > MAX_LOG_ENTRIES) {
        logs.value.splice(0, logs.value.length - MAX_LOG_ENTRIES)
      }
      options.onLog?.(entry)
    })

    orchestrator.on('complete', ({ session: value }) => {
      session.value = value
      isRunning.value = false
      options.onComplete?.(value)
    })

    orchestrator.on('error', ({ error }) => {
      isRunning.value = false
      options.onError?.(error)
    })
  }

  const progress = computed<OrchestrationProgress | null>(() => orchestrator?.getProgress() ?? null)
  const status = computed<PlanningSessionStatus>(() => session.value?.status ?? 'initializing')
  const canCancel = computed(() => isRunning.value)
  const recentLogs = computed(() => logs.value.slice(-20))
  const progressPercentage = computed(() => {
    const value = progress.value
    if (!value || value.gapProgress.total === 0) return 0
    return Math.round((value.gapProgress.completed / value.gapProgress.total) * 100)
  })
  const isCompleted = computed(() => status.value === 'completed')
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
    if (!orchestrator) initialize()
    return getTaskClassifier().classify({ scheduleState, userInput })
  }

  const startFullGeneration = async (
    channelId: string,
    date: string,
    dayStartTime: string,
    dayEndTime: string,
  ) => {
    if (!orchestrator) initialize()
    isRunning.value = true
    currentGap.value = null
    logs.value = []
    await orchestrator!.startFullGeneration(channelId, date, dayStartTime, dayEndTime)
    session.value = orchestrator!.getSession()
  }

  const startPartialGeneration = async (channelId: string, date: string, targetGapIds?: string[]) => {
    if (!orchestrator) initialize()
    isRunning.value = true
    currentGap.value = null
    logs.value = []
    await orchestrator!.startPartialGeneration(channelId, date, targetGapIds)
    session.value = orchestrator!.getSession()
  }

  const cancel = () => orchestrator?.cancel()

  const reset = () => {
    orchestrator?.removeAllListeners()
    orchestrator = null
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
    startFullGeneration,
    startPartialGeneration,
    cancel,
    reset,
  }
}
