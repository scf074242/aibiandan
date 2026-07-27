# Prompt 版本管理门禁全闭环技术方案

> **方案类型**：基础设施补齐 + Prompt 版本管理门禁闭环（LLM-first 主路径不变，仅做 trace 审计能力补齐）
> **方案状态**：待用户确认
> **方案作者**：solution-architect agent
> **对齐约束**：AGENTS.md Verification Gates「Prompt 版本管理」+ Naming Conventions「prompt 版本命名」+ LLM 调用监控与成本核算

---

## 1. 问题与目标

### 1.1 执行卡复述

| 项 | 内容 |
| --- | --- |
| 问题 | Prompt 版本管理门禁 13 处未接入版本号，trace 中无法观测 prompt 版本；`chatStream` 完全无 trace 落盘 |
| 期望 | 所有 system prompt 显式声明版本号常量；调用 `llmClient.chat` / `chatStream` 时透传 `promptVersion`；trace 中能观察版本号；业务逻辑零变化（不改 prompt 文本、不改调用流程、不改行为） |
| 前置数据 | 已接入基准 3 处（candidateJudge v1.2 / llmAgentIntentInterpreter v2.0 / orchestrationPromptBuilder v1.0 仅声明未透传） |
| 风险 | 误改 prompt 内容；调用方传错版本号；`chatStream` 接入 trace 改变流式语义；多文件批量改动回归风险 |
| 验证方式 | 命中已有 case（`llmClient.promptVersion.test.ts` 5 个 case）+ 每接入一个文件至少新增 1 个回归 case + `npm run agent:check` |

### 1.2 目标拆解（可验证）

1. **G1 基础设施**：`chatStream` 接入 `recordRequestTrace` + `promptVersion` 透传，流式语义不变。
2. **G2 版本号常量**：13 处未接入文件全部声明 `<DOMAIN>_PROMPT_VERSION = 'vX.Y' as const` 常量。
3. **G3 调用方透传**：所有 `llmClient.chat` / `chatStream` 调用点在 options 中透传 `promptVersion`。
4. **G4 trace 可观测**：trace 中能观察所有 LLM 调用的 `promptVersion`（含成功 / 失败 / 流式）。
5. **G5 业务零变化**：无 prompt 文本改动、无调用流程改动、无行为变化（仅新增常量 + 透传字段 + trace 落盘）。

---

## 2. 现状分析

### 2.1 已接入基准（3 处，本次不动）

