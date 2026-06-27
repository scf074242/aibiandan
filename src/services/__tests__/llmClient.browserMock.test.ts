import { afterEach, describe, expect, it, vi } from 'vitest'

import { LLMClient } from '@/services/llm/llmClient'

describe('LLMClient browser mock hook', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('uses the browser mock in dev mode before requiring a real API key', async () => {
    const browserWindow = {
      __AIBIANDAN_LLM_MOCK__: vi.fn(async () => ({
        content: '{"actions":[{"type":"clarify"}],"assistantReplyDraft":"我已经收到。"}',
        usage: {
          promptTokens: 10,
          completionTokens: 5,
          totalTokens: 15,
        },
      })),
    }
    vi.stubGlobal('window', browserWindow)

    const client = new LLMClient({
      baseURL: 'https://api.siliconflow.cn/v1',
      apiKey: '',
      model: 'deepseek-ai/DeepSeek-V4-Flash',
      timeout: 500,
    })

    const response = await client.chat([{ role: 'user', content: '测试' }], {
      traceLabel: 'agent_planner',
    })

    expect(response.content).toContain('assistantReplyDraft')
    expect(browserWindow.__AIBIANDAN_LLM_MOCK__).toHaveBeenCalledWith(expect.objectContaining({
      messages: [{ role: 'user', content: '测试' }],
      options: expect.objectContaining({ traceLabel: 'agent_planner' }),
      config: expect.objectContaining({ model: 'deepseek-ai/DeepSeek-V4-Flash' }),
    }))
    expect(client.getTokenUsage()).toMatchObject({
      totalPromptTokens: 10,
      totalCompletionTokens: 5,
      totalTokens: 15,
      requestCount: 1,
    })
    expect(client.getRecentRequestTraces()[0]).toMatchObject({
      label: 'agent_planner',
      attemptCount: 1,
      messageCount: 1,
      promptCharCount: 2,
      userCharCount: 2,
      success: true,
    })
  })

  it('propagates browser mock failures as LLM failures with trace evidence', async () => {
    vi.stubGlobal('window', {
      __AIBIANDAN_LLM_MOCK__: vi.fn(async () => {
        throw new Error('mock model timeout')
      }),
    })

    const client = new LLMClient({
      baseURL: 'https://api.siliconflow.cn/v1',
      apiKey: '',
      model: 'deepseek-ai/DeepSeek-V4-Flash',
      timeout: 500,
    })

    await expect(client.chat([{ role: 'user', content: '测试失败' }])).rejects.toThrow('mock model timeout')
    expect(client.getRecentRequestTraces()[0]).toMatchObject({
      success: false,
      error: 'mock model timeout',
    })
  })
})
