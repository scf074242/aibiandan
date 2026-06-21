<template>
  <div class="chat-panel">
    <div ref="messagesContainer" class="messages-container">
      <div
        v-for="(message, index) in visibleMessages"
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

          <div
            v-if="message.role !== 'user' && getAssistantProcessLines(message).length > 0"
            class="system-process-strip"
          >
            <span
              v-for="line in getAssistantProcessLines(message)"
              :key="line"
              class="system-process-line"
            >
              {{ line }}
            </span>
          </div>

          <div v-if="message.role === 'user'" class="message-text">{{ message.content }}</div>

          <button
            v-if="getPlaylistFileCard(message)"
            type="button"
            class="playlist-file-card"
            @click="openPlaylistFileCard(message)"
          >
            <span class="playlist-file-icon">
              <el-icon><Document /></el-icon>
            </span>
            <span class="playlist-file-main">
              <span class="playlist-file-title">{{ getPlaylistFileCard(message)?.title }}</span>
              <span class="playlist-file-meta">{{ getPlaylistFileCard(message)?.meta }}</span>
            </span>
            <span class="playlist-file-action">打开</span>
          </button>

          <div v-if="message.role !== 'user' && (message.expanded ?? false)" class="explanation-card">
            <div
              v-for="section in getExpandedSections(message)"
              :key="section.title"
              class="explanation-section"
              :class="{
                'is-layout-analysis-report': shouldRenderLayoutAnalysisReport(message, section),
                'is-secondary': section.tone === 'secondary',
                'is-risk': section.tone === 'risk',
              }"
            >
              <span v-if="!shouldRenderLayoutAnalysisReport(message, section)" class="explanation-title">{{ section.title }}</span>
              <div v-if="shouldRenderLayoutAnalysisReport(message, section)" class="explanation-content analysis-report-content">
                <div
                  v-for="(paragraph, paragraphIndex) in getLayoutAnalysisReportParagraphs(section.body)"
                  :key="`${section.title}-${paragraphIndex}`"
                  class="analysis-report-paragraph"
                >
                  <span
                    v-if="paragraph.label"
                    class="analysis-report-label"
                    :class="{ 'is-risk': paragraph.label === '风险' }"
                  >
                    {{ paragraph.label }}：
                  </span>
                  <span class="analysis-report-body">{{ paragraph.body }}</span>
                </div>
              </div>
              <div v-else class="explanation-content">{{ section.body }}</div>
            </div>

            <div
              v-if="getAgentAuditCards(message).length > 0"
              class="agent-audit-panel"
            >
              <div class="explanation-title">编排依据</div>
              <div class="agent-audit-list">
                <div
                  v-for="card in getAgentAuditCards(message)"
                  :key="card.title"
                  class="agent-audit-card"
                  :class="`is-${card.tone}`"
                >
                  <span class="agent-audit-title">{{ card.title }}</span>
                  <span class="agent-audit-body">{{ card.body }}</span>
                </div>
              </div>
            </div>

            <div
              v-if="getAgentSearchSummaryCards(message).length > 0"
              class="agent-search-panel"
            >
              <div class="explanation-title">查找记录</div>
              <div class="agent-search-list">
                <div
                  v-for="card in getAgentSearchSummaryCards(message)"
                  :key="card.title"
                  class="agent-search-card"
                  :class="`is-${card.tone}`"
                >
                  <div class="agent-search-title">{{ card.title }}</div>
                  <div class="agent-search-lines">
                    <span
                      v-for="line in card.lines"
                      :key="line"
                      class="agent-search-line"
                    >
                      {{ line }}
                    </span>
                  </div>
                </div>
              </div>
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
              v-if="getDetailsSummaryItems(message).length > 0 || getVisibleMessageDetails(message)"
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

                <div v-if="getVisibleMessageDetails(message)" class="raw-details-block">
                  <el-button link size="small" class="raw-details-toggle" @click="toggleRawDetails(message)">
                    {{ message.rawDetailsExpanded ? '收起原始明细' : '查看原始明细' }}
                  </el-button>
                  <pre v-if="message.rawDetailsExpanded" class="details-data">{{ formatDetails(getVisibleMessageDetails(message) ?? {}) }}</pre>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div v-if="messages.length === 0 && !loading" class="empty-state">
        <el-icon :size="48"><ChatDotRound /></el-icon>
      </div>
    </div>

    <div v-if="pendingCommand" class="pending-command-panel">
      <div class="pending-command-header">
        <div>
          <div class="pending-command-title">待确认修改</div>
          <div class="pending-command-summary">{{ pendingCommand.summary }}</div>
        </div>
        <el-tag type="danger" effect="light">高风险</el-tag>
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
        <el-button type="primary" size="small" :disabled="loading" @click="confirmPendingCommand">确认执行</el-button>
        <el-button size="small" :disabled="loading" @click="cancelPendingCommand">取消</el-button>
      </div>
    </div>

    <div v-if="showTargetSelectionAtomicPanel && pendingAtomicContext" class="pending-command-panel">
      <div class="pending-command-header">
        <div>
          <div class="pending-command-title">{{ getAtomicPhaseLabel(pendingAtomicPhase ?? 'selecting_target') }}</div>
          <div class="pending-command-summary">{{ formatPendingAtomicSummary(pendingAtomicContext) }}</div>
        </div>
        <el-tag type="info" effect="light">需选择</el-tag>
      </div>

      <div class="pending-command-body">
        <div class="pending-command-reasoning">{{ formatPendingAtomicReasoning(pendingAtomicContext) }}</div>
        <div v-if="getPendingAtomicContextDetailItems().length > 0" class="details-summary-list is-panel pending-agent-context-list">
          <div
            v-for="item in getPendingAtomicContextDetailItems()"
            :key="`${item.label}-${item.value}`"
            class="detail-summary-item"
          >
            <span class="detail-summary-label">{{ item.label }}</span>
            <span class="detail-summary-value">{{ item.value }}</span>
          </div>
        </div>
        <el-radio-group v-model="pendingAtomicTargetSelectedItemId" class="target-selection-list">
          <el-radio
            v-for="candidate in pendingAtomicTargetCandidates"
            :key="candidate.id"
            :value="candidate.id"
            class="target-selection-option"
          >
            {{ formatDisplayTimeRange(candidate.startTime, candidate.endTime) }} {{ candidate.programName || candidate.programCode || candidate.id }}
          </el-radio>
        </el-radio-group>
      </div>

      <div class="pending-command-actions">
        <el-button type="primary" size="small" :disabled="loading || !pendingAtomicTargetSelectedItemId" @click="confirmPendingTargetSelection">
          确认目标
        </el-button>
        <el-button size="small" :disabled="loading" @click="cancelPendingTargetSelection">取消</el-button>
      </div>
    </div>

    <div v-if="showInsertRecommendationAtomicPanel && pendingAtomicContext" class="pending-command-panel insert-recommendation-panel">
      <div class="pending-command-header">
        <div>
          <div class="pending-command-title">{{ getAtomicRecommendationTitle() }}</div>
          <div class="pending-command-summary">{{ formatPendingAtomicSummary(pendingAtomicContext) }}</div>
        </div>
        <el-tag type="info" effect="light">需选择</el-tag>
      </div>

      <div class="pending-command-body">
        <div class="pending-command-reasoning">{{ formatPendingAtomicReasoning(pendingAtomicContext) }}</div>
        <div v-if="getPendingAtomicContextDetailItems().length > 0" class="details-summary-list is-panel pending-agent-context-list">
          <div
            v-for="item in getPendingAtomicContextDetailItems()"
            :key="`${item.label}-${item.value}`"
            class="detail-summary-item"
          >
            <span class="detail-summary-label">{{ item.label }}</span>
            <span class="detail-summary-value">{{ item.value }}</span>
          </div>
        </div>
        <div class="target-selection-list insert-recommendation-list" role="radiogroup" :aria-label="getAtomicRecommendationAriaLabel()">
          <button
            v-for="(candidate, index) in pendingAtomicInsertRecommendations"
            :key="candidate.candidateId"
            type="button"
            class="insert-recommendation-option"
            :class="{ 'is-selected': pendingAtomicInsertSelectedCandidateId === candidate.candidateId }"
            role="radio"
            :aria-checked="pendingAtomicInsertSelectedCandidateId === candidate.candidateId"
            @click="pendingAtomicInsertSelectedCandidateId = candidate.candidateId"
          >
            <span class="insert-recommendation-selector" aria-hidden="true">
              <span class="insert-recommendation-selector-dot" />
            </span>
            <span class="insert-recommendation-card">
              <span class="insert-recommendation-head">
                <span class="insert-recommendation-name-line">
                  <span class="insert-recommendation-name">{{ candidate.programName }}</span>
                  <span class="insert-recommendation-chip">
                    {{ getInsertRecommendationBadgeLabel(index) }}
                  </span>
                </span>
                <span class="insert-recommendation-confidence">
                  {{ formatRecommendationStrengthLabel(index) }}
                </span>
              </span>
              <span class="insert-recommendation-meta">
                {{ formatInsertRecommendationMeta(candidate.duration, candidate.programType, candidate.confidence) }}
              </span>
              <span v-if="candidate.reasonTags.length" class="reason-tag-row insert-recommendation-tags">
                <span v-for="tag in candidate.reasonTags" :key="`${candidate.candidateId}-${tag}`" class="reason-tag">
                  {{ tag }}
                </span>
              </span>
            </span>
          </button>
          <div class="insert-recommendation-footer-note">
            我按节目线索和当前播单排好了候选。你选一个后我再写入；不选就不会改动播单。
          </div>
        </div>
      </div>

      <div class="pending-command-actions insert-recommendation-actions">
        <div class="insert-recommendation-action-hint">
          {{ getAtomicRecommendationActionHint() }}
        </div>
        <div class="insert-recommendation-action-buttons">
          <el-button type="primary" size="small" :disabled="loading || !pendingAtomicInsertSelectedCandidateId" @click="confirmPendingInsertRecommendation">
            {{ getAtomicRecommendationConfirmLabel() }}
          </el-button>
          <el-button size="small" :disabled="loading" @click="cancelPendingInsertRecommendation">取消</el-button>
        </div>
      </div>
    </div>

    <div v-if="showAgentPendingConfirmationPanel && pendingAtomicContext" class="pending-command-panel agent-confirmation-panel">
      <div class="pending-command-header">
        <div>
          <div class="pending-command-title">待确认执行</div>
          <div class="pending-command-summary">{{ formatPendingAtomicSummary(pendingAtomicContext) }}</div>
        </div>
        <el-tag type="primary" effect="light">需确认</el-tag>
      </div>

      <div class="pending-command-body">
        <div class="pending-command-guidance">
          {{ formatPendingAtomicConfirmationNote(pendingAtomicContext) }}
        </div>
      </div>

      <div class="pending-command-actions">
        <el-button type="primary" size="small" :disabled="loading" @click="confirmPendingAgentTask">
          {{ formatPendingConfirmationPrimaryAction(pendingAtomicContext) }}
        </el-button>
        <el-button size="small" :disabled="loading" @click="rejectPendingAgentTask">取消</el-button>
      </div>
    </div>

    <div class="quick-actions">
      <el-button
        v-for="action in visibleQuickActions"
        :key="action.label"
        size="small"
        :disabled="loading"
        @click="applyQuickAction(action.prompt)"
      >
        {{ action.label }}
      </el-button>
    </div>

    <div class="input-area">
      <input
        ref="layoutFileInput"
        type="file"
        accept=".xls,.xlsx"
        class="layout-file-input"
        @change="handleLayoutFileChange"
      >
      <div class="input-shell" :class="{ 'is-busy': loading || isForegroundOrchestrationRunning }">
        <el-input
          v-model="inputMessage"
          class="message-input"
          type="textarea"
          :rows="2"
          placeholder="例如：在9点插入节目看东方，或把9点的节目向后移动1小时"
          @keydown.enter.prevent="handlePrimaryAction"
        />
        <div class="input-control-row">
          <button
            type="button"
            class="input-icon-button"
            :class="{ 'is-loading': uploadingLayout }"
            :disabled="uploadingLayout || isForegroundOrchestrationRunning"
            title="上传版面草案"
            @click="openLayoutUpload"
          >
            <el-icon><Paperclip /></el-icon>
          </button>
          <button
            type="button"
            class="send-action-button"
            :class="{ 'is-stop': isForegroundOrchestrationRunning }"
            :disabled="isForegroundOrchestrationRunning ? !props.canInterrupt : !inputMessage.trim() || loading"
            :title="isForegroundOrchestrationRunning ? '中止编排' : '发送'"
            @click="handlePrimaryAction"
          >
            <span v-if="isForegroundOrchestrationRunning" class="stop-square" />
            <el-icon v-else><Top /></el-icon>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { ChatDotRound, Document, Paperclip, Top } from '@element-plus/icons-vue'
import type { ChatMessage } from '@/types/llm'
import type {
  DraftFeasibilityReport,
  ExplanationResult,
  LayoutDraft,
  OrchestrationCommand,
  PlaylistType,
  PlanningLogEntry,
  PlanningSession,
  RotationPlaylistStrategy,
  ScheduleState,
  TaskMode,
  ValidationReport,
} from '@/types/orchestration'
import {
  buildPendingAtomicContextFromClarification,
  buildPendingAtomicContextFromInsertRecommendation,
  buildPendingAtomicContextFromTargetSelection,
  rehydratePendingInsertRecommendationFromAtomicContext,
  rehydratePendingTargetSelectionFromAtomicContext,
  type RuntimePendingAtomicContext,
} from '@/services/runtime/pendingAtomicContext'
import { buildPendingLlmContext } from '@/services/agent/agentSession'
import { getCommandExecutor } from '@/services/commandExecutor'
import { getScheduleCommandBus } from '@/services/scheduleCommandBus'
import { getLayoutImportService } from '@/services/layoutImportService'
import { getCandidateService } from '@/services/candidateService'
import { getAtomicCapabilities } from '@/services/atomicCapabilities'
import {
  getSchedulingAgentRuntimeFacade,
  summarizeRuntimeCommand,
  type RuntimeDecision,
  type RuntimeAnalysisContext,
  type RuntimeExecutedResult,
  type RuntimeFeedback,
  type RuntimeOrchestrationRequest,
  type RuntimePendingCommand,
  type RuntimeScheduleItem,
} from '@/services/runtime/schedulingAgentRuntimeFacade'
import {
  buildForegroundAgentContextPackage,
  resolvePendingReviewLifecycle,
} from '@/services/runtime/foregroundAgentContextPackage'
import type { ReactTaskRun } from '@/services/runtime/reactTaskTypes'
import { resolveForegroundLayoutDraft } from '@/services/runtime/foregroundLayoutDraft'
import {
  buildWorkspaceScopedRuntimeHistory,
  buildForegroundWorkspaceIdentity,
  resolveForegroundWorkspaceKey,
  resolveForegroundWorkspaceTransition,
} from '@/services/runtime/foregroundWorkspaceState'
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
  formatCandidateQueryDiagnosticText,
  isNoCandidateCase as isNoCandidateDetailsCase,
  isLayoutAnalysisDetails,
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
  hiddenFromThread?: boolean
  workspaceKey?: string | null
}

type SchedulePreviewItem = RuntimeScheduleItem

interface AgentAuditCard {
  title: string
  body: string
  tone: 'basis' | 'warning' | 'blocker'
}

interface AgentSearchSummaryCard {
  title: string
  lines: string[]
  tone: 'normal' | 'limited'
}

interface PlaylistFileCard {
  playlistId?: string
  playlistType: Exclude<PlaylistType, 'none'>
  title: string
  meta: string
}

interface PendingQuickReply {
  label: string
  prompt: string
}

interface RecoverableRuntimeFailure {
  originalUserInput: string
  workspaceKey: string | null
  createdAt: number
}

interface QuickAction {
  label: string
  prompt: string
  playlistTypes?: PlaylistType[]
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
  playlistType?: PlaylistType
  playlistId?: string | null
  rotationStrategy?: RotationPlaylistStrategy
  rotationDurationSeconds?: number | null
  currentLayoutDraft?: LayoutDraft | null
  workspaceClosedNotice?: string
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
  playlistStateChanged: [payload: { playlistId?: string; playlistType: PlaylistType; rotationStrategy?: RotationPlaylistStrategy; rotationDurationSeconds?: number; channelId?: string; channelName?: string; date?: string }]
  playlistFileOpenRequested: [payload: { playlistId?: string; playlistType: Exclude<PlaylistType, 'none'> }]
  seedTvSequenceContextRequested: []
}>()

