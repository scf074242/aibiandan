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

const mockedItem = {
  id: 'item-0900',
  programCode: 'P100001',
  programName: '看东方',
  startTime: '09:00:00',
  endTime: '10:00:00',
  duration: 3600,
  programType: 'news',
}

describe('DemoRuntimeFacade playlist state policy', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    mockIntentRecognize.mockReset()
    mockExtractInsertParams.mockReset()
    mockExtractDeleteParams.mockReset()
    mockExtractMoveParams.mockReset()
    mockExtractReplaceParams.mockReset()
    mockLayoutRecognize.mockReset()
    mockResolveTarget.mockReset()
    mockLayoutRecognize.mockResolvedValue({
      mode: 'clarify',
      confidence: 0.2,
      reasoning: 'unused',
      ignoreExistingLayout: false,
    })
    resetCandidateService()
    resetAtomicCapabilities()
    await getAtomicCapabilities().clearAll()
  })

  it('未创建播单时会拒绝原子编排命令并提示先新建播单', async () => {
    const result = await new DemoRuntimeFacade().submitInstruction({
      scheduleState: createScheduleState({ playlistType: 'none' }),
      userInput: '9点插入看东方',
      currentSchedule: [],
      history: [],
    })

    expect(result.kind).toBe('message')
    if (result.kind !== 'message') throw new Error('expected message')
    expect(result.feedback.content).toContain('新建电视播单')
    expect(result.feedback.content).toContain('新建轮播单')
    expect(result.statusHint).toBe('needs_clarification')
  })

  it('支持新建电视播单并固定为电视频道策略', async () => {
    const result = await new DemoRuntimeFacade().submitInstruction({
      scheduleState: createScheduleState({ playlistType: 'none' }),
      userInput: '新建电视播单',
      currentSchedule: [],
      history: [],
    })

    expect(result.kind).toBe('message')
    if (result.kind !== 'message') throw new Error('expected message')
    expect(result.feedback.details?.playlistState).toMatchObject({
      playlistType: 'tv',
      rotationStrategy: undefined,
      channelId: 'dragon',
      channelName: '东方卫视',
      date: '2026-03-25',
    })
    expect(result.feedback.details?.playlistState).toHaveProperty('playlistId')
    expect(result.feedback.content).toContain('电视播单')
    expect(result.feedback.content).toContain('已同时加载当前频道和日期的版面草案')
    expect(result.feedback.details?.layoutDraftStatus).toBe('loaded')
    expect(result.feedback.details?.layoutDraftSource).toBe('channel_default')
    expect(result.feedback.details?.layoutDraftSlotCount).toBeGreaterThan(0)
  })

  it('电视播单文件状态会保留创建时频道与日期快照', async () => {
    const result = await new DemoRuntimeFacade().submitInstruction({
      scheduleState: createScheduleState({
        playlistType: 'none',
        channelId: 'news',
        channelName: '新闻综合',
        date: '2026-04-02',
      }),
      userInput: '创建频道节目单',
      currentSchedule: [],
      history: [],
    })

    expect(result.kind).toBe('message')
    if (result.kind !== 'message') throw new Error('expected message')
    expect(result.feedback.details?.playlistState).toMatchObject({
      playlistType: 'tv',
      channelId: 'news',
      channelName: '新闻综合',
      date: '2026-04-02',
    })
  })

  it('支持新建轮播单并默认内容匹配优先', async () => {
    const result = await new DemoRuntimeFacade().submitInstruction({
      scheduleState: createScheduleState({ playlistType: 'none' }),
      userInput: '新建轮播单',
      currentSchedule: [],
      history: [],
    })

    expect(result.kind).toBe('message')
    if (result.kind !== 'message') throw new Error('expected message')
    expect(result.feedback.details?.playlistState).toMatchObject({
      playlistType: 'rotation',
      rotationStrategy: 'content_match',
    })
    expect(result.feedback.details?.playlistState).toHaveProperty('playlistId')
    expect(result.feedback.content).toContain('内容匹配优先')
    expect(result.feedback.content).toContain('当前还不知道轮播要排多长')
    expect(result.feedback.details?.layoutDraftStatus).toBe('missing')
    expect(result.feedback.details?.needsStructuredBasis).toBe(true)
    expect(result.feedback.details?.suggestedActions).toEqual([
      '说明轮播总时长',
      '说明主要内容',
      '选择轮播策略',
      '上传或生成轮播草案',
    ])
  })

  it('创建轮播单带时长时按总时长和 0 点起算处理', async () => {
    const result = await new DemoRuntimeFacade().submitInstruction({
      scheduleState: createScheduleState({ playlistType: 'none' }),
      userInput: '创建一份3小时轮播单',
      currentSchedule: [],
      history: [],
    })

    expect(result.kind).toBe('message')
    if (result.kind !== 'message') throw new Error('expected message')
    expect(result.feedback.details?.playlistState).toMatchObject({
      playlistType: 'rotation',
      rotationStrategy: 'content_match',
      rotationDurationSeconds: 3 * 60 * 60,
    })
    expect(result.feedback.content).toContain('总时长 3小时')
    expect(result.feedback.content).toContain('0 点起算')
    expect(result.feedback.content).not.toContain('03:00:00')
    expect(result.feedback.content).toContain('不绑定具体日期和电视频道时段')
    expect(result.feedback.content).toContain('继续补充主要内容')
    expect(result.feedback.details?.needsStructuredBasis).toBe(false)
  })

  it('支持自然说法创建一份新媒体轮播单', async () => {
    const result = await new DemoRuntimeFacade().submitInstruction({
      scheduleState: createScheduleState({ playlistType: 'none' }),
      userInput: '帮我准备一份新媒体轮播单',
      currentSchedule: [],
      history: [],
    })

    expect(result.kind).toBe('message')
    if (result.kind !== 'message') throw new Error('expected message')
    expect(result.statusHint).toBe('accepted')
    expect(result.feedback.details?.playlistState).toMatchObject({
      playlistType: 'rotation',
      rotationStrategy: 'content_match',
    })
  })

  it('支持常见电视播单同义说法创建电视播单', async () => {
    const facade = new DemoRuntimeFacade()
    const inputs = [
      '开一版电视编排单',
      '创建一张频道节目单',
      '准备一份电视频道播出单',
    ]

    for (const userInput of inputs) {
      const result = await facade.submitInstruction({
        scheduleState: createScheduleState({ playlistType: 'none' }),
        userInput,
        currentSchedule: [],
        history: [],
      })

      expect(result.kind).toBe('message')
      if (result.kind !== 'message') throw new Error('expected message')
      expect(result.statusHint).toBe('accepted')
      expect(result.feedback.details?.playlistState).toMatchObject({
        playlistType: 'tv',
        rotationStrategy: undefined,
      })
    }
  })

  it('支持常见轮播单同义说法创建轮播单并保留策略', async () => {
    const facade = new DemoRuntimeFacade()
    const cases = [
      { userInput: '准备一张直播轮播表，热度优先', rotationStrategy: 'trending' },
      { userInput: '创建一版新媒体播单，收视率优先', rotationStrategy: 'rating' },
      { userInput: '开一个轮播节目单', rotationStrategy: 'content_match' },
    ] as const

    for (const { userInput, rotationStrategy } of cases) {
      const result = await facade.submitInstruction({
        scheduleState: createScheduleState({ playlistType: 'none' }),
        userInput,
        currentSchedule: [],
        history: [],
      })

      expect(result.kind).toBe('message')
      if (result.kind !== 'message') throw new Error('expected message')
      expect(result.statusHint).toBe('accepted')
      expect(result.feedback.details?.playlistState).toMatchObject({
        playlistType: 'rotation',
        rotationStrategy,
      })
    }
  })

  it('支持创建轮播单时直接指定收视率优先策略', async () => {
    const result = await new DemoRuntimeFacade().submitInstruction({
      scheduleState: createScheduleState({ playlistType: 'none' }),
      userInput: '新建一个收视率优先的轮播单',
      currentSchedule: [],
      history: [],
    })

    expect(result.kind).toBe('message')
    if (result.kind !== 'message') throw new Error('expected message')
    expect(result.statusHint).toBe('accepted')
    expect(result.feedback.details?.playlistState).toMatchObject({
      playlistType: 'rotation',
      rotationStrategy: 'rating',
    })
    expect(result.feedback.content).toContain('收视率优先')
  })

  it('支持创建轮播单时直接指定热播优先策略', async () => {
    const result = await new DemoRuntimeFacade().submitInstruction({
      scheduleState: createScheduleState({ playlistType: 'none' }),
      userInput: '帮我准备一份热播优先的新媒体轮播单',
      currentSchedule: [],
      history: [],
    })

    expect(result.kind).toBe('message')
    if (result.kind !== 'message') throw new Error('expected message')
    expect(result.statusHint).toBe('accepted')
    expect(result.feedback.details?.playlistState).toMatchObject({
      playlistType: 'rotation',
      rotationStrategy: 'trending',
    })
    expect(result.feedback.content).toContain('热播优先')
  })

  it('未建播单时带起止表达的轮播单需求会换算成从 0 点起算的总时长', async () => {
    const result = await new DemoRuntimeFacade().submitInstruction({
      scheduleState: createScheduleState({ playlistType: 'none' }),
      userInput: '我准备在静安寺进行户外直播，准备一个14:00到15:00的轮播单',
      currentSchedule: [],
      history: [],
    })

    expect(result.kind).toBe('message')
    if (result.kind !== 'message') throw new Error('expected message')
    expect(result.statusHint).toBe('accepted')
    expect(result.feedback.content).toContain('不绑定具体日期和电视频道时段')
    expect(result.feedback.content).toContain('总时长 1小时')
    expect(result.feedback.content).not.toContain('0 点起算')
    expect(result.feedback.content).not.toContain('14:00')
    expect(result.feedback.content).not.toContain('15:00')
    expect(result.layoutDraft?.draftKind).toBe('duration_segments')
    expect(result.layoutDraft?.targetDurationSeconds).toBe(60 * 60)
    expect(result.feedback.details?.playlistState).toMatchObject({
      playlistType: 'rotation',
      rotationStrategy: 'content_match',
      rotationDurationSeconds: 60 * 60,
    })
    expect(result.feedback.details?.playlistState).not.toHaveProperty('channelId')
    expect(result.feedback.details?.playlistState).not.toHaveProperty('date')
  })

  it('电视播单不允许切换为热播优先', async () => {
    const result = await new DemoRuntimeFacade().submitInstruction({
      scheduleState: createScheduleState({ playlistType: 'tv' }),
      userInput: '按热播优先',
      currentSchedule: [],
      history: [],
    })

    expect(result.kind).toBe('message')
    if (result.kind !== 'message') throw new Error('expected message')
    expect(result.statusHint).toBe('failed')
    expect(result.feedback.content).toContain('电视播单')
    expect(result.feedback.content).toContain('不能切换')
  })

  it('轮播单允许切换为收视率优先', async () => {
    const result = await new DemoRuntimeFacade().submitInstruction({
      scheduleState: createScheduleState({ playlistType: 'rotation', rotationStrategy: 'content_match' }),
      userInput: '按收视率优先',
      currentSchedule: [],
      history: [],
    })

    expect(result.kind).toBe('message')
    if (result.kind !== 'message') throw new Error('expected message')
    expect(result.feedback.details?.playlistState).toMatchObject({
      playlistType: 'rotation',
      rotationStrategy: 'rating',
    })
    expect(result.feedback.content).toContain('收视率优先')
  })

  it('电视播单下明确插入命令存在多个候选时等待用户选择', async () => {
    mockIntentRecognize.mockResolvedValue({
      type: 'insert',
      confidence: 0.96,
      reasoning: 'insert explicit tv',
    })
    mockExtractInsertParams.mockResolvedValue({
      targetTime: '18:30:00',
      programName: '东方新闻',
      rawProgramText: '东方新闻',
      semanticLabel: '新闻',
      programTypeHint: 'news',
    })

    const result = await new DemoRuntimeFacade().submitInstruction({
      scheduleState: createScheduleState({ playlistType: 'tv' }),
      userInput: '在18点30插入东方新闻',
      currentSchedule: [],
      history: [],
    })

    expect(result.kind).toBe('pending_atomic_context')
    if (result.kind !== 'pending_atomic_context') throw new Error('expected pending_atomic_context')
    expect(result.pendingAtomicContext.action).toBe('insert')
    expect(result.pendingAtomicContext.phase).toBe('recommending_insert')
    expect(result.pendingAtomicContext.insertRecommendations?.length).toBeGreaterThan(1)
  })

  it('轮播单下明确插入命令仍返回推荐列表等待用户选择', async () => {
    mockIntentRecognize.mockResolvedValue({
      type: 'insert',
      confidence: 0.96,
      reasoning: 'insert explicit rotation',
    })
    mockExtractInsertParams.mockResolvedValue({
      targetTime: '18:30:00',
      programName: '东方新闻',
      rawProgramText: '东方新闻',
      semanticLabel: '新闻',
      programTypeHint: 'news',
    })

    const result = await new DemoRuntimeFacade().submitInstruction({
      scheduleState: createScheduleState({ playlistType: 'rotation', rotationStrategy: 'content_match' }),
      userInput: '在18点30插入东方新闻',
      currentSchedule: [],
      history: [],
    })

    expect(result.kind).toBe('pending_atomic_context')
    if (result.kind !== 'pending_atomic_context') throw new Error('expected pending_atomic_context')
    expect(result.pendingAtomicContext.phase).toBe('recommending_insert')
    expect(result.pendingAtomicContext.insertRecommendations?.length).toBeGreaterThan(0)
  })

  it('轮播单下单点排入表达走插入候选推荐而不是版面草案', async () => {
    mockIntentRecognize.mockResolvedValue({
      type: 'insert',
      confidence: 0.96,
      reasoning: 'single clock insert with pai ru',
    })
    mockExtractInsertParams.mockResolvedValue({
      targetTime: '09:00:00',
      programName: '东方新闻',
      rawProgramText: '东方新闻',
      semanticLabel: '新闻',
      programTypeHint: 'news',
    })

    const result = await new DemoRuntimeFacade().submitInstruction({
      scheduleState: createScheduleState({ playlistType: 'rotation', rotationStrategy: 'content_match' }),
      userInput: '9点排入东方新闻',
      currentSchedule: [],
      history: [],
    })

    expect(result.kind).toBe('pending_atomic_context')
    if (result.kind !== 'pending_atomic_context') throw new Error('expected pending_atomic_context')
    expect(result.pendingAtomicContext.action).toBe('insert')
    expect(result.pendingAtomicContext.phase).toBe('recommending_insert')
    expect(result.pendingAtomicContext.slots.targetTime).toBe('09:00:00')
    expect(result.pendingAtomicContext.insertRecommendations?.length).toBeGreaterThan(0)
  })

  it('轮播单下单点插播表达走插入候选推荐', async () => {
    mockIntentRecognize.mockResolvedValue({
      type: 'insert',
      confidence: 0.96,
      reasoning: 'single clock insert with cha bo',
    })
    mockExtractInsertParams.mockResolvedValue({
      targetTime: '09:00:00',
      programName: '东方新闻',
      rawProgramText: '东方新闻',
      semanticLabel: '新闻',
      programTypeHint: 'news',
    })

    const result = await new DemoRuntimeFacade().submitInstruction({
      scheduleState: createScheduleState({ playlistType: 'rotation', rotationStrategy: 'content_match' }),
      userInput: '9点插播东方新闻',
      currentSchedule: [],
      history: [],
    })

    expect(result.kind).toBe('pending_atomic_context')
    if (result.kind !== 'pending_atomic_context') throw new Error('expected pending_atomic_context')
    expect(result.pendingAtomicContext.action).toBe('insert')
    expect(result.pendingAtomicContext.phase).toBe('recommending_insert')
    expect(result.pendingAtomicContext.slots.targetTime).toBe('09:00:00')
    expect(result.pendingAtomicContext.insertRecommendations?.length).toBeGreaterThan(0)
  })

  it('电视播单下按节目名锚点后方插入节目存在多个候选时等待用户选择', async () => {
    mockIntentRecognize.mockResolvedValue({
      type: 'insert',
      confidence: 0.96,
      reasoning: 'relative insert tv',
    })
    mockExtractInsertParams.mockResolvedValue(null)

    const result = await new DemoRuntimeFacade().submitInstruction({
      scheduleState: createScheduleState({ playlistType: 'tv', isEmpty: false, itemCount: 1 }),
      userInput: '在看东方后面插入东方新闻',
      currentSchedule: [mockedItem],
      history: [],
    })

    expect(result.kind).toBe('pending_atomic_context')
    if (result.kind !== 'pending_atomic_context') throw new Error('expected pending_atomic_context')
    expect(result.pendingAtomicContext.action).toBe('insert')
    expect(result.pendingAtomicContext.phase).toBe('recommending_insert')
    expect(result.pendingAtomicContext.slots.targetTime).toBe('10:00:00')
    expect(result.pendingAtomicContext.insertRecommendations?.length).toBeGreaterThan(1)
  })

  it('轮播单下按节目名锚点后方插入节目仍先返回候选推荐', async () => {
    mockIntentRecognize.mockResolvedValue({
      type: 'insert',
      confidence: 0.96,
      reasoning: 'relative insert rotation',
    })
    mockExtractInsertParams.mockResolvedValue(null)

    const result = await new DemoRuntimeFacade().submitInstruction({
      scheduleState: createScheduleState({ playlistType: 'rotation', rotationStrategy: 'content_match', isEmpty: false, itemCount: 1 }),
      userInput: '在看东方后面插入东方新闻',
      currentSchedule: [mockedItem],
      history: [],
    })

    expect(result.kind).toBe('pending_atomic_context')
    if (result.kind !== 'pending_atomic_context') throw new Error('expected pending_atomic_context')
    expect(result.pendingAtomicContext.phase).toBe('recommending_insert')
    expect(result.pendingAtomicContext.slots.targetTime).toBe('10:00:00')
    expect(result.pendingAtomicContext.insertRecommendations?.length).toBeGreaterThan(0)
  })

  it('电视播单下删除命令仍保持敏感确认', async () => {
    mockIntentRecognize.mockResolvedValue({
      type: 'delete',
      confidence: 0.96,
      reasoning: 'delete explicit',
    })
    mockExtractDeleteParams.mockResolvedValue({
      targetTime: '09:00:00',
    })
    mockResolveTarget.mockResolvedValue({
      status: 'unique',
      selectedItem: { ...mockedItem },
      reasoning: 'matched 09:00 item',
      matchedBy: ['time_window'],
      candidates: [{ ...mockedItem }],
    })

    const result = await new DemoRuntimeFacade().submitInstruction({
      scheduleState: createScheduleState({ playlistType: 'tv', isEmpty: false, itemCount: 1 }),
      userInput: '删除9点节目',
      currentSchedule: [mockedItem],
      history: [],
    })

    expect(result.kind).toBe('pending_command')
    if (result.kind !== 'pending_command') throw new Error('expected pending_command')
    expect(result.pendingCommand.command.action).toBe('delete')
  })

  it('电视播单下撤下类删除命令仍保持敏感确认', async () => {
    mockIntentRecognize.mockResolvedValue({
      type: 'delete',
      confidence: 0.96,
      reasoning: 'delete remove from air',
    })
    mockExtractDeleteParams.mockResolvedValue({
      targetTime: '09:00:00',
    })
    mockResolveTarget.mockResolvedValue({
      status: 'unique',
      selectedItem: { ...mockedItem },
      reasoning: 'matched 09:00 item',
      matchedBy: ['time_window'],
      candidates: [{ ...mockedItem }],
    })

    const result = await new DemoRuntimeFacade().submitInstruction({
      scheduleState: createScheduleState({ playlistType: 'tv', isEmpty: false, itemCount: 1 }),
      userInput: '撤下9点那条节目',
      currentSchedule: [mockedItem],
      history: [],
    })

    expect(result.kind).toBe('pending_command')
    if (result.kind !== 'pending_command') throw new Error('expected pending_command')
    expect(result.pendingCommand.command.action).toBe('delete')
    expect(result.pendingCommand.command.data).toEqual({ itemId: mockedItem.id })
  })

  it('电视播单下明确替换命令可直接执行', async () => {
    mockIntentRecognize.mockResolvedValue({
      type: 'replace',
      confidence: 0.96,
      reasoning: 'replace explicit tv',
    })
    mockExtractReplaceParams.mockResolvedValue({
      targetTime: '09:00:00',
      programName: '东方新闻',
    })
    mockResolveTarget.mockResolvedValue({
      status: 'unique',
      selectedItem: { ...mockedItem },
      reasoning: 'matched 09:00 item',
      matchedBy: ['time_window'],
      candidates: [{ ...mockedItem }],
    })
    await getAtomicCapabilities().appendItems([{
      ...mockedItem,
      startTime: '2026-03-25T09:00:00+08:00',
      endTime: '2026-03-25T10:00:00+08:00',
      sequence: 1,
    }], { skipValidation: true })

    const result = await new DemoRuntimeFacade().submitInstruction({
      scheduleState: createScheduleState({ playlistType: 'tv', isEmpty: false, itemCount: 1 }),
      userInput: '把9点的节目替换成东方新闻',
      currentSchedule: [mockedItem],
      history: [],
    })

    expect(result.kind).toBe('execute_command')
    if (result.kind !== 'execute_command') throw new Error('expected execute_command')
    expect(result.execution.command.action).toBe('replace')
    expect(result.execution.command.data.itemId).toBe(mockedItem.id)
  })

  it('电视播单下改播类替换命令也会进入短原子链路并直接执行', async () => {
    mockIntentRecognize.mockResolvedValue({
      type: 'replace',
      confidence: 0.96,
      reasoning: 'replace with gai bo synonym',
    })
    mockExtractReplaceParams.mockResolvedValue({
      targetTime: '09:00:00',
      programName: '东方新闻',
    })
    mockResolveTarget.mockResolvedValue({
      status: 'unique',
      selectedItem: { ...mockedItem },
      reasoning: 'matched 09:00 item',
      matchedBy: ['time_window'],
      candidates: [{ ...mockedItem }],
    })
    await getAtomicCapabilities().appendItems([{
      ...mockedItem,
      startTime: '2026-03-25T09:00:00+08:00',
      endTime: '2026-03-25T10:00:00+08:00',
      sequence: 1,
    }], { skipValidation: true })

    const result = await new DemoRuntimeFacade().submitInstruction({
      scheduleState: createScheduleState({ playlistType: 'tv', isEmpty: false, itemCount: 1 }),
      userInput: '9点改播东方新闻',
      currentSchedule: [mockedItem],
      history: [],
    })

    expect(result.kind).toBe('execute_command')
    if (result.kind !== 'execute_command') throw new Error('expected execute_command')
    expect(result.execution.command.action).toBe('replace')
    expect(result.execution.command.data.itemId).toBe(mockedItem.id)
  })

  it('轮播单下明确替换命令会先给候选并在用户选择后按队列压紧执行', async () => {
    mockIntentRecognize.mockResolvedValue({
      type: 'replace',
      confidence: 0.96,
      reasoning: 'replace explicit rotation',
    })
    mockExtractReplaceParams.mockResolvedValue({
      targetTime: '09:00:00',
      programName: '东方新闻',
    })
    mockResolveTarget.mockResolvedValue({
      status: 'unique',
      selectedItem: { ...mockedItem },
      reasoning: 'matched 09:00 item',
      matchedBy: ['time_window'],
      candidates: [{ ...mockedItem }],
    })
    const nextItem = {
      ...mockedItem,
      id: 'item-1000',
      programCode: 'P100002',
      programName: '城市导视',
      startTime: '10:00:00',
      endTime: '10:30:00',
      duration: 1800,
    }
    await getAtomicCapabilities().appendItems([{
      ...mockedItem,
      startTime: '2026-03-25T09:00:00+08:00',
      endTime: '2026-03-25T10:00:00+08:00',
      sequence: 1,
    }, {
      ...nextItem,
      startTime: '2026-03-25T10:00:00+08:00',
      endTime: '2026-03-25T10:30:00+08:00',
      sequence: 2,
    }], { skipValidation: true })

    const facade = new DemoRuntimeFacade()
    const first = await facade.submitInstruction({
      scheduleState: createScheduleState({ playlistType: 'rotation', rotationStrategy: 'content_match', isEmpty: false, itemCount: 1 }),
      userInput: '把9点的节目替换成东方新闻',
      currentSchedule: [mockedItem, nextItem],
      history: [],
    })

    expect(first.kind).toBe('pending_atomic_context')
    if (first.kind !== 'pending_atomic_context') throw new Error('expected pending_atomic_context')
    expect(first.pendingAtomicContext.action).toBe('replace')
    expect(first.pendingAtomicContext.phase).toBe('recommending_insert')
    expect(first.pendingAtomicContext.slots.targetItemId).toBe(mockedItem.id)
    expect(first.pendingAtomicContext.insertRecommendations?.length).toBeGreaterThan(0)

    const second = await facade.submitInstruction({
      scheduleState: createScheduleState({ playlistType: 'rotation', rotationStrategy: 'content_match', isEmpty: false, itemCount: 1 }),
      userInput: '第一个',
      currentSchedule: [mockedItem, nextItem],
      pendingAtomicContext: first.pendingAtomicContext,
      history: ['把9点的节目替换成东方新闻'],
    })

    expect(second.kind).toBe('agent_execution')
    if (second.kind !== 'agent_execution') throw new Error('expected agent_execution')
    expect(second.feedback.content).toContain('队列自然串联')
    const items = second.result.executionResult?.scheduleItems ?? []
    expect(items[0]?.id).toBe(mockedItem.id)
    expect(items[1]?.id).toBe(nextItem.id)
    expect(items[1]?.startTime).toBe(items[0]?.endTime)
  })

  it('轮播单下换播类替换命令仍然先给候选推荐', async () => {
    mockIntentRecognize.mockResolvedValue({
      type: 'replace',
      confidence: 0.96,
      reasoning: 'replace with huan bo synonym',
    })
    mockExtractReplaceParams.mockResolvedValue({
      targetTime: '09:00:00',
      programName: '东方新闻',
    })
    mockResolveTarget.mockResolvedValue({
      status: 'unique',
      selectedItem: { ...mockedItem },
      reasoning: 'matched 09:00 item',
      matchedBy: ['time_window'],
      candidates: [{ ...mockedItem }],
    })
    await getAtomicCapabilities().appendItems([{
      ...mockedItem,
      startTime: '2026-03-25T09:00:00+08:00',
      endTime: '2026-03-25T10:00:00+08:00',
      sequence: 1,
    }], { skipValidation: true })

    const result = await new DemoRuntimeFacade().submitInstruction({
      scheduleState: createScheduleState({ playlistType: 'rotation', rotationStrategy: 'content_match', isEmpty: false, itemCount: 1 }),
      userInput: '9点换播东方新闻',
      currentSchedule: [mockedItem],
      history: [],
    })

    expect(result.kind).toBe('pending_atomic_context')
    if (result.kind !== 'pending_atomic_context') throw new Error('expected pending_atomic_context')
    expect(result.pendingAtomicContext.action).toBe('replace')
    expect(result.pendingAtomicContext.phase).toBe('recommending_insert')
    expect(result.pendingAtomicContext.slots.targetItemId).toBe(mockedItem.id)
    expect(result.pendingAtomicContext.insertRecommendations?.length).toBeGreaterThan(0)
  })

  it('未创建播单时移动、删除、替换命令也会先要求创建播单', async () => {
    const facade = new DemoRuntimeFacade()
    const inputs = [
      '把9点的节目后移1小时',
      '删除9点的节目',
      '把9点的节目替换成东方新闻',
    ]

    for (const userInput of inputs) {
      const result = await facade.submitInstruction({
        scheduleState: createScheduleState({ playlistType: 'none' }),
        userInput,
        currentSchedule: [mockedItem],
        history: [],
      })

      expect(result.kind).toBe('message')
      if (result.kind !== 'message') throw new Error('expected message')
      expect(result.statusHint).toBe('needs_clarification')
      expect(result.feedback.details?.playlistState).toMatchObject({
        playlistType: 'none',
      })
    }
  })

  it('轮播单允许切换为热播优先', async () => {
    const result = await new DemoRuntimeFacade().submitInstruction({
      scheduleState: createScheduleState({ playlistType: 'rotation', rotationStrategy: 'content_match' }),
      userInput: '后面按热播优先',
      currentSchedule: [],
      history: [],
    })

    expect(result.kind).toBe('message')
    if (result.kind !== 'message') throw new Error('expected message')
    expect(result.feedback.details?.playlistState).toMatchObject({
      playlistType: 'rotation',
      rotationStrategy: 'trending',
    })
    expect(result.feedback.content).toContain('热播优先')
  })

  it('电视播单下移动命令会直接执行', async () => {
    mockIntentRecognize.mockResolvedValue({
      type: 'move',
      confidence: 0.96,
      reasoning: 'move explicit tv',
    })
    mockExtractMoveParams.mockResolvedValue({
      targetTime: '09:00:00',
      direction: 'forward',
      offsetSeconds: 3600,
    })
    mockResolveTarget.mockResolvedValue({
      status: 'unique',
      selectedItem: { ...mockedItem },
      reasoning: 'matched 09:00 item',
      matchedBy: ['time_window'],
      candidates: [{ ...mockedItem }],
    })

    const result = await new DemoRuntimeFacade().submitInstruction({
      scheduleState: createScheduleState({ playlistType: 'tv', isEmpty: false, itemCount: 1 }),
      userInput: '把9点的节目向后移动1小时',
      currentSchedule: [mockedItem],
      history: [],
    })

    expect(result.kind).toBe('execute_command')
    if (result.kind !== 'execute_command') throw new Error('expected execute_command')
    expect(result.execution.command.action).toBe('move')
    expect(result.execution.command.data).toMatchObject({
      itemId: mockedItem.id,
      newStartTime: '2026-03-25T10:00:00+08:00',
    })
  })

  it('电视播单下推迟类移动命令会直接后移而不是前移', async () => {
    mockIntentRecognize.mockResolvedValue({
      type: 'move',
      confidence: 0.96,
      reasoning: 'move delay explicit tv',
    })
    mockExtractMoveParams.mockResolvedValue({
      targetTime: '09:00:00',
      direction: 'forward',
      offsetSeconds: 1800,
    })
    mockResolveTarget.mockResolvedValue({
      status: 'unique',
      selectedItem: { ...mockedItem },
      reasoning: 'matched 09:00 item',
      matchedBy: ['time_window'],
      candidates: [{ ...mockedItem }],
    })

    const result = await new DemoRuntimeFacade().submitInstruction({
      scheduleState: createScheduleState({ playlistType: 'tv', isEmpty: false, itemCount: 1 }),
      userInput: '把9点节目推迟30分钟',
      currentSchedule: [mockedItem],
      history: [],
    })

    expect(result.kind).toBe('execute_command')
    if (result.kind !== 'execute_command') throw new Error('expected execute_command')
    expect(result.execution.command.action).toBe('move')
    expect(result.execution.command.data).toMatchObject({
      itemId: mockedItem.id,
      newStartTime: '2026-03-25T09:30:00+08:00',
    })
  })

  it('轮播单下移动命令不进入节目候选推荐而是直接执行', async () => {
    mockIntentRecognize.mockResolvedValue({
      type: 'move',
      confidence: 0.96,
      reasoning: 'move explicit rotation',
    })
    mockExtractMoveParams.mockResolvedValue({
      targetTime: '09:00:00',
      direction: 'forward',
      offsetSeconds: 3600,
    })
    mockResolveTarget.mockResolvedValue({
      status: 'unique',
      selectedItem: { ...mockedItem },
      reasoning: 'matched 09:00 item',
      matchedBy: ['time_window'],
      candidates: [{ ...mockedItem }],
    })

    const result = await new DemoRuntimeFacade().submitInstruction({
      scheduleState: createScheduleState({ playlistType: 'rotation', rotationStrategy: 'content_match', isEmpty: false, itemCount: 1 }),
      userInput: '把9点的节目向后移动1小时',
      currentSchedule: [mockedItem],
      history: [],
    })

    expect(result.kind).toBe('execute_command')
    if (result.kind !== 'execute_command') throw new Error('expected execute_command')
    expect(result.execution.command.action).toBe('move')
    expect(result.execution.command.data).toMatchObject({
      itemId: mockedItem.id,
      newStartTime: '2026-03-25T10:00:00+08:00',
    })
  })

  it('电视播单下唯一节目名后移命令不需要额外说当前节目单', async () => {
    mockIntentRecognize.mockResolvedValue({
      type: 'move',
      confidence: 0.96,
      reasoning: 'move by unique program name',
    })
    mockExtractMoveParams.mockResolvedValue(null)
    mockResolveTarget.mockResolvedValue({
      status: 'unique',
      selectedItem: { ...mockedItem },
      reasoning: 'matched unique program name',
      matchedBy: ['program_name'],
      candidates: [{ ...mockedItem }],
    })

    const result = await new DemoRuntimeFacade().submitInstruction({
      scheduleState: createScheduleState({ playlistType: 'tv', isEmpty: false, itemCount: 1 }),
      userInput: '把看东方后移30分钟',
      currentSchedule: [mockedItem],
      history: [],
    })

    expect(result.kind).toBe('execute_command')
    if (result.kind !== 'execute_command') throw new Error('expected execute_command')
    expect(result.execution.command.action).toBe('move')
    expect(result.execution.command.data).toMatchObject({
      itemId: mockedItem.id,
      newStartTime: '2026-03-25T09:30:00+08:00',
    })
  })

  it('电视播单下唯一节目名可直接移到指定绝对时间', async () => {
    mockIntentRecognize.mockResolvedValue({
      type: 'move',
      confidence: 0.96,
      reasoning: 'move by program name to absolute time',
    })
    mockExtractMoveParams.mockResolvedValue(null)

    const result = await new DemoRuntimeFacade().submitInstruction({
      scheduleState: createScheduleState({ playlistType: 'tv', isEmpty: false, itemCount: 1 }),
      userInput: '把看东方移到10点',
      currentSchedule: [mockedItem],
      history: [],
    })

    expect(result.kind).toBe('execute_command')
    if (result.kind !== 'execute_command') throw new Error('expected execute_command')
    expect(result.execution.command.action).toBe('move')
    expect(result.execution.command.data).toMatchObject({
      itemId: mockedItem.id,
      newStartTime: '2026-03-25T10:00:00+08:00',
    })
  })

  it('电视播单下可把指定时间节目移到新的绝对时间', async () => {
    mockIntentRecognize.mockResolvedValue({
      type: 'move',
      confidence: 0.96,
      reasoning: 'move by source time to absolute time',
    })
    mockExtractMoveParams.mockResolvedValue(null)
    mockResolveTarget.mockResolvedValue({
      status: 'unique',
      selectedItem: { ...mockedItem },
      reasoning: 'matched 09:00 item',
      matchedBy: ['time_window'],
      candidates: [{ ...mockedItem }],
    })

    const result = await new DemoRuntimeFacade().submitInstruction({
      scheduleState: createScheduleState({ playlistType: 'tv', isEmpty: false, itemCount: 1 }),
      userInput: '把9点的节目移到10点',
      currentSchedule: [mockedItem],
      history: [],
    })

    expect(result.kind).toBe('execute_command')
    if (result.kind !== 'execute_command') throw new Error('expected execute_command')
    expect(result.execution.command.action).toBe('move')
    expect(result.execution.command.data).toMatchObject({
      itemId: mockedItem.id,
      newStartTime: '2026-03-25T10:00:00+08:00',
    })
  })

  it('电视播单下唯一节目名删除命令不需要额外说当前节目单', async () => {
    mockIntentRecognize.mockResolvedValue({
      type: 'delete',
      confidence: 0.96,
      reasoning: 'delete by unique program name',
    })
    mockExtractDeleteParams.mockResolvedValue(null)
    mockResolveTarget.mockResolvedValue({
      status: 'unique',
      selectedItem: { ...mockedItem },
      reasoning: 'matched unique program name',
      matchedBy: ['program_name'],
      candidates: [{ ...mockedItem }],
    })

    const result = await new DemoRuntimeFacade().submitInstruction({
      scheduleState: createScheduleState({ playlistType: 'tv', isEmpty: false, itemCount: 1 }),
      userInput: '删除看东方',
      currentSchedule: [mockedItem],
      history: [],
    })

    expect(result.kind).toBe('pending_command')
    if (result.kind !== 'pending_command') throw new Error('expected pending_command')
    expect(result.pendingCommand.command.action).toBe('delete')
    expect(result.pendingCommand.command.data).toEqual({ itemId: mockedItem.id })
  })

  it('电视播单下唯一节目名替换命令不需要额外说当前节目单', async () => {
    mockIntentRecognize.mockResolvedValue({
      type: 'replace',
      confidence: 0.96,
      reasoning: 'replace by unique program name',
    })
    mockExtractReplaceParams.mockResolvedValue(null)
    mockResolveTarget.mockResolvedValue({
      status: 'unique',
      selectedItem: { ...mockedItem },
      reasoning: 'matched unique program name',
      matchedBy: ['program_name'],
      candidates: [{ ...mockedItem }],
    })
    await getAtomicCapabilities().appendItems([{
      ...mockedItem,
      startTime: '2026-03-25T09:00:00+08:00',
      endTime: '2026-03-25T10:00:00+08:00',
      sequence: 1,
    }], { skipValidation: true })

    const result = await new DemoRuntimeFacade().submitInstruction({
      scheduleState: createScheduleState({ playlistType: 'tv', isEmpty: false, itemCount: 1 }),
      userInput: '把看东方换成东方新闻',
      currentSchedule: [mockedItem],
      history: [],
    })

    expect(result.kind).toBe('execute_command')
    if (result.kind !== 'execute_command') throw new Error('expected execute_command')
    expect(result.execution.command.action).toBe('replace')
    expect(result.execution.command.data.itemId).toBe(mockedItem.id)
  })

  it('电视播单下低置信度原子命令不会直接执行', async () => {
    mockIntentRecognize.mockResolvedValue({
      type: 'unsupported',
      confidence: 0.2,
      reasoning: 'low confidence',
    })

    const result = await new DemoRuntimeFacade().submitInstruction({
      scheduleState: createScheduleState({ playlistType: 'tv', isEmpty: false, itemCount: 1 }),
      userInput: '帮我动一下',
      currentSchedule: [mockedItem],
      history: [],
    })

    expect(result.kind).not.toBe('execute_command')
    if (result.kind === 'pending_atomic_context') {
      expect(result.pendingAtomicContext.phase).toBe('clarifying')
    }
  })

  it('电视播单下目标不唯一时移动命令进入目标选择而不是直接执行', async () => {
    const secondItem = {
      ...mockedItem,
      id: 'item-0900-b',
      programName: '看东方 午间版',
    }
    mockIntentRecognize.mockResolvedValue({
      type: 'move',
      confidence: 0.96,
      reasoning: 'move ambiguous target',
    })
    mockExtractMoveParams.mockResolvedValue({
      targetTime: '09:00:00',
      direction: 'forward',
      offsetSeconds: 1800,
    })
    mockResolveTarget.mockResolvedValue({
      status: 'multiple',
      reasoning: 'matched multiple 09:00 items',
      matchedBy: ['time_window'],
      candidates: [{ ...mockedItem }, { ...secondItem }],
    })

    const result = await new DemoRuntimeFacade().submitInstruction({
      scheduleState: createScheduleState({ playlistType: 'tv', isEmpty: false, itemCount: 2 }),
      userInput: '把9点的节目后移半小时',
      currentSchedule: [mockedItem, secondItem],
      history: [],
    })

    expect(result.kind).toBe('pending_atomic_context')
    if (result.kind !== 'pending_atomic_context') throw new Error('expected pending_atomic_context')
    expect(result.pendingAtomicContext.action).toBe('move')
    expect(result.pendingAtomicContext.phase).toBe('selecting_target')
    expect(result.pendingAtomicContext.targetCandidates?.length).toBe(2)
  })

  it('轮播单下删除命令也保持敏感确认', async () => {
    mockIntentRecognize.mockResolvedValue({
      type: 'delete',
      confidence: 0.96,
      reasoning: 'delete explicit rotation',
    })
    mockExtractDeleteParams.mockResolvedValue({
      targetTime: '09:00:00',
    })
    mockResolveTarget.mockResolvedValue({
      status: 'unique',
      selectedItem: { ...mockedItem },
      reasoning: 'matched 09:00 item',
      matchedBy: ['time_window'],
      candidates: [{ ...mockedItem }],
    })

    const result = await new DemoRuntimeFacade().submitInstruction({
      scheduleState: createScheduleState({ playlistType: 'rotation', rotationStrategy: 'content_match', isEmpty: false, itemCount: 1 }),
      userInput: '删除9点的节目',
      currentSchedule: [mockedItem],
      history: [],
    })

    expect(result.kind).toBe('pending_command')
    if (result.kind !== 'pending_command') throw new Error('expected pending_command')
    expect(result.pendingCommand.command.action).toBe('delete')
  })

  it('轮播单候选推荐阶段输入新的删除命令会打断旧候选上下文', async () => {
    mockIntentRecognize.mockResolvedValue({
      type: 'insert',
      confidence: 0.96,
      reasoning: 'insert explicit rotation',
    })
    mockExtractInsertParams.mockResolvedValue({
      targetTime: '18:30:00',
      programName: '东方新闻',
      rawProgramText: '东方新闻',
      semanticLabel: '新闻',
      programTypeHint: 'news',
    })

    const facade = new DemoRuntimeFacade()
    const first = await facade.submitInstruction({
      scheduleState: createScheduleState({ playlistType: 'rotation', rotationStrategy: 'content_match', isEmpty: false, itemCount: 1 }),
      userInput: '在18点30插入东方新闻',
      currentSchedule: [mockedItem],
      history: [],
    })

    expect(first.kind).toBe('pending_atomic_context')
    if (first.kind !== 'pending_atomic_context') throw new Error('expected pending_atomic_context')
    expect(first.pendingAtomicContext.action).toBe('insert')

    mockIntentRecognize.mockResolvedValue({
      type: 'delete',
      confidence: 0.96,
      reasoning: 'delete interrupts insert recommendation',
    })
    mockExtractDeleteParams.mockResolvedValue({
      targetTime: '09:00:00',
    })
    mockResolveTarget.mockResolvedValue({
      status: 'unique',
      selectedItem: { ...mockedItem },
      reasoning: 'matched 09:00 item',
      matchedBy: ['time_window'],
      candidates: [{ ...mockedItem }],
    })

    const second = await facade.submitInstruction({
      scheduleState: createScheduleState({ playlistType: 'rotation', rotationStrategy: 'content_match', isEmpty: false, itemCount: 1 }),
      userInput: '删除9点的节目',
      currentSchedule: [mockedItem],
      pendingAtomicContext: first.pendingAtomicContext,
      history: ['在18点30插入东方新闻'],
    })

    expect(second.kind).toBe('pending_command')
    if (second.kind !== 'pending_command') throw new Error('expected pending_command')
    expect(second.pendingCommand.command.action).toBe('delete')
    expect(second.pendingCommand.command.data).toEqual({ itemId: mockedItem.id })
  })

  it('电视播单目标选择后的替换仍按电视策略直接执行', async () => {
    await getAtomicCapabilities().appendItems([{
      ...mockedItem,
      startTime: '2026-03-25T09:00:00+08:00',
      endTime: '2026-03-25T10:00:00+08:00',
      sequence: 1,
    }], { skipValidation: true })

    const result = await new DemoRuntimeFacade().resolvePendingTargetSelection({
      channelId: 'dragon',
      date: '2026-03-25',
      scheduleState: createScheduleState({ playlistType: 'tv', isEmpty: false, itemCount: 1 }),
      pendingTargetSelection: {
        action: 'replace',
        summary: '请选择要替换的节目',
        reasoning: 'replace after target selection tv',
        targetTime: '09:00:00',
        candidates: [{ ...mockedItem }],
        selectedItemId: mockedItem.id,
        replaceProgramName: '东方新闻',
      },
    })

    expect(result.kind).toBe('execute_command')
    if (result.kind !== 'execute_command') throw new Error('expected execute_command')
    expect(result.execution.command.action).toBe('replace')
    expect(result.execution.command.data.itemId).toBe(mockedItem.id)
  })

  it('轮播单目标选择后的替换仍按轮播策略返回候选推荐', async () => {
    await getAtomicCapabilities().appendItems([{
      ...mockedItem,
      startTime: '2026-03-25T09:00:00+08:00',
      endTime: '2026-03-25T10:00:00+08:00',
      sequence: 1,
    }], { skipValidation: true })

    const result = await new DemoRuntimeFacade().resolvePendingTargetSelection({
      channelId: 'dragon',
      date: '2026-03-25',
      scheduleState: createScheduleState({ playlistType: 'rotation', rotationStrategy: 'content_match', isEmpty: false, itemCount: 1 }),
      pendingTargetSelection: {
        action: 'replace',
        summary: '请选择要替换的节目',
        reasoning: 'replace after target selection rotation',
        targetTime: '09:00:00',
        candidates: [{ ...mockedItem }],
        selectedItemId: mockedItem.id,
        replaceProgramName: '东方新闻',
      },
    })

    expect(result.kind).toBe('pending_atomic_context')
    if (result.kind !== 'pending_atomic_context') throw new Error('expected pending_atomic_context')
    expect(result.pendingAtomicContext.action).toBe('replace')
    expect(result.pendingAtomicContext.phase).toBe('recommending_insert')
    expect(result.pendingAtomicContext.slots.targetItemId).toBe(mockedItem.id)
    expect(result.pendingAtomicContext.insertRecommendations?.length).toBeGreaterThan(0)
  })

  it('move command with full offset does not ask for offset again when target is missing', async () => {
    mockIntentRecognize.mockResolvedValue({
      type: 'move',
      confidence: 0.96,
      reasoning: 'move explicit missing target',
    })
    mockExtractMoveParams.mockResolvedValue({
      targetTime: '22:00:00',
      direction: 'forward',
      offsetSeconds: 3600,
    })
    mockResolveTarget.mockResolvedValue({
      status: 'none',
      reasoning: 'no 22:00 item',
      matchedBy: ['time_anchor'],
      candidates: [],
    })

    const result = await new DemoRuntimeFacade().submitInstruction({
      scheduleState: createScheduleState({ playlistType: 'tv', isEmpty: false, itemCount: 1 }),
      userInput: '\u628a22\u70b9\u7684\u8282\u76ee\u5411\u540e\u79fb\u52a81\u5c0f\u65f6',
      currentSchedule: [mockedItem],
      history: [],
    })

    expect(result.kind).toBe('message')
    if (result.kind !== 'message') throw new Error('expected message')
    expect(result.statusHint).toBeUndefined()
    expect(result.feedback.content).toContain('22:00:00')
    expect(result.feedback.content).not.toContain('\u79fb\u52a8\u5e45\u5ea6')
  })

  it('tv playlist asks the user to choose when explicit title has similar candidates', async () => {
    mockIntentRecognize.mockResolvedValue({
      type: 'insert',
      confidence: 0.96,
      reasoning: 'insert explicit tv with similar candidates',
    })
    mockExtractInsertParams.mockResolvedValue({
      targetTime: '09:00:00',
      programName: '\u770b\u4e1c\u65b9',
      rawProgramText: '\u770b\u4e1c\u65b9',
      semanticLabel: '\u770b\u4e1c\u65b9',
      programTypeHint: 'news_magazine',
    })

    const result = await new DemoRuntimeFacade().submitInstruction({
      scheduleState: createScheduleState({ playlistType: 'tv' }),
      userInput: '\u57289\u70b9\u63d2\u5165\u8282\u76ee\u770b\u4e1c\u65b9',
      currentSchedule: [],
      history: [],
    })

    expect(result.kind).toBe('pending_atomic_context')
    if (result.kind !== 'pending_atomic_context') throw new Error('expected pending_atomic_context')
    expect(result.pendingAtomicContext.action).toBe('insert')
    expect(result.pendingAtomicContext.phase).toBe('recommending_insert')
    expect(result.pendingAtomicContext.slots.targetTime).toBe('09:00:00')
    expect(result.pendingAtomicContext.insertRecommendations?.length).toBeGreaterThan(1)
  })

  it('explicit insert title with no hard keyword match is blocked instead of falling back to unrelated candidates', async () => {
    mockIntentRecognize.mockResolvedValue({
      type: 'insert',
      confidence: 0.96,
      reasoning: 'insert explicit unmatched title',
    })
    mockExtractInsertParams.mockResolvedValue({
      targetTime: '12:45:00',
      programName: '\u751f\u547d\u6811\u7535\u89c6\u5267',
      rawProgramText: '\u751f\u547d\u6811\u7535\u89c6\u5267',
      semanticLabel: '\u751f\u547d\u6811\u7535\u89c6\u5267',
      programTypeHint: 'drama',
    })

    const result = await new DemoRuntimeFacade().submitInstruction({
      scheduleState: createScheduleState({ playlistType: 'tv' }),
      userInput: '12:45\u63d2\u5165\u751f\u547d\u6811\u7535\u89c6\u5267',
      currentSchedule: [],
      history: [],
    })

    expect(result.kind).toBe('message')
    if (result.kind !== 'message') throw new Error('expected message')
    expect(result.feedback.details?.rejectedReason).toBe('insert_keyword_no_match')
    expect(result.feedback.details?.candidateCount).toBe(0)
    expect(result.feedback.content).toContain('\u751f\u547d\u6811\u7535\u89c6\u5267')
  })

  it('tv playlist asks before inserting a semantic live-guide candidate when multiple candidates remain', async () => {
    mockIntentRecognize.mockResolvedValue({
      type: 'insert',
      confidence: 0.96,
      reasoning: 'insert semantic tv',
    })
    mockExtractInsertParams.mockResolvedValue({
      targetTime: '14:00:00',
      rawProgramText: '\u9759\u5b89\u5bfa\u5916\u573a\u76f4\u64ad\u5bfc\u89c6',
      semanticLabel: '\u9759\u5b89\u5bfa\u5916\u573a\u76f4\u64ad\u5bfc\u89c6',
      programTypeHint: 'news_magazine',
    })

    const result = await new DemoRuntimeFacade().submitInstruction({
      scheduleState: createScheduleState({ playlistType: 'tv' }),
      userInput: '14\u70b9\u63d2\u5165\u4e00\u6bb5\u9759\u5b89\u5bfa\u5916\u573a\u76f4\u64ad\u5bfc\u89c6',
      currentSchedule: [],
      history: [],
    })

    expect(result.kind).toBe('pending_atomic_context')
    if (result.kind !== 'pending_atomic_context') throw new Error('expected pending_atomic_context')
    expect(result.pendingAtomicContext.action).toBe('insert')
    expect(result.pendingAtomicContext.phase).toBe('recommending_insert')
    expect(result.pendingAtomicContext.slots.targetTime).toBe('14:00:00')
    expect(result.pendingAtomicContext.insertRecommendations?.length).toBeGreaterThan(1)
  })

  it('tv playlist does not directly execute vague low-match semantic insert intent', async () => {
    mockIntentRecognize.mockResolvedValue({
      type: 'insert',
      confidence: 0.94,
      reasoning: 'insert vague tv',
    })
    mockExtractInsertParams.mockResolvedValue({
      targetTime: '14:00:00',
      rawProgramText: '\u70ed\u95f9\u7684\u5185\u5bb9',
      semanticLabel: '\u5a31\u4e50',
      programTypeHint: 'entertainment',
    })

    const result = await new DemoRuntimeFacade().submitInstruction({
      scheduleState: createScheduleState({ playlistType: 'tv' }),
      userInput: '14\u70b9\u6765\u70b9\u70ed\u95f9\u7684\u5185\u5bb9',
      currentSchedule: [],
      history: [],
    })

    expect(result.kind).not.toBe('execute_command')
    if (result.kind === 'pending_atomic_context') {
      expect(['clarifying', 'recommending_insert']).toContain(result.pendingAtomicContext.phase)
    } else if (result.kind === 'message') {
      expect(result.feedback.details?.rejectedReason).not.toBe('insert_keyword_no_match')
    } else {
      throw new Error('expected message or pending_atomic_context')
    }
  })

  it('replace title with no hard keyword match is blocked instead of using unrelated candidates', async () => {
    const missingProgramName = '\u751f\u547d\u6811\u7535\u89c6\u5267'
    mockIntentRecognize.mockResolvedValue({
      type: 'replace',
      confidence: 0.96,
      reasoning: 'replace explicit missing title',
    })
    mockExtractReplaceParams.mockResolvedValue({
      targetTime: '09:00:00',
      programName: missingProgramName,
    })
    mockResolveTarget.mockResolvedValue({
      status: 'unique',
      selectedItem: { ...mockedItem },
      reasoning: 'matched 09:00 item',
      matchedBy: ['time_window'],
      candidates: [{ ...mockedItem }],
    })
    await getAtomicCapabilities().appendItems([{
      ...mockedItem,
      startTime: '2026-03-25T09:00:00+08:00',
      endTime: '2026-03-25T10:00:00+08:00',
      sequence: 1,
    }], { skipValidation: true })

    const result = await new DemoRuntimeFacade().submitInstruction({
      scheduleState: createScheduleState({ playlistType: 'tv', isEmpty: false, itemCount: 1 }),
      userInput: '\u628a9\u70b9\u7684\u8282\u76ee\u66ff\u6362\u6210\u751f\u547d\u6811\u7535\u89c6\u5267',
      currentSchedule: [mockedItem],
      history: [],
    })

    expect(result.kind).toBe('message')
    if (result.kind !== 'message') throw new Error('expected message')
    expect(result.feedback.content).toContain(missingProgramName)
    expect(result.feedback.details?.rejectedReason).toBe('replace_keyword_no_match')
    expect(result.feedback.details?.candidateCount).toBe(0)
  })

  it('Agent Core feedback details expose pending and used LLM contexts across turns', async () => {
    const facade = new DemoRuntimeFacade()
    const scheduleState = createScheduleState({
      playlistType: 'rotation',
      rotationStrategy: 'content_match',
      isEmpty: true,
      itemCount: 0,
    })

    const first = await facade.submitInstruction({
      scheduleState,
      userInput: '\u63d2\u5165\u770b\u4e1c\u65b9',
      currentSchedule: [],
      history: [],
      agentCoreEnabled: true,
    })

    expect(first.kind).toBe('pending_atomic_context')
    if (first.kind !== 'pending_atomic_context') throw new Error('expected pending_atomic_context')
    expect(first.feedback.details?.agentPendingLlmContext).toMatchObject({
      latestUserInput: '',
      pendingContext: {
        intent: 'insert',
        phase: 'needs_clarification',
        collectedSlots: {
          programHint: '\u770b\u4e1c\u65b9',
        },
        missingSlots: ['targetTime'],
      },
    })
    expect(first.feedback.details?.agentLlmContextUsed).toBeUndefined()

    const second = await facade.submitInstruction({
      scheduleState,
      userInput: '10\u70b9',
      currentSchedule: [],
      history: ['\u63d2\u5165\u770b\u4e1c\u65b9'],
      pendingAtomicContext: first.pendingAtomicContext,
      agentCoreEnabled: true,
    })

    expect(second.kind).toBe('pending_atomic_context')
    if (second.kind !== 'pending_atomic_context') throw new Error('expected pending_atomic_context')
    expect(second.feedback.details?.agentLlmContextUsed).toMatchObject({
      latestUserInput: '10\u70b9',
      pendingContext: {
        intent: 'insert',
        phase: 'needs_clarification',
        collectedSlots: {
          programHint: '\u770b\u4e1c\u65b9',
        },
        missingSlots: ['targetTime'],
      },
    })
    expect(second.feedback.details?.agentPendingLlmContext).toMatchObject({
      latestUserInput: '',
      pendingContext: {
        intent: 'insert',
        phase: 'needs_selection',
        missingSlots: ['candidateId'],
      },
    })
  })

  it('Agent Core pending candidate selection can be cancelled with a clear no-write reply', async () => {
    const facade = new DemoRuntimeFacade()
    const scheduleState = createScheduleState({
      playlistType: 'rotation',
      rotationStrategy: 'content_match',
      isEmpty: true,
      itemCount: 0,
    })

    const first = await facade.submitInstruction({
      scheduleState,
      userInput: '插入看东方',
      currentSchedule: [],
      history: [],
      agentCoreEnabled: true,
    })
    expect(first.kind).toBe('pending_atomic_context')
    if (first.kind !== 'pending_atomic_context') throw new Error('expected pending_atomic_context')

    const confirmation = await facade.submitInstruction({
      scheduleState,
      userInput: '10点',
      currentSchedule: [],
      history: ['插入看东方'],
      pendingAtomicContext: first.pendingAtomicContext,
      agentCoreEnabled: true,
    })
    expect(confirmation.kind).toBe('pending_atomic_context')
    if (confirmation.kind !== 'pending_atomic_context') throw new Error('expected pending selection')
    expect(confirmation.pendingAtomicContext.agentPendingTask?.phase).toBe('needs_selection')

    const cancelled = await facade.submitInstruction({
      scheduleState,
      userInput: '取消',
      currentSchedule: [],
      history: ['插入看东方', '10点'],
      pendingAtomicContext: confirmation.pendingAtomicContext,
      agentCoreEnabled: true,
    })

    expect(cancelled.kind).toBe('message')
    if (cancelled.kind !== 'message') throw new Error('expected cancellation message')
    expect(cancelled.feedback.content).toContain('已取消')
    expect(cancelled.feedback.content).toContain('不会写入当前播单')
    expect(cancelled.feedback.details?.affectedItemIds).toBeUndefined()
  })

  it('Agent Core query replies with the found schedule item in the main feedback text', async () => {
    const result = await new DemoRuntimeFacade().submitInstruction({
      scheduleState: createScheduleState({ playlistType: 'tv', isEmpty: false, itemCount: 1 }),
      userInput: '9点是什么节目',
      currentSchedule: [mockedItem],
      history: [],
      agentCoreEnabled: true,
      layoutDraftEnabled: false,
    })

    expect(result.kind).toBe('message')
    if (result.kind !== 'message') throw new Error('expected message')
    expect(result.statusHint).toBe('completed')
    expect(result.feedback.content).toContain('09:00:00')
    expect(result.feedback.content).toContain('看东方')
    expect(result.feedback.details?.queryResult).toMatchObject({
      kind: 'time_lookup',
      totalCount: 1,
    })
    expect(result.feedback.details?.affectedItemIds).toBeUndefined()
  })

  it('queries the current playlist as an overview instead of treating playlist as a programme name', async () => {
    const result = await new DemoRuntimeFacade().submitInstruction({
      scheduleState: createScheduleState({ playlistType: 'rotation', isEmpty: false, itemCount: 1 }),
      userInput: '查询当前播单',
      currentSchedule: [mockedItem],
      history: [],
      agentCoreEnabled: true,
      layoutDraftEnabled: false,
    })

    expect(result.kind).toBe('message')
    if (result.kind !== 'message') throw new Error('expected message')
    expect(result.statusHint).toBe('completed')
    expect(result.feedback.content).toContain('当前轮播单共有 1 条节目')
    expect(result.feedback.content).not.toContain('和“播单”匹配')
    expect(result.feedback.details?.queryResult).toMatchObject({
      kind: 'schedule_overview',
      totalCount: 1,
    })
    expect(result.feedback.details?.affectedItemIds).toBeUndefined()
  })

  it('Agent Core occupied move blocks with conflict programme details for foreground feedback', async () => {
    const conflictItem = {
      id: 'item-1000',
      programCode: 'P100002',
      programName: '东方新闻',
      startTime: '10:00:00',
      endTime: '11:00:00',
      duration: 3600,
      programType: 'news',
    }

    const result = await new DemoRuntimeFacade().submitInstruction({
      scheduleState: createScheduleState({ playlistType: 'tv', isEmpty: false, itemCount: 2 }),
      userInput: '把9点的节目向后移动1小时',
      currentSchedule: [mockedItem, conflictItem],
      history: [],
      agentCoreEnabled: true,
      layoutDraftEnabled: false,
    })

    expect(result.kind).toBe('message')
    if (result.kind !== 'message') throw new Error('expected message')
    expect(result.statusHint).toBe('failed')
    expect(result.feedback.content).toContain('东方新闻')
    expect(result.feedback.content).toContain('不会自动下移、替换或重排')
    expect(result.feedback.details?.constraintReport).toMatchObject({
      issues: [{
        code: 'time_overlap',
        detail: {
          conflictItemId: 'item-1000',
          conflictProgramName: '东方新闻',
          blockedPolicy: 'no_auto_shift_replace_reorder',
        },
      }],
    })
    expect(result.feedback.details?.affectedItemIds).toBeUndefined()
  })

  it('Agent Core candidate misses keep search evidence out of the main assistant reply', async () => {
    const facade = new DemoRuntimeFacade()
    const scheduleState = createScheduleState({
      playlistType: 'tv',
      isEmpty: true,
      itemCount: 0,
    })

    const result = await facade.submitInstruction({
      scheduleState,
      userInput: '10点插入不存在的晨间特别节目XYZ',
      currentSchedule: [],
      history: [],
      agentCoreEnabled: true,
    })

    expect(result.kind).toBe('pending_atomic_context')
    if (result.kind !== 'pending_atomic_context') throw new Error('expected pending_atomic_context')
    expect(result.feedback.content).toContain('我先按')
    expect(result.feedback.content).toContain('查了当前候选库')
    expect(result.feedback.content).toContain('你可以补充栏目名、节目标题或更具体的内容线索')
    expect(result.feedback.content).not.toMatch(/简要检索结果|模型先抓取关键词|候选源|结构化|上下文/u)
    expect(result.feedback.details?.constraintReport).toMatchObject({
      issues: [
        expect.objectContaining({
          code: 'program_not_found',
          detail: expect.objectContaining({
            nextAction: 'rewrite_keywords_and_retry',
          }),
        }),
      ],
    })
  })

  it('Agent Core rotation short-clip confirmation separates the assistant reply from process evidence', async () => {
    const result = await new DemoRuntimeFacade().submitInstruction({
      scheduleState: createScheduleState({
        playlistType: 'rotation',
        rotationStrategy: 'content_match',
        rotationDurationSeconds: 3 * 60 * 60,
        isEmpty: true,
        itemCount: 0,
      }),
      userInput: '1点插入城市形象春日花路短片',
      currentSchedule: [],
      history: [],
      agentCoreEnabled: true,
      layoutDraftEnabled: false,
    })

    expect(result.kind).toBe('pending_atomic_context')
    if (result.kind !== 'pending_atomic_context') throw new Error('expected pending_atomic_context')
    expect(result.feedback.content).toContain('城市微短片：春日花路 30秒')
    expect(result.feedback.content).toContain('需要确认')
    expect(result.feedback.content).not.toMatch(/检索结果|候选源返回|候选源|结构化|上下文|runtime|接口/u)
    expect(result.feedback.details?.assistantProcessSummary).toContain('已找到 1 个可参考候选。')
    expect(result.pendingAtomicContext.agentPendingTask?.phase).toBe('needs_confirmation')
    expect(result.feedback.details?.auditSummary).toMatchObject({
      contextSources: {
        candidates: expect.objectContaining({
          query: expect.objectContaining({
            keyword: '城市形象春日花路短片',
          }),
        }),
      },
    })
  })

  it('Agent Core candidate lookup includes LLM search alternatives as retry keywords', () => {
    const facade = new DemoRuntimeFacade()
    const queries = (facade as unknown as {
      buildAgentCandidateQueries(input: {
        userInput: string
        channelId: string
        date: string
        interpretation: {
          intent: 'insert'
          confidence: number
          source: 'test'
          slots: { programHint: string }
          searchAlternatives: string[]
        }
      }, channelId: string): Array<{ keyword?: string }>
    }).buildAgentCandidateQueries({
      userInput: '10点插入上视早间资讯',
      channelId: 'dragon',
      date: '2026-03-25',
      interpretation: {
        intent: 'insert',
        confidence: 1,
        source: 'test',
        slots: { programHint: '上视早间资讯' },
        searchAlternatives: ['上海早新闻', '东方卫视 早新闻'],
      },
    }, 'dragon')

    expect(queries.map((query) => query.keyword)).toEqual([
      '上视早间资讯',
      '上海早新闻',
      '东方卫视早新闻',
    ])
  })
})
