import type {
  PlaylistType,
  ProgramCandidate,
  RotationPlaylistStrategy,
  ScheduleItemSnapshot,
  ScheduleState,
  ScheduleSummary,
  TimeRange,
} from '@/types/orchestration'
import type {
  AgentBroadcastReadinessEvidence,
  AgentExecutionResult,
  AgentProgramCandidate,
  AgentSubmitInput,
  SchedulingContext,
  SchedulingContextSourceMetadata,
  SchedulingContextSourceMetadataHints,
  SchedulingContextSourceHints,
  SchedulingDataGateway,
} from './types'
import { attachSchedulingContextBundle } from './contextBundle'
import { buildScheduleContextFingerprint } from './contextFingerprint'
import { buildCandidateQueryEvidence } from './searchFacets'
import { normalizeDateTime, normalizeItemDateTimes, sortScheduleItems, timeRangeToDateTimeRange } from './time'

export interface RuntimeScheduleSourceItem {
  id: string
  programCode?: string
  programName?: string
  programId?: string
  instanceName?: string
  columnId?: string
  columnName?: string
  contentTags?: string[]
  startTime: string
  endTime: string
  duration?: number
  programType?: string
  sequence?: number
}

export interface RuntimeSchedulingDataReader {
  getScheduleItems(input: AgentSubmitInput): Promise<RuntimeScheduleSourceItem[]> | RuntimeScheduleSourceItem[]
  getProgramCandidates?(input: AgentSubmitInput): Promise<ProgramCandidate[]> | ProgramCandidate[]
  getBroadcastReadiness?(input: AgentSubmitInput): Promise<AgentBroadcastReadinessEvidence[]> | AgentBroadcastReadinessEvidence[]
  getHistorySchedules?(input: AgentSubmitInput): Promise<ScheduleSummary[]> | ScheduleSummary[]
  getLayoutBounds?(input: AgentSubmitInput): Promise<TimeRange | undefined> | TimeRange | undefined
  getLockedItemIds?(input: AgentSubmitInput): Promise<string[]> | string[]
  getBlockedTimeRanges?(input: AgentSubmitInput): Promise<TimeRange[]> | TimeRange[]
  getSourceMetadata?(input: AgentSubmitInput): Promise<SchedulingContextSourceMetadataHints> | SchedulingContextSourceMetadataHints
  applyScheduleItems?(input: {
    channelId: string
    date: string
    playlistId?: string
    items: ScheduleItemSnapshot[]
    reason: string
  }): Promise<void> | void
}

export interface RuntimeSchedulingDataGatewayOptions {
  scheduleState?: ScheduleState
  playlistType?: PlaylistType
  rotationStrategy?: RotationPlaylistStrategy
  reader: RuntimeSchedulingDataReader
}

type RuntimeOptionalRead<T> = {
  value: T
  available: boolean
  metadata?: SchedulingContextSourceMetadata
}

export class RuntimeSchedulingDataGateway implements SchedulingDataGateway {
  private readonly scheduleState?: ScheduleState
  private readonly playlistType?: PlaylistType
  private readonly rotationStrategy?: RotationPlaylistStrategy
  private readonly reader: RuntimeSchedulingDataReader
  private lastCommittedItems: ScheduleItemSnapshot[] | null = null

  constructor(options: RuntimeSchedulingDataGatewayOptions) {
    this.scheduleState = options.scheduleState
    this.playlistType = options.playlistType
    this.rotationStrategy = options.rotationStrategy
    this.reader = options.reader
  }

