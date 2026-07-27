# 提示词澄清/拒绝/失败话术「一句话原则」修正方案

> 角色：solution-architect
> 状态：待用户确认
> 关联规范：`AGENTS.md`（LLM-first / LLM-only 主路径、本地只保护结果不替模型表达）
> 标杆模型：dp4.0（长 prompt 处理稳定，本次仅做"约束补丁"，不重写 prompt 结构）

---

## 1. 目标

在候选决策（candidateJudge）与意图解释器（llmAgentIntentInterpreter）的 system prompt 中补足"一句话原则"约束，使用户在「需要澄清」「无法决策」「意图理解失败」三类场景下，能直接从模型 reasoning / assistantFeedback 里读到"差什么、下一步说什么"，而不是面对一坨候选维度堆叠或统一兜底话术。本次只约束模型表达内容，不新增字段、不改数据结构、不增加 LLM 调用次数。

---

## 2. 范围

### 2.1 改动文件（仅 2 个）

| 文件 | 改动性质 | 涉及任务 |
| --- | --- | --- |
| `src\services\agent\candidateJudge.ts` | system prompt 文案补丁 | Q1、Q2 |
| `src\services\agent\llmAgentIntentInterpreter.ts` | system prompt 文案补丁 + 必要本地透传确认 | Q3 |

### 2.2 不动的部分

- **不新增字段、不改数据结构**：`AgentCandidateDecision`、`AgentIntentInterpretation` 结构保持不变（`AgentIntentInterpretation.intent` 本就是可选字段，见 `src\services\agent\types.ts` 第 62 行，无需调整类型）。
- **不改候选卡片渲染**：`ChatPanel.vue` 候选卡片继续展示 `name/meta/note/reasonTags`，Q1/Q2 仅约束 `reasoning` 内容，不动 `candidateOptions` 结构、不增减卡片文字量。
- **不增加 LLM 调用次数**：candidateJudge、intentInterpreter 各自维持单次调用，不引入新的 LLM 阶段。
- **不改 `normalizeAssistantFeedback` 的语义**：仅做现有技术词过滤（`ASSISTANT_FEEDBACK_TECHNICAL_PATTERN`）与 180 字截断，不新增分类判断分支。
- **不改 `normalizeDecision`**：candidateJudge 的结构校验、`candidateId` 有效性校验、`unable_to_decide` 兜底逻辑全部保留。
- **不动 `agentPlanner.ts` 第 542/567 行硬编码话术**：该处是 `parsePlan` 在「JSON 解析失败 / 无 match」时的结构兜底，属于 C8 暴露失败的本地保护，模型未返回有效结构时本地无法替模型生成分类引导（详见第 6 节风险 R3）。

---

## 3. Codex 对齐说明

本方案与 Codex（Claude Code 类 agent）的"暴露失败 + 简洁追问"范式保持一致：

- **暴露失败而非伪装理解**：needs_clarification / unable_to_decide / confidence:0 都是"模型明确表示无法继续"，本地不兜底、不补意图、不静默通过门禁。本次只让模型的"失败说明"本身更可读，不改失败语义。
- **一句话追问**：Codex 在缺信息时会用一句话点出"差什么、用户该补什么"，而不是堆维度。Q1（为什么需要澄清）、Q2（最接近的候选是哪个）、Q3（缺时间/缺节目/意图模糊）都遵循这一范式。
- **本地只保护、不表达**：`normalizeAssistantFeedback` 的技术词过滤和长度截断是"保护结果不被技术词污染"；`normalizeDecision` 的结构校验是"保护写入"。它们都不替模型理解或改写意图，符合 AGENTS.md「代码如果是在理解用户，就是错误方向」的判断标准。
- **不在模型前后改写开放意图**：本次只做"模型返回前加约束、模型返回后做结构校验"，不在中间加关键词分类、续接、补意图。

---

## 4. 详细改动

### 4.1 Q1：candidateJudge needs_clarification 一句话说清为什么需要澄清

