import { beforeEach, describe, expect, it } from 'vitest'

import { getAtomicCapabilities, resetAtomicCapabilities } from '@/services/atomicCapabilities'
import { getCandidateService, resetCandidateService } from '@/services/candidateService'
import type { GapInfo, ScheduleItemSnapshot } from '@/types/orchestration'

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

describe('CandidateService', () => {
  beforeEach(async () => {
    resetCandidateService()
    resetAtomicCapabilities()
    await getAtomicCapabilities().clearAll()
  })

  it('顺播栏目优先推荐下一集/期', async () => {
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

  it('searchPrograms 会过滤掉已排节目并保留名称匹配结果', async () => {
    const atomicCapabilities = getAtomicCapabilities()
    await atomicCapabilities.replaceAllItems([
      createScheduledItem({
        programCode: '002601010001',
        programName: '看东方 早高峰版',
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
    expect(result.some((candidate) => candidate.programCode === '002601010001')).toBe(false)
  })
})