| 文件 | 版本号常量 | 当前版本 | 透传到 `chat` | 文本标注 |
| --- | --- | --- | --- | --- |
| [candidateJudge.ts](file:///./src/services/agent/candidateJudge.ts) | `CANDIDATE_JUDGE_PROMPT_VERSION` | `v1.2` | ✅ L77 | ✅ `[prompt v1.2]` |
| [llmAgentIntentInterpreter.ts](file:///./src/services/agent/llmAgentIntentInterpreter.ts) | `INTENT_INTERPRETER_PROMPT_VERSION` | `v2.0` | ✅ L78 | ✅（system prompt 内） |
| [orchestrationPromptBuilder.ts](file:///./src/services/orchestrationPromptBuilder.ts) | `ORCHESTRATION_PROMPT_BUILDER_VERSION` | `v1.0` | ❌ 未导出 / 调用方未透传 | ✅ `[prompt v1.0]`（三处 build 函数文本） |

### 2.2 基础设施已就位（本次不动）

- [llm.ts](file:///./src/types/llm.ts)：`ChatOptions.promptVersion?: string`（L63）、`LLMRequestTrace.promptVersion?: string`（L52）已声明。
- [llmClient.ts](file:///./src/services/llm/llmClient.ts) `chat()`（L91-201）：已提取 `options?.promptVersion`（L97），成功 trace 透传（L154）、失败 trace 透传（L195）。
- [llmClient.ts](file:///./src/services/llm/llmClient.ts) `tryBrowserMockChat()`（L203-265）：成功 trace 透传（L246）、失败 trace 透传（L261）。

### 2.3 未接入清单（按 Tier 分组，已逐文件核实）

#### Tier 1：基础设施缺口

| # | 文件 | 调用点 | 当前缺口 | 核实结论 |
| --- | --- | --- | --- | --- |
| 1 | [llmClient.ts](file:///./src/services/llm/llmClient.ts) | `chatStream` L270-307 | 不提取 `promptVersion`、不调用 `recordRequestTrace`；手动 token 计数 L300-306 | 流式语义不能变，仅补 trace 落盘 |
| 2 | [orchestrationPromptBuilder.ts](file:///./src/services/orchestrationPromptBuilder.ts) + 调用方 | 常量 L14 未 `export` | 调用方 `candidateSelectionService.ts` L71 / L128 未透传 `promptVersion` | 实际调用方为 `candidateSelectionService.ts`（L71 `buildInsertCandidateSelectionPrompt`、L128 `runGapSelectionLlmWithTimeout` 接收 `buildGapCandidateSelectionPrompt` 产物） |

> **核实修正**：执行卡提到 `orchestrator.ts` L436 是 `orchestrationPromptBuilder` 调用方，实测 L436 调用的是 `orchestrator` 自身的 `buildPlanningPrompt`（定义在 L1198，内联 prompt），**不是** `orchestrationPromptBuilder` 的产物。因此 `orchestrationPromptBuilder` 的真实调用方仅 `candidateSelectionService.ts`；`orchestrator.ts` L436 归入 Tier 3 第 11 项单独处理。

#### Tier 2：单文件多 prompt 重灾区

| # | 文件 | 内联 prompt 数 | 当前缺口 |
| --- | --- | --- | --- |
| 3 | [systemPrompts.ts](file:///./src/services/llm/prompts/systemPrompts.ts) | 5 个导出常量（ORCHESTRATION_EXPERT / DIALOGUE_ASSISTANT / CANDIDATE_QUERY_EXPERT / PROGRAM_SELECTOR / REPAIR_EXPERT），均为裸字符串 | 无版本号常量、无文本标注、无透传 |
| 4 | [promptBuilder.ts](file:///./src/services/llm/promptBuilder.ts) | 7 个 build 方法内联 system prompt（buildPlanning / buildQueryCandidates / buildFillItem / buildRepair / buildClarification / buildExplanation / buildTaskClassification） | 无版本号常量、无文本标注、无透传 |
| 5 | [layoutDraftService.ts](file:///./src/services/layoutDraftService.ts) | 2 段内联（generateSpec L610、refineSpec L640） | 无版本号常量、无透传；traceLabel 已有（`layout_draft_generate` / `layout_draft_refine`） |

#### Tier 3：单文件单/多 prompt（批量接入）

| # | 文件 | 调用点 | traceLabel | 当前缺口 |
| --- | --- | --- | --- | --- |
| 6 | [agentPlanner.ts](file:///./src/services/llm/agentPlanner.ts) | L357 | `agent_planner` | 无版本号、无透传 |
| 7 | [layoutAnalysisPromptBuilder.ts](file:///./src/services/layoutAnalysisPromptBuilder.ts) + 调用方 [layoutAnalysisService.ts](file:///./src/services/layoutAnalysisService.ts) L534 | `buildLayoutAnalysisPrompt` | **无 traceLabel** | 无版本号、无 traceLabel、无透传 |
| 8 | [intentRecognizer.ts](file:///./src/services/intentRecognizer.ts) | L23 | `atomic_intent` | 无版本号、无透传（prompt 内联在 L24-41） |
| 9 | [paramExtractor.ts](file:///./src/services/paramExtractor.ts) | 4 处：L36 / L80 / L120 / L159 | `atomic_insert_params` / `atomic_move_params` / `atomic_delete_params` / `atomic_replace_params` | 无版本号、无透传（4 段内联 system prompt） |
| 10 | [candidateSelectionService.ts](file:///./src/services/candidateSelectionService.ts) | L71 / L128 | **无 traceLabel** | 无版本号、无 traceLabel、无透传 |
| 11 | [orchestrator.ts](file:///./src/services/orchestrator.ts) | L436（自身 `buildPlanningPrompt` L1198 内联） | 无 traceLabel | 无版本号、无 traceLabel、无透传 |
| 12 | [layoutIntentRecognizer.ts](file:///./src/services/layoutIntentRecognizer.ts) | L66 | `layout_intent` | 无版本号、无透传 |
| 13 | [scheduleTargetResolver.ts](file:///./src/services/scheduleTargetResolver.ts) | L126 | 无 traceLabel | 无版本号、无 traceLabel、无透传（prompt 内联 L129-132） |
| 14 | [repairManager.ts](file:///./src/services/repairManager.ts) | L178（`buildRepairPrompt` L193 内联） | 无 traceLabel | 无版本号、无 traceLabel、无透传 |
| 15 | [explainInterfaces.ts](file:///./src/services/orchestration/interfaces/explainInterfaces.ts) | L42（`buildCandidateExplanationPrompt` L139 内联） | 无 traceLabel | 无版本号、无 traceLabel、无透传 |
| 16 | [demoRuntimeFacade.ts](file:///./src/services/runtime/demoRuntimeFacade.ts) | L1600 / L3276 / L3457 | `agent_react_synthesize` / `playlist.optimization_suggestion` \| `playlist.readonly_analysis` / `playlist.analysis_to_task_plan` | 无版本号、无透传（3 段内联 system prompt） |

### 2.4 现有测试基线

- [llmClient.promptVersion.test.ts](file:///./src/services/__tests__/llmClient.promptVersion.test.ts)：5 个 case（c1-trace-carries-prompt-version / c1-trace-undefined-when-no-version / c1-failure-trace-also-carries-version / c1-candidate-judge-passes-version / c1-intent-interpreter-passes-version）。
- 已纳入 `package.json` 的 `agent:check:tests`（已核实）。

---

## 3. 设计原则

1. **业务逻辑零变化**：不改 prompt 文本内容（仅在 system message 首部追加 `[prompt vX.Y]` 标注，对齐 candidateJudge / orchestrationPromptBuilder 既有范式）、不改调用流程、不改 timeout / maxTokens / temperature / maxRetries、不改返回值结构、不改行为。
2. **用户体验更好**：trace 完整（含流式）、版本可审计、问题可归因。
3. **命名约定遵循 AGENTS.md**：常量命名 `<DOMAIN>_PROMPT_VERSION = 'vX.Y' as const`；多 prompt 文件采用 `<DOMAIN>_<SUB>_PROMPT_VERSION` 或文件级 `PROMPT_BUILDER_VERSION`。
4. **版本号初始值**：
   - 未接入过的文件统一 `v1.0`。
   - 已接入过的保持现状不升版（candidateJudge `v1.2` / intentInterpreter `v2.0` / orchestrationPromptBuilder `v1.0`）。
   - 本次不修订任何 prompt 文本，因此不触发升版。
5. **chatStream 接入 trace 必须保持流式语义不变**：yield 顺序、yield 时机、yield 内容完全一致；trace 仅在 `finally` 块落盘。
6. **常量引用而非字面量**：调用方透传时必须引用导出的常量，禁止写字面量 `'v1.0'`，避免版本漂移。
7. **Codex 对齐审查**：本次属本地 trace 审计能力补齐，不涉及 LLM-first 主路径、不涉及意图改写、不引入子 agent、不引入回滚，对齐 Codex「调用即记审计」的观测实践，**不涉及 Codex 特有范式迁移**。

---

## 4. 修复方案（按 Tier 分组）

### 4.1 Tier 1-1：chatStream 接入 trace + promptVersion

**文件**：[llmClient.ts](file:///./src/services/llm/llmClient.ts) `chatStream`（L270-307）

**改动**：
- 在方法入口提取 `traceLabel`（默认 `'chat_stream'`）、`promptVersion`、`startedAt`、`promptStats`。
- 用 `try / catch / finally` 包裹现有流式逻辑：
  - `try`：保留现有 `stream` 创建 + `for await` yield + 手动 token 计数（L300-306）不变。
  - `catch`：`success = false`、`error = normalized.message`，`throw` 重新抛出。
  - `finally`：调用 `recordRequestTrace`（label / attemptCount=1 / durationMs / timeoutMs / promptStats / success / error / startedAt / promptVersion）。
- `timeoutMs` 取 `options?.timeout ?? DEFAULT_REQUEST_TIMEOUT_MS`（与 `chat()` 一致）。

**不改**：`yield` 顺序、`yield` 时机、`yield` 内容、token 估算公式（`length/4` + chunk 计数）、`tokenUsage` 累加逻辑。

**详见**：第 5 章 chatStream 专项设计。

### 4.2 Tier 1-2：orchestrationPromptBuilder 调用方透传

**文件 A**：[orchestrationPromptBuilder.ts](file:///./src/services/orchestrationPromptBuilder.ts)
- L14：将 `const ORCHESTRATION_PROMPT_BUILDER_VERSION = 'v1.0' as const` 改为 `export const ORCHESTRATION_PROMPT_BUILDER_VERSION = 'v1.0' as const`（仅加 `export` 关键字，不改值、不改文本标注）。

**文件 B**：[candidateSelectionService.ts](file:///./src/services/candidateSelectionService.ts)
- L71-74：`chat(buildInsertCandidateSelectionPrompt(...), { temperature: 0.1, maxTokens: 240 })` → options 追加 `traceLabel: 'insert_candidate_selection'` + `promptVersion: ORCHESTRATION_PROMPT_BUILDER_VERSION`（import 常量）。
- L128：`runGapSelectionLlmWithTimeout` 内 `chat(prompt, { temperature: 0.1, maxTokens: 260 })` → options 追加 `traceLabel: 'gap_candidate_selection'` + `promptVersion: ORCHESTRATION_PROMPT_BUILDER_VERSION`。

**不改**：`buildQueryIntentPrompt` / `buildGapCandidateSelectionPrompt` / `buildInsertCandidateSelectionPrompt` 三个 build 函数的文本（已含 `[prompt v1.0]` 标注）。

### 4.3 Tier 2-3：systemPrompts.ts（5 个常量）

**文件**：[systemPrompts.ts](file:///./src/services/llm/prompts/systemPrompts.ts)

**改动**：
- 为 5 个常量各声明独立版本号常量（`as const`），统一 `v1.0`：

```ts
export const ORCHESTRATION_EXPERT_PROMPT_VERSION = 'v1.0' as const
export const DIALOGUE_ASSISTANT_PROMPT_VERSION = 'v1.0' as const
export const CANDIDATE_QUERY_EXPERT_PROMPT_VERSION = 'v1.0' as const
export const PROGRAM_SELECTOR_PROMPT_VERSION = 'v1.0' as const
export const REPAIR_EXPERT_PROMPT_VERSION = 'v1.0' as const
```

- 在每个 prompt 常量字符串首部追加 `[prompt v1.0] ` 前缀（对齐 candidateJudge `[prompt v1.2]` 范式），不改正文。

**调用方透传**：需检索谁 `import` 这 5 个常量并调用 `chat`，在对应 options 追加 `promptVersion`。本次方案要求实现阶段用 Grep 定位消费点（`ORCHESTRATION_EXPERT_PROMPT` 等 5 个标识符），逐点透传。若消费点已用 `promptBuilder` / `orchestrator` / `repairManager` 等本方案覆盖文件，则在该文件统一透传。

### 4.4 Tier 2-4：promptBuilder.ts（7 个 build 方法）

**文件**：[promptBuilder.ts](file:///./src/services/llm/promptBuilder.ts)

**改动**：
- 文件级版本号常量（7 个 build 方法共享同一 prompt 基线，本次不修订文本，统一 `v1.0`）：

```ts
/** PromptBuilder 文件级 prompt 版本号（对齐 AGENTS.md Prompt 版本管理门禁） */
const PROMPT_BUILDER_VERSION = 'v1.0' as const
```

- 在 7 个 build 方法的 `systemPrompt` 字符串首部追加 `[prompt v1.0] ` 前缀（`buildPlanningPrompt` L39 / `buildQueryCandidatesPrompt` L97 / `buildFillItemPrompt` L170 / `buildRepairPrompt` L239 / `buildClarificationPrompt` L309 / `buildExplanationPrompt` L363 与 L389 两分支 / `buildTaskClassificationPrompt` L433）。
- 导出 `PROMPT_BUILDER_VERSION`，供调用方透传。

**调用方透传**：检索 `getPromptBuilder` / `promptBuilder` / `PromptBuilder` 消费点，在 `chat` options 追加 `promptVersion: PROMPT_BUILDER_VERSION`。

### 4.5 Tier 2-5：layoutDraftService.ts（2 段内联）

**文件**：[layoutDraftService.ts](file:///./src/services/layoutDraftService.ts)

**改动**：
- 文件级版本号常量：

```ts
const LAYOUT_DRAFT_PROMPT_VERSION = 'v1.0' as const
```

- L610 `generateSpec` 的 `chat` options 追加 `promptVersion: LAYOUT_DRAFT_PROMPT_VERSION`（traceLabel 已有 `layout_draft_generate`）。
- L640 `refineSpec` 的 `chat` options 追加 `promptVersion: LAYOUT_DRAFT_PROMPT_VERSION`（traceLabel 已有 `layout_draft_refine`）。
- 在 `buildGeneratePrompt` / `buildRefinePrompt` 的 system message 首部追加 `[prompt v1.0] ` 前缀。

### 4.6 Tier 3：单/多 prompt 批量接入

> 下表统一格式：常量名 / 初始版本 / 改动点。所有常量均 `as const`，统一 `v1.0`。

| # | 文件 | 常量名 | 改动点 |
| --- | --- | --- | --- |
| 6 | [agentPlanner.ts](file:///./src/services/llm/agentPlanner.ts) | `AGENT_PLANNER_PROMPT_VERSION` | L357 options 追加 `promptVersion`；`buildPrompt` system message 首部追加 `[prompt v1.0]` |
| 7 | [layoutAnalysisPromptBuilder.ts](file:///./src/services/layoutAnalysisPromptBuilder.ts) + [layoutAnalysisService.ts](file:///./src/services/layoutAnalysisService.ts) | `LAYOUT_ANALYSIS_PROMPT_VERSION`（builder 内声明并 export） | builder 的 `systemPrompt` 数组首元素追加 `'[prompt v1.0]'`；调用方 L534 options 追加 `traceLabel: 'layout_analysis'` + `promptVersion: LAYOUT_ANALYSIS_PROMPT_VERSION` |
| 8 | [intentRecognizer.ts](file:///./src/services/intentRecognizer.ts) | `INTENT_RECOGNIZER_PROMPT_VERSION` | L23 options（L43）追加 `promptVersion`；L27 system content 首部追加 `[prompt v1.0]` |
| 9 | [paramExtractor.ts](file:///./src/services/paramExtractor.ts) | `PARAM_EXTRACTOR_PROMPT_VERSION`（文件级，4 段共享） | L36/L80/L120/L159 四处 options 追加 `promptVersion`；4 段 system content 首部追加 `[prompt v1.0]` |
| 10 | [candidateSelectionService.ts](file:///./src/services/candidateSelectionService.ts) | 复用 `ORCHESTRATION_PROMPT_BUILDER_VERSION`（Tier 1-2 已处理） | L71/L128 options 追加 `traceLabel` + `promptVersion`（见 4.2） |
| 11 | [orchestrator.ts](file:///./src/services/orchestrator.ts) | `ORCHESTRATOR_PROMPT_VERSION` | L436 options 追加 `traceLabel: 'orchestrator_planning'` + `promptVersion`；L1201 自身 `buildPlanningPrompt` system message 首部追加 `[prompt v1.0]` |
| 12 | [layoutIntentRecognizer.ts](file:///./src/services/layoutIntentRecognizer.ts) | `LAYOUT_INTENT_RECOGNIZER_PROMPT_VERSION` | L66 options 追加 `promptVersion`；`buildPrompt` system message 首部追加 `[prompt v1.0]` |
| 13 | [scheduleTargetResolver.ts](file:///./src/services/scheduleTargetResolver.ts) | `SCHEDULE_TARGET_RESOLVER_PROMPT_VERSION` | L126 options 追加 `traceLabel: 'schedule_target_resolve'` + `promptVersion`；L129 system content 首部追加 `[prompt v1.0]` |
| 14 | [repairManager.ts](file:///./src/services/repairManager.ts) | `REPAIR_MANAGER_PROMPT_VERSION` | L178 options 追加 `traceLabel: 'repair_strategy'` + `promptVersion`；`buildRepairPrompt` L200 systemPrompt 首部追加 `[prompt v1.0]` |
| 15 | [explainInterfaces.ts](file:///./src/services/orchestration/interfaces/explainInterfaces.ts) | `EXPLAIN_INTERFACES_PROMPT_VERSION` | L42 options 追加 `traceLabel: 'candidate_explanation'` + `promptVersion`；`buildCandidateExplanationPrompt` L149 system content 首部追加 `[prompt v1.0]` |
| 16 | [demoRuntimeFacade.ts](file:///./src/services/runtime/demoRuntimeFacade.ts) | `DEMO_RUNTIME_FACADE_PROMPT_VERSION`（文件级，3 段共享） | L1600 / L3276 / L3457 三处 options 追加 `promptVersion`；三段 system content 数组首元素追加 `'[prompt v1.0]'` |

> **demoRuntimeFacade 提醒**：该文件约 9800+ 行，属 AGENTS.md File Hygiene 标注的 P0 级技术债。本次仅做「常量声明 + options 追加 + system message 首元素追加」三处最小改动，**不新增能力、不重构、不拆分**，避免触发大文件拆分红线误判。

---

## 5. chatStream trace 接入专项设计

### 5.1 流式语义不变的具体保证

1. **yield 顺序不变**：`for await (const chunk of stream)` 循环体保持原样，`yield content` 仍在 `if (content)` 块内，顺序与时机完全一致。
2. **yield 时机不变**：不在 yield 前后插入任何 `await`、不插入任何同步阻塞逻辑。
3. **yield 内容不变**：`chunk.choices[0]?.delta?.content` 取值逻辑不变。
4. **token 计数不变**：保留现有 `completionTokens++`（按 chunk 计数）+ `promptTokens = messages.reduce((acc, m) => acc + Math.ceil(m.content.length / 4), 0)` 估算公式，`tokenUsage` 累加顺序与时机不变。
5. **提前 break 行为不变**：消费方 `for await ... break` 时，generator 的 `finally` 仍会执行并落 trace（success=true，因为从 generator 视角未抛错）；这与现有「break 后无 trace」相比是新增能力，不改 break 语义。

### 5.2 trace 落盘时机

| 时机 | success | error | 说明 |
| --- | --- | --- | --- |
| 流式正常结束（generator return） | `true` | `undefined` | `finally` 块落盘 |
| 流式抛错（SDK 异常 / 网络错误） | `false` | `normalizeError(e).message` | `catch` 设标志 + 重抛 + `finally` 落盘 |
| 客户端初始化失败（`!this.client`） | `false` | 错误消息 | `try` 首行抛出 → `catch` → `finally` 落盘 |
| 消费方提前 break | `true` | `undefined` | `finally` 落盘（generator 视角未抛错） |

### 5.3 实现骨架（参考 `chat()` 的 trace 模式）

```ts
async *chatStream(messages, options) {
  const traceLabel = options?.traceLabel ?? 'chat_stream'
  const promptVersion = options?.promptVersion
  const requestTimeout = options?.timeout ?? DEFAULT_REQUEST_TIMEOUT_MS
  const startedAt = Date.now()
  const promptStats = this.buildPromptTraceStats(messages)
  let success = true
  let errorMessage: string | undefined

  try {
    if (!this.client) {
      throw new Error('LLM client not initialized. Please check your configuration.')
    }
    const stream = await this.client.chat.completions.create({ /* 不变 */ stream: true })
    let promptTokens = 0
    let completionTokens = 0
    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content
      if (content) { completionTokens++; yield content }
    }
    promptTokens = messages.reduce((acc, m) => acc + Math.ceil(m.content.length / 4), 0)
    this.tokenUsage.totalPromptTokens += promptTokens
    this.tokenUsage.totalCompletionTokens += completionTokens
    this.tokenUsage.totalTokens += promptTokens + completionTokens
    this.tokenUsage.requestCount++
  } catch (error) {
    success = false
    errorMessage = this.normalizeError(error).message
    throw error
  } finally {
    this.recordRequestTrace({
      label: traceLabel,
      attemptCount: 1,
      durationMs: Date.now() - startedAt,
      timeoutMs: requestTimeout,
      ...promptStats,
      success,
      error: errorMessage,
      startedAt: new Date(startedAt).toISOString(),
      promptVersion,
    })
  }
}
```

### 5.4 token 计数与现有手动计数的关系

- `chat()` 用 SDK 返回的 `usage`（真实 token 数）；`chatStream` 用手动估算（`length/4` + chunk 计数）。两者口径不同是既有设计，本次**不统一、不改公式**。
- trace 中 `chatStream` 的 `messageCount` / `promptCharCount` / `systemCharCount` / `userCharCount` 由 `buildPromptTraceStats` 提供，与 `chat()` 一致；token 累加仍走 `tokenUsage`，不进 trace（trace 不含 token 字段，对齐现有 `LLMRequestTrace` 结构）。

---

## 6. 回归 case 设计

### 6.1 命中已有 case

[llmClient.promptVersion.test.ts](file:///./src/services/__tests__/llmClient.promptVersion.test.ts) 已有 5 个 case，覆盖 `chat()` 的成功 / 失败 / 未传版本三种场景 + candidateJudge / intentInterpreter 透传。本次不改动这些 case，仅新增。

### 6.2 新增 case 建议

> 命名遵循 AGENTS.md：`<被测模块>.<场景>.test.ts`；已有同名测试文件的，在文件内新增 `describe` 块，避免文件膨胀。
> case 字段对齐 AGENTS.md Case First（id / userInput / expectedDecision / mustNotHappen / verification），trace 类单元 case 在 `it` 注释中声明 `id`，`verification` 即断言点。

| 序 | 测试文件 | case id | 覆盖目标 | 关键断言 |
| --- | --- | --- | --- | --- |
| 1 | [llmClient.chatStreamTrace.test.ts](file:///./src/services/__tests__/llmClient.chatStreamTrace.test.ts)（新增） | `c2-stream-trace-carries-prompt-version` | chatStream 透传 + 成功 trace | `getRecentRequestTraces()[0].promptVersion === 'v1.0'` 且 `success === true` |
| 2 | 同上 | `c2-stream-trace-on-error` | chatStream 失败 trace | mock SDK 抛错，trace `success === false` 且 `promptVersion` 仍存在 |
| 3 | 同上 | `c2-stream-yield-order-unchanged` | 流式语义不变 | mock 返回 `['a','b','c']`，消费方收到 `['a','b','c']` 顺序一致 |
| 4 | 扩展 [candidateSelectionService.test.ts](file:///./src/services/__tests__/candidateSelectionService.test.ts) | `c3-candidate-selection-passes-version` | candidateSelectionService L71/L128 透传 | mock `chat`，断言 options 含 `promptVersion: 'v1.0'` + `traceLabel` |
| 5 | [systemPrompts.promptVersion.test.ts](file:///./src/services/__tests__/systemPrompts.promptVersion.test.ts)（新增） | `c4-system-prompts-version-exported` | 5 个常量 + 版本号导出 | 断言 5 个 `*_PROMPT_VERSION` 常量均为 `'v1.0'` 且 prompt 文本含 `[prompt v1.0]` |
| 6 | [promptBuilder.promptVersion.test.ts](file:///./src/services/__tests__/promptBuilder.promptVersion.test.ts)（新增） | `c5-prompt-builder-version-annotated` | 7 个 build 方法文本标注 | 断言每个 build 返回的 system message 含 `[prompt v1.0]` |
| 7 | 扩展 [layoutDraftService.test.ts](file:///./src/services/__tests__/layoutDraftService.test.ts) | `c6-layout-draft-passes-version` | L610/L640 透传 | mock `chat`，断言两次调用 options 含 `promptVersion: 'v1.0'` |
| 8 | [agentPlanner.promptVersion.test.ts](file:///./src/services/__tests__/agentPlanner.promptVersion.test.ts)（新增） | `c7-agent-planner-passes-version` | L357 透传 | mock `chat`，断言 options 含 `promptVersion` |
| 9 | [layoutAnalysisService.promptVersion.test.ts](file:///./src/services/__tests__/layoutAnalysisService.promptVersion.test.ts)（新增） | `c8-layout-analysis-passes-version` | L534 透传 + traceLabel | mock `chat`，断言 options 含 `promptVersion` + `traceLabel: 'layout_analysis'` |
| 10 | 扩展 [intentRecognizer.test.ts](file:///./src/services/__tests__/intentRecognizer.test.ts) | `c9-intent-recognizer-passes-version` | L23 透传 | mock `chat`，断言 options 含 `promptVersion: 'v1.0'` |
| 11 | 扩展 [paramExtractor.test.ts](file:///./src/services/__tests__/paramExtractor.test.ts) | `c10-param-extractor-passes-version` | 4 处透传 | 4 次 mock 调用断言 options 均含 `promptVersion` |
| 12 | 扩展 [candidateSelectionService.test.ts](file:///./src/services/__tests__/candidateSelectionService.test.ts) | `c11-candidate-selection-trace-label` | L71/L128 traceLabel + version | mock `chat`，断言 options 含 `traceLabel` + `promptVersion` |
| 13 | 扩展 [orchestrator.test.ts](file:///./src/services/__tests__/orchestrator.test.ts) | `c12-orchestrator-planning-passes-version` | L436 透传 | mock `chat`，断言 options 含 `promptVersion` + `traceLabel` |
| 14 | [layoutIntentRecognizer.promptVersion.test.ts](file:///./src/services/__tests__/layoutIntentRecognizer.promptVersion.test.ts)（新增） | `c13-layout-intent-passes-version` | L66 透传 | mock `chat`，断言 options 含 `promptVersion` |
| 15 | [scheduleTargetResolver.promptVersion.test.ts](file:///./src/services/__tests__/scheduleTargetResolver.promptVersion.test.ts)（新增） | `c14-schedule-target-resolver-passes-version` | L126 透传 + traceLabel | mock `chat`，断言 options 含 `traceLabel` + `promptVersion` |
| 16 | [repairManager.promptVersion.test.ts](file:///./src/services/__tests__/repairManager.promptVersion.test.ts)（新增） | `c15-repair-manager-passes-version` | L178 透传 + traceLabel | mock `chat`，断言 options 含 `traceLabel: 'repair_strategy'` + `promptVersion` |
| 17 | [explainInterfaces.promptVersion.test.ts](file:///./src/services/__tests__/explainInterfaces.promptVersion.test.ts)（新增） | `c16-explain-interfaces-passes-version` | L42 透传 + traceLabel | mock `chat`，断言 options 含 `traceLabel` + `promptVersion` |
| 18 | 扩展 [demoRuntimeFacade.atomicFallback.test.ts](file:///./src/services/__tests__/demoRuntimeFacade.atomicFallback.test.ts) 或新增 `demoRuntimeFacade.promptVersion.test.ts` | `c17-demo-runtime-3-sites-pass-version` | L1600/L3276/L3457 透传 | mock `chat`，断言三处调用 options 均含 `promptVersion` |

### 6.3 case 字段完整度示例（trace 类 case）

```ts
/**
 * case c2-stream-trace-carries-prompt-version
 * - userInput: （无用户输入，单元测试 mock）
 * - expectedDecision: chatStream 成功后 trace 携带 promptVersion='v1.0' 且 success=true
 * - mustNotHappen: trace.promptVersion 为 undefined；yield 顺序被打乱
 * - verification: getRecentRequestTraces()[0].promptVersion === 'v1.0'
 */
```

> 说明：编排员需求覆盖矩阵 case 的 5 字段硬约束适用于 `editorDemandCoverageCases.ts`；trace 类单元 case 遵循既有 `llmClient.promptVersion.test.ts` 的 `it` 注释风格，在注释中补齐 `expectedDecision` / `mustNotHappen` / `verification` 三要素即可。

---

## 7. 门禁纳入

### 7.1 新增测试文件加入 `agent:check:tests`

实现阶段需将以下新增测试文件追加到 [package.json](file:///./package.json) 的 `agent:check:tests` 列表（已核实当前列表含 `llmClient.promptVersion.test.ts`，新文件紧跟其后追加）：

- `src/services/__tests__/llmClient.chatStreamTrace.test.ts`
- `src/services/__tests__/systemPrompts.promptVersion.test.ts`
- `src/services/__tests__/promptBuilder.promptVersion.test.ts`
- `src/services/__tests__/agentPlanner.promptVersion.test.ts`
- `src/services/__tests__/layoutAnalysisService.promptVersion.test.ts`
- `src/services/__tests__/layoutIntentRecognizer.promptVersion.test.ts`
- `src/services/__tests__/scheduleTargetResolver.promptVersion.test.ts`
- `src/services/__tests__/repairManager.promptVersion.test.ts`
- `src/services/__tests__/explainInterfaces.promptVersion.test.ts`
- `src/services/__tests__/demoRuntimeFacade.promptVersion.test.ts`（若新增独立文件）

> 扩展已有测试文件（intentRecognizer / paramExtractor / candidateSelectionService / orchestrator / layoutDraftService）无需追加门禁，已在列表内。
>
> 实现说明：方案原计划的 `orchestrationPromptBuilder.promptVersion.test.ts` 与 `layoutDraftService.promptVersion.test.ts` 未创建独立文件，其回归断言分别落入 `candidateSelectionService.test.ts`（c3）与 `layoutDraftService.test.ts`（c6）。`orchestrationPromptBuilder.test.ts` 本身含 `[prompt v1.0]` 文本标注断言，已一并追加到 `agent:check:tests`。

### 7.2 验证命令

```bash
npm run agent:check      # 含 agent:check:tests + build
npm run build            # vue-tsc type-check + vite build
```

### 7.3 文档同步门禁

本次属基础设施补齐，不涉及 AGENTS.md 行为约束变化，但 `docs/code-wiki.md` 模块索引若登记了 prompt 版本管理章节需同步。实现完成后自检：AGENTS.md「Prompt 版本管理」章节描述与代码一致（已一致，无需改动）。

---

## 8. 风险与缓解

| 风险 | 等级 | 缓解措施 |
| --- | --- | --- |
| 误改 prompt 文本内容 | 高 | 仅在 system message **首部**追加 `[prompt vX.Y] ` 前缀，不触碰正文；由 code-review-expert 检查 diff 是否仅含前缀追加 + 常量声明 + options 字段追加 |
| 调用方传错版本号 | 中 | 调用方必须 `import` 导出的常量引用，禁止字面量；测试断言 `promptVersion` 等于常量值 |
| chatStream 改变流式语义 | 高 | `c2-stream-yield-order-unchanged` case 验证 yield 顺序；try/catch/finally 仅包裹，不改 yield 逻辑；code-review 检查 diff 是否仅新增 trace 逻辑 |
| 多文件批量改动回归 | 中 | `npm run agent:check` 全量验证；每接入一个文件立即新增对应 case 并跑通 |
| demoRuntimeFacade 大文件改动越界 | 中 | 仅 3 处 options 追加 + 3 段 system message 首元素追加，不重构、不新增能力 |
| `systemPrompts.ts` 5 常量的消费点遗漏 | 中 | 实现阶段用 Grep 检索 5 个常量标识符，逐点透传；测试覆盖导出常量 + 文本标注 |
| `buildExplanationPrompt` 有两分支（candidate_selection / validation_issue） | 低 | 两分支 systemPrompt 均追加 `[prompt v1.0]` 前缀 |

---

## 9. 不涉及

- **不涉及 timeout / signal / AbortController**：属 P0-C（AgentDeadline 统一管理）范围，本次不改任何 timeout 值。
- **不涉及长流程 budget**：不改 `maxTurns` / `batchSize` / 整体 deadline。
- **不涉及 UI 停止按钮 5s 阈值**：不改 `canInterrupt` 信号。
- **不涉及业务逻辑变化**：不改意图识别、候选选择、顺播判断、写入校验、失败暴露逻辑。
- **不引入子 agent / 自动回滚 / mutation journal**：对齐 AGENTS.md Design Philosophy。
- **不修订任何 prompt 文本**：仅追加版本号前缀，不改正文一字一句；因此不触发已接入基准（candidateJudge v1.2 / intentInterpreter v2.0）升版。
- **不统一 chatStream 与 chat 的 token 计数口径**：保留现有手动估算公式。

---

## 10. 验收标准

| 编号 | 验收项 | 验证方式 |
| --- | --- | --- |
| AC1 | 13 处未接入文件全部声明 `<DOMAIN>_PROMPT_VERSION` 常量 | code-review + Grep `PROMPT_VERSION` 命中数 |
| AC2 | 所有 `llmClient.chat` / `chatStream` 调用点透传 `promptVersion` | Grep `llmClient.chat(` 调用点逐个核对 options |
| AC3 | trace 中能观察所有 LLM 调用的 `promptVersion`（含 chatStream） | 新增 case 断言 `getRecentRequestTraces()` |
| AC4 | chatStream 接入 trace 落盘，流式语义不变 | `c2-stream-*` 3 个 case 通过 |
| AC5 | `npm run agent:check` 全绿 | CI 门禁 |
| AC6 | `npm run build` 成功（vue-tsc type-check + vite build） | 构建门禁 |
| AC7 | 业务逻辑零变化：无 prompt 正文改动、无调用流程改动、无行为变化 | code-review diff 检查 |
| AC8 | 新增测试文件全部纳入 `agent:check:tests` | package.json 核对 |

---

## 11. 实施顺序建议

1. **Step 1（Tier 1-1）**：先做 chatStream trace 接入 + 新增 3 个 chatStream case，跑通 `npm run agent:check`。这是后续所有流式调用方透传的前置依赖。
2. **Step 2（Tier 1-2）**：orchestrationPromptBuilder 导出常量 + candidateSelectionService 透传 + case。
3. **Step 3（Tier 2）**：systemPrompts / promptBuilder / layoutDraftService 三个重灾区，逐文件接入 + case。
4. **Step 4（Tier 3）**：11 个单/多 prompt 文件批量接入，按 6→7→8→9→10→11→12→13→14→15→16 顺序，每个文件接入后立即跑对应 case。
5. **Step 5**：追加所有新增测试文件到 `agent:check:tests`，跑 `npm run agent:check` + `npm run build` 全量验证。
6. **Step 6**：code-review-expert 检查 diff，确认仅含「常量声明 + 文本前缀追加 + options 字段追加 + 测试新增」，无业务逻辑改动。

---

## 12. 残余风险与未覆盖点

1. **`systemPrompts.ts` 5 常量的真实消费点**需在实现阶段用 Grep 精确定位；若某常量当前无消费点（死代码），本次仍补版本号常量 + 文本标注，但透传点视消费情况而定。
2. **chatStream 提前 break 时 trace 记 `success=true`**：从 generator 视角未抛错，但消费方可能因业务原因提前终止。这是可接受的近似，不掩盖真实失败（真实失败会抛错并记 `success=false`）。
3. **`demoRuntimeFacade.ts` 三段内联 prompt 的 traceLabel 已有但语义不同**（`agent_react_synthesize` / `playlist.optimization_suggestion` / `playlist.readonly_analysis` / `playlist.analysis_to_task_plan`），本次不合并 traceLabel，仅追加 `promptVersion`，保持审计粒度。
4. **本次不接入 `agentLlmContextPackage` 等 LLM 上下文打包层的版本号**：上下文包不是 system prompt，不在 Prompt 版本管理门禁范围。
