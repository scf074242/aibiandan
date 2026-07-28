import { afterAll, describe, expect, it } from 'vitest'
import { loadEnv } from 'vite'

import { evaluateAgentLlmIntentCases } from '@/services/agent/llmIntentEvaluation'
import { evaluateAgentLlmRuntimeCases, evaluateAgentLlmRuntimeConversationCases } from '@/services/agent/llmRuntimeEvaluation'
import { LlmAgentIntentInterpreter } from '@/services/agent/llmAgentIntentInterpreter'
import { LLMClient } from '@/services/llm/llmClient'
import { AgentDeadline } from '@/services/agent/agentDeadline'
import { LlmFormalOrchestrationDecider } from '@/services/agent/formalOrchestrationDecider'
import { canonicalSchedulingData } from '@/services/agent/canonicalSchedulingData'
import { FormalOrchestrationRuntime } from '@/services/runtime/formalOrchestrationRuntime'
import { decideReactWholeDraft } from '@/services/runtime/reactDraftDecision'
import { AgentPlanner, type AgentPlannerAction } from '@/services/llm/agentPlanner'
import { isPlaceholderApiKey } from '@/services/llm/localDemoLlm'
import { buildAgentRealLlmEvaluationCases } from './fixtures/agentRealLlmEvaluationCases'
import {
  buildAgentRealLlmConversationEvaluationCases,
  buildAgentRealLlmRuntimeEvaluationCases,
} from './fixtures/agentRealLlmRuntimeCases'
import {
  buildFailedAgentRealLlmEvaluationSections,
  buildAgentRealLlmAcceptanceCoverage,
  buildSkippedAgentRealLlmEvaluationSections,
  resolveAgentRealLlmEvaluationReportPath,
  summarizeAgentRealLlmEvaluationStatus,
  toConversationEvaluationSection,
  toIntentEvaluationSection,
  toRuntimeEvaluationSection,
  writeAgentRealLlmEvaluationReport,
  type AgentRealLlmEvaluationSection,
} from './fixtures/agentRealLlmEvaluationReport'

const viteEnv = {
  ...loadEnv('development', process.cwd(), ''),
  ...loadEnv(process.env.MODE || 'development', process.cwd(), ''),
}
const envValue = (key: string): string | undefined => process.env[key] || viteEnv[key]
const apiKeyCandidates = [
  envValue('VITE_CODE_PLAN_LLM_API_KEY'),
  envValue('SILICONFLOW_API_KEY'),
  envValue('OPENAI_API_KEY'),
]
const resolveUsableApiKey = (): string | undefined => {
  return apiKeyCandidates.find((candidate) => candidate && !isPlaceholderApiKey(candidate))
}
const shouldRunRealLlm = envValue('RUN_AGENT_REAL_LLM_EVAL') === '1'
const strictRealLlmEval = envValue('RUN_AGENT_REAL_LLM_EVAL_STRICT') === '1'
const apiKey = resolveUsableApiKey()
const hasUsableApiKey = Boolean(apiKey && !isPlaceholderApiKey(apiKey))
const hasConfiguredApiKey = apiKeyCandidates.some(Boolean)
const baseURL = envValue('VITE_CODE_PLAN_LLM_BASE_URL') || envValue('OPENAI_BASE_URL') || 'https://api.siliconflow.cn/v1'
const model = envValue('VITE_CODE_PLAN_LLM_MODEL') || 'deepseek-ai/DeepSeek-V4-Flash'
const reportPath = resolveAgentRealLlmEvaluationReportPath(envValue('AGENT_LLM_EVAL_REPORT_PATH'))
const sections: AgentRealLlmEvaluationSection[] = []
const REAL_LLM_MATRIX_TIMEOUT_MS = 15 * 60_000
const REAL_LLM_SCENARIO_TIMEOUT_MS = 10 * 60_000
const createSubmitDeadline = () => new AgentDeadline()
const skipReason = !shouldRunRealLlm
  ? 'RUN_AGENT_REAL_LLM_EVAL is not set to 1.'
  : !hasConfiguredApiKey
    ? 'No API key was found in process.env or Vite env files.'
    : !hasUsableApiKey
      ? 'The configured API key is empty or a placeholder value.'
      : undefined

