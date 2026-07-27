import type { CandidateQueryCriteria, GapInfo, ProgramCandidate } from '@/types/orchestration'
import type { AgentIntentInterpretation, AgentProgramCandidate, AgentSubmitInput, SchedulingContext } from './types'

/**
 * 单轮检索尝试记录（保留 source 字段以兼容现有 trace，新增 strategyLabel 用于阶段 2/3 扩展）。
 *
 * 设计约束（AGENTS.md LLM-first / 本地只保护）：
 * - source 字段保留 'primary' | 'llm_alternative'，兼容现有 nlMatrix/candidateDecision 等测试断言
 * - strategyLabel 字段为阶段 2/3 扩展预留，本阶段（阶段 1）默认为 'primary' | 'llm_alternative'，
 *   阶段 3 接入 executeRetryLoop 后会使用 original/typo_fix/decompose/paraphrase/column_demote/broaden 等标签
 */
export interface CandidateSearchAttempt {
  /** 本轮使用的关键词 */
  keyword: string
  /** 兼容字段：候选来源（保留以兼容现有 trace 与测试断言） */
  source: 'primary' | 'llm_alternative'
  /** 本轮命中候选数 */
  candidateCount: number
  /** 本轮命中候选 ID（最多记 8 个，避免膨胀） */
  candidateIds: string[]
  /**
   * 本轮策略标签（阶段 2/3 扩展字段，本阶段可选）
   *
   * - primary：首轮原词检索（与 source='primary' 等价）
   * - original / typo_fix / decompose / paraphrase / column_demote / broaden：LLM 一次性生成的策略标签
   * - secondary_reflection_*：escape hatch 二次反思生成的策略标签
   */
  strategyLabel?:
  | 'primary'
  | 'original'
  | 'typo_fix'
  | 'decompose'
  | 'paraphrase'
  | 'column_demote'
  | 'broaden'
  | 'secondary_reflection_typo_fix'
  | 'secondary_reflection_decompose'
  | 'secondary_reflection_paraphrase'
  | 'secondary_reflection_column_demote'
  | 'secondary_reflection_broaden'
  /** 本轮 LLM 给出的策略理由（来自意图解析阶段 LLM 输出的 reason 字段） */
  strategyReason?: string
  /** 本轮轮次（0=首轮原词，1=第一次策略轮询） */
  round?: number
}

/**
 * 候选池解析结果（沿用 atomicCommandCapability 原结构，纯重构）
 *
 * searchRetryPlan 字段（阶段 4 引入）：当 resolveCandidatePool 走 executeRetryLoop 路径时，
 * 携带完整的重试计划（含 keywordStrategies / searchAttempts / terminationReason / nextAction），
 * 供 0 候选失败路径直接透传到 program_not_found issue.detail，无需再调 buildCandidateSearchRetryPlan。
 */
export interface CandidatePoolResolution {
  candidates: AgentProgramCandidate[]
  attempts: CandidateSearchAttempt[]
  matchedBy: 'primary' | 'llm_alternatives' | 'none'
  /** 阶段 4 引入：executeRetryLoop 返回的完整重试计划（走纯函数回退路径时为 undefined） */
  searchRetryPlan?: CandidateSearchRetryPlan
}

/**
 * LLM 一次性生成的关键词策略组合（阶段 2 引入，阶段 1 仅声明类型）
 */
export interface CandidateKeywordStrategy {
  /** 策略标签 */
  strategy: 'original' | 'typo_fix' | 'decompose' | 'paraphrase' | 'column_demote' | 'broaden'
  /** 该策略下的关键词组合 */
  keywords: string[]
  /** LLM 给出的理由 */
  reason: string
}

/**
 * 终止原因（阶段 3 executeRetryLoop 使用）
 */
export type CandidateSearchRetryTerminationReason =
  | 'satisfied'
  | 'max_round'
  | 'all_strategies_exhausted'
  | 'llm_invalid'
  | 'user_cancel'
  | 'secondary_reflection_no_more'
  | 'secondary_reflection_invalid'

/**
 * 下一动作建议
 */
export type CandidateSearchRetryNextAction =
  | 'rewrite_keywords_and_retry'
  | 'proceed_to_selection'
  | 'needs_clarification'

