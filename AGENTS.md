# Agent Harness Protocol

本仓库的开发必须遵循这里的 Agent Harness 规范。它不是额外的测试工具，而是 Codex 在本项目内处理优化、修复、重构和前台交互问题时的强制工作协议。

## Design Philosophy

### 业务数据单一事实源

节目、栏目、素材、成片、版面和历史排播属于业务实体，只能由
`src/services/agent/canonicalSchedulingData.ts` 及其底层 `src/mock/data/*.json`
提供。测试 seed、浏览器脚本、LLM mock 和 prompt 不得创建、复制或替代业务实体。
测试若需模拟现场，只能基于 canonical 数据构造播单状态；找不到实体时必须暴露
`data_fixture_missing`，不能静默造数或把协议响应伪装成节目库事实。

本项目的 agent 架构与上下文管理参考 Codex 的设计模式，并叠加 aibiandan 业务约束：

- **失败暴露而非回滚**：参考 Codex，失败时保留现场 + 暴露结构化问题 + 让用户重试或补充，不引入自动回滚、不引入 mutation journal 回滚链路、不引入子 agent 补偿事务。本地逻辑只保护结果与暴露失败，不替用户回退已写入的状态。
- **不引入子 agent**：当前项目本身就是典型的子 agent，业务需求专一，不再叠加 DraftAgent / CandidateAgent / SelectionAgent / WriteAgent / ValidationAgent 等子 agent 雏形。复杂能力拆分只通过按 intent 拆分 `AtomicCommandCapability` + 统一 `CapabilityRegistry` 分发实现。
- **LLM-first / LLM-only 主路径**：开放自然语言理解完全交给 LLM；本地只做时间换算、写入校验、草案完整度判断、危险操作保护、模型返回结构校验、执行边界和失败报错。`taskKind` 这类语义判断也必须由 LLM 在 `formal_orchestration` action 中直接返回，不允许本地正则识别后回填。
- **上下文压缩对齐 Codex**：长流程（ReAct / 全天编排 / 整体补排）必须实现真 ReAct 循环（plan → act → observe → decide）+ 批量 checkpoint + 上下文压缩；上下文压缩策略参考 Codex：保留最近 N 轮原 observation + 任务目标 + 已决动作摘要 + 失败原因，丢弃中间冗余 trace；压缩必须幂等可重放，不能因压缩丢失"上一轮为何被拒绝"的关键证据。
- **真 ReAct 循环**：禁止伪 ReAct（一次性产出 plan 后串行执行不回判）。每轮 act 后必须回到 LLM 让其基于 observation 重新 decide；decide 失败、超时或 LLM 返回 `unable_to_decide` 时停止并暴露，不假装继续。
- **可中断**：长流程启动后必须暴露可中断信号（`canInterrupt: true`），UI 必须有停止按钮，5s 后允许用户停止；停止后状态保留在最后 checkpoint，不自动续跑。

## Mandatory Flow

每个优化命令、缺陷修复或行为变化任务，都必须先形成一张执行卡，再进入代码修改：

1. 问题：用户要解决的具体行为或能力缺口。
2. 期望：可观察、可验证的正确结果。
3. 前置数据：依赖的节目库、版面、当前编排单、历史编排记录、上下文状态。
4. 风险：可能误分类、误填充、时间冲突、顺播跳跃、候选不匹配、上下文污染的点。
5. 验证方式：命中的已有 case、新增 case、测试命令、必要的浏览器验证步骤。

若需求涉及行为变化，必须先补充或确认 case，再改实现。若已有 case 不足以描述风险，新增最小回归 case。

## Documentation Discipline

文档治理硬约束，避免文档与代码状态长期失同步导致开发反复犯错：

