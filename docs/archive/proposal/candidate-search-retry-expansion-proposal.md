# 节目检索通用多次关键词组合重试机制技术方案

> 角色：solution-architect
> 状态：待用户确认（v2：调整为一次性生成关键词）
> 阶段范围：播单创建、原子命令识别、电视/轮播策略分流、候选推荐确认/取消短链路
> 参考实现：trae / codex 的检索重试机制（LLM 在意图解析阶段一次性生成多组带策略标签的关键词，重试阶段为纯本地检索循环，本地只做保护与暴露失败）

---

## 1. 背景与问题

### 1.1 用户需求

用户希望：当用户给出的节目关键词太死时（拆字粒度过细、错别字、栏目+期数组合过窄等），系统能像 trae、codex 的检索机制一样，由 LLM 多次尝试不同关键词组合（不同拆字、二次理解、修复错别字、近义改写、栏目降级等）来检索节目，而不是 0 命中就直接放弃等用户换词。

### 1.2 现有检索链路

当前节目检索链路如下：

```
用户输入
  → LLM 意图解析（生成 searchAlternatives，仅在 "when helpful" 时生成）
  → 关键词编译与拆解（retrievalConstraintCompiler / candidateKeywordMatcher / searchFacets）
  → 检索条件生成（queryIntentService.generateCriteria）
  → 外部检索（唯一入口：runtime.dataGateway.readProgramCandidates
              → reader.getProgramCandidates
              → candidateService.queryCandidates / searchPrograms）
  → 候选选择（candidateSelectionService.selectForInsert / selectForGap + LLM 决策 + guard）
  → 执行
```

### 1.3 调研确认的问题

1. **不存在通用的"多次关键词组合重试检索"机制**。外部检索只发生一次，0 候选时直接进入 `needs_clarification`，等用户换词。
2. **存在受限的本地过滤重试**：仅在 `src/services/agent/atomicCommandCapability.ts:4144` `resolveCandidatePool` 中，对内存候选池用 LLM 给的 `searchAlternatives` 多次本地过滤，不重新发起外部检索，且仅作用于 atomic_command 路径。
3. **LLM 已能生成 `searchAlternatives`**（`src/services/agent/llmAgentIntentInterpreter.ts:133`），但触发条件是 "when helpful" 非强制，且不触发新检索。
4. **错别字修复机制不存在**；关键词拆字存在（`src/services/candidateKeywordMatcher.ts:321`）但仅用于本地过滤，不是 LLM 主路径。
5. docs 已把"素材检索重试/扩展查询工作流"列为 P2 待开发（`docs/agent-weekly-inspections/2026-06-23.md:46`）；"失败后的候选检索降级入口"列为 P1（`docs/agent-weekly-inspections/2026-06-25.md:45`）。

### 1.4 核心缺口

- 外部检索只跑一次，命中数为 0 时无二次机会。
- `searchAlternatives` 只用于本地过滤，没有驱动新一轮外部检索。
- `candidateService.queryCandidates` / `searchPrograms` 是底层检索原语，但没有重试编排。
- `resolveCandidatePool` 的重试逻辑硬编码在 atomic_command 路径内部，其他调用点（orchestrator、demoRuntimeFacade、UI 直查）无法复用。
- 错别字、过细拆字、栏目+期数过窄等场景全部依赖用户手动换词。

---

## 2. 目标与非目标

### 2.1 目标

1. 提供通用的"多次关键词组合重试检索"机制，让所有涉及节目检索的调用点统一受益。
2. 重试关键词由 LLM 在意图解析阶段一次性生成多组带策略标签的关键词组合（LLM-first / LLM-only），覆盖 original / typo_fix / decompose / paraphrase / column_demote / broaden 等维度；重试阶段为纯本地检索循环，按策略优先级轮询，不再调 LLM。
3. 重试触发条件统一：候选为 0、候选不足（低于阈值）、LLM 一次性生成的策略关键词尚未用完。
4. 重试过程通过 SSE 流式进度实时上报，编排人员可看到"查节目库-首次 / 查节目库-重试N（策略标签） / 候选决策 / （可选）二次反思"等阶段。
5. 防止无限搜索：最大重试次数有上限，达到上限或所有策略用完时暴露失败；可选 escape hatch 二次反思最多触发 1 次。
6. 与现有 `resolveCandidatePool` / `searchAlternatives` / `fallbackToBroadQuery` 收敛统一，逐步迁移，旧函数不一次性删除。

### 2.2 非目标

1. 不做本地关键词改写、本地同义词扩展、本地错别字修复（违反 LLM-first 硬约束）。
2. 不接入补空窗、全天编排等长流程（本阶段范围外，见 AGENTS.md Current Phase Scope）。
3. 不替换 `candidateService` 底层检索原语，只在其上增加重试编排层。
4. 不改变 LLM 候选决策协议（`candidateJudge`），只扩大进入决策的候选池。
5. 不引入新的本地评分/兜底逻辑，重试关键词的生成与判断全部由 LLM 完成。

---

## 3. 设计原则

| 原则 | 含义 | 落地约束 |
| --- | --- | --- |
| LLM-first / LLM-only | 重试关键词必须由 LLM 生成 | 禁止本地用正则/同义词词典改写用户意图 |
| 本地只保护结果 | 本地逻辑只能校验、收敛、暴露失败 | 时间换算、写入校验、草案完整度、危险操作保护、结构校验、重试次数上限、去重 |
| 暴露失败 | 模型无法返回有效理解时，暴露失败 | 不由本地规则假装理解，允许用户重试或补充 |
| 防无限搜索 | 重试必须有终止条件 | 默认 3 次，最大 5 次，可配置 |
| 结果可解释 | 每轮重试的关键词、命中数、候选摘要都可追溯 | 记录到 `searchRetryPlan`，透传到 trace |
| 短链路收敛 | 只服务原子命令短链路 | 补空窗/全天编排不接入 |

### 3.1 设计决策：一次性生成 vs 轮询式 LLM 调用

用户反馈提出："从上下文管理角度，候选关键词一开始就生成比较好"。本节明确两种候选关键词生成方式的优劣，并锁定主路径。

#### 3.1.1 方案 A：轮询式 LLM 调用（每轮重试都调 LLM 生成下一组关键词）

- **流程**：首轮 0 命中 → 调 LLM 生成第 2 组关键词 → 检索 → 仍 0 命中再调 LLM 生成第 3 组 → ... → 达上限或 LLM 返回 shouldRetry=false 终止。
- **优点**：
  - LLM 能看到上一轮命中摘要，理论上能"按反馈演化"关键词。
  - 关键词按需生成，命中即停，未命中轮次少时 LLM 调用次数少。
- **缺点**：
  - 上下文管理复杂：每轮都要把 triedKeywords、matchedCandidateSummaries、原意图重新拼装进 prompt，prompt 膨胀风险高。
  - 延迟成本高：每次 LLM 调用都是串行阻塞，3 轮重试最多 3 次额外 LLM 调用，SSE 流式进度会被拉长，与 project_memory 中 LLM timeout 风险叠加。
  - 与 SSE 流式进度不友好：用户每轮都要等待 LLM 思考 + 检索两段延迟，气泡节奏卡顿。
  - LLM 在重试阶段需要重新建立意图上下文，容易因为 prompt 摘要失真导致关键词偏离原意图。

#### 3.1.2 方案 B：一次性生成（LLM 在意图解析阶段生成多组带策略标签的关键词，重试阶段纯本地检索循环）

- **流程**：意图解析阶段 LLM 同步返回多组带策略标签的关键词（original / typo_fix / decompose / paraphrase / column_demote / broaden）→ 重试阶段按策略优先级本地依次发起外部检索 → 命中足够或策略用完时停止。
- **优点**：
  - 上下文管理简单：LLM 在意图解析阶段已具备完整用户意图、栏目、时段、播单类型、历史进度上下文，关键词生成质量更高，不需要在重试阶段重建上下文。
  - 延迟成本可控：意图解析阶段一次 LLM 调用产出多组关键词，重试阶段为纯本地检索循环，无额外 LLM 调用，总体延迟低于方案 A。
  - SSE 流式进度友好：重试阶段每轮只等检索延迟，气泡节奏连贯。
  - 与 project_memory 中 LLM timeout 风险解耦：LLM 调用集中在意图解析阶段，重试阶段不引入新的 LLM timeout 风险。
  - 与现有 `searchAlternatives` 机制衔接自然：现有 `llmAgentIntentInterpreter.ts:133` 已生成 2-5 个 searchAlternatives，本方案只扩展为带策略标签 + 强制最少 2 组 + 附带理由，不是全新协议。
- **缺点**：
  - LLM 看不到首轮命中结果，关键词可能不够精准。
  - LLM 一次性生成多组关键词会增加意图解析阶段延迟（一次调用产出更多内容）。
- **缓解**：
  - 通过 prompt 引导 LLM 覆盖多维度（拆字 / 错别字修复 / 近义 / 栏目降级 / 放宽），并强制至少 original + 1 个其它策略，降低"关键词不够精准"风险。
  - 提供 escape hatch（默认关闭）：所有 LLM 关键词都 0 命中时，可选触发一次 LLM 二次反思，输入用户原始意图 + 已尝试关键词 + 各轮命中摘要，输出新关键词组合或明确"无更多关键词"标志。开启时最多触发 1 次，防止无限循环。
  - 通过 prompt 优化和并发检索缓解意图解析阶段延迟。

#### 3.1.3 主路径选择

**主路径采用方案 B（一次性生成），escape hatch 作为可选。**

理由：

1. **上下文管理**：用户反馈明确指出"一开始就生成比较好"。意图解析阶段上下文最完整，关键词生成质量最高；重试阶段重建上下文反而容易失真。
2. **延迟成本**：方案 B 意图解析阶段一次调用产出多组关键词，重试阶段无 LLM 调用，总体延迟低于方案 A。
3. **SSE 流式进度**：方案 B 重试阶段每轮只等检索延迟，气泡节奏连贯，符合 project_memory 中 SSE 流式进度要求。
4. **LLM timeout 风险**：方案 B 把 LLM 调用集中在意图解析阶段，重试阶段不引入新的 LLM timeout 风险，与 project_memory 中 LLM timeout 风险解耦。
5. **与现有机制衔接**：方案 B 是对现有 `searchAlternatives` 的扩展，不是全新协议，改造成本低。

#### 3.1.4 与现有 searchAlternatives 的衔接关系

| 现状 | 调整后 |
| --- | --- |
| LLM 返回 2-5 个 searchAlternatives | LLM 返回多组带策略标签的关键词组合 |
| 无策略标签，"when helpful" 非强制 | 强制至少 original + 1 个其它策略（移除 "when helpful" 软引导） |
| 无理由字段 | 每组关键词附带 LLM 给出的"为什么这组可能命中"的简短理由 |
| 仅用于本地过滤 | 驱动重试阶段本地检索循环（按策略优先级依次发起外部检索） |

类型扩展位置：`src/services/agent/types.ts:70`（`searchAlternatives` 字段）与 `src/services/agent/llmAgentIntentInterpreter.ts:133`（生成逻辑）。

---

## 4. 整体架构

### 4.1 模块位置（推荐：选项 A + B 混合）

采用"底层原语加重试编排 + 独立服务抽取"混合方案：

- **选项 A**：在 `src/services/candidateService.ts` 新增 `queryCandidatesWithRetry` / `searchProgramsWithKeywordExpansion`，作为底层检索原语的重试封装。
- **选项 B**：把 `atomicCommandCapability.ts` 现有 `resolveCandidatePool` / `buildCandidateRetryKeywords` / `buildCandidateSearchRetryPlan` / `CandidateSearchAttempt` / `CandidatePoolResolution` 抽取到独立模块 `src/services/agent/candidateSearchRetryService.ts`，统一收口。

二者关系：`candidateSearchRetryService` 负责重试编排（封装 LLM 一次性生成 `generateKeywordStrategies` + 本地检索循环 `executeRetryLoop` + 记录 attempts + 判断终止 + 可选 escape hatch 二次反思），`candidateService.queryCandidatesWithRetry` 负责把重试编排接到底层 `queryCandidates` 上。atomic_command 路径原有的 `resolveCandidatePool` 改为调用新模块，行为不变（阶段 1 纯重构）。

### 4.2 与现有机制的关系

