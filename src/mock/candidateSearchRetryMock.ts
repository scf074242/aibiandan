import type { ProgramCandidate } from '@/types/orchestration'

/**
 * 节目检索重试场景专用 mock 数据（按方案 13.3）。
 *
 * 设计目标：
 * - 覆盖 9.1-9.15 全部 case 的命中场景
 * - 与 orchestrationDemoCandidates 合并去重（按 programCode），在 CandidateService 构造时自动加载
 * - 不污染既有测试断言（programCode 全部使用独立前缀，不与现有数据冲突）
 * - channelId 统一使用 "dragon"，确保 queryCandidates 能按频道过滤命中
 *
 * 命中场景对照（按方案 13.2）：
 * | 场景 | 用户输入 | 命中的 mock 节目 | 命中策略 | 对应 case |
 * | 错别字修复 | 看东房 | 看东方（多期） | typo_fix | 9.1 / 9.2 |
 * | 拆字兜底 | 上海旅游宣传片 | 上海风光短片 | decompose | 9.3 |
 * | 栏目降级 | 东方快报 第10期 | 东方快报（第1-9期，无第10期） | column_demote | 9.4 |
 * | 候选不足扩展 | 纪录片 | 纪录片系列 / 纪实（多期） | paraphrase | 9.5 |
 * | 二次反思命中 | 看东方 第10期 | 看东方新闻 | secondary_reflection_paraphrase | 9.12 |
 * | 全 0 命中 | 不存在的栏目XYZ | （无任何匹配） | 无 | 9.11 / 9.13 |
 * | 近义改写 | 晨间新闻 | 早间新闻 | paraphrase | 9.8（轮播） |
 * | 放宽 | 上海旅游纪录片 | 上海 旅游 风光 | broaden | 9.8（轮播） |
 */

/**
 * 错别字修复场景假数据。
 *
 * 用户输入"看东房"（错别字，房→方），LLM 生成 typo_fix 策略"看东方"后命中多期。
 * 对应 case 9.1 / 9.2。
 */
export const typoFixMockCandidates: ProgramCandidate[] = [
  {
    id: 'retry-typofix-look-east-111',
    programId: 'P_RETRY_LOOK_EAST',
    programCode: 'RETRY_LOOK_EAST_111',
    programName: '看东方',
    channelId: 'dragon',
    columnId: 'retry-column-look-east',
    columnName: '看东方',
    duration: 1800,
    programType: 'news',
    issueNo: '111',
    instanceName: '看东方 第111期',
    contentTags: ['看东方', '晨间', '新闻'],
    estimatedRating: 7.5,
    playCount: 82000,
    popularityScore: 65.2,
  },
  {
    id: 'retry-typofix-look-east-112',
    programId: 'P_RETRY_LOOK_EAST',
    programCode: 'RETRY_LOOK_EAST_112',
    programName: '看东方',
    channelId: 'dragon',
    columnId: 'retry-column-look-east',
    columnName: '看东方',
    duration: 1800,
    programType: 'news',
    issueNo: '112',
    instanceName: '看东方 第112期',
    contentTags: ['看东方', '晨间', '新闻'],
    estimatedRating: 7.6,
    playCount: 83500,
    popularityScore: 66.0,
  },
  {
    id: 'retry-typofix-look-east-113',
    programId: 'P_RETRY_LOOK_EAST',
    programCode: 'RETRY_LOOK_EAST_113',
    programName: '看东方',
    channelId: 'dragon',
    columnId: 'retry-column-look-east',
    columnName: '看东方',
    duration: 1800,
    programType: 'news',
    issueNo: '113',
    instanceName: '看东方 第113期',
    contentTags: ['看东方', '晨间', '新闻'],
    estimatedRating: 7.4,
    playCount: 81000,
    popularityScore: 64.5,
  },
]

/**
 * 拆字场景假数据。
 *
 * 用户输入"上海旅游宣传片"，LLM 生成 decompose 策略"上海/旅游/短片"后命中。
 * 对应 case 9.3。
 */
