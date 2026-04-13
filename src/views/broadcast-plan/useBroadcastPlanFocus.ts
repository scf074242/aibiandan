import { computed, ref } from 'vue'

import type { GapInfo, ProgressGapInfo, ScheduleItemSnapshot } from '@/types/orchestration'

export type FocusAnchor =
  | { type: 'item'; itemId: string; startTime: string; endTime: string }
  | { type: 'gap'; gapId: string; startTime: string; endTime: string }
  | { type: 'range'; startTime: string; endTime: string }

export type FocusStatus = 'active' | 'success' | 'error'
export type FocusLayer = 'intent' | 'process' | 'issue' | 'result'

type FocusRecord = {
  layer: FocusLayer
  anchor: FocusAnchor
  status: FocusStatus
  error?: string | null
}

const RECENT_ITEM_DURATION = 2200
const RESULT_FOCUS_DURATION = 1600
const DELETED_ECHO_DURATION = 2800

export interface DeletedEcho {
  itemId: string
  programName: string
  startTime: string
  endTime: string
}

export const useBroadcastPlanFocus = () => {
  const enabled = ref(false)
  const autoFollow = ref(true)
  const pausedByUser = ref(false)
  const recentItemIds = ref<string[]>([])
  const deletedEcho = ref<DeletedEcho | null>(null)
  const locateVersion = ref(0)

  const intentRecord = ref<FocusRecord | null>(null)
  const processRecord = ref<FocusRecord | null>(null)
  const issueRecord = ref<FocusRecord | null>(null)
  const resultRecord = ref<FocusRecord | null>(null)

  const recentItemTimers = new Map<string, ReturnType<typeof setTimeout>>()
  let deletedEchoTimer: ReturnType<typeof setTimeout> | null = null
  let resultFocusTimer: ReturnType<typeof setTimeout> | null = null

  const bumpLocateVersion = () => {
    locateVersion.value += 1
  }

  const clearRecentItem = (itemId: string) => {
    const timer = recentItemTimers.get(itemId)
    if (timer) {
      clearTimeout(timer)
      recentItemTimers.delete(itemId)
    }
    recentItemIds.value = recentItemIds.value.filter((id) => id !== itemId)
  }

  const trackRecentItem = (itemId: string) => {
    clearRecentItem(itemId)
    recentItemIds.value = Array.from(new Set([...recentItemIds.value, itemId]))
    recentItemTimers.set(
      itemId,
      setTimeout(() => {
        clearRecentItem(itemId)
      }, RECENT_ITEM_DURATION),
    )
  }

  const clearResultRecord = () => {
    if (resultFocusTimer) {
      clearTimeout(resultFocusTimer)
      resultFocusTimer = null
    }
    resultRecord.value = null
  }

  const clearDeletedEcho = () => {
    if (deletedEchoTimer) {
      clearTimeout(deletedEchoTimer)
      deletedEchoTimer = null
    }
    deletedEcho.value = null
  }

  const clearActive = () => {
    intentRecord.value = null
    processRecord.value = null
    issueRecord.value = null
    clearResultRecord()
  }

  const currentRecord = computed<FocusRecord | null>(() =>
    issueRecord.value
    || processRecord.value
    || resultRecord.value
    || intentRecord.value,
  )

  const active = computed<FocusAnchor | null>(() => currentRecord.value?.anchor ?? null)
  const status = computed<FocusStatus | null>(() => currentRecord.value?.status ?? null)
  const currentLayer = computed<FocusLayer | null>(() => currentRecord.value?.layer ?? null)
  const lastError = computed<string | null>(() => {
    if (currentRecord.value?.status === 'error') {
      return currentRecord.value.error ?? null
    }
    return issueRecord.value?.error ?? null
  })

  const isPointAnchor = computed(() => {
    const target = active.value
    return Boolean(target && target.startTime === target.endTime)
  })

  const showSummary = computed(() =>
    currentLayer.value === 'process' || currentLayer.value === 'issue',
  )

  const focusIntent = (anchor: FocusAnchor) => {
    enabled.value = true
    intentRecord.value = {
      layer: 'intent',
      anchor,
      status: 'active',
      error: null,
    }
    clearResultRecord()
    bumpLocateVersion()
  }

  const focusProcess = (
    anchor: FocusAnchor,
    nextStatus: Exclude<FocusStatus, 'error'> = 'active',
  ) => {
    enabled.value = true
    processRecord.value = {
      layer: 'process',
      anchor,
      status: nextStatus,
      error: null,
    }
    issueRecord.value = null
    if (nextStatus === 'success' && anchor.type === 'item') {
      trackRecentItem(anchor.itemId)
    }
    bumpLocateVersion()
  }

  const focusIssue = (anchor: FocusAnchor, error?: string) => {
    enabled.value = true
    issueRecord.value = {
      layer: 'issue',
      anchor,
      status: 'error',
      error: error ?? null,
    }
    bumpLocateVersion()
  }

  const showResult = (anchor: FocusAnchor) => {
    enabled.value = true
    intentRecord.value = null
    clearResultRecord()
    resultRecord.value = {
      layer: 'result',
      anchor,
      status: 'success',
      error: null,
    }
    if (anchor.type === 'item') {
      trackRecentItem(anchor.itemId)
    }
    resultFocusTimer = setTimeout(() => {
      resultRecord.value = null
      resultFocusTimer = null
    }, RESULT_FOCUS_DURATION)
    bumpLocateVersion()
  }

  const resetForRun = () => {
    enabled.value = true
    autoFollow.value = true
    pausedByUser.value = false
    clearActive()
    clearDeletedEcho()
    recentItemIds.value.forEach((itemId) => clearRecentItem(itemId))
    recentItemIds.value = []
    bumpLocateVersion()
  }

  const startGap = (gap: GapInfo) => {
    focusProcess({
      type: 'gap',
      gapId: gap.id,
      startTime: gap.startTime,
      endTime: gap.endTime,
    }, 'active')
  }

  const completeItem = (item: Pick<ScheduleItemSnapshot, 'id' | 'startTime' | 'endTime'>) => {
    focusProcess({
      type: 'item',
      itemId: item.id,
      startTime: item.startTime,
      endTime: item.endTime,
    }, 'success')
  }

  const focusAnchor = (
    anchor: FocusAnchor,
    nextStatus: FocusStatus = 'active',
    error?: string,
    layer: FocusLayer = nextStatus === 'error' ? 'issue' : 'intent',
  ) => {
    if (layer === 'process') {
      focusProcess(anchor, nextStatus === 'success' ? 'success' : 'active')
      return
    }

    if (layer === 'issue' || nextStatus === 'error') {
      focusIssue(anchor, error)
      return
    }

    if (layer === 'result' || nextStatus === 'success') {
      showResult(anchor)
      return
    }

    focusIntent(anchor)
  }

  const failGap = (gap: GapInfo, error?: string) => {
    focusIssue({
      type: 'gap',
      gapId: gap.id,
      startTime: gap.startTime,
      endTime: gap.endTime,
    }, error)
  }

  const showDeletedEcho = (payload: DeletedEcho) => {
    deletedEcho.value = payload
    if (deletedEchoTimer) {
      clearTimeout(deletedEchoTimer)
    }
    deletedEchoTimer = setTimeout(() => {
      deletedEcho.value = null
      deletedEchoTimer = null
    }, DELETED_ECHO_DURATION)
  }

  const pauseAutoFollow = () => {
    if (!enabled.value || !autoFollow.value) return
    autoFollow.value = false
    pausedByUser.value = true
  }

  const resumeAutoFollow = () => {
    if (!enabled.value) return
    autoFollow.value = true
    pausedByUser.value = false
    bumpLocateVersion()
  }

  const reconcileWithLiveGaps = (
    liveGaps: Array<Pick<ProgressGapInfo, 'id' | 'startTime' | 'endTime' | 'status' | 'error'>>,
  ) => {
    const activeIssue = issueRecord.value
    if (!activeIssue || activeIssue.anchor.type !== 'gap' || activeIssue.status !== 'error') return
    const activeGap = activeIssue.anchor

    const matchedGap = liveGaps.find((gap) =>
      gap.id === activeGap.gapId
      || (gap.startTime === activeGap.startTime && gap.endTime === activeGap.endTime),
    )

    if (!matchedGap || matchedGap.status !== 'failed') {
      issueRecord.value = null
      return
    }

    issueRecord.value = {
      ...activeIssue,
      error: matchedGap.error ?? activeIssue.error ?? null,
    }
  }

  const isActiveItem = (itemId: string) => {
    const record = currentRecord.value
    return Boolean(
      record
      && record.layer !== 'result'
      && record.status === 'active'
      && record.anchor.type === 'item'
      && record.anchor.itemId === itemId,
    )
  }

  const isRecentItem = (itemId: string) => recentItemIds.value.includes(itemId)

  const activeRangeLabel = computed(() => {
    if (!active.value) return ''
    return active.value.startTime === active.value.endTime
      ? active.value.startTime
      : `${active.value.startTime} - ${active.value.endTime}`
  })

  const summaryText = computed(() => {
    const record = currentRecord.value
    if (!record) return '当前没有焦点目标'

    if (record.layer === 'process') {
      if (record.status === 'success') return `${activeRangeLabel.value} 已完成填充`
      return `正在处理 ${activeRangeLabel.value}`
    }

    if (record.layer === 'issue') {
      return `${activeRangeLabel.value} 处理失败，等待人工确认`
    }

    if (record.layer === 'result') {
      return `${activeRangeLabel.value} 已完成`
    }

    return isPointAnchor.value
      ? `已定位 ${activeRangeLabel.value}`
      : `已定位 ${activeRangeLabel.value}`
  })

  const dispose = () => {
    recentItemTimers.forEach((timer) => clearTimeout(timer))
    recentItemTimers.clear()
    clearDeletedEcho()
    clearResultRecord()
  }

  return {
    enabled,
    autoFollow,
    pausedByUser,
    active,
    status,
    currentLayer,
    lastError,
    recentItemIds,
    deletedEcho,
    locateVersion,
    activeRangeLabel,
    summaryText,
    isPointAnchor,
    showSummary,
    resetForRun,
    startGap,
    completeItem,
    focusIntent,
    focusProcess,
    focusIssue,
    showResult,
    focusAnchor,
    failGap,
    showDeletedEcho,
    clearDeletedEcho,
    pauseAutoFollow,
    resumeAutoFollow,
    clearActive,
    reconcileWithLiveGaps,
    isActiveItem,
    isRecentItem,
    dispose,
  }
}
