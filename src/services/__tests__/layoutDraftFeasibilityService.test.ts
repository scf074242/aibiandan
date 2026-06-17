import { describe, expect, it } from 'vitest'

import { LayoutDraftFeasibilityService } from '@/services/layoutDraftFeasibilityService'
import type { HistoryReference, LayoutDraft, ScheduleItemSnapshot } from '@/types/orchestration'

const createDraft = (
  queryHints: string[],
  label = '生命树电视剧',
  programType = 'drama',
  timeRange: { start: string; end: string } = { start: '12:45:00', end: '13:00:00' },
): LayoutDraft => ({
  id: 'draft-1',
  channelId: 'dragon',
  date: '2026-03-25',
  version: 1,
  source: 'generated',
  userIntent: label,
  coverage: timeRange,
  layoutReference: {
    id: 'layout-1',
    name: 'test layout',
    slots: [
      {
        id: 'slot-1',
        channelId: 'dragon',
        startTime: `2026-03-25T${timeRange.start}+08:00`,
        endTime: `2026-03-25T${timeRange.end}+08:00`,
        columnId: 'runtime-column-1',
      },
    ],
  },
  columns: [
    {
      columnId: 'runtime-column-1',
      columnName: label,
      channelId: 'dragon',
      defaultProgramType: programType,
      semanticLabel: label,
      queryHints,
      source: 'generated',
      isSequential: true,
    },
  ],
})

