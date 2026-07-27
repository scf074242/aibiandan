/**
 * 节目检索通用多次关键词组合重试机制 - 集成测试
 *
 * 覆盖阶段 4（主链路接入）+ 阶段 7（SSE 流式进度）的 6 个 case：
 * 1. 错别字修复策略端到端：看东房 → typo_fix → 看东方
 * 2. 栏目降级策略端到端：东方日报第10期 → column_demote → 东方快报
 * 3. 全 0 命中失败暴露：不存在的栏目XYZ → all_strategies_exhausted → needs_clarification
 * 4. 顺播硬约束不被重试破坏：历史基线 110 → 期望 111 → 不选 112/113
 * 5. SSE trace 含策略标签：查节目库-重试N（策略标签）
 * 6. SSE 一条条信息流式展示：开始气泡与完成气泡是独立事件
 *
 * 设计约束（AGENTS.md LLM-first / 本地只保护 / 暴露失败）：
 * - keywordStrategies 全部由测试 interpretation 直接注入（模拟 LLM 意图解析输出）
 * - 不 mock executeRetryLoop，走真实主链路 resolveCandidatePool → executeRetryLoop
 * - 通过 onTraceStep 捕获 SSE 事件，验证流式进度与策略标签
 * - 失败场景验证 searchRetryPlan 透传到 program_not_found issue.detail
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { InMemorySchedulingDataGateway } from '@/services/agent/inMemorySchedulingDataGateway'
import { SchedulingAgentRuntime } from '@/services/agent/schedulingAgentRuntime'
import { candidateSearchRetryMockCandidates } from '@/mock/candidateSearchRetryMock'
import type {
  AgentCandidateDecision,
  AgentCandidateJudge,
  AgentCandidateJudgeInput,
  AgentProgramCandidate,
  AgentTraceStep,
} from '@/services/agent/types'
import type { PlaylistType, ScheduleItemSnapshot, ScheduleSummary } from '@/types/orchestration'

const date = '2026-03-25'
const historyDate = '2026-03-24'
const channelId = 'dragon'

/**
 * 构造测试用调度条目快照
 */
const buildScheduleItem = (patch: Partial<ScheduleItemSnapshot> = {}): ScheduleItemSnapshot => ({
  id: 'item-base',
  programCode: 'P_BASE',
  programName: '占位节目',
  startTime: '09:00:00',
  endTime: '09:30:00',
  duration: 1800,
  programType: 'news',
  sequence: 1,
  ...patch,
})

/**
 * 构造顺播连续剧候选（drama 类型 + 第N集，确保 hasExplicitSequenceEvidence 返回 true）
 *
 * 与 typoFixMockCandidates 的区别：programType='drama' 且 instanceName 用"第N集"（不是"第N期"），
 * 使 tvSequenceSelector 能识别顺播证据并强制 next=max+1 硬约束。
 */
const buildSequentialCandidate = (issueNo: string): AgentProgramCandidate => ({
  id: `seq-look-east-${issueNo}`,
  programId: 'P_SEQ_LOOK_EAST',
  programCode: `SEQ_LOOK_EAST_${issueNo}`,
  programName: '看东方',
  channelId: 'dragon',
  columnId: 'seq-column-look-east',
  columnName: '看东方',
  duration: 1800,
  programType: 'drama',
  issueNo,
  instanceName: `看东方 第${issueNo}集`,
  contentTags: ['看东方', '连续剧'],
  materialStatus: 'ready',
  rightsStatus: 'ready',
})

/**
 * 构造 mock candidateJudge：直接返回预设决策，避免真实 LLM 调用
 */
const buildMockCandidateJudge = (decision: AgentCandidateDecision): AgentCandidateJudge => ({
  selectBestCandidate: vi.fn(async (_input: AgentCandidateJudgeInput): Promise<AgentCandidateDecision> => decision),
})

/**
 * 构造 runtime + dataGateway + traceSteps 捕获器
 */
