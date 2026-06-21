import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, ref } from 'vue'

import { clearRuntimeLayout, getRuntimeLayoutEntry } from '@/services/orchestration/runtimeLayoutRegistry'
import type { LayoutDraft } from '@/types/orchestration'
import { useBroadcastPlanOrchestration } from '../useBroadcastPlanOrchestration'

const orchestratorMock = vi.hoisted(() => ({
  order: [] as string[],
  startPartialGeneration: vi.fn(),
  startFullGeneration: vi.fn(),
  cancel: vi.fn(),
}))

vi.mock('@/composables/useOrchestrator', () => ({
  useOrchestrator: () => ({
    progress: ref({ liveGaps: [] }),
    startPartialGeneration: orchestratorMock.startPartialGeneration,
    startFullGeneration: orchestratorMock.startFullGeneration,
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
  const focusRuntime = createFocusRuntime()
  const syncPageItemsToAtomic = vi.fn(() => {
    orchestratorMock.order.push('syncPageItemsToAtomic')
  })
  const activateScheduleWorkspace = vi.fn(() => {
    orchestratorMock.order.push('activateScheduleWorkspace')
  })

  const hook = useBroadcastPlanOrchestration({
    currentChannelId: computed(() => 'dragon'),
    currentChannelName: computed(() => '东方卫视'),
    scheduleDate: computed(() => '2026-03-25'),
    scheduleItems: ref([]),
    displayGapCount: computed(() => 0),
    syncPageItemsToAtomic,
    syncAtomicItemsToPage: vi.fn(),
    applyRuntimeScheduleItems: vi.fn(),
    syncAtomicItemsToPageDeferred: vi.fn(),
    persistCurrentPlaylistDocument: vi.fn(),
    activateScheduleWorkspace,
    focusRuntime: focusRuntime as never,
    normalizeClockText: (value) => value,
  })

  return {
    hook,
    activateScheduleWorkspace,
    focusRuntime,
    syncPageItemsToAtomic,
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
    clearRuntimeLayout('dragon', '2026-03-25')
  })

  it('switches to the schedule workspace before starting formal partial orchestration', async () => {
    const { hook, activateScheduleWorkspace, syncPageItemsToAtomic } = createHarness()

    await hook.handleChatOrchestrateRequested({
      userInput: '9点到12点编排东方剧场',
      mode: 'partial_generate',
      targetTimeRange: { start: '09:00:00', end: '12:00:00' },
      searchKeywords: ['栏目=东方剧场'],
    })

    expect(activateScheduleWorkspace).toHaveBeenCalledTimes(1)
    expect(syncPageItemsToAtomic).toHaveBeenCalledTimes(1)
    expect(orchestratorMock.order).toEqual([
      'activateScheduleWorkspace',
      'resetForRun',
      'syncPageItemsToAtomic',
      'startPartialGeneration',
    ])
    expect(orchestratorMock.startPartialGeneration).toHaveBeenCalledWith(
      'dragon',
      '2026-03-25',
      {
        targetTimeRange: { start: '09:00:00', end: '12:00:00' },
        searchKeywords: ['栏目=东方剧场'],
      },
    )
  })

  it('persists an explicitly referenced draft only when the formal request carries a layout draft', async () => {
    const { hook } = createHarness()
    const draft = createLayoutDraft()

    await hook.handleChatOrchestrateRequested({
      userInput: '参考草案补齐当前所有空窗',
      mode: 'partial_generate',
      layoutDraft: draft,
      targetTimeRange: draft.coverage,
    })

    expect(getRuntimeLayoutEntry('dragon', '2026-03-25')).toMatchObject({
      sourceFileName: '频道版面草案',
      layoutReference: draft.layoutReference,
      columns: draft.columns,
    })
    expect(orchestratorMock.startPartialGeneration).toHaveBeenCalledWith(
      'dragon',
      '2026-03-25',
      {
        targetTimeRange: draft.coverage,
      },
    )
  })

  it('starts full orchestration with the draft coverage after a layout draft commit', async () => {
    const { hook } = createHarness()
    const draft = createLayoutDraft()

    await hook.handleChatOrchestrateRequested({
      userInput: '按这个版面开始编排',
      mode: 'full_generate',
      layoutDraft: draft,
    })

    expect(getRuntimeLayoutEntry('dragon', '2026-03-25')).toMatchObject({
      layoutReference: draft.layoutReference,
      columns: draft.columns,
    })
    expect(orchestratorMock.startFullGeneration).toHaveBeenCalledWith(
      'dragon',
      '2026-03-25',
      draft.coverage.start,
      draft.coverage.end,
    )
  })
})
