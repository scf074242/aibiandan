<template>
  <div class="failure-formatter" :class="`is-${renderData.kind}`">
    <!-- 失败标题与摘要 -->
    <div class="failure-header">
      <span class="failure-headline">{{ renderData.headline }}</span>
      <span class="failure-summary">{{ renderData.summary }}</span>
    </div>

    <!-- 已识别线索 -->
    <div v-if="renderData.recognizedHints.length > 0" class="failure-section is-recognized">
      <div class="failure-section-title">已识别线索</div>
      <div class="failure-hint-list">
        <div
          v-for="hint in renderData.recognizedHints"
          :key="hint.label"
          class="failure-hint-item is-recognized"
        >
          <span class="failure-hint-label">{{ hint.label }}</span>
          <span class="failure-hint-value">{{ hint.value }}</span>
        </div>
      </div>
    </div>

    <!-- 缺失槽位（红色高亮） -->
    <div v-if="renderData.missingHints.length > 0" class="failure-section is-missing">
      <div class="failure-section-title">仍需补充</div>
      <div class="failure-hint-list">
        <div
          v-for="hint in renderData.missingHints"
          :key="hint.label"
          class="failure-hint-item is-missing"
        >
          <span class="failure-hint-label">{{ hint.label }}</span>
          <span class="failure-hint-reason">{{ hint.reason }}</span>
        </div>
      </div>
    </div>

    <!-- 候选证据 -->
    <div v-if="renderData.candidateCards.length > 0" class="failure-section is-candidates">
      <div class="failure-section-title">候选证据</div>
      <div class="failure-candidate-list">
        <div
          v-for="card in renderData.candidateCards"
          :key="card.programCode"
          class="failure-candidate-card"
        >
          <div class="failure-candidate-header">
            <span class="failure-candidate-name">{{ card.programName }}</span>
            <span class="failure-candidate-code">{{ card.programCode }}</span>
          </div>
          <div class="failure-candidate-meta">
            <span class="failure-candidate-duration">时长：{{ formatDuration(card.duration) }}</span>
            <span class="failure-candidate-score">匹配度：{{ formatScore(card.score) }}</span>
          </div>
          <div v-if="card.reasonTags.length > 0" class="failure-candidate-tags">
            <span
              v-for="tag in card.reasonTags"
              :key="tag"
              class="failure-candidate-tag"
            >
              {{ tag }}
            </span>
          </div>
          <div v-if="card.rejectedReason" class="failure-candidate-rejected">
            拒绝原因：{{ card.rejectedReason }}
          </div>
        </div>
      </div>
    </div>

    <!-- Quick Replies -->
    <div v-if="renderData.quickReplies.length > 0" class="failure-quick-replies">
      <el-button
        v-for="reply in renderData.quickReplies"
        :key="reply.label"
        size="small"
        :type="resolveButtonType(reply.action)"
        @click="handleQuickReply(reply)"
      >
        {{ reply.label }}
      </el-button>
    </div>

    <!-- traceId（折叠展示） -->
    <div class="failure-trace">
      <el-collapse>
        <el-collapse-item title="traceId" :name="renderData.traceId">
          <code class="failure-trace-id">{{ renderData.traceId }}</code>
        </el-collapse-item>
      </el-collapse>
    </div>
  </div>
</template>

<script lang="ts">
/**
 * 失败信封前台渲染子组件（方向 1 核心交付）。
 *
 * 设计约束（AGENTS.md 本地只保护结果）：
 * - 仅渲染 envelope，不持有任何 mutation 决策权
 * - quick reply 点击事件 emit 给父组件（ChatPanel），由父组件决定后续行为
 * - 不调用 LLM，不做意图改写
 *
 * 与既有 ChatPanel.recoverableRuntimeFailure 并存（方向 1 不修改既有逻辑）。
 */
import { computed, defineComponent, type PropType } from 'vue'
import { ElButton, ElCollapse, ElCollapseItem } from 'element-plus'
import {
  formatFailureEnvelope,
  type FailureRenderData,
} from '@/services/agent/failureEnvelopeFormatter'
import type {
  QuickReply,
  RecoverableInterpretationFailure,
} from '@/services/agent/recoverableFailureEnvelope'

