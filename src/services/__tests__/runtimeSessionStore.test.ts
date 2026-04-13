import { describe, expect, it } from 'vitest'

import { RuntimeSessionStore } from '../runtime/runtimeSessionStore'
import type { LayoutDraft } from '@/types/orchestration'

const createDraft = (): LayoutDraft => ({
  id: 'layout-draft:dragon:2026-04-07:v1',
  channelId: 'dragon',
  date: '2026-04-07',
  version: 1,
  source: 'generated',
  userIntent: '下午改成新闻',
  coverage: {
    start: '06:00:00',
    end: '23:59:59',
  },
  layoutReference: {
    id: 'layout-draft:dragon:2026-04-07:v1',
    name: '东方卫视版面草案',
    slots: [],
  },
  columns: [],
})

describe('RuntimeSessionStore', () => {
  it('会为 conversationId 创建或复用桥接会话', () => {
    const store = new RuntimeSessionStore()

    const first = store.upsertSessionForConversation({
      conversationId: 'conv-1',
      channelId: 'dragon',
      channelName: '东方卫视',
      date: '2026-04-07',
      currentSchedule: [],
    })

    const second = store.upsertSessionForConversation({
      conversationId: 'conv-1',
      channelId: 'dragon',
      channelName: '东方卫视',
      date: '2026-04-08',
      currentSchedule: [],
    })

    expect(first.sessionId).toBe(second.sessionId)
    expect(second.context.date).toBe('2026-04-08')
  })

  it('会在更新时通知订阅者', () => {
    const store = new RuntimeSessionStore()
    const session = store.createSession({
      conversationId: 'conv-2',
      channelId: 'dragon',
      channelName: '东方卫视',
      date: '2026-04-07',
      currentSchedule: [],
    })

    const snapshots: string[] = []
    const unsubscribe = store.subscribe(session.sessionId, (state) => {
      snapshots.push(state.status)
    })

    store.updateSession(session.sessionId, {
      status: 'needs_confirmation',
      summary: '请确认后执行',
    })

    unsubscribe()

    expect(snapshots).toContain('idle')
    expect(snapshots).toContain('needs_confirmation')
  })

  it('可以保存并清理待确认版面草案', () => {
    const store = new RuntimeSessionStore()
    const session = store.createSession({
      conversationId: 'conv-3',
      channelId: 'dragon',
      channelName: '东方卫视',
      date: '2026-04-07',
      currentSchedule: [],
    })

    store.updateSession(session.sessionId, {
      pendingLayoutDraft: createDraft(),
      layoutDraftStatus: 'ready',
    })

    const withDraft = store.getSession(session.sessionId)
    expect(withDraft?.pendingLayoutDraft?.id).toContain('layout-draft')
    expect(withDraft?.layoutDraftStatus).toBe('ready')

    store.clearLayoutDraft(session.sessionId)

    const cleared = store.getSession(session.sessionId)
    expect(cleared?.pendingLayoutDraft).toBeUndefined()
    expect(cleared?.layoutDraftStatus).toBeUndefined()
  })
})
