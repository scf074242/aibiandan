import type { PlaylistType, RotationPlaylistStrategy, ScheduleItemSnapshot, ScheduleSummary, TimeRange } from '@/types/orchestration'
import type {
  AgentExecutionResult,
  AgentBroadcastReadinessEvidence,
  AgentProgramCandidate,
  AgentSubmitInput,
  SchedulingContext,
  SchedulingDataGateway,
} from './types'
import { attachSchedulingContextBundle } from './contextBundle'
import { buildScheduleContextFingerprint } from './contextFingerprint'
import { buildCandidateQueryEvidence } from './searchFacets'
import { normalizeItemDateTimes, sortScheduleItems, timeRangeToDateTimeRange } from './time'

export interface InMemorySchedulingDataGatewaySeed {
  channelId: string
  date: string
  playlistId?: string
  playlistType?: PlaylistType
  rotationStrategy?: RotationPlaylistStrategy
  rotationDurationSeconds?: number
  scheduleItems: ScheduleItemSnapshot[]
  programCandidates?: AgentProgramCandidate[]
  broadcastReadiness?: AgentBroadcastReadinessEvidence[]
  historySchedules?: ScheduleSummary[]
  layoutBounds?: TimeRange
  lockedItemIds?: string[]
  blockedTimeRanges?: TimeRange[]
}

export class InMemorySchedulingDataGateway implements SchedulingDataGateway {
  private contexts = new Map<string, SchedulingContext>()

  constructor(seeds: InMemorySchedulingDataGatewaySeed[] = []) {
    seeds.forEach((seed) => this.seed(seed))
  }

  seed(seed: InMemorySchedulingDataGatewaySeed): void {
    const key = this.buildKey(seed.channelId, seed.date, seed.playlistId)
    this.contexts.set(key, attachSchedulingContextBundle({
      channelId: seed.channelId,
      date: seed.date,
      playlistId: seed.playlistId,
      playlistType: seed.playlistType ?? 'tv',
      rotationStrategy: seed.rotationStrategy,
      rotationDurationSeconds: seed.rotationDurationSeconds,
      scheduleItems: sortScheduleItems(seed.scheduleItems.map((item) => normalizeItemDateTimes(item, seed.date))),
      programCandidates: seed.programCandidates ?? [],
      broadcastReadiness: seed.broadcastReadiness ?? [],
      historySchedules: (seed.historySchedules ?? []).map((summary) => ({
        ...summary,
        items: summary.items?.map((item) => normalizeItemDateTimes(item, summary.date)),
      })),
      layoutBounds: seed.layoutBounds ? timeRangeToDateTimeRange(seed.layoutBounds, seed.date) : undefined,
      lockedItemIds: seed.lockedItemIds ?? [],
      blockedTimeRanges: (seed.blockedTimeRanges ?? []).map((range) => timeRangeToDateTimeRange(range, seed.date)),
      sourceHints: {
        today: 'in_memory_seed',
        candidates: seed.programCandidates ? 'in_memory_seed' : 'none',
        readiness: seed.broadcastReadiness ? 'in_memory_seed' : 'none',
        history: seed.historySchedules ? 'in_memory_seed' : 'none',
        constraints: seed.layoutBounds || seed.lockedItemIds || seed.blockedTimeRanges ? 'in_memory_seed' : 'none',
        policy: 'in_memory_seed',
      },
    }))
  }

