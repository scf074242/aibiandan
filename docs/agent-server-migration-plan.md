# AI编审助手服务端化迁移方案

## 目标

把当前运行在真实前台路径里的 AI编审助手，逐步迁移为可部署、可审计、可被前台和外部访问方共同调用的正式 Agent 服务。

迁移不是重写产品体验。现有 `ChatPanel / broadcast-plan` 仍然是第一客户端，已有的 ReAct、素材查证、pending、批量执行、失败恢复和草案/正式播单隔离规则必须保持。

迁移也要改善前台性能和稳定性。前台不应长期承载 LLM prompt 组织、长程任务循环、素材查证、批量执行和写入审计这些重活；服务端化后，浏览器主要负责展示、输入和少量页面状态同步，耗时任务通过事件流或任务状态逐步返回。

## 当前边界

当前能力已经在前台路径中形成：

- `ChatPanel` 负责用户输入、消息展示、pending 面板、上传草案、确认/取消/继续。
- `schedulingAgentRuntimeFacade` 承接正式前台运行入口。
- `agentPlanner` 和 intent interpreter 负责 LLM-first 理解。
- `reactTaskRuntime` 保存 ReAct 任务的轮次、观察和失败恢复状态。
- `demoRuntimeFacade` 内仍承载大量实际业务运行逻辑，需要逐步拆出。
- `atomicCapabilities` 负责前台原子读写和批量替换。
- `broadcast-plan` 页面负责播单工作区、草案展示、正式编排 runtime 和页面状态同步。

主要技术债是：LLM 调用、任务状态、素材查证、pending 状态和正式写入裁决仍大量留在前台进程里，不适合多人访问、稳定审计和服务端密钥保护。

## 目标架构

### 前台

前台只保留用户体验和本地页面状态适配：

- 展示 AI编审助手对话。
- 展示 pending、候选选择、任务进度和错误恢复建议。
- 展示当前工作区、版面草案和正式播单。
- 把用户输入、确认、取消、继续、上传草案等事件发送给 Agent API。
- 接收服务端事件流，更新消息、任务状态、草案和播单。

前台不再直接持有 API key，不直接组织完整 prompt，不直接执行长程 ReAct loop。

性能目标是让前台更轻：不要把新的大模型调用、批量循环、素材库扫描或正式写入重试继续堆到浏览器里；这些能力迁移后应由服务端异步推进，前台只接收摘要、进度和最终 patch。

### Agent 服务端

服务端成为正式 Agent runtime：

- 构建业务上下文包。
- 调用 LLM。
- 运行 ReAct 的 Plan / Act / Observe / Decide 循环。
- 执行素材查证和候选验证。
- 编译 LLM taskPlan 为受控原子命令。
- 管理 pending、确认、取消、继续和失败恢复。
- 执行正式播单写入前的本地业务裁决。
- 记录任务事件、执行证据和审计日志。

### 数据层

服务端需要持久化：

- `AgentSession`：一次对话或一个工作区会话。
- `WorkspaceRef`：当前播单工作区，包含播单类型、频道、日期、轮播目标时长。
- `LayoutDraftSnapshot`：当前激活草案及其来源、完整度、版本。
- `FormalPlaylistSnapshot`：正式播单快照和变更版本。
- `PendingReview`：待确认操作，包含过期规则和工作区绑定。
- `ReactTaskRun`：长程任务状态、轮次、观察、失败和恢复信息。
- `AtomicCommandRun`：原子命令或批量步骤的执行记录。
- `MaterialEvidence`：素材查证请求、候选、缺口和最终选择证据。

## API 设计

### 对话入口

`POST /api/agent/sessions`

创建或恢复一个工作区会话。

`POST /api/agent/sessions/:sessionId/messages`

提交自然语言、快捷操作或用户确认。

请求核心字段：

- `workspace`
- `userInput`
- `inputSource`
- `visibleHistory`
- `foregroundStateVersion`

响应核心字段：

- `assistantMessage`
- `systemEvents`
- `pendingReview`
- `layoutDraftPatch`
- `playlistPatch`
- `activeTask`
- `nextActions`

### pending

`POST /api/agent/sessions/:sessionId/pending/:pendingId/confirm`

确认待执行操作。

`POST /api/agent/sessions/:sessionId/pending/:pendingId/cancel`

取消待执行操作。

### 长程任务

`POST /api/agent/sessions/:sessionId/tasks/:taskId/continue`

继续当前 ReAct 或批量任务。

`POST /api/agent/sessions/:sessionId/tasks/:taskId/stop`

停止当前任务。

`GET /api/agent/sessions/:sessionId/events`

