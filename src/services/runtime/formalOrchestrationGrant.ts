import type { AgentPlannerAtomicIntent } from '@/services/llm/agentPlanner'
import type { LayoutDraft } from '@/types/orchestration'

export interface FormalOrchestrationGrantRequest {
  sourcePendingId: string
  workspaceKey: string
  mode: 'full_generate'
  existingItemCount: number
}

export interface FormalOrchestrationGrant {
  kind: 'confirmed_formal_rebuild'
  grantId: string
  sessionId: string
  sourcePendingId: string
  workspaceKey: string
  initialPlaylistVersion: string
  currentPlaylistVersion: string
  draftFingerprint: string | null
  orchestrationScopeFingerprint: string
  mode: 'full_generate'
  existingItemCount: number
  targetTimeRange?: { start: string; end: string }
  allowedIntents: readonly AgentPlannerAtomicIntent[]
  issuedAt: string
  expiresAt: string
  status: 'active' | 'consumed' | 'revoked'
}

export interface FormalOrchestrationGrantScope {
  mode: 'full_generate'
  targetTimeRange?: { start: string; end: string }
  taskKind?: string
  objective?: string
  searchKeywords?: string[]
}

const FORMAL_REBUILD_ALLOWED_INTENTS = [
  'move',
  'insert',
  'replace',
  'delete',
  'batch_move',
  'batch_delete',
  'validate',
] as const satisfies readonly AgentPlannerAtomicIntent[]

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, nested]) => nested !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, canonicalize(nested)]),
  )
}

const hashText = (value: string): string => {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}

export const buildFormalOrchestrationDraftFingerprint = (draft?: LayoutDraft | null): string | null => {
  if (!draft) return null
  const executableDraft = {
    id: draft.id,
    channelId: draft.channelId,
    date: draft.date,
    effectiveFrom: draft.effectiveFrom,
    effectiveTo: draft.effectiveTo,
    version: draft.version,
    source: draft.source,
    draftKind: draft.draftKind,
    purpose: draft.purpose,
    targetDurationSeconds: draft.targetDurationSeconds,
    durationSegments: draft.durationSegments,
    strategyProfile: draft.strategyProfile,
    coverage: draft.coverage,
    layoutReference: draft.layoutReference,
    columns: draft.columns,
  }
  return `formal_draft_${hashText(JSON.stringify(canonicalize(executableDraft)))}`
}

export const buildFormalOrchestrationScopeFingerprint = (scope: FormalOrchestrationGrantScope): string => (
  `formal_scope_${hashText(JSON.stringify(canonicalize(scope)))}`
)

export const assertFormalOrchestrationGrantScope = (
  grant: FormalOrchestrationGrant,
  input: { workspaceKey: string; intent?: AgentPlannerAtomicIntent; now?: Date },
): void => {
  if (grant.kind !== 'confirmed_formal_rebuild' || grant.mode !== 'full_generate') {
    throw new Error('Formal orchestration grant kind or mode is invalid.')
  }
  if (grant.status !== 'active') throw new Error(`Formal orchestration grant is ${grant.status}.`)
  if (new Date(grant.expiresAt).getTime() <= (input.now ?? new Date()).getTime()) {
    throw new Error('Formal orchestration grant has expired.')
  }
  if (grant.workspaceKey !== input.workspaceKey) {
    throw new Error(`Formal orchestration grant workspace mismatch: expected ${grant.workspaceKey}, received ${input.workspaceKey}.`)
  }
  if (input.intent && !FORMAL_REBUILD_ALLOWED_INTENTS.includes(input.intent as typeof FORMAL_REBUILD_ALLOWED_INTENTS[number])) {
    throw new Error(`Formal orchestration intent ${input.intent} is outside the confirmed rebuild grant.`)
  }
  if (input.intent && !grant.allowedIntents.includes(input.intent)) {
    throw new Error(`Formal orchestration intent ${input.intent} is outside the confirmed rebuild grant.`)
  }
}

export class FormalOrchestrationGrantAuthority {
  private readonly grants = new Map<string, FormalOrchestrationGrant>()
  private readonly now: () => Date
  private readonly createId: () => string
  private readonly ttlMs: number