**问题位置**：`src\services\agent\candidateJudge.ts` 第 210-218 行，`normalizeDecision` 在 `needs_clarification` 分支把全部 `candidates` 作为 `candidateOptions` 透传给前端，但 `reasoning` 内容无约束；前端候选卡片（`ChatPanel.vue` 第 234/268/309 行 `.pending-command-reasoning`）已展示多行 name/meta/note/reasonTags，用户面对多个同名候选不知道差在哪。

**改动位置**：`candidateJudge.ts` `buildMessages` 方法的 system prompt（第 109-144 行）。

**改动前 prompt 关键片段**（第 124-127 行 + 第 143 行）：

```
'你需要自判决策类型 decisionType：',
'- auto_select：候选不多（通常 <= 5 个）且能选出唯一靠谱的候选',
'- needs_clarification：候选很多难以给出有理有据回答，或同一期有多个版本需要用户选择',
'- unable_to_decide：无法决策（候选都不合适或信息不足）',
...
'reasoning 必须说明为什么选这个候选，或为什么需要用户澄清。',
```

**改动后 prompt 关键片段**（在 needs_clarification 条目追加一句话约束，并在 reasoning 行补约束）：

```
'- needs_clarification：候选很多难以给出有理有据回答，或同一期有多个版本需要用户选择。此时 reasoning 必须用一句话说清为什么需要用户澄清（例："库里有两个版本的《琅琊榜》第5集，请确认要哪个"），不要逐个候选罗列维度差异，不要复述候选字段。',
```

```
'reasoning 必须说明为什么选这个候选，或为什么需要用户澄清。needs_clarification 时 reasoning 只用一句话点出"差在哪个关键维度/哪个候选分叉点"，让编排人员知道下一步该补什么。',
```

**本地逻辑是否需要调整**：不需要。`normalizeDecision` 的 `needs_clarification` 分支（第 210-218 行）保持原样：透传 `candidateOptions`、透传 `reasoning`。本次只约束 `reasoning` 文本内容，不做本地过滤或分类。

---

### 4.2 Q2：candidateJudge unable_to_decide 末尾一句话点出最接近候选

**问题位置**：`candidateJudge.ts` 第 201-208 行，`unable_to_decide` 分支只返回 `reasoning`，用户被拒绝后无引导；编排场景不像 coding 可以自己搜，需要模型点出"最接近的候选是什么"。

**改动位置**：同 Q1，`buildMessages` 方法的 system prompt。

**改动前 prompt 关键片段**（第 127 行 + 第 143 行）：

```
'- unable_to_decide：无法决策（候选都不合适或信息不足）',
...
'reasoning 必须说明为什么选这个候选，或为什么需要用户澄清。',
```

**改动后 prompt 关键片段**（在 unable_to_decide 条目追加约束，并在 reasoning 行补约束）：

```
'- unable_to_decide：无法决策（候选都不合适或信息不足）。此时 reasoning 末尾必须用一句话点出"最接近的候选是什么、差在哪"（例："库里没有《琅琊榜》，但有《琅琊榜之风起长林》是否考虑？"），给编排人员一个可继续的入口。如果候选列表中确实没有任何相近节目，不强制加，保持简洁即可。',
```

```
'reasoning 必须说明为什么选这个候选，或为什么需要用户澄清。unable_to_decide 时 reasoning 末尾用一句话点出最接近的候选（无相近候选时可不加），不要堆候选列表。',
```

**本地逻辑是否需要调整**：不需要。`normalizeDecision` 的 `unable_to_decide` 分支（第 201-208 行）保持原样。注意：`unable_to_decide` 不透传 `candidateOptions`（这是当前结构语义，本次不动），模型只在 `reasoning` 文本里点出最接近候选名，不通过 `candidateOptions` 字段下发。

> Q1+Q2 合并落地：两处约束都加在同一个 system prompt 数组里，一次性补丁，避免重复改 prompt。

---

### 4.3 Q3：意图解释器失败话术按缺什么分类一句话引导

**问题位置**：
- `src\services\agent\llmAgentIntentInterpreter.ts` 第 148 行：`'If uncertain, return {"confidence":0,"reasoning":"..."} and do not invent executable slots.'` 只要求返回 `reasoning`（给系统看的），不要求返回 `assistantFeedback`（给用户看的）。
- `src\services\llm\agentPlanner.ts` 第 542/567 行 `parsePlan` 解析失败兜底硬编码 `'我还没能把这句话整理成可执行步骤，请换一种说法。'`。
- 用户最终看到统一话术，不知道自己缺的是时间、节目还是意图本身。