使用 SSE 返回任务进度、素材查证结果、pending 状态和正式写入结果。

## 迁移阶段

### 阶段 1：协议冻结

目标是先把前后台合同稳定下来，不移动大量逻辑。

- 抽出 `RuntimeDecision`、`PendingReview`、`ReactTaskRun`、`LayoutDraftPatch`、`PlaylistPatch` 的共享类型。
- 前台只通过一个 `AgentRuntimeClient` 调用当前本地 facade。
- 给现有前台回归增加“协议级事件”断言。
- 保持 19 条真实前台浏览器场景通过。

完成标志：

- `ChatPanel` 不直接依赖具体 runtime 实现，只依赖 runtime client 接口。
- 本地实现仍可运行，但已经像调用服务端一样调用。

### 阶段 2：LLM 与上下文迁移

目标是保护 key，并让 prompt/context 在服务端统一。

- LLM 配置和 API key 移到服务端。
- 前台只传业务状态摘要和可见历史，不传密钥。
- 服务端生成 LLM prompt、上下文包和结构化返回校验。
- 保留浏览器 mock 和协议测试，避免真实 LLM 波动影响主回归。

完成标志：

- 前台没有可见 API key。
- LLM-first 仍然成立，pending 快捷确认之外不回退到本地关键词分类器。

### 阶段 3：ReAct runtime 迁移

目标是让长程任务状态成为服务端正式任务。

- `ReactTaskRun` 由服务端创建、更新和恢复。
- 每轮 ReAct 有明确的 `plan -> act -> observe -> decide` 事件。
- 素材查证、候选验证和失败自修在服务端运行。
- 前台通过事件流展示“我先查素材”“还缺什么”“是否更新草案”。

完成标志：

- 刷新页面后，当前任务仍能恢复。
- 模型超时、素材查不到、返回格式不完整，都能继续或停止。

### 阶段 4：正式播单写入迁移

目标是服务端成为正式写入裁决方。

- 原子命令执行器迁到服务端。
- 批量删除、替换、移动、插入由服务端分批执行。
- 服务端控制批量上限、幂等 key、版本检查和失败恢复。
- 前台接收 `playlistPatch` 更新页面，不直接推断最终结果。

完成标志：

- 正式写入前必须校验播单版本。
- 批量失败能返回已完成、未完成、失败原因和下一步动作。
- 草案更新和正式播单写入仍保持隔离。

### 阶段 5：可访问部署

目标是让其他人可以访问体验，同时不暴露密钥和内部状态。

- 部署 Agent 服务和前台站点。
- 提供匿名体验入口和固定演示数据。
- 会话隔离，避免不同用户互相影响。
- 增加速率限制、日志脱敏和任务超时。
- 外部访问方只调用标准 API，不直接耦合前台内部组件。

完成标志：

- 无账号也能访问受控体验环境。
- 生产 key 不出现在浏览器。
- 每个会话有独立工作区和任务状态。

## 关键业务规则

服务端迁移必须保持这些规则：

- 电视播单是时间格子里的编排。
- 轮播单是内容队列里的编排。
- 轮播整体编排必须有草案，原子操作可以不依赖草案。
- 草案和正式播单默认独立。
- 只有用户确认进入正式编排，才写正式播单。
- 完全重编、批量删除、批量替换、批量移动必须 pending。
- pending 绑定当前工作区；用户换话题时旧 pending 失效。
- 多候选不自动替用户选择。
- 电视顺播/期数过滤后唯一可用候选可以直接排，并用人话说明理由。
- OpenClaw 只是未来外部访问方，不是当前测试或实现阻塞条件。

## 风险和控制

- 风险：前后台状态双写导致播单不一致。
  控制：引入 `foregroundStateVersion` 和服务端写入版本校验。

- 风险：服务端化后前台体验变慢。
  控制：SSE 流式输出任务事件，主回复先返回，长程任务持续更新。

- 风险：迁移时又出现本地分类器绕过 LLM。
  控制：协议测试要求开放自然语言进入 LLM planner，只有 pending/安全门禁可本地快速处理。

- 风险：真实 LLM 波动导致回归不稳定。
  控制：确定性 mock 覆盖主路径，真实 LLM 做抽样评估。

- 风险：服务端任务无限循环。
  控制：每个 task 有 `maxTurns`、`batchSize`、超时和失败次数上限。

## 验收方式

每个迁移阶段都必须保持：

- 真实前台浏览器回归通过。
- agent 单测通过。
- build 通过。
- 覆盖矩阵说明新增能力和剩余缺口。
- 不清空本地 LLM 配置和 API key。
- 不把 OpenClaw 作为阻塞条件。

