# 候选决策 LLM 化收尾验证与文档同步 Plan

> 本 plan 承接前一轮已批准并实施完成的 `candidate-decision-implementation-completion.md`，聚焦于剩余的验证、文档同步与门禁纳入工作。
>
> 用户在本轮提出的三个质疑（本地评分是否应删除 / 为何需要 LlmAgentCandidateJudge / LLM 能否独立完成决策）已通过 Phase 1 代码探索确认：实现方向正确，无需返工。本 plan 不再重复实现层改动，只做"收尾"。

---

## 1. Summary（摘要）

前一轮已完成候选决策 LLM 化的全部代码改动（Task 1-7）：

- 删除 `DefaultAgentCandidateJudge`（本地关键词评分，违反 LLM-only C1/C3/C9）
- 新增 `LlmAgentCandidateJudge`（LLM 决策 + 结构校验 + 失败暴露）
- `selectCandidate` 多候选分支改为 LLM 决策 + 顺播后置校验
- 新增"候选决策"进度消息分支（`processTypeLabel: '候选决策'`）
- 新增测试文件 `schedulingAgentRuntime.candidateDecision.test.ts`（覆盖 case A-G）
- `npm run build` 已通过

本轮要做的只有 4 件事：

1. **运行新测试**，确认 case A-G 全绿
2. **将新测试纳入 `agent:check:tests`** 脚本
3. **运行完整门禁** `npm run agent:check`
4. **同步过时文档** `docs/code-wiki.md`（3 处仍引用 `DefaultAgentCandidateJudge`）

---

## 2. Current State Analysis（现状分析）

### 2.1 代码层已就绪（Phase 1 探索结论）

| 文件 | 状态 | 关键证据 |
|---|---|---|
| `src/services/agent/candidateJudge.ts` | ✅ 已重写 | `LlmAgentCandidateJudge` 是唯一实现，`DefaultAgentCandidateJudge` 仅在 L14 注释中作为"历史遗留"被提及 |
| `src/services/agent/schedulingAgentRuntime.ts` | ✅ 已注入 | L73-74 默认实例化 `LlmAgentCandidateJudge`，L335 透传给 capability |
| `src/services/agent/atomicCommandCapability.ts` | ✅ 已重写 | L4571-4675 多候选分支调用 `candidateJudge.selectBestCandidate`，L4611 顺播后置校验，L4654 needs_clarification/unable_to_decide 分流 |
| `src/services/agent/tvSequenceCandidateSelector.ts` | ✅ 已扩展 | L159-197 `buildEvidence`，L203-214 `validateCandidateAgainstSequence` |
| `src/services/agent/types.ts` | ✅ 已扩展 | `AgentCandidateDecision`（L708-719）、`AgentCandidateDecisionType`（L700-704）、`AgentCandidateSelectionMethod` 含 `'candidate_judge_llm'`（L456） |
| `src/services/runtime/demoRuntimeFacade.ts` | ✅ 已扩展 | L5103-5143 "候选决策"进度消息分支，按 decisionType 三态分流文案 |
| `src/services/__tests__/schedulingAgentRuntime.candidateDecision.test.ts` | ✅ 已创建 | 含 3 个 describe 块（LlmAgentCandidateJudge 单元决策 / selectCandidate LLM 决策分流 / 候选决策进度消息序列） |

### 2.2 用户三个质疑的代码层回答

#### 质疑 1：本地评分是否应删除？
**已删除。** `DefaultAgentCandidateJudge` 用关键词匹配打分（name 100/instance 70/column 30/tags 20）替代 LLM 决策，违反 AGENTS.md 的 C1（LLM-only 主路径）、C3（理解用户是错误方向）、C9（不得本地分类器截走）。代码层已无 `scoreCandidate` 等本地评分符号。

#### 质疑 2：为何需要 LlmAgentCandidateJudge？原有架构无法支持吗？
**需要，原有架构无法直接支持。** 理由：