/**
 * 重试计划（多轮记录，透传到 trace 和 searchRetryPlan）
 *
 * 阶段 1：仅使用 searchedKeyword / searchedFacets / candidateSourceStatus / candidateRecordCount /
 * searchAttempts / suggestedKeywords / nextAction 字段（与原 buildCandidateSearchRetryPlan 输出一致）。
 * 阶段 3：扩展 keywordStrategies / triggeredSecondaryReflection / terminationReason 字段。
 */
export interface CandidateSearchRetryPlan {
  /** 原始关键词 */
  searchedKeyword: string
  /** 原始关键词拆解 facets */
  searchedFacets: string[]
  /** 候选源状态 */
  candidateSourceStatus: string
  /** 候选源记录数 */
  candidateRecordCount: number
  /** LLM 一次性生成的关键词策略组合（阶段 3 扩展，用于 trace 与失败暴露） */
  keywordStrategies?: Array<{
    strategy: string
    keywords: string[]
    reason: string
  }>
  /** 每轮尝试记录 */
  searchAttempts: CandidateSearchAttempt[]
  /** 合并去重后的建议关键词（用于失败时给用户参考） */
  suggestedKeywords: string[]
  /** 是否触发了 escape hatch 二次反思 */
  triggeredSecondaryReflection?: boolean
  /** 终止原因 */
  terminationReason?: CandidateSearchRetryTerminationReason
  /** 下一动作建议（失败时为 needs_clarification） */
  nextAction: CandidateSearchRetryNextAction
}

/**
 * 重试配置（阶段 3 使用）
 */
export interface CandidateSearchRetryConfig {
  /** 是否启用重试（默认 true） */
  enabled: boolean
  /** 最大重试次数（默认 3，硬上限 5） */
  maxRound: number
  /** 最小候选阈值，低于此值触发重试（默认 1） */
  minCandidateThreshold: number
  /** 播单类型，影响 LLM 策略偏好 */
  playlistType: 'tv' | 'rotation'
  /** 是否启用 SSE 进度上报（默认 true） */
  enableProgressReporting: boolean
  /** 是否启用 escape hatch 二次反思（默认 false） */
  enableSecondaryReflection: boolean
  /** 二次反思最大触发次数（默认 1，硬上限 1） */
  maxReflections: number
}

/** 默认配置（电视播单） */
export const DEFAULT_TV_RETRY_CONFIG: CandidateSearchRetryConfig = {
  enabled: true,
  maxRound: 3,
  minCandidateThreshold: 1,
  playlistType: 'tv',
  enableProgressReporting: true,
  enableSecondaryReflection: false,
  maxReflections: 1,
}

/** 默认配置（轮播单，阈值可适当调高扩大选择面） */
export const DEFAULT_ROTATION_RETRY_CONFIG: CandidateSearchRetryConfig = {
  enabled: true,
  maxRound: 3,
  minCandidateThreshold: 2,
  playlistType: 'rotation',
  enableProgressReporting: true,
  enableSecondaryReflection: false,
  maxReflections: 1,
}

/**
 * 候选关键词归一化函数类型（依赖注入）
 *
 * 抽取为类型是为了让 candidateSearchRetryService 不直接依赖 AtomicCommandCapability 实例，
 * 由调用方把 AtomicCommandCapability.normalizeSearchText 注入进来。
 */
export type NormalizeSearchTextFn = (value: string) => string

/**
 * 检索 facets 构造函数类型（依赖注入）
 *
 * 调用方把 AtomicCommandCapability.buildInsertSearchFacets 注入进来。
 */
export type BuildInsertSearchFacetsFn = (programHint: string) => string[]

/**
 * 底层检索函数类型（依赖注入）。
 *
 * 由 candidateService.queryCandidates / searchPrograms 注入，避免 candidateSearchRetryService
 * 直接依赖 candidateService（防止循环依赖）。
 *
 * @param gap 时段信息
 * @param criteria 查询条件（重试阶段会替换 searchKeywords）
 * @returns 命中的候选列表
 */
export type CandidateQueryFn = (
  gap: GapInfo,
  criteria: CandidateQueryCriteria,
) => Promise<ProgramCandidate[]>

