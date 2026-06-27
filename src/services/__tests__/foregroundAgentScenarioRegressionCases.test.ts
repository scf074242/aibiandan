import { describe, expect, it } from 'vitest'

import {
  foregroundAgentScenarioRegressionCases,
  summarizeForegroundScenarioRegression,
  type ForegroundScenarioCategory,
  type ForegroundScenarioEvidenceLayer,
  type ForegroundScenarioPlaylist,
} from './fixtures/foregroundAgentScenarioRegressionCases'

const requiredCategories: ForegroundScenarioCategory[] = [
  'workspace',
  'layout_draft_gate',
  'atomic_command',
  'pending_review',
  'read_only_discussion',
  'composite_task',
  'recoverable_failure',
  'ui_language',
]

const requiredPlaylists: ForegroundScenarioPlaylist[] = ['tv', 'rotation', 'mixed']
const requiredEvidenceLayers: ForegroundScenarioEvidenceLayer[] = [
  'browser_observation',
  'foreground_runtime',
  'llm_context',
  'source_contract',
]

describe('foreground Agent scenario regression cases', () => {
  it('keeps Goal 29 focused on a compact but broad real foreground editor scenario set', () => {
    expect(foregroundAgentScenarioRegressionCases.length).toBeGreaterThanOrEqual(16)
    expect(foregroundAgentScenarioRegressionCases.length).toBeLessThanOrEqual(20)
  })

  it('covers the editor-facing paths that drive Goal 26 prompt and context work', () => {
    const ids = new Set<string>()
    const categories = new Set<ForegroundScenarioCategory>()
    const playlists = new Set<ForegroundScenarioPlaylist>()
    const evidenceLayers = new Set<ForegroundScenarioEvidenceLayer>()

    foregroundAgentScenarioRegressionCases.forEach((item) => {
      expect(ids.has(item.id), `${item.id} should be unique`).toBe(false)
      ids.add(item.id)
      categories.add(item.category)
      playlists.add(item.playlist)
      item.evidenceLayers.forEach((layer) => evidenceLayers.add(layer))

      expect(item.userRequest.trim(), `${item.id} userRequest`).not.toBe('')
      expect(item.preconditions.length, `${item.id} preconditions`).toBeGreaterThan(0)
      expect(item.expectedEditorExperience.length, `${item.id} editor experience`).toBeGreaterThan(0)
      expect(item.expectedRuntimeBoundary.length, `${item.id} runtime boundary`).toBeGreaterThan(0)
      expect(item.expectedRuntimeBoundary.join('\n'), `${item.id} should not depend on OpenClaw`).not.toMatch(/OpenClaw.*前置|OpenClaw.*阻塞/)
    })

    requiredCategories.forEach((category) => {
      expect(categories.has(category), `missing category ${category}`).toBe(true)
    })
    requiredPlaylists.forEach((playlist) => {
      expect(playlists.has(playlist), `missing playlist ${playlist}`).toBe(true)
    })
    requiredEvidenceLayers.forEach((layer) => {
      expect(evidenceLayers.has(layer), `missing evidence layer ${layer}`).toBe(true)
    })
  })

  it('records the real browser and runtime gaps fixed by later goals instead of hiding them as already perfect', () => {
    const summary = summarizeForegroundScenarioRegression(foregroundAgentScenarioRegressionCases)
    const rotationDraftAnalysis = foregroundAgentScenarioRegressionCases.find((item) =>
      item.id === 'rotation-draft-analysis-uses-active-draft',
    )
    const optimizationFollowUp = foregroundAgentScenarioRegressionCases.find((item) =>
      item.id === 'optimization-follow-up-is-read-only',
    )
    const rotationThemeDraft = foregroundAgentScenarioRegressionCases.find((item) =>
      item.id === 'rotation-theme-duration-creates-reviewable-draft',
    )
    const recoverableFailure = foregroundAgentScenarioRegressionCases.find((item) =>
      item.id === 'recoverable-llm-timeout-retry',
    )

    expect(summary.total).toBe(17)
    expect(summary.covered).toBe(17)
    expect(summary.goal26Actions).toEqual([
      'rotation-draft-analysis-uses-active-draft',
      'optimization-follow-up-is-read-only',
    ])
    expect(summary.goal29Actions).toEqual([
      'rotation-theme-duration-creates-reviewable-draft',
      'recoverable-llm-timeout-retry',
    ])
    expect(rotationDraftAnalysis?.status).toBe('covered_after_goal26')
    expect(rotationDraftAnalysis?.goal26Action).toContain('active layout draft')
    expect(rotationDraftAnalysis?.expectedEditorExperience.join('\n')).toContain('已有草案')
    expect(rotationDraftAnalysis?.expectedEditorExperience.join('\n')).toContain('不可编排原因')
    expect(optimizationFollowUp?.expectedRuntimeBoundary.join('\n')).toContain('不直接修改草案或正式播单')
    expect(rotationThemeDraft?.status).toBe('covered_after_goal29')
    expect(rotationThemeDraft?.expectedRuntimeBoundary.join('\n')).toContain('mutatesFormalPlaylist=false')
    expect(recoverableFailure?.expectedRuntimeBoundary.join('\n')).toContain('details.noMutation=true')
  })
})
