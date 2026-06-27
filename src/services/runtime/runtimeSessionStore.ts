import type { DraftFeasibilityReport, LayoutDraft, PlaylistType, RotationPlaylistStrategy, TaskMode } from '@/types/orchestration'
import type {
  RuntimeDecision,
  RuntimeExecutedResult,
  RuntimePendingCommand,
  RuntimeScheduleItem,
} from './demoRuntimeFacade'
import type { RuntimePendingAtomicContext } from './pendingAtomicContext'

export type BridgeRuntimeStatus =
  | 'idle'
  | 'needs_clarification'
  | 'needs_selection'
  | 'needs_confirmation'
  | 'accepted'
  | 'in_progress'
  | 'completed'
  | 'failed'
  | 'cancelled'

export type RuntimeLayoutDraftStatus = 'drafting' | 'ready' | 'confirmed'

export interface RuntimeBridgeSessionContext {
  conversationId: string
  channelId: string
  channelName: string
  date: string
  currentSchedule: RuntimeScheduleItem[]
  playlistType?: PlaylistType
  rotationStrategy?: RotationPlaylistStrategy
}

export interface RuntimeBridgeSessionState {
  sessionId: string
  conversationId: string
  status: BridgeRuntimeStatus
  summary: string
  context: RuntimeBridgeSessionContext
  lastDecision?: RuntimeDecision
  pendingCommand?: RuntimePendingCommand
  pendingAtomicContext?: RuntimePendingAtomicContext
  pendingLayoutDraft?: LayoutDraft
  layoutDraftStatus?: RuntimeLayoutDraftStatus
  layoutDraftMode?: Extract<TaskMode, 'full_generate' | 'partial_generate'>
  layoutDraftFeasibility?: DraftFeasibilityReport
  lastExecution?: RuntimeExecutedResult
  updatedAt: string
}

type RuntimeSessionListener = (state: RuntimeBridgeSessionState) => void

export class RuntimeSessionStore {
  private sessions = new Map<string, RuntimeBridgeSessionState>()
  private listeners = new Map<string, Set<RuntimeSessionListener>>()

  createSession(context: RuntimeBridgeSessionContext): RuntimeBridgeSessionState {
    const session: RuntimeBridgeSessionState = {
      sessionId: `bridge_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      conversationId: context.conversationId,
      status: 'idle',
      summary: '会话已创建',
      context,
      updatedAt: new Date().toISOString(),
    }
    this.sessions.set(session.sessionId, session)
    return session
  }

  getSession(sessionId: string): RuntimeBridgeSessionState | null {
    return this.sessions.get(sessionId) ?? null
  }

  findSessionByConversationId(conversationId: string): RuntimeBridgeSessionState | null {
    for (const session of this.sessions.values()) {
      if (session.conversationId === conversationId) {
        return session
      }
    }
    return null
  }

  upsertSessionForConversation(context: RuntimeBridgeSessionContext): RuntimeBridgeSessionState {
    const existing = this.findSessionByConversationId(context.conversationId)
    if (!existing) {
      return this.createSession(context)
    }
    const nextPlaylistType = context.playlistType ?? existing.context.playlistType
    return this.updateSession(existing.sessionId, {
      context: {
        ...context,
        playlistType: nextPlaylistType,
        rotationStrategy: nextPlaylistType === 'rotation'
          ? context.rotationStrategy ?? existing.context.rotationStrategy
          : undefined,
      },
    })
  }

  updateSession(
    sessionId: string,
    patch: Partial<Omit<RuntimeBridgeSessionState, 'sessionId' | 'conversationId'>>,
  ): RuntimeBridgeSessionState {
    const current = this.sessions.get(sessionId)
    if (!current) {
      throw new Error(`未找到运行时会话 ${sessionId}`)
    }

    const nextState: RuntimeBridgeSessionState = {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString(),
    }
    this.sessions.set(sessionId, nextState)
    this.emit(sessionId, nextState)
    return nextState
  }

  clearLayoutDraft(sessionId: string): RuntimeBridgeSessionState {
    return this.updateSession(sessionId, {
      pendingLayoutDraft: undefined,
      layoutDraftStatus: undefined,
      layoutDraftMode: undefined,
      layoutDraftFeasibility: undefined,
    })
  }

  clearPendingAtomicContext(sessionId: string): RuntimeBridgeSessionState {
    return this.updateSession(sessionId, {
      pendingAtomicContext: undefined,
    })
  }

  touchPendingAtomicContext(
    sessionId: string,
    patch: Partial<RuntimePendingAtomicContext>,
  ): RuntimeBridgeSessionState {
    const current = this.sessions.get(sessionId)
    if (!current?.pendingAtomicContext) {
      throw new Error(`运行时会话 ${sessionId} 当前没有未完成的原子上下文`)
    }

    return this.updateSession(sessionId, {
      pendingAtomicContext: {
        ...current.pendingAtomicContext,
        ...patch,
        slots: patch.slots
          ? {
              ...current.pendingAtomicContext.slots,
              ...patch.slots,
            }
          : current.pendingAtomicContext.slots,
        updatedAt: new Date().toISOString(),
      },
    })
  }

  subscribe(sessionId: string, listener: RuntimeSessionListener): () => void {
    const listeners = this.listeners.get(sessionId) ?? new Set<RuntimeSessionListener>()
    listeners.add(listener)
    this.listeners.set(sessionId, listeners)

    const current = this.sessions.get(sessionId)
    if (current) {
      listener(current)
    }

    return () => {
      const target = this.listeners.get(sessionId)
      if (!target) return
      target.delete(listener)
      if (target.size === 0) {
        this.listeners.delete(sessionId)
      }
    }
  }

  private emit(sessionId: string, state: RuntimeBridgeSessionState) {
    const listeners = this.listeners.get(sessionId)
    if (!listeners) return
    listeners.forEach((listener) => listener(state))
  }
}

let globalRuntimeSessionStore: RuntimeSessionStore | null = null

export function getRuntimeSessionStore(): RuntimeSessionStore {
  if (!globalRuntimeSessionStore) {
    globalRuntimeSessionStore = new RuntimeSessionStore()
  }
  return globalRuntimeSessionStore
}
