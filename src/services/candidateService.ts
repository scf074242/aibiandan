import {
  orchestrationDemoCandidates,
} from '@/mock/orchestrationMock'
import { candidateSearchRetryMockCandidates } from '@/mock/candidateSearchRetryMock'
import { getAtomicCapabilities } from './atomicCapabilities'
import {
  getCandidateSearchRetryService,
  DEFAULT_TV_RETRY_CONFIG,
  type CandidateKeywordStrategy,
  type CandidateSearchAttempt,
  type CandidateSearchRetryConfig,
  type CandidateSearchRetryPlan,
} from './agent/candidateSearchRetryService'
import {
  getEffectiveColumnDefinition,
  getEffectiveProgramsByColumn,
} from './orchestration/runtimeLayoutRegistry'
import {
  extractFunctionalSearchKeywords,
  extractSoftSearchKeywords,
  hasEditorialKeywordRequirements,
  hasExplicitSequenceRequirements,
  hasFunctionalSearchKeywords,
  hasSpecificSearchKeywords,
  matchesEditorialKeywordRequirementsByFields,
  matchesExplicitSequenceRequirements,
  matchesFunctionalSearchKeywords,
  matchesSpecificSearchKeywords,
  normalizeCandidateKeyword,
} from './candidateKeywordMatcher'
import type {
  CandidateQueryDiagnostics,
  CandidateQueryCriteria,
  CandidateQueryResult,
  DraftSelectionPriority,
  EditorialSelectionDecision,
  EditorialSelectionDimension,
  GapInfo,
  ProgramCandidate,
  ScheduleItemSnapshot,
} from '@/types/orchestration'

export interface CandidateServiceConfig {
  defaultLimit: number
  maxLimit: number
  enableCache: boolean
  cacheTTL: number
}

export interface ProgramSearchParams {
  channelId: string
  programName: string
  columnId?: string
  programTypes?: string[]
  limit?: number
  columnStrategy?: 'strict' | 'prefer_channel'
}

type SelectionMode = 'sequential' | 'rerun' | 'default'

type CandidateWithStrategy = ProgramCandidate & {
  sequenceNo?: number
  expectedSequenceNo?: number
  selectionMode?: SelectionMode
  selectionNote?: string
  editorialDecision?: EditorialSelectionDecision
}

type CandidateSortContext = {
  channelId: string
  columnId?: string
  gap?: GapInfo
  criteria?: CandidateQueryCriteria
  keyword?: string
}

type ScheduledItemRecord = ScheduleItemSnapshot & {
  keySlot?: string
  columnId?: string
  code18?: string
  instanceName?: string
}

type ScheduledSequenceState = {
  maxSequenceBySeries: Map<string, number>
  minFutureSequenceBySeries: Map<string, number>
  seriesWithSchedule: Set<string>
  currentScheduleOverridesHistory: boolean
}

const DEFAULT_CONFIG: CandidateServiceConfig = {
  defaultLimit: 10,
  maxLimit: 30,
  enableCache: true,
  cacheTTL: 5 * 60 * 1000,
}

export class CandidateService {
  private config: CandidateServiceConfig
  private cache = new Map<string, { result: CandidateQueryResult; timestamp: number }>()
  private candidates: ProgramCandidate[]
  private atomicCapabilities = getAtomicCapabilities()
  private candidateByProgramCode: Map<string, ProgramCandidate>

  constructor(config?: Partial<CandidateServiceConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    // 合并 orchestrationDemoCandidates 与 candidateSearchRetryMockCandidates，按 programCode 去重
    const mergedByCode = new Map<string, ProgramCandidate>()
    orchestrationDemoCandidates.forEach((item) => {
      mergedByCode.set(item.programCode || item.id, { ...item })
    })
    candidateSearchRetryMockCandidates.forEach((item) => {
      const key = item.programCode || item.id
      if (!mergedByCode.has(key)) {
        mergedByCode.set(key, { ...item })
      }
    })
    this.candidates = Array.from(mergedByCode.values())
    this.candidateByProgramCode = new Map(
      this.candidates.map((item) => [item.programCode, item]),
    )
  }

  async queryCandidates(gap: GapInfo, criteria: CandidateQueryCriteria): Promise<CandidateQueryResult> {
    const cacheKey = JSON.stringify({
      gapId: gap.id,
      criteria,
      scheduleSignature: this.buildScheduleSignature(),
    })
    const cached = this.cache.get(cacheKey)
    if (cached && this.config.enableCache && Date.now() - cached.timestamp < this.config.cacheTTL) {
      return { ...cached.result, queryTime: new Date().toISOString() }
    }

    const allowedProgramIds = new Set(
      getEffectiveProgramsByColumn(criteria.channelId, criteria.columnId).map((item) => item.programId),
    )

    const sourcePool = this.candidates.filter((candidate) => candidate.channelId === criteria.channelId)
    const columnMatched = sourcePool.filter((candidate) =>
      allowedProgramIds.size === 0 || allowedProgramIds.has(candidate.programId),
    )
    const durationMatched = columnMatched.filter((candidate) => this.matchesDuration(candidate, criteria, gap))
    const typeMatched = durationMatched.filter((candidate) =>
      this.matchesProgramType(candidate, criteria.programTypePreference),
    )
    const usageMatched = typeMatched.filter((candidate) =>
      this.matchesUsageState(candidate, criteria.excludeUsed),
    )
    const shouldExcludeHistory = this.shouldExcludeHistoryPrograms(criteria)
    const filtered = usageMatched.filter((candidate) =>
      !shouldExcludeHistory || !this.isHistoryProgramCode(candidate.programCode, criteria.historyReference),
    )
    const sequenceState = this.resolveSequentialDiagnosticsState(criteria, gap)
    const keywordMatched = criteria.searchKeywords?.length
      ? filtered.filter((candidate) => this.matchesSearchKeywords(candidate, criteria.searchKeywords ?? []))
      : filtered
    const specificKeywordRequired = Boolean(criteria.searchKeywords?.length && hasSpecificSearchKeywords(criteria.searchKeywords))
    const explicitSequenceRequired = Boolean(criteria.searchKeywords?.length && hasExplicitSequenceRequirements(criteria.searchKeywords))
    const editorialKeywordRequired = Boolean(criteria.searchKeywords?.length && hasEditorialKeywordRequirements(criteria.searchKeywords))
    const functionalKeywordRequired = Boolean(criteria.searchKeywords?.length && hasFunctionalSearchKeywords(criteria.searchKeywords))
    const hardKeywordRequired = specificKeywordRequired || explicitSequenceRequired || editorialKeywordRequired
    const requiresKeywordMatch = hardKeywordRequired || functionalKeywordRequired
    const fallbackToBroadQuery = Boolean(criteria.searchKeywords?.length && !requiresKeywordMatch && keywordMatched.length === 0)
    const effectiveCandidates = requiresKeywordMatch
      ? keywordMatched
      : keywordMatched.length > 0 ? keywordMatched : filtered

    const sorted = this.sortCandidates(effectiveCandidates, {
      channelId: criteria.channelId,
      columnId: criteria.columnId,
      gap,
      criteria,
    }).slice(0, this.config.defaultLimit)
    const sequenceContextRejected = Boolean(
      this.shouldUseSequentialColumnStrategy(criteria, criteria.columnId)
      && effectiveCandidates.length > 0
      && sorted.length === 0,
    )

    const diagnostics = this.buildQueryDiagnostics({
      criteria,
      sourcePoolCount: sourcePool.length,
      columnMatchedCount: columnMatched.length,
      durationMatchedCount: durationMatched.length,
      typeMatchedCount: typeMatched.length,
      usageMatchedCount: usageMatched.length,
      historyMatchedCount: filtered.length,
      keywordMatchedCount: keywordMatched.length,
      finalCandidateCount: sorted.length,
      hardKeywordRequired,
      explicitSequenceRequired,
      functionalKeywordRequired,
      sequenceContextRejected,
      fallbackToBroadQuery,
      currentScheduleOverridesHistory: sequenceState?.currentScheduleOverridesHistory ?? false,
    })

    // dev 环境下候选检索为空时输出诊断日志，定位 channelId/columnId/programType 哪层过滤为空
    if (sorted.length === 0 && import.meta.env.DEV) {
      console.warn('[candidateService] 候选检索为空', {
        gapId: gap.id,
        channelId: criteria.channelId,
        columnId: criteria.columnId,
        programTypePreference: criteria.programTypePreference,
        searchKeywords: criteria.searchKeywords,
        layerCounts: {
          sourcePool: sourcePool.length,
          columnMatched: columnMatched.length,
          durationMatched: durationMatched.length,
          typeMatched: typeMatched.length,
          usageMatched: usageMatched.length,
          historyMatched: filtered.length,
          keywordMatched: keywordMatched.length,
          finalCandidate: sorted.length,
        },
        sequenceContextRejected,
        fallbackToBroadQuery,
      })
    }

    const result: CandidateQueryResult = {
      gapId: gap.id,
      candidates: sorted,
      totalCount: sorted.length,
      queryTime: new Date().toISOString(),
      diagnostics,
    }

    this.cache.set(cacheKey, { result, timestamp: Date.now() })

    return result
  }

