import type {
  DraftSelectionPriority,
  EditorialSelectionDecision,
  EditorialSelectionDimension,
  GapInfo,
  ProgramCandidate,
  ScheduleItemSnapshot,
} from '@/types/orchestration'
import type { LLMClient } from './llm/llmClient'
import type { DialogueContext } from './dialogueContext'
import type { GapPlanningThought } from './orchestrationStrategyService'
import { buildGapCandidateSelectionPrompt, buildInsertCandidateSelectionPrompt, ORCHESTRATION_PROMPT_BUILDER_VERSION } from './orchestrationPromptBuilder'
import type { InsertParams } from './paramExtractor'
import {
  extractFunctionalSearchKeywords,
  extractSoftSearchKeywords,
  extractSpecificSearchKeywords,
  hasEditorialKeywordRequirements,
  hasExplicitSequenceRequirements,
  hasFunctionalSearchKeywords,
  matchesEditorialKeywordRequirementsByFields,
  matchesExplicitSequenceRequirements,
  matchesFunctionalSearchKeywords,
  matchesSpecificSearchKeywords,
  normalizeCandidateKeyword,
} from './candidateKeywordMatcher'

export interface CandidateSelectionResult {
  decision: 'select' | 'none' | 'clarify'
  selectedCandidate?: ProgramCandidate
  reasoning: string
  confidence?: number
  matchedRequirements?: string[]
  missingRequirements?: string[]
  riskFlags?: string[]
  editorialDecision?: EditorialSelectionDecision
}

export interface GapSelectionContext {
  existingItems?: ScheduleItemSnapshot[]
}

type CandidateStrategyMetadata = ProgramCandidate & {
  expectedSequenceNo?: number
  sequenceNo?: number
  estimatedRating?: number
  popularityScore?: number
}

const GAP_SELECTION_LLM_TIMEOUT_MS = 8000
const CONTENT_MATCH_MIN_MATCHED_INTENT_KEYWORDS = 2

export class CandidateSelectionService {
  constructor(private llmClient: LLMClient) {}

  async selectForInsert(
    context: DialogueContext,
    params: InsertParams,
    candidates: ProgramCandidate[],
  ): Promise<CandidateSelectionResult> {
    if (candidates.length === 1) {
      return this.guardInsertSelection({
        decision: 'select',
        selectedCandidate: candidates[0]!,
        reasoning: '候选列表中只有一个匹配节目，直接采用该节目。',
      }, params)
    }

    try {
      const response = await this.llmClient.chat(
        buildInsertCandidateSelectionPrompt(context, params, candidates),
        { temperature: 0.1, maxTokens: 240, traceLabel: 'insert_candidate_selection', promptVersion: ORCHESTRATION_PROMPT_BUILDER_VERSION },
      )

      const selected = this.parseSelection(response.content, candidates)
      if (selected) return this.guardInsertSelection(selected, params)
    } catch {
      // Fall through to deterministic selection.
    }

    return this.guardInsertSelection(
      this.selectFallback(candidates, params.programName ?? params.rawProgramText ?? ''),
      params,
    )
  }

  async selectForGap(
    gap: GapInfo,
    channelName: string,
    date: string,
    candidates: ProgramCandidate[],
    planningThought?: GapPlanningThought,
    context?: GapSelectionContext,
  ): Promise<CandidateSelectionResult> {
    try {
      const response = await this.runGapSelectionLlmWithTimeout(
        buildGapCandidateSelectionPrompt({
          channelName,
          date,
          gap,
          candidates,
          planningThought,
          existingItems: context?.existingItems,
        }),
      )
      if (!response) {
        return this.selectGapFallback(candidates, gap, planningThought, context)
      }

      const selected = this.parseSelection(response.content, candidates)
      if (selected) {
        const guarded = this.guardGapSelection(selected, gap, planningThought, context, candidates)
        return this.resolveGapSelectionAbstention(selected, guarded, candidates, gap, planningThought, context)
      }
    } catch {
      // Fall through to deterministic selection.
    }

    return this.selectGapFallback(candidates, gap, planningThought, context)
  }

  private async runGapSelectionLlmWithTimeout(
    prompt: Parameters<LLMClient['chat']>[0],
  ): Promise<Awaited<ReturnType<LLMClient['chat']>> | null> {
    let timeoutId: ReturnType<typeof setTimeout> | undefined
    const request = this.llmClient
      .chat(prompt, { temperature: 0.1, maxTokens: 260, traceLabel: 'gap_candidate_selection', promptVersion: ORCHESTRATION_PROMPT_BUILDER_VERSION })
      .catch(() => null)
    const timeout = new Promise<null>((resolve) => {
      timeoutId = setTimeout(() => resolve(null), GAP_SELECTION_LLM_TIMEOUT_MS)
    })
    const result = await Promise.race([request, timeout])
    if (timeoutId) clearTimeout(timeoutId)
    return result
  }

  private resolveGapSelectionAbstention(
    originalSelection: CandidateSelectionResult,
    selection: CandidateSelectionResult,
    candidates: ProgramCandidate[],
    gap: GapInfo,
    planningThought?: GapPlanningThought,
    context?: GapSelectionContext,
  ): CandidateSelectionResult {
    if (selection.decision === 'select') {
      return selection
    }
    if (originalSelection.decision === 'select') {
      return selection
    }

    const primary = planningThought?.selectionPolicy?.primary
    if (primary !== 'content_match' && primary !== 'rating' && primary !== 'trending') {
      return selection
    }

    const fallback = this.selectGapFallback(candidates, gap, planningThought, context)
    if (fallback.decision !== 'select' || !fallback.selectedCandidate) {
      return selection
    }

    return {
      ...fallback,
      reasoning: `${fallback.reasoning}LLM 未给出可执行选择，但本地编排策略已确认候选满足硬约束，因此按本段${this.describePrimaryStrategy(primary)}策略继续编排。`,
      matchedRequirements: [
        ...(fallback.matchedRequirements ?? []),
        'strategy_guard:llm_abstention_fallback',
      ],
      riskFlags: [
        ...(fallback.riskFlags ?? []),
        'llm_abstention_overridden_by_local_strategy',
      ],
    }
  }

