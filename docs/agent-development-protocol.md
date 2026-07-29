# Agent Development Protocol

## 业务数据单一事实源

节目、栏目、素材、成片、版面与历史排播只能从
`src/services/agent/canonicalSchedulingData.ts` 读取。`InMemorySchedulingDataGateway`
仅用于隔离的协议/状态机测试，不得作为真实节目库或浏览器验收数据源。测试、浏览器
脚本和 LLM mock 可以模拟模型协议与当前播单状态，但不能手写业务实体；实体缺失时
必须返回结构化 `data_fixture_missing` 并停止该 case。

本文档把 Agent Harness 开发规范落成仓库内可执行流程。目标是让每次优化都能从用户意图进入 case、trace、实现和验证，而不是只靠临场判断。

注意：这里的 Agent Harness 是 aibiandan 项目内部工程方法，不是官方外部 skill，也不是已经筛选完成的通用标准。业务规则、工程边界和外部 skill 筛选结果见 `docs/aibiandan-agent-rules.md`。

## 1. Intake

开始前先写执行卡：

- 问题：用户命令、截图或现象中暴露的具体问题。
- 期望：正确结果必须能被页面、测试或导出文件验证。
- 前置数据：节目库、版面、当前编排单、历史编排、频道、日期、上下文状态。
- 风险：分类误判、候选误命中、顺播跳跃、时间冲突、上下文误续、字段缺失。
- 验证：命中的已有 case、新增 case、测试命令、浏览器验证。

禁止跳过执行卡，直接凭规则猜测改代码。

### 长流程异常重试与跨请求恢复

- 网络抖动、429、408、5xx 等 transport 瞬时故障允许在同一个 stage deadline 内有限重试；认证、参数、结构校验和业务拒绝不得自动重试。
- 退避等待必须监听统一 `AbortSignal`，不得因重试越过 stage 或整体 deadline。
- 跨请求恢复必须读取服务端保存的原始 orchestration request、`workspaceKey`、正式播单版本和 checkpoint；先返回继续、重试、缩小范围、取消等显式动作，禁止静默续跑。
- 用户明确继续后，`FormalOrchestrationRuntime` 保持原 `runId` 重建 observation/轮次；半批次中已有 observation 的 action 使用稳定 action key 跳过。
- 恢复只保留现场和继续执行，不回滚已完成写入，不引入 mutation journal、补偿事务或子 agent。

## 2. Case

最小 case 结构：

```json
{
  "id": "atomic-move-forward-hour",
  "category": "atomic_intent",
  "userInput": "把9点的节目向后移动1小时",
  "initialSchedule": [],
  "layoutContext": null,
  "programLibraryExpectation": "not_required",
  "expectedDecision": {},
  "expectedSchedule": [],
  "mustNotHappen": [],
  "verification": []
}
```

字段含义：

- `id`：稳定唯一标识。
- `category`：如 `atomic_intent`、`layout_draft`、`layout_to_schedule`、`context_management`、`special_combo`。
- `userInput`：用户真实或模拟自然语言命令。
- `initialSchedule`：执行前编排单状态。
- `layoutContext`：版面草案、频道策略、时段、栏目、关键词和历史上下文。
- `programLibraryExpectation`：节目库应存在、应不存在、应返回候选或无需检索。
- `expectedDecision`：分类、草案、候选选择、执行或拒绝的预期。
- `expectedSchedule`：最终编排单状态。
- `mustNotHappen`：明确禁止的结果。
- `verification`：自动化测试、浏览器步骤或人工审查点。

## 3. Trace

最小 trace 结构：

```json
{
  "classification": {},
  "draft": {},
  "retrieval": {},
  "candidateSummary": [],
  "selectionReasoning": "",
  "finalSchedule": [],
  "validationReport": {}
}
```

trace 必须能回答：命令被分到哪里、草案如何生成、检索条件是什么、候选为何被选中或拒绝、最终编排是否满足约束。

## 4. Implementation

