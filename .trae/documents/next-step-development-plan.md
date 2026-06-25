# 下一步开发工作 Plan：候选决策 LLM 化收尾验证 + 消息流序列确认

> 本 plan 承接前一轮已批准并实施完成的 `candidate-decision-verification-and-doc-sync.md`，并回应用户最新 `/plan` 请求中提到的"缺失查询节目库的系统提示信息"遗漏问题。
>
> Phase 1 探索结论：代码层"查节目库"和"候选决策"进度消息分支**均已就绪**（demoRuntimeFacade L5052-5143 + atomicCommandCapability L2227/L2866/L3287/L4599 trace record）。用户提到的"缺失"可能在上一轮已修复但未验证，或仅在特定场景下未触发。本 plan 以"验证 + 修复测试断言 + 文档同步 + 浏览器冒烟确认"为闭环。

---

## 1. Summary（摘要）

本轮要做 5 件事，全部围绕"验证候选决策 LLM 化是否真正落地、消息流是否完整"：

1. **修复 Case F 测试断言**：`result.candidateOptions?.length` → `result.decision?.recommendations?.length`（与 Case C 一致）
2. **运行新测试** `schedulingAgentRuntime.candidateDecision.test.ts`，确认 case A-G 全绿
3. **将新测试纳入 `agent:check:tests`** 脚本
4. **同步过时文档** `docs/code-wiki.md` 的 3 处 `DefaultAgentCandidateJudge` 残留
5. **运行完整门禁 + 浏览器冒烟**，重点确认"理解需求 → 查节目库 → 候选决策 → 插入结果"4 条消息流序列

**不动**：candidateJudge.ts / atomicCommandCapability.ts / schedulingAgentRuntime.ts / tvSequenceCandidateSelector.ts / types.ts / demoRuntimeFacade.ts 的实现层代码（前一轮已完成，本轮只验证不返工；若冒烟发现"查节目库"消息确实缺失，再启动新 plan 修复）。

---

## 2. Current State Analysis（现状分析）

### 2.1 代码层已就绪（Phase 1 探索结论）

| 文件 | 状态 | 关键证据 |
|---|---|---|
| `src/services/agent/candidateJudge.ts` | ✅ 已重写 | `LlmAgentCandidateJudge` 是唯一实现，单候选直接 auto_select、多候选调 LLM、失败返回 unable_to_decide（L28-70） |
| `src/services/agent/atomicCommandCapability.ts` | ✅ 已重写 | L4578 记录"候选决策前发现多个可用候选"trace、L4599 记录"LLM 候选决策完成"trace、L4655 记录"needs_selection"trace |
| `src/services/agent/tvSequenceCandidateSelector.ts` | ✅ 已扩展 | L159-197 `buildEvidence`、L203-214 `validateCandidateAgainstSequence` |
| `src/services/agent/types.ts` | ✅ 已扩展 | `AgentCandidateDecision`、`AgentCandidateDecisionType`、`AgentCandidateSelectionMethod` 含 `'candidate_judge_llm'` |
| `src/services/runtime/demoRuntimeFacade.ts` | ✅ 已扩展 | L5033-5050 "理解需求"、L5052-5072 "查节目库"、L5075-5100 "继续查找"、L5104-5143 "候选决策" |
| `src/services/__tests__/schedulingAgentRuntime.candidateDecision.test.ts` | ⚠️ Case F 待修复 | L460 仍用 `result.candidateOptions?.length`，需改为 `result.decision?.recommendations?.length` |

### 2.2 "查节目库"消息触发链路（Phase 1 探索确认）

```
atomicCommandCapability.ts                    demoRuntimeFacade.ts
─────────────────────────                     ─────────────────────
L2227  trace.record('planning',               L5052  if step.label === '调用节目查询服务查找候选'
       '调用节目查询服务查找候选', {...})      L5063    content: `正在按 ${keywordText} 查节目库...`
L2866  (同上，insert 分支)                     L5065    processTypeLabel: '查节目库'
L3287  (同上，query candidate_lookup 分支)     L5067    progressStage: 'candidate_lookup'
```

**结论**：代码层"查节目库"消息分支已就绪，3 处 trace record 对应 3 种触发场景（insert / replace / query）。用户提到的"缺失"可能在上一轮已修复，需通过浏览器冒烟确认。

