import { parseAtomicClockExpression, parseAtomicClockExpressions, parseAtomicTimeRange } from './atomicTimeParser'

const DAYPART_KEYWORDS = [
  '全天',
  '整天',
  '全日',
  '上午',
  '中午',
  '午间',
  '下午',
  '晚间',
  '晚上',
  '夜间',
  '深夜',
  '凌晨',
  '早间',
  '清晨',
  '白天',
  '黄金时段',
  '黄金档',
  '早高峰',
  '午高峰',
  '晚高峰',
  '工作日',
  '周一',
  '周二',
  '周三',
  '周四',
  '周五',
  '周六',
  '周日',
  '周末',
  '今晚',
  '明晚',
  '今天',
  '明天',
  '午后',
  '傍晚',
  '七点档',
  '八点档',
  '节前',
  '节后',
  '开播前',
  '开播后',
  '开场前',
  '开场后',
  '赛前',
  '赛后',
  '会前',
  '会后',
  '前后',
  '春节',
  '国庆',
  '暑期',
]

const DOMAIN_TARGET_KEYWORDS = [
  '节目',
  '节目单',
  '编排单',
  '当前编排',
  '编排问题',
  '串联单',
  '编单',
  '播单',
  '排单',
  '节目表',
  '单子',
  '轮播单',
  '直播单',
  '版面',
  '栏目',
  '时段',
  '时隙',
  '档期',
  '空窗',
  '空缺',
  '空档',
  '空白时段',
  '播出',
  '播放',
  '排播',
  '直播',
  '轮播',
  '重播',
  '首播',
  '插播',
]

const SCHEDULING_VERBS = [
  '安排',
  '编排',
  '排',
  '排个',
  '排一下',
  '排一版',
  '排一份',
  '排一个',
  '排入',
  '编入',
  '生成',
  '创建',
  '准备',
  '制作',
  '做',
  '做一份',
  '做一个',
  '做成',
  '来个',
  '来',
  '来一版',
  '来一份',
  '来一段',
  '搞一版',
  '搞一份',
  '搞一个',
  '弄一版',
  '弄一份',
  '弄一个',
  '补',
  '补齐',
  '补全',
  '补排',
  '补上',
  '补点',
  '加点',
  '加个',
  '加一点',
  '加一些',
  '加一段',
  '加一条',
  '上点',
  '上一段',
  '放点',
  '放一段',
  '垫点',
  '垫个',
  '垫一点',
  '垫一段',
  '垫一条',
  '串一下',
  '串场',
  '衔接',
  '过渡',
  '收个',
  '收一段',
  '收尾',
  '填充',
  '填满',
  '塞满',
  '铺',
  '铺排',
  '优化',
  '调整',
  '改成',
  '换成',
  '插入',
  '删除',
  '移动',
  '校验',
  '检查',
  '核对',
  '审查',
  '分析',
  '修复',
]

const CONTENT_OR_SCENARIO_KEYWORDS = [
  '新闻',
  '资讯',
  '专题',
  '特别报道',
  '快讯',
  '评论',
  '访谈',
  '民生',
  '电视剧',
  '剧场',
  '综艺',
  '娱乐',
  '健康',
  '养生',
  '少儿',
  '动画',
  '纪录片',
  '纪实',
  '电影',
  '直播',
  '户外',
  '现场',
  '活动',
  '会场',
  '商圈',
  '赛事',
  '节庆',
  '进博会',
  '晚会',
  '开幕式',
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
  '轻松',
  '开播',
  '开播前',
  '开场',
  '赛前',
  '赛后',
  '会前',
  '会后',
  '收尾',
  '特别策划',
  '主题',
  '亲子',
  '露营',
  '公益',
  '宣传',
  '文旅',
  '城市服务',
  '交通',
  '天气',
  '服务',
  '提醒',
  '消费',
  '社区',
  '商场',
  '商业',
  '应急',
  '发布会',
  '展会',
  '论坛',
  '峰会',
  '庆典',
  '开业',
  '演出',
  '外场',
  '地点',
  '问题',
  '冲突',
  '风险',
  '顺序',
  '播出顺序',
]

const SCHEDULING_PREFERENCE_PATTERNS = [
  /以.+为主/,
  /主打/,
  /围绕/,
  /侧重/,
  /偏.+一点/,
  /多一点/,
  /多一些/,
  /轻松.+一点/,
  /集中.+播/,
  /集中.+放/,
  /突出/,
]

const NON_SCHEDULING_PHRASES = [
  '下单排单',
  '订单排单',
  '工单排单',
]

