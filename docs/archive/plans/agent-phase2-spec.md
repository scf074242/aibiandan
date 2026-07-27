# Agent Phase 2 技术规格：D23 三路径收口 + D10/D11/D21 大文件拆分

> 本规格依据 `docs/agent-next-direction-v3.md` 阶段 2 任务清单（D23、D10、D11、D21）及 `AGENTS.md` 强制工作协议编制，用于指导后续实现与 code review。所有路径使用相对路径，基于仓库根目录。

---

## 1. 目标与非目标

### 1.1 目标（Goals）

1. **D23 三路径收口**：将当前并行的三套 runtime（老 `Orchestrator`、`DemoRuntimeFacade`、`SchedulingAgentRuntime`）收敛为以 `SchedulingAgentRuntime` + `CapabilityRegistry` 为唯一分发核心的单路径。
2. **D11 按 intent 拆分 `atomicCommandCapability.ts`**：将 6219 行的单 capability 拆分为 8 个独立 capability（move / insert / replace / delete / batchMove / batchDelete / query / validate），统一注册到 `CapabilityRegistry`。
3. **D10 `demoRuntimeFacade.ts` 局部瘦身**：将长流程编排执行逻辑迁出到 `FormalOrchestrationCapability`，facade 仅保留 submit 主循环与 decision 路由，目标 < 5000 行。
4. **D21 `create.vue` 拆分**：按 `broadcast-plan/` 目录既有命名约定继续抽取 helper / composable，目标 < 2000 行。
5. **补全回归 case**：新增 capability 路由、停止信号、deadline 透传、大文件拆分后的行为不变性 case，并纳入 `agent:check:tests`。

### 1.2 非目标（Non-Goals）

- **不引入自动回滚**：禁止实现 `validateOrRollback` / `mutationJournal` / `autoRollback`；失败仅暴露结构化 envelope，状态保留。
- **不引入子 agent**：禁止出现 `DraftAgent` / `CandidateAgent` / `SelectionAgent` / `WriteAgent` / `ValidationAgent` 等子 agent 雏形。
- **不改变业务行为**：拆分与收口必须是行为保留式重构，原子命令策略（电视播单直接执行、轮播单候选推荐、删除始终确认）保持不变。
- **不实现真 ReAct 自主多轮**：真 ReAct（D8）属于阶段 3，本阶段仅完成 runtime 收口与 capability 拆分，不修改 `executeReactAgentPlan` 的执行 semantics。
- **不迁移 HTTP agent runtime**：`HttpAgentRuntimeClient` / `AgentServerRuntime` 属于服务端迁移长期任务，本阶段不改变其边界。

---

## 2. 现状核对（基于 2026-06-28 代码）

| 文件 | 当前行数 | 红线 | 关键问题 |
|------|---------|------|----------|
| `src/services/runtime/demoRuntimeFacade.ts` | 9914 | 5000 | 超长；内含 submitInstruction、tryHandleAgentPlannerInstruction、executeReactAgentPlan、executeAgentPlan 等主循环与编排执行逻辑 |
| `src/services/agent/atomicCommandCapability.ts` | 6219 | 5000 | 超长；单一 capability 处理 8 种 intent 及其 pending 状态 |
| `src/views/broadcast-plan/create.vue` | 3631 | 2000 | 页面容器仍含大量内联 computed / handler / 模板逻辑 |
| `src/services/orchestrator.ts` | 1514 | 2000（建议） | 老 Orchestrator 仍被 useOrchestrator.ts 直接使用 |
| `src/composables/useOrchestrator.ts` | 6042 字节 | - | 直接依赖老 Orchestrator，未接入 SchedulingAgentRuntime |
| `src/services/agent/schedulingAgentRuntime.ts` | 23085 字节 | - | 已具备 CapabilityRegistry 与 AgentDeadline 透传能力 |
| `src/services/agent/capabilityRegistry.ts` | 743 字节 | - | 已实现 register / list / resolve / resolveAll，但无 metadata 与路由冲突显式策略 |

### 2.1 三路径现状

- **路径 A（老 Orchestrator）**：`src/composables/useOrchestrator.ts:31` -> `getOrchestrator()` -> `src/services/orchestrator.ts:129`，用于 `startFullGeneration` / `startPartialGeneration` / `cancel()`。
- **路径 B（DemoRuntimeFacade）**：`ChatPanel.vue` / `create.vue` 通过 `DemoRuntimeFacade.submitInstruction` 进入，内部调用 `agentPlanner.plan` -> `executeAgentPlan` / `executeReactAgentPlan` -> `runAgentCore` -> `SchedulingAgentRuntime.submit`。
- **路径 C（SchedulingAgentRuntime）**：`runAgentCore` 中实例化 `SchedulingAgentRuntime`，注册 `AtomicCommandCapability`，通过 `CapabilityRegistry.resolveAll` 路由。

