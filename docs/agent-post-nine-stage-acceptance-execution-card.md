# 九阶段后真实复杂场景验收执行卡

- 基线提交：`a14383bab7b9b582ed6e86bfdd939acc1269da93`
- 状态：已完成（保留真实模型偶发 90 秒超时的可恢复时延风险）
- 范围：既有 Agent Server、正式播单写入边界、ReAct 长流程与故障恢复
- 边界：不扩展业务功能，不新增子 agent，不引入自动回滚

## 1. 问题

九阶段已经完成运行时架构加固，但现有测试主要按模块证明能力，尚未用统一的编排员真实场景矩阵串联公开运行时入口、服务端 session、ReAct checkpoint、正式播单快照和故障恢复。缺少这层验收时，单模块绿灯仍可能掩盖跨工作区污染、失败结果被幂等缓存、版本漂移后误写、停止后继续执行或部分批次现场丢失。

## 2. 期望

1. 每个复杂场景都具备 `id` / `userInput` / `expectedDecision` / `mustNotHappen` / `verification` 五个核心字段。
2. 黑盒验收从 `AgentServerRuntime` 公共方法或 HTTP client 契约发起，不绕过 server session 与正式写入边界。
3. 写入场景同时核验 decision/result、session 正式播单版本、条目数、workspaceKey、checkpoint 和事件日志。
4. 故障注入覆盖超时/停止、版本漂移、跨工作区、写入失败、幂等重试和半批恢复。
5. 只有黑盒验收稳定复现的缺陷才修改生产实现；失败保留现场并结构化暴露，不自动回滚或假装续跑。

## 3. 前置数据

- 业务实体来自 `src/services/agent/canonicalSchedulingData.ts` 及 `src/mock/data/*.json`。
- 测试仅从 canonical 实体构造现场正式播单，不在 fixture、LLM mock 或协议响应中伪造节目库事实。
- 每个场景显式声明播单类型、workspaceKey、初始正式播单、草案、pending、服务端 session 和注入故障。

## 4. 风险

- **跨工作区污染**：旧 pending、正式快照、checkpoint 或素材证据进入新工作区。
- **错误幂等**：临时失败被缓存，使用同一 mutation 重试时无法重新执行；并发重试发生重复写入。
- **版本漂移误写**：确认后现场播单版本变化，但旧 mutation 仍被应用。
- **中断失效**：停止/超时后仍执行下一 action 或调用 decider。
- **部分批次现场丢失**：已经应用的动作、剩余动作或失败原因没有进入 checkpoint，恢复时重复写入。
- **状态机污染**：草案 mutation 写入正式播单，或正式 mutation 修改草案状态。
- **上下文污染**：压缩后丢失上一轮候选拒绝、冲突或失败原因。

## 5. 验证方式

### 5.1 场景矩阵

唯一可执行矩阵位于 `src/services/__tests__/fixtures/postNineStageAcceptanceCases.ts`。矩阵契约测试负责校验五字段、canonical 数据依赖、故障覆盖、正式状态不变量和黑盒入口覆盖。

### 5.2 黑盒与故障注入

- 正常复杂链路：服务端 pending 确认、正式快照更新、幂等重复请求、ReAct 分批 checkpoint 与完成终态。
- 保护链路：跨 workspace pending、正式播单版本冲突、无授权整批重编、preview/pending mutation 写屏障。
- 故障链路：delegate 临时失败后同 mutation 重试、共享 deadline 中断、半批中断后恢复、decider 无法判断。

### 5.3 门禁

- 相关 Vitest：矩阵契约、Agent Server 黑盒验收、正式写入与 ReAct runtime。
- Agent 全链路：`npm run agent:check`。
- 构建：`npm run build`。
- 密钥扫描：检查本次 diff 中的 `api_key` / `token` / `secret` 等疑似密钥。
- 本轮若不改变前台可见交互，不新增浏览器 case；若实际修复触及 UI，则补跑 Goal 37/38。