- **失效路径禁止**：文档内引用代码或文档时必须使用相对路径（如 `[code](file:///./src/...)`）或基于当前仓库根的相对链接，禁止使用 `/C:/Users/...` 这类绝对路径；失效路径一旦发现必须立即修正。
- **文档与代码同步门禁**：代码行为变化时，相关文档（AGENTS.md、`docs/agent-development-protocol.md`、`docs/aibiandan-agent-rules.md`、`docs/code-wiki.md`、`docs/agent-server-migration-plan.md`）必须同步更新；提交前必须自检文档章节是否仍与代码一致。
- **测试统计禁止写死**：文档中禁止写死"测试文件数 N、用例数 M"这类会随提交立刻过时的字段；如需引用规模，使用 `npm run test` 实际输出或写"100+ 测试文件"等模糊下限。
- **过时文件归档**：不再作为开发依据的文档必须移入 `docs/archive/` 并在 `docs/archive/ARCHIVED.md` 登记归档原因；归档文件不再参与活跃开发判断，若与活跃文档冲突一律以活跃文档为准。
- **文档新增门禁**：新增 `docs/` 根目录文件必须能在 `docs/code-wiki.md` 第 12 节"文档索引"或 `README.md` 推荐阅读顺序中登记；未登记的文档视为孤儿文档，不作为约束依据。

## Case First

新增能力或修复缺陷时，优先把用户命令落到可执行 case：

- 原子命令意图识别：删除、移动、插入、替换、后移、前移、范围批量删除、范围批量平移。
- 草案生成：版面策略、时段、栏目、关键词、节目类型、时长、优先级。
- 基于版面计划的正式编排：检索、候选选择、拒绝、留空、填充。
- 特殊组合场景：顺播、历史上下文、当前编排上下文、连续空档、冲突处理。
- 上下文管理：多轮补充、追问、待选候选、撤销或清空待处理状态。

最小 case 字段见 `docs/agent-development-protocol.md`。新增回归 case 应纳入 `npm run agent:check` 或其下游测试入口。

- **case 自动纳入门禁**：新增或修订 case 后必须同步加入 `package.json` 的 `agent:check:tests` 列表；未纳入 `agent:check:tests` 的 case 不视为正式回归 case，仅作为开发期参考。长流程（`formal_orchestration` / 补空窗 / 全天编排）行为变化必须新增对应 case 并纳入门禁。
- **case 文件位置**：编排员需求覆盖矩阵 case 必须落在 `src/services/__tests__/fixtures/editorDemandCoverageCases.ts`；agent 行为 case 落在 `src/services/__tests__/` 下；浏览器 case 落在 `scripts/foreground-browser-goal37.mjs` / `goal38.mjs`；禁止散落到非测试目录。
- **case 字段完整度**：每个 case 必须包含 `id` / `userInput` / `expectedDecision` / `mustNotHappen` / `verification` 五个核心字段；缺失视为不合规 case，不得作为门禁依据。

## Scheduling Guardrails

编排行为必须遵守以下硬约束：

- 时间不能重叠，不能越出版面边界。
- 电视剧、连续剧、系列节目不能倒序、跳播、重复排入。
- 电视频道编排需要优先参考昨日历史编排进度，再结合当前编排单继续顺播。
- 当前编排单已有节目优先于历史推断；历史只作为上下文，不覆盖现场事实。
- 轮播单需要明确策略：内容匹配优先、收视率优先，或热播优先。
- 用户给出明确节目名、栏目、内容关键词时，候选库字段级不匹配应拒绝或留空，不能用相似但不命中的节目硬排。
- 候选不足、字段冲突、时间冲突、顺播风险无法消解时，应追问、拒绝或保留空缺，而不是强行编排。

补充硬约束：

