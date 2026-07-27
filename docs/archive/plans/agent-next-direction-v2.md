# Agent 下一步发展方向（v2 修订版）

- 作者：solution-architect
- 日期：2026-06-28
- 状态：待用户确认
- 适用范围：aibiandan agent 编排系统（电视播单 + 轮播单）
- 前置文档：`docs/agent-next-direction-analysis.md`（935 行，本修订版的上游分析）、`AGENTS.md`（强制工作协议）
- 核对基准：本文档所有论断均以 2026-06-28 当日代码为准。已实际读取代码核对，不依赖任何 md 文档描述。

---

## 1. 修订背景

### 1.1 3 条新约束对旧方案的影响摘要

用户在 `docs/agent-next-direction-analysis.md`（下称"旧分析"）确认后，追加 3 条硬约束。本节摘要约束对旧方案的影响。

| # | 新约束 | 对旧方案的影响 | 处理动作 |
|---|---|---|---|
| 1 | 全天编排、全天补全、草案都是已融入到整体流程的（文档可能落后于代码） | 旧分析第 2.1.2、2.1.3 节已确认融入，但旧分析第 7.2 节"阶段 5 方向 4 长流程增强"仍把"全天编排接入"作为待办 | 删除"长流程未接入"类过期论断；保留"长流程稳定性增强"但聚焦 ReAct 真循环与双路径收口 |
| 2 | 不需要回退功能（参考 Codex，失败就暴露失败） | 旧分析第 4.4.2 节"checkpoint 回滚"已标注不借鉴；但代码现状中 `atomicCapabilities.ts` 的 `validateOrRollback` 与 `fallbackManager.ts` 三级回退机制真实存在于主链路，是隐性架构债 | 删除所有"回退/undo/rollback"方向；新增"旧原子能力回退机制清除"工程化方向 |
| 3 | 不需要子 agent（当前项目本身就是典型的子 agent） | 旧分析第 4.3.3 节已标注不借鉴；旧分析无子 agent 方向 | 删除所有"子 agent / 多 agent 协作"方向；保留"按 intent 拆分 capability + 统一分发"作为复杂能力拆分方式 |

### 1.2 已完成的工作（不再列入路线图）

- **阶段一：节目检索重试机制**——LLM 一次性生成多组带策略标签关键词，本地检索循环（`candidateSearchRetryService.ts`）。
- **阶段 1 任务 1：A16 门禁对齐**——`package.json:29` `agent:check:tests` 已纳入长流程测试（含 `demoRuntimeFacade.fullGenerateBootstrap.test.ts`、`orchestrator.test.ts`）。
- **阶段 1 任务 2：A18 失败 envelope 数据流打通**——`demoRuntimeFacade.ts:621-626` 调用 `buildRecoverableFailureEnvelope` 产出结构化 envelope；`ChatPanel.vue:2056, 2067` 从 feedback 中提取 envelope 并赋值给 `recoverableFailureEnvelope.value`；测试已断言。

### 1.3 本文档定位

本文档是旧分析的**精简修订版**，不重复旧分析全部内容，聚焦于：
- 基于 3 条新约束的方向调整（删除/保留/强化）
- 基于代码核对的工程化方向明确化
- 架构缺陷清单的重新核对（不照搬旧分析 A1-A20）
- 前台体验对标与实施路线图

---

## 2. 代码现状核对

### 2.1 全天编排 / 全天补全 / 草案融入情况（核对约束 1）

**结论：全天编排、全天补全、草案三件套均已融入 `demoRuntimeFacade.ts` 主链路，旧分析无过期论断需要纠正。** 以下是实际接入点（已读取代码核对）。

#### 2.1.1 全天编排 / 全天补全接入点

- **入口识别**：`src/services/runtime/demoRuntimeFacade.ts:7336, 7418` 通过 `/(帮我全天编排|全天编排|整天编排|...)/` 正则识别全天编排意图，触发 `formal_orchestration` action。
- **taskKind 解析**：`demoRuntimeFacade.ts:7587, 7609` `resolveFormalOrchestrationTaskKind` 区分 `full_day` / `local_refill` / `overall_refill`。
- **mode 标签**：`demoRuntimeFacade.ts:7469` `modeLabel = mode === 'partial_generate' ? '补齐当前空窗' : '全天编排'`。
- **bootstrap 门禁**：`demoRuntimeFacade.ts:7569-7622` `resolveFormalOrchestrationBasis` + `buildMissingFormalOrchestrationBasisBlock` 实现空草案阻拦、部分草案引导、轮播草案缺失阻拦、已有节目重编确认。
- **LLM action 定义**：`src/services/llm/agentPlanner.ts:43-48` `formal_orchestration` action 含 `mode / useLayoutDraft / targetTimeRange` 字段。
- **ReAct 执行器**：`demoRuntimeFacade.ts:894-989` `executeReactAgentPlan` + `reactTaskRuntime`（`src/services/runtime/reactTaskRuntime.ts`）执行长流程。

#### 2.1.2 草案三件套接入点

- **prepareLayoutDraft**：`demoRuntimeFacade.ts:342` 在 submit 主链路中调用，产出 `draftDecision.draft / feasibilityReport / orchestrationMode`。
- **commitLayoutDraft**：`demoRuntimeFacade.ts:8674` 提交草案。
- **refineLayoutDraft**：通过 `action.type === 'refine_layout_draft'` 分支处理（`demoRuntimeFacade.ts:744-745, 1633, 1716, 1750, 1777`）。
- **草案服务套件**：`demoRuntimeFacade.ts:21-26, 85` 导入 `layoutDraftService / layoutDraftCompiler / layoutDraftValidator / layoutDraftFeasibilityService / layoutDraftCompleteness`，完整闭环。
- **草案与正式播单隔离**：`RuntimeDecision` 类型（`demoRuntimeFacade.ts:181-207`）显式区分 `kind: 'message'`（含 `layoutDraft`）与 `kind: 'orchestration'`（含 `orchestrationRequest`）。

#### 2.1.3 纠正旧分析过期论断

旧分析无"长流程未接入"或"草案孤立"类过期论断。旧分析第 2.1.2、2.1.3 节已准确描述 bootstrap 门禁与草案三件套闭环。本节仅补充实际行号证据，无需纠正。

