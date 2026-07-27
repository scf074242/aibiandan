import { describe, expect, it } from 'vitest'

import {
  buildWorkspaceScopedRuntimeHistory,
  buildForegroundWorkspaceIdentity,
  isForegroundConversationMessageVisible,
  rebindUnscopedConversationToWorkspace,
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

  it('keeps the conversation thread visible while workspace facts remain separately scoped', () => {
    const testCase = {
      id: 'foreground-conversation-remains-visible-across-workspace-switch',
      userInput: '新建电视播单',
      expectedDecision: '创建前后的对话在同一会话线程中连续可见',
      mustNotHappen: '切换 workspaceKey 后隐藏创建前对话，造成用户误以为动作未执行',
      verification: '不同 workspaceKey 与 none 消息均保持可见，业务 pending 仍由独立工作区门禁管理',
    }
    expect(isForegroundConversationMessageVisible({
      workspaceKey: 'tv:playlist-tv-1',
    }, 'tv:playlist-tv-1')).toBe(true)
    expect(isForegroundConversationMessageVisible({
      workspaceKey: 'tv:playlist-tv-1',
    }, 'rotation:playlist-rotation-1')).toBe(true)
    expect(isForegroundConversationMessageVisible({
      workspaceKey: null,
    }, 'rotation:playlist-rotation-1')).toBe(true)
    expect(isForegroundConversationMessageVisible({
      workspaceKey: null,
    }, 'none')).toBe(true)
    expect(testCase).toMatchObject({ expectedDecision: expect.any(String), mustNotHappen: expect.any(String), verification: expect.any(String) })
  })

  it('binds only the initial unscoped conversation to a newly created playlist workspace', () => {
    const testCase = {
      id: 'foreground-create-playlist-preserves-precreation-context',
      userInput: '就按刚才讨论的目标，新建电视播单',
      expectedDecision: 'none 工作区内的创建前目标成为新播单的起始会话上下文',
      mustNotHappen: '迁移其他电视或轮播工作区消息，或复用其 pending、快照和素材证据',
      verification: '仅 workspaceKey=none/null 的消息被重绑，已有工作区消息保持原 key',
    }
    const messages = [
      { role: 'user' as const, content: '上午以新闻和民生内容为主', workspaceKey: 'none' },
      { role: 'assistant' as const, content: '我记下了这个目标', workspaceKey: null },
      { role: 'user' as const, content: '另一张轮播单的目标', workspaceKey: 'rotation:playlist-rotation-1' },
    ]

    rebindUnscopedConversationToWorkspace(messages, 'tv:playlist-tv-1')

    expect(messages.map((message) => message.workspaceKey)).toEqual([
      'tv:playlist-tv-1',
      'tv:playlist-tv-1',
      'rotation:playlist-rotation-1',
    ])
    expect(testCase).toMatchObject({ expectedDecision: expect.any(String), mustNotHappen: expect.any(String), verification: expect.any(String) })
  })
})
