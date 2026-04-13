import type { LayoutDraft, LayoutDraftSpec } from '@/types/orchestration'

export interface LayoutDraftValidationIssue {
  level: 'error' | 'warning'
  code:
    | 'empty_segments'
    | 'invalid_coverage'
    | 'invalid_segment'
    | 'segment_out_of_coverage'
    | 'segment_overlap'
    | 'segment_gap'
    | 'missing_column'
  message: string
  segmentId?: string
}

export interface LayoutDraftValidationResult {
  ok: boolean
  errors: LayoutDraftValidationIssue[]
  warnings: LayoutDraftValidationIssue[]
}

const clockToSeconds = (clock: string): number | null => {
  const match = clock.match(/^(\d{2}):(\d{2}):(\d{2})$/)
  if (!match) return null
  const hour = Number(match[1])
  const minute = Number(match[2])
  const second = Number(match[3])
  if (hour > 23 || minute > 59 || second > 59) {
    return null
  }
  return hour * 3600 + minute * 60 + second
}

const isoToClock = (value: string): string => value.split('T')[1]?.slice(0, 8) ?? value

export class LayoutDraftValidator {
  validateSpec(spec: LayoutDraftSpec): LayoutDraftValidationResult {
    const issues: LayoutDraftValidationIssue[] = []
    const coverageStart = clockToSeconds(spec.coverage.start)
    const coverageEnd = clockToSeconds(spec.coverage.end)

    if (coverageStart === null || coverageEnd === null || coverageStart >= coverageEnd) {
      issues.push({
        level: 'error',
        code: 'invalid_coverage',
        message: '版面覆盖时间不合法，必须是明确且递增的 HH:mm:ss 时间。',
      })
    }

    if (spec.segments.length === 0) {
      issues.push({
        level: 'error',
        code: 'empty_segments',
        message: '版面草案至少需要包含一个时段。',
      })
    }

    const normalizedSegments = spec.segments
      .map((segment) => ({
        segment,
        start: clockToSeconds(segment.startTime),
        end: clockToSeconds(segment.endTime),
      }))
      .sort((left, right) => (left.start ?? 0) - (right.start ?? 0))

    normalizedSegments.forEach(({ segment, start, end }) => {
      if (!segment.label || !segment.programType || start === null || end === null || start >= end) {
        issues.push({
          level: 'error',
          code: 'invalid_segment',
          message: `时段 ${segment.label || segment.id || '未命名'} 的起止时间或节目类型不合法。`,
          segmentId: segment.id,
        })
        return
      }

      if (coverageStart !== null && coverageEnd !== null && (start < coverageStart || end > coverageEnd)) {
        issues.push({
          level: 'error',
          code: 'segment_out_of_coverage',
          message: `时段 ${segment.label} 超出了版面覆盖范围。`,
          segmentId: segment.id,
        })
      }
    })

    let cursor = coverageStart
    for (let index = 0; index < normalizedSegments.length; index += 1) {
      const current = normalizedSegments[index]!
      if (current.start === null || current.end === null) {
        continue
      }

      if (cursor !== null && current.start > cursor) {
        issues.push({
          level: 'error',
          code: 'segment_gap',
          message: `版面在 ${this.formatSeconds(cursor)} 到 ${this.formatSeconds(current.start)} 之间存在未解释空档。`,
          segmentId: current.segment.id,
        })
      }

      const next = normalizedSegments[index + 1]
      if (next?.start !== null && next?.start !== undefined && current.end > next.start) {
        issues.push({
          level: 'error',
          code: 'segment_overlap',
          message: `时段 ${current.segment.label} 与 ${next.segment.label} 发生重叠。`,
          segmentId: current.segment.id,
        })
      }

      cursor = current.end
    }

    if (coverageEnd !== null && cursor !== null && cursor < coverageEnd) {
      issues.push({
        level: 'error',
        code: 'segment_gap',
        message: `版面在 ${this.formatSeconds(cursor)} 到 ${this.formatSeconds(coverageEnd)} 之间存在未解释空档。`,
      })
    }

    return this.buildResult(issues)
  }

  validateDraft(draft: LayoutDraft): LayoutDraftValidationResult {
    const issues: LayoutDraftValidationIssue[] = []
    const slotColumnIds = new Set(draft.layoutReference.slots.map((slot) => slot.columnId))
    draft.layoutReference.slots.forEach((slot) => {
      if (!draft.columns.find((column) => column.columnId === slot.columnId)) {
        issues.push({
          level: 'error',
          code: 'missing_column',
          message: `时段 ${slot.id} 缺少对应的栏目定义。`,
          segmentId: slot.id,
        })
      }
    })

    draft.columns.forEach((column) => {
      if (!slotColumnIds.has(column.columnId)) {
        issues.push({
          level: 'warning',
          code: 'missing_column',
          message: `栏目 ${column.columnName} 当前没有被任何版面时段引用。`,
        })
      }
    })

    const specLike: LayoutDraftSpec = {
      coverage: draft.coverage,
      segments: draft.layoutReference.slots.map((slot) => {
        const column = draft.columns.find((item) => item.columnId === slot.columnId)
        return {
          id: slot.id,
          label: column?.semanticLabel ?? column?.columnName ?? slot.id,
          startTime: isoToClock(slot.startTime),
          endTime: isoToClock(slot.endTime),
          programType: column?.defaultProgramType ?? '',
          queryHints: column?.queryHints,
          sequential: column?.isSequential,
        }
      }),
    }

    const specValidation = this.validateSpec(specLike)
    return this.buildResult([...issues, ...specValidation.errors, ...specValidation.warnings])
  }

  private buildResult(issues: LayoutDraftValidationIssue[]): LayoutDraftValidationResult {
    return {
      ok: !issues.some((issue) => issue.level === 'error'),
      errors: issues.filter((issue) => issue.level === 'error'),
      warnings: issues.filter((issue) => issue.level === 'warning'),
    }
  }

  private formatSeconds(totalSeconds: number): string {
    const hours = Math.floor(totalSeconds / 3600)
    const minutes = Math.floor((totalSeconds % 3600) / 60)
    const seconds = totalSeconds % 60
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds
      .toString()
      .padStart(2, '0')}`
  }
}

let globalLayoutDraftValidator: LayoutDraftValidator | null = null

export function getLayoutDraftValidator(): LayoutDraftValidator {
  if (!globalLayoutDraftValidator) {
    globalLayoutDraftValidator = new LayoutDraftValidator()
  }
  return globalLayoutDraftValidator
}