- **workspaceKey 全链路一致**：所有 message / detail / pending / recoverable failure / server session replay / formal playlist snapshot / material evidence 链路必须携带 `workspaceKey` 并做工作区隔离校验；切换电视播单 / 轮播单时不得复用上一张播单的 pending、正式播单快照或素材证据；workspaceKey 缺失或跨工作区匹配必须拒绝写入。
- **会话连续与事实隔离**：同一 Agent 会话的对话线程不得因创建或切换播单而隐藏；`workspaceKey` 隔离的是 pending、正式快照、素材证据和 mutation 权限，不是用户可见聊天。首次从 `none` 创建播单时，创建前的会话目标应绑定到新工作区；已有播单之间切换不得迁移旧工作区事实。
- **pending 状态契约**：服务端保存或返回 `RuntimePendingAtomicContext` 时必须补齐 `owner` / `workspaceKey` / `mutationId` / `mutationPolicy`；显式跨工作区 pending 在进入运行时前拒绝，旧 session 重放缺少工作区字段时只能沿用已保存 session 工作区，不得猜测或覆盖。
- **草案 / 正式播单状态机硬约束**：draft reference / draft pending mutation / formal playlist / formal pending mutation 四种状态必须显式声明 `owner` / `workspaceKey` / `mutationId` / `mutationPolicy`；草案 mutation 不得写入正式播单，正式播单 mutation 不得污染草案；用户未明确"按草案"时草案仅作为参考上下文，不得作为正式编排依据。
- **历史上下文不覆盖现场事实**：当前编排单已有节目、用户当前轮明确选择、pending 状态、服务端 session 快照均为现场事实，历史编排记录只作为顺播基线推断材料，不覆盖现场事实。
- **长流程连续写入现场**：同一正式 ReAct 请求内，首次成功写入后的后续 `loadContext` 必须读取该次最新提交结果，不得重新读取请求开始时的旧前台快照并覆盖前一轮 mutation；新请求仍以新的 session/前台正式快照重新建立事实。
- **多用户会话隔离**（后续阶段）：当前阶段仍为单会话 / 单工作区原型，但服务端 session store、LLM key、formal playlist snapshot 必须按 `sessionId` + `workspaceKey` 隔离；商用部署前必须补完多用户会话隔离、速率限制、日志脱敏与权限边界。

## Atomic Command Policy By Playlist Type

原子命令必须受当前播单类型约束：

- 电视播单：只允许电视频道编排策略。由于频道策略、栏目、顺播和历史上下文约束强，原子命令一旦被识别且置信度不是极低，应优先直接执行，避免不必要的候选选择和确认。
- 轮播单：默认使用内容匹配优先策略；用户可切换为收视率优先或热播优先。由于可编排节目自由度更大，插入、替换等会引入节目选择的原子命令，应按目标检索候选并给出推荐列表，由用户选择后再写入。
- 删除属于敏感类原子命令，不受"电视播单可直接执行"规则豁免；除非已有明确确认链路，否则应保持确认或追问。
- 低置信度、目标不唯一、时间不明确、候选冲突、上下文不连续时，两类播单都应进入追问、目标选择、推荐选择或拒绝流程。
- 初始未创建播单时，任何插入、删除、移动、替换等原子命令，以及补空窗、全天编排等长流程命令，都应先提示用户新建电视播单或新建轮播单。

## Current Phase Scope

当前阶段先收敛到播单创建、原子命令识别、电视/轮播策略分流、候选推荐确认/取消这条短链路。

补空窗和全天编排本质上都是长流程，本阶段不作为原子命令接入目标；长流程行为变化必须纳入 `agent:check` 门禁，详见下文“补充说明”与 Verification Gates。

补充说明（与 `docs/agent-development-protocol.md` 对齐）：

- 长流程 `formal_orchestration` action 已在 `agentPlanner` 接入，bootstrap 门禁（空草案阻拦 / 部分草案引导 / 频道默认草案复用 / 轮播草案缺失阻拦 / 已有节目重编确认）已闭环。
- 部分草案的多段续补必须保留未命中的既有时段并扩展 coverage；只有 LLM planner 在 `refine_layout_draft` 中明确返回 `ignoreExistingLayout: true` 时才允许整份替换。本地不得根据“全部”“重写”等用户文本自行判断替换模式。
- 长流程行为变化必须新增 case 并纳入 `agent:check:tests`；`docs/agent-development-protocol.md` 中"补空窗和全天编排不纳入 agent:check 强制门禁"的旧描述已被这里取代，长流程门禁必须跟上代码状态。
- 长流程迁移边界由 `docs/agent-server-migration-plan.md` 与 `docs/agent-evolution-roadmap-proposal.md`（v2 修订版）约束，不在本节展开。

## Implementation Rules

