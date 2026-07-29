# AI编审助手业务规则与工程约束

## 业务数据单一事实源

项目只允许一套业务数据。节目、栏目、素材、成片、版面、历史排播及其标识的权威来源
是 `src/services/agent/canonicalSchedulingData.ts`。任何测试 fixture、浏览器 mock、
LLM mock 或演示代码不得临时生成同名实体或候选记录。需要现场状态时，引用 canonical
实体后再构造播单项；canonical 中不存在的实体必须显式报 `data_fixture_missing`，不得
用相似节目、硬编码候选或“成功”响应替代。

这份文档给后续 Agent 开发和评审使用。它不替代测试矩阵，也不替代产品讨论；它只负责把已经确认的业务规则、工程方法和外部 skill 筛选边界写成一份人能看懂的准则。

## 1. 基本定位

- `aibiandan_agent_harness` 是本项目内部的工程方法，不是官方外部 skill，也不是某个现成标准。
- 外部通用 skill 只能在实际筛选后接入，不能假设已经存在。
- 真实前台路径优先：`ChatPanel` / `broadcast-plan` 是主路径；Codex、OpenClaw 等桌面 Agent 只是未来的外部访问方，只能复用统一 CLI/API 契约，不能在项目内持有独立运行时桥，也不能成为当前实现和测试的阻塞条件。CLI 适配不属于当前修复范围。
- AI编审助手应该像懂编排业务的人一样交流；系统过程、候选数、检索证据可以保留，但不抢主回复。
- 内部可以保留评分、排序和审计字段；用户可见主回复、确认理由和候选说明不能出现“置信度”“匹配度”这类技术词。
- 长流程遇到瞬时网络或模型服务故障时，Agent 可以在统一 deadline 内有限重试；重试仍失败则保留最后 checkpoint 并暴露失败，不假装完成。
- 网络断连或服务重启后的恢复必须校验 `sessionId + workspaceKey + 正式播单版本`。用户主动停止后只保留现场，必须由用户明确继续；已经完成的正式写入不回滚且不得重复执行。

## 2. 业务规则

### 工作区

- 用户新建或打开一张播单后，这张播单就是当前工作区。
- 后续自然语言默认指向当前工作区，除非用户明确切换。
- pending 像 Codex 审查：用户没有确认，又开始说新话题，旧 pending 自动失效。
- 同一时刻只保留一个激活草案，用户可以用自然语言切换，比如“按昨天的版面草案”。

### 电视播单

- 电视播单是时间格子里的编排。
- 电视播单通常能按频道和日期自动读到版面草案。
- 如果真的没有草案，全天编排或整体补排必须阻拦。
- 电视检索主线是栏目名、节目名或裸名称，不靠节目编号理解用户意图。
- 检索三态是：`栏目=...`、`节目=...`、裸名称。裸名称需要同时匹配栏目和节目。
- 连续剧、周播节目或其他有期数顺序的内容，必须先用当前/历史编排证据判断上一期，再顺接下一期。
- 如果顺播/期数证据把候选收敛到唯一可排节目，并且没有素材、版权、时长或冲突硬阻断，可以直接编排，并在回复里说明顺接依据。
- 如果同一期仍有多个版本、没有顺播基线、或只是标题相似/热度更高，不能自动替用户选择。

### 轮播单