当前问题：
- `useOrchestrator.ts` 与 `DemoRuntimeFacade` 的停止信号、deadline、session 状态不互通。
- `DemoRuntimeFacade` 内部同时承担「submit 主循环」「decision 路由」「编排执行」「原子 capability 调用」四重职责。
- `CapabilityRegistry` 在 `DemoRuntimeFacade` 外部不可见，无法被前台直接复用。

---

## 3. D23 三路径收口详细设计

### 3.1 收口后架构

```
前台（ChatPanel.vue / create.vue / useOrchestrator.ts）
  统一调用 SchedulingAgentRuntimeFacade.submitInstruction()

SchedulingAgentRuntimeFacade（单例 facade）
  仅负责：workspace 切换检查、layout draft 门禁、submit 主循环
  所有决策交给 AgentPlanner -> CapabilityRegistry

AgentPlanner（保留在 facade 内或独立模块，本阶段先保留）
  产出 AgentPlan（含 atomic / formal_orchestration / react 等）

CapabilityRegistry（唯一分发）
  resolveAll(input) -> 单 capability -> handle()

分支：
  - 原子命令 capabilities（Move/Insert/Replace/Delete/BatchMove/BatchDelete/Query/Validate）
  - FormalOrchestrationCapability（新增，承接长流程编排执行）
  - LayoutDraftCapability（已存在或后续拆分）
```

### 3.2 代码迁移方案

#### 3.2.1 `useOrchestrator.ts` 迁移

**当前**：`useOrchestrator.ts:31` 调用 `getOrchestrator(llmClient, taskClassifier)`。

**目标**：改为调用 `SchedulingAgentRuntimeFacade` 的编排入口，保持对外接口（`startFullGeneration`、`startPartialGeneration`、`cancel`、`getProgress`、`getSession`）不变。

**迁移步骤**：
1. 在 `SchedulingAgentRuntimeFacade` 上新增长流程编排 facade 方法：
   - `startFullGeneration(channelId, date, dayStartTime, dayEndTime)`
   - `startPartialGeneration(channelId, date, target)`
   - `cancel()`
   - `getProgress()` / `getSession()`
2. 这些方法内部使用 `FormalOrchestrationCapability` 或 `reactTaskRuntime` 执行，不再调用老 `Orchestrator`。
3. `useOrchestrator.ts` 内部通过 `getSchedulingAgentRuntimeFacade()` 获取 facade 实例。
4. 老 `Orchestrator` 类标记 `@deprecated`，保留文件直至阶段 3 验证完成后再删除。

**接口契约（SchedulingAgentRuntimeFacade）**：

- `startFullGeneration(channelId, date, dayStartTime, dayEndTime): Promise<void>`
- `startPartialGeneration(channelId, date, target?): Promise<void>`
- `cancel(): void`
- `getProgress(): OrchestrationProgress | null`
- `getSession(): PlanningSession | null`

#### 3.2.2 `DemoRuntimeFacade` 职责瘦身

**迁出内容**：
- `executeReactAgentPlan` 中的长流程编排执行逻辑 -> `FormalOrchestrationCapability`。
- `executeAgentPlan` 中 `formal_orchestration` action 的处理分支 -> `FormalOrchestrationCapability`。
- 进度事件构建（`buildAgentTraceProgressEvent`、`buildAgentPlannerProgressEvent`）独立为 `agentProgressEventBuilder.ts` helper。

**保留内容**：
- `submitInstruction` 主循环（workspace 切换、layout draft 门禁、路由到 agent planner）。
- `tryHandleAgentPlannerInstruction` -> `executeAgentPlan` 的轻量路由。
- 原子命令 capability 调用链路（通过 `runAgentCore` -> `SchedulingAgentRuntime.submit`）。
- 与 `ChatPanel.vue` / `create.vue` 的 `RuntimeDecision` 反馈契约。

**目标**：`demoRuntimeFacade.ts` 从 9914 行降至 < 5000 行。

#### 3.2.3 新增 `FormalOrchestrationCapability`

**位置**：`src/services/agent/formalOrchestrationCapability.ts`

**职责**：
- 处理 `AgentPlan` 中 `formal_orchestration` action 与 `react` mode 的长流程编排。
- 管理 `ReactTaskRun` 生命周期（启动、观察记录、checkpoint）。
- 调用 `reactTaskRuntime` 与 `SchedulingTaskPlanCompiler` 完成实际编排。
- 透传 `AgentDeadline` 与 `AbortSignal` 到下层 LLM / fetch 调用。

**canHandle 条件**：

