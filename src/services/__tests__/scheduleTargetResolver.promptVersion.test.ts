import { describe, expect, it, vi } from 'vitest'

import { ScheduleTargetResolver, SCHEDULE_TARGET_RESOLVER_PROMPT_VERSION } from '@/services/scheduleTargetResolver'

describe('ScheduleTargetResolver promptVersion 透传', () => {
  /**
   * case c14-schedule-target-resolver-passes-version
   * - expectedDecision: pickWithLLM 调用 LLM 时透传 promptVersion + traceLabel
   * - mustNotHappen: options 缺失 promptVersion 或 traceLabel
   * - verification: chat.mock.calls[0][1] 含 promptVersion + traceLabel: 'schedule_target_resolve'
   *
   * 说明：resolve 在「无 programName 且唯一候选」时会提前本地收敛，不触发 LLM。
   * 此处显式提供 programName 以确保进入 pickWithLLM 链路，验证版本号透传。
   */
  it('c14-schedule-target-resolver-passes-version: resolve 透传 promptVersion', async () => {
    const chat = vi.fn(async () => ({
      content: '{"status":"unique","targetItemId":"item-1","reasoning":"测试"}',
    }))
    const resolver = new ScheduleTargetResolver({ chat } as never)

    await resolver.resolve({
      userInput: '删除10点的节目',
      action: 'delete',
      channelName: '东方卫视',
      date: '2026-03-25',
      targetTime: '10:00:00',
      programName: '东方新闻',
      items: [
        {
          id: 'item-1',
          programName: '东方新闻',
          startTime: '10:00:00',
          endTime: '10:30:00',
        },
      ],
    })

    expect(chat).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        promptVersion: SCHEDULE_TARGET_RESOLVER_PROMPT_VERSION,
        traceLabel: 'schedule_target_resolve',
      }),
    )
  })
})
