import type { ScheduleItemSnapshot } from '@/types/orchestration'
import type { AgentProgramCandidate, AgentTvSequenceEvidence, SchedulingContext } from './types'

export interface AgentTvSequenceSelection {
  candidate: AgentProgramCandidate | null
  candidateOptions?: AgentProgramCandidate[]
  diagnostics: {
    source: 'today' | 'history' | 'none'
    expectedSequence?: number
    selectedSequence?: number
    seriesKey?: string
    candidateOptionIds?: string[]
    reason: string
  }
}

interface SequenceFact {
  seriesKeys: string[]
  sequence: number
}

interface RankedCandidate {
  candidate: AgentProgramCandidate
  index: number
  sequence: number
  seriesKey: string
  expectedSequence: number
  distance: number
  source: 'today' | 'history'
  score: number
  reason: string
}

interface ExactContinuationChoice {
  item: RankedCandidate
  score: number
}

const chineseNumberChars = '0-9\\u96f6\\u3007\\u4e00\\u4e8c\\u4e24\\u4e09\\u56db\\u4e94\\u516d\\u4e03\\u516b\\u4e5d\\u5341\\u767e'
const chineseEpisodePattern = new RegExp(`\\u7b2c\\s*([${chineseNumberChars}]+)\\s*[\\u96c6\\u671f]`, 'u')
const chineseEpisodePatternGlobal = new RegExp(`\\u7b2c\\s*([${chineseNumberChars}]+)\\s*[\\u96c6\\u671f]`, 'gu')
const chineseEpisodeOnlyPattern = new RegExp(`\\u7b2c\\s*([${chineseNumberChars}]+)\\s*\\u96c6`, 'u')
const chineseDirectionalEpisodePattern = /[\u4e0a\u4e2d\u4e0b][\u96c6\u671f]/gu
const chineseReadablePunctuationPattern = /[\u300a\u300b"'"\u201c\u201d\u2018\u2019\uff08\uff09()[\]\u3001\uff0c\u3002\uff1b;:\uff1a\u00b7\-_\u2014/\\|~\uff5e]/g

export class AgentTvSequenceCandidateSelector {
  selectBestCandidate(context: SchedulingContext, candidates: AgentProgramCandidate[]): AgentTvSequenceSelection {
    if (context.bundle.identity.playlistType !== 'tv') {
      return {
        candidate: null,
        diagnostics: {
          source: 'none',
          reason: '顺播选择只适用于电视播单。',
        },
      }
    }

    const todayFacts = this.collectFacts(context.bundle.today.scheduleItems)
    const historyFacts = this.collectFacts(context.bundle.history.latestSchedule?.items ?? [])
    const ranked = candidates
      .map((candidate, index) => this.rankCandidate(candidate, index, todayFacts, historyFacts))
      .filter((item): item is RankedCandidate => Boolean(item))
      .sort((left, right) =>
        right.score - left.score
        || left.distance - right.distance
        || left.index - right.index,
      )
    const exact = ranked.find((item) => item.sequence === item.expectedSequence)
    const exactMatches = ranked.filter((item) => item.sequence === item.expectedSequence)

    if (exactMatches.length > 1) {
      const disambiguated = this.selectUniqueExactContinuationCandidate(context, exactMatches)
      if (disambiguated) {
        const best = disambiguated.item
        return {
          candidate: best.candidate,
          diagnostics: {
            source: best.source,
            expectedSequence: best.expectedSequence,
            selectedSequence: best.sequence,
            seriesKey: best.seriesKey,
            candidateOptionIds: exactMatches.map((item) => item.candidate.id),
            reason: '多个候选都命中下一集，已根据当前播单连续性、频道和节目编号前缀选择最贴合的一条。',
          },
        }
      }

      const first = exactMatches[0]!
      return {
        candidate: null,
        candidateOptions: exactMatches.map((item) => item.candidate),
        diagnostics: {
          source: first.source,
          expectedSequence: first.expectedSequence,
          selectedSequence: first.sequence,
          seriesKey: first.seriesKey,
          candidateOptionIds: exactMatches.map((item) => item.candidate.id),
          reason: '多个候选都符合下一集证据，写入前需要编排人员确认具体节目。',
        },
      }
    }

    if (!exact) {
      const nearest = ranked[0]
      if (nearest) {
        return {
          candidate: null,
          diagnostics: {
            source: nearest.source,
            expectedSequence: nearest.expectedSequence,
            selectedSequence: nearest.sequence,
            seriesKey: nearest.seriesKey,
            reason: '已有顺播证据，但候选库里没有期望的下一集，因此不能跳集。',
          },
        }
      }

      const sequentialCandidates = candidates.filter((candidate) => this.hasExplicitSequenceEvidence(candidate))
      if (sequentialCandidates.length > 0) {
        return {
          candidate: null,
          diagnostics: {
            source: 'none',
            candidateOptionIds: sequentialCandidates.map((candidate) => candidate.id),
            reason: '候选库里有顺播节目，但今天和最近历史都没有同系列基线，暂不能自行判断下一集。',
          },
        }
      }
    }

    const best = exact
    if (!best || best.score <= 0) {
      return {
        candidate: null,
        diagnostics: {
          source: 'none',
          reason: '今天和历史播出记录里都没有匹配到可用于顺播判断的候选证据。',
        },
      }
    }

    return {
      candidate: best.candidate,
      diagnostics: {
        source: best.source,
        expectedSequence: best.expectedSequence,
        selectedSequence: best.sequence,
        seriesKey: best.seriesKey,
        reason: best.reason,
      },
    }
  }