```ts
canHandle(input: AgentSubmitInput): boolean {
  const intent = input.interpretation?.intent
  if (intent === 'formal_orchestration') return true
  if (input.pendingTask?.intent === 'formal_orchestration') return true
  return false
}
```

> 注：当前 `interpretation.intent` 类型 `AtomicCommandIntent` 可能不含 `formal_orchestration`，需要在 `src/services/agent/types.ts` 中扩展类型或新增 `AgentIntent` 联合类型。

**handle 行为**：
1. 读取 `input.scheduleState`、`currentSchedule`、`history`、`currentLayoutDraft` 等上下文。
2. 解析 taskKind（当前仍允许本地正则作为过渡，但代码结构需为阶段 3 的 LLM 返回 `taskKind` 预留位置）。
3. 调用 `reactTaskRuntime.startRun` / `recordObservation` / `compilePlan`。
4. 返回 `AgentResult`，状态包括 `executed` / `needs_clarification` / `failed` / `react_checkpoint`。

#### 3.2.4 `CapabilityRegistry` 增强

**当前**：仅 `register / list / resolve / resolveAll`，`resolveAll` 通过 `canHandle` 布尔匹配。

**增强**：新增 `CapabilityMetadata` 与路由冲突显式处理，但保持接口兼容。

```ts
export interface CapabilityMetadata {
  id: string
  supportedIntents: string[]
  requiredSources: (keyof SchedulingContextSourceContext)[]
  safetyGates: ('confirm' | 'block' | 'read_only')[]
  allowsCoRouting?: boolean
}

export interface AgentCapability {
  readonly id: string
  readonly metadata?: CapabilityMetadata
  canHandle(input: AgentSubmitInput): boolean
  handle(input: AgentSubmitInput, runtime: AgentCapabilityRuntime): Promise<AgentResult>
}
```

**路由冲突策略**：
- 当 `resolveAll` 返回 >1 个 capability 且它们都未声明 `allowsCoRouting: true` 时，返回 `capability_route_conflict` blocked 结果。
- `FormalOrchestrationCapability` 与原子命令 capability 不应同时匹配；通过 intent 区分。

### 3.3 `AgentDeadline` / `AbortSignal` / 停止按钮传播

#### 3.3.1 传播链路

```
前台点击「停止」
  -> useOrchestrator.cancel()
  -> SchedulingAgentRuntimeFacade.cancel()
  -> AgentDeadline.abort()
  -> AbortController.abort()
  -> AbortSignal 传入：
      - LLM 调用（llmClient.chat 的 signal 参数）
      - fetch 请求
      - reactTaskRuntime 批次循环
```

#### 3.3.2 `AgentDeadline` 增强

在 `src/services/agent/agentDeadline.ts` 中补充：

```ts
export class AgentDeadline {
  /** 返回可传入 fetch / LLM 调用的 AbortSignal。 */
  signal(): AbortSignal { return this.controller.signal }
  /** 主动中止，供 UI 停止按钮调用。 */
  abort(reason?: string): void { this.aborted = true; this.controller.abort(reason) }
  /** 是否已超时或已中止。 */
  isExpired(): boolean { return this.aborted || this.remainingMs() <= 0 }
}
```

#### 3.3.3 老 `Orchestrator.cancel()` 过渡方案

- 阶段 2 中老 `Orchestrator` 仍保留但标记 `@deprecated`。
- 其 `cancel()` 方法改为调用 `AgentDeadline.abort()`（如果存在活跃 deadline），不再仅设置 `isCancelled = true`。
- `useOrchestrator.ts` 完成迁移后，老 `Orchestrator` 的 `cancel` 不再被前台直接调用。

### 3.4 老 `Orchestrator` 废弃计划

| 阶段 | 动作 | 验收 |
|------|------|------|
| 阶段 2 开始 | 在 `src/services/orchestrator.ts` 类上添加 `@deprecated` JSDoc | 全仓 grep `new Orchestrator` / `getOrchestrator` 只剩 `useOrchestrator.ts` 一处 |
| 阶段 2 中 | `useOrchestrator.ts` 改为调用 `SchedulingAgentRuntimeFacade` | `orchestrator.test.ts` 继续通过（兼容层），新增 `schedulingAgentRuntimeFacade.orchestration.test.ts` |
| 阶段 3 | 真 ReAct 改造完成后删除老 `Orchestrator` | 删除文件，更新 `useOrchestrator.ts` 为薄 wrapper 或删除该 composable |

---

## 4. D10/D11/D21 大文件拆分详细设计

### 4.1 D11 `atomicCommandCapability.ts` 按 intent 拆分

#### 4.1.1 拆分原则