  getCandidateById(candidateId: string): ProgramCandidate | undefined {
    return this.candidates.find((item) => item.id === candidateId || item.programCode === candidateId)
  }

  private buildQueryDiagnostics(input: {
    criteria: CandidateQueryCriteria
    sourcePoolCount: number
    columnMatchedCount: number
    durationMatchedCount: number
    typeMatchedCount: number
    usageMatchedCount: number
    historyMatchedCount: number
    keywordMatchedCount: number
    finalCandidateCount: number
    hardKeywordRequired: boolean
    explicitSequenceRequired: boolean
    functionalKeywordRequired: boolean
    sequenceContextRejected: boolean
    fallbackToBroadQuery: boolean
    currentScheduleOverridesHistory: boolean
  }): CandidateQueryDiagnostics {
    const rejectionReasons: string[] = []
    const notes: string[] = []

    if (input.sourcePoolCount === 0) {
      rejectionReasons.push('channel_has_no_programs')
    }
    if (input.sourcePoolCount > 0 && input.columnMatchedCount === 0) {
      rejectionReasons.push('column_has_no_programs')
    }
    if (input.columnMatchedCount > 0 && input.durationMatchedCount === 0) {
      rejectionReasons.push('duration_mismatch')
    }
    if (input.durationMatchedCount > 0 && input.typeMatchedCount === 0) {
      rejectionReasons.push('program_type_mismatch')
    }
    if (input.typeMatchedCount > 0 && input.usageMatchedCount === 0) {
      rejectionReasons.push('all_candidates_already_used')
    }
    if (input.usageMatchedCount > 0 && input.historyMatchedCount === 0) {
      rejectionReasons.push('all_candidates_excluded_by_history')
    }
    if (input.historyMatchedCount > 0 && input.keywordMatchedCount === 0 && input.explicitSequenceRequired) {
      rejectionReasons.push('explicit_sequence_no_match')
    }
    if (input.historyMatchedCount > 0 && input.keywordMatchedCount === 0 && input.functionalKeywordRequired) {
      rejectionReasons.push('functional_keyword_no_match')
    }
    if (input.historyMatchedCount > 0 && input.keywordMatchedCount === 0 && input.hardKeywordRequired) {
      rejectionReasons.push('hard_keyword_no_match')
    }
    if (input.finalCandidateCount === 0 && input.explicitSequenceRequired && !rejectionReasons.includes('explicit_sequence_no_match')) {
      rejectionReasons.push('explicit_sequence_no_match')
    }
    if (input.finalCandidateCount === 0 && input.functionalKeywordRequired && !rejectionReasons.includes('functional_keyword_no_match')) {
      rejectionReasons.push('functional_keyword_no_match')
    }
    if (input.finalCandidateCount === 0 && input.hardKeywordRequired && !rejectionReasons.includes('hard_keyword_no_match')) {
      rejectionReasons.push('hard_keyword_no_match')
    }
    if (input.sequenceContextRejected) {
      rejectionReasons.push('sequence_context_order_conflict')
    }
    if (input.finalCandidateCount === 0 && rejectionReasons.length === 0) {
      rejectionReasons.push('no_candidate_after_ranking')
    }

    if (input.hardKeywordRequired) {
      notes.push('hard_keyword_required')
    }
    if (input.explicitSequenceRequired) {
      notes.push('explicit_sequence_required')
    }
    if (input.functionalKeywordRequired) {
      notes.push('functional_keyword_required')
    }
    if (input.fallbackToBroadQuery) {
      notes.push('soft_keyword_fallback_to_broad_query')
    }
    if (input.criteria.selectionPolicy?.primary) {
      notes.push(`selection_priority:${input.criteria.selectionPolicy.primary}`)
    }
    if (input.criteria.historyReference) {
      notes.push('history_reference_loaded')
    }
    if (input.currentScheduleOverridesHistory) {
      notes.push('current_schedule_overrides_history')
    }
    if (input.sequenceContextRejected) {
      notes.push('sequence_context_rejected_all_candidates')
    }

    return {
      sourcePoolCount: input.sourcePoolCount,
      columnMatchedCount: input.columnMatchedCount,
      durationMatchedCount: input.durationMatchedCount,
      typeMatchedCount: input.typeMatchedCount,
      usageMatchedCount: input.usageMatchedCount,
      historyMatchedCount: input.historyMatchedCount,
      keywordMatchedCount: input.keywordMatchedCount,
      finalCandidateCount: input.finalCandidateCount,
      hardKeywordRequired: input.hardKeywordRequired,
      explicitSequenceRequired: input.explicitSequenceRequired,
      functionalKeywordRequired: input.functionalKeywordRequired,
      sequenceContextRejected: input.sequenceContextRejected,
      fallbackToBroadQuery: input.fallbackToBroadQuery,
      selectionPriority: input.criteria.selectionPolicy?.primary,
      rejectionReasons,
      notes,
    }
  }

  clearCache(): void {
    this.cache.clear()
  }

  async searchPrograms(params: ProgramSearchParams): Promise<ProgramCandidate[]> {
    const keyword = params.programName.trim().toLowerCase()
    const limit = Math.min(params.limit ?? this.config.defaultLimit, this.config.maxLimit)
    const allowedProgramIds = params.columnId
      ? new Set(getEffectiveProgramsByColumn(params.channelId, params.columnId).map((item) => item.programId))
      : null

    const filtered = this.filterProgramSearchCandidates(params, keyword, allowedProgramIds)
    if (filtered.length > 0 || !allowedProgramIds || params.columnStrategy !== 'prefer_channel') {
      return this.sortCandidates(filtered, {
        channelId: params.channelId,
        columnId: params.columnId,
        keyword,
      }).slice(0, limit)
    }

    const channelFallback = this.filterProgramSearchCandidates(params, keyword, null)
    return this.sortCandidates(channelFallback, {
      channelId: params.channelId,
      keyword,
    }).slice(0, limit)
  }