| 现有机制 | 关系 | 迁移策略 |
| --- | --- | --- |
| `resolveCandidatePool`（atomicCommandCapability.ts:4144） | 本地过滤重试，仅 atomic_command 路径 | 抽取到新模块，保留本地过滤能力，叠加外部重试 |
| `searchAlternatives`（types.ts:70，llmAgentIntentInterpreter.ts:133） | LLM 首轮生成的候选关键词（无策略标签，"when helpful" 非强制） | 扩展为意图解析阶段一次性生成的带策略标签关键词组合（original/typo_fix/decompose/paraphrase/column_demote/broaden），强制最少 original + 1 个其它策略，驱动本地检索循环 |
| `fallbackToBroadQuery`（candidateService.ts:144） | 软关键词降级标志，不重新检索 | 保留，作为触发重试的信号之一 |
| `candidateSelectionService.selectFallback` | 候选不足时的兜底选择 | 保留，重试扩大候选池后再进入选择 |
| `buildCandidateSearchRetryPlan`（atomicCommandCapability.ts:4226） | 构造重试计划记录 | 迁移到新模块，扩展为多轮记录 |

### 4.3 重试触发条件

满足以下任一条件触发下一轮重试（未达上限时）：

1. **候选为 0**：当前轮外部检索 + 本地过滤后命中数为 0。
2. **候选不足**：当前轮命中数 < `minCandidateThreshold`（默认 1，可按 playlistType 配置；轮播单可适当调高以扩大选择面）。
3. **LLM 一次性生成的策略关键词尚未用完**：意图解析阶段 LLM 给出的 keywordStrategies 中仍有未尝试的策略标签，且当前候选数仍不满足阈值。

### 4.4 重试维度（LLM 一次性生成的策略标签维度）

重试关键词由 LLM 在意图解析阶段一次性生成，每组关键词附带一个策略标签，重试阶段按策略标签优先级本地依次发起外部检索。策略标签定义如下：

| 策略标签 | 含义 | 示例 |
| --- | --- | --- |
| `original` | 用户原词（强制必须有） | "看东房" |
| `typo_fix` | 错别字修复（由 LLM 完成，本地不做） | "看东房" → "看东方" |
| `decompose` | 拆字 / 短语拆解 | "上海旅游宣传片" → "上海 / 旅游 / 短片" |
| `paraphrase` | 二次理解 / 近义改写 | "晨间新闻" → "早间新闻 / 东方快报"；"看东方 第10期" → "看东方" + "第10期" |
| `column_demote` | 栏目降级（去掉期数约束） | "东方快报 第10期" 0 命中 → "东方快报" |
| `broaden` | 放宽（去掉类型硬约束 / 主题放宽） | "上海旅游纪录片" 0 命中 → "上海 旅游" |

#### 4.4.1 策略优先级顺序

LLM 生成 keywordStrategies 后，本地检索循环按以下优先级依次发起外部检索：

```
original → typo_fix → decompose → paraphrase → column_demote → broaden
```

#### 4.4.2 优先级理由

1. **original 优先**：原词命中即用户意图直中，无需额外尝试。
2. **typo_fix 次之**：错别字是 0 命中最高频原因，修复后命中率高且语义不变。
3. **decompose 再次**：拆字适合处理过细短语，保留原意但放宽匹配粒度。
4. **paraphrase 之后**：近义改写涉及语义偏移，应在原词/错别字/拆字都未命中后再尝试。
5. **column_demote 之后**：栏目降级会丢失期数约束，可能引入大量无关期次，应在更精确的策略失败后再用。
6. **broaden 最后**：放宽会丢失类型硬约束，候选池膨胀风险最高，作为兜底。

#### 4.4.3 强制最少策略

- LLM 必须返回 `original` + 至少 1 个其它策略标签（移除现有 "when helpful" 软引导）。
- 若 LLM 返回的策略少于 2 组（即只有 original），视为无效输出，进入失败暴露流程（见 5.6）。
- 本地不补充策略标签，不做本地关键词改写。

### 4.5 重试次数与终止

- **默认次数**：3 次（即除 original 外，最多再尝试 3 个其它策略标签的关键词组合）。
- **最大次数**：5 次（硬上限，本地强制，不可被 LLM 覆盖）。
- **配置**：通过 `CandidateSearchRetryConfig` 注入，按 playlistType 差异化（电视播单倾向保守，轮播单可放宽）。
- **终止条件**（任一满足即停止）：
  1. 达到最大重试次数。
  2. LLM 一次性生成的 keywordStrategies 中所有策略标签均已尝试完毕。
  3. 候选已足够（命中数 ≥ `minCandidateThreshold`）。
  4. 用户主动取消（通过 SSE 取消信号，本阶段可选实现）。
- **escape hatch**：所有 LLM 给的关键词都 0 命中时，若 `enableSecondaryReflection=true`，可触发一次 LLM 二次反思生成新关键词；若 `enableSecondaryReflection=false`（默认），直接进入终止后流程。
- **终止后**：候选仍为 0 或不足 → 暴露失败，进入 `needs_clarification`，不允许本地兜底硬排。

### 4.6 架构示意图

```
                    ┌──────────────────────────────────────────────┐
                    │  candidateSearchRetryService（新增）          │
                    │  - generateKeywordStrategies：封装 LLM        │
                    │    在意图解析阶段一次性生成多组带策略标签的关键词│
                    │  - executeRetryLoop：本地检索循环              │
                    │    （按策略优先级 original→typo_fix→decompose  │
                    │     →paraphrase→column_demote→broaden 轮询）  │
                    │  - 记录 attempts / searchRetryPlan            │
                    │  - 判断终止 / 暴露失败                         │
                    │  - 可选 escape hatch：二次反思（默认关闭）      │
                    └──────────┬───────────────────────────────────┘
                               │ 调用
                 ┌─────────────┴──────────────┐
                 ▼                            ▼
   ┌─────────────────────────┐   ┌─────────────────────────────────┐
   │ candidateService        │   │ 意图解析阶段 LLM 协议              │
   │ - queryCandidatesWithRetry│   │   （扩展现有 searchAlternatives） │
   │ - searchProgramsWithKeywordExpansion│   │ - 输入：用户原始输入 + 上下文    │
   │ - 内部循环调用 queryCandidates│   │   （栏目/时段/播单类型/历史进度）│
   │   （替换 searchKeywords）  │   │ - 输出：keywordStrategies        │
   └────────────┬────────────┘   │   [{strategy, keywords, reason}] │
                │                │   + suggestSecondaryReflection    │
                │                └─────────────────────────────────┘
                │
                │   （可选，escape hatch 开启且全 0 命中时）
                │                ┌─────────────────────────────────┐
                │                │ 二次反思 LLM 协议（5.7）          │
                │                │ - 输入：原意图+已尝试词+各轮命中摘要│
                │                │ - 输出：新 keywordStrategies 或    │
                │                │   "无更多关键词"标志                │
                │                └─────────────────────────────────┘
                ▼
   ┌─────────────────────────┐
   │ runtimeSchedulingDataGateway│
   │ - readProgramCandidates  │
   │   （唯一外部检索入口）     │
   └─────────────────────────┘
```

---

## 5. LLM 协议设计

### 5.1 协议定位

候选关键词策略生成是**意图解析阶段一次性生成**，不是"每轮重试生成"。它复用并扩展现有 `searchAlternatives` 协议（`src/services/agent/llmAgentIntentInterpreter.ts:133`），在意图解析 LLM 调用中同步返回多组带策略标签的关键词组合。重试阶段不再调 LLM，只按 LLM 给的策略优先级本地依次发起外部检索。

escape hatch 二次反思是独立的可选拓展，仅在 `enableSecondaryReflection=true` 且所有 LLM 关键词都 0 命中时触发，最多 1 次。

### 5.2 输入

```typescript
/**
 * 意图解析阶段 LLM 输入（在现有 llmAgentIntentInterpreter 输入基础上明确传递以下字段）
 *
 * 设计约束：
 * - 上下文一次性传递，重试阶段不再调 LLM，因此意图解析阶段必须把所有影响关键词生成的上下文给齐
 * - 不传递已尝试关键词（这是首次生成，没有"已尝试"概念）
 * - 不传递历次命中摘要（同上）
 */
interface CandidateKeywordStrategyLlmInput {
  /** 用户原始输入（完整自然语言，未做本地改写） */
  userRawInput: string
  /** 用户原始节目线索（programHint / targetProgramName，从意图解析结果中提取） */
  originalKeyword: string
  /** 用户原始意图摘要（来自意图解析的 reasoning） */
  userIntentSummary: string
  /** 当前栏目上下文（如有） */
  columnContext?: string
  /** 当前时段上下文（如有） */
  timeSlotContext?: string
  /** 当前播单类型，影响策略偏好 */
  playlistType: 'tv' | 'rotation'
  /** 历史编排进度上下文（如昨日顺播到第几期，仅电视播单） */
  historyProgressContext?: string
  /** 是否启用 escape hatch 二次反思（影响 LLM 是否给出 suggestSecondaryReflection 标志） */
  enableSecondaryReflection: boolean
}
```

### 5.3 输出

```typescript
/**
 * 意图解析阶段 LLM 一次性生成的关键词策略组合
 */
interface CandidateKeywordStrategyLlmOutput {
  /**
   * 带策略标签的关键词组合数组
   *
   * 强制约束：
   * - 必须包含 strategy='original' 的一组（用户原词或归一化原词）
   * - 必须至少包含 1 个其它策略标签的组合（typo_fix/decompose/paraphrase/column_demote/broaden）
   * - 总数 2-6 组
   * - 同一策略标签可出现多次（如多组 paraphrase）
   */
  keywordStrategies: Array<{
    /** 策略标签 */
    strategy: 'original' | 'typo_fix' | 'decompose' | 'paraphrase' | 'column_demote' | 'broaden'
    /** 该策略下的关键词组合（1-3 个关键词，去重） */
    keywords: string[]
    /** LLM 给出的"为什么这组可能命中"的简短理由（中文，用于 trace 和失败暴露） */
    reason: string
  }>
  /**
   * LLM 是否建议在所有关键词都 0 命中时启用二次反思
   *
   * - true：LLM 认为可能还有其它思路，但需要看到首轮命中结果才能给出
   * - false：LLM 认为已穷尽合理策略
   * - 仅当输入 enableSecondaryReflection=true 时有意义；本地仅在所有策略 0 命中且此标志为 true 时触发二次反思
   */
  suggestSecondaryReflection: boolean
  /** LLM 对整体策略的总结说明（中文，用于 trace） */
  reasoning: string
}
```

### 5.4 Prompt 设计原则

1. **角色定位**：模拟经验丰富的编排人员，先看硬条件（时间、栏目、顺播），再看上下文连续性，再看内容匹配、时长适配、收视率或热播策略，最后给出拒绝理由。
2. **一次性生成**：明确告知 LLM 这是"唯一一次关键词策略生成机会"，重试阶段不会再调 LLM，要求 LLM 一次性覆盖多维度。
3. **强制覆盖多维度**：引导 LLM 至少覆盖以下维度（按需）：
   - `original`：用户原词（强制必须有）。
   - `typo_fix`：错别字修复，明确"如果原词疑似错别字，直接给出修复后的关键词，不要询问用户"。
   - `decompose`：拆字 / 短语拆解。
   - `paraphrase`：二次理解 / 近义改写。
   - `column_demote`：栏目降级（去掉期数约束）。
   - `broaden`：放宽（去掉类型硬约束 / 主题放宽）。
4. **错别字修复由 LLM 完成**：prompt 明确错别字修复是 LLM 职责，本地不做。
5. **强制最少策略**：必须返回 `original` + 至少 1 个其它策略标签，否则视为无效输出。
6. **不发明候选**：只生成关键词，不直接给出节目名候选（与 `searchAlternatives` 一致）。
7. **策略可解释**：每组关键词必须带 `strategy` 和 `reason`，便于 trace 和失败暴露。
8. **playlistType 差异**：电视播单强调栏目/顺播/历史连续性；轮播单强调内容匹配/收视率/热播。
9. **escape hatch 标志**：仅当 `enableSecondaryReflection=true` 时，LLM 可在 `suggestSecondaryReflection` 中表达是否建议二次反思。

### 5.5 Prompt 骨架（示意）

```text
你是一位经验丰富的电视频道编排人员。当前需要在意图解析阶段一次性为节目检索生成多组带策略标签的关键词组合。

用户原始输入：{userRawInput}
用户原始线索：{originalKeyword}
用户意图：{userIntentSummary}
栏目上下文：{columnContext}
时段上下文：{timeSlotContext}
播单类型：{playlistType}
历史编排进度：{historyProgressContext}
是否启用二次反思：{enableSecondaryReflection}

重要：这是唯一一次关键词策略生成机会，重试阶段不会再调你。请一次性覆盖多维度，确保用户原词 0 命中时仍有备选策略。

请按以下策略标签生成关键词组合（每组含 strategy / keywords / reason）：
1. strategy=original：用户原词（强制必须有）。
2. strategy=typo_fix：若原词疑似错别字，直接给出修复后的关键词，不要询问用户。
3. strategy=decompose：若原词过细或为长短语，做拆字 / 短语拆解（如"上海旅游宣传片" → "上海 / 旅游 / 短片"）。
4. strategy=paraphrase：若原词可用近义改写或需要二次理解，给出近义改写（如"晨间新闻" → "早间新闻 / 东方快报"）。
5. strategy=column_demote：若原词含栏目+期数且期数可能不存在，做栏目降级（如"东方快报 第10期" → "东方快报"）。
6. strategy=broaden：若原词含类型硬约束可能过窄，做放宽（如"上海旅游纪录片" → "上海 旅游"）。

约束：
- 必须返回 original + 至少 1 个其它策略标签，否则视为无效输出。
- 只生成关键词，不要发明节目名候选。
- 同一策略标签可多次出现（如多组 paraphrase）。
- 电视播单优先保留栏目与顺播连续性；轮播单优先内容匹配与收视率。
- 若 enableSecondaryReflection=true，请在 suggestSecondaryReflection 中表达是否建议在所有关键词 0 命中时触发二次反思。

返回 JSON：{keywordStrategies, suggestSecondaryReflection, reasoning}
```