afterAll(() => {
  const finalSections = sections.length > 0
    ? sections
    : buildUnavailableSections(skipReason ?? 'Real LLM evaluation did not run.')
  writeAgentRealLlmEvaluationReport(reportPath, {
    generatedAt: new Date().toISOString(),
    status: summarizeAgentRealLlmEvaluationStatus(finalSections),
    config: {
      runRequested: shouldRunRealLlm,
      strict: strictRealLlmEval,
      apiKeyPresent: Boolean(apiKey),
      apiKeyUsable: hasUsableApiKey,
      model,
      baseURL,
      skipReason,
    },
    acceptanceCoverage: buildAgentRealLlmAcceptanceCoverage(finalSections),
    sections: finalSections,
  })
})

describe.skipIf(shouldRunRealLlm && hasUsableApiKey)('SchedulingAgentRuntime real LLM evaluation preflight', () => {
  it('writes a skipped report when real LLM evaluation is not runnable', () => {
    sections.splice(0, sections.length, ...buildUnavailableSections(skipReason ?? 'Real LLM evaluation is not runnable.'))
    if (strictRealLlmEval) {
      expect.fail(`Strict real LLM evaluation requested but not runnable: ${skipReason ?? 'unknown reason'}`)
    }
    expect(skipReason).toBeTruthy()
  })
})

