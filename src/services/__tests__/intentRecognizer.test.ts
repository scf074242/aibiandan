import { describe, expect, it, vi } from 'vitest'

import { buildDialogueContext } from '@/services/dialogueContext'
import { IntentRecognizer } from '@/services/intentRecognizer'

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
  it.each([
    ['10点加一档东方新闻', 'insert'],
    ['10点放个纪录片', 'insert'],
    ['10点前垫一条预告', 'insert'],
    ['10点后放一段现场导视', 'insert'],
    ['9点排入东方新闻', 'insert'],
    ['9点排个纪录片', 'insert'],
    ['9点插播东方新闻', 'insert'],
    ['9点加播一档纪录片', 'insert'],
    ['10点有没有适合的新闻节目', 'insert'],
    ['10点帮我推荐几个纪录片候选', 'insert'],
    ['给我找几条健康节目', 'insert'],
    ['撤掉10点那条节目', 'delete'],
    ['撤下10点那条节目', 'delete'],
    ['把10点节目拿下', 'delete'],
    ['10点那档下掉', 'delete'],
    ['拿掉《东方新闻》', 'delete'],
    ['10点那档往后挪15分钟', 'move'],
    ['把10点节目推迟30分钟', 'move'],
    ['10点那档推后1小时', 'move'],
    ['10点节目延迟15分钟', 'move'],
    ['把10点节目顺一下', 'move'],
    ['10点那条换掉成东方新闻', 'replace'],
    ['10点那条换成一档纪录片', 'replace'],
    ['把10点节目改成更适合午间的健康节目', 'replace'],
    ['9点改播东方新闻', 'replace'],
    ['9点换播一档纪录片', 'replace'],
  ] as const)('识别落表后的口语化原子命令: %s', async (input, expectedType) => {
    const chat = vi.fn(async () => {
      throw new Error('mock llm unavailable')
    })
    const recognizer = new IntentRecognizer({ chat } as never)

    const result = await recognizer.recognize(
      buildDialogueContext({
        scheduleState: createScheduleState(),
        userInput: input,
        currentSchedule,
      }),
    )

    expect(result.type).toBe(expectedType)
    expect(result.confidence).toBeGreaterThan(0.9)
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
