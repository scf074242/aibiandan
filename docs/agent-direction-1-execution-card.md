# 方向 1 执行卡：失败可恢复性闭环

- 关联方案：`docs/agent-evolution-roadmap-proposal.md` 第 5 章（5.1-5.8）
- 阶段：实施中
- 日期：2026-06-28
- 范围：aibiandan agent 编排系统（电视播单 + 轮播单）

---

## 1. 问题

当前失败暴露只有错误码 + 散文 message，前台无法基于结构化线索生成 quick replies，用户失败后只能从头再来；timeout 在 6s / 8s / 12s / 15s / 30s / 60s / 140s 多套并存，长流程下会雪崩；`preview_only` 在 intent 解析层有，但 pending mutation / write adapter 层无强制字段传递，存在 preview_only 误写风险。

## 2. 期望

1. LLM 失败 / 候选 0 命中 / preview_only 违反等可恢复场景，必须产出结构化 `RecoverableInterpretationFailure` envelope，前台据此生成 quick replies。
2. 一次 submit 内所有 stage（intent / candidate / selection / write）共享一个整体 deadline（默认 30s），各 stage 只能从中扣除自己的预算；长流程采用整体 10 分钟 + 批次 90s 组合；5s 后允许用户停止。
3. `MutationPolicy`（preview_only / pending_only / formal_write）从 intent 解析层一路传递到 write adapter，`assertMutationAllowed` 在 write adapter 入口校验，preview_only 时直接抛错。
4. 失败 quick replies 由确定性纯函数生成（不调用 LLM），缺失槽位 → 追问、候选 0 命中 → 放宽关键词重试、始终提供取消。
5. 前台 `FailureFormatter.vue` 子组件，结构化展示 recognizedSlots / missingSlots / candidateEvidence / quickReplies。
6. 5 个 case 纳入 `agent:check:tests` 门禁。

## 3. 前置数据

- 13 条 safety gates（已落地，`src/services/runtime/demoRuntimeFacade.ts`）
- LLM-first / LLM-only 主路径（已落地，`src/services/agent/atomicCommandCapability.ts`）
- SSE 双路径（path A 流式 + path B 批量回放，已落地）
- 候选检索重试（已落地，`src/services/agent/candidateSearchRetryService.ts`）
- `candidate_judge_llm` 断言与 `needs_selection` 失败暴露（已落地）
- ChatPanel.vue 多气泡流式展示（已落地，`src/components/dialogue/ChatPanel.vue`）
- `agent:check:tests` 列表（`package.json`，待新增 5 个 case）

## 4. 风险

- **R1 envelope 字段过宽**：`recognizedSlots` / `missingSlots` / `candidateEvidence` 字段定义不当，导致前台无法生成 quick replies。控制：方案 5.1 已明确字段，测试断言字段完整性。
- **R2 AgentDeadline 联动 fetch / LLM 调用失败**：AbortController 信号未正确传递，导致超时后仍在执行。控制：`signal()` 方法返回 AbortSignal，调用方必须传入；测试断言 abort 后 stage 不再执行。
- **R3 preview_only 写屏障误伤合法写入**：`assertMutationAllowed` 在合法 formal_write 场景被误触发。控制：测试覆盖三种 policy 的合法路径。
- **R4 quick replies 生成逻辑越界**：生成逻辑偷偷调用 LLM 或改写用户意图，违背"本地只保护结果"原则。控制：纯函数实现，无 LLM 调用，测试断言确定性。
- **R5 前台 FailureFormatter 与现有 SSE 流式冲突**：失败气泡未走流式，退化为单气泡。控制：`formatFailureEnvelope` 仅产出渲染数据，气泡生命周期仍由 ChatPanel SSE 控制。
- **R6 长流程 deadline 误套用到短链路**：长流程 10 分钟 deadline 被误用到短链路 submit。控制：`AgentDeadline` 默认 30s，长流程需显式传 `LONG_RUNNING_DEADLINE_BUDGET.overallDeadlineMs`。
- **R7 既有测试回归**：新增 envelope 类型与 MutationPolicy 字段引入可能破坏既有 84+ 测试。控制：方向 1 只新增类型与纯函数，不修改既有 capability / facade 行为；接入集成留到方向 2/3。

## 5. 验证方式

### 5.1 新增 case（纳入 `agent:check:tests`）

| Case ID | 文件 | 验证点 |
|---|---|---|
| `case-llm-timeout` | `src/services/__tests__/recoverableFailureEnvelope.test.ts` | LLM 调用超过 8s stage timeout，capability 必须返回 `kind: 'llm_timeout'` envelope，`noMutation: true`，前台展示 quick replies |
| `case-llm-intent-empty` | 同上 | LLM 返回空意图，必须返回 `kind: 'llm_intent_unavailable'`，`recognizedSlots` 为空数组，`missingSlots` 包含 `intent` 槽位 |
| `case-candidate-zero-match` | 同上 | 用户给出明确节目名，候选库字段级不匹配，必须返回 `kind: 'candidate_zero_match'`，`candidateEvidence` 为空数组，quick replies 包含"放宽关键词重试" |
| `case-preview-only-violation` | 同上 | preview_only 模式下 write adapter 被调用，`assertMutationAllowed` 必须抛 `PreviewOnlyViolationError`，envelope `kind: 'preview_only_violation'` |
| `case-quick-reply-no-mutation` | 同上 | 任何 quick reply 触发重试前，必须校验上一轮 `noMutation === true`，否则禁止 quick retry |

### 5.2 验证门禁

- 行为变化：运行上述 5 个 case 的 Vitest。
- Agent 编排链路变化：运行 `npm run agent:check`（含新增 5 个 case + 既有 84+ case 全量回归）。
- 前台可见交互变化：在 `http://localhost:5173` 触发 LLM 超时（mock），验证 `FailureFormatter` 展示 recognizedSlots / missingSlots / quickReplies。
- 构建检查：`npm run build`。

### 5.3 实施边界

- **不修改既有 capability / facade 行为**：方向 1 只新增类型与纯函数，不接入 `AtomicCommandCapability` 与 `DemoRuntimeFacade` 的主链路。接入集成留到方向 2/3。
- **不引入 LLM 调用**：`generateQuickReplies` / `formatFailureEnvelope` 都是纯确定性函数。
- **不引入子 agent**：方向 1 不涉及子 agent。
- **不引入回退**：方向 1 不涉及 mutation journal 与回滚链路。

---

## 6. 交付物清单

| 文件 | 类型 | 说明 |
|---|---|---|
| `src/services/agent/recoverableFailureEnvelope.ts` | 新增 | envelope schema + generateQuickReplies 纯函数 |
| `src/services/agent/agentDeadline.ts` | 新增 | 统一 deadline 管理器 + 长流程预算 + decideLongRunningTimeoutAction |
| `src/services/agent/mutationPolicy.ts` | 新增 | MutationPolicy + MutationContext + assertMutationAllowed 写屏障 |
| `src/services/agent/failureEnvelopeFormatter.ts` | 新增 | formatFailureEnvelope 纯函数（前台渲染数据） |
| `src/services/__tests__/recoverableFailureEnvelope.test.ts` | 新增 | 5 个 case 的 Vitest 测试 |
| `src/components/dialogue/FailureFormatter.vue` | 新增 | 前台失败信封渲染子组件 |
| `src/components/dialogue/ChatPanel.vue` | 修改 | 最小集成 FailureFormatter（仅在失败信封到达时渲染） |
| `package.json` | 修改 | `agent:check:tests` 列表新增 recoverableFailureEnvelope.test.ts |
