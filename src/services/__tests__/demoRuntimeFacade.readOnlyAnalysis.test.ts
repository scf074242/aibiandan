import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getAtomicCapabilities, resetAtomicCapabilities } from '@/services/atomicCapabilities'
import { DemoRuntimeFacade, type RuntimeAnalysisContext, type RuntimeScheduleItem } from '@/services/runtime/demoRuntimeFacade'
import type { LayoutDraft, ScheduleState } from '@/types/orchestration'

const llmMocks = vi.hoisted(() => ({
  chat: vi.fn(),
}))

vi.mock('@/services/llm/llmClient', () => ({
  getLLMClient: () => ({
    chat: llmMocks.chat,
  }),
}))

const createScheduleState = (patch: Partial<ScheduleState> = {}): ScheduleState => ({
  playlistId: 'playlist-tv-analysis',
  channelId: 'dragon-tv',
  channelName: '东方卫视',
  date: '2026-03-25',
  isEmpty: false,
  itemCount: 0,
  gapCount: 1,
  hasSelectedTimeRange: false,
  playlistType: 'tv',
  ...patch,
})

const createItem = (
  id: string,
  programName: string,
  startTime: string,
  endTime: string,
  programType: string,
): RuntimeScheduleItem => ({
  id,
  programCode: id,
  programName,
  startTime,
  endTime,
  duration: Math.max(0, (new Date(endTime).getTime() - new Date(startTime).getTime()) / 1000),
  programType,
})

const currentSchedule: RuntimeScheduleItem[] = [
  createItem('item-news-1', '看东方111期新春特别行动', '2026-03-25T09:00:00+08:00', '2026-03-25T10:00:00+08:00', 'news'),
  createItem('item-drama-1', '东方剧场：纵有疾风起 第5集', '2026-03-25T13:00:00+08:00', '2026-03-25T13:45:00+08:00', 'drama'),
  createItem('item-drama-2', '东方剧场：纵有疾风起 第6集', '2026-03-25T13:45:00+08:00', '2026-03-25T14:30:00+08:00', 'drama'),
]

const currentLayoutDraft: LayoutDraft = {
  id: 'draft-tv-analysis',
  channelId: 'dragon-tv',
  date: '2026-03-25',
  version: 1,
  source: 'generated',
  userIntent: '下午补轻量资讯',
  coverage: { start: '13:00:00', end: '18:00:00' },
  layoutReference: {
    id: 'layout-tv-analysis',
    name: '东方卫视下午版面',
    slots: [{
      id: 'slot-news-magazine',
      channelId: 'dragon-tv',
      startTime: '15:00:00',
      endTime: '15:30:00',
      columnId: 'col-news-magazine',
    }],
  },
  columns: [{
    columnId: 'col-news-magazine',
    columnName: '轻量资讯',
    channelId: 'dragon-tv',
    defaultProgramType: 'news_magazine',
    semanticLabel: '轻量资讯',
    source: 'generated',
  }],
}