- 每个 intent 一个独立 capability 文件，文件名遵循 `src/services/agent/<intent>Capability.ts`。
- 每个 capability 负责：该 intent 的首次执行、pending 状态续跑、澄清、确认。
- 共享逻辑（如上下文加载、pending task 创建、约束校验、候选 judge）提取到 `src/services/agent/atomicCommandShared.ts`。
- 统一注册到 `CapabilityRegistry`，禁止在 `DemoRuntimeFacade` 中保留独立 if-else 分发。

#### 4.1.2 新文件清单

| 文件 | 职责 | 目标行数 |
|------|------|----------|
| `src/services/agent/moveCapability.ts` | 移动节目：首次移动、pending move 续跑、目标选择、偏移/新时间点澄清 | <= 1800 |
| `src/services/agent/insertCapability.ts` | 插入节目：首次插入、pending insert 续跑、候选推荐、确认 | <= 1800 |
| `src/services/agent/replaceCapability.ts` | 替换节目：首次替换、pending replace 续跑、候选推荐、确认 | <= 1800 |
| `src/services/agent/deleteCapability.ts` | 删除节目：首次删除、pending delete 续跑、危险确认 | <= 1500 |
| `src/services/agent/batchMoveCapability.ts` | 批量移动：范围选择、批量偏移、pending batch_move 续跑 | <= 1800 |
| `src/services/agent/batchDeleteCapability.ts` | 批量删除：范围选择、批量删除确认 | <= 1500 |
| `src/services/agent/queryCapability.ts` | 查询：播单查询、候选查询、只读报告 | <= 1200 |
| `src/services/agent/validateCapability.ts` | 校验：版面/播单校验、问题报告 | <= 1200 |
| `src/services/agent/atomicCommandShared.ts` | 共享：slot 解析、pending 创建、约束调用、候选 judge 调用、trace 记录 | <= 2000 |

#### 4.1.3 Capability 注册方式

在 `src/services/agent/schedulingAgentRuntime.ts` 中：

```ts
import { MoveCapability } from './moveCapability'
import { InsertCapability } from './insertCapability'
import { ReplaceCapability } from './replaceCapability'
import { DeleteCapability } from './deleteCapability'
import { BatchMoveCapability } from './batchMoveCapability'
import { BatchDeleteCapability } from './batchDeleteCapability'
import { QueryCapability } from './queryCapability'
import { ValidateCapability } from './validateCapability'
import { FormalOrchestrationCapability } from './formalOrchestrationCapability'

const defaultCapabilities: AgentCapability[] = [
  new MoveCapability(),
  new InsertCapability(),
  new ReplaceCapability(),
  new DeleteCapability(),
  new BatchMoveCapability(),
  new BatchDeleteCapability(),
  new QueryCapability(),
  new ValidateCapability(),
  new FormalOrchestrationCapability(),
]

defaultCapabilities.forEach((capability) => this.registry.register(capability))
```

> 保持向后兼容：当 `options.capabilities` 显式传入 `[new AtomicCommandCapability()]` 时仍使用旧单一 capability，便于灰度切换。

#### 4.1.4 Metadata 示例

```ts
// src/services/agent/moveCapability.ts
export class MoveCapability implements AgentCapability {
  readonly id = 'move'
  readonly metadata: CapabilityMetadata = {
    id: 'move',
    supportedIntents: ['move'],
    requiredSources: ['today', 'constraints', 'policy'],
    safetyGates: ['block'],
  }

  canHandle(input: AgentSubmitInput): boolean {
    return input.interpretation?.intent === 'move' || input.pendingTask?.intent === 'move'
  }

  async handle(input: AgentSubmitInput, runtime: AgentCapabilityRuntime): Promise<AgentResult> {
    // ...
  }
}
```

#### 4.1.5 共享逻辑抽取

`atomicCommandShared.ts` 至少包含：
- `buildPendingContextFingerprint(context)`
- `buildPendingContextSourceSnapshots(context)`
- `loadSchedulingContext(input, runtime)`
- `callCandidateJudge(input, candidates, context, runtime)`
- `createAtomicPendingTask(...)`
- `buildConstraintReport(...)`
- 通用 trace 标签常量

### 4.2 D10 `demoRuntimeFacade.ts` 瘦身

#### 4.2.1 迁出模块

| 迁出模块 | 目标文件 | 说明 |
|----------|----------|------|
| 长流程编排执行 | `src/services/agent/formalOrchestrationCapability.ts` | 处理 formal_orchestration / react mode |
| 进度事件构建 | `src/services/runtime/agentProgressEventBuilder.ts` | `buildAgentTraceProgressEvent`、`buildAgentPlannerProgressEvent` |
| layout draft 相关决策 | 保留在 facade 或后续迁到 `LayoutDraftCapability` | 阶段 2 先保留，避免范围蔓延 |
| 工具函数 | `src/services/runtime/runtimeDecisionHelpers.ts` | 如 `createFeedback` 包装、decision 工厂函数 |

