import { beforeEach, describe, expect, it } from 'vitest'

import { getAtomicCapabilities, resetAtomicCapabilities } from '@/services/atomicCapabilities'
import { getCandidateService, resetCandidateService } from '@/services/candidateService'
import { getInsertCandidateResolver } from '@/services/insertCandidateResolver'
import type { ProgramCandidate } from '@/types/orchestration'

const createCandidate = (overrides: Partial<ProgramCandidate> = {}): ProgramCandidate => ({
  id: 'candidate-1',
  programId: 'P-NEWS-1',
  programCode: 'NEWS-001',
  programName: '看东方：静安寺外场直播 第1期',
  instanceName: '看东方：静安寺外场直播 第1期',
  channelId: 'dragon',
  columnId: '101',
  columnName: '看东方',
  duration: 900,
  programType: 'news_magazine',
  contentTags: ['看东方', '静安寺', '外场直播'],
  ...overrides,
})

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

  it('推荐排序会优先展示同时命中栏目和内容要求的候选', () => {
    const resolver = getInsertCandidateResolver()
    const result = resolver.resolve({
      channelId: 'dragon',
      params: {
        targetTime: '14:00:00',
        programName: '所属栏目看东方 节目内容静安寺',
        rawProgramText: '所属栏目看东方 节目内容静安寺',
        semanticLabel: '静安寺',
        programTypeHint: 'news_magazine',
      },
      candidates: [
        createCandidate({
          id: 'content-only',
          programCode: 'JINGAN-ONLY',
          programName: '静安寺外场直播 第1期',
          instanceName: '静安寺外场直播 第1期',
          columnId: '104',
          columnName: 'ShanghaiEye',
          contentTags: ['静安寺', '外场直播'],
        }),
        createCandidate({
          id: 'wrong-field-column',
          programCode: 'WRONG-FIELD-KANDF',
          programName: '看东方：静安寺外场直播 第1期',
          instanceName: '看东方：静安寺外场直播 第1期',
          columnId: '104',
          columnName: 'ShanghaiEye',
          contentTags: ['看东方', '静安寺', '外场直播'],
        }),
        createCandidate({
          id: 'column-and-content',
          programCode: 'KANDF-JINGAN',
          programName: '看东方：静安寺外场直播 第1期',
          instanceName: '看东方：静安寺外场直播 第1期',
          columnId: '101',
          columnName: '看东方',
          contentTags: ['看东方', '静安寺', '外场直播'],
        }),
      ],
      searchMode: 'semantic_recommendation',
    })

    expect(result.status).toBe('needs_recommendation')
    if (result.status !== 'needs_recommendation') {
      throw new Error('expected recommendation result')
    }
    expect(result.candidates[0]?.candidate.id).toBe('column-and-content')
    expect(result.candidates[0]?.reasonTags).toContain('栏目/内容要求命中')
    expect(result.candidates.find((candidate) => candidate.candidate.id === 'wrong-field-column')?.reasonTags)
      .not.toContain('栏目/内容要求命中')
  })
})