/**
 * 节目名检索函数类型（依赖注入，用于 UI 直查路径）。
 *
 * @param keyword 节目名关键词
 * @returns 命中的候选列表
 */
export type ProgramSearchFn = (keyword: string) => Promise<ProgramCandidate[]>

/**
 * 策略标签优先级顺序（按方案 4.4.1）。
 *
 * original → typo_fix → decompose → paraphrase → column_demote → broaden
 */
const STRATEGY_PRIORITY: Record<CandidateKeywordStrategy['strategy'], number> = {
  original: 0,
  typo_fix: 1,
  decompose: 2,
  paraphrase: 3,
  column_demote: 4,
  broaden: 5,
}

/**
 * 在内存候选池中按关键词过滤候选（纯函数版本，从 AtomicCommandCapability.resolveInsertCandidates 抽取）。
 *
 * 设计约束（AGENTS.md 本地只保护）：
 * - 只做检索结果保护性过滤，不改写用户意图
 * - 与原 AtomicCommandCapability.resolveInsertCandidates 行为完全一致（纯重构）
 *
 * @param candidates 内存候选池
 * @param programHint 节目线索（用户原词或 LLM 重试关键词）
 * @param normalizeFn 关键词归一化函数（由调用方注入）
 * @param facetsFn facets 构造函数（由调用方注入）
 * @returns 过滤后的候选列表（标题匹配优先，无标题匹配时回退到全字段匹配）
 */
export function resolveInsertCandidatesPure(
  candidates: AgentProgramCandidate[],
  programHint: string,
  normalizeFn: NormalizeSearchTextFn,
  facetsFn: BuildInsertSearchFacetsFn,
): AgentProgramCandidate[] {
  const normalizedHint = normalizeFn(programHint)
  const facets = facetsFn(programHint)
  const matched = candidates.filter((candidate) => {
    const haystack = normalizeFn([
      candidate.programName,
      candidate.instanceName,
      candidate.programCode,
      candidate.columnName,
      candidate.columnId,
      ...(candidate.contentTags ?? []),
    ].filter(Boolean).join(' '))
    return haystack.includes(normalizedHint)
      || normalizedHint.includes(normalizeFn(candidate.programName))
      || (facets.length > 0 && facets.every((facet) => haystack.includes(facet)))
  })
  const titleMatches = matched.filter((candidate) => {
    const titleHaystack = normalizeFn([
      candidate.programName,
      candidate.instanceName,
    ].filter(Boolean).join(' '))
    return titleHaystack.includes(normalizedHint)
      || normalizedHint.includes(normalizeFn(candidate.programName))
      || (facets.length > 0 && facets.every((facet) => titleHaystack.includes(facet)))
  })
  return titleMatches.length > 0 ? titleMatches : matched
}

/**
 * 构造单轮检索尝试记录（纯函数版本，从 AtomicCommandCapability.buildCandidateSearchAttempt 抽取）。
 *
 * @param keyword 本轮使用的关键词
 * @param source 候选来源（兼容字段，保留 'primary' | 'llm_alternative'）
 * @param candidates 本轮命中的候选列表
 * @returns 单轮检索尝试记录
 */
export function buildCandidateSearchAttemptPure(
  keyword: string,
  source: CandidateSearchAttempt['source'],
  candidates: AgentProgramCandidate[],
): CandidateSearchAttempt {
  return {
    keyword,
    source,
    candidateCount: candidates.length,
    candidateIds: candidates.slice(0, 8).map((candidate) => candidate.id),
  }
}

/**
 * 构造 LLM 重试关键词列表（纯函数版本，从 AtomicCommandCapability.buildCandidateRetryKeywords 抽取）。
 *
 * 设计约束（AGENTS-md LLM-first / 本地只保护）：
 * - 关键词全部来自 LLM 在意图解析阶段生成的 searchAlternatives（本地不补充、不扩展）
 * - 本地只做归一化去重、长度校验、上限截断
 * - 与原 AtomicCommandCapability.buildCandidateRetryKeywords 行为完全一致（纯重构）
 *
 * @param primaryHint 首轮原词
 * @param interpretation 意图解析结果（含 searchAlternatives）
 * @param normalizeFn 关键词归一化函数（由调用方注入）
 * @returns 重试关键词列表（最多 8 个，每个含 keyword 与 source='llm_alternative'）
 */