- 正式 ReAct 的 `atomic_command` 必须复用当前请求的 `CapabilityRegistry` 解析唯一 capability owner；端口不得直接实例化旧 capability。路由冲突必须在任何业务执行或正式写入前停止，并保留 `capability_route_conflict` 结构化失败 envelope。
- 当删除、轮播候选写入等业务门禁返回 `needs_confirmation` 且 action 为 `pending_only` 时，即使 capability 未进入 commit，ReAct observation 也必须保留 `owner/workspaceKey/mutationId/mutationPolicy` 与原始 `pendingTask`；不得因未触发写入捕获器而丢失待确认现场。
- 正式 ReAct 观察到 pending mutation 后必须立即进入 `waiting_user/waiting_confirm`，停止同批后续 action 且不得调用 decider 替用户审批。普通 `continue` 不等于敏感操作确认；只有显式 `confirm_pending` 才能携带原 pendingTask，将该 action 升级为 `formal_write` 后经原子 capability 与写入边界恢复。
- 前台收到 `waiting_user` 后必须保存独立审批状态并展示明确的确认/取消控件；确认直接调用 `confirm_pending`，取消直接调用 `cancel`，禁止把按钮转换成“确认/取消”自然语言重新提交。审批请求必须携带当前 `workspaceKey`、正式播单版本和最新 runtime input，工作区或版本变化时旧控件失效。
- ReAct 在进入审批等待前已经完成的批次属于现场事实。runtime outcome 必须返回最后 checkpoint 的正式播单快照，前台和 Agent Server session 同步应用该快照及版本；恢复后同样返回最终快照，禁止只显示“已完成”而页面播单仍停留在旧状态。
- ReAct 原子输入必须清除控制面 `orchestration` 字段；请求级 registry 必须同时包含正式编排与原子 owner，防止原子 action 再次命中正式编排 capability 并递归启动第二个 run。

实现顺序：

1. 先定位当前链路：分类器、草案、检索、候选选择、runtime 执行、UI 状态。
2. 先补或确认 case。
3. 用最小改动修正链路。
4. 若涉及 LLM，提示词必须明确“经验丰富编排人员”的选择顺序：硬条件（素材/版权）、上下文连续性、内容匹配、收视率/热播策略、拒绝理由。注意：时长适配不在候选决策层评估，由 `FormalPlaylistWriteAdapter` 写入校验最终把关（candidateJudge prompt v1.1 起，v1.2 顺播文案对齐，v1.3 移除候选数量阈值）。无顺播基线时，候选决策必须 auto_select 最早一期（顺播硬约束，优先于任何时长考量）。候选数量和本地编辑评分不得作为覆盖 LLM 决策的固定阈值；本地只阻断字段级明确条件不匹配、素材/版权、顺播和写入冲突等可验证风险。
5. 若涉及规则兜底，只处理确定性强的窄场景，并保留 LLM 或候选选择路径。

## 4.1 Playlist State And Atomic Command Policy

后续“先接住全部原子命令”的计划，必须先引入播单状态机：

- 初始状态：左侧播单区域为空，不进入具体编排交互。
- `新建电视播单`：创建电视播单，只允许电视频道编排策略。
- `新建轮播单`：创建轮播单，默认策略为内容匹配优先。
- 未创建播单前，插入、删除、移动、替换等原子命令，以及补空窗、全天编排等长流程命令，必须拒绝并提示先创建播单。

原子命令执行策略：

- 电视播单下：由于电视频道策略约束强，用户原子命令在目标清楚、候选唯一、规则校验通过时可以直接执行；删除等敏感操作除外。
- 轮播单下：由于节目选择自由度大，插入、替换等会引入节目候选的原子命令，应继续走候选推荐列表，让用户选择后再写入。
- 复合任务或批量替换生成候选后必须保留结构化 `pendingAtomicContext`、候选 ID 与原 `resumeCompositeTask`；下一轮只接受 LLM 返回的 `pendingAction: "select_candidate"` 续接。禁止退化为仅展示散文候选列表而丢失任务现场，也禁止前台根据“第一个”等文本直接选择。
- 移动、前移、后移这类只作用于已有条目的命令，在目标唯一且校验通过时可直接执行；目标不唯一时进入目标选择。
- 节目线索不明确、缺少时间、节目、偏移量、候选不匹配、顺播冲突、时间冲突时，两种播单都不能强行执行。
- 轮播单策略只允许在轮播单内调整；电视播单不能切换为内容匹配、收视率或热播优先。

