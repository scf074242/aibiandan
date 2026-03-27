<template>
  <div class="chat-panel">
    <div ref="messagesContainer" class="messages-container">
      <div
        v-for="(message, index) in messages"
        :key="index"
        class="message-item"
        :class="{ 'is-user': message.role === 'user', 'is-assistant': message.role === 'assistant' }"
      >
        <div
          class="message-content"
          :class="[
            message.role === 'user' ? 'user-bubble' : 'system-row',
            message.processType ? `process-${message.processType}` : '',
          ]"
        >
          <div v-if="message.role !== 'user'" class="system-summary-row">
            <span class="process-pill" :class="message.processType ? `process-${message.processType}` : ''">
              {{ message.processTypeLabel || '绯荤粺' }}
            </span>
            <div class="system-summary-text" :title="message.content">{{ message.content }}</div>
            <el-button
              link
              size="small"
              class="process-toggle"
              @click="toggleExpanded(message)"
            >
              {{ message.expanded ? '收起' : '展开' }}
            </el-button>
          </div>

          <div v-if="message.role === 'user'" class="message-text">{{ message.content }}</div>

          <div v-if="message.role !== 'user' && (message.expanded ?? false)" class="explanation-card">
            <div class="explanation-content">{{ message.content }}</div>
            <div v-if="message.explanation?.explanation" class="explanation-content is-secondary">{{ message.explanation.explanation }}</div>
            <pre v-if="message.explanation?.details" class="details-data">{{ formatDetails(message.explanation?.details) }}</pre>
          </div>
        </div>
      </div>

      <div v-if="messages.length === 0 && !loading" class="empty-state">
        <el-icon :size="48"><ChatDotRound /></el-icon>
        <p>输入自然语言需求，AI 会识别意图、生成命令，并按风险级别决定直接执行或请求确认。</p>
      </div>
    </div>

    <div v-if="pendingCommand" class="pending-command-panel">
      <div class="pending-command-header">
        <div>
          <div class="pending-command-title">待确认修改</div>
          <div class="pending-command-summary">{{ pendingCommand.summary }}</div>
        </div>
        <el-tag type="warning" effect="light">高风险</el-tag>
      </div>

      <div class="pending-command-body">
        <div class="pending-command-reasoning">{{ pendingCommand.reasoning }}</div>
        <pre class="pending-command-data">{{ JSON.stringify(pendingCommand.command.data, null, 2) }}</pre>
      </div>

      <div class="pending-command-actions">
        <el-button type="primary" size="small" @click="confirmPendingCommand">确认执行</el-button>
        <el-button size="small" @click="cancelPendingCommand">取消</el-button>
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
        placeholder="例如：在9点插入节目看东方，或把22点的节目向后移动1小时"
        @keydown.enter.prevent="handlePrimaryAction"
      />
      <el-button
        :type="props.isOrchestrating ? 'danger' : 'primary'"
        :disabled="props.isOrchestrating ? !props.canInterrupt : !inputMessage.trim() || loading"
        :loading="loading && !props.isOrchestrating"
        @click="handlePrimaryAction"
      >
        <span v-if="props.isOrchestrating">中止</span>
        <el-icon v-else><Promotion /></el-icon>
      </el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { ChatDotRound, Promotion } from '@element-plus/icons-vue'
import type { ChatMessage } from '@/types/llm'
import type {
  ExplanationResult,
  OrchestrationCommand,
  PlanningLogEntry,
  TaskMode,
} from '@/types/orchestration'
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
import { getOrchestrationDemoColumn } from '@/mock/orchestrationMock'

type ProcessType =
  | 'planning'
  | 'query'
  | 'selection'
  | 'execution'
  | 'validation'
  | 'error'
  | 'general'

interface Message extends ChatMessage {
  explanation?: ExplanationResult
  processType?: ProcessType
  processTypeLabel?: string
  expanded?: boolean
}

interface PendingCommandState {
  command: OrchestrationCommand
  summary: string
  reasoning: string
  details?: Record<string, any>
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
  isOrchestrating?: boolean
  canInterrupt?: boolean
}

const props = defineProps<Props>()
const emit = defineEmits<{
  commandExecuted: [result: { success: boolean; message: string }]
  scheduleUpdated: [items: Props['currentSchedule']]
  orchestrateRequested: [payload: { userInput: string; mode: TaskMode; reasoning: string }]
  cancelRequested: []
}>()

