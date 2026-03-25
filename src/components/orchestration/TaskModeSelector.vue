<template>
  <div class="task-mode-selector">
    <div class="selector-header">
      <h3 class="selector-title">
        <el-icon><Guide /></el-icon>
        选择任务模式
      </h3>
      <p class="selector-desc">根据当前节目单状态，选择适合的 AI 编排任务类型</p>
    </div>

    <div class="mode-options">
      <div
        v-for="mode in modeOptions"
        :key="mode.mode"
        class="mode-card"
        :class="{
          'is-selected': selectedMode === mode.mode,
          'is-recommended': mode.recommended,
          'is-disabled': mode.disabled
        }"
        @click="!mode.disabled && selectMode(mode.mode)"
      >
        <div class="mode-badge" v-if="mode.recommended">
          <el-tag size="small" type="success" effect="dark">推荐</el-tag>
        </div>
        <div class="mode-icon">
          <el-icon :size="32">
            <component :is="mode.icon" />
          </el-icon>
        </div>
        <div class="mode-content">
          <div class="mode-name">{{ mode.label }}</div>
          <div class="mode-description">{{ mode.description }}</div>
          <div class="mode-conditions">
            <el-tag
              v-for="condition in mode.conditions"
              :key="condition"
              size="small"
              :type="getConditionTagType(condition)"
              class="condition-tag"
            >
              {{ condition }}
            </el-tag>
          </div>
        </div>
        <div class="mode-check" v-if="selectedMode === mode.mode">
          <el-icon><Check /></el-icon>
        </div>
      </div>
    </div>

    <div v-if="selectedMode" class="selected-info">
      <el-alert
        :title="`已选择：${selectedModeLabel}`"
        :type="selectedModeInfo?.recommended ? 'success' : 'info'"
        :description="selectedModeInfo?.detailDescription"
        show-icon
        :closable="false"
      />
    </div>

    <div class="mode-intent-input" v-if="showIntentInput">
      <el-input
        v-model="userIntent"
        type="textarea"
        :rows="3"
        :placeholder="intentPlaceholder"
        @input="emitIntentChange"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { TaskMode } from '@/types/orchestration'
import {
  Guide,
  Check,
  MagicStick,
  Plus,
  EditPen,
  Search,
  Tools,
  QuestionFilled
} from '@element-plus/icons-vue'

interface ModeOption {
  mode: TaskMode
  label: string
  description: string
  detailDescription: string
  icon: any
  conditions: string[]
  recommended?: boolean
  disabled?: boolean
  requiresIntent?: boolean
  intentPlaceholder?: string
}

interface Props {
  modelValue?: TaskMode
  scheduleState?: {
    isEmpty: boolean
    itemCount: number
    gapCount: number
  }
}

const props = withDefaults(defineProps<Props>(), {
  modelValue: undefined,
  scheduleState: () => ({
    isEmpty: true,
    itemCount: 0,
    gapCount: 0
  })
})

const emit = defineEmits<{
  'update:modelValue': [mode: TaskMode]
  'intent-change': [intent: string]
}>()

const selectedMode = ref<TaskMode | undefined>(props.modelValue)
const userIntent = ref('')

// 监听外部值变化
watch(() => props.modelValue, (newVal) => {
  selectedMode.value = newVal
})

// 模式选项配置
const modeOptions = computed<ModeOption[]>(() => {
  const { isEmpty, itemCount, gapCount } = props.scheduleState

  return [
    {
      mode: 'full_generate',
      label: '完整生成',
      description: '从零开始生成完整编排单',
      detailDescription: 'AI 将基于版面参考和历史数据，自动生成一整天的节目编排。适用于新建节目单或完全重新编排的场景。',
      icon: MagicStick,
      conditions: ['空节目单', '完全重新编排'],
      recommended: isEmpty,
      disabled: !isEmpty && itemCount > 5,
      requiresIntent: false
    },
    {
      mode: 'partial_generate',
      label: '局部补排',
      description: '自动填充当前空窗时段',
      detailDescription: 'AI 将识别节目单中的空窗时段，并自动选择合适的节目进行填充。适用于部分时段需要补排的场景。',
      icon: Plus,
      conditions: ['存在空窗', '部分填充'],
      recommended: !isEmpty && gapCount > 0,
      disabled: gapCount === 0,
      requiresIntent: false
    },
    {
      mode: 'micro_edit',
      label: '局部微调',
      description: '对指定条目进行增删改',
      detailDescription: '通过自然语言指令，对节目单进行精确的局部调整。例如："在新闻联播后插入天气预报"、"删除第5个节目"等。',
      icon: EditPen,
      conditions: ['精确调整', '自然语言'],
      recommended: !isEmpty && itemCount > 0,
      disabled: isEmpty,
      requiresIntent: true,
      intentPlaceholder: '请输入您的调整指令，例如：\n- 在新闻联播后插入天气预报\n- 将第3个节目时长调整为30分钟\n- 删除所有广告时段'
    },
    {
      mode: 'validate_only',
      label: '仅校验',
      description: '检查节目单是否存在问题',
      detailDescription: 'AI 将对当前节目单进行全面检查，识别时间空缺、重叠、素材缺失等问题，并生成校验报告。',
      icon: Search,
      conditions: ['质量检查', '问题识别'],
      recommended: false,
      disabled: isEmpty,
      requiresIntent: false
    },
    {
      mode: 'repair_only',
      label: '仅修复',
      description: '自动修复已知问题',
      detailDescription: 'AI 将尝试自动修复节目单中已识别的问题，如调整时间、替换素材、填补空缺等。',
      icon: Tools,
      conditions: ['自动修复', '问题处理'],
      recommended: false,
      disabled: isEmpty,
      requiresIntent: false
    },
    {
      mode: 'clarify',
      label: '智能澄清',
      description: '描述需求，AI 推荐最佳方案',
      detailDescription: '用自然语言描述您的编排需求，AI 将分析并推荐最适合的任务模式和执行策略。',
      icon: QuestionFilled,
      conditions: ['需求描述', '智能推荐'],
      recommended: false,
      disabled: false,
      requiresIntent: true,
      intentPlaceholder: '请描述您的编排需求，例如：\n- 今天晚间黄金时段需要安排高收视率节目\n- 帮我优化一下节目单的流畅度\n- 在保持现有框架的基础上填充空缺'
    }
  ]
})

