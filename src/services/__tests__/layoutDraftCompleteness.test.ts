import { describe, expect, it } from 'vitest'

import { evaluateLayoutDraftCompleteness } from '@/services/layoutDraftCompleteness'
import type { LayoutDraft } from '@/types/orchestration'

const createDraft = (overrides: Partial<LayoutDraft> = {}): LayoutDraft => ({
  id: 'draft-1',
  channelId: 'dragon',
  date: '2026-03-25',
  source: 'channel_default',
  userIntent: '频道默认版面',
  coverage: { start: '06:00:00', end: '23:59:59' },
  layoutReference: {
    id: 'layout-1',
    name: '东方卫视版面',
    slots: Array.from({ length: 6 }, (_, index) => ({
      id: `slot-${index + 1}`,
      columnId: `column-${index + 1}`,
      startTime: `${String(6 + index * 3).padStart(2, '0')}:00:00`,
      endTime: `${String(9 + index * 3).padStart(2, '0')}:00:00`,
    })),
  },
  columns: [],
  ...overrides,
})

describe('layoutDraftCompleteness', () => {
  it('marks missing and empty drafts as unusable for all-day generation', () => {
    expect(evaluateLayoutDraftCompleteness(null).status).toBe('missing')
    expect(evaluateLayoutDraftCompleteness(createDraft({
      coverage: { start: '13:00:00', end: '13:00:00' },
      layoutReference: { id: 'empty', name: '空草案', slots: [] },
    })).status).toBe('empty')
  })

  it('marks partial drafts as collaborative continuation state', () => {
    const result = evaluateLayoutDraftCompleteness(createDraft({
      coverage: { start: '13:00:00', end: '18:00:00' },
      layoutReference: {
        id: 'partial',
        name: '下午草案',
        slots: [{ id: 'slot-afternoon', columnId: 'column-afternoon', startTime: '13:00:00', endTime: '18:00:00' }],
      },
    }))

    expect(result.status).toBe('partial')
    expect(result.slotCount).toBe(1)
    expect(result.reason).toContain('部分时段')
  })

  it('marks broad channel drafts as complete enough for all-day generation', () => {
    expect(evaluateLayoutDraftCompleteness(createDraft()).status).toBe('complete')
  })

  it('marks rotation duration segment drafts as complete when planned duration reaches target', () => {
    const result = evaluateLayoutDraftCompleteness(createDraft({
      draftKind: 'duration_segments',
      targetDurationSeconds: 30 * 60 * 60,
      durationSegments: [{
        id: 'segment-jingan',
        label: '上海市静安区景点',
        contentHint: '上海市静安区景点',
        targetDurationSeconds: 30 * 60 * 60,
        selectionPriority: 'content_match',
        repeatPolicy: 'avoid_repeat',
        fallbackPolicy: 'ask_user',
      }],
    }))

    expect(result.status).toBe('complete')
    expect(result.slotCount).toBe(1)
    expect(result.coverageSeconds).toBe(30 * 60 * 60)
  })

  it('marks rotation duration segment drafts as partial when they cover only part of target duration', () => {
    const result = evaluateLayoutDraftCompleteness(createDraft({
      draftKind: 'duration_segments',
      targetDurationSeconds: 30 * 60 * 60,
      durationSegments: [{
        id: 'segment-jingan',
        label: '上海市静安区景点',
        contentHint: '上海市静安区景点',
        targetDurationSeconds: 6 * 60 * 60,
        selectionPriority: 'content_match',
        repeatPolicy: 'avoid_repeat',
        fallbackPolicy: 'ask_user',
      }],
    }))

    expect(result.status).toBe('partial')
    expect(result.reason).toContain('部分目标时长')
  })
})