### 2.3 遗留问题

| 问题 | 位置 | 影响 |
|---|---|---|
| Case F 测试断言待修复 | `schedulingAgentRuntime.candidateDecision.test.ts` L460 | 测试失败，case A-G 无法全绿 |
| 新测试未纳入 `agent:check:tests` | `package.json` L29 | `npm run agent:check` 不会跑新测试，门禁覆盖不全 |
| `docs/code-wiki.md` 过时 | L336 / L445 / L883 | 仍引用 `DefaultAgentCandidateJudge` 和"评分选择（名字 100/instance 70/column 30...）"，与实际代码（`LlmAgentCandidateJudge`）不符 |
| 完整门禁未执行 | - | 无法确认测试 + 构建全绿 |
| 浏览器冒烟未执行 | - | 无法确认实际消息流序列（理解需求 → 查节目库 → 候选决策 → 插入结果） |

---

## 3. Proposed Changes（具体修改方案）

### 修改 1：修复 Case F 测试断言

**文件**：`c:\Users\Administrator\Documents\Playground\aibiandan\src\services\__tests__\schedulingAgentRuntime.candidateDecision.test.ts`

**位置**：L460

**改动**：
```typescript
// 旧
expect(result.candidateOptions?.length).toBeGreaterThan(0)
// 新
expect(result.decision?.recommendations?.length).toBeGreaterThan(0)
```

**理由**：`buildCandidateSelectionPendingResultIfNeeded`（atomicCommandCapability L4952+）构建 pending result 时，候选列表放在 `decision.recommendations` 中，不是 `candidateOptions`。Case C 已用相同方式修复（L428），Case F 需保持一致。

### 修改 2：将新测试纳入 `agent:check:tests` 脚本

**文件**：`c:\Users\Administrator\Documents\Playground\aibiandan\package.json`

**位置**：L29 `agent:check:tests` 脚本的测试文件列表

**改动**：在 `schedulingAgentRuntime.move.test.ts` 之后追加 `src/services/__tests__/schedulingAgentRuntime.candidateDecision.test.ts`

**理由**：新测试覆盖 case A-G（LlmAgentCandidateJudge 单元决策 + selectCandidate LLM 决策分流 + 候选决策进度消息序列），应纳入 `npm run agent:check` 门禁，防止回归。

### 修改 3：同步过时文档 `docs/code-wiki.md`

**文件**：`c:\Users\Administrator\Documents\Playground\aibiandan\docs\code-wiki.md`

**3 处需同步的位置**（Phase 1 Grep 确认）：

#### 3.1 L336 附近的 Agent 核心运行时分层图
**旧**：
```
├─ DefaultAgentCandidateJudge（评分选择）
```
**新**：
```
├─ LlmAgentCandidateJudge（LLM 候选决策）
```

#### 3.2 L445 核心模块职责表
**旧**：
```
| [candidateJudge.ts](...) | 候选评分选择（名字 100/instance 70/column 30...） |
```
**新**：
```
| [candidateJudge.ts](...) | LLM 候选决策（LLM 自判 auto_select/needs_clarification/unable_to_decide，本地仅校验结构 + 顺播后置校验） |
```

#### 3.3 L883 附近的第二处分层图
**旧**：
```
├─ DefaultAgentCandidateJudge.selectBestCandidate（评分）
```
**新**：
```
├─ LlmAgentCandidateJudge.selectBestCandidate（LLM 决策）
```

**不改的位置**（Phase 1 核对结论）：
- L600 `内含候选选择、TV 顺播、专业评分、约束检查、写入提交`：其中"专业评分"指 ProfessionalRules 的 11 条专业规则（block/confirm/prefer/warn/audit/pass），与 candidateJudge 无关，不改
- L688 `7 维度评分：content_match / duration_fit / rating / trend / sequence / type_fit / schedule_context`：这是 gap filling（空窗补齐）的本地评分逻辑（`selectForGap` / `guardGapSelection`），与 candidateJudge 无关，本轮不改

**理由**：文档应与代码保持一致。`DefaultAgentCandidateJudge` 已删除，`LlmAgentCandidateJudge` 是唯一实现，文档不应再描述已删除的本地评分逻辑。

### 修改 4：运行验证（非代码修改）