#### 4.2.2 保留职责

- `submitInstruction` 主循环与 `currentDeadline` 生命周期。
- workspace 切换、layout draft 门禁、playlist 创建等前置分支。
- 调用 `AgentPlanner.plan` 与 `CapabilityRegistry` 的轻量路由。
- 将 `AgentResult` 转换为 `RuntimeDecision` 反馈给前台。

### 4.3 D21 `create.vue` 拆分

#### 4.3.1 现状

`src/views/broadcast-plan/create.vue` 3631 行，已使用：
- `useBroadcastPlanEditor.ts`
- `useBroadcastPlanOrchestration.ts`
- `useBroadcastPlanFocus.ts`
- `broadcastPlanScheduleBridge.ts`
- `broadcastPlanGapState.ts`
- `broadcastPlanViewState.ts`

但仍内联大量逻辑：workspace tab 切换、layout draft 计算、时间轴滚动、focus 标记、空播单状态、broadcast window 同步、validation report 等。

#### 4.3.2 新增可抽取模块

| 新文件 | 职责 | 来源 create.vue 中的行号区域 |
|--------|------|------------------------------|
| `useBroadcastPlanWorkspace.ts` | workspace tab 切换、`showLayoutDraftTab`、workspace title / meta | 780-858 行附近 |
| `useBroadcastPlanTimelineScroll.ts` | 时间轴滚动、scrollbar 同步、`scrollToItemRow`、`scrollToTimeRange` | 1080-1160 行附近 |
| `useBroadcastPlanBroadcastWindow.ts` | broadcast window 标签/文本、`syncCurrentBroadcastWindow` | 1636-1690 行附近 |
| `useBroadcastPlanValidation.ts` | validation report、`refreshValidationReport`、与 validation service 交互 | 1658-1690 行附近 |
| `useBroadcastPlanEmptyState.ts` | 空播单状态、新建播单引导 | 空播单模板与 `handleCreatePlaylist` 相关 |
| `broadcastPlanItemLabels.ts` | `getTypeText`、`getTypeTagType`、`getContentTypeText`、`getMaterialStatusText` 等纯函数 | 2136-2180 行附近 |

#### 4.3.3 拆分目标

- `create.vue` 目标 < 2000 行。
- 保留 `<template>` 中的结构代码，但 script setup 部分大量逻辑迁出到 composables。
- 不引入新的业务判断；仅做视图/状态管理职责拆分。

---

## 5. 接口与契约

### 5.1 `AgentCapabilityRuntime` 不变

继续复用现有契约：

```ts
export interface AgentCapabilityRuntime {
  dataGateway: SchedulingDataGateway
  candidateJudge: AgentCandidateJudge
  trace: AgentTraceRecorder
  deadline?: AgentDeadline
}
```

所有 capability 必须透传 `deadline` 到任何下游 LLM 调用。

### 5.2 `AgentSubmitInput` 扩展

为支持 `formal_orchestration` capability，扩展 `interpretation.intent` 类型：

```ts
export type AgentIntent =
  | AtomicCommandIntent
  | 'formal_orchestration'
  | 'layout_draft_prepare'
  | 'layout_draft_refine'
  | 'layout_draft_commit'
```

> 若影响面过大，可仅在 `FormalOrchestrationCapability.canHandle` 中读取 `input.interpretation?.formalOrchestration` 等附加字段，避免改 `AtomicCommandIntent` 联合类型。

### 5.3 `AgentResult` 状态

新增长流程 checkpoint 状态（可选）：

```ts
export type AgentResultStatus =
  | 'executed'
  | 'needs_clarification'
  | 'blocked'
  | 'failed'
  | 'react_checkpoint'
```

`react_checkpoint` 用于阶段 3 真 ReAct，阶段 2 可先保留为预留字段。

### 5.4 `SchedulingAgentRuntimeFacade` 编排接口

必须与老 `Orchestrator` 接口同构，保证 `useOrchestrator.ts` 迁移成本最小：

```ts
export interface OrchestrationRuntime {
  startFullGeneration(channelId, date, dayStartTime, dayEndTime): Promise<void>
  startPartialGeneration(channelId, date, target?): Promise<void>
  cancel(): void
  getProgress(): OrchestrationProgress | null
  getSession(): PlanningSession | null
  on(event, listener): void
  removeAllListeners(): void
}
```

---

## 6. 验收标准与验证门禁

### 6.1 单元测试与门禁

