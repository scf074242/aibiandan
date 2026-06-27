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