**步骤**：
1. 单独运行新测试：`npx vitest run src/services/__tests__/schedulingAgentRuntime.candidateDecision.test.ts`
   - 预期：3 个 describe 块全绿（LlmAgentCandidateJudge 单元决策 7 个 + selectCandidate LLM 决策分流 3 个 + 候选决策进度消息序列 1 个）
2. 运行完整门禁：`npm run agent:check`
   - 预期：`agent:check:tests` + `build` 全绿
3. 文档同步核对：
   - Grep `docs/code-wiki.md` 确认无 `DefaultAgentCandidateJudge` 残留
   - Grep `docs/code-wiki.md` 确认有 `LlmAgentCandidateJudge` 出现

### 修改 5：浏览器冒烟测试（重点确认消息流序列）

**前置**：`npm run dev:agent` 启动开发服务器

**验证场景**：以"在10点插入看东方"为例，观察消息流序列：

| 序号 | 预期 processTypeLabel | 预期 progressStage | 预期内容特征 |
|---|---|---|---|
| 1 | 理解需求 | `intent_understood` | LLM 意图理解反馈（含 reasoning） |
| 2 | 查节目库 | `candidate_lookup` | "正在按 X 查节目库，位置按 Y" |
| 3 | 候选决策 | `candidate_decision` | "在 N 个候选中选择「Z」"或"需要你确认具体排哪个" |
| 4 | 插入结果 | - | 执行结果（executed / needs_confirmation） |

**重点确认**：
- 第 2 条"查节目库"消息是否真的出现（用户提到的"缺失"问题）
- 第 3 条"候选决策"消息文案不出现"置信度""匹配度"等技术词（C13）
- 4 条消息独立呈现，不是合并成 2 条

**降级方案**：若环境无法启动浏览器或 LLM 未配置，则以 `npm run agent:check` 全绿作为验收标准，浏览器冒烟标记为"未覆盖"，并在 Final Report 中明确列出"查节目库消息缺失"问题待下一轮浏览器验证。

**若冒烟发现"查节目库"消息确实缺失**：
- 不在本轮修复，记录缺失场景（输入、预期、实际）
- 启动新 plan 调查触发条件（候选已缓存？单候选直接命中？TV 顺播硬收敛跳过查询？）
- 新增 case 覆盖缺失场景并修复

---

## 4. 约束合规检查（本轮无新设计，仅核对实现是否符合约束）

| 约束 | 来源 | 本轮状态 |
|---|---|---|
| C1 LLM-only 主路径 | AGENTS.md | ✅ 本地评分已删除，LLM 决策 |
| C2 本地逻辑只保护结果 | AGENTS.md | ✅ candidateId 校验 + 顺播后置校验 |
| C3 理解用户是错误方向 | AGENTS.md | ✅ 不本地评分 |
| C4 确定性逻辑在模型返回后 | AGENTS.md | ✅ 顺播后置校验在 LLM 返回后、写入前 |
| C5 经验丰富编排人员选择顺序 | AGENTS.md | ✅ LlmAgentCandidateJudge prompt 已含 |
| C7 候选不足应追问/拒绝 | AGENTS.md | ✅ needs_clarification → needs_selection |
| C8 模型失败应暴露失败 | AGENTS.md | ✅ LLM 失败 → unable_to_decide → needs_selection |
| C9 不得本地分类器截走 | aibiandan-agent-rules.md | ✅ 候选决策由 LLM 承担 |
| C13 不出现技术词 | aibiandan-agent-rules.md | ✅ 进度消息文案用自然语言 |
| C17 Must Refuse 倒序/跳集/重复 | agent-development-protocol.md | ✅ validateCandidateAgainstSequence 后置校验 |

---

## 5. Assumptions & Decisions（假设与决策）

### 决策 1：保留 `LlmAgentCandidateJudge`，不改为直接调用 LLM
- **依据**：与 `LlmAgentIntentInterpreter` 严格对称；保持 atomicCommandCapability 不感知 LLMClient 的分层边界；便于测试 mock
- **不改**：本轮不动 candidateJudge.ts / atomicCommandCapability.ts / schedulingAgentRuntime.ts 的实现层代码

