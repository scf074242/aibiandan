import type {
  ColumnDefinition,
  FixedItem,
  LayoutReference,
  ProgramCandidate,
  ScheduleSummary,
} from '@/types/orchestration'
import type { CollaborativeScheduleDetail, ScheduleItem } from '@/views/broadcast-plan/scheduleData'

export interface DemoChannel {
  id: string
  name: string
  code: string
  timeZone: string
  defaultStartTime: string
  defaultEndTime: string
  editorialBias: string[]
}

export interface DemoAtomicScenario {
  id: string
  title: string
  description: string
  itemIds: string[]
}

const today = '2026-03-25'
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

export const demoBaseDate = today
export const demoRuntimeDate = getCurrentShanghaiDate()

const iso = (date: string, time: string) => `${date}T${time}+08:00`
const pad = (value: number | string, size: number) => `${value}`.padStart(size, '0')

const formatPlayLength = (seconds: number): string => {
  if (seconds % 3600 === 0) return `${seconds / 3600}小时`
  if (seconds % 60 === 0) return `${seconds / 60}分钟`
  return `${seconds}秒`
}

const buildProgramCode = (groupCode: string, issue: number) => `01${yearCode}${groupCode}${pad(issue, 4)}`

type BandSeed = {
  groupCode: string
  slotLabel: string
  programType: string
  preferredKeywords: string[]
  preferredProgramGroup?: string
  editorialBias: string[]
  preferredSlots: string[]
  isFixedBand?: boolean
}

type ProgramSeed = {
  name: string
  duration: number
  tags?: string[]
  editorialWeight?: number
  preferredSlot?: string
  seriesGroup?: string
  rating?: number
  source?: ProgramCandidate['source']
  description?: string
  metadata?: Record<string, unknown>
}