### 2.2 回退相关代码现状（核对约束 2）

**结论：项目存在两套并行的"失败处理"路径——主链路 agent 路径已对齐"失败暴露"，但底层原子能力路径仍保留自动回滚机制，是真实架构债。**

#### 2.2.1 已对齐"失败暴露"的部分（agent 主路径）

- `src/services/agent/recoverableFailureEnvelope.ts`：结构化 envelope schema（`kind / recognizedSlots / missingSlots / candidateEvidence / retrySuggestions / quickReplies`）。
- `src/services/runtime/demoRuntimeFacade.ts:611-648` `buildRecoverableLlmFailureDecision`：调用 `buildRecoverableFailureEnvelope` 产出 envelope，`noMutation: true`，放入 `feedback.details.recoverableFailureEnvelope`。
- `src/components/dialogue/ChatPanel.vue:2056, 2067`：从 feedback 提取 envelope 赋值给 `recoverableFailureEnvelope.value`，驱动 `FailureFormatter.vue` 渲染。
- `src/services/agent/agentDeadline.ts`、`src/services/agent/mutationPolicy.ts`：已落地接口与单测，**但未接入主链路**（见第 5 节缺陷 A17）。

#### 2.2.2 未对齐"失败暴露"的部分（旧原子能力路径，架构债）

- **`src/services/atomicCapabilities.ts:658-674` `validateOrRollback` 方法**：在校验失败时直接调用传入的 `rollback()` 回滚本次修改，返回"已回滚本次修改"消息。被 `atomicCapabilities.ts:196, 248, 303, 374, 448, 555, 623` 等原子操作（批量添加 / 替换 / 删除 / 移动 / 更新字段 / 批量删除 / 整体替换）调用。
- **`src/services/fallbackManager.ts`（467 行）**：实现三级回退机制（条目级 / 空窗级 / 会话级），含 `enableAutoFallback` 配置、`recordFallback` 历史、`autoDecideFallbackLevel` 自动决策。
- **`src/types/orchestration.ts:585-651`**：定义 `FallbackLevel / FallbackRecord / FallbackStrategyConfig` 回退类型。
- **接入主链路证据**：`atomicCapabilities.ts` 被 `demoRuntimeFacade.ts:31`、`orchestrator.ts:19`、`agentServerRuntime.ts:35`、`commandExecutor.ts:19`、`insertCommandExecutor.ts:2`、`replaceCommandExecutor.ts:2` 等主链路文件引用。
- **冲突点**：`validateOrRollback` 在校验失败时自动回滚已写入状态，违背 AGENTS.md"失败暴露而非回滚——禁止实现 `validateOrRollback` / `mutationJournal` / `autoRollback` 等自动回滚链路"硬约束。

#### 2.2.3 处理方向

- **不在新方案中保留任何回退方向**。
- **新增工程化方向"旧原子能力回退机制清除"**（见第 4.5 节）：将 `validateOrRollback` 拆为 `validate`（只校验 + 暴露失败 envelope）与 `rollback`（删除），校验失败时产出 `RecoverableInterpretationFailure` envelope，让用户决定下一步。
- **`fallbackManager.ts` 三级回退整体废弃**，失败统一走 envelope + 用户重试。

### 2.3 子 agent 相关代码现状（核对约束 3）

**结论：项目无任何子 agent 代码，已对齐约束 3。**

- 搜索 `subAgent / SubAgent / 子agent / DraftAgent / CandidateAgent / SelectionAgent / WriteAgent / ValidationAgent` 在 `src/` 全无匹配。
- `src/services/agent/capabilityRegistry.ts`（24 行）只提供 `register / list / resolve / resolveAll` 方法。
- `src/services/agent/schedulingAgentRuntime.ts:77-78` 只注册 `AtomicCommandCapability` 单个 capability。
- 复杂能力拆分通过按 intent 拆分 `AtomicCommandCapability` + 统一 `CapabilityRegistry` 分发实现，无子 agent 雏形。

### 2.4 其他关键代码现状核对

| 核对项 | 旧分析论断 | 实际代码（2026-06-28） | 状态 |
|---|---|---|---|
| `demoRuntimeFacade.ts` 行数 | 9864 | **9872** | 微增 |
| `ChatPanel.vue` 行数 | 5844 | **5864** | 微增 |
| `atomicCommandCapability.ts` 行数 | 6193 | **6193** | 不变 |
| A18 envelope 数据流 | 未打通 | 已打通（`demoRuntimeFacade.ts:621-626` + `ChatPanel.vue:2056, 2067`） | ✅ 已完成 |
| A19 quick reply 策略化重试 | 未实现 | 仍只 `fill_instruction` + 清空 envelope（`ChatPanel.vue:985-992`） | ❌ 未完成 |
| A20 候选推荐结构化 card | 未交付 | 仍 `el-radio-group`（`ChatPanel.vue:279`） | ❌ 未完成 |
| A17 AgentDeadline 接入主链路 | 未接入 | 仅 `recoverableFailureEnvelope.test.ts` 引用，主链路无匹配 | ❌ 未完成 |
| A17 MutationPolicy 接入 write adapter | 未接入 | `formalPlaylistWriteAdapter.ts` 无 `mutationPolicy / assertMutationAllowed / preview_only` 匹配 | ❌ 未完成 |
| 老 Orchestrator.cancel() 联动 AbortController | 不联动 | `orchestrator.ts:388-394` 仍只设 `isCancelled = true` | ❌ 未完成 |
| 长流程任务持久化 | 未实现 | `agentServerFileSessionStore.ts` 无 `longRunning / persistedTask` 匹配 | ❌ 未完成 |
| 双路径并行 | 存在 | `demoRuntimeFacade.ts:190, 7486` 产出 `kind: 'orchestration'`；老 `Orchestrator` 类仍被 `useOrchestrator.ts` 使用 | ❌ 未收口 |
| taskKind 本地正则 | 仍依赖 | `demoRuntimeFacade.ts:7587, 7609` `resolveFormalOrchestrationTaskKind` 仍用正则 | ❌ 未修复 |
| `executeReactAgentPlan` 真 ReAct | 伪 ReAct | `demoRuntimeFacade.ts:894-989` 只执行 firstAction 后 recordObservation 返回，需用户下一轮触发 | ❌ 伪 ReAct |