  /**
   * 带重试的候选查询（阶段 3 引入）。
   *
   * 在 queryCandidates 基础上叠加多轮关键词组合重试：
   * - 接收意图解析阶段 LLM 一次性生成的 keywordStrategies
   * - 调 candidateSearchRetryService.executeRetryLoop 按策略优先级本地轮询 queryCandidates
   * - 合并去重候选，记录 searchRetryPlan 透传到结果
   *
   * 设计约束（AGENTS.md）：
   * - 重试阶段不再调 LLM（escape hatch 除外，本阶段不接入）
   * - 按策略优先级 original → typo_fix → decompose → paraphrase → column_demote → broaden 依次检索
   * - 默认 3 次，最大 5 次
   * - 不改变现有 queryCandidates 行为
   *
   * @param gap 时段信息
   * @param criteria 查询条件（首轮使用，重试阶段会替换 searchKeywords）
   * @param options 重试选项（含 keywordStrategies 与 retryConfig）
   * @returns 候选查询结果，含 searchRetryPlan 透传字段
   */
  async queryCandidatesWithRetry(
    gap: GapInfo,
    criteria: CandidateQueryCriteria,
    options?: {
      keywordStrategies?: CandidateKeywordStrategy[]
      retryConfig?: Partial<CandidateSearchRetryConfig>
      onAttempt?: (attempt: CandidateSearchAttempt) => void
      onAttemptStart?: (attempt: CandidateSearchAttempt) => void
    },
  ): Promise<CandidateQueryResult & { searchRetryPlan?: CandidateSearchRetryPlan }> {
    // 无 keywordStrategies 时直接走原 queryCandidates，行为完全一致
    if (!options?.keywordStrategies || options.keywordStrategies.length === 0) {
      const result = await this.queryCandidates(gap, criteria)
      return { ...result }
    }

    const retryConfig: CandidateSearchRetryConfig = {
      ...DEFAULT_TV_RETRY_CONFIG,
      ...options.retryConfig,
      // 硬上限 5 次，不可被配置覆盖
      maxRound: Math.min(options.retryConfig?.maxRound ?? DEFAULT_TV_RETRY_CONFIG.maxRound, 5),
    }

    const retryService = getCandidateSearchRetryService()
    // 注入 queryCandidates 作为底层检索函数（避免循环依赖）
    const queryFn = async (gapArg: GapInfo, criteriaArg: CandidateQueryCriteria): Promise<ProgramCandidate[]> => {
      const result = await this.queryCandidates(gapArg, criteriaArg)
      return result.candidates
    }

    const { candidates, searchRetryPlan } = await retryService.executeRetryLoop(
      gap,
      criteria,
      options.keywordStrategies,
      retryConfig,
      queryFn,
      options.onAttempt,
      options.onAttemptStart,
    )

    // 合并去重后的候选按原排序逻辑重新排序截断
    const sorted = this.sortCandidates(candidates, {
      channelId: criteria.channelId,
      columnId: criteria.columnId,
      gap,
      criteria,
    }).slice(0, this.config.defaultLimit)

    const result: CandidateQueryResult & { searchRetryPlan?: CandidateSearchRetryPlan } = {
      gapId: gap.id,
      candidates: sorted,
      totalCount: sorted.length,
      queryTime: new Date().toISOString(),
      diagnostics: this.buildQueryDiagnostics({
        criteria,
        sourcePoolCount: this.candidates.filter((c) => c.channelId === criteria.channelId).length,
        columnMatchedCount: sorted.length,
        durationMatchedCount: sorted.length,
        typeMatchedCount: sorted.length,
        usageMatchedCount: sorted.length,
        historyMatchedCount: sorted.length,
        keywordMatchedCount: sorted.length,
        finalCandidateCount: sorted.length,
        hardKeywordRequired: false,
        explicitSequenceRequired: false,
        functionalKeywordRequired: false,
        sequenceContextRejected: false,
        fallbackToBroadQuery: false,
        currentScheduleOverridesHistory: false,
      }),
      searchRetryPlan,
    }

    return result
  }

  /**
   * 带关键词扩展的节目名检索（阶段 3 引入，用于 UI 直查路径）。
   *
   * 在 searchPrograms 基础上叠加多轮关键词组合重试：
   * - 接收意图解析阶段 LLM 一次性生成的 keywordStrategies
   * - 调 candidateSearchRetryService.executeRetryLoop 按策略优先级本地轮询 searchPrograms
   * - 合并去重候选
   *
   * @param params 节目检索参数（首轮使用）
   * @param options 重试选项（含 keywordStrategies 与 retryConfig）
   * @returns 合并去重后的候选列表
   */
  async searchProgramsWithKeywordExpansion(
    params: ProgramSearchParams,
    options?: {
      keywordStrategies?: CandidateKeywordStrategy[]
      retryConfig?: Partial<CandidateSearchRetryConfig>
    },
  ): Promise<ProgramCandidate[]> {
    // 无 keywordStrategies 时直接走原 searchPrograms，行为完全一致
    if (!options?.keywordStrategies || options.keywordStrategies.length === 0) {
      return this.searchPrograms(params)
    }

    const retryConfig: CandidateSearchRetryConfig = {
      ...DEFAULT_TV_RETRY_CONFIG,
      ...options.retryConfig,
      maxRound: Math.min(options.retryConfig?.maxRound ?? DEFAULT_TV_RETRY_CONFIG.maxRound, 5),
    }

    const limit = Math.min(params.limit ?? this.config.defaultLimit, this.config.maxLimit)

    // 按策略优先级排序后依次检索（searchPrograms 签名与 queryCandidates 不同，手动实现重试循环）
    const sortedStrategies = [...options.keywordStrategies].sort((left, right) => {
      const priority: Record<string, number> = {
        original: 0, typo_fix: 1, decompose: 2, paraphrase: 3, column_demote: 4, broaden: 5,
      }
      return (priority[left.strategy] ?? 99) - (priority[right.strategy] ?? 99)
    })

    const merged = new Map<string, ProgramCandidate>()
    const seenKeywords = new Set<string>()
    let round = 0

    for (const strategy of sortedStrategies) {
      if (round >= retryConfig.maxRound) break
      if (merged.size >= retryConfig.minCandidateThreshold) break

      for (const keyword of strategy.keywords) {
        if (seenKeywords.has(keyword)) continue
        seenKeywords.add(keyword)
        const hitCandidates = await this.searchPrograms({ ...params, programName: keyword })
        hitCandidates.forEach((candidate) => {
          const key = candidate.id || candidate.programCode || candidate.programId || candidate.programName
          if (!merged.has(key)) merged.set(key, candidate)
        })
      }
      round += 1
    }

    return Array.from(merged.values()).slice(0, limit)
  }

  private filterProgramSearchCandidates(
    params: ProgramSearchParams,
    keyword: string,
    allowedProgramIds: Set<string> | null,
  ): ProgramCandidate[] {
    const keywordProgramTypes = this.inferProgramTypesFromKeyword(keyword)
    const searchKeywords = [params.programName].filter(Boolean)
    const hasSpecificKeyword = hasSpecificSearchKeywords(searchKeywords)
    const hasEditorialKeyword = hasEditorialKeywordRequirements(searchKeywords)
    const hasFunctionalKeyword = hasFunctionalSearchKeywords(searchKeywords)
    return this.candidates
      .filter((candidate) => candidate.channelId === params.channelId)
      .filter((candidate) => !allowedProgramIds || allowedProgramIds.has(candidate.programId))
      .filter((candidate) => !params.programTypes?.length || this.matchesProgramType(candidate, params.programTypes))
      .filter((candidate) => {
        if (!keyword) return true
        const haystack = this.buildCandidateSearchText(candidate)
        if (!matchesExplicitSequenceRequirements(haystack, searchKeywords)) {
          return false
        }
        if (!this.matchesEditorialKeywordRequirements(candidate, searchKeywords)) {
          return false
        }
        if (hasSpecificKeyword || hasFunctionalKeyword) {
          return (!hasSpecificKeyword || matchesSpecificSearchKeywords(haystack, searchKeywords))
            && (!hasFunctionalKeyword || matchesFunctionalSearchKeywords(haystack, searchKeywords))
        }
        if (hasEditorialKeyword) {
          return true
        }
        return haystack.toLowerCase().includes(keyword) || keywordProgramTypes.includes(candidate.programType)
      })
      .filter((candidate) => !this.isScheduledProgramCode(candidate.programCode))
  }

