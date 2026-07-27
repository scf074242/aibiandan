import { SchedulingAgentRuntime } from './schedulingAgentRuntime'
import type { AgentDeadline } from './agentDeadline'
import type {
  AgentIntentInterpreter,
  AgentResult,
  AgentResultStatus,
  AgentSubmitInput,
  AtomicCommandIntent,
  SchedulingDataGateway,
} from './types'

export interface AgentLlmRuntimeEvaluationCase {
  id: string
  userInput: string
  tags?: string[]
  buildDataGateway: () => SchedulingDataGateway
  input: Omit<AgentSubmitInput, 'userInput' | 'interpretation'>
  expected: {
    status: AgentResultStatus
    intent?: AtomicCommandIntent
    commandIntent?: AtomicCommandIntent
    pendingIntent?: AtomicCommandIntent
    issueCode?: string
    queryKind?: string
    minPreviewSummaryItems?: number
    committedCount?: number
  }
}

export type AgentLlmRuntimeExpectedOutcome = AgentLlmRuntimeEvaluationCase['expected']

export interface AgentLlmRuntimeConversationTurn {
  userInput: string
  expected: AgentLlmRuntimeExpectedOutcome
}

export interface AgentLlmRuntimeConversationCase {
  id: string
  tags?: string[]
  buildDataGateway: () => SchedulingDataGateway
  input: Omit<AgentSubmitInput, 'userInput' | 'interpretation' | 'pendingTask'>
  turns: AgentLlmRuntimeConversationTurn[]
  expectedCommittedCount?: number
}

export interface AgentLlmRuntimeEvaluationCaseResult {
  id: string
  tags: string[]
  passed: boolean
  failures: string[]
  result: AgentResult
  llmCallsAttempted: number
  llmCallsSucceeded: number
  llmCallsFailed: number
}

export interface AgentLlmRuntimeConversationCaseResult {
  id: string
  tags: string[]
  passed: boolean
  failures: string[]
  results: AgentResult[]
  llmCallsAttempted: number
  llmCallsSucceeded: number
  llmCallsFailed: number
}

export interface AgentLlmRuntimeTagCoverage {
  tag: string
  total: number
  passed: number
  failed: number
}

export interface AgentLlmRuntimeEvaluationReport {
  total: number
  passed: number
  failed: number
  passRate: number
  llmCallsAttempted: number
  llmCallsSucceeded: number
  llmCallsFailed: number
  tagCoverage: AgentLlmRuntimeTagCoverage[]
  results: AgentLlmRuntimeEvaluationCaseResult[]
}

export interface AgentLlmRuntimeConversationEvaluationReport {
  total: number
  passed: number
  failed: number
  passRate: number
  llmCallsAttempted: number
  llmCallsSucceeded: number
  llmCallsFailed: number
  tagCoverage: AgentLlmRuntimeTagCoverage[]
  results: AgentLlmRuntimeConversationCaseResult[]
}

export interface AgentLlmRuntimeEvaluationOptions {
  createDeadline?: () => AgentDeadline
}

export const evaluateAgentLlmRuntimeCases = async (
  interpreter: AgentIntentInterpreter,
  cases: AgentLlmRuntimeEvaluationCase[],
  options: AgentLlmRuntimeEvaluationOptions = {},
): Promise<AgentLlmRuntimeEvaluationReport> => {
  const results: AgentLlmRuntimeEvaluationCaseResult[] = []

  for (const testCase of cases) {
    const dataGateway = testCase.buildDataGateway()
    const runtime = new SchedulingAgentRuntime({
      dataGateway,
      intentInterpreter: interpreter,
    })
    const result = await runtime.submit({
      ...testCase.input,
      userInput: testCase.userInput,
    }, options.createDeadline?.())
    const failures = await evaluateRuntimeResult(testCase.expected, testCase.input, result, dataGateway)
    results.push({
      id: testCase.id,
      tags: testCase.tags ?? [],
      passed: failures.length === 0,
      failures,
      result,
      ...collectLlmUsage([result]),
    })
  }

  const passed = results.filter((result) => result.passed).length
  return {
    total: results.length,
    passed,
    failed: results.length - passed,
    passRate: results.length ? passed / results.length : 1,
    ...collectReportLlmUsage(results),
    tagCoverage: collectTagCoverage(results),
    results,
  }
}

export const evaluateAgentLlmRuntimeConversationCases = async (
  interpreter: AgentIntentInterpreter,
  cases: AgentLlmRuntimeConversationCase[],
  options: AgentLlmRuntimeEvaluationOptions = {},
): Promise<AgentLlmRuntimeConversationEvaluationReport> => {
  const results: AgentLlmRuntimeConversationCaseResult[] = []

  for (const testCase of cases) {
    const dataGateway = testCase.buildDataGateway()
    const runtime = new SchedulingAgentRuntime({
      dataGateway,
      intentInterpreter: interpreter,
    })
    const turnResults: AgentResult[] = []
    const failures: string[] = []
    let pendingTask: AgentSubmitInput['pendingTask']

    for (const [index, turn] of testCase.turns.entries()) {
      const result = await runtime.submit({
        ...testCase.input,
        userInput: turn.userInput,
        pendingTask,
      }, options.createDeadline?.())
      turnResults.push(result)
      failures.push(
        ...(await evaluateRuntimeResult(turn.expected, testCase.input, result, dataGateway))
          .map((failure) => `turn ${index + 1}: ${failure}`),
      )
      pendingTask = result.decision.pendingTask
    }

    if (typeof testCase.expectedCommittedCount === 'number') {
      const context = await dataGateway.loadContext({
        ...testCase.input,
        userInput: '',
      })
      if (context.scheduleItems.length !== testCase.expectedCommittedCount) {
        failures.push(`final committed item count expected ${testCase.expectedCommittedCount}, got ${context.scheduleItems.length}`)
      }
    }

    results.push({
      id: testCase.id,
      tags: testCase.tags ?? [],
      passed: failures.length === 0,
      failures,
      results: turnResults,
      ...collectLlmUsage(turnResults),
    })
  }

  const passed = results.filter((result) => result.passed).length
  return {
    total: results.length,
    passed,
    failed: results.length - passed,
    passRate: results.length ? passed / results.length : 1,
    ...collectReportLlmUsage(results),
    tagCoverage: collectTagCoverage(results),
    results,
  }
}

