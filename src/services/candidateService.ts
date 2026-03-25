import { demoPrograms } from '@/mock/demoData'
import type {
  CandidateQueryCriteria,
  CandidateQueryResult,
  GapInfo,
  ProgramCandidate,
} from '@/types/orchestration'

export interface CandidateServiceConfig {
  defaultLimit: number
  maxLimit: number
  enableCache: boolean
  cacheTTL: number
}

export interface ProgramSearchParams {
  channelId: string
  channelName?: string
  programName: string
  limit?: number
}

const DEFAULT_CONFIG: CandidateServiceConfig = {
  defaultLimit: 10,
  maxLimit: 30,
  enableCache: true,
  cacheTTL: 5 * 60 * 1000,
}

export class CandidateService {
  private config: CandidateServiceConfig
  private cache = new Map<string, { candidates: ProgramCandidate[]; timestamp: number }>()
  private programs: ProgramCandidate[]

  constructor(config?: Partial<CandidateServiceConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.programs = demoPrograms.map((item) => ({ ...item }))
  }

  async queryCandidates(gap: GapInfo, criteria: CandidateQueryCriteria): Promise<CandidateQueryResult> {
    const cacheKey = JSON.stringify({ gapId: gap.id, criteria })
    const cached = this.cache.get(cacheKey)
    if (cached && this.config.enableCache && Date.now() - cached.timestamp < this.config.cacheTTL) {
      return {
        gapId: gap.id,
        candidates: cached.candidates,
        totalCount: cached.candidates.length,
        queryTime: new Date().toISOString(),
      }
    }

    const filtered = this.programs
      .filter((program) => program.duration >= criteria.expectedDuration.min)
      .filter((program) => program.duration <= criteria.expectedDuration.max)
      .filter((program) =>
        !criteria.programTypePreference?.length || criteria.programTypePreference.includes(program.programType),
      )
      .filter((program) => this.matchesKeywords(program, criteria.searchKeywords))
      .filter((program) => this.matchesPreferredChannel(program, criteria.preferredChannelId))
      .sort((left, right) => this.scoreCandidate(right, gap, criteria) - this.scoreCandidate(left, gap, criteria))
      .slice(0, this.config.defaultLimit)

    this.cache.set(cacheKey, { candidates: filtered, timestamp: Date.now() })

    return {
      gapId: gap.id,
      candidates: filtered,
      totalCount: filtered.length,
      queryTime: new Date().toISOString(),
    }
  }

  getCandidateById(candidateId: string): ProgramCandidate | undefined {
    return this.programs.find((item) => item.id === candidateId || item.programCode === candidateId)
  }

  async searchPrograms(params: ProgramSearchParams): Promise<ProgramCandidate[]> {
    const keyword = params.programName.trim().toLowerCase()
    const limit = Math.min(params.limit ?? this.config.defaultLimit, this.config.maxLimit)

    const scored = this.programs
      .filter((program) => {
        const haystack = `${program.programName} ${program.programCode}`.toLowerCase()
        return haystack.includes(keyword)
      })
      .filter((program) => {
        const channelIds = Array.isArray(program.metadata?.channelIds)
          ? (program.metadata?.channelIds as string[])
          : []
        return channelIds.length === 0 || channelIds.includes(params.channelId)
      })
      .map((program) => ({
        program,
        score: this.scoreProgramSearch(program, keyword, params.channelId),
      }))
      .sort((left, right) => right.score - left.score)
      .slice(0, limit)

    return scored.map((entry) => entry.program)
  }

  private scoreCandidate(candidate: ProgramCandidate, gap: GapInfo, criteria: CandidateQueryCriteria): number {
    const durationScore = 100 - Math.abs(candidate.duration - gap.duration) / 60
    const ratingScore = criteria.considerRatings ? (candidate.rating ?? 0) * 10 : 0
    const fillerPenalty = candidate.source === 'filler' ? -10 : 0
    const keywordScore = this.getKeywordScore(candidate, criteria.searchKeywords)
    const channelScore = this.getPreferredChannelScore(candidate, criteria.preferredChannelId)
    const editorialPreferenceScore = this.getEditorialPreferenceScore(
      candidate,
      criteria.preferredChannelId,
      criteria.programTypePreference,
    )
    return durationScore + ratingScore + fillerPenalty + keywordScore + channelScore + editorialPreferenceScore
  }

  private scoreProgramSearch(candidate: ProgramCandidate, keyword: string, channelId: string): number {
    const normalizedName = candidate.programName.toLowerCase()
    const exactMatch = normalizedName === keyword ? 100 : 0
    const prefixMatch = normalizedName.startsWith(keyword) ? 30 : 0
    const containsMatch = normalizedName.includes(keyword) ? 10 : 0
    const channelBoost = Array.isArray(candidate.metadata?.channelIds) &&
      (candidate.metadata?.channelIds as string[]).includes(channelId)
      ? 20
      : 0

    return exactMatch + prefixMatch + containsMatch + channelBoost + (candidate.rating ?? 0)
  }

  private matchesKeywords(candidate: ProgramCandidate, searchKeywords?: string[]): boolean {
    if (!searchKeywords?.length) return true
    const haystack = `${candidate.programName} ${candidate.programCode} ${candidate.programType} ${(candidate.tags ?? []).join(' ')}`.toLowerCase()
    return searchKeywords.some((keyword) => haystack.includes(keyword.toLowerCase()))
  }

  private matchesPreferredChannel(candidate: ProgramCandidate, preferredChannelId?: string): boolean {
    if (!preferredChannelId) return true
    const channelIds = Array.isArray(candidate.metadata?.channelIds)
      ? (candidate.metadata?.channelIds as string[])
      : []
    return channelIds.length === 0 || channelIds.includes(preferredChannelId)
  }

  private getKeywordScore(candidate: ProgramCandidate, searchKeywords?: string[]): number {
    if (!searchKeywords?.length) return 0
    const haystack = `${candidate.programName} ${candidate.programCode} ${(candidate.tags ?? []).join(' ')}`.toLowerCase()
    return searchKeywords.reduce((score, keyword) => {
      const normalized = keyword.trim().toLowerCase()
      if (!normalized) return score
      if (candidate.programName.toLowerCase() === normalized) return score + 40
      if (candidate.programName.toLowerCase().startsWith(normalized)) return score + 20
      if (haystack.includes(normalized)) return score + 8
      return score
    }, 0)
  }

  private getPreferredChannelScore(candidate: ProgramCandidate, preferredChannelId?: string): number {
    if (!preferredChannelId) return 0
    const channelIds = Array.isArray(candidate.metadata?.channelIds)
      ? (candidate.metadata?.channelIds as string[])
      : []
    return channelIds.includes(preferredChannelId) ? 25 : 0
  }

  private getEditorialPreferenceScore(
    candidate: ProgramCandidate,
    preferredChannelId?: string,
    preferredTypes?: string[],
  ): number {
    if (preferredChannelId !== 'news') {
      return preferredTypes?.includes(candidate.programType) ? 12 : 0
    }

    const strongPreferredTypes = new Set(['news', 'news_magazine', 'livelihood', 'commentary', 'news_commentary', 'law'])
    const weakPreferredTypes = new Set(['documentary', 'health', 'education'])

    if (strongPreferredTypes.has(candidate.programType)) return 28
    if (weakPreferredTypes.has(candidate.programType)) return 10
    if (candidate.programType === 'drama' || candidate.programType === 'entertainment' || candidate.programType === 'variety') return -18
    if (candidate.programType === 'filler' || candidate.programType === 'ad') return -24
    return preferredTypes?.includes(candidate.programType) ? 12 : 0
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
