# 九阶段后真实复杂场景验收执行卡

- 基线提交：`a14383bab7b9b582ed6e86bfdd939acc1269da93`
- 状态：已完成
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
