import { describe, expect, it } from 'vitest'

import type { AgentTaskPlanDraft } from '@/services/agent/types'
import { validateSchedulingTaskPlanDraftConflicts } from '@/services/runtime/schedulingTaskPlanConflict'

describe('schedulingTaskPlanConflict', () => {
  it('blocks multiple inserts at the same time when no order is provided', () => {
    const draft: AgentTaskPlanDraft = {
      isComposite: true,
      goal: '9点插入看东方和百姓大讲堂',
      stages: [{
        type: 'atomic',
        action: 'insert',
        target: {
          targetTime: '09:00:00',
          programName: '看东方',
        },
      }, {
        type: 'atomic',
        action: 'insert',
        target: {
          targetTime: '09:00:00',
          programName: '百姓大讲堂',
        },
      }],
    }

    const result = validateSchedulingTaskPlanDraftConflicts(draft)

    expect(result.ok).toBe(false)
    expect(result.conflicts[0]).toMatchObject({
      code: 'multiple_insert_same_time',
      targetTime: '09:00:00',
    })
  })

  it('blocks move and insert actions that both target the same time', () => {
    const draft: AgentTaskPlanDraft = {
      isComposite: true,
      goal: '把10点的节目移动到9点，再9点插入看东方',
      stages: [{
        type: 'atomic',
        action: 'move',
        target: {
          targetTime: '09:00:00',
        },
      }, {
        type: 'atomic',
        action: 'insert',
        target: {
          targetTime: '09:00:00',
          programName: '看东方',
        },
      }],
    }

    const result = validateSchedulingTaskPlanDraftConflicts(draft)

    expect(result.ok).toBe(false)
    expect(result.conflicts[0]).toMatchObject({
      code: 'move_and_insert_same_time',
      targetTime: '09:00:00',
    })
  })

  it('allows same-time plans when the user explicitly gives a shift policy', () => {
    const draft: AgentTaskPlanDraft = {
      isComposite: true,
      goal: '9点强制插入30分钟宣传片，原来的节目后移',
      stages: [{
        type: 'batch_atomic',
        action: 'move',
        target: {
          targetTime: '09:00:00',
        },
        summary: '把9点及之后受影响的节目后移30分钟',
      }, {
        type: 'atomic',
        action: 'insert',
        target: {
          targetTime: '09:00:00',
          programName: '宣传片',
        },
      }],
    }

    const result = validateSchedulingTaskPlanDraftConflicts(draft)

    expect(result.ok).toBe(true)
  })
})