const NON_SCHEDULING_CONTEXT_KEYWORDS = [
  '文案',
  '会议纪要',
  '例会',
  '页面',
  '按钮',
  '背景',
  '材料',
  '攻略',
  '咖啡',
  '信号',
  '滤镜',
  '字幕',
  '标题',
]

const PROTECTED_DAYPART_PATTERN = '(?:全天|整天|全日|上午|中午|午间|下午|晚间|晚上|夜间|深夜|凌晨|早间|清晨|白天|傍晚|早高峰|午高峰|晚高峰|黄金时段|黄金档|七点档|八点档)'

export interface SchedulingTimeRange {
  start: string
  end: string
}

export function normalizeSchedulingText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, '')
}

const isProtectedSchedulingClause = (part: string): boolean => {
  const hasProtectedVerb = /(保留|保持|沿用|不动|别动|不要动|先别动|先不动)/.test(part)
  const hasDaypart = new RegExp(PROTECTED_DAYPART_PATTERN).test(part)
  return hasProtectedVerb && hasDaypart
}

export function stripProtectedSchedulingClauses(value: string): string {
  const input = normalizeSchedulingText(value)
  const splitParts = input.split(/([，,；;、])/)
  const filtered = splitParts
    .filter((part) => !isProtectedSchedulingClause(part))
    .join('')

  return filtered
    .replace(new RegExp(`(?:保留|保持|沿用)(?:现有|已有|当前)?${PROTECTED_DAYPART_PATTERN}(?:节目|内容|版面|时段)?`, 'gu'), '')
    .replace(new RegExp(`${PROTECTED_DAYPART_PATTERN}(?:节目|内容|版面|时段)?(?:保留|保持|沿用|不动|别动|不要动|先别动|先不动)`, 'gu'), '')
}

const normalizeClock = (hourValue: string | number, minuteValue: string | number = '00'): string => {
  const hour = Math.max(0, Math.min(23, Number(hourValue)))
  const minute = Math.max(0, Math.min(59, Number(minuteValue)))
  return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}:00`
}

const normalizeClockFromSeconds = (totalSeconds: number): string => {
  const clamped = Math.max(0, Math.min(86399, Math.round(totalSeconds)))
  const hour = Math.floor(clamped / 3600)
  const minute = Math.floor((clamped % 3600) / 60)
  const second = clamped % 60
  return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}:${second.toString().padStart(2, '0')}`
}

const clockToSeconds = (hourValue: string | number, minuteValue: string | number = '00'): number => {
  const hour = Math.max(0, Math.min(23, Number(hourValue)))
  const minute = Math.max(0, Math.min(59, Number(minuteValue)))
  return hour * 3600 + minute * 60
}

const clockTextToSeconds = (clockText: string): number => {
  const [hours = 0, minutes = 0, seconds = 0] = clockText.split(':').map(Number)
  return hours * 3600 + minutes * 60 + seconds
}

const normalizeHourForContext = (hour: number, input: string): number => {
  const hasMorningCue = /(凌晨|清晨|早间|上午)/.test(input)
  const hasExplicitAfternoonOrEveningCue = /(下午|午后|傍晚|晚间|晚上|夜间|今晚|明晚|黄金时段|黄金档|七点档|八点档)/.test(input)
  const hasSchedulingCue =
    CONTENT_OR_SCENARIO_KEYWORDS.some((keyword) => input.includes(keyword))
    || DOMAIN_TARGET_KEYWORDS.some((keyword) => input.includes(keyword))

  if (
    hour < 12
    && hasExplicitAfternoonOrEveningCue
  ) {
    return hour + 12
  }
  if (hour > 0 && hour <= 5 && hasSchedulingCue && !hasMorningCue) {
    return hour + 12
  }
  if (hour === 12 && hasMorningCue) {
    return 0
  }
  return hour
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
  if (normalized === '十') {
    return 10
  }
  const teen = normalized.match(/^十([一二三四五六七八九])$/)
  if (teen) {
    return 10 + digits[teen[1]!]!
  }
  const tens = normalized.match(/^([一二])十([一二三四五六七八九])?$/)
  if (tens) {
    return digits[tens[1]!]! * 10 + (tens[2] ? digits[tens[2]]! : 0)
  }
  const largeTens = normalized.match(/^([三四五六七八九])十([一二三四五六七八九])?$/)
  if (largeTens) {
    return digits[largeTens[1]!]! * 10 + (largeTens[2] ? digits[largeTens[2]]! : 0)
  }
  return null
}

const parseChineseHour = (value: string): number | null => parseChineseNumber(value)

