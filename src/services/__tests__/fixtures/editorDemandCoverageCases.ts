export type EditorDemandCategory =
  | 'workspace'
  | 'tv_layout_draft'
  | 'rotation_draft'
  | 'atomic_command'
  | 'composite_task'
  | 'read_only_analysis'
  | 'confirmation'
  | 'pending_context'
  | 'guardrail'
  | 'configuration'
  | 'public_access'

export type EditorDemandPlaylistModel = 'none' | 'tv' | 'rotation' | 'mixed'

export type EditorDemandSupportLevel =
  | 'supported'
  | 'guarded_supported'
  | 'partial'
  | 'not_yet'

export type EditorDemandHarness =
  | 'foreground_runtime'
  | 'foreground_browser'
  | 'contract_test'
  | 'llm_protocol'
  | 'manual_product_gate'

export type EditorDemandRootCause =
  | 'none'
  | 'business_guardrail'
  | 'candidate_ambiguity'
  | 'missing_user_input'
  | 'data_realism_gap'
  | 'atomic_capability_gap'
  | 'batch_execution_limit'
  | 'context_management_gap'
  | 'ui_feedback_gap'
  | 'public_access_gap'
  | 'harness_gap'

export type EditorDemandEngineeringPhase =
  | 'design'
  | 'implementation'
  | 'review'
  | 'verification'

export interface EditorDemandCoverageCase {
  id: string
  category: EditorDemandCategory
  playlistModel: EditorDemandPlaylistModel
  userRequest: string
  expectedDisposition: string
  supportLevel: EditorDemandSupportLevel
  harness: EditorDemandHarness
  coveredBy: string[]
  rootCauses: EditorDemandRootCause[]
  reverseInference: string
  /** Agent Harness 五字段；新增或修订 case 必须显式填写。 */
  userInput?: string
  expectedDecision?: string
  mustNotHappen?: string
  verification?: string
}

export interface EditorDemandHarnessEngineeringRule {
  phase: EditorDemandEngineeringPhase
  rule: string
  enforcedBy: EditorDemandHarness[]
}

export type RecommendedEngineeringSkillType =
  | 'aibiandan_agent_harness'
  | 'test_driven_development'
  | 'code_review'
  | 'browser_e2e'
  | 'product_design'
  | 'security_review'
  | 'deployment_readiness'

export type RecommendedEngineeringSkillSource =
  | 'project_specific'
  | 'openai_curated_skill'
  | 'installed_plugin'
  | 'future_external_skill'

export interface RecommendedEngineeringSkillFit {
  type: RecommendedEngineeringSkillType
  source: RecommendedEngineeringSkillSource
  candidateNames: string[]
  fit: 'strong' | 'medium'
  why: string
  shouldConstrain: string[]
  mustRemainProjectSpecific: string[]
}

export const editorDemandRootCauseLabels: Record<EditorDemandRootCause, string> = {
  none: '通用链路已经可以承接',
  business_guardrail: '业务上必须阻拦或确认，不能交给模型直接写入',
  candidate_ambiguity: '候选不唯一，需要给出推荐依据并引导用户补充要求，不能自动替用户决定',
  missing_user_input: '用户缺少必要目标，比如轮播总时长、主题、位置或替换对象',
  data_realism_gap: '假数据或检索侧不够真实，影响模型判断用户心中想要的节目',
  atomic_capability_gap: '原子能力还不完整，任务计划已经能描述但执行器不能稳定落地',
  batch_execution_limit: '大批量任务需要分批、继续确认、失败恢复和上限控制',
  context_management_gap: '需要更稳的工作区、草案、pending 或多轮上下文管理',
  ui_feedback_gap: '能力存在，但前台反馈还不够像编排员能理解的人话',
  public_access_gap: '还没有可随时访问的匿名演示入口和服务端密钥隔离',
  harness_gap: '缺少真实前台或协议级自动验证，当前只能人工判断',
}

export const editorDemandHarnessEngineeringRules: EditorDemandHarnessEngineeringRule[] = [
  {
    phase: 'design',
    rule: '每个 Agent 改动必须先映射到一个或多个编排员需求 case；如果没有对应 case，先补 case，再设计实现。',
    enforcedBy: ['contract_test', 'foreground_runtime', 'manual_product_gate'],
  },
  {
    phase: 'design',
    rule: '设计时必须写明前置状态、允许路径和禁止路径；草案、正式播单、pending 和工作区边界不得只靠口头约束。',
    enforcedBy: ['contract_test', 'foreground_browser'],
  },
  {
    phase: 'implementation',
    rule: '宽泛自然语言理解优先走 LLM 协议和 taskPlan；本地只新增可解释的状态门禁、业务裁决、候选确认或原子执行边界。',
    enforcedBy: ['llm_protocol', 'foreground_runtime'],
  },
  {
    phase: 'implementation',
    rule: '新增特殊逻辑必须能归因到 rootCause；不能为了一个说法直接堆不可复用的关键词分支。',
    enforcedBy: ['contract_test'],
  },
  {
    phase: 'review',
    rule: '评审先看是否误写正式播单、误改草案、绕过 pending、多候选自动选、OpenClaw 反向绑定前台路径。',
    enforcedBy: ['contract_test', 'foreground_browser'],
  },
  {
    phase: 'review',
    rule: '评审要同时检查用户可见回复是否是编排员能懂的人话，技术证据只能放在弱过程或详情。',
    enforcedBy: ['llm_protocol', 'foreground_browser'],
  },
  {
    phase: 'verification',
    rule: '验收必须组合使用确定性 runtime/contract 测试、前台浏览器场景、LLM 协议测试和人工产品门槛；不能只靠单一种类测试。',
    enforcedBy: ['foreground_runtime', 'foreground_browser', 'contract_test', 'llm_protocol', 'manual_product_gate'],
  },
  {
    phase: 'verification',
    rule: '验证结论必须反向归因：已支持、带保护支持、部分支持或未支持分别说明证据和缺口。',
    enforcedBy: ['contract_test', 'manual_product_gate'],
  },
]

