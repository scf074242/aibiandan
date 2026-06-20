import type { AgentTaskPlanDraft, AgentTaskPlanStageDraft } from '@/services/agent/types'

export type SchedulingTaskPlanConflictCode =
  | 'multiple_insert_same_time'
  | 'move_and_insert_same_time'

export interface SchedulingTaskPlanConflict {
  code: SchedulingTaskPlanConflictCode
  targetTime: string
  message: string
  stages: AgentTaskPlanStageDraft[]
}

export interface SchedulingTaskPlanConflictValidation {
  ok: boolean
  conflicts: SchedulingTaskPlanConflict[]
}

export const validateSchedulingTaskPlanDraftConflicts = (
  draft: AgentTaskPlanDraft,
): SchedulingTaskPlanConflictValidation => {
  if (hasExplicitOrderOrShiftPolicy(draft)) return { ok: true, conflicts: [] }

  const stagesByTargetTime = new Map<string, AgentTaskPlanStageDraft[]>()
  for (const stage of draft.stages) {
    if (stage.type !== 'atomic' && stage.type !== 'batch_atomic') continue
    if (stage.action !== 'insert' && stage.action !== 'move') continue
    const targetTime = normalizeTaskPlanTime(stage.target?.targetTime)
    if (!targetTime) continue
    stagesByTargetTime.set(targetTime, [...(stagesByTargetTime.get(targetTime) ?? []), stage])
  }

  const conflicts: SchedulingTaskPlanConflict[] = []
  for (const [targetTime, stages] of stagesByTargetTime) {
    const insertStages = stages.filter((stage) => stage.action === 'insert')
    const moveStages = stages.filter((stage) => stage.action === 'move')
    if (insertStages.length > 1) {
      conflicts.push({
        code: 'multiple_insert_same_time',
        targetTime,
        stages: insertStages,
        message: `${targetTime} 同时要插入多个节目，我需要你先确认顺序或改一个时间。`,
      })
    }
    if (insertStages.length > 0 && moveStages.length > 0) {
      conflicts.push({
        code: 'move_and_insert_same_time',
        targetTime,
        stages: [...moveStages, ...insertStages],
        message: `${targetTime} 同时有移动和插入动作，会互相占位。我需要你先确认谁在前、谁顺延。`,
      })
    }
  }

  return {
    ok: conflicts.length === 0,
    conflicts,
  }
}

const normalizeTaskPlanTime = (value?: string): string | null => {
  if (!value) return null
  const clock = value.includes('T') ? value.split('T')[1]?.slice(0, 8) : value
  if (!clock) return null
  const parts = clock.split(':')
  const hour = Number(parts[0])
  const minute = Number(parts[1] ?? '0')
  const second = Number(parts[2] ?? '0')
  if (![hour, minute, second].every(Number.isFinite)) return null
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) return null
  return `${`${hour}`.padStart(2, '0')}:${`${minute}`.padStart(2, '0')}:${`${second}`.padStart(2, '0')}`
}

const hasExplicitOrderOrShiftPolicy = (draft: AgentTaskPlanDraft): boolean => {
  const text = [
    draft.goal,
    ...draft.stages.map((stage) => stage.summary ?? ''),
  ].join('')
  return /(顺延|后移|往后|向后|推后|延后|放后面|排后面|之后|前面|之前|先.*再|再.*后面|强制插入)/u.test(text)
}
