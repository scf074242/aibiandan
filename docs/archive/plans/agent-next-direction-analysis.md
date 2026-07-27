# Agent 下一步发展方向整体分析

- 作者：solution-architect
- 日期：2026-06-28
- 状态：待用户确认
- 适用范围：aibiandan agent 编排系统（电视播单 + 轮播单）
- 关联文档：`docs/agent-evolution-roadmap-proposal.md`（v2，部分论断已过期，见第 2 节核对）、`docs/agent-development-protocol.md`、`AGENTS.md`
- 核对基准：本文档所有论断均以 2026-06-28 当日代码为准，不依赖任何 md 文档描述。

---

## 1. 背景与约束

### 1.1 用户战略问题

> 继续整体分析，下一步的 agent 该朝着什么方向发展（目标：足够强大智能，能承接用户的各种节目编排需求，设计上参考现有成熟 agent 已经足以满足需求，包括前台体验也是），架构方面还有什么缺陷，或者需要有个更明确的工程化方向

### 1.2 用户硬约束（必须严格遵守）

1. **当前全天编排、全天补全、草案都是已融入到整体流程的**：文档记录可能落后，需以代码为准。
2. **不需要回退功能**：参考 Codex 模式，失败就暴露失败让用户重试或补充，不做自动回滚、不做 mutation journal。
3. **不需要子 agent**：当前项目本身就是典型的子 agent，不再叠加 DraftAgent/CandidateAgent/SelectionAgent 等子 agent 雏形。

### 1.3 本文档的定位

本文档不是对 v2 路线图的复述，而是基于代码核对后的重新评估，回答三个问题：

- v2 路线图论断是否仍准确（哪些过期、哪些已突破）
- 方向 1 已落地但**未接入主链路**这个核心事实如何改变下一步排序
- 在"无回退/无子 agent/业务专一"约束下，下一步最优解是什么

本文档严格遵守 `AGENTS.md`：LLM-first 不可妥协、本地只保护结果不可妥协、暴露失败不假装理解不可妥协、渐进式演进不一次性大重构。

---

## 2. 代码现状核对（v2 论断 vs 实际代码）

用户明确说"文档可能落后于代码"。本节用代码证据逐条核对 v2 路线图中的关键论断，标注"已核对"或"已过期"。

### 2.1 已核对：v2 论断准确的部分

#### 2.1.1 `formal_orchestration` action 在 AgentPlanner 中存在

- **v2 论断**：长流程 `formal_orchestration` action 在 `src/services/llm/agentPlanner.ts:44-48`。
- **实际代码**：`src/services/llm/agentPlanner.ts:43-48`，action 类型定义完整，包含 `mode / useLayoutDraft / targetTimeRange` 三个字段。
- **关键差异**：`formal_orchestration` action **没有 `taskKind` 字段**，LLM 只能返回 `mode`（`full_generate` / `partial_generate`），不能直接返回 `full_day_arrange / overall_refill / fill_gap` 等 taskKind。这印证了 v2 论断 A15：taskKind 仍依赖本地正则识别。

#### 2.1.2 DemoRuntimeFacade bootstrap 门禁链路完整存在

- **v2 论断**：`DemoRuntimeFacade` 已实现完整 bootstrap 门禁链路（空草案阻拦、部分草案引导、频道默认草案复用、轮播草案缺失阻拦、已有节目重编确认，`src/services/runtime/demoRuntimeFacade.ts:7569-7622`）。
- **实际代码**：
  - `resolveFormalOrchestrationBasis`（`demoRuntimeFacade.ts:7569-7598`）：解析 taskKind / playlistModel / requiresLayoutDraft / layoutDraft / completeness。
  - `buildMissingFormalOrchestrationBasisBlock`（`demoRuntimeFacade.ts:7625` 起）：空草案阻拦、部分草案引导、轮播草案缺失阻拦。
  - `buildFormalOrchestrationLifecycle`（`demoRuntimeFacade.ts:7612-7623`）：声明 taskKind / playlistModel / canInterrupt / writesFormalPlaylist / mutatesLayoutDraft / suggestedBatchSize。
  - `shouldRequireFormalRebuildConfirmation`（`demoRuntimeFacade.ts:7510-7515`）：已有节目重编确认（`mode === 'full_generate' && existingItemCount > 0`）。
  - `buildFormalRebuildConfirmationDecision`（`demoRuntimeFacade.ts:7521` 起）：产出 pending confirmation decision。
  - 频道默认草案复用：`suggestedActions: ['加载当前频道默认草案', '上传版面文件', '切换到已有草案', '改为局部补排']`（`demoRuntimeFacade.ts:7725`）。
- **结论**：bootstrap 门禁链路确实闭环，与 v2 论断一致。

#### 2.1.3 草案三件套（prepare/refine/commit）闭环

- **v2 论断**：版面草案三件套（prepare / refine / commit）已闭环且与正式播单隔离明确。
- **实际代码**：
  - `prepareLayoutDraft`（`demoRuntimeFacade.ts:8177`）
  - `commitLayoutDraft`（`demoRuntimeFacade.ts:8674`）
  - `refineLayoutDraft` 通过 `action.type === 'refine_layout_draft'` 分支处理（`demoRuntimeFacade.ts:744-745`、`1633`、`1716`、`1750`、`1777`）。
- **结论**：草案三件套确实闭环。

#### 2.1.4 `resolveFormalOrchestrationTaskKind` 仍依赖本地正则

- **v2 论断**：`resolveFormalOrchestrationTaskKind`（`demoRuntimeFacade.ts:7608`）仍依赖本地正则识别 taskKind，违背 LLM-first。
- **实际代码**：`demoRuntimeFacade.ts:7600-7610`，正则识别 `full_day / local_refill / overall_refill`：
  ```
  if (mode === 'full_generate' || /(全天|整天|全日)/.test(normalized)) return 'full_day'
  const hasLocalRange = ... || /(上午|中午|午间|下午|晚间|晚上|夜间|黄金时段|黄金档|七点档|八点档|局部补排)/.test(normalized)
  if (hasLocalRange) return 'local_refill'
  if (/(补齐|补排|补全|补掉|填充|填满).*(全部|所有|...)/.test(normalized)) return 'overall_refill'
  return 'local_refill'
  ```
- **结论**：v2 论断 A15 准确，本地正则在 LLM 之前/之后改写了 taskKind，违背 LLM-first。

#### 2.1.5 双路径并行真实存在

- **v2 论断**：facade 产出 `kind: 'orchestration'` decision 后不执行编排，实际多时段编排执行依赖老 `Orchestrator` 类（`src/services/orchestrator.ts:199`，独立路径，未被 facade 引用）。
- **实际代码**：
  - `demoRuntimeFacade.ts` 全文搜索 `orchestrator|Orchestrator` **无任何匹配**（facade 完全不引用 Orchestrator 类）。
  - facade 产出 `kind: 'orchestration'` decision（`demoRuntimeFacade.ts:189` 类型定义、`7477` 实际产出），包含 `orchestrationRequest` 字段。
  - `ChatPanel.vue:1762, 1807` 通过 `emit('orchestrateRequested', decision.orchestrationRequest)` 抛给父组件。
  - `views/broadcast-plan/create.vue:590, 591` 接收 `@orchestrate-requested="handleChatOrchestrateRequested"`。
  - `views/broadcast-plan/useBroadcastPlanOrchestration.ts:160-188` 中 `handleChatOrchestrateRequested` 调用 `startOrchestrationRuntime`，最终由 `composables/useOrchestrator.ts` 创建 `Orchestrator` 实例执行编排。
  - 老 Orchestrator 类只被 `composables/useOrchestrator.ts:13`、`services/__tests__/openClawToOrchestrator.tvSequence.test.ts:11`、`services/__tests__/orchestrator.test.ts:3` 引用。
- **结论**：v2 论断 A14 准确，双路径并行真实存在。facade 产出请求 → 前台 emit → useOrchestrator 启动老 Orchestrator，整个编排生命周期在 facade 之外。

#### 2.1.6 CapabilityRegistry 只注册 AtomicCommandCapability

- **v2 论断**：`CapabilityRegistry` 只注册 `AtomicCommandCapability`。
- **实际代码**：
  - `services/agent/capabilityRegistry.ts`：仅提供 `register / list / resolve / resolveAll` 方法。
  - `services/agent/schedulingAgentRuntime.ts:77-78`：
    ```
    const capabilities = options.capabilities ?? [new AtomicCommandCapability()]
    capabilities.forEach((capability) => this.registry.register(capability))
    ```
- **结论**：v2 论断 A3 准确，registry 侧只注册了一个 capability。

#### 2.1.7 reactTaskRuntime 的 maxTurns/batchSize 配置

- **v2 论断**：maxTurns=4、batchSize=5 已定义。
- **实际代码**：
  - `services/runtime/reactTaskTypes.ts:72-74`：
    ```
    export const DEFAULT_REACT_TASK_LIMITS: ReactTaskLimits = {
      maxTurns: 4,
      batchSize: 5,
    }
    ```
  - `services/runtime/reactTaskRuntime.ts:43-44`：使用 `clampLimit(input.plannerTask.maxTurns, DEFAULT_REACT_TASK_LIMITS.maxTurns, 1, 5)` 与 `clampLimit(input.plannerTask.batchSize, DEFAULT_REACT_TASK_LIMITS.batchSize, 1, 10)`。