const dragonBandSeeds: BandSeed[] = [
  {
    groupCode: '101',
    slotLabel: '看东方',
    programType: 'news_magazine',
    preferredKeywords: ['看东方', '早间', '资讯', '民生', '上海'],
    preferredProgramGroup: '看东方',
    editorialBias: ['资讯', '民生', '上海', '新闻'],
    preferredSlots: ['07:00-09:00'],
    isFixedBand: true,
  },
  {
    groupCode: '102',
    slotLabel: '午间30分',
    programType: 'news',
    preferredKeywords: ['午间30分', '午间', '新闻', '快讯'],
    preferredProgramGroup: '午间30分',
    editorialBias: ['午间', '新闻', '快讯'],
    preferredSlots: ['12:00-12:30'],
    isFixedBand: true,
  },
  {
    groupCode: '103',
    slotLabel: '东方新闻',
    programType: 'news',
    preferredKeywords: ['东方新闻', '晚间', '新闻', '深度'],
    preferredProgramGroup: '东方新闻',
    editorialBias: ['晚间', '新闻', '深度'],
    preferredSlots: ['18:30-19:00'],
    isFixedBand: true,
  },
  {
    groupCode: '104',
    slotLabel: 'ShanghaiEye',
    programType: 'news_magazine',
    preferredKeywords: ['ShanghaiEye', '国际', '都市', '双语资讯'],
    preferredProgramGroup: 'ShanghaiEye',
    editorialBias: ['国际', '双语资讯', '都市'],
    preferredSlots: ['12:30-13:00'],
    isFixedBand: true,
  },
  {
    groupCode: '105',
    slotLabel: '名医话养生',
    programType: 'health',
    preferredKeywords: ['名医话养生', '健康', '养生', '服务'],
    preferredProgramGroup: '名医话养生',
    editorialBias: ['健康', '养生', '服务'],
    preferredSlots: ['13:00-13:30', '17:45-18:00'],
    isFixedBand: true,
  },
  {
    groupCode: '106',
    slotLabel: '东方新娱乐',
    programType: 'entertainment',
    preferredKeywords: ['东方新娱乐', '娱乐', '都市', '明星'],
    preferredProgramGroup: '东方新娱乐',
    editorialBias: ['娱乐', '都市', '明星'],
    preferredSlots: ['17:30-17:45'],
    isFixedBand: true,
  },
  {
    groupCode: '107',
    slotLabel: '动画片/潮童天下',
    programType: 'kids',
    preferredKeywords: ['动画片', '潮童天下', '少儿', '亲子'],
    preferredProgramGroup: '潮童天下',
    editorialBias: ['少儿', '亲子', '成长'],
    preferredSlots: ['09:00-09:30'],
    isFixedBand: true,
  },
  {
    groupCode: '108',
    slotLabel: '1+1旅行记',
    programType: 'travel',
    preferredKeywords: ['1+1旅行记', '旅行', '文旅', '自然'],
    preferredProgramGroup: '1+1旅行记',
    editorialBias: ['文旅', '旅行', '城市'],
    preferredSlots: ['全天'],
    isFixedBand: false,
  },
  {
    groupCode: '109',
    slotLabel: '锚点',
    programType: 'commentary',
    preferredKeywords: ['锚点', '评论', '观察', '时政'],
    preferredProgramGroup: '锚点',
    editorialBias: ['评论', '时政', '观察'],
    preferredSlots: ['22:30-23:00'],
    isFixedBand: true,
  },
  {
    groupCode: '110',
    slotLabel: '新纪实',
    programType: 'documentary',
    preferredKeywords: ['新纪实', '纪实', '人文', '城市'],
    preferredProgramGroup: '新纪实',
    editorialBias: ['纪实', '人文', '上海'],
    preferredSlots: ['全天'],
    isFixedBand: false,
  },
  {
    groupCode: '111',
    slotLabel: '中国考古报道',
    programType: 'documentary',
    preferredKeywords: ['中国考古报道', '考古', '文化', '纪录片'],
    preferredProgramGroup: '中国考古报道',
    editorialBias: ['文化', '考古', '纪实'],
    preferredSlots: ['全天'],
    isFixedBand: false,
  },
  {
    groupCode: '112',
    slotLabel: '品质剧场',
    programType: 'drama',
    preferredKeywords: ['品质剧场', '电视剧', '剧场'],
    preferredProgramGroup: '品质剧场',
    editorialBias: ['剧场', '电视剧', '品质'],
    preferredSlots: ['09:30-12:00'],
    isFixedBand: true,
  },
  {
    groupCode: '113',
    slotLabel: '经典剧场',
    programType: 'drama',
    preferredKeywords: ['经典剧场', '电视剧', '剧场'],
    preferredProgramGroup: '经典剧场',
    editorialBias: ['剧场', '电视剧', '经典'],
    preferredSlots: ['13:30-17:30'],
    isFixedBand: true,
  },
  {
    groupCode: '114',
    slotLabel: '爱上海',
    programType: 'lifestyle',
    preferredKeywords: ['爱上海', '城市', '生活'],
    preferredProgramGroup: '爱上海',
    editorialBias: ['城市', '生活', '上海'],
    preferredSlots: ['全天'],
    isFixedBand: false,
  },
  {
    groupCode: '115',
    slotLabel: '东方快报',
    programType: 'news',
    preferredKeywords: ['快报', '整点', '新闻'],
    preferredProgramGroup: '东方快报',
    editorialBias: ['快讯', '整点', '新闻'],
    preferredSlots: ['06:00-07:00'],
    isFixedBand: true,
  },
  {
    groupCode: '116',
    slotLabel: '频道包装',
    programType: 'promo',
    preferredKeywords: ['宣传片', 'ID', '包装'],
    preferredProgramGroup: '频道包装',
    editorialBias: ['宣传片', 'ID', '包装'],
    preferredSlots: ['全天'],
    isFixedBand: false,
  },
  {
    groupCode: '117',
    slotLabel: '广告与填充',
    programType: 'ad',
    preferredKeywords: ['广告', '填充', '衔接'],
    preferredProgramGroup: '广告块',
    editorialBias: ['广告', '衔接', '填充'],
    preferredSlots: ['全天'],
    isFixedBand: false,
  },
  {
    groupCode: '118',
    slotLabel: '新闻联播',
    programType: 'news',
    preferredKeywords: ['新闻联播', '联播', '时政', '要闻'],
    preferredProgramGroup: '新闻联播',
    editorialBias: ['联播', '时政', '要闻'],
    preferredSlots: ['19:00-19:30'],
    isFixedBand: true,
  },
  {
    groupCode: '119',
    slotLabel: '东方剧场',
    programType: 'drama',
    preferredKeywords: ['东方剧场', '电视剧', '剧场'],
    preferredProgramGroup: '东方剧场',
    editorialBias: ['剧场', '电视剧', '首播'],
    preferredSlots: ['19:30-21:00'],
    isFixedBand: true,
  },
  {
    groupCode: '120',
    slotLabel: '东方看大剧',
    programType: 'drama',
    preferredKeywords: ['东方看大剧', '电视剧', '导视'],
    preferredProgramGroup: '东方看大剧',
    editorialBias: ['剧场', '电视剧', '导视'],
    preferredSlots: ['21:00-21:30'],
    isFixedBand: true,
  },
  {
    groupCode: '121',
    slotLabel: '品质东方微短剧',
    programType: 'drama',
    preferredKeywords: ['品质东方微短剧', '微短剧', '短剧'],
    preferredProgramGroup: '品质东方微短剧',
    editorialBias: ['短剧', '剧场', '品质'],
    preferredSlots: ['21:30-22:00'],
    isFixedBand: true,
  },
  {
    groupCode: '122',
    slotLabel: '今晚',
    programType: 'commentary',
    preferredKeywords: ['今晚', '评论', '热点', '访谈'],
    preferredProgramGroup: '今晚',
    editorialBias: ['评论', '热点', '访谈'],
    preferredSlots: ['22:00-22:30'],
    isFixedBand: true,
  },
  {
    groupCode: '123',
    slotLabel: '两说',
    programType: 'commentary',
    preferredKeywords: ['两说', '评论', '观点', '对谈'],
    preferredProgramGroup: '两说',
    editorialBias: ['评论', '观点', '对谈'],
    preferredSlots: ['23:00-23:30'],
    isFixedBand: true,
  },
  {
    groupCode: '124',
    slotLabel: '梦想剧场',
    programType: 'drama',
    preferredKeywords: ['梦想剧场', '电视剧', '剧场'],
    preferredProgramGroup: '梦想剧场',
    editorialBias: ['剧场', '电视剧', '夜间'],
    preferredSlots: ['23:30-23:59:59'],
    isFixedBand: true,
  },
]

const bandMap = new Map(dragonBandSeeds.map((band) => [band.groupCode, band]))
const issueCounters = new Map<string, number>()

const nextIssue = (groupCode: string) => {
  const current = issueCounters.get(groupCode) ?? 0
  const next = current + 1
  issueCounters.set(groupCode, next)
  return next
}