| 验证项 | 命令 | 通过标准 |
|--------|------|----------|
| 全量 agent 测试 | `npm run agent:check` | 全部通过 |
| capability 路由测试 | 新增 `schedulingAgentRuntime.capabilityRouting.test.ts` | 覆盖每个子 capability 至少一次成功路由；覆盖 `capability_route_conflict` |
| deadline 透传测试 | 新增 `schedulingAgentRuntime.deadline.test.ts` | 验证 `AgentDeadline.signal()` 传入 LLM 调用；验证 abort 后 stage 停止 |
| 行为不变性测试 | 复用 `schedulingAgentRuntime.commandMatrix.test.ts` + `schedulingAgentRuntime.move.test.ts` | 原有 case 全部通过 |
| facade 瘦身验证 | 行数统计 | `demoRuntimeFacade.ts` < 5000 行，`atomicCommandCapability.ts` < 5000 行（拆分后可能保留为兼容壳或直接删除） |
| create.vue 瘦身验证 | 行数统计 | `create.vue` < 2000 行 |
| 构建检查 | `npm run build` | 无类型错误、无构建失败 |

### 6.2 浏览器冒烟

- 刷新 `http://localhost:5173`，进入 broadcast-plan 页面。
- 触发一次电视播单插入命令，验证候选推荐面板正常弹出。
- 触发一次移动命令，验证节目位置变更。
- 触发一次删除命令，验证确认流程。
- 触发一次「全天编排」长流程，验证进度条出现、停止按钮 5s 后可点击、停止后状态保留。

### 6.3 LLM 调用监控

- 触发任意原子命令后，检查 trace 中 `tokenUsage / latencyMs / model / promptVersion` 字段存在。
- `llmCallMonitor` 真正接入（阶段 1 收尾）完成后，本阶段不再新增未监控调用点。

---

## 7. 风险分析与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 拆分后行为漂移 | 原子命令执行结果变化 | 先补回归 case 再拆分；每个子 capability 单测覆盖 happy path + pending path + 失败 path；`agent:check` 全量通过 |
| Capability 路由冲突 | 多个 capability 同时匹配导致 blocked | 新增 `CapabilityMetadata` 与 `allowsCoRouting`；`resolveAll` 冲突时返回结构化 envelope |
| `useOrchestrator.ts` 迁移后老编排入口不可用 | 前台长流程无法启动 | 保留 `Orchestrator` 兼容层直至新 facade 编排接口验证通过；`orchestrator.test.ts` 继续纳入 `agent:check` |
| Deadline/AbortSignal 未全链路透传 | 停止按钮无效 | 新增 `schedulingAgentRuntime.deadline.test.ts`；所有 capability handle 方法签名强制要求透传 `runtime.deadline` |
| `create.vue` 拆分引入响应式丢失 | UI 状态不同步 | 抽取 composables 时使用 `computed` / `ref` 正确返回；浏览器冒烟验证 |
| 大文件拆分导致 import 循环 | 构建失败 | 共享逻辑抽到 `atomicCommandShared.ts`；禁止 capability 之间相互 import |
| 文档与代码失步 | 后续开发者迷路 | 同步更新 `docs/code-wiki.md` 与本文档；新增文件在 code-wiki 模块索引登记 |

---

## 8. 回归 case 清单

### 8.1 需新增或更新的 case 文件

| case / 测试文件 | 覆盖点 | 位置 |
|-----------------|--------|------|
| `schedulingAgentRuntime.capabilityRouting.test.ts` | 8 个子 capability 路由；`capability_route_conflict`；`FormalOrchestrationCapability` 路由 | `src/services/__tests__/` |
| `schedulingAgentRuntime.deadline.test.ts` | `AgentDeadline.signal()` 传入 LLM；abort 后 stage 停止；5s 后停止按钮可用 | `src/services/__tests__/` |
| `schedulingAgentRuntimeFacade.orchestration.test.ts` | `startFullGeneration` / `startPartialGeneration` / `cancel` 接口兼容老 Orchestrator | `src/services/__tests__/` |
| `moveCapability.test.ts` | move 首次执行、pending move 续跑、目标澄清 | `src/services/__tests__/` |
| `insertCapability.test.ts` | insert 首次执行、候选推荐、pending insert 续跑 | `src/services/__tests__/` |
| `replaceCapability.test.ts` | replace 首次执行、候选推荐、pending replace 续跑 | `src/services/__tests__/` |
| `deleteCapability.test.ts` | delete 首次执行、危险确认、pending delete 续跑 | `src/services/__tests__/` |
| `batchMoveCapability.test.ts` | batch move 范围选择、偏移、确认 | `src/services/__tests__/` |
| `batchDeleteCapability.test.ts` | batch delete 范围选择、危险确认 | `src/services/__tests__/` |
| `queryCapability.test.ts` | query 只读报告、候选查询 | `src/services/__tests__/` |
| `validateCapability.test.ts` | validate 校验报告 | `src/services/__tests__/` |
| `useBroadcastPlanWorkspace.test.ts` | create.vue 拆分后 workspace tab 逻辑 | `src/views/broadcast-plan/__tests__/` |
| `useBroadcastPlanTimelineScroll.test.ts` | 时间轴滚动逻辑 | `src/views/broadcast-plan/__tests__/` |