  async loadContext(input: AgentSubmitInput): Promise<SchedulingContext> {
    const usingCommittedItems = this.shouldUseCommittedItems()
    const scheduleRead = usingCommittedItems
      ? { value: this.lastCommittedItems!, available: true }
      : await this.readScheduleItems(input)
    const candidateRead = await this.readProgramCandidates(input)
    const readinessRead = await this.readBroadcastReadiness(input)
    const historyRead = await this.readHistorySchedules(input)
    const layoutBoundsRead = await this.readLayoutBounds(input)
    const lockedItemIdsRead = await this.readLockedItemIds(input)
    const blockedTimeRangesRead = await this.readBlockedTimeRanges(input)
    const sourceMetadata = await this.readSourceMetadata(input)

    return attachSchedulingContextBundle({
      channelId: input.channelId,
      date: input.date,
      playlistId: input.playlistId,
      playlistType: this.resolvePlaylistType(),
      rotationStrategy: this.resolveRotationStrategy(),
      rotationDurationSeconds: this.resolveRotationDurationSeconds(),
      scheduleItems: sortScheduleItems(scheduleRead.value.map((item, index) => this.toScheduleItemSnapshot(item, input.date, index))),
      programCandidates: this.applyReadinessToCandidates(candidateRead.candidates, readinessRead.value),
      broadcastReadiness: readinessRead.value.map((item) => ({ ...item })),
      historySchedules: historyRead.value.map((summary) => ({
        ...summary,
        items: summary.items?.map((item) => normalizeItemDateTimes(item, summary.date)),
      })),
      layoutBounds: layoutBoundsRead.value ? timeRangeToDateTimeRange(layoutBoundsRead.value, input.date) : undefined,
      lockedItemIds: [...lockedItemIdsRead.value],
      blockedTimeRanges: blockedTimeRangesRead.value.map((range) => timeRangeToDateTimeRange(range, input.date)),
      sourceHints: this.buildSourceHints(usingCommittedItems, {
        today: scheduleRead.available,
        candidates: candidateRead.available,
        readiness: readinessRead.available,
        history: historyRead.available,
        constraints: layoutBoundsRead.available || lockedItemIdsRead.available || blockedTimeRangesRead.available,
      }),
      sourceMetadata: this.buildSourceMetadata(input, sourceMetadata, {
        today: scheduleRead.metadata,
        candidates: candidateRead.metadata,
        readiness: readinessRead.metadata,
        history: historyRead.metadata,
        constraints: this.mergeConstraintMetadata(layoutBoundsRead, lockedItemIdsRead, blockedTimeRangesRead),
      }),
    })
  }

  private async readProgramCandidates(input: AgentSubmitInput): Promise<{ candidates: ProgramCandidate[], available: boolean, metadata?: SchedulingContextSourceMetadata }> {
    if (!this.reader.getProgramCandidates) {
      return { candidates: [], available: false, metadata: { status: 'missing', errorCode: 'source_not_configured' } }
    }
    try {
      const candidates = await this.reader.getProgramCandidates(input)
      return {
        candidates,
        available: true,
        metadata: { status: candidates.length > 0 ? 'available' : 'empty' },
      }
    } catch (error) {
      return { candidates: [], available: false, metadata: this.buildReadFailureMetadata(error) }
    }
  }

  private async readScheduleItems(input: AgentSubmitInput): Promise<RuntimeOptionalRead<Array<RuntimeScheduleSourceItem | ScheduleItemSnapshot>>> {
    try {
      return {
        value: await this.reader.getScheduleItems(input),
        available: true,
      }
    } catch (error) {
      return { value: [], available: false, metadata: this.buildReadFailureMetadata(error) }
    }
  }

  private async readHistorySchedules(input: AgentSubmitInput): Promise<RuntimeOptionalRead<ScheduleSummary[]>> {
    return this.readOptionalArray(this.reader.getHistorySchedules, input)
  }

  private async readBroadcastReadiness(input: AgentSubmitInput): Promise<RuntimeOptionalRead<AgentBroadcastReadinessEvidence[]>> {
    return this.readOptionalArray(this.reader.getBroadcastReadiness, input)
  }

  private async readLayoutBounds(input: AgentSubmitInput): Promise<RuntimeOptionalRead<TimeRange | undefined>> {
    if (!this.reader.getLayoutBounds) {
      return { value: undefined, available: false, metadata: { status: 'missing', errorCode: 'source_not_configured' } }
    }
    try {
      return {
        value: await this.reader.getLayoutBounds(input),
        available: true,
      }
    } catch (error) {
      return { value: undefined, available: false, metadata: this.buildReadFailureMetadata(error) }
    }
  }

  private async readLockedItemIds(input: AgentSubmitInput): Promise<RuntimeOptionalRead<string[]>> {
    return this.readOptionalArray(this.reader.getLockedItemIds, input)
  }

  private async readBlockedTimeRanges(input: AgentSubmitInput): Promise<RuntimeOptionalRead<TimeRange[]>> {
    return this.readOptionalArray(this.reader.getBlockedTimeRanges, input)
  }