- 先追踪现有流程，再做最小实现改动。
- 所有 agent 主逻辑相关实现前，必须先做 Codex 对齐审查：说明 Codex 类 agent 是否有类似处理方式，以及本项目为什么需要或不需要。
- 开放自然语言理解必须保持 LLM-first / LLM-only 主路径；删除所有会在 LLM 前或 LLM 后强行改写用户意图的本地关键词分类、续接、补意图、兜底澄清和隐藏限制。
- 本地逻辑只能保护结果，不能替用户表达或改写意图：必须保留时间换算、写入校验、草案完整度判断、危险操作保护、正式播单和草案隔离、模型返回结构校验、执行边界和失败报错。
- 判断标准：代码如果是在理解用户，就是错误方向；代码如果是在保护结果、校验写入或暴露失败，就是允许保留。
- 如果模型无法返回有效理解或可读解释，应像 Codex 一样暴露失败并允许用户重试或补充，不能由本地规则假装理解。
- 不凭单条正则或单次猜测绕过完整链路；分类、草案、检索、候选选择、实际编排都要能解释。
- LLM 选择节目时，要模拟经验丰富的编排人员：先看硬条件，再看上下文连续性，再看内容匹配、时长适配、收视率或热播策略，最后给出拒绝理由。
- 确定性逻辑只能发生在模型返回之后或写入之前，用来校验、收敛候选、保护结果和暴露失败；不能在模型前后改写开放意图。
- 模型结构兼容只能读取模型已明确返回的合法字段值（包括字段误置时的受限归一化），不得结合用户文本、关键词或上下文猜测缺失语义；结构兼容后仍必须通过同一 schema 与业务门禁。
- 不保存用户提供的 API key、token 或其他密钥；提交前做密钥扫描。

补充硬约束：

- **失败暴露而非回滚边界**：禁止实现 `validateOrRollback` / `mutationJournal` / `autoRollback` 等自动回滚链路；函数命名上 `validate` 与 `rollback` 必须分离，`validate` 只校验 + 暴露失败，不触发回滚。失败时必须产出结构化 `RecoverableInterpretationFailure` envelope（含 `kind` / `recognizedSlots` / `missingSlots` / `candidateEvidence` / `retrySuggestions`），让前台据此生成 quick replies。本地逻辑禁止"假装理解 + 自动续跑"。
- **MutationPolicy 跨模块硬约束**：`MutationPolicy`（`preview_only` / `pending_only` / `formal_write`）必须从 intent 解析层一路传递到 write adapter；`assertMutationAllowed` 必须在 `FormalPlaylistWriteAdapter` 入口校验，`preview_only` 时直接抛 `PreviewOnlyViolationError`；禁止在 pending mutation / write adapter 层丢字段或回退默认值。
- **双路径并行禁止**：同一类业务能力只能有一个执行路径。`CapabilityRegistry` 与 `DemoRuntimeFacade.tryHandleAgentPlannerInstruction` 的双分发机制必须收敛为统一分发；facade 产出 `kind: 'orchestration'` decision 后必须由 facade 自身执行或显式委托，禁止形成"facade 产出请求 vs 老 `Orchestrator` 独立执行"两套并行路径。
- **timeout / deadline 统一管理**：禁止 6s / 8s / 12s / 15s / 30s / 60s / 140s 多套 timeout 散落各处。所有 LLM 调用 / stage 执行必须共享一个请求级 `AgentDeadline` 管理器；短链默认整体 90s（可配置）、单个 LLM stage 最多 45s，并为后续候选与写入保留预算；长流程整体 10 分钟 + 批次 90s 组合。30s 不再作为复杂推理硬截止。`signal()` 方法返回 `AbortSignal`，调用方必须传入；0s 暴露当前阶段、5s 暴露持续等待并允许停止，停止必须中断服务端 LLM，超时或停止后 stage 不再执行。
- **上下文压缩对齐 Codex**：长流程上下文压缩必须实现真 ReAct 循环 + 批量 checkpoint + 上下文压缩；压缩策略保留最近 N 轮原 observation + 任务目标 + 已决动作摘要 + 失败原因，丢弃中间冗余 trace；压缩必须幂等可重放，不能丢失"上一轮为何被拒绝"的关键证据；压缩前后状态必须可解释。
- **真 ReAct 循环**：禁止伪 ReAct（一次性产出 plan 后串行执行不回判）；每轮 act 后必须回到 LLM 让其基于 observation 重新 decide；decide 失败、超时或 LLM 返回 `unable_to_decide` 时停止并暴露，不假装继续。
- **正式长流程单路径**：`formal_orchestration` 与会启动正式编排的 `commit_layout_draft` 必须携带 LLM 返回的顶层 `mode="react"` 和 `reactTask`。缺失时返回 `react_plan_invalid` 结构化失败并允许用户重试；前台、facade 与 capability 均禁止回退旧 `Orchestrator`、本地候选评分或一次性串行编排。
- **长流程 UI 停止按钮**：长流程启动后必须暴露 `canInterrupt: true` 信号，UI 必须有停止按钮，5s 后允许用户停止；停止后状态保留在最后 checkpoint，不自动续跑；停止信号必须通过 `AbortSignal` 联动到 LLM 调用与 fetch 请求。

