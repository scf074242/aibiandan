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

describe('TaskClassifier', () => {
  it('对明确补空窗短语走规则快速判定', async () => {
    const chat = vi.fn(async () => ({
      content: JSON.stringify({
        mode: 'clarify',
        confidence: 0.4,
        reasoning: '不应该被调用',
      }),
    }))
    const classifier = new TaskClassifier({ chat } as never)

    const result = await classifier.classify({
      scheduleState: createScheduleState(),
      userInput: '请补齐当前所有空窗',
    })

    expect(result.mode).toBe('partial_generate')
    expect(chat).not.toHaveBeenCalled()
  })

  it('对真实中文版面生成指令识别为 layout_prepare，并忽略当前版面参考', async () => {
    const chat = vi.fn()
    const classifier = new TaskClassifier({ chat } as never)

    const result = await classifier.classify({
      scheduleState: createScheduleState(),
      userInput: '不参考当前版面参考，下午编入下午剧场节目',
    })

    expect(result.mode).toBe('layout_prepare')
    expect(result.suggestedParams?.ignoreExistingLayout).toBe(true)
    expect(result.suggestedParams?.targetTimeRange).toEqual({
      start: '13:00:00',
      end: '18:00:00',
    })
    expect(chat).not.toHaveBeenCalled()
  })

  it('对真实中文版面微调指令识别为 layout_refine', async () => {
    const chat = vi.fn()
    const classifier = new TaskClassifier({ chat } as never)

    const result = await classifier.classify({
      scheduleState: createScheduleState(),
      userInput: '晚上全部替换成新闻栏目',
    })

    expect(result.mode).toBe('layout_refine')
    expect(result.suggestedParams?.targetTimeRange).toEqual({
      start: '18:00:00',
      end: '23:00:00',
    })
    expect(chat).not.toHaveBeenCalled()
  })

  it('对自由业务短语也按版面生成需求处理', async () => {
    const chat = vi.fn()
    const classifier = new TaskClassifier({ chat } as never)

    const result = await classifier.classify({
      scheduleState: createScheduleState(),
      userInput: '下午排入城市剧场节目',
    })

    expect(result.mode).toBe('layout_prepare')
    expect(result.suggestedParams?.targetTimeRange).toEqual({
      start: '13:00:00',
      end: '18:00:00',
    })
    expect(chat).not.toHaveBeenCalled()
  })

  it('对明显版面需求识别为 layout_prepare', async () => {
    const chat = vi.fn()
    const classifier = new TaskClassifier({ chat } as never)

    const result = await classifier.classify({
      scheduleState: createScheduleState(),
      userInput: '下午全部排入黄金剧场',
    })

    expect(result.mode).toBe('layout_prepare')
    expect(result.suggestedParams?.targetTimeRange).toEqual({
      start: '13:00:00',
      end: '18:00:00',
    })
    expect(chat).not.toHaveBeenCalled()
  })

  it('对版面微调识别为 layout_refine', async () => {
    const chat = vi.fn()
    const classifier = new TaskClassifier({ chat } as never)

    const result = await classifier.classify({
      scheduleState: createScheduleState(),
      userInput: '下午改成新闻',
    })

    expect(result.mode).toBe('layout_refine')
    expect(result.suggestedParams?.targetTimeRange).toEqual({
      start: '13:00:00',
      end: '18:00:00',
    })
    expect(chat).not.toHaveBeenCalled()
  })

  it('对模糊版面请求直接要求澄清', async () => {
    const chat = vi.fn()
    const classifier = new TaskClassifier({ chat } as never)

    const result = await classifier.classify({
      scheduleState: createScheduleState(),
      userInput: '下单排单',
    })

    expect(result.mode).toBe('clarify')
    expect(result.confidence).toBeGreaterThanOrEqual(0.9)
    expect(chat).not.toHaveBeenCalled()
  })

  it('对版面确认指令识别为 layout_commit', async () => {
    const chat = vi.fn()
    const classifier = new TaskClassifier({ chat } as never)

    const result = await classifier.classify({
      scheduleState: createScheduleState(),
      userInput: '按这个版面开始编排',
    })

    expect(result.mode).toBe('layout_commit')
    expect(chat).not.toHaveBeenCalled()
  })

  it('对模糊补空窗表达继续交给 LLM 判定', async () => {
    const chat = vi.fn(async () => ({
      content: JSON.stringify({
        mode: 'clarify',
        confidence: 0.82,
        reasoning: '表达偏自然，需要澄清或进一步确认。',
      }),
    }))
    const classifier = new TaskClassifier({ chat } as never)

    const result = await classifier.classify({
      scheduleState: createScheduleState(),
      userInput: '你好 llm，我想让你帮我填一填表里的空白位置',
    })

    expect(chat).toHaveBeenCalledTimes(1)
    expect(result.mode).toBe('clarify')
  })
})
