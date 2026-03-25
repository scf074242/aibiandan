import type {
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
}

const today = '2026-03-25'
const iso = (date: string, time: string) => `${date}T${time}+08:00`

const formatPlayLength = (seconds: number): string => {
  if (seconds % 3600 === 0) return `${seconds / 3600}小时`
  if (seconds % 60 === 0) return `${seconds / 60}分钟`
  return `${seconds}秒`
}

const makeProgram = (
  id: string,
  code: string,
  name: string,
  duration: number,
  programType: string,
  source: ProgramCandidate['source'] = 'library',
  rating = 7.5,
  metadata: Record<string, unknown> = {},
  tags: string[] = [],
): ProgramCandidate => ({
  id,
  programCode: code,
  programName: name,
  duration,
  programType,
  rating,
  source,
  metadata,
  tags,
})

const makeScheduleItem = (
  id: string,
  sortOrder: number,
  startTime: string,
  endTime: string,
  programCode: string,
  programName: string,
  duration: number,
  businessType: string,
  materialStatus: ScheduleItem['materialStatus'] = 'ready',
): ScheduleItem => ({
  id,
  scheduleId: 'demo-news',
  startTime,
  endTime,
  episodeName: programName,
  programName,
  businessType,
  sourceType: 'record',
  sortOrder,
  duration,
  programCode,
  code18: programCode,
  materialStatus,
  materialName: `${programCode}-MAT`,
  playLength: formatPlayLength(duration),
  relativeStart: startTime.slice(0, 5),
})

export const demoChannels: DemoChannel[] = [
  { id: 'news', name: '新闻综合', code: 'NEWS', timeZone: 'Asia/Shanghai', defaultStartTime: '06:00:00', defaultEndTime: '23:59:59' },
  { id: 'dragon', name: '东方卫视', code: 'DRAGON', timeZone: 'Asia/Shanghai', defaultStartTime: '06:00:00', defaultEndTime: '23:59:59' },
  { id: 'finance', name: '第一财经', code: 'FINANCE', timeZone: 'Asia/Shanghai', defaultStartTime: '06:00:00', defaultEndTime: '23:59:59' },
  { id: 'sports', name: '五星体育', code: 'SPORTS', timeZone: 'Asia/Shanghai', defaultStartTime: '06:00:00', defaultEndTime: '23:59:59' },
  { id: 'documentary', name: '纪实人文', code: 'DOC', timeZone: 'Asia/Shanghai', defaultStartTime: '06:00:00', defaultEndTime: '23:59:59' },
  { id: 'cartoon', name: '哈哈炫动', code: 'CARTOON', timeZone: 'Asia/Shanghai', defaultStartTime: '06:00:00', defaultEndTime: '23:59:59' },
]

