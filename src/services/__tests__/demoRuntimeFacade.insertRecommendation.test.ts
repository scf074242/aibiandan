import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ScheduleState } from '@/types/orchestration'
import { getAtomicCapabilities, resetAtomicCapabilities } from '@/services/atomicCapabilities'
import { resetCandidateService } from '@/services/candidateService'

const mockIntentRecognize = vi.fn()
const mockExtractInsertParams = vi.fn()
const mockLayoutRecognize = vi.fn()

vi.mock('@/services/llm/llmClient', () => ({
  getLLMClient: () => ({}),
}))

vi.mock('@/services/llm/taskClassifier', () => ({
  getTaskClassifier: () => ({
    classify: vi.fn(async () => ({
      mode: 'clarify',
      confidence: 0.1,
      reasoning: 'unused',
    })),
  }),
}))

vi.mock('@/services/intentRecognizer', () => ({
  getIntentRecognizer: () => ({
    recognize: mockIntentRecognize,
  }),
}))

vi.mock('@/services/paramExtractor', () => ({
  getParamExtractor: () => ({
    extractInsertParams: mockExtractInsertParams,
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
    resolve: vi.fn(),
  }),
}))

import { DemoRuntimeFacade, type RuntimeScheduleItem } from '@/services/runtime/demoRuntimeFacade'

const createScheduleState = (overrides: Partial<ScheduleState> = {}): ScheduleState => ({
  channelId: 'dragon',
  channelName: '东方卫视',
  date: '2026-03-25',
  isEmpty: true,
  itemCount: 0,
  gapCount: 0,
  hasSelectedTimeRange: false,
  ...overrides,
})

const createCurrentItem = (overrides: Partial<RuntimeScheduleItem> = {}): RuntimeScheduleItem => ({
  id: 'item-0900',
  programCode: 'P-KDF-0900',
  programName: '看东方',
  startTime: '09:00:00',
  endTime: '10:00:00',
  duration: 3600,
  programType: 'news_magazine',
  ...overrides,
})