export function buildCandidateRetryKeywordsPure(
  primaryHint: string,
  interpretation: AgentIntentInterpretation | undefined,
  normalizeFn: NormalizeSearchTextFn,
): Array<{ keyword: string; source: 'llm_alternative' }> {
  const normalizedPrimary = normalizeFn(primaryHint)
  const keywords = (interpretation?.searchAlternatives ?? []).map((keyword) => ({ keyword, source: 'llm_alternative' as const }))
  const seen = new Set<string>([normalizedPrimary])
  const result: Array<{ keyword: string; source: 'llm_alternative' }> = []
  keywords.forEach((item) => {
    const keyword = item.keyword.trim()
    const normalized = normalizeFn(keyword)
    if (!keyword || normalized.length < 2 || seen.has(normalized)) return
    seen.add(normalized)
    result.push({ keyword, source: item.source })
  })
  return result.slice(0, 8)
}

/**
 * 解析候选池：首轮原词匹配 → 0 命中时按 LLM 重试关键词本地过滤（纯函数版本，从 AtomicCommandCapability.resolveCandidatePool 抽取）。
 *
 * 设计约束（AGENTS.md 本地只保护）：
 * - 重试阶段不再调 LLM，只对内存候选池做本地过滤
 * - 与原 AtomicCommandCapability.resolveCandidatePool 行为完全一致（纯重构）
 *
 * @param candidates 内存候选池
 * @param primaryHint 首轮原词
 * @param input Agent 提交输入（含意图解析结果）
 * @param normalizeFn 关键词归一化函数（由调用方注入）
 * @param facetsFn facets 构造函数（由调用方注入）
 * @returns 候选池解析结果（含 attempts 与 matchedBy）
 */
export function resolveCandidatePoolPure(
  candidates: AgentProgramCandidate[],
  primaryHint: string,
  input: AgentSubmitInput,
  normalizeFn: NormalizeSearchTextFn,
  facetsFn: BuildInsertSearchFacetsFn,
): CandidatePoolResolution {
  const primaryCandidates = resolveInsertCandidatesPure(candidates, primaryHint, normalizeFn, facetsFn)
  const attempts: CandidateSearchAttempt[] = [
    buildCandidateSearchAttemptPure(primaryHint, 'primary', primaryCandidates),
  ]
  if (primaryCandidates.length > 0) {
    return {
      candidates: primaryCandidates,
      attempts,
      matchedBy: 'primary',
    }
  }

  const retryKeywords = buildCandidateRetryKeywordsPure(primaryHint, input.interpretation ?? undefined, normalizeFn)
  const merged = new Map<string, AgentProgramCandidate>()
  retryKeywords.forEach(({ keyword, source }) => {
    const retryCandidates = resolveInsertCandidatesPure(candidates, keyword, normalizeFn, facetsFn)
    attempts.push(buildCandidateSearchAttemptPure(keyword, source, retryCandidates))
    retryCandidates.forEach((candidate) => {
      const key = candidate.id || candidate.programCode || candidate.programId || candidate.programName
      if (!merged.has(key)) merged.set(key, candidate)
    })
  })

  const resolved = Array.from(merged.values())

  return {
    candidates: resolved,
    attempts,
    matchedBy: resolved.length > 0 ? 'llm_alternatives' : 'none',
  }
}

/**
 * 构造候选检索重试计划记录（纯函数版本，从 AtomicCommandCapability.buildCandidateSearchRetryPlan 抽取）。
 *
 * 设计约束（AGENTS.md 本地只保护）：
 * - 只做结构化记录，不改写用户意图
 * - 与原 AtomicCommandCapability.buildCandidateSearchRetryPlan 行为完全一致（纯重构）
 *
 * @param input Agent 提交输入（含意图解析结果，用于取 searchAlternatives）
 * @param context 调度上下文（用于取候选源状态、记录数）
 * @param keyword 首轮原词
 * @param attempts 各轮检索尝试记录
 * @param normalizeFn 关键词归一化函数（保留参数以保持纯函数签名，当前实现未直接使用）
 * @param facetsFn facets 构造函数（由调用方注入，用于回退构造 searchedFacets）
 * @returns 重试计划记录（透传到 trace 和 searchRetryPlan）
 */