  private describePrimaryStrategy(primary: 'content_match' | 'rating' | 'trending'): string {
    if (primary === 'rating') return '收视优先'
    if (primary === 'trending') return '热播优先'
    return '内容匹配优先'
  }

  private parseSelection(content: string, candidates: ProgramCandidate[]): CandidateSelectionResult | null {
    const match = content.match(/\{[\s\S]*\}/)
    if (!match) return null

    try {
      const parsed = JSON.parse(match[0]) as {
        decision?: 'select' | 'none' | 'clarify'
        selectedCandidateId?: string | null
        reasoning?: string
        confidence?: number
        matchedRequirements?: string[]
        missingRequirements?: string[]
        riskFlags?: string[]
      }
      if (parsed.decision === 'none' || parsed.decision === 'clarify') {
        return {
          decision: parsed.decision,
          reasoning: parsed.reasoning || (parsed.decision === 'none' ? 'LLM 判断候选均不适合当前编排要求。' : 'LLM 判断需要补充确认后再编排。'),
          confidence: parsed.confidence,
          matchedRequirements: parsed.matchedRequirements,
          missingRequirements: parsed.missingRequirements,
          riskFlags: parsed.riskFlags,
        }
      }
      const selectedCandidate = candidates.find((candidate) => candidate.id === parsed.selectedCandidateId)
      if (!selectedCandidate) return null
      return this.enrichSelectionWithEditorialDecision({
        decision: 'select',
        selectedCandidate,
        reasoning: parsed.reasoning || 'LLM 已从候选列表中选择最匹配节目。',
        confidence: parsed.confidence,
        matchedRequirements: parsed.matchedRequirements,
        missingRequirements: parsed.missingRequirements,
        riskFlags: parsed.riskFlags,
      })
    } catch {
      return null
    }
  }

  private selectFallback(candidates: ProgramCandidate[], targetName: string): CandidateSelectionResult {
    if (candidates.length === 0) {
      return {
        decision: 'none',
        reasoning: '没有可用候选节目，保留空缺等待人工处理。',
        confidence: 0.95,
        missingRequirements: ['candidate'],
      }
    }

    const fallback = [...candidates].sort((left, right) => {
      const leftScore = this.scoreCandidateForName(left, targetName)
      const rightScore = this.scoreCandidateForName(right, targetName)
      return rightScore - leftScore
    })[0]

    return this.enrichSelectionWithEditorialDecision({
      decision: 'select',
      selectedCandidate: fallback!,
      reasoning: this.appendEditorialReasoning('按节目名匹配度和评分进行保守选择。', fallback),
    })
  }

  private selectGapFallback(
    candidates: ProgramCandidate[],
    gap: GapInfo,
    planningThought?: GapPlanningThought,
    context?: GapSelectionContext,
  ): CandidateSelectionResult {
    if (candidates.length === 0) {
      return {
        decision: 'none',
        reasoning: '没有可用候选节目，保留空缺等待人工处理。',
        confidence: 0.95,
        missingRequirements: ['candidate'],
      }
    }

    const eligible = candidates.filter((candidate) =>
      this.isEligibleForGapFallback(candidate, gap, planningThought, context),
    )

    if (eligible.length === 0) {
      return {
        decision: 'none',
        reasoning: '候选节目未同时满足硬关键词、时长和当前编排上下文，已保留空缺等待人工处理。',
        confidence: 0.9,
        missingRequirements: ['hard_requirements_or_schedule_context'],
        riskFlags: ['fallback_selection_blocked'],
      }
    }

    if (planningThought?.selectionPolicy?.primary === 'rating') {
      const fallback = [...eligible].sort((left, right) =>
        this.getEstimatedRating(right) - this.getEstimatedRating(left),
      )[0]
      const selectedCandidate = this.withEditorialDecision(fallback!, gap, planningThought, context)
      return this.enrichSelectionWithEditorialDecision({
        decision: 'select',
        selectedCandidate,
        reasoning: this.appendEditorialReasoning('按轮播单收视率优先策略，在满足硬约束的候选中选择预估收视最高的节目。', selectedCandidate),
      })
    }

    if (planningThought?.selectionPolicy?.primary === 'trending') {
      const fallback = [...eligible].sort((left, right) =>
        this.scoreTrendingFit(right) - this.scoreTrendingFit(left),
      )[0]
      const selectedCandidate = this.withEditorialDecision(fallback!, gap, planningThought, context)
      return this.enrichSelectionWithEditorialDecision({
        decision: 'select',
        selectedCandidate,
        reasoning: this.appendEditorialReasoning('按轮播单热播优先策略，在满足硬约束的候选中选择当前舆论和话题热度最高的节目。', selectedCandidate),
      })
    }

    if (planningThought?.selectionPolicy?.primary === 'sequence') {
      const fallback = eligible.find((candidate) => this.isExpectedSequenceCandidate(candidate))
      if (!fallback) {
        return {
          decision: 'clarify',
          reasoning: '顺播候选未命中本段期望集数，避免跳集或倒序，需人工确认后再编排。',
          confidence: 0.86,
          riskFlags: ['sequence_gap_or_order_risk'],
        }
      }
      const selectedCandidate = this.withEditorialDecision(fallback, gap, planningThought, context)
      return this.enrichSelectionWithEditorialDecision({
        decision: 'select',
        selectedCandidate,
        reasoning: this.appendEditorialReasoning('按电视频道顺播策略，在满足当前播出进度和已排上下文的候选中采用期望集数节目。', selectedCandidate),
      })
    }

    if (planningThought?.selectionPolicy?.primary === 'content_match') {
      const rankedCandidates = [...eligible].sort((left, right) => {
        const leftContentScore = this.scoreContentPriorityFit(left, planningThought.searchKeywords ?? [])
        const rightContentScore = this.scoreContentPriorityFit(right, planningThought.searchKeywords ?? [])
        if (leftContentScore !== rightContentScore) {
          return rightContentScore - leftContentScore
        }
        const leftScore = this.scoreCandidateForGap(left, gap, planningThought)
        const rightScore = this.scoreCandidateForGap(right, gap, planningThought)
        return rightScore - leftScore
      }).map((candidate) => this.withEditorialDecision(candidate, gap, planningThought, context))
      const selectedCandidate = rankedCandidates.find((candidate) =>
        this.meetsProfessionalAutoSelectThreshold(candidate, planningThought),
      )
      if (!selectedCandidate) {
        return this.buildProfessionalQualityBlockedResult(rankedCandidates[0], planningThought)
      }
      return this.enrichSelectionWithEditorialDecision({
        decision: 'select',
        selectedCandidate,
        reasoning: this.appendEditorialReasoning('按轮播单内容匹配优先策略，在满足硬约束的候选中优先选择节目标题、栏目和内容标签最贴合本段意图的节目。', selectedCandidate),
      })
    }

    const fallback = [...eligible].sort((left, right) => {
      const leftScore = this.scoreCandidateForGap(left, gap, planningThought)
      const rightScore = this.scoreCandidateForGap(right, gap, planningThought)
      return rightScore - leftScore
    })[0]

    const selectedCandidate = this.withEditorialDecision(fallback!, gap, planningThought, context)
    return this.enrichSelectionWithEditorialDecision({
      decision: 'select',
      selectedCandidate,
      reasoning: this.appendEditorialReasoning('按时长匹配度、类型偏好、关键词命中和当前编排上下文进行保守选择。', selectedCandidate),
    })
  }