### 8.2 `editorDemandCoverageCases.ts` 更新

在 `src/services/__tests__/fixtures/editorDemandCoverageCases.ts` 中新增以下覆盖条目（category = `atomic_command` / `composite_task`）：

| id | userRequest | expectedDisposition | supportLevel | harness | coveredBy |
|----|-------------|---------------------|--------------|---------|-----------|
| `phase2_capability_routing_move` | "把新闻联播往后移10分钟" | 由 `MoveCapability` 处理，直接执行或进入 pending | supported | contract_test | `schedulingAgentRuntime.capabilityRouting.test.ts` |
| `phase2_capability_routing_insert_rotation` | "在轮播单插一档热播综艺" | 由 `InsertCapability` 处理，返回候选推荐 | guarded_supported | contract_test | `insertCapability.test.ts` |
| `phase2_capability_routing_delete_confirm` | "删掉 20:00 这个节目" | 由 `DeleteCapability` 处理，要求确认 | guarded_supported | contract_test | `deleteCapability.test.ts` |
| `phase2_capability_routing_batch_move` | "把上午所有广告整体后移30分钟" | 由 `BatchMoveCapability` 处理 | supported | contract_test | `batchMoveCapability.test.ts` |
| `phase2_capability_route_conflict` | "移动并替换 19:00 节目" | 多 capability 匹配，返回 `capability_route_conflict` | guarded_supported | contract_test | `schedulingAgentRuntime.capabilityRouting.test.ts` |
| `phase2_deadline_abort` | 长流程执行中用户点击停止 | `AgentDeadline.abort()` 触发，状态保留在最后 checkpoint | supported | foreground_browser | `schedulingAgentRuntime.deadline.test.ts` + browser goal38 |
| `phase2_use_orchestrator_migration` | 前台触发全天编排 | `useOrchestrator.ts` 调用 `SchedulingAgentRuntimeFacade` | supported | foreground_browser | `useBroadcastPlanOrchestration.test.ts` + browser goal37 |

每个 case 必须包含 `id / userRequest / expectedDisposition / supportLevel / harness / coveredBy / rootCauses / reverseInference` 字段，符合现有类型定义。

### 8.3 `package.json` `agent:check:tests` 更新

在 `agent:check:tests` 末尾追加：

```
src/services/__tests__/schedulingAgentRuntime.capabilityRouting.test.ts
src/services/__tests__/schedulingAgentRuntime.deadline.test.ts
src/services/__tests__/schedulingAgentRuntimeFacade.orchestration.test.ts
src/services/__tests__/moveCapability.test.ts
src/services/__tests__/insertCapability.test.ts
src/services/__tests__/replaceCapability.test.ts
src/services/__tests__/deleteCapability.test.ts
src/services/__tests__/batchMoveCapability.test.ts
src/services/__tests__/batchDeleteCapability.test.ts
src/services/__tests__/queryCapability.test.ts
src/services/__tests__/validateCapability.test.ts
src/views/broadcast-plan/__tests__/useBroadcastPlanWorkspace.test.ts
src/views/broadcast-plan/__tests__/useBroadcastPlanTimelineScroll.test.ts
```

---

## 9. 迁移计划与实施顺序

建议按以下顺序实施，每步完成后运行 `npm run agent:check`：

### 第 1 步：补齐回归 case（1 周）

1. 在 `editorDemandCoverageCases.ts` 新增 Phase 2 覆盖条目。
2. 创建 `schedulingAgentRuntime.capabilityRouting.test.ts` 骨架（先针对旧 `AtomicCommandCapability` 写 assertion，后续替换为新 capabilities）。
3. 创建 `schedulingAgentRuntime.deadline.test.ts` 骨架。
4. 运行 `npm run agent:check`，确保基线通过。

### 第 2 步：提取 `atomicCommandShared.ts`（0.5 周）

1. 从 `atomicCommandCapability.ts` 提取共享函数到 `src/services/agent/atomicCommandShared.ts`。
2. 保持 `AtomicCommandCapability` 行为不变，仅调整 import。
3. 运行 `schedulingAgentRuntime.move.test.ts` + `schedulingAgentRuntime.commandMatrix.test.ts` 验证。

