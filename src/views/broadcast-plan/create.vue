<template>
  <div class="create-schedule-page">
    <!-- 顶部信息栏 -->
    <div class="page-header">
      <div class="header-breadcrumb">
        <el-button link :icon="ArrowLeft" class="back-button" @click="handleBack">返回</el-button>
      </div>
      <el-form
        ref="headerFormRef"
        :model="scheduleForm"
        :rules="headerFormRules"
        inline
        status-icon
        class="schedule-info-form"
      >
        <el-form-item label="频道" prop="channelId" required>
          <el-select
            v-model="scheduleForm.channelId"
            placeholder="请选择频道"
            style="width: 140px"
            :disabled="isHeaderFieldsDisabled"
            @change="handleChannelChange"
          >
            <el-option
              v-for="channel in channelOptions"
              :key="channel.id"
              :label="channel.name"
              :value="channel.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="日期" prop="date" required>
          <el-date-picker
            v-model="scheduleForm.date"
            type="date"
            placeholder="选择日期"
            value-format="YYYY-MM-DD"
            style="width: 144px"
            :disabled="isHeaderFieldsDisabled"
          />
        </el-form-item>
      </el-form>
      <div class="broadcast-window-chip">
        <span class="broadcast-window-label">播出时段</span>
        <span class="broadcast-window-value">{{ currentBroadcastWindowText }}</span>
      </div>
    </div>

    <!-- 主内容区：左侧表格 + 右侧 AI 侧边栏 -->
    <div class="content-wrapper" :class="{ 'with-ai-sidebar': aiSidebarVisible }">
      <!-- 左侧：节目单编辑区 -->
      <div class="schedule-content">
        <!-- 时间轴表格区 -->
        <div class="timeline-container">
          <!-- 时间轴头部 -->
          <div class="timeline-header">
            <div class="timeline-header-left">
              <div class="timeline-heading">
                <h2 class="timeline-title">时间轴与素材清单</h2>
              </div>
              <div class="timeline-action-group">
                <el-button
                  v-if="!isViewMode && !scheduleForm.isLocked"
                  type="primary"
                  :icon="Plus"
                  :disabled="allowedDialogTypes.length === 0"
                  @click="handleAddItem"
                >
                  添加节目
                </el-button>
                <el-button
                  v-if="orchestratorRuntime.canCancel.value"
                  type="danger"
                  @click="handleCancelOrchestration"
                >
                  中止编排
                </el-button>
              </div>
            </div>
            <div class="timeline-header-right">
              <span class="stats-text">
                共 {{ displayItems.length }} {{ displayItemUnitLabel }}，总时长 {{ totalDurationText }}
              </span>
              <el-tag
                v-if="unlinkedItemCount > 0"
                type="danger"
                effect="light"
                size="small"
                class="header-alert-tag"
              >
                <el-icon><WarningFilled /></el-icon>
                未关联成品 {{ unlinkedItemCount }} 条
              </el-tag>
              <el-tag
                v-if="emptyMaterialItemCount > 0"
                type="danger"
                effect="light"
                size="small"
                class="header-alert-tag"
              >
                <el-icon><WarningFilled /></el-icon>
                空成品 {{ emptyMaterialItemCount }} 条
              </el-tag>
              <el-popover
                v-if="displayGapCount > 0"
                placement="bottom-end"
                :width="320"
                trigger="click"
                popper-class="continuity-popper"
              >
                <template #reference>
                  <el-tag
                    type="danger"
                    effect="light"
                    size="small"
                    class="header-alert-tag"
                  >
                    <el-icon><WarningFilled /></el-icon>
                    {{ gapSummaryLabel }} {{ displayGapCount }} 条
                  </el-tag>
                </template>
                <div class="continuity-popover">
                  <div
                    v-for="gap in displayGapEntries"
                    :key="gap.id"
                    class="continuity-item"
                    @click="handleFocusGapEntry(gap)"
                  >
                    <div class="continuity-text">
                      缺失时间：{{ formatTime4(gap.from) }} - {{ formatTime4(gap.to) }}
                    </div>
                    <div class="continuity-actions">
                      <el-tag
                        v-if="gap.source === 'runtime'"
                        :type="getGapEntryTagType(gap.status)"
                        effect="light"
                        size="small"
                      >
                        {{ getGapEntryStatusText(gap.status) }}
                      </el-tag>
                      <el-button
                        v-else
                        class="gap-fix-btn"
                        type="primary"
                        size="small"
                        @click.stop="openAddItemForGap(gap)"
                      >
                        补齐
                      </el-button>
                    </div>
                  </div>
                </div>
              </el-popover>
              <el-popover
                v-if="overlapConflicts.length > 0"
                placement="bottom-end"
                :width="320"
                trigger="click"
                popper-class="continuity-popper"
              >
                <template #reference>
                  <el-tag
                    type="danger"
                    effect="light"
                    size="small"
                    class="header-alert-tag"
                  >
                    <el-icon><WarningFilled /></el-icon>
                    时间冲突 {{ overlapConflicts.length }} 处
                  </el-tag>
                </template>
                <div class="continuity-popover">
                  <div
                    v-for="conflict in overlapConflicts"
                    :key="conflict.id"
                    class="continuity-item is-clickable"
                    @click="handleFocusConflict(conflict)"
                  >
                    <div class="continuity-text">
                      {{ formatTime4(conflict.startTime) }} - {{ formatTime4(conflict.endTime) }} 存在重叠
                    </div>
                    <div class="continuity-actions">
                      <el-tag type="danger" effect="light" size="small">定位</el-tag>
                    </div>
                  </div>
                </div>
              </el-popover>
            </div>
          </div>
          <div class="timeline-insight-bar">
            <div class="insight-group">
              <span class="insight-label">当前视图</span>
              <span class="insight-pill">{{ isViewMode ? '查看模式' : '编辑模式' }}</span>
              <span class="insight-pill">{{ currentChannelName }}</span>
              <span class="insight-pill">{{ scheduleDate }}</span>
            </div>
            <div class="insight-group is-risk">
              <span class="insight-label">风险概览</span>
              <span class="insight-pill" :class="{ 'is-danger': unlinkedItemCount > 0 }">
                未关联 {{ unlinkedItemCount }}
              </span>
              <span class="insight-pill" :class="{ 'is-danger': emptyMaterialItemCount > 0 }">
                空成品 {{ emptyMaterialItemCount }}
              </span>
              <span class="insight-pill" :class="{ 'is-warning': displayGapCount > 0 }">
                空窗 {{ displayGapCount }}
              </span>
            </div>
          </div>
          <!-- 时间轴主体 -->
          <div class="timeline-body" ref="timelineBodyRef">
            <!-- 表格内容 -->
            <div
              class="timeline-content"
              ref="timelineContentRef"
              @scroll="handleTimelineContentScroll"
              @click="handleTimelineAreaClick"
            >
              <div class="timeline-table-header">
                <div class="header-cell index-cell">序号</div>
                <div class="header-cell start-time-cell">起始时间</div>
                <div class="header-cell end-time-cell">结束时间</div>
                <div class="header-cell type-cell">类型</div>
                <div class="header-cell content-type-cell">内容类型</div>
                <div class="header-cell episode-cell">节目名称</div>
                <div class="header-cell relative-start-cell">相对播出点</div>
                <div class="header-cell play-length-cell">播出长度</div>
                <div class="header-cell program-code-cell">节目编号</div>
                <div class="header-cell key-slot-cell">键位</div>
                <div class="header-cell material-cell">素材文件</div>
                <div class="header-cell status-cell">素材状态</div>
                <div class="header-cell studio-cell">演播室</div>
                <div class="header-cell overdue-cell">是否超期</div>
                <div class="header-cell omni-right-cell">全媒体播出权利</div>
                <div class="header-cell remark-cell">备注</div>
                <div class="header-cell third-review-date-cell">三审完成日期</div>
                <div class="header-cell last-playable-time-cell">最后可播时间</div>
                <div class="header-cell rebroadcast-reaudit-date-cell">重播重审日期</div>
              </div>

              <!-- 节目列表 -->
              <div ref="scheduleItemsWrapperRef" class="schedule-items-wrapper" @click="handleEmptyAreaClick">
                <div
                  v-if="floatingFocusMarkerVisible"
                  class="floating-focus-marker"
                  :class="{
                    'is-point': focusRuntime.isPointAnchor.value,
                    'is-success': focusRuntime.currentLayer.value === 'result',
                    'is-error': focusRuntime.currentLayer.value === 'issue',
                  }"
                  :style="floatingFocusMarkerStyle"
                />
                <div
                  v-if="focusBannerVisible"
                  class="focus-range-marker"
                  :class="{
                    'is-success': focusRuntime.status.value === 'success',
                    'is-error': focusRuntime.status.value === 'error',
                  }"
                  :style="focusMarkerStyle"
                />
                <div
                  v-for="conflict in overlapConflictMarkers"
                  :key="conflict.id"
                  class="conflict-range-marker"
                  :style="{ top: `${conflict.top}px` }"
                  @click.stop="handleFocusConflict(conflict)"
                />
                <div v-if="displayItems.length === 0" class="empty-state">
                  <el-empty description="暂无节目安排">
                    <el-button
                      v-if="!isViewMode && !scheduleForm.isLocked"
                      type="primary"
                      @click="handleAddItem"
                    >
                      添加第一个节目
                    </el-button>
                  </el-empty>
                </div>

                <div
                  v-for="(item, index) in displayItems"
                  :key="item.id"
                  class="schedule-item-row"
                  :ref="(element) => registerItemRowRef(item.id, element)"
                  :data-item-id="item.id"
                  :class="{
                    'is-program': item.businessType === 'program',
                    'is-ad': item.businessType === 'ad',
                    'is-promo': item.businessType === 'promo',
                    'is-reference': item.isReference,
                    'is-unlinked': item.isUnlinkedProduct || shouldWarnEmptyMaterialFields(item),
                    'is-section-disabled': !canEditSection(item) && !item.isReference,
                    'is-focus-active': isFocusActive(item.id),
                    'is-focus-recent': isFocusRecent(item.id),
                    'is-focus-error': isFocusError(item.id),
                    'is-time-conflict': isTimeConflictItem(item.id),
                  }"
                  @click="handleItemClick(item)"
                >
                  <!-- 序号 -->
                  <div class="item-cell index-cell">
                    <span class="index-number">{{ index + 1 }}</span>
                  </div>

                  <!-- 时间显示 -->
                  <div class="item-cell start-time-cell">
                    <span class="time-text">{{ formatTime4(item.startTime) }}</span>
                  </div>

                  <div class="item-cell end-time-cell">
                    <span class="time-text">{{ formatTime4(item.endTime) }}</span>
                  </div>

                  <!-- 类型 -->
                  <div class="item-cell type-cell">
                    <el-tag
                      v-if="!item.isUnlinkedProduct"
                      :type="getTypeTagType(item)"
                      effect="light"
                      size="small"
                    >
                      {{ getTypeText(item) }}
                    </el-tag>
                    <span v-else class="small-text">-</span>
                  </div>

                  <!-- 内容类型 -->
                  <div class="item-cell content-type-cell">
                    <el-tag
                      v-if="!item.isUnlinkedProduct"
                      :type="getContentTypeTagType(item)"
                      effect="light"
                      size="small"
                    >
                      {{ getContentTypeText(item) }}
                    </el-tag>
                    <span v-else class="small-text">-</span>
                  </div>

                  <!-- 节目名称（本集名称） -->
                  <div class="item-cell episode-cell">
                    <div class="episode-name" :class="{ 'is-reference': item.isReference }">
                      <el-icon v-if="item.isReference" class="reference-icon"><View /></el-icon>
                      {{ item.instanceName || '-' }}
                    </div>
                  </div>

                  <div class="item-cell relative-start-cell">
                    <span
                      v-if="shouldShowMaterialFields(item)"
                      class="small-text"
                      :class="{
                        'warning-text':
                          (item.isUnlinkedProduct || shouldWarnEmptyMaterialFields(item)) && !item.relativeStart
                      }"
                    >
                      {{ item.relativeStart || '-' }}
                    </span>
                    <span v-else class="small-text">-</span>
                  </div>

                  <div class="item-cell play-length-cell">
                    <span
                      v-if="shouldShowMaterialFields(item)"
                      class="small-text"
                      :class="{
                        'warning-text':
                          (item.isUnlinkedProduct || shouldWarnEmptyMaterialFields(item)) && !item.playLength
                      }"
                    >
                      {{ item.playLength || '-' }}
                    </span>
                    <span v-else class="small-text">-</span>
                  </div>

                  <div class="item-cell program-code-cell">
                    <span class="small-text">{{ item.programCode || '-' }}</span>
                  </div>

                  <div class="item-cell key-slot-cell">
                    <span class="small-text">{{ item.keySlot || '-' }}</span>
                  </div>

                  <div class="item-cell material-cell">
                    <span
                      v-if="shouldShowMaterialFields(item)"
                      class="small-text"
                      :class="{
                        'warning-text':
                          (item.isUnlinkedProduct || shouldWarnEmptyMaterialFields(item)) && !item.materialName
                      }"
                    >
                      {{ item.materialName || '-' }}
                    </span>
                    <span v-else class="small-text">-</span>
                  </div>

                  <div class="item-cell status-cell">
                    <el-tag
                      v-if="shouldShowMaterialFields(item)"
                      :type="getMaterialStatusType(item.materialStatus || '')"
                      size="small"
                    >
                      {{ getMaterialStatusText(item.materialStatus || '') }}
                    </el-tag>
                    <span v-else class="small-text">-</span>
                  </div>

                  <div class="item-cell studio-cell">
                    <span class="small-text">{{ item.studio || '-' }}</span>
                  </div>

                  <div class="item-cell overdue-cell">
                    <span class="small-text">{{ item.isOverdue ? '是' : '否' }}</span>
                  </div>

                  <div class="item-cell omni-right-cell">
                    <span class="small-text">{{ item.omniBroadcastRight || '-' }}</span>
                  </div>

                  <div class="item-cell remark-cell">
                    <span class="small-text">{{ item.remark || '-' }}</span>
                  </div>

                  <div class="item-cell third-review-date-cell">
                    <span class="small-text">{{ item.thirdReviewDate || '-' }}</span>
                  </div>

                  <div class="item-cell last-playable-time-cell">
                    <span class="small-text">{{ item.lastPlayableTime || '-' }}</span>
                  </div>

                  <div class="item-cell rebroadcast-reaudit-date-cell">
                    <span class="small-text">{{ item.rebroadcastReauditDate || '-' }}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 右侧：AI 助手侧边栏 -->
      <div v-if="aiSidebarVisible" class="ai-sidebar">
        <div class="ai-sidebar-header">
          <div class="ai-sidebar-heading">
            <h3 class="ai-sidebar-title">
              <el-icon><ChatDotRound /></el-icon>
              AI 助手
            </h3>
            <p class="ai-sidebar-subtitle">围绕当前频道、日期和时间空窗，直接补齐、调整或校验编单。</p>
          </div>
          <div class="ai-sidebar-actions">
            <el-button link @click="llmConfigVisible = true">
              <el-icon><Setting /></el-icon>
              LLM配置
            </el-button>
            <el-button link @click="aiSidebarVisible = false">
              <el-icon><Close /></el-icon>
            </el-button>
          </div>
        </div>
        <div class="ai-sidebar-content">
          <ChatPanel
            :current-schedule="chatScheduleItems"
            :channel-id="currentChannelId"
            :channel-name="currentChannelName"
            :date="scheduleDate"
            :gap-count="displayGapCount"
            :orchestration-logs="orchestratorRuntime.logs.value"
            :orchestration-session="orchestratorRuntime.session.value"
            :is-orchestrating="orchestratorRuntime.isRunning.value"
            :can-interrupt="orchestratorRuntime.canCancel.value"
            @command-executed="handleChatCommandExecuted"
            @schedule-updated="handleChatScheduleUpdated"
            @orchestrate-requested="handleChatOrchestrateRequested"
            @cancel-requested="handleCancelOrchestration"
            @focus-requested="handleChatFocusRequested"
            @layout-draft-updated="handleChatLayoutDraftUpdated"
          />
          <OpenClawDemoPanel :adapter="openClawHostAdapter" />
        </div>
      </div>
    </div>

    <!-- 节目项编辑对话框 -->
    <ScheduleItemDialog
      v-model="dialogVisible"
      :item="editingItem"
      :schedule-date="scheduleForm.date"
      :channel-id="scheduleForm.channelId"
      :max-sort-order="maxSortOrder"
      :default-start-time="gapDialogDefaults?.startTime"
      :default-end-time="gapDialogDefaults?.endTime"
      :default-sort-order="gapDialogDefaults?.sortOrder"
      :allowed-types="allowedDialogTypes"
      @save="handleSaveItem"
      @delete="handleDeleteItemById"
    />
    <el-dialog v-model="llmConfigVisible" title="LLM 配置" width="520px" destroy-on-close>
      <LLMConfigPanel />
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
defineOptions({
  name: 'BroadcastPlanCreate',
})

