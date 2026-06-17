import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ChatMessage } from '@/types/llm'
import type { ScheduleState } from '@/types/orchestration'

const mockChat = vi.fn()
const mockTaskClassify = vi.fn(async () => ({
  mode: 'clarify',
  confidence: 0.1,
  reasoning: 'unused',
}))

vi.mock('@/services/llm/llmClient', () => ({
  getLLMClient: () => ({
    chat: mockChat,
  }),
}))

vi.mock('@/services/llm/taskClassifier', () => ({
  getTaskClassifier: () => ({
    classify: mockTaskClassify,
  }),
}))

vi.mock('@/services/intentRecognizer', () => ({
  getIntentRecognizer: () => ({
    recognize: vi.fn(async () => ({
      type: 'unsupported',
      confidence: 0.1,
      reasoning: 'not an atomic command',
    })),
  }),
}))

vi.mock('@/services/paramExtractor', () => ({
  getParamExtractor: () => ({
    extractInsertParams: vi.fn(async () => null),
    extractDeleteParams: vi.fn(async () => null),
    extractMoveParams: vi.fn(async () => null),
    extractReplaceParams: vi.fn(async () => null),
  }),
}))

vi.mock('@/services/layoutDraftFeasibilityService', () => ({
  getLayoutDraftFeasibilityService: () => ({
    previewFeasibility: vi.fn(() => ({
      ok: true,
      summary: {
        readyCount: 1,
        warningCount: 0,
        blockedCount: 0,
      },
      segments: [],
    })),
  }),
}))

import { DemoRuntimeFacade } from '@/services/runtime/demoRuntimeFacade'

interface OpenSchedulingCase {
  userInput: string
  label: string
  programType: string
  range: { start: string; end: string }
}

const openSchedulingCases: OpenSchedulingCase[] = [
  {
    userInput: '明天下午三点到四点安排发布会直播',
    label: '发布会直播',
    programType: 'news_magazine',
    range: { start: '15:00:00', end: '16:00:00' },
  },
  {
    userInput: '今晚赛事直播前后帮我安排预热节目',
    label: '赛事直播预热',
    programType: 'news_magazine',
    range: { start: '18:00:00', end: '23:00:00' },
  },
  {
    userInput: '给外滩跨年活动准备一份轮播单',
    label: '外滩跨年活动轮播',
    programType: 'news_magazine',
    range: { start: '18:00:00', end: '23:00:00' },
  },
  {
    userInput: '我准备在静安寺进行户外直播，准备一个14:00到15:00的轮播单',
    label: '静安寺户外直播轮播',
    programType: 'news_magazine',
    range: { start: '14:00:00', end: '15:00:00' },
  },
  {
    userInput: '下午上点新闻',
    label: '新闻',
    programType: 'news',
    range: { start: '13:00:00', end: '18:00:00' },
  },
  {
    userInput: '发布会开播前垫一点现场导视',
    label: '现场导视',
    programType: 'news_magazine',
    range: { start: '18:00:00', end: '23:00:00' },
  },
  {
    userInput: '14点30分到15点做发布会直播',
    label: '发布会直播',
    programType: 'news_magazine',
    range: { start: '14:30:00', end: '15:00:00' },
  },
  {
    userInput: '两点二十到三点安排社区服务提醒',
    label: '社区服务提醒',
    programType: 'news_magazine',
    range: { start: '14:20:00', end: '15:00:00' },
  },
  {
    userInput: '两点二十开始排40分钟社区服务提醒',
    label: '社区服务提醒',
    programType: 'news_magazine',
    range: { start: '14:20:00', end: '15:00:00' },
  },
  {
    userInput: '做一小时静安寺户外直播，14点开始',
    label: '静安寺户外直播轮播',
    programType: 'news_magazine',
    range: { start: '14:00:00', end: '15:00:00' },
  },
  {
    userInput: '先来40分钟社区服务提醒，下午两点二十起播',
    label: '社区服务提醒',
    programType: 'news_magazine',
    range: { start: '14:20:00', end: '15:00:00' },
  },
  {
    userInput: '从14点开始到15点结束安排静安寺外场直播',
    label: '静安寺户外直播轮播',
    programType: 'news_magazine',
    range: { start: '14:00:00', end: '15:00:00' },
  },
  {
    userInput: '麻烦来个14-15点静安寺外场直播播单',
    label: '静安寺户外直播轮播',
    programType: 'news_magazine',
    range: { start: '14:00:00', end: '15:00:00' },
  },
  {
    userInput: '下午两点二十起播，三点结束，安排发布会直播',
    label: '发布会直播',
    programType: 'news_magazine',
    range: { start: '14:20:00', end: '15:00:00' },
  },
  {
    userInput: '两点一刻到三点做社区服务提醒',
    label: '社区服务提醒',
    programType: 'news_magazine',
    range: { start: '14:15:00', end: '15:00:00' },
  },
  {
    userInput: '下午两点三刻到三点安排发布会快讯',
    label: '发布会快讯',
    programType: 'news',
    range: { start: '14:45:00', end: '15:00:00' },
  },
  {
    userInput: '14点开始排一个半小时纪录片',
    label: '纪录片',
    programType: 'documentary',
    range: { start: '14:00:00', end: '15:30:00' },
  },
  {
    userInput: '下午两点开始排一小时半发布会直播',
    label: '发布会直播',
    programType: 'news_magazine',
    range: { start: '14:00:00', end: '15:30:00' },
  },
  {
    userInput: '先来1个半小时社区服务提醒，下午两点起播',
    label: '社区服务提醒',
    programType: 'news_magazine',
    range: { start: '14:00:00', end: '15:30:00' },
  },
  {
    userInput: '14点开始排一刻钟导视',
    label: '导视',
    programType: 'news_magazine',
    range: { start: '14:00:00', end: '14:15:00' },
  },
  {
    userInput: '先来三刻钟发布会预热，下午两点起播',
    label: '发布会预热',
    programType: 'news_magazine',
    range: { start: '14:00:00', end: '14:45:00' },
  },
  {
    userInput: '14点左右做一版直播',
    label: '直播',
    programType: 'news_magazine',
    range: { start: '14:00:00', end: '15:00:00' },
  },
  {
    userInput: '两点前后安排社区服务提醒',
    label: '社区服务提醒',
    programType: 'news_magazine',
    range: { start: '14:00:00', end: '15:00:00' },
  },
  {
    userInput: '下午两点附近来一段发布会快讯',
    label: '发布会快讯',
    programType: 'news',
    range: { start: '14:00:00', end: '15:00:00' },
  },
  {
    userInput: '下午两点以后安排发布会直播',
    label: '发布会直播',
    programType: 'news_magazine',
    range: { start: '14:00:00', end: '15:00:00' },
  },
  {
    userInput: '14点之后来一段进博会快讯',
    label: '进博会快讯',
    programType: 'news',
    range: { start: '14:00:00', end: '15:00:00' },
  },
  {
    userInput: '从两点往后做社区服务提醒',
    label: '社区服务提醒',
    programType: 'news_magazine',
    range: { start: '14:00:00', end: '15:00:00' },
  },
]