// 选中的模式信息
const selectedModeInfo = computed(() => {
  return modeOptions.value.find(m => m.mode === selectedMode.value)
})

const selectedModeLabel = computed(() => {
  return selectedModeInfo.value?.label || ''
})

const showIntentInput = computed(() => {
  return selectedModeInfo.value?.requiresIntent || false
})

const intentPlaceholder = computed(() => {
  return selectedModeInfo.value?.intentPlaceholder || '请输入您的需求...'
})

// 方法
const selectMode = (mode: TaskMode) => {
  selectedMode.value = mode
  emit('update:modelValue', mode)
  userIntent.value = ''
}

const emitIntentChange = () => {
  emit('intent-change', userIntent.value)
}

const getConditionTagType = (condition: string): 'success' | 'warning' | 'info' => {
  if (condition.includes('空') || condition.includes('零')) return 'warning'
  if (condition.includes('语言') || condition.includes('精确')) return 'success'
  return 'info'
}
</script>

<style scoped lang="scss">
.task-mode-selector {
  padding: 20px;
  background: var(--el-bg-color);
  border-radius: 8px;
}

.selector-header {
  margin-bottom: 20px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.selector-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 18px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  margin: 0 0 8px 0;
}

.selector-desc {
  font-size: 14px;
  color: var(--el-text-color-secondary);
  margin: 0;
}

.mode-options {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
  margin-bottom: 20px;
}

.mode-card {
  position: relative;
  display: flex;
  align-items: flex-start;
  padding: 16px;
  background: var(--el-fill-color-light);
  border-radius: 8px;
  border: 2px solid transparent;
  cursor: pointer;
  transition: all 0.3s;

  &:hover:not(.is-disabled) {
    background: var(--el-fill-color);
    border-color: var(--el-color-primary-light-5);
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  }

  &.is-selected {
    background: var(--el-color-primary-light-9);
    border-color: var(--el-color-primary);
  }

  &.is-recommended {
    &::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 3px;
      background: linear-gradient(90deg, var(--el-color-success), var(--el-color-success-light-3));
      border-radius: 8px 8px 0 0;
    }
  }

  &.is-disabled {
    opacity: 0.5;
    cursor: not-allowed;
    background: var(--el-fill-color-light);

    &:hover {
      transform: none;
      box-shadow: none;
      border-color: transparent;
    }
  }
}

.mode-badge {
  position: absolute;
  top: 8px;
  right: 8px;
}

.mode-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  margin-right: 12px;
  background: var(--el-bg-color);
  border-radius: 10px;
  color: var(--el-color-primary);
  flex-shrink: 0;

  .is-selected & {
    background: var(--el-color-primary);
    color: white;
  }
}

.mode-content {
  flex: 1;
  min-width: 0;
}

.mode-name {
  font-size: 16px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  margin-bottom: 4px;
}

.mode-description {
  font-size: 13px;
  color: var(--el-text-color-secondary);
  margin-bottom: 8px;
  line-height: 1.4;
}

.mode-conditions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.condition-tag {
  font-size: 11px;
}

.mode-check {
  position: absolute;
  bottom: 12px;
  right: 12px;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--el-color-primary);
  color: white;
  border-radius: 50%;
}

.selected-info {
  margin-bottom: 16px;
}

.mode-intent-input {
  :deep(.el-textarea__inner) {
    font-size: 14px;
    line-height: 1.6;
  }
}

// 响应式适配
@media (max-width: 768px) {
  .mode-options {
    grid-template-columns: 1fr;
  }
}
</style>