const buildTestEnvironment = (options: {
  scheduleItems?: ScheduleItemSnapshot[]
  programCandidates?: AgentProgramCandidate[]
  historyItems?: ScheduleItemSnapshot[]
  candidateJudge?: AgentCandidateJudge
  playlistType?: PlaylistType
}) => {
  const traceSteps: AgentTraceStep[] = []
  const historySchedules: ScheduleSummary[] | undefined = options.historyItems?.length
    ? [{
        date: historyDate,
        itemCount: options.historyItems.length,
        programTypes: options.historyItems.reduce((acc, item) => {
          acc[item.programType] = (acc[item.programType] ?? 0) + 1
          return acc
        }, {} as Record<string, number>),
        items: options.historyItems,
      }]
    : undefined
  const dataGateway = new InMemorySchedulingDataGateway([{
    channelId,
    date,
    playlistType: options.playlistType ?? 'tv',
    scheduleItems: options.scheduleItems ?? [],
    programCandidates: options.programCandidates ?? candidateSearchRetryMockCandidates,
    historySchedules,
    layoutBounds: { start: '06:00:00', end: '23:59:59' },
  }])
  const runtime = new SchedulingAgentRuntime({
    dataGateway,
    candidateJudge: options.candidateJudge,
    onTraceStep: (step) => {
      traceSteps.push({ ...step, detail: step.detail ? { ...step.detail } : undefined })
    },
  })
  return { dataGateway, runtime, traceSteps }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('节目检索重试机制 - 主链路集成（阶段 4）', () => {
  /**
   * Case 1: 错别字修复策略端到端
   *
   * 场景：用户输入"看东房"（错别字，房→方），LLM 生成 typo_fix 策略"看东方"后命中多期。
   * 验证：
   * - original 策略"看东房"0 命中
   * - typo_fix 策略"看东方"命中 3 期
   * - 最终状态为 executed
   * - trace 包含"查节目库-重试"且 strategyLabel='typo_fix'
   */
  it('Case 1: 错别字修复策略端到端 - 看东房 → typo_fix → 看东方', async () => {
    const candidates = candidateSearchRetryMockCandidates.filter(
      (c) => c.programId === 'P_RETRY_LOOK_EAST',
    )
    const mockJudge = buildMockCandidateJudge({
      candidate: candidates[0]!,
      reasoning: '选择看东方第111期作为起始',
      decisionType: 'auto_select',
    })
    const { runtime, traceSteps } = buildTestEnvironment({
      programCandidates: candidates,
      candidateJudge: mockJudge,
    })

    const result = await runtime.submit({
      userInput: '10点插入看东房',
      channelId,
      date,
      interpretation: {
        intent: 'insert',
        confidence: 0.95,
        source: 'test',
        slots: { targetTime: '10:00:00', programHint: '看东房' },
        keywordStrategies: [
          { strategy: 'original', keywords: ['看东房'], reason: '用户原词' },
          { strategy: 'typo_fix', keywords: ['看东方'], reason: '房→方，常见错别字修复' },
        ],
      },
    })

    expect(result.status).toBe('executed')
    expect(result.decision.command).toMatchObject({
      intent: 'insert',
      candidateId: 'retry-typofix-look-east-111',
    })

    const retryStartStep = traceSteps.find(
      (step) => step.status === 'planning' && step.label === '查节目库-重试',
    )
    expect(retryStartStep).toBeDefined()
    expect(retryStartStep?.detail?.strategyLabel).toBe('typo_fix')
    expect(retryStartStep?.detail?.round).toBe(1)

    const retryCompleteStep = traceSteps.find(
      (step) => step.status === 'planning'
        && step.label === '候选查询完成'
        && step.detail?.strategyLabel === 'typo_fix',
    )
    expect(retryCompleteStep).toBeDefined()
    expect(retryCompleteStep?.detail?.candidateCount).toBe(3)
  })

  /**
   * Case 2: 栏目降级策略端到端
   *
   * 场景：用户输入"东方日报第10期"（节目名不匹配），LLM 生成 column_demote 策略"东方快报"后命中 9 期。
   * original 策略"东方日报第10期"不包含任何候选节目名，故 0 命中。
   * column_demote 策略"东方快报"命中 9 期（第1-9期，无第10期）。
   * 验证：
   * - original 策略 0 命中
   * - column_demote 策略命中 9 期
   * - trace 包含"查节目库-重试"且 strategyLabel='column_demote'
   */
  it('Case 2: 栏目降级策略端到端 - 东方日报第10期 → column_demote → 东方快报', async () => {
    const candidates = candidateSearchRetryMockCandidates.filter(
      (c) => c.programId === 'P_RETRY_EAST_EXPRESS',
    )
    expect(candidates.length).toBe(9)
    const mockJudge = buildMockCandidateJudge({
      candidate: candidates[0]!,
      reasoning: '选择东方快报第1期',
      decisionType: 'auto_select',
    })
    const { runtime, traceSteps } = buildTestEnvironment({
      programCandidates: candidates,
      candidateJudge: mockJudge,
    })

    const result = await runtime.submit({
      userInput: '10点插入东方日报第10期',
      channelId,
      date,
      interpretation: {
        intent: 'insert',
        confidence: 0.95,
        source: 'test',
        slots: { targetTime: '10:00:00', programHint: '东方日报第10期' },
        keywordStrategies: [
          { strategy: 'original', keywords: ['东方日报第10期'], reason: '用户原词' },
          { strategy: 'column_demote', keywords: ['东方快报'], reason: '栏目降级：东方日报→东方快报' },
        ],
      },
    })

    expect(result.status).toBe('executed')
    expect(result.decision.command).toMatchObject({
      intent: 'insert',
      candidateId: 'retry-columndemote-east-express-001',
    })

    const retryStartStep = traceSteps.find(
      (step) => step.status === 'planning' && step.label === '查节目库-重试',
    )
    expect(retryStartStep).toBeDefined()
    expect(retryStartStep?.detail?.strategyLabel).toBe('column_demote')

    const retryCompleteStep = traceSteps.find(
      (step) => step.status === 'planning'
        && step.label === '候选查询完成'
        && step.detail?.strategyLabel === 'column_demote',
    )
    expect(retryCompleteStep).toBeDefined()
    expect(retryCompleteStep?.detail?.candidateCount).toBe(9)
  })

  /**
   * Case 3: 全 0 命中失败暴露
   *
   * 场景：用户输入"完全不存在的栏目XYZ"，所有策略都 0 命中。
   * 验证：
   * - 状态为 needs_clarification（不本地兜底硬排）
   * - issue code='program_not_found'
   * - issue detail.searchRetryPlan.terminationReason='all_strategies_exhausted'
   * - issue detail.searchRetryPlan.nextAction='needs_clarification'
   * - issue detail.searchRetryPlan.triggeredSecondaryReflection=false
   * - trace 包含"候选检索终止"
   */
  it('Case 3: 全 0 命中失败暴露 - all_strategies_exhausted → needs_clarification', async () => {
    const { runtime, traceSteps } = buildTestEnvironment({
      programCandidates: candidateSearchRetryMockCandidates,
    })

    const result = await runtime.submit({
      userInput: '10点插入完全不存在的栏目XYZ',
      channelId,
      date,
      interpretation: {
        intent: 'insert',
        confidence: 0.95,
        source: 'test',
        slots: { targetTime: '10:00:00', programHint: '完全不存在的栏目XYZ' },
        keywordStrategies: [
          { strategy: 'original', keywords: ['完全不存在的栏目XYZ'], reason: '用户原词' },
          { strategy: 'broaden', keywords: ['栏目XYZ'], reason: '放宽检索：去掉限定词' },
        ],
      },
    })

    expect(result.status).toBe('needs_clarification')
    expect(result.decision.constraintReport?.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'program_not_found',
          severity: 'critical',
        }),
      ]),
    )

    const issue = result.decision.constraintReport?.issues?.find(
      (item) => item.code === 'program_not_found',
    )
    expect(issue).toBeDefined()
    const searchRetryPlan = issue?.detail as Record<string, unknown>
    expect(searchRetryPlan.terminationReason).toBe('all_strategies_exhausted')
    expect(searchRetryPlan.nextAction).toBe('needs_clarification')
    expect(searchRetryPlan.triggeredSecondaryReflection).toBe(false)
    expect(Array.isArray(searchRetryPlan.searchAttempts)).toBe(true)
    expect((searchRetryPlan.searchAttempts as Array<{ strategyLabel?: string }>).length).toBeGreaterThanOrEqual(2)
    expect((searchRetryPlan.searchAttempts as Array<{ strategyLabel?: string }>).every((a) => a.candidateCount === 0 || a.candidateCount === undefined)).toBe(true)

    const terminatedStep = traceSteps.find(
      (step) => step.status === 'planning' && step.label === '候选检索终止',
    )
    expect(terminatedStep).toBeDefined()
    expect(terminatedStep?.detail?.terminationReason).toBe('all_strategies_exhausted')
    expect(terminatedStep?.detail?.nextAction).toBe('needs_clarification')
  })

  /**
   * Case 4: 顺播硬约束不被重试破坏
   *
   * 场景：使用 drama 类型连续剧候选（看东方 第111/112/113集），历史基线为第110集。
   * 用户输入"看东方房"（错别字），typo_fix 策略"看东方"命中 3 期。
   * tvSequenceSelector 按历史基线 110 → 期望下一集 111，精确命中第111集。
   * 验证：
   * - 选中候选为第111集（不是112或113）
   * - 顺播硬约束 next=max+1 被强制执行
   * - 重试机制不破坏顺播约束
   */
  it('Case 4: 顺播硬约束不被重试破坏 - 历史基线 110 → 期望 111 → 不选 112/113', async () => {
    const sequentialCandidates = [
      buildSequentialCandidate('111'),
      buildSequentialCandidate('112'),
      buildSequentialCandidate('113'),
    ]
    const historyItems = [
      buildScheduleItem({
        id: 'history-seq-look-east-110',
        programCode: 'SEQ_LOOK_EAST_110',
        programName: '看东方',
        programId: 'P_SEQ_LOOK_EAST',
        instanceName: '看东方 第110集',
        issueNo: '110',
        startTime: '10:00:00',
        endTime: '10:30:00',
        duration: 1800,
        programType: 'drama',
        sequence: 110,
      }),
    ]
    const mockJudge = buildMockCandidateJudge({
      candidate: sequentialCandidates[1]!,
      reasoning: '错误选择第112集（应被顺播约束拒绝）',
      decisionType: 'auto_select',
    })
    const { runtime } = buildTestEnvironment({
      programCandidates: sequentialCandidates,
      historyItems,
      candidateJudge: mockJudge,
    })

    const result = await runtime.submit({
      userInput: '10点插入看东方房',
      channelId,
      date,
      interpretation: {
        intent: 'insert',
        confidence: 0.95,
        source: 'test',
        slots: { targetTime: '10:00:00', programHint: '看东方房' },
        keywordStrategies: [
          { strategy: 'original', keywords: ['看东方房'], reason: '用户原词' },
          { strategy: 'typo_fix', keywords: ['看东方'], reason: '房→方，错别字修复' },
        ],
      },
    })

    expect(result.status).toBe('executed')
    expect(result.decision.command).toMatchObject({
      intent: 'insert',
      candidateId: 'seq-look-east-111',
    })
    expect(result.decision.candidateSelection).toMatchObject({
      method: 'tv_sequence',
      source: 'history',
      expectedSequence: 111,
      selectedSequence: 111,
    })
  })
})