当前阶段范围（与 `AGENTS.md` 的 Current Phase Scope / Verification Gates 对齐）：

- 强化播单创建、原子命令识别、电视/轮播策略分流、候选推荐确认/取消。
- 长流程 `formal_orchestration` action 已在 `agentPlanner` 接入，bootstrap 门禁（空草案阻拦 / 部分草案引导 / 频道默认草案复用 / 轮播草案缺失阻拦 / 已有节目重编确认）已闭环；补空窗和全天编排作为长流程接入目标，**不再豁免 `agent:check` 门禁**。
- `formal_orchestration` 的 `taskKind` / `targetTimeRange` / `useLayoutDraft` / `searchKeywords` 属于 LLM action 语义，必须由 planner 直接返回并沿主路径透传；本地只做枚举、模式组合、时间和数组结构校验，禁止从用户原话正则识别后回填。action 缺少必需语义或字段冲突时停止执行并暴露可恢复澄清，不得默认成全天编排。
- `foregroundAgentContextPackage` 的 `scenario` 仅表示客观现场状态（review、atomic、layout_reference、general），不是本轮用户意图、taskKind 或 action 分类。不得根据 `latestUserInput` 使用关键词/正则推断场景、草案引用或正式编排；这些语义只能来自 LLM 结构化 action。
- `LayoutDraftService` 返回的 spec 属于不可信模型输出，必须先由 `LayoutDraftValidator` 校验顶层对象、coverage、segments 与段字段类型。响应缺失或结构畸形时返回 `invalid_spec` 并暴露“本轮未生成或修改草案”，禁止空指针、补造时段或静默复用旧草案冒充新结果。
- 部分草案续补由 planner 返回 `refine_layout_draft`；结构化多段默认按时间范围合并到既有草案并扩展 coverage。只有 action 明确携带 `ignoreExistingLayout: true` 时才整份替换，禁止本地从用户原话猜测“续补”或“重写”。Goal 37 的 `tv-partial-layout-suggest-refine` 必须同时验证 planner 收到 `completeness.status=partial`、旧段保留且正式播单未写入。
- 用户输入与 quick action 统一先经过 `AgentPlanner`；模型返回有效 action 后才进入 capability/runtime 执行。`assistantReplyDraft` 只能作为进度或可见文案，不能单独证明播单已创建、草案已更新或正式播单已写入；action 缺失或结构无效但回复声称“已/将创建或执行”时，本地必须阻断该回复、保留现场并暴露可重试结果，禁止补 action 或假装完成。
- `research_check(purpose: "candidate_precheck")` 若携带可定位的 `draftSegment`，结果只更新草案；没有草案段时才可进入正式插入候选预检。复合插入计划在编译前统一经过候选硬条件预检：时长不匹配阻断，单候选可绑定任务，多候选进入结构化选择 pending。
- 整表轮播压缩使用 `research_check(purpose: "draft_precheck")` 且没有单段定位时，observation 必须回到 LLM 生成覆盖完整目标时长的结构化草案 action；`DemoRuntimeFacade` prompt `v1.1` 只接受 `prepare_layout_draft` / `refine_layout_draft`，并校验从 `00:00:00` 连续覆盖到 `rotationDurationSeconds`、`ignoreExistingLayout: true`。合法结果只投影草案并标记 `noFormalPlaylistWrite`；无效或不完整 decide 返回结构化 `llm_decide_unavailable`，不得回退本地候选排序。
- 短链路的意图解析、planner 与候选 LLM 决策必须共享同一个请求级 `AgentDeadline` 和 `AbortSignal`；默认整体预算 180s（可配置），单个 LLM stage 上限 90s，意图阶段为后续阶段保留 60s，候选判断为写入保留 15s。不得给 LLM 阶段另设隐藏的 60s transport 上限，也不得把 30s 当作复杂推理硬截止。0s 应暴露当前阶段，超过 5s 仍在处理时通过 progress/SSE 暴露等待状态并允许停止；停止必须按 `sessionId + workspaceKey` 中断服务端 LLM，预算耗尽或用户停止后不得启动脱离本轮 deadline 的后台请求。`AgentDeadline` 到达整体预算时必须自动触发 `AbortSignal`，非 LLM stage 也必须因此停止或在下一边界暴露取消现场。
- 流式输出必须采用“展示流 / 执行结果”双层边界：`first_token` 与安全增量状态可经 SSE 实时展示，完整 LLM 内容必须聚合并通过结构校验后才形成 intent/candidate decision；半截 JSON 不得执行、补齐或写入。SSE 断流后必须能用 POST envelope 回放，事件按 `streamId + eventId` 去重。
- `structured_complete` 只写入内部 trace 并推进执行状态，不作为用户对话气泡；用户可见流式文案必须描述正在理解需求、查节目库、比较候选或校验写入等业务过程。创建或切换播单不能隐藏同一会话的历史消息，首次建单前的 `none` 会话目标绑定到新工作区，但 pending、快照、素材证据和 mutation 不随已有工作区切换迁移。
- 用户消息与终态消息的可见性只能由结构化标签、payload 和 runtime details 决定，禁止扫描自然语言正文中的“版面草案”“编排”等词来隐藏或重分类消息。无合法 action 的执行承诺必须转为 `noMutation` 可恢复澄清，并保留空工作区或原工作区现场；该校验只检查模型输出是否越过执行事实，不得据此推断用户 intent 或补 action。
- 意图解释器 prompt 当前为 `v2.5`，结构输出预算为 1100 tokens。字段位置兼容只允许归一化模型已明确返回的合法枚举（如误置于 `slots.queryKind` 的 `queryKind`）；不得读取用户文本来补字段、改 intent 或恢复隐藏续接协议。普通 pending 补参继续返回同一 intent 与新增 slots。
- 正式 ReAct HTTP 入口同样执行 SSE path A + POST path B：客户端必须在提交 `/api/agent/orchestration` 前订阅当前 session，服务端将任务规划、查节目库、候选决策、checkpoint 和结构化可恢复失败投影为稳定 id 的 progress 事件；SSE 未连接或中途断流时，只能从同一 POST envelope 补回未送达事件，不得重跑 action 或重复展示。业务可恢复失败应返回 HTTP 200 + `status: failed` outcome，不得抛成 HTTP 500，也不得映射成 `completed`；旧非 ReAct 兼容入口保留原异常语义。
- Planner prompt `v1.14` 要求正式 ReAct 首批 `research_check` 由 LLM 提供 2-6 个保留用户硬条件的受控查询，并要求 `formal_orchestration` / `commit_layout_draft` 正式执行同时携带顶层 `mode="react"` 与 `reactTask`；有限、可定位目标集合的批量操作保持复合原子路径，只有覆盖整表/全部空窗/完整目标时长才进入正式长流程。轮播“压缩 N 小时”存在减少 N 小时/压缩到 N 小时歧义时先追问；明确完整队尾范围必须输出 `batch_delete + rangeStart/rangeEnd + pending_only`，不得降成单条 `delete` 或直接 `formal_write`；整表按策略压缩则先查当前编单和候选依据，再由 observation 后的 LLM decide 生成目标时长一致的草案，确认后才正式 ReAct，禁止 `batch_move`、裁切节目或本地拼方案。“参考已有编单”先确认参考对象与参考维度，缺少结构化参考事实时保持 noMutation；不得假装读取或直接复制历史正式编单。有顺序依赖的多动作必须进入同一 ReAct task，逐轮根据 observation 决策。本地只拒绝空条件或不完整计划并暴露 `react_plan_invalid`，不得替模型补关键词、补第一步、过滤合法 action、并列盲目串行或回退旧编排器。
- 合法 ReAct 计划若按顺序返回 `create_playlist` 与后续正式 action，运行时必须先真实创建工作区并记录 observation，再把后续 action 留给下一轮 decide；不得因为后续包含 `formal_orchestration` / `commit_layout_draft` 而误报 `react_plan_invalid` 或只展示命令序列。
- 前台短请求的 ReAct 恢复必须以最新 LLM decide 为准：旧 task 中尚未执行的 pending step 只能保留为 `blocked/superseded` 审计记录，不得抢在新 action 前执行；正式长流程批次仍由 `formalOrchestrationRuntime` 按 checkpoint 追加。
- 自然语言“确认/取消/选择”不得由 ChatPanel 正则直接调用写入 API；只有显式确认控件可以调用 `confirm_pending` / `cancel`，普通文本必须携带 pending 上下文回到 planner，由 LLM 返回结构化 `pendingAction` 或新的 intent。
- 长流程行为变化必须新增对应 case 并加入 `package.json` 的 `agent:check:tests` 列表；`demoRuntimeFacade.fullGenerateBootstrap.test.ts` 与 `orchestrator.test.ts` 必须纳入门禁。
- 长流程的上下文压缩、真 ReAct 循环、UI 停止按钮、批量 checkpoint、`AgentDeadline` 统一管理等约束见 `AGENTS.md` 的 Design Philosophy / Implementation Rules / Agent Architecture / Verification Gates 章节。
- 正式 ReAct decide 的历史上下文统一由 `formalOrchestrationContextCompactor` 生成：保留最近两轮原始 checkpoint observation、全部已决动作摘要、任务目标与去重失败原因；decider 禁止同时接收未压缩 `priorCheckpoints`。压缩结果不得包含当前时间或随机 ID，相同 checkpoint replay 必须深度一致；每轮 checkpoint 必须记录 `contextCompaction.before/after/dropped` 供 session replay 审计。
- 已有节目整批重编的确认属于任务级授权，不属于每个原子 mutation 的重复审批。`DemoRuntimeFacade` 只可产生与当前确认 pending 对应的授权申请；Local/Agent Server 可信边界核验 `sourcePendingId` 后签发 `FormalOrchestrationGrant`，前台请求只回传 `authorizationGrantId`。Grant 绑定 session/workspace、正式播单当前版本、草案可执行指纹以及 `taskKind + objective + targetTimeRange + searchKeywords` 范围；任一现场事实漂移必须停止并要求重新确认。服务端 session/replay 保存 grantId、来源 pending 与状态，可恢复失败不得消费 Grant，任务完成后标记 consumed。
- 正式播单原子命令与草案完整度解耦：电视/轮播单已打开时，明确的插入、删除、移动、替换继续走 `formal_playlist` 原子链路；即使草案为空或部分完成，也不能自动升级为草案修改或整体编排。信息不足时只在原子 owner 内补参、候选选择或追问。
- pending 状态由服务端统一补齐 `owner`、`workspaceKey`、`mutationId`、`mutationPolicy`；显式跨工作区 pending 直接拒绝，历史 session 缺字段时只允许使用已保存的 session 工作区兼容重放。
- `formalOrchestrationDecider` prompt `v1.6` 只接收已由运行时解析的最小 Grant 摘要；作用域和写入证据完整时可返回 `formal_write`，避免整批任务内逐项重复确认。prompt 明确提供 `atomic_command` 结构，禁止需要 mutation 时只在理由中描述修改却重复 validate。零候选 observation 必须按候选源、已尝试 queries、硬条件和剩余轮次选择新查询或 `unable_to_decide`，穷尽时保留空缺。LLM 不得生成、续期或扩大 Grant；ActionAdapter、AtomicPort 与 `FormalPlaylistWriteAdapter` 继续逐次执行确定性校验。
- `agentPlanner` prompt `v1.14` 对“参考已有编单”先澄清参考对象和参考维度。版面结构、正式节目内容分布与历史顺播进度属于不同证据源；未提供结构化参考事实时只能追问，不能假装读取、直接复制历史正式编单或绕过草案确认。

