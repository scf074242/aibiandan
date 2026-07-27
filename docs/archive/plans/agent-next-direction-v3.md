# Agent 下一步发展方向（v3 战略版）

- 作者：solution-architect
- 日期：2026-06-28
- 状态：待用户确认
- 适用范围：aibiandan agent 编排系统（电视播单 + 轮播单）
- 前置文档：
  - `docs/agent-next-direction-v2.md`（527 行，v3 的直接前置基线，下称"v2"）
  - `docs/agent-next-direction-analysis.md`（935 行，v2 的上游分析）
  - `AGENTS.md`（强制工作协议）
  - `docs/agent-development-protocol.md`（执行流程落地）
- 核对基准：本文档所有论断均以 2026-06-28 当日代码为准。已实际读取代码核对，不依赖任何 md 文档描述。

---

## 1. 执行摘要

### 1.1 v3 相对 v2 的核心调整

v2 在 3 条新约束（长流程已融入、不要回退、不要子 agent）下定义了 D1-D17 缺陷清单与 4 阶段路线图。v3 在 v2 基础上做三件事：

1. **承认 v2 阶段 1 已基本完成**，把 D1-D4 从"收尾"重定为"已完成"，把 D15 从"进行中"重定为"**stub 状态**——文件已落地但主链路未接入"。这一条修正 v2 文档对 D15 的乐观估计。
2. **新发现 5 处工程债**，不在 v2 D1-D17 清单内：`fallbackManager.ts` 已是孤儿死代码（467 行）、`systemPrompts.ts` 完全无版本号、`agent:browser:goal37` 与 `goal38` 指向同一脚本、`create.vue` 3631 行也是大文件、`schedulingAgentRuntime.commandMatrix.test.ts` 6220 行测试文件。这些是 v3 新增 P1/P2 缺陷。
3. **把"单 agent 深度"提升为战略主题**。v2 仍把方向 C（Capability 拆分）当作"为方向 D 铺垫"的过渡工作；v3 把它升格为"单 agent 能力厚度"战略主线，因为约束 3 明确不引入子 agent，意味着所有能力厚度必须由单 agent 自身完成。

### 1.2 3 条新约束带来的方向变化（再确认）

| # | 新约束 | v2 处理 | v3 调整 |
|---|---|---|---|
| 1 | 全天编排/补全/草案已融入 | v2 第 2.1 节已核实融入 | v3 再次核实：仍融入，但 `executeReactAgentPlan` 仍是伪 ReAct（`demoRuntimeFacade.ts:910-1005`），长流程"已接入 ≠ 已对齐 Design Philosophy"。这是 v3 与 v2 的关键差异。 |
| 2 | 不要回退功能 | v2 新增方向 F 清除回退 | v3 进一步发现 `fallbackManager.ts` 已是孤儿代码（无外部调用方），清除成本比 v2 估计的低；但 `atomicCapabilities.ts:658-674` `validateOrRollback` 仍被 7 处原子操作调用，是真实主链路债。 |
| 3 | 不要子 agent | v2 删除子 agent 方向 | v3 把"不引入子 agent"从"删除方向"升格为"战略主题——单 agent 能力厚度"，明确所有复杂能力拆分只通过按 intent 拆分 capability + 统一分发实现。 |

### 1.3 v3 的战略主张

**单 agent + fail loud + 可观测 + 前台闭环**——这四个词是 v3 的全部主张。

- **单 agent**：不追求多 agent 编排，所有能力厚度通过 Capability 拆分 + 统一分发 + 真 ReAct 循环完成。
- **fail loud**：所有失败统一走结构化 envelope，不回滚、不假装理解、不自动续跑。
- **可观测**：LLM 调用必须有 trace + monitor + prompt 版本，禁止"调用即丢"。
- **前台闭环**：失败可重试、候选可结构化、长流程可中断、进度可见。

v2 的 D1-D17 是这个战略主张的工程化分解；v3 重新排定优先级，把已完成的剥离、把 stub 状态的暴露、把新发现的工程债纳入。

---

## 2. 现状核对（基于 2026-06-28 代码）

### 2.1 v2 D1-D17 完成度核对

| 缺陷 ID | v2 描述 | v3 核对结论 | 代码证据 |
|---|---|---|---|
| D1 | AgentDeadline 未接入主链路 | ✅ **已完成** | `demoRuntimeFacade.ts:1832` `this.currentDeadline = new AgentDeadline()`；`llmAgentIntentInterpreter.ts:71` `interpret(input, deadline?)`；`candidateJudge.ts:52` `selectBestCandidate(input, deadline?)`；`schedulingAgentRuntime.ts:240,385` `submit(input, deadline?)`；`atomicCommandCapability.ts:4716` 透传 `runtime.deadline` 给 candidateJudge |
| D2 | MutationPolicy 未接入 write adapter | ✅ **已完成** | `formalPlaylistWriteAdapter.ts:11-15` import `assertMutationAllowed`；`formalPlaylistWriteAdapter.ts:129-146` 写屏障校验已落地；`formalPlaylistWriteAdapter.test.ts:264` 验证 `preview_only` 阻断 |
| D3 | quick reply 策略化重试未实现 | ✅ **已完成** | `ChatPanel.vue:908-951` `handleFailureQuickReply` 完整实现 `switch_strategy / broaden_target / narrow_target / resubmit` 四种策略化重试 |
| D4 | 候选推荐未结构化 | ✅ **已完成** | `src/components/dialogue/CandidateRecommendationPanel.vue` 已抽取；`ChatPanel.vue:258,276,478-480` 引用并接入 |
| D5 | 旧原子能力回退机制存在 | ⚠️ **部分缓解** | `fallbackManager.ts`（467 行）已是孤儿代码——`getFallbackManager` / `FallbackManager` grep 全仓只在自身文件内出现，无外部调用方；但 `atomicCapabilities.ts:658-674` `validateOrRollback` 仍存在，仍被 7 处原子操作调用（`atomicCapabilities.ts:196,248,303,374,448,555,623`） |
| D6 | 双路径并行 | ❌ **未变** | `useOrchestrator.ts:13,50` 仍用老 `Orchestrator`；`demoRuntimeFacade.ts` 走 `reactTaskRuntime`；`CapabilityRegistry` 只在 `schedulingAgentRuntime.ts:69` 注册，**`demoRuntimeFacade.ts` 完全不引用 `capabilityRegistry`**——意味着实际上有三套路径并行：老 Orchestrator、DemoRuntimeFacade、SchedulingAgentRuntime |
| D7 | taskKind 仍依赖本地正则 | ❌ **未变** | `demoRuntimeFacade.ts:7637,7641` `resolveFormalOrchestrationTaskKind` 仍用 `/(全天|整天|全日)/`、`/(补齐|补排|补全|补掉|填充|填满).*(全部|所有|...)/` 正则识别 `full_day / overall_refill / local_refill` |
| D8 | executeReactAgentPlan 是伪 ReAct | ❌ **未变** | `demoRuntimeFacade.ts:910-1005` `executeReactAgentPlan` 仍是：取 `firstAction`（line 932）→ `executeAgentPlan`（line 976-981）→ `recordObservation`（line 983-988）→ 返回（line 989-1004）。**单次 submit 内只执行一步**，下一轮 decide 需要用户再次发送消息触发。这是 v2 明确禁止的伪 ReAct。 |
| D9 | 老 Orchestrator.cancel() 不联动 AbortController | ❌ **未变** | `orchestrator.ts:388-394` `cancel()` 仍只设 `this.isCancelled = true`；`isCancelled` 在 `orchestrator.ts:274,276,279,352,355,476,499,531,537,1085,1098,1652` 共 12 处被轮询，但不联动 `AbortController.abort()` |
| D10 | demoRuntimeFacade.ts 单文件过大 | ❌ **恶化** | v2 记录 9872 行，v3 核对 **9914 行**（+42 行）。仍超 AGENTS.md File Hygiene 红线 5000 行近一倍。 |
| D11 | atomicCommandCapability.ts 单文件过大 | ❌ **恶化** | v2 记录 6193 行，v3 核对 **6219 行**（+26 行）。仍超红线。 |
| D12 | ChatPanel.vue 单文件过大 | ✅ **缓解** | v2 记录 5864 行，v3 核对 **5608 行**（-256 行）。CandidateRecommendationPanel 抽取有效，但仍在 5000 行红线之上。 |
| D13 | 状态模型不统一 | ❌ **未变** | draft / pending / formal 状态散落，无统一 `owner / workspaceKey / mutationId / mutationPolicy` 契约 |
| D14 | 长流程任务持久化未实现 | ❌ **未变** | `agentServerFileSessionStore.ts` grep `longRunning / persistedTask / PersistedLongRunningTask / longRunningTask` 全无匹配 |
| D15 | LLM 调用不可观测 | ⚠️ **stub 状态** | `src/services/agent/llmCallMonitor.ts`（192 行）完整实现 `record / snapshot / clear / aggregateByStage`，但 `llmClient.ts` 的 `recordRequestTrace`（`llmClient.ts:146,186,238` 三处）**只记录到旧 trace 机制，从未调用 `getLlmCallMonitor().record()`**。文件级注释（`llmCallMonitor.ts:9`）说"接入点：llmClient.ts 的 recordRequestTrace 内部"——但实际未接入。 |
| D16 | prompt 版本管理缺失 | ⚠️ **部分完成** | `candidateJudge.ts:37` `CANDIDATE_JUDGE_PROMPT_VERSION = 'v1.2'`；`llmAgentIntentInterpreter.ts:55` `INTENT_INTERPRETER_PROMPT_VERSION = 'v2.0'`；`llmClient.ts:97,154,195,214,246,261` 已支持 `promptVersion` 透传到 trace。但 `src/services/llm/prompts/systemPrompts.ts` grep `version|VERSION|v1.|v2.|prompt` **全无匹配**——system prompt 主体仍未版本化。 |
| D17 | timeout 分散 | ⚠️ **部分缓解** | D1 接入后，`llmAgentIntentInterpreter.ts` / `candidateJudge.ts` 已用 `STAGE_TIMEOUT_BUDGET`；但 `paramExtractor.ts:51,95,135,174` / `intentRecognizer.ts:43` / `layoutIntentRecognizer.ts:69` / `agentPlanner.ts:360` / `llmConfig.ts:10` / `layoutDraftService.ts:613,643` / `demoRuntimeFacade.ts:1600,3279,3456` 等处仍写死 timeout |