  async loadContext(input: AgentSubmitInput): Promise<SchedulingContext> {
    const key = this.buildKey(input.channelId, input.date, input.playlistId)
    const context = this.contexts.get(key)
    if (!context) {
      return attachSchedulingContextBundle({
        channelId: input.channelId,
        date: input.date,
        playlistId: input.playlistId,
        playlistType: 'tv',
        programCandidates: [],
        broadcastReadiness: [],
        scheduleItems: [],
        lockedItemIds: [],
        blockedTimeRanges: [],
        sourceHints: {
          today: 'empty_context',
          candidates: 'none',
          readiness: 'none',
          history: 'none',
          constraints: 'none',
          policy: 'empty_context',
        },
      })
    }

    return attachSchedulingContextBundle({
      ...context,
      scheduleItems: context.scheduleItems.map((item) => ({ ...item })),
      programCandidates: context.programCandidates.map((candidate) => ({ ...candidate })),
      broadcastReadiness: context.broadcastReadiness.map((item) => ({ ...item })),
      historySchedules: context.historySchedules?.map((summary) => ({
        ...summary,
        items: summary.items?.map((item) => ({ ...item })),
      })),
      lockedItemIds: [...context.lockedItemIds],
      blockedTimeRanges: context.blockedTimeRanges.map((range) => ({ ...range })),
      layoutBounds: context.layoutBounds ? { ...context.layoutBounds } : undefined,
      sourceHints: { ...context.sourceHints },
      sourceMetadata: this.buildLoadSourceMetadata(input, context),
    })
  }

  private buildLoadSourceMetadata(input: AgentSubmitInput, context: SchedulingContext): SchedulingContext['sourceMetadata'] {
    const candidateQuery = buildCandidateQueryEvidence(input)
    return {
      ...context.sourceMetadata,
      candidates: {
        ...context.sourceMetadata?.candidates,
        query: context.sourceMetadata?.candidates?.query ?? candidateQuery,
      },
    }
  }

  async commitScheduleItems(input: {
    channelId: string
    date: string
    playlistId?: string
    items: ScheduleItemSnapshot[]
    reason: string
    expectedContextFingerprint?: string
  }): Promise<AgentExecutionResult> {
    const key = this.buildKey(input.channelId, input.date, input.playlistId)
    const current = this.contexts.get(key) ?? attachSchedulingContextBundle({
      channelId: input.channelId,
      date: input.date,
      playlistId: input.playlistId,
      playlistType: 'tv' as const,
      programCandidates: [],
      broadcastReadiness: [],
      scheduleItems: [],
      lockedItemIds: [],
      blockedTimeRanges: [],
      sourceHints: {
        today: 'empty_context',
        candidates: 'none',
        readiness: 'none',
        history: 'none',
        constraints: 'none',
        policy: 'empty_context',
      },
    })

    const currentFingerprint = buildScheduleContextFingerprint(current.scheduleItems)
    if (
      input.expectedContextFingerprint
      && input.expectedContextFingerprint !== currentFingerprint
    ) {
      return {
        committed: false,
        operationId: `agent_conflict_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        affectedItemIds: [],
        scheduleItems: current.scheduleItems.map((item) => ({ ...item })),
      }
    }

    const nextItems = sortScheduleItems(input.items.map((item) => normalizeItemDateTimes(item, input.date)))
    const previousById = new Map(current.scheduleItems.map((item) => [item.id, item]))
    const nextIds = new Set(nextItems.map((item) => item.id))
    const changedItemIds = nextItems
      .filter((item) => {
        const previous = previousById.get(item.id)
        return !previous || previous.startTime !== item.startTime || previous.endTime !== item.endTime
      })
      .map((item) => item.id)
    const deletedItemIds = current.scheduleItems
      .filter((item) => !nextIds.has(item.id))
      .map((item) => item.id)
    const affectedItemIds = Array.from(new Set([...changedItemIds, ...deletedItemIds]))

    this.contexts.set(key, attachSchedulingContextBundle({
      ...current,
      scheduleItems: nextItems,
      sourceHints: {
        ...current.sourceHints,
        today: 'agent_commit_cache',
      },
    }))

    return {
      committed: true,
      operationId: `agent_op_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      affectedItemIds,
      scheduleItems: nextItems.map((item) => ({ ...item })),
    }
  }

  private buildKey(channelId: string, date: string, playlistId?: string): string {
    return `${channelId}:${date}:${playlistId ?? 'default'}`
  }
}
