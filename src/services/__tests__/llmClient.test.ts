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
  /**
   * case llm-transient-failure-retries-within-stage-budget
   * - userInput: 长流程 decide 遇到一次 503 后继续
   * - expectedDecision: transport 在同一 stage timeout 和 AbortSignal 内有限重试并记录 attemptCount
   * - mustNotHappen: 重试认证/参数错误、越过 stage deadline、把重试解释成新的用户意图
   * - verification: 第一次 503、第二次成功，trace attemptCount=2
   */
  it('retries a transient service failure within the same request budget', async () => {
    vi.useFakeTimers()
    const request = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('temporary outage'), { status: 503 }))
      .mockResolvedValueOnce({
        choices: [{ message: { content: '{"kind":"complete"}' } }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      })
    const client = createClientWithMockedRequest(request)
    const pending = client.chat([{ role: 'user', content: 'continue' }], {
      timeout: 5_000, maxRetries: 2, traceLabel: 'transient_retry_test',
    })

    await vi.advanceTimersByTimeAsync(1_001)
    const result = await pending

    expect(result.content).toBe('{"kind":"complete"}')
    expect(request).toHaveBeenCalledTimes(2)
    expect(client.getRecentRequestTraces()[0]).toMatchObject({ attemptCount: 2, success: true })
    vi.useRealTimers()
  })

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

  /**
   * case llm-stage-timeout-honors-agent-deadline-budget
   * - userInput: AgentDeadline 为复杂意图解析分配 90 秒 stage 预算
   * - expectedDecision: LLMClient 将 90 秒原样传给 SDK，不再被历史 60 秒上限截断
   * - mustNotHappen: transport 层覆盖统一 deadline、复杂思考在 60 秒被提前终止
   * - verification: SDK timeout 与 trace timeoutMs 均为 90000
   */
  it('honors a stage timeout above the historical 60 second transport cap', async () => {
    const request = vi.fn().mockResolvedValue({
      choices: [{ message: { content: '{"ok":true}' } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    })
    const client = createClientWithMockedRequest(request)

    await client.chat([{ role: 'user', content: 'complex request' }], {
      timeout: 90_000,
      maxRetries: 1,
      traceLabel: 'agent_deadline_budget_test',
    })

    expect(request).toHaveBeenCalledWith(expect.any(Object), { timeout: 90_000 })
    expect(client.getRecentRequestTraces()[0]).toMatchObject({ timeoutMs: 90_000, success: true })
  })

  /**
   * case llm-json-object-format-propagates-to-sdk
   * - userInput: intent interpreter requests structured JSON
   * - expectedDecision: transport forwards json_object to the OpenAI-compatible SDK
   * - mustNotHappen: rely on prompt text alone or drop the option from streaming calls
   * - verification: SDK body.response_format.type=json_object
   */
  it('passes the JSON object response format to the SDK request', async () => {
    const request = vi.fn().mockResolvedValue({
      choices: [{ message: { content: '{"ok":true}' } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    })
    const client = createClientWithMockedRequest(request)

    await client.chat([{ role: 'user', content: 'structured request' }], {
      responseFormat: 'json_object',
    })

    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({ response_format: { type: 'json_object' } }),
      expect.any(Object),
    )
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
