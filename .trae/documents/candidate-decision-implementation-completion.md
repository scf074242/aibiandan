# Plan：候选决策 LLM-only 化——剩余实施（Task 4-8 收尾）

> 范围：基于已批准的 [candidate-decision-llm-only-and-progress-messages.md](file:///c:/Users/Administrator/Documents/Playground/aibiandan/.trae/documents/candidate-decision-llm-only-and-progress-messages.md)，完成剩余 Task 4-8。
>
> **当前状态**：Task 1-3 已完成（types.ts、tvSequenceCandidateSelector.ts、candidateJudge.ts），但项目处于**编译错误状态**——`schedulingAgentRuntime.ts` 仍 `import { DefaultAgentCandidateJudge }`（已被删除）+ `atomicCommandCapability.ts:4590` 仍把 `selectBestCandidate` 返回值当单个 candidate 使用（接口已改为 `AgentCandidateDecision`）。

---

## 一、Summary（摘要）

本 plan 聚焦 5 项收尾工作，按依赖顺序执行：

1. **修复编译错误（Task 4）**：`schedulingAgentRuntime.ts` 改 import 为 `LlmAgentCandidateJudge`，`SchedulingAgentRuntimeOptions` 增加 `llmClient` 字段，第 70 行改为 `new LlmAgentCandidateJudge({ llmClient: options.llmClient ?? defaultLlmClient })`。
2. **扩展 diagnostics 接口（Task 4.5）**：`AgentCandidateSelectionDiagnostics` 增加 `decisionType?` / `failureReason?` / `reasoning?` / `considerations?` 字段，以容纳 LLM 决策信息。
3. **重写 selectCandidate 多候选分支（Task 5）**：`atomicCommandCapability.ts:4428-4618` 删除多候选拦截（L4571-4588），改为调用 LLM 决策 + 本地后置校验 + 按 decisionType 分流。
4. **新增"候选决策"进度消息（Task 6）**：`demoRuntimeFacade.ts:5100` 后新增"LLM 候选决策完成"分支，匹配 trace 记录。
5. **测试补齐 + 验证（Task 7-8）**：新增 case A-G，运行 `npm run agent:check` + 浏览器冒烟。

---

## 二、Current State Analysis（当前状态分析）

### 已完成（Task 1-3）

| 文件 | 状态 | 关键内容 |
|---|---|---|
| [types.ts](file:///c:/Users/Administrator/Documents/Playground/aibiandan/src/services/agent/types.ts) | 已完成 | 新增 `AgentTvSequenceEvidence` / `AgentCandidateDecisionType` / `AgentCandidateDecision`；改造 `AgentCandidateJudgeInput` 增加 `tvSequenceEvidence?`；改造 `AgentCandidateJudge.selectBestCandidate` 返回 `Promise<AgentCandidateDecision>` |
| [tvSequenceCandidateSelector.ts](file:///c:/Users/Administrator/Documents/Playground/aibiandan/src/services/agent/tvSequenceCandidateSelector.ts#L159) | 已完成 | 新增 `buildEvidence(context, candidates)` 和 `validateCandidateAgainstSequence(candidate, evidence)` 方法（不破坏现有 `selectBestCandidate`） |
| [candidateJudge.ts](file:///c:/Users/Administrator/Documents/Playground/aibiandan/src/services/agent/candidateJudge.ts) | 已完成 | 完全删除 `DefaultAgentCandidateJudge`，重写为 `LlmAgentCandidateJudge`（294 行），含 `buildMessages` / `buildEvidenceLines` / `normalizeDecision` / `parseJson` / `normalizeDecisionType` / `normalizeConsiderations` |

### 待修复（Task 4-8）

#### 问题 1：schedulingAgentRuntime.ts 编译错误（Task 4）

**根因**：[schedulingAgentRuntime.ts#L6](file:///c:/Users/Administrator/Documents/Playground/aibiandan/src/services/agent/schedulingAgentRuntime.ts#L6) 仍 `import { DefaultAgentCandidateJudge } from './candidateJudge'`，但该类已被删除。

**第 70 行**：`this.candidateJudge = options.candidateJudge ?? new DefaultAgentCandidateJudge()` —— 引用不存在的类。

**修复**：
- 第 6 行：`import { LlmAgentCandidateJudge } from './candidateJudge'`
- `SchedulingAgentRuntimeOptions`（第 29-35 行）增加 `llmClient?: Pick<LLMClient, 'chat'>` 字段
- 第 70 行：`this.candidateJudge = options.candidateJudge ?? new LlmAgentCandidateJudge({ llmClient: options.llmClient ?? defaultLlmClient })`
- 新增 `defaultLlmClient` 来源：通过 `import { getLLMClient } from '@/services/llm/llmClient'` 获取（与 `demoRuntimeFacade.ts#L2` 一致）

#### 问题 2：atomicCommandCapability.ts 编译错误 + 逻辑过时（Task 5）

**根因 1（编译错误）**：[atomicCommandCapability.ts#L4590-L4597](file:///c:/Users/Administrator/Documents/Playground/aibiandan/src/services/agent/atomicCommandCapability.ts#L4590-L4597) 仍把 `selectBestCandidate` 返回值赋给 `candidate: AgentProgramCandidate | null`，但接口已改为返回 `AgentCandidateDecision`（含 `candidate` / `reasoning` / `considerations` / `decisionType` / `candidateOptions`）。

**根因 2（逻辑过时）**：[L4571-L4588](file:///c:/Users/Administrator/Documents/Playground/aibiandan/src/services/agent/atomicCommandCapability.ts#L4571-L4588) 多候选拦截仍直接返回 `candidateOptions`，跳过 LLM 决策——这是用户反馈问题的核心。

**修复**：删除 L4571-L4588 多候选拦截，重写 L4589-L4617 为：
1. 调用 `tvSequenceSelector.buildEvidence()` 获取顺播证据（不前置过滤候选）
2. 调用 `candidateJudge.selectBestCandidate()` 获取 LLM 决策（透传顺播证据）
3. trace 记录决策结果（label: `'LLM 候选决策完成'`，含 reasoning / considerations / decisionType / selectedCandidateName）
4. 按 `decisionType` 分流：
   - `auto_select` + 候选 → 本地后置校验顺播硬约束 → 通过则返回 candidate，不通过则 needs_selection
   - `needs_clarification` → 返回 candidateOptions + 失败原因
   - `unable_to_decide` → 返回 candidateOptions + 失败原因

#### 问题 3：缺失"候选决策"进度消息（Task 6）

**根因**：[demoRuntimeFacade.ts#L5030-L5103](file:///c:/Users/Administrator/Documents/Playground/aibiandan/src/services/runtime/demoRuntimeFacade.ts#L5030-L5103) `buildAgentTraceProgressEvent` 已有"理解需求"/"查节目库"/"继续查找"三类分支，缺"候选决策"分支。

**修复**：在"继续查找"分支（L5074-L5100）后新增"LLM 候选决策完成"分支，匹配 `step.label === 'LLM 候选决策完成'`，生成进度消息。

#### 问题 4：测试缺失（Task 7）

**修复**：新增 `src/services/__tests__/schedulingAgentRuntime.candidateDecision.test.ts`，含 case A-G。

#### 问题 5：验证（Task 8）

**修复**：运行 `npm run agent:check` + 浏览器冒烟。

---

## 三、Proposed Changes（具体修改方案）

### 修改 1：schedulingAgentRuntime.ts 修复 import 和注入（Task 4）

**文件**：[src/services/agent/schedulingAgentRuntime.ts](file:///c:/Users/Administrator/Documents/Playground/aibiandan/src/services/agent/schedulingAgentRuntime.ts)

**改动 1.1**：第 6 行 import 调整

```typescript
// 旧
import { DefaultAgentCandidateJudge } from './candidateJudge'
// 新
import { LlmAgentCandidateJudge } from './candidateJudge'
```

**改动 1.2**：顶部 import 增加 LLMClient 类型与 getLLMClient 默认实例

```typescript
import type { LLMClient } from '@/services/llm/llmClient'
import { getLLMClient } from '@/services/llm/llmClient'
```

**改动 1.3**：`SchedulingAgentRuntimeOptions` 增加 `llmClient` 字段

```typescript
export interface SchedulingAgentRuntimeOptions {
  dataGateway: SchedulingDataGateway
  candidateJudge?: AgentCandidateJudge
  llmClient?: Pick<LLMClient, 'chat'>  // 新增
  intentInterpreter?: AgentIntentInterpreter
  capabilities?: AgentCapability[]
  onTraceStep?: (step: AgentTraceStep) => void
}
```

**改动 1.4**：第 70 行注入逻辑

```typescript
constructor(options: SchedulingAgentRuntimeOptions) {
  this.dataGateway = options.dataGateway
  this.candidateJudge = options.candidateJudge
    ?? new LlmAgentCandidateJudge({ llmClient: options.llmClient ?? getLLMClient() })
  // ... 其余不变
}
```

**改动 1.5**：`demoRuntimeFacade.ts:4986-4990` SchedulingAgentRuntime 实例化增加 llmClient 注入（让 LlmAgentCandidateJudge 默认走 this.llmClient，避免重复创建 LLM 实例）

```typescript
const runtime = new SchedulingAgentRuntime({
  dataGateway,
  llmClient: this.llmClient,  // 新增
  intentInterpreter: new LlmAgentIntentInterpreter(this.llmClient),
  onTraceStep: (step) => this.handleAgentTraceProgress(input, step),
})
```

### 修改 2：AgentCandidateSelectionDiagnostics 扩展（Task 4.5）

**文件**：[src/services/agent/types.ts#L476-L488](file:///c:/Users/Administrator/Documents/Playground/aibiandan/src/services/agent/types.ts#L476-L488)

**改动**：增加 4 个可选字段以容纳 LLM 决策信息

```typescript
export interface AgentCandidateSelectionDiagnostics {
  method: AgentCandidateSelectionMethod
  source: AgentCandidateSelectionSource
  selectedCandidateId?: string
  selectedProgramCode?: string
  candidateCount: number
  expectedSequence?: number
  selectedSequence?: number
  seriesKey?: string
  candidateOptionIds?: string[]
  professionalAssessment?: AgentCandidateProfessionalAssessment
  reason: string
  // 新增 4 个字段（可选）
  decisionType?: 'auto_select' | 'needs_clarification' | 'unable_to_decide'
  failureReason?: string
  reasoning?: string
  considerations?: string[]
}
```

**理由**：原 `method: 'candidate_judge'` 已升级为 LLM 决策（`method: 'candidate_judge_llm'`），需保留决策类型、失败原因、决策思路、评估要点供 trace 记录和进度消息渲染。

**`AgentCandidateSelectionMethod` 同步扩展**（[types.ts#L456](file:///c:/Users/Administrator/Documents/Playground/aibiandan/src/services/agent/types.ts#L456)）：

```typescript
export type AgentCandidateSelectionMethod =
  | 'explicit'
  | 'tv_sequence'
  | 'candidate_judge'
  | 'candidate_judge_llm'  // 新增：LLM 决策路径
```

### 修改 3：atomicCommandCapability.ts 重写 selectCandidate 多候选分支（Task 5）

**文件**：[src/services/agent/atomicCommandCapability.ts#L4428-L4618](file:///c:/Users/Administrator/Documents/Playground/aibiandan/src/services/agent/atomicCommandCapability.ts#L4428-L4618)

**改动范围**：仅修改 L4560-L4617（保留 L4428-L4559 的 `latestIssueSelection` 和 `sequenceSelection` 前置逻辑，这些是用户明确要求期数最大 / TV 顺播硬收敛的特殊场景，不进入 LLM 决策）。

**改动 3.1**：L4560-L4588（多候选拦截 + 准备 judgeCandidates）保留候选准备逻辑，**删除多候选拦截直接返回**：

```typescript
// L4560-L4570 保留：exactReplacementCandidates / professionalAssessmentByCandidateId / playableJudgeCandidates / judgeCandidates 准备逻辑不变

// 删除 L4571-L4588 的多候选拦截直接返回 candidateOptions 分支

// L4589 起改为：
const tvSequenceEvidence = this.tvSequenceSelector.buildEvidence(context, judgeCandidates)
runtime.trace.record('planning', '电视播单顺播证据检查', {
  commandIntent,
  candidateCount: judgeCandidates.length,
  evidence: tvSequenceEvidence,
})

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
  tvSequenceEvidence,  // 透传顺播证据给 LLM
})

// 记录 LLM 决策结果（用于第三条进度消息）
const selectedName = decision.candidate?.programName
  ?? decision.candidate?.instanceName
  ?? ''
runtime.trace.record('planning', 'LLM 候选决策完成', {
  commandIntent,
  candidateCount: judgeCandidates.length,
  selectedCandidateId: decision.candidate?.id ?? null,
  selectedCandidateName: selectedName,
  reasoning: decision.reasoning,
  considerations: decision.considerations ?? [],
  decisionType: decision.decisionType,
})

// 按 decisionType 分流
if (decision.decisionType === 'auto_select' && decision.candidate) {
  // 本地后置校验顺播硬约束（C17）
  const sequenceViolation = this.tvSequenceSelector.validateCandidateAgainstSequence(
    decision.candidate,
    tvSequenceEvidence,
  )
  if (sequenceViolation) {
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
        decisionType: decision.decisionType,
        failureReason: `顺播校验失败：${sequenceViolation}`,
        candidateCount: judgeCandidates.length,
        candidateOptionIds: judgeCandidates.slice(0, 8).map((c) => c.id),
        reason: `LLM 选择的候选违反顺播规则（${sequenceViolation}），请手动选择。`,
      },
    }
  }
  // 顺播校验通过 → 返回 candidate
  return {
    candidate: decision.candidate,
    diagnostics: {
      method: 'candidate_judge_llm',
      source: 'fallback',
      selectedCandidateId: decision.candidate.id,
      selectedProgramCode: decision.candidate.programCode,
      decisionType: decision.decisionType,
      reasoning: decision.reasoning,
      considerations: decision.considerations,
      candidateCount: judgeCandidates.length,
      professionalAssessment: judgePool.assessments[decision.candidate.id]
        ?? professionalAssessmentByCandidateId.get(decision.candidate.id)
        ?? this.buildProfessionalAssessment(decision.candidate, input, context, commandIntent, targetTime, replacementTarget),
      reason: decision.reasoning,
    },
  }
}

// needs_clarification / unable_to_decide：进入 needs_selection
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
    candidateOptionIds: judgeCandidates.slice(0, 8).map((c) => c.id),
    reason: decision.decisionType === 'unable_to_decide'
      ? `LLM 候选决策失败：${decision.reasoning}。请在下方候选中选择。`
      : `LLM 建议需用户确认：${decision.reasoning}。请在下方候选中选择。`,
  },
}
```

**改动 3.2**：单候选分支（`judgeCandidates.length === 1`）的处理

`LlmAgentCandidateJudge` 内部已对单候选直接返回 `auto_select`（不调 LLM），因此无需在 `selectCandidate` 内特殊处理。但需要保留 trace 记录决策结果，使第三条进度消息在单候选场景也能露出。上面的 trace 记录逻辑已覆盖此场景。

**改动 3.3**：`tvSequenceSelector.selectBestCandidate` 旧调用保留

[L4460-L4558](file:///c:/Users/Administrator/Documents/Playground/aibiandan/src/services/agent/atomicCommandCapability.ts#L4460-L4558) 的 `sequenceSelection` 逻辑是 TV 顺播硬收敛场景（候选库有期望下一集时直接命中），保留不动。仅当此逻辑未命中（candidateOptions 为空 + candidate 为 null）时，才进入新 LLM 决策路径。

### 修改 4：demoRuntimeFacade.ts 新增"候选决策"进度消息分支（Task 6）

**文件**：[src/services/runtime/demoRuntimeFacade.ts#L5100-L5103](file:///c:/Users/Administrator/Documents/Playground/aibiandan/src/services/runtime/demoRuntimeFacade.ts#L5100-L5103)

**改动**：在"继续查找"分支（L5074-L5100）和 `return null`（L5102）之间新增"LLM 候选决策完成"分支

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

  // C13：不出现"置信度""匹配度"等技术词
  let decisionText: string
  if (decisionType === 'auto_select' && selectedName) {
    decisionText = `在 ${candidateCount} 个候选中选择「${selectedName}」`
  } else if (decisionType === 'needs_clarification') {
    decisionText = `查到 ${candidateCount} 个候选，需要你确认具体排哪个`
  } else if (decisionType === 'unable_to_decide') {
    decisionText = `查到 ${candidateCount} 个候选，但暂时无法给出有把握的选择`
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

return null
```

**UI 兼容性确认**：`processType: 'selection'` 与"查节目库"一致，`system-process-strip` 组件无需修改。

### 修改 5：测试 case 补齐（Task 7）

**文件**：新增 `src/services/__tests__/schedulingAgentRuntime.candidateDecision.test.ts`

**LLM Mock 策略**：使用 mock `Pick<LLMClient, 'chat'>`，返回预设的 `{ candidateId, reasoning, considerations, decisionType }` JSON，避免真实 LLM 调用。

**新增 7 个 case**：

| Case | 场景 | 期望行为 | 约束 |
|---|---|---|---|
| A | TV 顺播收敛到唯一 + LLM auto_select | direct_execute，进度消息含"候选决策"，trace 含 reasoning | C11 |
| B | TV 多候选 + LLM auto_select + 顺播校验通过 | direct_execute，进度消息含决策思路 | C5 |
| C | TV 多候选 + LLM needs_clarification | needs_selection，进度消息含"需要你确认" | C7/C12 |
| D | TV 多候选 + LLM auto_select + 顺播违规 | needs_selection，暴露顺播违规 | C17 |
| E | Rotation 多候选 + LLM auto_select | confirm_before_commit，进度消息含"候选决策" | C2 |
| F | LLM 失败/超时（unable_to_decide） | needs_selection，暴露失败原因 | C8 |
| G | 消息流序列 | 断言进度消息顺序：理解需求 → 查节目库 → 候选决策 | C14 |

**纳入 `agent:check`**：检查 [package.json](file:///c:/Users/Administrator/Documents/Playground/aibiandan/package.json) `agent:check:tests` 脚本的文件列表，按现有模式加入新测试文件。

### 修改 6：scripts/agent-server.mjs 同步检查（Task 4.6）

**已确认**：[scripts/agent-server.mjs](file:///c:/Users/Administrator/Documents/Playground/aibiandan/scripts/agent-server.mjs) 不含 `candidateJudge` / `SchedulingAgentRuntime` / `LlmAgentCandidateJudge` / `DefaultAgentCandidateJudge` 任何引用（grep 结果为空），无需同步更新。

---

## 四、约束合规检查（剩余 Tasks 范围）

| 约束 | 来源 | 本 plan 合规方式 |
|---|---|---|
| C1 LLM-only 主路径 | AGENTS.md | 删除 DefaultAgentCandidateJudge 引用，注入 LlmAgentCandidateJudge |
| C2 本地逻辑只保护结果 | AGENTS.md | 后置校验顺播硬约束 + 校验 candidateId 有效性 |
| C3 理解用户是错误方向 | AGENTS.md | 不本地评分，LLM 决策 |
| C4 确定性逻辑在模型返回后 | AGENTS.md | 顺播后置校验发生在 LLM 返回后、写入前 |
| C5 经验丰富编排人员选择顺序 | AGENTS.md | LlmAgentCandidateJudge prompt 已含此顺序（Task 3 已完成） |
| C7 候选不足应追问/拒绝 | AGENTS.md | LLM 返回 needs_clarification → needs_selection |
| C8 模型失败应暴露失败 | AGENTS.md | LLM 失败 → unable_to_decide → needs_selection + 失败原因 |
| C11 顺播收敛到唯一可排可直接编排 | aibiandan-agent-rules.md | auto_select + 顺播校验通过 → direct_execute |
| C12 同一期多版本/无基线不能自动替选 | aibiandan-agent-rules.md | LLM 自判 needs_clarification，本地不替 LLM 判断 |
| C13 不出现"置信度""匹配度"技术词 | aibiandan-agent-rules.md | 进度消息文案用自然语言 |
| C14 AI助手像懂编排业务的人 | aibiandan-agent-rules.md | 进度消息为系统过程，不抢主回复 |
| C17 Must Refuse 倒序/跳集/重复 | agent-development-protocol.md | 后置校验拒绝跳集/倒序/重复候选 |

---

## 五、Assumptions & Decisions（假设与决策）

### 决策 1：使用 `getLLMClient()` 作为默认 llmClient
- **依据**：[demoRuntimeFacade.ts#L2](file:///c:/Users/Administrator/Documents/Playground/aibiandan/src/services/runtime/demoRuntimeFacade.ts#L2) 已使用 `getLLMClient()` 模式，且 [demoRuntimeFacade.ts#L258](file:///c:/Users/Administrator/Documents/Playground/aibiandan/src/services/runtime/demoRuntimeFacade.ts#L258) `private readonly llmClient = getLLMClient()` 已是单例
- **效果**：未显式注入 llmClient 时（如测试或独立 runtime），fallback 到全局单例
- **风险**：测试场景需 mock `getLLMClient` 或显式注入 mock llmClient

### 决策 2：`method: 'candidate_judge_llm'` 新增独立标识
- **依据**：原 `method: 'candidate_judge'` 对应本地评分（已删除）；新路径是 LLM 决策，需区分审计
- **效果**：trace 和 diagnostics 可清晰区分新旧路径

### 决策 3：保留 `tvSequenceSelector.selectBestCandidate` 旧方法
- **依据**：[atomicCommandCapability.ts#L4460-L4558](file:///c:/Users/Administrator/Documents/Playground/aibiandan/src/services/agent/atomicCommandCapability.ts#L4460-L4558) 的 `sequenceSelection` 是 TV 顺播硬收敛场景（候选库有期望下一集时直接命中，无需 LLM 决策），属"硬约束直接收敛"，不违反 LLM-only 原则（C1：本地逻辑保护结果）
- **效果**：TV 候选库有期望下一集时直接命中，不走 LLM；候选库无期望下一集或顺播不收敛时才走 LLM 决策

### 决策 4：单候选时仍记录 trace + 进度消息
- **依据**：用户期望消息流一致（理解需求 → 查节目库 → 候选决策 → 插入结果）
- **实现**：`LlmAgentCandidateJudge` 单候选时直接返回 `auto_select` + reasoning，trace 仍记录"LLM 候选决策完成"，进度消息露出"在 1 个候选中选择「xxx」"

### 假设 1：现有测试不回归
- 原 `DefaultAgentCandidateJudge` 已删除，依赖它的测试可能需要在 Task 7 一并修复
- 验证步骤 1 会捕获回归

### 假设 2：UI 组件无需修改
- `system-process-strip` 对 `processTypeLabel` 透明渲染，无需为新分支修改组件
- Task 8 浏览器冒烟会验证

---

## 六、Verification Steps（验证步骤）

### 1. 单元测试
```bash
npm run agent:check:tests
```
- 含新增 case A-G
- 修复任何因 `DefaultAgentCandidateJudge` 删除导致的回归测试

### 2. 构建检查（确认编译错误已修复）
```bash
npm run build
```
- type-check 通过（关键：schedulingAgentRuntime.ts 和 atomicCommandCapability.ts 不再编译错误）
- vite build 通过

### 3. 完整门禁
```bash
npm run agent:check
```

### 4. 浏览器冒烟
- 启动：`npm run dev:agent`
- 打开：`http://localhost:5173`
- 测试场景（以插入节目为例）：
  - 输入："在 19:00 插入一集电视剧"
  - 验证消息流序列（4 条）：
    1. 理解需求（LLM 意图理解反馈）
    2. 查节目库（露出查询关键词）
    3. 候选决策（露出 LLM 决策思路 + 最终选择）—— 新增
    4. 插入节目单结果
  - 验证多候选时不再直接展示为两条记录，而是先有 LLM 决策进度消息
  - 验证 LLM 决策失败时展示候选列表 + 失败原因
  - 验证进度消息不出现"置信度""匹配度"等技术词（C13）

### 5. TV 顺播保护验证（C17）
- 测试场景：TV 播单已有第 5 集，候选库只有第 7 集（无第 6 集）
- 期望：LLM 若选第 7 集 → 本地后置校验失败 → needs_selection，暴露"跳集"违规

### 6. C12 TV 极端场景验证
- 测试场景：TV 播单无顺播基线 + 多候选
- 期望：LLM 返回 `needs_clarification` → needs_selection（不自动选）

---

## 七、Final Report Checklist（最终汇报清单）

按 AGENTS.md Verification Gates 要求，最终汇报将包含：

- **新增或命中的 case**：A-G
- **修复路径**：
  - `schedulingAgentRuntime.ts` 修复 import + 注入 LlmClient
  - `atomicCommandCapability.ts` 重写 selectCandidate 多候选分支
  - `demoRuntimeFacade.ts` 新增"候选决策"进度消息分支
  - `types.ts` 扩展 `AgentCandidateSelectionDiagnostics` + `AgentCandidateSelectionMethod`
  - `demoRuntimeFacade.ts` SchedulingAgentRuntime 实例化注入 llmClient
- **实际运行的验证命令**：`npm run agent:check` + 浏览器冒烟
- **浏览器验证观察到的页面状态**：4 条消息流序列完整、多候选不再直接展示两条记录、进度消息无技术词
- **残余风险**：
  - LLM 决策延迟（通过进度消息反馈缓解）
  - LLM 决策失败率（通过 needs_selection 兜底）
  - 依赖 `DefaultAgentCandidateJudge` 的旧测试可能需要修复

---

## 八、实施顺序

1. **修复编译错误（Task 4）**：`schedulingAgentRuntime.ts` 改 import + 注入 llmClient
2. **扩展 diagnostics 接口（Task 4.5）**：`types.ts` 增加字段
3. **demoRuntimeFacade 注入 llmClient（Task 4.5）**：SchedulingAgentRuntime 实例化增加 `llmClient: this.llmClient`
4. **重写 selectCandidate（Task 5）**：`atomicCommandCapability.ts` 删除多候选拦截 + 实现 LLM 决策 + 后置校验 + decisionType 分流
5. **新增进度消息（Task 6）**：`demoRuntimeFacade.ts` 新增"候选决策"分支
6. **测试补齐（Task 7）**：新增 case A-G + 修复回归
7. **验证（Task 8）**：`npm run agent:check` + 浏览器冒烟
8. **最终汇报**：按 Final Report Checklist 输出
