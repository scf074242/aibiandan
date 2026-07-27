import { describe, expect, it, vi } from 'vitest'

import { LlmAgentCandidateJudge } from '@/services/agent/candidateJudge'
import { LlmAgentIntentInterpreter } from '@/services/agent/llmAgentIntentInterpreter'
import { LLMClient } from '@/services/llm/llmClient'
import type { AgentCandidateJudgeInput, AgentProgramCandidate } from '@/services/agent/types'
import type { AgentSubmitInput } from '@/services/agent/types'

/**
 * createClientWithMockedRequest 构造一个内部 SDK 请求被 mock 的 LLMClient
 * 用于验证 chat 调用后 trace 中是否携带 promptVersion 字段
 */
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

describe('LLMClient promptVersion 透传', () => {
  /**
   * case c1-trace-carries-prompt-version
   * 调用 chat 时传 promptVersion: 'v1.0'，trace 中能观察到 promptVersion 字段
   */
  it('c1-trace-carries-prompt-version: trace 携带传入的 promptVersion', async () => {
    const request = vi.fn().mockResolvedValue({
      choices: [{ message: { content: '{"ok":true}' } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    })
    const client = createClientWithMockedRequest(request)

    await client.chat([{ role: 'user', content: 'hello' }], {
      timeout: 4321,
      maxRetries: 1,
      traceLabel: 'unit_test',
      promptVersion: 'v1.0',
    })

    expect(client.getRecentRequestTraces()[0]).toMatchObject({
      label: 'unit_test',
      promptVersion: 'v1.0',
      success: true,
    })
  })

  /**
   * case c1-trace-undefined-when-no-version
   * 不传 promptVersion 时，trace 中 promptVersion 为 undefined，不报错（向后兼容）
   */
  it('c1-trace-undefined-when-no-version: 不传版本时 trace.promptVersion 为 undefined', async () => {
    const request = vi.fn().mockResolvedValue({
      choices: [{ message: { content: '{"ok":true}' } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    })
    const client = createClientWithMockedRequest(request)

    await client.chat([{ role: 'user', content: 'hello' }], {
      timeout: 4321,
      maxRetries: 1,
      traceLabel: 'unit_test',
    })

    const trace = client.getRecentRequestTraces()[0]
    expect(trace.promptVersion).toBeUndefined()
    expect(trace.label).toBe('unit_test')
  })

  /**
   * case c1-failure-trace-also-carries-version
   * LLM 请求失败时，trace 仍应携带 promptVersion（失败也要可审计归因）
   */
  it('c1-failure-trace-also-carries-version: 失败 trace 也携带 promptVersion', async () => {
    const request = vi.fn().mockRejectedValue(new Error('network down'))
    const client = createClientWithMockedRequest(request)

    await expect(
      client.chat([{ role: 'user', content: 'hello' }], {
        timeout: 4321,
        maxRetries: 1,
        traceLabel: 'unit_test',
        promptVersion: 'v2.3',
      }),
    ).rejects.toThrow()

    const trace = client.getRecentRequestTraces()[0]
    expect(trace.promptVersion).toBe('v2.3')
    expect(trace.success).toBe(false)
    expect(trace.error).toContain('network down')
  })
})

describe('candidateJudge / intentInterpreter 透传 promptVersion', () => {
  /**
   * case c1-candidate-judge-passes-version
   * candidateJudge 调用 LLM 时传入 CANDIDATE_JUDGE_PROMPT_VERSION
   */
  it('c1-candidate-judge-passes-version: candidateJudge 传入版本号', async () => {
    const chat = vi.fn().mockResolvedValue({
      content: JSON.stringify({
        candidateId: 'c1',
        reasoning: '唯一候选直接采用',
        decisionType: 'auto_select',
      }),
    })
    const judge = new LlmAgentCandidateJudge({ llmClient: { chat } })

    const candidates: AgentProgramCandidate[] = [
      { id: 'c1', programName: '看东方', programType: 'news', duration: 1800, column: '新闻' } as AgentProgramCandidate,
      { id: 'c2', programName: '午间新闻', programType: 'news', duration: 1800, column: '新闻' } as AgentProgramCandidate,
    ]
    const input: AgentCandidateJudgeInput = {
      userInput: '插入看东方',
      playlistType: 'tv',
      commandIntent: 'insert',
      candidates,
      context: {} as never,
    }
    await judge.selectBestCandidate(input)

    expect(chat).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ promptVersion: 'v1.3' }),
    )
  })

  /**
   * case c1-intent-interpreter-passes-version
   * intentInterpreter 调用 LLM 时传入 INTENT_INTERPRETER_PROMPT_VERSION
   */
  it('c1-intent-interpreter-passes-version: intentInterpreter 传入版本号', async () => {
    const chat = vi.fn().mockResolvedValue({
      content: JSON.stringify({
        intent: 'insert',
        confidence: 0.9,
        slots: { targetTime: '10:00:00', programHint: '看东方' },
      }),
    })
    const interpreter = new LlmAgentIntentInterpreter({ chat })

    const input: AgentSubmitInput = {
      userInput: '10点插入看东方',
      channelId: 'dragon',
      date: '2026-06-28',
    }
    await interpreter.interpret(input)

    expect(chat).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        promptVersion: 'v2.5',
        responseFormat: 'json_object',
      }),
    )
  })
})