## Agent Architecture

Agent 架构硬约束，对齐 Codex 设计模式，避免架构缺陷反复叠加：

- **Capability 拆分边界**：按 intent 拆分 `AtomicCommandCapability`，单一 capability 不超过 2000 行；超过红线的 capability 必须按 intent 子域（move / insert / replace / delete / batchMove / batchDelete / query / validate）进一步拆分。`DemoRuntimeFacade` 总控文件不超过 5000 行；任何新能力不得继续堆进 facade 或单一 capability。
- **CapabilityRegistry 唯一分发**：所有 capability 必须通过 `CapabilityRegistry.resolveAll` 路由，`capability_route_conflict` 必须在所有路径生效；禁止在 facade 内保留独立 if-else 分发链路。
- **不引入子 agent**：当前项目本身就是典型的子 agent，禁止引入 DraftAgent / CandidateAgent / SelectionAgent / WriteAgent / ValidationAgent 等子 agent 雏形；复杂能力拆分只通过按 intent 拆分 capability + 统一分发机制实现。
- **失败暴露而非回滚**：禁止引入 mutation journal / auto rollback / compensation transaction；失败时保留现场 + 暴露结构化 envelope + 让用户决定下一步（重试 / 补参 / 取消 / 换关键词 / 缩小范围）。
- **ReAct 长流程边界**：长流程（`formal_orchestration` / 补空窗 / 全天编排 / 整体补排）必须使用真 ReAct 循环 + 批量 checkpoint + 上下文压缩；`maxTurns` / `batchSize` / 整体 deadline 必须显式声明；失败时必须返回已完成数量、本批是否写入、剩余数量和可恢复动作，不静默继续。
- **有限批量与整体编排边界**：对有限、可定位节目集合执行删除、移动、替换，仍属于 `batch_delete` / `batch_move` 或复合原子命令，不因动作数量多、草案缺失或草案不完整升级为 `formal_orchestration`。只有目标覆盖整张播单、全部空窗或完整目标时长并需要持续检索回判时才进入正式长流程；该 taskKind 需要草案而草案不完整时，应引导完善草案，不得降级成猜测插入。
- **轮播时长压缩边界**：“压缩 N 小时”未明确是减少 N 小时还是压缩到 N 小时时，必须由 LLM 追问目标时长和内容取舍，正式播单保持不变；明确队尾/相对范围且边界完整时必须输出带 `rangeStart` / `rangeEnd` / `pending_only` 的 `batch_delete`，不得降成单条 `delete` 或直接 `formal_write`，边界穿过节目时不得裁切节目。按热播、收视率或内容策略覆盖整张轮播单取舍时，必须先准备或调整到目标时长一致的轮播草案，用户确认后再启动正式 ReAct 重编并校验整批重编授权。压缩不得解释为 `batch_move`。
- **整表压缩方案阶段**：整表轮播压缩的 `draft_precheck` 必须把当前正式编单、当前草案和候选 observation 交回 LLM，由 LLM 返回覆盖完整目标时长的 `prepare_layout_draft` / `refine_layout_draft`；本地只校验连续 coverage、目标时长和草案结构，不得按候选热度排序替用户拼方案。方案阶段必须标记 `noFormalPlaylistWrite`；decide 缺失、结构无效或证据不足时返回 `llm_decide_unavailable` 可恢复失败并保留现场。
- **候选检索与零命中边界**：LLM 必须提供保留用户硬条件的原始查询与受控改写，本地在显式轮次/查询预算内检索并记录 trace；这属于有限穷尽，不得声称无限穷尽。ReAct observation 为零候选时，decider 只能在存在未尝试且不违背硬条件的查询时继续，否则返回 `unable_to_decide`、保留空缺并说明需补充条件；禁止伪造候选、重复失败查询或把零候选当完成。
- **候选策略证据透传**：`formalOrchestrationReadPorts` 必须将 canonical 候选已有的 `estimatedRating` / `playCount` / `popularityScore` / `editorialDecision` 原样放入 research observation，供 LLM 按收视率、热播或既有编辑判断取舍；read port 不得丢字段、重算分数、本地排序或替 LLM 选择。
- **正式只读分析端口**：decider 合法返回 `read_only_analysis` 时，正式 ReAct 必须通过 read port 返回当前正式节目 ID、时段、时长和来源证据，且 `noMutation=true`；不得出现 prompt 允许该 action 但 capability 未配置端口。需要改变播单时，prompt 必须提供合法 `atomic_command` 结构，禁止模型只在理由中描述 mutation 却重复 validate。
- **SSE 双路径**：path A 流式 + path B 批量回放必须并存；HTTP 模式必须保留 `onProgress` 回调接收进度事件，禁止退化为单气泡批量展示；进度消息必须包含 `查节目库` / `候选决策` 等 `processTypeLabel` 分支。
- **流式与执行边界**：LLM token 流只用于首 token/增量体验和安全进度展示；intent、候选决策及任何 mutation 必须等待完整响应通过结构校验后才可进入 capability/write adapter。半截 JSON、断流、停止不得补齐或自动续跑。
- **流式展示语言**：`structured_complete` 属于内部协议事件，只推进状态机与 trace，不生成“完整接收/结构校验通过”等用户气泡；前台只展示理解需求、查节目库、候选决策、写入校验等业务进度及最终真实结果。
- **终态可见性只认结构化状态**：前台不得因为回复正文包含“版面草案”“编排”等关键词隐藏、重分类或替换终态消息；草案工作区投影、长流程状态和内部进度过滤只能读取结构化 `processTypeLabel` / payload / details。模型没有返回合法 action 却声称将创建或执行时，运行时必须返回 `noMutation` 澄清，不得补 action。
- **FormalPlaylistWriteAdapter 写入边界**：正式播单写入必须经 `FormalPlaylistWriteAdapter` 或同等 Agent API 写入边界；幂等 key / 版本检查 / 批量失败恢复 / 审计元数据属于写入边界；delegate 抛错必须转换为结构化可重试失败，保留 pending 与正式快照且不得缓存失败。节目选择 / 顺播 / 候选确认 / 原子命令校验仍由既有业务链路负责。新增正式写入能力必须能解释是否改变旧行为；迁移任务默认不改变旧行为。
- **整批重编授权边界**：已有正式节目进入 `full_generate` 前，用户对当前 `formal_rebuild_confirmation` 的确认必须由 Local/Agent Server 可信运行时签发任务级 `FormalOrchestrationGrant`；前台只携带不可解释的 `grantId`，不得提交完整授权声明。Grant 必须绑定 `sessionId`、`workspaceKey`、确认 pending、播单版本、草案可执行指纹、任务目标/范围与允许 intent；工作区、现场版本、草案或任务范围漂移时停止并重新确认。作用域内 mutation 不重复逐项审批，但每次正式写入仍经过 capability 与 `FormalPlaylistWriteAdapter`；首次空播单编排及独立敏感操作不得误用该 Grant。
- **服务端迁移边界**：从 Goal 39 起，新增长程业务能力必须优先落在 `schedulingAgentRuntimeFacade` / `reactTaskRuntime` / `AgentServerRuntime` / `AgentServerSessionStore` / `HttpAgentRuntimeClient` / `FormalPlaylistWriteAdapter`；不再继续堆进 `ChatPanel.vue` 或 `DemoRuntimeFacade`。Codex、OpenClaw 等桌面 Agent 仍只是未来外部访问方，只能通过统一 CLI/API 契约复用编排内核；项目内不保留专用进程内桥，且当前不实现 CLI/skill 适配。

