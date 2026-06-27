import { describe, expect, it } from 'vitest'

import {
  buildReferenceItems,
  countEmptyMaterialItems,
  countUnlinkedItems,
  selectDisplayItems,
  sortScheduleItems,
} from '../broadcastPlanViewState'

describe('broadcastPlanViewState', () => {
  it('会按 sortOrder 和开始时间排序节目', () => {
    const result = sortScheduleItems([
      { id: 'b', startTime: '10:00:00', endTime: '10:30:00', sortOrder: 2 },
      { id: 'a', startTime: '09:00:00', endTime: '09:30:00', sortOrder: 1 },
      { id: 'c', startTime: '08:00:00', endTime: '08:30:00', sortOrder: 2 },
    ], (time) => {
      const [hours = 0, minutes = 0] = time.split(':').map(Number)
      return hours * 60 + minutes
    })

    expect(result.map((item) => item.id)).toEqual(['a', 'c', 'b'])
  })

  it('会把版面参考项映射成页面可展示结构', () => {
    const result = buildReferenceItems([
      {
        id: 'layout-1',
        time: '06:00',
        startTime: '06:00',
        endTime: '07:00',
        programName: '看东方带',
        programType: 'news',
        code18: '000001',
        sourceType: 'recorded',
        type: 'program',
        remark: '参考版面',
        duration: 3600,
      },
    ], {
      normalizeDemoDisplayName: (name) => (name || '').replace(/带$/, ''),
      getTimeDiff: () => 3600,
    })

    expect(result).toEqual([
      expect.objectContaining({
        id: 'ref-0',
        startTime: '06:00:00',
        endTime: '07:00:00',
        instanceName: '看东方',
        programName: '看东方',
        indexingSheetCode: 'IDX000001',
        isReference: true,
      }),
    ])
  })

  it('会根据是否展示版面参考切换显示列表', () => {
    const sortedItems = [{ id: 'sorted', startTime: '09:00:00', endTime: '09:30:00' }]
    const referenceItems = [{ id: 'ref', startTime: '06:00:00', endTime: '07:00:00' }]

    expect(selectDisplayItems(true, referenceItems, sortedItems)).toBe(referenceItems)
    expect(selectDisplayItems(false, referenceItems, sortedItems)).toBe(sortedItems)
  })

  it('会统计未关联和空素材条数', () => {
    const items = [
      { id: 'a', startTime: '09:00:00', endTime: '09:30:00', isUnlinkedProduct: true },
      { id: 'b', startTime: '10:00:00', endTime: '10:30:00', isMaterialInfoEmpty: true },
    ]

    expect(countUnlinkedItems(items)).toBe(1)
    expect(countEmptyMaterialItems(items, (item) => Boolean(item.isMaterialInfoEmpty))).toBe(1)
  })
})