**改动位置**：`llmAgentIntentInterpreter.ts` `buildMessages` 方法的 system prompt 末尾（第 148 行）。

**改动前 prompt 关键片段**（第 148 行）：

```
'If uncertain, return {"confidence":0,"reasoning":"..."} and do not invent executable slots.',
```

**改动后 prompt 关键片段**（替换第 148 行，要求返回 assistantFeedback 并按缺什么分类）：

```
'If uncertain, return {"confidence":0,"reasoning":"...","assistantFeedback":"一句话中文引导"} and do not invent executable slots. assistantFeedback must classify what is missing in one short Chinese sentence and tell the editor what to say next: missing time -> "你想插到几点？"; missing program -> "你想插哪个节目？"; ambiguous intent -> "你是想插入还是替换？"; other -> "我没能理解，请换一种说法。". Do not list internal fields or policy ids. Keep within the 180-char assistantFeedback limit.',
```

**本地逻辑是否需要调整**：

`normalizeAssistantFeedback`（第 281-289 行）**不改**：仅做现有技术词过滤（`ASSISTANT_FEEDBACK_TECHNICAL_PATTERN`）、过早完成声明过滤（`hasPrematureCompletionClaim`）、180 字截断。不新增分类分支、不做"缺时间/缺节目"的本地关键词判断（避免本地替模型理解）。

> **关键风险（必须在实现阶段确认，见第 6 节 R1）**：当前 `normalizeInterpretation`（第 72-75 行）在 `confidence < MIN_STRUCTURED_CONFIDENCE(0.5)` 时直接 `return null`，会丢弃 LLM 返回的 `assistantFeedback`；且 `schedulingAgentRuntime.ts` 第 386 行 `if (!interpretation?.intent) return input` 也会在 `intent` 为空时截断透传。若只改 prompt 不通此链路，`assistantFeedback` 到不了用户，Q3 无效。建议最小透传改动见第 6 节 R1 处理建议。

---

## 5. 验证方式

### 5.1 命中 / 新增 case

| 任务 | 测试文件 | case 说明 |
| --- | --- | --- |
| Q1 | `src\services\__tests__\schedulingAgentRuntime.candidateDecision.test.ts` | **命中已有 Case C**（第 396-429 行）：`LLM 返回 needs_clarification → needs_selection`，已透传 `candidateOptions`。**建议新增最小回归 case**：mock LLM 返回 `needs_clarification` 时 `reasoning` 为一句话（如"库里有两个版本的《琅琊榜》第5集，请确认要哪个"），断言 `decision.reasoning` 不为空且未逐个罗列候选字段。 |
| Q2 | `src\services\__tests__\schedulingAgentRuntime.candidateDecision.test.ts` | **命中已有 Case F**（第 138-158 行 + 第 434-461 行）：LLM 失败/超时 → `unable_to_decide`。**建议新增最小回归 case**：mock LLM 返回 `unable_to_decide` 且 `reasoning` 末尾带最接近候选名（如"库里没有《琅琊榜》，但有《琅琊榜之风起长林》是否考虑？"），断言 `reasoning` 包含候选名引导。 |
| Q3 | `src\services\__tests__\schedulingAgentRuntime.intentInterpreter.test.ts` | **命中已有 case**（第 2623 行 `returns null when LLM omits confidence field`、第 1569 行 `confidence: 0.2`）。**建议新增最小回归 case**：mock LLM 返回 `{"confidence":0,"reasoning":"...","assistantFeedback":"你想插到几点？"}`，断言 `assistantFeedback` 能透传到 interpretation（依赖 R1 透传链路确认）。 |

> 新增 case 纳入 `npm run agent:check` 下游 Vitest 入口，符合 AGENTS.md「Case First」要求。

### 5.2 运行命令

- 行为变化（Q1/Q2/Q3 prompt 改动）：`npm run agent:check`
- 单文件单测（快速回归）：
  - `npx vitest run src/services/__tests__/schedulingAgentRuntime.candidateDecision.test.ts`
  - `npx vitest run src/services/__tests__/schedulingAgentRuntime.intentInterpreter.test.ts`
