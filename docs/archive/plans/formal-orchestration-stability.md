# 第 5 阶段执行卡：长流程稳定性与恢复

## 1. 阶段校准

旧路线中的双路径收口、`taskKind` 迁回 LLM、真 ReAct、逐轮 checkpoint、服务端 session 持久化和 UI 停止按钮已在第四阶段完成。第五阶段不重复建设，收敛为三个宏任务：

- A：可解释、幂等的长流程上下文压缩。
- B：基于服务端 checkpoint 的跨请求恢复与重复执行保护。
- C：真实 LLM 长程稳定性评估、SSE/POST 双路径回放和浏览器验收。

## 2. 约束

- 压缩保留任务目标、最近两轮原始 observation、全部已决动作摘要和失败原因。
- 压缩不理解用户、不改写 action、不生成新的业务事实。
- 相同 checkpoint 输入必须产生完全相同的压缩结果，允许稳定 replay。
- 恢复不得自动回滚、自动续跑或重复执行已完成 action。
- 不引入子 agent；继续复用 `FormalOrchestrationCapability`、`FormalOrchestrationRuntime`、服务端 session 与 `FormalPlaylistWriteAdapter`。

## 3. 宏任务进度

- 宏任务 A（上下文压缩）：完成。新增纯函数 compactor；decider prompt `v1.4` 只接收 `compactedHistory` 与运行时解析的最小任务级 Grant 摘要，并要求下一批原子动作显式携带 `mutationPolicy`；checkpoint 和服务端 replay 保存压缩前后 trace；聚焦测试、类型检查、`agent:check` 与生产构建均已通过。
- 宏任务 B（跨请求恢复幂等）：完成。新增结构化恢复协议与 HTTP client/server 端口；session/replay 持久化原始 request、workspace、版本和 checkpoint；恢复保持原 `runId`，半批次按稳定 action key 跳过已完成动作；瞬时 LLM transport 故障在同一 stage deadline 内有限重试，退避监听 `AbortSignal`。用户主动停止后仍必须显式继续，不回滚已完成写入。
- 宏任务 C（真实稳定性验收）：完成。正式 ReAct SSE path A + POST path B、断流去重回放、服务端进度分支与失败 outcome 已通过聚焦 case；Goal 37/38 通过。严格真实 LLM 已通过多轮 pending 与多轮 ReAct decide；in-app browser 已观察到 5s 停止入口和真实 ReAct 第 1 轮事件。当前外部模型网络波动或 act/decide 失败时，页面会保留 checkpoint 并显示结构化可恢复失败；正式 ReAct 返回 HTTP 200 + `failed` outcome，不再抛 HTTP 500 或映射成 completed。Planner prompt `v1.6` 禁止首批 `research_check` 使用空查询条件，并要求正式编排动作携带完整 `reactTask`；生产入口不再回退旧 `Orchestrator`。

第五阶段当前完成度按三个宏任务计为 **3/3 完成**。进入下一阶段前仍需持续抽样真实成功路径，但网络波动只影响当次体验，不再破坏失败语义或现场。

## 4. 宏任务 B 执行卡（5.2）

1. 问题：服务端已经逐轮保存 checkpoint，但跨请求只能重新提交自然语言，缺少正式恢复协议、版本校验和半批次重复执行保护。
2. 期望：瞬时网络或 LLM 故障可在统一 deadline 内有限重试；跨请求恢复保留原 run/checkpoint 上下文；用户主动停止后必须明确选择继续、重试、缩小范围或取消；已完成写入不回滚且不重复执行。
3. 前置数据：`sessionId`、`workspaceKey`、原始 orchestration request、正式播单版本、最后 checkpoint、上下文压缩 trace、已完成 action 幂等标识。
4. 风险：跨工作区复用现场、播单人工修改后继续旧计划、半批次 action 重复写入、恢复时丢失上一轮拒绝原因、旧 `Orchestrator` 被静默调用。
5. 验证方式：`formal-react-resume-requires-explicit-user-action`、`formal-react-resume-rejects-workspace-mismatch`、`formal-react-resume-rejects-playlist-version-conflict`、`formal-react-resume-skips-completed-idempotency-keys`、`formal-react-resume-preserves-last-rejection-evidence`，以及 `FormalOrchestrationRuntime`/`AgentServerRuntime` 集成测试和 `npm run agent:check`。

Codex 对齐审查：恢复是“保留现场并显式继续”，不是事务回滚。传输层瞬时异常允许受 deadline 约束的有限重试；当 LLM 仍无法 decide 或用户主动停止时，运行时停在最后 checkpoint 并暴露结构化恢复动作，不以本地规则假装理解，也不自动续跑。

## 5. 宏任务 C 执行卡（5.3）

1. 问题：普通指令已有 SSE + POST 双路径，但正式 ReAct HTTP 入口曾只等待 POST；真实 LLM 评估也曾缺少 observation 后再次 decide 与 formal rebuild 确认轮覆盖。
2. 期望：正式长流程实时推送任务规划、查节目库、候选决策和 checkpoint；SSE 断流后 POST envelope 按事件 id 补全且不重复；真实 LLM 完成至少一条多轮 ReAct decide；浏览器验证停止后现场保留和显式恢复。
3. 前置数据：持久化 session、结构化 `reactTask`、正式播单与 workspace、可用 LLM 配置、SSE `EventSource`。
4. 风险：历史事件被当作当前 live 事件、SSE/POST 重复气泡、断流丢 checkpoint、浏览器 mock 被误当真实 LLM、恢复绕回旧 Orchestrator。
5. 验证方式：`formal-react-sse-live-progress-with-post-replay`、`formal-react-sse-disconnect-dedupes-post-replay`、`formal-react-server-progress-branches`、`formal-react-server-failure-envelope`、`formal-react-http-failed-outcome`、`formal-react-real-llm-multi-turn-decide`，以及 Goal 37/38 停止恢复场景、`npm run agent:check` 和生产构建。

Codex 对齐审查：SSE 是任务事件的实时投影，POST/replay 是同一服务端 checkpoint 事实的补偿读取；断流不改变 action 状态，也不触发重跑。真实 LLM 只负责 decide，自恢复、去重与版本保护仍是确定性运行时职责。