- 轮播单是内容队列里的编排，不是电视时间格子。
- 轮播单不会凭空生成草案；只有用户给出主题、总时长、内容块，或上传草案时，才形成当前草案。
- 轮播单整体编排、全天编排、整体补排必须有草案。
- 轮播单原子操作可以没有草案，比如插入、删除、移动、替换、查询、校验。
- 电视播单原子操作同样不以草案完整度为前置门禁：用户明确要求正式播单插入、删除、移动、替换时，即使草案为空或未完成，也保持正式原子链路；缺时间、节目或目标时只做原子补参/候选澄清，不转成草案或整体编排。
- 有限、可定位节目集合的批量删除、移动、替换属于复数原子命令或复合任务，草案不是前置条件；只有覆盖整张播单、全部空窗或完整目标时长的请求才属于整体正式编排。整体任务所需草案缺失或不完整时先引导完善草案，不得用若干猜测插入冒充完成。
- pending 状态必须带 owner、workspaceKey、mutationId、mutationPolicy；服务端发现 pending 来自其他播单时拒绝续接，不覆盖工作区字段。
- 删除或替换后，轮播单应该继续串联，不生成电视式空窗。

### 草案和正式播单

- 草案和正式播单默认独立。
- 只有用户明确说“参考草案”“按草案”“照昨天草案”时，草案才进入正式编排依据。
- 用户要求优化草案、补充草案或切换草案时，不能误写正式播单。
- 如果 AI 给出优化建议，最后可以追问用户是否要更新草案或进入正式编排，但必须等用户确认。
- 草案的业务分段由 LLM 产出：例如第一小时/第二小时/16条/不知道怎么排的策划方案。本地只校验结构、落地草案和守写入边界，不能用规则替 LLM 猜区块内容。
- 普通草案不是候选检索结果。草案阶段的轻量预检只能作为内部提示，不能在草案主界面显示“候选 N”，也不能因为预检为 0 就阻止正式编排；正式编排时必须重新按草案块进入检索、LLM 拆解和原子执行链路。只有显式设计的“核验型草案/策划草案”才可以展示已核验候选结论。
- 节目检索采用有限预算内的受控多查询：LLM 保留明确节目名、栏目、主题等硬条件，并提供同义改写、拆分词或逐步放宽查询；本地逐项查询、合并去重和记录终止原因，不生成新关键词，也不承诺无限穷尽。命中后仍执行候选、顺播、时长、版权和工作区校验。

### 写入和确认

- 破坏性操作、复合任务、多候选、冲突、时长不确定、目标不唯一时，必须让用户确认。
- LLM 可以生成任务计划和解释，但本地系统决定能不能写入。
- LLM 草稿不能绕过草案门禁、pending、候选选择和正式写入边界。
- `assistantReplyDraft` 不是执行凭证。模型没有返回通过结构校验的 `create_playlist`、草案或写入 action 时，即使文案声称“已创建”或“将创建”，前台也必须明确告知尚未落地并允许重试，不能让对话状态领先于工作区事实。
- 模型返回合法的有序 ReAct 动作时，`create_playlist` 必须先落地为真实播单工作区并形成 observation，后续正式编排再由下一轮 decide；不能仅展示动作序列，也不能因序列中存在正式 action 而错误拒绝整份合法计划。
- 大批量任务可以分批执行，必要时要求用户继续。

## 3. 工程方法

- 正式 ReAct 原子动作与普通 Agent 提交共享同一个 capability 路由边界；不得在长流程端口直接 `new AtomicCommandCapability` 绕过 `CapabilityRegistry`。多 owner 命中时必须暴露冲突并停止，不得猜选执行。
- 删除和轮播候选写入的确认门禁在 ReAct 中不得弱化。`pending_only` 动作被业务策略拦在 commit 前时，仍需形成带 workspace 与 mutation 身份的正式 pending envelope，供用户后续明确确认或取消。
- 待确认 observation 出现后必须立即暂停，不能继续执行同批动作或让 LLM decide 代替编排员确认。用户明确执行 `confirm_pending` 后才允许恢复该 action；“继续”只表示恢复普通中断，不构成删除或轮播候选写入授权。
- 编排员看到的长流程审批必须是显式按钮：确认调用结构化 `confirm_pending`，取消调用结构化 `cancel`，不能重新发送自然语言让模型猜授权。切换播单或现场版本变化后旧审批必须禁用；等待前已完成的批次保留并同步到页面，取消只取消待审批及后续动作，不回滚已完成 checkpoint。

