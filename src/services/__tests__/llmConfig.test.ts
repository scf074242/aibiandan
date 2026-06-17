import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getDefaultConfig, loadLLMConfig, saveLLMConfig } from '@/services/llm/llmConfig'

const storage = new Map<string, string>()

beforeEach(() => {
  storage.clear()
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
})
