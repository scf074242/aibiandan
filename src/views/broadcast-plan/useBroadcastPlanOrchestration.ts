import { computed, ref, type ComputedRef, type Ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'

import { useOrchestrator } from '@/composables/useOrchestrator'
import type { ScheduleItem } from './scheduleData'
import type { LayoutDraft } from '@/types/orchestration'
import { useBroadcastPlanFocus } from './useBroadcastPlanFocus'
import type { ValidationReport } from '@/types/orchestration'
import { setRuntimeLayout } from '@/services/orchestration/runtimeLayoutRegistry'
import type { ChatScheduleUpdateItem } from './broadcastPlanScheduleBridge'
import { resolveFormalOrchestrationSearchKeywords } from '@/services/retrievalConstraintCompiler'
import type { RuntimeOrchestrationRequest, RuntimeSubmitInput } from '@/services/runtime/schedulingAgentRuntimeFacade'
import { buildFormalPlaylistSnapshot } from '@/services/runtime/formalPlaylistState'
import { buildScheduleWorkspaceSummary, resolveForegroundWorkspaceKey } from '@/services/runtime/foregroundWorkspaceState'

export interface BroadcastPlanReactApproval {
  workspaceKey: string
  playlistVersion: string
  summary: string
  checkpointCount: number
}

type UseBroadcastPlanOrchestrationOptions = {
  currentChannelId: ComputedRef<string>
  currentChannelName: ComputedRef<string>
  scheduleDate: ComputedRef<string>
  scheduleItems: Ref<ScheduleItem[]>
  displayGapCount: ComputedRef<number>
  syncPageItemsToAtomic: () => void
  syncAtomicItemsToPage: () => void
  applyRuntimeScheduleItems: (items: ChatScheduleUpdateItem[]) => void
  syncAtomicItemsToPageDeferred: () => void
  persistCurrentPlaylistDocument: () => void
  activateScheduleWorkspace?: () => void
  focusRuntime: ReturnType<typeof useBroadcastPlanFocus>
  normalizeClockText: (value: string) => string
  buildRuntimeSubmitInput: (userInput: string) => RuntimeSubmitInput
}

export const useBroadcastPlanOrchestration = (options: UseBroadcastPlanOrchestrationOptions) => {
  const reactApproval = ref<BroadcastPlanReactApproval | null>(null)
  let reactApprovalUserInput: string | null = null
  const orchestratorRuntime = useOrchestrator({
    onGapStart: (gap) => {
      options.focusRuntime.startGap({
        ...gap,
        startTime: options.normalizeClockText(gap.startTime),
        endTime: options.normalizeClockText(gap.endTime),
      })
    },
    onGapComplete: (_gap, item) => {
      options.focusRuntime.completeItem({
        ...item,
        startTime: options.normalizeClockText(item.startTime),
        endTime: options.normalizeClockText(item.endTime),
      })
    },
    onGapFailed: (gap, error) => {
      options.focusRuntime.failGap({
        ...gap,
        startTime: options.normalizeClockText(gap.startTime),
        endTime: options.normalizeClockText(gap.endTime),
      }, error)
    },
    onComplete: (session) => {
      options.syncAtomicItemsToPage()
      if (session.status === 'manual_review') {
        ElMessage.warning('自动编排阶段已结束，仍有空窗待人工确认')
        return
      }
      ElMessage.success('AI 编排完成')
    },
    onError: (error: Error) => {
      ElMessage.error(`AI 编排失败: ${error.message}`)
    },
    onProgress: () => {
      const liveGaps = orchestratorRuntime.progress.value?.liveGaps ?? []
      options.focusRuntime.reconcileWithLiveGaps(
        liveGaps.map((gap) => ({
          ...gap,
          startTime: options.normalizeClockText(gap.startTime),
          endTime: options.normalizeClockText(gap.endTime),
        })),
      )
      options.syncAtomicItemsToPageDeferred()
    },
    onStatusChange: (status) => {
      if (status === 'cancelled') {
        options.syncAtomicItemsToPage()
        ElMessage.info('AI 编排已中止，当前已生成内容已保留')
      }
    },
    onLog: (log) => {
      console.log('编排日志:', log.message || log)
    },
  })

  const handleChatCommandExecuted = (result: {
    success: boolean
    message: string
    commandAction?: string
    data?: unknown
    affectedTimeRanges?: { start: string; end: string }[]
    validationReport?: ValidationReport
  }) => {
    if (result.success) {
      options.syncAtomicItemsToPage()
      let hasAppliedFocus = false
      if (result.commandAction === 'delete') {
        options.focusRuntime.clearDeletedEcho()
        options.focusRuntime.clearActive()
        hasAppliedFocus = true
      }

      if (!hasAppliedFocus && Array.isArray(result.affectedTimeRanges) && result.affectedTimeRanges.length > 0) {
        const primaryRange = result.commandAction === 'move'
          ? result.affectedTimeRanges[result.affectedTimeRanges.length - 1]
          : result.affectedTimeRanges[0]
        if (!primaryRange) {
          return
        }
        options.focusRuntime.showResult({
          type: 'range',
          startTime: options.normalizeClockText(primaryRange.start),
          endTime: options.normalizeClockText(primaryRange.end),
        })
      }
    }
  }

  const handleChatScheduleUpdated = (items?: ChatScheduleUpdateItem[]) => {
    if (items?.length) {
      options.applyRuntimeScheduleItems(items)
      options.persistCurrentPlaylistDocument()
      return
    }
    options.syncAtomicItemsToPage()
    options.persistCurrentPlaylistDocument()
  }

  const handleChatOrchestrateRequested = async (
    payload: RuntimeOrchestrationRequest,
  ) => {
    void payload.userInput
    void payload.reasoning
    if (payload.mode !== 'full_generate' && payload.mode !== 'partial_generate') {
      return
    }
    options.activateScheduleWorkspace?.()
    if (payload.layoutDraft) {
      setRuntimeLayout({
        sourceFileName: payload.layoutDraft.source === 'uploaded'
          ? '上传版面草案'
          : payload.layoutDraft.source === 'channel_default'
            ? '频道版面草案'
            : 'AI版面草案',
        channelId: payload.layoutDraft.channelId,
        date: payload.layoutDraft.date,
        warnings: payload.layoutDraft.warnings ?? [],
        layoutReference: payload.layoutDraft.layoutReference,
        columns: payload.layoutDraft.columns,
      })
    }
    const effectiveTargetTimeRange = payload.targetTimeRange ?? payload.layoutDraft?.coverage
    const searchKeywords = payload.searchKeywords?.length
      ? payload.searchKeywords
      : resolveFormalOrchestrationSearchKeywords(payload.userInput)
    if (payload.reactTask) {
      const runtimeInput = options.buildRuntimeSubmitInput(payload.userInput)
      const workspaceKey = resolveForegroundWorkspaceKey(buildScheduleWorkspaceSummary(runtimeInput.scheduleState))
      const playlistVersion = buildFormalPlaylistSnapshot(runtimeInput.currentSchedule, 'foreground').version
      const outcome = await orchestratorRuntime.startReactOrchestration(
        { ...payload, targetTimeRange: effectiveTargetTimeRange, searchKeywords },
        runtimeInput,
      )
      if (outcome.status === 'waiting_user') {
        if (outcome.scheduleItems) {
          options.applyRuntimeScheduleItems(outcome.scheduleItems)
          options.persistCurrentPlaylistDocument()
        }
        reactApprovalUserInput = payload.userInput
        reactApproval.value = {
          workspaceKey,
          playlistVersion: outcome.scheduleItems
            ? buildFormalPlaylistSnapshot(outcome.scheduleItems, 'foreground').version
            : playlistVersion,
          summary: (outcome.pendingTask as { summary?: string } | undefined)?.summary
            || outcome.pendingTask?.originalInput
            || '当前正式编排动作等待确认',
          checkpointCount: outcome.checkpointCount ?? 0,
        }
        return
      }
      reactApproval.value = null
      reactApprovalUserInput = null
      if (outcome.scheduleItems) {
        options.applyRuntimeScheduleItems(outcome.scheduleItems)
        options.persistCurrentPlaylistDocument()
      }
      return
    }
    ElMessage.error('正式编排请求缺少 ReAct 动作计划，已停止且不会回退旧编排器。请重试。')
  }

  const buildCurrentReactApprovalInput = (): RuntimeSubmitInput | null => {
    if (!reactApproval.value || !reactApprovalUserInput) return null
    return options.buildRuntimeSubmitInput(reactApprovalUserInput)
  }

  const reactApprovalIsCurrent = computed(() => {
    const approval = reactApproval.value
    const runtimeInput = buildCurrentReactApprovalInput()
    if (!approval || !runtimeInput) return false
    const workspaceKey = resolveForegroundWorkspaceKey(buildScheduleWorkspaceSummary(runtimeInput.scheduleState))
    const playlistVersion = buildFormalPlaylistSnapshot(runtimeInput.currentSchedule, 'foreground').version
    return workspaceKey === approval.workspaceKey && playlistVersion === approval.playlistVersion
  })

  const recoverReactApproval = async (action: 'confirm_pending' | 'cancel') => {
    const approval = reactApproval.value
    const runtimeInput = buildCurrentReactApprovalInput()
    if (!approval || !runtimeInput) return
    if (!reactApprovalIsCurrent.value) {
      ElMessage.warning('当前播单或工作区已经变化，这条待确认操作已失效，请重新发起。')
      return
    }
    const result = await orchestratorRuntime.recoverReactOrchestration({
      action,
      workspaceKey: approval.workspaceKey,
      playlistVersion: buildFormalPlaylistSnapshot(runtimeInput.currentSchedule, 'foreground').version,
      runtimeInput,
    })
    if (result.status === 'cancelled') {
      reactApproval.value = null
      reactApprovalUserInput = null
      ElMessage.info('已取消待确认的正式编排动作，当前播单保持不变')
      return
    }
    if (result.executionStatus === 'completed') {
      if (result.scheduleItems) {
        options.applyRuntimeScheduleItems(result.scheduleItems)
        options.persistCurrentPlaylistDocument()
      }
      reactApproval.value = null
      reactApprovalUserInput = null
      ElMessage.success('已按确认继续完成正式编排')
      return
    }
    if (result.executionStatus === 'waiting_user') {
      const latestInput = options.buildRuntimeSubmitInput(reactApprovalUserInput ?? runtimeInput.userInput)
      reactApproval.value = {
        ...approval,
        playlistVersion: buildFormalPlaylistSnapshot(latestInput.currentSchedule, 'foreground').version,
      }
      return
    }
    if (result.status !== 'ready') {
      ElMessage.warning(result.envelope.humanSummary)
    }
  }

  const confirmReactApproval = async () => recoverReactApproval('confirm_pending')
  const cancelReactApproval = async () => recoverReactApproval('cancel')

  const handleCancelOrchestration = async () => {
    try {
      await ElMessageBox.confirm(
        '中止后将保留当前已编排结果，剩余空窗不再继续自动处理。是否停止本次 AI 编排？',
        '中止编排',
        {
          type: 'warning',
          confirmButtonText: '中止编排',
          cancelButtonText: '继续运行',
        },
      )
      orchestratorRuntime.cancel()
    } catch {
      // 用户取消中止
    }
  }

  return {
    orchestratorRuntime,
    reactApproval,
    reactApprovalIsCurrent,
    handleChatCommandExecuted,
    handleChatScheduleUpdated,
    handleChatOrchestrateRequested,
    confirmReactApproval,
    cancelReactApproval,
    handleCancelOrchestration,
  }
}