## 6. Codex 对齐审查

本轮对齐 Codex 类 agent 的单一任务执行边界、显式中断、checkpoint 恢复、结构化失败与保留现场模式。aibiandan 的额外约束是 workspaceKey、正式播单版本、草案/正式 owner 和 canonical 节目事实。实现继续通过 `CapabilityRegistry`、`AgentServerRuntime`、`FormalPlaylistWriteAdapter` 与 ReAct runtime 协作，不新增 DraftAgent/CandidateAgent 等子 agent，也不建立 mutation journal 或自动回滚链路。

## 7. 验收结论

- 混合场景按目标范围分界：有限且可定位的复数目标进入批量原子命令；覆盖整表、完整空窗或整体目标时长的请求进入 `formal_orchestration`。对应 taskKind 需要草案但草案不完整时引导完善，不降级为猜测插入。
- 节目检索是 canonical 数据上的有限预算、多策略检索，不声称无限穷尽。原子路径按受控关键词轮次检索；长流程由 ReAct 根据 observation 决定继续研究、保留空缺或结构化停止。
- 零候选不是固定本地 fallback：存在未尝试且不破坏硬条件的查询时继续 `research_check`；查询穷尽、数据源不可用或继续放宽会破坏硬条件时返回 `unable_to_decide`，保留空缺与 checkpoint。
- 故障注入实际暴露并修复了正式写入 delegate 异常穿透问题。现在返回 `formal_playlist_write_failed`、`retryable: true`、`noMutation: true`；pending 与正式快照不变，失败不进入幂等缓存，同一 mutation 可重试。

## 8. 实际验证记录

- 相关回归命令覆盖矩阵契约、Agent Server 黑盒、canonical 检索、prompt 版本、ReAct decider、正式写入与长流程 runtime，全部通过。
- `npm run agent:check` 通过；pre-agent、canonical data、type-check 与 Vite build 均通过，构建仅保留既有 chunk size warning。
- `npm run agent:eval:llm:strict` 真实模型评估通过：意图契约 23/23、运行时循环 12/12、多轮 pending 2/2、正式 ReAct 1/1。
- 本轮未改变前台交互，因此未运行 Goal 37/38 浏览器回归。

## 9. 残余风险

- 检索仍是有限预算，不是无限穷尽；`secondary reflection` 尚未接入。
- ReAct 零候选可动态重试或结构化停止，但尚不能在同一次运行中暂停等待用户补参。

## 10. 补充执行卡：轮播总时长压缩

### 10.1 问题

用户要求把当前 3 小时轮播单“压缩 2 小时”时，表达可能指减少 2 小时，也可能指压缩到 2 小时；即使目标时长明确，系统仍需区分有限范围删除与覆盖整张轮播单的内容重构。

### 10.2 期望

1. 目标时长语义不唯一时先追问，正式播单保持不变。
2. 明确删除队尾或明确时间范围且节目边界完整时，按有限范围 `batch_delete` 处理并确认。
3. 删除边界会截断节目时追问如何处理边界节目，不直接修改节目时长。
4. 按内容策略把整张轮播单压缩到目标时长时，先直接调整草案或用草案 ReAct 查证取舍依据；草案完整并经用户确认后才进入正式 ReAct，已有正式节目时走整批重编授权。

### 10.3 前置数据

- 当前工作区是目标总时长 3 小时的轮播单，正式节目均来自 canonical 数据。
- 当前正式队列、草案完整度、目标总时长、节目边界与轮播策略作为现场事实传入 planner/runtime。

### 10.4 风险

- 把“压缩 2 小时”静默解释为 3→1 或 3→2。
- 把压缩误判为 `batch_move`，只平移节目却没有改变总时长。
- 为凑目标时长直接裁切节目、制造重叠，或无确认删除内容。
- 整表内容取舍绕过轮播草案门禁、ReAct 与正式重编授权。

### 10.5 验证方式

