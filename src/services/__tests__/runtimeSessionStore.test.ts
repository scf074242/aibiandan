import { describe, expect, it } from 'vitest'

import { RuntimeSessionStore } from '../runtime/runtimeSessionStore'
import type { LayoutDraft } from '@/types/orchestration'
import {
  buildPendingAtomicContextFromInsertRecommendation,
  type RuntimePendingAtomicContext,
} from '../runtime/pendingAtomicContext'

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

const createPendingAtomicContext = (): RuntimePendingAtomicContext => ({
  action: 'move',
  phase: 'clarifying',
  summary: '请补充 9 点那条节目的移动幅度',
  reasoning: 'mock atomic context',
  originalUserInput: '把9点后那段顺一下',
  collectedUserInput: '把9点后那段顺一下',
  slots: {
    targetTimeHint: '9点',
  },
  missingFields: ['offset'],
  followUpQuestion: '已经定位到 9 点，还需要你补充移动幅度，例如“后移 30 分钟”。',
  attemptCount: 0,
  createdAt: '2026-04-15T10:00:00.000Z',
  updatedAt: '2026-04-15T10:00:00.000Z',
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

  it('可以保存统一的插入推荐原子上下文', () => {
    const store = new RuntimeSessionStore()
    const session = store.createSession({
      conversationId: 'conv-4',
      channelId: 'dragon',
      channelName: '东方卫视',
      date: '2026-04-07',
      currentSchedule: [],
    })

    store.updateSession(session.sessionId, {
      status: 'needs_selection',
      summary: '请确认要插入的节目',
      pendingAtomicContext: buildPendingAtomicContextFromInsertRecommendation({
        action: 'insert',
        summary: '请确认要插入的节目',
        reasoning: 'mock insert recommendation',
        originalUserInput: '9点插一个新闻节目',
        collectedUserInput: '9点插一个新闻节目',
        targetTime: '09:00:00',
        semanticLabel: '新闻',
        programTypeHint: 'news',
        recommendedCandidates: [
          {
            candidateId: 'candidate-1',
            programName: '东方新闻',
            programCode: 'P103001',
            duration: 1800,
            programType: 'news',
            score: 92,
            confidence: 0.88,
            reasonTags: ['类型匹配', '栏目匹配'],
          },
        ],
        selectedCandidateId: null,
      }),
    })

    const updated = store.getSession(session.sessionId)
    expect(updated?.pendingAtomicContext?.phase).toBe('recommending_insert')
    expect(updated?.pendingAtomicContext?.slots.targetTime).toBe('09:00:00')
    expect(updated?.pendingAtomicContext?.insertRecommendations?.[0]?.programName).toBe('东方新闻')
  })

  it('可以保存并触达统一的原子上下文', () => {
    const store = new RuntimeSessionStore()
    const session = store.createSession({
      conversationId: 'conv-5',
      channelId: 'dragon',
      channelName: '东方卫视',
      date: '2026-04-07',
      currentSchedule: [],
    })

    store.updateSession(session.sessionId, {
      pendingAtomicContext: createPendingAtomicContext(),
    })

    store.touchPendingAtomicContext(session.sessionId, {
      collectedUserInput: '把9点后那段顺一下，补充说明：后移30分钟',
      slots: {
        targetTimeHint: '9点',
        direction: 'forward',
        offsetSeconds: 1800,
      },
      missingFields: [],
      attemptCount: 1,
    })

    const updated = store.getSession(session.sessionId)
    expect(updated?.pendingAtomicContext?.phase).toBe('clarifying')
    expect(updated?.pendingAtomicContext?.slots.offsetSeconds).toBe(1800)
    expect(updated?.pendingAtomicContext?.attemptCount).toBe(1)

    store.clearPendingAtomicContext(session.sessionId)

    const cleared = store.getSession(session.sessionId)
    expect(cleared?.pendingAtomicContext).toBeUndefined()
  })
})
