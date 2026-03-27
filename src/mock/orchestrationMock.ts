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
const yearCode = '26'

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
const pad = (value: number | string, size: number) => `${value}`.padStart(size, '0')

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
  { columnId: '109', columnName: '锚点', channelId: 'dragon', defaultProgramType: 'commentary' },
  { columnId: '123', columnName: '两说', channelId: 'dragon', defaultProgramType: 'commentary' },
  { columnId: '124', columnName: '梦想剧场', channelId: 'dragon', defaultProgramType: 'drama' },
]

export const orchestrationDemoProgramDefinitions: ProgramDefinition[] = [
  { programId: 'P115001', programName: '东方快报', columnId: '115', channelId: 'dragon', programType: 'news' },
  { programId: 'P101001', programName: '看东方', columnId: '101', channelId: 'dragon', programType: 'news_magazine' },
  { programId: 'P107001', programName: '潮童天下', columnId: '107', channelId: 'dragon', programType: 'kids' },
  { programId: 'P112001', programName: '纵有疾风起', columnId: '112', channelId: 'dragon', programType: 'drama', seriesGroup: '纵有疾风起' },
  { programId: 'P112002', programName: '边关烽火情', columnId: '112', channelId: 'dragon', programType: 'drama', seriesGroup: '边关烽火情' },
  { programId: 'P102001', programName: '午间30分', columnId: '102', channelId: 'dragon', programType: 'news' },
  { programId: 'P104001', programName: 'ShanghaiEye', columnId: '104', channelId: 'dragon', programType: 'news_magazine' },
  { programId: 'P105001', programName: '名医话养生', columnId: '105', channelId: 'dragon', programType: 'health' },
  { programId: 'P113001', programName: '烟火人家', columnId: '113', channelId: 'dragon', programType: 'drama', seriesGroup: '烟火人家' },
  { programId: 'P113002', programName: '城中之城', columnId: '113', channelId: 'dragon', programType: 'drama', seriesGroup: '城中之城' },
  { programId: 'P106001', programName: '东方新娱乐', columnId: '106', channelId: 'dragon', programType: 'entertainment' },
  { programId: 'P103001', programName: '东方新闻', columnId: '103', channelId: 'dragon', programType: 'news' },
  { programId: 'P118001', programName: '新闻联播', columnId: '118', channelId: 'dragon', programType: 'news' },
  { programId: 'P119001', programName: '玫瑰的故事', columnId: '119', channelId: 'dragon', programType: 'drama', seriesGroup: '玫瑰的故事' },
  { programId: 'P120001', programName: '东方看大剧', columnId: '120', channelId: 'dragon', programType: 'drama' },
  { programId: 'P121001', programName: '夜色正浓', columnId: '121', channelId: 'dragon', programType: 'drama', seriesGroup: '夜色正浓' },
  { programId: 'P122001', programName: '今晚', columnId: '122', channelId: 'dragon', programType: 'commentary' },
  { programId: 'P109001', programName: '锚点', columnId: '109', channelId: 'dragon', programType: 'commentary' },
  { programId: 'P123001', programName: '两说', columnId: '123', channelId: 'dragon', programType: 'commentary' },
  { programId: 'P124001', programName: '归路', columnId: '124', channelId: 'dragon', programType: 'drama', seriesGroup: '归路' },
]