describe('节目检索重试机制 - SSE 流式进度（阶段 7）', () => {
  /**
   * Case 5: SSE trace 含策略标签
   *
   * 场景：与 Case 1 相同的错别字修复流程。
   * 验证 trace 步骤含策略标签：
   * - "查节目库-重试" step 的 detail.strategyLabel='typo_fix'
   * - "候选查询完成" step 的 detail.strategyLabel='typo_fix'
   * - "查节目库-重试" step 的 detail.round=1（首轮 round=0 跳过）
   */
  it('Case 5: SSE trace 含策略标签 - 查节目库-重试N（策略标签）', async () => {
    const candidates = candidateSearchRetryMockCandidates.filter(
      (c) => c.programId === 'P_RETRY_LOOK_EAST',
    )
    const mockJudge = buildMockCandidateJudge({
      candidate: candidates[0]!,
      reasoning: '选择看东方第111期',
      decisionType: 'auto_select',
    })
    const { runtime, traceSteps } = buildTestEnvironment({
      programCandidates: candidates,
      candidateJudge: mockJudge,
    })

    await runtime.submit({
      userInput: '10点插入看东房',
      channelId,
      date,
      interpretation: {
        intent: 'insert',
        confidence: 0.95,
        source: 'test',
        slots: { targetTime: '10:00:00', programHint: '看东房' },
        keywordStrategies: [
          { strategy: 'original', keywords: ['看东房'], reason: '用户原词' },
          { strategy: 'typo_fix', keywords: ['看东方'], reason: '房→方，错别字修复' },
        ],
      },
    })

    const retryStartSteps = traceSteps.filter(
      (step) => step.status === 'planning' && step.label === '查节目库-重试',
    )
    expect(retryStartSteps.length).toBeGreaterThanOrEqual(1)
    const typoFixStart = retryStartSteps.find(
      (step) => step.detail?.strategyLabel === 'typo_fix',
    )
    expect(typoFixStart).toBeDefined()
    expect(typoFixStart?.detail?.round).toBe(1)
    expect(typoFixStart?.detail?.keyword).toBe('看东方')
    expect(typoFixStart?.detail?.strategyReason).toBe('房→方，错别字修复')

    const retryCompleteSteps = traceSteps.filter(
      (step) => step.status === 'planning' && step.label === '候选查询完成',
    )
    const typoFixComplete = retryCompleteSteps.find(
      (step) => step.detail?.strategyLabel === 'typo_fix',
    )
    expect(typoFixComplete).toBeDefined()
    expect(typoFixComplete?.detail?.candidateCount).toBe(3)
    expect(Array.isArray(typoFixComplete?.detail?.candidateIds)).toBe(true)
  })

  /**
   * Case 6: SSE 一条条信息流式展示
   *
   * 场景：与 Case 1 相同的错别字修复流程。
   * 验证"开始气泡"与"完成气泡"是独立 SSE 事件：
   * - "查节目库-重试"（开始气泡）与"候选查询完成"（完成气泡）是不同的 trace step
   * - 开始气泡的 sequence < 完成气泡的 sequence（顺序正确）
   * - 开始气泡的 candidateCount=0（查询未完成时推送）
   * - 完成气泡的 candidateCount>0（查询完成后推送）
   * - 两者之间有真实 await 等待时间（executeRetryLoop 内部 await queryFn）
   */
  it('Case 6: SSE 一条条信息流式展示 - 开始气泡与完成气泡是独立事件', async () => {
    const candidates = candidateSearchRetryMockCandidates.filter(
      (c) => c.programId === 'P_RETRY_LOOK_EAST',
    )
    const mockJudge = buildMockCandidateJudge({
      candidate: candidates[0]!,
      reasoning: '选择看东方第111期',
      decisionType: 'auto_select',
    })
    const { runtime, traceSteps } = buildTestEnvironment({
      programCandidates: candidates,
      candidateJudge: mockJudge,
    })

    await runtime.submit({
      userInput: '10点插入看东房',
      channelId,
      date,
      interpretation: {
        intent: 'insert',
        confidence: 0.95,
        source: 'test',
        slots: { targetTime: '10:00:00', programHint: '看东房' },
        keywordStrategies: [
          { strategy: 'original', keywords: ['看东房'], reason: '用户原词' },
          { strategy: 'typo_fix', keywords: ['看东方'], reason: '房→方，错别字修复' },
        ],
      },
    })

    const startStep = traceSteps.find(
      (step) => step.status === 'planning' && step.label === '查节目库-重试',
    )
    const completeStep = traceSteps.find(
      (step) => step.status === 'planning'
        && step.label === '候选查询完成'
        && step.detail?.strategyLabel === 'typo_fix',
    )
    expect(startStep).toBeDefined()
    expect(completeStep).toBeDefined()

    expect(typeof startStep?.sequence).toBe('number')
    expect(typeof completeStep?.sequence).toBe('number')
    expect(startStep!.sequence!).toBeLessThan(completeStep!.sequence!)

    expect(startStep?.detail?.candidateCount).toBe(0)
    expect(completeStep?.detail?.candidateCount).toBe(3)

    expect(typeof startStep?.elapsedMs).toBe('number')
    expect(typeof completeStep?.elapsedMs).toBe('number')
    expect(completeStep!.elapsedMs!).toBeGreaterThanOrEqual(startStep!.elapsedMs!)

    expect(typeof startStep?.timestamp).toBe('string')
    expect(typeof completeStep?.timestamp).toBe('string')
    expect(completeStep!.timestamp >= startStep!.timestamp).toBe(true)
  })
})
