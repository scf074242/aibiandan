import type {
  ColumnDefinition,
  FixedItem,
  LayoutReference,
  LayoutSlot,
  ProgramCandidate,
  ProgramDefinition,
  ProgramInstance,
  ScheduleSummary,
} from '@/types/orchestration'

const baseDate = '2026-03-25'

const getCurrentShanghaiDate = () => {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const parts = formatter.formatToParts(new Date())
  const year = parts.find((part) => part.type === 'year')?.value ?? '2026'
  const month = parts.find((part) => part.type === 'month')?.value ?? '03'
  const day = parts.find((part) => part.type === 'day')?.value ?? '25'
  return `${year}-${month}-${day}`
}

const iso = (date: string, time: string) => `${date}T${time}+08:00`

const buildInternalAdBreaks = (duration: number, programType: string) => {
  if (!['drama', 'movie'].includes(programType)) {
    return undefined
  }

  let adCount = 0
  if (duration >= 30 * 60 && duration < 60 * 60) {
    adCount = 1
  } else if (duration >= 60 * 60 && duration < 120 * 60) {
    adCount = 2
  } else if (duration >= 120 * 60) {
    adCount = 3
  }

  if (adCount === 0) {
    return undefined
  }

  const adDurationSeconds = 300
  const totalAdDuration = adCount * adDurationSeconds
  const totalContentDuration = duration - totalAdDuration
  const contentSegmentCount = adCount + 1
  const contentSegmentDuration = Math.floor(totalContentDuration / contentSegmentCount)
  if (contentSegmentDuration <= 0) {
    return undefined
  }

  const breaks: Array<{ offsetSeconds: number; durationSeconds: number }> = []
  let scheduledOffset = contentSegmentDuration
  for (let index = 0; index < adCount; index += 1) {
    breaks.push({
      offsetSeconds: scheduledOffset,
      durationSeconds: adDurationSeconds,
    })
    scheduledOffset += adDurationSeconds + contentSegmentDuration
  }

  const lastBreak = breaks[breaks.length - 1]
  const remainingDuration = lastBreak
    ? duration - lastBreak.offsetSeconds - lastBreak.durationSeconds
    : duration

  return remainingDuration > 0 ? breaks : undefined
}

export const orchestrationDemoBaseDate = baseDate
export const orchestrationDemoRuntimeDate = getCurrentShanghaiDate()

const demoDateAliases = Array.from(new Set([orchestrationDemoBaseDate, orchestrationDemoRuntimeDate]))

export const orchestrationDemoChannels = [
  {
    id: 'dragon',
    name: '东方卫视',
    code: 'DRAGON',
    timeZone: 'Asia/Shanghai',
    defaultStartTime: '06:00:00',
    defaultEndTime: '23:59:59',
  },
]

export const orchestrationDemoColumns: ColumnDefinition[] = [
  { columnId: '115', columnName: '东方快报', channelId: 'dragon', defaultProgramType: 'news' },
  { columnId: '101', columnName: '看东方', channelId: 'dragon', defaultProgramType: 'news_magazine' },
  { columnId: '107', columnName: '潮童天下', channelId: 'dragon', defaultProgramType: 'kids' },
  { columnId: '112', columnName: '品质剧场', channelId: 'dragon', defaultProgramType: 'drama' },
  { columnId: '102', columnName: '午间30分', channelId: 'dragon', defaultProgramType: 'news' },
  { columnId: '104', columnName: 'ShanghaiEye', channelId: 'dragon', defaultProgramType: 'news_magazine' },
  { columnId: '105', columnName: '名医话养生', channelId: 'dragon', defaultProgramType: 'health' },
  { columnId: '113', columnName: '经典剧场', channelId: 'dragon', defaultProgramType: 'drama' },
  { columnId: '106', columnName: '东方新娱乐', channelId: 'dragon', defaultProgramType: 'entertainment' },
  { columnId: '103', columnName: '东方新闻', channelId: 'dragon', defaultProgramType: 'news' },
  { columnId: '118', columnName: '新闻联播', channelId: 'dragon', defaultProgramType: 'news' },
  { columnId: '119', columnName: '东方剧场', channelId: 'dragon', defaultProgramType: 'drama' },
  { columnId: '120', columnName: '东方看大剧', channelId: 'dragon', defaultProgramType: 'drama' },
  { columnId: '121', columnName: '品质东方微短剧', channelId: 'dragon', defaultProgramType: 'drama' },
  { columnId: '122', columnName: '今晚', channelId: 'dragon', defaultProgramType: 'commentary' },
  { columnId: '109', columnName: '锵点', channelId: 'dragon', defaultProgramType: 'commentary' },
  { columnId: '123', columnName: '两说', channelId: 'dragon', defaultProgramType: 'commentary' },
  { columnId: '124', columnName: '梦想剧场', channelId: 'dragon', defaultProgramType: 'drama' },
]

