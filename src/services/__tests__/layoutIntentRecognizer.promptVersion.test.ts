import { describe, expect, it, vi } from 'vitest'

import { LayoutIntentRecognizer, LAYOUT_INTENT_RECOGNIZER_PROMPT_VERSION } from '@/services/layoutIntentRecognizer'

describe('LayoutIntentRecognizer promptVersion 透传', () => {
  /**
   * case c13-layout-intent-passes-version
   * - expectedDecision: recognize 调用 LLM 时透传 promptVersion
   * - mustNotHappen: options 缺失 promptVersion
   * - verification: chat.mock.calls[0][1] 含 promptVersion
   */
  it('c13-layout-intent-passes-version: recognize 透传 promptVersion', async () => {
    const chat = vi.fn(async () => ({
      content: '{"mode":"clarify","confidence":0.5,"reasoning":"测试","ignoreExistingLayout":false}',
    }))
    const recognizer = new LayoutIntentRecognizer({ chat } as never)

    await recognizer.recognize({
      scheduleState: {
        channelId: 'dragon',
        channelName: '东方卫视',
        date: '2026-03-25',
        isEmpty: true,
        itemCount: 0,
        gapCount: 0,
        hasSelectedTimeRange: false,
      },
      userInput: '帮我分析一下',
    })

    expect(chat).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        promptVersion: LAYOUT_INTENT_RECOGNIZER_PROMPT_VERSION,
        traceLabel: 'layout_intent',
      }),
    )
  })
})
