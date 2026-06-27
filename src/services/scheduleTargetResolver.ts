import type { LLMClient } from './llm/llmClient'

export interface ScheduleTargetCandidate {
  id: string
  programCode?: string
  programName?: string
  startTime: string
  endTime: string
  duration?: number
  programType?: string
}

export interface ScheduleTargetResolverInput {
  userInput: string
  action: 'delete' | 'move' | 'replace'
  channelName: string
  date: string
  targetTime: string
  programName?: string
  items: ScheduleTargetCandidate[]
}

export interface ScheduleTargetResolverResult {
  status: 'none' | 'unique' | 'multiple'
  candidates: ScheduleTargetCandidate[]
  selectedItem?: ScheduleTargetCandidate
  reasoning: string
  matchedBy: string[]
}

export class ScheduleTargetResolver {
  constructor(private llmClient: LLMClient) {}

  async resolve(input: ScheduleTargetResolverInput): Promise<ScheduleTargetResolverResult> {
    const narrowed = collectCandidatePool(input.items, input.targetTime)
    if (narrowed.length === 0) {
      return {
        status: 'none',
        candidates: [],
        reasoning: `未找到 ${input.targetTime} 附近的候选节目。`,
        matchedBy: ['time_window'],
      }
    }

    if (!input.programName && narrowed.length === 1) {
      return {
        status: 'unique',
        candidates: narrowed,
        selectedItem: narrowed[0],
        reasoning: '目标时间附近只有唯一候选节目，直接定位。 ',
        matchedBy: ['time_window'],
      }
    }

    const llmResult = await this.pickWithLLM(input, narrowed)
    if (!llmResult) {
      return this.resolveLocally(input, narrowed)
    }

    const selected = narrowed.find((item) => item.id === llmResult.targetItemId)
    if (!selected) {
      return this.resolveLocally(input, narrowed)
    }

    if (!passesLocalSafetyCheck(selected, input)) {
      const safeCandidates = narrowed.filter((candidate) => passesLocalSafetyCheck(candidate, input))
      if (safeCandidates.length === 1) {
        return {
          status: 'unique',
          candidates: safeCandidates,
          selectedItem: safeCandidates[0],
          reasoning: 'LLM 已给出候选，但最终由本地安全校验收敛为唯一可执行节目。',
          matchedBy: ['llm_nomination', 'local_safety'],
        }
      }

      return {
        status: safeCandidates.length > 1 ? 'multiple' : 'none',
        candidates: safeCandidates,
        reasoning: 'LLM 提名结果未通过本地安全校验，已拒绝直接执行。',
        matchedBy: ['llm_nomination', 'local_safety'],
      }
    }

    return {
      status: 'unique',
      candidates: narrowed,
      selectedItem: selected,
      reasoning: llmResult.reasoning || '已结合用户语义和当前编单候选定位目标节目。',
      matchedBy: ['llm_nomination', 'local_safety'],
    }
  }

  private resolveLocally(
    input: ScheduleTargetResolverInput,
    narrowed: ScheduleTargetCandidate[],
  ): ScheduleTargetResolverResult {
    const safeCandidates = narrowed.filter((candidate) => passesLocalSafetyCheck(candidate, input))

    if (safeCandidates.length === 1) {
      return {
        status: 'unique',
        candidates: safeCandidates,
        selectedItem: safeCandidates[0],
        reasoning: '已根据当前编单时间窗口和节目名称唯一定位目标节目。',
        matchedBy: ['time_window', 'name_match'],
      }
    }

    return {
      status: safeCandidates.length > 1 ? 'multiple' : 'none',
      candidates: safeCandidates,
      reasoning:
        safeCandidates.length > 1
          ? '当前时间附近存在多个可疑候选，暂不自动执行。'
          : '当前时间附近没有通过名称校验的候选节目。',
      matchedBy: ['time_window', 'name_match'],
    }
  }

