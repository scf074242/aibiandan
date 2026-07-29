import { describe, expect, it, vi } from 'vitest'

import { canonicalSchedulingData } from '@/services/agent/canonicalSchedulingData'
import { AgentPlanner } from '@/services/llm/agentPlanner'
import { LayoutDraftCompiler } from '@/services/layoutDraftCompiler'
import { LayoutDraftService } from '@/services/layoutDraftService'
import { LayoutDraftValidator } from '@/services/layoutDraftValidator'
import { buildTrustedForegroundAgentContext } from '@/services/runtime/trustedForegroundAgentContext'
import type { LayoutDraft, ScheduleState } from '@/types/orchestration'

const CASE_ID = 'post9-reference-existing-playlist-builds-draft-from-trusted-history'

const createCurrentDraft = (): LayoutDraft => {
  const layoutReference = canonicalSchedulingData.layouts['dragon_2026-03-25']
  if (!layoutReference) throw new Error('data_fixture_missing: 缺少2026-03-25东方卫视canonical版面')

  return {
    id: 'reference-history-current-draft',
    channelId: 'dragon',
    date: '2026-03-25',
    version: 1,
    source: 'channel_default',
    userIntent: '沿用当前频道版面',
    coverage: { start: '06:00:00', end: '23:59:59' },
    layoutReference,
    columns: layoutReference.slots.map((slot) => {
      const column = canonicalSchedulingData.columns.find((item) => item.columnId === slot.columnId)
      if (!column) throw new Error(`data_fixture_missing: 缺少canonical栏目 ${slot.columnId}`)
      return {
        columnId: column.columnId,
        columnName: column.columnName,
        channelId: column.channelId,
        defaultProgramType: column.defaultProgramType,
        isSequential: column.isSequential,
        semanticLabel: column.columnName,
        draftConstraintKind: column.draftConstraintKind,
        queryHints: [column.columnName],
        source: 'default' as const,
      }
    }),
  }
}

const scheduleState: ScheduleState = {
  playlistId: 'reference-history-current',
  playlistType: 'tv',
  channelId: 'dragon',
  channelName: '东方卫视',
  date: '2026-03-25',
  isEmpty: false,
  itemCount: 0,
  gapCount: 19,
  hasSelectedTimeRange: false,
}

