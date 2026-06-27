import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ScheduleState } from '@/types/orchestration'
import { getAtomicCapabilities, resetAtomicCapabilities } from '@/services/atomicCapabilities'
import { resetCandidateService } from '@/services/candidateService'

const mockIntentRecognize = vi.fn()
const mockExtractInsertParams = vi.fn()
const mockExtractDeleteParams = vi.fn()
const mockExtractMoveParams = vi.fn()
const mockExtractReplaceParams = vi.fn()
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
    extractInsertParams: mockExtractInsertParams,
    extractDeleteParams: mockExtractDeleteParams,
    extractMoveParams: mockExtractMoveParams,
    extractReplaceParams: mockExtractReplaceParams,
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

const createPendingContext = (overrides: Record<string, unknown> = {}) => ({
  action: 'insert',
  phase: 'clarifying',
  summary: '请补充插入参数',
  reasoning: 'mock pending context',
  originalUserInput: '插入节目',
  collectedUserInput: '插入节目',
  slots: {},
  missingFields: ['target_time', 'program_name'],
  followUpQuestion: '请补充目标时间点和节目名称。',
  attemptCount: 0,
  createdAt: '2026-04-17T07:00:00.000Z',
  updatedAt: '2026-04-17T07:00:00.000Z',
  ...overrides,
})