- 构建检查：`npm run build`（本次为 prompt 文案补丁，构建预期无影响，按 AGENTS.md「构建相关变化」门禁跑一次确认）

### 5.3 浏览器验证

**需要**。Q1/Q2 影响候选卡片 `reasoning` 展示（`ChatPanel.vue` 第 234/268/309 行 `.pending-command-reasoning`），Q3 影响失败话术展示。按 AGENTS.md「前台可见交互变化」门禁：

1. 刷新 `http://localhost:5173`。
2. 触发 needs_clarification 场景（如插入同名多版本节目），确认 reasoning 为一句话、卡片文字量未膨胀。
3. 触发 unable_to_decide 场景（如插入库里没有的节目名），确认 reasoning 末尾点出最接近候选。
4. 触发 confidence:0 场景（如只说"插个节目"不给时间不给节目名），确认用户看到分类引导话术（"你想插到几点？"等），而非统一兜底话术。

---

## 6. 风险评估

### R1：Q3 assistantFeedback 透传链路被截断（**高，必须在实现前确认**）

**风险**：`normalizeInterpretation`（`llmAgentIntentInterpreter.ts` 第 72-75 行）当前逻辑：

```
const requestedIntent = this.normalizeIntent(record.intent)
if (!requestedIntent) return null                  // confidence:0 时 LLM 不返回 intent，此处直接 return null
const confidence = this.normalizeConfidence(record.confidence, requestedIntent)
if (confidence < MIN_STRUCTURED_CONFIDENCE) return null   // confidence:0 再次 return null
```

LLM 按 Q3 改后 prompt 返回 `{"confidence":0,"assistantFeedback":"..."}`（不带 intent），会在第 73 行 `!requestedIntent` 处直接 `return null`，`assistantFeedback` 被丢弃。即使绕过此处，`schedulingAgentRuntime.ts` 第 386 行 `if (!interpretation?.intent) return input` 也会在 `intent` 为空时把结果丢弃，`assistantFeedback` 仍到不了用户。

**处理建议（最小透传，不改数据结构、不改 normalizeAssistantFeedback 语义）**：
- 在 `normalizeInterpretation` 中，当 `!requestedIntent` 或 `confidence < MIN_STRUCTURED_CONFIDENCE` 且 `record.assistantFeedback` 非空时，不直接 `return null`，而是返回一个 `intent=undefined`、`confidence=0`、`source:'llm'`、带 `assistantFeedback` 的"失败但带可读反馈"结构。`AgentIntentInterpretation.intent` 本就是可选字段（`types.ts` 第 62 行 `intent?: AtomicCommandIntent`），不需要改类型。
- 配合 `schedulingAgentRuntime.ts` 第 386-398 行：当 `interpretation` 非 null 但 `intent` 为空且 `assistantFeedback` 非空时，把 `assistantFeedback` 透传到 `RuntimeDecision`（构造一个 `needs_clarification` 消息），而非 `return input` 静默丢弃。
- 此改动属于"结构透传"，不是"本地替模型分类"——分类由 LLM 在 prompt 里完成，本地只把 LLM 的 `assistantFeedback` 原样传到结果，符合 LLM-only 原则。

**决策**：本方案只确认到"必须通此链路"，具体改 `normalizeInterpretation` 还是改 `schedulingAgentRuntime` 的失败分支，留给实现阶段由 code-review-expert 把关。若不通此链路，Q3 不应合入。

### R2：dp4.0 已稳定输出习惯被 prompt 补丁干扰（中）

**风险**：dp4.0 在现有 candidateJudge / intentInterpreter prompt 下输出已稳定，追加约束可能让模型在边界 case 下改变 `decisionType` 选择习惯（如原本 auto_select 的场景被误判为 needs_clarification）。

**缓解**：
- 本次只加"reasoning / assistantFeedback 内容约束"，不改 `decisionType` 判定阈值描述（`auto_select <= 5 个`等条件原样保留）。
- 回归覆盖 Case A-G（`schedulingAgentRuntime.candidateDecision.test.ts`），确认 `decisionType` 分布不变。
- 若 dp4.0 在补丁后出现 `needs_clarification` 召升高，可把约束文案从"必须"降为"应当"，但不回退约束本身。

