export type ForegroundScenarioCategory =
  | 'workspace'
  | 'layout_draft_gate'
  | 'atomic_command'
  | 'pending_review'
  | 'read_only_discussion'
  | 'composite_task'
  | 'recoverable_failure'
  | 'ui_language'

export type ForegroundScenarioPlaylist = 'tv' | 'rotation' | 'mixed'

export type ForegroundScenarioEvidenceLayer =
  | 'browser_observation'
  | 'foreground_runtime'
  | 'llm_context'
  | 'source_contract'

export type ForegroundScenarioStatus =
  | 'covered'
  | 'covered_after_goal26'
  | 'covered_after_goal29'
  | 'needs_followup'

export interface ForegroundAgentScenarioRegressionCase {
  id: string
  category: ForegroundScenarioCategory
  playlist: ForegroundScenarioPlaylist
  userRequest: string
  preconditions: string[]
  expectedEditorExperience: string[]
  expectedRuntimeBoundary: string[]
  evidenceLayers: ForegroundScenarioEvidenceLayer[]
  status: ForegroundScenarioStatus
  goal26Action?: string
  goal29Action?: string
}

export const foregroundAgentScenarioRegressionCases: ForegroundAgentScenarioRegressionCase[] = [
  {
    id: 'workspace-tv-create-autoloads-draft',
    category: 'workspace',
    playlist: 'tv',
    userRequest: '新建电视播单',
    preconditions: ['当前没有打开播单', '频道为东方卫视', '日期为 2026-03-25'],
    expectedEditorExperience: ['进入电视播单工作区', '对话里说明已加载当前频道日期的版面草案'],
    expectedRuntimeBoundary: ['playlistType=tv', 'layoutDraft.source=channel_default', '不进入 OpenClaw'],
    evidenceLayers: ['foreground_runtime', 'source_contract'],
    status: 'covered',
  },
  {
    id: 'workspace-rotation-create-does-not-invent-draft',
    category: 'workspace',
    playlist: 'rotation',
    userRequest: '新建轮播单',
    preconditions: ['当前没有打开播单'],
    expectedEditorExperience: ['进入轮播单工作区', '提示轮播单还需要主题、总时长或草案'],
    expectedRuntimeBoundary: ['playlistType=rotation', '不凭空生成 layoutDraft', '默认内容匹配优先'],
    evidenceLayers: ['browser_observation', 'foreground_runtime'],
    status: 'covered',
  },
  {
    id: 'rotation-full-without-draft-blocks-gently',
    category: 'layout_draft_gate',
    playlist: 'rotation',
    userRequest: '帮我把全天轮播单编排完整',
    preconditions: ['当前工作区为轮播单', '没有激活草案'],
    expectedEditorExperience: ['温和说明还不能直接排完整', '告诉用户可以先给总时长和主要内容'],
    expectedRuntimeBoundary: ['不创建 orchestrationRequest', '原子操作仍允许继续'],
    evidenceLayers: ['foreground_runtime', 'llm_context'],
    status: 'covered',
  },
  {
    id: 'rotation-theme-duration-creates-reviewable-draft',
    category: 'layout_draft_gate',
    playlist: 'rotation',
    userRequest: '新建一个3小时的轮播单，主要用于世界杯精彩画面回顾',
    preconditions: ['当前工作区为轮播单或正在创建轮播单', '用户给出主题和总时长'],
    expectedEditorExperience: ['先生成可审看的轮播草案', '确认前不写正式轮播单'],
    expectedRuntimeBoundary: ['kind=layout_draft', 'playlistModel=content_queue', 'mutatesFormalPlaylist=false'],
    evidenceLayers: ['foreground_runtime', 'source_contract'],
    status: 'covered_after_goal29',
    goal29Action: '新增可执行编排员场景 harness，验证轮播主题和总时长会走草案准备链路，而不是直接正式编排。',
  },
  {
    id: 'rotation-atomic-without-draft-continues',
    category: 'atomic_command',
    playlist: 'rotation',
    userRequest: '插入一个30分钟宣传片',
    preconditions: ['当前工作区为轮播单', '没有激活草案'],
    expectedEditorExperience: ['不被整体草案门禁误拦', '进入补参、候选或确认'],
    expectedRuntimeBoundary: ['intent=insert', '写入前需要候选或确认'],
    evidenceLayers: ['foreground_runtime', 'source_contract'],
    status: 'covered',
  },
  {
    id: 'tv-reference-draft-becomes-formal-basis',
    category: 'layout_draft_gate',
    playlist: 'tv',
    userRequest: '参考草案编排',
    preconditions: ['当前工作区为电视播单', '频道默认草案已加载'],
    expectedEditorExperience: ['说明会按草案进入正式编排依据', '不会只更新草案页面'],
    expectedRuntimeBoundary: ['layoutDraft referencedByCurrentTask=true', 'writesFormalPlaylist=true', 'mutatesLayoutDraft=false'],
    evidenceLayers: ['foreground_runtime', 'llm_context'],
    status: 'covered',
  },
  {
    id: 'formal-gap-fill-does-not-mutate-draft',
    category: 'layout_draft_gate',
    playlist: 'tv',
    userRequest: '补齐当前所有空窗',
    preconditions: ['当前工作区为电视播单', '左侧存在草案'],
    expectedEditorExperience: ['按正式播单补空窗', '不提示草案已更新'],
    expectedRuntimeBoundary: ['usesLayoutDraft=false', 'layoutDraft.segments 不注入'],
    evidenceLayers: ['foreground_runtime', 'llm_context'],
    status: 'covered',
  },
  {
    id: 'candidate-ambiguity-needs-selection',
    category: 'atomic_command',
    playlist: 'mixed',
    userRequest: '9点排看东方',
    preconditions: ['候选库存在多个看东方相关节目', '没有顺播/期数证据把候选收敛成唯一节目'],
    expectedEditorExperience: ['展示候选或要求选择', '不靠标题相似度替用户自动选'],
    expectedRuntimeBoundary: ['phase=needs_selection', '非顺播多候选 confirmation before write'],
    evidenceLayers: ['foreground_runtime', 'source_contract'],
    status: 'covered',
  },
  {
    id: 'pending-new-topic-expires',
    category: 'pending_review',
    playlist: 'mixed',
    userRequest: '查询当前播单',
    preconditions: ['上一轮存在待确认删除或插入'],
    expectedEditorExperience: ['旧确认自然失效', '新问题按只读查询处理'],
    expectedRuntimeBoundary: ['pendingReview.expiresOnNextNonAnswer=true', '旧 pending 不执行'],
    evidenceLayers: ['foreground_runtime', 'llm_context'],
    status: 'covered',
  },
  {
    id: 'read-only-analysis-never-writes',
    category: 'read_only_discussion',
    playlist: 'mixed',
    userRequest: '这张编单整体怎么样',
    preconditions: ['当前工作区已有播单或草案'],
    expectedEditorExperience: ['输出分析或解释', '不出现确认执行面板'],
    expectedRuntimeBoundary: ['readOnly=true', '不调用原子写入能力'],
    evidenceLayers: ['browser_observation', 'foreground_runtime'],
    status: 'covered',
  },
  {
    id: 'rotation-draft-analysis-uses-active-draft',
    category: 'read_only_discussion',
    playlist: 'rotation',
    userRequest: '这张轮播单整体怎么样',
    preconditions: ['正式轮播单为空', '已有一个世界杯主题轮播草案', '草案 warnings 提示关键词未命中节目库'],
    expectedEditorExperience: ['说明正式播单还空但已有草案', '围绕草案主题和不可编排原因分析'],
    expectedRuntimeBoundary: ['factPack.layoutDraftState.exists=true', '不要求用户重新给草案'],
    evidenceLayers: ['browser_observation', 'foreground_runtime'],
    status: 'covered_after_goal26',
    goal26Action: '把 active layout draft 的主题、内容块、目标时长、策略和 warnings 注入只读分析事实包。',
  },
  {
    id: 'optimization-follow-up-is-read-only',
    category: 'read_only_discussion',
    playlist: 'mixed',
    userRequest: '那怎么优化',
    preconditions: ['上一轮是当前播单分析', '当前工作区没有切换'],
    expectedEditorExperience: ['给出可执行建议', '最后追问是否更新到草案或整理待确认计划'],
    expectedRuntimeBoundary: ['analysisContext.kind=optimization_suggestion', '不直接修改草案或正式播单'],
    evidenceLayers: ['browser_observation', 'foreground_runtime'],
    status: 'covered_after_goal26',
    goal26Action: '优化建议复用上一轮分析和当前草案事实，默认只读，用户授权后才转 TaskPlan。',
  },
  {
    id: 'composite-delete-all-same-name',
    category: 'composite_task',
    playlist: 'tv',
    userRequest: '把全部看东方节目删除掉',
    preconditions: ['当前播单存在多条看东方相关节目'],
    expectedEditorExperience: ['先展示批量删除计划', '要求确认后再逐项执行'],
    expectedRuntimeBoundary: ['taskPlanDraft.isComposite=true', 'batch limit enforced', 'confirmation before write'],
    evidenceLayers: ['foreground_runtime', 'source_contract'],
    status: 'covered',
  },
  {
    id: 'conflicting-command-blocks',
    category: 'composite_task',
    playlist: 'tv',
    userRequest: '9点插入看东方和百姓大讲堂',
    preconditions: ['同一时段只能容纳一条节目'],
    expectedEditorExperience: ['解释同一位置有冲突', '让用户选择先排哪一个或换位置'],
    expectedRuntimeBoundary: ['conflict validation blocks execution', 'no silent overwrite'],
    evidenceLayers: ['foreground_runtime'],
    status: 'covered',
  },
  {
    id: 'rotation-ui-hides-tv-only-fields',
    category: 'ui_language',
    playlist: 'rotation',
    userRequest: '打开轮播单',
    preconditions: ['当前工作区为轮播单'],
    expectedEditorExperience: ['页面只显示轮播单有意义字段', '不显示节目编号、频道日期时段等电视专用噪声'],
    expectedRuntimeBoundary: ['playlistSemantics.model=content_queue', 'positionBasis=relative_from_zero'],
    evidenceLayers: ['browser_observation', 'source_contract'],
    status: 'covered',
  },
  {
    id: 'main-reply-human-readable',
    category: 'ui_language',
    playlist: 'mixed',
    userRequest: '我为什么不能直接排',
    preconditions: ['当前命令触发业务阻拦'],
    expectedEditorExperience: ['主回复说人话：原因、缺什么、下一步怎么说', '技术证据只在详情里'],
    expectedRuntimeBoundary: ['assistantFeedback 不出现 taskPlan/runtime/confidence/policy 等技术词'],
    evidenceLayers: ['llm_context', 'source_contract'],
    status: 'covered',
  },
  {
    id: 'recoverable-llm-timeout-retry',
    category: 'recoverable_failure',
    playlist: 'mixed',
    userRequest: '继续按刚才的要求处理',
    preconditions: ['模型请求超时或失败', '本轮还没有写草案或正式播单'],
    expectedEditorExperience: ['说明没有修改草案或播单', '用户可以说重试；如果要处理长程任务，需要重新说清楚目标'],
    expectedRuntimeBoundary: ['statusHint=failed', 'details.noMutation=true', 'details.canRetry=true'],
    evidenceLayers: ['foreground_runtime', 'source_contract'],
    status: 'covered_after_goal29',
    goal29Action: '把 LLM 失败恢复纳入前台场景 harness，防止后续回归成静默失败或普通澄清。',
  },
]

export const summarizeForegroundScenarioRegression = (
  cases: readonly ForegroundAgentScenarioRegressionCase[],
) => ({
  total: cases.length,
  covered: cases.filter((item) =>
    item.status === 'covered'
    || item.status === 'covered_after_goal26'
    || item.status === 'covered_after_goal29',
  ).length,
  goal26Actions: cases.filter((item) => item.status === 'covered_after_goal26').map((item) => item.id),
  goal29Actions: cases.filter((item) => item.status === 'covered_after_goal29').map((item) => item.id),
})