  private async readOptionalArray<T>(
    reader: ((input: AgentSubmitInput) => Promise<T[]> | T[]) | undefined,
    input: AgentSubmitInput,
  ): Promise<RuntimeOptionalRead<T[]>> {
    if (!reader) {
      return { value: [], available: false, metadata: { status: 'missing', errorCode: 'source_not_configured' } }
    }
    try {
      return {
        value: await reader(input),
        available: true,
      }
    } catch (error) {
      return { value: [], available: false, metadata: this.buildReadFailureMetadata(error) }
    }
  }

  private async readSourceMetadata(input: AgentSubmitInput): Promise<SchedulingContextSourceMetadataHints> {
    if (!this.reader.getSourceMetadata) return {}
    try {
      return await this.reader.getSourceMetadata(input)
    } catch {
      return {}
    }
  }

  private buildSourceMetadata(
    input: AgentSubmitInput,
    explicitMetadata: SchedulingContextSourceMetadataHints,
    readMetadata: SchedulingContextSourceMetadataHints,
  ): SchedulingContextSourceMetadataHints {
    const candidateQuery = buildCandidateQueryEvidence(input)
    return {
      ...readMetadata,
      ...explicitMetadata,
      today: { ...readMetadata.today, ...explicitMetadata.today },
      candidates: {
        ...readMetadata.candidates,
        ...explicitMetadata.candidates,
        query: explicitMetadata.candidates?.query ?? readMetadata.candidates?.query ?? candidateQuery,
      },
      history: { ...readMetadata.history, ...explicitMetadata.history },
      constraints: { ...readMetadata.constraints, ...explicitMetadata.constraints },
      readiness: { ...readMetadata.readiness, ...explicitMetadata.readiness },
      policy: { ...explicitMetadata.policy },
    }
  }

  private mergeConstraintMetadata(
    layoutBoundsRead: RuntimeOptionalRead<TimeRange | undefined>,
    lockedItemIdsRead: RuntimeOptionalRead<string[]>,
    blockedTimeRangesRead: RuntimeOptionalRead<TimeRange[]>,
  ): SchedulingContextSourceMetadata | undefined {
    const reads = [layoutBoundsRead, lockedItemIdsRead, blockedTimeRangesRead]
    if (reads.some((read) => read.available)) return { status: 'available' }
    return reads.find((read) => read.metadata)?.metadata
  }

