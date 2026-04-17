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
})