后续每次 Agent 改动都按这条链路走：

`需求 case -> 业务边界 -> 实现 -> 验证 -> 根因归类`

执行要求：

- 先找到或新增编排员需求 case，再动实现。
- 所有 agent 主逻辑相关实现前，必须先做 Codex 对齐审查：Codex 类 agent 是否有类似处理方式；如果有，本项目为什么需要；如果没有，为什么不应加入。
- LLM-only 的主路径边界是：删掉所有会在 LLM 前或 LLM 后强行改写用户意图的本地逻辑；保留只保护结果的确定性逻辑。
- 本地必须保留时间换算、写入校验、草案完整度判断、危险操作保护、正式播单和草案隔离、模型返回结构校验、执行边界和失败报错。
- 本地不能保留开放语义分类、关键词续接、补意图、兜底澄清、隐藏意图改写、模型失败时假装理解等逻辑。
- 判断标准：本地代码如果是在理解用户，就是错误方向；本地代码如果是在保护结果、校验写入或暴露失败，就是允许保留。
- 如果模型没有返回有效理解或可读解释，应像 Codex 一样暴露失败并允许用户重试或补充，不用本地规则补“我理解为……”。
- 设计时写清前置状态、允许路径、禁止路径。
- 实现时保持 LLM-only 理解层：宽泛自然语言理解交给模型；本地只做上下文记录、业务裁决、候选收敛、写入保护和原子执行边界，不能设置隐藏续接开关。
- 对模型输出做字段位置兼容时，只能搬运模型已明确给出的合法枚举并再次校验；不得利用用户文本或关键词补出模型未返回的 `queryKind`、intent、pendingAction 等语义。
- 除 pending 的确认/取消/候选选择，以及明确按钮 quick action 这类非自由文本入口外，用户自然语言不得先被本地分类器截走；组合需求、草案生成/微调、正式编排意图都必须先走 LLM planner，本地只能在 planner 返回动作后做业务裁决、执行安全和防假完成。
- `refine_layout_draft` 的多段结构默认是对现有草案按时间范围续补或替换命中段，不得丢弃未命中的既有时段；只有 planner 明确给出 `ignoreExistingLayout: true` 才允许整份重写。本地只执行该结构化边界，不从“全部改成”“继续补”等文本推断替换策略。
- 正式编排 action 必须由 LLM 直接给出 `mode`、`taskKind`、`useLayoutDraft`、`targetTimeRange` 和 `searchKeywords`；主路径只能透传并校验这些结构化语义，不能在 capability 或 facade 中重新用用户原话推断、覆盖或补齐。
- 前台上下文包的 `scenario` 只描述 review/pending/draft 等客观现场状态，不是用户意图分类器；不得再通过 `latestUserInput` 的正则、关键词或本地兜底推断 `full_generate`、`partial_generate`、草案引用或切换意图。
- 同一轮短链路中的意图、planner 和候选 LLM 调用共享请求级 deadline，默认整体 180s（可配置）、单 LLM stage 最多 90s，意图阶段为后续阶段保留 60s，候选判断为写入保留 15s；30s 不再是复杂推理硬截止。每次调用必须透传同一个中止信号，禁止用独立 8s 或隐藏 60s transport timeout 提前截断真实模型。开始时立即告知当前阶段，等待超过 5s 时通过服务端 progress 告知编排员仍在处理并开放停止；停止按 `sessionId + workspaceKey` 隔离且必须真正中断服务端 LLM。
- 流式 token 只改善首 token 和持续等待体验，不改变 LLM-first 决策边界；原始 JSON token 不直接展示给编排员，完整结构校验前不得路由 capability、候选写入或正式播单。
- 编排员只看到业务进度和最终结果；`structured_complete`、“结果已完整接收”、“结构校验通过”等协议状态保留在内部 trace。对话线程跨播单持续可见，`workspaceKey` 只隔离 pending、快照、素材证据和写入权限；首次建单前的会话目标可绑定到新工作区，已有工作区事实不得迁移。
- 消息正文不是 UI 状态协议。前台只能依据结构化标签、payload 和 runtime details 判断草案投影、长流程状态与消息可见性，不能因为正文出现“版面草案”或“编排”就隐藏终态。模型没有合法 action 却声称将执行时，应显示尚未落地且可重试的 `noMutation` 结果，不能补动作或制造成功。
- 候选门禁只保护可验证的硬条件；候选数量或本地编辑评分不得作为覆盖 LLM 候选决定的固定阈值。候选即使很多，只要 LLM 能基于硬条件、上下文和业务策略给出证据充分的唯一选择，就应允许进入既有 TV/Rotation 写入策略。
- 新增特殊逻辑必须能归因到 rootCause，不能为了一句话堆不可复用的关键词分支。
- 轮播总时长压缩由 LLM 区分三类：未明确“减少 N 小时/压缩到 N 小时”时追问；明确完整队尾或相对范围时输出带范围和 `pending_only` 的 `batch_delete`，不得降成单条删除或直接正式写入；按热播、收视率或内容策略覆盖整表取舍时先调整目标时长一致的草案，再经确认启动正式 ReAct。任何路径都不能把压缩当 `batch_move` 或裁切节目。
- 正式 ReAct 按收视率或热播策略取舍时，research observation 必须包含 canonical 候选已有的收视率、播放量、热度分和编辑判断；本地只透传证据，不得重算指标、排序候选或替 LLM 决定保留内容。
- 整表重编包含多次正式动作时，后续轮次必须看到当前任务上一轮成功写入后的最新播单，不得用任务启动时的旧播单覆盖已完成动作；新的用户请求再以新的正式快照为准。
- 正式 decider 需要当前播单明细时可返回 `read_only_analysis`，运行时必须提供只读端口并返回节目 ID、时段和时长；若目标要求实际修改，模型必须返回结构合法且 mutationPolicy 明确的 `atomic_command`，不能用重复校验代替修改。
- 整表压缩的方案阶段必须先读取当前编单并执行 `draft_precheck`，再把候选 observation 交回 LLM 形成完整目标时长草案。运行时只校验草案 action、连续 coverage 与目标时长，并投影 `noFormalPlaylistWrite`；不得使用本地热度排序替 LLM 决定保留/删除内容。模型没有返回完整结构时暴露 `llm_decide_unavailable` 并允许重试，不修改草案或正式播单。
- 评审先看是否误写正式播单、误改草案、绕过 pending、多候选自动选、外部桌面 Agent 反向绑定前台或编排内核。
- 验证要组合使用 runtime/contract 测试、前台浏览器场景、LLM 协议测试和人工产品门槛。

