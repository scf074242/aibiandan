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
  { columnId: '112', columnName: '品质剧场', channelId: 'dragon', defaultProgramType: 'drama', isSequential: true },
  { columnId: '102', columnName: '午间30分', channelId: 'dragon', defaultProgramType: 'news' },
  { columnId: '104', columnName: 'ShanghaiEye', channelId: 'dragon', defaultProgramType: 'news_magazine' },
  { columnId: '105', columnName: '名医话养生', channelId: 'dragon', defaultProgramType: 'health' },
  { columnId: '113', columnName: '经典剧场', channelId: 'dragon', defaultProgramType: 'drama', isSequential: true },
  { columnId: '106', columnName: '东方新娱乐', channelId: 'dragon', defaultProgramType: 'entertainment' },
  { columnId: '103', columnName: '东方新闻', channelId: 'dragon', defaultProgramType: 'news' },
  { columnId: '118', columnName: '新闻联播', channelId: 'dragon', defaultProgramType: 'news' },
  { columnId: '119', columnName: '东方剧场', channelId: 'dragon', defaultProgramType: 'drama', isSequential: true },
  { columnId: '120', columnName: '东方看大剧', channelId: 'dragon', defaultProgramType: 'drama', isSequential: true },
  { columnId: '121', columnName: '品质东方微短剧', channelId: 'dragon', defaultProgramType: 'drama', isSequential: true },
  { columnId: '122', columnName: '今晚', channelId: 'dragon', defaultProgramType: 'commentary' },
  { columnId: '109', columnName: '锵点', channelId: 'dragon', defaultProgramType: 'commentary' },
  { columnId: '123', columnName: '两说', channelId: 'dragon', defaultProgramType: 'commentary' },
  { columnId: '124', columnName: '梦想剧场', channelId: 'dragon', defaultProgramType: 'drama', isSequential: true },
  { columnId: '125', columnName: '东方纪实', channelId: 'dragon', defaultProgramType: 'documentary' },
  { columnId: '900', columnName: '轮播短片', channelId: 'dragon', defaultProgramType: 'short_clip' },
]

