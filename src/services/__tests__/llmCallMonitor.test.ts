import { describe, expect, it, beforeEach, vi } from 'vitest'

import {
  LlmCallMonitor,
  getLlmCallMonitor,
  inferLlmCallStatus,
  sanitizeErrorMessage,
} from '@/services/agent/llmCallMonitor'
import { LLMClient } from '@/services/llm/llmClient'

const createClientWithMockedRequest = (request: ReturnType<typeof vi.fn>) => {
  const client = new LLMClient({
    apiKey: 'test-key',
    baseURL: 'https://example.test/v1',
    model: 'test-model',
    timeout: 100,
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(client as any).client = {
    chat: {
      completions: {
        create: request,
      },
    },
  }

  return client
}

describe('LlmCallMonitor unit', () => {
  it('record assigns callId and timestamp', () => {
    const monitor = new LlmCallMonitor()

    monitor.record({
      stage: 'agent.intent_interpreter',
      model: 'moonshot-v1-8k',
      tokenUsage: { prompt: 10, completion: 5, total: 15 },
      latencyMs: 120,
      timeoutMs: 15000,
      attemptCount: 1,
      status: 'success',
      startedAt: new Date().toISOString(),
    })

    const snapshot = monitor.snapshot()
    expect(snapshot).toHaveLength(1)
    expect(snapshot[0]!.callId).toMatch(/^llm_call_/)
    expect(typeof snapshot[0]!.timestamp).toBe('number')
    expect(snapshot[0]!.stage).toBe('agent.intent_interpreter')
    expect(snapshot[0]!.model).toBe('moonshot-v1-8k')
  })

  it('snapshot returns items in chronological order', () => {
    const monitor = new LlmCallMonitor()

    monitor.record({
      stage: 'stage_first',
      model: 'model-a',
      tokenUsage: { prompt: 1, completion: 0, total: 1 },
      latencyMs: 1,
      timeoutMs: 100,
      attemptCount: 1,
      status: 'success',
      startedAt: new Date().toISOString(),
    })

    monitor.record({
      stage: 'stage_second',
      model: 'model-b',
      tokenUsage: { prompt: 2, completion: 0, total: 2 },
      latencyMs: 2,
      timeoutMs: 100,
      attemptCount: 1,
      status: 'success',
      startedAt: new Date().toISOString(),
    })

    const snapshot = monitor.snapshot()
    expect(snapshot).toHaveLength(2)
    expect(snapshot[0]!.stage).toBe('stage_first')
    expect(snapshot[1]!.stage).toBe('stage_second')
  })

  it('clear removes all items', () => {
    const monitor = new LlmCallMonitor()

    monitor.record({
      stage: 'agent.draft_generator',
      model: 'moonshot-v1-8k',
      tokenUsage: { prompt: 1, completion: 1, total: 2 },
      latencyMs: 100,
      timeoutMs: 15000,
      attemptCount: 1,
      status: 'success',
      startedAt: new Date().toISOString(),
    })

    expect(monitor.snapshot()).toHaveLength(1)
    monitor.clear()
    expect(monitor.snapshot()).toHaveLength(0)
  })

  it('aggregateByStage groups calls', () => {
    const monitor = new LlmCallMonitor()

    monitor.record({
      stage: 'stage_a',
      model: 'model-a',
      tokenUsage: { prompt: 10, completion: 5, total: 15 },
      latencyMs: 100,
      timeoutMs: 1000,
      attemptCount: 1,
      status: 'success',
      startedAt: new Date().toISOString(),
    })

    monitor.record({
      stage: 'stage_a',
      model: 'model-a',
      tokenUsage: { prompt: 20, completion: 10, total: 30 },
      latencyMs: 200,
      timeoutMs: 1000,
      attemptCount: 1,
      status: 'error',
      startedAt: new Date().toISOString(),
    })

    monitor.record({
      stage: 'stage_b',
      model: 'model-b',
      tokenUsage: { prompt: 5, completion: 0, total: 5 },
      latencyMs: 300,
      timeoutMs: 1000,
      attemptCount: 1,
      status: 'timeout',
      startedAt: new Date().toISOString(),
    })

    const aggregate = monitor.aggregateByStage()

    expect(aggregate).toHaveProperty('stage_a')
    expect(aggregate).toHaveProperty('stage_b')

    expect(aggregate['stage_a']).toMatchObject({
      calls: 2,
      totalTokens: 45,
      totalLatencyMs: 300,
      errors: 1,
      timeouts: 0,
    })

    expect(aggregate['stage_b']).toMatchObject({
      calls: 1,
      totalTokens: 5,
      totalLatencyMs: 300,
      errors: 0,
      timeouts: 1,
    })
  })
})

describe('inferLlmCallStatus', () => {
  it('returns success when success is true', () => {
    expect(inferLlmCallStatus(true)).toBe('success')
    expect(inferLlmCallStatus(true, 'some error')).toBe('success')
  })

  it('returns timeout when error contains timeout', () => {
    expect(inferLlmCallStatus(false, 'Request timed out')).toBe('timeout')
    expect(inferLlmCallStatus(false, 'ETIMEDOUT')).toBe('timeout')
    expect(inferLlmCallStatus(false, 'connection timeout after 5000ms')).toBe('timeout')
  })

  it('returns error otherwise', () => {
    expect(inferLlmCallStatus(false)).toBe('error')
    expect(inferLlmCallStatus(false, 'unknown failure')).toBe('error')
    expect(inferLlmCallStatus(false, 'bad request')).toBe('error')
  })
})

describe('sanitizeErrorMessage', () => {
  it('returns undefined for empty error', () => {
    expect(sanitizeErrorMessage(undefined)).toBeUndefined()
    expect(sanitizeErrorMessage('')).toBeUndefined()
  })

  it('truncates long errors to 200 chars with ellipsis', () => {
    const longError = 'a'.repeat(300)
    const result = sanitizeErrorMessage(longError)
    expect(result).toHaveLength(203)
    expect(result).toBe(`${'a'.repeat(200)}...`)
  })
})

describe('LLMClient integration with LlmCallMonitor', () => {
  beforeEach(() => {
    getLlmCallMonitor().clear()
  })

  it('records monitor entry after successful chat', async () => {
    const request = vi.fn().mockResolvedValue({
      choices: [{ message: { content: '{"ok":true}' } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    })
    const client = createClientWithMockedRequest(request)

    const result = await client.chat([{ role: 'user', content: 'hello' }], {
      timeout: 100,
      maxRetries: 1,
      traceLabel: 'unit_test',
    })

    expect(result.content).toBe('{"ok":true}')

    const snapshot = getLlmCallMonitor().snapshot()
    expect(snapshot).toHaveLength(1)
    expect(snapshot[0]).toMatchObject({
      stage: 'unit_test',
      status: 'success',
      model: 'test-model',
      tokenUsage: { prompt: 1, completion: 1, total: 2 },
    })
    expect(snapshot[0]!.callId).toMatch(/^llm_call_/)
    expect(typeof snapshot[0]!.timestamp).toBe('number')
  })

  it('records monitor entry after timeout', async () => {
    vi.useFakeTimers()
    const request = vi.fn(() => new Promise(() => {}))
    const client = createClientWithMockedRequest(request)

    const pending = expect(
      client.chat([{ role: 'user', content: 'hello' }], {
        timeout: 100,
        maxRetries: 1,
        traceLabel: 'timeout_test',
      }),
    ).rejects.toThrow('LLM request failed after 1 attempt')

    await vi.advanceTimersByTimeAsync(101)
    await pending

    const snapshot = getLlmCallMonitor().snapshot()
    expect(snapshot).toHaveLength(1)
    expect(snapshot[0]).toMatchObject({
      stage: 'timeout_test',
      status: 'timeout',
      model: 'test-model',
    })

    vi.useRealTimers()
  })

  it('records monitor entry for local demo fallback', async () => {
    const client = new LLMClient({
      apiKey: 'YOUR_API_KEY',
      baseURL: 'https://example.test/v1',
      model: 'test-model',
      timeout: 100,
    })

    const result = await client.chat(
      [
        {
          role: 'system',
          content: '你是版面意图识别器，请按 JSON 输出。',
        },
        {
          role: 'user',
          content: '用户需求：请帮我排一个 10:00 到 11:00 的新闻节目。',
        },
      ],
      {
        traceLabel: 'demo_fallback_test',
      },
    )

    expect(result.content).toBeTruthy()

    const snapshot = getLlmCallMonitor().snapshot()
    expect(snapshot).toHaveLength(1)
    expect(snapshot[0]).toMatchObject({
      stage: 'demo_fallback_test',
      status: 'success',
      model: 'test-model',
    })
  })
})
