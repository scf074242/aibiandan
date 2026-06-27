import { describe, expect, it } from 'vitest'

import {
  PendingAtomicContextService,
} from '../runtime/pendingAtomicContextService'
import type { RuntimePendingAtomicContext } from '../runtime/pendingAtomicContext'

const createPendingAtomicContext = (): RuntimePendingAtomicContext => ({
  action: 'delete',
  phase: 'clarifying',
  summary: '请补充要删除的节目',
  reasoning: 'mock context',
  originalUserInput: '删除节目',
  collectedUserInput: '删除节目',
  slots: {},
  missingFields: ['target_time'],
  followUpQuestion: '请告诉我要删除几点的节目。',
  attemptCount: 0,
  createdAt: '2026-04-16T06:00:00.000Z',
  updatedAt: '2026-04-16T06:00:00.000Z',
})

describe('PendingAtomicContextService', () => {
  it('会在初始化时补齐默认过期时间', () => {
    const service = new PendingAtomicContextService({
      ttlMs: 5 * 60 * 1000,
      maxAttempts: 3,
    })

    const initialized = service.initialize(
      createPendingAtomicContext(),
      new Date('2026-04-16T06:00:00.000Z').getTime(),
    )

    expect(initialized.expiresAt).toBe('2026-04-16T06:05:00.000Z')
  })

  it('会在记录失败尝试时递增 attemptCount 并刷新过期时间', () => {
    const service = new PendingAtomicContextService({
      ttlMs: 5 * 60 * 1000,
      maxAttempts: 3,
    })

    const updated = service.recordAttempt(
      service.initialize(
        createPendingAtomicContext(),
        new Date('2026-04-16T06:00:00.000Z').getTime(),
      ),
      {
        collectedUserInput: '删除节目，补充说明：还是没说清',
      },
      new Date('2026-04-16T06:02:00.000Z').getTime(),
    )

    expect(updated.attemptCount).toBe(1)
    expect(updated.expiresAt).toBe('2026-04-16T06:07:00.000Z')
    expect(updated.collectedUserInput).toContain('还是没说清')
  })

  it('可以判断超时和超过最大尝试次数', () => {
    const service = new PendingAtomicContextService({
      ttlMs: 5 * 60 * 1000,
      maxAttempts: 3,
    })

    const expiredContext = {
      ...createPendingAtomicContext(),
      expiresAt: '2026-04-16T06:05:00.000Z',
    }
    expect(
      service.getBlockReason(
        expiredContext,
        new Date('2026-04-16T06:05:01.000Z').getTime(),
      ),
    ).toBe('expired')

    const exhaustedContext = {
      ...createPendingAtomicContext(),
      attemptCount: 3,
      expiresAt: '2026-04-16T06:20:00.000Z',
    }
    expect(
      service.getBlockReason(
        exhaustedContext,
        new Date('2026-04-16T06:10:00.000Z').getTime(),
      ),
    ).toBe('max_attempts')
  })
})
