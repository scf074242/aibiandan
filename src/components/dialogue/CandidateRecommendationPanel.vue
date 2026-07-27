<template>
  <!--
    候选推荐结构化 panel（方向 1 D4 抽取）。
    统一承接两种待选择场景：
    - mode="target_selection"：delete / move / replace 选目标节目，沿用 el-radio-group
    - mode="insert_recommendation"：insert / replace 选候选节目，结构化 card 列表
    组件只负责展示与交互，格式化能力通过 props 回调注入，避免反向依赖 ChatPanel 内部 helper。
  -->
  <div class="pending-command-panel candidate-recommendation-panel" :class="panelClass">
    <div class="pending-command-header">
      <div>
        <div class="pending-command-title">{{ title }}</div>
        <div class="pending-command-summary">{{ summary }}</div>
      </div>
      <el-tag v-if="tagLabel" :type="tagType" effect="light">{{ tagLabel }}</el-tag>
    </div>

    <div class="pending-command-body">
      <div v-if="reasoning" class="pending-command-reasoning">{{ reasoning }}</div>
      <div
        v-if="detailItems && detailItems.length > 0"
        class="details-summary-list is-panel pending-agent-context-list"
      >
        <div
          v-for="item in detailItems"
          :key="`${item.label}-${item.value}`"
          class="detail-summary-item"
        >
          <span class="detail-summary-label">{{ item.label }}</span>
          <span class="detail-summary-value">{{ item.value }}</span>
        </div>
      </div>

      <!-- 目标选择模式：el-radio-group（保持原行为，避免破坏 a11y） -->
      <el-radio-group
        v-if="mode === 'target_selection'"
        :model-value="selectedId"
        class="target-selection-list"
        @update:model-value="onSelect"
      >
        <el-radio
          v-for="candidate in candidates"
          :key="candidate.id"
          :value="candidate.id"
          class="target-selection-option"
        >
          {{ formatTargetCandidateLabel(candidate) }}
        </el-radio>
      </el-radio-group>

      <!-- 候选推荐模式：结构化 card 列表 -->
      <div
        v-else
        class="target-selection-list insert-recommendation-list"
        role="radiogroup"
        :aria-label="listAriaLabel"
      >
        <button
          v-for="(candidate, index) in candidates"
          :key="candidate.id"
          type="button"
          class="insert-recommendation-option"
          :class="{ 'is-selected': isSelected(candidate) }"
          role="radio"
          :aria-checked="isSelected(candidate)"
          @click="onSelect(candidate.id)"
        >
          <span class="insert-recommendation-selector" aria-hidden="true">
            <span class="insert-recommendation-selector-dot" />
          </span>
          <span class="insert-recommendation-card">
            <span class="insert-recommendation-head">
              <span class="insert-recommendation-name-line">
                <span class="insert-recommendation-name">{{ candidate.programName || candidate.programCode || candidate.id }}</span>
                <span class="insert-recommendation-chip">{{ getBadgeLabel(index) }}</span>
              </span>
              <span class="insert-recommendation-confidence">{{ getStrengthLabel(index) }}</span>
            </span>
            <span class="insert-recommendation-meta">{{ formatCandidateMeta(candidate, index) }}</span>
            <span
              v-if="candidate.reasonTags && candidate.reasonTags.length > 0"
              class="reason-tag-row insert-recommendation-tags"
            >
              <span
                v-for="tag in candidate.reasonTags"
                :key="`${candidate.id}-${tag}`"
                class="reason-tag"
              >
                {{ tag }}
              </span>
            </span>
          </span>
        </button>
        <div v-if="footerNote" class="insert-recommendation-footer-note">{{ footerNote }}</div>
      </div>
    </div>

    <div
      class="pending-command-actions"
      :class="{ 'insert-recommendation-actions': mode === 'insert_recommendation' }"
    >
      <div v-if="actionHint" class="insert-recommendation-action-hint">{{ actionHint }}</div>
      <div :class="{ 'insert-recommendation-action-buttons': mode === 'insert_recommendation' }">
        <el-button
          type="primary"
          size="small"
          :disabled="loading || !selectedId"
          @click="onConfirm"
        >
          {{ confirmLabel }}
        </el-button>
        <el-button size="small" :disabled="loading" @click="onCancel">取消</el-button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