export const orchestrationDemoProgramDefinitions: ProgramDefinition[] = [
  { programId: 'P115001', programName: '东方快报', columnId: '115', programType: 'news' },
  { programId: 'P101001', programName: '看东方', columnId: '101', programType: 'news_magazine' },
  { programId: 'P107001', programName: '潮童天下', columnId: '107', programType: 'kids' },
  { programId: 'P112001', programName: '纵有疾风起', columnId: '112', programType: 'drama' },
  { programId: 'P112002', programName: '边关烽火情', columnId: '112', programType: 'drama' },
  { programId: 'P102001', programName: '午间30分', columnId: '102', programType: 'news' },
  { programId: 'P104001', programName: 'ShanghaiEye', columnId: '104', programType: 'news_magazine' },
  { programId: 'P105001', programName: '名医话养生', columnId: '105', programType: 'health' },
  { programId: 'P113001', programName: '烟火人家', columnId: '113', programType: 'drama' },
  { programId: 'P113002', programName: '城中之城', columnId: '113', programType: 'drama' },
  { programId: 'P106001', programName: '东方新娱乐', columnId: '106', programType: 'entertainment' },
  { programId: 'P103001', programName: '东方新闻', columnId: '103', programType: 'news' },
  { programId: 'P118001', programName: '新闻联播', columnId: '118', programType: 'news' },
  { programId: 'P119001', programName: '玫瑰的故事', columnId: '119', programType: 'drama' },
  { programId: 'P120001', programName: '东方看大剧', columnId: '120', programType: 'drama' },
  { programId: 'P121001', programName: '夜色正浓', columnId: '121', programType: 'drama' },
  { programId: 'P122001', programName: '今晚', columnId: '122', programType: 'commentary' },
  { programId: 'P109001', programName: '锵点', columnId: '109', programType: 'commentary' },
  { programId: 'P123001', programName: '两说', columnId: '123', programType: 'commentary' },
  { programId: 'P124001', programName: '归路', columnId: '124', programType: 'drama' },
]

