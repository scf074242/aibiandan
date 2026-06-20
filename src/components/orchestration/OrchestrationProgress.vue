<template>
  <div class="orchestration-progress">
    <div class="progress-hero">
      <div class="progress-header">
        <div class="progress-overview">
          <div class="progress-title">
            <span class="phase-badge">{{ currentPhaseText }}</span>
            <span class="progress-percentage">{{ progressPercentage }}%</span>
          </div>
          <p class="progress-subtitle">{{ currentActionText }}</p>
        </div>
        <div class="progress-actions">
          <el-button v-if="canCancel && !isTerminal" type="danger" size="small" @click="$emit('cancel')">
            取消
          </el-button>
          <el-button v-else size="small" @click="$emit('reset')">重置</el-button>
        </div>
      </div>

      <el-progress :percentage="progressPercentage" :status="progressStatus" :stroke-width="14" />
    </div>

    <div class="progress-stats">
      <div class="stat-pill">
        <span class="stat-label">总空窗</span>
        <strong>{{ progress.gapProgress.total }}</strong>
      </div>
      <div class="stat-pill">
        <span class="stat-label">待处理</span>
        <strong>{{ progress.gapProgress.pending }}</strong>
      </div>
      <div class="stat-pill">
        <span class="stat-label">处理中</span>
        <strong>{{ progress.gapProgress.processing }}</strong>
      </div>
      <div class="stat-pill is-success">
        <span class="stat-label">已完成</span>
        <strong>{{ progress.gapProgress.completed }}</strong>
      </div>
      <div v-if="progress.gapProgress.failed" class="stat-pill is-danger">
        <span class="stat-label">失败</span>
        <strong>{{ progress.gapProgress.failed }}</strong>
      </div>
    </div>

    <div v-if="progress.currentGap" class="current-gap">
      <div class="current-gap-label">当前处理空窗</div>
      <div class="current-gap-range">{{ progress.currentGap.startTime }} - {{ progress.currentGap.endTime }}</div>
      <div class="current-gap-action">{{ progress.currentAction }}</div>
    </div>

    <div class="logs-section">
      <div class="section-title">执行日志</div>
      <div class="logs-container">
        <div v-for="log in progress.recentLogs" :key="log.id" class="log-item" :class="`level-${log.level}`">
          <span class="log-time">{{ formatLogTime(log.timestamp) }}</span>
          <span class="log-message">{{ log.message }}</span>
        </div>
        <div v-if="progress.recentLogs.length === 0" class="logs-empty">暂时没有日志</div>
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

const currentActionText = computed(() => {
  if (props.progress.currentAction) return props.progress.currentAction
  if (props.progress.status === 'completed') return '本轮编排已经完成。'
  if (props.progress.status === 'cancelled') return '本轮编排已中止，当前结果已保留。'
  if (props.progress.status === 'failed') return '编排过程中出现异常，请查看日志。'
  return '正在准备编排动作。'
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
  color: #1f2937;
}

.progress-hero {
  padding: 16px 18px;
  border-radius: 18px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.96), rgba(238, 242, 255, 0.92));
  border: 1px solid var(--app-line);
}

.progress-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
  margin-bottom: 14px;
}

.progress-overview {
  min-width: 0;
}

.progress-title {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 8px;
}

.phase-badge {
  display: inline-flex;
  align-items: center;
  min-height: 30px;
  padding: 0 12px;
  border-radius: 999px;
  background: rgba(100, 108, 255, 0.12);
  color: var(--app-accent-deep);
  font-size: 12px;
  font-weight: 700;
}

.progress-percentage {
  font-size: 24px;
  line-height: 1;
  font-weight: 700;
  color: #111827;
}

.progress-subtitle {
  margin: 0;
  color: var(--app-text-soft);
  line-height: 1.6;
}

.progress-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.stat-pill {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 38px;
  padding: 0 14px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.94);
  border: 1px solid var(--app-line);
}

.stat-pill strong {
  font-size: 16px;
  color: #111827;
}

.stat-label {
  color: var(--app-text-muted);
  font-size: 12px;
  font-weight: 600;
}

.stat-pill.is-success {
  background: rgba(238, 242, 255, 0.96);
  border-color: rgba(100, 108, 255, 0.18);
}

.stat-pill.is-danger {
  background: rgba(254, 242, 242, 0.96);
  border-color: rgba(239, 68, 68, 0.16);
}

.current-gap,
.logs-section {
  padding: 14px 16px;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.8);
  border: 1px solid var(--app-line);
}

.current-gap {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 16px;
  align-items: center;
}

.current-gap-label {
  color: var(--app-text-muted);
  font-size: 12px;
  font-weight: 700;
}

.current-gap-range {
  font-size: 18px;
  font-weight: 700;
  color: var(--app-accent-deep);
}

.current-gap-action {
  color: var(--app-text-soft);
}

.section-title {
  margin-bottom: 10px;
  font-size: 13px;
  font-weight: 700;
  color: var(--app-accent-deep);
}

.logs-container {
  max-height: 200px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.log-item {
  display: grid;
  grid-template-columns: 72px 1fr;
  gap: 10px;
  font-size: 12px;
  line-height: 1.6;
  padding: 10px 12px;
  border-radius: 12px;
  background: rgba(248, 249, 255, 0.92);
}

.log-time {
  color: var(--app-text-muted);
  font-variant-numeric: tabular-nums;
}

.log-message {
  color: #334155;
  word-break: break-word;
}

.log-item.level-error {
  background: rgba(254, 242, 242, 0.96);
}

.log-item.level-error .log-message {
  color: #b91c1c;
}

.log-item.level-warn {
  background: rgba(238, 242, 255, 0.96);
}

.log-item.level-warn .log-message {
  color: var(--app-accent-deep);
}

.logs-empty {
  color: #94a3b8;
  font-size: 12px;
}

@media (max-width: 768px) {
  .progress-header {
    flex-direction: column;
  }

  .log-item {
    grid-template-columns: 1fr;
    gap: 4px;
  }
}
</style>