---

## 3. 修订后的方向集

基于 3 条新约束，对旧分析 5 个方向重新筛选。

### 3.1 保留的方向（说明为什么仍需要）

#### 方向 A：方向 1 接入闭环收尾（A17 / A19 / A20）

- **为什么保留**：方向 1 的 envelope 数据流（A18）已完成，但 `AgentDeadline` / `MutationPolicy` 接入主链路（A17）、quick reply 策略化重试（A19）、候选推荐结构化 card（A20）均未完成。这些是"已投入未产出"的债务，不收尾会让后续方向重复造轮子。
- **与旧分析差异**：旧分析把方向 1 接入闭环作为阶段 1 主题；本修订版将其拆为"已完成部分（A16/A18）"与"收尾部分（A17/A19/A20）"，收尾部分仍为最高优先级。

#### 方向 B：方向 2 状态模型统一（去掉回退）

- **为什么保留**：草案 / pending mutation / 正式播单状态散落，无统一 `owner / workspaceKey / mutationId / mutationPolicy` 契约（AGENTS.md Scheduling Guardrails 硬约束）。这是状态污染与跨工作区误写的根因。
- **与旧分析差异**：
  - 删除旧分析第 4.4.2 节"checkpoint 回滚"方向（约束 2 禁止）。
  - 删除旧分析方向 2 中可能隐含的 `MutationJournalService` 方向（约束 2 禁止）。
  - 保留 `PlaylistStateContract` + `VALID_TRANSITIONS` 显式状态机、`DraftDiffPanel.vue` 草案 diff 面板、`FailureExposer`（产出 envelope 而非回滚）。
  - `FailureExposer` 必须复用方向 A 已接入的 `RecoverableInterpretationFailure` schema，不能另起炉灶。

#### 方向 C：方向 3 Capability 拆分（去掉子 agent）

- **为什么保留**：`atomicCommandCapability.ts` 6193 行 + `demoRuntimeFacade.ts` 9872 行双红线（AGENTS.md File Hygiene 硬约束：单文件不超过 2000 行，超过 5000 行必须拆分）。`tryHandleAgentPlannerInstruction`（`demoRuntimeFacade.ts:649`）与 `CapabilityRegistry` 双分发机制并行（AGENTS.md Agent Architecture 硬约束：双路径并行禁止）。
- **与旧分析差异**：
  - 删除旧分析中可能隐含的"子 agent 雏形"方向（约束 3 禁止）。
  - 保留按 intent 拆分（`moveCapability / insertCapability / replaceCapability / deleteCapability / batchMoveCapability / batchDeleteCapability / queryCapability / validateCapability`）+ 统一 `CapabilityRegistry.resolveAll` 分发。
  - 保留 `CapabilityMetadata`（`supportedIntents / requiredSources / safetyGates`）借鉴 Trae skill 协议。
  - 保留 `FormalOrchestrationCapability` 作为长流程执行器位置（为方向 D 双路径收口铺垫）。

#### 方向 D：方向 4 长流程稳定性增强（去掉回退）

- **为什么保留**：长流程已融入主链路（见第 2.1 节），但 `executeReactAgentPlan` 是伪 ReAct、老 `Orchestrator.cancel()` 不联动 AbortController、双路径并行、taskKind 仍依赖本地正则、长流程任务持久化未实现。
- **与旧分析差异**：
  - 删除旧分析第 4.4.1 节"checkpoint 持久化可恢复"中的"可恢复"语义（约束 2 禁止回退）。`BatchCheckpointExecutor` + `LongRunningTaskStore` 只用于**进度展示与中断后续跑**，不用于回滚到上一 checkpoint。
  - 保留真 ReAct 循环（plan → act → observe → decide，每轮回判）、上下文压缩（对齐 Codex：保留最近 N 轮 observation + 任务目标 + 已决动作摘要 + 失败原因）、UI 停止按钮联动 `AgentDeadline.abort()`。
  - 保留双路径收口（`FormalOrchestrationCapability` 取代老 `Orchestrator`）。
  - 保留 taskKind 迁回 LLM（在 `formal_orchestration` action 中增加 `taskKind` 字段，由 LLM 直接返回；本地只做结构校验与失败暴露）。

#### 方向 E：方向 5 工程化基线（保留）

- **为什么保留**：LLM 调用不可观测（A10）、prompt 版本管理缺失、trace 不完整、真实 LLM 评估基线未建立。这些是方向 A-D 的可观测性支撑。
- **与旧分析差异**：无（旧分析方向 5 已对齐约束）。

### 3.2 删除的方向（说明为什么不需要）

| 删除方向 | 来源 | 删除理由 |
|---|---|---|
| checkpoint 回滚 / mutation journal / auto rollback / compensation transaction | 旧分析第 4.4.2 节、方向 2 隐含 | 约束 2 明确禁止回退；失败统一走 `RecoverableInterpretationFailure` envelope + 用户重试 |
| 子 agent 调度 / DraftAgent / CandidateAgent / SelectionAgent / WriteAgent / ValidationAgent | 旧分析第 4.3.3 节 | 约束 3 明确禁止子 agent；复杂能力拆分只通过按 intent 拆分 capability + 统一分发实现 |
| 跨会话 memory | 旧分析第 4.3.2 节、第 6.3.4 节 | 约束 3 业务专一，跨会话 memory 投入产出比低；延后到方向 E 工程化基线后期再评估 |
| 全链路 trace 可视化（LangSmith 式） | 旧分析第 4.4.3 节 | 投入产出比低，本项目用 trace 文本即可 |
| 图可视化状态机 | 旧分析第 4.4.2 节 | 投入产出比低 |
| 向量化上下文检索 | 旧分析第 4.2.3 节 | 投入产出比低，本项目上下文规模不到 Claude Code 量级 |
| 动态加载 skill | 旧分析第 4.3.1 节 | 约束 3 业务专一，不需要动态加载 |

### 3.3 新增/强化的方向

#### 方向 F（新增）：旧原子能力回退机制清除

