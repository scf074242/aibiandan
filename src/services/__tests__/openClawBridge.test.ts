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

  it('分析当前版面编排时会返回文字报告并保留后续优化引导', async () => {
    const bridge = new OpenClawBridge()

    const result = await bridge.submitInstruction({
      conversationId: 'conv-bridge-analysis-1',
      channelId: 'dragon',
      channelName: '东方卫视',
      date: '2026-03-25',
      text: '请分析当前版面编排，给我一份编辑视角的文字版报告',
      currentSchedule: [
        {
          id: 'item-0700',
          programName: '看东方',
          startTime: '07:00:00',
          endTime: '09:00:00',
          duration: 7200,
          programType: 'news_magazine',
        },
        {
          id: 'item-0930',
          programName: '纵有疾风起',
          startTime: '09:30:00',
          endTime: '12:00:00',
          duration: 9000,
          programType: 'drama',
        },
        {
          id: 'item-1900',
          programName: '新闻联播',
          startTime: '19:00:00',
          endTime: '19:30:00',
          duration: 1800,
          programType: 'news',
        },
      ],
      gapCount: 1,
      history: [],
    })

    expect(result.status).toBe('completed')
    expect(result.summary).toContain('广电节目编辑视角')
    expect(result.summary).toContain('新的版面草案')
    expect(result.payload?.lastDecisionKind).toBe('message')
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

    expect(['completed', 'needs_selection']).toContain(first.status)
    if (first.status === 'completed') {
      expect(first.message).toBeTruthy()
    }

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

  it('已有节目后发起全天编排也会直接进入版面草案阶段', async () => {
    const bridge = new OpenClawBridge()

    const prepare = await bridge.submitInstruction({
      conversationId: 'conv-bridge-4b',
      channelId: 'dragon',
      channelName: '东方卫视',
      date: '2026-03-25',
      text: '帮我全天编排',
      currentSchedule: [
        {
          id: 'item-0900',
          programName: '看东方 早高峰版',
          startTime: '09:00:00',
          endTime: '10:00:00',
          duration: 3600,
          programType: 'news_magazine',
        },
      ],
      gapCount: 2,
      history: [],
    })

    expect(prepare.status).toBe('accepted')
    expect(prepare.payload?.lastDecisionKind).toBe('layout_draft')
    expect(prepare.message).toBeUndefined()
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

  it('当前存在草案时会把删除草案时段优先作为版面微调', async () => {
    const bridge = new OpenClawBridge()

    const prepare = await bridge.submitInstruction({
      conversationId: 'conv-bridge-delete-draft-segment',
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
      conversationId: 'conv-bridge-delete-draft-segment',
      channelId: 'dragon',
      channelName: '东方卫视',
      date: '2026-03-25',
      text: '删除6点的草案',
      currentSchedule: [],
      gapCount: 2,
      history: [],
    })

    expect(refine.payload?.lastDecisionKind).toBe('layout_draft')
    expect(refine.payload?.pendingAtomicContext).toBeNull()
    expect(refine.payload?.pendingCommand).toBeUndefined()
    expect(refine.summary).toContain('更新当前版面草案')
  })

  it('当前存在自定义草案时新增时段不会回退加载频道默认版面', async () => {
    const bridge = new OpenClawBridge()

    const prepare = await bridge.submitInstruction({
      conversationId: 'conv-bridge-refine-keeps-current-draft',
      channelId: 'dragon',
      channelName: '东方卫视',
      date: '2026-03-25',
      text: '生成版面草稿，15点到19点，全部是电视剧',
      currentSchedule: [],
      gapCount: 2,
      history: [],
    })

    const firstDraft = bridge.getSessionState(prepare.sessionId)?.pendingLayoutDraft
    expect(firstDraft?.source).toBe('generated')
    expect(firstDraft?.coverage).toEqual({
      start: '15:00:00',
      end: '19:00:00',
    })
    expect(firstDraft?.layoutReference.slots).toHaveLength(1)

    const refine = await bridge.submitInstruction({
      conversationId: 'conv-bridge-refine-keeps-current-draft',
      channelId: 'dragon',
      channelName: '东方卫视',
      date: '2026-03-25',
      text: '增加19点到20点的草案，内容全部是新闻',
      currentSchedule: [],
      gapCount: 2,
      history: [],
    })

    const refinedDraft = bridge.getSessionState(refine.sessionId)?.pendingLayoutDraft
    const segmentProgramTypes = refinedDraft?.columns.map((column) => column.defaultProgramType) ?? []
    const segmentRanges = refinedDraft?.layoutReference.slots.map((slot) => `${slot.startTime.slice(11, 19)}-${slot.endTime.slice(11, 19)}`) ?? []

    expect(refine.payload?.lastDecisionKind).toBe('layout_draft')
    expect(refinedDraft?.source).toBe('generated')
    expect(refinedDraft?.layoutReference.slots).toHaveLength(2)
    expect(segmentProgramTypes).toContain('drama')
    expect(segmentProgramTypes).toContain('news')
    expect(segmentRanges).toContain('15:00:00-19:00:00')
    expect(segmentRanges).toContain('19:00:00-20:00:00')
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
