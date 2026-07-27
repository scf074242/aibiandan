# 无顺播基线时未自动选最早一期 — 修复方案

- 文档版本：v1.0
- 撰写角色：solution-architect
- 涉及模块：`src/services/agent/candidateJudge.ts` / `src/services/agent/tvSequenceCandidateSelector.ts` / `src/services/agent/atomicCommandCapability.ts`
- 状态：待用户确认（确认后由实现角色落地，再由 code-review-expert 检查）

---

## 1. 背景

aibiandan 是电视/轮播节目编排 agent，遵循 Codex 设计模式（LLM-first / LLM-only 主路径，本地逻辑只保护结果不改写意图）。

### 缺陷现象

用户测试单命令"在10点插入《看东方》"，当前播单为空（无顺播基线）。系统查出 4 个候选期次（111-114 期，时长 3600s / 2700s / 2700s / 1800s）。LLM 候选决策返回 `needs_clarification`，理由是"目标时段时长未知，无法判断哪个候选时长合适"，导致前台卡在"需要你确认具体排哪一个"，没有按项目硬约束自动选最早一期（111 期）。

### 期望行为

无顺播基线 + 用户给了明确节目名 + 候选有期数时，系统应 `auto_select` 期数最小的候选（111 期），并在 trace 中说明"按顺播硬约束从最早未播出期次开始"。时长明显越界由本地写入校验（`FormalPlaylistWriteAdapter` / 时长边界检查）暴露失败，不在 LLM 候选决策层退回 `needs_clarification`。

---

## 2. 根因分析（已确认）

### 2.1 prompt 内部规则冲突

