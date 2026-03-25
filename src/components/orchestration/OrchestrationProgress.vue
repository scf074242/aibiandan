<template>
  <div class="orchestration-progress">
    <!-- 进度概览 -->
    <div class="progress-header">
      <div class="progress-info">
        <div class="progress-title">
          <span class="phase-badge" :class="phaseClass">{{ currentPhaseText }}</span>
          <span class="progress-percentage">{{ progressPercentage }}%</span>
        </div>
        <el-progress
          :percentage="progressPercentage"
          :status="progressStatus"
          :stroke-width="16"
          class="progress-bar"
        />
        <div class="progress-stats">
          <el-tag size="small" type="info">总空窗: {{ progress.gapProgress.total }}</el-tag>
          <el-tag size="small" type="warning">待处理: {{ progress.gapProgress.pending }}</el-tag>
          <el-tag size="small" type="primary">处理中: {{ progress.gapProgress.processing }}</el-tag>
          <el-tag size="small" type="success">已完成: {{ progress.gapProgress.completed }}</el-tag>
          <el-tag v-if="progress.gapProgress.failed > 0" size="small" type="danger">
            失败: {{ progress.gapProgress.failed }}
          </el-tag>
        </div>
      </div>
      <div class="progress-actions">
        <el-button
          v-if="canCancel && !isCompleted && !isError"
          type="danger"
          size="small"
          @click="handleCancel"
        >
          <el-icon><CircleClose /></el-icon>
          取消
        </el-button>
        <el-button
          v-if="isCompleted || isError || isCancelled"
          type="primary"
          size="small"
          @click="handleReset"
        >
          <el-icon><RefreshRight /></el-icon>
          重新开始
        </el-button>
      </div>
    </div>

    <!-- 回退状态警告 -->
    <div v-if="progress.fallbackStatus" class="fallback-alert" :class="`level-${progress.fallbackStatus.level}`">
      <el-alert
        :title="fallbackTitle"
        :type="fallbackAlertType"
        :description="progress.fallbackStatus.reason"
        :closable="false"
        show-icon
      >
        <template #default>
          <div class="fallback-detail">
            <span>回退层级: {{ fallbackLevelText }}</span>
            <span>回退次数: {{ progress.fallbackStatus.count }}</span>
          </div>
        </template>
      </el-alert>
    </div>

    <!-- 修补状态 -->
    <div v-if="progress.repairStatus" class="repair-status">
      <div class="repair-header">
        <span class="repair-title">
          <el-icon><Tools /></el-icon>
          自动修补中
        </span>
        <el-tag size="small" :type="repairRoundTagType">
          第 {{ progress.repairStatus.currentRound }} / {{ progress.repairStatus.maxRounds }} 轮
        </el-tag>
      </div>
      <el-progress
        :percentage="repairPercentage"
        :stroke-width="8"
        :status="repairProgressStatus"
        class="repair-progress"
      />
      <div v-if="progress.repairStatus.requiresManualIntervention" class="manual-intervention">
        <el-alert
          title="需要人工介入"
          type="warning"
          description="自动修补已达到最大轮次，请人工处理剩余问题"
          :closable="false"
          show-icon
        />
      </div>
    </div>

    <!-- 当前处理空窗 -->
    <div v-if="progress.currentGap" class="current-gap">
      <div class="section-title">
        <el-icon><Timer /></el-icon>
        当前处理空窗
      </div>
      <div class="gap-card">
        <div class="gap-time">
          <el-tag size="small" type="info">{{ formatTime(progress.currentGap.startTime) }} - {{ formatTime(progress.currentGap.endTime) }}</el-tag>
          <span class="gap-duration">{{ formatDuration(progress.currentGap.duration) }}</span>
        </div>
        <div v-if="progress.currentAction" class="gap-action">
          <el-tag size="small" type="primary">{{ progress.currentAction }}</el-tag>
        </div>
      </div>
    </div>

    <!-- 执行统计 -->
    <div class="execution-stats">
      <div class="section-title">
        <el-icon><DataLine /></el-icon>
        执行统计
      </div>
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-value">{{ progress.stats.totalCommands }}</div>
          <div class="stat-label">总命令</div>
        </div>
        <div class="stat-card success">
          <div class="stat-value">{{ progress.stats.successfulCommands }}</div>
          <div class="stat-label">成功</div>
        </div>
        <div class="stat-card danger">
          <div class="stat-value">{{ progress.stats.failedCommands }}</div>
          <div class="stat-label">失败</div>
        </div>
        <div class="stat-card warning">
          <div class="stat-value">{{ progress.stats.fallbackCount }}</div>
          <div class="stat-label">回退</div>
        </div>
      </div>
    </div>

    <!-- 空窗列表 -->
    <div class="gaps-section">
      <div class="section-title">
        <el-icon><List /></el-icon>
        空窗处理状态
      </div>
      <div class="gaps-list">
        <div
          v-for="gap in gapList"
          :key="gap.id"
          class="gap-item"
          :class="getGapItemClass(gap)"
        >
          <div class="gap-status-icon">
            <el-icon v-if="gap.status === 'pending'"><Timer /></el-icon>
            <el-icon v-else-if="gap.status === 'processing'" class="is-loading"><Loading /></el-icon>
            <el-icon v-else-if="gap.status === 'completed'"><CircleCheck /></el-icon>
            <el-icon v-else-if="gap.status === 'failed'"><CircleClose /></el-icon>
          </div>
          <div class="gap-info">
            <div class="gap-time-range">
              {{ formatTime(gap.startTime) }} - {{ formatTime(gap.endTime) }}
            </div>
            <div class="gap-meta">
              <el-tag size="small" type="info">{{ formatDuration(gap.duration) }}</el-tag>
              <el-tag v-if="gap.attemptCount > 1" size="small" type="warning">
                尝试 {{ gap.attemptCount }} 次
              </el-tag>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 日志输出 -->
    <div class="logs-section">
      <div class="logs-header">
        <span class="section-title">
          <el-icon><Document /></el-icon>
          执行日志
        </span>
        <el-button link size="small" @click="clearLogs">
          <el-icon><Delete /></el-icon>
          清空
        </el-button>
      </div>
      <div ref="logsContainer" class="logs-container">
        <div
          v-for="(log, index) in progress.recentLogs"
          :key="index"
          class="log-item"
          :class="`level-${log.level}`"
        >
          <span class="log-time">{{ formatLogTime(log.timestamp) }}</span>
          <span class="log-phase">[{{ log.phase }}]</span>
          <span class="log-message">{{ log.message }}</span>
        </div>
        <div v-if="progress.recentLogs.length === 0" class="logs-empty">
          <el-icon><InfoFilled /></el-icon>
          暂无日志
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, nextTick } from 'vue'
import type { OrchestrationProgress, GapProcessingState, GapInfo } from '@/types/orchestration'
import {
  Timer,
  Loading,
  CircleCheck,
  CircleClose,
  RefreshRight,
  Tools,
  DataLine,
  List,
  Document,
  Delete,
  InfoFilled
} from '@element-plus/icons-vue'

