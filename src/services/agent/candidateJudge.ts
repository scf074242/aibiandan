import type { AgentCandidateJudge, AgentCandidateJudgeInput, AgentProgramCandidate } from './types'

export class DefaultAgentCandidateJudge implements AgentCandidateJudge {
  async selectBestCandidate(input: AgentCandidateJudgeInput): Promise<AgentProgramCandidate | null> {
    const ranked = [...input.candidates].sort((left, right) =>
      this.scoreCandidate(right, input) - this.scoreCandidate(left, input),
    )
    return ranked[0] ?? null
  }

  private scoreCandidate(candidate: AgentProgramCandidate, input: AgentCandidateJudgeInput): number {
    const normalizedInput = this.normalize(input.userInput)
    const normalizedName = this.normalize(candidate.programName)
    const normalizedInstanceName = this.normalize(candidate.instanceName)
    const normalizedColumn = this.normalize([candidate.columnName, candidate.columnId].filter(Boolean).join(' '))
    const normalizedTags = this.normalize((candidate.contentTags ?? []).join(' '))
    let score = 0

    if (normalizedName && normalizedInput.includes(normalizedName)) score += 100
    if (normalizedInstanceName && normalizedInput.includes(normalizedInstanceName)) score += 70
    if (normalizedColumn && normalizedInput.includes(normalizedColumn)) score += 30
    if (normalizedTags && normalizedTags.split(/\s+/).some((tag) => tag && normalizedInput.includes(tag))) score += 20
    if (candidate.materialStatus === 'ready' || candidate.materialStatus === undefined) score += 10
    if (candidate.rightsStatus === 'ready' || candidate.rightsStatus === undefined) score += 10
    if (input.playlistType === 'rotation' && input.context.rotationStrategy === 'rating') {
      score += candidate.estimatedRating ?? 0
    }
    if (input.playlistType === 'rotation' && input.context.rotationStrategy === 'trending') {
      score += candidate.popularityScore ?? candidate.playCount ?? 0
    }
    score += input.professionalAssessments?.[candidate.id]?.totalScore ?? 0

    return score
  }

  private normalize(value: string): string {
    return value
      .trim()
      .toLowerCase()
      .replace(/[《》"'“”‘’、，。！？!?:：()（）[\]【】\-_.]/g, '')
  }
}