- **为什么新增**：第 2.2.2 节发现 `atomicCapabilities.ts` 的 `validateOrRollback` + `fallbackManager.ts` 三级回退真实存在于主链路，与约束 2 直接冲突。旧分析未识别此债务。
- **目标**：将 `validateOrRollback` 拆为 `validate`（只校验 + 暴露 `RecoverableInterpretationFailure` envelope）与 `rollback`（删除）；`fallbackManager.ts` 三级回退整体废弃；`src/types/orchestration.ts:585-651` 回退类型删除或改为失败暴露类型。
- **优先级**：P1，与方向 B 状态模型统一一起做（失败暴露路径需统一）。

---

## 4. 工程化方向（重点）

### 4.1 对标成熟 agent 的具体设计模式借鉴

| 模式 | 来源 | 借鉴方式 | 落地方向 |
|---|---|---|---|
| 失败暴露而非回滚 | Codex | 已对齐 agent 主路径；需清除旧原子能力回退路径 | 方向 F |
| 结构化失败 envelope + quick replies | Codex | envelope schema 已落地，需打通 quick reply 策略化重试 | 方向 A（A19） |
| intent → capability 直达 | Codex | `tryHandleAgentPlannerInstruction` if-else 链改为 `CapabilityRegistry.resolveAll` 统一路由 | 方向 C |
| 命令直达执行（高置信度） | Codex | 已对齐 AGENTS.md Atomic Command Policy | 无需动作 |
| 真 ReAct 自主多轮 | Claude Code | `executeReactAgentPlan` 改为单次 submit 内 plan → act → observe → decide 循环 | 方向 D |
| 有限轮次（maxTurns=4） | Claude Code | 已对齐 `reactTaskTypes.ts:72-74` | 无需动作 |
| Plan/Act 分离 | Claude Code | 已对齐 `AgentPlanner.plan` + `executeAgentPlan` | 无需动作 |
| 上下文压缩（摘要层） | Claude Code | 实现 `ContextCompressor`：保留最近 N 轮 observation + 任务目标 + 已决动作摘要 + 失败原因 | 方向 D |
| capability metadata | Trae | `CapabilityMetadata`（`supportedIntents / requiredSources / safetyGates`） | 方向 C |
| 显式状态机 | LangGraph | `PlaylistStateContract` + `VALID_TRANSITIONS` | 方向 B |
| checkpoint 持久化（非回滚） | LangGraph | `BatchCheckpointExecutor` + `LongRunningTaskStore`，仅用于进度展示与中断续跑 | 方向 D |
| LLM 调用监控聚合 | LangSmith | `LlmCallMonitor`（tokenUsage / latencyMs / cost / errorMessage / model） | 方向 E |

### 4.2 前台体验对标

| 体验点 | Codex/Claude Code 现状 | 本项目现状 | 改进方向 |
|---|---|---|---|
| 失败暴露 | 结构化 envelope + 可点击 quick replies | envelope 已显示，但 quick reply 只填输入框（A19） | 方向 A：实现 `switch_strategy / broaden_target / narrow_target / resubmit` 策略化重试 |
| 停止按钮 | 立即中止 LLM 调用 | `orchestrator.ts:388-394` 只设 `isCancelled = true`，不联动 AbortController | 方向 D：老 `Orchestrator.cancel()` 改为调用 `AgentDeadline.abort()`；过渡期短链路先接入 |
| 进度可视化 | 进度条 + 当前步骤 + 已处理/剩余 | 无 `LongRunningProgress.vue` | 方向 D：抽取 `LongRunningProgress.vue`，展示批次索引 + 已处理/剩余数量 |
| 批次边界 | 显示批次索引 + checkpoint | `AgentExecutionCheckpoint` 已定义结构但 UI 不展示 | 方向 D：UI 展示 checkpoint 时间线 |
| 候选推荐 | 结构化 card + 匹配分数 + 匹配原因 + "为什么是它" | `el-radio-group` 列表（A20） | 方向 A：抽取 `CandidateRecommendationPanel.vue`，展示 `programName / programCode / duration / score / reasonTags / confidence / whyThisOne / actions` |
| 草案 diff 面板 | 显示 diff + 时间冲突预警 | 未实现 | 方向 B：抽取 `DraftDiffPanel.vue` |
| 流式输出 | SSE 流式 + 批量回放双路径 | 已有 path A 流式 + path B 批量回放（`agentRuntimeClient.ts`） | 已对齐，需保持 |
| 上下文管理 | 显示当前任务目标 + 已决动作摘要 | 部分实现（`reactTaskBoundary`） | 方向 D：UI 展示压缩前后状态 |

### 4.3 工程化基线

| 基线项 | 现状 | 目标 | 落地方向 |
|---|---|---|---|
| 测试门禁 | `agent:check:tests` 已纳入长流程测试（A16 已完成） | 保持；新增方向 F 回退清除 case | 方向 A / F |
| 类型安全 | `vue-tsc --build` 已在 `build` | 保持 | 持续 |
| prompt 版本管理 | prompt 写死在 `systemPrompts.ts`，无版本号 | 所有 system prompt 显式声明版本（如 `v1.0`），trace 记录版本号 | 方向 E |
| LLM 调用监控 | 仅 trace + audit 计数 | `LlmCallMonitor` 记录 `tokenUsage / latencyMs / cost / errorMessage / model`，trace 可观察 | 方向 E |
| Token 成本核算 | 无 | `tokenCostCalculator.ts` + `MODEL_PRICING` + `calculateCost` | 方向 E |
| 错误监控上报 | 无 | `ErrorMonitor.report`，仅上报 `kind / traceId / noMutation`，不上报用户原始输入 | 方向 E |
| 真实 LLM 评估基线 | `agent:eval:llm` 入口已存在（`package.json:32`） | 建立 taskKind 返回准确率、envelope 触发率、quick reply 采用率基线 | 方向 E |
| 密钥扫描 | AGENTS.md 已约束 | 提交前 `git diff` 扫描 `api_key / token / secret` | 持续 |

### 4.4 明确的优先级和实施顺序

**优先级排序原则**：
1. 已投入未产出的债务优先（方向 A 收尾）
2. 阻断其他方向的基础设施优先（方向 E 工程化基线并行）
3. 真实架构债优先（方向 F 回退清除）
4. 大文件拆分优先（方向 C Capability 拆分，为方向 D 铺垫）
5. 长流程稳定性（方向 D，依赖方向 C 的 `FormalOrchestrationCapability`）
6. 状态模型统一（方向 B，可与方向 F 合并）

