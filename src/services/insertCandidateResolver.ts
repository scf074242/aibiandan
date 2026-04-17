import type { ProgramCandidate } from '@/types/orchestration'
import { getEffectiveColumnDefinition, getEffectiveProgramsByColumn } from './orchestration/runtimeLayoutRegistry'
import type { InsertParams } from './paramExtractor'

export type InsertRecommendationTrigger =
  | 'missing_program_name'
  | 'low_confidence'
  | 'ambiguous_candidates'
  | 'no_direct_match'

export interface InsertRecommendationCandidate {
  candidate: ProgramCandidate
  score: number
  confidence: number
  reasonTags: string[]
}

export type InsertCandidateResolution =
  | {
      status: 'resolved'
      selectedCandidate: ProgramCandidate
      confidence: number
      reasoning: string
      recommendedCandidates: InsertRecommendationCandidate[]
    }
  | {
      status: 'needs_recommendation'
      candidates: InsertRecommendationCandidate[]
      confidence: number
      reasoning: string
      trigger: InsertRecommendationTrigger
    }
  | {
      status: 'needs_clarification'
      reasoning: string
    }

export interface ResolveInsertCandidateInput {
  channelId: string
  columnId?: string
  params: InsertParams
  candidates: ProgramCandidate[]
  searchMode: 'explicit_name' | 'semantic_recommendation' | 'fallback_recommendation'
  recommendationLimit?: number
}

type CandidateScoreBreakdown = {
  candidate: ProgramCandidate
  score: number
  confidence: number
  reasonTags: string[]
  exactNameMatch: boolean
}

const DIRECT_EXECUTE_SCORE_THRESHOLD = 85
const DIRECT_EXECUTE_SCORE_DELTA = 15

export class InsertCandidateResolver {
  resolve(input: ResolveInsertCandidateInput): InsertCandidateResolution {
    if (input.candidates.length === 0) {
      return {
        status: 'needs_clarification',
        reasoning: '当前没有检索到可推荐的候选节目，请补充更明确的节目名、栏目或类型。',
      }
    }

    const recommendationLimit = Math.max(1, input.recommendationLimit ?? 3)
    const ranked = input.candidates
      .map((candidate) => this.scoreCandidate(candidate, input))
      .sort((left, right) => {
        if (left.score !== right.score) {
          return right.score - left.score
        }
        return left.candidate.programName.localeCompare(right.candidate.programName)
      })

    const recommendedCandidates = ranked.slice(0, recommendationLimit).map((entry) => ({
      candidate: entry.candidate,
      score: entry.score,
      confidence: entry.confidence,
      reasonTags: entry.reasonTags,
    }))
    const top = ranked[0]
    const second = ranked[1]

    if (!top) {
      return {
        status: 'needs_clarification',
        reasoning: '当前没有可用的插入候选，请重新描述要插入的节目。',
      }
    }

    if (input.searchMode === 'explicit_name') {
      if (
        top.score >= DIRECT_EXECUTE_SCORE_THRESHOLD
        && (ranked.length === 1 || top.score - (second?.score ?? 0) >= DIRECT_EXECUTE_SCORE_DELTA || top.exactNameMatch)
      ) {
        return {
          status: 'resolved',
          selectedCandidate: top.candidate,
          confidence: top.confidence,
          reasoning: ranked.length === 1
            ? '只命中一个高匹配候选，直接采用该节目。'
            : '已命中高置信度节目候选，并且和其他候选拉开了足够差距，可以直接执行插入。',
          recommendedCandidates,
        }
      }

      return {
        status: 'needs_recommendation',
        candidates: recommendedCandidates,
        confidence: top.confidence,
        reasoning: top.score >= DIRECT_EXECUTE_SCORE_THRESHOLD
          ? '虽然命中了相关节目，但候选之间仍然接近，建议你先确认具体要插入哪一条。'
          : '已经找到相关候选，但当前识别置信度还不够高，建议你从推荐列表里确认具体节目。',
        trigger: ranked.length > 1 && top.score - (second?.score ?? 0) < DIRECT_EXECUTE_SCORE_DELTA
          ? 'ambiguous_candidates'
          : 'low_confidence',
      }
    }

    if (input.searchMode === 'fallback_recommendation') {
      return {
        status: 'needs_recommendation',
        candidates: recommendedCandidates,
        confidence: top.confidence,
        reasoning: '没有命中明确的节目实例，我先按当前时段和内容语义给你推荐几条可插入节目。',
        trigger: 'no_direct_match',
      }
    }

    return {
      status: 'needs_recommendation',
      candidates: recommendedCandidates,
      confidence: top.confidence,
      reasoning: '当前指令更像是在描述节目类型或内容方向，我先给你推荐几条适合这个时段的候选节目。',
      trigger: 'missing_program_name',
    }
  }