  private inferProgramTypesFromKeyword(keyword: string): string[] {
    const normalized = keyword.replace(/\s+/g, '').toLowerCase()
    if (!normalized) return []
    const mappings: Array<{ pattern: RegExp; types: string[] }> = [
      { pattern: /(新闻|快报|联播)/, types: ['news'] },
      { pattern: /(资讯|专题|预告|导视|垫片|直播|现场|服务|提醒|交通|天气|社区|发布会|展会|eye)/i, types: ['news_magazine'] },
      { pattern: /(电视剧|剧场|短剧|连续剧|影视)/, types: ['drama'] },
      { pattern: /(综艺|娱乐)/, types: ['entertainment'] },
      { pattern: /(健康|养生)/, types: ['health'] },
      { pattern: /(评论|访谈|观察|观点|民生)/, types: ['commentary'] },
      { pattern: /(少儿|动画|亲子|儿童)/, types: ['kids'] },
      { pattern: /(纪录片|纪实)/, types: ['documentary'] },
    ]
    return mappings.find((item) => item.pattern.test(normalized))?.types ?? []
  }

  private scoreCandidate(candidate: ProgramCandidate, gap: GapInfo, criteria: CandidateQueryCriteria): number {
    const durationScore = criteria.columnId
      ? 60
      : 100 - Math.abs(candidate.duration - gap.duration) / 60
    const typeScore = criteria.programTypePreference?.includes(candidate.programType) ? 25 : 0
    const keywordScore = this.buildKeywordScore(candidate, criteria.searchKeywords ?? [])
    const rerunScore = this.buildRerunScore(candidate)
    return durationScore + typeScore + keywordScore + rerunScore
  }

  private matchesSearchKeywords(candidate: ProgramCandidate, searchKeywords: string[]): boolean {
    if (searchKeywords.length === 0) {
      return true
    }

    const haystack = this.buildCandidateSearchText(candidate)
    if (!matchesExplicitSequenceRequirements(haystack, searchKeywords)) {
      return false
    }
    if (!this.matchesEditorialKeywordRequirements(candidate, searchKeywords)) {
      return false
    }

    const specificRequired = hasSpecificSearchKeywords(searchKeywords)
    const functionalRequired = hasFunctionalSearchKeywords(searchKeywords)
    if (specificRequired || functionalRequired) {
      return (!specificRequired || matchesSpecificSearchKeywords(haystack, searchKeywords))
        && (!functionalRequired || matchesFunctionalSearchKeywords(haystack, searchKeywords))
    }

    if (hasEditorialKeywordRequirements(searchKeywords)) {
      return true
    }

    const normalizedHaystack = normalizeCandidateKeyword(haystack)
    return extractSoftSearchKeywords(searchKeywords).some((keyword) => normalizedHaystack.includes(keyword))
  }

  private buildKeywordScore(candidate: ProgramCandidate, searchKeywords: string[]): number {
    const rawHaystack = this.buildCandidateSearchText(candidate)
    const haystack = normalizeCandidateKeyword(rawHaystack)
    const phraseScore = extractSoftSearchKeywords(searchKeywords).reduce((score, keyword) =>
      haystack.includes(keyword) ? score + 12 : score, 0)
    const functionalScore = extractFunctionalSearchKeywords(searchKeywords).reduce((score, keyword) =>
      haystack.includes(keyword) ? score + 18 : score, 0)
    return phraseScore + functionalScore
  }

  private scoreProgramSearch(candidate: ProgramCandidate, keyword: string): number {
    if (!keyword) {
      return (candidate.duration <= 3600 ? 20 : 0) + this.buildRerunScore(candidate)
    }

    const normalizedKeyword = normalizeCandidateKeyword(keyword)
    const normalizedName = normalizeCandidateKeyword(candidate.programName)
    const normalizedHaystack = normalizeCandidateKeyword(this.buildCandidateSearchText(candidate))
    const exactMatch = normalizedName === normalizedKeyword ? 100 : 0
    const prefixMatch = normalizedName.startsWith(normalizedKeyword) ? 30 : 0
    const containsMatch = normalizedHaystack.includes(normalizedKeyword) ? 10 : 0
    return exactMatch + prefixMatch + containsMatch + this.buildRerunScore(candidate)
  }

  private buildCandidateSearchText(candidate: ProgramCandidate): string {
    return [
      candidate.programName,
      candidate.instanceName,
      candidate.programCode,
      candidate.issueNo,
      candidate.columnName,
      candidate.columnId,
      ...(candidate.contentTags ?? []),
    ].filter(Boolean).join(' ')
  }

  private matchesEditorialKeywordRequirements(candidate: ProgramCandidate, searchKeywords: string[]): boolean {
    return matchesEditorialKeywordRequirementsByFields({
      column: [candidate.columnName, candidate.columnId].filter(Boolean).join(' '),
      title: [candidate.programName, candidate.instanceName].filter(Boolean).join(' '),
      content: [
        candidate.programName,
        candidate.instanceName,
        ...(candidate.contentTags ?? []),
      ].filter(Boolean).join(' '),
      all: this.buildCandidateSearchText(candidate),
    }, searchKeywords)
  }

  private sortCandidates(
    candidates: ProgramCandidate[],
    context: CandidateSortContext,
  ): ProgramCandidate[] {
    const columnId = context.columnId?.trim()
    if (columnId && context.criteria && this.shouldUseSequentialColumnStrategy(context.criteria, columnId)) {
      return this.sortSequentialCandidates(candidates, context, columnId)
    }
    return this.sortNonSequentialCandidates(candidates, context)
  }

  private sortSequentialCandidates(
    candidates: ProgramCandidate[],
    context: CandidateSortContext,
    columnId: string,
  ): ProgramCandidate[] {
    const allowedProgramIds = new Set(
      getEffectiveProgramsByColumn(context.channelId, columnId).map((item) => item.programId),
    )
    const scheduledState = this.collectScheduledSequenceState(
      columnId,
      allowedProgramIds,
      context.gap?.startTime,
      context.criteria?.historyReference,
    )

    const sequenceSafeCandidates = candidates.filter((candidate) => {
      const sequenceNo = this.extractSequenceNo(candidate)
      const seriesKey = this.buildSeriesKey(candidate)
      const futureMin = seriesKey ? scheduledState.minFutureSequenceBySeries.get(seriesKey) : undefined
      if (typeof futureMin !== 'number') {
        return true
      }
      return typeof sequenceNo === 'number' && sequenceNo < futureMin
    })

    const ranked = sequenceSafeCandidates.map((candidate, index) => {
      const sequenceNo = this.extractSequenceNo(candidate)
      const seriesKey = this.buildSeriesKey(candidate)
      const scheduledMax = seriesKey ? scheduledState.maxSequenceBySeries.get(seriesKey) : undefined
      const hasProgress = Boolean(seriesKey && scheduledState.seriesWithSchedule.has(seriesKey))
      const nextExpected = typeof scheduledMax === 'number' ? scheduledMax + 1 : 1
      const hasRecognizedSequence = typeof sequenceNo === 'number'
      const isAhead = hasRecognizedSequence ? sequenceNo >= nextExpected : false
      const distance = hasRecognizedSequence ? Math.abs(sequenceNo - nextExpected) : Number.POSITIVE_INFINITY
      const fallbackScore = this.scoreProgramSearch(candidate, context.keyword ?? '')
      const editorialDecision = this.buildSequentialEditorialDecision(candidate, {
        sequenceNo,
        nextExpected,
        hasProgress,
        hasRecognizedSequence,
        isAhead,
        distance,
        fallbackScore,
      })

      return {
        candidate: this.decorateCandidate(candidate, {
          sequenceNo: sequenceNo ?? undefined,
          expectedSequenceNo: nextExpected,
          selectionMode: 'sequential',
          selectionNote: this.buildSequentialSelectionNote(sequenceNo, nextExpected, hasProgress),
          editorialDecision,
        }),
        index,
        sequenceNo,
        hasRecognizedSequence,
        hasProgress,
        nextExpected,
        isAhead,
        distance,
        fallbackScore,
      }
    })

    ranked.sort((left, right) => {
      if (left.hasProgress !== right.hasProgress) {
        return left.hasProgress ? -1 : 1
      }
      if (left.hasRecognizedSequence !== right.hasRecognizedSequence) {
        return left.hasRecognizedSequence ? -1 : 1
      }
      if (left.hasRecognizedSequence && right.hasRecognizedSequence) {
        if (left.isAhead !== right.isAhead) {
          return left.isAhead ? -1 : 1
        }
        if (left.isAhead && right.isAhead && left.sequenceNo !== right.sequenceNo) {
          return (left.sequenceNo ?? Number.MAX_SAFE_INTEGER) - (right.sequenceNo ?? Number.MAX_SAFE_INTEGER)
        }
        if (!left.isAhead && !right.isAhead && left.sequenceNo !== right.sequenceNo) {
          return (right.sequenceNo ?? 0) - (left.sequenceNo ?? 0)
        }
        if (left.distance !== right.distance) {
          return left.distance - right.distance
        }
      }
      if (left.fallbackScore !== right.fallbackScore) {
        return right.fallbackScore - left.fallbackScore
      }
      return left.index - right.index
    })

    return ranked.map((entry) => entry.candidate)
  }

