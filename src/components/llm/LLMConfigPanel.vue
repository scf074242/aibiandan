<template>
  <div class="llm-config-panel">
    <el-form ref="formRef" :model="config" :rules="rules" label-position="top" class="config-form">
      <el-form-item label="API Key" prop="apiKey">
        <el-input v-model="config.apiKey" type="password" show-password placeholder="请输入 SiliconFlow API Key" />
      </el-form-item>

      <el-form-item label="Base URL" prop="baseURL">
        <el-input v-model="config.baseURL" placeholder="https://api.siliconflow.cn/v1" />
      </el-form-item>

      <el-form-item label="模型" prop="model">
        <el-select v-model="config.model" style="width: 100%">
          <el-option label="DeepSeek V4 Flash" value="deepseek-ai/DeepSeek-V4-Flash" />
          <el-option label="DeepSeek V3" value="deepseek-ai/DeepSeek-V3" />
          <el-option label="DeepSeek R1" value="deepseek-ai/DeepSeek-R1" />
        </el-select>
      </el-form-item>

      <el-form-item label="Temperature" prop="temperature">
        <div class="slider-with-value">
          <el-slider v-model="config.temperature" :min="0" :max="2" :step="0.1" show-stops />
          <span class="slider-value">{{ config.temperature }}</span>
        </div>
      </el-form-item>

      <el-form-item label="Max Tokens" prop="maxTokens">
        <el-input-number v-model="config.maxTokens" :min="1" :max="32768" :step="1024" style="width: 100%" />
      </el-form-item>

      <el-form-item label="Timeout (ms)" prop="timeout">
        <el-input-number v-model="config.timeout" :min="5000" :max="300000" :step="5000" style="width: 100%" />
      </el-form-item>
    </el-form>

    <div class="config-actions">
      <el-button type="primary" :loading="testing" @click="testConnection">测试连接</el-button>
      <el-button @click="saveConfigHandler">保存配置</el-button>
      <el-button @click="resetConfigHandler">重置</el-button>
    </div>

    <div v-if="testResult" class="test-result">
      <el-alert :title="testResult.message" :type="testResult.success ? 'success' : 'error'" :closable="false" show-icon />
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import type { FormInstance, FormRules } from 'element-plus'
import type { LLMConfig } from '@/types/llm'
import { getDefaultConfig, loadLLMConfig, saveLLMConfig } from '@/services/llm/llmConfig'
import { getLLMClient, resetLLMClient } from '@/services/llm/llmClient'

const formRef = ref<FormInstance>()
const testing = ref(false)
const testResult = ref<{ success: boolean; message: string } | null>(null)

const config = reactive<LLMConfig>({
  baseURL: 'https://api.siliconflow.cn/v1',
  apiKey: '',
  model: 'deepseek-ai/DeepSeek-V4-Flash',
  temperature: 0.3,
  maxTokens: 8192,
  timeout: 15000,
})

const rules: FormRules = {
  apiKey: [{ required: true, message: '请输入 API Key', trigger: 'blur' }],
  baseURL: [{ required: true, message: '请输入 Base URL', trigger: 'blur' }],
  model: [{ required: true, message: '请选择模型', trigger: 'change' }],
}

onMounted(() => {
  Object.assign(config, loadLLMConfig())
})

const testConnection = async () => {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return

  testing.value = true
  testResult.value = null

  try {
    resetLLMClient()
    const client = getLLMClient()
    client.updateConfig({ ...config })
    const success = await client.testConnection()
    testResult.value = {
      success,
      message: success ? '连接成功，当前配置可用。' : '连接失败，请检查 API Key、Base URL 或模型名称。',
    }
  } catch (error) {
    testResult.value = {
      success: false,
      message: error instanceof Error ? error.message : '连接测试失败',
    }
  } finally {
    testing.value = false
  }
}

const saveConfigHandler = async () => {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return

  saveLLMConfig({ ...config })
  resetLLMClient()
  ElMessage.success('LLM 配置已保存')
}

const resetConfigHandler = () => {
  Object.assign(config, getDefaultConfig())
  testResult.value = null
  ElMessage.info('已恢复默认配置')
}
</script>

<style scoped lang="scss">
.llm-config-panel {
  padding: 16px;
}

.config-form {
  .el-form-item {
    margin-bottom: 20px;
  }
}

.slider-with-value {
  display: flex;
  align-items: center;
  gap: 16px;

  .el-slider {
    flex: 1;
  }

  .slider-value {
    min-width: 40px;
    text-align: right;
    font-weight: 500;
    color: var(--el-text-color-primary);
  }
}

.config-actions {
  display: flex;
  gap: 12px;
  margin-top: 24px;
  padding-top: 16px;
  border-top: 1px solid var(--el-border-color-lighter);
}

.test-result {
  margin-top: 16px;
}
</style>
