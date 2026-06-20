import type { LayoutIntentMode } from '@/services/layoutIntentRecognizer'

export interface LayoutIntentCommandCase {
  id: string
  input: string
  withDraft?: boolean
  hasUploadedLayout?: boolean
  emptySchedule?: boolean
  expected: {
    mode: LayoutIntentMode
    ignoreExistingLayout?: boolean
    targetTimeRange?: { start: string; end: string }
    semanticLabel?: string
    programTypeHint?: string
    segmentCount?: number
    segmentTypes?: string[]
  }
  library?: {
    programType: string
    minCandidates: number
  }
}

export const layoutIntentCommandCases: LayoutIntentCommandCase[] = [
  {
    id: 'prepare-ignore-afternoon-drama',
    input: '不参考版面，下午排入电视剧',
    expected: {
      mode: 'layout_prepare',
      ignoreExistingLayout: true,
      targetTimeRange: { start: '13:00:00', end: '18:00:00' },
      programTypeHint: 'drama',
    },
    library: { programType: 'drama', minCandidates: 250 },
  },
  {
    id: 'prepare-ignore-morning-news',
    input: '不参考当前版面，上午排入新闻栏目',
    expected: {
      mode: 'layout_prepare',
      ignoreExistingLayout: true,
      targetTimeRange: { start: '06:00:00', end: '12:00:00' },
      programTypeHint: 'news',
    },
    library: { programType: 'news', minCandidates: 80 },
  },
  {
    id: 'prepare-evening-variety',
    input: '晚间排入综艺节目',
    expected: {
      mode: 'layout_prepare',
      targetTimeRange: { start: '18:00:00', end: '23:00:00' },
      programTypeHint: 'entertainment',
    },
    library: { programType: 'entertainment', minCandidates: 40 },
  },
  {
    id: 'prepare-afternoon-news-casual',
    input: '下午上点新闻',
    expected: {
      mode: 'layout_prepare',
      targetTimeRange: { start: '13:00:00', end: '18:00:00' },
      semanticLabel: '新闻',
      programTypeHint: 'news',
    },
    library: { programType: 'news', minCandidates: 80 },
  },
  {
    id: 'prepare-event-preheat-casual',
    input: '赛前给赛事直播加一段预热',
    expected: {
      mode: 'layout_prepare',
      semanticLabel: '预热',
      programTypeHint: 'news_magazine',
    },
    library: { programType: 'news_magazine', minCandidates: 60 },
  },
  {
    id: 'prepare-evening-warmup-short',
    input: '晚间垫个暖场短片',
    expected: {
      mode: 'layout_prepare',
      targetTimeRange: { start: '18:00:00', end: '23:00:00' },
      semanticLabel: '暖场短片',
      programTypeHint: 'news_magazine',
    },
    library: { programType: 'news_magazine', minCandidates: 60 },
  },
  {
    id: 'prepare-live-highlights-by-clock',
    input: '14:00到15:00做直播花絮集锦',
    expected: {
      mode: 'layout_prepare',
      targetTimeRange: { start: '14:00:00', end: '15:00:00' },
      semanticLabel: '直播花絮集锦',
      programTypeHint: 'news_magazine',
    },
    library: { programType: 'news_magazine', minCandidates: 60 },
  },
  {
    id: 'prepare-launch-guide-casual',
    input: '发布会开播前垫一点现场导视',
    expected: {
      mode: 'layout_prepare',
      semanticLabel: '现场导视',
      programTypeHint: 'news_magazine',
    },
    library: { programType: 'news_magazine', minCandidates: 60 },
  },
  {
    id: 'prepare-weekend-service-tail-casual',
    input: '周末社区活动后面收个服务提醒',
    expected: {
      mode: 'layout_prepare',
      semanticLabel: '服务提醒',
      programTypeHint: 'news_magazine',
    },
    library: { programType: 'news_magazine', minCandidates: 60 },
  },
  {
    id: 'prepare-noon-news',
    input: '中午安排成新闻',
    expected: {
      mode: 'layout_prepare',
      targetTimeRange: { start: '12:00:00', end: '14:00:00' },
      programTypeHint: 'news',
    },
    library: { programType: 'news', minCandidates: 80 },
  },
  {
    id: 'prepare-health-by-clock-range',
    input: '13:00到18:00改成健康养生',
    expected: {
      mode: 'layout_prepare',
      targetTimeRange: { start: '13:00:00', end: '18:00:00' },
      programTypeHint: 'health',
    },
    library: { programType: 'health', minCandidates: 40 },
  },
  {
    id: 'prepare-commentary-by-clock-range',
    input: '18:00-23:00换成评论节目',
    expected: {
      mode: 'layout_prepare',
      targetTimeRange: { start: '18:00:00', end: '23:00:00' },
      programTypeHint: 'commentary',
    },
    library: { programType: 'commentary', minCandidates: 80 },
  },
  {
    id: 'prepare-kids-by-clock-range',
    input: '09:00到09:30排入少儿动画',
    expected: {
      mode: 'layout_prepare',
      targetTimeRange: { start: '09:00:00', end: '09:30:00' },
      programTypeHint: 'kids',
    },
    library: { programType: 'kids', minCandidates: 40 },
  },
  {
    id: 'prepare-documentary-by-clock-range',
    input: '22:00到23:00排入纪录片',
    expected: {
      mode: 'layout_prepare',
      targetTimeRange: { start: '22:00:00', end: '23:00:00' },
      programTypeHint: 'documentary',
    },
    library: { programType: 'documentary', minCandidates: 50 },
  },
  {
    id: 'prepare-documentary-by-start-duration',
    input: '14点开始排一个小时纪录片',
    expected: {
      mode: 'layout_prepare',
      targetTimeRange: { start: '14:00:00', end: '15:00:00' },
      programTypeHint: 'documentary',
    },
    library: { programType: 'documentary', minCandidates: 50 },
  },
  {
    id: 'prepare-news-by-start-duration',
    input: '从14点起排60分钟新闻',
    expected: {
      mode: 'layout_prepare',
      targetTimeRange: { start: '14:00:00', end: '15:00:00' },
      programTypeHint: 'news',
    },
    library: { programType: 'news', minCandidates: 80 },
  },
  {
    id: 'prepare-all-day-news-magazine',
    input: '全天排入资讯栏目',
    expected: {
      mode: 'layout_prepare',
      targetTimeRange: { start: '06:00:00', end: '23:59:59' },
      programTypeHint: 'news_magazine',
    },
    library: { programType: 'news_magazine', minCandidates: 60 },
  },
  {
    id: 'prepare-morning-kandongfang',
    input: '上午改成看东方资讯',
    expected: {
      mode: 'layout_prepare',
      targetTimeRange: { start: '06:00:00', end: '12:00:00' },
      programTypeHint: 'news_magazine',
    },
    library: { programType: 'news_magazine', minCandidates: 60 },
  },
  {
    id: 'prepare-afternoon-theater',
    input: '下午统一成剧场',
    expected: {
      mode: 'layout_prepare',
      targetTimeRange: { start: '13:00:00', end: '18:00:00' },
      programTypeHint: 'drama',
    },
    library: { programType: 'drama', minCandidates: 250 },
  },
  {
    id: 'prepare-evening-tv-drama',
    input: '晚上全部排入电视剧',
    expected: {
      mode: 'layout_prepare',
      targetTimeRange: { start: '18:00:00', end: '23:00:00' },
      programTypeHint: 'drama',
    },
    library: { programType: 'drama', minCandidates: 250 },
  },
  {
    id: 'prepare-late-commentary',
    input: '深夜排入评论节目',
    expected: {
      mode: 'layout_prepare',
      targetTimeRange: { start: '23:00:00', end: '23:59:59' },
      programTypeHint: 'commentary',
    },
    library: { programType: 'commentary', minCandidates: 80 },
  },
  {
    id: 'prepare-dawn-documentary',
    input: '凌晨排入纪录片',
    expected: {
      mode: 'layout_prepare',
      targetTimeRange: { start: '23:00:00', end: '23:59:59' },
      programTypeHint: 'documentary',
    },
    library: { programType: 'documentary', minCandidates: 50 },
  },
  {
    id: 'prepare-dongfang-kuaibao',
    input: '06:00到07:00排入东方快报',
    expected: {
      mode: 'layout_prepare',
      targetTimeRange: { start: '06:00:00', end: '07:00:00' },
      programTypeHint: 'news',
    },
    library: { programType: 'news', minCandidates: 80 },
  },
  {
    id: 'prepare-point-range-health',
    input: '12点到14点安排健康节目',
    expected: {
      mode: 'layout_prepare',
      targetTimeRange: { start: '12:00:00', end: '14:00:00' },
      programTypeHint: 'health',
    },
    library: { programType: 'health', minCandidates: 40 },
  },
  {
    id: 'prepare-point-range-drama',
    input: '19点到21点排入东方剧场',
    expected: {
      mode: 'layout_prepare',
      targetTimeRange: { start: '19:00:00', end: '21:00:00' },
      programTypeHint: 'drama',
    },
    library: { programType: 'drama', minCandidates: 250 },
  },
  {
    id: 'prepare-micro-drama',
    input: '21:30到22:00排入微短剧',
    expected: {
      mode: 'layout_prepare',
      targetTimeRange: { start: '21:30:00', end: '22:00:00' },
      programTypeHint: 'drama',
    },
    library: { programType: 'drama', minCandidates: 250 },
  },
  {
    id: 'prepare-ignore-all-day-news',
    input: '不参考版面，全天排入新闻',
    expected: {
      mode: 'layout_prepare',
      ignoreExistingLayout: true,
      targetTimeRange: { start: '06:00:00', end: '23:59:59' },
      programTypeHint: 'news',
    },
    library: { programType: 'news', minCandidates: 80 },
  },
  {
    id: 'prepare-dongfang-news',
    input: '18:30到19:00改成东方新闻',
    expected: {
      mode: 'layout_prepare',
      targetTimeRange: { start: '18:30:00', end: '19:00:00' },
      programTypeHint: 'news',
    },
    library: { programType: 'news', minCandidates: 80 },
  },
  {
    id: 'prepare-mingyi-health',
    input: '下午铺成名医话养生',
    expected: {
      mode: 'layout_prepare',
      targetTimeRange: { start: '13:00:00', end: '18:00:00' },
      programTypeHint: 'health',
    },
    library: { programType: 'health', minCandidates: 40 },
  },
  {
    id: 'prepare-morning-kids',
    input: '上午排入少儿节目',
    expected: {
      mode: 'layout_prepare',
      targetTimeRange: { start: '06:00:00', end: '12:00:00' },
      programTypeHint: 'kids',
    },
    library: { programType: 'kids', minCandidates: 40 },
  },
  {
    id: 'prepare-evening-entertainment-variety',
    input: '晚间换成娱乐综艺',
    expected: {
      mode: 'layout_prepare',
      targetTimeRange: { start: '18:00:00', end: '23:00:00' },
      programTypeHint: 'entertainment',
    },
    library: { programType: 'entertainment', minCandidates: 40 },
  },
  {
    id: 'prepare-shanghai-eye',
    input: '12:30到13:00安排ShanghaiEye资讯',
    expected: {
      mode: 'layout_prepare',
      targetTimeRange: { start: '12:30:00', end: '13:00:00' },
      programTypeHint: 'news_magazine',
    },
    library: { programType: 'news_magazine', minCandidates: 60 },
  },
  {
    id: 'prepare-early-peak-news-flash',
    input: '早高峰主打新闻快报',
    expected: {
      mode: 'layout_prepare',
      targetTimeRange: { start: '07:00:00', end: '09:00:00' },
      programTypeHint: 'news',
    },
    library: { programType: 'news', minCandidates: 80 },
  },
  {
    id: 'prepare-evening-peak-traffic-service',
    input: '晚高峰多一点交通服务提醒',
    expected: {
      mode: 'layout_prepare',
      targetTimeRange: { start: '17:00:00', end: '19:00:00' },
      programTypeHint: 'news_magazine',
    },
    library: { programType: 'news_magazine', minCandidates: 60 },
  },
  {
    id: 'prepare-golden-variety',
    input: '黄金档主打综艺',
    expected: {
      mode: 'layout_prepare',
      targetTimeRange: { start: '19:00:00', end: '20:00:00' },
      programTypeHint: 'entertainment',
    },
    library: { programType: 'entertainment', minCandidates: 40 },
  },
  {
    id: 'prepare-seven-special-news',
    input: '今晚七点档换成新闻特别报道',
    expected: {
      mode: 'layout_prepare',
      targetTimeRange: { start: '19:00:00', end: '20:00:00' },
      semanticLabel: '新闻特别报道',
      programTypeHint: 'news',
    },
    library: { programType: 'news', minCandidates: 80 },
  },
  {
    id: 'prepare-eight-micro-drama',
    input: '八点档安排微短剧',
    expected: {
      mode: 'layout_prepare',
      targetTimeRange: { start: '20:00:00', end: '21:00:00' },
      programTypeHint: 'drama',
    },
    library: { programType: 'drama', minCandidates: 250 },
  },
  {
    id: 'prepare-dusk-weather-traffic',
    input: '傍晚做天气交通服务',
    expected: {
      mode: 'layout_prepare',
      targetTimeRange: { start: '17:00:00', end: '19:00:00' },
      programTypeHint: 'news_magazine',
    },
    library: { programType: 'news_magazine', minCandidates: 60 },
  },
  {
    id: 'prepare-early-kandongfang',
    input: '早间铺成看东方资讯',
    expected: {
      mode: 'layout_prepare',
      targetTimeRange: { start: '06:00:00', end: '09:00:00' },
      semanticLabel: '看东方资讯',
      programTypeHint: 'news_magazine',
    },
    library: { programType: 'news_magazine', minCandidates: 60 },
  },
  {
    id: 'prepare-afternoon-citizen-service',
    input: '午后以民生服务为主',
    expected: {
      mode: 'layout_prepare',
      targetTimeRange: { start: '13:00:00', end: '18:00:00' },
      programTypeHint: 'commentary',
    },
    library: { programType: 'commentary', minCandidates: 80 },
  },
  {
    id: 'prepare-preserve-morning-fill-afternoon-drama',
    input: '保留上午节目，下午补齐电视剧',
    expected: {
      mode: 'layout_prepare',
      targetTimeRange: { start: '13:00:00', end: '18:00:00' },
      programTypeHint: 'drama',
    },
    library: { programType: 'drama', minCandidates: 250 },
  },
  {
    id: 'prepare-preserve-morning-evening-variety',
    input: '上午新闻保持不动，晚间加综艺',
    expected: {
      mode: 'layout_prepare',
      targetTimeRange: { start: '18:00:00', end: '23:00:00' },
      programTypeHint: 'entertainment',
    },
    library: { programType: 'entertainment', minCandidates: 40 },
  },
  {
    id: 'segments-news-drama-variety',
    input: '上午新闻，下午剧场，晚间综艺',
    expected: {
      mode: 'layout_prepare',
      targetTimeRange: { start: '06:00:00', end: '23:00:00' },
      segmentCount: 3,
      segmentTypes: ['news', 'drama', 'entertainment'],
    },
  },
  {
    id: 'segments-info-health-commentary',
    input: '上午资讯，下午健康，晚间评论',
    expected: {
      mode: 'layout_prepare',
      segmentCount: 3,
      segmentTypes: ['news_magazine', 'health', 'commentary'],
    },
  },
  {
    id: 'segments-clock-kids-drama',
    input: '06:00到09:00新闻，09:00到12:00少儿，下午电视剧',
    expected: {
      mode: 'layout_prepare',
      segmentCount: 3,
      segmentTypes: ['news', 'kids', 'drama'],
    },
  },
  {
    id: 'segments-noon-doc-drama',
    input: '中午新闻，下午纪录片，晚上电视剧',
    expected: {
      mode: 'layout_prepare',
      segmentCount: 3,
      segmentTypes: ['news', 'documentary', 'drama'],
    },
  },
  {
    id: 'segments-kandongfang-health-commentary',
    input: '上午看东方资讯，下午名医话养生，晚间今晚评论',
    expected: {
      mode: 'layout_prepare',
      segmentCount: 3,
      segmentTypes: ['news_magazine', 'health', 'commentary'],
    },
  },
  {
    id: 'segments-explicit-ranges',
    input: '06:00-12:00新闻，13:00-18:00剧场，18:00-23:00综艺',
    expected: {
      mode: 'layout_prepare',
      segmentCount: 3,
      segmentTypes: ['news', 'drama', 'entertainment'],
    },
  },
  {
    id: 'refine-evening-news',
    input: '晚上全部替换成新闻栏目',
    withDraft: true,
    expected: {
      mode: 'layout_refine',
      targetTimeRange: { start: '18:00:00', end: '23:00:00' },
      programTypeHint: 'news',
    },
    library: { programType: 'news', minCandidates: 80 },
  },
  {
    id: 'refine-afternoon-drama',
    input: '下午改成电视剧',
    withDraft: true,
    expected: {
      mode: 'layout_refine',
      targetTimeRange: { start: '13:00:00', end: '18:00:00' },
      programTypeHint: 'drama',
    },
    library: { programType: 'drama', minCandidates: 250 },
  },
  {
    id: 'refine-clock-drama',
    input: '19:00到21:00换成东方剧场',
    withDraft: true,
    expected: {
      mode: 'layout_refine',
      targetTimeRange: { start: '19:00:00', end: '21:00:00' },
      programTypeHint: 'drama',
    },
    library: { programType: 'drama', minCandidates: 250 },
  },
  {
    id: 'refine-remove-six',
    input: '删除6点的草案',
    withDraft: true,
    expected: {
      mode: 'layout_refine',
    },
  },
  {
    id: 'refine-remove-evening-theater',
    input: '删除晚间剧场草案',
    withDraft: true,
    expected: {
      mode: 'layout_refine',
    },
  },
  {
    id: 'refine-range-variety',
    input: '把18:00到23:00改成综艺',
    withDraft: true,
    expected: {
      mode: 'layout_refine',
      targetTimeRange: { start: '18:00:00', end: '23:00:00' },
      programTypeHint: 'entertainment',
    },
    library: { programType: 'entertainment', minCandidates: 40 },
  },
  {
    id: 'refine-evening-health',
    input: '晚间统一成健康节目',
    withDraft: true,
    expected: {
      mode: 'layout_refine',
      targetTimeRange: { start: '18:00:00', end: '23:00:00' },
      programTypeHint: 'health',
    },
    library: { programType: 'health', minCandidates: 40 },
  },
  {
    id: 'refine-point-commentary',
    input: '21点到22点替换为评论',
    withDraft: true,
    expected: {
      mode: 'layout_refine',
      targetTimeRange: { start: '21:00:00', end: '22:00:00' },
      programTypeHint: 'commentary',
    },
    library: { programType: 'commentary', minCandidates: 80 },
  },
  {
    id: 'refine-context-preheat',
    input: '就按刚才那个主题加一点预热',
    withDraft: true,
    expected: {
      mode: 'layout_refine',
      semanticLabel: '预热',
      programTypeHint: 'news_magazine',
    },
    library: { programType: 'news_magazine', minCandidates: 60 },
  },
  {
    id: 'refine-context-community-service',
    input: '这个版面围绕社区服务',
    withDraft: true,
    expected: {
      mode: 'layout_refine',
      semanticLabel: '社区服务',
      programTypeHint: 'news_magazine',
    },
    library: { programType: 'news_magazine', minCandidates: 60 },
  },
  {
    id: 'restart-discard-current-draft-evening-news',
    input: '这个草案不要了，重新做晚间新闻',
    withDraft: true,
    expected: {
      mode: 'layout_prepare',
      ignoreExistingLayout: true,
      targetTimeRange: { start: '18:00:00', end: '23:00:00' },
      programTypeHint: 'news',
    },
    library: { programType: 'news', minCandidates: 80 },
  },
  {
    id: 'commit-start',
    input: '按这个版面开始编排',
    withDraft: true,
    expected: { mode: 'layout_commit' },
  },
  {
    id: 'commit-uploaded-layout',
    input: '按这个版面开始编排',
    hasUploadedLayout: true,
    expected: { mode: 'layout_commit' },
  },
  {
    id: 'commit-confirm',
    input: '确认版面',
    withDraft: true,
    expected: { mode: 'layout_commit' },
  },
  {
    id: 'commit-adopt',
    input: '采用这个版面',
    withDraft: true,
    expected: { mode: 'layout_commit' },
  },
  {
    id: 'commit-use',
    input: '用这个版面编排',
    withDraft: true,
    expected: { mode: 'layout_commit' },
  },
  {
    id: 'commit-short-ok',
    input: '可以了',
    withDraft: true,
    expected: { mode: 'layout_commit' },
  },
  {
    id: 'commit-short-use-this',
    input: '就按这个来',
    withDraft: true,
    expected: { mode: 'layout_commit' },
  },
  {
    id: 'commit-short-start',
    input: '没问题开始编排',
    withDraft: true,
    expected: { mode: 'layout_commit' },
  },
  {
    id: 'analysis-business-report',
    input: '请分析当前版面编排，给我一份业务分析报告',
    expected: { mode: 'layout_analysis' },
  },
  {
    id: 'analysis-editor-perspective',
    input: '从编导视角分析当前节目单编排',
    expected: { mode: 'layout_analysis' },
  },
  {
    id: 'analysis-current-schedule',
    input: '评估当前编排情况',
    expected: { mode: 'layout_analysis' },
  },
  {
    id: 'analysis-program-schedule',
    input: '梳理当前节目编排',
    expected: { mode: 'layout_analysis' },
  },
  {
    id: 'optimize-current-layout',
    input: '请优化当前版面编排',
    expected: {
      mode: 'layout_prepare',
      ignoreExistingLayout: true,
    },
  },
  {
    id: 'optimize-current-schedule',
    input: '优化当前编排',
    expected: {
      mode: 'layout_prepare',
      ignoreExistingLayout: true,
    },
  },
  {
    id: 'optimize-rebuild-layout',
    input: '重做当前版面',
    expected: {
      mode: 'layout_prepare',
      ignoreExistingLayout: true,
    },
  },
  {
    id: 'full-fill-all-day',
    input: '帮我填充全天节目',
    emptySchedule: true,
    expected: {
      mode: 'clarify',
    },
  },
  {
    id: 'full-generate-all-day',
    input: '全天编排',
    emptySchedule: true,
    expected: {
      mode: 'clarify',
    },
  },
  {
    id: 'full-fill-gaps',
    input: '补齐当前所有空窗',
    expected: { mode: 'clarify' },
  },
  {
    id: 'clarify-vague-layout',
    input: '帮我做一个版面',
    expected: { mode: 'clarify' },
  },
  {
    id: 'clarify-vague-schedule',
    input: '下单排单',
    expected: { mode: 'clarify' },
  },
  {
    id: 'atomic-fallback-shift',
    input: '把9点后那段顺一个',
    expected: { mode: 'atomic_fallback' },
  },
  {
    id: 'atomic-fallback-delete',
    input: '删除那个节目',
    expected: { mode: 'atomic_fallback' },
  },
]
