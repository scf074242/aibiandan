<template>
  <div class="chat-panel">
    <!-- 消息列表 -->
    <div ref="messagesContainer" class="messages-container">
      <div
        v-for="(message, index) in messages"
        :key="index"
        class="message-item"
        :class="{ 'is-user': message.role === 'user', 'is-assistant': message.role === 'assistant' }"
      >
        <div class="message-avatar">
          <el-avatar
            :size="36"
            :icon="message.role === 'user' ? UserFilled : ChatDotRound"
            :class="message.role"
          />
        </div>
        <div class="message-content">
          <div class="message-text">{{ message.content }}</div>

          <!-- 命令预览卡片 -->
          <div v-if="message.command" class="command-card">
            <div class="command-header">
              <el-tag size="small" type="primary">{{ message.command.action }}</el-tag>
              <span class="command-reasoning" v-if="message.command.reasoning">
                {{ message.command.reasoning }}
              </span>
            </div>
            <div class="command-data" v-if="message.command.data">
              <pre>{{ JSON.stringify(message.command.data, null, 2) }}</pre>
            </div>
            <div class="command-actions">
              <el-button
                type="primary"
                size="small"
                @click="confirmCommand(message.command!)"
              >
                确认执行
              </el-button>
              <el-button
                size="small"
                @click="cancelCommand"
              >
                取消
              </el-button>
            </div>
          </div>

          <!-- 澄清问题卡片 -->
          <div v-if="message.clarification" class="clarification-card">
            <div class="clarification-header">
              <el-icon><QuestionFilled /></el-icon>
              <span>需要更多信息</span>
            </div>
            <div class="clarification-question">{{ message.clarification.question }}</div>
            <div v-if="message.clarification.suggestedOptions" class="clarification-options">
              <el-button
                v-for="option in message.clarification.suggestedOptions"
                :key="option"
                size="small"
                @click="selectClarificationOption(option)"
              >
                {{ option }}
              </el-button>
            </div>
          </div>

          <!-- 解释信息卡片 -->
          <div v-if="message.explanation" class="explanation-card">
            <div class="explanation-header">
              <el-icon><InfoFilled /></el-icon>
              <span>决策说明</span>
            </div>
            <div class="explanation-content">{{ message.explanation.explanation }}</div>
            <div v-if="message.explanation.details" class="explanation-details">
              <el-collapse>
                <el-collapse-item title="详细信息">
                  <pre>{{ JSON.stringify(message.explanation.details, null, 2) }}</pre>
                </el-collapse-item>
              </el-collapse>
            </div>
          </div>
        </div>
      </div>

      <!-- 加载状态 -->
      <div v-if="loading" class="message-item is-assistant is-loading">
        <div class="message-avatar">
          <el-avatar :size="36" :icon="ChatDotRound" class="assistant" />
        </div>
        <div class="message-content">
          <el-skeleton :rows="2" animated />
        </div>
      </div>

      <!-- 空状态 -->
      <div v-if="messages.length === 0 && !loading" class="empty-state">
        <el-icon :size="48" class="empty-icon"><ChatDotRound /></el-icon>
        <p class="empty-text">开始与 AI 助手对话</p>
        <p class="empty-hint">输入自然语言指令来修改串联单</p>
      </div>
    </div>

    <!-- 快捷指令 -->
    <div class="quick-actions">
      <el-button
        v-for="action in quickActions"
        :key="action.label"
        size="small"
        @click="sendQuickAction(action)"
      >
        {{ action.label }}
      </el-button>
    </div>

    <!-- 输入区域 -->
    <div class="input-area">
      <el-input
        v-model="inputMessage"
        type="textarea"
        :rows="2"
        placeholder="输入指令，例如：在新闻联播后插入天气预报"
        @keydown.enter.prevent="sendMessage"
      />
      <el-button
        type="primary"
        :disabled="!inputMessage.trim() || loading"
        :loading="loading"
        @click="sendMessage"
      >
        <el-icon><Promotion /></el-icon>
      </el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, nextTick, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { UserFilled, ChatDotRound, Promotion, QuestionFilled, InfoFilled } from '@element-plus/icons-vue'
