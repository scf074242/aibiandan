# 无顺播基线时未自动选最早一期 — 修复方案 v2.0

- 文档版本：v2.0（取代已归档的 v1.0）
- 撰写角色：solution-architect
- 涉及模块：`src/services/agent/candidateJudge.ts` / `src/mock/data/finishedProducts.json` / `scripts/foreground-browser-goal37.mjs` / `src/services/__tests__/schedulingAgentRuntime.candidateDecision.test.ts`
- 状态：待用户确认（确认后由实现角色落地，再由 code-review-expert 检查）
- 旧方案处置：v1.0 已归档至 [`docs/archive/proposal/no-baseline-earliest-episode-fix-proposal.md`](file:///./docs/archive/proposal/no-baseline-earliest-episode-fix-proposal.md)，归档原因见 [`docs/archive/ARCHIVED.md`](file:///./docs/archive/ARCHIVED.md) `proposal/` 段

---

## 1. 背景

aibiandan 是电视/轮播节目编排 agent，遵循 Codex 设计模式（LLM-first / LLM-only 主路径，本地逻辑只保护结果不改写意图）。

### 1.1 缺陷现象

用户测试单命令"在10点插入《看东方》"，当前播单为空（无顺播基线）。系统查出 4 个候选期次（看东方 111-114 期，假数据时长 3600/2700/2700/1800s）。LLM 候选决策返回 `needs_clarification`，理由是"目标时段时长未知，无法判断哪个候选时长合适"，导致前台卡在"需要你确认具体排哪一个"，没有按项目硬约束自动选最早一期（111 期）。

### 1.2 期望行为

无顺播基线 + 用户给了明确节目名 + 候选有期数时，LLM 应直接 `auto_select` 期数最小的候选（111 期），并在 trace 中说明"按顺播硬约束从最早未播出期次开始"。候选时长明显越界由本地写入校验（`FormalPlaylistWriteAdapter`）暴露失败，**不在 LLM 候选决策层评估时长适配**。

### 1.3 v1.0 方案为何被取代

v1.0 方案推荐"prompt 修正 + 本地后置收敛兜底"双保险（方案 C），核心假设是"LLM 偶发不遵守无基线选最早一期规则，需要本地兜底收敛"。深入调研后发现真实根因并非 LLM 偶发不遵守，而是：

1. **prompt 本身错误**：把"时长适配"列为硬条件，但候选决策 LLM 拿不到目标时段时长数据 → LLM 必然退回 `needs_clarification`。这是确定性 bug，不是偶发。
2. **假数据时长不真实**：看东方 111-114 期假数据时长 3600/2700/2700/1800s 各期不一致，与需求文档（5400s/集）和东方卫视真实播出时长（90-120 分钟）矛盾，加剧了 LLM 的时长判定混乱。

修正 prompt（移除时长适配硬条件）+ 修正假数据时长后，LLM 应能稳定遵守"无基线选最早一期"规则，无需本地兜底。本地兜底是过度设计，违反 LLM-first 原则。

---

## 2. 根因分析（三层，已用户确认）

### 2.1 根因 1：候选决策 LLM 拿不到"目标时段时长"数据（非阻塞，仅记录）

- [`src/services/agent/types.ts`](file:///./src/services/agent/types.ts) L754-L763 `AgentCandidateJudgeInput` 接口没有时段时长字段。
- [`src/services/agent/atomicCommandCapability.ts`](file:///./src/services/agent/atomicCommandCapability.ts) L4716-L4724 调用 `candidateJudge.selectBestCandidate` 时连 `targetTime` 都没传入。
- `SchedulingContext` 没有加载草案 `LayoutDraft` 数据。

**用户决定**：时长适配从硬条件移除，所以 LLM 不再需要时段时长做候选决策，此根因不再阻塞。本方案**不补时段时长数据链路**。

### 2.2 根因 2：prompt 把"时长适配"错误地列为硬条件（核心根因）

[`src/services/agent/candidateJudge.ts`](file:///./src/services/agent/candidateJudge.ts) 的 system prompt：

- **L113**：`'1. 硬条件：素材状态、版权状态、时长是否适配目标时段'` — 把"时长是否适配目标时段"列为第 1 步硬条件。
- **L116**：`'4. 时长适配：候选时长是否适合目标时段'` — 第 4 步评估维度再次出现"时长适配"。

prompt 要求 LLM 评估时长适配，但根因 1 表明 LLM 拿不到时段时长数据 → LLM 必然退回 `needs_clarification`。

**用户明确**：不存在"时长适配是候选决策硬条件"的业务需求。时长适配是写入校验层面（`FormalPlaylistWriteAdapter`）的事，候选决策不应评估时长适配。

### 2.3 根因 3：假数据时长不真实（次级根因，需修正）

- [`src/mock/data/finishedProducts.json`](file:///./src/mock/data/finishedProducts.json) L43-L81 看东方 111-114 期时长：
  - L47：111 期 `duration: 3600`
  - L57：112 期 `duration: 2700`
  - L67：113 期 `duration: 2700`
  - L77：114 期 `duration: 1800`
  - 各期不一致，且与需求文档矛盾。
- 需求文档 `LLM自动编排串联单-需求文档-附录.md` L45 规定看东方单集 5400s（90 分钟）。
- 网络调研：东方卫视《看东方》是早间新闻直播栏目，播出时间周一至周五 7:00-9:00（120 分钟）、周末 7:00-8:00（60 分钟），每集长度 90-120 分钟。5400s（90 分钟）在真实范围内。
- [`scripts/foreground-browser-goal37.mjs`](file:///./scripts/foreground-browser-goal37.mjs) 测试脚本自身矛盾：
  - L1005：112 期 `durationSeconds: 3600`（与 finishedProducts 的 2700s 冲突）
  - L1029/L1050：111 期 `durationSeconds: 2700`
  - L1076/L1331/L1353：112 期 `durationSeconds: 3600`
  - L1241：111 期新春特别行动 `durationSeconds: 3600`
  - L1332/L1354：113 期 `durationSeconds: 2700`

---

## 3. 用户已确认的决策

| # | 决策项 | 决策内容 | 理由 |
|---|---|---|---|
| 1 | 时长适配 | 从候选决策 prompt 硬条件中**完全移除**。硬条件只保留素材状态、版权状态。时长适配交给写入校验（`FormalPlaylistWriteAdapter`）暴露失败，候选决策不再评估时长适配 | 不存在"时长适配是候选决策硬条件"的业务需求；候选决策 LLM 拿不到时段时长数据，强行评估必然退回 `needs_clarification` |
| 2 | 假数据 | 按网络调研到的真实时长修正。看东方 111-114 期时长统一为 5400s（90 分钟，与需求文档一致，在真实范围 90-120 分钟内）。同步修正 goal37.mjs 矛盾 | 假数据时长不真实加剧 LLM 时长判定混乱；与需求文档对齐 |
| 3 | 本地兜底 | **不加**。修正 prompt 后交由 LLM 遵守，符合 LLM-first / 本地不改写意图原则。偶发不遵守时由 `needs_selection` 暴露 | 根因是 prompt 错误表述 + 假数据不真实，修正后 LLM 应能稳定遵守；本地兜底是过度设计，违反 LLM-first |
| 4 | 草案来源 | 用户测试时上传 Excel 真实数据（但代码默认是假数据，本次不改草案加载链路） | 草案加载链路改造超出本次缺陷修复范围 |

---

## 4. 改动点（三处，含精确文件路径和行号）

### 4.1 改动点 1：修正候选决策 prompt（candidateJudge.ts）

**文件**：[`src/services/agent/candidateJudge.ts`](file:///./src/services/agent/candidateJudge.ts)

**位置**：L107-L151 的 system prompt `content` 数组 + L15 `CANDIDATE_JUDGE_PROMPT_VERSION` 常量。

**改动要点**：

1. **L15 版本号**：`CANDIDATE_JUDGE_PROMPT_VERSION = 'v1.0'` → `'v1.1'`（对齐 AGENTS.md "Prompt 版本管理"硬约束，trace 中必须记录 prompt 版本号）。

2. **L113（第 1 步硬条件）**：移除"时长是否适配目标时段"，只保留"素材状态、版权状态"：

   ```
   1. 硬条件：素材状态、版权状态（候选必须素材就绪且版权可用，否则不选）
   ```

3. **L116-L124（评估维度）**：移除第 4 步"时长适配：候选时长是否适合目标时段"，后续步骤序号顺延。时长适配不在候选决策层评估，由写入校验（`FormalPlaylistWriteAdapter`）最终把关。

4. **L136-L139（顺播期数选择规则）**：强化"无顺播基线时 auto_select 最早一期"规则的优先级表述，明确此规则优先于时长考量：

   ```
   顺播期数选择规则（重要，是电视播单候选决策的最高优先级硬规则）：
   - 有顺播基线时：必须选择期望下一集，不能跳集、倒序、重复
   - 无顺播基线时（今天和历史都没播过该系列）：如果用户给了明确节目名且候选有期数，必须 auto_select 最早一期（期数最小的）。这是顺播硬约束，优先于任何时长考量；时长是否适配目标时段不在候选决策层评估，由本地写入校验最终把关
   - 无顺播基线且候选无期数信息或同一期有多个版本：needs_clarification
   ```

5. **保留以下规则不动**（避免破坏其他约束）：
   - 上下文连续性（顺播连续性）评估
   - 内容匹配评估
   - 收视率/热播策略评估（轮播单）
   - `needs_clarification` / `unable_to_decide` 话术约束（一句话点清分叉点 / 最接近候选）
   - `candidateId` 必须在候选列表中、不能虚构
   - JSON-only 返回格式

### 4.2 改动点 2：修正假数据（finishedProducts.json + goal37.mjs）

#### 4.2.1 finishedProducts.json

**文件**：[`src/mock/data/finishedProducts.json`](file:///./src/mock/data/finishedProducts.json)

**改动**：看东方 111-114 期 `duration` 统一改为 `5400`，其他字段不动。

| 行号 | productId | 期次 | 旧值 | 新值 |
|---|---|---|---|---|
| L47 | I101001-0111 | 111 | `3600` | `5400` |
| L57 | I101001-0112 | 112 | `2700` | `5400` |
| L67 | I101001-0113 | 113 | `2700` | `5400` |
| L77 | I101001-0114 | 114 | `1800` | `5400` |

**不改动**其他节目的假数据（如潮童天下等）。

#### 4.2.2 goal37.mjs 测试种子数据

**文件**：[`scripts/foreground-browser-goal37.mjs`](file:///./scripts/foreground-browser-goal37.mjs)

**改动**：看东方相关测试种子数据的 `durationSeconds` 统一为 `5400`，并同步调整 `endTime` 保持与 `startTime + durationSeconds` 一致（测试种子数据是独立构造的，与 finishedProducts.json 无字段绑定关系，需手动同步）。

| 行号 | 节目 | 旧 durationSeconds | 新 durationSeconds | endTime 调整说明 |
|---|---|---|---|---|
| L1005 | 看东方 第112期 | `3600` | `5400` | `07:00-08:00` → `07:00-08:30` |
| L1029 | 看东方 第111期 | `2700` | `5400` | `09:00-09:45` → `09:00-10:30` |
| L1050 | 看东方 第111期 | `2700` | `5400` | `09:00-09:45` → `09:00-10:30` |
| L1076 | 看东方 第112期 | `3600` | `5400` | `07:00-08:00` → `07:00-08:30` |
| L1241 | 看东方111期新春特别行动 | `3600` | `5400` | `00:00-01:00` → `00:00-01:30` |
| L1331 | 看东方 第112期 | `3600` | `5400` | `07:00-08:00` → `07:00-08:30` |
| L1332 | 看东方 第113期 | `2700` | `5400` | `09:00-09:45` → `09:00-10:30` |
| L1353 | 看东方 第112期 | `3600` | `5400` | `07:00-08:00` → `07:00-08:30` |
| L1354 | 看东方 第113期 | `2700` | `5400` | `09:00-09:45` → `09:00-10:30` |

**实现注意**：
- 实现角色落地时需先 `Read` 这几行的实际上下文，确认 `startTime` / `endTime` / `durationSeconds` 三者一致后统一修改。
- 如某行所在 case 的断言依赖原时长（如断言"07:00-08:00"），需同步更新断言。
- `endTime` 调整后可能与后续时段相邻节目产生重叠或邻接关系变化，需检查 case 内其他节目行是否需要顺延（实现角色应跑一次 `npm run agent:browser:goal37` 确认无回归）。

### 4.3 改动点 3：不加本地兜底（明确不动清单）

**不修改**以下文件：

- [`src/services/agent/tvSequenceCandidateSelector.ts`](file:///./src/services/agent/tvSequenceCandidateSelector.ts) 的 `validateCandidateAgainstSequence`（L203-L214）— 保持 `!evidence.hasBaseline` 时 `return null` 的现有行为。
- [`src/services/agent/atomicCommandCapability.ts`](file:///./src/services/agent/atomicCommandCapability.ts) `selectCandidate`（L4546 附近）— 不新增 `selectEarliestEpisodeFallbackWhenNoBaseline` 调用，不新增 `hasExplicitProgramHint` 辅助方法。
- [`src/services/agent/atomicCommandCapability.ts`](file:///./src/services/agent/atomicCommandCapability.ts) L4784-L4805 `needs_clarification` / `unable_to_decide` 透传分支 — 保持原直接透传行为。

**论证**：
- 根因是 prompt 错误表述 + 假数据不真实，修正后 LLM 应能稳定遵守"无基线选最早一期"规则。
- 本地兜底是过度设计，违反 AGENTS.md "LLM-first / LLM-only 主路径：本地逻辑只能保护结果，不能替用户表达或改写意图" 与 "开放自然语言理解必须保持 LLM-first / LLM-only 主路径"。
- 偶发不遵守时由 `needs_selection` 暴露失败（结构化 envelope），用户可重试或补参，符合"失败暴露而非回滚"。
- v1.0 方案的本地兜底逻辑还会向已超红线的 `AtomicCommandCapability`（6193+ 行，P0 技术债）继续堆代码，违反 File Hygiene。

---

## 5. 验证计划

### 5.1 新增/修改 vitest case

**文件**：[`src/services/__tests__/schedulingAgentRuntime.candidateDecision.test.ts`](file:///./src/services/__tests__/schedulingAgentRuntime.candidateDecision.test.ts)（已在 `agent:check:tests` 列表，无需改 `package.json`）

**位置**：`describe('SchedulingAgentRuntime selectCandidate LLM 决策分流', ...)`（L424）内。

**新增 case**：

| Case ID | 场景 | 输入 | 期望 | mustNotHappen |
|---|---|---|---|---|
| Case H1 | 无基线 + 用户明确节目名 + 多期数候选 + LLM auto_select 最早一期 → 透传执行 | 4 候选（看东方 111-114 期，duration 全 5400），mockJudge 返回 `auto_select` 111 期 | `result.status === 'executed'`，`selectedSequence === 111`，trace 含 LLM `auto_select` 决策 | 不应进入 `needs_selection`；不应选 112/113/114 |
| Case H2 | 无基线 + 多期数候选 + LLM needs_clarification → needs_selection（验证不加本地兜底，LLM 偶发不遵守时暴露失败） | 同 H1，mockJudge 返回 `needs_clarification` | `result.status === 'needs_selection'`，trace 不含"本地按顺播硬约束收敛" | 不应 auto_select；不应出现本地兜底 trace |
| Case H3 | 用户明确 cue"最新一期" + 无基线 → 走 `selectLatestIssueCandidateIfRequested`，不触发最早一期 | userInput="插入看东方最新一期"，4 候选 111-114 期 | `selectedSequence === 114`（最大期），trace 含"用户明确要求期数最大" | 不应选 111 |
| Case H4 | 轮播单 + 无基线 + 候选有期数 → 按轮播策略决策，不触发 TV 顺播规则 | `playlistType='rotation'`，4 候选有期数，mockJudge 返回 `needs_clarification` | `result.status === 'needs_selection'`（按轮播策略） | 不应 auto_select 最早一期 |
| Case H5 | 有顺播基线 → 走 `selectBestCandidate` 选期望下一集，不触发无基线路径 | today 编排已有看东方 110 期，候选 111-114，mockJudge 返回 `auto_select` 111 期 | `result.status === 'executed'`，`selectedSequence === 111` | 不应绕过基线校验 |

**Case 字段完整度**：每个 case 必须包含 `id` / `userInput` / `expectedDecision` / `mustNotHappen` / `verification` 五字段（对齐 AGENTS.md Case First）。

**修改受假数据变化影响的现有 case**：

- 现有 Case A-G 中若有断言依赖看东方 111-114 期原时长（3600/2700/2700/1800s），需更新为 5400s。
- 实现角色需跑一次现有 case 全量回归，定位失败断言并修正。

### 5.2 prompt 单元测试

**位置**：同文件 `describe('LlmAgentCandidateJudge 单元决策', ...)` 内。

**新增 case**：

- Case P1：mock LLM 返回 `auto_select` 最早一期（验证 prompt v1.1 修正后 LLM 大多数情况遵守）。
- Case P2：mock LLM 返回 `needs_clarification`（验证不加本地兜底，`selectCandidate` 透传 `needs_selection`）。
- Case P3：验证 prompt 中不再出现"时长适配"硬条件字样（构造 `AgentCandidateJudgeInput`，断言 `buildPrompt` 输出的 system prompt 不含"时长是否适配目标时段"与"时长适配：候选时长是否适合目标时段"）。

### 5.3 门禁

```bash
npm run agent:check
```

- 已包含 `schedulingAgentRuntime.candidateDecision.test.ts`，新增 case 自动纳入门禁。
- 构建检查（`npm run build`）必须通过。
- 长流程门禁：本次不涉及长流程，无需新增长流程 case。

### 5.4 浏览器回归

```bash
npm run agent:browser:goal37
npm run agent:browser:goal38
```

**验证点**：

1. 新建电视播单 → 输入"在10点插入《看东方》"（空播单，无历史）→ 前台应直接执行插入 111 期（5400s），候选决策气泡显示 LLM `auto_select` 决策，不出现"需要你确认具体排哪一个"。
2. 新建电视播单 → 输入"在10点插入《看东方》最新一期" → 前台应执行插入 114 期（验证 latest-issue 路径优先）。
3. 新建轮播单 → 输入"插入看东方" → 前台应进入候选选择（验证轮播单不触发 TV 顺播规则）。
4. Goal 37/38 覆盖矩阵门槛：`supported + guarded_supported` ≥ 80%。

### 5.5 真实 LLM 评估（可选）

```bash
npm run agent:eval:llm
```

在真实 LLM 环境跑一次"在10点插入《看东方》"，确认 prompt v1.1 修正后 LLM 直接 `auto_select` 最早一期，trace 中：
- prompt 版本为 `v1.1`
- LLM `decisionType === 'auto_select'`
- `reasoning` 提及"无顺播基线，按顺播硬约束选最早一期"
- 不出现"时长适配"相关澄清理由

---

## 6. 回归风险与边界

### 6.1 prompt 移除时长适配后的风险

| 风险 | 缓解 |
|---|---|
| LLM 在"候选时长明显越界"时也 `auto_select` | 由 `FormalPlaylistWriteAdapter` 写入校验暴露失败（产出结构化 envelope），不在候选决策阶段拦截。这是用户明确决策的边界 |
| LLM 偶发不遵守"无基线选最早一期"规则 | 由 `needs_selection` 暴露失败，用户可重试或补参。不加本地兜底（用户明确决策） |
| prompt 修正后 LLM 行为变化影响其他场景 | 配套真实 LLM 评估（§5.5）+ Case P1-P3 + 浏览器回归门禁 |

### 6.2 假数据时长统一为 5400s 后的风险

| 风险 | 缓解 |
|---|---|
| 现有依赖 3600/2700/1800 时长的测试断言失败 | 实现角色跑全量回归，定位失败断言并更新为 5400s |
| goal37.mjs 中 `endTime` 调整后与后续时段相邻节目产生重叠或邻接关系变化 | 实现角色检查 case 内其他节目行是否需要顺延，跑 `npm run agent:browser:goal37` 确认无回归 |
| 其他测试文件引用 finishedProducts.json 的看东方时长 | 实现角色全局搜索 `看东方` / `I101001-0111` 等关键字定位受影响测试 |

### 6.3 不在本次范围

- 不修改 `extractSequence` 期数解析逻辑（[`tvSequenceCandidateSelector.ts`](file:///./src/services/agent/tvSequenceCandidateSelector.ts) L389）。
- 不修改 `selectBestCandidate`（有基线路径）。
- 不修改 `validateCandidateAgainstSequence`（有基线后置校验，[`tvSequenceCandidateSelector.ts`](file:///./src/services/agent/tvSequenceCandidateSelector.ts) L203-L214）。
- 不修改 `selectLatestIssueCandidateIfRequested`（latest-issue 路径，[`atomicCommandCapability.ts`](file:///./src/services/agent/atomicCommandCapability.ts) L4555-L4576）。
- 不修改 `FormalPlaylistWriteAdapter`（写入边界）。
- 不补"目标时段时长"数据链路（根因 1 不再阻塞）。
- 不改草案加载链路（用户测试时上传 Excel 真实数据）。
- 不拆分 `AtomicCommandCapability`（P0 债拆分是独立任务）。
- 不新增本地兜底逻辑（用户明确决策）。

### 6.4 边界场景

- 用户明确 cue"最新一期"时不触发本次改动（已有 `selectLatestIssueCandidateIfRequested` 路径，在 LLM 决策前执行）。
- 轮播单不受影响（无顺播约束，按内容匹配 / 收视率 / 热播策略决策）。
- 有顺播基线时不触发本次改动（走 `selectBestCandidate` 选期望下一集）。
- 同一期多版本（如两个 111 期）时 LLM 应返回 `needs_clarification`，本次不改动此行为。

---

## 7. 架构对齐声明

### 7.1 对齐 Design Philosophy

- **LLM-first / LLM-only 主路径**：修正 prompt（移除时长适配硬条件）而非加本地兜底，符合"本地逻辑只能保护结果，不能替用户表达或改写意图"与"开放自然语言理解必须保持 LLM-first / LLM-only 主路径"。本地不替 LLM 评估时长适配，也不替 LLM 选最早一期。
- **失败暴露而非回滚**：不引入 `validateOrRollback` / `mutationJournal` / `autoRollback`；时长越界由 `FormalPlaylistWriteAdapter` 写入校验暴露失败；LLM 偶发不遵守"无基线选最早一期"时由 `needs_selection` 暴露失败，产出结构化 envelope 让用户重试或补参。
- **不引入子 agent**：本次修复不新增 capability、不新增子 agent 雏形，仅修正 prompt 文案 + 假数据。
- **上下文压缩对齐 Codex**：本次不涉及长流程，无需上下文压缩。
- **真 ReAct 循环**：本次不涉及长流程，无需 ReAct 循环。

### 7.2 对齐 Scheduling Guardrails

- "电视剧、连续剧、系列节目不能倒序、跳播、重复排入" → prompt v1.1 强化"无基线选最早一期"规则优先级表述，确保 LLM 遵守。
- "电视频道编排需要优先参考昨日历史编排进度" → 有基线时仍走 `selectBestCandidate`，本次不改动。
- "候选不足、字段冲突、时间冲突、顺播风险无法消解时，应追问、拒绝或保留空缺" → 同一期多版本 / 候选无期数时仍 `needs_clarification`，不强行 `auto_select`。
- "用户给出明确节目名、栏目、内容关键词时，候选库字段级不匹配应拒绝或留空" → prompt 保留内容匹配评估，本次不改动。

### 7.3 对齐 Implementation Rules

- "先追踪现有流程，再做最小实现改动" → 仅改 prompt 文案 + 假数据 + 测试，不新增逻辑分支。
- "本地逻辑只能保护结果，不能替用户表达或改写意图" → 修正 prompt 让 LLM 正确理解"时长适配不是候选决策硬条件"，本地不加兜底不改写 LLM 决策。
- "判断标准：代码如果是在理解用户，就是错误方向；代码如果是在保护结果、校验写入或暴露失败，就是允许保留" → 本次改动是修正 prompt 表述错误（让 LLM 正确理解约束），不引入本地理解逻辑；时长越界由写入校验暴露失败。
- "确定性逻辑只能发生在模型返回之后或写入之前，用来校验、收敛候选、保护结果和暴露失败" → 时长越界校验发生在写入阶段（`FormalPlaylistWriteAdapter`），不在 LLM 前后改写意图。

### 7.4 对齐 File Hygiene

- "单文件代码不超过 2000 行" → 本次仅改 [`candidateJudge.ts`](file:///./src/services/agent/candidateJudge.ts)（prompt 文案 + 版本号常量）、[`finishedProducts.json`](file:///./src/mock/data/finishedProducts.json)（4 行 duration）、[`goal37.mjs`](file:///./scripts/foreground-browser-goal37.mjs)（测试种子数据），不堆入 P0 债文件 [`atomicCommandCapability.ts`](file:///./src/services/agent/atomicCommandCapability.ts)（6193+ 行）。
- "新增能力位置约束" → 本次不新增 agent 长程业务能力，不新增 capability。
- "大文件拆分原则" → 本次不涉及拆分。

### 7.5 对齐 Case First

- 新增 Case H1-H5 + P1-P3 共 8 个回归 case，纳入 `agent:check:tests`（已包含 `schedulingAgentRuntime.candidateDecision.test.ts`）。
- 每个 case 含 `id` / `userInput` / `expectedDecision` / `mustNotHappen` / `verification` 五字段。

### 7.6 对齐 Verification Gates

- 行为变化：运行 `npm run agent:check`（含 vitest + build）。
- 前台可见交互变化：运行 `npm run agent:browser:goal37` / `goal38`。
- LLM 调用监控：trace 记录 `promptVersion: 'v1.1'` / `llmDecisionType` / `llmReasoning` / `selectedSequence`。
- Prompt 版本管理：本次 prompt 修订标注 `v1.1`（`CANDIDATE_JUDGE_PROMPT_VERSION` 常量从 `'v1.0'` 升到 `'v1.1'`），trace 中可观测。
- 浏览器回归门禁：Goal 37/38 覆盖矩阵门槛 `supported + guarded_supported` ≥ 80%。

### 7.7 对齐 Documentation Discipline

- 文档内引用代码使用相对路径（`file:///./src/...`），不使用绝对路径 `/C:/Users/...`。
- 旧方案 v1.0 已归档至 [`docs/archive/proposal/`](file:///./docs/archive/proposal/)，归档原因已在 [`docs/archive/ARCHIVED.md`](file:///./docs/archive/ARCHIVED.md) 登记。
- 测试统计不写死具体数字。

---

## 8. 文档同步声明

本次任务为方案评估，未修改代码。实现阶段落地后需同步更新：

- [`docs/code-wiki.md`](file:///./docs/code-wiki.md)：在 `LlmAgentCandidateJudge` 模块索引中补充 prompt v1.1 变更说明（移除时长适配硬条件）。
- [`docs/agent-development-protocol.md`](file:///./docs/agent-development-protocol.md)：在候选决策章节补充"时长适配不在候选决策层评估，由 `FormalPlaylistWriteAdapter` 写入校验最终把关"约束。
- [`AGENTS.md`](file:///./AGENTS.md)：Scheduling Guardrails 章节已有"无基线选最早一期"硬约束，无需修改；Implementation Rules 章节已有"LLM-first / 本地不改写意图"约束，无需修改。
- [`docs/archive/ARCHIVED.md`](file:///./docs/archive/ARCHIVED.md)：已在本次任务中更新 v1.0 旧方案归档原因（标注"基于错误假设被新方案取代"）。

---

## 9. 归档声明

本次任务发现 v1.0 旧方案 [`docs/archive/proposal/no-baseline-earliest-episode-fix-proposal.md`](file:///./docs/archive/proposal/no-baseline-earliest-episode-fix-proposal.md) 基于"需要本地兜底"的错误假设，已在新方案中取代。归档原因已在 [`docs/archive/ARCHIVED.md`](file:///./docs/archive/ARCHIVED.md) `proposal/` 段登记，保留旧方案原文供历史可追溯。本次未发现其他需归档的历史遗留文档。

---

## 10. 失败暴露声明

本次方案**不引入**自动回滚链路（无 `validateOrRollback` / `mutationJournal` / `autoRollback`），**不引入**子 agent（无 DraftAgent / CandidateAgent / SelectionAgent / WriteAgent / ValidationAgent）。失败处理路径：

- LLM 候选决策返回 `needs_clarification` / `unable_to_decide` 时：透传给前台产出 `needs_selection` 结构化 envelope（含 `candidateOptions`），让用户重试或补参。
- 候选时长明显越界目标时段时：由 `FormalPlaylistWriteAdapter` 写入校验暴露失败，产出结构化 envelope，不在候选决策层拦截。
- LLM 偶发不遵守"无基线选最早一期"规则时：由 `needs_selection` 暴露失败，用户可重试。不加本地兜底（用户明确决策）。

失败 envelope 结构化，符合 AGENTS.md "失败暴露而非回滚"硬约束。
