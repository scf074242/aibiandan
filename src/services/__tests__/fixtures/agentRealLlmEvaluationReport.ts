import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import type { AgentLlmIntentEvaluationReport } from '@/services/agent/llmIntentEvaluation'
import type {
  AgentLlmRuntimeConversationEvaluationReport,
  AgentLlmRuntimeEvaluationReport,
} from '@/services/agent/llmRuntimeEvaluation'

export type AgentRealLlmEvaluationSectionStatus = 'passed' | 'failed' | 'skipped'

export const requiredAgentRealLlmAcceptanceTags = [
  'tv_sequence',
  'rotation_short_clip',
  'missing_param',
  'target_occupied',
  'professional_refusal',
  'pending_context',
] as const

export type AgentRealLlmAcceptanceTag = typeof requiredAgentRealLlmAcceptanceTags[number]

export interface AgentRealLlmAcceptanceCoverage {
  tag: AgentRealLlmAcceptanceTag
  total: number
  passed: number
  failed: number
  covered: boolean
  sections: string[]
}

export interface AgentRealLlmEvaluationSection {
  id: string
  title: string
  status: AgentRealLlmEvaluationSectionStatus
  threshold?: number
  total: number
  passed: number
  failed: number
  passRate?: number
  llmCallsAttempted?: number
  llmCallsSucceeded?: number
  llmCallsFailed?: number
  tagCoverage: Array<{
    tag: string
    total: number
    passed: number
    failed: number
  }>
  skippedReason?: string
  failures: Array<{
    id: string
    tags?: string[]
    failures: string[]
    status?: string
    statuses?: string[]
    llmCallsAttempted?: number
    llmCallsSucceeded?: number
    llmCallsFailed?: number
    interpretationIntent?: string
    pendingAction?: string
    queryKind?: string
  }>
}

export interface AgentRealLlmEvaluationReportFile {
  generatedAt: string
  status: AgentRealLlmEvaluationSectionStatus
  config: {
    runRequested: boolean
    strict: boolean
    apiKeyPresent: boolean
    apiKeyUsable: boolean
    model: string
    baseURL: string
    skipReason?: string
  }
  acceptanceCoverage: AgentRealLlmAcceptanceCoverage[]
  sections: AgentRealLlmEvaluationSection[]
}

export const resolveAgentRealLlmEvaluationReportPath = (value?: string): string =>
  resolve(process.cwd(), value || 'test-results/agent-real-llm-evaluation.json')

export const buildSkippedAgentRealLlmEvaluationSections = (reason: string): AgentRealLlmEvaluationSection[] => [
  buildUnavailableSection('intent_contract', 'Structured intent contract', reason, 'skipped'),
  buildUnavailableSection('runtime_loop', 'Runtime preview and constraint loop', reason, 'skipped'),
  buildUnavailableSection('conversation_loop', 'Multi-turn pending context loop', reason, 'skipped'),
]

export const buildFailedAgentRealLlmEvaluationSections = (reason: string): AgentRealLlmEvaluationSection[] => [
  buildUnavailableSection('intent_contract', 'Structured intent contract', reason, 'failed'),
  buildUnavailableSection('runtime_loop', 'Runtime preview and constraint loop', reason, 'failed'),
  buildUnavailableSection('conversation_loop', 'Multi-turn pending context loop', reason, 'failed'),
]

export const toIntentEvaluationSection = (
  report: AgentLlmIntentEvaluationReport,
  threshold: number,
): AgentRealLlmEvaluationSection => ({
  id: 'intent_contract',
  title: 'Structured intent contract',
  status: report.passRate >= threshold ? 'passed' : 'failed',
  threshold,
  total: report.total,
  passed: report.passed,
  failed: report.failed,
  passRate: report.passRate,
  tagCoverage: report.tagCoverage,
  failures: report.results
    .filter((result) => !result.passed)
    .map((result) => ({
      id: result.id,
      tags: result.tags,
      failures: result.failures,
      interpretationIntent: result.interpretation?.intent,
      pendingAction: result.interpretation?.pendingAction,
      queryKind: result.interpretation?.queryKind,
    })),
})

