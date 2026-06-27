import { orchestrationDemoColumns } from '@/mock/orchestrationMock'
import { parseDraftConstraintText } from '@/services/retrievalConstraintCompiler'
import type { ColumnDefinition, LayoutReference, LayoutSlot } from '@/types/orchestration'

export type LayoutTemplateMode = 'weekday_columns' | 'weekday_sheet' | 'visual_weekday_grid'

type WeekdayKey =
  | 'monday'
  | 'tuesday'
  | 'wednesday'
  | 'thursday'
  | 'friday'
  | 'saturday'
  | 'sunday'

type ParsedHeaderMap = {
  startTime?: number
  endTime?: number
  timeRange?: number
  columnName?: number
  programType?: number
  remark?: number
}

type ParsedLayoutRow = {
  startTime: string
  endTime: string
  startDayOffset?: number
  endDayOffset?: number
  columnName: string
  columnId?: string
  draftConstraintKind?: ColumnDefinition['draftConstraintKind']
  programType?: string
  remark?: string
}

type ParsedSheetMeta = {
  headerIndex: number
  headerMap: ParsedHeaderMap
  weekdayColumns: Partial<Record<WeekdayKey, number>>
}

type WeekdayDefinition = {
  key: WeekdayKey
  dayOfWeek: number
  shortLabel: string
  aliases: string[]
}

type ImportedSheetSelection = {
  sheetName: string
  templateMode: LayoutTemplateMode
  parsedRows: ParsedLayoutRow[]
  matchedWeekday?: WeekdayDefinition
  matchedColumnLabel?: string
  warnings: string[]
}

type TimelineDefinition = {
  anchors: Array<{
    row: number
    absoluteMinutes: number
  }>
}

type LayoutNameResolution = {
  displayName: string
  matchedColumn?: ColumnDefinition
  constraintKind?: ColumnDefinition['draftConstraintKind']
}

export interface ImportedLayoutPackage {
  sourceFileName: string
  channelId: string
  date: string
  warnings: string[]
  layoutReference: LayoutReference
  columns: ColumnDefinition[]
  templateMode: LayoutTemplateMode
  matchedSheetName?: string
  matchedWeekday?: WeekdayKey
  matchedWeekdayLabel?: string
  matchedColumnLabel?: string
}

const HEADER_ALIASES = {
  startTime: ['开始时间', '起始时间', '开始', '播出开始', 'starttime', 'start'],
  endTime: ['结束时间', '截止时间', '结束', '播出结束', 'endtime', 'end'],
  timeRange: ['时段', '时间段', '播出时段', 'time', 'timerange'],
  columnName: ['栏目', '栏目名称', '版面栏目', '栏目带', '带名', '节目带'],
  programType: ['节目类型', '类型', '内容类型', 'programtype', 'type'],
  remark: ['备注', '说明', 'remark', 'note'],
} as const

const WEEKDAY_DEFINITIONS: WeekdayDefinition[] = [
  { key: 'monday', dayOfWeek: 1, shortLabel: '周一', aliases: ['周一', '星期一', '礼拜一', 'monday', 'mon'] },
  { key: 'tuesday', dayOfWeek: 2, shortLabel: '周二', aliases: ['周二', '星期二', '礼拜二', 'tuesday', 'tue'] },
  { key: 'wednesday', dayOfWeek: 3, shortLabel: '周三', aliases: ['周三', '星期三', '礼拜三', 'wednesday', 'wed'] },
  { key: 'thursday', dayOfWeek: 4, shortLabel: '周四', aliases: ['周四', '星期四', '礼拜四', 'thursday', 'thu'] },
  { key: 'friday', dayOfWeek: 5, shortLabel: '周五', aliases: ['周五', '星期五', '礼拜五', 'friday', 'fri'] },
  { key: 'saturday', dayOfWeek: 6, shortLabel: '周六', aliases: ['周六', '星期六', '礼拜六', 'saturday', 'sat'] },
  { key: 'sunday', dayOfWeek: 0, shortLabel: '周日', aliases: ['周日', '周天', '星期日', '星期天', '礼拜日', '礼拜天', 'sunday', 'sun'] },
]

const KNOWN_COLUMN_MATCHERS = orchestrationDemoColumns.map((column) => ({
  column,
  normalized: normalizeHeader(column.columnName),
}))

const TIME_RANGE_SPLIT_PATTERN = /\s*[-~—－到至]+\s*/