阶段 4 以后需要新增：

- 服务端 API 合同测试。
- SSE 事件流测试。
- 会话恢复测试。
- 并发会话隔离测试。
- 写入幂等和版本冲突测试。

## 推荐下一步

下一目标不直接大搬迁，而是先做“协议冻结”：

1. 新增 `AgentRuntimeClient` 接口。
2. 让 `ChatPanel` 只调用接口，不直接关心本地 facade。
3. 把当前本地 facade 包成 `LocalAgentRuntimeClient`。
4. 用现有 19 条浏览器场景证明体验不变。
5. 再开始把 LLM/context/ReAct 逐步迁到服务端实现。

## 阶段 1 落地记录

当前第一步迁移已经开始落地：

- 前台新增 `AgentRuntimeClient` 边界，`ChatPanel` 不再直接依赖具体 runtime facade。
- 当前默认实现是 `LocalAgentRuntimeClient`，仍包裹现有本地 runtime，保证前台体验不变。
- 新增 `scripts/agent-server.mjs` 作为 Agent 服务端常驻进程骨架，先提供健康检查和迁移状态接口。
- 新增启动脚本：
  - `npm run dev:agent`：本机启动前台和 Agent 服务。
  - `npm run dev:lan`：绑定 `0.0.0.0`，用于办公网试用。
  - `npm run agent:server`：单独启动 Agent 服务。
  - `npm run agent:server:lan`：办公网方式单独启动 Agent 服务。

这个阶段不迁移业务执行逻辑，只先固定前后台协议边界。下一步才适合把 LLM 配置、prompt/context、ReAct task runtime 从本地 client 后面逐步移动到真正的 HTTP runtime。

## 阶段 2 / 阶段 3 落地记录

当前已开始把 LLM/context 和 ReAct runtime 往 Agent 服务端迁移：

- 新增 `AgentServerRuntime`，服务端收到用户输入后会重新构建 `ForegroundAgentContextPackage`，不再只依赖前台传入的上下文包。
- 新增 `AgentServerSessionStore`，服务端会保存会话、最近上下文、pending 状态、ReAct task run 和事件日志。
- `scripts/agent-server.mjs` 已从健康检查骨架升级为 Agent API 入口：
  - `POST /api/agent/sessions`
  - `POST /api/agent/submit`
  - `POST /api/agent/sessions/:sessionId/messages`
  - `POST /api/agent/pending/execute`
  - `POST /api/agent/pending/target-selection`
  - `POST /api/agent/pending/insert-recommendation`
  - `POST /api/agent/sessions/:sessionId/tasks/:taskId/continue`
  - `POST /api/agent/sessions/:sessionId/tasks/:taskId/stop`
  - `GET /api/agent/sessions/:sessionId/events`
- 新增 `HttpAgentRuntimeClient`，前台可以通过 `VITE_AGENT_RUNTIME_MODE=http` 切到服务端 runtime；默认仍是本地 runtime，便于回归和渐进迁移。
- HTTP runtime 模式下，前台不会把本地构建的 `foregroundContextPackage` 上传为决策依据；服务端 session 会重新构建上下文。
- HTTP runtime 模式会把 `sessionId` 存入浏览器 `sessionStorage`，刷新页面后仍能接回同一个服务端会话和 ReAct task 状态。
- LLM 配置读取已兼容 Node 服务端环境，服务端可通过 `CODE_PLAN_LLM_API_KEY` / `AGENT_LLM_API_KEY` 等环境变量读取密钥。
- HTTP runtime 模式下，前台 LLM 配置面板不再显示或保存 API Key，只提示由服务端管理。

这一步仍不迁移正式播单写入执行器。正式写入、批量幂等、版本冲突和失败恢复属于阶段 4。

## 阶段 4 边界落地记录

当前已开始把正式播单写入迁移到 Agent 服务端边界。这里的“落地”指服务端写入入口、协议和审计边界已经可用，不表示旧原子命令执行器已经全部迁到服务端数据层：

- 新增 `FormalPlaylistWriteAdapter`，服务端 pending 确认会先进入正式写入边界，再委托现有 `executePendingCommand` 执行。
- 这一步是迁移外壳，不重写原子命令、候选选择、批量移动、顺播、校验等既有业务逻辑。
- 这一步不会立刻带来明显页面加速，但它把重复确认防重、写入审计和后续批量恢复从前台路径外移，为后续服务端异步执行打基础。
- 写入边界已经支持：
  - 幂等 key：同一会话内重复确认同一写入，不会再次调用原执行器。
  - 播单版本检查：如果服务端已知版本和前台期望版本不一致，会阻断写入并要求刷新后重新确认。
  - 批量元数据：批量命令会把命令数量、已完成数量、剩余数量、下一步位置记录到 `details.formalWrite`，用于后续失败恢复。
  - 审计事件：服务端 session event 会记录本次正式写入边界、结果和错误。
