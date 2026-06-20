import { describe, expect, it } from 'vitest'
import {
  extractEditorialKeywordRequirements,
  extractExplicitSequenceRequirements,
  extractFunctionalSearchKeywords,
  extractSoftSearchKeywords,
  extractSpecificSearchKeywords,
  matchesEditorialKeywordRequirements,
  matchesEditorialKeywordRequirementsByFields,
  matchesExplicitSequenceRequirements,
  matchesFunctionalSearchKeywords,
  matchesSpecificSearchKeywords,
} from '../candidateKeywordMatcher'

describe('candidateKeywordMatcher', () => {
  it('filters scheduling strategy words out of hard content keywords', () => {
    expect(extractSpecificSearchKeywords([
      '按纯电视频道，今天继续播品质剧场，接昨天进度顺播',
    ])).toEqual([])

    expect(extractSpecificSearchKeywords([
      '准备一个电视剧轮播单，收视率优先',
    ])).toEqual([])

    expect(extractSpecificSearchKeywords([
      '14:00到15:00做一版轮播单，优先选择高收视率节目',
    ])).toEqual([])

    expect(extractSpecificSearchKeywords([
      '静安寺户外直播轮播',
      '静安寺',
      '直播',
      '外场直播',
      '轮播单',
      '内容匹配优先',
    ])).toEqual(['静安寺'])
    expect(matchesSpecificSearchKeywords(
      '看东方 静安寺外场直播 第1期',
      ['静安寺户外直播轮播', '静安寺', '直播', '外场直播', '轮播单', '内容匹配优先'],
    )).toBe(true)
    expect(extractEditorialKeywordRequirements(['内容匹配优先'])).toEqual([])
  })

  it('keeps concrete program title keywords after removing column and strategy words', () => {
    expect(extractSpecificSearchKeywords([
      '按纯电视频道，今天继续播品质剧场：纵有疾风起，接昨天进度顺播',
    ])).toEqual(['纵有疾风起'])
    expect(extractSpecificSearchKeywords([
      '按纯电视频道，09:45到10:30继续播品质剧场：纵有疾风起，顺着当前版面补中间集',
    ])).toEqual(['纵有疾风起'])
  })

  it('does not treat broad layout range descriptions as hard program keywords', () => {
    expect(extractSpecificSearchKeywords([
      '13点到18点全部是电视剧',
      '15:00到19:00全是新闻',
      '每个时段都是资讯',
    ])).toEqual([])
  })

  it('extracts explicit episode or issue numbers separately from title keywords', () => {
    expect(extractSpecificSearchKeywords([
      '安排纵有疾风起 第5集',
    ])).toEqual(['纵有疾风起'])
    expect(extractSpecificSearchKeywords([
      '节目标题纵有疾风起第5集',
    ])).toEqual(['纵有疾风起'])

    expect(extractExplicitSequenceRequirements([
      '安排纵有疾风起 第5集',
      '补一条第十期',
    ])).toEqual([
      { raw: '第5集', sequenceNo: 5, unit: 'episode' },
      { raw: '第十期', sequenceNo: 10, unit: 'issue' },
    ])
  })

  it('requires candidates to match explicitly requested episode numbers', () => {
    expect(matchesExplicitSequenceRequirements(
      '品质剧场：纵有疾风起 第5集 881120030005 0005',
      ['纵有疾风起 第5集'],
    )).toBe(true)
    expect(matchesExplicitSequenceRequirements(
      '品质剧场：纵有疾风起 第6集 881120030006 0006',
      ['纵有疾风起 第5集'],
    )).toBe(false)
  })

  it('keeps editorial function words available as soft content constraints', () => {
    expect(extractSpecificSearchKeywords([
      '发布会开播前垫一点现场导视',
    ])).toEqual(['发布会'])
    expect(extractFunctionalSearchKeywords([
      '发布会开播前垫一点现场导视',
    ])).toEqual(['导视'])

    expect(matchesFunctionalSearchKeywords(
      '城市活动预热导视 第1期',
      ['现场导视'],
    )).toBe(true)
    expect(matchesFunctionalSearchKeywords(
      '东方新闻 第1期',
      ['现场导视'],
    )).toBe(false)
  })

  it('extracts column and content words from editorial cue phrases for soft matching', () => {
    expect(extractSpecificSearchKeywords(['所属栏目看东方'])).toEqual([])
    expect(extractSoftSearchKeywords(['所属栏目看东方'])).toEqual(
      expect.arrayContaining(['看东方']),
    )
    expect(extractSoftSearchKeywords(['节目内容静安寺外场直播'])).toEqual(
      expect.arrayContaining(['静安寺外场直播']),
    )
  })

  it('treats column, title, and content cue phrases as required editorial dimensions', () => {
    expect(extractEditorialKeywordRequirements([
      '所属栏目看东方',
      '栏目=东方快报',
      '节目=看东方111期新春特别行动',
      '节目内容静安寺',
      '节目标题发布会预热导视',
    ])).toEqual([
      { kind: 'column', raw: '看东方', keyword: '看东方' },
      { kind: 'column', raw: '东方快报', keyword: '东方快报' },
      { kind: 'title', raw: '看东方111期新春特别行动', keyword: '看东方111期新春特别行动' },
      { kind: 'content', raw: '静安寺', keyword: '静安寺' },
      { kind: 'title', raw: '发布会预热导视', keyword: '发布会预热导视' },
    ])

    expect(matchesEditorialKeywordRequirements(
      '看东方 静安寺外场直播 发布会预热导视 第1期',
      ['所属栏目看东方', '节目内容静安寺'],
    )).toBe(true)
    expect(matchesEditorialKeywordRequirements(
      'ShanghaiEye 静安寺外场直播 发布会预热导视 第1期',
      ['所属栏目看东方', '节目内容静安寺'],
    )).toBe(false)

    expect(extractEditorialKeywordRequirements([
      '所属栏目看东方 节目内容静安寺',
    ])).toEqual([
      { kind: 'column', raw: '看东方', keyword: '看东方' },
      { kind: 'content', raw: '静安寺', keyword: '静安寺' },
    ])

    expect(extractEditorialKeywordRequirements([
      '所属栏目看东方、节目内容静安寺的轮播单，内容匹配优先，保留已有节目',
    ])).toEqual([
      { kind: 'column', raw: '看东方', keyword: '看东方' },
      { kind: 'content', raw: '静安寺', keyword: '静安寺' },
    ])
  })

  it('matches editorial cue phrases against the requested candidate fields', () => {
    expect(matchesEditorialKeywordRequirementsByFields(
      {
        column: '看东方',
        title: '城市活动预热导视 第1期',
        content: '静安寺 外场直播',
      },
      ['所属栏目看东方', '节目内容静安寺', '节目标题城市活动预热导视'],
    )).toBe(true)

    expect(matchesEditorialKeywordRequirementsByFields(
      {
        column: 'ShanghaiEye',
        title: '看东方：静安寺外场直播 第1期',
        content: '看东方 静安寺 外场直播',
      },
      ['所属栏目看东方', '节目内容静安寺'],
    )).toBe(false)

    expect(matchesEditorialKeywordRequirementsByFields(
      {
        column: '看东方',
        title: '上海早晨 第1期',
        content: '发布会预热导视 静安寺',
      },
      ['节目标题发布会预热导视'],
    )).toBe(false)
  })

  it('keeps fictional title requirements hard enough to leave unmatched segments empty', () => {
    expect(extractSpecificSearchKeywords(['生命树电视剧'])).toEqual(['生命树'])
    expect(matchesSpecificSearchKeywords(
      '品质剧场：纵有疾风起 第1集',
      ['生命树电视剧'],
    )).toBe(false)
  })

  it('does not treat vague entertainment style words as hard title keywords', () => {
    expect(extractSpecificSearchKeywords(['\u70ed\u95f9\u7684\u5185\u5bb9'])).toEqual([])
    expect(extractSpecificSearchKeywords(['\u8f7b\u677e\u5185\u5bb9'])).toEqual([])
    expect(extractSpecificSearchKeywords(['\u5a31\u4e50'])).toEqual([])
    expect(extractSpecificSearchKeywords(['\u7efc\u827a\u5185\u5bb9'])).toEqual([])
  })

  it('decomposes natural Chinese content requests before search', () => {
    const keywords = extractSpecificSearchKeywords(['播出关于上海著名旅游景点的宣传片'])

    expect(keywords).toEqual(expect.arrayContaining(['上海', '旅游景点', '景点', '宣传片']))
    expect(keywords).not.toContain('播出关于上海著名旅游景点的宣传片')
  })
})
