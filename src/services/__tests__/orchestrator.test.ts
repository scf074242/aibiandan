import { describe, expect, it, vi } from 'vitest'

import { Orchestrator } from '@/services/orchestrator'
import type { DeleteCommand, PlanningLogEntry, PlanningSessionStatus } from '@/types/orchestration'
import type { LLMClient } from '@/services/llm/llmClient'
import type { TaskClassifier } from '@/services/llm/taskClassifier'

const createOrchestrator = () => {
  const llmClient = {
    chat: vi.fn(),
  } as unknown as LLMClient

  const taskClassifier = {} as unknown as TaskClassifier

  return new Orchestrator(llmClient, taskClassifier)
}

describe('Orchestrator', () => {
  it('createSession initializes default state and merges strategy overrides', () => {
    const orchestrator = createOrchestrator()

    const session = orchestrator.createSession('dragon', '2026-04-03', {
      target: 'smoke-test',
      allowFiller: false,
    })

    expect(session.channelId).toBe('dragon')
    expect(session.status).toBe('initializing')
    expect(session.strategy.target).toBe('smoke-test')
    expect(session.strategy.allowFiller).toBe(false)
    expect(session.strategy.referencePriority).toEqual(['layout', 'history', 'library'])
    expect(orchestrator.getSession()?.id).toBe(session.id)
  })

  it('getProgress returns baseline progress after session creation', () => {
    const orchestrator = createOrchestrator()
    const session = orchestrator.createSession('dragon', '2026-04-03')

    const progress = orchestrator.getProgress()

    expect(progress?.sessionId).toBe(session.id)
    expect(progress?.status).toBe('initializing')
    expect(progress?.gapProgress.total).toBe(0)
    expect(progress?.recentLogs).toEqual([])
  })

  it('executeCommand emits command-execute event', async () => {
    const orchestrator = createOrchestrator()
    const events: DeleteCommand[] = []

    orchestrator.on('command-execute', ({ command }) => {
      if (command.action === 'delete') {
        events.push(command)
      }
    })

    const command: DeleteCommand = {
      action: 'delete',
      data: {
        itemId: 'item-1',
      },
    }

    const result = await orchestrator.executeCommand(command)

    expect(result).toBe(true)
    expect(events).toEqual([command])
  })

  it('cancel updates session status and emits log/status events', () => {
    const orchestrator = createOrchestrator()
    const statuses: PlanningSessionStatus[] = []
    const logs: PlanningLogEntry[] = []

    orchestrator.createSession('dragon', '2026-04-03')
    orchestrator.on('status-change', ({ status }) => {
      statuses.push(status)
    })
    orchestrator.on('log', ({ entry }) => {
      logs.push(entry)
    })

    orchestrator.cancel()

    expect(orchestrator.getSession()?.status).toBe('cancelled')
    expect(statuses).toContain('cancelled')
    expect(logs.some((entry) => entry.level === 'warn' && entry.phase === 'session')).toBe(true)
  })

  it('startFullGeneration fails fast on unknown channel and emits error status', async () => {
    const orchestrator = createOrchestrator()
    const statuses: PlanningSessionStatus[] = []
    const errors: Error[] = []

    orchestrator.on('status-change', ({ status }) => {
      statuses.push(status)
    })
    orchestrator.on('error', ({ error }) => {
      errors.push(error)
    })

    await expect(
      orchestrator.startFullGeneration('unknown-channel', '2026-04-03', '06:00:00', '23:59:59'),
    ).rejects.toThrow('Unable to load generation context')

    expect(orchestrator.getSession()?.status).toBe('failed')
    expect(orchestrator.getIsRunning()).toBe(false)
    expect(statuses).toContain('failed')
    expect(errors).toHaveLength(1)
  })

  it('phase1Planning 超时后会回退到默认策略而不是一直阻塞', async () => {
    vi.useFakeTimers()
    try {
      const llmClient = {
        chat: vi.fn(() => new Promise<never>(() => {})),
      } as unknown as LLMClient
      const taskClassifier = {} as unknown as TaskClassifier
      const orchestrator = new Orchestrator(llmClient, taskClassifier, {
        planningLlmTimeoutMs: 20,
      })
      const logs: PlanningLogEntry[] = []

      orchestrator.createSession('dragon', '2026-04-03')
      orchestrator.on('log', ({ entry }) => {
        logs.push(entry)
      })

      const planningPromise = (orchestrator as unknown as { phase1Planning: () => Promise<void> }).phase1Planning()
      await vi.advanceTimersByTimeAsync(25)
      await planningPromise

      expect(logs.some((entry) => (
        entry.level === 'warn'
        && entry.phase === 'planning'
        && entry.message.includes('回退到默认编排策略')
      ))).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })
})
