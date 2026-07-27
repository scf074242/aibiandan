# 第 4 阶段执行卡：正式编排 ReAct 运行时

## 1. 问题

现有 `reactTaskRuntime` 能记录步骤和 observation，但不会强制在每批 act 后重新调用 LLM decide；`FormalOrchestrationCapability` 的生产执行仍包装旧 `Orchestrator`，无法证明长流程是真 ReAct。

## 2. 期望

- 长流程执行固定为 `plan -> act -> observe -> decide`，每批 observation 后必须调用一次 decider。
- `continue` 只能执行 decider 新返回的动作；`complete` 正常结束；`unable_to_decide`、decider 异常或中止立即停止。
- 每轮形成可重放 checkpoint，至少保留任务目标、轮次、已决动作摘要、原始 observation、decision 和失败原因。
- checkpoint 不负责自动回滚；已发生的业务写入保留现场，失败通过结构化结果暴露。
- action adapter 必须阻断控制动作递归、跨 workspace observation、只读 mutation 和缺失 mutationPolicy；原子 action 不允许默认回退为 formal_write。
- 首批真实端口先只接 `research_check` 与 `validate`，均使用 `preview_only` observation；候选和约束证据稳定后再接 atomic/write 端口。

## 3. 前置数据

- 用户原始目标与 workspace 上下文。
- LLM 初始 plan、`maxTurns`、`batchSize` 和停止条件。
- act 产生的真实业务 observation。
- 统一 `AgentDeadline` 与 `AbortSignal`。

## 4. 风险

- 一次性 plan 后本地串行执行，形成伪 ReAct。
- decider 失败后继续执行旧动作。
- checkpoint 丢失上一轮拒绝或失败证据。
- 中止后仍执行下一批动作。
- 重放 checkpoint 时重复执行已完成动作。

## 5. 验证方式

- `formalOrchestrationRuntime.test.ts` 覆盖继续、完成、无法决策、decider 异常和中止。
- 测试断言每批 observation 后 decider 恰好调用一次，且失败后 actor 不再执行。
- 新 case 加入 `package.json` 的 `agent:check:tests`。
- 完成接线后运行 `npm run agent:check`，再执行 Goal 37/38 浏览器门禁。

## 6. Codex 对齐

Codex 类 Agent 将模型决策与工具执行分开：模型基于工具 observation 决定下一步，运行时负责预算、中止、结构校验和状态保存。本项目沿用该边界，同时增加广电编排的候选、顺播、时间冲突与正式写入校验；不引入子 agent、自动回滚或 mutation journal。

## 7. 第四阶段宏任务进度

- 宏任务 A（生产入口切换）：实现完成。planner 的 `formal_orchestration` 控制 action 与顶层 `reactTask` 通过 `DemoRuntimeFacade -> broadcast-plan -> AgentRuntimeClient -> SchedulingAgentRuntimeFacade` 进入新 ReAct runtime；HTTP 模式调用服务端 `/api/agent/orchestration`，新路径失败不回退旧 Orchestrator。
- 宏任务 B（完整业务 action 端口）：实现完成。`research_check`、`validate`、query、`pending_only` 与 `formal_write` 均已接入；原子业务规则复用 `AtomicCommandCapability`，正式写入统一经过 `FormalPlaylistWriteAdapter`，`preview_only` 不得越过 commit 边界。
- 宏任务 C（真实验收与恢复）：完成。每轮 checkpoint 即时写入 `AgentServerSessionStore`，按 `sessionId + workspaceKey` 隔离；HTTP/local 均可停止，停止结果为 `cancelled` 且保留最后 checkpoint，replay 包可恢复现场。`npm run agent:check`、Goal 37/38 全量浏览器门禁和真实 in-app browser 冒烟均已通过第四阶段验收；真实模型超时会暴露无写入事实与重试/取消动作，等待超过 5 秒可见停止入口。

按三个宏任务计，第四阶段已完成并标记为 **100%**。旧 Orchestrator 只保留给未携带结构化 `reactTask` 的显式兼容调用方，不属于新生产链路的失败兜底；第五阶段尚未开始。
