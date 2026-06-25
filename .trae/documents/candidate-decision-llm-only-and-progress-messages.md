# Plan：候选决策 LLM-only 化与进度消息补齐

> 范围：用户自然语言 → LLM 意图理解 → 查节目库 → LLM 候选决策 → 写入编排单 这条短链路的两个遗留问题：
> 1. 多候选时仍展示为多条记录（缺失 LLM 候选决策环节）
> 2. 缺失"查节目库"和"候选决策"的系统提示信息（进度消息不完整）

---

## 一、Summary（摘要）

- **删除** `DefaultAgentCandidateJudge` 本地评分选择器——它用关键词匹配打分（name 100 / instanceName 70 / column 30 / tags 20 等）替代 LLM 决策，违反 AGENTS.md 的 LLM-only 主路径原则，属历史遗留的"本地分类器"。
- **保留** `AgentTvSequenceCandidateSelector` 作为 TV 顺播证据提供者——但角色从"前置过滤候选"转为"为 LLM 提供顺播证据 + 本地后置校验"。
- **新增** `LlmAgentCandidateJudge`：基于 LlmClient 的候选决策器，返回 `{ candidate, reasoning, considerations, decisionType, candidateOptions? }`，失败时暴露失败（不本地兜底）。
- **重写** `selectCandidate` 多候选收敛逻辑：LLM 看到全部候选 + 顺播证据决策，本地后置校验顺播硬约束 + 按 `decisionType` 分流。
- **补齐** "候选决策"独立进度消息，形成完整 4 条消息流（理解需求 → 查节目库 → 候选决策 → 插入结果）。

---

## 二、约束合规检查（基于项目文档全量审阅）

