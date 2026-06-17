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

const createLiveDraft = (): LayoutDraft => ({
  ...createDraft(),
  coverage: {
    start: '14:00:00',
    end: '15:00:00',
  },
  layoutReference: {
    ...createDraft().layoutReference,
    slots: [
      {
        id: 'slot-live',
        channelId: 'dragon',
        startTime: '2026-03-25T14:00:00',
        endTime: '2026-03-25T15:00:00',
        columnId: 'runtime-column:live',
      },
    ],
  },
  columns: [
    {
      columnId: 'runtime-column:live',
      columnName: '静安寺户外直播',
      defaultProgramType: 'news_magazine',
      source: 'generated',
      semanticLabel: '静安寺户外直播',
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

  it.each([
    {
      input: '就按刚才那个主题加一点预热',
      semanticLabel: '预热',
      programTypeHint: 'news_magazine',
    },
    {
      input: '这个时段偏新闻',
      semanticLabel: '新闻',
      programTypeHint: 'news',
    },
    {
      input: '这个版面围绕民生服务',
      semanticLabel: '民生服务',
      programTypeHint: 'commentary',
    },
    {
      input: '刚才那段多一点交通提醒',
      semanticLabel: '交通提醒',
      programTypeHint: 'news_magazine',
    },
  ])('LLM 不可用时也能承接草案短句作为版面微调 $input', async ({ input, semanticLabel, programTypeHint }) => {
    const chat = vi.fn(async () => {
      throw new Error('skip llm')
    })
    const recognizer = new LayoutIntentRecognizer({
      chat,
    } as never)

    const result = await recognizer.recognize({
      scheduleState: createScheduleState(),
      userInput: input,
      currentLayoutDraft: createDraft(),
    })

    expect(chat).toHaveBeenCalledTimes(1)
    expect(result.mode).toBe('layout_refine')
    expect(result.semanticLabel).toBe(semanticLabel)
    expect(result.programTypeHint).toBe(programTypeHint)
  })

  it('没有草案上下文时不会把弱承接短句强行判成版面微调', async () => {
    const chat = vi.fn(async () => {
      throw new Error('skip llm')
    })
    const recognizer = new LayoutIntentRecognizer({
      chat,
    } as never)

    const result = await recognizer.recognize({
      scheduleState: createScheduleState(),
      userInput: '就按刚才那个主题加一点预热',
    })

    expect(result.mode).not.toBe('layout_refine')
  })

  it('承接草案短句没有显式新时间时会忽略 LLM 返回的越界时段', async () => {
    const chat = vi.fn(async () => ({
      content: JSON.stringify({
        mode: 'layout_prepare',
        confidence: 0.9,
        reasoning: '增加直播预热',
        ignoreExistingLayout: false,
        targetTimeRange: { start: '13:30:00', end: '15:00:00' },
        semanticLabel: '预热',
        programTypeHint: 'news_magazine',
        segments: [
          { start: '13:30:00', end: '14:00:00', semanticLabel: '静安寺户外直播预热', programTypeHint: 'news_magazine' },
          { start: '14:00:00', end: '15:00:00', semanticLabel: '静安寺户外直播', programTypeHint: 'news_magazine' },
        ],
      }),
    }))
    const recognizer = new LayoutIntentRecognizer({
      chat,
    } as never)

    const result = await recognizer.recognize({
      scheduleState: createScheduleState(),
      userInput: '就按刚才那个主题加一点预热',
      currentLayoutDraft: createLiveDraft(),
    })

    expect(result.mode).toBe('layout_refine')
    expect(result.targetTimeRange).toEqual({
      start: '14:00:00',
      end: '15:00:00',
    })
    expect(result.segments).toBeUndefined()
    expect(result.semanticLabel).toBe('预热')
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

  it.each([
    '可以了',
    '就按这个来',
    '没问题开始编排',
    '就按这个生成正式编排单',
    '按这个执行',
    '把这份草案落到节目单里',
    '确认并输出编排单',
    '用当前草案生成节目单',
  ])('有草案上下文时会把短确认“%s”识别为 layout_commit', async (userInput) => {
    const recognizer = new LayoutIntentRecognizer({
      chat: vi.fn(async () => {
        throw new Error('skip llm')
      }),
    } as never)

    const result = await recognizer.recognize({
      scheduleState: createScheduleState(),
      userInput,
      currentLayoutDraft: createDraft(),
    })

    expect(result.mode).toBe('layout_commit')
  })

  it('有上传版面上下文时也会把确认类表达识别为 layout_commit', async () => {
    const recognizer = new LayoutIntentRecognizer({
      chat: vi.fn(async () => {
        throw new Error('skip llm')
      }),
    } as never)

    const result = await recognizer.recognize({
      scheduleState: createScheduleState(),
      userInput: '按这个版面开始编排',
      hasUploadedLayout: true,
    })

    expect(result.mode).toBe('layout_commit')
  })

  it('没有草案或上传版面时不会把空确认放行为 layout_commit', async () => {
    const recognizer = new LayoutIntentRecognizer({
      chat: vi.fn(async () => {
        throw new Error('skip llm')
      }),
    } as never)

    const result = await recognizer.recognize({
      scheduleState: createScheduleState(),
      userInput: '按这个版面开始编排',
    })

    expect(result.mode).not.toBe('layout_commit')
  })

  it.each([
    '可以了',
    '就按这个来',
    '就按这个生成正式编排单',
    '把这份草案落到节目单里',
    '确认并输出编排单',
  ])('没有草案或上传版面时不会把短确认“%s”识别为 layout_commit', async (userInput) => {
    const recognizer = new LayoutIntentRecognizer({
      chat: vi.fn(async () => {
        throw new Error('skip llm')
      }),
    } as never)

    const result = await recognizer.recognize({
      scheduleState: createScheduleState(),
      userInput,
    })

    expect(result.mode).not.toBe('layout_commit')
  })

  it('已有草案时会把放弃并重做的复合表达识别为新草案生成', async () => {
    const recognizer = new LayoutIntentRecognizer({
      chat: vi.fn(async () => {
        throw new Error('skip llm')
      }),
    } as never)

    const result = await recognizer.recognize({
      scheduleState: createScheduleState(),
      userInput: '这个草案不要了，重新做晚间新闻',
      currentLayoutDraft: createDraft(),
    })

    expect(result.mode).toBe('layout_prepare')
    expect(result.ignoreExistingLayout).toBe(true)
    expect(result.targetTimeRange).toEqual({
      start: '18:00:00',
      end: '23:00:00',
    })
    expect(result.programTypeHint).toBe('news')
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

  it('对户外直播轮播单这类开放编排话术会交给 LLM 判别为版面草案', async () => {
    const chat = vi.fn(async () => ({
      content: JSON.stringify({
        mode: 'layout_prepare',
        confidence: 0.88,
        reasoning: '用户提出指定地点、时间范围和轮播单产物，应先生成待确认版面草案。',
        ignoreExistingLayout: false,
        targetTimeRange: { start: '14:00:00', end: '15:00:00' },
        semanticLabel: '静安寺户外直播轮播',
        programTypeHint: 'news_magazine',
      }),
    }))
    const recognizer = new LayoutIntentRecognizer({
      chat,
    } as never)

    const result = await recognizer.recognize({
      scheduleState: createScheduleState(),
      userInput: '我准备在静安寺进行户外直播，准备一个14:00到15:00的轮播单',
    })

    expect(chat).toHaveBeenCalledTimes(1)
    expect(result.mode).toBe('layout_prepare')
    expect(result.targetTimeRange).toEqual({
      start: '14:00:00',
      end: '15:00:00',
    })
    expect(result.semanticLabel).toBe('静安寺户外直播轮播')
    expect(result.programTypeHint).toBe('news_magazine')
  })

  it('对主题活动节目单这类非固定栏目话术也会交给 LLM 判别', async () => {
    const chat = vi.fn(async () => ({
      content: JSON.stringify({
        mode: 'layout_prepare',
        confidence: 0.84,
        reasoning: '用户提出中午商圈活动预热节目单，属于开放业务编排需求。',
        ignoreExistingLayout: false,
        targetTimeRange: { start: '12:00:00', end: '14:00:00' },
        semanticLabel: '商圈活动预热节目单',
        programTypeHint: 'news_magazine',
      }),
    }))
    const recognizer = new LayoutIntentRecognizer({
      chat,
    } as never)

    const result = await recognizer.recognize({
      scheduleState: createScheduleState(),
      userInput: '帮我做一份中午商圈活动预热的节目单',
    })

    expect(chat).toHaveBeenCalledTimes(1)
    expect(result.mode).toBe('layout_prepare')
    expect(result.targetTimeRange).toEqual({
      start: '12:00:00',
      end: '14:00:00',
    })
    expect(result.semanticLabel).toBe('商圈活动预热节目单')
  })

  it.each([
    {
      input: '给我一个14点到15点亲子露营主题',
      range: { start: '14:00:00', end: '15:00:00' },
      label: '亲子露营主题',
    },
    {
      input: '晚间改成交通服务提醒',
      range: { start: '18:00:00', end: '23:00:00' },
      label: '交通服务提醒',
    },
    {
      input: '周末展会直播做一版串联单',
      range: undefined,
      label: '展会直播串联单',
    },
    {
      input: '麻烦来个14-15点静安寺外场直播播单',
      range: { start: '14:00:00', end: '15:00:00' },
      label: '静安寺外场直播播单',
    },
    {
      input: '两点到三点做社区服务提醒',
      range: { start: '14:00:00', end: '15:00:00' },
      label: '社区服务提醒',
    },
    {
      input: '下午以城市服务为主',
      range: { start: '13:00:00', end: '18:00:00' },
      label: '城市服务',
    },
    {
      input: '黄金档主打综艺',
      range: { start: '19:00:00', end: '20:00:00' },
      label: '综艺',
    },
    {
      input: '晚间民生新闻多一点',
      range: { start: '18:00:00', end: '23:00:00' },
      label: '民生新闻',
    },
  ])('对自由主题和服务提醒类开放话术交给 LLM 映射为版面草案: $input', async ({ input, range, label }) => {
    const chat = vi.fn(async () => ({
      content: JSON.stringify({
        mode: 'layout_prepare',
        confidence: 0.85,
        reasoning: '开放主题属于节目编排业务，应先生成待确认版面草案。',
        ignoreExistingLayout: false,
        targetTimeRange: range,
        semanticLabel: label,
        programTypeHint: 'news_magazine',
      }),
    }))
    const recognizer = new LayoutIntentRecognizer({
      chat,
    } as never)

    const result = await recognizer.recognize({
      scheduleState: createScheduleState(),
      userInput: input,
    })

    expect(chat).toHaveBeenCalledTimes(1)
    expect(result.mode).toBe('layout_prepare')
    expect(result.semanticLabel).toBe(label)
    if (range) {
      expect(result.targetTimeRange).toEqual(range)
    }
  })

  it('LLM 没回传时间范围时会保留规则侧解析出的 14-15 点范围', async () => {
    const chat = vi.fn(async () => ({
      content: JSON.stringify({
        mode: 'layout_prepare',
        confidence: 0.85,
        reasoning: '开放主题属于节目编排业务，应先生成待确认版面草案。',
        ignoreExistingLayout: false,
        semanticLabel: '静安寺外场直播播单',
        programTypeHint: 'news_magazine',
      }),
    }))
    const recognizer = new LayoutIntentRecognizer({
      chat,
    } as never)

    const result = await recognizer.recognize({
      scheduleState: createScheduleState(),
      userInput: '麻烦来个14-15点静安寺外场直播播单',
    })

    expect(result.mode).toBe('layout_prepare')
    expect(result.targetTimeRange).toEqual({
      start: '14:00:00',
      end: '15:00:00',
    })
  })

  it('对没有固定类型词但属于编排业务的开放话术会让 LLM 决定是否追问', async () => {
    const chat = vi.fn(async () => ({
      content: JSON.stringify({
        mode: 'clarify',
        confidence: 0.82,
        reasoning: '用户表达了要排播但缺少播出范围，需要追问具体时段。',
        ignoreExistingLayout: false,
      }),
    }))
    const recognizer = new LayoutIntentRecognizer({
      chat,
    } as never)

    const result = await recognizer.recognize({
      scheduleState: createScheduleState(),
      userInput: '这个周末有社区活动，先帮我出一份播单',
    })

    expect(chat).toHaveBeenCalledTimes(1)
    expect(result.mode).toBe('clarify')
    expect(result.reasoning).toContain('具体时段')
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

  it('规则层拆出的明确多时段不会被 LLM 单段粗结果覆盖', async () => {
    const recognizer = new LayoutIntentRecognizer({
      chat: vi.fn(async () => ({
        content: JSON.stringify({
          mode: 'layout_prepare',
          confidence: 0.9,
          reasoning: 'LLM 粗略识别成单段。',
          ignoreExistingLayout: false,
          targetTimeRange: { start: '09:00:00', end: '12:00:00' },
          semanticLabel: '品质剧场：纵有疾风起；午间新闻',
          programTypeHint: 'drama',
          segments: [
            {
              start: '09:00:00',
              end: '12:00:00',
              semanticLabel: '品质剧场：纵有疾风起；午间新闻',
              programTypeHint: 'drama',
            },
          ],
        }),
      })),
    } as never)

    const result = await recognizer.recognize({
      scheduleState: createScheduleState(),
      userInput: '按纯电视频道，09:00到12:00继续播品质剧场：纵有疾风起，接昨天进度顺播；12:00到12:30安排午间新闻',
    })

    expect(result.mode).toBe('layout_prepare')
    expect(result.targetTimeRange).toEqual({
      start: '09:00:00',
      end: '12:30:00',
    })
    expect(result.segments).toHaveLength(2)
    expect(result.segments?.[0]).toMatchObject({
      start: '09:00:00',
      end: '12:00:00',
      programTypeHint: 'drama',
    })
    expect(result.segments?.[0]?.semanticLabel).toContain('纵有疾风起')
    expect(result.segments?.[1]).toMatchObject({
      start: '12:00:00',
      end: '12:30:00',
      semanticLabel: '午间新闻',
      programTypeHint: 'news',
    })
  })

  it('能把起播时间加连续时长的话术识别成结构化 segments', async () => {
    const recognizer = new LayoutIntentRecognizer({
      chat: vi.fn(async () => {
        throw new Error('skip llm')
      }),
    } as never)

    const result = await recognizer.recognize({
      scheduleState: createScheduleState(),
      userInput: '14点先来10分钟导视，再50分钟静安寺直播',
    })

    expect(result.mode).toBe('layout_prepare')
    expect(result.targetTimeRange).toEqual({
      start: '14:00:00',
      end: '15:00:00',
    })
    expect(result.segments).toHaveLength(2)
    expect(result.segments?.[0]).toMatchObject({
      start: '14:00:00',
      end: '14:10:00',
      semanticLabel: '导视',
      programTypeHint: 'news_magazine',
    })
    expect(result.segments?.[1]).toMatchObject({
      start: '14:10:00',
      end: '15:00:00',
      semanticLabel: '静安寺直播',
      programTypeHint: 'news_magazine',
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