export const decomposeMockCandidates: ProgramCandidate[] = [
  {
    id: 'retry-decompose-shanghai-travel-short-01',
    programId: 'P_RETRY_SHANGHAI_TRAVEL_SHORT',
    programCode: 'RETRY_SHANGHAI_TRAVEL_SHORT_01',
    programName: '上海风光短片',
    channelId: 'dragon',
    columnId: 'retry-column-shanghai-short',
    columnName: '上海风光',
    duration: 300,
    programType: 'short_clip',
    issueNo: '1',
    instanceName: '上海风光短片 第1集',
    contentTags: ['上海', '旅游', '风光', '短片'],
    estimatedRating: 6.8,
    playCount: 42000,
    popularityScore: 48.5,
  },
  {
    id: 'retry-decompose-shanghai-travel-short-02',
    programId: 'P_RETRY_SHANGHAI_TRAVEL_SHORT',
    programCode: 'RETRY_SHANGHAI_TRAVEL_SHORT_02',
    programName: '上海风光短片',
    channelId: 'dragon',
    columnId: 'retry-column-shanghai-short',
    columnName: '上海风光',
    duration: 300,
    programType: 'short_clip',
    issueNo: '2',
    instanceName: '上海风光短片 第2集',
    contentTags: ['上海', '旅游', '风光', '短片'],
    estimatedRating: 6.9,
    playCount: 43500,
    popularityScore: 49.0,
  },
]

/**
 * 栏目降级场景假数据。
 *
 * 用户输入"东方快报 第10期"，节目库有第1-9期但无第10期，
 * LLM 生成 column_demote 策略"东方快报"后命中多期。
 * 对应 case 9.4。
 */
export const columnDemoteMockCandidates: ProgramCandidate[] = Array.from({ length: 9 }, (_, index) => {
  const episodeNo = String(index + 1)
  return {
    id: `retry-columndemote-east-express-${episodeNo.padStart(3, '0')}`,
    programId: 'P_RETRY_EAST_EXPRESS',
    programCode: `RETRY_EAST_EXPRESS_${episodeNo.padStart(3, '0')}`,
    programName: '东方快报',
    channelId: 'dragon',
    columnId: 'retry-column-east-express',
    columnName: '东方快报',
    duration: 1800,
    programType: 'news',
    issueNo: episodeNo,
    instanceName: `东方快报 第${episodeNo}期`,
    contentTags: ['东方快报', '新闻'],
    estimatedRating: Math.round((1.0 + index * 0.05) * 10) / 10,
    playCount: 70000 + index * 1500,
    popularityScore: Math.round((55 + index * 1.5) * 10) / 10,
  } satisfies ProgramCandidate
})

/**
 * 二次反思场景假数据。
 *
 * 用户输入"看东方 第10期"，节目库无该期，也无"看东方"栏目（索引差异），
 * escape hatch 二次反思生成 paraphrase 策略"看东方新闻"后命中。
 * 对应 case 9.12。
 */
export const secondaryReflectionMockCandidates: ProgramCandidate[] = [
  {
    id: 'retry-secondary-look-east-news-01',
    programId: 'P_RETRY_LOOK_EAST_NEWS',
    programCode: 'RETRY_LOOK_EAST_NEWS_01',
    programName: '看东方新闻',
    channelId: 'dragon',
    columnId: 'retry-column-look-east-news',
    columnName: '看东方新闻',
    duration: 1800,
    programType: 'news',
    issueNo: '1',
    instanceName: '看东方新闻 第1期',
    contentTags: ['看东方', '新闻'],
    estimatedRating: 7.1,
    playCount: 68000,
    popularityScore: 58.3,
  },
]

/**
 * 近义改写场景假数据（轮播单）。
 *
 * 用户输入"晨间新闻"，LLM 生成 paraphrase 策略"早间新闻"后命中。
 * 对应 case 9.8（轮播）。
 */
