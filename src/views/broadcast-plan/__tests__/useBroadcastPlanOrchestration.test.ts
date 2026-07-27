import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'

import { clearRuntimeLayout, getRuntimeLayoutEntry } from '@/services/orchestration/runtimeLayoutRegistry'
import type { LayoutDraft } from '@/types/orchestration'
import { useBroadcastPlanOrchestration } from '../useBroadcastPlanOrchestration'

const orchestratorMock = vi.hoisted(() => ({
  order: [] as string[],
  startPartialGeneration: vi.fn(),
  startFullGeneration: vi.fn(),
  startReactOrchestration: vi.fn(),
  recoverReactOrchestration: vi.fn(),
  cancel: vi.fn(),
}))

vi.mock('@/composables/useOrchestrator', () => ({
  useOrchestrator: () => ({
    progress: ref({ liveGaps: [] }),
    startPartialGeneration: orchestratorMock.startPartialGeneration,
    startFullGeneration: orchestratorMock.startFullGeneration,
    startReactOrchestration: orchestratorMock.startReactOrchestration,
    recoverReactOrchestration: orchestratorMock.recoverReactOrchestration,
    cancel: orchestratorMock.cancel,
  }),
}))

vi.mock('element-plus', () => ({
  ElMessage: {
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
  },
  ElMessageBox: {
    confirm: vi.fn(),
  },
}))

const createFocusRuntime = () => ({
  resetForRun: vi.fn(() => {
    orchestratorMock.order.push('resetForRun')
  }),
  startGap: vi.fn(),
  completeItem: vi.fn(),
  failGap: vi.fn(),
  reconcileWithLiveGaps: vi.fn(),
  clearDeletedEcho: vi.fn(),
  clearActive: vi.fn(),
  showResult: vi.fn(),
})

const createLayoutDraft = (): LayoutDraft => ({
  id: 'hook-draft',
  channelId: 'dragon',
  date: '2026-03-25',
  source: 'channel_default',
  userIntent: '频道默认版面草案',
  coverage: { start: '09:00:00', end: '12:00:00' },
  layoutReference: {
    id: 'hook-layout',
    name: '东方卫视版面草案',
    channelId: 'dragon',
    slots: [
      {
        id: 'hook-slot',
        channelId: 'dragon',
        columnId: 'hook-column',
        startTime: '09:00:00',
        endTime: '12:00:00',
      },
    ],
  },
  columns: [
    {
      columnId: 'hook-column',
      columnName: '看东方',
      channelId: 'dragon',
      defaultProgramType: 'news_magazine',
      source: 'default',
      draftConstraintKind: 'column',
    },
  ],
})

const createHarness = () => {
  const playlistId = ref('tv-dragon-20260325')
  const focusRuntime = createFocusRuntime()
  const syncPageItemsToAtomic = vi.fn(() => {
    orchestratorMock.order.push('syncPageItemsToAtomic')
  })
  const activateScheduleWorkspace = vi.fn(() => {
    orchestratorMock.order.push('activateScheduleWorkspace')
  })
  const applyRuntimeScheduleItems = vi.fn()
  const persistCurrentPlaylistDocument = vi.fn()

  const hook = useBroadcastPlanOrchestration({
    currentChannelId: computed(() => 'dragon'),
    currentChannelName: computed(() => '东方卫视'),
    scheduleDate: computed(() => '2026-03-25'),
    scheduleItems: ref([]),
    displayGapCount: computed(() => 0),
    syncPageItemsToAtomic,
    syncAtomicItemsToPage: vi.fn(),
    applyRuntimeScheduleItems,
    syncAtomicItemsToPageDeferred: vi.fn(),
    persistCurrentPlaylistDocument,
    activateScheduleWorkspace,
    focusRuntime: focusRuntime as never,
    normalizeClockText: (value) => value,
    buildRuntimeSubmitInput: (userInput) => ({
      scheduleState: {
        playlistId: playlistId.value,
        playlistType: 'tv',
        channelId: 'dragon',
        channelName: '东方卫视',
        date: '2026-03-25',
        isEmpty: true,
        itemCount: 0,
        gapCount: 0,
        hasSelectedTimeRange: false,
      },
      userInput,
      currentSchedule: [],
    }),
  })

  return {
    hook,
    activateScheduleWorkspace,
    focusRuntime,
    syncPageItemsToAtomic,
    applyRuntimeScheduleItems,
    persistCurrentPlaylistDocument,
    playlistId,
  }
}

