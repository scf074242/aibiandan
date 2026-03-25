<template>
  <div class="chat-panel">
    <div ref="messagesContainer" class="messages-container">
      <div
        v-for="(message, index) in messages"
        :key="index"
        class="message-item"
        :class="{ 'is-user': message.role === 'user', 'is-assistant': message.role === 'assistant' }"
      >
        <div class="message-avatar">
          <el-avatar :size="36" :icon="message.role === 'user' ? UserFilled : ChatDotRound" />
        </div>

        <div class="message-content" :class="message.processType ? `process-${message.processType}` : ''">
          <div v-if="message.processTypeLabel" class="process-summary-row">
            <span class="process-pill" :class="message.processType ? `process-${message.processType}` : ''">
              {{ message.processTypeLabel }}
            </span>
            <el-button
              v-if="messageHasDetails(message)"
              link
              size="small"
              class="process-toggle"
              @click="toggleExpanded(message)"
            >
              {{ message.expanded ? '收起' : '展开' }}
            </el-button>
          </div>

          <div class="message-text">{{ message.content }}</div>

          <div v-if="message.command && (message.expanded ?? true)" class="command-card">
            <div class="command-header">
              <el-tag size="small" type="primary">{{ message.command.action }}</el-tag>
              <span v-if="message.command.reasoning" class="command-reasoning">{{ message.command.reasoning }}</span>
            </div>
            <pre class="command-data">{{ JSON.stringify(message.command.data, null, 2) }}</pre>
            <div class="command-actions">
              <el-button type="primary" size="small" @click="confirmCommand(message.command)">确认执行</el-button>
              <el-button size="small" @click="cancelCommand(message)">取消</el-button>
            </div>
          </div>

          <div v-if="message.explanation && (message.expanded ?? true)" class="explanation-card">
            <div class="explanation-content">{{ message.explanation.explanation }}</div>
            <pre v-if="message.explanation.details" class="details-data">{{ JSON.stringify(message.explanation.details, null, 2) }}</pre>
          </div>
        </div>
      </div>

      <div v-if="messages.length === 0 && !loading" class="empty-state">
        <el-icon :size="48"><ChatDotRound /></el-icon>
        <p>输入自然语言需求，AI 会先识别意图，再生成命令或启动编排。</p>
      </div>
    </div>

    <div class="quick-actions">
      <el-button v-for="action in quickActions" :key="action.label" size="small" @click="applyQuickAction(action.prompt)">
        {{ action.label }}
      </el-button>
    </div>

    <div class="input-area">
      <el-input
        v-model="inputMessage"
        type="textarea"
        :rows="2"
        placeholder="例如：在9点插入节目看东方，或帮我填充全天节目"
        @keydown.enter.prevent="sendMessage"
      />
      <el-button type="primary" :disabled="!inputMessage.trim() || loading" :loading="loading" @click="sendMessage">
        <el-icon><Promotion /></el-icon>
      </el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { ChatDotRound, Promotion, UserFilled } from '@element-plus/icons-vue'
import type { ChatMessage } from '@/types/llm'
import type { ExplanationResult, OrchestrationCommand, PlanningLogEntry, TaskMode } from '@/types/orchestration'
import { getCommandExecutor } from '@/services/commandExecutor'
import { getLLMClient } from '@/services/llm/llmClient'
import { getTaskClassifier } from '@/services/llm/taskClassifier'
import { buildDialogueContext } from '@/services/dialogueContext'
import { getIntentRecognizer } from '@/services/intentRecognizer'
import { getParamExtractor } from '@/services/paramExtractor'
import { getEntityLinker } from '@/services/entityLinker'
import { getCandidateService } from '@/services/candidateService'
import { getCandidateSelectionService } from '@/services/candidateSelectionService'
import { getInsertCommandExecutor } from '@/services/insertCommandExecutor'
import { getScheduleCommandBus } from '@/services/scheduleCommandBus'

type ProcessType = 'planning' | 'query' | 'selection' | 'execution' | 'validation' | 'error' | 'general'

interface Message extends ChatMessage {
  command?: OrchestrationCommand
  explanation?: ExplanationResult
  processType?: ProcessType
  processTypeLabel?: string
  expanded?: boolean
}

interface SchedulePreviewItem {
  id: string
  programCode?: string
  programName?: string
  startTime: string
  endTime: string
  duration?: number
  programType?: string
}

interface Props {
  currentSchedule: SchedulePreviewItem[]
  channelId: string
  channelName: string
  date: string
  gapCount?: number
  orchestrationLogs?: PlanningLogEntry[]
}