### 2.2 全天编排 / 全天补全 / 草案融入情况（核对约束 1，再确认）

**结论：仍融入主链路，与 v2 第 2.1 节结论一致。** 接入点行号略有变化（v2 记录的行号是 7336/7418，v3 核对 `demoRuntimeFacade.ts` 总行数从 9872 → 9914，但入口识别、taskKind 解析、mode 标签、bootstrap 门禁、ReAct 执行器、草案三件套的接入结构未变）。

**但需要补充的关键事实**：长流程"已接入"≠"已对齐 Design Philosophy"。`executeReactAgentPlan` 仍是伪 ReAct（见 2.1 D8），意味着长流程虽然在主链路被识别和触发，但执行模式仍违反 AGENTS.md"真 ReAct 循环"硬约束。这是 v3 与 v2 的关键认知差异：v2 把"已接入"当作完成态，v3 把"已接入 + 真 ReAct"才当作完成态。

### 2.3 回退相关代码现状（核对约束 2，再确认）

**v3 新发现**：`fallbackManager.ts`（467 行）已是**孤儿代码**。

- grep `getFallbackManager|FallbackManager` 全仓结果：只在 `fallbackManager.ts` 自身文件内出现 14 处，**没有任何外部调用方**。
- 这意味着 v2 第 2.2.2 节"接入主链路证据"中关于 fallbackManager 的描述已过时——三级回退机制已经事实上从主链路剥离，只剩文件本身还留着。
- 清除成本比 v2 估计的低：直接删除 `fallbackManager.ts` + 删除 `src/types/orchestration.ts:585-651` 中 `FallbackLevel / FallbackRecord / FallbackStrategyConfig` 类型即可，无需渐进式清除。

**但 `atomicCapabilities.ts:658-674` `validateOrRollback` 仍真实存在于主链路**：

- 仍被 `atomicCapabilities.ts:196,248,303,374,448,555,623` 共 7 处原子操作调用。
- 校验失败时仍调用传入的 `rollback()` 回滚本次修改，返回"已回滚本次修改"消息。
- 这是真实主链路债，仍需按 v2 方向 F 的拆分方式清除（拆为 `validate` + 删除 `rollback`）。

### 2.4 子 agent 相关代码现状（核对约束 3，再确认）

**结论：仍无任何子 agent 代码，与 v2 第 2.3 节结论一致。** grep `subAgent|SubAgent|DraftAgent|CandidateAgent|SelectionAgent|WriteAgent|ValidationAgent` 全仓无匹配。

**但 v3 发现一个新隐患**：`schedulingAgentRuntime.ts` 与 `demoRuntimeFacade.ts` 是两套独立的 runtime，各自维护 CapabilityRegistry / tryHandleAgentPlannerInstruction 分发机制。虽然技术上不是子 agent，但**两套 runtime 并行**会带来类似子 agent 的协调成本——状态同步、消息路由、停止信号联动。v3 把这个问题归入 D6 双路径并行缺陷（见 2.1 D6）。

### 2.5 v3 新发现的工程债（不在 v2 D1-D17 清单内）

| 缺陷 ID | 描述 | 代码证据 | 严重度 |
|---|---|---|---|
| D18 | `fallbackManager.ts` 孤儿死代码 | 467 行无外部调用方；`getFallbackManager` grep 全仓只在自身文件出现 | P1（清除成本低，但拖累代码可读性） |
| D19 | `systemPrompts.ts` 完全无版本号 | grep `version|VERSION|v1.|v2.|prompt` 在该文件全无匹配；与 D16 形成对比——业务 prompt 已版本化，system prompt 主体未版本化 | P1（破坏 D16 的完整性） |
| D20 | `agent:browser:goal37` 与 `goal38` 指向同一脚本 | `package.json:30,31` 两条命令都是 `node scripts/foreground-browser-goal37.mjs` | P2（goal38 入口可能丢了，或 goal38 是 goal37 的别名但未声明） |
| D21 | `create.vue` 单文件 3631 行 | `src/views/broadcast-plan/create.vue` 是 broadcast-plan 页面容器，3631 行超 2000 行红线 | P1（broadcast-plan 是前台另一入口，与 ChatPanel 并列） |
| D22 | `schedulingAgentRuntime.commandMatrix.test.ts` 6220 行 | 单测文件 6220 行，可能含大量重复 case 或全矩阵爆炸 | P2（测试可维护性差，但不阻断生产） |
| D23 | 三套 runtime 并行（不只是双路径） | 老 `Orchestrator`（`orchestrator.ts` 1514 行）+ `DemoRuntimeFacade`（9914 行）+ `SchedulingAgentRuntime`（含 `CapabilityRegistry`）三套独立 runtime，状态与分发机制互不复用 | P0（v2 只识别双路径，v3 发现是三路径，问题更严重） |

### 2.6 文件行数红线核对（2026-06-28）

| 文件 | v2 行数 | v3 行数 | 红线 | 状态 |
|---|---|---|---|---|
| `demoRuntimeFacade.ts` | 9872 | **9914** | 5000 | ❌ 恶化 |
| `atomicCommandCapability.ts` | 6193 | **6219** | 5000 | ❌ 恶化 |
| `ChatPanel.vue` | 5864 | **5608** | 5000 | ⚠️ 缓解（-256） |
| `create.vue` | 未列入 | **3631** | 2000 | ❌ v2 漏列 |
| `orchestrator.ts` | 1514 | **1514** | 2000 | ⚠️ 接近红线 |
| `schedulingAgentRuntime.commandMatrix.test.ts` | 未列入 | **6220** | 2000（测试建议） | ❌ v2 漏列 |

---

## 3. 架构缺陷清单（按严重度排序）

### 3.1 P0 缺陷（阻断战略目标）

#### D23 三套 runtime 并行（v3 新发现，最高优先级）

