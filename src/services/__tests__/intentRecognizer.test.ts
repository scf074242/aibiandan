import { describe, expect, it, vi } from 'vitest'

import { buildDialogueContext } from '@/services/dialogueContext'
import { IntentRecognizer, INTENT_RECOGNIZER_PROMPT_VERSION } from '@/services/intentRecognizer'

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
    id: 'item-1000',
    programCode: 'P100001',
    programName: '东方新闻',
    startTime: '10:00:00',
    endTime: '10:30:00',
    duration: 1800,
    programType: 'news',
  },
]

describe('IntentRecognizer', () => {
  it('uses the LLM result for oral atomic commands instead of local keyword rules', async () => {
    const chat = vi.fn(async () => {
      return {
        content: '{"type":"insert","confidence":0.93,"reasoning":"用户要在10点加一档东方新闻。"}',
      }
    })
    const recognizer = new IntentRecognizer({ chat } as never)

    const result = await recognizer.recognize(
      buildDialogueContext({
        scheduleState: createScheduleState(),
        userInput: '10点加一档东方新闻',
        currentSchedule,
      }),
    )

    expect(result.type).toBe('insert')
    expect(result.confidence).toBeGreaterThan(0.9)
    expect(chat).toHaveBeenCalled()
  })

  it('does not fall back to local keyword intent when the model is unavailable', async () => {
    const chat = vi.fn(async () => {
      throw new Error('mock llm unavailable')
    })
    const recognizer = new IntentRecognizer({ chat } as never)

    const result = await recognizer.recognize(
      buildDialogueContext({
        scheduleState: createScheduleState(),
        userInput: '10点加一档东方新闻',
        currentSchedule,
      }),
    )

    expect(result.type).toBe('clarify')
    expect(result.confidence).toBe(0)
    expect(result.reasoning).toContain('停止本地关键词兜底')
  })

  it('不会把开放播单生成话术误判成原子插入', async () => {
    const recognizer = new IntentRecognizer({
      chat: vi.fn(async () => ({
        content: '{"type":"unsupported","confidence":0.4,"reasoning":"not atomic"}',
      })),
    } as never)

    const result = await recognizer.recognize(
      buildDialogueContext({
        scheduleState: createScheduleState(),
        userInput: '麻烦来个14-15点静安寺外场直播播单',
        currentSchedule,
      }),
    )

    expect(result.type).not.toBe('insert')
  })

  it('lets LLM override high-confidence local atomic rules', async () => {
    const chat = vi.fn(async () => ({
      content: '{"type":"clarify","confidence":0.82,"reasoning":"需要确认删除对象"}',
    }))
    const recognizer = new IntentRecognizer({ chat } as never)

    const result = await recognizer.recognize(
      buildDialogueContext({
        scheduleState: createScheduleState(),
        userInput: '删除9点的节目',
        currentSchedule: [
          {
            id: 'item-0900',
            programCode: 'P0900',
            programName: '看东方 特别策划：申城更新',
            startTime: '09:00:00',
            endTime: '09:30:00',
            duration: 1800,
            programType: 'news_magazine',
          },
        ],
      }),
    )

    expect(result.type).toBe('clarify')
    expect(result.reasoning).toContain('确认')
    expect(chat).toHaveBeenCalled()
  })
})

describe('IntentRecognizer promptVersion 透传', () => {
  /**
   * case c9-intent-recognizer-passes-version
   * - expectedDecision: recognize 调用 LLM 时透传 promptVersion
   * - mustNotHappen: options 缺失 promptVersion
   * - verification: chat.mock.calls[0][1] 含 promptVersion: 'v1.0'
   */
  it('c9-intent-recognizer-passes-version: recognize 透传 promptVersion', async () => {
    const chat = vi.fn(async () => ({
      content: '{"type":"insert","confidence":0.9,"reasoning":"测试"}',
    }))
    const recognizer = new IntentRecognizer({ chat } as never)

    await recognizer.recognize(
      buildDialogueContext({
        scheduleState: createScheduleState(),
        userInput: '10点加一档东方新闻',
        currentSchedule,
      }),
    )

    expect(chat).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        promptVersion: INTENT_RECOGNIZER_PROMPT_VERSION,
        traceLabel: 'atomic_intent',
      }),
    )
  })
})
