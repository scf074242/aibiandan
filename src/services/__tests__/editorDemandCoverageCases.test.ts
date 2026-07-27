import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  editorDemandCoverageCases,
  editorDemandHarnessEngineeringRules,
  editorDemandRootCauseLabels,
  recommendedEngineeringSkillFits,
  summarizeEditorDemandCoverage,
  type EditorDemandCategory,
  type EditorDemandEngineeringPhase,
  type EditorDemandHarness,
  type EditorDemandPlaylistModel,
  type EditorDemandRootCause,
  type EditorDemandSupportLevel,
} from './fixtures/editorDemandCoverageCases'

const requiredCategories: EditorDemandCategory[] = [
  'workspace',
  'tv_layout_draft',
  'rotation_draft',
  'atomic_command',
  'composite_task',
  'read_only_analysis',
  'confirmation',
  'pending_context',
  'guardrail',
  'configuration',
  'public_access',
]

const allowedHarnesses: EditorDemandHarness[] = [
  'foreground_runtime',
  'foreground_browser',
  'contract_test',
  'llm_protocol',
  'manual_product_gate',
]

const allowedPlaylistModels: EditorDemandPlaylistModel[] = ['none', 'tv', 'rotation', 'mixed']
const allowedSupportLevels: EditorDemandSupportLevel[] = ['supported', 'guarded_supported', 'partial', 'not_yet']
const requiredEngineeringPhases: EditorDemandEngineeringPhase[] = ['design', 'implementation', 'review', 'verification']
const agentRulesDoc = readFileSync(resolve(process.cwd(), 'docs/aibiandan-agent-rules.md'), 'utf8')
const agentDevelopmentProtocolDoc = readFileSync(resolve(process.cwd(), 'docs/agent-development-protocol.md'), 'utf8')

