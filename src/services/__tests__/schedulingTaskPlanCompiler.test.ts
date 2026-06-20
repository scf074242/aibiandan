import { describe, expect, it } from 'vitest'

import type { AgentTaskPlanDraft } from '@/services/agent/types'
import type { RuntimeScheduleItem } from '@/services/runtime/demoRuntimeFacade'
import {
  buildBatchDeleteSchedulingTaskRun,
  compileSchedulingTaskPlanDraft,
  observeBatchDeleteSchedulingTask,
} from '@/services/runtime/schedulingTaskPlanCompiler'

const createItem = (
  id: string,
  programName: string,
  startTime: string,
  endTime: string,
): RuntimeScheduleItem => ({
  id,
  programCode: id,
  programName,
  startTime,
  endTime,
  duration: 1800,
  programType: 'tv',
})

describe('schedulingTaskPlanCompiler', () => {
  it('compiles an LLM taskPlanDraft into a chunked batch delete TaskRun', () => {
    const currentSchedule = Array.from({ length: 12 }, (_, index) => createItem(
      `item-east-${index + 1}`,
      index % 2 === 0 ? '看东方' : '看东方 午间版',
      `2026-03-25T${`${6 + index}`.padStart(2, '0')}:00:00+08:00`,
      `2026-03-25T${`${6 + index}`.padStart(2, '0')}:30:00+08:00`,
    ))
    const draft: AgentTaskPlanDraft = {
      isComposite: true,
      goal: '删除全部看东方',
      stages: [{
        type: 'batch_atomic',
        action: 'delete',
        target: {
          programName: '看东方',
          scope: 'current_playlist',
        },
        requiresConfirmation: true,
        summary: '删除当前播单里的看东方',
      }, {
        type: 'verify',
        requiresConfirmation: false,
        summary: '检查当前播单里是否还剩看东方',
      }],
    }

    const result = compileSchedulingTaskPlanDraft({
      draft,
      userInput: '把全部看东方节目删除掉',
      currentSchedule,
      now: '2026-03-25T00:00:00.000Z',
    })

    expect(result.status).toBe('compiled')
    if (result.status !== 'compiled') throw new Error('expected compiled task')
    expect(result.matchedItems).toHaveLength(12)
    expect(result.taskRun.batch).toMatchObject({
      strategy: 'chunked',
      matchKind: 'program',
      targetLabel: '看东方',
      totalMatched: 12,
      remainingCount: 12,
      batchSize: 10,
      batchIndex: 1,
    })
    expect(result.taskRun.stages[0]).toMatchObject({
      type: 'batch_atomic',
      action: 'delete',
      status: 'waiting_confirm',
    })
    expect(result.taskRun.stages[0]?.steps).toHaveLength(10)
    expect(result.taskRun.stages.at(-1)?.verification).toMatchObject({
      type: 'batch_progress',
      expectedRemaining: 2,
    })
  })

  it('keeps draft refill as a separate stage only when the draft references it', () => {
    const draft: AgentTaskPlanDraft = {
      isComposite: true,
      goal: '删除全部看东方，再按草案补齐空窗',
      stages: [{
        type: 'batch_atomic',
        action: 'delete',
        target: {
          programName: '看东方',
          scope: 'current_playlist',
        },
        requiresConfirmation: true,
      }, {
        type: 'draft_refill',
        requiresLayoutDraft: true,
        layoutDraftReferenced: true,
        requiresConfirmation: true,
      }],
    }

    const result = compileSchedulingTaskPlanDraft({
      draft,
      userInput: '把所有看东方删掉，然后按草案补齐空窗',
      currentSchedule: [
        createItem('item-east-1', '看东方', '2026-03-25T07:00:00+08:00', '2026-03-25T09:00:00+08:00'),
        createItem('item-east-2', '看东方', '2026-03-25T10:00:00+08:00', '2026-03-25T11:00:00+08:00'),
      ],
    })

    expect(result.status).toBe('compiled')
    if (result.status !== 'compiled') throw new Error('expected compiled task')
    expect(result.taskRun.stages.map((stage) => stage.type)).toEqual([
      'batch_atomic',
      'draft_refill',
      'verify',
    ])
    expect(result.taskRun.stages[1]).toMatchObject({
      requiresLayoutDraft: true,
      requiresConfirmation: true,
    })
  })

  it('compiles an LLM insert-with-shift TaskPlan into move, insert, and verify stages', () => {
    const currentSchedule = [
      createItem('item-0900', '看东方', '2026-03-25T09:00:00+08:00', '2026-03-25T09:30:00+08:00'),
      createItem('item-0930', '东方快报', '2026-03-25T09:30:00+08:00', '2026-03-25T10:00:00+08:00'),
    ]
    const draft: AgentTaskPlanDraft = {
      isComposite: true,
      goal: '9点插入30分钟宣传片，已有节目顺延',
      stages: [{
        type: 'batch_atomic',
        action: 'move',
        target: {
          targetTime: '09:00:00',
          scope: 'time_range',
        },
        requiresConfirmation: true,
        summary: '先把9点起受影响节目后移30分钟',
      }, {
        type: 'atomic',
        action: 'insert',
        target: {
          targetTime: '09:00:00',
          programName: '城市形象宣传片',
          candidateId: 'candidate-promo-30m',
          candidateCode: 'candidate-promo-30m',
          programType: 'tv',
          durationSeconds: 1800,
        },
        requiresConfirmation: true,
        summary: '再在9点插入城市形象宣传片',
      }, {
        type: 'verify',
        requiresConfirmation: false,
        summary: '检查顺延后的时间轴',
      }],
    }

    const result = compileSchedulingTaskPlanDraft({
      draft,
      userInput: '9点强制插入一个30分钟宣传片，其余节目可以后移',
      currentSchedule,
      now: '2026-03-25T00:00:00.000Z',
    })

    expect(result.status).toBe('compiled')
    if (result.status !== 'compiled') throw new Error('expected compiled insert-with-shift task')
    expect(result.matchedItems).toHaveLength(2)
    expect(result.taskRun.goal).toBe('9点插入30分钟宣传片，已有节目顺延')
    expect(result.taskRun.stages.map((stage) => stage.action ?? stage.type)).toEqual([
      'move',
      'insert',
      'verify',
    ])
    expect(result.taskRun.stages[0]?.steps).toHaveLength(2)
    expect(result.taskRun.stages[0]?.steps?.[0]).toMatchObject({
      itemId: 'item-0900',
      newStartTime: '2026-03-25T09:30:00+08:00',
    })
    expect(result.taskRun.stages[1]?.steps?.[0]).toMatchObject({
      candidateId: 'candidate-promo-30m',
      targetTime: '09:00:00',
      durationSeconds: 1800,
    })
  })

  it('blocks a compiled plan when the target does not exist in the current playlist', () => {
    const draft: AgentTaskPlanDraft = {
      isComposite: true,
      goal: '删除全部看东方',
      stages: [{
        type: 'batch_atomic',
        action: 'delete',
        target: {
          programName: '看东方',
        },
      }],
    }

    const result = compileSchedulingTaskPlanDraft({
      draft,
      userInput: '删除全部看东方',
      currentSchedule: [
        createItem('item-news', '东方新闻', '2026-03-25T18:30:00+08:00', '2026-03-25T19:00:00+08:00'),
      ],
    })

    expect(result).toMatchObject({
      status: 'blocked',
      reason: 'target_not_found',
    })
  })

  it('recognizes batch replace plans but blocks before candidate selection', () => {
    const currentSchedule = [
      createItem('item-drama-1', '东方剧场：纵有疾风起 第5集', '2026-03-25T13:00:00+08:00', '2026-03-25T13:45:00+08:00'),
      createItem('item-drama-2', '东方剧场：纵有疾风起 第6集', '2026-03-25T13:45:00+08:00', '2026-03-25T14:30:00+08:00'),
      createItem('item-news', '东方新闻', '2026-03-25T18:30:00+08:00', '2026-03-25T19:00:00+08:00'),
    ]
    const draft: AgentTaskPlanDraft = {
      isComposite: true,
      goal: '把下午东方剧场换成轻量资讯',
      stages: [{
        type: 'batch_atomic',
        action: 'replace',
        target: {
          programName: '东方剧场',
          replacementHint: '轻量资讯',
          scope: 'current_playlist',
        },
        requiresConfirmation: true,
        summary: '把当前播单里的东方剧场批量替换成轻量资讯',
      }, {
        type: 'verify',
        requiresConfirmation: false,
        summary: '检查下午内容结构是否变轻',
      }],
    }

    const result = compileSchedulingTaskPlanDraft({
      draft,
      userInput: '把下午的东方剧场都换成轻量资讯',
      currentSchedule,
    })

    expect(result.status).toBe('blocked')
    if (result.status !== 'blocked') throw new Error('expected batch replace to stop before candidate selection')
    expect(result.reason).toBe('needs_candidate_selection')
    expect(result.message).toContain('不会自动套用候选')
    expect(result.details).toMatchObject({
      targetLabel: '东方剧场',
      replacementHint: '轻量资讯',
      matchedCount: 2,
      nextStep: 'candidate_selection_required',
    })
  })

  it('recognizes time-range batch replace plans and still requires candidate selection', () => {
    const currentSchedule = [
      createItem('item-1300', '东方剧场：纵有疾风起 第5集', '2026-03-25T13:00:00+08:00', '2026-03-25T13:45:00+08:00'),
      createItem('item-1400', '东方剧场：纵有疾风起 第6集', '2026-03-25T14:00:00+08:00', '2026-03-25T14:45:00+08:00'),
      createItem('item-1800', '东方新闻', '2026-03-25T18:00:00+08:00', '2026-03-25T18:30:00+08:00'),
    ]
    const draft: AgentTaskPlanDraft = {
      isComposite: true,
      goal: '把13点到17点的节目换成新闻资讯',
      stages: [{
        type: 'batch_atomic',
        action: 'replace',
        target: {
          rangeStart: '13:00:00',
          rangeEnd: '17:00:00',
          replacementHint: '新闻资讯',
          scope: 'time_range',
        },
        requiresConfirmation: true,
      }],
    }

    const result = compileSchedulingTaskPlanDraft({
      draft,
      userInput: '把13点到17点之间的剧场节目换成新闻资讯',
      currentSchedule,
    })

    expect(result.status).toBe('blocked')
    if (result.status !== 'blocked') throw new Error('expected time-range batch replace block')
    expect(result.reason).toBe('needs_candidate_selection')
    expect(result.details).toMatchObject({
      targetLabel: '13:00:00-17:00:00',
      matchKind: 'time_range',
      replacementHint: '新闻资讯',
      matchedCount: 2,
    })
  })

  it('observes batch delete progress after one chunk is written', () => {
    const before = Array.from({ length: 12 }, (_, index) => createItem(
      `item-east-${index + 1}`,
      '看东方',
      `2026-03-25T${`${6 + index}`.padStart(2, '0')}:00:00+08:00`,
      `2026-03-25T${`${6 + index}`.padStart(2, '0')}:30:00+08:00`,
    ))
    const taskRun = buildBatchDeleteSchedulingTaskRun({
      userInput: '把全部看东方节目删除掉',
      targetLabel: '看东方',
      matchedItems: before.slice(0, 10),
      totalMatched: before.length,
      remainingCount: before.length,
      batchIndex: 1,
    })
    const activeStage = taskRun.stages[0]!
    const deleteIds = new Set(activeStage.steps?.map((step) => step.itemId))
    const after = before.filter((item) => !deleteIds.has(item.id))

    const observation = observeBatchDeleteSchedulingTask({
      before,
      after,
      taskRun,
      stage: activeStage,
      writeSucceeded: true,
    })

    expect(observation).toMatchObject({
      targetLabel: '看东方',
      targetText: '《看东方》',
      previousRemaining: 12,
      expectedRemainingAfterBatch: 2,
      committed: true,
    })
    expect(observation.affectedItems).toHaveLength(10)
    expect(observation.remainingItems).toHaveLength(2)
  })

  it('compiles a structured time range batch delete into a chunked TaskRun', () => {
    const currentSchedule = Array.from({ length: 12 }, (_, index) => createItem(
      `item-range-${index + 1}`,
      `Program ${index + 1}`,
      `2026-03-25T${`${4 + index}`.padStart(2, '0')}:00:00+08:00`,
      `2026-03-25T${`${5 + index}`.padStart(2, '0')}:00:00+08:00`,
    ))
    const draft: AgentTaskPlanDraft = {
      isComposite: true,
      goal: 'delete 04:00-16:00 programs',
      stages: [{
        type: 'batch_atomic',
        action: 'delete',
        target: {
          rangeStart: '04:00:00',
          rangeEnd: '16:00:00',
          scope: 'time_range',
        },
        requiresConfirmation: true,
      }],
    }

    const result = compileSchedulingTaskPlanDraft({
      draft,
      userInput: '删除4点到16点全部节目',
      currentSchedule,
      now: '2026-03-25T00:00:00.000Z',
    })

    expect(result.status).toBe('compiled')
    if (result.status !== 'compiled') throw new Error('expected compiled task')
    expect(result.matchedItems).toHaveLength(12)
    expect(result.taskRun.batch).toMatchObject({
      strategy: 'chunked',
      matchKind: 'time_range',
      targetLabel: '04:00:00-16:00:00',
      totalMatched: 12,
      remainingCount: 12,
      batchSize: 10,
      batchIndex: 1,
    })
    expect(result.taskRun.stages[0]?.summary).toContain('04:00:00-16:00:00 时段内的节目')
    expect(result.taskRun.stages[0]?.steps).toHaveLength(10)
    expect(result.taskRun.stages.at(-1)?.verification).toMatchObject({
      type: 'batch_progress',
      expectedRemaining: 2,
    })
  })

  it('observes remaining items by time range after one chunk is written', () => {
    const before = Array.from({ length: 12 }, (_, index) => createItem(
      `item-range-${index + 1}`,
      `Program ${index + 1}`,
      `2026-03-25T${`${4 + index}`.padStart(2, '0')}:00:00+08:00`,
      `2026-03-25T${`${5 + index}`.padStart(2, '0')}:00:00+08:00`,
    ))
    const taskRun = buildBatchDeleteSchedulingTaskRun({
      userInput: '删除4点到16点全部节目',
      matchKind: 'time_range',
      targetLabel: '04:00:00-16:00:00',
      matchedItems: before.slice(0, 10),
      totalMatched: before.length,
      remainingCount: before.length,
      batchIndex: 1,
    })
    const activeStage = taskRun.stages[0]!
    const deleteIds = new Set(activeStage.steps?.map((step) => step.itemId))
    const after = before.filter((item) => !deleteIds.has(item.id))

    const observation = observeBatchDeleteSchedulingTask({
      before,
      after,
      taskRun,
      stage: activeStage,
      writeSucceeded: true,
    })

    expect(observation).toMatchObject({
      targetLabel: '04:00:00-16:00:00',
      targetText: ' 04:00:00-16:00:00 时段内的节目',
      previousRemaining: 12,
      expectedRemainingAfterBatch: 2,
      committed: true,
    })
    expect(observation.affectedItems).toHaveLength(10)
    expect(observation.remainingItems.map((item) => item.id)).toEqual(['item-range-11', 'item-range-12'])
  })
})
