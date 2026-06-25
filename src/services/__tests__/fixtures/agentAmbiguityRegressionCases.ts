export type AgentAmbiguityLevel =
  | 'precise'
  | 'business_specific'
  | 'underspecified_atomic'
  | 'fuzzy_planning'
  | 'long_running'

export type AgentAmbiguityPlaylist = 'tv' | 'rotation' | 'mixed' | 'none'

export type AgentAmbiguityDisposition =
  | 'execute_exactly'
  | 'direct_or_explain_with_evidence'
  | 'select_confirm_or_clarify'
  | 'draft_refine_or_suggest'
  | 'plan_observe_continue_or_stop'

export type AgentAmbiguityEvidenceLayer =
  | 'runtime_case'
  | 'browser_case'
  | 'llm_protocol'
  | 'coverage_matrix'
  | 'manual_smoke'

export interface AgentAmbiguityRegressionCase {
  id: string
  level: AgentAmbiguityLevel
  playlist: AgentAmbiguityPlaylist
  userInput: string
  preconditions: string[]
  expectedDisposition: AgentAmbiguityDisposition
  acceptanceSignals: string[]
  mustNotHappen: string[]
  evidence: {
    layer: AgentAmbiguityEvidenceLayer
    refs: string[]
  }
}

export const agentAmbiguityRegressionCases: AgentAmbiguityRegressionCase[] = [
  {
    id: 'precise-tv-move-forward-hour',
    level: 'precise',
    playlist: 'tv',
    userInput: '把9点的节目向后移动1小时',
    preconditions: ['电视播单已创建', '09:00 有唯一节目', '目标时间没有冲突'],
    expectedDisposition: 'execute_exactly',
    acceptanceSignals: ['开始时间从 09:00:00 变为 10:00:00', '不进入草案', '不进入不必要追问'],
    mustNotHappen: ['移动到 08:00:00', '把命令解释成草案调整', '要求用户重新描述明确命令'],
    evidence: {
      layer: 'runtime_case',
      refs: ['atomicOffsetParser.test.ts', 'paramExtractor.test.ts', 'schedulingAgentRuntime.nlMatrix.test.ts'],
    },
  },
  {
    id: 'precise-tv-delete-keeps-pending',
    level: 'precise',
    playlist: 'tv',
    userInput: '删除22点的节目',
    preconditions: ['电视播单已创建', '22:00 有唯一实际节目'],
    expectedDisposition: 'select_confirm_or_clarify',
    acceptanceSignals: ['展示删除确认', '确认前左侧节目不变', '确认后才删除'],
    mustNotHappen: ['直接删除', '误删草案段', '旧 pending 被新话题误执行'],
    evidence: {
      layer: 'browser_case',
      refs: ['agentWorkflowBrowserCases: atomic-after-generated-delete', 'foreground-browser-goal38'],
    },
  },
  {
    id: 'precise-rotation-strategy-rating',
    level: 'precise',
    playlist: 'rotation',
    userInput: '按收视率优先',
    preconditions: ['轮播单已创建'],
    expectedDisposition: 'execute_exactly',
    acceptanceSignals: ['策略切换为收视率优先', '左侧节目数量不变', '不出现候选确认'],
    mustNotHappen: ['创建电视播单', '误写正式节目', '提示缺少电视版面草案'],
    evidence: {
      layer: 'browser_case',
      refs: ['agentWorkflowBrowserCases: playlist-policy-rotation-switch-rating'],
    },
  },
  {
    id: 'business-tv-latest-episode-in-column',
    level: 'business_specific',
    playlist: 'tv',
    userInput: '在东方快报里，帮我找到期数最大的一期填入',
    preconditions: ['电视播单已创建', '草案里存在栏目=东方快报', '素材库存在东方快报多期候选'],
    expectedDisposition: 'direct_or_explain_with_evidence',
    acceptanceSignals: ['说明依据来自东方快报栏目或对应时段', '按期数或播出顺序收敛候选', '写入正式播单或在候选不唯一时说明需要选择'],
    mustNotHappen: ['只查整句导致无结果', '没有依据就静默失败', '把草案调整误当成正式插入'],
    evidence: {
      layer: 'manual_smoke',
      refs: ['Goal 52 manual browser smoke', 'schedulingAgentRuntime.nlMatrix.test.ts keyword rewrite cases'],
    },
  },
  {
    id: 'business-tv-reference-draft-full-generate',
    level: 'business_specific',
    playlist: 'tv',
    userInput: '参考草案编排全天节目',
    preconditions: ['电视播单已创建', '频道默认草案已加载'],
    expectedDisposition: 'plan_observe_continue_or_stop',
    acceptanceSignals: ['使用草案作为正式编排依据', '找不到候选时留空人工确认', '不把正式编排误反馈成草案更新'],
    mustNotHappen: ['无草案仍强排', '只更新草案不写正式播单', '找不到候选时阻断全局'],
    evidence: {
      layer: 'coverage_matrix',
      refs: ['foregroundAgentScenarioRegressionCases: tv-reference-draft-becomes-formal-basis'],
    },
  },
  {
    id: 'underspecified-atomic-in-column-fill',
    level: 'underspecified_atomic',
    playlist: 'tv',
    userInput: '在东方快报里填一期',
    preconditions: ['电视播单已创建', '当前草案或当前节目单能定位东方快报'],
    expectedDisposition: 'select_confirm_or_clarify',
    acceptanceSignals: ['能识别这是栏目定位加填入动作', '缺少期数/策略时追问或给出候选', '回复解释为什么需要确认'],
    mustNotHappen: ['直接失败说无法理解', '凭本地规则猜一个节目', '把东方快报当成完整关键词整句搜索'],
    evidence: {
      layer: 'manual_smoke',
      refs: ['Goal 52 manual browser smoke'],
    },
  },
  {
    id: 'underspecified-no-playlist-insert',
    level: 'underspecified_atomic',
    playlist: 'none',
    userInput: '9点插入看东方',
    preconditions: ['未创建播单'],
    expectedDisposition: 'select_confirm_or_clarify',
    acceptanceSignals: ['提示先新建电视播单或轮播单', '不创建候选确认', '左侧仍为空态'],
    mustNotHappen: ['自动创建错误播单', '无工作区仍写入节目', '清空 LLM 配置'],
    evidence: {
      layer: 'browser_case',
      refs: ['agentWorkflowBrowserCases: playlist-state-reject-atomic-before-create'],
    },
  },
  {
    id: 'fuzzy-rotation-world-cup-one-hour',
    level: 'fuzzy_planning',
    playlist: 'rotation',
    userInput: '新建一个世界杯的轮播单，主要涵盖亚洲各个球队的球员介绍，时长约1小时',
    preconditions: ['当前未打开播单或准备新建轮播单'],
    expectedDisposition: 'draft_refine_or_suggest',
    acceptanceSignals: ['创建轮播工作区', '整理成轮播草案', '目标总时长约 1 小时', '确认前不写正式节目'],
    mustNotHappen: ['误变成电视播单', '把约1小时解析成全天或 17:59:59', '模型失败后没有恢复反馈'],
    evidence: {
      layer: 'llm_protocol',
      refs: ['Goal 52 manual browser smoke', 'agentPlanner.ts create_playlist + prepare_layout_draft protocol'],
    },
  },
  {
    id: 'fuzzy-rotation-three-hour-district-scenic',
    level: 'fuzzy_planning',
    playlist: 'rotation',
    userInput: '新建3小时上海静安区景点轮播，先帮我整理一份草案',
    preconditions: ['当前未打开播单或轮播单已创建'],
    expectedDisposition: 'draft_refine_or_suggest',
    acceptanceSignals: ['按内容队列整理草案', '能引导继续细化或查证素材', '确认前不写正式节目'],
    mustNotHappen: ['强行套电视固定时段', '凭空声称素材已找到', '不说明下一步怎么继续'],
    evidence: {
      layer: 'coverage_matrix',
      refs: ['editorDemandCoverageCases: rotation-draft-rewrite-no-formal-write'],
    },
  },
  {
    id: 'fuzzy-draft-refine-hot-scenic',
    level: 'fuzzy_planning',
    playlist: 'rotation',
    userInput: '第一段金山区景点部分，选择金山区最近3年最火热的景点',
    preconditions: ['轮播单已有草案', '第一段是金山区景点'],
    expectedDisposition: 'draft_refine_or_suggest',
    acceptanceSignals: ['优先调整草案而非正式播单', '说明需要素材查证或候选核验', '草案调整不要求确认'],
    mustNotHappen: ['误写正式节目单', '要求确认草案调整', '把候选数伪装成已查证事实'],
    evidence: {
      layer: 'manual_smoke',
      refs: ['Goal 52 manual browser smoke', 'layoutDraftService.test.ts'],
    },
  },
  {
    id: 'long-running-delete-all-same-name',
    level: 'long_running',
    playlist: 'tv',
    userInput: '把全部看东方节目删除掉',
    preconditions: ['电视播单存在多条看东方'],
    expectedDisposition: 'plan_observe_continue_or_stop',
    acceptanceSignals: ['生成批量计划', '高影响操作进入确认', '分批执行时能说明已完成和剩余'],
    mustNotHappen: ['未确认直接批量删除', '失败后沉默', '遗漏恢复入口'],
    evidence: {
      layer: 'runtime_case',
      refs: ['foregroundAgentScenarioRegressionCases: composite-delete-all-same-name', 'schedulingAgentReactTaskRuntime.test.ts'],
    },
  },
  {
    id: 'long-running-conflicting-composite',
    level: 'long_running',
    playlist: 'tv',
    userInput: '把10点的节目移动到9点，再9点插入一个看东方节目',
    preconditions: ['电视播单 09:00 和 10:00 均可能已有节目'],
    expectedDisposition: 'plan_observe_continue_or_stop',
    acceptanceSignals: ['识别同一位置冲突', '说明需要用户确认执行顺序或选择覆盖策略', '不静默覆盖'],
    mustNotHappen: ['先移动再覆盖导致丢节目', '只执行其中一步却反馈完成', '把冲突写进草案'],
    evidence: {
      layer: 'coverage_matrix',
      refs: ['foregroundAgentScenarioRegressionCases: conflicting-command-blocks', 'schedulingTaskPlanConflict.test.ts'],
    },
  },
  {
    id: 'long-running-llm-failure-recoverable',
    level: 'long_running',
    playlist: 'mixed',
    userInput: '继续',
    preconditions: ['上一轮 LLM 超时或返回结构不完整', '系统保留最近一次失败观察'],
    expectedDisposition: 'plan_observe_continue_or_stop',
    acceptanceSignals: ['可重试上一小步', '失败后明确没有写入或说明已写入数量', '仍失败时给下一步'],
    mustNotHappen: ['无限重试', '丢失上下文', '失败后误报已完成'],
    evidence: {
      layer: 'runtime_case',
      refs: ['foregroundAgentScenarioRegressionCases: recoverable-llm-timeout-retry', 'schedulingAgentReactTaskRuntime.test.ts'],
    },
  },
]

export const ambiguityLevelsInAcceptanceOrder: AgentAmbiguityLevel[] = [
  'precise',
  'business_specific',
  'underspecified_atomic',
  'fuzzy_planning',
  'long_running',
]

export const summarizeAgentAmbiguityCases = (cases = agentAmbiguityRegressionCases) =>
  cases.reduce<Record<AgentAmbiguityLevel, number>>((summary, item) => {
    summary[item.level] += 1
    return summary
  }, {
    precise: 0,
    business_specific: 0,
    underspecified_atomic: 0,
    fuzzy_planning: 0,
    long_running: 0,
  })