/**
 * 候选推荐 panel 的候选条目结构。
 * 同时覆盖 target_selection（RuntimeScheduleItem）与 insert_recommendation（RuntimeInsertRecommendationCandidate）。
 * id 字段为统一标识：target_selection 用 RuntimeScheduleItem.id，insert_recommendation 用 candidateId。
 */
export interface CandidateRecommendationItem {
  /** 唯一标识（target_selection=item.id，insert_recommendation=candidateId） */
  id: string
  /** 节目名称 */
  programName?: string
  /** 节目编码 */
  programCode?: string
  /** 开始时间（target_selection 模式用于时间范围展示） */
  startTime?: string
  /** 结束时间（target_selection 模式用于时间范围展示） */
  endTime?: string
  /** 时长（秒，insert_recommendation 模式用于 meta 展示） */
  duration?: number
  /** 节目类型（insert_recommendation 模式用于 meta 展示） */
  programType?: string
  /** 匹配分数（保留字段，目前未直接展示） */
  score?: number
  /** 置信度（保留字段，目前未直接展示） */
  confidence?: number
  /** 匹配原因标签（insert_recommendation 模式展示为 tag 列表） */
  reasonTags?: string[]
}

/** 详情摘要条目（与 ChatPanel 内 DetailSummaryItem 对齐） */
interface DetailSummaryItem {
  label: string
  value: string
}

interface Props {
  /** panel 模式：target_selection=选目标，insert_recommendation=选候选 */
  mode: 'target_selection' | 'insert_recommendation'
  /** 候选列表 */
  candidates: CandidateRecommendationItem[]
  /** 当前选中的候选 id */
  selectedId: string | null
  /** 是否加载中（禁用按钮） */
  loading: boolean
  /** 标题 */
  title: string
  /** 摘要 */
  summary: string
  /** 推理说明（可选，展示在 body 顶部） */
  reasoning?: string
  /** 详情条目（可选，展示在 body 中部） */
  detailItems?: DetailSummaryItem[]
  /** 列表 aria-label（候选推荐模式用于 radiogroup，避免与 HTML 原生 aria-label 冲突） */
  listAriaLabel: string
  /** 操作提示（候选推荐模式展示在 actions 左侧） */
  actionHint?: string
  /** 确认按钮文案 */
  confirmLabel: string
  /** 底部备注（候选推荐模式展示在列表末尾） */
  footerNote?: string
  /** 时间范围格式化回调（target_selection 模式用，与 formatDisplayTimeRange 签名对齐） */
  formatTimeRange?: (start: string, end?: string) => string
  /** 候选 meta 格式化回调（insert_recommendation 模式用） */
  formatMeta?: (candidate: CandidateRecommendationItem, index: number) => string
}

const props = withDefaults(defineProps<Props>(), {
  reasoning: '',
  detailItems: () => [],
  actionHint: '',
  footerNote: '',
})

const emit = defineEmits<{
  (e: 'update:selectedId', value: string | null): void
  (e: 'confirm'): void
  (e: 'cancel'): void
}>()

/** panel 附加 class：候选推荐模式需要专属背景 */
const panelClass = computed(() => (
  props.mode === 'insert_recommendation' ? 'is-insert-recommendation' : ''
))

/** header 标签文案 */
const tagLabel = computed(() => '需选择')

/** header 标签类型 */
const tagType = computed<'info' | 'primary'>(() => (
  props.mode === 'insert_recommendation' ? 'info' : 'info'
))

/**
 * 获取候选序号徽章文案。
 * index=0 显示"优先推荐"，其余显示"候选 N"。
 */
const getBadgeLabel = (index: number): string => (
  index === 0 ? '优先推荐' : `候选 ${index + 1}`
)

/**
 * 获取候选强度文案。
 * index=0 显示"建议优先看"，其余显示"可作为备选"。
 */
const getStrengthLabel = (index: number): string => (
  index === 0 ? '建议优先看' : '可作为备选'
)

/**
 * 判断候选是否被选中。
 */
const isSelected = (candidate: CandidateRecommendationItem): boolean => (
  props.selectedId === candidate.id
)

/**
 * 格式化目标选择模式的候选标签。
 * 形如："09:00到09:30 看东方"。
 */