### 第 3 步：按 intent 拆分子 capability（3 周）

1. 依次拆分 `moveCapability.ts` -> `insertCapability.ts` -> `replaceCapability.ts` -> `deleteCapability.ts` -> `batchMoveCapability.ts` -> `batchDeleteCapability.ts` -> `queryCapability.ts` -> `validateCapability.ts`。
2. 每个 capability 完成后再替换 `SchedulingAgentRuntime` 中的默认注册。
3. 每拆完一个 intent 运行 `agent:check` 中的相关测试。
4. 旧 `atomicCommandCapability.ts` 可先改为 re-export 兼容壳，或直接删除（视影响面）。

### 第 4 步：新增 `FormalOrchestrationCapability`（1 周）

1. 从 `demoRuntimeFacade.ts:910-1005` 提取 `executeReactAgentPlan` 相关逻辑到 `src/services/agent/formalOrchestrationCapability.ts`。
2. 在 `CapabilityRegistry` 注册。
3. 保持 `executeReactAgentPlan` 的伪 ReAct semantics 不变（阶段 3 再改）。
4. 运行 `demoRuntimeFacade.fullGenerateBootstrap.test.ts` + `orchestrator.test.ts`。

### 第 5 步：`useOrchestrator.ts` 迁移到 `SchedulingAgentRuntimeFacade`（1 周）

1. 在 `SchedulingAgentRuntimeFacade` 实现编排接口。
2. `useOrchestrator.ts` 改为调用 facade。
3. 老 `Orchestrator` 标记 `@deprecated`。
4. 运行 `orchestrator.test.ts` 与新增 `schedulingAgentRuntimeFacade.orchestration.test.ts`。

### 第 6 步：`demoRuntimeFacade.ts` 瘦身（1 周）

1. 迁出进度事件构建器到 `agentProgressEventBuilder.ts`。
2. 迁出 decision helper 工厂到 `runtimeDecisionHelpers.ts`。
3. 确认 `demoRuntimeFacade.ts` < 5000 行。
4. 运行全量 `agent:check`。

### 第 7 步：`create.vue` 拆分（1.5 周）

1. 抽取 `useBroadcastPlanWorkspace.ts`。
2. 抽取 `useBroadcastPlanTimelineScroll.ts`。
3. 抽取 `useBroadcastPlanBroadcastWindow.ts` 与 `useBroadcastPlanValidation.ts`。
4. 抽取 `broadcastPlanItemLabels.ts`。
5. 确认 `create.vue` < 2000 行。
6. 运行浏览器冒烟 + 相关单测。

### 第 8 步：最终验证与文档同步（0.5 周）

1. 更新 `docs/code-wiki.md` 文档索引与本规格。
2. 更新 `package.json` `agent:check:tests`。
3. 全量运行 `npm run agent:check`、`npm run build`、浏览器冒烟。
4. 输出最终报告。

---

## 10. 附录：关键文件路径索引

| 文件 | 路径 | 说明 |
|------|------|------|
| 老 Orchestrator | [src/services/orchestrator.ts](file:///./src/services/orchestrator.ts) | 阶段 2 标记废弃 |
| DemoRuntimeFacade | [src/services/runtime/demoRuntimeFacade.ts](file:///./src/services/runtime/demoRuntimeFacade.ts) | 阶段 2 瘦身 |
| SchedulingAgentRuntime | [src/services/agent/schedulingAgentRuntime.ts](file:///./src/services/agent/schedulingAgentRuntime.ts) | 统一 runtime 核心 |
| SchedulingAgentRuntimeFacade | [src/services/runtime/schedulingAgentRuntimeFacade.ts](file:///./src/services/runtime/schedulingAgentRuntimeFacade.ts) | 前台编排 facade |
| CapabilityRegistry | [src/services/agent/capabilityRegistry.ts](file:///./src/services/agent/capabilityRegistry.ts) | 唯一分发 |
| AtomicCommandCapability | [src/services/agent/atomicCommandCapability.ts](file:///./src/services/agent/atomicCommandCapability.ts) | 拆分源文件 |
| useOrchestrator | [src/composables/useOrchestrator.ts](file:///./src/composables/useOrchestrator.ts) | 改为调用 facade |
| create.vue | [src/views/broadcast-plan/create.vue](file:///./src/views/broadcast-plan/create.vue) | 拆分源文件 |
| AgentDeadline | [src/services/agent/agentDeadline.ts](file:///./src/services/agent/agentDeadline.ts) | deadline 管理 |
| editorDemandCoverageCases | [src/services/__tests__/fixtures/editorDemandCoverageCases.ts](file:///./src/services/__tests__/fixtures/editorDemandCoverageCases.ts) | 覆盖矩阵 case |

