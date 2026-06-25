import { describe, expect, it } from 'vitest'

import {
  agentAmbiguityRegressionCases,
  ambiguityLevelsInAcceptanceOrder,
  summarizeAgentAmbiguityCases,
  type AgentAmbiguityDisposition,
  type AgentAmbiguityEvidenceLayer,
  type AgentAmbiguityLevel,
} from './fixtures/agentAmbiguityRegressionCases'

const requiredDispositions: AgentAmbiguityDisposition[] = [
  'execute_exactly',
  'direct_or_explain_with_evidence',
  'select_confirm_or_clarify',
  'draft_refine_or_suggest',
  'plan_observe_continue_or_stop',
]

const requiredEvidenceLayers: AgentAmbiguityEvidenceLayer[] = [
  'runtime_case',
  'browser_case',
  'llm_protocol',
  'coverage_matrix',
  'manual_smoke',
]

describe('Agent ambiguity regression cases', () => {
  it('keeps a compact layered case set for post-migration foreground regression', () => {
    expect(agentAmbiguityRegressionCases.length).toBeGreaterThanOrEqual(12)
    expect(agentAmbiguityRegressionCases.length).toBeLessThanOrEqual(18)
  })

  it('covers every ambiguity level, expected disposition, and evidence layer', () => {
    const ids = new Set<string>()
    const levels = new Set<AgentAmbiguityLevel>()
    const dispositions = new Set<AgentAmbiguityDisposition>()
    const evidenceLayers = new Set<AgentAmbiguityEvidenceLayer>()

    agentAmbiguityRegressionCases.forEach((item) => {
      expect(ids.has(item.id), `${item.id} should be unique`).toBe(false)
      ids.add(item.id)
      levels.add(item.level)
      dispositions.add(item.expectedDisposition)
      evidenceLayers.add(item.evidence.layer)

      expect(item.userInput.trim(), `${item.id} userInput`).not.toBe('')
      expect(item.preconditions.length, `${item.id} preconditions`).toBeGreaterThan(0)
      expect(item.acceptanceSignals.length, `${item.id} acceptanceSignals`).toBeGreaterThan(1)
      expect(item.mustNotHappen.length, `${item.id} mustNotHappen`).toBeGreaterThan(1)
      expect(item.evidence.refs.length, `${item.id} evidence refs`).toBeGreaterThan(0)
    })

    ambiguityLevelsInAcceptanceOrder.forEach((level) => {
      expect(levels.has(level), `missing ambiguity level ${level}`).toBe(true)
    })
    requiredDispositions.forEach((disposition) => {
      expect(dispositions.has(disposition), `missing disposition ${disposition}`).toBe(true)
    })
    requiredEvidenceLayers.forEach((layer) => {
      expect(evidenceLayers.has(layer), `missing evidence layer ${layer}`).toBe(true)
    })
  })

  it('uses stricter acceptance for precise commands than for fuzzy planning requests', () => {
    const preciseCases = agentAmbiguityRegressionCases.filter((item) => item.level === 'precise')
    const fuzzyCases = agentAmbiguityRegressionCases.filter((item) => item.level === 'fuzzy_planning')

    expect(preciseCases.length).toBeGreaterThanOrEqual(3)
    expect(fuzzyCases.length).toBeGreaterThanOrEqual(3)

    preciseCases.forEach((item) => {
      expect(
        ['execute_exactly', 'select_confirm_or_clarify'].includes(item.expectedDisposition),
        `${item.id} precise disposition`,
      ).toBe(true)
      expect(item.mustNotHappen.join('\n'), `${item.id} should guard against draft misrouting`).toMatch(/草案|追问|误写|候选|配置|电视|轮播/)
    })

    fuzzyCases.forEach((item) => {
      expect(item.expectedDisposition, `${item.id} fuzzy disposition`).toBe('draft_refine_or_suggest')
      expect(item.acceptanceSignals.join('\n'), `${item.id} should accept draft or suggestion handling`).toMatch(/草案|细化|查证|下一步|正式/)
      expect(item.mustNotHappen.join('\n'), `${item.id} should prevent unsafe writes`).toMatch(/正式|凭空|确认|失败|电视/)
    })
  })

  it('keeps migration validation anchored in real foreground behavior, not OpenClaw or isolated demos', () => {
    const allText = JSON.stringify(agentAmbiguityRegressionCases)

    expect(allText).not.toMatch(/OpenClaw.*阻塞|OpenClaw.*前置/)
    expect(allText).not.toContain('demo-only')
    expect(allText).toContain('browser_case')
    expect(allText).toContain('manual_smoke')
    expect(allText).toContain('runtime_case')
  })

  it('records enough cases per ambiguity tier to explain coverage gaps after migration', () => {
    const summary = summarizeAgentAmbiguityCases()

    expect(summary.precise).toBeGreaterThanOrEqual(3)
    expect(summary.business_specific).toBeGreaterThanOrEqual(2)
    expect(summary.underspecified_atomic).toBeGreaterThanOrEqual(2)
    expect(summary.fuzzy_planning).toBeGreaterThanOrEqual(3)
    expect(summary.long_running).toBeGreaterThanOrEqual(3)
  })
})