export const orchestrationDemoProgramInstances: ProgramInstance[] = [
  { instanceId: 'I115001-0001', programId: 'P115001', episodeName: '东方快报 06时整点', duration: 900, issueNo: '0001' },
  { instanceId: 'I115001-0002', programId: 'P115001', episodeName: '东方快报 06时15分', duration: 900, issueNo: '0002' },
  { instanceId: 'I115001-0003', programId: 'P115001', episodeName: '东方快报 06时30分', duration: 900, issueNo: '0003' },
  { instanceId: 'I115001-0004', programId: 'P115001', episodeName: '东方快报 06时45分', duration: 900, issueNo: '0004' },
  { instanceId: 'I101001-0001', programId: 'P101001', episodeName: '看东方 早高峰版', duration: 3600, issueNo: '0001' },
  { instanceId: 'I101001-0002', programId: 'P101001', episodeName: '看东方 城市观察', duration: 2700, issueNo: '0002' },
  { instanceId: 'I101001-0003', programId: 'P101001', episodeName: '看东方 民生第一线', duration: 2700, issueNo: '0003' },
  { instanceId: 'I101001-0004', programId: 'P101001', episodeName: '看东方 特别策划：申城更新', duration: 1800, issueNo: '0004' },
  { instanceId: 'I107001-0001', programId: 'P107001', episodeName: '潮童天下', duration: 1800, issueNo: '0001' },
  { instanceId: 'I112001-0001', programId: 'P112001', episodeName: '品质剧场：纵有疾风起 第1集', duration: 2700, issueNo: '0001' },
  { instanceId: 'I112001-0002', programId: 'P112001', episodeName: '品质剧场：纵有疾风起 第2集', duration: 2700, issueNo: '0002' },
  { instanceId: 'I112001-0003', programId: 'P112001', episodeName: '品质剧场：纵有疾风起 第3集', duration: 2700, issueNo: '0003' },
  { instanceId: 'I112002-0001', programId: 'P112002', episodeName: '品质剧场：边关烽火情 第1集', duration: 2700, issueNo: '0001' },
  { instanceId: 'I102001-0001', programId: 'P102001', episodeName: '午间30分', duration: 1800, issueNo: '0001' },
  { instanceId: 'I104001-0001', programId: 'P104001', episodeName: 'ShanghaiEye 午间国际快讯', duration: 1800, issueNo: '0001' },
  { instanceId: 'I104001-0002', programId: 'P104001', episodeName: 'ShanghaiEye 夜线观察', duration: 1800, issueNo: '0002' },
  { instanceId: 'I105001-0001', programId: 'P105001', episodeName: '名医话养生·午后调养篇', duration: 1800, issueNo: '0001' },
  { instanceId: 'I105001-0002', programId: 'P105001', episodeName: '名医话养生·春季护肝篇', duration: 1800, issueNo: '0002' },
  { instanceId: 'I105001-0003', programId: 'P105001', episodeName: '名医话养生·傍晚轻养篇', duration: 900, issueNo: '0003' },
  { instanceId: 'I113001-0001', programId: 'P113001', episodeName: '经典剧场：烟火人家 第1集', duration: 2700, issueNo: '0001' },
  { instanceId: 'I113001-0002', programId: 'P113001', episodeName: '经典剧场：烟火人家 第2集', duration: 2700, issueNo: '0002' },
  { instanceId: 'I113002-0001', programId: 'P113002', episodeName: '经典剧场：城中之城 第1集', duration: 2700, issueNo: '0001' },
  { instanceId: 'I106001-0001', programId: 'P106001', episodeName: '东方新娱乐·当日热搜', duration: 900, issueNo: '0001' },
  { instanceId: 'I103001-0001', programId: 'P103001', episodeName: '东方新闻', duration: 1800, issueNo: '0001' },
  { instanceId: 'I118001-0001', programId: 'P118001', episodeName: '新闻联播', duration: 1800, issueNo: '0001' },
  { instanceId: 'I119001-0001', programId: 'P119001', episodeName: '东方剧场：玫瑰的故事 第1集', duration: 2700, issueNo: '0001' },
  { instanceId: 'I119001-0002', programId: 'P119001', episodeName: '东方剧场：玫瑰的故事 第2集', duration: 2700, issueNo: '0002' },
  { instanceId: 'I120001-0001', programId: 'P120001', episodeName: '东方看大剧', duration: 1800, issueNo: '0001' },
  { instanceId: 'I121001-0001', programId: 'P121001', episodeName: '品质东方微短剧：夜色正浓 上集', duration: 1800, issueNo: '0001' },
  { instanceId: 'I122001-0001', programId: 'P122001', episodeName: '今晚', duration: 1800, issueNo: '0001' },
  { instanceId: 'I109001-0001', programId: 'P109001', episodeName: '锚点·当日观察', duration: 1800, issueNo: '0001' },
  { instanceId: 'I123001-0001', programId: 'P123001', episodeName: '两说', duration: 1800, issueNo: '0001' },
  { instanceId: 'I124001-0001', programId: 'P124001', episodeName: '梦想剧场：归路 第1集', duration: 1800, issueNo: '0001' },
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

const buildProgramCode = (programId: string, issueNo?: string) => `01${yearCode}${programId.slice(-3)}${pad(issueNo ?? '1', 4)}`

const programDefinitionMap = new Map(orchestrationDemoProgramDefinitions.map((item) => [item.programId, item]))
const columnMap = new Map(orchestrationDemoColumns.map((item) => [item.columnId, item]))

export const orchestrationDemoCandidates: ProgramCandidate[] = orchestrationDemoProgramInstances.map((instance) => {
  const definition = programDefinitionMap.get(instance.programId)
  if (!definition) {
    throw new Error(`Unknown programId: ${instance.programId}`)
  }

  return {
    id: instance.instanceId,
    programId: definition.programId,
    programCode: buildProgramCode(definition.programId, instance.issueNo),
    programName: instance.episodeName || definition.programName,
    channelId: definition.channelId,
    duration: instance.duration,
    programType: definition.programType,
    issueNo: instance.issueNo,
    seriesGroup: definition.seriesGroup,
    episodeName: instance.episodeName,
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
  return orchestrationDemoProgramDefinitions.filter(
    (item) => item.channelId === channelId && item.columnId === columnId,
  )
}