const messages = ref<Message[]>([])
const inputMessage = ref('')
const loading = ref(false)
const messagesContainer = ref<HTMLElement>()
const pendingCommand = ref<PendingCommandState | null>(null)
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
const MAX_DISPLAYED_LOG_IDS = 60
const MAX_MESSAGE_COUNT = 40

const quickActions = [
  { label: '全天编排', prompt: '帮我填充全天节目' },
  { label: '补齐空窗', prompt: '请补齐当前所有空窗' },
  { label: '插入节目', prompt: '在9点插入节目看东方' },
  { label: '后移节目', prompt: '把22点的节目向后移动1小时' },
  { label: '执行校验', prompt: '请校验当前节目单' },
]

const applyQuickAction = (prompt: string) => {
  inputMessage.value = prompt
  void sendMessage()
}

const handlePrimaryAction = async () => {
  if (props.isOrchestrating) {
    if (props.canInterrupt) {
      emit('cancelRequested')
    }
    return
  }

  await sendMessage()
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
          content: result.message || '已识别为局部修改，但暂时无法稳定生成命令。',
          processType: 'general',
          processTypeLabel: '任务识别',
          expanded: false,
        })
        return
      }

      if (requiresConfirmation(result.command)) {
        pendingCommand.value = {
          command: result.command,
          summary: summarizeCommand(result.command),
          reasoning: result.explanation || classification.reasoning,
          details: result.details,
        }
        messages.value.push({
          role: 'assistant',
          content: result.message || '已生成高风险修改，请在下方确认区确认后执行。',
          explanation: {
            type: 'command',
            targetId: 'preview',
            explanation: result.explanation || classification.reasoning,
            details: result.details,
          },
          processType: 'execution',
          processTypeLabel: '待确认',
          expanded: false,
        })
      } else {
        await executeCommand(result.command, {
          successMessage: result.message || `${summarizeCommand(result.command)}，已直接执行。`,
          explanation: result.explanation || classification.reasoning,
          details: result.details,
        })
      }
      return
    }

    if (classification.mode === 'full_generate' || classification.mode === 'partial_generate') {
      messages.value.push({
        role: 'assistant',
        content:
          classification.mode === 'full_generate'
            ? '已识别为全天编排需求，正在准备启动编排流程。'
            : '已识别为局部补排需求，正在准备补齐空窗。',
        explanation: {
          type: 'command',
          targetId: 'orchestration',
          explanation: classification.reasoning,
        },
        processType: 'planning',
        processTypeLabel:
          classification.mode === 'full_generate' ? '任务识别' : '任务识别',
        expanded: false,
      })
      const latestMessage = messages.value[messages.value.length - 1]
      if (latestMessage) {
        latestMessage.content =
          classification.mode === 'full_generate'
            ? '已进入全天编排，将开始按空窗循环检查并补排。'
            : '已进入局部补排，将开始检查目标空窗并补排。',
        latestMessage.explanation = {
          type: 'command',
          targetId: 'orchestration',
          explanation:
            classification.mode === 'full_generate'
              ? '接下来会直接进入空窗检查、候选查询、候选选择和落表执行。'
              : '接下来会围绕目标空窗执行候选查询、选择和落表。',
        }
        latestMessage.processTypeLabel =
          classification.mode === 'full_generate' ? '任务识别' : '任务识别'
      }

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
            ? '我还不能完全确定你的目标。你可以直接说“全天编排”“补齐空窗”或“在9点插入节目看东方”。'
            : `已识别到你的意图是 ${classification.mode}，但当前演示优先支持全天编排、局部补排和插入/移动节目。`,
      explanation: {
        type: 'command',
        targetId: 'classification',
        explanation: classification.reasoning,
      },
      processType: 'general',
      processTypeLabel: '任务识别',
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
        message: '已识别为插入节目，但还不能稳定提取时间和节目名。建议使用“在9点插入节目看东方”。',
      }
    }

    const query = entityLinker.createInsertQuery(context, params)
    const candidates = await candidateService.searchPrograms({
      channelId: query.searchParams.channelId,
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
    const warningText =
      preview.warnings.length > 0 ? ` 风险提示：${preview.warnings.join('；')}` : ''

    return {
      command,
      message: `已定位到候选节目《${selection.selectedCandidate.programName}》，准备插入到 ${params.targetTime}。`,
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

  if (intent.type === 'move') {
    const params = await paramExtractor.extractMoveParams(context)
    if (!params) {
      return {
        command: null,
        message: '已识别为移动节目，但还不能稳定提取目标时间和移动时长。建议使用“把22点的节目向后移动1小时”。',
      }
    }

    const targetItem = findScheduleItemForMove(props.currentSchedule, params.targetTime)
    if (!targetItem) {
      return {
        command: null,
        message: `没有找到 ${params.targetTime} 附近可移动的节目，请确认目标时间点。`,
      }
    }

    const originalStart = normalizeDateTime(props.date, targetItem.startTime)
    const delta = params.direction === 'forward' ? params.offsetSeconds : -params.offsetSeconds
    const newStartTime = offsetDateTime(originalStart, delta)
    const command: OrchestrationCommand = {
      action: 'move',
      reasoning: `将 ${params.targetTime} 对应节目${params.direction === 'forward' ? '向后' : '向前'}移动 ${formatOffset(params.offsetSeconds)}。`,
      data: {
        itemId: targetItem.id,
        newStartTime,
      },
    }

    return {
      command,
      message: `已定位到节目《${targetItem.programName || targetItem.programCode || targetItem.id}》，准备调整开始时间。`,
      explanation: `${classificationReasoning} ${intent.reasoning}`,
      details: {
        targetTime: params.targetTime,
        matchedItem: targetItem,
        direction: params.direction,
        offsetSeconds: params.offsetSeconds,
        newStartTime,
      },
    }
  }

  if (intent.type === 'replace') {
    const params = await paramExtractor.extractReplaceParams(context)
    if (!params) {
      return {
        command: null,
        message:
          '已识别为替换节目，但还不能稳定提取目标时间和替换节目名。建议使用“把10点的节目换成中国考古报道”。',
      }
    }

    const targetItem = findScheduleItemForMove(props.currentSchedule, params.targetTime)
    if (!targetItem) {
      return {
        command: null,
        message: `没有找到 ${params.targetTime} 附近可替换的节目，请确认目标时间点。`,
      }
    }

    const candidates = await candidateService.searchPrograms({
      channelId: props.channelId,
      programName: params.programName,
      limit: 5,
    })

    if (candidates.length === 0) {
      return {
        command: null,
        message: `没有检索到“${params.programName}”的可用节目，请确认节目名。`,
      }
    }

    const selectedCandidate = candidates[0]!
    const command: OrchestrationCommand = {
      action: 'replace',
      reasoning: `将 ${params.targetTime} 对应节目替换为《${selectedCandidate.programName}》。`,
      data: {
        itemId: targetItem.id,
        newCandidateId: selectedCandidate.id,
      },
    }

    return {
      command,
      message: `已定位到 ${params.targetTime} 对应节目，准备替换为《${selectedCandidate.programName}》。`,
      explanation:
        `${classificationReasoning} ${intent.reasoning} 已根据频道=${props.channelName}、节目名=${params.programName} 检索候选并选中最匹配节目。`,
      details: {
        targetTime: params.targetTime,
        matchedItem: targetItem,
        selectedCandidate,
      },
    }
  }

  const command = await buildFallbackCommandWithLLM(userInput)
  return {
    command,
    message: command ? '已根据你的要求生成修改命令。' : undefined,
    explanation: classificationReasoning,
  }
}

const findScheduleItemForMove = (
  items: SchedulePreviewItem[],
  targetTime: string,
): SchedulePreviewItem | null => {
  const exactStart = items.find((item) => normalizeClockText(item.startTime) === targetTime)
  if (exactStart) return exactStart

  const targetSeconds = timeToSeconds(targetTime)
  const covering = items.find((item) => {
    const start = timeToSeconds(normalizeClockText(item.startTime))
    const end = timeToSeconds(normalizeClockText(item.endTime))
    return start <= targetSeconds && targetSeconds < end
  })
  if (covering) return covering

  const sameHour = items.find(
    (item) => normalizeClockText(item.startTime).slice(0, 2) === targetTime.slice(0, 2),
  )
  if (sameHour) return sameHour

  return null
}

const normalizeClockText = (timeText: string): string => {
  if (timeText.includes('T')) {
    return timeText.split('T')[1]?.slice(0, 8) || timeText
  }
  return timeText.length === 5 ? `${timeText}:00` : timeText
}

const formatDisplayTime = (timeText: string): string => {
  const normalized = normalizeClockText(timeText)
  return /^\d{2}:\d{2}(:\d{2})?$/.test(normalized) ? normalized : timeText
}

const formatDisplayTimeRange = (startTime: string, endTime?: string): string => {
  const start = formatDisplayTime(startTime)
  if (!endTime) return start
  return `${start}到${formatDisplayTime(endTime)}`
}

const sanitizeDetails = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeDetails(item))
  }

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    const cloned: Record<string, unknown> = {}

    for (const [key, nestedValue] of Object.entries(record)) {
      if (
        typeof nestedValue === 'string' &&
        ['startTime', 'endTime', 'newStartTime', 'targetTime', 'from', 'to'].includes(key)
      ) {
        cloned[key] = formatDisplayTime(nestedValue)
      } else {
        cloned[key] = sanitizeDetails(nestedValue)
      }
    }

    return cloned
  }

  return value
}