import type { ChatMessage } from '@/types/llm'
import type { OrchestrationCommand, ExplanationResult } from '@/types/orchestration'
import { getLLMClient } from '@/services/llm/llmClient'
import { promptBuilder } from '@/services/llm/promptBuilder'
import { responseParser } from '@/services/llm/responseParser'
import { contextBuilder } from '@/services/llm/contextBuilder'
import { getCommandExecutor } from '@/services/commandExecutor'
import { getExplainInterfaces } from '@/services/orchestration/interfaces/explainInterfaces'

interface Message extends ChatMessage {
  command?: OrchestrationCommand
  clarification?: {
    question: string
    suggestedOptions?: string[]
  }
  explanation?: ExplanationResult
}

interface Props {
  currentSchedule: Array<{
    id: string
    programCode: string
    programName: string
    startTime: string
    endTime: string
    duration: number
    programType: string
  }>
}

const props = defineProps<Props>()

// 获取命令执行器实例
const commandExecutor = getCommandExecutor()

const emit = defineEmits<{
  commandExecuted: [result: { success: boolean; message: string }]
  scheduleUpdated: [items: typeof props.currentSchedule]
  clarificationResponse: [response: string]
}>()

const messages = ref<Message[]>([])
const inputMessage = ref('')
const loading = ref(false)
const messagesContainer = ref<HTMLElement>()

// 快捷指令
const quickActions = [
  { label: '检查错误', prompt: '请检查当前串联单是否有错误' },
  { label: '优化编排', prompt: '请优化当前串联单的编排' },
  { label: '添加广告', prompt: '在合适的位置插入广告' },
  { label: '调整时间', prompt: '调整节目时间使其连续' },
]

// 发送消息
const sendMessage = async () => {
  const content = inputMessage.value.trim()
  if (!content || loading.value) return

  // 添加用户消息
  messages.value.push({
    role: 'user',
    content,
  })

  inputMessage.value = ''
  loading.value = true

  try {
    // 构建对话上下文
    const dialogueContext = contextBuilder.buildDialogueContext(
      content,
      messages.value.filter(m => !m.command && !m.clarification).map(m => ({ role: m.role, content: m.content })),
      props.currentSchedule,
    )

    const promptMessages = promptBuilder.buildDialoguePrompt(dialogueContext)

    const client = getLLMClient()
    const response = await client.chat(promptMessages)

    const parseResult = responseParser.parse(response.content)

    if (parseResult.success && parseResult.data) {
      const command = parseResult.data as OrchestrationCommand

      // 处理澄清命令
      if (command.action === 'clarification') {
        messages.value.push({
          role: 'assistant',
          content: '我需要更多信息来理解您的需求：',
          clarification: {
            question: command.data?.question || '请提供更多信息',
            suggestedOptions: command.data?.suggestedOptions
          }
        })
      } else {
        // 获取命令解释
        const explanation = await explainInterfaces.explainCommand(command)

        // 显示命令预览
        messages.value.push({
          role: 'assistant',
          content: `我将执行以下操作：`,
          command,
          explanation
        })
      }
    } else {
      messages.value.push({
        role: 'assistant',
        content: '抱歉，我无法理解您的指令。请尝试用更明确的方式描述您的需求。',
      })
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : '请求失败'
    messages.value.push({
      role: 'assistant',
      content: `抱歉，发生了错误：${errorMsg}`,
    })
  } finally {
    loading.value = false
    scrollToBottom()
  }
}

// 发送快捷指令
const sendQuickAction = (action: { label: string; prompt: string }) => {
  inputMessage.value = action.prompt
  sendMessage()
}

// 确认执行命令
const confirmCommand = async (command: OrchestrationCommand) => {
  try {
    const result = await commandExecutor.execute(command)

    emit('commandExecuted', result)

    if (result.success) {
      ElMessage.success(result.message)
      emit('scheduleUpdated', commandExecutor.getScheduleItems())

      // 移除命令卡片
      const lastMessage = messages.value[messages.value.length - 1]
      if (lastMessage?.command) {
        delete lastMessage.command
        delete lastMessage.explanation
        lastMessage.content += '\n\n✅ 已执行成功'
      }
    } else {
      ElMessage.error(result.error || '执行失败')

      // 显示错误
      const lastMessage = messages.value[messages.value.length - 1]
      if (lastMessage?.command) {
        delete lastMessage.command
        delete lastMessage.explanation
        lastMessage.content += '\n\n❌ 执行失败：' + (result.error || '未知错误')
      }
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : '执行失败'
    ElMessage.error(errorMsg)

    // 显示错误
    const lastMessage = messages.value[messages.value.length - 1]
    if (lastMessage?.command) {
      delete lastMessage.command
      delete lastMessage.explanation
      lastMessage.content += '\n\n❌ 执行失败：' + errorMsg
    }
  }
}

// 取消命令
const cancelCommand = () => {
  const lastMessage = messages.value[messages.value.length - 1]
  if (lastMessage?.command) {
    delete lastMessage.command
    delete lastMessage.explanation
    lastMessage.content += '\n\n❌ 已取消'
  }
}

// 选择澄清选项
const selectClarificationOption = (option: string) => {
  inputMessage.value = option
  sendMessage()
}

// 滚动到底部
const scrollToBottom = async () => {
  await nextTick()
  if (messagesContainer.value) {
    messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight
  }
}

// 监听消息变化
watch(() => messages.value.length, scrollToBottom)
</script>

<style scoped lang="scss">
.chat-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--el-bg-color);
}

