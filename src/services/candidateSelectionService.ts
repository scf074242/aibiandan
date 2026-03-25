import type { GapInfo, ProgramCandidate } from '@/types/orchestration'
import type { LLMClient } from './llm/llmClient'
import type { DialogueContext } from './dialogueContext'
import type { GapPlanningThought } from './orchestrationStrategyService'
import { buildGapCandidateSelectionPrompt, buildInsertCandidateSelectionPrompt } from './orchestrationPromptBuilder'
import type { InsertParams } from './paramExtractor'

export interface CandidateSelectionResult {
  selectedCandidate: ProgramCandidate
  reasoning: string
}

export class CandidateSelectionService {
  constructor(private llmClient: LLMClient) {}

  async selectForInsert(
    context: DialogueContext,
    params: InsertParams,
    candidates: ProgramCandidate[],
  ): Promise<CandidateSelectionResult> {
    if (candidates.length === 1) {
      return {
        selectedCandidate: candidates[0]!,
        reasoning: '候选列表中只有一个匹配节目，直接采用该节目。',
      }
    }

    try {
      const response = await this.llmClient.chat(
        buildInsertCandidateSelectionPrompt(context, params, candidates),
        { temperature: 0.1, maxTokens: 240 },
      )

      const selected = this.parseSelection(response.content, candidates)
      if (selected) return selected
    } catch {
      // Fall through to deterministic selection.
    }

    return this.selectFallback(candidates, params.programName)
  }

  async selectForGap(
    gap: GapInfo,
    channelName: string,
    date: string,
    candidates: ProgramCandidate[],
    planningThought?: GapPlanningThought,
  ): Promise<CandidateSelectionResult> {
    if (candidates.length === 1) {
      return {
        selectedCandidate: candidates[0]!,
        reasoning: '候选列表中只有一个可用节目，直接采用该节目。',
      }
    }

    try {
      const response = await this.llmClient.chat(
        buildGapCandidateSelectionPrompt({
          channelName,
          date,
          gap,
          candidates,
          planningThought,
        }),
        { temperature: 0.1, maxTokens: 260 },
      )

      const selected = this.parseSelection(response.content, candidates)
      if (selected) return selected
    } catch {
      // Fall through to deterministic selection.
    }

    const fallback = [...candidates].sort((left, right) => {
      const leftScore = this.scoreCandidateForGap(left, gap, planningThought)
      const rightScore = this.scoreCandidateForGap(right, gap, planningThought)
      return rightScore - leftScore
    })[0]

    return {
      selectedCandidate: fallback!,
      reasoning: '按时长匹配度、类型偏好、关键词匹配度和评分进行保守选择。',
    }
  }

  private parseSelection(content: string, candidates: ProgramCandidate[]): CandidateSelectionResult | null {
    const match = content.match(/\{[\s\S]*\}/)
    if (!match) return null

    try {
      const parsed = JSON.parse(match[0]) as { selectedCandidateId?: string; reasoning?: string }
      const selectedCandidate = candidates.find((candidate) => candidate.id === parsed.selectedCandidateId)
      if (!selectedCandidate) return null
      return {
        selectedCandidate,
        reasoning: parsed.reasoning || 'LLM 已从候选列表中选择最匹配节目。',
      }
    } catch {
      return null
    }
  }

  private selectFallback(candidates: ProgramCandidate[], targetName: string): CandidateSelectionResult {
    const fallback = [...candidates].sort((left, right) => {
      const leftScore = this.scoreCandidateForName(left, targetName)
      const rightScore = this.scoreCandidateForName(right, targetName)
      return rightScore - leftScore
    })[0]

    return {
      selectedCandidate: fallback!,
      reasoning: '按节目名匹配度和评分进行保守选择。',
    }
  }

  private scoreCandidateForName(candidate: ProgramCandidate, targetName: string): number {
    const normalizedTarget = targetName.trim().toLowerCase()
    const normalizedName = candidate.programName.trim().toLowerCase()
    const exactMatch = normalizedName === normalizedTarget ? 100 : 0
    const prefixMatch = normalizedName.startsWith(normalizedTarget) ? 30 : 0
    const containsMatch = normalizedName.includes(normalizedTarget) ? 20 : 0
    return exactMatch + prefixMatch + containsMatch + (candidate.rating ?? 0)
  }

  private scoreCandidateForGap(
    candidate: ProgramCandidate,
    gap: GapInfo,
    planningThought?: GapPlanningThought,
  ): number {
    const durationScore = 100 - Math.abs(candidate.duration - gap.duration) / 60
    const ratingScore = (candidate.rating ?? 0) * 10
    const typeScore = planningThought?.targetProgramTypes?.includes(candidate.programType) ? 25 : 0
    const keywordScore = (planningThought?.searchKeywords ?? []).reduce((score, keyword) => {
      const haystack = `${candidate.programName} ${(candidate.tags ?? []).join(' ')}`.toLowerCase()
      return haystack.includes(keyword.toLowerCase()) ? score + 8 : score
    }, 0)
    return durationScore + ratingScore + typeScore + keywordScore
  }
}

let globalCandidateSelectionService: CandidateSelectionService | null = null

export function getCandidateSelectionService(llmClient: LLMClient): CandidateSelectionService {
  if (!globalCandidateSelectionService) {
    globalCandidateSelectionService = new CandidateSelectionService(llmClient)
  }
  return globalCandidateSelectionService
}
