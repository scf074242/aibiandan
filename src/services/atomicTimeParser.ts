export interface AtomicClockExpression {
  targetTime: string
  matchedText: string
  index: number
}

export interface AtomicTimeRange {
  start: string
  end: string
}

const CLOCK_TOKEN_PATTERN = '(?:\\d{1,2}[:：]\\d{1,2}(?::\\d{1,2})?|(?:\\d{1,2}|[零〇一二两三四五六七八九十]{1,3})(?:点|點)(?:半|一刻|三刻|(?:\\d{1,2}|[零〇一二两三四五六七八九十]{1,3})分?)?)'

const CHINESE_DIGIT_MAP: Record<string, number> = {
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

const parseChineseInteger = (value: string): number | null => {
  const normalized = value.trim().replace(/两/g, '二').replace(/〇/g, '零')
  if (!normalized) return null
  if (/^\d{1,2}$/.test(normalized)) return Number(normalized)
  if (Object.prototype.hasOwnProperty.call(CHINESE_DIGIT_MAP, normalized)) {
    return CHINESE_DIGIT_MAP[normalized]!
  }
  if (normalized === '十') return 10
  const teen = normalized.match(/^十([一二三四五六七八九])$/)
  if (teen) return 10 + CHINESE_DIGIT_MAP[teen[1]!]!
  const tens = normalized.match(/^([一二三四五六七八九])十([一二三四五六七八九])?$/)
  if (tens) return CHINESE_DIGIT_MAP[tens[1]!]! * 10 + (tens[2] ? CHINESE_DIGIT_MAP[tens[2]]! : 0)
  return null
}

const normalizeHourForAtomicContext = (hour: number, input: string): number => {
  const hasMorningCue = /(凌晨|清晨|早间|上午)/.test(input)
  const hasAfternoonCue = /(下午|午后|傍晚|晚间|晚上|夜间|今晚|明晚|黄金时段|黄金档)/.test(input)
  const hasSchedulingCue = /(节目|栏目|编排|节目单|编排单|串联单|播单|编单|排单|轮播单|直播单|当前|这段|那段|这条|那条|这档|那档|草案|版面|档|做|安排|生成|制作|来个|服务|提醒|新闻|直播|活动|专题|排|播|补|删|移|换|插)/.test(input)

  if (hour < 12 && hasAfternoonCue) return hour + 12
  if (hour > 0 && hour <= 5 && hasSchedulingCue && !hasMorningCue) return hour + 12
  if (hour === 12 && hasMorningCue) return 0
  return hour
}

const normalizeClock = (hourValue: number, minuteValue = 0, secondValue = 0): string | null => {
  if (
    Number.isNaN(hourValue)
    || Number.isNaN(minuteValue)
    || Number.isNaN(secondValue)
    || hourValue < 0
    || hourValue > 23
    || minuteValue < 0
    || minuteValue > 59
    || secondValue < 0
    || secondValue > 59
  ) {
    return null
  }
  return `${`${hourValue}`.padStart(2, '0')}:${`${minuteValue}`.padStart(2, '0')}:${`${secondValue}`.padStart(2, '0')}`
}

const parseClockToken = (token: string, fullInput: string): string | null => {
  const colonMatch = token.match(/^(\d{1,2})[:：](\d{1,2})(?::(\d{1,2}))?$/)
  if (colonMatch) {
    const hour = normalizeHourForAtomicContext(Number(colonMatch[1]), fullInput)
    return normalizeClock(hour, Number(colonMatch[2]), Number(colonMatch[3] ?? '00'))
  }

  const pointMatch = token.match(/^(\d{1,2}|[零〇一二两三四五六七八九十]{1,3})(?:点|點)(半|一刻|三刻|(?:(\d{1,2}|[零〇一二两三四五六七八九十]{1,3})分?)?)?$/)
  if (pointMatch) {
    const rawHour = parseChineseInteger(pointMatch[1]!)
    if (rawHour === null) return null
    const hour = normalizeHourForAtomicContext(rawHour, fullInput)
    const rawMinute = pointMatch[2] === '半'
      ? 30
      : pointMatch[2] === '一刻'
        ? 15
        : pointMatch[2] === '三刻'
          ? 45
          : pointMatch[3]
            ? parseChineseInteger(pointMatch[3])
            : 0
    if (rawMinute === null) return null
    return normalizeClock(hour, rawMinute)
  }

  return null
}

const isAmbiguousAmountOnePoint = (normalizedInput: string, token: string, index: number): boolean => {
  if (token !== '一点') return false
  const prefix = normalizedInput.slice(Math.max(0, index - 3), index)
  return /(垫|加|放|上|补|铺|塞|添|来)$/.test(prefix)
}

export const parseAtomicClockExpression = (userInput: string): AtomicClockExpression | null => {
  const normalized = userInput.replace(/\s+/g, '')
  const pattern = new RegExp(CLOCK_TOKEN_PATTERN, 'gu')
  let match: RegExpExecArray | null = null

  while ((match = pattern.exec(normalized)) !== null) {
    if (!match[0] || typeof match.index !== 'number') continue
    if (isAmbiguousAmountOnePoint(normalized, match[0], match.index)) continue
    const targetTime = parseClockToken(match[0], normalized)
    if (!targetTime) continue
    return {
      targetTime,
      matchedText: match[0],
      index: match.index,
    }
  }

  return null
}

export const parseAtomicClockExpressions = (userInput: string, limit = 3): AtomicClockExpression[] => {
  const normalized = userInput.replace(/\s+/g, '')
  const matches: AtomicClockExpression[] = []
  const pattern = new RegExp(CLOCK_TOKEN_PATTERN, 'gu')
  let match: RegExpExecArray | null = null

  while ((match = pattern.exec(normalized)) !== null && matches.length < limit) {
    if (!match[0]) continue
    if (isAmbiguousAmountOnePoint(normalized, match[0], match.index)) continue
    const targetTime = parseClockToken(match[0], normalized)
    if (!targetTime) continue
    matches.push({
      targetTime,
      matchedText: match[0],
      index: match.index,
    })
  }

  return matches
}

export const parseAtomicTimeRange = (userInput: string): AtomicTimeRange | null => {
  const normalized = userInput.replace(/\s+/g, '')
  const match = new RegExp(`(${CLOCK_TOKEN_PATTERN})(?:到|至|[-~—～])(${CLOCK_TOKEN_PATTERN})`, 'u').exec(normalized)
  if (!match?.[1] || !match[2]) return null
  if (isAmbiguousAmountOnePoint(normalized, match[1], match.index)) return null
  const endIndex = match.index + match[0].lastIndexOf(match[2])
  if (isAmbiguousAmountOnePoint(normalized, match[2], endIndex)) return null
  const start = parseClockToken(match[1], normalized)
  const end = parseClockToken(match[2], normalized)
  if (!start || !end || start === end) return null
  return { start, end }
}
