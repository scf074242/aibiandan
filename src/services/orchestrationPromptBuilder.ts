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
        '你是电视节目编排查询参数生成器。请根据空窗和编排想法，只输出候选查询条件所需的 JSON，不要输出额外说明。',
    },
    {
      role: 'user',
      content:
        `频道：${input.channelName}（${input.channelId}）\n` +
        `日期：${input.date}\n` +
        `空窗：${input.gap.startTime} - ${input.gap.endTime}\n` +
        `编排想法：${input.planningThought.summary}\n` +
        `目标栏目：${input.planningThought.targetSlotLabel ?? '未指定'}\n` +
        `类型偏好：${(input.planningThought.targetProgramTypes ?? []).join(', ') || '无'}\n` +
        `时长偏好：${input.planningThought.durationPreference.min}-${input.planningThought.durationPreference.max} 秒\n` +
        `${input.userIntent ? `用户补充要求：${input.userIntent}\n` : ''}` +
        '请只输出 criteria JSON，例如：' +
        '{"targetTimeRange":{"start":"...","end":"..."},"expectedDuration":{"min":1200,"max":3600},"channelId":"dragon","columnId":"101","programTypePreference":["news"],"excludeUsed":true}',
    },
  ]
}

export function buildGapCandidateSelectionPrompt(
  input: GapCandidateSelectionPromptInput,
): ChatMessage[] {
  const candidateList = input.candidates
    .map(
      (candidate, index) =>
        `${index + 1}. id=${candidate.id}; name=${candidate.programName}; code=${candidate.programCode}; type=${candidate.programType}; duration=${candidate.duration}; instance=${candidate.instanceName}`,
    )
    .join('\n')

  return [
    {
      role: 'system',
      content:
        '你是电视节目编排候选选择器。请只从给定候选里选一个最适合当前空窗的节目实例，并只输出 JSON。',
    },
    {
      role: 'user',
      content:
        `频道：${input.channelName}\n` +
        `日期：${input.date}\n` +
        `空窗：${input.gap.startTime} - ${input.gap.endTime}\n` +
        `${input.planningThought ? `编排想法：${input.planningThought.summary}\n` : ''}` +
        `候选列表：\n${candidateList}\n` +
        '请输出 JSON，例如：{"selectedCandidateId":"...","reasoning":"..."}',
    },
  ]
}

export function buildInsertCandidateSelectionPrompt(
  context: DialogueContext,
  params: InsertParams,
  candidates: ProgramCandidate[],
): ChatMessage[] {
  const candidateList = candidates
    .map(
      (candidate, index) =>
        `${index + 1}. id=${candidate.id}; name=${candidate.programName}; code=${candidate.programCode}; type=${candidate.programType}; duration=${candidate.duration}; instance=${candidate.instanceName}`,
    )
    .join('\n')

  return [
    {
      role: 'system',
      content:
        '你是电视节目插入候选选择器。请只从候选列表中选择一个最合适的节目实例，并输出 JSON。',
    },
    {
      role: 'user',
      content:
        `频道：${context.scheduleState.channelName}\n` +
        `日期：${context.scheduleState.date}\n` +
        `插入时间：${params.targetTime}\n` +
        `目标节目名：${params.programName}\n` +
        `当前编单摘要：${context.scheduleSummary}\n` +
        `候选列表：\n${candidateList}\n` +
        '请输出 JSON，例如：{"selectedCandidateId":"...","reasoning":"..."}',
    },
  ]
}