export const demoLayouts: Record<string, LayoutReference> = {
  [`dragon_${today}`]: {
    id: `layout_dragon_${today}`,
    name: '东方卫视版面参考（演示）',
    slots: [
      { id: 'dragon-0730', startTime: iso(today, '07:30:00'), endTime: iso(today, '08:00:00'), programType: 'news_magazine', fixedProgram: '看东方' },
      { id: 'dragon-0930', startTime: iso(today, '09:30:00'), endTime: iso(today, '10:00:00'), programType: 'travel', fixedProgram: '1+1旅行记' },
      { id: 'dragon-1100', startTime: iso(today, '11:00:00'), endTime: iso(today, '11:30:00'), programType: 'kids', fixedProgram: '潮童天下' },
      { id: 'dragon-1230', startTime: iso(today, '12:30:00'), endTime: iso(today, '13:00:00'), programType: 'news', fixedProgram: '午间30分' },
      { id: 'dragon-1330', startTime: iso(today, '13:30:00'), endTime: iso(today, '14:00:00'), programType: 'documentary', fixedProgram: '中国考古报道' },
      { id: 'dragon-1730', startTime: iso(today, '17:30:00'), endTime: iso(today, '18:00:00'), programType: 'entertainment', fixedProgram: '东方新娱乐' },
      { id: 'dragon-1800', startTime: iso(today, '18:00:00'), endTime: iso(today, '18:30:00'), programType: 'health', fixedProgram: '名医话养生' },
      { id: 'dragon-1830', startTime: iso(today, '18:30:00'), endTime: iso(today, '19:00:00'), programType: 'news', fixedProgram: '东方新闻' },
      { id: 'dragon-1930', startTime: iso(today, '19:30:00'), endTime: iso(today, '21:30:00'), programType: 'drama', fixedProgram: '品质剧场' },
      { id: 'dragon-2130', startTime: iso(today, '21:30:00'), endTime: iso(today, '22:15:00'), programType: 'commentary', fixedProgram: '这就是中国' },
      { id: 'dragon-2230', startTime: iso(today, '22:30:00'), endTime: iso(today, '23:00:00'), programType: 'documentary', fixedProgram: '新纪实' },
    ],
  },
  [`news_${today}`]: {
    id: `layout_news_${today}`,
    name: '新闻综合版面参考（演示）',
    slots: [
      { id: 'news-0600', startTime: iso(today, '06:00:00'), endTime: iso(today, '07:00:00'), programType: 'news', fixedProgram: '早安上海' },
      { id: 'news-0700', startTime: iso(today, '07:00:00'), endTime: iso(today, '09:00:00'), programType: 'news_magazine', fixedProgram: '看东方' },
      { id: 'news-0900', startTime: iso(today, '09:00:00'), endTime: iso(today, '10:00:00'), programType: 'news_magazine' },
      { id: 'news-1000', startTime: iso(today, '10:00:00'), endTime: iso(today, '11:00:00'), programType: 'livelihood' },
      { id: 'news-1130', startTime: iso(today, '11:30:00'), endTime: iso(today, '12:00:00'), programType: 'law' },
      { id: 'news-1230', startTime: iso(today, '12:30:00'), endTime: iso(today, '13:00:00'), programType: 'news', fixedProgram: '午间30分' },
      { id: 'news-1300', startTime: iso(today, '13:00:00'), endTime: iso(today, '15:00:00'), programType: 'livelihood' },
      { id: 'news-1500', startTime: iso(today, '15:00:00'), endTime: iso(today, '16:00:00'), programType: 'documentary' },
      { id: 'news-1600', startTime: iso(today, '16:00:00'), endTime: iso(today, '17:00:00'), programType: 'health' },
      { id: 'news-1730', startTime: iso(today, '17:30:00'), endTime: iso(today, '18:00:00'), programType: 'livelihood' },
      { id: 'news-1830', startTime: iso(today, '18:30:00'), endTime: iso(today, '19:00:00'), programType: 'news', fixedProgram: '东方新闻' },
      { id: 'news-1900', startTime: iso(today, '19:00:00'), endTime: iso(today, '19:30:00'), programType: 'news', fixedProgram: '新闻联播' },
      { id: 'news-1930', startTime: iso(today, '19:30:00'), endTime: iso(today, '20:15:00'), programType: 'commentary' },
      { id: 'news-2015', startTime: iso(today, '20:15:00'), endTime: iso(today, '21:00:00'), programType: 'news_magazine' },
      { id: 'news-2130', startTime: iso(today, '21:30:00'), endTime: iso(today, '22:15:00'), programType: 'law' },
      { id: 'news-2230', startTime: iso(today, '22:30:00'), endTime: iso(today, '23:30:00'), programType: 'documentary' },
    ],
  },
}

