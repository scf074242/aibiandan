import { describe, expect, it, vi } from 'vitest'

import { SchedulingAgentRuntime } from '@/services/agent/schedulingAgentRuntime'
import { FormalOrchestrationCapability } from '@/services/agent/formalOrchestrationCapability'
import { AtomicCommandCapability } from '@/services/agent/atomicCommandCapability'
import type { SchedulingDataGateway } from '@/services/agent/types'

/**
 * 构造一个最小的 data gateway，仅用于满足 SchedulingAgentRuntime 构造签名。
 */
function createMinimalDataGateway(): SchedulingDataGateway {
  return {
    loadContext: async () => ({} as any),
    commitScheduleItems: async () => ({
      committed: false,
      operationId: '',
      affectedItemIds: [],
      scheduleItems: [],
    }),
  }
}

describe('SchedulingAgentRuntime orchestration routing (D23)', () => {
  it('registers both AtomicCommandCapability and OrchestrationCapability by default', () => {
    const runtime = new SchedulingAgentRuntime({
      dataGateway: createMinimalDataGateway(),
    })

    const capabilityIds = runtime.describeCapabilities().capabilityIds
    expect(capabilityIds).toContain('atomic_command')
    expect(capabilityIds).toContain('orchestration')
  })

  it('routes full_generate orchestration through OrchestrationCapability', async () => {
    const capability = new FormalOrchestrationCapability()
    const handleSpy = vi.spyOn(capability, 'handle').mockResolvedValue({
      status: 'executed',
      input: {} as any,
      decision: {},
      explanation: 'done',
      trace: [],
    })

    const runtime = new SchedulingAgentRuntime({
      dataGateway: createMinimalDataGateway(),
      capabilities: [capability],
    })

    const result = await runtime.submit({
      userInput: '全天编排',
      channelId: 'test-channel',
      date: '2026-06-29',
      orchestration: {
        mode: 'full_generate',
        channelId: 'test-channel',
        date: '2026-06-29',
        dayStartTime: '06:00:00',
        dayEndTime: '26:00:00',
      },
    })

    expect(handleSpy).toHaveBeenCalledTimes(1)
    expect(result.status).toBe('executed')
  })

  it('routes partial_generate orchestration through OrchestrationCapability', async () => {
    const capability = new FormalOrchestrationCapability()
    const handleSpy = vi.spyOn(capability, 'handle').mockResolvedValue({
      status: 'executed',
      input: {} as any,
      decision: {},
      explanation: 'done',
      trace: [],
    })

    const runtime = new SchedulingAgentRuntime({
      dataGateway: createMinimalDataGateway(),
      capabilities: [capability],
    })

    const result = await runtime.submit({
      userInput: '局部补排',
      channelId: 'test-channel',
      date: '2026-06-29',
      orchestration: {
        mode: 'partial_generate',
        channelId: 'test-channel',
        date: '2026-06-29',
        target: ['gap-1'],
      },
    })

    expect(handleSpy).toHaveBeenCalledTimes(1)
    expect(result.status).toBe('executed')
  })

  it('does not route atomic intent to OrchestrationCapability', async () => {
    const capability = new FormalOrchestrationCapability()
    const handleSpy = vi.spyOn(capability, 'handle')

    const runtime = new SchedulingAgentRuntime({
      dataGateway: createMinimalDataGateway(),
      capabilities: [capability],
    })

    await runtime.submit({
      userInput: '查询节目',
      channelId: 'test-channel',
      date: '2026-06-29',
      interpretation: {
        intent: 'query',
        confidence: 1,
        source: 'deterministic',
      },
    })

    expect(handleSpy).not.toHaveBeenCalled()
  })

  it('resolves to only OrchestrationCapability when both capabilities are registered', async () => {
    const orchestrationCapability = new FormalOrchestrationCapability()
    const atomicCapability = new AtomicCommandCapability()

    const orchestrationSpy = vi.spyOn(orchestrationCapability, 'handle').mockResolvedValue({
      status: 'executed',
      input: {} as any,
      decision: {},
      explanation: 'done',
      trace: [],
    })
    const atomicSpy = vi.spyOn(atomicCapability, 'handle')

    const runtime = new SchedulingAgentRuntime({
      dataGateway: createMinimalDataGateway(),
      capabilities: [atomicCapability, orchestrationCapability],
    })

    const result = await runtime.submit({
      userInput: '全天编排',
      channelId: 'test-channel',
      date: '2026-06-29',
      orchestration: {
        mode: 'full_generate',
        channelId: 'test-channel',
        date: '2026-06-29',
        dayStartTime: '06:00:00',
        dayEndTime: '26:00:00',
      },
    })

    expect(orchestrationSpy).toHaveBeenCalledTimes(1)
    expect(atomicSpy).not.toHaveBeenCalled()
    expect(result.status).toBe('executed')
  })
})
