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
  it.each([
    '请补齐当前所有空窗',
    '请把当前空窗补掉',
  ])('对明确补空窗短语“%s”走规则快速判定为 layout_prepare', async (userInput) => {
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
      userInput,
    })

    expect(result.mode).toBe('layout_prepare')
    expect(result.suggestedParams?.userIntent).toBe(userInput)
    expect(chat).toHaveBeenCalled()
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
    expect(chat).toHaveBeenCalled()
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
    expect(chat).toHaveBeenCalled()
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
    expect(chat).toHaveBeenCalled()
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
    expect(chat).toHaveBeenCalled()
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
    expect(chat).toHaveBeenCalled()
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
    expect(chat).toHaveBeenCalled()
  })

  it('对修复类表达先收敛到问题分析', async () => {
    const chat = vi.fn()
    const classifier = new TaskClassifier({ chat } as never)

    const result = await classifier.classify({
      scheduleState: createScheduleState(),
      userInput: '把当前节目单的问题自动修复一下',
    })

    expect(result.mode).toBe('validate_only')
    expect(result.reasoning).toContain('先输出问题分析结果')
    expect(chat).toHaveBeenCalled()
  })

  it.each([
    '修掉当前播单里的冲突',
    '把这张单子的重叠问题处理掉',
    '当前编排有断档，先修一下',
  ])('对修复口语“%s”先收敛到问题分析', async (userInput) => {
    const chat = vi.fn()
    const classifier = new TaskClassifier({ chat } as never)

    const result = await classifier.classify({
      scheduleState: createScheduleState(),
      userInput,
    })

    expect(result.mode).toBe('validate_only')
    expect(result.reasoning).toContain('先输出问题分析结果')
    expect(chat).toHaveBeenCalled()
  })

  it.each([
    '帮我体检一下当前播单',
    '查一下这张单子有没有重叠',
    '看看当前编排有无空窗',
  ])('对校验口语“%s”识别为 validate_only', async (userInput) => {
    const chat = vi.fn()
    const classifier = new TaskClassifier({ chat } as never)

    const result = await classifier.classify({
      scheduleState: createScheduleState(),
      userInput,
    })

    expect(result.mode).toBe('validate_only')
    expect(chat).toHaveBeenCalled()
  })

  it('对当前版面编排分析诉求识别为 layout_analysis', async () => {
    const chat = vi.fn()
    const classifier = new TaskClassifier({ chat } as never)

    const result = await classifier.classify({
      scheduleState: createScheduleState(),
      userInput: '请分析当前版面编排，给我一份编辑视角的文字版报告',
    })

    expect(result.mode).toBe('layout_analysis')
    expect(chat).toHaveBeenCalled()
  })

  it('对优化当前版面的诉求识别为 layout_prepare', async () => {
    const chat = vi.fn()
    const classifier = new TaskClassifier({ chat } as never)

    const result = await classifier.classify({
      scheduleState: createScheduleState(),
      userInput: '请优化当前版面编排',
    })

    expect(result.mode).toBe('layout_prepare')
    expect(result.suggestedParams?.ignoreExistingLayout).toBe(true)
    expect(chat).toHaveBeenCalled()
  })

  it('对像原子操作但信息不完整的表达要求澄清', async () => {
    const chat = vi.fn()
    const classifier = new TaskClassifier({ chat } as never)

    const result = await classifier.classify({
      scheduleState: createScheduleState(),
      userInput: '把9点后那段顺一下',
    })

    expect(result.mode).toBe('clarify')
    expect(result.reasoning).toContain('原子命令')
    expect(chat).toHaveBeenCalled()
  })

  it('对版面确认指令识别为 layout_commit', async () => {
    const chat = vi.fn()
    const classifier = new TaskClassifier({ chat } as never)

    const result = await classifier.classify({
      scheduleState: createScheduleState(),
      userInput: '按这个版面开始编排',
    })

    expect(result.mode).toBe('layout_commit')
    expect(chat).toHaveBeenCalled()
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

  it('对户外直播轮播单这类开放业务命令交给 LLM 判定后按总时长处理', async () => {
    const chat = vi.fn(async () => ({
      content: JSON.stringify({
        mode: 'layout_prepare',
        confidence: 0.86,
        reasoning: '指定地点、时间范围和轮播单产物，应进入版面草案流程。',
        suggestedParams: {
          userIntent: '静安寺户外直播轮播单',
          targetTimeRange: { start: '14:00:00', end: '15:00:00' },
          semanticLabel: '静安寺户外直播轮播',
          programTypeHint: 'news_magazine',
        },
      }),
    }))
    const classifier = new TaskClassifier({ chat } as never)

    const result = await classifier.classify({
      scheduleState: createScheduleState(),
      userInput: '我准备在静安寺进行户外直播，准备一个14:00到15:00的轮播单',
    })

    expect(chat).toHaveBeenCalledTimes(1)
    const promptText = chat.mock.calls[0]?.[0]?.map((message: { content: string }) => message.content).join('\n')
    expect(promptText).toContain('户外直播轮播单')
    expect(promptText).toContain('轮播单只表示总时长')
    expect(result.mode).toBe('layout_prepare')
    expect(result.suggestedParams?.targetTimeRange).toBeUndefined()
    expect(result.suggestedParams?.rotationDurationSeconds).toBe(60 * 60)
  })

  it('对主题活动节目单这类开放编排话术交给 LLM 映射到已有模式', async () => {
    const chat = vi.fn(async () => ({
      content: JSON.stringify({
        mode: 'layout_prepare',
        confidence: 0.84,
        reasoning: '用户要求生成中午商圈活动预热节目单，应先生成版面草案。',
        suggestedParams: {
          userIntent: '商圈活动预热节目单',
          targetTimeRange: { start: '12:00:00', end: '14:00:00' },
          semanticLabel: '商圈活动预热节目单',
          programTypeHint: 'news_magazine',
        },
      }),
    }))
    const classifier = new TaskClassifier({ chat } as never)

    const result = await classifier.classify({
      scheduleState: createScheduleState(),
      userInput: '帮我做一份中午商圈活动预热的节目单',
    })

    expect(chat).toHaveBeenCalledTimes(1)
    const promptText = chat.mock.calls[0]?.[0]?.map((message: { content: string }) => message.content).join('\n')
    expect(promptText).toContain('开放业务话术')
    expect(result.mode).toBe('layout_prepare')
    expect(result.suggestedParams?.targetTimeRange).toEqual({
      start: '12:00:00',
      end: '14:00:00',
    })
  })

  it.each([
    {
      input: '给我一个14点到15点亲子露营主题',
      range: { start: '14:00:00', end: '15:00:00' },
      intent: '亲子露营主题',
    },
    {
      input: '晚间改成交通服务提醒',
      range: { start: '18:00:00', end: '23:00:00' },
      intent: '交通服务提醒',
    },
    {
      input: '发布会现场直播前后加一点预热视频',
      range: undefined,
      intent: '发布会现场直播预热',
    },
    {
      input: '麻烦来个14-15点静安寺外场直播播单',
      range: undefined,
      intent: '静安寺外场直播播单',
      rotationDurationSeconds: 60 * 60,
    },
    {
      input: '两点到三点做社区服务提醒',
      range: { start: '14:00:00', end: '15:00:00' },
      intent: '社区服务提醒',
    },
    {
      input: '下午以城市服务为主',
      range: { start: '13:00:00', end: '18:00:00' },
      intent: '城市服务',
    },
  ])('开放主题/服务提醒命令不会被过早当成原子编辑: $input', async ({ input, range, intent, rotationDurationSeconds }) => {
    const chat = vi.fn(async () => ({
      content: JSON.stringify({
        mode: 'layout_prepare',
        confidence: 0.84,
        reasoning: '用户在描述开放节目编排需求，应进入版面草案流程。',
        suggestedParams: {
          userIntent: intent,
          targetTimeRange: range,
        },
      }),
    }))
    const classifier = new TaskClassifier({ chat } as never)

    const result = await classifier.classify({
      scheduleState: createScheduleState(),
      userInput: input,
    })

    expect(chat).toHaveBeenCalledTimes(1)
    expect(result.mode).toBe('layout_prepare')
    if (range) {
      expect(result.suggestedParams?.targetTimeRange).toEqual(range)
    }
    if (rotationDurationSeconds) {
      expect(result.suggestedParams?.targetTimeRange).toBeUndefined()
      expect(result.suggestedParams?.rotationDurationSeconds).toBe(rotationDurationSeconds)
    }
  })

  it.each([
    {
      input: '黄金档主打综艺',
      range: { start: '19:00:00', end: '20:00:00' },
    },
    {
      input: '晚间民生新闻多一点',
      range: { start: '18:00:00', end: '23:00:00' },
    },
  ])('固定节目类型偏好表达可由规则快速识别: $input', async ({ input, range }) => {
    const chat = vi.fn()
    const classifier = new TaskClassifier({ chat } as never)

    const result = await classifier.classify({
      scheduleState: createScheduleState(),
      userInput: input,
    })

    expect(chat).toHaveBeenCalled()
    expect(result.mode).toBe('layout_prepare')
    expect(result.suggestedParams?.targetTimeRange).toEqual(range)
  })

  it('LLM 分类缺少 targetTimeRange 时也能把轮播单 14-15 点解析为 1 小时总时长', async () => {
    const chat = vi.fn(async () => ({
      content: JSON.stringify({
        mode: 'layout_prepare',
        confidence: 0.84,
        reasoning: '用户在描述开放节目编排需求，应进入版面草案流程。',
        suggestedParams: {
          userIntent: '静安寺外场直播播单',
        },
      }),
    }))
    const classifier = new TaskClassifier({ chat } as never)

    const result = await classifier.classify({
      scheduleState: createScheduleState(),
      userInput: '麻烦来个14-15点静安寺外场直播播单',
    })

    expect(result.mode).toBe('layout_prepare')
    expect(result.suggestedParams?.targetTimeRange).toBeUndefined()
    expect(result.suggestedParams?.rotationDurationSeconds).toBe(60 * 60)
  })

  it('非常模糊且明显不可执行的排单短语仍然快速澄清', async () => {
    const chat = vi.fn()
    const classifier = new TaskClassifier({ chat } as never)

    const result = await classifier.classify({
      scheduleState: createScheduleState(),
      userInput: '下单排单',
    })

    expect(result.mode).toBe('clarify')
    expect(result.confidence).toBeGreaterThanOrEqual(0.9)
    expect(chat).toHaveBeenCalled()
  })

  it('lets LLM override confident local routing rules', async () => {
    const chat = vi.fn(async () => ({
      content: JSON.stringify({
        mode: 'layout_prepare',
        confidence: 0.88,
        reasoning: '\u004c\u004c\u004d \u7ed3\u5408\u4e0a\u4e0b\u6587\u5224\u65ad\u8fd9\u662f\u5f00\u653e\u7f16\u6392\u9700\u6c42\u3002',
        suggestedParams: {
          userIntent: '\u51c6\u5907\u4e00\u4e2a14:00\u523015:00\u7684\u9759\u5b89\u5bfa\u6237\u5916\u76f4\u64ad\u8f6e\u64ad\u5355',
          targetTimeRange: { start: '14:00:00', end: '15:00:00' },
        },
      }),
    }))
    const classifier = new TaskClassifier({ chat } as never)

    const result = await classifier.classify({
      scheduleState: createScheduleState(),
      userInput: '\u6211\u51c6\u5907\u5728\u9759\u5b89\u5bfa\u8fdb\u884c\u6237\u5916\u76f4\u64ad\uff0c\u51c6\u5907\u4e00\u4e2a14:00\u523015:00\u7684\u8f6e\u64ad\u5355',
    })

    expect(result.mode).toBe('layout_prepare')
    expect(result.suggestedParams?.targetTimeRange).toBeUndefined()
    expect(result.suggestedParams?.rotationDurationSeconds).toBe(60 * 60)
    expect(chat).toHaveBeenCalled()
  })
})
