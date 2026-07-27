import { describe, expect, it, vi } from 'vitest'

import { createChatPanelActiveRequestController } from '../chatPanelActiveRequestController'

const cases = {
  fiveSecondGate: {
    id: 'chat-panel-short-request-stop-after-five-seconds',
    userInput: '在9点插入节目看东方',
    expectedDecision: '短链请求开始后保持发送按钮禁用，5秒后切换为可停止状态',
    mustNotHappen: '请求刚发出就允许误触停止，或长时间等待时完全没有停止入口',
    verification: 'advance 4999ms 不可停，advance 到5000ms 后 canStop=true',
  },
  serverAbort: {
    id: 'chat-panel-short-request-stop-calls-server',
    userInput: '停止当前请求',
    expectedDecision: '停止时携带活动 workspaceKey 调用服务端取消并记录 stopRequested',
    mustNotHappen: '只清理前台 loading 状态而不调用服务端取消',
    verification: 'cancel 回调收到 workspaceKey，成功后 stopRequested=true',
  },
} as const

describe('chatPanelActiveRequestController', () => {
  it(cases.fiveSecondGate.id, async () => {
    vi.useFakeTimers()
    const controller = createChatPanelActiveRequestController()
    controller.start('workspace-tv-1')
    await vi.advanceTimersByTimeAsync(4_999)
    expect(controller.active.value).toBe(true)
    expect(controller.canStop.value).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(controller.canStop.value).toBe(true)
    expect(cases.fiveSecondGate).toMatchObject({ expectedDecision: expect.any(String), mustNotHappen: expect.any(String), verification: expect.any(String) })
    controller.finish()
    vi.useRealTimers()
  })

  it(cases.serverAbort.id, async () => {
    vi.useFakeTimers()
    const cancel = vi.fn(async () => ({ stopped: true, reason: 'stopped' as const }))
    const controller = createChatPanelActiveRequestController()
    controller.start('workspace-tv-2')
    await vi.advanceTimersByTimeAsync(5_000)
    await expect(controller.stop(cancel)).resolves.toMatchObject({ stopped: true })
    expect(cancel).toHaveBeenCalledWith('workspace-tv-2')
    expect(controller.stopRequested.value).toBe(true)
    expect(cases.serverAbort).toMatchObject({ expectedDecision: expect.any(String), mustNotHappen: expect.any(String), verification: expect.any(String) })
    controller.finish()
    vi.useRealTimers()
  })
})