export const recommendedEngineeringSkillFits: RecommendedEngineeringSkillFit[] = [
  {
    type: 'aibiandan_agent_harness',
    source: 'project_specific',
    candidateNames: [],
    fit: 'strong',
    why: '当前可安装 skill 清单里没有官方 agent_harness；这个项目的核心风险是自然语言、工作区、草案、pending、原子能力和正式写入之间的链路漂移，所以必须自建项目级 harness。',
    shouldConstrain: [
      '先写需求 case 和前置状态，再实现',
      '每次 Agent 改动必须说明允许路径和禁止路径',
      '特殊逻辑必须有 rootCause 和 harness 证据',
    ],
    mustRemainProjectSpecific: [
      '电视播单是时间格子，轮播单是内容队列',
      '草案和正式播单默认独立',
      '轮播整体编排必须有草案，原子操作不需要草案',
    ],
  },
  {
    type: 'test_driven_development',
    source: 'future_external_skill',
    candidateNames: [],
    fit: 'strong',
    why: '当前可安装 skill 清单里没有直接的 TDD skill；但 TDD 方法必须约束本项目，因为最容易反复回归的是显式参考草案、普通补空窗、多候选确认和 pending 失效。',
    shouldConstrain: [
      '修 bug 前先补能失败的契约或 runtime 测试',
      '新增能力必须挂到现有 fixture 或 harness',
      '不能用一条窄测试证明一个宽能力',
    ],
    mustRemainProjectSpecific: [
      '编排员自然语言需求矩阵',
      '真实前台 ChatPanel / broadcast-plan 路径',
      '候选选择、草案门禁和写入裁决',
    ],
  },
  {
    type: 'code_review',
    source: 'openai_curated_skill',
    candidateNames: ['gh-address-comments', 'gh-fix-ci'],
    fit: 'strong',
    why: '当前可安装清单里没有通用 code-review skill，但有 GitHub review/CI 相关 skill；本项目仍需要把 review 重点固定为行为回归、误写正式播单、状态污染和测试证据不足。',
    shouldConstrain: [
      '评审先列风险和证据，不先写总结',
      '检查新增本地判断是否能归因到业务边界',
      '检查是否破坏 LLM-only 理解路径',
    ],
    mustRemainProjectSpecific: [
      'OpenClaw 不能成为前台阻塞条件',
      '本地 LLM 配置和 API key 不能被清空',
      '主回复必须面向低学历编排员表达',
    ],
  },
  {
    type: 'browser_e2e',
    source: 'openai_curated_skill',
    candidateNames: ['playwright', 'playwright-interactive', 'screenshot'],
    fit: 'strong',
    why: '真实前台路径是 ChatPanel / broadcast-plan，浏览器 E2E skill 能约束“页面真的能点、字段真的不残留、对话真的能承接”。',
    shouldConstrain: [
      '关键编排员链路必须有前台模拟或截图证据',
      '电视/轮播字段、草案入口、pending 卡片和主回复都要在页面层验证',
      '不要用纯 runtime 绿灯替代真实前台体验',
    ],
    mustRemainProjectSpecific: [
      '10 条以上编排员真实前台链路',
      '轮播单不显示电视字段',
      '草案确认前不写正式播单',
    ],
  },
  {
    type: 'product_design',
    source: 'installed_plugin',
    candidateNames: ['product-design:get-context', 'product-design:index'],
    fit: 'medium',
    why: '前台体验很重要，但它应该约束 UI 和对话可理解性，不应替代 Agent runtime 的业务 harness。',
    shouldConstrain: [
      '低学历编排员能读懂主回复',
      '系统过程弱化，主回复像人在交流',
      '轮播单不显示电视字段',
    ],
    mustRemainProjectSpecific: [
      'AI编审助手的工作区语义',
      '电视草案与轮播草案的不同呈现',
      '确认面板像 Codex 审查但文案要业务化',
    ],
  },
  {
    type: 'security_review',
    source: 'openai_curated_skill',
    candidateNames: ['security-best-practices', 'security-threat-model', 'security-ownership-map'],
    fit: 'medium',
    why: '一旦进入公开访问 Demo，API key、匿名会话、演示数据和外部调用边界会变成安全问题。',
    shouldConstrain: [
      '公开访问前必须做威胁建模',
      '浏览器不能暴露服务端 LLM key',
      '演示用户之间必须隔离会话和播单状态',
    ],
    mustRemainProjectSpecific: [
      '演示数据和真实业务数据隔离',
      '正式写入能力是否对匿名用户开放',
      '外部调用方不能反向绑定前台实现',
    ],
  },
  {
    type: 'deployment_readiness',
    source: 'openai_curated_skill',
    candidateNames: ['vercel-deploy', 'netlify-deploy', 'cloudflare-deploy', 'render-deploy'],
    fit: 'medium',
    why: '开放给别人访问之前需要匿名会话、服务端 key、演示数据、限流和失败日志；但当前 Goal 24 主要是能力审计。',
    shouldConstrain: [
      '不能把浏览器本地 key 暴露给公开访问用户',
      '每个匿名用户会话隔离',
      '演示环境只能接假数据或演示租户',
    ],
    mustRemainProjectSpecific: [
      '公开 Demo 是否允许正式写入',
      '演示节目库的真实性边界',
      '外部调用方只作为消费者，不反向绑定前台实现',
    ],
  },
]

