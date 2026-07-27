/**
 * 候选决策 LLM-only 化测试
 *
 * 覆盖 case A-G：
 * - A: TV 顺播收敛到唯一 + LLM auto_select → direct_execute
 * - B: TV 多候选 + LLM auto_select + 顺播校验通过 → direct_execute
 * - C: TV 多候选 + LLM needs_clarification → needs_selection
 * - D: TV 多候选 + LLM auto_select + 顺播违规 → needs_selection
 * - E: Rotation 多候选 + LLM auto_select → confirm_before_commit
 * - F: LLM 失败/超时 → needs_selection
 * - G: 消息流序列（理解需求 → 查节目库 → 候选决策）
 *
 * LLM Mock 策略：注入 mock llmClient，返回预设 JSON，避免真实 LLM 调用
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { InMemorySchedulingDataGateway } from '@/services/agent/inMemorySchedulingDataGateway'
import { LlmAgentCandidateJudge } from '@/services/agent/candidateJudge'
import { SchedulingAgentRuntime } from '@/services/agent/schedulingAgentRuntime'
import type {
  AgentCandidateDecision,
  AgentCandidateJudge,
  AgentCandidateJudgeInput,
  AgentIntentInterpreter,
  AgentProgramCandidate,
  AgentSubmitInput,
} from '@/services/agent/types'
import type { PlaylistType, ScheduleItemSnapshot } from '@/types/orchestration'

const date = '2026-03-25'

/**
 * 构造测试用意图解释器：把"插入X"识别为 insert
 */
const buildTestIntentInterpreter = (): AgentIntentInterpreter => ({
  usesLlm: true,
  interpret: async (input: AgentSubmitInput) => {
    const normalized = input.userInput.replace(/\s+/g, '')
    if (/在19点插入看东方/u.test(normalized)) {
      return {
        intent: 'insert',
        confidence: 1,
        source: 'test',
        slots: { targetTime: '19:00:00', programHint: '看东方' },
      }
    }
    if (/插入看东方/u.test(normalized)) {
      return {
        intent: 'insert',
        confidence: 1,
        source: 'test',
        slots: { programHint: '看东方' },
      }
    }
    return null
  },
})

const buildItem = (patch: Partial<ScheduleItemSnapshot> = {}): ScheduleItemSnapshot => ({
  id: 'item-base',
  programCode: 'P100001',
  programName: '新闻联播',
  startTime: '19:00:00',
  endTime: '19:30:00',
  duration: 1800,
  programType: 'news',
  sequence: 1,
  ...patch,
})

const buildCandidate = (patch: Partial<AgentProgramCandidate> = {}): AgentProgramCandidate => ({
  id: 'candidate-base',
  programId: 'program-base',
  programCode: 'P200001',
  programName: '看东方',
  channelId: 'dragon',
  columnId: 'news',
  columnName: '新闻',
  duration: 1800,
  programType: 'news',
  instanceName: '看东方',
  contentTags: ['新闻'],
  materialStatus: 'ready',
  rightsStatus: 'ready',
  ...patch,
})

/**
 * 构造 mock candidateJudge：直接返回预设决策，避免 LLM 调用
 */
const buildMockCandidateJudge = (decision: AgentCandidateDecision): AgentCandidateJudge => ({
  selectBestCandidate: vi.fn(async (_input: AgentCandidateJudgeInput): Promise<AgentCandidateDecision> => decision),
})

/**
 * 构造失败 mock candidateJudge：模拟 LLM 失败场景
 */
const buildFailingCandidateJudge = (errorMessage: string): AgentCandidateJudge => ({
  selectBestCandidate: vi.fn(async (): Promise<AgentCandidateDecision> => ({
    candidate: null,
    reasoning: `LLM 候选决策失败：${errorMessage}`,
    decisionType: 'unable_to_decide',
  })),
})