  constructor(options: { now?: () => Date; createId?: () => string; ttlMs?: number } = {}) {
    this.now = options.now ?? (() => new Date())
    this.createId = options.createId ?? (() => `formal_rebuild_grant_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`)
    this.ttlMs = options.ttlMs ?? 10 * 60 * 1000
  }

  issue(input: {
    sessionId: string
    sourcePendingId: string
    workspaceKey: string
    initialPlaylistVersion: string
    layoutDraft?: LayoutDraft | null
    existingItemCount: number
    mode: 'full_generate'
    targetTimeRange?: { start: string; end: string }
    scope?: Omit<FormalOrchestrationGrantScope, 'mode'>
  }): FormalOrchestrationGrant {
    if (!input.sessionId.trim()) throw new Error('Formal rebuild grant requires a session.')
    if (!input.sourcePendingId.trim()) throw new Error('Formal rebuild grant requires a source pending id.')
    if (!input.workspaceKey.trim() || input.workspaceKey === 'none') throw new Error('Formal rebuild grant requires an active workspace.')
    if (!input.initialPlaylistVersion.trim()) throw new Error('Formal rebuild grant requires a playlist version.')
    if (input.existingItemCount <= 0) throw new Error('Formal rebuild grant requires an existing formal playlist.')
    const issuedAt = this.now()
    const grant: FormalOrchestrationGrant = {
      kind: 'confirmed_formal_rebuild',
      grantId: this.createId(),
      sessionId: input.sessionId,
      sourcePendingId: input.sourcePendingId,
      workspaceKey: input.workspaceKey,
      initialPlaylistVersion: input.initialPlaylistVersion,
      currentPlaylistVersion: input.initialPlaylistVersion,
      draftFingerprint: buildFormalOrchestrationDraftFingerprint(input.layoutDraft),
      orchestrationScopeFingerprint: buildFormalOrchestrationScopeFingerprint({ mode: input.mode, ...input.scope }),
      mode: input.mode,
      existingItemCount: input.existingItemCount,
      targetTimeRange: input.targetTimeRange,
      allowedIntents: [...FORMAL_REBUILD_ALLOWED_INTENTS],
      issuedAt: issuedAt.toISOString(),
      expiresAt: new Date(issuedAt.getTime() + this.ttlMs).toISOString(),
      status: 'active',
    }
    this.grants.set(grant.grantId, grant)
    return grant
  }

  restore(grant: FormalOrchestrationGrant): void {
    this.grants.set(grant.grantId, grant)
  }

  resolve(grantId: string, input: {
    sessionId: string
    workspaceKey: string
    playlistVersion: string
    layoutDraft?: LayoutDraft | null
    intent?: AgentPlannerAtomicIntent
    scope?: Omit<FormalOrchestrationGrantScope, 'mode'>
  }): FormalOrchestrationGrant {
    const grant = this.grants.get(grantId)
    if (!grant) throw new Error('Formal orchestration grant was not issued by this runtime.')
    if (grant.sessionId !== input.sessionId) throw new Error('Formal orchestration grant session mismatch.')
    assertFormalOrchestrationGrantScope(grant, { workspaceKey: input.workspaceKey, intent: input.intent, now: this.now() })
    if (grant.currentPlaylistVersion !== input.playlistVersion) {
      throw new Error('Formal orchestration grant playlist version mismatch.')
    }
    if (grant.draftFingerprint !== buildFormalOrchestrationDraftFingerprint(input.layoutDraft)) {
      throw new Error('Formal orchestration grant draft mismatch.')
    }
    if (grant.orchestrationScopeFingerprint !== buildFormalOrchestrationScopeFingerprint({ mode: 'full_generate', ...input.scope })) {
      throw new Error('Formal orchestration grant task scope mismatch.')
    }
    return grant
  }

  setStatus(grantId: string, status: FormalOrchestrationGrant['status']): void {
    const grant = this.grants.get(grantId)
    if (grant) grant.status = status
  }

  advancePlaylistVersion(grantId: string, playlistVersion: string): FormalOrchestrationGrant | null {
    const grant = this.grants.get(grantId)
    if (!grant) return null
    grant.currentPlaylistVersion = playlistVersion
    return grant
  }
}
