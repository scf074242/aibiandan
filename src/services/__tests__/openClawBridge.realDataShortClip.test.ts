import { beforeEach, describe, expect, it } from 'vitest'

import { getAtomicCapabilities, resetAtomicCapabilities } from '@/services/atomicCapabilities'
import { OpenClawBridge } from '@/services/openclaw/openClawBridge'

const baseInput = {
  channelId: 'dragon',
  channelName: '\u4e1c\u65b9\u536b\u89c6',
  date: '2026-03-25',
  gapCount: 0,
  history: [],
  playlistType: 'rotation' as const,
  rotationStrategy: 'content_match' as const,
  conversationId: 'conv-agent-core-rotation-short-clip-real-data',
  currentSchedule: [],
}

describe('OpenClawBridge real data short-clip path', () => {
  beforeEach(async () => {
    resetAtomicCapabilities()
    await getAtomicCapabilities().clearAll()
  })

  it('finds a program-code-less rotation short clip by title and tags, then commits after confirmation', async () => {
    const bridge = new OpenClawBridge()

    const first = await bridge.submitInstruction({
      ...baseInput,
      text: '10\u70b9\u63d2\u5165\u57ce\u5e02\u5f62\u8c61\u6625\u65e5\u82b1\u8def\u77ed\u7247',
    })

    expect(first.status).toBe('needs_confirmation')
    expect(first.payload?.lastDecisionKind).toBe('pending_atomic_context')
    expect(first.payload?.pendingAtomicContext).toMatchObject({
      action: 'insert',
      agentIntent: 'insert',
      agentPendingTask: {
        intent: 'insert',
        phase: 'needs_confirmation',
      },
    })
    expect(first.payload?.agentAuditSummary).toMatchObject({
      outcome: 'pending',
      playlistPolicy: {
        playlistType: 'rotation',
        rotationStrategy: 'content_match',
        commandIntent: 'insert',
        executionMode: 'confirm_before_commit',
        policyAction: 'confirm',
      },
      candidate: {
        candidateId: 'asset-short-city-flower',
        programCode: '',
      },
    })

    const second = await bridge.submitInstruction({
      ...baseInput,
      text: '\u4e0a\u6d77\u666f\u70b9\u7684\u89c6\u9891',
    })

    expect(second.status).toBe('needs_confirmation')
    expect(second.payload?.lastDecisionKind).toBe('pending_atomic_context')
    expect(getAtomicCapabilities().getAllItems()).toHaveLength(0)

    const third = await bridge.submitInstruction({
      ...baseInput,
      text: '\u786e\u8ba4',
    })

    expect(third.status).toBe('completed')
    expect(third.payload?.lastDecisionKind).toBe('agent_execution')
    expect(third.payload?.pendingAtomicContext).toBeNull()

    const items = getAtomicCapabilities().getAllItems()
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      startTime: '2026-03-25T10:00:00+08:00',
      endTime: '2026-03-25T10:00:30+08:00',
      programCode: '',
      programName: '\u57ce\u5e02\u5fae\u77ed\u7247\uff1a\u6625\u65e5\u82b1\u8def 30\u79d2',
      programType: 'short_clip',
      contentTags: expect.arrayContaining(['\u57ce\u5e02\u5f62\u8c61', '\u6625\u65e5\u82b1\u8def', '\u65e0\u8282\u76ee\u7f16\u53f7']),
    })
  })
})