- **描述**：老 `Orchestrator`、`DemoRuntimeFacade`、`SchedulingAgentRuntime` 三套独立 runtime 并行存在，各自维护状态、分发机制、LLM 调用入口。v2 只识别"双路径并行"（D6），v3 发现实际是三路径。
- **涉及文件**：
  - [src/services/orchestrator.ts](file:///./src/services/orchestrator.ts)（1514 行，老 Orchestrator）
  - [src/services/runtime/demoRuntimeFacade.ts](file:///./src/services/runtime/demoRuntimeFacade.ts)（9914 行，主 facade）
  - [src/services/agent/schedulingAgentRuntime.ts](file:///./src/services/agent/schedulingAgentRuntime.ts)（含 CapabilityRegistry）
  - [src/composables/useOrchestrator.ts](file:///./src/composables/useOrchestrator.ts)（前台仍用老 Orchestrator）
- **影响**：三套路径意味着停止信号、deadline、状态、trace 各自独立，无法统一收口；任何新能力落地都要考虑三处接入；AGENTS.md"双路径并行禁止"硬约束实际已被违反为"三路径并行"。
- **建议方向**：见战略主题 1（单 agent 能力厚度）+ 工程化路线图阶段 2。

#### D8 executeReactAgentPlan 仍是伪 ReAct

- **描述**：`executeReactAgentPlan` 在单次 submit 内只执行 `firstAction` 后 `recordObservation` 返回，需要用户下一轮发送消息才能触发下一 action。这违反 AGENTS.md"真 ReAct 循环"硬约束："禁止伪 ReAct（一次性产出 plan 后串行执行不回判）"。
- **涉及文件**：[src/services/runtime/demoRuntimeFacade.ts:910-1005](file:///./src/services/runtime/demoRuntimeFacade.ts)
- **影响**：长流程任务（全天编排/整体补排）实际无法在单次提交内完成多轮 plan→act→observe→decide 闭环；用户体验上每轮都要手动发消息触发下一动作，与 Codex/Claude Code 的自主多轮执行差距大。
- **建议方向**：见战略主题 2（fail loud 工程化）+ 工程化路线图阶段 3。

#### D10 / D11 / D12 / D21 大文件红线

- **描述**：4 个文件超过 5000 行红线（`demoRuntimeFacade.ts` 9914、`atomicCommandCapability.ts` 6219、`ChatPanel.vue` 5608），1 个文件超过 2000 行红线（`create.vue` 3631）。
- **涉及文件**：
  - [src/services/runtime/demoRuntimeFacade.ts](file:///./src/services/runtime/demoRuntimeFacade.ts)
  - [src/services/agent/atomicCommandCapability.ts](file:///./src/services/agent/atomicCommandCapability.ts)
  - [src/components/dialogue/ChatPanel.vue](file:///./src/components/dialogue/ChatPanel.vue)
  - [src/views/broadcast-plan/create.vue](file:///./src/views/broadcast-plan/create.vue)
- **影响**：任何新能力堆入这 4 个文件都会继续恶化；测试覆盖与 code review 难度指数上升；AGENTS.md File Hygiene 硬约束持续被违反。
- **建议方向**：见战略主题 1 + 工程化路线图阶段 2。

#### D15 LlmCallMonitor stub 状态（v3 修正）

- **描述**：`llmCallMonitor.ts`（192 行）完整实现了 `record / snapshot / clear / aggregateByStage`，但 `llmClient.ts` 的 `recordRequestTrace` 从未调用 `getLlmCallMonitor().record()`。文件级注释声称"接入点：llmClient.ts 的 recordRequestTrace 内部"——但实际未接入。
- **涉及文件**：
  - [src/services/agent/llmCallMonitor.ts](file:///./src/services/agent/llmCallMonitor.ts)（完整实现）
  - [src/services/llm/llmClient.ts:146,186,238](file:///./src/services/llm/llmClient.ts)（recordRequestTrace 三处调用点，均未接入 monitor）
- **影响**：所有 LLM 调用仍只记录到旧 trace 机制（`tokenUsage / latencyMs / errorMessage` 散落），无法按 stage 聚合统计、无法核算成本、无法回归归因。AGENTS.md"LLM 调用监控与成本核算"硬约束实际未落地。
- **建议方向**：见战略主题 3（可观测性）+ 工程化路线图阶段 1 收尾。

#### D5 validateOrRollback 仍真实存在于主链路

- **描述**：`atomicCapabilities.ts:658-674` `validateOrRollback` 在校验失败时仍调用传入的 `rollback()` 回滚本次修改，返回"已回滚本次修改"消息。被 7 处原子操作调用。
- **涉及文件**：
  - [src/services/atomicCapabilities.ts:658-674](file:///./src/services/atomicCapabilities.ts)（validateOrRollback 实现）
  - [src/services/atomicCapabilities.ts:196,248,303,374,448,555,623](file:///./src/services/atomicCapabilities.ts)（7 处调用点）
- **影响**：直接违反 AGENTS.md"失败暴露而非回滚"硬约束；与 D1/D2 已落地的 envelope 路径形成双失败处理路径，状态污染风险高。
- **建议方向**：见战略主题 2 + 工程化路线图阶段 4。

### 3.2 P1 缺陷（不阻断但需处理）

| 缺陷 ID | 描述 | 涉及文件 | 建议方向 |
|---|---|---|---|
| D6 | 双路径（实际三路径）并行 | 见 D23 | 战略主题 1 |
| D7 | taskKind 仍依赖本地正则 | [demoRuntimeFacade.ts:7637,7641](file:///./src/services/runtime/demoRuntimeFacade.ts) | 阶段 3 |
| D9 | 老 Orchestrator.cancel() 不联动 AbortController | [orchestrator.ts:388-394](file:///./src/services/orchestrator.ts) | 阶段 3 |
| D13 | 状态模型不统一 | 状态散落在 facade if-else 链 | 阶段 4 |
| D14 | 长流程任务持久化未实现 | [agentServerFileSessionStore.ts](file:///./src/services/runtime/agentServerFileSessionStore.ts) | 阶段 3 |
| D16 | systemPrompts.ts 未版本化 | [src/services/llm/prompts/systemPrompts.ts](file:///./src/services/llm/prompts/systemPrompts.ts) | 阶段 1 收尾 |
| D17 | timeout 仍分散（部分缓解） | 见 v2 第 5.2 节 | 阶段 1 收尾 |
| D18 | fallbackManager.ts 孤儿死代码 | [src/services/fallbackManager.ts](file:///./src/services/fallbackManager.ts) | 阶段 4（直接删除） |
| D19 | systemPrompts.ts 完全无版本号 | 同 D16 | 阶段 1 收尾 |
| D21 | create.vue 3631 行 | [src/views/broadcast-plan/create.vue](file:///./src/views/broadcast-plan/create.vue) | 阶段 2 |
| D22 | commandMatrix.test.ts 6220 行 | [src/services/__tests__/schedulingAgentRuntime.commandMatrix.test.ts](file:///./src/services/__tests__/schedulingAgentRuntime.commandMatrix.test.ts) | 阶段 4 |

### 3.3 P2 缺陷（低优先）

| 缺陷 ID | 描述 | 涉及文件 | 建议方向 |
|---|---|---|---|
| D20 | agent:browser:goal37 与 goal38 指向同一脚本 | [package.json:30,31](file:///./package.json) | 阶段 1 收尾（确认是别名还是漏入口） |

### 3.4 与 v2 D1-D17 的映射

| v2 缺陷 | v3 缺陷 | 状态变化 |
|---|---|---|
| D1 AgentDeadline 未接入 | — | ✅ 已完成 |
| D2 MutationPolicy 未接入 | — | ✅ 已完成 |
| D3 quick reply 策略化 | — | ✅ 已完成 |
| D4 候选推荐未结构化 | — | ✅ 已完成 |
| D5 旧原子能力回退机制 | D5（部分缓解） | fallbackManager 孤儿化，validateOrRollback 仍存在 |
| D6 双路径并行 | D6 + D23（三路径） | ❌ 恶化（发现是三路径） |
| D7 taskKind 本地正则 | D7 | ❌ 未变 |
| D8 伪 ReAct | D8 | ❌ 未变 |
| D9 Orchestrator.cancel 不联动 | D9 | ❌ 未变 |
| D10 demoRuntimeFacade 过大 | D10 | ❌ 恶化（9872 → 9914） |
| D11 atomicCommandCapability 过大 | D11 | ❌ 恶化（6193 → 6219） |
| D12 ChatPanel.vue 过大 | D12 | ✅ 缓解（5864 → 5608） |
| D13 状态模型不统一 | D13 | ❌ 未变 |
| D14 长流程任务持久化 | D14 | ❌ 未变 |
| D15 LLM 调用不可观测 | D15（stub） | ⚠️ 文件已落地但未接入 |
| D16 prompt 版本管理 | D16 + D19 | ⚠️ 业务 prompt 已版本化，system prompt 未版本化 |
| D17 timeout 分散 | D17 | ⚠️ 部分缓解 |
| —（新发现） | D18 fallbackManager 孤儿 | v2 误判为接入主链路 |
| —（新发现） | D19 systemPrompts 无版本 | v2 漏列 |
| —（新发现） | D20 browser goal 入口 | v2 漏列 |
| —（新发现） | D21 create.vue 过大 | v2 漏列 |
| —（新发现） | D22 commandMatrix 测试过大 | v2 漏列 |
| —（新发现） | D23 三路径并行 | v2 误判为双路径 |

---

## 4. 成熟 agent 模式映射

用户明确说"设计上参考现有成熟 agent 已经足以满足需求"。本节提取 Codex / Claude Code / Cursor / Devin 的成熟模式，映射到本项目。

### 4.1 上下文管理

| 模式 | 来源 | 本项目应用 |
|---|---|---|
| 上下文压缩：保留最近 N 轮原 observation + 任务目标 + 已决动作摘要 + 失败原因 | Claude Code（长上下文管理）、Codex（compaction） | 长流程 ReAct 循环必须实现 `ContextCompressor`：每轮 act 后压缩 observation，保留"上一轮为何被拒绝"的关键证据；压缩必须幂等可重放。本项目上下文规模不到 Claude Code 量级，N=5 足够。 |
| 上下文 fingerprint 防污染 | Codex（session 隔离） | 本项目已有 `src/services/agent/contextFingerprint.ts`，需确认在长流程多轮续接时仍生效——`workspaceKey` 必须每轮一致，切换播单时上下文必须清空。 |
| 工具调用结果保留原始 + 摘要双轨 | Claude Code（tool result + summary） | 候选检索结果在 trace 中保留原始候选列表 + LLM 摘要（`candidateEvidence`），便于回归归因。 |

### 4.2 工具调用与确定性校验

| 模式 | 来源 | 本项目应用 |
|---|---|---|
| 工具调用前 schema 校验 + 后结果校验 | Codex（function calling schema） | `agentPlanner.ts` 的 action 必须有 schema；`assertMutationAllowed`（已落地）是写入前校验；候选决策后 `assertTaskKindFromLlm` 应是结构校验（v3 阶段 3 落地）。 |
| 工具调用结果保护：本地不替 LLM 改写意图 | Codex（local doesn't rewrite intent） | 已对齐 AGENTS.md Implementation Rules；`assertTaskKindFromLlm` 只做结构校验与失败暴露，不做正则兜底（v3 阶段 3 强化）。 |
| 确定性逻辑只在模型返回后或写入前 | Codex | 已对齐 AGENTS.md；`MutationPolicy` / `AgentDeadline` / `assertMutationAllowed` 都是保护结果。 |

### 4.3 失败处理

| 模式 | 来源 | 本项目应用 |
|---|---|---|
| 结构化失败 envelope + quick replies | Codex（recoverable error） | D3 已落地 `switch_strategy / broaden_target / narrow_target / resubmit`；D5 清除后所有失败统一走 envelope。 |
| 失败暴露而非回滚 | Codex（fail loud） | AGENTS.md 已对齐；D5 清除 `validateOrRollback` 后完全对齐。 |
| 不假装理解 + 不自动续跑 | Codex | `RecoverableInterpretationFailure` envelope 已对齐；伪 ReAct（D8）违反此原则——act 后不回判 LLM 等于"假装继续"。 |
| 失败时暴露已完成数量 + 剩余 + 可恢复动作 | Codex（batch failure） | 长流程批量写入失败时必须返回 `已完成数量 / 本批是否写入 / 剩余数量 / 可恢复动作`（AGENTS.md ReAct 长流程边界已约束）。 |

### 4.4 用户体验

| 模式 | 来源 | 本项目应用 |
|---|---|---|
| 进度流 + 当前步骤 + 已处理/剩余 | Cursor（progress stream）、Claude Code（tool progress） | `LongRunningProgress.vue` 待抽取（v2 已规划，v3 阶段 3 落地）；展示 `当前批次索引 / 总批次数 / 已处理条目数 / 剩余条目数 / 当前 stage`。 |
| 停止按钮立即中止 LLM 调用 | Codex（abort） | D9 待修复：老 `Orchestrator.cancel()` 改为调用 `AgentDeadline.abort()`，`AbortSignal` 联动到 LLM 调用与 fetch 请求。 |
| 候选推荐结构化 card + 匹配分数 + "为什么是它" | Cursor（inline suggestion card） | D4 已抽取 `CandidateRecommendationPanel.vue`；v3 阶段 1 收尾完善 `whyThisOne / reasonTags / confidence` 字段。 |
| 草案 diff 面板 + 时间冲突预警 | Claude Code（diff view） | `DraftDiffPanel.vue` 待抽取（v2 已规划，v3 阶段 4 落地）。 |
| 流式输出 + 批量回放双路径 | Codex（streaming + batch） | 已对齐（path A 流式 + path B 批量回放，`agentRuntimeClient.ts`）。 |
| 确认门：危险操作前必须确认 | Claude Code（confirmation gate） | 已对齐 AGENTS.md Atomic Command Policy（删除始终确认）。 |

### 4.5 可观测性

| 模式 | 来源 | 本项目应用 |
|---|---|---|
| LLM 调用 trace + monitor + cost | LangSmith（trace + metrics）、Codex（call log） | D15 待接入：`llmClient.ts:recordRequestTrace` 内部调用 `getLlmCallMonitor().record()`，记录 `stage / model / tokenUsage / latencyMs / status / promptVersion`。 |
| Prompt 版本号透传到 trace | LangSmith（prompt versioning） | D16 部分完成：业务 prompt 已版本化，`systemPrompts.ts` 待版本化（D19）。 |
| 错误监控上报（脱敏） | Sentry（error report） | `ErrorMonitor.report` 待实现（v2 方向 E）；仅上报 `kind / traceId / noMutation`，不上报用户原始输入。 |
| 真实 LLM 评估基线 | Codex（eval harness） | `agent:eval:llm` 入口已存在；v3 阶段 3 建立 taskKind 返回准确率、envelope 触发率、quick reply 采用率基线。 |

### 4.6 单 agent 深度（不引入子 agent 时的能力厚度保证）

| 模式 | 来源 | 本项目应用 |
|---|---|---|
| 按 intent 拆分 capability + 统一分发 | Codex（command dispatch）、Claude Code（tool registry） | D10/D11 拆分：`atomicCommandCapability.ts` 拆为 `moveCapability.ts / insertCapability.ts / replaceCapability.ts / deleteCapability.ts / batchMoveCapability.ts / batchDeleteCapability.ts / queryCapability.ts / validateCapability.ts`，统一注册到 `CapabilityRegistry`。 |
| 真 ReAct 自主多轮 | Claude Code（agentic loop） | D8 修复：`executeReactAgentPlan` 改为单次 submit 内 plan→act→observe→decide 循环，`maxTurns=4` 上限。 |
| 有限轮次防失控 | Claude Code（max turns） | 已对齐 `reactTaskTypes.ts:72-74` `maxTurns=4`。 |
| Plan/Act 分离 | Claude Code（plan + act） | 已对齐 `AgentPlanner.plan` + `executeAgentPlan`。 |
| capability metadata（supportedIntents / requiredSources / safetyGates） | Trae（skill metadata） | v3 阶段 2 落地 `CapabilityMetadata`，让 `CapabilityRegistry.resolveAll` 能基于 metadata 路由。 |

---

## 5. 战略方向

v3 把战略主张收敛为 4 个主题，每个主题含目标与原则。

### 5.1 战略主题 1：单 agent 能力厚度

**目标**：在不引入子 agent 的前提下，通过 Capability 拆分 + 统一分发 + 真 ReAct 循环，让单 agent 能承接从原子命令到全天编排的全谱需求。

**原则**：
1. **三路径收口为单路径**：老 `Orchestrator` / `DemoRuntimeFacade` / `SchedulingAgentRuntime` 三套 runtime 必须收口为单一 runtime（推荐 `SchedulingAgentRuntime` 作为正式入口，`DemoRuntimeFacade` 作为过渡桥接，老 `Orchestrator` 废弃）。收口不是重写，是渐进式迁移——先把 `useOrchestrator.ts` 改为调用 `SchedulingAgentRuntime`，再把 `DemoRuntimeFacade` 的长流程逻辑迁入 `FormalOrchestrationCapability`。
2. **按 intent 拆分而非按层拆分**：`atomicCommandCapability.ts` 拆分按 intent（move/insert/replace/delete/batchMove/batchDelete/query/validate）而非按层（parser/executor/validator）。每个子 capability 自包含 parser + executor + validator，注册到 `CapabilityRegistry`。
3. **`CapabilityRegistry` 是唯一分发入口**：`tryHandleAgentPlannerInstruction` 的 if-else 链改为 `CapabilityRegistry.resolveAll` 统一路由；`capability_route_conflict` 必须在所有路径生效。
4. **`CapabilityMetadata` 声明能力边界**：每个 capability 声明 `supportedIntents / requiredSources / safetyGates`，借鉴 Trae skill 协议，让路由可解释。
5. **新增能力位置约束**：新增 agent 长程业务能力必须落在 `schedulingAgentRuntimeFacade / reactTaskRuntime / AgentServerRuntime / AgentServerSessionStore / HttpAgentRuntimeClient / FormalPlaylistWriteAdapter`，禁止堆入 `ChatPanel.vue` 或 `DemoRuntimeFacade`（AGENTS.md File Hygiene 已约束，v3 强化执行）。

### 5.2 战略主题 2：fail loud 工程化

**目标**：所有失败统一走结构化 envelope，不回滚、不假装理解、不自动续跑；失败时暴露已完成数量 + 剩余 + 可恢复动作。

**原则**：
1. **`validateOrRollback` 必须拆分**：`atomicCapabilities.ts:658-674` 拆为 `validate`（只校验 + 暴露 `RecoverableInterpretationFailure` envelope）与 `rollback`（删除）。7 处原子操作调用点改为调用 `validate`，失败时返回 envelope decision。
2. **`fallbackManager.ts` 直接删除**：v3 确认已是孤儿代码，无需渐进式清除，直接删除文件 + 删除 `src/types/orchestration.ts:585-651` 回退类型。
3. **伪 ReAct 必须修复**：`executeReactAgentPlan` 改为单次 submit 内 plan→act→observe→decide 循环。act 后必须回到 LLM 让其基于 observation 重新 decide；decide 失败、超时或 LLM 返回 `unable_to_decide` 时停止并暴露，不假装继续。
4. **taskKind 迁回 LLM**：`formal_orchestration` action 增加 `taskKind` 字段，由 LLM 直接返回 `full_day / local_refill / overall_refill`；本地 `assertTaskKindFromLlm` 只做结构校验与失败暴露，不做正则兜底（删除 `demoRuntimeFacade.ts:7637,7641` 正则）。
5. **批量失败必须结构化**：长流程批量写入失败时返回 `已完成数量 / 本批是否写入 / 剩余数量 / 可恢复动作`，不静默继续。
6. **`AgentDeadline.abort()` 是唯一停止信号**：老 `Orchestrator.cancel()` 改为调用 `AgentDeadline.abort()`，`AbortSignal` 联动到 LLM 调用与 fetch 请求。

### 5.3 战略主题 3：可观测性

**目标**：所有 LLM 调用必须有 trace + monitor + prompt 版本，禁止"调用即丢"；建立真实 LLM 评估基线。

**原则**：
1. **`LlmCallMonitor` 必须真正接入**：`llmClient.ts:recordRequestTrace` 内部调用 `getLlmCallMonitor().record()`，记录 `stage / model / tokenUsage / latencyMs / status / promptVersion / attemptCount`。这是 v3 阶段 1 收尾的最高优先级。
2. **`systemPrompts.ts` 必须版本化**：所有 system prompt 显式声明版本（如 `v1.0`），与业务 prompt（`candidateJudge v1.2` / `llmAgentIntentInterpreter v2.0`）对齐；trace 中必须记录使用的 prompt 版本。
3. **错误监控上报（脱敏）**：`ErrorMonitor.report` 仅上报 `kind / traceId / noMutation`，不上报用户原始输入；新增 `ErrorMonitor` 不引入外部依赖（如 Sentry），先用内存级上报。
4. **真实 LLM 评估基线**：`agent:eval:llm` 入口已存在，v3 阶段 3 建立 taskKind 返回准确率、envelope 触发率、quick reply 采用率基线；低于阈值时优化 prompt 而非加本地兜底。
5. **trace 必须可解释**：trace 必须能回答"命令被分到哪里 / 草案如何生成 / 检索条件是什么 / 候选为何被选中或拒绝 / 最终编排是否满足约束"（AGENTS.md 已约束）。

### 5.4 战略主题 4：前台体验闭环

**目标**：失败可重试、候选可结构化、长流程可中断、进度可见；ChatPanel.vue 与 create.vue 都低于 2000 行红线。

**原则**：
1. **ChatPanel.vue 渐进式拆分**：v2 已规划 6 步拆分路线图，v3 阶段 1 完成 CandidateRecommendationPanel + FailureFormatter（已完成）；v3 阶段 3 抽取 `LongRunningProgress.vue`；v3 阶段 4 抽取 `DraftDiffPanel.vue / PendingCommandPanel.vue / HistoryDrawer.vue`。目标 < 2000 行。
2. **create.vue 也必须拆分**：v2 漏列 create.vue（3631 行），v3 阶段 2 纳入拆分计划——`broadcast-plan` 目录已有 `broadcastPlan*.ts` helper 与 `useBroadcastPlan*.ts` composable 命名约定，按此约定继续抽取。
3. **失败 envelope 前台完整接入**：`FailureFormatter.vue` 已能渲染 envelope（A18 已打通），quick reply 已策略化（D3 已完成）；v3 阶段 1 收尾确认 `recognizedSlots / missingSlots / candidateEvidence / retrySuggestions / quickReplies` 五个字段都正确渲染。
4. **长流程进度可视化**：`LongRunningProgress.vue` 展示 `当前批次索引 / 总批次数 / 已处理条目数 / 剩余条目数 / 当前 stage` + `AgentExecutionCheckpoint` 时间线；停止按钮联动 `AgentDeadline.abort()`。
5. **SSE 双路径保持**：path A 流式 + path B 批量回放必须并存；HTTP 模式必须保留 `onProgress` 回调接收进度事件，禁止退化为单气泡批量展示。

---

## 6. 工程化路线图

v3 重新排定 v2 D1-D17 + v3 D18-D23 共 23 项缺陷的优先级，分 4 阶段。

### 6.1 v2 D1-D17 在 v3 中的处置

| v2 缺陷 | v3 处置 | 理由 |
|---|---|---|
| D1 AgentDeadline 接入 | **保留为已完成** | 已接入主链路 |
| D2 MutationPolicy 接入 | **保留为已完成** | 已接入 write adapter |
| D3 quick reply 策略化 | **保留为已完成** | 已实现四种策略化重试 |
| D4 候选推荐结构化 | **保留为已完成** | CandidateRecommendationPanel 已抽取 |
| D5 旧原子能力回退机制 | **降级为部分缓解** | fallbackManager 已孤儿化，validateOrRollback 仍存在 |
| D6 双路径并行 | **升级为 D23 三路径并行** | v2 误判为双路径 |
| D7 taskKind 本地正则 | **保留** | 仍存在 |
| D8 伪 ReAct | **保留为 P0** | 仍存在，违反 Design Philosophy |
| D9 Orchestrator.cancel 不联动 | **保留** | 仍存在 |
| D10 demoRuntimeFacade 过大 | **保留为 P0** | 恶化（9872 → 9914） |
| D11 atomicCommandCapability 过大 | **保留为 P0** | 恶化（6193 → 6219） |
| D12 ChatPanel.vue 过大 | **降级为 P1** | 缓解（5864 → 5608），但仍超红线 |
| D13 状态模型不统一 | **保留** | 未变 |
| D14 长流程任务持久化 | **保留** | 未变 |
| D15 LLM 调用不可观测 | **升级为 P0 stub 状态** | 文件已落地但未接入，是隐性债 |
| D16 prompt 版本管理 | **拆为 D16 + D19** | 业务 prompt 已版本化，system prompt 未版本化 |
| D17 timeout 分散 | **保留为 P1** | 部分缓解 |

### 6.2 阶段 1：D15 接入 + D19 systemPrompts 版本化 + D20 browser 入口修复（1-2 周）

**目标**：让 v2 阶段 1 真正收尾——LlmCallMonitor 从 stub 变为接入，systemPrompts.ts 版本化，browser goal38 入口确认。

**任务清单**：
1. D15 `LlmCallMonitor` 接入：`llmClient.ts:recordRequestTrace` 内部调用 `getLlmCallMonitor().record()`，记录 `stage / model / tokenUsage / latencyMs / status / promptVersion / attemptCount`；`schedulingAgentRuntime` / `demoRuntimeFacade` 在 trace 落盘时读取 snapshot（3 天）。
2. D19 `systemPrompts.ts` 版本化：所有 system prompt 显式声明版本（如 `SYSTEM_PROMPT_VERSION = 'v1.0'`），与业务 prompt 对齐；trace 中记录使用的 prompt 版本（1 天）。
3. D20 `agent:browser:goal38` 入口确认：确认是 goal37 别名还是漏入口；若是漏入口，补 `scripts/foreground-browser-goal38.mjs`；若是别名，在 package.json 注释说明（0.5 天）。
4. D17 timeout 收尾：依赖 D1 已完成，删除 `paramExtractor.ts / intentRecognizer.ts / layoutIntentRecognizer.ts` 等处散落 timeout，统一用 `STAGE_TIMEOUT_BUDGET`（1 天）。

**验证门禁**：
- `npm run agent:check`（含长流程测试）
- `npm run build`
- 前台冒烟：触发 LLM 调用，验证 trace 中能观察到 `promptVersion / tokenUsage / latencyMs / status` 字段。

### 6.3 阶段 2：D23 三路径收口 + D10/D11/D21 大文件拆分（4-6 周）

**目标**：三套 runtime 收口为单路径；按 intent 拆分 `atomicCommandCapability.ts`；`create.vue` 拆分低于 2000 行。

**任务清单**：
1. D23 三路径收口：
   - `useOrchestrator.ts:50` 改为调用 `SchedulingAgentRuntime`（而非老 `Orchestrator`），保留 `Orchestrator` 类作为内部实现过渡（1 周）。
   - `DemoRuntimeFacade` 的长流程逻辑迁入 `FormalOrchestrationCapability`（注册到 `CapabilityRegistry`），facade 只保留 submit 主循环与 decision 路由（2 周）。
   - 老 `Orchestrator` 类标记为 `@deprecated`，按调用方迁移进度逐步删除（持续）。
2. D11 `atomicCommandCapability.ts` 拆分：按 intent 拆为 8 个子 capability（`moveCapability.ts / insertCapability.ts / replaceCapability.ts / deleteCapability.ts / batchMoveCapability.ts / batchDeleteCapability.ts / queryCapability.ts / validateCapability.ts`），每个不超过 2000 行；统一注册到 `CapabilityRegistry`，声明 `CapabilityMetadata`（3 周）。
3. D10 `demoRuntimeFacade.ts` 局部瘦身：把编排执行逻辑迁入 `FormalOrchestrationCapability` 后，facade 只保留 submit 主循环与 decision 路由；目标 < 5000 行（2 周）。
4. D21 `create.vue` 拆分：按 `broadcast-plan` 目录已有约定（`broadcastPlan*.ts` helper + `useBroadcastPlan*.ts` composable）继续抽取；目标 < 2000 行（2 周）。
5. 补回归 case：每个子 capability 单测 + `capability_route_conflict` 全路径生效；纳入 `agent:check:tests`（持续）。

**验证门禁**：
- `npm run agent:check`
- `npm run build`
- 前台冒烟：所有原子命令（移动 / 插入 / 替换 / 删除 / 批量）行为不变；broadcast-plan 页面行为不变。

### 6.4 阶段 3：D8 真 ReAct + D7 taskKind 迁回 LLM + D9 停止按钮联动 + D14 任务持久化（5-7 周）

**目标**：长流程真 ReAct 自主多轮；taskKind 由 LLM 返回；停止按钮联动 AbortController；长流程任务持久化。

**任务清单**：
1. D8 真 ReAct 自主多轮：`executeReactAgentPlan`（`demoRuntimeFacade.ts:910-1005`）改为单次 submit 内 plan → act → observe → decide 循环，每轮回判 LLM，`maxTurns=4` 上限；上下文压缩实现 `ContextCompressor`，保留最近 N=5 轮 observation + 任务目标 + 已决动作摘要 + 失败原因（2 周）。
2. D7 taskKind 迁回 LLM：`formal_orchestration` action 增加 `taskKind` 字段，由 LLM 直接返回；删除 `demoRuntimeFacade.ts:7637,7641` 正则；本地 `assertTaskKindFromLlm` 只做结构校验与失败暴露（1 周）。
3. D9 UI 停止按钮联动：老 `Orchestrator.cancel()` 改为调用 `AgentDeadline.abort()`；`AbortSignal` 联动到 LLM 调用与 fetch 请求（1 周）。
4. D14 长流程任务持久化：`AgentServerFileSessionStore` 增加 `PersistedLongRunningTask`，跨小时 / 跨天可恢复（仅恢复进度，不回滚状态）（2 周）。
5. 抽取 `LongRunningProgress.vue`，展示批次进度 + checkpoint 时间线（1 周）。
6. 真实 LLM 评估基线：`npm run agent:eval:llm`，建立 taskKind 返回准确率、envelope 触发率、quick reply 采用率基线（持续）。

**验证门禁**：
- `npm run agent:check`（含 `demoRuntimeFacade.fullGenerateBootstrap.test.ts` + `orchestrator.test.ts`）
- `npm run agent:browser:goal37` + `npm run agent:browser:goal38`（D20 修复后）
- 真实 LLM 评估：`npm run agent:eval:llm`，taskKind 返回准确率基线。

### 6.5 阶段 4：D5 + D13 + D18 + D22 状态模型统一与回退清除（3-4 周）

**目标**：统一 draft / pending / formal 状态机；清除 `validateOrRollback` + `fallbackManager.ts` 孤儿代码；测试文件瘦身。

**任务清单**：
1. D13 `PlaylistStateContract` + `VALID_TRANSITIONS`：显式状态机，所有状态转换走契约校验；`owner / workspaceKey / mutationId / mutationPolicy` 全链路一致（1 周）。
2. D5 `validateOrRollback` 拆分：
   - `atomicCapabilities.ts:658-674` 拆为 `validate`（只校验 + 暴露 envelope）与 `rollback`（删除）。
   - 7 处原子操作调用点改为调用 `validate`，失败时返回 envelope decision。
   - 补回归 case `atomicCapabilities.failureExposure.test.ts`，纳入 `agent:check:tests`（1 周）。
3. D18 `fallbackManager.ts` 直接删除：删除文件 + 删除 `src/types/orchestration.ts:585-651` 回退类型；确认无外部调用方（0.5 天）。
4. D22 `schedulingAgentRuntime.commandMatrix.test.ts` 瘦身：6220 行测试文件按 intent 拆分为 `commandMatrix.move.test.ts / commandMatrix.insert.test.ts / ...`，每个不超过 2000 行（1 周）。
5. 抽取 `DraftDiffPanel.vue` + `HistoryDrawer.vue` + `PendingCommandPanel.vue`，ChatPanel.vue 目标 < 2000 行（1 周）。
6. `FailureExposer` 复用阶段 1 已接入的 `RecoverableInterpretationFailure` schema（0.5 天）。

**验证门禁**：
- `npm run agent:check`
- `npm run build`
- 前台冒烟：原子操作校验失败时显示 envelope 而非自动回滚；点击 quick reply 验证重试。

### 6.6 路线图汇总

| 阶段 | 主题 | 周期 | 关键交付 | 阻断什么 |
|---|---|---|---|---|
| 1 | D15 接入 + D19 + D20 + D17 收尾 | 1-2 周 | LlmCallMonitor 真正接入、systemPrompts 版本化、browser goal38 修复 | 阻断阶段 3（无监控无法评估 taskKind 准确率） |
| 2 | D23 三路径收口 + D10/D11/D21 大文件拆分 | 4-6 周 | 单 runtime、8 个子 capability、create.vue 拆分 | 阻断阶段 3（无双路径收口位置） |
| 3 | D8 真 ReAct + D7 taskKind 迁回 + D9 停止按钮 + D14 持久化 | 5-7 周 | 真 ReAct、taskKind 由 LLM 返回、停止按钮联动、长流程持久化 | 阻断前台长流程体验 |
| 4 | D5 + D13 + D18 + D22 状态机统一与回退清除 | 3-4 周 | 状态机统一、validateOrRollback 拆分、fallbackManager 删除、测试瘦身 | 阻断状态污染与回退债务 |

---

## 7. STOP / START / CONTINUE 清单

### 7.1 STOP（v2 中因新约束或新发现而过时的方向）

| 停止项 | 来源 | 停止理由 |
|---|---|---|
| v2 方向 F 中关于 `fallbackManager.ts` 渐进式清除的描述 | v2 第 4.5 节 | v3 发现 `fallbackManager.ts` 已是孤儿代码（无外部调用方），直接删除即可，无需渐进式 |
| v2 阶段 1 中关于 D15 "进行中"的乐观估计 | v2 第 1.2 节 | v3 核对发现 LlmCallMonitor 文件完整但 llmClient.ts 未接入，是 stub 状态 |
| v2 第 2.2.2 节关于 `fallbackManager.ts` "接入主链路证据"的描述 | v2 第 2.2.2 节 | v3 grep 确认无外部调用方，已是孤儿代码 |
| v2 D6 "双路径并行"的描述 | v2 第 5.1 节 | v3 发现是三路径并行（老 Orchestrator + DemoRuntimeFacade + SchedulingAgentRuntime） |
| 任何"checkpoint 回滚 / mutation journal / auto rollback / compensation transaction"方向 | v2 第 3.2 节 | 约束 2 明确禁止；v3 强化执行 |
| 任何"子 agent 调度 / DraftAgent / CandidateAgent / SelectionAgent / WriteAgent / ValidationAgent"方向 | v2 第 3.2 节 | 约束 3 明确禁止；v3 升格为战略主题 1 |
| 任何"跨会话 memory / 向量化上下文检索 / 图可视化状态机 / 动态加载 skill"方向 | v2 第 3.2 节 | 投入产出比低；v3 维持删除 |
| v2 阶段 3 中"`executeReactAgentPlan` 改为真 ReAct"作为单独任务 | v2 第 7.3 节 | v3 把它升格为战略主题 2 的核心原则，与 D5/D7 一起作为 fail loud 工程化的组成部分 |

### 7.2 START（v3 新增的优先方向）

| 新增项 | 优先级 | 理由 |
|---|---|---|
| D15 `LlmCallMonitor` 真正接入 `llmClient.ts:recordRequestTrace` | P0（阶段 1） | v2 误判为进行中，v3 发现是 stub 状态；这是可观测性战略主题的核心 |
| D19 `systemPrompts.ts` 版本化 | P1（阶段 1） | v2 漏列；与 D16 形成对比，业务 prompt 已版本化但 system prompt 主体未版本化 |
| D20 `agent:browser:goal38` 入口确认 | P2（阶段 1） | v2 漏列；goal37 与 goal38 指向同一脚本，可能是别名也可能是漏入口 |
| D21 `create.vue` 拆分（3631 行） | P1（阶段 2） | v2 漏列；broadcast-plan 是前台另一入口，与 ChatPanel 并列 |
| D22 `commandMatrix.test.ts` 瘦身（6220 行） | P2（阶段 4） | v2 漏列；测试可维护性差 |
| D23 三路径收口（升级自 D6 双路径） | P0（阶段 2） | v2 误判为双路径，v3 发现是三路径；问题更严重 |
| `ContextCompressor` 实现（保留最近 N=5 轮 observation） | P0（阶段 3） | 真 ReAct 循环的配套；AGENTS.md"上下文压缩对齐 Codex"硬约束 |
| `ErrorMonitor.report`（脱敏上报） | P1（阶段 3） | v2 方向 E 的一部分；v3 明确不引入外部依赖（如 Sentry），先用内存级上报 |
| 真实 LLM 评估基线（taskKind 准确率 / envelope 触发率 / quick reply 采用率） | P1（阶段 3） | v2 方向 E 的一部分；v3 明确低于阈值时优化 prompt 而非加本地兜底 |

### 7.3 CONTINUE（v2 中仍有效的方向）

| 继续项 | 来源 | 继续理由 |
|---|---|---|
| D5 `validateOrRollback` 拆分为 `validate` + 删除 `rollback` | v2 第 4.5 节 | v3 确认仍真实存在于主链路，7 处原子操作调用 |
| D7 taskKind 迁回 LLM | v2 第 7.3 节 | v3 确认仍依赖本地正则 |
| D8 真 ReAct 循环 | v2 第 7.3 节 | v3 确认仍是伪 ReAct |
| D9 老 `Orchestrator.cancel()` 联动 `AgentDeadline.abort()` | v2 第 7.3 节 | v3 确认仍只设 `isCancelled = true` |
| D10 `demoRuntimeFacade.ts` 拆分 | v2 第 7.2 节 | v3 确认恶化（9872 → 9914） |
| D11 `atomicCommandCapability.ts` 按 intent 拆分 | v2 第 7.2 节 | v3 确认恶化（6193 → 6219） |
| D12 `ChatPanel.vue` 渐进式拆分 | v2 第 6.1 节 | v3 确认缓解（5864 → 5608），但仍超红线；继续抽取 `LongRunningProgress.vue / DraftDiffPanel.vue / PendingCommandPanel.vue / HistoryDrawer.vue` |
| D13 `PlaylistStateContract` + `VALID_TRANSITIONS` 状态机统一 | v2 第 7.4 节 | v3 确认状态仍散落 |
| D14 长流程任务持久化 | v2 第 7.3 节 | v3 确认未实现 |
| D17 timeout 收敛 | v2 第 7.1 节 | v3 确认部分缓解，仍需收尾 |
| `CapabilityMetadata`（`supportedIntents / requiredSources / safetyGates`） | v2 第 4.1 节 | v3 战略主题 1 的组成部分 |
| `LongRunningProgress.vue` + checkpoint 时间线 | v2 第 6.3 节 | v3 战略主题 4 的组成部分 |
| `DraftDiffPanel.vue` + `PendingCommandPanel.vue` + `HistoryDrawer.vue` | v2 第 6.1 节 | v3 战略主题 4 的组成部分 |

---

## 8. 前台体验方向

### 8.1 ChatPanel.vue 拆分路线图（v3 修订）

v2 已规划 6 步拆分，v3 修订进度：

| 拆分顺序 | 抽取组件 | v2 状态 | v3 状态 | 目标行数 |
|---|---|---|---|---|
| 1 | `CandidateRecommendationPanel.vue` | 待抽取 | ✅ 已抽取 | -300 行（已实现） |
| 2 | `FailureFormatter.vue` | 待完善 | ✅ 已接入 | -200 行（已实现） |
| 3 | `LongRunningProgress.vue` | 待抽取 | ❌ 待抽取（阶段 3） | -400 行 |
| 4 | `DraftDiffPanel.vue` | 待抽取 | ❌ 待抽取（阶段 4） | -300 行 |
| 5 | `PendingCommandPanel.vue` | 待抽取 | ❌ 待抽取（阶段 4） | -500 行 |
| 6 | `HistoryDrawer.vue` | 待抽取 | ❌ 待抽取（阶段 4） | -200 行 |
| 目标 | `ChatPanel.vue` 只保留消息列表 + 输入框 + 路由逻辑 | — | — | < 2000 行 |

### 8.2 create.vue 拆分路线图（v3 新增）

v2 漏列 create.vue（3631 行），v3 阶段 2 纳入拆分计划：

| 拆分顺序 | 抽取目标 | 取代现状 | 目标行数 |
|---|---|---|---|
| 1 | `broadcastPlanEditorHelpers.ts` 继续抽取 | 已有部分 helper | -300 行 |
| 2 | `useBroadcastPlanEditor.ts` 继续抽取 | 已有部分 composable | -500 行 |
| 3 | `BroadcastPlanSidebar.vue` 完善接入 | 已存在但接入不全 | -400 行 |
| 4 | `ScheduleItemDialog.vue` 完善接入 | 已存在但接入不全 | -400 行 |
| 目标 | `create.vue` 只保留页面容器 + 路由 | — | < 2000 行 |

### 8.3 失败暴露前台完整接入

- **当前**：`FailureFormatter.vue` 已能渲染 envelope（A18 已打通），quick reply 已策略化（D3 已完成）。
- **v3 收尾目标**：
  1. 确认 `recognizedSlots / missingSlots / candidateEvidence / retrySuggestions / quickReplies` 五个字段都正确渲染（阶段 1 冒烟验证）。
  2. `handleFailureQuickReply`（`ChatPanel.vue:908-951`）的 `switch_strategy / broaden_target / narrow_target / resubmit` 四种策略化重试都已实现，验证自动构造新指令并触发 `sendMessage`。
  3. `fill_instruction` 保留当前行为（填输入框，用户可编辑后发送）。

### 8.4 长流程进度可视化

- **当前**：`ChatPanel.vue:448-453` 有 `is-stop` 样式，但无批次进度展示。
- **v3 目标**（阶段 3 落地）：
  1. 抽取 `LongRunningProgress.vue`，展示 `当前批次索引 / 总批次数 / 已处理条目数 / 剩余条目数 / 当前 stage`。
  2. 展示 `AgentExecutionCheckpoint` 时间线（已完成批次 + 当前批次 + 待处理批次）。
  3. 停止按钮联动 `AgentDeadline.abort()`（D9 修复后），点击后立即中止 LLM 调用与 fetch 请求，状态保留在最后 checkpoint。

### 8.5 SSE 双路径保持

- **当前**：path A 流式 + path B 批量回放已并存（`agentRuntimeClient.ts`）。
- **v3 目标**：保持；HTTP 模式必须保留 `onProgress` 回调接收进度事件，禁止退化为单气泡批量展示；进度消息必须包含 `查节目库` / `候选决策` 等 `processTypeLabel` 分支。

---

## 9. 残余风险与未覆盖点

### 9.1 v3 核对不充分的模块

| 模块 | 核对不充分点 | 风险 |
|---|---|---|
| `schedulingAgentRuntime.ts` | 未完整读取，只 grep 了关键模式 | 可能存在 v3 未识别的债；建议阶段 2 拆分前先完整读取 |
| `reactTaskRuntime.ts` | 未完整读取，只确认了 `recordObservation / startTask / continueWithActions` 接口 | 真 ReAct 改造时可能发现更多限制 |
| `agentServerRuntime.ts` / `agentServerSessionStore.ts` | 未读取 | 服务端迁移边界（Goal 40+）未在 v3 展开 |
| `openClawBridge.ts`（879 行） | 未读取 | OpenClaw 集成路径未在 v3 核对 |
| `layoutDraftService.ts`（807 行） | 未读取 | 草案服务套件的内部状态未核对 |

### 9.2 战略风险

#### 9.2.1 三路径收口过渡期风险

- **风险**：阶段 2 三路径收口过渡期，老 `Orchestrator` 与 `SchedulingAgentRuntime` 并存，停止信号、deadline、状态可能不一致。
- **权衡**：
  - 阶段 1 先把 `AgentDeadline.abort()` 接入短链路 LLM 调用（已完成 D1）。
  - 阶段 2 先迁移 `useOrchestrator.ts` 改为调用 `SchedulingAgentRuntime`，老 `Orchestrator` 类标记 `@deprecated` 但保留。
  - 阶段 3 老类逐步删除。
- **残余风险**：过渡期长流程停止后，老 `Orchestrator` 内部的 LLM 调用仍可能继续执行。通过阶段 3 双路径收口消除。

#### 9.2.2 taskKind 迁回 LLM 后的稳定性

- **风险**：LLM 可能不稳定返回 taskKind（例如把"补空窗"识别为"全天编排"），本地校验无法发现。
- **权衡**：
  - 严格遵守 AGENTS.md：本地只做结构校验与失败暴露，不做正则兜底。
  - LLM 未返回 taskKind 或返回非法值时，暴露 `llm_intent_unavailable` envelope。
  - 在阶段 1 `LlmCallMonitor` 落地后，建立 taskKind 返回准确率基线，低于阈值时优化 prompt 而非加本地兜底。
- **残余风险**：LLM 在边界场景下稳定返回错误 taskKind。通过 UI 停止按钮及时中止 + 真实 LLM 评估基线发现与修正。

#### 9.2.3 `validateOrRollback` 拆分可能引入主链路回归

- **风险**：`atomicCapabilities.ts` 的 `validateOrRollback` 被 7 处原子操作调用，清除回退后校验失败会暴露 envelope 而非自动恢复，可能改变现有测试预期。
- **权衡**：
  - 先补回归 case `atomicCapabilities.failureExposure.test.ts`，覆盖所有 7 处调用点的校验失败路径。
  - 渐进式清除：先拆 `validate` 与 `rollback`，保留 `rollback` 函数但不在主路径调用，最后删除。
  - 每步清除后跑 `npm run agent:check` 全量回归。
- **残余风险**：用户已习惯"校验失败自动回滚"的行为，改为"暴露失败让用户决定"需要用户教育。通过 `FailureFormatter` 的 quick reply 降低摩擦。

#### 9.2.4 ChatPanel.vue 与 create.vue 拆分可能引入前台回归

- **风险**：5608 + 3631 行拆分涉及大量状态迁移，可能引入 UI 渲染回归。
- **权衡**：
  - 渐进式拆分：每步拆分后跑 `chatPanelQuickActions.test.ts` + `chatPanelDetails.test.ts` + 前台冒烟。
  - create.vue 拆分按 `broadcast-plan` 目录已有约定，避免新造命名。
- **残余风险**：拆分后状态传递可能丢失。通过 `agent:browser:goal37/38` 覆盖。

### 9.3 v3 未覆盖的方向

| 未覆盖方向 | 理由 | 何时重新评估 |
|---|---|---|
| 服务端迁移（Goal 40+） | v3 聚焦单 agent 能力厚度与 fail loud 工程化；服务端迁移边界已在 `docs/agent-server-migration-plan.md` 约束 | 阶段 3 完成 ReAct 基础闭环后 |
| 多用户会话隔离 | AGENTS.md 已标注"后续阶段"；当前仍为单会话/单工作区原型 | 商用部署前必须补完 |
| 速率限制 / 日志脱敏 / 权限边界 | 同上 | 商用部署前 |
| 真实 LLM 评估基线的具体指标阈值 | v3 只建立基线，阈值需基于实际数据收敛 | 阶段 3 建立基线后 2-4 周 |
| OpenClaw 集成路径 | OpenClaw 仍只是外部访问方，不阻塞 v3 战略 | 阶段 4 后视需求评估 |

### 9.4 与 AGENTS.md 的对齐声明

- **LLM-first**：阶段 3 taskKind 迁回 LLM 是对齐 LLM-first 的修复；阶段 4 `validateOrRollback` 拆分不引入本地兜底正则。
- **本地只保护结果**：`AgentDeadline`（已接入）/ `MutationPolicy`（已接入）/ `assertMutationAllowed`（已接入）/ `assertTaskKindFromLlm`（阶段 3 落地）都是保护结果，不改写意图。
- **暴露失败不假装理解**：`RecoverableInterpretationFailure` envelope 已落地；阶段 4 清除 `validateOrRollback` 后所有失败统一走 envelope；阶段 3 真 ReAct 循环修复后不再"假装继续"。
- **渐进式演进**：阶段 1 收尾采用渐进式（先 LlmCallMonitor 接入，再 systemPrompts 版本化）；阶段 2 拆分按 intent 逐步迁出；阶段 4 `validateOrRollback` 先拆 `validate` / `rollback` 再删除。
- **Scheduling Guardrails**：阶段 4 状态机统一把 guardrails 落到 `VALID_TRANSITIONS`；`workspaceKey` 全链路一致在状态契约中强制。
- **Atomic Command Policy By Playlist Type**：阶段 2 Capability 拆分保留电视播单直接执行、轮播单候选推荐、删除始终确认的策略。
- **Agent Architecture**：阶段 2 只保留按 intent 拆分 + 统一分发 + `FormalOrchestrationCapability`，不叠加子 agent 雏形；阶段 3 真 ReAct 循环对齐"禁止伪 ReAct"。
- **File Hygiene**：阶段 2 拆分后 `demoRuntimeFacade.ts` / `atomicCommandCapability.ts` / `ChatPanel.vue` / `create.vue` 均低于红线；阶段 4 测试文件瘦身。
- **Verification Gates**：每个阶段都包含 `agent:check` + `build` + 前台冒烟 + 浏览器回归。
- **不引入回退**：阶段 4 清除 `validateOrRollback` + 删除 `fallbackManager.ts` 孤儿代码；阶段 3 checkpoint 持久化仅用于进度展示与中断续跑，不用于回滚。
- **不引入子 agent**：阶段 2 只保留按 intent 拆分 capability + 统一分发；战略主题 1 明确单 agent 能力厚度。

---

## 章节目录

1. 执行摘要
   - 1.1 v3 相对 v2 的核心调整
   - 1.2 3 条新约束带来的方向变化（再确认）
   - 1.3 v3 的战略主张
2. 现状核对（基于 2026-06-28 代码）
   - 2.1 v2 D1-D17 完成度核对
   - 2.2 全天编排 / 全天补全 / 草案融入情况（核对约束 1，再确认）
   - 2.3 回退相关代码现状（核对约束 2，再确认）
   - 2.4 子 agent 相关代码现状（核对约束 3，再确认）
   - 2.5 v3 新发现的工程债（不在 v2 D1-D17 清单内）
   - 2.6 文件行数红线核对（2026-06-28）
3. 架构缺陷清单（按严重度排序）
   - 3.1 P0 缺陷（阻断战略目标）
   - 3.2 P1 缺陷（不阻断但需处理）
   - 3.3 P2 缺陷（低优先）
   - 3.4 与 v2 D1-D17 的映射
4. 成熟 agent 模式映射
   - 4.1 上下文管理
   - 4.2 工具调用与确定性校验
   - 4.3 失败处理
   - 4.4 用户体验
   - 4.5 可观测性
   - 4.6 单 agent 深度（不引入子 agent 时的能力厚度保证）
5. 战略方向
   - 5.1 战略主题 1：单 agent 能力厚度
   - 5.2 战略主题 2：fail loud 工程化
   - 5.3 战略主题 3：可观测性
   - 5.4 战略主题 4：前台体验闭环
6. 工程化路线图
   - 6.1 v2 D1-D17 在 v3 中的处置
   - 6.2 阶段 1：D15 接入 + D19 systemPrompts 版本化 + D20 browser 入口修复
   - 6.3 阶段 2：D23 三路径收口 + D10/D11/D21 大文件拆分
   - 6.4 阶段 3：D8 真 ReAct + D7 taskKind 迁回 LLM + D9 停止按钮联动 + D14 任务持久化
   - 6.5 阶段 4：D5 + D13 + D18 + D22 状态模型统一与回退清除
   - 6.6 路线图汇总
7. STOP / START / CONTINUE 清单
   - 7.1 STOP（v2 中因新约束或新发现而过时的方向）
   - 7.2 START（v3 新增的优先方向）
   - 7.3 CONTINUE（v2 中仍有效的方向）
8. 前台体验方向
   - 8.1 ChatPanel.vue 拆分路线图（v3 修订）
   - 8.2 create.vue 拆分路线图（v3 新增）
   - 8.3 失败暴露前台完整接入
   - 8.4 长流程进度可视化
   - 8.5 SSE 双路径保持
9. 残余风险与未覆盖点
   - 9.1 v3 核对不充分的模块
   - 9.2 战略风险
   - 9.3 v3 未覆盖的方向
   - 9.4 与 AGENTS.md 的对齐声明
