import { describe, expect, it, vi } from 'vitest'

import { TaskClassifier } from '@/services/llm/taskClassifier'
import type { ScheduleState } from '@/types/orchestration'

const createScheduleState = (overrides: Partial<ScheduleState> = {}): ScheduleState => ({
  channelId: 'dragon',
  channelName: '东方卫视',
  date: '2026-03-25',
  isEmpty: false,
  itemCount: 10,
  gapCount: 1,
  hasSelectedTimeRange: false,
  ...overrides,
})

describe('TaskClassifier shell', () => {
  it('does not classify natural language now that the foreground agent uses LLM-only understanding', async () => {
    const chat = vi.fn()
    const classifier = new TaskClassifier({ chat } as never)

    const result = await classifier.classify({
      scheduleState: createScheduleState(),
      userInput: '请补齐当前所有空窗',
    })

    expect(chat).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      mode: 'clarify',
      confidence: 0,
    })
    expect(result.reasoning).toContain('LLM-only')
  })

  it('keeps only coarse local risk hints for confirmation gates', () => {
    const classifier = new TaskClassifier({ chat: vi.fn() } as never)

    expect(classifier.assessRisk({
      scheduleState: createScheduleState(),
      userInput: '删除全部看东方节目',
    })).toMatchObject({
      level: 'high',
      factors: expect.arrayContaining(['涉及较大范围的批量操作', '包含高影响操作']),
    })
  })
})