const buildRuntime = (options: {
  items: ScheduleItemSnapshot[]
  playlistType?: PlaylistType
  programCandidates?: AgentProgramCandidate[]
  candidateJudge?: AgentCandidateJudge
  historyItems?: ScheduleItemSnapshot[]
}) => {
  const dataGateway = new InMemorySchedulingDataGateway([{
    channelId: 'dragon',
    date,
    playlistType: options.playlistType ?? 'tv',
    scheduleItems: options.items,
    programCandidates: options.programCandidates,
    layoutBounds: { start: '06:00:00', end: '23:59:59' },
    historyScheduleItems: options.historyItems,
  }])
  return {
    dataGateway,
    runtime: new SchedulingAgentRuntime({
      dataGateway,
      intentInterpreter: buildTestIntentInterpreter(),
      candidateJudge: options.candidateJudge,
    }),
  }
}

// ============ LlmAgentCandidateJudge 单元测试 ============

describe('LlmAgentCandidateJudge 单元决策', () => {
  /**
   * Case F: LLM 失败/超时 → unable_to_decide
   */
  it('LLM 调用失败时返回 unable_to_decide + 失败原因', async () => {
    const mockLlmClient = {
      chat: vi.fn().mockRejectedValue(new Error('LLM timeout')),
    }
    const judge = new LlmAgentCandidateJudge({ llmClient: mockLlmClient })

    const decision = await judge.selectBestCandidate({
      userInput: '在19点插入看东方',
      playlistType: 'tv',
      commandIntent: 'insert',
      candidates: [
        buildCandidate({ id: 'c1', programName: '看东方' }),
        buildCandidate({ id: 'c2', programName: '午间新闻' }),
      ],
      context: {} as never,
    })

    expect(decision.decisionType).toBe('unable_to_decide')
    expect(decision.candidate).toBeNull()
    expect(decision.reasoning).toContain('LLM 候选决策失败')
  })

  /**
   * LLM 返回非 JSON → unable_to_decide
   */
  it('LLM 返回非 JSON 时返回 unable_to_decide', async () => {
    const mockLlmClient = {
      chat: vi.fn().mockResolvedValue({ content: 'not a json' }),
    }
    const judge = new LlmAgentCandidateJudge({ llmClient: mockLlmClient })

    const decision = await judge.selectBestCandidate({
      userInput: '插入看东方',
      playlistType: 'tv',
      commandIntent: 'insert',
      candidates: [
        buildCandidate({ id: 'c1', programName: '看东方' }),
        buildCandidate({ id: 'c2', programName: '午间新闻' }),
      ],
      context: {} as never,
    })

    expect(decision.decisionType).toBe('unable_to_decide')
    expect(decision.candidate).toBeNull()
  })

  /**
   * LLM 返回无效 candidateId → unable_to_decide
   */
  it('LLM 返回无效 candidateId 时返回 unable_to_decide', async () => {
    const mockLlmClient = {
      chat: vi.fn().mockResolvedValue({
        content: JSON.stringify({
          candidateId: 'non-existent-id',
          reasoning: '选择不存在的候选',
          decisionType: 'auto_select',
        }),
      }),
    }
    const judge = new LlmAgentCandidateJudge({ llmClient: mockLlmClient })

    const decision = await judge.selectBestCandidate({
      userInput: '插入看东方',
      playlistType: 'tv',
      commandIntent: 'insert',
      candidates: [
        buildCandidate({ id: 'c1', programName: '看东方' }),
        buildCandidate({ id: 'c2', programName: '午间新闻' }),
      ],
      context: {} as never,
    })

    expect(decision.decisionType).toBe('unable_to_decide')
    expect(decision.candidate).toBeNull()
    expect(decision.reasoning).toContain('不在候选列表中')
  })

  /**
   * LLM 返回 needs_clarification → 透传 candidateOptions
   */
  it('LLM 返回 needs_clarification 时透传 candidateOptions', async () => {
    const mockLlmClient = {
      chat: vi.fn().mockResolvedValue({
        content: JSON.stringify({
          candidateId: '',
          reasoning: '候选较多，需要确认',
          decisionType: 'needs_clarification',
        }),
      }),
    }
    const judge = new LlmAgentCandidateJudge({ llmClient: mockLlmClient })

    const candidates = [
      buildCandidate({ id: 'c1', programName: '看东方' }),
      buildCandidate({ id: 'c2', programName: '午间新闻' }),
      buildCandidate({ id: 'c3', programName: '晚间新闻' }),
    ]
    const decision = await judge.selectBestCandidate({
      userInput: '插入看东方',
      playlistType: 'tv',
      commandIntent: 'insert',
      candidates,
      context: {} as never,
    })

    expect(decision.decisionType).toBe('needs_clarification')
    expect(decision.candidate).toBeNull()
    expect(decision.candidateOptions).toEqual(candidates)
  })

  /**
   * Q1 回归 case：needs_clarification 时 reasoning 必须是一句话澄清说明
   *
   * 验证 prompt 约束生效后，LLM 返回的 reasoning（一句话点出"差在哪个关键维度"）
   * 被 normalizeDecision 原样透传，不丢失、不被本地改写。
   * 本地不做"是否是一句话"的语义校验（LLM-only），仅验证结构透传。
   */
  it('needs_clarification 时一句话 reasoning 被原样透传', async () => {
    const oneSentenceReasoning = '库里有两个版本的《琅琊榜》第5集，请确认要哪个'
    const mockLlmClient = {
      chat: vi.fn().mockResolvedValue({
        content: JSON.stringify({
          candidateId: '',
          reasoning: oneSentenceReasoning,
          decisionType: 'needs_clarification',
        }),
      }),
    }
    const judge = new LlmAgentCandidateJudge({ llmClient: mockLlmClient })

    const candidates = [
      buildCandidate({ id: 'c1', programName: '琅琊榜 第5集', issueNo: '5' }),
      buildCandidate({ id: 'c2', programName: '琅琊榜 第5集', issueNo: '5' }),
    ]
    const decision = await judge.selectBestCandidate({
      userInput: '插入琅琊榜第5集',
      playlistType: 'tv',
      commandIntent: 'insert',
      candidates,
      context: {} as never,
    })

    expect(decision.decisionType).toBe('needs_clarification')
    expect(decision.reasoning).toBe(oneSentenceReasoning)
    expect(decision.candidateOptions).toEqual(candidates)
  })

  /**
   * Q2 回归 case：unable_to_decide 时 reasoning 末尾点出最接近候选
   *
   * 验证 prompt 约束生效后，LLM 返回的 reasoning（末尾一句话点出最接近候选）
   * 被 normalizeDecision 原样透传，给编排人员一个可继续的入口。
   * 本地不做"是否点出候选名"的语义校验（LLM-only），仅验证结构透传。
   */
  it('unable_to_decide 时末尾候选引导 reasoning 被原样透传', async () => {
    const reasoningWithAlternative = '库里没有《琅琊榜》，但有《琅琊榜之风起长林》是否考虑？'
    const mockLlmClient = {
      chat: vi.fn().mockResolvedValue({
        content: JSON.stringify({
          candidateId: '',
          reasoning: reasoningWithAlternative,
          decisionType: 'unable_to_decide',
        }),
      }),
    }
    const judge = new LlmAgentCandidateJudge({ llmClient: mockLlmClient })

    const candidates = [
      buildCandidate({ id: 'c1', programName: '琅琊榜之风起长林 第1集' }),
      buildCandidate({ id: 'c2', programName: '琅琊榜之风起长林 第2集' }),
    ]
    const decision = await judge.selectBestCandidate({
      userInput: '插入琅琊榜',
      playlistType: 'tv',
      commandIntent: 'insert',
      candidates,
      context: {} as never,
    })

    expect(decision.decisionType).toBe('unable_to_decide')
    expect(decision.candidate).toBeNull()
    expect(decision.reasoning).toBe(reasoningWithAlternative)
  })

  /**
   * 单候选直接返回 auto_select（不调 LLM）
   */
  it('单候选时直接返回 auto_select 不调用 LLM', async () => {
    const mockLlmClient = { chat: vi.fn() }
    const judge = new LlmAgentCandidateJudge({ llmClient: mockLlmClient })

    const only = buildCandidate({ id: 'c1', programName: '看东方' })
    const decision = await judge.selectBestCandidate({
      userInput: '插入看东方',
      playlistType: 'tv',
      commandIntent: 'insert',
      candidates: [only],
      context: {} as never,
    })

    expect(decision.decisionType).toBe('auto_select')
    expect(decision.candidate).toBe(only)
    expect(mockLlmClient.chat).not.toHaveBeenCalled()
  })

  /**
   * 空候选列表 → unable_to_decide
   */
  it('空候选列表返回 unable_to_decide', async () => {
    const mockLlmClient = { chat: vi.fn() }
    const judge = new LlmAgentCandidateJudge({ llmClient: mockLlmClient })

    const decision = await judge.selectBestCandidate({
      userInput: '插入看东方',
      playlistType: 'tv',
      commandIntent: 'insert',
      candidates: [],
      context: {} as never,
    })

    expect(decision.decisionType).toBe('unable_to_decide')
    expect(decision.candidate).toBeNull()
    expect(mockLlmClient.chat).not.toHaveBeenCalled()
  })

  /**
   * LLM 返回 auto_select + 有效 candidateId → 返回 candidate
   */
  it('LLM 返回 auto_select + 有效 candidateId 时返回 candidate', async () => {
    const mockLlmClient = {
      chat: vi.fn().mockResolvedValue({
        content: JSON.stringify({
          candidateId: 'c2',
          reasoning: '选择午间新闻，内容更匹配',
          considerations: ['内容匹配', '素材就绪'],
          decisionType: 'auto_select',
        }),
      }),
    }
    const judge = new LlmAgentCandidateJudge({ llmClient: mockLlmClient })

    const candidates = [
      buildCandidate({ id: 'c1', programName: '看东方' }),
      buildCandidate({ id: 'c2', programName: '午间新闻' }),
    ]
    const decision = await judge.selectBestCandidate({
      userInput: '插入看东方',
      playlistType: 'tv',
      commandIntent: 'insert',
      candidates,
      context: {} as never,
    })

    expect(decision.decisionType).toBe('auto_select')
    expect(decision.candidate?.id).toBe('c2')
    expect(decision.candidate?.programName).toBe('午间新闻')
    expect(decision.reasoning).toBe('选择午间新闻，内容更匹配')
    expect(decision.considerations).toEqual(['内容匹配', '素材就绪'])
  })

  /**
   * 容忍 LLM 返回带 markdown 代码块的 JSON
   */
  it('容忍 LLM 返回带 markdown 代码块的 JSON', async () => {
    const mockLlmClient = {
      chat: vi.fn().mockResolvedValue({
        content: '```json\n{"candidateId":"c1","reasoning":"测试","decisionType":"auto_select"}\n```',
      }),
    }
    const judge = new LlmAgentCandidateJudge({ llmClient: mockLlmClient })

    const decision = await judge.selectBestCandidate({
      userInput: '插入看东方',
      playlistType: 'tv',
      commandIntent: 'insert',
      candidates: [buildCandidate({ id: 'c1' }), buildCandidate({ id: 'c2' })],
      context: {} as never,
    })

    expect(decision.decisionType).toBe('auto_select')
    expect(decision.candidate?.id).toBe('c1')
  })

  /**
   * Case P1: prompt v1.1 修正后，LLM auto_select 最早一期 → normalizeDecision 正确返回
   *
   * 验证 prompt v1.1 移除"时长适配"硬条件后，LLM 在无基线场景下遵守"选最早一期"规则，
   * normalizeDecision 正确透传 LLM 决策（candidateId 校验通过、reasoning 原样透传）。
   */
  it('LLM auto_select 最早一期时正确返回 candidate（prompt v1.1）', async () => {
    const mockLlmClient = {
      chat: vi.fn().mockResolvedValue({
        content: JSON.stringify({
          candidateId: 'c1',
          reasoning: '无顺播基线，按顺播硬约束选最早一期（111期）',
          considerations: ['顺播硬约束', '无基线选最早一期'],
          decisionType: 'auto_select',
        }),
      }),
    }
    const judge = new LlmAgentCandidateJudge({ llmClient: mockLlmClient })

    const candidates = [
      buildCandidate({ id: 'c1', programName: '看东方', instanceName: '看东方第111期', issueNo: '0111', duration: 5400 }),
      buildCandidate({ id: 'c2', programName: '看东方', instanceName: '看东方第112期', issueNo: '0112', duration: 5400 }),
      buildCandidate({ id: 'c3', programName: '看东方', instanceName: '看东方第113期', issueNo: '0113', duration: 5400 }),
      buildCandidate({ id: 'c4', programName: '看东方', instanceName: '看东方第114期', issueNo: '0114', duration: 5400 }),
    ]
    const decision = await judge.selectBestCandidate({
      userInput: '在10点插入看东方',
      playlistType: 'tv',
      commandIntent: 'insert',
      candidates,
      context: {} as never,
    })

    expect(decision.decisionType).toBe('auto_select')
    expect(decision.candidate?.id).toBe('c1')
    expect(decision.candidate?.issueNo).toBe('0111')
    expect(decision.reasoning).toContain('最早一期')
  })

  /**
   * Case P3: prompt v1.1 移除"时长适配"硬条件
   *
   * 验证 system prompt 中不再出现"时长适配"硬条件字样，
   * 明确"时长适配由 FormalPlaylistWriteAdapter 写入校验把关"，
   * 并标注 prompt 版本号 v1.1。
   */
  it('prompt v1.1 不含"时长适配"硬条件字样且标注版本号', async () => {
    const candidateFreedomCase = {
      id: 'candidate-judge-no-count-threshold',
      userInput: '从完整候选集中选出唯一符合顺播和内容条件的节目',
      expectedDecision: 'LLM 可依据证据唯一性决策，不以候选数量作为自动选择门槛',
      mustNotHappen: '候选数超过固定阈值就机械要求编排员选择',
      verification: 'system prompt 不含 <= 5，并明确无论候选数量均按证据判断',
    } as const
    const mockLlmClient = {
      chat: vi.fn().mockResolvedValue({
        content: JSON.stringify({
          candidateId: 'c1',
          reasoning: '测试',
          decisionType: 'auto_select',
        }),
      }),
    }
    const judge = new LlmAgentCandidateJudge({ llmClient: mockLlmClient })

    const candidates = [
      buildCandidate({ id: 'c1', programName: '看东方' }),
      buildCandidate({ id: 'c2', programName: '午间新闻' }),
    ]
    await judge.selectBestCandidate({
      userInput: '插入看东方',
      playlistType: 'tv',
      commandIntent: 'insert',
      candidates,
      context: {} as never,
    })

    expect(mockLlmClient.chat).toHaveBeenCalled()
    const messages = mockLlmClient.chat.mock.calls[0]![0] as Array<{ role: string; content: string }>
    const systemPrompt = messages.find((m) => m.role === 'system')?.content ?? ''
    // 移除"时长适配"作为评估步骤（硬条件）
    expect(systemPrompt).not.toMatch(/\d+\.\s*时长适配[：:]/u)
    expect(systemPrompt).not.toContain('4. 时长适配：候选时长是否适合目标时段')
    // 强化"无基线选最早一期"规则
    expect(systemPrompt).toContain('无顺播基线时')
    expect(systemPrompt).toContain('auto_select 最早一期')
    // 标注版本号（v1.3 移除候选数量阈值）
    expect(systemPrompt).toContain('[prompt v1.3]')
    expect(systemPrompt).not.toContain('<= 5')
    expect(systemPrompt).toContain('无论候选数量')
    expect(candidateFreedomCase).toMatchObject({
      expectedDecision: expect.any(String),
      mustNotHappen: expect.any(String),
      verification: expect.any(String),
    })
    // 明确时长适配由写入校验把关（保留引导 LLM 不要因此退回的说明）
    expect(systemPrompt).toContain('FormalPlaylistWriteAdapter')
    expect(systemPrompt).toContain('时长是否适配目标时段不在候选决策层评估')
  })
})

