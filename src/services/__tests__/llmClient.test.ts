import { describe, expect, it, vi } from 'vitest'

import { LLMClient } from '@/services/llm/llmClient'

const createClientWithMockedRequest = (request: ReturnType<typeof vi.fn>) => {
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
        create: request,
      },
    },
  }

  return client
}

describe('LLMClient', () => {
  it('passes per-call timeout and retry options to the SDK request', async () => {
    const request = vi.fn().mockResolvedValue({
      choices: [{ message: { content: '{"ok":true}' } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    })
    const client = createClientWithMockedRequest(request)

    const result = await client.chat([{ role: 'user', content: 'hello' }], {
      timeout: 4321,
      maxRetries: 1,
      traceLabel: 'unit_test',
    })

    expect(result.content).toBe('{"ok":true}')
    expect(request).toHaveBeenCalledWith(expect.any(Object), { timeout: 4321 })
    expect(client.getRecentRequestTraces()[0]).toMatchObject({
      label: 'unit_test',
      timeoutMs: 4321,
      messageCount: 1,
      promptCharCount: 5,
      userCharCount: 5,
      success: true,
    })
  })

  it('fails fast when the SDK request never settles', async () => {
    vi.useFakeTimers()
    const request = vi.fn(() => new Promise(() => {}))
    const client = createClientWithMockedRequest(request)

    const pending = expect(client.chat([{ role: 'user', content: 'hello' }], {
      timeout: 100,
      maxRetries: 1,
      traceLabel: 'timeout_test',
    })).rejects.toThrow('LLM request failed after 1 attempt')
    await vi.advanceTimersByTimeAsync(101)

    await pending
    expect(client.getRecentRequestTraces()[0]).toMatchObject({
      label: 'timeout_test',
      timeoutMs: 100,
      success: false,
    })
    vi.useRealTimers()
  })

  it('does not retry deterministic authentication failures', async () => {
    const request = vi.fn().mockRejectedValue(Object.assign(new Error('bad key'), { status: 401 }))
    const client = createClientWithMockedRequest(request)

    await expect(client.chat([{ role: 'user', content: 'hello' }])).rejects.toThrow('LLM request failed after 1 attempt')

    expect(request).toHaveBeenCalledTimes(1)
  })

  it('short-circuits later calls after authentication failure until config changes', async () => {
    const request = vi.fn().mockRejectedValue(Object.assign(new Error('bad key'), { status: 401 }))
    const client = createClientWithMockedRequest(request)

    await expect(client.chat([{ role: 'user', content: 'hello' }])).rejects.toThrow('LLM request failed after 1 attempt')
    await expect(client.chat([{ role: 'user', content: 'again' }])).rejects.toThrow('LLM 认证失败')
    expect(request).toHaveBeenCalledTimes(1)

    client.updateConfig({ apiKey: 'new-key' })
    ;(client as unknown as {
      client: {
        chat: {
          completions: {
            create: ReturnType<typeof vi.fn>
          }
        }
      }
    }).client.chat.completions.create = request

    await expect(client.chat([{ role: 'user', content: 'after update' }])).rejects.toThrow('LLM request failed after 1 attempt')
    expect(request).toHaveBeenCalledTimes(2)
  })
})
