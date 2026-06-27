import type {
  ProgramCandidate,
  ScheduleItemSnapshot,
  ScheduleSummary,
  TimeRange,
} from '@/types/orchestration'
import type { AgentSubmitInput } from './types'
import type { AgentBroadcastReadinessEvidence, SchedulingContextSourceMetadata } from './types'
import type { RuntimeScheduleSourceItem, RuntimeSchedulingDataReader } from './runtimeSchedulingDataGateway'

export interface RuntimeScheduleSourceAdapter {
  getScheduleItems(input: AgentSubmitInput): Promise<RuntimeScheduleSourceItem[]> | RuntimeScheduleSourceItem[]
  getSourceMetadata?(input: AgentSubmitInput): Promise<SchedulingContextSourceMetadata> | SchedulingContextSourceMetadata
}

export interface RuntimeCandidateSourceAdapter {
  getProgramCandidates(input: AgentSubmitInput): Promise<ProgramCandidate[]> | ProgramCandidate[]
  getSourceMetadata?(input: AgentSubmitInput): Promise<SchedulingContextSourceMetadata> | SchedulingContextSourceMetadata
}

export interface RuntimeReadinessSourceAdapter {
  getBroadcastReadiness(input: AgentSubmitInput): Promise<AgentBroadcastReadinessEvidence[]> | AgentBroadcastReadinessEvidence[]
  getSourceMetadata?(input: AgentSubmitInput): Promise<SchedulingContextSourceMetadata> | SchedulingContextSourceMetadata
}

export interface RuntimeHistorySourceAdapter {
  getHistorySchedules(input: AgentSubmitInput): Promise<ScheduleSummary[]> | ScheduleSummary[]
  getSourceMetadata?(input: AgentSubmitInput): Promise<SchedulingContextSourceMetadata> | SchedulingContextSourceMetadata
}

export interface RuntimeConstraintSourceAdapter {
  getLayoutBounds?(input: AgentSubmitInput): Promise<TimeRange | undefined> | TimeRange | undefined
  getLockedItemIds?(input: AgentSubmitInput): Promise<string[]> | string[]
  getBlockedTimeRanges?(input: AgentSubmitInput): Promise<TimeRange[]> | TimeRange[]
  getSourceMetadata?(input: AgentSubmitInput): Promise<SchedulingContextSourceMetadata> | SchedulingContextSourceMetadata
}

export interface RuntimeScheduleWriteAdapter {
  applyScheduleItems(input: {
    channelId: string
    date: string
    playlistId?: string
    items: ScheduleItemSnapshot[]
    reason: string
  }): Promise<void> | void
}

export interface RuntimeSchedulingDataSourceAdapters {
  today: RuntimeScheduleSourceAdapter
  candidates?: RuntimeCandidateSourceAdapter
  readiness?: RuntimeReadinessSourceAdapter
  history?: RuntimeHistorySourceAdapter
  constraints?: RuntimeConstraintSourceAdapter
  writer?: RuntimeScheduleWriteAdapter
}

export const createRuntimeSchedulingDataReader = (
  adapters: RuntimeSchedulingDataSourceAdapters,
): RuntimeSchedulingDataReader => ({
  getScheduleItems: (input) => adapters.today.getScheduleItems(input),
  getProgramCandidates: adapters.candidates
    ? (input) => adapters.candidates!.getProgramCandidates(input)
    : undefined,
  getBroadcastReadiness: adapters.readiness
    ? (input) => adapters.readiness!.getBroadcastReadiness(input)
    : undefined,
  getHistorySchedules: adapters.history
    ? (input) => adapters.history!.getHistorySchedules(input)
    : undefined,
  getLayoutBounds: adapters.constraints?.getLayoutBounds
    ? (input) => adapters.constraints!.getLayoutBounds!(input)
    : undefined,
  getLockedItemIds: adapters.constraints?.getLockedItemIds
    ? (input) => adapters.constraints!.getLockedItemIds!(input)
    : undefined,
  getBlockedTimeRanges: adapters.constraints?.getBlockedTimeRanges
    ? (input) => adapters.constraints!.getBlockedTimeRanges!(input)
    : undefined,
  getSourceMetadata: async (input) => ({
    today: await adapters.today.getSourceMetadata?.(input),
    candidates: await adapters.candidates?.getSourceMetadata?.(input),
    readiness: await adapters.readiness?.getSourceMetadata?.(input),
    history: await adapters.history?.getSourceMetadata?.(input),
    constraints: await adapters.constraints?.getSourceMetadata?.(input),
  }),
  applyScheduleItems: adapters.writer
    ? (input) => adapters.writer!.applyScheduleItems(input)
    : undefined,
})
