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
            <div class="system-summary-main">
              <div class="system-summary-text" :title="message.content">{{ message.content }}</div>
              <div v-if="shouldShowReasonTags(message)" class="reason-tag-row">
                <span
                  v-for="tag in message.reasonTags"
                  :key="tag"
                  class="reason-tag"
                >
                  {{ tag }}
                </span>
              </div>
              <div
                v-if="shouldShowDefaultExplanation(message)"
                class="system-thinking-text"
                :title="message.thinking"
              >
                {{ message.thinking }}
              </div>
            </div>
            <el-button
              v-if="hasExpandableExplanation(message)"
              link
              size="small"
              class="process-toggle"
              @click="toggleExpanded(message)"
            >
              {{ message.expanded ? '收起依据' : '查看依据' }}
            </el-button>
          </div>

          <div v-if="message.role === 'user'" class="message-text">{{ message.content }}</div>

          <div v-if="message.role !== 'user' && (message.expanded ?? false)" class="explanation-card">
            <div
              v-for="section in getExpandedSections(message)"
              :key="section.title"
              class="explanation-section"
            >
              <div class="explanation-title">{{ section.title }}</div>
              <div
                class="explanation-content"
                :class="{
                  'is-secondary': section.tone === 'secondary',
                  'is-risk': section.tone === 'risk',
                }"
              >
                {{ section.body }}
              </div>
            </div>

            <div
              v-if="getCandidateComparisonItems(message).length > 0"
              class="candidate-comparison-panel"
            >
              <div class="explanation-title">候选方案对比</div>
              <div class="candidate-comparison-list">
                <div
                  v-for="candidate in getCandidateComparisonItems(message)"
                  :key="candidate.id"
                  class="candidate-comparison-item"
                  :class="{ 'is-selected': candidate.selected }"
                >
                  <div class="candidate-comparison-main">
                    <div class="candidate-comparison-name">
                      {{ candidate.name }}
                      <span v-if="candidate.selected" class="candidate-comparison-badge">本次采用</span>
                    </div>
                    <div class="candidate-comparison-meta">{{ candidate.meta }}</div>
                  </div>
                  <div class="candidate-comparison-note">{{ candidate.note }}</div>
                </div>
              </div>
            </div>

            <div
              v-if="getDetailsSummaryItems(message).length > 0 || message.explanation?.details"
              class="details-panel"
            >
              <el-button link size="small" class="details-toggle" @click="toggleDetailExpanded(message)">
                {{ message.detailExpanded ? '收起明细' : '查看明细' }}
              </el-button>
              <div v-if="message.detailExpanded" class="details-summary-list">
                <div
                  v-for="item in getDetailsSummaryItems(message)"
                  :key="item.label"
                  class="detail-summary-item"
                >
                  <span class="detail-summary-label">{{ item.label }}</span>
                  <span class="detail-summary-value">{{ item.value }}</span>
                </div>

                <div v-if="message.explanation?.details" class="raw-details-block">
                  <el-button link size="small" class="raw-details-toggle" @click="toggleRawDetails(message)">
                    {{ message.rawDetailsExpanded ? '收起原始明细' : '查看原始明细' }}
                  </el-button>
                  <pre v-if="message.rawDetailsExpanded" class="details-data">{{ formatDetails(message.explanation?.details) }}</pre>
                </div>
              </div>
            </div>
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
        <div v-if="getPendingCommandReasonTags().length" class="reason-tag-row is-panel">
          <span v-for="tag in getPendingCommandReasonTags()" :key="tag" class="reason-tag">
            {{ tag }}
          </span>
        </div>
        <div v-if="getPendingCommandDetailItems().length" class="details-summary-list is-panel">
          <div
            v-for="item in getPendingCommandDetailItems()"
            :key="item.label"
            class="detail-summary-item"
          >
            <span class="detail-summary-label">{{ item.label }}</span>
            <span class="detail-summary-value">{{ item.value }}</span>
          </div>
        </div>
      </div>

      <div class="pending-command-actions">
        <el-button type="primary" size="small" @click="confirmPendingCommand">确认执行</el-button>
        <el-button size="small" @click="cancelPendingCommand">取消</el-button>
      </div>
    </div>

    <div v-if="pendingTargetSelection" class="pending-command-panel">
      <div class="pending-command-header">
        <div>
          <div class="pending-command-title">待确认目标</div>
          <div class="pending-command-summary">{{ pendingTargetSelection.summary }}</div>
        </div>
        <el-tag type="info" effect="light">需选择</el-tag>
      </div>

      <div class="pending-command-body">
        <div class="pending-command-reasoning">{{ pendingTargetSelection.reasoning }}</div>
        <el-radio-group v-model="pendingTargetSelection.selectedItemId" class="target-selection-list">
          <el-radio
            v-for="candidate in pendingTargetSelection.candidates"
            :key="candidate.id"
            :value="candidate.id"
            class="target-selection-option"
          >
            {{ formatDisplayTimeRange(candidate.startTime, candidate.endTime) }} {{ candidate.programName || candidate.programCode || candidate.id }}
          </el-radio>
        </el-radio-group>
      </div>

      <div class="pending-command-actions">
        <el-button type="primary" size="small" :disabled="!pendingTargetSelection.selectedItemId" @click="confirmPendingTargetSelection">
          确认目标
        </el-button>
        <el-button size="small" @click="cancelPendingTargetSelection">取消</el-button>
      </div>
    </div>

    <div class="quick-actions">
      <el-button v-for="action in quickActions" :key="action.label" size="small" @click="applyQuickAction(action.prompt)">
        {{ action.label }}
      </el-button>
    </div>

    <div v-if="activeImportedLayoutName" class="layout-upload-status">
      <span class="layout-upload-label">当前版面参考</span>
      <span class="layout-upload-name" :title="activeImportedLayoutName">{{ activeImportedLayoutName }}</span>
      <el-button link size="small" class="layout-upload-clear" @click="clearImportedLayout">清除</el-button>
    </div>

    <div class="input-area">
      <input
        ref="layoutFileInput"
        type="file"
        accept=".xls,.xlsx"
        class="layout-file-input"
        @change="handleLayoutFileChange"
      >
      <el-input
        v-model="inputMessage"
        type="textarea"
        :rows="2"
        placeholder="例如：在9点插入节目看东方，或把22点的节目向后移动1小时"
        @keydown.enter.prevent="handlePrimaryAction"
      />
      <el-button
        :loading="uploadingLayout"
        :disabled="props.isOrchestrating"
        class="layout-upload-button"
        @click="openLayoutUpload"
      >
        <el-icon><UploadFilled /></el-icon>
      </el-button>
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
import { ChatDotRound, Promotion, UploadFilled } from '@element-plus/icons-vue'
import type { ChatMessage } from '@/types/llm'
import type {
  ExplanationResult,
  OrchestrationCommand,
  PlanningLogEntry,
  PlanningSession,
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
import { getReplaceCommandExecutor } from '@/services/replaceCommandExecutor'
import { getScheduleCommandBus } from '@/services/scheduleCommandBus'
import { getScheduleTargetResolver } from '@/services/scheduleTargetResolver'
import { getLayoutImportService } from '@/services/layoutImportService'
import {
  clearRuntimeLayout,
  getEffectiveColumnDefinition,
  getEffectiveLayoutReference,
  getRuntimeLayoutEntry,
  setRuntimeLayout,
} from '@/services/orchestration/runtimeLayoutRegistry'
import {
  formatDetails as formatStructuredDetails,
  formatOffset as formatOffsetText,
  formatProgramLabel as formatProgramDisplayLabel,
  normalizeDecisionExplanation,
  toDetailMap,
  toPreviewRecord,
  toValidationSummaryRecord,
  truncateText,
} from './chatPanelFormatting'
import type {
  CandidateComparisonItem,
  DetailMap,
  DetailSummaryItem,
  ExplanationSection,
  ProgramRecord,
} from './chatPanelFormatting'
import {
  buildCandidateComparisonItems,
  buildDetailsSummary as buildMessageDetailsSummary,
  extractWarnings,
  isLayoutImportDetails,
  isOrchestrationOverviewDetails,
} from './chatPanelDetails'

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
  thinking?: string
  reasonTags?: string[]
  detailExpanded?: boolean
  rawDetailsExpanded?: boolean
  mergeKey?: string
  mergeKind?: 'idea' | 'query_request' | 'query_result' | 'selection' | 'execution' | 'other'
}

interface PendingCommandState {
  command: OrchestrationCommand
  summary: string
  reasoning: string
  details?: DetailMap
}

