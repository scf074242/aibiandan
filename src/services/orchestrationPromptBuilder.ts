import type { ChatMessage } from '@/types/llm'
import type { GapInfo, ProgramCandidate } from '@/types/orchestration'
import type { GapPlanningThought } from './orchestrationStrategyService'
import type { DialogueContext } from './dialogueContext'
import type { InsertParams } from './paramExtractor'

export interface QueryIntentPromptInput {
  channelName: string
  channelId: string
  date: string
  gap: GapInfo
  planningThought: GapPlanningThought
  userIntent?: string
}

export interface GapCandidateSelectionPromptInput {
  channelName: string
  date: string
  gap: GapInfo
  planningThought?: GapPlanningThought
  candidates: ProgramCandidate[]
}

export function buildQueryIntentPrompt(input: QueryIntentPromptInput): ChatMessage[] {
  return [
    {
      role: 'system',
      content:
        '你是广播电视节目串联单查询参数生成器。你的职责是根据频道、空窗和编排想法，生成候选节目检索参数。你不能直接决定插入哪个节目，也不能输出非 JSON 文本。新闻综合频道默认优先新闻、资讯、民生、评论类节目，除非用户明确要求其他类型。',
    },
    {
      role: 'user',
      content:
        `频道: ${input.channelName} (${input.channelId})\n` +
        `日期: ${input.date}\n` +
        `空窗: ${input.gap.startTime} - ${input.gap.endTime}\n` +
        `空窗时长: ${input.gap.duration} 秒\n` +
        `编排想法: ${input.planningThought.summary}\n` +
        `类型偏好: ${(input.planningThought.targetProgramTypes ?? []).join(', ') || '无'}\n` +
        `搜索关键词: ${(input.planningThought.searchKeywords ?? []).join(', ') || '无'}\n` +
        `期望时长: ${input.planningThought.durationPreference.min}-${input.planningThought.durationPreference.max} 秒\n` +
        `允许 filler: ${input.planningThought.allowFiller ? '是' : '否'}\n` +
        `顺排偏好: ${input.planningThought.sequentialPreference ? '是' : '否'}\n` +
        `${input.userIntent ? `用户额外要求: ${input.userIntent}\n` : ''}` +
        '请输出 QueryCandidatesCommand 的 data.criteria 部分，格式必须是 JSON：' +
        '{"targetTimeRange":{"start":"...","end":"..."},"expectedDuration":{"min":1200,"max":3600},"programTypePreference":["news"],"searchKeywords":["新闻"],"preferredChannelId":"news","sequentialPreference":true,"excludeUsed":true,"considerRatings":true,"allowShortFiller":false}',
    },
  ]
}

export function buildGapCandidateSelectionPrompt(input: GapCandidateSelectionPromptInput): ChatMessage[] {
  const candidateList = input.candidates
    .map(
      (candidate, index) =>
        `${index + 1}. id=${candidate.id}; name=${candidate.programName}; code=${candidate.programCode}; type=${candidate.programType}; duration=${candidate.duration}; rating=${candidate.rating ?? 0}; tags=${(candidate.tags ?? []).join('|')}`,
    )
    .join('\n')

  return [
    {
      role: 'system',
      content:
        '你是广播电视节目串联单候选选择器。你只能从给定候选列表中选择一个最适合当前空窗的节目，不得编造新节目，不得输出非 JSON 文本。',
    },
    {
      role: 'user',
      content:
        `频道: ${input.channelName}\n` +
        `日期: ${input.date}\n` +
        `空窗: ${input.gap.startTime} - ${input.gap.endTime}\n` +
        `${input.planningThought ? `编排想法: ${input.planningThought.summary}\n` : ''}` +
        `${input.planningThought ? `类型偏好: ${(input.planningThought.targetProgramTypes ?? []).join(', ') || '无'}\n` : ''}` +
        `${input.planningThought ? `关键词: ${(input.planningThought.searchKeywords ?? []).join(', ') || '无'}\n` : ''}` +
        `候选列表:\n${candidateList}\n` +
        '请输出 JSON：{"selectedCandidateId":"...","reasoning":"..."}',
    },
  ]
}

export function buildInsertCandidateSelectionPrompt(
  context: DialogueContext,
  params: InsertParams,
  candidates: ProgramCandidate[],
): ChatMessage[] {
  return [
    {
      role: 'system',
      content:
        '你是广播电视节目串联单候选选择器。你只能从给定候选列表中选择一个最适合当前插入需求的节目，不得编造新节目，不得输出非 JSON 文本。',
    },
    {
      role: 'user',
      content:
        `频道: ${context.scheduleState.channelName}\n` +
        `日期: ${context.scheduleState.date}\n` +
        `插入时间: ${params.targetTime}\n` +
        `用户目标节目名: ${params.programName}\n` +
        `当前节目单摘要:\n${context.scheduleSummary}\n` +
        `候选列表:\n${candidates
          .map(
            (candidate, index) =>
              `${index + 1}. id=${candidate.id}; name=${candidate.programName}; code=${candidate.programCode}; duration=${candidate.duration}; rating=${candidate.rating ?? 0}; tags=${(candidate.tags ?? []).join('|')}`,
          )
          .join('\n')}\n` +
        '请输出 JSON：{"selectedCandidateId":"...","reasoning":"..."}',
    },
  ]
}
