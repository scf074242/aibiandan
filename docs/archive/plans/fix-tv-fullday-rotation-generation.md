# 修复方案：电视播单全天编排 + 轮播单"主题+时长"生成

> 状态：待用户确认
> 类型：缺陷修复执行卡（对齐 AGENTS.md Mandatory Flow）
> 范围：仅修复以下两个功能的真实运行失败，不做架构重构

---

## 一、问题陈述

### 1.1 电视播单全天编排

- **症状**：在 ChatPanel 点"全天编排"快捷按钮（prompt: "帮我全天编排"）后，进度 UI 直接跳出，约 5 秒即"全编排完"，但实际未排入任何节目。
- **期望**：全天编排应真正进入 phase2 填充循环，按版面+历史上下文+候选检索逐步填空窗；如确实无法填充，应明确暴露失败原因，而不是伪装成"已完成"。

### 1.2 轮播单"主题+时长"生成

- **命令**：`生成一个关于世界杯亚洲队集锦的轮播单，时长1小时`
- **症状**：失败，返回固定文案"这次模型没有及时返回，我还没有修改草案或播单。你可以直接说"重试"，我会按刚才这句话再试一次。"
- **期望**：应成功创建轮播单并生成 1 小时草案（columns / durationSegments / targetDurationSeconds=3600），返回"已新建轮播单…整理了一份轮播草案"。

---

## 二、根因分析

### 2.1 电视全天编排根因（优先级 1，最直接）

