import { describe, expect, it } from 'vitest'

import { InMemorySchedulingDataGateway } from '@/services/agent/inMemorySchedulingDataGateway'
import { buildAgentLlmContextPackage } from '@/services/agent/llmContextPackage'
import { createPendingTask } from '@/services/agent/agentSession'
import type { AgentProgramCandidate } from '@/services/agent/types'
import type { ScheduleItemSnapshot, ScheduleSummary } from '@/types/orchestration'

const date = '2026-03-25'

const buildItem = (patch: Partial<ScheduleItemSnapshot> = {}): ScheduleItemSnapshot => ({
  id: 'item-episode-3',
  programId: 'series-storm',
  programCode: 'STORM0003',
  programName: 'Quality Theater Storm',
  instanceName: 'Quality Theater Storm Episode 3',
  startTime: '19:00:00',
  endTime: '19:45:00',
  duration: 2700,
  programType: 'drama',
  sequence: 1,
  ...patch,
})

const buildCandidate = (patch: Partial<AgentProgramCandidate> = {}): AgentProgramCandidate => ({
  id: 'candidate-episode-4',
  programId: 'series-storm',
  programCode: 'STORM0004',
  programName: 'Quality Theater Storm',
  instanceName: 'Quality Theater Storm Episode 4',
  channelId: 'dragon',
  columnId: 'drama',
  columnName: 'Quality Theater',
  duration: 2700,
  programType: 'drama',
  issueNo: '0004',
  contentTags: ['drama', 'episode'],
  materialStatus: 'ready',
  rightsStatus: 'ready',
  ...patch,
})

const withIssueNo = (item: ScheduleItemSnapshot, issueNo: string): ScheduleItemSnapshot => ({
  ...item,
  issueNo,
} as ScheduleItemSnapshot)