  private sortNonSequentialCandidates(
    candidates: ProgramCandidate[],
    context: CandidateSortContext,
  ): ProgramCandidate[] {
    const ratingPriority = context.criteria?.selectionPolicy?.primary === 'rating'
    const trendingPriority = context.criteria?.selectionPolicy?.primary === 'trending'
    const contentPriority = context.criteria?.selectionPolicy?.primary === 'content_match'
    return candidates
      .map((candidate, index) => {
        const estimatedRating = this.estimateCandidateRating(candidate)
        const trendScore = this.scoreCandidateTrendingHeat(candidate)
        const contentScore = context.criteria
          ? this.buildContentMatchScore(candidate, context.criteria.searchKeywords ?? [])
          : 0
        const editorialDecision = this.buildNonSequentialEditorialDecision(candidate, context, {
          estimatedRating,
          trendScore,
          contentScore,
          ratingPriority,
          trendingPriority,
          contentPriority,
        })
        return {
          candidate: this.decorateCandidate(candidate, {
            selectionMode: context.columnId ? 'rerun' : 'default',
            selectionNote: this.buildNonSequentialSelectionNote({
              ratingPriority,
              trendingPriority,
              candidate,
              estimatedRating,
              trendScore,
              columnId: context.columnId,
              editorialDecision,
            }),
            estimatedRating,
            editorialDecision,
          }),
          index,
          estimatedRating,
          trendScore,
          contentScore,
          score: context.gap && context.criteria
            ? this.scoreCandidate(candidate, context.gap, context.criteria)
            : this.scoreProgramSearch(candidate, context.keyword ?? ''),
        }
      })
      .sort((left, right) => {
        if (ratingPriority && left.estimatedRating !== right.estimatedRating) {
          return right.estimatedRating - left.estimatedRating
        }
        if (trendingPriority && left.trendScore !== right.trendScore) {
          return right.trendScore - left.trendScore
        }
        if (contentPriority && left.contentScore !== right.contentScore) {
          return right.contentScore - left.contentScore
        }
        if (left.score !== right.score) {
          return right.score - left.score
        }
        return left.index - right.index
      })
      .map((entry) => entry.candidate)
  }

  private buildContentMatchScore(candidate: ProgramCandidate, searchKeywords: string[]): number {
    if (searchKeywords.length === 0) return 0
    const haystack = normalizeCandidateKeyword(this.buildCandidateSearchText(candidate))
    const phraseScore = extractSoftSearchKeywords(searchKeywords).reduce((score, normalized) => {
      let count = 0
      let fromIndex = 0
      while (fromIndex < haystack.length) {
        const foundIndex = haystack.indexOf(normalized, fromIndex)
        if (foundIndex < 0) break
        count += 1
        fromIndex = foundIndex + normalized.length
      }
      return score + count
    }, 0)
    const functionalScore = extractFunctionalSearchKeywords(searchKeywords).reduce((score, keyword) => {
      return haystack.includes(keyword) ? score + 3 : score
    }, 0)
    return phraseScore + functionalScore
  }

  private buildNonSequentialSelectionNote(input: {
    ratingPriority: boolean
    trendingPriority: boolean
    candidate: ProgramCandidate
    estimatedRating: number
    trendScore: number
    columnId?: string
    editorialDecision?: EditorialSelectionDecision
  }): string {
    if (input.editorialDecision) {
      return input.editorialDecision.summary
    }
    if (input.ratingPriority) {
      return `轮播单收视率优先，当前候选预估收视 ${input.estimatedRating.toFixed(1)}。`
    }
    if (input.trendingPriority) {
      return `轮播单热播优先，当前候选${this.describeTrendingHeat(input.candidate, input.trendScore)}。`
    }
    if (input.columnId) {
      return '当前栏目不按顺播推进，先按时段匹配度筛选重播候选。'
    }
    return '已按节目名称、时长和当前条件筛选匹配候选。'
  }

  private buildNonSequentialEditorialDecision(
    candidate: ProgramCandidate,
    context: CandidateSortContext,
    input: {
      estimatedRating: number
      trendScore: number
      contentScore: number
      ratingPriority: boolean
      trendingPriority: boolean
      contentPriority: boolean
    },
  ): EditorialSelectionDecision {
    const strategy: DraftSelectionPriority | 'default' = input.ratingPriority
      ? 'rating'
      : input.trendingPriority
        ? 'trending'
        : input.contentPriority
          ? 'content_match'
          : 'default'
    const gapDuration = context.gap?.duration
    const durationScore = typeof gapDuration === 'number' && gapDuration > 0
      ? Math.max(0, Math.min(100, 100 - (Math.abs(candidate.duration - Math.min(candidate.duration, gapDuration)) / 60)))
      : 70
    const contentScore = Math.min(100, input.contentScore * 25)
    const ratingScore = Math.min(100, Math.max(0, input.estimatedRating * 10))
    const trendScore = input.trendScore
    const typeScore = context.criteria?.programTypePreference?.includes(candidate.programType) ? 100 : 55
    const dimensions = this.weightEditorialDimensions(strategy, [
      {
        key: 'content_match',
        score: contentScore,
        note: contentScore > 0 ? '节目标题/实例名命中本段关键词。' : '未命中明确内容关键词，主要依赖类型和时段兜底。',
      },
      {
        key: 'duration_fit',
        score: durationScore,
        note: candidate.duration <= (gapDuration ?? Number.POSITIVE_INFINITY)
          ? '时长可放入当前空窗。'
          : '时长超过当前空窗。',
      },
      {
        key: 'rating',
        score: ratingScore,
        note: `预估收视 ${input.estimatedRating.toFixed(1)}。`,
      },
      {
        key: 'trend',
        score: trendScore,
        note: this.describeTrendingHeat(candidate, trendScore),
      },
      {
        key: 'type_fit',
        score: typeScore,
        note: typeScore >= 100 ? '节目类型符合本段栏目要求。' : '节目类型不是本段首选类型。',
      },
      {
        key: 'schedule_context',
        score: 100,
        note: '候选已通过当前编排上下文和冲突过滤。',
      },
    ])

    const totalScore = this.calculateEditorialTotal(dimensions)
    const strengths = [
      ...(contentScore > 0 ? ['内容关键词命中'] : []),
      ...(typeScore >= 100 ? ['类型匹配'] : []),
      ...(ratingScore >= 75 && strategy === 'rating' ? ['收视率表现较好'] : []),
      ...(trendScore >= 75 && strategy === 'trending' ? ['热播话题表现较好'] : []),
      ...(durationScore >= 80 ? ['时长承接稳定'] : []),
    ]
    const concerns = [
      ...(contentScore === 0 && strategy === 'content_match' ? ['内容命中弱'] : []),
      ...(durationScore < 70 ? ['空窗利用率一般'] : []),
      ...(ratingScore < 60 && strategy === 'rating' ? ['收视率表现不是强项'] : []),
      ...(trendScore < 60 && strategy === 'trending' ? ['热播话题表现不是强项'] : []),
    ]

    return {
      strategy,
      totalScore,
      summary: this.buildEditorialSummary(strategy, totalScore, strengths, concerns, input.estimatedRating, {
        popularityScore: candidate.popularityScore,
        trendScore,
      }),
      strengths,
      concerns,
      dimensions,
    }
  }

