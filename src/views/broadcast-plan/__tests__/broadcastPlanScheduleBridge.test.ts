import { describe, expect, it } from 'vitest'

import {
  buildAtomicTimeRange,
  formatAtomicDateTime,
  mapAtomicItemToPageItem,
  mapChatScheduleUpdateItemToAtomicSnapshot,
  mapPageItemToAtomicSnapshot,
  mapScheduleItemToChatSchedule,
  normalizeAtomicDateTime,
} from '../broadcastPlanScheduleBridge'

const timeUtils = {
  normalizeClockText: (value: string) => value.length === 5 ? `${value}:00` : value,
  timeToSeconds: (value: string) => {
    const [hours = 0, minutes = 0, seconds = 0] = value.split(':').map(Number)
    return hours * 3600 + minutes * 60 + seconds
  },
}

describe('broadcastPlanScheduleBridge', () => {
  it('会格式化原子时间', () => {
    expect(formatAtomicDateTime(new Date('2026-04-03T09:08:07+08:00'))).toBe('2026-04-03T09:08:07+08:00')
  })

  it('会补齐本地时间的时区信息', () => {
    expect(normalizeAtomicDateTime('09:00', '2026-04-03')).toBe('2026-04-03T09:00:00+08:00')
    expect(normalizeAtomicDateTime('2026-04-03T09:00:00', '2026-04-03')).toBe('2026-04-03T09:00:00+08:00')
  })

  it('会正确处理跨天时段', () => {
    const range = buildAtomicTimeRange('2026-04-03', '23:30:00', '00:10:00', timeUtils)

    expect(range.normalizedStartTime).toBe('2026-04-03T23:30:00+08:00')
    expect(range.normalizedEndTime).toBe('2026-04-04T00:10:00+08:00')
    expect(range.duration).toBe(2400)
  })

  it('会把页面条目映射成原子快照', () => {
    const snapshot = mapPageItemToAtomicSnapshot(
      {
        id: 'item-1',
        startTime: '09:00:00',
        endTime: '10:00:00',
        programName: '看东方',
        relativeStart: '00:15:00',
      },
      0,
      '2026-04-03',
      {
        ...timeUtils,
        resolveScheduleItemProgramType: () => 'news_magazine',
      },
    )

    expect(snapshot).toMatchObject({
      id: 'item-1',
      programCode: '',
      programName: '看东方',
      duration: 3600,
      programType: 'news_magazine',
      sequence: 1,
      relativeStartSeconds: 900,
    })
  })

  it('会把原子快照映射回页面条目', () => {
    const pageItem = mapAtomicItemToPageItem(
      {
        id: 'item-2',
        programCode: 'P002',
        programName: '午间新闻',
        startTime: '2026-04-03T12:00:00+08:00',
        endTime: '2026-04-03T12:30:00+08:00',
        duration: 1800,
        programType: 'ad',
        sequence: 2,
        relativeStartSeconds: 600,
      },
      1,
      {
        scheduleId: 'schedule-1',
        formatPlayLengthText: (seconds) => `${seconds / 60}分钟`,
        formatRelativeStart: (seconds) => `${seconds}秒`,
      },
    )

    expect(pageItem).toMatchObject({
      id: 'item-2',
      scheduleId: 'schedule-1',
      startTime: '12:00:00',
      endTime: '12:30:00',
      materialStatus: 'pending',
      materialName: '待广告系统下发',
      playLength: '30分钟',
      relativeStart: '600秒',
    })
  })

  it('会生成给 ChatPanel 的精简节目结构', () => {
    const chatItem = mapScheduleItemToChatSchedule(
      {
        id: 'item-3',
        startTime: '13:00:00',
        endTime: '13:20:00',
        instanceName: '民生访谈',
      },
      {
        ...timeUtils,
        resolveScheduleItemProgramType: () => 'livelihood',
      },
    )

    expect(chatItem).toEqual({
      id: 'item-3',
      programCode: '',
      programName: '民生访谈',
      startTime: '13:00:00',
      endTime: '13:20:00',
      duration: 1200,
      programType: 'livelihood',
    })
  })
})

describe('broadcastPlanScheduleBridge runtime updates', () => {
  it('maps ChatPanel runtime schedule updates back to atomic snapshots', () => {
    const snapshot = mapChatScheduleUpdateItemToAtomicSnapshot(
      {
        id: 'runtime-item-1',
        programCode: 'P900',
        programName: '城市形象短片',
        startTime: '00:00:00',
        endTime: '00:03:00',
        duration: 180,
        programType: 'short_clip',
      },
      0,
      '2026-04-03',
      timeUtils,
    )

    expect(snapshot).toMatchObject({
      id: 'runtime-item-1',
      programCode: 'P900',
      programName: '城市形象短片',
      startTime: '2026-04-03T00:00:00+08:00',
      endTime: '2026-04-03T00:03:00+08:00',
      duration: 180,
      programType: 'short_clip',
      sequence: 1,
    })
  })

  it('keeps program-code-less rotation materials blank instead of filling the asset id', () => {
    const snapshot = mapChatScheduleUpdateItemToAtomicSnapshot(
      {
        id: 'asset-short-city-flower',
        programCode: '',
        programName: '城市微短片：春日花路 30秒',
        startTime: '00:00:00',
        endTime: '00:00:30',
        duration: 30,
        programType: 'short_clip',
      },
      0,
      '2026-04-03',
      timeUtils,
    )

    expect(snapshot).toMatchObject({
      id: 'asset-short-city-flower',
      programCode: '',
      programName: '城市微短片：春日花路 30秒',
      programType: 'short_clip',
    })
  })
})