interface Props {
  progress: OrchestrationProgress
  canCancel?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  canCancel: false
})

const emit = defineEmits<{
  cancel: []
  reset: []
}>()

const logsContainer = ref<HTMLElement>()

// 计算属性
const progressPercentage = computed(() => {
  const { total, completed } = props.progress.gapProgress
  if (total === 0) return 0
  return Math.round((completed / total) * 100)
})

const progressStatus = computed(() => {
  switch (props.progress.status) {
    case 'completed':
      return 'success'
    case 'failed':
    case 'cancelled':
      return 'exception'
    default:
      return ''
  }
})

const isCompleted = computed(() => props.progress.status === 'completed')
const isError = computed(() => props.progress.status === 'failed')
const isCancelled = computed(() => props.progress.status === 'cancelled')

const currentPhaseText = computed(() => {
  const phaseMap: Record<string, string> = {
    initializing: '初始化',
    planning: '规划策略',
    filling: '填充节目',
    repairing: '自动修复',
    completed: '已完成',
    failed: '执行失败',
    cancelled: '已取消'
  }
  return phaseMap[props.progress.status] || props.progress.currentPhase
})

const phaseClass = computed(() => {
  const classMap: Record<string, string> = {
    initializing: 'phase-initializing',
    planning: 'phase-planning',
    filling: 'phase-filling',
    repairing: 'phase-repairing',
    completed: 'phase-completed',
    failed: 'phase-failed',
    cancelled: 'phase-cancelled'
  }
  return classMap[props.progress.status] || ''
})

