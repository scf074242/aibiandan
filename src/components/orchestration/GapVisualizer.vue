<template>
  <div class="gap-visualizer">
    <div class="visualizer-header">
      <h3 class="visualizer-title">
        <el-icon><Timer /></el-icon>
        空窗时间轴
      </h3>
      <div class="visualizer-stats">
        <el-tag size="small" type="info">总空窗 {{ gaps.length }}</el-tag>
        <el-tag size="small" type="warning">待处理 {{ pendingCount }}</el-tag>
        <el-tag size="small" type="success">已完成 {{ completedCount }}</el-tag>
      </div>
    </div>

    <div class="timeline-container">
      <div class="timeline-scale">
        <div
          v-for="hour in timeScaleHours"
          :key="hour"
          class="scale-mark"
          :style="{ left: `${getHourPosition(hour)}%` }"
        >
          <span class="scale-label">{{ formatHour(hour) }}</span>
          <div class="scale-line"></div>
        </div>
      </div>

      <div class="timeline-track">
        <div
          v-for="item in scheduleItems"
          :key="item.id"
          class="timeline-item"
          :class="getItemClass(item)"
          :style="getItemStyle(item)"
          @click="$emit('item-click', item)"
        >
          <div class="item-content">
            <span class="item-name">{{ item.programName || item.instanceName || '未命名' }}</span>
            <span class="item-time">{{ formatTimeRange(item.startTime, item.endTime) }}</span>
          </div>
        </div>

        <div
          v-for="gap in displayGaps"
          :key="gap.id"
          class="timeline-gap"
          :class="getGapClass(gap)"
          :style="getGapStyle(gap)"
          @click="!gap.disabled && $emit('gap-click', gap)"
        >
          <div class="gap-content">
            <el-icon v-if="gap.status === 'processing'" class="gap-icon is-loading"><Loading /></el-icon>
            <el-icon v-else-if="gap.status === 'completed'" class="gap-icon"><CircleCheck /></el-icon>
            <el-icon v-else-if="gap.status === 'failed'" class="gap-icon"><CircleClose /></el-icon>
            <el-icon v-else class="gap-icon"><Plus /></el-icon>
            <span class="gap-label">{{ getGapLabel(gap) }}</span>
            <span class="gap-duration">{{ formatDuration(gap.duration) }}</span>
          </div>
          <div v-if="gap.status === 'processing'" class="gap-progress-bar">
            <div class="progress-fill" :style="{ width: `${gap.progress || 0}%` }"></div>
          </div>
        </div>
      </div>
    </div>

    <div class="timeline-legend">
      <div class="legend-item">
        <div class="legend-color is-program"></div>
        <span>节目</span>
      </div>
      <div class="legend-item">
        <div class="legend-color is-ad"></div>
        <span>广告</span>
      </div>
      <div class="legend-item">
        <div class="legend-color is-live"></div>
        <span>直播</span>
      </div>
      <div class="legend-item">
        <div class="legend-color is-gap-pending"></div>
        <span>待处理空窗</span>
      </div>
      <div class="legend-item">
        <div class="legend-color is-gap-processing"></div>
        <span>处理中</span>
      </div>
      <div class="legend-item">
        <div class="legend-color is-gap-completed"></div>
        <span>已填充</span>
      </div>
    </div>

    <div class="gap-list-section">
      <div class="section-title">空窗列表</div>
      <div class="gap-list">
        <div
          v-for="gap in gaps"
          :key="gap.id"
          class="gap-list-item"
          :class="getGapListItemClass(gap)"
          @click="$emit('gap-click', gap)"
        >
          <div class="gap-status">
            <el-icon v-if="gap.status === 'pending'"><Timer /></el-icon>
            <el-icon v-else-if="gap.status === 'processing'" class="is-loading"><Loading /></el-icon>
            <el-icon v-else-if="gap.status === 'completed'"><CircleCheck /></el-icon>
            <el-icon v-else-if="gap.status === 'failed'"><CircleClose /></el-icon>
          </div>
          <div class="gap-info">
            <div class="gap-time">{{ formatTime(gap.startTime) }} - {{ formatTime(gap.endTime) }}</div>
            <div class="gap-meta">
              <el-tag size="small" type="info">{{ formatDuration(gap.duration) }}</el-tag>
              <el-tag v-if="gap.constraints?.allowedTypes?.length" size="small" type="warning">
                {{ gap.constraints.allowedTypes.join(', ') }}
              </el-tag>
            </div>
          </div>
          <div class="gap-actions">
            <el-button
              v-if="gap.status === 'pending'"
              type="primary"
              size="small"
              @click.stop="$emit('gap-fill', gap)"
            >
              AI 填充
            </el-button>
            <el-tag v-else-if="gap.status === 'completed'" type="success" size="small">已完成</el-tag>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { GapInfo } from '@/types/orchestration'
import type { ScheduleItem } from '@/views/broadcast-plan/scheduleData'
import { Timer, Loading, CircleCheck, CircleClose, Plus } from '@element-plus/icons-vue'