### 5.6 失败暴露

- LLM 返回非合法 JSON → 视为意图解析阶段关键词策略生成失败，记录 trace，不假装理解，直接用 original 关键词发起首轮检索（首轮仍可正常进行），不进入重试循环，首轮 0 命中即暴露 `needs_clarification`。
- LLM 返回 `keywordStrategies` 为空或只有 `original` 一组 → 视为无效输出（违反强制最少策略），记录 trace，仍用 original 发起首轮检索，不进入重试循环。
- LLM 返回的 `keywordStrategies` 中存在重复策略标签且关键词归一化后全部重复 → 本地去重后只保留 original，按"只有 original"处理（同上）。
- 本地不做任何关键词补充或本地改写（违反 LLM-first）。

### 5.7 Escape hatch 协议（可选，默认关闭）

escape hatch 是所有 LLM 一次性生成的关键词都 0 命中时的可选二次反思机制，通过 `enableSecondaryReflection` 配置控制，默认 `false`。开启时最多触发 1 次，防止无限循环。

#### 5.7.1 触发条件

满足以下全部条件才触发：

1. `enableSecondaryReflection=true`。
2. LLM 一次性生成的所有 `keywordStrategies`（含 original）均已尝试完毕。
3. 每轮命中数均为 0（候选池为空）。
4. LLM 在 5.3 输出中 `suggestSecondaryReflection=true`。

#### 5.7.2 输入

```typescript
/**
 * Escape hatch 二次反思 LLM 输入
 *
 * 设计约束：
 * - 这是 escape hatch 唯一一次 LLM 调用，必须把已尝试关键词与各轮命中摘要给齐
 * - 不再传递完整上下文包（避免 prompt 膨胀），只传递原意图摘要
 */
interface CandidateSecondaryReflectionLlmInput {
  /** 用户原始意图摘要（来自意图解析的 reasoning） */
  userIntentSummary: string
  /** 用户原始节目线索 */
  originalKeyword: string
  /** 当前播单类型 */
  playlistType: 'tv' | 'rotation'
  /** 已尝试过的所有关键词列表（含原词与各策略关键词） */
  triedKeywords: string[]
  /** 各轮命中摘要（关键词 / 策略标签 / 命中数 / 候选样本） */
  attemptedSummaries: Array<{
    keyword: string
    strategy: string
    candidateCount: number
    sampleNames: string[]
  }>
}
```

#### 5.7.3 输出

```typescript
/**
 * Escape hatch 二次反思 LLM 输出
 */
interface CandidateSecondaryReflectionLlmOutput {
  /**
   * 二次反思生成的新关键词策略组合
   *
   * - 若 LLM 认为还有思路，返回新的 keywordStrategies（结构与 5.3 一致，但 strategy 可省略 original）
   * - 若 LLM 认为已无更多思路，返回空数组
   */
  keywordStrategies: Array<{
    strategy: 'typo_fix' | 'decompose' | 'paraphrase' | 'column_demote' | 'broaden'
    keywords: string[]
    reason: string
  }>
  /**
   * 是否还有更多思路（false 时本地不再尝试，直接暴露失败）
   */
  hasMoreIdeas: boolean
  /** LLM 对二次反思的总结说明（中文，用于 trace 和失败暴露） */
  reasoning: string
}
```

#### 5.7.4 Prompt 骨架（示意）

```text
你是一位经验丰富的电视频道编排人员。之前在意图解析阶段生成的所有关键词组合均 0 命中，现在请基于已尝试结果做一次二次反思。

用户原始意图：{userIntentSummary}
用户原始线索：{originalKeyword}
播单类型：{playlistType}
已尝试关键词：{triedKeywords}
各轮命中情况：{attemptedSummaries}

请基于已尝试结果思考：
1. 之前的关键词是否遗漏了某个维度（如错别字修复、栏目别名、主题近义词）？
2. 是否需要更激进的放宽（如去掉栏目约束、去掉主题约束）？
3. 是否确实无更多合理关键词可尝试？

约束：
- 只生成关键词，不要发明节目名候选。
- 不要重复已尝试关键词。
- 若你认为已无更多思路，返回 keywordStrategies=[] 且 hasMoreIdeas=false。
- 这是 escape hatch 唯一一次调用，请尽量给出可尝试的新关键词。

返回 JSON：{keywordStrategies, hasMoreIdeas, reasoning}
```

#### 5.7.5 失败暴露

- LLM 返回非合法 JSON → 视为 escape hatch 失败，记录 trace，不假装理解，直接暴露 `needs_clarification`。
- LLM 返回 `hasMoreIdeas=false` 或 `keywordStrategies=[]` → 不再尝试，暴露失败。
- LLM 返回的关键词全部与 `triedKeywords` 重复 → 本地去重后为空，不再尝试，暴露失败。
- escape hatch 二次反思生成的新关键词仍 0 命中 → 不再触发二次反思（最多 1 次），暴露失败。

---

## 6. 数据流与状态

### 6.1 重试状态结构

沿用并扩展现有 `CandidateSearchAttempt` / `CandidatePoolResolution` 结构（从 `atomicCommandCapability.ts:97-108` 迁移到 `candidateSearchRetryService.ts`）：

```typescript
/**
 * 单轮检索尝试记录
 */
interface CandidateSearchAttempt {
  /** 本轮使用的关键词 */
  keyword: string
  /**
   * 本轮策略标签（来自 LLM 一次性生成的 keywordStrategies）
   *
   * - primary：首轮原词检索（与 strategyLabel='original' 等价，保留 primary 是为了兼容现有 trace）
   * - llm_strategy_*：LLM 一次性生成的策略标签
   * - secondary_reflection_*：escape hatch 二次反思生成的策略标签
   */
  strategyLabel: 'primary' | 'original' | 'typo_fix' | 'decompose' | 'paraphrase' | 'column_demote' | 'broaden' | 'secondary_reflection_typo_fix' | 'secondary_reflection_decompose' | 'secondary_reflection_paraphrase' | 'secondary_reflection_column_demote' | 'secondary_reflection_broaden'
  /** 本轮命中候选数 */
  candidateCount: number
  /** 本轮命中候选 ID（最多记 8 个，避免膨胀） */
  candidateIds: string[]
  /** 本轮 LLM 给出的策略理由（来自意图解析阶段 LLM 输出的 reason 字段） */
  strategyReason?: string
  /** 本轮轮次（0=首轮原词，1=第一次策略轮询） */
  round: number
}

/**
 * 重试计划（多轮记录，透传到 trace 和 searchRetryPlan）
 */
interface CandidateSearchRetryPlan {
  /** 原始关键词 */
  searchedKeyword: string
  /** 原始关键词拆解 facets */
  searchedFacets: string[]
  /** 候选源状态 */
  candidateSourceStatus: string
  /** 候选源记录数 */
  candidateRecordCount: number
  /** LLM 一次性生成的关键词策略组合（用于 trace 与失败暴露） */
  keywordStrategies: Array<{
    strategy: string
    keywords: string[]
    reason: string
  }>
  /** 每轮尝试记录 */
  searchAttempts: CandidateSearchAttempt[]
  /** 合并去重后的建议关键词（用于失败时给用户参考） */
  suggestedKeywords: string[]
  /** 是否触发了 escape hatch 二次反思 */
  triggeredSecondaryReflection: boolean
  /** 终止原因 */
  terminationReason: 'satisfied' | 'max_round' | 'all_strategies_exhausted' | 'llm_invalid' | 'user_cancel' | 'secondary_reflection_no_more' | 'secondary_reflection_invalid'
  /** 下一动作建议（失败时为 needs_clarification） */
  nextAction: 'rewrite_keywords_and_retry' | 'proceed_to_selection' | 'needs_clarification'
}
```

### 6.2 数据流

主路径：意图解析阶段一次性生成多组带策略标签的关键词 → 本地检索循环按策略优先级轮询 → 累积候选池 →（可选）escape hatch 二次反思 → 候选选择。

```
0. 意图解析阶段（llmAgentIntentInterpreter 内）：
   a. LLM 在意图解析调用中同步返回 keywordStrategies
      [{strategy, keywords, reason}, ...] + suggestSecondaryReflection + reasoning
   b. 本地校验：
      - 必须含 original + 至少 1 个其它策略，否则视为无效
      - 关键词去重、长度校验
   c. 校验通过 → keywordStrategies 透传到 candidateSearchRetryService
   d. 校验失败 → 仅用 original 发起首轮检索，不进入重试循环

1. candidateService.queryCandidatesWithRetry(gap, criteria, retryConfig, keywordStrategies)
2. 首轮：用 keywordStrategies 中 strategy='original' 的 keywords 调 queryCandidates
   → 记录 attempt(round=0, strategyLabel='original')
3. 判断触发条件：
   - 命中 0 或 < minCandidateThreshold 且 keywordStrategies 中仍有未尝试策略 → 进入重试
4. 重试循环（本地检索循环，round = 1..maxRound）：
   a. 按策略优先级取出下一个未尝试的 strategy 组合：
      original → typo_fix → decompose → paraphrase → column_demote → broaden
   b. 对该组 keywords 调 queryCandidates（带原 criteria，替换 searchKeywords）
   c. 合并候选到 pool（按 programCode 去重）
   d. 记录 attempt(round, strategyLabel=<策略标签>, strategyReason=<LLM reason>)
   e. 上报 SSE 进度："查节目库-重试N（策略标签）"
   f. 判断终止：候选足够 / 所有策略用完 / 达上限 → 终止
5.（可选 escape hatch）所有 LLM 关键词均 0 命中且 enableSecondaryReflection=true 且 suggestSecondaryReflection=true：
   a. 调 candidateSearchRetryService.runSecondaryReflection(input)
      → LLM 返回新 keywordStrategies + hasMoreIdeas
   b. 本地校验：去重、不与 triedKeywords 重复、hasMoreIdeas=true
   c. 对新 keywordStrategies 按策略优先级本地检索循环（同 4，最多 1 次）
   d. 记录 attempt(round, strategyLabel='secondary_reflection_*')
6. 终止后：
   - 候选足够 → 返回 CandidateQueryResult（含 searchRetryPlan）→ 进入候选选择
   - 候选仍 0/不足 → 返回空结果 + searchRetryPlan(nextAction=needs_clarification) → 暴露失败
```

### 6.3 SSE 流式进度上报

复用现有 trace + `processTypeLabel` 机制（`demoRuntimeFacade.ts:5065`），新增分支：

| trace label | processTypeLabel | 触发时机 | 气泡内容示例 |
| --- | --- | --- | --- |
| 调用节目查询服务查找候选 | 查节目库 | 首轮检索开始（strategyLabel=original） | 正在按 看东房 查节目库，位置按 06:00:00。 |
| 候选查询完成 | 查节目库 | 首轮检索完成（0 候选不推） | 已查到 0 个候选期次。 |
| 候选重试查询 | 查节目库-重试1（typo_fix） | 第 1 轮策略轮询开始（typo_fix） | 关键词太死没查到，正在尝试 看东方（错别字修复）重新查节目库。 |
| 候选重试查询 | 查节目库-重试2（decompose） | 第 2 轮策略轮询开始（decompose） | 仍在扩展检索，正在尝试 上海 / 旅游 / 短片（拆字）查节目库。 |
| 候选重试查询 | 查节目库-重试3（column_demote） | 第 3 轮策略轮询开始（column_demote） | 仍在扩展检索，正在尝试 东方快报（栏目降级）查节目库。 |
| 候选查询完成 | 查节目库 | 每轮策略轮询完成（0 候选不推） | 已查到 3 个候选期次。 |
| 候选二次反思 | 二次反思 | escape hatch 二次反思触发（可选） | 所有关键词都没查到，正在让模型反思是否还有其它思路。 |
| 候选重试查询 | 查节目库-二次反思 | 二次反思生成的新关键词检索开始 | 模型反思后建议尝试 东方新闻，正在重新查节目库。 |
| 候选检索终止 | 查节目库 | 重试终止 | 已尝试 4 组关键词，仍未命中，需要你确认节目名。 |
| LLM 候选决策完成 | 候选决策 | 进入候选选择（沿用现有） | （沿用现有） |

