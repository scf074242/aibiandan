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
            { 'is-focusable': canFocusMessage(message) },
          ]"
        >
          <div
            v-if="message.role !== 'user'"
            class="system-summary-row"
            :class="{ 'is-focusable': canFocusMessage(message) }"
            @click="handleMessageFocus(message)"
          >
            <div class="system-summary-main">
              <div class="system-mainline">
                <span
                  v-if="shouldShowStatusLabel(message)"
                  class="system-status-text"
                  :class="`is-${message.statusTone || 'neutral'}`"
                >
                  {{ message.statusLabel }}
                </span>
                <div
                  v-if="getPrimarySummary(message)"
                  class="system-summary-text"
                  :title="message.content"
                >
                  {{ getPrimarySummary(message) }}
                </div>
              </div>
            </div>
            <div class="system-summary-side">
              <div
                v-if="message.stepMetric"
                class="step-timer-chip"
                :class="{ 'is-running': message.stepMetric.mode === 'elapsed' }"
              >
                <span class="step-timer-value">{{ formatStepMetric(message.stepMetric) }}</span>
              </div>
              <el-button
                v-if="hasExpandableExplanation(message)"
                link
                size="small"
                class="process-toggle"
                @click.stop="toggleExpanded(message)"
              >
                {{ message.expanded ? '收起详情' : '详情' }}
              </el-button>
            </div>
          </div>

          <div v-if="message.role === 'user'" class="message-text">{{ message.content }}</div>

          <div v-if="message.role !== 'user' && (message.expanded ?? false)" class="explanation-card">
            <div
              v-for="section in getExpandedSections(message)"
              :key="section.title"
              class="explanation-section"
              :class="{
                'is-secondary': section.tone === 'secondary',
                'is-risk': section.tone === 'risk',
              }"
            >
              <span class="explanation-title">{{ section.title }}</span>
              <div class="explanation-content">{{ section.body }}</div>
            </div>

            <div
              v-if="getCandidateComparisonItems(message).length > 0"
              class="candidate-comparison-panel"
            >
              <div class="explanation-title">候选</div>
              <div class="candidate-comparison-list">
                <div
                  v-for="candidate in getCandidateComparisonItems(message)"
                  :key="candidate.id"
                  class="candidate-comparison-item"
                  :class="{ 'is-selected': candidate.selected }"
                >
                  <div class="candidate-comparison-name-line">
                    <span class="candidate-comparison-name">{{ candidate.name }}</span>
                    <span v-if="candidate.selected" class="candidate-comparison-badge">已采用</span>
                  </div>
                  <div v-if="candidate.meta" class="candidate-comparison-meta">{{ candidate.meta }}</div>
                  <div v-if="candidate.note" class="candidate-comparison-note">{{ candidate.note }}</div>
                </div>
              </div>
            </div>

            <div
              v-if="getDetailsSummaryItems(message).length > 0 || message.explanation?.details"
              class="details-panel"
            >
              <el-button link size="small" class="details-toggle" @click="toggleDetailExpanded(message)">
                {{ message.detailExpanded ? '收起明细' : '明细' }}
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

    <div v-if="pendingLayoutDraft" class="pending-command-panel layout-draft-panel">
      <div class="pending-command-header">
        <div>
          <div class="pending-command-title">版面草案</div>
          <div class="pending-command-summary">{{ getLayoutDraftHeaderText(pendingLayoutDraft) }}</div>
        </div>
        <el-tag type="success" effect="light">{{ getLayoutDraftSourceLabel(pendingLayoutDraft) }}</el-tag>
      </div>

      <div class="pending-command-body">
        <div class="pending-command-reasoning">
          覆盖 {{ formatDisplayTimeRange(pendingLayoutDraft.coverage.start, pendingLayoutDraft.coverage.end) }}，
          共 {{ pendingLayoutDraft.layoutReference.slots.length }} 个时段。
        </div>
        <div v-if="getLayoutDraftSegmentItems(pendingLayoutDraft).length" class="layout-draft-segment-list">
          <div
            v-for="segment in getLayoutDraftSegmentItems(pendingLayoutDraft)"
            :key="segment.segmentId"
            class="layout-draft-segment-item"
          >
            <div class="layout-draft-segment-main">
              <div class="layout-draft-segment-time">
                {{ formatDisplayTimeRange(segment.startTime, segment.endTime) }}
              </div>
              <div class="layout-draft-segment-label">{{ segment.label }}</div>
            </div>
          </div>
        </div>
        <div class="pending-command-reasoning">
          你可以继续输入自然语言微调当前草案，确认后再开始编排。
        </div>
      </div>

      <div class="pending-command-actions">
        <el-button type="primary" size="small" @click="confirmLayoutDraft">开始编排</el-button>
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
import { nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { ChatDotRound, Promotion, UploadFilled } from '@element-plus/icons-vue'
import type { ChatMessage } from '@/types/llm'
import type {
  DraftFeasibilityReport,
  ExplanationResult,
  LayoutDraft,
  OrchestrationCommand,
  PlanningLogEntry,
  PlanningSession,
  TaskMode,
  ValidationReport,
} from '@/types/orchestration'
import { getCommandExecutor } from '@/services/commandExecutor'
import { getScheduleCommandBus } from '@/services/scheduleCommandBus'
import { getLayoutImportService } from '@/services/layoutImportService'
import { getCandidateService } from '@/services/candidateService'
import {
  getOpenClawBridge,
  type OpenClawBridgeResult,
} from '@/services/openclaw/openClawBridge'
import {
  summarizeRuntimeCommand,
  type RuntimeDecision,
  type RuntimeFeedback,
  type RuntimeOrchestrationRequest,
  type RuntimePendingCommand,
  type RuntimePendingTargetSelection,
  type RuntimeScheduleItem,
} from '@/services/runtime/demoRuntimeFacade'
import type { RuntimeBridgeSessionState } from '@/services/runtime/runtimeSessionStore'
import {
  clearRuntimeLayout,
  getEffectiveColumnDefinition,
  getRuntimeLayoutEntry,
  setRuntimeLayout,
} from '@/services/orchestration/runtimeLayoutRegistry'
import {
  formatDetails as formatStructuredDetails,
  formatOffset as formatOffsetText,
  formatProgramLabel as formatProgramDisplayLabel,
  formatValidationSummaryText,
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

interface MessageStepMetric {
  mode: 'elapsed' | 'duration'
  label: string
  elapsedMs?: number
  durationMs?: number
}

interface MessageFocusTarget {
  type: 'item' | 'gap' | 'range'
  startTime: string
  endTime: string
  itemId?: string
  gapId?: string
  layer?: 'intent' | 'process' | 'issue' | 'result'
  status?: 'active' | 'success' | 'error'
  error?: string
}

interface Message extends ChatMessage {
  explanation?: ExplanationResult
  processType?: ProcessType
  processTypeLabel?: string
  statusLabel?: string
  statusTone?: 'running' | 'success' | 'warning' | 'error' | 'neutral'
  expanded?: boolean
  thinking?: string
  reasonTags?: string[]
  detailExpanded?: boolean
  rawDetailsExpanded?: boolean
  mergeKey?: string
  mergeKind?: 'idea' | 'query_request' | 'query_result' | 'selection' | 'execution' | 'other'
  stepMetric?: MessageStepMetric
  focusTarget?: MessageFocusTarget
}

type SchedulePreviewItem = RuntimeScheduleItem

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
  commandExecuted: [result: {
    success: boolean
    message: string
    commandAction?: string
    data?: unknown
    affectedTimeRanges?: { start: string; end: string }[]
    validationReport?: ValidationReport
  }]
  scheduleUpdated: [items: Props['currentSchedule']]
  orchestrateRequested: [payload: RuntimeOrchestrationRequest]
  cancelRequested: []
  focusRequested: [payload: MessageFocusTarget]
  layoutDraftUpdated: [payload: { draft: LayoutDraft | null; feasibilityReport: DraftFeasibilityReport | null }]
}>()

const messages = ref<Message[]>([])
const inputMessage = ref('')
const loading = ref(false)
const messagesContainer = ref<HTMLElement>()
const layoutFileInput = ref<HTMLInputElement>()
const pendingCommand = ref<RuntimePendingCommand | null>(null)
const pendingTargetSelection = ref<RuntimePendingTargetSelection | null>(null)
const pendingLayoutDraft = ref<LayoutDraft | null>(null)
const layoutDraftFeasibility = ref<DraftFeasibilityReport | null>(null)
const pendingLayoutDraftMode = ref<Extract<TaskMode, 'full_generate' | 'partial_generate'> | null>(null)
const commandExecutor = getCommandExecutor()
const candidateService = getCandidateService()
const scheduleCommandBus = getScheduleCommandBus()
const openClawBridge = getOpenClawBridge()
const layoutImportService = getLayoutImportService()
const displayedLogIds = ref<string[]>([])
const lastSummarySessionId = ref('')
const uploadingLayout = ref(false)
const activeImportedLayoutName = ref('')
const bridgeSessionId = ref('')
const queuedCommands = ref<string[]>([])
let unsubscribeBridgeSession: (() => void) | null = null
let activeThinkingController: {
  stop: () => void
  message: Message
  sessionId: string
  startedAtMs: number
} | null = null
const MAX_DISPLAYED_LOG_IDS = 60
const MAX_MESSAGE_COUNT = 40
const MAX_RUNTIME_PROGRESS_MESSAGES = 24
const activeStepTimerIds = new Set<number>()
const MIN_VISIBLE_MESSAGE_DURATION_MS = 100

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

const getLayoutDraftSourceLabel = (draft: LayoutDraft) => {
  switch (draft.source) {
    case 'uploaded':
      return '上传版面'
    case 'channel_default':
      return '频道版面'
    default:
      return 'AI 草案'
  }
}

const getLayoutDraftHeaderText = (draft: LayoutDraft) =>
  `${formatDisplayTimeRange(draft.coverage.start, draft.coverage.end)} · ${draft.layoutReference.slots.length} 个时段`

const getLayoutDraftSegmentItems = (draft: LayoutDraft) =>
  draft.layoutReference.slots.map((slot, index) => {
    const column = draft.columns[index]
    return {
      segmentId: slot.id,
      label: column?.semanticLabel ?? column?.columnName ?? `时段 ${index + 1}`,
      startTime: normalizeClockText(slot.startTime),
      endTime: normalizeClockText(slot.endTime),
    }
  })

const clearPendingLayoutDraftState = () => {
  pendingLayoutDraft.value = null
  layoutDraftFeasibility.value = null
  pendingLayoutDraftMode.value = null
  emit('layoutDraftUpdated', {
    draft: null,
    feasibilityReport: null,
  })
}

const confirmLayoutDraft = () => {
  if (!pendingLayoutDraft.value || !pendingLayoutDraftMode.value) {
    return
  }

  const draft = pendingLayoutDraft.value
  const mode = pendingLayoutDraftMode.value
  clearPendingLayoutDraftState()
  emit('orchestrateRequested', {
    userInput: '按当前版面开始编排',
    mode,
    reasoning: '用户确认当前版面草案并开始编排。',
    layoutDraft: draft,
  })
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

const getBridgeConversationId = () => `${props.channelId}::${props.date}`

const syncBridgeSessionState = (state: RuntimeBridgeSessionState) => {
  bridgeSessionId.value = state.sessionId
  pendingCommand.value = state.pendingCommand ?? null
  pendingTargetSelection.value = state.pendingTargetSelection ?? null
  pendingLayoutDraft.value = state.pendingLayoutDraft ?? null
  layoutDraftFeasibility.value = state.layoutDraftFeasibility ?? null
  pendingLayoutDraftMode.value = state.layoutDraftMode ?? null
  emit('layoutDraftUpdated', {
    draft: pendingLayoutDraft.value,
    feasibilityReport: layoutDraftFeasibility.value,
  })
}

const attachBridgeSession = (sessionId: string) => {
  if (bridgeSessionId.value === sessionId && unsubscribeBridgeSession) {
    return
  }

  unsubscribeBridgeSession?.()
  bridgeSessionId.value = sessionId
  unsubscribeBridgeSession = openClawBridge.subscribe(sessionId, (state) => {
    syncBridgeSessionState(state)
  })
}

const appendRuntimeFeedback = (feedback: RuntimeFeedback) => {
  const feedbackProcessType = feedback.processType as ProcessType
  const details = (feedback.details ?? undefined) as DetailMap | undefined
  pushAssistantMessage(buildAssistantMessage({
    content: feedback.content,
    thinking: feedback.thinking,
    explanation: feedback.explanation
      ? {
          type: 'command',
          targetId: `runtime-${Date.now()}`,
          explanation: feedback.explanation,
          details,
        }
      : undefined,
    processType: feedbackProcessType,
    processTypeLabel: feedback.processTypeLabel,
    focusTarget: details
      ? extractFocusTargetFromDetails(
          details,
          feedbackProcessType,
          feedbackProcessType === 'error' ? 'issue' : 'intent',
        )
      : undefined,
  }))
}

const applyRuntimeDecision = async (decision: RuntimeDecision) => {
  switch (decision.kind) {
    case 'message':
      appendRuntimeFeedback(decision.feedback)
      return
    case 'pending_command':
      appendRuntimeFeedback(decision.feedback)
      pendingCommand.value = decision.pendingCommand
      return
    case 'pending_target_selection':
      appendRuntimeFeedback(decision.feedback)
      pendingTargetSelection.value = decision.pendingTargetSelection
      return
    case 'execute_command':
      emitFocusTarget(
        decision.execution.details
          ? extractFocusTargetFromDetails(
              decision.execution.details as DetailMap,
              'execution',
              'intent',
            )
          : undefined,
      )
      await executeCommand(decision.execution.command, {
        successMessage: decision.execution.successMessage,
        thinking: decision.execution.thinking,
        explanation: decision.execution.explanation,
        details: decision.execution.details,
      })
      return
    case 'orchestration':
      appendRuntimeFeedback(decision.feedback)
      emit('orchestrateRequested', decision.orchestrationRequest)
      return
    case 'layout_draft':
      appendRuntimeFeedback(decision.feedback)
      pendingLayoutDraft.value = decision.draft
      layoutDraftFeasibility.value = decision.feasibilityReport
      pendingLayoutDraftMode.value = decision.orchestrationMode
      emit('layoutDraftUpdated', {
        draft: decision.draft,
        feasibilityReport: decision.feasibilityReport,
      })
      return
    case 'layout_commit':
      appendRuntimeFeedback(decision.feedback)
      pendingLayoutDraft.value = null
      layoutDraftFeasibility.value = null
      pendingLayoutDraftMode.value = null
      emit('layoutDraftUpdated', {
        draft: null,
        feasibilityReport: null,
      })
      emit('orchestrateRequested', decision.orchestrationRequest)
      return
  }
}

const applyBridgeResult = async (result: OpenClawBridgeResult) => {
  attachBridgeSession(result.sessionId)
  const session = openClawBridge.getSessionState(result.sessionId)
  if (!session) {
    return
  }

  syncBridgeSessionState(session)

  if (session.lastExecution) {
    const executed = session.lastExecution
    if (executed.success) {
      emit('commandExecuted', {
        success: true,
        message: executed.message,
        commandAction: executed.command.action,
        data: executed.data,
        affectedTimeRanges: executed.affectedTimeRanges,
        validationReport: executed.validationReport,
      })
      ElMessage.success(executed.message)
      emit('scheduleUpdated', commandExecutor.getScheduleItems())
      const details = {
        ...(executed.details ?? {}),
        validationSummary: executed.validationSummary,
      } as DetailMap
      pushAssistantMessage(buildAssistantMessage({
        content: executed.message,
        thinking: executed.thinking,
        explanation: executed.explanation
          ? {
              type: 'command',
              targetId: `bridge-execution-${Date.now()}`,
              explanation: executed.explanation,
              details,
            }
          : undefined,
        processType: 'execution',
        processTypeLabel: '执行完成',
        focusTarget: executed.command.action === 'delete'
          ? undefined
          : extractFocusTargetFromDetails(details, 'execution', 'result'),
      }), {
        autoFocus: false,
      })
    } else {
      emit('commandExecuted', {
        success: false,
        message: executed.message,
        commandAction: executed.command.action,
        data: executed.data,
        affectedTimeRanges: executed.affectedTimeRanges,
        validationReport: executed.validationReport,
      })
      ElMessage.error(executed.error || executed.message)
      const details = (executed.details ?? undefined) as DetailMap | undefined
      pushAssistantMessage(buildAssistantMessage({
        content: executed.error || executed.message,
        explanation: executed.explanation
          ? {
              type: 'command',
              targetId: `bridge-execution-error-${Date.now()}`,
              explanation: executed.explanation,
              details,
            }
          : undefined,
        processType: 'error',
        processTypeLabel: '执行失败',
        focusTarget: details ? extractFocusTargetFromDetails(details, 'error', 'issue') : undefined,
      }))
    }
    return
  }

  if (session.lastDecision) {
    await applyRuntimeDecision(session.lastDecision)
  }
}

const processMessage = async (content: string) => {
  loading.value = true
  const stepProgress = startStepProgress('思考中')

  try {
    const result = await openClawBridge.submitInstruction({
      conversationId: getBridgeConversationId(),
      channelId: props.channelId,
      channelName: props.channelName,
      date: props.date,
      text: content,
      currentSchedule: props.currentSchedule,
      gapCount: props.gapCount,
      history: messages.value.slice(-6).map((message) => message.content),
    })
    await applyBridgeResult(result)
    attachStepMetricToLatestAssistantMessage(stepProgress.finish())
  } catch (error) {
    const stepMetric = stepProgress.finish()
    messages.value.push(buildAssistantMessage({
      content: error instanceof Error ? error.message : 'AI 请求失败，请稍后重试。',
      processType: 'error',
      processTypeLabel: '执行异常',
      stepMetric,
    }))
  } finally {
    loading.value = false
    await scrollToBottom()
    const nextContent = queuedCommands.value.shift()
    if (nextContent) {
      void processMessage(nextContent)
    }
  }
}

const sendMessage = async () => {
  const content = inputMessage.value.trim()
  if (!content) return

  // 新用户命令到来时，先清理上一次遗留的确认态，避免旧面板和新执行结果叠在一起
  pendingCommand.value = null
  pendingTargetSelection.value = null

  messages.value.push({ role: 'user', content })
  inputMessage.value = ''
  await scrollToBottom()

  if (loading.value) {
    queuedCommands.value.push(content)
    return
  }

  await processMessage(content)
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

const resolveMessageStatusMeta = (message: Message): Pick<Message, 'statusLabel' | 'statusTone'> => {
  if (message.statusLabel && message.statusTone) {
    return {
      statusLabel: message.statusLabel,
      statusTone: message.statusTone,
    }
  }

  if (message.stepMetric?.mode === 'elapsed') {
    return { statusLabel: '思考中', statusTone: 'running' }
  }

  if (message.processType === 'error') {
    return { statusLabel: '失败', statusTone: 'error' }
  }

  if (/待确认|需选择|待处理/.test(message.processTypeLabel || message.content)) {
    return { statusLabel: '待处理', statusTone: 'warning' }
  }

  if (/已取消/.test(message.processTypeLabel || message.content)) {
    return { statusLabel: '已取消', statusTone: 'neutral' }
  }

  return { statusLabel: '', statusTone: 'success' }
}

const decorateAssistantMessage = (message: Message): Message => {
  const next: Message = { ...message }
  const reasonTags = (next.reasonTags?.length ? next.reasonTags : buildReasonTagsForMessage(next)).slice(0, 3)
  const statusMeta = resolveMessageStatusMeta(next)

  if (reasonTags.length > 0) {
    next.reasonTags = reasonTags
    next.thinking = buildDecisionShortExplanation(next)
  }

  next.statusLabel = statusMeta.statusLabel
  next.statusTone = statusMeta.statusTone

  return next
}

const buildAssistantMessage = (input: Omit<Message, 'role'>): Message =>
  decorateAssistantMessage({
    role: 'assistant',
    expanded: false,
    ...input,
  })

const buildCompletedStepMetric = (durationMs: number): MessageStepMetric => ({
  mode: 'duration',
  label: '耗时',
  durationMs,
})

const formatStepMetric = (metric: MessageStepMetric): string => {
  if (metric.mode === 'duration') {
    const durationMs = metric.durationMs ?? 0
    return `${Math.max(0, durationMs / 1000).toFixed(2)}s`
  }

  const elapsedMs = metric.elapsedMs ?? 0
  return `${Math.max(0, elapsedMs / 1000).toFixed(2)}s`
}

const startStepProgress = (content: string) => {
  const progressMessage = reactive(buildAssistantMessage({
    content,
    processType: 'general',
    processTypeLabel: '处理中',
    stepMetric: {
      mode: 'elapsed',
      label: '耗时',
      elapsedMs: 0,
    },
  }))

  messages.value.push(progressMessage)

  const startedAt = Date.now()
  const timerId = window.setInterval(() => {
    const elapsedMs = Date.now() - startedAt
    progressMessage.stepMetric = {
      mode: 'elapsed',
      label: '耗时',
      elapsedMs,
    }
  }, 10)
  activeStepTimerIds.add(timerId)

  let completed = false
  return {
    finish() {
      if (completed) {
        return buildCompletedStepMetric(0)
      }
      completed = true
      window.clearInterval(timerId)
      activeStepTimerIds.delete(timerId)
      const durationMs = Date.now() - startedAt
      const index = messages.value.indexOf(progressMessage)
      if (index >= 0) {
        messages.value.splice(index, 1)
      }
      return buildCompletedStepMetric(durationMs)
    },
  }
}

const attachStepMetricToLatestAssistantMessage = (metric: MessageStepMetric) => {
  for (let index = messages.value.length - 1; index >= 0; index -= 1) {
    const candidate = messages.value[index]
    if (!candidate || candidate.role !== 'assistant') continue
    candidate.stepMetric = metric
    const statusMeta = resolveMessageStatusMeta(candidate)
    candidate.statusLabel = statusMeta.statusLabel
    candidate.statusTone = statusMeta.statusTone
    return
  }
}

const isDecisionMessage = (message: Message) => (message.reasonTags?.length ?? 0) > 0

const shouldShowStatusLabel = (message: Message) => Boolean(message.statusLabel?.trim())

const startPersistentThinking = (
  content: string,
  options?: {
    startedAtMs?: number
    sessionId?: string
  },
) => {
  const startedAtMs = options?.startedAtMs ?? Date.now()
  const sessionId = options?.sessionId ?? ''
  const thinkingMessage = reactive(buildAssistantMessage({
    content,
    processType: 'planning',
    processTypeLabel: '处理中',
    statusLabel: '思考中',
    statusTone: 'running',
    stepMetric: {
      mode: 'elapsed',
      label: '耗时',
      elapsedMs: Math.max(0, Date.now() - startedAtMs),
    },
  }))

  messages.value.push(thinkingMessage)

  const timerId = window.setInterval(() => {
    thinkingMessage.stepMetric = {
      mode: 'elapsed',
      label: '耗时',
      elapsedMs: Math.max(0, Date.now() - startedAtMs),
    }
  }, 10)
  activeStepTimerIds.add(timerId)

  return {
    sessionId,
    startedAtMs,
    message: thinkingMessage,
    stop() {
      window.clearInterval(timerId)
      activeStepTimerIds.delete(timerId)
      const index = messages.value.indexOf(thinkingMessage)
      if (index >= 0) {
        messages.value.splice(index, 1)
      }
    },
  }
}

const keepPersistentThinkingAtBottom = () => {
  const thinkingMessage = activeThinkingController?.message
  if (!thinkingMessage) return

  const index = messages.value.indexOf(thinkingMessage)
  if (index < 0 || index === messages.value.length - 1) {
    return
  }

  messages.value.splice(index, 1)
  messages.value.push(thinkingMessage)
}

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

const getPrimarySummary = (message: Message): string => {
  if (message.stepMetric?.mode === 'elapsed') {
    return ''
  }

  const content = message.content.trim()
  if (!content) return '已更新'

  return content
}

const getVisibleFacts = (message: Message): string[] => {
  const details = getMessageDetails(message)
  if (!details) {
    return (message.reasonTags ?? []).slice(0, 1)
  }

  if (isOrchestrationOverviewDetails(details)) {
    const facts = [
      typeof details.layoutSlotCount === 'number' ? `版面时段 ${details.layoutSlotCount}` : '',
      typeof details.completedGapCount === 'number' ? `补排 ${details.completedGapCount} 轮` : '',
      typeof details.writtenItemCount === 'number' ? `写入 ${details.writtenItemCount} 条` : '',
      formatValidationSummaryText(details.validationSummary),
    ].filter(Boolean)

    return facts.slice(0, 2)
  }

  if (isLayoutImportDetails(details)) {
    const facts = [
      typeof details.matchedWeekdayLabel === 'string' ? details.matchedWeekdayLabel : '',
      typeof details.matchedColumnLabel === 'string' ? `列 ${details.matchedColumnLabel}` : '',
      typeof details.matchedSheetName === 'string' ? `表 ${details.matchedSheetName}` : '',
      typeof details.slotCount === 'number' ? `时段 ${details.slotCount}` : '',
    ].filter(Boolean)

    return facts.slice(0, 2)
  }

  const facts: string[] = []
  if (typeof details.startTime === 'string') {
    facts.push(formatDisplayTimeRange(details.startTime, typeof details.endTime === 'string' ? details.endTime : undefined))
  } else if (typeof details.targetTime === 'string') {
    facts.push(formatDisplayTime(details.targetTime))
  }

  const matchedColumnText = formatMatchedColumnText(details)
  if (matchedColumnText) {
    facts.push(`栏目 ${matchedColumnText}`)
  }

  const selectedProgramName =
    typeof details.selectedCandidateName === 'string'
      ? details.selectedCandidateName
      : typeof details.programName === 'string'
        ? details.programName
        : ''
  if (selectedProgramName) {
    facts.push(`节目 《${selectedProgramName}》`)
  }

  if (typeof details.candidateCount === 'number') {
    facts.push(`候选 ${details.candidateCount}`)
  }

  if (typeof details.offsetSeconds === 'number') {
    facts.push(`调整 ${formatOffset(details.offsetSeconds)}`)
  }

  const validationSummary = formatValidationSummaryText(details.validationSummary ?? details.summary)
  if (validationSummary && validationSummary !== '未发现明显问题') {
    facts.push(validationSummary)
  }

  if (facts.length === 0) {
    return (message.reasonTags ?? []).slice(0, 1)
  }

  return Array.from(new Set(facts)).slice(0, 2)
}

const resolveLogDurationMs = (
  log: PlanningLogEntry,
  previousLog?: PlanningLogEntry,
): number | null => {
  const currentTime = new Date(log.timestamp).getTime()
  const previousTime = previousLog ? new Date(previousLog.timestamp).getTime() : NaN
  if (Number.isFinite(currentTime) && Number.isFinite(previousTime) && currentTime >= previousTime) {
    const durationMs = currentTime - previousTime
    return durationMs >= MIN_VISIBLE_MESSAGE_DURATION_MS ? durationMs : null
  }
  return null
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
  const basis = buildExpandedBasis(message)
  const risk = buildExpandedRisk(message)

  if (basis) {
    sections.push({ title: '依据', body: basis, tone: 'secondary' })
  }
  if (risk) {
    sections.push({ title: '风险', body: risk, tone: 'risk' })
  }
  if (sections.length === 0) {
    const why = buildExpandedWhy(message)
    if (why) {
      sections.push({ title: '说明', body: why })
    }
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

const extractFocusTargetFromRuntimeItem = (
  item: unknown,
  status: MessageFocusTarget['status'] = 'active',
): MessageFocusTarget | undefined => {
  if (!item || typeof item !== 'object') return undefined

  const record = item as Record<string, unknown>
  const itemId = typeof record.id === 'string' ? record.id : ''
  const startTime = typeof record.startTime === 'string' ? record.startTime : ''
  const endTime = typeof record.endTime === 'string' ? record.endTime : ''

  if (!startTime || !endTime) return undefined

  return itemId
    ? {
        type: 'item',
        itemId,
        startTime,
        endTime,
        status,
      }
    : {
        type: 'range',
        startTime,
        endTime,
        status,
      }
}

const buildPendingCommandFocusTarget = (
  value: RuntimePendingCommand | null,
): MessageFocusTarget | undefined => {
  if (!value?.details) return undefined

  const directTarget = extractFocusTargetFromDetails(value.details as DetailMap, 'execution', 'intent')
  if (directTarget) {
    return {
      ...directTarget,
      layer: 'intent',
      status: directTarget.status ?? 'active',
    }
  }

  const matchedItemTarget = extractFocusTargetFromRuntimeItem(
    (value.details as DetailMap).matchedItem,
    'active',
  )
  if (matchedItemTarget) {
    return {
      ...matchedItemTarget,
      layer: 'intent',
    }
  }

  return undefined
}

const buildPendingTargetSelectionFocusTarget = (
  value: RuntimePendingTargetSelection | null,
): MessageFocusTarget | undefined => {
  if (!value) return undefined

  const selectedCandidate = value.selectedItemId
    ? value.candidates.find((candidate) => candidate.id === value.selectedItemId)
    : null
  const selectedTarget = extractFocusTargetFromRuntimeItem(selectedCandidate, 'active')
  if (selectedTarget) {
    return {
      ...selectedTarget,
      layer: 'intent',
    }
  }

  if (value.candidates.length === 1) {
    const soleTarget = extractFocusTargetFromRuntimeItem(value.candidates[0], 'active')
    if (soleTarget) {
      return {
        ...soleTarget,
        layer: 'intent',
      }
    }
  }

  const normalizedTargetTime = normalizeClockText(value.targetTime)
  if (!normalizedTargetTime) return undefined

  return {
    type: 'range',
    startTime: normalizedTargetTime,
    endTime: normalizedTargetTime,
    layer: 'intent',
    status: 'active',
  }
}

const emitFocusTarget = (focusTarget?: MessageFocusTarget) => {
  if (!focusTarget) return
  emit('focusRequested', focusTarget)
}

const pushAssistantMessage = (
  message: Message,
  options?: {
    autoFocus?: boolean
  },
) => {
  messages.value.push(message)
  if (options?.autoFocus !== false) {
    emitFocusTarget(message.focusTarget)
  }
}

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

const formatMatchedColumnPhrase = (details?: DetailMap) => {
  const matchedColumnText = formatMatchedColumnText(details)
  return matchedColumnText ? `栏目 ${matchedColumnText}` : '当前栏目约束'
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

  if (log.phase === 'planning' && typeof details.layoutSlotCount === 'number') {
    return false
  }

  if (log.phase === 'planning' && details.strategy && typeof details.initialGapCount === 'number') {
    return false
  }

  if (log.phase === 'planning' && typeof details.batchGapIds !== 'undefined') {
    return false
  }

  if (log.phase === 'planning' && details.criteria && typeof details.criteria === 'object') {
    return false
  }

  if (log.phase === 'planning' && /已锁定版面范围/.test(log.message)) {
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
  const matchedColumnPhrase = formatMatchedColumnPhrase(details)
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
    return `${timeRange ? `${timeRange} 这段空窗` : '当前空窗'}已完成候选检索，正在基于${columnName || matchedColumnPhrase}继续判断候选。`
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
    const matchedColumnPhrase = formatMatchedColumnPhrase(details)
    return timeRange
      ? `${timeRange} 已完成候选检索，命中 ${details.candidateCount} 个候选，来自${matchedColumnPhrase}。`
      : `已完成候选检索，命中 ${details.candidateCount} 个候选，来自${matchedColumnPhrase}。`
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

  emit('commandExecuted', {
    success: result.success,
    message: result.message,
    commandAction: command.action,
    data: result.data,
    affectedTimeRanges: result.affectedTimeRanges,
    validationReport: result.validationReport,
  })
  if (result.success) {
    ElMessage.success(result.message)
    emit('scheduleUpdated', commandExecutor.getScheduleItems())
    const detailPayload = options?.details as DetailMap | undefined
    const deletedItem =
      command.action === 'delete'
      && result.data
      && typeof result.data === 'object'
      && 'deletedItem' in result.data
        ? result.data.deletedItem as {
            startTime: string
            endTime: string
          }
        : null
    pushAssistantMessage(buildAssistantMessage({
      content: options?.successMessage || `${summarizeRuntimeCommand(command)}，执行成功。`,
      thinking: options?.thinking,
      explanation: options?.explanation
        ? {
            type: 'command',
            targetId: 'execution-result',
            explanation: options.explanation,
            details: {
              ...(detailPayload ?? {}),
              validationSummary: result.validationReport?.summary,
            },
          }
        : undefined,
      processType: 'execution',
      processTypeLabel: '执行完成',
      focusTarget: deletedItem
        ? undefined
        : detailPayload
          ? extractFocusTargetFromDetails(detailPayload, 'execution', 'result')
          : undefined,
    }), {
      autoFocus: false,
    })
  } else {
    ElMessage.error(result.error || result.message)
    const detailPayload = options?.details as DetailMap | undefined
    pushAssistantMessage(buildAssistantMessage({
      content: result.error || result.message,
      thinking: options?.thinking,
      explanation: options?.explanation
        ? {
            type: 'command',
            targetId: 'execution-error',
            explanation: options.explanation,
            details: detailPayload,
          }
        : undefined,
      processType: 'error',
      processTypeLabel: '执行失败',
      focusTarget: detailPayload ? extractFocusTargetFromDetails(detailPayload, 'error', 'issue') : undefined,
    }))
  }
}

const confirmPendingCommand = async () => {
  if (!pendingCommand.value || !bridgeSessionId.value) return
  const stepProgress = startStepProgress('思考中')
  try {
    const result = await openClawBridge.confirm(bridgeSessionId.value)
    await applyBridgeResult(result)
    attachStepMetricToLatestAssistantMessage(stepProgress.finish())
  } catch (error) {
    messages.value.push(buildAssistantMessage({
      content: error instanceof Error ? error.message : '确认执行失败，请稍后重试。',
      processType: 'error',
      processTypeLabel: '执行异常',
      stepMetric: stepProgress.finish(),
    }))
  }
}

const confirmPendingTargetSelection = async () => {
  if (!pendingTargetSelection.value?.selectedItemId || !bridgeSessionId.value) return
  const stepProgress = startStepProgress('思考中')
  try {
    const result = await openClawBridge.selectTarget(
      bridgeSessionId.value,
      pendingTargetSelection.value.selectedItemId,
    )
    await applyBridgeResult(result)
    attachStepMetricToLatestAssistantMessage(stepProgress.finish())
  } catch (error) {
    messages.value.push(buildAssistantMessage({
      content: error instanceof Error ? error.message : '确认目标失败，请稍后重试。',
      processType: 'error',
      processTypeLabel: '执行异常',
      stepMetric: stepProgress.finish(),
    }))
  }
}

const cancelPendingCommand = async () => {
  if (!pendingCommand.value) return
  const stepProgress = startStepProgress('思考中')
  try {
    if (bridgeSessionId.value) {
      await openClawBridge.cancel(bridgeSessionId.value)
    }
    messages.value.push(buildAssistantMessage({
      content: `${pendingCommand.value.summary}，已取消执行。`,
      thinking: '我已根据你的选择停止这次高风险修改，不会对当前编排单做任何变更。',
      processType: 'general',
      processTypeLabel: '已取消',
      stepMetric: stepProgress.finish(),
    }))
    pendingCommand.value = null
  } catch (error) {
    messages.value.push(buildAssistantMessage({
      content: error instanceof Error ? error.message : '取消执行失败，请稍后重试。',
      processType: 'error',
      processTypeLabel: '执行异常',
      stepMetric: stepProgress.finish(),
    }))
  }
}

const cancelPendingTargetSelection = async () => {
  if (!pendingTargetSelection.value) return
  const stepProgress = startStepProgress('思考中')
  try {
    if (bridgeSessionId.value) {
      await openClawBridge.cancel(bridgeSessionId.value)
    }
    messages.value.push(buildAssistantMessage({
      content: `${pendingTargetSelection.value.summary}，已取消选择。`,
      thinking: '我已停止这次目标选择，不会继续执行后续修改。',
      processType: 'general',
      processTypeLabel: '已取消',
      stepMetric: stepProgress.finish(),
    }))
    pendingTargetSelection.value = null
  } catch (error) {
    messages.value.push(buildAssistantMessage({
      content: error instanceof Error ? error.message : '取消目标选择失败，请稍后重试。',
      processType: 'error',
      processTypeLabel: '执行异常',
      stepMetric: stepProgress.finish(),
    }))
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

const extractFocusTargetFromDetails = (
  details: DetailMap,
  processType: ProcessType,
  layer?: MessageFocusTarget['layer'],
): MessageFocusTarget | undefined => {
  const status: MessageFocusTarget['status'] = processType === 'error' ? 'error' : 'active'
  const startTime = typeof details.startTime === 'string' ? details.startTime : ''
  const endTime = typeof details.endTime === 'string' ? details.endTime : ''
  const itemId = typeof details.itemId === 'string' ? details.itemId : undefined
  const gapId = typeof details.gapId === 'string' ? details.gapId : undefined

  if (itemId && startTime && endTime) {
    return {
      type: 'item',
      itemId,
      startTime,
      endTime,
      layer,
      status,
      error: typeof details.error === 'string' ? details.error : undefined,
    }
  }

  if (gapId && startTime && endTime) {
    return {
      type: 'gap',
      gapId,
      startTime,
      endTime,
      layer,
      status,
      error: typeof details.error === 'string' ? details.error : undefined,
    }
  }

  const matchedItemTarget = extractFocusTargetFromRuntimeItem(details.matchedItem, status)
  if (matchedItemTarget) {
    return {
      ...matchedItemTarget,
      layer,
      error: typeof details.error === 'string' ? details.error : undefined,
    }
  }

  const sourceTimeRange = toDetailMap(details.sourceTimeRange)
  if (typeof sourceTimeRange?.start === 'string' && typeof sourceTimeRange?.end === 'string') {
    return {
      type: 'range',
      startTime: sourceTimeRange.start,
      endTime: sourceTimeRange.end,
      layer,
      status,
      error: typeof details.error === 'string' ? details.error : undefined,
    }
  }

  const proposedTimeRange = toDetailMap(details.proposedTimeRange)
  if (typeof proposedTimeRange?.start === 'string' && typeof proposedTimeRange?.end === 'string') {
    return {
      type: 'range',
      startTime: proposedTimeRange.start,
      endTime: proposedTimeRange.end,
      layer,
      status,
      error: typeof details.error === 'string' ? details.error : undefined,
    }
  }

  if (typeof details.targetTime === 'string') {
    return {
      type: 'range',
      startTime: details.targetTime,
      endTime: details.targetTime,
      layer,
      status,
      error: typeof details.error === 'string' ? details.error : undefined,
    }
  }

  const issues = Array.isArray(details.issues) ? details.issues : []
  const primaryIssue = issues[0]
  if (primaryIssue && typeof primaryIssue === 'object') {
    const issueRecord = primaryIssue as Record<string, unknown>
    const location = toDetailMap(issueRecord.location)
    const issueItemId = typeof location?.itemId === 'string' ? location.itemId : undefined
    const issueTimeRange = toDetailMap(location?.timeRange)

    if (
      issueItemId
      && typeof issueTimeRange?.start === 'string'
      && typeof issueTimeRange?.end === 'string'
    ) {
      return {
        type: 'item',
        itemId: issueItemId,
        startTime: issueTimeRange.start,
        endTime: issueTimeRange.end,
        layer,
        status,
        error: typeof issueRecord.message === 'string' ? issueRecord.message : undefined,
      }
    }

    if (typeof issueTimeRange?.start === 'string' && typeof issueTimeRange?.end === 'string') {
      return {
        type: 'range',
        startTime: issueTimeRange.start,
        endTime: issueTimeRange.end,
        layer,
        status,
        error: typeof issueRecord.message === 'string' ? issueRecord.message : undefined,
      }
    }
  }

  const firstGapRange = Array.isArray(details.gapRanges) ? details.gapRanges[0] : undefined
  if (
    firstGapRange
    && typeof firstGapRange === 'object'
    && typeof firstGapRange.startTime === 'string'
    && typeof firstGapRange.endTime === 'string'
  ) {
    return {
      type: 'range',
      startTime: firstGapRange.startTime,
      endTime: firstGapRange.endTime,
      layer,
      status,
      error: typeof details.error === 'string' ? details.error : undefined,
    }
  }

  return undefined
}

const canFocusMessage = (message: Message) => message.role !== 'user' && Boolean(message.focusTarget)

const handleMessageFocus = (message: Message) => {
  if (!message.focusTarget) return
  emitFocusTarget(message.focusTarget)
}

const buildLogMessage = (log: PlanningLogEntry, previousLog?: PlanningLogEntry): Message => {
  const details = log.details ?? {}
  const processType = mapLogToProcessType(log)
  const explanationDetails = compressLogDetails(details, processType)
  const mergeMeta = getRuntimeMergeMeta(log)
  const durationMs = resolveLogDurationMs(log, previousLog)

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
    stepMetric: durationMs === null ? undefined : buildCompletedStepMetric(durationMs),
    focusTarget: extractFocusTargetFromDetails(
      details,
      processType,
      processType === 'error' ? 'issue' : 'process',
    ),
  })
}

const appendSystemLogMessage = (message: Message) => {
  if (tryMergeRuntimeMessage(message)) {
    keepPersistentThinkingAtBottom()
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
  keepPersistentThinkingAtBottom()
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
    focusTarget: extractFocusTargetFromDetails(
      mergedDetails,
      message.processType ?? 'general',
      message.processType === 'error' ? 'issue' : 'process',
    ),
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
    const matchedColumnPhrase = formatMatchedColumnPhrase(details)
    return `候选检索完成，命中 ${details.candidateCount} 个，来自${matchedColumnPhrase}`
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

  return log.message
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
  () => pendingCommand.value,
  (value) => {
    emitFocusTarget(buildPendingCommandFocusTarget(value))
  },
)

watch(
  () => ({
    summary: pendingTargetSelection.value?.summary ?? '',
    selectedItemId: pendingTargetSelection.value?.selectedItemId ?? '',
    targetTime: pendingTargetSelection.value?.targetTime ?? '',
    candidateIds: pendingTargetSelection.value?.candidates.map((candidate) => candidate.id).join('|') ?? '',
  }),
  () => {
    emitFocusTarget(buildPendingTargetSelectionFocusTarget(pendingTargetSelection.value))
  },
)

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

    let appended = false
    logs.forEach((log, index) => {
      if (displayedLogIds.value.includes(log.id)) return
      displayedLogIds.value.push(log.id)
      if (!shouldDisplayLog(log)) return
      appendSystemLogMessage(buildLogMessage(log, index > 0 ? logs[index - 1] : undefined))
      appended = true
    })

    if (!appended) return

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
    unsubscribeBridgeSession?.()
    unsubscribeBridgeSession = null
    bridgeSessionId.value = ''
    pendingCommand.value = null
    pendingTargetSelection.value = null
  },
  { immediate: true },
)

watch(
  () => ({
    isOrchestrating: props.isOrchestrating,
    sessionId: props.orchestrationSession?.id ?? '',
    status: props.orchestrationSession?.status ?? '',
    processingRange:
      props.orchestrationSession?.gaps.processing
        ? `${props.orchestrationSession.gaps.processing.startTime}_${props.orchestrationSession.gaps.processing.endTime}`
        : '',
  }),
  ({ isOrchestrating, sessionId, status, processingRange }) => {
    void processingRange
    if (isOrchestrating && props.orchestrationSession) {
      const content = '思考中'
      const startedAtMs = new Date(props.orchestrationSession.createdAt).getTime()
      const shouldRestartThinking = (
        !activeThinkingController
        || activeThinkingController.sessionId !== sessionId
        || activeThinkingController.startedAtMs !== startedAtMs
      )

      if (shouldRestartThinking) {
        activeThinkingController?.stop()
        activeThinkingController = startPersistentThinking(
          content,
          {
            startedAtMs,
            sessionId,
          },
        )
      } else if (activeThinkingController) {
        activeThinkingController.message.content = content
      }
    } else if (activeThinkingController) {
      activeThinkingController.stop()
      activeThinkingController = null
    }

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

onBeforeUnmount(() => {
  unsubscribeBridgeSession?.()
  unsubscribeBridgeSession = null
  activeThinkingController?.stop()
  activeThinkingController = null
  activeStepTimerIds.forEach((timerId) => window.clearInterval(timerId))
  activeStepTimerIds.clear()
})
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
  padding: 18px 18px 14px;
}

.message-item {
  margin-bottom: 10px;
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
  gap: 6px;
  padding: 8px 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
}

.system-row.is-focusable .system-summary-text {
  text-decoration: underline;
  text-decoration-color: rgba(245, 158, 11, 0.28);
  text-underline-offset: 2px;
}

.system-summary-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: start;
  gap: 10px;
  min-width: 0;
}

.system-summary-row.is-focusable {
  cursor: pointer;
}

.system-summary-row.is-focusable:hover .system-summary-text {
  color: #9a3412;
}

.system-summary-text {
  min-width: 0;
  font-size: 13px;
  line-height: 1.45;
  color: #223046;
  white-space: normal;
  word-break: break-word;
}

.system-summary-main {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.system-mainline {
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
}

.system-summary-side {
  display: flex;
  flex-direction: row;
  align-items: baseline;
  gap: 8px;
}

.system-status-text {
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
  font-size: 12px;
  font-weight: 500;
  line-height: 1.4;
}

.system-status-text.is-running {
  color: #9a3412;
}

.system-status-text.is-success {
  color: #475569;
}

.system-status-text.is-warning {
  color: #92400e;
}

.system-status-text.is-error {
  color: #991b1b;
}

.system-status-text.is-neutral {
  color: #475569;
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
  color: #64748b;
  min-height: auto;
}

.step-timer-chip {
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  min-width: 56px;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
  color: #64748b;
}

.step-timer-chip.is-running {
  color: #9a3412;
}

.step-timer-value {
  font-size: 12px;
  font-weight: 500;
  line-height: 1;
  font-variant-numeric: tabular-nums;
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
  border: 0;
  border-radius: 0;
  padding: 4px 0 0;
  background: transparent;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.explanation-section {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.explanation-title {
  flex: 0 0 auto;
  min-width: 28px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0;
  color: #78716c;
  line-height: 1.7;
}

.explanation-content {
  flex: 1;
  font-size: 13px;
  line-height: 1.7;
  color: #334155;
}

.explanation-section.is-secondary .explanation-content {
  color: #475569;
}

.explanation-section.is-risk .explanation-content {
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
  gap: 6px;
}

.candidate-comparison-item {
  display: flex;
  flex-direction: column;
  gap: 3px;
  align-items: stretch;
  padding: 7px 0;
  border-radius: 0;
  border: 0;
  border-bottom: 1px solid rgba(226, 232, 240, 0.85);
  background: transparent;
}

.candidate-comparison-item.is-selected {
  background: transparent;
}

.candidate-comparison-name-line {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  min-width: 0;
}

.candidate-comparison-name {
  color: #1f2937;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.5;
  word-break: break-word;
}

.candidate-comparison-badge {
  display: inline-flex;
  align-items: center;
  min-height: auto;
  padding: 0;
  border-radius: 0;
  background: transparent;
  color: #9a3412;
  font-size: 11px;
  font-weight: 600;
}

.candidate-comparison-meta {
  color: #64748b;
  font-size: 12px;
  line-height: 1.5;
}

.candidate-comparison-note {
  color: #475569;
  font-size: 12px;
  line-height: 1.55;
}

.details-panel {
  border-top: 1px solid rgba(226, 232, 240, 0.75);
  padding-top: 8px;
}

.details-toggle,
.raw-details-toggle {
  padding: 0;
}

.details-summary-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 10px;
}

.details-summary-list.is-panel {
  margin-top: 12px;
}

.detail-summary-item {
  display: grid;
  grid-template-columns: 68px 1fr;
  gap: 8px;
  align-items: start;
}

.detail-summary-label {
  color: #78716c;
  font-size: 11px;
  font-weight: 600;
  line-height: 1.6;
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
  border: 1px solid rgba(251, 191, 36, 0.35);
  border-left: 3px solid rgba(245, 158, 11, 0.9);
  border-radius: 10px;
  background: rgba(255, 251, 235, 0.7);
  box-shadow: none;
}

.pending-command-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px 6px;
}

.pending-command-title {
  font-size: 12px;
  font-weight: 700;
  color: #92400e;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.pending-command-summary {
  margin-top: 3px;
  color: #4b5563;
  line-height: 1.5;
}

.pending-command-body {
  padding: 0 14px 10px;
}

.pending-command-reasoning {
  color: #6b7280;
  line-height: 1.55;
  font-size: 12px;
}

.pending-command-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 0 14px 12px;
}

.layout-draft-panel {
  display: flex;
  flex-direction: column;
  max-height: min(52vh, 560px);
}

.layout-draft-panel .pending-command-body {
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.layout-draft-segment-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid rgba(251, 146, 60, 0.12);
}

.layout-draft-segment-item {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 8px 0;
  border-bottom: 1px dashed rgba(226, 232, 240, 0.9);
}

.layout-draft-segment-item:last-child {
  border-bottom: 0;
}

.layout-draft-segment-main {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.layout-draft-segment-time {
  color: #9a3412;
  font-size: 12px;
  font-weight: 600;
  line-height: 1.5;
}

.layout-draft-segment-label {
  color: #334155;
  font-size: 13px;
  line-height: 1.5;
  word-break: break-word;
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
    padding: 8px 0;
  }

  .candidate-comparison-note {
    line-height: 1.6;
  }
}
</style>