describe('DemoRuntimeFacade insert recommendation', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    resetCandidateService()
    resetAtomicCapabilities()
    await getAtomicCapabilities().clearAll()
    mockLayoutRecognize.mockResolvedValue({
      mode: 'clarify',
      confidence: 0.2,
      reasoning: 'unused',
      ignoreExistingLayout: false,
    })
  })

  it('节目不明确时会进入插入推荐确认态', async () => {
    mockIntentRecognize.mockResolvedValue({
      type: 'insert',
      confidence: 0.95,
      reasoning: 'insert generic',
    })
    mockExtractInsertParams.mockResolvedValue({
      targetTime: '09:00:00',
      rawProgramText: '新闻节目',
      semanticLabel: '新闻',
      programTypeHint: 'news',
    })

    const facade = new DemoRuntimeFacade()
    const result = await facade.submitInstruction({
      scheduleState: createScheduleState(),
      userInput: '9点插一个新闻节目',
      currentSchedule: [],
      history: [],
    })

    expect(result.kind).toBe('pending_atomic_context')
    if (result.kind !== 'pending_atomic_context') {
      throw new Error('expected pending_atomic_context')
    }
    expect(result.pendingAtomicContext.phase).toBe('recommending_insert')
    expect(result.pendingAtomicContext.slots.targetTime).toBe('09:00:00')
    expect(result.pendingAtomicContext.insertRecommendations?.length).toBeGreaterThan(0)
  })

  it('有时间的候选推荐诉求会进入插入推荐确认态', async () => {
    mockIntentRecognize.mockResolvedValue({
      type: 'insert',
      confidence: 0.95,
      reasoning: 'recommend candidates',
    })
    mockExtractInsertParams.mockResolvedValue({
      targetTime: '10:00:00',
      rawProgramText: '纪录片',
      semanticLabel: '纪实',
      programTypeHint: 'documentary',
    })

    const facade = new DemoRuntimeFacade()
    const result = await facade.submitInstruction({
      scheduleState: createScheduleState(),
      userInput: '10点帮我推荐几个纪录片候选',
      currentSchedule: [],
      history: [],
    })

    expect(result.kind).toBe('pending_atomic_context')
    if (result.kind !== 'pending_atomic_context') {
      throw new Error('expected pending_atomic_context')
    }
    expect(result.pendingAtomicContext.phase).toBe('recommending_insert')
    expect(result.pendingAtomicContext.slots.targetTime).toBe('10:00:00')
    expect(result.pendingAtomicContext.slots.programTypeHint).toBe('documentary')
    expect(result.pendingAtomicContext.insertRecommendations?.length).toBeGreaterThan(0)
  })

  it('没有时间的候选推荐诉求会进入插入参数澄清', async () => {
    mockIntentRecognize.mockResolvedValue({
      type: 'insert',
      confidence: 0.92,
      reasoning: 'recommend without time',
    })
    mockExtractInsertParams.mockResolvedValue(null)

    const facade = new DemoRuntimeFacade()
    const result = await facade.submitInstruction({
      scheduleState: createScheduleState(),
      userInput: '给我找几条健康节目',
      currentSchedule: [],
      history: [],
    })

    expect(result.kind).toBe('pending_atomic_context')
    if (result.kind !== 'pending_atomic_context') {
      throw new Error('expected pending_atomic_context')
    }
    expect(result.pendingAtomicContext.action).toBe('insert')
    expect(result.pendingAtomicContext.phase).toBe('clarifying')
    expect(result.pendingAtomicContext.missingFields).toContain('target_time')
    expect(result.pendingAtomicContext.slots.programName).toContain('健康')
  })

  it('明确节目名且高置信时会直接生成插入命令', async () => {
    mockIntentRecognize.mockResolvedValue({
      type: 'insert',
      confidence: 0.96,
      reasoning: 'insert explicit',
    })
    mockExtractInsertParams.mockResolvedValue({
      targetTime: '18:30:00',
      programName: '东方新闻',
      rawProgramText: '东方新闻',
      semanticLabel: '新闻',
      programTypeHint: 'news',
    })

    const facade = new DemoRuntimeFacade()
    const result = await facade.submitInstruction({
      scheduleState: createScheduleState(),
      userInput: '在18点30插入东方新闻',
      currentSchedule: [],
      history: [],
    })

    expect(result.kind).toBe('execute_command')
    if (result.kind !== 'execute_command') {
      throw new Error('expected execute_command')
    }
    expect(result.execution.command.action).toBe('insert')
    expect(result.execution.command.data).toMatchObject({
      candidateId: 'I103001-0001',
      insertTime: '18:30:00',
    })
  })

  it('会根据当前节目名锚点反推后置插入时间并进入推荐确认', async () => {
    mockIntentRecognize.mockResolvedValue({
      type: 'insert',
      confidence: 0.95,
      reasoning: 'relative insert',
    })
    mockExtractInsertParams.mockResolvedValue(null)

    const facade = new DemoRuntimeFacade()
    const result = await facade.submitInstruction({
      scheduleState: createScheduleState({ isEmpty: false, itemCount: 1 }),
      userInput: '在当前节目单里的看东方后面加一条天气服务',
      currentSchedule: [createCurrentItem()],
      history: [],
    })

    expect(result.kind).toBe('pending_atomic_context')
    if (result.kind !== 'pending_atomic_context') {
      throw new Error('expected pending_atomic_context')
    }
    expect(result.pendingAtomicContext.phase).toBe('recommending_insert')
    expect(result.pendingAtomicContext.slots.targetTime).toBe('10:00:00')
    expect(result.pendingAtomicContext.slots.rawProgramText).toBe('天气服务')
    expect(result.pendingAtomicContext.slots.programTypeHint).toBe('news_magazine')
    expect(result.pendingAtomicContext.insertRecommendations?.length).toBeGreaterThan(0)
  })

  it('会根据当前节目名锚点反推前置插入时间并进入推荐确认', async () => {
    mockIntentRecognize.mockResolvedValue({
      type: 'insert',
      confidence: 0.95,
      reasoning: 'relative insert before',
    })
    mockExtractInsertParams.mockResolvedValue(null)

    const facade = new DemoRuntimeFacade()
    const result = await facade.submitInstruction({
      scheduleState: createScheduleState({ isEmpty: false, itemCount: 1 }),
      userInput: '在《看东方》前面垫一条天气服务',
      currentSchedule: [createCurrentItem()],
      history: [],
    })

    expect(result.kind).toBe('pending_atomic_context')
    if (result.kind !== 'pending_atomic_context') {
      throw new Error('expected pending_atomic_context')
    }
    expect(result.pendingAtomicContext.phase).toBe('recommending_insert')
    expect(result.pendingAtomicContext.slots.targetTime).toBe('09:00:00')
    expect(result.pendingAtomicContext.slots.rawProgramText).toBe('天气服务')
  })

  it('当前节目单有多个同名锚点时不会静默选择插入位置', async () => {
    mockIntentRecognize.mockResolvedValue({
      type: 'insert',
      confidence: 0.95,
      reasoning: 'relative insert duplicate anchor',
    })
    mockExtractInsertParams.mockResolvedValue(null)

    const facade = new DemoRuntimeFacade()
    const result = await facade.submitInstruction({
      scheduleState: createScheduleState({ isEmpty: false, itemCount: 2 }),
      userInput: '在当前节目单里的看东方后面加一条天气服务',
      currentSchedule: [
        createCurrentItem(),
        createCurrentItem({ id: 'item-1800', startTime: '18:00:00', endTime: '19:00:00' }),
      ],
      history: [],
    })

    expect(result.kind).toBe('pending_atomic_context')
    if (result.kind !== 'pending_atomic_context') {
      throw new Error('expected pending_atomic_context')
    }
    expect(result.pendingAtomicContext.phase).toBe('clarifying')
    expect(result.feedback.content).toContain('多个《看东方》')
    expect(result.pendingAtomicContext.insertRecommendations).toBeUndefined()
  })
})
