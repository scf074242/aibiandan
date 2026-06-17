import { describe, expect, it } from 'vitest'

import { InMemorySchedulingDataGateway } from '@/services/agent/inMemorySchedulingDataGateway'
import { SchedulingAgentRuntime } from '@/services/agent/schedulingAgentRuntime'
import type { PlaylistType, RotationPlaylistStrategy, ScheduleItemSnapshot } from '@/types/orchestration'
import type { AgentProgramCandidate } from '@/services/agent/types'

const date = '2026-03-25'

const buildItem = (patch: Partial<ScheduleItemSnapshot> = {}): ScheduleItemSnapshot => ({
  id: 'item-0900',
  programCode: 'P100001',
  programName: '看东方',
  startTime: '09:00:00',
  endTime: '10:00:00',
  duration: 3600,
  programType: 'news',
  sequence: 1,
  ...patch,
})

const buildRuntime = (options: {
  items: ScheduleItemSnapshot[]
  playlistType?: PlaylistType
  rotationStrategy?: RotationPlaylistStrategy
  programCandidates?: AgentProgramCandidate[]
  lockedItemIds?: string[]
  layoutBounds?: { start: string; end: string }
  blockedTimeRanges?: { start: string; end: string }[]
}) => {
  const dataGateway = new InMemorySchedulingDataGateway([{
    channelId: 'dragon',
    date,
    playlistType: options.playlistType,
    rotationStrategy: options.rotationStrategy,
    scheduleItems: options.items,
    programCandidates: options.programCandidates,
    lockedItemIds: options.lockedItemIds,
    layoutBounds: options.layoutBounds ?? { start: '06:00:00', end: '23:59:59' },
    blockedTimeRanges: options.blockedTimeRanges,
  }])
  return {
    dataGateway,
    runtime: new SchedulingAgentRuntime({ dataGateway }),
  }
}

const buildCandidate = (patch: Partial<AgentProgramCandidate> = {}): AgentProgramCandidate => ({
  id: 'candidate-kdf',
  programId: 'program-kdf',
  programCode: 'KDF001',
  programName: '看东方',
  channelId: 'dragon',
  columnId: 'news',
  columnName: '新闻',
  duration: 1800,
  programType: 'news',
  instanceName: '看东方',
  contentTags: ['新闻'],
  materialStatus: 'ready',
  rightsStatus: 'ready',
  ...patch,
})