**推荐排序**：方向 A 收尾 → 方向 E（并行）→ 方向 C → 方向 D → 方向 B + 方向 F 合并。

### 4.5 旧原子能力回退机制清除（方向 F 详细化）

- **`src/services/atomicCapabilities.ts:658-674` `validateOrRollback`**：
  - 拆为 `validate(scope, actionLabel)`：只触发校验，返回 `ValidationReport` 或 `RecoverableInterpretationFailure` envelope。
  - 删除 `rollback` 参数与 `rollback()` 调用。
  - 校验失败时产出 `kind: 'validation_failed'` envelope，含 `recognizedSlots / missingSlots / candidateEvidence / retrySuggestions`，让用户决定下一步（修正 / 撤销 / 重试）。
- **`src/services/atomicCapabilities.ts:196, 248, 303, 374, 448, 555, 623`**：所有调用 `validateOrRollback` 的原子操作改为调用 `validate`，失败时返回 envelope decision，不自动回滚。
- **`src/services/fallbackManager.ts`（467 行）**：整体废弃。三级回退改为三级失败暴露（item-level / gap-level / session-level envelope），不自动恢复。
- **`src/types/orchestration.ts:585-651`**：`FallbackLevel / FallbackRecord / FallbackStrategyConfig` 改为 `FailureExposureLevel / FailureRecord / FailureExposureConfig`，或直接删除并由 `RecoverableInterpretationFailure` schema 统一。
- **`src/services/orchestrator.ts:449`、`src/services/replaceCommandExecutor.ts:122`**："已回退"消息改为"已暴露失败，请决定下一步"。
- **回归 case**：新增 `atomicCapabilities.failureExposure.test.ts`，覆盖校验失败时产出 envelope 而非回滚的场景，纳入 `agent:check:tests`。

---

## 5. 架构缺陷清单（重新核对）

基于第 2 节代码核对，重新列出真实缺陷。**不照搬旧分析 A1-A20，只列当前仍存在且需处理的缺陷。**

### 5.1 P0 缺陷（阻断其他方向）

| 缺陷 ID | 描述 | 代码证据 | 修复方向 |
|---|---|---|---|
| D1 | `AgentDeadline` 未接入主链路 | `demoRuntimeFacade.ts` / `atomicCommandCapability.ts` 无 `agentDeadline` 匹配；仅 `recoverableFailureEnvelope.test.ts` 引用 | 方向 A（A17 收尾） |
| D2 | `MutationPolicy` 未接入 write adapter | `formalPlaylistWriteAdapter.ts` 无 `mutationPolicy / assertMutationAllowed / preview_only` 匹配 | 方向 A（A17 收尾） |
| D3 | quick reply 策略化重试未实现 | `ChatPanel.vue:985-992` `handleFailureQuickReply` 只 `fill_instruction` + 清空 envelope | 方向 A（A19 收尾） |
| D4 | 候选推荐未结构化 | `ChatPanel.vue:279` 仍 `el-radio-group` | 方向 A（A20 收尾） |
| D5 | 旧原子能力回退机制存在 | `atomicCapabilities.ts:658-674` `validateOrRollback` + `fallbackManager.ts` 467 行三级回退 | 方向 F |
| D6 | 双路径并行 | `demoRuntimeFacade.ts:190, 7486` 产出 `kind: 'orchestration'`；老 `Orchestrator` 仍被 `useOrchestrator.ts` 使用 | 方向 D（依赖方向 C `FormalOrchestrationCapability`） |
| D7 | taskKind 仍依赖本地正则 | `demoRuntimeFacade.ts:7587, 7609` `resolveFormalOrchestrationTaskKind` | 方向 D（迁回 LLM，依赖方向 E 监控评估准确率） |
| D8 | `executeReactAgentPlan` 是伪 ReAct | `demoRuntimeFacade.ts:894-989` 只执行 firstAction 后返回 | 方向 D |
| D9 | 老 `Orchestrator.cancel()` 不联动 AbortController | `orchestrator.ts:388-394` 只设 `isCancelled = true` | 方向 D |
| D10 | `demoRuntimeFacade.ts` 单文件 9872 行 | 超过 AGENTS.md File Hygiene 红线 5000 行 | 方向 C |
| D11 | `atomicCommandCapability.ts` 单文件 6193 行 | 超过 AGENTS.md File Hygiene 红线 5000 行 | 方向 C |
| D12 | `ChatPanel.vue` 单文件 5864 行 | 超过 AGENTS.md File Hygiene 红线 5000 行 | 方向 A 局部拆分 + 方向 D `LongRunningProgress.vue` |

### 5.2 P1 缺陷（不阻断但需处理）

| 缺陷 ID | 描述 | 代码证据 | 修复方向 |
|---|---|---|---|
| D13 | 状态模型不统一（draft / pending / formal 无统一 owner / workspaceKey / mutationId / mutationPolicy 契约） | 状态散落在 facade if-else 链 | 方向 B |
| D14 | 长流程任务持久化未实现 | `agentServerFileSessionStore.ts` 无 `longRunning / persistedTask` 匹配 | 方向 D |
| D15 | LLM 调用不可观测 | 仅 trace + audit 计数，无 `LlmCallMonitor` | 方向 E |
| D16 | prompt 版本管理缺失 | prompt 写死在 `systemPrompts.ts`，无版本号 | 方向 E |
| D17 | timeout 分散（6s / 8s / 15s / 30s / 60s 五套） | `paramExtractor.ts:51,95,135,174`、`intentRecognizer.ts:43`、`layoutIntentRecognizer.ts:69`、`agentPlanner.ts:360`、`llmConfig.ts:10`、`layoutDraftService.ts:613,643`、`demoRuntimeFacade.ts:1600,3279,3456`、`candidateJudge.ts:57`、`llmAgentIntentInterpreter.ts:56` | 方向 A（A17 接入 `AgentDeadline` 后收敛） |

### 5.3 与旧分析 A1-A20 的映射