## File Hygiene

文件治理硬约束，避免大文件失控与历史债反复堆积：

- **文件大小红线**：单文件代码不超过 2000 行（`.vue` / `.ts` / `.mjs`）；超过 5000 行的文件必须在下一次涉及该文件的任务中拆分。`DemoRuntimeFacade`（约 9800+ 行）与 `AtomicCommandCapability`（约 6200+ 行）均为 P0 级技术债，任何新能力不得继续堆入这两个文件。
- **新增能力位置约束**：新增 agent 长程业务能力必须落在 `schedulingAgentRuntimeFacade` / `reactTaskRuntime` / `AgentServerRuntime` / `AgentServerSessionStore` / `HttpAgentRuntimeClient` / `FormalPlaylistWriteAdapter`，禁止堆入 `ChatPanel.vue` 或 `DemoRuntimeFacade`。新增原子命令分支必须落在按 intent 拆分后的子 capability，禁止堆入单一 `AtomicCommandCapability`。
- **历史遗留文件归档**：不再作为开发依据的 `docs/` 文件必须移入 `docs/archive/`；`.trae/documents/` 下的临时开发计划不得作为约束依据；过时文件发现即归档，禁止继续引用。
- **失效路径批量修正**：发现 `/C:/Users/sucongfei/.../bigbiandan2/` 这类失效绝对路径必须立即批量替换为相对路径或当前仓库真实路径；禁止在新文档中继续使用失效路径。
- **大文件拆分原则**：拆分必须保持行为不变（先补回归 case，再拆分，再验证）；拆分后必须更新 `docs/code-wiki.md` 模块索引；禁止"拆完不更新文档"导致下次开发找不到模块。