const newsPrograms: ProgramCandidate[] = [
  makeProgram('news-early-shanghai', 'NEWS001', '早安上海', 3600, 'news', 'library', 8.9, { channelIds: ['news'], preferredSlot: '06:00-07:00' }, ['早间', '直播', '新闻']),
  makeProgram('news-shanghai-morning', 'NEWS002', '上海早晨', 5400, 'news_magazine', 'library', 8.8, { channelIds: ['news'], preferredSlot: '07:00-09:00' }, ['早间', '民生', '新闻']),
  makeProgram('news-kan-dongfang-90', 'NEWS003', '看东方', 5400, 'news_magazine', 'library', 9.2, { channelIds: ['news', 'dragon'], preferredSlot: '07:00-09:00' }, ['看东方', '新闻', '资讯']),
  makeProgram('news-kan-dongfang-60', 'NEWS004', '看东方（特别版）', 3600, 'news_magazine', 'library', 8.7, { channelIds: ['news'], preferredSlot: '09:00-10:00' }, ['看东方', '新闻', '特别版']),
  makeProgram('news-noon-30', 'NEWS005', '午间30分', 1800, 'news', 'library', 8.6, { channelIds: ['news', 'dragon'], preferredSlot: '12:30-13:00' }, ['午间', '新闻']),
  makeProgram('news-dongfang-news', 'NEWS006', '东方新闻', 1800, 'news', 'library', 8.8, { channelIds: ['news', 'dragon'], preferredSlot: '18:30-19:00' }, ['晚间', '新闻']),
  makeProgram('news-xinwen-lianbo', 'NEWS007', '新闻联播', 1800, 'news', 'library', 9.3, { channelIds: ['news', 'dragon'], preferredSlot: '19:00-19:30' }, ['权威', '新闻']),
  makeProgram('news-live-shanghai', 'NEWS008', '直播上海', 2700, 'livelihood', 'library', 8.5, { channelIds: ['news'], preferredSlot: '17:30-18:30' }, ['民生', '直播']),
  makeProgram('news-minsheng-service', 'NEWS009', '民生一网通', 1800, 'livelihood', 'library', 8.2, { channelIds: ['news'] }, ['民生', '服务']),
  makeProgram('news-dongfang110', 'NEWS010', '东方110', 1800, 'law', 'library', 8.5, { channelIds: ['news'], preferredSlot: '21:30-22:00' }, ['法治', '纪实']),
  makeProgram('news-fazhi-special', 'NEWS011', '法治特勤组', 1500, 'law', 'library', 8.1, { channelIds: ['news'] }, ['法治', '纪实']),
  makeProgram('news-haiwai-road', 'NEWS012', '海外路路通', 1500, 'education', 'library', 7.9, { channelIds: ['news'] }, ['留学', '资讯']),
  makeProgram('news-kaogu', 'NEWS013', '中国考古报道', 1320, 'documentary', 'library', 8.0, { channelIds: ['news', 'dragon'] }, ['文化', '纪实']),
  makeProgram('news-shanghai-eye', 'NEWS014', 'ShanghaiEye', 1800, 'news_magazine', 'library', 8.4, { channelIds: ['news', 'dragon'] }, ['国际传播', '英语资讯']),
  makeProgram('news-yangsheng', 'NEWS015', '名医话养生', 1800, 'health', 'library', 8.0, { channelIds: ['news', 'dragon'] }, ['养生', '健康']),
  makeProgram('news-city-focus', 'NEWS016', '城市聚焦', 1800, 'news_magazine', 'library', 8.0, { channelIds: ['news'] }, ['城市', '新闻']),
  makeProgram('news-commentary', 'NEWS017', '这就是中国', 2700, 'commentary', 'library', 8.9, { channelIds: ['news', 'dragon'], preferredSlot: '19:30-21:00' }, ['评论', '时政']),
  makeProgram('news-global-cross', 'NEWS018', '环球交叉点', 2700, 'commentary', 'library', 8.3, { channelIds: ['news', 'dragon'] }, ['国际', '评论']),
  makeProgram('news-livelihood-observe', 'NEWS019', '民生观察', 2700, 'livelihood', 'library', 8.1, { channelIds: ['news'] }, ['民生', '深度']),
  makeProgram('news-evening-briefing', 'NEWS020', '晚间新闻快评', 1800, 'commentary', 'library', 8.0, { channelIds: ['news'] }, ['晚间', '评论']),
  makeProgram('news-rule-of-law', 'NEWS021', '法治现场', 1800, 'law', 'library', 7.9, { channelIds: ['news'] }, ['法治', '案例']),
  makeProgram('news-documentary-city', 'NEWS022', '新纪实', 1800, 'documentary', 'library', 8.1, { channelIds: ['news', 'dragon'] }, ['纪实', '城市']),
  makeProgram('news-medical-guide', 'NEWS023', '健康全知道', 1500, 'health', 'library', 7.8, { channelIds: ['news'] }, ['健康', '服务']),
  makeProgram('news-weather', 'NEWS024', '申城天气', 300, 'weather', 'library', 7.5, { channelIds: ['news'] }, ['天气', '服务']),
  makeProgram('news-market-service', 'NEWS025', '消费新主张', 1800, 'livelihood', 'library', 7.8, { channelIds: ['news'] }, ['消费', '民生']),
  makeProgram('news-special-report', 'NEWS026', '深度调查', 2700, 'commentary', 'library', 8.2, { channelIds: ['news'] }, ['调查', '深度']),
  makeProgram('news-urban-memory', 'NEWS027', '城市记忆', 1800, 'documentary', 'library', 7.7, { channelIds: ['news'] }, ['城市', '人文']),
  makeProgram('news-morning-topic', 'NEWS028', '晨间话题', 1200, 'news_magazine', 'library', 7.8, { channelIds: ['news'] }, ['早间', '话题']),
]