- **结论**：v2 论断准确。

#### 2.1.8 `agent:check:tests` 列表中长流程测试未纳入

- **v2 论断**：`demoRuntimeFacade.fullGenerateBootstrap.test.ts` 与 `orchestrator.test.ts` 均不在 `agent:check:tests` 列表中。
- **实际代码**：`package.json:29` 的 `agent:check:tests` 完整列表中：
  - **包含**：`recoverableFailureEnvelope.test.ts`（方向 1 测试已纳入）。
  - **不包含**：`demoRuntimeFacade.fullGenerateBootstrap.test.ts`、`orchestrator.test.ts`、`openClawToOrchestrator.tvSequence.test.ts`（长流程测试仍未纳入）。
- **结论**：v2 论断 A16 准确。

### 2.2 已过期：v2 论断失准的部分

#### 2.2.1 ChatPanel.vue 路径与行数均过期

- **v2 论断**：`src/views/ChatPanel.vue` 5100+ 行。
- **实际代码**：文件路径为 `src/components/dialogue/ChatPanel.vue`，**5844 行**（v2 说 5100+，实际增长约 14%）。
- **影响**：v2 路线图 A11 缺陷严重程度被低估。前台单文件复杂度比 v2 描述更高。

#### 2.2.2 DemoRuntimeFacade 行数过期

- **v2 论断**：`src/services/runtime/demoRuntimeFacade.ts` 10540 行。
- **实际代码**：**9864 行**（比 v2 描述少 676 行）。可能是 v2 撰写后做过局部拆分，但仍是单点瓶颈。

#### 2.2.3 AtomicCommandCapability 行数过期

- **v2 论断**：`src/services/agent/atomicCommandCapability.ts` 6630+ 行。
- **实际代码**：**6193 行**（比 v2 描述少约 440 行）。可能是 `candidateSearchRetryService.ts` 已抽取部分逻辑（见 `candidateSearchRetryService.ts:223, 269, 290, 324, 377` 注释"纯重构"）。

#### 2.2.4 AgentServerSessionStore 路径过期

- **v2 论断**：`src/services/agent/agentServerSessionStore.ts`。
- **实际代码**：实际路径为 `src/services/runtime/agentServerSessionStore.ts`，且 `AgentServerFileSessionStore extends AgentServerSessionStore`（`src/services/runtime/agentServerFileSessionStore.ts:79`）提供 file persist 能力（`writeFileSync` 等）。
- **影响**：v2 路线图文件索引需更新。

#### 2.2.5 timeout 分散情况部分过期

- **v2 论断**：6s / 8s / 12s / 15s / 30s / 60s / 140s 多套并存。
- **实际代码**：搜索 `timeout:\s*\d+_?000` 仅发现 **6s / 8s / 15s / 30s / 60s** 五套（在 `paramExtractor.ts:51,95,135,174`、`intentRecognizer.ts:43`、`layoutIntentRecognizer.ts:69`、`agentPlanner.ts:360`、`llmConfig.ts:10`、`layoutDraftService.ts:613,643`、`demoRuntimeFacade.ts:1600,3279,3456`、`candidateJudge.ts:57`、`llmAgentIntentInterpreter.ts:56` 等）。**未见 12s 与 140s**。
- **结论**：v2 论断 A5 部分过期，但 timeout 分散问题仍真实存在（5 套并存）。

#### 2.2.6 浏览器端直连 LLM 部分准确

- **v2 论断**：A13 浏览器端直连 LLM，与 Goal 39/40 服务端优先冲突。
- **实际代码**：
  - `services/llm/llmClient.ts:91-135`：`LLMClient.chat` 直接调用 `this.client.chat.completions.create`（OpenAI SDK），可在浏览器端运行。
  - `components/dialogue/ChatPanel.vue:1373-1385`：通过 `isHttpAgentRuntimeEnabled()` 双路径判断，true 时使用服务端代理，false 时调用浏览器端 `resolveLLMReadiness`。
  - `components/llm/LLMConfigPanel.vue:99-101`：`testConnection` 在浏览器端直接调用 `getLLMClient().testConnection()`。
  - 多个 service 文件（`intentRecognizer.ts:23`、`paramExtractor.ts:36`、`candidateSelectionService.ts:71`、`candidateJudge.ts:54`、`layoutDraftService.ts:610,640`、`agentPlanner.ts:357`、`orchestrator.ts:436` 等）都通过 `llmClient.chat` 调用 LLM，是否在浏览器端运行取决于 `isHttpAgentRuntimeEnabled()` flag。
- **结论**：v2 论断 A13 部分准确。浏览器端直连 LLM 能力仍存在，但已被 `isHttpAgentRuntimeEnabled()` flag 收口（默认走服务端代理）。需要继续推进服务端化，但不是当前最紧急的问题。

### 2.3 v2 未识别的新缺陷（关键发现）

本节是本次核对的最重要发现，**改变了下一步排序的优先级**。

#### 2.3.1 方向 1 落地的 4 个文件没有真正接入主链路

- **现象**：
  - `src/services/agent/agentDeadline.ts`：仅被 `src/services/__tests__/recoverableFailureEnvelope.test.ts` 引用。
  - `src/services/agent/mutationPolicy.ts`：仅被 `src/services/__tests__/recoverableFailureEnvelope.test.ts` 引用。
  - `src/services/agent/recoverableFailureEnvelope.ts`：被 `failureEnvelopeFormatter.ts` 与 `FailureFormatter.vue` 引用。
  - `src/services/agent/failureEnvelopeFormatter.ts`：被 `FailureFormatter.vue` 引用。
  - **`demoRuntimeFacade.ts` 与 `atomicCommandCapability.ts` 完全不引用上述 4 个文件**（搜索 `recoverableFailure|RecoverableInterpretationFailure|mutationPolicy|agentDeadline` 在这两个文件中均无匹配）。
- **后果**：
  - `AgentDeadline`、`STAGE_TIMEOUT_BUDGET`、`LONG_RUNNING_DEADLINE_BUDGET`、`MutationPolicy`、`assertMutationAllowed` 等"已落地"的能力在主链路中**完全无效**。
  - 主链路仍使用散落的 `timeout: 6000 / 8000 / 30000` 等写死值，未受统一 deadline 管理。
  - 写屏障 `assertMutationAllowed` 未在 write adapter 入口校验，`preview_only` 仍是字段级约定，未跨模块硬约束。
- **判断**：方向 1 完成了"接口与单测"，但没有完成"主链路接入"。v2 路线图把方向 1 标记为"已完成"是失准的，实际是"已完成骨架，未完成接入"。

#### 2.3.2 ChatPanel.vue 中 `recoverableFailureEnvelope.value` 永远是 null

- **现象**：搜索 `recoverableFailureEnvelope\.value\s*=` 仅在 `ChatPanel.vue:990` 找到一处赋值 `recoverableFailureEnvelope.value = null`（清空）。
- **后果**：
  - `<FailureFormatter v-if="recoverableFailureEnvelope" :envelope="recoverableFailureEnvelope" />`（`ChatPanel.vue:411-413`）的 v-if **永远为 false**。
  - `FailureFormatter.vue` 组件虽然存在，但**永远不会被渲染**。
- **根因**：后台（`demoRuntimeFacade.ts`）产出的是旧式散文式失败暴露（`buildRecoverableLlmFailureDecision`，`demoRuntimeFacade.ts:610-638`），返回 `kind: 'message'` decision，包含 `feedback.details.llmFailure / recoverableUserInput / canRetry / noMutation`，**不是结构化 `RecoverableInterpretationFailure` envelope**。前台 `extractRecoverableRuntimeFailure`（`ChatPanel.vue:1411`）从 details 中提取的是简单 `RecoverableRuntimeFailure`（`originalUserInput / workspaceKey / createdAt`，`ChatPanel.vue:634-638`），不包含 `recognizedSlots / missingSlots / candidateEvidence / retrySuggestions / quickReplies`。
- **判断**：方向 1 完成了"渲染入口"，但没有完成"数据流"。FailureFormatter 永远收不到数据，quick reply 永远不会触发。

#### 2.3.3 canQuickRetry 与 quick reply 未接入重试链路

- **现象**：`ChatPanel.vue:984-991` 的 `handleFailureQuickReply` 实现：
  ```
  const handleFailureQuickReply = (reply: QuickReply) => {
    const payload = (reply.payload ?? {}) as { value?: unknown; slot?: string; strategy?: string }
    if (reply.action === 'fill_instruction' && payload.value !== undefined && typeof payload.value === 'string') {
      inputMessage.value = payload.value
    }
    // 清空失败信封（无论何种 action，处理完都关闭失败信封）
    recoverableFailureEnvelope.value = null
  }
  ```