const makeProgram = (groupCode: string, seed: ProgramSeed): ProgramCandidate => {
  const band = bandMap.get(groupCode)
  if (!band) {
    throw new Error(`Unknown groupCode: ${groupCode}`)
  }

  const issue = nextIssue(groupCode)
  const programCode = buildProgramCode(groupCode, issue)

  return {
    id: `${groupCode}-${pad(issue, 4)}`,
    programCode,
    programName: seed.name,
    channelId: 'dragon',
    channelName: '东方卫视',
    columnId: groupCode,
    columnCode: `DRAGON-${groupCode}`,
    columnName: band.slotLabel,
    duration: seed.duration,
    programType: band.programType,
    yearCode,
    issueNo: pad(issue, 4),
    seriesGroup: seed.seriesGroup ?? band.preferredProgramGroup,
    editorialWeight: seed.editorialWeight ?? 80,
    preferredSlot: seed.preferredSlot ?? band.preferredSlots[0],
    rating: seed.rating ?? 8.0,
    description: seed.description,
    tags: seed.tags ?? [],
    source: seed.source ?? 'library',
    metadata: {
      channelIds: ['dragon'],
      groupCode,
      slotLabel: band.slotLabel,
      preferredProgramGroup: band.preferredProgramGroup,
      preferredSlot: seed.preferredSlot ?? band.preferredSlots[0],
      editorialBias: band.editorialBias,
      ...seed.metadata,
    },
  }
}

const dramaEpisodes = (groupCode: string, seriesGroup: string, prefix: string, episodes: number[]): ProgramCandidate[] =>
  episodes.map((episode) =>
    makeProgram(groupCode, {
      name: `${prefix} 第${episode}集`,
      duration: 2700,
      tags: ['剧场', '电视剧', seriesGroup],
      editorialWeight: 84,
      preferredSlot: episode % 2 === 1 ? '19:30-20:15' : '20:15-21:00',
      rating: 8.7,
      seriesGroup,
    }),
  )

export const demoChannels: DemoChannel[] = [
  {
    id: 'dragon',
    name: '东方卫视',
    code: 'DRAGON',
    timeZone: 'Asia/Shanghai',
    defaultStartTime: '06:00:00',
    defaultEndTime: '23:59:59',
    editorialBias: ['新闻', '资讯', '纪实', '剧场'],
  },
]

export const demoColumns: ColumnDefinition[] = dragonBandSeeds.map((band) => ({
  columnId: band.groupCode,
  columnCode: `REF-${band.groupCode}`,
  columnName: band.slotLabel,
  channelId: 'dragon',
  defaultProgramType: band.programType,
  editorialBias: band.editorialBias,
  preferredSlots: band.preferredSlots,
  isFixedBand: band.isFixedBand ?? false,
}))

