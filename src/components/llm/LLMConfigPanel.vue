<template>
  <div class="llm-config-panel">
    <el-form
      ref="formRef"
      :model="config"
      :rules="rules"
      label-position="top"
      class="config-form"
    >
      <el-form-item label="API Key" prop="apiKey">
        <el-input
          v-model="config.apiKey"
          type="password"
          show-password
          placeholder="请输入 Kimi API Key"
        />
      </el-form-item>

      <el-form-item label="Base URL" prop="baseURL">
        <el-input
          v-model="config.baseURL"
          placeholder="https://api.moonshot.cn/v1"
        />
      </el-form-item>

      <el-form-item label="模型" prop="model">
        <el-select v-model="config.model" style="width: 100%">
          <el-option label="Kimi K2.5" value="kimi-k2.5" />
          <el-option label="Kimi K2.5 32K" value="kimi-k2.5-32k" />
        </el-select>
      </el-form-item>

      <el-form-item label="Temperature" prop="temperature">
        <div class="slider-with-value">
          <el-slider
            v-model="config.temperature"
            :min="0"
            :max="2"
            :step="0.1"
            show-stops
          />
          <span class="slider-value">{{ config.temperature }}</span>
        </div>
      </el-form-item>

      <el-form-item label="Max Tokens" prop="maxTokens">
        <el-input-number
          v-model="config.maxTokens"
          :min="1"
          :max="32768"
          :step="1024"
          style="width: 100%"
        />
      </el-form-item>

      <el-form-item label="Timeout (ms)" prop="timeout">
        <el-input-number
          v-model="config.timeout"
          :min="5000"
          :max="300000"
          :step="5000"
          style="width: 100%"
        />
      </el-form-item>
    </el-form>

    <div class="config-actions">
      <el-button
        type="primary"
        :loading="testing"
        @click="testConnection"
      >
        测试连接
      </el-button>
      <el-button @click="saveConfig">保存配置</el-button>
      <el-button @click="resetConfig">重置</el-button>
    </div>

    <!-- 测试结果 -->
    <div v-if="testResult" class="test-result">
      <el-alert
        :title="testResult.message"
        :type="testResult.success ? 'success' : 'error'"
        :closable="false"
        show-icon
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import type { FormInstance, FormRules } from 'element-plus'
import type { LLMConfig } from '@/types/llm'
import { loadLLMConfig, saveLLMConfig, getDefaultConfig } from '@/services/llm/llmConfig'
import { getLLMClient, resetLLMClient } from '@/services/llm/llmClient'

const formRef = ref<FormInstance>()
const testing = ref(false)
const testResult = ref<{ success: boolean; message: string } | null>(null)

// 配置表单
const config = reactive<LLMConfig>({
  baseURL: '',
  apiKey: '',
  model: 'kimi-k2.5',
  temperature: 0.3,
  maxTokens: 8192,
  timeout: 60000,
})

// 验证规则
const rules: FormRules = {
  apiKey: [
    { required: true, message: '请输入 API Key', trigger: 'blur' },
  ],
  baseURL: [
    { required: true, message: '请输入 Base URL', trigger: 'blur' },
    { type: 'url', message: '请输入有效的 URL', trigger: 'blur' },
  ],
  model: [
    { required: true, message: '请选择模型', trigger: 'change' },
  ],
}

// 初始化
onMounted(() => {
  const savedConfig = loadLLMConfig()
  Object.assign(config, savedConfig)
})

// 测试连接
const testConnection = async () => {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return

  testing.value = true
  testResult.value = null

  try {
    // 重置客户端以使用新配置
    resetLLMClient()
    const client = getLLMClient()
    client.updateConfig({ ...config })

    const success = await client.testConnection()
    testResult.value = {
      success,
      message: success ? '连接成功！' : '连接失败，请检查配置',
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

// 保存配置
const saveConfig = async () => {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return

  saveLLMConfig({ ...config })
  resetLLMClient()
  ElMessage.success('配置已保存')
}

// 重置配置
const resetConfig = () => {
  const defaultConfig = getDefaultConfig()
  Object.assign(config, defaultConfig)
  testResult.value = null
  ElMessage.info('已重置为默认配置')
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