- **后果**：
  - quick reply 触发后只是把 `payload.value` 填到输入框，**用户仍需手动点击发送**。
  - `switch_strategy / broaden_target / narrow_target / resubmit` 等策略化重试**完全未实现**。
  - 注释明确写："具体策略化重试（broaden_target / narrow_target / resubmit）的接入留到方向 2/3 接入主链路时实现。"
- **判断**：方向 1 的"失败 quick replies"能力（v2 路线图 5.4 节）**未真正交付**。

#### 2.3.4 候选推荐仍是 el-radio 列表，不是结构化 card

- **v2 路线图设计**：`CandidateRecommendationCard` 包含 `programName / programCode / duration / score / reasonTags / confidence / whyThisOne / actions` 等结构化字段。
- **实际代码**：`ChatPanel.vue:279-288` 候选推荐使用 `el-radio-group` + `el-radio`：
  ```
  <el-radio-group v-model="pendingAtomicTargetSelectedItemId" class="target-selection-list">
    <el-radio v-for="candidate in pendingAtomicTargetCandidates" :key="candidate.id" :value="candidate.id" class="target-selection-option">
      {{ formatDisplayTimeRange(candidate.startTime, candidate.endTime) }} {{ candidate.programName || candidate.programCode || candidate.id }}
    </el-radio>
  </el-radio-group>
  ```
- **后果**：用户只看到节目名 + 时间段，看不到匹配分数、匹配原因标签、"为什么是它"摘要。无法进入编排闭环（点击后只能选择目标，不能直接确认候选）。
- **判断**：v2 路线图 10.2 节的"候选推荐结构化 card"**完全未交付**。

#### 2.3.5 老 Orchestrator.cancel() 不联动 AbortController

- **现象**：`services/orchestrator.ts:388-394`：
  ```
  cancel(): void {
    this.isCancelled = true
    if (this.session) {
      this.log('warn', 'session', '用户已请求中止当前编排任务')
      this.updateStatus('cancelled')
    }
  }
  ```
- **后果**：cancel() 只设 `isCancelled = true` 标志位，**不会中止正在进行的 LLM 调用或 fetch 请求**。用户点击停止后，后台 LLM 调用仍会继续执行到完成或超时。
- **判断**：v2 路线图 8.10 节"UI 停止按钮"问题真实存在，且与方向 1 的 `AgentDeadline.abort()`（已实现但未接入）形成双信号源不一致。

#### 2.3.6 长流程任务持久化未实现

- **现象**：搜索 `agentServerFileSessionStore.ts` 中的 `longRunning|LongRunning|persistedTask|taskStore` **无任何匹配**。
- **后果**：`AgentServerFileSessionStore` 只做 session 状态持久化（`AgentServerSessionState`），**不持久化长流程任务**（无 `PersistedLongRunningTask` / `LongRunningTaskStore`）。
- **判断**：v2 路线图 8.9 节"任务持久化"完全未实现，长流程任务跨小时/跨天不可恢复。

### 2.4 核对结果汇总表

| v2 论断 | 核对结果 | 代码证据 |
|---|---|---|
| formal_orchestration action 在 agentPlanner.ts:44-48 | ✅ 准确（实际 43-48） | `src/services/llm/agentPlanner.ts:43-48` |
| DemoRuntimeFacade bootstrap 门禁链路完整 | ✅ 准确 | `demoRuntimeFacade.ts:7569-7622, 7510-7515, 7521+, 7625+, 7704, 7725` |
| 草案三件套（prepare/refine/commit）闭环 | ✅ 准确 | `demoRuntimeFacade.ts:8177, 8674, 744-745` |
| resolveFormalOrchestrationTaskKind 仍依赖本地正则 | ✅ 准确 | `demoRuntimeFacade.ts:7600-7610` |
| 双路径并行（facade 不执行编排） | ✅ 准确 | `demoRuntimeFacade.ts` 无 Orchestrator 引用；`ChatPanel.vue:1762, 1807` emit；`useBroadcastPlanOrchestration.ts:160-188` 接收 |
| CapabilityRegistry 只注册 AtomicCommandCapability | ✅ 准确 | `schedulingAgentRuntime.ts:77-78` |
| reactTaskRuntime maxTurns=4, batchSize=5 | ✅ 准确 | `reactTaskTypes.ts:72-74` |
| AgentServerSessionStore 持久化机制 | ⚠️ 路径过期 | 实际在 `src/services/runtime/`，file persist 已实现，长流程任务持久化未实现 |
| timeout 6s/8s/12s/15s/30s/60s/140s 多套 | ⚠️ 部分过期 | 实际 6s/8s/15s/30s/60s 五套，无 12s/140s |
| ChatPanel.vue 在 src/views/ 5100+ 行 | ❌ 过期 | 实际 `src/components/dialogue/ChatPanel.vue`，5844 行 |
| demoRuntimeFacade.ts 10540 行 | ❌ 过期 | 实际 9864 行 |
| atomicCommandCapability.ts 6630+ 行 | ❌ 过期 | 实际 6193 行 |
| agent:check:tests 未纳入长流程测试 | ✅ 准确 | `package.json:29` 确认 |
| 浏览器端直连 LLM | ⚠️ 部分准确 | 仍存在但被 `isHttpAgentRuntimeEnabled()` flag 收口 |
| **方向 1 已落地** | ❌ **失准** | 4 个文件未接入主链路，FailureFormatter 永远收不到数据 |
| **canQuickRetry 已接入** | ❌ **失准** | `ChatPanel.vue:984-991` 只填充输入框，策略化重试未实现 |
| **候选推荐结构化 card** | ❌ **未交付** | `ChatPanel.vue:279-288` 仍是 el-radio 列表 |

---

## 3. 架构缺陷重新评估

基于第 2 节核对结果，重新评估 v2 路线图的 A1-A16 缺陷清单。

### 3.1 已被方向 1 部分缓解的缺陷（但未完全消除）

#### A5 timeout/deadline 分散不一致

- **v2 评估**：P0 致命级。
- **重新评估**：方向 1 落地了 `AgentDeadline` + `STAGE_TIMEOUT_BUDGET` + `LONG_RUNNING_DEADLINE_BUDGET`，**但未接入主链路**。主链路仍使用散落的 `timeout: 6000 / 8000 / 30000` 写死值。
- **当前状态**：缓解措施存在但未生效，缺陷仍真实存在。
- **优先级**：仍为 P0，但需要先做"接入"而非"重新设计"。

#### A8 失败 envelope 非结构化

- **v2 评估**：P1 高优级。
- **重新评估**：方向 1 落地了 `RecoverableInterpretationFailure` envelope schema，**但主链路仍产出旧式散文式失败暴露**（`buildRecoverableLlmFailureDecision`，`demoRuntimeFacade.ts:610-638`）。
- **当前状态**：envelope schema 存在但数据流未打通。
- **优先级**：升级为 P0（因为方向 1 已投入但未产出价值，需尽快接入闭环）。

#### A6 preview_only / noMutation 未跨模块硬约束

- **v2 评估**：P1 高优级。
- **重新评估**：方向 1 落地了 `MutationPolicy` + `assertMutationAllowed`，**但未接入 write adapter 入口**。
- **当前状态**：写屏障存在但未生效。
- **优先级**：仍为 P1，与方向 1 接入闭环一起做。

### 3.2 仍存在且需优先处理的缺陷

#### A1 DemoRuntimeFacade 单点瓶颈（P0）

- **现状**：9864 行（v2 说 10540 行，已局部瘦身但仍是单点瓶颈）。
- **影响**：任何新功能都要改这一个文件，回归成本极高。方向 1 接入闭环、长流程稳定性增强、双路径收口都需要改这个文件。
- **优先级**：P0，但与方向 3 Capability 拆分强耦合。

#### A2 AtomicCommandCapability 单类过大（P0）

- **现状**：6193 行（v2 说 6630+ 行，已抽取 candidateSearchRetryService 但仍过大）。
- **优先级**：P0，方向 3 拆分目标。

#### A3 双分发机制并行（P0）

- **现状**：`CapabilityRegistry` 只注册 `AtomicCommandCapability`，而 `DemoRuntimeFacade.tryHandleAgentPlannerInstruction`（`demoRuntimeFacade.ts:640`）走独立 if-else 链。
- **优先级**：P0，方向 3 拆分目标。

#### A4 草案/正式播单/pending mutation 状态模型不统一（P0）

- **现状**：状态散落，无统一 owner / workspaceKey / mutationId / mutationPolicy 契约。
- **优先级**：P0，方向 2 目标。

#### A14 长流程双路径并行（P0）

- **现状**：facade 产出 `kind: 'orchestration'` decision 后不执行编排，由 useOrchestrator + 老 Orchestrator 类执行。整个编排生命周期在 facade 之外。
- **影响**：双路径并行导致状态、checkpoint、停止信号、生命周期均不统一。老 Orchestrator.cancel() 不联动 AbortController。
- **优先级**：P0，需在方向 3 Capability 拆分后做收口。

#### A15 补空窗 taskKind 本地正则识别违背 LLM-first（P0）

- **现状**：`resolveFormalOrchestrationTaskKind`（`demoRuntimeFacade.ts:7600-7610`）仍依赖本地正则识别 taskKind。
- **优先级**：P0，需在 `formal_orchestration` action 中增加 taskKind 字段，由 LLM 直接返回。