describe('参考已有编单的真实两轮草案旅程', () => {
  it(`${CASE_ID}: 从模糊追问贯通到完整草案且不修改正式播单`, async () => {
    const currentDraft = createCurrentDraft()
    expect(currentDraft.layoutReference.slots).toHaveLength(19)

    const formalPlaylistSnapshot = Object.freeze([
      Object.freeze({ id: 'formal-existing-1', programCode: 'existing-1', startTime: '12:00:00', endTime: '12:30:00' }),
    ])
    const formalBefore = JSON.stringify(formalPlaylistSnapshot)
    const plannerChat = vi.fn()
      .mockResolvedValueOnce({
        content: JSON.stringify({
          mode: 'single',
          actions: [{
            type: 'clarify',
            question: '请告诉我参考哪一天的东方卫视编单，以及参考版面结构、内容配比还是顺播进度。',
          }],
          assistantReplyDraft: '我需要先定位参考编单和参考维度。',
          reasoning: '当前指令无法唯一定位历史事实。',
        }),
      })
      .mockResolvedValueOnce({
        content: JSON.stringify({
          mode: 'single',
          actions: [{
            type: 'refine_layout_draft',
            userIntent: '参考date=2026-03-24的历史摘要：itemCount=26，programTypes={news:6,news_magazine:4,drama:6,health:2,commentary:3}，avgRating=8.6，detailItemCount=1；只参考汇总配比和收视表现，沿用当前版面，不逐条复刻',
            semanticLabel: '参考历史内容配比与收视表现',
            segments: [
              { start: '06:00:00', end: '07:00:00', semanticLabel: '东方快报', programTypeHint: 'news' },
              { start: '18:00:00', end: '19:00:00', semanticLabel: '东方新闻', programTypeHint: 'news' },
            ],
          }],
          assistantReplyDraft: '我会沿用当前版面，只调整草案中需要变化的时段，先给你审看。',
          reasoning: '历史摘要可验证，但只有1条节目明细，因此只参考汇总配比。',
        }),
      })
    const planner = new AgentPlanner({ chat: plannerChat } as never)

    const ambiguousInput = '参考东方卫视之前那张已有编单，重新规划今天整张播单'
    const ambiguousContext = await buildTrustedForegroundAgentContext({
      scheduleState,
      userInput: ambiguousInput,
      currentSchedule: formalPlaylistSnapshot as never,
      currentLayoutDraft: currentDraft,
    })
    const clarification = await planner.plan({
      scheduleState,
      userInput: ambiguousInput,
      currentSchedule: formalPlaylistSnapshot as never,
      currentLayoutDraft: currentDraft,
      contextPackage: ambiguousContext,
    })
    expect(clarification.actions).toEqual([
      expect.objectContaining({ type: 'clarify', question: expect.stringMatching(/哪一天|参考/) }),
    ])

    const clarifiedInput = '参考3月24日东方卫视编单的节目类型配比和收视表现，沿用当前版面，先生成今天的整表草案给我看，不要写正式播单'
    const trustedContext = await buildTrustedForegroundAgentContext({
      scheduleState,
      userInput: clarifiedInput,
      currentSchedule: formalPlaylistSnapshot as never,
      currentLayoutDraft: currentDraft,
    })
    expect(trustedContext.referencePlaylists.schedules.find(({ date }) => date === '2026-03-24')).toMatchObject({
      itemCount: 26,
      detailItemCount: 1,
      avgRating: 8.6,
    })

    const plan = await planner.plan({
      scheduleState,
      userInput: clarifiedInput,
      currentSchedule: formalPlaylistSnapshot as never,
      currentLayoutDraft: currentDraft,
      contextPackage: trustedContext,
    })
    expect(plan.actions).toHaveLength(1)
    expect(plan.actions[0]).toMatchObject({ type: 'refine_layout_draft' })
    expect(plan.actions.some((action) => ['formal_orchestration', 'commit_layout_draft', 'atomic_command'].includes(action.type))).toBe(false)
    const action = plan.actions[0]
    if (action?.type !== 'refine_layout_draft') throw new Error('expected refine_layout_draft')

    const draftLlmChat = vi.fn(async () => {
      throw new Error('structured segments must not trigger another LLM call')
    })
    const spec = await new LayoutDraftService({ chat: draftLlmChat } as never).refineSpec({
      channelId: scheduleState.channelId,
      channelName: scheduleState.channelName,
      date: scheduleState.date,
      playlistType: scheduleState.playlistType,
      currentDraft,
      userInput: action.userIntent ?? clarifiedInput,
      semanticLabel: action.semanticLabel,
      segments: action.segments,
    })
    expect(draftLlmChat).not.toHaveBeenCalled()
    expect(new LayoutDraftValidator().validateSpec(spec).errors).toEqual([])
    expect(spec.segments).toHaveLength(19)
    expect(spec.segments).toContainEqual(expect.objectContaining({
      label: '东方新闻',
      startTime: '18:00:00',
      endTime: '19:00:00',
    }))

    const reviewDraft = new LayoutDraftCompiler().compile(spec, {
      channelId: scheduleState.channelId,
      channelName: scheduleState.channelName,
      date: scheduleState.date,
      userIntent: action.userIntent ?? clarifiedInput,
      source: currentDraft.source,
      version: 2,
    })
    expect(reviewDraft.layoutReference.slots).toHaveLength(19)
    expect(reviewDraft.userIntent).toContain('detailItemCount=1')
    expect(reviewDraft.version).toBe(2)
    expect(JSON.stringify(formalPlaylistSnapshot)).toBe(formalBefore)
  })
})