export const demoPrograms: ProgramCandidate[] = [
  makeProgram('115', {
    name: '东方快报 06时整点',
    duration: 900,
    tags: ['快讯', '整点', '新闻'],
    preferredSlot: '06:00-06:15',
    editorialWeight: 90,
    rating: 8.5,
  }),
  makeProgram('115', {
    name: '东方快报 06时15分',
    duration: 900,
    tags: ['快讯', '民生', '新闻'],
    preferredSlot: '06:15-06:30',
    editorialWeight: 89,
    rating: 8.4,
  }),
  makeProgram('115', {
    name: '东方快报 06时30分',
    duration: 900,
    tags: ['快讯', '上海', '新闻'],
    preferredSlot: '06:30-06:45',
    editorialWeight: 88,
    rating: 8.3,
  }),
  makeProgram('115', {
    name: '东方快报 06时45分',
    duration: 900,
    tags: ['快讯', '服务', '新闻'],
    preferredSlot: '06:45-07:00',
    editorialWeight: 88,
    rating: 8.3,
  }),

  makeProgram('101', {
    name: '看东方 早高峰版',
    duration: 3600,
    tags: ['看东方', '早间', '民生', '上海'],
    preferredSlot: '07:00-08:00',
    editorialWeight: 96,
    rating: 9.3,
  }),
  makeProgram('101', {
    name: '看东方 城市观察',
    duration: 2700,
    tags: ['看东方', '上海', '资讯'],
    preferredSlot: '08:00-08:45',
    editorialWeight: 94,
    rating: 9.0,
  }),
  makeProgram('101', {
    name: '看东方 民生深一度',
    duration: 2700,
    tags: ['看东方', '民生', '深度'],
    preferredSlot: '08:45-09:30',
    editorialWeight: 93,
    rating: 8.9,
  }),
  makeProgram('101', {
    name: '看东方 特别策划：申城更新',
    duration: 1800,
    tags: ['看东方', '上海', '专题'],
    preferredSlot: '09:00-09:30',
    editorialWeight: 91,
    rating: 8.8,
  }),

  makeProgram('107', {
    name: '潮童天下',
    duration: 1800,
    tags: ['少儿', '亲子', '成长'],
    preferredSlot: '09:30-10:00',
    editorialWeight: 76,
    rating: 7.9,
  }),
  makeProgram('107', {
    name: '潮童天下·童言看世界',
    duration: 1500,
    tags: ['少儿', '国际', '亲子'],
    preferredSlot: '10:00-10:25',
    editorialWeight: 74,
    rating: 7.8,
  }),

  makeProgram('108', {
    name: '1+1旅行记·江南春日线',
    duration: 1800,
    tags: ['旅行', '文旅', '城市'],
    preferredSlot: '10:30-11:00',
    editorialWeight: 80,
    rating: 8.1,
  }),
  makeProgram('108', {
    name: '1+1旅行记·海岛慢行篇',
    duration: 1800,
    tags: ['旅行', '自然', '文旅'],
    preferredSlot: '11:00-11:30',
    editorialWeight: 79,
    rating: 8.0,
  }),

  makeProgram('104', {
    name: 'ShanghaiEye 午间国际快讯',
    duration: 1800,
    tags: ['ShanghaiEye', '国际', '双语资讯'],
    preferredSlot: '11:30-12:00',
    editorialWeight: 86,
    rating: 8.5,
  }),
  makeProgram('104', {
    name: 'ShanghaiEye 夜线观察',
    duration: 1800,
    tags: ['ShanghaiEye', '国际', '都市'],
    preferredSlot: '23:00-23:30',
    editorialWeight: 84,
    rating: 8.3,
  }),

  makeProgram('102', {
    name: '午间30分',
    duration: 1800,
    tags: ['午间', '新闻', '快讯'],
    preferredSlot: '12:30-13:00',
    editorialWeight: 97,
    rating: 9.1,
  }),
  makeProgram('102', {
    name: '午间30分 特别版',
    duration: 1800,
    tags: ['午间', '热点', '新闻'],
    preferredSlot: '12:30-13:00',
    editorialWeight: 92,
    rating: 8.8,
  }),

  makeProgram('111', {
    name: '中国考古报道·良渚新证',
    duration: 1800,
    tags: ['中国考古', '文化', '考古'],
    preferredSlot: '13:00-13:30',
    editorialWeight: 84,
    rating: 8.4,
  }),
  makeProgram('111', {
    name: '中国考古报道·海派文明源流',
    duration: 1800,
    tags: ['中国考古', '上海', '文化'],
    preferredSlot: '13:30-14:00',
    editorialWeight: 83,
    rating: 8.3,
  }),

  makeProgram('113', {
    name: '经典剧场：刀锋下的替身 第4集',
    duration: 2700,
    tags: ['经典剧场', '悬疑', '电视剧'],
    preferredSlot: '14:00-14:45',
    editorialWeight: 78,
    rating: 8.0,
    seriesGroup: '刀锋下的替身',
  }),
  makeProgram('113', {
    name: '经典剧场：刀锋下的替身 第5集',
    duration: 2700,
    tags: ['经典剧场', '悬疑', '电视剧'],
    preferredSlot: '14:45-15:30',
    editorialWeight: 78,
    rating: 8.0,
    seriesGroup: '刀锋下的替身',
  }),

  makeProgram('114', {
    name: '爱上海·城市漫步',
    duration: 900,
    tags: ['爱上海', '生活', '城市'],
    preferredSlot: '15:30-15:45',
    editorialWeight: 77,
    rating: 7.8,
  }),
  makeProgram('114', {
    name: '爱上海·夜色黄浦江',
    duration: 900,
    tags: ['爱上海', '上海', '生活'],
    preferredSlot: '15:45-16:00',
    editorialWeight: 76,
    rating: 7.7,
  }),

  makeProgram('106', {
    name: '东方新娱乐',
    duration: 1800,
    tags: ['娱乐', '都市', '明星'],
    preferredSlot: '16:30-17:00',
    editorialWeight: 80,
    rating: 8.0,
  }),
  makeProgram('106', {
    name: '东方新娱乐·城市秀场',
    duration: 1500,
    tags: ['娱乐', '城市', '秀场'],
    preferredSlot: '17:00-17:25',
    editorialWeight: 78,
    rating: 7.8,
  }),

  makeProgram('105', {
    name: '名医话养生·春季护肝篇',
    duration: 1800,
    tags: ['名医话养生', '健康', '养生'],
    preferredSlot: '17:30-18:00',
    editorialWeight: 89,
    rating: 8.8,
  }),
  makeProgram('105', {
    name: '名医话养生·睡眠修复篇',
    duration: 1800,
    tags: ['名医话养生', '健康', '睡眠'],
    preferredSlot: '17:30-18:00',
    editorialWeight: 88,
    rating: 8.7,
  }),

  makeProgram('103', {
    name: '东方新闻',
    duration: 1800,
    tags: ['晚间', '新闻', '深度'],
    preferredSlot: '18:30-19:00',
    editorialWeight: 98,
    rating: 9.4,
  }),
  makeProgram('103', {
    name: '东方新闻 深度版',
    duration: 1800,
    tags: ['晚间', '深度', '新闻'],
    preferredSlot: '18:30-19:00',
    editorialWeight: 94,
    rating: 9.0,
  }),

  ...dramaEpisodes('112', '纵有疾风起', '品质剧场：纵有疾风起', [1, 2, 3, 4]),
  ...dramaEpisodes('112', '边关烽火情', '品质剧场：边关烽火情', [5, 6]),

  makeProgram('109', {
    name: '锚点',
    duration: 2700,
    tags: ['评论', '观察', '时政'],
    preferredSlot: '21:15-22:00',
    editorialWeight: 90,
    rating: 8.9,
  }),
  makeProgram('109', {
    name: '锚点·全球焦点',
    duration: 2700,
    tags: ['评论', '国际', '观察'],
    preferredSlot: '21:15-22:00',
    editorialWeight: 88,
    rating: 8.7,
  }),

  makeProgram('110', {
    name: '新纪实·城市守夜人',
    duration: 1800,
    tags: ['纪实', '城市', '人物'],
    preferredSlot: '22:30-23:00',
    editorialWeight: 85,
    rating: 8.4,
  }),
  makeProgram('110', {
    name: '新纪实·申城夜归者',
    duration: 1800,
    tags: ['纪实', '上海', '人物'],
    preferredSlot: '23:00-23:30',
    editorialWeight: 84,
    rating: 8.3,
  }),


  makeProgram('105', {
    name: '名医话养生·傍晚轻养篇',
    duration: 900,
    tags: ['名医话养生', '健康', '养生'],
    preferredSlot: '17:45-18:00',
    editorialWeight: 86,
    rating: 8.5,
  }),
  makeProgram('105', {
    name: '名医话养生·午后调养篇',
    duration: 1800,
    tags: ['名医话养生', '健康', '养生'],
    preferredSlot: '13:00-13:30',
    editorialWeight: 87,
    rating: 8.6,
  }),
  makeProgram('106', {
    name: '东方新娱乐·当日热搜',
    duration: 900,
    tags: ['东方新娱乐', '娱乐', '热搜'],
    preferredSlot: '17:30-17:45',
    editorialWeight: 81,
    rating: 8.1,
  }),
  ...dramaEpisodes('113', '经典剧场：烟火人家', '经典剧场：烟火人家', [1, 2, 3, 4]),
  ...dramaEpisodes('113', '经典剧场：城中之城', '经典剧场：城中之城', [5, 6]),
  makeProgram('118', {
    name: '新闻联播',
    duration: 1800,
    tags: ['新闻联播', '联播', '要闻'],
    preferredSlot: '19:00-19:30',
    editorialWeight: 99,
    rating: 9.5,
  }),
  makeProgram('119', {
    name: '东方剧场：玫瑰的故事 第1集',
    duration: 2700,
    tags: ['东方剧场', '电视剧', '都市'],
    preferredSlot: '19:30-20:15',
    editorialWeight: 91,
    rating: 8.9,
    seriesGroup: '东方剧场：玫瑰的故事',
  }),
  makeProgram('119', {
    name: '东方剧场：玫瑰的故事 第2集',
    duration: 2700,
    tags: ['东方剧场', '电视剧', '都市'],
    preferredSlot: '20:15-21:00',
    editorialWeight: 91,
    rating: 8.9,
    seriesGroup: '东方剧场：玫瑰的故事',
  }),
  makeProgram('120', {
    name: '东方看大剧',
    duration: 1800,
    tags: ['东方看大剧', '电视剧', '导视'],
    preferredSlot: '21:00-21:30',
    editorialWeight: 86,
    rating: 8.4,
  }),
  makeProgram('121', {
    name: '品质东方微短剧：夜色正浓 上集',
    duration: 1800,
    tags: ['品质东方微短剧', '微短剧', '都市'],
    preferredSlot: '21:30-22:00',
    editorialWeight: 85,
    rating: 8.2,
    seriesGroup: '品质东方微短剧：夜色正浓',
  }),
  makeProgram('109', {
    name: '锚点·当日观察',
    duration: 1800,
    tags: ['锚点', '评论', '观察'],
    preferredSlot: '22:30-23:00',
    editorialWeight: 89,
    rating: 8.7,
  }),
  makeProgram('122', {
    name: '今晚',
    duration: 1800,
    tags: ['今晚', '评论', '热点'],
    preferredSlot: '22:00-22:30',
    editorialWeight: 88,
    rating: 8.6,
  }),
  makeProgram('123', {
    name: '两说',
    duration: 1800,
    tags: ['两说', '评论', '对谈'],
    preferredSlot: '23:00-23:30',
    editorialWeight: 86,
    rating: 8.4,
  }),
  makeProgram('124', {
    name: '梦想剧场：归路 第1集',
    duration: 1800,
    tags: ['梦想剧场', '电视剧', '夜间'],
    preferredSlot: '23:30-23:59:59',
    editorialWeight: 82,
    rating: 8.1,
    seriesGroup: '梦想剧场：归路',
  }),
  makeProgram('116', {
    name: '频道ID：就看东方卫视',
    duration: 15,
    tags: ['ID', '包装'],
    preferredSlot: '全天',
    source: 'filler',
    editorialWeight: 35,
    rating: 6.5,
  }),
  makeProgram('116', {
    name: '宣传片：东方卫视春季内容推荐',
    duration: 30,
    tags: ['宣传片', '包装'],
    preferredSlot: '全天',
    source: 'filler',
    editorialWeight: 36,
    rating: 6.4,
  }),
  makeProgram('117', {
    name: '广告组块 30秒',
    duration: 30,
    tags: ['广告', '组块'],
    preferredSlot: '全天',
    source: 'filler',
    editorialWeight: 20,
    rating: 5.8,
  }),
  makeProgram('117', {
    name: '广告组块 60秒',
    duration: 60,
    tags: ['广告', '组块'],
    preferredSlot: '全天',
    source: 'filler',
    editorialWeight: 18,
    rating: 5.7,
  }),
  makeProgram('117', {
    name: '栏目衔接短片 20秒',
    duration: 20,
    tags: ['填充', '衔接'],
    preferredSlot: '全天',
    source: 'filler',
    editorialWeight: 12,
    rating: 5.5,
  }),
  makeProgram('117', {
    name: '栏目衔接短片 5分钟',
    duration: 300,
    tags: ['填充', '衔接'],
    preferredSlot: '全天',
    source: 'filler',
    editorialWeight: 10,
    rating: 5.3,
  }),
]