#### A16 长流程测试门禁未跟上（P0）

- **现状**：`demoRuntimeFacade.fullGenerateBootstrap.test.ts` 与 `orchestrator.test.ts` 均不在 `agent:check:tests` 列表中。
- **优先级**：P0，门禁对齐。

#### A11 ChatPanel.vue 单文件过大（P0，升级）

- **现状**：5844 行（v2 说 5100+ 行，已增长 14%）。方向 1 接入闭环、候选推荐结构化 card、长流程进度展示都需要改这个文件。
- **优先级**：从 v2 的 P2 升级为 **P0**。如果不拆分，方向 1 接入闭环与前台体验升级都无法落地。

### 3.3 v2 未识别的新缺陷（A17-A20）

#### A17 方向 1 落地但未接入主链路（P0，新增）

- **现象**：见第 2.3.1 节。`AgentDeadline`、`mutationPolicy`、`recoverableFailureEnvelope` 在主链路中完全无效。
- **影响**：方向 1 投入产出比为 0，FailureFormatter 永远收不到数据。
- **优先级**：**P0 最高优先级**。在做任何新方向之前，必须先完成方向 1 接入闭环。

#### A18 失败 envelope 数据流断裂（P0，新增）

- **现象**：见第 2.3.2 节。`recoverableFailureEnvelope.value` 永远是 null。
- **影响**：FailureFormatter.vue 组件存在但永远不会渲染。
- **优先级**：**P0**。与 A17 一起做。

#### A19 quick reply 未真正触发重试链路（P0，新增）

- **现象**：见第 2.3.3 节。`handleFailureQuickReply` 只填充输入框，策略化重试未实现。
- **影响**：方向 1 的"失败 quick replies"能力未真正交付。
- **优先级**：**P0**。与 A17/A18 一起做。

#### A20 候选推荐未结构化（P1，新增）

- **现象**：见第 2.3.4 节。仍是 el-radio 列表，不是 `CandidateRecommendationCard`。
- **影响**：用户看不到匹配分数、匹配原因标签，无法进入编排闭环。
- **优先级**：P1。

### 3.4 缺陷重新评估汇总

| 缺陷 | v2 优先级 | 重新评估优先级 | 状态变化 |
|---|---|---|---|
| A1 DemoRuntimeFacade 单点瓶颈 | P0 | P0 | 行数下降但仍瓶颈 |
| A2 AtomicCommandCapability 单类过大 | P0 | P0 | 行数下降但仍瓶颈 |
| A3 双分发机制并行 | P0 | P0 | 未变 |
| A4 状态模型不统一 | P0 | P0 | 未变 |
| A5 timeout 分散 | P0 | P0 | 方向 1 缓解但未接入 |
| A6 preview_only 未跨模块 | P1 | P1 | 方向 1 缓解但未接入 |
| A7 workspaceKey 不完整 | P0 | P0 | 未变 |
| A8 失败 envelope 非结构化 | P1 | **P0** | 方向 1 落地但数据流断裂 |
| A9 候选推荐散文输出 | P1 | P1 | 升级为 A20 |
| A10 LLM 调用不可观测 | P1 | P1 | 未变 |
| A11 ChatPanel.vue 过大 | P2 | **P0** | 行数增长 14%，前台体验升级阻塞 |
| A12 无 e2e 测试 | P2 | P2 | 未变 |
| A13 浏览器端直连 LLM | P2 | P2 | 已被 flag 收口 |
| A14 长流程双路径并行 | P0 | P0 | 未变 |
| A15 taskKind 本地正则 | P0 | P0 | 未变 |
| A16 长流程测试门禁未跟上 | P0 | P0 | 未变 |
| **A17 方向 1 未接入主链路** | 未识别 | **P0** | 新增 |
| **A18 失败 envelope 数据流断裂** | 未识别 | **P0** | 新增 |
| **A19 quick reply 未触发重试** | 未识别 | **P0** | 新增 |
| **A20 候选推荐未结构化** | 未识别 | P1 | 新增 |

---

## 4. 与成熟 agent 的具体模式对照

本节不只列名字，而是具体到模式，并筛选符合"无回退/无子 agent/业务专一"约束的模式。

### 4.1 Codex 模式对照

#### 4.1.1 失败暴露而非回滚

- **Codex 模式**：命令执行失败时，保留现场 + 暴露错误信息 + 让用户决定下一步（重试 / 修改 / 放弃）。不做自动回滚，不维护 mutation journal。
- **本项目现状**：
  - 已对齐：`AGENTS.md` 明确"失败暴露不假装理解"，`buildRecoverableLlmFailureDecision`（`demoRuntimeFacade.ts:610-638`）产出 `kind: 'message'` decision，`noMutation: true`，提示用户"可以直接说'重试'"。
  - **未对齐**：失败暴露仍是散文式，不是结构化 envelope（A18）。FailureFormatter 永远收不到数据。
- **应借鉴**：Codex 的失败暴露是"结构化错误码 + 可读摘要 + 用户可点击的下一步动作"。本项目应把 `buildRecoverableLlmFailureDecision` 升级为产出 `RecoverableInterpretationFailure` envelope，并在 `details` 中携带 `recognizedSlots / missingSlots / candidateEvidence / retrySuggestions / quickReplies`。
- **不应借鉴**：Codex 的"自动重试上一条命令"模式（容易在 LLM 不稳定时放大错误）。本项目应保留"用户主动重试"。

#### 4.1.2 无子 agent 的扁平结构

- **Codex 模式**：单个 agent 实例处理所有任务，不调度子 agent。命令直达执行。
- **本项目现状**：已对齐。`CapabilityRegistry` 只注册 `AtomicCommandCapability`，无子 agent 雏形。
- **应借鉴**：Codex 的"intent → capability 直达"模式。本项目应把 `tryHandleAgentPlannerInstruction` 的 if-else 链改为 `CapabilityDispatcher` 统一路由（方向 3）。
- **不应借鉴**：无。

#### 4.1.3 命令直达执行（高置信度原子命令直接执行）

- **Codex 模式**：高置信度命令直接执行，不强制候选选择。低置信度才进入追问。
- **本项目现状**：已对齐 `AGENTS.md` Atomic Command Policy By Playlist Type（电视播单直接执行、轮播单候选推荐、删除始终确认）。
- **应借鉴**：无（已对齐）。
- **不应借鉴**：无。

### 4.2 Claude Code 模式对照

#### 4.2.1 真 ReAct 自主多轮

- **Claude Code 模式**：用户发一句话后，agent 自主多轮工具调用直到完成（act → observe → decide → act），不需要用户每轮触发。
- **本项目现状**：`reactTaskRuntime.ts:113-117` 实现了 `loopCount >= maxTurns` 检查，但 `executeReactAgentPlan`（v2 说在 `demoRuntimeFacade.ts:885-980`）只执行 firstAction 后 recordObservation 返回，是伪 ReAct。
- **应借鉴**：Claude Code 的"单次 submit 内自主多轮"模式。本项目应实现真 ReAct 执行器（方向 4 8.1）。
- **不应借鉴**：Claude Code 的"无限轮直到完成"模式。本项目应保留 `maxTurns=4` 上限，避免 LLM 不稳定时无限循环。

#### 4.2.2 Plan/Act 分离

- **Claude Code 模式**：先 Plan（生成计划），再 Act（执行计划），两阶段分离。
- **本项目现状**：已部分对齐。`AgentPlanner.plan` 产出 `AgentPlan`，`executeAgentPlan` 执行计划。
- **应借鉴**：无（已对齐）。
- **不应借鉴**：无。

#### 4.2.3 上下文压缩策略

- **Claude Code 模式**：当上下文超过阈值时，自动生成摘要 + 按相关性排序保留 top N。
- **本项目现状**：仅 truncation，无摘要层。
- **应借鉴**：Claude Code 的"摘要层 + 相关性排序"模式。本项目应在方向 4 实现 `ContextCompressor`。
- **不应借鉴**：Claude Code 的"向量化检索"模式（投入产出比低，本项目上下文规模不到 Claude Code 量级）。

### 4.3 Trae 模式对照

#### 4.3.1 skill + tool 协议

- **Trae 模式**：通过 skill 描述能力，通过 tool 执行能力，两者协议化。
- **本项目现状**：`AgentCapability` 接口（`canHandle / handle`）类似 skill + tool 协议，但未协议化到 Trae 程度。
- **应借鉴**：Trae 的"capability metadata 描述能力边界"模式。本项目应在方向 3 增加 `CapabilityMetadata`（`supportedIntents / requiredSources / safetyGates`）。
- **不应借鉴**：Trae 的"动态加载 skill"模式（本项目业务专一，不需要动态加载）。

#### 4.3.2 项目 memory 持续积累

- **Trae 模式**：跨会话积累项目 memory（用户偏好、历史决策）。
- **本项目现状**：`AgentServerFileSessionStore` 只持久化 session 状态，无跨会话 memory。
- **应借鉴**：Trae 的"跨会话 memory"模式。但本项目当前阶段投入产出比低，建议延后。
- **不应借鉴**：无。