  private scoreCandidate(
    candidate: ProgramCandidate,
    input: ResolveInsertCandidateInput,
  ): CandidateScoreBreakdown {
    const normalizedCandidateName = this.normalizeText(candidate.programName)
    const normalizedTargetName = this.normalizeText(input.params.programName)
    const normalizedRawText = this.normalizeText(input.params.rawProgramText)
    const normalizedSemanticLabel = this.normalizeText(input.params.semanticLabel)
    const keywords = this.extractKeywords(
      input.params.programName,
      input.params.rawProgramText,
      input.params.semanticLabel,
    )

    const columnProgramIds = input.columnId
      ? new Set(getEffectiveProgramsByColumn(input.channelId, input.columnId).map((item) => item.programId))
      : null
    const columnDefinition = input.columnId ? getEffectiveColumnDefinition(input.columnId) : undefined

    let score = 0
    const reasonTags: string[] = []
    let exactNameMatch = false

    if (normalizedTargetName) {
      const targetBaseName = this.normalizeSeriesName(normalizedTargetName)
      const candidateBaseName = this.normalizeSeriesName(normalizedCandidateName)
      if (normalizedCandidateName === normalizedTargetName || candidateBaseName === targetBaseName) {
        score += 82
        reasonTags.push('节目名精确匹配')
        exactNameMatch = true
      } else if (
        normalizedCandidateName.startsWith(normalizedTargetName)
        || candidateBaseName.startsWith(targetBaseName)
      ) {
        score += 68
        reasonTags.push('节目名高度匹配')
      } else if (
        normalizedCandidateName.includes(normalizedTargetName)
        || normalizedTargetName.includes(candidateBaseName)
      ) {
        score += 54
        reasonTags.push('节目名近似匹配')
      }
    }

    if (columnProgramIds?.has(candidate.programId)) {
      score += 18
      reasonTags.push('时段栏目匹配')
    } else if (columnDefinition && this.isCompatibleProgramType(candidate.programType, columnDefinition.defaultProgramType)) {
      score += 8
      reasonTags.push('时段类型兼容')
    }

    if (input.params.programTypeHint && this.isCompatibleProgramType(candidate.programType, input.params.programTypeHint)) {
      score += 22
      reasonTags.push('类型匹配')
    }

    if (normalizedSemanticLabel && normalizedCandidateName.includes(normalizedSemanticLabel)) {
      score += 14
      reasonTags.push('语义匹配')
    }

    const keywordMatchCount = keywords.filter((keyword) => normalizedCandidateName.includes(keyword)).length
    if (keywordMatchCount > 0) {
      score += Math.min(18, keywordMatchCount * 6)
      reasonTags.push('关键词匹配')
    }

    if (!normalizedTargetName && normalizedRawText && normalizedCandidateName.includes(normalizedRawText)) {
      score += 16
      reasonTags.push('描述贴近')
    }

    if (candidate.duration <= 1800) {
      score += 8
      reasonTags.push('短时段更稳妥')
    } else if (candidate.duration <= 3600) {
      score += 4
    }

    const boundedScore = Math.max(1, Math.min(100, Math.round(score)))
    return {
      candidate,
      score: boundedScore,
      confidence: Math.min(0.99, Math.max(0.35, boundedScore / 100)),
      reasonTags: Array.from(new Set(reasonTags)),
      exactNameMatch,
    }
  }

  private normalizeText(value?: string): string {
    return (value ?? '')
      .replace(/\s+/g, '')
      .trim()
      .toLowerCase()
  }

  private normalizeSeriesName(value: string): string {
    return value
      .replace(/^[^：:]+[：:]/, '')
      .replace(/第\s*\d+\s*[集期]/g, '')
      .replace(/[上下中](集|期)/g, '')
      .replace(/[·•]/g, '')
      .trim()
  }

  private extractKeywords(...values: Array<string | undefined>): string[] {
    const stopWords = new Set(['节目', '栏目', '内容', '一个', '一档', '一条', '一期', '一部', '当前', '适合', '合适'])
    return Array.from(
      new Set(
        values
          .flatMap((value) => (value ?? '').split(/[^0-9a-zA-Z\u4e00-\u9fa5]+/))
          .map((item) => item.trim().toLowerCase())
          .filter((item) => item.length >= 2 && !stopWords.has(item)),
      ),
    )
  }

  private isCompatibleProgramType(candidateType: string, preferredType: string): boolean {
    const normalizedCandidateType = candidateType.trim().toLowerCase()
    const normalizedPreferredType = preferredType.trim().toLowerCase()
    if (normalizedCandidateType === normalizedPreferredType) {
      return true
    }

    const compatibleTypes: Record<string, string[]> = {
      news_magazine: ['news', 'current_affairs'],
      current_affairs: ['news', 'news_magazine'],
      news: ['news_magazine', 'current_affairs'],
      health: ['lifestyle'],
      lifestyle: ['health'],
      documentary: ['current_affairs'],
    }

    return compatibleTypes[normalizedCandidateType]?.includes(normalizedPreferredType) ?? false
  }
}

let globalInsertCandidateResolver: InsertCandidateResolver | null = null

export function getInsertCandidateResolver(): InsertCandidateResolver {
  if (!globalInsertCandidateResolver) {
    globalInsertCandidateResolver = new InsertCandidateResolver()
  }
  return globalInsertCandidateResolver
}
