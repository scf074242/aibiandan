<template>
  <section class="openclaw-demo-panel">
    <div class="panel-header">
      <div class="panel-heading">
        <h4 class="panel-title">OpenClaw 外部消息调试</h4>
        <p class="panel-hint">用纯前台方式直接验证 `bigbiandan.*` 协议和会话状态。</p>
      </div>
      <div class="panel-header-actions">
        <el-tag size="small" effect="light">纯前台演示</el-tag>
        <el-button link size="small" class="collapse-btn" @click="collapsed = !collapsed">
          {{ collapsed ? '展开' : '收起' }}
        </el-button>
      </div>
    </div>

    <div class="panel-summary">
      <span class="summary-chip">
        状态
        <strong>{{ summaryStatus }}</strong>
      </span>
      <span class="summary-chip">
        会话
        <strong>{{ summarySession }}</strong>
      </span>
      <span class="summary-chip">
        最近
        <strong>{{ summaryResponse }}</strong>
      </span>
    </div>

    <template v-if="!collapsed">
      <el-form label-position="top" size="small" class="panel-form">
        <el-form-item label="Conversation ID">
          <el-input v-model="conversationId" placeholder="例如 agent:main:main" />
        </el-form-item>
        <el-form-item label="Session ID">
          <el-input v-model="sessionId" placeholder="提交后自动回填，也可手动输入" />
        </el-form-item>
        <el-form-item label="消息内容">
          <el-input
            v-model="messageText"
            type="textarea"
            :rows="2"
            resize="none"
            placeholder="例如：补齐当前空窗"
          />
        </el-form-item>
        <el-form-item label="目标节目 ID">
          <el-input v-model="targetId" placeholder="需要 selectTarget 时填写" />
        </el-form-item>
      </el-form>

      <div class="panel-actions">
        <el-button size="small" @click="handlePing">Ping</el-button>
        <el-button size="small" type="primary" @click="handleSubmit">Submit</el-button>
        <el-button size="small" @click="handleGetState">GetState</el-button>
        <el-button size="small" @click="handleConfirm">Confirm</el-button>
        <el-button size="small" @click="handleSelectTarget">Select</el-button>
        <el-button size="small" type="danger" plain @click="handleCancel">Cancel</el-button>
      </div>

      <div class="panel-result-grid">
        <div class="panel-result-card">
          <div class="result-label">最近响应</div>
          <pre class="result-json">{{ lastResponseText }}</pre>
        </div>
        <div class="panel-result-card">
          <div class="result-label">当前会话</div>
          <pre class="result-json">{{ currentSessionText }}</pre>
        </div>
      </div>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, type PropType } from 'vue'
import { ElMessage } from 'element-plus'
import type {
  OpenClawHostAdapter,
  OpenClawHostOutboundEnvelope,
} from '@/services/openclaw/openClawHostAdapter'

const props = defineProps({
  adapter: {
    type: Object as PropType<OpenClawHostAdapter>,
    required: true,
  },
})

const conversationId = ref('agent:main:demo')
const sessionId = ref('')
const targetId = ref('')
const messageText = ref('补齐当前空窗')
const collapsed = ref(true)
const lastResponse = ref<OpenClawHostOutboundEnvelope | null>(null)
const currentSession = ref<unknown>(null)

const prettyJson = (value: unknown) => JSON.stringify(value, null, 2) ?? 'null'

const lastResponseText = computed(() => prettyJson(lastResponse.value))
const currentSessionText = computed(() => prettyJson(currentSession.value))
const summaryStatus = computed(() => {
  const payload = lastResponse.value?.payload as { status?: string } | null
  return payload?.status || '待连接'
})
const summarySession = computed(() => sessionId.value || '未建立')
const summaryResponse = computed(() => {
  const payload = lastResponse.value?.payload as { summary?: string } | null
  return payload?.summary || '暂无'
})