.messages-container {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}

.message-item {
  display: flex;
  margin-bottom: 16px;

  &.is-user {
    flex-direction: row-reverse;

    .message-content {
      margin-left: 0;
      margin-right: 12px;
      background: var(--el-color-primary-light-9);
    }
  }

  &.is-assistant {
    .message-content {
      background: var(--el-fill-color-light);
    }
  }
}

.message-avatar {
  flex-shrink: 0;

  .el-avatar {
    background: var(--el-color-info-light-9);
    color: var(--el-color-info);

    &.user {
      background: var(--el-color-primary);
      color: white;
    }

    &.assistant {
      background: var(--el-color-success);
      color: white;
    }
  }
}

.message-content {
  margin-left: 12px;
  padding: 12px 16px;
  border-radius: 8px;
  max-width: 80%;
  word-break: break-word;
}

.message-text {
  line-height: 1.5;
}

// 命令卡片
.command-card {
  margin-top: 12px;
  padding: 12px;
  background: var(--el-bg-color);
  border-radius: 6px;
  border: 1px solid var(--el-border-color-lighter);
}

.command-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}

.command-reasoning {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.command-data {
  margin-bottom: 12px;
  padding: 8px;
  background: var(--el-fill-color-light);
  border-radius: 4px;
  overflow-x: auto;

  pre {
    margin: 0;
    font-size: 11px;
    line-height: 1.4;
    color: var(--el-text-color-regular);
  }
}

.command-actions {
  display: flex;
  gap: 8px;
}

// 澄清卡片
.clarification-card {
  margin-top: 12px;
  padding: 12px;
  background: var(--el-color-warning-light-9);
  border-radius: 6px;
  border: 1px solid var(--el-color-warning-light-5);
}

.clarification-header {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 500;
  color: var(--el-color-warning);
  margin-bottom: 8px;
}

.clarification-question {
  font-size: 14px;
  color: var(--el-text-color-primary);
  margin-bottom: 12px;
  line-height: 1.5;
}

.clarification-options {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

// 解释卡片
.explanation-card {
  margin-top: 12px;
  padding: 12px;
  background: var(--el-color-info-light-9);
  border-radius: 6px;
  border: 1px solid var(--el-color-info-light-5);
}

.explanation-header {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 500;
  color: var(--el-color-info);
  margin-bottom: 8px;
}

.explanation-content {
  font-size: 13px;
  color: var(--el-text-color-regular);
  line-height: 1.5;
  margin-bottom: 8px;
}

.explanation-details {
  pre {
    margin: 0;
    font-size: 11px;
    line-height: 1.4;
    color: var(--el-text-color-secondary);
  }
}

.quick-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 8px 16px;
  border-top: 1px solid var(--el-border-color-lighter);
  background: var(--el-fill-color-light);
}

.input-area {
  display: flex;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid var(--el-border-color-lighter);

  .el-textarea {
    flex: 1;
  }

  .el-button {
    align-self: flex-end;
  }
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--el-text-color-placeholder);
}

.empty-icon {
  margin-bottom: 16px;
}

.empty-text {
  font-size: 16px;
  margin-bottom: 8px;
}

.empty-hint {
  font-size: 14px;
}

.is-loading {
  opacity: 0.7;
}
</style>