- `atomicCommandCapability.ts`（239KB 大文件）**完全不感知 LLMClient**（Grep 全文 0 命中 `llmClient`/`LLMClient`/`getLLMClient`），这是项目刻意维持的边界
- `SchedulingAgentRuntime` 通过 `candidateJudge?: AgentCandidateJudge` 和 `llmClient?: Pick<LLMClient, 'chat'>` 两个可选注入项解耦
- `LlmAgentCandidateJudge` 与 `LlmAgentIntentInterpreter` **严格对称**：
  - 两者都实现 `Agent*` 接口（`AgentCandidateJudge` / `AgentIntentInterpreter`）
  - 两者都用 `Pick<LLMClient, 'chat'>` 注入（便于测试 mock）
  - 两者都含 `buildMessages` + `parseJson` + 一组 `normalizeXxx` 私有方法
  - 两者都用相同 LLM 调用参数（temperature=0, maxTokens=700-800, timeout=30000, maxRetries=1, 自定义 traceLabel）
- 若直接在 `selectCandidate` 中调 `llmClient.chat`，会让 atomicCommandCapability 直接依赖 LLM 客户端，丧失可测试性，并破坏"runtime → judge interface → llm 实现"三层抽象

#### 质疑 3：LLM 能否独立完成决策？
**已经由 LLM 完成决策。** `LlmAgentCandidateJudge.selectBestCandidate` 的实际行为：

- 候选为空 → `unable_to_decide`（不本地兜底）
- 单候选 → 直接 `auto_select`（确定性窄场景优化，属 C2 保护结果）
- 多候选 → 调用 LLM，要求返回 `{ candidateId, reasoning, considerations, decisionType }`
- LLM 失败/超时/结构无效 → `unable_to_decide` + 失败原因（C8 暴露失败）
- `decisionType` 由 LLM 自判（`auto_select` / `needs_clarification` / `unable_to_decide`），本地不替 LLM 判断（C1/C9）
- 本地只做：candidateId 有效性校验（C2）+ 顺播后置校验（C4/C17）

### 2.3 遗留问题

| 问题 | 位置 | 影响 |
|---|---|---|
| 新测试未纳入 `agent:check:tests` | `package.json` L29 | `npm run agent:check` 不会跑新测试，门禁覆盖不全 |
| `docs/code-wiki.md` 过时 | `docs/code-wiki.md` L336/L445/L883 | 仍引用 `DefaultAgentCandidateJudge` 和"评分选择（名字 100/instance 70/column 30...）"，与实际代码（`LlmAgentCandidateJudge`）不符 |
| 完整门禁未执行 | - | Task 8 未完成，无法确认测试 + 构建全绿 |
| 浏览器冒烟未执行 | - | 无法确认实际消息流序列（理解需求 → 查节目库 → 候选决策 → 插入结果） |

---

## 3. Proposed Changes（具体修改方案）

### 修改 1：将新测试纳入 `agent:check:tests` 脚本

**文件**：`c:\Users\Administrator\Documents\Playground\aibiandan\package.json`

**位置**：L29 `agent:check:tests` 脚本的测试文件列表

**改动**：在列表末尾追加 `src/services/__tests__/schedulingAgentRuntime.candidateDecision.test.ts`

**理由**：新测试覆盖 case A-G（LlmAgentCandidateJudge 单元决策 + selectCandidate LLM 决策分流 + 候选决策进度消息序列），应纳入 `npm run agent:check` 门禁，防止回归。

**插入位置参考**：紧跟 `schedulingAgentRuntime.move.test.ts` 之后（同属 schedulingAgentRuntime 系列）。

### 修改 2：同步过时文档 `docs/code-wiki.md`

**文件**：`c:\Users\Administrator\Documents\Playground\aibiandan\docs\code-wiki.md`

**3 处需同步的位置**：

#### 2.1 L336 附近的 Agent 核心运行时分层图
**旧**：
```
├─ DefaultAgentCandidateJudge（评分选择）
```
**新**：
```
├─ LlmAgentCandidateJudge（LLM 候选决策）
```

#### 2.2 L445 附近的核心模块职责表
**旧**：
```
| candidateJudge.ts | 候选评分选择（名字 100/instance 70/column 30...） |
```
**新**：
```
| candidateJudge.ts | LLM 候选决策（LLM 自判 auto_select/needs_clarification/unable_to_decide，本地仅校验结构 + 顺播后置校验） |
```