const messages = ref<Message[]>([])
const inputMessage = ref('')
const pendingRuntimeInputSource = ref<'user' | 'quick_action'>('user')
const loading = ref(false)
const messagesContainer = ref<HTMLElement>()
const layoutFileInput = ref<HTMLInputElement>()
const pendingCommand = ref<RuntimePendingCommand | null>(null)
const pendingAtomicContext = ref<RuntimePendingAtomicContext | null>(null)
const analysisContext = ref<RuntimeAnalysisContext | null>(null)
const pendingReviewWorkspaceKey = ref<string | null>(null)
const pendingReviewInterruptedNotice = ref<string | null>(null)
const recoverableRuntimeFailure = ref<RecoverableRuntimeFailure | null>(null)
const activeReactTaskRun = ref<ReactTaskRun | null>(null)
const activeReactTaskWorkspaceKey = ref<string | null>(null)
const pendingLayoutDraft = ref<LayoutDraft | null>(null)
const layoutDraftFeasibility = ref<DraftFeasibilityReport | null>(null)
const pendingLayoutDraftMode = ref<Extract<TaskMode, 'full_generate' | 'partial_generate'> | null>(null)
const preferLayoutDraftContinuation = ref(false)
const preserveIncomingLayoutDraftOnWorkspaceChange = ref(false)
const activePlaylistType = ref<PlaylistType>(props.playlistType ?? 'none')
const activeRotationStrategy = ref<RotationPlaylistStrategy>(props.rotationStrategy ?? 'content_match')
const activeRotationDurationSeconds = ref<number | null>(props.rotationDurationSeconds ?? null)
const foregroundLayoutDraftRuntimeEnabled = true
const foregroundLayoutDraftEnabled = false
const terminalOrchestrationStatuses = new Set(['completed', 'manual_review', 'failed', 'cancelled'])
const isTerminalOrchestrationStatus = (status?: string) => Boolean(status && terminalOrchestrationStatuses.has(status))
const isForegroundOrchestrationRunning = computed(() => (
  Boolean(props.isOrchestrating)
  && !isTerminalOrchestrationStatus(props.orchestrationSession?.status)
))
const commandExecutor = getCommandExecutor()
const candidateService = getCandidateService()
const scheduleCommandBus = getScheduleCommandBus()
const runtimeFacade = getSchedulingAgentRuntimeFacade()
const layoutImportService = getLayoutImportService()
const displayedLogIds = ref<string[]>([])
const lastSummarySessionId = ref('')
const uploadingLayout = ref(false)
const activeImportedLayoutName = ref('')
const queuedCommands = ref<string[]>([])
const interruptedCommandAfterCancel = ref<string | null>(null)
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

watch(() => props.playlistType, (value, oldValue) => {
  const nextPlaylistType = value ?? 'none'
  const previousPlaylistType = oldValue ?? activePlaylistType.value
  const transition = resolveForegroundWorkspaceTransition(
    buildForegroundWorkspaceIdentity({
      playlistId: props.playlistId,
      playlistType: previousPlaylistType,
      channelId: props.channelId,
      channelName: props.channelName,
      date: props.date,
      rotationStrategy: activeRotationStrategy.value,
      rotationDurationSeconds: activeRotationDurationSeconds.value,
    }),
    buildForegroundWorkspaceIdentity({
      playlistId: props.playlistId,
      playlistType: nextPlaylistType,
      channelId: props.channelId,
      channelName: props.channelName,
      date: props.date,
      rotationStrategy: activeRotationStrategy.value,
      rotationDurationSeconds: activeRotationDurationSeconds.value,
    }),
  )
  activePlaylistType.value = nextPlaylistType
  if (transition.changed) {
    clearPendingRuntimeTaskState({
      clearLayoutDraft: transition.clearLayoutDraft && !preserveIncomingLayoutDraftOnWorkspaceChange.value,
    })
    return
  }
  if (activePlaylistType.value === 'rotation' && !preserveIncomingLayoutDraftOnWorkspaceChange.value) {
    clearPendingLayoutDraftState()
  }
})

watch(() => props.playlistId, (value, oldValue) => {
  const transition = resolveForegroundWorkspaceTransition(
    oldValue === undefined
      ? null
      : buildForegroundWorkspaceIdentity({
        playlistId: oldValue,
        playlistType: activePlaylistType.value,
        channelId: props.channelId,
        channelName: props.channelName,
        date: props.date,
        rotationStrategy: activeRotationStrategy.value,
        rotationDurationSeconds: activeRotationDurationSeconds.value,
      }),
    buildForegroundWorkspaceIdentity({
      playlistId: value,
      playlistType: activePlaylistType.value,
      channelId: props.channelId,
      channelName: props.channelName,
      date: props.date,
      rotationStrategy: activeRotationStrategy.value,
      rotationDurationSeconds: activeRotationDurationSeconds.value,
    }),
  )
  if (transition.changed) {
    clearPendingRuntimeTaskState({
      clearLayoutDraft: transition.clearLayoutDraft && !preserveIncomingLayoutDraftOnWorkspaceChange.value,
    })
  }
})

watch(() => props.rotationStrategy, (value) => {
  activeRotationStrategy.value = value ?? 'content_match'
})

watch(() => props.rotationDurationSeconds, (value) => {
  activeRotationDurationSeconds.value = typeof value === 'number' && value > 0 ? value : null
})

watch(() => props.workspaceClosedNotice, (value, oldValue) => {
  if (!value || value === oldValue) return
  clearPendingRuntimeTaskState({ clearLayoutDraft: true })
  pushAssistantMessage(buildAssistantMessage({
    content: value,
    processType: 'planning',
    processTypeLabel: '工作区',
  }))
})

const SEED_TV_SEQUENCE_CONTEXT_PROMPT = '__seed_tv_sequence_context__'

const quickActions: QuickAction[] = [
  { label: '新建电视播单', prompt: '新建电视播单' },
  { label: '新建轮播单', prompt: '新建轮播单' },
  { label: '内容匹配优先', prompt: '按内容匹配优先' },
  { label: '收视率优先', prompt: '按收视率优先' },
  { label: '热播优先', prompt: '按热播优先' },
  { label: '连续剧检查', prompt: SEED_TV_SEQUENCE_CONTEXT_PROMPT, playlistTypes: ['tv'] },
  { label: '顺播倒序', prompt: '08:00 插入纵有疾风起第2集', playlistTypes: ['tv'] },
  { label: '全天编排', prompt: '帮我全天编排', playlistTypes: ['tv'] },
  { label: '补齐空窗', prompt: '补齐当前所有空窗' },
  { label: '插入节目', prompt: '在9点插入节目看东方' },
  { label: '插入短片', prompt: '0点插入城市形象春日花路短片', playlistTypes: ['rotation'] },
  { label: '替换节目', prompt: '把9点的节目替换成东方新闻' },
  { label: '删除节目', prompt: '删除9点的节目' },
  { label: '后移节目', prompt: '把9点的节目向后移动1小时' },
  { label: '前移节目', prompt: '把10点的节目向前移动1小时' },
  { label: '查询节目', prompt: '9点是什么节目' },
  { label: '执行校验', prompt: '请校验当前节目单' },
]

const visibleQuickActions = computed(() =>
  quickActions.filter((action) => !action.playlistTypes?.length || action.playlistTypes.includes(activePlaylistType.value)),
)

const isForegroundDraftPayloadKey = (key: string): boolean => {
  const normalizedKey = key.toLowerCase()
  return normalizedKey === 'layoutdraft'
    || normalizedKey.includes('layout_draft')
    || normalizedKey === 'currentlayoutdraft'
    || normalizedKey === 'layoutdraftfeasibility'
    || normalizedKey === 'feasibilityreport'
    || normalizedKey === 'draftid'
    || normalizedKey === 'layoutsource'
}

const containsForegroundDraftPayload = (value: unknown): boolean => {
  if (typeof value === 'string') {
    return value.includes('版面草案')
      || value.includes('编排参考')
      || value.includes('layout_draft')
  }

  if (Array.isArray(value)) {
    return value.some((item) => containsForegroundDraftPayload(item))
  }

  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).some(([key, nestedValue]) => {
      if (
        isForegroundDraftPayloadKey(key)
        && nestedValue !== null
        && nestedValue !== undefined
        && nestedValue !== false
      ) {
        return true
      }
      return containsForegroundDraftPayload(nestedValue)
    })
  }

  return false
}

const isForegroundLongFlowDetails = (details?: DetailMap): boolean =>
  isLayoutImportDetails(details)
  || isLayoutAnalysisDetails(details)
  || isOrchestrationOverviewDetails(details)
  || containsForegroundDraftPayload(details)

const isLayoutDraftBlockingText = (
  value?: string,
  processTypeLabel?: string,
): boolean => {
  const text = `${processTypeLabel ?? ''}\n${value ?? ''}`
  return text.includes('当前版面草案还有')
    || text.includes('还没有可用草案')
    || text.includes('没有草案')
    || text.includes('草案只写了一部分')
    || text.includes('还只覆盖了一部分')
    || text.includes('不能直接整体编排')
    || text.includes('不能直接排一整天')
    || text.includes('不会进入正式编排')
    || text.includes('请调整不可编排')
    || text.includes('先补草案')
    || text.includes('还要补草案')
}

const isForegroundAgentMainReplyText = (value?: string): boolean => {
  if (!value) return false
  return /确认前不会写入|不会写入正式|还需要继续补充|我先建一张|我先把|整理了一份|整理成\s*\d+\s*个内容块/u.test(value)
}

const isVisibleLayoutDraftBlockingFeedback = (message: Message): boolean => (
  !foregroundLayoutDraftEnabled
  && isLayoutDraftBlockingText(message.content, message.processTypeLabel)
)

const isForegroundLayoutDraftMessage = (message: Message): boolean => {
  if (message.role === 'user') return false
  if (isVisibleLayoutDraftBlockingFeedback(message)) return false
  if (message.processTypeLabel === '版面更新' || message.processTypeLabel === '版面草案') return false
  if (message.processTypeLabel === '编单分析' || message.processTypeLabel === '优化建议') return false
  if (isForegroundAgentMainReplyText(message.content)) return false
  if (/^已切换到.+频道版面/.test(message.content) || /^已切换到当前频道默认版面/.test(message.content)) return false
  const details = getMessageDetails(message)
  if (details?.readOnly === true) return false
  return message.content.includes('版面草案')
    || message.processTypeLabel?.includes('版面草案') === true
    || containsForegroundDraftPayload(message.explanation?.explanation)
    || isForegroundLongFlowDetails(details)
}

const visibleMessages = computed(() =>
  messages.value.filter((message) => !message.hiddenFromThread && !isForegroundLayoutDraftMessage(message)),
)

const buildVisibleRuntimeHistory = (currentUserInput: string): string[] => {
  const currentWorkspaceKey = resolveCurrentPendingWorkspaceKey()
  return buildWorkspaceScopedRuntimeHistory(visibleMessages.value, {
    currentWorkspaceKey,
    currentUserInput,
  })
}

const applyQuickAction = (prompt: string) => {
  if (prompt === SEED_TV_SEQUENCE_CONTEXT_PROMPT) {
    emit('seedTvSequenceContextRequested')
    pushAssistantMessage(buildAssistantMessage({
      content: '已在左侧载入连续剧检查示例：09:00 为《品质剧场：纵有疾风起 第1集》，10:30 为第3集。后续插入或替换同系列节目时，我会帮你拦住跳集、倒序和时间占用风险。',
      processType: 'general',
      processTypeLabel: '连续剧检查',
    }), {
      autoFocus: false,
    })
    return
  }
  pendingRuntimeInputSource.value = 'quick_action'
  inputMessage.value = prompt
  void sendMessage()
}

