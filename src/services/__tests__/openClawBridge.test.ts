import { describe, expect, it } from 'vitest'

import { OpenClawBridge } from '../openclaw/openClawBridge'

describe('OpenClawBridge', () => {
  it('会为桥接提交创建会话并返回结果', async () => {
    const bridge = new OpenClawBridge()

    const result = await bridge.submitInstruction({
      conversationId: 'conv-bridge-1',
      channelId: 'dragon',
      channelName: '东方卫视',
      date: '2026-04-07',
      text: '请校验当前节目单',
      currentSchedule: [],
      gapCount: 0,
      history: [],
    })

    expect(result.sessionId).toBeTruthy()
    expect(['completed', 'failed', 'needs_clarification']).toContain(result.status)
  })

  it('会复用同一个 conversationId 对应的桥接会话', async () => {
    const bridge = new OpenClawBridge()

    const first = await bridge.submitInstruction({
      conversationId: 'conv-bridge-2',
      channelId: 'dragon',
      channelName: '东方卫视',
      date: '2026-04-07',
      text: '请校验当前节目单',
      currentSchedule: [],
      gapCount: 0,
      history: [],
    })

    const second = await bridge.submitInstruction({
      conversationId: 'conv-bridge-2',
      channelId: 'dragon',
      channelName: '东方卫视',
      date: '2026-04-08',
      text: '请校验当前节目单',
      currentSchedule: [],
      gapCount: 0,
      history: [],
    })

    expect(first.sessionId).toBe(second.sessionId)
  })

  it('新指令进入版面准备阶段时不会复用上一条原子执行结果', async () => {
    const bridge = new OpenClawBridge()

    const first = await bridge.submitInstruction({
      conversationId: 'conv-bridge-3',
      channelId: 'dragon',
      channelName: '东方卫视',
      date: '2026-03-25',
      text: '在9点插入节目看东方',
      currentSchedule: [],
      gapCount: 0,
      history: [],
    })

    expect(first.status).toBe('completed')
    expect(first.message).toBeTruthy()

    const second = await bridge.submitInstruction({
      conversationId: 'conv-bridge-3',
      channelId: 'dragon',
      channelName: '东方卫视',
      date: '2026-03-25',
      text: '帮我填充全天节目',
      currentSchedule: [],
      gapCount: 1,
      history: [],
    })

    expect(second.status).toBe('accepted')
    expect(second.message).toBeUndefined()
    expect(second.payload?.lastDecisionKind).toBe('layout_draft')

    const session = bridge.getSessionState(second.sessionId)
    expect(session?.lastExecution).toBeUndefined()
    expect(session?.pendingLayoutDraft).toBeTruthy()
  })

  it('会在确认版面草案后返回 layout_commit', async () => {
    const bridge = new OpenClawBridge()

    const prepare = await bridge.submitInstruction({
      conversationId: 'conv-bridge-4',
      channelId: 'dragon',
      channelName: '东方卫视',
      date: '2026-03-25',
      text: '帮我全天编排',
      currentSchedule: [],
      gapCount: 2,
      history: [],
    })

    expect(prepare.payload?.lastDecisionKind).toBe('layout_draft')

    const commit = await bridge.submitInstruction({
      conversationId: 'conv-bridge-4',
      channelId: 'dragon',
      channelName: '东方卫视',
      date: '2026-03-25',
      text: '按这个版面开始编排',
      currentSchedule: [],
      gapCount: 2,
      history: [],
    })

    expect(commit.payload?.lastDecisionKind).toBe('layout_commit')
    expect(commit.status).toBe('accepted')
  })

  it('当前存在草案时会把替换类自然语言理解为版面微调', async () => {
    const bridge = new OpenClawBridge()

    const prepare = await bridge.submitInstruction({
      conversationId: 'conv-bridge-5',
      channelId: 'dragon',
      channelName: '东方卫视',
      date: '2026-03-25',
      text: '帮我全天编排',
      currentSchedule: [],
      gapCount: 2,
      history: [],
    })

    expect(prepare.payload?.lastDecisionKind).toBe('layout_draft')

    const refine = await bridge.submitInstruction({
      conversationId: 'conv-bridge-5',
      channelId: 'dragon',
      channelName: '东方卫视',
      date: '2026-03-25',
      text: '晚上全部替换成新闻栏目',
      currentSchedule: [],
      gapCount: 2,
      history: [],
    })

    expect(refine.payload?.lastDecisionKind).toBe('layout_draft')
    expect(refine.summary).toContain('更新当前版面草案')
  })
  it('明确要求不参考版面时会直接生成新草案', async () => {
    const bridge = new OpenClawBridge()

    const prepare = await bridge.submitInstruction({
      conversationId: 'conv-bridge-6',
      channelId: 'dragon',
      channelName: '东方卫视',
      date: '2026-03-25',
      text: '不参考版面，下午排入电视剧',
      currentSchedule: [],
      gapCount: 2,
      history: [],
    })

    expect(prepare.payload?.lastDecisionKind).toBe('layout_draft')
    expect(prepare.summary).not.toContain('当前频道版面参考')
    const session = bridge.getSessionState(prepare.sessionId)
    expect(session?.pendingLayoutDraft?.source).toBe('generated')
  })
})
