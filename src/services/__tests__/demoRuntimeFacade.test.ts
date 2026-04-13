import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockedLateNightItem = {
  id: 'item-2230',
  programCode: 'P109001',
  programName: '锵点·当日观察',
  startTime: '22:30:00',
  endTime: '23:00:00',
  duration: 1800,
  programType: 'commentary',
}

vi.mock('@/services/llm/llmClient', () => ({
  getLLMClient: () => ({}),
}))

vi.mock('@/services/llm/taskClassifier', () => ({
  getTaskClassifier: () => ({
    classify: vi.fn(async () => ({
      mode: 'micro_edit',
      confidence: 1,
      reasoning: 'mock classification',
    })),
  }),
}))

vi.mock('@/services/intentRecognizer', () => ({
  getIntentRecognizer: () => ({
    recognize: vi.fn(async () => ({
      type: 'move',
      reasoning: 'mock move intent',
    })),
  }),
}))

vi.mock('@/services/paramExtractor', () => ({
  getParamExtractor: () => ({
    extractMoveParams: vi.fn(async () => ({
      targetTime: '22:30:00',
      direction: 'forward',
      offsetSeconds: 5 * 3600,
    })),
    extractInsertParams: vi.fn(async () => null),
    extractDeleteParams: vi.fn(async () => null),
    extractReplaceParams: vi.fn(async () => null),
  }),
}))

vi.mock('@/services/scheduleTargetResolver', () => ({
  getScheduleTargetResolver: () => ({
    resolve: vi.fn(async () => ({
      status: 'unique',
      selectedItem: { ...mockedLateNightItem },
      reasoning: 'mock resolution',
      matchedBy: ['time_window'],
      candidates: [{ ...mockedLateNightItem }],
    })),
  }),
}))

import {
  DemoRuntimeFacade,
  type RuntimePendingTargetSelection,
  type RuntimeScheduleItem,
} from '@/services/runtime/demoRuntimeFacade'
import type { ScheduleState } from '@/types/orchestration'

const createScheduleState = (): ScheduleState => ({
  channelId: 'dragon',
  channelName: '东方卫视',
  date: '2026-03-25',
  isEmpty: false,
  itemCount: 1,
  gapCount: 0,
  hasSelectedTimeRange: false,
})

const createLateNightItem = (): RuntimeScheduleItem => ({
  ...mockedLateNightItem,
})

describe('DemoRuntimeFacade', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('直接拒绝移动后超出编单范围的指令', async () => {
    const facade = new DemoRuntimeFacade()

    const result = await facade.submitInstruction({
      scheduleState: createScheduleState(),
      userInput: '把22点半的节目后移5小时',
      currentSchedule: [createLateNightItem()],
      history: [],
    })

    expect(result.kind).toBe('message')
    if (result.kind !== 'message') {
      throw new Error('expected message decision')
    }

    expect(result.feedback.content).toContain('超出编单时间范围')
    expect(result.feedback.content).toContain('已拒绝执行')
  })

  it('候选目标确认后仍会拒绝超出编单范围的移动', async () => {
    const facade = new DemoRuntimeFacade()
    const lateNightItem = createLateNightItem()
    const pendingTargetSelection: RuntimePendingTargetSelection = {
      action: 'move',
      summary: '请选择 22:30:00 要移动的节目',
      reasoning: '待确认目标节目。',
      targetTime: '22:30:00',
      candidates: [lateNightItem],
      selectedItemId: lateNightItem.id,
      moveConfig: {
        direction: 'forward',
        offsetSeconds: 5 * 3600,
      },
    }

    const result = await facade.resolvePendingTargetSelection({
      channelId: 'dragon',
      date: '2026-03-25',
      pendingTargetSelection,
    })

    expect(result.kind).toBe('message')
    if (result.kind !== 'message') {
      throw new Error('expected message decision')
    }

    expect(result.feedback.content).toContain('超出编单时间范围')
    expect(result.feedback.content).toContain('已拒绝执行')
  })
})
