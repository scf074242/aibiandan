import { afterAll, describe, expect, it } from 'vitest'
import { loadEnv } from 'vite'

import { evaluateAgentLlmIntentCases } from '@/services/agent/llmIntentEvaluation'
import { evaluateAgentLlmRuntimeCases, evaluateAgentLlmRuntimeConversationCases } from '@/services/agent/llmRuntimeEvaluation'
import { LlmAgentIntentInterpreter } from '@/services/agent/llmAgentIntentInterpreter'
import { LLMClient } from '@/services/llm/llmClient'
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
      timeout: 12000,
    })
    const interpreter = new LlmAgentIntentInterpreter({
      chat: llmClient.chat.bind(llmClient),
    })
    const cases = await buildAgentRealLlmEvaluationCases()

    const report = await evaluateAgentLlmIntentCases(interpreter, cases)
    sections.push(toIntentEvaluationSection(report, 0.85))

    expect(report.passRate, JSON.stringify(report.results, null, 2)).toBeGreaterThanOrEqual(0.85)
  }, 180000)

  it('drives runtime preview, confirmation, blocking, query, and validation outcomes from real LLM interpretation', async () => {
    const llmClient = new LLMClient({
      apiKey: apiKey!,
      baseURL,
      model,
      temperature: 0,
      maxTokens: 1200,
      timeout: 12000,
    })
    const interpreter = new LlmAgentIntentInterpreter({
      chat: llmClient.chat.bind(llmClient),
    })
    const cases = await buildAgentRealLlmRuntimeEvaluationCases()

    const report = await evaluateAgentLlmRuntimeCases(interpreter, cases)
    sections.push(toRuntimeEvaluationSection(report, 0.8))

    expect(report.passRate, JSON.stringify(report.results.map((result) => ({
      id: result.id,
      failures: result.failures,
      status: result.result.status,
      interpretation: result.result.input.interpretation,
      issues: result.result.decision.constraintReport?.issues,
    })), null, 2)).toBeGreaterThanOrEqual(0.8)
  }, 180000)

  it('continues real multi-turn scheduling conversations through pending context', async () => {
    const llmClient = new LLMClient({
      apiKey: apiKey!,
      baseURL,
      model,
      temperature: 0,
      maxTokens: 1200,
      timeout: 12000,
    })
    const interpreter = new LlmAgentIntentInterpreter({
      chat: llmClient.chat.bind(llmClient),
    })
    const cases = buildAgentRealLlmConversationEvaluationCases()

    const report = await evaluateAgentLlmRuntimeConversationCases(interpreter, cases)
    sections.push(toConversationEvaluationSection(report, 0.8))

    expect(report.passRate, JSON.stringify(report.results.map((result) => ({
      id: result.id,
      failures: result.failures,
      statuses: result.results.map((turnResult) => turnResult.status),
      interpretations: result.results.map((turnResult) => turnResult.input.interpretation),
    })), null, 2)).toBeGreaterThanOrEqual(0.8)
  }, 180000)
})

const buildUnavailableSections = (reason: string): AgentRealLlmEvaluationSection[] =>
  strictRealLlmEval
    ? buildFailedAgentRealLlmEvaluationSections(reason)
    : buildSkippedAgentRealLlmEvaluationSections(reason)
