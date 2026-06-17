import type { ScheduleItemSnapshot } from '@/types/orchestration'

export interface SequenceMoveViolation {
  message: string
  type: 'reverse_order' | 'sequence_gap' | 'duplicate_episode'
}

export const detectMovingItemSequenceViolation = (
  proposedItem: ScheduleItemSnapshot,
  existingItems: ScheduleItemSnapshot[],
  actionLabel = '调整',
): SequenceMoveViolation | null => {
  const proposedSeriesKeys = buildSeriesKeys(proposedItem.programName, proposedItem.programCode)
  const proposedSequence = extractSequenceNo(proposedItem)
  if (proposedSeriesKeys.size === 0 || typeof proposedSequence !== 'number') {
    return null
  }

  const proposedStartMs = new Date(proposedItem.startTime).getTime()
  const proposedEndMs = new Date(proposedItem.endTime).getTime()
  if (!Number.isFinite(proposedStartMs) || !Number.isFinite(proposedEndMs)) {
    return null
  }

  for (const item of existingItems) {
    if (item.id === proposedItem.id) continue

    const itemSeriesKeys = buildSeriesKeys(item.programName, item.programCode)
    if (!hasSharedSeriesKey(proposedSeriesKeys, itemSeriesKeys)) continue

    const itemSequence = extractSequenceNo(item)
    if (typeof itemSequence !== 'number') continue

    const itemStartMs = new Date(item.startTime).getTime()
    const itemEndMs = new Date(item.endTime).getTime()
    if (!Number.isFinite(itemStartMs) || !Number.isFinite(itemEndMs)) continue

    if (proposedSequence === itemSequence) {
      return {
        type: 'duplicate_episode',
        message: `${actionLabel}会造成顺播重复：${toClock(item.startTime)} 已有第${itemSequence}集，不能在 ${toClock(proposedItem.startTime)} 再安排同一集。`,
      }
    }

    if (proposedStartMs < itemStartMs && proposedSequence > itemSequence) {
      return {
        type: 'reverse_order',
        message: `${actionLabel}会造成顺播倒序：不能在 ${toClock(proposedItem.startTime)} 安排第${proposedSequence}集，后面 ${toClock(item.startTime)} 已有第${itemSequence}集。`,
      }
    }
    if (proposedStartMs >= itemEndMs && proposedSequence < itemSequence) {
      return {
        type: 'reverse_order',
        message: `${actionLabel}会造成顺播倒序：前面 ${toClock(item.startTime)} 已有第${itemSequence}集，不能在 ${toClock(proposedItem.startTime)} 安排第${proposedSequence}集。`,
      }
    }
    if (proposedStartMs >= itemEndMs && proposedSequence > itemSequence + 1) {
      return {
        type: 'sequence_gap',
        message: `${actionLabel}会造成顺播跳集：前面 ${toClock(item.startTime)} 已有第${itemSequence}集，不能直接在 ${toClock(proposedItem.startTime)} 安排第${proposedSequence}集。`,
      }
    }
    if (proposedStartMs < itemStartMs && proposedSequence + 1 < itemSequence) {
      return {
        type: 'sequence_gap',
        message: `${actionLabel}会造成顺播跳集：后面 ${toClock(item.startTime)} 已有第${itemSequence}集，不能在 ${toClock(proposedItem.startTime)} 只补到第${proposedSequence}集。`,
      }
    }
  }

  return null
}

const buildSeriesKeys = (programName?: string, programCode?: string): Set<string> => {
  const keys = new Set<string>()
  const normalizedName = normalizeSeriesName(programName)
  if (normalizedName) {
    keys.add(`name:${normalizedName}`)
  }
  const normalizedCode = normalizeSeriesCode(programCode)
  if (normalizedCode) {
    keys.add(`code:${normalizedCode}`)
  }
  return keys
}

const hasSharedSeriesKey = (left: Set<string>, right: Set<string>): boolean => {
  for (const key of left) {
    if (right.has(key)) return true
  }
  return false
}

const normalizeSeriesCode = (programCode?: string): string =>
  isSequentialProgramCode(programCode) ? programCode!.replace(/\d{1,4}$/, '') : ''

const normalizeSeriesName = (programName?: string): string => {
  if (!programName) return ''
  return programName
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/^[^:：]+[:：]/u, '')
    .replace(/第\s*[0-9零〇一二两三四五六七八九十百]+\s*[集期]/gu, '')
    .replace(/[上中下][集期]/gu, '')
    .replace(/[《》“”"'（）()[\]·、。；;:：\-—_/\\|~～]+/g, '')
}

const extractSequenceNo = (item: ScheduleItemSnapshot): number | null => {
  const issueNo = 'issueNo' in item && typeof item.issueNo === 'string'
    ? parsePositiveNumber(item.issueNo)
    : null
  if (issueNo !== null) return issueNo

  const text = item.programName ?? ''
  const nameMatch = text.match(/第\s*([0-9零〇一二两三四五六七八九十百]+)\s*[集期]/u)
  if (nameMatch) {
    return parseChineseNumber(nameMatch[1]!)
  }

  const codeMatch = isSequentialProgramCode(item.programCode)
    ? item.programCode!.match(/(\d{1,4})$/)
    : null
  if (codeMatch) {
    const parsed = Number(codeMatch[1])
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed
    }
  }

  return null
}

const parsePositiveNumber = (value?: string): number | null => {
  if (!value) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

const isSequentialProgramCode = (programCode?: string): boolean =>
  Boolean(programCode && /^\d{8,}$/.test(programCode))

const parseChineseNumber = (value: string): number | null => {
  const normalized = value.trim()
  const direct = Number(normalized)
  if (Number.isFinite(direct) && direct > 0) return direct

  const digits: Record<string, number> = {
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
  if (normalized === '十') return 10

  const hundredIndex = normalized.indexOf('百')
  if (hundredIndex >= 0) {
    const high = hundredIndex === 0 ? 1 : digits[normalized[hundredIndex - 1]!] ?? 0
    const rest = normalized.slice(hundredIndex + 1)
    const restValue = rest ? parseChineseNumber(rest) ?? 0 : 0
    return high * 100 + restValue
  }

  const tenIndex = normalized.indexOf('十')
  if (tenIndex >= 0) {
    const high = tenIndex === 0 ? 1 : digits[normalized[tenIndex - 1]!] ?? 0
    const low = digits[normalized[tenIndex + 1]!] ?? 0
    return high * 10 + low
  }

  const parsed = normalized.split('').reduce((sum, char) => sum * 10 + (digits[char] ?? 0), 0)
  return parsed > 0 ? parsed : null
}

const toClock = (value: string): string =>
  value.includes('T') ? (value.split('T')[1]?.slice(0, 8) ?? value) : value