const props = defineProps<Props>()
const emit = defineEmits<{
  commandExecuted: [result: { success: boolean; message: string }]
  scheduleUpdated: [items: Props['currentSchedule']]
  orchestrateRequested: [payload: { userInput: string; mode: TaskMode; reasoning: string }]
}>()

const messages = ref<Message[]>([])
const inputMessage = ref('')
const loading = ref(false)
const messagesContainer = ref<HTMLElement>()
const commandExecutor = getCommandExecutor()
const insertCommandExecutor = getInsertCommandExecutor()
const scheduleCommandBus = getScheduleCommandBus()
const llmClient = getLLMClient()
const taskClassifier = getTaskClassifier(llmClient)
const intentRecognizer = getIntentRecognizer(llmClient)
const paramExtractor = getParamExtractor(llmClient)
const entityLinker = getEntityLinker()
const candidateService = getCandidateService()
const candidateSelectionService = getCandidateSelectionService(llmClient)
const displayedLogIds = ref<string[]>([])

const quickActions = [
  { label: '全天编排', prompt: '帮我填充全天节目' },
  { label: '补齐空窗', prompt: '请补齐当前所有空窗' },
  { label: '插入节目', prompt: '在9点插入节目看东方' },
  { label: '执行校验', prompt: '请校验当前节目单' },
]

const applyQuickAction = (prompt: string) => {
  inputMessage.value = prompt
  void sendMessage()
}

const sendMessage = async () => {
  const content = inputMessage.value.trim()
  if (!content || loading.value) return

  messages.value.push({ role: 'user', content })
  inputMessage.value = ''
  loading.value = true

  try {
    const classification = await taskClassifier.classify({
      scheduleState: {
        channelId: props.channelId,
        channelName: props.channelName,
        date: props.date,
        isEmpty: props.currentSchedule.length === 0,
        itemCount: props.currentSchedule.length,
        gapCount: props.gapCount ?? 0,
        hasSelectedTimeRange: false,
      },
      userInput: content,
      history: messages.value.slice(-6).map((message) => message.content),
    })

    if (classification.mode === 'micro_edit') {
      const result = await buildMicroEditCommand(content, classification.reasoning)
      if (!result.command) {
        messages.value.push({
          role: 'assistant',
          content: result.message || '我理解这是一次局部修改，但还没法稳定生成命令。',
          processType: 'general',
          processTypeLabel: '任务判别',
        })
        return
      }

      messages.value.push({
        role: 'assistant',
        content: result.message || '我已经生成待执行命令，请确认。',
        command: result.command,
        explanation: {
          type: 'command',
          targetId: 'preview',
          explanation: result.explanation || classification.reasoning,
          details: result.details,
        },
        processType: 'execution',
        processTypeLabel: '命令预览',
        expanded: true,
      })
      return
    }

    if (classification.mode === 'full_generate' || classification.mode === 'partial_generate') {
      messages.value.push({
        role: 'assistant',
        content:
          classification.mode === 'full_generate'
            ? '已识别为全量编排需求，正在准备启动编排流程。'
            : '已识别为局部补排需求，正在准备补齐空窗。',
        explanation: {
          type: 'command',
          targetId: 'orchestration',
          explanation: classification.reasoning,
        },
        processType: 'planning',
        processTypeLabel: classification.mode === 'full_generate' ? '任务判别 / 全量编排' : '任务判别 / 局部补排',
        expanded: false,
      })
      emit('orchestrateRequested', {
        userInput: content,
        mode: classification.mode,
        reasoning: classification.reasoning,
      })
      return
    }

    if (classification.mode === 'validate_only') {
      const report = scheduleCommandBus.validate({
        scheduleDate: props.date,
        channelId: props.channelId,
      })

      messages.value.push({
        role: 'assistant',
        content: report.isValid
          ? '当前节目单校验通过，未发现严重问题。'
          : `校验完成，发现 ${report.summary.totalIssues} 个问题，其中严重问题 ${report.summary.criticalCount} 个。`,
        explanation: {
          type: 'validation_issue',
          targetId: report.id,
          explanation: classification.reasoning,
          details: {
            summary: report.summary,
            issues: report.issues.slice(0, 5),
          },
        },
        processType: 'validation',
        processTypeLabel: '校验结果',
        expanded: false,
      })
      return
    }

    messages.value.push({
      role: 'assistant',
      content:
        classification.mode === 'clarify'
          ? '我暂时还不能完全确定你的目标。你可以直接说“全天编排”“补齐空窗”或“在9点插入节目看东方”。'
          : `我识别到你的意图是 ${classification.mode}，不过当前演示优先支持全量编排、局部补排和插入节目。`,
      explanation: {
        type: 'command',
        targetId: 'classification',
        explanation: classification.reasoning,
      },
      processType: 'general',
      processTypeLabel: '任务判别',
      expanded: false,
    })
  } catch (error) {
    messages.value.push({
      role: 'assistant',
      content: error instanceof Error ? error.message : 'AI 请求失败，请稍后重试。',
      processType: 'error',
      processTypeLabel: '执行异常',
      expanded: false,
    })
  } finally {
    loading.value = false
    await scrollToBottom()
  }
}

