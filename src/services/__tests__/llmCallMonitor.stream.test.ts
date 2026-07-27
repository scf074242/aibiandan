import { describe, expect, it, beforeEach, vi } from 'vitest'

import { getLlmCallMonitor } from '@/services/agent/llmCallMonitor'
import { LLMClient } from '@/services/llm/llmClient'

/**
 * 构造一个内部 SDK 流式请求被 mock 的 LLMClient
 */
const createClientWithMockedStream = (create: ReturnType<typeof vi.fn>) => {
  const client = new LLMClient({
    apiKey: 'test-key',
    baseURL: 'https://example.test/v1',
    model: 'test-model',
    timeout: 100,
  })
  ;(client as unknown as {
    client: {
      chat: {
        completions: {
          create: ReturnType<typeof vi.fn>
        }
      }
    }
  }).client = {
    chat: {
      completions: {
        create,
      },
    },
  }
  return client
}

/**
 * 把字符串数组封装为 async iterable，模拟 OpenAI SDK 的 stream 返回值
 */
const mockStream = (chunks: string[]) => ({
  async *[Symbol.asyncIterator]() {
    for (const chunk of chunks) {
      yield { choices: [{ delta: { content: chunk } }] }
    }
  },
})

describe('LlmCallMonitor chatStream integration', () => {
  beforeEach(() => {
    getLlmCallMonitor().clear()
  })

  /**
   * case c2-monitor-stream-success
   * - expectedDecision: chatStream 成功后 LlmCallMonitor 记录 success 与正确 tokenUsage
   * - mustNotHappen: 记录缺失；tokenUsage 错误
   */
  it('records monitor entry after successful chatStream', async () => {
    const create = vi.fn().mockResolvedValue(mockStream(['a', 'b', 'c']))
    const client = createClientWithMockedStream(create)

    const collected: string[] = []
    for await (const chunk of client.chatStream(
      [{ role: 'user', content: 'hello' }],
      { traceLabel: 'stream_success_test' },
    )) {
      collected.push(chunk)
    }

    expect(collected).toEqual(['a', 'b', 'c'])

    const snapshot = getLlmCallMonitor().snapshot()
    expect(snapshot).toHaveLength(1)
    expect(snapshot[0]).toMatchObject({
      stage: 'stream_success_test',
      status: 'success',
      model: 'test-model',
      tokenUsage: { prompt: 2, completion: 3, total: 5 },
    })
  })

  /**
   * case c2-monitor-stream-error
   * - expectedDecision: chatStream 抛错后 LlmCallMonitor 仍落盘，status 为 error
   * - mustNotHappen: 抛错后未记录；status 为 success
   */
  it('records monitor entry after chatStream failure', async () => {
    const create = vi.fn().mockRejectedValue(new Error('stream network down'))
    const client = createClientWithMockedStream(create)

    await expect(async () => {
      for await (const _ of client.chatStream(
        [{ role: 'user', content: 'hello' }],
        { traceLabel: 'stream_failure_test' },
      )) {
        // 不应到达
      }
    }).rejects.toThrow('stream network down')

    const snapshot = getLlmCallMonitor().snapshot()
    expect(snapshot).toHaveLength(1)
    expect(snapshot[0]).toMatchObject({
      stage: 'stream_failure_test',
      status: 'error',
      model: 'test-model',
      tokenUsage: { prompt: 0, completion: 0, total: 0 },
    })
    expect(snapshot[0]!.errorMessage).toContain('stream network down')
  })
})