约束：

- 0 候选的轮次不推"候选查询完成"气泡（沿用 `demoRuntimeFacade.ts:5081` 现有约束）。
- 重试开始气泡必须说明"关键词太死没查到"或"仍在扩展检索"，并附带策略标签（如"错别字修复"/"拆字"/"栏目降级"），让编排人员理解为何重试以及当前策略。
- 二次反思气泡在 escape hatch 关闭时不出现。
- 终止气泡在失败时必须包含已尝试关键词数和"需要你确认"的暴露失败语义。

#### 6.3.1 一条条信息流式展示（硬约束）

重试过程的 SSE 进度必须是"一条条信息流式展示"，不允许批量一次性推送。具体硬约束：

1. **每条气泡独立推送**：每一轮检索（首次 / 重试N / 二次反思 / 终止）都是独立的 SSE event，必须单独推送，不能合并成一条批量消息。例如"查节目库-首次 → 查节目库-重试1（typo_fix）→ 查节目库-重试2（decompose）"必须是 3 条独立气泡，不能合并为"已尝试 3 组关键词"。
2. **真实等待时间**：每条气泡之间必须有真实的等待时间（等待该轮检索或 LLM 反思实际完成），不能伪造延迟，也不能跳过等待直接推送下一条。等待时间来源于：
   - 首轮检索：等待 `candidateService.queryCandidates` 实际返回。
   - 重试轮检索：等待该轮 `queryCandidates` 实际返回。
   - 二次反思：等待 LLM `runSecondaryReflection` 实际返回。
3. **表现过程**：用户必须能"看到"重试过程，而不是只看到最终结果。气泡序列必须能反映"首次没查到 → 正在尝试错别字修复 → 命中"这样的过程感。
4. **与 project_memory 对齐**：沿用 project_memory 中"SSE 流式（path A）需要实时进度展示，避免 path B 批量进度展示"的硬约束。重试进度必须走 SSE 流式（path A），不能走 HTTP 批量（path B）。
5. **气泡时序保证**：每条气泡在对应轮次"开始时"推送开始气泡（如"正在尝试 看东方（错别字修复）重新查节目库"），在"完成时"推送完成气泡（如"已查到 3 个候选期次"），0 候选完成气泡不推。开始气泡与完成气泡之间有真实检索等待时间。
6. **取消信号**：用户可在任意气泡阶段通过 SSE 取消信号中止重试（本阶段可选实现，但协议预留）。

---

## 7. 接口设计

### 7.1 新增 `src/services/agent/candidateSearchRetryService.ts`

```typescript
/**
 * 节目检索重试编排服务
 *
 * 职责：
 * - generateKeywordStrategies：封装 LLM 在意图解析阶段一次性生成多组带策略标签的关键词
 * - executeRetryLoop：本地检索循环（按策略优先级轮询，不再调 LLM）
 * - runSecondaryReflection：可选 escape hatch 二次反思（最多 1 次）
 * - 记录每轮 attempts 与 searchRetryPlan
 * - 判断终止条件，暴露失败（不假装理解）
 *
 * 设计约束（AGENTS.md）：
 * - 本地只做去重、长度校验、轮次上限、结构校验、失败暴露
 * - 错别字修复、拆字、二次理解全部由 LLM 在意图解析阶段一次性完成
 * - 重试阶段不调 LLM（escape hatch 二次反思除外）
 */
export interface CandidateSearchRetryService {
  /**
   * 封装 LLM 在意图解析阶段一次性生成多组带策略标签的关键词
   *
   * 实际 LLM 调用发生在 llmAgentIntentInterpreter 内，本方法负责：
   * - 把意图解析结果中的 keywordStrategies 字段提取出来
   * - 本地校验：必须含 original + 至少 1 个其它策略，关键词去重、长度校验
   * - 校验通过 → 返回 keywordStrategies
   * - 校验失败 → 返回仅含 original 的退化结构（首轮仍可正常检索，不进入重试循环）
   *
   * @param intentResult 意图解析 LLM 返回结果（含 keywordStrategies 字段）
   * @returns 校验后的 keywordStrategies（至少含 original）
   */
  generateKeywordStrategies(
    intentResult: AgentIntentResult,
  ): CandidateKeywordStrategy[]

  /**
   * 本地检索循环（按策略优先级轮询，不再调 LLM）
   *
   * 流程：
   * - 按 original → typo_fix → decompose → paraphrase → column_demote → broaden 优先级依次检索
   * - 每轮检索结果累积到候选池，按 programCode 去重
   * - 命中足够（≥ minCandidateThreshold）或所有策略用完或达 maxRound 时停止
   * - 记录每轮 attempt（含 strategyLabel、strategyReason）
   *
   * @param gap 时段信息
   * @param criteria 查询条件
   * @param keywordStrategies LLM 一次性生成的关键词策略组合
   * @param retryConfig 重试配置
   * @param onAttempt 每轮检索回调（用于 SSE 进度上报）
   * @returns 重试结果（候选池 + searchRetryPlan）
   */
  executeRetryLoop(
    gap: GapInfo,
    criteria: CandidateQueryCriteria,
    keywordStrategies: CandidateKeywordStrategy[],
    retryConfig: CandidateSearchRetryConfig,
    onAttempt?: (attempt: CandidateSearchAttempt) => void,
  ): Promise<{
    candidates: ProgramCandidate[]
    searchRetryPlan: CandidateSearchRetryPlan
  }>

  /**
   * 可选 escape hatch 二次反思
   *
   * 仅当 enableSecondaryReflection=true 且所有 keywordStrategies 均 0 命中且
   * LLM suggestSecondaryReflection=true 时触发，最多 1 次。
   *
   * @param input 二次反思 LLM 输入（原意图 + 已尝试词 + 各轮命中摘要）
   * @returns 二次反思 LLM 输出（新 keywordStrategies + hasMoreIdeas）
   *          LLM 返回非法时抛出 CandidateSecondaryReflectionError，由调用方暴露失败
   */
  runSecondaryReflection(
    input: CandidateSecondaryReflectionLlmInput,
  ): Promise<CandidateSecondaryReflectionLlmOutput>

  /**
   * 本地校验并去重 keywordStrategies
   *
   * 仅做保护性校验：
   * - 去除空串、长度 < 2 的关键词
   * - 与 triedKeywords 归一化去重
   * - 同一策略标签内关键词去重
   * 不改写关键词本身
   *
   * @param keywordStrategies LLM 返回的关键词策略组合
   * @param triedKeywords 已尝试关键词
   * @returns 校验后可用的关键词策略组合（可能为空，空则触发终止）
   */
  sanitizeKeywordStrategies(
    keywordStrategies: CandidateKeywordStrategy[],
    triedKeywords: string[],
  ): CandidateKeywordStrategy[]

  /**
   * 判断是否应继续重试
   *
   * 本地保护性判断（不改写 LLM 决策）：
   * - 已达 maxRound → false
   * - keywordStrategies 中所有策略均已尝试 → false
   * - 候选已足够（命中数 ≥ minCandidateThreshold）→ false
   * - 其余 → true
   */
  shouldContinueRetry(
    currentRound: number,
    maxRound: number,
    remainingStrategies: CandidateKeywordStrategy[],
    currentCandidateCount: number,
    minCandidateThreshold: number,
  ): boolean

  /**
   * 构造重试计划记录（透传到 trace 和 searchRetryPlan）
   */
  buildSearchRetryPlan(
    originalKeyword: string,
    searchedFacets: string[],
    keywordStrategies: CandidateKeywordStrategy[],
    attempts: CandidateSearchAttempt[],
    candidateSourceStatus: string,
    candidateRecordCount: number,
    triggeredSecondaryReflection: boolean,
    terminationReason: CandidateSearchRetryPlan['terminationReason'],
    nextAction: CandidateSearchRetryPlan['nextAction'],
  ): CandidateSearchRetryPlan
}

/**
 * 单个关键词策略组合（来自 LLM 一次性生成）
 */
interface CandidateKeywordStrategy {
  /** 策略标签 */
  strategy: 'original' | 'typo_fix' | 'decompose' | 'paraphrase' | 'column_demote' | 'broaden'
  /** 该策略下的关键词组合 */
  keywords: string[]
  /** LLM 给出的理由 */
  reason: string
}
```

### 7.2 `src/services/candidateService.ts` 新增接口

```typescript
/**
 * 带重试的候选查询
 *
 * 在 queryCandidates 基础上叠加多轮关键词组合重试：
 * - 首轮用 keywordStrategies 中 strategy='original' 的 keywords 查询
 * - 命中 0 或 < minCandidateThreshold 时，调 candidateSearchRetryService.executeRetryLoop
 *   按 strategy 优先级本地轮询其它策略关键词
 * - 合并去重候选，记录 searchRetryPlan
 *
 * @param gap 时段信息
 * @param criteria 查询条件（首轮使用）
 * @param options 重试选项（含 keywordStrategies 与 retryConfig）
 *                keywordStrategies 来自意图解析阶段 LLM 一次性生成
 * @returns 候选查询结果，含 searchRetryPlan 透传字段
 */
async queryCandidatesWithRetry(
  gap: GapInfo,
  criteria: CandidateQueryCriteria,
  options?: {
    keywordStrategies?: CandidateKeywordStrategy[]
    retryConfig?: CandidateSearchRetryConfig
  },
): Promise<CandidateQueryResult & { searchRetryPlan?: CandidateSearchRetryPlan }>

/**
 * 带关键词扩展的节目名检索
 *
 * 在 searchPrograms 基础上叠加多轮关键词组合重试：
 * - 首轮用 keywordStrategies 中 strategy='original' 的 keywords 检索
 * - 0 命中时调 candidateSearchRetryService.executeRetryLoop 按 strategy 优先级本地轮询
 * - 合并去重候选
 *
 * 用于 UI 直查路径（create.vue / ScheduleItemDialog.vue）
 *
 * @param params 节目检索参数（首轮使用）
 * @param options 重试选项（含 keywordStrategies 与 retryConfig）
 * @returns 合并去重后的候选列表
 */
async searchProgramsWithKeywordExpansion(
  params: ProgramSearchParams,
  options?: {
    keywordStrategies?: CandidateKeywordStrategy[]
    retryConfig?: CandidateSearchRetryConfig
  },
): Promise<ProgramCandidate[]>
```

### 7.3 重试配置

```typescript
/**
 * 节目检索重试配置
 */
interface CandidateSearchRetryConfig {
  /** 是否启用重试（默认 true） */
  enabled: boolean
  /** 最大重试次数（默认 3，硬上限 5） */
  maxRound: number
  /** 最小候选阈值，低于此值触发重试（默认 1） */
  minCandidateThreshold: number
  /** 播单类型，影响 LLM 策略偏好 */
  playlistType: 'tv' | 'rotation'
  /** 是否启用 SSE 进度上报（默认 true） */
  enableProgressReporting: boolean
  /**
   * 是否启用 escape hatch 二次反思（默认 false）
   *
   * - false：所有 LLM 一次性生成的关键词都 0 命中时，直接暴露 needs_clarification
   * - true：所有 LLM 关键词都 0 命中且 LLM suggestSecondaryReflection=true 时，
   *        触发一次二次反思 LLM 调用，生成新关键词再尝试
   */
  enableSecondaryReflection: boolean
  /**
   * 二次反思最大触发次数（默认 1，硬上限 1，防止无限循环）
   */
  maxReflections: number
}

/** 默认配置（电视播单） */
const DEFAULT_TV_RETRY_CONFIG: CandidateSearchRetryConfig = {
  enabled: true,
  maxRound: 3,
  minCandidateThreshold: 1,
  playlistType: 'tv',
  enableProgressReporting: true,
  enableSecondaryReflection: false,
  maxReflections: 1,
}

/** 默认配置（轮播单，阈值可适当调高扩大选择面） */
const DEFAULT_ROTATION_RETRY_CONFIG: CandidateSearchRetryConfig = {
  enabled: true,
  maxRound: 3,
  minCandidateThreshold: 2,
  playlistType: 'rotation',
  enableProgressReporting: true,
  enableSecondaryReflection: false,
  maxReflections: 1,
}
```

### 7.4 调用点改造范围

