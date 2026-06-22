import type { LLMConfig } from '@/types/llm'
import { isPlaceholderApiKey } from './localDemoLlm'

const DEFAULT_CONFIG: LLMConfig = {
  baseURL: 'https://api.siliconflow.cn/v1',
  apiKey: '',
  model: 'deepseek-ai/DeepSeek-V4-Flash',
  temperature: 0.3,
  maxTokens: 8192,
  timeout: 15000,
}

const STORAGE_KEY = 'llm_config'
const SHARED_COOKIE_KEY = 'llm_config_shared'
const DEFAULT_MODEL = DEFAULT_CONFIG.model
const DEPRECATED_AUTO_UPGRADE_MODELS = new Set([
  'deepseek-ai/DeepSeek-V3.2',
  'deepseek-ai/DeepSeek-V3.2-Exp',
])

const readRuntimeEnv = (key: string): string | undefined => {
  const viteEnv = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env
  const viteValue = viteEnv?.[key]
  if (viteValue) return viteValue
  const nodeProcess = (globalThis as typeof globalThis & {
    process?: { env?: Record<string, string | undefined> }
  }).process
  return nodeProcess?.env?.[key]
}

const readFirstRuntimeEnv = (
  keys: string[],
  options: { rejectPlaceholderApiKey?: boolean } = {},
): string | undefined => {
  for (const key of keys) {
    const value = readRuntimeEnv(key)
    if (value === undefined || value === '') continue
    if (options.rejectPlaceholderApiKey && isPlaceholderApiKey(String(value))) continue
    return value
  }
  return undefined
}

const migrateDeprecatedModel = (config: Partial<LLMConfig>): Partial<LLMConfig> => {
  if (typeof config.model === 'string' && DEPRECATED_AUTO_UPGRADE_MODELS.has(config.model)) {
    return {
      ...config,
      model: DEFAULT_MODEL,
    }
  }
  return config
}

const hasConfigValue = (config: Partial<LLMConfig>): boolean => Object.keys(config).length > 0

const mergeStoredConfig = (
  sharedConfig: Partial<LLMConfig>,
  localConfig: Partial<LLMConfig>,
): Partial<LLMConfig> => {
  const merged = {
    ...sharedConfig,
    ...localConfig,
  }
  if (
    isPlaceholderApiKey(localConfig.apiKey)
    && !isPlaceholderApiKey(sharedConfig.apiKey)
  ) {
    merged.apiKey = sharedConfig.apiKey
  }
  return merged
}

const readLocalConfig = (): Partial<LLMConfig> => {
  if (typeof localStorage === 'undefined') return {}
  const stored = localStorage.getItem(STORAGE_KEY)
  return stored ? JSON.parse(stored) as Partial<LLMConfig> : {}
}

const writeLocalConfig = (config: Partial<LLMConfig>): void => {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
}

const readSharedConfig = (): Partial<LLMConfig> => {
  if (typeof document === 'undefined') return {}
  const cookie = document.cookie
    .split(';')
    .map((item) => item.trim())
    .find((item) => item.startsWith(`${SHARED_COOKIE_KEY}=`))
  if (!cookie) return {}
  return JSON.parse(decodeURIComponent(cookie.slice(SHARED_COOKIE_KEY.length + 1))) as Partial<LLMConfig>
}

const writeSharedConfig = (config: Partial<LLMConfig>): void => {
  if (typeof document === 'undefined') return
  const value = encodeURIComponent(JSON.stringify(config))
  const maxAge = 60 * 60 * 24 * 365
  document.cookie = `${SHARED_COOKIE_KEY}=${value}; path=/; max-age=${maxAge}; SameSite=Lax`
}

const clearSharedConfig = (): void => {
  if (typeof document === 'undefined') return
  document.cookie = `${SHARED_COOKIE_KEY}=; path=/; max-age=0; SameSite=Lax`
}

const resolveStoredConfig = (): Partial<LLMConfig> => {
  const localConfig = readLocalConfig()
  const sharedConfig = readSharedConfig()
  const sourceConfig = mergeStoredConfig(sharedConfig, localConfig)
  const migrated = migrateDeprecatedModel(sourceConfig)

  if (hasConfigValue(migrated)) {
    writeLocalConfig(migrated)
    writeSharedConfig(migrated)
  }

  return migrated
}

