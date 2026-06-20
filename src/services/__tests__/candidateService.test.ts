import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { getAtomicCapabilities, resetAtomicCapabilities } from '@/services/atomicCapabilities'
import { getCandidateService, resetCandidateService } from '@/services/candidateService'
import { clearRuntimeLayout, setRuntimeLayout } from '@/services/orchestration/runtimeLayoutRegistry'
import type { GapInfo, ProgramCandidate, ScheduleItemSnapshot } from '@/types/orchestration'

const baseDate = '2026-03-25'

const iso = (time: string) => `${baseDate}T${time}+08:00`

const createGap = (overrides: Partial<GapInfo> = {}): GapInfo => ({
  id: 'gap-1',
  startTime: iso('09:30:00'),
  endTime: iso('10:15:00'),
  duration: 2700,
  constraints: {},
  metadata: {
    source: 'generated',
    priority: 1,
    createdAt: iso('00:00:00'),
    updatedAt: iso('00:00:00'),
  },
  ...overrides,
})

const createScheduledItem = (overrides: Partial<ScheduleItemSnapshot> = {}): ScheduleItemSnapshot => ({
  id: 'scheduled-1',
  programCode: '002601120001',
  programName: '品质剧场：纵有疾风起 第1集',
  startTime: iso('08:45:00'),
  endTime: iso('09:30:00'),
  duration: 2700,
  programType: 'drama',
  sequence: 1,
  ...overrides,
})

const createCandidate = (overrides: Partial<ProgramCandidate> = {}): ProgramCandidate => ({
  id: 'candidate-1',
  programId: 'P-NEWS-1',
  programCode: 'NEWS-001',
  programName: 'Daily News',
  channelId: 'dragon',
  duration: 900,
  programType: 'news',
  instanceName: 'Daily News',
  ...overrides,
})

const registerRuntimeSequentialDramaLayout = () => {
  setRuntimeLayout({
    sourceFileName: 'AI layout draft',
    channelId: 'dragon',
    date: baseDate,
    warnings: [],
    layoutReference: {
      id: 'runtime-layout-sequence-test',
      name: 'Runtime sequence layout',
      slots: [
        {
          id: 'runtime-slot-sequence-test',
          channelId: 'dragon',
          columnId: 'runtime-column:dragon:2026-03-25:sequence-test',
          startTime: iso('08:00:00'),
          endTime: iso('08:45:00'),
        },
      ],
    },
    columns: [
      {
        columnId: 'runtime-column:dragon:2026-03-25:sequence-test',
        columnName: 'AI品质剧场',
        channelId: 'dragon',
        defaultProgramType: 'drama',
        isSequential: true,
        semanticLabel: '品质剧场',
        queryHints: ['纵有疾风起'],
        selectionPolicy: {
          primary: 'sequence',
          fallback: ['content_match', 'rating'],
          requiresPreviousSchedule: true,
        },
        source: 'generated',
      },
    ],
  })
}

