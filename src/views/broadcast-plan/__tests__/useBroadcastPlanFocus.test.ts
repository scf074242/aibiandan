import { afterEach, describe, expect, it, vi } from 'vitest'

import { useBroadcastPlanFocus } from '../useBroadcastPlanFocus'

describe('useBroadcastPlanFocus', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('会在编排开始时重置自动跟随与当前焦点', () => {
    const focus = useBroadcastPlanFocus()

    focus.startGap({
      id: 'gap-1',
      startTime: '09:00:00',
      endTime: '09:30:00',
      duration: 1800,
      constraints: {},
      metadata: {
        source: 'generated',
        priority: 1,
        createdAt: '2026-04-08T09:00:00.000Z',
        updatedAt: '2026-04-08T09:00:00.000Z',
      },
    })
    focus.pauseAutoFollow()

    focus.resetForRun()

    expect(focus.enabled.value).toBe(true)
    expect(focus.autoFollow.value).toBe(true)
    expect(focus.pausedByUser.value).toBe(false)
    expect(focus.active.value).toBeNull()
  })

  it('会记录当前处理空窗和成功填充条目', () => {
    const focus = useBroadcastPlanFocus()

    focus.startGap({
      id: 'gap-2',
      startTime: '10:00:00',
      endTime: '10:30:00',
      duration: 1800,
      constraints: {},
      metadata: {
        source: 'generated',
        priority: 1,
        createdAt: '2026-04-08T10:00:00.000Z',
        updatedAt: '2026-04-08T10:00:00.000Z',
      },
    })

    expect(focus.active.value).toEqual({
      type: 'gap',
      gapId: 'gap-2',
      startTime: '10:00:00',
      endTime: '10:30:00',
    })
    expect(focus.status.value).toBe('active')

    focus.completeItem({
      id: 'item-1',
      startTime: '10:00:00',
      endTime: '10:30:00',
    })

    expect(focus.active.value).toEqual({
      type: 'item',
      itemId: 'item-1',
      startTime: '10:00:00',
      endTime: '10:30:00',
    })
    expect(focus.status.value).toBe('success')
    expect(focus.isRecentItem('item-1')).toBe(true)
  })

  it('会在失败后保留错误焦点并支持恢复跟随', () => {
    const focus = useBroadcastPlanFocus()

    focus.failGap(
      {
        id: 'gap-3',
        startTime: '11:00:00',
        endTime: '11:30:00',
        duration: 1800,
        constraints: {},
        metadata: {
          source: 'generated',
          priority: 1,
          createdAt: '2026-04-08T11:00:00.000Z',
          updatedAt: '2026-04-08T11:00:00.000Z',
        },
      },
      '候选不足',
    )
    focus.pauseAutoFollow()
    focus.resumeAutoFollow()

    expect(focus.status.value).toBe('error')
    expect(focus.lastError.value).toBe('候选不足')
    expect(focus.autoFollow.value).toBe(true)
    expect(focus.pausedByUser.value).toBe(false)
  })

  it('支持通过手动锚点请求定位到 range 或 item', () => {
    const focus = useBroadcastPlanFocus()

    focus.focusAnchor({
      type: 'range',
      startTime: '13:00:00',
      endTime: '13:30:00',
    })

    expect(focus.active.value).toEqual({
      type: 'range',
      startTime: '13:00:00',
      endTime: '13:30:00',
    })
    expect(focus.status.value).toBe('active')

    focus.focusAnchor({
      type: 'item',
      itemId: 'item-3',
      startTime: '13:30:00',
      endTime: '14:00:00',
    }, 'error', '需要人工确认')

    expect(focus.active.value).toEqual({
      type: 'item',
      itemId: 'item-3',
      startTime: '13:30:00',
      endTime: '14:00:00',
    })
    expect(focus.status.value).toBe('error')
    expect(focus.lastError.value).toBe('需要人工确认')
  })

  it('命令定位焦点不会进入全局摘要层', () => {
    const focus = useBroadcastPlanFocus()

    focus.focusIntent({
      type: 'range',
      startTime: '09:00:00',
      endTime: '09:00:00',
    })

    expect(focus.currentLayer.value).toBe('intent')
    expect(focus.showSummary.value).toBe(false)
    expect(focus.isPointAnchor.value).toBe(true)
  })

  it('执行结果焦点会覆盖旧的命令定位并在短暂展示后退场', () => {
    vi.useFakeTimers()
    const focus = useBroadcastPlanFocus()

    focus.focusIntent({
      type: 'range',
      startTime: '09:00:00',
      endTime: '09:00:00',
    })
    focus.showResult({
      type: 'range',
      startTime: '09:00:00',
      endTime: '10:00:00',
    })

    expect(focus.currentLayer.value).toBe('result')
    expect(focus.summaryText.value).toContain('已完成')

    vi.advanceTimersByTime(1700)

    expect(focus.currentLayer.value).toBeNull()
    expect(focus.active.value).toBeNull()
  })

  it('会显示短暂的删除回声 marker', () => {
    vi.useFakeTimers()
    const focus = useBroadcastPlanFocus()

    focus.showDeletedEcho({
      itemId: 'item-4',
      programName: '午间30分',
      startTime: '14:00:00',
      endTime: '14:30:00',
    })

    expect(focus.deletedEcho.value?.programName).toBe('午间30分')

    vi.advanceTimersByTime(2900)

    expect(focus.deletedEcho.value).toBeNull()
  })

  it('会在短暂成功态后自动清除 recent 标记', () => {
    vi.useFakeTimers()
    const focus = useBroadcastPlanFocus()

    focus.completeItem({
      id: 'item-2',
      startTime: '12:00:00',
      endTime: '12:30:00',
    })

    expect(focus.isRecentItem('item-2')).toBe(true)

    vi.advanceTimersByTime(2300)

    expect(focus.isRecentItem('item-2')).toBe(false)
  })
  it('会在失败 gap 已不再存在时清理过期错误焦点', () => {
    const focus = useBroadcastPlanFocus()

    focus.failGap(
      {
        id: 'gap-stale',
        startTime: '15:45:00',
        endTime: '17:30:00',
        duration: 6300,
        constraints: {},
        metadata: {
          source: 'generated',
          priority: 1,
          createdAt: '2026-04-08T15:45:00.000Z',
          updatedAt: '2026-04-08T15:45:00.000Z',
        },
      },
      'No candidates found',
    )

    focus.reconcileWithLiveGaps([
      {
        id: 'gap-other',
        startTime: '18:00:00',
        endTime: '18:30:00',
        status: 'pending',
        error: undefined,
      },
    ])

    expect(focus.active.value).toBeNull()
    expect(focus.status.value).toBeNull()
    expect(focus.lastError.value).toBeNull()
  })

  it('会在失败 gap 仍然存在时保留错误焦点并同步错误信息', () => {
    const focus = useBroadcastPlanFocus()

    focus.failGap(
      {
        id: 'gap-live',
        startTime: '19:00:00',
        endTime: '19:30:00',
        duration: 1800,
        constraints: {},
        metadata: {
          source: 'generated',
          priority: 1,
          createdAt: '2026-04-08T19:00:00.000Z',
          updatedAt: '2026-04-08T19:00:00.000Z',
        },
      },
      '旧错误',
    )

    focus.reconcileWithLiveGaps([
      {
        id: 'gap-live',
        startTime: '19:00:00',
        endTime: '19:30:00',
        status: 'failed',
        error: '最新错误',
      },
    ])

    expect(focus.active.value).toEqual({
      type: 'gap',
      gapId: 'gap-live',
      startTime: '19:00:00',
      endTime: '19:30:00',
    })
    expect(focus.status.value).toBe('error')
    expect(focus.lastError.value).toBe('最新错误')
  })
})