export const orchestrationDemoProgramInstances: ProgramInstance[] = [
  { instanceId: 'I115001-0001', programId: 'P115001', programCode: '002601150001', instanceName: '东方快报 06时整点', duration: 900, issueNo: '0001' },
  { instanceId: 'I115001-0002', programId: 'P115001', programCode: '002601150002', instanceName: '东方快报 06时15分', duration: 900, issueNo: '0002' },
  { instanceId: 'I115001-0003', programId: 'P115001', programCode: '002601150003', instanceName: '东方快报 06时30分', duration: 900, issueNo: '0003' },
  { instanceId: 'I115001-0004', programId: 'P115001', programCode: '002601150004', instanceName: '东方快报 06时45分', duration: 900, issueNo: '0004' },
  { instanceId: 'I101001-0001', programId: 'P101001', programCode: '002601010001', instanceName: '看东方 早高峰版', duration: 3600, issueNo: '0001' },
  { instanceId: 'I101001-0002', programId: 'P101001', programCode: '002601010002', instanceName: '看东方 城市观察', duration: 2700, issueNo: '0002' },
  { instanceId: 'I101001-0003', programId: 'P101001', programCode: '002601010003', instanceName: '看东方 民生第一线', duration: 2700, issueNo: '0003' },
  { instanceId: 'I101001-0004', programId: 'P101001', programCode: '002601010004', instanceName: '看东方 特别策划：申城更新', duration: 1800, issueNo: '0004' },
  { instanceId: 'I107001-0001', programId: 'P107001', programCode: '002601070001', instanceName: '潮童天下', duration: 1800, issueNo: '0001' },
  { instanceId: 'I112001-0001', programId: 'P112001', programCode: '002601120001', instanceName: '品质剧场：纵有疾风起 第1集', duration: 2700, adBreaks: buildInternalAdBreaks(2700, 'drama'), issueNo: '0001' },
  { instanceId: 'I112001-0002', programId: 'P112001', programCode: '002601120002', instanceName: '品质剧场：纵有疾风起 第2集', duration: 2700, adBreaks: buildInternalAdBreaks(2700, 'drama'), issueNo: '0002' },
  { instanceId: 'I112001-0003', programId: 'P112001', programCode: '002601120003', instanceName: '品质剧场：纵有疾风起 第3集', duration: 2700, adBreaks: buildInternalAdBreaks(2700, 'drama'), issueNo: '0003' },
  { instanceId: 'I112002-0001', programId: 'P112002', programCode: '002601120004', instanceName: '品质剧场：边关烽火情 第1集', duration: 2700, adBreaks: buildInternalAdBreaks(2700, 'drama'), issueNo: '0001' },
  { instanceId: 'I102001-0001', programId: 'P102001', programCode: '002601020001', instanceName: '午间30分', duration: 1800, issueNo: '0001' },
  { instanceId: 'I104001-0001', programId: 'P104001', programCode: '002601040001', instanceName: 'ShanghaiEye 午间国际快讯', duration: 1800, issueNo: '0001' },
  { instanceId: 'I104001-0002', programId: 'P104001', programCode: '002601040002', instanceName: 'ShanghaiEye 夜线观察', duration: 1800, issueNo: '0002' },
  { instanceId: 'I105001-0001', programId: 'P105001', programCode: '002601050001', instanceName: '名医话养生·午后调养篇', duration: 1800, issueNo: '0001' },
  { instanceId: 'I105001-0002', programId: 'P105001', programCode: '002601050002', instanceName: '名医话养生·春季护肝篇', duration: 1800, issueNo: '0002' },
  { instanceId: 'I105001-0003', programId: 'P105001', programCode: '002601050003', instanceName: '名医话养生·傍晚轻养篇', duration: 900, issueNo: '0003' },
  { instanceId: 'I113001-0001', programId: 'P113001', programCode: '002601130001', instanceName: '经典剧场：烟火人家 第1集', duration: 2700, adBreaks: buildInternalAdBreaks(2700, 'drama'), issueNo: '0001' },
  { instanceId: 'I113001-0002', programId: 'P113001', programCode: '002601130002', instanceName: '经典剧场：烟火人家 第2集', duration: 2700, adBreaks: buildInternalAdBreaks(2700, 'drama'), issueNo: '0002' },
  { instanceId: 'I113002-0001', programId: 'P113002', programCode: '002601130003', instanceName: '经典剧场：城中之城 第1集', duration: 2700, adBreaks: buildInternalAdBreaks(2700, 'drama'), issueNo: '0001' },
  { instanceId: 'I106001-0001', programId: 'P106001', programCode: '002601060001', instanceName: '东方新娱乐·当日热搜', duration: 900, issueNo: '0001' },
  { instanceId: 'I103001-0001', programId: 'P103001', programCode: '002601030001', instanceName: '东方新闻', duration: 1800, issueNo: '0001' },
  { instanceId: 'I118001-0001', programId: 'P118001', programCode: '002601180001', instanceName: '新闻联播', duration: 1800, issueNo: '0001' },
  { instanceId: 'I119001-0001', programId: 'P119001', programCode: '002601190001', instanceName: '东方剧场：玫瑰的故事 第1集', duration: 2700, adBreaks: buildInternalAdBreaks(2700, 'drama'), issueNo: '0001' },
  { instanceId: 'I119001-0002', programId: 'P119001', programCode: '002601190002', instanceName: '东方剧场：玫瑰的故事 第2集', duration: 2700, adBreaks: buildInternalAdBreaks(2700, 'drama'), issueNo: '0002' },
  { instanceId: 'I120001-0001', programId: 'P120001', programCode: '002601200001', instanceName: '东方看大剧', duration: 1800, adBreaks: buildInternalAdBreaks(1800, 'drama'), issueNo: '0001' },
  { instanceId: 'I121001-0001', programId: 'P121001', programCode: '002601210001', instanceName: '品质东方微短剧：夜色正浓 上集', duration: 1800, adBreaks: buildInternalAdBreaks(1800, 'drama'), issueNo: '0001' },
  { instanceId: 'I122001-0001', programId: 'P122001', programCode: '002601220001', instanceName: '今晚', duration: 1800, issueNo: '0001' },
  { instanceId: 'I109001-0001', programId: 'P109001', programCode: '002601090001', instanceName: '锵点·当日观察', duration: 1800, issueNo: '0001' },
  { instanceId: 'I123001-0001', programId: 'P123001', programCode: '002601230001', instanceName: '两说', duration: 1800, issueNo: '0001' },
  { instanceId: 'I124001-0001', programId: 'P124001', programCode: '002601240001', instanceName: '梦想剧场：归路 第1集', duration: 1800, adBreaks: buildInternalAdBreaks(1800, 'drama'), issueNo: '0001' },
]

