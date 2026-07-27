import { describe, expect, it, vi } from 'vitest'

import { buildDialogueContext } from '@/services/dialogueContext'
import { ParamExtractor, PARAM_EXTRACTOR_PROMPT_VERSION } from '@/services/paramExtractor'

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

  it('LLM 返回坏结果时不再回退到本地规则抽参', async () => {
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

    expect(result).toBeNull()
  })

  it('LLM 返回有效移动参数时只做时间格式和偏移量规范化', async () => {
    const extractor = new ParamExtractor({
      chat: vi.fn(async () => ({
        content: '{"targetTime":"9:00","direction":"forward","offsetSeconds":1800}',
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

  it('LLM 返回有效插入参数时采用模型结构并保留时长换算', async () => {
    const chat = vi.fn(async () => ({
      content: '{"targetTime":"9:00","rawProgramText":"30分钟宣传片","semanticLabel":"城市宣传片","programTypeHint":"short_clip"}',
    }))
    const extractor = new ParamExtractor({ chat } as never)

    const result = await extractor.extractInsertParams(
      buildDialogueContext({
        scheduleState: createScheduleState(),
        userInput: '9点插入30分钟宣传片',
        currentSchedule: [],
      }),
    )

    expect(result).toEqual({
      targetTime: '09:00:00',
      programName: '宣传片',
      rawProgramText: '宣传片',
      semanticLabel: '城市宣传片',
      programTypeHint: 'short_clip',
      expectedDurationSeconds: 1800,
    })
    expect(chat).toHaveBeenCalled()
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
    expect(chat).toHaveBeenCalled()
  })

  it('accepts LLM extracted target time for contextual follow-up commands', async () => {
    const chat = vi.fn(async () => ({
      content: '{"targetTime":"09:00:00","direction":"forward","offsetSeconds":600}',
    }))
    const extractor = new ParamExtractor({ chat } as never)

    const result = await extractor.extractMoveParams(
      buildDialogueContext({
        scheduleState: createScheduleState(),
        userInput: '\u628a\u5b83\u5f80\u540e\u79fb\u52a810\u5206\u949f',
        currentSchedule,
      }),
    )

    expect(result).toEqual({
      targetTime: '09:00:00',
      direction: 'forward',
      offsetSeconds: 600,
    })
    expect(chat).toHaveBeenCalled()
  })
})

describe('ParamExtractor promptVersion 透传', () => {
  /**
   * case c10-param-extractor-passes-version
   * - expectedDecision: 4 个 extract 方法调用 LLM 时均透传 promptVersion
   * - mustNotHappen: 任一 options 缺失 promptVersion
   * - verification: 每次调用 chat.mock.calls[N][1] 含 promptVersion: 'v1.0'
   */
  it('c10-param-extractor-insert-passes-version: extractInsertParams 透传 promptVersion', async () => {
    const chat = vi.fn(async () => ({
      content: '{"targetTime":"9:00","programName":"东方新闻","rawProgramText":"东方新闻","semanticLabel":"新闻","programTypeHint":"news","expectedDurationSeconds":1800}',
    }))
    const extractor = new ParamExtractor({ chat } as never)

    await extractor.extractInsertParams(
      buildDialogueContext({
        scheduleState: createScheduleState(),
        userInput: '9点插入东方新闻',
        currentSchedule: [],
      }),
    )

    expect(chat).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        promptVersion: PARAM_EXTRACTOR_PROMPT_VERSION,
        traceLabel: 'atomic_insert_params',
      }),
    )
  })

  it('c10-param-extractor-move-passes-version: extractMoveParams 透传 promptVersion', async () => {
    const chat = vi.fn(async () => ({
      content: '{"targetTime":"9:00","direction":"forward","offsetSeconds":1800}',
    }))
    const extractor = new ParamExtractor({ chat } as never)

    await extractor.extractMoveParams(
      buildDialogueContext({
        scheduleState: createScheduleState(),
        userInput: '9点后移30分钟',
        currentSchedule,
      }),
    )

    expect(chat).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        promptVersion: PARAM_EXTRACTOR_PROMPT_VERSION,
        traceLabel: 'atomic_move_params',
      }),
    )
  })

  it('c10-param-extractor-delete-passes-version: extractDeleteParams 透传 promptVersion', async () => {
    const chat = vi.fn(async () => ({
      content: '{"targetTime":"9:00","programName":"看东方"}',
    }))
    const extractor = new ParamExtractor({ chat } as never)

    await extractor.extractDeleteParams(
      buildDialogueContext({
        scheduleState: createScheduleState(),
        userInput: '删除9点的节目',
        currentSchedule,
      }),
    )

    expect(chat).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        promptVersion: PARAM_EXTRACTOR_PROMPT_VERSION,
        traceLabel: 'atomic_delete_params',
      }),
    )
  })

  it('c10-param-extractor-replace-passes-version: extractReplaceParams 透传 promptVersion', async () => {
    const chat = vi.fn(async () => ({
      content: '{"targetTime":"9:00","replacementProgramName":"午间30"}',
    }))
    const extractor = new ParamExtractor({ chat } as never)

    await extractor.extractReplaceParams(
      buildDialogueContext({
        scheduleState: createScheduleState(),
        userInput: '把9点的节目换成午间30',
        currentSchedule,
      }),
    )

    expect(chat).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        promptVersion: PARAM_EXTRACTOR_PROMPT_VERSION,
        traceLabel: 'atomic_replace_params',
      }),
    )
  })
})