  /**
   * 提取 TV 顺播证据（不做候选决策）
   * 遍历候选中的系列键，匹配今天/历史编排基线，返回期望下一集期数等信息
   * 用于透传给 LLM 候选决策器，让 LLM 看到顺播上下文
   */
  buildEvidence(context: SchedulingContext, candidates: AgentProgramCandidate[]): AgentTvSequenceEvidence {
    if (context.bundle.identity.playlistType !== 'tv') {
      return { playlistType: context.bundle.identity.playlistType, source: 'none', hasBaseline: false }
    }
    const todayFacts = this.collectFacts(context.bundle.today.scheduleItems)
    const historyFacts = this.collectFacts(context.bundle.history.latestSchedule?.items ?? [])

    for (const candidate of candidates) {
      if (!this.hasExplicitSequenceEvidence(candidate)) continue
      const seriesKeys = this.buildSeriesKeys(candidate)
      if (seriesKeys.length === 0) continue

      const todayMax = this.resolveMaxSequence(todayFacts, seriesKeys)
      if (todayMax) {
        return {
          playlistType: 'tv',
          expectedSequence: todayMax.sequence + 1,
          seriesKey: todayMax.seriesKey,
          source: 'today',
          todayMaxSequence: todayMax.sequence,
          hasBaseline: true,
        }
      }

      const historyMax = this.resolveMaxSequence(historyFacts, seriesKeys)
      if (historyMax) {
        return {
          playlistType: 'tv',
          expectedSequence: historyMax.sequence + 1,
          seriesKey: historyMax.seriesKey,
          source: 'history',
          historyMaxSequence: historyMax.sequence,
          hasBaseline: true,
        }
      }
    }

    return { playlistType: 'tv', source: 'none', hasBaseline: false }
  }

  /**
   * 后置校验：LLM 选择的候选是否符合顺播硬约束（C17：不能跳集/倒序/重复）
   * 返回违规原因字符串，或 null 表示校验通过
   */
  validateCandidateAgainstSequence(
    candidate: AgentProgramCandidate,
    evidence: AgentTvSequenceEvidence,
  ): string | null {
    if (evidence.playlistType !== 'tv' || !evidence.hasBaseline) return null
    if (typeof evidence.expectedSequence !== 'number') return null
    const candidateSequence = this.extractSequence(candidate)
    if (typeof candidateSequence !== 'number') return null
    if (candidateSequence < evidence.expectedSequence) return '候选期数小于期望下一集（倒序）'
    if (candidateSequence > evidence.expectedSequence) return '候选期数大于期望下一集（跳集）'
    return null
  }