| 旧分析缺陷 | 本修订版缺陷 | 状态变化 |
|---|---|---|
| A1 DemoRuntimeFacade 单点瓶颈 | D10 | 行数 9864 → 9872，仍 P0 |
| A2 AtomicCommandCapability 单类过大 | D11 | 行数不变，仍 P0 |
| A3 双分发机制并行 | 并入 D6 / 方向 C | 未变 |
| A4 状态模型不统一 | D13 | 未变 |
| A5 timeout 分散 | D17 | 方向 1 缓解但未接入，仍 P1 |
| A6 preview_only 未跨模块 | D2 | 方向 1 缓解但未接入，仍 P0 |
| A7 workspaceKey 不完整 | 并入 D13 | 未变 |
| A8 失败 envelope 非结构化 | 已完成（A18） | ✅ 已解决 |
| A9 候选推荐散文输出 | D4 | 仍 P0 |
| A10 LLM 调用不可观测 | D15 | 未变 |
| A11 ChatPanel.vue 过大 | D12 | 行数 5844 → 5864，仍 P0 |
| A12 无 e2e 测试 | 不再列为缺陷 | `agent:browser:goal37/38` 已覆盖，e2e 框架延后 |
| A13 浏览器端直连 LLM | 不再列为缺陷 | 已被 `isHttpAgentRuntimeEnabled()` flag 收口 |
| A14 长流程双路径并行 | D6 | 未变 |
| A15 taskKind 本地正则 | D7 | 未变 |
| A16 长流程测试门禁未跟上 | 已完成 | ✅ 已解决 |
| A17 方向 1 未接入主链路 | D1 / D2 | 拆为 deadline 与 mutationPolicy 两项 |
| A18 失败 envelope 数据流断裂 | 已完成 | ✅ 已解决 |
| A19 quick reply 未触发重试 | D3 | 未变 |
| A20 候选推荐未结构化 | D4 | 未变 |
| —（新发现） | D5 旧原子能力回退机制 | 旧分析未识别，新增 |

---

## 6. 前台体验方向

### 6.1 ChatPanel.vue 拆分路线图

`ChatPanel.vue` 5864 行是前台体验升级的瓶颈。拆分必须渐进式，每步拆分后跑 `chatPanelQuickActions.test.ts` + `chatPanelDetails.test.ts` + 前台冒烟。

| 拆分顺序 | 抽取组件 | 取代现状 | 依赖方向 | 目标行数 |
|---|---|---|---|---|
| 1 | `CandidateRecommendationPanel.vue` | `el-radio-group`（`ChatPanel.vue:279`） | 方向 A（A20） | -300 行 |
| 2 | `FailureFormatter.vue`（已存在，完善接入） | 散文失败暴露 | 方向 A（A19） | -200 行 |
| 3 | `LongRunningProgress.vue` | 无 | 方向 D | -400 行 |
| 4 | `DraftDiffPanel.vue` | 无 | 方向 B | -300 行 |
| 5 | `PendingCommandPanel.vue` | pending command 状态机内联 | 方向 B | -500 行 |
| 6 | `HistoryDrawer.vue` | 无 | 方向 B | -200 行 |
| 目标 | `ChatPanel.vue` 只保留消息列表 + 输入框 + 路由逻辑 | — | — | < 2000 行 |

### 6.2 失败暴露前台升级

- **当前**：`FailureFormatter.vue` 已能渲染 envelope（A18 已打通），但 quick reply 只填输入框。
- **目标**：
  1. `handleFailureQuickReply`（`ChatPanel.vue:985-992`）实现 `switch_strategy / broaden_target / narrow_target / resubmit` 策略化重试：根据 `reply.action` 与 `reply.payload` 自动构造新指令并触发 `sendMessage`，不需用户手动点击发送。
  2. `fill_instruction` 保留当前行为（填输入框，用户可编辑后发送）。
  3. 失败 envelope 展示 `recognizedSlots`（已识别线索）+ `missingSlots`（缺失槽位）+ `candidateEvidence`（候选证据）+ `retrySuggestions`（重试建议）+ `quickReplies`（可点击动作）。

### 6.3 长流程进度可视化

- **当前**：`ChatPanel.vue:448-453` 有 `is-stop` 样式，但无批次进度展示。
- **目标**：
  1. 抽取 `LongRunningProgress.vue`，展示 `当前批次索引 / 总批次数 / 已处理条目数 / 剩余条目数 / 当前 stage`。
  2. 展示 `AgentExecutionCheckpoint` 时间线（已完成批次 + 当前批次 + 待处理批次）。
  3. 停止按钮联动 `AgentDeadline.abort()`（方向 D 收口后），点击后立即中止 LLM 调用与 fetch 请求，状态保留在最后 checkpoint。

---

## 7. 实施路线图

### 7.1 阶段 1：方向 A 收尾 + 方向 E 并行（2-3 周）

**目标**：让方向 1 已落地的 4 个文件真正生效，让 quick reply 真正触发，让候选推荐结构化，建立 LLM 调用监控。

**任务清单**：
1. D1 `AgentDeadline` 接入主链路：`demoRuntimeFacade.ts` 与 `atomicCommandCapability.ts` 中所有 LLM 调用点用 `stageTimeoutMs(STAGE_TIMEOUT_BUDGET.*)` 替换写死 timeout（3 天）。
2. D2 `MutationPolicy` 接入 write adapter：`formalPlaylistWriteAdapter.ts` 接入 `assertMutationAllowed`，`preview_only` 时抛 `PreviewOnlyViolationError`（1 天）。
3. D3 quick reply 策略化重试：`ChatPanel.vue:985-992` `handleFailureQuickReply` 实现 `switch_strategy / broaden_target / narrow_target / resubmit`（2 天）。
4. D4 候选推荐结构化 card：抽取 `CandidateRecommendationPanel.vue`，取代 `el-radio-group`（3 天）。
5. D15 `LlmCallMonitor`：新建 `src/services/agent/llmCallMonitor.ts`，`llmClient.ts:91-135` 接入审计（2 天）。
6. D16 prompt 版本管理：`systemPrompts.ts` 所有 prompt 显式声明版本，trace 记录版本号（1 天）。
7. D17 timeout 收敛：依赖 D1 完成后，删除散落 timeout（1 天）。

**验证门禁**：
- `npm run agent:check`（含长流程测试）
- `npm run build`
- 前台冒烟：触发 LLM 超时（mock），验证 `FailureFormatter` 显示 `recognizedSlots / missingSlots / quickReplies`；点击 quick reply 验证自动重试；候选推荐展示结构化 card。