const dragonPrograms: ProgramCandidate[] = [
  makeProgram('dragon-ent-news', 'DRAGON001', '东方新娱乐', 1800, 'entertainment', 'library', 7.7, { channelIds: ['dragon'] }, ['娱乐', '资讯']),
  makeProgram('dragon-chaotong', 'DRAGON002', '潮童天下', 1800, 'kids', 'library', 7.4, { channelIds: ['dragon'] }, ['亲子', '少儿']),
  makeProgram('dragon-travel', 'DRAGON003', '1+1旅行记', 1800, 'travel', 'library', 7.8, { channelIds: ['dragon'] }, ['旅行', '纪行']),
  makeProgram('dragon-classic-drama', 'DRAGON004', '经典剧场', 5400, 'drama', 'library', 8.1, { channelIds: ['dragon'] }, ['剧场', '电视剧']),
  makeProgram('dragon-quality-drama', 'DRAGON005', '品质剧场', 7200, 'drama', 'library', 8.5, { channelIds: ['dragon'] }, ['剧场', '精品剧']),
  makeProgram('dragon-kan-daju', 'DRAGON006', '东方看大剧', 3600, 'drama', 'library', 8.2, { channelIds: ['dragon'] }, ['剧场', '电视剧']),
  makeProgram('dragon-documentary', 'DRAGON007', '新纪实', 1800, 'documentary', 'library', 8.0, { channelIds: ['dragon', 'news'] }, ['纪实']),
  makeProgram('dragon-city-life', 'DRAGON008', '爱上海', 900, 'lifestyle', 'library', 7.3, { channelIds: ['dragon'] }, ['城市', '生活']),
  makeProgram('dragon-health', 'DRAGON009', '名医话养生', 1800, 'health', 'library', 7.9, { channelIds: ['dragon', 'news'] }, ['养生', '健康']),
  makeProgram('dragon-shanghai-eye', 'DRAGON010', 'ShanghaiEye', 1800, 'news_magazine', 'library', 8.2, { channelIds: ['dragon', 'news'] }, ['国际传播']),
  makeProgram('dragon-double-city', 'DRAGON011', '双城记', 1800, 'lifestyle', 'library', 7.6, { channelIds: ['dragon'] }, ['城市', '人物']),
  makeProgram('dragon-yuedong', 'DRAGON012', '越动青春', 1800, 'variety', 'library', 7.5, { channelIds: ['dragon'] }, ['青春', '综艺']),
]

