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
    expect(countsByType.documentary).toBeGreaterThanOrEqual(50)
  })

  it('keeps searchable editorial evidence on library candidates', () => {
    expect(orchestrationDemoCandidates.every((candidate) => candidate.columnId && candidate.columnName)).toBe(true)
    expect(orchestrationDemoCandidates.every((candidate) => candidate.contentTags?.length)).toBe(true)
    expect(orchestrationDemoCandidates.every((candidate) => candidate.programName && candidate.instanceName)).toBe(true)
    expect(orchestrationDemoCandidates.every((candidate) => candidate.duration > 0)).toBe(true)
    expect(orchestrationDemoCandidates.every((candidate) => typeof candidate.estimatedRating === 'number')).toBe(true)
    expect(orchestrationDemoCandidates.every((candidate) => typeof candidate.playCount === 'number' && candidate.playCount > 0)).toBe(true)
    expect(orchestrationDemoCandidates.every((candidate) => typeof candidate.popularityScore === 'number')).toBe(true)

    const candidatesWithTag = (tag: string) =>
      orchestrationDemoCandidates.filter((candidate) => candidate.contentTags?.includes(tag))

    expect(candidatesWithTag('静安寺').length).toBeGreaterThanOrEqual(10)
    expect(candidatesWithTag('户外直播').length + candidatesWithTag('外场直播').length).toBeGreaterThanOrEqual(10)
    expect(candidatesWithTag('导视').length).toBeGreaterThanOrEqual(10)
    expect(candidatesWithTag('发布会').length).toBeGreaterThanOrEqual(10)
  })

  it('includes program-code-less short clips for rotation playlist retrieval', () => {
    const shortClips = orchestrationDemoCandidates.filter((candidate) =>
      candidate.programType === 'short_clip' && candidate.programCode === '',
    )

    expect(shortClips.length).toBeGreaterThanOrEqual(5)
    expect(shortClips.every((candidate) => candidate.id.startsWith('asset-short-'))).toBe(true)
    expect(shortClips.every((candidate) => candidate.programName && candidate.instanceName)).toBe(true)
    expect(shortClips.every((candidate) => candidate.columnName === '轮播短片')).toBe(true)
    expect(shortClips.every((candidate) => candidate.duration > 0 && candidate.duration <= 60)).toBe(true)
    expect(shortClips.every((candidate) => candidate.contentTags?.includes('无节目编号'))).toBe(true)
    expect(shortClips.every((candidate) => candidate.contentTags?.includes('轮播'))).toBe(true)
    expect(shortClips.every((candidate) => typeof candidate.popularityScore === 'number')).toBe(true)
  })

  it('keeps sequential drama episodes available for context-aware TV scheduling', () => {
    const dramaCodes = new Set(orchestrationDemoCandidates.map((candidate) => candidate.programCode))
    expect(dramaCodes.has('881120030005')).toBe(true)
    expect(dramaCodes.has('881120030006')).toBe(true)
    expect(dramaCodes.has('881120030007')).toBe(true)
    expect(dramaCodes.has('881120030008')).toBe(true)
  })
})
