import { beforeEach, describe, expect, it } from 'vitest'

import { getAtomicCapabilities, resetAtomicCapabilities } from '@/services/atomicCapabilities'
import { resetCandidateService } from '@/services/candidateService'
import { ReplaceCommandExecutor } from '@/services/replaceCommandExecutor'
import type { ReplaceCommand, ScheduleItemSnapshot } from '@/types/orchestration'

const baseDate = '2026-03-25'
const iso = (time: string) => `${baseDate}T${time}+08:00`

const createItem = (overrides: Partial<ScheduleItemSnapshot> = {}): ScheduleItemSnapshot => ({
  id: 'item-0800',
  programCode: 'PLACEHOLDER-0800',
  programName: '上午占位节目',
  startTime: iso('08:00:00'),
  endTime: iso('08:45:00'),
  duration: 2700,
  programType: 'news_magazine',
  sequence: 1,
  ...overrides,
})

const createReplaceCommand = (overrides: Partial<ReplaceCommand['data']> = {}): ReplaceCommand => ({
  action: 'replace',
  reasoning: 'test replace',
  data: {
    itemId: 'item-0800',
    newCandidateId: 'I112001-0002',
    ...overrides,
  },
})

describe('ReplaceCommandExecutor sequence context guard', () => {
  beforeEach(async () => {
    resetCandidateService()
    resetAtomicCapabilities()
    await getAtomicCapabilities().clearAll()
  })

  it('preview blocks replacing an earlier slot with a later episode before an existing earlier episode', async () => {
    await getAtomicCapabilities().appendItems([
      createItem(),
      createItem({
        id: 'existing-0900-episode-1',
        programCode: '002601120001',
        programName: '品质剧场：纵有疾风起 第1集',
        startTime: iso('09:00:00'),
        endTime: iso('09:45:00'),
        programType: 'drama',
        sequence: 2,
      }),
    ], { skipValidation: true })
    const executor = new ReplaceCommandExecutor()

    const preview = executor.preview(createReplaceCommand())

    expect(preview.canExecute).toBe(false)
    expect(preview.warnings.some((warning) => warning.includes('顺播倒序'))).toBe(true)
  })

  it('execute blocks replacing an earlier slot with a later episode before an existing earlier episode', async () => {
    await getAtomicCapabilities().appendItems([
      createItem(),
      createItem({
        id: 'existing-0900-episode-1',
        programCode: '002601120001',
        programName: '品质剧场：纵有疾风起 第1集',
        startTime: iso('09:00:00'),
        endTime: iso('09:45:00'),
        programType: 'drama',
        sequence: 2,
      }),
    ], { skipValidation: true })
    const executor = new ReplaceCommandExecutor()

    const result = await executor.execute(createReplaceCommand(), {
      scheduleDate: baseDate,
      channelId: 'dragon',
    })

    expect(result.success).toBe(false)
    expect(result.message).toContain('顺播倒序')
    expect(getAtomicCapabilities().getItem('item-0800')?.programName).toBe('上午占位节目')
  })

  it('execute blocks title-based reverse order even when program codes do not share a prefix', async () => {
    await getAtomicCapabilities().appendItems([
      createItem(),
      createItem({
        id: 'existing-0900-episode-1',
        programCode: 'LEGACY-DRAMA-A',
        programName: '品质剧场：纵有疾风起 第1集',
        startTime: iso('09:00:00'),
        endTime: iso('09:45:00'),
        programType: 'drama',
        sequence: 2,
      }),
    ], { skipValidation: true })
    const executor = new ReplaceCommandExecutor()

    const result = await executor.execute(createReplaceCommand({
      newCandidateId: 'I112001-0002',
    }), {
      scheduleDate: baseDate,
      channelId: 'dragon',
    })

    expect(result.success).toBe(false)
    expect(result.message).toContain('顺播倒序')
    expect(getAtomicCapabilities().getItem('item-0800')?.programName).toBe('上午占位节目')
  })

  it('allows replacing the next later slot with the expected next episode', async () => {
    await getAtomicCapabilities().appendItems([
      createItem({
        id: 'existing-0900-episode-1',
        programCode: '002601120001',
        programName: '品质剧场：纵有疾风起 第1集',
        startTime: iso('09:00:00'),
        endTime: iso('09:45:00'),
        programType: 'drama',
      }),
      createItem({
        id: 'item-1000',
        startTime: iso('10:00:00'),
        endTime: iso('10:45:00'),
      }),
    ], { skipValidation: true })
    const executor = new ReplaceCommandExecutor()

    const result = await executor.execute(createReplaceCommand({
      itemId: 'item-1000',
      newCandidateId: 'I112001-0002',
    }), {
      scheduleDate: baseDate,
      channelId: 'dragon',
    })

    expect(result.success).toBe(true)
    expect(getAtomicCapabilities().getItem('item-1000')?.programName).toContain('纵有疾风起 第2集')
  })
})
