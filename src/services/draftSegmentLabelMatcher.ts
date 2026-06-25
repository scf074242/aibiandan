const normalizeDraftSegmentText = (value: string): string => value.replace(/\s+/g, '').toLowerCase()

const chineseDigitMap: Record<string, number> = {
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

const parseChineseNumberToken = (value: string): string => {
  if (/^\d+$/u.test(value)) return String(Number(value))
  if (value === '十') return '10'
  const tenIndex = value.indexOf('十')
  if (tenIndex >= 0) {
    const left = value.slice(0, tenIndex)
    const right = value.slice(tenIndex + 1)
    const tens = left ? chineseDigitMap[left] ?? 0 : 1
    const ones = right ? chineseDigitMap[right] ?? 0 : 0
    const number = tens * 10 + ones
    return number > 0 ? String(number) : value
  }
  return String(chineseDigitMap[value] ?? value)
}

const extractNumberTokens = (value: string): string[] => {
  const normalized = normalizeDraftSegmentText(value)
  const matches = normalized.match(/\d+|[零〇一二两三四五六七八九十]+/gu) ?? []
  return matches.map(parseChineseNumberToken)
}

const hasDifferentExplicitNumbers = (left: string, right: string): boolean => {
  const leftNumbers = extractNumberTokens(left)
  const rightNumbers = extractNumberTokens(right)
  if (!leftNumbers.length || !rightNumbers.length) return false
  return leftNumbers.join('|') !== rightNumbers.join('|')
}

export const draftSegmentTextMatches = (candidate: string | undefined, query: string | undefined): boolean => {
  if (!candidate || !query) return false
  const normalizedCandidate = normalizeDraftSegmentText(candidate)
  const normalizedQuery = normalizeDraftSegmentText(query)
  if (!normalizedCandidate || !normalizedQuery) return false
  if (normalizedCandidate === normalizedQuery) return true
  if (hasDifferentExplicitNumbers(normalizedCandidate, normalizedQuery)) return false
  return normalizedCandidate.includes(normalizedQuery) || normalizedQuery.includes(normalizedCandidate)
}

export const draftSegmentPartsMatch = (parts: Array<string | undefined>, query: string | undefined): boolean => {
  if (!query) return false
  const normalizedParts = parts
    .filter((part): part is string => Boolean(part?.trim()))
    .map(normalizeDraftSegmentText)
  const normalizedQuery = normalizeDraftSegmentText(query)
  if (!normalizedParts.length || !normalizedQuery) return false
  if (normalizedParts.some((part) => part === normalizedQuery)) return true
  if (normalizedParts.some((part) => hasDifferentExplicitNumbers(part, normalizedQuery))) return false
  return normalizedParts.some((part) => part.includes(normalizedQuery) || normalizedQuery.includes(part))
}