export const toRuntimeEvaluationSection = (
  report: AgentLlmRuntimeEvaluationReport,
  threshold: number,
): AgentRealLlmEvaluationSection => ({
  id: 'runtime_loop',
  title: 'Runtime preview and constraint loop',
  status: report.passRate >= threshold ? 'passed' : 'failed',
  threshold,
  total: report.total,
  passed: report.passed,
  failed: report.failed,
  passRate: report.passRate,
  llmCallsAttempted: report.llmCallsAttempted,
  llmCallsSucceeded: report.llmCallsSucceeded,
  llmCallsFailed: report.llmCallsFailed,
  tagCoverage: report.tagCoverage,
  failures: report.results
    .filter((result) => !result.passed)
    .map((result) => ({
      id: result.id,
      tags: result.tags,
      failures: result.failures,
      status: result.result.status,
      llmCallsAttempted: result.llmCallsAttempted,
      llmCallsSucceeded: result.llmCallsSucceeded,
      llmCallsFailed: result.llmCallsFailed,
      interpretationIntent: result.result.input.interpretation?.intent,
      pendingAction: result.result.input.interpretation?.pendingAction,
      queryKind: result.result.input.interpretation?.queryKind,
    })),
})

export const toConversationEvaluationSection = (
  report: AgentLlmRuntimeConversationEvaluationReport,
  threshold: number,
): AgentRealLlmEvaluationSection => ({
  id: 'conversation_loop',
  title: 'Multi-turn pending context loop',
  status: report.passRate >= threshold ? 'passed' : 'failed',
  threshold,
  total: report.total,
  passed: report.passed,
  failed: report.failed,
  passRate: report.passRate,
  llmCallsAttempted: report.llmCallsAttempted,
  llmCallsSucceeded: report.llmCallsSucceeded,
  llmCallsFailed: report.llmCallsFailed,
  tagCoverage: report.tagCoverage,
  failures: report.results
    .filter((result) => !result.passed)
    .map((result) => ({
      id: result.id,
      tags: result.tags,
      failures: result.failures,
      statuses: result.results.map((turnResult) => turnResult.status),
      llmCallsAttempted: result.llmCallsAttempted,
      llmCallsSucceeded: result.llmCallsSucceeded,
      llmCallsFailed: result.llmCallsFailed,
    })),
})

export const writeAgentRealLlmEvaluationReport = (
  path: string,
  report: AgentRealLlmEvaluationReportFile,
): void => {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
}

export const summarizeAgentRealLlmEvaluationStatus = (
  sections: AgentRealLlmEvaluationSection[],
): AgentRealLlmEvaluationSectionStatus => {
  if (sections.some((section) => section.status === 'failed')) return 'failed'
  if (sections.every((section) => section.status === 'skipped')) return 'skipped'
  if (buildAgentRealLlmAcceptanceCoverage(sections).some((coverage) => !coverage.covered)) return 'failed'
  return 'passed'
}

export const buildAgentRealLlmAcceptanceCoverage = (
  sections: AgentRealLlmEvaluationSection[],
): AgentRealLlmAcceptanceCoverage[] => requiredAgentRealLlmAcceptanceTags.map((tag) => {
  const matchingCoverage = sections.flatMap((section) =>
    section.tagCoverage
      .filter((coverage) => coverage.tag === tag)
      .map((coverage) => ({ ...coverage, sectionId: section.id })),
  )
  const total = matchingCoverage.reduce((sum, coverage) => sum + coverage.total, 0)
  const passed = matchingCoverage.reduce((sum, coverage) => sum + coverage.passed, 0)
  const failed = matchingCoverage.reduce((sum, coverage) => sum + coverage.failed, 0)
  return {
    tag,
    total,
    passed,
    failed,
    covered: total > 0 && failed === 0,
    sections: matchingCoverage.map((coverage) => coverage.sectionId),
  }
})

const buildUnavailableSection = (
  id: string,
  title: string,
  reason: string,
  status: Extract<AgentRealLlmEvaluationSectionStatus, 'failed' | 'skipped'>,
): AgentRealLlmEvaluationSection => ({
  id,
  title,
  status,
  total: 0,
  passed: 0,
  failed: 0,
  skippedReason: reason,
  tagCoverage: [],
  failures: [],
})