  private appendEditorialReasoning(base: string, candidate?: ProgramCandidate): string {
    const summary = candidate?.editorialDecision?.summary
    return summary ? `${base}${summary}` : base
  }

  private enrichSelectionWithEditorialDecision(selection: CandidateSelectionResult): CandidateSelectionResult {
    const editorialDecision = selection.selectedCandidate?.editorialDecision
    if (selection.decision !== 'select' || !editorialDecision) {
      return selection
    }
    return {
      ...selection,
      editorialDecision,
      reasoning: selection.reasoning.includes(editorialDecision.summary)
        ? selection.reasoning
        : `${selection.reasoning}${editorialDecision.summary}`,
      matchedRequirements: [
        ...(selection.matchedRequirements ?? []),
        `editorial_strategy:${editorialDecision.strategy}`,
        `editorial_score:${editorialDecision.totalScore}`,
      ],
    }
  }

  private withEditorialDecision(
    candidate: ProgramCandidate,
    gap: GapInfo,
    planningThought?: GapPlanningThought,
    context?: GapSelectionContext,
  ): ProgramCandidate {
    if (candidate.editorialDecision) {
      return candidate
    }

    return {
      ...candidate,
      editorialDecision: this.buildEditorialDecision(candidate, gap, planningThought, context),
    }
  }

  private buildEditorialDecision(
    candidate: ProgramCandidate,
    gap: GapInfo,
    planningThought?: GapPlanningThought,
    context?: GapSelectionContext,
  ): EditorialSelectionDecision {
    const strategy = planningThought?.selectionPolicy?.primary ?? 'default'
    const dimensions = this.buildEditorialDimensions(candidate, gap, planningThought, context)
    const weights = this.getEditorialWeights(strategy)
    const weightedDimensions = dimensions.map((dimension) => ({
      ...dimension,
      weight: weights[dimension.key] ?? dimension.weight,
    }))
    const totalScore = Number(weightedDimensions
      .reduce((sum, dimension) => sum + dimension.score * dimension.weight, 0)
      .toFixed(1))
    const strengths = weightedDimensions
      .filter((dimension) => dimension.score >= 80)
      .map((dimension) => dimension.note)
      .slice(0, 3)
    const concerns = weightedDimensions
      .filter((dimension) => dimension.score < 60)
      .map((dimension) => dimension.note)
      .slice(0, 2)

    return {
      strategy,
      totalScore,
      summary: this.buildEditorialSummary(strategy, totalScore, strengths, concerns),
      strengths,
      concerns,
      dimensions: weightedDimensions,
    }
  }

  private buildEditorialDimensions(
    candidate: ProgramCandidate,
    gap: GapInfo,
    planningThought?: GapPlanningThought,
    context?: GapSelectionContext,
  ): EditorialSelectionDimension[] {
    const matchedKeywords = this.resolveMatchedContentKeywords(candidate, planningThought?.searchKeywords ?? [])
    const hasContentRequirements = this.hasContentRequirements(planningThought?.searchKeywords ?? [])
    const contentScore = hasContentRequirements
      ? Math.min(100, matchedKeywords.length * 28)
      : 70
    const durationScore = this.scoreDurationFit(candidate, gap)
    const ratingScore = this.scoreRatingFit(candidate)
    const trendScore = this.scoreTrendingFit(candidate)
    const sequenceRequired = planningThought?.selectionPolicy?.primary === 'sequence'
      || Boolean(planningThought?.sequentialPreference)
      || Boolean(planningThought?.selectionPolicy?.requiresPreviousSchedule)
    const sequenceScore = sequenceRequired
      ? (this.isExpectedSequenceCandidate(candidate) ? 100 : 35)
      : 70
    const typeScore = planningThought?.targetProgramTypes?.length
      ? planningThought.targetProgramTypes.includes(candidate.programType) ? 100 : 45
      : 70
    const scheduleContextScore = this.matchesExistingScheduleContext(candidate, gap, context?.existingItems ?? [])
      ? 100
      : 0

    return [
      {
        key: 'content_match',
        score: contentScore,
        weight: 0,
        note: hasContentRequirements
          ? `内容命中：${matchedKeywords.length > 0 ? matchedKeywords.join('、') : '未命中明确关键词'}。`
          : '未指定强内容词，按类型、时段和策略综合判断。',
      },
      {
        key: 'duration_fit',
        score: durationScore,
        weight: 0,
        note: durationScore >= 80
          ? '时长贴合当前空窗。'
          : durationScore > 0 ? '时长可放入但贴合度一般。' : '时长超过当前空窗。',
      },
      {
        key: 'rating',
        score: ratingScore,
        weight: 0,
        note: this.getEstimatedRating(candidate) > 0
          ? `预估收视 ${this.getEstimatedRating(candidate).toFixed(1)}。`
          : '无预估收视，按中性收视处理。',
      },
      {
        key: 'trend',
        score: trendScore,
        weight: 0,
        note: this.describeTrendingHeat(candidate, trendScore),
      },
      {
        key: 'sequence',
        score: sequenceScore,
        weight: 0,
        note: sequenceRequired
          ? (sequenceScore >= 80 ? '顺播集数符合当前进度。' : '顺播集数与当前进度存在风险。')
          : '本段不强制顺播。',
      },
      {
        key: 'type_fit',
        score: typeScore,
        weight: 0,
        note: typeScore >= 80 ? '节目类型符合本段版面要求。' : '节目类型与本段版面要求不完全一致。',
      },
      {
        key: 'schedule_context',
        score: scheduleContextScore,
        weight: 0,
        note: scheduleContextScore >= 80 ? '与当前已排节目无冲突或倒序风险。' : '与当前已排节目存在冲突或倒序风险。',
      },
    ]
  }

