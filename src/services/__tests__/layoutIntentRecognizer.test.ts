import { describe, expect, it, vi } from 'vitest'

import { LayoutIntentRecognizer } from '@/services/layoutIntentRecognizer'
import type { LayoutDraft, ScheduleState } from '@/types/orchestration'

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

const createDraft = (): LayoutDraft => ({
  id: 'draft-1',
  channelId: 'dragon',
  date: '2026-03-25',
  version: 1,
  source: 'channel_default',
  userIntent: '当前版面',
  coverage: {
    start: '06:00:00',
    end: '23:59:59',
  },
  layoutReference: {
    id: 'layout-1',
    name: '测试版面',
    channelId: 'dragon',
    effectiveDate: '2026-03-25',
    slots: [
      {
        id: 'slot-1',
        channelId: 'dragon',
        startTime: '2026-03-25T18:00:00',
        endTime: '2026-03-25T23:00:00',
        columnId: 'runtime-column:test-evening',
      },
    ],
  },
  columns: [
    {
      columnId: 'runtime-column:test-evening',
      columnName: '晚间时段',
      defaultProgramType: 'drama',
      source: 'default',
      semanticLabel: '晚间剧场',
    },
  ],
})

describe('LayoutIntentRecognizer', () => {
  it('能从忽略现有版面的新草案需求中提取结构化结果', async () => {
    const recognizer = new LayoutIntentRecognizer({
      chat: vi.fn(async () => {
        throw new Error('skip llm')
      }),
    } as never)

    const result = await recognizer.recognize({
      scheduleState: createScheduleState(),
      userInput: '不参考版面，下午排入电视剧',
    })

    expect(result.mode).toBe('layout_prepare')
    expect(result.ignoreExistingLayout).toBe(true)
    expect(result.targetTimeRange).toEqual({
      start: '13:00:00',
      end: '18:00:00',
    })
    expect(result.programTypeHint).toBe('drama')
  })

  it('当前已有草案时优先识别为版面微调', async () => {
    const recognizer = new LayoutIntentRecognizer({
      chat: vi.fn(async () => {
        throw new Error('skip llm')
      }),
    } as never)

    const result = await recognizer.recognize({
      scheduleState: createScheduleState(),
      userInput: '晚上全部替换成新闻栏目',
      currentLayoutDraft: createDraft(),
    })

    expect(result.mode).toBe('layout_refine')
    expect(result.targetTimeRange).toEqual({
      start: '18:00:00',
      end: '23:00:00',
    })
    expect(result.semanticLabel).toBe('新闻栏目')
    expect(result.programTypeHint).toBe('news')
  })

  it('会把确认类表达识别为 layout_commit', async () => {
    const recognizer = new LayoutIntentRecognizer({
      chat: vi.fn(async () => {
        throw new Error('skip llm')
      }),
    } as never)

    const result = await recognizer.recognize({
      scheduleState: createScheduleState(),
      userInput: '按这个版面开始编排',
      currentLayoutDraft: createDraft(),
    })

    expect(result.mode).toBe('layout_commit')
  })

  it('会对模糊版面表达要求澄清', async () => {
    const recognizer = new LayoutIntentRecognizer({
      chat: vi.fn(async () => {
        throw new Error('skip llm')
      }),
    } as never)

    const result = await recognizer.recognize({
      scheduleState: createScheduleState(),
      userInput: '下单排单',
    })

    expect(result.mode).toBe('clarify')
    expect(result.confidence).toBeGreaterThan(0.8)
  })

  it('对全天补排这类直接编排命令不走版面识别的 LLM 分支', async () => {
    const chat = vi.fn(async () => ({
      content: '{"mode":"layout_prepare","confidence":0.99,"reasoning":"unexpected","ignoreExistingLayout":false}',
    }))
    const recognizer = new LayoutIntentRecognizer({
      chat,
    } as never)

    const result = await recognizer.recognize({
      scheduleState: createScheduleState({
        isEmpty: true,
        itemCount: 0,
      }),
      userInput: '帮我填充全天节目',
    })

    expect(chat).not.toHaveBeenCalled()
    expect(result.mode).toBe('clarify')
  })
})