  private rankCandidate(
    candidate: AgentProgramCandidate,
    index: number,
    todayFacts: SequenceFact[],
    historyFacts: SequenceFact[],
  ): RankedCandidate | null {
    if (!this.hasExplicitSequenceEvidence(candidate)) return null
    const sequence = this.extractSequence(candidate)
    const seriesKeys = this.buildSeriesKeys(candidate)
    if (seriesKeys.length === 0 || typeof sequence !== 'number') return null

    const todayMax = this.resolveMaxSequence(todayFacts, seriesKeys)
    if (todayMax) {
      const expectedSequence = todayMax.sequence + 1
      const distance = Math.abs(sequence - expectedSequence)
      return {
        candidate,
        index,
        sequence,
        seriesKey: todayMax.seriesKey,
        expectedSequence,
        distance,
        source: 'today',
        score: sequence === expectedSequence ? 300 : Math.max(0, 180 - distance * 30),
        reason: 'Today schedule has the same series, so today overrides history.',
      }
    }

    const historyMax = this.resolveMaxSequence(historyFacts, seriesKeys)
    if (historyMax) {
      const expectedSequence = historyMax.sequence + 1
      const distance = Math.abs(sequence - expectedSequence)
      return {
        candidate,
        index,
        sequence,
        seriesKey: historyMax.seriesKey,
        expectedSequence,
        distance,
        source: 'history',
        score: sequence === expectedSequence ? 200 : Math.max(0, 100 - distance * 20),
        reason: 'No same-series item exists today, so latest history provides the sequence baseline.',
      }
    }

    return null
  }

  private selectUniqueExactContinuationCandidate(
    context: SchedulingContext,
    matches: RankedCandidate[],
  ): ExactContinuationChoice | null {
    const choices = matches
      .map((item) => ({
        item,
        score: this.scoreExactContinuationCandidate(context, item.candidate),
      }))
      .sort((left, right) =>
        right.score - left.score
        || left.item.index - right.item.index,
      )

    const best = choices[0]
    const second = choices[1]
    if (!best || best.score <= 0) return null
    if (second && second.score === best.score) return null
    return best
  }

  private scoreExactContinuationCandidate(context: SchedulingContext, candidate: AgentProgramCandidate): number {
    const todayItems = context.bundle.today.scheduleItems
    const historyItems = context.bundle.history.latestSchedule?.items ?? []
    const referenceItems = todayItems.length > 0 ? todayItems : historyItems
    let score = 0

    if (candidate.channelId && candidate.channelId === context.bundle.identity.channelId) score += 100
    if (referenceItems.some((item) => item.programId && item.programId === candidate.programId)) score += 90
    if (referenceItems.some((item) => this.normalizeProgramCodePrefix(item.programCode) === this.normalizeProgramCodePrefix(candidate.programCode))) score += 80
    if (referenceItems.some((item) => item.columnId && candidate.columnId && item.columnId === candidate.columnId)) score += 50
    if (candidate.programCode && !candidate.programCode.startsWith('88')) score += 10

    return score
  }

  private hasExplicitSequenceEvidence(candidate: AgentProgramCandidate): boolean {
    if (typeof this.extractSequence(candidate) !== 'number') return false
    const label = `${candidate.programName ?? ''} ${candidate.instanceName ?? ''}`.toLowerCase()
    if (/\b(ep|episode)\.?\s*\d{1,4}\b/u.test(label) || chineseEpisodeOnlyPattern.test(label)) return true
    if (!this.isSequentialProgramType(candidate.programType)) return false
    if (this.parsePositiveNumber(candidate.issueNo) !== undefined) return true
    if (chineseEpisodePattern.test(label)) return true
    const explicitSequence = (candidate as AgentProgramCandidate & { sequence?: unknown }).sequence
    if (typeof explicitSequence === 'number' && Number.isFinite(explicitSequence) && explicitSequence > 0) return true
    return Boolean(candidate.programCode?.match(/(\d{1,4})$/))
  }

  private collectFacts(items: ScheduleItemSnapshot[]): SequenceFact[] {
    return items
      .map((item) => {
        if (!this.hasScheduleSequenceEvidence(item)) return null
        const seriesKeys = this.buildSeriesKeys(item)
        const sequence = this.extractSequence(item)
        if (seriesKeys.length === 0 || typeof sequence !== 'number') return null
        return { seriesKeys, sequence }
      })
      .filter((item): item is SequenceFact => Boolean(item))
  }

  private hasScheduleSequenceEvidence(item: ScheduleItemSnapshot): boolean {
    const label = `${item.programName ?? ''} ${item.instanceName ?? ''}`.toLowerCase()
    if (/\b(ep|episode)\.?\s*\d{1,4}\b/u.test(label) || chineseEpisodeOnlyPattern.test(label)) return true
    if (!this.isSequentialProgramType(item.programType)) return false
    if (chineseEpisodePattern.test(label)) return true
    return typeof item.sequence === 'number'
      || this.parsePositiveNumber(item.issueNo) !== undefined
      || Boolean(item.programCode?.match(/(\d{1,4})$/))
  }