  private buildSequentialEditorialDecision(
    candidate: ProgramCandidate,
    input: {
      sequenceNo: number | null
      nextExpected: number
      hasProgress: boolean
      hasRecognizedSequence: boolean
      isAhead: boolean
      distance: number
      fallbackScore: number
    },
  ): EditorialSelectionDecision {
    void candidate
    const sequenceScore = input.hasRecognizedSequence
      ? input.sequenceNo === input.nextExpected
        ? 100
        : input.isAhead
          ? Math.max(45, 90 - input.distance * 20)
          : Math.max(20, 70 - input.distance * 20)
      : 35
    const dimensions = this.weightEditorialDimensions('sequence', [
      {
        key: 'sequence',
        score: sequenceScore,
        note: input.sequenceNo === input.nextExpected
          ? `命中顺播期望第${input.nextExpected}集/期。`
          : input.hasRecognizedSequence
            ? `识别到第${input.sequenceNo}集/期，本段期望第${input.nextExpected}集/期。`
            : '暂未识别明确集/期号。',
      },
      {
        key: 'content_match',
        score: Math.min(100, Math.max(0, input.fallbackScore)),
        note: '同系列/栏目语义用于顺播候选兜底比较。',
      },
      {
        key: 'schedule_context',
        score: input.hasProgress ? 100 : 70,
        note: input.hasProgress ? '已读取历史或当前编排进度。' : '未找到明确历史进度，从可识别起点开始。',
      },
      {
        key: 'duration_fit',
        score: 85,
        note: '候选通过时长过滤，可承接当前空窗。',
      },
    ])
    const totalScore = this.calculateEditorialTotal(dimensions)
    const strengths = [
      ...(input.sequenceNo === input.nextExpected ? ['集数正好接续'] : []),
      ...(input.hasProgress ? ['已参考播出进度'] : []),
      ...(input.hasRecognizedSequence ? ['集数可识别'] : []),
    ]
    const concerns = [
      ...(!input.hasRecognizedSequence ? ['缺少明确集数'] : []),
      ...(input.hasRecognizedSequence && input.sequenceNo !== input.nextExpected ? ['不是本段期望集数'] : []),
    ]

    return {
      strategy: 'sequence',
      totalScore,
      summary: this.buildEditorialSummary('sequence', totalScore, strengths, concerns),
      strengths,
      concerns,
      dimensions,
    }
  }

  private weightEditorialDimensions(
    strategy: DraftSelectionPriority | 'default',
    dimensions: Array<Omit<EditorialSelectionDimension, 'weight'>>,
  ): EditorialSelectionDimension[] {
    const weightMap: Record<EditorialSelectionDimension['key'], number> =
      strategy === 'rating'
        ? {
            content_match: 0.25,
            duration_fit: 0.2,
            rating: 0.35,
            trend: 0.05,
            sequence: 0,
            type_fit: 0.1,
            schedule_context: 0.1,
          }
        : strategy === 'trending'
          ? {
              content_match: 0.25,
              duration_fit: 0.18,
              rating: 0.05,
              trend: 0.35,
              sequence: 0,
              type_fit: 0.07,
              schedule_context: 0.1,
            }
        : strategy === 'content_match'
          ? {
              content_match: 0.4,
              duration_fit: 0.2,
              rating: 0.15,
              trend: 0.05,
              sequence: 0,
              type_fit: 0.15,
              schedule_context: 0.1,
            }
          : strategy === 'sequence'
            ? {
                content_match: 0.15,
                duration_fit: 0.1,
                rating: 0,
                trend: 0,
                sequence: 0.55,
                type_fit: 0,
                schedule_context: 0.2,
              }
            : {
                content_match: 0.25,
                duration_fit: 0.25,
                rating: 0.15,
                trend: 0.05,
                sequence: 0,
                type_fit: 0.2,
                schedule_context: 0.15,
              }

    return dimensions.map((dimension) => ({
      ...dimension,
      weight: weightMap[dimension.key],
    }))
  }

  private calculateEditorialTotal(dimensions: EditorialSelectionDimension[]): number {
    const weightedTotal = dimensions.reduce((total, dimension) => total + dimension.score * dimension.weight, 0)
    const weightTotal = dimensions.reduce((total, dimension) => total + dimension.weight, 0)
    if (weightTotal <= 0) return 0
    return Math.round((weightedTotal / weightTotal) * 10) / 10
  }

  private buildEditorialSummary(
    strategy: DraftSelectionPriority | 'default',
    totalScore: number,
    strengths: string[],
    concerns: string[],
    estimatedRating?: number,
    audienceMetrics?: {
      popularityScore?: number
      trendScore?: number
    },
  ): string {
    const strategyLabel =
      strategy === 'sequence'
        ? '电视频道顺播'
        : strategy === 'rating'
          ? '轮播单收视率优先'
          : strategy === 'trending'
            ? '轮播单热播优先'
            : strategy === 'content_match'
              ? '轮播单内容匹配优先'
              : '综合匹配'
    const strengthText = strengths.length ? strengths.slice(0, 2).join('、') : '基础条件可用'
    const concernText = concerns.length ? `；需注意${concerns.slice(0, 2).join('、')}` : ''
    const ratingText = typeof estimatedRating === 'number' ? `，预估收视 ${estimatedRating.toFixed(1)}` : ''
    const popularityText = typeof audienceMetrics?.popularityScore === 'number' ? `，热度 ${audienceMetrics.popularityScore.toFixed(1)}` : ''
    const trendScoreText = typeof audienceMetrics?.trendScore === 'number' ? `，热播分 ${audienceMetrics.trendScore.toFixed(1)}` : ''
    return `${strategyLabel}专业判断：${strengthText}${ratingText}${popularityText}${trendScoreText}，综合分 ${totalScore.toFixed(1)}${concernText}。`
  }

  private decorateCandidate(
    candidate: ProgramCandidate,
    extras: Partial<CandidateWithStrategy>,
  ): ProgramCandidate {
    return {
      ...candidate,
      ...extras,
    } as CandidateWithStrategy
  }

