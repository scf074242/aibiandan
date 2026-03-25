/**
 * 编排组合式函数（重构版）
 * 适配新技术方案：空窗驱动、系统控制、LLM局部决策
 */
import { ref, computed, shallowRef } from 'vue'
import type {
  OrchestrationProgress,
  PlanningSession,
  PlanningSessionStatus,
  GapInfo,
  ScheduleItemSnapshot,
  PlanningLogEntry,
  TaskClassification,
} from '@/types/orchestration'
import { Orchestrator, getOrchestrator } from '@/services/orchestrator'
import { getLLMClient } from '@/services/llm/llmClient'
import { getTaskClassifier } from '@/services/llm/taskClassifier'

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
  // 状态
  const isRunning = ref(false)
  const session = shallowRef<PlanningSession | null>(null)
  const currentGap = shallowRef<GapInfo | null>(null)
  const logs = ref<PlanningLogEntry[]>([])
  const recentLogs = computed(() => logs.value.slice(-20))

  // 编排器实例
  let orchestrator: Orchestrator | null = null

  // 计算属性
  const progress = computed<OrchestrationProgress | null>(() => {
    return orchestrator?.getProgress() || null
  })

  const progressPercentage = computed(() => {
    const p = progress.value
    if (!p || p.gapProgress.total === 0) return 0
    return Math.round((p.gapProgress.completed / p.gapProgress.total) * 100)
  })

  const status = computed<PlanningSessionStatus>(() => {
    return session.value?.status || 'initializing'
  })

  const isCompleted = computed(() => status.value === 'completed')
  const isFailed = computed(() => status.value === 'failed')
  const isCancelled = computed(() => status.value === 'cancelled')
  const canStart = computed(() => !isRunning.value)
  const canCancel = computed(() => 
    isRunning.value && ['initializing', 'planning', 'filling', 'repairing'].includes(status.value)
  )

  const gapStats = computed(() => {
    const p = progress.value
    return p?.gapProgress || { total: 0, pending: 0, processing: 0, completed: 0, failed: 0 }
  })

  // ==================== 初始化 ====================

  /**
   * 初始化编排器
   */
  const initialize = (): void => {
    if (orchestrator) {
      // 清理旧的事件监听
      orchestrator.removeAllListeners()
    }

    const llmClient = getLLMClient()
    const taskClassifier = getTaskClassifier(llmClient)
    orchestrator = getOrchestrator(llmClient, taskClassifier)

    // 绑定事件
    bindEvents()
  }

  /**
   * 绑定编排器事件
   */
  const bindEvents = (): void => {
    if (!orchestrator) return

    orchestrator.on('status-change', ({ status, previousStatus }) => {
      options.onStatusChange?.(status, previousStatus)
    })

    orchestrator.on('gap-start', ({ gap }) => {
      currentGap.value = gap
      options.onGapStart?.(gap)
    })

    orchestrator.on('gap-complete', ({ gap, item }) => {
      options.onGapComplete?.(gap, item)
    })

    orchestrator.on('gap-failed', ({ gap, error }) => {
      options.onGapFailed?.(gap, error)
    })

    orchestrator.on('log', ({ entry }) => {
      logs.value.push(entry)
      options.onLog?.(entry)
    })

    orchestrator.on('complete', ({ session: s }) => {
      session.value = s
      isRunning.value = false
      options.onComplete?.(s)
    })

    orchestrator.on('error', ({ error }) => {
      isRunning.value = false
      options.onError?.(error)
    })
  }

  // ==================== 核心方法 ====================

  /**
   * 任务判别
   * 在开始编排前，先判别用户意图
   */
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
    if (!orchestrator) {
      initialize()
    }

    const taskClassifier = getTaskClassifier()
    return taskClassifier.classify({
      scheduleState,
      userInput,
    })
  }

  /**
   * 开始完整生成
   */
  const startFullGeneration = async (
    channelId: string,
    date: string,
    dayStartTime: string,
    dayEndTime: string,
    strategy?: { target?: string; allowFiller?: boolean; riskPreference?: 'conservative' | 'balanced' | 'aggressive' },
  ): Promise<void> => {
    if (isRunning.value) return

    if (!orchestrator) {
      initialize()
    }

    isRunning.value = true
    logs.value = []

    try {
      await orchestrator!.startFullGeneration(
        channelId,
        date,
        dayStartTime,
        dayEndTime,
        strategy,
      )
    } catch (error) {
      isRunning.value = false
      throw error
    }
  }

  /**
   * 开始局部补排
   */
  const startPartialGeneration = async (
    channelId: string,
    date: string,
    targetGapIds?: string[],
  ): Promise<void> => {
    if (isRunning.value) return

    if (!orchestrator) {
      initialize()
    }

    isRunning.value = true
    logs.value = []

    try {
      await orchestrator!.startPartialGeneration(channelId, date, targetGapIds)
    } catch (error) {
      isRunning.value = false
      throw error
    }
  }

  /**
   * 取消编排
   */
  const cancel = (): void => {
    if (orchestrator && isRunning.value) {
      orchestrator.cancel()
    }
  }

  /**
   * 重置状态
   */
  const reset = (): void => {
    if (orchestrator) {
      orchestrator.cancel()
      orchestrator.removeAllListeners()
    }
    orchestrator = null
    isRunning.value = false
    session.value = null
    currentGap.value = null
    logs.value = []
  }

  // ==================== 查询方法 ====================

  /**
   * 获取当前会话
   */
  const getSession = (): PlanningSession | null => {
    return orchestrator?.getSession() || null
  }

  /**
   * 获取当前进度
   */
  const getProgress = (): OrchestrationProgress | null => {
    return orchestrator?.getProgress() || null
  }

  /**
   * 获取是否运行中
   */
  const getIsRunning = (): boolean => {
    return orchestrator?.getIsRunning() || false
  }

  return {
    // 状态
    isRunning,
    session,
    currentGap,
    logs,
    recentLogs,
    progress,

    // 计算属性
    progressPercentage,
    status,
    isCompleted,
    isFailed,
    isCancelled,
    canStart,
    canCancel,
    gapStats,

    // 方法
    initialize,
    classifyTask,
    startFullGeneration,
    startPartialGeneration,
    cancel,
    reset,
    getSession,
    getProgress,
    getIsRunning,
  }
}
