import { afterEach, describe, expect, it } from 'vitest'

import { clearRuntimeLayout, setRuntimeLayout } from '@/services/orchestration/runtimeLayoutRegistry'
import { resolveForegroundLayoutDraft } from '@/services/runtime/foregroundLayoutDraft'
import type { ColumnDefinition, LayoutReference } from '@/types/orchestration'

const channelId = 'dragon'
const anchorDate = '2026-01-01'

const uploadedLayoutReference: LayoutReference = {
  id: 'spring-layout',
  name: '春季晚间版面',
  slots: [
    {
      id: 'spring-news',
      channelId,
      startTime: '2026-01-01T18:00:00+08:00',
      endTime: '2026-01-01T19:00:00+08:00',
      columnId: 'runtime-column:spring-news',
    },
  ],
}

const uploadedColumns: ColumnDefinition[] = [
  {
    columnId: 'runtime-column:spring-news',
    columnName: '晚间新闻',
    channelId,
    defaultProgramType: 'news',
    semanticLabel: '晚间新闻',
    source: 'imported',
  },
]

describe('foreground layout draft resolver', () => {
  afterEach(() => {
    clearRuntimeLayout(channelId, anchorDate)
  })

  it('loads the channel default layout draft for a TV playlist workspace', () => {
    const draft = resolveForegroundLayoutDraft({
      channelId,
      channelName: '东方卫视',
      date: '2026-03-25',
      playlistType: 'tv',
    })

    expect(draft?.source).toBe('channel_default')
    expect(draft?.channelId).toBe(channelId)
    expect(draft?.effectiveFrom).toBe('2026-03-25')
    expect(draft?.effectiveTo).toBe('2026-06-25')
    expect(draft?.layoutReference.slots.length).toBeGreaterThan(0)
    expect(draft?.coverage.start).toMatch(/^\d{2}:\d{2}:\d{2}$/)
    expect(draft?.strategyProfile?.kind).toBe('tv_channel')
    expect(draft?.strategyProfile?.label).toContain('电视播单')
    expect(draft?.strategyProfile?.keywordPolicy).toBe('soft_match')
    expect(draft?.strategyProfile?.selectionSummary).toContain('栏目名称')
    expect(draft?.columns.every((column) => column.draftConstraintKind === 'column')).toBe(true)
  })

  it('prefers an uploaded channel layout that is effective for the playlist date', () => {
    setRuntimeLayout({
      sourceFileName: 'dragon-spring-layout.xlsx',
      channelId,
      date: anchorDate,
      effectiveFrom: '2026-01-01',
      effectiveTo: '2026-06-30',
      version: 4,
      templateMode: 'weekday_sheet',
      warnings: ['示例告警'],
      layoutReference: uploadedLayoutReference,
      columns: uploadedColumns,
    })

    const draft = resolveForegroundLayoutDraft({
      channelId,
      channelName: '东方卫视',
      date: '2026-03-25',
      playlistType: 'tv',
      userIntent: '切到春季晚间版面',
    })

    expect(draft?.source).toBe('uploaded')
    expect(draft?.effectiveFrom).toBe('2026-01-01')
    expect(draft?.effectiveTo).toBe('2026-06-30')
    expect(draft?.version).toBe(4)
    expect(draft?.warnings).toEqual(['示例告警'])
    expect(draft?.coverage).toEqual({ start: '18:00:00', end: '19:00:00' })
    expect(draft?.columns[0]?.source).toBe('imported')
    expect(draft?.columns[0]?.draftConstraintKind).toBe('unspecified')
  })

  it('preserves explicit uploaded draft constraint kinds instead of inferring all names as columns', () => {
    setRuntimeLayout({
      sourceFileName: 'dragon-explicit-layout.xlsx',
      channelId,
      date: anchorDate,
      effectiveFrom: '2026-01-01',
      effectiveTo: '2026-06-30',
      templateMode: 'weekday_sheet',
      warnings: [],
      layoutReference: uploadedLayoutReference,
      columns: [{
        ...uploadedColumns[0]!,
        draftConstraintKind: 'program',
      }],
    })

    const draft = resolveForegroundLayoutDraft({
      channelId,
      channelName: '东方卫视',
      date: '2026-03-25',
      playlistType: 'tv',
      userIntent: '切到节目版面',
    })

    expect(draft?.source).toBe('uploaded')
    expect(draft?.columns[0]?.draftConstraintKind).toBe('program')
  })

  it('does not invent a draft for an unknown channel', () => {
    const draft = resolveForegroundLayoutDraft({
      channelId: 'unknown-channel',
      channelName: '未知频道',
      date: '2026-03-25',
      playlistType: 'tv',
    })

    expect(draft).toBeNull()
  })

  it('does not invent a default layout draft for a rotation playlist workspace', () => {
    const draft = resolveForegroundLayoutDraft({
      channelId,
      channelName: '东方卫视',
      date: '2026-03-25',
      playlistType: 'rotation',
    })

    expect(draft).toBeNull()
  })

  it('uses an uploaded layout as an independent rotation playlist draft', () => {
    setRuntimeLayout({
      sourceFileName: 'rotation-event-layout.xlsx',
      channelId,
      date: anchorDate,
      effectiveFrom: '2026-01-01',
      effectiveTo: '2026-06-30',
      templateMode: 'single_table',
      warnings: [],
      layoutReference: uploadedLayoutReference,
      columns: uploadedColumns,
    })

    const draft = resolveForegroundLayoutDraft({
      channelId,
      channelName: '轮播单',
      date: '2026-03-25',
      playlistType: 'rotation',
      userIntent: '上传轮播版面草案',
    })

    expect(draft?.source).toBe('uploaded')
    expect(draft?.strategyProfile?.kind).toBe('carousel')
    expect(draft?.strategyProfile?.requiresPreviousSchedule).toBe(false)
    expect(draft?.strategyProfile?.selectionPriority).toBe('content_match')
    expect(draft?.columns[0]?.draftConstraintKind).toBe('unspecified')
  })
})