function normalizeHeader(value: unknown) {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, '')
    .replace(/[：:]/g, '')
    .toLowerCase()
}

function normalizeText(value: unknown) {
  return String(value ?? '').trim()
}

function formatMinutesToTime(totalMinutes: number) {
  const normalizedMinutes = ((Math.round(totalMinutes) % (24 * 60)) + 24 * 60) % (24 * 60)
  const hours = Math.floor(normalizedMinutes / 60)
  const minutes = normalizedMinutes % 60
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`
}

function shiftDate(date: string, dayOffset = 0) {
  const [rawYear = 1970, rawMonth = 1, rawDay = 1] = date.split('-').map((item) => Number(item))
  const year = Number.isFinite(rawYear) ? rawYear : 1970
  const month = Number.isFinite(rawMonth) ? rawMonth : 1
  const day = Number.isFinite(rawDay) ? rawDay : 1
  const shifted = new Date(Date.UTC(year, month - 1, day + dayOffset))
  const shiftedYear = shifted.getUTCFullYear()
  const shiftedMonth = String(shifted.getUTCMonth() + 1).padStart(2, '0')
  const shiftedDay = String(shifted.getUTCDate()).padStart(2, '0')
  return `${shiftedYear}-${shiftedMonth}-${shiftedDay}`
}

function buildIso(date: string, timeText: string, dayOffset = 0) {
  return `${shiftDate(date, dayOffset)}T${timeText}+08:00`
}

function padTime(value: string) {
  const parts = value.split(':').map((part) => part.trim())
  if (parts.length === 2) {
    const [hours = '00', minutes = '00'] = parts
    return `${hours.padStart(2, '0')}:${minutes.padStart(2, '0')}:00`
  }
  if (parts.length === 3) {
    const [hours = '00', minutes = '00', seconds = '00'] = parts
    return `${hours.padStart(2, '0')}:${minutes.padStart(2, '0')}:${seconds.padStart(2, '0')}`
  }
  return value
}

function parseTimeCell(value: unknown): string | null {
  if (value === null || typeof value === 'undefined' || value === '') return null

  if (typeof value === 'number') {
    const totalSeconds = Math.round(value * 24 * 60 * 60)
    const hours = Math.floor(totalSeconds / 3600) % 24
    const minutes = Math.floor((totalSeconds % 3600) / 60)
    const seconds = totalSeconds % 60
    return [hours, minutes, seconds].map((part) => String(part).padStart(2, '0')).join(':')
  }

  const text = normalizeText(value)
  if (!text) return null
  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(text)) {
    return padTime(text)
  }

  const matched = text.match(/(\d{1,2}:\d{2}(?::\d{2})?)/)
  return matched ? padTime(matched[1]!) : null
}

function parseTimeRange(value: unknown): { startTime: string; endTime: string } | null {
  const text = normalizeText(value)
  if (!text) return null

  const parts = text.split(TIME_RANGE_SPLIT_PATTERN).filter(Boolean)
  if (parts.length < 2) return null

  const startTime = parseTimeCell(parts[0])
  const endTime = parseTimeCell(parts[1])
  if (!startTime || !endTime) return null

  return { startTime, endTime }
}

function mapExplicitProgramType(value: string): string {
  const normalized = value.trim().toLowerCase()
  if (!normalized) return ''
  if (/(drama|电视剧|剧场|大剧|微短剧|连播|周播剧)/.test(normalized)) return 'drama'
  if (/(news_magazine|资讯|杂志)/.test(normalized)) return 'news_magazine'
  if (/(news|新闻|快讯|联播)/.test(normalized)) return 'news'
  if (/(commentary|评论|观察|今晚|锵点|两说|这就是中国|锚点)/.test(normalized)) return 'commentary'
  if (/(entertainment|娱乐|真人秀|综艺|旅行记|亚洲新声|越动青春)/.test(normalized)) return 'entertainment'
  if (/(health|健康|养生)/.test(normalized)) return 'health'
  if (/(kids|少儿|儿童|亲子|动画)/.test(normalized)) return 'kids'
  if (/(documentary|纪实|纪录|人文|考古)/.test(normalized)) return 'documentary'
  return normalized
}

function inferProgramType(columnName: string, explicitType?: string, fallbackType = 'news_magazine'): string {
  const normalizedExplicit = normalizeText(explicitType).toLowerCase()
  if (normalizedExplicit) {
    return mapExplicitProgramType(normalizedExplicit)
  }

  const text = columnName.toLowerCase()
  if (/(剧场|电视剧|大剧|微短剧|连播|周播剧)/.test(text)) return 'drama'
  if (/(新闻|快报|联播)/.test(text)) return 'news'
  if (/(评论|观察|今晚|锵点|两说|这就是中国|锚点)/.test(text)) return 'commentary'
  if (/(娱乐|真人秀|综艺|旅行记|亚洲新声|越动青春)/.test(text)) return 'entertainment'
  if (/(健康|养生)/.test(text)) return 'health'
  if (/(少儿|亲子|儿童|动画)/.test(text)) return 'kids'
  if (/(纪录|纪实|人文|考古)/.test(text)) return 'documentary'
  return fallbackType
}

function inferSequential(columnName: string, programType: string) {
  return programType === 'drama' || /(剧场|电视剧|大剧|微短剧|连播|周播剧)/.test(columnName)
}

function buildRuntimeColumnId(channelId: string, date: string, columnName: string, programType: string) {
  const slug = columnName
    .trim()
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `runtime-column:${channelId}:${date}:${slug || programType}`
}

function findWeekdayDefinitionByHeader(value: unknown): WeekdayDefinition | undefined {
  const normalized = normalizeHeader(value)
  if (!normalized) return undefined
  return WEEKDAY_DEFINITIONS.find((weekday) =>
    weekday.aliases.some((alias) => normalizeHeader(alias) === normalized),
  )
}

function resolveWeekdayFromDate(date: string): WeekdayDefinition {
  const parsed = new Date(`${date}T00:00:00+08:00`)
  return WEEKDAY_DEFINITIONS.find((item) => item.dayOfWeek === parsed.getDay()) ?? WEEKDAY_DEFINITIONS[0]!
}

function normalizeLayoutCellText(value: unknown) {
  return normalizeText(value)
    .replace(/\r/g, '')
    .replace(/\n+/g, '\n')
}

function stripLayoutDecorators(value: string) {
  return value
    .replace(/[（(【\[].*?[）)】\]]/g, '')
    .replace(/^(重播|录播|首播|复播|直播)\s*/g, '')
    .replace(/\s*(重播|录播|首播|复播|直播)$/g, '')
    .trim()
}

function isMeaningfulLayoutName(value: string) {
  const text = value.replace(/\s+/g, '')
  if (!text) return false
  if (/^\d+(\.\d+)?$/.test(text)) return false
  return /[\u4e00-\u9fa5A-Za-z]/.test(text)
}

function buildColumnNameVariants(text: string) {
  return text
    .split(/[\n/／|｜、]+/g)
    .map((item) => normalizeText(item))
    .filter(Boolean)
}

function resolveLayoutName(value: unknown): LayoutNameResolution | null {
  const parsedConstraint = parseDraftConstraintText(normalizeLayoutCellText(value))
  const text = parsedConstraint.name
  if (!isMeaningfulLayoutName(text)) return null

  const variants = Array.from(new Set([
    text,
    stripLayoutDecorators(text),
    ...buildColumnNameVariants(text),
    ...buildColumnNameVariants(text).map((item) => stripLayoutDecorators(item)),
  ].filter(Boolean)))
  const normalizedVariants = variants.map((item) => normalizeHeader(item))
  const matchedColumn = KNOWN_COLUMN_MATCHERS.find((item) =>
    normalizedVariants.some((variant) => variant === item.normalized),
  )?.column

  if (matchedColumn) {
    return {
      displayName: matchedColumn.columnName,
      matchedColumn: parsedConstraint.kind === 'program' ? undefined : matchedColumn,
      constraintKind: parsedConstraint.kind,
    }
  }

  const cleanedVariant = variants.find(
    (item) => !/^(重播|录播|首播|复播|直播|动画片|电视剧|真人秀|综艺|节目)$/.test(item),
  )
  return { displayName: cleanedVariant ?? variants[0]!, constraintKind: parsedConstraint.kind }
}

function timeTextToMinutes(value: string) {
  const [hoursText = '0', minutesText = '0'] = value.split(':')
  const hours = Number(hoursText) || 0
  const minutes = Number(minutesText) || 0
  return hours * 60 + minutes
}

function resolveDominantProgramType(rows: ParsedLayoutRow[]) {
  const weightedDurations = new Map<string, number>()

  rows.forEach((row) => {
    const startOffset = row.startDayOffset ?? 0
    const endOffset = row.endDayOffset ?? startOffset
    const startMinutes = startOffset * 24 * 60 + timeTextToMinutes(row.startTime)
    const endMinutes = endOffset * 24 * 60 + timeTextToMinutes(row.endTime)
    const durationMinutes = Math.max(1, endMinutes - startMinutes)
    const programType = inferProgramType(row.columnName, row.programType, '')
    if (!programType) return
    weightedDurations.set(programType, (weightedDurations.get(programType) ?? 0) + durationMinutes)
  })

  return [...weightedDurations.entries()]
    .sort((left, right) => right[1] - left[1])[0]?.[0] ?? 'news_magazine'
}

function findHeaderMeta(rows: unknown[][]): ParsedSheetMeta {
  for (let index = 0; index < Math.min(rows.length, 8); index += 1) {
    const row = rows[index] ?? []
    const headerMap: ParsedHeaderMap = {}
    const weekdayColumns: Partial<Record<WeekdayKey, number>> = {}

    row.forEach((cell, cellIndex) => {
      const normalized = normalizeHeader(cell)
      if (!normalized) return

      for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
        if (aliases.some((alias) => normalizeHeader(alias) === normalized)) {
          headerMap[field as keyof ParsedHeaderMap] = cellIndex
        }
      }

      const weekday = findWeekdayDefinitionByHeader(cell)
      if (weekday) {
        weekdayColumns[weekday.key] = cellIndex
      }
    })

    const hasWeekdays = Object.keys(weekdayColumns).length >= 5
    const hasTimeField = typeof headerMap.timeRange === 'number' || typeof headerMap.startTime === 'number'
    const hasColumnField = typeof headerMap.columnName === 'number'

    if (hasWeekdays || (hasTimeField && hasColumnField)) {
      return { headerIndex: index, headerMap, weekdayColumns }
    }
  }

  return {
    headerIndex: 0,
    headerMap: {
      startTime: 0,
      endTime: 1,
      columnName: 2,
      programType: 3,
      remark: 4,
    },
    weekdayColumns: {},
  }
}

function buildTimelineFromRows(rows: unknown[][], headerIndex: number): TimelineDefinition | null {
  const hourAnchors = rows
    .map((row, rowIndex) => {
      const hourText = normalizeText(row?.[0])
      if (!/^\d{1,2}$/.test(hourText)) return null
      const hour = Number(hourText)
      if (!Number.isFinite(hour) || hour < 0 || hour > 23) return null
      return { row: rowIndex + 1, hour }
    })
    .filter((item): item is { row: number; hour: number } => item !== null && item.row > headerIndex + 1)

  if (hourAnchors.length < 4) {
    return null
  }

  let dayOffset = 0
  const fullHourAnchors = hourAnchors.map((anchor, index) => {
    if (index > 0 && anchor.hour < hourAnchors[index - 1]!.hour) {
      dayOffset += 1
    }
    return {
      row: anchor.row,
      absoluteMinutes: dayOffset * 24 * 60 + anchor.hour * 60,
    }
  })

  const halfHourAnchors = rows
    .map((row, rowIndex) => {
      const marker = normalizeText(row?.[1] ?? row?.[11])
      if (marker !== '30') return null
      const rowNumber = rowIndex + 1
      const previousHour = [...fullHourAnchors].reverse().find((anchor) => anchor.row < rowNumber)
      const nextHour = fullHourAnchors.find((anchor) => anchor.row > rowNumber)

      if (previousHour) {
        return { row: rowNumber, absoluteMinutes: previousHour.absoluteMinutes + 30 }
      }
      if (nextHour) {
        return { row: rowNumber, absoluteMinutes: nextHour.absoluteMinutes - 30 }
      }
      return null
    })
    .filter((item): item is { row: number; absoluteMinutes: number } => item !== null)

  const anchors = [...fullHourAnchors, ...halfHourAnchors]
    .sort((left, right) => left.row - right.row)
    .filter((anchor, index, list) => index === 0 || anchor.row !== list[index - 1]!.row)

  return anchors.length > 1 ? { anchors } : null
}

function resolveAbsoluteMinutesForRow(row: number, timeline: TimelineDefinition) {
  const anchors = timeline.anchors
  const first = anchors[0]!
  const last = anchors[anchors.length - 1]!

  if (row <= first.row) {
    return first.absoluteMinutes + (row - first.row) * 10
  }
  if (row >= last.row) {
    return last.absoluteMinutes + (row - last.row) * 10
  }

  for (let index = 1; index < anchors.length; index += 1) {
    const previous = anchors[index - 1]!
    const current = anchors[index]!
    if (row > current.row) continue
    if (row === current.row) return current.absoluteMinutes
    if (row === previous.row) return previous.absoluteMinutes

    const ratio = (row - previous.row) / (current.row - previous.row)
    const absoluteMinutes = previous.absoluteMinutes + (current.absoluteMinutes - previous.absoluteMinutes) * ratio
    return Math.round(absoluteMinutes / 10) * 10
  }

  return last.absoluteMinutes
}

function rowToTime(row: number, timeline: TimelineDefinition) {
  const absoluteMinutes = resolveAbsoluteMinutesForRow(row, timeline)
  const dayOffset = Math.floor(absoluteMinutes / (24 * 60))
  const timeMinutes = absoluteMinutes - dayOffset * 24 * 60
  return {
    timeText: formatMinutesToTime(timeMinutes),
    dayOffset,
  }
}

function looksLikeVisualWeekdaySheet(
  worksheet: import('xlsx').WorkSheet,
  rows: unknown[][],
  headerIndex: number,
  weekdayColumnIndex: number,
) {
  const mergeCount = (worksheet['!merges'] ?? []).filter(
    (merge) => merge.s.c <= weekdayColumnIndex && merge.e.c >= weekdayColumnIndex && merge.s.r >= headerIndex + 1,
  ).length
  return mergeCount >= 4 && buildTimelineFromRows(rows, headerIndex) !== null
}

function resolveRowTime(row: unknown[], headerMap: ParsedHeaderMap) {
  let startTime = parseTimeCell(typeof headerMap.startTime === 'number' ? row[headerMap.startTime] : '')
  let endTime = parseTimeCell(typeof headerMap.endTime === 'number' ? row[headerMap.endTime] : '')

  if ((!startTime || !endTime) && typeof headerMap.timeRange === 'number') {
    const range = parseTimeRange(row[headerMap.timeRange])
    startTime = startTime ?? range?.startTime ?? null
    endTime = endTime ?? range?.endTime ?? null
  }

  return { startTime, endTime }
}

function parseSingleDayRows(rows: unknown[][], headerIndex: number, headerMap: ParsedHeaderMap): ParsedLayoutRow[] {
  const result: ParsedLayoutRow[] = []

  for (let index = headerIndex + 1; index < rows.length; index += 1) {
    const row = rows[index] ?? []
    const { startTime, endTime } = resolveRowTime(row, headerMap)
    const resolvedName = resolveLayoutName(typeof headerMap.columnName === 'number' ? row[headerMap.columnName] : '')

    if (!startTime || !endTime || !resolvedName) continue

    result.push({
      startTime,
      endTime,
      columnName: resolvedName.displayName,
      columnId: resolvedName.matchedColumn?.columnId,
      draftConstraintKind: resolvedName.constraintKind,
      programType: normalizeText(typeof headerMap.programType === 'number' ? row[headerMap.programType] : ''),
      remark: normalizeText(typeof headerMap.remark === 'number' ? row[headerMap.remark] : ''),
    })
  }

  return result
}

function parseWeekdayRows(
  rows: unknown[][],
  headerIndex: number,
  headerMap: ParsedHeaderMap,
  weekdayColumnIndex: number,
): { rows: ParsedLayoutRow[]; warnings: string[] } {
  const result: ParsedLayoutRow[] = []
  const warnings: string[] = []

  for (let index = headerIndex + 1; index < rows.length; index += 1) {
    const row = rows[index] ?? []
    const { startTime, endTime } = resolveRowTime(row, headerMap)
    if (!startTime || !endTime) continue

    const resolvedName = resolveLayoutName(row[weekdayColumnIndex])
    if (!resolvedName) {
      warnings.push(`时段 ${startTime}-${endTime} 未填写当前星期栏目，已跳过`)
      continue
    }

    result.push({
      startTime,
      endTime,
      columnName: resolvedName.displayName,
      columnId: resolvedName.matchedColumn?.columnId,
      draftConstraintKind: resolvedName.constraintKind,
      programType: normalizeText(typeof headerMap.programType === 'number' ? row[headerMap.programType] : ''),
      remark: normalizeText(typeof headerMap.remark === 'number' ? row[headerMap.remark] : ''),
    })
  }

  return { rows: result, warnings }
}

function parseVisualWeekdayGrid(
  worksheet: import('xlsx').WorkSheet,
  XLSX: typeof import('xlsx'),
  headerIndex: number,
  weekdayColumnIndex: number,
): { rows: ParsedLayoutRow[]; warnings: string[] } | null {
  const rows = XLSX.utils.sheet_to_json<(string | number | null)[]>(worksheet, {
    header: 1,
    defval: '',
    raw: false,
  }) as unknown[][]
  const timeline = buildTimelineFromRows(rows, headerIndex)
  if (!timeline) {
    return null
  }

  const warnings: string[] = []
  const result: ParsedLayoutRow[] = []
  const timelineStartRow = timeline.anchors[0]?.row ?? headerIndex + 2
  const merges = (worksheet['!merges'] ?? []).filter(
    (merge) =>
      merge.s.c <= weekdayColumnIndex
      && merge.e.c >= weekdayColumnIndex
      && merge.s.r + 1 >= timelineStartRow,
  )

  const pushRow = (startRow: number, endRowInclusive: number, rawName: unknown) => {
    const resolvedName = resolveLayoutName(rawName)
    if (!resolvedName) return

    const startPosition = rowToTime(startRow + 1, timeline)
    const endPosition = rowToTime(endRowInclusive + 2, timeline)
    result.push({
      startTime: startPosition.timeText,
      endTime: endPosition.timeText,
      startDayOffset: startPosition.dayOffset,
      endDayOffset: endPosition.dayOffset,
      columnName: resolvedName.displayName,
      columnId: resolvedName.matchedColumn?.columnId,
      draftConstraintKind: resolvedName.constraintKind,
    })
  }

  merges.forEach((merge) => {
    const topLeftKey = XLSX.utils.encode_cell({ c: merge.s.c, r: merge.s.r })
    pushRow(merge.s.r, merge.e.r, worksheet[topLeftKey]?.v)
  })

  const coveredRows = new Set<number>()
  merges.forEach((merge) => {
    for (let rowIndex = merge.s.r; rowIndex <= merge.e.r; rowIndex += 1) {
      coveredRows.add(rowIndex)
    }
  })

  const range = XLSX.utils.decode_range(worksheet['!ref'] ?? '')
  for (let rowIndex = Math.max(headerIndex + 1, timelineStartRow - 1); rowIndex <= range.e.r; rowIndex += 1) {
    if (coveredRows.has(rowIndex)) continue
    const key = XLSX.utils.encode_cell({ c: weekdayColumnIndex, r: rowIndex })
    pushRow(rowIndex, rowIndex, worksheet[key]?.v)
  }

  if (result.length === 0) {
    warnings.push('已识别到星期列，但没有提取到可用版面块')
    return { rows: [], warnings }
  }

  result.sort((left, right) => {
    const leftKey = `${left.startDayOffset ?? 0}-${left.startTime}`
    const rightKey = `${right.startDayOffset ?? 0}-${right.startTime}`
    return leftKey.localeCompare(rightKey)
  })

  return { rows: result, warnings }
}

function clipRowsToCurrentDay(rows: ParsedLayoutRow[], warnings: string[]) {
  const clippedRows: ParsedLayoutRow[] = []

  rows.forEach((row) => {
    const startOffset = row.startDayOffset ?? 0
    const endOffset = row.endDayOffset ?? startOffset

    if (startOffset > 0) {
      warnings.push(`栏目“${row.columnName}”起始时间已跨到次日，当前仅保留当天版面，已跳过`)
      return
    }

    if (endOffset > 0) {
      clippedRows.push({
        ...row,
        endTime: '23:59:59',
        endDayOffset: 0,
      })
      warnings.push(`栏目“${row.columnName}”跨到次日，已截断到当天 23:59:59`)
      return
    }

    clippedRows.push(row)
  })

  return clippedRows
}

function buildColumns(channelId: string, date: string, rows: ParsedLayoutRow[], dominantProgramType: string) {
  const columns = new Map<string, ColumnDefinition>()

  rows.forEach((row) => {
    const draftConstraintKind = row.draftConstraintKind ?? 'unspecified'
    const matchedMockColumn = row.draftConstraintKind === 'program'
      ? undefined
      : row.columnId
        ? KNOWN_COLUMN_MATCHERS.find((item) => item.column.columnId === row.columnId)?.column
        : resolveLayoutName(row.columnName)?.matchedColumn

    if (matchedMockColumn) {
      const existing = columns.get(matchedMockColumn.columnId)
      columns.set(matchedMockColumn.columnId, {
        ...matchedMockColumn,
        draftConstraintKind: existing?.draftConstraintKind === 'column' || existing?.draftConstraintKind === 'program'
          ? existing.draftConstraintKind
          : draftConstraintKind,
      })
      return
    }

    const programType = inferProgramType(row.columnName, row.programType, dominantProgramType)
    const columnId = buildRuntimeColumnId(channelId, date, row.columnName, programType)
    if (columns.has(columnId)) return

    columns.set(columnId, {
      columnId,
      columnName: row.columnName,
      channelId,
      defaultProgramType: programType,
      isSequential: inferSequential(row.columnName, programType),
      draftConstraintKind,
    })
  })

  return columns
}

function buildLayoutSlots(
  channelId: string,
  date: string,
  rows: ParsedLayoutRow[],
  warnings: string[],
): { layoutSlots: LayoutSlot[]; columns: ColumnDefinition[] } {
  const normalizedRows = clipRowsToCurrentDay(rows, warnings)
  const dominantProgramType = resolveDominantProgramType(normalizedRows)
  const columns = buildColumns(channelId, date, normalizedRows, dominantProgramType)
  const unmatchedRows = normalizedRows.filter((row) => !row.columnId)
  if (unmatchedRows.length > 0) {
    warnings.push(`有 ${unmatchedRows.length} 个版面块未命中真实栏目，将按导入栏目名称生成运行时栏目约束`)
  }
  const layoutSlots: LayoutSlot[] = normalizedRows.map((row, index) => {
    const programType = inferProgramType(row.columnName, row.programType, dominantProgramType)
    const matchedMockColumn = row.draftConstraintKind === 'program'
      ? undefined
      : row.columnId
        ? KNOWN_COLUMN_MATCHERS.find((item) => item.column.columnId === row.columnId)?.column
        : resolveLayoutName(row.columnName)?.matchedColumn
    const columnId = matchedMockColumn?.columnId ?? buildRuntimeColumnId(channelId, date, row.columnName, programType)

    if (!matchedMockColumn && inferSequential(row.columnName, programType)) {
      warnings.push(`栏目“${row.columnName}”已按顺播栏目处理`)
    }

    return {
      id: `imported-${channelId}-${date}-${String(index + 1).padStart(3, '0')}`,
      channelId,
      columnId,
      startTime: buildIso(date, row.startTime, row.startDayOffset ?? 0),
      endTime: buildIso(date, row.endTime, row.endDayOffset ?? row.startDayOffset ?? 0),
    }
  })

  layoutSlots.sort((left, right) => new Date(left.startTime).getTime() - new Date(right.startTime).getTime())

  for (let index = 1; index < layoutSlots.length; index += 1) {
    const previous = layoutSlots[index - 1]!
    const current = layoutSlots[index]!
    if (new Date(current.startTime).getTime() < new Date(previous.endTime).getTime()) {
      warnings.push(`时段 ${current.startTime} 与前一版面时段存在重叠，请人工确认`)
    }
  }

  return {
    layoutSlots,
    columns: Array.from(columns.values()),
  }
}

function readSheetRows(worksheet: import('xlsx').WorkSheet, XLSX: typeof import('xlsx')) {
  return XLSX.utils.sheet_to_json<(string | number | null)[]>(worksheet, {
    header: 1,
    defval: '',
    raw: false,
  }) as unknown[][]
}

function selectImportedSheet(
  workbook: import('xlsx').WorkBook,
  XLSX: typeof import('xlsx'),
  targetWeekday: WeekdayDefinition,
): ImportedSheetSelection | null {
  const sheetEntries = workbook.SheetNames
    .map((sheetName) => ({
      sheetName,
      worksheet: workbook.Sheets[sheetName],
    }))
    .filter((item): item is { sheetName: string; worksheet: import('xlsx').WorkSheet } => Boolean(item.worksheet))

  const trySheet = (sheetName: string, worksheet: import('xlsx').WorkSheet): ImportedSheetSelection | null => {
    const rows = readSheetRows(worksheet, XLSX)
    const meta = findHeaderMeta(rows)
    const weekdayColumnIndex = meta.weekdayColumns[targetWeekday.key]

    if (typeof weekdayColumnIndex === 'number') {
      const matchedColumnLabel = normalizeText(rows[meta.headerIndex]?.[weekdayColumnIndex]) || targetWeekday.shortLabel

      if (looksLikeVisualWeekdaySheet(worksheet, rows, meta.headerIndex, weekdayColumnIndex)) {
        const visualParsed = parseVisualWeekdayGrid(worksheet, XLSX, meta.headerIndex, weekdayColumnIndex)
        if (visualParsed && visualParsed.rows.length > 0) {
          return {
            sheetName,
            templateMode: 'visual_weekday_grid',
            parsedRows: visualParsed.rows,
            matchedWeekday: targetWeekday,
            matchedColumnLabel,
            warnings: visualParsed.warnings,
          }
        }
      }

      const parsed = parseWeekdayRows(rows, meta.headerIndex, meta.headerMap, weekdayColumnIndex)
      if (parsed.rows.length > 0) {
        return {
          sheetName,
          templateMode: 'weekday_columns',
          parsedRows: parsed.rows,
          matchedWeekday: targetWeekday,
          matchedColumnLabel,
          warnings: parsed.warnings,
        }
      }
    }

    const normalizedSheetName = normalizeHeader(sheetName)
    const isWeekdaySheet = targetWeekday.aliases.some((alias) => normalizeHeader(alias) === normalizedSheetName)
    if (isWeekdaySheet) {
      const parsedRows = parseSingleDayRows(rows, meta.headerIndex, meta.headerMap)
      if (parsedRows.length > 0) {
        return {
          sheetName,
          templateMode: 'weekday_sheet',
          parsedRows,
          matchedWeekday: targetWeekday,
          matchedColumnLabel: sheetName,
          warnings: [],
        }
      }
    }

    return null
  }

  const weekdayNamedSheet = sheetEntries.find((item) => {
    const normalizedSheetName = normalizeHeader(item.sheetName)
    return targetWeekday.aliases.some((alias) => normalizeHeader(alias) === normalizedSheetName)
  })

  if (weekdayNamedSheet) {
    const matched = trySheet(weekdayNamedSheet.sheetName, weekdayNamedSheet.worksheet)
    if (matched) return matched
  }

  for (const sheetEntry of sheetEntries) {
    const matched = trySheet(sheetEntry.sheetName, sheetEntry.worksheet)
    if (matched) return matched
  }

  return null
}

export class LayoutImportService {
  async importFile(file: File, channelId: string, date: string): Promise<ImportedLayoutPackage> {
    const XLSX = await import('xlsx')
    const buffer = await file.arrayBuffer()
    const workbook = XLSX.read(buffer, { type: 'array', cellDates: false, raw: false })
    const targetWeekday = resolveWeekdayFromDate(date)
    const selectedSheet = selectImportedSheet(workbook, XLSX, targetWeekday)

    if (!selectedSheet) {
      throw new Error('播出版面格式有误，请按星期版面模板上传')
    }

    const warnings = [...selectedSheet.warnings]
    const { layoutSlots, columns } = buildLayoutSlots(channelId, date, selectedSheet.parsedRows, warnings)

    if (layoutSlots.length === 0) {
      throw new Error('未识别到有效版面行，请检查时间轴、星期列和栏目内容')
    }

    return {
      sourceFileName: file.name,
      channelId,
      date,
      warnings: Array.from(new Set(warnings)).slice(0, 8),
      layoutReference: {
        id: `runtime-layout-${channelId}-${date}`,
        name: `上传版面：${file.name}`,
        slots: layoutSlots,
      },
      columns,
      templateMode: selectedSheet.templateMode,
      matchedSheetName: selectedSheet.sheetName,
      matchedWeekday: selectedSheet.matchedWeekday?.key,
      matchedWeekdayLabel: selectedSheet.matchedWeekday?.shortLabel,
      matchedColumnLabel: selectedSheet.matchedColumnLabel,
    }
  }
}

let globalLayoutImportService: LayoutImportService | null = null

export function getLayoutImportService(): LayoutImportService {
  if (!globalLayoutImportService) {
    globalLayoutImportService = new LayoutImportService()
  }
  return globalLayoutImportService
}