本方案已对照以下约束文档逐条核对：[AGENTS.md](file:///c:/Users/Administrator/Documents/Playground/aibiandan/AGENTS.md)、[docs/aibiandan-agent-rules.md](file:///c:/Users/Administrator/Documents/Playground/aibiandan/docs/aibiandan-agent-rules.md)、[docs/agent-development-protocol.md](file:///c:/Users/Administrator/Documents/Playground/aibiandan/docs/agent-development-protocol.md)。

### 必须遵守的约束

| 编号 | 约束内容 | 来源 | 本方案合规方式 |
|---|---|---|---|
| C1 | LLM-first / LLM-only 主路径；删除所有会在 LLM 前或 LLM 后强行改写用户意图的本地关键词分类、续接、补意图、兜底澄清和隐藏限制 | AGENTS.md | 删除 `DefaultAgentCandidateJudge` 本地评分；新增 `LlmAgentCandidateJudge` 走 LLM |
| C2 | 本地逻辑只能保护结果：保留时间换算、写入校验、草案完整度判断、危险操作保护、正式播单和草案隔离、模型返回结构校验、执行边界和失败报错 | AGENTS.md | 保留 `AgentTvSequenceCandidateSelector` 做顺播证据 + 后置校验；保留 `AgentPlaylistPolicy` 写入分流 |
| C3 | 判断标准：代码如果是在理解用户，就是错误方向；代码如果是在保护结果、校验写入或暴露失败，是允许保留 | AGENTS.md | 本地评分（理解用户）→ 删除；顺播校验（保护结果）→ 保留 |
| C4 | 确定性逻辑只能发生在模型返回之后或写入之前，用来校验、收敛候选、保护结果和暴露失败 | AGENTS.md | 顺播后置校验发生在 LLM 返回之后、写入之前 |
| C5 | LLM 选择节目时，要模拟经验丰富的编排人员：先看硬条件，再看上下文连续性，再看内容匹配、时长适配、收视率或热播策略，最后给出拒绝理由 | AGENTS.md | LLM prompt 明确要求按此顺序给出 reasoning |
| C6 | 不凭单条正则或单次猜测绕过完整链路 | AGENTS.md | 候选决策走 LLM 完整链路，不本地猜测 |
| C7 | 候选不足、字段冲突、时间冲突、顺播风险无法消解时，应追问、拒绝或保留空缺，而不是强行编排 | AGENTS.md | LLM 返回 `needs_clarification`/`unable_to_decide` 时进入 needs_selection |
| C8 | 如果模型无法返回有效理解或可读解释，应像 Codex 一样暴露失败并允许用户重试或补充 | AGENTS.md | LLM 失败/超时/结构无效 → 返回 `unable_to_decide` + 失败原因 → needs_selection |
| C9 | 除 pending 的确认/取消/候选选择，以及明确按钮 quick action 这类非自由文本入口外，用户自然语言不得先被本地分类器截走 | aibiandan-agent-rules.md L74 | 候选决策由 LLM 承担，本地不做意图分类 |
| C10 | 连续剧、周播节目或其他有期数顺序的内容，必须先用当前/历史编排证据判断上一期，再顺接下一期 | aibiandan-agent-rules.md L29 | `AgentTvSequenceCandidateSelector` 提供顺播证据给 LLM，LLM 据此决策 |
| C11 | 如果顺播/期数证据把候选收敛到唯一可排节目，并且没有素材、版权、时长或冲突硬阻断，可以直接编排，并在回复里说明顺接依据 | aibiandan-agent-rules.md L30 | LLM 返回 `auto_select` + 顺播校验通过 → direct_execute（TV） |
| C12 | 如果同一期仍有多个版本、没有顺播基线、或只是标题相似/热度更高，不能自动替用户选择 | aibiandan-agent-rules.md L31 | 这是 TV 极端场景；LLM 在此场景返回 `needs_clarification` → needs_selection |
| C13 | 内部可以保留评分、排序和审计字段；用户可见主回复、确认理由和候选说明不能出现"置信度""匹配度"这类技术词 | aibiandan-agent-rules.md L11 | 进度消息用"候选决策"标签，文案用自然语言（"在 N 个候选中选择《xxx》，理由：..."），不出现技术词 |
| C14 | AI编审助手应该像懂编排业务的人一样交流；系统过程、候选数、检索证据可以保留，但不抢主回复 | aibiandan-agent-rules.md L10 | 进度消息为系统过程，不抢主回复；主回复是插入结果 |
| C15 | LLM 可以生成任务计划和解释，但本地系统决定能不能写入 | aibiandan-agent-rules.md L53 | LLM 给决策 + reasoning，本地按 `decisionType` + 顺播校验决定是否写入 |
| C16 | 若涉及 LLM，提示词必须明确"经验丰富编排人员"的选择顺序：硬条件、上下文连续性、内容匹配、时长适配、策略偏好、拒绝理由 | agent-development-protocol.md L76 | LLM prompt 明确此顺序 |
| C17 | Must Refuse：连续剧、系列节目出现倒序、跳集、重复或从未来集数回填到更早时段——不能强行编排 | agent-development-protocol.md L213 | 顺播后置校验拒绝跳集/倒序/重复 |

### 用户澄清的边界

- **约束 C12 的适用范围**：C12 是 TV 极端场景。正常情况下：
  - 候选不多 + LLM 能选出唯一靠谱的 → 可以自动执行（C11）
  - 候选很多 + 难以给出有理有据回答 → LLM 推荐列表 + 让用户澄清 → needs_selection
- **约束 20 的 OpenClaw 上下文**：OpenClaw 已不存在，"多候选自动选"红线的 OpenClaw 上下文失效；但"多候选自动选"在 C12 TV 极端场景下仍需遵守

---

## 三、Current State Analysis（现状分析）

### 问题 1：候选展示为两条记录（缺失 LLM 决策）

**根因**：[atomicCommandCapability.ts#L4571-L4588](file:///c:/Users/Administrator/Documents/Playground/aibiandan/src/services/agent/atomicCommandCapability.ts#L4571-L4588) 的多候选拦截逻辑——`judgeCandidates.length > 1` 时直接返回 `candidateOptions` 进入 `needs_selection`，**跳过**了 4590 行的 `candidateJudge.selectBestCandidate` 调用：

```typescript
// 4570-4588 行 - 多候选拦截（问题点）
const judgeCandidates = playableJudgeCandidates.length > 0 ? playableJudgeCandidates : rawJudgeCandidates
if (judgeCandidates.length > 1) {
  runtime.trace.record('needs_selection', '候选判断前发现多个可用候选，等待编排人员选择。', {...})
  return {
    candidate: null,
    candidateOptions: judgeCandidates,  // 直接展示全部候选，无 LLM 决策
    diagnostics: { method: 'candidate_judge', source: 'fallback', ... },
  }
}
// 4590 行 - LLM/本地选择（被上面的拦截跳过）
const candidate = await runtime.candidateJudge.selectBestCandidate({...})
```

**后果**：用户看到两条候选记录，但中间没有"LLM 正在决策"的过程反馈。

### 问题 2：本地评分违反 LLM-only（C1/C3/C9）

**根因**：[candidateJudge.ts](file:///c:/Users/Administrator/Documents/Playground/aibiandan/src/services/agent/candidateJudge.ts) 的 `DefaultAgentCandidateJudge.selectBestCandidate` 用本地关键词匹配打分替代 LLM 决策：

```typescript
// candidateJudge.ts:11-33 - 本地评分（违反 LLM-only）
private scoreCandidate(candidate, input): number {
  if (normalizedName && normalizedInput.includes(normalizedName)) score += 100
  if (normalizedInstanceName && normalizedInput.includes(normalizedInstanceName)) score += 70
  if (normalizedColumn && normalizedInput.includes(normalizedColumn)) score += 30
  if (normalizedTags && normalizedTags.split(/\s+/).some(...)) score += 20
  // ... 收视率/热播/专业评分累加
}
```

**违反约束**：C1（LLM-only）、C3（理解用户是错误方向）、C9（不得本地分类器截走）

**调用与注入点**：
- 调用：仅 [atomicCommandCapability.ts#L4590](file:///c:/Users/Administrator/Documents/Playground/aibiandan/src/services/agent/atomicCommandCapability.ts#L4590) 一处
- 注入：[schedulingAgentRuntime.ts#L70](file:///c:/Users/Administrator/Documents/Playground/aibiandan/src/services/agent/schedulingAgentRuntime.ts#L70) `this.candidateJudge = options.candidateJudge ?? new DefaultAgentCandidateJudge()`
- 接口：[types.ts#L670-L681](file:///c:/Users/Administrator/Documents/Playground/aibiandan/src/services/agent/types.ts#L670-L681)

### 问题 3：缺失"候选决策"独立进度消息

**根因**：[demoRuntimeFacade.ts#L5030-L5103](file:///c:/Users/Administrator/Documents/Playground/aibiandan/src/services/runtime/demoRuntimeFacade.ts#L5030-L5103) 的 `buildAgentTraceProgressEvent` 已有三类进度消息分支，但缺失"候选决策"类：

| 分支 | processTypeLabel | 状态 |
|---|---|---|
| `Agent intent interpreter 返回结构化意图` | 理解需求 | 已有 |
| `调用节目查询服务查找候选` | 查节目库 | 已有 |
| `Candidate search retried...` | 继续查找 | 已有 |
| **候选决策类** | **候选决策** | **缺失** |

**期望消息流**（以插入节目为例，用户已确认）：
1. 第 1 条：LLM 意图理解的理解性反馈（"理解需求"）
2. 第 2 条：系统信息，露出查询关键词（"查节目库"）
3. 第 3 条：LLM 决策思路 + 最终选择（"候选决策"——**需新增**）
4. 第 4 条：插入节目单结果

---

## 四、TV 顺播逻辑兼容性分析（后置校验方案）

> 用户选择：后置校验（LLM-first）——LLM 看到全部候选 + 顺播证据自己决策，本地后置校验

### `AgentTvSequenceCandidateSelector` 的角色转变

**现状**（[tvSequenceCandidateSelector.ts](file:///c:/Users/Administrator/Documents/Playground/aibiandan/src/services/agent/tvSequenceCandidateSelector.ts)）：作为"前置过滤候选"的选择器，直接返回 candidate 或 candidateOptions。

**新角色**：作为"顺播证据提供者 + 后置校验器"：
1. **决策前**：计算顺播证据（`{ expectedSequence, seriesKey, todayMax, historyMax, source }`），作为 context 透传给 LLM
2. **决策后**：校验 LLM 选择的 candidate 是否符合顺播硬约束（C17：不能跳集/倒序/重复）

### LLM 决策空间与本地后置校验

| 场景 | LLM 行为 | 本地后置校验 | 结果 |
|---|---|---|---|
| 顺播证据收敛到唯一可排节目（C11） | 返回 `auto_select` + candidate + reasoning | 校验 candidate 期数 = expectedSequence | direct_execute（TV）/ confirm_before_commit（Rotation） |
| 候选不多 + LLM 能选出唯一靠谱的 | 返回 `auto_select` + candidate + reasoning | 校验顺播硬约束（跳集/倒序/重复） | direct_execute / confirm_before_commit |
| 候选很多 + 难以给出有理有据回答 | 返回 `needs_clarification` + candidateOptions + reasoning | 不校验（LLM 已自判需澄清） | needs_selection（展示推荐列表 + 澄清请求） |
| 同一期多个版本/没有顺播基线/标题相似热度更高（C12 TV 极端） | 返回 `needs_clarification` + candidateOptions + reasoning | 不校验 | needs_selection |
| LLM 失败/超时/结构无效（C8） | 返回 `unable_to_decide` + 失败原因 | 不校验 | needs_selection（暴露失败） |
| LLM 选了跳集/倒序/重复候选（C17） | 返回 `auto_select` + candidate | **校验失败**，拒绝 | needs_selection（暴露顺播违规） |

### 漏洞排查

| 潜在漏洞 | 是否存在 | 说明 |
|---|---|---|
| LLM 选了跳集的候选 | 否 | 本地后置校验 candidate 期数 vs expectedSequence，不符合则拒绝（C17） |
| LLM 选了倒序的候选 | 否 | 同上 |
| LLM 选了重复的候选 | 否 | 同上（expectedSequence = max+1，不会重复） |
| LLM 在 C12 极端场景自动选 | 否 | LLM 自判返回 `needs_clarification`；即使 LLM 误返回 `auto_select`，本地无顺播基线时也不阻止 needs_selection（保守起见，无顺播基线时强制 needs_selection） |
| LLM 决策延迟影响体验 | 是（可接受） | 通过进度消息反馈 + 失败兜底控制 |
| LLM 决策失败导致卡死 | 否 | 失败时进入 needs_selection，用户可手动选 |

---

## 五、Proposed Changes（具体修改方案）

### 修改 1：删除 `DefaultAgentCandidateJudge`，新增 `LlmAgentCandidateJudge`

**文件**：`src/services/agent/candidateJudge.ts`（重写）

**接口改造**（[types.ts#L670-L681](file:///c:/Users/Administrator/Documents/Playground/aibiandan/src/services/agent/types.ts#L670-L681)）：

```typescript
// 输入：增加顺播证据透传字段
export interface AgentCandidateJudgeInput {
  userInput: string
  playlistType: PlaylistType
  commandIntent: AtomicCommandIntent
  candidates: AgentProgramCandidate[]
  context: SchedulingContext
  professionalAssessments?: Record<string, AgentCandidateProfessionalAssessment>
  tvSequenceEvidence?: AgentTvSequenceEvidence  // 新增：顺播证据（非诊断）
}

// 顺播证据结构（从 tvSequenceSelector 提取，不含决策）
export interface AgentTvSequenceEvidence {
  playlistType: PlaylistType
  expectedSequence?: number      // 期望下一集期数
  seriesKey?: string             // 系列标识
  source: 'today' | 'history' | 'none'  // 证据来源
  todayMaxSequence?: number      // 今天最大期数
  historyMaxSequence?: number    // 历史最大期数
  hasBaseline: boolean           // 是否有顺播基线
}

// LLM 决策类型
export type AgentCandidateDecisionType = 
  | 'auto_select'              // 候选不多 + 唯一靠谱，可自动执行
  | 'needs_clarification'      // 候选很多/无顺播基线/同一期多版本，需用户澄清
  | 'unable_to_decide'         // LLM 失败/超时/结构无效

// 输出：决策结果（含理由 + 决策类型）
export interface AgentCandidateDecision {
  candidate: AgentProgramCandidate | null       // 选中的候选（auto_select 时非 null）
  reasoning: string                             // 决策思路（用于第三条进度消息）
  considerations?: string[]                     // 评估要点（可选）
  decisionType: AgentCandidateDecisionType      // 决策类型
  candidateOptions?: AgentProgramCandidate[]    // needs_clarification 时的推荐列表
}

export interface AgentCandidateJudge {
  selectBestCandidate(input: AgentCandidateJudgeInput): Promise<AgentCandidateDecision>
}
```

**新实现 `LlmAgentCandidateJudge`**：

```typescript
export class LlmAgentCandidateJudge implements AgentCandidateJudge {
  constructor(private readonly options: { llmClient: Pick<LLMClient, 'chat'> }) {}

  async selectBestCandidate(input: AgentCandidateJudgeInput): Promise<AgentCandidateDecision> {
    // 1. 构造候选决策 prompt（含候选列表、上下文、顺播证据、用户意图）
    //    prompt 明确要求 LLM 按"经验丰富编排人员"顺序评估（C5/C16）：
    //    硬条件 → 上下文连续性 → 内容匹配 → 时长适配 → 收视率/热播策略 → 拒绝理由
    //    prompt 明确要求 LLM 自判 decisionType：
    //    - 候选不多 + 唯一靠谱 → auto_select
    //    - 候选很多/无顺播基线/同一期多版本 → needs_clarification
    //    - 无法决策 → unable_to_decide
    // 2. 调用 LLM，要求返回 { candidateId, reasoning, considerations, decisionType } JSON
    // 3. 校验返回结构 + candidateId 在候选列表中（C2 模型返回结构校验）
    // 4. 失败/超时/结构无效 → 返回 { candidate: null, reasoning: 'LLM 候选决策失败：xxx', decisionType: 'unable_to_decide' }（C8 暴露失败）
    // 5. needs_clarification 时，candidateOptions = 原候选列表（或 LLM 排序后的前 N 个）
  }
}
```

**关键约束**：
- LLM 必须基于"硬条件 + 上下文连续性 + 内容匹配 + 时长适配 + 收视率/热播策略"给出 reasoning（C5/C16）
- LLM 自判 decisionType，本地不替 LLM 判断"是否能自动选"（C1/C9）
- 返回的 candidateId 不在候选列表中 → 视为失败（C2）
- 不在 LLM 前后做关键词改写或兜底评分（C1）

### 修改 2：注入 LlmClient 到 LlmAgentCandidateJudge

**文件**：`src/services/agent/schedulingAgentRuntime.ts`

- [第 6 行](file:///c:/Users/Administrator/Documents/Playground/aibiandan/src/services/agent/schedulingAgentRuntime.ts#L6)：`import { DefaultAgentCandidateJudge } from './candidateJudge'` → `import { LlmAgentCandidateJudge } from './candidateJudge'`
- [第 31 行](file:///c:/Users/Administrator/Documents/Playground/aibiandan/src/services/agent/schedulingAgentRuntime.ts#L31)：`SchedulingAgentRuntimeOptions` 增加 `llmClient?: Pick<LLMClient, 'chat'>` 字段
- [第 70 行](file:///c:/Users/Administrator/Documents/Playground/aibiandan/src/services/agent/schedulingAgentRuntime.ts#L70)：`this.candidateJudge = options.candidateJudge ?? new LlmAgentCandidateJudge({ llmClient: options.llmClient ?? defaultLlmClient })`
- 需确认默认 llmClient 来源（从 `llmConfig` 或调用方注入）

### 修改 3：重写 `selectCandidate` 多候选收敛逻辑（后置校验）

**文件**：`src/services/agent/atomicCommandCapability.ts`

**修改点**：[L4460-L4618](file:///c:/Users/Administrator/Documents/Playground/aibiandan/src/services/agent/atomicCommandCapability.ts#L4460-L4618)

**核心改动**：
1. `tvSequenceSelector` 不再前置过滤候选，改为提供顺播证据
2. 多候选时调用 `candidateJudge.selectBestCandidate`（现在是 LLM 决策）
3. 本地后置校验 LLM 选择是否符合顺播硬约束
4. 按 `decisionType` 分流

**修改后逻辑**：

```typescript
private async selectCandidate(
  input: AgentSubmitInput,
  runtime: AgentCapabilityRuntime,
  context: SchedulingContext,
  commandIntent: 'insert' | 'replace',
  candidates: AgentProgramCandidate[],
  targetTime?: string,
  replacementTarget?: ScheduleItemSnapshot,
): Promise<CandidateSelectionResult> {
  // ... 前置 latestIssueSelection 逻辑保留（用户明确要求期数最大时）

  // 1. 提取顺播证据（不再前置过滤）
  const tvSequenceEvidence = this.tvSequenceSelector.buildEvidence(context, candidates)
  runtime.trace.record('planning', '电视播单顺播证据检查', {
    commandIntent,
    candidateCount: candidates.length,
    evidence: tvSequenceEvidence,
  })

  // 2. 专业评估过滤硬阻断候选（保护结果，C2）
  const professionalAssessmentByCandidateId = new Map<string, AgentCandidateProfessionalAssessment>()
  const playableCandidates = candidates.filter((candidate) => {
    const assessment = this.buildProfessionalAssessment(candidate, input, context, commandIntent, targetTime, replacementTarget)
    professionalAssessmentByCandidateId.set(candidate.id, assessment)
    return assessment.hardBlockCodes.length === 0
  })
  const judgeCandidates = playableCandidates.length > 0 ? playableCandidates : candidates

  // 3. 调用 LLM 候选决策
  if (judgeCandidates.length > 1) {
    runtime.trace.record('planning', '候选决策前发现多个可用候选，调用 LLM 在候选中决策。', {
      commandIntent,
      candidateCount: judgeCandidates.length,
      candidateOptionIds: judgeCandidates.slice(0, 8).map((c) => c.id),
      tvSequenceEvidence,
    })
  }

  const judgePool = this.prepareCandidateJudgePool(judgeCandidates, input, context, commandIntent, targetTime, replacementTarget)
  const decision = await runtime.candidateJudge.selectBestCandidate({
    userInput: input.userInput,
    playlistType: context.playlistType,
    commandIntent,
    candidates: judgePool.candidates,
    context,
    professionalAssessments: judgePool.assessments,
    tvSequenceEvidence,  // 透传顺播证据
  })

  // 4. 记录 LLM 决策结果（用于第三条进度消息）
  runtime.trace.record('planning', 'LLM 候选决策完成', {
    commandIntent,
    candidateCount: judgeCandidates.length,
    selectedCandidateId: decision.candidate?.id ?? null,
    selectedCandidateName: decision.candidate?.programName ?? decision.candidate?.instanceName ?? '',
    reasoning: decision.reasoning,
    considerations: decision.considerations ?? [],
    decisionType: decision.decisionType,
  })

  // 5. 按 decisionType 分流 + 后置校验
  // 5a. auto_select：本地后置校验顺播硬约束
  if (decision.decisionType === 'auto_select' && decision.candidate) {
    const sequenceViolation = this.validateTvSequenceConstraint(
      decision.candidate,
      tvSequenceEvidence,
      context,
    )
    if (sequenceViolation) {
      // C17：顺播违规，拒绝并暴露失败
      runtime.trace.record('needs_selection', 'LLM 选择的候选违反顺播硬约束，已拒绝。', {
        commandIntent,
        violation: sequenceViolation,
        selectedCandidateId: decision.candidate.id,
      })
      return {
        candidate: null,
        candidateOptions: judgeCandidates,
        diagnostics: {
          method: 'candidate_judge_llm',
          source: 'none',
          failureReason: `顺播校验失败：${sequenceViolation}`,
          candidateCount: judgeCandidates.length,
          reason: `LLM 选择的候选违反顺播规则（${sequenceViolation}），请手动选择。`,
        },
      }
    }
    // 顺播校验通过 → direct_execute（TV）/ confirm_before_commit（Rotation）
    return {
      candidate: decision.candidate,
      diagnostics: {
        method: 'candidate_judge_llm',
        source: 'fallback',
        selectedCandidateId: decision.candidate.id,
        reasoning: decision.reasoning,
        considerations: decision.considerations,
        candidateCount: judgeCandidates.length,
        reason: decision.reasoning,
      },
    }
  }

  // 5b. needs_clarification / unable_to_decide：进入 needs_selection
  runtime.trace.record('needs_selection', 'LLM 候选决策需用户澄清或无法决策，等待编排人员选择。', {
    commandIntent,
    candidateCount: judgeCandidates.length,
    decisionType: decision.decisionType,
    failureReason: decision.reasoning,
  })
  return {
    candidate: null,
    candidateOptions: decision.candidateOptions ?? judgeCandidates,
    diagnostics: {
      method: 'candidate_judge_llm',
      source: 'none',
      decisionType: decision.decisionType,
      failureReason: decision.reasoning,
      candidateCount: judgeCandidates.length,
      reason: decision.decisionType === 'unable_to_decide'
        ? `LLM 候选决策失败：${decision.reasoning}。请在下方候选中选择。`
        : `LLM 建议需用户确认：${decision.reasoning}。请在下方候选中选择。`,
    },
  }
}
```

**新增辅助方法**：
- `tvSequenceSelector.buildEvidence(context, candidates)`：提取顺播证据（不返回候选）
- `validateTvSequenceConstraint(candidate, evidence, context)`：后置校验 LLM 选择是否符合顺播硬约束（C17）

**单候选分支**（`judgeCandidates.length === 1`）：保留直接返回，但仍调用 LLM 给出 reasoning（用于进度消息一致性）。

### 修改 4：新增"候选决策"独立进度消息

**文件**：`src/services/runtime/demoRuntimeFacade.ts`

**修改点**：`buildAgentTraceProgressEvent` 函数（[L5030-L5103](file:///c:/Users/Administrator/Documents/Playground/aibiandan/src/services/runtime/demoRuntimeFacade.ts#L5030-L5103)），在"继续查找"分支后新增"候选决策"分支：

```typescript
// 新增分支：LLM 候选决策完成
if (step.status === 'planning' && step.label === 'LLM 候选决策完成') {
  const reasoning = typeof detail.reasoning === 'string' ? detail.reasoning.trim() : ''
  const considerations = Array.isArray(detail.considerations)
    ? detail.considerations.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : []
  const selectedName = typeof detail.selectedCandidateName === 'string' ? detail.selectedCandidateName.trim() : ''
  const selectedCandidateId = typeof detail.selectedCandidateId === 'string' ? detail.selectedCandidateId : null
  const candidateCount = typeof detail.candidateCount === 'number' ? detail.candidateCount : 0
  const decisionType = typeof detail.decisionType === 'string' ? detail.decisionType : ''

  // C13：不出现"置信度""匹配度"等技术词，用自然语言
  let decisionText: string
  if (decisionType === 'auto_select' && selectedName) {
    decisionText = `在 ${candidateCount} 个候选中选择「${selectedName}」`
  } else if (decisionType === 'needs_clarification') {
    decisionText = `查到 ${candidateCount} 个候选，需要你确认具体排哪个`
  } else if (decisionType === 'unable_to_decide') {
    decisionText = `查到 ${candidateCount} 个候选，但 LLM 暂时无法给出有把握的选择`
  } else {
    decisionText = `查到 ${candidateCount} 个候选`
  }
  const reasoningText = reasoning ? `，理由：${reasoning}` : ''
  const considerationsText = considerations.length > 0 ? `。评估要点：${considerations.join('；')}` : ''

  return {
    id: `agent-trace:${input.scheduleState.playlistId ?? input.scheduleState.playlistType}:candidate-decision:${step.sequence}`,
    content: `${decisionText}${reasoningText}${considerationsText}。`,
    processType: 'selection',
    processTypeLabel: '候选决策',
    details: {
      progressStage: 'candidate_decision',
      selectedCandidateId,
      selectedCandidateName: selectedName,
      reasoning,
      considerations,
      candidateCount,
      decisionType,
      noMutation: true,
    },
  }
}
```

**同步检查**：`buildAgentAssistantProcessSummary`（[demoRuntimeFacade.ts#L5690 附近](file:///c:/Users/Administrator/Documents/Playground/aibiandan/src/services/runtime/demoRuntimeFacade.ts#L5690)）——确认是否需要同步更新"已筛出 N 个候选"摘要文案，避免与新的"候选决策"进度消息重复。

### 修改 5：UI 渲染层确认

**文件**：`src/components/dialogue/ChatPanel.vue`

- 确认 `system-process-strip` 对 `processTypeLabel: '候选决策'` 的渲染样式（应与"查节目库"一致，属 selection 类）
- 确认 `handleRuntimeProgress` 推送独立消息的逻辑对新 processTypeLabel 透明（无需特殊处理）
- **不修改 UI 组件**，仅确认兼容性

### 修改 6：测试 case 补齐

**文件**：新增 `src/services/__tests__/schedulingAgentRuntime.candidateDecision.test.ts`

**新增最小回归 case**（符合 agent-development-protocol.md Case 结构）：

| Case | 场景 | 期望行为 | 约束 |
|---|---|---|---|
| A | TV 顺播收敛到唯一 + LLM auto_select | direct_execute，进度消息含"候选决策"，trace 含 reasoning | C11 |
| B | TV 多候选 + LLM auto_select + 顺播校验通过 | direct_execute，进度消息含决策思路 | C5 |
| C | TV 多候选 + LLM needs_clarification | needs_selection，进度消息含"需要你确认" | C7/C12 |
| D | TV 多候选 + LLM auto_select + 顺播违规 | needs_selection，暴露顺播违规 | C17 |
| E | Rotation 多候选 + LLM auto_select | confirm_before_commit，进度消息含"候选决策" | C2 |
| F | LLM 失败/超时（unable_to_decide） | needs_selection，暴露失败原因 | C8 |
| G | 消息流序列 | 断言进度消息顺序：理解需求 → 查节目库 → 候选决策 | C14 |

**纳入 `agent:check`**：将新测试文件加入 [package.json#L29](file:///c:/Users/Administrator/Documents/Playground/aibiandan/package.json#L29) `agent:check:tests` 的文件列表。

**LLM Mock 策略**：测试中使用 mock LlmClient，返回预设的 `{ candidateId, reasoning, considerations, decisionType }` JSON，避免真实 LLM 调用。

### 修改 7：`AgentTvSequenceCandidateSelector` 新增 `buildEvidence` 方法

**文件**：`src/services/agent/tvSequenceCandidateSelector.ts`

**新增方法**（不破坏现有 `selectBestCandidate`，后续可标记 deprecated）：

```typescript
// 提取顺播证据，不做候选决策
buildEvidence(context: SchedulingContext, candidates: AgentProgramCandidate[]): AgentTvSequenceEvidence {
  if (context.bundle.identity.playlistType !== 'tv') {
    return { playlistType: 'rotation', source: 'none', hasBaseline: false }
  }
  const todayFacts = this.collectFacts(context.bundle.today.scheduleItems)
  const historyFacts = this.collectFacts(context.bundle.history.latestSchedule?.items ?? [])
  // 找到候选中的系列键，匹配今天/历史基线
  // 返回 { playlistType: 'tv', expectedSequence, seriesKey, source, todayMaxSequence, historyMaxSequence, hasBaseline }
}

// 后置校验：LLM 选择的候选是否符合顺播硬约束
validateCandidateAgainstSequence(candidate: AgentProgramCandidate, evidence: AgentTvSequenceEvidence): string | null {
  if (evidence.playlistType !== 'tv' || !evidence.hasBaseline) return null  // 无基线不校验
  const candidateSequence = this.extractSequence(candidate)
  if (typeof candidateSequence !== 'number') return null  // 无期数不校验
  if (candidateSequence < evidence.expectedSequence!) return '候选期数小于期望下一集（倒序）'
  if (candidateSequence > evidence.expectedSequence!) return '候选期数大于期望下一集（跳集）'
  return null  // 校验通过
}
```

---

## 六、Assumptions & Decisions（假设与决策）

### 决策 1：删除本地评分，改为 LLM 决策
- **依据**：C1/C3/C9 + 用户确认"本地评分疑似历史遗留，应该删除"+"禁止使用分类器"
- **风险**：LLM 决策有延迟和失败概率
- **控制**：失败暴露 + needs_selection 兜底（不本地评分兜底，C8）

### 决策 2：TV 顺播硬约束采用后置校验（LLM-first）
- **依据**：用户选择"后置校验（LLM-first）"+ C4（确定性逻辑发生在模型返回之后）
- **效果**：LLM 看到顺播证据决策，本地校验 LLM 选择是否符合顺播规则（C17）
- **保留**：`AgentTvSequenceCandidateSelector` 转型为证据提供者 + 后置校验器（C2 保护结果）

### 决策 3：LLM 自判 decisionType，本地不替 LLM 判断
- **依据**：C1/C9（不得本地分类器截走）+ 用户澄清"候选很多 LLM 可推荐让用户澄清，候选不多可自动"
- **实现**：LLM 返回 `auto_select` / `needs_clarification` / `unable_to_decide`，本地按类型分流

### 决策 4：LLM 决策失败时不本地兜底
- **依据**：C8（暴露失败并允许用户重试或补充）
- **行为**：失败时进入 needs_selection，展示候选列表 + 失败原因

### 决策 5：LLM 决策返回 reasoning 用于进度消息
- **依据**：用户期望"第三条如果 LLM 根据返回结果做出决策，需要给出思路、最终选择的"
- **实现**：`AgentCandidateDecision` 接口含 `reasoning` + `considerations`，trace 记录后由 `buildAgentTraceProgressEvent` 转为进度消息

### 决策 6：无顺播基线时保守处理
- **依据**：C12（没有顺播基线不能自动替用户选择）+ 用户澄清"C12 是 TV 极端场景"
- **行为**：TV 无顺播基线时，即使 LLM 返回 `auto_select`，本地也不阻止 needs_selection（保守起见，让用户确认）
- **实现**：`validateTvSequenceConstraint` 返回 null（无基线不校验），但在 `selectCandidate` 增加额外判断：TV + 无基线 + 多候选 → 强制 needs_selection

### 假设 1：LlmClient 支持 JSON 结构化返回
- 需在实现阶段确认 `LlmClient` 是否支持 JSON mode / structured output
- 若不支持，使用 prompt + JSON 解析 + 失败暴露（C2 模型返回结构校验）

### 假设 2：candidateJudge 注入可拿到 llmClient
- 需确认 `SchedulingAgentRuntimeOptions` 是否暴露 llmClient
- 若未暴露，调整 [schedulingAgentRuntime.ts#L29-L35](file:///c:/Users/Administrator/Documents/Playground/aibiandan/src/services/agent/schedulingAgentRuntime.ts#L29-L35) 注入

### 假设 3：agent server 端的 candidateJudge 注入
- 需确认 `scripts/agent-server.mjs` 是否有自定义 candidateJudge 注入路径
- 若有，需同步更新为 `LlmAgentCandidateJudge`

---

## 七、Verification Steps（验证步骤）

### 1. 单元测试
```bash
npm run agent:check:tests
```
- 含新增 case A-G
- 确认现有 case 不回归（特别是 `schedulingAgentRuntimeFacade.test.ts`、`agentPlaylistPolicy.test.ts`、`demoRuntimeFacade.atomicFallback.test.ts`）

### 2. 构建检查
```bash
npm run build
```
- type-check 通过
- vite build 通过

### 3. 完整门禁
```bash
npm run agent:check
```
- 测试 + 构建全绿

### 4. 浏览器冒烟（涉及前台交互，C14）
- 启动：`npm run dev:agent`
- 打开：`http://localhost:5173`
- 测试场景（以插入节目为例）：
  - 输入："在 19:00 插入一集电视剧"
  - 验证消息流序列：
    1. 第 1 条：理解需求（LLM 意图理解反馈）
    2. 第 2 条：查节目库（露出查询关键词，如"电视剧 / 19:00"）
    3. 第 3 条：候选决策（露出 LLM 决策思路 + 最终选择，如"在 2 个候选中选择《xxx 第N集》，理由：xxx"）
    4. 第 4 条：插入节目单结果
  - 验证多候选时不再直接展示为两条记录，而是先有 LLM 决策进度消息
  - 验证 LLM 决策失败时展示候选列表 + 失败原因
  - 验证进度消息不出现"置信度""匹配度"等技术词（C13）

### 5. TV 顺播保护验证（C17）
- 测试场景：TV 播单已有第 5 集，候选库只有第 7 集（无第 6 集）
- 期望：LLM 若选第 7 集 → 本地后置校验失败 → needs_selection，暴露"跳集"违规
- 不应出现 LLM 强行选第 7 集并 direct_execute 的情况

### 6. C12 TV 极端场景验证
- 测试场景：TV 播单无顺播基线 + 多候选
- 期望：LLM 返回 `needs_clarification` → needs_selection（不自动选）

---

## 八、Final Report Checklist（最终汇报清单）

按 AGENTS.md Verification Gates 要求，最终汇报必须包含：

- **新增或命中的 case**：A（TV 顺播收敛唯一）/ B（TV 多候选 LLM 决策成功）/ C（TV 多候选需澄清）/ D（TV 顺播违规拒绝）/ E（Rotation LLM 决策）/ F（LLM 失败暴露）/ G（消息流序列）
- **修复路径或实现路径**：
  - `candidateJudge.ts` 重写为 `LlmAgentCandidateJudge`
  - `atomicCommandCapability.ts` 多候选收敛逻辑重写（后置校验）
  - `demoRuntimeFacade.ts` 新增"候选决策"进度消息分支
  - `schedulingAgentRuntime.ts` 注入 LlmClient
  - `types.ts` 接口改造（`AgentCandidateDecision` + `AgentTvSequenceEvidence`）
  - `tvSequenceCandidateSelector.ts` 新增 `buildEvidence` + `validateCandidateAgainstSequence`
- **实际运行的验证命令**：`npm run agent:check` + 浏览器冒烟
- **浏览器验证观察到的页面状态**：消息流 4 条序列完整、多候选不再直接展示两条记录、进度消息无技术词
- **残余风险**：
  - LLM 决策延迟（通过进度消息反馈缓解）
  - LLM 决策失败率（通过 needs_selection 兜底）
  - agent server 端注入路径需同步（假设 3）

---

## 九、实施顺序建议

1. **接口改造**：`types.ts` 新增 `AgentCandidateDecision` / `AgentTvSequenceEvidence` / `AgentCandidateDecisionType`，改造 `AgentCandidateJudge` 接口
2. **顺播证据提取**：`tvSequenceCandidateSelector.ts` 新增 `buildEvidence` + `validateCandidateAgainstSequence` 方法
3. **新实现**：`candidateJudge.ts` 重写为 `LlmAgentCandidateJudge`
4. **注入调整**：`schedulingAgentRuntime.ts` 注入 LlmClient
5. **收敛逻辑**：`atomicCommandCapability.ts` 重写 `selectCandidate` 多候选分支（后置校验 + decisionType 分流）
6. **进度消息**：`demoRuntimeFacade.ts` 新增"候选决策"分支
7. **测试补齐**：新增 case A-G，纳入 `agent:check:tests`
8. **验证**：`npm run agent:check` + 浏览器冒烟
9. **agent server 同步**：确认假设 3，必要时更新 `scripts/agent-server.mjs`