### R3：agentPlanner 第 542/567 行硬编码话术仍在链路中（低，本次不动）

**风险**：`agentPlanner.ts` `parsePlan` 在 JSON 解析失败时硬编码"我还没能把这句话整理成可执行步骤，请换一种说法。"，`demoRuntimeFacade.ts` 第 735 行优先用 `plan.assistantReplyDraft` 兜底。若 agentPlanner 的 LLM 调用本身失败（非 intentInterpreter 路径），用户仍会看到统一话术。

**处理**：本次不动。理由：
- 该硬编码是"LLM 未返回有效 JSON 结构"的本地兜底，属于 C8 暴露失败，模型没返回内容时本地无法替模型生成分类引导。
- Q3 的主路径是 intentInterpreter（在 agentPlanner 之前），intentInterpreter 返回 `assistantFeedback` 后不会走到 agentPlanner 的 `parsePlan` 兜底。
- agentPlanner 自身的 system prompt 已在第 523-533 行约束 `assistantReplyDraft` 文案，其失败兜底属于"结构无效"而非"模型表达不清"，不在本次 prompt 优化范围。

### R4：候选卡片文字量膨胀（低，Q1/Q2 已规避）

**风险**：Q1/Q2 若误把候选维度写进 `reasoning`，会让卡片文字量膨胀。

**缓解**：Q1/Q2 prompt 明确"不要逐个候选罗列维度差异""不要堆候选列表"，且 `normalizeDecision` 不动 `candidateOptions` 结构。前端卡片渲染不变。

---

## 7. 不在本次范围

以下项明确留给后续，本次不做：

- **candidateJudge 候选字段分层**：当前 `candidateOptions` 透传全量候选字段（name/meta/note/reasonTags），后续可按"一句话差异点"分层展示，本次不改结构。
- **Planner 注入去重**：`agentPlanner.ts` system prompt 中重复注入的约束（如 assistantReplyDraft 文案、layoutDraftAnchor 示例）未做去重，本次不动。
- **keywordStrategies 按需生成**：`llmAgentIntentInterpreter.ts` 第 136 行要求 insert/replace/candidate_lookup 强制返回 keywordStrategies，后续可按"是否需要检索"按需生成，本次不动。
- **agentPlanner 第 542/567 行硬编码话术分类化**：见 R3，属于结构失败兜底，不在 prompt 优化范围。
- **candidateJudge / intentInterpreter prompt 结构重写**：本次只做"一句话约束补丁"，不重写 prompt 整体结构、不调整字段顺序。
- **本地分类判断**：`normalizeAssistantFeedback` / `normalizeDecision` 不新增任何"缺时间/缺节目/最接近候选"的本地关键词判断分支。
- **新增 LLM 调用阶段**：不引入"失败话术生成"二次 LLM 调用，失败话术由原 candidateJudge / intentInterpreter 单次调用在 reasoning / assistantFeedback 内一次性返回。

---

## 8. 落地检查清单（实现阶段对照）

- [ ] Q1：candidateJudge system prompt 在 needs_clarification 条目 + reasoning 行加一句话约束
- [ ] Q2：candidateJudge system prompt 在 unable_to_decide 条目 + reasoning 行加末尾一句话约束
- [ ] Q3：llmAgentIntentInterpreter system prompt 第 148 行替换为带 assistantFeedback 分类引导的约束
- [ ] Q3 链路（R1）：确认 `normalizeInterpretation` / `schedulingAgentRuntime` 第 386 行的 `assistantFeedback` 透传是否需要最小改动；不通则 Q3 不合入
- [ ] 新增回归 case：Q1 needs_clarification 一句话、Q2 unable_to_decide 末尾候选、Q3 confidence:0 assistantFeedback 透传
- [ ] `npm run agent:check` 通过
- [ ] `npm run build` 通过
- [ ] 浏览器验证：刷新 `http://localhost:5173`，跑 needs_clarification / unable_to_decide / confidence:0 三个场景
