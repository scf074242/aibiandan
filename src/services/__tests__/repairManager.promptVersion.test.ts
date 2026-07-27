import { describe, expect, it, vi } from 'vitest'

import { RepairManager, REPAIR_MANAGER_PROMPT_VERSION } from '@/services/repairManager'
import type { ValidationReport } from '@/types/orchestration'

describe('RepairManager promptVersion 透传', () => {
  /**
   * case c15-repair-manager-passes-version
   * - expectedDecision: generateRepairCommand 调用 LLM 时透传 promptVersion + traceLabel
   * - mustNotHappen: options 缺失 promptVersion 或 traceLabel
   * - verification: chat.mock.calls[0][1] 含 promptVersion + traceLabel: 'repair_strategy'
   *
   * 说明：startRepair 在 isValid=true 时会提前返回，不触发 LLM；
   * 此处传入 isValid=false 的报告 + 1 个 warning 问题，确保进入 generateRepairCommand 链路。
   * 修补执行后 revalidate 返回 isValid=true，使循环在首轮后收敛退出。
   */
  it('c15-repair-manager-passes-version: startRepair 透传 promptVersion', async () => {
    const chat = vi.fn(async () => ({
      content: '{"action":"repair","data":{"targetId":"gap-1","targetType":"gap","strategy":"add_filler","parameters":{}},"reasoning":"测试"}',
    }))
    const commandExecutor = { execute: vi.fn(async () => ({ success: true, message: 'ok' })) }
    const validReport: ValidationReport = {
      id: 'report-valid',
      scope: 'item',
      targetId: 'gap-1',
      timestamp: '2026-03-25T00:00:00+08:00',
      issues: [],
      summary: { totalIssues: 0, criticalCount: 0, warningCount: 0, infoCount: 0 },
      isValid: true,
    }
    const validationEngine = { validate: vi.fn(async () => validReport) }
    const manager = new RepairManager(commandExecutor as never, validationEngine as never, { chat } as never)

    const invalidReport: ValidationReport = {
      id: 'report-invalid',
      scope: 'item',
      targetId: 'gap-1',
      timestamp: '2026-03-25T00:00:00+08:00',
      issues: [
        {
          id: 'issue-1',
          type: 'gap',
          severity: 'warning',
          message: '存在空窗',
          location: {},
          createdAt: '2026-03-25T00:00:00+08:00',
        },
      ],
      summary: { totalIssues: 1, criticalCount: 0, warningCount: 1, infoCount: 0 },
      isValid: false,
    }

    await manager.startRepair(invalidReport, { items: [], candidates: [] })

    expect(chat).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        promptVersion: REPAIR_MANAGER_PROMPT_VERSION,
        traceLabel: 'repair_strategy',
      }),
    )
  })
})