const layoutSeeds: Array<Omit<LayoutSlot, 'startTime' | 'endTime'> & { startClock: string; endClock: string }> = [
  { id: 'dragon-0600', channelId: 'dragon', startClock: '06:00:00', endClock: '07:00:00', columnId: '115' },
  { id: 'dragon-0700', channelId: 'dragon', startClock: '07:00:00', endClock: '09:00:00', columnId: '101' },
  { id: 'dragon-0900', channelId: 'dragon', startClock: '09:00:00', endClock: '09:30:00', columnId: '107' },
  { id: 'dragon-0930', channelId: 'dragon', startClock: '09:30:00', endClock: '12:00:00', columnId: '112' },
  { id: 'dragon-1200', channelId: 'dragon', startClock: '12:00:00', endClock: '12:30:00', columnId: '102' },
  { id: 'dragon-1230', channelId: 'dragon', startClock: '12:30:00', endClock: '13:00:00', columnId: '104' },
  { id: 'dragon-1300', channelId: 'dragon', startClock: '13:00:00', endClock: '13:30:00', columnId: '105' },
  { id: 'dragon-1330', channelId: 'dragon', startClock: '13:30:00', endClock: '17:30:00', columnId: '113' },
  { id: 'dragon-1730', channelId: 'dragon', startClock: '17:30:00', endClock: '17:45:00', columnId: '106' },
  { id: 'dragon-1745', channelId: 'dragon', startClock: '17:45:00', endClock: '18:00:00', columnId: '105' },
  { id: 'dragon-1830', channelId: 'dragon', startClock: '18:30:00', endClock: '19:00:00', columnId: '103' },
  { id: 'dragon-1900', channelId: 'dragon', startClock: '19:00:00', endClock: '19:30:00', columnId: '118' },
  { id: 'dragon-1930', channelId: 'dragon', startClock: '19:30:00', endClock: '21:00:00', columnId: '119' },
  { id: 'dragon-2100', channelId: 'dragon', startClock: '21:00:00', endClock: '21:30:00', columnId: '120' },
  { id: 'dragon-2130', channelId: 'dragon', startClock: '21:30:00', endClock: '22:00:00', columnId: '121' },
  { id: 'dragon-2200', channelId: 'dragon', startClock: '22:00:00', endClock: '22:30:00', columnId: '122' },
  { id: 'dragon-2230', channelId: 'dragon', startClock: '22:30:00', endClock: '23:00:00', columnId: '109' },
  { id: 'dragon-2300', channelId: 'dragon', startClock: '23:00:00', endClock: '23:30:00', columnId: '123' },
  { id: 'dragon-2330', channelId: 'dragon', startClock: '23:30:00', endClock: '23:59:59', columnId: '124' },
]

export const orchestrationDemoLayouts: Record<string, LayoutReference> = Object.fromEntries(
  demoDateAliases.map((date) => [
    `dragon_${date}`,
    {
      id: `layout_dragon_${date}`,
      name: '东方卫视版面参考',
      slots: layoutSeeds.map((slot) => ({
        id: slot.id,
        channelId: slot.channelId,
        columnId: slot.columnId,
        startTime: iso(date, slot.startClock),
        endTime: iso(date, slot.endClock),
      })),
    },
  ]),
)

const baseHistorySchedules: ScheduleSummary[] = [
  { date: '2026-03-24', itemCount: 26, programTypes: { news: 6, news_magazine: 4, drama: 6, health: 2, commentary: 3 }, avgRating: 8.6 },
  { date: '2026-03-23', itemCount: 27, programTypes: { news: 6, news_magazine: 4, drama: 6, health: 2, commentary: 3 }, avgRating: 8.5 },
]

export const orchestrationDemoHistorySchedules: Record<string, ScheduleSummary[]> = Object.fromEntries(
  demoDateAliases.map((date) => [`dragon_${date}`, baseHistorySchedules]),
)

