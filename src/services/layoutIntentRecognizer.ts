import type { ChatMessage } from '@/types/llm'
import type { LayoutDraft, LayoutIntentSegment, ScheduleState } from '@/types/orchestration'
import { parseAtomicClockExpression } from './atomicTimeParser'
import { looksLikeProgramSchedulingRequest, parseSchedulingTimeRange, stripProtectedSchedulingClauses } from './schedulingIntentHeuristics'
import type { LLMClient } from './llm/llmClient'

export type LayoutIntentMode = 'layout_prepare' | 'layout_refine' | 'layout_commit' | 'layout_analysis' | 'atomic_fallback' | 'clarify'

export interface LayoutIntentRecognition {
  mode: LayoutIntentMode
  confidence: number
  reasoning: string
  ignoreExistingLayout: boolean
  targetTimeRange?: { start: string; end: string }
  semanticLabel?: string
  programTypeHint?: string
  segments?: LayoutIntentSegment[]
}

export interface LayoutIntentRecognizerInput {
  scheduleState: ScheduleState
  userInput: string
  history?: string[]
  currentLayoutDraft?: LayoutDraft | null
  hasUploadedLayout?: boolean
  hasDefaultLayout?: boolean
}

const CONFIDENCE_THRESHOLD = 0.72
const PROTECTED_RULE_BASED_MODES: LayoutIntentMode[] = ['layout_analysis', 'layout_commit']

const looksLikeLlmSchedulableRequest = (input: string): boolean => {
  const hasTimeScope = Boolean(extractTimeRange(input))
    || /(\d{1,2}:\d{2}).*(到|至|-).*(\d{1,2}:\d{2})/.test(input)
  const hasSchedulingObject = /(轮播单|播单|直播单|节目单|编排单|排单|预告|导视|垫片|短片|片花|花絮|集锦|精编|精选|回看|暖场|串场|过渡)/.test(input)
  const hasScenarioCue = /(直播|户外|现场|活动|会场|地点|商圈|静安寺|外场|发布会|赛事|赛前|赛后|会前|会后|开播前|开场前|暖场|串场|过渡|花絮|集锦|精编|回看)/.test(input)
  const hasCreationCue = /(准备|创建|制作|生成|做一份|做一个|做个|排一份|排一个|加个|加一点|加一段|上点|放点|垫个|垫一点|垫一段|串场|衔接|过渡|收尾)/.test(input)
  return (hasTimeScope || hasScenarioCue) && hasSchedulingObject && (hasScenarioCue || hasCreationCue)
}

const looksLikeDirectOrchestrationIntent = (input: string): boolean => {
  return [
    '帮我全天编排',
    '全天编排',
    '整天编排',
    '帮我填充全天节目',
    '填充全天节目',
    '补齐当前所有空窗',
    '补齐当前空窗',
    '补齐空窗',
    '补齐当前所有空缺',
    '补齐当前空缺',
  ].some((keyword) => input.includes(keyword))
}

const normalizeInput = (value: string) => value.trim().toLowerCase().replace(/\s+/g, '')

const extractTimeRange = (input: string): { start: string; end: string } | undefined => {
  return parseSchedulingTimeRange(input)
}

const matchesIgnoreExistingLayout = (input: string): boolean => {
  return [
    '不参考当前版面参考',
    '不要参考当前版面参考',
    '不参考当前版面',
    '不要参考当前版面',
    '不参考当前频道版面',
    '不要参考当前频道版面',
    '不参考版面',
    '不要参考版面',
    '忽略当前版面',
    '忽略当前版面参考',
    '忽略现有版面',
  ].some((keyword) => input.includes(keyword))
}

const matchesLayoutCommit = (input: string): boolean => {
  const explicitCommit = [
    '按这个版面开始编排',
    '按这个版面开始排',
    '按该版面开始编排',
    '确认版面',
    '采用这个版面',
    '用这个版面编排',
    '确认并输出编排单',
    '生成正式编排单',
    '输出正式编排单',
    '开始生成编排单',
    '直接生成编排单',
    '生成节目单',
    '落到节目单',
    '应用到节目单',
  ].some((keyword) => input.includes(keyword))
  const shortContextualCommit =
    /^(?:可以了?|可以的|没问题|没问题了|行了?|好|好的|就这样|就这样吧|先这样|先这样吧|开始吧|开排吧|排吧|编排吧|ok)$/i.test(input)
    || /(?:就按|按|照|按照)(?:这个|该|当前|这版|这个版面|这份草案|这个草案)(?:来|排|编排|开始|开始编排|执行|生成|生成编排单|生成节目单|输出编排单)?/.test(input)
    || /(?:这个|该|当前|这版|这个版面|这份草案|这个草案)(?:可以|没问题|ok)/i.test(input)
    || /(?:这个|该|当前|这版|这个版面|这份草案|这个草案).*(?:落到|应用到|写入|生成|输出).*(?:节目单|编排单)/.test(input)
    || /(?:用|拿)(?:这个|该|当前|这版|这个版面|这份草案|这个草案).*(?:执行|生成|输出|编排)/.test(input)
    || /(?:可以|没问题).*(?:开始编排|开始排|编排|排吧|生成编排单|生成节目单|输出编排单)/.test(input)
  return explicitCommit || shortContextualCommit
}