import { ref, computed, onMounted, nextTick, watch, onBeforeUnmount, type CSSProperties } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  ArrowLeft,
  Plus,
  View,
  WarningFilled,
  ChatDotRound,
  Close,
  Setting,
} from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus'
import ScheduleItemDialog from './components/ScheduleItemDialog.vue'
import { getStudiosByChannelId } from '@/data/channel-studio-map'
import { getBroadcastPlanPermission, type BroadcastSection } from '@/views/broadcast-plan/permissions'
import {
  type ScheduleItem,
  type CollaborativeScheduleDetail,
  getScheduleDetail,
  generateImportedScheduleItems,
  generateId,
  getProgramTypeName,
  materialStatusText,
  materialStatusType,
  timeToMinutes,
  getTimeDiff
} from './scheduleData'
import { demoBaseDate } from '@/mock/demoData'
import { layoutReferenceData } from './layoutReferenceData'
import {
  mapAtomicItemToPageItem,
  mapPageItemToAtomicSnapshot,
  mapScheduleItemToChatSchedule,
} from './broadcastPlanScheduleBridge'
import {
  buildDisplayGapEntries,
  buildRuntimeGapEntries,
  buildTimeDiscontinuities,
  resolveGapSummaryLabel,
} from './broadcastPlanGapState'
import type { GapEntry, TimeDiscontinuity } from './broadcastPlanGapState'
import {
  buildReferenceItems,
  countEmptyMaterialItems,
  countUnlinkedItems,
  selectDisplayItems,
  sortScheduleItems,
} from './broadcastPlanViewState'
import { useBroadcastPlanEditor } from './useBroadcastPlanEditor'
import { useBroadcastPlanOrchestration } from './useBroadcastPlanOrchestration'
import { useBroadcastPlanFocus, type FocusAnchor } from './useBroadcastPlanFocus'

type OverlapConflict = {
  id: string
  message: string
  primaryItemId: string
  secondaryItemId: string
  startTime: string
  endTime: string
}

// AI 编排相关导入
import { getAtomicCapabilities } from '@/services/atomicCapabilities'
import { getScheduleCommandBus } from '@/services/scheduleCommandBus'
import { getManualCommandAdapter } from '@/services/manualCommandAdapter'
import { getCandidateService } from '@/services/candidateService'
import { getDataService } from '@/services/orchestration/dataService'
import { getOpenClawHostAdapter } from '@/services/openclaw/openClawHostAdapter'
import type { GapProcessingStatus } from '@/types/orchestration'
import type { LayoutDraft, ValidationReport, ValidationIssue } from '@/types/orchestration'
import ChatPanel from '@/components/dialogue/ChatPanel.vue'
import LLMConfigPanel from '@/components/llm/LLMConfigPanel.vue'
import OpenClawDemoPanel from './components/OpenClawDemoPanel.vue'
import { getScheduleValidationService } from '@/services/scheduleValidationService'