## 4. 外部 skill 筛选结果

| 方向 | 当前结论 | 可用候选 | 使用边界 |
| --- | --- | --- | --- |
| 项目 Agent harness | 项目专属 | `aibiandan_agent_harness` | 约束自然语言、工作区、草案、pending、原子能力和正式写入链路 |
| TDD | 暂无直接官方候选 | 待单独筛选或自建 | 作为工程方法保留，不能伪装成已接入 skill |
| Code review / CI | 可参考现有候选 | `gh-address-comments`、`gh-fix-ci` | 约束 PR 反馈和 CI，不替代业务规则评审 |
| Browser E2E | 可参考现有候选 | `playwright`、`playwright-interactive`、`screenshot` | 验证真实前台是否能点、能看、能承接 |
| Product QA | 可参考已安装插件 | `product-design:get-context`、`product-design:index` | 约束低学历编排员能否看懂，不替代 runtime 测试 |
| Security | 可参考现有候选 | `security-best-practices`、`security-threat-model`、`security-ownership-map` | 公开访问前处理 key、匿名会话、演示数据隔离 |
| Deploy | 可参考现有候选 | `vercel-deploy`、`netlify-deploy`、`cloudflare-deploy`、`render-deploy` | 只处理部署壳和访问方式，不决定编排业务逻辑 |

