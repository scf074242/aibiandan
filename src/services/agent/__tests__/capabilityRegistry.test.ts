import { describe, expect, it, vi } from 'vitest'

import { CapabilityRegistry, CapabilityRouteConflictError } from '../capabilityRegistry'
import type { AgentCapability, AgentDecision, AgentResult, AgentSubmitInput, CapabilityMetadata } from '../types'

/**
 * 构造一个用于测试的 mock capability。
 */
function createCapability(
  id: string,
  metadata?: CapabilityMetadata,
  canHandle = false,
): AgentCapability {
  return {
    id,
    metadata,
    canHandle: vi.fn(() => canHandle),
    handle: vi.fn(async (): Promise<AgentResult> => ({
      status: 'executed',
      input: { userInput: '', channelId: '', date: '' } as AgentSubmitInput,
      decision: {} as AgentDecision,
      explanation: '',
      trace: [],
    })),
  }
}

/**
 * 构造一个最小的 AgentSubmitInput，用于遗留 canHandle 路由测试。
 */
function createInput(userInput: string): AgentSubmitInput {
  return {
    userInput,
    channelId: 'channel-1',
    date: '2026-06-29',
  }
}

describe('CapabilityRegistry', () => {
  it('legacy 模式仍通过 canHandle 过滤 capability', () => {
    const registry = new CapabilityRegistry()
    const capable = createCapability('legacy-capable', undefined, true)
    const incapable = createCapability('legacy-incapable', undefined, false)
    registry.register(capable)
    registry.register(incapable)

    const input = createInput('move')
    const matches = registry.resolveAll(input)

    expect(matches).toHaveLength(1)
    expect(matches[0].id).toBe('legacy-capable')
    expect(registry.resolve(input)?.id).toBe('legacy-capable')
    expect(capable.canHandle).toHaveBeenCalledWith(input)
    expect(incapable.canHandle).toHaveBeenCalledWith(input)
  })

  it('基于元数据的意图路由返回唯一命中的 capability', () => {
    const registry = new CapabilityRegistry()
    registry.register(createCapability('move-tv', { name: 'Move TV', intents: ['move'], playlistTypes: ['tv'] }))
    registry.register(createCapability('insert-tv', { name: 'Insert TV', intents: ['insert'], playlistTypes: ['tv'] }))

    expect(registry.resolveAll('move', 'tv').id).toBe('move-tv')
    expect(registry.resolveAll('insert', 'tv').id).toBe('insert-tv')
  })

  it('优先级高的 capability 在冲突中胜出', () => {
    const registry = new CapabilityRegistry()
    registry.register(createCapability('move-low', { name: 'Move Low', intents: ['move'], priority: 1 }))
    registry.register(createCapability('move-high', { name: 'Move High', intents: ['move'], priority: 10 }))

    expect(registry.resolveAll('move').id).toBe('move-high')
  })

  it('同优先级冲突时抛出 CapabilityRouteConflictError 并携带结构化 envelope', () => {
    const registry = new CapabilityRegistry()
    registry.register(createCapability('move-a', { name: 'Move A', intents: ['move'], priority: 5 }))
    registry.register(createCapability('move-b', { name: 'Move B', intents: ['move'], priority: 5 }))

    expect(() => registry.resolveAll('move')).toThrow(CapabilityRouteConflictError)

    let caught: CapabilityRouteConflictError | undefined
    try {
      registry.resolveAll('move')
    } catch (error) {
      caught = error as CapabilityRouteConflictError
    }

    expect(caught).toBeDefined()
    expect(caught!.envelope.kind).toBe('capability_route_conflict')
    expect(caught!.envelope.capabilityIds).toContain('move-a')
    expect(caught!.envelope.capabilityIds).toContain('move-b')
    expect(caught!.envelope.candidateEvidence).toHaveLength(2)
    expect(caught!.envelope.candidateEvidence.every((ev) => ev.priority === 5)).toBe(true)

    const conflicts = registry.getRouteConflicts('move')
    expect(conflicts).toHaveLength(2)
    expect(conflicts.map((c) => c.id).sort()).toEqual(['move-a', 'move-b'])
  })

  it('无元数据的遗留 capability 在元数据路由中仍可返回', () => {
    const registry = new CapabilityRegistry()
    registry.register(createCapability('legacy-atomic'))

    expect(registry.resolveAll('move').id).toBe('legacy-atomic')
    expect(registry.resolveAll('insert').id).toBe('legacy-atomic')
  })

  it('rotation 播单类型被映射为 carousel 进行匹配', () => {
    const registry = new CapabilityRegistry()
    registry.register(createCapability('carousel-cap', { name: 'Carousel', intents: ['insert'], playlistTypes: ['carousel'] }))

    expect(registry.resolveAll('insert', 'rotation').id).toBe('carousel-cap')
  })

  it('getRouteConflicts 在没有冲突时返回空数组', () => {
    const registry = new CapabilityRegistry()
    registry.register(createCapability('move-only', { name: 'Move Only', intents: ['move'], priority: 1 }))

    expect(registry.getRouteConflicts('move')).toEqual([])
    expect(registry.getRouteConflicts('insert')).toEqual([])
  })

  it('混合注册时元数据 capability 优先于遗留 capability', () => {
    const registry = new CapabilityRegistry()
    registry.register(createCapability('legacy-atomic'))
    registry.register(createCapability('move-new', { name: 'Move New', intents: ['move'], priority: 5 }))

    expect(registry.resolveAll('move').id).toBe('move-new')
    expect(registry.resolveAll('insert').id).toBe('legacy-atomic')
  })
})