export function buildCandidateSearchRetryPlanPure(
  input: AgentSubmitInput,
  context: SchedulingContext,
  keyword: string,
  attempts: CandidateSearchAttempt[] = [],
  _normalizeFn: NormalizeSearchTextFn,
  facetsFn: BuildInsertSearchFacetsFn,
): CandidateSearchRetryPlan {
  const query = context.bundle.sources.candidates.query
  const searchedFacets = query?.facets?.length
    ? query.facets
    : facetsFn(keyword)
  const llmAlternatives = input.interpretation?.searchAlternatives ?? []
  const suggestedKeywords = Array.from(new Set([
    ...llmAlternatives,
    ...searchedFacets,
  ].map((item) => item.trim()).filter((item) => item.length >= 2))).slice(0, 5)

  return {
    searchedKeyword: query?.keyword ?? keyword,
    searchedFacets,
    candidateSourceStatus: context.bundle.sources.candidates.status ?? '',
    candidateRecordCount: context.bundle.sources.candidates.recordCount,
    searchAttempts: attempts,
    suggestedKeywords,
    nextAction: 'rewrite_keywords_and_retry',
  }
}

/**
 * 节目检索重试编排服务（阶段 1：仅提供 generateKeywordStrategies / sanitizeKeywordStrategies /
 * shouldContinueRetry / buildSearchRetryPlan；阶段 3 实现 executeRetryLoop；阶段 8 实现 runSecondaryReflection）。
 *
 * 设计约束（AGENTS.md）：
 * - 本地只做去重、长度校验、轮次上限、结构校验、失败暴露
 * - 错别字修复、拆字、二次理解全部由 LLM 在意图解析阶段一次性完成
 * - 重试阶段不调 LLM（escape hatch 二次反思除外）
 */
export class CandidateSearchRetryService {
  /**
   * 从意图解析结果中提取并校验 keywordStrategies（阶段 2 接入后使用）。
   *
   * 本地保护性校验：
   * - 必须含 original + 至少 1 个其它策略，关键词去重、长度≥2
   * - 校验失败时返回仅含 original 的退化结构（首轮仍可正常检索，不进入重试循环）
   *
   * @param intentResult 意图解析结果
   * @param fallbackOriginal 校验失败时退化使用的 original 关键词
   * @returns 校验后的 keywordStrategies（至少含 original）
   */
  generateKeywordStrategies(
    intentResult: AgentIntentInterpretation | undefined,
    fallbackOriginal: string,
  ): CandidateKeywordStrategy[] {
    const strategies = intentResult?.keywordStrategies
    if (!Array.isArray(strategies) || strategies.length === 0) {
      return this.buildDegenerateStrategies(fallbackOriginal)
    }

    const sanitized = this.sanitizeKeywordStrategies(strategies, [])
    const hasOriginal = sanitized.some((item) => item.strategy === 'original')
    const hasOther = sanitized.some((item) => item.strategy !== 'original')
    if (!hasOriginal || !hasOther) {
      return this.buildDegenerateStrategies(fallbackOriginal)
    }
    return sanitized
  }

