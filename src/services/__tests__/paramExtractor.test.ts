import { describe, expect, it, vi } from 'vitest'

import { buildDialogueContext } from '@/services/dialogueContext'
import { ParamExtractor } from '@/services/paramExtractor'

const createScheduleState = () => ({
  channelId: 'dragon',
  channelName: '东方卫视',
  date: '2026-03-25',
  isEmpty: false,
  itemCount: 2,
  gapCount: 0,
  hasSelectedTimeRange: false,
})

const currentSchedule = [
  {
    id: 'item-0900',
    programCode: 'P100001',
    programName: '看东方',
    startTime: '09:00:00',
    endTime: '10:00:00',
    duration: 3600,
    programType: 'news',
  },
]

describe('ParamExtractor', () => {
  it('会把中文时间点写入对话上下文的附近节目提示', () => {
    const context = buildDialogueContext({
      scheduleState: createScheduleState(),
      userInput: '两点半那档节目后移五分钟',
      currentSchedule: [
        ...currentSchedule,
        {
          id: 'item-1430',
          programCode: 'P200001',
          programName: '午后新闻',
          startTime: '14:30:00',
          endTime: '15:00:00',
          duration: 1800,
          programType: 'news',
        },
      ],
    })

    expect(context.targetTimeHints).toEqual(['14:30:00'])
    expect(context.nearbyScheduleSummary).toContain('14:30:00-15:00:00 午后新闻')
  })

  it('会在 LLM 返回坏结果时回退到规则提取，并识别补充说明中的删除时间', async () => {
    const extractor = new ParamExtractor({
      chat: vi.fn(async () => ({
        content: 'not-json',
      })),
    } as never)

    const result = await extractor.extractDeleteParams(
      buildDialogueContext({
        scheduleState: createScheduleState(),
        userInput: '删除节目，补充说明：9点',
        currentSchedule,
      }),
    )

    expect(result).toEqual({
      targetTime: '09:00:00',
      programName: undefined,
    })
  })

  it('会把补充说明样式的移动补参解析成统一 slot patch', async () => {
    const extractor = new ParamExtractor({
      chat: vi.fn(async () => ({
        content: '{"type":"invalid"}',
      })),
    } as never)

    const result = await extractor.extractMoveParams(
      buildDialogueContext({
        scheduleState: createScheduleState(),
        userInput: '把9点那条节目，补充说明：后移30分钟',
        currentSchedule,
      }),
    )

    expect(result).toEqual({
      targetTime: '09:00:00',
      direction: 'forward',
      offsetSeconds: 1800,
    })
  })

  it('不会在 LLM 返回非法时间时偷偷回落到 09:00:00', async () => {
    const extractor = new ParamExtractor({
      chat: vi.fn(async () => ({
        content: '{"targetTime":"稍后","programName":"看东方"}',
      })),
    } as never)

    const result = await extractor.extractInsertParams(
      buildDialogueContext({
        scheduleState: createScheduleState(),
        userInput: '插入',
        currentSchedule: [],
      }),
    )

    expect(result).toBeNull()
  })

  it('能识别更口语化的插入表达', async () => {
    const chat = vi.fn(async () => ({
      content: 'should-not-be-used',
    }))
    const extractor = new ParamExtractor({ chat } as never)

    const result = await extractor.extractInsertParams(
      buildDialogueContext({
        scheduleState: createScheduleState(),
        userInput: '9点来个看东方',
        currentSchedule: [],
      }),
    )

    expect(result).toEqual({
      targetTime: '09:00:00',
      programName: '看东方',
      rawProgramText: '看东方',
      semanticLabel: undefined,
      programTypeHint: undefined,
    })
    expect(chat).not.toHaveBeenCalled()
  })

  it.each([
    ['10点加一档东方新闻', {
      targetTime: '10:00:00',
      programName: '东方新闻',
      rawProgramText: '东方新闻',
      semanticLabel: '新闻',
      programTypeHint: 'news',
    }],
    ['10点放个纪录片', {
      targetTime: '10:00:00',
      programName: undefined,
      rawProgramText: '纪录片',
      semanticLabel: '纪实',
      programTypeHint: 'documentary',
    }],
    ['10点前垫一条预告', {
      targetTime: '10:00:00',
      programName: undefined,
      rawProgramText: '预告',
      semanticLabel: '资讯',
      programTypeHint: 'news_magazine',
    }],
    ['10点后放一段现场导视', {
      targetTime: '10:00:00',
      programName: undefined,
      rawProgramText: '现场导视',
      semanticLabel: '资讯',
      programTypeHint: 'news_magazine',
    }],
    ['10点有没有适合的新闻节目', {
      targetTime: '10:00:00',
      programName: undefined,
      rawProgramText: '新闻节目',
      semanticLabel: '新闻',
      programTypeHint: 'news',
    }],
    ['10点帮我推荐几个纪录片候选', {
      targetTime: '10:00:00',
      programName: undefined,
      rawProgramText: '纪录片',
      semanticLabel: '纪实',
      programTypeHint: 'documentary',
    }],
  ])('能从口语化插入命令提取时间和节目偏好: %s', async (input, expected) => {
    const chat = vi.fn(async () => ({
      content: 'should-not-be-used',
    }))
    const extractor = new ParamExtractor({ chat } as never)

    const result = await extractor.extractInsertParams(
      buildDialogueContext({
        scheduleState: createScheduleState(),
        userInput: input,
        currentSchedule,
      }),
    )

    expect(result).toEqual(expected)
    expect(chat).not.toHaveBeenCalled()
  })

  it('能从撤掉这类删除表达中提取目标时间', async () => {
    const extractor = new ParamExtractor({
      chat: vi.fn(async () => ({
        content: 'should-not-be-used',
      })),
    } as never)

    const result = await extractor.extractDeleteParams(
      buildDialogueContext({
        scheduleState: createScheduleState(),
        userInput: '撤掉10点那条节目',
        currentSchedule,
      }),
    )

    expect(result).toEqual({
      targetTime: '10:00:00',
      programName: undefined,
    })
  })

  it('能从往后挪这类移动表达中提取目标时间和偏移量', async () => {
    const extractor = new ParamExtractor({
      chat: vi.fn(async () => ({
        content: 'should-not-be-used',
      })),
    } as never)

    const result = await extractor.extractMoveParams(
      buildDialogueContext({
        scheduleState: createScheduleState(),
        userInput: '10点那档往后挪15分钟',
        currentSchedule,
      }),
    )

    expect(result).toEqual({
      targetTime: '10:00:00',
      direction: 'forward',
      offsetSeconds: 900,
    })
  })

  it.each([
    ['10点那档往后挪十五分钟', '10:00:00', 'forward', 900],
    ['10点那档提前十分钟', '10:00:00', 'backward', 600],
    ['10点那档后移半个小时', '10:00:00', 'forward', 1800],
    ['九点那档往后挪十五分钟', '09:00:00', 'forward', 900],
    ['两点半那档提前十分钟', '14:30:00', 'backward', 600],
  ])('能从中文数字移动表达中提取目标时间和偏移量: %s', async (input, targetTime, direction, offsetSeconds) => {
    const extractor = new ParamExtractor({
      chat: vi.fn(async () => ({
        content: 'should-not-be-used',
      })),
    } as never)

    const result = await extractor.extractMoveParams(
      buildDialogueContext({
        scheduleState: createScheduleState(),
        userInput: input,
        currentSchedule,
      }),
    )

    expect(result).toEqual({
      targetTime,
      direction,
      offsetSeconds,
    })
  })

  it.each([
    ['10点那条换成一档纪录片', {
      targetTime: '10:00:00',
      programName: '纪录片',
    }],
    ['把10点节目改成更适合午间的健康节目', {
      targetTime: '10:00:00',
      programName: '健康节目',
    }],
  ])('能从类别替换命令提取目标时间和替换偏好: %s', async (input, expected) => {
    const extractor = new ParamExtractor({
      chat: vi.fn(async () => ({
        content: 'should-not-be-used',
      })),
    } as never)

    const result = await extractor.extractReplaceParams(
      buildDialogueContext({
        scheduleState: createScheduleState(),
        userInput: input,
        currentSchedule,
      }),
    )

    expect(result).toEqual(expected)
  })

  it('用户没提时间时不会让 LLM 猜一个 09:00:00 出来', async () => {
    const chat = vi.fn(async () => ({
      content: '{"targetTime":"09:00:00","programName":"看东方"}',
    }))
    const extractor = new ParamExtractor({ chat } as never)

    const result = await extractor.extractInsertParams(
      buildDialogueContext({
        scheduleState: createScheduleState(),
        userInput: '插入看东方',
        currentSchedule,
      }),
    )

    expect(result).toBeNull()
    expect(chat).not.toHaveBeenCalled()
  })
})