describe('Atomic conversation scenarios', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    mockIntentRecognize.mockReset()
    mockExtractInsertParams.mockReset()
    mockExtractDeleteParams.mockReset()
    mockExtractMoveParams.mockReset()
    mockExtractReplaceParams.mockReset()
    mockLayoutRecognize.mockReset()
    mockResolveTarget.mockReset()
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

  it('case 01: 插入看东方时会保留节目名并只追问时间', async () => {
    mockIntentRecognize.mockResolvedValue({ type: 'insert', confidence: 0.9, reasoning: 'insert clarify' })
    mockExtractInsertParams.mockResolvedValue(null)

    const result = await new DemoRuntimeFacade().submitInstruction({
      scheduleState: createScheduleState(),
      userInput: '插入看东方',
      currentSchedule: [mockedItem],
      history: [],
    })

    expect(result.kind).toBe('pending_atomic_context')
    if (result.kind !== 'pending_atomic_context') throw new Error('expected pending_atomic_context')
    expect(result.pendingAtomicContext.action).toBe('insert')
    expect(result.pendingAtomicContext.missingFields).toEqual(['target_time'])
    expect(result.pendingAtomicContext.slots.programName).toBe('看东方')
  })

  it('case 02: 来个看东方时也会进入插入补参并保留节目名', async () => {
    mockIntentRecognize.mockResolvedValue({ type: 'insert', confidence: 0.9, reasoning: 'insert clarify' })
    mockExtractInsertParams.mockResolvedValue(null)

    const result = await new DemoRuntimeFacade().submitInstruction({
      scheduleState: createScheduleState(),
      userInput: '来个看东方',
      currentSchedule: [mockedItem],
      history: [],
    })

    expect(result.kind).toBe('pending_atomic_context')
    if (result.kind !== 'pending_atomic_context') throw new Error('expected pending_atomic_context')
    expect(result.pendingAtomicContext.action).toBe('insert')
    expect(result.pendingAtomicContext.missingFields).toEqual(['target_time'])
    expect(result.pendingAtomicContext.slots.programName).toBe('看东方')
  })

  it('case 03: 9点插入时会保留时间并只追问节目名', async () => {
    mockIntentRecognize.mockResolvedValue({ type: 'insert', confidence: 0.9, reasoning: 'insert clarify' })
    mockExtractInsertParams.mockResolvedValue(null)

    const result = await new DemoRuntimeFacade().submitInstruction({
      scheduleState: createScheduleState(),
      userInput: '9点插入',
      currentSchedule: [mockedItem],
      history: [],
    })

    expect(result.kind).toBe('pending_atomic_context')
    if (result.kind !== 'pending_atomic_context') throw new Error('expected pending_atomic_context')
    expect(result.pendingAtomicContext.missingFields).toEqual(['program_name'])
    expect(result.pendingAtomicContext.slots.targetTime).toBe('09:00:00')
  })

  it('case 04: 只说插入时会同时追问时间和节目名', async () => {
    mockIntentRecognize.mockResolvedValue({ type: 'insert', confidence: 0.9, reasoning: 'insert clarify' })
    mockExtractInsertParams.mockResolvedValue(null)

    const result = await new DemoRuntimeFacade().submitInstruction({
      scheduleState: createScheduleState(),
      userInput: '插入',
      currentSchedule: [mockedItem],
      history: [],
    })

    expect(result.kind).toBe('pending_atomic_context')
    if (result.kind !== 'pending_atomic_context') throw new Error('expected pending_atomic_context')
    expect(result.pendingAtomicContext.missingFields).toEqual(['target_time', 'program_name'])
  })

  it('case 05: 删除看东方时会保留节目名并只追问时间', async () => {
    mockIntentRecognize.mockResolvedValue({ type: 'delete', confidence: 0.9, reasoning: 'delete clarify' })
    mockExtractDeleteParams.mockResolvedValue(null)

    const result = await new DemoRuntimeFacade().submitInstruction({
      scheduleState: createScheduleState(),
      userInput: '删除看东方',
      currentSchedule: [mockedItem],
      history: [],
    })

    expect(result.kind).toBe('pending_atomic_context')
    if (result.kind !== 'pending_atomic_context') throw new Error('expected pending_atomic_context')
    expect(result.pendingAtomicContext.action).toBe('delete')
    expect(result.pendingAtomicContext.missingFields).toEqual(['target_time'])
    expect(result.pendingAtomicContext.slots.programName).toBe('看东方')
  })

  it('case 06: 删除书名号节目时也会保留目标节目名', async () => {
    mockIntentRecognize.mockResolvedValue({ type: 'delete', confidence: 0.9, reasoning: 'delete clarify' })
    mockExtractDeleteParams.mockResolvedValue(null)

    const result = await new DemoRuntimeFacade().submitInstruction({
      scheduleState: createScheduleState(),
      userInput: '删除《看东方》',
      currentSchedule: [mockedItem],
      history: [],
    })

    expect(result.kind).toBe('pending_atomic_context')
    if (result.kind !== 'pending_atomic_context') throw new Error('expected pending_atomic_context')
    expect(result.pendingAtomicContext.missingFields).toEqual(['target_time'])
    expect(result.pendingAtomicContext.slots.programName).toBe('看东方')
  })

  it('case 07: 只说后移30分钟时会保留移动幅度并追问目标', async () => {
    mockIntentRecognize.mockResolvedValue({ type: 'move', confidence: 0.9, reasoning: 'move clarify' })
    mockExtractMoveParams.mockResolvedValue(null)

    const result = await new DemoRuntimeFacade().submitInstruction({
      scheduleState: createScheduleState(),
      userInput: '后移30分钟',
      currentSchedule: [mockedItem],
      history: [],
    })

    expect(result.kind).toBe('pending_atomic_context')
    if (result.kind !== 'pending_atomic_context') throw new Error('expected pending_atomic_context')
    expect(result.pendingAtomicContext.missingFields).toEqual(['target_time'])
    expect(result.pendingAtomicContext.slots.direction).toBe('forward')
    expect(result.pendingAtomicContext.slots.offsetSeconds).toBe(1800)
  })

  it('case 08: 把看东方后移30分钟时会保留节目名和移动幅度', async () => {
    mockIntentRecognize.mockResolvedValue({ type: 'move', confidence: 0.9, reasoning: 'move clarify' })
    mockExtractMoveParams.mockResolvedValue(null)

    const result = await new DemoRuntimeFacade().submitInstruction({
      scheduleState: createScheduleState(),
      userInput: '把看东方后移30分钟',
      currentSchedule: [mockedItem],
      history: [],
    })

    expect(result.kind).toBe('pending_atomic_context')
    if (result.kind !== 'pending_atomic_context') throw new Error('expected pending_atomic_context')
    expect(result.pendingAtomicContext.missingFields).toEqual(['target_time'])
    expect(result.pendingAtomicContext.slots.programName).toBe('看东方')
    expect(result.pendingAtomicContext.slots.offsetSeconds).toBe(1800)
  })

  it('case 09: 把9点的节目后移时会只追问移动幅度', async () => {
    mockIntentRecognize.mockResolvedValue({ type: 'move', confidence: 0.9, reasoning: 'move clarify' })
    mockExtractMoveParams.mockResolvedValue(null)

    const result = await new DemoRuntimeFacade().submitInstruction({
      scheduleState: createScheduleState(),
      userInput: '把9点的节目后移',
      currentSchedule: [mockedItem],
      history: [],
    })

    expect(result.kind).toBe('pending_atomic_context')
    if (result.kind !== 'pending_atomic_context') throw new Error('expected pending_atomic_context')
    expect(result.pendingAtomicContext.missingFields).toEqual(['offset'])
    expect(result.pendingAtomicContext.slots.targetTime).toBe('09:00:00')
  })

  it('case 10: 只说替换成东方新闻时会保留新节目名并追问目标时间', async () => {
    mockIntentRecognize.mockResolvedValue({ type: 'replace', confidence: 0.9, reasoning: 'replace clarify' })
    mockExtractReplaceParams.mockResolvedValue(null)

    const result = await new DemoRuntimeFacade().submitInstruction({
      scheduleState: createScheduleState(),
      userInput: '替换成东方新闻',
      currentSchedule: [mockedItem],
      history: [],
    })

    expect(result.kind).toBe('pending_atomic_context')
    if (result.kind !== 'pending_atomic_context') throw new Error('expected pending_atomic_context')
    expect(result.pendingAtomicContext.missingFields).toEqual(['target_time'])
    expect(result.pendingAtomicContext.slots.replacementProgramName).toBe('东方新闻')
  })

  it('case 11: 把看东方替换成东方新闻时会同时保留目标节目和新节目', async () => {
    mockIntentRecognize.mockResolvedValue({ type: 'replace', confidence: 0.9, reasoning: 'replace clarify' })
    mockExtractReplaceParams.mockResolvedValue(null)

    const result = await new DemoRuntimeFacade().submitInstruction({
      scheduleState: createScheduleState(),
      userInput: '把看东方替换成东方新闻',
      currentSchedule: [mockedItem],
      history: [],
    })

    expect(result.kind).toBe('pending_atomic_context')
    if (result.kind !== 'pending_atomic_context') throw new Error('expected pending_atomic_context')
    expect(result.pendingAtomicContext.missingFields).toEqual(['target_time'])
    expect(result.pendingAtomicContext.slots.programName).toBe('看东方')
    expect(result.pendingAtomicContext.slots.replacementProgramName).toBe('东方新闻')
  })

  it('case 12: 把9点的节目替换时会只追问新节目名称', async () => {
    mockIntentRecognize.mockResolvedValue({ type: 'replace', confidence: 0.9, reasoning: 'replace clarify' })
    mockExtractReplaceParams.mockResolvedValue(null)

    const result = await new DemoRuntimeFacade().submitInstruction({
      scheduleState: createScheduleState(),
      userInput: '把9点的节目替换',
      currentSchedule: [mockedItem],
      history: [],
    })

    expect(result.kind).toBe('pending_atomic_context')
    if (result.kind !== 'pending_atomic_context') throw new Error('expected pending_atomic_context')
    expect(result.pendingAtomicContext.missingFields).toEqual(['replacement_program'])
    expect(result.pendingAtomicContext.slots.targetTime).toBe('09:00:00')
  })

  it('case 13: 插入看东方后补9点时会因目标时间被占用而阻止推荐', async () => {
    mockIntentRecognize
      .mockResolvedValueOnce({ type: 'insert', confidence: 0.9, reasoning: 'insert clarify' })
      .mockResolvedValueOnce({ type: 'insert', confidence: 0.9, reasoning: 'insert ready' })
    mockExtractInsertParams
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        targetTime: '09:00:00',
        programName: '看东方',
        rawProgramText: '看东方',
      })

    const facade = new DemoRuntimeFacade()
    const first = await facade.submitInstruction({
      scheduleState: createScheduleState(),
      userInput: '插入看东方',
      currentSchedule: [mockedItem],
      history: [],
    })

    if (first.kind !== 'pending_atomic_context') throw new Error('expected pending_atomic_context')

    const second = await facade.submitInstruction({
      scheduleState: createScheduleState(),
      userInput: '9点',
      currentSchedule: [mockedItem],
      pendingAtomicContext: first.pendingAtomicContext,
      history: [],
    })

    expect(second.kind).toBe('message')
    if (second.kind !== 'message') throw new Error('expected blocked insert message')
    expect(second.feedback.content).toContain('空闲时段不足')
    expect(second.feedback.details?.targetTime).toBe('09:00:00')
    expect(second.feedback.details?.rejectedReason).toBe('insert_time_not_available')
  })

  it('case 14: 把看东方后移30分钟后补9点时可以直接续跑移动', async () => {
    mockIntentRecognize
      .mockResolvedValueOnce({ type: 'move', confidence: 0.9, reasoning: 'move clarify' })
      .mockResolvedValueOnce({ type: 'move', confidence: 0.9, reasoning: 'move ready' })
    mockExtractMoveParams
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
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
      userInput: '把看东方后移30分钟',
      currentSchedule: [mockedItem],
      history: [],
    })

    if (first.kind !== 'pending_atomic_context') throw new Error('expected pending_atomic_context')

    const second = await facade.submitInstruction({
      scheduleState: createScheduleState(),
      userInput: '9点',
      currentSchedule: [mockedItem],
      pendingAtomicContext: first.pendingAtomicContext,
      history: [],
    })

    expect(second.kind).toBe('execute_command')
    if (second.kind !== 'execute_command') throw new Error('expected execute_command')
    expect(second.execution.command.action).toBe('move')
    expect(second.execution.command.data).toMatchObject({
      itemId: mockedItem.id,
      newStartTime: '2026-03-25T09:30:00+08:00',
    })
  })

  it('case 15: 删除看东方后补9点时会进入待确认删除', async () => {
    mockIntentRecognize
      .mockResolvedValueOnce({ type: 'delete', confidence: 0.9, reasoning: 'delete clarify' })
      .mockResolvedValueOnce({ type: 'delete', confidence: 0.9, reasoning: 'delete ready' })
    mockExtractDeleteParams
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        targetTime: '09:00:00',
        programName: '看东方',
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
      userInput: '删除看东方',
      currentSchedule: [mockedItem],
      history: [],
    })

    if (first.kind !== 'pending_atomic_context') throw new Error('expected pending_atomic_context')

    const second = await facade.submitInstruction({
      scheduleState: createScheduleState(),
      userInput: '9点',
      currentSchedule: [mockedItem],
      pendingAtomicContext: first.pendingAtomicContext,
      history: [],
    })

    expect(second.kind).toBe('pending_command')
    if (second.kind !== 'pending_command') throw new Error('expected pending_command')
    expect(second.pendingCommand.command.action).toBe('delete')
  })

  it('case 16: 把看东方替换成东方新闻后补9点时会进入待确认替换', async () => {
    mockIntentRecognize
      .mockResolvedValueOnce({ type: 'replace', confidence: 0.9, reasoning: 'replace clarify' })
      .mockResolvedValueOnce({ type: 'replace', confidence: 0.9, reasoning: 'replace ready' })
    mockExtractReplaceParams
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        targetTime: '09:00:00',
        programName: '东方新闻',
      })
    mockResolveTarget.mockResolvedValue({
      status: 'unique',
      selectedItem: { ...mockedItem },
      reasoning: 'matched target item',
      matchedBy: ['time_window'],
      candidates: [{ ...mockedItem }],
    })
    await getAtomicCapabilities().replaceAllItems([
      {
        ...mockedItem,
        startTime: '2026-03-25T09:00:00+08:00',
        endTime: '2026-03-25T10:00:00+08:00',
      },
    ], { skipValidation: true })

    const facade = new DemoRuntimeFacade()
    const first = await facade.submitInstruction({
      scheduleState: createScheduleState(),
      userInput: '把看东方替换成东方新闻',
      currentSchedule: [mockedItem],
      history: [],
    })

    if (first.kind !== 'pending_atomic_context') throw new Error('expected pending_atomic_context')

    const second = await facade.submitInstruction({
      scheduleState: createScheduleState(),
      userInput: '9点',
      currentSchedule: [mockedItem],
      pendingAtomicContext: first.pendingAtomicContext,
      history: [],
    })

    expect(second.kind).toBe('pending_command')
    if (second.kind !== 'pending_command') throw new Error('expected pending_command')
    expect(second.pendingCommand.command.action).toBe('replace')
  })

  it('case 17: 后移30分钟后再说看东方时会保留节目名继续等时间', async () => {
    mockIntentRecognize.mockResolvedValue({ type: 'move', confidence: 0.9, reasoning: 'move clarify' })
    mockExtractMoveParams.mockResolvedValue(null)

    const facade = new DemoRuntimeFacade()
    const first = await facade.submitInstruction({
      scheduleState: createScheduleState(),
      userInput: '后移30分钟',
      currentSchedule: [mockedItem],
      history: [],
    })

    if (first.kind !== 'pending_atomic_context') throw new Error('expected pending_atomic_context')

    const second = await facade.submitInstruction({
      scheduleState: createScheduleState(),
      userInput: '看东方',
      currentSchedule: [mockedItem],
      pendingAtomicContext: first.pendingAtomicContext,
      history: [],
    })

    expect(second.kind).toBe('pending_atomic_context')
    if (second.kind !== 'pending_atomic_context') throw new Error('expected pending_atomic_context')
    expect(second.pendingAtomicContext.missingFields).toEqual(['target_time'])
    expect(second.pendingAtomicContext.slots.programName).toBe('看东方')
    expect(second.pendingAtomicContext.slots.offsetSeconds).toBe(1800)
  })

  it('case 18: 9点插入后再说看东方时会因目标时间被占用而阻止推荐', async () => {
    mockIntentRecognize
      .mockResolvedValueOnce({ type: 'insert', confidence: 0.9, reasoning: 'insert clarify' })
      .mockResolvedValueOnce({ type: 'insert', confidence: 0.9, reasoning: 'insert ready' })
    mockExtractInsertParams
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        targetTime: '09:00:00',
        programName: '看东方',
        rawProgramText: '看东方',
      })

    const facade = new DemoRuntimeFacade()
    const first = await facade.submitInstruction({
      scheduleState: createScheduleState(),
      userInput: '9点插入',
      currentSchedule: [mockedItem],
      history: [],
    })

    if (first.kind !== 'pending_atomic_context') throw new Error('expected pending_atomic_context')

    const second = await facade.submitInstruction({
      scheduleState: createScheduleState(),
      userInput: '看东方',
      currentSchedule: [mockedItem],
      pendingAtomicContext: first.pendingAtomicContext,
      history: [],
    })

    expect(second.kind).toBe('message')
    if (second.kind !== 'message') throw new Error('expected blocked insert message')
    expect(second.feedback.content).toContain('空闲时段不足')
    expect(second.feedback.details?.targetTime).toBe('09:00:00')
    expect(second.feedback.details?.rejectedReason).toBe('insert_time_not_available')
  })

})
