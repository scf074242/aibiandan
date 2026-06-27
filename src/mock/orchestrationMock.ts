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
import channelsData from './data/channels.json'
import columnsData from './data/columns.json'
import finishedProductsData from './data/finishedProducts.json'
import historySchedulesData from './data/historySchedules.json'
import layoutSlotsData from './data/layoutSlots.json'
import programDefinitionsData from './data/programDefinitions.json'

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

export const orchestrationDemoBaseDate = baseDate
export const orchestrationDemoRuntimeDate = getCurrentShanghaiDate()

const demoDateAliases = Array.from(new Set([orchestrationDemoBaseDate, orchestrationDemoRuntimeDate]))

type LayoutSlotSeed = Omit<LayoutSlot, 'startTime' | 'endTime'> & {
  startClock: string
  endClock: string
}

type FinishedProduct = {
  productId: string
  channelId: string
  productKind: 'program_instance' | 'short_video'
  title: string
  duration: number
  programId?: string
  programCode?: string
  issueNo?: string
  adBreaks?: ProgramInstance['adBreaks']
  contentTags?: string[]
  descriptionText?: string
  visualDescription?: string
  shotBreakdown?: string[]
}

export const orchestrationDemoChannels = channelsData
export const orchestrationDemoColumns = columnsData as ColumnDefinition[]
export const orchestrationDemoProgramDefinitions = programDefinitionsData as ProgramDefinition[]
export const orchestrationDemoFinishedProducts = finishedProductsData as FinishedProduct[]
export const orchestrationDemoProgramInstances: ProgramInstance[] = orchestrationDemoFinishedProducts
  .filter((product) => product.productKind === 'program_instance')
  .map((product) => ({
    instanceId: product.productId,
    programId: product.programId ?? '',
    programCode: product.programCode ?? '',
    instanceName: product.title,
    duration: product.duration,
    issueNo: product.issueNo,
    adBreaks: product.adBreaks,
  }))

const layoutSeeds = layoutSlotsData as LayoutSlotSeed[]

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

export const orchestrationDemoHistorySchedules: Record<string, ScheduleSummary[]> = Object.fromEntries(
  demoDateAliases.map((date) => [`dragon_${date}`, historySchedulesData as ScheduleSummary[]]),
)

const programDefinitionMap = new Map(orchestrationDemoProgramDefinitions.map((item) => [item.programId, item]))
const columnMap = new Map(orchestrationDemoColumns.map((item) => [item.columnId, item]))

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0

const buildCandidateContentTags = (input: {
  programName: string
  instanceName: string
  columnName: string
  programType: string
  programCode?: string
}): string[] => {
  const text = `${input.programName} ${input.instanceName} ${input.columnName}`
  const tags = new Set<string>([
    input.programName,
    input.columnName,
    input.programType,
  ])
  if (!input.programCode) {
    tags.add('无节目编号')
  }
  ;[
    '静安寺',
    '外滩',
    '发布会',
    '展会',
    '论坛',
    '会场',
    '户外直播',
    '外场直播',
    '现场直播',
    '直播',
    '预热',
    '预告',
    '导视',
    '短片',
    '暖场',
    '集锦',
    '花絮',
    '回看',
    '春日花路',
    '夜景',
    '宣传片',
    '旅游景点',
    '景点',
    '陆家嘴',
    '便民服务',
    '出行提醒',
    '文化',
    '博物馆',
    '音乐节',
    '视频',
    '城市服务',
    '民生',
    '交通',
    '天气',
    '社区',
    '公益',
    '健康',
    '养生',
    '综艺',
    '娱乐',
    '纪实',
    '纪录片',
  ].forEach((keyword) => {
    if (text.includes(keyword)) {
      tags.add(keyword)
    }
  })

  return Array.from(tags).filter(Boolean)
}

const hashText = (value: string): number =>
  value.split('').reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) % 100000, 17)

const buildCandidatePopularityMetrics = (input: {
  programCode: string
  programType: string
  duration: number
  contentTags: string[]
}) => {
  const typeBaseRating: Record<string, number> = {
    news: 7.2,
    news_magazine: 7.8,
    drama: 8.1,
    entertainment: 7.5,
    health: 6.9,
    commentary: 6.7,
    kids: 6.4,
    documentary: 6.8,
  }
  const typeBasePlayCount: Record<string, number> = {
    news: 78000,
    news_magazine: 86000,
    drama: 118000,
    entertainment: 94000,
    health: 52000,
    commentary: 56000,
    kids: 48000,
    documentary: 50000,
  }
  const hash = hashText(`${input.programCode}-${input.contentTags.join('|')}`)
  const topicBonus = input.contentTags.some((tag) => ['静安寺', '发布会', '直播', '外场直播', '户外直播'].includes(tag)) ? 9000 : 0
  const durationBonus = input.duration >= 1800 && input.duration <= 3600 ? 6000 : 0
  const playCount = (typeBasePlayCount[input.programType] ?? 60000)
    + (hash % 23000)
    + topicBonus
    + durationBonus
  const estimatedRating = Math.round(((typeBaseRating[input.programType] ?? 6.5) + ((hash % 18) / 10) + (topicBonus ? 0.3 : 0)) * 10) / 10
  const popularityScore = Math.round(Math.min(100, (playCount / 150000) * 70 + estimatedRating * 3) * 10) / 10

  return { estimatedRating, playCount, popularityScore }
}

export const orchestrationDemoCandidates: ProgramCandidate[] = [
  ...orchestrationDemoProgramInstances.map((instance) => {
    const definition = programDefinitionMap.get(instance.programId)
    if (!definition) {
      throw new Error(`Unknown programId: ${instance.programId}`)
    }

    const column = columnMap.get(definition.columnId)
    if (!column) {
      throw new Error(`Unknown columnId: ${definition.columnId}`)
    }
    const contentTags = buildCandidateContentTags({
      programName: definition.programName,
      instanceName: instance.instanceName,
      columnName: column.columnName,
      programType: definition.programType,
      programCode: instance.programCode,
    })
    const popularityMetrics = buildCandidatePopularityMetrics({
      programCode: instance.programCode || instance.instanceId,
      programType: definition.programType,
      duration: instance.duration,
      contentTags,
    })

    return {
      id: instance.instanceId,
      programId: definition.programId,
      programCode: instance.programCode,
      programName: instance.instanceName,
      channelId: column.channelId,
      columnId: column.columnId,
      columnName: column.columnName,
      duration: instance.duration,
      programType: definition.programType,
      issueNo: instance.issueNo,
      instanceName: instance.instanceName,
      contentTags,
      ...popularityMetrics,
      adBreaks: instance.adBreaks,
    }
  }),
  ...orchestrationDemoFinishedProducts.filter((product) => product.productKind === 'short_video').map((asset) => {
    const contentTags = Array.from(new Set([
      asset.title,
      asset.productKind,
      ...(asset.contentTags ?? []),
      asset.descriptionText,
      asset.visualDescription,
      ...(asset.shotBreakdown ?? []),
    ])).filter(isNonEmptyString)
    return {
      id: asset.productId,
      programId: asset.productId,
      programCode: '',
      programName: asset.title,
      channelId: asset.channelId,
      duration: asset.duration,
      programType: 'short_clip',
      instanceName: asset.title,
      contentTags,
      ...buildCandidatePopularityMetrics({
        programCode: asset.productId,
        programType: 'short_clip',
        duration: asset.duration,
        contentTags,
      }),
    }
  }),
]

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