const dramaPrograms: ProgramCandidate[] = [
  makeProgram('drama-zongyou-31', 'DRAMA031', '39集连续剧：纵有疾风起（31）', 2700, 'drama', 'library', 8.6, { channelIds: ['news', 'dragon'] }, ['电视剧', '都市']),
  makeProgram('drama-zongyou-32', 'DRAMA032', '39集连续剧：纵有疾风起（32）', 2700, 'drama', 'library', 8.6, { channelIds: ['news', 'dragon'] }, ['电视剧', '都市']),
  makeProgram('drama-zongyou-33', 'DRAMA033', '39集连续剧：纵有疾风起（33）', 2700, 'drama', 'library', 8.7, { channelIds: ['news', 'dragon'] }, ['电视剧', '都市']),
  makeProgram('drama-zongyou-34', 'DRAMA034', '39集连续剧：纵有疾风起（34）', 2700, 'drama', 'library', 8.8, { channelIds: ['news', 'dragon'] }, ['电视剧', '都市']),
  makeProgram('drama-bianguan-05', 'DRAMA105', '36集连续剧：边关烽火情（5）', 2700, 'drama', 'library', 7.9, { channelIds: ['news'] }, ['电视剧', '年代']),
  makeProgram('drama-bianguan-06', 'DRAMA106', '36集连续剧：边关烽火情（6）', 2700, 'drama', 'library', 7.9, { channelIds: ['news'] }, ['电视剧', '年代']),
  makeProgram('drama-daofeng-34', 'DRAMA201', '刀锋下的替身（34）', 2700, 'drama', 'library', 8.0, { channelIds: ['news', 'dragon'] }, ['电视剧', '悬疑']),
  makeProgram('drama-daofeng-35', 'DRAMA202', '刀锋下的替身（35）', 2700, 'drama', 'library', 8.0, { channelIds: ['news', 'dragon'] }, ['电视剧', '悬疑']),
]

const promoPrograms: ProgramCandidate[] = [
  makeProgram('promo-id-5a', 'PROMO001', '5秒ID-2025 新出发', 5, 'promo', 'filler', 6.8, { channelIds: ['news', 'dragon'] }, ['ID', '台标']),
  makeProgram('promo-id-5b', 'PROMO002', '5秒ID-这里是上海', 5, 'promo', 'filler', 6.8, { channelIds: ['news', 'dragon'] }, ['ID', '台标']),
  makeProgram('promo-id-10a', 'PROMO003', '10秒ID-这里是上海（日景）', 10, 'promo', 'filler', 6.9, { channelIds: ['news', 'dragon'] }, ['ID', '上海']),
  makeProgram('promo-id-10b', 'PROMO004', '10秒ID-这里是上海（夜景）', 10, 'promo', 'filler', 6.9, { channelIds: ['news', 'dragon'] }, ['ID', '上海']),
  makeProgram('promo-id-20a', 'PROMO005', '20秒ID-敦煌美术馆', 20, 'promo', 'filler', 6.7, { channelIds: ['news', 'dragon'] }, ['ID', '宣传片']),
  makeProgram('promo-id-20b', 'PROMO006', '20秒ID-天鹅绒之梦', 20, 'promo', 'filler', 6.7, { channelIds: ['news', 'dragon'] }, ['ID', '宣传片']),
  makeProgram('promo-id-20c', 'PROMO007', '20秒ID-崇明东滩观鸟季', 20, 'promo', 'filler', 6.7, { channelIds: ['news', 'dragon'] }, ['ID', '宣传片']),
  makeProgram('promo-yugao-110', 'PROMO008', '2月12日《东方110》预告', 30, 'promo', 'filler', 7.0, { channelIds: ['news'] }, ['预告', '东方110']),
  makeProgram('promo-yugao-daofeng', 'PROMO009', '2月12日《刀锋下的替身》预告（34、35）', 30, 'promo', 'filler', 7.0, { channelIds: ['news', 'dragon'] }, ['预告', '电视剧']),
  makeProgram('promo-aishanghai-1', 'PROMO010', '宣传片《爱上海：放夜东方·元夕雅集（1）》', 30, 'promo', 'filler', 7.1, { channelIds: ['dragon'] }, ['宣传片', '爱上海']),
  makeProgram('promo-aishanghai-2', 'PROMO011', '宣传片《爱上海：放夜东方·元夕雅集（2）》', 30, 'promo', 'filler', 7.1, { channelIds: ['dragon'] }, ['宣传片', '爱上海']),
  makeProgram('promo-aishanghai-3', 'PROMO012', '宣传片《爱上海：放夜东方·元夕雅集（3）》', 30, 'promo', 'filler', 7.1, { channelIds: ['dragon'] }, ['宣传片', '爱上海']),
]