const formatTargetCandidateLabel = (candidate: CandidateRecommendationItem): string => {
  const timeRange = props.formatTimeRange && candidate.startTime
    ? props.formatTimeRange(candidate.startTime, candidate.endTime)
    : ''
  const label = candidate.programName || candidate.programCode || candidate.id
  return timeRange ? `${timeRange} ${label}` : label
}

/**
 * 格式化候选推荐模式的 meta 文案。
 * 优先使用外部注入的 formatMeta 回调；未注入时回退到"时长·类型"简单拼接。
 */
const formatCandidateMeta = (
  candidate: CandidateRecommendationItem,
  index: number,
): string => {
  if (props.formatMeta) {
    return props.formatMeta(candidate, index)
  }
  const parts: string[] = []
  if (typeof candidate.duration === 'number') {
    parts.push(formatDuration(candidate.duration))
  }
  if (candidate.programType) {
    parts.push(formatProgramTypeLabel(candidate.programType))
  }
  return parts.join(' · ')
}

/**
 * 格式化时长（秒）为可读文案。
 * >=60 秒按分钟展示，否则按秒展示。
 */
const formatDuration = (duration: number): string => {
  if (duration >= 60) {
    return duration % 60 === 0
      ? `${duration / 60}分钟`
      : `${(duration / 60).toFixed(1)}分钟`
  }
  return `${duration}秒`
}

/**
 * 节目类型中文化。
 * 与 ChatPanel.vue 内部 labelMap 对齐（保留"剧集""广告"等已有翻译）。
 */
const formatProgramTypeLabel = (programType: string): string => {
  const normalized = programType.trim().toLowerCase()
  const labelMap: Record<string, string> = {
    news: '新闻',
    news_magazine: '新闻杂志',
    current_affairs: '时政',
    kids: '少儿',
    drama: '剧集',
    movie: '电影',
    health: '健康',
    entertainment: '娱乐',
    commentary: '评论',
    ad: '广告',
  }
  return labelMap[normalized] ?? normalized.replace(/_/g, ' ')
}

/** 选中候选 */
const onSelect = (value: string | null): void => {
  emit('update:selectedId', value)
}

/** 确认 */
const onConfirm = (): void => {
  emit('confirm')
}

/** 取消 */
const onCancel = (): void => {
  emit('cancel')
}
</script>

<style scoped>
/* 目标选择列表（el-radio-group 容器） */
.target-selection-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 14px;
}

.target-selection-list :deep(.el-radio) {
  display: flex;
  align-items: flex-start;
  width: 100%;
  margin-right: 0;
  margin-bottom: 0;
  padding: 12px 14px;
  border: 1px solid var(--app-line);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.8);
  transition:
    border-color 0.18s ease,
    background 0.18s ease,
    box-shadow 0.18s ease,
    transform 0.18s ease;
}

.target-selection-list :deep(.el-radio:hover) {
  border-color: rgba(100, 108, 255, 0.38);
  background: rgba(255, 255, 255, 0.96);
  transform: translateY(-1px);
}

.target-selection-list :deep(.el-radio.is-checked) {
  border-color: rgba(100, 108, 255, 0.52);
  background: linear-gradient(180deg, rgba(248, 249, 255, 0.98) 0%, rgba(238, 242, 255, 0.92) 100%);
  box-shadow: 0 18px 30px -24px rgba(83, 91, 242, 0.42);
}

.target-selection-list :deep(.el-radio__input) {
  flex: 0 0 auto;
  margin-top: 3px;
}

.target-selection-list :deep(.el-radio__label) {
  flex: 1;
  min-width: 0;
  padding-left: 12px;
  color: #334155;
  font-size: 13px;
  line-height: 1.6;
  white-space: normal;
  word-break: break-word;
}

.target-selection-list :deep(.el-radio__input .el-radio__inner:hover) {
  border-color: var(--app-accent);
}

.target-selection-list :deep(.el-radio__input.is-checked .el-radio__inner) {
  border-color: var(--app-accent);
  background: var(--app-accent);
}

/* 候选推荐 panel 专属背景 */
.candidate-recommendation-panel.is-insert-recommendation {
  border-color: rgba(100, 108, 255, 0.38);
  background: linear-gradient(180deg, rgba(248, 249, 255, 0.96) 0%, rgba(238, 242, 255, 0.94) 100%);
  box-shadow: 0 24px 36px -30px rgba(83, 91, 242, 0.4);
}