const buildMicroEditCommand = async (
  userInput: string,
  classificationReasoning: string,
): Promise<{
  command: OrchestrationCommand | null
  message?: string
  explanation?: string
  details?: Record<string, any>
}> => {
  const context = buildDialogueContext({
    scheduleState: {
      channelId: props.channelId,
      channelName: props.channelName,
      date: props.date,
      isEmpty: props.currentSchedule.length === 0,
      itemCount: props.currentSchedule.length,
      gapCount: props.gapCount ?? 0,
      hasSelectedTimeRange: false,
    },
    userInput,
    currentSchedule: props.currentSchedule,
  })

  const intent = await intentRecognizer.recognize(context)
  if (intent.type === 'insert') {
    const params = await paramExtractor.extractInsertParams(context)
    if (!params) {
      return {
        command: null,
        message: '我识别到你想插入节目，但还没能稳定提取时间和节目名。建议使用“在9点插入节目看东方”这种表达。',
      }
    }

    const query = entityLinker.createInsertQuery(context, params)
    const candidates = await candidateService.searchPrograms({
      channelId: query.searchParams.channelId,
      channelName: query.searchParams.channelName,
      programName: query.searchParams.programName,
      limit: 5,
    })

    if (candidates.length === 0) {
      return {
        command: null,
        message: `没有检索到“${params.programName}”的可用节目，请确认节目名或频道。`,
      }
    }

    const selection = await candidateSelectionService.selectForInsert(context, params, candidates)
    const command = entityLinker.createInsertCommand(
      context,
      params,
      selection.selectedCandidate.id,
      selection.selectedCandidate.programName,
    )

    const preview = insertCommandExecutor.preview(command)
    const warningText = preview.warnings.length > 0 ? ` 风险提示：${preview.warnings.join('；')}` : ''

    return {
      command,
      message: `我已按“意图识别 -> 候选检索 -> 候选选择”完成准备，待在 ${params.targetTime} 插入节目《${selection.selectedCandidate.programName}》。`,
      explanation:
        `${classificationReasoning} ${intent.reasoning} ` +
        `检索条件为频道=${props.channelName}、节目名=${params.programName}。` +
        `${selection.reasoning}${warningText}`,
      details: {
        queryCommand: query.queryCommand,
        selectedCandidate: selection.selectedCandidate,
        preview,
      },
    }
  }

  const command = await buildFallbackCommandWithLLM(userInput)
  return {
    command,
    message: command ? '我已根据你的要求生成待执行命令，请确认。' : undefined,
    explanation: classificationReasoning,
  }
}

const buildFallbackCommandWithLLM = async (userInput: string): Promise<OrchestrationCommand | null> => {
  const scheduleSummary = props.currentSchedule
    .slice(0, 12)
    .map(
      (item, index) =>
        `${index + 1}. id=${item.id}, 节目=${item.programName || item.programCode || item.id}, 开始=${item.startTime}, 结束=${item.endTime}`,
    )
    .join('\n')

  const response = await llmClient.chat(
    [
      {
        role: 'system',
        content:
          '你是广播串联单编辑助手。请基于用户要求输出一个 JSON OrchestrationCommand。' +
          '只允许 action 为 delete、replace、move、update_field、clarification。' +
          '如果无法确定，请输出 clarification。只返回 JSON。',
      },
      {
        role: 'user',
        content:
          `频道=${props.channelName} 日期=${props.date}\n` +
          `当前节目单\n${scheduleSummary || '当前为空表'}\n` +
          `用户要求: ${userInput}\n` +
          'JSON 示例: {"action":"delete","data":{"itemId":"xxx"},"reasoning":"..."}',
      },
    ],
    {
      temperature: 0.1,
      maxTokens: 500,
    },
  )

  return parseCommand(response.content)
}