interface DisplayGap extends GapInfo {
  status?: 'pending' | 'processing' | 'completed' | 'failed'
  progress?: number
  disabled?: boolean
}

interface Props {
  gaps: DisplayGap[]
  scheduleItems?: ScheduleItem[]
  startHour?: number
  endHour?: number
  currentDate?: string
}

const props = withDefaults(defineProps<Props>(), {
  scheduleItems: () => [],
  startHour: 6,
  endHour: 24,
  currentDate: () => '2026-03-25',
})

defineEmits<{
  'gap-click': [gap: DisplayGap]
  'gap-fill': [gap: DisplayGap]
  'item-click': [item: ScheduleItem]
}>()

const timeScaleHours = computed(() => {
  const hours: number[] = []
  for (let h = props.startHour; h <= props.endHour; h++) {
    hours.push(h)
  }
  return hours
})

const totalDuration = computed(() => (props.endHour - props.startHour) * 3600)
const pendingCount = computed(() => props.gaps.filter((g) => g.status === 'pending' || !g.status).length)
const completedCount = computed(() => props.gaps.filter((g) => g.status === 'completed').length)

const displayGaps = computed(() =>
  props.gaps.map((gap) => ({
    ...gap,
    status: gap.status || 'pending',
  })),
)

const getHourPosition = (hour: number) => {
  const offset = (hour - props.startHour) * 3600
  return (offset / totalDuration.value) * 100
}

const getItemStyle = (item: ScheduleItem) => {
  const startSeconds = timeToSeconds(item.startTime)
  const endSeconds = timeToSeconds(item.endTime)
  const startOffset = startSeconds - props.startHour * 3600
  const duration = endSeconds - startSeconds

  const left = (startOffset / totalDuration.value) * 100
  const width = (duration / totalDuration.value) * 100

  return {
    left: `${Math.max(0, left)}%`,
    width: `${Math.max(0.5, width)}%`,
  }
}

const getGapStyle = (gap: DisplayGap) => {
  const dayStart = new Date(`${props.currentDate}T00:00:00`).getTime() / 1000
  const startSeconds = new Date(gap.startTime).getTime() / 1000 - dayStart
  const endSeconds = new Date(gap.endTime).getTime() / 1000 - dayStart
  const startOffset = startSeconds - props.startHour * 3600
  const duration = endSeconds - startSeconds

  const left = (startOffset / totalDuration.value) * 100
  const width = (duration / totalDuration.value) * 100

  return {
    left: `${Math.max(0, left)}%`,
    width: `${Math.max(2, width)}%`,
  }
}

const getItemClass = (item: ScheduleItem) => ({
  'is-program': item.businessType === 'program',
  'is-ad': item.businessType === 'ad',
  'is-live': item.sourceType === 'live',
  'is-reference': item.isReference,
})

const getGapClass = (gap: DisplayGap) => ({
  'is-pending': gap.status === 'pending',
  'is-processing': gap.status === 'processing',
  'is-completed': gap.status === 'completed',
  'is-failed': gap.status === 'failed',
  'is-disabled': gap.disabled,
})

const getGapListItemClass = (gap: DisplayGap) => ({
  'is-pending': gap.status === 'pending' || !gap.status,
  'is-processing': gap.status === 'processing',
  'is-completed': gap.status === 'completed',
  'is-failed': gap.status === 'failed',
})

const getGapLabel = (gap: DisplayGap) => {
  switch (gap.status) {
    case 'processing':
      return '填充中'
    case 'completed':
      return '已填充'
    case 'failed':
      return '失败'
    default:
      return '点击填充'
  }
}

const formatHour = (hour: number) => `${String(hour).padStart(2, '0')}:00`

const formatTime = (time: string) => {
  if (!time) return '--:--'
  const date = new Date(time)
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

const formatTimeRange = (start: string, end: string) => `${formatTime(start)}-${formatTime(end)}`

const formatDuration = (seconds: number) => {
  if (!seconds || seconds <= 0) return '0分钟'
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (hours > 0) {
    return `${hours}小时${minutes}分钟`
  }
  return `${minutes}分钟`
}

const timeToSeconds = (time: string) => {
  const [hours = 0, minutes = 0, seconds = 0] = time.split(':').map(Number)
  return hours * 3600 + minutes * 60 + seconds
}
</script>

<style scoped lang="scss">
.gap-visualizer {
  padding: 16px;
  background: var(--el-bg-color);
  border-radius: 8px;
}

.visualizer-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.visualizer-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 16px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  margin: 0;
}

.visualizer-stats {
  display: flex;
  gap: 8px;
}

.timeline-container {
  position: relative;
  padding: 40px 0 20px;
  margin-bottom: 16px;
}

.timeline-scale {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 30px;
}

.scale-mark {
  position: absolute;
  top: 0;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  align-items: center;
}

.scale-label {
  font-size: 11px;
  color: var(--el-text-color-secondary);
  margin-bottom: 4px;
}

