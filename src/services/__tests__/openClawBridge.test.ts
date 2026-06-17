import { describe, expect, it } from 'vitest'

import { OpenClawBridge } from '../openclaw/openClawBridge'

describe('OpenClawBridge', () => {
  it('clears the pending layout draft context after layout confirmation starts orchestration', async () => {
    const bridge = new OpenClawBridge()

    const result = await bridge.submitInstruction({
      conversationId: 'conv-bridge-clear-layout-draft',
      channelId: 'dragon',
      channelName: '东方卫视',
      date: '2026-03-25',
      text: '上午新闻',
      currentSchedule: [],
      gapCount: 1,
      history: [],
    })

    expect(result.payload?.pendingLayoutDraft).toBeTruthy()
    expect(result.payload?.layoutDraftMode).toBeTruthy()

    const cleared = bridge.clearLayoutDraft(result.sessionId)
    expect(cleared.pendingLayoutDraft).toBeUndefined()
    expect(cleared.layoutDraftMode).toBeUndefined()
    expect(bridge.getSessionState(result.sessionId)?.pendingLayoutDraft).toBeUndefined()
  })

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

  it('纯电视频道编排草案会声明顺播策略并要求参考昨日记录', async () => {
    const bridge = new OpenClawBridge()

    const prepare = await bridge.submitInstruction({
      conversationId: 'conv-bridge-tv-strategy',
      channelId: 'dragon',
      channelName: '东方卫视',
      date: '2026-03-25',
      text: '帮我全天编排，电视剧顺着昨天继续排',
      currentSchedule: [],
      gapCount: 2,
      history: [],
    })

    expect(prepare.payload?.lastDecisionKind).toBe('layout_draft')
    expect(prepare.payload?.pendingLayoutDraft?.strategyProfile?.kind).toBe('tv_channel')
    expect(prepare.payload?.pendingLayoutDraft?.strategyProfile?.requiresPreviousSchedule).toBe(true)
    expect(prepare.payload?.pendingLayoutDraft?.strategyProfile?.referenceDate).toBe('2026-03-24')
  })

  it('轮播单草案会声明收视率优先策略', async () => {
    const bridge = new OpenClawBridge()

    const prepare = await bridge.submitInstruction({
      conversationId: 'conv-bridge-carousel-rating-strategy',
      channelId: 'dragon',
      channelName: '东方卫视',
      date: '2026-03-25',
      text: '静安寺户外直播，14点到15点做轮播单，按收视率优先',
      currentSchedule: [],
      gapCount: 1,
      history: [],
    })

    expect(prepare.payload?.lastDecisionKind).toBe('layout_draft')
    expect(prepare.payload?.pendingLayoutDraft?.strategyProfile?.kind).toBe('carousel')
    expect(prepare.payload?.pendingLayoutDraft?.strategyProfile?.selectionPriority).toBe('rating')
    expect(prepare.payload?.pendingLayoutDraft?.strategyProfile?.requiresPreviousSchedule).toBe(false)
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
  }, 20_000)

  it('外部 Confirm 会确认待确认版面草案并返回 layout_commit', async () => {
    const bridge = new OpenClawBridge()

    const prepare = await bridge.submitInstruction({
      conversationId: 'conv-bridge-confirm-layout-draft-api',
      channelId: 'dragon',
      channelName: '东方卫视',
      date: '2026-03-25',
      text: '按纯电视频道，09:45到10:30继续播品质剧场：纵有疾风起，顺着当前版面补中间集',
      currentSchedule: [
        {
          id: 'existing-0900-episode-1',
          programCode: '002601120001',
          programName: '品质剧场：纵有疾风起 第1集',
          startTime: '09:00:00',
          endTime: '09:45:00',
          duration: 2700,
          programType: 'drama',
        },
        {
          id: 'existing-1030-episode-3',
          programCode: '002601120003',
          programName: '品质剧场：纵有疾风起 第3集',
          startTime: '10:30:00',
          endTime: '11:15:00',
          duration: 2700,
          programType: 'drama',
        },
      ],
      gapCount: 3,
      history: [],
    })

    expect(prepare.payload?.lastDecisionKind).toBe('layout_draft')

    const commit = await bridge.confirm(prepare.sessionId)

    expect(commit.status).toBe('accepted')
    expect(commit.payload?.lastDecisionKind).toBe('layout_commit')
    expect(commit.payload?.pendingLayoutDraft).toBeUndefined()
  })

  it('确认草案后再校验会清空旧草案上下文并读取实际节目单状态', async () => {
    const bridge = new OpenClawBridge()

    const prepare = await bridge.submitInstruction({
      conversationId: 'conv-bridge-validate-after-commit',
      channelId: 'dragon',
      channelName: '东方卫视',
      date: '2026-03-25',
      text: '不参考版面，下午排入电视剧',
      currentSchedule: [],
      gapCount: 1,
      history: [],
    })
    expect(prepare.payload?.lastDecisionKind).toBe('layout_draft')

    const commit = await bridge.submitInstruction({
      conversationId: 'conv-bridge-validate-after-commit',
      channelId: 'dragon',
      channelName: '东方卫视',
      date: '2026-03-25',
      text: '确认版面',
      currentSchedule: [],
      gapCount: 1,
      history: [],
    })
    expect(commit.payload?.lastDecisionKind).toBe('layout_commit')

    const validate = await bridge.submitInstruction({
      conversationId: 'conv-bridge-validate-after-commit',
      channelId: 'dragon',
      channelName: '东方卫视',
      date: '2026-03-25',
      text: '检查当前编排问题',
      currentSchedule: [
        {
          id: 'item-1300',
          programName: '下午剧场',
          startTime: '13:00:00',
          endTime: '14:00:00',
          duration: 3600,
          programType: 'drama',
        },
      ],
      gapCount: 1,
      history: [],
    })

    expect(validate.payload?.lastDecisionKind).toBe('message')
    expect(validate.status).toBe('completed')
    expect(validate.payload?.pendingLayoutDraft).toBeUndefined()
    expect(validate.payload?.layoutDraftMode).toBeUndefined()
    expect(validate.payload?.pendingAtomicContext).toBeNull()
    expect(validate.summary).toContain('校验')
  })

  it('确认草案后继续补排会清空旧草案并基于实际节目单生成局部草案', async () => {
    const bridge = new OpenClawBridge()

    const prepare = await bridge.submitInstruction({
      conversationId: 'conv-bridge-partial-after-commit',
      channelId: 'dragon',
      channelName: '东方卫视',
      date: '2026-03-25',
      text: '上午新闻',
      currentSchedule: [],
      gapCount: 1,
      history: [],
    })
    expect(prepare.payload?.lastDecisionKind).toBe('layout_draft')

    const commit = await bridge.submitInstruction({
      conversationId: 'conv-bridge-partial-after-commit',
      channelId: 'dragon',
      channelName: '东方卫视',
      date: '2026-03-25',
      text: '确认版面',
      currentSchedule: [],
      gapCount: 1,
      history: [],
    })
    expect(commit.payload?.lastDecisionKind).toBe('layout_commit')
    expect(commit.payload?.pendingLayoutDraft).toBeUndefined()

    const partial = await bridge.submitInstruction({
      conversationId: 'conv-bridge-partial-after-commit',
      channelId: 'dragon',
      channelName: '东方卫视',
      date: '2026-03-25',
      text: '保留现有上午节目，下午补齐电视剧',
      currentSchedule: [
        {
          id: 'item-0600',
          programName: '东方快报',
          startTime: '06:00:00',
          endTime: '07:00:00',
          duration: 3600,
          programType: 'news',
        },
        {
          id: 'item-0900',
          programName: '看东方',
          startTime: '09:00:00',
          endTime: '10:00:00',
          duration: 3600,
          programType: 'news_magazine',
        },
      ],
      gapCount: 1,
      history: ['用户：上午新闻', '助手：已完成上午新闻编排。'],
    })

    expect(partial.payload?.lastDecisionKind).toBe('layout_draft')
    expect(partial.payload?.layoutDraftMode).toBe('partial_generate')
    expect(partial.payload?.pendingLayoutDraft?.coverage).toEqual({
      start: '13:00:00',
      end: '18:00:00',
    })
    expect(partial.payload?.pendingLayoutDraft?.columns[0]?.defaultProgramType).toBe('drama')
  })

  it('确认草案后再分析会基于实际节目单返回分析消息，不重新生成草案', async () => {
    const bridge = new OpenClawBridge()

    const prepare = await bridge.submitInstruction({
      conversationId: 'conv-bridge-analysis-after-commit',
      channelId: 'dragon',
      channelName: '东方卫视',
      date: '2026-03-25',
      text: '不参考版面，下午排入电视剧',
      currentSchedule: [],
      gapCount: 1,
      history: [],
    })
    expect(prepare.payload?.lastDecisionKind).toBe('layout_draft')

    const commit = await bridge.submitInstruction({
      conversationId: 'conv-bridge-analysis-after-commit',
      channelId: 'dragon',
      channelName: '东方卫视',
      date: '2026-03-25',
      text: '确认版面',
      currentSchedule: [],
      gapCount: 1,
      history: [],
    })
    expect(commit.payload?.lastDecisionKind).toBe('layout_commit')

    const analysis = await bridge.submitInstruction({
      conversationId: 'conv-bridge-analysis-after-commit',
      channelId: 'dragon',
      channelName: '东方卫视',
      date: '2026-03-25',
      text: '请分析当前版面编排，给我一份业务分析报告',
      currentSchedule: [
        {
          id: 'item-1300',
          programName: '下午剧场',
          startTime: '13:00:00',
          endTime: '14:00:00',
          duration: 3600,
          programType: 'drama',
        },
      ],
      gapCount: 1,
      history: [],
    })

    expect(analysis.payload?.lastDecisionKind).toBe('message')
    expect(analysis.status).toBe('completed')
    expect(analysis.payload?.pendingLayoutDraft).toBeUndefined()
    expect(analysis.payload?.layoutDraftMode).toBeUndefined()
    expect(analysis.summary).toContain('广电节目编辑视角')
    expect(analysis.summary).toContain('节目单')
  })

  it('会在用户放弃当前草案时清空桥接会话里的待确认版面', async () => {
    const bridge = new OpenClawBridge()

    const prepare = await bridge.submitInstruction({
      conversationId: 'conv-bridge-clear-draft-by-text',
      channelId: 'dragon',
      channelName: '东方卫视',
      date: '2026-03-25',
      text: '帮我全天编排',
      currentSchedule: [],
      gapCount: 2,
      history: [],
    })

    expect(prepare.payload?.lastDecisionKind).toBe('layout_draft')
    expect(prepare.payload?.pendingLayoutDraft).toBeTruthy()

    const cleared = await bridge.submitInstruction({
      conversationId: 'conv-bridge-clear-draft-by-text',
      channelId: 'dragon',
      channelName: '东方卫视',
      date: '2026-03-25',
      text: '不要这个草案',
      currentSchedule: [],
      gapCount: 2,
      history: [],
    })

    expect(cleared.payload?.lastDecisionKind).toBe('layout_draft_clear')
    expect(cleared.status).toBe('cancelled')
    expect(cleared.payload?.pendingLayoutDraft).toBeUndefined()
    expect(cleared.payload?.layoutDraftMode).toBeUndefined()
    expect(cleared.payload?.pendingAtomicContext).toBeNull()
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

  it('当前存在不可编排草案时会把改成具体节目理解为版面微调', async () => {
    const bridge = new OpenClawBridge()

    const prepare = await bridge.submitInstruction({
      conversationId: 'conv-bridge-refine-blocked-draft',
      channelId: 'dragon',
      channelName: '东方卫视',
      date: '2026-03-25',
      text: '14点到15点排生命树电视剧',
      currentSchedule: [],
      gapCount: 1,
      history: [],
    })

    expect(prepare.payload?.lastDecisionKind).toBe('layout_draft')
    expect(prepare.payload?.layoutDraftFeasibility?.summary.blockedCount).toBe(1)

    const refine = await bridge.submitInstruction({
      conversationId: 'conv-bridge-refine-blocked-draft',
      channelId: 'dragon',
      channelName: '东方卫视',
      date: '2026-03-25',
      text: '改成梦想剧场：归路 第1集',
      currentSchedule: [],
      gapCount: 1,
      history: [],
    })

    const refinedDraft = bridge.getSessionState(refine.sessionId)?.pendingLayoutDraft
    const refinedHints = refinedDraft?.columns.flatMap((column) => [
      column.semanticLabel ?? '',
      column.columnName,
      ...(column.queryHints ?? []),
    ]).join(' ')

    expect(refine.payload?.lastDecisionKind).toBe('layout_draft')
    expect(refine.payload?.pendingAtomicContext).toBeNull()
    expect(refinedHints).toContain('归路')
  })

  it('结构化栏目和内容字段要求无匹配时确认草案仍会阻断正式编排', async () => {
    const bridge = new OpenClawBridge()

    const prepare = await bridge.submitInstruction({
      conversationId: 'conv-bridge-structured-editorial-blocked-draft',
      channelId: 'dragon',
      channelName: '东方卫视',
      date: '2026-03-25',
      text: '14:00到15:00安排所属栏目静安寺、节目内容看东方的轮播单，内容匹配优先',
      currentSchedule: [],
      gapCount: 1,
      history: [],
    })

    expect(prepare.payload?.lastDecisionKind).toBe('layout_draft')
    expect(prepare.payload?.layoutDraftFeasibility?.summary.blockedCount).toBe(1)
    expect(prepare.payload?.layoutDraftFeasibility?.segments[0]?.blockerKind).toBe('keyword')

    const confirm = await bridge.submitInstruction({
      conversationId: 'conv-bridge-structured-editorial-blocked-draft',
      channelId: 'dragon',
      channelName: '东方卫视',
      date: '2026-03-25',
      text: '确认版面',
      currentSchedule: [],
      gapCount: 1,
      history: [],
    })

    expect(confirm.payload?.lastDecisionKind).toBe('layout_draft')
    expect(confirm.payload?.layoutDraftFeasibility?.summary.blockedCount).toBe(1)
    expect(confirm.payload?.orchestrationRequest).toBeUndefined()
    expect(confirm.summary).toContain('版面草案还有')
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
