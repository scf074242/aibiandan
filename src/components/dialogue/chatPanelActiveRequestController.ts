import { ref } from 'vue'

export type ActiveRequestStopResult = {
  stopped: boolean
  reason: 'stopped' | 'not_found' | 'workspace_mismatch' | 'not_stoppable'
}

export function createChatPanelActiveRequestController(stoppableAfterMs = 5_000) {
  const active = ref(false)
  const canStop = ref(false)
  const stopping = ref(false)
  const stopRequested = ref(false)
  const workspaceKey = ref<string | null>(null)
  let stoppableTimer: ReturnType<typeof setTimeout> | null = null

  const clearTimer = () => {
    if (stoppableTimer) clearTimeout(stoppableTimer)
    stoppableTimer = null
  }

  const start = (nextWorkspaceKey: string) => {
    clearTimer()
    active.value = true
    canStop.value = false
    stopping.value = false
    stopRequested.value = false
    workspaceKey.value = nextWorkspaceKey
    stoppableTimer = setTimeout(() => {
      if (active.value) canStop.value = true
    }, stoppableAfterMs)
  }

  const stop = async (
    cancel: (activeWorkspaceKey: string) => Promise<ActiveRequestStopResult>,
  ): Promise<ActiveRequestStopResult> => {
    if (!active.value || !canStop.value || stopping.value || !workspaceKey.value) {
      return { stopped: false, reason: 'not_stoppable' }
    }
    stopping.value = true
    try {
      const result = await cancel(workspaceKey.value)
      stopRequested.value = result.stopped
      if (!result.stopped) stopping.value = false
      return result
    } catch (error) {
      stopping.value = false
      throw error
    }
  }

  const finish = () => {
    clearTimer()
    active.value = false
    canStop.value = false
    stopping.value = false
    stopRequested.value = false
    workspaceKey.value = null
  }

  return { active, canStop, stopping, stopRequested, start, stop, finish }
}