.scale-line {
  width: 1px;
  height: 8px;
  background: var(--el-border-color);
}

.timeline-track {
  position: relative;
  height: 80px;
  background: var(--el-fill-color-light);
  border-radius: 8px;
  overflow: hidden;
}

.timeline-item {
  position: absolute;
  top: 8px;
  height: 64px;
  background: var(--el-color-primary);
  border-radius: 4px;
  padding: 4px 8px;
  cursor: pointer;
  transition: all 0.3s;
  overflow: hidden;
  display: flex;
  align-items: center;

  &:hover {
    transform: translateY(-2px);
    box-shadow: 0 4px 8px rgba(0, 0, 0, 0.15);
    z-index: 10;
  }

  &.is-program {
    background: linear-gradient(135deg, #409eff 0%, #79bbff 100%);
  }

  &.is-ad {
    background: linear-gradient(135deg, #e6a23c 0%, #eebe77 100%);
  }

  &.is-live {
    background: linear-gradient(135deg, #f56c6c 0%, #f89898 100%);
  }

  &.is-reference {
    background: linear-gradient(135deg, #909399 0%, #b1b3b8 100%);
    opacity: 0.7;
  }

  .item-content {
    display: flex;
    flex-direction: column;
    min-width: 0;
    color: white;
  }

  .item-name {
    font-size: 12px;
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .item-time {
    font-size: 10px;
    opacity: 0.9;
    margin-top: 2px;
  }
}

.timeline-gap {
  position: absolute;
  top: 8px;
  height: 64px;
  border-radius: 4px;
  padding: 4px;
  cursor: pointer;
  transition: all 0.3s;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  border: 2px dashed;

  &:hover:not(.is-disabled) {
    transform: scale(1.02);
    z-index: 10;
  }

  &.is-pending {
    background: var(--el-color-warning-light-9);
    border-color: var(--el-color-warning);
    color: var(--el-color-warning);
  }

  &.is-processing {
    background: var(--el-color-primary-light-9);
    border-color: var(--el-color-primary);
    color: var(--el-color-primary);
  }

  &.is-completed {
    background: var(--el-color-success-light-9);
    border-color: var(--el-color-success);
    color: var(--el-color-success);
  }

  &.is-failed {
    background: var(--el-color-danger-light-9);
    border-color: var(--el-color-danger);
    color: var(--el-color-danger);
  }

  &.is-disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .gap-content {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
  }

  .gap-icon {
    font-size: 16px;

    &.is-loading {
      animation: rotating 2s linear infinite;
    }
  }

  .gap-label {
    font-size: 10px;
    font-weight: 500;
    white-space: nowrap;
  }

  .gap-duration {
    font-size: 9px;
    opacity: 0.8;
  }
}

.gap-progress-bar {
  position: absolute;
  bottom: 4px;
  left: 4px;
  right: 4px;
  height: 3px;
  background: rgba(0, 0, 0, 0.1);
  border-radius: 2px;
  overflow: hidden;

  .progress-fill {
    height: 100%;
    background: currentColor;
    transition: width 0.3s;
  }
}

.timeline-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  padding: 12px;
  background: var(--el-fill-color-light);
  border-radius: 6px;
  margin-bottom: 16px;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.legend-color {
  width: 16px;
  height: 16px;
  border-radius: 3px;

  &.is-program {
    background: linear-gradient(135deg, #409eff 0%, #79bbff 100%);
  }

  &.is-ad {
    background: linear-gradient(135deg, #e6a23c 0%, #eebe77 100%);
  }

  &.is-live {
    background: linear-gradient(135deg, #f56c6c 0%, #f89898 100%);
  }

  &.is-gap-pending {
    background: var(--el-color-warning-light-9);
    border: 2px dashed var(--el-color-warning);
  }

  &.is-gap-processing {
    background: var(--el-color-primary-light-9);
    border: 2px dashed var(--el-color-primary);
  }

  &.is-gap-completed {
    background: var(--el-color-success-light-9);
    border: 2px dashed var(--el-color-success);
  }
}

.gap-list-section {
  border-top: 1px solid var(--el-border-color-lighter);
  padding-top: 16px;
}

.section-title {
  font-size: 14px;
  font-weight: 500;
  color: var(--el-text-color-primary);
  margin-bottom: 12px;
}

.gap-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 200px;
  overflow-y: auto;
}

.gap-list-item {
  display: flex;
  align-items: center;
  padding: 10px 12px;
  background: var(--el-fill-color-light);
  border-radius: 6px;
  border-left: 3px solid transparent;
  cursor: pointer;
  transition: all 0.3s;

  &:hover {
    background: var(--el-fill-color);
  }

  &.is-pending {
    border-left-color: var(--el-color-warning);
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
  }
}

.gap-status {
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

.gap-time {
  font-weight: 500;
  font-size: 14px;
  color: var(--el-text-color-primary);
}

.gap-meta {
  display: flex;
  gap: 8px;
  margin-top: 4px;
}

.gap-actions {
  flex-shrink: 0;
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