对应 case 必须覆盖：

- 未创建播单时原子命令被拒绝。
- 新建电视播单后，非敏感且目标清楚、规则校验通过的移动、插入、替换类命令按电视策略直接执行或进入必要的目标选择。
- 电视播单下删除命令保持确认。
- 新建轮播单后默认内容匹配优先。
- 轮播单下插入、替换返回候选推荐，不直接硬排；补空窗和全天编排走长流程链路处理（已接入 `formal_orchestration` action，不再豁免 `agent:check` 门禁）。
- 轮播单可切换收视率优先和热播优先；电视播单切换这些策略必须拒绝。

## 5. Verification

初始门禁为：

- 原子偏移解析：`向后移动1小时` 必须是 `forward + 3600`。
- 参数抽取：`9点的节目向后移动1小时` 必须得到 `09:00 -> forward`。
- runtime 原子移动：实际命令 `newStartTime` 必须为 `10:00`。
- 候选选择上下文：9点已有第1集时，8点不能排第2集。
- 分类器边界：非编排产物不能误入编排流程。
- 构建检查：类型和前端构建必须通过。

统一入口：

```bash
npm run agent:check
```

前台可见 UI 问题还必须刷新 `http://localhost:5173`，在 Codex in-app browser 中完成一次真实冒烟或交互验证，并在汇报中说明页面观察结果。