## Verification Gates

每次任务结束前必须按影响范围运行验证：

- 行为变化：运行相关 Vitest case。
- Agent 编排链路变化：运行 `npm run agent:check`。
- 前台可见交互变化：刷新 `http://localhost:5173`，在 Codex in-app browser 中跑一次真实冒烟或交互验证。
- 构建相关变化：运行项目构建检查。

若验证失败，必须说明失败门禁、失败原因、已修复或剩余风险。

补充门禁：

- **长流程纳入 agent:check**：长流程（`formal_orchestration` / 补空窗 / 全天编排）行为变化必须新增 case 并加入 `agent:check:tests`；`demoRuntimeFacade.fullGenerateBootstrap.test.ts` 与 `orchestrator.test.ts` 必须纳入门禁；文档中"补空窗和全天编排不纳入 agent:check 强制门禁"的旧描述已失效。
- **文档同步门禁**：行为变化涉及文档约束时，必须同步更新 `AGENTS.md` / `docs/agent-development-protocol.md` / `docs/aibiandan-agent-rules.md` / `docs/code-wiki.md`；提交前自检文档章节是否仍与代码一致。
- **CI/CD 自动化门禁**：CI 必须运行 `npm run agent:check`、`npm run build`、密钥扫描；本地提交前必须运行 `agent:check` 至少一次；CI 失败禁止合并。
- **LLM 调用监控与成本核算**：所有 LLM 调用必须记录 `tokenUsage` / `latencyMs` / `cost` / `errorMessage` / `model`；新增 LLM 调用必须能在 trace 中观察到；禁止"调用即丢"无审计。
- **Prompt 版本管理**：所有 system prompt 必须显式声明版本（如 `v1.0` / `v2.0`）；prompt 修订必须更新版本号并保留 diff；trace 中必须记录使用的 prompt 版本，便于回归与归因。
- **提交前密钥扫描自动化**：提交前必须运行密钥扫描（如 `git diff` 中扫描 `api_key` / `token` / `secret` 关键词）；发现疑似密钥必须人工确认后才提交；禁止把 `.env` / `credentials.json` 这类密钥文件提交入仓。
- **真 ReAct 循环门禁**：长流程实现必须能展示 plan → act → observe → decide 完整事件链；伪 ReAct（一次性产出 plan 后串行执行不回判）禁止合入。
- **上下文压缩验证**：上下文压缩实现必须能在长流程 trace 中观察到压缩前后状态，且不丢失"上一轮为何被拒绝"的关键证据；压缩必须幂等可重放。
- **浏览器回归门禁**：前台可见交互变化必须运行 `npm run agent:browser:goal37` 与 `npm run agent:browser:goal38`；Goal 37/38 覆盖矩阵门槛：`supported + guarded_supported` 必须达到 80% 以上，无法真实覆盖的场景必须保留 `rootCause`，不能伪装成已完成。

