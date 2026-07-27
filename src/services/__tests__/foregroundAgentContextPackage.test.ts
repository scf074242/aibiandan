import { describe, expect, it } from 'vitest'

import type { LayoutDraft, ScheduleState } from '@/types/orchestration'
import type { RuntimePendingCommand, RuntimeScheduleItem } from '@/services/runtime/demoRuntimeFacade'
import type { ReactTaskRun } from '@/services/runtime/reactTaskTypes'
import {
  buildForegroundAgentContextPackage,
  formatForegroundAgentContextForPrompt,
  resolvePendingReviewLifecycle,
} from '@/services/runtime/foregroundAgentContextPackage'

const scheduleState: ScheduleState = {
  channelId: 'dragon',
  channelName: '东方卫视',
  date: '2026-03-25',
  isEmpty: false,
  itemCount: 14,
  gapCount: 2,
  hasSelectedTimeRange: false,
  playlistType: 'tv',
}

const scheduleItems: RuntimeScheduleItem[] = Array.from({ length: 14 }, (_, index) => ({
  id: `item-${index + 1}`,
  programName: `节目${index + 1}`,
  startTime: `${String(9 + index).padStart(2, '0')}:00:00`,
  endTime: `${String(10 + index).padStart(2, '0')}:00:00`,
  programType: index % 2 === 0 ? 'news' : 'series',
}))

const layoutDraft: LayoutDraft = {
  id: 'draft-tv-default',
  channelId: 'dragon',
  date: '2026-03-25',
  effectiveFrom: '2026-03-01',
  effectiveTo: '2026-06-30',
  version: 3,
  source: 'channel_default',
  userIntent: '频道默认版面',
  coverage: { start: '09:00:00', end: '23:00:00' },
  layoutReference: {
    id: 'layout-ref',
    name: '东方卫视日常版面',
    channelId: 'dragon',
    slots: [
      { id: 'slot-1', columnId: 'news', startTime: '09:00:00', endTime: '10:00:00' },
      { id: 'slot-2', columnId: 'series', startTime: '10:00:00', endTime: '11:00:00' },
    ],
  },
  columns: [
    { columnId: 'news', columnName: '新闻', defaultProgramType: 'news', source: 'default', draftConstraintKind: 'column' },
    { columnId: 'series', columnName: '电视剧', defaultProgramType: 'series', source: 'default', draftConstraintKind: 'program' },
  ],
}