前台浏览器回归入口：

```bash
npm run agent:browser:goal37
```

Goal 38 覆盖率回归入口：

```bash
npm run agent:browser:goal38
```

这两条命令会启动真实 Vite 页面，并在开发环境里注入可控的 LLM mock，用来稳定复现前台链路，不依赖 OpenClaw、真实 API key 或外部网络。它们不是产品逻辑，也不替代真实 LLM 验证；它们只用于确认 `ChatPanel` / `broadcast-plan` 是否能正确展示和承接：

- 轮播无草案整体编排先温和阻拦。
- 用户继续生成轮播草案并局部微调。
- 轮播工作区可通过真实 file input 上传固定 xlsx；上传结果必须成为 `source=uploaded`、carousel 策略的当前草案，确认前正式播单保持不变。
- 一句话同时新建轮播单和草案。
- LLM 失败时给出可恢复反馈且不改草案或播单。
- 电视播单原子插入进入候选确认，不直接写入。
- 同工作区 pending 不按本地文本规则自然失效；新话题必须由 LLM 显式返回 `pendingAction: "start_new_task"` 后清理。跨 `workspaceKey` 的 pending 由本地隔离校验拒绝复用。
- 大范围时间段删除由 LLM 返回结构化 `batch_delete` 计划，本地按批次上限展示影响范围并等待确认；首批完成后保留剩余数量和 pending，失败时保留本批现场供显式重试，不自动回滚。浏览器 seed 必须从 canonical finished products 读取实体，缺少数据时报 `data_fixture_missing`。
- 已有电视播单要求全天重编时先进入确认。
- 只读分析和连续追问优化只给建议，不写播单。
- 轮播局部草案、草案重写、草案素材核验都停留在草案层，正式编排前继续受门禁保护。
- planner 无有效 action 时不展示虚假创建/执行结果；等待超过 5 秒时显示可停止入口，超时或中止后保留工作区事实并提供可恢复动作。