describe('Agent LLM context package', () => {
  it('packs TV sequence evidence from today, latest history, and candidates', async () => {
    const history: ScheduleSummary[] = [{
      date: '2026-03-24',
      itemCount: 1,
      programTypes: { drama: 1 },
      items: [withIssueNo(buildItem({
        id: 'history-episode-2',
        programCode: 'STORM0002',
        instanceName: 'Quality Theater Storm Episode 2',
        startTime: '20:00:00',
        endTime: '20:45:00',
      }), '0002')],
    }]
    const gateway = new InMemorySchedulingDataGateway([{
      channelId: 'dragon',
      date,
      playlistType: 'tv',
      scheduleItems: [withIssueNo(buildItem(), '0003')],
      programCandidates: [
        buildCandidate(),
        buildCandidate({
          id: 'candidate-episode-5',
          programCode: 'STORM0005',
          instanceName: 'Quality Theater Storm Episode 5',
          issueNo: '0005',
        }),
      ],
      historySchedules: history,
      layoutBounds: { start: '06:00:00', end: '23:59:59' },
    }])

    const context = await gateway.loadContext({ userInput: 'insert next episode', channelId: 'dragon', date })
    const llmContextPackage = buildAgentLlmContextPackage(context)

    expect(llmContextPackage.identity).toMatchObject({
      playlistType: 'tv',
      channelId: 'dragon',
      date,
    })
    expect(llmContextPackage.playlistSemantics).toMatchObject({
      model: 'time_grid',
    })
    expect(llmContextPackage.playlistSemantics.positionMeaning).toContain('播出时间格')
    expect(llmContextPackage.playlistSemantics.draftBoundary).toContain('普通原子操作不因草案存在而改写草案')
    expect(llmContextPackage.currentSchedule).toEqual([
      expect.objectContaining({
        itemId: 'item-episode-3',
        programId: 'series-storm',
        programCode: 'STORM0003',
        instanceName: 'Quality Theater Storm Episode 3',
        issueNo: '0003',
      }),
    ])
    expect(llmContextPackage.latestHistory).toMatchObject({
      date: '2026-03-24',
      samples: [
        expect.objectContaining({
          programId: 'series-storm',
          programCode: 'STORM0002',
          instanceName: 'Quality Theater Storm Episode 2',
          issueNo: '0002',
        }),
      ],
    })
    expect(llmContextPackage.candidateSummary).toEqual([
      expect.objectContaining({
        candidateId: 'candidate-episode-4',
        programId: 'series-storm',
        programCode: 'STORM0004',
        instanceName: 'Quality Theater Storm Episode 4',
        issueNo: '0004',
      }),
      expect.objectContaining({
        candidateId: 'candidate-episode-5',
        issueNo: '0005',
      }),
    ])
    expect(llmContextPackage.guardrails).toEqual(
      expect.arrayContaining([
        expect.stringContaining('TV playlist inserts and replacements must preserve sequence'),
        expect.stringContaining('LLM only extracts intent'),
      ]),
    )
  })

  it('keeps programme-code-less short clips searchable for rotation playlists', async () => {
    const gateway = new InMemorySchedulingDataGateway([{
      channelId: 'dragon',
      date,
      playlistType: 'rotation',
      rotationStrategy: 'content_match',
      rotationDurationSeconds: 60 * 60,
      scheduleItems: [buildItem({
        id: 'rotation-existing',
        startTime: '00:00:00',
        endTime: '00:30:00',
      })],
      programCandidates: [
        buildCandidate({
          id: 'asset-city-flower-30s',
          programId: 'asset-city-flower-30s',
          programCode: '',
          programName: 'City Image Clip Spring Flower Road',
          instanceName: 'City Image Clip Spring Flower Road 30s',
          columnId: 'rotation',
          columnName: 'Rotation Short Clip',
          duration: 30,
          programType: 'short_clip',
          issueNo: undefined,
          contentTags: ['city image', 'spring flower road', 'short clip', 'no programme code'],
        }),
      ],
      historySchedules: [{
        date: '2026-03-24',
        itemCount: 1,
        programTypes: { short_clip: 1 },
        items: [buildItem({ id: 'history-rotation', startTime: '00:00:00', endTime: '00:30:00' })],
      }],
      layoutBounds: { start: '06:00:00', end: '23:59:59' },
    }])

    const context = await gateway.loadContext({
      userInput: 'find city image short clips without programme codes',
      channelId: 'dragon',
      date,
    })
    const llmContextPackage = buildAgentLlmContextPackage(context)

    expect(llmContextPackage.identity).toMatchObject({
      playlistType: 'rotation',
      rotationStrategy: 'content_match',
      rotationDurationSeconds: 60 * 60,
      durationScope: '内容队列总时长1小时',
      positionBasis: 'relative_from_zero',
    })
    expect(llmContextPackage.identity).not.toHaveProperty('channelId')
    expect(llmContextPackage.identity).not.toHaveProperty('date')
    expect(llmContextPackage.playlistSemantics).toMatchObject({
      model: 'content_queue',
    })
    expect(llmContextPackage.playlistSemantics.positionMeaning).toContain('内容队列')
    expect(llmContextPackage.playlistSemantics.positionMeaning).toContain('相对位置')
    expect(llmContextPackage.playlistSemantics.draftBoundary).toContain('整体编排和整体补排需要草案')
    expect(llmContextPackage.playlistSemantics.writeBoundary).toContain('先给候选或待确认')
    expect(llmContextPackage.currentSchedule[0]).toMatchObject({
      itemId: 'rotation-existing',
      positionBasis: 'relative_from_zero',
    })
    expect(llmContextPackage.latestHistory).toBeUndefined()
    expect(llmContextPackage.budget.latestHistoryItems).toBeUndefined()
    expect(llmContextPackage.constraints.layoutBounds).toBeUndefined()
    expect(llmContextPackage.constraints.blockedTimeRanges).toEqual([])
    expect(llmContextPackage.candidateSummary).toEqual([
      expect.objectContaining({
        candidateId: 'asset-city-flower-30s',
        programId: 'asset-city-flower-30s',
        programCode: '',
        programType: 'short_clip',
        contentTags: expect.arrayContaining(['city image', 'no programme code']),
      }),
    ])
    expect(llmContextPackage.guardrails).toEqual(
      expect.arrayContaining([
        expect.stringContaining('programme-code-less short clips'),
        expect.stringContaining('require confirmation'),
      ]),
    )
  })

  it('records context budget and truncation evidence for LLM interpretation', async () => {
    const scheduleItems = Array.from({ length: 15 }, (_, index) => buildItem({
      id: `item-${index + 1}`,
      programCode: `S${String(index + 1).padStart(4, '0')}`,
      startTime: `${String(6 + index).padStart(2, '0')}:00:00`,
      endTime: `${String(6 + index).padStart(2, '0')}:30:00`,
      duration: 1800,
    }))
    const programCandidates = Array.from({ length: 20 }, (_, index) => buildCandidate({
      id: `candidate-${index + 1}`,
      programCode: `C${String(index + 1).padStart(4, '0')}`,
      contentTags: ['tag-a', 'tag-b', 'tag-c', 'tag-d', 'tag-e', 'tag-f', 'tag-g'],
    }))
    const historyItems = Array.from({ length: 10 }, (_, index) => buildItem({
      id: `history-${index + 1}`,
      programCode: `H${String(index + 1).padStart(4, '0')}`,
    }))
    const gateway = new InMemorySchedulingDataGateway([{
      channelId: 'dragon',
      date,
      playlistType: 'tv',
      scheduleItems,
      programCandidates,
      historySchedules: [{
        date: '2026-03-24',
        itemCount: historyItems.length,
        programTypes: { drama: historyItems.length },
        items: historyItems,
      }],
    }])

    const context = await gateway.loadContext({
      userInput: 'insert next episode',
      channelId: 'dragon',
      date,
    })
    const llmContextPackage = buildAgentLlmContextPackage(context)

    expect(llmContextPackage.currentSchedule).toHaveLength(6)
    expect(llmContextPackage.candidateSummary).toHaveLength(6)
    expect(llmContextPackage.latestHistory?.samples).toHaveLength(3)
    expect(llmContextPackage.candidateSummary[0]?.contentTags).toHaveLength(4)
    expect(llmContextPackage.budget).toMatchObject({
      scheduleItems: {
        included: 6,
        total: 15,
        limit: 6,
        truncated: true,
      },
      candidates: {
        included: 6,
        total: 20,
        limit: 6,
        truncated: true,
      },
      latestHistoryItems: {
        included: 3,
        total: 10,
        limit: 3,
        truncated: true,
      },
      contentTagsPerCandidate: {
        limit: 4,
      },
    })
  })

  it('keeps source summary compact because detailed evidence is already structured elsewhere', async () => {
    const gateway = new InMemorySchedulingDataGateway([{
      channelId: 'dragon',
      date,
      playlistType: 'tv',
      scheduleItems: [buildItem({
        id: 'item-news',
        programName: 'Morning News',
        startTime: '09:00:00',
        endTime: '09:30:00',
      })],
      programCandidates: [buildCandidate({
        id: 'candidate-news',
        programName: 'Morning News',
        instanceName: 'Morning News Issue 12',
      })],
      historySchedules: [{
        date: '2026-03-24',
        itemCount: 1,
        programTypes: { news: 1 },
        items: [buildItem({
          id: 'history-news',
          programName: 'Morning News Issue 11',
        })],
      }],
    }])

    const context = await gateway.loadContext({
      userInput: '9点插入节目Morning News',
      channelId: 'dragon',
      date,
    })
    const llmContextPackage = buildAgentLlmContextPackage(context)

    expect(llmContextPackage.sourceSummary.length).toBeGreaterThan(0)
    expect(llmContextPackage.sourceSummary.every((source) => source.samples === undefined)).toBe(true)
    expect(llmContextPackage.currentSchedule[0]?.programName).toBe('Morning News')
    expect(llmContextPackage.candidateSummary[0]?.programName).toBe('Morning News')
    expect(llmContextPackage.latestHistory?.samples[0]?.programName).toBe('Morning News Issue 11')
  })

  it('prioritizes user-relevant evidence inside the LLM context budget', async () => {
    const scheduleItems = Array.from({ length: 16 }, (_, index) => buildItem({
      id: `item-${index + 1}`,
      programCode: `S${String(index + 1).padStart(4, '0')}`,
      programName: index === 14 ? 'Late Special Report' : `Regular Programme ${index + 1}`,
      startTime: `${String(6 + index).padStart(2, '0')}:00:00`,
      endTime: `${String(6 + index).padStart(2, '0')}:30:00`,
      duration: 1800,
    }))
    const programCandidates = Array.from({ length: 18 }, (_, index) => buildCandidate({
      id: `candidate-${index + 1}`,
      programCode: `C${String(index + 1).padStart(4, '0')}`,
      programName: index === 16 ? 'City Image Spring Flower Road Short Clip' : `Candidate ${index + 1}`,
      instanceName: index === 16 ? 'City Image Spring Flower Road 30s' : `Candidate ${index + 1}`,
      contentTags: index === 16
        ? ['city image', 'spring flower road', 'short clip']
        : ['regular'],
    }))
    const gateway = new InMemorySchedulingDataGateway([{
      channelId: 'dragon',
      date,
      playlistType: 'tv',
      scheduleItems,
      programCandidates,
    }])

    const context = await gateway.loadContext({
      userInput: 'delete Late Special at 20:00',
      channelId: 'dragon',
      date,
    })
    const pendingTask = createPendingTask({
      intent: 'insert',
      phase: 'needs_clarification',
      originalInput: 'insert city image spring flower road short clip',
      collectedSlots: {
        programHint: {
          value: 'City Image Spring Flower Road',
          source: 'user_initial',
          confidence: 1,
        },
      },
      missingSlots: ['targetTime'],
    })

    const llmContextPackage = buildAgentLlmContextPackage(context, {
      userInput: 'delete Late Special at 20:00',
      pendingTask,
    })

    expect(llmContextPackage.currentSchedule).toHaveLength(10)
    expect(llmContextPackage.currentSchedule.map((item) => item.itemId)).toContain('item-15')
    expect(llmContextPackage.candidateSummary).toHaveLength(10)
    expect(llmContextPackage.candidateSummary.map((candidate) => candidate.candidateId)).toContain('candidate-17')
    expect(llmContextPackage.budget.scheduleItems).toMatchObject({
      included: 10,
      total: 16,
      truncated: true,
    })
    expect(llmContextPackage.budget.candidates).toMatchObject({
      included: 10,
      total: 18,
      truncated: true,
    })
  })
})