const continuePendingAtomicClarification = (prompt: string) => {
  if (!pendingAtomicContext.value) return
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

const getLayoutDraftStrategyText = (draft: LayoutDraft) => {
  const profile = draft.strategyProfile
  if (!profile) return ''
  if (profile.selectionSummary) {
    return profile.selectionSummary
  }
  if (profile.kind === 'tv_channel') {
    return `参考 ${profile.referenceDate ?? '上一播出日'}，顺播栏目按上一集继续。`
  }
  return profile.selectionPriority === 'rating'
    ? '轮播候选先满足硬关键词，再按收视表现优先。'
    : '轮播候选按内容、标题和栏目关键词优先。'
}

const getLayoutDraftStrategyFacts = (draft: LayoutDraft): string[] => {
  const profile = draft.strategyProfile
  if (!profile) return []

  const facts: string[] = []
  if (profile.kind === 'tv_channel') {
    facts.push(`读取 ${profile.referenceDate ?? '上一播出日'} 编排记录`)
    facts.push('顺播集数优先')
  } else {
    facts.push('轮播单独立选片')
    facts.push(profile.selectionPriority === 'rating' ? '收视率优先' : '内容匹配优先')
  }

  facts.push(profile.keywordPolicy === 'hard_match' ? '明确关键词硬约束' : '栏目类型软匹配')
  if (profile.constraintSummary) {
    facts.push(profile.constraintSummary)
  }
  if (profile.selectionRules?.length) {
    facts.push(...profile.selectionRules.slice(0, 3))
  }

  return facts
}

const getLayoutDraftSegmentItems = (draft: LayoutDraft) =>
  draft.layoutReference.slots.map((slot, index) => {
    const column = draft.columns[index]
    return {
      segmentId: slot.id,
      label: column?.semanticLabel ?? column?.columnName ?? `时段 ${index + 1}`,
      startTime: normalizeClockText(slot.startTime),
      endTime: normalizeClockText(slot.endTime),
      status: 'ready',
      reason: '',
    }
  })

const getLayoutDraftSegmentStatusText = (status: string) => {
  return status === 'ready' ? '待编排核验' : ''
}

const clearPendingLayoutDraftState = () => {
  pendingLayoutDraft.value = null
  layoutDraftFeasibility.value = null
  pendingLayoutDraftMode.value = null
  preferLayoutDraftContinuation.value = false
  emit('layoutDraftUpdated', {
    draft: null,
    feasibilityReport: null,
  })
}

const clearPendingRuntimeTaskState = (options: { clearLayoutDraft?: boolean } = {}) => {
  pendingCommand.value = null
  pendingAtomicContext.value = null
  analysisContext.value = null
  pendingReviewWorkspaceKey.value = null
  pendingReviewInterruptedNotice.value = null
  preferLayoutDraftContinuation.value = false
  if (options.clearLayoutDraft) {
    clearPendingLayoutDraftState()
  }
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
  if (activePlaylistType.value === 'none') {
    ElMessage.info('请先新建播单，再上传版面草案。')
    return
  }
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
    const uploadedDraft = resolveForegroundLayoutDraft({
      channelId: props.channelId,
      channelName: props.channelName,
      date: props.date,
      playlistType: activePlaylistType.value,
      userIntent: `上传版面草案：${imported.sourceFileName}`,
    })
    emit('layoutDraftUpdated', {
      draft: uploadedDraft,
      feasibilityReport: null,
    })
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
  recordBrowserRuntimeTrace('primary_action:click', {
    input: inputMessage.value.trim(),
    isForegroundOrchestrationRunning: isForegroundOrchestrationRunning.value,
    canInterrupt: props.canInterrupt,
    loading: loading.value,
  })
  if (isForegroundOrchestrationRunning.value) {
    if (props.canInterrupt) {
      const content = inputMessage.value.trim()
      if (content) {
        interruptedCommandAfterCancel.value = content
        messages.value.push(buildUserMessage(content))
        inputMessage.value = ''
        await scrollToBottom()
      }
      emit('cancelRequested')
    }
    return
  }

  await sendMessage()
}

const buildCurrentRuntimeScheduleState = (): ScheduleState => ({
  playlistId: props.playlistId ?? undefined,
  channelId: props.channelId,
  channelName: props.channelName,
  date: props.date,
  isEmpty: props.currentSchedule.length === 0,
  itemCount: props.currentSchedule.length,
  gapCount: props.gapCount ?? 0,
  hasSelectedTimeRange: false,
  playlistType: activePlaylistType.value,
  rotationStrategy: activePlaylistType.value === 'rotation' ? activeRotationStrategy.value : undefined,
  rotationDurationSeconds: activePlaylistType.value === 'rotation' ? activeRotationDurationSeconds.value ?? undefined : undefined,
})

const resolveCurrentPendingWorkspaceKey = () => resolveForegroundWorkspaceKey(buildForegroundWorkspaceIdentity({
  playlistId: props.playlistId,
  playlistType: activePlaylistType.value,
  channelId: props.channelId,
  channelName: props.channelName,
  date: props.date,
  rotationStrategy: activeRotationStrategy.value,
  rotationDurationSeconds: activeRotationDurationSeconds.value,
}))

const resolveCurrentMessageWorkspaceKey = (): string | null => resolveCurrentPendingWorkspaceKey()

const isRuntimeReactTaskRun = (value: unknown): value is ReactTaskRun => {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return typeof record.id === 'string'
    && typeof record.objective === 'string'
    && typeof record.status === 'string'
    && typeof record.loopCount === 'number'
    && Array.isArray(record.steps)
    && Array.isArray(record.observations)
}

const syncActiveReactTaskFromFeedback = (feedback?: RuntimeFeedback) => {
  const details = feedback?.details as Record<string, unknown> | undefined
  const taskRun = details?.reactTaskRun
  if (!isRuntimeReactTaskRun(taskRun)) return
  activeReactTaskRun.value = taskRun
  activeReactTaskWorkspaceKey.value = resolveCurrentPendingWorkspaceKey()
}

const resolveActiveReactTaskForCurrentWorkspace = (): ReactTaskRun | null => {
  if (!activeReactTaskRun.value) return null
  if (activeReactTaskWorkspaceKey.value !== resolveCurrentPendingWorkspaceKey()) {
    activeReactTaskRun.value = null
    activeReactTaskWorkspaceKey.value = null
    return null
  }
  return activeReactTaskRun.value
}

const buildUserMessage = (content: string): Message => ({
  role: 'user',
  content,
  workspaceKey: resolveCurrentMessageWorkspaceKey(),
})

const bindPendingReviewToCurrentWorkspace = () => {
  pendingReviewWorkspaceKey.value = resolveCurrentPendingWorkspaceKey()
}

const isPendingReviewWorkspaceCurrent = () => (
  !pendingReviewWorkspaceKey.value
  || pendingReviewWorkspaceKey.value === resolveCurrentPendingWorkspaceKey()
)

const expirePendingReviewForWorkspaceChange = (message: string) => {
  pendingCommand.value = null
  pendingAtomicContext.value = null
  pendingReviewWorkspaceKey.value = null
  ElMessage.warning(message)
}

const isPendingReviewConfirmText = (content: string): boolean =>
  /^(确认|确定|执行|可以|好的|好|ok|yes)$/iu.test(content.replace(/\s+/g, ''))
  || /^(确认重新编排|确认重排|重新编排|重排|确认覆盖|覆盖吧|开始重新编排|开始重排|开始编排|按这个重新编排|按草案重新编排|按当前草案重新编排|按这个开始编排|可以重新编排|可以重排)$/iu.test(content.replace(/\s+/g, ''))
  || /^(更新|更新草案|更新到草案|写入草案|改到草案|改进草案|就按这个|就这个|用这个|用这个方向|按这个方向|没问题)$/iu.test(content.replace(/\s+/g, ''))

const isPendingReviewCancelText = (content: string): boolean =>
  /^(取消|不用了|算了|先不用|no|cancel)$/iu.test(content.replace(/\s+/g, ''))

const isPendingReviewSelectionText = (content: string): boolean =>
  /^(第?[一二三四五六七八九十\d]+个?|选[一二三四五六七八九十\d]+|用[一二三四五六七八九十\d]+)$/u.test(content.replace(/\s+/g, ''))

const isPendingReviewAnswerText = (content: string): boolean => (
  isPendingReviewConfirmText(content)
  || isPendingReviewCancelText(content)
  || isPendingReviewSelectionText(content)
)

const resolvePendingReviewExpiredNotice = (reason?: 'workspace_changed' | 'next_non_answer') => (
  reason === 'workspace_changed'
    ? '上一条待确认操作不属于当前工作区，已自动失效。'
    : '上一条待确认操作已失效，本轮按新的指令重新判断。'
)

const isRecoverableRuntimeRetryText = (content: string): boolean =>
  /^(重试|再试一次|继续|重新试|再来一次|retry|continue)$/iu.test(content.replace(/\s+/g, ''))

const isPendingCompositeTaskContinueText = (content: string): boolean =>
  Boolean(
    pendingAtomicContext.value?.compositeTaskRun
    && /^(继续|继续执行|继续处理|下一批|重试|再试一次|retry|continue)$/iu.test(content.replace(/\s+/g, '')),
  )

const resolveRecoverableRuntimeRetryInput = (content: string): string | null | undefined => {
  if (!isRecoverableRuntimeRetryText(content)) return undefined
  if (isPendingCompositeTaskContinueText(content)) return undefined
  if (resolveActiveReactTaskForCurrentWorkspace()) return undefined
  const failure = recoverableRuntimeFailure.value
  if (!failure) return null
  if (failure.workspaceKey !== resolveCurrentPendingWorkspaceKey()) {
    recoverableRuntimeFailure.value = null
    return null
  }
  return failure.originalUserInput
}

const getRuntimeDecisionFeedback = (decision: RuntimeDecision): RuntimeFeedback | null => (
  'feedback' in decision ? decision.feedback : null
)

const extractRecoverableRuntimeFailure = (
  feedback: RuntimeFeedback | null,
  fallbackUserInput: string,
  workspaceKey: string | null,
): RecoverableRuntimeFailure | null => {
  const details = (feedback?.details ?? undefined) as DetailMap | undefined
  if (!details?.llmFailure || details.canRetry !== true) return null
  const recoverableUserInput = typeof details.recoverableUserInput === 'string'
    ? details.recoverableUserInput.trim()
    : ''
  return {
    originalUserInput: recoverableUserInput || fallbackUserInput,
    workspaceKey,
    createdAt: Date.now(),
  }
}

const pushPendingReviewExpiredMessage = (reason?: 'workspace_changed' | 'next_non_answer') => {
  pushAssistantMessage(buildAssistantMessage({
    content: resolvePendingReviewExpiredNotice(reason),
    processType: 'general',
    processTypeLabel: '待确认已失效',
  }))
}

const interruptPendingReviewForNewInput = (content: string): boolean => {
  if (!pendingCommand.value && !pendingAtomicContext.value) return false
  if (isPendingReviewAnswerText(content)) return false
  if (isPendingCompositeTaskContinueText(content)) return false
  pendingCommand.value = null
  pendingAtomicContext.value = null
  pendingReviewWorkspaceKey.value = null
  pendingReviewInterruptedNotice.value = resolvePendingReviewExpiredNotice('next_non_answer')
  return true
}

const applyPlaylistStateFromDetails = (details?: DetailMap) => {
  const playlistState = details?.playlistState as {
    playlistId?: string
    playlistType?: PlaylistType
    rotationStrategy?: RotationPlaylistStrategy
    rotationDurationSeconds?: number
    channelId?: string
    channelName?: string
    date?: string
  } | undefined
  if (!playlistState?.playlistType) return
  const playlistContextTransition = resolveForegroundWorkspaceTransition(
    buildForegroundWorkspaceIdentity({
      playlistId: props.playlistId,
      playlistType: activePlaylistType.value,
      channelId: props.channelId,
      channelName: props.channelName,
      date: props.date,
      rotationStrategy: activeRotationStrategy.value,
      rotationDurationSeconds: activeRotationDurationSeconds.value,
    }),
    buildForegroundWorkspaceIdentity({
      playlistId: playlistState.playlistId ?? props.playlistId,
      playlistType: playlistState.playlistType,
      channelId: playlistState.channelId ?? props.channelId,
      channelName: playlistState.channelName ?? props.channelName,
      date: playlistState.date ?? props.date,
      rotationStrategy: playlistState.rotationStrategy,
      rotationDurationSeconds: playlistState.rotationDurationSeconds,
    }),
  )
  if (playlistContextTransition.changed) {
    clearPendingRuntimeTaskState({ clearLayoutDraft: playlistContextTransition.clearLayoutDraft })
  }
  activePlaylistType.value = playlistState.playlistType
  activeRotationStrategy.value = playlistState.rotationStrategy ?? 'content_match'
  activeRotationDurationSeconds.value = activePlaylistType.value === 'rotation' && typeof playlistState.rotationDurationSeconds === 'number'
    ? playlistState.rotationDurationSeconds
    : null
  if (activePlaylistType.value === 'rotation') {
    clearPendingLayoutDraftState()
  }
  emit('playlistStateChanged', {
    playlistId: playlistState.playlistId,
    playlistType: activePlaylistType.value,
    rotationStrategy: activePlaylistType.value === 'rotation' ? activeRotationStrategy.value : undefined,
    rotationDurationSeconds: activePlaylistType.value === 'rotation' ? activeRotationDurationSeconds.value ?? undefined : undefined,
    channelId: activePlaylistType.value === 'tv' ? playlistState.channelId : undefined,
    channelName: activePlaylistType.value === 'tv' ? playlistState.channelName : undefined,
    date: activePlaylistType.value === 'tv' ? playlistState.date : undefined,
  })
}

const appendRuntimeFeedback = (feedback: RuntimeFeedback) => {
  const feedbackProcessType = feedback.processType as ProcessType
  const details = (feedback.details ?? undefined) as DetailMap | undefined
  applyPlaylistStateFromDetails(details)
  pushAssistantMessage(buildAssistantMessage({
    content: formatAssistantDisplayContent(feedback.content),
    thinking: feedback.thinking,
    explanation: feedback.explanation || details
      ? {
          type: 'command',
          targetId: `runtime-${Date.now()}`,
          explanation: feedback.explanation ?? '',
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
    expanded: isLayoutAnalysisDetails(details) ? true : undefined,
  }))
}

const rememberLayoutDraftContinuationIfNeeded = (feedback: RuntimeFeedback) => {
  const details = (feedback.details ?? undefined) as DetailMap | undefined
  const draftCompleteness = details?.draftCompleteness as { status?: string } | undefined
  const blockedMode = details?.blockedMode
  if (feedback.processTypeLabel !== '还要补草案' || draftCompleteness?.status !== 'partial') return

  preferLayoutDraftContinuation.value = true
  if (blockedMode === 'full_generate' || blockedMode === 'partial_generate') {
    pendingLayoutDraftMode.value = blockedMode
  }
  if (!pendingLayoutDraft.value && props.currentLayoutDraft) {
    pendingLayoutDraft.value = props.currentLayoutDraft
  }
}

const clearLayoutDraftContinuationPreference = () => {
  preferLayoutDraftContinuation.value = false
}

const withRuntimeFeedbackNotice = (
  feedback: RuntimeFeedback,
  notice?: string | null,
): RuntimeFeedback => {
  if (!notice) return feedback
  return {
    ...feedback,
    content: `${notice}\n${feedback.content}`,
  }
}

const appendLayoutDraftWorkspaceFeedback = (feedback: RuntimeFeedback, fallbackContent: string) => {
  const noticeMatch = feedback.content.match(/^(上一条待确认操作[^\n]+)\n/u)
  const leadingNotice = noticeMatch?.[1]
  const visibleContent = /切换|上传版面|默认版面|频道版面/.test(feedback.content)
    ? feedback.content
    : fallbackContent
  pushAssistantMessage(buildAssistantMessage({
    content: leadingNotice && !visibleContent.includes(leadingNotice)
      ? `${leadingNotice}\n${visibleContent}`
      : visibleContent,
    thinking: feedback.thinking,
    processType: feedback.processType as ProcessType,
    processTypeLabel: '版面更新',
  }))
}

const isRuntimeScheduleItemList = (value: unknown): value is RuntimeScheduleItem[] => (
  Array.isArray(value)
  && value.every((item) => (
    item
    && typeof item === 'object'
    && typeof (item as RuntimeScheduleItem).id === 'string'
    && typeof (item as RuntimeScheduleItem).startTime === 'string'
    && typeof (item as RuntimeScheduleItem).endTime === 'string'
  ))
)

const resolveScheduleItemsFromExecutionData = (data: unknown): RuntimeScheduleItem[] | null => {
  if (isRuntimeScheduleItemList(data)) return data
  if (data && typeof data === 'object') {
    const record = data as Record<string, unknown>
    if (isRuntimeScheduleItemList(record.scheduleItems)) return record.scheduleItems
    if (isRuntimeScheduleItemList(record.items)) return record.items
  }
  return null
}

const emitLatestRuntimeSchedule = (executionData?: unknown) => {
  const resultItems = resolveScheduleItemsFromExecutionData(executionData)
  if (resultItems) {
    emit('scheduleUpdated', resultItems)
    return
  }

  const atomicItems = getAtomicCapabilities().getAllItems()
  if (atomicItems.length > 0 || props.currentSchedule.length > 0) {
    emit('scheduleUpdated', atomicItems)
    return
  }

  emit('scheduleUpdated', commandExecutor.getScheduleItems())
}

const applyRuntimeDecision = async (
  decision: RuntimeDecision,
  leadingNotice?: string | null,
) => {
  switch (decision.kind) {
    case 'agent_execution': {
      appendRuntimeFeedback(withRuntimeFeedbackNotice(decision.feedback, leadingNotice))
      pendingAtomicContext.value = decision.pendingAtomicContext ?? null
      pendingCommand.value = null
      if (pendingAtomicContext.value) {
        bindPendingReviewToCurrentWorkspace()
      } else {
        pendingReviewWorkspaceKey.value = null
      }
      const executionResult = decision.result.executionResult
      emit('commandExecuted', {
        success: decision.result.status === 'executed',
        message: decision.result.explanation,
        commandAction: decision.result.decision.intent,
        data: executionResult,
        affectedTimeRanges: decision.result.decision.preview?.affectedTimeRanges,
        validationReport: decision.result.validationReport as ValidationReport | undefined,
      })
      if (decision.result.status === 'executed') {
        emitLatestRuntimeSchedule(executionResult)
      }
      return
    }
    case 'pending_atomic_context':
      appendRuntimeFeedback(withRuntimeFeedbackNotice(decision.feedback, leadingNotice))
      pendingAtomicContext.value = decision.pendingAtomicContext
      bindPendingReviewToCurrentWorkspace()
      recordBrowserRuntimeTrace('pending_atomic_context:set', {
        hasCompositeTaskRun: Boolean(decision.pendingAtomicContext.compositeTaskRun),
        compositeStatus: decision.pendingAtomicContext.compositeTaskRun?.status,
        phase: decision.pendingAtomicContext.phase,
        action: decision.pendingAtomicContext.action,
      })
      return
    case 'message':
      rememberLayoutDraftContinuationIfNeeded(decision.feedback)
      if (decision.layoutDraft) {
        preserveIncomingLayoutDraftOnWorkspaceChange.value = true
      }
      appendRuntimeFeedback(withRuntimeFeedbackNotice(decision.feedback, leadingNotice))
      if (decision.layoutDraft) {
        pendingLayoutDraft.value = decision.layoutDraft
        layoutDraftFeasibility.value = decision.layoutDraftFeasibility ?? null
        pendingLayoutDraftMode.value = decision.layoutDraftMode ?? 'full_generate'
        emit('layoutDraftUpdated', {
          draft: decision.layoutDraft,
          feasibilityReport: decision.layoutDraftFeasibility ?? null,
        })
        void nextTick(() => {
          preserveIncomingLayoutDraftOnWorkspaceChange.value = false
        })
      }
      if ('analysisContext' in decision) {
        analysisContext.value = decision.analysisContext ?? null
      }
      pendingAtomicContext.value = decision.pendingAtomicClarification
        ? buildPendingAtomicContextFromClarification(decision.pendingAtomicClarification)
        : null
      if (pendingAtomicContext.value) {
        bindPendingReviewToCurrentWorkspace()
      } else {
        pendingReviewWorkspaceKey.value = null
      }
      return
    case 'pending_command':
      appendRuntimeFeedback(withRuntimeFeedbackNotice(decision.feedback, leadingNotice))
      pendingCommand.value = decision.pendingCommand
      pendingAtomicContext.value = null
      bindPendingReviewToCurrentWorkspace()
      return
    case 'pending_target_selection':
      appendRuntimeFeedback(withRuntimeFeedbackNotice(decision.feedback, leadingNotice))
      pendingAtomicContext.value = buildPendingAtomicContextFromTargetSelection(decision.pendingTargetSelection)
      bindPendingReviewToCurrentWorkspace()
      return
    case 'pending_insert_recommendation':
      appendRuntimeFeedback(withRuntimeFeedbackNotice(decision.feedback, leadingNotice))
      pendingAtomicContext.value = buildPendingAtomicContextFromInsertRecommendation(decision.pendingInsertRecommendation)
      bindPendingReviewToCurrentWorkspace()
      return
    case 'execute_command':
      pendingAtomicContext.value = null
      pendingCommand.value = null
      pendingReviewWorkspaceKey.value = null
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
        successMessage: leadingNotice
          ? `${leadingNotice}\n${decision.execution.successMessage}`
          : decision.execution.successMessage,
        thinking: decision.execution.thinking,
        explanation: decision.execution.explanation,
        details: decision.execution.details,
      })
      return
    case 'orchestration':
      clearLayoutDraftContinuationPreference()
      appendRuntimeFeedback(withRuntimeFeedbackNotice(decision.feedback, leadingNotice))
      emit('orchestrateRequested', decision.orchestrationRequest)
      return
    case 'layout_draft':
      clearLayoutDraftContinuationPreference()
      pendingCommand.value = null
      pendingAtomicContext.value = null
      pendingReviewWorkspaceKey.value = null
      pendingLayoutDraft.value = decision.draft
      layoutDraftFeasibility.value = decision.feasibilityReport
      pendingLayoutDraftMode.value = decision.orchestrationMode
      emit('layoutDraftUpdated', {
        draft: decision.draft,
        feasibilityReport: decision.feasibilityReport,
      })
      if (foregroundLayoutDraftEnabled) {
        appendRuntimeFeedback(withRuntimeFeedbackNotice(decision.feedback, leadingNotice))
      } else {
        appendLayoutDraftWorkspaceFeedback(
          decision.feedback,
          decision.feedback.processTypeLabel === '版面草案待调整'
            ? decision.feedback.content
            : decision.feedback.content || '左侧版面已更新，可以继续微调或确认进入编排；正式播单还没有开始编排。',
        )
      }
      return
    case 'layout_draft_clear':
      pendingAtomicContext.value = null
      pendingReviewWorkspaceKey.value = null
      clearPendingLayoutDraftState()
      if (foregroundLayoutDraftEnabled) {
        appendRuntimeFeedback(withRuntimeFeedbackNotice(decision.feedback, leadingNotice))
      }
      return
    case 'layout_commit':
      clearLayoutDraftContinuationPreference()
      pendingLayoutDraft.value = null
      layoutDraftFeasibility.value = null
      pendingLayoutDraftMode.value = null
      emit('layoutDraftUpdated', {
        draft: null,
        feasibilityReport: null,
      })
      if (foregroundLayoutDraftEnabled) {
        appendRuntimeFeedback(withRuntimeFeedbackNotice(decision.feedback, leadingNotice))
      } else {
        appendLayoutDraftWorkspaceFeedback(decision.feedback, '已确认左侧版面，开始进入正式编排。')
      }
      emit('orchestrateRequested', decision.orchestrationRequest)
      return
  }
}