### 决策 2：保留 `AgentCandidateSelectionMethod` 中的 `'candidate_judge'`（无 `_llm` 后缀）
- **依据**：向后兼容，历史 diagnostics 数据可能含此值
- **效果**：当前实现统一用 `'candidate_judge_llm'`，旧值仅为兼容保留，不影响新流程

### 决策 3：保留 `tvSequenceSelector.selectBestCandidate` 旧方法
- **依据**：sequenceSelection 是 TV 顺播硬收敛场景（候选库有期望下一集时直接命中），属"硬约束直接收敛"，不违反 LLM-only（C2 保护结果）
- **效果**：TV 候选库有期望下一集时直接命中，不走 LLM；无期望下一集或顺播不收敛时才走 LLM 决策

### 决策 4：不预设"查节目库消息缺失"的修复方案
- **依据**：Phase 1 探索发现代码层"查节目库"消息分支已就绪，用户提到的"缺失"可能已在上一轮修复
- **效果**：先通过浏览器冒烟确认是否真的缺失；若缺失，记录场景后启动新 plan，不在本轮预设修复方案

### 假设 1：修复 Case F 断言后新测试能全绿
- **依据**：Case C 已用相同方式修复（L428 `result.decision?.recommendations?.length`），Case F 是同一问题
- **风险**：若仍有其他测试失败，定位并修复（仅限测试本身或实现 bug，不改设计方向）

### 假设 2：浏览器冒烟可在本环境执行
- **依据**：项目有 `npm run dev:agent` 脚本
- **风险**：若环境无浏览器或 LLM 未配置，冒烟可能无法完成 → 降级为以 `agent:check` 全绿为准

---

## 6. Verification Steps（验证步骤）

1. **修复 Case F 断言**（修改 1）
2. **运行新测试**（单独）：
   ```
   npx vitest run src/services/__tests__/schedulingAgentRuntime.candidateDecision.test.ts
   ```
   预期：3 个 describe 块全绿
3. **将新测试加入 package.json** 后运行完整门禁（修改 2 + 修改 4）：
   ```
   npm run agent:check
   ```
   预期：`agent:check:tests` + `build` 全绿
4. **文档同步核对**（修改 3）：
   - Grep `docs/code-wiki.md` 确认无 `DefaultAgentCandidateJudge` 残留
   - Grep `docs/code-wiki.md` 确认有 `LlmAgentCandidateJudge` 出现
5. **浏览器冒烟**（修改 5，如条件允许）：
   - 启动 `npm run dev:agent`
   - 在 Codex in-app browser 中输入"在10点插入看东方"
   - 观察 4 条进度消息序列
   - 确认第 2 条 `processTypeLabel === '查节目库'` 且内容含查询关键词
   - 确认第 3 条 `processTypeLabel === '候选决策'` 且文案无技术词

---

## 7. Final Report Checklist（最终汇报检查清单）

任务完成后需汇报：
- [ ] Case F 断言修复说明
- [ ] 新测试运行结果（通过/失败数）
- [ ] `npm run agent:check` 完整门禁结果
- [ ] `docs/code-wiki.md` 同步的 3 处位置
- [ ] 浏览器冒烟观察到的消息流（或降级说明）
- [ ] "查节目库"消息是否真的出现（用户提到的遗漏问题确认结果）
- [ ] 残余风险或未覆盖点

---

## 8. 实施顺序

1. **Step 1**：修复 Case F 测试断言（修改 1）
2. **Step 2**：运行新测试，确认 case A-G 全绿（修改 4 步骤 1-2）
3. **Step 3**：将新测试路径加入 `package.json` 的 `agent:check:tests` 脚本（修改 2）
4. **Step 4**：同步 `docs/code-wiki.md` 的 3 处过时描述（修改 3）
5. **Step 5**：运行 `npm run agent:check` 完整门禁（修改 4 步骤 3）
6. **Step 6**：浏览器冒烟测试（修改 5，如条件允许）
7. **Step 7**：按 Final Report Checklist 输出最终汇报

**不动**：candidateJudge.ts / atomicCommandCapability.ts / schedulingAgentRuntime.ts / tvSequenceCandidateSelector.ts / types.ts / demoRuntimeFacade.ts 的实现层代码（前一轮已完成，本轮只验证不返工；若冒烟发现"查节目库"消息确实缺失，再启动新 plan 修复）
