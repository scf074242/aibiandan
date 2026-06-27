import { describe, expect, it } from 'vitest'

import {
  buildGapDialogDefaults,
  buildInsertableScheduleItem,
  normalizeScheduleItemForSave,
} from '../broadcastPlanEditorHelpers'

describe('broadcastPlanEditorHelpers', () => {
  it('会根据前后排序值生成缺口默认值', () => {
    expect(buildGapDialogDefaults({
      id: 'gap-1',
      from: '09:30:00',
      to: '10:00:00',
      prevId: 'a',
      nextId: 'b',
      prevSortOrder: 1,
      nextSortOrder: 3,
    })).toEqual({
      startTime: '09:30:00',
      endTime: '10:00:00',
      sortOrder: 2,
    })
  })

  it('会在保存前补齐节目条目的默认字段', () => {
    const item = normalizeScheduleItemForSave(
      {
        startTime: '09:00',
        endTime: '10:00',
        programCode: 'P001',
      },
      {
        generateId: () => 'generated-id',
        resolveScheduleItemProgramType: () => 'program',
        normalizeClockText: (value) => value.length === 5 ? `${value}:00` : value,
        formatRelativeStart: () => '00:00:00',
        formatPlayLengthText: (seconds) => `${seconds / 60}分钟`,
        timeToSeconds: (time) => {
          const [hours = 0, minutes = 0, seconds = 0] = time.split(':').map(Number)
          return hours * 3600 + minutes * 60 + seconds
        },
      },
    )

    expect(item).toMatchObject({
      id: 'generated-id',
      startTime: '09:00:00',
      endTime: '10:00:00',
      programType: 'program',
      relativeStart: '00:00:00',
      playLength: '60分钟',
      materialName: 'P001-MAT',
    })
  })

  it('会在广告场景补齐广告默认字段', () => {
    const item = normalizeScheduleItemForSave(
      {
        id: 'ad-1',
        startTime: '11:00:00',
        endTime: '11:05:00',
      },
      {
        generateId: () => 'unused-id',
        resolveScheduleItemProgramType: () => 'ad',
        normalizeClockText: (value) => value,
        formatRelativeStart: () => '00:00:00',
        formatPlayLengthText: (seconds) => `${seconds / 60}分钟`,
        timeToSeconds: (time) => {
          const [hours = 0, minutes = 0, seconds = 0] = time.split(':').map(Number)
          return hours * 3600 + minutes * 60 + seconds
        },
      },
    )

    expect(item.materialStatus).toBe('pending')
    expect(item.materialName).toBe('待广告系统下发')
  })

  it('会把缺口默认值和 scheduleId 应用到待插入条目', () => {
    expect(buildInsertableScheduleItem(
      {
        id: 'item-1',
        startTime: '09:00:00',
        endTime: '09:30:00',
      },
      {
        startTime: '09:00:00',
        endTime: '09:30:00',
        sortOrder: 1.5,
      },
      'schedule-1',
    )).toMatchObject({
      scheduleId: 'schedule-1',
      sortOrder: 1.5,
      startTime: '09:00:00',
      endTime: '09:30:00',
    })
  })
})
