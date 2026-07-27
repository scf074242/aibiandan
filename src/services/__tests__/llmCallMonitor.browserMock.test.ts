import { afterEach, describe, expect, it, beforeEach, vi } from 'vitest'

import { getLlmCallMonitor } from '@/services/agent/llmCallMonitor'
import { LLMClient } from '@/services/llm/llmClient'

describe('LlmCallMonitor browser mock integration', () => {
  beforeEach(() => {
    getLlmCallMonitor().clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  /**
   * case c2-monitor-browser-mock-success
   * - expectedDecision: browser mock 命中后 LlmCallMonitor 记录 success 与 usage
   * - mustNotHappen: 记录缺失；tokenUsage 使用 chat 路径的 prompt_tokens 格式
   */
  it('records monitor entry for browser mock success', async () => {
    vi.stubGlobal('window', {
      __AIBIANDAN_LLM_MOCK__: vi.fn(async () => ({
        content: 'browser mock ok',
        usage: {
          promptTokens: 8,
          completionTokens: 4,
          totalTokens: 12,
        },
      })),
    })

    const client = new LLMClient({
      baseURL: 'https://api.example.com/v1',
      apiKey: '',
      model: 'browser-mock-model',
      timeout: 500,
    })

    const result = await client.chat([{ role: 'user', content: '测试浏览器 mock' }], {
      traceLabel: 'browser_mock_success_test',
    })

    expect(result.content).toBe('browser mock ok')

    const snapshot = getLlmCallMonitor().snapshot()
    expect(snapshot).toHaveLength(1)
    expect(snapshot[0]).toMatchObject({
      stage: 'browser_mock_success_test',
      status: 'success',
      model: 'browser-mock-model',
      tokenUsage: { prompt: 8, completion: 4, total: 12 },
    })
  })

  /**
   * case c2-monitor-browser-mock-error
   * - expectedDecision: browser mock 抛错后 LlmCallMonitor 记录 error
   * - mustNotHappen: 未记录；状态被推断为 timeout
   */
  it('records monitor entry for browser mock failure', async () => {
    vi.stubGlobal('window', {
      __AIBIANDAN_LLM_MOCK__: vi.fn(async () => {
        throw new Error('browser mock failure')
      }),
    })

    const client = new LLMClient({
      baseURL: 'https://api.example.com/v1',
      apiKey: '',
      model: 'browser-mock-model',
      timeout: 500,
    })

    await expect(
      client.chat([{ role: 'user', content: '测试失败' }], {
        traceLabel: 'browser_mock_failure_test',
      }),
    ).rejects.toThrow('browser mock failure')

    const snapshot = getLlmCallMonitor().snapshot()
    expect(snapshot).toHaveLength(1)
    expect(snapshot[0]).toMatchObject({
      stage: 'browser_mock_failure_test',
      status: 'error',
      model: 'browser-mock-model',
    })
    expect(snapshot[0]!.errorMessage).toContain('browser mock failure')
  })
})