const parseDurationSeconds = (value: string): number | null => {
  if (/一刻钟/.test(value)) {
    return 15 * 60
  }
  if (/三刻钟/.test(value)) {
    return 45 * 60
  }

  const oneAndHalfHourMatch =
    value.match(/(?:(\d+(?:\.\d+)?)|([零〇一二两三四五六七八九十]{1,3}))(?:个)?半小时/)
    || value.match(/(?:(\d+(?:\.\d+)?)|([零〇一二两三四五六七八九十]{1,3}))(?:个)?小时半/)
  if (oneAndHalfHourMatch) {
    const hourCount = oneAndHalfHourMatch[1] ? Number(oneAndHalfHourMatch[1]) : parseChineseNumber(oneAndHalfHourMatch[2]!)
    return hourCount && hourCount > 0 ? Math.round((hourCount + 0.5) * 3600) : null
  }

  if (/半小时|半个小时/.test(value)) {
    return 30 * 60
  }

  const hourMatch = value.match(/(?:(\d+(?:\.\d+)?)|([零〇一二两三四五六七八九十]{1,3}))(?:个)?小时/)
  if (hourMatch) {
    const hourCount = hourMatch[1] ? Number(hourMatch[1]) : parseChineseNumber(hourMatch[2]!)
    return hourCount && hourCount > 0 ? Math.round(hourCount * 3600) : null
  }

  const minuteMatch = value.match(/(?:(\d+)|([零〇一二两三四五六七八九十]{1,3}))分钟/)
  if (minuteMatch) {
    const minuteCount = minuteMatch[1] ? Number(minuteMatch[1]) : parseChineseNumber(minuteMatch[2]!)
    return minuteCount && minuteCount > 0 ? minuteCount * 60 : null
  }

  return null
}

const buildStartDurationRange = (
  rawHour: number | null,
  minuteValue: string | number,
  durationText: string,
  input: string,
): SchedulingTimeRange | undefined => {
  if (rawHour === null) return undefined
  const durationSeconds = parseDurationSeconds(durationText)
  if (!durationSeconds) return undefined

  const startHour = normalizeHourForContext(rawHour, input)
  const startSeconds = clockToSeconds(startHour, minuteValue)
  return {
    start: normalizeClockFromSeconds(startSeconds),
    end: normalizeClockFromSeconds(startSeconds + durationSeconds),
  }
}

const parseLooseStartEndTimeRange = (input: string): SchedulingTimeRange | undefined => {
  const [start, end] = parseAtomicClockExpressions(input, 2)
  if (!start || !end) return undefined

  const between = input.slice(start.index + start.matchedText.length, end.index)
  const afterEnd = input.slice(end.index + end.matchedText.length, end.index + end.matchedText.length + 8)
  const hasRangeConnector = /(到|至|直到|一直到|持续到|排到|播到|做到|收到)/.test(between)
  const hasStartEndCue = /(开始|起播|开播|起|从|自)/.test(between)
    && /(结束|截止|截至|收尾|为止|止)/.test(afterEnd)
  if (!hasRangeConnector && !hasStartEndCue) return undefined

  const startSeconds = clockTextToSeconds(start.targetTime)
  const endSeconds = clockTextToSeconds(end.targetTime)
  if (endSeconds <= startSeconds) return undefined

  return {
    start: start.targetTime,
    end: end.targetTime,
  }
}

const parseSingleAnchorTimeRange = (input: string): SchedulingTimeRange | undefined => {
  const anchor = parseAtomicClockExpression(input)
  if (!anchor) return undefined

  const beforeAnchor = input.slice(Math.max(0, anchor.index - 8), anchor.index)
  const afterAnchor = input.slice(anchor.index + anchor.matchedText.length, anchor.index + anchor.matchedText.length + 8)
  const hasAnchorCue = /(左右|前后|附近|开始|起播|开播|起|以后|之后|往后|后|从|自)/.test(`${beforeAnchor}${afterAnchor}`)
  if (!hasAnchorCue) return undefined

  const hasDomainTarget = DOMAIN_TARGET_KEYWORDS.some((keyword) => input.includes(keyword))
  const hasSchedulingVerb = SCHEDULING_VERBS.some((keyword) => input.includes(keyword))
  const hasContentOrScenario = CONTENT_OR_SCENARIO_KEYWORDS.some((keyword) => input.includes(keyword))
  const asksForOutput = /(请|给我|给|帮我|帮忙|麻烦|我要|需要|想要|来个|来一份|来一版|出一份|出一个|做个|做份|做一版|搞个|搞一版|搞一份|弄个|弄一版|弄一份)/.test(input)
  if (!(hasContentOrScenario && (hasSchedulingVerb || hasDomainTarget || asksForOutput))) {
    return undefined
  }

  const startSeconds = clockTextToSeconds(anchor.targetTime)
  return {
    start: anchor.targetTime,
    end: normalizeClockFromSeconds(startSeconds + 60 * 60),
  }
}