export default defineComponent({
  name: 'FailureFormatter',
  components: {
    ElButton,
    ElCollapse,
    ElCollapseItem,
  },
  props: {
    /** 可恢复失败信封 */
    envelope: {
      type: Object as PropType<RecoverableInterpretationFailure>,
      required: true,
    },
  },
  emits: {
    /** quick reply 点击事件 */
    quickReply: (_payload: QuickReply) => true,
  },
  setup(props, { emit }) {
    /** 把 envelope 转换为渲染数据（纯函数，便于单测） */
    const renderData = computed<FailureRenderData>(() => formatFailureEnvelope(props.envelope))

    /**
     * 处理 quick reply 点击。
     * 只 emit 事件，不在此组件内执行任何 mutation。
     */
    const handleQuickReply = (reply: QuickReply): void => {
      emit('quickReply', reply)
    }

    /**
     * 根据 quick reply action 决定按钮类型（视觉区分）。
     * - cancel：default（中性）
     * - switch_strategy：warning（提示策略变更）
     * - fill_instruction：primary（推荐操作）
     */
    const resolveButtonType = (
      action: QuickReply['action'],
    ): 'default' | 'primary' | 'warning' => {
      if (action === 'cancel') return 'default'
      if (action === 'switch_strategy') return 'warning'
      return 'primary'
    }

    /** 格式化时长（秒 → mm:ss） */
    const formatDuration = (seconds: number): string => {
      const m = Math.floor(seconds / 60)
      const s = seconds % 60
      return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
    }

    /** 格式化分数（0-1 → 百分比） */
    const formatScore = (score: number): string => {
      return `${Math.round(score * 100)}%`
    }

    return {
      renderData,
      handleQuickReply,
      resolveButtonType,
      formatDuration,
      formatScore,
    }
  },
})
</script>

<style scoped lang="scss">
.failure-formatter {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px 14px;
  border-radius: 8px;
  background: #fff5f5;
  border: 1px solid #ffd6d6;

  &.is-preview_only_violation {
    background: #fff8e1;
    border-color: #ffcc80;
  }

  &.is-llm_timeout,
  &.is-llm_intent_unavailable {
    background: #f5f7fa;
    border-color: #dcdfe6;
  }
}

.failure-header {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.failure-headline {
  font-size: 14px;
  font-weight: 600;
  color: #c45656;
}

.failure-summary {
  font-size: 13px;
  color: #606266;
  line-height: 1.5;
}

.failure-section {
  display: flex;
  flex-direction: column;
  gap: 6px;

  &.is-recognized .failure-section-title {
    color: #409eff;
  }

  &.is-missing .failure-section-title {
    color: #c45656;
  }

  &.is-candidates .failure-section-title {
    color: #67c23a;
  }
}

.failure-section-title {
  font-size: 12px;
  font-weight: 600;
}

.failure-hint-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.failure-hint-item {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 12px;
  line-height: 1.5;

  &.is-recognized {
    color: #303133;
  }

  &.is-missing {
    color: #c45656;
  }
}

.failure-hint-label {
  font-weight: 600;
  min-width: 60px;
}

.failure-hint-value {
  color: #606266;
}

.failure-hint-reason {
  color: #c45656;
  flex: 1;
}

.failure-candidate-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.failure-candidate-card {
  padding: 8px 10px;
  border: 1px solid #e4e7ed;
  border-radius: 6px;
  background: #ffffff;
}

.failure-candidate-header {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 4px;
}

.failure-candidate-name {
  font-size: 13px;
  font-weight: 600;
  color: #303133;
}

.failure-candidate-code {
  font-size: 11px;
  color: #909399;
}

.failure-candidate-meta {
  display: flex;
  gap: 12px;
  font-size: 12px;
  color: #606266;
  margin-bottom: 4px;
}

.failure-candidate-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.failure-candidate-tag {
  display: inline-block;
  padding: 1px 6px;
  font-size: 11px;
  border-radius: 3px;
  background: #ecf5ff;
  color: #409eff;
  border: 1px solid #d9ecff;
}

.failure-candidate-rejected {
  font-size: 12px;
  color: #c45656;
  margin-top: 4px;
}

.failure-quick-replies {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding-top: 4px;
  border-top: 1px dashed #e4e7ed;
}

.failure-trace {
  margin-top: 4px;

  :deep(.el-collapse-item__header) {
    font-size: 11px;
    color: #909399;
    height: 24px;
    line-height: 24px;
  }

  :deep(.el-collapse-item__content) {
    padding-bottom: 0;
  }
}

.failure-trace-id {
  font-size: 11px;
  color: #909399;
  word-break: break-all;
}
</style>
