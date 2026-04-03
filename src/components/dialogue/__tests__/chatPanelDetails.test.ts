import { describe, expect, it } from 'vitest'

import {
  buildCandidateComparisonItems,
  buildDetailsSummary,
  extractWarnings,
} from '../chatPanelDetails'
import type { DetailMap } from '../chatPanelFormatting'

const summaryDeps = {
  formatDisplayTime: (value: string) => `fmt:${value}`,
  formatProgramLabel: (value: unknown) => {
    const record = value as { programName?: string; programCode?: string } | undefined
    return record?.programName ?? record?.programCode ?? ''
  },
  resolveMatchedColumnInfo: () => ({
    columnId: 'col-101',
    columnName: '新闻栏目',
  }),
  buildQueryCriteriaSummary: (_criteria: DetailMap) => '查询：新闻栏目，1800-3600秒',
  formatOffset: (offsetSeconds: number) => `${offsetSeconds / 60}分钟`,
}

describe('chatPanelDetails', () => {
  it('会提炼并去重风险提醒', () => {
    const warnings = extractWarnings({
      preview: {
        warnings: ['已有风险', '已有风险'],
        canExecute: false,
      },
      validationSummary: {
        totalIssues: 2,
      },
    })

    expect(warnings).toEqual([
      '已有风险',
      '预演显示当前方案会与现有编排冲突',
      '校验仍发现 2 个问题',
    ])
  })

  it('会构建候选对比信息并标记选中项', () => {
    const items = buildCandidateComparisonItems({
      selectedCandidateId: 'b',
      selectionReason: '我把你的要求理解为 优先选择更贴合当前空窗的节目',
      candidateOptions: [
        {
          id: 'a',
          programName: '看东方',
          duration: 3600,
          programType: 'news_magazine',
          selectionMode: 'sequential',
          issueNo: '12',
        },
        {
          id: 'b',
          programName: '东方新闻',
          duration: 1800,
          programType: 'news',
          selectionMode: 'rerun',
        },
      ],
    })

    expect(items).toHaveLength(2)
    expect(items[0]?.selected).toBe(false)
    expect(items[0]?.meta).toContain('第12期')
    expect(items[1]?.selected).toBe(true)
    expect(items[1]?.note.startsWith('已理解为')).toBe(true)
  })

  it('会生成编排总览明细摘要', () => {
    const items = buildDetailsSummary({
      summaryKind: 'orchestration_overview',
      layoutSourceFileName: 'weekday.xlsx',
      layoutSlotCount: 12,
      completedGapCount: 5,
      insertedItemCount: 5,
      writtenItemCount: 8,
      sequentialFillCount: 3,
      validationSummary: {
        totalIssues: 0,
      },
    }, summaryDeps)

    expect(items).toEqual([
      { label: '版面来源', value: 'weekday.xlsx' },
      { label: '版面时段', value: '12 个' },
      { label: '补排轮次', value: '5 轮' },
      { label: '选中节目', value: '5 次' },
      { label: '实际写入', value: '8 条' },
      { label: '顺播推进', value: '3 次' },
    ])
  })

  it('会生成通用操作明细摘要', () => {
    const items = buildDetailsSummary({
      targetTime: '09:00:00',
      matchedItem: {
        programName: '看东方',
      },
      selectedCandidateName: '东方新闻',
      criteria: {
        columnId: 'col-101',
      },
      candidateCount: 4,
      direction: 'forward',
      offsetSeconds: 1800,
      validationSummary: {
        totalIssues: 1,
        warningCount: 1,
      },
    }, summaryDeps)

    expect(items).toEqual([
      { label: '目标时间', value: 'fmt:09:00:00' },
      { label: '目标节目', value: '看东方' },
      { label: '选中节目', value: '东方新闻' },
      { label: '命中栏目', value: '新闻栏目' },
      { label: '栏目ID', value: 'col-101' },
      { label: '检索条件', value: '新闻栏目，1800-3600秒' },
    ])
  })
})