- 在编排员需求覆盖矩阵与九阶段后验收矩阵增加五字段完整 case，并纳入 `agent:check:tests` 已覆盖的测试入口。
- 增加 planner prompt/结构回归，验证歧义追问、有限删除和整表重构三条边界。
- 用真实 LLM 严格评估或等价公开 planner 黑盒验证自然语言判断；只修复实际暴露的错误路由。

### 10.6 实际验收结果

- `把当前3小时轮播单压缩2小时`：真实 planner 正确返回 `clarify`，明确追问是 3→1 还是 3→2，并追问内容取舍；无 mutation。
- `把当前3小时轮播单队尾完整的2小时内容删掉，保留第1小时`：v1.12 真实输出曾错误降成单条 `delete + formal_write`。v1.13 增加结构约束和 JSON 示例后，真实输出稳定为 `batch_delete + rangeStart=01:00:00 + rangeEnd=03:00:00 + pending_only`。
- `把当前3小时轮播单压缩到2小时，优先保留热播内容`：v1.12 真实输出正确进入 `draft_precheck` ReAct，先查热播依据再更新草案；v1.13 定向复验连续两次在 90 秒 stage deadline 超时，均返回 `canRetry: true` 且无 action、无正式写入。当前结论为设计可承接但模型时延稳定性仍属残余风险，不放宽统一 deadline。
- 验收同时移除了编排员覆盖矩阵“最多50条”的写死上限，避免新增真实 case 被过时统计门禁阻断。

## 11. 补充执行卡：压缩方案与正式操作分阶段

### 11.1 问题

整表轮播压缩不能在识别目标时长后直接进入删除或重编。模型必须先读取当前编单事实，基于内容结构、节目边界和用户指定策略形成压缩方案，再让用户审看；只有方案确认后才能进入候选选择和正式原子操作。

### 11.2 期望

1. 方案阶段只读取当前编单、检索评价证据并形成结构化 2 小时草案，不写正式播单。
2. `research_check` observation 必须回到 LLM 决定压缩草案，不能由本地候选排序直接替用户决定整表取舍。
3. 用户审看并确认草案后，正式 ReAct 才检索/裁决具体候选，并生成带 mutationPolicy 的批量原子动作。
4. 每批正式动作后回到 LLM 基于 observation 决定继续、停止或保留未决内容，最终校验总时长与节目边界。

### 11.3 前置数据

- 当前 3 小时轮播正式播单、当前草案、轮播策略和节目评价证据均来自 canonical 数据或其现场投影。
- 方案阶段与正式阶段使用同一 workspaceKey，但 draft owner、formal owner、pending 和授权保持隔离。

### 11.4 风险

- research 后由本地评分直接替用户选择整表保留内容。
- 未展示压缩方案便进入正式删除或重编。
- 草案确认后跳过候选裁决，或候选选择后绕过正式写入边界。
- 把方案阶段的 observation 当成正式完成，或没有最终时长校验。

### 11.5 验证方式

- 增加五字段完整 case，明确 `analyze → research → draft → confirm → select → mutate → validate` 顺序。
- 黑盒验证方案阶段 `noFormalPlaylistWrite=true`，正式阶段 mutation 经 grant、capability 与 `FormalPlaylistWriteAdapter`。
- 注入候选不足和边界截断，验证返回结构化停止而不是本地硬凑 2 小时。

### 11.6 实际验收结果

