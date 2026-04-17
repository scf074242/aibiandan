import type { RuntimePendingAtomicContext } from './pendingAtomicContext'

export interface PendingAtomicContextLifecycleConfig {
  ttlMs: number
  maxAttempts: number
}

export type PendingAtomicLifecycleBlockReason = 'expired' | 'max_attempts'

const DEFAULT_PENDING_ATOMIC_CONTEXT_LIFECYCLE_CONFIG: PendingAtomicContextLifecycleConfig = {
  ttlMs: 10 * 60 * 1000,
  maxAttempts: 3,
}

const toIso = (timestamp: number) => new Date(timestamp).toISOString()

export class PendingAtomicContextService {
  constructor(
    private readonly config: PendingAtomicContextLifecycleConfig = DEFAULT_PENDING_ATOMIC_CONTEXT_LIFECYCLE_CONFIG,
  ) {}

  initialize(context: RuntimePendingAtomicContext, now: number = Date.now()): RuntimePendingAtomicContext {
    const createdAt = context.createdAt || toIso(now)
    const updatedAt = context.updatedAt || createdAt
    return {
      ...context,
      createdAt,
      updatedAt,
      expiresAt: context.expiresAt ?? toIso(now + this.config.ttlMs),
    }
  }

  touch(
    context: RuntimePendingAtomicContext,
    patch: Partial<RuntimePendingAtomicContext> = {},
    now: number = Date.now(),
  ): RuntimePendingAtomicContext {
    const base = this.initialize(context, now)
    return {
      ...base,
      ...patch,
      slots: patch.slots
        ? {
            ...base.slots,
            ...patch.slots,
          }
        : base.slots,
      updatedAt: toIso(now),
      expiresAt: toIso(now + this.config.ttlMs),
    }
  }

  recordAttempt(
    context: RuntimePendingAtomicContext,
    patch: Partial<RuntimePendingAtomicContext> = {},
    now: number = Date.now(),
  ): RuntimePendingAtomicContext {
    return this.touch(
      context,
      {
        ...patch,
        attemptCount: context.attemptCount + 1,
      },
      now,
    )
  }

  isExpired(context: RuntimePendingAtomicContext, now: number = Date.now()): boolean {
    if (!context.expiresAt) return false
    const expiresAt = new Date(context.expiresAt).getTime()
    return Number.isFinite(expiresAt) && expiresAt <= now
  }

  hasExceededAttempts(context: RuntimePendingAtomicContext): boolean {
    return context.attemptCount >= this.config.maxAttempts
  }

  getRemainingAttempts(context: RuntimePendingAtomicContext): number {
    return Math.max(this.config.maxAttempts - context.attemptCount, 0)
  }

  getBlockReason(
    context: RuntimePendingAtomicContext,
    now: number = Date.now(),
  ): PendingAtomicLifecycleBlockReason | null {
    if (this.isExpired(context, now)) return 'expired'
    if (this.hasExceededAttempts(context)) return 'max_attempts'
    return null
  }

  getConfig(): PendingAtomicContextLifecycleConfig {
    return this.config
  }
}

let globalPendingAtomicContextService: PendingAtomicContextService | null = null

export function getPendingAtomicContextService(): PendingAtomicContextService {
  if (!globalPendingAtomicContextService) {
    globalPendingAtomicContextService = new PendingAtomicContextService()
  }
  return globalPendingAtomicContextService
}