const applyRuntimeExecutedResult = (executed: RuntimeExecutedResult, stepMetric?: MessageStepMetric) => {
  emit('commandExecuted', {
    success: executed.success,
    message: executed.message,
    commandAction: executed.command.action,
    data: executed.data,
    affectedTimeRanges: executed.affectedTimeRanges,
    validationReport: executed.validationReport,
  })

  const details = {
    ...(executed.details ?? {}),
    validationSummary: executed.validationSummary,
  } as DetailMap

  if (executed.success) {
    ElMessage.success(executed.message)
    emitLatestRuntimeSchedule(executed.data)
    pushAssistantMessage(buildAssistantMessage({
      content: executed.message,
      thinking: executed.thinking,
      explanation: executed.explanation || Object.keys(details).length > 0
        ? {
            type: 'command',
            targetId: `runtime-execution-${Date.now()}`,
            explanation: executed.explanation ?? '',
            details,
          }
        : undefined,
      processType: 'execution',
      processTypeLabel: '执行完成',
      stepMetric,
      focusTarget: executed.command.action === 'delete'
        ? undefined
        : extractFocusTargetFromDetails(details, 'execution', 'result'),
    }), {
      autoFocus: false,
    })
    return
  }

  ElMessage.error(executed.error || executed.message)
  pushAssistantMessage(buildAssistantMessage({
    content: executed.error || executed.message,
    thinking: executed.thinking,
    explanation: executed.explanation || Object.keys(details).length > 0
      ? {
          type: 'command',
          targetId: `runtime-execution-error-${Date.now()}`,
          explanation: executed.explanation ?? '',
          details,
        }
      : undefined,
    processType: 'error',
    processTypeLabel: '执行失败',
    stepMetric,
    focusTarget: Object.keys(details).length > 0 ? extractFocusTargetFromDetails(details, 'error', 'issue') : undefined,
  }))
}

const recordBrowserRuntimeTrace = (event: string, details?: Record<string, unknown>) => {
  if (!import.meta.env.DEV || typeof window === 'undefined') return
  const traceWindow = window as Window & {
    __AIBIANDAN_RUNTIME_TRACE__?: Array<Record<string, unknown>>
  }
  if (!Array.isArray(traceWindow.__AIBIANDAN_RUNTIME_TRACE__)) return
  traceWindow.__AIBIANDAN_RUNTIME_TRACE__.push({
    event,
    at: Date.now(),
    ...details,
  })
}

