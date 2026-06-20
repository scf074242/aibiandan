import { beforeEach, describe, expect, it, vi } from 'vitest'

import { clearLLMConfig, getDefaultConfig, loadLLMConfig, saveLLMConfig } from '@/services/llm/llmConfig'

const storage = new Map<string, string>()
let cookieValue = ''

const installDocumentCookieMock = () => {
  vi.stubGlobal('document', {
    get cookie() {
      return cookieValue
    },
    set cookie(value: string) {
      const [pair = ''] = value.split(';')
      const [key = '', rawCookieValue = ''] = pair.split('=')
      if (!key) return
      if (/max-age=0/i.test(value)) {
        cookieValue = cookieValue
          .split(';')
          .map((item) => item.trim())
          .filter((item) => item && !item.startsWith(`${key}=`))
          .join('; ')
        return
      }
      const nextCookie = `${key}=${rawCookieValue}`
      const cookies = cookieValue
        .split(';')
        .map((item) => item.trim())
        .filter((item) => item && !item.startsWith(`${key}=`))
      cookies.push(nextCookie)
      cookieValue = cookies.join('; ')
    },
  })
}

beforeEach(() => {
  storage.clear()
  cookieValue = ''
  installDocumentCookieMock()
  vi.stubGlobal('localStorage', {
    getItem: vi.fn((key: string) => storage.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      storage.set(key, value)
    }),
    removeItem: vi.fn((key: string) => {
      storage.delete(key)
    }),
  })
})

describe('llmConfig', () => {
  it('defaults to DeepSeek V4 Flash', () => {
    expect(getDefaultConfig().model).toBe('deepseek-ai/DeepSeek-V4-Flash')
    expect(loadLLMConfig().model).toBe('deepseek-ai/DeepSeek-V4-Flash')
  })

  it('migrates deprecated DeepSeek 3.2 local config to DeepSeek V4 Flash and persists the upgrade', () => {
    storage.set('llm_config', JSON.stringify({
      baseURL: 'https://api.siliconflow.cn/v1',
      apiKey: 'sk-existing',
      model: 'deepseek-ai/DeepSeek-V3.2',
      temperature: 0.3,
      maxTokens: 8192,
      timeout: 60000,
    }))

    const config = loadLLMConfig()

    expect(config.model).toBe('deepseek-ai/DeepSeek-V4-Flash')
    expect(JSON.parse(storage.get('llm_config') ?? '{}')).toMatchObject({
      model: 'deepseek-ai/DeepSeek-V4-Flash',
      apiKey: 'sk-existing',
    })
  })

  it('does not allow saving deprecated DeepSeek 3.2 variants back over the default model', () => {
    saveLLMConfig({
      apiKey: 'sk-existing',
      model: 'deepseek-ai/DeepSeek-V3.2-Exp',
    })

    expect(JSON.parse(storage.get('llm_config') ?? '{}')).toMatchObject({
      apiKey: 'sk-existing',
      model: 'deepseek-ai/DeepSeek-V4-Flash',
    })
  })

  it('keeps the existing API key when saving other LLM settings with an empty key field', () => {
    saveLLMConfig({
      apiKey: 'sk-existing',
      model: 'deepseek-ai/DeepSeek-V4-Flash',
      timeout: 15000,
    })

    saveLLMConfig({
      apiKey: '',
      model: 'deepseek-ai/DeepSeek-R1',
      timeout: 60000,
    })

    expect(loadLLMConfig()).toMatchObject({
      apiKey: 'sk-existing',
      model: 'deepseek-ai/DeepSeek-R1',
      timeout: 60000,
    })
    expect(JSON.parse(storage.get('llm_config') ?? '{}')).toMatchObject({
      apiKey: 'sk-existing',
      model: 'deepseek-ai/DeepSeek-R1',
    })
  })

  it('shares saved LLM config across local development ports through a host-level cookie copy', () => {
    saveLLMConfig({
      apiKey: 'sk-shared',
      model: 'deepseek-ai/DeepSeek-V4-Flash',
      timeout: 60000,
    })

    expect(JSON.parse(storage.get('llm_config') ?? '{}')).toMatchObject({
      apiKey: 'sk-shared',
      model: 'deepseek-ai/DeepSeek-V4-Flash',
    })
    expect(document.cookie).toContain('llm_config_shared=')

    storage.clear()
    const restored = loadLLMConfig()

    expect(restored).toMatchObject({
      apiKey: 'sk-shared',
      model: 'deepseek-ai/DeepSeek-V4-Flash',
      timeout: 60000,
    })
    expect(JSON.parse(storage.get('llm_config') ?? '{}')).toMatchObject({
      apiKey: 'sk-shared',
    })
  })

  it('restores the shared API key when the origin-local config only has model settings', () => {
    saveLLMConfig({
      apiKey: 'sk-shared',
      model: 'deepseek-ai/DeepSeek-V4-Flash',
      timeout: 60000,
    })
    storage.set('llm_config', JSON.stringify({
      baseURL: 'https://api.siliconflow.cn/v1',
      apiKey: '',
      model: 'deepseek-ai/DeepSeek-R1',
      temperature: 0.3,
      maxTokens: 8192,
      timeout: 45000,
    }))

    const restored = loadLLMConfig()

    expect(restored).toMatchObject({
      apiKey: 'sk-shared',
      model: 'deepseek-ai/DeepSeek-R1',
      timeout: 45000,
    })
    expect(JSON.parse(storage.get('llm_config') ?? '{}')).toMatchObject({
      apiKey: 'sk-shared',
      model: 'deepseek-ai/DeepSeek-R1',
    })
  })

  it('does not let a placeholder origin-local key overwrite the shared real API key', () => {
    saveLLMConfig({
      apiKey: 'sk-shared',
      model: 'deepseek-ai/DeepSeek-V4-Flash',
    })
    storage.set('llm_config', JSON.stringify({
      apiKey: 'YOUR_API_KEY',
      model: 'deepseek-ai/DeepSeek-R1',
    }))

    expect(loadLLMConfig()).toMatchObject({
      apiKey: 'sk-shared',
      model: 'deepseek-ai/DeepSeek-R1',
    })
  })

  it('keeps an explicit origin-local API key over the shared cookie copy', () => {
    saveLLMConfig({ apiKey: 'sk-shared' })
    storage.set('llm_config', JSON.stringify({
      apiKey: 'sk-local',
      model: 'deepseek-ai/DeepSeek-R1',
    }))

    expect(loadLLMConfig()).toMatchObject({
      apiKey: 'sk-local',
      model: 'deepseek-ai/DeepSeek-R1',
    })
  })

  it('clears both the origin-local and shared LLM config copies', () => {
    saveLLMConfig({ apiKey: 'sk-shared' })

    clearLLMConfig()

    expect(storage.has('llm_config')).toBe(false)
    expect(document.cookie).not.toContain('llm_config_shared=')
  })
})