const parseCommand = (content: string): OrchestrationCommand | null => {
  try {
    const match = content.match(/\{[\s\S]*\}/)
    if (!match) return null
    const parsed = JSON.parse(match[0]) as OrchestrationCommand
    if (!parsed.action || !('data' in parsed)) return null
    return parsed
  } catch {
    return null
  }
}

const confirmCommand = async (command: OrchestrationCommand) => {
  const result = await scheduleCommandBus.execute(command, {
    scheduleDate: props.date,
    channelId: props.channelId,
  })

  emit('commandExecuted', { success: result.success, message: result.message })
  if (result.success) {
    ElMessage.success(result.message)
    emit('scheduleUpdated', commandExecutor.getScheduleItems())
  } else {
    ElMessage.error(result.error || result.message)
  }
}

const cancelCommand = (message: Message) => {
  delete message.command
  delete message.explanation
  message.content = '这次命令已取消执行。'
}

const messageHasDetails = (message: Message) => Boolean(message.command || message.explanation?.details || message.explanation?.explanation)

const toggleExpanded = (message: Message) => {
  message.expanded = !(message.expanded ?? false)
}

const scrollToBottom = async () => {
  await nextTick()
  if (messagesContainer.value) {
    messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight
  }
}

const buildLogMessage = (log: PlanningLogEntry): Message => {
  const details = log.details ?? {}

  return {
    role: 'assistant',
    content: summarizeLog(log),
    explanation: {
      type: 'command',
      targetId: log.id,
      explanation:
        typeof details.summary === 'string'
          ? details.summary
          : typeof details.reasoning === 'string'
            ? details.reasoning
            : `${formatPhaseLabel(log.phase)}阶段已更新`,
      details,
    },
    processType: mapLogToProcessType(log),
    processTypeLabel: mapLogToProcessLabel(log),
    expanded: false,
  }
}

const summarizeLog = (log: PlanningLogEntry): string => {
  const details = log.details ?? {}

  if (typeof details.selectedCandidateName === 'string') {
    const reason = typeof details.selectionReason === 'string' ? `，原因：${details.selectionReason}` : ''
    return `已选中节目《${details.selectedCandidateName}》${reason}`
  }

  if (typeof details.candidateCount === 'number') {
    const topCandidates = Array.isArray(details.topCandidates)
      ? details.topCandidates
          .slice(0, 3)
          .map((item) => (typeof item?.programName === 'string' ? item.programName : ''))
          .filter(Boolean)
      : []

    return topCandidates.length > 0
      ? `候选检索完成，共返回 ${details.candidateCount} 个候选：${topCandidates.join('、')}`
      : `候选检索完成，共返回 ${details.candidateCount} 个候选`
  }

  if (details.criteria && typeof details.criteria === 'object') {
    const criteria = details.criteria as Record<string, any>
    const types = Array.isArray(criteria.programTypePreference) ? criteria.programTypePreference.join('、') : ''
    const keywords = Array.isArray(criteria.searchKeywords) ? criteria.searchKeywords.join('、') : ''
    const duration = criteria.expectedDuration
      ? `${criteria.expectedDuration.min}-${criteria.expectedDuration.max}秒`
      : ''
    const parts = [
      types ? `类型=${types}` : '',
      keywords ? `关键词=${keywords}` : '',
      duration ? `时长=${duration}` : '',
    ].filter(Boolean)
    return parts.length > 0 ? `已生成检索参数：${parts.join('，')}` : '已生成候选检索参数'
  }

  if (typeof details.programName === 'string' && typeof details.startTime === 'string') {
    const timeRange = details.endTime ? `${details.startTime}-${details.endTime}` : details.startTime
    return `已插入节目《${details.programName}》，时间 ${timeRange}`
  }

  if (typeof details.issueCount === 'number') {
    return details.issueCount > 0 ? `校验完成，发现 ${details.issueCount} 个问题` : '校验完成，未发现问题'
  }

  if (typeof details.error === 'string') {
    return `处理失败：${details.error}`
  }

  return `编排过程：${log.message}`
}

const formatPhaseLabel = (phase: string) => {
  const mapping: Record<string, string> = {
    planning: '策略规划',
    filling: '空窗填充',
    repair: '修补',
    repairing: '修补',
    validation: '校验',
    session: '会话',
  }
  return mapping[phase] || phase
}

