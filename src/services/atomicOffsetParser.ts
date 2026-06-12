export interface AtomicOffsetSlot {
  direction: 'forward' | 'backward'
  offsetSeconds: number
}

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
  const text = value.trim().replace(/个$/u, '')
  if (!text) return null
  if (/^\d{1,3}$/.test(text)) return Number(text)
  if (/^[零〇一二两三四五六七八九]$/.test(text)) return CHINESE_DIGIT_MAP[text] ?? null
  if (text === '十') return 10

  const tenIndex = text.indexOf('十')
  if (tenIndex >= 0) {
    const prefix = text.slice(0, tenIndex)
    const suffix = text.slice(tenIndex + 1)
    const tens = prefix ? CHINESE_DIGIT_MAP[prefix] : 1
    const ones = suffix ? CHINESE_DIGIT_MAP[suffix] : 0
    if (typeof tens !== 'number' || typeof ones !== 'number') return null
    return tens * 10 + ones
  }

  return null
}

const directionFromToken = (token: string): AtomicOffsetSlot['direction'] =>
  /前|提前/.test(token) ? 'backward' : 'forward'

export const parseAtomicOffset = (userInput: string): AtomicOffsetSlot | null => {
  const normalized = userInput.replace(/\s+/g, '')
  const halfHourOffsetMatch =
    normalized.match(/(提前|前移|往前挪)半(?:个)?小时/)
    || normalized.match(/(延后|顺延|后移|往后挪|顺一下|顺一个|挪一下)?半(?:个)?小时/)
  if (halfHourOffsetMatch) {
    return {
      direction: directionFromToken(halfHourOffsetMatch[1] ?? ''),
      offsetSeconds: 1800,
    }
  }

  const numberPattern = '(\\d{1,3}|[零〇一二两三四五六七八九十]{1,4}个?)'
  const hourOffsetMatch =
    new RegExp(`([前后])移${numberPattern}(?:个)?小时`).exec(normalized)
    || new RegExp(`往([前后])挪${numberPattern}(?:个)?小时`).exec(normalized)
    || new RegExp(`(提前|延后|顺延)${numberPattern}(?:个)?小时`).exec(normalized)
  if (hourOffsetMatch) {
    const value = parseChineseInteger(hourOffsetMatch[2] ?? '')
    if (!value) return null
    return {
      direction: directionFromToken(hourOffsetMatch[1] ?? ''),
      offsetSeconds: value * 3600,
    }
  }

  const minuteOffsetMatch =
    new RegExp(`([前后])移${numberPattern}分钟`).exec(normalized)
    || new RegExp(`往([前后])挪${numberPattern}分钟`).exec(normalized)
    || new RegExp(`(提前|延后|顺延)${numberPattern}分钟`).exec(normalized)
  if (minuteOffsetMatch) {
    const value = parseChineseInteger(minuteOffsetMatch[2] ?? '')
    if (!value) return null
    return {
      direction: directionFromToken(minuteOffsetMatch[1] ?? ''),
      offsetSeconds: value * 60,
    }
  }

  return null
}