export function parseSchedulingTimeRange(value: string): SchedulingTimeRange | undefined {
  const input = stripProtectedSchedulingClauses(value)

  const colonRange = input.match(/(^|[^\d])(\d{1,2}):(\d{2})(?:到|至|-|—|~|～)(\d{1,2}):(\d{2})(?!\d)/)
  if (colonRange) {
    return {
      start: normalizeClock(colonRange[2]!, colonRange[3]!),
      end: normalizeClock(colonRange[4]!, colonRange[5]!),
    }
  }

  const atomicRange = parseAtomicTimeRange(input)
  if (atomicRange) {
    return atomicRange
  }

  const looseStartEndRange = parseLooseStartEndTimeRange(input)
  if (looseStartEndRange) {
    return looseStartEndRange
  }

  const numericRange = input.match(/(^|[^\d])(\d{1,2})(?::(\d{1,2}))?(点半|点|點)?(?:到|至|-|—|~|～)(\d{1,2})(?::(\d{1,2}))?(点半|点|點)?/)
  if (numericRange) {
    const startHour = normalizeHourForContext(Number(numericRange[2]!), input)
    const endHour = normalizeHourForContext(Number(numericRange[5]!), input)
    return {
      start: normalizeClock(startHour, numericRange[4] === '点半' ? '30' : (numericRange[3] ?? '00')),
      end: normalizeClock(endHour, numericRange[7] === '点半' ? '30' : (numericRange[6] ?? '00')),
    }
  }

  const chineseRange = input.match(/([零〇一二两三四五六七八九十]{1,3})(点半|点|點)(?:到|至|-|—|~|～)([零〇一二两三四五六七八九十]{1,3})(点半|点|點)?/)
  if (chineseRange) {
    const rawStartHour = parseChineseHour(chineseRange[1]!)
    const rawEndHour = parseChineseHour(chineseRange[3]!)
    if (rawStartHour !== null && rawEndHour !== null) {
      return {
        start: normalizeClock(normalizeHourForContext(rawStartHour, input), chineseRange[2] === '点半' ? '30' : '00'),
        end: normalizeClock(normalizeHourForContext(rawEndHour, input), chineseRange[4] === '点半' ? '30' : '00'),
      }
    }
  }

  const durationToken = '(?:一刻钟|三刻钟|(?:(?:\\d+(?:\\.\\d+)?)|[零〇一二两三四五六七八九十]{1,3})(?:个)?半小时|(?:(?:\\d+(?:\\.\\d+)?)|[零〇一二两三四五六七八九十]{1,3})(?:个)?小时半|半个?小时|(?:(?:\\d+(?:\\.\\d+)?)|[零〇一二两三四五六七八九十]{1,3})(?:个)?小时|(?:(?:\\d+)|[零〇一二两三四五六七八九十]{1,3})分钟)'
  const atomicStart = parseAtomicClockExpression(input)
  if (atomicStart) {
    const afterStart = input.slice(atomicStart.index + atomicStart.matchedText.length)
    const durationAfterStart = new RegExp(`^(?:开始|起|起播|开播|往后|之后|以后)?[\\s\\S]{0,16}?(${durationToken})`).exec(afterStart)
    const durationSeconds = durationAfterStart?.[1] ? parseDurationSeconds(durationAfterStart[1]) : null
    if (durationSeconds) {
      const startSeconds = clockTextToSeconds(atomicStart.targetTime)
      return {
        start: atomicStart.targetTime,
        end: normalizeClockFromSeconds(startSeconds + durationSeconds),
      }
    }

    const beforeStart = input.slice(0, atomicStart.index)
    const durationBeforeStart = new RegExp(`(${durationToken})[\\s\\S]{0,24}$`).exec(beforeStart)
    const durationBeforeSeconds = durationBeforeStart?.[1] ? parseDurationSeconds(durationBeforeStart[1]) : null
    if (durationBeforeSeconds) {
      const startSeconds = clockTextToSeconds(atomicStart.targetTime)
      return {
        start: atomicStart.targetTime,
        end: normalizeClockFromSeconds(startSeconds + durationBeforeSeconds),
      }
    }
  }

  const numericStartDuration = input.match(new RegExp(`(?:^|[^\\d])(\\d{1,2})(?:[:：](\\d{1,2})|点半|点(?:(\\d{1,2})分?)?)?(?:开始|起|起播|开播|往后|之后|以后)?[\\s\\S]{0,16}?(${durationToken})`))
  if (numericStartDuration && (numericStartDuration[2] || numericStartDuration[3] || input.includes(`${numericStartDuration[1]}点`))) {
    const range = buildStartDurationRange(
      Number(numericStartDuration[1]!),
      numericStartDuration[0].includes('点半') ? '30' : (numericStartDuration[2] ?? numericStartDuration[3] ?? '00'),
      numericStartDuration[4]!,
      input,
    )
    if (range) return range
  }

  const chineseStartDuration = input.match(new RegExp(`([零〇一二两三四五六七八九十]{1,3})(点半|点|點)(?:开始|起|起播|开播|往后|之后|以后)?[\\s\\S]{0,16}?(${durationToken})`))
  if (chineseStartDuration) {
    const range = buildStartDurationRange(
      parseChineseHour(chineseStartDuration[1]!),
      chineseStartDuration[2] === '点半' ? '30' : '00',
      chineseStartDuration[3]!,
      input,
    )
    if (range) return range
  }

  const singleAnchorRange = parseSingleAnchorTimeRange(input)
  if (singleAnchorRange) {
    return singleAnchorRange
  }

  if (input.includes('全天') || input.includes('整天') || input.includes('全日')) {
    return { start: '06:00:00', end: '23:59:59' }
  }
  if (input.includes('早高峰')) {
    return { start: '07:00:00', end: '09:00:00' }
  }
  if (input.includes('午高峰')) {
    return { start: '11:30:00', end: '13:30:00' }
  }
  if (input.includes('晚高峰')) {
    return { start: '17:00:00', end: '19:00:00' }
  }
  if (input.includes('黄金时段') || input.includes('黄金档') || input.includes('七点档')) {
    return { start: '19:00:00', end: '20:00:00' }
  }
  if (input.includes('八点档')) {
    return { start: '20:00:00', end: '21:00:00' }
  }
  if (input.includes('早间') || input.includes('清晨')) {
    return { start: '06:00:00', end: '09:00:00' }
  }
  if (input.includes('上午')) {
    return { start: '06:00:00', end: '12:00:00' }
  }
  if (input.includes('中午') || input.includes('午间')) {
    return { start: '12:00:00', end: '14:00:00' }
  }
  if (input.includes('下午') || input.includes('午后')) {
    return { start: '13:00:00', end: '18:00:00' }
  }
  if (input.includes('傍晚')) {
    return { start: '17:00:00', end: '19:00:00' }
  }
  if (input.includes('晚间') || input.includes('晚上') || input.includes('夜间')) {
    return { start: '18:00:00', end: '23:00:00' }
  }
  if (input.includes('深夜') || input.includes('凌晨')) {
    return { start: '23:00:00', end: '23:59:59' }
  }

  return undefined
}

