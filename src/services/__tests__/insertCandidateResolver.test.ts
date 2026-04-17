import { beforeEach, describe, expect, it } from 'vitest'

import { getAtomicCapabilities, resetAtomicCapabilities } from '@/services/atomicCapabilities'
import { getCandidateService, resetCandidateService } from '@/services/candidateService'
import { getInsertCandidateResolver } from '@/services/insertCandidateResolver'

describe('InsertCandidateResolver', () => {
  beforeEach(async () => {
    resetCandidateService()
    resetAtomicCapabilities()
    await getAtomicCapabilities().clearAll()
  })

  it('明确节目名且高置信时会直接选中候选', async () => {
    const candidateService = getCandidateService()
    const candidates = await candidateService.searchPrograms({
      channelId: 'dragon',
      columnId: '103',
      programName: '东方新闻',
      columnStrategy: 'prefer_channel',
      limit: 6,
    })

    const resolver = getInsertCandidateResolver()
    const result = resolver.resolve({
      channelId: 'dragon',
      columnId: '103',
      params: {
        targetTime: '18:30:00',
        programName: '东方新闻',
        rawProgramText: '东方新闻',
        semanticLabel: '新闻',
        programTypeHint: 'news',
      },
      candidates,
      searchMode: 'explicit_name',
    })

    expect(result.status).toBe('resolved')
    if (result.status !== 'resolved') {
      throw new Error('expected resolved result')
    }
    expect(result.selectedCandidate.programName).toContain('东方新闻')
  })

  it('模糊节目名会进入推荐确认态', async () => {
    const candidateService = getCandidateService()
    const candidates = await candidateService.searchPrograms({
      channelId: 'dragon',
      columnId: '101',
      programName: '看东方',
      columnStrategy: 'prefer_channel',
      limit: 6,
    })

    const resolver = getInsertCandidateResolver()
    const result = resolver.resolve({
      channelId: 'dragon',
      columnId: '101',
      params: {
        targetTime: '07:00:00',
        programName: '看东方',
        rawProgramText: '看东方',
        semanticLabel: '资讯',
        programTypeHint: 'news_magazine',
      },
      candidates,
      searchMode: 'explicit_name',
    })

    expect(result.status).toBe('needs_recommendation')
    if (result.status !== 'needs_recommendation') {
      throw new Error('expected recommendation result')
    }
    expect(result.trigger).toBe('ambiguous_candidates')
    expect(result.candidates.length).toBeGreaterThan(1)
  })

  it('只有类型描述时会给出推荐列表', async () => {
    const candidateService = getCandidateService()
    const candidates = await candidateService.searchPrograms({
      channelId: 'dragon',
      columnId: '107',
      programName: '',
      programTypes: ['news'],
      columnStrategy: 'prefer_channel',
      limit: 6,
    })

    const resolver = getInsertCandidateResolver()
    const result = resolver.resolve({
      channelId: 'dragon',
      columnId: '107',
      params: {
        targetTime: '09:00:00',
        rawProgramText: '新闻节目',
        semanticLabel: '新闻',
        programTypeHint: 'news',
      },
      candidates,
      searchMode: 'semantic_recommendation',
    })

    expect(result.status).toBe('needs_recommendation')
    if (result.status !== 'needs_recommendation') {
      throw new Error('expected recommendation result')
    }
    expect(result.trigger).toBe('missing_program_name')
    expect(result.candidates.some((candidate) => candidate.candidate.programName.includes('新闻'))).toBe(true)
  })
})
