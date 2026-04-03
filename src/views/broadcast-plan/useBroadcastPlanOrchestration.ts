import type { ComputedRef, Ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'

import { useOrchestrator } from '@/composables/useOrchestrator'
import type { ScheduleItem } from './scheduleData'
import {
  buildOrchestrationScheduleState,
  shouldStartPartialGeneration,
} from './broadcastPlanOrchestrationHelpers'

type UseBroadcastPlanOrchestrationOptions = {
  aiUserInput: Ref<string>
  currentChannelId: ComputedRef<string>
  currentChannelName: ComputedRef<string>
  scheduleDate: ComputedRef<string>
  scheduleItems: Ref<ScheduleItem[]>
  displayGapCount: ComputedRef<number>
  syncPageItemsToAtomic: () => void
  syncAtomicItemsToPage: () => void
  syncAtomicItemsToPageDeferred: () => void
}

export const useBroadcastPlanOrchestration = (options: UseBroadcastPlanOrchestrationOptions) => {
  const orchestratorRuntime = useOrchestrator({
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

  const startOrchestrationRuntime = async () => {
    try {
      options.syncPageItemsToAtomic()
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

  const handleAICommand = async () => {
    const userInput = options.aiUserInput.value.trim()
    if (!userInput) {
      ElMessage.warning('请输入需求')
      return
    }

    const date = options.scheduleDate.value
    const itemCount = options.scheduleItems.value.length
    const task = await orchestratorRuntime.classifyTask(
      buildOrchestrationScheduleState({
        channelId: options.currentChannelId.value,
        channelName: options.currentChannelName.value,
        date,
        itemCount,
        gapCount: options.displayGapCount.value,
      }),
      userInput,
    )

    options.aiUserInput.value = ''

    if (shouldStartPartialGeneration(task.mode, itemCount)) {
      options.syncPageItemsToAtomic()
      await orchestratorRuntime.startPartialGeneration(
        options.currentChannelId.value,
        date,
      )
      return
    }

    await startOrchestrationRuntime()
  }

  const handleChatCommandExecuted = (result: { success: boolean; message: string }) => {
    if (result.success) {
      options.syncAtomicItemsToPage()
    }
  }

  const handleChatScheduleUpdated = () => {
    options.syncAtomicItemsToPage()
  }

  const handleChatOrchestrateRequested = async (payload: { userInput: string }) => {
    options.aiUserInput.value = payload.userInput
    await handleAICommand()
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
    handleAICommand,
    handleChatCommandExecuted,
    handleChatScheduleUpdated,
    handleChatOrchestrateRequested,
    handleCancelOrchestration,
  }
}
