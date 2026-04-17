import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ScheduleState } from '@/types/orchestration'
import { getAtomicCapabilities, resetAtomicCapabilities } from '@/services/atomicCapabilities'
import { resetCandidateService } from '@/services/candidateService'

const mockIntentRecognize = vi.fn()
const mockExtractDeleteParams = vi.fn()
const mockExtractMoveParams = vi.fn()
const mockLayoutRecognize = vi.fn()
const mockResolveTarget = vi.fn()

const mockedItem = {
  id: 'item-0900',
  programCode: 'P100001',
  programName: '看东方',
  startTime: '09:00:00',
  endTime: '10:00:00',
  duration: 3600,
  programType: 'news',
}

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
    extractInsertParams: vi.fn(async () => null),
    extractDeleteParams: mockExtractDeleteParams,
    extractMoveParams: mockExtractMoveParams,
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
    resolve: mockResolveTarget,
  }),
}))

import { DemoRuntimeFacade } from '@/services/runtime/demoRuntimeFacade'

const createScheduleState = (): ScheduleState => ({
  channelId: 'dragon',
  channelName: '东方卫视',
  date: '2026-03-25',
  isEmpty: false,
  itemCount: 10,
  gapCount: 1,
  hasSelectedTimeRange: false,
})

describe('DemoRuntimeFacade atomic fallback', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    mockIntentRecognize.mockReset()
    mockExtractDeleteParams.mockReset()
    mockExtractMoveParams.mockReset()
    mockLayoutRecognize.mockReset()
    mockResolveTarget.mockReset()
    resetCandidateService()
    resetAtomicCapabilities()
    await getAtomicCapabilities().clearAll()
  })

  it('会把 atomic_fallback 转成带状态的原子参数澄清', async () => {
    mockIntentRecognize.mockResolvedValue({
      type: 'unsupported',
      confidence: 0.2,
      reasoning: 'not an atomic command yet',
    })
    mockLayoutRecognize.mockResolvedValue({
      mode: 'atomic_fallback',
      confidence: 0.93,
      reasoning: 'mock atomic fallback',
      ignoreExistingLayout: false,
    })

    const facade = new DemoRuntimeFacade()

    const result = await facade.submitInstruction({
      scheduleState: createScheduleState(),
      userInput: '把9点后那段顺一下',
      currentSchedule: [mockedItem],
      history: [],
    })

    expect(result.kind).toBe('pending_atomic_context')
    if (result.kind !== 'pending_atomic_context') {
      throw new Error('expected pending_atomic_context decision')
    }

    expect(result.feedback.processTypeLabel).toBe('原子参数澄清')
    expect(result.pendingAtomicContext.action).toBe('move')
    expect(result.pendingAtomicContext.phase).toBe('clarifying')
    expect(result.pendingAtomicContext.slots.targetTimeHint).toBe('9点')
    expect(result.pendingAtomicContext.missingFields).toContain('offset')
  })

  it('直接原子删除命令缺少目标时会进入统一澄清态', async () => {
    mockIntentRecognize.mockResolvedValue({
      type: 'delete',
      confidence: 0.96,
      reasoning: 'delete intent without target',
    })
    mockExtractDeleteParams.mockResolvedValue(null)

    const facade = new DemoRuntimeFacade()

    const result = await facade.submitInstruction({
      scheduleState: createScheduleState(),
      userInput: '删除节目',
      currentSchedule: [mockedItem],
      history: [],
    })

    expect(result.kind).toBe('pending_atomic_context')
    if (result.kind !== 'pending_atomic_context') {
      throw new Error('expected pending_atomic_context decision')
    }

    expect(result.feedback.processTypeLabel).toBe('原子参数澄清')
    expect(result.pendingAtomicContext.action).toBe('delete')
    expect(result.pendingAtomicContext.phase).toBe('clarifying')
    expect(result.pendingAtomicContext.missingFields).toContain('target_time')
  })

  it('会在下一轮补参后继续执行原子移动命令', async () => {
    mockIntentRecognize
      .mockResolvedValueOnce({
        type: 'unsupported',
        confidence: 0.2,
        reasoning: 'not an atomic command yet',
      })
      .mockResolvedValueOnce({
        type: 'move',
        confidence: 0.9,
        reasoning: 'follow-up move intent',
      })
    mockLayoutRecognize.mockResolvedValue({
      mode: 'atomic_fallback',
      confidence: 0.93,
      reasoning: 'mock atomic fallback',
      ignoreExistingLayout: false,
    })
    mockExtractMoveParams.mockResolvedValue({
      targetTime: '09:00:00',
      direction: 'forward',
      offsetSeconds: 1800,
    })
    mockResolveTarget.mockResolvedValue({
      status: 'unique',
      selectedItem: { ...mockedItem },
      reasoning: 'matched target item',
      matchedBy: ['time_window'],
      candidates: [{ ...mockedItem }],
    })

    const facade = new DemoRuntimeFacade()
    const first = await facade.submitInstruction({
      scheduleState: createScheduleState(),
      userInput: '把9点后那段顺一下',
      currentSchedule: [mockedItem],
      history: [],
    })

    if (first.kind !== 'pending_atomic_context') {
      throw new Error('expected first step to produce pending_atomic_context')
    }

    const second = await facade.submitInstruction({
      scheduleState: createScheduleState(),
      userInput: '后移30分钟',
      currentSchedule: [mockedItem],
      pendingAtomicContext: first.pendingAtomicContext,
      history: [],
    })

    expect(second.kind).toBe('execute_command')
    if (second.kind !== 'execute_command') {
      throw new Error('expected execute_command decision')
    }

    expect(second.execution.command.action).toBe('move')
    expect(second.execution.command.data).toMatchObject({
      itemId: mockedItem.id,
      newStartTime: '2026-03-25T09:30:00+08:00',
    })
  })

  it('统一 pendingAtomicContext 在澄清态下也能继续执行移动命令', async () => {
    mockIntentRecognize.mockResolvedValueOnce({
      type: 'move',
      confidence: 0.9,
      reasoning: 'follow-up move intent',
    })
    mockExtractMoveParams.mockResolvedValue({
      targetTime: '09:00:00',
      direction: 'forward',
      offsetSeconds: 1800,
    })
    mockResolveTarget.mockResolvedValue({
      status: 'unique',
      selectedItem: { ...mockedItem },
      reasoning: 'matched target item',
      matchedBy: ['time_window'],
      candidates: [{ ...mockedItem }],
    })
    mockLayoutRecognize.mockResolvedValue({
      mode: 'clarify',
      confidence: 0.2,
      reasoning: 'unused',
      ignoreExistingLayout: false,
    })

    const facade = new DemoRuntimeFacade()
    const result = await facade.submitInstruction({
      scheduleState: createScheduleState(),
      userInput: '后移30分钟',
      currentSchedule: [mockedItem],
      pendingAtomicContext: {
        action: 'move',
        phase: 'clarifying',
        summary: '请补充9点的移动参数',
        reasoning: 'mock atomic fallback',
        originalUserInput: '把9点后那段顺一下',
        collectedUserInput: '把9点后那段顺一下',
        slots: {
          targetTimeHint: '9点',
        },
        missingFields: ['offset'],
        followUpQuestion: '已经定位到 9点，还需要你补充移动幅度，例如“后移 30 分钟”。',
        attemptCount: 0,
        createdAt: '2026-04-15T10:00:00.000Z',
        updatedAt: '2026-04-15T10:00:00.000Z',
      },
      history: [],
    })

    expect(result.kind).toBe('execute_command')
    if (result.kind !== 'execute_command') {
      throw new Error('expected execute_command decision')
    }

    expect(result.execution.command.action).toBe('move')
    expect(result.execution.command.data).toMatchObject({
      itemId: mockedItem.id,
      newStartTime: '2026-03-25T09:30:00+08:00',
    })
  })

  it('统一 pendingAtomicContext 在澄清态下也能把补充时间续跑到删除命令', async () => {
    mockIntentRecognize.mockResolvedValueOnce({
      type: 'delete',
      confidence: 0.9,
      reasoning: 'follow-up delete intent',
    })
    mockExtractDeleteParams.mockResolvedValue({
      targetTime: '09:00:00',
    })
    mockResolveTarget.mockResolvedValue({
      status: 'unique',
      selectedItem: { ...mockedItem },
      reasoning: 'matched target item',
      matchedBy: ['time_window'],
      candidates: [{ ...mockedItem }],
    })
    mockLayoutRecognize.mockResolvedValue({
      mode: 'clarify',
      confidence: 0.2,
      reasoning: 'unused',
      ignoreExistingLayout: false,
    })

    const facade = new DemoRuntimeFacade()
    const result = await facade.submitInstruction({
      scheduleState: createScheduleState(),
      userInput: '9点',
      currentSchedule: [mockedItem],
      pendingAtomicContext: {
        action: 'delete',
        phase: 'clarifying',
        summary: '请补充删除参数',
        reasoning: 'delete intent without target',
        originalUserInput: '删除节目',
        collectedUserInput: '删除节目',
        slots: {},
        missingFields: ['target_time'],
        followUpQuestion: '请补充要删除的时间点或节目名称。',
        attemptCount: 0,
        createdAt: '2026-04-15T10:00:00.000Z',
        updatedAt: '2026-04-15T10:00:00.000Z',
      },
      history: [],
    })

    expect(result.kind).toBe('pending_command')
    if (result.kind !== 'pending_command') {
      throw new Error('expected pending_command decision')
    }

    expect(result.pendingCommand.command.action).toBe('delete')
    expect(result.pendingCommand.command.data).toMatchObject({
      itemId: mockedItem.id,
    })
  })

  it('统一 pendingAtomicContext 在目标选择态下支持自然语言选择', async () => {
    mockLayoutRecognize.mockResolvedValue({
      mode: 'clarify',
      confidence: 0.2,
      reasoning: 'unused',
      ignoreExistingLayout: false,
    })

    const facade = new DemoRuntimeFacade()
    const result = await facade.submitInstruction({
      scheduleState: createScheduleState(),
      userInput: '第一个',
      currentSchedule: [mockedItem],
      pendingTargetSelection: {
        action: 'move',
        summary: '请确认要移动的目标节目',
        reasoning: 'mock target selection',
        targetTime: '09:00:00',
        candidates: [{ ...mockedItem }],
        selectedItemId: null,
        moveConfig: {
          direction: 'forward',
          offsetSeconds: 1800,
        },
      },
      pendingAtomicContext: {
        action: 'move',
        phase: 'selecting_target',
        summary: '请确认要移动的目标节目',
        reasoning: 'mock target selection',
        originalUserInput: '把9点那条后移30分钟',
        collectedUserInput: '把9点那条后移30分钟',
        slots: {
          targetTime: '09:00:00',
          direction: 'forward',
          offsetSeconds: 1800,
        },
        missingFields: ['selection'],
        followUpQuestion: '请确认要移动的目标节目',
        targetCandidates: [{ ...mockedItem }],
        selectedItemId: null,
        attemptCount: 0,
        createdAt: '2026-04-15T10:00:00.000Z',
        updatedAt: '2026-04-15T10:00:00.000Z',
      },
      history: [],
    })

    expect(result.kind).toBe('execute_command')
    if (result.kind !== 'execute_command') {
      throw new Error('expected execute_command decision')
    }

    expect(result.execution.command.action).toBe('move')
    expect(result.execution.command.data).toMatchObject({
      itemId: mockedItem.id,
      newStartTime: '2026-03-25T09:30:00+08:00',
    })
  })

  it('统一 pendingAtomicContext 在插入推荐态下支持自然语言选择', async () => {
    mockLayoutRecognize.mockResolvedValue({
      mode: 'clarify',
      confidence: 0.2,
      reasoning: 'unused',
      ignoreExistingLayout: false,
    })

    const facade = new DemoRuntimeFacade()
    const result = await facade.submitInstruction({
      scheduleState: createScheduleState(),
      userInput: '第一个',
      currentSchedule: [],
      pendingInsertRecommendation: {
        action: 'insert',
        summary: '请确认 09:00 要插入的节目',
        reasoning: 'mock insert recommendation',
        originalUserInput: '9点插一个新闻节目',
        collectedUserInput: '9点插一个新闻节目',
        targetTime: '09:00:00',
        rawProgramText: '新闻节目',
        semanticLabel: '新闻',
        programTypeHint: 'news',
        recommendedCandidates: [
          {
            candidateId: 'I103001-0001',
            programName: '东方新闻',
            programCode: 'I103001',
            duration: 1800,
            programType: 'news',
            score: 92,
            confidence: 0.88,
            reasonTags: ['类型匹配'],
          },
        ],
        selectedCandidateId: null,
      },
      pendingAtomicContext: {
        action: 'insert',
        phase: 'recommending_insert',
        summary: '请确认 09:00 要插入的节目',
        reasoning: 'mock insert recommendation',
        originalUserInput: '9点插一个新闻节目',
        collectedUserInput: '9点插一个新闻节目',
        slots: {
          targetTime: '09:00:00',
          rawProgramText: '新闻节目',
          semanticLabel: '新闻',
          programTypeHint: 'news',
        },
        missingFields: ['selection'],
        followUpQuestion: '请确认 09:00 要插入的节目',
        insertRecommendations: [
          {
            candidateId: 'I103001-0001',
            programName: '东方新闻',
            programCode: 'I103001',
            duration: 1800,
            programType: 'news',
            score: 92,
            confidence: 0.88,
            reasonTags: ['类型匹配'],
          },
        ],
        selectedCandidateId: null,
        attemptCount: 0,
        createdAt: '2026-04-15T10:00:00.000Z',
        updatedAt: '2026-04-15T10:00:00.000Z',
      },
      history: [],
    })

    expect(result.kind).toBe('execute_command')
    if (result.kind !== 'execute_command') {
      throw new Error('expected execute_command decision')
    }

    expect(result.execution.command.action).toBe('insert')
    expect(result.execution.command.data).toMatchObject({
      candidateId: 'I103001-0001',
      insertTime: '09:00:00',
    })
  })

  it('统一 pendingAtomicContext 超时后会结束旧上下文并提示用户重述', async () => {
    const facade = new DemoRuntimeFacade()

    const result = await facade.submitInstruction({
      scheduleState: createScheduleState(),
      userInput: '9点',
      currentSchedule: [mockedItem],
      pendingAtomicContext: {
        action: 'delete',
        phase: 'clarifying',
        summary: '请补充删除参数',
        reasoning: 'delete intent without target',
        originalUserInput: '删除节目',
        collectedUserInput: '删除节目',
        slots: {},
        missingFields: ['target_time'],
        followUpQuestion: '请补充要删除的时间点或节目名称。',
        attemptCount: 1,
        createdAt: '2026-04-15T10:00:00.000Z',
        updatedAt: '2026-04-15T10:00:00.000Z',
        expiresAt: '2026-04-15T10:05:00.000Z',
      },
      history: [],
    })

    expect(result.kind).toBe('message')
    if (result.kind !== 'message') {
      throw new Error('expected message decision')
    }

    expect(result.statusHint).toBe('cancelled')
    expect(result.feedback.processTypeLabel).toBe('上下文已失效')
  })

  it('统一 pendingAtomicContext 超过最大尝试次数后会结束当前补参', async () => {
    const facade = new DemoRuntimeFacade()

    const result = await facade.submitInstruction({
      scheduleState: createScheduleState(),
      userInput: '还是这个',
      currentSchedule: [mockedItem],
      pendingAtomicContext: {
        action: 'delete',
        phase: 'clarifying',
        summary: '请补充删除参数',
        reasoning: 'delete intent without target',
        originalUserInput: '删除节目',
        collectedUserInput: '删除节目，补充说明：这个',
        slots: {},
        missingFields: ['target_time'],
        followUpQuestion: '请补充要删除的时间点或节目名称。',
        attemptCount: 3,
        createdAt: '2026-04-15T10:00:00.000Z',
        updatedAt: '2026-04-15T10:03:00.000Z',
        expiresAt: '2026-04-16T16:13:00.000Z',
      },
      history: [],
    })

    expect(result.kind).toBe('message')
    if (result.kind !== 'message') {
      throw new Error('expected message decision')
    }

    expect(result.statusHint).toBe('failed')
    expect(result.feedback.processTypeLabel).toBe('补参失败')
  })
})
