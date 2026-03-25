<template>
  <el-dialog
    v-model="dialogVisible"
    title="添加节目"
    width="600px"
    :close-on-click-modal="false"
  >
    <el-form
      ref="formRef"
      :model="formData"
      :rules="formRules"
      label-width="100px"
    >
      <el-form-item label="节目类型" prop="businessType">
        <el-select v-model="formData.businessType" placeholder="请选择节目类型">
          <el-option label="录播" value="recorded" />
          <el-option label="直播" value="live" />
          <el-option label="广告" value="ad" />
        </el-select>
      </el-form-item>
      
      <el-form-item label="开始时间" prop="startTime">
        <el-time-picker
          v-model="formData.startTime"
          placeholder="选择开始时间"
          format="HH:mm:ss"
          value-format="HH:mm:ss"
        />
      </el-form-item>
      
      <el-form-item label="结束时间" prop="endTime">
        <el-time-picker
          v-model="formData.endTime"
          placeholder="选择结束时间"
          format="HH:mm:ss"
          value-format="HH:mm:ss"
        />
      </el-form-item>
      
      <el-form-item label="节目编号" prop="programCode">
        <el-input v-model="formData.programCode" placeholder="请输入节目编号" />
      </el-form-item>
      
      <el-form-item label="节目名称" prop="programName">
        <el-input v-model="formData.programName" placeholder="请输入节目名称" />
      </el-form-item>
      
      <el-form-item label="备注" prop="remark">
        <el-input
          v-model="formData.remark"
          type="textarea"
          :rows="3"
          placeholder="请输入备注"
        />
      </el-form-item>
    </el-form>
    
    <template #footer>
      <el-button @click="handleCancel">取消</el-button>
      <el-button type="primary" @click="handleSave">确定</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
// @ts-nocheck
import { ref, watch, computed } from 'vue'
import type { FormInstance, FormRules } from 'element-plus'
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
}>()

const dialogVisible = computed({
  get: () => props.modelValue,
  set: (val) => emit('update:modelValue', val),
})

const formRef = ref<FormInstance>()

const formData = ref({
  businessType: 'recorded' as 'recorded' | 'live' | 'ad',
  startTime: '',
  endTime: '',
  programCode: '',
  programName: '',
  remark: '',
})

const formRules: FormRules = {
  businessType: [{ required: true, message: '请选择节目类型', trigger: 'change' }],
  startTime: [{ required: true, message: '请选择开始时间', trigger: 'change' }],
  endTime: [{ required: true, message: '请选择结束时间', trigger: 'change' }],
}

watch(
  () => props.modelValue,
  (val) => {
    if (val) {
      if (props.item) {
        formData.value = {
          businessType: props.item.businessType || 'recorded',
          startTime: props.item.startTime,
          endTime: props.item.endTime,
          programCode: props.item.programCode || '',
          programName: props.item.programName || '',
          remark: props.item.remark || '',
        }
      } else {
        formData.value = {
          businessType: 'recorded',
          startTime: props.defaultStartTime || '',
          endTime: props.defaultEndTime || '',
          programCode: '',
          programName: '',
          remark: '',
        }
      }
    }
  },
)

const handleCancel = () => {
  dialogVisible.value = false
}

const handleSave = async () => {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return

  const newItem: Partial<ScheduleItem> = {
    ...formData.value,
    sortOrder: (props.maxSortOrder || 0) + 1,
    sourceType: formData.value.businessType === 'live' ? 'live' : 'recorded',
  }

  emit('save', newItem)
  dialogVisible.value = false
}
</script>