  /**
   * 本地校验并去重 keywordStrategies（保护性校验，不改写关键词本身）。
   *
   * 校验规则：
   * - 去除空串、长度 < 2 的关键词
   * - 与 triedKeywords 归一化去重（跨策略）
   * - 同一策略标签内关键词去重
   * - 过滤后关键词为空的策略整组丢弃
   *
   * @param keywordStrategies LLM 返回的关键词策略组合
   * @param triedKeywords 已尝试关键词
   * @returns 校验后可用的关键词策略组合（可能为空，空则触发终止）
   */
  sanitizeKeywordStrategies(
    keywordStrategies: CandidateKeywordStrategy[],
    triedKeywords: string[],
  ): CandidateKeywordStrategy[] {
    const triedNormalized = new Set(triedKeywords.map((item) => this.normalizeKeyword(item)))
    const result: CandidateKeywordStrategy[] = []
    const seenKeywords = new Set<string>()

    for (const strategy of keywordStrategies) {
      if (!strategy || typeof strategy !== 'object') continue
      const validStrategy = this.normalizeStrategyTag(strategy.strategy)
      if (!validStrategy) continue
      const reason = typeof strategy.reason === 'string' ? strategy.reason.slice(0, 120) : ''
      const uniqueKeywords: string[] = []
      for (const keyword of Array.isArray(strategy.keywords) ? strategy.keywords : []) {
        if (typeof keyword !== 'string') continue
        const trimmed = keyword.trim()
        if (trimmed.length < 2 || trimmed.length > 40) continue
        const normalized = this.normalizeKeyword(trimmed)
        if (!normalized || seenKeywords.has(normalized) || triedNormalized.has(normalized)) continue
        seenKeywords.add(normalized)
        uniqueKeywords.push(trimmed)
      }
      if (uniqueKeywords.length === 0) continue
      result.push({ strategy: validStrategy, keywords: uniqueKeywords, reason })
    }

    return result
  }

  /**
   * 判断是否应继续重试（本地保护性判断，不改写 LLM 决策）。
   *
   * 终止条件（任一满足即停止）：
   * - 已达 maxRound → false
   * - 剩余策略为空 → false
   * - 候选已足够（命中数 ≥ minCandidateThreshold）→ false
   *
   * @param currentRound 当前轮次（0=首轮）
   * @param maxRound 最大重试次数
   * @param remainingStrategies 剩余未尝试的策略组合
   * @param currentCandidateCount 当前候选池总数
   * @param minCandidateThreshold 最小候选阈值
   * @returns 是否应继续重试
   */
  shouldContinueRetry(
    currentRound: number,
    maxRound: number,
    remainingStrategies: CandidateKeywordStrategy[],
    currentCandidateCount: number,
    minCandidateThreshold: number,
  ): boolean {
    if (currentRound >= maxRound) return false
    if (remainingStrategies.length === 0) return false
    if (currentCandidateCount >= minCandidateThreshold) return false
    return true
  }

  /**
   * 构造重试计划记录（透传到 trace 和 searchRetryPlan）。
   *
   * @param originalKeyword 原始关键词
   * @param searchedFacets 原始关键词拆解 facets
   * @param keywordStrategies LLM 一次性生成的关键词策略组合
   * @param attempts 各轮尝试记录
   * @param candidateSourceStatus 候选源状态
   * @param candidateRecordCount 候选源记录数
   * @param triggeredSecondaryReflection 是否触发了 escape hatch 二次反思
   * @param terminationReason 终止原因
   * @param nextAction 下一动作建议
   * @returns 重试计划记录
   */
  buildSearchRetryPlan(
    originalKeyword: string,
    searchedFacets: string[],
    keywordStrategies: CandidateKeywordStrategy[],
    attempts: CandidateSearchAttempt[],
    candidateSourceStatus: string,
    candidateRecordCount: number,
    triggeredSecondaryReflection: boolean,
    terminationReason: CandidateSearchRetryTerminationReason,
    nextAction: CandidateSearchRetryNextAction,
  ): CandidateSearchRetryPlan {
    const suggestedKeywords = Array.from(new Set([
      originalKeyword,
      ...searchedFacets,
      ...keywordStrategies.flatMap((item) => item.keywords),
    ].map((item) => item.trim()).filter((item) => item.length >= 2))).slice(0, 5)

    return {
      searchedKeyword: originalKeyword,
      searchedFacets,
      candidateSourceStatus,
      candidateRecordCount,
      keywordStrategies: keywordStrategies.map((item) => ({
        strategy: item.strategy,
        keywords: item.keywords,
        reason: item.reason,
      })),
      searchAttempts: attempts,
      suggestedKeywords,
      triggeredSecondaryReflection,
      terminationReason,
      nextAction,
    }
  }

