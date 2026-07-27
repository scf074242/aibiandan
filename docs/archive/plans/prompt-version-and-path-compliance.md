# Prompt 版本管理 与 文档路径合规 修复方案

> 角色：solution-architect
> 状态：待用户确认
> 关联规范：`AGENTS.md`（Verification Gates / Naming Conventions / Documentation Discipline / File Hygiene）
> 关联硬约束：
> - C1 Prompt 版本管理（Verification Gates + Naming Conventions）
> - C2 文档路径合规（Documentation Discipline）

---

## 1. 目标

为新引入的两条 AGENTS.md 硬约束做最小化合规修复：让所有 system prompt 在 trace 中可观测到版本号，并清掉 docs 内全部失效绝对路径，使仓库一次性满足 Documentation Discipline 与 Prompt 版本管理的硬约束。

本次**不引入行为变化、不改 prompt 内容、不新增 LLM 调用次数**，只补元数据与修路径。

---

## 2. 范围

### 2.1 改动文件清单

| 类别 | 文件 | 改动性质 |
| --- | --- | --- |
| C1 类型 | [src/types/llm.ts](file:///./src/types/llm.ts) | `ChatOptions` / `LLMRequestTrace` 各新增可选字段 `promptVersion?: string` |
| C1 透传 | [src/services/llm/llmClient.ts](file:///./src/services/llm/llmClient.ts) | `chat` / `tryBrowserMockChat` / `recordRequestTrace` 透传 `promptVersion` |
| C1 调用方 | [src/services/agent/candidateJudge.ts](file:///./src/services/agent/candidateJudge.ts) | 声明 `CANDIDATE_JUDGE_PROMPT_VERSION = 'v1.0'`，调用时传 `promptVersion` |
| C1 调用方 | [src/services/agent/llmAgentIntentInterpreter.ts](file:///./src/services/agent/llmAgentIntentInterpreter.ts) | 声明 `INTENT_INTERPRETER_PROMPT_VERSION = 'v1.0'`，调用时传 `promptVersion` |
| C1 case | [src/services/__tests__/llmClient.test.ts](file:///./src/services/__tests__/llmClient.test.ts) 或新增 `llmClient.promptVersion.test.ts` | 新增 case 验证 trace 中能观察到 `promptVersion` |
| C2 活跃文档 | [docs/code-wiki.md](file:///./docs/code-wiki.md) | 173 处绝对路径 → 相对路径 |
| C2 归档文档 | `docs/archive/` 下 16 个文件 | 168 处绝对路径 → 相对路径 |

### 2.2 不动的部分

- **不改 prompt 文本内容**：版本号是元数据，不是 prompt 内容；`candidateJudge.ts` 的 system prompt 文案、`llmAgentIntentInterpreter.ts` 的 system prompt 文案全部保持上一轮 Q1/Q2/Q3 优化后的状态。
- **不新增 LLM 调用次数**：candidateJudge、intentInterpreter 各自维持单次调用。
- **不拆分 `.prompt.<version>.md` 外部文件**：现有 prompt 内嵌在 .ts 常量里的现状保持，避免大改动（详见第 7 节）。
- **不动其他 6 个 prompt 文件的版本管理**：`agentPlanner.ts` / `systemPrompts.ts` / `orchestrationPromptBuilder.ts` / `layoutAnalysisPromptBuilder.ts` / `promptBuilder.ts` / `layoutDraftService.ts` 等内嵌 prompt 暂不接入版本号，本次只覆盖 candidateJudge 与 intentInterpreter 两个上一轮刚改过的核心 prompt（详见第 7 节）。
- **不动 `traceLabel` 字符串值**：`'agent.candidate_judge'` / `'agent.intent_interpreter'` 保持原样，版本号走独立字段，不污染 label。
- **不改 `recordRequestTrace` 的 trace 数量上限**（仍保留最近 20 条）。
- **不改 `buildPromptTraceStats`** 的字符统计逻辑。

---

## 3. C1 详细设计：Prompt 版本管理

### 3.1 Codex 对齐说明

Codex（Claude Code 类 agent）在 prompt 治理上的范式是：**prompt 即代码 + 版本即元数据 + trace 即审计**。本方案对齐以下三点：

- **prompt 即代码**：prompt 内嵌在 .ts 常量里，受 git 管理，diff 天然可查，不强制外置 `.prompt.<version>.md`。
- **版本即元数据**：版本号是调用方声明的能力域元数据，不是 prompt 文本的一部分；版本号独立字段透传到 trace，不混入 label 字符串。
- **trace 即审计**：每次 LLM 调用都在 trace 里留下"用了哪个能力域的哪个版本"，便于回归归因。这符合 AGENTS.md「LLM 调用监控与成本核算」"禁止调用即丢无审计"的硬约束。

### 3.2 版本声明方式

在 .ts 文件里导出一个**模块级版本常量**，不拆外部 `.prompt.<version>.md` 文件。

示例（[src/services/agent/candidateJudge.ts](file:///./src/services/agent/candidateJudge.ts)）：

```ts
/**
 * candidate_judge 能力域 prompt 版本号
 * 修订时必须同步升版本号，并在 commit message 注明 vX.Y → vA.B
 */
const CANDIDATE_JUDGE_PROMPT_VERSION = 'v1.0' as const
```

示例（[src/services/agent/llmAgentIntentInterpreter.ts](file:///./src/services/agent/llmAgentIntentInterpreter.ts)）：

```ts
/**
 * intent_interpreter 能力域 prompt 版本号
 * 修订时必须同步升版本号，并在 commit message 注明 vX.Y → vA.B
 */
const INTENT_INTERPRETER_PROMPT_VERSION = 'v1.0' as const
```

调用处把版本号透传给 `llmClient.chat`：

```ts
const response = await this.options.llmClient.chat(this.buildMessages(input), {
  temperature: 0,
  maxTokens: 800,
  timeout: 30000,
  maxRetries: 1,
  traceLabel: 'agent.candidate_judge',
  promptVersion: CANDIDATE_JUDGE_PROMPT_VERSION,
})
```

### 3.3 trace 记录方式：方案评估与推荐

AGENTS.md 原文要求：**"trace 中必须记录使用的 prompt 文件名与版本号"**。

#### 方案 A：把版本号拼进 traceLabel 字符串

```ts
traceLabel: 'agent.candidate_judge@v1.0'
```

- **优点**：零结构改动，`ChatOptions` / `LLMRequestTrace` 类型不动，`llmClient.ts` 不动。
- **缺点**：
  1. **语义污染**：`traceLabel` 语义是"能力域标签"，混入版本号后字段语义不清。
  2. **聚合困难**：未来要按能力域聚合 trace 需要正则切分 label，按版本聚合又要另一套正则，可维护性差。
  3. **日志冗长**：`traceLabel` 还被用于 `console.warn` 等日志（`llmClient.ts` 第 167 行），带版本号让日志变冗长。
  4. **扩展性差**：AGENTS.md 还要求"trace 中必须记录使用的 prompt 文件名"，未来要加 `promptName` 时 label 会变成 `'agent.candidate_judge@candidateJudge.prompt.v1.0'`，可读性差。

#### 方案 B：在 chat options 新增 `promptVersion` 字段（推荐）

在 [src/types/llm.ts](file:///./src/types/llm.ts) 给 `ChatOptions` 与 `LLMRequestTrace` 各加一个可选字段：

```ts
export interface LLMRequestTrace {
  label: string
  promptVersion?: string   // 新增：能力域 prompt 版本号，如 'v1.0'
  attemptCount: number
  durationMs: number
  timeoutMs: number
  messageCount?: number
  promptCharCount?: number
  systemCharCount?: number
  userCharCount?: number
  success: boolean
  error?: string
  startedAt: string
}

export interface ChatOptions {
  temperature?: number
  maxTokens?: number
  timeout?: number
  maxRetries?: number
  traceLabel?: string
  promptVersion?: string   // 新增：能力域 prompt 版本号，透传到 trace
}
```

在 [src/services/llm/llmClient.ts](file:///./src/services/llm/llmClient.ts) 的 `chat` / `tryBrowserMockChat` / `recordRequestTrace` 三处透传 `promptVersion`：

```ts
// chat() 内
const promptVersion = options?.promptVersion
// ...
this.recordRequestTrace({
  label: traceLabel,
  promptVersion,           // 新增透传
  attemptCount: attempts,
  // ...其余字段不变
})
```

`tryBrowserMockChat` 的两处 `recordRequestTrace` 调用（成功 / 失败分支）同样透传 `promptVersion`。

- **优点**：
  1. **语义清晰**：`label` 保持"能力域标签"纯语义，`promptVersion` 独立字段承载版本元数据。
  2. **向后兼容**：可选字段，现有 11 处未传 `promptVersion` 的调用方（`intentRecognizer` / `layoutDraftService` / `paramExtractor` / `demoRuntimeFacade` 等）零改动，trace 里 `promptVersion` 为 `undefined` 不报错。
  3. **可扩展**：未来要加 `promptName` 字段时同样走结构化路径，不需要再拆 label。
  4. **符合审计语义**：trace 是审计对象，结构化字段便于后续做"按版本聚合 / 按能力域聚合"的查询。
- **缺点**：改动量比方案 A 略大，但都是**可选字段 + 透传**，无破坏性改动。

#### 推荐：方案 B

理由：AGENTS.md 明确要求"trace 中必须记录使用的 prompt 文件名与版本号"，结构化字段更符合"trace 元数据"语义；改动量可控（3 处类型/透传改动 + 2 处调用方加字段）；向后兼容，不影响现有 11 处未接入版本号的调用方；为未来扩展 `promptName` 留好结构化路径。

方案 A 虽然零结构改动，但会让 label 字段长期背负"标签 + 版本"双重语义，未来加 promptName 时更难收拾，属于"短期省事、长期负债"。

### 3.4 版本号初始值

candidateJudge 与 intentInterpreter 上一轮刚改过（Q1/Q2/Q3 优化，见 [docs/archive/plans/prompt-clarify-reject-failure-fix.md](file:///./docs/archive/plans/prompt-clarify-reject-failure-fix.md)），初始版本号定为 **`v1.0`**。

理由：

1. **项目从未声明过 prompt 版本号**，本次是首次接入版本管理，把"当前 prompt 内容"标记为 `v1.0` 基线，符合 AGENTS.md「prompt 文件名采用 `<能力域>.prompt.<version>.md`（如 `agentIntent.v1.md`）」示例中的 `v1` 起始约定。
2. **上一轮 Q1/Q2/Q3 改动已落盘**，git history 已记录 diff，无需把"上一轮改动前"标为 v1.0、"上一轮改动后"标为 v1.1——那样会让"首次声明版本号"和"prompt 修订"两件事混在一起，反而模糊。
3. **`v1.0` 表示"当前内容即基线"**，后续任何 prompt 修订（哪怕只改一行文案）都必须升版本号：小修订升 patch（`v1.0` → `v1.1`），大改升 major（`v1.0` → `v2.0`）。
4. **diff 保留靠 git history**：AGENTS.md 要求"prompt 修订必须更新版本号并保留 diff"，git history 是天然 diff，commit message 注明"prompt vX.Y → vA.B"即可，无需额外维护 diff 文件。

### 3.5 diff 保留方式

- **主路径：git history**。每次 prompt 修订时同步升版本号，commit message 注明 `prompt vX.Y → vA.B`，diff 在 `git log -p src/services/agent/candidateJudge.ts` 可查。
- **不额外维护 diff 文件**：避免 docs 膨胀。AGENTS.md 没有要求"必须在 docs/plans/ 下保留 prompt 修订记录"，git history 已满足"保留 diff"要求。
- **本次首次声明记录**：在本方案 md 第 3.6 节登记"哪些 prompt 在本次首次标记为 v1.0"，作为版本管理的起点。

### 3.6 版本号初始声明记录

| 能力域 | 文件 | traceLabel | 初始版本 | 声明 commit |
| --- | --- | --- | --- | --- |
| candidate_judge | [src/services/agent/candidateJudge.ts](file:///./src/services/agent/candidateJudge.ts) | `agent.candidate_judge` | `v1.0` | 本次合规修复 commit |
| intent_interpreter | [src/services/agent/llmAgentIntentInterpreter.ts](file:///./src/services/agent/llmAgentIntentInterpreter.ts) | `agent.intent_interpreter` | `v1.0` | 本次合规修复 commit |

后续接入版本号的其他 prompt 文件（`agentPlanner` / `systemPrompts` / `orchestrationPromptBuilder` / `layoutAnalysisPromptBuilder` / `promptBuilder` / `layoutDraftService` 等）在各自接入时补登此表。

---

## 4. C2 详细设计：文档路径合规

### 4.1 路径修正规则

仓库根为 `c:\Users\Administrator\Documents\Playground\aibiandan`，docs 内绝对路径统一替换为基于仓库根的相对路径：

| 原绝对路径模式 | 替换为 | 说明 |
| --- | --- | --- |
| `file:///c:/Users/Administrator/Documents/Playground/aibiandan/xxx` | `file:///./xxx` | 基于仓库根的相对 file URI |
| `file:///C:/Users/Administrator/Documents/Playground/aibiandan/xxx` | `file:///./xxx` | 同上，大小写统一 |
| `/C:/Users/Administrator/Documents/Playground/aibiandan/xxx` | `./xxx` | 基于仓库根的相对路径 |
| `/C:/Users/sucongfei/.../bigbiandan2/xxx` | `./xxx` | 失效历史路径，指向当前仓库根对应文件 |
| 反斜杠 `\\` 形式（如 `src\\services\\...`） | 正斜杠 `/`（如 `src/services/...`） | 统一分隔符，避免 Markdown 链接转义问题 |

**注意**：替换时需逐文件核对目标文件是否真实存在；对失效历史路径（`bigbiandan2` 旧仓路径），按"指向当前仓库根对应文件"原则映射，若当前仓库无对应文件则保留 `rootCause` 注释，不强行删链接。

### 4.2 修正范围

经 grep 确认，docs 下共 **17 个文件、341 处**绝对路径，分布如下：

#### 4.2.1 活跃文档（必须修正，优先级 P0）

| 文件 | 绝对路径数 |
| --- | --- |
| [docs/code-wiki.md](file:///./docs/code-wiki.md) | 173 |

`code-wiki.md` 是 AGENTS.md Documentation Discipline 明确列出的活跃文档，**必须修正**。

#### 4.2.2 归档文档（次之修正，优先级 P1）

按 AGENTS.md「归档文件不再参与活跃开发判断，若与活跃文档冲突一律以活跃文档为准」，归档文档路径修正为"防失效"性质，不影响活跃开发判断，但仍需修正以避免后续误用。

| 文件 | 绝对路径数 |
| --- | --- |
| [docs/archive/ARCHIVED.md](file:///./docs/archive/ARCHIVED.md) | 2 |
| [docs/archive/baseline/architecture.md](file:///./docs/archive/baseline/architecture.md) | 27 |
| [docs/archive/baseline/current-status.md](file:///./docs/archive/baseline/current-status.md) | 3 |
| [docs/archive/baseline/feature-alignment.md](file:///./docs/archive/baseline/feature-alignment.md) | 12 |
| [docs/archive/baseline/module-map.md](file:///./docs/archive/baseline/module-map.md) | 18 |
| [docs/archive/baseline/project-brief.md](file:///./docs/archive/baseline/project-brief.md) | 6 |
| [docs/archive/baseline/tech-debt.md](file:///./docs/archive/baseline/tech-debt.md) | 8 |
| [docs/archive/legacy-dev-plans/candidate-decision-implementation-completion.md](file:///./docs/archive/legacy-dev-plans/candidate-decision-implementation-completion.md) | 19 |
| [docs/archive/legacy-dev-plans/candidate-decision-llm-only-and-progress-messages.md](file:///./docs/archive/legacy-dev-plans/candidate-decision-llm-only-and-progress-messages.md) | 19 |
| [docs/archive/openclaw/openclaw-formal-integration.md](file:///./docs/archive/openclaw/openclaw-formal-integration.md) | 8 |
| [docs/archive/openclaw/openclaw-frontend-bridge.md](file:///./docs/archive/openclaw/openclaw-frontend-bridge.md) | 8 |
| [docs/archive/openclaw/openclaw-userscript-demo.md](file:///./docs/archive/openclaw/openclaw-userscript-demo.md) | 1 |
| [docs/archive/proposal/atomic-command-clarification-requirements.md](file:///./docs/archive/proposal/atomic-command-clarification-requirements.md) | 12 |
| [docs/archive/proposal/atomic-context-management-technical-design.md](file:///./docs/archive/proposal/atomic-context-management-technical-design.md) | 10 |
| [docs/archive/proposal/insert-program-recommendation-technical-design.md](file:///./docs/archive/proposal/insert-program-recommendation-technical-design.md) | 12 |
| [docs/archive/roadmap/roadmap.md](file:///./docs/archive/roadmap/roadmap.md) | 3 |

合计 168 处。

#### 4.2.3 上一轮产出文档

经 grep 确认，[docs/archive/plans/prompt-clarify-reject-failure-fix.md](file:///./docs/archive/plans/prompt-clarify-reject-failure-fix.md) **不含绝对路径**（已用反斜杠相对路径 `src\services\agent\candidateJudge.ts` 形式），无需修正。

> 备注：本方案 md 内的代码引用统一采用 `file:///./src/...` 正斜杠相对路径形式，与 AGENTS.md Documentation Discipline 示例一致。

### 4.3 是否需要批量替换脚本

**需要**。17 个文件 341 处，手工替换易错且难以保证一致性。

执行方式：

1. 写一次性 Node 替换脚本（如 `scripts/fix-docs-abs-paths.mjs`），按 4.1 规则做正则批量替换。
2. 脚本跑完后**逐文件 diff 复核**，特别核对：
   - `code-wiki.md` 的 173 处是否全部命中
   - 失效历史路径（`bigbiandan2`）是否正确映射到当前仓库根
   - 反斜杠 → 正斜杠是否误伤代码块内的转义字符
3. 脚本本身**不落仓**（用完即删，避免长期保留一次性脚本），或落仓到 `scripts/` 并在 commit message 注明"一次性脚本，后续不再维护"。

> 不引入 npm script 长期门禁，避免增加 package.json 维护负担。后续靠 grep 人工复查（见第 5 节验证方式）。

---

## 5. 验证方式

### 5.1 C1 验证

#### 5.1.1 新增 case

在 [src/services/__tests__/](file:///./src/services/__tests__/) 下新增 `llmClient.promptVersion.test.ts`（或扩展现有 `llmClient.test.ts`），覆盖以下 case：

| case id | 验证点 | expected |
| --- | --- | --- |
| `c1-trace-carries-prompt-version` | 调用 `chat` 时传 `promptVersion: 'v1.0'`，trace 中能观察到 `promptVersion` 字段 | `recentRequestTraces[0].promptVersion === 'v1.0'` |
| `c1-trace-undefined-when-no-version` | 不传 `promptVersion` 时，trace 中 `promptVersion` 为 `undefined`，不报错 | `recentRequestTraces[0].promptVersion === undefined` |
| `c1-candidate-judge-passes-version` | candidateJudge 调用 LLM 时传入 `CANDIDATE_JUDGE_PROMPT_VERSION` | mock LLMClient.chat 断言 `options.promptVersion === 'v1.0'` |
| `c1-intent-interpreter-passes-version` | intentInterpreter 调用 LLM 时传入 `INTENT_INTERPRETER_PROMPT_VERSION` | mock LLMClient.chat 断言 `options.promptVersion === 'v1.0'` |

case 字段遵循 AGENTS.md Case First 约定：`id` / `userInput` / `expectedDecision` / `mustNotHappen` / `verification` 五字段完整。

#### 5.1.2 case 纳入门禁

新增 case 文件加入 `package.json` 的 `agent:check:tests` 列表（AGENTS.md「case 自动纳入门禁」硬约束）。

#### 5.1.3 运行命令

```
npm run agent:check
npm run build
```

### 5.2 C2 验证

#### 5.2.1 grep 复查

替换完成后，在 docs 下重新 grep 绝对路径，预期命中 0：

```
# 预期 0 命中
grep -rn "file:///c:/Users\|file:///C:/Users\|/C:/Users/sucongfei\|/C:/Users/Administrator/Documents/Playground/aibiandan" docs/
```

> 不引入长期 lint 门禁（避免增加 CI 复杂度），靠本任务一次性清零 + 后续 PR review 人工把关。若团队后续希望长期门禁，可在 `.husky/pre-commit` 加 grep 检查，本次不做。

#### 5.2.2 抽样人工核对

对 `code-wiki.md` 抽样 10 处替换，确认链接可点击跳转到对应文件；对失效历史路径（`bigbiandan2`）映射后的链接抽样 3 处确认目标文件存在。

#### 5.2.3 运行命令

```
npm run agent:check   # 文档变化不影响 agent:check，但跑一次确保无副作用
npm run build
```

---

## 6. 风险评估

### 6.1 C1 风险

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| `ChatOptions` / `LLMRequestTrace` 加可选字段影响所有调用方 | 低。可选字段，现有 11 处未传 `promptVersion` 的调用方零改动，trace 里 `promptVersion` 为 `undefined` 不报错 | 类型定义为可选 `promptVersion?: string`；不传时 trace 字段为 `undefined`，下游消费方需做 null check（目前 trace 只在 dev 工具展示，无强依赖） |
| `recordRequestTrace` 透传遗漏 | 中。`llmClient.ts` 有 3 处 `recordRequestTrace` 调用（chat 成功 / chat 失败 / tryBrowserMockChat 成功+失败共 4 处），漏一处会导致部分 trace 无版本号 | case `c1-trace-carries-prompt-version` 覆盖主路径；代码 review 时核对 4 处调用全部透传 |
| trace 上限 20 条导致版本号被淘汰 | 低。trace 只用于近期审计，不要求全量留存版本号 | 不在本次范围；如需长期审计可后续接 trace 落盘 |
| 版本号与 prompt 内容脱节（改了 prompt 忘升版本号） | 中。AGENTS.md 要求"prompt 修订必须更新版本号"，靠人工记忆易漏 | 不在本次自动化范围；靠 PR review + commit message 规范约束；后续可考虑加 lint 检查"改了 prompt 常量但没改版本号"的 diff，本次不做 |
| 方案 B 改动量比方案 A 大 | 低。3 处类型/透传 + 2 处调用方加字段，均为可选字段，向后兼容 | 已选方案 B，接受改动量换取结构化语义 |

### 6.2 C2 风险

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| 批量替换误伤代码块内转义字符 | 中。Markdown 代码块内可能有 `\\` 转义，正则替换可能误伤 | 脚本只替换 Markdown 链接形式（`[text](path)` 内的 path），不替换代码块内文本；脚本跑完后逐文件 diff 复核 |
| 失效历史路径（`bigbiandan2`）映射错误 | 中。旧仓路径对应的文件在当前仓库可能已不存在或重命名 | 逐文件核对；若当前仓库无对应文件，保留链接但加 `rootCause` 注释说明映射依据，不强行删链 |
| 归档文档路径修正影响历史可读性 | 低。归档文档不参与活跃开发判断，路径修正只提升"防失效"性，不影响历史语义 | 修正后保留原文件名与章节结构，只替换路径 |
| `code-wiki.md` 173 处替换后链接断裂 | 中。链接形式错误会导致点击跳转失败 | 抽样 10 处人工核对可点击性 |
| 一次性脚本落仓后长期保留 | 低。一次性脚本长期保留会增加维护负担 | 脚本用完即删，或落仓到 `scripts/` 并在 commit message 注明"一次性脚本，后续不再维护" |

---

## 7. 不在本次范围

明确列出本次**不做**的事项，避免范围蔓延：

1. **不拆分 `.prompt.<version>.md` 外部文件**。现有 prompt 内嵌在 .ts 常量里的现状保持，避免大改动。AGENTS.md Naming Conventions 的「prompt 文件名采用 `<能力域>.prompt.<version>.md`」示例适用于"新建 prompt 文件"场景，对"已有 prompt 内嵌在 .ts"的现状，本次以"模块级版本常量 + trace 透传"满足"显式声明版本 + trace 记录版本"的硬约束。
2. **不统一所有 8 个 prompt 文件的版本管理流程**。本次只覆盖 candidateJudge 与 intentInterpreter 两个上一轮刚改过的核心 prompt；`agentPlanner.ts` / `systemPrompts.ts` / `orchestrationPromptBuilder.ts` / `layoutAnalysisPromptBuilder.ts` / `promptBuilder.ts` / `layoutDraftService.ts` 等其他内嵌 prompt 文件后续逐步接入，接入时补登本方案 md 第 3.6 节版本号初始声明记录表。
3. **不改 prompt 内容本身**。版本号是元数据，不是 prompt 文本；candidateJudge 与 intentInterpreter 的 system prompt 文案保持上一轮 Q1/Q2/Q3 优化后的状态。
4. **不新增 LLM 调用次数**。candidateJudge、intentInterpreter 各自维持单次调用。
5. **不引入长期 lint 门禁检查绝对路径**。本次一次性清零，后续靠 PR review 人工把关；若团队后续希望长期门禁，可在 `.husky/pre-commit` 加 grep 检查，本次不做。
6. **不引入"改了 prompt 但没升版本号"的自动化检测**。靠 PR review + commit message 规范约束，后续可考虑加 diff lint，本次不做。
7. **不改动 trace 上限 20 条**。trace 只用于近期审计，不要求全量留存版本号；如需长期审计可后续接 trace 落盘，本次不做。
8. **不接入 `promptName` 字段**。AGENTS.md 要求"trace 中必须记录使用的 prompt 文件名与版本号"，本次先接 `promptVersion`；`promptName` 可从 `traceLabel`（能力域标签）推断，暂不单独建字段，避免过度设计；后续若有"同能力域多 prompt 文件"场景再补。
9. **不修改 `AGENTS.md` 本身**。AGENTS.md 是规范源，本次只做合规修复，不改规范。
10. **不更新 `docs/code-wiki.md` 第 12 节文档索引**。本方案 md 落在 `docs/plans/`，按 AGENTS.md「文档新增门禁」需在 `docs/code-wiki.md` 第 12 节"文档索引"登记——此项**属于本次范围**，会在 C2 路径修正时一并登记（见第 4.2.1 节活跃文档修正）。

---

## 8. 实施顺序建议

为降低风险，建议按以下顺序实施（待用户确认后由实现阶段执行）：

1. **C1 类型与透传**：先改 [src/types/llm.ts](file:///./src/types/llm.ts) + [src/services/llm/llmClient.ts](file:///./src/services/llm/llmClient.ts)，跑 `npm run build` 确保类型不破。
2. **C1 调用方接入**：再改 candidateJudge / intentInterpreter，加版本常量 + 传 `promptVersion`。
3. **C1 case**：新增 `llmClient.promptVersion.test.ts`，加入 `agent:check:tests`，跑 `npm run agent:check`。
4. **C2 活跃文档**：先修 [docs/code-wiki.md](file:///./docs/code-wiki.md)（173 处），人工抽样核对。
5. **C2 归档文档**：再修 `docs/archive/` 下 16 个文件（168 处）。
6. **C2 grep 复查**：docs 下重新 grep 绝对路径，预期 0 命中。
7. **最终验证**：`npm run agent:check` + `npm run build` 全绿。

---

## 9. 文档同步声明

本方案 md 是新增文档，按 AGENTS.md「文档新增门禁」需在 [docs/code-wiki.md](file:///./docs/code-wiki.md) 第 12 节"文档索引"登记。此项**属于本次 C2 修正范围**，会在 C2 路径修正时一并登记到 `docs/code-wiki.md` 文档索引章节。

本方案 md 不涉及 AGENTS.md / `docs/agent-development-protocol.md` / `docs/aibiandan-agent-rules.md` 的章节同步——本次是合规修复，不改规范本身。

---

## 10. 归档声明

本次任务未发现需要新归档的历史遗留文档。`docs/archive/plans/prompt-clarify-reject-failure-fix.md` 经 grep 确认无绝对路径，无需修正，保持归档状态不变。
