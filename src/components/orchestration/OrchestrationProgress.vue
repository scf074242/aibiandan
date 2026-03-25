<template>
  <div class="orchestration-progress">
    <div class="progress-header">
      <div>
        <div class="progress-title">
          <span class="phase-badge">{{ currentPhaseText }}</span>
          <span class="progress-percentage">{{ progressPercentage }}%</span>
        </div>
        <el-progress :percentage="progressPercentage" :status="progressStatus" :stroke-width="14" />
      </div>
      <div class="progress-actions">
        <el-button v-if="canCancel && !isTerminal" type="danger" size="small" @click="$emit('cancel')">取消</el-button>
        <el-button v-else size="small" @click="$emit('reset')">重置</el-button>
      </div>
    </div>

    <div class="progress-stats">
      <el-tag size="small" type="info">总空窗 {{ progress.gapProgress.total }}</el-tag>
      <el-tag size="small" type="warning">待处理 {{ progress.gapProgress.pending }}</el-tag>
      <el-tag size="small" type="primary">处理中 {{ progress.gapProgress.processing }}</el-tag>
      <el-tag size="small" type="success">已完成 {{ progress.gapProgress.completed }}</el-tag>
      <el-tag v-if="progress.gapProgress.failed" size="small" type="danger">失败 {{ progress.gapProgress.failed }}</el-tag>
    </div>

    <div v-if="progress.currentGap" class="current-gap">
      <div>当前空窗：{{ progress.currentGap.startTime }} - {{ progress.currentGap.endTime }}</div>
      <div>{{ progress.currentAction }}</div>
    </div>

    <div class="logs-section">
      <div class="section-title">执行日志</div>
      <div class="logs-container">
        <div v-for="log in progress.recentLogs" :key="log.id" class="log-item" :class="`level-${log.level}`">
          <span class="log-time">{{ formatLogTime(log.timestamp) }}</span>
          <span class="log-message">{{ log.message }}</span>
        </div>
        <div v-if="progress.recentLogs.length === 0" class="logs-empty">暂无日志</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { OrchestrationProgress } from '@/types/orchestration'

interface Props {
  progress: OrchestrationProgress
  canCancel?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  canCancel: false,
})

defineEmits<{
  cancel: []
  reset: []
}>()

const progressPercentage = computed(() => {
  if (props.progress.gapProgress.total === 0) return 0
  return Math.round((props.progress.gapProgress.completed / props.progress.gapProgress.total) * 100)
})

const currentPhaseText = computed(() => {
  const mapping: Record<string, string> = {
    initializing: '初始化',
    planning: '策略规划',
    filling: '空窗填充',
    repairing: '自动修补',
    completed: '已完成',
    failed: '失败',
    cancelled: '已取消',
  }
  return mapping[props.progress.status] ?? props.progress.currentPhase
})

const progressStatus = computed(() => {
  if (props.progress.status === 'completed') return 'success'
  if (props.progress.status === 'failed' || props.progress.status === 'cancelled') return 'exception'
  return ''
})

const isTerminal = computed(() => ['completed', 'failed', 'cancelled'].includes(props.progress.status))

const formatLogTime = (time: string) =>
  new Date(time).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
</script>

<style scoped lang="scss">
.orchestration-progress {
  display: flex;
  flex-direction: column;
  gap: 16px;
  height: 100%;
}

.progress-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
}

.progress-title {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}

.phase-badge {
  display: inline-flex;
  padding: 4px 12px;
  border-radius: 12px;
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
}

.progress-percentage {
  font-size: 18px;
  font-weight: 600;
}

.progress-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.current-gap,
.logs-section {
  padding: 12px;
  border-radius: 8px;
  background: var(--el-fill-color-light);
}

.logs-container {
  max-height: 180px;
  overflow-y: auto;
}

.log-item {
  display: flex;
  gap: 8px;
  font-size: 12px;
  line-height: 1.6;
}

.log-item.level-error {
  color: var(--el-color-danger);
}

.log-item.level-warn {
  color: var(--el-color-warning);
}

.logs-empty {
  color: var(--el-text-color-placeholder);
}
</style>
