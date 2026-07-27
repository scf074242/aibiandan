<template>
  <section class="react-approval" aria-live="polite">
    <div class="react-approval__body">
      <div class="react-approval__title">等待确认</div>
      <div class="react-approval__summary">{{ approval.summary }}</div>
      <div class="react-approval__note">
        {{ current
          ? '确认后从已保存的检查点继续，写入前会再次校验当前播单。'
          : '当前播单或工作区已经变化，这条操作已失效。' }}
      </div>
    </div>
    <div class="react-approval__actions">
      <el-button
        type="primary"
        size="small"
        :loading="busy"
        :disabled="!current || busy"
        @click="$emit('confirm')"
      >
        确认执行
      </el-button>
      <el-button size="small" :disabled="!current || busy" @click="$emit('cancel')">
        取消
      </el-button>
    </div>
  </section>
</template>

<script setup lang="ts">
import type { BroadcastPlanReactApproval } from '../useBroadcastPlanOrchestration'

defineProps<{
  approval: BroadcastPlanReactApproval
  current: boolean
  busy: boolean
}>()

defineEmits<{
  confirm: []
  cancel: []
}>()
</script>

<style scoped>
.react-approval {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid #e5e7eb;
  background: #fff7ed;
}

.react-approval__body {
  min-width: 0;
  flex: 1;
}

.react-approval__title {
  color: #9a3412;
  font-size: 13px;
  font-weight: 600;
}

.react-approval__summary,
.react-approval__note {
  margin-top: 3px;
  overflow-wrap: anywhere;
  color: #374151;
  font-size: 12px;
  line-height: 1.45;
}

.react-approval__note {
  color: #6b7280;
}

.react-approval__actions {
  display: flex;
  flex: 0 0 auto;
}

@media (max-width: 720px) {
  .react-approval {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
