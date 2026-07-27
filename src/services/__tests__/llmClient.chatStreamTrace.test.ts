import { describe, expect, it, vi } from 'vitest'

import { LLMClient } from '@/services/llm/llmClient'

/**
 * createClientWithMockedStream 构造一个内部 SDK 流式请求被 mock 的 LLMClient
 * 用于验证 chatStream 调用后 trace 中是否携带 promptVersion 字段
 */
const createClientWithMockedStream = (
  create: ReturnType<typeof vi.fn>,
) => {
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

const hangingStream = () => ({
  async *[Symbol.asyncIterator]() {
    yield { choices: [{ delta: { content: 'first' } }] }
    await new Promise(() => {})
  },
})

describe('LLMClient chatStream trace 接入', () => {
  /**
   * case c2-stream-trace-carries-prompt-version
   * - expectedDecision: chatStream 成功后 trace 携带 promptVersion='v1.0' 且 success=true
   * - mustNotHappen: trace.promptVersion 为 undefined；trace 不落盘
   * - verification: getRecentRequestTraces()[0].promptVersion === 'v1.0' 且 success === true
   */
  it('c2-stream-trace-carries-prompt-version: 成功 trace 携带 promptVersion', async () => {
    const create = vi.fn().mockResolvedValue(mockStream(['a', 'b', 'c']))
    const client = createClientWithMockedStream(create)

    const collected: string[] = []
    for await (const chunk of client.chatStream(
      [{ role: 'user', content: 'hello' }],
      { traceLabel: 'stream_unit_test', promptVersion: 'v1.0' },
    )) {
      collected.push(chunk)
    }

    expect(collected).toEqual(['a', 'b', 'c'])
    const trace = client.getRecentRequestTraces()[0]
    expect(trace).toMatchObject({
      label: 'stream_unit_test',
      promptVersion: 'v1.0',
      success: true,
    })
    expect(trace.error).toBeUndefined()
  })

  /**
   * case c2-stream-trace-on-error
   * - expectedDecision: chatStream 抛错时 trace.success=false，但仍携带 promptVersion
   * - mustNotHappen: 抛错后 trace 不落盘；trace.promptVersion 缺失
   * - verification: trace.success === false 且 promptVersion === 'v2.3' 且 error 含 'network down'
   */
  it('c2-stream-trace-on-error: 失败 trace 也携带 promptVersion', async () => {
    const create = vi.fn().mockRejectedValue(new Error('network down'))
    const client = createClientWithMockedStream(create)

    await expect(async () => {
      for await (const _ of client.chatStream(
        [{ role: 'user', content: 'hello' }],
        { traceLabel: 'stream_unit_test', promptVersion: 'v2.3' },
      )) {
        // 不应到达
      }
    }).rejects.toThrow('network down')

    const trace = client.getRecentRequestTraces()[0]
    expect(trace).toMatchObject({
      label: 'stream_unit_test',
      promptVersion: 'v2.3',
      success: false,
    })
    expect(trace.error).toContain('network down')
  })

  /**
   * case c2-stream-yield-order-unchanged
   * - expectedDecision: 流式 yield 顺序与 mock 返回的 chunks 顺序完全一致
   * - mustNotHappen: yield 顺序被打乱；yield 内容被改写；提前结束
   * - verification: collected 深度等于 ['x','y','z']
   */
  it('c2-stream-yield-order-unchanged: 流式语义不变，yield 顺序与时机保持一致', async () => {
    const create = vi.fn().mockResolvedValue(mockStream(['x', 'y', 'z']))
    const client = createClientWithMockedStream(create)

    const collected: string[] = []
    for await (const chunk of client.chatStream(
      [{ role: 'user', content: 'hello' }],
      { promptVersion: 'v1.0' },
    )) {
      collected.push(chunk)
    }

    expect(collected).toEqual(['x', 'y', 'z'])
    // 默认 traceLabel 为 chat_stream
    expect(client.getRecentRequestTraces()[0].label).toBe('chat_stream')
  })

  /**
   * case llm-stream-json-object-format-propagates
   * - userInput: intent interpreter 以流式方式请求结构化 JSON
   * - expectedDecision: SDK 同时收到 stream=true 与 response_format=json_object
   * - mustNotHappen: 流式路径静默丢失结构化输出约束
   * - verification: create body 含两个字段且 token 顺序不变
   */
  it('propagates JSON object format through the streaming request path', async () => {
    const create = vi.fn().mockResolvedValue(mockStream(['{"ok":', 'true}']))
    const client = createClientWithMockedStream(create)
    const collected: string[] = []

    for await (const chunk of client.chatStream(
      [{ role: 'user', content: 'structured stream' }],
      { responseFormat: 'json_object' },
    )) {
      collected.push(chunk)
    }

    expect(collected).toEqual(['{"ok":', 'true}'])
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        stream: true,
        response_format: { type: 'json_object' },
      }),
      expect.any(Object),
    )
  })

  /**
   * case c2-stream-no-prompt-version-undefined
   * - expectedDecision: 不传 promptVersion 时 trace.promptVersion 为 undefined，不报错（向后兼容）
   * - mustNotHappen: 不传版本时抛错
   * - verification: trace.promptVersion === undefined
   */
  it('c2-stream-no-prompt-version-undefined: 不传版本时 trace.promptVersion 为 undefined', async () => {
    const create = vi.fn().mockResolvedValue(mockStream(['ok']))
    const client = createClientWithMockedStream(create)

    for await (const _ of client.chatStream([{ role: 'user', content: 'hello' }])) {
      // 消费
    }

    const trace = client.getRecentRequestTraces()[0]
    expect(trace.promptVersion).toBeUndefined()
    expect(trace.success).toBe(true)
  })

  /**
   * case c2-stream-client-not-initialized
   * - expectedDecision: client 未初始化时抛错，trace.success=false
   * - mustNotHappen: trace 不落盘
   * - verification: trace.success === false 且 error 含 'not initialized'
   */
  it('c2-stream-client-not-initialized: client 未初始化时失败 trace 也落盘', async () => {
    const client = new LLMClient({
      apiKey: 'test-key',
      baseURL: 'https://example.test/v1',
      model: 'test-model',
      timeout: 100,
    })
    // 强制把内部 client 置空，模拟未初始化场景
    ;(client as unknown as { client: unknown }).client = null

    await expect(async () => {
      for await (const _ of client.chatStream(
        [{ role: 'user', content: 'hello' }],
        { promptVersion: 'v1.0' },
      )) {
        // 不应到达
      }
    }).rejects.toThrow('not initialized')

    const trace = client.getRecentRequestTraces()[0]
    expect(trace).toMatchObject({
      promptVersion: 'v1.0',
      success: false,
    })
    expect(trace.error).toContain('not initialized')
  })

  /**
   * case c2-stream-iteration-deadline
   * - expectedDecision: 建连成功但后续 token 长时间不返回时，整体 timeout 仍能终止迭代
   * - mustNotHappen: 连接成功后无限等待；trace.success 仍标记成功
   * - verification: 抛出 timed out，trace.success=false 且 firstTokenLatency 已记录
   */
  it('c2-stream-iteration-deadline: 迭代阶段也受整体 deadline 约束', async () => {
    const create = vi.fn().mockResolvedValue(hangingStream())
    const client = createClientWithMockedStream(create)

    await expect(async () => {
      for await (const _ of client.chatStream(
        [{ role: 'user', content: 'hello' }],
        { timeout: 20, traceLabel: 'stream_deadline_test' },
      )) {
        // 消费首 token 后等待下一轮超时
      }
    }).rejects.toThrow('timed out')

    const trace = client.getRecentRequestTraces()[0]
    expect(trace).toMatchObject({ label: 'stream_deadline_test', success: false })
    expect(trace.firstTokenLatencyMs).toBeTypeOf('number')
  })
})