interface PendingTargetSelectionState {
  action: 'delete' | 'move' | 'replace'
  summary: string
  reasoning: string
  targetTime: string
  programName?: string
  candidates: SchedulePreviewItem[]
  selectedItemId: string | null
  moveConfig?: {
    direction: 'forward' | 'backward'
    offsetSeconds: number
  }
  replaceProgramName?: string
  resolutionDetails?: DetailMap
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
  orchestrationSession?: PlanningSession | null
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
const layoutFileInput = ref<HTMLInputElement>()
const pendingCommand = ref<PendingCommandState | null>(null)
const pendingTargetSelection = ref<PendingTargetSelectionState | null>(null)
const commandExecutor = getCommandExecutor()
const insertCommandExecutor = getInsertCommandExecutor()
const replaceCommandExecutor = getReplaceCommandExecutor()
const scheduleCommandBus = getScheduleCommandBus()
const llmClient = getLLMClient()
const taskClassifier = getTaskClassifier(llmClient)
const intentRecognizer = getIntentRecognizer(llmClient)
const paramExtractor = getParamExtractor(llmClient)
const entityLinker = getEntityLinker()
const candidateService = getCandidateService()
const candidateSelectionService = getCandidateSelectionService(llmClient)
const scheduleTargetResolver = getScheduleTargetResolver(llmClient)
const layoutImportService = getLayoutImportService()
const displayedLogIds = ref<string[]>([])
const lastSummarySessionId = ref('')
const uploadingLayout = ref(false)
const activeImportedLayoutName = ref('')
const MAX_DISPLAYED_LOG_IDS = 60
const MAX_MESSAGE_COUNT = 40
const MAX_RUNTIME_PROGRESS_MESSAGES = 24

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

const syncImportedLayoutState = () => {
  activeImportedLayoutName.value = getRuntimeLayoutEntry(props.channelId, props.date)?.sourceFileName ?? ''
}

const openLayoutUpload = () => {
  layoutFileInput.value?.click()
}

const clearImportedLayout = () => {
  clearRuntimeLayout(props.channelId, props.date)
  getCandidateService().clearCache()
  syncImportedLayoutState()
  messages.value.push(buildAssistantMessage({
    content: '已清除当前上传版面，后续编排会回退到默认版面参考。',
    processType: 'planning',
    processTypeLabel: '版面参考',
    explanation: {
      type: 'command',
      targetId: `layout-cleared-${Date.now()}`,
      explanation: '已移除本轮运行时版面参考，后续会继续使用系统默认版面。',
      details: {
        summaryKind: 'layout_import',
        action: 'clear',
        channelId: props.channelId,
        date: props.date,
      },
    },
  }))
}

const handleLayoutFileChange = async (event: Event) => {
  const target = event.target as HTMLInputElement | null
  const file = target?.files?.[0]
  if (!file || uploadingLayout.value) {
    if (target) target.value = ''
    return
  }

  uploadingLayout.value = true
  try {
    const imported = await layoutImportService.importFile(file, props.channelId, props.date)
    setRuntimeLayout(imported)
    getCandidateService().clearCache()
    syncImportedLayoutState()
    const importTargetLabel = imported.matchedColumnLabel || imported.matchedWeekdayLabel || imported.matchedSheetName
    const importScopeText = imported.matchedWeekdayLabel && importTargetLabel
      ? `当前编排单为${imported.matchedWeekdayLabel}，已自动采用“${importTargetLabel}”数据。`
      : imported.matchedSheetName
        ? `已按工作表“${imported.matchedSheetName}”导入当前日期版面。`
        : '后续编排将优先参考该版面。'
    const importExplanation = imported.templateMode === 'weekday_columns'
      ? `已按当前编排单日期命中 ${imported.matchedWeekdayLabel || '对应星期'}，并采用“${importTargetLabel || '当前星期列'}”生成当天版面。`
      : imported.templateMode === 'visual_weekday_grid'
        ? `已按当前编排单日期命中 ${imported.matchedWeekdayLabel || '对应星期'}，并从该星期列的可视化版面块中提取出当天版面。`
      : imported.templateMode === 'weekday_sheet'
        ? `已按当前编排单日期命中对应星期工作表“${imported.matchedSheetName || importTargetLabel || '当前工作表'}”，并将其注册为当天版面。`
        : '未识别到对应星期列，已按单表版面导入当前日期数据。'

    messages.value.push(buildAssistantMessage({
      content: `已导入版面《${imported.sourceFileName}》，${importScopeText}`,
      processType: 'planning',
      processTypeLabel: '版面参考',
      explanation: {
        type: 'command',
        targetId: `layout-import-${Date.now()}`,
        explanation: importExplanation,
        details: {
          summaryKind: 'layout_import',
          fileName: imported.sourceFileName,
          templateMode: imported.templateMode,
          matchedSheetName: imported.matchedSheetName,
          matchedWeekdayLabel: imported.matchedWeekdayLabel,
          matchedColumnLabel: imported.matchedColumnLabel,
          slotCount: imported.layoutReference.slots.length,
          columnCount: imported.columns.length,
          sequentialColumnCount: imported.columns.filter((column) => column.isSequential).length,
          warnings: imported.warnings,
        },
      },
    }))

    ElMessage.success(`版面文件已导入${imported.matchedWeekdayLabel ? `，已命中${imported.matchedWeekdayLabel}` : ''}`)
  } catch (error) {
    const message = error instanceof Error ? error.message : '版面文件导入失败'
    messages.value.push(buildAssistantMessage({
      content: `版面导入失败：${message}`,
      processType: 'error',
      processTypeLabel: '版面导入',
      explanation: {
        type: 'command',
        targetId: `layout-import-error-${Date.now()}`,
        explanation: '文件未能成功解析为版面参考，请检查表头、时间列和工作表内容。',
        details: {
          summaryKind: 'layout_import',
          fileName: file.name,
          error: message,
        },
      },
    }))
    ElMessage.error(message)
  } finally {
    uploadingLayout.value = false
    if (target) target.value = ''
  }
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

  // 新用户命令到来时，先清理上一次遗留的确认态，避免旧面板和新执行结果叠在一起
  pendingCommand.value = null
  pendingTargetSelection.value = null

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
      if (result.pendingTargetSelection) {
        messages.value.push(buildAssistantMessage({
          content: result.message || '我找到了多个可能的目标，请先确认具体要操作的节目。',
          thinking: result.thinking,
          explanation: result.explanation
            ? {
                type: 'command',
                targetId: 'pending-target-selection',
                explanation: result.explanation,
                details: result.details,
              }
            : undefined,
          processType: 'selection',
          processTypeLabel: '待确认',
        }))
        pendingTargetSelection.value = result.pendingTargetSelection
        return
      }
      if (!result.command) {
        messages.value.push(buildAssistantMessage({
          content: result.message || '已识别为局部修改，但暂时无法稳定生成命令。',
          thinking: result.thinking,
          processType: 'general',
          processTypeLabel: '未执行',
        }))
        return
      }

      if (requiresConfirmation(result.command)) {
        messages.value.push(buildAssistantMessage({
          content: result.message || '请确认后执行本次修改。',
          thinking: result.thinking,
          explanation: result.explanation
            ? {
                type: 'command',
                targetId: 'pending-command',
                explanation: result.explanation,
                details: result.details,
              }
            : undefined,
          processType: 'execution',
          processTypeLabel: '待确认',
        }))
        pendingCommand.value = {
          command: result.command,
          summary: summarizeCommand(result.command),
          reasoning: result.explanation || classification.reasoning,
          details: result.details,
        }
      } else {
        await executeCommand(result.command, {
          successMessage: result.message || `${summarizeCommand(result.command)}，已直接执行。`,
          thinking: result.thinking,
          explanation: result.explanation || classification.reasoning,
          details: result.details,
        })
      }
      return
    }

    if (classification.mode === 'full_generate' || classification.mode === 'partial_generate') {
      messages.value.push(buildAssistantMessage({
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
      }))
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

      messages.value.push(buildAssistantMessage({
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
      }))
      return
    }

