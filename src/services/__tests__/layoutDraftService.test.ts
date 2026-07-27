import { describe, expect, it, vi } from 'vitest'

import { LayoutDraftService } from '@/services/layoutDraftService'
import type { LayoutDraft } from '@/types/orchestration'

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
    slots: [
      {
        id: 'slot-1',
        channelId: 'dragon',
        startTime: '2026-03-25T22:00:00+08:00',
        endTime: '2026-03-25T22:30:00+08:00',
        columnId: 'runtime-column:today',
      },
      {
        id: 'slot-2',
        channelId: 'dragon',
        startTime: '2026-03-25T22:30:00+08:00',
        endTime: '2026-03-25T23:00:00+08:00',
        columnId: 'runtime-column:focus',
      },
      {
        id: 'slot-3',
        channelId: 'dragon',
        startTime: '2026-03-25T23:00:00+08:00',
        endTime: '2026-03-25T23:30:00+08:00',
        columnId: 'runtime-column:talk',
      },
      {
        id: 'slot-4',
        channelId: 'dragon',
        startTime: '2026-03-25T23:30:00+08:00',
        endTime: '2026-03-25T23:59:59+08:00',
        columnId: 'runtime-column:dream',
      },
    ],
  },
  columns: [
    {
      columnId: 'runtime-column:today',
      columnName: '今晚',
      channelId: 'dragon',
      defaultProgramType: 'commentary',
      semanticLabel: '今晚',
      source: 'default',
    },
    {
      columnId: 'runtime-column:focus',
      columnName: '焦点',
      channelId: 'dragon',
      defaultProgramType: 'commentary',
      semanticLabel: '焦点',
      source: 'default',
    },
    {
      columnId: 'runtime-column:talk',
      columnName: '两说',
      channelId: 'dragon',
      defaultProgramType: 'commentary',
      semanticLabel: '两说',
      source: 'default',
    },
    {
      columnId: 'runtime-column:dream',
      columnName: '梦想剧场',
      channelId: 'dragon',
      defaultProgramType: 'drama',
      semanticLabel: '梦想剧场',
      source: 'default',
    },
  ],
})

const createLiveDraft = (): LayoutDraft => ({
  id: 'draft-live',
  channelId: 'dragon',
  date: '2026-03-25',
  version: 1,
  source: 'generated',
  userIntent: '静安寺户外直播',
  coverage: {
    start: '14:00:00',
    end: '15:00:00',
  },
  layoutReference: {
    id: 'layout-live',
    name: '直播草案',
    slots: [
      {
        id: 'slot-live',
        channelId: 'dragon',
        startTime: '2026-03-25T14:00:00+08:00',
        endTime: '2026-03-25T15:00:00+08:00',
        columnId: 'runtime-column:live',
      },
    ],
  },
  columns: [
    {
      columnId: 'runtime-column:live',
      columnName: '静安寺户外直播',
      channelId: 'dragon',
      defaultProgramType: 'news_magazine',
      semanticLabel: '静安寺户外直播',
      source: 'generated',
    },
  ],
})

const createPartialDayDraft = (): LayoutDraft => ({
  id: 'draft-partial-day',
  channelId: 'dragon',
  date: '2026-03-25',
  version: 1,
  source: 'generated',
  userIntent: '白天版面草案',
  coverage: {
    start: '06:00:00',
    end: '18:00:00',
  },
  layoutReference: {
    id: 'layout-partial-day',
    name: '白天版面草案',
    slots: [{
      id: 'slot-daytime',
      channelId: 'dragon',
      startTime: '2026-03-25T06:00:00+08:00',
      endTime: '2026-03-25T18:00:00+08:00',
      columnId: 'runtime-column:daytime',
    }],
  },
  columns: [{
    columnId: 'runtime-column:daytime',
    columnName: '白天综合版面',
    channelId: 'dragon',
    defaultProgramType: 'news_magazine',
    semanticLabel: '白天综合版面',
    source: 'generated',
  }],
})

