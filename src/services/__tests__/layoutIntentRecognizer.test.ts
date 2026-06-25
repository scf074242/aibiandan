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

describe('LayoutIntentRecognizer LLM-only contract', () => {
  it('uses the LLM result for a new layout draft request', async () => {
    const chat = vi.fn(async () => ({
      content: JSON.stringify({
        mode: 'layout_prepare',
        confidence: 0.92,
        reasoning: '用户要求不参考当前版面，重新准备下午电视剧草案。',
        ignoreExistingLayout: true,
        targetTimeRange: { start: '13:00:00', end: '18:00:00' },
        semanticLabel: '电视剧',
        programTypeHint: 'drama',
      }),
    }))
    const recognizer = new LayoutIntentRecognizer({ chat } as never)

    const result = await recognizer.recognize({
      scheduleState: createScheduleState(),
      userInput: '不参考版面，下午排入电视剧',
    })

    expect(chat).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({
      mode: 'layout_prepare',
      confidence: 0.92,
      ignoreExistingLayout: true,
      targetTimeRange: { start: '13:00:00', end: '18:00:00' },
      semanticLabel: '电视剧',
      programTypeHint: 'drama',
    })
  })

  it('does not rewrite a model layout decision with local contextual rules', async () => {
    const chat = vi.fn(async () => ({
      content: JSON.stringify({
        mode: 'layout_prepare',
        confidence: 0.88,
        reasoning: '模型判断用户要重做一份预热草案。',
        ignoreExistingLayout: false,
        targetTimeRange: { start: '13:30:00', end: '15:00:00' },
        semanticLabel: '静安寺户外直播预热',
        programTypeHint: 'news_magazine',
        segments: [
          { start: '13:30:00', end: '14:00:00', semanticLabel: '静安寺户外直播预热', programTypeHint: 'news_magazine' },
          { start: '14:00:00', end: '15:00:00', semanticLabel: '静安寺户外直播', programTypeHint: 'news_magazine' },
        ],
      }),
    }))
    const recognizer = new LayoutIntentRecognizer({ chat } as never)

    const result = await recognizer.recognize({
      scheduleState: createScheduleState(),
      userInput: '就按刚才那个主题加一点预热',
      currentLayoutDraft: createDraft(),
    })

    expect(result.mode).toBe('layout_prepare')
    expect(result.targetTimeRange).toEqual({ start: '13:30:00', end: '15:00:00' })
    expect(result.segments).toHaveLength(2)
  })

  it('uses the LLM result for draft commit wording', async () => {
    const chat = vi.fn(async () => ({
      content: JSON.stringify({
        mode: 'layout_commit',
        confidence: 0.95,
        reasoning: '用户确认当前草案进入正式编排。',
        ignoreExistingLayout: false,
      }),
    }))
    const recognizer = new LayoutIntentRecognizer({ chat } as never)

    const result = await recognizer.recognize({
      scheduleState: createScheduleState(),
      userInput: '按这个版面开始编排',
      currentLayoutDraft: createDraft(),
    })

    expect(chat).toHaveBeenCalledTimes(1)
    expect(result.mode).toBe('layout_commit')
  })

  it('preserves LLM-provided multi-segment layout structure', async () => {
    const chat = vi.fn(async () => ({
      content: JSON.stringify({
        mode: 'layout_prepare',
        confidence: 0.93,
        reasoning: '用户一次性描述多个时段。',
        ignoreExistingLayout: false,
        segments: [
          { start: '09:00:00', end: '10:00:00', semanticLabel: '新闻', programTypeHint: 'news' },
          { start: '10:00:00', end: '12:30:00', semanticLabel: '电视剧', programTypeHint: 'drama' },
        ],
      }),
    }))
    const recognizer = new LayoutIntentRecognizer({ chat } as never)

    const result = await recognizer.recognize({
      scheduleState: createScheduleState(),
      userInput: '9点到10点新闻，10点到12点半电视剧',
    })

    expect(result.mode).toBe('layout_prepare')
    expect(result.segments).toEqual([
      { start: '09:00:00', end: '10:00:00', semanticLabel: '新闻', programTypeHint: 'news' },
      { start: '10:00:00', end: '12:30:00', semanticLabel: '电视剧', programTypeHint: 'drama' },
    ])
  })

  it('does not fall back to local layout rules when the model is unavailable', async () => {
    const chat = vi.fn(async () => {
      throw new Error('mock llm unavailable')
    })
    const recognizer = new LayoutIntentRecognizer({ chat } as never)

    const result = await recognizer.recognize({
      scheduleState: createScheduleState(),
      userInput: '不参考版面，下午排入电视剧',
      currentLayoutDraft: createDraft(),
    })

    expect(chat).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({
      mode: 'clarify',
      confidence: 0,
      ignoreExistingLayout: false,
    })
    expect(result.reasoning).toContain('停止本地规则兜底')
  })

  it('does not fall back to local layout rules when the model returns invalid JSON', async () => {
    const chat = vi.fn(async () => ({ content: 'not-json' }))
    const recognizer = new LayoutIntentRecognizer({ chat } as never)

    const result = await recognizer.recognize({
      scheduleState: createScheduleState(),
      userInput: '按这个版面开始编排',
      currentLayoutDraft: createDraft(),
    })

    expect(result.mode).toBe('clarify')
    expect(result.confidence).toBe(0)
  })
})