#### 4.3.3 子 agent 调度边界

- **Trae 模式**：主 agent 调度子 agent，子 agent 有明确边界。
- **本项目现状**：用户硬约束"不需要子 agent"。
- **应借鉴**：无。
- **不应借鉴**：Trae 的子 agent 调度模式（用户硬约束禁止）。

### 4.4 LangGraph 模式对照

#### 4.4.1 checkpoint 持久化

- **LangGraph 模式**：每个节点执行后 checkpoint，可恢复。
- **本项目现状**：`AgentExecutionCheckpoint`（`agentServerSessionStore.ts:17-34`）已定义结构，但 `LongRunningTaskStore` 未实现。
- **应借鉴**：LangGraph 的"节点级 checkpoint"模式。本项目应在方向 4 实现 `BatchCheckpointExecutor` + `LongRunningTaskStore`。
- **不应借鉴**：LangGraph 的"checkpoint 回滚"模式（用户硬约束禁止回退）。

#### 4.4.2 状态机图

- **LangGraph 模式**：用图描述状态机，节点是状态，边是转换。
- **本项目现状**：状态转换散落在 facade if-else 链中，无统一状态机。
- **应借鉴**：LangGraph 的"显式状态机"模式。本项目应在方向 2 实现 `PlaylistStateContract` + `VALID_TRANSITIONS`。
- **不应借鉴**：LangGraph 的"图可视化"模式（投入产出比低）。

#### 4.4.3 LangSmith 可观测

- **LangGraph 模式**：LangSmith 提供 token 用量、延迟、成本、错误率聚合。
- **本项目现状**：仅 trace + audit 计数。
- **应借鉴**：LangGraph 的"LLM 调用监控聚合"模式。本项目应在方向 5 实现 `LlmCallMonitor`。
- **不应借鉴**：LangSmith 的"全链路 trace 可视化"模式（投入产出比低，本项目用 trace 文本即可）。

### 4.5 模式对照汇总

| 模式 | 来源 | 是否借鉴 | 理由 |
|---|---|---|---|
| 失败暴露而非回滚 | Codex | ✅ 已对齐 | AGENTS.md 已明确 |
| 结构化失败 envelope | Codex | ✅ 应借鉴 | 当前散文式失败暴露，A18 |
| intent → capability 直达 | Codex | ✅ 应借鉴 | 方向 3 CapabilityDispatcher |
| 命令直达执行（高置信度） | Codex | ✅ 已对齐 | AGENTS.md Atomic Command Policy |
| 真 ReAct 自主多轮 | Claude Code | ✅ 应借鉴 | 方向 4 ReactExecutor |
| 有限轮次（maxTurns=4） | Claude Code | ✅ 已对齐 | reactTaskRuntime 已限制 |
| Plan/Act 分离 | Claude Code | ✅ 已对齐 | AgentPlanner + executeAgentPlan |
| 上下文压缩（摘要层） | Claude Code | ✅ 应借鉴 | 方向 4 ContextCompressor |
| 向量化检索 | Claude Code | ❌ 不借鉴 | 投入产出比低 |
| capability metadata | Trae | ✅ 应借鉴 | 方向 3 CapabilityMetadata |
| 动态加载 skill | Trae | ❌ 不借鉴 | 业务专一 |
| 跨会话 memory | Trae | ⚠️ 延后 | 投入产出比低 |
| 子 agent 调度 | Trae | ❌ 不借鉴 | 用户硬约束禁止 |
| checkpoint 持久化 | LangGraph | ✅ 应借鉴 | 方向 4 BatchCheckpointExecutor |
| checkpoint 回滚 | LangGraph | ❌ 不借鉴 | 用户硬约束禁止回退 |
| 显式状态机 | LangGraph | ✅ 应借鉴 | 方向 2 PlaylistStateContract |
| 图可视化 | LangGraph | ❌ 不借鉴 | 投入产出比低 |
| LLM 调用监控聚合 | LangGraph | ✅ 应借鉴 | 方向 5 LlmCallMonitor |
| 全链路 trace 可视化 | LangGraph | ❌ 不借鉴 | 投入产出比低 |

---

## 5. 前台体验差距分析

用户特别提到"包括前台体验也是"。本节分析当前前台体验与 Codex/Claude Code 的具体差距。

### 5.1 ChatPanel.vue 状态管理复杂度

- **现状**：`src/components/dialogue/ChatPanel.vue` 5844 行，承担：
  - 消息渲染（多气泡流式、thinking、explanation、details）
  - 输入框与发送逻辑
  - pending command / pending atomic context / pending layout draft 状态机
  - 候选推荐（el-radio 列表）
  - 失败暴露（旧式 `recoverableRuntimeFailure` + 新式 `recoverableFailureEnvelope`，但后者永远 null）
  - ReAct 任务状态（`activeReactTaskRun / activeReactTaskWorkspaceKey`）
  - 编排停止（emit `cancelRequested`）
  - 历史抽屉、版面草案面板、主视图区分
- **问题**：
  - 状态管理与 UI 耦合，任何新功能都要改这一个文件。
  - 方向 1 接入闭环需要修改这个文件（envelope 数据流接入）。
  - 候选推荐结构化 card 需要修改这个文件。
  - 长流程进度展示需要修改这个文件。
- **风险**：如果不先拆分，方向 1 接入闭环会进一步扩大文件，形成恶性循环。

### 5.2 FailureFormatter 已落地但 canQuickRetry 未接入

- **现状**：见第 2.3.2、2.3.3 节。`FailureFormatter.vue` 存在但永远不会渲染，`handleFailureQuickReply` 只填充输入框。
- **与 Codex 差距**：
  - Codex 失败时会显示结构化错误（错误码 + 摘要 + 已识别线索 + 缺失槽位 + 可点击下一步）。
  - 本项目失败时只显示散文 message（`buildRecoverableLlmFailureDecision` 产出的 `content`），用户需要手动输入"重试"。
- **修复路径**：
  1. `demoRuntimeFacade.buildRecoverableLlmFailureDecision` 升级为产出 `RecoverableInterpretationFailure` envelope，放入 `feedback.details.recoverableFailureEnvelope`。
  2. `ChatPanel.vue` 在 `extractRecoverableRuntimeFailure` 附近新增 `extractRecoverableFailureEnvelope`，从 details 中提取 envelope 并设置 `recoverableFailureEnvelope.value`。
  3. `handleFailureQuickReply` 实现 `switch_strategy / broaden_target / narrow_target / resubmit` 策略化重试（自动构造新指令并触发 sendMessage）。

### 5.3 长流程执行时前台是否有停止按钮、进度可视化、批次边界

- **现状**：
  - **停止按钮**：`ChatPanel.vue:1243` emit `cancelRequested`，由 `useBroadcastPlanOrchestration.ts:201` 调用 `orchestratorRuntime.cancel()`。但老 Orchestrator.cancel()（`orchestrator.ts:388-394`）只设 `isCancelled = true`，**不联动 AbortController，不会中止正在进行的 LLM 调用**。
  - **进度可视化**：`ChatPanel.vue:448-453` 有 `is-stop` 样式，但无批次进度展示（已处理/剩余数量、当前批次索引）。无 `LongRunningProgress.vue` 组件。
  - **批次边界**：无。`AgentExecutionCheckpoint`（`agentServerSessionStore.ts:17-34`）已定义结构但未在 UI 中展示。
- **与 Codex/Claude Code 差距**：
  - Codex 命令执行时显示可点击的停止按钮，点击后立即中止。
  - Claude Code 长任务时显示进度条与当前步骤。
  - 本项目停止按钮不真正中止后台 LLM 调用，无进度可视化，无批次边界。

### 5.4 候选推荐 card 是否可点击进入编排闭环

- **现状**：见第 2.3.4 节。`el-radio` 列表，用户选择后点击"确认目标"按钮。无 `CandidateRecommendationCard` 结构化 card。
- **与 Codex/Claude Code 差距**：
  - Codex 候选推荐显示结构化 card（标题 + 摘要 + 匹配原因 + 可点击动作）。
  - 本项目候选推荐只显示节目名 + 时间段，用户看不到匹配分数、匹配原因标签、"为什么是它"摘要。

### 5.5 前台体验差距汇总

| 体验点 | Codex/Claude Code | 本项目现状 | 差距 |
|---|---|---|---|
| 失败暴露 | 结构化 envelope + quick replies | 散文 message + 手动输入"重试" | A18/A19 |
| 停止按钮 | 立即中止 LLM 调用 | 只设 flag，LLM 调用继续执行 | A14 + 老 Orchestrator.cancel() 不联动 |
| 进度可视化 | 进度条 + 当前步骤 | 无 | 未实现 |
| 批次边界 | 显示批次索引 + 已处理/剩余 | 无 | 未实现 |
| 候选推荐 | 结构化 card + 匹配原因 | el-radio 列表 | A20 |
| 草案 diff 面板 | 显示 diff + 时间冲突预警 | 未实现 | 方向 2 6.3 |
| 历史抽屉 | 显示 mutation 历史 | 未实现 | 方向 2 6.6（v2 改为 trace + 状态转换时间线） |
| 主视图区分 | 草案 vs 正式播单明确 | 部分实现 | 方向 2 6.7 |