describe('LayoutDraftService', () => {
  it('多段续补草案时保留既有时段并扩展覆盖范围', async () => {
    const service = new LayoutDraftService({ chat: vi.fn() } as never)

    const spec = await service.refineSpec({
      channelId: 'dragon',
      channelName: '东方卫视',
      date: '2026-03-25',
      userInput: '草案只到下午，晚上18点到20点补新闻，20点到22点补剧场',
      currentDraft: createPartialDayDraft(),
      segments: [
        { start: '18:00:00', end: '20:00:00', semanticLabel: '晚间新闻', programTypeHint: 'news' },
        { start: '20:00:00', end: '22:00:00', semanticLabel: '黄金剧场', programTypeHint: 'drama' },
      ],
    })

    expect(spec.coverage).toEqual({ start: '06:00:00', end: '22:00:00' })
    expect(spec.segments.map((segment) => [segment.startTime, segment.endTime, segment.label])).toEqual([
      ['06:00:00', '18:00:00', '白天综合版面'],
      ['18:00:00', '20:00:00', '晚间新闻'],
      ['20:00:00', '22:00:00', '黄金剧场'],
    ])
  })

  it('只有 planner 明确要求整份重写时多段草案才替换既有时段', async () => {
    const service = new LayoutDraftService({ chat: vi.fn() } as never)

    const spec = await service.refineSpec({
      channelId: 'dragon',
      channelName: '东方卫视',
      date: '2026-03-25',
      userInput: '草案全部改成晚间新闻和黄金剧场',
      currentDraft: createPartialDayDraft(),
      replaceAll: true,
      segments: [
        { start: '18:00:00', end: '20:00:00', semanticLabel: '晚间新闻', programTypeHint: 'news' },
        { start: '20:00:00', end: '22:00:00', semanticLabel: '黄金剧场', programTypeHint: 'drama' },
      ],
    })

    expect(spec.coverage).toEqual({ start: '06:00:00', end: '22:00:00' })
    expect(spec.segments.map((segment) => segment.label)).toEqual(['晚间新闻', '黄金剧场'])
  })

  it('enriches LLM-generated outdoor live hints after parsing spec JSON', async () => {
    const chat = vi.fn(async () => ({
      content: JSON.stringify({
        coverage: { start: '14:00:00', end: '15:00:00' },
        segments: [
          {
            id: 'live',
            label: '静安寺户外直播',
            startTime: '14:00:00',
            endTime: '15:00:00',
            programType: 'news',
            queryHints: ['静安寺户外直播'],
          },
        ],
      }),
    }))
    const service = new LayoutDraftService({ chat } as never)

    const spec = await service.generateSpec({
      channelId: 'dragon',
      channelName: '东方卫视',
      date: '2026-03-25',
      userInput: '我准备在静安寺进行户外直播，准备一个14:00到15:00的轮播单',
      coverage: { start: '14:00:00', end: '15:00:00' },
      semanticLabel: '静安寺户外直播',
      programTypeHint: 'news_magazine',
    })

    expect(spec.segments[0]?.label).toBe('静安寺户外直播')
    expect(spec.segments[0]?.programType).toBe('news_magazine')
    expect(spec.segments[0]?.queryHints).toEqual(expect.arrayContaining([
      '静安寺户外直播',
      '静安寺',
      '直播',
      '外场直播',
    ]))
  })

  it('明确节目标题和集数时会纠正为电视剧顺播草案', async () => {
    const chat = vi.fn(async () => ({
      content: JSON.stringify({
        coverage: { start: '09:30:00', end: '10:15:00' },
        segments: [
          {
            id: 'explicit-title',
            label: '节目标题纵有疾风起第5集',
            startTime: '09:30:00',
            endTime: '10:15:00',
            programType: 'news_magazine',
            queryHints: ['节目标题纵有疾风起第5集'],
          },
        ],
      }),
    }))
    const service = new LayoutDraftService({ chat } as never)

    const spec = await service.generateSpec({
      channelId: 'dragon',
      channelName: '东方卫视',
      date: '2026-03-25',
      userInput: '09:30到10:15安排节目标题纵有疾风起第5集',
      coverage: { start: '09:30:00', end: '10:15:00' },
    })

    expect(spec.segments[0]?.programType).toBe('drama')
    expect(spec.segments[0]?.queryHints).toEqual(expect.arrayContaining([
      '节目标题纵有疾风起第5集',
      '电视剧',
      '剧场',
    ]))
  })

  it('模型不可用时不会本地生成自由业务短语草案', async () => {
    const service = new LayoutDraftService({
      chat: vi.fn(async () => {
        throw new Error('mock llm unavailable')
      }),
    } as never)

    await expect(service.generateSpec({
      channelId: 'dragon',
      channelName: '东方卫视',
      date: '2026-03-25',
      userInput: '不参考当前版面参考，下午编入下午剧场节目',
    })).rejects.toMatchObject({
      llmFailure: {
        stage: 'layout_draft_generate',
        canRetry: true,
      },
    })
  })

  it('模型不可用时不会本地删除命中的版面时段', async () => {
    const service = new LayoutDraftService({
      chat: vi.fn(async () => {
        throw new Error('mock llm unavailable')
      }),
    } as never)

    await expect(service.refineSpec({
      channelId: 'dragon',
      channelName: '东方卫视',
      date: '2026-03-25',
      userInput: '去掉23点的两说',
      currentDraft: createDraft(),
    })).rejects.toMatchObject({
      llmFailure: {
        stage: 'layout_draft_refine',
        canRetry: true,
      },
    })
  })

  it('删除草案时段也必须由模型返回更新后的草案', async () => {
    const chat = vi.fn(async () => {
      throw new Error('mock llm unavailable')
    })
    const service = new LayoutDraftService({
      chat,
    } as never)

    await expect(service.refineSpec({
      channelId: 'dragon',
      channelName: '东方卫视',
      date: '2026-03-25',
      userInput: '删除22点的草案',
      currentDraft: createDraft(),
    })).rejects.toMatchObject({
      llmFailure: {
        stage: 'layout_draft_refine',
        canRetry: true,
      },
    })
    expect(chat).toHaveBeenCalledTimes(1)
  })

  it('短句微调没有显式新时间时不会采纳 LLM 扩大的覆盖范围', async () => {
    const chat = vi.fn(async () => ({
      content: JSON.stringify({
        coverage: { start: '13:30:00', end: '15:00:00' },
        segments: [
          {
            id: 'preheat',
            label: '静安寺户外直播预热',
            startTime: '13:30:00',
            endTime: '14:00:00',
            programType: 'news_magazine',
            queryHints: ['预热'],
          },
          {
            id: 'live',
            label: '静安寺户外直播',
            startTime: '14:00:00',
            endTime: '15:00:00',
            programType: 'news_magazine',
            queryHints: ['直播'],
          },
        ],
      }),
    }))
    const service = new LayoutDraftService({
      chat,
    } as never)

    await expect(service.refineSpec({
      channelId: 'dragon',
      channelName: '东方卫视',
      date: '2026-03-25',
      userInput: '就按刚才那个主题加一点预热',
      currentDraft: createLiveDraft(),
      coverage: { start: '14:00:00', end: '15:00:00' },
      semanticLabel: '预热',
      programTypeHint: 'news_magazine',
    })).rejects.toMatchObject({
      llmFailure: {
        stage: 'layout_draft_refine',
        canRetry: true,
      },
    })

    expect(chat).toHaveBeenCalledTimes(1)
  })

  it('需要模型拆结构的草案生成超时时不会悄悄回退成成功草案', async () => {
    const service = new LayoutDraftService({
      chat: vi.fn(async () => {
        throw new Error('LLM request failed after 1 attempt: LLM 网络请求超时，请检查网络或稍后重试。')
      }),
    } as never)

    await expect(service.generateSpec({
      channelId: 'dragon',
      channelName: '东方卫视',
      date: '2026-03-25',
      userInput: '帮我策划一个3小时轮播单，第一小时静安寺，第二小时商圈，第三小时天主教堂',
    })).rejects.toMatchObject({
      llmFailure: {
        stage: 'layout_draft_generate',
        reason: 'timeout',
        canRetry: true,
      },
    })
  })

  it('用户明确要求拆成多段时不会接受单段 LLM 结果', async () => {
    const service = new LayoutDraftService({
      chat: vi.fn(async () => ({
        content: JSON.stringify({
          coverage: { start: '00:00:00', end: '02:00:00' },
          segments: [
            {
              id: 'only-one',
              label: '世界杯北美球队介绍',
              startTime: '00:00:00',
              endTime: '02:00:00',
              programType: 'news_magazine',
              queryHints: ['世界杯', '北美球队'],
            },
          ],
        }),
      })),
    } as never)

    await expect(service.generateSpec({
      channelId: 'rotation',
      channelName: '轮播单',
      date: '2026-03-25',
      playlistType: 'rotation',
      targetDurationSeconds: 2 * 60 * 60,
      userInput: '拆分成10个草案片段，每个片段都是一个北美球队',
    })).rejects.toMatchObject({
      llmFailure: {
        stage: 'layout_draft_generate',
        canRetry: true,
      },
    })
  })
})

