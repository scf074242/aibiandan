import { describe, expect, it, vi } from 'vitest'

import { canonicalSchedulingData } from '@/services/agent/canonicalSchedulingData'
import { createFormalOrchestrationReadPorts } from '../formalOrchestrationReadPorts'

const canonicalTrendingCandidate = canonicalSchedulingData.candidates.find((candidate) => (
  typeof candidate.popularityScore === 'number'
  && typeof candidate.estimatedRating === 'number'
  && typeof candidate.playCount === 'number'
))

if (!canonicalTrendingCandidate) {
  throw new Error('data_fixture_missing: formal ReAct trending evidence requires a canonical candidate with popularity metrics')
}

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
   * case post9-rotation-compression-staged-react
   * - userInput: 按热播优先把当前3小时轮播单压缩到2小时
   * - expectedDecision: research observation 原样保留 canonical 候选的热度、收视率和播放量证据供 LLM 取舍
   * - mustNotHappen: read port 丢弃策略证据；本地排序或重算分数；让 LLM 在无证据时猜测热播
   * - verification: observation candidate 的三个指标与 canonical 数据严格相等，且不触发 commit
   */
  it('post9-rotation-compression-staged-react: preserves canonical trending evidence for the LLM decider', async () => {
    const context = createContext()
    context.programCandidates = [canonicalTrendingCandidate] as any
    const commitScheduleItems = vi.fn()
    const ports = createFormalOrchestrationReadPorts({
      workspaceKey: 'rotation:rotation-compression',
      dataGateway: { loadContext: vi.fn(async () => context as any), commitScheduleItems },
      baseInput: {
        userInput: '按热播优先把当前3小时轮播单压缩到2小时',
        channelId: 'rotation',
        date: '2026-07-28',
        playlistId: 'rotation-compression',
      },
    })

    const result = await ports.researchCheck!(
      { type: 'research_check', queries: [canonicalTrendingCandidate.programName] },
      { workspaceKey: 'rotation:rotation-compression', runId: 'post9-compression', turn: 1 },
    )

    expect(result.data?.candidates).toEqual([
      expect.objectContaining({
        id: canonicalTrendingCandidate.id,
        popularityScore: canonicalTrendingCandidate.popularityScore,
        estimatedRating: canonicalTrendingCandidate.estimatedRating,
        playCount: canonicalTrendingCandidate.playCount,
      }),
    ])
    expect(commitScheduleItems).not.toHaveBeenCalled()
  })

  /**
   * case post9-rotation-compression-staged-react
   * - userInput: 读取当前轮播单明细后决定压缩动作
   * - expectedDecision: read_only_analysis 返回当前正式节目ID、时段和时长供下一轮 LLM 决策
   * - mustNotHappen: action 合法但端口缺失；只返回数量不返回可定位节目；触发 commit
   * - verification: observation 包含 canonical 现场明细且 noMutation=true
   */
  it('post9-rotation-compression-staged-react: exposes current playlist details through read-only analysis', async () => {
    const context = createContext()
    context.scheduleItems = [{
      id: canonicalTrendingCandidate.id,
      programId: canonicalTrendingCandidate.programId,
      programCode: canonicalTrendingCandidate.programCode,
      programName: canonicalTrendingCandidate.programName,
      startTime: '2026-07-18T00:00:00',
      endTime: '2026-07-18T00:30:00',
      duration: canonicalTrendingCandidate.duration,
      programType: canonicalTrendingCandidate.programType,
      sequence: 1,
    }] as any
    const commitScheduleItems = vi.fn()
    const ports = createFormalOrchestrationReadPorts({
      workspaceKey: 'rotation:rotation-compression',
      dataGateway: { loadContext: vi.fn(async () => context as any), commitScheduleItems },
      baseInput: { userInput: '读取当前轮播单明细', channelId: 'rotation', date: '2026-07-18', playlistId: 'rotation-compression' },
    })

    const result = await ports.readOnlyAnalysis!(
      { type: 'read_only_analysis', analysisKind: 'playlist_analysis' },
      { workspaceKey: 'rotation:rotation-compression', runId: 'post9-compression', turn: 2 },
    )

    expect(result).toMatchObject({ workspaceKey: 'rotation:rotation-compression', noMutation: true, mutationPolicy: 'preview_only' })
    expect(result.data?.scheduleItems).toEqual([
      expect.objectContaining({ id: canonicalTrendingCandidate.id, startTime: '2026-07-18T00:00:00', duration: 1800 }),
    ])
    expect(commitScheduleItems).not.toHaveBeenCalled()
  })

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