| 调用点 | 当前接口 | 改造后接口 | 改造阶段 |
| --- | --- | --- | --- |
| `src/services/agent/llmAgentIntentInterpreter.ts:133` searchAlternatives 生成 | LLM 返回 2-5 个 searchAlternatives（无策略标签，"when helpful" 非强制） | LLM 返回 keywordStrategies（带 strategy/keywords/reason + suggestSecondaryReflection），强制最少 original + 1 个其它策略 | 阶段 2 |
| `src/services/agent/types.ts:70` searchAlternatives 字段 | string[] | 扩展为 keywordStrategies 结构（保留旧字段以兼容，新字段优先） | 阶段 2 |
| `src/services/agent/runtimeSchedulingDataGateway.ts:134` readProgramCandidates | reader.getProgramCandidates | reader.getProgramCandidates（内部走 queryCandidatesWithRetry，接收 keywordStrategies） | 阶段 3 |
| `src/services/agent/atomicCommandCapability.ts:4144` resolveCandidatePool | 本地过滤重试 | 调 candidateSearchRetryService.executeRetryLoop + 保留本地过滤 | 阶段 1+2 |
| `src/services/orchestrator.ts:820` 自动编排调用点 | queryCandidates | queryCandidatesWithRetry（接收 keywordStrategies） | 阶段 4 |
| `src/services/runtime/demoRuntimeFacade.ts:1115` 草案预检调用点 | queryCandidates / searchPrograms | queryCandidatesWithRetry / searchProgramsWithKeywordExpansion | 阶段 4 |
| `src/views/broadcast-plan/create.vue:1838` UI 调用点 | searchPrograms | searchProgramsWithKeywordExpansion | 阶段 5 |
| `src/views/broadcast-plan/components/ScheduleItemDialog.vue:379` UI 调用点 | searchPrograms | searchProgramsWithKeywordExpansion | 阶段 5 |

---

## 8. 改造步骤（分阶段）

每个阶段独立可验证、可回滚。每个阶段结束后运行对应验证门禁。

### 阶段 1：抽取 atomicCommandCapability 现有重试函数到独立模块（纯重构）

**目标**：把 `resolveCandidatePool` / `buildCandidateRetryKeywords` / `buildCandidateSearchRetryPlan` / `CandidateSearchAttempt` / `CandidatePoolResolution` 从 `atomicCommandCapability.ts` 抽取到 `src/services/agent/candidateSearchRetryService.ts`。

**约束**：纯重构，不改行为，不改 LLM 协议。atomic_command 路径调用新模块，结果与原实现完全一致。

**验证**：
- 运行 atomic_command 相关 Vitest case，全部通过。
- `npm run agent:check` 通过。

**回滚**：直接还原 `atomicCommandCapability.ts`，删除新模块。

### 阶段 2：扩展 llmAgentIntentInterpreter 的 searchAlternatives 输出（带策略标签 + 理由 + 强制最少 2 组）

**目标**：在 `src/services/agent/llmAgentIntentInterpreter.ts:133` 的意图解析 LLM 协议中，把 `searchAlternatives` 扩展为 `keywordStrategies`：

- 每组关键词附带 strategy 标签（original / typo_fix / decompose / paraphrase / column_demote / broaden）。
- 每组关键词附带 reason 字段（"为什么这组可能命中"的简短理由）。
- 增加 suggestSecondaryReflection 标志（仅在 enableSecondaryReflection=true 时有意义）。
- 移除 "when helpful" 软引导，强制 LLM 至少返回 original + 1 个其它策略。
- 同步更新 `src/services/agent/types.ts:70` 的类型定义（保留旧 `searchAlternatives` 字段以兼容，新 `keywordStrategies` 字段优先）。

**约束**：
- LLM-only：策略标签、关键词、理由全部由 LLM 在意图解析阶段一次性生成，本地不做任何关键词改写或策略补充。
- 本地仅做结构校验：必须含 original + 至少 1 个其它策略，关键词去重、长度校验。校验失败时仅保留 original（首轮仍可检索，不进入重试循环）。
- prompt 必须明确"这是唯一一次关键词策略生成机会，重试阶段不会再调 LLM"。
- prompt 必须明确错别字修复由 LLM 完成。
- 不改变现有意图解析其它字段（command / draft / reasoning 等）。

**验证**：
- 新增 Vitest case 覆盖：LLM 返回完整 keywordStrategies（含 original + typo_fix + decompose）、LLM 只返回 original（退化）、LLM 返回非法 JSON（暴露失败）。
- `npm run agent:check` 通过（确保意图解析链路不退化）。
- 浏览器冒烟（http://localhost:5173）：对话输入"在06点插入看东房"，观察意图解析阶段 LLM 返回的 keywordStrategies（通过 trace 验证）。

**回滚**：还原 `llmAgentIntentInterpreter.ts` 与 `types.ts`，删除新增字段。

### 阶段 3：在 candidateService 新增 queryCandidatesWithRetry / searchProgramsWithKeywordExpansion（接收 keywordStrategies，本地检索循环）

**目标**：在 `candidateService.ts` 新增重试封装接口，接收 `keywordStrategies`，内部通过 `candidateSearchRetryService.executeRetryLoop` 按策略优先级本地轮询 `queryCandidates` / `searchPrograms`。

**约束**：
- 重试阶段不再调 LLM（escape hatch 二次反思除外，本阶段不接入 escape hatch）。
- 按策略优先级 original → typo_fix → decompose → paraphrase → column_demote → broaden 依次检索。
- 默认 3 次，最大 5 次。
- 记录 `searchRetryPlan` 透传到结果，含每轮 strategyLabel。
- 此阶段不接入调用点，仅提供能力 + 单测。

**验证**：
- 新增 Vitest case 覆盖：original 0 命中后按策略轮询命中、所有策略 0 命中暴露失败、达上限终止、候选足够提前终止。
- `npm run agent:check` 通过。

**回滚**：删除新增接口，不影响现有调用点。

### 阶段 4：runtimeSchedulingDataGateway 接入，让 Agent 主链路自动获得重试

**目标**：`readProgramCandidates` 内部把 `reader.getProgramCandidates` 的实现切换为走 `queryCandidatesWithRetry`，接收意图解析阶段产出的 `keywordStrategies`，Agent 主链路（atomic_command）自动获得外部重试能力。

**约束**：
- `resolveCandidatePool` 保留本地过滤（对内存候选池），新增外部重试（对 candidateService）。
- 重试触发的 SSE 进度通过 trace 上报。
- 顺播硬约束（next=max+1）不被重试破坏：重试只扩大候选池，顺播筛选仍在候选选择阶段由 guard 保证。
- `keywordStrategies` 从意图解析结果透传到 `readProgramCandidates`，不再在重试阶段生成。

**验证**：
- `npm run agent:check` 全链路通过。
- 顺播场景 case：重试后候选池扩大，但顺播 next=max+1 仍由 guard 强制。
- 浏览器冒烟（http://localhost:5173）：用"看东房"触发重试，观察 SSE 气泡（含策略标签）。

**回滚**：`readProgramCandidates` 切回原 `reader.getProgramCandidates`。

### 阶段 5：orchestrator / demoRuntimeFacade 调用点迁移

**目标**：`orchestrator.ts:820` 自动编排调用点、`demoRuntimeFacade.ts:1115` 草案预检调用点迁移到 `queryCandidatesWithRetry`，接收意图解析阶段产出的 `keywordStrategies`。

**约束**：
- 自动编排（长流程）本阶段不作为原子命令接入目标，但其内部检索调用点可平滑迁移到带重试接口（行为向上兼容，候选只会变多不会变少）。
- 草案预检迁移后需验证草案完整度判断不被重试延迟拖垮（重试阶段无 LLM 调用，延迟可控）。

**验证**：
- `npm run agent:check` 通过。
- 草案预检相关 case 通过。
- 浏览器冒烟：自动编排路径触发重试时 SSE 正常。

**回滚**：调用点切回 `queryCandidates`。

### 阶段 6：UI 调用点迁移（create.vue / ScheduleItemDialog.vue）

**目标**：`create.vue:1838`、`ScheduleItemDialog.vue:379` 的 UI 直查路径迁移到 `searchProgramsWithKeywordExpansion`。

**约束**：
- UI 直查路径重试进度通过现有 UI loading 状态展示（不强制 SSE，因 UI 直查可能不走 Agent session）。
- 重试次数默认 3 次，避免 UI 长时间等待。
- 0 命中时 UI 展示"已尝试 N 组关键词仍未命中，请确认节目名"。
- UI 直查路径若无意图解析阶段（用户直接在搜索框输入），需在 UI 直查入口处单独触发一次 LLM 关键词策略生成（封装为独立调用，不影响 Agent 主链路）。

**验证**：
- UI 直查相关 Vitest case 通过。
- 浏览器冒烟：UI 搜索框输入"看东房"，观察重试后命中"看东方"。

**回滚**：UI 调用点切回 `searchPrograms`。

### 阶段 7：进度上报接入 SSE 流式

**目标**：把重试过程的 trace label（"候选重试查询（策略标签）"/"候选检索终止"）接入 `demoRuntimeFacade` 的 SSE 气泡分支，新增 `processTypeLabel` 分支"查节目库-重试N（策略标签）"。

**约束**：
- 0 候选轮次不推"候选查询完成"气泡（沿用现有约束）。
- 重试开始气泡必须附带策略标签（如"错别字修复"/"拆字"/"栏目降级"），让编排人员理解当前策略。
- 终止气泡在失败时必须暴露失败语义。
- SSE 推送必须实时（沿用现有 `agentServerRuntime.ts:236` eventLog 机制）。

**验证**：
- 浏览器冒烟（http://localhost:5173）：触发重试时实时观察"查节目库-重试1（typo_fix）/重试2（decompose）"气泡。
- `npm run agent:check` 通过。

**回滚**：删除新增 SSE 分支，重试仍走 trace 记录但不推气泡。

### 阶段 8（可选）：escape hatch 二次反思接入

**目标**：在 `candidateSearchRetryService` 实现 `runSecondaryReflection`，并在 `executeRetryLoop` 终止前判断是否触发 escape hatch（默认关闭，通过 `enableSecondaryReflection` 配置控制）。

**约束**：
- 仅当 `enableSecondaryReflection=true` 且所有 `keywordStrategies` 均 0 命中且 LLM `suggestSecondaryReflection=true` 时触发。
- 最多触发 1 次（`maxReflections=1`，硬上限），防止无限循环。
- 二次反思 LLM 协议见 5.7。
- 二次反思生成的新 `keywordStrategies` 按策略优先级本地检索循环（同主路径）。
- 二次反思仍 0 命中 → 暴露失败，不再触发二次反思。
- 二次反思触发时通过 SSE 上报"二次反思"气泡。

**验证**：
- 新增 Vitest case 覆盖：escape hatch 关闭 + 全 0 命中 → 直接暴露失败；escape hatch 开启 + 全 0 命中 + suggestSecondaryReflection=true → 二次反思生成新关键词命中；escape hatch 开启 + 二次反思仍 0 命中 → 暴露失败；escape hatch 开启 + LLM 返回 hasMoreIdeas=false → 暴露失败。
- `npm run agent:check` 通过。
- 浏览器冒烟：开启 escape hatch 配置后，用"不存在的栏目XYZ"触发重试，观察"二次反思"气泡。

**回滚**：删除 `runSecondaryReflection` 实现，`enableSecondaryReflection` 强制为 false。

---

## 9. Case 设计

### 9.1 LLM 一次性返回 original + typo_fix + decompose 三组，本地按优先级轮询，第二组命中（新增核心 case）

- **场景**：用户输入"看东房"，节目库中有"看东方"。
- **意图解析阶段**：LLM 一次性返回 `keywordStrategies`：
  - `{strategy:'original', keywords:['看东房'], reason:'用户原词'}`
  - `{strategy:'typo_fix', keywords:['看东方'], reason:'疑似错别字，房→方'}`
  - `{strategy:'decompose', keywords:['看','东房'], reason:'拆字兜底'}`
  - `suggestSecondaryReflection=false`
- **本地检索循环**：
  - round=0（strategyLabel=original）：用"看东房"检索 → 0 命中。
  - round=1（strategyLabel=typo_fix）：用"看东方"检索 → 命中"看东方"。
  - 候选足够，终止。
- **断言**：
  - 候选池含"看东方"。
  - `searchRetryPlan.searchAttempts` 有 2 轮记录，`searchAttempts[0].strategyLabel='original'`，`searchAttempts[1].strategyLabel='typo_fix'`。
  - `searchAttempts[1].strategyReason='疑似错别字，房→方'`。
  - `terminationReason='satisfied'`，`nextAction='proceed_to_selection'`。
  - `searchRetryPlan.keywordStrategies` 含 3 组策略（含未尝试的 decompose）。
  - `searchRetryPlan.triggeredSecondaryReflection=false`。

### 9.2 错别字 0 命中 → LLM 在意图解析阶段一次性生成 typo_fix 策略，本地轮询命中（保留并调整）

