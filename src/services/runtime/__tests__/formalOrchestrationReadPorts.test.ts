import { describe, expect, it, vi } from 'vitest'

import { createFormalOrchestrationReadPorts } from '../formalOrchestrationReadPorts'

const createContext = () => ({
  channelId: 'dragon', date: '2026-07-18', playlistId: 'playlist-a', playlistType: 'tv',
  scheduleItems: [],
  programCandidates: [{
    id: 'candidate-1', programId: 'p1', programCode: 'NEWS001', programName: '晚间新闻', channelId: 'dragon',
    duration: 1800, programType: 'news', instanceName: '晚间新闻第1期', materialStatus: 'ready', rightsStatus: 'ready',
  }],
  broadcastReadiness: [], historySchedules: [], lockedItemIds: [], blockedTimeRanges: [],
  bundle: {
    identity: { channelId: 'dragon', date: '2026-07-18', playlistId: 'playlist-a', playlistType: 'tv' },
    sources: {
      today: { source: 'runtime', available: true, recordCount: 0 },
      candidates: { source: 'runtime', available: true, recordCount: 1 },
      readiness: { source: 'runtime', available: true, recordCount: 1 },
      history: { source: 'runtime', available: true, recordCount: 0 },
      constraints: { source: 'runtime', available: true, recordCount: 0 },
      policy: { source: 'runtime', available: true, recordCount: 1 },
    },
    today: { scheduleItems: [], itemCount: 0 }, candidates: { programCandidates: [], totalCount: 1 }, readiness: { broadcastReadiness: [] },
    history: { schedules: [], todayOverridesHistory: true }, constraints: { lockedItemIds: [], blockedTimeRanges: [] },
    policy: { playlistType: 'tv', tvStrictFill: true, rotationCandidateWritesRequireConfirmation: true, sensitiveWriteIntentsRequireConfirmation: ['delete', 'batch_delete'] },
  },
})

describe('formal orchestration real read ports', () => {
  /**
   * case formal-read-port-research-real-gateway
   * - userInput: 查“晚间新闻”和“民生新闻”候选
   * - expectedDecision: LLM action 的查询词原样进入 SchedulingDataGateway 并形成候选 observation
   * - mustNotHappen: 本地补关键词；调用 commitScheduleItems；丢失数据源证据
   * - verification: loadContext input 含原查询，结果含候选与 sourceEvidence，commit 为 0 次
   */
  it('loads candidate evidence from SchedulingDataGateway without mutation', async () => {
    const loadContext = vi.fn(async () => createContext() as any)
    const commitScheduleItems = vi.fn()
    const ports = createFormalOrchestrationReadPorts({
      workspaceKey: 'ws-a',
      dataGateway: { loadContext, commitScheduleItems },
      baseInput: { userInput: '补排晚间空窗', channelId: 'dragon', date: '2026-07-18', playlistId: 'playlist-a' },
    })

    const result = await ports.researchCheck!({ type: 'research_check', queries: ['晚间新闻', '民生新闻'] }, { workspaceKey: 'ws-a', runId: 'run-1', turn: 1 })

    expect(loadContext).toHaveBeenCalledWith(expect.objectContaining({
      interpretation: expect.objectContaining({ searchAlternatives: ['晚间新闻', '民生新闻'] }),
    }))
    expect(result).toMatchObject({ workspaceKey: 'ws-a', noMutation: true, mutationPolicy: 'preview_only' })
    expect(result.data).toMatchObject({ candidateCount: 1, candidates: [expect.objectContaining({ id: 'candidate-1', programName: '晚间新闻' })] })
    expect(commitScheduleItems).not.toHaveBeenCalled()
  })

  /**
   * case formal-read-port-validation-real-engine
   * - userInput: 校验当前正式播单
   * - expectedDecision: 使用真实 gateway context 和 AgentConstraintEngine 返回校验 observation
   * - mustNotHappen: 修改播单；把 critical issue 隐藏成成功
   * - verification: data.validationReport 包含 ok/issues，commit 为 0 次
   */
  it('validates the gateway context with the existing constraint engine', async () => {
    const context = createContext()
    context.scheduleItems = [
      { id: 'a', programId: 'p1', programCode: 'P1', programName: 'A', startTime: '2026-07-18T09:00:00', endTime: '2026-07-18T10:00:00', duration: 3600 },
      { id: 'b', programId: 'p2', programCode: 'P2', programName: 'B', startTime: '2026-07-18T09:30:00', endTime: '2026-07-18T10:30:00', duration: 3600 },
    ] as any
    const commitScheduleItems = vi.fn()
    const ports = createFormalOrchestrationReadPorts({
      workspaceKey: 'ws-a', dataGateway: { loadContext: vi.fn(async () => context as any), commitScheduleItems },
      baseInput: { userInput: '校验当前播单', channelId: 'dragon', date: '2026-07-18', playlistId: 'playlist-a' },
    })

    const result = await ports.validate!({ type: 'validate' }, { workspaceKey: 'ws-a', runId: 'run-1', turn: 1 })

    expect(result.noMutation).toBe(true)
    expect(result.data?.validationReport).toMatchObject({ ok: false })
    expect((result.data?.validationReport as { issues: unknown[] }).issues.length).toBeGreaterThan(0)
    expect(commitScheduleItems).not.toHaveBeenCalled()
  })
})