const extractRestartAfterDiscard = (input: string): string | null => {
  const patterns = [
    /^(?:不要|不用|取消|放弃|清掉|清除|删除|删掉)(?:这个|当前|刚才的|原来的)?(?:版面草案|草案|版面)(?:了|掉)?(?:重新|重做|再来|再做|改做|换成|改成|做成|来一版|做一版|排一版)?(.+)$/u,
    /^(?:这个|当前|刚才的|原来的)?(?:版面草案|草案|版面)(?:不要了|不用了|取消掉|放弃|清掉|清除|删掉|删除)(?:重新|重做|再来|再做|改做|换成|改成|做成|来一版|做一版|排一版)?(.+)$/u,
    /^(?:这个|当前|刚才的|原来的)?(?:不要了|不用了|算了|放弃)(?:重新|重做|再来|再做|改做|换成|改成|做成|来一版|做一版|排一版)(.+)$/u,
  ]

  for (const pattern of patterns) {
    const raw = input.match(pattern)?.[1]?.trim()
    const cleaned = raw
      ?.replace(/^(?:，|,|。|、|吧|先|再|重新|重做|再来|再做|改做|换成|改成|做成|来一版|做一版|排一版)+/u, '')
      .replace(/^(?:一版|一个|一份|一条|一点|一些)+/u, '')
      .replace(/(?:吧|了)$/u, '')
      .trim()
    if (cleaned && !/^(?:这个|当前|刚才的|原来的)?(?:版面草案|草案|版面)?$/.test(cleaned)) {
      return cleaned
    }
  }

  return null
}

const matchesLayoutAnalysis = (input: string): boolean => {
  const hasAnalysisVerb = ['分析', '评估', '研判', '诊断', '梳理'].some((keyword) => input.includes(keyword))
  const hasLayoutTarget = ['当前版面', '版面编排', '当前编排', '当前节目单', '节目单编排', '节目编排', '编排情况']
    .some((keyword) => input.includes(keyword))
  const hasEditorialCue = /编辑视角|业务分析|文字版报告|分析报告/.test(input)
  return (hasAnalysisVerb && hasLayoutTarget) || (hasLayoutTarget && hasEditorialCue) || (hasAnalysisVerb && hasEditorialCue)
}

const matchesLayoutOptimization = (input: string): boolean => {
  const hasOptimizeVerb = ['优化', '调优', '重构', '重新梳理', '重做'].some((keyword) => input.includes(keyword))
  const hasTarget = ['当前版面', '版面', '当前编排', '编排', '节目单'].some((keyword) => input.includes(keyword))
  return hasOptimizeVerb && hasTarget
}

const matchesLayoutDraftRemove = (input: string): boolean => {
  const hasRemoveVerb = ['删除', '删掉', '移除', '去掉'].some((keyword) => input.includes(keyword))
  const hasDraftCue = ['草案', '版面草案', '当前版面', '版面', '时段'].some((keyword) => input.includes(keyword))
  const hasTargetCue = Boolean(extractTimeRange(input))
    || /(\d{1,2})(点半|点(\d{1,2})分?|[:：]\d{2})/.test(input)
    || /《[^》]+》/.test(input)
    || !['草案', '版面', '时段'].some((keyword) => input === `删除${keyword}` || input === `去掉${keyword}`)
  return hasRemoveVerb && hasDraftCue && hasTargetCue
}

const matchesLayoutRefineVerb = (input: string): boolean => {
  return ['改成', '换成', '替换成', '替换为', '改为', '调整为', '统一成', '变成'].some((keyword) => input.includes(keyword))
}

const matchesLayoutPrepareVerb = (input: string): boolean => {
  return ['排入', '编入', '铺成', '安排成', '都排', '全部排入', '全部编入', '整体排成', '做个', '做一段', '上点', '上一段', '放点', '放一段', '加点', '加个', '加一点', '加一些', '加一段', '加一条', '垫点', '垫个', '垫一点', '垫一段', '垫一条', '串场', '衔接', '过渡', '收个', '收一段', '补点'].some((keyword) => input.includes(keyword))
}

const looksLikeAtomicFallback = (input: string, options: { hasContent: boolean }): boolean => {
  const hasAtomicVerb = ['移动', '删除', '插入', '添加', '替换', '改', '调整', '顺一下', '顺一个', '挪一下', '挪一个', '后移', '前移', '顺延', '延后', '提前']
    .some((keyword) => input.includes(keyword))
  const hasAtomicAnchor = /(\d{1,2})(点半|点(\d{1,2})分?|[:：]\d{2})/.test(input)
    || /《[^》]+》/.test(input)
    || ['那个', '那条', '那段', '后面', '前面', '刚才', '这个节目', '这条节目'].some((keyword) => input.includes(keyword))
  const hasLayoutCue = ['版面', '栏目', '剧场', '时段', '上午', '下午', '晚间', '晚上', '全天', '整天', '全日']
    .some((keyword) => input.includes(keyword))
  const hasExplicitRange = /(到|至|-)/.test(input) && /(\d{1,2})(点半|点(\d{1,2})分?|[:：]\d{2})/.test(input)
  if (hasExplicitRange && options.hasContent) {
    return false
  }
  return hasAtomicVerb && hasAtomicAnchor && !hasLayoutCue
}

