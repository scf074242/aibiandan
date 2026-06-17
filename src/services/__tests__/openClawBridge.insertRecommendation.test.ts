import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockSubmitInstruction = vi.fn()
const mockExecutePendingCommand = vi.fn()
const mockResolvePendingTargetSelection = vi.fn()
const mockResolvePendingInsertRecommendation = vi.fn()

vi.mock('@/services/runtime/demoRuntimeFacade', () => ({
  getDemoRuntimeFacade: () => ({
    submitInstruction: mockSubmitInstruction,
    executePendingCommand: mockExecutePendingCommand,
    resolvePendingTargetSelection: mockResolvePendingTargetSelection,
    resolvePendingInsertRecommendation: mockResolvePendingInsertRecommendation,
  }),
}))

import { OpenClawBridge } from '@/services/openclaw/openClawBridge'

describe('OpenClawBridge insert recommendation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('会把插入推荐确认态保存到桥接会话，并标记为 needs_selection', async () => {
    mockSubmitInstruction.mockResolvedValue({
      kind: 'pending_atomic_context',
      feedback: {
        content: '我先给你推荐 3 个适合在 09:00 插入的新闻节目，请确认要插入哪一个。',
        processType: 'selection',
        processTypeLabel: '插入推荐',
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
            candidateId: 'candidate-1',
            programName: '东方新闻',
            programCode: 'P103001',
            duration: 1800,
            programType: 'news',
            score: 92,
            confidence: 0.88,
            reasonTags: ['类型匹配', '栏目匹配'],
          },
        ],
        selectedCandidateId: null,
        attemptCount: 0,
        createdAt: '2026-04-16T10:00:00.000Z',
        updatedAt: '2026-04-16T10:00:00.000Z',
      },
    })

    const bridge = new OpenClawBridge()
    const result = await bridge.submitInstruction({
      conversationId: 'conv-insert-recommendation-1',
      channelId: 'dragon',
      channelName: '东方卫视',
      date: '2026-03-25',
      text: '9点插一个新闻节目',
      currentSchedule: [],
      gapCount: 0,
      history: [],
      playlistType: 'rotation',
      rotationStrategy: 'content_match',
    })

    expect(result.status).toBe('needs_selection')
    expect(result.payload?.pendingInsertRecommendation).toMatchObject({
      action: 'insert',
      targetTime: '09:00:00',
      semanticLabel: '新闻',
    })
    expect(result.payload?.pendingAtomicContext).toMatchObject({
      action: 'insert',
      phase: 'recommending_insert',
    })

    const session = bridge.getSessionState(result.sessionId)
    expect(session?.pendingAtomicContext).toMatchObject({
      action: 'insert',
      phase: 'recommending_insert',
    })
  })

  it('确认插入推荐后会继续执行插入命令', async () => {
    mockSubmitInstruction.mockResolvedValueOnce({
      kind: 'pending_insert_recommendation',
      feedback: {
        content: '我先给你推荐 2 个适合在 09:00 插入的新闻节目，请确认要插入哪一个。',
        processType: 'selection',
        processTypeLabel: '插入推荐',
      },
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
            candidateId: 'candidate-1',
            programName: '东方新闻',
            programCode: 'P103001',
            duration: 1800,
            programType: 'news',
            score: 92,
            confidence: 0.88,
            reasonTags: ['类型匹配', '栏目匹配'],
          },
        ],
        selectedCandidateId: null,
      },
    })
    mockResolvePendingInsertRecommendation.mockResolvedValueOnce({
      kind: 'execute_command',
      execution: {
        command: {
          action: 'insert',
          data: {
            candidateId: 'candidate-1',
            insertTime: '09:00:00',
            scheduleDate: '2026-03-25',
            channelId: 'dragon',
          },
        },
        successMessage: '已在 09:00:00 插入《东方新闻》',
        explanation: '按确认结果执行插入',
      },
    })
    mockExecutePendingCommand.mockResolvedValueOnce({
      success: true,
      command: {
        action: 'insert',
        data: {
          candidateId: 'candidate-1',
          insertTime: '09:00:00',
          scheduleDate: '2026-03-25',
          channelId: 'dragon',
        },
      },
      message: '已在 09:00:00 插入《东方新闻》',
      summary: '插入节目',
    })

    const bridge = new OpenClawBridge()
    const first = await bridge.submitInstruction({
      conversationId: 'conv-insert-recommendation-2',
      channelId: 'dragon',
      channelName: '东方卫视',
      date: '2026-03-25',
      text: '9点插一个新闻节目',
      currentSchedule: [],
      gapCount: 0,
      history: [],
      playlistType: 'rotation',
      rotationStrategy: 'content_match',
    })

    const second = await bridge.selectInsertRecommendation(first.sessionId, 'candidate-1')

    expect(second.status).toBe('completed')
    expect(second.message).toBe('已在 09:00:00 插入《东方新闻》')
  })

  it('目标选择会优先从统一 pendingAtomicContext 还原，不依赖旧 session 字段', async () => {
    mockSubmitInstruction.mockResolvedValueOnce({
      kind: 'pending_target_selection',
      feedback: {
        content: '我找到了 2 条候选节目，请确认要操作哪一条。',
        processType: 'selection',
        processTypeLabel: '待选择目标',
      },
      pendingTargetSelection: {
        action: 'delete',
        summary: '请确认要删除的节目',
        reasoning: 'mock target selection',
        targetTime: '09:00:00',
        candidates: [
          {
            id: 'item-1',
            programCode: 'P1',
            programName: '看东方',
            startTime: '09:00:00',
            endTime: '09:30:00',
            duration: 1800,
            programType: 'news',
          },
        ],
        selectedItemId: null,
      },
    })
    mockResolvePendingTargetSelection.mockResolvedValueOnce({
      kind: 'message',
      feedback: {
        content: '已确认目标节目。',
        processType: 'selection',
        processTypeLabel: '目标选择',
      },
    })

    const bridge = new OpenClawBridge()
    const first = await bridge.submitInstruction({
      conversationId: 'conv-target-selection-1',
      channelId: 'dragon',
      channelName: '东方卫视',
      date: '2026-03-25',
      text: '删除9点的节目',
      currentSchedule: [],
      gapCount: 0,
      history: [],
      playlistType: 'rotation',
      rotationStrategy: 'content_match',
    })

    const session = bridge.getSessionState(first.sessionId)
    expect(session?.pendingAtomicContext).toMatchObject({
      action: 'delete',
      phase: 'selecting_target',
      selectedItemId: null,
    })

    await bridge.selectTarget(first.sessionId, 'item-1')

    expect(mockResolvePendingTargetSelection).toHaveBeenCalledWith(expect.objectContaining({
      channelId: 'dragon',
      date: '2026-03-25',
      scheduleState: expect.objectContaining({
        playlistType: 'rotation',
        rotationStrategy: 'content_match',
      }),
      pendingTargetSelection: expect.objectContaining({
        action: 'delete',
        selectedItemId: 'item-1',
        targetTime: '09:00:00',
      }),
    }))
  })

  it('待确认删除命令支持自然语言取消', async () => {
    mockSubmitInstruction.mockResolvedValueOnce({
      kind: 'pending_command',
      feedback: {
        content: '将删除 09:00:00 的《看东方》。',
        processType: 'selection',
        processTypeLabel: '待确认修改',
      },
      pendingCommand: {
        command: {
          action: 'delete',
          reasoning: 'mock delete',
          data: {
            itemId: 'item-1',
          },
        },
        summary: '删除 09:00:00 的《看东方》',
        successMessage: '已删除 09:00:00 的《看东方》',
        reasoning: 'mock delete',
      },
    })

    const bridge = new OpenClawBridge()
    const first = await bridge.submitInstruction({
      conversationId: 'conv-pending-delete-cancel',
      channelId: 'dragon',
      channelName: '东方卫视',
      date: '2026-03-25',
      text: '删除9点的看东方',
      currentSchedule: [],
      gapCount: 0,
      history: [],
    })

    const second = await bridge.submitInstruction({
      conversationId: 'conv-pending-delete-cancel',
      channelId: 'dragon',
      channelName: '东方卫视',
      date: '2026-03-25',
      text: '取消',
      currentSchedule: [],
      gapCount: 0,
      history: [],
    })

    expect(first.status).toBe('needs_confirmation')
    expect(second.status).toBe('cancelled')
    expect(second.payload?.pendingCommand).toBeUndefined()
    expect(mockExecutePendingCommand).not.toHaveBeenCalled()
    expect(mockSubmitInstruction).toHaveBeenCalledTimes(1)
  })

  it('待确认删除命令支持自然语言确认', async () => {
    mockSubmitInstruction.mockResolvedValueOnce({
      kind: 'pending_command',
      feedback: {
        content: '将删除 09:00:00 的《看东方》。',
        processType: 'selection',
        processTypeLabel: '待确认修改',
      },
      pendingCommand: {
        command: {
          action: 'delete',
          reasoning: 'mock delete',
          data: {
            itemId: 'item-1',
          },
        },
        summary: '删除 09:00:00 的《看东方》',
        successMessage: '已删除 09:00:00 的《看东方》',
        reasoning: 'mock delete',
      },
    })
    mockExecutePendingCommand.mockResolvedValueOnce({
      success: true,
      command: {
        action: 'delete',
        reasoning: 'mock delete',
        data: {
          itemId: 'item-1',
        },
      },
      message: '已删除 09:00:00 的《看东方》',
      summary: '删除节目',
    })

    const bridge = new OpenClawBridge()
    const first = await bridge.submitInstruction({
      conversationId: 'conv-pending-delete-confirm',
      channelId: 'dragon',
      channelName: '东方卫视',
      date: '2026-03-25',
      text: '删除9点的看东方',
      currentSchedule: [],
      gapCount: 0,
      history: [],
    })

    const second = await bridge.submitInstruction({
      conversationId: 'conv-pending-delete-confirm',
      channelId: 'dragon',
      channelName: '东方卫视',
      date: '2026-03-25',
      text: '确认删除',
      currentSchedule: [],
      gapCount: 0,
      history: [],
    })

    expect(first.status).toBe('needs_confirmation')
    expect(second.status).toBe('completed')
    expect(second.message).toBe('已删除 09:00:00 的《看东方》')
    expect(mockExecutePendingCommand).toHaveBeenCalledTimes(1)
    expect(mockSubmitInstruction).toHaveBeenCalledTimes(1)
  })
})
