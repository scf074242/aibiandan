import type {
  AgentIntentInterpretation,
  AgentIntentInterpreter,
  AgentSubmitInput,
  AtomicCommandIntent,
  QueryCommandPlan,
} from './types'

export interface AgentLlmIntentEvaluationCase {
  id: string
  userInput: string
  tags?: string[]
  input: Omit<AgentSubmitInput, 'userInput'>
  expected: {
    intent: AtomicCommandIntent
    pendingAction?: AgentIntentInterpretation['pendingAction']
    queryKind?: QueryCommandPlan['queryKind']
    requiredSlotKeys?: Array<keyof NonNullable<AgentIntentInterpretation['slots']>>
    minConfidence?: number
  }
}

export interface AgentLlmIntentEvaluationCaseResult {
  id: string
  tags: string[]
  passed: boolean
  interpretation: AgentIntentInterpretation | null
  failures: string[]
}

export interface AgentLlmEvaluationTagCoverage {
  tag: string
  total: number
  passed: number
  failed: number
}

export interface AgentLlmIntentEvaluationReport {
  total: number
  passed: number
  failed: number
  passRate: number
  tagCoverage: AgentLlmEvaluationTagCoverage[]
  results: AgentLlmIntentEvaluationCaseResult[]
}

export const evaluateAgentLlmIntentCases = async (
  interpreter: AgentIntentInterpreter,
  cases: AgentLlmIntentEvaluationCase[],
): Promise<AgentLlmIntentEvaluationReport> => {
  const results: AgentLlmIntentEvaluationCaseResult[] = []

  for (const testCase of cases) {
    const interpretation = await interpreter.interpret({
      ...testCase.input,
      userInput: testCase.userInput,
    })
    const failures = evaluateInterpretation(testCase, interpretation)
    results.push({
      id: testCase.id,
      tags: testCase.tags ?? [],
      passed: failures.length === 0,
      interpretation,
      failures,
    })
  }

  const passed = results.filter((result) => result.passed).length
  return {
    total: results.length,
    passed,
    failed: results.length - passed,
    passRate: results.length ? passed / results.length : 1,
    tagCoverage: collectTagCoverage(results),
    results,
  }
}

const collectTagCoverage = (
  results: AgentLlmIntentEvaluationCaseResult[],
): AgentLlmEvaluationTagCoverage[] => {
  const coverage = new Map<string, AgentLlmEvaluationTagCoverage>()
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

const evaluateInterpretation = (
  testCase: AgentLlmIntentEvaluationCase,
  interpretation: AgentIntentInterpretation | null,
): string[] => {
  if (!interpretation) {
    return ['no structured interpretation returned']
  }

  const failures: string[] = []
  if (interpretation.intent !== testCase.expected.intent) {
    failures.push(`intent expected ${testCase.expected.intent}, got ${interpretation.intent ?? 'none'}`)
  }
  if (
    testCase.expected.pendingAction
    && interpretation.pendingAction !== testCase.expected.pendingAction
  ) {
    failures.push(`pendingAction expected ${testCase.expected.pendingAction}, got ${interpretation.pendingAction ?? 'none'}`)
  }
  if (testCase.expected.queryKind && interpretation.queryKind !== testCase.expected.queryKind) {
    failures.push(`queryKind expected ${testCase.expected.queryKind}, got ${interpretation.queryKind ?? 'none'}`)
  }

  const minConfidence = testCase.expected.minConfidence ?? 0.5
  if (interpretation.confidence < minConfidence) {
    failures.push(`confidence expected >= ${minConfidence}, got ${interpretation.confidence}`)
  }

  const slots = interpretation.slots ?? {}
  for (const key of testCase.expected.requiredSlotKeys ?? []) {
    if (slots[key] === undefined || slots[key] === '') {
      failures.push(`missing slot ${String(key)}`)
    }
  }

  return failures
}
