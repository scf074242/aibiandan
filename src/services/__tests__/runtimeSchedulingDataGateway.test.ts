import { describe, expect, it } from 'vitest'

import { buildScheduleContextFingerprint } from '@/services/agent/contextFingerprint'
import { createRuntimeSchedulingDataReader } from '@/services/agent/runtimeSchedulingDataAdapters'
import { RuntimeSchedulingDataGateway, type RuntimeScheduleSourceItem } from '@/services/agent/runtimeSchedulingDataGateway'
import { SchedulingAgentRuntime } from '@/services/agent/schedulingAgentRuntime'
import type { ProgramCandidate, ScheduleItemSnapshot, ScheduleState, ScheduleSummary } from '@/types/orchestration'

const date = '2026-03-25'

const buildScheduleState = (patch: Partial<ScheduleState> = {}): ScheduleState => ({
  channelId: 'dragon',
  channelName: '东方卫视',
  date,
  isEmpty: false,
  itemCount: 1,
  gapCount: 0,
  hasSelectedTimeRange: false,
  playlistType: 'tv',
  ...patch,
})

const buildRuntimeItem = (patch: Partial<RuntimeScheduleSourceItem> = {}): RuntimeScheduleSourceItem => ({
  id: 'item-0900',
  programCode: 'KDF001',
  programName: '看东方',
  startTime: '09:00:00',
  endTime: '09:30:00',
  duration: 1800,
  programType: 'news',
  ...patch,
})

const buildCandidate = (patch: Partial<ProgramCandidate> = {}): ProgramCandidate => ({
  id: 'candidate-dfxw',
  programId: 'program-dfxw',
  programCode: 'DFXW001',
  programName: '东方新闻',
  channelId: 'dragon',
  columnId: 'news',
  columnName: '新闻',
  duration: 1800,
  programType: 'news',
  instanceName: '东方新闻',
  contentTags: ['新闻'],
  ...patch,
})