const extractSemanticLabel = (input: string): string | undefined => {
  const normalized = input
    .replace(/^(?:不参考当前版面参考|不要参考当前版面参考|不参考当前版面|不要参考当前版面|不参考版面|不要参考版面|忽略当前版面参考|忽略当前版面)[,，、\s]*/u, '')
    .trim()
  const verbMatch = normalized.match(/(?:排入|编入|铺成|安排成|做成|做个|做一段|改成|换成|替换成|替换为|改为|调整为|统一成|变成|上点|上一段|放点|放一段|加点|加个|加一点|加一些|加一段|加一条|垫点|垫个|垫一点|垫一段|垫一条|串场|衔接|过渡|收个|收一段|补点)(.+)$/u)
  const rawLabel = verbMatch?.[1]?.trim()
  if (!rawLabel) {
    const hasOpenSchedulingAnchor = Boolean(extractTimeRange(normalized))
      || /(轮播单|直播单|播单|节目单|编排单|串联单|排单|单子)/u.test(normalized)
      || /(今晚|明晚|今天|明天|周末|周一|周二|周三|周四|周五|周六|周日).*(直播|活动|预热|专题|服务|提醒)/u.test(normalized)
    const openLabel = stripLayoutPrefix(normalized)
      .replace(/(?:轮播单|直播单|播单|节目单|编排单|串联单|排单|单子)+$/u, '')
      .trim()
    if (
      openLabel
      && hasOpenSchedulingAnchor
      && looksLikeProgramSchedulingRequest(normalized)
      && /(直播|户外|现场|外场|活动|会场|商圈|发布会|展会|赛事|节庆|预热|预告|导视|垫片|暖场|串场|过渡|集锦|精编|精选|回看|短片|片花|花絮|宣推|互动|轻松|开播|开场|赛前|赛后|会前|会后|收尾|特别报道|主题|服务|提醒|文旅|交通|天气|社区|公益|消费|庆典|静安寺|外滩)/u.test(openLabel)
    ) {
      return openLabel
    }
    return undefined
  }

  const cleaned = rawLabel
    .replace(/^(?:全部|都|统一|整体)+/u, '')
    .replace(/(?:节目|版面|内容)+$/u, '')
    .trim()

  return cleaned || undefined
}

const stripContextualRefineNoise = (input: string): string => input
  .replace(/^(?:就按|还是|继续|麻烦|请|帮我|把)?(?:刚才那个主题|刚才的主题|原来的主题|上一版|当前草案|这个草案|当前版面|这个版面|这个时段|这段|那段|刚才那段|刚才|当前|这个|那个|那条|这条)+/u, '')
  .replace(/^(?:主题|内容|节目|栏目|版面)+/u, '')
  .replace(/(?:主题|内容|节目|栏目|版面)+$/u, '')
  .trim()

const cleanContextualSemanticLabel = (input: string | undefined): string | undefined => {
  if (!input) {
    return undefined
  }

  const cleaned = stripContextualRefineNoise(input)
    .replace(/^(?:一点|一些|点|更|再|也|偏向?|围绕|侧重|主打|增加|补充|加入)+/u, '')
    .replace(/(?:一点|一些|点|为主)+$/u, '')
    .trim()

  return cleaned || undefined
}

const extractContextualSemanticLabel = (input: string): string | undefined => {
  const withoutContext = stripContextualRefineNoise(input)
  const patterns = [
    /(?:加一点|加一些|补一点|补一些|来点|换点|多一点|多一些)(.+)$/u,
    /(?:偏向?|主打|围绕|侧重)(.+)$/u,
    /以(.+?)为主$/u,
    /(.+?)(?:多一点|多一些)$/u,
  ]

  for (const source of [withoutContext, input]) {
    for (const pattern of patterns) {
      const label = cleanContextualSemanticLabel(source.match(pattern)?.[1])
      if (label) {
        return label
      }
    }
  }

  return undefined
}

const looksLikeContextualDraftRefine = (input: string): boolean => {
  const hasContextCue = /(刚才|当前|这个|这段|那个|那段|上一版|原来|草案|版面|时段)/u.test(input)
  const hasPreferenceCue = /(偏向?|主打|围绕|侧重|多一点|多一些|加一点|加一些|补一点|补一些|换点|来点|以.+为主)/u.test(input)
  return hasContextCue && hasPreferenceCue
}

