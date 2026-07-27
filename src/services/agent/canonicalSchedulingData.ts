/**
 * 唯一业务数据入口。
 *
 * 这里导出的节目、成片、栏目、版面和历史排播均来自 src/mock/data/*.json。
 * 测试替身可以构造现场播单状态，但不得在这里之外复制或发明业务实体。
 */
import {
  orchestrationDemoCandidates,
  orchestrationDemoChannels,
  orchestrationDemoColumns,
  orchestrationDemoFinishedProducts,
  orchestrationDemoHistorySchedules,
  orchestrationDemoLayouts,
  orchestrationDemoProgramDefinitions,
  orchestrationDemoProgramInstances,
} from '@/mock/orchestrationMock'
import type { ProgramCandidate, ProgramDefinition } from '@/types/orchestration'

export const canonicalSchedulingData = Object.freeze({
  channels: orchestrationDemoChannels,
  columns: orchestrationDemoColumns,
  programDefinitions: orchestrationDemoProgramDefinitions,
  programInstances: orchestrationDemoProgramInstances,
  finishedProducts: orchestrationDemoFinishedProducts,
  candidates: orchestrationDemoCandidates,
  layouts: orchestrationDemoLayouts,
  historySchedules: orchestrationDemoHistorySchedules,
})

export type CanonicalSchedulingData = typeof canonicalSchedulingData

const nonEmpty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0

export function findCanonicalCandidate(query: string): ProgramCandidate | undefined {
  const normalized = query.trim().toLocaleLowerCase()
  if (!normalized) return undefined
  return canonicalSchedulingData.candidates.find((candidate) =>
    [candidate.id, candidate.programId, candidate.programCode, candidate.programName, candidate.instanceName]
      .filter(nonEmpty)
      .some((value) => value.toLocaleLowerCase() === normalized),
  )
}

export function findCanonicalProgram(query: string): ProgramDefinition | undefined {
  const normalized = query.trim().toLocaleLowerCase()
  if (!normalized) return undefined
  return canonicalSchedulingData.programDefinitions.find((program) =>
    [program.programId, program.programName]
      .filter(nonEmpty)
      .some((value) => value.toLocaleLowerCase() === normalized),
  )
}

export interface CanonicalDataIssue {
  kind: 'duplicate_id' | 'unknown_program' | 'unknown_column' | 'unknown_instance_program'
  id: string
  detail: string
}

/** 仅校验数据，不生成默认实体或修复数据。 */
export function validateCanonicalSchedulingData(): CanonicalDataIssue[] {
  const issues: CanonicalDataIssue[] = []
  const seen = new Set<string>()
  for (const candidate of canonicalSchedulingData.candidates) {
    if (seen.has(candidate.id)) issues.push({ kind: 'duplicate_id', id: candidate.id, detail: 'candidate id 重复' })
    seen.add(candidate.id)
  }
  const columns = new Set(canonicalSchedulingData.columns.map((column) => column.columnId))
  const programs = new Set(canonicalSchedulingData.programDefinitions.map((program) => program.programId))
  for (const program of canonicalSchedulingData.programDefinitions) {
    if (!columns.has(program.columnId)) {
      issues.push({ kind: 'unknown_column', id: program.programId, detail: `columnId ${program.columnId} 不存在` })
    }
  }
  for (const instance of canonicalSchedulingData.programInstances) {
    if (!programs.has(instance.programId)) {
      issues.push({ kind: 'unknown_instance_program', id: instance.instanceId, detail: `programId ${instance.programId} 不存在` })
    }
  }
  return issues
}