**失败链路**（[orchestrator.ts](file:///./src/services/orchestrator.ts)）：

1. `prepareGapPlan`（L833）发现 `candidatesResult.candidates.length === 0` → throw
2. `prepareBatchPlans`（L799-812）catch 后 `markFailed` 所有空窗
3. `phase2Filling`（L504-506）发现 `preparedPlans.length === 0` 且 `getRelevantRemainingGaps` 返回空 → `break`
4. `phase3Repair`（L580）因 `successfulCommands === 0` 直接 return
5. `resolveTerminalStatus`（L472）因 `failedCommands > 0` 返回 `'manual_review'`
6. `emit('complete')`（L293）→ `isRunning` 快速变 false → UI 一闪而过
7. [formalOrchestrationCapability.ts](file:///./src/services/agent/formalOrchestrationCapability.ts) L188-196 返回 `status: 'executed'`，实际上 0 个节目被排入

**候选检索为空的底层原因**（[candidateService.ts](file:///./src/services/candidateService.ts) L124-167，三选一或多选）：

- L139 `sourcePool = candidates.filter(c => c.channelId === criteria.channelId)`：当前频道 channelId 与 mock 候选库 channelId 不匹配 → sourcePool 为空
- L136 `getEffectiveProgramsByColumn`：版面未通过 `setRuntimeLayout` 注册到 `runtimeLayoutRegistry`，导致 `allowedProgramIds` 与候选库不匹配
- L144-146 `matchesProgramType`：LLM 生成的 `programTypePreference` 与 mock 候选库的 programType 不匹配

**配套缺陷**：

- [useOrchestrator.ts](file:///./src/composables/useOrchestrator.ts) L148 调用 `facade.startFullGeneration` 未传 `deadline`，导致整条长流程链路 `_runtime.deadline` 为 undefined，`AbortSignal` 无法联动，违反 AGENTS.md "timeout/deadline 统一管理"硬约束
- [formalOrchestrationCapability.ts](file:///./src/services/agent/formalOrchestrationCapability.ts) L738 `buildFailureResult` 只产出 `constraintReport.issues`，不产出结构化 `RecoverableInterpretationFailure` envelope，前台无法据此生成 quick replies

### 2.2 轮播单生成根因

**失败链路**（[demoRuntimeFacade.ts](file:///./src/services/runtime/demoRuntimeFacade.ts) + [agentPlanner.ts](file:///./src/services/llm/agentPlanner.ts)）：

1. `submitInstruction`（L1827）创建 `new AgentDeadline()`（L1831，30s 默认）
2. `tryHandleAgentPlannerInstruction`（L663）调用 `agentPlanner.plan()`
3. [agentPlanner.ts](file:///./src/services/llm/agentPlanner.ts) L367 用固定 `timeout: STAGE_TIMEOUT_BUDGET.candidate_search = 12s`，**未传 AbortSignal，未用 deadline**
4. LLM 调用失败（12s timeout 或返回不可解析 JSON）→ catch（L373-378）
5. 返回 `llmFailure` → `buildRecoverableLlmFailureDecision`（demoRuntimeFacade.ts L673）产出固定文案"这次模型没有及时返回..."

**配套缺陷**：

- [layoutDraftService.ts](file:///./src/services/layoutDraftService.ts) L620-627 / L651-658 `generateSpec` / `refineSpec` 同样用固定 90s timeout，未接入 AgentDeadline
- `DemoRuntimeFacade.submitInstruction` L1831 创建的 `currentDeadline` 没有透传到 `agentPlanner.plan` 和 `layoutDraftService.generateSpec`
- 失败 envelope 缺业务槽位（`recognizedSlots` / `missingSlots` / `candidateEvidence` / `retrySuggestions`），用户只看到固定文案，不知道是 timeout、JSON 解析失败还是网络错误

**注意**：单元测试全绿（814 passed），因为 mock 了 LLM。真实运行时 LLM 返回不可控，12s 对"主题+时长+草案结构"这类复杂 prompt 偏紧。

---

## 三、修复方案（按优先级）

### P0-1 电视全天编排：诊断候选检索失败层 + 修正

**第一步：加诊断日志（仅 dev，不污染生产）**

- 文件：[candidateService.ts](file:///./src/services/candidateService.ts) `queryCandidates`（L124 附近）
- 改动：在过滤链每层后，当结果为空时输出 `console.warn` 含 `channelId` / `columnId` / `programTypePreference` / 各层命中数。仅当 `import.meta.env.DEV` 为 true 时输出。
- 目的：让用户在浏览器 console 直接看到哪层过滤为空，定位真实原因。

**第二步：根据诊断结果修正（三选一，取决于实际命中）**

- 若 `sourcePool` 为空（channelId 不匹配）：检查 mock 候选库的 channelId 字段，确保当前频道能匹配；或在 candidateService 增加"频道兜底"逻辑——当严格 channelId 匹配为空时，回退到不限频道的候选池并 log warn。
- 若 `columnMatched` 为空（版面未注册）：检查 [useBroadcastPlanOrchestration.ts](file:///./src/views/broadcast-plan/useBroadcastPlanOrchestration.ts) L169-182，确保 `payload.layoutDraft` 存在时一定调用 `setRuntimeLayout`；若用户无草案，应被 bootstrap 门禁阻拦（已有逻辑），不应进入执行路径。
- 若 `typeMatched` 为空（programType 不匹配）：放宽 [candidateService.ts](file:///./src/services/candidateService.ts) L144-146 `matchesProgramType`，当严格匹配为空时回退到"不限 programType"并 log warn；或修正 LLM prompt 让 programType 与候选库对齐。

**第三步：phase2 全部失败时暴露真实失败（不再伪装完成）**

- 文件：[orchestrator.ts](file:///./src/services/orchestrator.ts) `resolveTerminalStatus`（L468）+ `startFullGeneration`（L291 附近）
- 改动：当 `successfulCommands === 0 && failedCommands > 0` 时，状态从 `'manual_review'` 改为 `'failed'`，并在 session 中记录"全部空窗候选检索失败"的结构化原因（含失败 gap 列表 + rejectionReasons）。`emit('complete')` 改为 `emit('error', { error: new Error('全部空窗候选检索失败') })`，让 [formalOrchestrationCapability.ts](file:///./src/services/agent/formalOrchestrationCapability.ts) L197 catch 走 `buildFailureResult`。
- 目的：让用户看到真实失败，而不是"5 秒全编排完"的假象。

### P0-2 电视全天编排：deadline 透传（合规修复）

- [useOrchestrator.ts](file:///./src/composables/useOrchestrator.ts) L148：构造 `new AgentDeadline({ overallDeadlineMs: LONG_RUNNING_DEADLINE_BUDGET.overallDeadlineMs })` 传入 `facade.startFullGeneration`
- [schedulingAgentRuntimeFacade.ts](file:///./src/services/runtime/schedulingAgentRuntimeFacade.ts) L149：确保 `deadline` 参数透传到 `submitOrchestration`（L223）→ `runtime.submit`（L242）→ `capability.handle` 的 `_runtime.deadline`
- [formalOrchestrationCapability.ts](file:///./src/services/agent/formalOrchestrationCapability.ts) L151-153：`_runtime.deadline?.signal()` 不再永远 undefined
- [orchestrator.ts](file:///./src/services/orchestrator.ts) L447-450 `runWithTimeout`：改为优先用 `deadline?.stageTimeoutMs(...)` + `signal`，保留旧 timeout 作为兜底

### P0-3 轮播单：agentPlanner + layoutDraftService 接入 AgentDeadline

- [agentPlanner.ts](file:///./src/services/llm/agentPlanner.ts) `plan`（L362）：增加 `deadline?: AgentDeadline` 参数；L367 `timeout` 改为 `deadline?.stageTimeoutMs(STAGE_TIMEOUT_BUDGET.candidate_search) ?? STAGE_TIMEOUT_BUDGET.candidate_search`；传入 `signal: deadline?.signal()` 给 `llmClient.chat`
- [layoutDraftService.ts](file:///./src/services/layoutDraftService.ts) `generateSpec`（L611）/ `refineSpec`（L643）：同样接入 `deadline?.stageTimeoutMs(LONG_RUNNING_DEADLINE_BUDGET.batchDeadlineMs)` + `signal`
- [demoRuntimeFacade.ts](file:///./src/services/runtime/demoRuntimeFacade.ts) `tryHandleAgentPlannerInstruction`（L663）调用 `agentPlanner.plan` 时传入 `this.currentDeadline`；`prepareLayoutDraft`（L7919）调用 `layoutDraftService.generateSpec` 时传入 `this.currentDeadline`

### P0-4 轮播单：提升 agentPlanner timeout 上限

- [agentDeadline.ts](file:///./src/services/agent/agentDeadline.ts) `STAGE_TIMEOUT_BUDGET.candidate_search`：从 12s 提升到 30s（与 memory 中"30s 仍可能 unable_to_decide"对齐，但 12s 肯定不够）
- 同时在 `agentPlanner.plan` catch（L373-378）中区分失败类型：`timeout` / `json_parse` / `network`，分别记录到 trace，便于后续诊断

### P1-1 失败 envelope 结构化（两个功能共用）

- [formalOrchestrationCapability.ts](file:///./src/services/agent/formalOrchestrationCapability.ts) `buildFailureResult`（L738）：产出 `RecoverableInterpretationFailure` envelope，含 `kind` / `recognizedSlots` / `missingSlots` / `candidateEvidence` / `retrySuggestions`
- [demoRuntimeFacade.ts](file:///./src/services/runtime/demoRuntimeFacade.ts) `buildRecoverableLlmFailureDecision`（L673）：把已识别的 `playlistType` / `rotationDurationSeconds` / `semanticLabel` 写入 `recognizedSlots`；根据失败类型生成 `retrySuggestions`（如"重试"/"换关键词"/"缩短时长"）

---

## 四、回归 Case（必须先补，再改实现）

### 4.1 电视全天编排新增 case

- 文件：[src/services/__tests__/orchestrator.test.ts](file:///./src/services/__tests__/orchestrator.test.ts)
- case1：`全天编排候选检索全部失败时应返回 failed 状态而非 manual_review，并携带结构化失败原因`
- case2：`全天编排路径下 facade.startFullGeneration 应携带 long-running deadline`（断言 `_runtime.deadline` 非 undefined）
- case3：`candidateService.queryCandidates 当 channelId 不匹配时应输出诊断日志且不抛错`（dev 环境断言 console.warn 被调用）

### 4.2 轮播单生成新增 case

- 文件：[src/services/__tests__/demoRuntimeFacade.agentPlanner.test.ts](file:///./src/services/__tests__/demoRuntimeFacade.agentPlanner.test.ts)
- case1：`agentPlanner.plan 应接收并使用 AgentDeadline，timeout 来自 deadline.stageTimeoutMs`
- case2：`layoutDraftService.generateSpec 应接收并使用 AgentDeadline，传 signal 给 llmClient.chat`
- case3：`轮播单主题+时长生成失败时 envelope 应携带 recognizedSlots（rotationDurationSeconds/semanticLabel）`

所有新增 case 必须加入 [package.json](file:///./package.json) `agent:check:tests` 列表。

---

## 五、验证方式

1. `npm run agent:check`：所有测试（含新增 case）必须通过
2. `npm run build`：构建无报错
3. 浏览器冒烟（[scripts/foreground-browser-goal37.mjs](file:///./scripts/foreground-browser-goal37.mjs) / [foreground-browser-goal38.mjs](file:///./scripts/foreground-browser-goal38.mjs)）：
   - 电视播单：点"全天编排"，确认进度 UI 正常显示、phase2 真正填空窗、不再 5 秒假完成
   - 轮播单：输入"生成一个关于世界杯亚洲队集锦的轮播单，时长1小时"，确认成功生成草案
4. console 诊断日志：候选检索失败时能看到具体哪层为空

---

## 六、风险与不改动的部分

### 不改动

- 不引入真 ReAct 循环 / checkpoint / 上下文压缩（属于架构重构，超出本次修复范围，已在 v3 路线图 phase 3）
- 不删除本地正则补刀 `shouldTryDirectFormalOrchestration`（属于 LLM-first 收敛，超出本次范围）
- 不接入 FormalPlaylistWriteAdapter（属于写入边界迁移，超出本次范围）
- 不拆分 DemoRuntimeFacade / AtomicCommandCapability（属于 P0 技术债，超出本次范围）

### 风险

- 提升 agentPlanner timeout 到 30s 会让真实失败场景的等待时间从 12s 变 30s，但配合 AbortSignal 可中断，整体可接受
- phase2 全部失败改 `failed` 状态可能影响现有依赖 `manual_review` 的逻辑（需 grep 确认消费方）
- candidateService 加诊断日志是 dev-only，不影响生产，无风险

### 风险缓释

- 每个改动点都先补回归 case，再改实现
- 改动后立即跑 `npm run agent:check`，失败立即回滚该改动
- 浏览器冒烟必须真实跑通两个功能

---

## 七、实现顺序

1. 先补回归 case（第四节），确认 case 在当前代码下失败（红）
2. P0-3 + P0-4：轮播单 deadline 接入 + timeout 提升（改动小，风险低，先落地）
3. P0-2：电视全天编排 deadline 透传（改动小，合规修复）
4. P0-1：电视全天编排候选检索诊断 + 修正（需要实际跑浏览器看 console 日志，分步进行）
5. P1-1：失败 envelope 结构化（两个功能共用，最后做）
6. 全量验证：`npm run agent:check` + `npm run build` + 浏览器冒烟

---

## 八、文档同步声明

- 本方案为临时执行卡，任务完成后移入 `docs/archive/`
- 若涉及 AGENTS.md / docs/agent-development-protocol.md 约束变化，同步更新
- 本次修复不改变架构约束，无需更新 code-wiki.md 模块索引

## 九、架构对齐声明

- 对齐 AGENTS.md "timeout/deadline 统一管理"硬约束（P0-2 / P0-3）
- 对齐 AGENTS.md "失败暴露而非回滚"硬约束（P0-1 第三步 / P1-1）
- 对齐 AGENTS.md "失败时必须产出结构化 RecoverableInterpretationFailure envelope"硬约束（P1-1）
- 不引入自动回滚、不引入子 agent，符合 Design Philosophy
