import { describe, expect, it, vi } from 'vitest'

import { LlmFormalOrchestrationDecider } from '../formalOrchestrationDecider'

const createInput = () => ({
  objective: '先核验当前播单',
  originalUserInput: '先检查晚间空窗',
  turn: 1,
  observations: [{ id: 'o1', turn: 1, type: 'validation' as const, summary: '发现一个待核验空窗', createdAt: '2026-07-18T00:00:00.000Z' }],
  checkpoints: [],
  compactedContext: {
    schemaVersion: 1 as const,
    objective: '先核验当前播单',
    recentTurns: [],
    decidedActionSummaries: [],
    failureReasons: ['上一轮候选因版权缺失被拒绝'],
    trace: {
      strategy: 'recent_raw_plus_decided_summary' as const,
      retainRecentTurns: 2,
      before: { checkpointCount: 3, observationCount: 3, actionCount: 3 },
      after: { rawTurnCount: 2, rawObservationCount: 2, rawActionCount: 2, summarizedTurnCount: 3, failureReasonCount: 1 },
      dropped: { rawTurnCount: 1, rawObservationCount: 1, rawActionCount: 1 },
    },
  },
  run: {
    id: 'run-1', objective: '先核验当前播单', originalUserInput: '先检查晚间空窗', status: 'deciding' as const,
    loopCount: 1, limits: { maxTurns: 3, batchSize: 2 }, steps: [], observations: [], createdAt: '', updatedAt: '',
  },
})