      messages.value.push(buildAssistantMessage({
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
    }))
  } catch (error) {
    messages.value.push(buildAssistantMessage({
      content: error instanceof Error ? error.message : 'AI 请求失败，请稍后重试。',
      processType: 'error',
      processTypeLabel: '执行异常',
    }))
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
  thinking?: string
  explanation?: string
  details?: DetailMap
  pendingTargetSelection?: PendingTargetSelectionState
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
        thinking: '我把你的要求理解为插入节目，但当前还不能稳定定位目标时间和节目名称。',
      }
    }

    const query = entityLinker.createInsertQuery(context, params)
    const candidates = await candidateService.searchPrograms({
      channelId: query.searchParams.channelId,
      programName: query.searchParams.programName,
      columnId: resolveColumnIdByTime(params.targetTime),
      limit: 5,
    })

    if (candidates.length === 0) {
      return {
        command: null,
        message: `没有检索到“${params.programName}”的可用节目，请确认节目名或频道。`,
        thinking: `我把你的要求理解为“在 ${params.targetTime} 插入《${params.programName}》”，并按当前频道检索了候选节目。`,
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

    if (!preview.canExecute) {
      return {
        command: null,
        message: `目标时间 ${params.targetTime} 已有节目占用，请先删除、替换，或换一个空闲时间点。`,
        thinking: `我把你的要求理解为“在 ${params.targetTime} 插入《${selection.selectedCandidate.programName}》”，并先检查了当前时段占用情况。`,
        explanation:
          `${classificationReasoning} ${intent.reasoning} ` +
          `已定位到候选节目《${selection.selectedCandidate.programName}》，但当前时段存在节目冲突，因此本次不直接执行插入。` +
          `${warningText}`,
        details: {
          queryCommand: query.queryCommand,
          selectedCandidate: selection.selectedCandidate,
          candidateOptions: candidates.slice(0, 3),
          selectionReason: selection.reasoning,
          preview,
        },
      }
    }

    return {
      command,
      message: `已在 ${params.targetTime} 插入《${selection.selectedCandidate.programName}》。`,
      thinking: `我把你的要求理解为“在 ${params.targetTime} 插入《${params.programName}》”，并在当前频道候选中找到了最匹配的节目。`,
      explanation:
        `${classificationReasoning} ${intent.reasoning} ` +
        `检索条件为频道=${props.channelName}、节目名=${params.programName}。` +
        `${selection.reasoning}${warningText}`,
      details: {
        queryCommand: query.queryCommand,
        selectedCandidate: selection.selectedCandidate,
        candidateOptions: candidates.slice(0, 3),
        selectionReason: selection.reasoning,
        preview,
      },
    }
  }

  if (intent.type === 'delete') {
    const params = await paramExtractor.extractDeleteParams(context)
    if (!params) {
      return {
        command: null,
        message: '已识别为删除节目，但还不能稳定提取目标时间。建议使用“删除12点的午间30”。',
        thinking: '我把你的要求理解为删除已编排节目，但当前还不能稳定定位目标时间。',
      }
    }

    const resolution = await scheduleTargetResolver.resolve({
      userInput,
      action: 'delete',
      channelName: props.channelName,
      date: props.date,
      targetTime: params.targetTime,
      programName: params.programName,
      items: props.currentSchedule,
    })
    if (resolution.status !== 'unique' || !resolution.selectedItem) {
      if (resolution.status === 'multiple') {
        return {
          command: null,
          message: `在 ${params.targetTime} 附近找到了多个可能的节目，请在下方选择具体目标。`,
          thinking: `我把你的要求理解为“删除 ${params.targetTime} 的${params.programName || '节目'}”，但当前时间附近存在多个候选目标。`,
          explanation: `${classificationReasoning} ${intent.reasoning}`,
          details: {
            targetTime: params.targetTime,
            programName: params.programName,
            targetResolution: {
              status: resolution.status,
              reasoning: resolution.reasoning,
              matchedBy: resolution.matchedBy,
              candidates: resolution.candidates,
            },
          },
          pendingTargetSelection: {
            action: 'delete',
            summary: `请选择 ${params.targetTime} 要删除的节目`,
            reasoning: resolution.reasoning,
            targetTime: params.targetTime,
            programName: params.programName,
            candidates: resolution.candidates,
            selectedItemId: null,
            resolutionDetails: {
              matchedBy: resolution.matchedBy,
            },
          },
        }
      }
      return {
        command: null,
        message: `没有找到 ${params.targetTime} 附近可删除的节目，请确认时间点或节目名。`,
        thinking: `我把你的要求理解为“删除 ${params.targetTime} 的${params.programName || '节目'}”，并在当前编排单中尝试定位目标。`,
      }
    }
    const targetItem = resolution.selectedItem

    const command: OrchestrationCommand = {
      action: 'delete',
      reasoning: `删除 ${params.targetTime} 对应节目《${targetItem.programName || targetItem.programCode || targetItem.id}》。`,
      data: {
        itemId: targetItem.id,
      },
    }

    return {
      command,
      message: `将删除 ${params.targetTime} 的《${targetItem.programName || targetItem.programCode || targetItem.id}》。`,
      thinking: `我把你的要求理解为“删除 ${params.targetTime} 的${params.programName || '节目'}”，并在当前编排单里定位到了唯一目标。`,
      explanation: `${classificationReasoning} ${intent.reasoning}`,
      details: {
        targetTime: params.targetTime,
        programName: params.programName,
        matchedItem: targetItem,
        targetResolution: {
          status: resolution.status,
          reasoning: resolution.reasoning,
          matchedBy: resolution.matchedBy,
          candidates: resolution.candidates,
        },
      },
    }
  }

  if (intent.type === 'move') {
    const params = await paramExtractor.extractMoveParams(context)
    if (!params) {
      return {
        command: null,
        message: '已识别为移动节目，但还不能稳定提取目标时间和移动时长。建议使用“把22点的节目向后移动1小时”。',
        thinking: '我把你的要求理解为移动已编排节目，但当前还不能稳定提取目标时间或移动幅度。',
      }
    }

    const resolution = await scheduleTargetResolver.resolve({
      userInput,
      action: 'move',
      channelName: props.channelName,
      date: props.date,
      targetTime: params.targetTime,
      items: props.currentSchedule,
    })
    if (resolution.status !== 'unique' || !resolution.selectedItem) {
      if (resolution.status === 'multiple') {
        return {
          command: null,
          message: `在 ${params.targetTime} 附近找到了多个可能的节目，请在下方选择具体目标。`,
          thinking: `我把你的要求理解为“移动 ${params.targetTime} 的节目”，但当前时间附近存在多个候选目标。`,
          explanation: `${classificationReasoning} ${intent.reasoning}`,
          details: {
            targetTime: params.targetTime,
            direction: params.direction,
            offsetSeconds: params.offsetSeconds,
            targetResolution: {
              status: resolution.status,
              reasoning: resolution.reasoning,
              matchedBy: resolution.matchedBy,
              candidates: resolution.candidates,
            },
          },
          pendingTargetSelection: {
            action: 'move',
            summary: `请选择 ${params.targetTime} 要移动的节目`,
            reasoning: resolution.reasoning,
            targetTime: params.targetTime,
            candidates: resolution.candidates,
            selectedItemId: null,
            moveConfig: {
              direction: params.direction,
              offsetSeconds: params.offsetSeconds,
            },
            resolutionDetails: {
              matchedBy: resolution.matchedBy,
            },
          },
        }
      }
      return {
        command: null,
        message: `没有找到 ${params.targetTime} 附近可移动的节目，请确认目标时间点。`,
        thinking: `我把你的要求理解为“移动 ${params.targetTime} 的节目”，并在当前编排单中尝试定位目标。`,
      }
    }
    const targetItem = resolution.selectedItem

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
      message: `已将《${targetItem.programName || targetItem.programCode || targetItem.id}》${params.direction === 'forward' ? '向后' : '向前'}移动 ${formatOffset(params.offsetSeconds)}。`,
      thinking: `我把你的要求理解为“把 ${params.targetTime} 的节目${params.direction === 'forward' ? '向后' : '向前'}移动 ${formatOffset(params.offsetSeconds)}”，并定位到了唯一目标。`,
      explanation: `${classificationReasoning} ${intent.reasoning}`,
      details: {
        targetTime: params.targetTime,
        matchedItem: targetItem,
        targetResolution: {
          status: resolution.status,
          reasoning: resolution.reasoning,
          matchedBy: resolution.matchedBy,
          candidates: resolution.candidates,
        },
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
        thinking: '我把你的要求理解为替换已编排节目，但当前还不能稳定提取目标时间或替换目标。',
      }
    }

    const resolution = await scheduleTargetResolver.resolve({
      userInput,
      action: 'replace',
      channelName: props.channelName,
      date: props.date,
      targetTime: params.targetTime,
      items: props.currentSchedule,
    })
    if (resolution.status !== 'unique' || !resolution.selectedItem) {
      if (resolution.status === 'multiple') {
        return {
          command: null,
          message: `在 ${params.targetTime} 附近找到了多个可能的节目，请在下方选择具体目标。`,
          thinking: `我把你的要求理解为“把 ${params.targetTime} 的节目换成《${params.programName}》”，但当前时间附近存在多个候选目标。`,
          explanation: `${classificationReasoning} ${intent.reasoning}`,
          details: {
            targetTime: params.targetTime,
            replacementProgramName: params.programName,
            targetResolution: {
              status: resolution.status,
              reasoning: resolution.reasoning,
              matchedBy: resolution.matchedBy,
              candidates: resolution.candidates,
            },
          },
          pendingTargetSelection: {
            action: 'replace',
            summary: `请选择 ${params.targetTime} 要替换的节目`,
            reasoning: resolution.reasoning,
            targetTime: params.targetTime,
            candidates: resolution.candidates,
            selectedItemId: null,
            replaceProgramName: params.programName,
            resolutionDetails: {
              matchedBy: resolution.matchedBy,
            },
          },
        }
      }
      return {
        command: null,
        message: `没有找到 ${params.targetTime} 附近可替换的节目，请确认目标时间点。`,
        thinking: `我把你的要求理解为“把 ${params.targetTime} 的节目换成《${params.programName}》”，并在当前编排单中尝试定位目标。`,
      }
    }
    const targetItem = resolution.selectedItem

    const candidates = await candidateService.searchPrograms({
      channelId: props.channelId,
      programName: params.programName,
      columnId: resolveItemColumnId(targetItem),
      limit: 5,
    })

    if (candidates.length === 0) {
      return {
        command: null,
        message: `没有检索到“${params.programName}”的可用节目，请确认节目名。`,
        thinking: `我把你的要求理解为“把 ${params.targetTime} 的节目换成《${params.programName}》”，并先检索了可替换候选。`,
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

    const preview = replaceCommandExecutor.preview(command)
    const warningText =
      preview.warnings.length > 0 ? ` 风险提示：${preview.warnings.join('；')}` : ''

    if (!preview.canExecute) {
      return {
        command: null,
        message: `替换后的节目时段会与现有编排冲突，当前无法执行替换。`,
        thinking: `我把你的要求理解为“把 ${params.targetTime} 的节目换成《${params.programName}》”，并先检查了替换后的时间占用情况。`,
        explanation:
          `${classificationReasoning} ${intent.reasoning} 已根据频道=${props.channelName}、节目名=${params.programName} 检索候选，但替换后时段会与现有节目重叠。` +
          `${warningText}`,
        details: {
          targetTime: params.targetTime,
          matchedItem: targetItem,
          selectedCandidate,
          candidateOptions: candidates.slice(0, 3),
          preview,
        },
      }
    }

    return {
      command,
      message: `将把 ${params.targetTime} 的节目替换为《${selectedCandidate.programName}》。`,
      thinking: `我把你的要求理解为“把 ${params.targetTime} 的节目换成《${params.programName}》”，并完成了目标定位和替换候选检索。`,
      explanation:
        `${classificationReasoning} ${intent.reasoning} 已根据频道=${props.channelName}、节目名=${params.programName} 检索候选并选中最匹配节目。${warningText}`,
      details: {
        targetTime: params.targetTime,
        matchedItem: targetItem,
        targetResolution: {
          status: resolution.status,
          reasoning: resolution.reasoning,
          matchedBy: resolution.matchedBy,
          candidates: resolution.candidates,
        },
        selectedCandidate,
        candidateOptions: candidates.slice(0, 3),
      },
    }
  }

  return {
    command: null,
    message: '我还不能稳定理解这条修改指令，请尽量明确时间点、节目名称和操作类型。',
    thinking: '我先按当前编排单和你的自然语言要求进行了理解，但这条指令还不足以安全落成原子操作。',
    explanation: classificationReasoning,
  }
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

const formatDetails = (details: DetailMap) => formatStructuredDetails(details, formatDisplayTime)

const formatProgramLabel = (value: unknown): string =>
  formatProgramDisplayLabel(value, formatDisplayTimeRange)

const formatOffset = (offsetSeconds: number): string => formatOffsetText(offsetSeconds)

const timeToSeconds = (value?: string): number | null => {
  if (!value) return null
  const normalized = normalizeClockText(value)
  const [hours = 0, minutes = 0, seconds = 0] = normalized.split(':').map(Number)
  if ([hours, minutes, seconds].some((part) => Number.isNaN(part))) {
    return null
  }
  return hours * 3600 + minutes * 60 + seconds
}

const resolveColumnIdByTime = (targetTime?: string): string | undefined => {
  const targetSeconds = timeToSeconds(targetTime)
  if (targetSeconds === null) return undefined

  const layout = getEffectiveLayoutReference(props.channelId, props.date)
  const matchedSlot = layout?.slots.find((slot) => {
    const startSeconds = timeToSeconds(slot.startTime)
    const endSeconds = timeToSeconds(slot.endTime)
    if (startSeconds === null || endSeconds === null) return false
    return targetSeconds >= startSeconds && targetSeconds < endSeconds
  })

  return matchedSlot?.columnId
}

const resolveItemColumnId = (item?: SchedulePreviewItem | null): string | undefined => {
  if (!item) return undefined
  const record = item as unknown as ProgramRecord

  if (typeof record.keySlot === 'string' && record.keySlot.trim()) {
    return record.keySlot
  }
  if (typeof record.columnId === 'string' && record.columnId.trim()) {
    return record.columnId
  }

  return typeof record.startTime === 'string' ? resolveColumnIdByTime(record.startTime) : undefined
}

const getMessageDetails = (message: Message): DetailMap | undefined =>
  message.explanation?.details as DetailMap | undefined

const getCandidateComparisonItems = (message: Message): CandidateComparisonItem[] =>
  buildCandidateComparisonItems(getMessageDetails(message))

const buildDetailsSummary = (
  details?: DetailMap,
  processType?: ProcessType,
): DetailSummaryItem[] => {
  void processType
  return buildMessageDetailsSummary(details, {
    formatDisplayTime,
    formatProgramLabel,
    resolveMatchedColumnInfo,
    buildQueryCriteriaSummary,
    formatOffset,
  })
}

const buildOrchestrationOverviewMessage = (session: PlanningSession): Message => {
  const logs = session.logs ?? []
  const runtimeLayoutEntry = getRuntimeLayoutEntry(props.channelId, props.date)
  const layoutSlotCount = logs.find((log) => typeof log.details?.layoutSlotCount === 'number')?.details?.layoutSlotCount
  const existingItemCount = logs.find((log) => typeof log.details?.existingItemCount === 'number')?.details?.existingItemCount as number | undefined
  const fillExecutionLogs = logs.filter((log) => (
    log.phase === 'execution'
    && typeof log.details?.gapId === 'string'
    && typeof log.details?.selectedCandidateId === 'string'
  ))
  const adExecutionLogs = logs.filter((log) => {
    if (log.phase !== 'execution' || typeof log.details?.slotId !== 'string') {
      return false
    }
    const insertedItems = Array.isArray(log.details?.insertedItems) ? log.details.insertedItems : []
    return insertedItems.some((item: unknown) => (item as ProgramRecord | undefined)?.programType === 'ad')
  })
  const validationEntry = [...logs].reverse().find(
    (log) => log.phase === 'validation' && typeof log.details?.summary === 'object',
  )
  const validationSummary = validationEntry?.details?.summary as DetailMap | undefined
  const validationIssueCount =
    typeof validationSummary?.totalIssues === 'number' ? validationSummary.totalIssues : 0
  const failedGapCount = session.gaps.failed.length
  const pendingGapCount = session.gaps.pending.length
  const unresolvedGapCount = pendingGapCount + failedGapCount
  const completedGapCount = fillExecutionLogs.length
  const adInsertionCount = adExecutionLogs.length
  const writtenItemCount = logs.reduce((count, log) => {
    const inserted = Array.isArray(log.details?.insertedItems) ? log.details.insertedItems.length : 0
    return count + inserted
  }, 0)
  const insertedItemCount = completedGapCount
  const sequentialFillCount = fillExecutionLogs.filter((log) => log.details?.selectionMode === 'sequential').length
  const rerunFillCount = fillExecutionLogs.filter((log) => log.details?.selectionMode === 'rerun').length
  const fixedOrLockedCount = props.currentSchedule.filter((item) => {
    const record = item as unknown as ProgramRecord
    return Boolean(record.isLocked)
  }).length
  const unresolvedRisks: string[] = []

  if (unresolvedGapCount > 0) {
    unresolvedRisks.push(`仍有 ${unresolvedGapCount} 个空窗待人工确认`)
  }
  if (validationIssueCount > 0) {
    unresolvedRisks.push(`校验仍提示 ${validationIssueCount} 个问题`)
  }
  if (adInsertionCount > 0) {
    unresolvedRisks.push(`版面内插播广告 ${adInsertionCount} 次，建议复核衔接节奏`)
  }

  const summaryLine = [
    pendingGapCount > 0 ? '自动编排阶段已结束' : '全天编排已完成',
    '本次优先遵循版面信息',
    completedGapCount > 0 ? `已处理 ${completedGapCount} 个空窗` : '已完成整体版面整理',
    pendingGapCount > 0 ? `仍有 ${pendingGapCount} 个空窗待人工确认` : '',
  ].filter(Boolean).join('，')

  const explanation = pendingGapCount > 0
    ? '本轮自动编排已先完成可命中的版面补排，剩余空窗由于候选不足或约束未满足，建议人工继续确认。'
    : existingItemCount && existingItemCount > 0
      ? '本次在保留现有编单结构的前提下，优先对齐版面栏目和时段要求，再对剩余空窗做补排与修补。'
      : '本次先按版面栏目和时段要求搭建全天骨架，再在对应版面约束内完成节目填充和修补。'
  const normalizedExplanation = runtimeLayoutEntry
    ? `${explanation} 当前优先参考的是上传版面《${runtimeLayoutEntry.sourceFileName}》。`
    : explanation

  return buildAssistantMessage({
    content: summaryLine,
    processType: 'planning',
    processTypeLabel: '编排总结',
    expanded: true,
    reasonTags: [
      '版面优先',
      validationIssueCount > 0 ? '需人工确认' : '校验通过',
      sequentialFillCount > 0 ? '顺播推进' : rerunFillCount > 0 ? '重播补位' : '结构稳定',
    ],
      explanation: {
        type: 'command',
        targetId: `orchestration-summary-${session.id}`,
        explanation: normalizedExplanation,
        details: {
          summaryKind: 'orchestration_overview',
          sessionId: session.id,
          layoutSourceFileName: runtimeLayoutEntry?.sourceFileName,
          target: session.strategy.target,
        layoutSlotCount,
        existingItemCount,
        fixedOrLockedCount,
        completedGapCount,
        pendingGapCount,
        failedGapCount,
        insertedItemCount,
        writtenItemCount,
        adInsertionCount,
        sequentialFillCount,
        rerunFillCount,
        validationSummary,
        unresolvedRisks,
      },
    },
  })
}

const buildReasonTagsForMessage = (message: Message): string[] => {
  const details = getMessageDetails(message)
  const tags: string[] = []
  const addTag = (tag?: string) => {
    const normalized = tag?.trim()
    if (!normalized || tags.includes(normalized) || tags.length >= 3) return
    tags.push(normalized)
  }

  if (isOrchestrationOverviewDetails(details)) {
    const validationSummary = toValidationSummaryRecord(details?.validationSummary)
    const validationIssueCount = validationSummary?.totalIssues ?? 0
    const failedGapCount = typeof details?.failedGapCount === 'number' ? details.failedGapCount : 0
    const sequentialFillCount = typeof details?.sequentialFillCount === 'number' ? details.sequentialFillCount : 0
    const rerunFillCount = typeof details?.rerunFillCount === 'number' ? details.rerunFillCount : 0
    addTag('版面优先')
    if (validationIssueCount > 0 || failedGapCount > 0) {
      addTag('需人工确认')
    } else {
      addTag('校验通过')
    }
    if (sequentialFillCount > 0) {
      addTag('顺播推进')
    } else if (rerunFillCount > 0) {
      addTag('重播补位')
    } else {
      addTag('结构稳定')
    }
    return tags
  }

  if (isLayoutImportDetails(details)) {
    addTag('版面已导入')
    const sequentialColumnCount = typeof details?.sequentialColumnCount === 'number' ? details.sequentialColumnCount : 0
    if (
      details?.templateMode === 'weekday_columns'
      || details?.templateMode === 'weekday_sheet'
      || details?.templateMode === 'visual_weekday_grid'
    ) {
      addTag('按星期匹配')
    }
    if (sequentialColumnCount > 0) {
      addTag('含顺播栏目')
    }
    if (Array.isArray(details?.warnings) && details.warnings.length > 0) {
      addTag('需人工确认')
    }
    return tags
  }

  if (message.processType === 'validation') {
    const summary = toValidationSummaryRecord(details?.summary ?? details?.validationSummary)
    const totalIssues = summary?.totalIssues ?? 0
    const criticalCount = summary?.criticalCount ?? 0
    addTag('已完成校验')
    if (totalIssues > 0) {
      addTag('存在风险')
      if (criticalCount > 0) {
        addTag('需人工确认')
      }
    } else {
      addTag('校验通过')
    }
    return tags
  }

  if (/多个可能|请选择/.test(message.content)) {
    addTag('目标待确认')
    addTag('暂不自动执行')
  }

  if (/请确认后执行|将删除|将把/.test(message.content)) {
    addTag('需人工确认')
  }

  const targetResolution = toDetailMap(details?.targetResolution)
  if (details?.matchedItem || (Array.isArray(targetResolution?.matchedBy) && targetResolution.matchedBy.length > 0)) {
    addTag('目标已定位')
  }

  if (details?.selectedCandidate || typeof details?.selectedCandidateName === 'string') {
    addTag('已选候选')
  }

  const candidateOptions = Array.isArray(details?.candidateOptions) ? details.candidateOptions : []
  const topCandidates = Array.isArray(details?.topCandidates) ? details.topCandidates : []
  const strategySource = details?.selectedCandidate ?? candidateOptions[0] ?? topCandidates[0]
  if (strategySource && typeof strategySource === 'object') {
    const strategy = (strategySource as ProgramRecord).selectionMode
    if (strategy === 'sequential') {
      addTag('顺播推进')
    } else if (strategy === 'rerun') {
      addTag('重播候选')
    }
  }

  const queryCommand = toDetailMap(details?.queryCommand)
  const queryCommandData = toDetailMap(queryCommand?.data)
  const criteria = toDetailMap(details?.criteria ?? queryCommandData?.criteria)
  if (criteria) {
    if (criteria.columnId || (Array.isArray(criteria.programTypePreference) && criteria.programTypePreference.length > 0)) {
      addTag('栏目匹配')
    }
    if (criteria.expectedDuration) {
      addTag('时长合适')
    }
  }

  if (details?.direction || details?.offsetSeconds) {
    addTag('局部调整')
  }

  const preview = toPreviewRecord(details?.preview)
  if (Array.isArray(preview?.warnings) && preview.warnings.length > 0) {
    addTag('存在风险提示')
  }

  if (preview?.canExecute === false || /冲突|占用/.test(message.content)) {
    addTag('时段冲突')
  }

  if (isNoCandidateCase(details ?? {}) || /没有检索到|未找到合适节目|没有找到|未找到/.test(message.content)) {
    addTag('当前无候选')
  }

  if (message.processType === 'execution' && /执行成功|已在|已将|已排入|已按确认执行/.test(message.content)) {
    addTag('已完成执行')
  }

  if (message.processType === 'selection' && /已选中/.test(message.content)) {
    addTag('已完成选择')
  }

  const validationSummary = toValidationSummaryRecord(details?.validationSummary)
  const validationIssueCount = validationSummary?.totalIssues
  if (validationIssueCount === 0) {
    addTag('校验通过')
  } else if ((validationIssueCount ?? 0) > 0) {
    addTag('仍有风险')
  }

  if ((message.processType === 'error' || /无法执行|失败/.test(message.content)) && tags.length === 0) {
    addTag('需人工处理')
  }

  return tags
}

const buildDecisionShortExplanation = (message: Message): string | undefined => {
  if (message.thinking) {
    return normalizeDecisionExplanation(message.thinking)
  }

  const details = getMessageDetails(message)

  if (isOrchestrationOverviewDetails(details)) {
    return '先按版面结构落位，再在可编辑区间内完成补排、顺播和收口校验。'
  }

  if (isLayoutImportDetails(details)) {
    if (details?.templateMode === 'weekday_columns' && typeof details?.matchedWeekdayLabel === 'string') {
      const columnLabel =
        typeof details?.matchedColumnLabel === 'string' ? `“${details.matchedColumnLabel}”` : `“${details.matchedWeekdayLabel}”`
      return `已按当前编排单日期命中 ${details.matchedWeekdayLabel}，并采用 ${columnLabel} 这一列生成当天版面。`
    }
    if (details?.templateMode === 'visual_weekday_grid' && typeof details?.matchedWeekdayLabel === 'string') {
      const columnLabel =
        typeof details?.matchedColumnLabel === 'string' ? `“${details.matchedColumnLabel}”` : `“${details.matchedWeekdayLabel}”`
      return `已按当前编排单日期命中 ${details.matchedWeekdayLabel}，并从 ${columnLabel} 这一列的版面块提取出当天时段。`
    }
    if (details?.templateMode === 'weekday_sheet' && typeof details?.matchedSheetName === 'string') {
      return `已按当前编排单日期命中工作表“${details.matchedSheetName}”，并将其转换为当天版面。`
    }
    return '已把上传文件转成当前日期版面，后续编排会先对齐这份版面结构。'
  }

  if (message.processType === 'validation') {
    const summary = toValidationSummaryRecord(details?.summary ?? details?.validationSummary)
    if ((summary?.totalIssues ?? 0) > 0) {
      return '已按当前节目单完成校验，并提炼出需要优先关注的问题。'
    }
    return '已按当前节目单完成校验，当前未发现明显风险。'
  }

  if (/多个可能|请选择/.test(message.content)) {
    return '当前时间附近存在多个可执行目标，先确认具体节目再继续修改。'
  }

  const candidateOptions = Array.isArray(details?.candidateOptions) ? details.candidateOptions : []
  const topCandidates = Array.isArray(details?.topCandidates) ? details.topCandidates : []
  const strategySource = details?.selectedCandidate ?? candidateOptions[0] ?? topCandidates[0]
  if (strategySource && typeof strategySource === 'object') {
    const strategy = (strategySource as ProgramRecord).selectionMode
    if (strategy === 'sequential') {
      return '已结合当前栏目顺播进度和已排记录，优先选择下一可播集/期。'
    }
    if (strategy === 'rerun') {
      return '当前栏目不强调顺播，已按时段匹配度筛选更稳妥的重播候选。'
    }
  }

  if (details?.matchedItem && (details?.selectedCandidate || typeof details?.selectedCandidateName === 'string')) {
    return '已结合目标节目、候选匹配度和当前编排约束完成判断。'
  }

  if (details?.matchedItem) {
    return '已结合目标时间和当前编排记录完成目标定位。'
  }

  const preview = toPreviewRecord(details?.preview)
  if (preview?.canExecute === false || /冲突|无法执行/.test(message.content)) {
    return '已先检查主要约束，当前方案仍会影响现有编排。'
  }

  if (isNoCandidateCase(details ?? {}) || /没有检索到|未找到/.test(message.content)) {
    return '已按当前条件尝试检索，但暂时没有更合适的可用节目。'
  }

  if (message.processType === 'execution') {
    return '已根据当前时段、节目匹配度和风险提示完成这次处理。'
  }

  if (message.processType === 'selection') {
    return '已结合当前空窗、候选匹配度和约束条件做出选择。'
  }

  if (message.processType === 'error') {
    return '已按当前条件尝试处理，但仍有约束未满足。'
  }

  return undefined
}

const decorateAssistantMessage = (message: Message): Message => {
  const next: Message = { ...message }
  const reasonTags = (next.reasonTags?.length ? next.reasonTags : buildReasonTagsForMessage(next)).slice(0, 3)

  if (reasonTags.length > 0) {
    next.reasonTags = reasonTags
    next.thinking = buildDecisionShortExplanation(next)
  }

  return next
}

const buildAssistantMessage = (input: Omit<Message, 'role'>): Message =>
  decorateAssistantMessage({
    role: 'assistant',
    expanded: false,
    ...input,
  })

const isDecisionMessage = (message: Message) => (message.reasonTags?.length ?? 0) > 0

const shouldShowReasonTags = (message: Message) => isDecisionMessage(message)

const shouldShowDefaultExplanation = (message: Message) =>
  isDecisionMessage(message) && Boolean(message.thinking)

const buildExpandedWhy = (message: Message): string => {
  const explanation = normalizeDecisionExplanation(message.explanation?.explanation)
  return explanation || buildDecisionShortExplanation(message) || message.content
}

const buildExpandedBasis = (message: Message): string | undefined => {
  const details = getMessageDetails(message)
  if (isOrchestrationOverviewDetails(details)) {
    const parts = [
      typeof details?.layoutSourceFileName === 'string' ? `版面来源 ${details.layoutSourceFileName}` : '',
      typeof details?.layoutSlotCount === 'number' ? `已对齐版面时段 ${details.layoutSlotCount} 个` : '',
      typeof details?.fixedOrLockedCount === 'number' && details.fixedOrLockedCount > 0 ? `保留固定或锁定条目 ${details.fixedOrLockedCount} 处` : '',
      typeof details?.completedGapCount === 'number' ? `已执行自动补排 ${details.completedGapCount} 轮` : '',
      typeof details?.sequentialFillCount === 'number' && details.sequentialFillCount > 0 ? `顺播推进 ${details.sequentialFillCount} 次` : '',
      typeof details?.rerunFillCount === 'number' && details.rerunFillCount > 0 ? `重播补位 ${details.rerunFillCount} 次` : '',
    ].filter(Boolean)

    return parts.length > 0 ? parts.join('；') : undefined
  }

  const summaryItems = buildDetailsSummary(details, message.processType)
    .filter((item) => !['风险提示', '主要问题', '校验结果'].includes(item.label))
    .slice(0, 3)

  if (summaryItems.length > 0) {
    return summaryItems.map((item) => `${item.label}：${item.value}`).join('；')
  }

  if (typeof details?.selectionReason === 'string') {
    return normalizeDecisionExplanation(details.selectionReason)
  }

  return undefined
}

const buildExpandedRisk = (message: Message): string | undefined => {
  const details = getMessageDetails(message)
  if (isOrchestrationOverviewDetails(details)) {
    const risks = Array.isArray(details?.unresolvedRisks)
      ? details.unresolvedRisks.filter((item: unknown): item is string => typeof item === 'string' && item.trim().length > 0)
      : []
    if (risks.length > 0) {
      return risks.join('；')
    }
    return '本轮编排已完成收口校验，当前未发现需要优先处理的明显风险。'
  }

  if (isLayoutImportDetails(details)) {
    const warnings = Array.isArray(details?.warnings)
      ? details.warnings.filter((item: unknown): item is string => typeof item === 'string' && item.trim().length > 0)
      : []
    return warnings.length > 0 ? warnings.join('；') : '已完成版面结构校验，当前未发现明显导入异常。'
  }

  const warnings = extractWarnings(details)
  if (warnings.length > 0) {
    return warnings.join('；')
  }

  if (Array.isArray(details?.issues) && details.issues.length > 0) {
    return (details.issues as Array<{ message?: string }>)
      .slice(0, 2)
      .map((item) => item?.message)
      .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      .join('；')
  }

  return undefined
}

const getExpandedSections = (message: Message): ExplanationSection[] => {
  const details = getMessageDetails(message)
  if (isOrchestrationOverviewDetails(details)) {
    const sections: ExplanationSection[] = [
      {
        title: '编排原则',
        body: buildExpandedWhy(message),
      },
    ]

    const resultParts = [
      typeof details?.layoutSlotCount === 'number' ? `本次共按版面处理 ${details.layoutSlotCount} 个时段` : '',
      typeof details?.completedGapCount === 'number' ? `执行自动补排 ${details.completedGapCount} 轮` : '',
      typeof details?.insertedItemCount === 'number' ? `累计选中节目 ${details.insertedItemCount} 次` : '',
      typeof details?.writtenItemCount === 'number' ? `实际写入条目 ${details.writtenItemCount} 条` : '',
      typeof details?.sequentialFillCount === 'number' && details.sequentialFillCount > 0 ? `其中顺播推进 ${details.sequentialFillCount} 次` : '',
      typeof details?.rerunFillCount === 'number' && details.rerunFillCount > 0 ? `非顺播栏目重播补位 ${details.rerunFillCount} 次` : '',
      typeof details?.adInsertionCount === 'number' && details.adInsertionCount > 0 ? `版面内广告补位 ${details.adInsertionCount} 次` : '',
    ].filter(Boolean)
    if (resultParts.length > 0) {
      sections.push({
        title: '主要处理结果',
        body: resultParts.join('；'),
        tone: 'secondary',
      })
    }

    const risk = buildExpandedRisk(message)
    if (risk) {
      sections.push({
        title: '风险与提醒',
        body: risk,
        tone: 'risk',
      })
    }

    return sections
  }

  if (isLayoutImportDetails(details)) {
    const sections: ExplanationSection[] = [
      {
        title: '导入结果',
        body: buildExpandedWhy(message),
      },
    ]

    const basis = [
      typeof details?.matchedWeekdayLabel === 'string' ? `当前编排单命中 ${details.matchedWeekdayLabel}` : '',
      typeof details?.matchedColumnLabel === 'string' ? `采用列 ${details.matchedColumnLabel}` : '',
      typeof details?.matchedSheetName === 'string' ? `来源工作表 ${details.matchedSheetName}` : '',
      typeof details?.slotCount === 'number' ? `识别版面时段 ${details.slotCount} 个` : '',
      typeof details?.columnCount === 'number' ? `识别栏目 ${details.columnCount} 个` : '',
      typeof details?.sequentialColumnCount === 'number' && details.sequentialColumnCount > 0 ? `其中顺播栏目 ${details.sequentialColumnCount} 个` : '',
    ].filter(Boolean)

    if (basis.length > 0) {
      sections.push({
        title: '将如何参与编排',
        body: `后续会优先按这份版面落位，再在对应栏目约束内完成候选选择。${basis.join('；')}`,
        tone: 'secondary',
      })
    }

    const risk = buildExpandedRisk(message)
    if (risk) {
      sections.push({
        title: '风险与提醒',
        body: risk,
        tone: 'risk',
      })
    }

    return sections
  }

  const sections: ExplanationSection[] = []
  const why = buildExpandedWhy(message)
  const basis = buildExpandedBasis(message)
  const risk = buildExpandedRisk(message)

  if (why) {
    sections.push({ title: '为什么这样做', body: why })
  }
  if (basis) {
    sections.push({ title: '参考了什么', body: basis, tone: 'secondary' })
  }
  if (risk) {
    sections.push({ title: '风险与提醒', body: risk, tone: 'risk' })
  }

  return sections
}

const getDetailsSummaryItems = (message: Message) =>
  buildDetailsSummary(getMessageDetails(message), message.processType)

const hasExpandableExplanation = (message: Message) =>
  isDecisionMessage(message)
  && (getExpandedSections(message).length > 0 || Boolean(message.explanation?.details))

const toggleDetailExpanded = (message: Message) => {
  message.detailExpanded = !(message.detailExpanded ?? false)
}

const toggleRawDetails = (message: Message) => {
  message.rawDetailsExpanded = !(message.rawDetailsExpanded ?? false)
}

const getPendingCommandReasonTags = () => {
  if (!pendingCommand.value) return []
  return buildReasonTagsForMessage(
    buildAssistantMessage({
      content: pendingCommand.value.summary,
      processType: 'execution',
      explanation: {
        type: 'command',
        targetId: 'pending-command-panel',
        explanation: pendingCommand.value.reasoning,
        details: pendingCommand.value.details,
      },
    }),
  )
}

const getPendingCommandDetailItems = () =>
  pendingCommand.value ? buildDetailsSummary(pendingCommand.value.details, 'execution') : []

const resolveMatchedColumnInfo = (details?: DetailMap) => {
  const queryCommand = toDetailMap(details?.queryCommand)
  const queryCommandData = toDetailMap(queryCommand?.data)
  const criteria = toDetailMap(details?.criteria ?? queryCommandData?.criteria)
  const columnId =
    typeof criteria?.columnId === 'string' && criteria.columnId.trim()
      ? criteria.columnId.trim()
      : typeof details?.columnId === 'string' && details.columnId.trim()
        ? details.columnId.trim()
        : ''
  const columnNameFromId = columnId ? getEffectiveColumnDefinition(columnId)?.columnName ?? '' : ''
  const targetSlotLabel =
    typeof details?.targetSlotLabel === 'string' && details.targetSlotLabel.trim()
      ? details.targetSlotLabel.trim()
      : ''

  return {
    columnId,
    columnName: columnNameFromId || targetSlotLabel,
  }
}

const formatMatchedColumnText = (details?: DetailMap) => {
  const { columnId, columnName } = resolveMatchedColumnInfo(details)
  if (columnName && columnId) return `${columnName}（${columnId}）`
  return columnName || columnId
}

const formatExpectedDuration = (expectedDuration: unknown): string => {
  if (!expectedDuration || typeof expectedDuration !== 'object') return ''
  const value = expectedDuration as { min?: number; max?: number }
  if (typeof value.min !== 'number' || typeof value.max !== 'number') return ''
  return `${value.min}-${value.max}秒`
}

const buildQueryCriteriaSummary = (criteria: DetailMap): string => {
  const columnName =
    typeof criteria.columnId === 'string' && criteria.columnId.trim()
      ? getEffectiveColumnDefinition(criteria.columnId)?.columnName ?? criteria.columnId
      : ''
  const duration = formatExpectedDuration(criteria.expectedDuration)
  const result = [columnName, duration].filter(Boolean).join('，')
  return result ? `查询：${result}` : '查询：未指定'
}

const compressLogDetails = (details: DetailMap, processType: ProcessType): DetailMap | undefined => {
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

const isNoCandidateCase = (details: DetailMap) => details.error === 'No candidates found'

const buildFriendlyLogExplanation = (log: PlanningLogEntry, details: DetailMap) => {
  const insertedItems = Array.isArray(details?.insertedItems) ? details.insertedItems : []
  const containsAdInsert = insertedItems.some((item: unknown) => (item as ProgramRecord | undefined)?.programType === 'ad')

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

  if (typeof details.slotId === 'string' && containsAdInsert) {
    const slotRange =
      typeof details.slotStartTime === 'string'
        ? formatDisplayTimeRange(details.slotStartTime, typeof details.slotEndTime === 'string' ? details.slotEndTime : undefined)
        : ''
    const shiftedCount = typeof details.shiftedItemCount === 'number' ? details.shiftedItemCount : 0
    return slotRange
      ? `${slotRange} 已按版面广告位补入广告，并顺延 ${shiftedCount} 条后续节目。`
      : `已按版面广告位补入广告，并顺延 ${shiftedCount} 条后续节目。`
  }

  return `${formatPhaseLabel(log.phase)}阶段已更新`
}

const buildRuntimeThinking = (log: PlanningLogEntry, details: DetailMap): string | undefined => {
  const timeRange =
    typeof details.startTime === 'string'
      ? formatDisplayTimeRange(details.startTime, typeof details.endTime === 'string' ? details.endTime : undefined)
      : ''
  const matchedColumnText = formatMatchedColumnText(details)
  const columnName = matchedColumnText
    || (typeof details.criteria === 'object' && details.criteria
      ? buildQueryCriteriaSummary(details.criteria as DetailMap).replace(/^查询：/, '')
      : typeof details.preferredProgramGroup === 'string'
        ? details.preferredProgramGroup
        : typeof details.targetSlotLabel === 'string'
          ? details.targetSlotLabel
          : '')

  if (isNoCandidateCase(details)) {
    return `${timeRange ? `${timeRange} 这段空窗` : '当前空窗'}已按${columnName || '当前栏目约束'}做了候选检索，但没有命中合适节目。`
  }

  if (typeof details.programName === 'string' && typeof details.itemId === 'string') {
    return `${timeRange ? `${timeRange} 这段空窗` : '当前空窗'}已完成候选判断和落表执行。`
  }

  if (typeof details.selectedCandidateName === 'string') {
    return `${timeRange ? `${timeRange} 这段空窗` : '当前空窗'}已在候选结果中选中《${details.selectedCandidateName}》。`
  }

  if (typeof details.candidateCount === 'number') {
    return `${timeRange ? `${timeRange} 这段空窗` : '当前空窗'}已按${columnName || '当前栏目约束'}完成候选检索。`
  }

  if (typeof details.summary === 'string') {
    return `${timeRange ? `${timeRange} 这段空窗` : '当前空窗'}已命中${columnName || '当前栏目'}，准备继续检索候选节目。`
  }

  return log.phase === 'planning' ? '我正在结合当前空窗、栏目和前后衔接关系继续处理。' : undefined
}

const buildRuntimeResult = (log: PlanningLogEntry, details: DetailMap): string => {
  const timeRange =
    typeof details.startTime === 'string'
      ? formatDisplayTimeRange(details.startTime, typeof details.endTime === 'string' ? details.endTime : undefined)
      : ''
  const insertedItems = Array.isArray(details?.insertedItems) ? details.insertedItems : []
  const containsAdInsert = insertedItems.some((item: unknown) => (item as ProgramRecord | undefined)?.programType === 'ad')

  if (typeof details.programName === 'string' && typeof details.itemId === 'string') {
    return timeRange ? `${timeRange} 已排入《${details.programName}》。` : `已排入《${details.programName}》。`
  }

  if (typeof details.slotId === 'string' && containsAdInsert) {
    const slotRange =
      typeof details.slotStartTime === 'string'
        ? formatDisplayTimeRange(details.slotStartTime, typeof details.slotEndTime === 'string' ? details.slotEndTime : undefined)
        : ''
    const shiftedCount = typeof details.shiftedItemCount === 'number' ? details.shiftedItemCount : 0
    return slotRange
      ? `${slotRange} 已插入广告，并顺延 ${shiftedCount} 条后续节目。`
      : `已插入广告，并顺延 ${shiftedCount} 条后续节目。`
  }

  if (isNoCandidateCase(details)) {
    return timeRange ? `${timeRange} 未找到合适节目。` : '当前空窗未找到合适节目。'
  }

  if (typeof details.candidateCount === 'number') {
    const matchedColumnText = formatMatchedColumnText(details)
    return timeRange
      ? `${timeRange} 已按${matchedColumnText || '当前栏目约束'}检索到 ${details.candidateCount} 个候选。`
      : `已按${matchedColumnText || '当前栏目约束'}检索到 ${details.candidateCount} 个候选。`
  }

  if (typeof details.selectedCandidateName === 'string') {
    return timeRange ? `${timeRange} 已选中《${details.selectedCandidateName}》。` : `已选中《${details.selectedCandidateName}》。`
  }

  if (typeof details.summary === 'string') {
    const matchedColumnText = formatMatchedColumnText(details)
    return timeRange
      ? `正在处理 ${timeRange}${matchedColumnText ? `，命中栏目 ${matchedColumnText}` : ''}。`
      : `正在处理当前空窗${matchedColumnText ? `，命中栏目 ${matchedColumnText}` : ''}。`
  }

  return summarizeRuntimeLog(log)
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

const executeCommand = async (
  command: OrchestrationCommand,
  options?: {
    successMessage?: string
    thinking?: string
    explanation?: string
    details?: DetailMap
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
    messages.value.push(buildAssistantMessage({
      content: options?.successMessage || `${summarizeCommand(command)}，执行成功。`,
      thinking: options?.thinking,
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
    }))
  } else {
    ElMessage.error(result.error || result.message)
    messages.value.push(buildAssistantMessage({
      content: result.error || result.message,
      thinking: options?.thinking,
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
    }))
  }
}

const confirmPendingCommand = async () => {
  if (!pendingCommand.value) return
  const current = pendingCommand.value
  pendingCommand.value = null
  await executeCommand(current.command, {
    successMessage: `${current.summary}，已按确认执行。`,
    thinking: '我已根据你确认的修改目标和风险提示继续执行本次操作。',
    explanation: current.reasoning,
    details: current.details,
  })
}

const confirmPendingTargetSelection = async () => {
  if (!pendingTargetSelection.value?.selectedItemId) return
  const current = pendingTargetSelection.value
  pendingTargetSelection.value = null

  const selectedItem = current.candidates.find((item) => item.id === current.selectedItemId)
  if (!selectedItem) {
    messages.value.push(buildAssistantMessage({
      content: '未找到你选择的目标节目，请重新发起操作。',
      thinking: '我尝试根据你刚才确认的候选目标继续执行，但当前找不到对应记录。',
      processType: 'error',
      processTypeLabel: '执行异常',
    }))
    return
  }

  if (current.action === 'delete') {
    const command: OrchestrationCommand = {
      action: 'delete',
      reasoning: `删除 ${current.targetTime} 对应节目《${selectedItem.programName || selectedItem.programCode || selectedItem.id}》。`,
      data: {
        itemId: selectedItem.id,
      },
    }

    pendingCommand.value = {
      command,
      summary: summarizeCommand(command),
      reasoning: current.reasoning,
      details: {
        matchedItem: selectedItem,
        targetTime: current.targetTime,
        programName: current.programName,
        targetResolution: current.resolutionDetails,
      },
    }
    return
  }

  if (current.action === 'move' && current.moveConfig) {
    const originalStart = normalizeDateTime(props.date, selectedItem.startTime)
    const delta = current.moveConfig.direction === 'forward' ? current.moveConfig.offsetSeconds : -current.moveConfig.offsetSeconds
    const newStartTime = offsetDateTime(originalStart, delta)
    const command: OrchestrationCommand = {
      action: 'move',
      reasoning: `将 ${current.targetTime} 对应节目${current.moveConfig.direction === 'forward' ? '向后' : '向前'}移动 ${formatOffset(current.moveConfig.offsetSeconds)}。`,
      data: {
        itemId: selectedItem.id,
        newStartTime,
      },
    }

    await executeCommand(command, {
      successMessage: `已将《${selectedItem.programName || selectedItem.programCode || selectedItem.id}》${current.moveConfig.direction === 'forward' ? '向后' : '向前'}移动 ${formatOffset(current.moveConfig.offsetSeconds)}。`,
      thinking: '我已根据你选择的目标节目继续完成移动操作。',
      explanation: current.reasoning,
      details: {
        matchedItem: selectedItem,
        targetTime: current.targetTime,
        direction: current.moveConfig.direction,
        offsetSeconds: current.moveConfig.offsetSeconds,
        newStartTime,
        targetResolution: current.resolutionDetails,
      },
    })
    return
  }

  if (current.action === 'replace' && current.replaceProgramName) {
    const candidates = await candidateService.searchPrograms({
      channelId: props.channelId,
      programName: current.replaceProgramName,
      columnId: resolveItemColumnId(selectedItem),
      limit: 5,
    })

    if (candidates.length === 0) {
      messages.value.push(buildAssistantMessage({
        content: `没有检索到“${current.replaceProgramName}”的可用节目，请确认节目名。`,
        thinking: `我已根据你确认的目标节目继续检索《${current.replaceProgramName}》的替换候选，但当前没有命中结果。`,
        processType: 'general',
        processTypeLabel: '未执行',
      }))
      return
    }

    const selectedCandidate = candidates[0]!
    const command: OrchestrationCommand = {
      action: 'replace',
      reasoning: `将 ${current.targetTime} 对应节目替换为《${selectedCandidate.programName}》。`,
      data: {
        itemId: selectedItem.id,
        newCandidateId: selectedCandidate.id,
      },
    }

    const preview = replaceCommandExecutor.preview(command)
    if (!preview.canExecute) {
      messages.value.push(buildAssistantMessage({
        content: '替换后的节目时段会与现有编排冲突，当前无法执行替换。',
        thinking: '我已根据你确认的目标节目继续检索替换候选，并检查了替换后的时间占用情况。',
        processType: 'general',
        processTypeLabel: '未执行',
        explanation: {
          type: 'command',
          targetId: 'replace-preview',
          explanation: current.reasoning,
          details: {
            matchedItem: selectedItem,
            replacementProgramName: current.replaceProgramName,
            selectedCandidate,
            candidateOptions: candidates.slice(0, 3),
            preview,
            targetResolution: current.resolutionDetails,
          },
        },
      }))
      pendingTargetSelection.value = null
      return
    }

    pendingCommand.value = {
      command,
      summary: summarizeCommand(command),
      reasoning: current.reasoning,
      details: {
        matchedItem: selectedItem,
        targetTime: current.targetTime,
        replacementProgramName: current.replaceProgramName,
        selectedCandidate,
        candidateOptions: candidates.slice(0, 3),
        targetResolution: current.resolutionDetails,
      },
    }
  }
}

const cancelPendingCommand = () => {
  if (!pendingCommand.value) return
  messages.value.push(buildAssistantMessage({
    content: `${pendingCommand.value.summary}，已取消执行。`,
    thinking: '我已根据你的选择停止这次高风险修改，不会对当前编排单做任何变更。',
    processType: 'general',
    processTypeLabel: '已取消',
  }))
  pendingCommand.value = null
}

const cancelPendingTargetSelection = () => {
  if (!pendingTargetSelection.value) return
  messages.value.push(buildAssistantMessage({
    content: `${pendingTargetSelection.value.summary}，已取消选择。`,
    thinking: '我已停止这次目标选择，不会继续执行后续修改。',
    processType: 'general',
    processTypeLabel: '已取消',
  }))
  pendingTargetSelection.value = null
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
      return '插入节目'
    case 'update_field':
      return '修改节目字段'
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
  const mergeMeta = getRuntimeMergeMeta(log)

  return buildAssistantMessage({
    content: buildRuntimeResult(log, details),
    thinking: buildRuntimeThinking(log, details),
    explanation: {
      type: 'command',
      targetId: log.id,
      explanation: buildFriendlyLogExplanation(log, details),
      details: explanationDetails,
    },
    processType,
    processTypeLabel: mapRuntimeLogToProcessLabel(log),
    mergeKey: mergeMeta.key,
    mergeKind: mergeMeta.kind,
  })
}

const appendSystemLogMessage = (message: Message) => {
  if (tryMergeRuntimeMessage(message)) {
    trimRuntimeProgressMessages()
    return
  }

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
  trimRuntimeProgressMessages()
}

const tryMergeRuntimeMessage = (message: Message): boolean => {
  if (!message.mergeKey || !message.mergeKind) {
    return false
  }

  const chainIndexes = messages.value
    .map((item, index) => ({ item, index }))
    .filter(({ item }) =>
      item.mergeKey === message.mergeKey
      && ['idea', 'query_request', 'query_result', 'selection', 'execution', 'other'].includes(item.mergeKind ?? ''),
    )
    .map(({ index }) => index)

  if (chainIndexes.length === 0) {
    return false
  }

  const anchorIndex = chainIndexes[0]!
  const mergedDetails = {
    ...(messages.value[anchorIndex]?.explanation?.details as DetailMap | undefined ?? {}),
    ...(message.explanation?.details as DetailMap | undefined ?? {}),
  }
  const mergedLog: PlanningLogEntry = {
    id: message.explanation?.targetId || messages.value[anchorIndex]?.explanation?.targetId || 'merged-runtime',
    timestamp: new Date().toISOString(),
    level: message.processType === 'error' ? 'error' : 'info',
    phase:
      message.processType === 'execution'
        ? 'execution'
        : message.processType === 'query'
          ? 'query'
          : message.processType === 'validation'
            ? 'validation'
            : 'planning',
    message: message.content,
    details: mergedDetails,
  }

  messages.value[anchorIndex] = decorateAssistantMessage({
    ...message,
    content: buildRuntimeResult(mergedLog, mergedDetails),
    thinking: buildRuntimeThinking(mergedLog, mergedDetails),
    explanation: {
      type: 'command',
      targetId: mergedLog.id,
      explanation: buildFriendlyLogExplanation(mergedLog, mergedDetails),
      details: mergedDetails,
    },
  })

  for (let i = chainIndexes.length - 1; i >= 1; i -= 1) {
    messages.value.splice(chainIndexes[i]!, 1)
  }
  return true
}

const isRuntimeProgressMessage = (message: Message) =>
  message.role !== 'user'
  && typeof message.mergeKey === 'string'
  && ['idea', 'query_request', 'query_result', 'selection', 'execution', 'other'].includes(message.mergeKind ?? '')

const trimRuntimeProgressMessages = () => {
  const runtimeIndexes = messages.value
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => isRuntimeProgressMessage(item))
    .map(({ index }) => index)

  if (runtimeIndexes.length <= MAX_RUNTIME_PROGRESS_MESSAGES) {
    return
  }

  const removeIndexes = runtimeIndexes.slice(0, runtimeIndexes.length - MAX_RUNTIME_PROGRESS_MESSAGES)
  for (let i = removeIndexes.length - 1; i >= 0; i -= 1) {
    messages.value.splice(removeIndexes[i]!, 1)
  }
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
    const criteriaSummary = buildQueryCriteriaSummary(details.criteria as DetailMap)
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

const getRuntimeMergeMeta = (log: PlanningLogEntry): { key?: string; kind: Message['mergeKind'] } => {
  const details = log.details ?? {}
  const key =
    typeof details.gapId === 'string'
      ? details.gapId
      : typeof details.slotId === 'string'
        ? details.slotId
      : typeof details.startTime === 'string' && typeof details.endTime === 'string'
        ? `${details.startTime}_${details.endTime}`
        : undefined

  if (typeof details.programName === 'string' && typeof details.itemId === 'string') {
    return { key, kind: 'execution' }
  }

  if (typeof details.error === 'string' && typeof details.gapId === 'string') {
    return { key, kind: 'execution' }
  }

  if (typeof details.selectedCandidateName === 'string') {
    return { key, kind: 'selection' }
  }

  if (typeof details.candidateCount === 'number') {
    return { key, kind: 'query_result' }
  }

  if (details.criteria && typeof details.criteria === 'object') {
    return { key, kind: 'query_request' }
  }

  if (typeof details.summary === 'string') {
    return { key, kind: 'idea' }
  }

  if (typeof details.slotId === 'string') {
    return { key, kind: 'execution' }
  }

  return { key, kind: 'other' }
}

watch(
  () => messages.value.length,
  () => {
    void scrollToBottom()
  },
)

watch(
  () => (props.orchestrationLogs ?? []).map((log) => log.id).join('|'),
  () => {
    const logs = props.orchestrationLogs ?? []
    if (logs.length === 0) return

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

watch(
  () => [props.channelId, props.date],
  () => {
    syncImportedLayoutState()
  },
  { immediate: true },
)

watch(
  () => ({
    isOrchestrating: props.isOrchestrating,
    sessionId: props.orchestrationSession?.id ?? '',
    status: props.orchestrationSession?.status ?? '',
  }),
  ({ isOrchestrating, sessionId, status }) => {
    if (
      isOrchestrating ||
      !sessionId ||
      !['completed', 'manual_review'].includes(status) ||
      !props.orchestrationSession
    ) {
      return
    }

    if (lastSummarySessionId.value === sessionId) {
      return
    }

    messages.value.push(buildOrchestrationOverviewMessage(props.orchestrationSession))
    lastSummarySessionId.value = sessionId

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
  grid-template-columns: minmax(0, 1fr) auto;
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
  word-break: break-word;
}

.system-summary-main {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.reason-tag-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.reason-tag-row.is-panel {
  margin-top: 10px;
}

.reason-tag {
  display: inline-flex;
  align-items: center;
  min-height: 22px;
  padding: 0 8px;
  border-radius: 999px;
  background: rgba(255, 247, 237, 0.9);
  border: 1px solid rgba(251, 146, 60, 0.16);
  color: #9a3412;
  font-size: 11px;
  font-weight: 600;
}

.system-thinking-text {
  font-size: 12px;
  line-height: 1.5;
  color: #6b7280;
  white-space: normal;
  word-break: break-word;
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
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.explanation-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.explanation-title {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: #78716c;
}

.explanation-content {
  font-size: 13px;
  line-height: 1.7;
}

.explanation-content.is-secondary {
  color: #475569;
}

.explanation-content.is-risk {
  color: #b45309;
}

.candidate-comparison-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.candidate-comparison-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.candidate-comparison-item {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 12px;
  align-items: start;
  padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid rgba(226, 232, 240, 0.95);
  background: rgba(248, 250, 252, 0.96);
}

.candidate-comparison-item.is-selected {
  border-color: rgba(251, 146, 60, 0.24);
  background: rgba(255, 247, 237, 0.98);
}

.candidate-comparison-main {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.candidate-comparison-name {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #1f2937;
  font-size: 13px;
  font-weight: 700;
  line-height: 1.5;
  word-break: break-word;
}

.candidate-comparison-badge {
  display: inline-flex;
  align-items: center;
  min-height: 20px;
  padding: 0 8px;
  border-radius: 999px;
  background: rgba(251, 146, 60, 0.14);
  color: #9a3412;
  font-size: 11px;
  font-weight: 700;
}

.candidate-comparison-meta {
  color: #64748b;
  font-size: 12px;
  line-height: 1.5;
}

.candidate-comparison-note {
  color: #475569;
  font-size: 12px;
  line-height: 1.6;
  text-align: right;
  max-width: 180px;
}

.details-panel {
  border-top: 1px solid rgba(148, 163, 184, 0.18);
  padding-top: 10px;
}

.details-toggle,
.raw-details-toggle {
  padding: 0;
}

.details-summary-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 10px;
}

.details-summary-list.is-panel {
  margin-top: 12px;
}

.detail-summary-item {
  display: grid;
  grid-template-columns: 84px 1fr;
  gap: 10px;
  align-items: start;
}

.detail-summary-label {
  color: #78716c;
  font-size: 12px;
  font-weight: 600;
}

.detail-summary-value {
  color: #334155;
  font-size: 12px;
  line-height: 1.6;
  word-break: break-word;
}

.raw-details-block {
  margin-top: 2px;
}

.details-data {
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

.layout-upload-status {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 18px 0;
  color: #7c2d12;
  font-size: 12px;
}

.layout-upload-label {
  font-weight: 600;
  color: #9a3412;
}

.layout-upload-name {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.layout-file-input {
  display: none;
}

.input-area {
  display: grid;
  grid-template-columns: 1fr auto auto;
  gap: 10px;
  padding: 18px;
  border-top: 1px solid rgba(251, 146, 60, 0.12);
  background: rgba(255, 255, 255, 0.92);
}

.layout-upload-button {
  min-width: 44px;
  padding-left: 12px;
  padding-right: 12px;
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

  .candidate-comparison-item {
    grid-template-columns: 1fr;
  }

  .candidate-comparison-note {
    max-width: none;
    text-align: left;
  }
}
</style>