describe('LayoutDraftFeasibilityService', () => {
  it('blocks a draft segment when a concrete title keyword has no library match', () => {
    const service = new LayoutDraftFeasibilityService()
    const report = service.previewFeasibility(createDraft(
      ['生命树电视剧'],
      '生命树电视剧',
      'drama',
      { start: '09:30:00', end: '10:15:00' },
    ))

    expect(report.ok).toBe(false)
    expect(report.summary.blockedCount).toBe(1)
    expect(report.segments[0]?.matchedCandidateCount).toBe(0)
    expect(report.segments[0]?.reasons[0]).toContain('明确关键词没有命中节目库')
  })

  it('keeps generic drama segments feasible through type-level library support', () => {
    const service = new LayoutDraftFeasibilityService()
    const report = service.previewFeasibility(createDraft(
      ['电视剧', '剧场'],
      '电视剧',
      'drama',
      { start: '09:30:00', end: '10:15:00' },
    ))

    expect(report.ok).toBe(true)
    expect(report.segments[0]?.matchedCandidateCount).toBeGreaterThan(0)
  })

  it('blocks a draft segment when the time range cannot fit any candidate of that type', () => {
    const service = new LayoutDraftFeasibilityService()
    const report = service.previewFeasibility(createDraft(['电视剧', '剧场'], '电视剧'))

    expect(report.ok).toBe(false)
    expect(report.summary.blockedCount).toBe(1)
    expect(report.segments[0]?.blockerKind).toBe('duration')
    expect(report.segments[0]?.reasons[0]).toContain('时长无法容纳')
  })

  it('marks common outdoor live segments feasible when matching library programs exist', () => {
    const service = new LayoutDraftFeasibilityService()
    const report = service.previewFeasibility(createDraft(
      ['静安寺', '外场直播', '直播'],
      '静安寺户外直播',
      'news_magazine',
      { start: '14:00:00', end: '14:30:00' },
    ))

    expect(report.ok).toBe(true)
    expect(report.segments[0]?.matchedCandidateCount).toBeGreaterThan(0)
  })

  it('marks cleaned Jing An Temple outdoor live carousel hints feasible', () => {
    const service = new LayoutDraftFeasibilityService()
    const report = service.previewFeasibility(createDraft(
      ['静安寺户外直播', '静安寺', '直播', '外场直播'],
      '静安寺户外直播',
      'news_magazine',
      { start: '14:00:00', end: '15:00:00' },
    ))

    expect(report.ok).toBe(true)
    expect(report.summary.blockedCount).toBe(0)
    expect(report.segments[0]?.matchedCandidateCount).toBeGreaterThan(0)
  })

  it('keeps LLM carousel labels feasible when the label still contains carousel wording', () => {
    const service = new LayoutDraftFeasibilityService()
    const report = service.previewFeasibility(createDraft(
      ['静安寺户外直播轮播', '静安寺', '直播', '外场直播', '轮播单', '内容匹配优先'],
      '静安寺户外直播轮播',
      'news_magazine',
      { start: '14:00:00', end: '15:00:00' },
    ))

    expect(report.ok).toBe(true)
    expect(report.summary.blockedCount).toBe(0)
    expect(report.segments[0]?.matchedCandidateCount).toBeGreaterThan(0)
  })

  it('keeps rating-only carousel strategy phrases feasible instead of treating them as hard keywords', () => {
    const service = new LayoutDraftFeasibilityService()
    const report = service.previewFeasibility(createDraft(
      ['做一版轮播单，优先选择高收视率节目', '轮播单', '收视率优先'],
      '做一版轮播单，优先选择高收视率节目',
      'news_magazine',
      { start: '14:00:00', end: '15:00:00' },
    ))

    expect(report.ok).toBe(true)
    expect(report.summary.blockedCount).toBe(0)
    expect(report.segments[0]?.matchedCandidateCount).toBeGreaterThan(0)
  })

  it('uses functional words such as guide as feasibility constraints', () => {
    const service = new LayoutDraftFeasibilityService()
    const report = service.previewFeasibility(createDraft(
      ['现场导视'],
      '现场导视',
      'news_magazine',
      { start: '14:00:00', end: '14:30:00' },
    ))

    expect(report.ok).toBe(true)
    expect(report.segments[0]?.matchedCandidateCount).toBeGreaterThan(0)
  })

  it('uses column names and content tags as feasibility search evidence', () => {
    const service = new LayoutDraftFeasibilityService()
    const report = service.previewFeasibility(createDraft(
      ['所属栏目看东方', '静安寺'],
      '看东方静安寺',
      'news_magazine',
      { start: '14:00:00', end: '14:30:00' },
    ))

    expect(report.ok).toBe(true)
    expect(report.segments[0]?.matchedCandidateCount).toBeGreaterThan(0)
  })

  it('blocks draft feasibility when structured column and content keywords only match the wrong fields', () => {
    const service = new LayoutDraftFeasibilityService()
    const report = service.previewFeasibility(createDraft(
      ['所属栏目静安寺', '节目内容看东方'],
      '字段错位测试',
      'news_magazine',
      { start: '14:00:00', end: '14:30:00' },
    ))

    expect(report.ok).toBe(false)
    expect(report.segments[0]?.blockerKind).toBe('keyword')
    expect(report.segments[0]?.matchedCandidateCount).toBe(0)
    expect(report.segments[0]?.reasons[0]).toContain('明确关键词没有命中节目库')
  })

  it('blocks a draft segment when a concrete episode requirement has no candidate match', () => {
    const service = new LayoutDraftFeasibilityService()
    const report = service.previewFeasibility(createDraft(
      ['纵有疾风起 第99集'],
      '纵有疾风起 第99集',
      'drama',
      { start: '09:30:00', end: '10:15:00' },
    ))

    expect(report.ok).toBe(false)
    expect(report.segments[0]?.blockerKind).toBe('keyword')
    expect(report.segments[0]?.reasons[0]).toContain('明确关键词没有命中节目库')
  })

  it('blocks sequential TV drafts that would backfill a later episode before an existing earlier episode', () => {
    const service = new LayoutDraftFeasibilityService()
    const existingItems: ScheduleItemSnapshot[] = [
      {
        id: 'existing-0900-episode-1',
        programCode: '002601120001',
        programName: '品质剧场：纵有疾风起 第1集',
        startTime: '2026-03-25T09:00:00+08:00',
        endTime: '2026-03-25T09:45:00+08:00',
        duration: 2700,
        programType: 'drama',
        sequence: 1,
      },
    ]
    const draft = createDraft(
      ['纯电视频道', '顺播', '接昨天', '纵有疾风起'],
      '品质剧场',
      'drama',
      { start: '08:00:00', end: '08:45:00' },
    )
    draft.columns[0] = {
      ...draft.columns[0]!,
      isSequential: true,
      selectionPolicy: {
        primary: 'sequence',
        fallback: ['content_match'],
        requiresPreviousSchedule: true,
      },
    }

    const report = service.previewFeasibility(draft, existingItems)

    expect(report.ok).toBe(false)
    expect(report.summary.blockedCount).toBe(1)
    expect(report.segments[0]?.blockerKind).toBe('schedule_context')
    expect(report.segments[0]?.matchedCandidateCount).toBe(0)
    expect(report.segments[0]?.reasons[0]).toContain('顺播')
  })

  it('uses previous-day sequence progress to preview the next expected episode in TV drafts', () => {
    const service = new LayoutDraftFeasibilityService()
    const historyReference: HistoryReference = {
      dates: ['2026-03-24'],
      schedules: [
        {
          date: '2026-03-24',
          itemCount: 1,
          programTypes: { drama: 1 },
          items: [
            {
              id: 'history-episode-4',
              programCode: '881120030004',
              programName: '品质剧场：纵有疾风起 第4集',
              startTime: '2026-03-24T09:30:00+08:00',
              endTime: '2026-03-24T10:15:00+08:00',
              duration: 2700,
              programType: 'drama',
              sequence: 1,
            },
          ],
        },
      ],
    }
    const draft = createDraft(
      ['纯电视频道', '顺播', '接昨天', '纵有疾风起'],
      '品质剧场',
      'drama',
      { start: '09:30:00', end: '10:15:00' },
    )
    draft.columns[0] = {
      ...draft.columns[0]!,
      isSequential: true,
      selectionPolicy: {
        primary: 'sequence',
        fallback: ['content_match'],
        requiresPreviousSchedule: true,
      },
    }

    const report = service.previewFeasibility(draft, [], historyReference)

    expect(report.ok).toBe(true)
    expect(report.segments[0]?.expectedSequenceNo).toBe(5)
    expect(report.segments[0]?.historyReferenceDate).toBe('2026-03-24')
    expect(report.segments[0]?.historyContextSummary).toContain('第4集')
    expect(report.segments[0]?.historyContextSummary).toContain('第5集')
    expect(report.segments[0]?.matchedCandidateCount).toBeGreaterThan(0)
  })

  it('lets current schedule context override previous-day progress in middle-gap previews', () => {
    const service = new LayoutDraftFeasibilityService()
    const existingItems: ScheduleItemSnapshot[] = [
      {
        id: 'existing-0900-episode-1',
        programCode: '002601120001',
        programName: '品质剧场：纵有疾风起 第1集',
        startTime: '2026-03-25T09:00:00+08:00',
        endTime: '2026-03-25T09:45:00+08:00',
        duration: 2700,
        programType: 'drama',
        sequence: 1,
      },
      {
        id: 'existing-1030-episode-3',
        programCode: '002601120003',
        programName: '品质剧场：纵有疾风起 第3集',
        startTime: '2026-03-25T10:30:00+08:00',
        endTime: '2026-03-25T11:15:00+08:00',
        duration: 2700,
        programType: 'drama',
        sequence: 2,
      },
    ]
    const historyReference: HistoryReference = {
      dates: ['2026-03-24'],
      schedules: [
        {
          date: '2026-03-24',
          itemCount: 1,
          programTypes: { drama: 1 },
          items: [
            {
              id: 'history-episode-4',
              programCode: '881120030004',
              programName: '品质剧场：纵有疾风起 第4集',
              startTime: '2026-03-24T09:30:00+08:00',
              endTime: '2026-03-24T10:15:00+08:00',
              duration: 2700,
              programType: 'drama',
              sequence: 1,
            },
          ],
        },
      ],
    }
    const draft = createDraft(
      ['纯电视频道', '顺播', '接昨天', '纵有疾风起'],
      '品质剧场',
      'drama',
      { start: '09:45:00', end: '10:30:00' },
    )
    draft.columns[0] = {
      ...draft.columns[0]!,
      isSequential: true,
      selectionPolicy: {
        primary: 'sequence',
        fallback: ['content_match'],
        requiresPreviousSchedule: true,
      },
    }

    const report = service.previewFeasibility(draft, existingItems, historyReference)

    expect(report.ok).toBe(true)
    expect(report.summary.blockedCount).toBe(0)
    expect(report.segments[0]?.expectedSequenceNo).toBeUndefined()
    expect(report.segments[0]?.historyContextSummary).toBeUndefined()
    expect(report.segments[0]?.matchedCandidateCount).toBeGreaterThan(0)
  })
})
