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
