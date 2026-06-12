import { describe, expect, it } from 'vitest'

import { createGapManager } from '@/services/gapManager'

describe('GapManager', () => {
  it('alignGapsToLayoutBands 只保留命中版面时段的空窗', () => {
    const manager = createGapManager('dragon', '2026-03-25')

    manager.calculateGapsFromItems(
      [],
      [],
      '2026-03-25T06:00:00+08:00',
      '2026-03-25T23:59:59+08:00',
    )

    manager.alignGapsToLayoutBands([
      {
        startTime: '2026-03-25T09:00:00+08:00',
        endTime: '2026-03-25T10:00:00+08:00',
        programType: 'kids',
        preferredProgramTypes: ['kids'],
      },
    ])

    const gaps = manager.queryRemainingGaps()
    expect(gaps).toHaveLength(1)
    expect(gaps[0]?.startTime).toBe('2026-03-25T09:00:00+08:00')
    expect(gaps[0]?.endTime).toBe('2026-03-25T10:00:00+08:00')
  })

  it('alignGapsToLayoutBands 会把版面空窗标记为固定结束边界', () => {
    const manager = createGapManager('dragon', '2026-03-25')

    manager.calculateGapsFromItems(
      [
        {
          id: 'item-1',
          programName: '看东方 城市观察',
          startTime: '2026-03-25T14:00:00+08:00',
          endTime: '2026-03-25T14:45:00+08:00',
          duration: 2700,
          programType: 'news_magazine',
        },
      ],
      [],
      '2026-03-25T06:00:00+08:00',
      '2026-03-25T23:59:59+08:00',
    )

    manager.alignGapsToLayoutBands([
      {
        startTime: '2026-03-25T14:00:00+08:00',
        endTime: '2026-03-25T15:00:00+08:00',
        programType: 'news_magazine',
        preferredProgramTypes: ['news_magazine', 'news'],
      },
    ])

    const gaps = manager.queryRemainingGaps()
    expect(gaps).toHaveLength(1)
    expect(gaps[0]?.startTime).toBe('2026-03-25T14:45:00+08:00')
    expect(gaps[0]?.endTime).toBe('2026-03-25T15:00:00+08:00')
    expect(gaps[0]?.constraints.fixedEnd).toBe(true)
    expect(gaps[0]?.constraints.maxDuration).toBe(900)
  })
})