  private isSequentialProgramType(programType?: string): boolean {
    if (!programType) return false
    const normalized = programType.trim().toLowerCase()
    return [
      'drama',
      'series',
      'tv_series',
      'cartoon',
      'animation',
      'documentary_series',
      'kids_series',
    ].includes(normalized)
  }

  private resolveMaxSequence(facts: SequenceFact[], seriesKeys: string[]): { sequence: number, seriesKey: string } | undefined {
    const matches = facts
      .map((fact) => {
        const seriesKey = seriesKeys.find((key) => fact.seriesKeys.includes(key))
        return seriesKey ? { seriesKey, sequence: fact.sequence } : null
      })
      .filter((fact): fact is { sequence: number, seriesKey: string } => Boolean(fact))
    if (matches.length === 0) return undefined
    return matches.reduce((best, fact) => fact.sequence > best.sequence ? fact : best)
  }

  private buildSeriesKeys(item: Pick<ScheduleItemSnapshot, 'programId' | 'programName' | 'programCode' | 'instanceName'>): string[] {
    const keys: string[] = []
    if (item.programId) keys.push(`program:${item.programId}`)
    const normalizedName = this.normalizeSeriesName(item.programName || item.instanceName)
    if (normalizedName) keys.push(`name:${normalizedName}`)
    const codePrefix = this.normalizeProgramCodePrefix(item.programCode)
    if (codePrefix) keys.push(`code:${codePrefix}`)
    return Array.from(new Set(keys))
  }

  private normalizeSeriesName(value?: string): string {
    if (!value) return ''
    return value
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '')
      .replace(/^[^:\uff1a]+[:\uff1a]/u, '')
      .replace(chineseEpisodePatternGlobal, '')
      .replace(/\b(ep|episode)\.?\s*\d{1,4}\b/giu, '')
      .replace(chineseDirectionalEpisodePattern, '')
      .replace(chineseReadablePunctuationPattern, '')
  }

  private normalizeProgramCodePrefix(programCode?: string): string {
    if (!programCode) return ''
    const normalized = programCode.trim().toLowerCase()
    const numericPrefix = normalized.match(/^(\d{4,})\d{1,4}$/)
    return numericPrefix?.[1] ?? ''
  }

  private extractSequence(item: Pick<ScheduleItemSnapshot, 'programCode' | 'programName' | 'instanceName'> & { issueNo?: string }): number | undefined {
    const issueNo = this.parsePositiveNumber(item.issueNo)
    if (typeof issueNo === 'number') return issueNo

    const nameSequence = this.extractSequenceFromName(item.programName || item.instanceName)
    if (typeof nameSequence === 'number') return nameSequence

    const codeMatch = item.programCode?.match(/(\d{1,4})$/)
    if (codeMatch) {
      const parsed = Number(codeMatch[1])
      if (Number.isFinite(parsed) && parsed > 0) return parsed
    }

    return undefined
  }

  private extractSequenceFromName(value?: string): number | undefined {
    if (!value) return undefined
    const match = value.match(chineseEpisodePattern)
    if (match) return this.parseChineseNumber(match[1]!)
    const englishMatch = value.match(/\b(?:ep|episode)\.?\s*(\d{1,4})\b/iu)
    if (englishMatch) return this.parseChineseNumber(englishMatch[1]!)
    if (value.includes('\u4e0a\u96c6') || value.includes('\u4e0a\u671f')) return 1
    if (value.includes('\u4e2d\u96c6') || value.includes('\u4e2d\u671f')) return 2
    if (value.includes('\u4e0b\u96c6') || value.includes('\u4e0b\u671f')) return 3
    return undefined
  }

  private parsePositiveNumber(value?: string): number | undefined {
    if (!value) return undefined
    const parsed = Number(value)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
  }

  private parseChineseNumber(value: string): number | undefined {
    const normalized = value.trim()
    const direct = Number(normalized)
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
    const chars = Array.from(normalized)
    if (chars.every((char) => digits[char] !== undefined)) {
      const parsed = chars.reduce((sum, char) => sum * 10 + digits[char]!, 0)
      return parsed > 0 ? parsed : undefined
    }

    let total = 0
    let current = 0
    for (const char of chars) {
      if (digits[char] !== undefined) {
        current = digits[char]!
        continue
      }
      if (char === '\u5341') {
        total += (current || 1) * 10
        current = 0
        continue
      }
      if (char === '\u767e') {
        total += (current || 1) * 100
        current = 0
        continue
      }
      return undefined
    }

    const parsed = total + current
    return parsed > 0 ? parsed : undefined
  }
}
