# 归档文件索引

更新时间：2026-06-28

## 目的

本目录归档了 aibiandan 仓库中**已被取代或严重过时**的历史文档。

归档原则：

- 不删除原始内容，保留历史可追溯。
- 当前开发**不再以本目录文件为依据**；活跃约束请查 `AGENTS.md` 与 `docs/` 根目录剩余文档。
- 若需查证历史决策来源，可在此目录按主题查找。
- 若归档内容与活跃文档冲突，**一律以活跃文档为准**。

## 活跃文档清单（替代依据）

以下文档为当前唯一权威来源：

| 文档 | 用途 |
|------|------|
| `AGENTS.md` | Agent Harness Protocol 强制工作协议 |
| `docs/agent-development-protocol.md` | Agent Harness 开发规范 |
| `docs/aibiandan-agent-rules.md` | 业务规则与工程约束 |
| `docs/code-wiki.md` | 结构化技术文档（2026-06-25 最新） |
| `docs/agent-evolution-roadmap-proposal.md` | Agent 演进技术方案 v2 |
| `docs/agent-server-migration-plan.md` | 服务端迁移落地记录（Goal 42-49） |
| `docs/agent-direction-1-execution-card.md` | 方向 1 执行卡 |
| `docs/agent-deployment-runbook.md` | 部署与运维 runbook |
| `docs/scheduling-agent-natural-language-command-inventory.md` | 原子命令清单 |

## 归档目录分类

### `baseline/` — 已严重过时的基线状态文档

归档原因：

- 引用失效的绝对路径 `./`（实际仓库路径为 `c:\Users\Administrator\Documents\Playground\aibiandan`）。
- 测试统计严重过时（旧基线"13 个测试文件、57 个用例"，实际 100+ 测试文件）。
- 架构层级描述与实际 6 层不符（旧版写 5 层）。
- 技术债台账已被 `docs/agent-evolution-roadmap-proposal.md` 中 A1-A16 缺陷清单取代。
- 功能对齐表 F01-F09 / AC01-AC24 状态与代码实际状态不符。

包含文件：

- `architecture.md`
- `current-status.md`
- `tech-debt.md`
- `testing-baseline.md`
- `module-map.md`
- `feature-alignment.md`
- `project-brief.md`

### `roadmap/` — 旧路线图

归档原因：

- Phase A-D 描述与 Goal 39-51 实际推进状态不符。
- 阶段判断已被 `docs/agent-evolution-roadmap-proposal.md`（v2 修订版）取代。

包含文件：

- `roadmap.md`

### `proposal/` — 已落地或被取代的技术方案

归档原因：

- 大部分已落地实现，方案已并入 `docs/code-wiki.md` 与 `docs/agent-evolution-roadmap-proposal.md`。
- 引用失效绝对路径。
- 部分方案的状态描述（如 SSE 双路径、候选检索重试、对话多气泡流式）与代码现状不符。

包含文件：

- `layout-draft-workflow.md`（已实现，2026-04-13）
- `atomic-context-management-technical-design.md`（已实现，2026-04-15）
- `insert-program-recommendation-technical-design.md`（已实现，2026-04-15）
- `atomic-command-clarification-requirements.md`（已实现，2026-04-15）
- `scheduling-agent-core-v1.1-execution-plan.md`（执行计划，已落地）
- `first-priority-llm-only-fix-proposal.md`（修复方案，已落地）
- `candidate-search-retry-expansion-proposal.md`（已实现，2026-06-28）
- `chat-feedback-trim-proposal.md`（方案已评估）
- `chat-multi-bubble-progress-proposal.md`（已实现，2026-06-27）
- `chat-sse-streaming-progress-proposal.md`（已实现 SSE 双路径）
- `no-baseline-earliest-episode-fix-proposal.md`（solution-architect 撰写 v1.0，状态：已归档 — 基于错误假设被新方案取代。旧方案推荐"prompt 修正 + 本地后置收敛兜底"双保险（方案 C），核心假设是"LLM 偶发不遵守无基线选最早一期规则需要本地兜底收敛"。新调研发现真实根因是：① `candidateJudge.ts` prompt 错误把"时长适配"列为硬条件，但候选决策 LLM 拿不到目标时段时长数据，必然退回 `needs_clarification`；② `finishedProducts.json` 中看东方 111-114 期假数据时长不真实（3600/2700/2700/1800s，与需求文档 5400s/集及东方卫视真实播出时长 90-120 分钟矛盾）。用户已确认新决策：仅修正 prompt（移除时长适配硬条件）+ 修正假数据时长为 5400s，**不加本地兜底**（符合 LLM-first / 本地不改写意图原则）。新方案 v2.0 位于 `docs/proposals/no-baseline-earliest-episode-fix-proposal.md`）

### `openclaw/` — OpenClaw 预研文档

归档原因：

