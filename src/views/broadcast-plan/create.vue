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
                  v-if="!isViewMode && !scheduleForm.isLocked"
                  :icon="CopyDocument"
                  @click="handleImportFromPlan"
                >
                  从播出计划导入
                </el-button>
                <el-button
                  type="success"
                  :icon="MagicStick"
                  @click="toggleAISidebar"
                  class="ai-orchestration-btn"
                >
                  {{ aiSidebarVisible ? '隐藏 AI' : 'AI 助手' }}
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
                共 {{ displayItems.length }} 个节目，总时长 {{ totalDurationText }}
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
                        @click="openAddItemForGap(gap)"
                      >
                        补齐
                      </el-button>
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
            <div class="timeline-content" ref="timelineContentRef" @scroll="handleTimelineContentScroll">
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
              <div class="schedule-items-wrapper" @click="handleEmptyAreaClick">
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
                  :class="{
                    'is-program': item.businessType === 'program',
                    'is-ad': item.businessType === 'ad',
                    'is-promo': item.businessType === 'promo',
                    'is-reference': item.isReference,
                    'is-unlinked': item.isUnlinkedProduct || shouldWarnEmptyMaterialFields(item),
                    'is-section-disabled': !canEditSection(item) && !item.isReference
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
                      {{ item.episodeName || '-' }}
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
          <div class="ai-sidebar-status">
            <span class="ai-sidebar-pill">{{ currentChannelName }}</span>
            <span class="ai-sidebar-pill">{{ displayGapCount }} 个空窗</span>
            <span class="ai-sidebar-pill" :class="{ 'is-live': orchestratorRuntime.isRunning.value }">
              {{ orchestratorRuntime.isRunning.value ? '编排进行中' : '待命中' }}
            </span>
          </div>
          <el-button link @click="aiSidebarVisible = false">
            <el-icon><Close /></el-icon>
          </el-button>
        </div>
        <div class="ai-sidebar-content">
          <ChatPanel
            :current-schedule="chatScheduleItems"
            :channel-id="currentChannelId"
            :channel-name="currentChannelName"
            :date="scheduleDate"
            :gap-count="displayGapCount"
            :orchestration-logs="orchestratorRuntime.recentLogs.value"
            :is-orchestrating="orchestratorRuntime.isRunning.value"
            :can-interrupt="orchestratorRuntime.canCancel.value"
            @command-executed="handleChatCommandExecuted"
            @schedule-updated="handleChatScheduleUpdated"
            @orchestrate-requested="handleChatOrchestrateRequested"
            @cancel-requested="handleCancelOrchestration"
          />
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
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, nextTick, watch, onBeforeUnmount } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowDown,
  Plus,
  Delete,
  Check,
  DocumentChecked,
  Lock,
  Unlock,
  VideoCamera,
  VideoPlay,
  CopyDocument,
  View,
  Document,
  WarningFilled,
  MagicStick,
  ChatDotRound,
  Close
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
import { layoutReferenceData, type LayoutReferenceItem } from './layoutReferenceData'

// AI 编排相关导入
import { useOrchestrator } from '@/composables/useOrchestrator'
import { getAtomicCapabilities } from '@/services/atomicCapabilities'
import { getScheduleCommandBus } from '@/services/scheduleCommandBus'
import { getManualCommandAdapter } from '@/services/manualCommandAdapter'
import { getCandidateService } from '@/services/candidateService'
import type { GapProcessingStatus } from '@/types/orchestration'
import ChatPanel from '@/components/dialogue/ChatPanel.vue'

const route = useRoute()
const router = useRouter()

// 页面模式
const isViewMode = computed(() => route.query.mode === 'view')
const isEditMode = computed(() => !isViewMode.value)
const pageTitle = computed(() => {
  if (isViewMode.value) return '查看编单'
  return '编辑编单'
})

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