const layoutSlots = [
  {
    id: 'dragon-0700',
    startTime: iso(today, '07:00:00'),
    endTime: iso(today, '09:00:00'),
    programType: 'news_magazine',
    slotLabel: '看东方',
    preferredProgramTypes: ['news_magazine', 'news', 'livelihood'],
    preferredKeywords: ['看东方', '早间', '资讯', '民生'],
    preferredProgramGroup: '看东方',
    priority: 1,
    editorialBias: ['资讯', '民生', '上海', '新闻'],
    isFixedBand: true,
    isWeakConstraint: false,
    fixedProgram: '看东方',
    columnId: '101',
    columnName: '看东方',
  },
  {
    id: 'dragon-0900',
    startTime: iso(today, '09:00:00'),
    endTime: iso(today, '09:30:00'),
    programType: 'kids',
    slotLabel: '动画片/潮童天下',
    preferredProgramTypes: ['kids', 'education'],
    preferredKeywords: ['动画片', '潮童天下', '少儿', '亲子'],
    preferredProgramGroup: '潮童天下',
    priority: 1,
    editorialBias: ['少儿', '亲子', '成长'],
    isFixedBand: true,
    isWeakConstraint: false,
    fixedProgram: '潮童天下',
    columnId: '107',
    columnName: '动画片/潮童天下',
  },
  {
    id: 'dragon-0930',
    startTime: iso(today, '09:30:00'),
    endTime: iso(today, '12:00:00'),
    programType: 'drama',
    slotLabel: '品质剧场',
    preferredProgramTypes: ['drama'],
    preferredKeywords: ['品质剧场', '电视剧', '剧场'],
    preferredProgramGroup: '品质剧场',
    priority: 1,
    editorialBias: ['剧场', '电视剧', '品质'],
    isFixedBand: false,
    isWeakConstraint: false,
    columnId: '112',
    columnName: '品质剧场',
  },
  {
    id: 'dragon-1200',
    startTime: iso(today, '12:00:00'),
    endTime: iso(today, '12:30:00'),
    programType: 'news',
    slotLabel: '午间30分',
    preferredProgramTypes: ['news', 'news_magazine'],
    preferredKeywords: ['午间30分', '午间', '新闻'],
    preferredProgramGroup: '午间30分',
    priority: 1,
    editorialBias: ['午间', '新闻'],
    isFixedBand: true,
    isWeakConstraint: false,
    fixedProgram: '午间30分',
    columnId: '102',
    columnName: '午间30分',
  },
  {
    id: 'dragon-1230',
    startTime: iso(today, '12:30:00'),
    endTime: iso(today, '13:00:00'),
    programType: 'news_magazine',
    slotLabel: 'ShanghaiEye',
    preferredProgramTypes: ['news_magazine', 'news'],
    preferredKeywords: ['ShanghaiEye', '国际', '都市'],
    preferredProgramGroup: 'ShanghaiEye',
    priority: 2,
    editorialBias: ['国际', '双语资讯', '都市'],
    isFixedBand: false,
    isWeakConstraint: false,
    columnId: '104',
    columnName: 'ShanghaiEye',
  },
  {
    id: 'dragon-1300',
    startTime: iso(today, '13:00:00'),
    endTime: iso(today, '13:30:00'),
    programType: 'health',
    slotLabel: '名医话养生',
    preferredProgramTypes: ['health', 'lifestyle'],
    preferredKeywords: ['名医话养生', '健康', '养生'],
    preferredProgramGroup: '名医话养生',
    priority: 2,
    editorialBias: ['健康', '养生'],
    isFixedBand: false,
    isWeakConstraint: false,
    columnId: '105',
    columnName: '名医话养生',
  },
  {
    id: 'dragon-1330',
    startTime: iso(today, '13:30:00'),
    endTime: iso(today, '17:30:00'),
    programType: 'drama',
    slotLabel: '经典剧场',
    preferredProgramTypes: ['drama'],
    preferredKeywords: ['经典剧场', '电视剧', '剧场'],
    preferredProgramGroup: '经典剧场',
    priority: 1,
    editorialBias: ['剧场', '电视剧', '经典'],
    isFixedBand: false,
    isWeakConstraint: false,
    columnId: '113',
    columnName: '经典剧场',
  },
  {
    id: 'dragon-1730',
    startTime: iso(today, '17:30:00'),
    endTime: iso(today, '17:45:00'),
    programType: 'entertainment',
    slotLabel: '东方新娱乐',
    preferredProgramTypes: ['entertainment', 'lifestyle'],
    preferredKeywords: ['东方新娱乐', '娱乐', '都市'],
    preferredProgramGroup: '东方新娱乐',
    priority: 2,
    editorialBias: ['娱乐', '都市'],
    isFixedBand: false,
    isWeakConstraint: false,
    columnId: '106',
    columnName: '东方新娱乐',
  },
  {
    id: 'dragon-1745',
    startTime: iso(today, '17:45:00'),
    endTime: iso(today, '18:00:00'),
    programType: 'health',
    slotLabel: '名医话养生',
    preferredProgramTypes: ['health', 'lifestyle'],
    preferredKeywords: ['名医话养生', '健康', '养生'],
    preferredProgramGroup: '名医话养生',
    priority: 2,
    editorialBias: ['健康', '养生'],
    isFixedBand: false,
    isWeakConstraint: false,
    columnId: '105',
    columnName: '名医话养生',
  },
  {
    id: 'dragon-1830',
    startTime: iso(today, '18:30:00'),
    endTime: iso(today, '19:00:00'),
    programType: 'news',
    slotLabel: '东方新闻',
    preferredProgramTypes: ['news', 'commentary'],
    preferredKeywords: ['东方新闻', '晚间', '新闻'],
    preferredProgramGroup: '东方新闻',
    priority: 1,
    editorialBias: ['晚间', '新闻'],
    isFixedBand: true,
    isWeakConstraint: false,
    fixedProgram: '东方新闻',
    columnId: '103',
    columnName: '东方新闻',
  },
  {
    id: 'dragon-1900',
    startTime: iso(today, '19:00:00'),
    endTime: iso(today, '19:30:00'),
    programType: 'news',
    slotLabel: '新闻联播',
    preferredProgramTypes: ['news'],
    preferredKeywords: ['新闻联播', '联播'],
    preferredProgramGroup: '新闻联播',
    priority: 1,
    editorialBias: ['联播', '时政'],
    isFixedBand: true,
    isWeakConstraint: false,
    fixedProgram: '新闻联播',
    columnId: '118',
    columnName: '新闻联播',
  },
  {
    id: 'dragon-1930',
    startTime: iso(today, '19:30:00'),
    endTime: iso(today, '21:00:00'),
    programType: 'drama',
    slotLabel: '东方剧场',
    preferredProgramTypes: ['drama'],
    preferredKeywords: ['东方剧场', '电视剧', '剧场'],
    preferredProgramGroup: '东方剧场',
    priority: 1,
    editorialBias: ['剧场', '电视剧', '首播'],
    isFixedBand: false,
    isWeakConstraint: false,
    columnId: '119',
    columnName: '东方剧场',
  },
  {
    id: 'dragon-2100',
    startTime: iso(today, '21:00:00'),
    endTime: iso(today, '21:30:00'),
    programType: 'drama',
    slotLabel: '东方看大剧',
    preferredProgramTypes: ['drama'],
    preferredKeywords: ['东方看大剧', '电视剧', '导视'],
    preferredProgramGroup: '东方看大剧',
    priority: 2,
    editorialBias: ['剧场', '电视剧', '导视'],
    isFixedBand: false,
    isWeakConstraint: false,
    columnId: '120',
    columnName: '东方看大剧',
  },
  {
    id: 'dragon-2130',
    startTime: iso(today, '21:30:00'),
    endTime: iso(today, '22:00:00'),
    programType: 'drama',
    slotLabel: '品质东方微短剧',
    preferredProgramTypes: ['drama'],
    preferredKeywords: ['品质东方微短剧', '微短剧', '短剧'],
    preferredProgramGroup: '品质东方微短剧',
    priority: 2,
    editorialBias: ['短剧', '品质'],
    isFixedBand: false,
    isWeakConstraint: false,
    columnId: '121',
    columnName: '品质东方微短剧',
  },
  {
    id: 'dragon-2200',
    startTime: iso(today, '22:00:00'),
    endTime: iso(today, '22:30:00'),
    programType: 'commentary',
    slotLabel: '今晚',
    preferredProgramTypes: ['commentary', 'news_magazine'],
    preferredKeywords: ['今晚', '评论', '热点'],
    preferredProgramGroup: '今晚',
    priority: 2,
    editorialBias: ['评论', '热点'],
    isFixedBand: false,
    isWeakConstraint: false,
    columnId: '122',
    columnName: '今晚',
  },
  {
    id: 'dragon-2230',
    startTime: iso(today, '22:30:00'),
    endTime: iso(today, '23:00:00'),
    programType: 'commentary',
    slotLabel: '锚点',
    preferredProgramTypes: ['commentary', 'news_magazine'],
    preferredKeywords: ['锚点', '评论', '观察'],
    preferredProgramGroup: '锚点',
    priority: 2,
    editorialBias: ['评论', '观察'],
    isFixedBand: false,
    isWeakConstraint: false,
    columnId: '109',
    columnName: '锚点',
  },
  {
    id: 'dragon-2300',
    startTime: iso(today, '23:00:00'),
    endTime: iso(today, '23:30:00'),
    programType: 'commentary',
    slotLabel: '两说',
    preferredProgramTypes: ['commentary'],
    preferredKeywords: ['两说', '评论'],
    preferredProgramGroup: '两说',
    priority: 2,
    editorialBias: ['评论'],
    isFixedBand: false,
    isWeakConstraint: false,
    columnId: '123',
    columnName: '两说',
  },
  {
    id: 'dragon-2330',
    startTime: iso(today, '23:30:00'),
    endTime: iso(today, '23:59:59'),
    programType: 'drama',
    slotLabel: '梦想剧场',
    preferredProgramTypes: ['drama'],
    preferredKeywords: ['梦想剧场', '电视剧', '剧场'],
    preferredProgramGroup: '梦想剧场',
    priority: 2,
    editorialBias: ['剧场', '电视剧', '夜间'],
    isFixedBand: false,
    isWeakConstraint: false,
    columnId: '124',
    columnName: '梦想剧场',
  },
]