- 当前前台默认仍不发送版本号，因此旧本地/HTTP 体验不会因为阶段 4 第一批改动被额外阻断；版本字段接入前，行为保持和原来一致。

下一步阶段 4 的后续工作，才适合逐步接入真正的 `playlistPatch`、服务端数据层版本、跨请求批量恢复和持久化审计日志。

## Goal 42-46 连续迁移边界记录

本轮继续把阶段 4 后续和阶段 5/6 的基础边界收进正式 Agent 服务端。这里完成的是服务端状态、事件、证据、健康检查等“迁移地基”，不是完整商用服务端化收尾：

### Goal 42：正式播单状态与 Patch 同步

- 服务端 session 会从每轮 `currentSchedule` 生成正式播单快照和稳定版本号。
- pending 确认写入时，`FormalPlaylistWriteAdapter` 会读取服务端已知快照。
- 写入成功后，如果旧执行器返回的信息足够，服务端会生成 `scheduleSnapshot` 和 `playlistPatch`。
- 当前前台仍保持旧刷新逻辑；这些字段先作为服务端协议和审计证据，不强迫页面马上改用 patch。

### Goal 43：服务端事件流与长程任务进度

- session store 支持事件订阅。
- SSE 端点继续支持一次性读取已有事件。
- 新增 `GET /api/agent/sessions/:sessionId/events?follow=1`，用于保持连接并持续推送后续事件。
- 新增 `formal_write`、`material_evidence`、`task_progress` 等事件类型，为长程任务进度和素材查证准备统一通道。

### Goal 44：批量正式写入与失败恢复

- 写入边界已有批量元数据：命令数量、已完成数量、剩余数量、下一步位置。
- 新增可选 `maxBatchCommands`，只有调用方显式传入时才会在写入前阻断超大批量。
- 默认前台不传该字段，因此不会改变现有批量命令行为。
- 后续真正分批执行时，应复用这个协议，而不是在前台新增批量循环。

### Goal 45：素材查证与候选证据服务端化

- session store 新增 `materialEvidence`。
- ReAct 的 `asset_search` observation 会进入素材证据事件。
- runtime feedback 中如果带 `materialEvidence`，服务端也会记录成统一证据。
- 草案候选数、素材查证结果和缺口后续应从这些证据来，而不是前台临时展示不可靠数字。

### Goal 46：部署与办公网试用稳定化

- 新增 `npm run agent:health`，检查 Agent Server `/health` 和 `/api/agent/status`。
- 新增 `docs/agent-deployment-runbook.md`，说明本机启动、办公网试用、健康检查、长期运行和性能迁移方向。
- `/api/agent/status` 已更新为阶段 4-6 的职责说明：正式播单状态、事件流、服务端 session。

这些改动仍然遵守迁移原则：旧原子命令执行器、候选选择、顺播规则、草案/正式播单隔离和前台展示路径不重写，只把服务端协议和状态边界补齐。

### 还不能算完整迁移完成的部分

- 旧原子命令执行器仍被复用，还没有完全迁到服务端数据层。
- session 仍是内存态，还没有接数据库持久化。
- 批量失败恢复已有协议元数据，但还不是跨进程、跨重启的完整恢复。
- 素材查证证据已进入 session event，但真实素材库服务、质量校验和异步查证还需要继续迁移。
- 办公网试用脚本和说明已具备，长期商用部署仍需要进程托管、日志脱敏、限流、会话隔离强化和真实环境配置。

## Goal 47：服务端权威状态闭环记录

Goal 47 把前一阶段的协议边界推进成一个真正的正式播单状态闭环：

- 前台确认 pending 写入时，会带上当前正式播单快照和稳定版本号。
- 服务端优先使用 session 中保存的正式播单版本做写入前检查；如果前台版本和服务端版本不一致，会阻断写入。
- 如果服务端 session 因刷新或恢复缺少快照，可以使用前台随确认请求带来的 `currentSchedule` 初始化本轮已知快照。
- 写入成功后，服务端返回 `scheduleSnapshot` / `playlistPatch`。
- 前台 `ChatPanel` 成功执行后优先消费服务端 `scheduleSnapshot.items`，再通过既有 `scheduleUpdated` 事件刷新 `broadcast-plan` 左侧正式播单。
- 本地 runtime 和旧原子命令执行器仍保持兼容；新增字段只是可选迁移协议，不改变旧业务规则。

