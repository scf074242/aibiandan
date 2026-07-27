import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { getAtomicCapabilities, resetAtomicCapabilities } from '@/services/atomicCapabilities'
import {
  getCandidateService,
  resetCandidateService,
  type ProgramSearchParams,
} from '@/services/candidateService'
import { clearRuntimeLayout } from '@/services/orchestration/runtimeLayoutRegistry'
import type {
  CandidateQueryCriteria,
  GapInfo,
} from '@/types/orchestration'
import type { CandidateKeywordStrategy } from '@/services/agent/candidateSearchRetryService'

const baseDate = '2026-03-25'

/**
 * 构造 ISO 时间字符串（+08:00 时区）
 */
const iso = (time: string) => `${baseDate}T${time}+08:00`

/**
 * 构造测试用 GapInfo
 */
const createGap = (overrides: Partial<GapInfo> = {}): GapInfo => ({
  id: 'gap-retry-test',
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
 *
 * 设计要点：
 * - columnId 设为空串，让所有候选项通过栏目过滤（allowedProgramIds.size === 0）
 * - expectedDuration 设置为容纳 mock 数据中 1800 秒时长的候选
 * - excludeUsed=false 避免被使用状态过滤
 * - 不设 searchKeywords，由 queryCandidatesWithRetry 内部 executeRetryLoop 替换
 */
const createCriteria = (overrides: Partial<CandidateQueryCriteria> = {}): CandidateQueryCriteria => ({
  targetTimeRange: { start: iso('09:00:00'), end: iso('09:30:00') },
  expectedDuration: { min: 60, max: 3600 },
  channelId: 'dragon',
  columnId: '',
  excludeUsed: false,
  ...overrides,
})

/**
 * 构造测试用 ProgramSearchParams（UI 直查路径）
 */
const createSearchParams = (overrides: Partial<ProgramSearchParams> = {}): ProgramSearchParams => ({
  channelId: 'dragon',
  programName: '',
  ...overrides,
})

describe('CandidateService 节目检索重试扩展（阶段 3）', () => {
  beforeEach(async () => {
    resetCandidateService()
    resetAtomicCapabilities()
    clearRuntimeLayout('dragon', baseDate)
    await getAtomicCapabilities().clearAll()
  })

  afterEach(() => {
    clearRuntimeLayout('dragon', baseDate)
  })

  describe('queryCandidatesWithRetry', () => {
    it('接收 keywordStrategies 后走重试路径并返回 searchRetryPlan', async () => {
      const service = getCandidateService()
      const gap = createGap()
      const criteria = createCriteria()
      // 使用 mock 数据中存在的"看东方"关键词（typoFixMockCandidates）
      const keywordStrategies: CandidateKeywordStrategy[] = [
        { strategy: 'original', keywords: ['看东方'], reason: '用户原词' },
        { strategy: 'typo_fix', keywords: ['看东房'], reason: '错别字修复假设' },
      ]

      const result = await service.queryCandidatesWithRetry(gap, criteria, { keywordStrategies })

      // 应命中"看东方"多期候选（mock 数据有 111/112/113 三期）
      expect(result.candidates.length).toBeGreaterThan(0)
      expect(result.candidates.some((c) => c.programName.includes('看东方'))).toBe(true)
      // searchRetryPlan 应被透传
      expect(result.searchRetryPlan).toBeDefined()
      expect(result.searchRetryPlan?.searchAttempts.length).toBeGreaterThan(0)
    })

    it('无 keywordStrategies 时退化为原 queryCandidates 行为（无 searchRetryPlan）', async () => {
      const service = getCandidateService()
      const gap = createGap()
      const criteria = createCriteria({ searchKeywords: ['看东方'] })

      const result = await service.queryCandidatesWithRetry(gap, criteria)

      // 无 keywordStrategies 时不应有 searchRetryPlan
      expect(result.searchRetryPlan).toBeUndefined()
      expect(result.candidates.length).toBeGreaterThan(0)
    })

    it('合并去重候选（多策略命中同一候选只保留一份）', async () => {
      const service = getCandidateService()
      const gap = createGap()
      const criteria = createCriteria()
      // original 和 typo_fix 都用"看东方"，应命中同一批候选
      const keywordStrategies: CandidateKeywordStrategy[] = [
        { strategy: 'original', keywords: ['看东方'], reason: '用户原词' },
        { strategy: 'typo_fix', keywords: ['看东方'], reason: '与原词相同（测试去重）' },
      ]

      const result = await service.queryCandidatesWithRetry(gap, criteria, { keywordStrategies })

      // 验证去重：候选项 ID 不重复
      const ids = result.candidates.map((c) => c.id)
      const uniqueIds = new Set(ids)
      expect(ids.length).toBe(uniqueIds.size)
      // 应命中"看东方"候选
      expect(result.candidates.length).toBeGreaterThan(0)
    })

    it('透传 searchRetryPlan 含完整的重试记录字段', async () => {
      const service = getCandidateService()
      const gap = createGap()
      const criteria = createCriteria()
      const keywordStrategies: CandidateKeywordStrategy[] = [
        { strategy: 'original', keywords: ['看东方'], reason: '用户原词' },
        { strategy: 'typo_fix', keywords: ['看东房'], reason: '错别字修复' },
      ]

      const result = await service.queryCandidatesWithRetry(gap, criteria, { keywordStrategies })

      expect(result.searchRetryPlan).toBeDefined()
      const plan = result.searchRetryPlan!
      // 验证 searchRetryPlan 关键字段
      expect(plan.searchAttempts.length).toBeGreaterThan(0)
      expect(plan.terminationReason).toBeDefined()
      expect(['satisfied', 'max_round', 'all_strategies_exhausted']).toContain(plan.terminationReason)
      expect(plan.nextAction).toBeDefined()
      expect(['proceed_to_selection', 'needs_clarification', 'rewrite_keywords_and_retry']).toContain(plan.nextAction)
      // 验证 keywordStrategies 被透传到 plan
      expect(plan.keywordStrategies).toBeDefined()
      expect(plan.keywordStrategies?.length).toBe(2)
      // 验证 searchAttempts 含策略标签
      expect(plan.searchAttempts[0]?.strategyLabel).toBe('original')
    })

    it('所有策略 0 命中时返回空候选并暴露失败（needs_clarification）', async () => {
      const service = getCandidateService()
      const gap = createGap()
      const criteria = createCriteria()
      const keywordStrategies: CandidateKeywordStrategy[] = [
        { strategy: 'original', keywords: ['不存在的栏目XYZ'], reason: '用户原词' },
        { strategy: 'paraphrase', keywords: ['栏目XYZ'], reason: '近义改写' },
      ]

      const result = await service.queryCandidatesWithRetry(gap, criteria, { keywordStrategies })

      expect(result.candidates).toHaveLength(0)
      expect(result.searchRetryPlan?.terminationReason).toBe('all_strategies_exhausted')
      expect(result.searchRetryPlan?.nextAction).toBe('needs_clarification')
    })
  })

  describe('searchProgramsWithKeywordExpansion', () => {
    it('UI 直查路径接收 keywordStrategies 后返回合并去重候选', async () => {
      const service = getCandidateService()
      const params = createSearchParams({ programName: '看东方' })
      const keywordStrategies: CandidateKeywordStrategy[] = [
        { strategy: 'original', keywords: ['看东方'], reason: '用户原词' },
        { strategy: 'typo_fix', keywords: ['看东房'], reason: '错别字修复假设' },
      ]

      const result = await service.searchProgramsWithKeywordExpansion(params, { keywordStrategies })

      // 应命中"看东方"候选
      expect(result.length).toBeGreaterThan(0)
      expect(result.some((c) => c.programName.includes('看东方'))).toBe(true)
      // 验证去重
      const ids = result.map((c) => c.id)
      const uniqueIds = new Set(ids)
      expect(ids.length).toBe(uniqueIds.size)
    })

    it('无 keywordStrategies 时退化为原 searchPrograms 行为', async () => {
      const service = getCandidateService()
      const params = createSearchParams({ programName: '看东方' })

      const result = await service.searchProgramsWithKeywordExpansion(params)

      expect(result.length).toBeGreaterThan(0)
      expect(result.some((c) => c.programName.includes('看东方'))).toBe(true)
    })

    it('所有策略 0 命中时返回空数组', async () => {
      const service = getCandidateService()
      const params = createSearchParams({ programName: '不存在的栏目XYZ' })
      const keywordStrategies: CandidateKeywordStrategy[] = [
        { strategy: 'original', keywords: ['不存在的栏目XYZ'], reason: '用户原词' },
        { strategy: 'paraphrase', keywords: ['栏目XYZ'], reason: '近义改写' },
      ]

      const result = await service.searchProgramsWithKeywordExpansion(params, { keywordStrategies })

      expect(result).toHaveLength(0)
    })
  })
})