// 回退状态
const fallbackTitle = computed(() => {
  const levelMap: Record<string, string> = {
    item: '条目级回退',
    gap: '空窗级回退',
    session: '会话级回退'
  }
  return `${levelMap[props.progress.fallbackStatus?.level || 'item']} 已触发`
})

const fallbackLevelText = computed(() => {
  const levelMap: Record<string, string> = {
    item: '条目级',
    gap: '空窗级',
    session: '会话级'
  }
  return levelMap[props.progress.fallbackStatus?.level || 'item']
})

const fallbackAlertType = computed(() => {
  const typeMap: Record<string, 'info' | 'warning' | 'error'> = {
    item: 'info',
    gap: 'warning',
    session: 'error'
  }
  return typeMap[props.progress.fallbackStatus?.level || 'item']
})

// 修补状态
const repairPercentage = computed(() => {
  if (!props.progress.repairStatus) return 0
  const { currentRound, maxRounds } = props.progress.repairStatus
  return Math.round((currentRound / maxRounds) * 100)
})

const repairProgressStatus = computed(() => {
  if (!props.progress.repairStatus) return ''
  if (props.progress.repairStatus.requiresManualIntervention) return 'exception'
  if (props.progress.repairStatus.currentRound >= props.progress.repairStatus.maxRounds) return 'warning'
  return ''
})

const repairRoundTagType = computed(() => {
  if (!props.progress.repairStatus) return 'info'
  if (props.progress.repairStatus.requiresManualIntervention) return 'danger'
  if (props.progress.repairStatus.currentRound >= props.progress.repairStatus.maxRounds) return 'warning'
  return 'primary'
})

// 空窗列表（模拟数据，实际应从父组件传入）
const gapList = computed(() => {
  // 这里应该根据 progress.gapProgress 和实际空窗数据生成
  // 暂时返回空数组，实际使用时需要传入 gapStates
  return [] as (GapInfo & { status: string; attemptCount: number })[]
})

// 方法
const handleCancel = () => {
  emit('cancel')
}

const handleReset = () => {
  emit('reset')
}

const clearLogs = () => {
  props.progress.recentLogs = []
}