const collectTagCoverage = (
  results: Array<{ tags: string[]; passed: boolean }>,
): AgentLlmRuntimeTagCoverage[] => {
  const coverage = new Map<string, AgentLlmRuntimeTagCoverage>()
  results.forEach((result) => {
    result.tags.forEach((tag) => {
      const entry = coverage.get(tag) ?? { tag, total: 0, passed: 0, failed: 0 }
      entry.total += 1
      if (result.passed) entry.passed += 1
      else entry.failed += 1
      coverage.set(tag, entry)
    })
  })
  return [...coverage.values()].sort((left, right) => left.tag.localeCompare(right.tag))
}

const collectLlmUsage = (results: AgentResult[]): {
  llmCallsAttempted: number
  llmCallsSucceeded: number
  llmCallsFailed: number
} => results.reduce((summary, result) => {
  const usage = result.decision.auditSummary?.llmUsage
  const traceCalls = usage ? undefined : result.trace
    .map((step) => step.detail?.llmCall)
    .filter((call): call is Record<string, unknown> => Boolean(call) && typeof call === 'object')
  return {
    llmCallsAttempted: summary.llmCallsAttempted + (
      usage?.callsAttempted ?? traceCalls?.filter((call) => call.status === 'attempted').length ?? 0
    ),
    llmCallsSucceeded: summary.llmCallsSucceeded + (
      usage?.callsSucceeded ?? traceCalls?.filter((call) => call.status === 'succeeded').length ?? 0
    ),
    llmCallsFailed: summary.llmCallsFailed + (
      usage?.callsFailed ?? traceCalls?.filter((call) => call.status === 'failed').length ?? 0
    ),
  }
}, {
  llmCallsAttempted: 0,
  llmCallsSucceeded: 0,
  llmCallsFailed: 0,
})

const collectReportLlmUsage = <
  T extends { llmCallsAttempted: number; llmCallsSucceeded: number; llmCallsFailed: number },
>(results: T[]): {
  llmCallsAttempted: number
  llmCallsSucceeded: number
  llmCallsFailed: number
} => results.reduce((summary, result) => ({
  llmCallsAttempted: summary.llmCallsAttempted + result.llmCallsAttempted,
  llmCallsSucceeded: summary.llmCallsSucceeded + result.llmCallsSucceeded,
  llmCallsFailed: summary.llmCallsFailed + result.llmCallsFailed,
}), {
  llmCallsAttempted: 0,
  llmCallsSucceeded: 0,
  llmCallsFailed: 0,
})

const evaluateRuntimeResult = async (
  expected: AgentLlmRuntimeExpectedOutcome,
  input: Omit<AgentSubmitInput, 'userInput' | 'interpretation'>,
  result: AgentResult,
  dataGateway: SchedulingDataGateway,
): Promise<string[]> => {
  const failures: string[] = []

  if (result.status !== expected.status) {
    failures.push(`status expected ${expected.status}, got ${result.status}`)
  }
  if (expected.intent && result.decision.intent !== expected.intent) {
    failures.push(`intent expected ${expected.intent}, got ${result.decision.intent ?? 'none'}`)
  }
  if (expected.commandIntent && result.decision.command?.intent !== expected.commandIntent) {
    failures.push(`command intent expected ${expected.commandIntent}, got ${result.decision.command?.intent ?? 'none'}`)
  }
  if (expected.pendingIntent && result.decision.pendingTask?.intent !== expected.pendingIntent) {
    failures.push(`pending intent expected ${expected.pendingIntent}, got ${result.decision.pendingTask?.intent ?? 'none'}`)
  }
  if (
    expected.issueCode
    && !(result.decision.constraintReport?.issues ?? []).some((issue) => issue.code === expected.issueCode)
  ) {
    failures.push(`missing issue ${expected.issueCode}`)
  }
  if (expected.queryKind && result.decision.queryResult?.kind !== expected.queryKind) {
    failures.push(`query kind expected ${expected.queryKind}, got ${result.decision.queryResult?.kind ?? 'none'}`)
  }
  if (
    expected.minPreviewSummaryItems
    && (result.decision.auditSummary?.operation.previewSummary.length ?? 0) < expected.minPreviewSummaryItems
  ) {
    failures.push(`preview summary expected at least ${expected.minPreviewSummaryItems} items`)
  }
  if (typeof expected.committedCount === 'number') {
    const context = await dataGateway.loadContext({
      ...input,
      userInput: '',
    })
    if (context.scheduleItems.length !== expected.committedCount) {
      failures.push(`committed item count expected ${expected.committedCount}, got ${context.scheduleItems.length}`)
    }
  }

  return failures
}