const programDefinitionMap = new Map(orchestrationDemoProgramDefinitions.map((item) => [item.programId, item]))
const columnMap = new Map(orchestrationDemoColumns.map((item) => [item.columnId, item]))

export const orchestrationDemoCandidates: ProgramCandidate[] = orchestrationDemoProgramInstances.map((instance) => {
  const definition = programDefinitionMap.get(instance.programId)
  if (!definition) {
    throw new Error(`Unknown programId: ${instance.programId}`)
  }

  const column = columnMap.get(definition.columnId)
  if (!column) {
    throw new Error(`Unknown columnId: ${definition.columnId}`)
  }

  return {
    id: instance.instanceId,
    programId: definition.programId,
    programCode: instance.programCode,
    programName: instance.instanceName,
    channelId: column.channelId,
    duration: instance.duration,
    programType: definition.programType,
    issueNo: instance.issueNo,
    instanceName: instance.instanceName,
    adBreaks: instance.adBreaks,
  }
})

const fixedProgramByColumn = new Map<string, string>([
  ['102', 'P102001'],
  ['103', 'P103001'],
])

export const orchestrationDemoFixedItems: Record<string, FixedItem[]> = Object.fromEntries(
  demoDateAliases.map((date) => [
    `dragon_${date}`,
    ['102', '103'].flatMap((columnId) => {
      const slot = orchestrationDemoLayouts[`dragon_${date}`]?.slots.find((item) => item.columnId === columnId)
      const programId = fixedProgramByColumn.get(columnId)
      const candidate = orchestrationDemoCandidates.find((item) => item.programId === programId)
      if (!slot || !candidate) return []
      return [{
        id: `fixed-${slot.id}`,
        programCode: candidate.programCode,
        startTime: slot.startTime,
        endTime: slot.endTime,
        isLocked: true,
      }]
    }),
  ]),
)

const getLatestAvailableKey = <T>(record: Record<string, T>, channelId: string): string | null => {
  const keys = Object.keys(record)
    .filter((key) => key.startsWith(`${channelId}_`))
    .sort((left, right) => right.localeCompare(left))
  return keys[0] ?? null
}

export function getOrchestrationDemoLayout(channelId: string, date: string): LayoutReference | null {
  const exact = orchestrationDemoLayouts[`${channelId}_${date}`]
  if (exact) return exact
  const fallbackKey = getLatestAvailableKey(orchestrationDemoLayouts, channelId)
  return fallbackKey ? (orchestrationDemoLayouts[fallbackKey] ?? null) : null
}

export function getOrchestrationDemoHistorySchedules(channelId: string, date: string): ScheduleSummary[] {
  const exact = orchestrationDemoHistorySchedules[`${channelId}_${date}`]
  if (exact) return exact
  const fallbackKey = getLatestAvailableKey(orchestrationDemoHistorySchedules, channelId)
  return fallbackKey ? (orchestrationDemoHistorySchedules[fallbackKey] ?? []) : []
}

export function getOrchestrationDemoFixedItems(channelId: string, date: string): FixedItem[] {
  const exact = orchestrationDemoFixedItems[`${channelId}_${date}`]
  if (exact) return exact
  const fallbackKey = getLatestAvailableKey(orchestrationDemoFixedItems, channelId)
  return fallbackKey ? (orchestrationDemoFixedItems[fallbackKey] ?? []) : []
}

export function getOrchestrationDemoColumn(columnId: string): ColumnDefinition | undefined {
  return columnMap.get(columnId)
}

export function getOrchestrationDemoProgramDefinition(programId: string): ProgramDefinition | undefined {
  return programDefinitionMap.get(programId)
}

export function getOrchestrationDemoProgramsByColumn(channelId: string, columnId: string): ProgramDefinition[] {
  const column = columnMap.get(columnId)
  if (!column || column.channelId !== channelId) {
    return []
  }

  return orchestrationDemoProgramDefinitions.filter((item) => item.columnId === columnId)
}

export function getOrchestrationDemoInstancesByColumn(channelId: string, columnId: string): ProgramInstance[] {
  const allowedProgramIds = new Set(
    getOrchestrationDemoProgramsByColumn(channelId, columnId).map((item) => item.programId),
  )

  return orchestrationDemoProgramInstances.filter((item) => allowedProgramIds.has(item.programId))
}
