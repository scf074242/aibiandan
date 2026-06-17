import { describe, expect, it, vi } from 'vitest'

import { InMemorySchedulingDataGateway } from '@/services/agent/inMemorySchedulingDataGateway'
import { SchedulingAgentRuntime } from '@/services/agent/schedulingAgentRuntime'
import {
  buildNlMatrixCandidate,
  buildNlMatrixItem,
  naturalLanguageAtomicCommandCases,
  nlMatrixChannelId,
  nlMatrixDate,
} from './fixtures/naturalLanguageAtomicCommandCases'
import type { AgentIntentInterpreter } from '@/services/agent/types'

describe('SchedulingAgentRuntime natural-language atomic command matrix', () => {
  it.each(naturalLanguageAtomicCommandCases)(
    '$id maps natural language to the expected atomic command outcome',
    async (testCase) => {
      const dataGateway = new InMemorySchedulingDataGateway([{
        channelId: nlMatrixChannelId,
        date: nlMatrixDate,
        playlistType: testCase.playlistType,
        rotationStrategy: testCase.rotationStrategy,
        scheduleItems: testCase.items ?? [buildNlMatrixItem()],
        programCandidates: testCase.candidates,
        broadcastReadiness: [],
        historySchedules: [],
        lockedItemIds: testCase.lockedItemIds ?? [],
        blockedTimeRanges: testCase.blockedTimeRanges ?? [],
        layoutBounds: { start: '06:00:00', end: '23:59:59' },
      }])
      const interpreter: AgentIntentInterpreter = {
        usesLlm: true,
        interpret: vi.fn(async () => testCase.interpretation),
      }
      const runtime = new SchedulingAgentRuntime({
        dataGateway,
        intentInterpreter: interpreter,
      })

      const result = await runtime.submit({
        userInput: testCase.utterance,
        channelId: nlMatrixChannelId,
        date: nlMatrixDate,
      })

      expect(interpreter.interpret).toHaveBeenCalledWith(expect.objectContaining({
        userInput: testCase.utterance,
        channelId: nlMatrixChannelId,
        date: nlMatrixDate,
      }))
      expect(result.input.interpretation).toMatchObject(testCase.interpretation)
      expect(result.status).toBe(testCase.expected.status)

      if (testCase.expected.intent) {
        expect(result.decision.intent).toBe(testCase.expected.intent)
      }
      if (testCase.expected.commandIntent) {
        expect(result.decision.command).toMatchObject({
          intent: testCase.expected.commandIntent,
        })
        expect(result.decision.auditSummary?.operation.previewSummary).toEqual(
          expect.arrayContaining([
            `intent=${testCase.expected.commandIntent}`,
          ]),
        )
      }
      if (testCase.expected.pendingIntent) {
        expect(result.decision.pendingTask).toMatchObject({
          intent: testCase.expected.pendingIntent,
        })
      }
      if (testCase.expected.issueCode) {
        expect(result.decision.constraintReport?.issues).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              code: testCase.expected.issueCode,
            }),
          ]),
        )
      }
      if (testCase.expected.queryKind) {
        expect(result.decision.queryResult).toMatchObject({
          kind: testCase.expected.queryKind,
        })
      }
      if (testCase.expected.selectedCandidateId) {
        expect(result.decision.candidateSelection).toMatchObject({
          selectedCandidateId: testCase.expected.selectedCandidateId,
        })
      }

      const context = await dataGateway.loadContext({
        userInput: '',
        channelId: nlMatrixChannelId,
        date: nlMatrixDate,
      })
      expect(context.scheduleItems).toHaveLength(testCase.expected.committedCount ?? context.scheduleItems.length)
    },
  )

  it('continues a rotation short-clip insert through explicit confirmation', async () => {
    const shortClip = buildNlMatrixCandidate({
      id: 'asset-short-city-flower',
      programId: 'asset-short-city-flower',
      programCode: '',
      programName: '城市微短片：春日花路 30秒',
      instanceName: '城市微短片：春日花路 30秒',
      columnId: 'rotation',
      columnName: '轮播短片',
      duration: 30,
      programType: 'short_clip',
      contentTags: ['城市形象', '春日花路', '短片', '无节目编号', '轮播'],
    })
    const dataGateway = new InMemorySchedulingDataGateway([{
      channelId: nlMatrixChannelId,
      date: nlMatrixDate,
      playlistType: 'rotation',
      rotationStrategy: 'content_match',
      scheduleItems: [buildNlMatrixItem({
        id: 'item-clip-0900',
        programName: '早间轮播短片',
        startTime: '09:00:00',
        endTime: '09:00:30',
        duration: 30,
        programType: 'short_clip',
      })],
      programCandidates: [shortClip],
      broadcastReadiness: [],
      historySchedules: [],
      layoutBounds: { start: '06:00:00', end: '23:59:59' },
    }])
    const runtime = new SchedulingAgentRuntime({ dataGateway })

    const first = await runtime.submit({
      userInput: '10点插入城市形象春日花路短片',
      channelId: nlMatrixChannelId,
      date: nlMatrixDate,
      interpretation: {
        intent: 'insert',
        confidence: 0.95,
        source: 'test',
        slots: { targetTime: '10:00:00', programHint: '城市形象春日花路短片' },
      },
    })

    expect(first.status).toBe('needs_confirmation')
    expect(first.decision.pendingTask).toMatchObject({
      intent: 'insert',
      phase: 'needs_confirmation',
    })

    const result = await runtime.submit({
      userInput: '确认',
      channelId: nlMatrixChannelId,
      date: nlMatrixDate,
      pendingTask: first.decision.pendingTask,
      interpretation: {
        intent: 'insert',
        pendingAction: 'confirm',
        confidence: 0.98,
        source: 'test',
      },
    })

    expect(result.status).toBe('executed')
    expect(result.decision.command).toMatchObject({
      intent: 'insert',
      candidateId: 'asset-short-city-flower',
    })

    const context = await dataGateway.loadContext({
      userInput: '',
      channelId: nlMatrixChannelId,
      date: nlMatrixDate,
    })
    expect(context.scheduleItems).toHaveLength(2)
    expect(context.scheduleItems[1]).toMatchObject({
      programCode: '',
      programName: '城市微短片：春日花路 30秒',
    })
  })

  it('retries candidate matching with LLM keyword rewrites before asking for a new programme hint', async () => {
    const rewrittenCandidate = buildNlMatrixCandidate({
      id: 'candidate-shanghai-morning-news',
      programId: 'program-shanghai-morning-news',
      programCode: 'SHNEWS0700',
      programName: '上海早新闻',
      instanceName: '上海早新闻',
      columnId: 'rotation-news',
      columnName: '轮播资讯',
      programType: 'news',
      contentTags: ['上海', '早新闻', '资讯'],
    })
    const dataGateway = new InMemorySchedulingDataGateway([{
      channelId: nlMatrixChannelId,
      date: nlMatrixDate,
      playlistType: 'rotation',
      rotationStrategy: 'content_match',
      scheduleItems: [],
      programCandidates: [rewrittenCandidate],
      broadcastReadiness: [],
      historySchedules: [],
      layoutBounds: { start: '06:00:00', end: '23:59:59' },
    }])
    const runtime = new SchedulingAgentRuntime({ dataGateway })

    const result = await runtime.submit({
      userInput: '10点插入上视早间资讯',
      channelId: nlMatrixChannelId,
      date: nlMatrixDate,
      interpretation: {
        intent: 'insert',
        confidence: 0.96,
        source: 'test',
        slots: { targetTime: '10:00:00', programHint: '上视早间资讯' },
        searchAlternatives: ['上海早新闻', '东方卫视 早新闻'],
      },
    })

    expect(result.status).toBe('needs_confirmation')
    expect(result.decision.pendingTask).toMatchObject({
      intent: 'insert',
      phase: 'needs_confirmation',
      collectedSlots: {
        candidateId: expect.objectContaining({
          value: 'candidate-shanghai-morning-news',
        }),
      },
    })
    expect(result.decision.constraintReport?.issues ?? []).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'program_not_found' }),
      ]),
    )
    expect(result.trace).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          detail: expect.objectContaining({
            matchedBy: 'rewritten_keywords',
            attempts: expect.arrayContaining([
              expect.objectContaining({
                keyword: '上海早新闻',
                source: 'llm_alternative',
                candidateCount: 1,
              }),
            ]),
          }),
        }),
      ]),
    )
  })

  it('uses LLM keyword rewrites for candidate lookup queries', async () => {
    const rewrittenCandidate = buildNlMatrixCandidate({
      id: 'candidate-city-flower-road',
      programId: 'program-city-flower-road',
      programCode: '',
      programName: '城市微短片：春日花路 30秒',
      instanceName: '城市微短片：春日花路 30秒',
      columnId: 'rotation-short-clip',
      columnName: '轮播短片',
      programType: 'short_clip',
      contentTags: ['城市形象', '春日花路', '短片', '无节目编号'],
      duration: 30,
    })
    const dataGateway = new InMemorySchedulingDataGateway([{
      channelId: nlMatrixChannelId,
      date: nlMatrixDate,
      playlistType: 'rotation',
      rotationStrategy: 'content_match',
      scheduleItems: [],
      programCandidates: [rewrittenCandidate],
      broadcastReadiness: [],
      historySchedules: [],
      layoutBounds: { start: '06:00:00', end: '23:59:59' },
    }])
    const runtime = new SchedulingAgentRuntime({ dataGateway })

    const result = await runtime.submit({
      userInput: '查一下城市形象春季花路视频素材',
      channelId: nlMatrixChannelId,
      date: nlMatrixDate,
      interpretation: {
        intent: 'query',
        confidence: 0.96,
        source: 'test',
        queryKind: 'candidate_lookup',
        keyword: '城市形象春季花路视频素材',
        searchAlternatives: ['城市形象 春日花路 短片', '春日花路 30秒'],
      },
    })

    expect(result.status).toBe('executed')
    expect(result.decision.queryResult).toMatchObject({
      kind: 'candidate_lookup',
      totalCount: 1,
      candidateSearchMatchedBy: 'rewritten_keywords',
      candidates: [
        expect.objectContaining({
          id: 'candidate-city-flower-road',
          programCode: '',
        }),
      ],
      searchAttempts: expect.arrayContaining([
        expect.objectContaining({
          keyword: '城市形象 春日花路 短片',
          source: 'llm_alternative',
          candidateCount: 1,
        }),
      ]),
    })
    expect(result.trace).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          detail: expect.objectContaining({
            matchedBy: 'rewritten_keywords',
            attempts: expect.arrayContaining([
              expect.objectContaining({
                keyword: '城市形象 春日花路 短片',
                source: 'llm_alternative',
                candidateCount: 1,
              }),
            ]),
          }),
        }),
      ]),
    )
  })

  it('cancels a pending delete without committing the deletion', async () => {
    const dataGateway = new InMemorySchedulingDataGateway([{
      channelId: nlMatrixChannelId,
      date: nlMatrixDate,
      playlistType: 'tv',
      scheduleItems: [buildNlMatrixItem()],
      programCandidates: [],
      broadcastReadiness: [],
      historySchedules: [],
      layoutBounds: { start: '06:00:00', end: '23:59:59' },
    }])
    const runtime = new SchedulingAgentRuntime({ dataGateway })

    const first = await runtime.submit({
      userInput: '删除看东方',
      channelId: nlMatrixChannelId,
      date: nlMatrixDate,
      interpretation: {
        intent: 'delete',
        confidence: 0.96,
        source: 'test',
        slots: { targetProgramName: '看东方' },
      },
    })
    expect(first.status).toBe('needs_confirmation')

    const result = await runtime.submit({
      userInput: '取消刚才的操作',
      channelId: nlMatrixChannelId,
      date: nlMatrixDate,
      pendingTask: first.decision.pendingTask,
      interpretation: {
        intent: 'delete',
        pendingAction: 'cancel_pending',
        confidence: 0.98,
        source: 'test',
      },
    })

    expect(result.status).toBe('needs_clarification')
    expect(result.decision.pendingTask).toBeUndefined()
    expect(result.executionResult).toBeUndefined()

    const context = await dataGateway.loadContext({
      userInput: '',
      channelId: nlMatrixChannelId,
      date: nlMatrixDate,
    })
    expect(context.scheduleItems).toHaveLength(1)
  })

  it('starts a new query instead of continuing a pending rotation insert', async () => {
    const candidate = buildNlMatrixCandidate()
    const dataGateway = new InMemorySchedulingDataGateway([{
      channelId: nlMatrixChannelId,
      date: nlMatrixDate,
      playlistType: 'rotation',
      rotationStrategy: 'content_match',
      scheduleItems: [],
      programCandidates: [candidate],
      broadcastReadiness: [],
      historySchedules: [],
      layoutBounds: { start: '06:00:00', end: '23:59:59' },
    }])
    const runtime = new SchedulingAgentRuntime({ dataGateway })

    const first = await runtime.submit({
      userInput: '10点插入东方新闻',
      channelId: nlMatrixChannelId,
      date: nlMatrixDate,
      interpretation: {
        intent: 'insert',
        confidence: 0.95,
        source: 'test',
        slots: { targetTime: '10:00:00', programHint: '东方新闻' },
      },
    })
    expect(first.status).toBe('needs_confirmation')

    const result = await runtime.submit({
      userInput: '先查一下东方新闻候选',
      channelId: nlMatrixChannelId,
      date: nlMatrixDate,
      pendingTask: first.decision.pendingTask,
      interpretation: {
        intent: 'query',
        pendingAction: 'start_new_task',
        confidence: 0.97,
        source: 'test',
        queryKind: 'candidate_lookup',
        keyword: '东方新闻',
      },
    })

    expect(result.status).toBe('executed')
    expect(result.decision.pendingTask).toBeUndefined()
    expect(result.decision.queryResult).toMatchObject({
      kind: 'candidate_lookup',
      totalCount: 1,
    })

    const context = await dataGateway.loadContext({
      userInput: '',
      channelId: nlMatrixChannelId,
      date: nlMatrixDate,
    })
    expect(context.scheduleItems).toHaveLength(0)
  })

  it('selects one ambiguous move target and then executes the planned move', async () => {
    const dataGateway = new InMemorySchedulingDataGateway([{
      channelId: nlMatrixChannelId,
      date: nlMatrixDate,
      playlistType: 'tv',
      scheduleItems: [
        buildNlMatrixItem(),
        buildNlMatrixItem({
          id: 'item-kdf-1030',
          startTime: '10:30:00',
          endTime: '11:00:00',
          sequence: 2,
        }),
      ],
      programCandidates: [],
      broadcastReadiness: [],
      historySchedules: [],
      layoutBounds: { start: '06:00:00', end: '23:59:59' },
    }])
    const runtime = new SchedulingAgentRuntime({ dataGateway })

    const first = await runtime.submit({
      userInput: '把《看东方》移到10点',
      channelId: nlMatrixChannelId,
      date: nlMatrixDate,
      interpretation: {
        intent: 'move',
        confidence: 0.95,
        source: 'test',
        slots: { targetProgramName: '看东方', newStartTime: '10:00:00' },
      },
    })

    expect(first.status).toBe('needs_clarification')
    expect(first.decision.pendingTask).toMatchObject({
      intent: 'move',
      phase: 'needs_clarification',
      targetOptions: expect.arrayContaining([
        expect.objectContaining({ itemId: 'item-kdf-0900' }),
      ]),
    })

    const result = await runtime.submit({
      userInput: '选第一条',
      channelId: nlMatrixChannelId,
      date: nlMatrixDate,
      pendingTask: first.decision.pendingTask,
      interpretation: {
        intent: 'move',
        pendingAction: 'select_candidate',
        confidence: 0.98,
        source: 'test',
        slots: { targetItemId: 'item-kdf-0900' },
      },
    })

    expect(result.status).toBe('executed')
    expect(result.decision.command).toMatchObject({
      intent: 'move',
      itemId: 'item-kdf-0900',
      newStartTime: '2026-03-25T10:00:00+08:00',
    })

    const context = await dataGateway.loadContext({
      userInput: '',
      channelId: nlMatrixChannelId,
      date: nlMatrixDate,
    })
    expect(context.scheduleItems.find((item) => item.id === 'item-kdf-0900')?.startTime)
      .toBe('2026-03-25T10:00:00+08:00')
  })
})