describe.skipIf(!shouldRunRealLlm || !hasUsableApiKey)('SchedulingAgentRuntime real LLM intent evaluation', () => {
  it('maps high-frequency scheduler utterances into the v1.1 structured intent contract', async () => {
    const llmClient = new LLMClient({
      apiKey: apiKey!,
      baseURL,
      model,
      temperature: 0,
      maxTokens: 1200,
      timeout: 30000,
    })
    const interpreter = new LlmAgentIntentInterpreter({
      chat: llmClient.chat.bind(llmClient),
    })
    const cases = await buildAgentRealLlmEvaluationCases()

    const report = await evaluateAgentLlmIntentCases(interpreter, cases, { createDeadline: createSubmitDeadline })
    sections.push(toIntentEvaluationSection(report, 0.85))

    expect(report.passRate, JSON.stringify(report.results, null, 2)).toBeGreaterThanOrEqual(0.85)
  }, REAL_LLM_MATRIX_TIMEOUT_MS)

  it('drives runtime preview, confirmation, blocking, query, and validation outcomes from real LLM interpretation', async () => {
    const llmClient = new LLMClient({
      apiKey: apiKey!,
      baseURL,
      model,
      temperature: 0,
      maxTokens: 1200,
      timeout: 30000,
    })
    const interpreter = new LlmAgentIntentInterpreter({
      chat: llmClient.chat.bind(llmClient),
    })
    const cases = await buildAgentRealLlmRuntimeEvaluationCases()

    const report = await evaluateAgentLlmRuntimeCases(interpreter, cases, { createDeadline: createSubmitDeadline })
    sections.push(toRuntimeEvaluationSection(report, 0.8))

    expect(report.passRate, JSON.stringify(report.results.map((result) => ({
      id: result.id,
      failures: result.failures,
      status: result.result.status,
      interpretation: result.result.input.interpretation,
      issues: result.result.decision.constraintReport?.issues,
    })), null, 2)).toBeGreaterThanOrEqual(0.8)
  }, REAL_LLM_SCENARIO_TIMEOUT_MS)

  it('continues real multi-turn scheduling conversations through pending context', async () => {
    const llmClient = new LLMClient({
      apiKey: apiKey!,
      baseURL,
      model,
      temperature: 0,
      maxTokens: 1200,
      timeout: 30000,
    })
    const interpreter = new LlmAgentIntentInterpreter({
      chat: llmClient.chat.bind(llmClient),
    })
    const cases = buildAgentRealLlmConversationEvaluationCases()

    const report = await evaluateAgentLlmRuntimeConversationCases(interpreter, cases, { createDeadline: createSubmitDeadline })
    sections.push(toConversationEvaluationSection(report, 0.8))

    expect(report.passRate, JSON.stringify(report.results.map((result) => ({
      id: result.id,
      failures: result.failures,
      statuses: result.results.map((turnResult) => turnResult.status),
      interpretations: result.results.map((turnResult) => turnResult.input.interpretation),
    })), null, 2)).toBeGreaterThanOrEqual(0.8)
  }, REAL_LLM_SCENARIO_TIMEOUT_MS)

  /**
   * case post9-rotation-compression-routes-by-scope
   * - userInput: 把当前3小时轮播单压缩2小时 / 删除完整队尾 / 按热播压缩到2小时
   * - expectedDecision: 歧义追问、有限 batch_delete、整表先调整草案
   * - mustNotHappen: batch_move、静默猜目标、裁切节目、无草案直接正式重编
   * - verification: 真实 AgentPlanner 连续处理三种表达并返回对应结构化 action
   */
  it('routes real rotation compression requests by ambiguity and scope', async () => {
    const canonicalItems = canonicalSchedulingData.candidates.filter((candidate) => candidate.duration === 1800).slice(0, 6)
    expect(canonicalItems.length, 'data_fixture_missing: 需要六条30分钟 canonical 节目构造3小时轮播现场').toBe(6)
    const toClock = (seconds: number) => {
      const hours = Math.floor(seconds / 3600).toString().padStart(2, '0')
      const minutes = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0')
      return `${hours}:${minutes}:00`
    }
    const currentSchedule = canonicalItems.map((candidate, index) => ({
      id: `scheduled-${candidate.id}`,
      programId: candidate.programId,
      programCode: candidate.programCode,
      programName: candidate.programName,
      instanceName: candidate.instanceName,
      startTime: toClock(index * 1800),
      endTime: toClock((index + 1) * 1800),
      duration: candidate.duration,
      programType: candidate.programType,
    }))
    const llmClient = new LLMClient({
      apiKey: apiKey!, baseURL, model, temperature: 0, maxTokens: 1200, timeout: 90_000,
    })
    const planner = new AgentPlanner({ chat: llmClient.chat.bind(llmClient) })
    const baseInput = {
      scheduleState: {
        playlistId: 'rotation-compression', playlistType: 'rotation' as const, rotationStrategy: 'trending' as const,
        rotationDurationSeconds: 10_800, channelId: 'rotation', channelName: '轮播单', date: '2026-07-28',
        isEmpty: false, itemCount: currentSchedule.length, gapCount: 0, hasSelectedTimeRange: false,
      },
      currentSchedule,
    }
    const planWithExplicitRetry = async (userInput: string) => {
      const first = await planner.plan({ ...baseInput, userInput })
      if (!first.llmFailure?.canRetry) return first
      // 独立验收请求模拟用户看到可恢复失败后明确重试，不改变生产运行时的失败暴露语义。
      return planner.plan({ ...baseInput, userInput })
    }
    const ambiguous = await planWithExplicitRetry('把当前3小时轮播单压缩2小时')
    const finite = await planWithExplicitRetry('把当前3小时轮播单队尾完整的2小时内容删掉，保留第1小时')
    const overall = await planWithExplicitRetry('把当前3小时轮播单压缩到2小时，优先保留热播内容')
    const ambiguousPassed = ambiguous.actions[0]?.type === 'clarify'
    const finiteAction = finite.actions[0]
    const finitePassed = finiteAction?.type === 'atomic_command'
      && finiteAction.intent === 'batch_delete'
      && finiteAction.rangeStart === '01:00:00'
      && finiteAction.rangeEnd === '03:00:00'
    const overallAction = overall.actions[0]
    const overallDraftActionPassed = (overallAction?.type === 'prepare_layout_draft' || overallAction?.type === 'refine_layout_draft')
      && overallAction.rotationDurationSeconds === 7200
    const overallResearchPassed = overall.mode === 'react'
      && overall.actions.length === 0
      && overall.reactTask?.nextActions[0]?.type === 'research_check'
      && overall.reactTask.nextActions[0].purpose === 'draft_precheck'
      && `${overall.reactTask.objective} ${overall.reactTask.stopCondition}`.includes('草案')
    const overallPassed = overallDraftActionPassed || overallResearchPassed
    const traces = llmClient.getRecentRequestTraces().filter((trace) => trace.label === 'agent_planner')
    const passed = ambiguousPassed && finitePassed && overallPassed && traces.filter((trace) => trace.success).length >= 3
    sections.push({
      id: 'rotation_compression_planner',
      title: 'Rotation duration compression planner boundary',
      status: passed ? 'passed' : 'failed',
      threshold: 1,
      total: 3,
      passed: [ambiguousPassed, finitePassed, overallPassed].filter(Boolean).length,
      failed: [ambiguousPassed, finitePassed, overallPassed].filter((item) => !item).length,
      passRate: [ambiguousPassed, finitePassed, overallPassed].filter(Boolean).length / 3,
      llmCallsAttempted: traces.length,
      llmCallsSucceeded: traces.filter((trace) => trace.success).length,
      llmCallsFailed: traces.filter((trace) => !trace.success).length,
      tagCoverage: [{ tag: 'rotation_compression', total: 3, passed: [ambiguousPassed, finitePassed, overallPassed].filter(Boolean).length, failed: [ambiguousPassed, finitePassed, overallPassed].filter((item) => !item).length }],
      failures: passed ? [] : [{
        id: 'post9-rotation-compression-routes-by-scope',
        tags: ['rotation_compression'],
        failures: [
          `ambiguous=${JSON.stringify(ambiguous.actions)}`,
          `finite=${JSON.stringify(finite.actions)}`,
          `overall=${JSON.stringify(overall.actions)}`,
          `traces=${traces.length}`,
        ],
      }],
    })

    expect(passed, JSON.stringify({ ambiguous, finite, overall, traces }, null, 2)).toBe(true)
  }, 10 * 60_000)

  /**
   * case post9-rotation-compression-staged-react
   * - userInput: 分析当前3小时轮播单，按热播优先形成压缩到2小时的方案
   * - expectedDecision: 真实 LLM 读取当前编单、草案和 research observation 后返回完整连续2小时草案
   * - mustNotHappen: 本地拼草案；返回正式 mutation；遗漏目标时长或留下草案缺口
   * - verification: decideReactWholeDraft.ok=true，action 仅为草案 action 且 rotationDurationSeconds=7200
   */
  it('forms a real reviewable two-hour compression draft from research observation', async () => {
    const canonicalItems = canonicalSchedulingData.candidates.filter((candidate) => candidate.duration === 1800).slice(0, 6)
    expect(canonicalItems.length, 'data_fixture_missing: 需要六条30分钟 canonical 节目构造3小时轮播现场').toBe(6)
    const llmClient = new LLMClient({
      apiKey: apiKey!, baseURL, model, temperature: 0, maxTokens: 1600, timeout: 90_000,
    })
    const deadline = new AgentDeadline({ overallDeadlineMs: 3 * 60_000 })
    const toClock = (seconds: number) => {
      const hours = Math.floor(seconds / 3600).toString().padStart(2, '0')
      const minutes = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0')
      return `${hours}:${minutes}:00`
    }
    const currentSchedule = canonicalItems.map((candidate, index) => ({
      id: candidate.id,
      programName: candidate.programName,
      startTime: toClock(index * 1800),
      endTime: toClock((index + 1) * 1800),
      duration: candidate.duration,
      programType: candidate.programType,
    }))
    const result = await decideReactWholeDraft({
      llmClient,
      promptVersion: 'v1.1',
      userInput: '分析当前3小时轮播单，按热播优先形成压缩到2小时的方案',
      scheduleState: {
        playlistId: 'rotation-compression', playlistType: 'rotation', rotationStrategy: 'trending',
        rotationDurationSeconds: 10_800, channelId: 'rotation', channelName: '轮播单', date: '2026-07-28',
        isEmpty: false, itemCount: currentSchedule.length, gapCount: 0, hasSelectedTimeRange: false,
      },
      currentSchedule,
      currentLayoutDraft: {
        id: 'rotation-compression-draft', channelId: 'rotation', date: '2026-07-28', source: 'generated',
        userIntent: '当前3小时轮播草案', draftKind: 'duration_segments', targetDurationSeconds: 10_800,
        coverage: { start: '00:00:00', end: '03:00:00' },
        layoutReference: {
          id: 'rotation-compression-layout', name: '当前轮播草案', channelId: 'rotation',
          slots: [0, 1, 2].map((index) => ({
            id: `rotation-slot-${index + 1}`, channelId: 'rotation', columnId: `rotation-column-${index + 1}`,
            startTime: toClock(index * 3600), endTime: toClock((index + 1) * 3600),
          })),
        },
        columns: [0, 1, 2].map((index) => ({
          columnId: `rotation-column-${index + 1}`, columnName: `当前内容段${index + 1}`, channelId: 'rotation',
          defaultProgramType: canonicalItems[index * 2]!.programType, source: 'generated', semanticLabel: `当前内容段${index + 1}`,
          queryHints: canonicalItems.slice(index * 2, index * 2 + 2).map((candidate) => candidate.programName),
        })),
      },
      plan: {
        mode: 'react', actions: [], reasoning: '用户要求按热播策略重构整张轮播草案。',
        reactTask: {
          objective: '结合当前轮播节目和热度证据形成2小时压缩草案', maxTurns: 3, batchSize: 3,
          stopCondition: '生成完整2小时草案供用户审看，不写正式播单',
          nextActions: [{ type: 'research_check', purpose: 'draft_precheck', semanticLabel: '当前轮播热播内容', queries: ['当前轮播 热播内容'] }],
        },
      },
      researchAction: { type: 'research_check', purpose: 'draft_precheck', semanticLabel: '当前轮播热播内容', queries: ['当前轮播 热播内容'] },
      observation: {
        candidateCount: canonicalItems.length,
        topCandidates: canonicalItems.map((candidate) => ({
          id: candidate.id, programName: candidate.programName, duration: candidate.duration,
          programType: candidate.programType, popularityScore: candidate.popularityScore,
          estimatedRating: candidate.estimatedRating, playCount: candidate.playCount, contentTags: candidate.contentTags,
        })),
      },
      deadline,
    })
    const traces = llmClient.getRecentRequestTraces().filter((trace) => trace.label === 'agent_react_draft_decide')
    const passed = result.ok
      && result.action.rotationDurationSeconds === 7200
      && (result.action.type === 'prepare_layout_draft' || result.action.type === 'refine_layout_draft')
      && traces.length === 1
      && traces[0]?.success === true
    sections.push({
      id: 'rotation_compression_draft_decide', title: 'Rotation compression observation-to-draft decide',
      status: passed ? 'passed' : 'failed', threshold: 1, total: 1, passed: passed ? 1 : 0, failed: passed ? 0 : 1,
      passRate: passed ? 1 : 0, llmCallsAttempted: traces.length,
      llmCallsSucceeded: traces.filter((trace) => trace.success).length,
      llmCallsFailed: traces.filter((trace) => !trace.success).length,
      tagCoverage: [{ tag: 'rotation_compression', total: 1, passed: passed ? 1 : 0, failed: passed ? 0 : 1 }],
      failures: passed ? [] : [{ id: 'post9-rotation-compression-staged-react', tags: ['rotation_compression'], failures: [JSON.stringify(result)] }],
    })
    expect(passed, JSON.stringify({ result, traces }, null, 2)).toBe(true)
  }, 240_000)

  /**
   * case formal-react-real-llm-multi-turn-decide
   * - userInput: 先检索候选，再完成最终校验后结束
   * - expectedDecision: 真实 LLM 在第一轮 observation 后返回 validate，第二轮 observation 后返回 complete
   * - mustNotHappen: 使用本地规则补 decide、一次性串行执行、把 mock 当成真实模型、调用失败后假装完成
   * - verification: checkpoint decision 为 continue/complete，LLM trace 至少两次且全部成功
   */
  it('runs a real multi-turn formal ReAct decide loop from observations', async () => {
    const llmClient = new LLMClient({
      apiKey: apiKey!,
      baseURL,
      model,
      temperature: 0,
      maxTokens: 1200,
      timeout: 90_000,
    })
    const deadline = new AgentDeadline({ overallDeadlineMs: 3 * 60_000 })
    const decider = new LlmFormalOrchestrationDecider({ llmClient, deadline })
    const runtime = new FormalOrchestrationRuntime<AgentPlannerAction>({
      actor: async (action) => {
        if (action.type === 'research_check') {
          return {
            type: 'asset_search',
            summary: '素材检索已经完成；任务尚未完成。下一步唯一合法动作是 validate，完成 validate 前禁止 complete。',
            data: { candidateCount: 2, noMutation: true },
          }
        }
        if (action.type === 'validate') {
          return {
            type: 'validation',
            summary: '最终校验已经完成，所有硬约束均通过，任务目标和停止条件已经满足，没有剩余动作。',
            data: { validationPassed: true, noMutation: true },
          }
        }
        throw new Error(`真实 ReAct 评估收到非预期 action：${action.type}`)
      },
      decide: (input) => decider.decide(input),
    })

    const result = await runtime.run({
      originalUserInput: '先检索候选，再完成最终校验后结束',
      plannerTask: {
        objective: '必须先完成 research_check，再执行且仅执行一次 validate；只有 validate observation 明确通过后才能 complete。',
        maxTurns: 3,
        batchSize: 1,
        stopCondition: 'validate observation 明确通过',
        nextActions: [{ type: 'research_check', queries: ['新闻候选'] }],
      },
      deadline,
    })
    const traces = llmClient.getRecentRequestTraces().filter((trace) => trace.label === 'formal_orchestration_decide')
    const passed = result.status === 'completed'
      && result.checkpoints.length >= 2
      && result.checkpoints[0]?.decision.kind === 'continue'
      && result.checkpoints.at(-1)?.decision.kind === 'complete'
      && traces.length >= 2
      && traces.every((trace) => trace.success)
    sections.push({
      id: 'formal_react_loop',
      title: 'Formal ReAct observation and decide loop',
      status: passed ? 'passed' : 'failed',
      threshold: 1,
      total: 1,
      passed: passed ? 1 : 0,
      failed: passed ? 0 : 1,
      passRate: passed ? 1 : 0,
      llmCallsAttempted: traces.length,
      llmCallsSucceeded: traces.filter((trace) => trace.success).length,
      llmCallsFailed: traces.filter((trace) => !trace.success).length,
      tagCoverage: [],
      failures: passed ? [] : [{
        id: 'formal-react-real-llm-multi-turn-decide',
        failures: [`status=${result.status}`, `decisions=${result.checkpoints.map((checkpoint) => checkpoint.decision.kind).join(',')}`, `traces=${traces.length}`],
      }],
    })

    expect(passed, JSON.stringify({
      status: result.status,
      decisions: result.checkpoints.map((checkpoint) => checkpoint.decision),
      traces,
      failure: result.failure,
    }, null, 2)).toBe(true)
  }, 240000)
})

const buildUnavailableSections = (reason: string): AgentRealLlmEvaluationSection[] =>
  strictRealLlmEval
    ? buildFailedAgentRealLlmEvaluationSections(reason)
    : buildSkippedAgentRealLlmEvaluationSections(reason)