const adPrograms: ProgramCandidate[] = [
  makeProgram('ad-15a', 'AD001', '公益广告 15秒', 15, 'ad', 'filler', 6.4, { channelIds: ['news', 'dragon'] }, ['广告', '公益']),
  makeProgram('ad-15b', 'AD002', '城市服务广告 15秒', 15, 'ad', 'filler', 6.3, { channelIds: ['news', 'dragon'] }, ['广告']),
  makeProgram('ad-30a', 'AD003', '联通尚海 30秒', 30, 'ad', 'filler', 6.3, { channelIds: ['news'] }, ['广告']),
  makeProgram('ad-30b', 'AD004', '广电5G上海之星 30秒', 30, 'ad', 'filler', 6.2, { channelIds: ['news', 'dragon'] }, ['广告']),
  makeProgram('ad-60a', 'AD005', '广告组块 60秒', 60, 'ad', 'filler', 6.1, { channelIds: ['news', 'dragon'] }, ['广告', '组块']),
  makeProgram('ad-90a', 'AD006', '广告组块 90秒', 90, 'ad', 'filler', 6.1, { channelIds: ['news', 'dragon'] }, ['广告', '组块']),
  makeProgram('ad-120a', 'AD007', '广告组块 120秒', 120, 'ad', 'filler', 6.0, { channelIds: ['news', 'dragon'] }, ['广告', '组块']),
]

const fillerPrograms: ProgramCandidate[] = [
  makeProgram('fill-5', 'FILL005', '短片填充 5秒', 5, 'filler', 'filler', 6.0, { channelIds: ['news', 'dragon'] }, ['填充']),
  makeProgram('fill-10', 'FILL010', '短片填充 10秒', 10, 'filler', 'filler', 6.0, { channelIds: ['news', 'dragon'] }, ['填充']),
  makeProgram('fill-20', 'FILL020', '短片填充 20秒', 20, 'filler', 'filler', 6.0, { channelIds: ['news', 'dragon'] }, ['填充']),
  makeProgram('fill-30', 'FILL030', '短片填充 30秒', 30, 'filler', 'filler', 6.0, { channelIds: ['news', 'dragon'] }, ['填充']),
  makeProgram('fill-60', 'FILL060', '短片填充 60秒', 60, 'filler', 'filler', 6.0, { channelIds: ['news', 'dragon'] }, ['填充']),
  makeProgram('fill-300', 'FILL300', '短片填充 5分钟', 300, 'filler', 'filler', 6.0, { channelIds: ['news', 'dragon'] }, ['填充']),
]

export const demoPrograms: ProgramCandidate[] = [
  ...newsPrograms,
  ...dragonPrograms,
  ...dramaPrograms,
  ...promoPrograms,
  ...adPrograms,
  ...fillerPrograms,
]

export const demoHistorySchedules: Record<string, ScheduleSummary[]> = {
  [`news_${today}`]: [
    { date: '2026-03-24', itemCount: 42, programTypes: { news: 14, news_magazine: 8, livelihood: 6, commentary: 4, law: 4, documentary: 3, promo: 2, ad: 1 }, avgRating: 8.4 },
    { date: '2026-03-23', itemCount: 40, programTypes: { news: 13, news_magazine: 7, livelihood: 6, commentary: 4, law: 3, documentary: 3, health: 2, promo: 2 }, avgRating: 8.3 },
  ],
  [`dragon_${today}`]: [
    { date: '2026-03-24', itemCount: 28, programTypes: { drama: 8, news: 4, travel: 2, entertainment: 2, health: 2, documentary: 2, promo: 5, ad: 3 }, avgRating: 8.0 },
  ],
}

