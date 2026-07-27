import { describe, expect, it, vi } from 'vitest'

import { LAYOUT_ANALYSIS_PROMPT_VERSION } from '@/services/layoutAnalysisPromptBuilder'
import { LayoutAnalysisService } from '@/services/layoutAnalysisService'
import type { ValidationReport } from '@/types/orchestration'

describe('LayoutAnalysisService promptVersion 透传', () => {
  /**
   * case c11-layout-analysis-passes-version
   * - expectedDecision: analyze 调用 LLM 时透传 promptVersion + traceLabel
   * - mustNotHappen: options 缺失 promptVersion 或 traceLabel
   * - verification: chat.mock.calls[0][1] 含 promptVersion + traceLabel: 'layout_analysis'
   *
   * 说明：analyze 在 currentSchedule 为空时会提前返回 fallback，不触发 LLM；
   * 此处显式提供 1 条节目，确保进入 LLM 分析链路，验证版本号透传。
   */
  it('c11-layout-analysis-passes-version: analyze 透传 promptVersion', async () => {
    const chat = vi.fn(async () => ({
      content: '这是一份分析报告。总评：当前版面结构合理。',
    }))
    const service = new LayoutAnalysisService({ chat } as never)

    const validationReport: ValidationReport = {
      id: 'report-1',
      scope: 'full',
      targetId: 'dragon-2026-03-25',
      timestamp: '2026-03-25T00:00:00+08:00',
      issues: [],
      summary: {
        totalIssues: 0,
        criticalCount: 0,
        warningCount: 0,
        infoCount: 0,
      },
      isValid: true,
    }

    await service.analyze({
      channelId: 'dragon',
      channelName: '东方卫视',
      date: '2026-03-25',
      userInput: '帮我分析一下当前版面',
      currentSchedule: [
        {
          id: 'item-1',
          programName: '东方新闻',
          startTime: '10:00:00',
          endTime: '10:30:00',
          duration: 1800,
          programType: 'news',
        },
      ],
      validationReport,
    })

    expect(chat).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        promptVersion: LAYOUT_ANALYSIS_PROMPT_VERSION,
        traceLabel: 'layout_analysis',
      }),
    )
  })
})
