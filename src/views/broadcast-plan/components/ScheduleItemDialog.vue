<template>
  <el-dialog
    v-model="dialogVisible"
    :title="props.item ? '编辑记录' : '新增记录'"
    width="720px"
    :close-on-click-modal="false"
  >
    <el-form ref="formRef" :model="formData" :rules="formRules" label-width="110px">
      <el-row :gutter="16">
        <el-col :span="12">
          <el-form-item label="记录类型" prop="businessType">
            <el-select v-model="formData.businessType" placeholder="请选择类型">
              <el-option label="节目" value="program" />
              <el-option label="广告" value="ad" />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="栏目" prop="columnId">
            <el-select v-model="formData.columnId" placeholder="请选择栏目" filterable @change="handleReferenceChange">
              <el-option
                v-for="reference in availableReferences"
                :key="reference.columnId"
                :label="reference.columnName"
                :value="reference.columnId"
              />
            </el-select>
          </el-form-item>
        </el-col>
      </el-row>

      <el-form-item label="节目检索" prop="keyword">
        <div class="search-row">
          <el-input
            v-model="formData.keyword"
            placeholder="输入关键词，或直接回车列出当前栏目下的节目实例"
            clearable
            @keyup.enter="handleSearch"
          />
          <el-button type="primary" @click="handleSearch">搜索</el-button>
        </div>
      </el-form-item>

      <el-form-item label="搜索结果" prop="selectedCandidateId">
        <el-select v-model="formData.selectedCandidateId" placeholder="请选择节目" filterable @change="handleCandidateChange">
          <el-option
            v-for="candidate in searchResults"
            :key="candidate.id"
            :label="`${candidate.programName} (${candidate.programCode})`"
            :value="candidate.id"
          />
        </el-select>
      </el-form-item>

      <div v-if="selectedCandidate" class="selected-program-card">
        <div class="program-title">{{ selectedCandidate.programName }}</div>
        <div class="program-meta">
          <span>栏目：{{ selectedColumnName }}</span>
          <span>节目编号：{{ selectedCandidate.programCode }}</span>
          <span>素材时长：{{ formatDuration(selectedCandidate.duration) }}</span>
        </div>
      </div>

      <el-row :gutter="16">
        <el-col :span="12">
          <el-form-item label="节目编号">
            <el-input :model-value="formData.programCode" readonly />
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="节目名称">
            <el-input :model-value="formData.programName" readonly />
          </el-form-item>
        </el-col>
      </el-row>

      <el-row :gutter="16">
        <el-col :span="12">
          <el-form-item label="开始时间" prop="startTime">
            <el-time-picker
              v-model="formData.startTime"
              placeholder="选择开始时间"
              format="HH:mm:ss"
              value-format="HH:mm:ss"
            />
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="结束时间" prop="endTime">
            <el-input :model-value="formData.endTime" readonly />
          </el-form-item>
        </el-col>
      </el-row>

      <el-form-item label="备注" prop="remark">
        <el-input v-model="formData.remark" type="textarea" :rows="3" placeholder="请输入备注" />
      </el-form-item>
    </el-form>

    <template #footer>
      <div class="dialog-footer">
        <el-button v-if="props.item" type="danger" plain @click="handleDelete">删除</el-button>
        <span class="footer-actions">
          <el-button @click="handleCancel">取消</el-button>
          <el-button type="primary" @click="handleSave">确定</el-button>
        </span>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { FormInstance, FormRules } from 'element-plus'
import { ElMessage } from 'element-plus'
import { orchestrationDemoBaseDate } from '@/mock/orchestrationMock'
import { getCandidateService } from '@/services/candidateService'
import {
  getEffectiveColumnDefinition,
  getEffectiveLayoutReference,
} from '@/services/orchestration/runtimeLayoutRegistry'
import type { ProgramCandidate } from '@/types/orchestration'
import type { ScheduleItem } from '../scheduleData'

interface Props {
  modelValue: boolean
  item?: ScheduleItem | null
  scheduleDate?: string
  channelId?: string
  maxSortOrder?: number
  defaultStartTime?: string
  defaultEndTime?: string
  defaultSortOrder?: number
  allowedTypes?: Array<'record' | 'live' | 'ad'>
}

type FormBusinessType = 'program' | 'ad'

interface ReferenceOption {
  columnId: string
  columnName: string
  defaultProgramType: string
}

