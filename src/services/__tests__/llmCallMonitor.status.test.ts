import { describe, expect, it } from 'vitest'

import { inferLlmCallStatus } from '@/services/agent/llmCallMonitor'

/**
 * D15 修复：inferLlmCallStatus 需要识别中文"超时"。
 */
describe('inferLlmCallStatus Chinese timeout', () => {
  /**
   * case c2-monitor-chinese-timeout
   * - expectedDecision: 错误信息含中文"超时"时返回 timeout
   * - mustNotHappen: 返回 error；区分大小写失败
   */
  it('returns timeout for Chinese timeout messages', () => {
    expect(inferLlmCallStatus(false, 'LLM 网络请求超时，请检查网络')).toBe('timeout')
    expect(inferLlmCallStatus(false, '请求已超时')).toBe('timeout')
    expect(inferLlmCallStatus(false, '连接超时')).toBe('timeout')
  })
})