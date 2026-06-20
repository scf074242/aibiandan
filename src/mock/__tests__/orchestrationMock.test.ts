import { describe, expect, it } from 'vitest'

import {
  orchestrationDemoCandidates,
  orchestrationDemoFinishedProducts,
  orchestrationDemoProgramDefinitions,
  orchestrationDemoProgramInstances,
} from '@/mock/orchestrationMock'

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
    const programCandidates = orchestrationDemoCandidates.filter((candidate) => candidate.programType !== 'short_clip')
    expect(programCandidates.every((candidate) => candidate.columnId && candidate.columnName)).toBe(true)
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

  it('keeps TV instances and short videos in the same finished product library', () => {
    const productIds = new Set(orchestrationDemoFinishedProducts.map((product) => product.productId))
    const programProductIds = new Set(
      orchestrationDemoFinishedProducts
        .filter((product) => product.productKind === 'program_instance')
        .map((product) => product.productId),
    )
    const shortVideoProductIds = new Set(
      orchestrationDemoFinishedProducts
        .filter((product) => product.productKind === 'short_video')
        .map((product) => product.productId),
    )

    expect(orchestrationDemoProgramInstances.every((instance) => productIds.has(instance.instanceId))).toBe(true)
    expect(programProductIds.size).toBe(orchestrationDemoProgramInstances.length)
    expect(shortVideoProductIds.size).toBeGreaterThanOrEqual(100)
    expect(
      orchestrationDemoFinishedProducts
        .filter((product) => product.productKind === 'short_video')
        .every((product) =>
          (product.contentTags?.length ?? 0) >= 12
          && Boolean(product.descriptionText)
          && Boolean(product.visualDescription)
          && (product.shotBreakdown?.length ?? 0) >= 4,
        ),
    ).toBe(true)
  })

  it('includes program-code-less short videos from the finished product library for rotation playlist retrieval', () => {
    const shortClips = orchestrationDemoCandidates.filter((candidate) =>
      candidate.programType === 'short_clip' && candidate.programCode === '',
    )

    expect(shortClips.length).toBeGreaterThanOrEqual(100)
    const instanceIds = new Set(orchestrationDemoProgramInstances.map((instance) => instance.instanceId))
    const programDefinitionIds = new Set(orchestrationDemoProgramDefinitions.map((definition) => definition.programId))
    const shortVideoProductIds = new Set(
      orchestrationDemoFinishedProducts
        .filter((product) => product.productKind === 'short_video')
        .map((product) => product.productId),
    )
    expect(shortClips.every((candidate) => shortVideoProductIds.has(candidate.id))).toBe(true)
    expect(shortClips.every((candidate) => !instanceIds.has(candidate.id))).toBe(true)
    expect(shortClips.every((candidate) => !programDefinitionIds.has(candidate.id))).toBe(true)
    expect(shortClips.every((candidate) => candidate.id.startsWith('asset-short-'))).toBe(true)
    expect(shortClips.every((candidate) => candidate.programName && candidate.instanceName)).toBe(true)
    expect(shortClips.every((candidate) => !candidate.columnId && !candidate.columnName)).toBe(true)
    expect(shortClips.every((candidate) => candidate.duration > 0 && candidate.duration <= 60)).toBe(true)
    expect(shortClips.every((candidate) => candidate.contentTags?.includes('无节目编号'))).toBe(true)
    expect(shortClips.every((candidate) => candidate.contentTags?.includes('轮播'))).toBe(true)
    expect(shortClips.every((candidate) => candidate.contentTags?.some((tag) => tag.includes('开场远景')))).toBe(true)
    expect(shortClips.every((candidate) => candidate.contentTags?.some((tag) => tag.includes('远景')))).toBe(true)
    expect(shortClips.every((candidate) => candidate.contentTags?.some((tag) => tag.includes('特写')))).toBe(true)
    expect(shortClips.every((candidate) => typeof candidate.popularityScore === 'number')).toBe(true)
  })

  it('lets short video retrieval use visual descriptions and shot-level metadata', () => {
    const shortClips = orchestrationDemoCandidates.filter((candidate) => candidate.programType === 'short_clip')
    const matchesAll = (candidate: (typeof shortClips)[number], keywords: string[]) => {
      const haystack = [
        candidate.programName,
        candidate.instanceName,
        ...(candidate.contentTags ?? []),
      ].join(' ')
      return keywords.every((keyword) => haystack.includes(keyword))
    }

    expect(shortClips.some((candidate) => matchesAll(candidate, ['夜景', '城市宣传片']))).toBe(true)
    expect(shortClips.some((candidate) => matchesAll(candidate, ['博物馆', '导览牌']))).toBe(true)
    expect(shortClips.some((candidate) => matchesAll(candidate, ['交通', '提示字幕']))).toBe(true)
    expect(shortClips.some((candidate) => matchesAll(candidate, ['公益', '行为示范']))).toBe(true)
  })

  it('keeps sequential drama episodes available for context-aware TV scheduling', () => {
    const dramaCodes = new Set(orchestrationDemoCandidates.map((candidate) => candidate.programCode))
    expect(dramaCodes.has('881120030005')).toBe(true)
    expect(dramaCodes.has('881120030006')).toBe(true)
    expect(dramaCodes.has('881120030007')).toBe(true)
    expect(dramaCodes.has('881120030008')).toBe(true)
  })

  it('makes periodic TV programs visibly sequential in title and issue number', () => {
    const kanDongfang111 = orchestrationDemoCandidates.find((candidate) =>
      candidate.programName === '看东方111期新春特别行动',
    )
    const noonNews001 = orchestrationDemoCandidates.find((candidate) =>
      candidate.programName === '午间30分001期午间新闻',
    )
    const health001 = orchestrationDemoCandidates.find((candidate) =>
      candidate.programName === '名医话养生001期午后调养篇',
    )

    expect(kanDongfang111).toBeTruthy()
    expect(kanDongfang111?.issueNo).toBe('0111')
    expect(kanDongfang111?.programCode).toBe('002601010111')
    expect(noonNews001?.issueNo).toBe('0001')
    expect(health001?.issueNo).toBe('0001')

    const libraryKanDongfangIssues = orchestrationDemoCandidates
      .filter((candidate) => candidate.columnId === '101' && candidate.programCode.startsWith('88101001'))
      .slice(0, 3)
    const libraryNoonNewsIssues = orchestrationDemoCandidates
      .filter((candidate) => candidate.columnId === '102' && candidate.programCode.startsWith('88102001'))
      .slice(0, 3)

    expect(libraryKanDongfangIssues.map((candidate) => candidate.issueNo)).toEqual(['0111', '0112', '0113'])
    expect(libraryKanDongfangIssues.map((candidate) => candidate.programCode.slice(-4))).toEqual(['0111', '0112', '0113'])
    expect(libraryKanDongfangIssues.every((candidate) => /^看东方\d+期/.test(candidate.programName))).toBe(true)
    expect(libraryNoonNewsIssues.map((candidate) => candidate.issueNo)).toEqual(['0001', '0002', '0003'])
    expect(libraryNoonNewsIssues.every((candidate) => /^午间30分\d{3}期/.test(candidate.programName))).toBe(true)
  })

  it('keeps temporary TV event and guide titles free from forced issue wording', () => {
    const temporaryTitles = [
      '发布会现场直播',
      '城市活动暖场短片',
      '外场连线预告',
      '上海现场集锦',
    ]

    temporaryTitles.forEach((title) => {
      const candidates = orchestrationDemoCandidates.filter((candidate) => candidate.programName === title)
      expect(candidates.length).toBeGreaterThan(0)
      expect(candidates.every((candidate) => !/\d+期/.test(candidate.programName))).toBe(true)
    })
  })

  it('keeps drama candidates constrained by episode wording instead of issue wording', () => {
    const dramaCandidates = orchestrationDemoCandidates
      .filter((candidate) => candidate.columnId === '112' && candidate.programCode.startsWith('88112001'))
      .slice(0, 3)

    expect(dramaCandidates.map((candidate) => candidate.programName)).toEqual([
      '品质剧场：繁花 第1集',
      '品质剧场：繁花 第2集',
      '品质剧场：繁花 第3集',
    ])
    expect(dramaCandidates.every((candidate) => /第\d+集/.test(candidate.programName))).toBe(true)
    expect(dramaCandidates.every((candidate) => !/\d+期/.test(candidate.programName))).toBe(true)
  })

  it('keeps natural language lookup evidence in visible titles instead of program codes', () => {
    const visibleTitleMatches = orchestrationDemoCandidates.filter((candidate) =>
      candidate.columnName === '看东方'
      && candidate.programName.includes('看东方')
      && candidate.programName.includes('111期'),
    )

    expect(visibleTitleMatches.length).toBeGreaterThan(0)
    expect(visibleTitleMatches.some((candidate) => candidate.programCode === '002601010111')).toBe(true)
    expect(visibleTitleMatches.every((candidate) => !candidate.programName.includes(candidate.programCode))).toBe(true)
  })
})