const stripLayoutPrefix = (input: string): string => input
  .replace(/^(?:不参考当前版面参考|不要参考当前版面参考|不参考当前版面|不要参考当前版面|不参考当前频道版面|不要参考当前频道版面|不参考版面|不要参考版面|忽略当前版面|忽略当前版面参考|忽略现有版面)[,，、\s]*/u, '')
  .replace(/^(?:请|帮我|帮忙|麻烦|给我|给|我要|需要|想要|先)?(?:来个|来一版|来一份|出一份|出一个|做个|做份|做一版|做一份|做一个|准备一份|准备一个|生成一份|生成一个|排一版|排一份|搞一版|搞一份|搞一个|弄一版|弄一份|弄一个)?/u, '')
  .replace(/^(?:上午|中午|午间|下午|晚间|晚上|夜间|深夜|凌晨|全天|整天|全日)/u, '')
  .replace(/^(?:\d{1,2}:\d{2}|\d{1,2}(?::\d{1,2})?点(?:半)?)(?:到|至|-)(?:\d{1,2}:\d{2}|\d{1,2}(?::\d{1,2})?点(?:半)?)/u, '')
  .replace(/^(?:\d{1,2})(?:到|至|-)(?:\d{1,2})(?:点)?/u, '')
  .replace(/^(?:全部|都|统一|整体)+/u, '')
  .replace(/^(?:改成|换成|替换成|替换为|改为|调整为|统一成|变成|排入|编入|铺成|安排成|安排|编排|排|继续播|续播|接着播|顺着排|做成|做个|做一段|做|上点|上一段|放点|放一段|加点|加个|加一点|加一些|加一段|加一条|垫点|垫个|垫一点|垫一段|垫一条|串场|衔接|过渡|收个|收一段|补点)+/u, '')
  .replace(/(?:节目|栏目|版面|内容|轮播单|直播单|播单|节目单|编排单|串联单|排单)+$/u, '')
  .trim()

const extractSegmentSemanticLabel = (input: string): string | undefined => {
  const fromVerb = extractSemanticLabel(input)
  if (fromVerb) return fromVerb
  const cleaned = stripLayoutPrefix(input)
  return cleaned || undefined
}

const extractProgramTypeHint = (semanticLabel: string | undefined, input: string): string | undefined => {
  const text = `${semanticLabel ?? ''}${input}`
  if (/(电视剧|剧场|连续剧|影视|微短剧|短剧)/u.test(text)) {
    return 'drama'
  }
  if (/(新闻|快报|播报)/u.test(text)) {
    return 'news'
  }
  if (/(资讯|专题)/u.test(text)) {
    return 'news_magazine'
  }
  if (/(评论|观察|访谈|民生)/u.test(text)) {
    return 'commentary'
  }
  if (/(预热|预告|导视|垫片|暖场|串场|过渡|集锦|精编|精选|回看|短片|片花|花絮|宣推|互动|轻松|开播|开场|赛前|赛后|会前|会后|收尾|特别报道|服务|提醒|文旅|交通|天气|社区|公益|发布会|展会|直播|户外|外场|商圈|活动)/u.test(text)) {
    return 'news_magazine'
  }
  if (/(健康|养生)/u.test(text)) {
    return 'health'
  }
  if (/(娱乐|综艺)/u.test(text)) {
    return 'entertainment'
  }
  if (/(少儿|动画)/u.test(text)) {
    return 'kids'
  }
  if (/(纪录片|纪实)/u.test(text)) {
    return 'documentary'
  }
  return undefined
}

const clockTextToSeconds = (clockText: string): number => {
  const [hours = 0, minutes = 0, seconds = 0] = clockText.split(':').map(Number)
  return hours * 3600 + minutes * 60 + seconds
}