describe('DemoRuntimeFacade read-only playlist analysis', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    resetAtomicCapabilities()
    await getAtomicCapabilities().clearAll()
  })

  it('answers playlist style questions with read-only analysis context', async () => {
    llmMocks.chat.mockResolvedValueOnce({
      content: '当前编单新闻开场，下午连续电视剧，整体偏稳，但中后段内容类型比较集中。',
    })
    const facade = new DemoRuntimeFacade()

    const decision = await facade.submitInstruction({
      scheduleState: createScheduleState({ itemCount: currentSchedule.length }),
      userInput: '当前编单风格怎么样？',
      currentSchedule,
      history: [],
      agentCoreEnabled: true,
      layoutDraftEnabled: false,
    })

    expect(decision.kind).toBe('message')
    if (decision.kind !== 'message') throw new Error('expected read-only message')
    expect(decision.feedback.content).toContain('整体偏稳')
    expect(decision.analysisContext?.kind).toBe('playlist_analysis')
    expect(decision.analysisContext?.factPack.itemCount).toBe(3)
    expect(decision.analysisContext?.factPack.typeDurations.find((item) => item.programType === 'drama')?.durationSeconds).toBe(5400)
    expect(decision.feedback.details?.readOnly).toBe(true)
    expect(getAtomicCapabilities().getAllItems()).toEqual([])
  })

  it('carries previous analysis into optimization suggestions without creating pending writes', async () => {
    llmMocks.chat.mockResolvedValueOnce({
      content: '建议把下午连续电视剧拆开，在晚间补一档轻量资讯，减少同类内容连续堆叠。',
    })
    const facade = new DemoRuntimeFacade()
    const previous: RuntimeAnalysisContext = {
      kind: 'playlist_analysis',
      playlistId: 'playlist-tv-analysis',
      playlistType: 'tv',
      question: '当前编单风格怎么样？',
      answer: '下午连续电视剧，内容略集中。',
      factPack: {
        playlistId: 'playlist-tv-analysis',
        playlistType: 'tv',
        channelName: '东方卫视',
        date: '2026-03-25',
        itemCount: 3,
        totalDurationSeconds: 9000,
        gapCount: 1,
        items: [],
        typeDurations: [],
        timeBands: [],
        layoutDraftState: { exists: false },
      },
      createdAt: '2026-03-25T00:00:00+08:00',
    }

    const decision = await facade.submitInstruction({
      scheduleState: createScheduleState({ itemCount: currentSchedule.length }),
      userInput: '那怎么优化？',
      currentSchedule,
      analysisContext: previous,
      history: ['当前编单风格怎么样？', '下午连续电视剧，内容略集中。'],
      agentCoreEnabled: true,
      layoutDraftEnabled: false,
    })

    expect(decision.kind).toBe('message')
    if (decision.kind !== 'message') throw new Error('expected optimization suggestion')
    expect(decision.feedback.content).toContain('建议')
    expect(decision.feedback.content).toContain('需要我更新到草案')
    expect(decision.analysisContext?.kind).toBe('optimization_suggestion')
    expect(decision.analysisContext?.recommendation).toContain('轻量资讯')
    expect(decision.feedback.details?.previousAnalysis).toMatchObject({
      question: '当前编单风格怎么样？',
    })
    expect(getAtomicCapabilities().getAllItems()).toEqual([])
  })

  it('keeps optimization suggestions read-only even when a draft can be refined', async () => {
    llmMocks.chat.mockResolvedValueOnce({
      content: '建议把下午连续电视剧拆开，先在 15 点附近补一档轻量资讯。',
    })
    const facade = new DemoRuntimeFacade()
    const previous: RuntimeAnalysisContext = {
      kind: 'playlist_analysis',
      playlistId: 'playlist-tv-analysis',
      playlistType: 'tv',
      question: '当前编单风格怎么样？',
      answer: '下午连续电视剧，内容略集中。',
      factPack: {
        playlistId: 'playlist-tv-analysis',
        playlistType: 'tv',
        channelName: '东方卫视',
        date: '2026-03-25',
        itemCount: 3,
        totalDurationSeconds: 9000,
        gapCount: 1,
        items: [],
        typeDurations: [],
        timeBands: [],
        layoutDraftState: { exists: true },
      },
      createdAt: '2026-03-25T00:00:00+08:00',
    }

    const decision = await facade.submitInstruction({
      scheduleState: createScheduleState({ itemCount: currentSchedule.length }),
      userInput: '那怎么优化？',
      currentSchedule,
      currentLayoutDraft,
      preferLayoutDraftRefine: true,
      analysisContext: previous,
      history: ['当前编单风格怎么样？', '下午连续电视剧，内容略集中。'],
      agentCoreEnabled: true,
      layoutDraftEnabled: true,
    })

    expect(decision.kind).toBe('message')
    if (decision.kind !== 'message') throw new Error('expected read-only optimization message')
    expect(decision.feedback.content).toContain('需要我更新到草案')
    expect(decision.feedback.details?.readOnly).toBe(true)
    expect(decision.analysisContext?.kind).toBe('optimization_suggestion')
    expect(getAtomicCapabilities().getAllItems()).toEqual([])
  })

  it('turns an authorized optimization suggestion into a confirmed TaskPlan only after user approval', async () => {
    llmMocks.chat.mockResolvedValueOnce({
      content: JSON.stringify({
        taskPlanDraft: {
          isComposite: true,
          goal: '删除全部东方剧场节目',
          stages: [{
            type: 'batch_atomic',
            action: 'delete',
            target: {
              programName: '东方剧场',
              scope: 'current_playlist',
            },
            requiresConfirmation: true,
            summary: '删除当前播单里的东方剧场节目',
          }, {
            type: 'verify',
            requiresConfirmation: false,
            summary: '检查当前播单里是否还剩东方剧场',
          }],
        },
      }),
    })
    const facade = new DemoRuntimeFacade()
    const analysisContext: RuntimeAnalysisContext = {
      kind: 'optimization_suggestion',
      playlistId: 'playlist-tv-analysis',
      playlistType: 'tv',
      question: '那怎么优化？',
      answer: '建议先减少下午连续电视剧。',
      recommendation: '建议先减少下午连续电视剧。',
      factPack: {
        playlistId: 'playlist-tv-analysis',
        playlistType: 'tv',
        channelName: '东方卫视',
        date: '2026-03-25',
        itemCount: 3,
        totalDurationSeconds: 9000,
        gapCount: 1,
        items: [],
        typeDurations: [],
        timeBands: [],
        layoutDraftState: { exists: false },
      },
      createdAt: '2026-03-25T00:00:00+08:00',
    }

    const decision = await facade.submitInstruction({
      scheduleState: createScheduleState({ itemCount: currentSchedule.length }),
      userInput: '按这个做',
      currentSchedule,
      analysisContext,
      history: ['那怎么优化？', '建议先减少下午连续电视剧。'],
      agentCoreEnabled: true,
      layoutDraftEnabled: false,
    })

    expect(decision.kind).toBe('pending_atomic_context')
    if (decision.kind !== 'pending_atomic_context') throw new Error('expected confirmed task plan')
    expect(decision.pendingAtomicContext.compositeTaskRun?.goal).toBe('删除全部《东方剧场》')
    expect(decision.pendingAtomicContext.compositeTaskRun?.stages[0]?.steps).toHaveLength(2)
    expect(decision.feedback.content).toContain('确认后我再写入播单')
    expect(getAtomicCapabilities().getAllItems()).toEqual([])
  })

  it('accepts natural approval wording but still stops at a pending TaskPlan', async () => {
    llmMocks.chat.mockResolvedValueOnce({
      content: JSON.stringify({
        taskPlanDraft: {
          isComposite: true,
          goal: '删除全部东方剧场节目',
          stages: [{
            type: 'batch_atomic',
            action: 'delete',
            target: {
              programName: '东方剧场',
              scope: 'current_playlist',
            },
            requiresConfirmation: true,
            summary: '删除当前播单里的东方剧场节目',
          }, {
            type: 'verify',
            requiresConfirmation: false,
            summary: '检查当前播单里是否还剩东方剧场',
          }],
        },
      }),
    })
    const facade = new DemoRuntimeFacade()
    const analysisContext: RuntimeAnalysisContext = {
      kind: 'optimization_suggestion',
      playlistId: 'playlist-tv-analysis',
      playlistType: 'tv',
      question: '那怎么优化？',
      answer: '建议减少下午连续电视剧。',
      recommendation: '建议减少下午连续电视剧。',
      factPack: {
        playlistId: 'playlist-tv-analysis',
        playlistType: 'tv',
        channelName: '东方卫视',
        date: '2026-03-25',
        itemCount: 3,
        totalDurationSeconds: 9000,
        gapCount: 1,
        items: [],
        typeDurations: [],
        timeBands: [],
        layoutDraftState: { exists: false },
      },
      createdAt: '2026-03-25T00:00:00+08:00',
    }

    const decision = await facade.submitInstruction({
      scheduleState: createScheduleState({ itemCount: currentSchedule.length }),
      userInput: '照你的建议改',
      currentSchedule,
      analysisContext,
      history: ['那怎么优化？', '建议减少下午连续电视剧。'],
      agentCoreEnabled: true,
      layoutDraftEnabled: false,
    })

    expect(decision.kind).toBe('pending_atomic_context')
    if (decision.kind !== 'pending_atomic_context') throw new Error('expected pending task plan')
    expect(decision.pendingAtomicContext.compositeTaskRun?.goal).toBe('删除全部《东方剧场》')
    expect(decision.feedback.content).toContain('确认后我再写入播单')
    expect(getAtomicCapabilities().getAllItems()).toEqual([])
  })

  it('does not execute an old optimization suggestion after the active playlist changes', async () => {
    const facade = new DemoRuntimeFacade()
    const analysisContext: RuntimeAnalysisContext = {
      kind: 'optimization_suggestion',
      playlistId: 'playlist-old-analysis',
      playlistType: 'tv',
      question: '那怎么优化？',
      answer: '建议减少下午连续电视剧。',
      recommendation: '建议减少下午连续电视剧。',
      factPack: {
        playlistId: 'playlist-old-analysis',
        playlistType: 'tv',
        channelName: '东方卫视',
        date: '2026-03-25',
        itemCount: 3,
        totalDurationSeconds: 9000,
        gapCount: 1,
        items: [],
        typeDurations: [],
        timeBands: [],
        layoutDraftState: { exists: false },
      },
      createdAt: '2026-03-25T00:00:00+08:00',
    }

    const decision = await facade.submitInstruction({
      scheduleState: createScheduleState({ playlistId: 'playlist-new-analysis', itemCount: currentSchedule.length }),
      userInput: '按这个做',
      currentSchedule,
      analysisContext,
      history: ['那怎么优化？', '建议减少下午连续电视剧。'],
      agentCoreEnabled: true,
      layoutDraftEnabled: false,
    })

    expect(decision.kind).toBe('message')
    if (decision.kind !== 'message') throw new Error('expected stale analysis block')
    expect(decision.statusHint).toBe('needs_clarification')
    expect(decision.feedback.content).toContain('当前打开的播单已经变了')
    expect(llmMocks.chat).not.toHaveBeenCalled()
    expect(getAtomicCapabilities().getAllItems()).toEqual([])
  })
})