  private buildSequentialSelectionNote(
    sequenceNo: number | null,
    nextExpected: number,
    hasProgress: boolean,
  ): string {
    if (typeof sequenceNo === 'number') {
      if (sequenceNo === nextExpected) {
        return '\u6309\u5f53\u524d\u5df2\u64ad\u8fdb\u5ea6\u987a\u64ad\u63a8\u8350\u3002'
      }
      if (sequenceNo > nextExpected) {
        return `\u5f53\u524d\u7f3a\u5c11\u7b2c${nextExpected}\u96c6/\u671f\uff0c\u5148\u987a\u5ef6\u5230\u7b2c${sequenceNo}\u96c6/\u671f\u3002`
      }
      return '\u8be5\u5019\u9009\u65e9\u4e8e\u5f53\u524d\u5df2\u6392\u8fdb\u5ea6\uff0c\u4f18\u5148\u7ea7\u4f1a\u540e\u7f6e\u3002'
    }

    return hasProgress
      ? '\u5f53\u524d\u680f\u76ee\u6309\u987a\u64ad\u63a8\u8fdb\uff0c\u4f46\u8fd9\u6761\u5019\u9009\u6682\u672a\u8bc6\u522b\u51fa\u660e\u786e\u96c6/\u671f\u53f7\u3002'
      : '\u5f53\u524d\u680f\u76ee\u6309\u987a\u64ad\u63a8\u8fdb\uff0c\u4f18\u5148\u4ece\u53ef\u8bc6\u522b\u7684\u8d77\u59cb\u96c6/\u671f\u5f00\u59cb\u3002'
  }

  private isSequentialColumn(columnId: string): boolean {
    return Boolean(getEffectiveColumnDefinition(columnId)?.isSequential)
  }

  private shouldUseSequentialColumnStrategy(criteria: CandidateQueryCriteria, columnId?: string): boolean {
    if (criteria.selectionPolicy?.primary) {
      return criteria.selectionPolicy.primary === 'sequence'
    }
    return Boolean(columnId && this.isSequentialColumn(columnId))
  }

  private toScheduledItemRecord(item: ScheduleItemSnapshot): ScheduledItemRecord {
    return item as ScheduledItemRecord
  }

  private resolveSequentialDiagnosticsState(criteria: CandidateQueryCriteria, gap?: GapInfo): ScheduledSequenceState | null {
    const columnId = criteria.columnId?.trim()
    if (!columnId || !criteria.historyReference) return null
    if (!this.shouldUseSequentialColumnStrategy(criteria, columnId)) return null
    const allowedProgramIds = new Set(
      getEffectiveProgramsByColumn(criteria.channelId, columnId).map((item) => item.programId),
    )
    return this.collectScheduledSequenceState(columnId, allowedProgramIds, gap?.startTime, criteria.historyReference)
  }

  private collectScheduledSequenceState(
    columnId: string,
    allowedProgramIds: Set<string>,
    gapStartTime?: string,
    historyReference?: CandidateQueryCriteria['historyReference'],
  ): ScheduledSequenceState {
    const maxSequenceBySeries = new Map<string, number>()
    const minFutureSequenceBySeries = new Map<string, number>()
    const seriesWithSchedule = new Set<string>()
    const currentScheduleSeries = new Set<string>()
    let currentScheduleOverridesHistory = false
    const gapStartMs = gapStartTime ? new Date(gapStartTime).getTime() : undefined

    this.atomicCapabilities.getAllItems().forEach((item) => {
      const matchedCandidate = this.resolveScheduledCandidate(this.toScheduledItemRecord(item), columnId, allowedProgramIds)
      if (!matchedCandidate) return

      const seriesKey = this.buildSeriesKey(matchedCandidate)
      if (!seriesKey) return

      const sequenceNo = this.extractSequenceNo(matchedCandidate)
      if (typeof sequenceNo !== 'number') return

      currentScheduleSeries.add(seriesKey)
      const itemStartMs = new Date(item.startTime).getTime()
      if (typeof gapStartMs === 'number' && Number.isFinite(itemStartMs) && itemStartMs >= gapStartMs) {
        const currentMin = minFutureSequenceBySeries.get(seriesKey) ?? Number.POSITIVE_INFINITY
        if (sequenceNo < currentMin) {
          minFutureSequenceBySeries.set(seriesKey, sequenceNo)
        }
        return
      }

      seriesWithSchedule.add(seriesKey)
      const currentMax = maxSequenceBySeries.get(seriesKey) ?? 0
      if (sequenceNo > currentMax) {
        maxSequenceBySeries.set(seriesKey, sequenceNo)
      }
    })

    historyReference?.schedules.forEach((schedule) => {
      schedule.items?.forEach((item) => {
        const matchedCandidate = this.resolveScheduledCandidate(this.toScheduledItemRecord(item), columnId, allowedProgramIds)
        if (!matchedCandidate) return

        const seriesKey = this.buildSeriesKey(matchedCandidate)
        if (!seriesKey) return
        if (currentScheduleSeries.has(seriesKey)) {
          currentScheduleOverridesHistory = true
          return
        }

        const sequenceNo = this.extractSequenceNo(matchedCandidate)
        if (typeof sequenceNo !== 'number') return

        seriesWithSchedule.add(seriesKey)
        const currentMax = maxSequenceBySeries.get(seriesKey) ?? 0
        if (sequenceNo > currentMax) {
          maxSequenceBySeries.set(seriesKey, sequenceNo)
        }
      })
    })

    return {
      maxSequenceBySeries,
      minFutureSequenceBySeries,
      seriesWithSchedule,
      currentScheduleOverridesHistory,
    }
  }

  private resolveScheduledCandidate(
    item: ScheduledItemRecord,
    _columnId: string,
    allowedProgramIds: Set<string>,
  ): ProgramCandidate | undefined {
    const directCode = typeof item.programCode === 'string'
      ? item.programCode
      : typeof item.code18 === 'string'
        ? item.code18
        : ''
    const directCandidate = directCode ? this.candidateByProgramCode.get(directCode) : undefined
    if (directCandidate && (allowedProgramIds.size === 0 || allowedProgramIds.has(directCandidate.programId))) {
      return directCandidate
    }

    const name = typeof item.programName === 'string'
      ? item.programName
      : typeof item.instanceName === 'string'
        ? item.instanceName
        : ''
    if (!name) return undefined

    const normalizedName = this.normalizeSeriesName(name)
    const matchedCandidate = this.candidates.find((candidate) => {
      if (allowedProgramIds.size > 0 && !allowedProgramIds.has(candidate.programId)) {
        return false
      }
      return this.normalizeSeriesName(candidate.programName) === normalizedName
    })
    if (!matchedCandidate) return undefined

    const sequenceNo = this.extractSequenceFromName(name)
    return {
      ...matchedCandidate,
      programCode: directCode || matchedCandidate.programCode,
      programName: name,
      instanceName: name,
      issueNo: typeof sequenceNo === 'number' ? String(sequenceNo).padStart(4, '0') : matchedCandidate.issueNo,
    }
  }

  private buildSeriesKey(candidate: ProgramCandidate): string {
    const normalizedName = this.normalizeSeriesName(candidate.programName)
    return normalizedName
      ? `name:${candidate.channelId}:${normalizedName}`
      : `program:${candidate.programId}`
  }

  private normalizeSeriesName(name: string): string {
    return name
      .replace(/^[^：:]+[：:]/u, '')
      .replace(/第\s*([0-9零〇一二两三四五六七八九十百]+)\s*[集期]/gu, '')
      .replace(/[上中下][集期]/gu, '')
      .replace(/^[^：:]+[：:]/, '')
      .replace(/第\s*\d+\s*[集期]/g, '')
      .replace(/[上中下](集|期)/g, '')
      .replace(/\s+/g, '')
      .trim()
      .toLowerCase()
  }

  private extractSequenceNo(candidate: Pick<ProgramCandidate, 'issueNo' | 'programCode' | 'programName' | 'instanceName'>): number | null {
    const issueNo = this.parsePositiveNumber(candidate.issueNo)
    if (issueNo !== null) {
      return issueNo
    }

    const programCodeSerial = this.extractProgramCodeSerial(candidate.programCode)
    if (programCodeSerial !== null) {
      return programCodeSerial
    }

    return this.extractSequenceFromName(candidate.programName || candidate.instanceName)
  }