  private buildReadFailureMetadata(error: unknown): SchedulingContextSourceMetadata {
    return {
      status: 'unavailable',
      errorCode: error instanceof Error ? 'read_failed' : 'read_unknown_failed',
      errorMessage: error instanceof Error ? error.message : String(error),
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
    const previousItems = (await this.loadContext({
      userInput: '',
      channelId: input.channelId,
      date: input.date,
      playlistId: input.playlistId,
    })).scheduleItems
    const nextItems = sortScheduleItems(input.items.map((item) => normalizeItemDateTimes(item, input.date)))
    const affectedItemIds = this.resolveAffectedItemIds(previousItems, nextItems)

    const currentFingerprint = buildScheduleContextFingerprint(previousItems)
    if (
      input.expectedContextFingerprint
      && input.expectedContextFingerprint !== currentFingerprint
    ) {
      return {
        committed: false,
        operationId: `agent_runtime_conflict_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        affectedItemIds: [],
        scheduleItems: previousItems.map((item) => ({ ...item })),
      }
    }

    await this.reader.applyScheduleItems?.({
      ...input,
      items: nextItems.map((item) => ({ ...item })),
    })
    const readerReflectedCommit = this.reader.applyScheduleItems
      ? await this.readerReflectsCommittedItems(input, nextItems)
      : false
    this.lastCommittedItems = readerReflectedCommit
      ? null
      : nextItems.map((item) => ({ ...item }))

    return {
      committed: true,
      operationId: `agent_runtime_op_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      affectedItemIds,
      scheduleItems: nextItems.map((item) => ({ ...item })),
    }
  }

  private async readerReflectsCommittedItems(
    input: { channelId: string; date: string; playlistId?: string },
    committedItems: ScheduleItemSnapshot[],
  ): Promise<boolean> {
    try {
      const reflectedItems = await this.reader.getScheduleItems({
        userInput: '',
        channelId: input.channelId,
        date: input.date,
        playlistId: input.playlistId,
      })
      const normalizedItems = sortScheduleItems(
        reflectedItems.map((item, index) => this.toScheduleItemSnapshot(item, input.date, index)),
      )
      return buildScheduleContextFingerprint(normalizedItems) === buildScheduleContextFingerprint(committedItems)
    } catch {
      return false
    }
  }

  private resolvePlaylistType(): PlaylistType {
    return this.playlistType ?? this.scheduleState?.playlistType ?? 'tv'
  }

  private resolveRotationStrategy(): RotationPlaylistStrategy | undefined {
    const strategy = this.rotationStrategy ?? this.scheduleState?.rotationStrategy
    return this.resolvePlaylistType() === 'rotation' ? strategy ?? 'content_match' : undefined
  }

  private resolveRotationDurationSeconds(): number | undefined {
    const durationSeconds = this.scheduleState?.rotationDurationSeconds
    return this.resolvePlaylistType() === 'rotation' && typeof durationSeconds === 'number' && durationSeconds > 0
      ? durationSeconds
      : undefined
  }

  private shouldUseCommittedItems(): boolean {
    return this.lastCommittedItems !== null
  }

  private buildSourceHints(
    usingCommittedItems: boolean,
    sources: {
      today: boolean
      candidates: boolean
      readiness: boolean
      history: boolean
      constraints: boolean
    },
  ): SchedulingContextSourceHints {
    return {
      today: usingCommittedItems
        ? 'agent_commit_cache'
        : sources.today
          ? 'runtime_schedule_reader'
          : 'none',
      candidates: this.reader.getProgramCandidates && sources.candidates ? 'program_candidate_reader' : 'none',
      readiness: this.reader.getBroadcastReadiness && sources.readiness ? 'readiness_reader' : 'none',
      history: this.reader.getHistorySchedules && sources.history ? 'history_schedule_reader' : 'none',
      constraints: sources.constraints ? 'constraint_reader' : 'none',
      policy: this.playlistType || this.rotationStrategy
        ? 'explicit_runtime_option'
        : this.scheduleState
          ? 'schedule_state'
          : 'none',
    }
  }

  private toScheduleItemSnapshot(
    item: RuntimeScheduleSourceItem | ScheduleItemSnapshot,
    date: string,
    index: number,
  ): ScheduleItemSnapshot {
    const startTime = normalizeDateTime(date, item.startTime)
    const endTime = normalizeDateTime(date, item.endTime)
    return {
      id: item.id,
      programId: item.programId,
      programCode: item.programCode ?? item.id,
      programName: item.programName ?? item.instanceName ?? item.id,
      instanceName: item.instanceName,
      columnId: item.columnId,
      columnName: item.columnName,
      contentTags: item.contentTags,
      startTime,
      endTime,
      duration: item.duration ?? Math.max(0, Math.floor((new Date(endTime).getTime() - new Date(startTime).getTime()) / 1000)),
      programType: item.programType ?? 'unknown',
      sequence: item.sequence ?? index + 1,
    }
  }

  private applyReadinessToCandidates(
    candidates: ProgramCandidate[],
    readinessRecords: AgentBroadcastReadinessEvidence[],
  ): AgentProgramCandidate[] {
    return candidates.map((candidate) => {
      const readiness = this.findReadinessForCandidate(candidate, readinessRecords)
      return {
        ...candidate,
        ...(readiness?.materialStatus ? { materialStatus: readiness.materialStatus } : {}),
        ...(readiness?.rightsStatus ? { rightsStatus: readiness.rightsStatus } : {}),
      } as AgentProgramCandidate
    })
  }

  private findReadinessForCandidate(
    candidate: ProgramCandidate,
    readinessRecords: AgentBroadcastReadinessEvidence[],
  ): AgentBroadcastReadinessEvidence | undefined {
    return readinessRecords.find((record) =>
      (record.candidateId && record.candidateId === candidate.id)
      || (record.programId && record.programId === candidate.programId)
      || (record.programCode && record.programCode === candidate.programCode),
    )
  }

  private resolveAffectedItemIds(previousItems: ScheduleItemSnapshot[], nextItems: ScheduleItemSnapshot[]): string[] {
    const previousById = new Map(previousItems.map((item) => [item.id, item]))
    const nextIds = new Set(nextItems.map((item) => item.id))
    const changedItemIds = nextItems
      .filter((item) => {
        const previous = previousById.get(item.id)
        return !previous
          || previous.startTime !== item.startTime
          || previous.endTime !== item.endTime
          || previous.programCode !== item.programCode
          || previous.programName !== item.programName
      })
      .map((item) => item.id)
    const deletedItemIds = previousItems
      .filter((item) => !nextIds.has(item.id))
      .map((item) => item.id)
    return Array.from(new Set([...changedItemIds, ...deletedItemIds]))
  }
}
