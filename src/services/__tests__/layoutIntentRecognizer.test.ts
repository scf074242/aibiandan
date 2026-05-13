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

  it('会把当前版面编排分析诉求识别为 layout_analysis', async () => {
    const recognizer = new LayoutIntentRecognizer({
      chat: vi.fn(async () => {
        throw new Error('skip llm')
      }),
    } as never)

    const result = await recognizer.recognize({
      scheduleState: createScheduleState(),
      userInput: '请分析当前版面编排，给我一份业务分析报告',
    })

    expect(result.mode).toBe('layout_analysis')
    expect(result.confidence).toBeGreaterThan(0.9)
  })

  it('已有版面草案时也不会把明确的分析诉求改写成版面草案', async () => {
    const chat = vi.fn(async () => ({
      content: JSON.stringify({
        mode: 'layout_prepare',
        confidence: 0.99,
        reasoning: '误判成重新生成版面草案',
        ignoreExistingLayout: true,
      }),
    }))
    const recognizer = new LayoutIntentRecognizer({
      chat,
    } as never)

    const result = await recognizer.recognize({
      scheduleState: createScheduleState(),
      userInput: '请分析当前版面编排，从节目编辑视角给我一份报告',
      currentLayoutDraft: createDraft(),
    })

    expect(chat).not.toHaveBeenCalled()
    expect(result.mode).toBe('layout_analysis')
    expect(result.reasoning).toContain('分析当前实际编排效果')
  })

  it('当前已有草案时会把删除草案时段识别为版面微调', async () => {
    const chat = vi.fn(async () => {
      throw new Error('skip llm')
    })
    const recognizer = new LayoutIntentRecognizer({
      chat,
    } as never)

    const result = await recognizer.recognize({
      scheduleState: createScheduleState(),
      userInput: '删除6点的草案',
      currentLayoutDraft: createDraft(),
    })

    expect(chat).not.toHaveBeenCalled()
    expect(result.mode).toBe('layout_refine')
    expect(result.reasoning).toContain('草案')
  })

  it('会把优化当前版面的表达识别为新的草案生成', async () => {
    const recognizer = new LayoutIntentRecognizer({
      chat: vi.fn(async () => {
        throw new Error('skip llm')
      }),
    } as never)

    const result = await recognizer.recognize({
      scheduleState: createScheduleState(),
      userInput: '请优化当前版面编排',
    })

    expect(result.mode).toBe('layout_prepare')
    expect(result.ignoreExistingLayout).toBe(true)
  })

  it('会把更像原子调整但信息不完整的表达识别为 atomic_fallback', async () => {
    const recognizer = new LayoutIntentRecognizer({
      chat: vi.fn(async () => {
        throw new Error('skip llm')
      }),
    } as never)

    const result = await recognizer.recognize({
      scheduleState: createScheduleState(),
      userInput: '把9点后那段顺一下',
    })

    expect(result.mode).toBe('atomic_fallback')
    expect(result.confidence).toBeGreaterThan(0.8)
  })

  it('不会把明确的时间范围版面需求误判成 atomic_fallback', async () => {
    const recognizer = new LayoutIntentRecognizer({
      chat: vi.fn(async () => {
        throw new Error('skip llm')
      }),
    } as never)

    const result = await recognizer.recognize({
      scheduleState: createScheduleState(),
      userInput: '把9点到10点改成新闻栏目',
    })

    expect(result.mode).toBe('layout_prepare')
    expect(result.semanticLabel).toBe('新闻栏目')
    expect(result.targetTimeRange).toEqual({
      start: '09:00:00',
      end: '10:00:00',
    })
  })

  it('能把多时段版面需求识别成结构化 segments', async () => {
    const recognizer = new LayoutIntentRecognizer({
      chat: vi.fn(async () => {
        throw new Error('skip llm')
      }),
    } as never)

    const result = await recognizer.recognize({
      scheduleState: createScheduleState(),
      userInput: '上午新闻，下午剧场，晚间综艺',
    })

    expect(result.mode).toBe('layout_prepare')
    expect(result.segments).toHaveLength(3)
    expect(result.segments?.[0]).toMatchObject({
      start: '06:00:00',
      end: '12:00:00',
      semanticLabel: '新闻',
      programTypeHint: 'news',
    })
    expect(result.segments?.[1]).toMatchObject({
      start: '13:00:00',
      end: '18:00:00',
      semanticLabel: '剧场',
      programTypeHint: 'drama',
    })
    expect(result.segments?.[2]).toMatchObject({
      start: '18:00:00',
      end: '23:00:00',
      semanticLabel: '综艺',
      programTypeHint: 'entertainment',
    })
  })

  it('对全天补排这类启动编排命令直接落到 layout_prepare，且不走 LLM 分支', async () => {
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
    expect(result.mode).toBe('layout_prepare')
    expect(result.targetTimeRange).toEqual({
      start: '06:00:00',
      end: '23:59:59',
    })
  })
})
