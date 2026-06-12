import { describe, expect, it } from 'vitest'

import { orchestrationDemoCandidates } from '@/mock/orchestrationMock'

describe('orchestration demo program library', () => {
  it('provides a 500+ item candidate library for AI scheduling demos', () => {
    expect(orchestrationDemoCandidates.length).toBeGreaterThanOrEqual(500)

    const countsByType = orchestrationDemoCandidates.reduce<Record<string, number>>((acc, candidate) => {
      acc[candidate.programType] = (acc[candidate.programType] ?? 0) + 1
      return acc
    }, {})

    expect(countsByType.news).toBeGreaterThanOrEqual(80)
    expect(countsByType.drama).toBeGreaterThanOrEqual(250)
    expect(countsByType.news_magazine).toBeGreaterThanOrEqual(60)
    expect(countsByType.entertainment).toBeGreaterThanOrEqual(40)
    expect(countsByType.health).toBeGreaterThanOrEqual(40)
    expect(countsByType.commentary).toBeGreaterThanOrEqual(80)
  })
})