---

## 6. 工程化方向明确化

v2 路线图列了 10 项工程化缺失但不够具体。本节明确分级与落地点。

### 6.1 必须立刻做（阻断方向 2-4 实施）

#### 6.1.1 方向 1 接入闭环（A17/A18/A19）

- **为什么必须立刻做**：方向 1 已投入 4 个文件 + 1 个组件 + 1 个测试，但未接入主链路，投入产出比为 0。如果不先接入，方向 2-4 都会在失败暴露上重复造轮子。
- **具体落地点**：
  1. `demoRuntimeFacade.ts:610-638` `buildRecoverableLlmFailureDecision`：升级为产出 `RecoverableInterpretationFailure` envelope，放入 `feedback.details.recoverableFailureEnvelope`。
  2. `demoRuntimeFacade.ts` 中所有 LLM 调用点（line 1575, 3247, 3428, 8275 等）：接入 `AgentDeadline`，用 `stageTimeoutMs(STAGE_TIMEOUT_BUDGET.intent_parse)` 替换写死的 `timeout: 6000 / 30000`。
  3. `atomicCommandCapability.ts` 中所有 LLM 调用点：同上。
  4. `formalPlaylistWriteAdapter.ts`（write adapter 入口）：接入 `assertMutationAllowed`，preview_only 时抛 `PreviewOnlyViolationError`。
  5. `ChatPanel.vue:1411` 附近：新增 `extractRecoverableFailureEnvelope`，从 details 中提取 envelope 并设置 `recoverableFailureEnvelope.value`。
  6. `ChatPanel.vue:984-991` `handleFailureQuickReply`：实现 `switch_strategy / broaden_target / narrow_target / resubmit` 策略化重试。
- **验证**：运行 `recoverableFailureEnvelope.test.ts`（已纳入 `agent:check:tests`）+ 前台冒烟触发 LLM 超时，验证 FailureFormatter 显示。

#### 6.1.2 ChatPanel.vue 拆分（A11）

- **为什么必须立刻做**：方向 1 接入闭环、候选推荐结构化 card、长流程进度展示都需要改这个文件。如果不先拆分，每个改动都会进一步扩大文件。
- **具体落地点**：
  1. 抽取 `FailureFormatter.vue`（已存在，但需完善接入）。
  2. 抽取 `CandidateRecommendationPanel.vue`（取代 el-radio 列表）。
  3. 抽取 `LongRunningProgress.vue`（长流程进度展示）。
  4. 抽取 `DraftDiffPanel.vue`（草案 diff 面板，方向 2）。
  5. 抽取 `HistoryDrawer.vue`（历史抽屉，方向 2）。
  6. 抽取 `PendingCommandPanel.vue`（pending command 状态机）。
  7. ChatPanel.vue 只保留消息列表 + 输入框 + 路由逻辑，目标行数 < 2000。
- **验证**：`npm run build` + 前台冒烟。

#### 6.1.3 长流程测试纳入门禁（A16）

- **为什么必须立刻做**：长流程已融入主链路，但行为变化无门禁保护。任何改动都可能引入回归。
- **具体落地点**：
  1. `package.json:29` `agent:check:tests` 列表新增：
     - `src/services/__tests__/demoRuntimeFacade.fullGenerateBootstrap.test.ts`
     - `src/services/__tests__/orchestrator.test.ts`
     - `src/services/__tests__/openClawToOrchestrator.tvSequence.test.ts`
  2. `docs/agent-development-protocol.md:99` 更新"补空窗和全天编排不纳入 agent:check 强制门禁"为"长流程已纳入门禁"。
- **验证**：`npm run agent:check` 跑通。

### 6.2 可以并行做（不阻断业务）

#### 6.2.1 LLM 调用监控（A10）

- **具体落地点**：
  1. 新建 `src/services/agent/llmCallMonitor.ts`，定义 `AgentLlmCallAuditItem` + `LlmCallMonitor` 类。
  2. `src/services/llm/llmClient.ts:91-135` `LLMClient.chat`：在每次调用前后 record audit item（callId / traceId / stage / model / tokenUsage / latencyMs / status / errorMessage）。
  3. `src/services/agent/schedulingAgentRuntime.ts`：在 trace 落盘时聚合 `LlmCallMonitor` 数据。
- **验证**：`LlmCallMonitor` 单测 + `npm run agent:check`。

#### 6.2.2 Token 成本核算

- **具体落地点**：
  1. 新建 `src/services/agent/tokenCostCalculator.ts`，定义 `MODEL_PRICING` + `calculateCost` 函数。
  2. `src/services/agent/schedulingAgentRuntime.ts`：在 trace 落盘时计算成本。
- **验证**：`calculateCost` 单测。

#### 6.2.3 错误监控上报

- **具体落地点**：
  1. 新建 `src/services/agent/errorMonitor.ts`，定义 `ErrorMonitor` 类。
  2. `demoRuntimeFacade.ts:610-638` `buildRecoverableLlmFailureDecision`：在产出失败 decision 时调用 `ErrorMonitor.report`。
  3. 仅上报 `kind / traceId / noMutation`，不上报用户原始输入（隐私保护）。
- **验证**：`ErrorMonitor` 单测。

### 6.3 可延后（投入产出比低）

#### 6.3.1 Prompt 版本管理

- **理由**：当前 prompt 写死在 `systemPrompts.ts`，业务迭代节奏不快，A/B 测试需求不强烈。
- **延后到**：方向 4 长流程稳定性增强落地后。

#### 6.3.2 e2e 测试框架

- **理由**：当前 `agent:check:tests` + `goal37` 脚本已覆盖主要场景。e2e 框架投入大，短期收益低。
- **延后到**：方向 5 工程化基线建设后期。

#### 6.3.3 CI/CD

- **理由**：当前依赖人工跑门禁，但团队规模小，CI/CD 紧迫性不高。
- **延后到**：方向 5 工程化基线建设后期。

#### 6.3.4 跨会话 memory

- **理由**：用户硬约束"业务专一"，跨会话 memory 投入产出比低。
- **延后到**：方向 4 长流程稳定性增强落地后。

### 6.4 工程化方向分级汇总

| 工程化能力 | 分级 | 落地点 | 阻断什么 |
|---|---|---|---|
| 方向 1 接入闭环 | 必须立刻做 | `demoRuntimeFacade.ts` + `atomicCommandCapability.ts` + `ChatPanel.vue` | 阻断方向 2-4 |
| ChatPanel.vue 拆分 | 必须立刻做 | `src/components/dialogue/` | 阻断前台体验升级 |
| 长流程测试纳入门禁 | 必须立刻做 | `package.json:29` + `docs/agent-development-protocol.md:99` | 阻断长流程稳定性 |
| LLM 调用监控 | 可以并行做 | `src/services/agent/llmCallMonitor.ts` + `llmClient.ts` | 不阻断 |
| Token 成本核算 | 可以并行做 | `src/services/agent/tokenCostCalculator.ts` | 不阻断 |
| 错误监控上报 | 可以并行做 | `src/services/agent/errorMonitor.ts` | 不阻断 |
| Prompt 版本管理 | 可延后 | `src/services/agent/systemPrompts.ts` | 不阻断 |
| e2e 测试框架 | 可延后 | `tests/e2e/` | 不阻断 |
| CI/CD | 可延后 | `.github/workflows/` | 不阻断 |
| 跨会话 memory | 可延后 | 待定 | 不阻断 |

---

## 7. 下一步明确建议

基于第 2-6 节分析，给出**明确的下一步建议**，而不是 5 个方向并列。

### 7.1 关键问题回答

#### 7.1.1 方向 2（状态模型统一）是否真的是下一步最优解？

- **回答**：**不是**。方向 2 是 P0 缺陷（A4/A7），但在方向 1 接入闭环（A17/A18/A19）之前做方向 2，会导致状态机失败的失败暴露仍走旧式散文路径，方向 1 的 envelope schema 仍是无用代码。
- **理由**：方向 2 的"失败暴露而非回滚"（v2 6.5 节 `FailureExposer`）依赖方向 1 的 `RecoverableInterpretationFailure` envelope。如果方向 1 未接入主链路，方向 2 的 `FailureExposer` 产出 envelope 后前台仍收不到。

#### 7.1.2 方向 1 已落地但未接入主链路，是否应该先做"方向 1 接入闭环"而不是开新方向？

- **回答**：**是**。这是当前最优先事项。
- **理由**：
  1. 方向 1 已投入 4 个文件 + 1 个组件 + 1 个测试，但未接入主链路，投入产出比为 0。
  2. 方向 1 接入闭环是 A17/A18/A19 的修复，不接入会导致后续方向都在失败暴露上重复造轮子。
  3. 方向 1 接入闭环的工作量比新开方向小（已有骨架，只需打通数据流）。
  4. 方向 1 接入闭环后，可立即交付用户可见价值（FailureFormatter 真正显示、quick reply 真正触发）。

