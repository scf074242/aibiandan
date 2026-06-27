import type { DraftFeasibilityReport, DraftFeasibilitySegmentReport, HistoryReference, LayoutDraft, ProgramCandidate, ScheduleItemSnapshot } from '@/types/orchestration'
import { orchestrationDemoCandidates } from '@/mock/orchestrationMock'
import {
  extractEditorialKeywordRequirements,
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
import { detectMovingItemSequenceViolation } from './scheduleSequenceGuard'

export class LayoutDraftFeasibilityService {
  previewFeasibility(
    draft: LayoutDraft,
    existingItems: ScheduleItemSnapshot[] = [],
    historyReference?: HistoryReference,
  ): DraftFeasibilityReport {
    const channelCandidates = orchestrationDemoCandidates.filter((candidate) => candidate.channelId === draft.channelId)

    const segments: DraftFeasibilitySegmentReport[] = draft.columns.map((column, index) => {
      const slot = draft.layoutReference.slots[index]
      const hints = column.queryHints ?? []
      const hasSpecificHints = hasSpecificSearchKeywords(hints)
      const hasFunctionalHints = hasFunctionalSearchKeywords(hints)
      const hasSequenceHints = hasExplicitSequenceRequirements(hints)
      const hasEditorialHints = hasEditorialKeywordRequirements(hints)
      const hasHardHints = hasSpecificHints || hasFunctionalHints || hasSequenceHints || hasEditorialHints
      const slotDuration = this.getSlotDurationSeconds(slot)

      const typeMatched = channelCandidates.filter((candidate) => candidate.programType === column.defaultProgramType)
      const durationMatched = typeMatched.filter((candidate) =>
        slotDuration === null || candidate.duration <= slotDuration,
      )
      const keywordMatched = hints.length
        ? durationMatched.filter((candidate) => this.matchesCandidateKeywords(candidate, hints))
        : durationMatched
      const keywordMatches = hasHardHints
        ? keywordMatched
        : keywordMatched.length > 0 ? keywordMatched : durationMatched
      const historyMatchResult = this.filterHistorySequenceMatches(keywordMatches, column, existingItems, historyReference)
      const matches = this.filterScheduleContextMatches(historyMatchResult.candidates, column, slot, existingItems)
      const scheduleContextRejected = keywordMatches.length > 0 && matches.length === 0

      const status: DraftFeasibilitySegmentReport['status'] =
        matches.length === 0 ? 'blocked' : matches.length < 2 ? 'warning' : 'ready'

      const blockerKind = status === 'blocked'
        ? this.resolveBlockerKind(typeMatched.length, durationMatched.length, hasHardHints, scheduleContextRejected)
        : undefined
      const reasons = this.buildReasons({
        matchCount: matches.length,
        typeMatchedCount: typeMatched.length,
        durationMatchedCount: durationMatched.length,
        hasHardHints,
        hintCount: hints.length,
        scheduleContextRejected,
        historyContextSummary: historyMatchResult.summary,
      })

      return {
        segmentId: slot?.id ?? column.columnId,
        label: column.semanticLabel ?? column.columnName,
        startTime: slot?.startTime.split('T')[1]?.slice(0, 8) ?? draft.coverage.start,
        endTime: slot?.endTime.split('T')[1]?.slice(0, 8) ?? draft.coverage.end,
        status,
        blockerKind,
        matchedCandidateCount: matches.length,
        expectedSequenceNo: historyMatchResult.expectedSequenceNo,
        historyReferenceDate: historyMatchResult.referenceDate,
        historyContextSummary: historyMatchResult.summary,
        reasons,
      }
    })

    return {
      ok: !segments.some((segment) => segment.status === 'blocked'),
      summary: {
        readyCount: segments.filter((segment) => segment.status === 'ready').length,
        warningCount: segments.filter((segment) => segment.status === 'warning').length,
        blockedCount: segments.filter((segment) => segment.status === 'blocked').length,
      },
      segments,
    }
  }

  private filterHistorySequenceMatches(
    candidates: typeof orchestrationDemoCandidates,
    column: LayoutDraft['columns'][number],
    existingItems: ScheduleItemSnapshot[],
    historyReference?: HistoryReference,
  ): { candidates: typeof orchestrationDemoCandidates; expectedSequenceNo?: number; referenceDate?: string; summary?: string } {
    const isSequential = Boolean(column.isSequential || column.selectionPolicy?.primary === 'sequence' || column.selectionPolicy?.requiresPreviousSchedule)
    if (!isSequential || !historyReference?.schedules.length || candidates.length === 0) {
      return { candidates }
    }

    const rankedProgress = candidates
      .map((candidate) => {
        const seriesKey = this.buildSeriesKey(candidate)
        if (!seriesKey) return null
        const currentScheduleHasSeries = existingItems.some((item) => this.buildSeriesKey(item) === seriesKey)
        if (currentScheduleHasSeries) return null
        const progress = this.resolveHistoryProgress(seriesKey, historyReference)
        if (!progress) return null
        return {
          candidate,
          ...progress,
          sequenceNo: this.extractSequenceNo(candidate),
        }
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item))

    if (rankedProgress.length === 0) {
      return { candidates }
    }

    const highestProgress = rankedProgress
      .map((item) => ({ sequenceNo: item.latestSequenceNo, expectedSequenceNo: item.latestSequenceNo + 1, date: item.date }))
      .sort((left, right) => right.sequenceNo - left.sequenceNo)[0]!
    const expectedSequenceNo = highestProgress.expectedSequenceNo
    const constrained = rankedProgress
      .filter((item) => item.latestSequenceNo + 1 === expectedSequenceNo && item.sequenceNo === expectedSequenceNo)
      .map((item) => item.candidate)

    return {
      candidates: constrained,
      expectedSequenceNo,
      referenceDate: highestProgress.date,
      summary: `已读取 ${highestProgress.date} 编排记录：同系列已播到第${highestProgress.sequenceNo}集，本段预计接第${expectedSequenceNo}集。`,
    }
  }

  private filterScheduleContextMatches(
    candidates: typeof orchestrationDemoCandidates,
    column: LayoutDraft['columns'][number],
    slot: LayoutDraft['layoutReference']['slots'][number] | undefined,
    existingItems: ScheduleItemSnapshot[],
  ): typeof orchestrationDemoCandidates {
    if (!slot || existingItems.length === 0) return candidates
    const isSequential = Boolean(column.isSequential || column.selectionPolicy?.primary === 'sequence' || column.selectionPolicy?.requiresPreviousSchedule)
    if (!isSequential) return candidates

    return candidates.filter((candidate) => {
      const violation = detectMovingItemSequenceViolation({
        id: `draft-preview-${candidate.id}`,
        programCode: candidate.programCode,
        programName: candidate.programName,
        startTime: slot.startTime,
        endTime: slot.endTime,
        duration: candidate.duration,
        programType: candidate.programType,
        sequence: 0,
      }, existingItems, '草案预检')
      return !violation
    })
  }

  private matchesCandidateKeywords(candidate: (typeof orchestrationDemoCandidates)[number], hints: string[]): boolean {
    const haystack = [
      candidate.programName,
      candidate.instanceName,
      candidate.programCode,
      candidate.issueNo,
      candidate.columnName,
      candidate.columnId,
      ...(candidate.contentTags ?? []),
    ].filter(Boolean).join(' ')

    if (!matchesExplicitSequenceRequirements(haystack, hints)) {
      return false
    }
    if (!matchesEditorialKeywordRequirementsByFields({
      column: [candidate.columnName, candidate.columnId].filter(Boolean).join(' '),
      title: [candidate.programName, candidate.instanceName].filter(Boolean).join(' '),
      content: [
        candidate.programName,
        candidate.instanceName,
        ...(candidate.contentTags ?? []),
      ].filter(Boolean).join(' '),
      all: haystack,
    }, hints)) {
      return false
    }

    const specificRequired = hasSpecificSearchKeywords(hints)
    const functionalRequired = hasFunctionalSearchKeywords(hints)
    if (specificRequired || functionalRequired) {
      return (!specificRequired || matchesSpecificSearchKeywords(haystack, hints))
        && (!functionalRequired || matchesFunctionalSearchKeywords(haystack, hints))
    }

    if (extractEditorialKeywordRequirements(hints).length > 0) {
      return true
    }

    const normalizedHaystack = normalizeCandidateKeyword(haystack)
    const softKeywords = extractSoftSearchKeywords(hints)
    return softKeywords.length === 0 || softKeywords.some((keyword) => normalizedHaystack.includes(keyword))
  }

  private getSlotDurationSeconds(slot: LayoutDraft['layoutReference']['slots'][number] | undefined): number | null {
    if (!slot) return null
    const start = new Date(slot.startTime).getTime()
    const end = new Date(slot.endTime).getTime()
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null
    return Math.floor((end - start) / 1000)
  }

  private resolveBlockerKind(
    typeMatchedCount: number,
    durationMatchedCount: number,
    hasHardHints: boolean,
    scheduleContextRejected: boolean,
  ): DraftFeasibilitySegmentReport['blockerKind'] {
    if (scheduleContextRejected) return 'schedule_context'
    if (typeMatchedCount === 0) return 'program_type'
    if (durationMatchedCount === 0) return 'duration'
    return hasHardHints ? 'keyword' : 'program_type'
  }

  private buildReasons(input: {
    matchCount: number
    typeMatchedCount: number
    durationMatchedCount: number
    hasHardHints: boolean
    hintCount: number
    scheduleContextRejected: boolean
    historyContextSummary?: string
  }): string[] {
    const reasons: string[] = []

    if (input.matchCount === 0) {
      if (input.scheduleContextRejected) {
        reasons.push('当前表内已有同系列顺播节目，候选会造成倒序或跳集，正式编排时应保留空缺并转人工确认。')
      } else if (input.typeMatchedCount === 0) {
        reasons.push('当前频道下未找到可用于该栏目类型的候选节目。')
      } else if (input.durationMatchedCount === 0) {
        reasons.push('当前时段时长无法容纳该栏目类型的候选节目，正式编排时应保留空缺并中止自动填充。')
      } else {
        reasons.push(input.hasHardHints
          ? '明确关键词没有命中节目库，正式编排时应保留空缺并中止自动填充。'
          : '当前频道下未找到可用于该栏目语义的候选节目。')
      }
    } else if (input.matchCount < 2) {
      if (input.historyContextSummary) reasons.push(input.historyContextSummary)
      reasons.push('可选候选较少，正式编排时可能需要人工确认。')
    } else {
      if (input.historyContextSummary) reasons.push(input.historyContextSummary)
      reasons.push('已有足够候选可支持后续编排。')
    }

    if (input.matchCount === 0 && input.historyContextSummary) {
      reasons.push(input.historyContextSummary)
    }

    if (input.hintCount === 0) {
      reasons.push('当前栏目主要依赖节目类型匹配，建议补充语义关键词提升精度。')
    }

    return reasons
  }

  private resolveHistoryProgress(seriesKey: string, historyReference: HistoryReference): { latestSequenceNo: number; date: string } | null {
    let latest: { latestSequenceNo: number; date: string } | null = null
    for (const schedule of historyReference.schedules) {
      for (const item of schedule.items ?? []) {
        if (this.buildSeriesKey(item) !== seriesKey) continue
        const sequenceNo = this.extractSequenceNo(item)
        if (typeof sequenceNo !== 'number') continue
        if (!latest || sequenceNo > latest.latestSequenceNo) {
          latest = { latestSequenceNo: sequenceNo, date: schedule.date }
        }
      }
    }
    return latest
  }

  private buildSeriesKey(item: ProgramCandidate | ScheduleItemSnapshot): string {
    const name = this.normalizeSeriesName(item.programName)
    if (name) return `name:${name}`
    return item.programCode ? `code:${item.programCode.replace(/\d{1,4}$/, '')}` : ''
  }

  private normalizeSeriesName(programName?: string): string {
    if (!programName) return ''
    return programName
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '')
      .replace(/^[^:：]+[:：]/u, '')
      .replace(/第\s*[0-9零〇一二两三四五六七八九十百]+\s*[集期]/gu, '')
      .replace(/[上中下][集期]/gu, '')
      .replace(/[《》“”"'（）()[\]·、。；;:：,\-—]/g, '')
  }

  private extractSequenceNo(item: ProgramCandidate | ScheduleItemSnapshot): number | null {
    const issueNo = 'issueNo' in item && typeof item.issueNo === 'string'
      ? this.parsePositiveNumber(item.issueNo)
      : null
    if (issueNo !== null) return issueNo

    const codeMatch = item.programCode?.match(/(\d{1,4})$/)
    if (codeMatch) {
      const parsed = Number(codeMatch[1])
      if (Number.isFinite(parsed) && parsed > 0) return parsed
    }

    const nameMatch = item.programName?.match(/第\s*([0-9零〇一二两三四五六七八九十百]+)\s*[集期]/u)
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
}

let globalLayoutDraftFeasibilityService: LayoutDraftFeasibilityService | null = null

export function getLayoutDraftFeasibilityService(): LayoutDraftFeasibilityService {
  if (!globalLayoutDraftFeasibilityService) {
    globalLayoutDraftFeasibilityService = new LayoutDraftFeasibilityService()
  }
  return globalLayoutDraftFeasibilityService
}
