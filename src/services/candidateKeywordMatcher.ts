const GENERIC_TERMS = [
  'drama',
  'news_magazine',
  'news',
  'commentary',
  'health',
  'entertainment',
  'kids',
  'documentary',
  '东方快报',
  '看东方',
  '潮童天下',
  '品质剧场',
  '午间30分',
  'ShanghaiEye',
  '名医话养生',
  '经典剧场',
  '东方新娱乐',
  '东方新闻',
  '新闻联播',
  '东方剧场',
  '东方看大剧',
  '品质东方微短剧',
  '今晚',
  '锵锵',
  '一二说',
  '梦想剧场',
  '东方纪实',
  '新闻栏目',
  '电视剧',
  '连续剧',
  '微短剧',
  '短剧',
  '剧场',
  '影视',
  '新闻',
  '资讯',
  '专题',
  '特别报道',
  '直播',
  '户外',
  '外场',
  '现场',
  '活动',
  '服务',
  '节目单',
  '编排单',
  '串联单',
  '排单',
  '播单',
  '轮播',
  '轮播单',
  '直播单',
  '做一版',
  '做一个',
  '做一段',
  '做一条',
  '做一档',
  '做',
  '节目',
  '节目标题',
  '栏目',
  '所属',
  '属于',
  '栏目名',
  '栏目名称',
  '标题',
  '内容',
  '版面',
  '帮我',
  '请',
  '按',
  '排',
  '准备',
  '制作',
  '生成',
  '进行',
  '填充',
  '补齐',
  '编排',
  '排入',
  '安排',
  '选择',
  '优先选择',
  '开始',
  '确认',
  '不参考',
  '忽略',
  '保留',
  '保持',
  '现有',
  '原有',
  '当前',
  '这个',
  '那个',
  '一个',
  '一档',
  '一条',
  '一部',
  '一本',
  '一段',
  '一版',
  '一份',
  '全部是',
  '全是',
  '都是',
  '全部',
  '所有',
  '每段',
  '每个时段',
  '上午',
  '中午',
  '午间',
  '下午',
  '晚间',
  '晚上',
  '夜间',
  '深夜',
  '凌晨',
  '全天',
  '整天',
  '全日',
  '今天',
  '明天',
  '昨天',
  '昨日',
  '上一天',
  '上一播出日',
  '纯电视频道',
  '电视频道',
  '频道编排',
  '常规频道',
  '接昨天',
  '接昨日',
  '接着播',
  '继续播',
  '顺着',
  '顺着排',
  '顺播',
  '续播',
  '进度',
  '上一集',
  '下一集',
  '中间集',
  '补中间集',
  '缺集',
  '补缺集',
  '空档',
  '空窗',
  '空缺',
  '补空档',
  '补空窗',
  '补空缺',
  '开播前',
  '开场前',
  '播出前',
  '会前',
  '会后',
  '赛前',
  '赛后',
  '前后',
  '垫一点',
  '加一点',
  '来一段',
  '放一段',
  '收视优先',
  '收视率优先',
  '高收视率',
  '收视率',
  '热播优先',
  '高热度',
  '热度优先',
  '热播',
  '话题优先',
  '话题热度',
  '舆论热度',
  '热搜',
  '内容匹配优先',
  '匹配优先',
  '高收视',
  '热门',
  '热度',
  '综艺',
  '娱乐',
  '健康',
  '养生',
  '少儿',
  '动画',
  '纪录片',
  '纪实',
  '评论',
  '访谈',
  '观察',
  '民生',
]

const FUNCTIONAL_TERMS = [
  '预热',
  '预告',
  '导视',
  '垫片',
  '暖场',
  '串场',
  '过渡',
  '集锦',
  '精编',
  '精选',
  '回看',
  '短片',
  '片花',
  '花絮',
  '宣推',
  '互动',
  '提醒',
  '交通',
  '天气',
  '社区',
  '公益',
]

const CHINESE_DIGITS: Record<string, number> = {
  零: 0,
  〇: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
}

const EPISODE_PATTERN = /第\s*([0-9零〇一二两三四五六七八九十百]+)\s*([集期])?/gu
const NUMBER_SUFFIX_PATTERN = /[0-9零〇一二两三四五六七八九十百]+$/u

export interface ExplicitSequenceRequirement {
  raw: string
  sequenceNo: number
  unit: 'episode' | 'issue' | 'unknown'
}

export interface EditorialKeywordRequirement {
  kind: 'column' | 'title' | 'content'
  raw: string
  keyword: string
}

export interface EditorialKeywordFields {
  column?: string
  title?: string
  content?: string
  all?: string
}