  /**
   * 本地检索循环（按策略优先级轮询，不再调 LLM）。
   *
   * 流程（按方案 6.2）：
   * - 按 original → typo_fix → decompose → paraphrase → column_demote → broaden 优先级依次检索
   * - 每轮检索结果累积到候选池，按 programCode/id 去重
   * - 命中足够（≥ minCandidateThreshold）或所有策略用完或达 maxRound 时停止
   * - 记录每轮 attempt（含 strategyLabel、strategyReason）
   *
   * 设计约束（AGENTS.md）：
   * - 重试阶段不再调 LLM（escape hatch 二次反思除外，本阶段不接入）
   * - 本地只做去重、轮次上限、终止判断、失败暴露
   * - 不改写 LLM 生成的关键词
   *
   * SSE 一条条信息流式展示硬约束（方案 6.3.1）：
   * - onAttemptStart 在每轮检索"开始前"触发，用于推送"查节目库-重试N（策略标签）"开始气泡
   * - onAttempt 在每轮检索"完成后"触发，用于推送"候选查询完成"完成气泡（0 候选不推）
   * - 开始气泡与完成气泡之间有真实检索等待时间（await queryFn）
   *
   * @param gap 时段信息
   * @param criteria 查询条件（重试阶段会替换 searchKeywords）
   * @param keywordStrategies LLM 一次性生成的关键词策略组合
   * @param retryConfig 重试配置
   * @param queryFn 底层检索函数（由 candidateService 注入，避免循环依赖）
   * @param onAttempt 每轮检索完成回调（用于 SSE 完成气泡上报）
   * @param onAttemptStart 每轮检索开始回调（用于 SSE 开始气泡上报，阶段 7 引入）
   * @returns 重试结果（候选池 + searchRetryPlan）
   */
  async executeRetryLoop(
    gap: GapInfo,
    criteria: CandidateQueryCriteria,
    keywordStrategies: CandidateKeywordStrategy[],
    retryConfig: CandidateSearchRetryConfig,
    queryFn: CandidateQueryFn,
    onAttempt?: (attempt: CandidateSearchAttempt) => void,
    onAttemptStart?: (attempt: CandidateSearchAttempt) => void,
  ): Promise<{ candidates: AgentProgramCandidate[]; searchRetryPlan: CandidateSearchRetryPlan }> {
    // 按策略优先级排序（original → typo_fix → decompose → paraphrase → column_demote → broaden）
    const sortedStrategies = [...keywordStrategies].sort((left, right) =>
      (STRATEGY_PRIORITY[left.strategy] ?? 99) - (STRATEGY_PRIORITY[right.strategy] ?? 99),
    )

    const attempts: CandidateSearchAttempt[] = []
    const mergedPool = new Map<string, AgentProgramCandidate>()
    const triedKeywords: string[] = []
    let round = 0
    let terminationReason: CandidateSearchRetryTerminationReason = 'all_strategies_exhausted'
    let triggeredSecondaryReflection = false

    for (const strategy of sortedStrategies) {
      // 终止条件：已达 maxRound
      if (round >= retryConfig.maxRound) {
        terminationReason = 'max_round'
        break
      }

      // 终止条件：候选已足够
      if (mergedPool.size >= retryConfig.minCandidateThreshold) {
        terminationReason = 'satisfied'
        break
      }

      // 对该策略下的每个关键词发起检索（关键词组合视为一轮）
      const keywordsForRound = strategy.keywords
      const roundHitCandidates: AgentProgramCandidate[] = []

      // SSE 一条条信息流式展示硬约束（方案 6.3.1）：
      // 在查询开始前触发 onAttemptStart，推送"查节目库-重试N（策略标签）"开始气泡。
      // 开始气泡与完成气泡之间有真实检索等待时间（下方 await queryFn）。
      const startAttempt: CandidateSearchAttempt = {
        keyword: keywordsForRound.join(' / '),
        source: strategy.strategy === 'original' ? 'primary' : 'llm_alternative',
        candidateCount: 0,
        candidateIds: [],
        strategyLabel: strategy.strategy,
        strategyReason: strategy.reason,
        round,
      }
      if (onAttemptStart) onAttemptStart(startAttempt)

      for (const keyword of keywordsForRound) {
        if (triedKeywords.includes(keyword)) continue
        triedKeywords.push(keyword)

        const roundCriteria: CandidateQueryCriteria = {
          ...criteria,
          searchKeywords: [keyword],
        }
        const hitCandidates = await queryFn(gap, roundCriteria)
        hitCandidates.forEach((candidate) => {
          const key = candidate.id || candidate.programCode || candidate.programId || candidate.programName
          if (!mergedPool.has(key)) {
            mergedPool.set(key, candidate as AgentProgramCandidate)
          }
          if (!roundHitCandidates.some((existing) => existing.id === candidate.id)) {
            roundHitCandidates.push(candidate as AgentProgramCandidate)
          }
        })
      }

      // 记录本轮 attempt（含 strategyLabel、strategyReason、round）
      // 查询完成后触发 onAttempt，推送"候选查询完成"完成气泡（0 候选不推由调用方判断）
      const attempt: CandidateSearchAttempt = {
        keyword: keywordsForRound.join(' / '),
        source: strategy.strategy === 'original' ? 'primary' : 'llm_alternative',
        candidateCount: roundHitCandidates.length,
        candidateIds: roundHitCandidates.slice(0, 8).map((candidate) => candidate.id),
        strategyLabel: strategy.strategy,
        strategyReason: strategy.reason,
        round,
      }
      attempts.push(attempt)
      if (onAttempt) onAttempt(attempt)

      round += 1
    }

    // 循环结束后的终止原因判断
    if (terminationReason !== 'max_round' && terminationReason !== 'satisfied') {
      if (mergedPool.size >= retryConfig.minCandidateThreshold) {
        terminationReason = 'satisfied'
      } else {
        terminationReason = 'all_strategies_exhausted'
      }
    }

    const candidates = Array.from(mergedPool.values())
    const nextAction: CandidateSearchRetryNextAction = terminationReason === 'satisfied'
      ? 'proceed_to_selection'
      : 'needs_clarification'

    const searchRetryPlan = this.buildSearchRetryPlan(
      criteria.searchKeywords?.[0] ?? '',
      [], // searchedFacets 由调用方填充（candidateService 持有 facets 构造能力）
      keywordStrategies,
      attempts,
      '', // candidateSourceStatus 由调用方填充
      0, // candidateRecordCount 由调用方填充
      triggeredSecondaryReflection,
      terminationReason,
      nextAction,
    )

    return { candidates, searchRetryPlan }
  }