// 编辑者列表
const editors = ref([
  { id: 'user1', name: '张三', avatar: 'https://cube.elemecdn.com/0/88/03b0d39583f48206768a7534e55bcpng.png' },
  { id: 'user2', name: '李四', avatar: 'https://cube.elemecdn.com/3/7c/3ea6beec64369c2642b92c6726f1epng.png' },
  { id: 'user3', name: '王五', avatar: 'https://cube.elemecdn.com/9/0/e5e9e6c8f0e0e0e0e0e0e0e0e0e0e0e0.png' }
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
  (item.businessType === 'ad' ? 'ad' : item.sourceType === 'live' ? 'live' : inferProgramTypeFromName(item.programName || item.episodeName))

const normalizeDemoDisplayName = (name?: string) => (name || '').replace(/带$/, '')

const formatRelativeStart = () => '00:00:00'

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

const timelineContentRef = ref<HTMLElement | null>(null)
const scrollTrackRef = ref<HTMLElement | null>(null)
const contentScrollWidth = ref(0)
const contentClientWidth = ref(0)
const showHorizontalScrollBar = computed(() => contentScrollWidth.value > contentClientWidth.value + 1)
let isSyncingScroll = false
let resizeRaf = 0

const updateScrollMetrics = () => {
  nextTick(() => {
    if (!timelineContentRef.value) return
    contentScrollWidth.value = timelineContentRef.value.scrollWidth
    contentClientWidth.value = timelineContentRef.value.clientWidth
    if (scrollTrackRef.value) {
      scrollTrackRef.value.scrollLeft = timelineContentRef.value.scrollLeft
    }
  })
}

const handleTimelineContentScroll = (event: Event) => {
  if (isSyncingScroll) return
  const target = event.target as HTMLElement
  if (!scrollTrackRef.value || scrollTrackRef.value === target) return
  isSyncingScroll = true
  scrollTrackRef.value.scrollLeft = target.scrollLeft
  isSyncingScroll = false
}

const handleScrollTrackScroll = (event: Event) => {
  if (isSyncingScroll) return
  const target = event.target as HTMLElement
  if (!timelineContentRef.value || timelineContentRef.value === target) return
  isSyncingScroll = true
  timelineContentRef.value.scrollLeft = target.scrollLeft
  isSyncingScroll = false
}

const handleResize = () => {
  if (resizeRaf) cancelAnimationFrame(resizeRaf)
  resizeRaf = requestAnimationFrame(() => {
    resizeRaf = 0
    updateScrollMetrics()
  })
}

// 版面参考显示状态
const showLayoutReference = ref(false)

// 弹窗相关
const dialogVisible = ref(false)
const editingItem = ref<ScheduleItem | null>(null)

// 保存状态
const saving = ref(false)

// AI 编排相关状态
const aiSidebarVisible = ref(true)
const aiUserInput = ref('')

const atomicCapabilities = getAtomicCapabilities()
const scheduleCommandBus = getScheduleCommandBus()
const manualCommandAdapter = getManualCommandAdapter()
const candidateService = getCandidateService()
let syncAtomicItemsRaf = 0

const syncPageItemsToAtomic = () => {
  const date = scheduleForm.value.date || demoBaseDate
  atomicCapabilities.loadItems(
    scheduleItems.value.map((item, index) => ({
      id: item.id,
      programCode: item.programCode || item.code18 || item.id,
      programName: item.programName || item.episodeName || '未命名节目',
      startTime: item.startTime.includes('T')
        ? item.startTime
        : `${date}T${item.startTime.length === 5 ? `${item.startTime}:00` : item.startTime}`,
      endTime: item.endTime.includes('T')
        ? item.endTime
        : `${date}T${item.endTime.length === 5 ? `${item.endTime}:00` : item.endTime}`,
      duration: Math.max(60, timeToSeconds(item.endTime) - timeToSeconds(item.startTime)),
      programType: resolveScheduleItemProgramType(item),
      sequence: index + 1,
    })),
  )
}

const syncAtomicItemsToPage = () => {
  const atomicItems = atomicCapabilities.getAllItems()
  scheduleItems.value = atomicItems.map((item, index) => ({
    id: item.id,
    scheduleId: scheduleForm.value.id || '',
    startTime: item.startTime.split('T')[1]?.slice(0, 8) || item.startTime,
    endTime: item.endTime.split('T')[1]?.slice(0, 8) || item.endTime,
    programType: item.programType,
    episodeName: item.programName,
    programName: item.programName,
    businessType: item.programType === 'ad' ? 'ad' : 'program',
    sourceType: item.programType === 'live' ? 'live' : 'record',
    sortOrder: index + 1,
    duration: Math.max(1, Math.round(item.duration / 60)),
    programCode: item.programCode,
    code18: item.programCode,
    materialStatus: item.programType === 'ad' ? 'pending' : 'ready',
    materialName: item.programType === 'ad' ? '待广告系统下发' : `${item.programCode}-MAT`,
    playLength: formatPlayLengthText(item.duration),
    relativeStart: formatRelativeStart(),
    remark: '',
  }))
}

const syncAtomicItemsToPageDeferred = () => {
  if (syncAtomicItemsRaf) {
    cancelAnimationFrame(syncAtomicItemsRaf)
  }
  syncAtomicItemsRaf = requestAnimationFrame(() => {
    syncAtomicItemsRaf = 0
    syncAtomicItemsToPage()
  })
}

const chatScheduleItems = computed(() =>
  scheduleItems.value.map((item) => ({
    id: item.id,
    programCode: item.programCode || item.code18 || item.id,
    programName: item.programName || item.episodeName || '未命名节目',
    startTime: item.startTime,
    endTime: item.endTime,
    duration: Math.max(60, timeToSeconds(item.endTime) - timeToSeconds(item.startTime)),
    programType: resolveScheduleItemProgramType(item),
  })),
)

const handleChatCommandExecuted = (result: { success: boolean; message: string }) => {
  if (result.success) {
    syncAtomicItemsToPage()
  }
}

const handleChatScheduleUpdated = () => {
  syncAtomicItemsToPage()
}

const handleChatOrchestrateRequested = async (payload: { userInput: string }) => {
  aiUserInput.value = payload.userInput
  await handleAICommand()
}

const orchestratorRuntime = useOrchestrator({
  onComplete: () => {
    syncAtomicItemsToPage()
    ElMessage.success('AI 编排完成')
  },
  onError: (error: Error) => {
    ElMessage.error(`AI 编排失败: ${error.message}`)
  },
  onProgress: () => {
    syncAtomicItemsToPageDeferred()
  },
  onStatusChange: (status) => {
    if (status === 'cancelled') {
      syncAtomicItemsToPage()
      ElMessage.info('AI 编排已中止，当前已生成内容已保留')
    }
  },
  onLog: (log: any) => {
    console.log('编排日志:', log.message || log)
  }
})

const startOrchestrationRuntime = async () => {
  try {
    syncPageItemsToAtomic()
    await orchestratorRuntime.startFullGeneration(
      currentChannelId.value,
      scheduleDate.value,
      '06:00:00',
      '23:59:59',
    )
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : 'AI 编排失败')
  }
}

const handleAICommand = async () => {
  const userInput = aiUserInput.value.trim()
  if (!userInput) {
    ElMessage.warning('请输入需求')
    return
  }

  const date = scheduleDate.value
  const task = await orchestratorRuntime.classifyTask(
    {
      channelId: currentChannelId.value,
      channelName: currentChannelName.value,
      date,
      isEmpty: scheduleItems.value.length === 0,
      itemCount: scheduleItems.value.length,
      gapCount: displayGapCount.value,
      hasSelectedTimeRange: false,
    },
    userInput,
  )

  aiUserInput.value = ''

  if (task.mode === 'partial_generate' && scheduleItems.value.length > 0) {
    syncPageItemsToAtomic()
    await orchestratorRuntime.startPartialGeneration(
      currentChannelId.value,
      date,
    )
    return
  }

  await startOrchestrationRuntime()
}

// 显示/隐藏 AI 侧边栏
const toggleAISidebar = () => {
  aiSidebarVisible.value = !aiSidebarVisible.value
}

const handleCancelOrchestration = async () => {
  try {
    await ElMessageBox.confirm(
      '中止后将保留当前已编排结果，剩余空窗不再继续自动处理。是否停止本次 AI 编排？',
      '中止编排',
      {
        type: 'warning',
        confirmButtonText: '中止编排',
        cancelButtonText: '继续运行',
      },
    )
    orchestratorRuntime.cancel()
  } catch {
    // 用户取消中止
  }
}

// 排序后的编单项
const sortedItems = computed(() => {
  return [...scheduleItems.value].sort((a, b) => {
    if (a.sortOrder !== b.sortOrder) return (a.sortOrder || 0) - (b.sortOrder || 0)
    return timeToMinutes(a.startTime) - timeToMinutes(b.startTime)
  })
})

// 版面参考项（转换为ScheduleItem格式）
const referenceItems = computed<ScheduleItem[]>(() => {
  const channelId = currentChannelId.value
  const references = layoutReferenceData[channelId] || []
  return references.map((ref, index): ScheduleItem => ({
    id: `ref-${index}`,
    scheduleId: '',
    startTime: `${ref.startTime}:00`,
    endTime: `${ref.endTime}:00`,
    programType: ref.programType,
    episodeName: normalizeDemoDisplayName(ref.programName),
    indexingSheetCode: `IDX${ref.code18 || String(index + 1).padStart(6, '0')}`,
    materialStatus: 'ready' as const,
    businessType: ref.type,
    programName: normalizeDemoDisplayName(ref.programName),
    sourceType: ref.sourceType,
    remark: ref.remark || '',
    sortOrder: index,
    duration: getTimeDiff(ref.startTime || '', ref.endTime || ''),
    isReference: true,
    code18: ref.code18 || ''
  }))
})

// 显示的项目（实际编排或版面参考）
const displayItems = computed<ScheduleItem[]>(() => {
  if (showLayoutReference.value) {
    return referenceItems.value
  }
  return sortedItems.value
})

const unlinkedItemCount = computed(() => {
  return scheduleItems.value.filter(v => v.isUnlinkedProduct).length
})

const emptyMaterialItemCount = computed(() => {
  return scheduleItems.value.filter(v => shouldWarnEmptyMaterialFields(v)).length
})

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

type TimeDiscontinuity = {
  id: string
  from: string
  to: string
  prevId: string
  nextId: string
  prevSortOrder: number
  nextSortOrder: number
}

type GapEntry = TimeDiscontinuity & {
  source: 'manual' | 'runtime'
  status: GapProcessingStatus
  error?: string
}

const timeDiscontinuities = computed<TimeDiscontinuity[]>(() => {
  const items = sortedItems.value.filter(v => !v.isReference)
  if (items.length < 2) return []
  const list: TimeDiscontinuity[] = []
  for (let i = 0; i < items.length - 1; i++) {
    const prev = items[i]
    const next = items[i + 1]
    if (!prev?.endTime || !next?.startTime) continue
    const prevEnd = timeToSeconds(prev.endTime)
    const nextStart = timeToSeconds(next.startTime)
    if (prevEnd === nextStart) continue
    if (nextStart <= prevEnd) continue
    const from = prev.endTime
    const to = next.startTime
    list.push({
      id: `${prev.id}-${next.id}`,
      from,
      to,
      prevId: prev.id,
      nextId: next.id,
      prevSortOrder: prev.sortOrder || 0,
      nextSortOrder: next.sortOrder || 0
    })
  }
  return list
})

const runtimeGapEntries = computed<GapEntry[]>(() => {
  const progress = orchestratorRuntime.progress.value
  if (!progress) return []

  return progress.liveGaps
    .filter((gap) => gap.status !== 'completed')
    .map((gap) => ({
      id: gap.id,
      from: normalizeClockText(gap.startTime),
      to: normalizeClockText(gap.endTime),
      prevId: gap.precedingItemId || '',
      nextId: gap.followingItemId || '',
      prevSortOrder: 0,
      nextSortOrder: 0,
      source: 'runtime',
      status: gap.status,
      error: gap.error,
    }))
})

const displayGapEntries = computed<GapEntry[]>(() => {
  if (runtimeGapEntries.value.length > 0) {
    return runtimeGapEntries.value
  }

  return timeDiscontinuities.value.map((gap) => ({
    ...gap,
    source: 'manual' as const,
    status: 'pending' as const,
  }))
})

const displayGapCount = computed(() => displayGapEntries.value.length)
const gapSummaryLabel = computed(() => (runtimeGapEntries.value.length > 0 ? '待处理空窗' : '时间空缺'))

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

const gapDialogDefaults = ref<{ startTime: string; endTime: string; sortOrder: number } | null>(null)

const openAddItemForGap = (gap: TimeDiscontinuity) => {
  if (isViewMode.value || scheduleForm.value.isLocked) return
  if (allowedDialogTypes.value.length === 0) {
    ElMessage.warning('当前用户无可编辑板块权限')
    return
  }
  const a = gap.prevSortOrder
  const b = gap.nextSortOrder
  const sortOrder = b > a ? (a + b) / 2 : a + 0.5
  gapDialogDefaults.value = {
    startTime: gap.from,
    endTime: gap.to,
    sortOrder
  }
  editingItem.value = null
  dialogVisible.value = true
}

// 最大排序号
const maxSortOrder = computed(() => {
  if (scheduleItems.value.length === 0) return 0
  return Math.max(...scheduleItems.value.map(item => item.sortOrder || 0))
})

// 总时长文本
const totalDurationText = computed(() => {
  const items = showLayoutReference.value ? referenceItems.value : scheduleItems.value
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
}

/**
 * 处理返回
 */
const handleBack = () => {
  router.back()
}

/**
 * 切换版面参考显示
 */
const toggleLayoutReference = () => {
  showLayoutReference.value = false
}

/**
 * 处理添加编单项
 */
const handleAddItem = () => {
  if (allowedDialogTypes.value.length === 0) {
    ElMessage.warning('当前用户无可编辑板块权限')
    return
  }
  gapDialogDefaults.value = null
  editingItem.value = null
  dialogVisible.value = true
}

/**
 * 处理编辑编单项
 * @param item - 编单项
 */
const handleEditItem = (item: ScheduleItem) => {
  gapDialogDefaults.value = null
  editingItem.value = { ...item }
  dialogVisible.value = true
}

/**
 * 处理点击编单项
 * @param item - 编单项
 */
const handleItemClick = (item: ScheduleItem) => {
  if (!isViewMode.value && !scheduleForm.value.isLocked && !item.isReference) {
    if (!canEditSection(item)) {
      ElMessage.warning('当前用户无权限编辑该板块内容')
      return
    }
    handleEditItem(item)
  }
}

/**
 * 处理空白区域点击 - 创建新编单项
 * @param event - 点击事件
 */
const handleEmptyAreaClick = (event: MouseEvent) => {
  // 如果点击的是节目行本身，不处理（由handleItemClick处理）
  const target = event.target as HTMLElement
  if (target.closest('.schedule-item-row')) {
    return
  }

  // 只有在非查看模式且未锁定时才允许创建
  if (isViewMode.value || scheduleForm.value.isLocked) {
    return
  }
  if (allowedDialogTypes.value.length === 0) {
    ElMessage.warning('当前用户无可编辑板块权限')
    return
  }

  // 显示创建弹窗
  gapDialogDefaults.value = null
  editingItem.value = null
  dialogVisible.value = true
}

/**
 * 处理删除编单项
 * @param item - 编单项
 * @param index - 索引
 */
const handleDeleteItem = (item: ScheduleItem, index: number) => {
  ElMessageBox.confirm(
    `确定要删除节目"${item.programName}"吗？`,
    '删除节目',
    {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning'
    }
  ).then(async () => {
    const result = await scheduleCommandBus.execute(
      manualCommandAdapter.buildDeleteCommand(item),
      {
        scheduleDate: scheduleDate.value,
        channelId: currentChannelId.value,
      },
    )

    if (!result.success) {
      ElMessage.error(result.error || result.message)
      return
    }

    syncAtomicItemsToPage()
    ElMessage.success(result.message)
  })
}

const handleDeleteItemById = async (itemId: string) => {
  const item = scheduleItems.value.find((entry) => entry.id === itemId)
  if (!item) {
    ElMessage.error('未找到待删除节目')
    return
  }

  const result = await scheduleCommandBus.execute(
    manualCommandAdapter.buildDeleteCommand(item),
    {
      scheduleDate: scheduleDate.value,
      channelId: currentChannelId.value,
    },
  )

  if (!result.success) {
    ElMessage.error(result.error || result.message)
    return
  }

  syncAtomicItemsToPage()
  gapDialogDefaults.value = null
  ElMessage.success(result.message)
}

const handleMoveUp = async (item: ScheduleItem, index: number) => {
  const currentIndex = sortedItems.value.findIndex(v => v.id === item.id)
  if (currentIndex <= 0) return
  const prev = sortedItems.value[currentIndex - 1]
  const cur = sortedItems.value[currentIndex]
  if (!prev || !cur) return
  const a = scheduleItems.value.find(v => v.id === cur.id)
  const b = scheduleItems.value.find(v => v.id === prev.id)
  if (!a || !b) return

  const result = await scheduleCommandBus.executeBatch(
    manualCommandAdapter.buildSortSwapCommands(a.id, b.sortOrder || 0, b.id, a.sortOrder || 0),
    {
      scheduleDate: scheduleDate.value,
      channelId: currentChannelId.value,
    },
  )

  if (!result.success) {
    ElMessage.error(result.error || result.message)
    return
  }

  syncAtomicItemsToPage()
  ElMessage.success('已上移')
}

const handleMoveDown = async (item: ScheduleItem, index: number) => {
  const currentIndex = sortedItems.value.findIndex(v => v.id === item.id)
  if (currentIndex < 0 || currentIndex >= sortedItems.value.length - 1) return
  const next = sortedItems.value[currentIndex + 1]
  const cur = sortedItems.value[currentIndex]
  if (!next || !cur) return
  const a = scheduleItems.value.find(v => v.id === cur.id)
  const b = scheduleItems.value.find(v => v.id === next.id)
  if (!a || !b) return

  const result = await scheduleCommandBus.executeBatch(
    manualCommandAdapter.buildSortSwapCommands(a.id, b.sortOrder || 0, b.id, a.sortOrder || 0),
    {
      scheduleDate: scheduleDate.value,
      channelId: currentChannelId.value,
    },
  )

  if (!result.success) {
    ElMessage.error(result.error || result.message)
    return
  }

  syncAtomicItemsToPage()
  ElMessage.success('已下移')
}

/**
 * 处理保存编单项
 * @param item - 编单项
 */
const handleSaveItem = async (item: Partial<ScheduleItem>) => {
  if (!item.startTime || !item.endTime) {
    ElMessage.error('节目数据不完整，无法保存')
    return
  }

  const normalizedItem: ScheduleItem = {
    ...item,
    id: item.id || generateId(),
    programType: resolveScheduleItemProgramType(item),
    startTime: normalizeClockText(item.startTime),
    endTime: normalizeClockText(item.endTime),
    relativeStart: item.relativeStart || formatRelativeStart(),
    playLength: item.playLength || formatPlayLengthText(Math.max(60, timeToSeconds(item.endTime) - timeToSeconds(item.startTime))),
    materialStatus: item.materialStatus || (resolveScheduleItemProgramType(item) === 'ad' ? 'pending' : item.materialStatus),
    materialName:
      item.materialName ||
      (resolveScheduleItemProgramType(item) === 'ad' ? '待广告系统下发' : item.programCode ? `${item.programCode}-MAT` : ''),
  }
  const commandContext: { scheduleDate: string; channelId: string } = {
    scheduleDate: scheduleDate.value,
    channelId: currentChannelId.value,
  }
  const currentIndex = scheduleItems.value.findIndex(i => i.id === normalizedItem.id)

  if (currentIndex > -1) {
    const currentItem = scheduleItems.value[currentIndex]
    if (!currentItem) return
    const commands = manualCommandAdapter.buildUpdateCommands(currentItem, normalizedItem, commandContext)
    if (commands.length === 0) {
      scheduleItems.value[currentIndex] = { ...normalizedItem, scheduleId: scheduleForm.value.id || '' }
      gapDialogDefaults.value = null
      return
    }

    const result = await scheduleCommandBus.executeBatch(commands, commandContext)
    if (!result.success) {
      ElMessage.error(result.error || result.message)
      return
    }

    syncAtomicItemsToPage()
    gapDialogDefaults.value = null
    ElMessage.success(result.message)
    return
  }

  const newItem = {
    ...normalizedItem,
    sortOrder: gapDialogDefaults.value?.sortOrder ?? normalizedItem.sortOrder,
    startTime: normalizedItem.startTime || gapDialogDefaults.value?.startTime || normalizedItem.startTime,
    endTime: normalizedItem.endTime || gapDialogDefaults.value?.endTime || normalizedItem.endTime,
    scheduleId: scheduleForm.value.id || ''
  }
  let insertCommand = manualCommandAdapter.buildInsertCommand(newItem, commandContext)

  if (!insertCommand) {
    const resolvedCandidateId = await resolveManualCandidateId(newItem)
    if (resolvedCandidateId) {
      insertCommand = manualCommandAdapter.buildInsertCommandForCandidate(
        resolvedCandidateId,
        newItem,
        commandContext,
      )
    }
  }

  if (!insertCommand) {
    ElMessage.error('未匹配到可插入的节目候选，请输入有效节目编号或更准确的节目名称。')
    return
  }

  const result = await scheduleCommandBus.execute(insertCommand, commandContext)
  if (!result.success) {
    ElMessage.error(result.error || result.message)
    return
  }

  syncAtomicItemsToPage()
  gapDialogDefaults.value = null
  ElMessage.success(result.message)
}

/**
 * 处理从播出计划导入
 */
const handleImportFromPlan = () => {
  ElMessage.info('导入功能开发中')
}

/**
 * 处理查看素材
 * @param item - 编单项
 */
const handleViewMaterial = (item: ScheduleItem) => {
  if (item.materialId) {
    router.push({
      path: '/finished-product-library/detail',
      query: { id: item.materialId }
    })
    ElMessage.info(`正在打开素材: ${item.materialName}`)
  }
}

/**
 * 处理从版面引用复制
 * @param item - 版面参考项
 */
const handleCopyFromReference = (item: any) => {
  const newItem: ScheduleItem = {
    id: generateId(),
    scheduleId: scheduleForm.value.id || '',
    startTime: item.startTime,
    endTime: item.endTime,
    programName: item.programName,
    businessType: item.businessType,
    sourceType: item.sourceType,
    code18: item.code18 || '',
    materialName: '',
    materialId: '',
    materialStatus: 'pending',
    remark: item.remark || '',
    sortOrder: maxSortOrder.value + 1,
    duration: item.duration
  }
  scheduleItems.value.push(newItem)
  ElMessage.success(`已添加节目: ${item.programName}`)
}

/**
 * 验证表单
 * @returns 是否通过
 */
const basicHeaderCheck = (): boolean => {
  return Boolean(scheduleForm.value.name && scheduleForm.value.channelId && scheduleForm.value.date)
}

const validateHeaderForm = async (): Promise<boolean> => {
  if (!headerFormRef.value) return basicHeaderCheck()
  try {
    await headerFormRef.value.validate()
    return true
  } catch {
    return false
  }
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

const getContentTypeText = (item: Pick<ScheduleItem, 'episodeName' | 'programName' | 'businessType' | 'programType'>) => {
  if (item.businessType === 'ad') return '广告'
  const resolvedType = resolveScheduleItemProgramType(item)
  return getProgramTypeName(resolvedType)
}

const getContentTypeTagType = (item: Pick<ScheduleItem, 'episodeName' | 'programName' | 'businessType' | 'programType'>) => {
  const type = getContentTypeText(item)
  if (type === '广告') return 'warning'
  if (['电视剧', '纪录片', '评论', '生活', '文旅', '少儿', '健康'].includes(type)) return 'success'
  if (['综艺'].includes(type)) return 'danger'
  return 'primary'
}

const addDays = (dateStr: string, days: number) => {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  if (Number.isNaN(d.getTime())) return ''
  d.setDate(d.getDate() + days)
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

const getThirdReviewDate = (item: Pick<ScheduleItem, 'isReference' | 'isUnlinkedProduct'>) => {
  if (item.isReference || item.isUnlinkedProduct) return '-'
  return scheduleForm.value.date || '-'
}

const getLastPlayableTime = (item: Pick<ScheduleItem, 'isReference' | 'isUnlinkedProduct'>) => {
  if (item.isReference || item.isUnlinkedProduct) return '-'
  const base = scheduleForm.value.date || ''
  return addDays(base, 30) || '-'
}

const getRebroadcastReauditDate = (item: Pick<ScheduleItem, 'isReference' | 'businessType' | 'isUnlinkedProduct'>) => {
  if (item.isReference || item.isUnlinkedProduct) return '-'
  const base = scheduleForm.value.date || ''
  if (!base) return '-'
  return item.businessType === 'ad' ? addDays(base, 7) || '-' : '-'
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

/**
 * 获取状态文本
 * @param status - 状态
 * @returns 文本
 */
const getStatusText = (status: string) => {
  const map: Record<string, string> = {
    draft: '草稿',
    pending: '待审核',
    approved: '审核通过',
    rejected: '已退回',
    broadcasting: '已推播出'
  }
  return map[status] || status
}

/**
 * 获取状态标签类型
 * @param status - 状态
 * @returns 标签类型
 */
const getStatusType = (status: string) => {
  const map: Record<string, string> = {
    draft: 'info',
    pending: 'warning',
    approved: 'success',
    rejected: 'danger',
    broadcasting: 'primary'
  }
  return map[status] || 'info'
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
  updateScrollMetrics()
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
  () => scheduleItems.value,
  () => {
    if (!orchestratorRuntime.isRunning.value) {
      syncPageItemsToAtomic()
    }
  },
  { deep: true },
)

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleResize)
  if (resizeRaf) cancelAnimationFrame(resizeRaf)
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

.ai-sidebar-status {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 8px;
}

.ai-sidebar-pill {
  display: inline-flex;
  align-items: center;
  min-height: 28px;
  padding: 0 10px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.96);
  border: 1px solid rgba(251, 146, 60, 0.14);
  color: #57534e;
  font-size: 12px;
  font-weight: 600;
}

.ai-sidebar-pill.is-live {
  background: rgba(220, 252, 231, 0.96);
  border-color: rgba(34, 197, 94, 0.16);
  color: #166534;
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
  .page-header .page-title {
    font-size: 28px;
  }

  .schedule-info-form {
    padding: 8px 8px 0;
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

  .ai-sidebar-status {
    grid-column: 1 / -1;
    justify-content: flex-start;
  }

  .timeline-body {
    border-top-left-radius: 0;
    border-top-right-radius: 0;
  }
}
</style>