[`candidateJudge.ts`](file:///./src/services/agent/candidateJudge.ts) L107-L144 的 system prompt：

- **L113**：把"时长是否适配目标时段"列为第 1 步硬条件。
- **L116**：第 4 步评估维度再次出现"时长适配"。
- **L129-L132**：顺播期数选择规则，**L131** 明确"无顺播基线时（今天和历史都没播过该系列）：如果用户给了明确节目名且候选有期数，`auto_select` 最早一期（期数最小的）"。

LLM 在目标时段时长不确定时，把"时长适配"当成更优先条件，退回 `needs_clarification`，忽略了 L131 的明确指令。prompt 内部存在优先级表述歧义：未声明"无基线选最早一期"是覆盖"时长适配"的硬规则。

### 2.2 本地无后置收敛兜底

[`tvSequenceCandidateSelector.ts`](file:///./src/services/agent/tvSequenceCandidateSelector.ts) L203-L214 的 `validateCandidateAgainstSequence`：

```ts
if (evidence.playlistType !== 'tv' || !evidence.hasBaseline) return null
```

在 `!evidence.hasBaseline` 时直接 `return null`（不校验），完全信任 LLM。

[`atomicCommandCapability.ts`](file:///./src/services/agent/atomicCommandCapability.ts) L4784-L4805：LLM 返回 `needs_clarification` / `unable_to_decide` 时直接透传给前台进入 `needs_selection`，没有本地收敛路径覆盖"无基线选最早一期"硬约束。

### 2.3 项目硬约束（来自 AGENTS.md）

- "When no sequence baseline exists, LLM must auto-select the earliest episode (smallest episode number) for sequential broadcasting"。
- "LLM-first / LLM-only 主路径：本地逻辑只能保护结果，不能替用户表达或改写意图"。
- "确定性逻辑只能发生在模型返回之后或写入之前，用来校验、收敛候选、保护结果和暴露失败"。
- "失败暴露而非回滚：禁止 `validateOrRollback` / `mutationJournal` / `autoRollback`；失败时产出结构化 envelope 让用户重试或补参"。
- "不引入子 agent"。
- File Hygiene：单文件不超过 2000 行，`AtomicCommandCapability` 当前 6193 行（实测）是 P0 技术债，新能力不得继续堆入。

---

## 3. 方案对比

### 方案 A：仅修改 prompt 优先级表述

在 [`candidateJudge.ts`](file:///./src/services/agent/candidateJudge.ts) prompt 中明确："无顺播基线 + 用户明确节目名 + 候选有期数"场景下，`auto_select` 最早一期是硬规则，时长适配不作为此场景的澄清理由；时长明显越界由本地写入校验暴露失败。

| 维度 | 评价 |
|---|---|
| 改动面 | 最小，仅 prompt 文案 |
| LLM-first 合规 | 完全符合 |
| 硬约束保障 | 依赖 LLM 遵守，不可控；偶发不遵守时无回归保护 |
| 回归风险 | 低 |
| 缺陷修复确定性 | 不收敛（LLM 可能再次不遵守） |

### 方案 B：仅加本地后置收敛兜底

在 [`atomicCommandCapability.ts`](file:///./src/services/agent/atomicCommandCapability.ts) `selectCandidate`（L4546）中，LLM 返回 `needs_clarification` / `unable_to_decide` 后，检测到"TV 播单 + 无顺播基线 + 候选都有期数 + 用户给了明确节目名"时，本地选期数最小的候选作为 `auto_select` 兜底。

| 维度 | 评价 |
|---|---|
| 改动面 | 中 |
| LLM-first 合规 | 有张力，需论证这是"保护结果"而非"改写意图" |
| 硬约束保障 | 100%，有回归保护 |
| 回归风险 | 中（兜底条件边界需谨慎） |
| File Hygiene | **违反**：新增逻辑堆入已超红线的 `AtomicCommandCapability`（6193 行） |
| 缺陷修复确定性 | 收敛 |

### 方案 C：prompt 修正 + 本地后置收敛兜底（双保险）⭐ 推荐

方案 A + 方案 B 组合，但**本地兜底逻辑放在 [`tvSequenceCandidateSelector.ts`](file:///./src/services/agent/tvSequenceCandidateSelector.ts)**（当前 471 行，远低于 2000 行红线），不堆入 `AtomicCommandCapability`。`selectCandidate` 仅新增一次方法调用（约 15 行），不引入业务判断分支。

| 维度 | 评价 |
|---|---|
| 改动面 | 中（prompt + selector 新增方法 + selectCandidate 调用点） |
| LLM-first 合规 | 符合（论证见 §5） |
| 硬约束保障 | 100%，prompt 让 LLM 大多数情况遵守，本地兜底覆盖偶发不遵守 |
| 回归风险 | 中（需配套 case 覆盖边界） |
| File Hygiene | **符合**：兜底逻辑放 selector，不堆入 P0 债文件 |
| 缺陷修复确定性 | 收敛且可解释 |

---

## 4. 推荐方案：方案 C

### 推荐理由

1. **确定性优先**：项目硬约束要求"无基线必须选最早一期"，这是顺播硬规则，不允许 LLM 偶发不遵守导致用户体验卡死。方案 A 单靠 prompt 不可控。
2. **File Hygiene 合规**：把兜底逻辑放在 `tvSequenceCandidateSelector.ts`（471 行，顺播领域职责单一），不堆入 6193 行的 P0 债文件 `AtomicCommandCapability`。`selectCandidate` 仅新增一次方法调用。
3. **职责对齐**：`AgentTvSequenceCandidateSelector` 已经是"TV 顺播候选选择"的领域模块，已有 `selectBestCandidate`（有基线时选下一集）和 `validateCandidateAgainstSequence`（后置校验）。新增"无基线选最早一期"是该模块职责的自然延伸，不是新能力。
4. **双保险可解释**：prompt 让 LLM 在大多数情况遵守，trace 中能看到 LLM 的 `auto_select` 决策；偶发不遵守时本地兜底，trace 中能看到"LLM 未遵守无基线选最早一期规则，本地按顺播硬约束收敛"。两条路径都可审计。
5. **已有先例**：[`atomicCommandCapability.ts`](file:///./src/services/agent/atomicCommandCapability.ts) L4555-L4576 的 `selectLatestIssueCandidateIfRequested` 已经是"用户明确 cue 最新一期 → 本地确定性选 max issue"的本地选择路径，在 LLM 决策**之前**执行。本次兜底是其对称 counterpart：无 cue + 无基线 → 本地确定性选 min issue（顺播硬约束）。两者都是"保护结果"而非"改写意图"。

---

## 5. 合规性论证（对齐 AGENTS.md 硬约束）

### 5.1 LLM-first / 本地逻辑只能保护结果

**论点**：本地兜底是"保护顺播硬约束结果"，不是"替用户表达或改写意图"。

- 用户意图是"在10点插入《看东方》"——用户要的是"《看东方》被插入"，没有表达"我要在 4 个期次里挑时长最合适的"。
- 项目硬约束（Scheduling Guardrails）规定"电视剧/连续剧/系列节目不能倒序、跳播、重复排入"，顺播必须从最早未播出期次开始。这是**结果硬约束**，不是用户意图。
- LLM 在 prompt 中已被明确指示"无基线选最早一期"，本地兜底只是确保该硬约束 100% 执行，等价于 `validateCandidateAgainstSequence` 对有基线场景的校验角色——只是从"拒绝违规"前置为"兜底正确选择"。
- 判断标准（AGENTS.md Implementation Rules）："代码如果是在理解用户，就是错误方向；代码如果是在保护结果、校验写入或暴露失败，就是允许保留。" 本地兜底属于"保护结果"，允许保留。

### 5.2 确定性逻辑只能发生在模型返回之后

**论点**：兜底发生在 LLM 返回 `needs_clarification` / `unable_to_decide` **之后**，符合"模型返回之后用来收敛候选"。

- 兜底入口在 [`atomicCommandCapability.ts`](file:///./src/services/agent/atomicCommandCapability.ts) L4784 之后的 `needs_clarification` / `unable_to_decide` 分支，不在 LLM 调用前拦截。
- 与 L4784 现有"直接透传给前台"的旧行为相比，兜底只是在透传前增加一次"是否能按硬约束收敛"的判断，不绕过 LLM。

### 5.3 失败暴露而非回滚

**论点**：兜底不引入任何回滚链路，失败时仍产出结构化 envelope。

- 不引入 `validateOrRollback` / `mutationJournal` / `autoRollback`。
- 兜底成功时：trace 记录"本地按顺播硬约束收敛到最早一期"，继续走写入校验链路（时长越界等由 `FormalPlaylistWriteAdapter` 暴露失败）。
- 兜底条件不满足时（如候选无期数、轮播单、用户 cue 最新一期）：不兜底，仍按原路径产出 `needs_selection` + `candidateOptions` 给用户，等价于结构化失败 envelope。
- 时长明显越界：**不**由本地兜底强行排入，而由写入边界校验暴露失败（保持现有"失败暴露"语义）。

### 5.4 不引入子 agent

**论点**：兜底是 `AgentTvSequenceCandidateSelector` 的一个新方法，由 `selectCandidate` 同步调用，不引入 DraftAgent / CandidateAgent / SelectionAgent 等子 agent 雏形。

### 5.5 File Hygiene

**论点**：兜底主体逻辑放 [`tvSequenceCandidateSelector.ts`](file:///./src/services/agent/tvSequenceCandidateSelector.ts)（471 行 → 预计 ~530 行，远低于 2000 行红线）。[`atomicCommandCapability.ts`](file:///./src/services/agent/atomicCommandCapability.ts)（6193 行）仅新增约 15 行调用代码，不引入新业务判断分支，不继续堆入 P0 债。

### 5.6 Capability 拆分边界 / CapabilityRegistry 唯一分发

**论点**：本次修复不新增 capability，不新增 intent 分支，仅强化现有 `AtomicCommandCapability` 内 `selectCandidate` 的候选收敛路径，不触碰 `CapabilityRegistry` 分发机制。

---

## 6. 实现位置（精确文件 + 行号 + 改动要点）

### 6.1 改动点 1：prompt 优先级表述（方案 A 部分）

**文件**：[`src/services/agent/candidateJudge.ts`](file:///./src/services/agent/candidateJudge.ts)

**位置**：L107-L144 的 system prompt `content` 数组。

**改动要点**：

1. **L113**（第 1 步硬条件）：把"时长是否适配目标时段"改为"时长是否在合理范围内（不显著越界目标时段，由本地写入校验最终把关）"，弱化 LLM 对时长的硬判定负担。
2. **L116**（第 4 步）：保留"时长适配"作为参考维度，但增加注释"当无顺播基线且候选有期数时，时长适配不作为澄清理由"。
3. **L129-L132**（顺播期数选择规则）：在 L131 前增加显式优先级声明：

   ```
   顺播期数选择规则（重要，覆盖时长适配评估）：
   - 有顺播基线时：必须选择期望下一集，不能跳集、倒序、重复
   - 无顺播基线时（今天和历史都没播过该系列）：如果用户给了明确节目名且候选有期数，必须 auto_select 最早一期（期数最小的）。这是顺播硬约束，覆盖第4步时长适配评估；时长明显越界由本地写入校验暴露失败，不在 LLM 层退回 needs_clarification
   - 无顺播基线且候选无期数信息或同一期有多个版本：needs_clarification
   ```

4. **版本管理**：prompt 当前无版本号，本次修订建议在 trace 标签或 prompt 头部标注 `v1.1`（对齐 AGENTS.md "Prompt 版本管理"硬约束）。

### 6.2 改动点 2：本地后置收敛兜底（方案 B 部分，放 selector）

**文件**：[`src/services/agent/tvSequenceCandidateSelector.ts`](file:///./src/services/agent/tvSequenceCandidateSelector.ts)

**新增方法**：在 `validateCandidateAgainstSequence`（L203）之后新增 `selectEarliestEpisodeFallbackWhenNoBaseline`。

```ts
/**
 * 无顺播基线时的本地后置收敛兜底（方案 C / 对齐 AGENTS.md 顺播硬约束）
 *
 * 触发条件（全部满足才兜底，否则返回 null 让调用方按原路径暴露失败）：
 * - playlistType === 'tv'
 * - !evidence.hasBaseline（今天和历史都没播过该系列）
 * - 候选全部可提取到期数（issueNo / 节目名期数 / programCode 末段数字）
 * - 候选数 >= 1
 *
 * 返回期数最小的候选；多个候选共享最小期数时返回 null（同一期多版本需用户选择，不强行兜底）
 *
 * 合规性：
 * - 本方法在 LLM 返回 needs_clarification / unable_to_decide 之后由 selectCandidate 调用
 * - 不改写用户意图（用户要"插入X"，本方法确保按顺播硬约束选最早一期）
 * - 不绕过写入校验（时长越界仍由 FormalPlaylistWriteAdapter 暴露失败）
 * - 失败时返回 null，让调用方产出结构化 needs_selection envelope
 */
selectEarliestEpisodeFallbackWhenNoBaseline(
  evidence: AgentTvSequenceEvidence,
  candidates: AgentProgramCandidate[],
): { candidate: AgentProgramCandidate; selectedSequence: number; seriesKey?: string } | null {
  if (evidence.playlistType !== 'tv') return null
  if (evidence.hasBaseline) return null
  if (candidates.length === 0) return null

  const ranked = candidates
    .map((candidate) => ({
      candidate,
      sequence: this.extractSequence(candidate),
    }))
    .filter((item): item is { candidate: AgentProgramCandidate; sequence: number } =>
      typeof item.sequence === 'number' && item.sequence > 0,
    )
  if (ranked.length !== candidates.length) return null // 任一候选无期数 → 不兜底
  if (ranked.length === 0) return null

  const minSequence = ranked.reduce((min, item) => Math.min(min, item.sequence), Number.POSITIVE_INFINITY)
  const minMatches = ranked.filter((item) => item.sequence === minSequence)
  if (minMatches.length !== 1) return null // 同一期多版本 → 不兜底，交用户选择

  return {
    candidate: minMatches[0]!.candidate,
    selectedSequence: minSequence,
    seriesKey: evidence.seriesKey,
  }
}
```

**说明**：复用现有 `extractSequence`（L389，已支持 issueNo / 节目名期数 / programCode 末段数字三种来源），不引入新的期数解析逻辑。

### 6.3 改动点 3：selectCandidate 调用兜底

**文件**：[`src/services/agent/atomicCommandCapability.ts`](file:///./src/services/agent/atomicCommandCapability.ts)

**位置**：L4784-L4805（`needs_clarification` / `unable_to_decide` 透传分支）。

**改动要点**：在 `runtime.trace.record('needs_selection', ...)` 之前插入兜底判断（约 15 行）：

```ts
// 无顺播基线 + 用户明确节目名 + 候选全有期数 → 本地按顺播硬约束收敛到最早一期
// （对齐 AGENTS.md Scheduling Guardrails：电视剧/系列节目不能倒序、跳播；顺播必须从最早未播出开始）
// 兜底在 LLM 返回 needs_clarification / unable_to_decide 之后触发，不绕过 LLM，不改写用户意图
if (
  context.playlistType === 'tv'
  && !tvSequenceEvidence.hasBaseline
  && !this.hasLatestIssueCue(input) // 用户明确 cue 最新一期时由 selectLatestIssueCandidateIfRequested 处理（已先执行）
  && this.hasExplicitProgramHint(input) // 用户给了明确节目名
) {
  const fallback = this.tvSequenceSelector.selectEarliestEpisodeFallbackWhenNoBaseline(
    tvSequenceEvidence,
    judgeCandidates,
  )
  if (fallback) {
    runtime.trace.record('planning', 'LLM 未遵守无基线选最早一期规则，本地按顺播硬约束收敛。', {
      commandIntent,
      candidateCount: judgeCandidates.length,
      selectedCandidateId: fallback.candidate.id,
      selectedSequence: fallback.selectedSequence,
      llmDecisionType: decision.decisionType,
      llmReasoning: decision.reasoning,
    })
    return {
      candidate: fallback.candidate,
      diagnostics: {
        method: 'candidate_judge_llm',
        source: 'fallback',
        selectedCandidateId: fallback.candidate.id,
        selectedProgramCode: fallback.candidate.programCode,
        decisionType: 'auto_select',
        reasoning: `无顺播基线，按顺播硬约束选最早一期（第 ${fallback.selectedSequence} 期）。`,
        candidateCount: judgeCandidates.length,
        professionalAssessment: judgePool.assessments[fallback.candidate.id]
          ?? professionalAssessmentByCandidateId.get(fallback.candidate.id)
          ?? this.buildProfessionalAssessment(fallback.candidate, input, context, commandIntent, targetTime, replacementTarget),
        reason: `无顺播基线，按顺播硬约束选最早一期（第 ${fallback.selectedSequence} 期）。`,
      },
    }
  }
}
```

**新增辅助方法**（放 `atomicCommandCapability.ts`，约 8 行，不引入业务判断）：

```ts
/**
 * 判断用户是否给了明确节目名（用于无基线选最早一期兜底的触发条件）
 * 仅检查结构化 slot，不做自然语言理解（LLM-first）
 */
private hasExplicitProgramHint(input: AgentSubmitInput): boolean {
  return Boolean(
    input.interpretation?.slots?.programHint?.trim()
    || input.interpretation?.slots?.replacementHint?.trim()
    || this.readStringSlot(input.pendingTask?.collectedSlots.programHint)
    || this.readStringSlot(input.pendingTask?.collectedSlots.replacementHint),
  )
}
```

**说明**：

- `hasLatestIssueCue`（L4883）已存在，`selectLatestIssueCandidateIfRequested`（L4555）在 LLM 决策前已执行；此处 `!this.hasLatestIssueCue(input)` 是防御性双检，确保用户 cue"最新一期"时绝不触发最早一期兜底。
- 兜底成功后仍走 `buildProfessionalAssessment`，硬约束（素材/版权缺失）仍会阻断写入，不绕过写入校验。
- 兜底失败（返回 null）时继续走原 L4784-L4805 的 `needs_selection` 透传路径，产出结构化 envelope。

---

## 7. 验证计划

### 7.1 新增 vitest case

**文件**：[`src/services/__tests__/schedulingAgentRuntime.candidateDecision.test.ts`](file:///./src/services/__tests__/schedulingAgentRuntime.candidateDecision.test.ts)（已在 `agent:check:tests` 列表，无需改 package.json）

在 `describe('SchedulingAgentRuntime selectCandidate LLM 决策分流', ...)`（L424）内新增以下 case：

| Case ID | 场景 | 输入 | 期望 | mustNotHappen |
|---|---|---|---|---|
| Case H1 | 无基线 + 用户明确节目名 + 候选全有期数 + LLM needs_clarification → 本地兜底 auto_select 最早一期 | 4 候选（111-114 期），mockJudge 返回 needs_clarification | `result.status === 'executed'`，`selectedSequence === 111`，trace 含"本地按顺播硬约束收敛" | 不应进入 needs_selection；不应选 112/113/114 |
| Case H2 | 无基线 + 用户明确节目名 + 候选全有期数 + LLM unable_to_decide → 本地兜底 auto_select 最早一期 | 同 H1，mockJudge 返回 unable_to_decide | 同 H1 | 同 H1 |
| Case H3 | 无基线 + 候选无期数信息 → 不兜底，仍 needs_selection | 4 候选无 issueNo / 无期数名，mockJudge 返回 needs_clarification | `result.status === 'needs_selection'`，trace 不含"本地按顺播硬约束收敛" | 不应 auto_select |
| Case H4 | 无基线 + 同一期多版本（两个 111 期）→ 不兜底，仍 needs_selection | 两个候选期数都是 111，mockJudge 返回 needs_clarification | `result.status === 'needs_selection'`，`candidateOptions.length === 2` | 不应强行选其中一个 |
| Case H5 | 用户明确 cue"最新一期" + 无基线 → 走 selectLatestIssueCandidateIfRequested，不触发最早一期兜底 | userInput="插入看东方最新一期"，4 候选 111-114 期 | `selectedSequence === 114`（最大期），trace 含"用户明确要求期数最大" | 不应选 111；不应同时出现两条兜底 trace |
| Case H6 | 轮播单 + 无基线 + 候选有期数 → 不触发 TV 兜底 | playlistType='rotation'，4 候选有期数，mockJudge 返回 needs_clarification | `result.status === 'needs_selection'`（按轮播策略），trace 不含"本地按顺播硬约束收敛" | 不应 auto_select 最早一期 |
| Case H7 | 有顺播基线 → 不触发无基线兜底，走原 selectBestCandidate 路径 | today 编排已有看东方 110 期，候选 111-114，mockJudge 返回 needs_clarification | `result.status === 'needs_selection'`，trace 不含"本地按顺播硬约束收敛" | 不应绕过基线校验 |

**Case 字段完整度**：每个 case 必须包含 `id` / `userInput` / `expectedDecision` / `mustNotHappen` / `verification` 五字段（对齐 AGENTS.md Case First）。

### 7.2 prompt 单元测试

**文件**：[`src/services/__tests__/schedulingAgentRuntime.candidateDecision.test.ts`](file:///./src/services/__tests__/schedulingAgentRuntime.candidateDecision.test.ts) L134 `describe('LlmAgentCandidateJudge 单元决策', ...)` 内新增：

- Case P1：mock LLM 返回 `auto_select` 最早一期（验证 prompt 修正后 LLM 大多数情况遵守）。
- Case P2：mock LLM 仍返回 `needs_clarification`（验证兜底在 selectCandidate 层接管，不依赖 prompt 单点）。

### 7.3 门禁

```bash
npm run agent:check
```

- 已包含 `schedulingAgentRuntime.candidateDecision.test.ts`，新增 case 自动纳入门禁。
- 构建检查（`npm run build`）必须通过。

### 7.4 浏览器回归

```bash
npm run agent:browser:goal37
npm run agent:browser:goal38
```

**验证点**：

1. 新建电视播单 → 输入"在10点插入《看东方》"（空播单，无历史）→ 前台应直接执行插入，候选决策气泡显示"按顺播硬约束选最早一期（第111期）"，不出现"需要你确认具体排哪一个"。
2. 新建电视播单 → 输入"在10点插入《看东方》最新一期" → 前台应执行插入 114 期（验证 latest-issue 路径优先，不被兜底覆盖）。
3. 新建轮播单 → 输入"插入看东方" → 前台应进入候选选择（验证轮播单不触发 TV 兜底）。
4. Goal 37/38 覆盖矩阵门槛：`supported + guarded_supported` ≥ 80%。

### 7.5 真实 LLM 评估（可选）

```bash
npm run agent:eval:llm
```

在真实 LLM 环境跑一次"在10点插入《看东方》"，确认 prompt 修正后 LLM 大多数情况直接 `auto_select` 最早一期，trace 中不出现本地兜底（兜底仅在 LLM 偶发不遵守时触发）。

---

## 8. 回归风险与边界

### 8.1 兜底触发边界（严格）

兜底**仅**在以下条件全部满足时触发：

| 条件 | 说明 |
|---|---|
| `playlistType === 'tv'` | 轮播单不触发（轮播无顺播约束） |
| `!evidence.hasBaseline` | 有基线时走 `selectBestCandidate`，不触发兜底 |
| `!hasLatestIssueCue(input)` | 用户明确 cue"最新一期"时由 `selectLatestIssueCandidateIfRequested` 处理（已先执行），不触发最早一期兜底 |
| `hasExplicitProgramHint(input)` | 用户给了明确节目名（结构化 slot 非空）；slot 为空时不兜底（属意图解析失败，不应由候选层兜底） |
| 候选全部可提取期数 | 任一候选无期数 → 不兜底（无期数信息时无法判断"最早"） |
| 最小期数唯一 | 同一期多版本（如两个 111 期）→ 不兜底，交用户选择 |
| LLM 已返回 needs_clarification / unable_to_decide | 不在 LLM 调用前拦截，不绕过 LLM |

### 8.2 不触发兜底的场景

- 候选无期数信息（如单集节目、电影）→ 走原 `needs_selection` 路径。
- 用户明确 cue"最新一期" → 走 `selectLatestIssueCandidateIfRequested`。
- 轮播单 → 按轮播策略（内容匹配 / 收视率 / 热播）。
- 有顺播基线 → 走 `selectBestCandidate` 选期望下一集。
- 同一期多版本 → `needs_selection` 让用户选版本。
- 用户未给明确节目名（programHint 为空）→ `needs_selection`（意图解析失败不应由候选层兜底）。

### 8.3 时长越界处理

- 兜底成功后，候选时长明显越界目标时段（如 3600s 排入 30 分钟格子）**不**由本地兜底强行排入。
- 由 `FormalPlaylistWriteAdapter` / 时长边界检查在写入时暴露失败，产出结构化 envelope（保持"失败暴露而非回滚"语义）。
- prompt 修正后，LLM 不再因"时长适配不确定"退回 `needs_clarification`，但写入校验仍是最终把关。

### 8.4 潜在风险

| 风险 | 缓解 |
|---|---|
| 兜底误触发（如有基线但 evidence 计算错误） | `selectBestCandidate` 在兜底前已执行，有基线时返回 candidate 或 candidateOptions，不会进入 L4784 分支 |
| `extractSequence` 期数解析错误（如 programCode 末段数字不是期数） | 现有 `extractSequence` 已在 `selectBestCandidate` / `validateCandidateAgainstSequence` 复用，本次不修改解析逻辑，风险等价于现状 |
| 用户 cue"第一期"/"最早一期" | 当前 `hasLatestIssueCue` 只识别"最新/最大"，不识别"最早"；用户 cue"最早一期"时 LLM 应直接 auto_select，兜底仅在 LLM 不遵守时触发，行为正确 |
| prompt 修正后 LLM 行为变化 | 配套真实 LLM 评估（§7.5）+ Case P1/P2 双向覆盖 |

### 8.5 不在本次范围

- 不修改 `extractSequence` 期数解析逻辑。
- 不修改 `selectBestCandidate`（有基线路径）。
- 不修改 `validateCandidateAgainstSequence`（有基线后置校验）。
- 不修改 `selectLatestIssueCandidateIfRequested`（latest-issue 路径）。
- 不修改 `FormalPlaylistWriteAdapter`（写入边界）。
- 不拆分 `AtomicCommandCapability`（P0 债拆分是独立任务，本次仅"不继续堆入"）。

---

## 9. 架构对齐声明

### 9.1 对齐 Design Philosophy

- **LLM-first / LLM-only 主路径**：兜底在 LLM 返回之后触发，不绕过 LLM；prompt 修正让 LLM 大多数情况遵守，兜底仅覆盖偶发不遵守。
- **失败暴露而非回滚**：不引入 `validateOrRollback` / `mutationJournal` / `autoRollback`；兜底失败时返回 null，仍产出 `needs_selection` 结构化 envelope；时长越界由写入校验暴露失败。
- **不引入子 agent**：兜底是 `AgentTvSequenceCandidateSelector` 的一个新方法，同步调用，不引入子 agent 雏形。
- **确定性逻辑只在模型返回之后或写入之前**：兜底在 LLM 返回 `needs_clarification` / `unable_to_decide` 之后触发，用于收敛候选、保护顺播硬约束结果。

### 9.2 对齐 Scheduling Guardrails

- "电视剧、连续剧、系列节目不能倒序、跳播、重复排入" → 兜底确保无基线时从最早未播出期次开始。
- "电视频道编排需要优先参考昨日历史编排进度" → 有基线时仍走 `selectBestCandidate`，兜底仅在无基线时触发。
- "候选不足、字段冲突、时间冲突、顺播风险无法消解时，应追问、拒绝或保留空缺" → 同一期多版本 / 候选无期数时仍 `needs_selection`，不强行兜底。

### 9.3 对齐 Implementation Rules

- "先追踪现有流程，再做最小实现改动" → 复用 `extractSequence` / `hasLatestIssueCue` / `buildProfessionalAssessment`，不新增解析逻辑。
- "本地逻辑只能保护结果，不能替用户表达或改写意图" → 兜底保护顺播硬约束结果，不改写"插入X"的用户意图。
- "判断标准：代码如果是在保护结果、校验写入或暴露失败，就是允许保留" → 兜底属于"保护结果"，允许保留。

### 9.4 对齐 File Hygiene

- "单文件代码不超过 2000 行" → 兜底主体放 `tvSequenceCandidateSelector.ts`（471 → ~530 行），`atomicCommandCapability.ts`（6193 行）仅新增约 23 行（15 行调用 + 8 行辅助方法），不继续堆入 P0 债。
- "新增能力位置约束" → 本次不新增 agent 长程业务能力，不新增 capability，仅强化现有候选收敛路径。

### 9.5 对齐 Case First

- 新增 Case H1-H7 + P1-P2 共 9 个回归 case，纳入 `agent:check:tests`（已包含 `schedulingAgentRuntime.candidateDecision.test.ts`）。
- 每个 case 含 `id` / `userInput` / `expectedDecision` / `mustNotHappen` / `verification` 五字段。

### 9.6 对齐 Verification Gates

- 行为变化：运行 `npm run agent:check`（含 vitest + build）。
- 前台可见交互变化：运行 `npm run agent:browser:goal37` / `goal38`。
- LLM 调用监控：trace 记录 `llmDecisionType` / `llmReasoning` / 是否触发本地兜底 / `selectedSequence`。
- Prompt 版本管理：本次 prompt 修订标注 `v1.1`，trace 中可观测。

---

## 10. 文档同步声明

本次任务为方案评估，未修改代码。实现阶段落地后需同步更新：

- [`docs/code-wiki.md`](file:///./docs/code-wiki.md)：在 `AgentTvSequenceCandidateSelector` 模块索引中补充 `selectEarliestEpisodeFallbackWhenNoBaseline` 方法说明。
- [`docs/agent-development-protocol.md`](file:///./docs/agent-development-protocol.md)：在候选决策章节补充"无基线选最早一期本地兜底"约束。
- [`AGENTS.md`](file:///./AGENTS.md)：Scheduling Guardrails 章节已有"无基线选最早一期"硬约束，无需修改；如需补充"本地兜底"语义可在 Implementation Rules 章节追加一句。

## 11. 归档声明

本次评估未发现需归档的历史遗留文档。`docs/proposals/` 目录为新增，无需在 [`docs/code-wiki.md`](file:///./docs/code-wiki.md) 第 12 节"文档索引"登记（proposals 属方案草案，非约束依据）；如需长期保留，实现完成后由实现角色决定是否迁移至 `docs/` 主目录并登记索引。