  /**
   * 可选 escape hatch 二次反思。
   *
   * 阶段 8 实现，本阶段抛出 NotImplementedError 以明确未接入。
   */
  async runSecondaryReflection(_input: unknown): Promise<unknown> {
    throw new Error('NotImplementedError: runSecondaryReflection will be implemented in stage 8')
  }

  /**
   * 构造退化策略（仅含 original），用于 LLM 校验失败场景。
   */
  private buildDegenerateStrategies(original: string): CandidateKeywordStrategy[] {
    const trimmed = original.trim()
    if (!trimmed || trimmed.length < 2) {
      return []
    }
    return [{ strategy: 'original', keywords: [trimmed], reason: 'LLM 关键词策略生成失败，退化为用户原词' }]
  }

  /**
   * 归一化关键词（用于去重比对，不改写原词）。
   */
  private normalizeKeyword(value: string): string {
    return value
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '')
      .replace(/[《》"'“”‘’、，。！？；：,.!?;:()[\]【】_-]/gu, '')
  }

  /**
   * 校验策略标签是否合法。
   */
  private normalizeStrategyTag(
    value: unknown,
  ): CandidateKeywordStrategy['strategy'] | undefined {
    if (value === 'original' || value === 'typo_fix' || value === 'decompose'
      || value === 'paraphrase' || value === 'column_demote' || value === 'broaden') {
      return value
    }
    return undefined
  }
}

/**
 * 全局单例（与 candidateService 的 getCandidateService 风格一致）
 */
let globalCandidateSearchRetryService: CandidateSearchRetryService | null = null

/**
 * 获取 CandidateSearchRetryService 全局单例。
 *
 * @returns CandidateSearchRetryService 实例
 */
export function getCandidateSearchRetryService(): CandidateSearchRetryService {
  if (!globalCandidateSearchRetryService) {
    globalCandidateSearchRetryService = new CandidateSearchRetryService()
  }
  return globalCandidateSearchRetryService
}

/**
 * 重置全局单例（仅供测试使用）。
 */
export function resetCandidateSearchRetryService(): void {
  globalCandidateSearchRetryService = null
}