这个阶段完成后，迁移进度可以从“服务端边界已成型”提升为“正式播单写入已有服务端状态闭环”。整体迁移进度评估约 68%-70%。

仍未完成的后续大块：

- 旧原子命令执行器还没有彻底迁到服务端数据层。
- session、快照、事件和素材证据仍是内存态，还需要持久化。
- 批量任务恢复仍是协议和单进程状态，尚未成为跨进程、跨重启的任务队列。
- 素材查证需要接真实素材库服务、质量校验和异步查证。
- 商用部署还需要进程托管、日志脱敏、限流、会话隔离、权限和监控。

## Goal 48：巡检问题修复与服务端持久化迁移

Goal 48 不只是修前台体验问题，也把“服务端真正执行、前台只展示和确认”的迁移目标继续往前推一段。

来自每周编排 Agent 体验巡检的确认问题：

- 无 API Key 时，真实前台仍允许用户发起编排，随后才失败为通用模型错误。
- 切换电视播单到轮播单后，右侧 ChatPanel 默认混杂旧工作区消息。
- 服务端 session、正式播单快照、事件和素材证据仍是内存态，不利于长期试用和跨重启恢复。

本阶段修复和迁移边界：

- 前台在真正提交开放自然语言给 LLM 之前做 readiness 检查；没有 API Key 时给编排员能懂的配置提示，并声明不会改草案或正式播单。
- pending 确认/取消仍按既有待确认链路执行，不因为缺 LLM 配置被误拦。
- ChatPanel 默认只展示当前播放单工作区的消息；旧工作区消息仍保存在内存历史中，但不混入当前播单对话。
- 服务端新增可选文件持久化 session store，保存 session、正式播单快照、事件和素材证据。
- `scripts/agent-server.mjs` 支持 `--session-store=...` 或 `AGENT_SESSION_STORE_FILE` 启用持久化；未配置时仍使用内存 store。
- 新增 `npm run dev:agent:persist` / `npm run dev:lan:persist`，让办公网试用可以用同一条命令启动前台和可恢复的 Agent Server。
- 旧原子命令执行器仍被复用，但正式写入入口继续经过服务端 session、版本和快照边界，前台不绕过服务端状态。
- 这一步明确纳入“旧原子执行链和持久化一起往服务端迁”：当前先做到服务端持有 session、正式播单快照、事件和素材证据，前台只展示回复、pending 和写入结果；原子执行器本体后续再迁到服务端数据层。

这个阶段完成后，迁移进度可从 68%-70% 提升到约 72%-75%。它仍不是“原子执行器完全服务端重写”，但已经把长期试用所需的会话和正式播单状态从纯内存推进到可恢复的服务端状态文件。

## Goal 49：服务端执行闭环迁移到 90%+

Goal 49 把执行归属从“前台持有 pending 和当前播单，再调用共享执行器”继续推到“服务端持有 pending、正式播单快照和执行准据，前台只展示和确认”。

本阶段完成的服务端化边界：

- `npm run dev:agent` / `npm run dev:lan` 默认使用 HTTP Agent Server runtime；普通 `npm run dev` 仍保留本地开发模式。
- Agent Server 会给 `pending_command` 和 `pending_atomic_context` 分配 `server_pending_*` id，并保存到 session。
- HTTP 前台确认执行时只提交 `pendingId`、版本信息和用户选择结果，不再把完整 `pendingCommand` 或 `currentSchedule` 当作执行事实发送给服务端。
- 服务端确认执行时优先读取 session 中保存的 pending 和正式播单快照，再同步到旧原子执行器执行；旧原子执行器仍被复用，但执行准据已经从前台迁到服务端。
- 服务端快照绑定工作区 key，切换电视播单/轮播单时不会误复用上一张播单的正式播单状态。
- pending、正式播单快照、工作区 key、事件和素材证据都可以通过文件 session store 跨重启恢复。
- 目标选择和插入推荐这类二阶段 pending 也支持服务端还原：前台只传选择结果，服务端从 session 还原完整待确认上下文。

仍保留的兼容边界：

- Local runtime 仍支持旧输入形态，方便单页开发和现有浏览器回归。
- 旧原子命令执行器暂未重写为独立数据库服务；它现在由服务端 write boundary 准备快照后调用。
- 前台仍展示 pending 卡片，但卡片不再是执行事实来源；服务端 session 才是。

这个阶段完成后，迁移进度评估约 90%-92%。剩余部分主要是数据库化、多用户权限隔离、真实素材库服务、审计日志、监控限流和进程托管。