describe('editor demand coverage matrix', () => {
  it('keeps the Goal 24 demand set in the 30-50 case harness range', () => {
    expect(editorDemandCoverageCases.length).toBeGreaterThanOrEqual(30)
    expect(editorDemandCoverageCases.length).toBeLessThanOrEqual(50)
  })

  it('uses stable ids and covers the major editor-facing categories', () => {
    const ids = new Set<string>()
    const categories = new Set<EditorDemandCategory>()
    const playlistModels = new Set<EditorDemandPlaylistModel>()

    editorDemandCoverageCases.forEach((item) => {
      expect(ids.has(item.id), `${item.id} should be unique`).toBe(false)
      ids.add(item.id)
      categories.add(item.category)
      playlistModels.add(item.playlistModel)

      expect(item.userRequest.trim(), `${item.id} userRequest`).not.toBe('')
      expect(item.expectedDisposition.trim(), `${item.id} expectedDisposition`).not.toBe('')
      expect(item.reverseInference.trim(), `${item.id} reverseInference`).not.toBe('')
      expect(item.userInput.trim(), `${item.id} userInput`).not.toBe('')
      expect(item.expectedDecision.trim(), `${item.id} expectedDecision`).not.toBe('')
      expect(item.mustNotHappen.trim(), `${item.id} mustNotHappen`).not.toBe('')
      expect(item.verification.trim(), `${item.id} verification`).not.toBe('')
      expect(allowedHarnesses).toContain(item.harness)
      expect(allowedPlaylistModels).toContain(item.playlistModel)
      expect(allowedSupportLevels).toContain(item.supportLevel)
    })

    requiredCategories.forEach((category) => {
      expect(categories.has(category), `missing category ${category}`).toBe(true)
    })

    expect(playlistModels).toEqual(new Set(['tv', 'rotation', 'mixed']))
  })

  it('keeps broad intent LLM-only and prevents programme-code driven coverage', () => {
    editorDemandCoverageCases.forEach((item) => {
      expect(item.userRequest, `${item.id} should not use programme code as the main request`).not.toMatch(/\d{12,}/)
      expect(item.reverseInference, `${item.id} should not route through OpenClaw`).not.toMatch(/OpenClaw.*阻塞|OpenClaw.*前置/)
      expect(item.coveredBy.join('\n'), `${item.id} should not use OpenClaw as the primary harness`).not.toMatch(/OpenClaw/)
    })
  })

  it('requires evidence for supported routes and root-cause analysis for gaps', () => {
    editorDemandCoverageCases.forEach((item) => {
      expect(item.rootCauses.length, `${item.id} rootCauses`).toBeGreaterThan(0)

      item.rootCauses.forEach((cause) => {
        expect(editorDemandRootCauseLabels[cause], `${item.id} ${cause} label`).toBeTruthy()
      })

      if (item.supportLevel === 'supported') {
        expect(item.rootCauses, `${item.id} supported should not hide a gap`).toEqual(['none'])
        expect(item.coveredBy.length, `${item.id} coveredBy`).toBeGreaterThan(0)
      }

      if (item.supportLevel === 'guarded_supported') {
        expect(item.rootCauses, `${item.id} guarded route needs a real boundary`).not.toEqual(['none'])
        expect(item.coveredBy.length, `${item.id} coveredBy`).toBeGreaterThan(0)
      }

      if (item.supportLevel === 'partial') {
        expect(item.rootCauses, `${item.id} partial route needs a gap reason`).not.toEqual(['none'])
        expect(item.coveredBy.length, `${item.id} coveredBy`).toBeGreaterThan(0)
      }

      if (item.supportLevel === 'not_yet') {
        expect(item.rootCauses, `${item.id} not_yet route needs a product gap`).toContain('public_access_gap')
      }
    })
  })

  it('keeps current support high while exposing why special logic still exists', () => {
    const summary = summarizeEditorDemandCoverage(editorDemandCoverageCases)
    const rootCauseKeys = Object.keys(summary.byRootCause) as EditorDemandRootCause[]
    const remainingPartialIds = editorDemandCoverageCases
      .filter((item) => item.supportLevel === 'partial')
      .map((item) => item.id)
      .sort()

    expect(summary.supportedNow).toBeGreaterThanOrEqual(37)
    expect(summary.supportedNowRatio).toBeGreaterThanOrEqual(0.8)
    expect(remainingPartialIds).toEqual([
      'live-llm-chain-coverage',
    ])
    expect(summary.bySupport.not_yet).toBe(2)

    expect(rootCauseKeys).toContain('business_guardrail')
    expect(rootCauseKeys).toContain('candidate_ambiguity')
    expect(rootCauseKeys).not.toContain('data_realism_gap')
    expect(rootCauseKeys).not.toContain('atomic_capability_gap')
    expect(rootCauseKeys).toContain('missing_user_input')
    expect(rootCauseKeys).not.toContain('batch_execution_limit')
    expect(rootCauseKeys).not.toContain('ui_feedback_gap')
    expect(rootCauseKeys).toContain('harness_gap')
    expect(rootCauseKeys).toContain('public_access_gap')
  })

  it('keeps browser simulation as one harness layer rather than the only AI-era test strategy', () => {
    const harnesses = new Set(editorDemandCoverageCases.map((item) => item.harness))

    expect(harnesses).toEqual(new Set<EditorDemandHarness>([
      'foreground_runtime',
      'foreground_browser',
      'contract_test',
      'llm_protocol',
      'manual_product_gate',
    ]))
  })

  it('treats harness as an engineering method across design, implementation, review, and verification', () => {
    const phases = new Set(editorDemandHarnessEngineeringRules.map((item) => item.phase))
    const mentionedHarnesses = new Set<EditorDemandHarness>()

    requiredEngineeringPhases.forEach((phase) => {
      expect(phases.has(phase), `missing engineering phase ${phase}`).toBe(true)
    })

    editorDemandHarnessEngineeringRules.forEach((item) => {
      expect(item.rule.trim(), `${item.phase} rule`).not.toBe('')
      expect(item.enforcedBy.length, `${item.phase} enforcedBy`).toBeGreaterThan(0)
      item.enforcedBy.forEach((harness) => {
        expect(allowedHarnesses, `${item.phase} harness ${harness}`).toContain(harness)
        mentionedHarnesses.add(harness)
      })
    })

    expect(mentionedHarnesses).toEqual(new Set<EditorDemandHarness>([
      'foreground_runtime',
      'foreground_browser',
      'contract_test',
      'llm_protocol',
      'manual_product_gate',
    ]))

    expect(editorDemandHarnessEngineeringRules.map((item) => item.rule).join('\n')).toContain('先补 case')
    expect(editorDemandHarnessEngineeringRules.map((item) => item.rule).join('\n')).toContain('rootCause')
  })

  it('records which general engineering skill types should constrain future Agent work', () => {
    const skillTypes = new Set(recommendedEngineeringSkillFits.map((item) => item.type))
    const curatedCandidateNames = recommendedEngineeringSkillFits
      .flatMap((item) => item.candidateNames)
    const strongFits = recommendedEngineeringSkillFits
      .filter((item) => item.fit === 'strong')
      .map((item) => item.type)

    expect(skillTypes).toEqual(new Set([
      'aibiandan_agent_harness',
      'test_driven_development',
      'code_review',
      'browser_e2e',
      'product_design',
      'security_review',
      'deployment_readiness',
    ]))
    expect(strongFits).toEqual([
      'aibiandan_agent_harness',
      'test_driven_development',
      'code_review',
      'browser_e2e',
    ])

    recommendedEngineeringSkillFits.forEach((item) => {
      expect(item.why.trim(), `${item.type} why`).not.toBe('')
      expect(item.source, `${item.type} source`).toMatch(/project_specific|openai_curated_skill|installed_plugin|future_external_skill/)
      expect(Array.isArray(item.candidateNames), `${item.type} candidateNames`).toBe(true)
      expect(item.shouldConstrain.length, `${item.type} shouldConstrain`).toBeGreaterThan(0)
      expect(item.mustRemainProjectSpecific.length, `${item.type} mustRemainProjectSpecific`).toBeGreaterThan(0)

      if (item.source === 'openai_curated_skill' || item.source === 'installed_plugin') {
        expect(item.candidateNames.length, `${item.type} external skill candidates`).toBeGreaterThan(0)
      }
    })

    const projectHarness = recommendedEngineeringSkillFits.find((item) => item.type === 'aibiandan_agent_harness')
    expect(skillTypes.has('agent_harness' as never), 'agent_harness should not look like an official skill').toBe(false)
    expect(projectHarness?.source).toBe('project_specific')
    expect(projectHarness?.candidateNames).toEqual([])
    expect(curatedCandidateNames).toEqual(expect.arrayContaining([
      'playwright',
      'gh-fix-ci',
      'security-threat-model',
    ]))

    const projectSpecificRules = recommendedEngineeringSkillFits
      .flatMap((item) => item.mustRemainProjectSpecific)
      .join('\n')
    expect(projectSpecificRules).toContain('草案和正式播单默认独立')
    expect(projectSpecificRules).toContain('OpenClaw 不能成为前台阻塞条件')
  })

  it('keeps the human-readable rules document aligned with the Goal 24 guardrails', () => {
    expect(agentRulesDoc).toContain('aibiandan_agent_harness')
    expect(agentRulesDoc).toContain('不是官方外部 skill')
    expect(agentRulesDoc).toContain('真实前台路径优先')
    expect(agentRulesDoc).toContain('用户可见主回复、确认理由和候选说明不能出现“置信度”“匹配度”')
    expect(agentRulesDoc).toContain('电视播单是时间格子里的编排')
    expect(agentRulesDoc).toContain('顺播/期数证据把候选收敛到唯一可排节目')
    expect(agentRulesDoc).toContain('轮播单是内容队列里的编排')
    expect(agentRulesDoc).toContain('pending 像 Codex 审查')
    expect(agentRulesDoc).toContain('草案和正式播单默认独立')
    expect(agentRulesDoc).toContain('外部访问方')
    expect(agentRulesDoc).toContain('需求 case -> 业务边界 -> 实现 -> 验证 -> 根因归类')
    expect(agentRulesDoc).toContain('playwright')
    expect(agentRulesDoc).toContain('security-threat-model')
    expect(agentRulesDoc).toContain('TDD')

    expect(agentDevelopmentProtocolDoc).toContain('不是官方外部 skill')
    expect(agentDevelopmentProtocolDoc).toContain('docs/aibiandan-agent-rules.md')
    expect(agentDevelopmentProtocolDoc).not.toContain('低置信度')
    expect(agentDevelopmentProtocolDoc).not.toContain('高置信度')
  })
})
