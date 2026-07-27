import { describe, expect, it } from 'vitest'

import {
  CandidateSearchRetryService,
  DEFAULT_TV_RETRY_CONFIG,
  type CandidateKeywordStrategy,
  type CandidateSearchRetryConfig,
} from '@/services/agent/candidateSearchRetryService'
import type { CandidateQueryCriteria, GapInfo, ProgramCandidate } from '@/types/orchestration'

const baseDate = '2026-03-25'
const iso = (time: string) => `${baseDate}T${time}+08:00`

/**
 * 构造测试用 GapInfo
 */
const createGap = (overrides: Partial<GapInfo> = {}): GapInfo => ({
  id: 'gap-test',
  startTime: iso('09:00:00'),
  endTime: iso('09:30:00'),
  duration: 1800,
  constraints: {},
  metadata: {
    source: 'generated',
    priority: 1,
    createdAt: iso('00:00:00'),
    updatedAt: iso('00:00:00'),
  },
  ...overrides,
})

/**
 * 构造测试用 CandidateQueryCriteria
 */
const createCriteria = (overrides: Partial<CandidateQueryCriteria> = {}): CandidateQueryCriteria => ({
  channelId: 'dragon',
  ...overrides,
} as CandidateQueryCriteria)

/**
 * 构造测试用 ProgramCandidate
 */
const createCandidate = (overrides: Partial<ProgramCandidate> = {}): ProgramCandidate => ({
  id: 'candidate-test-1',
  programId: 'P-TEST-1',
  programCode: 'TEST-001',
  programName: '看东方',
  channelId: 'dragon',
  duration: 1800,
  programType: 'news',
  instanceName: '看东方 第1期',
  ...overrides,
})

/**
 * 构造 mock queryFn：按关键词返回候选
 */
const createMockQueryFn = (keywordToCandidates: Record<string, ProgramCandidate[]>) =>
  async (_gap: GapInfo, criteria: CandidateQueryCriteria): Promise<ProgramCandidate[]> => {
    const keyword = criteria.searchKeywords?.[0] ?? ''
    return keywordToCandidates[keyword] ?? []
  }

const baseRetryConfig: CandidateSearchRetryConfig = {
  ...DEFAULT_TV_RETRY_CONFIG,
  maxRound: 5,
  minCandidateThreshold: 1,
}

