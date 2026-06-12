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

const toClock = (value?: string) => value?.includes('T')
  ? value.split('T')[1]?.slice(0, 8)
  : value

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

describe('DemoRuntimeFacade atomic fallback', () => {
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

  it('无时间但节目名唯一的删除命令会用当前节目单反推目标时间', async () => {
    mockIntentRecognize.mockResolvedValue({
      type: 'delete',
      confidence: 0.96,
      reasoning: 'delete by program name',
    })
    mockExtractDeleteParams.mockResolvedValue(null)
    mockResolveTarget.mockResolvedValue({
      status: 'unique',
      selectedItem: { ...mockedItem },
      reasoning: 'matched target by inferred time and name',
      matchedBy: ['time_window', 'name_match'],
      candidates: [{ ...mockedItem }],
    })

    const facade = new DemoRuntimeFacade()

    const result = await facade.submitInstruction({
      scheduleState: createScheduleState(),
      userInput: '删除当前节目单里的看东方',
      currentSchedule: [mockedItem],
      history: [],
    })

    expect(mockResolveTarget).toHaveBeenCalledWith(expect.objectContaining({
      targetTime: '09:00:00',
      programName: '看东方',
    }))
    expect(result.kind).toBe('pending_command')
    if (result.kind !== 'pending_command') {
      throw new Error('expected pending_command decision')
    }
    expect(result.pendingCommand.command.action).toBe('delete')
    expect(result.pendingCommand.command.data).toEqual({ itemId: mockedItem.id })
  })

  it('无时间但节目名唯一的移动命令会用当前节目单反推目标时间和半小时偏移', async () => {
    const noonItem = {
      id: 'item-1200',
      programCode: 'P102001',
      programName: '午间30分',
      startTime: '12:00:00',
      endTime: '12:30:00',
      duration: 1800,
      programType: 'news',
    }
    mockIntentRecognize.mockResolvedValue({
      type: 'move',
      confidence: 0.96,
      reasoning: 'move by program name',
    })
    mockExtractMoveParams.mockResolvedValue(null)
    mockResolveTarget.mockResolvedValue({
      status: 'unique',
      selectedItem: { ...noonItem },
      reasoning: 'matched target by inferred time and name',
      matchedBy: ['time_window', 'name_match'],
      candidates: [{ ...noonItem }],
    })

    const facade = new DemoRuntimeFacade()

    const result = await facade.submitInstruction({
      scheduleState: createScheduleState(),
      userInput: '把当前节目单里的午间30分后移半小时',
      currentSchedule: [mockedItem, noonItem],
      history: [],
    })

    expect(mockResolveTarget).toHaveBeenCalledWith(expect.objectContaining({
      targetTime: '12:00:00',
    }))
    expect(result.kind).toBe('execute_command')
    if (result.kind !== 'execute_command') {
      throw new Error('expected execute_command decision')
    }
    expect(result.execution.command.action).toBe('move')
    expect(result.execution.command.data).toMatchObject({
      itemId: noonItem.id,
      newStartTime: '2026-03-25T12:30:00+08:00',
    })
  })

  it('无时间但节目名唯一的替换命令会用当前节目单反推目标时间并生成待确认替换', async () => {
    const currentItem = {
      ...mockedItem,
      programName: '看东方',
      startTime: '2026-03-25T09:00:00+08:00',
      endTime: '2026-03-25T10:00:00+08:00',
    }
    await getAtomicCapabilities().appendItems([currentItem], { skipValidation: true })
    mockIntentRecognize.mockResolvedValue({
      type: 'replace',
      confidence: 0.96,
      reasoning: 'replace by program name',
    })
    mockExtractReplaceParams.mockResolvedValue(null)
    mockResolveTarget.mockResolvedValue({
      status: 'unique',
      selectedItem: { ...currentItem },
      reasoning: 'matched target by inferred time and name',
      matchedBy: ['time_window', 'name_match'],
      candidates: [{ ...currentItem }],
    })

    const facade = new DemoRuntimeFacade()

    const result = await facade.submitInstruction({
      scheduleState: createScheduleState(),
      userInput: '把当前节目单里的看东方换成东方新闻',
      currentSchedule: [currentItem],
      history: [],
    })

    expect(mockResolveTarget).toHaveBeenCalledWith(expect.objectContaining({
      targetTime: '09:00:00',
    }))
    expect(result.kind).toBe('pending_command')
    if (result.kind !== 'pending_command') {
      throw new Error('expected pending_command decision')
    }
    expect(result.pendingCommand.command.action).toBe('replace')
    expect(result.pendingCommand.command.data).toMatchObject({
      itemId: currentItem.id,
      newCandidateId: 'I103001-0001',
    })
  })

  it('无时间但节目名命中多条的替换命令会进入目标选择并保留新节目名', async () => {
    const laterItem = {
      ...mockedItem,
      id: 'item-1400',
      programName: '看东方',
      startTime: '14:00:00',
      endTime: '15:00:00',
    }
    mockIntentRecognize.mockResolvedValue({
      type: 'replace',
      confidence: 0.96,
      reasoning: 'replace by repeated program name',
    })
    mockExtractReplaceParams.mockResolvedValue(null)

    const facade = new DemoRuntimeFacade()

    const result = await facade.submitInstruction({
      scheduleState: createScheduleState(),
      userInput: '把当前节目单里的看东方换成东方新闻',
      currentSchedule: [{ ...mockedItem, programName: '看东方' }, laterItem],
      history: [],
    })

    expect(mockResolveTarget).not.toHaveBeenCalled()
    expect(result.kind).toBe('pending_atomic_context')
    if (result.kind !== 'pending_atomic_context') {
      throw new Error('expected pending_atomic_context decision')
    }
    expect(result.pendingAtomicContext.phase).toBe('selecting_target')
    expect(result.pendingAtomicContext.targetCandidates).toHaveLength(2)
    expect(result.pendingAtomicContext.slots.replacementProgramName).toBe('东方新闻')
  })

  it('会把删除当前节目单第一条识别为实际节目单顺序锚点删除', async () => {
    const firstItem = {
      ...mockedItem,
      id: 'item-0800',
      programName: '早间资讯',
      startTime: '08:00:00',
      endTime: '09:00:00',
    }
    mockIntentRecognize.mockResolvedValue({
      type: 'delete',
      confidence: 0.96,
      reasoning: 'delete by ordinal',
    })
    mockExtractDeleteParams.mockResolvedValue(null)
    mockResolveTarget.mockResolvedValue({
      status: 'unique',
      selectedItem: { ...firstItem },
      reasoning: 'matched target by ordinal inferred time',
      matchedBy: ['time_window'],
      candidates: [{ ...firstItem }],
    })

    const facade = new DemoRuntimeFacade()

    const result = await facade.submitInstruction({
      scheduleState: createScheduleState(),
      userInput: '删掉当前节目单第一条',
      currentSchedule: [mockedItem, firstItem],
      history: [],
    })

    expect(mockResolveTarget).toHaveBeenCalledWith(expect.objectContaining({
      targetTime: '08:00:00',
      programName: '早间资讯',
    }))
    expect(result.kind).toBe('pending_command')
    if (result.kind !== 'pending_command') {
      throw new Error('expected pending_command decision')
    }
    expect(result.pendingCommand.command.action).toBe('delete')
    expect(result.pendingCommand.command.data).toEqual({ itemId: firstItem.id })
  })

  it('会把最后一条后移识别为实际节目单顺序锚点移动', async () => {
    const lastItem = {
      ...mockedItem,
      id: 'item-1500',
      programName: '晚间节目',
      startTime: '15:00:00',
      endTime: '15:30:00',
      duration: 1800,
    }
    mockIntentRecognize.mockResolvedValue({
      type: 'move',
      confidence: 0.96,
      reasoning: 'move by ordinal',
    })
    mockExtractMoveParams.mockResolvedValue(null)
    mockResolveTarget.mockResolvedValue({
      status: 'unique',
      selectedItem: { ...lastItem },
      reasoning: 'matched target by ordinal inferred time',
      matchedBy: ['time_window'],
      candidates: [{ ...lastItem }],
    })

    const facade = new DemoRuntimeFacade()

    const result = await facade.submitInstruction({
      scheduleState: createScheduleState(),
      userInput: '把最后一条后移10分钟',
      currentSchedule: [mockedItem, lastItem],
      history: [],
    })

    expect(mockResolveTarget).toHaveBeenCalledWith(expect.objectContaining({
      targetTime: '15:00:00',
    }))
    expect(result.kind).toBe('execute_command')
    if (result.kind !== 'execute_command') {
      throw new Error('expected execute_command decision')
    }
    expect(result.execution.command.action).toBe('move')
    expect(result.execution.command.data).toMatchObject({
      itemId: lastItem.id,
      newStartTime: '2026-03-25T15:10:00+08:00',
    })
  })

  it('会把第二条换成东方新闻识别为实际节目单顺序锚点替换', async () => {
    const firstItem = {
      ...mockedItem,
      id: 'item-0800',
      programName: '早间资讯',
      startTime: '08:00:00',
      endTime: '09:00:00',
    }
    const secondItem = {
      ...mockedItem,
      id: 'item-0900-iso',
      programName: '看东方',
      startTime: '2026-03-25T09:00:00+08:00',
      endTime: '2026-03-25T10:00:00+08:00',
    }
    await getAtomicCapabilities().appendItems([secondItem], { skipValidation: true })
    mockIntentRecognize.mockResolvedValue({
      type: 'replace',
      confidence: 0.96,
      reasoning: 'replace by ordinal',
    })
    mockExtractReplaceParams.mockResolvedValue(null)
    mockResolveTarget.mockResolvedValue({
      status: 'unique',
      selectedItem: { ...secondItem },
      reasoning: 'matched target by ordinal inferred time',
      matchedBy: ['time_window'],
      candidates: [{ ...secondItem }],
    })

    const facade = new DemoRuntimeFacade()

    const result = await facade.submitInstruction({
      scheduleState: createScheduleState(),
      userInput: '把第二条换成东方新闻',
      currentSchedule: [mockedItem, secondItem, firstItem],
      history: [],
    })

    expect(mockResolveTarget).toHaveBeenCalledWith(expect.objectContaining({
      targetTime: '09:00:00',
    }))
    expect(result.kind).toBe('pending_command')
    if (result.kind !== 'pending_command') {
      throw new Error('expected pending_command decision')
    }
    expect(result.pendingCommand.command.action).toBe('replace')
    expect(result.pendingCommand.command.data).toMatchObject({
      itemId: secondItem.id,
      newCandidateId: 'I103001-0001',
    })
  })

  it('会把删除看东方后面那条识别为相邻节目删除', async () => {
    const anchorItem = {
      ...mockedItem,
      id: 'item-0900-anchor',
      programName: '看东方',
      startTime: '09:00:00',
      endTime: '10:00:00',
    }
    const targetItem = {
      ...mockedItem,
      id: 'item-1000-target',
      programName: '东方快报',
      startTime: '10:00:00',
      endTime: '10:30:00',
      duration: 1800,
    }
    mockIntentRecognize.mockResolvedValue({
      type: 'delete',
      confidence: 0.96,
      reasoning: 'delete adjacent target',
    })
    mockExtractDeleteParams.mockResolvedValue(null)
    mockResolveTarget.mockResolvedValue({
      status: 'unique',
      selectedItem: { ...targetItem },
      reasoning: 'matched adjacent target',
      matchedBy: ['time_window', 'name_match'],
      candidates: [{ ...targetItem }],
    })

    const facade = new DemoRuntimeFacade()

    const result = await facade.submitInstruction({
      scheduleState: createScheduleState(),
      userInput: '删掉看东方后面那条',
      currentSchedule: [anchorItem, targetItem],
      history: [],
    })

    expect(mockResolveTarget).toHaveBeenCalledWith(expect.objectContaining({
      targetTime: '10:00:00',
      programName: '东方快报',
    }))
    expect(result.kind).toBe('pending_command')
    if (result.kind !== 'pending_command') {
      throw new Error('expected pending_command decision')
    }
    expect(result.pendingCommand.command.action).toBe('delete')
    expect(result.pendingCommand.command.data).toEqual({ itemId: targetItem.id })
  })

  it('会把看东方前一条后移识别为相邻节目移动', async () => {
    const targetItem = {
      ...mockedItem,
      id: 'item-0830-target',
      programName: '早间资讯',
      startTime: '08:30:00',
      endTime: '09:00:00',
      duration: 1800,
    }
    const anchorItem = {
      ...mockedItem,
      id: 'item-0900-anchor',
      programName: '看东方',
      startTime: '09:00:00',
      endTime: '10:00:00',
    }
    mockIntentRecognize.mockResolvedValue({
      type: 'move',
      confidence: 0.96,
      reasoning: 'move adjacent target',
    })
    mockExtractMoveParams.mockResolvedValue(null)
    mockResolveTarget.mockResolvedValue({
      status: 'unique',
      selectedItem: { ...targetItem },
      reasoning: 'matched adjacent target',
      matchedBy: ['time_window'],
      candidates: [{ ...targetItem }],
    })

    const facade = new DemoRuntimeFacade()

    const result = await facade.submitInstruction({
      scheduleState: createScheduleState(),
      userInput: '把看东方前一条后移10分钟',
      currentSchedule: [anchorItem, targetItem],
      history: [],
    })

    expect(mockResolveTarget).toHaveBeenCalledWith(expect.objectContaining({
      targetTime: '08:30:00',
    }))
    expect(result.kind).toBe('execute_command')
    if (result.kind !== 'execute_command') {
      throw new Error('expected execute_command decision')
    }
    expect(result.execution.command.action).toBe('move')
    expect(result.execution.command.data).toMatchObject({
      itemId: targetItem.id,
      newStartTime: '2026-03-25T08:40:00+08:00',
    })
  })

  it('会把看东方后面那条换成东方新闻识别为相邻节目替换', async () => {
    const anchorItem = {
      ...mockedItem,
      id: 'item-0900-anchor',
      programName: '看东方',
      startTime: '09:00:00',
      endTime: '10:00:00',
    }
    const targetItem = {
      ...mockedItem,
      id: 'item-1000-target',
      programName: '东方快报',
      startTime: '2026-03-25T10:00:00+08:00',
      endTime: '2026-03-25T10:30:00+08:00',
      duration: 1800,
    }
    await getAtomicCapabilities().appendItems([targetItem], { skipValidation: true })
    mockIntentRecognize.mockResolvedValue({
      type: 'replace',
      confidence: 0.96,
      reasoning: 'replace adjacent target',
    })
    mockExtractReplaceParams.mockResolvedValue(null)
    mockResolveTarget.mockResolvedValue({
      status: 'unique',
      selectedItem: { ...targetItem },
      reasoning: 'matched adjacent target',
      matchedBy: ['time_window'],
      candidates: [{ ...targetItem }],
    })

    const facade = new DemoRuntimeFacade()

    const result = await facade.submitInstruction({
      scheduleState: createScheduleState(),
      userInput: '把看东方后面那条换成东方新闻',
      currentSchedule: [anchorItem, targetItem],
      history: [],
    })

    expect(mockResolveTarget).toHaveBeenCalledWith(expect.objectContaining({
      targetTime: '10:00:00',
    }))
    expect(result.kind).toBe('pending_command')
    if (result.kind !== 'pending_command') {
      throw new Error('expected pending_command decision')
    }
    expect(result.pendingCommand.command.action).toBe('replace')
    expect(result.pendingCommand.command.data).toMatchObject({
      itemId: targetItem.id,
      newCandidateId: 'I103001-0001',
    })
  })

  it('相邻节目锚点命中多个目标时会进入目标选择', async () => {
    const firstAnchor = {
      ...mockedItem,
      id: 'item-0900-anchor',
      programName: '看东方',
      startTime: '09:00:00',
      endTime: '10:00:00',
    }
    const firstTarget = {
      ...mockedItem,
      id: 'item-1000-target',
      programName: '东方快报',
      startTime: '10:00:00',
      endTime: '10:30:00',
    }
    const secondAnchor = {
      ...mockedItem,
      id: 'item-1400-anchor',
      programName: '看东方',
      startTime: '14:00:00',
      endTime: '15:00:00',
    }
    const secondTarget = {
      ...mockedItem,
      id: 'item-1500-target',
      programName: '午后资讯',
      startTime: '15:00:00',
      endTime: '15:30:00',
    }
    mockIntentRecognize.mockResolvedValue({
      type: 'delete',
      confidence: 0.96,
      reasoning: 'delete adjacent duplicate anchors',
    })
    mockExtractDeleteParams.mockResolvedValue(null)

    const facade = new DemoRuntimeFacade()

    const result = await facade.submitInstruction({
      scheduleState: createScheduleState(),
      userInput: '删掉看东方后面那条',
      currentSchedule: [firstAnchor, firstTarget, secondAnchor, secondTarget],
      history: [],
    })

    expect(mockResolveTarget).not.toHaveBeenCalled()
    expect(result.kind).toBe('pending_atomic_context')
    if (result.kind !== 'pending_atomic_context') {
      throw new Error('expected pending_atomic_context decision')
    }
    expect(result.pendingAtomicContext.phase).toBe('selecting_target')
    expect(result.pendingAtomicContext.targetCandidates).toHaveLength(2)
  })

  it('会把删除10点到10点半那段识别为精确时间段删除', async () => {
    const targetItem = {
      ...mockedItem,
      id: 'item-1000-target',
      programName: '东方快报',
      startTime: '10:00:00',
      endTime: '10:30:00',
      duration: 1800,
    }
    mockIntentRecognize.mockResolvedValue({
      type: 'delete',
      confidence: 0.96,
      reasoning: 'delete by exact time range',
    })
    mockExtractDeleteParams.mockResolvedValue({
      targetTime: '10:00:00',
    })
    mockResolveTarget.mockResolvedValue({
      status: 'unique',
      selectedItem: { ...targetItem },
      reasoning: 'matched exact range target',
      matchedBy: ['time_window', 'name_match'],
      candidates: [{ ...targetItem }],
    })

    const facade = new DemoRuntimeFacade()

    const result = await facade.submitInstruction({
      scheduleState: createScheduleState(),
      userInput: '删掉10点到10点半那段',
      currentSchedule: [mockedItem, targetItem],
      history: [],
    })

    expect(mockResolveTarget).toHaveBeenCalledWith(expect.objectContaining({
      targetTime: '10:00:00',
      programName: '东方快报',
    }))
    expect(result.kind).toBe('pending_command')
    if (result.kind !== 'pending_command') {
      throw new Error('expected pending_command decision')
    }
    expect(result.pendingCommand.command.action).toBe('delete')
    expect(result.pendingCommand.command.data).toEqual({ itemId: targetItem.id })
  })

  it('会把8点半到9点这段后移识别为精确时间段移动', async () => {
    const targetItem = {
      ...mockedItem,
      id: 'item-0830-target',
      programName: '早间资讯',
      startTime: '08:30:00',
      endTime: '09:00:00',
      duration: 1800,
    }
    mockIntentRecognize.mockResolvedValue({
      type: 'move',
      confidence: 0.96,
      reasoning: 'move by exact time range',
    })
    mockExtractMoveParams.mockResolvedValue({
      targetTime: '08:30:00',
      direction: 'forward',
      offsetSeconds: 600,
    })
    mockResolveTarget.mockResolvedValue({
      status: 'unique',
      selectedItem: { ...targetItem },
      reasoning: 'matched exact range target',
      matchedBy: ['time_window'],
      candidates: [{ ...targetItem }],
    })

    const facade = new DemoRuntimeFacade()

    const result = await facade.submitInstruction({
      scheduleState: createScheduleState(),
      userInput: '把8点半到9点这段后移10分钟',
      currentSchedule: [targetItem, mockedItem],
      history: [],
    })

    expect(mockResolveTarget).toHaveBeenCalledWith(expect.objectContaining({
      targetTime: '08:30:00',
    }))
    expect(result.kind).toBe('execute_command')
    if (result.kind !== 'execute_command') {
      throw new Error('expected execute_command decision')
    }
    expect(result.execution.command.action).toBe('move')
    expect(result.execution.command.data).toMatchObject({
      itemId: targetItem.id,
      newStartTime: '2026-03-25T08:40:00+08:00',
    })
  })

  it('会把10:00-10:30这段换成东方新闻识别为精确时间段替换', async () => {
    const targetItem = {
      ...mockedItem,
      id: 'item-1000-target',
      programName: '东方快报',
      startTime: '2026-03-25T10:00:00+08:00',
      endTime: '2026-03-25T10:30:00+08:00',
      duration: 1800,
    }
    await getAtomicCapabilities().appendItems([targetItem], { skipValidation: true })
    mockIntentRecognize.mockResolvedValue({
      type: 'replace',
      confidence: 0.96,
      reasoning: 'replace by exact time range',
    })
    mockExtractReplaceParams.mockResolvedValue({
      targetTime: '10:00:00',
      programName: '东方新闻',
    })
    mockResolveTarget.mockResolvedValue({
      status: 'unique',
      selectedItem: { ...targetItem },
      reasoning: 'matched exact range target',
      matchedBy: ['time_window'],
      candidates: [{ ...targetItem }],
    })

    const facade = new DemoRuntimeFacade()

    const result = await facade.submitInstruction({
      scheduleState: createScheduleState(),
      userInput: '把10:00-10:30这段换成东方新闻',
      currentSchedule: [mockedItem, targetItem],
      history: [],
    })

    expect(mockResolveTarget).toHaveBeenCalledWith(expect.objectContaining({
      targetTime: '10:00:00',
    }))
    expect(result.kind).toBe('pending_command')
    if (result.kind !== 'pending_command') {
      throw new Error('expected pending_command decision')
    }
    expect(result.pendingCommand.command.action).toBe('replace')
    expect(result.pendingCommand.command.data).toMatchObject({
      itemId: targetItem.id,
      newCandidateId: 'I103001-0001',
    })
  })

  it('明确时间段没有完整匹配时不会误命中覆盖该起点的长节目', async () => {
    const longItem = {
      ...mockedItem,
      id: 'item-1000-long',
      programName: '长时段节目',
      startTime: '10:00:00',
      endTime: '11:00:00',
      duration: 3600,
    }
    mockIntentRecognize.mockResolvedValue({
      type: 'delete',
      confidence: 0.96,
      reasoning: 'delete by unmatched exact range',
    })
    mockExtractDeleteParams.mockResolvedValue({
      targetTime: '10:00:00',
    })

    const facade = new DemoRuntimeFacade()

    const result = await facade.submitInstruction({
      scheduleState: createScheduleState(),
      userInput: '删掉10点到10点半那段',
      currentSchedule: [longItem],
      history: [],
    })

    expect(mockResolveTarget).not.toHaveBeenCalled()
    expect(result.kind).toBe('pending_atomic_context')
    if (result.kind !== 'pending_atomic_context') {
      throw new Error('expected pending_atomic_context decision')
    }
    expect(result.feedback.content).toContain('没有找到与 10:00:00-10:30:00 完整匹配')
  })

  it('范围批量删除会生成预演，不会误走单条删除解析', async () => {
    const tenItem = {
      ...mockedItem,
      id: 'item-1000',
      programName: '上午资讯',
      startTime: '10:00:00',
      endTime: '11:00:00',
    }
    const noonItem = {
      ...mockedItem,
      id: 'item-1200',
      programName: '午间新闻',
      startTime: '12:00:00',
      endTime: '13:00:00',
    }

    const facade = new DemoRuntimeFacade()

    const result = await facade.submitInstruction({
      scheduleState: createScheduleState(),
      userInput: '删除当前9点到12点已编排的全部节目',
      currentSchedule: [mockedItem, tenItem, noonItem],
      history: [],
    })

    expect(mockIntentRecognize).not.toHaveBeenCalled()
    expect(mockResolveTarget).not.toHaveBeenCalled()
    expect(result.kind).toBe('pending_command')
    if (result.kind !== 'pending_command') {
      throw new Error('expected pending_command decision')
    }
    expect(result.feedback.processTypeLabel).toBe('待确认修改')
    expect(result.feedback.content).toContain('命中 2 条节目')
    expect(result.pendingCommand.commands).toHaveLength(2)
    expect(result.pendingCommand.details).toMatchObject({
      actionType: 'batch_delete',
      matchedCount: 2,
      isExecutable: true,
    })
  })

  it('中文时间范围批量删除会生成同样的预演', async () => {
    const tenItem = {
      ...mockedItem,
      id: 'item-1000',
      programName: '上午资讯',
      startTime: '10:00:00',
      endTime: '11:00:00',
    }
    const facade = new DemoRuntimeFacade()

    const result = await facade.submitInstruction({
      scheduleState: createScheduleState(),
      userInput: '删除当前九点到十二点已编排的全部节目',
      currentSchedule: [mockedItem, tenItem],
      history: [],
    })

    expect(mockIntentRecognize).not.toHaveBeenCalled()
    expect(mockResolveTarget).not.toHaveBeenCalled()
    expect(result.kind).toBe('pending_command')
    if (result.kind !== 'pending_command') {
      throw new Error('expected pending_command decision')
    }
    expect(result.pendingCommand.commands).toHaveLength(2)
    expect(result.pendingCommand.details).toMatchObject({
      actionType: 'batch_delete',
      matchedCount: 2,
      isExecutable: true,
    })
  })

  it('范围批量平移会生成预演并保留逐条拟操作，不直接改单条节目', async () => {
    const tenItem = {
      ...mockedItem,
      id: 'item-1000',
      programName: '上午资讯',
      startTime: '10:00:00',
      endTime: '11:00:00',
    }
    const facade = new DemoRuntimeFacade()

    const result = await facade.submitInstruction({
      scheduleState: createScheduleState(),
      userInput: '将现有9点到12点的节目整体后移5分钟',
      currentSchedule: [mockedItem, tenItem],
      history: [],
    })

    expect(mockIntentRecognize).not.toHaveBeenCalled()
    expect(mockResolveTarget).not.toHaveBeenCalled()
    expect(result.kind).toBe('pending_command')
    if (result.kind !== 'pending_command') {
      throw new Error('expected pending_command decision')
    }
    expect(result.feedback.processTypeLabel).toBe('待确认修改')
    expect(result.feedback.content).toContain('整体后移5分钟')
    expect(result.pendingCommand.commands).toHaveLength(2)
    expect(result.pendingCommand.details).toMatchObject({
      actionType: 'batch_move',
      matchedCount: 2,
      isExecutable: true,
    })
    expect(result.pendingCommand.details?.operations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        itemId: 'item-0900',
        proposedTimeRange: { start: '09:05:00', end: '10:05:00' },
      }),
    ]))
  })

  it('中文时间范围批量平移会生成预演并解析中文偏移', async () => {
    const tenItem = {
      ...mockedItem,
      id: 'item-1000',
      programName: '上午资讯',
      startTime: '10:00:00',
      endTime: '11:00:00',
    }
    const facade = new DemoRuntimeFacade()

    const result = await facade.submitInstruction({
      scheduleState: createScheduleState(),
      userInput: '将现有九点到十二点的节目整体后移五分钟',
      currentSchedule: [mockedItem, tenItem],
      history: [],
    })

    expect(mockIntentRecognize).not.toHaveBeenCalled()
    expect(mockResolveTarget).not.toHaveBeenCalled()
    expect(result.kind).toBe('pending_command')
    if (result.kind !== 'pending_command') {
      throw new Error('expected pending_command decision')
    }
    expect(result.pendingCommand.details).toMatchObject({
      actionType: 'batch_move',
      matchedCount: 2,
      isExecutable: true,
    })
    expect(result.pendingCommand.details?.operations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        itemId: 'item-0900',
        proposedTimeRange: { start: '09:05:00', end: '10:05:00' },
      }),
    ]))
  })

  it('精确中文半点时间段删除会定位到实际节目段', async () => {
    const afternoonItem = {
      ...mockedItem,
      id: 'item-1430',
      programName: '社区服务提醒',
      startTime: '14:30:00',
      endTime: '15:00:00',
    }
    mockResolveTarget.mockResolvedValue({
      status: 'unique',
      selectedItem: { ...afternoonItem },
      reasoning: 'matched explicit chinese range',
      matchedBy: ['time_range'],
      candidates: [{ ...afternoonItem }],
    })
    const facade = new DemoRuntimeFacade()

    const result = await facade.submitInstruction({
      scheduleState: createScheduleState(),
      userInput: '删掉两点半到三点那段',
      currentSchedule: [afternoonItem],
      history: [],
    })

    expect(result.kind).toBe('pending_command')
    if (result.kind !== 'pending_command') {
      throw new Error('expected pending_command decision')
    }
    expect(result.pendingCommand.command.action).toBe('delete')
    expect(result.pendingCommand.command.data).toMatchObject({
      itemId: 'item-1430',
    })
    expect(result.pendingCommand.details).toMatchObject({
      targetTime: '14:30:00',
      matchedItem: expect.objectContaining({
        id: 'item-1430',
        startTime: '14:30:00',
        endTime: '15:00:00',
      }),
      targetResolution: {
        matchedBy: ['time_range'],
      },
    })
  })

  it('范围批量平移缺少幅度时会追问幅度，不调用单条原子解析', async () => {
    const facade = new DemoRuntimeFacade()

    const result = await facade.submitInstruction({
      scheduleState: createScheduleState(),
      userInput: '把上午所有节目整体后移',
      currentSchedule: [mockedItem],
      history: [],
    })

    expect(mockIntentRecognize).not.toHaveBeenCalled()
    expect(mockResolveTarget).not.toHaveBeenCalled()
    expect(result.kind).toBe('message')
    if (result.kind !== 'message') {
      throw new Error('expected message decision')
    }
    expect(result.feedback.content).toContain('还缺少移动幅度')
    expect(result.feedback.details).toMatchObject({
      actionType: 'batch_move',
      matchedCount: 1,
      isExecutable: false,
      validation: {
        status: 'missing_offset',
      },
    })
  })

  it('单条移动支持中文数字移动幅度', async () => {
    mockIntentRecognize.mockResolvedValue({
      type: 'move',
      confidence: 0.96,
      reasoning: 'move first item by chinese offset',
    })
    mockExtractMoveParams.mockResolvedValue(null)
    mockResolveTarget.mockResolvedValue({
      status: 'unique',
      selectedItem: { ...mockedItem },
      reasoning: 'matched first item',
      matchedBy: ['time'],
      candidates: [{ ...mockedItem }],
    })
    const facade = new DemoRuntimeFacade()

    const result = await facade.submitInstruction({
      scheduleState: createScheduleState(),
      userInput: '把第一条后移五分钟',
      currentSchedule: [mockedItem],
      history: [],
    })

    expect(result.kind).toBe('execute_command')
    if (result.kind !== 'execute_command') {
      throw new Error('expected execute_command decision')
    }
    expect(result.execution.command.action).toBe('move')
    expect(result.execution.command.data).toMatchObject({
      itemId: mockedItem.id,
      newStartTime: '2026-03-25T09:05:00+08:00',
    })
  })

  it('确认批量删除预演后会统一删除命中节目', async () => {
    const tenItem = {
      ...mockedItem,
      id: 'item-1000',
      programName: '上午资讯',
      startTime: '10:00:00',
      endTime: '11:00:00',
    }
    const noonItem = {
      ...mockedItem,
      id: 'item-1200',
      programName: '午间新闻',
      startTime: '12:00:00',
      endTime: '13:00:00',
    }
    await getAtomicCapabilities().appendItems([mockedItem, tenItem, noonItem], { skipValidation: true })
    const facade = new DemoRuntimeFacade()

    const preview = await facade.submitInstruction({
      scheduleState: createScheduleState(),
      userInput: '删除当前9点到12点已编排的全部节目',
      currentSchedule: [mockedItem, tenItem, noonItem],
      history: [],
    })

    expect(preview.kind).toBe('pending_command')
    if (preview.kind !== 'pending_command') {
      throw new Error('expected pending_command decision')
    }

    const executed = await facade.executePendingCommand({
      pendingCommand: preview.pendingCommand,
      scheduleDate: '2026-03-25',
      channelId: 'dragon',
    })

    expect(executed.success).toBe(true)
    expect(getAtomicCapabilities().getItem('item-0900')).toBeUndefined()
    expect(getAtomicCapabilities().getItem('item-1000')).toBeUndefined()
    expect(getAtomicCapabilities().getItem('item-1200')).toBeDefined()
  })

  it('确认批量平移预演后会一次性写回整体平移结果', async () => {
    const tenItem = {
      ...mockedItem,
      id: 'item-1000',
      programName: '上午资讯',
      startTime: '10:00:00',
      endTime: '11:00:00',
    }
    await getAtomicCapabilities().appendItems([mockedItem, tenItem], { skipValidation: true })
    const facade = new DemoRuntimeFacade()

    const preview = await facade.submitInstruction({
      scheduleState: createScheduleState(),
      userInput: '将现有9点到12点的节目整体后移5分钟',
      currentSchedule: [mockedItem, tenItem],
      history: [],
    })

    expect(preview.kind).toBe('pending_command')
    if (preview.kind !== 'pending_command') {
      throw new Error('expected pending_command decision')
    }

    const executed = await facade.executePendingCommand({
      pendingCommand: preview.pendingCommand,
      scheduleDate: '2026-03-25',
      channelId: 'dragon',
    })

    expect(executed.success).toBe(true)
    expect(toClock(getAtomicCapabilities().getItem('item-0900')?.startTime)).toBe('09:05:00')
    expect(toClock(getAtomicCapabilities().getItem('item-1000')?.startTime)).toBe('10:05:00')
  })

  it('批量平移支持中文数字移动幅度', async () => {
    const tenItem = {
      ...mockedItem,
      id: 'item-1000',
      programName: '上午资讯',
      startTime: '10:00:00',
      endTime: '11:00:00',
    }
    await getAtomicCapabilities().appendItems([mockedItem, tenItem], { skipValidation: true })
    const facade = new DemoRuntimeFacade()

    const preview = await facade.submitInstruction({
      scheduleState: createScheduleState(),
      userInput: '将现有9点到12点的节目整体后移五分钟',
      currentSchedule: [mockedItem, tenItem],
      history: [],
    })

    expect(preview.kind).toBe('pending_command')
    if (preview.kind !== 'pending_command') {
      throw new Error('expected pending_command decision')
    }
    expect(preview.pendingCommand.details?.operations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        itemId: 'item-0900',
        proposedTimeRange: { start: '09:05:00', end: '10:05:00' },
      }),
    ]))
  })

  it('批量平移预演发现范围外冲突时不会生成可确认命令', async () => {
    const tenItem = {
      ...mockedItem,
      id: 'item-1000',
      programName: '上午资讯',
      startTime: '10:00:00',
      endTime: '11:00:00',
    }
    const outsideItem = {
      ...mockedItem,
      id: 'item-1105',
      programName: '范围外专题',
      startTime: '11:05:00',
      endTime: '12:00:00',
    }
    const facade = new DemoRuntimeFacade()

    const result = await facade.submitInstruction({
      scheduleState: createScheduleState(),
      userInput: '将现有9点到11点的节目整体后移10分钟',
      currentSchedule: [mockedItem, tenItem, outsideItem],
      history: [],
    })

    expect(result.kind).toBe('message')
    if (result.kind !== 'message') {
      throw new Error('expected message decision')
    }
    expect(result.feedback.content).toContain('暂不能执行')
    expect(result.feedback.details).toMatchObject({
      actionType: 'batch_move',
      isExecutable: false,
      validation: {
        status: 'blocked',
      },
    })
    expect(JSON.stringify(result.feedback.details?.validation)).toContain('范围外节目')
  })

  it('无时间节目名命中多条时不会自动删除，会进入目标选择', async () => {
    const laterItem = {
      ...mockedItem,
      id: 'item-1400',
      startTime: '14:00:00',
      endTime: '15:00:00',
    }
    mockIntentRecognize.mockResolvedValue({
      type: 'delete',
      confidence: 0.96,
      reasoning: 'delete by repeated program name',
    })
    mockExtractDeleteParams.mockResolvedValue(null)

    const facade = new DemoRuntimeFacade()

    const result = await facade.submitInstruction({
      scheduleState: createScheduleState(),
      userInput: '删除当前节目单里的看东方',
      currentSchedule: [mockedItem, laterItem],
      history: [],
    })

    expect(mockResolveTarget).not.toHaveBeenCalled()
    expect(result.kind).toBe('pending_atomic_context')
    if (result.kind !== 'pending_atomic_context') {
      throw new Error('expected pending_atomic_context decision')
    }
    expect(result.pendingAtomicContext.phase).toBe('selecting_target')
    expect(result.pendingAtomicContext.targetCandidates).toHaveLength(2)
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

  it('带时间的导视预告口语会优先走原子插入链路，不误进版面草案', async () => {
    mockIntentRecognize.mockResolvedValue({
      type: 'insert',
      confidence: 0.94,
      reasoning: 'casual insert intent',
    })
    mockExtractInsertParams.mockResolvedValue({
      targetTime: '10:00:00',
      rawProgramText: '现场导视',
      semanticLabel: '资讯',
      programTypeHint: 'news_magazine',
    })
    mockLayoutRecognize.mockResolvedValue({
      mode: 'layout_prepare',
      confidence: 0.99,
      reasoning: 'should not be used',
      ignoreExistingLayout: false,
    })

    const facade = new DemoRuntimeFacade()
    const result = await facade.submitInstruction({
      scheduleState: createScheduleState(),
      userInput: '10点后放一段现场导视',
      currentSchedule: [mockedItem],
      history: [],
    })

    expect(mockIntentRecognize).toHaveBeenCalledTimes(1)
    expect(mockExtractInsertParams).toHaveBeenCalledTimes(1)
    expect(mockLayoutRecognize).not.toHaveBeenCalled()
    expect(result.kind).not.toBe('layout_draft')
    if (result.kind === 'pending_insert_recommendation') {
      expect(result.pendingInsertRecommendation.targetTime).toBe('10:00:00')
      expect(result.pendingInsertRecommendation.rawProgramText).toBe('现场导视')
    }
    if (result.kind === 'pending_command') {
      expect(result.pendingCommand.command.action).toBe('insert')
    }
  })

  it('补充式插入命令会进入统一澄清并承接后续时间补参', async () => {
    mockIntentRecognize.mockResolvedValue({
      type: 'unsupported',
      confidence: 0.2,
      reasoning: 'short insert phrase',
    })
    mockExtractInsertParams.mockResolvedValue(null)
    mockLayoutRecognize.mockResolvedValue({
      mode: 'clarify',
      confidence: 0.2,
      reasoning: 'unused',
      ignoreExistingLayout: false,
    })

    const facade = new DemoRuntimeFacade()
    const first = await facade.submitInstruction({
      scheduleState: createScheduleState(),
      userInput: '插入',
      currentSchedule: [],
      history: [],
    })

    expect(first.kind).toBe('pending_atomic_context')
    if (first.kind !== 'pending_atomic_context') {
      throw new Error('expected pending_atomic_context decision')
    }
    expect(first.pendingAtomicContext.action).toBe('insert')
    expect(first.pendingAtomicContext.phase).toBe('clarifying')

    const second = await facade.submitInstruction({
      scheduleState: createScheduleState(),
      userInput: '10点',
      currentSchedule: [],
      pendingAtomicContext: first.pendingAtomicContext,
      history: [],
    })

    expect(second.kind).toBe('pending_atomic_context')
    if (second.kind !== 'pending_atomic_context') {
      throw new Error('expected pending_atomic_context decision')
    }
    expect(second.pendingAtomicContext.phase).toBe('clarifying')
    expect(second.pendingAtomicContext.slots.targetTime).toBe('10:00:00')
    expect(second.pendingAtomicContext.missingFields).toContain('program_name')
    expect(second.pendingAtomicContext.missingFields).not.toContain('target_time')
  })

  it('旧的原子上下文会给新的完整原子命令让路', async () => {
    mockIntentRecognize.mockResolvedValue({
      type: 'delete',
      confidence: 0.92,
      reasoning: 'fresh delete intent',
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
      userInput: '删除9点的节目',
      currentSchedule: [mockedItem],
      pendingAtomicContext: {
        action: 'insert',
        phase: 'clarifying',
        summary: '请补充插入参数',
        reasoning: 'pending insert clarification',
        originalUserInput: '插入节目',
        collectedUserInput: '插入节目',
        slots: {},
        missingFields: ['target_time', 'program_name'],
        followUpQuestion: '请补充目标时间点和节目名称。',
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

  it('用户没提时间时不会被误导到 09:00 的插入推荐', async () => {
    mockIntentRecognize.mockResolvedValue({
      type: 'insert',
      confidence: 0.9,
      reasoning: 'insert without explicit time',
    })
    mockExtractInsertParams.mockResolvedValue(null)
    mockLayoutRecognize.mockResolvedValue({
      mode: 'clarify',
      confidence: 0.2,
      reasoning: 'unused',
      ignoreExistingLayout: false,
    })

    const facade = new DemoRuntimeFacade()
    const result = await facade.submitInstruction({
      scheduleState: createScheduleState(),
      userInput: '插入看东方',
      currentSchedule: [mockedItem],
      history: [],
    })

    expect(result.kind).toBe('pending_atomic_context')
    if (result.kind !== 'pending_atomic_context') {
      throw new Error('expected pending_atomic_context decision')
    }

    expect(result.pendingAtomicContext.action).toBe('insert')
    expect(result.pendingAtomicContext.missingFields).toContain('target_time')
    expect(result.pendingAtomicContext.missingFields).not.toContain('program_name')
    expect(result.pendingAtomicContext.slots.targetTime).toBeUndefined()
    expect(result.pendingAtomicContext.slots.programName).toBe('看东方')
    expect(result.pendingAtomicContext.summary).not.toContain('09:00')
    expect(result.pendingAtomicContext.summary).not.toContain('09:00:00')
  })

  it('首轮已经说过节目名时，后续补时间不会再次追问节目名', async () => {
    mockIntentRecognize
      .mockResolvedValueOnce({
        type: 'insert',
        confidence: 0.9,
        reasoning: 'insert without explicit time',
      })
      .mockResolvedValueOnce({
        type: 'insert',
        confidence: 0.9,
        reasoning: 'insert with completed params',
      })
    mockExtractInsertParams
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        targetTime: '09:00:00',
        programName: '看东方',
        rawProgramText: '看东方',
      })
    mockLayoutRecognize.mockResolvedValue({
      mode: 'clarify',
      confidence: 0.2,
      reasoning: 'unused',
      ignoreExistingLayout: false,
    })

    const facade = new DemoRuntimeFacade()
    const first = await facade.submitInstruction({
      scheduleState: createScheduleState(),
      userInput: '插入看东方',
      currentSchedule: [mockedItem],
      history: [],
    })

    if (first.kind !== 'pending_atomic_context') {
      throw new Error('expected pending_atomic_context decision')
    }

    const second = await facade.submitInstruction({
      scheduleState: createScheduleState(),
      userInput: '9点',
      currentSchedule: [mockedItem],
      pendingAtomicContext: first.pendingAtomicContext,
      history: [],
    })

    expect(second.kind).toBe('pending_atomic_context')
    if (second.kind !== 'pending_atomic_context') {
      throw new Error('expected pending_atomic_context decision')
    }

    expect(second.pendingAtomicContext.phase).toBe('recommending_insert')
    expect(second.pendingAtomicContext.missingFields).toEqual(['selection'])
    expect(second.pendingAtomicContext.slots.programName).toBe('看东方')
    expect(second.pendingAtomicContext.slots.targetTime).toBe('09:00:00')
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
        expiresAt: '2099-04-16T16:13:00.000Z',
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
