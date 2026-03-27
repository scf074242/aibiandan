import {
  getOrchestrationDemoProgramsByColumn,
  orchestrationDemoCandidates,
} from '@/mock/orchestrationMock'
import { getAtomicCapabilities } from './atomicCapabilities'
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
  programName: string
  columnId?: string
  programTypes?: string[]
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
  private candidates: ProgramCandidate[]
  private atomicCapabilities = getAtomicCapabilities()

  constructor(config?: Partial<CandidateServiceConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.candidates = orchestrationDemoCandidates.map((item) => ({ ...item }))
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

    const allowedProgramIds = new Set(
      getOrchestrationDemoProgramsByColumn(criteria.channelId, criteria.columnId).map((item) => item.programId),
    )

    const filtered = this.candidates
      .filter((candidate) => candidate.channelId === criteria.channelId)
      .filter((candidate) => allowedProgramIds.size === 0 || allowedProgramIds.has(candidate.programId))
      .filter((candidate) => candidate.duration >= criteria.expectedDuration.min)
      .filter((candidate) => candidate.duration <= criteria.expectedDuration.max)
      .filter((candidate) => this.matchesProgramType(candidate, criteria.programTypePreference))
      .filter((candidate) => this.matchesUsageState(candidate, criteria.excludeUsed))
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
    return this.candidates.find((item) => item.id === candidateId || item.programCode === candidateId)
  }

  async searchPrograms(params: ProgramSearchParams): Promise<ProgramCandidate[]> {
    const keyword = params.programName.trim().toLowerCase()
    const limit = Math.min(params.limit ?? this.config.defaultLimit, this.config.maxLimit)
    const allowedProgramIds = params.columnId
      ? new Set(getOrchestrationDemoProgramsByColumn(params.channelId, params.columnId).map((item) => item.programId))
      : null

    const scored = this.candidates
      .filter((candidate) => candidate.channelId === params.channelId)
      .filter((candidate) => !allowedProgramIds || allowedProgramIds.has(candidate.programId))
      .filter((candidate) => !params.programTypes?.length || this.matchesProgramType(candidate, params.programTypes))
      .filter((candidate) => {
        if (!keyword) return true
        const haystack = `${candidate.programName} ${candidate.programCode}`.toLowerCase()
        return haystack.includes(keyword)
      })
      .map((candidate) => ({
        candidate,
        score: this.scoreProgramSearch(candidate, keyword),
      }))
      .sort((left, right) => right.score - left.score)
      .slice(0, limit)

    return scored.map((entry) => entry.candidate)
  }

  private scoreCandidate(candidate: ProgramCandidate, gap: GapInfo, criteria: CandidateQueryCriteria): number {
    const durationScore = 100 - Math.abs(candidate.duration - gap.duration) / 60
    const typeScore = criteria.programTypePreference?.includes(candidate.programType) ? 25 : 0
    const issueScore = candidate.issueNo ? Math.max(0, 10 - Number(candidate.issueNo)) : 0
    return durationScore + typeScore + issueScore
  }

  private scoreProgramSearch(candidate: ProgramCandidate, keyword: string): number {
    if (!keyword) {
      return candidate.duration <= 3600 ? 20 : 0
    }

    const normalizedName = candidate.programName.toLowerCase()
    const exactMatch = normalizedName === keyword ? 100 : 0
    const prefixMatch = normalizedName.startsWith(keyword) ? 30 : 0
    const containsMatch = normalizedName.includes(keyword) ? 10 : 0
    return exactMatch + prefixMatch + containsMatch
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

    const currentScheduleCodes = new Set(
      this.atomicCapabilities
        .getAllItems()
        .map((item) => item.programCode)
        .filter((code): code is string => Boolean(code)),
    )

    return !currentScheduleCodes.has(candidate.programCode)
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
