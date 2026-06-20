import { afterEach, describe, expect, it } from 'vitest'

import {
  clearRuntimeLayout,
  getRuntimeLayoutEntry,
  hasRuntimeLayoutEntry,
  setRuntimeLayout,
} from '@/services/orchestration/runtimeLayoutRegistry'
import type { ColumnDefinition, LayoutReference } from '@/types/orchestration'

const channelId = 'dragon'
const anchorDate = '2026-01-01'

const layoutReference: LayoutReference = {
  id: 'quarter-layout',
  name: '季度频道版面',
  slots: [
    {
      id: 'quarter-slot-news',
      channelId,
      startTime: '2026-01-01T06:00:00+08:00',
      endTime: '2026-01-01T09:00:00+08:00',
      columnId: 'runtime-column:quarter-news',
    },
  ],
}

const columns: ColumnDefinition[] = [
  {
    columnId: 'runtime-column:quarter-news',
    columnName: '早间新闻',
    channelId,
    defaultProgramType: 'news',
    source: 'imported',
  },
]

describe('runtime layout registry effective period', () => {
  afterEach(() => {
    clearRuntimeLayout(channelId, anchorDate)
  })

  it('resolves a channel layout by effective period when there is no same-day upload', () => {
    setRuntimeLayout({
      sourceFileName: 'dragon-q1-layout.xlsx',
      channelId,
      date: anchorDate,
      effectiveFrom: '2026-01-01',
      effectiveTo: '2026-03-31',
      version: 7,
      templateMode: 'weekday',
      warnings: [],
      layoutReference,
      columns,
    })

    const entry = getRuntimeLayoutEntry(channelId, '2026-03-25')

    expect(entry?.sourceFileName).toBe('dragon-q1-layout.xlsx')
    expect(entry?.effectiveFrom).toBe('2026-01-01')
    expect(entry?.effectiveTo).toBe('2026-03-31')
    expect(entry?.version).toBe(7)
    expect(hasRuntimeLayoutEntry(channelId, '2026-03-25')).toBe(true)
  })

  it('does not use an expired channel layout outside its effective period', () => {
    setRuntimeLayout({
      sourceFileName: 'dragon-q1-layout.xlsx',
      channelId,
      date: anchorDate,
      effectiveFrom: '2026-01-01',
      effectiveTo: '2026-03-31',
      version: 7,
      templateMode: 'weekday',
      warnings: [],
      layoutReference,
      columns,
    })

    expect(getRuntimeLayoutEntry(channelId, '2026-04-01')).toBeNull()
  })
})