const formatTime = (time: string) => {
  if (!time) return '--:--'
  const date = new Date(time)
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

const formatDuration = (seconds: number) => {
  if (!seconds || seconds <= 0) return '0分钟'
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (hours > 0) {
    return `${hours}小时${minutes}分钟`
  }
  return `${minutes}分钟`
}

const formatLogTime = (timestamp: string) => {
  const date = new Date(timestamp)
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

const getGapItemClass = (gap: GapInfo & { status: string }) => {
  return {
    'is-pending': gap.status === 'pending',
    'is-processing': gap.status === 'processing',
    'is-completed': gap.status === 'completed',
    'is-failed': gap.status === 'failed'
  }
}

// 自动滚动日志
watch(
  () => props.progress.recentLogs.length,
  async () => {
    await nextTick()
    if (logsContainer.value) {
      logsContainer.value.scrollTop = logsContainer.value.scrollHeight
    }
  }
)
</script>

<style scoped lang="scss">
.orchestration-progress {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 16px;
  background: var(--el-bg-color);
  border-radius: 8px;
  gap: 16px;
  overflow-y: auto;
}

.progress-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.progress-info {
  flex: 1;
  margin-right: 16px;
}

.progress-title {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}

.phase-badge {
  padding: 4px 12px;
  border-radius: 12px;
  font-size: 14px;
  font-weight: 500;

  &.phase-initializing {
    background: var(--el-color-info-light-9);
    color: var(--el-color-info);
  }

  &.phase-planning {
    background: var(--el-color-primary-light-9);
    color: var(--el-color-primary);
  }

  &.phase-filling {
    background: var(--el-color-warning-light-9);
    color: var(--el-color-warning);
  }

  &.phase-repairing {
    background: var(--el-color-danger-light-9);
    color: var(--el-color-danger);
  }

  &.phase-completed {
    background: var(--el-color-success-light-9);
    color: var(--el-color-success);
  }

  &.phase-failed,
  &.phase-cancelled {
    background: var(--el-color-danger-light-9);
    color: var(--el-color-danger);
  }
}

.progress-percentage {
  font-size: 20px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.progress-bar {
  margin-bottom: 12px;
}

.progress-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.progress-actions {
  display: flex;
  gap: 8px;
}

// 回退状态
.fallback-alert {
  margin-bottom: 8px;

  &.level-item {
    :deep(.el-alert) {
      background: var(--el-color-info-light-9);
    }
  }

  &.level-gap {
    :deep(.el-alert) {
      background: var(--el-color-warning-light-9);
    }
  }

  &.level-session {
    :deep(.el-alert) {
      background: var(--el-color-danger-light-9);
    }
  }
}

.fallback-detail {
  display: flex;
  gap: 16px;
  margin-top: 8px;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

// 修补状态
.repair-status {
  padding: 12px;
  background: var(--el-fill-color-light);
  border-radius: 8px;
}

.repair-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.repair-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 500;
  color: var(--el-text-color-primary);
}

.repair-progress {
  margin-bottom: 8px;
}

.manual-intervention {
  margin-top: 8px;
}

// 当前空窗
.current-gap {
  padding: 12px;
  background: var(--el-color-primary-light-9);
  border-radius: 8px;
  border-left: 4px solid var(--el-color-primary);
}

.gap-card {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 8px;
}

.gap-time {
  display: flex;
  align-items: center;
  gap: 12px;
}

.gap-duration {
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

// 执行统计
.execution-stats {
  padding: 12px;
  background: var(--el-fill-color-light);
  border-radius: 8px;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  margin-top: 12px;
}

.stat-card {
  text-align: center;
  padding: 12px;
  background: var(--el-bg-color);
  border-radius: 6px;

  &.success {
    .stat-value {
      color: var(--el-color-success);
    }
  }

  &.danger {
    .stat-value {
      color: var(--el-color-danger);
    }
  }

  &.warning {
    .stat-value {
      color: var(--el-color-warning);
    }
  }
}

.stat-value {
  font-size: 24px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.stat-label {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin-top: 4px;
}

// 空窗列表
.gaps-section {
  flex: 1;
  min-height: 200px;
  display: flex;
  flex-direction: column;
}

.section-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 500;
  font-size: 14px;
  color: var(--el-text-color-primary);
  margin-bottom: 12px;
}

.gaps-list {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.gap-item {
  display: flex;
  align-items: center;
  padding: 10px 12px;
  background: var(--el-bg-color);
  border-radius: 6px;
  border-left: 3px solid transparent;
  transition: all 0.3s;

  &.is-pending {
    border-left-color: var(--el-text-color-placeholder);
    opacity: 0.7;
  }

  &.is-processing {
    border-left-color: var(--el-color-primary);
    background: var(--el-color-primary-light-9);
  }

  &.is-completed {
    border-left-color: var(--el-color-success);
  }

  &.is-failed {
    border-left-color: var(--el-color-danger);
    background: var(--el-color-danger-light-9);
  }
}

.gap-status-icon {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-right: 12px;
  color: var(--el-text-color-secondary);

  .is-loading {
    animation: rotating 2s linear infinite;
    color: var(--el-color-primary);
  }
}

.gap-info {
  flex: 1;
}

.gap-time-range {
  font-weight: 500;
  font-size: 14px;
  color: var(--el-text-color-primary);
}

.gap-meta {
  display: flex;
  gap: 8px;
  margin-top: 4px;
}

// 日志
.logs-section {
  height: 200px;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  overflow: hidden;
}

.logs-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 12px;
  background: var(--el-fill-color-light);
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.logs-container {
  flex: 1;
  overflow-y: auto;
  padding: 8px 12px;
  font-family: monospace;
  font-size: 12px;
  line-height: 1.6;
  background: var(--el-bg-color);
}

.log-item {
  display: flex;
  gap: 8px;
  padding: 4px 0;
  word-break: break-all;

  &.level-info {
    color: var(--el-text-color-regular);
  }

  &.level-warn {
    color: var(--el-color-warning);
  }

  &.level-error {
    color: var(--el-color-danger);
  }
}

.log-time {
  color: var(--el-text-color-secondary);
  flex-shrink: 0;
}

.log-phase {
  color: var(--el-color-primary);
  flex-shrink: 0;
}

.log-message {
  flex: 1;
}

.logs-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--el-text-color-placeholder);
  gap: 8px;
}

@keyframes rotating {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}
</style>