const editorDemandCoverageCaseDrafts: EditorDemandCoverageCase[] = [
  {
    id: 'workspace-create-tv',
    category: 'workspace',
    playlistModel: 'tv',
    userRequest: '新建电视播单',
    expectedDisposition: '进入电视播单工作区，并加载当前频道日期的版面草案入口。',
    supportLevel: 'supported',
    harness: 'foreground_browser',
    coveredBy: ['demoRuntimeFacade.playlistState.test.ts', 'Goal 23 browser scenario 02'],
    rootCauses: ['none'],
    reverseInference: '这是工作区状态切换，不需要 LLM 深度判断，本地只负责创建当前播单上下文。',
  },
  {
    id: 'workspace-create-rotation-empty',
    category: 'workspace',
    playlistModel: 'rotation',
    userRequest: '新建轮播单',
    expectedDisposition: '进入轮播单工作区，但不凭空生成草案。',
    supportLevel: 'supported',
    harness: 'foreground_browser',
    coveredBy: ['demoRuntimeFacade.playlistState.test.ts', 'Goal 23 browser scenario 06'],
    rootCauses: ['none'],
    reverseInference: '轮播单默认没有频道日期草案，本地状态机可以直接完成创建。',
  },
  {
    id: 'tv-default-layout-visible',
    category: 'tv_layout_draft',
    playlistModel: 'tv',
    userRequest: '切到版面草案看看',
    expectedDisposition: '显示东方卫视当前频道日期草案和编排策略说明。',
    supportLevel: 'supported',
    harness: 'foreground_browser',
    coveredBy: ['foregroundLayoutDraft.test.ts', 'Goal 23 browser scenario 02'],
    rootCauses: ['none'],
    reverseInference: '电视草案是业务必然存在的数据，本地应优先自动加载，不依赖用户上传。',
  },
  {
    id: 'tv-switch-yesterday-layout',
    category: 'tv_layout_draft',
    playlistModel: 'tv',
    userRequest: '还是按照昨天的版面草案来',
    expectedDisposition: '切换当前激活草案到昨天频道版面，并在对话中反馈。',
    supportLevel: 'supported',
    harness: 'foreground_browser',
    coveredBy: ['demoRuntimeFacade.playlistState.test.ts', 'Goal 23 browser scenario 05'],
    rootCauses: ['none'],
    reverseInference: '当前只允许一个激活草案，切换草案是工作区状态变化，不应直接写正式播单。',
  },
  {
    id: 'tv-reference-draft-full-day',
    category: 'tv_layout_draft',
    playlistModel: 'tv',
    userRequest: '参考草案把全天编排一下',
    expectedDisposition: '显式使用草案作为依据，进入全天或大时段编排流程。',
    supportLevel: 'guarded_supported',
    harness: 'contract_test',
    coveredBy: ['foregroundAgentGoalContracts.test.ts', 'foregroundAgentVerificationMatrix.test.ts'],
    rootCauses: ['business_guardrail'],
    reverseInference: '草案和正式播单独立，只有用户明确参考草案时才注入草案依据。',
  },
  {
    id: 'tv-normal-fill-gaps-ignore-draft',
    category: 'tv_layout_draft',
    playlistModel: 'tv',
    userRequest: '补齐当前所有空窗',
    expectedDisposition: '走正式播单补空窗，不因为左侧存在草案就改草案。',
    supportLevel: 'supported',
    harness: 'contract_test',
    coveredBy: ['foregroundAgentGoalContracts.test.ts'],
    rootCauses: ['none'],
    reverseInference: '这条需求证明草案默认不阻碍正式编排，本地裁决比模型表达更重要。',
  },
  {
    id: 'tv-no-layout-full-day-block',
    category: 'guardrail',
    playlistModel: 'tv',
    userRequest: '没有草案也帮我把电视全天排完',
    expectedDisposition: '阻拦，并提示缺少草案依据。',
    supportLevel: 'guarded_supported',
    harness: 'contract_test',
    coveredBy: ['runtimePlaylistPolicy.test.ts', 'foregroundAgentGoalContracts.test.ts'],
    rootCauses: ['business_guardrail'],
    reverseInference: '电视全天编排信息量太大，草案为结构化依据，缺失时不能凭一句话自动排。',
  },
  {
    id: 'tv-partial-layout-suggest-refine',
    category: 'tv_layout_draft',
    playlistModel: 'tv',
    userRequest: '草案只到下午，剩下晚上也帮我补一下思路',
    expectedDisposition: '基于已有草案给建议，允许继续补充草案信息，但不误写正式播单。',
    supportLevel: 'supported',
    harness: 'foreground_browser',
    coveredBy: [
      'layoutDraftCompleteness.test.ts',
      'layoutDraftService.test.ts',
      'demoRuntimeFacade.fullGenerateBootstrap.test.ts',
      'Goal 37 browser scenario tv-partial-layout-suggest-refine',
    ],
    rootCauses: ['none'],
    reverseInference: 'planner 读取 partial 草案上下文后决定续补；多段 refine 默认与既有草案合并，只有明确整份重写才替换。',
  },
  {
    id: 'tv-insert-column-at-time',
    category: 'atomic_command',
    playlistModel: 'tv',
    userRequest: '9点排入栏目看东方',
    expectedDisposition: '按栏目优先检索，多个候选时进入选择，不直接写入。',
    supportLevel: 'guarded_supported',
    harness: 'foreground_runtime',
    coveredBy: ['foregroundAgentFlow.test.ts', 'retrievalConstraintCompiler.test.ts'],
    rootCauses: ['candidate_ambiguity'],
    reverseInference: 'LLM 可以理解栏目三态，本地必须守住多候选选择边界。',
  },
  {
    id: 'tv-insert-naked-name',
    category: 'atomic_command',
    playlistModel: 'tv',
    userRequest: '9点排看东方',
    expectedDisposition: '裸名称同时尝试栏目和节目匹配，多个候选时让用户选。',
    supportLevel: 'guarded_supported',
    harness: 'foreground_runtime',
    coveredBy: ['foregroundAgentFlow.test.ts', 'retrievalConstraintCompiler.test.ts'],
    rootCauses: ['candidate_ambiguity'],
    reverseInference: '裸名称不能幻想类型，检索约束应放宽，执行边界仍由候选选择控制。',
  },
  {
    id: 'tv-insert-specific-program',
    category: 'atomic_command',
    playlistModel: 'tv',
    userRequest: '9点插入节目看东方111期新春特别行动',
    expectedDisposition: '按具体节目名检索，仍需检查时长、占位和候选唯一性。',
    supportLevel: 'guarded_supported',
    harness: 'foreground_runtime',
    coveredBy: ['foregroundAgentFlow.test.ts', 'insertCandidateResolver.test.ts'],
    rootCauses: ['candidate_ambiguity'],
    reverseInference: '具体节目名提高命中率，但不能跳过候选、时长和占位校验。',
  },
  {
    id: 'tv-sequence-unique-direct',
    category: 'atomic_command',
    playlistModel: 'tv',
    userRequest: '把人文中国顺着排到9点',
    expectedDisposition: '如果当前/历史编排证明上一期已播到第12集，且候选库只有第13集可排，则直接写入并说明顺接依据。',
    supportLevel: 'supported',
    harness: 'foreground_runtime',
    coveredBy: ['schedulingAgentRuntime.commandMatrix.test.ts', 'schedulingAgentRuntime.intentInterpreter.test.ts'],
    rootCauses: ['none'],
    reverseInference: '电视顺播不是普通多候选相似度选择；期数和历史基线把候选收敛成唯一可排节目时，确认会打断编排节奏。',
  },
  {
    id: 'tv-insert-occupied-with-shift',
    category: 'atomic_command',
    playlistModel: 'tv',
    userRequest: '9点强制插入一个30分钟宣传片，其余节目可以后移',
    expectedDisposition: '生成插入加后移任务计划，先确认再执行。',
    supportLevel: 'guarded_supported',
    harness: 'foreground_runtime',
    coveredBy: ['demoRuntimeFacade.taskPlanDraft.test.ts', 'schedulingTaskPlanCompiler.test.ts'],
    rootCauses: ['business_guardrail'],
    reverseInference: '这不是单条插入，而是复合任务，本地需要确认整体影响后才能写。',
  },
  {
    id: 'tv-insert-conflicting-two-programs',
    category: 'guardrail',
    playlistModel: 'tv',
    userRequest: '9点插入看东方和百姓大讲堂',
    expectedDisposition: '识别为同一位置冲突，要求用户选择或拆成两个位置。',
    supportLevel: 'guarded_supported',
    harness: 'contract_test',
    coveredBy: ['schedulingTaskPlanConflict.test.ts', 'demoRuntimeFacade.taskPlanDraft.test.ts'],
    rootCauses: ['business_guardrail'],
    reverseInference: '自由表达会有矛盾，LLM 可以指出冲突，本地必须阻止进入执行。',
  },
  {
    id: 'tv-move-occupied-target',
    category: 'guardrail',
    playlistModel: 'tv',
    userRequest: '把10点的节目移动到9点',
    expectedDisposition: '如果9点已有节目，阻拦或要求用户允许后移。',
    supportLevel: 'guarded_supported',
    harness: 'foreground_runtime',
    coveredBy: ['foregroundAgentFlow.test.ts', 'demoRuntimeFacade.playlistState.test.ts'],
    rootCauses: ['business_guardrail'],
    reverseInference: '时间格子模型不能静默覆盖，本地时间冲突检查是必须特殊边界。',
  },
  {
    id: 'tv-replace-shorter-duration',
    category: 'atomic_command',
    playlistModel: 'tv',
    userRequest: '把9点45分钟节目换成30分钟节目',
    expectedDisposition: '需要说明时长变化，不能静默吞掉或自动缩进后续节目。',
    supportLevel: 'supported',
    harness: 'foreground_runtime',
    coveredBy: ['foregroundAgentFlow.test.ts', 'schedulingAgentRuntime.commandMatrix.test.ts'],
    rootCauses: ['none'],
    reverseInference: '替换能力已存在，但电视时间格里的缩短/空窗策略还需要更硬的统一处理。',
  },
  {
    id: 'tv-delete-all-same-name',
    category: 'composite_task',
    playlistModel: 'tv',
    userRequest: '把全部看东方节目删除掉',
    expectedDisposition: '生成批量删除任务，分步骤确认后执行并校验。',
    supportLevel: 'supported',
    harness: 'foreground_runtime',
    coveredBy: [
      'demoRuntimeFacade.compositeTask.test.ts',
      'schedulingTaskPlanCompiler.test.ts',
      'Goal 38 browser scenario batch-delete-same-name-pending',
      'Goal 38 browser scenario batch-delete-failure-can-retry',
    ],
    rootCauses: ['none'],
    reverseInference: 'LLM 生成复合任务计划，本地编译为批量原子命令，属于通用路径。',
  },
  {
    id: 'tv-delete-time-range-large',
    category: 'composite_task',
    playlistModel: 'tv',
    userRequest: '把4点到10点全部节目删掉',
    expectedDisposition: '应批量定位时段内节目，分批确认或要求继续。',
    supportLevel: 'supported',
    harness: 'foreground_browser',
    coveredBy: [
      'schedulingTaskPlanCompiler.test.ts',
      'demoRuntimeFacade.compositeTask.test.ts',
      'Goal 37 browser scenario tv-delete-time-range-large',
      'Goal 37 browser scenario batch-delete-failure-can-retry',
    ],
    rootCauses: ['none'],
    reverseInference: '时间范围由 LLM 结构化为 batch_delete；本地按10条分批、确认后写入，并沿 pending 保留剩余数量和失败恢复现场。',
  },
  {
    id: 'tv-batch-replace-column',
    category: 'composite_task',
    playlistModel: 'tv',
    userRequest: '把今天所有东方剧场都换成品质剧场',
    expectedDisposition: '先定位目标，再候选选择，最后批量替换并校验。',
    supportLevel: 'guarded_supported',
    harness: 'foreground_runtime',
    coveredBy: ['demoRuntimeFacade.taskPlanDraft.test.ts', 'demoRuntimeFacade.readOnlyAnalysis.test.ts'],
    rootCauses: ['candidate_ambiguity'],
    reverseInference: '批量替换比批量删除多候选选择，必须走同一确认链路。',
  },
  {
    id: 'tv-query-current-content',
    category: 'read_only_analysis',
    playlistModel: 'tv',
    userRequest: '查一下当前播单有什么节目',
    expectedDisposition: '只读回答，不写回播单。',
    supportLevel: 'supported',
    harness: 'foreground_runtime',
    coveredBy: ['foregroundAgentFlow.test.ts', 'demoRuntimeFacade.readOnlyAnalysis.test.ts'],
    rootCauses: ['none'],
    reverseInference: '查询属于原子只读能力，LLM 负责组织回答，本地禁止写入。',
  },
  {
    id: 'tv-ask-style-analysis',
    category: 'read_only_analysis',
    playlistModel: 'tv',
    userRequest: '这张编单整体风格怎么样',
    expectedDisposition: '基于当前编单上下文进行分析，不触发操作。',
    supportLevel: 'supported',
    harness: 'foreground_runtime',
    coveredBy: ['demoRuntimeFacade.readOnlyAnalysis.test.ts'],
    rootCauses: ['none'],
    reverseInference: '这类问题需要给 LLM 较完整的编单概况，而不是死板摘要。',
  },
  {
    id: 'tv-ask-optimization-after-analysis',
    category: 'read_only_analysis',
    playlistModel: 'tv',
    userRequest: '那怎么优化',
    expectedDisposition: '给可执行建议或任务草稿，若要更新草案或正式播单需再确认。',
    supportLevel: 'guarded_supported',
    harness: 'foreground_browser',
    coveredBy: ['demoRuntimeFacade.readOnlyAnalysis.test.ts', 'Goal 38 browser scenario tv-readonly-analysis-and-optimization'],
    rootCauses: ['business_guardrail'],
    reverseInference: '连续追问已经能在前台给优化建议；涉及草案或正式播单写入时仍需用户明确确认。',
  },
  {
    id: 'pending-candidate-select-first',
    category: 'confirmation',
    playlistModel: 'tv',
    userRequest: '第一个',
    expectedDisposition: '如果上一轮是候选选择，按候选卡继续；否则不能乱执行。',
    supportLevel: 'supported',
    harness: 'foreground_runtime',
    coveredBy: ['foregroundAgentFlow.test.ts', 'atomicCommandCapability.ts'],
    rootCauses: ['none'],
    reverseInference: '短回复必须绑定 pending 上下文，不能重新把“第一个”当节目名检索。',
  },
  {
    id: 'confirmation-approve-composite-task',
    category: 'confirmation',
    playlistModel: 'mixed',
    userRequest: '确认执行',
    expectedDisposition: '只有存在待确认的原子或复合任务时才写入；否则要求用户重新说明要执行什么。',
    supportLevel: 'guarded_supported',
    harness: 'foreground_runtime',
    coveredBy: ['foregroundAgentFlow.test.ts', 'demoRuntimeFacade.taskPlanDraft.test.ts'],
    rootCauses: ['business_guardrail'],
    reverseInference: '确认不是独立意图，必须绑定当前工作区的 pending 任务，防止用户换话题后误执行。',
  },
  {
    id: 'pending-new-topic-expires',
    category: 'pending_context',
    playlistModel: 'mixed',
    userRequest: '查询当前播单',
    expectedDisposition: '新话题打断上一轮待确认，旧 pending 失效。',
    supportLevel: 'supported',
    harness: 'foreground_browser',
    coveredBy: ['foregroundAgentFlow.test.ts', 'Goal 23 browser scenario 04', 'Goal 38 browser scenario pending-new-topic-expires'],
    rootCauses: ['none'],
    reverseInference: 'pending 是 Codex 式一轮审查门，不是永久悬挂任务。',
  },
  {
    id: 'rotation-create-theme-duration-draft',
    category: 'rotation_draft',
    playlistModel: 'rotation',
    userRequest: '新建一个3小时的轮播单，主要用于世界杯精彩画面回顾',
    expectedDisposition: '新建轮播单并生成轮播草案，不直接写正式节目。',
    supportLevel: 'supported',
    harness: 'foreground_browser',
    coveredBy: ['demoRuntimeFacade.playlistState.test.ts', 'Goal 23 browser scenario 08'],
    rootCauses: ['none'],
    reverseInference: '用户给了主题和总时长，足以先形成草案；正式编排仍需确认。',
  },
  {
    id: 'rotation-full-without-draft-block',
    category: 'guardrail',
    playlistModel: 'rotation',
    userRequest: '帮我把全天轮播单编排完整',
    expectedDisposition: '无草案时温和阻拦，引导给主题和总时长。',
    supportLevel: 'guarded_supported',
    harness: 'foreground_browser',
    coveredBy: ['runtimePlaylistPolicy.test.ts', 'Goal 23 browser scenario 07', 'Goal 38 browser scenario rotation-gate-draft-refine'],
    rootCauses: ['business_guardrail', 'missing_user_input'],
    reverseInference: '轮播整体编排没有时间格依据，草案是控制模型自由度的结构化目标。',
  },
  {
    id: 'rotation-atomic-insert-without-draft',
    category: 'atomic_command',
    playlistModel: 'rotation',
    userRequest: '插入一个30分钟宣传片',
    expectedDisposition: '不因没有草案阻拦，进入补参、候选或确认流程。',
    supportLevel: 'supported',
    harness: 'foreground_browser',
    coveredBy: ['foregroundAgentFlow.test.ts', 'Goal 23 browser scenario 10', 'Goal 38 browser scenario rotation-atomic-insert-without-draft'],
    rootCauses: ['none'],
    reverseInference: '原子操作和整体编排边界不同，本地策略不能一刀切阻拦。',
  },
  {
    id: 'rotation-insert-after-program',
    category: 'atomic_command',
    playlistModel: 'rotation',
    userRequest: '在城市宣传片后面插入一条静安区景点介绍',
    expectedDisposition: '按内容队列锚点插入，队列自然串联。',
    supportLevel: 'supported',
    harness: 'foreground_browser',
    coveredBy: [
      'schedulingAgentRuntime.nlMatrix.test.ts',
      'demoRuntimeFacade.playlistState.test.ts',
      'Goal 37 browser scenario rotation-queue-anchor-followup-and-relative-move',
      'canonicalSchedulingData.test.ts',
    ],
    rootCauses: ['none'],
    reverseInference: 'LLM 返回队列锚点和插入语义，运行时按当前轮播项解析相对位置；景点候选来自 canonical 节目库，前台已验证直接后置插入与位置补充续接。',
  },
  {
    id: 'rotation-delete-item-queue',
    category: 'atomic_command',
    playlistModel: 'rotation',
    userRequest: '把这条宣传片删掉',
    expectedDisposition: '删除后队列继续串联，不生成电视式空窗。',
    supportLevel: 'supported',
    harness: 'foreground_runtime',
    coveredBy: ['demoRuntimeFacade.compositeTask.test.ts', 'runtimePlaylistPolicy.test.ts'],
    rootCauses: ['none'],
    reverseInference: '轮播是内容队列模型，删除后的校验逻辑不同于电视时间格。',
  },
  {
    id: 'rotation-replace-shorter-duration',
    category: 'atomic_command',
    playlistModel: 'rotation',
    userRequest: '把45分钟的宣传片换成30分钟的版本',
    expectedDisposition: '允许替换，提示总时长差额而不是生成空窗。',
    supportLevel: 'supported',
    harness: 'foreground_runtime',
    coveredBy: ['foregroundAgentFlow.test.ts', 'schedulingAgentRuntime.commandMatrix.test.ts'],
    rootCauses: ['none'],
    reverseInference: '轮播替换后的队列差额可算，但前台需要更清楚告诉用户总时长变化。',
  },
  {
    id: 'rotation-compress-duration-ambiguous',
    category: 'guardrail',
    playlistModel: 'rotation',
    userRequest: '把当前3小时轮播单压缩2小时',
    expectedDisposition: '先追问是减少2小时变为1小时，还是压缩到2小时；确认目标与取舍策略前不修改正式播单。',
    supportLevel: 'guarded_supported',
    harness: 'llm_protocol',
    coveredBy: ['agentPlanner.promptVersion.test.ts'],
    rootCauses: ['business_guardrail', 'missing_user_input'],
    reverseInference: '“压缩2小时”存在目标时长歧义，且没有说明删尾部还是按内容取舍；LLM 应先澄清，本地不能猜测。',
    userInput: '把当前3小时轮播单压缩2小时',
    expectedDecision: '返回 clarify，明确追问目标是1小时还是2小时，并询问内容取舍方式。',
    mustNotHappen: '解释成 batch_move；静默选择3→1或3→2；直接删除、裁切节目或启动正式重编。',
    verification: 'planner 协议回归断言歧义澄清规则与 noMutation 结果。',
  },
  {
    id: 'rotation-compress-tail-range-batch-delete',
    category: 'composite_task',
    playlistModel: 'rotation',
    userRequest: '把当前3小时轮播单队尾完整的2小时内容删掉，保留第1小时',
    expectedDisposition: '节目边界完整时按有限范围 batch_delete 生成待确认任务；边界截断节目时继续追问。',
    supportLevel: 'guarded_supported',
    harness: 'llm_protocol',
    coveredBy: ['agentPlanner.promptVersion.test.ts'],
    rootCauses: ['business_guardrail'],
    reverseInference: '用户明确了队尾范围和保留区间，这属于可定位目标集合，不需要整体草案；删除仍需确认且不能裁切节目。',
    userInput: '把当前3小时轮播单队尾完整的2小时内容删掉，保留第1小时',
    expectedDecision: '返回 batch_delete 并保留正式删除确认；只有节目边界完整时才允许执行。',
    mustNotHappen: '升级为 formal_orchestration；修改草案；按 batch_move 平移；截断跨越1小时边界的节目。',
    verification: 'planner 协议回归断言有限范围删除与节目边界保护。',
  },
  {
    id: 'rotation-compress-overall-guides-draft',
    category: 'composite_task',
    playlistModel: 'rotation',
    userRequest: '把当前3小时轮播单压缩到2小时，优先保留热播内容',
    expectedDisposition: '视为覆盖整张轮播单的内容重构，先把轮播草案目标收敛到2小时；草案可执行后再确认启动正式 ReAct 重编。',
    supportLevel: 'guarded_supported',
    harness: 'llm_protocol',
    coveredBy: ['agentPlanner.promptVersion.test.ts', 'demoRuntimeFacade.fullGenerateBootstrap.test.ts'],
    rootCauses: ['business_guardrail', 'context_management_gap'],
    reverseInference: '按热播策略在整表范围取舍不是有限删除；正式长流程依赖目标时长一致的完整轮播草案和整批重编授权。',
    userInput: '把当前3小时轮播单压缩到2小时，优先保留热播内容',
    expectedDecision: '先返回 prepare/refine_layout_draft 将目标时长设为7200秒，或先用 draft_precheck 查证热播依据再更新草案；不在同轮写正式播单，后续明确确认才启动 formal ReAct。',
    mustNotHappen: '直接生成无草案 formal_write；把压缩当 batch_move；任意删除节目凑时长；绕过已有正式内容重编确认。',
    verification: 'planner 协议回归断言整表压缩先更新草案目标，正式播单 noMutation。',
  },
  {
    id: 'rotation-jingan-scenic-30h',
    category: 'rotation_draft',
    playlistModel: 'rotation',
    userRequest: '做一个上海市静安区景点30小时轮播编排',
    expectedDisposition: '先生成草案并继续细化关键词、时长块和候选方向，不应马上硬排。',
    supportLevel: 'guarded_supported',
    harness: 'foreground_runtime',
    coveredBy: [
      'demoRuntimeFacade.fullGenerateBootstrap.test.ts',
      'canonicalSchedulingData.test.ts',
      'Goal 37 browser scenario rotation-research-check-pending',
    ],
    rootCauses: ['missing_user_input'],
    reverseInference: '主题和总时长足以生成一个不写正式播单的轮播草案；用户未给出30小时内部结构时保留单块并引导继续细化，不由本地或 mock 擅自拆成节目。',
  },
  {
    id: 'rotation-three-hour-scenic-then-padding',
    category: 'composite_task',
    playlistModel: 'rotation',
    userRequest: '先放3小时景点宣传片，再放3小时垫片',
    expectedDisposition: '形成顺序内容块草案或任务计划，确认前不写正式队列。',
    supportLevel: 'supported',
    harness: 'llm_protocol',
    coveredBy: ['demoRuntimeFacade.layoutDraft.test.ts', 'Goal 37 browser scenario rotation-partial-draft-formal-block'],
    rootCauses: ['none'],
    reverseInference: 'LLM 将两个3小时目标返回为有序草案块，草案编译器保留各块时长和选择策略；该需求只形成草案，确认前不启动正式批量填充。',
  },
  {
    id: 'rotation-strategy-rating',
    category: 'rotation_draft',
    playlistModel: 'rotation',
    userRequest: '这张轮播单改成收视率优先',
    expectedDisposition: '切换轮播选择策略，不改正式节目。',
    supportLevel: 'supported',
    harness: 'foreground_runtime',
    coveredBy: ['agentWorkflowBrowserCases.test.ts', 'demoRuntimeFacade.playlistState.test.ts'],
    rootCauses: ['none'],
    reverseInference: '策略是工作区属性，可以直接更新，后续候选排序再使用。',
  },
  {
    id: 'rotation-upload-layout-xls',
    category: 'rotation_draft',
    playlistModel: 'rotation',
    userRequest: '上传这个轮播草案，按它来排',
    expectedDisposition: '上传后作为当前激活草案，确认前不写正式播单。',
    supportLevel: 'supported',
    harness: 'foreground_browser',
    coveredBy: [
      'layoutImportService.test.ts',
      'demoRuntimeFacade.uploadedLayout.test.ts',
      'foregroundLayoutDraft.test.ts',
      'Goal 37 browser scenario rotation-upload-layout-xls',
    ],
    rootCauses: ['none'],
    reverseInference: 'Playwright 真实上传固定 xlsx 后，前台将其激活为 carousel 上传草案；上传只更新 draft owner，不写正式播单。',
  },
  {
    id: 'draft-system-column-kind',
    category: 'tv_layout_draft',
    playlistModel: 'tv',
    userRequest: '草案里写的是栏目：看东方，就按栏目找',
    expectedDisposition: '保留 column 约束，优先按栏目检索。',
    supportLevel: 'supported',
    harness: 'contract_test',
    coveredBy: ['retrievalConstraintCompiler.test.ts', 'layoutDraftSemanticCleaner.test.ts'],
    rootCauses: ['none'],
    reverseInference: '系统生成草案带字段类型，本地不应把它降级成裸名称。',
  },
  {
    id: 'draft-uploaded-naked-name',
    category: 'tv_layout_draft',
    playlistModel: 'tv',
    userRequest: '上传的表里只有看东方三个字',
    expectedDisposition: '按裸名称同时匹配栏目和节目，候选不唯一时让用户选。',
    supportLevel: 'supported',
    harness: 'contract_test',
    coveredBy: ['layoutImportService.test.ts', 'retrievalConstraintCompiler.test.ts'],
    rootCauses: ['none'],
    reverseInference: '上传 xls 可能缺字段类型，本地检索约束要宽，执行不能自动选。',
  },
  {
    id: 'llm-feedback-human-readable',
    category: 'guardrail',
    playlistModel: 'mixed',
    userRequest: '我为什么不能直接排',
    expectedDisposition: '主回复用编排员听得懂的话解释原因和下一步，技术细节进详情。',
    supportLevel: 'supported',
    harness: 'llm_protocol',
    coveredBy: ['schedulingAgentRuntime.intentInterpreter.test.ts', 'chatPanelDetails.test.ts'],
    rootCauses: ['none'],
    reverseInference: 'LLM 负责表达，本地只过滤明显技术词并分层展示系统过程。',
  },
  {
    id: 'local-llm-config-preserved',
    category: 'configuration',
    playlistModel: 'mixed',
    userRequest: '不要把我的 API key 清掉',
    expectedDisposition: '本地配置共享且持久化，不因前台修复被清空。',
    supportLevel: 'supported',
    harness: 'contract_test',
    coveredBy: ['llmConfig.test.ts', 'LLMConfigPanel.test.ts'],
    rootCauses: ['none'],
    reverseInference: '这是前台可用性的基础设施，不应由业务流程重置。',
  },
  {
    id: 'visual-theme-blue',
    category: 'configuration',
    playlistModel: 'mixed',
    userRequest: '界面颜色回到 Vite 蓝色体系',
    expectedDisposition: '前台主路径使用蓝色主题，不残留绿色、橙色、紫色警示主色。',
    supportLevel: 'supported',
    harness: 'contract_test',
    coveredBy: ['foregroundVisualTheme.test.ts'],
    rootCauses: ['none'],
    reverseInference: '视觉一致性也需要测试，否则小改动容易回归。',
  },
  {
    id: 'workspace-switch-playlist',
    category: 'workspace',
    playlistModel: 'mixed',
    userRequest: '打开另一张播单继续改',
    expectedDisposition: '切换当前工作区，旧播单上下文不混入新播单。',
    supportLevel: 'supported',
    harness: 'foreground_runtime',
    coveredBy: ['foregroundWorkspaceState.test.ts', 'foregroundAgentFlow.test.ts'],
    rootCauses: ['none'],
    reverseInference: '播单工作区是上下文隔离核心，不靠用户每句话都说明对象。',
  },
  {
    id: 'one-active-layout-draft',
    category: 'tv_layout_draft',
    playlistModel: 'mixed',
    userRequest: '当前只使用这份草案',
    expectedDisposition: '保持一个激活草案，切换时替换当前草案引用。',
    supportLevel: 'supported',
    harness: 'contract_test',
    coveredBy: ['foregroundLayoutDraft.test.ts', 'runtimeLayoutRegistry.test.ts'],
    rootCauses: ['none'],
    reverseInference: '先不做多草案并行，降低模型和前台状态压力。',
  },
  {
    id: 'formal-draft-independent',
    category: 'guardrail',
    playlistModel: 'mixed',
    userRequest: '改一下草案，但别动正式播单',
    expectedDisposition: '只更新草案上下文，不写正式节目单。',
    supportLevel: 'guarded_supported',
    harness: 'contract_test',
    coveredBy: ['foregroundAgentGoalContracts.test.ts', 'chatPanelQuickActions.test.ts', 'Goal 38 browser scenario rotation-draft-rewrite-no-formal-write'],
    rootCauses: ['business_guardrail'],
    reverseInference: '草案和正式单是两套对象，必须由本地裁决守住边界。',
  },
  {
    id: 'formal-pending-switches-to-draft-owner',
    category: 'pending_context',
    playlistModel: 'mixed',
    userRequest: '先不确认刚才的正式删除，把草案第二段改成城市文旅',
    expectedDisposition: '结束正式播单 pending，只更新当前草案，不执行或确认上一轮正式删除。',
    supportLevel: 'guarded_supported',
    harness: 'llm_protocol',
    coveredBy: ['agentPlanner.promptVersion.test.ts', 'demoRuntimeFacade.agentPlanner.test.ts'],
    rootCauses: ['business_guardrail'],
    reverseInference: '跨轮目标从正式播单切到草案时，模型必须看到 pending owner 并显式开始新任务。',
    userInput: '先不确认刚才的正式删除，把草案第二段改成城市文旅',
    expectedDecision: 'pendingAction=start_new_task + refine_layout_draft，只更新草案',
    mustNotHappen: '续接上一轮正式删除、写入正式播单或把草案修改解释成 atomic_command',
    verification: 'planner prompt 包含跨 owner 规则，facade 返回 layout_draft 且旧 pending 不执行',
  },
  {
    id: 'draft-pending-switches-to-formal-owner',
    category: 'pending_context',
    playlistModel: 'mixed',
    userRequest: '先不更新草案，删除正式播单里9点的看东方',
    expectedDisposition: '结束草案 pending，进入正式播单删除确认，不修改草案。',
    supportLevel: 'guarded_supported',
    harness: 'llm_protocol',
    coveredBy: ['agentPlanner.promptVersion.test.ts', 'demoRuntimeFacade.agentPlanner.test.ts'],
    rootCauses: ['business_guardrail'],
    reverseInference: '草案待确认不能吞掉下一轮明确指向正式播单的原子命令。',
    userInput: '先不更新草案，删除正式播单里9点的看东方',
    expectedDecision: 'atomic_command(delete) 绑定 formal_playlist，并保持删除确认门禁',
    mustNotHappen: '更新草案、直接删除正式节目或继续草案确认',
    verification: 'facade 返回正式删除 needs_confirmation，currentLayoutDraft 不参与 mutation',
  },
  {
    id: 'ambiguous-draft-formal-owner-clarifies',
    category: 'guardrail',
    playlistModel: 'mixed',
    userRequest: '把第二段删掉',
    expectedDisposition: '当草案段和正式节目都可能被指代时，追问目标对象。',
    supportLevel: 'guarded_supported',
    harness: 'llm_protocol',
    coveredBy: ['agentPlanner.promptVersion.test.ts'],
    rootCauses: ['business_guardrail'],
    reverseInference: '目标 owner 不明确属于语义缺口，应让 LLM 追问，不能由本地默认选择草案或正式播单。',
    userInput: '把第二段删掉',
    expectedDecision: 'clarify：确认删除草案第二段还是正式播单第二条节目',
    mustNotHappen: '默认删除草案段、默认删除正式节目或同时修改两个对象',
    verification: 'planner v1.7 明确要求 owner 歧义时返回 clarify',
  },
  {
    id: 'tv-atomic-insert-with-incomplete-draft',
    category: 'atomic_command',
    playlistModel: 'tv',
    userRequest: '草案还没做完，9点插入看东方',
    expectedDisposition: '忽略草案完整度，按正式播单原子插入处理；信息不足时只追问原子槽位。',
    supportLevel: 'guarded_supported',
    harness: 'llm_protocol',
    coveredBy: ['agentPlanner.promptVersion.test.ts', 'demoRuntimeFacade.agentPlanner.test.ts'],
    rootCauses: ['business_guardrail'],
    reverseInference: '草案是整体编排依据，不是正式播单原子命令的前置门禁。',
    userInput: '草案还没做完，9点插入看东方',
    expectedDecision: 'atomic_command(insert) 绑定 formal_playlist；槽位完整时执行，缺槽位时澄清',
    mustNotHappen: '补草案、提交草案、启动整体编排或因草案不完整拒绝原子插入',
    verification: 'planner v1.8 明确解耦草案完整度，facade 原子 case 不返回 layout_draft/layout_commit/orchestration',
  },
  {
    id: 'live-llm-chain-coverage',
    category: 'configuration',
    playlistModel: 'mixed',
    userRequest: '这些测试是不是都走真实 LLM',
    expectedDisposition: '说明多数回归走确定性 harness，少量链路需要真实 LLM 抽样验证。',
    supportLevel: 'partial',
    harness: 'manual_product_gate',
    coveredBy: ['foregroundAgentFlow.test.ts', 'schedulingAgentRuntime.intentInterpreter.test.ts'],
    rootCauses: ['harness_gap'],
    reverseInference: '工程化回归不能完全依赖真实 LLM；需要确定性测试加真实 LLM 抽样。',
  },
  {
    id: 'public-demo-no-account',
    category: 'public_access',
    playlistModel: 'mixed',
    userRequest: '我想让别人不用账号也能随时访问体验',
    expectedDisposition: '需要部署匿名演示入口、服务端密钥、会话隔离和演示数据。',
    supportLevel: 'not_yet',
    harness: 'manual_product_gate',
    coveredBy: [],
    rootCauses: ['public_access_gap'],
    reverseInference: '当前是本地前台 Agent 原型，还没有产品级公共访问壳。',
  },
  {
    id: 'external-caller-standard-api',
    category: 'public_access',
    playlistModel: 'mixed',
    userRequest: '其他系统也想调用这个编排 Agent',
    expectedDisposition: '应提供标准服务接口，但不让 OpenClaw 反向绑死前台实现。',
    supportLevel: 'not_yet',
    harness: 'manual_product_gate',
    coveredBy: [],
    rootCauses: ['public_access_gap'],
    reverseInference: '外部访问方应是消费者，当前重点仍是前台可用性和稳定服务边界。',
  },
]

