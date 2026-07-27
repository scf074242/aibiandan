# Prompt 优化技术方案：顺播规则统一 + 意图解释器 prompt 分组重组

> **方案类型**：Prompt 工程优化（LLM-first / LLM-only 主路径，不引入本地语义判断）
> **标杆模型**：dp4.0（能力较强，但长 prompt 下注意力衰减时易漏看靠后规则）
> **方案状态**：待用户确认
> **方案作者**：solution-architect agent

---

## 1. 目标

统一三处 prompt 中散落且口径不一致的「顺播期数选择规则」文案，并将意图解释器 system prompt 中扁平排列的 39 条规则按主题重组为 8 个带标题的区块前置硬约束，消除 dp4.0 在长 prompt 下漏看靠后硬约束导致的偶发结果不一致与顺播硬约束遗漏。

---

## 2. 范围

### 2.1 改动文件清单（仅 3 个源文件 + 相关测试）

| 文件 | 改动类型 | 说明 |
| --- | --- | --- |
| [candidateJudge.ts](file:///./src/services/agent/candidateJudge.ts) | 修改 | 顺播标准文案统一；版本号 `v1.1 → v1.2` |
| [orchestrationPromptBuilder.ts](file:///./src/services/orchestrationPromptBuilder.ts) | 修改 | 顺播标准文案引用；补 `promptVersion` 常量（初始 `v1.0`）；版本号在 system message 文本中标注 |
| [llmAgentIntentInterpreter.ts](file:///./src/services/agent/llmAgentIntentInterpreter.ts) | 修改 | P1-2 分组重组；第 172 行顺播旁注对齐标准文案；版本号 `v1.0 → v2.0` |

### 2.2 不动的部分（明确边界）

- **代码层顺播逻辑不动**：[tvSequenceCandidateSelector.ts](file:///./src/services/agent/tvSequenceCandidateSelector.ts)（证据提取 + 后置校验）、[constraintEngine.ts](file:///./src/services/agent/constraintEngine.ts)（顺序冲突校验）、[orchestrator.ts](file:///./src/services/orchestration/orchestrator.ts)（顺序冲突检测）、[schedulingAgentRuntime.ts](file:///./src/services/agent/schedulingAgentRuntime.ts)（safety gate description 结构化字段）、[atomicCommandCapability.ts](file:///./src/services/agent/atomicCommandCapability.ts)（runtime trace 字符串）均不在本次改动范围。
- **不改数据结构、不改接口签名**：除 [orchestrationPromptBuilder.ts](file:///./src/services/orchestrationPromptBuilder.ts) 新增一个 `promptVersion` 常量外，不新增任何字段、不改任何类型定义、不改函数签名。
- **不增加 LLM 调用次数**：所有改动是 prompt 文本层面的重组与文案统一，不新增 stage、不新增调用。
- **不引入本地语义判断**：顺播标准文案是 prompt 文本复用，不是本地代码逻辑；本地仍只做结构校验、写入校验、失败暴露。

---

## 3. Codex 对齐说明

本方案在 Codex 对齐审查阶段已确认：

- **P1-1 顺播规则统一**：Codex 是单 prompt 单规则系统，不存在多 prompt 规则不一致问题。本项目有多个 prompt 文件各自维护顺播规则（历史演进导致散落），统一表述是消除历史债，**不涉及 Codex 范式对齐**。
- **P1-2 prompt 分组前置**：Codex 的 system prompt 也按主题分段（Intro / Output Style / Tool Use / etc），分组前置是通用 prompt 工程实践，Codex 也这么做，**不涉及 Codex 特有范式**。

两项均属于本地 prompt 工程优化，可以做。

---

## 4. P1-1 详细设计：顺播规则统一

### 4.1 问题现状（三处差异点）

| 差异点 | candidateJudge（v1.1） | orchestrationPromptBuilder（无版本） | llmAgentIntentInterpreter（v1.0） |
| --- | --- | --- | --- |
| 顺播硬约束强度 | 列为「最高优先级硬规则」 | 仅作为「clarify 触发条件」 | 一句话旁注，无强度声明 |
| 「无基线选最早一期」规则 | 显式声明 | **未提及** | **未提及** |
| 「经验线索非绝对规则」 | 未提及 | 显式声明 | 未提及 |
| 版本管理 | 有 v1.1 | **无版本号（违反门禁）** | 有 v1.0 |

### 4.2 顺播标准文案（中文，三处复用的唯一基准）

以下文案作为唯一基准，三处 prompt 引用时保持核心点一致：

```
【顺播期数选择规则（电视播单候选决策最高优先级硬规则，优先于任何时长考量）】
- 有顺播基线时：必须选择期望下一集，不能跳集、倒序、重复。
- 无顺播基线时（今天和历史都没播过该系列）：如果用户给了明确节目名且候选有期数，必须选择最早一期（期数最小的）。
- 无顺播基线且候选无期数信息或同一期有多个版本：返回 needs_clarification 让用户选择。
- 经验线索（节目编号前缀、去掉集数后的节目名称、所属栏目相同）只是判断上下节目的辅助线索，不是绝对规则，必须综合标题、栏目、历史进度、当前节目单和播出风险判断。
- 时长是否适配目标时段不在候选决策层评估，由本地写入校验（FormalPlaylistWriteAdapter）最终把关。
```

**口径对齐说明**：

- 顺播硬规则针对**期数选择**（有基线 → 期望下一集；无基线 → 最早一期；多版本 → needs_clarification）。
- 经验线索针对**系列识别**（节目编号前缀、节目名、栏目相同只是辅助判断，不是绝对规则）。
- 两者层次不同，不冲突：硬规则决定选哪一期，经验线索决定如何识别同系列。统一后消除 candidateJudge「硬规则」与 orchestrationPromptBuilder「经验线索非绝对」之间的口径张力——两者并存，分别约束不同维度。

### 4.3 三处复用方式

#### 4.3.1 candidateJudge.ts（直接使用标准文案）

**位置**：[candidateJudge.ts](file:///./src/services/agent/candidateJudge.ts) 第 137-140 行 system prompt 数组。

**改动**：将现有第 137-140 行的顺播规则替换为标准文案的完整 5 条。现有文案已基本覆盖前 3 条（有基线 / 无基线选最早 / 多版本 needs_clarification），本次补齐第 4 条「经验线索非绝对规则」与第 5 条「时长不在候选层评估」行，并统一措辞为标准文案。

**版本号**：第 33 行 `CANDIDATE_JUDGE_PROMPT_VERSION = 'v1.1'` → `'v1.2'`（顺播文案统一，trace 中可观测版本升级）。

**证据文案**：第 171-187 行 `buildEvidenceLines` 不改动（该方法是动态拼接到 user 消息的顺播证据，不属于 LLM 可见的 system 规则文案，与标准文案职责不同，保持现状）。

#### 4.3.2 orchestrationPromptBuilder.ts（引用标准文案核心点 + 补 promptVersion）

**位置 1**：[orchestrationPromptBuilder.ts](file:///./src/services/orchestrationPromptBuilder.ts) 第 64 行 `buildGapCandidateSelectionPrompt` 的 system message。

改动：system message 末尾追加标准文案核心点引用——「顺播期数选择是候选决策最高优先级硬规则：有基线选期望下一集，无基线选最早一期，同一期多版本返回 clarify；不能跳集、倒序、重复」。

**位置 2**：第 78 行 `buildGapCandidateSelectionPrompt` 的 user content 上下文规则。

改动：现有文案「9 点已有第1集时，不应回填 8 点第2集；节目编号前缀、去掉集数后的节目名称、所属栏目相同只是判断上下节目的经验线索，不是绝对规则……」保留（与标准文案第 4 条口径一致），并在前面补一句「顺播硬规则：有基线选期望下一集，无基线选最早一期，不能跳集、倒序、重复」使硬规则与经验线索并列呈现。

**位置 3**：第 87 行 `formatStrategyGuide` 的 `sequence` 分支。

改动：现有文案「电视频道顺播优先读取历史和当前编排上下文，按同系列下一集/期选择，避免跳集、倒序和回填后续集」补「无基线时选最早一期」，对齐标准文案第 2 条。

**位置 4**：第 108 行 `buildInsertCandidateSelectionPrompt` 的 `insertDecisionRules`。

改动：现有文案「……候选接近但可能造成时间重叠、顺播倒序、跳集、重复集数或播出上下文风险时返回 clarify」保留，并在前面补「顺播期数选择是最高优先级硬规则：有基线选期望下一集，无基线选最早一期」。

**位置 5**：第 122 行 `buildInsertCandidateSelectionPrompt` 的 system message。

改动：现有文案「硬性节目名或上下文不匹配时返回 none，存在顺播风险时返回 clarify」保留，补「顺播硬规则优先于时长考量」核心点。

**补 promptVersion 常量**：文件顶部新增 `const ORCHESTRATION_PROMPT_BUILDER_VERSION = 'v1.0' as const`，并在三个 build 函数的 system message 首行标注 `[prompt v1.0]`（与 candidateJudge 的 `[prompt ${VERSION}]` 风格对齐）。

> **调用方透传说明**：[orchestrationPromptBuilder.ts](file:///./src/services/orchestrationPromptBuilder.ts) 的三个函数只返回 `ChatMessage[]`，不直接调用 LLM。trace 级 `promptVersion` 透传需调用方（如 orchestrator）在调用 `llmClient.chat({ promptVersion })` 时传入。**本次范围内只做常量声明 + system message 文本标注，不改调用方签名**（避免扩大改动面，符合「不新增字段、不改数据结构」约束）。调用方透传列为后续可选跟进项，不在本次范围。

#### 4.3.3 llmAgentIntentInterpreter.ts（第 172 行旁注对齐标准文案）

**位置**：[llmAgentIntentInterpreter.ts](file:///./src/services/agent/llmAgentIntentInterpreter.ts) 第 172 行末尾的旁注 `TV playlists should preserve column and sequence continuity; rotation playlists should prefer content match and rating.`

**改动**：该 prompt 主体为英文，为保持 prompt 语言一致性，将旁注替换为标准文案核心点的英文精简版，语义必须与中文标准文案对齐：

```
TV playlists must follow sequence continuity rules (highest priority hard rule): with a baseline, select the expected next episode (no skipping/reverse/repeat); without a baseline and the user named a programme with episodes, select the earliest episode; without a baseline and no episode info or multiple versions of the same episode, the candidate judge returns needs_clarification. Duration fit is not evaluated here. Rotation playlists prefer content match and rating.
```

> 该英文版是中文标准文案的语义等价翻译，确保三处口径一致。candidateJudge 与 orchestrationPromptBuilder 直接用中文标准文案；intentInterpreter 因 prompt 主体英文，用英文精简版，但语义对齐同一基准。

---

## 5. P1-2 详细设计：意图解释器 prompt 分组重组

### 5.1 现状

- **文件**：[llmAgentIntentInterpreter.ts](file:///./src/services/agent/llmAgentIntentInterpreter.ts) `buildMessages` 方法第 141-192 行。
- **system prompt**：第 146-184 行，共 39 条规则，扁平排列于一个字符串数组中，无分组标题、无空行分隔。
- **当前版本**：第 51 行 `INTENT_INTERPRETER_PROMPT_VERSION = 'v1.0'`。
- **核心问题**：硬约束散落在第 18 / 27 / 33-34 / 39 条等位置，dp4.0 在长 prompt 下注意力衰减时易漏看靠后规则。

### 5.2 分组方案（8 区块）

按「硬约束最前 → 角色任务 → 位置语义 → 候选关键词 → 复合任务 → pending → 反馈话术 → 能力兜底」顺序重组。下表中「原条目编号」对应第 146-184 行逐行编号（1-39）。

#### 区块 A：硬约束区（最高优先级，8 条，最前）

标题行：`===== HARD CONSTRAINTS (highest priority, must satisfy first) =====`

| 原条目 | 内容摘要 | 归入原因 |
| --- | --- | --- |
| 19 | Return JSON only, without Markdown. | 输出格式契约 |
| 20 | intent must be one of: move, insert, replace, delete, batch_move, batch_delete, query, validate. | intent 枚举契约 |
| 21 | Return confidence as a number from 0 to 1. | confidence 范围契约 |
| 25 | slots may include: targetTime, newStartTime, rangeStart, rangeEnd, programHint, replacementHint, offsetSeconds, direction, candidateId, targetItemId, targetProgramName. | slots 字段契约 |
| 32 | For query intent, queryKind must be one of: schedule_summary, time_lookup, program_lookup, candidate_lookup. | queryKind 枚举契约 |
| 3 | Do not decide whether the command is safe, do not choose final programs, and do not modify the schedule. | 行为边界 |
| 18 | If a destination is occupied, do not infer auto-shift, auto-replace, or auto-reorder behavior. | auto-shift 禁止 |
| 39 | If uncertain, return {"confidence":0,"reasoning":"...","assistantFeedback":"..."} and do not invent executable slots. | confidence:0 失败处理 |

#### 区块 B：角色与任务定义区（3 条）

标题行：`===== ROLE & TASK =====`

| 原条目 | 内容摘要 |
| --- | --- |
| 1 | You are the intent interpreter for a broadcast scheduling agent that supports both TV playlists and rotation playlists. |
| 2 | Convert currentTurn.userInput plus any pendingLlmContext.pendingContext into JSON. |
| 4 | Use evidencePackage as compact evidence for current schedule, candidate library, readiness, history, constraints, and policy. |

#### 区块 C：位置语义区（12 条）

标题行：`===== POSITION SEMANTICS (TV grid vs rotation queue) =====`

| 原条目 | 内容摘要 |
| --- | --- |
| 5 | Read evidencePackage.playlistSemantics before interpreting positions. |
| 6 | For rotation playlists, do not invent channel/date broadcast windows. |
| 7 | For rotation playlists, if currentSchedule is empty, treat queue start as natural target. |
| 8 | For rotation playlists, currentSchedule items are queue blocks; "在X后" sets targetTime to that item endTime. |
| 9 | For rotation playlists, "1点的X向后移动1小时" means relative +1 hour, prefer targetProgramName. |
| 10 | evidencePackage.layoutDraftAnchors may list the active TV layout draft slots. |
| 11 | TV anchor example: 东方快报 06:00-07:00 case. |
| 12 | When you use a layoutDraftAnchor, assistantFeedback must briefly explain the basis. |
| 28 | Use HH:mm:ss for times. Use seconds for offsetSeconds. direction must be forward or backward. |
| 29 | move example: "把《看东方》移到10点". |
| 30 | delete example: "删除看东方". |
| 31 | replace example: "把09:00的节目换成东方新闻". |

#### 区块 D：候选关键词区（1 条，独立成区）

标题行：`===== CANDIDATE KEYWORD STRATEGIES =====`

| 原条目 | 内容摘要 |
| --- | --- |
| 27 | For insert, replace, and candidate_lookup turns, you MUST return keywordStrategies as 2-6 groups (original + 1 other). 含策略标签定义（typo_fix / decompose / paraphrase / column_demote / broaden）。 |

> 该条最长且自成一个完整规则域（硬约束 + 策略标签定义 + 顺播旁注），独立成区避免与硬约束区混杂。原条目 27 末尾的顺播旁注按 P1-1 §4.3.3 替换为标准文案英文对齐版。

#### 区块 E：复合任务区（3 条）

标题行：`===== COMPOSITE TASK PLAN =====`

| 原条目 | 内容摘要 |
| --- | --- |
| 16 | If the user request contains multiple ordered tasks, return taskPlanDraft with isComposite=true. |
| 26 | taskPlanDraft.stages may include type atomic, batch_atomic, draft_refill, verify, ask_user. |
| 13 | For full or overall scheduling requests, do not downgrade the user to atomic commands. |

#### 区块 F：pending 区（4 条）

标题行：`===== PENDING TASK CONTINUATION =====`

| 原条目 | 内容摘要 |
| --- | --- |
| 14 | Use pendingEvidenceSummary as compact evidence for the previous pending task. |
| 22 | When pendingTask is present, set pendingAction only for explicit start_new_task, cancel_pending, select_candidate, confirm, reject. |
| 23 | If pendingTask is an insert and the user replies "就在已插入的X节目后", return normal insert with targetTime = matched X endTime. |
| 24 | For pending slot corrections, words like 换成、改成、改到 are action words, not programme names. |

#### 区块 G：反馈话术区（6 条，末尾集中）

标题行：`===== ASSISTANT FEEDBACK STYLE =====`

| 原条目 | 内容摘要 |
| --- | --- |
| 33 | Also return assistantFeedback: one short Chinese sentence addressed to the scheduling editor. |
| 34 | assistantFeedback is the main text the editor sees. Do not mention candidate source, structured intent, confidence, etc. |
| 35 | When the command must be blocked, assistantFeedback must include three parts: why / what is missing / what to say next. |
| 36 | For destructive commands, use warm confirmation-oriented sentence. |
| 37 | assistantFeedback examples (3 examples). |
| 38 | You may return streamingHint as "thinking" or "final". |

#### 区块 H：能力范围声明区（2 条，末尾兜底）

标题行：`===== CAPABILITY SCOPE (fallback) =====`

| 原条目 | 内容摘要 |
| --- | --- |
| 15 | Scheduling Agent Core v1.1 only covers atomic playlist commands: move, insert, replace, delete, batch_move, batch_delete, query, validate. |
| 17 | Do not turn layout drafts, full-day auto scheduling, or multi-user collaboration requests into executable atomic writes. |

### 5.3 重组统计

| 区块 | 条目数 | 原条目编号 |
| --- | --- | --- |
| A 硬约束区 | 8 | 19, 20, 21, 25, 32, 3, 18, 39 |
| B 角色与任务定义区 | 3 | 1, 2, 4 |
| C 位置语义区 | 12 | 5, 6, 7, 8, 9, 10, 11, 12, 28, 29, 30, 31 |
| D 候选关键词区 | 1 | 27 |
| E 复合任务区 | 3 | 16, 26, 13 |
| F pending 区 | 4 | 14, 22, 23, 24 |
| G 反馈话术区 | 6 | 33, 34, 35, 36, 37, 38 |
| H 能力范围声明区 | 2 | 15, 17 |
| **合计** | **39** | **1-39 全覆盖，无遗漏** |

### 5.4 区块标题格式

- 标题作为字符串数组中的一个独立元素（与现有规则同层），前后各加一个空字符串元素形成空行分隔，例如：

```ts
'',
'===== HARD CONSTRAINTS (highest priority, must satisfy first) =====',
'19. Return JSON only, without Markdown.',
'20. intent must be one of: move, insert, replace, delete, batch_move, batch_delete, query, validate.',
// ...
'',
'===== ROLE & TASK =====',
'1. You are the intent interpreter ...',
'',
```

- 标题语言：因 prompt 主体为英文，标题用英文保持一致性（调研建议的中文 `=== 硬约束区 ===` 风格可选，但混语言不优雅，本方案推荐英文标题）。
- 规则条目前加序号前缀（`19.` / `20.` …）便于 trace 中定位，序号沿用原行号便于回归对照。

### 5.5 规则条目内容改动原则

- **只改顺序和分组标题，不改规则条目内容**（除非必要合并）。
- 唯一的内容改动是条目 27 末尾的顺播旁注（按 P1-1 §4.3.3 替换为标准文案英文对齐版）。
- 不删除任何条目、不新增任何条目（保持 39 条不变，便于回归对照）。

### 5.6 版本号升级

[llmAgentIntentInterpreter.ts](file:///./src/services/agent/llmAgentIntentInterpreter.ts) 第 51 行：`INTENT_INTERPRETER_PROMPT_VERSION = 'v1.0' as const` → `'v2.0' as const`。

**跨大版本理由**：prompt 结构变化大（扁平 → 8 区块分组），trace 中需明确区分 v1.0 与 v2.0 的输出习惯差异，便于回归归因。

---

## 6. 验证方式

### 6.1 命中 / 新增的 case

| 测试文件 | 验证点 | 是否新增 |
| --- | --- | --- |
| [schedulingAgentRuntime.candidateDecision.test.ts](file:///./src/services/__tests__/schedulingAgentRuntime.candidateDecision.test.ts) | candidateJudge 顺播标准文案统一后，候选决策（有基线 / 无基线选最早 / 多版本 clarify）行为不变 | 命中已有 case，不新增（行为不变） |
| [schedulingAgentRuntime.intentInterpreter.test.ts](file:///./src/services/__tests__/schedulingAgentRuntime.intentInterpreter.test.ts) | intentInterpreter prompt 重组后，intent / slots / keywordStrategies / assistantFeedback 解析结构不破坏 | 命中已有 case，不新增（结构不变） |
| [orchestrationPromptBuilder.test.ts](file:///./src/services/__tests__/orchestrationPromptBuilder.test.ts) | 三个 build 函数产出的 system message 包含顺播核心点 + `[prompt v1.0]` 标注 | **建议新增 1 个断言**：断言 `buildGapCandidateSelectionPrompt` 与 `buildInsertCandidateSelectionPrompt` 的 system message 文本包含「顺播」与「最高优先级」关键词，且包含 `[prompt v1.0]` |
| [llmClient.promptVersion.test.ts](file:///./src/services/__tests__/llmClient.promptVersion.test.ts) | candidateJudge 传 `v1.2`、intentInterpreter 传 `v2.0` | **更新已有断言**：`promptVersion === 'v1.1'` → `'v1.2'`；`promptVersion === 'v1.0'` → `'v2.0'` |

### 6.2 运行的测试命令

```bash
# 主门禁（含 candidateDecision / intentInterpreter 等相关测试）
npm run agent:check

# 单独跑 prompt builder 测试（若未在 agent:check:tests 中，需手动补跑）
npx vitest run src/services/__tests__/orchestrationPromptBuilder.test.ts

# 单独跑 promptVersion 传递断言
npx vitest run src/services/__tests__/llmClient.promptVersion.test.ts
```

### 6.3 浏览器验证

- **本次为 prompt 改动**，建议真实 LLM 冒烟验证 dp4.0 在重组后 prompt 下的输出习惯。
- **但本地 mock 测试先验证结构不破坏**：先跑上述 vitest，确保解析结构、版本号传递、prompt 文本包含关键词均通过后，再进行真实 LLM 冒烟。
- 真实 LLM 冒烟建议用 `npm run agent:eval:llm` 跑 [schedulingAgentRuntime.realLlmEvaluation.test.ts](file:///./src/services/__tests__/schedulingAgentRuntime.realLlmEvaluation.test.ts)，观察 trace 中 promptVersion 是否为 `v1.2` / `v2.0`，以及候选决策是否仍遵守顺播硬规则。
- 浏览器回归门禁（goal37 / goal38）本次不强制，因不涉及前台可见交互变化（仅 prompt 文本与版本号变化）。

---

## 7. 风险评估

### 7.1 prompt 重组可能影响 dp4.0 已稳定输出习惯

- **风险**：intentInterpreter prompt 从扁平 39 条重组为 8 区块 + 标题，dp4.0 可能因 prompt 结构变化导致输出 JSON 结构或字段顺序微调。
- **缓解**：规则条目内容不变（仅顺序与标题变化），且区块标题是中性提示，不改变语义约束。先跑 [schedulingAgentRuntime.intentInterpreter.test.ts](file:///./src/services/__tests__/schedulingAgentRuntime.intentInterpreter.test.ts) 确认解析结构不破坏，再跑真实 LLM 冒烟观察输出习惯。
- **回退方案**：版本号 `v2.0` 便于在 trace 中区分；若真实 LLM 冒烟发现输出习惯显著退化，可回退 prompt 重组（保留 P1-1 顺播统一），版本号回退为 `v1.1`（仅顺播旁注对齐）。

### 7.2 顺播文案统一可能改变 orchestrationPromptBuilder 现有行为

- **风险**：[orchestrationPromptBuilder.ts](file:///./src/services/orchestrationPromptBuilder.ts) 现有 system message 仅把顺播作为 clarify 触发条件，统一后补「最高优先级硬规则」声明，可能使 dp4.0 在候选选择时更严格地返回 clarify / none。
- **缓解**：这正是本次优化的预期效果（消除硬约束遗漏）。需确认 [schedulingAgentRuntime.candidateDecision.test.ts](file:///./src/services/__tests__/schedulingAgentRuntime.candidateDecision.test.ts) 中已有 case 仍通过（行为不变的 case 应通过，新增严格性的 case 若有断言失败需评估是否为预期改善）。
- **口径一致性**：标准文案第 4 条「经验线索非绝对规则」与 orchestrationPromptBuilder 现有文案口径一致，不引入冲突。

### 7.3 回归测试覆盖建议

- **必跑**：`npm run agent:check`（覆盖 candidateDecision / intentInterpreter / 等门禁测试）。
- **建议跑**：`npm run agent:eval:llm`（真实 LLM 冒烟，观察 dp4.0 输出习惯）。
- **手动确认**：[orchestrationPromptBuilder.test.ts](file:///./src/services/__tests__/orchestrationPromptBuilder.test.ts) 中新增的顺播关键词断言通过。

### 7.4 残余风险

- 真实 LLM 冒烟的输出习惯变化无法被 mock 测试完全覆盖，需在真实 dp4.0 环境观察至少 5-10 轮候选决策与意图解释，确认无退化后再合并。
- [orchestrationPromptBuilder.ts](file:///./src/services/orchestrationPromptBuilder.ts) 的 `promptVersion` 透传到 LLM client trace 需调用方配合，本次只做文本标注，trace 中 orchestrationPromptBuilder 链路的 promptVersion 可能仍缺失（调用方未透传），属已知残余项，列为后续跟进。

---

## 8. 不在本次范围

明确列出以下不在本次范围的项，避免范围蔓延：

- **候选字段分层**：调研中曾提及的候选字段分层（hard / soft / context）已取消，不在本次范围。
- **keywordStrategies 按需生成**：当前 keywordStrategies 仍要求 insert / replace / candidate_lookup 全量返回 2-6 组，不在本次改为按需生成。
- **Planner 注入去重**：agentPlanner 的注入去重不在本次范围。
- **代码层顺播逻辑统一**：[tvSequenceCandidateSelector.ts](file:///./src/services/agent/tvSequenceCandidateSelector.ts) / [constraintEngine.ts](file:///./src/services/agent/constraintEngine.ts) / [orchestrator.ts](file:///./src/services/orchestration/orchestrator.ts) / [schedulingAgentRuntime.ts](file:///./src/services/agent/schedulingAgentRuntime.ts) / [atomicCommandCapability.ts](file:///./src/services/agent/atomicCommandCapability.ts) 的代码层逻辑不动。
- **调用方透传 orchestrationPromptBuilder 的 promptVersion**：本次只做常量声明 + system message 文本标注，不改调用方签名，trace 级透传列为后续可选跟进。
- **intentInterpreter prompt 语言切换**：不把英文 prompt 改为中文（仅区块标题与顺播旁注对齐，主体保持英文）。
- **candidateJudge buildEvidenceLines 改动**：第 171-187 行的顺播证据动态拼接文案不改（职责不同，不属于 system 规则文案）。
- **新增任何代码文件**：本次只改 3 个源文件 + 相关测试，不新建文件。

---

## 附录：版本号变更汇总

| 文件 | 常量 | 当前版本 | 目标版本 | 升级理由 |
| --- | --- | --- | --- | --- |
| [candidateJudge.ts](file:///./src/services/agent/candidateJudge.ts) | `CANDIDATE_JUDGE_PROMPT_VERSION` | `v1.1` | `v1.2` | 顺播标准文案统一（补经验线索 + 时长不在候选层评估两行） |
| [llmAgentIntentInterpreter.ts](file:///./src/services/agent/llmAgentIntentInterpreter.ts) | `INTENT_INTERPRETER_PROMPT_VERSION` | `v1.0` | `v2.0` | prompt 结构大改（扁平 → 8 区块分组），跨大版本 |
| [orchestrationPromptBuilder.ts](file:///./src/services/orchestrationPromptBuilder.ts) | `ORCHESTRATION_PROMPT_BUILDER_VERSION`（新增） | 无 | `v1.0` | 补 prompt 版本管理门禁（初始版本） |