  private getEditorialWeights(strategy: DraftSelectionPriority | 'default'): Record<EditorialSelectionDimension['key'], number> {
    if (strategy === 'rating') {
      return {
        rating: 0.42,
        trend: 0.04,
        content_match: 0.18,
        duration_fit: 0.16,
        type_fit: 0.1,
        schedule_context: 0.1,
        sequence: 0,
      }
    }
    if (strategy === 'trending') {
      return {
        trend: 0.42,
        rating: 0.08,
        content_match: 0.18,
        duration_fit: 0.16,
        type_fit: 0.06,
        schedule_context: 0.1,
        sequence: 0,
      }
    }
    if (strategy === 'sequence') {
      return {
        sequence: 0.42,
        schedule_context: 0.2,
        content_match: 0.14,
        duration_fit: 0.12,
        type_fit: 0.08,
        rating: 0.04,
        trend: 0,
      }
    }
    if (strategy === 'content_match') {
      return {
        content_match: 0.4,
        duration_fit: 0.18,
        rating: 0.12,
        trend: 0.06,
        type_fit: 0.12,
        schedule_context: 0.12,
        sequence: 0,
      }
    }
    return {
      duration_fit: 0.3,
      content_match: 0.25,
      type_fit: 0.15,
      schedule_context: 0.15,
      rating: 0.1,
      trend: 0.05,
      sequence: 0,
    }
  }

  private buildEditorialSummary(
    strategy: DraftSelectionPriority | 'default',
    totalScore: number,
    strengths: string[],
    concerns: string[],
  ): string {
    const strategyText = strategy === 'sequence'
      ? '电视频道顺播'
      : strategy === 'rating'
        ? '轮播单收视优先'
        : strategy === 'trending'
          ? '轮播单热播优先'
          : strategy === 'content_match'
            ? '轮播单内容匹配优先'
            : '综合编排'
    const strengthText = strengths[0] ?? '基础约束可满足。'
    const concernText = concerns.length > 0 ? ` 需注意：${concerns.join('')}` : ''
    return `专业判断：按${strategyText}策略综合评分 ${totalScore}，${strengthText}${concernText}`
  }

  private guardInsertSelection(
    selection: CandidateSelectionResult,
    params: InsertParams,
  ): CandidateSelectionResult {
    if (selection.decision !== 'select' || !selection.selectedCandidate) {
      return selection
    }

    const hardKeywords = this.extractInsertHardKeywords(params)
    const searchKeywords = this.extractInsertSearchKeywords(params)
    const sequenceRequired = hasExplicitSequenceRequirements(searchKeywords)
    const editorialRequired = hasEditorialKeywordRequirements(searchKeywords)
    const functionalRequired = hasFunctionalSearchKeywords(searchKeywords)
    if (hardKeywords.length === 0 && !sequenceRequired && !editorialRequired && !functionalRequired) {
      return selection
    }

    const candidate = selection.selectedCandidate
    const haystack = this.buildCandidateSearchText(candidate)
    const titleMatched = hardKeywords.length === 0 || matchesSpecificSearchKeywords(haystack, searchKeywords)
    const sequenceMatched = !sequenceRequired || matchesExplicitSequenceRequirements(haystack, searchKeywords)
    const editorialMatched = !editorialRequired || this.matchesEditorialKeywordRequirements(candidate, searchKeywords)
    const functionalMatched = !functionalRequired || matchesFunctionalSearchKeywords(haystack, searchKeywords)
    if (titleMatched && sequenceMatched && editorialMatched && functionalMatched) {
      return selection
    }

    return {
      decision: 'none',
      reasoning: '插入候选未命中明确节目名、栏目、内容或功能型硬要求，已阻止自动插入并转人工确认。',
      confidence: selection.confidence,
      matchedRequirements: selection.matchedRequirements,
      missingRequirements: [
        ...(!titleMatched ? ['insert_hard_keywords'] : []),
        ...(!sequenceMatched ? ['insert_explicit_sequence'] : []),
        ...(!editorialMatched ? ['insert_editorial_keywords'] : []),
        ...(!functionalMatched ? ['insert_functional_keywords'] : []),
      ],
      riskFlags: [...(selection.riskFlags ?? []), 'insert_selection_blocked'],
    }
  }

  private extractInsertHardKeywords(params: InsertParams): string[] {
    return extractSpecificSearchKeywords([
      params.programName ?? '',
      params.rawProgramText ?? '',
    ])
  }

  private extractInsertSequenceKeywords(params: InsertParams): string[] {
    return this.extractInsertSearchKeywords(params)
  }

  private extractInsertSearchKeywords(params: InsertParams): string[] {
    return [
      params.programName ?? '',
      params.rawProgramText ?? '',
    ]
  }