const props = withDefaults(defineProps<Props>(), {
  modelValue: false,
  item: null,
  scheduleDate: '',
  channelId: '',
  maxSortOrder: 0,
  defaultStartTime: '',
  defaultEndTime: '',
  defaultSortOrder: 0,
  allowedTypes: () => ['record', 'live', 'ad'],
})

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  save: [item: Partial<ScheduleItem>]
  delete: [itemId: string]
}>()

const candidateService = getCandidateService()
const formRef = ref<FormInstance>()
const searchResults = ref<ProgramCandidate[]>([])
const initializing = ref(false)

const dialogVisible = computed({
  get: () => props.modelValue,
  set: (val) => emit('update:modelValue', val),
})

const allReferences = computed<ReferenceOption[]>(() => {
  const slots = getEffectiveLayoutReference(props.channelId || 'dragon', props.scheduleDate || orchestrationDemoBaseDate)?.slots ?? []
  const map = new Map<string, ReferenceOption>()
  slots.forEach((slot) => {
    if (map.has(slot.columnId)) return
    const column = getEffectiveColumnDefinition(slot.columnId)
    map.set(slot.columnId, {
      columnId: slot.columnId,
      columnName: column?.columnName ?? slot.columnId,
      defaultProgramType: column?.defaultProgramType ?? 'program',
    })
  })
  return Array.from(map.values())
})

const formData = ref({
  businessType: 'program' as FormBusinessType,
  columnId: '',
  keyword: '',
  selectedCandidateId: '',
  startTime: '',
  endTime: '',
  programCode: '',
  programName: '',
  duration: 0,
  remark: '',
})

const availableReferences = computed(() =>
  allReferences.value.filter((reference) => {
    if (formData.value.businessType === 'ad') {
      return reference.defaultProgramType === 'ad'
    }
    return reference.defaultProgramType !== 'ad'
  }),
)

const selectedCandidate = computed(() =>
  searchResults.value.find((candidate) => candidate.id === formData.value.selectedCandidateId) ??
  candidateService.getCandidateById(formData.value.selectedCandidateId) ??
  null,
)

const selectedColumnName = computed(() => {
  const column = getEffectiveColumnDefinition(formData.value.columnId)
  return column?.columnName ?? '-'
})

const formRules: FormRules = {
  businessType: [{ required: true, message: '请选择类型', trigger: 'change' }],
  columnId: [{ required: true, message: '请选择栏目', trigger: 'change' }],
  selectedCandidateId: [{ required: true, message: '请选择节目', trigger: 'change' }],
  startTime: [{ required: true, message: '请选择开始时间', trigger: 'change' }],
}

watch(
  () => props.modelValue,
  async (val) => {
    if (!val) return
    initializing.value = true

    if (props.item) {
      const existingCandidate = candidateService.getCandidateById(props.item.programCode || props.item.code18 || '')
      formData.value = {
        businessType: props.item.businessType === 'ad' ? 'ad' : 'program',
        columnId: props.item.keySlot || availableReferences.value[0]?.columnId || '',
        keyword: props.item.programName || '',
        selectedCandidateId: existingCandidate?.id || '',
        startTime: normalizeClockText(props.item.startTime || ''),
        endTime: normalizeClockText(props.item.endTime || ''),
        programCode: props.item.programCode || '',
        programName: props.item.programName || '',
        duration: existingCandidate?.duration || props.item.duration || 0,
        remark: props.item.remark || '',
      }

      if (formData.value.columnId) {
        await searchByReference(formData.value.columnId, props.item.programName || '')
      }
    } else {
      const firstReference = availableReferences.value[0]
      formData.value = {
        businessType: 'program',
        columnId: firstReference?.columnId || '',
        keyword: '',
        selectedCandidateId: '',
        startTime: props.defaultStartTime || '',
        endTime: props.defaultEndTime || '',
        programCode: '',
        programName: '',
        duration: 0,
        remark: '',
      }
      searchResults.value = []
      if (firstReference?.columnId) {
        await searchByReference(firstReference.columnId, '')
      }
    }

    initializing.value = false
  },
)

watch(
  () => formData.value.businessType,
  async () => {
    if (initializing.value) return
    const firstReference = availableReferences.value[0]
    formData.value.columnId = firstReference?.columnId || ''
    formData.value.selectedCandidateId = ''
    formData.value.programCode = ''
    formData.value.programName = ''
    formData.value.duration = 0
    formData.value.endTime = ''
    searchResults.value = []
    if (firstReference?.columnId) {
      await searchByReference(firstReference.columnId, '')
    }
  },
)

