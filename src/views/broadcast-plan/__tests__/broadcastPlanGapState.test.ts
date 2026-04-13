import { describe, expect, it } from 'vitest'

import {
  buildDisplayGapEntries,
  buildRuntimeGapEntries,
  buildTimeDiscontinuities,
  resolveGapSummaryLabel,
} from '../broadcastPlanGapState'

describe('broadcastPlanGapState', () => {
  const timeToSeconds = (time: string) => {
    const [hours = 0, minutes = 0, seconds = 0] = time.split(':').map(Number)
    return hours * 3600 + minutes * 60 + seconds
  }

  it('会识别节目之间的时间空窗', () => {
    const gaps = buildTimeDiscontinuities([
      {
        id: 'item-1',
        startTime: '09:00:00',
        endTime: '09:30:00',
        sortOrder: 1,
      },
      {
        id: 'item-2',
        startTime: '09:45:00',
        endTime: '10:00:00',
        sortOrder: 2,
      },
    ], timeToSeconds)

    expect(gaps).toEqual([
      {
        id: 'item-1-item-2',
        from: '09:30:00',
        to: '09:45:00',
        prevId: 'item-1',
        nextId: 'item-2',
        prevSortOrder: 1,
        nextSortOrder: 2,
      },
    ])
  })

  it('会把播出开始前和结束后的空档也识别为空窗', () => {
    const gaps = buildTimeDiscontinuities([
      {
        id: 'item-1',
        startTime: '06:15:00',
        endTime: '06:30:00',
        sortOrder: 1,
      },
      {
        id: 'item-2',
        startTime: '06:45:00',
        endTime: '07:00:00',
        sortOrder: 2,
      },
    ], timeToSeconds, {
      startTime: '06:00:00',
      endTime: '07:30:00',
    })

    expect(gaps).toEqual([
      {
        id: 'broadcast-start-item-1',
        from: '06:00:00',
        to: '06:15:00',
        prevId: '',
        nextId: 'item-1',
        prevSortOrder: 0,
        nextSortOrder: 1,
      },
      {
        id: 'item-1-item-2',
        from: '06:30:00',
        to: '06:45:00',
        prevId: 'item-1',
        nextId: 'item-2',
        prevSortOrder: 1,
        nextSortOrder: 2,
      },
      {
        id: 'item-2-broadcast-end',
        from: '07:00:00',
        to: '07:30:00',
        prevId: 'item-2',
        nextId: '',
        prevSortOrder: 2,
        nextSortOrder: 3,
      },
    ])
  })

  it('在没有任何节目时会把整个播出时段识别为空窗', () => {
    const gaps = buildTimeDiscontinuities([], timeToSeconds, {
      startTime: '06:00:00',
      endTime: '23:59:59',
    })

    expect(gaps).toEqual([
      {
        id: 'broadcast-start-broadcast-end',
        from: '06:00:00',
        to: '23:59:59',
        prevId: '',
        nextId: '',
        prevSortOrder: 0,
        nextSortOrder: 1,
      },
    ])
  })

  it('会忽略重叠和连续时段', () => {
    const gaps = buildTimeDiscontinuities([
      {
        id: 'item-1',
        startTime: '09:00:00',
        endTime: '09:30:00',
        sortOrder: 1,
      },
      {
        id: 'item-2',
        startTime: '09:30:00',
        endTime: '10:00:00',
        sortOrder: 2,
      },
      {
        id: 'item-3',
        startTime: '09:50:00',
        endTime: '10:30:00',
        sortOrder: 3,
      },
    ], timeToSeconds)

    expect(gaps).toEqual([])
  })

  it('会把运行时空窗映射成展示结构并过滤 completed', () => {
    const entries = buildRuntimeGapEntries({
      sessionId: 'session-1',
      status: 'running',
      currentGapId: undefined,
      gapProgress: {
        total: 2,
        pending: 1,
        processing: 1,
        completed: 0,
        failed: 0,
      },
      currentAction: {
        phase: 'planning',
        description: '处理中',
      },
      stats: {
        totalCommands: 0,
        successfulCommands: 0,
        failedCommands: 0,
        fallbackCount: 0,
        repairRounds: 0,
      },
      liveGaps: [
        {
          id: 'gap-1',
          startTime: '2026-04-03T09:30:00+08:00',
          endTime: '2026-04-03T09:45:00+08:00',
          duration: 900,
          precedingItemId: 'item-1',
          followingItemId: 'item-2',
          constraints: {},
          metadata: {
            source: 'generated',
            priority: 1,
            createdAt: '2026-04-03T00:00:00+08:00',
            updatedAt: '2026-04-03T00:00:00+08:00',
          },
          status: 'processing',
        },
        {
          id: 'gap-2',
          startTime: '2026-04-03T10:00:00+08:00',
          endTime: '2026-04-03T10:15:00+08:00',
          duration: 900,
          constraints: {},
          metadata: {
            source: 'generated',
            priority: 1,
            createdAt: '2026-04-03T00:00:00+08:00',
            updatedAt: '2026-04-03T00:00:00+08:00',
          },
          status: 'completed',
        },
      ],
      recentLogs: [],
      startedAt: '2026-04-03T09:00:00+08:00',
    }, (value) => value.split('T')[1]?.slice(0, 8) || value)

    expect(entries).toEqual([
      {
        id: 'gap-1',
        from: '09:30:00',
        to: '09:45:00',
        prevId: 'item-1',
        nextId: 'item-2',
        prevSortOrder: 0,
        nextSortOrder: 0,
        source: 'runtime',
        status: 'processing',
        error: undefined,
      },
    ])
  })

  it('优先展示运行时空窗，否则回退到手工空窗', () => {
    const manualGaps = [
      {
        id: 'gap-manual',
        from: '11:00:00',
        to: '11:15:00',
        prevId: 'item-a',
        nextId: 'item-b',
        prevSortOrder: 1,
        nextSortOrder: 2,
      },
    ]

    expect(buildDisplayGapEntries([], manualGaps)).toEqual([
      {
        ...manualGaps[0],
        source: 'manual',
        status: 'pending',
      },
    ])

    expect(resolveGapSummaryLabel(buildDisplayGapEntries([], manualGaps))).toBe('待处理空窗')
    expect(resolveGapSummaryLabel([])).toBe('时间空缺')
  })
})