const seedProgramDefinitions: ProgramDefinition[] = [
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

const seedProgramInstances: ProgramInstance[] = [
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

type GeneratedProgramSeries = {
  columnId: string
  codePrefix: string
  duration: number
  episodeCount: number
  programType: string
  titles: string[]
}

const generatedProgramSeries: GeneratedProgramSeries[] = [
  {
    columnId: '115',
    codePrefix: '115',
    duration: 900,
    episodeCount: 24,
    programType: 'news',
    titles: ['东方快报', '上海早新闻', '长三角快讯', '民生速递'],
  },
  {
    columnId: '101',
    codePrefix: '101',
    duration: 1800,
    episodeCount: 12,
    programType: 'news_magazine',
    titles: [
      '看东方·城市更新',
      '看东方·民生现场',
      '看东方·长三角时间',
      '看东方·创新上海',
      '看东方·海派生活',
      '静安寺外场直播',
      '外滩活动直播',
      '发布会现场直播',
      '发布会预热导视',
      '展会直播直击',
      '城市活动预热导视',
      '上海现场集锦',
      '大型活动回看精选',
      '会前暖场短片',
      '直播花絮集锦',
    ],
  },
  {
    columnId: '101',
    codePrefix: '131',
    duration: 600,
    episodeCount: 8,
    programType: 'news_magazine',
    titles: [
      '现场导视',
      '静安寺外场导视',
      '户外直播服务提醒',
      '发布会预热导视',
      '会场直播开场导视',
      '城市活动暖场短片',
      '直播路线服务提示',
      '外场连线预告',
    ],
  },
  {
    columnId: '101',
    codePrefix: '132',
    duration: 3000,
    episodeCount: 6,
    programType: 'news_magazine',
    titles: [
      '静安寺户外直播',
      '静安寺商圈慢直播',
      '外场活动直播特别版',
      '发布会现场直播特别版',
    ],
  },
  {
    columnId: '107',
    codePrefix: '107',
    duration: 1800,
    episodeCount: 10,
    programType: 'kids',
    titles: ['潮童天下', '成长进行时', '少年梦工厂', '童声看世界', '亲子周末'],
  },
  {
    columnId: '112',
    codePrefix: '112',
    duration: 2700,
    episodeCount: 32,
    programType: 'drama',
    titles: ['繁花', '问心', '纵有疾风起', '追光的日子', '大江大河', '小欢喜'],
  },
  {
    columnId: '102',
    codePrefix: '102',
    duration: 1800,
    episodeCount: 20,
    programType: 'news',
    titles: ['午间30分', '午间新闻眼', '午间上海', '午间长三角'],
  },
  {
    columnId: '104',
    codePrefix: '104',
    duration: 1800,
    episodeCount: 12,
    programType: 'news_magazine',
    titles: [
      'ShanghaiEye',
      '环球交叉点',
      '国际城市观察',
      '海外看上海',
      '静安寺商圈现场',
      '会场连线直播',
      '论坛发布会精编',
      '展会服务信息',
    ],
  },
  {
    columnId: '105',
    codePrefix: '105',
    duration: 1800,
    episodeCount: 12,
    programType: 'health',
    titles: ['名医话养生', '健康上海', '活到100岁', '中医有方', '银龄课堂'],
  },
  {
    columnId: '113',
    codePrefix: '113',
    duration: 2700,
    episodeCount: 30,
    programType: 'drama',
    titles: ['烟火人家', '城中之城', '山海情', '人世间', '理想之城', '装台'],
  },
  {
    columnId: '106',
    codePrefix: '106',
    duration: 1800,
    episodeCount: 10,
    programType: 'entertainment',
    titles: ['东方新娱乐', '文娱新天地', '极限挑战精选', '我们的歌精选', '今晚开放麦精选', '舞台2026'],
  },
  {
    columnId: '103',
    codePrefix: '103',
    duration: 1800,
    episodeCount: 20,
    programType: 'news',
    titles: ['东方新闻', '上海新闻', '新闻夜线', '财经观察'],
  },
  {
    columnId: '118',
    codePrefix: '118',
    duration: 1800,
    episodeCount: 20,
    programType: 'news',
    titles: ['新闻联播', '东方晚间新闻', '长三角新闻联播'],
  },
  {
    columnId: '119',
    codePrefix: '119',
    duration: 2700,
    episodeCount: 36,
    programType: 'drama',
    titles: ['玫瑰的故事', '承欢记', '南来北往', '父辈的荣耀', '欢乐颂', '三十而已'],
  },
  {
    columnId: '120',
    codePrefix: '120',
    duration: 1800,
    episodeCount: 12,
    programType: 'drama',
    titles: ['东方看大剧', '剧耀东方', '剧集风云榜', '幕后看大剧'],
  },
  {
    columnId: '121',
    codePrefix: '121',
    duration: 1800,
    episodeCount: 16,
    programType: 'drama',
    titles: ['夜色正浓', '春风寄梦', '海上繁星', '转角遇见你', '向阳而生'],
  },
  {
    columnId: '122',
    codePrefix: '122',
    duration: 1800,
    episodeCount: 12,
    programType: 'commentary',
    titles: ['今晚', '今晚观察', '城市会客厅', '东方圆桌'],
  },
  {
    columnId: '109',
    codePrefix: '109',
    duration: 1800,
    episodeCount: 12,
    programType: 'commentary',
    titles: ['锵点', '热点面对面', '新闻深一度', '这就是中国精选'],
  },
  {
    columnId: '123',
    codePrefix: '123',
    duration: 1800,
    episodeCount: 12,
    programType: 'commentary',
    titles: ['两说', '双城记', '观点交锋', '民生圆桌'],
  },
  {
    columnId: '124',
    codePrefix: '124',
    duration: 1800,
    episodeCount: 24,
    programType: 'drama',
    titles: ['归路', '平凡之路', '打开生活的正确方式', '心居', '流金岁月'],
  },
  {
    columnId: '125',
    codePrefix: '125',
    duration: 1800,
    episodeCount: 12,
    programType: 'documentary',
    titles: ['东方纪实', '人文上海', '江南文脉', '城市考古', '海上非遗'],
  },
]

const generatedProgramDefinitions: ProgramDefinition[] = generatedProgramSeries.flatMap((series) =>
  series.titles.map((title, titleIndex) => ({
    programId: `G${series.codePrefix}${String(titleIndex + 1).padStart(3, '0')}`,
    programName: title,
    columnId: series.columnId,
    programType: series.programType,
  })),
)

const getGeneratedColumnName = (columnId: string) =>
  orchestrationDemoColumns.find((column) => column.columnId === columnId)?.columnName ?? '节目'

const generatedProgramInstances: ProgramInstance[] = generatedProgramSeries.flatMap((series) =>
  series.titles.flatMap((title, titleIndex) => {
    const programId = `G${series.codePrefix}${String(titleIndex + 1).padStart(3, '0')}`
    const columnName = getGeneratedColumnName(series.columnId)
    return Array.from({ length: series.episodeCount }, (_, issueIndex) => {
      const issueNo = String(issueIndex + 1).padStart(4, '0')
      const displayIssue = issueIndex + 1
      const instanceName = series.programType === 'drama'
        ? `${columnName}：${title} 第${displayIssue}集`
        : `${title} 第${displayIssue}期`

      return {
        instanceId: `GI${series.codePrefix}${String(titleIndex + 1).padStart(3, '0')}-${issueNo}`,
        programId,
        programCode: `88${series.codePrefix}${String(titleIndex + 1).padStart(3, '0')}${issueNo}`,
        instanceName,
        duration: series.duration,
        adBreaks: buildInternalAdBreaks(series.duration, series.programType),
        issueNo,
      }
    })
  }),
)

export const orchestrationDemoProgramDefinitions: ProgramDefinition[] = [
  ...seedProgramDefinitions,
  ...generatedProgramDefinitions,
]

export const orchestrationDemoProgramInstances: ProgramInstance[] = [
  ...seedProgramInstances,
  ...generatedProgramInstances,
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
  {
    date: '2026-03-24',
    itemCount: 26,
    programTypes: { news: 6, news_magazine: 4, drama: 6, health: 2, commentary: 3 },
    avgRating: 8.6,
    items: [
      {
        id: 'history-dragon-20260324-112-004',
        programCode: '881120030004',
        programName: '品质剧场：纵有疾风起 第4集',
        startTime: '2026-03-24T09:30:00+08:00',
        endTime: '2026-03-24T10:15:00+08:00',
        duration: 2700,
        programType: 'drama',
        sequence: 1,
      },
    ],
  },
  { date: '2026-03-23', itemCount: 27, programTypes: { news: 6, news_magazine: 4, drama: 6, health: 2, commentary: 3 }, avgRating: 8.5 },
]

export const orchestrationDemoHistorySchedules: Record<string, ScheduleSummary[]> = Object.fromEntries(
  demoDateAliases.map((date) => [`dragon_${date}`, baseHistorySchedules]),
)

const programDefinitionMap = new Map(orchestrationDemoProgramDefinitions.map((item) => [item.programId, item]))
const columnMap = new Map(orchestrationDemoColumns.map((item) => [item.columnId, item]))

const buildCandidateContentTags = (input: {
  programName: string
  instanceName: string
  columnName: string
  programType: string
}): string[] => {
  const text = `${input.programName} ${input.instanceName} ${input.columnName}`
  const tags = new Set<string>([
    input.programName,
    input.columnName,
    input.programType,
  ])
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
    '暖场',
    '集锦',
    '花絮',
    '回看',
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

const shortClipDemoCandidates: ProgramCandidate[] = [
  {
    id: 'asset-short-city-flower',
    programId: 'asset-short-city-flower',
    programCode: '',
    programName: '城市微短片：春日花路 30秒',
    channelId: 'dragon',
    columnId: '900',
    columnName: '轮播短片',
    duration: 30,
    programType: 'short_clip',
    instanceName: '城市微短片：春日花路 30秒',
    contentTags: ['城市形象', '春日花路', '短片', '无节目编号', '轮播'],
  },
  {
    id: 'asset-short-jingan-night',
    programId: 'asset-short-jingan-night',
    programCode: '',
    programName: '静安夜色城市宣传片 45秒',
    channelId: 'dragon',
    columnId: '900',
    columnName: '轮播短片',
    duration: 45,
    programType: 'short_clip',
    instanceName: '静安夜色城市宣传片 45秒',
    contentTags: ['静安寺', '城市形象', '夜景', '宣传片', '无节目编号', '轮播'],
  },
  {
    id: 'asset-short-shanghai-landmark',
    programId: 'asset-short-shanghai-landmark',
    programCode: '',
    programName: '上海景点宣传片：外滩与陆家嘴 60秒',
    channelId: 'dragon',
    columnId: '900',
    columnName: '轮播短片',
    duration: 60,
    programType: 'short_clip',
    instanceName: '上海景点宣传片：外滩与陆家嘴 60秒',
    contentTags: ['上海', '旅游景点', '景点', '外滩', '陆家嘴', '宣传片', '视频', '无节目编号', '轮播'],
  },
  {
    id: 'asset-short-weather-service',
    programId: 'asset-short-weather-service',
    programCode: '',
    programName: '便民服务：暴雨出行提醒 20秒',
    channelId: 'dragon',
    columnId: '900',
    columnName: '轮播短片',
    duration: 20,
    programType: 'short_clip',
    instanceName: '便民服务：暴雨出行提醒 20秒',
    contentTags: ['便民服务', '天气', '出行提醒', '短片', '无节目编号', '轮播'],
  },
  {
    id: 'asset-short-culture-museum',
    programId: 'asset-short-culture-museum',
    programCode: '',
    programName: '文化导视：博物馆奇妙夜 60秒',
    channelId: 'dragon',
    columnId: '900',
    columnName: '轮播短片',
    duration: 60,
    programType: 'short_clip',
    instanceName: '文化导视：博物馆奇妙夜 60秒',
    contentTags: ['文化', '导视', '博物馆', '短片', '无节目编号', '轮播'],
  },
  {
    id: 'asset-short-event-brief',
    programId: 'asset-short-event-brief',
    programCode: '',
    programName: '活动预热：城市音乐节 15秒',
    channelId: 'dragon',
    columnId: '900',
    columnName: '轮播短片',
    duration: 15,
    programType: 'short_clip',
    instanceName: '活动预热：城市音乐节 15秒',
    contentTags: ['活动预热', '音乐节', '导视', '短片', '无节目编号', '轮播'],
  },
].map((candidate) => ({
  ...candidate,
  ...buildCandidatePopularityMetrics({
    programCode: candidate.id,
    programType: candidate.programType,
    duration: candidate.duration,
    contentTags: candidate.contentTags ?? [],
  }),
}))

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
  })
  const popularityMetrics = buildCandidatePopularityMetrics({
    programCode: instance.programCode,
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
  ...shortClipDemoCandidates,
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