- **场景**：用户输入"看东房"，节目库中有"看东方"，LLM 只返回 original + typo_fix 两组。
- **意图解析阶段**：LLM 一次性返回 `keywordStrategies`：
  - `{strategy:'original', keywords:['看东房'], reason:'用户原词'}`
  - `{strategy:'typo_fix', keywords:['看东方'], reason:'错别字修复'}`
- **本地检索循环**：
  - round=0（original）：0 命中。
  - round=1（typo_fix）：命中"看东方"。
- **断言**：候选池含"看东方"，`searchAttempts[1].strategyLabel='typo_fix'`，`searchAttempts[1].strategyReason='错别字修复'`。

### 9.3 关键词太死 0 命中 → LLM 在意图解析阶段一次性生成 decompose 策略，本地轮询命中（保留并调整）

- **场景**：用户输入"上海旅游宣传片"，节目库中有"上海风光短片"。
- **意图解析阶段**：LLM 一次性返回 `keywordStrategies`：
  - `{strategy:'original', keywords:['上海旅游宣传片'], reason:'用户原词'}`
  - `{strategy:'decompose', keywords:['上海','旅游','短片'], reason:'拆字为上海+旅游+短片'}`
- **本地检索循环**：
  - round=0（original）：0 命中。
  - round=1（decompose）：用"上海 / 旅游 / 短片"检索 → 命中"上海风光短片"。
- **断言**：候选池含"上海风光短片"，`searchAttempts[1].strategyLabel='decompose'`，`terminationReason='satisfied'`。

### 9.4 栏目降级重试命中 → LLM 在意图解析阶段一次性生成 column_demote 策略（保留并调整）

- **场景**：用户输入"东方快报 第10期"，节目库有"东方快报"但无第10期。
- **意图解析阶段**：LLM 一次性返回 `keywordStrategies`：
  - `{strategy:'original', keywords:['东方快报 第10期'], reason:'用户原词'}`
  - `{strategy:'column_demote', keywords:['东方快报'], reason:'栏目降级，去掉期数约束'}`
- **本地检索循环**：
  - round=0（original）：0 命中。
  - round=1（column_demote）：用"东方快报"检索 → 命中多期。
- **断言**：候选池含"东方快报"多期，`searchAttempts[1].strategyLabel='column_demote'`。

### 9.5 候选不足 → 触发本地轮询扩展候选池（保留并调整）

- **场景**：轮播单，用户输入"纪录片"，首轮命中 1 个（< 阈值 2）。
- **意图解析阶段**：LLM 一次性返回 `keywordStrategies`：
  - `{strategy:'original', keywords:['纪录片'], reason:'用户原词'}`
  - `{strategy:'paraphrase', keywords:['纪实','纪录片系列'], reason:'近义改写'}`
- **本地检索循环**：
  - round=0（original）：命中 1 个（< 阈值 2）。
  - round=1（paraphrase）：用"纪实 / 纪录片系列"检索 → 命中 3 个。
  - 候选足够，终止。
- **断言**：候选池含 3 个，`terminationReason='satisfied'`。

### 9.6 LLM 决策失败 → 暴露 needs_selection（保留）

- **场景**：本地轮询后候选池有 3 个，但 LLM 候选决策（candidateJudge）返回 `unable_to_decide`。
- **断言**：沿用现有 `needs_selection` 约束，不本地兜底选择。

### 9.7 顺播场景重试不能破坏 next=max+1 硬约束（保留并调整）

- **场景**：电视播单，连续剧顺播，用户输入"某剧 第5期"，LLM 一次性返回 original + column_demote 两组。
- **本地检索循环**：
  - round=0（original）：0 命中。
  - round=1（column_demote）：用"某剧"检索 → 命中第5期+第6期。
- **断言**：候选池含第5、6期，但 guard 强制 next=max+1（已排到第4期则只能选第5期），本地轮询不绕过顺播 guard。

### 9.8 电视播单 vs 轮播单的策略差异（保留并调整）

- **电视播单**：LLM 在意图解析阶段倾向保留栏目与顺播连续性，`keywordStrategies` 中 `column_demote` 优先于 `broaden`。
- **轮播单**：LLM 在意图解析阶段倾向内容匹配与收视率，`keywordStrategies` 中 `paraphrase` 优先于 `column_demote`。
- **断言**：两类播单的 `keywordStrategies` 策略分布符合偏好（通过 prompt 引导，非本地强制）；本地轮询顺序仍按 4.4.1 优先级（original → typo_fix → decompose → paraphrase → column_demote → broaden），不因 playlistType 改变。

### 9.9 LLM 一次性生成阶段返回非法 JSON → 暴露失败，仅用 original 检索（调整）

- **场景**：意图解析阶段 LLM 返回非 JSON 或 `keywordStrategies` 缺失。
- **断言**：
  - 视为意图解析阶段关键词策略生成失败，记录 trace。
  - 仅用 original（用户原词）发起首轮检索，不进入重试循环。
  - 首轮 0 命中即暴露 `needs_clarification`，不假装理解。
  - `searchRetryPlan.keywordStrategies` 仅含 original（退化结构），`terminationReason='llm_invalid'`。

### 9.10 LLM 只返回 original 一组 → 退化为首轮单次检索（调整）

- **场景**：LLM 一次性生成阶段返回 `keywordStrategies` 只含 original 一组（违反强制最少策略）。
- **断言**：
  - 视为无效输出，记录 trace。
  - 仅用 original 发起首轮检索，不进入重试循环。
  - 首轮 0 命中即暴露 `needs_clarification`。
  - `terminationReason='llm_invalid'`。

### 9.11 所有 LLM 关键词 0 命中，escape hatch 关闭 → needs_clarification（新增）

- **场景**：用户输入"不存在的栏目XYZ"，节目库无任何匹配。`enableSecondaryReflection=false`。
- **意图解析阶段**：LLM 一次性返回 `keywordStrategies`：
  - `{strategy:'original', keywords:['不存在的栏目XYZ'], reason:'用户原词'}`
  - `{strategy:'paraphrase', keywords:['栏目XYZ'], reason:'去掉修饰词'}`
  - `suggestSecondaryReflection=true`（但因 escape hatch 关闭，本地忽略此标志）
- **本地检索循环**：
  - round=0（original）：0 命中。
  - round=1（paraphrase）：0 命中。
  - 所有策略用完，候选池为空。
- **断言**：
  - 候选池为空。
  - `terminationReason='all_strategies_exhausted'`，`nextAction='needs_clarification'`。
  - `searchRetryPlan.triggeredSecondaryReflection=false`。
  - 不本地兜底硬排，不假装理解。

### 9.12 所有 LLM 关键词 0 命中，escape hatch 开启 → 二次反思生成新关键词命中（新增）

- **场景**：用户输入"看东方 第10期"，节目库有"看东方"但无第10期，LLM 一次性生成的策略均未命中。`enableSecondaryReflection=true`。
- **意图解析阶段**：LLM 一次性返回 `keywordStrategies`：
  - `{strategy:'original', keywords:['看东方 第10期'], reason:'用户原词'}`
  - `{strategy:'column_demote', keywords:['看东方'], reason:'栏目降级'}`
  - `suggestSecondaryReflection=true`
- **本地检索循环**（主路径）：
  - round=0（original）：0 命中。
  - round=1（column_demote）：用"看东方"检索 → 0 命中（节目库索引异常或栏目名拼写差异）。
  - 所有策略用完，候选池为空。
- **escape hatch 二次反思**（满足触发条件）：
  - 调 `runSecondaryReflection`，输入原意图 + 已尝试词 + 各轮命中摘要。
  - LLM 返回新 `keywordStrategies`：`[{strategy:'paraphrase', keywords:['看东方新闻'], reason:'栏目别名'}]`，`hasMoreIdeas=true`。
  - 本地校验通过，按策略优先级本地检索循环：
    - round=2（secondary_reflection_paraphrase）：用"看东方新闻"检索 → 命中"看东方新闻"。
  - 候选足够，终止。
- **断言**：
  - 候选池含"看东方新闻"。
  - `searchRetryPlan.triggeredSecondaryReflection=true`。
  - `searchAttempts[2].strategyLabel='secondary_reflection_paraphrase'`。
  - `terminationReason='satisfied'`。

### 9.13 escape hatch 开启 + 二次反思仍 0 命中 → 暴露失败（新增）

- **场景**：用户输入"不存在的栏目XYZ"，`enableSecondaryReflection=true`，LLM 一次性生成的策略均 0 命中，二次反思生成的新关键词也 0 命中。
- **断言**：
  - 候选池为空。
  - `searchRetryPlan.triggeredSecondaryReflection=true`。
  - `terminationReason='all_strategies_exhausted'`，`nextAction='needs_clarification'`。
  - 不再触发二次反思（最多 1 次），暴露失败。

### 9.14 escape hatch 开启 + LLM 二次反思返回 hasMoreIdeas=false → 暴露失败（新增）

- **场景**：escape hatch 触发后，LLM 二次反思返回 `hasMoreIdeas=false` 且 `keywordStrategies=[]`。
- **断言**：
  - 不再尝试新关键词。
  - `terminationReason='secondary_reflection_no_more'`，`nextAction='needs_clarification'`。
  - 暴露失败，不假装理解。

### 9.15 本地去重后 keywordStrategies 为空 → 终止（调整）

- **场景**：LLM 一次性生成的 `keywordStrategies` 中除 original 外，其它策略的关键词全部与 original 归一化重复。
- **断言**：`sanitizeKeywordStrategies` 后只保留 original，按"只有 original"处理（同 9.10），不进入重试循环。

---

## 10. 验证门禁

### 10.1 Vitest case

新增 case 路径（按阶段补充）：

- `src/services/__tests__/candidateSearchRetryService.test.ts`：覆盖 9.1-9.15 的重试编排逻辑（mock LLM 一次性生成 keywordStrategies + 本地检索循环 + 可选 escape hatch）。
- `src/services/__tests__/candidateService.retry.test.ts`：覆盖 `queryCandidatesWithRetry` / `searchProgramsWithKeywordExpansion` 与底层 `queryCandidates` / `searchPrograms` 的集成（接收 keywordStrategies）。
- `src/services/__tests__/schedulingAgentRuntime.searchRetry.test.ts`：覆盖 Agent 主链路重试触发与 SSE trace 记录（含策略标签）。
- `src/services/__tests__/llmAgentIntentInterpreter.keywordStrategies.test.ts`：覆盖意图解析阶段 LLM 一次性生成 keywordStrategies 的协议与本地校验。
- 复用现有 `src/services/__tests__/schedulingAgentRuntime.nlMatrix.test.ts` 中 `CandidateSearchAttempt` 相关断言，确保迁移后行为一致（注意 strategyLabel 字段替换 source 字段）。

### 10.2 agent:check 链路验证

每个阶段结束运行：

```bash
npm run agent:check
```

重点验证：

- atomic_command 链路重试行为不退化。
- 顺播硬约束不被重试破坏。
- 失败暴露链路（needs_clarification / needs_selection）正常。

### 10.3 浏览器冒烟

刷新 `http://localhost:5173`，在 Codex in-app browser 中验证：

1. **错别字重试**：对话输入"在06点插入看东房"，观察 SSE 气泡"查节目库-重试1（typo_fix）"出现，最终命中"看东方"。
2. **栏目降级重试**：对话输入"在06点插入东方快报第10期"，观察重试气泡（含 column_demote 策略标签），最终命中"东方快报"多期，进入候选选择。
3. **重试失败暴露（escape hatch 关闭）**：对话输入"在06点插入不存在的栏目XYZ"，观察所有策略轮询后"候选检索终止"气泡，提示用户确认节目名。
4. **重试失败暴露（escape hatch 开启）**：开启 `enableSecondaryReflection` 配置后，对话输入"在06点插入不存在的栏目XYZ"，观察"二次反思"气泡出现，二次反思仍 0 命中后"候选检索终止"气泡。
5. **UI 直查**：在 create.vue 搜索框输入"看东房"，观察重试后命中"看东方"。

### 10.4 构建检查

```bash
npm run build
```

确保新模块类型正确，无编译错误。

---

## 11. 风险与权衡

### 11.1 意图解析阶段延迟略增，但重试阶段无 LLM 调用，总体延迟降低（调整）

- **风险**：LLM 在意图解析阶段一次性生成多组带策略标签的关键词，会增加意图解析阶段延迟（一次调用产出更多内容）。
- **缓解**：
  - 通过 prompt 优化（明确策略标签清单 + 强制最少 original + 1 个其它策略）让 LLM 高效产出。
  - 重试阶段为纯本地检索循环，无 LLM 调用，总体延迟低于轮询式 LLM 调用方案。
  - 首轮命中足够时不触发重试，仅意图解析阶段有一次 LLM 调用增量。
- **权衡**：意图解析阶段延迟略增 vs 重试阶段延迟大幅降低 + 上下文管理简化。本次选择后者。
- **对比原方案**：原方案"每轮重试都调 LLM"在 3 轮重试时最多 3 次额外 LLM 调用，本方案只有 1 次意图解析阶段增量（escape hatch 二次反思另算，且默认关闭）。