const demoDateAliases = Array.from(new Set([today, demoRuntimeDate]))

const cloneSlotsForDate = (date: string) =>
  layoutSlots.map((slot) => ({
    ...slot,
    startTime: iso(date, slot.startTime.slice(11, 19)),
    endTime: iso(date, slot.endTime.slice(11, 19)),
  }))

export const demoLayouts: Record<string, LayoutReference> = Object.fromEntries(
  demoDateAliases.map((date) => [
    `dragon_${date}`,
    {
      id: `layout_dragon_${date}`,
      name: '东方卫视当前参考版面',
      slots: cloneSlotsForDate(date),
    },
  ]),
)

const baseHistorySchedules: ScheduleSummary[] = [
    {
      date: '2026-03-24',
      itemCount: 26,
      programTypes: {
        news: 6,
        news_magazine: 4,
        documentary: 3,
        drama: 5,
        health: 1,
        entertainment: 1,
        travel: 1,
        kids: 1,
        commentary: 1,
        promo: 2,
        ad: 1,
      },
      avgRating: 8.6,
    },
    {
      date: '2026-03-23',
      itemCount: 27,
      programTypes: {
        news: 6,
        news_magazine: 4,
        documentary: 3,
        drama: 6,
        health: 1,
        entertainment: 1,
        travel: 1,
        kids: 1,
        commentary: 1,
        promo: 2,
        ad: 1,
      },
      avgRating: 8.5,
    },
  ]

