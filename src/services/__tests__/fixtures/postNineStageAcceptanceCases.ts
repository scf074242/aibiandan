export type PostNineStageAcceptanceSurface =
  | 'agent_server'
  | 'planner_boundary'
  | 'candidate_search'
  | 'formal_write'
  | 'react_runtime'
  | 'session_recovery'

export type PostNineStageFault =
  | 'none'
  | 'workspace_mismatch'
  | 'playlist_version_drift'
  | 'transient_write_failure'
  | 'write_delegate_exception'
  | 'duplicate_request'
  | 'deadline_abort'
  | 'decider_unavailable'
  | 'half_batch_interruption'
  | 'candidate_exhausted'

export type PostNineStagePlaylistModel = 'tv' | 'rotation'

export interface PostNineStageAcceptanceCase {
  id: string
  userInput: string
  expectedDecision: string
  mustNotHappen: string
  verification: string
  playlistModel: PostNineStagePlaylistModel
  surface: PostNineStageAcceptanceSurface
  fault: PostNineStageFault
  canonicalFixture: string
  initialState: string
  expectedFormalState: string
  evidenceTestFile: string
  additionalEvidenceTestFiles?: string[]
}

export const postNineStageAcceptanceCases: PostNineStageAcceptanceCase[] = [
  {
    id: 'post9-hybrid-finite-batch-remains-composite-atomic',
    userInput: '把今天所有看东方删掉，再把东方剧场整体后移半小时',
    expectedDecision: '有限目标集合拆成有序 batch_delete/batch_move 复数命令，走复合任务确认，不要求完善草案',
    mustNotHappen: '升级成 full_day/overall_refill；修改草案；因草案不完整拒绝批量原子命令',
    verification: 'planner prompt 明确有限目标批量边界；决策保持 atomic/composite owner，正式写入仍逐批确认',
    playlistModel: 'tv', surface: 'planner_boundary', fault: 'none',
    canonicalFixture: 'canonicalSchedulingData 中的看东方与东方剧场节目实体',
    initialState: '正式电视播单已有多个明确可定位目标，草案为空或不完整',
    expectedFormalState: '确认前保持正式播单不变；确认后仅修改目标集合',
    evidenceTestFile: 'src/services/__tests__/agentPlanner.promptVersion.test.ts',
  },
  {
    id: 'post9-hybrid-overall-task-guides-draft-before-formal',
    userInput: '把这张轮播单剩余内容都补齐',
    expectedDecision: '识别为 overall_refill；轮播草案不完整时先说明缺口并引导补草案，草案完整后才启动正式 ReAct',
    mustNotHappen: '降级成若干猜测插入；绕过草案门禁；仅凭主题直接写满正式轮播单',
    verification: 'planner 返回 formal_orchestration/overall_refill；bootstrap 暴露先补草案且 noMutation',
    playlistModel: 'rotation', surface: 'planner_boundary', fault: 'none',
    canonicalFixture: 'canonicalSchedulingData 中的轮播节目候选与版面数据',
    initialState: '轮播单存在部分正式节目，但草案缺失或仅覆盖部分目标时长',
    expectedFormalState: '草案完善前正式播单保持不变',
    evidenceTestFile: 'src/services/__tests__/demoRuntimeFacade.fullGenerateBootstrap.test.ts',
  },
  {
    id: 'post9-reference-existing-playlist-clarifies-evidence-scope',
    userInput: '参考东方卫视之前那张已有编单，重新规划今天整张播单',
    expectedDecision: '先追问参考编单的可定位日期/工作区，以及参考版面结构、节目内容分布还是连续节目进度；明确事实后先形成可审看的草案，用户确认后才启动正式 ReAct',
    mustNotHappen: '猜测“之前那张”的身份；把历史正式编单直接复制覆盖当前现场；跨 workspace 读取；未形成草案或未确认就正式写入',
    verification: 'planner prompt 明确参考对象与参考维度缺一不可；歧义轮返回 clarify/noMutation，且区分既有版面草案引用、历史顺播证据和尚未定位的正式编单参考',
    playlistModel: 'tv', surface: 'planner_boundary', fault: 'none',
    canonicalFixture: 'canonicalSchedulingData 与 canonical historySchedules 中可追溯到真实节目实体的历史编单',
    initialState: '当前电视工作区已有正式现场；用户只说“之前那张已有编单”，没有给日期、工作区或参考维度',
    expectedFormalState: '参考对象和参考维度澄清前当前草案与正式播单均保持不变',
    evidenceTestFile: 'src/services/__tests__/agentPlanner.promptVersion.test.ts',
    additionalEvidenceTestFiles: ['src/services/__tests__/schedulingAgentRuntime.realLlmEvaluation.test.ts'],
  },
  {
    id: 'post9-rotation-compression-routes-by-scope',
    userInput: '把当前3小时轮播单压缩2小时',
    expectedDecision: '歧义表达先澄清目标时长与内容取舍；明确队尾完整范围时走 batch_delete；按热播整表压缩到2小时则先完善2小时草案再进入正式 ReAct',
    mustNotHappen: '把压缩解释为 batch_move；静默猜测3→1或3→2；裁切节目；绕过草案、删除确认或整批重编授权',
    verification: 'planner 协议覆盖歧义、有限范围与整表重构三条路径，所有正式写入前核验 noMutation/confirmation/grant',
    playlistModel: 'rotation', surface: 'planner_boundary', fault: 'none',
    canonicalFixture: 'canonicalSchedulingData 中可组成3小时轮播现场的节目实体',
    initialState: '当前轮播单目标时长3小时且已有正式节目；草案目标仍为3小时或不完整',
    expectedFormalState: '澄清与草案调整阶段正式播单不变；有限删除确认后仅删除完整边界目标；整表重构授权后才写入',
    evidenceTestFile: 'src/services/__tests__/agentPlanner.promptVersion.test.ts',
  },
  {
    id: 'post9-rotation-compression-staged-react',
    userInput: '分析当前3小时轮播单，按热播优先形成压缩到2小时的方案；我确认草案后再正式编排',
    expectedDecision: '方案阶段 research observation 回到 LLM 生成完整2小时草案；用户确认后正式 ReAct 才依次候选裁决、授权写入和总时长校验',
    mustNotHappen: '本地评分替 LLM 决定整表取舍；未审看草案先写正式播单；无 grant 或跳过 decide/validate',
    verification: '前台黑盒断言方案阶段 noFormalPlaylistWrite；同一 Agent Server 会话断言3小时现场经服务端 grant、checkpoint 与正式结果融合后收敛为7200秒快照；正式 ReAct/capability/write adapter/validate 由对应执行门禁提供证据',
    playlistModel: 'rotation', surface: 'react_runtime', fault: 'none',
    canonicalFixture: 'canonicalSchedulingData 中可组成3小时轮播现场及带热度证据的节目实体',
    initialState: '3小时正式轮播单已有节目，草案目标仍为3小时，轮播策略为热播优先',
    expectedFormalState: '2小时草案审看前正式现场不变；确认并完成正式链路后同一 workspace 的 session 正式快照总时长为7200秒、节目边界完整、版本更新且 grant 已消费',
    evidenceTestFile: 'src/services/__tests__/schedulingAgentReactTaskRuntime.test.ts',
    additionalEvidenceTestFiles: [
      'src/services/__tests__/agentServerRuntime.test.ts',
      'src/services/runtime/__tests__/formalOrchestrationReadPorts.test.ts',
      'src/services/runtime/__tests__/formalOrchestrationRuntime.test.ts',
      'src/services/__tests__/formalPlaylistWriteAdapter.test.ts',
    ],
  },
  {
    id: 'post9-search-broadened-query-finds-existing-canonical-program',
    userInput: '插入与申城出行服务相关的短内容',
    expectedDecision: 'LLM 先给原词与多组受控改写，运行时在预算内查询所有未尝试策略，命中 canonical 已存在节目后进入候选裁决',
    mustNotHappen: '只查原句一次；本地编造关键词；命中一个弱候选后跳过硬条件与顺播校验',
    verification: '使用 canonical 候选验证原词零命中、后续 paraphrase/broaden 命中，trace 保存每次 query 与终止原因',
    playlistModel: 'rotation', surface: 'candidate_search', fault: 'none',
    canonicalFixture: 'canonicalSchedulingData.candidates 中带出行/便民/城市服务标签的实体',
    initialState: '候选库存在语义匹配节目，但用户原句不与标题完全相等',
    expectedFormalState: '仅形成候选或 pending，确认前正式播单保持不变',
    evidenceTestFile: 'src/services/__tests__/postNineStageCandidateSearchAcceptance.test.ts',
  },
  {
    id: 'post9-react-zero-candidate-decides-from-observation',
    userInput: '把晚间空窗补成指定主题节目，但节目库暂无合适候选',
    expectedDecision: 'decider 根据已尝试 query、source 可用性、硬条件与剩余预算决定换词继续或 unable_to_decide 保留空缺',
    mustNotHappen: '伪造候选；固定无限重试；把零候选当完成；写入不匹配节目硬排',
    verification: '注入 candidateCount=0 observation；prompt 明确分支裁决，穷尽后返回 unable_to_decide 并保留 checkpoint/空缺',
    playlistModel: 'tv', surface: 'react_runtime', fault: 'candidate_exhausted',
    canonicalFixture: 'canonicalSchedulingData 候选源及其真实零命中查询结果',
    initialState: '正式 ReAct 已完成一轮 research_check，候选源可用但明确查询零命中',
    expectedFormalState: '无法消解时保持正式空缺且未写入不匹配节目',
    evidenceTestFile: 'src/services/agent/__tests__/formalOrchestrationDecider.test.ts',
  },
  {
    id: 'post9-server-pending-delete-commits-once',
    userInput: '删除当前播单里的看东方，确认后执行',
    expectedDecision: '先产生 formal_playlist pending，确认后经 Agent Server 写入边界删除目标并更新正式快照',
    mustNotHappen: '未确认先写；绕过 FormalPlaylistWriteAdapter；重复确认执行两次',
    verification: '从 AgentServerRuntime submit/execute 公共入口执行；正式 itemCount 减一、version 改变、事件含 formalWrite.applied',
    playlistModel: 'tv', surface: 'agent_server', fault: 'none',
    canonicalFixture: 'canonicalSchedulingData.programs 中的看东方实体',
    initialState: '电视播单已有看东方与相邻 canonical 节目，无 pending',
    expectedFormalState: '只删除目标，看东方以外条目保持不变',
    evidenceTestFile: 'src/services/__tests__/postNineStageAgentServerAcceptance.test.ts',
  },
  {
    id: 'post9-server-workspace-mismatch-preserves-formal',
    userInput: '切到另一张播单后继续刚才的确认',
    expectedDecision: '拒绝跨工作区 pending，并保持当前与旧工作区正式快照不变',
    mustNotHappen: '迁移旧 pending；猜测 workspaceKey；写入任一正式播单',
    verification: '向 AgentServerRuntime 提交显式旧 workspace pending；decision 为结构化拒绝且 session 正式 version/itemCount 不变',
    playlistModel: 'rotation', surface: 'agent_server', fault: 'workspace_mismatch',
    canonicalFixture: 'canonicalSchedulingData 中的轮播候选实体',
    initialState: '同一 session 已绑定电视工作区，前台切换到轮播工作区',
    expectedFormalState: '两个工作区的正式状态均保持不变，无 mutation',
    evidenceTestFile: 'src/services/__tests__/postNineStageAgentServerAcceptance.test.ts',
  },
  {
    id: 'post9-formal-version-drift-blocks-stale-confirmation',
    userInput: '确认执行刚才的删除',
    expectedDecision: '检测 expectedPlaylistVersion 与现场版本不一致并返回 formal_playlist_version_conflict',
    mustNotHappen: '用旧确认覆盖新现场；调用底层写入 delegate；改写正式快照',
    verification: '经 server pending execute 公共入口注入版本漂移；delegate 调用为零且正式 version/itemCount 保持现场值',
    playlistModel: 'tv', surface: 'formal_write', fault: 'playlist_version_drift',
    canonicalFixture: 'canonicalSchedulingData 中两个已排节目实体',
    initialState: '用户确认前另一操作已改变正式播单版本',
    expectedFormalState: '保持最新现场快照，不应用过期 mutation',
    evidenceTestFile: 'src/services/__tests__/postNineStageAgentServerAcceptance.test.ts',
  },
  {
    id: 'post9-formal-transient-failure-retries-same-mutation',
    userInput: '刚才写入失败了，重试同一个确认',
    expectedDecision: '第一次失败结构化暴露；同 mutationId/idempotencyKey 第二次重新调用并成功',
    mustNotHappen: '缓存第一次失败；自动回滚已有现场；生成新的业务实体',
    verification: '注入 delegate 首次失败、再次成功；调用两次，只有成功结果进入幂等缓存并更新正式快照',
    playlistModel: 'rotation', surface: 'formal_write', fault: 'transient_write_failure',
    canonicalFixture: 'canonicalSchedulingData 中一个轮播节目实体',
    initialState: '正式播单已有目标，写入 delegate 首次返回临时失败',
    expectedFormalState: '首次失败不变；重试成功后只应用一次',
    evidenceTestFile: 'src/services/__tests__/formalPlaylistWriteAdapter.test.ts',
  },
  {
    id: 'post9-server-write-exception-remains-retryable',
    userInput: '正式写入时网络断开，恢复后重试刚才的确认',
    expectedDecision: 'delegate 异常被 Agent Server 收口为结构化失败，pending 与正式快照保留，同 mutation 可重试',
    mustNotHappen: '异常穿透为未处理请求；清空 pending；缓存失败；自动回滚或自动续跑',
    verification: '从 AgentServerRuntime execute 公共入口注入 delegate throw；首次返回 failed envelope，第二次成功且调用两次',
    playlistModel: 'tv', surface: 'agent_server', fault: 'write_delegate_exception',
    canonicalFixture: 'canonicalSchedulingData 中一个电视节目实体',
    initialState: '正式播单已有目标且存在 server-owned delete pending，delegate 首次抛出网络异常',
    expectedFormalState: '异常后保持原快照；重试成功后只应用一次',
    evidenceTestFile: 'src/services/__tests__/postNineStageAgentServerAcceptance.test.ts',
  },
  {
    id: 'post9-formal-concurrent-duplicate-reuses-result',
    userInput: '网络重试导致相同确认并发到达',
    expectedDecision: '相同 session/workspace/idempotencyKey 共享一次 in-flight 写入并复用结果',
    mustNotHappen: 'delegate 并发执行两次；正式播单出现重复节目；返回不同 writeRunId',
    verification: '并发调用正式写入边界；delegate 仅一次，两响应 success 且其一 formalWrite.reused=true',
    playlistModel: 'rotation', surface: 'formal_write', fault: 'duplicate_request',
    canonicalFixture: 'canonicalSchedulingData 中一个可插入轮播节目实体',
    initialState: '空轮播单收到两个相同 pending execute 请求',
    expectedFormalState: '正式播单仅含一个目标节目且不重复',
    evidenceTestFile: 'src/services/__tests__/formalPlaylistWriteAdapter.test.ts',
  },
  {
    id: 'post9-react-stop-keeps-last-checkpoint',
    userInput: '开始补齐全天空窗，执行首批后停止',
    expectedDecision: '共享 deadline abort 后返回 cancelled，保留首批 observation/checkpoint',
    mustNotHappen: '继续下一 action；调用 decider；回滚已完成首批；自动续跑',
    verification: '从正式 ReAct 公共执行入口注入 abort；actor 只执行首项，checkpoint 记录首项结果',
    playlistModel: 'tv', surface: 'react_runtime', fault: 'deadline_abort',
    canonicalFixture: 'canonicalSchedulingData 中用于首批编排的节目实体',
    initialState: '电视播单存在多个空窗且已具备可执行草案',
    expectedFormalState: '保持最后 checkpoint 对应的已完成状态，不回滚、不执行剩余动作',
    evidenceTestFile: 'src/services/runtime/__tests__/formalOrchestrationRuntime.test.ts',
  },
  {
    id: 'post9-react-decider-failure-exposes-structured-state',
    userInput: '按草案继续补晚间时段',
    expectedDecision: 'act 后 decider 不可用则停止并返回 llm_decide_unavailable envelope',
    mustNotHappen: '复用旧 plan 继续执行；假装完成；吞掉失败原因',
    verification: '注入 decider error；failureReason、completedCount、remainingCount 和 checkpoint 可观察',
    playlistModel: 'tv', surface: 'react_runtime', fault: 'decider_unavailable',
    canonicalFixture: 'canonicalSchedulingData 中晚间候选节目实体',
    initialState: '首批 act 成功，下一轮 decide 调用失败',
    expectedFormalState: '已完成首批保持，后续动作未写入',
    evidenceTestFile: 'src/services/runtime/__tests__/formalOrchestrationRuntime.test.ts',
  },
  {
    id: 'post9-recovery-half-batch-does-not-replay',
    userInput: '网络恢复后继续刚才未完成的补排',
    expectedDecision: '沿用原 runId，从中断批次未完成 action 继续，并保留此前拒绝证据',
    mustNotHappen: '重放已完成 action；丢失 failureReason；跨 workspace 恢复；新建无关 run',
    verification: '经 session recovery 公共入口恢复；actor 仅收到剩余 action，最终 checkpoint 串联旧 observation',
    playlistModel: 'tv', surface: 'session_recovery', fault: 'half_batch_interruption',
    canonicalFixture: 'canonicalSchedulingData 中批次动作引用的节目实体',
    initialState: '同 workspace/version 的 cancelled checkpoint 已完成半批',
    expectedFormalState: '已完成动作不重复，剩余动作成功后正式状态与完整执行等价',
    evidenceTestFile: 'src/services/runtime/__tests__/formalOrchestrationRuntime.test.ts',
  },
]