### 11.2 LLM 看不到首轮命中结果，关键词可能不够精准（新增）

- **风险**：LLM 在意图解析阶段一次性生成 keywordStrategies 时，看不到首轮检索命中结果，无法"按反馈演化"关键词。
- **缓解**：
  - 通过 prompt 引导 LLM 覆盖多维度（拆字 / 错别字修复 / 近义 / 栏目降级 / 放宽），并强制至少 original + 1 个其它策略，降低"关键词不够精准"风险。
  - 提供 escape hatch（默认关闭）：所有 LLM 关键词都 0 命中时，可选触发一次 LLM 二次反思，输入用户原始意图 + 已尝试关键词 + 各轮命中摘要，输出新关键词组合或明确"无更多关键词"标志。开启时最多触发 1 次，防止无限循环。
- **权衡**：LLM 一次性生成的关键词精度 vs 上下文管理简化 + 延迟降低 + SSE 流式进度友好。本次选择后者，并通过 escape hatch 兜底。

### 11.3 重试导致候选池膨胀 → 候选选择阶段 LLM 决策负担加重（保留）

- **风险**：多轮本地检索循环合并后候选池可能从 0 扩展到 10+，candidateJudge 决策负担增加。
- **缓解**：每轮命中候选截断到 `defaultLimit`（沿用现有配置）；合并去重后仍按 `sortCandidates` 排序截断；candidateJudge 已有候选数上限处理。
- **权衡**：候选池扩大是重试的目标（从 0 到有），决策负担增加是可接受的代价。

### 11.4 重试关键词重复或低质（保留并调整）

- **风险**：LLM 一次性生成的 `keywordStrategies` 中可能存在跨策略的关键词归一化重复。
- **缓解**：
  - 本地归一化去重（`sanitizeKeywordStrategies`），同一策略内关键词去重 + 跨策略与 triedKeywords 去重。
  - prompt 明确要求不重复已尝试关键词。
  - 去重后只剩 original 时退化为首轮单次检索，不进入重试循环。
- **权衡**：本地只做归一化去重（保护性），不做语义去重（会改写 LLM 意图）。

### 11.5 与 fallbackToBroadQuery / candidateSelectionService.selectFallback 的边界（保留）

- **边界**：`fallbackToBroadQuery`（candidateService.ts:144）是首轮内的软关键词降级标志，不重新检索；本地检索循环是跨策略的重新检索。二者不冲突：首轮内先走 `fallbackToBroadQuery` 判断，首轮结束仍 0 命中才进入本地检索循环的下一个策略。
- **边界**：`selectFallback` 是候选选择阶段的兜底，发生在本地检索循环之后。本地检索循环扩大候选池，`selectFallback` 在扩大后的池上兜底。

### 11.6 与 docs/agent-development-protocol.md:194 "只允许重试上一小步一次" 的关系（保留）

- **该约束原文**："网络、模型或素材工具失败时，只允许重试上一小步一次；仍失败则停止并要求用户缩小范围、换关键词或重新发起。"
- **适用范围**：该约束针对的是"工具/网络/模型失败时的恢复重试"，属于写入或调用失败后的恢复边界。
- **本次机制**：本次是"检索阶段的多次关键词组合本地轮询"，属于检索能力本身的扩展，不是失败恢复。重试阶段不调 LLM，只有意图解析阶段一次 LLM 调用（escape hatch 二次反思另算，且默认关闭，最多 1 次）。
- **结论**：二者不冲突。本次重试有独立的 maxRound 上限（默认 3，最大 5），且终态明确暴露失败（needs_clarification），符合"不允许无限重试"的精神。本方案在文档与实现中明确区分两类重试，避免混淆。

### 11.7 意图解析阶段 LLM 不稳定 → 关键词策略生成失败（保留并调整）

- **风险**：意图解析阶段 LLM 自身不稳定（超时、非合法 JSON），导致 keywordStrategies 生成失败。
- **缓解**：
  - 意图解析阶段 LLM 失败时，仅用 original（用户原词）发起首轮检索，不进入重试循环，首轮 0 命中即暴露 `needs_clarification`。
  - 不假装理解，记录 trace，允许用户重试或补充。
- **权衡**：暴露失败优于假装理解（AGENTS.md 硬约束）。

### 11.8 escape hatch 二次反思可能引入额外 LLM 调用延迟（新增）

- **风险**：开启 escape hatch 后，所有 LLM 关键词都 0 命中时会触发一次二次反思 LLM 调用，增加延迟。
- **缓解**：
  - 默认关闭（`enableSecondaryReflection=false`），仅在需要时手动开启。
  - 最多触发 1 次（`maxReflections=1`，硬上限），防止无限循环。
  - 二次反思仍 0 命中或 LLM 返回 hasMoreIdeas=false 时立即暴露失败，不再尝试。
- **权衡**：escape hatch 在复杂错别字 / 罕见栏目别名场景下能提升命中率，但增加延迟。默认关闭让用户按需开启。

---

## 12. 残余风险与未覆盖点

### 12.1 错别字修复依赖 LLM 一次性生成的质量（调整）

- 错别字修复完全由 LLM 在意图解析阶段一次性生成（AGENTS.md 禁止本地实现）。若 LLM 在意图解析阶段未识别出错别字，重试阶段（纯本地检索循环）无法再生成新的 typo_fix 关键词。
- **残余风险**：
  - 罕见错别字或领域专有名词错别字，LLM 在意图解析阶段可能无法识别。
  - LLM 一次性生成时看不到首轮命中结果，错别字修复策略可能不够精准。
- **缓解**：
  - 失败时暴露 needs_clarification，用户可手动修正。
  - 可选开启 escape hatch 二次反思（默认关闭），在所有 LLM 关键词都 0 命中时触发一次 LLM 二次反思，输入已尝试词与命中摘要，可能识别出首次未识别的错别字。

### 12.2 escape hatch 默认关闭时，复杂错别字场景可能仍需用户换词（新增）

- escape hatch 默认关闭（`enableSecondaryReflection=false`），所有 LLM 关键词都 0 命中时直接暴露 `needs_clarification`。
- **残余风险**：复杂错别字场景（如多次错别字组合、栏目别名+错别字）下，LLM 一次性生成的 typo_fix 策略可能未覆盖，escape hatch 关闭时无法二次反思，用户需手动换词。
- **缓解**：
  - 通过 prompt 引导 LLM 在意图解析阶段尽量覆盖多维度（含错别字修复）。
  - 用户可在配置中开启 escape hatch，获得二次反思能力（代价是额外 LLM 调用延迟）。
  - 暴露失败时 UI 展示已尝试关键词，帮助用户理解为何未命中。

### 12.3 意图解析阶段 LLM 不稳定时关键词策略生成失败（保留并调整）

- 见 11.7。意图解析阶段 LLM 失败时仅用 original 发起首轮检索，不进入重试循环，首轮 0 命中即暴露失败，无本地兜底。

### 12.4 UI 直查路径（create.vue）改造范围较大（保留并调整）

- `create.vue:1838` 的 UI 直查路径可能不走 Agent session，SSE 进度上报不适用。
- UI 直查路径若无意图解析阶段（用户直接在搜索框输入），需在 UI 直查入口处单独触发一次 LLM 关键词策略生成（封装为独立调用，不影响 Agent 主链路）。
- **缓解**：UI 直查路径用 UI loading 状态展示重试进度（阶段 6），不强制 SSE。
- **残余风险**：UI 直查重试进度可见性弱于 Agent 对话路径；UI 直查的 LLM 关键词策略生成调用是额外增加的 LLM 调用，可能影响 UI 响应速度。

### 12.5 docs/insert-program-recommendation-technical-design.md 路径迁移（保留）

- 该文档中的路径仍是旧仓库 bigbiandan2，本次改造需注意路径迁移核对，避免引用错误。

### 12.6 补空窗 / 全天编排长流程未接入（保留并调整）

- 按当前阶段范围（AGENTS.md Current Phase Scope），补空窗和全天编排不作为原子命令接入目标，本次重试机制不直接接入其长流程。
- **残余风险**：长流程内部检索调用点（如 orchestrator 自动编排）虽在阶段 5 平滑迁移到带重试接口，但长流程整体重试策略未单独设计。

### 12.7 关键词策略生成协议与意图解析/候选决策协议对齐版本（保留并调整）

- 关键词策略生成是意图解析阶段 LLM 调用的扩展（不是独立第三次 LLM 调用），需与 `llmAgentIntentInterpreter`（意图解析）、`candidateJudge`（候选决策）的协议版本保持一致。
- escape hatch 二次反思是独立的可选 LLM 调用，需单独对齐版本。
- **缓解**：keywordStrategies 作为意图解析 LLM 输出的扩展字段（保留旧 `searchAlternatives` 字段以兼容），复用现有 LLM client（`llmClient`）与失败暴露模式，确保一致性。escape hatch 二次反思协议独立设计，但复用同一 LLM client。

---

## 13. 假数据配套设计

### 13.1 假数据位置

主入口：`src/mock/orchestrationMock.ts`（现有 mock 节目库 `orchestrationDemoCandidates`）。

新增独立文件：`src/mock/candidateSearchRetryMock.ts`，存放专用于重试场景测试的候选节目数据，并在 `CandidateService` 构造时与 `orchestrationDemoCandidates` 合并加载，确保既有 case 不受影响。

```typescript
/**
 * 节目检索重试场景专用 mock 数据
 *
 * 设计目标：
 * - 覆盖 9.1-9.15 全部 case 的命中场景
 * - 与 orchestrationDemoCandidates 合并去重（按 programCode）
 * - 不污染既有测试断言
 */
```

### 13.2 假数据场景清单（与 9.x case 对齐）

| 场景 | 用户输入 | 命中的 mock 节目 | 命中策略 | 对应 case |
| --- | --- | --- | --- | --- |
| 错别字修复 | 看东房 | 看东方（第111期等） | typo_fix | 9.1 / 9.2 |
| 拆字兜底 | 上海旅游宣传片 | 上海风光短片 | decompose | 9.3 |
| 栏目降级 | 东方快报 第10期 | 东方快报（第1-9期，无第10期） | column_demote | 9.4 |
| 候选不足扩展 | 纪录片 | 纪录片系列 / 纪实（多期） | paraphrase | 9.5 |
| 顺播场景 | 某剧 第5期 | 某剧（第4、5、6期） | column_demote | 9.7 |
| 二次反思命中 | 看东方 第10期 | 看东方新闻（无"看东方 第10期"） | secondary_reflection_paraphrase | 9.12 |
| 全 0 命中 | 不存在的栏目XYZ | （无任何匹配） | 无 | 9.11 / 9.13 |
| 近义改写 | 晨间新闻 | 早间新闻 | paraphrase | 9.8（轮播） |
| 放宽 | 上海旅游纪录片 | 上海 旅游 风光 | broaden | 9.8（轮播） |

### 13.3 假数据结构

沿用现有 `AgentProgramCandidate` / `ProgramCandidate` 结构（`src/services/agent/types.ts` 与 `src/services/candidateService.ts`），不新增字段。每条假数据必须包含：

- `programCode`：唯一编码（如 `LOOK_EAST_111`）
- `programName`：节目名（如 `看东方`）
- `columnName`：栏目（如 `看东方`）
- `episodeNumber`：期数（如 `111`）
- `duration`：时长（秒）
- `programType`：类型（如 `news` / `documentary` / `short`）
- `tags`：标签（如 `['上海', '旅游', '风光']`）
- `rating`：收视率（轮播单排序用）