export const demoHistorySchedules: Record<string, ScheduleSummary[]> = Object.fromEntries(
  demoDateAliases.map((date) => [`dragon_${date}`, baseHistorySchedules]),
)

const fixedProgramByName = new Map<string, ProgramCandidate>()
for (const program of demoPrograms) {
  if (!fixedProgramByName.has(program.programName)) {
    fixedProgramByName.set(program.programName, program)
  }
}

export const demoFixedItems: Record<string, FixedItem[]> = Object.fromEntries(
  demoDateAliases.map((date) => [
    `dragon_${date}`,
    ['午间30分', '东方新闻'].flatMap((programName) => {
      const slot = cloneSlotsForDate(date).find((item) => item.fixedProgram === programName)
      const program = fixedProgramByName.get(programName)
      if (!slot || !program) return []
      return [{
        id: `fixed-${slot.id}`,
        programCode: program.programCode,
        startTime: slot.startTime,
        endTime: slot.endTime,
        isLocked: true,
      }]
    }),
  ]),
)

const makeScheduleItem = (
  source: ProgramCandidate,
  sortOrder: number,
  startTime: string,
  endTime: string,
  businessType: ScheduleItem['businessType'] = 'program',
): ScheduleItem => ({
  id: `schedule-${source.id}-${sortOrder}`,
  scheduleId: 'demo-dragon',
  startTime,
  endTime,
  programType: source.programType,
  episodeName: source.programName,
  programName: source.programName,
  businessType,
  sourceType: 'record',
  sortOrder,
  duration: source.duration,
  programCode: source.programCode,
  code18: source.programCode,
  materialStatus: 'ready',
  materialName: source.programType === 'ad' ? '待广告系统下发' : `${source.programCode}-MAT`,
  playLength: formatPlayLength(source.duration),
  relativeStart: '00:00:00',
  keySlot: source.columnCode,
  studio: ['news', 'news_magazine', 'commentary'].includes(source.programType) ? '新闻演播室' : '-',
  omniBroadcastRight: '允许',
})

