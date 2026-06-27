import { describe, expect, it } from 'vitest'
import { detectMovingItemSequenceViolation } from '../scheduleSequenceGuard'
import type { ScheduleItemSnapshot } from '@/types/orchestration'

const date = '2026-03-25'
const iso = (time: string) => `${date}T${time}+08:00`

const createItem = (overrides: Partial<ScheduleItemSnapshot>): ScheduleItemSnapshot => ({
  id: 'item',
  programCode: '881120030001',
  programName: '品质剧场：纵有疾风起 第1集',
  startTime: iso('09:00:00'),
  endTime: iso('09:45:00'),
  duration: 2700,
  programType: 'drama',
  sequence: 1,
  ...overrides,
})

describe('scheduleSequenceGuard', () => {
  it('blocks a real Chinese episode from being backfilled before an earlier episode', () => {
    const violation = detectMovingItemSequenceViolation(
      createItem({
        id: 'candidate-episode-2',
        programCode: '881120030002',
        programName: '品质剧场：纵有疾风起 第2集',
        startTime: iso('08:00:00'),
        endTime: iso('08:45:00'),
      }),
      [
        createItem({
          id: 'existing-episode-1',
          programCode: '881120030001',
          programName: '品质剧场：纵有疾风起 第1集',
          startTime: iso('09:00:00'),
          endTime: iso('09:45:00'),
        }),
      ],
      '草案预检',
    )

    expect(violation?.type).toBe('reverse_order')
    expect(violation?.message).toContain('顺播倒序')
    expect(violation?.message).toContain('08:00:00')
    expect(violation?.message).toContain('09:00:00')
  })

  it('uses program code series as a fallback when titles are not comparable', () => {
    const violation = detectMovingItemSequenceViolation(
      createItem({
        id: 'candidate-code-2',
        programCode: '881120030002',
        programName: '第二集',
        startTime: iso('08:00:00'),
        endTime: iso('08:45:00'),
      }),
      [
        createItem({
          id: 'existing-code-1',
          programCode: '881120030001',
          programName: '第一集',
          startTime: iso('09:00:00'),
          endTime: iso('09:45:00'),
        }),
      ],
    )

    expect(violation?.type).toBe('reverse_order')
  })
})
