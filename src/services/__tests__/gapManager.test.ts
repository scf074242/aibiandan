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
})