export const paraphraseMockCandidates: ProgramCandidate[] = [
  {
    id: 'retry-paraphrase-morning-news-01',
    programId: 'P_RETRY_MORNING_NEWS',
    programCode: 'RETRY_MORNING_NEWS_01',
    programName: '早间新闻',
    channelId: 'dragon',
    columnId: 'retry-column-morning-news',
    columnName: '早间新闻',
    duration: 1800,
    programType: 'news',
    issueNo: '1',
    instanceName: '早间新闻 第1期',
    contentTags: ['早间', '新闻', '晨间'],
    estimatedRating: 7.0,
    playCount: 65000,
    popularityScore: 56.5,
  },
  {
    id: 'retry-paraphrase-morning-news-02',
    programId: 'P_RETRY_MORNING_NEWS',
    programCode: 'RETRY_MORNING_NEWS_02',
    programName: '早间新闻',
    channelId: 'dragon',
    columnId: 'retry-column-morning-news',
    columnName: '早间新闻',
    duration: 1800,
    programType: 'news',
    issueNo: '2',
    instanceName: '早间新闻 第2期',
    contentTags: ['早间', '新闻', '晨间'],
    estimatedRating: 7.1,
    playCount: 66000,
    popularityScore: 57.0,
  },
]

/**
 * 放宽场景假数据（轮播单）。
 *
 * 用户输入"上海旅游纪录片"，LLM 生成 broaden 策略"上海 旅游"后命中。
 * 对应 case 9.8（轮播）。
 */
export const broadenMockCandidates: ProgramCandidate[] = [
  {
    id: 'retry-broaden-shanghai-travel-doc-01',
    programId: 'P_RETRY_SHANGHAI_TRAVEL_DOC',
    programCode: 'RETRY_SHANGHAI_TRAVEL_DOC_01',
    programName: '上海旅游风光',
    channelId: 'dragon',
    columnId: 'retry-column-shanghai-doc',
    columnName: '上海旅游',
    duration: 2400,
    programType: 'documentary',
    issueNo: '1',
    instanceName: '上海旅游风光 第1集',
    contentTags: ['上海', '旅游', '风光', '纪录片'],
    estimatedRating: 6.9,
    playCount: 55000,
    popularityScore: 52.0,
  },
  {
    id: 'retry-broaden-shanghai-travel-doc-02',
    programId: 'P_RETRY_SHANGHAI_TRAVEL_DOC',
    programCode: 'RETRY_SHANGHAI_TRAVEL_DOC_02',
    programName: '上海旅游风光',
    channelId: 'dragon',
    columnId: 'retry-column-shanghai-doc',
    columnName: '上海旅游',
    duration: 2400,
    programType: 'documentary',
    issueNo: '2',
    instanceName: '上海旅游风光 第2集',
    contentTags: ['上海', '旅游', '风光', '纪录片'],
    estimatedRating: 7.0,
    playCount: 56000,
    popularityScore: 52.5,
  },
  {
    id: 'retry-broaden-shanghai-travel-doc-03',
    programId: 'P_RETRY_SHANGHAI_TRAVEL_DOC',
    programCode: 'RETRY_SHANGHAI_TRAVEL_DOC_03',
    programName: '上海旅游风光',
    channelId: 'dragon',
    columnId: 'retry-column-shanghai-doc',
    columnName: '上海旅游',
    duration: 2400,
    programType: 'documentary',
    issueNo: '3',
    instanceName: '上海旅游风光 第3集',
    contentTags: ['上海', '旅游', '风光', '纪录片'],
    estimatedRating: 7.2,
    playCount: 58000,
    popularityScore: 53.5,
  },
]

/**
 * 全 0 命中场景假数据（空数组）。
 *
 * 用户输入"不存在的栏目XYZ"，节目库无任何匹配。
 * 对应 case 9.11 / 9.13。
 */
export const zeroHitMockCandidates: ProgramCandidate[] = []

/**
 * 节目检索重试场景专用 mock 数据合集。
 *
 * 由 CandidateService 构造时与 orchestrationDemoCandidates 合并去重加载（按 programCode）。
 */
export const candidateSearchRetryMockCandidates: ProgramCandidate[] = [
  ...typoFixMockCandidates,
  ...decomposeMockCandidates,
  ...columnDemoteMockCandidates,
  ...secondaryReflectionMockCandidates,
  ...paraphraseMockCandidates,
  ...broadenMockCandidates,
  ...zeroHitMockCandidates,
]