export function loadLLMConfig(): LLMConfig {
  const envConfig: Partial<LLMConfig> = {
    baseURL: readFirstRuntimeEnv(['VITE_CODE_PLAN_LLM_BASE_URL', 'CODE_PLAN_LLM_BASE_URL', 'AGENT_LLM_BASE_URL']),
    apiKey: readFirstRuntimeEnv(
      ['VITE_CODE_PLAN_LLM_API_KEY', 'CODE_PLAN_LLM_API_KEY', 'AGENT_LLM_API_KEY'],
      { rejectPlaceholderApiKey: true },
    ),
    model: readFirstRuntimeEnv(['VITE_CODE_PLAN_LLM_MODEL', 'CODE_PLAN_LLM_MODEL', 'AGENT_LLM_MODEL']),
  }

  let storedConfig: Partial<LLMConfig> = {}
  try {
    storedConfig = resolveStoredConfig()
  } catch (error) {
    console.warn('Failed to load LLM config from local storage:', error)
  }

  return migrateDeprecatedModel({
    ...DEFAULT_CONFIG,
    ...storedConfig,
    ...Object.fromEntries(
      Object.entries(envConfig).filter(([key, value]) => {
        if (value === undefined || value === '') return false
        if (key === 'apiKey' && isPlaceholderApiKey(String(value))) return false
        return true
      }),
    ),
  }) as LLMConfig
}

export function saveLLMConfig(config: Partial<LLMConfig>): void {
  try {
    const current = loadLLMConfig()
    const nextConfig = { ...config }
    if (
      Object.prototype.hasOwnProperty.call(nextConfig, 'apiKey')
      && isPlaceholderApiKey(nextConfig.apiKey)
      && !isPlaceholderApiKey(current.apiKey)
    ) {
      delete nextConfig.apiKey
    }
    const newConfig = migrateDeprecatedModel({ ...current, ...nextConfig })
    writeLocalConfig(newConfig)
    writeSharedConfig(newConfig)
  } catch (error) {
    console.error('Failed to save LLM config:', error)
  }
}

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

export interface LLMReadiness {
  ready: boolean
  reason: 'configured' | 'browser_mock' | 'missing_api_key' | 'invalid_config'
  message: string
  errors: string[]
}

const hasBrowserLlmMock = (): boolean => {
  if (typeof window === 'undefined') return false
  const browserWindow = window as Window & { __AIBIANDAN_LLM_MOCK__?: unknown }
  return typeof browserWindow.__AIBIANDAN_LLM_MOCK__ === 'function'
}

export function resolveLLMReadiness(options: { allowBrowserMock?: boolean } = {}): LLMReadiness {
  const config = loadLLMConfig()
  const validation = validateLLMConfig(config)
  if (validation.valid) {
    return {
      ready: true,
      reason: 'configured',
      message: '模型配置可用。',
      errors: [],
    }
  }

  if (options.allowBrowserMock && hasBrowserLlmMock()) {
    return {
      ready: true,
      reason: 'browser_mock',
      message: '当前使用浏览器测试模型。',
      errors: validation.errors,
    }
  }

  const missingApiKey = validation.errors.some((error) => error.includes('API Key'))
  return {
    ready: false,
    reason: missingApiKey ? 'missing_api_key' : 'invalid_config',
    message: missingApiKey
      ? '我现在还不能开始编排，因为模型 API Key 还没有配置。请先点右上角“LLM配置”填写并保存；在配置好之前，我不会改动草案或正式播单。'
      : `模型配置还不完整：${validation.errors.join('；')}。请先在“LLM配置”里检查后再继续。`,
    errors: validation.errors,
  }
}

export function getDefaultConfig(): LLMConfig {
  return { ...DEFAULT_CONFIG }
}

export function clearLLMConfig(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
    clearSharedConfig()
  } catch (error) {
    console.error('Failed to clear LLM config:', error)
  }
}