- 按 `docs/aibiandan-agent-rules.md` 明确，OpenClaw 只是外部访问方，不是当前测试或实现阻塞条件。2026-07-21 已删除对应的进程内 bridge、host adapter、userscript 与专属测试；未来如需接入，只能复用统一 CLI/API 契约，且当前不实现 CLI。
- 引用失效绝对路径。
- 当前不进入正式集成阶段。

包含文件：

- `openclaw-formal-integration.md`（预研，2026-04-07）
- `openclaw-frontend-bridge.md`（前台桥接，2026-04-07）
- `openclaw-userscript-demo.md`（演示说明，2026-04-07）

### `plans/` — 历史下一步方向草案

归档原因：

- `agent-next-direction-analysis.md`、`agent-next-direction-v2.md`、`agent-next-direction-v3.md` 是阶段性讨论稿，包含已被当前唯一九阶段计划取代的 Goal/阶段表述。
- 三份文件未被活跃文档索引引用，继续留在 `docs/` 根目录会与 `AGENTS.md` 的九阶段计划及当前代码状态产生歧义。

包含文件：

- `agent-next-direction-analysis.md`
- `agent-next-direction-v2.md`
- `agent-next-direction-v3.md`

### `acceptance/` — 旧验收清单

归档原因：

- 已被 `npm run agent:browser:goal37` 与 `npm run agent:browser:goal38` 浏览器回归取代。
- 验收场景描述与当前 Goal 37/38 实际门禁不符。

包含文件：

- `agent-workflow-browser-test-plan.md`（2026-06-14）
- `scheduling-agent-v1-foreground-acceptance.md`（2026-06-17）

### `plans/` — plans 子目录历史方案

归档原因：

- `docs/plans/` 子目录已废弃，方案已落地或被取代。

包含文件：

- `prompt-clarify-reject-failure-fix.md`
- `prompt-version-and-path-compliance.md`（solution-architect 撰写，状态：待用户确认；为 AGENTS.md 的 C1 Prompt 版本管理与 C2 文档路径合规约束做最小化合规修复方案）
- `agent-phase2-spec.md`（基于 2026-06-28 代码的迁移规格；D23 与正式 ReAct 路径已落地，旧 full/partial facade 契约不再有效）
- `formal-orchestration-react-runtime.md`（第四阶段执行卡；阶段已完成，且“缺少 reactTask 可显式兼容旧 Orchestrator”的旧描述已失效）
- `formal-orchestration-stability.md`（第五阶段长流程稳定性执行卡；阶段已完成，现以正式运行时与回归门禁为准）
- `fix-tv-fullday-rotation-generation.md`（电视全天编排与轮播生成的阶段性待确认方案；已被九阶段落地结果取代）
- `prompt-sequence-unify-and-regroup.md`（Prompt 重组阶段方案；相关版本化与顺播约束已落地，现以活跃协议为准）
- `prompt-version-gate-full-closure.md`（Prompt 版本门禁阶段方案；相关门禁已落地，现以 `AGENTS.md` 与测试配置为准）

### `legacy-dev-plans/` — 历史开发计划（来自 `.trae/documents/`）

归档原因：

- 原存放于 `.trae/documents/` 的 23 个临时开发计划文档。
- 内容已被 `docs/code-wiki.md`（2026-06-25 最新）与 `docs/agent-server-migration-plan.md`（Goal 47-49 落地记录）完整取代。
- 大量为阶段性开发计划、create 页面修复计划 v2/v3/v4、阶段三/四/五开发计划等历史产物。
- 非特殊需要**不再需要关注**。

包含文件：

- `AI智能编排功能集成计划.md`
- `Kimi2.5编排LLM接入开发计划.md`
- `Kimi2.5编排LLM接入开发计划_修正.md`
- `LLM自动编排串联单开发计划.md`
- `LLM自动编排开发计划v2.md`
- `candidate-decision-implementation-completion.md`
- `candidate-decision-llm-only-and-progress-messages.md`
- `candidate-decision-verification-and-doc-sync.md`
- `next-step-development-plan.md`
- `下一步工作计划.md`
- `下一步开发规划.md`
- `下一步开发计划.md`
- `下一步开发计划_阶段三.md`
- `下一步开发计划_阶段五.md`
- `下一步开发计划_阶段四.md`
- `修复create页面计划.md`
- `修复create页面计划_v2.md`
- `修复create页面计划_v3.md`
- `修复create页面计划_v4.md`
- `原技术方案书修订稿-LLM自动编排.md`
- `测试验证计划.md`
- `阶段五开发计划_数据结构兼容性说明.md`
- `页面布局修复计划.md`

## 重新激活原则

如果未来某项归档内容需要重新激活为活跃文档：

1. 必须先更新所有失效路径（`./` → 当前真实路径）。
2. 必须同步测试统计与 Goal 推进状态。
3. 必须确认与 `AGENTS.md` / `docs/agent-evolution-roadmap-proposal.md` 不冲突。
4. 移回 `docs/` 根目录并在 `docs/code-wiki.md` 第 12 节"文档索引"登记。