describe('foreground agent context package', () => {
  it('does not classify natural-language intent locally', () => {
    const context = buildForegroundAgentContextPackage({
      latestUserInput: '请把全天节目重新安排得更适合家庭观看',
      scheduleState,
      currentSchedule: [],
      currentLayoutDraft: null,
    })

    expect(context.scenario).toBe('general')
    expect(context.latestUserInput).toContain('全天节目重新安排')
  })

  it('keeps atomic commands compact and does not inject layout segments', () => {
    const context = buildForegroundAgentContextPackage({
      latestUserInput: '删除9点的节目',
      scheduleState: {
        ...scheduleState,
        playlistId: 'playlist-tv-1',
      },
      currentSchedule: scheduleItems,
      currentLayoutDraft: layoutDraft,
    })

    expect(context.scenario).toBe('layout_reference')
    expect(context.workspace.workspaceKey).toBe('tv:playlist-tv-1')
    expect(context.workspace.playlistId).toBe('playlist-tv-1')
    expect(context.workspace.scheduleSummary).toHaveLength(12)
    expect(context.layoutDraft.available).toBe(true)
    expect(context.layoutDraft.segments).toHaveLength(2)
    expect(context.injectionProfile.includeLayoutSegments).toBe(true)
    expect(context.injectionProfile).toMatchObject({
      scheduleItemLimit: 12,
      layoutSegmentLimit: 12,
      maxPromptChars: 12000,
    })
    expect(context.budget).toMatchObject({
      maxPromptChars: 12000,
      omittedScheduleItems: 2,
      omittedLayoutSegments: 0,
      truncated: true,
    })
    expect(context.budget.omissions).toEqual(['schedule_summary'])
  })

  it('injects layout structure when the user explicitly references the draft', () => {
    const context = buildForegroundAgentContextPackage({
      latestUserInput: '参考草案全天编排',
      scheduleState,
      currentSchedule: scheduleItems,
      currentLayoutDraft: layoutDraft,
    })

    expect(context.scenario).toBe('layout_reference')
    expect(context.layoutDraft.referencedByCurrentTask).toBe(false)
    expect(context.layoutDraft.source).toBe('channel_default')
    expect(context.layoutDraft.effectiveFrom).toBe('2026-03-01')
    expect(context.layoutDraft.effectiveTo).toBe('2026-06-30')
    expect(context.layoutDraft.segments).toEqual([
      { id: 'slot-1', startTime: '09:00:00', endTime: '10:00:00', label: '新闻', constraintKind: 'column' },
      { id: 'slot-2', startTime: '10:00:00', endTime: '11:00:00', label: '电视剧', constraintKind: 'program' },
    ])
    expect(context.injectionProfile).toMatchObject({
      scheduleItemLimit: 12,
      layoutSegmentLimit: 12,
      maxPromptChars: 12000,
    })
  })

  it.each([
    '按草案',
    '按这个版面开始编排',
    '参考当前版面补齐当前所有空窗',
  ])('keeps explicit draft reference wording as a layout reference: %s', (latestUserInput) => {
    const context = buildForegroundAgentContextPackage({
      latestUserInput,
      scheduleState,
      currentSchedule: scheduleItems,
      currentLayoutDraft: layoutDraft,
    })

    expect(context.scenario).toBe('layout_reference')
    expect(context.layoutDraft.referencedByCurrentTask).toBe(false)
    expect(context.layoutDraft.segments).toEqual([
      { id: 'slot-1', startTime: '09:00:00', endTime: '10:00:00', label: '新闻', constraintKind: 'column' },
      { id: 'slot-2', startTime: '10:00:00', endTime: '11:00:00', label: '电视剧', constraintKind: 'program' },
    ])
    expect(context.allowedActions).toContain('prepare_layout')
  })

  it.each([
    '切回频道默认版面草案',
    '切换到上传版面草案',
    '使用上传版面草案',
  ])('recognizes natural-language draft switching without treating it as formal reference: %s', (latestUserInput) => {
    const context = buildForegroundAgentContextPackage({
      latestUserInput,
      scheduleState,
      currentSchedule: scheduleItems,
      currentLayoutDraft: layoutDraft,
    })

    expect(context.scenario).toBe('layout_reference')
    expect(context.layoutDraft.referencedByCurrentTask).toBe(false)
    expect(context.allowedActions).toContain('switch_layout_draft')
  })

  it('aligns rotation layout draft visibility with the foreground workspace', () => {
    const rotationState: ScheduleState = {
      ...scheduleState,
      playlistType: 'rotation',
      playlistId: 'playlist-rotation-1',
      rotationStrategy: 'content_match',
      rotationDurationSeconds: 3 * 60 * 60,
    }
    const rotationDraft: LayoutDraft = {
      ...layoutDraft,
      id: 'draft-rotation-uploaded',
      source: 'uploaded',
      userIntent: '上传轮播版面草案',
    }

    const withoutDraft = buildForegroundAgentContextPackage({
      latestUserInput: '查询当前已排节目',
      scheduleState: rotationState,
      currentSchedule: [],
    })
    const withDraft = buildForegroundAgentContextPackage({
      latestUserInput: '查询当前已排节目',
      scheduleState: rotationState,
      currentSchedule: [],
      currentLayoutDraft: rotationDraft,
    })

    expect(withoutDraft.layoutDraft.visible).toBe(false)
    expect(withoutDraft.layoutDraft.available).toBe(false)
    expect(withDraft.layoutDraft.visible).toBe(true)
    expect(withDraft.layoutDraft.available).toBe(true)
    expect(withDraft.layoutDraft.source).toBe('uploaded')
    expect(withDraft.layoutDraft.segments).toBeUndefined()
  })

  it('carries rotation strategy and duration in the foreground workspace context', () => {
    const rotationState: ScheduleState = {
      ...scheduleState,
      playlistType: 'rotation',
      playlistId: 'playlist-rotation-3h',
      rotationStrategy: 'rating',
      rotationDurationSeconds: 3 * 60 * 60,
    }

    const context = buildForegroundAgentContextPackage({
      latestUserInput: '补齐当前所有空窗',
      scheduleState: rotationState,
      currentSchedule: [],
    })
    const promptBlock = formatForegroundAgentContextForPrompt(context)

    expect(context.workspace).toMatchObject({
      workspaceKey: 'rotation:playlist-rotation-3h',
      playlistType: 'rotation',
      rotationStrategy: 'rating',
      rotationDurationSeconds: 10800,
    })
    expect(promptBlock).toContain('"rotationStrategy": "rating"')
    expect(promptBlock).toContain('"rotationDurationSeconds": 10800')
  })

  it('uses draft completeness to choose formal-generation next actions', () => {
    const tvFullContext = buildForegroundAgentContextPackage({
      latestUserInput: '帮我全天编排',
      scheduleState: {
        ...scheduleState,
        playlistType: 'tv',
        playlistId: 'playlist-tv-full-generate',
      },
      currentSchedule: [],
      currentLayoutDraft: layoutDraft,
    })
    const tvPartialContext = buildForegroundAgentContextPackage({
      latestUserInput: '补齐当前所有空窗',
      scheduleState: {
        ...scheduleState,
        playlistType: 'tv',
        playlistId: 'playlist-tv-partial-generate',
      },
      currentSchedule: [],
      currentLayoutDraft: layoutDraft,
    })
    const rotationState: ScheduleState = {
      ...scheduleState,
      playlistType: 'rotation',
      playlistId: 'playlist-rotation-actions',
      rotationStrategy: 'content_match',
      rotationDurationSeconds: 2 * 60 * 60,
    }
    const rotationContext = buildForegroundAgentContextPackage({
      latestUserInput: '补齐当前所有空窗',
      scheduleState: rotationState,
      currentSchedule: [],
    })

    expect(tvFullContext.scenario).toBe('layout_reference')
    expect(tvFullContext.allowedActions).toContain('full_generate')
    expect(tvFullContext.layoutDraft.available).toBe(true)
    expect(tvFullContext.layoutDraft.referencedByCurrentTask).toBe(false)
    expect(tvFullContext.layoutDraft.completeness.status).toBe('partial')
    expect(tvFullContext.layoutDraft.segments).toEqual([
      { id: 'slot-1', startTime: '09:00:00', endTime: '10:00:00', label: '新闻', constraintKind: 'column' },
      { id: 'slot-2', startTime: '10:00:00', endTime: '11:00:00', label: '电视剧', constraintKind: 'program' },
    ])
    expect(tvFullContext.injectionProfile.includeLayoutSegments).toBe(true)
    expect(tvFullContext.allowedActions).toContain('partial_generate')
    expect(tvPartialContext.scenario).toBe('layout_reference')
    expect(tvPartialContext.allowedActions).toContain('partial_generate')
    expect(tvPartialContext.layoutDraft.segments).toHaveLength(2)
    expect(rotationContext.scenario).toBe('general')
    expect(rotationContext.allowedActions).toContain('upload_layout_draft')
  })

  it('blocks rotation workspaces from advertising tv-style all-day generation without structured support', () => {
    const rotationState: ScheduleState = {
      ...scheduleState,
      playlistType: 'rotation',
      playlistId: 'playlist-rotation-all-day',
      rotationStrategy: 'content_match',
      rotationDurationSeconds: 3 * 60 * 60,
    }

    const context = buildForegroundAgentContextPackage({
      latestUserInput: '帮我全天编排',
      scheduleState: rotationState,
      currentSchedule: [],
    })

    expect(context.scenario).toBe('general')
    expect(context.workspace.playlistType).toBe('rotation')
    expect(context.allowedActions).toContain('full_generate')
  })

  it('requires a loaded tv layout draft before advertising all-day generation', () => {
    const context = buildForegroundAgentContextPackage({
      latestUserInput: '帮我全天编排',
      scheduleState: {
        ...scheduleState,
        playlistType: 'tv',
        playlistId: 'playlist-tv-missing-draft',
      },
      currentSchedule: [],
      currentLayoutDraft: null,
    })

    expect(context.scenario).toBe('general')
    expect(context.workspace.playlistType).toBe('tv')
    expect(context.layoutDraft.available).toBe(false)
    expect(context.allowedActions).toContain('full_generate')
  })

  it('does not leak rotation-only fields into a tv workspace context', () => {
    const context = buildForegroundAgentContextPackage({
      latestUserInput: '补齐当前所有空窗',
      scheduleState: {
        ...scheduleState,
        playlistType: 'tv',
        playlistId: 'playlist-tv-no-rotation',
      },
      currentSchedule: [],
    })

    expect(context.workspace.playlistType).toBe('tv')
    expect(context.workspace).not.toHaveProperty('rotationStrategy')
    expect(context.workspace).not.toHaveProperty('rotationDurationSeconds')
  })

  it('keeps the foreground context package inside an explicit scenario budget', () => {
    const longScheduleItems: RuntimeScheduleItem[] = Array.from({ length: 40 }, (_, index) => ({
      id: `long-item-${index + 1}-${'X'.repeat(100)}`,
      programName: `超长节目名${index + 1}${'节目'.repeat(100)}`,
      startTime: `${String(6 + (index % 18)).padStart(2, '0')}:00:00`,
      endTime: `${String(7 + (index % 18)).padStart(2, '0')}:00:00`,
      programType: `超长类型${'类型'.repeat(50)}`,
    }))
    const longDraft: LayoutDraft = {
      ...layoutDraft,
      layoutReference: {
        ...layoutDraft.layoutReference,
        slots: Array.from({ length: 20 }, (_, index) => ({
          id: `slot-${index + 1}-${'S'.repeat(100)}`,
          columnId: `column-${index + 1}`,
          startTime: `${String(6 + index).padStart(2, '0')}:00:00`,
          endTime: `${String(7 + index).padStart(2, '0')}:00:00`,
        })),
      },
      columns: Array.from({ length: 20 }, (_, index) => ({
        columnId: `column-${index + 1}`,
        columnName: `超长栏目名${index + 1}${'栏目'.repeat(100)}`,
        defaultProgramType: 'news',
        source: 'default',
        draftConstraintKind: 'column',
      })),
    }

    const context = buildForegroundAgentContextPackage({
      latestUserInput: `参考草案全天编排，${'把这些额外描述压缩进上下文'.repeat(200)}`,
      scheduleState,
      currentSchedule: longScheduleItems,
      currentLayoutDraft: longDraft,
    })
    const promptBlock = formatForegroundAgentContextForPrompt(context) ?? ''

    expect(context.scenario).toBe('layout_reference')
    expect(context.latestUserInput).toContain('...已截断')
    expect(context.workspace.scheduleSummary).toHaveLength(12)
    expect(context.layoutDraft.segments).toHaveLength(12)
    expect(context.workspace.scheduleSummary[0]?.programName?.length).toBeLessThanOrEqual(80)
    expect(context.workspace.scheduleSummary[0]?.programType?.length).toBeLessThanOrEqual(80)
    expect(context.layoutDraft.segments?.[0]?.label.length).toBeLessThanOrEqual(80)
    expect(context.budget).toMatchObject({
      maxPromptChars: 12000,
      omittedScheduleItems: 28,
      omittedLayoutSegments: 8,
      truncated: true,
    })
    expect(context.budget.omissions).toEqual(['latest_user_input', 'schedule_summary', 'layout_segments'])
    expect(context.budget.estimatedPromptChars).toBe(promptBlock.length)
    expect(context.budget.estimatedPromptChars).toBeLessThanOrEqual(context.budget.maxPromptChars)
  })

  it('marks pending command as an explicit-disposition review gate', () => {
    const pendingCommand: RuntimePendingCommand = {
      command: { action: 'delete', reasoning: 'test', data: { itemId: 'item-1' } },
      summary: '删除 09:00 的《节目1》',
      reasoning: 'delete requires confirmation',
    }

    const context = buildForegroundAgentContextPackage({
      latestUserInput: '确认',
      scheduleState,
      currentSchedule: scheduleItems,
      pendingCommand,
    })

    expect(context.scenario).toBe('review')
    expect(context.review).toMatchObject({
      kind: 'command',
      action: 'delete',
      riskLevel: 'high',
      allowedResponses: ['confirm', 'cancel'],
      expiresOnNextNonAnswer: false,
    })
  })

  it('keeps a pending review visible so the LLM can explicitly start a new task', () => {
    const pendingCommand: RuntimePendingCommand = {
      command: { action: 'delete', reasoning: 'test', data: { itemId: 'item-1' } },
      summary: '删除 09:00 的《节目1》',
      reasoning: 'delete requires confirmation',
    }

    const context = buildForegroundAgentContextPackage({
      latestUserInput: '查询看东方还有哪些候选',
      scheduleState,
      currentSchedule: scheduleItems,
      pendingCommand,
    })

    expect(context.scenario).toBe('review')
    expect(context.review).toMatchObject({
      kind: 'command',
      action: 'delete',
      expiresOnNextNonAnswer: false,
    })
    expect(context.allowedActions).toEqual(['confirm', 'cancel', 'select', 'clarify', 'start_new_task'])
  })

  it('keeps a pending review only when the user answers inside the same workspace', () => {
    const pendingCommand: RuntimePendingCommand = {
      command: { action: 'delete', reasoning: 'test', data: { itemId: 'item-1' } },
      summary: '删除 09:00 的《节目1》',
      reasoning: 'delete requires confirmation',
    }

    const lifecycle = resolvePendingReviewLifecycle({
      latestUserInput: '确认',
      currentWorkspaceKey: 'tv:playlist-tv-1',
      pendingWorkspaceKey: 'tv:playlist-tv-1',
      pendingCommand,
    })

    expect(lifecycle).toEqual({
      hasPendingReview: true,
      canUsePendingReview: true,
      shouldExpire: false,
    })
  })

  it('keeps an Agent pending confirmation when the user confirms inside the same workspace', () => {
    const lifecycle = resolvePendingReviewLifecycle({
      latestUserInput: '确认',
      currentWorkspaceKey: 'rotation:playlist-rotation-1',
      pendingWorkspaceKey: 'rotation:playlist-rotation-1',
      pendingAtomicContext: {
        action: 'insert',
        phase: 'clarifying',
        slots: {
          targetTime: '00:00:00',
          programName: '城市微短片：春日花路 30秒',
        },
        summary: '轮播单插入《城市微短片：春日花路 30秒》前需要确认。',
        agentPendingTask: {
          taskId: 'pending-agent-insert-1',
          intent: 'insert',
          phase: 'needs_confirmation',
          originalInput: '0点插入城市形象春日花路短片',
          collectedInput: '0点插入城市形象春日花路短片',
          missingSlots: ['confirmation'],
          slots: {
            targetTime: '00:00:00',
            programName: '城市微短片：春日花路 30秒',
          },
          updatedAt: 1,
        },
      },
    })

    expect(lifecycle).toEqual({
      hasPendingReview: true,
      canUsePendingReview: true,
      shouldExpire: false,
    })
  })

  it('does not turn Agent pending clarification into a foreground review gate', () => {
    const lifecycle = resolvePendingReviewLifecycle({
      latestUserInput: '就在已插入的看东方节目后',
      currentWorkspaceKey: 'rotation:playlist-rotation-1',
      pendingWorkspaceKey: 'rotation:playlist-rotation-1',
      pendingAtomicContext: {
        action: 'insert',
        phase: 'clarifying',
        slots: {
          programName: '看东方',
        },
        missingFields: ['target_time'],
        summary: '还需要补充插入节目的位置。',
        agentPendingTask: {
          taskId: 'pending-agent-insert-position',
          intent: 'insert',
          phase: 'needs_clarification',
          originalInput: '继续插入一个看东方节目',
          collectedInput: '继续插入一个看东方节目',
          missingSlots: ['targetTime'],
          slots: {
            programName: '看东方',
          },
          updatedAt: 1,
        },
      },
    })

    expect(lifecycle).toEqual({
      hasPendingReview: false,
      canUsePendingReview: false,
      shouldExpire: false,
    })
  })

  it('does not turn candidate recommendations into a foreground review gate', () => {
    const lifecycle = resolvePendingReviewLifecycle({
      latestUserInput: '换成1点插入',
      currentWorkspaceKey: 'tv:playlist-tv-1',
      pendingWorkspaceKey: 'tv:playlist-tv-1',
      pendingAtomicContext: {
        action: 'insert',
        phase: 'recommending_insert',
        slots: {
          targetTime: '09:00:00',
          programName: '看东方',
        },
        missingFields: ['candidateId'],
        summary: '待确认插入节目',
        reasoning: '候选较多，需要编排员选择。',
        originalUserInput: '在9点插入节目看东方',
        collectedUserInput: '在9点插入节目看东方',
        targetCandidates: [{
          id: 'candidate-kan-dongfang-111',
          programName: '看东方第111期：新春特别行动',
          startTime: '00:00:00',
          endTime: '01:00:00',
        }],
      },
    })

    expect(lifecycle).toEqual({
      hasPendingReview: false,
      canUsePendingReview: false,
      shouldExpire: false,
    })
  })

  it('keeps a composite task pending confirmation when the user confirms inside the same workspace', () => {
    const lifecycle = resolvePendingReviewLifecycle({
      latestUserInput: '确认',
      currentWorkspaceKey: 'tv:playlist-tv-1',
      pendingWorkspaceKey: 'tv:playlist-tv-1',
      pendingAtomicContext: {
        action: 'delete',
        phase: 'clarifying',
        slots: {
          programName: '东方新闻',
        },
        summary: '待确认任务：删除全部《东方新闻》',
        compositeTaskRun: {
          id: 'task-composite-delete-1',
          goal: '删除全部《东方新闻》',
          originalUserInput: '把全部东方新闻节目删除掉',
          status: 'waiting_confirm',
          currentStageIndex: 0,
          loopCount: 0,
          limits: {
            maxStages: 5,
            maxStepsPerStage: 10,
            maxLoopTurns: 5,
            maxAutoExecutePerLoop: 5,
            maxMatchedItemsBeforeNarrowing: 30,
          },
          stages: [{
            id: 'stage-delete-1',
            type: 'batch_atomic',
            status: 'waiting_confirm',
            summary: '删除当前播单里的 1 条《东方新闻》',
            action: 'delete',
            requiresConfirmation: true,
            steps: [{
              id: 'delete-item-news',
              action: 'delete',
              itemId: 'item-news',
              programName: '东方新闻',
            }],
          }],
          createdAt: '2026-03-25T00:00:00.000Z',
          updatedAt: '2026-03-25T00:00:00.000Z',
        },
      },
    })

    expect(lifecycle).toEqual({
      hasPendingReview: true,
      canUsePendingReview: true,
      shouldExpire: false,
    })
  })

  it('keeps a layout-draft research suggestion when the user confirms updating the draft', () => {
    const lifecycle = resolvePendingReviewLifecycle({
      latestUserInput: '更新到草案',
      currentWorkspaceKey: 'rotation:playlist-rotation-1',
      pendingWorkspaceKey: 'rotation:playlist-rotation-1',
      pendingAtomicContext: {
        action: null,
        phase: 'draft_research_confirmation',
        slots: {
          semanticLabel: '金山区最近三年热门景点',
        },
        missingFields: ['selection'],
        summary: '是否把“金山区最近三年热门景点”更新到第 1 段草案',
        reasoning: '素材核验后等待用户确认是否只更新草案。',
        originalUserInput: '第一段金山区景点部分，选择金山区最近3年最火热的景点',
        collectedUserInput: '第一段金山区景点部分，选择金山区最近3年最火热的景点',
        followUpQuestion: '我可以把这个方向更新到草案。',
        layoutDraftSuggestion: {
          purpose: 'candidate_precheck',
          targetSegmentIndex: 1,
          semanticLabel: '金山区最近三年热门景点',
          queries: ['金山区 近三年 热门景点 宣传片'],
          candidateCount: 1,
          topCandidates: [{
            id: 'candidate-jinshan-legoland',
            programName: '金山乐高乐园宣传片',
          }],
          userInput: '第一段金山区景点部分，选择金山区最近3年最火热的景点',
        },
        attemptCount: 0,
        createdAt: '2026-03-25T00:00:00.000Z',
        updatedAt: '2026-03-25T00:00:00.000Z',
      },
    })

    expect(lifecycle).toEqual({
      hasPendingReview: true,
      canUsePendingReview: true,
      shouldExpire: false,
    })
  })

  it('keeps a formal rebuild review only when the user confirms rebuilding the formal playlist', () => {
    const lifecycle = resolvePendingReviewLifecycle({
      latestUserInput: '确认重新编排',
      currentWorkspaceKey: 'rotation:playlist-rotation-1',
      pendingWorkspaceKey: 'rotation:playlist-rotation-1',
      pendingAtomicContext: {
        action: null,
        phase: 'formal_rebuild_confirmation',
        slots: {},
        missingFields: ['selection'],
        summary: '待确认重新编排轮播单',
        reasoning: '当前轮播单已有节目，重新编排会覆盖正式播单。',
        originalUserInput: '按草案重新编排这张轮播单',
        collectedUserInput: '按草案重新编排这张轮播单',
        followUpQuestion: '请确认是否重新编排这张轮播单。',
        formalRebuildConfirmation: {
          actionKind: 'commit_layout_draft',
          mode: 'full_generate',
          useLayoutDraft: true,
          existingItemCount: 3,
          playlistType: 'rotation',
          userInput: '按草案重新编排这张轮播单',
          reasoning: '用户要求按草案重新编排。',
        },
        attemptCount: 0,
        createdAt: '2026-03-25T00:00:00.000Z',
        updatedAt: '2026-03-25T00:00:00.000Z',
      },
    })

    expect(lifecycle).toEqual({
      hasPendingReview: true,
      canUsePendingReview: true,
      shouldExpire: false,
    })
  })

  it('keeps a formal rebuild review when another same-workspace request needs LLM disposition', () => {
    const lifecycle = resolvePendingReviewLifecycle({
      latestUserInput: '先查一下现在有哪些节目',
      currentWorkspaceKey: 'rotation:playlist-rotation-1',
      pendingWorkspaceKey: 'rotation:playlist-rotation-1',
      pendingAtomicContext: {
        action: null,
        phase: 'formal_rebuild_confirmation',
        slots: {},
        missingFields: ['selection'],
        summary: '待确认重新编排轮播单',
        reasoning: '当前轮播单已有节目，重新编排会覆盖正式播单。',
        originalUserInput: '按草案重新编排这张轮播单',
        collectedUserInput: '按草案重新编排这张轮播单',
        followUpQuestion: '请确认是否重新编排这张轮播单。',
        formalRebuildConfirmation: {
          actionKind: 'commit_layout_draft',
          mode: 'full_generate',
          useLayoutDraft: true,
          existingItemCount: 3,
          playlistType: 'rotation',
          userInput: '按草案重新编排这张轮播单',
          reasoning: '用户要求按草案重新编排。',
        },
        attemptCount: 0,
        createdAt: '2026-03-25T00:00:00.000Z',
        updatedAt: '2026-03-25T00:00:00.000Z',
      },
    })

    expect(lifecycle).toEqual({
      hasPendingReview: true,
      canUsePendingReview: true,
      shouldExpire: false,
    })
  })

  it('keeps a layout-draft suggestion when another same-workspace request needs LLM disposition', () => {
    const lifecycle = resolvePendingReviewLifecycle({
      latestUserInput: '第二段也重新查一下',
      currentWorkspaceKey: 'rotation:playlist-rotation-1',
      pendingWorkspaceKey: 'rotation:playlist-rotation-1',
      pendingAtomicContext: {
        action: null,
        phase: 'draft_research_confirmation',
        slots: {
          semanticLabel: '金山区最近三年热门景点',
        },
        missingFields: ['selection'],
        summary: '是否把“金山区最近三年热门景点”更新到第 1 段草案',
        reasoning: '素材核验后等待用户确认是否只更新草案。',
        originalUserInput: '第一段金山区景点部分，选择金山区最近3年最火热的景点',
        collectedUserInput: '第一段金山区景点部分，选择金山区最近3年最火热的景点',
        followUpQuestion: '我可以把这个方向更新到草案。',
        layoutDraftSuggestion: {
          purpose: 'candidate_precheck',
          targetSegmentIndex: 1,
          semanticLabel: '金山区最近三年热门景点',
          queries: ['金山区 近三年 热门景点 宣传片'],
          candidateCount: 1,
          topCandidates: [{
            id: 'candidate-jinshan-legoland',
            programName: '金山乐高乐园宣传片',
          }],
          userInput: '第一段金山区景点部分，选择金山区最近3年最火热的景点',
        },
        attemptCount: 0,
        createdAt: '2026-03-25T00:00:00.000Z',
        updatedAt: '2026-03-25T00:00:00.000Z',
      },
    })

    expect(lifecycle).toEqual({
      hasPendingReview: true,
      canUsePendingReview: true,
      shouldExpire: false,
    })
  })

  it('expires a pending review before interpreting a confirmation in another workspace', () => {
    const pendingCommand: RuntimePendingCommand = {
      command: { action: 'delete', reasoning: 'test', data: { itemId: 'item-1' } },
      summary: '删除 09:00 的《节目1》',
      reasoning: 'delete requires confirmation',
    }

    const lifecycle = resolvePendingReviewLifecycle({
      latestUserInput: '确认',
      currentWorkspaceKey: 'rotation:playlist-rotation-1',
      pendingWorkspaceKey: 'tv:playlist-tv-1',
      pendingCommand,
    })

    expect(lifecycle).toEqual({
      hasPendingReview: true,
      canUsePendingReview: false,
      shouldExpire: true,
      expireReason: 'workspace_changed',
    })
  })

  it('keeps a pending review until the LLM explicitly starts a new task', () => {
    const pendingCommand: RuntimePendingCommand = {
      command: { action: 'delete', reasoning: 'test', data: { itemId: 'item-1' } },
      summary: '删除 09:00 的《节目1》',
      reasoning: 'delete requires confirmation',
    }

    const lifecycle = resolvePendingReviewLifecycle({
      latestUserInput: '补齐当前所有空窗',
      currentWorkspaceKey: 'tv:playlist-tv-1',
      pendingWorkspaceKey: 'tv:playlist-tv-1',
      pendingCommand,
    })

    expect(lifecycle).toEqual({
      hasPendingReview: true,
      canUsePendingReview: true,
      shouldExpire: false,
    })
  })

  it('keeps selection wording with the pending command for LLM interpretation', () => {
    const pendingCommand: RuntimePendingCommand = {
      command: { action: 'delete', reasoning: 'test', data: { itemId: 'item-1' } },
      summary: '删除 09:00 的《节目1》',
      reasoning: 'delete requires confirmation',
    }

    const lifecycle = resolvePendingReviewLifecycle({
      latestUserInput: '选第一个',
      currentWorkspaceKey: 'tv:playlist-tv-1',
      pendingWorkspaceKey: 'tv:playlist-tv-1',
      pendingCommand,
    })

    expect(lifecycle).toEqual({
      hasPendingReview: true,
      canUsePendingReview: true,
      shouldExpire: false,
    })
  })

  it('does not treat candidate-selection context as a foreground review even with plain confirmation wording', () => {
    const lifecycle = resolvePendingReviewLifecycle({
      latestUserInput: '确认',
      currentWorkspaceKey: 'tv:playlist-tv-1',
      pendingWorkspaceKey: 'tv:playlist-tv-1',
      pendingAtomicContext: {
        action: 'replace',
        phase: 'recommending_insert',
        slots: {
          targetTime: '09:00:00',
          replacementProgramName: '东方新闻',
        },
        summary: '替换 09:00 的节目',
        insertRecommendations: [
          {
            candidateId: 'candidate-1',
            programName: '东方新闻',
            durationSeconds: 1800,
            score: 90,
            reason: '同类新闻候选',
          },
        ],
      },
    })

    expect(lifecycle).toEqual({
      hasPendingReview: false,
      canUsePendingReview: false,
      shouldExpire: false,
    })
  })

  it('keeps candidate-selection context out of the foreground review lifecycle even when the user selects an option', () => {
    const lifecycle = resolvePendingReviewLifecycle({
      latestUserInput: '选第一个',
      currentWorkspaceKey: 'tv:playlist-tv-1',
      pendingWorkspaceKey: 'tv:playlist-tv-1',
      pendingAtomicContext: {
        action: 'replace',
        phase: 'recommending_insert',
        slots: {
          targetTime: '09:00:00',
          replacementProgramName: '东方新闻',
        },
        summary: '替换 09:00 的节目',
        insertRecommendations: [
          {
            candidateId: 'candidate-1',
            programName: '东方新闻',
            durationSeconds: 1800,
            score: 90,
            reason: '同类新闻候选',
          },
        ],
      },
    })

    expect(lifecycle).toEqual({
      hasPendingReview: false,
      canUsePendingReview: false,
      shouldExpire: false,
    })
  })

  it('formats the package as a structured prompt block', () => {
    const context = buildForegroundAgentContextPackage({
      latestUserInput: '补齐当前所有空窗',
      scheduleState,
      currentSchedule: scheduleItems,
    })

    const promptBlock = formatForegroundAgentContextForPrompt(context)

    expect(promptBlock).toContain('统一前台上下文包')
    expect(promptBlock).toContain('"scenario": "general"')
    expect(promptBlock).toContain('"gapCount": 2')
    expect(promptBlock).toContain('"contextNotes"')
    expect(promptBlock).not.toContain('"workspaceKey"')
    expect(promptBlock).not.toContain('"injectionProfile"')
    expect(promptBlock).not.toContain('"budget"')
    expect(context.budget.estimatedPromptChars).toBe(promptBlock?.length)
  })

  it('injects only a compact active ReAct task snapshot for long-running scheduling goals', () => {
    const activeReactTaskRun: ReactTaskRun = {
      id: 'react-task-jinshan',
      objective: '先核验金山区热门景点素材，再决定是否更新草案',
      originalUserInput: '第一段金山区景点部分，选择金山区最近3年最火热的景点',
      status: 'observing',
      loopCount: 1,
      limits: {
        maxTurns: 3,
        batchSize: 4,
      },
      stopCondition: '素材方向明确后更新草案，不直接写正式播单',
      steps: [{
        id: 'step-1',
        turn: 1,
        status: 'observed',
        action: {
          type: 'research_check',
          semanticLabel: '金山区最近三年热门景点',
        },
      }],
      observations: [{
        id: 'observation-1',
        turn: 1,
        type: 'asset_search',
        summary: '查到金山乐高乐园宣传片等候选，确认前没有写入正式播单。',
        createdAt: '2026-03-25T09:00:00.000Z',
      }],
      recovery: {
        canRetry: true,
        retryCount: 0,
      },
      createdAt: '2026-03-25T09:00:00.000Z',
      updatedAt: '2026-03-25T09:01:00.000Z',
    }

    const context = buildForegroundAgentContextPackage({
      latestUserInput: '继续核验一下',
      scheduleState: {
        ...scheduleState,
        playlistType: 'rotation',
        playlistId: 'playlist-rotation-react',
        rotationStrategy: 'content_match',
        rotationDurationSeconds: 2 * 60 * 60,
      },
      currentSchedule: [],
      currentLayoutDraft: layoutDraft,
      activeReactTaskRun,
    })
    const promptBlock = formatForegroundAgentContextForPrompt(context) ?? ''

    expect(context.reactTask).toMatchObject({
      active: true,
      id: 'react-task-jinshan',
      objective: '先核验金山区热门景点素材，再决定是否更新草案',
      status: 'observing',
      loopCount: 1,
      maxTurns: 3,
      observationCount: 1,
      recovery: {
        canRetry: true,
        retryCount: 0,
      },
    })
    expect(context.reactTask.lastObservation?.summary).toContain('确认前没有写入正式播单')
    expect(promptBlock).toContain('"activeReactTask"')
    expect(promptBlock).toContain('"objective": "先核验金山区热门景点素材，再决定是否更新草案"')
    expect(promptBlock).toContain('"lastObservation"')
    expect(promptBlock).not.toContain('"steps"')
    expect(promptBlock).not.toContain('"originalUserInput"')
  })

  it('keeps a failed but retryable ReAct task in the prompt for simple continue recovery', () => {
    const failedReactTaskRun: ReactTaskRun = {
      id: 'react-task-retry',
      objective: '重新核验轮播草案素材',
      originalUserInput: '模拟一次失败后继续',
      status: 'failed',
      loopCount: 1,
      limits: {
        maxTurns: 3,
        batchSize: 2,
      },
      stopCondition: '失败后允许用户继续重试上一小步',
      steps: [{
        id: 'step-1',
        turn: 1,
        status: 'failed',
        action: {
          type: 'research_check',
          semanticLabel: '轮播草案素材',
        },
      }],
      observations: [{
        id: 'observation-failed',
        turn: 1,
        type: 'runtime_failure',
        summary: '素材库网络超时，本轮没有修改草案或播单。',
        risk: 'network_timeout',
        createdAt: '2026-03-25T09:00:00.000Z',
      }],
      recovery: {
        canRetry: true,
        retryCount: 0,
        lastFailure: '素材库网络超时',
      },
      createdAt: '2026-03-25T09:00:00.000Z',
      updatedAt: '2026-03-25T09:01:00.000Z',
    }

    const context = buildForegroundAgentContextPackage({
      latestUserInput: '继续',
      scheduleState: {
        ...scheduleState,
        playlistType: 'rotation',
        playlistId: 'playlist-rotation-retry',
        rotationStrategy: 'content_match',
        rotationDurationSeconds: 60 * 60,
      },
      currentSchedule: [],
      currentLayoutDraft: layoutDraft,
      activeReactTaskRun: failedReactTaskRun,
    })
    const promptBlock = formatForegroundAgentContextForPrompt(context) ?? ''

    expect(context.reactTask).toMatchObject({
      active: false,
      status: 'failed',
      recovery: {
        canRetry: true,
        retryCount: 0,
        lastFailure: '素材库网络超时',
      },
    })
    expect(promptBlock).toContain('"activeReactTask"')
    expect(promptBlock).toContain('"status": "failed"')
    expect(promptBlock).toContain('"lastFailure": "素材库网络超时"')
    expect(promptBlock).toContain('"summary": "素材库网络超时，本轮没有修改草案或播单。"')
    expect(promptBlock).not.toContain('"steps"')
    expect(promptBlock).not.toContain('"originalUserInput"')
  })
})