覆盖矩阵当前门槛：`supported + guarded_supported` 必须达到 80% 以上；无法真实覆盖的公共访问、真实素材库质量、文件上传等场景必须保留 rootCause，不能伪装成已完成。

## Goal 39 服务端迁移边界

Goal 39 是前端内嵌 runtime 的最后一条能力型扩展边界。ReAct 长程任务、素材查证、正式编排批量执行和失败恢复的状态机骨架落地后，新的长程业务能力不得继续堆进 `ChatPanel.vue` 或历史 `DemoRuntimeFacade` 总控文件。

从 Goal 39 起，新增能力必须优先落在正式 agent 组成部分：

- `schedulingAgentRuntimeFacade`：真实前台和未来外部访问方的正式入口。
- `reactTaskTypes` / `reactTaskRuntime`：长程任务状态、轮次、观察、恢复和上限。
- `formalOrchestrationRuntime`：正式编排的批次 ReAct 执行内核；每批 act 后必须记录原始 observation 并调用 decider，`unable_to_decide`、decider 异常或中止必须停止并保留 checkpoint。生产请求只允许通过 runtime client 携带 `reactTask` 进入该内核；逐轮 checkpoint 写入服务端 session，按 workspace 隔离并进入 replay。未携带结构化计划时返回 `react_plan_invalid`，前台、facade 与 capability 均不得静默调用旧 `Orchestrator`。
- `formalOrchestrationDecider`：基于 observation 的唯一 LLM decide 适配器；只返回结构化下一步，不执行 action、不补齐非法 JSON、不在模型失败时本地猜测。
- `formalOrchestrationActionAdapter`：长流程 action 的业务执行边界；只按明确端口分发，校验 workspaceKey 和 mutationPolicy，控制动作不得递归进入 batch actor，只读端口不得报告 mutation。
- `formalOrchestrationReadPorts`：将 ReAct 的 research/validate/read_only_analysis action 接到统一 `SchedulingDataGateway` 与 `AgentConstraintEngine`；数据源缺失和约束问题必须作为 observation 暴露，不得伪装成功或触发写入。候选已有的收视率、播放量、热度分和编辑判断必须原样透传给 LLM，不得在 read port 丢失、重算或排序；只读分析必须返回可定位的当前正式节目明细。
- 同一正式 ReAct 请求发生成功写入后，下一轮 `SchedulingDataGateway.loadContext` 必须读取本请求最近提交的正式现场；不得回到请求开始时的旧前台快照。该连续性只存在于当前请求，新请求仍从新的 session/前台快照建立上下文。
- `formalOrchestrationAtomicPort`：将 query、pending 与 formal write 接到既有原子能力；不得复制业务规则，`formal_write` 必须经 `FormalPlaylistWriteAdapter`，停止后不得自动回滚。
- 后续服务端迁移 adapter：LLM 调用、素材库检索、正式播单写入、会话状态和审计日志必须能从浏览器内实现迁移到服务端实现。