const formatDetails = (details: Record<string, any>) => JSON.stringify(sanitizeDetails(details), null, 2)

const formatProgramTypes = (types: unknown): string => {
  if (!Array.isArray(types)) return ''
  return types.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).join('、')
}

const formatKeywords = (keywords: unknown): string => {
  if (!Array.isArray(keywords)) return ''
  return keywords.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).join('、')
}

const formatExpectedDuration = (expectedDuration: unknown): string => {
  if (!expectedDuration || typeof expectedDuration !== 'object') return ''
  const value = expectedDuration as { min?: number; max?: number }
  if (typeof value.min !== 'number' || typeof value.max !== 'number') return ''
  return `${value.min}-${value.max}秒`
}

const buildQueryCriteriaSummary = (criteria: Record<string, any>): string => {
  const columnName =
    typeof criteria.columnId === 'string' && criteria.columnId.trim()
      ? getOrchestrationDemoColumn(criteria.columnId)?.columnName ?? criteria.columnId
      : ''
  const duration = formatExpectedDuration(criteria.expectedDuration)
  const result = [columnName, duration].filter(Boolean).join('，')
  return result ? `查询：${result}` : '查询：未指定'
}

const truncateText = (text: string, maxLength = 42): string => {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, maxLength)}...`
}

const compressLogDetails = (details: Record<string, any>, processType: ProcessType): Record<string, any> | undefined => {
  const compact = { ...details }

  if (processType === 'planning') {
    delete compact.summary
    delete compact.reasoning
  }

  if (processType === 'selection') {
    delete compact.selectionReason
  }

  return Object.keys(compact).length > 0 ? compact : undefined
}

const shouldDisplayLog = (log: PlanningLogEntry): boolean => {
  const details = log.details ?? {}

  if (log.phase === 'planning' && details.strategy && typeof details.initialGapCount === 'number') {
    return false
  }

  if (log.phase === 'planning' && typeof details.batchGapIds !== 'undefined') {
    return false
  }

  if (log.phase === 'planning' && details.criteria && typeof details.criteria === 'object') {
    return false
  }

  return true
}

const isNoCandidateCase = (details: Record<string, any>) => details.error === 'No candidates found'

const buildFriendlyLogExplanation = (log: PlanningLogEntry, details: Record<string, any>) => {
  if (typeof details.layoutSlotCount === 'number') {
    return `已命中版面参考，并初始化 ${details.layoutSlotCount} 个待处理时段。`
  }

  if (typeof details.existingItemCount === 'number') {
    return `当前编单已有 ${details.existingItemCount} 个节目，本次会基于剩余空窗继续编排。`
  }

  if (isNoCandidateCase(details)) {
    const timeRange =
      typeof details.startTime === 'string'
        ? formatDisplayTimeRange(details.startTime, typeof details.endTime === 'string' ? details.endTime : undefined)
        : '当前空窗'
    return `${timeRange} 在当前栏目约束、类型偏好和关键词条件下，暂未找到合适节目。建议后续尝试调整编排内容、放宽检索条件，或改用其他栏目方案继续补排。`
  }

  if (typeof details.summary === 'string') {
    return '已结合空窗位置、栏目约束和前后节目衔接生成建议，展开后可查看结构化信息。'
  }

  if (typeof details.reasoning === 'string') {
    return truncateText(details.reasoning, 60)
  }

  return `${formatPhaseLabel(log.phase)}阶段已更新`
}

const timeToSeconds = (timeText: string): number => {
  const [hours = 0, minutes = 0, seconds = 0] = normalizeClockText(timeText)
    .split(':')
    .map(Number)
  return hours * 3600 + minutes * 60 + seconds
}

const normalizeDateTime = (date: string, timeText: string): string => {
  if (timeText.includes('T')) {
    return timeText.includes('+08:00') ? timeText : `${timeText}+08:00`
  }
  return `${date}T${normalizeClockText(timeText)}+08:00`
}

const offsetDateTime = (dateTime: string, offsetSeconds: number): string => {
  const shifted = new Date(dateTime).getTime() + offsetSeconds * 1000
  const date = new Date(shifted)
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  const hours = `${date.getHours()}`.padStart(2, '0')
  const minutes = `${date.getMinutes()}`.padStart(2, '0')
  const seconds = `${date.getSeconds()}`.padStart(2, '0')
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}+08:00`
}