describe('CandidateService', () => {
  beforeEach(async () => {
    resetCandidateService()
    resetAtomicCapabilities()
    clearRuntimeLayout('dragon', baseDate)
    await getAtomicCapabilities().clearAll()
  })

  afterEach(() => {
    clearRuntimeLayout('dragon', baseDate)
  })

  it('queryCandidates 会优先按 searchKeywords 命中候选节目', async () => {
    const service = getCandidateService()
    const result = await service.queryCandidates(
      createGap({
        startTime: iso('07:00:00'),
        endTime: iso('08:00:00'),
        duration: 3600,
      }),
      {
        targetTimeRange: { start: iso('07:00:00'), end: iso('08:00:00') },
        expectedDuration: { min: 3300, max: 3900 },
        channelId: 'dragon',
        columnId: '',
        programTypePreference: ['news_magazine', 'news'],
        searchKeywords: ['看东方'],
        excludeUsed: true,
      },
    )

    expect(result.candidates.length).toBeGreaterThan(0)
    expect(result.candidates[0]?.programName).toContain('看东方')
  })

  it('queryCandidates 对明确标题关键词无命中时不会回退到类型匹配结果', async () => {
    const service = getCandidateService()
    const result = await service.queryCandidates(
      createGap({
        startTime: iso('12:45:00'),
        endTime: iso('13:00:00'),
        duration: 900,
      }),
      {
        targetTimeRange: { start: iso('12:45:00'), end: iso('13:00:00') },
        expectedDuration: { min: 60, max: 1800 },
        channelId: 'dragon',
        columnId: '',
        programTypePreference: ['drama'],
        searchKeywords: ['生命树电视剧'],
        excludeUsed: true,
      },
    )

    expect(result.candidates).toHaveLength(0)
    expect(result.diagnostics?.hardKeywordRequired).toBe(true)
    expect(result.diagnostics?.rejectionReasons).toContain('hard_keyword_no_match')
    expect(result.diagnostics?.notes).toContain('hard_keyword_required')
  })

  it('queryCandidates 会在明确标题和集数命中时返回可编排候选', async () => {
    const service = getCandidateService()
    const result = await service.queryCandidates(
      createGap({
        startTime: iso('12:45:00'),
        endTime: iso('13:00:00'),
        duration: 900,
      }),
      {
        targetTimeRange: { start: iso('12:45:00'), end: iso('13:00:00') },
        expectedDuration: { min: 60, max: 1800 },
        channelId: 'dragon',
        columnId: '',
        programTypePreference: ['drama'],
        searchKeywords: ['梦醒剧场：归路 第1集'],
        excludeUsed: true,
      },
    )

    expect(result.candidates.length).toBeGreaterThan(0)
    expect(result.candidates[0]?.programName).toContain('归路')
    expect(result.candidates[0]?.issueNo).toBe('0001')
  })

  it('queryCandidates 会把用户明确指定的集数作为硬约束', async () => {
    const service = getCandidateService()
    const result = await service.queryCandidates(
      createGap(),
      {
        targetTimeRange: { start: iso('09:30:00'), end: iso('10:15:00') },
        expectedDuration: { min: 2400, max: 3000 },
        channelId: 'dragon',
        columnId: '112',
        programTypePreference: ['drama'],
        searchKeywords: ['纵有疾风起 第5集'],
        excludeUsed: true,
      },
    )

    expect(result.candidates.length).toBeGreaterThan(0)
    expect(result.candidates.every((candidate) => candidate.programName.includes('纵有疾风起'))).toBe(true)
    expect(result.candidates.every((candidate) => candidate.issueNo === '0005')).toBe(true)
    expect(result.candidates.some((candidate) => candidate.programName.includes('第1集'))).toBe(false)
  })

  it('queryCandidates 对明确标题命中但集数不存在时保留空缺诊断', async () => {
    const service = getCandidateService()
    const result = await service.queryCandidates(
      createGap(),
      {
        targetTimeRange: { start: iso('09:30:00'), end: iso('10:15:00') },
        expectedDuration: { min: 2400, max: 3000 },
        channelId: 'dragon',
        columnId: '112',
        programTypePreference: ['drama'],
        searchKeywords: ['纵有疾风起 第99集'],
        excludeUsed: true,
      },
    )

    expect(result.candidates).toHaveLength(0)
    expect(result.diagnostics?.explicitSequenceRequired).toBe(true)
    expect(result.diagnostics?.rejectionReasons).toContain('explicit_sequence_no_match')
    expect(result.diagnostics?.notes).toContain('explicit_sequence_required')
  })

  it('queryCandidates 对泛类型关键词无命中时仍允许类型兜底', async () => {
    const service = getCandidateService()
    const result = await service.queryCandidates(
      createGap({
        startTime: iso('07:00:00'),
        endTime: iso('08:00:00'),
        duration: 3600,
      }),
      {
        targetTimeRange: { start: iso('07:00:00'), end: iso('08:00:00') },
        expectedDuration: { min: 3300, max: 3900 },
        channelId: 'dragon',
        columnId: '',
        programTypePreference: ['news_magazine', 'news'],
        searchKeywords: ['新闻栏目'],
        excludeUsed: true,
      },
    )

    expect(result.candidates.length).toBeGreaterThan(0)
    expect(result.candidates.some((candidate) => ['news_magazine', 'news'].includes(candidate.programType))).toBe(true)
    expect(result.diagnostics?.fallbackToBroadQuery).toBe(true)
    expect(result.diagnostics?.notes).toContain('soft_keyword_fallback_to_broad_query')
  })

  it('顺播栏目会优先推荐下一集', async () => {
    const atomicCapabilities = getAtomicCapabilities()
    await atomicCapabilities.replaceAllItems([
      createScheduledItem(),
    ], { skipValidation: true })

    resetCandidateService()
    const service = getCandidateService()
    const result = await service.queryCandidates(
      createGap(),
      {
        targetTimeRange: { start: iso('09:30:00'), end: iso('10:15:00') },
        expectedDuration: { min: 2400, max: 3000 },
        channelId: 'dragon',
        columnId: '112',
        excludeUsed: true,
      },
    )

    expect(result.candidates[0]?.programCode).toBe('002601120002')
    expect((result.candidates[0] as { selectionMode?: string } | undefined)?.selectionMode).toBe('sequential')
  })

  it('电视频道顺播策略会参考历史播出记录推荐下一集', async () => {
    const service = getCandidateService()
    const result = await service.queryCandidates(
      createGap(),
      {
        targetTimeRange: { start: iso('09:30:00'), end: iso('10:15:00') },
        expectedDuration: { min: 2400, max: 3000 },
        channelId: 'dragon',
        columnId: '112',
        excludeUsed: true,
        historyReference: {
          dates: ['2026-03-24'],
          schedules: [
            {
              date: '2026-03-24',
              itemCount: 1,
              programTypes: { drama: 1 },
              items: [
                createScheduledItem({
                  programCode: '881120030004',
                  programName: '品质剧场：纵有疾风起 第4集',
                  startTime: '2026-03-24T09:30:00+08:00',
                  endTime: '2026-03-24T10:15:00+08:00',
                }),
              ],
            },
          ],
        },
      },
    )

    expect(result.candidates[0]?.programCode).toBe('881120030005')
    expect((result.candidates[0] as { selectionMode?: string } | undefined)?.selectionMode).toBe('sequential')
  })

  it('当前表同系列上下文会覆盖昨日历史进度并在诊断中说明', async () => {
    const atomicCapabilities = getAtomicCapabilities()
    await atomicCapabilities.replaceAllItems([
      createScheduledItem({
        id: 'current-episode-1',
        programCode: '002601120001',
        programName: '品质剧场：纵有疾风起 第1集',
        startTime: iso('09:00:00'),
        endTime: iso('09:45:00'),
      }),
      createScheduledItem({
        id: 'current-episode-3',
        programCode: '002601120003',
        programName: '品质剧场：纵有疾风起 第3集',
        startTime: iso('10:30:00'),
        endTime: iso('11:15:00'),
      }),
    ], { skipValidation: true })
    resetCandidateService()
    const service = getCandidateService()
    const result = await service.queryCandidates(
      createGap({
        startTime: iso('09:45:00'),
        endTime: iso('10:30:00'),
        duration: 2700,
      }),
      {
        targetTimeRange: { start: iso('09:45:00'), end: iso('10:30:00') },
        expectedDuration: { min: 2400, max: 3000 },
        channelId: 'dragon',
        columnId: '112',
        programTypePreference: ['drama'],
        searchKeywords: ['纵有疾风起'],
        excludeUsed: true,
        selectionPolicy: {
          primary: 'sequence',
          fallback: ['content_match', 'rating'],
          requiresPreviousSchedule: true,
        },
        historyReference: {
          dates: ['2026-03-24'],
          schedules: [
            {
              date: '2026-03-24',
              itemCount: 1,
              programTypes: { drama: 1 },
              items: [
                createScheduledItem({
                  programCode: '881120030004',
                  programName: '品质剧场：纵有疾风起 第4集',
                  startTime: '2026-03-24T09:30:00+08:00',
                  endTime: '2026-03-24T10:15:00+08:00',
                }),
              ],
            },
          ],
        },
      },
    )

    expect(result.candidates[0]?.programCode).toBe('002601120002')
    expect((result.candidates[0] as { expectedSequenceNo?: number } | undefined)?.expectedSequenceNo).toBe(2)
    expect(result.diagnostics?.notes).toContain('history_reference_loaded')
    expect(result.diagnostics?.notes).toContain('current_schedule_overrides_history')
  })

  it('顺播栏目回填早于既有剧集的空窗时不会倒序推荐后续集数', async () => {
    const atomicCapabilities = getAtomicCapabilities()
    await atomicCapabilities.replaceAllItems([
      createScheduledItem({
        startTime: iso('09:00:00'),
        endTime: iso('09:45:00'),
      }),
    ], { skipValidation: true })

    resetCandidateService()
    const service = getCandidateService()
    const result = await service.queryCandidates(
      createGap({
        startTime: iso('08:00:00'),
        endTime: iso('08:45:00'),
        duration: 2700,
      }),
      {
        targetTimeRange: { start: iso('08:00:00'), end: iso('08:45:00') },
        expectedDuration: { min: 2400, max: 3000 },
        channelId: 'dragon',
        columnId: '112',
        programTypePreference: ['drama'],
        searchKeywords: ['纵有疾风起'],
        excludeUsed: true,
      },
    )

    expect(result.candidates.some((candidate) => candidate.programCode === '002601120002')).toBe(false)
    expect(result.candidates).toHaveLength(0)
    expect(result.diagnostics?.rejectionReasons).toContain('sequence_context_order_conflict')
    expect(result.diagnostics?.notes).toContain('sequence_context_rejected_all_candidates')
  })

  it('电视顺播历史记录即使来自旧栏目编号也会按中文标题接续下一集', async () => {
    registerRuntimeSequentialDramaLayout()
    resetCandidateService()
    const service = getCandidateService()
    const result = await service.queryCandidates(
      createGap({
        startTime: iso('08:00:00'),
        endTime: iso('08:45:00'),
        duration: 2700,
      }),
      {
        targetTimeRange: { start: iso('08:00:00'), end: iso('08:45:00') },
        expectedDuration: { min: 2400, max: 3000 },
        channelId: 'dragon',
        columnId: 'runtime-column:dragon:2026-03-25:sequence-test',
        programTypePreference: ['drama'],
        searchKeywords: ['纵有疾风起'],
        excludeUsed: true,
        selectionPolicy: {
          primary: 'sequence',
          fallback: ['content_match', 'rating'],
          requiresPreviousSchedule: true,
        },
        historyReference: {
          dates: ['2026-03-24'],
          schedules: [
            {
              date: '2026-03-24',
              itemCount: 1,
              programTypes: { drama: 1 },
              items: [
                {
                  ...createScheduledItem({
                    programCode: 'legacy-code-not-in-library',
                    programName: '品质剧场：纵有疾风起 第4集',
                    startTime: '2026-03-24T09:30:00+08:00',
                    endTime: '2026-03-24T10:15:00+08:00',
                  }),
                  columnId: '112',
                } as ScheduleItemSnapshot,
              ],
            },
          ],
        },
      },
    )

    expect(result.candidates[0]?.programCode).toBe('881120030005')
    expect((result.candidates[0] as { expectedSequenceNo?: number } | undefined)?.expectedSequenceNo).toBe(5)
    expect(result.diagnostics?.notes).toContain('history_reference_loaded')
  })

  it('当前表内顺播上下文即使栏目编号不同也会阻止早段倒序回填', async () => {
    registerRuntimeSequentialDramaLayout()
    const atomicCapabilities = getAtomicCapabilities()
    await atomicCapabilities.replaceAllItems([
      {
        ...createScheduledItem({
          startTime: iso('09:00:00'),
          endTime: iso('09:45:00'),
        }),
        columnId: '112',
      } as ScheduleItemSnapshot,
    ], { skipValidation: true })

    resetCandidateService()
    const service = getCandidateService()
    const result = await service.queryCandidates(
      createGap({
        startTime: iso('08:00:00'),
        endTime: iso('08:45:00'),
        duration: 2700,
      }),
      {
        targetTimeRange: { start: iso('08:00:00'), end: iso('08:45:00') },
        expectedDuration: { min: 2400, max: 3000 },
        channelId: 'dragon',
        columnId: 'runtime-column:dragon:2026-03-25:sequence-test',
        programTypePreference: ['drama'],
        searchKeywords: ['纵有疾风起'],
        excludeUsed: true,
        selectionPolicy: {
          primary: 'sequence',
          fallback: ['content_match', 'rating'],
          requiresPreviousSchedule: true,
        },
      },
    )

    expect(result.candidates.some((candidate) => candidate.programCode === '002601120002')).toBe(false)
    expect(result.candidates).toHaveLength(0)
  })

  it('queryCandidates changes cached sequential recommendations when scheduled episode time changes', async () => {
    const atomicCapabilities = getAtomicCapabilities()
    await atomicCapabilities.replaceAllItems([
      createScheduledItem({
        startTime: iso('07:00:00'),
        endTime: iso('07:45:00'),
      }),
    ], { skipValidation: true })

    resetCandidateService()
    const service = getCandidateService()
    const gap = createGap({
      startTime: iso('08:00:00'),
      endTime: iso('08:45:00'),
      duration: 2700,
    })
    const criteria = {
      targetTimeRange: { start: iso('08:00:00'), end: iso('08:45:00') },
      expectedDuration: { min: 2400, max: 3000 },
      channelId: 'dragon',
      columnId: '112',
      programTypePreference: ['drama'],
      searchKeywords: ['纵有疾风起'],
      excludeUsed: true,
    }

    const firstResult = await service.queryCandidates(gap, criteria)
    expect(firstResult.candidates[0]?.programCode).toBe('002601120002')

    await atomicCapabilities.replaceAllItems([
      createScheduledItem({
        startTime: iso('09:00:00'),
        endTime: iso('09:45:00'),
      }),
    ], { skipValidation: true })

    const secondResult = await service.queryCandidates(gap, criteria)
    expect(secondResult.candidates.some((candidate) => candidate.programCode === '002601120002')).toBe(false)
    expect(secondResult.candidates).toHaveLength(0)
  })

  it('已排过的节目在 excludeUsed=true 时不会再次返回', async () => {
    const atomicCapabilities = getAtomicCapabilities()
    await atomicCapabilities.replaceAllItems([
      createScheduledItem({
        programCode: '002601050001',
        programName: '名医话养生·午后调养篇',
        startTime: iso('12:00:00'),
        endTime: iso('12:30:00'),
        duration: 1800,
        programType: 'health',
      }),
    ], { skipValidation: true })

    resetCandidateService()
    const service = getCandidateService()
    const result = await service.queryCandidates(
      createGap({
        startTime: iso('13:00:00'),
        endTime: iso('13:30:00'),
        duration: 1800,
      }),
      {
        targetTimeRange: { start: iso('13:00:00'), end: iso('13:30:00') },
        expectedDuration: { min: 1500, max: 2100 },
        channelId: 'dragon',
        columnId: '105',
        excludeUsed: true,
      },
    )

    expect(result.candidates.some((candidate) => candidate.programCode === '002601050001')).toBe(false)
  })

  it('非顺播栏目会标记为 rerun 选择模式', async () => {
    const service = getCandidateService()
    const result = await service.queryCandidates(
      createGap({
        startTime: iso('13:00:00'),
        endTime: iso('13:30:00'),
        duration: 1800,
      }),
      {
        targetTimeRange: { start: iso('13:00:00'), end: iso('13:30:00') },
        expectedDuration: { min: 1500, max: 2100 },
        channelId: 'dragon',
        columnId: '105',
        excludeUsed: false,
      },
    )

    expect(result.candidates.length).toBeGreaterThan(0)
    expect((result.candidates[0] as { selectionMode?: string } | undefined)?.selectionMode).toBe('rerun')
  })

  it('轮播单收视率优先策略会按预估收视排序候选', async () => {
    const service = getCandidateService()
    const result = await service.queryCandidates(
      createGap({
        startTime: iso('14:00:00'),
        endTime: iso('15:00:00'),
        duration: 3600,
      }),
      {
        targetTimeRange: { start: iso('14:00:00'), end: iso('15:00:00') },
        expectedDuration: { min: 1200, max: 3600 },
        channelId: 'dragon',
        columnId: '',
        programTypePreference: ['drama'],
        searchKeywords: ['电视剧'],
        excludeUsed: false,
        selectionPolicy: {
          primary: 'rating',
          fallback: ['content_match'],
        },
      },
    )

    const ratings = result.candidates.map((candidate) => (candidate as { estimatedRating?: number }).estimatedRating ?? 0)
    expect(ratings.length).toBeGreaterThan(1)
    expect(ratings).toEqual([...ratings].sort((left, right) => right - left))
    expect((result.candidates[0] as { selectionNote?: string } | undefined)?.selectionNote).toContain('收视率优先')
  })

  it('轮播单热播优先策略会按当前热度排序候选', async () => {
    const service = getCandidateService()
    ;(service as unknown as { candidates: ProgramCandidate[] }).candidates = [
      createCandidate({
        id: 'high-rating-low-trend',
        programId: 'P-DRAMA-1',
        programCode: 'DRAMA-001',
        programName: '经典剧场：平稳播出 第1集',
        instanceName: '经典剧场：平稳播出 第1集',
        programType: 'drama',
        duration: 1800,
        estimatedRating: 9.1,
        popularityScore: 54,
        contentTags: ['电视剧', '经典剧场'],
      }),
      createCandidate({
        id: 'lower-rating-hot-topic',
        programId: 'P-DRAMA-2',
        programCode: 'DRAMA-002',
        programName: '热播剧场：城市话题 第1集',
        instanceName: '热播剧场：城市话题 第1集',
        programType: 'drama',
        duration: 1800,
        estimatedRating: 7.2,
        popularityScore: 91,
        contentTags: ['电视剧', '热播', '话题'],
      }),
    ]

    const result = await service.queryCandidates(
      createGap({
        startTime: iso('14:00:00'),
        endTime: iso('15:00:00'),
        duration: 3600,
      }),
      {
        targetTimeRange: { start: iso('14:00:00'), end: iso('15:00:00') },
        expectedDuration: { min: 1200, max: 3600 },
        channelId: 'dragon',
        columnId: '',
        programTypePreference: ['drama'],
        searchKeywords: ['电视剧'],
        excludeUsed: false,
        selectionPolicy: {
          primary: 'trending',
          fallback: ['content_match'],
        },
      },
    )

    expect(result.candidates.map((candidate) => candidate.id)).toEqual([
      'lower-rating-hot-topic',
      'high-rating-low-trend',
    ])
    expect((result.candidates[0] as { selectionNote?: string } | undefined)?.selectionNote).toContain('热播优先')
  })

  it('轮播单内容匹配优先策略会在截断前优先保留内容更贴合的候选', async () => {
    const service = getCandidateService()
    ;(service as unknown as { candidates: ProgramCandidate[] }).candidates = [
      createCandidate({
        id: 'exact-duration-loose-content',
        programId: 'P-NEWS-1',
        programCode: 'NEWS-001',
        programName: 'Daily News',
        instanceName: 'Daily News',
        duration: 900,
      }),
      createCandidate({
        id: 'content-rich-shorter',
        programId: 'P-NEWS-2',
        programCode: 'NEWS-002',
        programName: 'City News News Special',
        instanceName: 'City News News Special',
        duration: 420,
      }),
    ]

    const result = await service.queryCandidates(
      createGap({
        startTime: iso('14:00:00'),
        endTime: iso('14:15:00'),
        duration: 900,
      }),
      {
        targetTimeRange: { start: iso('14:00:00'), end: iso('14:15:00') },
        expectedDuration: { min: 60, max: 900 },
        channelId: 'dragon',
        columnId: '',
        programTypePreference: ['news'],
        searchKeywords: ['news'],
        excludeUsed: false,
        selectionPolicy: {
          primary: 'content_match',
          fallback: ['rating'],
        },
      },
    )

    expect(result.candidates.map((candidate) => candidate.id)).toEqual([
      'content-rich-shorter',
      'exact-duration-loose-content',
    ])
    expect(result.diagnostics?.selectionPriority).toBe('content_match')
  })

  it('开放直播意图会从节目库命中地点和现场主题相符的资讯候选', async () => {
    const service = getCandidateService()
    const result = await service.queryCandidates(
      createGap({
        startTime: iso('14:00:00'),
        endTime: iso('15:00:00'),
        duration: 3600,
      }),
      {
        targetTimeRange: { start: iso('14:00:00'), end: iso('15:00:00') },
        expectedDuration: { min: 900, max: 3600 },
        channelId: 'dragon',
        columnId: '',
        programTypePreference: ['news_magazine', 'news'],
        searchKeywords: ['静安寺', '外场直播', '直播'],
        excludeUsed: false,
        selectionPolicy: {
          primary: 'content_match',
          fallback: ['rating'],
        },
      },
    )

    expect(result.candidates.length).toBeGreaterThan(0)
    expect(result.candidates[0]?.programName).toContain('静安寺')
    expect(result.candidates.every((candidate) => candidate.programType !== 'drama')).toBe(true)
    expect(result.diagnostics?.rejectionReasons).not.toContain('hard_keyword_no_match')
  })

  it('内容匹配会把所属栏目作为可检索条件', async () => {
    const service = getCandidateService()
    const result = await service.queryCandidates(
      createGap({
        startTime: iso('14:00:00'),
        endTime: iso('14:30:00'),
        duration: 1800,
      }),
      {
        targetTimeRange: { start: iso('14:00:00'), end: iso('14:30:00') },
        expectedDuration: { min: 900, max: 1800 },
        channelId: 'dragon',
        columnId: '',
        programTypePreference: ['news_magazine'],
        searchKeywords: ['所属栏目看东方'],
        excludeUsed: false,
        selectionPolicy: {
          primary: 'content_match',
          fallback: ['rating'],
        },
      },
    )

    expect(result.candidates.length).toBeGreaterThan(0)
    expect(result.candidates.every((candidate) => candidate.columnName === '看东方')).toBe(true)
    expect(result.candidates[0]?.contentTags).toContain('看东方')
    expect(result.diagnostics?.keywordMatchedCount).toBeGreaterThan(0)
  })

  it('电视草案检索约束会区分栏目、节目和裸名称', async () => {
    const service = getCandidateService()
    const gap = createGap({
      startTime: iso('09:00:00'),
      endTime: iso('10:00:00'),
      duration: 3600,
    })
    const baseCriteria = {
      targetTimeRange: { start: iso('09:00:00'), end: iso('10:00:00') },
      expectedDuration: { min: 1800, max: 3600 },
      channelId: 'dragon',
      columnId: '',
      programTypePreference: ['news_magazine', 'news'],
      excludeUsed: false,
      selectionPolicy: {
        primary: 'content_match' as const,
        fallback: ['rating' as const],
      },
    }

    const columnResult = await service.queryCandidates(gap, {
      ...baseCriteria,
      searchKeywords: ['栏目=看东方'],
    })
    const programResult = await service.queryCandidates(gap, {
      ...baseCriteria,
      searchKeywords: ['节目=看东方111期新春特别行动'],
    })
    const bareResult = await service.queryCandidates(gap, {
      ...baseCriteria,
      searchKeywords: ['看东方111期新春特别行动'],
    })

    expect(columnResult.candidates.length).toBeGreaterThan(0)
    expect(columnResult.candidates.every((candidate) => candidate.columnName === '看东方')).toBe(true)
    expect(programResult.candidates.map((candidate) => candidate.programName)).toContain('看东方111期新春特别行动')
    expect(bareResult.candidates.map((candidate) => candidate.programName)).toContain('看东方111期新春特别行动')
  })

  it('正式编排内容目标会在不依赖当前版面栏目时命中目标栏目', async () => {
    const service = getCandidateService()
    const gap = createGap({
      startTime: iso('09:30:00'),
      endTime: iso('12:00:00'),
      duration: 9000,
    })

    const result = await service.queryCandidates(gap, {
      targetTimeRange: { start: iso('09:30:00'), end: iso('12:00:00') },
      expectedDuration: { min: 60, max: 9000 },
      channelId: 'dragon',
      columnId: '',
      programTypePreference: ['drama'],
      searchKeywords: ['栏目=东方剧场'],
      excludeUsed: false,
    })

    expect(result.candidates.length).toBeGreaterThan(0)
    expect(result.candidates.every((candidate) => candidate.columnName === '东方剧场')).toBe(true)
    expect(result.diagnostics?.keywordMatchedCount).toBeGreaterThan(0)
  })

  it('功能型意图会用导视、预热、集锦等软约束筛选候选', async () => {
    const service = getCandidateService()
    const result = await service.queryCandidates(
      createGap({
        startTime: iso('14:00:00'),
        endTime: iso('14:30:00'),
        duration: 1800,
      }),
      {
        targetTimeRange: { start: iso('14:00:00'), end: iso('14:30:00') },
        expectedDuration: { min: 300, max: 1800 },
        channelId: 'dragon',
        columnId: '',
        programTypePreference: ['news_magazine', 'news'],
        searchKeywords: ['现场导视'],
        excludeUsed: false,
        selectionPolicy: {
          primary: 'content_match',
          fallback: ['rating'],
        },
      },
    )

    expect(result.candidates.length).toBeGreaterThan(0)
    expect(result.candidates[0]?.programName).toContain('导视')
    expect(result.candidates.every((candidate) => candidate.programName.includes('导视'))).toBe(true)
    expect(result.diagnostics?.functionalKeywordRequired).toBe(true)
    expect(result.diagnostics?.notes).toContain('functional_keyword_required')
  })

  it('发布会预热会优先命中同时符合场景和功能的候选', async () => {
    const service = getCandidateService()
    const result = await service.queryCandidates(
      createGap({
        startTime: iso('14:00:00'),
        endTime: iso('14:30:00'),
        duration: 1800,
      }),
      {
        targetTimeRange: { start: iso('14:00:00'), end: iso('14:30:00') },
        expectedDuration: { min: 300, max: 1800 },
        channelId: 'dragon',
        columnId: '',
        programTypePreference: ['news_magazine', 'news'],
        searchKeywords: ['发布会预热'],
        excludeUsed: false,
        selectionPolicy: {
          primary: 'content_match',
          fallback: ['rating'],
        },
      },
    )

    expect(result.candidates.length).toBeGreaterThan(0)
    expect(result.candidates[0]?.programName).toContain('发布会')
    expect(result.candidates[0]?.programName).toContain('预热')
  })

  it('组合意图会同时要求主题关键词和功能关键词命中', async () => {
    const service = getCandidateService()
    ;(service as unknown as { candidates: ProgramCandidate[] }).candidates = [
      createCandidate({
        id: 'topic-only',
        programCode: 'EVENT-TOPIC-ONLY',
        programName: '城市论坛发布会精编 第1期',
        instanceName: '城市论坛发布会精编 第1期',
        duration: 900,
        programType: 'news_magazine',
        contentTags: ['发布会'],
      }),
      createCandidate({
        id: 'function-only',
        programCode: 'EVENT-FUNCTION-ONLY',
        programName: '城市活动预热导视 第1期',
        instanceName: '城市活动预热导视 第1期',
        duration: 900,
        programType: 'news_magazine',
        contentTags: ['预热', '导视'],
      }),
      createCandidate({
        id: 'topic-and-function',
        programCode: 'EVENT-TOPIC-FUNCTION',
        programName: '发布会预热导视 第1期',
        instanceName: '发布会预热导视 第1期',
        duration: 900,
        programType: 'news_magazine',
        contentTags: ['发布会', '预热', '导视'],
      }),
    ]

    const result = await service.queryCandidates(
      createGap({
        startTime: iso('14:00:00'),
        endTime: iso('14:30:00'),
        duration: 1800,
      }),
      {
        targetTimeRange: { start: iso('14:00:00'), end: iso('14:30:00') },
        expectedDuration: { min: 300, max: 1800 },
        channelId: 'dragon',
        columnId: '',
        programTypePreference: ['news_magazine', 'news'],
        searchKeywords: ['发布会现场导视'],
        excludeUsed: false,
        selectionPolicy: {
          primary: 'content_match',
          fallback: ['rating'],
        },
      },
    )

    expect(result.candidates.map((candidate) => candidate.id)).toEqual(['topic-and-function'])
    expect(result.diagnostics?.hardKeywordRequired).toBe(true)
    expect(result.diagnostics?.functionalKeywordRequired).toBe(true)
    expect(result.diagnostics?.notes).toEqual(
      expect.arrayContaining(['hard_keyword_required', 'functional_keyword_required']),
    )
  })

  it('带栏目和内容前缀的组合意图必须逐项命中', async () => {
    const service = getCandidateService()
    ;(service as unknown as { candidates: ProgramCandidate[] }).candidates = [
      createCandidate({
        id: 'content-only',
        programCode: 'JINGAN-ONLY',
        programName: '静安寺外场直播 第1期',
        instanceName: '静安寺外场直播 第1期',
        duration: 900,
        programType: 'news_magazine',
        columnName: 'ShanghaiEye',
        columnId: '104',
        contentTags: ['静安寺', '外场直播'],
      }),
      createCandidate({
        id: 'column-only',
        programCode: 'KANDF-ONLY',
        programName: '看东方·城市更新 第1期',
        instanceName: '看东方·城市更新 第1期',
        duration: 900,
        programType: 'news_magazine',
        columnName: '看东方',
        columnId: '101',
        contentTags: ['看东方', '城市更新'],
      }),
      createCandidate({
        id: 'column-and-content',
        programCode: 'KANDF-JINGAN',
        programName: '看东方：静安寺外场直播 第1期',
        instanceName: '看东方：静安寺外场直播 第1期',
        duration: 900,
        programType: 'news_magazine',
        columnName: '看东方',
        columnId: '101',
        contentTags: ['看东方', '静安寺', '外场直播'],
      }),
    ]

    const result = await service.queryCandidates(
      createGap({
        startTime: iso('14:00:00'),
        endTime: iso('14:30:00'),
        duration: 1800,
      }),
      {
        targetTimeRange: { start: iso('14:00:00'), end: iso('14:30:00') },
        expectedDuration: { min: 300, max: 1800 },
        channelId: 'dragon',
        columnId: '',
        programTypePreference: ['news_magazine', 'news'],
        searchKeywords: ['所属栏目看东方', '节目内容静安寺'],
        excludeUsed: false,
        selectionPolicy: {
          primary: 'content_match',
          fallback: ['rating'],
        },
      },
    )

    expect(result.candidates.map((candidate) => candidate.id)).toEqual(['column-and-content'])
    expect(result.diagnostics?.hardKeywordRequired).toBe(true)
    expect(result.diagnostics?.notes).toContain('hard_keyword_required')
  })

  it('searchPrograms 也会按栏目和内容前缀过滤插入推荐候选', async () => {
    const service = getCandidateService()
    ;(service as unknown as { candidates: ProgramCandidate[] }).candidates = [
      createCandidate({
        id: 'content-only',
        programCode: 'JINGAN-ONLY',
        programName: '静安寺外场直播 第1期',
        instanceName: '静安寺外场直播 第1期',
        duration: 900,
        programType: 'news_magazine',
        columnName: 'ShanghaiEye',
        columnId: '104',
        contentTags: ['静安寺', '外场直播'],
      }),
      createCandidate({
        id: 'column-and-content',
        programCode: 'KANDF-JINGAN',
        programName: '看东方：静安寺外场直播 第1期',
        instanceName: '看东方：静安寺外场直播 第1期',
        duration: 900,
        programType: 'news_magazine',
        columnName: '看东方',
        columnId: '101',
        contentTags: ['看东方', '静安寺', '外场直播'],
      }),
    ]

    const result = await service.searchPrograms({
      channelId: 'dragon',
      programName: '所属栏目看东方 节目内容静安寺',
      programTypes: ['news_magazine'],
      columnStrategy: 'prefer_channel',
      limit: 6,
    })

    expect(result.map((candidate) => candidate.id)).toEqual(['column-and-content'])
  })

  it('searchPrograms 按栏目名、期号和主题命中周播节目，编号只作为核验字段', async () => {
    resetCandidateService()
    const service = getCandidateService()

    const result = await service.searchPrograms({
      channelId: 'dragon',
      columnId: '101',
      programName: '看东方111期新春特别行动',
      programTypes: ['news_magazine'],
      limit: 5,
    })

    expect(result[0]).toMatchObject({
      programName: '看东方111期新春特别行动',
      issueNo: '0111',
      programCode: '002601010111',
    })
    expect(result.filter((candidate) => candidate.programName === '看东方111期新春特别行动')).toHaveLength(1)
  })

  it('轮播单策略不会用昨日历史记录排除候选节目', async () => {
    const service = getCandidateService()
    const baseCriteria = {
      targetTimeRange: { start: iso('14:00:00'), end: iso('15:00:00') },
      expectedDuration: { min: 1200, max: 3600 },
      channelId: 'dragon',
      columnId: '',
      programTypePreference: ['drama'],
      searchKeywords: ['电视剧'],
      excludeUsed: true,
      selectionPolicy: {
        primary: 'rating' as const,
        fallback: ['content_match' as const],
      },
    }

    const baseline = await service.queryCandidates(
      createGap({
        startTime: iso('14:00:00'),
        endTime: iso('15:00:00'),
        duration: 3600,
      }),
      baseCriteria,
    )
    const topCandidate = baseline.candidates[0]
    expect(topCandidate).toBeTruthy()

    const withHistory = await service.queryCandidates(
      createGap({
        id: 'gap-carousel-history',
        startTime: iso('14:00:00'),
        endTime: iso('15:00:00'),
        duration: 3600,
      }),
      {
        ...baseCriteria,
        historyReference: {
          dates: ['2026-03-24'],
          schedules: [
            {
              date: '2026-03-24',
              itemCount: 1,
              programTypes: { drama: 1 },
              items: [
                createScheduledItem({
                  programCode: topCandidate!.programCode,
                  programName: topCandidate!.programName,
                  startTime: '2026-03-24T14:00:00+08:00',
                  endTime: '2026-03-24T15:00:00+08:00',
                }),
              ],
            },
          ],
        },
      },
    )

    expect(withHistory.candidates[0]?.programCode).toBe(topCandidate?.programCode)
    expect(withHistory.diagnostics?.notes).toContain('selection_priority:rating')
  })

  it('栏目候选不会超过当前空窗结束边界', async () => {
    const service = getCandidateService()
    const result = await service.queryCandidates(
      createGap({
        startTime: iso('14:30:00'),
        endTime: iso('15:00:00'),
        duration: 1800,
      }),
      {
        targetTimeRange: { start: iso('14:30:00'), end: iso('15:00:00') },
        expectedDuration: { min: 60, max: 1800 },
        channelId: 'dragon',
        columnId: '101',
        programTypePreference: ['news_magazine', 'news'],
        searchKeywords: ['看东方'],
        excludeUsed: false,
      },
    )

    expect(result.candidates.length).toBeGreaterThan(0)
    expect(result.candidates.every((candidate) => candidate.duration <= 1800)).toBe(true)
  })

  it('searchPrograms 会过滤已排节目并保留名称匹配结果', async () => {
    const atomicCapabilities = getAtomicCapabilities()
    await atomicCapabilities.replaceAllItems([
      createScheduledItem({
        programCode: '002601010111',
        programName: '看东方111期新春特别行动',
        startTime: iso('07:00:00'),
        endTime: iso('08:00:00'),
        duration: 3600,
        programType: 'news_magazine',
      }),
    ], { skipValidation: true })

    resetCandidateService()
    const service = getCandidateService()
    const result = await service.searchPrograms({
      channelId: 'dragon',
      columnId: '101',
      programName: '看东方',
    })

    expect(result.every((candidate) => candidate.programName.includes('看东方'))).toBe(true)
    expect(result.some((candidate) => candidate.programCode === '002601010111')).toBe(false)
  })

  it('searchPrograms 对明确节目标题无命中时不会退化为类型候选', async () => {
    const service = getCandidateService()

    const result = await service.searchPrograms({
      channelId: 'dragon',
      columnStrategy: 'prefer_channel',
      programName: '生命树电视剧',
      limit: 5,
    })

    expect(result).toHaveLength(0)
  })

  it('queryCandidates 对所属栏目和节目内容要求做字段级硬匹配', async () => {
    const service = getCandidateService()
    const result = await service.queryCandidates(
      createGap({
        startTime: iso('14:00:00'),
        endTime: iso('15:00:00'),
        duration: 3600,
      }),
      {
        targetTimeRange: { start: iso('14:00:00'), end: iso('15:00:00') },
        expectedDuration: { min: 900, max: 3600 },
        channelId: 'dragon',
        columnId: '',
        programTypePreference: ['news_magazine'],
        searchKeywords: ['所属栏目看东方', '节目内容静安寺'],
        excludeUsed: false,
        selectionPolicy: {
          primary: 'content_match',
          fallback: ['rating'],
        },
      },
    )

    expect(result.candidates.length).toBeGreaterThan(0)
    expect(result.diagnostics?.hardKeywordRequired).toBe(true)
    expect(result.candidates.every((candidate) => candidate.columnName === '看东方')).toBe(true)
    expect(result.candidates.every((candidate) => candidate.contentTags?.includes('静安寺'))).toBe(true)
  })

  it('原子操作检索在栏目未命中时会回退到当前频道候选', async () => {
    const service = getCandidateService()

    const strictResult = await service.searchPrograms({
      channelId: 'dragon',
      columnId: '107',
      programName: '看东方',
      limit: 5,
    })

    const fallbackResult = await service.searchPrograms({
      channelId: 'dragon',
      columnId: '107',
      columnStrategy: 'prefer_channel',
      programName: '看东方',
      limit: 5,
    })

    expect(strictResult).toHaveLength(0)
    expect(fallbackResult.length).toBeGreaterThan(0)
    expect(fallbackResult.every((candidate) => candidate.programName.includes('看东方'))).toBe(true)
  })

  it('queryCandidates attaches editorial decision evidence for strategy-aware selection', async () => {
    const service = getCandidateService()
    const result = await service.queryCandidates(
      createGap({
        startTime: iso('14:00:00'),
        endTime: iso('15:00:00'),
        duration: 3600,
      }),
      {
        targetTimeRange: { start: iso('14:00:00'), end: iso('15:00:00') },
        expectedDuration: { min: 1200, max: 3600 },
        channelId: 'dragon',
        columnId: '',
        programTypePreference: ['drama'],
        searchKeywords: ['电视剧'],
        excludeUsed: false,
        selectionPolicy: {
          primary: 'rating',
          fallback: ['content_match'],
        },
      },
    )

    const decision = result.candidates[0]?.editorialDecision
    expect(decision?.strategy).toBe('rating')
    expect(decision?.totalScore).toBeGreaterThan(0)
    expect(decision?.dimensions.map((item) => item.key)).toEqual(
      expect.arrayContaining(['content_match', 'duration_fit', 'rating', 'type_fit', 'schedule_context']),
    )
    expect((result.candidates[0] as { selectionNote?: string } | undefined)?.selectionNote).toBe(decision?.summary)
  })

  it.each([
    ['健康节目', 'health'],
    ['一档纪录片', 'documentary'],
    ['现场导视', 'news_magazine'],
  ])('searchPrograms 支持用类别口语检索替换候选: %s', async (programName, expectedType) => {
    const service = getCandidateService()

    const result = await service.searchPrograms({
      channelId: 'dragon',
      columnStrategy: 'prefer_channel',
      programName,
      limit: 5,
    })

    expect(result.length).toBeGreaterThan(0)
    expect(result.some((candidate) => candidate.programType === expectedType)).toBe(true)
  })
})