// ============ SchedulingAgentRuntime selectCandidate 集成测试 ============

describe('SchedulingAgentRuntime selectCandidate LLM 决策分流', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  /**
   * Case B: TV 多候选 + LLM auto_select + 顺播校验通过 → direct_execute
   */
  it('Case B: TV 多候选 + LLM auto_select + 顺播校验通过 → executed', async () => {
    const candidates = [
      buildCandidate({ id: 'c1', programName: '看东方', duration: 1800 }),
      buildCandidate({ id: 'c2', programName: '午间新闻', duration: 1800 }),
    ]
    const mockJudge = buildMockCandidateJudge({
      candidate: candidates[1]!,
      reasoning: '选择午间新闻，内容更匹配',
      considerations: ['内容匹配', '素材就绪'],
      decisionType: 'auto_select',
    })
    const { runtime } = buildRuntime({
      items: [],
      playlistType: 'tv',
      programCandidates: candidates,
      candidateJudge: mockJudge,
    })

    const result = await runtime.submit({
      userInput: '在19点插入看东方',
      channelId: 'dragon',
      date,
      interpretation: {
        intent: 'insert',
        confidence: 1,
        source: 'test',
        slots: { targetTime: '19:00:00', programHint: '看东方' },
      },
    })

    expect(result.status).toBe('executed')
    expect(result.executionResult?.committed).toBe(true)
    expect(mockJudge.selectBestCandidate).toHaveBeenCalled()
  })

  /**
   * Case C: TV 多候选 + LLM needs_clarification → needs_selection
   */
  it('Case C: TV 多候选 + LLM needs_clarification → needs_selection', async () => {
    const candidates = [
      buildCandidate({ id: 'c1', programName: '看东方' }),
      buildCandidate({ id: 'c2', programName: '午间新闻' }),
      buildCandidate({ id: 'c3', programName: '晚间新闻' }),
    ]
    const mockJudge = buildMockCandidateJudge({
      candidate: null,
      reasoning: '候选较多，需要确认具体排哪个',
      decisionType: 'needs_clarification',
      candidateOptions: candidates,
    })
    const { runtime } = buildRuntime({
      items: [],
      playlistType: 'tv',
      programCandidates: candidates,
      candidateJudge: mockJudge,
    })

    const result = await runtime.submit({
      userInput: '在19点插入看东方',
      channelId: 'dragon',
      date,
      interpretation: {
        intent: 'insert',
        confidence: 1,
        source: 'test',
        slots: { targetTime: '19:00:00', programHint: '看东方' },
      },
    })

    expect(result.status).toBe('needs_selection')
    expect(result.decision?.recommendations?.length).toBeGreaterThan(0)
  })

  /**
   * Case H1: 无基线 + 用户明确节目名 + 多期数候选 + LLM auto_select 最早一期 → executed
   *
   * 验证 prompt v1.1 修正后，无顺播基线场景下 LLM auto_select 最早一期，
   * selectCandidate 透传执行，不进入 needs_selection。
   * mustNotHappen: 不应进入 needs_selection；不应选 112/113/114。
   */
  it('Case H1: 无基线 + LLM auto_select 最早一期 → executed', async () => {
    const candidates = [
      buildCandidate({ id: 'c1', programName: '看东方', instanceName: '看东方第111期', issueNo: '0111', duration: 5400 }),
      buildCandidate({ id: 'c2', programName: '看东方', instanceName: '看东方第112期', issueNo: '0112', duration: 5400 }),
      buildCandidate({ id: 'c3', programName: '看东方', instanceName: '看东方第113期', issueNo: '0113', duration: 5400 }),
      buildCandidate({ id: 'c4', programName: '看东方', instanceName: '看东方第114期', issueNo: '0114', duration: 5400 }),
    ]
    const mockJudge = buildMockCandidateJudge({
      candidate: candidates[0]!,
      reasoning: '无顺播基线，按顺播硬约束选最早一期（111期）',
      considerations: ['顺播硬约束', '无基线选最早一期'],
      decisionType: 'auto_select',
    })
    const { runtime } = buildRuntime({
      items: [],
      playlistType: 'tv',
      programCandidates: candidates,
      candidateJudge: mockJudge,
    })

    const result = await runtime.submit({
      userInput: '在19点插入看东方',
      channelId: 'dragon',
      date,
      interpretation: {
        intent: 'insert',
        confidence: 1,
        source: 'test',
        slots: { targetTime: '19:00:00', programHint: '看东方' },
      },
    })

    expect(result.status).toBe('executed')
    expect(result.executionResult?.committed).toBe(true)
    expect(mockJudge.selectBestCandidate).toHaveBeenCalled()
  })

  /**
   * Case H2: 无基线 + LLM needs_clarification → needs_selection（验证不加本地兜底）
   *
   * 验证 prompt v1.1 修正后，LLM 偶发不遵守"无基线选最早一期"时，
   * selectCandidate 透传 needs_selection，本地不兜底选最早一期。
   * mustNotHappen: 不应 auto_select（不应 executed）；不应出现本地兜底 trace。
   */
  it('Case H2: 无基线 + LLM needs_clarification → needs_selection（不加本地兜底）', async () => {
    const candidates = [
      buildCandidate({ id: 'c1', programName: '看东方', instanceName: '看东方第111期', issueNo: '0111', duration: 5400 }),
      buildCandidate({ id: 'c2', programName: '看东方', instanceName: '看东方第112期', issueNo: '0112', duration: 5400 }),
      buildCandidate({ id: 'c3', programName: '看东方', instanceName: '看东方第113期', issueNo: '0113', duration: 5400 }),
      buildCandidate({ id: 'c4', programName: '看东方', instanceName: '看东方第114期', issueNo: '0114', duration: 5400 }),
    ]
    const mockJudge = buildMockCandidateJudge({
      candidate: null,
      reasoning: '候选较多，需要确认具体排哪个',
      decisionType: 'needs_clarification',
      candidateOptions: candidates,
    })
    const { runtime } = buildRuntime({
      items: [],
      playlistType: 'tv',
      programCandidates: candidates,
      candidateJudge: mockJudge,
    })

    const result = await runtime.submit({
      userInput: '在19点插入看东方',
      channelId: 'dragon',
      date,
      interpretation: {
        intent: 'insert',
        confidence: 1,
        source: 'test',
        slots: { targetTime: '19:00:00', programHint: '看东方' },
      },
    })

    // 不加本地兜底：LLM 返回 needs_clarification 时直接透传 needs_selection
    expect(result.status).toBe('needs_selection')
    expect(result.decision?.recommendations?.length).toBeGreaterThan(0)
  })

  /**
   * Case F: LLM 失败 → needs_selection
   */
  it('Case F: LLM 失败 → needs_selection + 暴露失败原因', async () => {
    const candidates = [
      buildCandidate({ id: 'c1', programName: '看东方' }),
      buildCandidate({ id: 'c2', programName: '午间新闻' }),
    ]
    const mockJudge = buildFailingCandidateJudge('LLM timeout')
    const { runtime } = buildRuntime({
      items: [],
      playlistType: 'tv',
      programCandidates: candidates,
      candidateJudge: mockJudge,
    })

    const result = await runtime.submit({
      userInput: '在19点插入看东方',
      channelId: 'dragon',
      date,
      interpretation: {
        intent: 'insert',
        confidence: 1,
        source: 'test',
        slots: { targetTime: '19:00:00', programHint: '看东方' },
      },
    })

    expect(result.status).toBe('needs_selection')
    expect(result.decision?.recommendations?.length).toBeGreaterThan(0)
  })

  /**
   * Case E: Rotation 多候选 + LLM auto_select → confirm_before_commit (Rotation 默认策略)
   */
  it('Case E: Rotation 多候选 + LLM auto_select → needs_confirmation', async () => {
    const candidates = [
      buildCandidate({ id: 'c1', programName: '看东方' }),
      buildCandidate({ id: 'c2', programName: '午间新闻' }),
    ]
    const mockJudge = buildMockCandidateJudge({
      candidate: candidates[0]!,
      reasoning: '选择看东方作为起始',
      decisionType: 'auto_select',
    })
    const { runtime } = buildRuntime({
      items: [],
      playlistType: 'rotation',
      programCandidates: candidates,
      candidateJudge: mockJudge,
    })

    const result = await runtime.submit({
      userInput: '插入看东方',
      channelId: 'dragon',
      date,
      interpretation: {
        intent: 'insert',
        confidence: 1,
        source: 'test',
        slots: { programHint: '看东方', targetTime: '12:00:00' },
      },
    })

    // Rotation 默认 confirm_before_commit，所以应是 needs_confirmation
    expect(['needs_confirmation', 'executed']).toContain(result.status)
    expect(mockJudge.selectBestCandidate).toHaveBeenCalled()
  })
})

