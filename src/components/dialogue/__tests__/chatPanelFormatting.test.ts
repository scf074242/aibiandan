import { describe, expect, it } from 'vitest'

import {
  buildCandidateComparisonNote,
  formatDetails,
  formatProgramLabel,
  formatValidationSummaryText,
  normalizeDecisionExplanation,
} from '../chatPanelFormatting'

describe('chatPanelFormatting', () => {
  it('会标准化决策解释文案', () => {
    expect(normalizeDecisionExplanation('我把你的要求理解为 在 9 点插入节目')).toBe('已理解为 在 9 点插入节目')
  })

  it('会在格式化明细时转换时间字段', () => {
    const result = formatDetails(
      {
        startTime: '2026-04-03T09:00:00+08:00',
        nested: {
          endTime: '09:30:00',
        },
      },
      (value) => value.replace(/^2026-04-03T/, '').replace('+08:00', ''),
    )

    expect(result).toContain('"startTime": "09:00:00"')
    expect(result).toContain('"endTime": "09:30:00"')
  })

  it('会格式化带时段的节目标题', () => {
    const result = formatProgramLabel(
      {
        programName: '看东方',
        startTime: '09:00:00',
        endTime: '10:00:00',
      },
      (start, end) => `${start}-${end}`,
    )

    expect(result).toBe('看东方（09:00:00-10:00:00）')
  })

  it('会输出校验摘要文案', () => {
    expect(formatValidationSummaryText({
      totalIssues: 3,
      criticalCount: 1,
      warningCount: 2,
    })).toBe('共 3 个问题，严重 1 个，提示 2 个')
  })

  it('会优先使用显式候选说明并截断长度', () => {
    const rawNote = '我把你的要求理解为 这是一个非常非常长的候选说明，需要被截断展示给用户查看，并且不要完整透出全部细节'
    const note = buildCandidateComparisonNote(
      {
        selectionMode: 'sequential',
        selectionNote: rawNote,
      },
      false,
      '默认原因',
    )

    expect(note.startsWith('已理解为')).toBe(true)
    expect(note.length).toBeLessThan(rawNote.length)
  })
})