#### 7.1.3 长流程已融入但稳定性不足，是否应该优先补长流程稳定性（方向 4 前置部分）而非按 v2 排序？

- **回答**：**部分前置**。长流程稳定性中的"门禁对齐"（A16）应前置到方向 1 接入闭环阶段，因为长流程已融入主链路，无门禁保护风险极高。但"双路径收口"（A14）/"taskKind 迁回 LLM"（A15）/"真 ReAct 自主多轮"（方向 4 8.1）不应前置，因为它们依赖方向 3 Capability 拆分。
- **理由**：
  1. 门禁对齐（A16）只需修改 `package.json:29` + `docs/agent-development-protocol.md:99`，工作量小，收益大。
  2. 双路径收口（A14）需要先有 `FormalOrchestrationCapability`（方向 3）作为执行器位置，否则会把执行逻辑继续堆进 `DemoRuntimeFacade`。
  3. taskKind 迁回 LLM（A15）需要先在 `formal_orchestration` action 中增加 taskKind 字段，但这会破坏现有 LLM prompt 的稳定性，需要在方向 5 LLM 调用监控落地后才能评估 LLM 返回 taskKind 的准确率。

### 7.2 推荐路径

**推荐排序**：方向 1 接入闭环（含门禁对齐前置）→ 方向 5 工程化基线（并行）→ 方向 2 状态模型统一 → 方向 3 Capability 拆分 → 方向 4 长流程增强与稳定性。

#### 阶段 1：方向 1 接入闭环 + 门禁对齐（2 周）

**目标**：让方向 1 已落地的 4 个文件真正生效，让 FailureFormatter 真正显示，让 quick reply 真正触发。同时把长流程测试纳入门禁。

**任务清单**：
1. A16 门禁对齐：`package.json:29` 新增长流程测试；`docs/agent-development-protocol.md:99` 更新门禁说明。（0.5 天）
2. A18 失败 envelope 数据流打通：`demoRuntimeFacade.ts:610-638` `buildRecoverableLlmFailureDecision` 升级为产出 `RecoverableInterpretationFailure` envelope；`ChatPanel.vue` 新增 `extractRecoverableFailureEnvelope`。（3 天）
3. A17 AgentDeadline 接入主链路：`demoRuntimeFacade.ts` 与 `atomicCommandCapability.ts` 中所有 LLM 调用点用 `stageTimeoutMs(STAGE_TIMEOUT_BUDGET.*)` 替换写死 timeout。（3 天）
4. A17 MutationPolicy 接入 write adapter：`formalPlaylistWriteAdapter.ts` 接入 `assertMutationAllowed`。（1 天）
5. A19 quick reply 策略化重试：`ChatPanel.vue:984-991` `handleFailureQuickReply` 实现 `switch_strategy / broaden_target / narrow_target / resubmit`。（2 天）
6. ChatPanel.vue 局部拆分：抽取 `CandidateRecommendationPanel.vue`（取代 el-radio 列表，A20）。（3 天）

**验证门禁**：
- `npm run agent:check`（含新增长流程测试）
- `npm run build`
- 前台冒烟：触发 LLM 超时（mock），验证 FailureFormatter 显示 recognizedSlots / missingSlots / quickReplies；点击 quick reply 验证自动重试。

#### 阶段 2：方向 5 工程化基线（并行，2-3 周）

**目标**：建立 LLM 调用监控、Token 成本核算、错误监控上报。为方向 2-4 提供可观测性支撑。

**任务清单**：见第 6.2 节。

#### 阶段 3：方向 2 状态模型统一（3-4 周）

**目标**：统一 draft/pending/formal 状态机，引入 candidate_precheck 写屏障，失败暴露而非回滚。

**任务清单**：沿用 v2 路线图第 6 节，但需注意：
- `FailureExposer`（v2 6.5 节）产出的 envelope 必须复用阶段 1 已接入的 `RecoverableInterpretationFailure` schema，不能另起炉灶。
- `DraftDiffPanel.vue`（v2 6.3 节）需要在阶段 1 已拆分的 ChatPanel.vue 基础上新增。

#### 阶段 4：方向 3 Capability 拆分（4-6 周）

**目标**：按 intent 拆分 AtomicCommandCapability，统一分发机制，接入 FormalOrchestrationCapability。

**任务清单**：沿用 v2 路线图第 7 节。

#### 阶段 5：方向 4 长流程增强与稳定性（5-7 周）

**目标**：双路径收口、taskKind 迁回 LLM、真 ReAct 自主多轮、checkpoint 持久化、UI 停止按钮。

**任务清单**：沿用 v2 路线图第 8 节，但需注意：
- 双路径收口（A14）必须先完成方向 3 `FormalOrchestrationCapability`。
- taskKind 迁回 LLM（A15）必须在方向 5 LLM 调用监控落地后评估 LLM 返回准确率。
- UI 停止按钮必须接入 `AgentDeadline.abort()`（阶段 1 已接入主链路），不能再用老 Orchestrator.cancel()。

### 7.3 与 v2 推荐排序的差异

| 排序位置 | v2 推荐 | 本文推荐 | 差异理由 |
|---|---|---|---|
| 阶段 1 | 方向 1 失败可恢复性闭环 | **方向 1 接入闭环 + 门禁对齐** | v2 把方向 1 标记为已完成，实际未接入主链路 |
| 阶段 2 | 方向 2 状态模型统一 | **方向 5 工程化基线（并行）** | 方向 2 依赖方向 1 接入闭环，不能跳过 |
| 阶段 3 | 方向 5 工程化基线（并行） | **方向 2 状态模型统一** | 方向 2 在方向 1 接入闭环后才能做 |
| 阶段 4 | 方向 3 Capability 拆分 | **方向 3 Capability 拆分** | 一致 |
| 阶段 5 | 方向 4 长流程增强与稳定性 | **方向 4 长流程增强与稳定性** | 一致 |

---

## 8. 风险与权衡

### 8.1 方向 1 接入闭环可能引入主链路回归

- **风险**：`demoRuntimeFacade.ts` 与 `atomicCommandCapability.ts` 中所有 LLM 调用点接入 `AgentDeadline` 后，可能因 deadline 计算错误导致原本能成功的 LLM 调用被提前超时。
- **权衡**：
  - 采用渐进式接入：先接入 `buildRecoverableLlmFailureDecision` 这一个失败暴露点，验证 envelope 数据流打通。
  - 再接入 LLM 调用 deadline：先接入 `agentPlanner.plan`（已 30s timeout，与 `DEFAULT_OVERALL_DEADLINE_MS` 一致），再接入其他 stage。
  - 每步接入后跑 `npm run agent:check` 全量回归。
- **残余风险**：deadline 计算边界场景（如 LLM 调用刚开始就剩 100ms）可能误超时。通过 `recoverableFailureEnvelope.test.ts` case 覆盖。

### 8.2 ChatPanel.vue 拆分可能引入前台回归

- **风险**：5844 行拆分涉及大量状态迁移，可能引入 UI 渲染回归。
- **权衡**：
  - 采用渐进式拆分：先抽取 `CandidateRecommendationPanel.vue`（与阶段 1 候选推荐结构化 card 一起做）。
  - 再抽取 `FailureFormatter.vue`（已存在，只需完善接入）。
  - 最后抽取 `LongRunningProgress.vue` / `DraftDiffPanel.vue` / `HistoryDrawer.vue`（方向 2/4 时做）。
  - 每步拆分后跑 `chatPanelQuickActions.test.ts` + `chatPanelDetails.test.ts` + 前台冒烟。
- **残余风险**：拆分后状态传递可能丢失。通过 e2e 测试（方向 5）覆盖。

### 8.3 长流程测试纳入门禁可能暴露既有 bug

- **风险**：`demoRuntimeFacade.fullGenerateBootstrap.test.ts` 与 `orchestrator.test.ts` 纳入门禁后，可能暴露长流程已存在的 bug，导致门禁红灯。
- **权衡**：
  - 先在本地跑一次 `npm run agent:check:tests` + 长流程测试，确认是否已有 bug。
  - 如有 bug，先修复再纳入门禁。
  - 如无 bug，直接纳入门禁。
- **残余风险**：长流程测试可能因 mock 数据与真实数据差异而不稳定。通过方向 5 真实 LLM 评估基线（v2 12.1 节）覆盖。

### 8.4 双路径收口过渡期风险

- **风险**：方向 4 双路径收口（A14）过渡期，`facade_drives_orchestrator` 模式下老 Orchestrator 的 `cancel()` 与 facade 的 `AgentDeadline.abort()` 双信号源不一致。
- **权衡**：
  - 阶段 1 先把 `AgentDeadline.abort()` 接入主链路（短链路 LLM 调用）。
  - 阶段 5 双路径收口时，老 Orchestrator 的 `cancel()` 改为调用 `AgentDeadline.abort()`，统一信号源。
  - 过渡期短链路与长流程的停止信号仍独立，但都已联动 AbortController。
- **残余风险**：过渡期长流程停止后，老 Orchestrator 内部的 LLM 调用仍可能继续执行（因为 Orchestrator 内部 LLM 调用未接入 AgentDeadline）。通过阶段 5 双路径收口消除。

