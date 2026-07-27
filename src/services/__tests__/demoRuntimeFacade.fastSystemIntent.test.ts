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
  ])('补排命令“%s”不会被快速校验通道抢走，会直接进入正式补排', async (userInput) => {
    const facade = new DemoRuntimeFacade()

    const result = await facade.submitInstruction({
      scheduleState: createScheduleState(),
      userInput,
      currentSchedule: createSchedule(),
      history: [],
    })

    expect(result.kind).toBe('orchestration')
    if (result.kind !== 'orchestration') {
      throw new Error('expected orchestration decision')
    }
    expect(result.orchestrationRequest.mode).toBe('partial_generate')
    expect(result.feedback.processType).toBe('planning')
    expect(mockLayoutRecognize).not.toHaveBeenCalled()
    expect(mockTaskClassify).not.toHaveBeenCalled()
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

  /**
   * A9 回归 case：buildClarifyFeedback 不再用本地正则猜测"你像是在调整具体节目"或"在描述编排需求"，
   * 而是返回中性"我还没稳定理解"暴露失败。
   *
   * 直接测试私有方法 buildClarifyFeedback，避免完整 submitInstruction 链路被 Agent Core 等前置路径拦截。
   *
   * 修复前行为：用本地正则猜测用户意图（"这句话更像是在调整具体节目"），违反 LLM-only 原则
   * 修复后行为：诚实说明"我还没稳定理解"，提供示例引导重试或补充
   */
  it('buildClarifyFeedback 返回中性澄清，不本地猜测用户意图', async () => {
    const facade = new DemoRuntimeFacade() as unknown as {
      buildClarifyFeedback: (input: { userInput: string }, explanation?: string) => { content: string }
    }

    // 用一个含"删除"关键词的输入，验证旧逻辑会猜测"更像是在调整具体节目"但新逻辑不会
    const result = facade.buildClarifyFeedback({ userInput: '删掉那个东西' }, 'classifier未识别')

    // 不应包含本地正则猜测的意图描述
    expect(result.content).not.toContain('更像是在调整具体节目')
    expect(result.content).not.toContain('更像是在描述编排需求')
    // 应包含中性暴露失败的引导
    expect(result.content).toContain('我还没稳定理解')
    // 仍提供示例引导用户重试
    expect(result.content).toMatch(/下午改成新闻栏目|重试|换一种说法/)
  })
})
