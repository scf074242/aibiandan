import { ref } from 'vue'
import { ElMessage } from 'element-plus'

import type { ScheduleItem, CollaborativeScheduleDetail } from './scheduleData'
import type { TimeDiscontinuity } from './broadcastPlanGapState'
import {
  buildGapDialogDefaults,
  buildInsertableScheduleItem,
  normalizeScheduleItemForSave,
} from './broadcastPlanEditorHelpers'
import type { GapDialogDefaults } from './broadcastPlanEditorHelpers'
import type { ManualCommandAdapter } from '@/services/manualCommandAdapter'
import type { ScheduleCommandBus } from '@/services/scheduleCommandBus'

type UseBroadcastPlanEditorOptions = {
  isViewMode: { value: boolean }
  scheduleForm: { value: Partial<CollaborativeScheduleDetail> }
  scheduleItems: { value: ScheduleItem[] }
  allowedDialogTypes: { value: Array<'record' | 'live' | 'ad'> }
  canEditSection: (item: Pick<ScheduleItem, 'sourceType' | 'businessType'>) => boolean
  scheduleDate: { value: string }
  currentChannelId: { value: string }
  syncAtomicItemsToPage: () => void
  resolveManualCandidateId: (item: Partial<ScheduleItem>) => Promise<string | null>
  generateId: () => string
  resolveScheduleItemProgramType: (item: Partial<ScheduleItem>) => string
  normalizeClockText: (value: string) => string
  formatRelativeStart: (seconds?: number) => string
  formatPlayLengthText: (durationSeconds: number) => string
  timeToSeconds: (time: string) => number
  scheduleCommandBus: ScheduleCommandBus
  manualCommandAdapter: ManualCommandAdapter
}

export const useBroadcastPlanEditor = (options: UseBroadcastPlanEditorOptions) => {
  const dialogVisible = ref(false)
  const editingItem = ref<ScheduleItem | null>(null)
  const gapDialogDefaults = ref<GapDialogDefaults | null>(null)

  const openDialogForCreate = () => {
    gapDialogDefaults.value = null
    editingItem.value = null
    dialogVisible.value = true
  }

  const openAddItemForGap = (gap: TimeDiscontinuity) => {
    if (options.isViewMode.value || options.scheduleForm.value.isLocked) return
    if (options.allowedDialogTypes.value.length === 0) {
      ElMessage.warning('当前用户无可编辑板块权限')
      return
    }
    gapDialogDefaults.value = buildGapDialogDefaults(gap)
    editingItem.value = null
    dialogVisible.value = true
  }

  const handleAddItem = () => {
    if (options.allowedDialogTypes.value.length === 0) {
      ElMessage.warning('当前用户无可编辑板块权限')
      return
    }
    openDialogForCreate()
  }

  const handleEditItem = (item: ScheduleItem) => {
    gapDialogDefaults.value = null
    editingItem.value = { ...item }
    dialogVisible.value = true
  }

  const handleItemClick = (item: ScheduleItem) => {
    if (!options.isViewMode.value && !options.scheduleForm.value.isLocked && !item.isReference) {
      if (!options.canEditSection(item)) {
        ElMessage.warning('当前用户无权限编辑该板块内容')
        return
      }
      handleEditItem(item)
    }
  }

  const handleEmptyAreaClick = (event: MouseEvent) => {
    const target = event.target as HTMLElement
    if (target.closest('.schedule-item-row')) {
      return
    }

    if (options.isViewMode.value || options.scheduleForm.value.isLocked) {
      return
    }
    if (options.allowedDialogTypes.value.length === 0) {
      ElMessage.warning('当前用户无可编辑板块权限')
      return
    }

    openDialogForCreate()
  }

  const handleDeleteItemById = async (itemId: string) => {
    const item = options.scheduleItems.value.find((entry) => entry.id === itemId)
    if (!item) {
      ElMessage.error('未找到待删除节目')
      return
    }

    const result = await options.scheduleCommandBus.execute(
      options.manualCommandAdapter.buildDeleteCommand(item),
      {
        scheduleDate: options.scheduleDate.value,
        channelId: options.currentChannelId.value,
      },
    )

    if (!result.success) {
      ElMessage.error(result.error || result.message)
      return
    }

    options.syncAtomicItemsToPage()
    gapDialogDefaults.value = null
    ElMessage.success(result.message)
  }

  const handleSaveItem = async (item: Partial<ScheduleItem>) => {
    if (!item.startTime || !item.endTime) {
      ElMessage.error('节目数据不完整，无法保存')
      return
    }

    const normalizedItem = normalizeScheduleItemForSave(item, {
      generateId: options.generateId,
      resolveScheduleItemProgramType: options.resolveScheduleItemProgramType,
      normalizeClockText: options.normalizeClockText,
      formatRelativeStart: options.formatRelativeStart,
      formatPlayLengthText: options.formatPlayLengthText,
      timeToSeconds: options.timeToSeconds,
    })

    const commandContext = {
      scheduleDate: options.scheduleDate.value,
      channelId: options.currentChannelId.value,
    }
    const currentIndex = options.scheduleItems.value.findIndex((entry) => entry.id === normalizedItem.id)

    if (currentIndex > -1) {
      const currentItem = options.scheduleItems.value[currentIndex]
      if (!currentItem) return
      const commands = options.manualCommandAdapter.buildUpdateCommands(currentItem, normalizedItem, commandContext)
      if (commands.length === 0) {
        options.scheduleItems.value[currentIndex] = {
          ...normalizedItem,
          scheduleId: options.scheduleForm.value.id || '',
        }
        gapDialogDefaults.value = null
        return
      }

      const result = await options.scheduleCommandBus.executeBatch(commands, commandContext)
      if (!result.success) {
        ElMessage.error(result.error || result.message)
        return
      }

      options.syncAtomicItemsToPage()
      gapDialogDefaults.value = null
      ElMessage.success(result.message)
      return
    }

    const newItem = buildInsertableScheduleItem(
      normalizedItem,
      gapDialogDefaults.value,
      options.scheduleForm.value.id || '',
    )
    let insertCommand = options.manualCommandAdapter.buildInsertCommand(newItem, commandContext)

    if (!insertCommand) {
      const resolvedCandidateId = await options.resolveManualCandidateId(newItem)
      if (resolvedCandidateId) {
        insertCommand = options.manualCommandAdapter.buildInsertCommandForCandidate(
          resolvedCandidateId,
          newItem,
          commandContext,
        )
      }
    }

    if (!insertCommand) {
      ElMessage.error('未匹配到可插入的节目候选，请输入有效节目编号或更准确的节目名称。')
      return
    }

    const result = await options.scheduleCommandBus.execute(insertCommand, commandContext)
    if (!result.success) {
      ElMessage.error(result.error || result.message)
      return
    }

    options.syncAtomicItemsToPage()
    gapDialogDefaults.value = null
    ElMessage.success(result.message)
  }

  return {
    dialogVisible,
    editingItem,
    gapDialogDefaults,
    openAddItemForGap,
    handleAddItem,
    handleEditItem,
    handleItemClick,
    handleEmptyAreaClick,
    handleDeleteItemById,
    handleSaveItem,
  }
}
