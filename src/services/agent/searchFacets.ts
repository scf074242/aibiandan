import type { AgentSubmitInput, SchedulingContextSourceQueryEvidence } from './types'

export const buildSearchFacets = (value: string): string[] => {
  const normalizedWhole = normalizeSearchFacet(value)
  const domainFacets = buildChineseDomainFacets(value)
  const tokens = value
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fff]+/u)
    .map((token) => normalizeSearchFacet(token))
    .filter((token) => token.length > 1 && !isSearchStopword(token))
  const singleDomainFacet = domainFacets[0]
  const facets = domainFacets.length > 1
    ? domainFacets
    : tokens.length > 1
      ? tokens
      : singleDomainFacet && singleDomainFacet !== normalizedWhole
        ? [singleDomainFacet, normalizedWhole]
        : [normalizedWhole]
  return Array.from(new Set(facets.filter(Boolean)))
}

export const buildCandidateQueryEvidence = (
  input: AgentSubmitInput,
): SchedulingContextSourceQueryEvidence | undefined => {
  const interpretation = input.interpretation
  const keyword = resolveCandidateKeyword(input)
  if (!keyword) return undefined
  return {
    keyword,
    facets: Array.from(new Set([
      ...buildSearchFacets(keyword),
      ...(interpretation?.searchAlternatives ?? []).flatMap((alternative) => buildSearchFacets(alternative)),
    ])).slice(0, 12),
  }
}

const resolveCandidateKeyword = (input: AgentSubmitInput): string | undefined => {
  const interpretation = input.interpretation
  const slots = interpretation?.slots
  if (!interpretation?.intent) return undefined

  if (interpretation.intent === 'insert') return cleanKeyword(slots?.programHint)
  if (interpretation.intent === 'replace') return cleanKeyword(slots?.replacementHint)
  if (interpretation.intent === 'query' && interpretation.queryKind === 'candidate_lookup') {
    return cleanKeyword(interpretation.keyword ?? slots?.programHint ?? slots?.replacementHint ?? slots?.targetProgramName)
  }
  return undefined
}

const cleanKeyword = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

const isSearchStopword = (value: string): boolean => new Set([
  'a',
  'an',
  'the',
  'at',
  'to',
  'for',
  'of',
  'in',
  'on',
  'with',
  'and',
  'or',
  'insert',
  'add',
  'find',
  'search',
  'candidate',
  'candidates',
  'program',
  'episode',
  'item',
  'slot',
  'please',
  'need',
  'want',
]).has(value)

const normalizeSearchFacet = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '')

const CHINESE_DOMAIN_FACETS = [
  '城市形象',
  '春日花路',
  '上海',
  '静安寺',
  '陆家嘴',
  '外滩',
  '黄浦江',
  '南京路',
  '豫园',
  '徐家汇',
  '旅游景点',
  '景点',
  '旅游',
  '宣传片',
  '宣传',
  '导视',
  '预告',
  '短片',
  '纪录片',
  '直播',
  '户外',
  '外场',
  '新闻',
  '剧场',
  '电视剧',
  '连续剧',
]

const CHINESE_DOMAIN_NOISE = [
  '插入',
  '插个',
  '插一',
  '加一条',
  '加一段',
  '加个',
  '添加',
  '安排',
  '排入',
  '编排',
  '播放',
  '播出',
  '查找',
  '查询',
  '找',
  '一下',
  '节目',
  '素材',
  '内容',
]

const buildChineseDomainFacets = (value: string): string[] => {
  const compact = value.replace(/\s+/g, '')
  if (!/[\u4e00-\u9fff]/u.test(compact)) return []

  const facets = new Set<string>()
  CHINESE_DOMAIN_FACETS.forEach((facet) => {
    if (compact.includes(facet)) {
      facets.add(normalizeSearchFacet(facet))
    }
  })

  if (facets.size > 0) {
    return [...facets]
  }

  let stripped = compact
    .replace(/\d{1,2}(?:点|时)(?:半|\d{1,2}分?)?/g, '')
    .replace(/\d{1,2}[:：]\d{2}(?::\d{2})?/g, '')

  ;[...CHINESE_DOMAIN_NOISE, ...CHINESE_DOMAIN_FACETS]
    .sort((left, right) => right.length - left.length)
    .forEach((term) => {
      stripped = stripped.replaceAll(term, ' ')
    })

  stripped
    .split(/[的和与及、，。；;：:,.!?！？\s]+/u)
    .map((part) => normalizeSearchFacet(part))
    .filter((part) => part.length > 1 && !isSearchStopword(part))
    .forEach((part) => facets.add(part))

  return [...facets]
}