const processMessage = async (content: string, progressLabel = '思考中') => {
  loading.value = true
  const stepProgress = startStepProgress(progressLabel)
  let effectiveContent = content
  const runtimeInputSource = pendingRuntimeInputSource.value
  pendingRuntimeInputSource.value = 'user'

  try {
    const retryInput = resolveRecoverableRuntimeRetryInput(content)
    if (retryInput === null) {
      messages.value.push(buildAssistantMessage({
        content: '现在没有可重试的上一条需求，请直接告诉我想怎么编排。',
        processType: 'general',
        processTypeLabel: '重试',
        stepMetric: stepProgress.finish(),
      }))
      return
    }
    if (retryInput !== undefined) {
      effectiveContent = retryInput
    } else {
      recoverableRuntimeFailure.value = null
    }

    const scheduleState = buildCurrentRuntimeScheduleState()
    const currentLayoutDraft = foregroundLayoutDraftRuntimeEnabled
      ? props.currentLayoutDraft ?? pendingLayoutDraft.value
      : null
    const currentWorkspaceKey = resolveCurrentPendingWorkspaceKey()
    const pendingReviewLifecycle = resolvePendingReviewLifecycle({
      latestUserInput: content,
      currentWorkspaceKey,
      pendingWorkspaceKey: pendingReviewWorkspaceKey.value,
      pendingCommand: pendingCommand.value,
      pendingAtomicContext: pendingAtomicContext.value,
    })
    const usablePendingCommand = pendingReviewLifecycle.canUsePendingReview ? pendingCommand.value : null
    const usablePendingAtomicContext = pendingReviewLifecycle.canUsePendingReview ? pendingAtomicContext.value : null
    const interruptedPendingReviewNotice = pendingReviewInterruptedNotice.value
    pendingReviewInterruptedNotice.value = null
    const pendingReviewExpiredNotice = interruptedPendingReviewNotice ?? (pendingReviewLifecycle.shouldExpire
      ? resolvePendingReviewExpiredNotice(pendingReviewLifecycle.expireReason)
      : null)
    if (usablePendingCommand && isPendingReviewCancelText(content)) {
      const summary = usablePendingCommand.summary.replace(/[，,。.!！?？]+$/u, '')
      pendingCommand.value = null
      pendingAtomicContext.value = null
      pendingReviewWorkspaceKey.value = null
      messages.value.push(buildAssistantMessage({
        content: `${summary}，已取消执行。`,
        thinking: '我已根据你的选择停止这次待确认修改，不会对当前编排单做任何变更。',
        processType: 'general',
        processTypeLabel: '已取消',
        stepMetric: stepProgress.finish(),
      }))
      return
    }
    if (usablePendingCommand && isPendingReviewConfirmText(content)) {
      pendingCommand.value = null
      pendingAtomicContext.value = null
      pendingReviewWorkspaceKey.value = null
      const result = await runtimeFacade.executePendingCommand({
        pendingCommand: usablePendingCommand,
        scheduleDate: props.date,
        channelId: props.channelId,
      })
      applyRuntimeExecutedResult(result, stepProgress.finish())
      return
    }
    if (pendingReviewLifecycle.shouldExpire) {
      pendingCommand.value = null
      pendingAtomicContext.value = null
      pendingReviewWorkspaceKey.value = null
    }
    const foregroundContextPackage = buildForegroundAgentContextPackage({
      latestUserInput: effectiveContent,
      scheduleState,
      currentSchedule: props.currentSchedule,
      currentLayoutDraft,
      pendingCommand: usablePendingCommand,
      pendingAtomicContext: usablePendingAtomicContext,
      activeReactTaskRun: resolveActiveReactTaskForCurrentWorkspace(),
    })
    const preferLayoutDraftRefine = foregroundLayoutDraftRuntimeEnabled
      && Boolean(currentLayoutDraft)
      && preferLayoutDraftContinuation.value
    preferLayoutDraftContinuation.value = false
    recordBrowserRuntimeTrace('submit:start', {
      userInput: effectiveContent,
      playlistType: scheduleState.playlistType,
      hasLayoutDraft: Boolean(currentLayoutDraft),
      itemCount: scheduleState.itemCount,
    })
    const decision = await runtimeFacade.submitInstruction({
      scheduleState,
      userInput: effectiveContent,
      currentSchedule: props.currentSchedule,
      currentLayoutDraft,
      currentLayoutDraftMode: foregroundLayoutDraftRuntimeEnabled ? pendingLayoutDraftMode.value : null,
      analysisContext: analysisContext.value,
      pendingAtomicContext: usablePendingAtomicContext,
      activeReactTaskRun: resolveActiveReactTaskForCurrentWorkspace(),
      foregroundContextPackage,
      history: buildVisibleRuntimeHistory(effectiveContent),
      agentCoreEnabled: true,
      layoutDraftEnabled: foregroundLayoutDraftRuntimeEnabled,
      preferLayoutDraftRefine,
      inputSource: retryInput !== undefined ? 'user' : runtimeInputSource,
    })
    recordBrowserRuntimeTrace('submit:decision', {
      userInput: effectiveContent,
      kind: decision.kind,
      statusHint: 'statusHint' in decision ? decision.statusHint : undefined,
      feedback: 'feedback' in decision ? decision.feedback.content : undefined,
    })
    const runtimeFeedback = getRuntimeDecisionFeedback(decision)
    await applyRuntimeDecision(decision, pendingReviewExpiredNotice)
    syncActiveReactTaskFromFeedback(runtimeFeedback ?? undefined)
    recordBrowserRuntimeTrace('submit:applied', {
      userInput: effectiveContent,
      kind: decision.kind,
    })
    recoverableRuntimeFailure.value = extractRecoverableRuntimeFailure(
      runtimeFeedback,
      effectiveContent,
      currentWorkspaceKey,
    )
    attachStepMetricToLatestAssistantMessage(stepProgress.finish())
  } catch (error) {
    const stepMetric = stepProgress.finish()
    const errorMessage = error instanceof Error ? error.message : 'AI 请求失败，请稍后重试。'
    if (/LLM|模型|超时|timeout|timed out/i.test(errorMessage)) {
      recoverableRuntimeFailure.value = {
        originalUserInput: effectiveContent,
        workspaceKey: resolveCurrentPendingWorkspaceKey(),
        createdAt: Date.now(),
      }
    }
    messages.value.push(buildAssistantMessage({
      content: /LLM|模型|超时|timeout|timed out/i.test(errorMessage)
        ? '这次模型没有正常返回，我还没有修改草案或播单。你可以直接说“重试”，我会按刚才这句话再试一次。'
        : errorMessage,
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
  recordBrowserRuntimeTrace('send_message:start', {
    content,
    loading: loading.value,
    hasPendingCommand: Boolean(pendingCommand.value),
    hasPendingAtomicContext: Boolean(pendingAtomicContext.value),
    hasCompositeTaskRun: Boolean(pendingAtomicContext.value?.compositeTaskRun),
  })

  const pendingReviewInterrupted = interruptPendingReviewForNewInput(content)
  messages.value.push(buildUserMessage(content))
  if (pendingReviewInterrupted) {
    const interruptedNotice = pendingReviewInterruptedNotice.value
    pendingReviewInterruptedNotice.value = null
    if (interruptedNotice) {
      pushAssistantMessage(buildAssistantMessage({
        content: interruptedNotice,
        processType: 'general',
        processTypeLabel: '待确认已失效',
      }), {
        autoFocus: false,
      })
    }
  }
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
  if (activePlaylistType.value === 'rotation') {
    const seconds = timeToSeconds(normalized)
    if (typeof seconds === 'number') {
      return seconds <= 0 ? '0点起算' : `+${formatPlaylistDurationText(seconds)}`
    }
  }
  return /^\d{2}:\d{2}(:\d{2})?$/.test(normalized) ? normalized : timeText
}

const formatDisplayTimeRange = (startTime: string, endTime?: string): string => {
  if (activePlaylistType.value === 'rotation' && endTime) {
    const startSeconds = timeToSeconds(normalizeClockText(startTime))
    const endSeconds = timeToSeconds(normalizeClockText(endTime))
    if (typeof startSeconds === 'number' && typeof endSeconds === 'number') {
      const durationSeconds = Math.max(0, endSeconds - startSeconds)
      const durationText = formatPlaylistDurationText(durationSeconds)
      if (startSeconds <= 0) {
        return `总时长${durationText}，0点起算`
      }
      return `相对位置 +${formatPlaylistDurationText(startSeconds)}，持续${durationText}`
    }
  }
  const start = formatDisplayTime(startTime)
  if (!endTime) return start
  return `${start}到${formatDisplayTime(endTime)}`
}

const formatAtomicSlotTime = (timeText?: string | null): string => {
  if (!timeText) return ''
  return formatDisplayTime(timeText)
}

const formatAssistantDisplayContent = (content: string): string => {
  if (activePlaylistType.value !== 'rotation') return content
  return content
    .replace(
      /\b(\d{1,2}:\d{2}(?::\d{2})?)\b\s*(?:-|—|～|~|至|到)\s*\b(\d{1,2}:\d{2}(?::\d{2})?)\b/g,
      (_match, start: string, end: string) => formatDisplayTimeRange(start, end),
    )
    .replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g, (match) => formatDisplayTime(match))
}

const isTechnicalPendingReason = (value?: string | null): boolean => {
  if (!value) return false
  return /requires confirmation|before committing|Rotation insert|Rotation replace|still needs|needs more information|Agent Core needs|missing required/i.test(value)
}

const getClarifyingPendingSummary = (context: RuntimePendingAtomicContext): string | null => {
  if (context.phase !== 'clarifying') return null
  const missing = new Set(context.missingFields)
  const actionLabel = formatAtomicActionLabel(context.action)
  const targetText = formatAtomicSlotTime(context.slots.targetTime || context.slots.targetTimeHint)
  const programText = context.slots.programName || context.slots.rawProgramText || context.slots.semanticLabel

  if (context.action === 'insert') {
    if (missing.has('target_time')) return programText ? `待补充《${programText}》的播出时间` : '待补充插入时间'
    if (missing.has('program_name')) return targetText ? `待补充 ${targetText} 要插入的节目线索` : '待补充节目线索'
  }
  if (context.action === 'replace') {
    if (missing.has('target_time')) return '待补充要替换的播出位置'
    if (missing.has('replacement_program')) return targetText ? `待补充 ${targetText} 要换成的节目` : '待补充替换节目线索'
  }
  if (context.action === 'delete') {
    if (missing.has('target_time')) return '待补充要删除的节目位置'
  }
  if (context.action === 'move') {
    if (missing.has('target_time')) return '待补充要移动的节目位置'
    if (missing.has('direction') || missing.has('offset')) return '待补充移动方式'
  }

  return `待补充${actionLabel}所需信息`
}

const formatPendingAtomicSummary = (context: RuntimePendingAtomicContext): string => {
  if (context.compositeTaskRun) {
    return formatCompositeTaskSummary(context.compositeTaskRun)
  }
  if (isDraftResearchConfirmationContext(context)) {
    const label = context.layoutDraftSuggestion?.semanticLabel || context.slots.semanticLabel || '草案建议'
    return `待确认更新草案：${label}`
  }
  if (isFormalRebuildConfirmationContext(context)) {
    const count = context.formalRebuildConfirmation?.existingItemCount ?? 0
    return count > 0 ? `待确认重新编排：当前已有 ${count} 条节目` : '待确认重新编排正式播单'
  }
  if (context.agentPendingTask?.phase === 'needs_confirmation' || context.missingFields.includes('selection')) {
    const targetText = formatAtomicSlotTime(context.slots.targetTime || context.slots.targetTimeHint)
    const targetName = context.slots.targetItemName || context.slots.programName
    const targetPart = [
      targetText ? `${targetText} 的` : '',
      targetName ? `《${targetName}》` : '目标节目',
    ].filter(Boolean).join('')
    if (context.action === 'delete') return `待确认删除${targetPart}`
    if (context.action === 'replace') return `待确认替换${targetPart}`
    if (context.action === 'insert') return '待确认插入节目'
    return `待确认${formatAtomicActionLabel(context.action)}`
  }
  const clarifyingSummary = getClarifyingPendingSummary(context)
  if (clarifyingSummary) return clarifyingSummary
  if (isTechnicalPendingReason(context.summary)) {
    if (context.action === 'replace') {
      return '我已经找到可替换的候选，确认后再写入当前轮播单。'
    }
    if (context.action === 'insert') {
      return '我已经找到可插入的候选，确认后再写入当前轮播单。'
    }
    return '这一步会改动当前播单，请确认后我再执行。'
  }
  return formatAssistantDisplayContent(context.summary)
}

const formatPendingAtomicReasoning = (
  context: RuntimePendingAtomicContext,
  preferred: 'reasoning' | 'followUp' = 'reasoning',
): string => {
  if (context.compositeTaskRun) {
    return formatCompositeTaskConfirmationNote(context.compositeTaskRun)
  }
  if (isDraftResearchConfirmationContext(context)) {
    const label = context.layoutDraftSuggestion?.semanticLabel || context.slots.semanticLabel || '这个方向'
    const candidateCount = context.layoutDraftSuggestion?.candidateCount ?? 0
    const candidateText = candidateCount > 0 ? `已查到 ${candidateCount} 条可参考素材。` : ''
    return `${candidateText}确认后我只更新左侧草案里的“${label}”方向，不会写入正式播单。`
  }
  if (isFormalRebuildConfirmationContext(context)) {
    const confirmation = context.formalRebuildConfirmation
    const playlistLabel = confirmation?.playlistType === 'rotation' ? '轮播单' : '电视播单'
    const basisLabel = confirmation?.actionKind === 'commit_layout_draft' || confirmation?.useLayoutDraft ? '当前草案' : '这次要求'
    return `当前${playlistLabel}已经有节目。确认后我会按${basisLabel}重新写入正式播单；取消则不改动。`
  }
  const primary = preferred === 'followUp'
    ? context.followUpQuestion || context.reasoning
    : context.reasoning || context.followUpQuestion
  if (isTechnicalPendingReason(primary)) {
    if (context.phase === 'clarifying') return formatPendingAtomicGuidance(context)
    const candidateName = context.agentPendingTask?.recommendations?.[0]?.programName
    const targetText = formatAtomicSlotTime(context.slots.targetTime || context.slots.targetTimeHint)
    const candidatePart = candidateName ? `《${candidateName}》` : '当前候选'
    const targetPart = targetText ? `，目标位置是 ${targetText}` : ''
    return `${candidatePart}可以用于这次${formatAtomicActionLabel(context.action)}${targetPart}。请确认后我再写入当前轮播单。`
  }
  return formatAssistantDisplayContent(primary || context.summary)
}

const formatPendingAtomicGuidance = (context: RuntimePendingAtomicContext): string => {
  const missing = new Set(context.missingFields)
  const actionLabel = formatAtomicActionLabel(context.action)
  const targetText = formatAtomicSlotTime(context.slots.targetTime || context.slots.targetTimeHint)
  const programText = context.slots.programName || context.slots.rawProgramText || context.slots.semanticLabel
  const targetPart = targetText ? `目标位置 ${targetText}` : ''
  const programPart = programText ? `节目线索《${programText}》` : ''
  const knownParts = [programPart, targetPart].filter(Boolean).join('，')

  if (context.action === 'insert') {
    if (missing.has('target_time') && programText) {
      return `我已经识别到要插入《${programText}》，还需要你告诉我放到哪个播出位置，例如“9点”或“10点”。`
    }
    if (missing.has('program_name') && targetText) {
      return `我已经识别到插入位置是 ${targetText}，还需要你补充节目名、短片标题或素材关键词。`
    }
  }

  if (context.action === 'move') {
    if (missing.has('offset') || missing.has('direction')) {
      return `我已经在当前播单里保留了这次移动请求${knownParts ? `（${knownParts}）` : ''}，还需要你补充移动方式，例如“后移30分钟”或“移到10点”。`
    }
    if (missing.has('target_time')) {
      return '我还需要先定位要移动的节目，可以告诉我原播出时间，或直接说节目名称。'
    }
  }

  if (context.action === 'replace') {
    if (missing.has('replacement_program')) {
      return `我已经定位到要替换的位置${targetText ? ` ${targetText}` : ''}，还需要你告诉我要换成哪个节目或素材。`
    }
    if (missing.has('target_time')) {
      return '我还需要先定位要替换的节目，可以告诉我原播出时间，或直接说节目名称。'
    }
  }

  if (context.action === 'delete' && missing.has('target_time')) {
    return '我还需要先定位要删除的节目，可以告诉我播出时间，或补充节目名称。'
  }

  const missingLabels = context.missingFields.map(formatAtomicMissingFieldLabel).join('、')
  return `我已经保留这次${actionLabel}请求${knownParts ? `（${knownParts}）` : ''}，还需要补充${missingLabels || '关键信息'}后再继续。`
}

const formatPendingAtomicKnownFacts = (context: RuntimePendingAtomicContext): string => {
  const facts: string[] = []
  const targetText = formatAtomicSlotTime(context.slots.targetTime || context.slots.targetTimeHint)
  const newStartText = formatAtomicSlotTime(context.slots.newStartTime)
  const programText = context.slots.programName || context.slots.rawProgramText || context.slots.semanticLabel
  const replacementText = context.slots.replacementProgramName

  if (targetText) facts.push(`目标位置 ${targetText}`)
  if (newStartText) facts.push(`移动到 ${newStartText}`)
  if (programText) facts.push(`节目或素材线索《${programText}》`)
  if (replacementText) facts.push(`替换为《${replacementText}》`)
  if (typeof context.slots.offsetSeconds === 'number') {
    const directionText = context.slots.direction === 'backward'
      ? '向前'
      : context.slots.direction === 'forward'
        ? '向后'
        : ''
    facts.push(`${directionText}移动 ${formatPlaylistDurationText(context.slots.offsetSeconds)}`)
  }

  const missingLabels = context.phase === 'clarifying'
    ? context.missingFields
        .map(formatAtomicMissingFieldLabel)
        .filter((label) => label !== '候选选择')
    : []
  const factText = facts.length > 0 ? `已识别：${facts.join('，')}。` : ''
  const missingText = missingLabels.length > 0 ? `下一步只需要补充${missingLabels.join('、')}。` : ''
  return `${factText}${missingText}`.trim()
}

type PendingCompositeTaskRun = NonNullable<RuntimePendingAtomicContext['compositeTaskRun']>
type PendingCompositeStage = PendingCompositeTaskRun['stages'][number]

const getCurrentCompositeStage = (taskRun: PendingCompositeTaskRun): PendingCompositeStage | undefined =>
  taskRun.stages[taskRun.currentStageIndex] ?? taskRun.stages.find((stage) => stage.status === 'waiting_confirm') ?? taskRun.stages[0]

const formatCompositeActionLabel = (action?: PendingCompositeStage['action']): string => {
  switch (action) {
    case 'delete':
      return '删除'
    case 'move':
      return '移动'
    case 'replace':
      return '替换'
    case 'insert':
      return '插入'
    default:
      return '处理'
  }
}

const formatCompositeTaskSummary = (taskRun: PendingCompositeTaskRun): string => {
  const stage = getCurrentCompositeStage(taskRun)
  const stepCount = stage?.steps?.length ?? 0
  const actionLabel = formatCompositeActionLabel(stage?.action)
  const targetLabel = taskRun.batch?.targetLabel
  const batchText = taskRun.batch ? `第 ${taskRun.batch.batchIndex} 批` : ''
  const targetText = targetLabel ? `《${targetLabel}》` : '节目'
  if (stepCount > 0) {
    return `${batchText}准备${actionLabel} ${stepCount} 条${targetLabel ? ` ${targetText}` : '节目'}`
  }
  return `准备${actionLabel}${targetLabel ? targetText : '当前播单'}`
}

const formatCompositeTaskConfirmationNote = (taskRun: PendingCompositeTaskRun): string => {
  const stage = getCurrentCompositeStage(taskRun)
  const stepCount = stage?.steps?.length ?? 0
  const actionLabel = formatCompositeActionLabel(stage?.action)
  const remainingCount = taskRun.batch?.remainingCount ?? 0
  const remainingText = remainingCount > stepCount
    ? `这批完成后，我会告诉你还剩 ${remainingCount - stepCount} 条要不要继续。`
    : '完成后我会复查当前播单。'
  if (stepCount > 0) {
    return `确认后我先${actionLabel}这 ${stepCount} 条，写入前会再检查当前播单是否变过。${remainingText}取消则不改动播单。`
  }
  return `确认后我会按这一步继续处理，写入前会再检查当前播单是否变过。取消则不改动播单。`
}

const formatPendingAtomicConfirmationNote = (context: RuntimePendingAtomicContext): string => {
  if (context.compositeTaskRun) {
    return formatCompositeTaskConfirmationNote(context.compositeTaskRun)
  }
  if (isDraftResearchConfirmationContext(context)) {
    const label = context.layoutDraftSuggestion?.semanticLabel || context.slots.semanticLabel || '这个方向'
    return `确认后只把“${label}”更新到左侧草案，不会写入正式播单；取消则保留原草案。`
  }
  if (isFormalRebuildConfirmationContext(context)) {
    const confirmation = context.formalRebuildConfirmation
    const basisLabel = confirmation?.actionKind === 'commit_layout_draft' || confirmation?.useLayoutDraft ? '当前草案' : '这次要求'
    return `确认后按${basisLabel}重新编排正式播单，已有节目可能被替换；取消则保留当前播单。`
  }
  const modelNote = context.confirmationNote || context.reasoning
  if (modelNote && !isTechnicalPendingReason(modelNote)) {
    return formatAssistantDisplayContent(modelNote)
  }

  const targetText = formatAtomicSlotTime(context.slots.targetTime || context.slots.targetTimeHint)
  const targetName = context.slots.targetItemName || context.slots.programName
  const targetPart = [
    targetText ? `${targetText} 的` : '',
    targetName ? `《${targetName}》` : '目标节目',
  ].filter(Boolean).join('')
  if (context.action === 'delete') {
    return `已定位：${targetPart}。确认后删除，取消则不改动播单。`
  }
  if (context.action === 'replace') {
    return `已定位：${targetPart}。确认后替换写入，取消则不改动播单。`
  }
  if (context.action === 'insert') {
    return '插入方案已预演。确认后写入，取消则不改动播单。'
  }
  return `${formatAtomicActionLabel(context.action)}方案已预演。确认后写入，取消则不改动播单。`
}

const uniqueQuickReplies = (items: PendingQuickReply[]): PendingQuickReply[] => {
  const seen = new Set<string>()
  return items.filter((item) => {
    const key = item.prompt.trim()
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

const getPendingAtomicClarificationSuggestions = (context: RuntimePendingAtomicContext): PendingQuickReply[] => {
  if (context.phase !== 'clarifying') return []
  const missing = new Set(context.missingFields)
  const replies: PendingQuickReply[] = []

  if (missing.has('target_time')) {
    replies.push(
      { label: '9点', prompt: '9点' },
      { label: '10点', prompt: '10点' },
    )
  }

  if (missing.has('offset') || missing.has('direction')) {
    replies.push(
      { label: '后移30分钟', prompt: '后移30分钟' },
      { label: '后移1小时', prompt: '后移1小时' },
      { label: '前移30分钟', prompt: '前移30分钟' },
    )
  }

  if (missing.has('replacement_program')) {
    replies.push(
      { label: '换成东方新闻', prompt: '换成东方新闻' },
      { label: '换成看东方', prompt: '换成看东方' },
    )
  }

  if (missing.has('program_name')) {
    replies.push(
      { label: '看东方', prompt: '看东方' },
      { label: '东方新闻', prompt: '东方新闻' },
      { label: '城市形象短片', prompt: '城市形象春日花路短片' },
    )
  }

  return uniqueQuickReplies(replies).slice(0, 4)
}

const formatPendingAgentTaskState = (phase?: string): string => {
  if (phase === 'needs_confirmation') return '已预演，等待确认写入'
  if (phase === 'selecting_target') return '等待选择目标节目'
  if (phase === 'selecting_candidate') return '等待选择候选节目'
  if (phase === 'needs_clarification') return '等待补充关键信息'
  return '已记下当前说法'
}

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

const formatInsertRecommendationMeta = (duration: number, programType: string, _confidence: number): string => {
  const durationMinutes = duration >= 60
    ? duration % 60 === 0
      ? `${duration / 60}分钟`
      : `${(duration / 60).toFixed(1)}分钟`
    : `${duration}秒`
  return `${durationMinutes} · ${formatProgramTypeLabel(programType)}`
}

const getInsertRecommendationBadgeLabel = (index: number): string => (
  index === 0 ? '优先推荐' : `候选 ${index + 1}`
)

const formatRecommendationStrengthLabel = (index: number): string => (
  index === 0 ? '建议优先看' : '可作为备选'
)

const getAtomicPhaseLabel = (phase?: RuntimePendingAtomicContext['phase']) => {
  switch (phase) {
    case 'clarifying':
      return '待补参'
    case 'selecting_target':
      return '待选择'
    case 'recommending_insert':
      return '插入推荐'
    default:
      return '待处理信息'
  }
}

const isPendingAtomicReplaceRecommendation = () => pendingAtomicContext.value?.action === 'replace'

const getAtomicRecommendationTitle = () => (
  isPendingAtomicReplaceRecommendation() ? '替换推荐' : getAtomicPhaseLabel('recommending_insert')
)

const getAtomicRecommendationAriaLabel = () => (
  isPendingAtomicReplaceRecommendation() ? '替换推荐节目列表' : '插入推荐节目列表'
)

const getAtomicRecommendationActionHint = () => (
  isPendingAtomicReplaceRecommendation()
    ? '选好后我会先预演替换，确认没有问题再写入。'
    : '选好后我会先预演插入，确认没有问题再写入。'
)

const getAtomicRecommendationConfirmLabel = () => (
  isPendingAtomicReplaceRecommendation() ? '确认替换' : '确认插入'
)

const formatAtomicActionLabel = (action: RuntimePendingAtomicContext['action']) => {
  switch (action) {
    case 'insert':
      return '插入'
    case 'move':
      return '移动'
    case 'delete':
      return '删除'
    case 'replace':
      return '替换'
    default:
      return '未识别'
  }
}

const formatAtomicMissingFieldLabel = (field: string) => {
  switch (field) {
    case 'target_time':
      return '目标时间'
    case 'program_name':
      return '节目名称'
    case 'offset':
      return '移动幅度'
    case 'direction':
      return '方向'
    case 'replacement_program':
      return '替换节目'
    case 'selection':
      return '候选选择'
    default:
      return field
  }
}

const pendingAtomicPhase = computed(() => (
  pendingAtomicContext.value?.phase ?? null
))
const pendingAtomicTargetCandidates = computed(() => pendingAtomicContext.value?.targetCandidates ?? [])
const pendingAtomicInsertRecommendations = computed(() => pendingAtomicContext.value?.insertRecommendations ?? [])
const pendingAtomicTargetSelectedItemId = computed<string | null>({
  get: () => pendingAtomicContext.value?.selectedItemId ?? null,
  set: (value) => {
    if (pendingAtomicContext.value) {
      pendingAtomicContext.value.selectedItemId = value
    }
  },
})
const pendingAtomicInsertSelectedCandidateId = computed<string | null>({
  get: () => pendingAtomicContext.value?.selectedCandidateId ?? null,
  set: (value) => {
    if (pendingAtomicContext.value) {
      pendingAtomicContext.value.selectedCandidateId = value
    }
  },
})
const showClarifyingAtomicPanel = computed(() => false)
const showTargetSelectionAtomicPanel = computed(() => pendingAtomicPhase.value === 'selecting_target' && pendingAtomicTargetCandidates.value.length > 0)
const showInsertRecommendationAtomicPanel = computed(() => pendingAtomicPhase.value === 'recommending_insert' && pendingAtomicInsertRecommendations.value.length > 0)
const isDraftResearchConfirmationContext = (context?: RuntimePendingAtomicContext | null) =>
  context?.phase === 'draft_research_confirmation' || Boolean(context?.layoutDraftSuggestion)
const isFormalRebuildConfirmationContext = (context?: RuntimePendingAtomicContext | null) =>
  context?.phase === 'formal_rebuild_confirmation' || Boolean(context?.formalRebuildConfirmation)

const showAgentPendingConfirmationPanel = computed(() =>
  pendingAtomicContext.value?.agentPendingTask?.phase === 'needs_confirmation'
  || pendingAtomicContext.value?.compositeTaskRun?.status === 'waiting_confirm'
  || isDraftResearchConfirmationContext(pendingAtomicContext.value)
  || isFormalRebuildConfirmationContext(pendingAtomicContext.value)
)

const formatPendingConfirmationPrimaryAction = (context: RuntimePendingAtomicContext): string =>
  isDraftResearchConfirmationContext(context)
    ? '更新草案'
    : isFormalRebuildConfirmationContext(context)
      ? '确认重新编排'
      : '确认执行'

const formatDetails = (details: DetailMap) => formatStructuredDetails(sanitizeForegroundDraftPayload(details), formatDisplayTime)

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

const getVisibleMessageDetails = (message: Message): DetailMap | undefined => {
  const details = getMessageDetails(message)
  if (!details) return undefined
  const sanitized = sanitizeForegroundDraftPayload(details) as DetailMap
  return Object.keys(sanitized).length > 0 ? sanitized : undefined
}

const getRotationStrategyLabel = (strategy?: RotationPlaylistStrategy) => {
  if (strategy === 'rating') return '收视率优先'
  if (strategy === 'trending') return '热播优先'
  return '内容匹配优先'
}

const formatPlaylistDurationText = (seconds: number) => {
  const totalSeconds = Math.max(0, Math.round(seconds))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const remainSeconds = totalSeconds % 60
  const parts = [
    hours > 0 ? `${hours}小时` : '',
    minutes > 0 ? `${minutes}分钟` : '',
    remainSeconds > 0 ? `${remainSeconds}秒` : '',
  ].filter(Boolean)
  return parts.join('') || '0秒'
}

const getPlaylistFileCard = (message: Message): PlaylistFileCard | null => {
  if (message.role === 'user') return null
  const playlistState = toDetailMap(getMessageDetails(message)?.playlistState)
  const playlistType = playlistState?.playlistType
  if (playlistType !== 'tv' && playlistType !== 'rotation') return null

  if (playlistType === 'tv') {
    const channelName = typeof playlistState?.channelName === 'string' && playlistState.channelName.trim()
      ? playlistState.channelName.trim()
      : props.channelName || '当前频道'
    const date = typeof playlistState?.date === 'string' && playlistState.date.trim()
      ? playlistState.date.trim()
      : props.date
    return {
      playlistId: typeof playlistState?.playlistId === 'string' ? playlistState.playlistId : undefined,
      playlistType,
      title: `${channelName}电视播单`,
      meta: `${date} · ${channelName} · 编排内容`,
    }
  }

  const rotationStrategyValue = playlistState?.rotationStrategy
  const rotationStrategy = rotationStrategyValue === 'rating' || rotationStrategyValue === 'trending'
    ? rotationStrategyValue
    : 'content_match'
  const rotationDurationSeconds = typeof playlistState?.rotationDurationSeconds === 'number'
    ? playlistState.rotationDurationSeconds
    : null
  const durationText = rotationDurationSeconds
    ? `总时长 ${formatPlaylistDurationText(rotationDurationSeconds)}`
    : '待确定总时长'
  return {
    playlistId: typeof playlistState?.playlistId === 'string' ? playlistState.playlistId : undefined,
    playlistType,
    title: '轮播单',
    meta: `${durationText} · ${getRotationStrategyLabel(rotationStrategy)}`,
  }
}

const openPlaylistFileCard = (message: Message) => {
  const card = getPlaylistFileCard(message)
  if (!card) return
  emit('playlistFileOpenRequested', {
    playlistId: card.playlistId,
    playlistType: card.playlistType,
  })
}

const getCandidateComparisonItems = (message: Message): CandidateComparisonItem[] =>
  buildCandidateComparisonItems(getMessageDetails(message))

const NOTICE_VALIDATION_TYPES = new Set(['gap', 'boundary_mismatch'])

const buildValidationIssueBreakdown = (
  summary?: DetailMap,
  issues?: unknown,
): { totalCount: number; riskCount: number; noticeCount: number } => {
  const totalCount = typeof summary?.totalIssues === 'number' ? summary.totalIssues : 0
  const issueList = Array.isArray(issues)
    ? issues.filter((issue): issue is DetailMap => Boolean(issue && typeof issue === 'object'))
    : []
  if (issueList.length === 0) {
    return { totalCount, riskCount: totalCount, noticeCount: 0 }
  }

  const noticeCount = issueList.filter((issue) => (
    typeof issue.type === 'string' && NOTICE_VALIDATION_TYPES.has(issue.type)
  )).length
  const riskCount = Math.max(0, totalCount - noticeCount)
  return { totalCount, riskCount, noticeCount }
}

const buildDetailsSummary = (
  details?: DetailMap,
  processType?: ProcessType,
): DetailSummaryItem[] => {
  void processType
  return buildMessageDetailsSummary(details, {
    formatDisplayTime,
    formatDisplayTimeRange,
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
  const validationBreakdown = buildValidationIssueBreakdown(validationSummary, validationEntry?.details?.issues)
  const validationIssueCount = validationBreakdown.totalCount
  const validationRiskCount = validationBreakdown.riskCount
  const validationNoticeCount = validationBreakdown.noticeCount
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
  if (validationRiskCount > 0) {
    unresolvedRisks.push(`校验仍提示 ${validationRiskCount} 个风险`)
  }
  if (validationNoticeCount > 0) {
    unresolvedRisks.push(`另有 ${validationNoticeCount} 个空窗或边界提示`)
  }
  if (adInsertionCount > 0) {
    unresolvedRisks.push(`版面内插播广告 ${adInsertionCount} 次，建议复核衔接节奏`)
  }

  const summaryLine = [
    unresolvedGapCount > 0 ? '自动编排阶段已结束' : '全天编排已完成',
    '本次优先遵循版面信息',
    completedGapCount > 0 ? `已处理 ${completedGapCount} 个空窗` : '已完成整体版面整理',
    unresolvedGapCount > 0 ? `仍有 ${unresolvedGapCount} 个空窗待人工确认` : '',
  ].filter(Boolean).join('，')

  const explanation = unresolvedGapCount > 0
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
      validationRiskCount > 0 ? '需人工确认' : validationNoticeCount > 0 ? '空窗提示' : '校验通过',
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
        validationRiskCount,
        validationNoticeCount,
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
    const validationRiskCount = typeof details?.validationRiskCount === 'number'
      ? details.validationRiskCount
      : validationIssueCount
    const validationNoticeCount = typeof details?.validationNoticeCount === 'number'
      ? details.validationNoticeCount
      : 0
    const failedGapCount = typeof details?.failedGapCount === 'number' ? details.failedGapCount : 0
    const sequentialFillCount = typeof details?.sequentialFillCount === 'number' ? details.sequentialFillCount : 0
    const rerunFillCount = typeof details?.rerunFillCount === 'number' ? details.rerunFillCount : 0
    addTag('版面优先')
    if (validationRiskCount > 0 || failedGapCount > 0) {
      addTag('需人工确认')
    } else if (validationNoticeCount > 0) {
      addTag('空窗提示')
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
      return '当前栏目不强调顺播，我已按这个时段更适合的节目来筛选。'
    }
  }

  if (details?.matchedItem && (details?.selectedCandidate || typeof details?.selectedCandidateName === 'string')) {
    return '已结合目标节目、可用候选和当前播单约束完成判断。'
  }

  if (details?.matchedItem) {
    return '已结合目标时间和当前编排记录完成目标定位。'
  }

  const preview = toPreviewRecord(details?.preview)
  if (preview?.canExecute === false || /冲突|无法执行/.test(message.content)) {
    return '已先检查主要约束，当前方案仍会影响现有编排。'
  }

  if (isNoCandidateCase(details ?? {}) || /没有检索到|未找到/.test(message.content)) {
    const diagnosticText = formatCandidateQueryDiagnosticText(details)
    return diagnosticText
      ? `已按当前条件尝试检索，${diagnosticText}。`
      : '已按当前条件尝试检索，但暂时没有更合适的可用节目。'
  }

  if (message.processType === 'execution') {
    return '已根据当前时段、节目线索和风险提示完成这次处理。'
  }

  if (message.processType === 'selection') {
    return '已结合当前空窗、可用候选和约束条件做出选择。'
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

const sanitizeForegroundDraftText = (value: string): string => {
  return value
}

const shouldDropForegroundDraftKey = (key: string): boolean => {
  if (foregroundLayoutDraftEnabled) return false
  return isForegroundDraftPayloadKey(key)
}

const sanitizeForegroundDraftPayload = <T,>(value: T): T => {
  if (foregroundLayoutDraftEnabled) return value
  if (typeof value === 'string') return sanitizeForegroundDraftText(value) as T
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeForegroundDraftPayload(item)) as T
  }
  if (value && typeof value === 'object') {
    const next: Record<string, unknown> = {}
    Object.entries(value as Record<string, unknown>).forEach(([key, nestedValue]) => {
      if (shouldDropForegroundDraftKey(key)) return
      next[key] = sanitizeForegroundDraftPayload(nestedValue)
    })
    return next as T
  }
  return value
}

const sanitizeAssistantMessageInput = (input: Omit<Message, 'role'>): Omit<Message, 'role'> => ({
  ...input,
  content: sanitizeForegroundDraftPayload(input.content),
  thinking: sanitizeForegroundDraftPayload(input.thinking),
  processTypeLabel: sanitizeForegroundDraftPayload(input.processTypeLabel),
  statusLabel: sanitizeForegroundDraftPayload(input.statusLabel),
  reasonTags: sanitizeForegroundDraftPayload(input.reasonTags),
  explanation: sanitizeForegroundDraftPayload(input.explanation),
})

const shouldKeepDraftBlockingInputVisible = (input: Omit<Message, 'role'>): boolean => (
  !foregroundLayoutDraftEnabled
  && typeof input.content === 'string'
  && isLayoutDraftBlockingText(input.content, input.processTypeLabel)
)

const shouldKeepReadOnlyAnalysisInputVisible = (input: Omit<Message, 'role'>): boolean => {
  if (isForegroundAgentMainReplyText(input.content)) return true
  if (input.processTypeLabel === '版面草案') return true
  if (input.processTypeLabel === '编单分析' || input.processTypeLabel === '优化建议') return true
  const details = input.explanation?.details as DetailMap | undefined
  return details?.readOnly === true
}

const buildAssistantMessage = (input: Omit<Message, 'role'>): Message => {
  const hiddenFromThread = input.hiddenFromThread
    || (!foregroundLayoutDraftEnabled
      && containsForegroundDraftPayload(input)
      && !shouldKeepDraftBlockingInputVisible(input)
      && !shouldKeepReadOnlyAnalysisInputVisible(input))
  return decorateAssistantMessage({
    role: 'assistant',
    expanded: false,
    workspaceKey: resolveCurrentMessageWorkspaceKey(),
    ...sanitizeAssistantMessageInput(input),
    hiddenFromThread,
  })
}

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
  }, 250)
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
  }, 250)
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

type LayoutAnalysisDisplayParagraph = {
  label?: string
  body: string
}

const LAYOUT_ANALYSIS_LABEL_PATTERN = /^(总评|观察|风险|建议|说明)\s*[：:]\s*/u

const getLayoutAnalysisParagraphs = (content: string): string[] =>
  content
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n/g)
    .map((item) => item.trim())
    .filter(Boolean)

const getLayoutAnalysisReportParagraphs = (content: string): LayoutAnalysisDisplayParagraph[] =>
  getLayoutAnalysisParagraphs(content).map((paragraph) => {
    const match = paragraph.match(LAYOUT_ANALYSIS_LABEL_PATTERN)
    if (!match) {
      return { body: paragraph }
    }

    return {
      label: match[1],
      body: paragraph.replace(LAYOUT_ANALYSIS_LABEL_PATTERN, '').trim(),
    }
  })

const shouldRenderLayoutAnalysisReport = (message: Message, section: ExplanationSection): boolean => {
  const details = getMessageDetails(message)
  return isLayoutAnalysisDetails(details) && section.title === '分析报告'
}

const getLayoutAnalysisSummary = (message: Message): string => {
  const paragraphs = getLayoutAnalysisReportParagraphs(message.content)
  const summary = paragraphs[0]?.body || message.content
  return truncateText(summary.replace(/\s+/g, ' '), 90)
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

  const details = getMessageDetails(message)
  if (isLayoutAnalysisDetails(details)) {
    return getLayoutAnalysisSummary(message)
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
    if (!foregroundLayoutDraftEnabled) return []
    const facts = [
      typeof details.matchedWeekdayLabel === 'string' ? details.matchedWeekdayLabel : '',
      typeof details.matchedColumnLabel === 'string' ? `列 ${details.matchedColumnLabel}` : '',
      typeof details.matchedSheetName === 'string' ? `表 ${details.matchedSheetName}` : '',
      typeof details.slotCount === 'number' ? `时段 ${details.slotCount}` : '',
    ].filter(Boolean)

    return facts.slice(0, 2)
  }

  if (isLayoutAnalysisDetails(details)) {
    const facts = [
      typeof details.alignedSlotCount === 'number' && typeof details.slotCount === 'number' ? `命中 ${details.alignedSlotCount}/${details.slotCount}` : '',
      typeof details.mismatchSlotCount === 'number' && details.mismatchSlotCount > 0 ? `偏差 ${details.mismatchSlotCount}` : '',
      formatValidationSummaryText(details.validationSummary),
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
    if (!foregroundLayoutDraftEnabled) return []
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

  if (isLayoutAnalysisDetails(details)) {
    return [{
      title: '分析报告',
      body: message.content.trim() || buildExpandedWhy(message),
    }]
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
  buildDetailsSummary(getVisibleMessageDetails(message), message.processType)

const getAuditList = (auditSummary: DetailMap | undefined, key: 'keyPoints' | 'warnings' | 'blockers'): string[] =>
  Array.isArray(auditSummary?.[key])
    ? (auditSummary[key] as unknown[]).filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : []

const getDetailStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : []

const getBudgetLine = (label: string, value: unknown): { text: string; truncated: boolean } | null => {
  const budget = toDetailMap(value)
  const included = typeof budget?.included === 'number' ? budget.included : undefined
  const total = typeof budget?.total === 'number' ? budget.total : undefined
  const truncated = budget?.truncated === true
  if (typeof included !== 'number' && typeof total !== 'number') return null
  const countText = typeof included === 'number' && typeof total === 'number'
    ? `${included}/${total}`
    : String(included ?? total)
  return {
    text: `${label}：参考 ${countText} 条${truncated ? '，已精简显示' : ''}`,
    truncated,
  }
}

const getAgentSearchSummaryCards = (message: Message): AgentSearchSummaryCard[] => {
  const details = getMessageDetails(message)
  if (!details?.agentCore) return []

  const auditSummary = toDetailMap(details.auditSummary)
  const contextSources = toDetailMap(auditSummary?.contextSources)
  const candidateSource = toDetailMap(contextSources?.candidates)
  const query = toDetailMap(candidateSource?.query)
  const evidenceBudget = toDetailMap(details.agentEvidenceBudget)

  const keyword = typeof query?.keyword === 'string' && query.keyword.trim()
    ? query.keyword.trim()
    : ''
  const facets = getDetailStringArray(query?.facets).slice(0, 5)
  const recordCount = typeof candidateSource?.recordCount === 'number'
    ? candidateSource.recordCount
    : undefined
  const sourceAvailable = candidateSource?.available === true
  const sourceStatus = typeof candidateSource?.status === 'string' ? candidateSource.status : ''

  const searchLines = [
    keyword ? `检索词：${truncateText(keyword, 36)}` : '',
    facets.length > 0 ? `拆分关键词：${facets.map((item) => truncateText(item, 18)).join('、')}` : '',
    typeof recordCount === 'number'
      ? `候选源返回：${recordCount} 条`
      : candidateSource ? `候选源：${sourceAvailable ? '已读取' : sourceStatus || '未返回数量'}` : '',
  ].filter(Boolean)

  const budgetLines = [
    getBudgetLine('当前编排', evidenceBudget?.scheduleItems),
    getBudgetLine('候选证据', evidenceBudget?.candidates),
    getBudgetLine('历史样本', evidenceBudget?.latestHistoryItems),
  ].filter((item): item is { text: string; truncated: boolean } => Boolean(item))

  const cards: AgentSearchSummaryCard[] = []
  if (searchLines.length > 0) {
    cards.push({
      title: '候选检索',
      lines: searchLines,
      tone: typeof recordCount === 'number' && recordCount === 0 ? 'limited' : 'normal',
    })
  }
  if (budgetLines.length > 0) {
    cards.push({
      title: '参考信息',
      lines: budgetLines.map((item) => item.text),
      tone: budgetLines.some((item) => item.truncated) ? 'limited' : 'normal',
    })
  }
  return cards
}

const getAssistantProcessLines = (message: Message): string[] => {
  const details = getMessageDetails(message)
  const processSummary = getDetailStringArray(toDetailMap(details)?.assistantProcessSummary).slice(0, 2)
  if (processSummary.length > 0) return processSummary

  if (toDetailMap(details)?.missingLayoutDraft === true) {
    return ['已检查当前播单：暂无草案。']
  }

  const draftCompleteness = toDetailMap(toDetailMap(details)?.draftCompleteness)
  const draftStatus = typeof draftCompleteness?.status === 'string' ? draftCompleteness.status : ''
  if (draftStatus === 'partial') {
    return ['已检查草案：只覆盖部分时段。']
  }

  return []
}

const getAgentAuditCards = (message: Message): AgentAuditCard[] => {
  const auditSummary = toDetailMap(getMessageDetails(message)?.auditSummary)
  if (!auditSummary) return []

  const cards: AgentAuditCard[] = []
  const title = typeof auditSummary.title === 'string' ? auditSummary.title : ''
  const keyPoints = getAuditList(auditSummary, 'keyPoints').slice(0, 3)
  const basis = [title, ...keyPoints]
    .filter(Boolean)
    .map((item) => truncateText(item, 64))
    .join('；')
  if (basis) {
    cards.push({ title: '判断依据', body: basis, tone: 'basis' })
  }

  const blockers = getAuditList(auditSummary, 'blockers').slice(0, 2)
  if (blockers.length > 0) {
    cards.push({ title: '阻断原因', body: blockers.map((item) => truncateText(item, 64)).join('；'), tone: 'blocker' })
  }

  const warnings = getAuditList(auditSummary, 'warnings').slice(0, 2)
  if (warnings.length > 0) {
    cards.push({ title: '专业警示', body: warnings.map((item) => truncateText(item, 64)).join('；'), tone: 'warning' })
  }

  return cards
}

const hasExpandableExplanation = (message: Message) =>
  isDecisionMessage(message)
  && !(isLayoutImportDetails(getMessageDetails(message)) && !foregroundLayoutDraftEnabled)
  && (getExpandedSections(message).length > 0 || Boolean(getVisibleMessageDetails(message)))

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

const getPendingAtomicContextDetailItems = () => {
  const agentPendingTask = pendingAtomicContext.value?.agentPendingTask
  if (!agentPendingTask) return []
  return buildDetailsSummary({
    agentPendingLlmContext: buildPendingLlmContext(agentPendingTask, ''),
  }, 'planning')
}

const getAgentPendingConfirmationDetailItems = () => {
  const context = pendingAtomicContext.value
  const pendingTask = context?.agentPendingTask
  if (!context || !pendingTask) return []
  const details: Array<{ label: string; value: string }> = []
  const push = (label: string, value?: string | number | null) => {
    if (value === undefined || value === null || value === '') return
    details.push({ label, value: String(value) })
  }
  push('目标位置', formatAtomicSlotTime(context.slots.targetTime || context.slots.targetTimeHint))
  push('节目线索', context.slots.programName || context.slots.rawProgramText)
  push('替换目标', context.slots.replacementProgramName)
  push('候选数量', pendingTask.recommendations?.length)
  push('处理状态', formatPendingAgentTaskState(pendingTask.phase))
  return details
}

const patchPendingAgentTaskSelection = (
  selection:
    | { slot: 'candidateId'; value: string; rawText: string }
    | { slot: 'targetItemId'; value: string; rawText: string },
) => {
  const context = pendingAtomicContext.value
  const pendingTask = context?.agentPendingTask
  if (!context || !pendingTask) return false

  pendingAtomicContext.value = {
    ...context,
    selectedCandidateId: selection.slot === 'candidateId' ? selection.value : context.selectedCandidateId,
    selectedItemId: selection.slot === 'targetItemId' ? selection.value : context.selectedItemId,
    agentPendingTask: {
      ...pendingTask,
      collectedSlots: {
        ...pendingTask.collectedSlots,
        [selection.slot]: {
          value: selection.value,
          source: selection.slot === 'candidateId' ? 'candidate_selection' as const : 'user_followup' as const,
          confidence: 0.95,
          rawText: selection.rawText,
        },
      },
      missingSlots: pendingTask.missingSlots.filter((field) =>
        selection.slot === 'candidateId' ? field !== 'candidateId' : field !== 'targetItemId',
      ),
      ...(selection.slot === 'candidateId'
        ? {
            phase: 'needs_confirmation' as const,
            missingSlots: ['confirmation'],
            allowedActions: ['confirm', 'reject', 'start_new_task', 'cancel_pending'] as const,
          }
        : {}),
      updatedAt: new Date().toISOString(),
    },
  }
  return true
}

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
  value: RuntimePendingAtomicContext | null,
): MessageFocusTarget | undefined => {
  if (!value) return undefined
  if (value.phase !== 'selecting_target') return undefined

  const candidates = value.targetCandidates ?? []
  if (!candidates) return undefined

  const selectedItemId = value.selectedItemId
  const targetTime = value.slots.targetTime ?? value.slots.targetTimeHint ?? ''

  const selectedCandidate = selectedItemId
    ? candidates.find((candidate: RuntimeScheduleItem) => candidate.id === selectedItemId)
    : null
  const selectedTarget = extractFocusTargetFromRuntimeItem(selectedCandidate, 'active')
  if (selectedTarget) {
    return {
      ...selectedTarget,
      layer: 'intent',
    }
  }

  if (candidates.length === 1) {
    const soleTarget = extractFocusTargetFromRuntimeItem(candidates[0], 'active')
    if (soleTarget) {
      return {
        ...soleTarget,
        layer: 'intent',
      }
    }
  }

  const normalizedTargetTime = normalizeClockText(targetTime)
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
  const { columnName } = resolveMatchedColumnInfo(details)
  return columnName
}

const formatMatchedColumnPhrase = (details?: DetailMap) => {
  const matchedColumnText = formatMatchedColumnText(details)
  return matchedColumnText ? `栏目 ${matchedColumnText}` : '当前栏目'
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
      ? getEffectiveColumnDefinition(criteria.columnId)?.columnName ?? ''
      : ''
  const duration = formatExpectedDuration(criteria.expectedDuration)
  const result = [columnName, duration].filter(Boolean).join('，')
  return result ? `查询：${result}` : ''
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

const isNoCandidateCase = (details: DetailMap) => isNoCandidateDetailsCase(details)

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
    const diagnosticText = formatCandidateQueryDiagnosticText(details)
    return diagnosticText
      ? `${timeRange} ${diagnosticText}。`
      : `${timeRange} 按当前栏目和内容要求暂时没有找到合适节目。可以调整这一段的栏目或节目要求后继续补排。`
  }

  if (typeof details.summary === 'string') {
    return '已结合空窗位置、栏目要求和前后节目衔接生成建议，展开后可查看明细。'
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
    const diagnosticText = formatCandidateQueryDiagnosticText(details)
    return diagnosticText
      ? `${timeRange ? `${timeRange} 这段空窗` : '当前空窗'}已按${columnName || '当前栏目'}查找节目，${diagnosticText}。`
      : `${timeRange ? `${timeRange} 这段空窗` : '当前空窗'}已按${columnName || '当前栏目'}查找节目，但没有找到合适节目。`
  }

  if (typeof details.programName === 'string' && typeof details.itemId === 'string') {
    return `${timeRange ? `${timeRange} 这段空窗` : '当前空窗'}已完成候选判断和落表执行。`
  }

  if (typeof details.selectedCandidateName === 'string') {
    return `${timeRange ? `${timeRange} 这段空窗` : '当前空窗'}已在候选结果中选中《${details.selectedCandidateName}》。`
  }

  if (typeof details.candidateCount === 'number') {
    return `${timeRange ? `${timeRange} 这段空窗` : '当前空窗'}已按${columnName || matchedColumnPhrase}找到可用节目，正在继续判断。`
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
    const diagnosticText = formatCandidateQueryDiagnosticText(details)
    if (diagnosticText) {
      return timeRange ? `${timeRange} 未自动编排：${diagnosticText}。` : `未自动编排：${diagnosticText}。`
    }
    return timeRange ? `${timeRange} 未找到合适节目。` : '当前空窗未找到合适节目。'
  }

  if (typeof details.candidateCount === 'number') {
    const matchedColumnPhrase = formatMatchedColumnPhrase(details)
    return timeRange
      ? `${timeRange} 已找到 ${details.candidateCount} 个可用节目，来自${matchedColumnPhrase}。`
      : `已找到 ${details.candidateCount} 个可用节目，来自${matchedColumnPhrase}。`
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
    emitLatestRuntimeSchedule(result.data)
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
  if (!pendingCommand.value) return
  if (!isPendingReviewWorkspaceCurrent()) {
    expirePendingReviewForWorkspaceChange('当前待确认操作不属于这个工作区，已失效。请在当前播单重新发起操作。')
    return
  }
  const stepProgress = startStepProgress('执行中')
  try {
    const pending = pendingCommand.value
    pendingCommand.value = null
    pendingAtomicContext.value = null
    pendingReviewWorkspaceKey.value = null
    const result = await runtimeFacade.executePendingCommand({
      pendingCommand: pending,
      scheduleDate: props.date,
      channelId: props.channelId,
    })
    applyRuntimeExecutedResult(result, stepProgress.finish())
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
  const selectedItemId = pendingAtomicTargetSelectedItemId.value
  if (!selectedItemId) {
    ElMessage.warning('请先选择要操作的节目')
    return
  }
  if (!pendingAtomicContext.value) {
    ElMessage.warning('当前目标选择已失效，请重新发起操作。')
    return
  }
  if (!isPendingReviewWorkspaceCurrent()) {
    expirePendingReviewForWorkspaceChange('当前目标选择不属于这个工作区，已失效。请在当前播单重新发起操作。')
    return
  }
  if (pendingAtomicContext.value.agentPendingTask) {
    if (!patchPendingAgentTaskSelection({
      slot: 'targetItemId',
      value: selectedItemId,
      rawText: '界面确认目标节目',
    })) {
      ElMessage.warning('当前目标选择已失效，请重新发起操作。')
      return
    }
    await continuePendingAgentTask('确认', '确认目标中')
    return
  }
  const pendingTargetSelection = rehydratePendingTargetSelectionFromAtomicContext({
    ...pendingAtomicContext.value,
    selectedItemId,
  })
  if (!pendingTargetSelection) {
    ElMessage.warning('当前目标选择信息不完整，请重新发起操作。')
    return
  }
  const stepProgress = startStepProgress('确认目标中')
  try {
    const decision = await runtimeFacade.resolvePendingTargetSelection({
      channelId: props.channelId,
      date: props.date,
      scheduleState: buildCurrentRuntimeScheduleState(),
      pendingTargetSelection,
    })
    await applyRuntimeDecision(decision)
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

const confirmPendingInsertRecommendation = async () => {
  const selectedCandidateId = pendingAtomicInsertSelectedCandidateId.value
  const actionLabel = isPendingAtomicReplaceRecommendation() ? '替换' : '插入'
  if (!selectedCandidateId) {
    ElMessage.warning(`请先选择要${actionLabel}的节目`)
    return
  }
  if (!pendingAtomicContext.value) {
    ElMessage.warning(`当前${actionLabel}推荐已失效，请重新发起${actionLabel}指令。`)
    return
  }
  if (!isPendingReviewWorkspaceCurrent()) {
    expirePendingReviewForWorkspaceChange(`当前${actionLabel}推荐不属于这个工作区，已失效。请在当前播单重新发起${actionLabel}指令。`)
    return
  }
  if (pendingAtomicContext.value.agentPendingTask) {
    if (!patchPendingAgentTaskSelection({
      slot: 'candidateId',
      value: selectedCandidateId,
      rawText: `界面确认${actionLabel}候选`,
    })) {
      ElMessage.warning(`当前${actionLabel}推荐已失效，请重新发起${actionLabel}指令。`)
      return
    }
    await continuePendingAgentTask('确认', `确认${actionLabel}中`)
    return
  }
  const pendingInsertRecommendation = rehydratePendingInsertRecommendationFromAtomicContext({
    ...pendingAtomicContext.value,
    selectedCandidateId,
  })
  if (!pendingInsertRecommendation) {
    ElMessage.warning(`当前${actionLabel}推荐信息不完整，请重新发起${actionLabel}指令。`)
    return
  }
  const stepProgress = startStepProgress(`确认${actionLabel}中`)
  try {
    const decision = await runtimeFacade.resolvePendingInsertRecommendation({
      scheduleState: buildCurrentRuntimeScheduleState(),
      pendingInsertRecommendation,
    })
    await applyRuntimeDecision(decision)
    attachStepMetricToLatestAssistantMessage(stepProgress.finish())
  } catch (error) {
    messages.value.push(buildAssistantMessage({
      content: error instanceof Error ? error.message : `确认${actionLabel}节目失败，请稍后重试。`,
      processType: 'error',
      processTypeLabel: '执行异常',
      stepMetric: stepProgress.finish(),
    }))
  }
}

const continuePendingAgentTask = async (content: '确认' | '取消', progressLabel = '执行中') => {
  const isDraftResearchConfirmation = isDraftResearchConfirmationContext(pendingAtomicContext.value)
  const isFormalRebuildConfirmation = isFormalRebuildConfirmationContext(pendingAtomicContext.value)
  if (!pendingAtomicContext.value?.agentPendingTask && !pendingAtomicContext.value?.compositeTaskRun && !isDraftResearchConfirmation && !isFormalRebuildConfirmation) {
    ElMessage.warning('当前待确认操作已失效，请重新发起操作。')
    return
  }
  if (!isPendingReviewWorkspaceCurrent()) {
    expirePendingReviewForWorkspaceChange('当前待确认操作不属于这个工作区，已失效。请在当前播单重新发起操作。')
    return
  }
  if (isDraftResearchConfirmation) {
    if (content === '确认') {
      await processMessage('更新到草案', '更新草案中')
      return
    }
    await cancelPendingAtomicContext()
    return
  }
  if (isFormalRebuildConfirmation) {
    if (content === '确认') {
      await processMessage('确认重新编排', '重新编排中')
      return
    }
    await cancelPendingAtomicContext()
    return
  }
  await processMessage(content, progressLabel)
}

const confirmPendingAgentTask = async () => {
  await continuePendingAgentTask('确认')
}

const rejectPendingAgentTask = async () => {
  await continuePendingAgentTask('取消')
}

const cancelPendingCommand = async () => {
  if (!pendingCommand.value) return
  const summary = pendingCommand.value.summary.replace(/[，,。.!！?？]+$/u, '')
  const stepProgress = startStepProgress('思考中')
  try {
    messages.value.push(buildAssistantMessage({
      content: `${summary}，已取消执行。`,
      thinking: '我已根据你的选择停止这次高风险修改，不会对当前编排单做任何变更。',
      processType: 'general',
      processTypeLabel: '已取消',
      stepMetric: stepProgress.finish(),
    }))
    pendingCommand.value = null
    pendingAtomicContext.value = null
    pendingReviewWorkspaceKey.value = null
  } catch (error) {
    messages.value.push(buildAssistantMessage({
      content: error instanceof Error ? error.message : '取消执行失败，请稍后重试。',
      processType: 'error',
      processTypeLabel: '执行异常',
      stepMetric: stepProgress.finish(),
    }))
  }
}

const cancelPendingAtomicContext = async () => {
  if (!pendingAtomicContext.value) return
  const summary = formatPendingAtomicSummary(pendingAtomicContext.value).replace(/[，,。.!！?？]+$/u, '')
  const isDraftResearchConfirmation = isDraftResearchConfirmationContext(pendingAtomicContext.value)
  const isFormalRebuildConfirmation = isFormalRebuildConfirmationContext(pendingAtomicContext.value)
  const stepProgress = startStepProgress('思考中')
  try {
    messages.value.push(buildAssistantMessage({
      content: isDraftResearchConfirmation
        ? `${summary}，已取消更新草案。`
        : isFormalRebuildConfirmation
          ? `${summary}，已取消重新编排。`
          : `${summary}，已取消当前补参。`,
      thinking: isDraftResearchConfirmation
        ? '我已停止这次草案更新建议，不会改动左侧草案或正式播单。'
        : isFormalRebuildConfirmation
          ? '我已停止这次正式重排，当前播单不会被改动。'
          : '我已停止这次原子命令的后续补参，不会继续执行。',
      processType: 'general',
      processTypeLabel: '已取消',
      stepMetric: stepProgress.finish(),
    }))
    pendingAtomicContext.value = null
    pendingReviewWorkspaceKey.value = null
  } catch (error) {
    messages.value.push(buildAssistantMessage({
      content: error instanceof Error ? error.message : '取消补参失败，请稍后重试。',
      processType: 'error',
      processTypeLabel: '执行异常',
      stepMetric: stepProgress.finish(),
    }))
  }
}

const cancelPendingTargetSelection = async () => {
  if (pendingAtomicContext.value?.phase !== 'selecting_target') return
  const stepProgress = startStepProgress('思考中')
  try {
    const summary = formatPendingAtomicSummary(pendingAtomicContext.value)
    messages.value.push(buildAssistantMessage({
      content: `${summary}，已取消选择。`,
      thinking: '我已停止这次目标选择，不会继续执行后续修改。',
      processType: 'general',
      processTypeLabel: '已取消',
      stepMetric: stepProgress.finish(),
    }))
    pendingAtomicContext.value = null
    pendingReviewWorkspaceKey.value = null
  } catch (error) {
    messages.value.push(buildAssistantMessage({
      content: error instanceof Error ? error.message : '取消目标选择失败，请稍后重试。',
      processType: 'error',
      processTypeLabel: '执行异常',
      stepMetric: stepProgress.finish(),
    }))
  }
}

const cancelPendingInsertRecommendation = async () => {
  if (pendingAtomicContext.value?.phase !== 'recommending_insert') return
  const stepProgress = startStepProgress('思考中')
  try {
    const summary = formatPendingAtomicSummary(pendingAtomicContext.value)
    const actionLabel = isPendingAtomicReplaceRecommendation() ? '替换' : '插入'
    messages.value.push(buildAssistantMessage({
      content: `${summary}，已取消选择。`,
      thinking: `我已停止这次${actionLabel}推荐确认，不会继续执行后续${actionLabel}。`,
      processType: 'general',
      processTypeLabel: '已取消',
      stepMetric: stepProgress.finish(),
    }))
    pendingAtomicContext.value = null
    pendingReviewWorkspaceKey.value = null
  } catch (error) {
    messages.value.push(buildAssistantMessage({
      content: error instanceof Error ? error.message : '取消插入推荐失败，请稍后重试。',
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
    const diagnosticText = formatCandidateQueryDiagnosticText(details)
    if (diagnosticText) {
      return timeRange ? `空窗 ${timeRange} 未自动编排：${diagnosticText}` : `未自动编排：${diagnosticText}`
    }
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
    return `已找到 ${details.candidateCount} 个可用节目，来自${matchedColumnPhrase}`
  }

  if (details.criteria && typeof details.criteria === 'object') {
    const criteriaSummary = buildQueryCriteriaSummary(details.criteria as DetailMap)
    return criteriaSummary ? `正在按${criteriaSummary.replace(/^查询：/, '')}查找节目` : '正在查找合适节目'
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
    if (details.issueCount <= 0) return '校验完成，未发现问题'
    const summary = toDetailMap(details.summary)
    const breakdown = buildValidationIssueBreakdown(summary, details.issues)
    if (breakdown.riskCount > 0) {
      return `校验完成，发现 ${breakdown.riskCount} 个风险`
    }
    if (breakdown.noticeCount > 0) {
      return `校验完成，另有 ${breakdown.noticeCount} 个空窗或边界提示`
    }
    return `校验完成，发现 ${details.issueCount} 个问题`
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
    phase: pendingAtomicContext.value?.phase ?? '',
    summary: pendingAtomicContext.value?.summary ?? '',
    selectedItemId: pendingAtomicContext.value?.selectedItemId ?? '',
    targetTime: pendingAtomicContext.value
      ? `${pendingAtomicContext.value.slots.targetTime ?? ''}_${pendingAtomicContext.value.slots.targetTimeHint ?? ''}`
      : '',
    candidateIds: pendingAtomicContext.value
      ? (pendingAtomicContext.value.targetCandidates ?? []).map((candidate) => candidate.id).join('|')
      : '',
  }),
  () => {
    emitFocusTarget(buildPendingTargetSelectionFocusTarget(pendingAtomicContext.value))
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
    pendingCommand.value = null
    pendingAtomicContext.value = null
    pendingReviewWorkspaceKey.value = null
  },
  { immediate: true },
)

watch(
  () => ({
    isOrchestrating: isForegroundOrchestrationRunning.value,
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

    if (!isOrchestrating && interruptedCommandAfterCancel.value && !loading.value) {
      const nextContent = interruptedCommandAfterCancel.value
      interruptedCommandAfterCancel.value = null
      void processMessage(nextContent, '重新判断中')
    }

    if (!sessionId || !['completed', 'manual_review'].includes(status) || !props.orchestrationSession) {
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
    radial-gradient(circle at top left, rgba(100, 108, 255, 0.12), transparent 24%),
    linear-gradient(180deg, #ffffff 0%, #f8f9ff 100%);
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
  color: #ffffff;
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
  text-decoration-color: rgba(100, 108, 255, 0.28);
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
  color: var(--app-accent-deep);
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

.system-process-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding-left: 10px;
  border-left: 2px solid rgba(100, 108, 255, 0.18);
  color: #64748b;
}

.system-process-line {
  font-size: 12px;
  line-height: 1.45;
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
  color: var(--app-accent-deep);
}

.system-status-text.is-success {
  color: #475569;
}

.system-status-text.is-warning {
  color: var(--app-accent-deep);
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
  background: rgba(238, 242, 255, 0.9);
  border: 1px solid var(--app-line);
  color: var(--app-accent-deep);
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
  color: var(--app-accent-deep);
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

.playlist-file-card {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  margin-top: 10px;
  padding: 10px 12px;
  border: 1px solid #d8e2f3;
  border-radius: 8px;
  background: #f8fbff;
  color: #223046;
  text-align: left;
  cursor: pointer;
  transition: border-color 0.16s ease, background 0.16s ease;
}

.playlist-file-card:hover {
  border-color: #8bb6ff;
  background: #f1f7ff;
}

.playlist-file-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: #e8f1ff;
  color: #2563eb;
  flex: 0 0 auto;
}

.playlist-file-main {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 2px;
}

.playlist-file-title {
  font-size: 13px;
  font-weight: 700;
  line-height: 1.4;
}

.playlist-file-meta {
  overflow: hidden;
  color: #6b7a90;
  font-size: 12px;
  line-height: 1.4;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.playlist-file-action {
  color: #2563eb;
  font-size: 12px;
  font-weight: 600;
  flex: 0 0 auto;
}

.user-bubble .message-text {
  color: #ffffff;
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

.explanation-section.is-layout-analysis-report {
  display: block;
}

.explanation-title {
  flex: 0 0 auto;
  min-width: 28px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0;
  color: var(--app-text-muted);
  line-height: 1.7;
}

.explanation-content {
  flex: 1;
  font-size: 13px;
  line-height: 1.7;
  color: #334155;
  white-space: pre-wrap;
  word-break: break-word;
}

.analysis-report-content {
  display: flex;
  flex-direction: column;
  gap: 14px;
  white-space: normal;
  width: 100%;
}

.analysis-report-paragraph {
  line-height: 1.82;
}

.analysis-report-label {
  display: inline;
  font-weight: 700;
  color: #1f2937;
}

.analysis-report-label.is-risk {
  color: #b91c1c;
}

.analysis-report-body {
  white-space: pre-wrap;
  word-break: break-word;
}

.explanation-section.is-secondary .explanation-content {
  color: #475569;
}

.explanation-section.is-risk .explanation-content {
  color: #b91c1c;
}

.agent-audit-panel {
  padding-top: 10px;
  border-top: 1px solid rgba(226, 232, 240, 0.75);
}

.agent-audit-list {
  display: grid;
  gap: 6px;
  margin-top: 8px;
}

.agent-audit-card {
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr);
  gap: 8px;
  align-items: start;
  padding: 8px 10px;
  border: 1px solid #e2e8f0;
  border-left-width: 3px;
  border-radius: 6px;
  background: #fff;
}

.agent-audit-card.is-basis {
  border-left-color: #2563eb;
}

.agent-audit-card.is-warning {
  border-left-color: #535bf2;
  background: #eef2ff;
}

.agent-audit-card.is-blocker {
  border-left-color: #dc2626;
  background: #fef2f2;
}

.agent-audit-title {
  color: #475569;
  font-size: 11px;
  font-weight: 700;
  line-height: 1.6;
}

.agent-audit-body {
  color: #334155;
  font-size: 12px;
  line-height: 1.6;
  word-break: break-word;
}

.agent-search-panel {
  padding-top: 10px;
  border-top: 1px solid rgba(226, 232, 240, 0.75);
}

.agent-search-panel.is-inline {
  width: 100%;
  padding-top: 6px;
  border-top: 0;
}

.agent-search-list {
  display: grid;
  gap: 8px;
  margin-top: 8px;
}

.agent-search-card {
  display: grid;
  gap: 5px;
  padding: 8px 10px;
  border: 1px solid #dbeafe;
  border-radius: 6px;
  background: #f8fbff;
}

.agent-search-card.is-limited {
  border-color: var(--app-line-strong);
  background: var(--app-accent-tint);
}

.agent-search-title {
  color: #1e40af;
  font-size: 11px;
  font-weight: 700;
  line-height: 1.5;
}

.agent-search-card.is-limited .agent-search-title {
  color: var(--app-accent-deep);
}

.agent-search-lines {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.agent-search-line {
  color: #334155;
  font-size: 12px;
  line-height: 1.55;
  word-break: break-word;
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
  color: var(--app-accent-deep);
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
  color: var(--app-text-muted);
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
  border: 1px solid var(--app-line-strong);
  border-left: 3px solid var(--app-accent);
  border-radius: 10px;
  background: rgba(238, 242, 255, 0.7);
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
  color: var(--app-accent-deep);
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

.pending-command-guidance {
  margin-top: 8px;
  padding: 8px 10px;
  border-left: 3px solid var(--app-accent);
  border-radius: 6px;
  background: var(--app-accent-tint);
  color: #374151;
  font-size: 12px;
  line-height: 1.65;
}

.pending-command-context-note {
  margin-top: 8px;
  color: #475569;
  font-size: 12px;
  line-height: 1.65;
}

.pending-quick-replies {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}

.pending-quick-replies :deep(.el-button) {
  margin-left: 0;
  border-color: var(--app-line-strong);
  background: var(--app-accent-tint);
  color: var(--app-accent-deep);
}

.pending-command-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 0 14px 12px;
}

.target-selection-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 14px;
}

:deep(.target-selection-list .el-radio) {
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

:deep(.target-selection-list .el-radio:hover) {
  border-color: rgba(100, 108, 255, 0.38);
  background: rgba(255, 255, 255, 0.96);
  transform: translateY(-1px);
}

:deep(.target-selection-list .el-radio.is-checked) {
  border-color: rgba(100, 108, 255, 0.52);
  background: linear-gradient(180deg, rgba(248, 249, 255, 0.98) 0%, rgba(238, 242, 255, 0.92) 100%);
  box-shadow: 0 18px 30px -24px rgba(83, 91, 242, 0.42);
}

:deep(.target-selection-list .el-radio__input) {
  flex: 0 0 auto;
  margin-top: 3px;
}

:deep(.target-selection-list .el-radio__label) {
  flex: 1;
  min-width: 0;
  padding-left: 12px;
  color: #334155;
  font-size: 13px;
  line-height: 1.6;
  white-space: normal;
  word-break: break-word;
}

:deep(.target-selection-list .el-radio__input .el-radio__inner:hover) {
  border-color: var(--app-accent);
}

:deep(.target-selection-list .el-radio__input.is-checked .el-radio__inner) {
  border-color: var(--app-accent);
  background: var(--app-accent);
}

.insert-recommendation-panel {
  border-color: rgba(100, 108, 255, 0.38);
  background: linear-gradient(180deg, rgba(248, 249, 255, 0.96) 0%, rgba(238, 242, 255, 0.94) 100%);
  box-shadow: 0 24px 36px -30px rgba(83, 91, 242, 0.4);
}

.insert-recommendation-panel .pending-command-header {
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

.layout-draft-feasibility-warning {
  margin-top: 10px;
  padding: 8px 10px;
  border: 1px solid var(--app-line-strong);
  border-radius: 6px;
  background: rgba(238, 242, 255, 0.86);
  color: var(--app-accent-deep);
  font-size: 12px;
  line-height: 1.5;
}

.layout-draft-strategy {
  margin-top: 10px;
  padding: 8px 10px;
  border: 1px solid rgba(59, 130, 246, 0.18);
  border-radius: 6px;
  background: rgba(239, 246, 255, 0.72);
  color: #1e3a8a;
  font-size: 12px;
  line-height: 1.5;
}

.layout-draft-strategy-head {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}

.layout-draft-strategy-name {
  display: inline-block;
  color: #1d4ed8;
  font-weight: 600;
}

.layout-draft-strategy-facts {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}

.layout-draft-strategy-fact {
  display: inline-flex;
  max-width: 100%;
  padding: 2px 6px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.78);
  color: #1e40af;
  line-height: 1.4;
  word-break: break-word;
}

.layout-draft-segment-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid var(--app-line);
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
  color: var(--app-accent-deep);
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

.layout-draft-segment-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #64748b;
  font-size: 12px;
  line-height: 1.4;
}

.layout-draft-segment-status {
  color: var(--app-accent-deep);
  font-weight: 600;
}

.layout-draft-segment-status.is-warning {
  color: var(--app-accent-deep);
}

.layout-draft-segment-status.is-blocked {
  color: #b91c1c;
}

.layout-draft-segment-reason {
  color: #7f1d1d;
  font-size: 12px;
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

.layout-file-input {
  display: none;
}

.input-area {
  padding: 18px;
  border-top: 1px solid var(--app-line);
  background: rgba(255, 255, 255, 0.92);
}

.input-shell {
  position: relative;
  min-height: 86px;
  border: 1px solid #dbe4f0;
  border-radius: 14px;
  background: #ffffff;
  box-shadow: 0 14px 32px -28px rgba(83, 91, 242, 0.45);
  transition:
    border-color 0.18s ease,
    box-shadow 0.18s ease,
    background 0.18s ease;
}

.input-shell:focus-within {
  border-color: rgba(100, 108, 255, 0.58);
  box-shadow:
    0 0 0 3px rgba(100, 108, 255, 0.12),
    0 18px 36px -30px rgba(83, 91, 242, 0.55);
}

.input-shell.is-busy {
  background: #fbfcff;
}

.message-input {
  display: block;
}

.message-input :deep(.el-textarea__inner) {
  min-height: 76px;
  padding: 13px 58px 42px 14px;
  border: 0;
  border-radius: 14px;
  box-shadow: none;
  resize: none;
  background: transparent;
  color: #1f2937;
  line-height: 1.6;
}

.message-input :deep(.el-textarea__inner:focus) {
  box-shadow: none;
}

.input-control-row {
  position: absolute;
  right: 10px;
  bottom: 9px;
  left: 10px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  pointer-events: none;
}

.input-icon-button,
.send-action-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  appearance: none;
  cursor: pointer;
  pointer-events: auto;
  transition:
    background 0.16s ease,
    color 0.16s ease,
    transform 0.16s ease,
    opacity 0.16s ease;
}

.input-icon-button .el-icon,
.send-action-button .el-icon {
  font-size: 16px;
}

.input-icon-button {
  width: 28px;
  height: 28px;
  border-radius: 999px;
  background: transparent;
  color: #64748b;
}

.input-icon-button:hover:not(:disabled) {
  background: var(--app-accent-tint);
  color: var(--app-accent-deep);
}

.input-icon-button.is-loading {
  color: var(--app-accent-deep);
}

.send-action-button {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: var(--app-accent);
  color: #ffffff;
  box-shadow: 0 10px 24px -14px rgba(83, 91, 242, 0.7);
}

.send-action-button:hover:not(:disabled) {
  background: var(--app-accent-deep);
  transform: translateY(-1px);
}

.send-action-button:disabled,
.input-icon-button:disabled {
  cursor: default;
  opacity: 0.42;
}

.send-action-button.is-stop {
  background: #ef4444;
  box-shadow: 0 10px 24px -14px rgba(239, 68, 68, 0.7);
}

.stop-square {
  width: 11px;
  height: 11px;
  border-radius: 3px;
  background: currentColor;
}

@media (max-width: 768px) {
  .messages-container,
  .quick-actions,
  .input-area {
    padding-left: 14px;
    padding-right: 14px;
  }

  .input-area {
    padding-bottom: 14px;
  }

  .agent-audit-card {
    grid-template-columns: 1fr;
    gap: 2px;
  }

  .candidate-comparison-item {
    padding: 8px 0;
  }

  .candidate-comparison-note {
    line-height: 1.6;
  }
}
</style>