const route = useRoute()
const router = useRouter()

// 页面模式
const isViewMode = computed(() => route.query.mode === 'view')

const isHeaderFieldsDisabled = computed(() => {
  return isViewMode.value || Boolean(route.params.id) || Boolean(scheduleForm.value.isLocked)
})

const scheduleDate = computed<string>(() => scheduleForm.value.date || demoBaseDate)
const currentChannelId = computed<string>(() => scheduleForm.value.channelId || 'dragon')
const currentChannelName = computed<string>(() => scheduleForm.value.channelName || '东方卫视')

// 频道选项
const channelOptions = ref([
  { id: 'dragon', name: '东方卫视' },
  { id: 'news', name: '新闻综合' },
  { id: 'finance', name: '第一财经' },
  { id: 'sports', name: '五星体育' },
  { id: 'doc', name: '纪实人文' },
  { id: 'cartoon', name: '哈哈炫动' }
])

// 编单表单
const scheduleForm = ref<Partial<CollaborativeScheduleDetail>>({
  id: '',
  name: '',
  channelId: '',
  channelName: '',
  date: '',
  editor: '当前用户',
  editorId: 'current-user',
  status: 'draft',
  isLocked: false,
  items: []
})

const headerFormRef = ref<FormInstance>()
const headerFormRules: FormRules = {
  name: [{ required: true, message: '请输入编单名称', trigger: 'blur' }],
  channelId: [{ required: true, message: '请选择所属频道', trigger: 'change' }],
  date: [{ required: true, message: '请选择日期', trigger: 'change' }]
}

// 编单项列表
const scheduleItems = ref<ScheduleItem[]>([])

const permission = computed(() => getBroadcastPlanPermission('editor'))

const getItemSection = (item: Pick<ScheduleItem, 'sourceType' | 'businessType'>): BroadcastSection => {
  if (item.sourceType === 'live') return 'live'
  if (item.businessType === 'ad') return 'ad'
  return 'recorded'
}

const allowedDialogTypes = computed<Array<'record' | 'live' | 'ad'>>(() => {
  const list: Array<'record' | 'live' | 'ad'> = []
  if (permission.value.recorded) list.push('record')
  if (permission.value.live) list.push('live')
  if (permission.value.ad) list.push('ad')
  return list
})

const canEditSection = (item: Pick<ScheduleItem, 'sourceType' | 'businessType'>): boolean => {
  const section = getItemSection(item)
  return Boolean(permission.value[section])
}

const currentStudioOptions = computed(() => getStudiosByChannelId(currentChannelId.value))

const shouldShowMaterialFields = (item: Pick<ScheduleItem, 'sourceType' | 'businessType'>) => {
  return item.sourceType === 'record' && (item.businessType === 'program' || item.businessType === 'ad')
}

const shouldWarnEmptyMaterialFields = (item: ScheduleItem) => {
  if (item.isUnlinkedProduct) return false
  if (!shouldShowMaterialFields(item)) return false
  return Boolean(item.isMaterialInfoEmpty)
}

const inferProgramTypeFromName = (name?: string): string => {
  const text = (name || '').trim()
  if (!text) return 'program'
  if (/剧场|电视剧|第\d+集/.test(text)) return 'drama'
  if (/考古|纪实|纪录|新纪实/.test(text)) return 'documentary'
  if (/新闻|快报|看东方|ShanghaiEye|午间30分/.test(text)) return 'news'
  if (/养生|健康|名医/.test(text)) return 'health'
  if (/娱乐|真人秀/.test(text)) return 'entertainment'
  if (/旅行|文旅|下一站/.test(text)) return 'travel'
  if (/潮童|亲子|少儿/.test(text)) return 'kids'
  if (/爱上海|生活/.test(text)) return 'lifestyle'
  if (/锚点|两说|执牛耳者|环球交叉点/.test(text)) return 'commentary'
  return 'program'
}

const resolveScheduleItemProgramType = (item: Partial<ScheduleItem>) =>
  item.programType ||
  (item.businessType === 'ad' ? 'ad' : item.sourceType === 'live' ? 'live' : inferProgramTypeFromName(item.programName || item.instanceName))

const normalizeDemoDisplayName = (name?: string) => (name || '').replace(/带$/, '')

