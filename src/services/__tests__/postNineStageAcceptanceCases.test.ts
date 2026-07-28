import { describe, expect, it } from 'vitest'

import {
  postNineStageAcceptanceCases,
  type PostNineStageAcceptanceSurface,
  type PostNineStageFault,
} from './fixtures/postNineStageAcceptanceCases'

const requiredSurfaces: PostNineStageAcceptanceSurface[] = [
  'agent_server', 'planner_boundary', 'candidate_search', 'formal_write', 'react_runtime', 'session_recovery',
]
const requiredFaults: PostNineStageFault[] = [
  'none', 'workspace_mismatch', 'playlist_version_drift', 'transient_write_failure', 'write_delegate_exception',
  'duplicate_request', 'deadline_abort', 'decider_unavailable', 'half_batch_interruption', 'candidate_exhausted',
]

describe('post-nine-stage real scenario acceptance matrix', () => {
  it('keeps every acceptance case executable and five-field complete', () => {
    const ids = new Set<string>()
    for (const scenario of postNineStageAcceptanceCases) {
      expect(ids.has(scenario.id), `${scenario.id} should be unique`).toBe(false)
      ids.add(scenario.id)
      expect(scenario.userInput.trim(), `${scenario.id} userInput`).not.toBe('')
      expect(scenario.expectedDecision.trim(), `${scenario.id} expectedDecision`).not.toBe('')
      expect(scenario.mustNotHappen.trim(), `${scenario.id} mustNotHappen`).not.toBe('')
      expect(scenario.verification.trim(), `${scenario.id} verification`).not.toBe('')
      expect(scenario.canonicalFixture, `${scenario.id} canonical fixture`).toContain('canonicalSchedulingData')
      expect(scenario.initialState.trim(), `${scenario.id} initialState`).not.toBe('')
      expect(scenario.expectedFormalState.trim(), `${scenario.id} expectedFormalState`).not.toBe('')
    }
  })

  it('covers public runtime surfaces and the required reliability faults', () => {
    expect(new Set(postNineStageAcceptanceCases.map(({ surface }) => surface))).toEqual(new Set(requiredSurfaces))
    expect(new Set(postNineStageAcceptanceCases.map(({ fault }) => fault))).toEqual(new Set(requiredFaults))
  })

  it('requires every fault scenario to assert an unchanged or checkpointed formal state', () => {
    for (const scenario of postNineStageAcceptanceCases.filter(({ fault }) => fault !== 'none')) {
      expect(scenario.mustNotHappen).toMatch(/写入|写|执行|回滚|缓存|重放|跨 workspace/)
      expect(scenario.expectedFormalState).toMatch(/保持|不变|不重复|只应用一次|未写入|等价/)
    }
  })
})