  private guardGapSelection(
    selection: CandidateSelectionResult,
    gap: GapInfo,
    planningThought?: GapPlanningThought,
    context?: GapSelectionContext,
    candidates: ProgramCandidate[] = [],
  ): CandidateSelectionResult {
    if (selection.decision !== 'select' || !selection.selectedCandidate) {
      return selection
    }

    const candidate = selection.selectedCandidate
    if (!this.matchesHardKeywords(candidate, planningThought)) {
      return {
        decision: 'none',
        reasoning: 'LLM 选择的节目未命中明确标题、主题、栏目或功能型内容要求，已阻止自动排入并保留空缺。',
        confidence: selection.confidence,
        matchedRequirements: selection.matchedRequirements,
        missingRequirements: ['hard_keywords'],
        riskFlags: [...(selection.riskFlags ?? []), 'llm_selection_blocked'],
      }
    }

    if (!this.matchesGapDuration(candidate, gap)) {
      return {
        decision: 'none',
        reasoning: 'LLM 选择的节目时长超过当前空窗，已阻止自动排入并保留空缺。',
        confidence: selection.confidence,
        matchedRequirements: selection.matchedRequirements,
        missingRequirements: ['duration'],
        riskFlags: [...(selection.riskFlags ?? []), 'llm_selection_blocked'],
      }
    }

    if (!this.matchesExistingScheduleContext(candidate, gap, context?.existingItems ?? [])) {
      return {
        decision: 'none',
        reasoning: 'LLM 选择的节目与当前已排节目存在时间冲突或顺播倒序风险，已阻止自动排入并保留空缺。',
        confidence: selection.confidence,
        matchedRequirements: selection.matchedRequirements,
        missingRequirements: ['schedule_context'],
        riskFlags: [...(selection.riskFlags ?? []), 'llm_selection_blocked', 'schedule_context_conflict'],
      }
    }

    if (planningThought?.selectionPolicy?.primary === 'sequence' && !this.isExpectedSequenceCandidate(candidate)) {
      return {
        decision: 'clarify',
        reasoning: 'LLM 选择的顺播候选未命中本段期望集数，已转人工确认，避免跳集或倒序。',
        confidence: selection.confidence,
        matchedRequirements: selection.matchedRequirements,
        riskFlags: [...(selection.riskFlags ?? []), 'sequence_gap_or_order_risk'],
      }
    }

    const selectedCandidate = this.withEditorialDecision(candidate, gap, planningThought, context)
    const guardedSelection = {
      ...selection,
      selectedCandidate,
    }

    const strategyOverride = this.resolveStrategyOverride(guardedSelection, candidates, gap, planningThought, context)
    if (strategyOverride) {
      return this.guardProfessionalAutoSelectThreshold(strategyOverride, planningThought)
    }

    return this.guardProfessionalAutoSelectThreshold(
      this.enrichSelectionWithEditorialDecision(guardedSelection),
      planningThought,
    )
  }

  private guardProfessionalAutoSelectThreshold(
    selection: CandidateSelectionResult,
    planningThought?: GapPlanningThought,
  ): CandidateSelectionResult {
    if (selection.decision !== 'select' || !selection.selectedCandidate) {
      return selection
    }
    if (this.meetsProfessionalAutoSelectThreshold(selection.selectedCandidate, planningThought)) {
      return selection
    }
    return this.buildProfessionalQualityBlockedResult(selection.selectedCandidate, planningThought, selection)
  }

  private buildProfessionalQualityBlockedResult(
    candidate: ProgramCandidate | undefined,
    planningThought?: GapPlanningThought,
    selection?: CandidateSelectionResult,
  ): CandidateSelectionResult {
    const intentKeywords = this.resolveContentIntentKeywords(planningThought?.searchKeywords ?? [])
    const matchedKeywords = candidate
      ? this.resolveMatchedContentIntentKeywords(candidate, planningThought?.searchKeywords ?? [])
      : []
    return {
      decision: 'none',
      reasoning: [
        '候选虽然满足基础硬约束，但与本段具体内容意图的专业匹配证据不足，已保留空缺等待人工确认。',
        candidate?.editorialDecision?.summary ?? '',
      ].filter(Boolean).join(''),
      confidence: Math.min(selection?.confidence ?? 0.86, 0.9),
      matchedRequirements: [
        ...(selection?.matchedRequirements ?? []),
        ...matchedKeywords.map((keyword) => `content_intent:${keyword}`),
      ],
      missingRequirements: [
        ...(selection?.missingRequirements ?? []),
        'editorial_quality',
        ...intentKeywords
          .filter((keyword) => !matchedKeywords.includes(keyword))
          .map((keyword) => `content_intent:${keyword}`),
      ],
      riskFlags: [
        ...(selection?.riskFlags ?? []),
        'editorial_auto_select_threshold_blocked',
      ],
      editorialDecision: candidate?.editorialDecision,
    }
  }

  private meetsProfessionalAutoSelectThreshold(
    candidate: ProgramCandidate,
    planningThought?: GapPlanningThought,
  ): boolean {
    if (!this.requiresProfessionalContentGate(planningThought)) {
      return true
    }

    const intentKeywords = this.resolveContentIntentKeywords(planningThought?.searchKeywords ?? [])
    const matchedKeywords = this.resolveMatchedContentIntentKeywords(candidate, planningThought?.searchKeywords ?? [])
    const requiredMatches = Math.min(CONTENT_MATCH_MIN_MATCHED_INTENT_KEYWORDS, intentKeywords.length)
    return matchedKeywords.length >= requiredMatches
  }

  private requiresProfessionalContentGate(planningThought?: GapPlanningThought): boolean {
    if (planningThought?.selectionPolicy?.primary !== 'content_match') {
      return false
    }
    const searchKeywords = planningThought.searchKeywords ?? []
    return extractSpecificSearchKeywords(searchKeywords).length > 0
      && this.resolveContentIntentKeywords(searchKeywords).length >= CONTENT_MATCH_MIN_MATCHED_INTENT_KEYWORDS
  }