export const normalizeCandidateKeyword = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[《》“”"'【】（）()。，、；;：:·\-—_/\\|~～]+/g, '')

const splitKeywordParts = (keyword: string): string[] =>
  keyword
    .split(/[《》“”"'【】（）()。，、；;：:·\-—_/\\|~～\s]+/u)
    .map((part) => part.trim())
    .filter(Boolean)

const REAL_CHINESE_SEARCH_FACETS = [
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
  '城市',
  '宣传片',
  '宣传',
  '导视',
  '预告',
  '短片',
  '纪录片',
  '直播',
  '户外',
  '外场',
]

const NATURAL_LANGUAGE_SEARCH_NOISE = [
  '播出',
  '播放',
  '安排',
  '排入',
  '编排',
  '关于',
  '有关',
  '围绕',
  '一段',
  '一个',
  '一条',
  '一些',
  '适合',
  '著名',
  '相关',
  '内容',
  '节目',
  '节目内容',
  '节目标题',
  '所属栏目',
]

const looksLikeNaturalLanguageSearchPhrase = (keyword: string): boolean =>
  /[播排安放找查推].*(关于|有关|围绕|的)|关于|有关|围绕/.test(keyword)

const decomposeNaturalLanguageSearchFacets = (keyword: string): string[] => {
  if (!looksLikeNaturalLanguageSearchPhrase(keyword)) return []

  const facets = new Set<string>()
  const compact = keyword.replace(/\s+/g, '')

  REAL_CHINESE_SEARCH_FACETS.forEach((facet) => {
    if (compact.includes(facet)) {
      facets.add(facet)
    }
  })

  let stripped = compact
  NATURAL_LANGUAGE_SEARCH_NOISE
    .sort((left, right) => right.length - left.length)
    .forEach((noise) => {
      stripped = stripped.replaceAll(noise, ' ')
    })

  stripped
    .split(/[的和与及、，。；;：:,.!?！？\s]+/u)
    .map((part) => part.trim())
    .filter((part) => part.length >= 2)
    .filter((part) => !NATURAL_LANGUAGE_SEARCH_NOISE.includes(part))
    .forEach((part) => facets.add(part))

  return [...facets]
}

const stripTimeRanges = (value: string): string =>
  value
    .replace(/[0-9零〇一二两三四五六七八九十百]{1,3}\s*点\s*(到|至|～|~|-|—)\s*[0-9零〇一二两三四五六七八九十百]{1,3}\s*点?/gu, '')
    .replace(/[0-9]{1,2}[:：][0-9]{2}\s*(到|至|～|~|-|—)\s*[0-9]{1,2}[:：][0-9]{2}/gu, '')
    .replace(/[0-9]{1,2}\s*(到|至|～|~|-|—)\s*[0-9]{1,2}/gu, '')

const stripGenericTerms = (value: string): string => {
  let stripped = stripTimeRanges(value).replace(EPISODE_PATTERN, '')
  stripped = stripped
    .replace(/热闹的?内容/g, '')
    .replace(/轻松的?内容/g, '')
    .replace(/热闹/g, '')
    .replace(/轻松/g, '')
    .replace(/娱乐/g, '')
    .replace(/综艺/g, '')
  for (const term of [...GENERIC_TERMS, ...FUNCTIONAL_TERMS].sort((left, right) => right.length - left.length)) {
    stripped = stripped.replaceAll(term, '')
  }
  return stripped.replace(NUMBER_SUFFIX_PATTERN, '').trim()
}

const looksLikeMojibake = (value: string): boolean =>
  /[锟絔閸閻缂甯娑瀣鐎縷鎸濡鐩鎾鏀惰涓滄柟鍓у満]/u.test(value)

const parseSequenceNumber = (value: string): number | null => {
  const normalized = value.trim()
  if (!normalized) return null

  const direct = Number(normalized)
  if (Number.isFinite(direct) && direct > 0) return direct

  if (normalized === '十') return 10

  const hundredIndex = normalized.indexOf('百')
  if (hundredIndex >= 0) {
    const high = hundredIndex === 0 ? 1 : CHINESE_DIGITS[normalized[hundredIndex - 1]!] ?? 0
    const rest = normalized.slice(hundredIndex + 1)
    const restValue = rest ? parseSequenceNumber(rest) ?? 0 : 0
    return high * 100 + restValue
  }

  const tenIndex = normalized.indexOf('十')
  if (tenIndex >= 0) {
    const high = tenIndex === 0 ? 1 : CHINESE_DIGITS[normalized[tenIndex - 1]!] ?? 0
    const low = CHINESE_DIGITS[normalized[tenIndex + 1]!] ?? 0
    return high * 10 + low
  }

  const parsed = normalized.split('').reduce((sum, char) => sum * 10 + (CHINESE_DIGITS[char] ?? 0), 0)
  return parsed > 0 ? parsed : null
}

const mapSequenceUnit = (unit?: string): ExplicitSequenceRequirement['unit'] => {
  if (unit === '集') return 'episode'
  if (unit === '期') return 'issue'
  return 'unknown'
}

export const extractExplicitSequenceRequirements = (keywords: string[] = []): ExplicitSequenceRequirement[] => {
  const requirements = new Map<string, ExplicitSequenceRequirement>()

  keywords.forEach((keyword) => {
    const candidates = [keyword, ...splitKeywordParts(keyword)]
    candidates.forEach((candidate) => {
      if (looksLikeMojibake(candidate)) return

      for (const match of candidate.matchAll(EPISODE_PATTERN)) {
        const raw = match[0]
        const sequenceNo = parseSequenceNumber(match[1] ?? '')
        if (!sequenceNo) continue

        const unit = mapSequenceUnit(match[2])
        requirements.set(`${sequenceNo}:${unit}`, { raw, sequenceNo, unit })
      }
    })
  })

  return [...requirements.values()]
}

export const hasExplicitSequenceRequirements = (keywords: string[] = []): boolean =>
  extractExplicitSequenceRequirements(keywords).length > 0

export const extractSpecificSearchKeywords = (keywords: string[] = []): string[] => {
  const specific = new Set<string>()

  keywords.forEach((keyword) => {
    const naturalLanguageFacets = decomposeNaturalLanguageSearchFacets(keyword)
    const splitParts = splitKeywordParts(keyword).filter((part) => part !== keyword)
    const candidates = looksLikeNaturalLanguageSearchPhrase(keyword)
      ? [...splitParts, ...naturalLanguageFacets]
      : [keyword, ...splitParts, ...naturalLanguageFacets]
    candidates.forEach((candidate) => {
      if (looksLikeMojibake(candidate)) return
      const stripped = normalizeCandidateKeyword(stripGenericTerms(candidate))
      if (stripped.length >= 2) {
        specific.add(stripped)
      }
    })
  })

  return [...specific]
}

export const hasSpecificSearchKeywords = (keywords: string[] = []): boolean =>
  extractSpecificSearchKeywords(keywords).length > 0

const isStrategyNoise = (value: string): boolean =>
  /^(匹配优先|内容匹配优先|收视优先|收视率优先|高收视率|高收视|热播优先|高热度|热度优先|话题优先|话题热度|舆论热度|热门|热度|热播|热搜|轮播|轮播单|直播单|播单|做一版轮播单|做轮播单|优先选择高收视率节目|优先选择热播节目|纯电视频道|顺播|接昨天|接昨日)$/.test(value.trim())

const resolveEditorialKind = (cue: string): EditorialKeywordRequirement['kind'] => {
  if (cue.includes('栏目')) return 'column'
  if (cue.includes('标题')) return 'title'
  return 'content'
}

const cleanEditorialRawValue = (rawValue: string): string => {
  const controlPattern = /(的)?(?:轮播单|直播单|播单|内容匹配优先|匹配优先|收视率优先|收视优先|高收视率|高收视|热播优先|高热度|热度优先|话题优先|话题热度|舆论热度|热播|热搜|保留已有节目|保留现有节目|保留原有节目|只填空缺|只填剩余空窗|补齐空窗|确认后编排)/u
  return rawValue
    .split(controlPattern)[0]
    ?.replace(/^[:：，,、\s]+/u, '')
    .replace(/[。；;，,、的]+$/u, '')
    .trim() ?? ''
}

export const extractEditorialKeywordRequirements = (keywords: string[] = []): EditorialKeywordRequirement[] => {
  const requirements = new Map<string, EditorialKeywordRequirement>()
  const cuePattern = /(?:所属|属于)?栏目(?:名称|名)?|(?:节目)?标题|(?:节目)?内容/gu

  const pushRequirement = (kind: EditorialKeywordRequirement['kind'], rawValue: string) => {
    const raw = cleanEditorialRawValue(rawValue)
    if (!raw || isStrategyNoise(raw)) return
    const normalized = normalizeCandidateKeyword(raw)
    if (normalized.length < 2 || isStrategyNoise(normalized)) return
    requirements.set(`${kind}:${normalized}`, { kind, raw, keyword: normalized })
  }

  keywords.forEach((keyword) => {
    if (looksLikeMojibake(keyword)) return
    const cueMatches = [...keyword.matchAll(cuePattern)]
    if (cueMatches.length === 0) return

    cueMatches.forEach((match, index) => {
      const cue = match[0]
      const start = (match.index ?? 0) + cue.length
      const end = cueMatches[index + 1]?.index ?? keyword.length
      pushRequirement(resolveEditorialKind(cue), keyword.slice(start, end))
    })
  })

  return [...requirements.values()]
}

export const hasEditorialKeywordRequirements = (keywords: string[] = []): boolean =>
  extractEditorialKeywordRequirements(keywords).length > 0

export const matchesEditorialKeywordRequirements = (haystack: string, keywords: string[] = []): boolean => {
  const requirements = extractEditorialKeywordRequirements(keywords)
  if (requirements.length === 0) return true

  const normalizedHaystack = normalizeCandidateKeyword(haystack)
  return requirements.every((requirement) => normalizedHaystack.includes(requirement.keyword))
}

export const matchesEditorialKeywordRequirementsByFields = (
  fields: EditorialKeywordFields,
  keywords: string[] = [],
): boolean => {
  const requirements = extractEditorialKeywordRequirements(keywords)
  if (requirements.length === 0) return true

  const normalizedFields = {
    column: normalizeCandidateKeyword(fields.column ?? ''),
    title: normalizeCandidateKeyword(fields.title ?? ''),
    content: normalizeCandidateKeyword(fields.content ?? ''),
    all: normalizeCandidateKeyword(fields.all ?? [fields.column, fields.title, fields.content].filter(Boolean).join(' ')),
  }

  return requirements.every((requirement) => {
    if (requirement.kind === 'column') {
      return normalizedFields.column.includes(requirement.keyword)
    }
    if (requirement.kind === 'title') {
      return normalizedFields.title.includes(requirement.keyword)
    }
    return normalizedFields.content.includes(requirement.keyword)
  })
}

export const matchesSpecificSearchKeywords = (haystack: string, keywords: string[] = []): boolean => {
  const specificKeywords = extractSpecificSearchKeywords(keywords)
  if (specificKeywords.length === 0) return true

  const normalizedHaystack = normalizeCandidateKeyword(haystack)
  return specificKeywords.some((keyword) => normalizedHaystack.includes(keyword))
}

export const extractFunctionalSearchKeywords = (keywords: string[] = []): string[] => {
  const functional = new Set<string>()

  keywords.forEach((keyword) => {
    if (looksLikeMojibake(keyword)) return
    const normalized = normalizeCandidateKeyword(keyword)
    FUNCTIONAL_TERMS.forEach((term) => {
      const normalizedTerm = normalizeCandidateKeyword(term)
      if (normalized.includes(normalizedTerm)) {
        functional.add(normalizedTerm)
      }
    })
  })

  return [...functional]
}

export const hasFunctionalSearchKeywords = (keywords: string[] = []): boolean =>
  extractFunctionalSearchKeywords(keywords).length > 0

export const matchesFunctionalSearchKeywords = (haystack: string, keywords: string[] = []): boolean => {
  const functionalKeywords = extractFunctionalSearchKeywords(keywords)
  if (functionalKeywords.length === 0) return true

  const normalizedHaystack = normalizeCandidateKeyword(haystack)
  return functionalKeywords.some((keyword) => normalizedHaystack.includes(keyword))
}

export const extractSoftSearchKeywords = (keywords: string[] = []): string[] => {
  const soft = new Set<string>()

  keywords.forEach((keyword) => {
    if (looksLikeMojibake(keyword)) return
    const candidates = [
      keyword,
      ...splitKeywordParts(keyword),
      keyword.replace(/^(?:所属|属于)?栏目(?:名称|名)?/u, ''),
      keyword.replace(/^(?:节目)?内容/u, ''),
      keyword.replace(/^(?:节目)?标题/u, ''),
    ]

    candidates.forEach((candidate) => {
      const normalized = normalizeCandidateKeyword(candidate)
      if (normalized.length >= 2 && !isStrategyNoise(normalized)) {
        soft.add(normalized)
      }
    })
  })

  return [...soft]
}

const extractCandidateSequenceNumbers = (haystack: string): Set<number> => {
  const sequenceNumbers = new Set<number>()

  extractExplicitSequenceRequirements([haystack]).forEach((requirement) => {
    sequenceNumbers.add(requirement.sequenceNo)
  })

  if (sequenceNumbers.size > 0) {
    return sequenceNumbers
  }

  for (const match of haystack.matchAll(/(\d{1,4})(?=\D|$)/g)) {
    const parsed = Number(match[1])
    if (Number.isFinite(parsed) && parsed > 0) {
      sequenceNumbers.add(parsed)
    }
  }

  return sequenceNumbers
}

export const matchesExplicitSequenceRequirements = (haystack: string, keywords: string[] = []): boolean => {
  const requirements = extractExplicitSequenceRequirements(keywords)
  if (requirements.length === 0) return true

  const sequenceNumbers = extractCandidateSequenceNumbers(haystack)
  return requirements.every((requirement) => sequenceNumbers.has(requirement.sequenceNo))
}