#### 2.3 L883 附近的第二处分层图
**旧**：
```
├─ DefaultAgentCandidateJudge.selectBestCandidate（评分）
```
**新**：
```
├─ LlmAgentCandidateJudge.selectBestCandidate（LLM 决策）
```

**理由**：文档应与代码保持一致。`DefaultAgentCandidateJudge` 已删除，`LlmAgentCandidateJudge` 是唯一实现，文档不应再描述已删除的本地评分逻辑。

### 修改 3：运行验证（非代码修改）

**步骤**：
1. 运行新测试：`npx vitest run src/services/__tests__/schedulingAgentRuntime.candidateDecision.test.ts`
2. 运行完整门禁：`npm run agent:check`
3. 如有测试失败，定位并修复（仅限测试本身或实现 bug，不改设计方向）

### 修改 4：浏览器冒烟测试（如条件允许）

**前置**：`npm run dev:agent` 启动开发服务器

**验证场景**：以"在10点插入看东方"为例，观察消息流序列：
1. 第一条：理解需求（LLM 意图理解反馈）
2. 第二条：查节目库（系统信息，露出查询关键词）
3. 第三条：候选决策（LLM 决策思路 + 选择结果，`processTypeLabel: '候选决策'`）
4. 第四条：插入节目单（执行结果）

**预期**：4 条独立进度消息，第三条文案不出现"置信度""匹配度"等技术词（C13），且 `details.progressStage === 'candidate_decision'`。

**降级方案**：若环境无法启动浏览器，则以 `npm run agent:check` 全绿作为验收标准，浏览器冒烟标记为"未覆盖"。

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

### 假设 1：新测试文件能通过 `vitest run`
- **依据**：前一轮实现时已按 case A-G 编写，且 `npm run build` 已通过
- **风险**：若测试本身有 mock 配置问题或断言不准，可能失败 → 届时仅修复测试本身，不改实现

### 假设 2：浏览器冒烟可在本环境执行
- **依据**：项目有 `npm run dev:agent` 脚本
- **风险**：若环境无浏览器或 LLM 未配置，冒烟可能无法完成 → 降级为以 `agent:check` 全绿为准

---

## 6. Verification Steps（验证步骤）

1. **运行新测试**（单独）：
   ```
   npx vitest run src/services/__tests__/schedulingAgentRuntime.candidateDecision.test.ts
   ```
   预期：3 个 describe 块全绿

2. **将新测试加入 package.json** 后运行完整门禁：
   ```
   npm run agent:check
   ```
   预期：`agent:check:tests` + `build` 全绿

3. **文档同步核对**：
   - Grep `docs/code-wiki.md` 确认无 `DefaultAgentCandidateJudge` 残留
   - Grep `docs/code-wiki.md` 确认有 `LlmAgentCandidateJudge` 出现

4. **浏览器冒烟**（如条件允许）：
   - 启动 `npm run dev:agent`
   - 在 Codex in-app browser 中输入"在10点插入看东方"
   - 观察 4 条进度消息序列
   - 确认第三条 `processTypeLabel === '候选决策'` 且文案无技术词

---

## 7. Final Report Checklist（最终汇报检查清单）

任务完成后需汇报：
- [ ] 新测试运行结果（通过/失败数）
- [ ] `npm run agent:check` 完整门禁结果
- [ ] `docs/code-wiki.md` 同步的 3 处位置
- [ ] 浏览器冒烟观察到的消息流（或降级说明）
- [ ] 残余风险或未覆盖点

---

## 8. 实施顺序

1. **Step 1**：运行新测试，确认通过
2. **Step 2**：将新测试路径加入 `package.json` 的 `agent:check:tests` 脚本
3. **Step 3**：同步 `docs/code-wiki.md` 的 3 处过时描述
4. **Step 4**：运行 `npm run agent:check` 完整门禁
5. **Step 5**：浏览器冒烟测试（如条件允许）
6. **Step 6**：按 Final Report Checklist 输出最终汇报

**不动**：candidateJudge.ts / atomicCommandCapability.ts / schedulingAgentRuntime.ts / tvSequenceCandidateSelector.ts / types.ts / demoRuntimeFacade.ts 的实现层代码（前一轮已完成，本轮只验证不返工）
