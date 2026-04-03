import { describe, expect, it } from 'vitest'

import {
  buildOrchestrationScheduleState,
  shouldStartPartialGeneration,
} from '../broadcastPlanOrchestrationHelpers'

describe('broadcastPlanOrchestrationHelpers', () => {
  it('会构建编排任务分类需要的节目单状态', () => {
    expect(buildOrchestrationScheduleState({
      channelId: 'dragon',
      channelName: '东方卫视',
      date: '2026-04-03',
      itemCount: 12,
      gapCount: 2,
    })).toEqual({
      channelId: 'dragon',
      channelName: '东方卫视',
      date: '2026-04-03',
      isEmpty: false,
      itemCount: 12,
      gapCount: 2,
      hasSelectedTimeRange: false,
    })
  })

  it('只在已有节目且模式为 partial_generate 时启动局部补排', () => {
    expect(shouldStartPartialGeneration('partial_generate', 3)).toBe(true)
    expect(shouldStartPartialGeneration('partial_generate', 0)).toBe(false)
    expect(shouldStartPartialGeneration('full_generate', 3)).toBe(false)
  })
})