const createScheduleState = (): ScheduleState => ({
  channelId: 'dragon',
  channelName: '东方卫视',
  date: '2026-03-25',
  isEmpty: true,
  itemCount: 0,
  gapCount: 1,
  hasSelectedTimeRange: false,
})

const findCaseFromPrompt = (messages: ChatMessage[]): OpenSchedulingCase => {
  const prompt = messages.map((message) => message.content).join('\n')
  const matched = openSchedulingCases.find((item) => prompt.includes(item.userInput))
  if (!matched) {
    throw new Error(`unexpected prompt: ${prompt.slice(0, 160)}`)
  }
  return matched
}

const buildLayoutRecognitionResponse = (item: OpenSchedulingCase) => ({
  content: JSON.stringify({
    mode: 'layout_prepare',
    confidence: 0.88,
    reasoning: 'LLM 将开放节目编排话术映射为待确认版面草案。',
    ignoreExistingLayout: true,
    targetTimeRange: item.range,
    semanticLabel: item.label,
    programTypeHint: item.programType,
  }),
})

const buildLayoutSpecResponse = (item: OpenSchedulingCase) => ({
  content: JSON.stringify({
    coverage: item.range,
    segments: [
      {
        id: 'draft-segment-open-scheduling',
        label: item.label,
        startTime: item.range.start,
        endTime: item.range.end,
        programType: item.programType,
        queryHints: [item.label, '直播', '活动', '预热'],
        sequential: false,
      },
    ],
  }),
})

describe('DemoRuntimeFacade open scheduling LLM fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockChat.mockImplementation(async (messages: ChatMessage[]) => {
      const prompt = messages.map((message) => message.content).join('\n')
      const item = findCaseFromPrompt(messages)
      if (prompt.includes('版面意图识别器')) {
        return buildLayoutRecognitionResponse(item)
      }
      if (prompt.includes('版面草案生成器')) {
        return buildLayoutSpecResponse(item)
      }
      throw new Error(`unexpected LLM prompt: ${prompt.slice(0, 160)}`)
    })
  })

  it.each(openSchedulingCases)('将开放编排话术兜底为版面草案: $userInput', async ({ userInput, label, programType, range }) => {
    const facade = new DemoRuntimeFacade()

    const result = await facade.submitInstruction({
      scheduleState: createScheduleState(),
      userInput,
      currentSchedule: [],
      history: [],
    })

    expect(result.kind).toBe('layout_draft')
    if (result.kind !== 'layout_draft') {
      throw new Error('expected layout_draft decision')
    }

    expect(result.draft.source).toBe('generated')
    expect(result.draft.coverage).toEqual(range)
    expect(result.draft.layoutReference.slots).toHaveLength(1)
    expect(result.draft.columns[0]?.semanticLabel).toBe(label)
    expect(result.draft.columns[0]?.defaultProgramType).toBe(programType)
    if (userInput.includes('播单')) {
      expect(result.draft.strategyProfile?.kind).toBe('carousel')
      expect(result.draft.strategyProfile?.requiresPreviousSchedule).toBe(false)
      expect(result.draft.strategyProfile?.selectionPriority).toBe('content_match')
    }
    expect(mockTaskClassify).not.toHaveBeenCalled()
  })
})
