<template>
  <div class="broadcast-plan-sidebar">
    <div class="sidebar-header">
      <h3>播出单概览</h3>
      <el-button link @click="$emit('close')">
        <el-icon><Close /></el-icon>
      </el-button>
    </div>
    
    <div class="sidebar-content">
      <div class="stats-section">
        <div class="stat-item">
          <span class="stat-label">节目数量</span>
          <span class="stat-value">{{ itemCount }}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">总时长</span>
          <span class="stat-value">{{ totalDuration }}</span>
        </div>
      </div>
      
      <div class="info-section">
        <h4>基本信息</h4>
        <div class="info-row">
          <span class="info-label">频道</span>
          <span class="info-value">{{ channelName }}</span>
        </div>
        <div class="info-row">
          <span class="info-label">日期</span>
          <span class="info-value">{{ date }}</span>
        </div>
      </div>
      
      <div class="quick-actions">
        <h4>快捷操作</h4>
        <el-button type="primary" :icon="Plus" @click="$emit('add')">
          添加节目
        </el-button>
        <el-button :icon="Document" @click="$emit('import')">
          从计划导入
        </el-button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Plus, Document, Close } from '@element-plus/icons-vue'

interface Props {
  itemCount?: number
  totalDuration?: string
  channelName?: string
  date?: string
}

withDefaults(defineProps<Props>(), {
  itemCount: 0,
  totalDuration: '0:00',
  channelName: '-',
  date: '-',
})

defineEmits<{
  close: []
  add: []
  import: []
}>()
</script>

<style scoped lang="scss">
.broadcast-plan-sidebar {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--el-bg-color);
}

.sidebar-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px;
  border-bottom: 1px solid var(--el-border-color-lighter);
  
  h3 {
    margin: 0;
    font-size: 16px;
  }
}

.sidebar-content {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}

.stats-section {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin-bottom: 24px;
}

.stat-item {
  display: flex;
  flex-direction: column;
  padding: 12px;
  background: var(--el-fill-color-light);
  border-radius: 8px;
  
  .stat-label {
    font-size: 12px;
    color: var(--el-text-color-secondary);
    margin-bottom: 4px;
  }
  
  .stat-value {
    font-size: 20px;
    font-weight: 600;
    color: var(--el-text-color-primary);
  }
}

.info-section,
.quick-actions {
  margin-bottom: 24px;
  
  h4 {
    margin: 0 0 12px 0;
    font-size: 14px;
    color: var(--el-text-color-regular);
  }
}

.info-row {
  display: flex;
  justify-content: space-between;
  padding: 8px 0;
  border-bottom: 1px solid var(--el-border-color-lighter);
  
  .info-label {
    color: var(--el-text-color-secondary);
  }
  
  .info-value {
    color: var(--el-text-color-primary);
    font-weight: 500;
  }
}

.quick-actions {
  .el-button {
    width: 100%;
    margin-bottom: 8px;
  }
}
</style>
