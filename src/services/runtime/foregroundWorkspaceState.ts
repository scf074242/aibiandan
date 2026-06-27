import type { PlaylistType, RotationPlaylistStrategy, ScheduleState } from '@/types/orchestration'

export interface ForegroundWorkspaceIdentity {
  playlistId?: string | null
  playlistType: PlaylistType
  channelId: string
  channelName: string
  date: string
  rotationStrategy?: RotationPlaylistStrategy
  rotationDurationSeconds?: number | null
}

export interface ForegroundWorkspaceTransition {
  changed: boolean
  reason:
    | 'initial'
    | 'unchanged'
    | 'playlist_id_changed'
    | 'playlist_type_changed'
    | 'tv_context_changed'
    | 'rotation_context_changed'
  clearPendingReview: boolean
  clearLayoutDraft: boolean
}

export interface ForegroundRuntimeHistoryMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
  workspaceKey?: string | null
}

export interface ForegroundWorkspaceMessageVisibilityInput {
  workspaceKey?: string | null
}

export const buildForegroundWorkspaceIdentity = (
  input: ForegroundWorkspaceIdentity,
): ForegroundWorkspaceIdentity => ({
  playlistId: input.playlistId ?? null,
  playlistType: input.playlistType,
  channelId: input.channelId,
  channelName: input.channelName,
  date: input.date,
  rotationStrategy: input.playlistType === 'rotation' ? input.rotationStrategy ?? 'content_match' : undefined,
  rotationDurationSeconds: input.playlistType === 'rotation' ? input.rotationDurationSeconds ?? null : null,
})

export const resolveForegroundWorkspaceKey = (identity: ForegroundWorkspaceIdentity): string => {
  if (identity.playlistType === 'none') return 'none'
  if (identity.playlistId) return `${identity.playlistType}:${identity.playlistId}`
  if (identity.playlistType === 'tv') {
    return `tv:${identity.channelId}:${identity.date}`
  }
  return `rotation:${identity.rotationStrategy ?? 'content_match'}:${identity.rotationDurationSeconds ?? 'pending'}`
}

export const resolveForegroundWorkspaceTransition = (
  previous: ForegroundWorkspaceIdentity | null | undefined,
  next: ForegroundWorkspaceIdentity,
): ForegroundWorkspaceTransition => {
  if (!previous) {
    return {
      changed: false,
      reason: 'initial',
      clearPendingReview: false,
      clearLayoutDraft: next.playlistType === 'rotation',
    }
  }

  const previousIdentity = buildForegroundWorkspaceIdentity(previous)
  const nextIdentity = buildForegroundWorkspaceIdentity(next)

  if (previousIdentity.playlistId && nextIdentity.playlistId && previousIdentity.playlistId !== nextIdentity.playlistId) {
    return buildChangedTransition('playlist_id_changed', nextIdentity)
  }

  if (previousIdentity.playlistType !== nextIdentity.playlistType) {
    return buildChangedTransition('playlist_type_changed', nextIdentity)
  }

  if (nextIdentity.playlistType === 'tv') {
    if (previousIdentity.channelId !== nextIdentity.channelId || previousIdentity.date !== nextIdentity.date) {
      return buildChangedTransition('tv_context_changed', nextIdentity)
    }
  }

  if (nextIdentity.playlistType === 'rotation') {
    if (
      previousIdentity.rotationStrategy !== nextIdentity.rotationStrategy
      || previousIdentity.rotationDurationSeconds !== nextIdentity.rotationDurationSeconds
    ) {
      return buildChangedTransition('rotation_context_changed', nextIdentity)
    }
  }

  return {
    changed: false,
    reason: 'unchanged',
    clearPendingReview: false,
    clearLayoutDraft: false,
  }
}

export const buildScheduleWorkspaceSummary = (
  scheduleState: ScheduleState,
): Pick<ForegroundWorkspaceIdentity, 'playlistId' | 'playlistType' | 'channelId' | 'channelName' | 'date' | 'rotationStrategy' | 'rotationDurationSeconds'> => buildForegroundWorkspaceIdentity({
  playlistId: scheduleState.playlistId,
  playlistType: scheduleState.playlistType ?? 'none',
  channelId: scheduleState.channelId,
  channelName: scheduleState.channelName,
  date: scheduleState.date,
  rotationStrategy: scheduleState.rotationStrategy,
  rotationDurationSeconds: scheduleState.rotationDurationSeconds,
})

export const buildWorkspaceScopedRuntimeHistory = (
  messages: ForegroundRuntimeHistoryMessage[],
  input: {
    currentWorkspaceKey: string | null
    currentUserInput: string
    visibleMessageLimit?: number
    historyLimit?: number
  },
): string[] => {
  const latestVisibleMessages = messages
    .filter((message) => message.workspaceKey === input.currentWorkspaceKey)
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .filter((message) => message.content.trim().length > 0)
    .slice(-(input.visibleMessageLimit ?? 8))

  const historyCandidates = latestVisibleMessages
    .filter((message, index) => !(
      index === latestVisibleMessages.length - 1
      && message.role === 'user'
      && message.content.trim() === input.currentUserInput
    ))
    .map((message) => {
      const roleLabel = message.role === 'user' ? '用户' : '助手'
      return `${roleLabel}：${message.content.trim()}`
    })

  return historyCandidates.slice(-(input.historyLimit ?? 6))
}

export const isForegroundWorkspaceMessageVisible = (
  message: ForegroundWorkspaceMessageVisibilityInput,
  currentWorkspaceKey: string | null,
): boolean => {
  if (!message.workspaceKey) return !currentWorkspaceKey || currentWorkspaceKey === 'none'
  if (!currentWorkspaceKey || currentWorkspaceKey === 'none') {
    return message.workspaceKey === currentWorkspaceKey
  }
  return message.workspaceKey === currentWorkspaceKey
}

const buildChangedTransition = (
  reason: ForegroundWorkspaceTransition['reason'],
  next: ForegroundWorkspaceIdentity,
): ForegroundWorkspaceTransition => ({
  changed: true,
  reason,
  clearPendingReview: true,
  clearLayoutDraft: next.playlistType === 'rotation',
})