const formatOffset = (offsetSeconds: number): string => {
  if (offsetSeconds % 3600 === 0) return `${offsetSeconds / 3600}小时`
  if (offsetSeconds % 60 === 0) return `${offsetSeconds / 60}分钟`
  return `${offsetSeconds}秒`
}

const buildFallbackCommandWithLLM = async (userInput: string): Promise<OrchestrationCommand | null> => {
  const scheduleSummary = props.currentSchedule
    .slice(0, 12)
    .map(
      (item, index) =>
        `${index + 1}. id=${item.id}, 节目=${item.programName || item.programCode || item.id}, 时间=${formatDisplayTimeRange(item.startTime, item.endTime)}`,
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
          `棰戦亾=${props.channelName} 鏃ユ湡=${props.date}\n` +
          `当前节目单：\n${scheduleSummary || '当前为空表'}\n` +
          `鐢ㄦ埛瑕佹眰锛?{userInput}\n` +
          'JSON 绀轰緥锛歿"action":"delete","data":{"itemId":"xxx"},"reasoning":"..."}',
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

const executeCommand = async (
  command: OrchestrationCommand,
  options?: {
    successMessage?: string
    explanation?: string
    details?: Record<string, any>
  },
) => {
  const result = await scheduleCommandBus.execute(command, {
    scheduleDate: props.date,
    channelId: props.channelId,
  })

  emit('commandExecuted', { success: result.success, message: result.message })
  if (result.success) {
    ElMessage.success(result.message)
    emit('scheduleUpdated', commandExecutor.getScheduleItems())
    messages.value.push({
      role: 'assistant',
      content: options?.successMessage || `${summarizeCommand(command)}，执行成功。`,
      explanation: options?.explanation
        ? {
            type: 'command',
            targetId: 'execution-result',
            explanation: options.explanation,
            details: {
              ...(options.details ?? {}),
              validationSummary: result.validationReport?.summary,
            },
          }
        : undefined,
      processType: 'execution',
      processTypeLabel: '执行完成',
      expanded: false,
    })
  } else {
    ElMessage.error(result.error || result.message)
    messages.value.push({
      role: 'assistant',
      content: result.error || result.message,
      explanation: options?.explanation
        ? {
            type: 'command',
            targetId: 'execution-error',
            explanation: options.explanation,
            details: options.details,
          }
        : undefined,
      processType: 'error',
      processTypeLabel: '执行失败',
      expanded: false,
    })
  }
}

const confirmPendingCommand = async () => {
  if (!pendingCommand.value) return
  const current = pendingCommand.value
  pendingCommand.value = null
  await executeCommand(current.command, {
    successMessage: `${current.summary}，已按确认执行。`,
    explanation: current.reasoning,
    details: current.details,
  })
}

const cancelPendingCommand = () => {
  if (!pendingCommand.value) return
  messages.value.push({
    role: 'assistant',
    content: `${pendingCommand.value.summary}，已取消执行。`,
    processType: 'general',
    processTypeLabel: '已取消',
    expanded: false,
  })
  pendingCommand.value = null
}

const requiresConfirmation = (command: OrchestrationCommand): boolean =>
  ['delete', 'replace'].includes(command.action)

const summarizeCommand = (command: OrchestrationCommand): string => {
  switch (command.action) {
    case 'delete':
      return '删除已编排节目'
    case 'replace':
      return '替换已编排节目'
    case 'move':
      return '修改节目开始时间'
    case 'insert':
      return '鎻掑叆鑺傜洰'
    case 'update_field':
      return '淇敼鑺傜洰瀛楁'
    default:
      return `执行 ${command.action} 命令`
  }
}

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
  const processType = mapLogToProcessType(log)
  const explanationDetails = compressLogDetails(details, processType)

  return {
    role: 'assistant',
    content: summarizeRuntimeLog(log),
    explanation: {
      type: 'command',
      targetId: log.id,
      explanation: buildFriendlyLogExplanation(log, details),
      details: explanationDetails,
    },
    processType,
    processTypeLabel: mapRuntimeLogToProcessLabel(log),
    expanded: false,
  }
}

const appendSystemLogMessage = (message: Message) => {
  const lastMessage = messages.value[messages.value.length - 1]
  if (
    lastMessage &&
    lastMessage.role !== 'user' &&
    lastMessage.processType === message.processType &&
    lastMessage.content === message.content
  ) {
    return
  }

  messages.value.push(message)
}

const summarizeLog = (log: PlanningLogEntry): string => {
  const details = log.details ?? {}

  if (Array.isArray(details.gapRanges) && details.gapRanges.length > 0) {
    const ranges = details.gapRanges
      .slice(0, 3)
      .map((item) =>
        typeof item?.startTime === 'string'
          ? formatDisplayTimeRange(item.startTime, typeof item?.endTime === 'string' ? item.endTime : undefined)
          : '',
      )
      .filter(Boolean)

    return ranges.length > 0 ? `发现待处理空窗：${ranges.join('；')}` : '发现待处理空窗'
  }

  if (typeof details.selectedCandidateName === 'string') {
    const gapRange =
      typeof details.startTime === 'string'
        ? `锛屽搴旂┖绐?${formatDisplayTimeRange(details.startTime, typeof details.endTime === 'string' ? details.endTime : undefined)}`
        : ''
    return `已选中节目《${details.selectedCandidateName}》${gapRange}`
  }

  if (typeof details.selectedCandidateName === 'string') {
    const reason =
      typeof details.selectionReason === 'string' ? `，原因：${details.selectionReason}` : ''
    const gapRange =
      typeof details.startTime === 'string'
        ? `，对应空窗 ${formatDisplayTimeRange(details.startTime, typeof details.endTime === 'string' ? details.endTime : undefined)}`
        : ''
    return `已选中节目《${details.selectedCandidateName}》${gapRange}${reason}`
  }

  if (typeof details.candidateCount === 'number') {
    return `查询结果：${details.candidateCount} 个`
  }

  if (details.criteria && typeof details.criteria === 'object') {
    const criteria = details.criteria as Record<string, any>
    return buildQueryCriteriaSummary(criteria)
  }

  if (typeof details.programName === 'string' && typeof details.startTime === 'string') {
    const timeRange = formatDisplayTimeRange(details.startTime, typeof details.endTime === 'string' ? details.endTime : undefined)
    return `已插入节目《${details.programName}》，时间 ${timeRange}`
  }

  if (typeof details.gapId === 'string' && typeof details.error === 'string') {
    const timeRange =
      typeof details.startTime === 'string'
        ? formatDisplayTimeRange(details.startTime, typeof details.endTime === 'string' ? details.endTime : undefined)
        : ''
    return timeRange ? `空窗 ${timeRange} 处理失败：${details.error}` : `处理失败：${details.error}`
  }

  if (typeof details.summary === 'string') {
    const timeRange =
      typeof details.startTime === 'string'
        ? formatDisplayTimeRange(details.startTime, typeof details.endTime === 'string' ? details.endTime : undefined)
        : ''
    const compactSummary = truncateText(details.summary, 34)
    return timeRange ? `空窗 ${timeRange} 的编排想法：${compactSummary}` : `编排想法：${compactSummary}`
  }

  if (typeof details.gapId === 'string') {
    const timeRange =
      typeof details.startTime === 'string'
        ? formatDisplayTimeRange(details.startTime, typeof details.endTime === 'string' ? details.endTime : undefined)
        : typeof details.targetTimeRange === 'string'
          ? details.targetTimeRange
          : ''
    if (timeRange) {
      return `发现空窗 ${timeRange}`
    }
  }

  if (typeof details.issueCount === 'number') {
    return details.issueCount > 0
      ? `校验完成，发现 ${details.issueCount} 个问题`
      : '校验完成，未发现问题'
  }

  if (typeof details.error === 'string') {
    return `处理失败：${details.error}`
  }

  return `编排过程：${log.message}`
}

const summarizeRuntimeLog = (log: PlanningLogEntry): string => {
  const details = log.details ?? {}

  if (typeof details.layoutSlotCount === 'number') {
    return `已命中版面参考，初始化 ${details.layoutSlotCount} 个待处理时段`
  }

  if (typeof details.existingItemCount === 'number') {
    return `保留当前编单，基于剩余空窗继续编排`
  }

  if (isNoCandidateCase(details)) {
    const timeRange =
      typeof details.startTime === 'string'
        ? formatDisplayTimeRange(details.startTime, typeof details.endTime === 'string' ? details.endTime : undefined)
        : ''
    return timeRange ? `空窗 ${timeRange} 当前未找到合适节目` : '当前未找到合适节目'
  }

  if (Array.isArray(details.gapRanges) && details.gapRanges.length > 0) {
    const ranges = details.gapRanges
      .slice(0, 3)
      .map((item) =>
        typeof item?.startTime === 'string'
          ? formatDisplayTimeRange(item.startTime, typeof item?.endTime === 'string' ? item.endTime : undefined)
          : '',
      )
      .filter(Boolean)

    return ranges.length > 0 ? `发现待处理空窗：${ranges.join('；')}` : '发现待处理空窗'
  }

  if (typeof details.selectedCandidateName === 'string') {
    const gapRange =
      typeof details.startTime === 'string'
        ? `，对应空窗 ${formatDisplayTimeRange(details.startTime, typeof details.endTime === 'string' ? details.endTime : undefined)}`
        : ''
    return `已选中节目《${details.selectedCandidateName}》${gapRange}`
  }

  if (typeof details.selectedCandidateName === 'string') {
    const reason = typeof details.selectionReason === 'string' ? `，原因：${details.selectionReason}` : ''
    const gapRange =
      typeof details.startTime === 'string'
        ? `，对应空窗 ${formatDisplayTimeRange(details.startTime, typeof details.endTime === 'string' ? details.endTime : undefined)}`
        : ''
    return `已选中节目《${details.selectedCandidateName}》${gapRange}${reason}`
  }

  if (typeof details.candidateCount === 'number') {
    return `查询结果：${details.candidateCount} 个`
  }

  if (details.criteria && typeof details.criteria === 'object') {
    const criteriaSummary = buildQueryCriteriaSummary(details.criteria as Record<string, any>)
    return criteriaSummary ? `接口查询参数：${criteriaSummary}` : '接口查询参数已生成'
  }

  if (typeof details.programName === 'string' && typeof details.startTime === 'string') {
    const timeRange = formatDisplayTimeRange(
      details.startTime,
      typeof details.endTime === 'string' ? details.endTime : undefined,
    )
    return `已插入节目《${details.programName}》，时间 ${timeRange}`
  }

  if (typeof details.gapId === 'string' && typeof details.error === 'string') {
    const timeRange =
      typeof details.startTime === 'string'
        ? formatDisplayTimeRange(details.startTime, typeof details.endTime === 'string' ? details.endTime : undefined)
        : ''
    return timeRange ? `空窗 ${timeRange} 处理失败：${details.error}` : `处理失败：${details.error}`
  }

  if (typeof details.summary === 'string') {
    const timeRange =
      typeof details.startTime === 'string'
        ? formatDisplayTimeRange(details.startTime, typeof details.endTime === 'string' ? details.endTime : undefined)
        : ''
    const compactSummary = truncateText(details.summary, 34)
    return timeRange ? `空窗 ${timeRange} 的编排想法：${compactSummary}` : `编排想法：${compactSummary}`
  }

  if (typeof details.gapId === 'string') {
    const timeRange =
      typeof details.startTime === 'string'
        ? formatDisplayTimeRange(details.startTime, typeof details.endTime === 'string' ? details.endTime : undefined)
        : typeof details.targetTimeRange === 'string'
          ? details.targetTimeRange
          : ''
    if (timeRange) {
      return `发现空窗 ${timeRange}`
    }
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
  if (isNoCandidateCase(log.details ?? {})) return 'planning'
  if (log.level === 'error') return 'error'
  if (log.phase === 'validation') return 'validation'
  if ('itemId' in (log.details ?? {}) || 'programName' in (log.details ?? {})) return 'execution'
  if ('criteria' in (log.details ?? {}) || 'candidateCount' in (log.details ?? {})) return 'query'
  if (
    'selectedCandidateId' in (log.details ?? {}) ||
    'selectedCandidateName' in (log.details ?? {})
  )
    return 'selection'
  if (log.phase === 'planning') return 'planning'
  return 'general'
}

const mapLogToProcessLabel = (log: PlanningLogEntry) => {
  const type = mapLogToProcessType(log)
  const mapping: Record<ProcessType, string> = {
    planning: '想法',
    query: '查询',
    selection: '选择',
    execution: '执行',
    validation: '校验',
    error: '异常',
    general: '过程',
  }
  return mapping[type]
}

const mapRuntimeLogToProcessLabel = (log: PlanningLogEntry) => {
  const type = mapLogToProcessType(log)
  const mapping: Record<ProcessType, string> = {
    planning: '想法',
    query: '查询',
    selection: '选择',
    execution: '执行',
    validation: '校验',
    error: '异常',
    general: '过程',
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
  () => props.orchestrationLogs?.length ?? 0,
  (count) => {
    if (!count || !props.isOrchestrating) return
    const logs = props.orchestrationLogs ?? []
    const unseenLogs = logs.filter((log) => !displayedLogIds.value.includes(log.id))
    if (unseenLogs.length === 0) return

    for (const log of unseenLogs) {
      displayedLogIds.value.push(log.id)
      if (!shouldDisplayLog(log)) continue
      appendSystemLogMessage(buildLogMessage(log))
    }

    if (displayedLogIds.value.length > MAX_DISPLAYED_LOG_IDS) {
      displayedLogIds.value.splice(0, displayedLogIds.value.length - MAX_DISPLAYED_LOG_IDS)
    }

    if (messages.value.length > MAX_MESSAGE_COUNT) {
      messages.value.splice(0, messages.value.length - MAX_MESSAGE_COUNT)
    }
  },
  { immediate: true },
)
</script>

<style scoped lang="scss">
.chat-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background:
    radial-gradient(circle at top left, rgba(251, 146, 60, 0.12), transparent 24%),
    linear-gradient(180deg, #fffdf9 0%, #fff8ef 100%);
}

.messages-container {
  flex: 1;
  overflow-y: auto;
  padding: 18px 18px 10px;
}

.message-item {
  margin-bottom: 14px;
}

.message-item.is-user {
  display: flex;
  justify-content: flex-end;
}

.message-content {
  width: 100%;
}

.user-bubble {
  width: auto;
  max-width: 88%;
  padding: 13px 16px;
  border-radius: 18px 18px 6px 18px;
  background: linear-gradient(135deg, #111827 0%, #334155 100%);
  color: #fff7ed;
  box-shadow: 0 10px 26px rgba(15, 23, 42, 0.18);
}

.system-row {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid rgba(251, 146, 60, 0.1);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.76);
  box-shadow: 0 2px 8px rgba(120, 53, 15, 0.05);
}

.system-summary-row {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.system-summary-text {
  min-width: 0;
  font-size: 13px;
  line-height: 1.5;
  color: #223046;
  white-space: normal;
  word-break: break-all;
}

.process-pill {
  display: inline-flex;
  align-items: center;
  padding: 5px 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.02em;
  border: 1px solid transparent;
}

.process-toggle {
  padding: 0;
  font-size: 12px;
  justify-self: end;
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

.user-bubble .message-text {
  color: #fff7ed;
}

.explanation-card {
  margin-top: 2px;
  border: 1px solid #e6ecf5;
  border-radius: 12px;
  padding: 12px;
  background: rgba(255, 255, 255, 0.88);
}

.explanation-content {
  font-size: 13px;
  line-height: 1.7;
}

.explanation-content.is-secondary {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid rgba(148, 163, 184, 0.18);
  color: #475569;
}

.details-data,
.pending-command-data {
  margin: 10px 0 0;
  padding: 12px;
  background: #0f172a;
  color: #e2e8f0;
  border-radius: 10px;
  font-size: 12px;
  line-height: 1.6;
  overflow-x: auto;
}

.pending-command-panel {
  margin: 0 18px 12px;
  border: 1px solid #f5c77b;
  border-radius: 18px;
  background: linear-gradient(180deg, #fffaf0 0%, #fff6e6 100%);
  box-shadow: 0 10px 24px rgba(191, 101, 18, 0.08);
}

.pending-command-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 18px 8px;
}

.pending-command-title {
  font-size: 14px;
  font-weight: 700;
  color: #9a3412;
}

.pending-command-summary {
  margin-top: 4px;
  color: #7c2d12;
  line-height: 1.6;
}

.pending-command-body {
  padding: 0 18px 12px;
}

.pending-command-reasoning {
  color: #6b3b14;
  line-height: 1.7;
}

.pending-command-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 0 18px 16px;
}

.empty-state {
  min-height: 240px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  color: #9aa7b8;
  text-align: center;
}

.quick-actions {
  display: flex;
  gap: 10px;
  padding: 12px 18px 0;
  flex-wrap: wrap;
}

.quick-actions :deep(.el-button) {
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.86);
}

.input-area {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 10px;
  padding: 18px;
  border-top: 1px solid rgba(251, 146, 60, 0.12);
  background: rgba(255, 255, 255, 0.92);
}

.input-area :deep(.el-textarea__inner) {
  min-height: 76px;
  padding: 12px 14px;
}

@media (max-width: 768px) {
  .messages-container,
  .quick-actions,
  .input-area {
    padding-left: 14px;
    padding-right: 14px;
  }

  .input-area {
    grid-template-columns: 1fr;
  }
}
</style>