const formatRelativeStart = (seconds = 0) => {
  const totalSeconds = Math.max(0, Math.floor(seconds))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const remainSeconds = totalSeconds % 60
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(remainSeconds).padStart(2, '0')}`
}

const formatPlayLengthText = (durationSeconds: number) => `${Math.max(1, Math.round(durationSeconds / 60))}分钟`

const fillLiveStudios = () => {
  const studios = currentStudioOptions.value
  if (studios.length === 0) return
  scheduleItems.value.forEach((item, index) => {
    if (item.sourceType === 'live' && !item.studio) {
      item.studio = studios[index % studios.length]?.name
    }
  })
}

const FOCUS_ROW_HEIGHT = 42

const focusRuntime = useBroadcastPlanFocus()
const timelineBodyRef = ref<HTMLElement | null>(null)
const timelineContentRef = ref<HTMLElement | null>(null)
const scheduleItemsWrapperRef = ref<HTMLElement | null>(null)
const scrollTrackRef = ref<HTMLElement | null>(null)
const contentScrollWidth = ref(0)
const contentClientWidth = ref(0)
let isSyncingScroll = false
let resizeRaf = 0
let focusScrollResetTimer = 0
let isProgrammaticTimelineScroll = false
let lastTimelineScrollTop = 0
const itemRowRefs = new Map<string, HTMLElement>()
const itemRowRefVersion = ref(0)

const setProgrammaticTimelineScroll = () => {
  isProgrammaticTimelineScroll = true
  if (focusScrollResetTimer) {
    window.clearTimeout(focusScrollResetTimer)
  }
  focusScrollResetTimer = window.setTimeout(() => {
    isProgrammaticTimelineScroll = false
    focusScrollResetTimer = 0
  }, 320)
}

const registerItemRowRef = (itemId: string, element: Element | { $el?: Element } | null) => {
  const resolvedElement = element instanceof HTMLElement
    ? element
    : element && '$el' in element && element.$el instanceof HTMLElement
      ? element.$el
      : null

  if (resolvedElement) {
    if (itemRowRefs.get(itemId) === resolvedElement) {
      return
    }
    itemRowRefs.set(itemId, resolvedElement)
    itemRowRefVersion.value += 1
    return
  }
  if (itemRowRefs.delete(itemId)) {
    itemRowRefVersion.value += 1
  }
}

const scrollTimelineTo = (top: number) => {
  if (!timelineContentRef.value) return
  setProgrammaticTimelineScroll()
  timelineContentRef.value.scrollTo({
    top: Math.max(0, top),
    behavior: 'smooth',
  })
}

const scrollToItemRow = (itemId: string): boolean => {
  const row = itemRowRefs.get(itemId)
  const container = timelineContentRef.value
  if (!row || !container) return false
  scrollTimelineTo(row.offsetTop - container.clientHeight * 0.3)
  return true
}

const findFocusInsertionIndex = (startTime: string) => {
  const targetSeconds = timeToSeconds(startTime)
  const foundIndex = displayItems.value.findIndex((item) => timeToSeconds(item.startTime) >= targetSeconds)
  return foundIndex === -1 ? displayItems.value.length : foundIndex
}

const scrollToTimeRange = (startTime: string) => {
  const container = timelineContentRef.value
  if (!container) return false
  const index = findFocusInsertionIndex(startTime)
  scrollTimelineTo(index * FOCUS_ROW_HEIGHT - container.clientHeight * 0.3)
  return true
}

const focusBannerVisible = computed(() => {
  void itemRowRefVersion.value
  const activeTarget = focusRuntime.active.value
  if (!activeTarget) return false
  if (!focusRuntime.showSummary.value || focusRuntime.isPointAnchor.value) return false
  if (activeTarget.type === 'item') return false
  if (focusOverlapItemIds.value.size > 0) return false
  return true
})

const focusOverlapItemIds = computed(() => {
  const activeTarget = focusRuntime.active.value
  if (!activeTarget) return new Set<string>()

  const activeStart = timeToSeconds(activeTarget.startTime)
  const activeEnd = timeToSeconds(activeTarget.endTime)
  if (activeStart === null || activeEnd === null) return new Set<string>()

  return new Set(
    displayItems.value
      .filter((item) => {
        const itemStart = timeToSeconds(item.startTime)
        const itemEnd = timeToSeconds(item.endTime)
        if (itemStart === null || itemEnd === null) return false
        if (activeStart === activeEnd) {
          return (itemStart <= activeStart && itemEnd > activeStart) || itemStart === activeStart
        }
        return itemStart < activeEnd && itemEnd > activeStart
      })
      .map((item) => item.id),
  )
})

const focusMarkerStyle = computed<CSSProperties>(() => {
  const activeTarget = focusRuntime.active.value
  if (!activeTarget) return {}
  const index = findFocusInsertionIndex(activeTarget.startTime)
  return {
    top: `${Math.max(0, index * FOCUS_ROW_HEIGHT + 2)}px`,
    height: `${FOCUS_ROW_HEIGHT - 4}px`,
  }
})

const floatingFocusMarkerVisible = computed(() => {
  void itemRowRefVersion.value
  const activeTarget = focusRuntime.active.value
  const currentLayer = focusRuntime.currentLayer.value
  if (!activeTarget || !currentLayer) return false
  if (focusRuntime.showSummary.value) return false
  if (activeTarget.type === 'item' && itemRowRefs.has(activeTarget.itemId)) return false
  if (focusOverlapItemIds.value.size > 0) return false
  return true
})

const floatingFocusMarkerStyle = computed<CSSProperties>(() => {
  const activeTarget = focusRuntime.active.value
  if (!activeTarget) return {}
  const index = findFocusInsertionIndex(activeTarget.startTime)
  return {
    top: `${Math.max(0, index * FOCUS_ROW_HEIGHT + 2)}px`,
    height: `${FOCUS_ROW_HEIGHT - 4}px`,
  }
})

const overlapConflicts = computed<OverlapConflict[]>(() => {
  const issues = currentValidationReport.value?.issues ?? []
  return issues
    .filter((issue): issue is ValidationIssue => issue.type === 'overlap')
    .map((issue) => {
      const relatedItemIds = issue.location.relatedItemIds ?? []
      const [primaryItemId = issue.location.itemId || '', secondaryItemId = ''] = relatedItemIds
      return {
        id: issue.id,
        message: issue.message,
        primaryItemId,
        secondaryItemId,
        startTime: normalizeClockText(issue.location.timeRange?.start || ''),
        endTime: normalizeClockText(issue.location.timeRange?.end || ''),
      }
    })
    .filter((conflict) => Boolean(conflict.primaryItemId && conflict.secondaryItemId && conflict.startTime && conflict.endTime))
})

const overlapConflictItemIds = computed(() =>
  new Set(overlapConflicts.value.flatMap((conflict) => [conflict.primaryItemId, conflict.secondaryItemId])),
)

const overlapConflictMarkers = computed(() => {
  void itemRowRefVersion.value
  return overlapConflicts.value
    .map((conflict) => {
      const secondaryRow = itemRowRefs.get(conflict.secondaryItemId)
      if (!secondaryRow) return null
      return {
        ...conflict,
        top: Math.max(0, secondaryRow.offsetTop - 10),
      }
    })
    .filter((conflict): conflict is OverlapConflict & { top: number } => Boolean(conflict))
})

const isFocusActive = (itemId: string) =>
  Boolean(
    focusRuntime.currentLayer.value
    && focusRuntime.currentLayer.value !== 'result'
    && focusRuntime.status.value === 'active'
    && (
      focusRuntime.isActiveItem(itemId)
      || focusOverlapItemIds.value.has(itemId)
    ),
  )

const isFocusRecent = (itemId: string) =>
  focusRuntime.isRecentItem(itemId)
  || (focusRuntime.currentLayer.value === 'result' && focusOverlapItemIds.value.has(itemId))

const isFocusError = (itemId: string) => {
  const activeTarget = focusRuntime.active.value
  return Boolean(
    focusRuntime.status.value === 'error'
      && (
        (activeTarget?.type === 'item' && activeTarget.itemId === itemId)
        || focusOverlapItemIds.value.has(itemId)
      ),
  )
}

const isTimeConflictItem = (itemId: string) => overlapConflictItemIds.value.has(itemId)

const handleLocateActiveFocus = async () => {
  if (!focusRuntime.enabled.value || !focusRuntime.active.value) return
  await nextTick()
  const activeTarget = focusRuntime.active.value
  if (!activeTarget) return
  if (activeTarget.type === 'item' && scrollToItemRow(activeTarget.itemId)) return
  scrollToTimeRange(activeTarget.startTime)
}

const handleResumeFocusFollow = async () => {
  focusRuntime.resumeAutoFollow()
  await handleLocateActiveFocus()
}

const handleFocusGapEntry = async (gap: GapEntry) => {
  focusRuntime.focusAnchor(
    gap.source === 'runtime'
      ? {
          type: 'gap',
          gapId: gap.id,
          startTime: gap.from,
          endTime: gap.to,
        }
      : {
          type: 'range',
          startTime: gap.from,
          endTime: gap.to,
        },
    gap.status === 'failed' ? 'error' : 'active',
    gap.error,
    gap.status === 'failed' ? 'issue' : 'process',
  )
  await handleLocateActiveFocus()
}

const handleChatFocusRequested = async (payload: {
  type: 'item' | 'gap' | 'range'
  itemId?: string
  gapId?: string
  startTime: string
  endTime: string
  layer?: 'intent' | 'process' | 'issue' | 'result'
  status?: 'active' | 'success' | 'error'
  error?: string
}) => {
  const normalizedStartTime = normalizeClockText(payload.startTime)
  const normalizedEndTime = normalizeClockText(payload.endTime)
  const anchor: FocusAnchor = payload.type === 'item' && payload.itemId
    ? {
      type: 'item',
      itemId: payload.itemId,
      startTime: normalizedStartTime,
      endTime: normalizedEndTime,
    }
    : payload.type === 'gap' && payload.gapId
      ? {
      type: 'gap',
      gapId: payload.gapId,
      startTime: normalizedStartTime,
      endTime: normalizedEndTime,
      }
      : {
      type: 'range',
      startTime: normalizedStartTime,
      endTime: normalizedEndTime,
      }

  const layer = payload.layer ?? (payload.status === 'error' ? 'issue' : 'intent')
  if (layer === 'process') {
    focusRuntime.focusProcess(anchor, payload.status === 'success' ? 'success' : 'active')
  } else if (layer === 'issue') {
    focusRuntime.focusIssue(anchor, payload.error)
  } else if (layer === 'result') {
    focusRuntime.showResult(anchor)
  } else {
    focusRuntime.focusIntent(anchor)
  }

  await handleLocateActiveFocus()
}

const handleChatLayoutDraftUpdated = (payload: {
  draft: LayoutDraft | null
}) => {
  if (payload.draft) {
    showLayoutReference.value = false
  }
}

const handleDeleteExecuted = (payload: {
  deletedItem: { id: string; programName: string; startTime: string; endTime: string }
  affectedTimeRange?: { start: string; end: string }
}) => {
  void payload
  focusRuntime.clearDeletedEcho()
  focusRuntime.clearActive()
}

const handleFocusConflict = async (conflict: OverlapConflict) => {
  focusRuntime.focusIssue({
    type: 'range',
    startTime: conflict.startTime,
    endTime: conflict.endTime,
  }, conflict.message)
  await handleLocateActiveFocus()
}

const refreshValidationReport = () => {
  currentValidationReport.value = validationService.validateCurrentSchedule(scheduleDate.value, currentChannelId.value)
}

const updateScrollMetrics = () => {
  nextTick(() => {
    if (!timelineContentRef.value) return
    contentScrollWidth.value = timelineContentRef.value.scrollWidth
    contentClientWidth.value = timelineContentRef.value.clientWidth
    lastTimelineScrollTop = timelineContentRef.value.scrollTop
    if (scrollTrackRef.value) {
      scrollTrackRef.value.scrollLeft = timelineContentRef.value.scrollLeft
    }
  })
}

const handleTimelineContentScroll = (event: Event) => {
  if (isSyncingScroll) return
  const target = event.target as HTMLElement
  const verticalChanged = target.scrollTop !== lastTimelineScrollTop
  lastTimelineScrollTop = target.scrollTop
  if (target === timelineContentRef.value && verticalChanged && !isProgrammaticTimelineScroll) {
    focusRuntime.pauseAutoFollow()
  }
  if (!scrollTrackRef.value || scrollTrackRef.value === target) return
  isSyncingScroll = true
  scrollTrackRef.value.scrollLeft = target.scrollLeft
  isSyncingScroll = false
}

const handleTimelineAreaClick = () => {
  focusRuntime.pauseAutoFollow()
  focusRuntime.clearDeletedEcho()
  focusRuntime.clearActive()
}

const handleResize = () => {
  if (resizeRaf) cancelAnimationFrame(resizeRaf)
  resizeRaf = requestAnimationFrame(() => {
    resizeRaf = 0
    updateScrollMetrics()
  })
}

const syncCurrentBroadcastWindow = async () => {
  const channelId = currentChannelId.value
  if (!channelId) return
  const channelInfo = await dataService.getChannelInfo(channelId)
  if (!channelInfo) return
  currentBroadcastWindow.value = {
    startTime: channelInfo.broadcastRules.defaultStartTime,
    endTime: channelInfo.broadcastRules.defaultEndTime,
  }
}

// 版面参考显示状态
const showLayoutReference = ref(false)

// AI 编排相关状态
const aiSidebarVisible = ref(true)
const llmConfigVisible = ref(false)
const atomicCapabilities = getAtomicCapabilities()
const scheduleCommandBus = getScheduleCommandBus()
const manualCommandAdapter = getManualCommandAdapter()
const candidateService = getCandidateService()
const dataService = getDataService()
const validationService = getScheduleValidationService()
let syncAtomicItemsRaf = 0
const currentValidationReport = ref<ValidationReport | null>(null)

const currentBroadcastWindow = ref({
  startTime: '06:00:00',
  endTime: '23:59:59',
})

const currentBroadcastWindowText = computed(
  () => `${formatTime4(currentBroadcastWindow.value.startTime)} - ${formatTime4(currentBroadcastWindow.value.endTime)}`,
)

const syncPageItemsToAtomic = () => {
  const date = scheduleForm.value.date || demoBaseDate
  atomicCapabilities.loadItems(
    scheduleItems.value.map((item, index) => mapPageItemToAtomicSnapshot(item, index, date, {
      normalizeClockText,
      timeToSeconds,
      resolveScheduleItemProgramType,
    })),
  )
}

const syncAtomicItemsToPage = () => {
  const atomicItems = atomicCapabilities.getAllItems()
  scheduleItems.value = atomicItems.map((item, index) => mapAtomicItemToPageItem(item, index, {
    scheduleId: scheduleForm.value.id || '',
    formatPlayLengthText,
    formatRelativeStart,
  }))
}

const syncAtomicItemsToPageDeferred = () => {
  if (syncAtomicItemsRaf) {
    return
  }
  syncAtomicItemsRaf = requestAnimationFrame(() => {
    syncAtomicItemsRaf = 0
    syncAtomicItemsToPage()
  })
}

const chatScheduleItems = computed(() =>
  scheduleItems.value.map((item) => mapScheduleItemToChatSchedule(item, {
    timeToSeconds,
    normalizeClockText,
    resolveScheduleItemProgramType,
  })),
)

// 排序后的编单项
const sortedItems = computed(() => {
  return sortScheduleItems(scheduleItems.value, timeToMinutes)
})

// 版面参考项（转换为ScheduleItem格式）
const referenceItems = computed<ScheduleItem[]>(() => {
  const channelId = currentChannelId.value
  return buildReferenceItems(layoutReferenceData[channelId] || [], {
    normalizeDemoDisplayName,
    getTimeDiff,
  })
})

// 显示的项目（实际编排或版面参考）
const displayItems = computed<ScheduleItem[]>(() => {
  return selectDisplayItems(showLayoutReference.value, referenceItems.value, sortedItems.value)
})

const displayItemUnitLabel = computed(() => '个节目')

const unlinkedItemCount = computed(() => countUnlinkedItems(scheduleItems.value))

const emptyMaterialItemCount = computed(() =>
  countEmptyMaterialItems(scheduleItems.value, shouldWarnEmptyMaterialFields),
)

const timeToSeconds = (time: string): number => {
  const parts = String(time || '').split(':')
  const h = parseInt(parts[0] || '0', 10) || 0
  const m = parseInt(parts[1] || '0', 10) || 0
  const s = parseInt(parts[2] || '0', 10) || 0
  return h * 3600 + m * 60 + s
}

const normalizeClockText = (time: string): string => {
  if (time.includes('T')) {
    return time.split('T')[1]?.slice(0, 8) || time
  }
  return time.length === 5 ? `${time}:00` : time
}

const resolveManualCandidateId = async (item: Partial<ScheduleItem>): Promise<string | null> => {
  const directId = item.programCode || item.code18
  if (directId) {
    const directCandidate = candidateService.getCandidateById(directId)
    if (directCandidate) {
      return directCandidate.id
    }
  }

  const keyword = (item.programName || '').trim()
  if (!keyword) {
    return null
  }

  const candidates = await candidateService.searchPrograms({
    channelId: currentChannelId.value,
    programName: keyword,
    limit: 5,
  })

  if (candidates.length === 0) {
    return null
  }

  const exactMatch = candidates.find((candidate) => candidate.programName === keyword || candidate.programCode === keyword)
  return (exactMatch ?? candidates[0])?.id ?? null
}

const timeDiscontinuities = computed<TimeDiscontinuity[]>(() => {
  return buildTimeDiscontinuities(sortedItems.value, timeToSeconds, {
    startTime: currentBroadcastWindow.value.startTime,
    endTime: currentBroadcastWindow.value.endTime,
  })
})

const runtimeGapEntries = computed<GapEntry[]>(() => {
  return buildRuntimeGapEntries(orchestratorRuntime.progress.value, normalizeClockText)
})

const displayGapEntries = computed<GapEntry[]>(() => {
  return buildDisplayGapEntries(runtimeGapEntries.value, timeDiscontinuities.value)
})

const displayGapCount = computed(() => displayGapEntries.value.length)
const gapSummaryLabel = computed(() => resolveGapSummaryLabel(runtimeGapEntries.value))

const {
  orchestratorRuntime,
  handleCancelOrchestration,
  handleChatCommandExecuted,
  handleChatOrchestrateRequested,
  handleChatScheduleUpdated,
} = useBroadcastPlanOrchestration({
  currentChannelId,
  currentChannelName,
  scheduleDate,
  scheduleItems,
  displayGapCount,
  syncPageItemsToAtomic,
  syncAtomicItemsToPage,
  syncAtomicItemsToPageDeferred,
  focusRuntime,
  normalizeClockText,
})

const openClawHostAdapter = getOpenClawHostAdapter({
  getContext: () => ({
    channelId: currentChannelId.value,
    channelName: currentChannelName.value,
    date: scheduleDate.value,
    currentSchedule: chatScheduleItems.value,
    gapCount: displayGapCount.value,
  }),
  onOrchestrationRequest: handleChatOrchestrateRequested,
  getOrchestrationSnapshot: () => ({
    channelId: currentChannelId.value,
    channelName: currentChannelName.value,
    date: scheduleDate.value,
    status: orchestratorRuntime.status.value,
    isRunning: orchestratorRuntime.isRunning.value,
    sessionId: orchestratorRuntime.session.value?.id,
    latestLog: orchestratorRuntime.logs.value.at(-1)?.message,
    progress: orchestratorRuntime.progress.value as Record<string, unknown> | null,
  }),
})

const getGapEntryStatusText = (status: GapProcessingStatus) => {
  switch (status) {
    case 'processing':
      return '处理中'
    case 'failed':
      return '处理失败'
    case 'completed':
      return '已完成'
    default:
      return '待处理'
  }
}

const getGapEntryTagType = (status: GapProcessingStatus): 'info' | 'warning' | 'success' | 'danger' => {
  switch (status) {
    case 'processing':
      return 'warning'
    case 'failed':
      return 'danger'
    case 'completed':
      return 'success'
    default:
      return 'info'
  }
}

const {
  dialogVisible,
  editingItem,
  gapDialogDefaults,
  openAddItemForGap,
  handleAddItem,
  handleItemClick: handleEditorItemClick,
  handleEmptyAreaClick,
  handleDeleteItemById,
  handleSaveItem,
} = useBroadcastPlanEditor({
  isViewMode,
  scheduleForm,
  scheduleItems,
  allowedDialogTypes,
  canEditSection,
  scheduleDate,
  currentChannelId,
  syncAtomicItemsToPage,
  resolveManualCandidateId,
  generateId,
  resolveScheduleItemProgramType,
  normalizeClockText,
  formatRelativeStart,
  formatPlayLengthText,
  timeToSeconds,
  scheduleCommandBus,
  manualCommandAdapter,
  onDeleteExecuted: handleDeleteExecuted,
})

const handleItemClick = (item: ScheduleItem) => {
  focusRuntime.pauseAutoFollow()
  handleEditorItemClick(item)
}

// 最大排序号
const maxSortOrder = computed(() => {
  if (scheduleItems.value.length === 0) return 0
  return Math.max(...scheduleItems.value.map(item => item.sortOrder || 0))
})

// 总时长文本
const totalDurationText = computed(() => {
  const items = showLayoutReference.value
    ? referenceItems.value
    : scheduleItems.value
  const total = items.reduce((sum, item) => sum + (item.duration || 0), 0)
  const hours = Math.floor(total / 60)
  const minutes = total % 60
  if (hours > 0 && minutes > 0) {
    return `${hours}小时${minutes}分钟`
  } else if (hours > 0) {
    return `${hours}小时`
  } else {
    return `${minutes}分钟`
  }
})

/**
 * 处理频道变化
 * @param channelId - 频道ID
 */
const handleChannelChange = (channelId: string) => {
  const channel = channelOptions.value.find(c => c.id === channelId)
  if (channel) {
    scheduleForm.value.channelName = channel.name
  }
  fillLiveStudios()
  void syncCurrentBroadcastWindow()
}

/**
 * 处理返回
 */
const handleBack = () => {
  router.back()
}

const formatTime4 = (time: string) => {
  const parts = (time || '').split(':')
  const h = String(parseInt(parts[0] || '0', 10) || 0).padStart(2, '0')
  const m = String(parseInt(parts[1] || '0', 10) || 0).padStart(2, '0')
  const s = String(parseInt(parts[2] || '0', 10) || 0).padStart(2, '0')
  const f = String(parseInt(parts[3] || '0', 10) || 0).padStart(2, '0')
  return `${h}:${m}:${s}:${f}`
}

const getTypeText = (item: Pick<ScheduleItem, 'sourceType' | 'businessType'>) => {
  if (item.businessType === 'ad') return '广告'
  if (item.sourceType === 'live') return '直播'
  return '录播'
}

const getTypeTagType = (item: Pick<ScheduleItem, 'sourceType' | 'businessType'>) => {
  const text = getTypeText(item)
  if (text === '直播') return 'danger'
  if (text === '广告') return 'warning'
  return 'info'
}

const getContentTypeText = (item: Pick<ScheduleItem, 'instanceName' | 'programName' | 'businessType' | 'programType'>) => {
  if (item.businessType === 'ad') return '广告'
  const resolvedType = resolveScheduleItemProgramType(item)
  return getProgramTypeName(resolvedType)
}

const getContentTypeTagType = (item: Pick<ScheduleItem, 'instanceName' | 'programName' | 'businessType' | 'programType'>) => {
  const type = getContentTypeText(item)
  if (type === '广告') return 'warning'
  if (['电视剧', '纪录片', '评论', '生活', '文旅', '少儿', '健康'].includes(type)) return 'success'
  if (['综艺'].includes(type)) return 'danger'
  return 'primary'
}

/**
 * 获取素材状态文本
 * @param status - 素材状态
 * @returns 文本
 */
const getMaterialStatusText = (status: string) => {
  return materialStatusText[status as keyof typeof materialStatusText] || status
}

/**
 * 获取素材状态标签类型
 * @param status - 素材状态
 * @returns 标签类型
 */
const getMaterialStatusType = (status: string) => {
  return materialStatusType[status as keyof typeof materialStatusType] || 'info'
}

onMounted(async () => {
  // 从路由参数加载数据
  const id = route.params.id as string
  if (id) {
    // 编辑/查看模式，加载现有数据
    const detail = getScheduleDetail(id)
    if (detail) {
      // 查看模式时弹窗提示
      if (route.query.mode === 'view') {
        const hasPlan = true
        if (hasPlan) {
          try {
            await ElMessageBox.confirm(
              `检测到${detail.date}${detail.channelName}已有播出计划，是否导入数据？`,
              '提示',
              {
                confirmButtonText: '导入',
                cancelButtonText: '取消',
                type: 'info'
              }
            )
            ElMessage.success('数据导入成功')
          } catch {
            ElMessage.info('已取消导入')
          }
        }
      }
      scheduleForm.value = { ...detail }
      scheduleItems.value = [...detail.items]
      fillLiveStudios()
    } else {
      scheduleForm.value.id = id
        scheduleForm.value.date = (route.query.date as string) || demoBaseDate
      scheduleForm.value.channelId = (route.query.channelId as string) || 'dragon'
      const channel = channelOptions.value.find(c => c.id === scheduleForm.value.channelId)
      scheduleForm.value.channelName = channel?.name || '东方卫视'
      scheduleForm.value.name = (route.query.name as string) || `协同编单-${scheduleForm.value.date}`
      scheduleForm.value.status = 'draft'
      scheduleForm.value.isLocked = false
      scheduleItems.value = route.query.import === '1'
        ? generateImportedScheduleItems()
        : []
      fillLiveStudios()
    }
  } else {
    // 创建模式，初始化默认值
    scheduleForm.value.id = generateId()
      scheduleForm.value.date = demoBaseDate
    scheduleForm.value.channelId = 'dragon'
    scheduleForm.value.channelName = '东方卫视'
    fillLiveStudios()
  }

  window.addEventListener('resize', handleResize, { passive: true })
  syncPageItemsToAtomic()
  refreshValidationReport()
  await syncCurrentBroadcastWindow()
  updateScrollMetrics()
  openClawHostAdapter.install()
  openClawHostAdapter.publishOrchestrationState({
    channelId: currentChannelId.value,
    channelName: currentChannelName.value,
    date: scheduleDate.value,
    status: orchestratorRuntime.status.value,
    isRunning: orchestratorRuntime.isRunning.value,
    sessionId: orchestratorRuntime.session.value?.id,
    latestLog: orchestratorRuntime.logs.value.at(-1)?.message,
    progress: orchestratorRuntime.progress.value as Record<string, unknown> | null,
  })
})

watch(
  () => dialogVisible.value,
  (visible) => {
    if (!visible) {
      gapDialogDefaults.value = null
    }
  }
)

watch(
  () => [displayItems.value.length, showLayoutReference.value, scheduleForm.value.channelId],
  () => {
    updateScrollMetrics()
  }
)

watch(
  () => ({
    locateVersion: focusRuntime.locateVersion.value,
    autoFollow: focusRuntime.autoFollow.value,
    activeType: focusRuntime.active.value?.type || '',
    activeId: focusRuntime.active.value?.type === 'item'
      ? focusRuntime.active.value.itemId
      : focusRuntime.active.value?.type === 'gap'
        ? focusRuntime.active.value.gapId
        : `${focusRuntime.active.value?.startTime || ''}-${focusRuntime.active.value?.endTime || ''}`,
    displaySignature: displayItems.value.map((item) => item.id).join('|'),
  }),
  async (snapshot) => {
    if (!snapshot.autoFollow || !snapshot.activeType) return
    await handleLocateActiveFocus()
  },
)

watch(
  () => scheduleItems.value,
  () => {
    if (!orchestratorRuntime.isRunning.value) {
      syncPageItemsToAtomic()
    }
    refreshValidationReport()
  },
  { deep: true },
)

watch(
  () => [currentChannelId.value, scheduleDate.value],
  () => {
    refreshValidationReport()
  },
)

watch(
  () => ({
    channelId: currentChannelId.value,
    channelName: currentChannelName.value,
    date: scheduleDate.value,
    status: orchestratorRuntime.status.value,
    isRunning: orchestratorRuntime.isRunning.value,
    sessionId: orchestratorRuntime.session.value?.id || '',
    latestLog: orchestratorRuntime.logs.value.at(-1)?.message || '',
    progress: orchestratorRuntime.progress.value,
  }),
  (snapshot) => {
    openClawHostAdapter.publishOrchestrationState({
      channelId: snapshot.channelId,
      channelName: snapshot.channelName,
      date: snapshot.date,
      status: snapshot.status,
      isRunning: snapshot.isRunning,
      sessionId: snapshot.sessionId || undefined,
      latestLog: snapshot.latestLog || undefined,
      progress: snapshot.progress as Record<string, unknown> | null,
    })
  },
  { deep: true },
)

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleResize)
  if (resizeRaf) cancelAnimationFrame(resizeRaf)
  if (focusScrollResetTimer) {
    window.clearTimeout(focusScrollResetTimer)
  }
  focusRuntime.dispose()
  openClawHostAdapter.dispose()
})
</script>

<style scoped lang="scss">
.create-schedule-page {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background-color: var(--xnews-bg-color);
  position: relative;
  box-sizing: border-box;
  padding-bottom: 120px;
  --xnews-action-safe-right: 56px;
  --xnews-action-scroll-extra: 24px;
}

// 顶部信息栏
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--xnews-spacing-3) var(--xnews-spacing-6);
  background-color: var(--xnews-bg-white);
  border-bottom: 1px solid var(--xnews-border-color);
  box-shadow: var(--xnews-shadow-sm);
  flex-shrink: 0;

  .header-left {
    display: flex;
    align-items: center;
    gap: var(--xnews-spacing-4);

    .page-title {
      font-size: var(--xnews-font-size-xl);
      font-weight: var(--xnews-font-weight-semibold);
      color: var(--xnews-text-primary);
      margin: 0;
    }
  }

  .header-right {
    .schedule-info-form {
      :deep(.el-form-item) {
        margin-bottom: 0;
        margin-right: var(--xnews-spacing-4);

        &:last-child {
          margin-right: 0;
        }
      }

      .editor-avatars {
        margin-left: var(--xnews-spacing-2);
      }
    }
  }
}

// 主内容区
.main-content {
  flex: 1;
  display: flex;
  overflow: hidden;
  position: relative;
}

// 时间轴容器
.timeline-container {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: var(--xnews-spacing-4);
  transition: width 0.3s ease;
}

// 时间轴头部
.timeline-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--xnews-spacing-3) var(--xnews-spacing-4);
  background-color: var(--xnews-bg-white);
  border-radius: var(--xnews-radius-lg) var(--xnews-radius-lg) 0 0;
  border: 1px solid var(--xnews-border-color);
  border-bottom: none;

  .timeline-header-right {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    justify-content: flex-end;

    .stats-text {
      font-size: var(--xnews-font-size-sm);
      color: var(--xnews-text-secondary);
    }
  }
}

.header-alert-tag {
  margin-left: 12px;
  cursor: pointer;
  user-select: none;
}

:deep(.header-alert-tag .el-tag__content) {
  display: inline-flex;
  align-items: center;
  height: 100%;
  gap: 4px;
}

:deep(.header-alert-tag.el-tag) {
  display: inline-flex;
  align-items: center;
}

:deep(.header-alert-tag .el-icon) {
  display: inline-flex;
  align-items: center;
  line-height: 1;
}

:deep(.continuity-popper) {
  padding: var(--xnews-spacing-3);
  border-radius: var(--xnews-radius-lg);
}

// AI 智能编排按钮样式
.ai-orchestration-btn {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  border: none;
  font-weight: 500;
  
  &:hover {
    background: linear-gradient(135deg, #5a6fd6 0%, #6a4190 100%);
    opacity: 0.95;
  }
  
  &:active {
    background: linear-gradient(135deg, #4e5fc4 0%, #5e3a82 100%);
  }
}

.continuity-popover {
  display: flex;
  flex-direction: column;
  gap: var(--xnews-spacing-2);
  max-height: 320px;
  overflow: auto;

  .continuity-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--xnews-spacing-3);
  }

  .continuity-item.is-clickable {
    cursor: pointer;
  }

  .continuity-item.is-clickable:hover .continuity-text {
    color: #9a3412;
  }

  .continuity-text {
    flex: 1;
    min-width: 0;
    font-size: var(--xnews-font-size-xs);
    color: var(--xnews-text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .continuity-actions {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
  }

  :deep(.gap-fix-btn) {
    flex-shrink: 0;
    font-weight: var(--xnews-font-weight-medium);
  }
}

// 时间轴主体
.timeline-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  background-color: var(--xnews-bg-white);
  border-radius: 0 0 var(--xnews-radius-lg) var(--xnews-radius-lg);
  border: 1px solid var(--xnews-border-color);
  overflow: hidden;
}

// 表头 - 使用CSS Grid确保对齐
.timeline-table-header {
  display: grid;
  grid-template-columns: 60px 110px 110px 90px 110px minmax(180px, 2fr) 120px 120px 140px 70px minmax(160px, 1.5fr) 90px 160px 90px 140px minmax(120px, 1fr) 140px 140px 140px;
  background-color: var(--xnews-gray-200);
  border-bottom: 2px solid var(--xnews-border-color);
  font-weight: var(--xnews-font-weight-semibold);
  font-size: var(--xnews-font-size-sm);
  color: var(--xnews-text-regular);
  flex-shrink: 0;
  position: sticky;
  top: 0;
  z-index: 2;
  height: 44px;

  .header-cell {
    background-color: inherit;
    padding: var(--xnews-spacing-2) var(--xnews-spacing-3);
    text-align: center;
    border-right: 1px solid var(--xnews-border-color);
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;

    &:last-child {
      border-right: none;
    }

    &.episode-cell,
    &.program-cell,
    &.material-cell,
    &.studio-cell,
    &.remark-cell {
      justify-content: flex-start;
    }
  }
}

// 时间轴内容
.timeline-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: auto;
  box-sizing: border-box;
  padding-right: 0;

  &::-webkit-scrollbar:vertical {
    width: 8px;
  }

  &::-webkit-scrollbar:horizontal {
    height: 0;
  }

  &::-webkit-scrollbar-thumb {
    background-color: var(--xnews-gray-300);
    border-radius: 4px;
  }
}

// 节目列表
.schedule-items-wrapper {
  flex: 1;
  min-width: 2200px;
  position: relative;

  .empty-state {
    height: 400px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
}

// 编单项行 - 使用CSS Grid确保对齐
.schedule-item-row {
  display: grid;
  grid-template-columns: 60px 110px 110px 90px 110px minmax(180px, 2fr) 120px 120px 140px 70px minmax(160px, 1.5fr) 90px 160px 90px 140px minmax(120px, 1fr) 140px 140px 140px;
  background-color: var(--xnews-bg-white);
  border-bottom: 1px solid var(--xnews-border-color);
  cursor: pointer;
  transition: all var(--xnews-transition-fast);
  height: 50px;

  &:hover {
    background-color: rgba(249, 115, 22, 0.05);
  }

  &.is-section-disabled {
    cursor: not-allowed;
    opacity: 0.45;
    filter: grayscale(1) brightness(0.95);

    .item-cell {
      color: var(--xnews-text-secondary);
    }

    .index-number {
      color: var(--xnews-text-secondary);
    }

    .time-text,
    .episode-name,
    .small-text,
    .indexing-text {
      color: var(--xnews-text-secondary);
    }

    :deep(.el-tag) {
      opacity: 0.7;
    }
  }

  &.is-section-disabled:hover {
    background-color: rgba(0, 0, 0, 0.02);
  }

  &.is-program {
    background-color: rgba(64, 158, 255, 0.03);
  }

  &.is-ad {
    background-color: rgba(230, 162, 60, 0.03);
  }

  &.is-section-disabled.is-ad {
    background-color: rgba(16, 185, 129, 0.18);
  }

  &.is-promo {
    background-color: rgba(103, 194, 58, 0.03);
  }

  &.is-reference {
    background-color: rgba(144, 147, 153, 0.05);
    font-style: italic;
  }

  &.is-unlinked {
    background-color: rgba(245, 34, 45, 0.08);
    box-shadow: inset 4px 0 0 0 rgba(245, 34, 45, 0.65);
  }

  &.is-unlinked:hover {
    background-color: rgba(245, 34, 45, 0.12);
  }

  .item-cell {
    padding: var(--xnews-spacing-2) var(--xnews-spacing-3);
    border-right: 1px solid var(--xnews-border-color);
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;

    &:last-child {
      border-right: none;
    }

    &.index-cell {
      .index-number {
        font-weight: var(--xnews-font-weight-semibold);
        color: var(--xnews-color-primary);
        font-size: var(--xnews-font-size-base);
      }
    }

    &.start-time-cell,
    &.end-time-cell {
      .time-text {
        font-size: var(--xnews-font-size-sm);
        color: var(--xnews-text-primary);
        font-weight: var(--xnews-font-weight-medium);
        white-space: nowrap;
      }
    }

    &.episode-cell {
      justify-content: flex-start;

      .episode-name {
        font-weight: var(--xnews-font-weight-medium);
        color: var(--xnews-text-primary);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        display: flex;
        align-items: center;
        gap: var(--xnews-spacing-2);

        &.is-reference {
          color: var(--xnews-text-secondary);
        }

        .reference-icon {
          color: var(--xnews-color-warning);
        }
      }
    }

    &.indexing-cell,
    &.program-code-cell {
      .indexing-text {
        font-family: monospace;
        font-size: var(--xnews-font-size-xs);
        color: var(--xnews-text-secondary);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
    }

    .small-text {
      font-size: var(--xnews-font-size-xs);
      color: var(--xnews-text-secondary);
      white-space: nowrap;
    }

    .warning-text {
      color: var(--el-color-danger);
    }

    .editable-cell {
      position: relative;
      width: 100%;
      display: flex;
      align-items: center;
      min-height: 22px;

      .cell-display {
        width: 100%;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .cell-editor {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        opacity: 0;
        pointer-events: none;
      }

      &:hover {
        .cell-display {
          opacity: 0;
        }

        .cell-editor {
          opacity: 1;
          pointer-events: auto;
        }
      }

      :deep(.el-input__wrapper) {
        padding: 0 6px;
        box-shadow: none;
      }

      :deep(.el-input__inner) {
        height: 24px;
        line-height: 24px;
      }

      :deep(.el-select__wrapper),
      :deep(.el-input__wrapper) {
        min-height: 24px;
      }

      :deep(.el-select) {
        width: 100%;
      }

      :deep(.el-time-picker) {
        width: 100%;
      }
    }

    &.studio-cell {
      justify-content: flex-start;

      .studio-select {
        width: 100%;
      }
    }

    &.program-cell {
      justify-content: flex-start;

      .program-name {
        font-weight: var(--xnews-font-weight-medium);
        color: var(--xnews-text-primary);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        display: flex;
        align-items: center;
        gap: var(--xnews-spacing-2);

        &.is-reference {
          color: var(--xnews-text-secondary);
        }

        .reference-icon {
          color: var(--xnews-color-warning);
        }
      }
    }

    &.type-cell,
    &.content-type-cell,
    &.status-cell {
      .source-tag {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        white-space: nowrap;
      }

      .source-icon {
        margin-right: var(--xnews-spacing-1);
      }
    }

    &.code-cell {
      .code-text {
        font-family: monospace;
        font-size: var(--xnews-font-size-xs);
        color: var(--xnews-text-secondary);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
    }

    &.material-cell {
      justify-content: flex-start;

      .el-link {
        display: flex;
        align-items: center;
        gap: var(--xnews-spacing-1);
        font-size: var(--xnews-font-size-sm);

        .el-icon {
          font-size: 14px;
        }

        .material-name {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          max-width: 120px;
        }
      }

      .material-empty {
        color: var(--xnews-text-placeholder);
      }

      .material-empty.warning-text {
        color: var(--el-color-danger);
      }
    }

    &.remark-cell {
      justify-content: flex-start;

      .remark-text {
        font-size: var(--xnews-font-size-sm);
        color: var(--xnews-text-secondary);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .remark-empty {
        color: var(--xnews-text-placeholder);
      }
    }

  }
}

.horizontal-scroll-bar {
  position: fixed;
  bottom: 60px;
  left: var(--xnews-sidebar-width);
  right: 0;
  height: 20px;
  background-color: var(--xnews-gray-100);
  border-top: 1px solid var(--xnews-border-color);
  z-index: 1001;
  overflow: hidden;

  .scroll-wrapper {
    width: 100%;
    height: 100%;
    overflow-x: auto;
    overflow-y: hidden;

    &::-webkit-scrollbar {
      height: 12px;
    }

    &::-webkit-scrollbar-track {
      background-color: var(--xnews-gray-200);
    }

    &::-webkit-scrollbar-thumb {
      background: linear-gradient(135deg, var(--xnews-color-primary) 0%, var(--xnews-color-primary-light) 100%);
      border-radius: 6px;
    }

    .scroll-content {
      height: 1px;
    }
  }
}

// 响应式适配
@media (max-width: 1400px) {
  .page-header {
    flex-direction: column;
    align-items: flex-start;
    gap: var(--xnews-spacing-3);

    .header-right {
      width: 100%;
      overflow-x: auto;
    }
  }
}

// 内容包装器 - 左右布局
.content-wrapper {
  display: flex;
  flex: 1;
  overflow: hidden;

  &.with-ai-sidebar {
    .schedule-content {
      width: calc(100% - 540px);
    }
  }
}

// 左侧节目单内容区
.schedule-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  transition: width 0.3s ease;
}

// 右侧 AI 助手侧边栏
.ai-sidebar {
  width: 540px;
  min-width: 540px;
  max-width: 540px;
  display: flex;
  flex-direction: column;
  border-left: 1px solid var(--xnews-border-color);
  background-color: var(--xnews-bg-white);

  .ai-sidebar-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: var(--xnews-spacing-3) var(--xnews-spacing-4);
    border-bottom: 1px solid var(--xnews-border-color);

    .ai-sidebar-title {
      display: flex;
      align-items: center;
      gap: var(--xnews-spacing-2);
      font-size: var(--xnews-font-size-base);
      font-weight: var(--xnews-font-weight-semibold);
      color: var(--xnews-text-primary);
      margin: 0;

      .el-icon {
        color: var(--el-color-success);
      }
    }
  }

  .ai-sidebar-content {
    flex: 1;
    overflow: hidden;
    display: flex;
    flex-direction: column;

    :deep(.chat-panel) {
      flex: 1;
      min-height: 0;
    }
  }
}

// 响应式适配
@media (max-width: 1200px) {
  .content-wrapper.with-ai-sidebar {
    .schedule-content {
      width: calc(100% - 460px);
    }

    .ai-sidebar {
      width: 460px;
      min-width: 460px;
      max-width: 460px;
    }
  }
}

@media (max-width: 992px) {
  .content-wrapper.with-ai-sidebar {
    .schedule-content {
      width: calc(100% - 380px);
    }

    .ai-sidebar {
      width: 380px;
      min-width: 380px;
      max-width: 380px;
    }
  }
}

@media (max-width: 768px) {
  .ai-sidebar {
    position: fixed;
    right: 0;
    top: 0;
    bottom: 0;
    width: 300px;
    z-index: 1000;
    box-shadow: -4px 0 16px rgba(0, 0, 0, 0.1);
  }
}

.create-schedule-page {
  min-height: 100vh;
  background: #f7f8fa;
  padding-bottom: 0;
}

.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 12px;
  margin: 8px 16px 8px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #ffffff;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
}

.header-breadcrumb {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.back-button {
  padding: 0;
  color: #4b5563;
  font-weight: 600;
}

.timeline-kicker {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  padding: 0 10px;
  border-radius: 999px;
  background: #fff7ed;
  color: #9a3412;
  font-size: 11px;
  letter-spacing: 0.04em;
  font-weight: 600;
}

.page-header .page-title {
  margin: 0;
  font-size: 14px;
  line-height: 1;
  letter-spacing: 0;
  font-weight: 600;
  color: #111827;
}

.schedule-info-form {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 0;
  border: none;
  background: transparent;
}

.schedule-info-form :deep(.el-form-item) {
  margin-right: 0;
  margin-bottom: 0;
}

.schedule-info-form :deep(.el-form-item__label) {
  color: #4b5563;
  font-size: 12px;
  font-weight: 600;
  line-height: 30px;
}

.schedule-info-form :deep(.el-input__wrapper),
.schedule-info-form :deep(.el-select__wrapper),
.schedule-info-form :deep(.el-date-editor.el-input__wrapper) {
  background: #ffffff;
  box-shadow: inset 0 0 0 1px #d1d5db;
}

.schedule-info-form :deep(.el-input__inner),
.schedule-info-form :deep(.el-select__selected-item),
.schedule-info-form :deep(.el-range-input),
.schedule-info-form :deep(input) {
  color: #111827;
  font-size: 13px;
}

.schedule-info-form :deep(.el-input__inner::placeholder) {
  color: #9ca3af;
}

.broadcast-window-chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 32px;
  padding: 0 12px;
  border-radius: 999px;
  border: 1px solid #e5e7eb;
  background: #f9fafb;
  white-space: nowrap;
}

.broadcast-window-label {
  color: #6b7280;
  font-size: 12px;
  font-weight: 600;
}

.broadcast-window-value {
  color: #111827;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.01em;
}

.content-wrapper {
  gap: 16px;
  padding: 0 16px 16px;
}

.content-wrapper.with-ai-sidebar .schedule-content {
  width: 70%;
  flex: none;
}

.content-wrapper.with-ai-sidebar .ai-sidebar {
  width: 30%;
  min-width: 360px;
  max-width: none;
  flex: none;
}

.timeline-container {
  padding: 0;
  gap: 0;
}

.timeline-header {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) auto;
  gap: 12px;
  align-items: end;
  padding: 10px 12px 10px;
  border: 1px solid #e5e7eb;
  border-bottom: none;
  border-radius: 10px 10px 0 0;
  background: #ffffff;
  box-shadow: none;
}

.timeline-header-left {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 10px;
}

.timeline-heading {
  display: flex;
  align-items: center;
}

.timeline-title {
  margin: 0;
  font-size: 14px;
  line-height: 1.2;
  font-weight: 700;
  color: #111827;
}

.timeline-action-group {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.timeline-header-right {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  align-self: center;
  gap: 8px;
  flex-wrap: wrap;
}

.timeline-header .stats-text {
  display: inline-flex;
  align-items: center;
  min-height: 28px;
  padding: 0 10px;
  border-radius: 999px;
  background: #f3f4f6;
  color: #475569;
  font-size: 12px;
  font-weight: 600;
}

.header-alert-tag {
  margin-left: 0;
}

.timeline-body {
  border-radius: 0 0 10px 10px;
  border-color: #e5e7eb;
  box-shadow: none;
}

.timeline-insight-bar {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
  padding: 8px 12px;
  background: #f9fafb;
  border-left: 1px solid #e5e7eb;
  border-right: 1px solid #e5e7eb;
  border-bottom: 1px solid #e5e7eb;
}

.insight-group {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.insight-label {
  color: #78716c;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
}

.insight-pill {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  padding: 0 8px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.96);
  border: 1px solid rgba(251, 146, 60, 0.14);
  color: #44403c;
  font-size: 11px;
  font-weight: 600;
}

.insight-pill.is-danger {
  color: #b91c1c;
  background: rgba(254, 242, 242, 0.96);
  border-color: rgba(239, 68, 68, 0.18);
}

.insight-pill.is-warning {
  color: #b45309;
  background: rgba(255, 251, 235, 0.98);
  border-color: rgba(245, 158, 11, 0.18);
}

.timeline-table-header {
  background: #f9fafb;
  border-bottom-color: #e5e7eb;
}

.timeline-table-header .header-cell {
  color: #374151;
  font-size: 11px;
  text-transform: none;
  letter-spacing: 0;
}

.timeline-table-header .index-cell,
.timeline-table-header .start-time-cell,
.timeline-table-header .end-time-cell,
.schedule-item-row .index-cell,
.schedule-item-row .start-time-cell,
.schedule-item-row .end-time-cell {
  position: sticky;
  z-index: 3;
}

.timeline-table-header .index-cell,
.schedule-item-row .index-cell {
  left: 0;
  box-shadow: 1px 0 0 rgba(251, 146, 60, 0.12);
}

.timeline-table-header .start-time-cell,
.schedule-item-row .start-time-cell {
  left: 60px;
  box-shadow: 1px 0 0 rgba(251, 146, 60, 0.12);
}

.timeline-table-header .end-time-cell,
.schedule-item-row .end-time-cell {
  left: 170px;
  box-shadow: 8px 0 18px rgba(146, 64, 14, 0.05);
}

.timeline-table-header .index-cell,
.timeline-table-header .start-time-cell,
.timeline-table-header .end-time-cell {
  z-index: 4;
  background: #f9fafb;
}

.schedule-item-row {
  position: relative;
  height: 42px;
}

.schedule-item-row:nth-child(even) {
  background-color: #fcfcfd;
}

.schedule-item-row:hover {
  background-color: #f3f4f6;
}

.schedule-item-row .item-cell {
  border-right-color: #eef0f2;
  padding: 6px 8px;
}

.schedule-item-row.is-program {
  background-color: rgba(245, 158, 11, 0.035);
}

.schedule-item-row.is-ad {
  background-color: rgba(59, 130, 246, 0.03);
}

.schedule-item-row.is-promo {
  background-color: rgba(16, 185, 129, 0.035);
}

.schedule-item-row.is-reference {
  background-color: rgba(148, 163, 184, 0.08);
}

.schedule-item-row.is-unlinked {
  background-color: rgba(254, 226, 226, 0.8);
  box-shadow: inset 4px 0 0 0 rgba(220, 38, 38, 0.75);
}

.schedule-item-row.is-focus-active,
.schedule-item-row.is-focus-recent,
.schedule-item-row.is-focus-error {
  animation: none;
  box-shadow: none;
}

.schedule-item-row.is-focus-active::after,
.schedule-item-row.is-focus-recent::after,
.schedule-item-row.is-focus-error::after {
  content: '';
  position: absolute;
  inset: 2px 6px;
  border-radius: 8px;
  pointer-events: none;
  z-index: 5;
}

.schedule-item-row.is-focus-active::after {
  border: 2px dashed rgba(245, 158, 11, 0.95);
}

.schedule-item-row.is-focus-recent::after {
  border: 2px dashed rgba(22, 163, 74, 0.9);
}

.schedule-item-row.is-focus-error::after {
  border: 2px dashed rgba(220, 38, 38, 0.95);
}

.schedule-item-row .index-cell,
.schedule-item-row .start-time-cell,
.schedule-item-row .end-time-cell {
  background-color: inherit;
}

.schedule-item-row .status-cell :deep(.el-tag) {
  min-width: 62px;
  justify-content: center;
}

.schedule-item-row .episode-name,
.schedule-item-row .small-text,
.schedule-item-row .time-text {
  transition: color 160ms ease, transform 160ms ease;
}

.schedule-item-row:hover .episode-name,
.schedule-item-row:hover .time-text {
  color: #9a3412;
}

.focus-range-marker,
.floating-focus-marker {
  position: absolute;
  left: 6px;
  right: 6px;
  z-index: 4;
  border-radius: 8px;
  border: 2px dashed rgba(245, 158, 11, 0.92);
  background: transparent;
  pointer-events: none;
  box-sizing: border-box;
}

.focus-range-marker.is-success,
.floating-focus-marker.is-success {
  border-color: rgba(22, 163, 74, 0.92);
}

.focus-range-marker.is-error,
.floating-focus-marker.is-error {
  border-color: rgba(220, 38, 38, 0.92);
}

.deleted-echo-marker,
.conflict-range-marker {
  position: absolute;
  left: 0;
  right: 0;
  z-index: 2;
  min-height: 34px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 16px;
}

.deleted-echo-marker {
  border-top: 1px dashed rgba(220, 38, 38, 0.52);
  border-bottom: 1px dashed rgba(220, 38, 38, 0.52);
  background: linear-gradient(90deg, rgba(254, 242, 242, 0.92), rgba(255, 255, 255, 0.82));
  pointer-events: none;
}

.conflict-range-marker {
  cursor: pointer;
  left: 6px;
  right: 6px;
  z-index: 4;
  height: 38px;
  border-radius: 8px;
  border: 2px dashed rgba(220, 38, 38, 0.92);
  background: transparent;
  box-sizing: border-box;
}

.schedule-item-row.is-time-conflict {
  background-color: rgba(254, 226, 226, 0.68);
  box-shadow: inset 4px 0 0 0 rgba(220, 38, 38, 0.7);
}

.schedule-item-row.is-time-conflict:hover {
  background-color: rgba(254, 202, 202, 0.78);
}

.ai-orchestration-btn {
  background: linear-gradient(135deg, #111827 0%, #334155 100%);
  box-shadow: 0 12px 24px rgba(15, 23, 42, 0.18);
}

.ai-orchestration-btn:hover {
  background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
}

.ai-sidebar {
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  overflow: hidden;
  background: #ffffff;
  box-shadow: none;
}

.ai-sidebar-header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  gap: 14px;
  align-items: start;
}

.ai-sidebar-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.ai-sidebar-heading {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.ai-sidebar-subtitle {
  margin: 0;
  color: #78716c;
  font-size: 12px;
  line-height: 1.6;
}

.ai-sidebar .ai-sidebar-header {
  background: rgba(255, 250, 245, 0.86);
}

@media (max-width: 1280px) {
  .content-wrapper.with-ai-sidebar .schedule-content,
  .content-wrapper.with-ai-sidebar .ai-sidebar {
    width: auto;
    min-width: 0;
  }
}

@media (max-width: 900px) {
  .page-header,
  .content-wrapper {
    margin-left: 0;
    margin-right: 0;
  }

  .page-header {
    margin: 8px 12px;
    padding: 8px 10px;
    flex-wrap: wrap;
  }

  .broadcast-window-chip {
    width: 100%;
    justify-content: space-between;
  }

  .content-wrapper {
    padding: 0 12px 12px;
  }

  .timeline-header {
    grid-template-columns: 1fr;
    align-items: flex-start;
  }

  .timeline-insight-bar {
    padding: 12px 14px;
  }
}

@media (max-width: 768px) {
  .schedule-info-form {
    width: 100%;
    flex-wrap: wrap;
  }

  .timeline-header,
  .timeline-body,
  .ai-sidebar {
    border-radius: 10px;
  }

  .timeline-insight-bar {
    border-left: none;
    border-right: none;
  }

  .ai-sidebar-header {
    grid-template-columns: 1fr auto;
  }

  .timeline-body {
    border-top-left-radius: 0;
    border-top-right-radius: 0;
  }
}
</style>