describe('CandidateSearchRetryService', () => {
  describe('executeRetryLoop', () => {
    it('首轮命中即终止（original 命中，attempts 仅 1 轮，terminationReason=satisfied）', async () => {
      const service = new CandidateSearchRetryService()
      const gap = createGap()
      const criteria = createCriteria()
      const strategies: CandidateKeywordStrategy[] = [
        { strategy: 'original', keywords: ['看东房'], reason: '用户原词' },
        { strategy: 'typo_fix', keywords: ['看东方'], reason: '错别字修复' },
      ]
      const queryFn = createMockQueryFn({
        '看东房': [createCandidate({ id: 'c1', programCode: 'TEST-001', programName: '看东房' })],
      })

      const result = await service.executeRetryLoop(gap, criteria, strategies, baseRetryConfig, queryFn)

      expect(result.candidates.length).toBe(1)
      expect(result.searchRetryPlan.searchAttempts).toHaveLength(1)
      expect(result.searchRetryPlan.searchAttempts[0]?.strategyLabel).toBe('original')
      expect(result.searchRetryPlan.terminationReason).toBe('satisfied')
      expect(result.searchRetryPlan.nextAction).toBe('proceed_to_selection')
      expect(result.searchRetryPlan.triggeredSecondaryReflection).toBe(false)
    })

    it('original 0 命中后 typo_fix 命中（attempts 2 轮，strategyLabel 分别为 original/typo_fix）', async () => {
      const service = new CandidateSearchRetryService()
      const gap = createGap()
      const criteria = createCriteria()
      const strategies: CandidateKeywordStrategy[] = [
        { strategy: 'original', keywords: ['看东房'], reason: '用户原词' },
        { strategy: 'typo_fix', keywords: ['看东方'], reason: '错别字修复，房→方' },
      ]
      const queryFn = createMockQueryFn({
        '看东方': [createCandidate({ id: 'c2', programCode: 'TEST-002', programName: '看东方' })],
      })

      const result = await service.executeRetryLoop(gap, criteria, strategies, baseRetryConfig, queryFn)

      expect(result.candidates.length).toBe(1)
      expect(result.candidates[0]?.programName).toBe('看东方')
      expect(result.searchRetryPlan.searchAttempts).toHaveLength(2)
      expect(result.searchRetryPlan.searchAttempts[0]?.strategyLabel).toBe('original')
      expect(result.searchRetryPlan.searchAttempts[0]?.candidateCount).toBe(0)
      expect(result.searchRetryPlan.searchAttempts[1]?.strategyLabel).toBe('typo_fix')
      expect(result.searchRetryPlan.searchAttempts[1]?.strategyReason).toBe('错别字修复，房→方')
      expect(result.searchRetryPlan.terminationReason).toBe('satisfied')
    })

    it('按策略优先级轮询（顺序为 original→typo_fix→decompose→paraphrase→column_demote→broaden）', async () => {
      const service = new CandidateSearchRetryService()
      const gap = createGap()
      const criteria = createCriteria()
      // 故意打乱输入顺序，验证内部按优先级排序
      const strategies: CandidateKeywordStrategy[] = [
        { strategy: 'broaden', keywords: ['broaden-kw'], reason: '放宽' },
        { strategy: 'original', keywords: ['original-kw'], reason: '原词' },
        { strategy: 'typo_fix', keywords: ['typo-kw'], reason: '错别字' },
        { strategy: 'decompose', keywords: ['decompose-kw'], reason: '拆字' },
        { strategy: 'paraphrase', keywords: ['paraphrase-kw'], reason: '近义' },
        { strategy: 'column_demote', keywords: ['column-kw'], reason: '栏目降级' },
      ]
      const callOrder: string[] = []
      const queryFn = async (_gap: GapInfo, criteria: CandidateQueryCriteria): Promise<ProgramCandidate[]> => {
        const keyword = criteria.searchKeywords?.[0] ?? ''
        callOrder.push(keyword)
        return []
      }
      // maxRound 设为 6，确保所有 6 个策略都能执行（baseRetryConfig.maxRound=5 会在第 6 轮前终止）
      const retryConfig: CandidateSearchRetryConfig = { ...baseRetryConfig, maxRound: 6 }

      await service.executeRetryLoop(gap, criteria, strategies, retryConfig, queryFn)

      // 验证调用顺序按策略优先级
      expect(callOrder).toEqual([
        'original-kw',
        'typo-kw',
        'decompose-kw',
        'paraphrase-kw',
        'column-kw',
        'broaden-kw',
      ])
    })

    it('所有策略 0 命中 → terminationReason=all_strategies_exhausted, nextAction=needs_clarification', async () => {
      const service = new CandidateSearchRetryService()
      const gap = createGap()
      const criteria = createCriteria()
      const strategies: CandidateKeywordStrategy[] = [
        { strategy: 'original', keywords: ['不存在的栏目XYZ'], reason: '用户原词' },
        { strategy: 'paraphrase', keywords: ['栏目XYZ'], reason: '去掉修饰词' },
      ]
      const queryFn = createMockQueryFn({})

      const result = await service.executeRetryLoop(gap, criteria, strategies, baseRetryConfig, queryFn)

      expect(result.candidates).toHaveLength(0)
      expect(result.searchRetryPlan.terminationReason).toBe('all_strategies_exhausted')
      expect(result.searchRetryPlan.nextAction).toBe('needs_clarification')
      expect(result.searchRetryPlan.triggeredSecondaryReflection).toBe(false)
    })

    it('达 maxRound 终止（maxRound=2，attempts 最多 2 轮）', async () => {
      const service = new CandidateSearchRetryService()
      const gap = createGap()
      const criteria = createCriteria()
      const strategies: CandidateKeywordStrategy[] = [
        { strategy: 'original', keywords: ['kw1'], reason: '原词' },
        { strategy: 'typo_fix', keywords: ['kw2'], reason: '错别字' },
        { strategy: 'decompose', keywords: ['kw3'], reason: '拆字' },
        { strategy: 'paraphrase', keywords: ['kw4'], reason: '近义' },
      ]
      const queryFn = createMockQueryFn({})
      const retryConfig: CandidateSearchRetryConfig = { ...baseRetryConfig, maxRound: 2 }

      const result = await service.executeRetryLoop(gap, criteria, strategies, retryConfig, queryFn)

      expect(result.searchRetryPlan.searchAttempts).toHaveLength(2)
      expect(result.searchRetryPlan.terminationReason).toBe('max_round')
    })

    it('候选足够提前终止（minCandidateThreshold=3，命中 2 时继续，命中 3 时停止）', async () => {
      const service = new CandidateSearchRetryService()
      const gap = createGap()
      const criteria = createCriteria()
      const strategies: CandidateKeywordStrategy[] = [
        { strategy: 'original', keywords: ['kw1'], reason: '原词' },
        { strategy: 'typo_fix', keywords: ['kw2'], reason: '错别字' },
        { strategy: 'decompose', keywords: ['kw3'], reason: '拆字' },
      ]
      const queryFn = createMockQueryFn({
        'kw1': [createCandidate({ id: 'c1', programCode: 'T1' })],
        'kw2': [createCandidate({ id: 'c2', programCode: 'T2' }), createCandidate({ id: 'c3', programCode: 'T3' })],
      })
      const retryConfig: CandidateSearchRetryConfig = { ...baseRetryConfig, minCandidateThreshold: 3 }

      const result = await service.executeRetryLoop(gap, criteria, strategies, retryConfig, queryFn)

      // 命中 3 个后终止，第 3 轮 decompose 不应执行
      expect(result.candidates.length).toBe(3)
      expect(result.searchRetryPlan.searchAttempts).toHaveLength(2)
      expect(result.searchRetryPlan.terminationReason).toBe('satisfied')
    })

    it('onAttempt 回调被每轮调用', async () => {
      const service = new CandidateSearchRetryService()
      const gap = createGap()
      const criteria = createCriteria()
      const strategies: CandidateKeywordStrategy[] = [
        { strategy: 'original', keywords: ['kw1'], reason: '原词' },
        { strategy: 'typo_fix', keywords: ['kw2'], reason: '错别字' },
      ]
      const queryFn = createMockQueryFn({})
      const attempts: string[] = []
      const onAttempt = (attempt: { strategyLabel?: string }) => {
        attempts.push(attempt.strategyLabel ?? '')
      }

      await service.executeRetryLoop(gap, criteria, strategies, baseRetryConfig, queryFn, onAttempt)

      expect(attempts).toEqual(['original', 'typo_fix'])
    })
  })

  describe('sanitizeKeywordStrategies', () => {
    it('跨策略归一化去重（重复关键词只保留首次出现）', () => {
      const service = new CandidateSearchRetryService()
      const strategies: CandidateKeywordStrategy[] = [
        { strategy: 'original', keywords: ['看东方'], reason: '原词' },
        { strategy: 'typo_fix', keywords: ['看东方', '看东方新闻'], reason: '错别字' },
        { strategy: 'paraphrase', keywords: ['看东方新闻'], reason: '近义' },
      ]

      const result = service.sanitizeKeywordStrategies(strategies, [])

      // '看东方' 在 original 已用，typo_fix 的 '看东方' 应去重，只剩 '看东方新闻'
      // '看东方新闻' 在 typo_fix 已用，paraphrase 的 '看东方新闻' 应去重，paraphrase 整组丢弃
      expect(result).toHaveLength(2)
      expect(result[0]?.strategy).toBe('original')
      expect(result[0]?.keywords).toEqual(['看东方'])
      expect(result[1]?.strategy).toBe('typo_fix')
      expect(result[1]?.keywords).toEqual(['看东方新闻'])
    })

    it('与 triedKeywords 去重', () => {
      const service = new CandidateSearchRetryService()
      const strategies: CandidateKeywordStrategy[] = [
        { strategy: 'original', keywords: ['看东方'], reason: '原词' },
        { strategy: 'paraphrase', keywords: ['看东方新闻'], reason: '近义' },
      ]

      const result = service.sanitizeKeywordStrategies(strategies, ['看东方'])

      // '看东方' 在 triedKeywords 中，original 整组应丢弃（关键词为空）
      // 但 paraphrase 的 '看东方新闻' 不在 triedKeywords 中，应保留
      expect(result).toHaveLength(1)
      expect(result[0]?.strategy).toBe('paraphrase')
      expect(result[0]?.keywords).toEqual(['看东方新闻'])
    })

    it('过滤长度 < 2 的关键词', () => {
      const service = new CandidateSearchRetryService()
      const strategies: CandidateKeywordStrategy[] = [
        { strategy: 'original', keywords: ['a', '看东方'], reason: '原词' },
      ]

      const result = service.sanitizeKeywordStrategies(strategies, [])

      expect(result[0]?.keywords).toEqual(['看东方'])
    })

    it('过滤后关键词为空的策略整组丢弃', () => {
      const service = new CandidateSearchRetryService()
      const strategies: CandidateKeywordStrategy[] = [
        { strategy: 'original', keywords: ['看东方'], reason: '原词' },
        { strategy: 'typo_fix', keywords: ['a'], reason: '错别字' }, // 全部过滤
        { strategy: 'paraphrase', keywords: ['看东方新闻'], reason: '近义' },
      ]

      const result = service.sanitizeKeywordStrategies(strategies, [])

      expect(result).toHaveLength(2)
      expect(result.map((s) => s.strategy)).toEqual(['original', 'paraphrase'])
    })

    it('只剩 original 时保留（退化由 generateKeywordStrategies 判断）', () => {
      const service = new CandidateSearchRetryService()
      const strategies: CandidateKeywordStrategy[] = [
        { strategy: 'original', keywords: ['看东方'], reason: '原词' },
        { strategy: 'typo_fix', keywords: ['看东方'], reason: '错别字' }, // 与 original 重复，去重后为空
      ]

      const result = service.sanitizeKeywordStrategies(strategies, [])

      expect(result).toHaveLength(1)
      expect(result[0]?.strategy).toBe('original')
    })
  })

  describe('shouldContinueRetry', () => {
    it('已达 maxRound → false', () => {
      const service = new CandidateSearchRetryService()
      const strategies: CandidateKeywordStrategy[] = [
        { strategy: 'typo_fix', keywords: ['kw'], reason: '' },
      ]
      expect(service.shouldContinueRetry(3, 3, strategies, 0, 1)).toBe(false)
    })

    it('剩余策略为空 → false', () => {
      const service = new CandidateSearchRetryService()
      expect(service.shouldContinueRetry(1, 3, [], 0, 1)).toBe(false)
    })

    it('候选已足够（≥ minCandidateThreshold）→ false', () => {
      const service = new CandidateSearchRetryService()
      const strategies: CandidateKeywordStrategy[] = [
        { strategy: 'typo_fix', keywords: ['kw'], reason: '' },
      ]
      expect(service.shouldContinueRetry(1, 3, strategies, 5, 1)).toBe(false)
    })

    it('未达终止条件 → true', () => {
      const service = new CandidateSearchRetryService()
      const strategies: CandidateKeywordStrategy[] = [
        { strategy: 'typo_fix', keywords: ['kw'], reason: '' },
      ]
      expect(service.shouldContinueRetry(1, 3, strategies, 0, 1)).toBe(true)
    })
  })

  describe('generateKeywordStrategies', () => {
    it('LLM 返回完整 keywordStrategies（含 original + typo_fix）→ 透传', () => {
      const service = new CandidateSearchRetryService()
      const intentResult = {
        keywordStrategies: [
          { strategy: 'original', keywords: ['看东房'], reason: '用户原词' },
          { strategy: 'typo_fix', keywords: ['看东方'], reason: '错别字修复' },
        ],
      }

      const result = service.generateKeywordStrategies(intentResult, '看东房')

      expect(result).toHaveLength(2)
      expect(result[0]?.strategy).toBe('original')
      expect(result[1]?.strategy).toBe('typo_fix')
    })

    it('LLM 只返回 original（无其它策略）→ 退化为仅含 original', () => {
      const service = new CandidateSearchRetryService()
      const intentResult = {
        keywordStrategies: [
          { strategy: 'original', keywords: ['看东房'], reason: '用户原词' },
        ],
      }

      const result = service.generateKeywordStrategies(intentResult, '看东房')

      expect(result).toHaveLength(1)
      expect(result[0]?.strategy).toBe('original')
      expect(result[0]?.reason).toContain('LLM 关键词策略生成失败')
    })

    it('LLM 返回非数组 keywordStrategies → 退化为仅含 original', () => {
      const service = new CandidateSearchRetryService()
      const intentResult = {
        keywordStrategies: 'invalid',
      }

      const result = service.generateKeywordStrategies(intentResult, '看东房')

      expect(result).toHaveLength(1)
      expect(result[0]?.strategy).toBe('original')
      expect(result[0]?.keywords).toEqual(['看东房'])
    })

    it('LLM 返回空数组 keywordStrategies → 退化为仅含 original', () => {
      const service = new CandidateSearchRetryService()
      const intentResult = {
        keywordStrategies: [],
      }

      const result = service.generateKeywordStrategies(intentResult, '看东房')

      expect(result).toHaveLength(1)
      expect(result[0]?.strategy).toBe('original')
    })

    it('LLM 无 keywordStrategies 字段 → 退化为仅含 original', () => {
      const service = new CandidateSearchRetryService()
      const intentResult = undefined

      const result = service.generateKeywordStrategies(intentResult, '看东房')

      expect(result).toHaveLength(1)
      expect(result[0]?.strategy).toBe('original')
      expect(result[0]?.keywords).toEqual(['看东房'])
    })

    it('fallbackOriginal 长度 < 2 → 返回空数组', () => {
      const service = new CandidateSearchRetryService()
      const intentResult = undefined

      const result = service.generateKeywordStrategies(intentResult, 'a')

      expect(result).toHaveLength(0)
    })
  })

  describe('buildSearchRetryPlan', () => {
    it('构造完整的重试计划记录', () => {
      const service = new CandidateSearchRetryService()
      const strategies: CandidateKeywordStrategy[] = [
        { strategy: 'original', keywords: ['看东房'], reason: '原词' },
        { strategy: 'typo_fix', keywords: ['看东方'], reason: '错别字' },
      ]
      const attempts = [
        {
          keyword: '看东房',
          source: 'primary' as const,
          candidateCount: 0,
          candidateIds: [],
          strategyLabel: 'original' as const,
          round: 0,
        },
      ]

      const plan = service.buildSearchRetryPlan(
        '看东房',
        ['看', '东房'],
        strategies,
        attempts,
        'ready',
        100,
        false,
        'satisfied',
        'proceed_to_selection',
      )

      expect(plan.searchedKeyword).toBe('看东房')
      expect(plan.searchedFacets).toEqual(['看', '东房'])
      expect(plan.candidateSourceStatus).toBe('ready')
      expect(plan.candidateRecordCount).toBe(100)
      expect(plan.keywordStrategies).toHaveLength(2)
      expect(plan.searchAttempts).toHaveLength(1)
      expect(plan.suggestedKeywords).toContain('看东房')
      expect(plan.triggeredSecondaryReflection).toBe(false)
      expect(plan.terminationReason).toBe('satisfied')
      expect(plan.nextAction).toBe('proceed_to_selection')
    })
  })
})
