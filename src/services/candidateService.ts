import {
  orchestrationDemoCandidates,
} from '@/mock/orchestrationMock'
import { getAtomicCapabilities } from './atomicCapabilities'
import {
  getEffectiveColumnDefinition,
  getEffectiveProgramsByColumn,
} from './orchestration/runtimeLayoutRegistry'
import type {
  CandidateQueryCriteria,
  CandidateQueryResult,
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
  selectionMode?: SelectionMode
  selectionNote?: string
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
  private candidateByProgramCode: Map<string, ProgramCandidate>

  constructor(config?: Partial<CandidateServiceConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.candidates = orchestrationDemoCandidates.map((item) => ({ ...item }))
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
      return {
        gapId: gap.id,
        candidates: cached.candidates,
        totalCount: cached.candidates.length,
        queryTime: new Date().toISOString(),
      }
    }

    const allowedProgramIds = new Set(
      getEffectiveProgramsByColumn(criteria.channelId, criteria.columnId).map((item) => item.programId),
    )

    const filtered = this.candidates
      .filter((candidate) => candidate.channelId === criteria.channelId)
      .filter((candidate) => allowedProgramIds.size === 0 || allowedProgramIds.has(candidate.programId))
      .filter((candidate) => this.matchesDuration(candidate, criteria))
      .filter((candidate) => this.matchesProgramType(candidate, criteria.programTypePreference))
      .filter((candidate) => this.matchesUsageState(candidate, criteria.excludeUsed))
    const keywordMatched = criteria.searchKeywords?.length
      ? filtered.filter((candidate) => this.matchesSearchKeywords(candidate, criteria.searchKeywords ?? []))
      : filtered
    const effectiveCandidates = keywordMatched.length > 0 ? keywordMatched : filtered

    const sorted = this.sortCandidates(effectiveCandidates, {
      channelId: criteria.channelId,
      columnId: criteria.columnId,
      gap,
      criteria,
    }).slice(0, this.config.defaultLimit)

    this.cache.set(cacheKey, { candidates: sorted, timestamp: Date.now() })

    return {
      gapId: gap.id,
      candidates: sorted,
      totalCount: sorted.length,
      queryTime: new Date().toISOString(),
    }
  }

  getCandidateById(candidateId: string): ProgramCandidate | undefined {
    return this.candidates.find((item) => item.id === candidateId || item.programCode === candidateId)
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

  private filterProgramSearchCandidates(
    params: ProgramSearchParams,
    keyword: string,
    allowedProgramIds: Set<string> | null,
  ): ProgramCandidate[] {
    return this.candidates
      .filter((candidate) => candidate.channelId === params.channelId)
      .filter((candidate) => !allowedProgramIds || allowedProgramIds.has(candidate.programId))
      .filter((candidate) => !params.programTypes?.length || this.matchesProgramType(candidate, params.programTypes))
      .filter((candidate) => {
        if (!keyword) return true
        const haystack = `${candidate.programName} ${candidate.programCode}`.toLowerCase()
        return haystack.includes(keyword)
      })
      .filter((candidate) => !this.isScheduledProgramCode(candidate.programCode))
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

    const haystack = `${candidate.programName} ${candidate.programCode}`.toLowerCase()
    return searchKeywords.some((keyword) => {
      const normalized = keyword.trim().toLowerCase()
      return normalized.length > 0 && haystack.includes(normalized)
    })
  }

  private buildKeywordScore(candidate: ProgramCandidate, searchKeywords: string[]): number {
    return searchKeywords.reduce((score, keyword) => {
      const normalized = keyword.trim().toLowerCase()
      if (!normalized) {
        return score
      }
      return candidate.programName.toLowerCase().includes(normalized) ? score + 12 : score
    }, 0)
  }

  private scoreProgramSearch(candidate: ProgramCandidate, keyword: string): number {
    if (!keyword) {
      return (candidate.duration <= 3600 ? 20 : 0) + this.buildRerunScore(candidate)
    }

    const normalizedName = candidate.programName.toLowerCase()
    const exactMatch = normalizedName === keyword ? 100 : 0
    const prefixMatch = normalizedName.startsWith(keyword) ? 30 : 0
    const containsMatch = normalizedName.includes(keyword) ? 10 : 0
    return exactMatch + prefixMatch + containsMatch + this.buildRerunScore(candidate)
  }

  private sortCandidates(
    candidates: ProgramCandidate[],
    context: CandidateSortContext,
  ): ProgramCandidate[] {
    const columnId = context.columnId?.trim()
    if (columnId && this.isSequentialColumn(columnId)) {
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
    const scheduledState = this.collectScheduledSequenceState(columnId, allowedProgramIds)

    const ranked = candidates.map((candidate, index) => {
      const sequenceNo = this.extractSequenceNo(candidate)
      const seriesKey = this.buildSeriesKey(candidate)
      const scheduledMax = seriesKey ? scheduledState.maxSequenceBySeries.get(seriesKey) : undefined
      const hasProgress = Boolean(seriesKey && scheduledState.seriesWithSchedule.has(seriesKey))
      const nextExpected = typeof scheduledMax === 'number' ? scheduledMax + 1 : 1
      const hasRecognizedSequence = typeof sequenceNo === 'number'
      const isAhead = hasRecognizedSequence ? sequenceNo >= nextExpected : false
      const distance = hasRecognizedSequence ? Math.abs(sequenceNo - nextExpected) : Number.POSITIVE_INFINITY

      return {
        candidate: this.decorateCandidate(candidate, {
          sequenceNo: sequenceNo ?? undefined,
          selectionMode: 'sequential',
          selectionNote: this.buildSequentialSelectionNote(sequenceNo, nextExpected, hasProgress),
        }),
        index,
        sequenceNo,
        hasRecognizedSequence,
        hasProgress,
        nextExpected,
        isAhead,
        distance,
        fallbackScore: this.scoreProgramSearch(candidate, context.keyword ?? ''),
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
    return candidates
      .map((candidate, index) => ({
        candidate: this.decorateCandidate(candidate, {
          selectionMode: context.columnId ? 'rerun' : 'default',
          selectionNote: context.columnId
            ? '当前栏目不按顺播推进，先按时段匹配度筛选重播候选。'
            : '已按节目名称、时长和当前条件筛选匹配候选。',
        }),
        index,
        score: context.gap && context.criteria
          ? this.scoreCandidate(candidate, context.gap, context.criteria)
          : this.scoreProgramSearch(candidate, context.keyword ?? ''),
      }))
      .sort((left, right) => {
        if (left.score !== right.score) {
          return right.score - left.score
        }
        return left.index - right.index
      })
      .map((entry) => entry.candidate)
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
        return '按当前已播进度顺播推荐。'
      }
      if (sequenceNo > nextExpected) {
        return `当前缺少第${nextExpected}集/期，先顺延到第${sequenceNo}集/期。`
      }
      return `该候选早于当前已排进度，优先级会后置。`
    }

    return hasProgress
      ? '当前栏目按顺播推进，但这条候选暂未识别出明确集/期号。'
      : '当前栏目按顺播推进，优先从可识别的起始集/期开始。'
  }

  private isSequentialColumn(columnId: string): boolean {
    return Boolean(getEffectiveColumnDefinition(columnId)?.isSequential)
  }

  private toScheduledItemRecord(item: ScheduleItemSnapshot): ScheduledItemRecord {
    return item as ScheduledItemRecord
  }

  private collectScheduledSequenceState(columnId: string, allowedProgramIds: Set<string>) {
    const maxSequenceBySeries = new Map<string, number>()
    const seriesWithSchedule = new Set<string>()

    this.atomicCapabilities.getAllItems().forEach((item) => {
      const matchedCandidate = this.resolveScheduledCandidate(this.toScheduledItemRecord(item), columnId, allowedProgramIds)
      if (!matchedCandidate) return

      const seriesKey = this.buildSeriesKey(matchedCandidate)
      if (!seriesKey) return

      seriesWithSchedule.add(seriesKey)
      const sequenceNo = this.extractSequenceNo(matchedCandidate)
      if (typeof sequenceNo !== 'number') return

      const currentMax = maxSequenceBySeries.get(seriesKey) ?? 0
      if (sequenceNo > currentMax) {
        maxSequenceBySeries.set(seriesKey, sequenceNo)
      }
    })

    return {
      maxSequenceBySeries,
      seriesWithSchedule,
    }
  }

  private resolveScheduledCandidate(
    item: ScheduledItemRecord,
    columnId: string,
    allowedProgramIds: Set<string>,
  ): ProgramCandidate | undefined {
    const itemColumnId =
      typeof item.keySlot === 'string'
        ? item.keySlot
        : typeof item.columnId === 'string'
          ? item.columnId
          : undefined

    if (itemColumnId && itemColumnId !== columnId) {
      return undefined
    }

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
    return this.candidates.find((candidate) => {
      if (allowedProgramIds.size > 0 && !allowedProgramIds.has(candidate.programId)) {
        return false
      }
      return this.normalizeSeriesName(candidate.programName) === normalizedName
    })
  }

  private buildSeriesKey(candidate: ProgramCandidate): string {
    const normalizedName = this.normalizeSeriesName(candidate.programName)
    return candidate.programId
      ? `program:${candidate.programId}`
      : `name:${candidate.channelId}:${normalizedName}`
  }

  private normalizeSeriesName(name: string): string {
    return name
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
    const episodeMatch = name.match(/第\s*(\d+)\s*(集|期)/)
    if (episodeMatch) {
      return Number(episodeMatch[1])
    }

    const upperName = name.toUpperCase()
    if (upperName.includes('上集') || upperName.includes('上期')) return 1
    if (upperName.includes('中集') || upperName.includes('中期')) return 2
    if (upperName.includes('下集') || upperName.includes('下期')) return 3

    return null
  }

  private buildRerunScore(candidate: ProgramCandidate): number {
    const durationBias = candidate.duration <= 3600 ? 12 : 4
    const typeBias = ['news', 'current_affairs'].includes(candidate.programType) ? 6 : 0
    return durationBias + typeBias
  }

  private buildScheduleSignature(): string {
    return this.atomicCapabilities
      .getAllItems()
      .map((item) => {
        const record = this.toScheduledItemRecord(item)
        return String(record.programCode ?? record.code18 ?? record.id ?? '')
      })
      .filter(Boolean)
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

  private matchesDuration(candidate: ProgramCandidate, criteria: CandidateQueryCriteria): boolean {
    if (criteria.columnId) {
      return true
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