  private parsePositiveNumber(value?: string): number | null {
    if (!value) return null
    const parsed = Number(value)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null
  }

  private extractProgramCodeSerial(programCode?: string): number | null {
    if (!programCode) return null
    const normalized = programCode.trim()
    const match = normalized.match(/(\d{1,4})$/)
    if (!match) return null
    const parsed = Number(match[1])
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null
  }

  private extractSequenceFromName(name?: string): number | null {
    if (!name) return null
    const episodeMatch = name.match(/\u7b2c\s*([0-9\u96f6\u3007\u4e00\u4e8c\u4e24\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341\u767e]+)\s*[\u96c6\u671f]/u)
    if (episodeMatch) {
      return this.parseChineseNumber(episodeMatch[1]!)
    }

    const upperName = name.toUpperCase()
    if (upperName.includes('\u4e0a\u96c6') || upperName.includes('\u4e0a\u671f')) return 1
    if (upperName.includes('\u4e2d\u96c6') || upperName.includes('\u4e2d\u671f')) return 2
    if (upperName.includes('\u4e0b\u96c6') || upperName.includes('\u4e0b\u671f')) return 3

    return null
  }

  private parseChineseNumber(value: string): number | null {
    const direct = Number(value)
    if (Number.isFinite(direct) && direct > 0) return direct

    const digits: Record<string, number> = {
      '\u96f6': 0,
      '\u3007': 0,
      '\u4e00': 1,
      '\u4e8c': 2,
      '\u4e24': 2,
      '\u4e09': 3,
      '\u56db': 4,
      '\u4e94': 5,
      '\u516d': 6,
      '\u4e03': 7,
      '\u516b': 8,
      '\u4e5d': 9,
    }

    if (value === '\u5341') return 10
    const tenIndex = value.indexOf('\u5341')
    if (tenIndex >= 0) {
      const high = tenIndex === 0 ? 1 : digits[value[tenIndex - 1]!] ?? 0
      const low = digits[value[tenIndex + 1]!] ?? 0
      return high * 10 + low
    }

    return value.split('').reduce((sum, char) => sum * 10 + (digits[char] ?? 0), 0) || null
  }

  private buildRerunScore(candidate: ProgramCandidate): number {
    const durationBias = candidate.duration <= 3600 ? 12 : 4
    const typeBias = ['news', 'current_affairs'].includes(candidate.programType) ? 6 : 0
    return durationBias + typeBias
  }

  private estimateCandidateRating(candidate: ProgramCandidate): number {
    if (typeof candidate.estimatedRating === 'number') {
      return candidate.estimatedRating
    }

    const typeBase: Record<string, number> = {
      news: 7.2,
      news_magazine: 7.8,
      drama: 8.1,
      entertainment: 7.5,
      health: 6.9,
      commentary: 6.7,
      kids: 6.4,
      documentary: 6.8,
    }
    const base = typeBase[candidate.programType] ?? 6.5
    const serial = this.extractProgramCodeSerial(candidate.programCode) ?? 1
    const stableNoise = ((serial * 37) % 17) / 10
    const durationBonus = candidate.duration >= 1800 && candidate.duration <= 3600 ? 0.4 : 0
    return Math.round((base + stableNoise + durationBonus) * 10) / 10
  }

  private scoreCandidateTrendingHeat(candidate: ProgramCandidate): number {
    if (typeof candidate.popularityScore === 'number') {
      return Math.max(0, Math.min(100, candidate.popularityScore))
    }

    const text = normalizeCandidateKeyword([
      candidate.programName,
      candidate.instanceName,
      candidate.columnName,
      ...(candidate.contentTags ?? []),
    ].filter(Boolean).join(' '))
    const topicalBoost = /(新闻|直播|现场|发布会|赛事|交通|天气|社区|民生|热点|热播|话题|上海|静安寺|外滩|陆家嘴)/u.test(text)
      ? 16
      : 0
    const typeBase: Record<string, number> = {
      news: 72,
      news_magazine: 68,
      drama: 64,
      entertainment: 66,
      documentary: 58,
      health: 55,
      kids: 52,
      commentary: 60,
    }
    return Math.max(0, Math.min(100, (typeBase[candidate.programType] ?? 56) + topicalBoost))
  }

  private describeTrendingHeat(candidate: ProgramCandidate, trendScore: number): string {
    const popularityText = typeof candidate.popularityScore === 'number'
      ? `热度 ${candidate.popularityScore.toFixed(1)}`
      : `热播分 ${trendScore.toFixed(1)}`
    const tags = candidate.contentTags?.slice(0, 3).join('、')
    return tags ? `${popularityText}，话题标签 ${tags}` : popularityText
  }

  private buildScheduleSignature(): string {
    return this.atomicCapabilities
      .getAllItems()
      .map((item) => {
        const record = this.toScheduledItemRecord(item)
        const programKey = record.programCode ?? record.code18 ?? ''
        const itemKey = record.id ?? ''
        const titleKey = record.programName ?? record.instanceName ?? ''
        return [
          record.startTime ?? '',
          record.endTime ?? '',
          programKey,
          itemKey,
          titleKey,
        ].join('@')
      })
      .filter((entry) => entry.replace(/@/g, '').length > 0)
      .sort()
      .join('|')
  }

  private isScheduledProgramCode(programCode?: string): boolean {
    if (!programCode) return false
    return this.atomicCapabilities
      .getAllItems()
      .some((item) => {
        const record = this.toScheduledItemRecord(item)
        return record.programCode === programCode || record.code18 === programCode
      })
  }

  private isHistoryProgramCode(programCode?: string, historyReference?: CandidateQueryCriteria['historyReference']): boolean {
    if (!programCode || !historyReference) return false
    return historyReference.schedules.some((schedule) =>
      schedule.items?.some((item) => item.programCode === programCode),
    )
  }

  private shouldExcludeHistoryPrograms(criteria: CandidateQueryCriteria): boolean {
    if (!criteria.excludeUsed || !criteria.historyReference) return false
    const policy = criteria.selectionPolicy
    return policy?.primary === 'sequence' || Boolean(policy?.requiresPreviousSchedule)
  }

  private matchesDuration(candidate: ProgramCandidate, criteria: CandidateQueryCriteria, gap?: GapInfo): boolean {
    if (criteria.columnId) {
      return candidate.duration <= criteria.expectedDuration.max
    }

    return (
      candidate.duration >= criteria.expectedDuration.min
      && candidate.duration <= criteria.expectedDuration.max
    )
  }

  private matchesProgramType(candidate: ProgramCandidate, preferredTypes?: string[]): boolean {
    if (!preferredTypes?.length) return true

    const normalizedCandidateType = candidate.programType.trim().toLowerCase()
    const normalizedPreferredTypes = preferredTypes.map((item) => item.trim().toLowerCase())
    if (normalizedPreferredTypes.includes(normalizedCandidateType)) {
      return true
    }

    const compatibleTypes: Record<string, string[]> = {
      news_magazine: ['news', 'current_affairs'],
      current_affairs: ['news', 'news_magazine'],
      news: ['news_magazine', 'current_affairs'],
      health: ['lifestyle'],
      lifestyle: ['health'],
    }

    return normalizedPreferredTypes.some((type) => compatibleTypes[normalizedCandidateType]?.includes(type))
  }

  private matchesUsageState(candidate: ProgramCandidate, excludeUsed: boolean): boolean {
    if (!excludeUsed) return true

    return !this.isScheduledProgramCode(candidate.programCode)
  }
}

let globalCandidateService: CandidateService | null = null

export function getCandidateService(config?: Partial<CandidateServiceConfig>): CandidateService {
  if (!globalCandidateService) {
    globalCandidateService = new CandidateService(config)
  }
  return globalCandidateService
}

export function resetCandidateService(): void {
  globalCandidateService = null
}