- 黑盒复现确认原实现只支持单段 research 更新：整表 `draft_precheck` 没有段定位时，结构化 LLM 输出会被当成展示文本过滤，随后提示用户指定草案段，无法形成完整压缩方案。
- 修复后，整表 observation 会连同当前 3 小时正式编单和当前草案回到 LLM；只有覆盖 `00:00:00-02:00:00`、总时长 7200 秒且声明整份替换的结构化草案 action 才能进入既有草案编译与校验链路。
- 同步修复轮播 `replaceAll` 仍保留旧 3 小时 coverage 的问题；该收缩规则仅用于轮播草案，电视版面行为不变。
- 故障注入“不完整一小时方案”后，运行时返回 `research_decide_invalid`、`llm_decide_unavailable`、`noMutation: true` 和 `canRetry: true`，正式 3 小时现场保持不变；没有自动回滚或本地补齐。
- 正式阶段继续复用既有整批重编确认、`FormalOrchestrationGrant`、正式 ReAct、capability、`FormalPlaylistWriteAdapter` 与最终 validate，不新增并行执行路径。
- 草案 decide 复用同一请求的 `AgentDeadline` 与 `AbortSignal`；服务端停止或整体 deadline 到期时，第二次模型思考也会被中断，不会脱离当前 ReAct 任务继续运行。
- 15 个九阶段后场景均已绑定 `agent:check` 内的真实执行测试；矩阵门禁会读取证据文件并核对 case ID。整表压缩场景同时绑定方案黑盒、Agent Server grant、正式 ReAct 和正式写入边界四层证据。
- 新增真实 LLM observation→草案 decide 验收：首次请求在 90 秒 stage deadline 超时并正确返回 `research_decide_unavailable`，无草案或正式写入；模拟用户明确重试后约 55 秒成功返回完整 7200 秒草案。结论为流程可承接、失败可恢复，但模型时延仍是残余风险，不通过放宽 deadline 或本地拼草案掩盖。

## 12. 补充执行卡：同会话正式终态核验

### 12.1 问题

整表压缩已有方案黑盒、服务端授权、正式 ReAct 和写入边界的分层证据，但缺少同一 Agent Server 会话内从 3 小时正式现场执行到 2 小时正式快照的终态核验。

### 12.2 期望

- 正式执行前由服务端根据当前确认 pending 签发任务级 `FormalOrchestrationGrant`。
- ReAct checkpoint、查节目库和候选决策进度可在同一 session 回放。
- 完成后正式快照仍绑定原 workspace，总时长严格为 7200 秒，节目边界完整、版本更新且 grant 已消费。

### 12.3 前置数据

- 从 `canonicalSchedulingData` 选择 6 个真实 30 分钟节目构造 3 小时正式轮播现场。
- 使用已确认的完整 2 小时轮播草案；现场节目、最终节目均不得由测试发明。

### 12.4 风险

- 测试绕过服务端授权或只核验返回值，不核验 session 正式快照。
- 将 Agent Server 状态融合 mock 误称为真实 LLM、capability 或 write adapter 全链执行。
- 终态通过裁切节目凑时长、跨 workspace 写入，或完成后 grant 仍可复用。

### 12.5 验证方式

- 扩充 `post9-rotation-compression-staged-react` 场景标准。
- 在 Agent Server 黑盒测试中从公共 submit/execute 入口执行，核验 canonical 身份、7200 秒总时长、正式版本、workspace、checkpoint、进度事件与 consumed grant。
- 该黑盒只证明服务端授权和状态融合；真实 ReAct、capability、`FormalPlaylistWriteAdapter` 与 validate 继续由各自已纳入 `agent:check` 的执行测试提供证据。

### 12.6 实际验收结果

- 新增同会话黑盒后，服务端从 6 个 canonical 半小时节目构成的 10800 秒正式现场出发，只接受当前确认 pending 签发的 grant。
- 两轮 checkpoint、`查节目库` 和 `候选决策` 进度均进入 session 事件；完成后正式快照包含 4 个 canonical 完整节目，总时长严格为 7200 秒，workspace 保持不变、版本更新且 grant 状态为 `consumed`。
- 首次定向执行发现公开 replay 包只提供正式播单摘要，不能从中计算总时长；验收改为从服务端 session store 的正式快照核验明细，没有为测试扩展对外 API 或生产行为。
- `npm run agent:check` 全部门禁通过。本轮没有暴露生产实现缺陷，因此未修改 Agent 业务代码。