const normalizeClockFromSeconds = (totalSeconds: number): string => {
  const clamped = Math.max(0, Math.min(86399, Math.round(totalSeconds)))
  const hour = Math.floor(clamped / 3600)
  const minute = Math.floor((clamped % 3600) / 60)
  const second = clamped % 60
  return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}:${second.toString().padStart(2, '0')}`
}

const parseChineseNumber = (value: string): number | null => {
  const normalized = value.replace(/两/g, '二').replace(/〇/g, '零')
  const digits: Record<string, number> = {
    零: 0,
    一: 1,
    二: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
  }
  if (Object.prototype.hasOwnProperty.call(digits, normalized)) {
    return digits[normalized]!
  }
  if (normalized === '十') return 10
  const teen = normalized.match(/^十([一二三四五六七八九])$/u)
  if (teen) return 10 + digits[teen[1]!]!
  const tens = normalized.match(/^([一二三四五六七八九])十([一二三四五六七八九])?$/u)
  if (tens) return digits[tens[1]!]! * 10 + (tens[2] ? digits[tens[2]]! : 0)
  return null
}

const parseDurationSeconds = (value: string): number | null => {
  if (/一刻钟/u.test(value)) return 15 * 60
  if (/三刻钟/u.test(value)) return 45 * 60
  if (/半个?小时/u.test(value)) return 30 * 60

  const hourMatch = value.match(/(?:(\d+(?:\.\d+)?)|([零〇一二两三四五六七八九十]{1,3}))(?:个)?小时/u)
  if (hourMatch) {
    const hours = hourMatch[1] ? Number(hourMatch[1]) : parseChineseNumber(hourMatch[2]!)
    return hours && hours > 0 ? Math.round(hours * 3600) : null
  }

  const minuteMatch = value.match(/(?:(\d+)|([零〇一二两三四五六七八九十]{1,3}))分钟/u)
  if (minuteMatch) {
    const minutes = minuteMatch[1] ? Number(minuteMatch[1]) : parseChineseNumber(minuteMatch[2]!)
    return minutes && minutes > 0 ? minutes * 60 : null
  }

  return null
}

const cleanSequentialSegmentLabel = (input: string): string | undefined => {
  const cleaned = stripLayoutPrefix(input)
    .replace(/^(?:先|再|然后|接着|随后|之后|后面|前面)+/u, '')
    .replace(/^(?:来|来一段|做|做一段|安排|排|垫|垫一段|加|加一段|补|补一段)+/u, '')
    .replace(/^(?:的|个|一段|一条)+/u, '')
    .trim()
  return cleaned || undefined
}

const extractSequentialDurationSegments = (input: string): LayoutIntentSegment[] | undefined => {
  const normalized = normalizeInput(input)
  const anchor = parseAtomicClockExpression(normalized)
  if (!anchor) return undefined

  const tail = normalized.slice(anchor.index + anchor.matchedText.length)
  if (!/(先|再|然后|接着|随后)/u.test(tail)) return undefined

  const durationToken = '(?:一刻钟|三刻钟|半个?小时|(?:(?:\\d+(?:\\.\\d+)?)|[零〇一二两三四五六七八九十]{1,3})(?:个)?小时|(?:(?:\\d+)|[零〇一二两三四五六七八九十]{1,3})分钟)'
  const pattern = new RegExp(`(?:先|再|然后|接着|随后)?(?:来一段|做一段|安排|来|做|排|垫一段|垫|加一段|加|补一段|补)?(${durationToken})([\\s\\S]*?)(?=(?:再|然后|接着|随后)(?:来一段|做一段|安排|来|做|排|垫一段|垫|加一段|加|补一段|补)?${durationToken}|$)`, 'gu')

  const parsed: Array<{ durationSeconds: number; label: string; part: string }> = []
  let match: RegExpExecArray | null
  while ((match = pattern.exec(tail)) !== null) {
    const durationSeconds = match[1] ? parseDurationSeconds(match[1]) : null
    const rawLabel = match[2]?.replace(/[，,；;、]+$/u, '').trim()
    const label = rawLabel ? cleanSequentialSegmentLabel(rawLabel) : undefined
    if (!durationSeconds || !label) continue
    parsed.push({ durationSeconds, label, part: rawLabel! })
  }

  if (parsed.length < 2) return undefined

  let cursor = clockTextToSeconds(anchor.targetTime)
  return parsed.map(({ durationSeconds, label, part }) => {
    const start = normalizeClockFromSeconds(cursor)
    cursor += durationSeconds
    const programTypeHint = extractProgramTypeHint(label, part)
    return {
      start,
      end: normalizeClockFromSeconds(cursor),
      semanticLabel: label,
      programTypeHint,
      sequential: programTypeHint === 'drama' || /剧场|电视剧|连续剧/u.test(label),
    }
  })
}

const extractStructuredSegments = (input: string): LayoutIntentSegment[] | undefined => {
  const sequentialSegments = extractSequentialDurationSegments(input)
  if (sequentialSegments) return sequentialSegments

  const parts = input
    .split(/[，,；;、]/u)
    .map((part) => normalizeInput(part))
    .filter(Boolean)

  if (parts.length < 2) return undefined

  const segments = parts
    .map((part): LayoutIntentSegment | null => {
      const range = extractTimeRange(part)
      const semanticLabel = extractSegmentSemanticLabel(part)
      const programTypeHint = extractProgramTypeHint(semanticLabel, part)
      if (!range || (!semanticLabel && !programTypeHint)) {
        return null
      }
      return {
        start: range.start,
        end: range.end,
        semanticLabel,
        programTypeHint,
        sequential: programTypeHint === 'drama' || /剧场|电视剧|连续剧/u.test(semanticLabel ?? ''),
      }
    })
    .filter((segment): segment is LayoutIntentSegment => Boolean(segment))

  return segments.length >= 2 ? segments : undefined
}

const isVagueLayoutRequest = (
  input: string,
  hasScope: boolean,
  semanticLabel?: string,
  programTypeHint?: string,
): boolean => {
  const hasLayoutWord = ['版面', '排单', '播单', '轮播单', '直播单', '排一下', '排一版'].some((keyword) => input.includes(keyword))
  if (!hasLayoutWord) {
    return false
  }

  return !hasScope && !semanticLabel && !programTypeHint
}

const summarizeDraft = (draft?: LayoutDraft | null): string => {
  if (!draft) {
    return '当前没有待确认的版面草案。'
  }

  const slots = draft.layoutReference.slots
    .slice(0, 6)
    .map((slot) => {
      const column = draft.columns.find((item) => item.columnId === slot.columnId)
      const label = column?.semanticLabel ?? column?.columnName ?? slot.id
      const start = slot.startTime.split('T')[1]?.slice(0, 8) ?? draft.coverage.start
      const end = slot.endTime.split('T')[1]?.slice(0, 8) ?? draft.coverage.end
      return `${start}-${end} ${label}`
    })

  return `当前已有版面草案，覆盖 ${draft.coverage.start}-${draft.coverage.end}。前几个时段：${slots.join('；') || '无'}`
}

export class LayoutIntentRecognizer {
  constructor(private llmClient: LLMClient) {}

  async recognize(input: LayoutIntentRecognizerInput): Promise<LayoutIntentRecognition> {
    const fallback = this.ruleBasedRecognize(input)
    if (!this.shouldUseLlm(input, fallback)) {
      return fallback
    }

    try {
      const response = await this.llmClient.chat(this.buildPrompt(input), {
        temperature: 0.1,
        maxTokens: 400,
        timeout: 8000,
        maxRetries: 1,
        traceLabel: 'layout_intent',
      })
      const parsed = this.parseResponse(response.content)
      if (!parsed) {
        return fallback
      }
      return this.mergeRecognitions(fallback, this.normalizeContextualDraftRefine(input, parsed))
    } catch {
      return fallback
    }
  }

  private shouldUseLlm(
    input: LayoutIntentRecognizerInput,
    fallback: LayoutIntentRecognition,
  ): boolean {
    const normalized = normalizeInput(input.userInput)
    if (looksLikeDirectOrchestrationIntent(normalized)) {
      return false
    }
    if (fallback.mode === 'atomic_fallback') {
      return false
    }
    if (matchesLayoutDraftRemove(normalized)) {
      return false
    }
    if (input.currentLayoutDraft && extractRestartAfterDiscard(normalized)) {
      return false
    }
    if (PROTECTED_RULE_BASED_MODES.includes(fallback.mode)) {
      return false
    }
    if (input.currentLayoutDraft) {
      return true
    }
    if (fallback.mode !== 'clarify') {
      return true
    }
    return /版面|排单|播单|轮播单|直播单|剧场|栏目|全天|上午|下午|晚上|晚间|不参考/.test(input.userInput)
      || looksLikeLlmSchedulableRequest(normalized)
      || looksLikeProgramSchedulingRequest(input.userInput)
  }

  private ruleBasedRecognize(input: LayoutIntentRecognizerInput): LayoutIntentRecognition {
    const normalized = normalizeInput(input.userInput)
    const restartInstruction = input.currentLayoutDraft ? extractRestartAfterDiscard(normalized) : null
    const actionableInput = stripProtectedSchedulingClauses(restartInstruction ?? normalized)
    const structuredSegments = extractStructuredSegments(stripProtectedSchedulingClauses(restartInstruction ?? input.userInput))
    const targetTimeRange = extractTimeRange(actionableInput)
    const contextualSemanticLabel = (input.currentLayoutDraft || normalized.includes('版面'))
      ? extractContextualSemanticLabel(actionableInput)
      : undefined
    const semanticLabel = extractSemanticLabel(actionableInput) ?? contextualSemanticLabel
    const programTypeHint = extractProgramTypeHint(semanticLabel, actionableInput)
    const ignoreExistingLayout = matchesIgnoreExistingLayout(normalized)
    const hasScope = Boolean(targetTimeRange)
    const hasContent = Boolean(semanticLabel || programTypeHint)
    const hasContextualRefineCue = input.currentLayoutDraft
      ? looksLikeContextualDraftRefine(normalized)
      : false

    if (restartInstruction && hasContent) {
      return {
        mode: 'layout_prepare',
        confidence: 0.94,
        reasoning: '检测到用户放弃当前版面草案并提出新的版面需求，应丢弃旧草案后重新生成待确认草案。',
        ignoreExistingLayout: true,
        targetTimeRange,
        semanticLabel,
        programTypeHint,
        segments: structuredSegments,
      }
    }

    if (matchesLayoutCommit(normalized) && (input.currentLayoutDraft || input.hasUploadedLayout)) {
      return {
        mode: 'layout_commit',
        confidence: 0.95,
        reasoning: '检测到用户正在确认当前版面草案并准备开始编排。',
        ignoreExistingLayout,
        targetTimeRange,
        semanticLabel,
        programTypeHint,
      }
    }

    if (matchesLayoutAnalysis(normalized)) {
      return {
        mode: 'layout_analysis',
        confidence: 0.94,
        reasoning: '检测到用户想分析当前实际编排效果，应先输出文字版业务分析报告。',
        ignoreExistingLayout,
        targetTimeRange,
        semanticLabel,
        programTypeHint,
      }
    }

    if (matchesLayoutOptimization(normalized)) {
      return {
        mode: 'layout_prepare',
        confidence: 0.9,
        reasoning: '检测到用户想优化当前版面编排，应先生成新的待确认版面草案。',
        ignoreExistingLayout: true,
        targetTimeRange,
        semanticLabel,
        programTypeHint,
        segments: structuredSegments,
      }
    }

    if (input.currentLayoutDraft && matchesLayoutDraftRemove(normalized)) {
      return {
        mode: 'layout_refine',
        confidence: 0.93,
        reasoning: '当前已有版面草案，用户正在删除草案中的某个版面时段，应作为草案微调处理。',
        ignoreExistingLayout,
        targetTimeRange,
        semanticLabel,
        programTypeHint,
      }
    }

    if (looksLikeDirectOrchestrationIntent(normalized)) {
      return {
        mode: 'layout_prepare',
        confidence: 0.92,
        reasoning: '检测到用户正在发起编排或补排流程，按产品规则应先生成可确认的版面草案。',
        ignoreExistingLayout,
        targetTimeRange: targetTimeRange ?? (input.scheduleState.isEmpty ? { start: '06:00:00', end: '23:59:59' } : undefined),
        semanticLabel,
        programTypeHint,
        segments: structuredSegments,
      }
    }

    if (looksLikeAtomicFallback(normalized, { hasContent })) {
      return {
        mode: 'atomic_fallback',
        confidence: 0.9,
        reasoning: '当前输入更像是在调整具体节目条目，但信息还不足以形成可执行的原子命令。',
        ignoreExistingLayout,
        targetTimeRange,
        semanticLabel,
        programTypeHint,
      }
    }

    if (isVagueLayoutRequest(normalized, hasScope, semanticLabel, programTypeHint)) {
      return {
        mode: 'clarify',
        confidence: 0.9,
        reasoning: '检测到版面相关表达，但缺少明确范围或内容偏好，需要补充说明。',
        ignoreExistingLayout,
        targetTimeRange,
        semanticLabel,
        programTypeHint,
      }
    }

    if (
      input.currentLayoutDraft
      && hasContent
      && (matchesLayoutRefineVerb(normalized) || hasScope || normalized.includes('时段') || hasContextualRefineCue)
    ) {
      return {
        mode: 'layout_refine',
        confidence: 0.9,
        reasoning: '当前已有版面草案，本轮输入更像是对草案局部时段的微调。',
        ignoreExistingLayout,
        targetTimeRange,
        semanticLabel,
        programTypeHint,
      }
    }

    if (
      structuredSegments
      && structuredSegments.length >= 2
    ) {
      return {
        mode: 'layout_prepare',
        confidence: 0.93,
        reasoning: '检测到用户正在一次性描述多个时段的版面需求，应先生成多段版面草案。',
        ignoreExistingLayout,
        targetTimeRange: {
          start: structuredSegments[0]!.start,
          end: structuredSegments.at(-1)!.end,
        },
        semanticLabel: structuredSegments[0]?.semanticLabel,
        programTypeHint: structuredSegments[0]?.programTypeHint,
        segments: structuredSegments,
      }
    }

    if (
      hasContent
      && (ignoreExistingLayout || hasScope || matchesLayoutPrepareVerb(normalized) || normalized.includes('版面'))
    ) {
      return {
        mode: 'layout_prepare',
        confidence: 0.88,
        reasoning: '检测到用户在描述新的版面结构要求，应先生成或调整版面草案。',
        ignoreExistingLayout,
        targetTimeRange,
        semanticLabel,
        programTypeHint,
        segments: structuredSegments,
      }
    }

    return {
      mode: 'clarify',
      confidence: 0.3,
      reasoning: '当前输入更像是通用编排、校验或其他指令，不强行解释为版面意图。',
      ignoreExistingLayout,
      targetTimeRange,
      semanticLabel,
      programTypeHint,
      segments: structuredSegments,
    }
  }

  private buildPrompt(input: LayoutIntentRecognizerInput): ChatMessage[] {
    const currentDraftSummary = summarizeDraft(input.currentLayoutDraft)
    const systemPrompt = [
      '你是广播节目版面意图识别器，主要负责识别版面草案相关意图。',
      '如果输入明显更像在调整具体节目条目，但信息不足以直接形成插入、删除、移动、替换命令，请返回 atomic_fallback。',
      '请只在以下模式中选择一个：layout_prepare、layout_refine、layout_commit、layout_analysis、atomic_fallback、clarify。',
      '业务短语是开放的，不要把“下午剧场”“新闻栏目”“城市剧场”这类短语硬套成固定词表，请尽量原样保留到 semanticLabel。',
      '如果用户说“准备一个/制作一份/生成一份”某个时间范围的轮播单、播单、直播单、户外直播单，应理解为 layout_prepare：先生成该时间范围的待确认版面草案。',
      '对户外直播、活动直播、地点直播这类场景，可把 semanticLabel 保留为原始业务短语；若没有更精确类型，programTypeHint 可用 news_magazine。',
      '如果用户说的是节目单、编排单、串联单、特别报道、主题活动、商圈/会场直播、节庆/赛事预热等开放业务话术，只要是在请求排播、生成、补排、调整或分析，都必须映射到已有模式，不要因为栏目词不在固定词表里就放弃。',
      '如果用户明确要求“分析当前版面编排/当前节目单编排”，返回 layout_analysis。',
      '如果用户明确要求“优化当前版面/优化当前编排”，优先返回 layout_prepare，并把 ignoreExistingLayout 设为 true。',
      '如果用户明确表示“不参考当前版面/忽略版面”，请把 ignoreExistingLayout 设为 true。',
      '如果用户只提到了分类标签，比如“电视剧”“新闻”，也要给出 programTypeHint。',
      '如果输入仍然过于模糊，就返回 clarify，不要过度猜测。',
      '如果用户一次性描述了多个时段，请输出 segments 数组，每个元素包含 start、end、semanticLabel、programTypeHint。',
      '只输出 JSON，格式为：{"mode":"layout_prepare","confidence":0.92,"reasoning":"...","ignoreExistingLayout":false,"targetTimeRange":{"start":"13:00:00","end":"18:00:00"},"semanticLabel":"下午剧场","programTypeHint":"drama","segments":[{"start":"06:00:00","end":"12:00:00","semanticLabel":"新闻","programTypeHint":"news"}]}',
    ].join('\n')

    const userPrompt = [
      `频道：${input.scheduleState.channelName} (${input.scheduleState.channelId})`,
      `日期：${input.scheduleState.date}`,
      `当前节目单状态：${input.scheduleState.isEmpty ? '空表' : '已有内容'}`,
      `是否已有上传版面：${input.hasUploadedLayout ? '是' : '否'}`,
      `是否已有频道版面：${input.hasDefaultLayout ? '是' : '否'}`,
      currentDraftSummary,
      `用户输入：${input.userInput}`,
      input.history?.length ? `历史对话：\n${input.history.join('\n')}` : '',
    ].filter(Boolean).join('\n')

    return [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ]
  }

  private parseResponse(content: string): LayoutIntentRecognition | null {
    try {
      const match = content.match(/\{[\s\S]*\}/)
      if (!match) {
        return null
      }
      const parsed = JSON.parse(match[0]) as Partial<LayoutIntentRecognition>
      if (!parsed.mode || !['layout_prepare', 'layout_refine', 'layout_commit', 'layout_analysis', 'atomic_fallback', 'clarify'].includes(parsed.mode)) {
        return null
      }
      return {
        mode: parsed.mode,
        confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
        reasoning: parsed.reasoning || '',
        ignoreExistingLayout: parsed.ignoreExistingLayout === true,
        targetTimeRange: parsed.targetTimeRange,
        semanticLabel: parsed.semanticLabel,
        programTypeHint: parsed.programTypeHint,
        segments: Array.isArray((parsed as { segments?: unknown[] }).segments)
          ? ((parsed as { segments?: LayoutIntentSegment[] }).segments?.filter((segment) => segment?.start && segment?.end) ?? [])
          : undefined,
      }
    } catch {
      return null
    }
  }

  private normalizeContextualDraftRefine(
    input: LayoutIntentRecognizerInput,
    parsed: LayoutIntentRecognition,
  ): LayoutIntentRecognition {
    const normalized = normalizeInput(input.userInput)
    if (
      !['layout_prepare', 'layout_refine'].includes(parsed.mode)
      || !input.currentLayoutDraft
      || !looksLikeContextualDraftRefine(normalized)
      || extractTimeRange(normalized)
    ) {
      return parsed
    }

    return {
      ...parsed,
      mode: 'layout_refine',
      targetTimeRange: {
        start: input.currentLayoutDraft.coverage.start,
        end: input.currentLayoutDraft.coverage.end,
      },
      segments: undefined,
    }
  }

  private mergeRecognitions(
    fallback: LayoutIntentRecognition,
    parsed: LayoutIntentRecognition,
  ): LayoutIntentRecognition {
    const mergedSegments = this.mergeSegments(fallback.segments, parsed.segments)
    const mergedTargetTimeRange = this.resolveMergedTargetTimeRange(
      parsed.targetTimeRange ?? fallback.targetTimeRange,
      mergedSegments,
    )

    if (parsed.confidence >= CONFIDENCE_THRESHOLD) {
      return {
        ...fallback,
        ...parsed,
        targetTimeRange: mergedTargetTimeRange,
        semanticLabel: parsed.semanticLabel ?? fallback.semanticLabel,
        programTypeHint: parsed.programTypeHint ?? fallback.programTypeHint,
        segments: mergedSegments,
        ignoreExistingLayout: parsed.ignoreExistingLayout || fallback.ignoreExistingLayout,
      }
    }

    if (fallback.mode !== 'clarify') {
      return fallback
    }

    return {
      ...parsed,
      targetTimeRange: mergedTargetTimeRange,
      semanticLabel: parsed.semanticLabel ?? fallback.semanticLabel,
      programTypeHint: parsed.programTypeHint ?? fallback.programTypeHint,
      segments: mergedSegments,
      ignoreExistingLayout: parsed.ignoreExistingLayout || fallback.ignoreExistingLayout,
    }
  }

  private mergeSegments(
    fallbackSegments?: LayoutIntentSegment[],
    parsedSegments?: LayoutIntentSegment[],
  ): LayoutIntentSegment[] | undefined {
    if (!fallbackSegments?.length) {
      return parsedSegments?.length ? parsedSegments : undefined
    }
    if (!parsedSegments?.length) {
      return fallbackSegments
    }
    return parsedSegments.length >= fallbackSegments.length ? parsedSegments : fallbackSegments
  }

  private resolveMergedTargetTimeRange(
    targetTimeRange?: LayoutIntentRecognition['targetTimeRange'],
    segments?: LayoutIntentSegment[],
  ): LayoutIntentRecognition['targetTimeRange'] {
    if (!segments?.length) {
      return targetTimeRange
    }
    const ordered = [...segments].sort((left, right) => left.start.localeCompare(right.start))
    return {
      start: ordered[0]!.start,
      end: ordered.at(-1)!.end,
    }
  }
}

let globalLayoutIntentRecognizer: LayoutIntentRecognizer | null = null

export function getLayoutIntentRecognizer(llmClient: LLMClient): LayoutIntentRecognizer {
  if (!globalLayoutIntentRecognizer) {
    globalLayoutIntentRecognizer = new LayoutIntentRecognizer(llmClient)
  }
  return globalLayoutIntentRecognizer
}

export function resetLayoutIntentRecognizer(): void {
  globalLayoutIntentRecognizer = null
}