  private resolveContentIntentKeywords(searchKeywords: string[]): string[] {
    const specificKeywords = extractSpecificSearchKeywords(searchKeywords)
    const functionalKeywords = extractFunctionalSearchKeywords(searchKeywords)
    const broadcastFormKeywords = this.extractBroadcastFormKeywords(searchKeywords)
    const softKeywords = specificKeywords.length === 0 && functionalKeywords.length === 0 && broadcastFormKeywords.length === 0
      ? extractSoftSearchKeywords(searchKeywords)
      : []

    return Array.from(new Set([
      ...specificKeywords,
      ...functionalKeywords,
      ...broadcastFormKeywords,
      ...softKeywords,
    ]))
      .map((keyword) => normalizeCandidateKeyword(keyword))
      .filter((keyword) => keyword.length >= 2)
  }

  private extractBroadcastFormKeywords(searchKeywords: string[]): string[] {
    const terms = new Set<string>()
    const broadcastTerms = ['户外', '外场', '现场', '直播', '慢直播', '连线']
    searchKeywords.forEach((keyword) => {
      const normalized = normalizeCandidateKeyword(keyword)
      broadcastTerms.forEach((term) => {
        const normalizedTerm = normalizeCandidateKeyword(term)
        if (normalized.includes(normalizedTerm)) {
          terms.add(normalizedTerm)
        }
      })
    })
    return [...terms]
  }

  private resolveMatchedContentIntentKeywords(candidate: ProgramCandidate, searchKeywords: string[]): string[] {
    const haystack = normalizeCandidateKeyword(this.buildCandidateSearchText(candidate))
    return this.resolveContentIntentKeywords(searchKeywords)
      .filter((keyword) => haystack.includes(keyword))
  }

  private resolveStrategyOverride(
    selection: CandidateSelectionResult,
    candidates: ProgramCandidate[],
    gap: GapInfo,
    planningThought?: GapPlanningThought,
    context?: GapSelectionContext,
  ): CandidateSelectionResult | null {
    if (selection.decision !== 'select' || !selection.selectedCandidate || candidates.length < 2) {
      return null
    }

    const eligible = candidates.filter((candidate) =>
      this.isEligibleForGapFallback(candidate, gap, planningThought, context),
    )
    if (eligible.length < 2) return null

    const selected = selection.selectedCandidate
    const primary = planningThought?.selectionPolicy?.primary
    if (primary === 'rating') {
      const best = [...eligible].sort((left, right) => this.getEstimatedRating(right) - this.getEstimatedRating(left))[0]
      if (best && best.id !== selected.id && this.getEstimatedRating(best) > this.getEstimatedRating(selected)) {
        const selectedCandidate = this.withEditorialDecision(best, gap, planningThought, context)
        return this.enrichSelectionWithEditorialDecision({
          decision: 'select',
          selectedCandidate,
          reasoning: this.appendEditorialReasoning('LLM 返回的候选不是本段收视率优先策略下的最优候选，已按编排策略改选预估收视更高且满足硬约束的节目。', selectedCandidate),
          confidence: Math.min(selection.confidence ?? 0.88, 0.9),
          matchedRequirements: [
            ...(selection.matchedRequirements ?? []),
            'strategy_guard:rating_priority',
          ],
          missingRequirements: selection.missingRequirements,
          riskFlags: [...(selection.riskFlags ?? []), 'llm_selection_strategy_overridden'],
        })
      }
    }

    if (primary === 'trending') {
      const best = [...eligible].sort((left, right) => this.scoreTrendingFit(right) - this.scoreTrendingFit(left))[0]
      if (best && best.id !== selected.id && this.scoreTrendingFit(best) > this.scoreTrendingFit(selected)) {
        const selectedCandidate = this.withEditorialDecision(best, gap, planningThought, context)
        return this.enrichSelectionWithEditorialDecision({
          decision: 'select',
          selectedCandidate,
          reasoning: this.appendEditorialReasoning('LLM 返回的候选不是本段热播优先策略下的最优候选，已按编排策略改选当前舆论和话题热度更高且满足硬约束的节目。', selectedCandidate),
          confidence: Math.min(selection.confidence ?? 0.88, 0.9),
          matchedRequirements: [
            ...(selection.matchedRequirements ?? []),
            'strategy_guard:trending_priority',
          ],
          missingRequirements: selection.missingRequirements,
          riskFlags: [...(selection.riskFlags ?? []), 'llm_selection_strategy_overridden'],
        })
      }
    }

    if (primary === 'content_match') {
      const keywords = planningThought?.searchKeywords ?? []
      const selectedScore = this.scoreContentPriorityFit(selected, keywords)
      const best = [...eligible].sort((left, right) => {
        const leftScore = this.scoreContentPriorityFit(left, keywords)
        const rightScore = this.scoreContentPriorityFit(right, keywords)
        if (leftScore !== rightScore) return rightScore - leftScore
        return this.getEstimatedRating(right) - this.getEstimatedRating(left)
      })[0]
      const bestScore = best ? this.scoreContentPriorityFit(best, keywords) : selectedScore
      if (best && best.id !== selected.id && bestScore > selectedScore) {
        const selectedCandidate = this.withEditorialDecision(best, gap, planningThought, context)
        return this.enrichSelectionWithEditorialDecision({
          decision: 'select',
          selectedCandidate,
          reasoning: this.appendEditorialReasoning('LLM 返回的候选不是本段内容匹配优先策略下的最优候选，已按节目标题、所属栏目和内容标签贴合度改选更符合意图的节目。', selectedCandidate),
          confidence: Math.min(selection.confidence ?? 0.88, 0.9),
          matchedRequirements: [
            ...(selection.matchedRequirements ?? []),
            'strategy_guard:content_match_priority',
          ],
          missingRequirements: selection.missingRequirements,
          riskFlags: [...(selection.riskFlags ?? []), 'llm_selection_strategy_overridden'],
        })
      }
    }

    return null
  }