export function hasExplicitSchedulingTime(value: string): boolean {
  const input = normalizeSchedulingText(value)
  return Boolean(parseSchedulingTimeRange(input))
    || DAYPART_KEYWORDS.some((keyword) => input.includes(keyword))
}

export function looksLikeProgramSchedulingRequest(value: string): boolean {
  const input = normalizeSchedulingText(value)
  if (!input) return false
  if (NON_SCHEDULING_PHRASES.some((keyword) => input.includes(keyword))) return false
  if (NON_SCHEDULING_CONTEXT_KEYWORDS.some((keyword) => input.includes(keyword))) return false

  const hasDomainTarget = DOMAIN_TARGET_KEYWORDS.some((keyword) => input.includes(keyword))
  const hasSchedulingVerb = SCHEDULING_VERBS.some((keyword) => input.includes(keyword))
  const hasContentOrScenario = CONTENT_OR_SCENARIO_KEYWORDS.some((keyword) => input.includes(keyword))
  const hasTime = hasExplicitSchedulingTime(input)
  const asksForOutput = /(请|给我|给|帮我|帮忙|麻烦|我要|需要|想要|来个|来一份|来一版|出一份|出一个|做个|做份|搞个|搞一版|搞一份|弄个|弄一版|弄一份)/.test(input)
  const hasSchedulingPreference = SCHEDULING_PREFERENCE_PATTERNS.some((pattern) => pattern.test(input))

  if (hasDomainTarget && (hasSchedulingVerb || hasTime || hasContentOrScenario || asksForOutput)) {
    return true
  }

  if (hasTime && hasContentOrScenario && hasSchedulingPreference) {
    return true
  }

  if (hasSchedulingVerb && hasTime && hasContentOrScenario) {
    return true
  }

  if (asksForOutput && hasTime && hasContentOrScenario) {
    return true
  }

  return false
}