describe('LlmFormalOrchestrationDecider', () => {
  /**
   * case formal-decider-structured-continue
   * - userInput: 先检查晚间空窗
   * - expectedDecision: 完整 observation 被送入 LLM，合法 JSON 被解析为 continue 和校验动作
   * - mustNotHappen: 本地猜下一动作；丢弃 observation；直接执行动作
   * - verification: result.kind=continue，traceLabel=形式编排 decide，prompt 包含 observation
   */
  it('parses structured continue and sends observations to the model', async () => {
    const chat = vi.fn(async (messages: Array<{ role: string; content: string }>) => {
      expect(messages[1]?.content).toContain('发现一个待核验空窗')
      return { content: JSON.stringify({ kind: 'continue', reason: '先做一次确定性校验', nextActions: [{ type: 'validate' }] }) }
    })
    const decider = new LlmFormalOrchestrationDecider({ llmClient: { chat } as any })

    const result = await decider.decide(createInput())

    expect(result).toMatchObject({ kind: 'continue', reason: '先做一次确定性校验' })
    expect(result.kind === 'continue' && result.nextActions).toEqual([{ type: 'validate' }])
    const promptMessages = vi.mocked(chat).mock.calls[0]?.[0]
    expect(promptMessages?.map((message) => message.content).join('\n')).toContain('{"type":"validate"}')
    expect(promptMessages?.map((message) => message.content).join('\n')).toContain('atomic_command')
    expect(chat).toHaveBeenCalledWith(expect.any(Array), expect.objectContaining({ traceLabel: 'formal_orchestration_decide', promptVersion: 'v1.6' }))
  })

  /**
   * case formal-decider-reuses-confirmed-rebuild-grant
   * - userInput: 继续执行已确认的整批重编
   * - expectedDecision: decider 只能看到运行时已解析的有效 Grant 摘要，作用域内动作可选择 formal_write
   * - mustNotHappen: 重复返回 pending_only；让 LLM 自行生成或扩大授权
   * - verification: prompt 含 grantId/workspace/allowedIntents，解析结果保留 formal_write
   */
  it('reuses a runtime-resolved rebuild grant without asking for duplicate approval', async () => {
    const authorization = {
      kind: 'confirmed_formal_rebuild' as const,
      grantId: 'grant-1', sessionId: 'session-a', sourcePendingId: 'pending-a',
      workspaceKey: 'rotation:playlist-a', initialPlaylistVersion: 'formal-v1', draftFingerprint: 'draft-fp-1',
      mode: 'full_generate' as const, existingItemCount: 1,
      allowedIntents: ['move', 'insert', 'replace', 'delete', 'batch_move', 'batch_delete', 'validate'] as const,
      issuedAt: '2026-07-21T10:00:00.000Z', expiresAt: '2026-07-21T10:10:00.000Z', status: 'active' as const,
    }
    const chat = vi.fn(async (messages: Array<{ role: string; content: string }>) => {
      const payload = JSON.parse(messages[1]?.content ?? '{}')
      expect(payload.authorization).toMatchObject({ grantId: 'grant-1', workspaceKey: 'rotation:playlist-a' })
      expect(payload.authorization.allowedIntents).toContain('replace')
      expect(payload.authorizationGuidance).toContain('不要再次返回 pending_only')
      return {
        content: JSON.stringify({
          kind: 'continue', reason: '整批重编已确认且写入证据完整',
          nextActions: [{
            type: 'atomic_command', intent: 'replace', targetItemId: 'item-1',
            candidateId: 'candidate-1', mutationPolicy: 'formal_write',
          }],
        }),
      }
    })
    const decider = new LlmFormalOrchestrationDecider({ llmClient: { chat } as any, authorization: authorization as any })

    const result = await decider.decide(createInput())

    expect(result).toMatchObject({
      kind: 'continue',
      nextActions: [expect.objectContaining({ intent: 'replace', mutationPolicy: 'formal_write' })],
    })
  })

  /**
   * case formal-decider-uses-compacted-history
   * - userInput: 继续核验晚间空窗
   * - expectedDecision: prompt 只携带 compactedHistory，并保留旧轮失败原因
   * - mustNotHappen: 同时携带全量 priorCheckpoints 形成假压缩；丢失版权拒绝证据
   * - verification: user prompt 含 compactedHistory/failureReasons，不含 priorCheckpoints
   */
  it('sends only compacted prior history to the model', async () => {
    const chat = vi.fn(async (messages: Array<{ role: string; content: string }>) => {
      const payload = JSON.parse(messages[1]?.content ?? '{}')
      expect(payload.compactedHistory.failureReasons).toContain('上一轮候选因版权缺失被拒绝')
      expect(payload.compactedHistory.trace.dropped.rawTurnCount).toBe(1)
      expect(payload.priorCheckpoints).toBeUndefined()
      return { content: JSON.stringify({ kind: 'complete', reason: '核验完成' }) }
    })
    const decider = new LlmFormalOrchestrationDecider({ llmClient: { chat } as any })

    await expect(decider.decide(createInput())).resolves.toEqual({ kind: 'complete', reason: '核验完成' })
  })

  /**
   * case formal-decider-invalid-response
   * - userInput: 继续编排
   * - expectedDecision: 非法 JSON 或非法动作直接抛出结构化阶段错误
   * - mustNotHappen: 猜测动作、补齐 JSON、自动续跑
   * - verification: 非法响应抛 InvalidFormalOrchestrationDecisionError
   */
  it('rejects invalid JSON and unknown actions without fallback guessing', async () => {
    const chat = vi.fn(async () => ({ content: '{"kind":"continue","nextActions":[{"type":"invented"}]}' }))
    const decider = new LlmFormalOrchestrationDecider({ llmClient: { chat } as any })

    await expect(decider.decide(createInput())).rejects.toThrow('没有合法 nextActions')
  })

  /**
   * case formal-decider-unable-to-decide
   * - userInput: 继续编排
   * - expectedDecision: 模型明确无法决策时保留业务语义，不混淆成传输错误
   * - mustNotHappen: 本地改写为 continue 或 complete
   * - verification: result.kind=unable_to_decide
   */
  it('preserves a valid unable_to_decide business decision', async () => {
    const chat = vi.fn(async () => ({ content: JSON.stringify({ kind: 'unable_to_decide', reason: '没有足够的顺播证据' }) }))
    const decider = new LlmFormalOrchestrationDecider({ llmClient: { chat } as any })

    await expect(decider.decide(createInput())).resolves.toEqual({ kind: 'unable_to_decide', reason: '没有足够的顺播证据' })
  })

  it('post9-react-zero-candidate-decides-from-observation: branches on zero-candidate evidence without inventing a match', async () => {
    const input = createInput()
    input.observations = [{
      id: 'zero-candidate-observation', turn: 1, type: 'asset_search' as const,
      summary: '候选源可用，但本轮两组查询均为零命中',
      createdAt: '2026-07-18T00:00:00.000Z',
      data: {
        candidateCount: 0,
        queries: ['指定主题节目', '主题相关节目'],
        sourceEvidence: { candidates: { available: true, status: 'empty' } },
      },
    }]
    let systemPrompt = ''
    const chat = vi.fn(async (messages: Array<{ role: string; content: string }>) => {
      systemPrompt = messages[0]?.content ?? ''
      return { content: JSON.stringify({ kind: 'unable_to_decide', reason: '候选源可用但已穷尽明确查询，保留空缺并请用户补充条件' }) }
    })
    const decider = new LlmFormalOrchestrationDecider({ llmClient: { chat } as any })

    await expect(decider.decide(input)).resolves.toMatchObject({ kind: 'unable_to_decide' })
    expect(systemPrompt).toContain('candidateCount=0')
    expect(systemPrompt).toContain('尚有未尝试且不违背用户硬条件的查询')
    expect(systemPrompt).toContain('保留空缺')
    expect(systemPrompt).toContain('不得伪造候选')
  })
})