### 7.2 阶段 2：方向 C Capability 拆分（4-6 周）

**目标**：按 intent 拆分 `AtomicCommandCapability`，统一分发机制，为方向 D 双路径收口铺垫。

**任务清单**：
1. 按 intent 拆分 `atomicCommandCapability.ts`（6193 行）为 `moveCapability.ts / insertCapability.ts / replaceCapability.ts / deleteCapability.ts / batchMoveCapability.ts / batchDeleteCapability.ts / queryCapability.ts / validateCapability.ts`，每个不超过 2000 行。
2. 每个子 capability 注册到 `CapabilityRegistry`，声明 `CapabilityMetadata`。
3. `demoRuntimeFacade.ts` `tryHandleAgentPlannerInstruction`（line 649）的 if-else 链改为 `CapabilityRegistry.resolveAll` 统一路由。
4. `demoRuntimeFacade.ts`（9872 行）局部瘦身：把编排执行逻辑迁入 `FormalOrchestrationCapability`（为方向 D 铺垫），facade 只保留 submit 主循环与 decision 路由。
5. 补回归 case：每个子 capability 单测 + `capability_route_conflict` 全路径生效。

**验证门禁**：
- `npm run agent:check`
- `npm run build`
- 前台冒烟：所有原子命令（移动 / 插入 / 替换 / 删除 / 批量）行为不变。

### 7.3 阶段 3：方向 D 长流程稳定性增强（5-7 周）

**目标**：双路径收口、真 ReAct 自主多轮、taskKind 迁回 LLM、UI 停止按钮联动、长流程任务持久化、上下文压缩。

**任务清单**：
1. D6 双路径收口：`FormalOrchestrationCapability`（阶段 2 已创建）取代老 `Orchestrator`，`useOrchestrator.ts` 改为调用 capability。
2. D8 真 ReAct 自主多轮：`executeReactAgentPlan`（`demoRuntimeFacade.ts:894-989`）改为单次 submit 内 plan → act → observe → decide 循环，每轮回判 LLM，`maxTurns=4` 上限。
3. D7 taskKind 迁回 LLM：`formal_orchestration` action 增加 `taskKind` 字段，由 LLM 直接返回 `full_day / local_refill / overall_refill`；本地 `assertTaskKindFromLlm` 只做结构校验与失败暴露，不做正则兜底。
4. D9 UI 停止按钮联动：老 `Orchestrator.cancel()` 改为调用 `AgentDeadline.abort()`；`AbortSignal` 联动到 LLM 调用与 fetch 请求。
5. D14 长流程任务持久化：`AgentServerFileSessionStore` 增加 `PersistedLongRunningTask`，跨小时 / 跨天可恢复（仅恢复进度，不回滚状态）。
6. 上下文压缩：实现 `ContextCompressor`，保留最近 N 轮 observation + 任务目标 + 已决动作摘要 + 失败原因，幂等可重放。
7. 抽取 `LongRunningProgress.vue`，展示批次进度 + checkpoint 时间线。

**验证门禁**：
- `npm run agent:check`（含 `demoRuntimeFacade.fullGenerateBootstrap.test.ts` + `orchestrator.test.ts`）
- `npm run agent:browser:goal37` + `npm run agent:browser:goal38`
- 真实 LLM 评估：`npm run agent:eval:llm`，建立 taskKind 返回准确率基线。

### 7.4 阶段 4：方向 B + 方向 F 合并（3-4 周）

**目标**：统一 draft / pending / formal 状态机，清除旧原子能力回退机制。

**任务清单**：
1. D13 `PlaylistStateContract` + `VALID_TRANSITIONS`：显式状态机，所有状态转换走契约校验。
2. D5 旧原子能力回退清除：
   - `atomicCapabilities.ts:658-674` `validateOrRollback` 拆为 `validate`（只校验 + 暴露 envelope）与 `rollback`（删除）。
   - `fallbackManager.ts`（467 行）整体废弃，三级回退改为三级失败暴露。
   - `src/types/orchestration.ts:585-651` 回退类型改为失败暴露类型或删除。
   - `orchestrator.ts:449`、`replaceCommandExecutor.ts:122` "已回退"消息改为"已暴露失败"。
3. 抽取 `DraftDiffPanel.vue` + `HistoryDrawer.vue` + `PendingCommandPanel.vue`。
4. `FailureExposer` 复用阶段 1 已接入的 `RecoverableInterpretationFailure` schema。
5. 补回归 case：`atomicCapabilities.failureExposure.test.ts`，纳入 `agent:check:tests`。

**验证门禁**：
- `npm run agent:check`
- `npm run build`
- 前台冒烟：原子操作校验失败时显示 envelope 而非自动回滚；点击 quick reply 验证重试。

### 7.5 路线图汇总

| 阶段 | 方向 | 周期 | 关键交付 | 阻断什么 |
|---|---|---|---|---|
| 1 | A 收尾 + E 并行 | 2-3 周 | quick reply 策略化、候选 card、AgentDeadline 接入、LlmCallMonitor | 阻断方向 D（无监控无法评估 taskKind 准确率） |
| 2 | C Capability 拆分 | 4-6 周 | 8 个子 capability、统一分发、`FormalOrchestrationCapability` | 阻断方向 D（无双路径收口位置） |
| 3 | D 长流程稳定性 | 5-7 周 | 真 ReAct、双路径收口、taskKind 迁回 LLM、停止按钮联动、任务持久化 | 阻断前台长流程体验 |
| 4 | B + F 合并 | 3-4 周 | 状态机统一、回退机制清除、DraftDiffPanel | 阻断状态污染与回退债务 |

---

## 8. 风险与权衡

### 8.1 方向 F 回退清除可能引入主链路回归

- **风险**：`atomicCapabilities.ts` 的 `validateOrRollback` 被 7 处原子操作调用，清除回退后校验失败会暴露 envelope 而非自动恢复，可能改变现有测试预期。
- **权衡**：
  - 先补回归 case `atomicCapabilities.failureExposure.test.ts`，覆盖所有 7 处调用点的校验失败路径。
  - 渐进式清除：先拆 `validate` 与 `rollback`，保留 `rollback` 函数但不在主路径调用，最后删除。
  - 每步清除后跑 `npm run agent:check` 全量回归。