const runEnvelope = async (envelope: Record<string, unknown>) => {
  const response = await props.adapter.handleEnvelope(envelope as never)
  if (!response) {
    ElMessage.warning('未收到响应')
    return
  }

  lastResponse.value = response

  const responsePayload = response.payload as { sessionId?: string } | null
  if (responsePayload?.sessionId) {
    sessionId.value = responsePayload.sessionId
  }

  syncSessionState()
}

const syncSessionState = () => {
  currentSession.value = props.adapter.getSessionState({
    sessionId: sessionId.value || undefined,
    conversationId: conversationId.value || undefined,
  })
}

const requireConversation = () => {
  if (!conversationId.value.trim()) {
    ElMessage.warning('请先填写 Conversation ID')
    return false
  }
  return true
}

const handlePing = async () => {
  await runEnvelope({
    type: 'bigbiandan.ping',
    requestId: `ping-${Date.now()}`,
  })
}

const handleSubmit = async () => {
  if (!requireConversation()) return
  if (!messageText.value.trim()) {
    ElMessage.warning('请先输入消息内容')
    return
  }
  await runEnvelope({
    type: 'bigbiandan.submit',
    requestId: `submit-${Date.now()}`,
    payload: {
      conversationId: conversationId.value.trim(),
      text: messageText.value.trim(),
    },
  })
}

const handleGetState = async () => {
  if (!requireConversation() && !sessionId.value.trim()) return
  await runEnvelope({
    type: 'bigbiandan.getState',
    requestId: `state-${Date.now()}`,
    payload: {
      sessionId: sessionId.value.trim() || undefined,
      conversationId: conversationId.value.trim() || undefined,
    },
  })
}

const handleConfirm = async () => {
  if (!requireConversation() && !sessionId.value.trim()) return
  await runEnvelope({
    type: 'bigbiandan.confirm',
    requestId: `confirm-${Date.now()}`,
    payload: {
      sessionId: sessionId.value.trim() || undefined,
      conversationId: conversationId.value.trim() || undefined,
    },
  })
}

const handleSelectTarget = async () => {
  if (!targetId.value.trim()) {
    ElMessage.warning('请选择或填写目标节目 ID')
    return
  }
  if (!requireConversation() && !sessionId.value.trim()) return
  await runEnvelope({
    type: 'bigbiandan.selectTarget',
    requestId: `select-${Date.now()}`,
    payload: {
      sessionId: sessionId.value.trim() || undefined,
      conversationId: conversationId.value.trim() || undefined,
      targetId: targetId.value.trim(),
    },
  })
}

const handleCancel = async () => {
  if (!requireConversation() && !sessionId.value.trim()) return
  await runEnvelope({
    type: 'bigbiandan.cancel',
    requestId: `cancel-${Date.now()}`,
    payload: {
      sessionId: sessionId.value.trim() || undefined,
      conversationId: conversationId.value.trim() || undefined,
    },
  })
}
</script>

<style scoped lang="scss">
.openclaw-demo-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px 14px 14px;
  border-top: 1px solid #ebeef5;
  background: #fcfcfd;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: flex-start;
}

.panel-header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.panel-heading {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.panel-title {
  margin: 0;
  font-size: 13px;
  font-weight: 700;
  color: #111827;
}

.panel-hint {
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
  color: #6b7280;
}

.panel-form :deep(.el-form-item) {
  margin-bottom: 8px;
}

.panel-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.summary-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 8px;
  border-radius: 999px;
  background: #ffffff;
  border: 1px solid #e5e7eb;
  font-size: 11px;
  color: #6b7280;
}

.summary-chip strong {
  color: #1f2937;
  font-weight: 600;
}

.panel-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.panel-result-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 10px;
}

.panel-result-card {
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #ffffff;
  overflow: hidden;
}

.result-label {
  padding: 8px 10px;
  border-bottom: 1px solid #f1f5f9;
  font-size: 12px;
  font-weight: 600;
  color: #475569;
}

.result-json {
  margin: 0;
  padding: 10px;
  max-height: 112px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 11px;
  line-height: 1.6;
  color: #1f2937;
  background: #ffffff;
}

.collapse-btn {
  font-size: 12px;
}
</style>