const scheduleSeed = [
  { programName: '东方快报 06时整点', startTime: '06:00:00', endTime: '06:15:00' },
  { programName: '东方快报 06时15分', startTime: '06:15:00', endTime: '06:30:00' },
  { programName: '看东方 早高峰版', startTime: '07:00:00', endTime: '08:00:00' },
  { programName: '看东方 城市观察', startTime: '08:00:00', endTime: '08:45:00' },
  { programName: '午间30分', startTime: '12:30:00', endTime: '13:00:00' },
  { programName: '中国考古报道·良渚新证', startTime: '13:00:00', endTime: '13:30:00' },
  { programName: '经典剧场：刀锋下的替身 第4集', startTime: '14:00:00', endTime: '14:45:00' },
  { programName: '爱上海·城市漫步', startTime: '15:30:00', endTime: '15:45:00' },
  { programName: '东方新娱乐', startTime: '16:30:00', endTime: '17:00:00' },
  { programName: '名医话养生·春季护肝篇', startTime: '17:30:00', endTime: '18:00:00' },
  { programName: '东方新闻', startTime: '18:30:00', endTime: '19:00:00' },
  { programName: '品质剧场：纵有疾风起 第1集', startTime: '19:30:00', endTime: '20:15:00' },
  { programName: '品质剧场：纵有疾风起 第2集', startTime: '20:15:00', endTime: '21:00:00' },
  { programName: '锚点', startTime: '21:15:00', endTime: '22:00:00' },
  { programName: '新纪实·城市守夜人', startTime: '22:30:00', endTime: '23:00:00' },
]

export const demoScheduleItems: ScheduleItem[] = scheduleSeed
  .map((seed, index) => {
    const program = fixedProgramByName.get(seed.programName)
    if (!program) return null
    return makeScheduleItem(program, index + 1, seed.startTime, seed.endTime)
  })
  .filter((item): item is ScheduleItem => Boolean(item))

export const demoAtomicScenarios: DemoAtomicScenario[] = [
  {
    id: 'same-band-replace',
    title: '同版面参考时段替换',
    description: '将早间资讯时段中的节目替换为另一档看东方特别策划版，验证时间锚点保持稳定。',
    itemIds: demoScheduleItems.filter((item) => item.programName?.includes('看东方')).map((item) => item.id),
  },
  {
    id: 'cross-band-move',
    title: '跨参考时段移动',
    description: '将爱上海移动到下午晚些时候，验证 sequence 和时间链路重排。',
    itemIds: demoScheduleItems.filter((item) => item.programName?.includes('爱上海')).map((item) => item.id),
  },
  {
    id: 'delete-gap',
    title: '删除后产生空窗',
    description: '删除名医话养生后产生傍晚空窗，验证 gap 计算。',
    itemIds: demoScheduleItems.filter((item) => item.programName?.includes('名医话养生')).map((item) => item.id),
  },
]

export const demoScheduleDetail = (id: string): CollaborativeScheduleDetail => ({
  id,
  name: '东方卫视演示编单',
  channelId: 'dragon',
  channelName: '东方卫视',
  date: demoBaseDate,
  editor: '当前用户',
  editorId: 'current-user',
  status: 'draft',
  isLocked: false,
  items: demoScheduleItems.map((item) => ({ ...item })),
})

const getLatestAvailableKey = <T>(record: Record<string, T>, channelId: string): string | null => {
  const keys = Object.keys(record)
    .filter((key) => key.startsWith(`${channelId}_`))
    .sort((left, right) => right.localeCompare(left))
  return keys[0] ?? null
}

export function getDemoLayout(channelId: string, date: string): LayoutReference | null {
  const exact = demoLayouts[`${channelId}_${date}`]
  if (exact) return exact
  const fallbackKey = getLatestAvailableKey(demoLayouts, channelId)
  return fallbackKey ? (demoLayouts[fallbackKey] ?? null) : null
}

export function getDemoHistorySchedules(channelId: string, date: string): ScheduleSummary[] {
  const exact = demoHistorySchedules[`${channelId}_${date}`]
  if (exact) return exact
  const fallbackKey = getLatestAvailableKey(demoHistorySchedules, channelId)
  return fallbackKey ? (demoHistorySchedules[fallbackKey] ?? []) : []
}

export function getDemoFixedItems(channelId: string, date: string): FixedItem[] {
  const exact = demoFixedItems[`${channelId}_${date}`]
  if (exact) return exact
  const fallbackKey = getLatestAvailableKey(demoFixedItems, channelId)
  return fallbackKey ? (demoFixedItems[fallbackKey] ?? []) : []
}