## 5. 证据位置

- 编排员需求覆盖矩阵：`src/services/__tests__/fixtures/editorDemandCoverageCases.ts`
- 工程规则测试：`src/services/__tests__/editorDemandCoverageCases.test.ts`
- 自然语言原子命令清单：`docs/scheduling-agent-natural-language-command-inventory.md`
- 旧版开发流程文档：`docs/agent-development-protocol.md`
# 正式长流程执行边界

- 正式 ReAct 长流程采用同一事实源的双路径展示：SSE 实时投影任务规划、查节目库、候选决策和 checkpoint，POST 返回完整执行结果并补回断流期间遗漏的 progress 事件。两条路径按稳定事件 id 去重，断流不得触发 action 重跑。
- ReAct decide、act 失败、超时或 `unable_to_decide` 时，服务端必须返回 HTTP 200 + `failed` structured outcome 和 recoverable failure，并通过同一 progress 通道显示；禁止抛成 HTTP 500，禁止映射成 `completed` 后只留下 planner 的承诺文案。
- ReAct 候选 observation 为零命中时，decider 必须读取候选源状态、已尝试 queries、用户硬条件和剩余轮次：仍有安全的未尝试查询才继续 `research_check`；数据源不可用、查询穷尽或继续放宽会违反硬条件时返回 `unable_to_decide`，保留空缺并说明用户需补充什么。禁止固定无限重试、伪造候选或把零候选当作完成。

- `formal_orchestration` 与会启动正式编排的 `commit_layout_draft` 必须同时携带 LLM 返回的顶层 `mode="react"` 和 `reactTask`，第一批只允许查证与校验等可观察动作；`research_check` 必须由 LLM 给出非空查询或明确可检索语义标签，本地不得生成第一步或补关键词。缺少 `reactTask` 时保留现场并返回 `react_plan_invalid`，不得回退旧 `Orchestrator` 或本地候选评分链路。
- 每批按 `plan -> act -> observe -> decide` 执行并立即持久化 checkpoint；checkpoint 按 `sessionId + workspaceKey` 隔离，停止后保留且不得自动续跑或回滚。
- decide 历史采用“最近两轮原始 observation + 全部已决动作摘要 + 失败原因”压缩策略；旧 raw trace 可以丢弃，但版权、候选不足、顺播冲突等拒绝原因不得丢失。压缩必须确定性、可重放，并在 checkpoint 中暴露压缩前后计数。
- query、pending 与正式写入均复用既有原子能力；`formal_write` 必须经过 `FormalPlaylistWriteAdapter`，atomic action 必须显式携带 `mutationPolicy`。
- `FormalPlaylistWriteAdapter` 对所有调用路径强制要求 `mutationContext`；缺失 policy、`preview_only` 或 `pending_only` 均不得调用正式写入 delegate。
- 已有正式节目执行整批重编时，编排员确认的是“按当前草案/任务范围覆盖当前播单”这一任务级风险，不应再为任务内部每个删除、替换、移动逐项审批。确认后由可信运行时签发 `FormalOrchestrationGrant`，前台仅持有 `grantId`；Grant 必须绑定 session、workspace、正式播单版本、草案指纹和任务范围。切换播单、并发修改现场播单、改变草案可执行内容或偷换任务目标时，旧 Grant 失效并重新确认。
- Grant 只免除已确认整批任务作用域内的重复审批，不绕过节目候选、顺播、版权、时间冲突、`MutationPolicy` 或正式写入校验；独立删除、局部敏感操作及首次空播单编排继续使用各自原有门禁。LLM 只能读取运行时解析后的授权摘要，不能自行签发或扩权。
