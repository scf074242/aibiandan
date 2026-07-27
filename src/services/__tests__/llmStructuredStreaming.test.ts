import { describe, expect, it, vi } from 'vitest'

import { LlmAgentIntentInterpreter } from '@/services/agent/llmAgentIntentInterpreter'
import type { AgentLlmStreamEvent } from '@/services/agent/agentLlmStreaming'
import { LLMClient } from '@/services/llm/llmClient'
import { createAgentLlmStreamProgressEmitter } from '@/services/runtime/agentLlmStreamProgress'

const cases = {
  aggregateBeforeReturn: {
    id: 'llm-structured-stream-aggregates-before-return',
    userInput: '在9点插入节目看东方',
    expectedDecision: '流式 token 按顺序回调，但 chat 只在完整内容聚合后返回结构化响应',
    mustNotHappen: '任意半截 token 被当作完整 LLMResponse 返回，或流式 SDK 请求丢失 AbortSignal',
    verification: 'onToken 顺序与 chunks 一致，response.content 为完整 JSON，SDK options.signal 为同一实例',
  },
  incompleteJson: {
    id: 'llm-structured-stream-incomplete-json-never-executes',
    userInput: '在9点插入节目看东方',
    expectedDecision: '即使收到首 token，JSON 未闭合时 intent 仍返回 null 并发出 structured_invalid',
    mustNotHappen: '从半截 JSON 推断 intent 或补齐字段后继续 capability/write 链路',
    verification: 'interpretation=null，事件包含 first_token 与 structured_invalid，不含 structured_complete',
  },
  safeProgress: {
    id: 'agent-stream-first-token-progress-hides-raw-json',
    userInput: '在9点插入节目看东方',
    expectedDecision: '首 token 立即转换为可读进度事件，原始结构 token 不进入用户可见 content',
    mustNotHappen: '页面显示半截 JSON、candidateId 或内部字段',
    verification: 'progressStage=llm_first_token 且 content 不含原始 delta',
  },
  structuredCompleteIsInternal: {
    id: 'agent-stream-structured-complete-stays-out-of-user-thread',
    userInput: '新建电视播单并按版面开始编排',
    expectedDecision: '结构化响应完成只推进内部执行状态，不新增面向用户的协议完成气泡',
    mustNotHappen: '用户第一条回复出现“完整接收”“结构校验”或类似内部协议描述',
    verification: '发出 structured_complete 后 onProgress 不新增事件，first_token 仍保留业务化等待进度',
  },
} as const

const mockStream = (chunks: string[]) => ({
  async *[Symbol.asyncIterator]() {
    for (const content of chunks) yield { choices: [{ delta: { content } }] }
  },
})

const createStreamingClient = (create: ReturnType<typeof vi.fn>) => {
  const client = new LLMClient({
    apiKey: 'test-key',
    baseURL: 'https://example.test/v1',
    model: 'test-model',
    timeout: 45_000,
  })
  ;(client as unknown as { client: { chat: { completions: { create: typeof create } } } }).client = {
    chat: { completions: { create } },
  }
  return client
}

describe('LLM structured streaming boundary', () => {
  it(cases.aggregateBeforeReturn.id, async () => {
    const chunks = ['{"intent":', '"insert",', '"confidence":0.9}']
    const create = vi.fn().mockResolvedValue(mockStream(chunks))
    const client = createStreamingClient(create)
    const signal = new AbortController().signal
    const deltas: string[] = []

    const response = await client.chat([{ role: 'user', content: cases.aggregateBeforeReturn.userInput }], {
      signal,
      timeout: 45_000,
      onToken: (delta) => deltas.push(delta),
      traceLabel: 'structured_stream_test',
      promptVersion: 'v1.0',
    })

    expect(deltas).toEqual(chunks)
    expect(response.content).toBe(chunks.join(''))
    expect(create.mock.calls[0]?.[1]).toMatchObject({ signal, timeout: 45_000 })
    expect(cases.aggregateBeforeReturn).toMatchObject({ expectedDecision: expect.any(String), mustNotHappen: expect.any(String), verification: expect.any(String) })
  })

  it(cases.incompleteJson.id, async () => {
    const events: AgentLlmStreamEvent[] = []
    const chat = vi.fn(async (_messages, options) => {
      options?.onToken?.('{"intent":"insert"', {
        index: 0,
        receivedChars: 18,
        elapsedMs: 12,
        firstTokenLatencyMs: 12,
      })
      return { content: '{"intent":"insert"' }
    })
    const interpreter = new LlmAgentIntentInterpreter({ chat }, { onStreamEvent: (event) => events.push(event) })

    const interpretation = await interpreter.interpret({
      userInput: cases.incompleteJson.userInput,
      channelId: 'dragon',
      date: '2026-03-25',
      playlistId: 'tv-1',
    })

    expect(interpretation).toBeNull()
    expect(events.map((event) => event.kind)).toContain('first_token')
    expect(events.map((event) => event.kind)).toContain('structured_invalid')
    expect(events.map((event) => event.kind)).not.toContain('structured_complete')
    expect(cases.incompleteJson).toMatchObject({ expectedDecision: expect.any(String), mustNotHappen: expect.any(String), verification: expect.any(String) })
  })

  it(cases.safeProgress.id, () => {
    const progressEvents: Array<{ content: string; details?: Record<string, unknown> }> = []
    const emit = createAgentLlmStreamProgressEmitter({
      playlistKey: 'tv-1',
      onProgress: (event) => progressEvents.push(event),
    })

    emit({
      stage: 'intent_parse',
      kind: 'first_token',
      sequence: 0,
      receivedChars: 21,
      elapsedMs: 320,
      firstTokenLatencyMs: 320,
    })

    expect(progressEvents).toHaveLength(1)
    expect(progressEvents[0]?.details).toMatchObject({ progressStage: 'llm_first_token', noMutation: true })
    expect(progressEvents[0]?.content).not.toContain('{"intent"')
    expect(progressEvents[0]?.content).not.toContain('candidateId')
    expect(cases.safeProgress).toMatchObject({ expectedDecision: expect.any(String), mustNotHappen: expect.any(String), verification: expect.any(String) })
  })

  it(cases.structuredCompleteIsInternal.id, () => {
    const progressEvents: Array<{ content: string; details?: Record<string, unknown> }> = []
    const emit = createAgentLlmStreamProgressEmitter({
      playlistKey: 'none',
      onProgress: (event) => progressEvents.push(event),
    })

    emit({
      stage: 'planner',
      kind: 'first_token',
      sequence: 0,
      receivedChars: 8,
      elapsedMs: 420,
      firstTokenLatencyMs: 420,
    })
    emit({
      stage: 'planner',
      kind: 'structured_complete',
      sequence: 1,
      receivedChars: 320,
      elapsedMs: 1_200,
      firstTokenLatencyMs: 420,
    })

    expect(progressEvents).toHaveLength(1)
    expect(progressEvents[0]?.content).not.toMatch(/完整接收|结构校验/u)
    expect(progressEvents[0]?.details).toMatchObject({ progressStage: 'llm_first_token' })
    expect(cases.structuredCompleteIsInternal).toMatchObject({
      expectedDecision: expect.any(String),
      mustNotHappen: expect.any(String),
      verification: expect.any(String),
    })
  })
})
