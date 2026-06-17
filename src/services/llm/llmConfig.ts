/**
 * LLM 配置管理
 */
import type { LLMConfig } from '@/types/llm'
import { isPlaceholderApiKey } from './localDemoLlm'

// 默认配置
const DEFAULT_CONFIG: LLMConfig = {
  baseURL: 'https://api.siliconflow.cn/v1',
  apiKey: '',
  model: 'deepseek-ai/DeepSeek-V4-Flash',
  temperature: 0.3,
  maxTokens: 8192,
  timeout: 15000,
}

// 本地存储键名
const STORAGE_KEY = 'llm_config'
const DEFAULT_MODEL = DEFAULT_CONFIG.model
const DEPRECATED_AUTO_UPGRADE_MODELS = new Set([
  'deepseek-ai/DeepSeek-V3.2',
  'deepseek-ai/DeepSeek-V3.2-Exp',
])

const migrateDeprecatedModel = (config: Partial<LLMConfig>): Partial<LLMConfig> => {
  if (typeof config.model === 'string' && DEPRECATED_AUTO_UPGRADE_MODELS.has(config.model)) {
    return {
      ...config,
      model: DEFAULT_MODEL,
    }
  }
  return config
}

/**
 * 加载配置
 * 优先级：环境变量 > 本地存储 > 默认配置
 */
export function loadLLMConfig(): LLMConfig {
  // 从环境变量读取
  const envConfig: Partial<LLMConfig> = {
    baseURL: import.meta.env.VITE_CODE_PLAN_LLM_BASE_URL,
    apiKey: import.meta.env.VITE_CODE_PLAN_LLM_API_KEY,
    model: import.meta.env.VITE_CODE_PLAN_LLM_MODEL,
  }

  // 从本地存储读取
  let localConfig: Partial<LLMConfig> = {}
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<LLMConfig>
      localConfig = migrateDeprecatedModel(parsed)
      if (localConfig.model !== parsed.model) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(localConfig))
      }
    }
  } catch (e) {
    console.warn('Failed to load LLM config from localStorage:', e)
  }

  // 合并配置（环境变量优先级最高）
  return migrateDeprecatedModel({
    ...DEFAULT_CONFIG,
    ...localConfig,
    ...Object.fromEntries(
      Object.entries(envConfig).filter(([key, v]) => {
        if (v === undefined || v === '') {
          return false
        }
        if (key === 'apiKey' && isPlaceholderApiKey(String(v))) {
          return false
        }
        return true
      }),
    ),
  }) as LLMConfig
}

/**
 * 保存配置到本地存储
 */
export function saveLLMConfig(config: Partial<LLMConfig>): void {
  try {
    const current = loadLLMConfig()
    const newConfig = migrateDeprecatedModel({ ...current, ...config })
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newConfig))
  } catch (e) {
    console.error('Failed to save LLM config:', e)
  }
}

/**
 * 验证配置是否有效
 */
export function validateLLMConfig(config: LLMConfig): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  if (isPlaceholderApiKey(config.apiKey)) {
    errors.push('API Key 不能为空')
  }

  if (!config.baseURL || config.baseURL.trim() === '') {
    errors.push('Base URL 不能为空')
  }

  if (!config.model || config.model.trim() === '') {
    errors.push('模型名称不能为空')
  }

  if (config.temperature < 0 || config.temperature > 2) {
    errors.push('Temperature 必须在 0-2 之间')
  }

  if (config.maxTokens < 1 || config.maxTokens > 32768) {
    errors.push('Max Tokens 必须在 1-32768 之间')
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}

/**
 * 获取默认配置
 */
export function getDefaultConfig(): LLMConfig {
  return { ...DEFAULT_CONFIG }
}

/**
 * 清除本地存储的配置
 */
export function clearLLMConfig(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch (e) {
    console.error('Failed to clear LLM config:', e)
  }
}