### 8.5 LLM-first 与本地兜底校验的边界

- **风险**：taskKind 迁回 LLM（A15）后，LLM 可能不稳定返回 taskKind，本地兜底校验（`assertTaskKindFromLlm`）如何处理？
- **权衡**：
  - 严格遵守 AGENTS.md：本地只做结构校验与失败暴露，不做正则兜底识别。
  - LLM 未返回 taskKind 或返回非法值时，暴露 `llm_intent_unavailable` envelope，让用户重试或补充。
  - 不替用户猜测 taskKind。
- **残余风险**：LLM 在某些边界场景下稳定返回错误 taskKind（例如把"补空窗"识别为"全天编排"），本地校验无法发现。通过方向 5 LLM 调用监控 + 真实 LLM 评估基线发现与修正；用户可通过 UI 停止按钮及时中止错误编排。

---

## 9. 附录

### 9.1 关键文件索引（已核对）

| 文件 | 实际行数 | v2 论断行数 | 说明 |
|---|---|---|---|
| `src/components/dialogue/ChatPanel.vue` | 5844 | 5100+（v2 路径 `src/views/`） | 前台主面板，待拆分 |
| `src/services/runtime/demoRuntimeFacade.ts` | 9864 | 10540 | DemoRuntimeFacade 总控 |
| `src/services/agent/atomicCommandCapability.ts` | 6193 | 6630+ | AtomicCommandCapability |
| `src/services/llm/agentPlanner.ts` | 572 | - | AgentPlanner，含 `formal_orchestration` action（line 43-48） |
| `src/services/runtime/reactTaskTypes.ts` | - | - | DEFAULT_REACT_TASK_LIMITS（line 72-74） |
| `src/services/runtime/reactTaskRuntime.ts` | - | - | ReAct 数据结构 |
| `src/services/runtime/agentServerSessionStore.ts` | - | - | session 持久化（v2 路径 `src/services/agent/`） |
| `src/services/runtime/agentServerFileSessionStore.ts` | - | - | file persist |
| `src/services/agent/capabilityRegistry.ts` | 24 | - | Capability 注册表 |
| `src/services/agent/schedulingAgentRuntime.ts` | - | - | 注册 AtomicCommandCapability（line 77-78） |
| `src/services/agent/agentDeadline.ts` | 198 | - | 方向 1 落地，**未接入主链路** |
| `src/services/agent/mutationPolicy.ts` | - | - | 方向 1 落地，**未接入主链路** |
| `src/services/agent/recoverableFailureEnvelope.ts` | - | - | 方向 1 落地，**未接入主链路** |
| `src/services/agent/failureEnvelopeFormatter.ts` | - | - | 方向 1 落地，被 FailureFormatter.vue 引用 |
| `src/components/dialogue/FailureFormatter.vue` | - | - | 方向 1 落地，**v-if 永远为 false** |
| `src/services/orchestrator.ts` | - | - | 老 Orchestrator 类（line 388 cancel()） |
| `src/composables/useOrchestrator.ts` | - | - | 前台编排 composable |
| `src/views/broadcast-plan/useBroadcastPlanOrchestration.ts` | - | - | 接收 orchestrateRequested（line 160-188） |
| `src/views/broadcast-plan/create.vue` | - | - | 前台主视图 |

### 9.2 核对使用的搜索证据

本文档所有论断均基于以下搜索结果：

- `Grep "resolveFormalOrchestrationTaskKind" src/` → `demoRuntimeFacade.ts:7578, 7600-7610`
- `Grep "orchestrator|Orchestrator" src/services/runtime/demoRuntimeFacade.ts` → 无匹配
- `Grep "register\(|AtomicCommandCapability" src/services/agent/` → `schedulingAgentRuntime.ts:77-78`
- `Grep "maxTurns|batchSize" src/services/runtime/reactTaskRuntime.ts` → `reactTaskTypes.ts:72-74`
- `Grep "recoverableFailure|mutationPolicy|agentDeadline" src/services/runtime/demoRuntimeFacade.ts` → 无匹配
- `Grep "recoverableFailure|mutationPolicy|agentDeadline" src/services/agent/atomicCommandCapability.ts` → 无匹配
- `Grep "recoverableFailureEnvelope\.value\s*=" src/components/dialogue/ChatPanel.vue` → 仅 line 990 赋值为 null
- `Grep "timeout:\s*\d+_?000" src/` → 6s/8s/15s/30s/60s 五套
- `Grep "orchestrateRequested" src/` → `ChatPanel.vue:675, 1102, 1762, 1807` + `create.vue:590` + `useBroadcastPlanOrchestration.ts:160`
- `Read package.json:29` → `agent:check:tests` 列表确认

### 9.3 与 AGENTS.md 的对齐说明

- **LLM-first**：本文档所有方向都遵守 LLM-first。taskKind 迁回 LLM（A15）是对齐 LLM-first 的修复。
- **本地只保护结果**：`AgentDeadline`、`MutationPolicy`、`assertMutationAllowed`、`assertTaskKindFromLlm` 都是保护结果，不改写意图。
- **暴露失败不假装理解**：`RecoverableInterpretationFailure` envelope 是结构化失败暴露，不假装理解。
- **渐进式演进**：方向 1 接入闭环采用渐进式（先 envelope 数据流，再 deadline，再 mutationPolicy），不一次性大重构。
- **Scheduling Guardrails**：方向 2 状态机统一把 guardrails 落到 `VALID_TRANSITIONS`。
- **Atomic Command Policy By Playlist Type**：方向 3 Capability 拆分保留电视播单直接执行、轮播单候选推荐、删除始终确认的策略。
- **Verification Gates**：每个阶段都包含 `agent:check` + 前台冒烟 + 构建检查。
- **不引入回退**：方向 2 6.5 节 `FailureExposer` 取代 MutationJournalService，失败暴露而非回滚。
- **不引入子 agent**：方向 3 只保留按 intent 拆分 + 统一分发 + FormalOrchestrationCapability，不叠加子 agent 雏形。

### 9.4 残余风险与未覆盖点

- **真实 LLM 评估基线未建立**：当前 `agent:check` 基于 mock LLM 响应。真实 LLM 的稳定性、准确率、成本无基线。建议在方向 5 落地后补充 `npm run agent:eval` 入口（v2 12.1 节）。
- **mock 数据与真实节目库的差异**：当前 case 基于 mock 节目库。真实节目库的字段完整度、收视率数据、历史编排记录可能与 mock 有差异（v2 12.3 节）。
- **双路径收口迁移成本**：方向 4 双路径收口需要把老 Orchestrator 的编排逻辑迁入 FormalOrchestrationCapability + ReactExecutor，迁移成本高（v2 12.4 节）。
- **taskKind 迁回 LLM 后的稳定性**：LLM 可能不稳定返回 taskKind（v2 12.5 节）。需要在方向 5 LLM 调用监控落地后建立 taskKind 返回准确率的真实 LLM 评估基线。
- **方向 1 接入闭环的隐式依赖**：`buildRecoverableLlmFailureDecision` 升级为产出 envelope 后，所有调用该方法的点（`demoRuntimeFacade.ts:650, 2076, 8277` 等）都需要适配，可能引入隐式回归。通过 `recoverableFailureEnvelope.test.ts` + 前台冒烟覆盖。

---

## 章节目录

1. 背景与约束
2. 代码现状核对（v2 论断 vs 实际代码）
   - 2.1 已核对：v2 论断准确的部分
   - 2.2 已过期：v2 论断失准的部分
   - 2.3 v2 未识别的新缺陷（关键发现）
   - 2.4 核对结果汇总表
3. 架构缺陷重新评估
   - 3.1 已被方向 1 部分缓解的缺陷（但未完全消除）
   - 3.2 仍存在且需优先处理的缺陷
   - 3.3 v2 未识别的新缺陷（A17-A20）
   - 3.4 缺陷重新评估汇总
4. 与成熟 agent 的具体模式对照
   - 4.1 Codex 模式对照
   - 4.2 Claude Code 模式对照
   - 4.3 Trae 模式对照
   - 4.4 LangGraph 模式对照
   - 4.5 模式对照汇总
5. 前台体验差距分析
   - 5.1 ChatPanel.vue 状态管理复杂度
   - 5.2 FailureFormatter 已落地但 canQuickRetry 未接入
   - 5.3 长流程执行时前台是否有停止按钮、进度可视化、批次边界
   - 5.4 候选推荐 card 是否可点击进入编排闭环
   - 5.5 前台体验差距汇总
6. 工程化方向明确化
   - 6.1 必须立刻做（阻断方向 2-4 实施）
   - 6.2 可以并行做（不阻断业务）
   - 6.3 可延后（投入产出比低）
   - 6.4 工程化方向分级汇总
7. 下一步明确建议
   - 7.1 关键问题回答
   - 7.2 推荐路径
   - 7.3 与 v2 推荐排序的差异
8. 风险与权衡
9. 附录
   - 9.1 关键文件索引（已核对）
   - 9.2 核对使用的搜索证据
   - 9.3 与 AGENTS.md 的对齐说明
   - 9.4 残余风险与未覆盖点