const mapLogToProcessType = (log: PlanningLogEntry): ProcessType => {
  if (log.level === 'error') return 'error'
  if (log.phase === 'validation') return 'validation'
  if ('criteria' in (log.details ?? {}) || 'candidateCount' in (log.details ?? {})) return 'query'
  if ('selectedCandidateId' in (log.details ?? {}) || 'selectedCandidateName' in (log.details ?? {})) return 'selection'
  if ('itemId' in (log.details ?? {}) || 'programName' in (log.details ?? {})) return 'execution'
  if (log.phase === 'planning') return 'planning'
  return 'general'
}

const mapLogToProcessLabel = (log: PlanningLogEntry) => {
  const type = mapLogToProcessType(log)
  const mapping: Record<ProcessType, string> = {
    planning: '编排想法',
    query: '候选查询',
    selection: '候选选择',
    execution: '落表执行',
    validation: '校验结果',
    error: '异常',
    general: '编排过程',
  }
  return mapping[type]
}

watch(
  () => messages.value.length,
  () => {
    void scrollToBottom()
  },
)

watch(
  () => props.orchestrationLogs ?? [],
  (logs) => {
    const newLogs = logs.filter((log) => !displayedLogIds.value.includes(log.id))
    if (newLogs.length === 0) return

    for (const log of newLogs) {
      displayedLogIds.value.push(log.id)
      messages.value.push(buildLogMessage(log))
    }
  },
  { deep: true, immediate: true },
)
</script>

<style scoped lang="scss">
.chat-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: linear-gradient(180deg, #ffffff 0%, #fffaf2 100%);
}

.messages-container {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}

.message-item {
  display: flex;
  margin-bottom: 14px;
}

.message-item.is-user {
  flex-direction: row-reverse;
}

.message-item.is-user .message-content {
  margin-left: 0;
  margin-right: 12px;
  background: #eaf3ff;
}

.message-content {
  margin-left: 12px;
  padding: 10px 14px;
  border-radius: 14px;
  max-width: 82%;
  background: #f4f6fb;
  box-shadow: 0 6px 18px rgba(26, 62, 118, 0.06);
}

.process-summary-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
}

.process-pill {
  display: inline-flex;
  align-items: center;
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.02em;
}

.process-toggle {
  padding: 0;
  font-size: 12px;
}

.process-pill.process-planning,
.message-content.process-planning .explanation-card {
  background: #f5f0ff;
  border-color: #dccdff;
  color: #6b46c1;
}

.process-pill.process-query,
.message-content.process-query .explanation-card {
  background: #eef7ff;
  border-color: #cde6ff;
  color: #1d4ed8;
}

.process-pill.process-selection,
.message-content.process-selection .explanation-card {
  background: #ecfdf3;
  border-color: #c7f3d7;
  color: #15803d;
}

.process-pill.process-execution,
.message-content.process-execution .explanation-card {
  background: #fff7ed;
  border-color: #fed7aa;
  color: #c2410c;
}

.process-pill.process-validation,
.message-content.process-validation .explanation-card {
  background: #eff6ff;
  border-color: #bfdbfe;
  color: #1e40af;
}

.process-pill.process-error,
.message-content.process-error .explanation-card {
  background: #fef2f2;
  border-color: #fecaca;
  color: #b91c1c;
}

.message-text {
  line-height: 1.7;
  color: #223046;
  white-space: pre-wrap;
  word-break: break-word;
}

.command-card,
.explanation-card {
  margin-top: 10px;
  border: 1px solid #e6ecf5;
  border-radius: 12px;
  padding: 12px;
  background: rgba(255, 255, 255, 0.88);
}

.command-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}

.command-reasoning {
  font-size: 12px;
  color: #6b7280;
}

.command-data,
.details-data {
  margin: 0;
  padding: 10px;
  border-radius: 10px;
  background: #0f172a;
  color: #e2e8f0;
  font-size: 12px;
  line-height: 1.6;
  overflow-x: auto;
}

.command-actions {
  display: flex;
  gap: 8px;
  margin-top: 10px;
}

.explanation-content {
  margin-bottom: 10px;
  color: #334155;
  line-height: 1.7;
}

.empty-state {
  min-height: 180px;
  display: grid;
  place-items: center;
  color: #94a3b8;
  text-align: center;
}

.quick-actions {
  display: flex;
  gap: 10px;
  padding: 10px 16px 0;
  flex-wrap: wrap;
}

.input-area {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 10px;
  padding: 16px;
  border-top: 1px solid #e8eef8;
  background: rgba(255, 255, 255, 0.92);
}
</style>