/**
 * 编排员矩阵沿用历史字段保存业务语义；导出前统一补齐 Agent Harness 的五个核心字段，
 * 让矩阵 case 与 agent 行为 case 可以使用同一套门禁检查，而不丢失原有 coveredBy 证据。
 */
export type EditorDemandHarnessCase = EditorDemandCoverageCase & {
  userInput: string
  expectedDecision: string
  mustNotHappen: string
  verification: string
}

export const editorDemandCoverageCases: EditorDemandHarnessCase[] = editorDemandCoverageCaseDrafts.map((item) => ({
  ...item,
  userInput: item.userInput ?? item.userRequest,
  expectedDecision: item.expectedDecision ?? item.expectedDisposition,
  mustNotHappen: item.mustNotHappen ?? item.reverseInference,
  verification: item.verification ?? (item.coveredBy.length ? item.coveredBy.join(', ') : '由人工产品门槛验证'),
}))

export const summarizeEditorDemandCoverage = (cases: readonly EditorDemandCoverageCase[]) => {
  const bySupport = cases.reduce<Record<EditorDemandSupportLevel, number>>((summary, item) => {
    summary[item.supportLevel] += 1
    return summary
  }, {
    supported: 0,
    guarded_supported: 0,
    partial: 0,
    not_yet: 0,
  })

  const byRootCause = cases.reduce<Record<EditorDemandRootCause, number>>((summary, item) => {
    item.rootCauses.forEach((cause) => {
      summary[cause] = (summary[cause] ?? 0) + 1
    })
    return summary
  }, {} as Record<EditorDemandRootCause, number>)

  const supportedNow = bySupport.supported + bySupport.guarded_supported

  return {
    total: cases.length,
    bySupport,
    byRootCause,
    supportedNow,
    supportedNowRatio: supportedNow / cases.length,
  }
}