describe('LayoutDraftService promptVersion 透传', () => {
  /**
   * case c6-generate-passes-version
   * - expectedDecision: generateSpec 调用 LLM 时透传 promptVersion + traceLabel
   * - mustNotHappen: options 缺失 promptVersion
   * - verification: chat.mock.calls[0][1] 含 promptVersion: 'v1.0' + traceLabel: 'layout_draft_generate'
   */
  it('c6-generate-passes-version: generateSpec 透传 promptVersion', async () => {
    const chat = vi.fn(async () => ({
      content: JSON.stringify({
        coverage: { start: '06:00:00', end: '23:59:59' },
        segments: [
          {
            id: 'seg-1',
            label: '晨间新闻',
            startTime: '06:00:00',
            endTime: '07:00:00',
            programType: 'news',
            queryHints: ['晨间新闻'],
          },
        ],
      }),
    }))
    const service = new LayoutDraftService({ chat } as never)

    await service.generateSpec({
      channelId: 'dragon',
      channelName: '东方卫视',
      date: '2026-03-25',
      userInput: '排全天新闻',
    })

    expect(chat).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        promptVersion: 'v1.0',
        traceLabel: 'layout_draft_generate',
      }),
    )
  })

  /**
   * case c6-refine-passes-version
   * - expectedDecision: refineSpec 调用 LLM 时透传 promptVersion + traceLabel
   * - mustNotHappen: options 缺失 promptVersion
   * - verification: chat.mock.calls[0][1] 含 promptVersion: 'v1.0' + traceLabel: 'layout_draft_refine'
   */
  it('c6-refine-passes-version: refineSpec 透传 promptVersion', async () => {
    const chat = vi.fn(async () => ({
      content: JSON.stringify({
        coverage: { start: '06:00:00', end: '23:59:59' },
        segments: [
          {
            id: 'seg-1',
            label: '晨间新闻',
            startTime: '06:00:00',
            endTime: '07:00:00',
            programType: 'news',
            queryHints: ['晨间新闻'],
          },
        ],
      }),
    }))
    const service = new LayoutDraftService({ chat } as never)

    await service.refineSpec({
      channelId: 'dragon',
      channelName: '东方卫视',
      date: '2026-03-25',
      userInput: '把晨间改成新闻联播',
      currentDraft: createDraft(),
    })

    expect(chat).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        promptVersion: 'v1.0',
        traceLabel: 'layout_draft_refine',
      }),
    )
  })
})