describe('useBroadcastPlanOrchestration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    orchestratorMock.order.length = 0
    orchestratorMock.startPartialGeneration.mockImplementation(async () => {
      orchestratorMock.order.push('startPartialGeneration')
    })
    orchestratorMock.startFullGeneration.mockImplementation(async () => {
      orchestratorMock.order.push('startFullGeneration')
    })
    orchestratorMock.startReactOrchestration.mockResolvedValue({ status: 'completed', scheduleItems: [] })
    orchestratorMock.recoverReactOrchestration.mockResolvedValue({
      status: 'cancelled',
      action: 'cancel',
      allowedActions: [],
      envelope: { noMutation: true },
    })
    clearRuntimeLayout('dragon', '2026-03-25')
  })

  /**
   * case formal-react-foreground-explicit-approval
   * - id: formal-react-foreground-explicit-approval
   * - userInput: 删除晚间待调整节目并继续完成正式编排
   * - expectedDecision: waiting_user 形成独立审批状态，确认按钮结构化调用 confirm_pending
   * - mustNotHappen: 把“确认”作为自然语言重新提交，或 waiting_user 时提前写入正式播单
   * - verification: pending approval 保留 workspace/version/runtimeInput，确认后应用返回快照
   */
  it('keeps waiting ReAct work as an explicit approval and resumes with confirm_pending', async () => {
    orchestratorMock.startReactOrchestration.mockResolvedValueOnce({
      status: 'waiting_user',
      checkpointCount: 1,
      pendingTask: { id: 'pending-delete', phase: 'needs_confirmation', summary: '删除晚间待调整节目' },
    })
    orchestratorMock.recoverReactOrchestration.mockResolvedValueOnce({
      status: 'ready',
      action: 'confirm_pending',
      allowedActions: ['confirm_pending', 'cancel'],
      envelope: { noMutation: true },
      executionStatus: 'completed',
      scheduleItems: [{
        id: 'item-after-confirm', programName: '晚间新闻',
        startTime: '2026-03-25T20:00:00', endTime: '2026-03-25T20:30:00', duration: 1800,
      }],
    })
    const { hook, applyRuntimeScheduleItems, persistCurrentPlaylistDocument } = createHarness()

    await hook.handleChatOrchestrateRequested({
      userInput: '删除晚间待调整节目并继续完成正式编排',
      mode: 'full_generate',
      reactTask: { objective: '完成正式编排', nextActions: [{ type: 'atomic_command', command: '删除晚间待调整节目' }] },
    })

    expect(hook.reactApproval.value).toMatchObject({
      workspaceKey: 'tv:tv-dragon-20260325',
      summary: '删除晚间待调整节目',
    })

    await hook.confirmReactApproval()

    expect(orchestratorMock.recoverReactOrchestration).toHaveBeenCalledWith(expect.objectContaining({
      action: 'confirm_pending',
      workspaceKey: 'tv:tv-dragon-20260325',
      playlistVersion: expect.stringMatching(/^formal_/),
      runtimeInput: expect.objectContaining({ userInput: '删除晚间待调整节目并继续完成正式编排' }),
    }))
    expect(applyRuntimeScheduleItems).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'item-after-confirm', programName: '晚间新闻' }),
    ])
    expect(persistCurrentPlaylistDocument).toHaveBeenCalledTimes(1)
    expect(hook.reactApproval.value).toBeNull()
  })

  /**
   * case formal-react-foreground-cancel-is-structured
   * - id: formal-react-foreground-cancel-is-structured
   * - userInput: 取消待确认的正式编排动作
   * - expectedDecision: 直接调用 recovery cancel 并清除前台审批状态
   * - mustNotHappen: 发送“取消”文本让 LLM 猜测，或触发任何正式写入
   * - verification: recover action=cancel，审批状态清空
   */
  it('cancels a waiting ReAct action through the structured recovery port', async () => {
    orchestratorMock.startReactOrchestration.mockResolvedValueOnce({
      status: 'waiting_user',
      pendingTask: { id: 'pending-delete', phase: 'needs_confirmation', summary: '删除晚间待调整节目' },
    })
    const { hook } = createHarness()
    await hook.handleChatOrchestrateRequested({
      userInput: '删除晚间待调整节目',
      mode: 'full_generate',
      reactTask: { objective: '完成正式编排', nextActions: [{ type: 'atomic_command', command: '删除晚间待调整节目' }] },
    })

    await hook.cancelReactApproval()

    expect(orchestratorMock.recoverReactOrchestration).toHaveBeenCalledWith(expect.objectContaining({
      action: 'cancel',
      workspaceKey: 'tv:tv-dragon-20260325',
    }))
    expect(hook.reactApproval.value).toBeNull()
  })

  /**
   * case formal-react-foreground-workspace-switch-invalidates-approval
   * - id: formal-react-foreground-workspace-switch-invalidates-approval
   * - userInput: 切换播单后点击上一张播单遗留的确认按钮
   * - expectedDecision: 旧审批状态失效且不调用恢复端口
   * - mustNotHappen: 携带旧 workspaceKey 对新播单执行删除或其他正式写入
   * - verification: reactApprovalIsCurrent=false，confirm 不触发 recover
   */
  it('invalidates a waiting approval after the playlist workspace changes', async () => {
    orchestratorMock.startReactOrchestration.mockResolvedValueOnce({
      status: 'waiting_user',
      pendingTask: { id: 'pending-delete', phase: 'needs_confirmation', summary: '删除晚间待调整节目' },
    })
    const { hook, playlistId } = createHarness()
    await hook.handleChatOrchestrateRequested({
      userInput: '删除晚间待调整节目',
      mode: 'full_generate',
      reactTask: { objective: '完成正式编排', nextActions: [{ type: 'atomic_command', command: '删除晚间待调整节目' }] },
    })

    playlistId.value = 'tv-dragon-another-playlist'
    expect(hook.reactApprovalIsCurrent.value).toBe(false)
    await hook.confirmReactApproval()

    expect(orchestratorMock.recoverReactOrchestration).not.toHaveBeenCalled()
    expect(hook.reactApproval.value).not.toBeNull()
  })

  it('switches to the schedule workspace before starting formal partial ReAct orchestration', async () => {
    const { hook, activateScheduleWorkspace, syncPageItemsToAtomic } = createHarness()

    await hook.handleChatOrchestrateRequested({
      userInput: '9点到12点编排东方剧场',
      mode: 'partial_generate',
      targetTimeRange: { start: '09:00:00', end: '12:00:00' },
      searchKeywords: ['栏目=东方剧场'],
      reactTask: {
        objective: '编排东方剧场',
        nextActions: [{ type: 'research_check', purpose: 'candidate_precheck', queries: ['东方剧场'] }],
      },
    })

    expect(activateScheduleWorkspace).toHaveBeenCalledTimes(1)
    expect(syncPageItemsToAtomic).not.toHaveBeenCalled()
    expect(orchestratorMock.startReactOrchestration).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'partial_generate',
        targetTimeRange: { start: '09:00:00', end: '12:00:00' },
        searchKeywords: ['栏目=东方剧场'],
      }),
      expect.objectContaining({ userInput: '9点到12点编排东方剧场' }),
    )
    expect(orchestratorMock.startPartialGeneration).not.toHaveBeenCalled()
  })

  it('persists an explicitly referenced draft only when the formal request carries a layout draft', async () => {
    const { hook } = createHarness()
    const draft = createLayoutDraft()

    await hook.handleChatOrchestrateRequested({
      userInput: '参考草案补齐当前所有空窗',
      mode: 'partial_generate',
      layoutDraft: draft,
      targetTimeRange: draft.coverage,
      reactTask: {
        objective: '按草案补齐空窗',
        nextActions: [{ type: 'research_check', purpose: 'candidate_precheck', queries: ['频道版面草案'] }],
      },
    })

    expect(getRuntimeLayoutEntry('dragon', '2026-03-25')).toMatchObject({
      sourceFileName: '频道版面草案',
      layoutReference: draft.layoutReference,
      columns: draft.columns,
    })
    expect(orchestratorMock.startReactOrchestration).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'partial_generate', targetTimeRange: draft.coverage }),
      expect.any(Object),
    )
    expect(orchestratorMock.startPartialGeneration).not.toHaveBeenCalled()
  })

  it('starts full orchestration with the draft coverage after a layout draft commit', async () => {
    const { hook } = createHarness()
    const draft = createLayoutDraft()

    await hook.handleChatOrchestrateRequested({
      userInput: '按这个版面开始编排',
      mode: 'full_generate',
      layoutDraft: draft,
      reactTask: {
        objective: '按版面草案完成正式编排',
        nextActions: [{ type: 'research_check', purpose: 'candidate_precheck', queries: ['频道版面草案'] }],
      },
    })

    expect(getRuntimeLayoutEntry('dragon', '2026-03-25')).toMatchObject({
      layoutReference: draft.layoutReference,
      columns: draft.columns,
    })
    expect(orchestratorMock.startReactOrchestration).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'full_generate', targetTimeRange: draft.coverage }),
      expect.any(Object),
    )
    expect(orchestratorMock.startFullGeneration).not.toHaveBeenCalled()
  })

  /**
   * case formal-foreground-missing-react-plan-fails-closed
   * - id: formal-foreground-missing-react-plan-fails-closed
   * - userInput: 按这个版面开始编排
   * - expectedDecision: 前台拒绝缺少 reactTask 的正式编排请求并提示重试
   * - mustNotHappen: 回退 startFullGeneration/startPartialGeneration 或写入播单
   * - verification: 三个执行入口均未调用，页面显示错误消息
   */
  it('does not fall back to legacy orchestration when a formal request has no reactTask', async () => {
    const { hook } = createHarness()

    await hook.handleChatOrchestrateRequested({
      userInput: '按这个版面开始编排',
      mode: 'full_generate',
      layoutDraft: createLayoutDraft(),
    })

    expect(orchestratorMock.startReactOrchestration).not.toHaveBeenCalled()
    expect(orchestratorMock.startFullGeneration).not.toHaveBeenCalled()
    expect(orchestratorMock.startPartialGeneration).not.toHaveBeenCalled()
    expect(ElMessage.error).toHaveBeenCalledWith(expect.stringContaining('ReAct'))
  })
})