- **残余风险**：用户已习惯"校验失败自动回滚"的行为，改为"暴露失败让用户决定"需要用户教育。通过 `FailureFormatter` 的 quick reply 降低摩擦。

### 8.2 taskKind 迁回 LLM 后的稳定性

- **风险**：LLM 可能不稳定返回 taskKind（例如把"补空窗"识别为"全天编排"），本地校验无法发现。
- **权衡**：
  - 严格遵守 AGENTS.md：本地只做结构校验与失败暴露，不做正则兜底。
  - LLM 未返回 taskKind 或返回非法值时，暴露 `llm_intent_unavailable` envelope。
  - 在方向 E `LlmCallMonitor` 落地后，建立 taskKind 返回准确率基线，低于阈值时优化 prompt 而非加本地兜底。
- **残余风险**：LLM 在边界场景下稳定返回错误 taskKind。通过 UI 停止按钮及时中止 + 真实 LLM 评估基线发现与修正。

### 8.3 双路径收口过渡期风险

- **风险**：方向 D 双路径收口过渡期，`facade_drives_orchestrator` 模式下老 `Orchestrator.cancel()` 与 facade 的 `AgentDeadline.abort()` 双信号源不一致。
- **权衡**：
  - 阶段 1 先把 `AgentDeadline.abort()` 接入短链路 LLM 调用。
  - 阶段 3 双路径收口时，老 `Orchestrator.cancel()` 改为调用 `AgentDeadline.abort()`，统一信号源。
  - 过渡期短链路与长流程的停止信号仍独立，但都已联动 AbortController。
- **残余风险**：过渡期长流程停止后，老 `Orchestrator` 内部的 LLM 调用仍可能继续执行。通过阶段 3 双路径收口消除。

### 8.4 ChatPanel.vue 拆分可能引入前台回归

- **风险**：5864 行拆分涉及大量状态迁移，可能引入 UI 渲染回归。
- **权衡**：
  - 渐进式拆分：阶段 1 先抽取 `CandidateRecommendationPanel.vue` + `FailureFormatter.vue`；阶段 3 抽取 `LongRunningProgress.vue`；阶段 4 抽取 `DraftDiffPanel.vue` + `HistoryDrawer.vue` + `PendingCommandPanel.vue`。
  - 每步拆分后跑 `chatPanelQuickActions.test.ts` + `chatPanelDetails.test.ts` + 前台冒烟。
- **残余风险**：拆分后状态传递可能丢失。通过 `agent:browser:goal37/38` 覆盖。

---

## 9. 与 AGENTS.md 的对齐声明

- **LLM-first**：方向 D taskKind 迁回 LLM 是对齐 LLM-first 的修复；方向 F 回退清除不引入本地兜底正则。
- **本地只保护结果**：`AgentDeadline` / `MutationPolicy` / `assertMutationAllowed` / `assertTaskKindFromLlm` 都是保护结果，不改写意图。
- **暴露失败不假装理解**：`RecoverableInterpretationFailure` envelope 是结构化失败暴露；方向 F 清除回退机制后，所有失败统一走 envelope。
- **渐进式演进**：方向 A 收尾采用渐进式（先 deadline，再 mutationPolicy，再 quick reply）；方向 C 拆分按 intent 逐步迁出；方向 F 回退清除先拆 `validate` / `rollback` 再删除。
- **Scheduling Guardrails**：方向 B 状态机统一把 guardrails 落到 `VALID_TRANSITIONS`；`workspaceKey` 全链路一致在状态契约中强制。
- **Atomic Command Policy By Playlist Type**：方向 C Capability 拆分保留电视播单直接执行、轮播单候选推荐、删除始终确认的策略。
- **Agent Architecture**：方向 C 只保留按 intent 拆分 + 统一分发 + `FormalOrchestrationCapability`，不叠加子 agent 雏形；方向 D 真 ReAct 循环对齐"禁止伪 ReAct"。
- **File Hygiene**：方向 C 拆分后 `demoRuntimeFacade.ts` / `atomicCommandCapability.ts` / `ChatPanel.vue` 均低于红线。
- **Verification Gates**：每个阶段都包含 `agent:check` + `build` + 前台冒烟 + 浏览器回归。
- **不引入回退**：方向 F 清除旧原子能力回退机制；方向 D checkpoint 持久化仅用于进度展示与中断续跑，不用于回滚。
- **不引入子 agent**：方向 C 只保留按 intent 拆分 capability + 统一分发。

---

## 章节目录

1. 修订背景
   - 1.1 3 条新约束对旧方案的影响摘要
   - 1.2 已完成的工作（不再列入路线图）
   - 1.3 本文档定位
2. 代码现状核对
   - 2.1 全天编排 / 全天补全 / 草案融入情况（核对约束 1）
   - 2.2 回退相关代码现状（核对约束 2）
   - 2.3 子 agent 相关代码现状（核对约束 3）
   - 2.4 其他关键代码现状核对
3. 修订后的方向集
   - 3.1 保留的方向
   - 3.2 删除的方向
   - 3.3 新增/强化的方向
4. 工程化方向（重点）
   - 4.1 对标成熟 agent 的具体设计模式借鉴
   - 4.2 前台体验对标
   - 4.3 工程化基线
   - 4.4 明确的优先级和实施顺序
   - 4.5 旧原子能力回退机制清除（方向 F 详细化）
5. 架构缺陷清单（重新核对）
   - 5.1 P0 缺陷
   - 5.2 P1 缺陷
   - 5.3 与旧分析 A1-A20 的映射
6. 前台体验方向
   - 6.1 ChatPanel.vue 拆分路线图
   - 6.2 失败暴露前台升级
   - 6.3 长流程进度可视化
7. 实施路线图
   - 7.1 阶段 1：方向 A 收尾 + 方向 E 并行
   - 7.2 阶段 2：方向 C Capability 拆分
   - 7.3 阶段 3：方向 D 长流程稳定性增强
   - 7.4 阶段 4：方向 B + 方向 F 合并
   - 7.5 路线图汇总
8. 风险与权衡
9. 与 AGENTS.md 的对齐声明