```typescript
/**
 * 错别字修复场景假数据
 *
 * 用户输入"看东房"（错别字），LLM 生成 typo_fix 策略"看东方"后命中
 */
export const typoFixMockCandidates: ProgramCandidate[] = [
  {
    programCode: 'LOOK_EAST_111',
    programName: '看东方',
    columnName: '看东方',
    episodeNumber: 111,
    duration: 1800,
    programType: 'news',
    tags: ['晨间', '新闻'],
    rating: 1.2,
  },
  // ... 其它期数
]

/**
 * 拆字场景假数据
 *
 * 用户输入"上海旅游宣传片"，LLM 生成 decompose 策略"上海/旅游/短片"后命中
 */
export const decomposeMockCandidates: ProgramCandidate[] = [
  {
    programCode: 'SHANGHAI_TRAVEL_SHORT_01',
    programName: '上海风光短片',
    columnName: '上海风光',
    episodeNumber: 1,
    duration: 300,
    programType: 'short',
    tags: ['上海', '旅游', '风光', '短片'],
    rating: 0.8,
  },
]

/**
 * 栏目降级场景假数据
 *
 * 用户输入"东方快报 第10期"，节目库有第1-9期但无第10期，
 * LLM 生成 column_demote 策略"东方快报"后命中多期
 */
export const columnDemoteMockCandidates: ProgramCandidate[] = [
  // 第 1-9 期，无第 10 期
  ...Array.from({ length: 9 }, (_, i) => ({
    programCode: `EAST_EXPRESS_${String(i + 1).padStart(3, '0')}`,
    programName: '东方快报',
    columnName: '东方快报',
    episodeNumber: i + 1,
    duration: 1800,
    programType: 'news',
    tags: ['东方快报'],
    rating: 1.0 + i * 0.05,
  })),
]

/**
 * 二次反思场景假数据
 *
 * 用户输入"看东方 第10期"，节目库无该期，也无"看东方"栏目（索引差异），
 * escape hatch 二次反思生成 paraphrase 策略"看东方新闻"后命中
 */
export const secondaryReflectionMockCandidates: ProgramCandidate[] = [
  {
    programCode: 'LOOK_EAST_NEWS_01',
    programName: '看东方新闻',
    columnName: '看东方新闻',
    episodeNumber: 1,
    duration: 1800,
    programType: 'news',
    tags: ['看东方', '新闻'],
    rating: 1.1,
  },
]
```

### 13.4 假数据加载方式

- `CandidateService` 构造时合并 `orchestrationDemoCandidates` + `candidateSearchRetryMock.ts` 导出的所有假数据数组，按 `programCode` 去重。
- 现有测试若依赖 `orchestrationDemoCandidates` 的具体数量，需在测试断言中调整（或 mock 数据时按需注入）。
- 假数据通过 `getCandidateService()` 全局单例自动生效，不需要调用方改动。

---

## 14. 测试流程配套设计

### 14.1 测试分层

| 层级 | 目标 | 工具 | 文件 |
| --- | --- | --- | --- |
| 单元测试 | 验证 `candidateSearchRetryService` / `candidateService.queryCandidatesWithRetry` / `llmAgentIntentInterpreter.keywordStrategies` 的逻辑正确性 | Vitest + mock LLM | `src/services/__tests__/*.test.ts` |
| 集成测试 | 验证 Agent 主链路（atomic_command）触发重试 + SSE trace 记录 | Vitest + mock LLM + mock 数据 | `src/services/__tests__/schedulingAgentRuntime.searchRetry.test.ts` |
| 链路测试 | 验证 Agent 编排链路不退化 | `npm run agent:check` | 现有链路 case |
| 浏览器冒烟 | 验证 SSE 一条条信息流式展示 + 真实等待时间 | Codex in-app browser | http://localhost:5173 |
| 构建检查 | 验证类型正确 | `npm run build` | - |

### 14.2 单元测试用例清单

#### `src/services/__tests__/candidateSearchRetryService.test.ts`

| 用例 | 断言要点 |
| --- | --- |
| executeRetryLoop 首轮命中即终止 | attempts 仅 1 轮，terminationReason='satisfied' |
| executeRetryLoop original 0 命中后 typo_fix 命中 | attempts 2 轮，strategyLabel 分别为 original/typo_fix |
| executeRetryLoop 按策略优先级轮询 | 顺序为 original→typo_fix→decompose→paraphrase→column_demote→broaden |
| executeRetryLoop 所有策略 0 命中 | terminationReason='all_strategies_exhausted'，nextAction='needs_clarification' |
| executeRetryLoop 达 maxRound 终止 | terminationReason='max_round' |
| executeRetryLoop 候选足够提前终止 | minCandidateThreshold 生效 |
| sanitizeKeywordStrategies 去重 | 跨策略归一化去重 |
| sanitizeKeywordStrategies 只剩 original | 退化为首轮单次 |
| shouldContinueRetry 各终止条件 | maxRound / 策略用完 / 候选足够 |
| generateKeywordStrategies 校验失败退化 | LLM 返回非法时仅含 original |
| runSecondaryReflection 触发与失败 | escape hatch 开启 + 全 0 命中 + suggestSecondaryReflection=true |
| runSecondaryReflection hasMoreIdeas=false | 暴露失败 |

#### `src/services/__tests__/candidateService.retry.test.ts`

| 用例 | 断言要点 |
| --- | --- |
| queryCandidatesWithRetry 接收 keywordStrategies | 首轮用 original，重试用其它策略 |
| queryCandidatesWithRetry 合并去重候选 | 按 programCode 去重 |
| queryCandidatesWithRetry 透传 searchRetryPlan | 结果含 searchRetryPlan 字段 |
| searchProgramsWithKeywordExpansion UI 直查 | 0 命中后按策略重试 |

#### `src/services/__tests__/llmAgentIntentInterpreter.keywordStrategies.test.ts`

| 用例 | 断言要点 |
| --- | --- |
| LLM 返回完整 keywordStrategies | 含 original + typo_fix + decompose + reason |
| LLM 只返回 original | 退化，不进入重试循环 |
| LLM 返回非 JSON | 暴露失败，仅用 original |
| LLM 返回 suggestSecondaryReflection | 标志透传 |

### 14.3 集成测试用例清单

`src/services/__tests__/schedulingAgentRuntime.searchRetry.test.ts`：

| 用例 | 断言要点 |
| --- | --- |
| 错别字场景端到端 | 用户输入"看东房" → 重试命中"看东方" → status='executed' |
| 栏目降级场景端到端 | 用户输入"东方快报 第10期" → 重试命中多期 → 进入候选选择 |
| 全 0 命中暴露失败 | 用户输入"不存在的栏目XYZ" → status='needs_clarification' |
| 顺播硬约束不被破坏 | 重试后 guard 仍强制 next=max+1 |
| SSE trace 含策略标签 | trace 中 searchAttempts 含 strategyLabel |
| escape hatch 开启二次反思命中 | triggeredSecondaryReflection=true |

### 14.4 链路测试（agent:check）

```bash
npm run agent:check
```

重点验证：
- atomic_command 链路重试行为不退化。
- 顺播硬约束不被重试破坏。
- 失败暴露链路（needs_clarification / needs_selection）正常。
- 全部 case 通过数 ≥ 现有基线。

### 14.5 浏览器冒烟测试流程

刷新 `http://localhost:5173`，在 Codex in-app browser 中按以下流程验证"一条条信息流式展示"：

1. **错别字重试流式验证**：
   - 输入"在06点插入看东房"。
   - 观察 SSE 气泡序列（每条独立推送，有真实等待时间）：
     - 气泡1（开始）：正在按 看东房 查节目库，位置按 06:00:00。
     - （等待首轮检索实际返回）
     - 气泡2（开始）：关键词太死没查到，正在尝试 看东方（错别字修复）重新查节目库。
     - （等待重试检索实际返回）
     - 气泡3（完成）：已查到 1 个候选期次。
     - 气泡4（候选决策）：进入候选选择。
   - 断言：气泡是逐条出现的，不是一次性批量出现；每条之间有真实等待时间。

2. **栏目降级重试流式验证**：
   - 输入"在06点插入东方快报第10期"。
   - 观察气泡序列：首次（0 命中）→ 重试1（column_demote，命中多期）→ 候选决策。
   - 断言：策略标签"栏目降级"在气泡中出现。

3. **重试失败暴露流式验证**：
   - 输入"在06点插入不存在的栏目XYZ"。
   - 观察气泡序列：首次（0 命中）→ 重试1（paraphrase，0 命中）→ 候选检索终止（已尝试 2 组关键词，仍未命中，需要你确认节目名）。
   - 断言：终止气泡含"需要你确认"暴露失败语义。

4. **escape hatch 二次反思流式验证**（开启配置后）：
   - 输入"在06点插入看东方第10期"。
   - 观察气泡序列：首次（0 命中）→ 重试1（column_demote，0 命中）→ 二次反思（模型反思后建议尝试 看东方新闻）→ 重试2（二次反思，命中）→ 候选决策。
   - 断言："二次反思"气泡独立出现，有 LLM 反思真实等待时间。

5. **UI 直查重试验证**：
   - 在 create.vue 搜索框输入"看东房"。
   - 观察 UI loading 状态变化 + 最终命中"看东方"。

### 14.6 假数据驱动测试矩阵

| Case | 假数据 | 用户输入 | 期望策略 | 期望命中 |
| --- | --- | --- | --- | --- |
| 9.1 | typoFixMockCandidates | 看东房 | original→typo_fix | 看东方 |
| 9.3 | decomposeMockCandidates | 上海旅游宣传片 | original→decompose | 上海风光短片 |
| 9.4 | columnDemoteMockCandidates | 东方快报 第10期 | original→column_demote | 东方快报 多期 |
| 9.11 | （无匹配数据） | 不存在的栏目XYZ | original→paraphrase | 0 命中 |
| 9.12 | secondaryReflectionMockCandidates | 看东方 第10期 | original→column_demote→secondary_reflection_paraphrase | 看东方新闻 |

### 14.7 验证命令清单

```bash
# 单元测试
npx vitest run src/services/__tests__/candidateSearchRetryService.test.ts
npx vitest run src/services/__tests__/candidateService.retry.test.ts
npx vitest run src/services/__tests__/llmAgentIntentInterpreter.keywordStrategies.test.ts

# 集成测试
npx vitest run src/services/__tests__/schedulingAgentRuntime.searchRetry.test.ts

# 链路测试
npm run agent:check

# 构建检查
npm run build
```

---

## 15. 附录

### 13.1 关键文件索引

| 文件 | 关键位置 | 说明 |
| --- | --- | --- |
| `src/services/candidateService.ts` | :104 queryCandidates | 底层候选查询原语 |
| `src/services/candidateService.ts` | :308 searchPrograms | 底层节目名检索原语 |
| `src/services/candidateService.ts` | :144 fallbackToBroadQuery | 软关键词降级标志（不重新检索） |
| `src/services/agent/atomicCommandCapability.ts` | :4144 resolveCandidatePool | 现有本地过滤重试（待抽取） |
| `src/services/agent/atomicCommandCapability.ts` | :4187 buildCandidateRetryKeywords | 现有重试关键词构造（待迁移） |
| `src/services/agent/atomicCommandCapability.ts` | :4226 buildCandidateSearchRetryPlan | 现有重试计划构造（待迁移） |
| `src/services/agent/atomicCommandCapability.ts` | :97 CandidateSearchAttempt | 类型定义（待迁移） |
| `src/services/agent/atomicCommandCapability.ts` | :104 CandidatePoolResolution | 类型定义（待迁移） |
| `src/services/agent/llmAgentIntentInterpreter.ts` | :133 searchAlternatives / keywordStrategies 生成 | LLM 意图解析阶段一次性生成带策略标签的关键词组合（扩展原 searchAlternatives） |
| `src/services/agent/types.ts` | :70 searchAlternatives / keywordStrategies 字段 | 类型定义（保留旧字段以兼容，新字段优先） |
| `src/services/agent/runtimeSchedulingDataGateway.ts` | :134 readProgramCandidates | 唯一外部检索入口 |
| `src/services/orchestrator.ts` | :820 自动编排调用点 | 待迁移 |
| `src/services/runtime/demoRuntimeFacade.ts` | :1115 草案预检调用点 | 待迁移 |
| `src/services/runtime/demoRuntimeFacade.ts` | :5065 processTypeLabel | SSE 气泡标签 |
| `src/views/broadcast-plan/create.vue` | :1838 UI 调用点 | 待迁移 |
| `src/views/broadcast-plan/components/ScheduleItemDialog.vue` | :379 UI 调用点 | 待迁移 |
| `src/services/candidateKeywordMatcher.ts` | :321 decomposeNaturalLanguageSearchFacets | 本地拆字（仅过滤用） |
| `src/services/agent/searchFacets.ts` | :22 buildCandidateQueryEvidence | 检索证据构造 |

### 13.2 新增文件清单

- `src/services/agent/candidateSearchRetryService.ts`（阶段 1 新增，从 atomicCommandCapability 抽取；阶段 3 扩展 executeRetryLoop；阶段 8 扩展 runSecondaryReflection）
- `src/services/__tests__/candidateSearchRetryService.test.ts`（阶段 3 新增，覆盖本地检索循环；阶段 8 扩展 escape hatch case）
- `src/services/__tests__/candidateService.retry.test.ts`（阶段 3 新增）
- `src/services/__tests__/schedulingAgentRuntime.searchRetry.test.ts`（阶段 4 新增）
- `src/services/__tests__/llmAgentIntentInterpreter.keywordStrategies.test.ts`（阶段 2 新增，覆盖意图解析阶段 LLM 一次性生成 keywordStrategies 的协议与本地校验）

### 13.3 不新增的文件

- 不新增本地同义词词典（违反 LLM-first）。
- 不新增本地错别字修复表（违反 LLM-first）。
- 不新增本地关键词分类器（违反 LLM-only）。
