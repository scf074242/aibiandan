import { describe, expect, it } from 'vitest'

import type { LayoutDraft } from '@/types/orchestration'
import {
  FormalOrchestrationGrantAuthority,
  buildFormalOrchestrationDraftFingerprint,
} from '../formalOrchestrationGrant'

const createDraft = (): LayoutDraft => ({
  id: 'draft-1',
  channelId: 'rotation',
  date: '2026-07-21',
  version: 3,
  source: 'generated',
  userIntent: '晚间新闻与电视剧',
  coverage: { start: '18:00:00', end: '23:00:00' },
  layoutReference: { id: 'layout-1', name: '晚间版面', slots: [] },
  columns: [],
})

describe('FormalOrchestrationGrantAuthority', () => {
  /**
   * case confirmed-formal-rebuild-grant-is-server-owned
   * - userInput: 确认按当前草案覆盖已有播单
   * - expectedDecision: 可信运行时签发仅绑定当前 session/workspace/播单版本/草案的任务级 Grant
   * - mustNotHappen: 客户端伪造 Grant；跨 session 或跨 workspace 复用；扩大允许 intent
   * - verification: 正确上下文可解析，错误 session/workspace/query intent 均被拒绝
   */
  it('keeps a confirmed rebuild grant runtime-owned and scope bounded', () => {
    const authority = new FormalOrchestrationGrantAuthority({
      now: () => new Date('2026-07-21T10:00:00.000Z'),
      createId: () => 'grant-1',
    })
    const draft = createDraft()
    const grant = authority.issue({
      sessionId: 'session-a', sourcePendingId: 'pending-a', workspaceKey: 'rotation:playlist-a',
      initialPlaylistVersion: 'formal-v1', layoutDraft: draft, existingItemCount: 12, mode: 'full_generate',
    })

    expect(grant).toMatchObject({
      grantId: 'grant-1', sessionId: 'session-a', sourcePendingId: 'pending-a',
      workspaceKey: 'rotation:playlist-a', initialPlaylistVersion: 'formal-v1',
      currentPlaylistVersion: 'formal-v1',
      draftFingerprint: buildFormalOrchestrationDraftFingerprint(draft), status: 'active',
    })
    expect(authority.resolve('grant-1', {
      sessionId: 'session-a', workspaceKey: 'rotation:playlist-a', playlistVersion: 'formal-v1',
      layoutDraft: draft, intent: 'replace',
    })).toEqual(grant)
    expect(() => authority.resolve('grant-1', {
      sessionId: 'session-b', workspaceKey: 'rotation:playlist-a', playlistVersion: 'formal-v1', layoutDraft: draft,
    })).toThrow('session mismatch')
    expect(() => authority.resolve('grant-1', {
      sessionId: 'session-a', workspaceKey: 'rotation:playlist-b', playlistVersion: 'formal-v1', layoutDraft: draft,
    })).toThrow('workspace mismatch')
    expect(() => authority.resolve('grant-1', {
      sessionId: 'session-a', workspaceKey: 'rotation:playlist-a', playlistVersion: 'formal-v1', layoutDraft: draft, intent: 'query',
    })).toThrow('outside')
  })

  /**
   * case confirmed-formal-rebuild-grant-invalidates-on-context-drift
   * - userInput: 继续刚才确认的整批重编
   * - expectedDecision: 播单版本或草案可执行内容变化后停止并要求重新确认
   * - mustNotHappen: 用旧确认覆盖并发修改后的播单；按已变化草案继续写入
   * - verification: playlist version 与 draft fingerprint 漂移均被拒绝，展示 warnings 变化不影响指纹
   */
  it('invalidates the grant when the playlist or executable draft changes', () => {
    const authority = new FormalOrchestrationGrantAuthority({ createId: () => 'grant-drift' })
    const draft = createDraft()
    authority.issue({
      sessionId: 'session-a', sourcePendingId: 'pending-a', workspaceKey: 'rotation:playlist-a',
      initialPlaylistVersion: 'formal-v1', layoutDraft: draft, existingItemCount: 12, mode: 'full_generate',
    })

    expect(() => authority.resolve('grant-drift', {
      sessionId: 'session-a', workspaceKey: 'rotation:playlist-a', playlistVersion: 'formal-v2', layoutDraft: draft,
    })).toThrow('playlist version mismatch')
    expect(() => authority.resolve('grant-drift', {
      sessionId: 'session-a', workspaceKey: 'rotation:playlist-a', playlistVersion: 'formal-v1',
      layoutDraft: { ...draft, coverage: { start: '19:00:00', end: '23:00:00' } },
    })).toThrow('draft mismatch')
    expect(() => authority.resolve('grant-drift', {
      sessionId: 'session-a', workspaceKey: 'rotation:playlist-a', playlistVersion: 'formal-v1',
      layoutDraft: draft, scope: { objective: '偷换后的另一个整批任务' },
    })).toThrow('task scope mismatch')
    expect(buildFormalOrchestrationDraftFingerprint({ ...draft, warnings: ['仅展示的新提示'] }))
      .toBe(buildFormalOrchestrationDraftFingerprint(draft))
  })
})