describe('RuntimeSchedulingDataGateway', () => {
  it('从运行态节目、候选库、历史和约束多源组装 SchedulingContext', async () => {
    const historySchedules: ScheduleSummary[] = [{
      date: '2026-03-24',
      itemCount: 1,
      programTypes: { news: 1 },
      items: [buildRuntimeItem({
        id: 'history-0900',
        startTime: '09:00:00',
        endTime: '09:30:00',
      }) as ScheduleItemSnapshot],
    }]
    const gateway = new RuntimeSchedulingDataGateway({
      scheduleState: buildScheduleState({
        playlistType: 'rotation',
        rotationStrategy: 'rating',
      }),
      reader: {
        getScheduleItems: () => [buildRuntimeItem()],
        getProgramCandidates: () => [buildCandidate()],
        getHistorySchedules: () => historySchedules,
        getLayoutBounds: () => ({ start: '08:00:00', end: '23:00:00' }),
        getLockedItemIds: () => ['item-locked'],
        getBlockedTimeRanges: () => [{ start: '12:00:00', end: '12:30:00' }],
      },
    })

    const context = await gateway.loadContext({
      userInput: '',
      channelId: 'dragon',
      date,
    })

    expect(context).toMatchObject({
      channelId: 'dragon',
      date,
      playlistType: 'rotation',
      rotationStrategy: 'rating',
      lockedItemIds: ['item-locked'],
      layoutBounds: {
        start: '2026-03-25T08:00:00+08:00',
        end: '2026-03-25T23:00:00+08:00',
      },
      blockedTimeRanges: [{
        start: '2026-03-25T12:00:00+08:00',
        end: '2026-03-25T12:30:00+08:00',
      }],
    })
    expect(context.scheduleItems[0]).toMatchObject({
      id: 'item-0900',
      programName: '看东方',
      startTime: '2026-03-25T09:00:00+08:00',
      endTime: '2026-03-25T09:30:00+08:00',
    })
    expect(context.programCandidates[0]).toMatchObject({
      id: 'candidate-dfxw',
      programName: '东方新闻',
    })
    expect(context.historySchedules?.[0]?.items?.[0]).toMatchObject({
      id: 'history-0900',
      startTime: '2026-03-24T09:00:00+08:00',
    })
    expect(context.bundle).toMatchObject({
      identity: {
        channelId: 'dragon',
        date,
        playlistType: 'rotation',
        rotationStrategy: 'rating',
      },
      sources: {
        today: {
          source: 'runtime_schedule_reader',
          available: true,
          recordCount: 1,
        },
        candidates: {
          source: 'program_candidate_reader',
          available: true,
          recordCount: 1,
        },
        history: {
          source: 'history_schedule_reader',
          available: true,
          recordCount: 1,
        },
        constraints: {
          source: 'constraint_reader',
          available: true,
          recordCount: 3,
        },
        policy: {
          source: 'schedule_state',
          available: true,
          recordCount: 1,
        },
      },
      today: {
        itemCount: 1,
        scheduleItems: [{
          id: 'item-0900',
          startTime: '2026-03-25T09:00:00+08:00',
        }],
      },
      candidates: {
        totalCount: 1,
        programCandidates: [{
          id: 'candidate-dfxw',
        }],
      },
      history: {
        totalCount: 1,
        latestSchedule: {
          date: '2026-03-24',
        },
        todayOverridesHistory: true,
      },
      constraints: {
        layoutBounds: {
          start: '2026-03-25T08:00:00+08:00',
          end: '2026-03-25T23:00:00+08:00',
        },
        lockedItemIds: ['item-locked'],
        blockedTimeRanges: [{
          start: '2026-03-25T12:00:00+08:00',
          end: '2026-03-25T12:30:00+08:00',
        }],
      },
      policy: {
        playlistType: 'rotation',
        rotationStrategy: 'rating',
        tvStrictFill: false,
        rotationCandidateWritesRequireConfirmation: true,
        sensitiveWriteIntentsRequireConfirmation: ['delete', 'batch_delete'],
      },
    })
  })

  it('执行 Agent 命令后通过 applyScheduleItems 回写运行态节目单', async () => {
    let currentItems: RuntimeScheduleSourceItem[] = [buildRuntimeItem()]
    let appliedReason = ''
    const gateway = new RuntimeSchedulingDataGateway({
      scheduleState: buildScheduleState(),
      reader: {
        getScheduleItems: () => currentItems,
        applyScheduleItems: ({ items, reason }) => {
          currentItems = items
          appliedReason = reason
        },
      },
    })
    const runtime = new SchedulingAgentRuntime({ dataGateway: gateway })

    const result = await runtime.submit({
      userInput: '把9点的节目整体后移30分钟',
      channelId: 'dragon',
      date,
    })

    expect(result.status).toBe('executed')
    expect(appliedReason).toBe('agent:atomic_command:move')
    expect(currentItems[0]).toMatchObject({
      id: 'item-0900',
      startTime: '2026-03-25T09:30:00+08:00',
      endTime: '2026-03-25T10:00:00+08:00',
    })

    const context = await gateway.loadContext({
      userInput: '',
      channelId: 'dragon',
      date,
    })
    expect(context.bundle.sources.today).toMatchObject({
      source: 'runtime_schedule_reader',
      available: true,
      recordCount: 1,
    })
  })

  it('keeps the runtime schedule reader authoritative after an agent commit', async () => {
    let currentItems: RuntimeScheduleSourceItem[] = [buildRuntimeItem()]
    const gateway = new RuntimeSchedulingDataGateway({
      scheduleState: buildScheduleState(),
      reader: {
        getScheduleItems: () => currentItems,
        applyScheduleItems: ({ items }) => {
          currentItems = items.map((item) => ({
            id: item.id,
            programCode: item.programCode,
            programName: item.programName,
            startTime: item.startTime,
            endTime: item.endTime,
            duration: item.duration,
            programType: item.programType,
            sequence: item.sequence,
          }))
        },
      },
    })
    const runtime = new SchedulingAgentRuntime({ dataGateway: gateway })

    const committed = await runtime.submit({
      userInput: 'move 09:00 to 10:00',
      channelId: 'dragon',
      date,
      interpretation: {
        intent: 'move',
        confidence: 1,
        source: 'test',
        slots: {
          targetTime: '09:00:00',
          newStartTime: '10:00:00',
        },
      },
    })

    expect(committed.status).toBe('executed')

    currentItems = [buildRuntimeItem({
      id: 'external-1100',
      programCode: 'EXT1100',
      programName: 'External Update',
      startTime: '11:00:00',
      endTime: '11:30:00',
    })]

    const context = await gateway.loadContext({
      userInput: '',
      channelId: 'dragon',
      date,
    })

    expect(context.scheduleItems).toHaveLength(1)
    expect(context.scheduleItems[0]).toMatchObject({
      id: 'external-1100',
      startTime: '2026-03-25T11:00:00+08:00',
      endTime: '2026-03-25T11:30:00+08:00',
    })
    expect(context.bundle.sources.today).toMatchObject({
      source: 'runtime_schedule_reader',
      available: true,
      recordCount: 1,
    })
  })

  it('轮播单使用运行态网关时仍返回候选确认而不直接回写', async () => {
    let applyCount = 0
    const gateway = new RuntimeSchedulingDataGateway({
      scheduleState: buildScheduleState({
        playlistType: 'rotation',
        rotationStrategy: 'content_match',
      }),
      reader: {
        getScheduleItems: () => [],
        getProgramCandidates: () => [buildCandidate()],
        applyScheduleItems: () => {
          applyCount += 1
        },
      },
    })
    const runtime = new SchedulingAgentRuntime({ dataGateway: gateway })

    const result = await runtime.submit({
      userInput: '在9点插入东方新闻',
      channelId: 'dragon',
      date,
    })

    expect(result.status).toBe('needs_confirmation')
    expect(result.decision.pendingTask).toMatchObject({
      intent: 'insert',
      phase: 'needs_confirmation',
    })
    expect(applyCount).toBe(0)
  })

  it('refuses runtime writes when the expected playlist fingerprint is stale', async () => {
    let currentItems: RuntimeScheduleSourceItem[] = [buildRuntimeItem()]
    let applyCount = 0
    const gateway = new RuntimeSchedulingDataGateway({
      scheduleState: buildScheduleState(),
      reader: {
        getScheduleItems: () => currentItems,
        applyScheduleItems: () => {
          applyCount += 1
        },
      },
    })

    const initialContext = await gateway.loadContext({
      userInput: '',
      channelId: 'dragon',
      date,
    })
    const staleFingerprint = buildScheduleContextFingerprint(initialContext.scheduleItems)
    currentItems = [buildRuntimeItem({
      startTime: '09:15:00',
      endTime: '09:45:00',
    })]

    const result = await gateway.commitScheduleItems({
      channelId: 'dragon',
      date,
      items: [buildRuntimeItem({
        startTime: '10:00:00',
        endTime: '10:30:00',
      })],
      reason: 'agent:test:stale',
      expectedContextFingerprint: staleFingerprint,
    })

    expect(result.committed).toBe(false)
    expect(result.affectedItemIds).toEqual([])
    expect(result.scheduleItems[0]).toMatchObject({
      startTime: '2026-03-25T09:15:00+08:00',
      endTime: '2026-03-25T09:45:00+08:00',
    })
    expect(applyCount).toBe(0)
  })

  it('composes independent runtime data source adapters into one Agent Core reader', async () => {
    const gateway = new RuntimeSchedulingDataGateway({
      scheduleState: buildScheduleState({
        playlistType: 'rotation',
        rotationStrategy: 'content_match',
      }),
      reader: createRuntimeSchedulingDataReader({
        today: {
          getScheduleItems: () => [buildRuntimeItem()],
          getSourceMetadata: () => ({
            version: 'playlist-v1',
          }),
        },
        candidates: {
          getProgramCandidates: () => [buildCandidate()],
          getSourceMetadata: () => ({
            query: {
              limit: 100,
              facets: ['news'],
            },
          }),
        },
        readiness: {
          getBroadcastReadiness: () => [{
            candidateId: 'candidate-dfxw',
            materialStatus: 'ready',
            rightsStatus: 'blocked',
            source: 'rights-system',
          }],
          getSourceMetadata: () => ({
            version: 'readiness-v1',
          }),
        },
        history: {
          getHistorySchedules: () => [{
            date: '2026-03-24',
            itemCount: 1,
            programTypes: { news: 1 },
            items: [buildRuntimeItem({
              id: 'history-0900',
              startTime: '09:00:00',
              endTime: '09:30:00',
            }) as ScheduleItemSnapshot],
          }],
        },
        constraints: {
          getLayoutBounds: () => ({ start: '08:00:00', end: '23:00:00' }),
          getLockedItemIds: () => ['item-locked'],
          getBlockedTimeRanges: () => [{ start: '12:00:00', end: '12:30:00' }],
        },
        writer: {
          applyScheduleItems: () => undefined,
        },
      }),
    })

    const context = await gateway.loadContext({
      userInput: '',
      channelId: 'dragon',
      date,
    })

    expect(context).toMatchObject({
      playlistType: 'rotation',
      rotationStrategy: 'content_match',
      scheduleItems: [{ id: 'item-0900' }],
      programCandidates: [{ id: 'candidate-dfxw', rightsStatus: 'blocked' }],
      broadcastReadiness: [{
        candidateId: 'candidate-dfxw',
        rightsStatus: 'blocked',
      }],
      historySchedules: [{ date: '2026-03-24' }],
      lockedItemIds: ['item-locked'],
      blockedTimeRanges: [{
        start: '2026-03-25T12:00:00+08:00',
        end: '2026-03-25T12:30:00+08:00',
      }],
    })
    expect(context.bundle.sources).toMatchObject({
      today: {
        source: 'runtime_schedule_reader',
        available: true,
        recordCount: 1,
        version: 'playlist-v1',
      },
      candidates: {
        source: 'program_candidate_reader',
        available: true,
        recordCount: 1,
        query: {
          limit: 100,
          facets: ['news'],
        },
      },
      readiness: {
        source: 'readiness_reader',
        available: true,
        recordCount: 1,
        version: 'readiness-v1',
      },
      history: {
        source: 'history_schedule_reader',
        available: true,
        recordCount: 1,
      },
      constraints: {
        source: 'constraint_reader',
        available: true,
        recordCount: 3,
      },
    })
  })

  it('distinguishes a missing candidate source from a configured empty candidate source', async () => {
    const missingCandidateGateway = new RuntimeSchedulingDataGateway({
      scheduleState: buildScheduleState({ playlistType: 'tv' }),
      reader: {
        getScheduleItems: () => [],
      },
    })
    const missingCandidateRuntime = new SchedulingAgentRuntime({ dataGateway: missingCandidateGateway })

    const missingCandidateResult = await missingCandidateRuntime.submit({
      userInput: 'insert Replacement News at 10:00',
      channelId: 'dragon',
      date,
      interpretation: {
        intent: 'insert',
        confidence: 1,
        source: 'test',
        slots: {
          targetTime: '10:00:00',
          programHint: 'Replacement News',
        },
      },
    })

    expect(missingCandidateResult.status).toBe('blocked')
    expect(missingCandidateResult.decision.auditSummary).toMatchObject({
      contextSources: {
        candidates: {
          source: 'none',
          available: false,
          recordCount: 0,
        },
      },
    })
    expect(missingCandidateResult.decision.auditSummary?.keyPoints).toEqual(
      expect.arrayContaining([
        expect.stringContaining('candidates=missing:0'),
      ]),
    )
    expect(missingCandidateResult.decision.auditSummary?.blockers).toEqual(
      expect.arrayContaining([
        expect.stringContaining('候选节目库未配置'),
      ]),
    )

    const emptyCandidateGateway = new RuntimeSchedulingDataGateway({
      scheduleState: buildScheduleState({ playlistType: 'tv' }),
      reader: {
        getScheduleItems: () => [],
        getProgramCandidates: () => [],
      },
    })
    const emptyCandidateRuntime = new SchedulingAgentRuntime({ dataGateway: emptyCandidateGateway })

    const emptyCandidateResult = await emptyCandidateRuntime.submit({
      userInput: 'insert Replacement News at 10:00',
      channelId: 'dragon',
      date,
      interpretation: {
        intent: 'insert',
        confidence: 1,
        source: 'test',
        slots: {
          targetTime: '10:00:00',
          programHint: 'Replacement News',
        },
      },
    })

    expect(emptyCandidateResult.status).toBe('needs_clarification')
    expect(emptyCandidateResult.decision.auditSummary).toMatchObject({
      contextSources: {
        candidates: {
          source: 'program_candidate_reader',
          available: true,
          recordCount: 0,
        },
      },
    })
    expect(emptyCandidateResult.decision.auditSummary?.keyPoints).toEqual(
      expect.arrayContaining([
        expect.stringContaining('candidates=program_candidate_reader:0'),
      ]),
    )
    expect(emptyCandidateResult.decision.auditSummary?.blockers).not.toEqual(
      expect.arrayContaining([
        expect.stringContaining('候选节目库未配置'),
      ]),
    )
  })

  it('derives auditable candidate query facets from structured Agent intent when reader metadata is absent', async () => {
    const gateway = new RuntimeSchedulingDataGateway({
      scheduleState: buildScheduleState({ playlistType: 'tv' }),
      reader: {
        getScheduleItems: () => [],
        getProgramCandidates: () => [buildCandidate({
          id: 'candidate-city-lens',
          programCode: 'PROMO001',
          programName: 'City Lens',
          instanceName: 'City Lens',
          columnName: 'Tourism',
          programType: 'promo',
          contentTags: ['Shanghai', 'famous tourist attractions', 'promotional video'],
        })],
        getLayoutBounds: () => ({ start: '06:00:00', end: '23:59:59' }),
      },
    })
    const runtime = new SchedulingAgentRuntime({ dataGateway: gateway })

    const result = await runtime.submit({
      userInput: 'insert Shanghai famous tourist attractions promotional video at 10:00',
      channelId: 'dragon',
      date,
      interpretation: {
        intent: 'insert',
        confidence: 1,
        source: 'test',
        slots: {
          targetTime: '10:00:00',
          programHint: 'Shanghai famous tourist attractions promotional video',
        },
      },
    })

    expect(result.status).toBe('executed')
    expect(result.decision.auditSummary?.contextSources?.candidates).toMatchObject({
      source: 'program_candidate_reader',
      recordCount: 1,
      query: {
        keyword: 'Shanghai famous tourist attractions promotional video',
        facets: ['shanghai', 'famous', 'tourist', 'attractions', 'promotional', 'video'],
      },
    })
    expect(result.decision.auditSummary?.keyPoints).toEqual(
      expect.arrayContaining([
        expect.stringContaining('facets=shanghai|famous|tourist|attractions|promotional|video'),
      ]),
    )
  })

  it('derives Chinese content facets instead of forwarding short natural phrases as one opaque query', async () => {
    const gateway = new RuntimeSchedulingDataGateway({
      scheduleState: buildScheduleState({ playlistType: 'rotation' }),
      reader: {
        getScheduleItems: () => [],
        getProgramCandidates: () => [buildCandidate({
          id: 'asset-short-city-flower',
          programCode: '',
          programName: '城市微短片：春日花路 30秒',
          instanceName: '城市微短片：春日花路 30秒',
          columnName: '城市形象',
          programType: 'short_clip',
          contentTags: ['城市形象', '春日花路', '短片', '轮播'],
        })],
      },
    })
    const runtime = new SchedulingAgentRuntime({ dataGateway: gateway })

    const result = await runtime.submit({
      userInput: '0点插入城市形象春日花路短片',
      channelId: 'rotation-demo',
      date,
      interpretation: {
        intent: 'insert',
        confidence: 1,
        source: 'test',
        slots: {
          targetTime: '00:00:00',
          programHint: '城市形象春日花路短片',
        },
      },
    })

    expect(result.status).toBe('needs_confirmation')
    expect(result.decision.auditSummary?.contextSources?.candidates).toMatchObject({
      source: 'program_candidate_reader',
      recordCount: 1,
      query: {
        keyword: '城市形象春日花路短片',
        facets: ['城市形象', '春日花路', '短片'],
      },
    })
    expect(result.decision.auditSummary?.keyPoints).toEqual(
      expect.arrayContaining([
        expect.stringContaining('facets=城市形象|春日花路|短片'),
      ]),
    )
  })

  it('turns candidate source read failures into auditable source-missing blockers', async () => {
    const gateway = new RuntimeSchedulingDataGateway({
      scheduleState: buildScheduleState({ playlistType: 'tv' }),
      reader: {
        getScheduleItems: () => [],
        getProgramCandidates: async () => {
          throw new Error('program library timeout')
        },
      },
    })
    const runtime = new SchedulingAgentRuntime({ dataGateway: gateway })

    const result = await runtime.submit({
      userInput: 'insert Replacement News at 10:00',
      channelId: 'dragon',
      date,
      interpretation: {
        intent: 'insert',
        confidence: 1,
        source: 'test',
        slots: {
          targetTime: '10:00:00',
          programHint: 'Replacement News',
        },
      },
    })

    expect(result.status).toBe('blocked')
    expect(result.decision.constraintReport?.issues[0]).toMatchObject({
      code: 'candidate_source_missing',
      severity: 'critical',
      detail: {
        source: 'none',
        recordCount: 0,
        available: false,
      },
    })
    expect(result.decision.auditSummary).toMatchObject({
      contextSources: {
        candidates: {
          source: 'none',
          available: false,
          recordCount: 0,
        },
      },
      constraintIssueCodes: ['candidate_source_missing'],
    })
    expect(result.decision.auditSummary?.keyPoints).toEqual(
      expect.arrayContaining([
        expect.stringContaining('candidates=missing:0'),
      ]),
    )
  })

  it('turns current schedule source read failures into auditable write blockers', async () => {
    const gateway = new RuntimeSchedulingDataGateway({
      scheduleState: buildScheduleState({ playlistType: 'tv' }),
      reader: {
        getScheduleItems: async () => {
          throw new Error('schedule reader timeout')
        },
        getProgramCandidates: () => [buildCandidate()],
      },
    })
    const runtime = new SchedulingAgentRuntime({ dataGateway: gateway })

    const context = await gateway.loadContext({
      userInput: '',
      channelId: 'dragon',
      date,
    })
    expect(context.scheduleItems).toEqual([])
    expect(context.bundle.sources.today).toMatchObject({
      source: 'none',
      available: false,
      recordCount: 0,
    })

    const result = await runtime.submit({
      userInput: 'insert Replacement News at 10:00',
      channelId: 'dragon',
      date,
      interpretation: {
        intent: 'insert',
        confidence: 1,
        source: 'test',
        slots: {
          targetTime: '10:00:00',
          programHint: 'Replacement News',
        },
      },
    })

    expect(result.status).toBe('blocked')
    expect(result.decision.constraintReport?.issues[0]).toMatchObject({
      code: 'schedule_source_missing',
      severity: 'critical',
      detail: {
        source: 'none',
        recordCount: 0,
        available: false,
      },
    })
    expect(result.decision.auditSummary).toMatchObject({
      contextSources: {
        today: {
          source: 'none',
          available: false,
          recordCount: 0,
        },
      },
      constraintIssueCodes: ['schedule_source_missing'],
    })
    expect(result.decision.auditSummary?.keyPoints).toEqual(
      expect.arrayContaining([
        expect.stringContaining('today=missing:0'),
      ]),
    )
  })

  it('keeps context usable when history and constraint sources fail', async () => {
    const gateway = new RuntimeSchedulingDataGateway({
      scheduleState: buildScheduleState({ playlistType: 'tv' }),
      reader: {
        getScheduleItems: () => [buildRuntimeItem()],
        getProgramCandidates: () => [buildCandidate()],
        getHistorySchedules: async () => {
          throw new Error('history timeout')
        },
        getLayoutBounds: async () => {
          throw new Error('layout timeout')
        },
        getLockedItemIds: async () => {
          throw new Error('lock timeout')
        },
        getBlockedTimeRanges: async () => {
          throw new Error('blocked range timeout')
        },
      },
    })

    const context = await gateway.loadContext({
      userInput: '',
      channelId: 'dragon',
      date,
    })

    expect(context.scheduleItems).toHaveLength(1)
    expect(context.programCandidates).toHaveLength(1)
    expect(context.historySchedules).toEqual([])
    expect(context.layoutBounds).toBeUndefined()
    expect(context.lockedItemIds).toEqual([])
    expect(context.blockedTimeRanges).toEqual([])
    expect(context.bundle.sources).toMatchObject({
      today: {
        source: 'runtime_schedule_reader',
        available: true,
        recordCount: 1,
      },
      candidates: {
        source: 'program_candidate_reader',
        available: true,
        recordCount: 1,
      },
      history: {
        source: 'none',
        available: false,
        recordCount: 0,
        status: 'unavailable',
        errorCode: 'read_failed',
      },
      constraints: {
        source: 'none',
        available: false,
        recordCount: 0,
        status: 'unavailable',
        errorCode: 'read_failed',
      },
    })
  })
})
