import { describe, expect, it, vi } from 'vitest'

import { AgentDeadline, LONG_RUNNING_DEADLINE_BUDGET } from '@/services/agent/agentDeadline'
import { FormalOrchestrationCapability } from '@/services/agent/formalOrchestrationCapability'
import type { AgentCapabilityRuntime, AgentSubmitInput } from '@/services/agent/types'

const createInput = (mode: 'full_generate' | 'partial_generate'): AgentSubmitInput => ({
  userInput: mode === 'full_generate' ? '帮我全天编排' : '补齐当前所有空窗',
  channelId: 'dragon',
  date: '2026-06-30',
  playlistId: 'playlist-a',
  orchestration: {
    mode,
    channelId: 'dragon',
    date: '2026-06-30',
  },
})

const createRuntime = () => {
  const loadContext = vi.fn()
  const commitScheduleItems = vi.fn()
  const runtime: AgentCapabilityRuntime = {
    dataGateway: { loadContext, commitScheduleItems },
    candidateJudge: {} as never,
    trace: { record: vi.fn(), getTrace: vi.fn(() => []) },
    deadline: new AgentDeadline({ overallDeadlineMs: LONG_RUNNING_DEADLINE_BUDGET.overallDeadlineMs }),
  }
  return { runtime, loadContext, commitScheduleItems }
}

describe('FormalOrchestrationCapability failure exposure', () => {
  /**
   * case formal-full-generate-missing-react-plan-fails-closed
   * - id: formal-full-generate-missing-react-plan-fails-closed
   * - userInput: 帮我全天编排
   * - expectedDecision: 返回 react_plan_invalid 且允许按原输入重试
   * - mustNotHappen: 调用旧 Orchestrator、查候选或写正式播单
   * - verification: failed/noMutation，gateway 调用均为 0
   */
  it('fails full generation before any action when reactTask is missing', async () => {
    const { runtime, loadContext, commitScheduleItems } = createRuntime()
    const result = await new FormalOrchestrationCapability().handle(createInput('full_generate'), runtime)

    expect(result.status).toBe('failed')
    expect(result.decision.constraintReport?.issues[0]?.detail).toMatchObject({
      recoverableFailure: { kind: 'react_plan_invalid', noMutation: true },
    })
    expect(loadContext).not.toHaveBeenCalled()
    expect(commitScheduleItems).not.toHaveBeenCalled()
  })

  /**
   * case formal-partial-generate-missing-react-plan-fails-closed
   * - id: formal-partial-generate-missing-react-plan-fails-closed
   * - userInput: 补齐当前所有空窗
   * - expectedDecision: 局部/整体补排与全天编排使用同一失败边界
   * - mustNotHappen: partial_generate 绕过 reactTask 要求进入旧候选评分链
   * - verification: failed/react_plan_invalid/noMutation，gateway 调用均为 0
   */
  it('fails partial generation through the same structured boundary', async () => {
    const { runtime, loadContext, commitScheduleItems } = createRuntime()
    const result = await new FormalOrchestrationCapability().handle(createInput('partial_generate'), runtime)

    expect(result.status).toBe('failed')
    expect(result.decision.constraintReport?.issues[0]?.detail).toMatchObject({
      recoverableFailure: { kind: 'react_plan_invalid', noMutation: true },
    })
    expect(loadContext).not.toHaveBeenCalled()
    expect(commitScheduleItems).not.toHaveBeenCalled()
  })
})