迁移启动线：

- Goal 39 完成 ReAct 基础闭环后，不再新增前端专属的长程编排逻辑。
- Goal 40 应开始拆服务端可访问边界：Agent API、会话状态、服务端 LLM key、素材检索 adapter、正式写入 adapter、匿名演示/权限边界。
- Goal 40 的阶段 2/3 迁移方向已经落在 `AgentServerRuntime` / `AgentServerSessionStore` / `HttpAgentRuntimeClient`：
  - LLM prompt/context 必须优先在服务端重建，前台传入的 context 只能作为过渡材料。
  - ReAct task run 必须进入服务端 session，前台只负责展示和继续/停止事件。
  - 新增服务端能力优先扩展 Agent API 和 session store，不继续扩大 `ChatPanel.vue` 或 `DemoRuntimeFacade` 的总控职责。
- Goal 40 阶段 4 起，正式播单写入必须优先经过 `FormalPlaylistWriteAdapter` 或同等 Agent API 写入边界：
  - 每次正式写入必须显式携带 `mutationContext`；缺失 policy 必须返回 `mutation_policy_required` 并拒绝调用底层执行器。用户确认普通 pending 后由服务端生成 `formal_write` 上下文，ReAct 则沿 action/pending/recovery 全链路传递 policy。
  - 迁移第一步只包裹现有 `executePendingCommand`，不得为了服务端化重写原子命令执行规则。
  - 幂等、版本检查、批量失败恢复和审计元数据属于写入边界；节目选择、顺播、候选确认和原子命令校验仍由既有业务链路负责，直到它们被单独迁移。
  - 正式写入幂等缓存必须按 `sessionId + workspaceKey + idempotencyKey` 隔离，切换播单后禁止复用上一工作区结果；普通待确认操作未显式提供 `idempotencyKey` 时以稳定 `pendingId` 作为默认幂等身份；同一 key 的并发请求必须合并为一次执行；只有已成功应用的结果进入缓存，网络失败、版本冲突和门禁阻断必须保留为可重试失败；审计 metadata 必须记录 `workspaceKey`。
  - 写入 delegate 直接抛出网络或存储异常时，adapter 必须返回 `formal_playlist_write_failed` 结构化结果，保留 server-owned pending、正式快照和版本；该失败不得进入幂等缓存，同一 mutation 重试时必须重新调用 delegate。
  - 如果新增正式写入能力，必须能解释它是否改变了旧行为；迁移任务默认不改变旧行为。