  private async pickWithLLM(
    input: ScheduleTargetResolverInput,
    candidates: ScheduleTargetCandidate[],
  ): Promise<{ targetItemId?: string; reasoning?: string } | null> {
    try {
      const response = await this.llmClient.chat(
        [
          {
            role: 'system',
            content:
              '你是广播节目串联单目标记录定位器。请结合用户指令，在候选记录中判断用户最可能指向哪一条。只能返回 JSON，不要创造候选列表里不存在的 id。',
          },
          {
            role: 'user',
            content:
              `动作: ${input.action}\n` +
              `用户指令: ${input.userInput}\n` +
              `频道: ${input.channelName}\n` +
              `日期: ${input.date}\n` +
              `目标时间: ${input.targetTime}\n` +
              `节目名线索: ${input.programName || '未明确提供'}\n` +
              `候选记录:\n${formatCandidates(candidates)}\n` +
              '输出格式: {"status":"unique","targetItemId":"item_1","reasoning":"..."}。如果无法唯一判断，则返回 {"status":"multiple","reasoning":"..."} 或 {"status":"none","reasoning":"..."}。',
          },
        ],
        { temperature: 0, maxTokens: 220 },
      )

      const match = response.content.match(/\{[\s\S]*\}/)
      if (!match) return null
      const parsed = JSON.parse(match[0]) as {
        status?: 'none' | 'unique' | 'multiple'
        targetItemId?: string
        reasoning?: string
      }
      if (!parsed.status) return null
      if (parsed.status !== 'unique') {
        return { reasoning: parsed.reasoning }
      }

      return {
        targetItemId: parsed.targetItemId,
        reasoning: parsed.reasoning,
      }
    } catch {
      return null
    }
  }
}

function collectCandidatePool(
  items: ScheduleTargetCandidate[],
  targetTime: string,
): ScheduleTargetCandidate[] {
  const targetSeconds = timeToSeconds(targetTime)
  const exact = items.filter((item) => normalizeClock(item.startTime) === targetTime)
  if (exact.length > 0) {
    return exact
  }

  const covering = items.filter((item) => {
    const start = timeToSeconds(normalizeClock(item.startTime))
    const end = timeToSeconds(normalizeClock(item.endTime))
    return start <= targetSeconds && targetSeconds < end
  })
  if (covering.length > 0) {
    return covering
  }

  return []
}

function passesLocalSafetyCheck(candidate: ScheduleTargetCandidate, input: ScheduleTargetResolverInput): boolean {
  const targetSeconds = timeToSeconds(input.targetTime)
  const start = timeToSeconds(normalizeClock(candidate.startTime))
  const end = timeToSeconds(normalizeClock(candidate.endTime))
  const matchesTime =
    normalizeClock(candidate.startTime) === input.targetTime || (start <= targetSeconds && targetSeconds < end)

  if (!matchesTime) {
    return false
  }

  if (!input.programName?.trim()) {
    return true
  }

  const normalizedHint = normalizeName(input.programName)
  if (!normalizedHint) {
    return true
  }

  const normalizedCandidate = normalizeName(candidate.programName || candidate.programCode || '')
  return (
    normalizedCandidate.includes(normalizedHint)
    || normalizedHint.includes(normalizedCandidate)
    || normalizedCandidate === normalizedHint
  )
}

function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[《》"'“”‘’、，。！？!?:：()（）[\]【】\-_.]/g, '')
    .replace(/\s+/g, '')
    .replace(/节目|栏目|版$/g, '')
}

function formatCandidates(candidates: ScheduleTargetCandidate[]): string {
  return candidates
    .map(
      (item, index) =>
        `${index + 1}. id=${item.id}; time=${normalizeClock(item.startTime)}-${normalizeClock(item.endTime)}; name=${item.programName || item.programCode || item.id}; code=${item.programCode || '-'}`,
    )
    .join('\n')
}

function normalizeClock(timeText: string): string {
  if (timeText.includes('T')) {
    return timeText.split('T')[1]?.slice(0, 8) || timeText
  }
  return timeText.length === 5 ? `${timeText}:00` : timeText
}

function timeToSeconds(timeText: string): number {
  const [hours = 0, minutes = 0, seconds = 0] = normalizeClock(timeText).split(':').map(Number)
  return hours * 3600 + minutes * 60 + seconds
}

let globalScheduleTargetResolver: ScheduleTargetResolver | null = null

export function getScheduleTargetResolver(llmClient: LLMClient): ScheduleTargetResolver {
  if (!globalScheduleTargetResolver) {
    globalScheduleTargetResolver = new ScheduleTargetResolver(llmClient)
  }
  return globalScheduleTargetResolver
}
