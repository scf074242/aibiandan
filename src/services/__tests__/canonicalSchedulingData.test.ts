import { describe, expect, it } from 'vitest'
import {
  canonicalSchedulingData,
  findCanonicalCandidate,
  validateCanonicalSchedulingData,
} from '@/services/agent/canonicalSchedulingData'

describe('canonicalSchedulingData', () => {
  it('uses one dataset and keeps all internal references valid', () => {
    expect(validateCanonicalSchedulingData()).toEqual([])
    expect(canonicalSchedulingData.candidates.length).toBeGreaterThan(0)
    expect(new Set(canonicalSchedulingData.candidates.map((candidate) => candidate.id)).size)
      .toBe(canonicalSchedulingData.candidates.length)
  })

  it('does not invent an entity that is absent from the canonical dataset', () => {
    expect(findCanonicalCandidate('__fixture_entity_that_does_not_exist__')).toBeUndefined()
  })

  it('contains the real-scenario entities used by acceptance flows', () => {
    expect(findCanonicalCandidate('生命树 第5集')).toMatchObject({ programId: 'P112003', issueNo: '0005' })
    expect(findCanonicalCandidate('百姓大讲堂 第1期')).toMatchObject({ programId: 'P126001' })
    expect(findCanonicalCandidate('世界杯亚洲球队介绍 60秒')).toMatchObject({ programType: 'short_clip' })
  })
})