export const demoFixedItems: Record<string, FixedItem[]> = {
  [`news_${today}`]: [
    { id: 'fixed-news-0600', programCode: 'NEWS001', startTime: iso(today, '06:00:00'), endTime: iso(today, '07:00:00'), isLocked: true },
    { id: 'fixed-news-1230', programCode: 'NEWS005', startTime: iso(today, '12:30:00'), endTime: iso(today, '13:00:00'), isLocked: true },
    { id: 'fixed-news-1830', programCode: 'NEWS006', startTime: iso(today, '18:30:00'), endTime: iso(today, '19:00:00'), isLocked: true },
    { id: 'fixed-news-1900', programCode: 'NEWS007', startTime: iso(today, '19:00:00'), endTime: iso(today, '19:30:00'), isLocked: true },
  ],
  [`dragon_${today}`]: [
    { id: 'fixed-dragon-1230', programCode: 'NEWS005', startTime: iso(today, '12:30:00'), endTime: iso(today, '13:00:00'), isLocked: true },
    { id: 'fixed-dragon-1830', programCode: 'NEWS006', startTime: iso(today, '18:30:00'), endTime: iso(today, '19:00:00'), isLocked: true },
  ],
}

export const demoScheduleItems: ScheduleItem[] = [
  makeScheduleItem('schedule-1', 1, '06:00:00', '07:00:00', 'NEWS001', '早安上海', 3600, 'program'),
  makeScheduleItem('schedule-2', 2, '07:00:00', '07:00:30', 'PROMO001', '5秒ID-2025 新出发', 30, 'promo'),
  makeScheduleItem('schedule-3', 3, '07:00:30', '08:30:00', 'NEWS003', '看东方', 5370, 'program'),
  makeScheduleItem('schedule-4', 4, '08:30:00', '08:31:00', 'AD005', '广告组块 60秒', 60, 'ad'),
  makeScheduleItem('schedule-5', 5, '12:30:00', '13:00:00', 'NEWS005', '午间30分', 1800, 'program'),
  makeScheduleItem('schedule-6', 6, '18:30:00', '19:00:00', 'NEWS006', '东方新闻', 1800, 'program'),
  makeScheduleItem('schedule-7', 7, '19:00:00', '19:30:00', 'NEWS007', '新闻联播', 1800, 'program'),
]

const [
  firstScheduleItem,
  secondScheduleItem,
  thirdScheduleItem,
  ,
  fifthScheduleItem,
  sixthScheduleItem,
  seventhScheduleItem,
] = demoScheduleItems

if (firstScheduleItem) {
  firstScheduleItem.studio = '一号演播室'
  firstScheduleItem.omniBroadcastRight = '允许'
  firstScheduleItem.thirdReviewDate = `${today} 05:30`
  firstScheduleItem.lastPlayableTime = `${today} 07:00`
}

if (secondScheduleItem) {
  secondScheduleItem.remark = '衔接早间时段ID'
}

if (thirdScheduleItem) {
  thirdScheduleItem.studio = '新闻演播室'
  thirdScheduleItem.omniBroadcastRight = '允许'
}

if (fifthScheduleItem) fifthScheduleItem.studio = '新闻演播室'
if (sixthScheduleItem) sixthScheduleItem.studio = '新闻演播室'
if (seventhScheduleItem) seventhScheduleItem.studio = '新闻演播室'

export const demoScheduleDetail = (id: string): CollaborativeScheduleDetail => ({
  id,
  name: '演示串联单',
  channelId: 'news',
  channelName: '新闻综合',
  date: today,
  editor: '当前用户',
  editorId: 'current-user',
  status: 'draft',
  isLocked: false,
  items: demoScheduleItems.map((item) => ({ ...item })),
})