watch(
  () => [formData.value.startTime, formData.value.duration],
  () => {
    if (formData.value.startTime && formData.value.duration > 0) {
      formData.value.endTime = calculateEndTime(formData.value.startTime, formData.value.duration)
    }
  },
)

const handleReferenceChange = async () => {
  formData.value.selectedCandidateId = ''
  formData.value.programCode = ''
  formData.value.programName = ''
  formData.value.duration = 0
  formData.value.endTime = ''
  await searchByReference(formData.value.columnId, formData.value.keyword)
}

const handleSearch = async () => {
  if (!formData.value.columnId) {
    ElMessage.warning('请先选择栏目')
    return
  }
  await searchByReference(formData.value.columnId, formData.value.keyword)
}

const handleCandidateChange = () => {
  if (!selectedCandidate.value) return
  formData.value.programCode = selectedCandidate.value.programCode
  formData.value.programName = selectedCandidate.value.programName
  formData.value.duration = selectedCandidate.value.duration
  formData.value.endTime = formData.value.startTime
    ? calculateEndTime(formData.value.startTime, selectedCandidate.value.duration)
    : ''
}

const handleCancel = () => {
  dialogVisible.value = false
}

const handleDelete = () => {
  if (!props.item?.id) return
  emit('delete', props.item.id)
  dialogVisible.value = false
}

const handleSave = async () => {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return

  const fallbackProgramType =
    selectedCandidate.value?.programType ||
    availableReferences.value.find((reference) => reference.columnId === formData.value.columnId)?.defaultProgramType ||
    (formData.value.businessType === 'ad' ? 'ad' : 'program')

  const newItem: Partial<ScheduleItem> = {
    id: props.item?.id,
    businessType: formData.value.businessType,
    sourceType: 'recorded',
    programType: fallbackProgramType,
    startTime: formData.value.startTime,
    endTime: formData.value.endTime,
    programCode: formData.value.programCode,
    code18: formData.value.programCode,
    programName: formData.value.programName,
    instanceName: formData.value.programName,
    duration: formData.value.duration,
    remark: formData.value.remark,
    keySlot: formData.value.columnId,
    sortOrder: props.item?.sortOrder ?? (props.maxSortOrder || 0) + 1,
  }

  emit('save', newItem)
  dialogVisible.value = false
}

const searchByReference = async (referenceId: string, keyword: string) => {
  const reference = availableReferences.value.find((item) => item.columnId === referenceId)
  const programTypes =
    formData.value.businessType === 'ad'
      ? ['ad']
      : reference?.defaultProgramType
        ? [reference.defaultProgramType]
        : undefined

  searchResults.value = await candidateService.searchPrograms({
    channelId: props.channelId || 'dragon',
    programName: keyword,
    columnId: referenceId,
    programTypes,
    limit: 20,
  })
}

const formatDuration = (seconds: number) => {
  if (!seconds) return '-'
  if (seconds % 60 === 0) {
    return `${seconds / 60} 分钟`
  }
  return `${seconds} 秒`
}

const formatColumnDisplayName = (name: string) => name.replace(/带$/, '')

const normalizeClockText = (value: string) => {
  if (!value) return ''
  if (value.includes('T')) {
    return value.split('T')[1]?.slice(0, 8) || value
  }
  return value.length === 5 ? `${value}:00` : value
}

const calculateEndTime = (startTime: string, duration: number) => {
  const [hours = 0, minutes = 0, seconds = 0] = startTime.split(':').map(Number)
  const totalSeconds = hours * 3600 + minutes * 60 + seconds + duration
  const endHours = Math.floor(totalSeconds / 3600) % 24
  const endMinutes = Math.floor((totalSeconds % 3600) / 60)
  const endSeconds = totalSeconds % 60
  return [endHours, endMinutes, endSeconds].map((part) => `${part}`.padStart(2, '0')).join(':')
}
</script>

<style scoped>
.search-row {
  display: flex;
  width: 100%;
  gap: 12px;
}

.selected-program-card {
  margin: 0 0 16px 110px;
  padding: 12px 14px;
  border: 1px solid var(--el-border-color-light);
  border-radius: 10px;
  background: var(--el-fill-color-lighter);
}

.program-title {
  margin-bottom: 6px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.program-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.dialog-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.footer-actions {
  display: inline-flex;
  gap: 12px;
}
</style>
