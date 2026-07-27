import { describe, it, expect, vi } from 'vitest'
import { SchedulingAgentRuntime } from '@/services/agent/schedulingAgentRuntime'
import { FormalOrchestrationCapability } from '@/services/agent/formalOrchestrationCapability'
import type { SchedulingDataGateway } from '@/services/agent/types'

describe('SchedulingAgentRuntime orchestration routing', () => {
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
      dataGateway: {
        loadContext: async () => ({} as any),
        commitScheduleItems: async () => ({ committed: false, operationId: '', affectedItemIds: [], scheduleItems: [] }),
      } as SchedulingDataGateway,
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
      dataGateway: {
        loadContext: async () => ({} as any),
        commitScheduleItems: async () => ({ committed: false, operationId: '', affectedItemIds: [], scheduleItems: [] }),
      } as SchedulingDataGateway,
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
      dataGateway: {
        loadContext: async () => ({} as any),
        commitScheduleItems: async () => ({ committed: false, operationId: '', affectedItemIds: [], scheduleItems: [] }),
      } as SchedulingDataGateway,
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
})