  private isEligibleForGapFallback(
    candidate: ProgramCandidate,
    gap: GapInfo,
    planningThought?: GapPlanningThought,
    context?: GapSelectionContext,
  ): boolean {
    return this.matchesHardKeywords(candidate, planningThought)
      && this.matchesGapDuration(candidate, gap)
      && this.matchesExistingScheduleContext(candidate, gap, context?.existingItems ?? [])
  }

  private matchesHardKeywords(candidate: ProgramCandidate, planningThought?: GapPlanningThought): boolean {
    const searchKeywords = planningThought?.searchKeywords ?? []
    const specificKeywords = extractSpecificSearchKeywords(searchKeywords)
    const sequenceRequired = hasExplicitSequenceRequirements(searchKeywords)
    const editorialRequired = hasEditorialKeywordRequirements(searchKeywords)
    const functionalRequired = hasFunctionalSearchKeywords(searchKeywords)
    if (specificKeywords.length === 0 && !sequenceRequired && !editorialRequired && !functionalRequired) {
      return true
    }

    const haystack = this.buildCandidateSearchText(candidate)
    return (specificKeywords.length === 0 || matchesSpecificSearchKeywords(haystack, searchKeywords))
      && (!sequenceRequired || matchesExplicitSequenceRequirements(haystack, searchKeywords))
      && (!editorialRequired || this.matchesEditorialKeywordRequirements(candidate, searchKeywords))
      && (!functionalRequired || matchesFunctionalSearchKeywords(haystack, searchKeywords))
  }

  private matchesGapDuration(candidate: ProgramCandidate, gap: GapInfo): boolean {
    if (gap.constraints.fixedEnd === false) {
      return true
    }
    return candidate.duration <= gap.duration
  }

  private matchesExistingScheduleContext(
    candidate: ProgramCandidate,
    gap: GapInfo,
    existingItems: ScheduleItemSnapshot[],
  ): boolean {
    const gapStart = new Date(gap.startTime).getTime()
    const gapEnd = new Date(gap.endTime).getTime()
    const candidateSequence = this.extractSequenceNo(candidate)
    const candidateSeriesKey = this.buildSeriesKey(candidate.programName, candidate.programCode)

    return existingItems.every((item) => {
      const itemStart = new Date(item.startTime).getTime()
      const itemEnd = new Date(item.endTime).getTime()
      if (Number.isFinite(itemStart) && Number.isFinite(itemEnd) && gapStart < itemEnd && gapEnd > itemStart) {
        return false
      }

      const itemSeriesKey = this.buildSeriesKey(item.programName, item.programCode)
      if (!candidateSeriesKey || candidateSeriesKey !== itemSeriesKey) {
        return true
      }

      const itemSequence = this.extractSequenceNo(item)
      if (typeof candidateSequence !== 'number' || typeof itemSequence !== 'number') {
        return true
      }

      if (Number.isFinite(itemStart) && gapStart < itemStart && candidateSequence > itemSequence) {
        return false
      }
      if (Number.isFinite(itemEnd) && gapStart >= itemEnd && candidateSequence < itemSequence) {
        return false
      }
      return true
    })
  }

  private isExpectedSequenceCandidate(candidate: ProgramCandidate): boolean {
    const metadata = candidate as CandidateStrategyMetadata
    if (typeof metadata.expectedSequenceNo !== 'number' || typeof metadata.sequenceNo !== 'number') {
      return true
    }
    return metadata.sequenceNo === metadata.expectedSequenceNo
  }

  private buildSeriesKey(programName?: string, programCode?: string): string {
    const normalizedName = this.normalizeSeriesName(programName)
    if (normalizedName) {
      return `name:${normalizedName}`
    }
    return programCode ? `code:${programCode.replace(/\d{1,4}$/, '')}` : ''
  }

  private normalizeSeriesName(programName?: string): string {
    if (!programName) return ''
    return normalizeCandidateKeyword(
      programName
        .replace(/第\s*[0-9零〇一二两三四五六七八九十百]+\s*[集期]/gu, '')
        .replace(/[上中下][集期]/gu, ''),
    )
  }

  private extractSequenceNo(candidate: ProgramCandidate | ScheduleItemSnapshot): number | null {
    const metadata = candidate as CandidateStrategyMetadata
    if (typeof metadata.sequenceNo === 'number' && metadata.sequenceNo > 0) {
      return metadata.sequenceNo
    }
    const issueNo = 'issueNo' in candidate ? this.parsePositiveNumber(candidate.issueNo) : null
    if (issueNo !== null) {
      return issueNo
    }
    const codeMatch = candidate.programCode?.match(/(\d{1,4})$/)
    if (codeMatch) {
      const parsed = Number(codeMatch[1])
      if (Number.isFinite(parsed) && parsed > 0) {
        return parsed
      }
    }
    const nameText = 'instanceName' in candidate
      ? `${candidate.programName} ${candidate.instanceName}`
      : candidate.programName
    const nameMatch = nameText.match(/第\s*([0-9零〇一二两三四五六七八九十百]+)\s*[集期]/u)
    return nameMatch ? this.parseChineseNumber(nameMatch[1]!) : null
  }

  private parsePositiveNumber(value?: string): number | null {
    if (!value) return null
    const parsed = Number(value)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null
  }

  private parseChineseNumber(value: string): number | null {
    const direct = Number(value)
    if (Number.isFinite(direct) && direct > 0) return direct
    const digits: Record<string, number> = {
      零: 0,
      〇: 0,
      一: 1,
      二: 2,
      两: 2,
      三: 3,
      四: 4,
      五: 5,
      六: 6,
      七: 7,
      八: 8,
      九: 9,
    }
    if (value === '十') return 10
    const tenIndex = value.indexOf('十')
    if (tenIndex >= 0) {
      const high = tenIndex === 0 ? 1 : digits[value[tenIndex - 1]!] ?? 0
      const low = digits[value[tenIndex + 1]!] ?? 0
      return high * 10 + low
    }
    return value.split('').reduce((sum, char) => sum * 10 + (digits[char] ?? 0), 0) || null
  }

