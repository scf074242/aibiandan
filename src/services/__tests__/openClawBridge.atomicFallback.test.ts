import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockSubmitInstruction = vi.fn()

vi.mock('@/services/runtime/demoRuntimeFacade', () => ({
  getDemoRuntimeFacade: () => ({
    submitInstruction: mockSubmitInstruction,
    executePendingCommand: vi.fn(),
    resolvePendingTargetSelection: vi.fn(),
  }),
}))

import { OpenClawBridge } from '@/services/openclaw/openClawBridge'

describe('OpenClawBridge atomic fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('会把原子补参数澄清保存到桥接会话，并标记为 needs_clarification', async () => {
    mockSubmitInstruction.mockResolvedValue({
      kind: 'pending_atomic_context',
      feedback: {
        content: '已经定位到 9点，还需要你补充移动幅度，例如“后移 30 分钟”。',
        processType: 'selection',
        processTypeLabel: '原子参数澄清',
      },
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
        createdAt: '2026-04-16T10:00:00.000Z',
        updatedAt: '2026-04-16T10:00:00.000Z',
      },
    })

    const bridge = new OpenClawBridge()
    const result = await bridge.submitInstruction({
      conversationId: 'conv-atomic-bridge-1',
      channelId: 'dragon',
      channelName: '东方卫视',
      date: '2026-03-25',
      text: '把9点后那段顺一下',
      currentSchedule: [],
      gapCount: 0,
      history: [],
    })

    expect(result.status).toBe('needs_clarification')
    expect(result.payload?.pendingAtomicClarification).toMatchObject({
      action: 'move',
      targetTimeHint: '9点',
    })
    expect(result.payload?.pendingAtomicContext).toMatchObject({
      action: 'move',
      phase: 'clarifying',
      missingFields: ['offset'],
    })
  })

  it('会优先使用 runtime 返回的显式 statusHint，而不是根据文案猜状态', async () => {
    mockSubmitInstruction.mockResolvedValue({
      kind: 'message',
      statusHint: 'cancelled',
      feedback: {
        content: '上一条待补充的修改任务已经超时失效，请重新描述完整需求。',
        processType: 'general',
        processTypeLabel: '上下文已失效',
      },
    })

    const bridge = new OpenClawBridge()
    const result = await bridge.submitInstruction({
      conversationId: 'conv-atomic-bridge-2',
      channelId: 'dragon',
      channelName: '东方卫视',
      date: '2026-03-25',
      text: '9点',
      currentSchedule: [],
      gapCount: 0,
      history: [],
    })

    expect(result.status).toBe('cancelled')
  })
})