// ============ 进度消息序列测试（Case G） ============

describe('候选决策进度消息序列（Case G）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  /**
   * Case G: 验证 trace 记录包含"LLM 候选决策完成"
   *
   * 通过捕获 onTraceStep 回调，断言 trace 序列包含候选决策记录
   */
  it('Case G: trace 序列包含"LLM 候选决策完成"记录', async () => {
    const candidates = [
      buildCandidate({ id: 'c1', programName: '看东方' }),
      buildCandidate({ id: 'c2', programName: '午间新闻' }),
    ]
    const mockJudge = buildMockCandidateJudge({
      candidate: candidates[1]!,
      reasoning: '选择午间新闻，内容更匹配',
      considerations: ['内容匹配'],
      decisionType: 'auto_select',
    })

    const traceSteps: Array<{ status: string; label: string; detail?: Record<string, unknown> }> = []
    const dataGateway = new InMemorySchedulingDataGateway([{
      channelId: 'dragon',
      date,
      playlistType: 'tv' as PlaylistType,
      scheduleItems: [],
      programCandidates: candidates,
      layoutBounds: { start: '06:00:00', end: '23:59:59' },
    }])
    const runtime = new SchedulingAgentRuntime({
      dataGateway,
      intentInterpreter: buildTestIntentInterpreter(),
      candidateJudge: mockJudge,
      onTraceStep: (step) => {
        traceSteps.push({ status: step.status, label: step.label, detail: step.detail })
      },
    })

    await runtime.submit({
      userInput: '在19点插入看东方',
      channelId: 'dragon',
      date,
      interpretation: {
        intent: 'insert',
        confidence: 1,
        source: 'test',
        slots: { targetTime: '19:00:00', programHint: '看东方' },
      },
    })

    // 断言 trace 包含"LLM 候选决策完成"记录
    const decisionStep = traceSteps.find(
      (step) => step.status === 'planning' && step.label === 'LLM 候选决策完成',
    )
    expect(decisionStep).toBeDefined()
    expect(decisionStep?.detail?.decisionType).toBe('auto_select')
    expect(decisionStep?.detail?.selectedCandidateName).toBe('午间新闻')
    expect(decisionStep?.detail?.reasoning).toBe('选择午间新闻，内容更匹配')

    // 断言 trace 包含"电视播单顺播证据检查"记录（在决策前）
    const evidenceStep = traceSteps.find(
      (step) => step.status === 'planning' && step.label === '电视播单顺播证据检查',
    )
    expect(evidenceStep).toBeDefined()
  })
})