describe('SchedulingAgentRuntime move command', () => {
  it('blocks stale commits when the playlist changes before write', async () => {
    const baseGateway = new InMemorySchedulingDataGateway([{
      channelId: 'dragon',
      date,
      playlistType: 'tv',
      scheduleItems: [buildItem()],
      layoutBounds: { start: '06:00:00', end: '23:59:59' },
    }])
    let mutateBeforeCommit = true
    const runtime = new SchedulingAgentRuntime({
      dataGateway: {
        loadContext: (input) => baseGateway.loadContext(input),
        commitScheduleItems: async (input) => {
          if (mutateBeforeCommit) {
            mutateBeforeCommit = false
            baseGateway.seed({
              channelId: 'dragon',
              date,
              playlistType: 'tv',
              scheduleItems: [buildItem({
                startTime: '09:15:00',
                endTime: '10:15:00',
              })],
              layoutBounds: { start: '06:00:00', end: '23:59:59' },
            })
          }
          return baseGateway.commitScheduleItems(input)
        },
      },
    })

    const result = await runtime.submit({
      userInput: 'move 09:00 one hour later',
      channelId: 'dragon',
      date,
      interpretation: {
        intent: 'move',
        confidence: 1,
        source: 'test',
        slots: {
          targetTime: '09:00:00',
          offsetSeconds: 3600,
        },
      },
    })

    expect(result.status).toBe('blocked')
    expect(result.executionResult?.committed).toBe(false)
    expect(result.decision.constraintReport?.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'context_conflict', severity: 'critical' }),
      ]),
    )
    expect(result.decision.auditSummary).toMatchObject({
      outcome: 'blocked',
      constraintIssueCodes: ['context_conflict'],
      operation: {
        committed: false,
      },
    })

    const context = await baseGateway.loadContext({
      userInput: '',
      channelId: 'dragon',
      date,
    })
    expect(context.scheduleItems[0]).toMatchObject({
      id: 'item-0900',
      startTime: '2026-03-25T09:15:00+08:00',
      endTime: '2026-03-25T10:15:00+08:00',
    })
  })

  it('基于数据源完成 09:00 节目后移 1 小时闭环', async () => {
    const { dataGateway, runtime } = buildRuntime({
      items: [buildItem()],
    })

    const result = await runtime.submit({
      userInput: '把9点的节目向后移动1小时',
      channelId: 'dragon',
      date,
    })

    expect(result.status).toBe('executed')
    expect(result.decision.intent).toBe('move')
    expect(result.decision.command).toMatchObject({
      itemId: 'item-0900',
      newStartTime: '2026-03-25T10:00:00+08:00',
      newEndTime: '2026-03-25T11:00:00+08:00',
      offsetSeconds: 3600,
    })
    expect(result.decision.constraintReport?.ok).toBe(true)
    expect(result.validationReport?.ok).toBe(true)
    expect(result.explanation).toContain('移动到 10:00:00')
    expect(result.trace.map((step) => step.status)).toEqual([
      'idle',
      'planning',
      'understanding',
      'resolving_context',
      'planning',
      'previewing',
      'executing',
      'validating',
      'completed',
    ])
    expect(result.trace).toEqual(expect.arrayContaining([
      expect.objectContaining({
        label: 'Agent capability selected for execution.',
        detail: expect.objectContaining({
          capabilityId: 'atomic_command',
        }),
      }),
    ]))

    const context = await dataGateway.loadContext({
      userInput: '',
      channelId: 'dragon',
      date,
    })
    expect(context.scheduleItems[0]).toMatchObject({
      id: 'item-0900',
      startTime: '2026-03-25T10:00:00+08:00',
      endTime: '2026-03-25T11:00:00+08:00',
    })
  })

  it('目标时段已有节目时由约束引擎阻断，不回写数据源', async () => {
    const { dataGateway, runtime } = buildRuntime({
      items: [
        buildItem(),
        buildItem({
          id: 'item-1000',
          programCode: 'P100002',
          programName: '东方新闻',
          startTime: '10:00:00',
          endTime: '11:00:00',
          sequence: 2,
        }),
      ],
    })

    const result = await runtime.submit({
      userInput: '把9点的节目向后移动1小时',
      channelId: 'dragon',
      date,
    })

    expect(result.status).toBe('blocked')
    expect(result.decision.constraintReport?.issues[0]).toMatchObject({
      code: 'time_overlap',
      severity: 'critical',
      detail: {
        conflictItemId: 'item-1000',
        conflictProgramName: '东方新闻',
        conflictRange: {
          start: '2026-03-25T10:00:00+08:00',
          end: '2026-03-25T11:00:00+08:00',
        },
        proposedRange: {
          start: '2026-03-25T10:00:00+08:00',
          end: '2026-03-25T11:00:00+08:00',
        },
        blockedPolicy: 'no_auto_shift_replace_reorder',
      },
    })

    const context = await dataGateway.loadContext({
      userInput: '',
      channelId: 'dragon',
      date,
    })
    expect(context.scheduleItems.find((item) => item.id === 'item-0900')).toMatchObject({
      startTime: '2026-03-25T09:00:00+08:00',
      endTime: '2026-03-25T10:00:00+08:00',
    })
  })

  it('锁定节目不可移动', async () => {
    const { runtime } = buildRuntime({
      items: [buildItem()],
      lockedItemIds: ['item-0900'],
    })

    const result = await runtime.submit({
      userInput: '把9点的节目向后移动1小时',
      channelId: 'dragon',
      date,
    })

    expect(result.status).toBe('blocked')
    expect(result.decision.constraintReport?.issues[0]).toMatchObject({
      code: 'locked_item',
      severity: 'critical',
    })
  })

  it('移动后越出版面边界时阻断', async () => {
    const { runtime } = buildRuntime({
      items: [buildItem()],
      layoutBounds: { start: '08:00:00', end: '23:59:59' },
    })

    const result = await runtime.submit({
      userInput: '把9点的节目提前2小时',
      channelId: 'dragon',
      date,
    })

    expect(result.status).toBe('blocked')
    expect(result.decision.constraintReport?.issues[0]).toMatchObject({
      code: 'out_of_layout_bounds',
      severity: 'critical',
    })
  })

  it('移动连续剧后破坏顺播顺序时阻断', async () => {
    const episode1 = buildItem({
      id: 'episode-1',
      programCode: 'DRAMA0001',
      programName: '品质剧场：纵有疾风起 第1集',
      startTime: '09:00:00',
      endTime: '09:45:00',
      duration: 2700,
      programType: 'drama',
      sequence: 1,
    })
    const episode2 = buildItem({
      id: 'episode-2',
      programCode: 'DRAMA0002',
      programName: '品质剧场：纵有疾风起 第2集',
      startTime: '10:00:00',
      endTime: '10:45:00',
      duration: 2700,
      programType: 'drama',
      sequence: 2,
    })
    const { runtime } = buildRuntime({
      items: [episode1, episode2],
    })

    const result = await runtime.submit({
      userInput: '把10点的节目提前2小时',
      channelId: 'dragon',
      date,
    })

    expect(result.status).toBe('blocked')
    expect(result.decision.constraintReport?.issues[0]).toMatchObject({
      code: 'sequence_violation',
      severity: 'critical',
    })
  })

  it('电视播单插入命令会基于候选池和约束直接落表', async () => {
    const { dataGateway, runtime } = buildRuntime({
      playlistType: 'tv',
      items: [],
      programCandidates: [buildCandidate()],
    })

    const result = await runtime.submit({
      userInput: '在10点插入看东方',
      channelId: 'dragon',
      date,
    })

    expect(result.status).toBe('executed')
    expect(result.decision.intent).toBe('insert')
    expect(result.decision.command).toMatchObject({
      intent: 'insert',
      candidateId: 'candidate-kdf',
      insertTime: '2026-03-25T10:00:00+08:00',
      endTime: '2026-03-25T10:30:00+08:00',
    })
    expect(result.explanation).toContain('电视播单')

    const context = await dataGateway.loadContext({
      userInput: '',
      channelId: 'dragon',
      date,
    })
    expect(context.scheduleItems).toHaveLength(1)
    expect(context.scheduleItems[0]).toMatchObject({
      programName: '看东方',
      startTime: '2026-03-25T10:00:00+08:00',
    })
  })

  it('轮播单插入命令只返回候选确认，不直接落表', async () => {
    const { dataGateway, runtime } = buildRuntime({
      playlistType: 'rotation',
      rotationStrategy: 'content_match',
      items: [],
      programCandidates: [
        buildCandidate(),
        buildCandidate({
          id: 'candidate-kdf-night',
          programCode: 'KDF002',
          programName: '看东方夜新闻',
          instanceName: '看东方夜新闻',
        }),
      ],
    })

    const result = await runtime.submit({
      userInput: '在10点插入看东方',
      channelId: 'dragon',
      date,
    })

    expect(result.status).toBe('needs_confirmation')
    expect(result.decision.intent).toBe('insert')
    expect(result.decision.recommendations?.length).toBeGreaterThan(0)
    expect(result.decision.pendingTask).toMatchObject({
      intent: 'insert',
      phase: 'needs_confirmation',
      missingSlots: ['confirmation'],
    })

    const context = await dataGateway.loadContext({
      userInput: '',
      channelId: 'dragon',
      date,
    })
    expect(context.scheduleItems).toHaveLength(0)
  })

  it('插入缺时间时保存结构化 pendingTask，下一轮补时间后续跑并执行电视播单插入', async () => {
    const { dataGateway, runtime } = buildRuntime({
      playlistType: 'tv',
      items: [],
      programCandidates: [buildCandidate()],
    })

    const first = await runtime.submit({
      userInput: '插入看东方',
      channelId: 'dragon',
      date,
    })

    expect(first.status).toBe('needs_clarification')
    expect(first.decision.pendingTask).toMatchObject({
      intent: 'insert',
      phase: 'needs_clarification',
      missingSlots: ['targetTime'],
      collectedSlots: {
        programHint: {
          value: '看东方',
        },
      },
    })

    const second = await runtime.submit({
      userInput: '10点',
      channelId: 'dragon',
      date,
      pendingTask: first.decision.pendingTask,
    })

    expect(second.status).toBe('executed')
    expect(second.decision.command).toMatchObject({
      intent: 'insert',
      candidateId: 'candidate-kdf',
      insertTime: '2026-03-25T10:00:00+08:00',
    })

    const context = await dataGateway.loadContext({
      userInput: '',
      channelId: 'dragon',
      date,
    })
    expect(context.scheduleItems).toHaveLength(1)
    expect(context.scheduleItems[0]).toMatchObject({
      programName: '看东方',
      startTime: '2026-03-25T10:00:00+08:00',
    })
  })

  it('轮播单插入候选确认后才事务落表', async () => {
    const { dataGateway, runtime } = buildRuntime({
      playlistType: 'rotation',
      rotationStrategy: 'content_match',
      items: [],
      programCandidates: [
        buildCandidate(),
        buildCandidate({
          id: 'candidate-kdf-night',
          programCode: 'KDF002',
          programName: '看东方夜新闻',
          instanceName: '看东方夜新闻',
        }),
      ],
    })

    const first = await runtime.submit({
      userInput: '在10点插入看东方',
      channelId: 'dragon',
      date,
    })

    expect(first.status).toBe('needs_confirmation')
    expect(first.decision.pendingTask?.phase).toBe('needs_confirmation')

    const second = await runtime.submit({
      userInput: '确认',
      channelId: 'dragon',
      date,
      pendingTask: first.decision.pendingTask,
    })

    expect(second.status).toBe('executed')
    expect(second.explanation).toContain('轮播单已确认')

    const context = await dataGateway.loadContext({
      userInput: '',
      channelId: 'dragon',
      date,
    })
    expect(context.scheduleItems).toHaveLength(1)
    expect(context.scheduleItems[0]?.programName).toContain('看东方')
  })

  it('插入候选素材不可播时由约束阻断', async () => {
    const { runtime } = buildRuntime({
      playlistType: 'tv',
      items: [],
      programCandidates: [buildCandidate({ materialStatus: 'missing' })],
    })

    const result = await runtime.submit({
      userInput: '在10点插入看东方',
      channelId: 'dragon',
      date,
    })

    expect(result.status).toBe('blocked')
    expect(result.decision.constraintReport?.issues[0]).toMatchObject({
      code: 'material_not_ready',
      severity: 'critical',
    })
  })

  it('插入时段被占用时阻断且不落表', async () => {
    const { dataGateway, runtime } = buildRuntime({
      playlistType: 'tv',
      items: [buildItem({
        id: 'item-1000',
        startTime: '10:00:00',
        endTime: '10:30:00',
      })],
      programCandidates: [buildCandidate()],
    })

    const result = await runtime.submit({
      userInput: '在10点插入看东方',
      channelId: 'dragon',
      date,
    })

    expect(result.status).toBe('blocked')
    expect(result.decision.constraintReport?.issues[0]).toMatchObject({
      code: 'time_overlap',
      severity: 'critical',
      detail: {
        conflictItemId: 'item-1000',
        conflictProgramName: '看东方',
        conflictRange: {
          start: '2026-03-25T10:00:00+08:00',
          end: '2026-03-25T10:30:00+08:00',
        },
        blockedPolicy: 'no_auto_shift_replace_reorder',
      },
    })

    const context = await dataGateway.loadContext({
      userInput: '',
      channelId: 'dragon',
      date,
    })
    expect(context.scheduleItems).toHaveLength(1)
  })

  it('删除节目首轮只返回确认，不直接落表', async () => {
    const { dataGateway, runtime } = buildRuntime({
      playlistType: 'tv',
      items: [buildItem()],
    })

    const result = await runtime.submit({
      userInput: '删除9点的节目',
      channelId: 'dragon',
      date,
    })

    expect(result.status).toBe('needs_confirmation')
    expect(result.decision.intent).toBe('delete')
    expect(result.decision.command).toMatchObject({
      intent: 'delete',
      itemId: 'item-0900',
      targetTime: '2026-03-25T09:00:00+08:00',
    })
    expect(result.decision.pendingTask).toMatchObject({
      intent: 'delete',
      phase: 'needs_confirmation',
      missingSlots: ['confirmation'],
      collectedSlots: {
        targetItemId: {
          value: 'item-0900',
        },
      },
    })

    const context = await dataGateway.loadContext({
      userInput: '',
      channelId: 'dragon',
      date,
    })
    expect(context.scheduleItems).toHaveLength(1)
  })

  it('删除节目确认后才事务落表', async () => {
    const { dataGateway, runtime } = buildRuntime({
      playlistType: 'tv',
      items: [buildItem()],
    })

    const first = await runtime.submit({
      userInput: '删除9点的节目',
      channelId: 'dragon',
      date,
    })
    const second = await runtime.submit({
      userInput: '确认',
      channelId: 'dragon',
      date,
      pendingTask: first.decision.pendingTask,
    })

    expect(second.status).toBe('executed')
    expect(second.executionResult?.affectedItemIds).toContain('item-0900')
    expect(second.explanation).toContain('已删除')

    const context = await dataGateway.loadContext({
      userInput: '',
      channelId: 'dragon',
      date,
    })
    expect(context.scheduleItems).toHaveLength(0)
  })

  it('删除锁定节目会被约束阻断', async () => {
    const { runtime } = buildRuntime({
      playlistType: 'tv',
      items: [buildItem()],
      lockedItemIds: ['item-0900'],
    })

    const result = await runtime.submit({
      userInput: '删除9点的节目',
      channelId: 'dragon',
      date,
    })

    expect(result.status).toBe('blocked')
    expect(result.decision.constraintReport?.issues[0]).toMatchObject({
      code: 'locked_item',
      severity: 'critical',
    })
  })

  it('删除确认态下非确认回复不会落表', async () => {
    const { dataGateway, runtime } = buildRuntime({
      playlistType: 'tv',
      items: [buildItem()],
    })

    const first = await runtime.submit({
      userInput: '删除9点的节目',
      channelId: 'dragon',
      date,
    })
    const second = await runtime.submit({
      userInput: '等等',
      channelId: 'dragon',
      date,
      pendingTask: first.decision.pendingTask,
    })

    expect(second.status).toBe('needs_confirmation')

    const context = await dataGateway.loadContext({
      userInput: '',
      channelId: 'dragon',
      date,
    })
    expect(context.scheduleItems).toHaveLength(1)
  })

  it('电视播单替换命令会在约束通过后直接落表并保留原条目身份', async () => {
    const { dataGateway, runtime } = buildRuntime({
      playlistType: 'tv',
      items: [buildItem({ endTime: '09:30:00', duration: 1800 })],
      programCandidates: [buildCandidate({
        id: 'candidate-dfxw',
        programCode: 'DFXW001',
        programName: '东方新闻',
        instanceName: '东方新闻',
      })],
    })

    const result = await runtime.submit({
      userInput: '把9点的节目替换成东方新闻',
      channelId: 'dragon',
      date,
    })

    expect(result.status).toBe('executed')
    expect(result.decision.intent).toBe('replace')
    expect(result.decision.command).toMatchObject({
      intent: 'replace',
      itemId: 'item-0900',
      candidateId: 'candidate-dfxw',
      startTime: '2026-03-25T09:00:00+08:00',
      endTime: '2026-03-25T09:30:00+08:00',
    })
    expect(result.explanation).toContain('电视播单')

    const context = await dataGateway.loadContext({
      userInput: '',
      channelId: 'dragon',
      date,
    })
    expect(context.scheduleItems).toHaveLength(1)
    expect(context.scheduleItems[0]).toMatchObject({
      id: 'item-0900',
      programName: '东方新闻',
      programCode: 'DFXW001',
    })
  })

  it('轮播单替换首轮只返回候选确认，不直接落表', async () => {
    const { dataGateway, runtime } = buildRuntime({
      playlistType: 'rotation',
      rotationStrategy: 'content_match',
      items: [buildItem({ endTime: '09:30:00', duration: 1800 })],
      programCandidates: [buildCandidate({
        id: 'candidate-dfxw',
        programCode: 'DFXW001',
        programName: '东方新闻',
        instanceName: '东方新闻',
      })],
    })

    const result = await runtime.submit({
      userInput: '把9点的节目换成东方新闻',
      channelId: 'dragon',
      date,
    })

    expect(result.status).toBe('needs_confirmation')
    expect(result.decision.intent).toBe('replace')
    expect(result.decision.pendingTask).toMatchObject({
      intent: 'replace',
      phase: 'needs_confirmation',
      missingSlots: ['confirmation'],
      collectedSlots: {
        targetItemId: {
          value: 'item-0900',
        },
        candidateId: {
          value: 'candidate-dfxw',
        },
      },
    })

    const context = await dataGateway.loadContext({
      userInput: '',
      channelId: 'dragon',
      date,
    })
    expect(context.scheduleItems[0]?.programName).toBe('看东方')
  })

  it('轮播单替换确认后才事务落表', async () => {
    const { dataGateway, runtime } = buildRuntime({
      playlistType: 'rotation',
      rotationStrategy: 'content_match',
      items: [buildItem({ endTime: '09:30:00', duration: 1800 })],
      programCandidates: [buildCandidate({
        id: 'candidate-dfxw',
        programCode: 'DFXW001',
        programName: '东方新闻',
        instanceName: '东方新闻',
      })],
    })

    const first = await runtime.submit({
      userInput: '把9点的节目换成东方新闻',
      channelId: 'dragon',
      date,
    })
    const second = await runtime.submit({
      userInput: '确认',
      channelId: 'dragon',
      date,
      pendingTask: first.decision.pendingTask,
    })

    expect(second.status).toBe('executed')
    expect(second.explanation).toContain('轮播单已确认')

    const context = await dataGateway.loadContext({
      userInput: '',
      channelId: 'dragon',
      date,
    })
    expect(context.scheduleItems[0]).toMatchObject({
      id: 'item-0900',
      programName: '东方新闻',
    })
  })

  it('替换缺候选时保存结构化 pendingTask，下轮补候选后继续执行电视播单替换', async () => {
    const { dataGateway, runtime } = buildRuntime({
      playlistType: 'tv',
      items: [buildItem({ endTime: '09:30:00', duration: 1800 })],
      programCandidates: [buildCandidate({
        id: 'candidate-dfxw',
        programCode: 'DFXW001',
        programName: '东方新闻',
        instanceName: '东方新闻',
      })],
    })

    const first = await runtime.submit({
      userInput: '把9点的节目替换',
      channelId: 'dragon',
      date,
    })

    expect(first.status).toBe('needs_clarification')
    expect(first.decision.pendingTask).toMatchObject({
      intent: 'replace',
      phase: 'needs_clarification',
      missingSlots: ['replacementHint'],
      collectedSlots: {
        targetTime: {
          value: '09:00:00',
        },
      },
    })

    const second = await runtime.submit({
      userInput: '东方新闻',
      channelId: 'dragon',
      date,
      pendingTask: first.decision.pendingTask,
    })

    expect(second.status).toBe('executed')

    const context = await dataGateway.loadContext({
      userInput: '',
      channelId: 'dragon',
      date,
    })
    expect(context.scheduleItems[0]?.programName).toBe('东方新闻')
  })

  it('替换锁定节目会被约束阻断', async () => {
    const { runtime } = buildRuntime({
      playlistType: 'tv',
      items: [buildItem({ endTime: '09:30:00', duration: 1800 })],
      lockedItemIds: ['item-0900'],
      programCandidates: [buildCandidate({
        id: 'candidate-dfxw',
        programName: '东方新闻',
        instanceName: '东方新闻',
      })],
    })

    const result = await runtime.submit({
      userInput: '把9点的节目替换成东方新闻',
      channelId: 'dragon',
      date,
    })

    expect(result.status).toBe('blocked')
    expect(result.decision.constraintReport?.issues[0]).toMatchObject({
      code: 'locked_item',
      severity: 'critical',
    })
  })

  it('替换候选素材不可播时由约束阻断', async () => {
    const { runtime } = buildRuntime({
      playlistType: 'tv',
      items: [buildItem({ endTime: '09:30:00', duration: 1800 })],
      programCandidates: [buildCandidate({
        id: 'candidate-dfxw',
        programName: '东方新闻',
        instanceName: '东方新闻',
        materialStatus: 'missing',
      })],
    })

    const result = await runtime.submit({
      userInput: '把9点的节目替换成东方新闻',
      channelId: 'dragon',
      date,
    })

    expect(result.status).toBe('blocked')
    expect(result.decision.constraintReport?.issues[0]).toMatchObject({
      code: 'material_not_ready',
      severity: 'critical',
    })
  })

  it('替换候选时长造成后续节目重叠时阻断且不落表', async () => {
    const { dataGateway, runtime } = buildRuntime({
      playlistType: 'tv',
      items: [
        buildItem({ endTime: '09:30:00', duration: 1800 }),
        buildItem({
          id: 'item-0930',
          programCode: 'P100002',
          programName: '午间新闻',
          startTime: '09:30:00',
          endTime: '10:00:00',
          duration: 1800,
          sequence: 2,
        }),
      ],
      programCandidates: [buildCandidate({
        id: 'candidate-long',
        programName: '东方新闻加长版',
        instanceName: '东方新闻加长版',
        duration: 3600,
      })],
    })

    const result = await runtime.submit({
      userInput: '把9点的节目替换成东方新闻加长版',
      channelId: 'dragon',
      date,
    })

    expect(result.status).toBe('blocked')
    expect(result.decision.constraintReport?.issues[0]).toMatchObject({
      code: 'time_overlap',
      severity: 'critical',
      detail: {
        conflictItemId: 'item-0930',
        conflictProgramName: '午间新闻',
        conflictRange: {
          start: '2026-03-25T09:30:00+08:00',
          end: '2026-03-25T10:00:00+08:00',
        },
        proposedRange: {
          start: '2026-03-25T09:00:00+08:00',
          end: '2026-03-25T10:00:00+08:00',
        },
        blockedPolicy: 'no_auto_shift_replace_reorder',
      },
    })

    const context = await dataGateway.loadContext({
      userInput: '',
      channelId: 'dragon',
      date,
    })
    expect(context.scheduleItems.find((item) => item.id === 'item-0900')?.programName).toBe('看东方')
  })

  it('校验命令读取当前实际节目单并返回约束报告，不修改数据源', async () => {
    const { dataGateway, runtime } = buildRuntime({
      playlistType: 'tv',
      items: [
        buildItem({ endTime: '09:40:00', duration: 2400 }),
        buildItem({
          id: 'item-0930',
          programCode: 'P100002',
          programName: '午间新闻',
          startTime: '09:30:00',
          endTime: '10:00:00',
          duration: 1800,
          sequence: 2,
        }),
      ],
    })

    const result = await runtime.submit({
      userInput: '检查当前节目单有没有问题',
      channelId: 'dragon',
      date,
    })

    expect(result.status).toBe('executed')
    expect(result.decision.intent).toBe('validate')
    expect(result.decision.command).toMatchObject({
      intent: 'validate',
      scope: 'schedule',
    })
    expect(result.validationReport?.ok).toBe(false)
    expect(result.validationReport?.issues[0]).toMatchObject({
      code: 'time_overlap',
      severity: 'critical',
    })

    const context = await dataGateway.loadContext({
      userInput: '',
      channelId: 'dragon',
      date,
    })
    expect(context.scheduleItems).toHaveLength(2)
    expect(context.scheduleItems[0]?.programName).toBe('看东方')
  })

  it('校验命令会把版面边界和禁排时段纳入当前上下文体检', async () => {
    const { runtime } = buildRuntime({
      playlistType: 'tv',
      items: [buildItem()],
      layoutBounds: { start: '09:30:00', end: '23:59:59' },
      blockedTimeRanges: [{ start: '09:15:00', end: '09:45:00' }],
    })

    const result = await runtime.submit({
      userInput: '体检当前播单',
      channelId: 'dragon',
      date,
    })

    expect(result.status).toBe('executed')
    expect(result.validationReport?.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      'out_of_layout_bounds',
      'blocked_time_range',
    ]))
  })

  it('查询命令可按时间读取当前播单命中的节目', async () => {
    const { runtime } = buildRuntime({
      playlistType: 'tv',
      items: [buildItem()],
    })

    const result = await runtime.submit({
      userInput: '9点是什么节目',
      channelId: 'dragon',
      date,
    })

    expect(result.status).toBe('executed')
    expect(result.decision.intent).toBe('query')
    expect(result.decision.command).toMatchObject({
      intent: 'query',
      queryKind: 'time_lookup',
      targetTime: '2026-03-25T09:00:00+08:00',
    })
    expect(result.decision.queryResult).toMatchObject({
      kind: 'time_lookup',
      totalCount: 1,
      scheduleItems: [{
        id: 'item-0900',
        programName: '看东方',
      }],
    })
    expect(result.explanation).toContain('看东方')
  })

  it('查询命令可返回当前播单概览且不修改数据源', async () => {
    const { dataGateway, runtime } = buildRuntime({
      playlistType: 'rotation',
      rotationStrategy: 'rating',
      items: [
        buildItem({ endTime: '09:30:00', duration: 1800 }),
        buildItem({
          id: 'item-0930',
          programCode: 'P100002',
          programName: '午间新闻',
          startTime: '09:30:00',
          endTime: '10:00:00',
          duration: 1800,
          sequence: 2,
        }),
      ],
    })

    const result = await runtime.submit({
      userInput: '查看当前播单有哪些节目',
      channelId: 'dragon',
      date,
    })

    expect(result.status).toBe('executed')
    expect(result.decision.queryResult).toMatchObject({
      kind: 'schedule_summary',
      playlistType: 'rotation',
      totalCount: 2,
    })
    expect(result.explanation).toContain('轮播单')

    const context = await dataGateway.loadContext({
      userInput: '',
      channelId: 'dragon',
      date,
    })
    expect(context.scheduleItems.map((item) => item.programName)).toEqual(['看东方', '午间新闻'])
  })

  it('查询命令可按关键词读取候选库节目', async () => {
    const { runtime } = buildRuntime({
      playlistType: 'tv',
      items: [],
      programCandidates: [
        buildCandidate({
          id: 'candidate-dfxw',
          programName: '东方新闻',
          instanceName: '东方新闻',
        }),
        buildCandidate({
          id: 'candidate-drama',
          programCode: 'DRAMA001',
          programName: '品质剧场',
          instanceName: '品质剧场',
          programType: 'drama',
          contentTags: ['电视剧'],
        }),
      ],
    })

    const result = await runtime.submit({
      userInput: '查询候选库东方新闻',
      channelId: 'dragon',
      date,
    })

    expect(result.status).toBe('executed')
    expect(result.decision.command).toMatchObject({
      intent: 'query',
      queryKind: 'candidate_lookup',
      keyword: '东方新闻',
    })
    expect(result.decision.queryResult).toMatchObject({
      kind: 'candidate_lookup',
      totalCount: 1,
      candidates: [{
        id: 'candidate-dfxw',
        programName: '东方新闻',
      }],
    })
  })

  it('批量移动会整体预演并在约束通过后事务落表', async () => {
    const { dataGateway, runtime } = buildRuntime({
      playlistType: 'tv',
      items: [
        buildItem({ endTime: '09:30:00', duration: 1800 }),
        buildItem({
          id: 'item-0930',
          programCode: 'P100002',
          programName: '午间新闻',
          startTime: '09:30:00',
          endTime: '10:00:00',
          duration: 1800,
          sequence: 2,
        }),
      ],
    })

    const result = await runtime.submit({
      userInput: '把9点到10点的节目整体后移1小时',
      channelId: 'dragon',
      date,
    })

    expect(result.status).toBe('executed')
    expect(result.decision.intent).toBe('batch_move')
    expect(result.decision.command).toMatchObject({
      intent: 'batch_move',
      itemIds: ['item-0900', 'item-0930'],
      offsetSeconds: 3600,
      targetRange: {
        start: '2026-03-25T09:00:00+08:00',
        end: '2026-03-25T10:00:00+08:00',
      },
    })
    expect(result.executionResult?.affectedItemIds).toEqual(expect.arrayContaining(['item-0900', 'item-0930']))

    const context = await dataGateway.loadContext({
      userInput: '',
      channelId: 'dragon',
      date,
    })
    expect(context.scheduleItems).toMatchObject([
      {
        id: 'item-0900',
        startTime: '2026-03-25T10:00:00+08:00',
        endTime: '2026-03-25T10:30:00+08:00',
      },
      {
        id: 'item-0930',
        startTime: '2026-03-25T10:30:00+08:00',
        endTime: '2026-03-25T11:00:00+08:00',
      },
    ])
  })

  it('批量移动造成现有节目重叠时由约束阻断且不落表', async () => {
    const { dataGateway, runtime } = buildRuntime({
      playlistType: 'tv',
      items: [
        buildItem({ endTime: '09:30:00', duration: 1800 }),
        buildItem({
          id: 'item-0930',
          programCode: 'P100002',
          programName: '午间新闻',
          startTime: '09:30:00',
          endTime: '10:00:00',
          duration: 1800,
          sequence: 2,
        }),
        buildItem({
          id: 'item-1000',
          programCode: 'P100003',
          programName: '东方午间',
          startTime: '10:00:00',
          endTime: '10:30:00',
          duration: 1800,
          sequence: 3,
        }),
      ],
    })

    const result = await runtime.submit({
      userInput: '把9点到10点的节目整体后移30分钟',
      channelId: 'dragon',
      date,
    })

    expect(result.status).toBe('blocked')
    expect(result.decision.constraintReport?.issues[0]).toMatchObject({
      code: 'time_overlap',
      severity: 'critical',
    })

    const context = await dataGateway.loadContext({
      userInput: '',
      channelId: 'dragon',
      date,
    })
    expect(context.scheduleItems.find((item) => item.id === 'item-0900')?.startTime).toBe('2026-03-25T09:00:00+08:00')
  })

  it('批量删除首轮只返回确认，不直接落表', async () => {
    const { dataGateway, runtime } = buildRuntime({
      playlistType: 'tv',
      items: [
        buildItem({ endTime: '09:30:00', duration: 1800 }),
        buildItem({
          id: 'item-0930',
          programCode: 'P100002',
          programName: '午间新闻',
          startTime: '09:30:00',
          endTime: '10:00:00',
          duration: 1800,
          sequence: 2,
        }),
      ],
    })

    const result = await runtime.submit({
      userInput: '删除9点到10点的节目',
      channelId: 'dragon',
      date,
    })

    expect(result.status).toBe('needs_confirmation')
    expect(result.decision.intent).toBe('batch_delete')
    expect(result.decision.pendingTask).toMatchObject({
      intent: 'batch_delete',
      phase: 'needs_confirmation',
      missingSlots: ['confirmation'],
      collectedSlots: {
        targetItemIds: {
          value: ['item-0900', 'item-0930'],
        },
      },
    })

    const context = await dataGateway.loadContext({
      userInput: '',
      channelId: 'dragon',
      date,
    })
    expect(context.scheduleItems).toHaveLength(2)
  })

  it('批量删除确认后才事务落表', async () => {
    const { dataGateway, runtime } = buildRuntime({
      playlistType: 'tv',
      items: [
        buildItem({ endTime: '09:30:00', duration: 1800 }),
        buildItem({
          id: 'item-0930',
          programCode: 'P100002',
          programName: '午间新闻',
          startTime: '09:30:00',
          endTime: '10:00:00',
          duration: 1800,
          sequence: 2,
        }),
      ],
    })

    const first = await runtime.submit({
      userInput: '删除9点到10点的节目',
      channelId: 'dragon',
      date,
    })
    const second = await runtime.submit({
      userInput: '确认',
      channelId: 'dragon',
      date,
      pendingTask: first.decision.pendingTask,
    })

    expect(second.status).toBe('executed')
    expect(second.executionResult?.affectedItemIds).toEqual(expect.arrayContaining(['item-0900', 'item-0930']))

    const context = await dataGateway.loadContext({
      userInput: '',
      channelId: 'dragon',
      date,
    })
    expect(context.scheduleItems).toHaveLength(0)
  })

  it('批量删除确认态下非确认回复不会落表', async () => {
    const { dataGateway, runtime } = buildRuntime({
      playlistType: 'tv',
      items: [
        buildItem({ endTime: '09:30:00', duration: 1800 }),
        buildItem({
          id: 'item-0930',
          programCode: 'P100002',
          programName: '午间新闻',
          startTime: '09:30:00',
          endTime: '10:00:00',
          duration: 1800,
          sequence: 2,
        }),
      ],
    })

    const first = await runtime.submit({
      userInput: '删除9点到10点的节目',
      channelId: 'dragon',
      date,
    })
    const second = await runtime.submit({
      userInput: '先等等',
      channelId: 'dragon',
      date,
      pendingTask: first.decision.pendingTask,
    })

    expect(second.status).toBe('needs_confirmation')

    const context = await dataGateway.loadContext({
      userInput: '',
      channelId: 'dragon',
      date,
    })
    expect(context.scheduleItems).toHaveLength(2)
  })

  it('批量删除命中锁定节目时会被约束阻断', async () => {
    const { runtime } = buildRuntime({
      playlistType: 'tv',
      items: [
        buildItem({ endTime: '09:30:00', duration: 1800 }),
        buildItem({
          id: 'item-0930',
          programCode: 'P100002',
          programName: '午间新闻',
          startTime: '09:30:00',
          endTime: '10:00:00',
          duration: 1800,
          sequence: 2,
        }),
      ],
      lockedItemIds: ['item-0930'],
    })

    const result = await runtime.submit({
      userInput: '删除9点到10点的节目',
      channelId: 'dragon',
      date,
    })

    expect(result.status).toBe('blocked')
    expect(result.decision.constraintReport?.issues[0]).toMatchObject({
      code: 'locked_item',
      severity: 'critical',
    })
  })
})
