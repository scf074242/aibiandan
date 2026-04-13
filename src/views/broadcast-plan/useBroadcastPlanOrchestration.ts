import type { ComputedRef, Ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'

import { useOrchestrator } from '@/composables/useOrchestrator'
import type { ScheduleItem } from './scheduleData'
import type { LayoutDraft, TaskMode } from '@/types/orchestration'
import { useBroadcastPlanFocus } from './useBroadcastPlanFocus'
import type { ValidationReport } from '@/types/orchestration'
import { setRuntimeLayout } from '@/services/orchestration/runtimeLayoutRegistry'

type UseBroadcastPlanOrchestrationOptions = {
  currentChannelId: ComputedRef<string>
  currentChannelName: ComputedRef<string>
  scheduleDate: ComputedRef<string>
  scheduleItems: Ref<ScheduleItem[]>
  displayGapCount: ComputedRef<number>
  syncPageItemsToAtomic: () => void
  syncAtomicItemsToPage: () => void
  syncAtomicItemsToPageDeferred: () => void
  focusRuntime: ReturnType<typeof useBroadcastPlanFocus>
  normalizeClockText: (value: string) => string
}

export const useBroadcastPlanOrchestration = (options: UseBroadcastPlanOrchestrationOptions) => {
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

  const startOrchestrationRuntime = async (mode: Extract<TaskMode, 'full_generate' | 'partial_generate'> = 'full_generate') => {
    try {
      options.focusRuntime.resetForRun()
      options.syncPageItemsToAtomic()
      if (mode === 'partial_generate') {
        await orchestratorRuntime.startPartialGeneration(
          options.currentChannelId.value,
          options.scheduleDate.value,
        )
        return
      }

      await orchestratorRuntime.startFullGeneration(
        options.currentChannelId.value,
        options.scheduleDate.value,
        '06:00:00',
        '23:59:59',
      )
    } catch (error) {
      ElMessage.error(error instanceof Error ? error.message : 'AI 编排失败')
    }
  }

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

  const handleChatScheduleUpdated = () => {
    options.syncAtomicItemsToPage()
  }

  const handleChatOrchestrateRequested = async (
    payload: { userInput: string; mode: TaskMode; reasoning?: string; layoutDraft?: LayoutDraft },
  ) => {
    void payload.userInput
    void payload.reasoning
    if (payload.mode !== 'full_generate' && payload.mode !== 'partial_generate') {
      return
    }
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
    await startOrchestrationRuntime(payload.mode)
  }

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
    startOrchestrationRuntime,
    handleChatCommandExecuted,
    handleChatScheduleUpdated,
    handleChatOrchestrateRequested,
    handleCancelOrchestration,
  }
}
