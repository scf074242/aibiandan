import { describe, expect, it, vi } from 'vitest'

import { LlmAgentIntentInterpreter } from '@/services/agent/llmAgentIntentInterpreter'
import { createPendingTask } from '@/services/agent/agentSession'
import type { AgentSubmitInput } from '@/services/agent/types'

const date = '2026-03-25'

/**
 * 构造测试用 AgentSubmitInput
 */
const createInput = (overrides: Partial<AgentSubmitInput> = {}): AgentSubmitInput => ({
  userInput: '10点插入看东方',
  channelId: 'dragon',
  date,
  ...overrides,
})

/**
 * 构造 mock chat 函数：返回指定 JSON 内容
 */
const createChatFn = (content: string) =>
  vi.fn(async () => ({ content }))

describe('LlmAgentIntentInterpreter keywordStrategies（阶段 2）', () => {
  /**
   * case pending-explicit-confirm-inherits-stored-intent
   * - userInput: 确认
   * - expectedDecision: 显式 pendingAction=confirm 复用 pending 中已保存的 delete intent
   * - mustNotHappen: 普通无 intent 响应被本地补意图；用关键词确认代替模型 pendingAction
   * - verification: interpretation.intent=delete 且 pendingAction=confirm
   */
  it('inherits the stored pending intent only for an explicit model pending action', async () => {
    const chat = createChatFn(JSON.stringify({
      pendingAction: 'confirm',
      confidence: 1,
      slots: {},
      assistantFeedback: '已确认删除上一轮选中的节目。',
    }))
    const interpreter = new LlmAgentIntentInterpreter({ chat })

    const result = await interpreter.interpret(createInput({
      userInput: '确认',
      pendingTask: createPendingTask({
        intent: 'delete',
        phase: 'needs_confirmation',
        originalInput: '删除看东方',
        collectedSlots: {},
        missingSlots: ['confirmation'],
      }),
    }))

    expect(result).toMatchObject({
      intent: 'delete',
      pendingAction: 'confirm',
      confidence: 1,
    })
  })

  it('accepts an explicit queryKind misplaced inside slots without inferring from user text', async () => {
    const testCase = {
      id: 'intent-query-kind-structural-location-compatibility',
      userInput: '找没有节目编号的城市形象短片',
      expectedDecision: '保留模型明确给出的 candidate_lookup 语义并归一到顶层 queryKind',
      mustNotHappen: '根据用户关键词猜 queryKind，或因字段位置偏移丢掉模型的明确决定',
      verification: 'interpretation.queryKind=candidate_lookup，slots 仅保留业务槽位',
    }
    const chat = createChatFn(JSON.stringify({
      intent: 'query',
      confidence: 0.95,
      slots: {
        queryKind: 'candidate_lookup',
        programHint: '城市形象短片 无节目编号',
      },
      assistantFeedback: '我会在候选库中查找没有节目编号的城市形象短片。',
    }))
    const interpreter = new LlmAgentIntentInterpreter({ chat })

    const result = await interpreter.interpret(createInput({ userInput: testCase.userInput }))

    expect(result?.queryKind).toBe('candidate_lookup')
    expect(result?.slots).toEqual({ programHint: '城市形象短片 无节目编号' })
    expect(testCase).toMatchObject({ expectedDecision: expect.any(String), mustNotHappen: expect.any(String), verification: expect.any(String) })
  })

  describe('keywordStrategies 透传与退化', () => {
    it('LLM 返回完整 keywordStrategies（含 original + typo_fix）→ 透传', async () => {
      const chat = createChatFn(JSON.stringify({
        intent: 'insert',
        confidence: 0.92,
        keyword: '看东房',
        slots: {
          targetTime: '10:00:00',
          programHint: '看东房',
        },
        keywordStrategies: [
          { strategy: 'original', keywords: ['看东房'], reason: '用户原词' },
          { strategy: 'typo_fix', keywords: ['看东方'], reason: '错别字修复，房→方' },
          { strategy: 'paraphrase', keywords: ['看东方新闻'], reason: '近义改写' },
        ],
        searchAlternatives: ['看东方', '看东方新闻'],
        reasoning: '用户想插入看东方，原词有错别字',
        assistantFeedback: '我会按10点插入《看东方》来筛选候选。',
      }))
      const interpreter = new LlmAgentIntentInterpreter({ chat })

      const result = await interpreter.interpret(createInput())

      expect(result).not.toBeNull()
      expect(result?.keywordStrategies).toBeDefined()
      expect(result?.keywordStrategies?.length).toBe(3)
      // 验证策略标签与关键词
      const strategies = result?.keywordStrategies ?? []
      expect(strategies[0]?.strategy).toBe('original')
      expect(strategies[0]?.keywords).toEqual(['看东房'])
      expect(strategies[1]?.strategy).toBe('typo_fix')
      expect(strategies[1]?.keywords).toEqual(['看东方'])
      expect(strategies[1]?.reason).toBe('错别字修复，房→方')
      expect(strategies[2]?.strategy).toBe('paraphrase')
      // 兼容字段 searchAlternatives 仍应保留
      expect(result?.searchAlternatives).toEqual(['看东方', '看东方新闻'])
    })

    it('LLM 只返回 original（无其它策略）→ 退化为仅含 original', async () => {
      const chat = createChatFn(JSON.stringify({
        intent: 'insert',
        confidence: 0.9,
        keyword: '看东房',
        slots: {
          targetTime: '10:00:00',
          programHint: '看东房',
        },
        keywordStrategies: [
          { strategy: 'original', keywords: ['看东房'], reason: '用户原词' },
        ],
        assistantFeedback: '我会按10点插入《看东方》来筛选候选。',
      }))
      const interpreter = new LlmAgentIntentInterpreter({ chat })

      const result = await interpreter.interpret(createInput())

      expect(result).not.toBeNull()
      expect(result?.keywordStrategies).toBeDefined()
      expect(result?.keywordStrategies?.length).toBe(1)
      expect(result?.keywordStrategies?.[0]?.strategy).toBe('original')
      // 退化结构的关键词来自 record.keyword 或 slots.programHint
      expect(result?.keywordStrategies?.[0]?.keywords).toEqual(['看东房'])
      // 退化结构的 reason 应包含"校验失败"
      expect(result?.keywordStrategies?.[0]?.reason).toContain('校验失败')
    })

    it('LLM 返回 keywordStrategies 缺少 original → 退化为仅含 original（用 slots.programHint）', async () => {
      const chat = createChatFn(JSON.stringify({
        intent: 'insert',
        confidence: 0.9,
        slots: {
          targetTime: '10:00:00',
          programHint: '看东方',
        },
        keywordStrategies: [
          { strategy: 'typo_fix', keywords: ['看东方'], reason: '错别字修复' },
          { strategy: 'paraphrase', keywords: ['看东方新闻'], reason: '近义改写' },
        ],
        assistantFeedback: '我会按10点插入《看东方》来筛选候选。',
      }))
      const interpreter = new LlmAgentIntentInterpreter({ chat })

      const result = await interpreter.interpret(createInput())

      expect(result).not.toBeNull()
      // 缺少 original → 退化
      expect(result?.keywordStrategies?.length).toBe(1)
      expect(result?.keywordStrategies?.[0]?.strategy).toBe('original')
      // 退化关键词来自 slots.programHint
      expect(result?.keywordStrategies?.[0]?.keywords).toEqual(['看东方'])
    })

    it('LLM 返回非法 keywordStrategies（非数组）→ keywordStrategies 为 undefined（不本地兜底）', async () => {
      const chat = createChatFn(JSON.stringify({
        intent: 'insert',
        confidence: 0.9,
        keyword: '看东方',
        slots: {
          targetTime: '10:00:00',
          programHint: '看东方',
        },
        keywordStrategies: 'invalid',
        assistantFeedback: '我会按10点插入《看东方》来筛选候选。',
      }))
      const interpreter = new LlmAgentIntentInterpreter({ chat })

      const result = await interpreter.interpret(createInput())

      expect(result).not.toBeNull()
      // 非数组时直接返回 undefined（不本地兜底退化），符合 LLM-first 原则
      expect(result?.keywordStrategies).toBeUndefined()
    })

    it('LLM 返回 keywordStrategies 数组但全为非法策略标签 → 退化为仅含 original（用 slots.programHint）', async () => {
      const chat = createChatFn(JSON.stringify({
        intent: 'insert',
        confidence: 0.9,
        keyword: '看东方',
        slots: {
          targetTime: '10:00:00',
          programHint: '看东方',
        },
        keywordStrategies: [
          { strategy: 'unknown_strategy', keywords: ['看东房'], reason: '非法标签' },
        ],
        assistantFeedback: '我会按10点插入《看东方》来筛选候选。',
      }))
      const interpreter = new LlmAgentIntentInterpreter({ chat })

      const result = await interpreter.interpret(createInput())

      expect(result).not.toBeNull()
      // 数组但无合法策略 → 退化为仅含 original（用 slots.programHint）
      expect(result?.keywordStrategies?.length).toBe(1)
      expect(result?.keywordStrategies?.[0]?.strategy).toBe('original')
      expect(result?.keywordStrategies?.[0]?.keywords).toEqual(['看东方'])
    })

    it('LLM 返回非法 keywordStrategies 且无 keyword/slots → keywordStrategies 为 undefined', async () => {
      const chat = createChatFn(JSON.stringify({
        intent: 'insert',
        confidence: 0.9,
        slots: {
          targetTime: '10:00:00',
        },
        keywordStrategies: 'invalid',
        assistantFeedback: '我会按10点插入节目来筛选候选。',
      }))
      const interpreter = new LlmAgentIntentInterpreter({ chat })

      const result = await interpreter.interpret(createInput())

      expect(result).not.toBeNull()
      // 无 keyword 且 slots 无 programHint/replacementHint/targetProgramName → 无法退化 → undefined
      expect(result?.keywordStrategies).toBeUndefined()
    })
  })

  describe('失败暴露（LLM-first：不本地兜底改写意图）', () => {
    it('LLM 返回非 JSON → 返回 null（暴露失败，不本地猜测意图）', async () => {
      const chat = createChatFn('This is not JSON at all')
      const interpreter = new LlmAgentIntentInterpreter({ chat })

      const result = await interpreter.interpret(createInput())

      expect(result).toBeNull()
    })

    it('LLM 返回 JSON 但无 intent 字段 → 返回 null', async () => {
      const chat = createChatFn(JSON.stringify({
        confidence: 0.9,
        keywordStrategies: [
          { strategy: 'original', keywords: ['看东方'], reason: '原词' },
          { strategy: 'typo_fix', keywords: ['看东房'], reason: '错别字' },
        ],
      }))
      const interpreter = new LlmAgentIntentInterpreter({ chat })

      const result = await interpreter.interpret(createInput())

      expect(result).toBeNull()
    })

    it('LLM 返回 confidence < 0.5 → 返回 null（不本地猜测）', async () => {
      const chat = createChatFn(JSON.stringify({
        intent: 'insert',
        confidence: 0.3,
        slots: { targetTime: '10:00:00', programHint: '看东方' },
        keywordStrategies: [
          { strategy: 'original', keywords: ['看东方'], reason: '原词' },
          { strategy: 'typo_fix', keywords: ['看东房'], reason: '错别字' },
        ],
        reasoning: '不确定用户意图',
      }))
      const interpreter = new LlmAgentIntentInterpreter({ chat })

      const result = await interpreter.interpret(createInput())

      expect(result).toBeNull()
    })
  })

  describe('suggestSecondaryReflection 标志透传', () => {
    it('LLM 返回 suggestSecondaryReflection=true → 透传', async () => {
      const chat = createChatFn(JSON.stringify({
        intent: 'insert',
        confidence: 0.9,
        keyword: '看东方',
        slots: {
          targetTime: '10:00:00',
          programHint: '看东方',
        },
        keywordStrategies: [
          { strategy: 'original', keywords: ['看东方'], reason: '原词' },
          { strategy: 'typo_fix', keywords: ['看东房'], reason: '错别字' },
        ],
        suggestSecondaryReflection: true,
        assistantFeedback: '我会按10点插入《看东方》来筛选候选。',
      }))
      const interpreter = new LlmAgentIntentInterpreter({ chat })

      const result = await interpreter.interpret(createInput())

      expect(result).not.toBeNull()
      expect(result?.suggestSecondaryReflection).toBe(true)
    })

    it('LLM 返回 suggestSecondaryReflection=false → 透传 false', async () => {
      const chat = createChatFn(JSON.stringify({
        intent: 'insert',
        confidence: 0.9,
        keyword: '看东方',
        slots: {
          targetTime: '10:00:00',
          programHint: '看东方',
        },
        keywordStrategies: [
          { strategy: 'original', keywords: ['看东方'], reason: '原词' },
          { strategy: 'typo_fix', keywords: ['看东房'], reason: '错别字' },
        ],
        suggestSecondaryReflection: false,
        assistantFeedback: '我会按10点插入《看东方》来筛选候选。',
      }))
      const interpreter = new LlmAgentIntentInterpreter({ chat })

      const result = await interpreter.interpret(createInput())

      expect(result).not.toBeNull()
      expect(result?.suggestSecondaryReflection).toBe(false)
    })

    it('LLM 未返回 suggestSecondaryReflection → undefined', async () => {
      const chat = createChatFn(JSON.stringify({
        intent: 'insert',
        confidence: 0.9,
        keyword: '看东方',
        slots: {
          targetTime: '10:00:00',
          programHint: '看东方',
        },
        keywordStrategies: [
          { strategy: 'original', keywords: ['看东方'], reason: '原词' },
          { strategy: 'typo_fix', keywords: ['看东房'], reason: '错别字' },
        ],
        assistantFeedback: '我会按10点插入《看东方》来筛选候选。',
      }))
      const interpreter = new LlmAgentIntentInterpreter({ chat })

      const result = await interpreter.interpret(createInput())

      expect(result).not.toBeNull()
      expect(result?.suggestSecondaryReflection).toBeUndefined()
    })

    it('LLM 返回非布尔 suggestSecondaryReflection → undefined（不本地猜测）', async () => {
      const chat = createChatFn(JSON.stringify({
        intent: 'insert',
        confidence: 0.9,
        keyword: '看东方',
        slots: {
          targetTime: '10:00:00',
          programHint: '看东方',
        },
        keywordStrategies: [
          { strategy: 'original', keywords: ['看东方'], reason: '原词' },
          { strategy: 'typo_fix', keywords: ['看东房'], reason: '错别字' },
        ],
        suggestSecondaryReflection: 'yes',
        assistantFeedback: '我会按10点插入《看东方》来筛选候选。',
      }))
      const interpreter = new LlmAgentIntentInterpreter({ chat })

      const result = await interpreter.interpret(createInput())

      expect(result).not.toBeNull()
      expect(result?.suggestSecondaryReflection).toBeUndefined()
    })
  })

  describe('keywordStrategies 本地保护性校验', () => {
    it('跨策略关键词去重（重复关键词只保留首次出现）', async () => {
      const chat = createChatFn(JSON.stringify({
        intent: 'insert',
        confidence: 0.9,
        keyword: '看东方',
        slots: { targetTime: '10:00:00', programHint: '看东方' },
        keywordStrategies: [
          { strategy: 'original', keywords: ['看东方'], reason: '原词' },
          { strategy: 'typo_fix', keywords: ['看东方', '看东房'], reason: '错别字' },
          { strategy: 'paraphrase', keywords: ['看东方'], reason: '近义' },
        ],
        assistantFeedback: '我会按10点插入《看东方》来筛选候选。',
      }))
      const interpreter = new LlmAgentIntentInterpreter({ chat })

      const result = await interpreter.interpret(createInput())

      expect(result?.keywordStrategies).toBeDefined()
      const strategies = result?.keywordStrategies ?? []
      expect(strategies.length).toBe(2)
      // original 保留 '看东方'
      expect(strategies[0]?.keywords).toEqual(['看东方'])
      // typo_fix 的 '看东方' 与 original 重复被去重，只剩 '看东房'
      expect(strategies[1]?.keywords).toEqual(['看东房'])
      // paraphrase 的 '看东方' 与 original 重复被去重，整组丢弃
    })

    it('过滤长度 < 2 的关键词', async () => {
      const chat = createChatFn(JSON.stringify({
        intent: 'insert',
        confidence: 0.9,
        keyword: '看东方',
        slots: { targetTime: '10:00:00', programHint: '看东方' },
        keywordStrategies: [
          { strategy: 'original', keywords: ['看', '看东方'], reason: '原词' },
          { strategy: 'typo_fix', keywords: ['看东房'], reason: '错别字' },
        ],
        assistantFeedback: '我会按10点插入《看东方》来筛选候选。',
      }))
      const interpreter = new LlmAgentIntentInterpreter({ chat })

      const result = await interpreter.interpret(createInput())

      const strategies = result?.keywordStrategies ?? []
      expect(strategies[0]?.keywords).toEqual(['看东方'])
    })

    it('过滤后关键词为空的策略整组丢弃', async () => {
      const chat = createChatFn(JSON.stringify({
        intent: 'insert',
        confidence: 0.9,
        keyword: '看东方',
        slots: { targetTime: '10:00:00', programHint: '看东方' },
        keywordStrategies: [
          { strategy: 'original', keywords: ['看东方'], reason: '原词' },
          { strategy: 'typo_fix', keywords: ['a'], reason: '错别字' },
          { strategy: 'paraphrase', keywords: ['看东方新闻'], reason: '近义' },
        ],
        assistantFeedback: '我会按10点插入《看东方》来筛选候选。',
      }))
      const interpreter = new LlmAgentIntentInterpreter({ chat })

      const result = await interpreter.interpret(createInput())

      const strategies = result?.keywordStrategies ?? []
      expect(strategies.length).toBe(2)
      expect(strategies.map((s) => s.strategy)).toEqual(['original', 'paraphrase'])
    })

    it('非法策略标签被丢弃', async () => {
      const chat = createChatFn(JSON.stringify({
        intent: 'insert',
        confidence: 0.9,
        keyword: '看东方',
        slots: { targetTime: '10:00:00', programHint: '看东方' },
        keywordStrategies: [
          { strategy: 'original', keywords: ['看东方'], reason: '原词' },
          { strategy: 'unknown_strategy', keywords: ['看东房'], reason: '非法标签' },
          { strategy: 'typo_fix', keywords: ['看东房'], reason: '错别字' },
        ],
        assistantFeedback: '我会按10点插入《看东方》来筛选候选。',
      }))
      const interpreter = new LlmAgentIntentInterpreter({ chat })

      const result = await interpreter.interpret(createInput())

      const strategies = result?.keywordStrategies ?? []
      // unknown_strategy 被丢弃，但 typo_fix 的 '看东房' 与 unknown_strategy 的 '看东房' 重复
      // 由于 unknown_strategy 被丢弃在先，'看东房' 未被 seenKeywords 记录，typo_fix 应保留
      expect(strategies.length).toBe(2)
      expect(strategies.map((s) => s.strategy)).toEqual(['original', 'typo_fix'])
    })
  })
})
