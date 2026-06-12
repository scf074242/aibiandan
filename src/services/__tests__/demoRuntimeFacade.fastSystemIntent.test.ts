import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ScheduleState } from '@/types/orchestration'

const mockTaskClassify = vi.fn()
const mockLayoutRecognize = vi.fn()

vi.mock('@/services/llm/llmClient', () => ({
  getLLMClient: () => ({}),
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
      reasoning: 'not atomic',
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

vi.mock('@/services/layoutIntentRecognizer', () => ({
  getLayoutIntentRecognizer: () => ({
    recognize: mockLayoutRecognize,
  }),
}))

vi.mock('@/services/scheduleTargetResolver', () => ({
  getScheduleTargetResolver: () => ({
    resolve: vi.fn(async () => ({
      status: 'none',
      candidates: [],
      reasoning: 'unused',
      matchedBy: [],
    })),
  }),
}))

import { DemoRuntimeFacade, type RuntimeScheduleItem } from '@/services/runtime/demoRuntimeFacade'

const createScheduleState = (): ScheduleState => ({
  channelId: 'dragon',
  channelName: '东方卫视',
  date: '2026-03-25',
  isEmpty: false,
  itemCount: 1,
  gapCount: 0,
  hasSelectedTimeRange: false,
})

const createSchedule = (): RuntimeScheduleItem[] => [
  {
    id: 'item-1',
    programCode: 'P100001',
    programName: '看东方',
    startTime: '09:00:00',
    endTime: '10:00:00',
    duration: 3600,
    programType: 'news',
  },
]

describe('DemoRuntimeFacade fast system intent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockTaskClassify.mockResolvedValue({
      mode: 'clarify',
      confidence: 0.1,
      reasoning: 'should not be used',
    })
    mockLayoutRecognize.mockResolvedValue({
      mode: 'clarify',
      confidence: 0.1,
      reasoning: 'should not be used',
      ignoreExistingLayout: false,
    })
  })

  it('明确校验问题命令会快速进入 validate_only，不调用版面识别和任务分类 LLM', async () => {
    const facade = new DemoRuntimeFacade()

    const result = await facade.submitInstruction({
      scheduleState: createScheduleState(),
      userInput: '帮我检查当前节目单有没有问题',
      currentSchedule: createSchedule(),
      history: [],
    })

    expect(result.kind).toBe('message')
    if (result.kind !== 'message') {
      throw new Error('expected message decision')
    }
    expect(result.feedback.processType).toBe('validation')
    expect(mockLayoutRecognize).not.toHaveBeenCalled()
    expect(mockTaskClassify).not.toHaveBeenCalled()
  })

  it.each([
    '帮我体检一下当前播单',
    '查一下这张单子有没有重叠',
    '看看当前编排有无空窗',
    '当前串联单有没有断档风险',
  ])('编排校验口语“%s”会快速进入 validate_only，不调用 LLM', async (userInput) => {
    const facade = new DemoRuntimeFacade()

    const result = await facade.submitInstruction({
      scheduleState: createScheduleState(),
      userInput,
      currentSchedule: createSchedule(),
      history: [],
    })

    expect(result.kind).toBe('message')
    if (result.kind !== 'message') {
      throw new Error('expected message decision')
    }
    expect(result.feedback.processType).toBe('validation')
    expect(mockLayoutRecognize).not.toHaveBeenCalled()
    expect(mockTaskClassify).not.toHaveBeenCalled()
  })

  it('明确修复诉求会先快速进入问题分析，不调用版面识别和任务分类 LLM', async () => {
    const facade = new DemoRuntimeFacade()

    const result = await facade.submitInstruction({
      scheduleState: createScheduleState(),
      userInput: '把当前编排的问题自动修复一下',
      currentSchedule: createSchedule(),
      history: [],
    })

    expect(result.kind).toBe('message')
    if (result.kind !== 'message') {
      throw new Error('expected message decision')
    }
    expect(result.feedback.processType).toBe('validation')
    expect(result.feedback.explanation).toContain('修复')
    expect(mockLayoutRecognize).not.toHaveBeenCalled()
    expect(mockTaskClassify).not.toHaveBeenCalled()
  })

  it.each([
    '修掉当前播单里的冲突',
    '把这张单子的重叠问题处理掉',
    '当前编排有断档，先修一下',
  ])('编排修复口语“%s”会先快速进入问题分析，不调用 LLM', async (userInput) => {
    const facade = new DemoRuntimeFacade()

    const result = await facade.submitInstruction({
      scheduleState: createScheduleState(),
      userInput,
      currentSchedule: createSchedule(),
      history: [],
    })

    expect(result.kind).toBe('message')
    if (result.kind !== 'message') {
      throw new Error('expected message decision')
    }
    expect(result.feedback.processType).toBe('validation')
    expect(result.feedback.explanation).toContain('修复')
    expect(mockLayoutRecognize).not.toHaveBeenCalled()
    expect(mockTaskClassify).not.toHaveBeenCalled()
  })

  it.each([
    '补齐当前空窗',
    '请把当前空窗补掉',
  ])('补排命令“%s”不会被快速校验通道抢走', async (userInput) => {
    const facade = new DemoRuntimeFacade()

    const result = await facade.submitInstruction({
      scheduleState: createScheduleState(),
      userInput,
      currentSchedule: createSchedule(),
      history: [],
    })

    expect(result.kind).toBe('message')
    if (result.kind !== 'message') {
      throw new Error('expected message decision')
    }
    expect(result.feedback.processType).not.toBe('validation')
    expect(mockLayoutRecognize).toHaveBeenCalled()
  })

  it('明确编排分析诉求会快速进入 layout_analysis，不调用版面识别和任务分类 LLM', async () => {
    const facade = new DemoRuntimeFacade()

    const result = await facade.submitInstruction({
      scheduleState: createScheduleState(),
      userInput: '请分析当前版面编排，给我一份编辑视角的业务分析报告',
      currentSchedule: createSchedule(),
      history: [],
    })

    expect(result.kind).toBe('message')
    if (result.kind !== 'message') {
      throw new Error('expected message decision')
    }
    expect(result.feedback.processType).toBe('planning')
    expect(result.feedback.processTypeLabel).toBe('版面分析')
    expect(result.feedback.details?.summaryKind).toBe('layout_analysis')
    expect(mockLayoutRecognize).not.toHaveBeenCalled()
    expect(mockTaskClassify).not.toHaveBeenCalled()
  })
})