- 前台 `ChatPanel` 只负责展示、输入、确认和工作区状态，不承担新的长程业务判断。
- Codex、OpenClaw 等桌面 Agent 仍只是未来外部访问方，只能通过统一 CLI/API 契约复用编排内核；项目内不保留进程内专用桥。CLI/skill 适配不是当前服务端迁移或修复任务的阻塞条件。

Goal 39 的“差不多完成”判定：

- LLM planner 可以返回顶层 `mode="react"` 和 `reactTask`，而不是把长程目标塞进普通 action 或本地分类器。
- 正式前台入口 `schedulingAgentRuntimeFacade` 可以创建受限 `ReactTaskRun`，执行第一轮可验证动作，记录 observation，并把后续判断交回任务状态。
- 已有草案的素材查证路径能走通：查证前不写正式播单，查证后进入 pending 或给出可恢复反馈。
- 批量/长程任务有轮次和批量上限，失败时有恢复信息，不允许无限重试。
- `agent:check:tests` 和 `build` 通过。

达到以上条件后，Goal 40 必须开始服务端边界迁移；后续新增 ReAct 场景应优先通过 Agent API、session store、LLM/tool adapter 扩展，而不是继续扩大前端总控文件。

长程任务恢复边界：

- 当前阶段不做复杂事务、跨多步补偿或任意历史回滚。
- ReAct 恢复只保留当前任务目标、轮次、最近 observation、可重试状态和下一步建议，让 LLM 能在下一轮继续判断。
- 网络、模型或素材工具失败时，只允许重试上一小步一次；仍失败则停止并要求用户缩小范围、换关键词或重新发起。
- 批量正式写入只按已确认批次推进：每批完成后反馈已处理数量和剩余数量，用户说“继续”才处理下一批。
- 批量写入失败时，必须说明已完成数量、本批是否写入、剩余数量和可恢复动作；不能静默继续。

## 6. Report

最终汇报格式：

- 新增或命中的 case。
- 修复路径。
- 验证命令。
- 浏览器观察结果。
- 残余风险。

## Must Refuse, Leave Blank, Or Ask

以下情况不能强行编排：

- 时间段重叠或节目越出版面边界。
- 连续剧、系列节目出现倒序、跳集、重复或从未来集数回填到更早时段。
- 用户给出明确节目名、栏目或内容关键词，但候选节目库字段级不匹配。
- 候选不足，且没有允许垫播、填充或相似替代。
- 多轮上下文中待处理目标不唯一，继续执行会污染当前编排单。
- 用户命令与电视、广播、新媒体轮播、演播室或节目编排产物无关。

## First Regression Case

第一条强制回归 case：

- 输入：`把9点的节目向后移动1小时`
- 前置：09:00 有节目。
- 期望：新开始时间为 10:00。
- 禁止：移动到 08:00，或进入不必要的追问态。
- 自动化：`src/services/__tests__/atomicOffsetParser.test.ts`、`src/services/__tests__/paramExtractor.test.ts`、`src/services/__tests__/demoRuntimeFacade.atomicFallback.test.ts`。