## Naming Conventions

命名约定硬约束，避免模块边界混乱：

- **测试文件命名**：测试文件必须落在 `src/**/__tests__/*.test.ts`，文件名采用 `<被测模块驼峰名>.test.ts`（如 `atomicCommandCapability.test.ts`、`demoRuntimeFacade.atomicFallback.test.ts`）；浏览器测试脚本落在 `scripts/foreground-browser-goal<N>.mjs`。
- **services/agent 与 services/runtime 命名**：`services/agent/` 下文件为 agent 核心运行时（意图 / 能力 / 约束 / 候选评判 / 策略），文件名以业务能力命名（如 `atomicCommandCapability.ts` / `candidateSearchRetryService.ts`）；`services/runtime/` 下文件为前台 & 服务端运行时（会话 / 任务计划 / 写入边界），文件名以运行时职责命名（如 `demoRuntimeFacade.ts` / `agentServerRuntime.ts` / `formalPlaylistWriteAdapter.ts`）；禁止两目录相互堆入对方职责的文件。
- **broadcast-plan / dialogue 命名**：`broadcast-plan/` 目录统一采用 `broadcastPlan*.ts`（纯 helper / 状态映射 / 结构转换）与 `useBroadcastPlan*.ts`（页面级 composable）与 `create.vue`（页面容器）；`dialogue/` 目录统一采用 `chatPanel*.ts`（拆分 helper）与 `ChatPanel.vue`（对话面板容器）；不再把新业务判断直接堆回 `create.vue` 或 `ChatPanel.vue`。
- **capability 命名**：按 intent 拆分的 capability 文件名采用 `<intent>Capability.ts`（如 `moveCapability.ts` / `insertCapability.ts`）。目标约束：当前尚未按 intent 拆分，仍为单一 `atomicCommandCapability.ts`；后续按 intent 子域拆分时必须遵守此命名，统一注册到 `CapabilityRegistry`，禁止在 facade 内保留独立 if-else 分发链路。
- **case 文件命名**：编排员需求覆盖矩阵 case 文件名固定为 `editorDemandCoverageCases.ts`；agent 行为 case 文件名采用 `<被测模块>.<场景>.test.ts`（如 `recoverableFailureEnvelope.test.ts`）；浏览器 case 落在 `scripts/foreground-browser-goal<N>.mjs`。
- **prompt 版本命名**：prompt 文件名采用 `<能力域>.prompt.<version>.md`（如 `agentIntent.v1.md`）；trace 中必须记录使用的 prompt 文件名与版本号。

## Final Report

最终汇报必须包含：

- 新增或命中的 case。
- 修复路径或实现路径。
- 实际运行的验证命令。
- 浏览器验证观察到的页面状态，若本次涉及前台交互。
- 残余风险或未覆盖点。

补充汇报要求：

- **文档同步声明**：若本次任务涉及文档约束变化，必须声明已同步更新的文档清单与未更新原因。
- **架构对齐声明**：若本次任务涉及 agent 架构或长流程实现，必须声明对齐了 Design Philosophy / Agent Architecture / File Hygiene 中哪条约束，以及对齐 Codex 设计模式的具体点。
- **失败暴露声明**：若本次任务涉及失败处理路径，必须声明是否引入了自动回滚（应禁止）或子 agent（应禁止），以及失败 envelope 是否结构化。
- **归档声明**：若本次任务发现历史遗留过时文件，必须声明已归档到 `docs/archive/` 哪个子目录，并在 `docs/archive/ARCHIVED.md` 登记原因。