  private scoreCandidateForName(candidate: ProgramCandidate, targetName: string): number {
    const normalizedTarget = targetName.trim().toLowerCase()
    if (!normalizedTarget) return 0
    const normalizedName = candidate.programName.trim().toLowerCase()
    const normalizedHaystack = this.buildCandidateSearchText(candidate).toLowerCase()
    const exactMatch = normalizedName === normalizedTarget ? 100 : 0
    const prefixMatch = normalizedName.startsWith(normalizedTarget) ? 30 : 0
    const containsMatch = normalizedHaystack.includes(normalizedTarget) ? 20 : 0
    return exactMatch + prefixMatch + containsMatch
  }

  private scoreCandidateForGap(
    candidate: ProgramCandidate,
    gap: GapInfo,
    planningThought?: GapPlanningThought,
  ): number {
    const durationScore = 100 - Math.abs(candidate.duration - gap.duration) / 60
    const typeScore = planningThought?.targetProgramTypes?.includes(candidate.programType) ? 25 : 0
    const keywordWeight = planningThought?.selectionPolicy?.primary === 'content_match' ? 80 : 8
    const keywordScore = planningThought?.selectionPolicy?.primary === 'content_match'
      ? this.scoreContentPriorityFit(candidate, planningThought?.searchKeywords ?? []) * keywordWeight
      : this.scoreContentKeywordMatch(candidate, planningThought?.searchKeywords ?? [], keywordWeight)
    return durationScore + typeScore + keywordScore
  }

  private scoreContentPriorityFit(candidate: ProgramCandidate, searchKeywords: string[]): number {
    const normalizedKeywords = new Set([
      ...extractSoftSearchKeywords(searchKeywords),
      ...extractFunctionalSearchKeywords(searchKeywords),
      ...searchKeywords.map((keyword) => normalizeCandidateKeyword(keyword)).filter((keyword) => keyword.length >= 2),
    ])
    if (normalizedKeywords.size === 0) return 0

    const weightedFields: Array<[string | undefined, number]> = [
      [candidate.programName, 4],
      [candidate.instanceName, 3],
      [candidate.columnName, 3],
      [candidate.columnId, 1],
      [candidate.programCode, 1],
      ...(candidate.contentTags ?? []).map((tag): [string, number] => [tag, 3]),
    ]

    let score = 0
    normalizedKeywords.forEach((keyword) => {
      for (const [value, weight] of weightedFields) {
        if (!value) continue
        const normalizedValue = normalizeCandidateKeyword(value)
        if (normalizedValue.includes(keyword)) {
          score += weight
        }
      }
    })
    return score
  }

  private scoreContentKeywordMatch(
    candidate: ProgramCandidate,
    searchKeywords: string[],
    keywordWeight: number,
  ): number {
    if (searchKeywords.length === 0) return 0
    const haystack = normalizeCandidateKeyword(this.buildCandidateSearchText(candidate))
    const phraseScore = extractSoftSearchKeywords(searchKeywords).reduce((score, keyword) =>
      haystack.includes(keyword) ? score + keywordWeight : score, 0)
    const functionalScore = extractFunctionalSearchKeywords(searchKeywords).reduce((score, keyword) =>
      haystack.includes(keyword) ? score + keywordWeight : score, 0)
    return phraseScore + functionalScore
  }

  private hasContentRequirements(searchKeywords: string[]): boolean {
    return [
      ...extractSpecificSearchKeywords(searchKeywords),
      ...extractSoftSearchKeywords(searchKeywords),
      ...extractFunctionalSearchKeywords(searchKeywords),
    ].length > 0
  }

  private resolveMatchedContentKeywords(candidate: ProgramCandidate, searchKeywords: string[]): string[] {
    const haystack = normalizeCandidateKeyword(this.buildCandidateSearchText(candidate))
    return Array.from(new Set([
      ...extractSpecificSearchKeywords(searchKeywords),
      ...extractSoftSearchKeywords(searchKeywords),
      ...extractFunctionalSearchKeywords(searchKeywords),
    ])).filter((keyword) => haystack.includes(keyword))
  }

  private scoreDurationFit(candidate: ProgramCandidate, gap: GapInfo): number {
    if (gap.constraints.fixedEnd === false) {
      return 90
    }
    if (candidate.duration > gap.duration) {
      return 0
    }
    if (gap.duration <= 0) {
      return 50
    }
    const gapRatio = Math.abs(gap.duration - candidate.duration) / gap.duration
    return Math.max(40, Math.round(100 - gapRatio * 100))
  }

  private scoreRatingFit(candidate: ProgramCandidate): number {
    const rating = this.getEstimatedRating(candidate)
    if (rating <= 0) {
      return 50
    }
    return Math.max(0, Math.min(100, Math.round(rating * 10)))
  }

  private getEstimatedRating(candidate: ProgramCandidate): number {
    return (candidate as CandidateStrategyMetadata).estimatedRating ?? 0
  }

  private scoreTrendingFit(candidate: ProgramCandidate): number {
    const metadata = candidate as CandidateStrategyMetadata
    if (typeof metadata.popularityScore === 'number') {
      return Math.max(0, Math.min(100, metadata.popularityScore))
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
    const scoreText = typeof (candidate as CandidateStrategyMetadata).popularityScore === 'number'
      ? `热度 ${(candidate as CandidateStrategyMetadata).popularityScore!.toFixed(1)}`
      : `热播分 ${trendScore.toFixed(1)}`
    const tags = candidate.contentTags?.slice(0, 3).join('、')
    return tags ? `${scoreText}，话题标签 ${tags}。` : `${scoreText}。`
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
}

let globalCandidateSelectionService: CandidateSelectionService | null = null

export function getCandidateSelectionService(llmClient: LLMClient): CandidateSelectionService {
  if (!globalCandidateSelectionService) {
    globalCandidateSelectionService = new CandidateSelectionService(llmClient)
  }
  return globalCandidateSelectionService
}
