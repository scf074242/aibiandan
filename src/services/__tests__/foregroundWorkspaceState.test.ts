import { describe, expect, it } from 'vitest'

import {
  buildWorkspaceScopedRuntimeHistory,
  buildForegroundWorkspaceIdentity,
  isForegroundWorkspaceMessageVisible,
  resolveForegroundWorkspaceKey,
  resolveForegroundWorkspaceTransition,
} from '@/services/runtime/foregroundWorkspaceState'

describe('foreground workspace state', () => {
  it('uses playlist id as the strongest workspace identity when available', () => {
    const identity = buildForegroundWorkspaceIdentity({
      playlistId: 'playlist-tv-1',
      playlistType: 'tv',
      channelId: 'dragon',
      channelName: '东方卫视',
      date: '2026-03-25',
    })

    expect(resolveForegroundWorkspaceKey(identity)).toBe('tv:playlist-tv-1')
  })

  it('falls back to channel and date for tv playlist workspaces without a file id', () => {
    const identity = buildForegroundWorkspaceIdentity({
      playlistType: 'tv',
      channelId: 'dragon',
      channelName: '东方卫视',
      date: '2026-03-25',
    })

    expect(resolveForegroundWorkspaceKey(identity)).toBe('tv:dragon:2026-03-25')
  })

  it('clears pending review but keeps tv layout draft when switching between tv playlist files', () => {
    const transition = resolveForegroundWorkspaceTransition(
      {
        playlistId: 'playlist-tv-1',
        playlistType: 'tv',
        channelId: 'dragon',
        channelName: '东方卫视',
        date: '2026-03-25',
      },
      {
        playlistId: 'playlist-tv-2',
        playlistType: 'tv',
        channelId: 'dragon',
        channelName: '东方卫视',
        date: '2026-03-25',
      },
    )

    expect(transition).toMatchObject({
      changed: true,
      reason: 'playlist_id_changed',
      clearPendingReview: true,
      clearLayoutDraft: false,
    })
  })

  it('clears the layout draft when entering a rotation playlist workspace', () => {
    const transition = resolveForegroundWorkspaceTransition(
      {
        playlistId: 'playlist-tv-1',
        playlistType: 'tv',
        channelId: 'dragon',
        channelName: '东方卫视',
        date: '2026-03-25',
      },
      {
        playlistId: 'playlist-rotation-1',
        playlistType: 'rotation',
        channelId: 'rotation',
        channelName: '轮播单',
        date: '2026-03-25',
        rotationStrategy: 'content_match',
      },
    )

    expect(transition).toMatchObject({
      changed: true,
      reason: 'playlist_id_changed',
      clearPendingReview: true,
      clearLayoutDraft: true,
    })
  })

  it('treats rotation strategy changes as a workspace context change', () => {
    const transition = resolveForegroundWorkspaceTransition(
      {
        playlistType: 'rotation',
        channelId: 'rotation',
        channelName: '轮播单',
        date: '2026-03-25',
        rotationStrategy: 'content_match',
      },
      {
        playlistType: 'rotation',
        channelId: 'rotation',
        channelName: '轮播单',
        date: '2026-03-25',
        rotationStrategy: 'trending',
      },
    )

    expect(transition).toMatchObject({
      changed: true,
      reason: 'rotation_context_changed',
      clearPendingReview: true,
      clearLayoutDraft: true,
    })
  })

  it('builds runtime history only from the active playlist workspace', () => {
    const history = buildWorkspaceScopedRuntimeHistory([
      { role: 'user', content: '新建电视播单', workspaceKey: 'tv:playlist-tv-1' },
      { role: 'assistant', content: '已新建电视播单', workspaceKey: 'tv:playlist-tv-1' },
      { role: 'user', content: '9点插入看东方', workspaceKey: 'tv:playlist-tv-1' },
      { role: 'assistant', content: '待确认插入看东方', workspaceKey: 'tv:playlist-tv-1' },
      { role: 'user', content: '新建轮播单', workspaceKey: 'rotation:playlist-rotation-1' },
      { role: 'assistant', content: '已新建轮播单', workspaceKey: 'rotation:playlist-rotation-1' },
      { role: 'user', content: '补齐当前所有空窗', workspaceKey: 'rotation:playlist-rotation-1' },
    ], {
      currentWorkspaceKey: 'rotation:playlist-rotation-1',
      currentUserInput: '补齐当前所有空窗',
    })

    expect(history).toEqual([
      '用户：新建轮播单',
      '助手：已新建轮播单',
    ])
    expect(history.join('\n')).not.toContain('看东方')
    expect(history.join('\n')).not.toContain('待确认插入')
  })

  it('keeps the runtime history bounded inside one workspace', () => {
    const messages = Array.from({ length: 10 }, (_, index) => ({
      role: index % 2 === 0 ? 'user' as const : 'assistant' as const,
      content: `第${index + 1}轮`,
      workspaceKey: 'tv:playlist-tv-1',
    }))

    const history = buildWorkspaceScopedRuntimeHistory(messages, {
      currentWorkspaceKey: 'tv:playlist-tv-1',
      currentUserInput: '继续',
    })

    expect(history).toHaveLength(6)
    expect(history[0]).toBe('用户：第5轮')
    expect(history.at(-1)).toBe('助手：第10轮')
  })

  it('shows only messages that belong to the active foreground workspace', () => {
    expect(isForegroundWorkspaceMessageVisible({
      workspaceKey: 'tv:playlist-tv-1',
    }, 'tv:playlist-tv-1')).toBe(true)
    expect(isForegroundWorkspaceMessageVisible({
      workspaceKey: 'tv:playlist-tv-1',
    }, 'rotation:playlist-rotation-1')).toBe(false)
    expect(isForegroundWorkspaceMessageVisible({
      workspaceKey: null,
    }, 'rotation:playlist-rotation-1')).toBe(false)
    expect(isForegroundWorkspaceMessageVisible({
      workspaceKey: null,
    }, 'none')).toBe(true)
  })
})