.candidate-recommendation-panel.is-insert-recommendation .pending-command-header {
  padding-bottom: 10px;
  border-bottom: 1px solid var(--app-line);
}

.insert-recommendation-list {
  margin-top: 16px;
}

.insert-recommendation-card {
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: column;
  gap: 8px;
  padding-left: 12px;
}

.insert-recommendation-option {
  display: flex;
  align-items: flex-start;
  width: 100%;
  margin: 0;
  padding: 12px 14px;
  border: 1px solid var(--app-line);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.8);
  cursor: pointer;
  text-align: left;
  color: inherit;
  font: inherit;
  appearance: none;
  transition:
    border-color 0.18s ease,
    background 0.18s ease,
    box-shadow 0.18s ease,
    transform 0.18s ease;
}

.insert-recommendation-option:hover {
  border-color: rgba(100, 108, 255, 0.38);
  background: rgba(255, 255, 255, 0.96);
  transform: translateY(-1px);
}

.insert-recommendation-option:focus-visible {
  outline: none;
  border-color: rgba(100, 108, 255, 0.52);
  box-shadow:
    0 0 0 3px rgba(100, 108, 255, 0.16),
    0 18px 30px -24px rgba(83, 91, 242, 0.42);
}

.insert-recommendation-option.is-selected {
  border-color: rgba(100, 108, 255, 0.52);
  background: linear-gradient(180deg, rgba(248, 249, 255, 0.98) 0%, rgba(238, 242, 255, 0.92) 100%);
  box-shadow: 0 18px 30px -24px rgba(83, 91, 242, 0.42);
}

.insert-recommendation-selector {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  margin-top: 2px;
  border: 1px solid #d1d5db;
  border-radius: 999px;
  background: #fff;
  transition:
    border-color 0.18s ease,
    background 0.18s ease;
}

.insert-recommendation-selector-dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: var(--app-accent);
  transform: scale(0);
  transition: transform 0.18s ease;
}

.insert-recommendation-option.is-selected .insert-recommendation-selector {
  border-color: var(--app-accent);
  background: rgba(238, 242, 255, 0.92);
}

.insert-recommendation-option.is-selected .insert-recommendation-selector-dot {
  transform: scale(1);
}

.insert-recommendation-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.insert-recommendation-name-line {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  min-width: 0;
}

.insert-recommendation-name {
  color: #1f2937;
  font-size: 14px;
  font-weight: 700;
  line-height: 1.5;
}

.insert-recommendation-chip {
  display: inline-flex;
  align-items: center;
  min-height: 22px;
  padding: 0 8px;
  border-radius: 999px;
  background: rgba(100, 108, 255, 0.08);
  border: 1px solid var(--app-line);
  color: var(--app-accent-deep);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.02em;
}

.insert-recommendation-meta {
  margin-top: 0;
  color: #5b6472;
  font-size: 12px;
  line-height: 1.5;
}

.insert-recommendation-confidence {
  flex: 0 0 auto;
  padding-left: 12px;
  color: var(--app-accent-deep);
  font-size: 11px;
  font-weight: 700;
  line-height: 1.5;
  white-space: nowrap;
}

.insert-recommendation-tags {
  margin-top: 0;
  gap: 8px;
}

.insert-recommendation-tags .reason-tag {
  background: rgba(255, 255, 255, 0.82);
  border-color: var(--app-line);
  color: var(--app-accent-deep);
  font-weight: 500;
}

.insert-recommendation-footer-note {
  padding: 0 4px;
  color: #475569;
  font-size: 11px;
  line-height: 1.6;
}

.insert-recommendation-actions {
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--app-line);
  background: linear-gradient(180deg, rgba(248, 249, 255, 0) 0%, rgba(238, 242, 255, 0.82) 100%);
}

.insert-recommendation-action-hint {
  color: #475569;
  font-size: 11px;
  line-height: 1.6;
}

.insert-recommendation-action-buttons {
  display: flex;
  flex: 0 0 auto;
  gap: 8px;
}

@media (max-width: 720px) {
  .insert-recommendation-actions {
    align-items: stretch;
    flex-direction: column;
  }

  .insert-recommendation-action-buttons {
    width: 100%;
    justify-content: flex-end;
  }
}
</style>
