# 对话区多气泡流式反馈 — 技术方案评估

> 评估人：solution-architect
> 评估日期：2026-06-27
> 状态：待用户确认
> 关联规范：`AGENTS.md`（LLM-first / LLM-only 主路径，本地逻辑只能保护结果不能改写意图）

---

## 1. 需求复述

用户在浏览器对话区输入"在10点插入看东方"后，当前只看到一条最终聚合消息，希望改成至少 3 条气泡：

| # | 语义阶段 | 期望文案 |
|---|---------|---------|
| 1 | 理解需求 | "我理解你想在10点插入《看东方》" |
| 2 | 查节目库 | "已查到 4 个候选期次" |
| 3 | 候选决策 + 执行结果 | "已选择第111期并写入播单" |

## 2. 现状诊断（已通过代码探查确认）

### 2.1 已有的多气泡基础设施

| 层 | 文件 | 已有能力 |
|----|------|---------|
| 后端 progress 事件生成 | `src/services/runtime/demoRuntimeFacade.ts` | `buildAgentTraceProgressEvent`（L5031）+ `buildAgentPlannerProgressEvent`（L666） |
| Trace 步骤订阅 | `src/services/runtime/demoRuntimeFacade.ts:4990` | `onTraceStep: (step) => this.handleAgentTraceProgress(input, step)` 把 AgentTraceStep 转成 progress 事件 |
| 前端多气泡渲染 | `src/components/dialogue/ChatPanel.vue:1851` | `handleRuntimeProgress` 收到 progress 事件即 `messages.value.push(buildAssistantMessage(...))`，已支持 thinking/details/stepMetric、按 `event.id` 去重 |
| Local 模式 | `src/services/runtime/agentRuntimeClient.ts:80-98` | `LocalAgentRuntimeClient.submitInstruction` 直接传递 input（含 `onProgress`）给底层 runtime，多气泡**已经工作** |

### 2.2 现有 progress 事件清单（与 3 条气泡的对应关系）

| 现有 trace 步骤 | 当前 progress 文案 | 对应用户期望气泡 |
|----------------|------------------|-----------------|
| `Agent intent interpreter 返回结构化意图`（L5033） | `assistantFeedback \|\| reasoning`（LLM 产出） | 气泡 1 ✓ 已有 |
| `调用节目查询服务查找候选`（L5052） | "正在按 XX 查节目库" — **"开始查询"语义，不含候选数** | 气泡 2 ✗ 语义不匹配 |
| `LLM 候选决策完成`（L5104） | "在 N 个候选中选择「XX」" — 合并了"查到 + 决策" | 气泡 3 部分覆盖 |
| final decision `feedback.content`（applyRuntimeDecision） | LLM 产出的最终结果描述 | 气泡 3 ✓ 已有 |

### 2.3 HTTP 模式根因（用户当前使用模式）

**链路断点 1：HTTP 客户端剥离 onProgress**

`src/services/runtime/agentRuntimeClient.ts:106-120`
```typescript
async submitInstruction(input: RuntimeSubmitInput): Promise<RuntimeDecision> {
  await this.ensureServerLlmConfig()
  const {
    foregroundContextPackage: _foregroundContextPackage,
    onProgress: _onProgress,   // ← 被剥离丢弃
    ...serverInput
  } = input
  const envelope = await this.post<RuntimeEnvelope<RuntimeDecision>>('/api/agent/submit', {
    sessionId: this.sessionId,
    input: serverInput,         // ← 不含 onProgress
  })
  ...
}
```

**链路断点 2：Server runtime 不注入 onProgress**

`src/services/runtime/agentServerRuntime.ts:219-225` 调用底层 runtime 时，input 里没有 `onProgress`：
```typescript
const decision = await this.runtime.submitInstruction({
  ...input,                     // input 来自 HTTP body，无 onProgress
  pendingAtomicContext,
  activeReactTaskRun,
  foregroundContextPackage: contextPackage,
  agentCoreEnabled: input.agentCoreEnabled ?? true,
})
```
因此底层 runtime 的 `input.onProgress?.(event)` 是 no-op。

**链路断点 3：session events 无 progress 类型**

`src/services/runtime/agentServerSessionStore.ts:55`
```typescript
type: 'session' | 'context' | 'decision' | 'pending' | 'react_task'
     | 'execution' | 'formal_write' | 'material_evidence'
     | 'task_progress' | 'execution_checkpoint' | 'error'
```
没有 `progress` 类型，SSE 端点 `/api/agent/sessions/:sessionId/events?follow=1` 不会推送 progress 事件。

**链路断点 4：前端未订阅 SSE**

`src/components/dialogue/ChatPanel.vue` 全文搜索无 `EventSource` 或 `/events` 订阅。前端只通过 `submitInstruction` 的同步返回拿结果。

### 2.4 SSE 后端基础设施（已具备）

`scripts/agent-server.mjs:131-157` `writeSse` 已支持 `follow` 模式：
- 写入历史 events → 发送 `ready` → 通过 `runtime.subscribeSessionEvents(sessionId, callback)` 持续推送
- 15s 心跳、`request.on('close')` 自动清理订阅
- `buildHeaders`（L99-104）已配置 `access-control-allow-origin: request.headers.origin || '*'`，CORS 通畅

---

## 3. 两条实现路径评估

### 路径 A：SSE 流式订阅（实时）

**改动点**：
1. `agentServerSessionStore.ts`：`AgentServerSessionEvent.type` 增加 `'progress'`
2. `agentServerRuntime.ts` `submitInstruction`：注入 `onProgress` 回调，把 `RuntimeProgressEvent` 转成 `appendEvent({ type: 'progress', ... })`
3. `agentRuntimeClient.ts` `HttpAgentRuntimeClient`：新增 `EventSource` 订阅 `/api/agent/sessions/:sessionId/events?follow=1`，收到 `progress` 事件调用 `input.onProgress`
4. `ChatPanel.vue`：管理 SSE 连接生命周期（开启 / 错误重连 / 取消）

**优势**：
- 真正实时反馈，与 Local 模式体验完全一致
- 复用现有 SSE 端点，后端改动小（只新增 event type）
- 未来长流程（补空窗、全天编排）也能复用

**风险**：
- 前端需引入 EventSource 生命周期管理，断线重连、跨标签页、session 失效等边界复杂
- 同一 sessionId 多次 submitInstruction 时订阅去重
- EventSource 在某些浏览器代理下可能被缓冲，需确认 `text/event-stream` 不被中间层缓冲
- 改动量大，触及前端会话管理逻辑

### 路径 B：响应体内嵌 progress 数组（事后回放）

**改动点**：
1. `agentServerRuntime.ts`：
   - `AgentServerRuntimeEnvelope<T>` 接口加 `progressEvents?: RuntimeProgressEvent[]`
   - `submitInstruction` 注入 `onProgress` 回调收集事件到数组，写入 envelope
2. `agentRuntimeClient.ts`：
   - `RuntimeEnvelope` 类型加 `progressEvents?: RuntimeProgressEvent[]`
   - `HttpAgentRuntimeClient.submitInstruction`：保留 `onProgress`（不再剥离），收到 envelope 后**按顺序批量回放** `progressEvents` 给 `input.onProgress`，再返回 decision
3. `scripts/agent-server.mjs`：`/api/agent/submit` 直接透传 `envelope.progressEvents`（已经是 `json()` 序列化，无需额外处理）

**优势**：
- 改动最小，仅 3 个文件，不引入新连接
- 与 Local 模式语义一致（都是"事后回放"），前端 `handleRuntimeProgress` 不变
- 不需要前端 SSE 生命周期管理
- 与现有同步 POST 架构兼容，不破坏现有 session events 体系

**风险**：
- 不实时：用户看到 3 条气泡是在 POST 返回后批量出现，而不是逐步出现
- 但实际底层 runtime 执行通常 2-5 秒，批量回放仍能展示"分阶段"语义，符合用户期望

### 路径选择建议

**推荐路径 B**，理由：

1. **改动量最小**：只动 3 个文件，不引入 SSE 前端逻辑
2. **风险最低**：不引入新连接、不触及会话订阅生命周期、不破坏现有同步 POST
3. **符合 AGENTS.md "最小实现改动"原则**：先追踪现有流程，再做最小改动
4. **与 Local 模式行为一致**：Local 模式也是 `onProgress` 同步回调，HTTP 模式只是把回调"打包传输"再"按序回放"
5. **可演进**：未来若需实时反馈，可再升级到路径 A，envelope 内嵌数组可作为 fallback

**路径 A 留作后续演进**：当补空窗、全天编排等长流程接入时，再启用 SSE 流式。

---

## 4. 第 2 条气泡的语义补齐（必做）

### 4.1 问题

用户期望气泡 2 是"已查到 4 个候选期次"，但当前：
- `调用节目查询服务查找候选` trace 是"开始查询"语义，不含候选数
- `LLM 候选决策完成` trace 含 `candidateCount`，但合并了"查到 + 选择"

### 4.2 改动方案

**新增 trace 步骤 `候选查询完成`**，在候选查询返回后、LLM 决策前记录：

`src/services/agent/atomicCommandCapability.ts`（在 L4599 `LLM 候选决策完成` record 之前）：
```typescript
runtime.trace.record('planning', '候选查询完成', {
  intent: commandIntent,
  candidateCount: judgeCandidates.length,
  searchKeywords: effectiveKeywords,
  targetTime,
  noMutation: true,
})
```

`src/services/runtime/demoRuntimeFacade.ts` `buildAgentTraceProgressEvent` 新增分支（L5073 之后）：
```typescript
if (step.status === 'planning' && step.label === '候选查询完成') {
  const candidateCount = typeof detail.candidateCount === 'number' ? detail.candidateCount : 0
  if (candidateCount === 0) return null  // 0 候选走拒绝流程，不展示
  const keyword = typeof detail.keyword === 'string' ? detail.keyword.trim() : ''
  const keywordText = keyword ? `《${keyword}》` : '当前线索'
  return {
    id: `agent-trace:${input.scheduleState.playlistId ?? input.scheduleState.playlistType}:candidate-found:${step.sequence}`,
    content: `已查到 ${candidateCount} 个候选期次。`,
    processType: 'selection',
    processTypeLabel: '查节目库',
    details: {
      progressStage: 'candidate_found',
      candidateCount,
      keyword,
      noMutation: true,
    },
  }
}
```

**调整 `LLM 候选决策完成` 文案**（L5114-5123），不再重复 candidateCount，聚焦"决策"：
```typescript
if (decisionType === 'auto_select' && selectedName) {
  decisionText = `已选择「${selectedName}」`
} else if (decisionType === 'needs_clarification') {
  decisionText = `需要你确认具体排哪一个`
} else if (decisionType === 'unable_to_decide') {
  decisionText = `暂时无法给出有把握的选择`
} else {
  decisionText = `候选已就绪`
}
```

### 4.3 三条气泡的最终落点

| 气泡 | 来源 | 文案示例 | LLM-only 合规性 |
|------|------|---------|----------------|
| 1 理解需求 | `Agent intent interpreter 返回结构化意图` trace（已有，LLM `assistantFeedback`） | "我理解你想在10点插入《看东方》" | LLM 产出 ✓ |
| 2 查节目库 | `候选查询完成` trace（**新增**，本地组装 candidateCount） | "已查到 4 个候选期次" | 结果展示层 ✓ |
| 3 决策+执行 | `LLM 候选决策完成` trace（LLM 决策理由）+ final decision feedback（LLM 最终解释） | "已选择「看东方 第111期」" + 写入播单 | LLM 产出 + 事实结果 ✓ |

**注意**：第 3 条气泡由两个来源叠加：
- `LLM 候选决策完成` progress 事件推一条"已选择..."
- final decision 的 `feedback.content` 通过 `applyRuntimeDecision` 再推一条最终结果

如果用户觉得"已选择"和"已写入播单"应该是同一条，可在后续优化中合并；当前先保留两条以保留语义完整性。

---

## 5. 改动点清单

### 5.1 后端

| 文件 | 函数 / 位置 | 改法 |
|------|------------|------|
| `src/services/runtime/agentServerRuntime.ts` | `AgentServerRuntimeEnvelope<T>` 接口（L61-67） | 加 `progressEvents?: RuntimeProgressEvent[]` |
| `src/services/runtime/agentServerRuntime.ts` | `submitInstruction`（L173-235） | 在调用 `this.runtime.submitInstruction` 前，注入 `onProgress: (event) => collected.push(event)`；返回 envelope 时带 `progressEvents: collected` |
| `src/services/runtime/agentServerRuntime.ts` | 顶部 import | 加 `type RuntimeProgressEvent`（从 `./schedulingAgentRuntimeFacade`） |

### 5.2 前端 HTTP 客户端

| 文件 | 函数 / 位置 | 改法 |
|------|------------|------|
| `src/services/runtime/agentRuntimeClient.ts` | `RuntimeEnvelope<T>` 类型（L45-49） | 加 `progressEvents?: RuntimeProgressEvent[]` |
| `src/services/runtime/agentRuntimeClient.ts` | `HttpAgentRuntimeClient.submitInstruction`（L106-120） | 1. 保留 `onProgress` 不剥离<br>2. 收到 envelope 后，`for (const event of envelope.progressEvents ?? []) input.onProgress?.(event)`<br>3. 再 `return envelope.decision` |

### 5.3 Progress 事件语义补齐

| 文件 | 函数 / 位置 | 改法 |
|------|------------|------|
| `src/services/agent/atomicCommandCapability.ts` | 候选查询完成后、`LLM 候选决策完成` record 之前（L4599 附近） | 新增 `runtime.trace.record('planning', '候选查询完成', {...})`，记录 `candidateCount`、`keyword`、`targetTime` |
| `src/services/runtime/demoRuntimeFacade.ts` | `buildAgentTraceProgressEvent`（L5031-5146） | 1. 新增 `候选查询完成` 分支：文案 `已查到 N 个候选期次`<br>2. 调整 `LLM 候选决策完成` 分支文案：去掉 candidateCount 重复，聚焦决策 |

### 5.4 不需要改动

| 文件 | 原因 |
|------|------|
| `scripts/agent-server.mjs` | `/api/agent/submit` 已用 `json()` 透传整个 envelope，新增字段自动序列化 |
| `src/components/dialogue/ChatPanel.vue` | `handleRuntimeProgress` 已支持多气泡、按 `event.id` 去重，无需改动 |
| `src/services/runtime/agentServerSessionStore.ts` | 路径 B 不把 progress 记入 session events，无需改 |
| `src/services/runtime/schedulingAgentRuntimeFacade.ts` | 只是 `DemoRuntimeFacade` 的别名导出，无需改 |

---

## 6. 风险评估

### 6.1 与 AGENTS.md 合规性

| 风险点 | 评估 | 缓解 |
|--------|------|------|
| LLM-first 原则 | 气泡 1 内容来自 LLM `assistantFeedback`，不本地改写 ✓ | 无 |
| 本地硬编码边界 | 气泡 2 文案"已查到 N 个候选期次"是结果展示层（N 是查询事实），允许本地组装 ✓ | 不在文案中加入 LLM 没说的判断 |
| 候选决策理由 | 气泡 3 决策部分来自 LLM `reasoning`，不本地补理由 ✓ | 无 |
| 不为凑气泡强行拆分 | 每条气泡有独立语义（理解 / 查询结果 / 决策+执行）✓ | 0 候选时不推气泡 2，走拒绝流程 |

### 6.2 行为一致性

| 模式 | 改动后行为 |
|------|-----------|
| Local 模式 | 不受影响，progress 事件实时推送（onProgress 同步回调） |
| HTTP 模式 | progress 事件在 POST 返回后批量回放，顺序与 Local 一致（按 `collected.push` 顺序） |

### 6.3 顺序保证

- 后端 `collected` 数组按 `onProgress` 调用顺序 push，顺序即 trace 步骤发生顺序
- 前端回放按数组顺序 `for ... of`，同步调用 `input.onProgress`
- 前端 `handleRuntimeProgress` 按 `event.id` 去重，避免重复气泡

### 6.4 与"思考中"chip 的交互

- `stepProgress.keepRunningAtBottom()`（L1872）已在每次 progress 后调用，chip 会跟随气泡下沉
- 批量回放时 chip 会连续下沉，体验与 Local 模式一致

### 6.5 残余风险

| 风险 | 等级 | 说明 |
|------|------|------|
| 批量回放非实时 | 中 | 用户在 POST 等待期间（2-5 秒）只看到"思考中"chip，返回后才看到 3 条气泡。可接受，未来升级 SSE |
| progressEvents 体积 | 低 | 单次 submit 通常 3-5 条 progress，每条 < 1KB，envelope 总体积增加可忽略 |
| 前端去重逻辑依赖 event.id | 低 | 现有 `runtimeProgressKeys` 已按 `event.id` 去重，progressEvents 回放不会产生重复 |

---

## 7. 验证方式

### 7.1 单元测试（Vitest）

| 测试文件 | 新增/修改 case |
|---------|---------------|
| `src/services/__tests__/schedulingAgentRuntime.candidateDecision.test.ts` | 验证 `候选查询完成` trace 触发 progress 事件，文案含 candidateCount |
| `src/services/__tests__/demoRuntimeFacade.agentPlanner.test.ts` | 验证 3 条 progress 事件按序生成 |
| 新增 `src/services/__tests__/agentServerRuntime.progressEvents.test.ts` | 验证 HTTP 模式下 envelope.progressEvents 收集与回放 |

### 7.2 Agent 编排链路

```bash
npm run agent:check
```

### 7.3 构建

```bash
npm run build
```

### 7.4 浏览器冒烟（HTTP 模式）

1. 启动 agent server：`npm run agent:server`（或现有启动命令）
2. 启动前端：`npm run dev`，设置 `VITE_AGENT_RUNTIME_MODE=http`
3. 打开 `http://localhost:5173`
4. 新建电视播单，输入"在10点插入看东方"
5. 观察对话区：
   - 气泡 1："我理解你想在10点插入《看东方》"（LLM assistantFeedback）
   - 气泡 2："已查到 N 个候选期次"
   - 气泡 3："已选择「看东方 第X期」" + final decision 写入结果
6. 验证 Local 模式（`VITE_AGENT_RUNTIME_MODE=local`）行为一致

---

## 8. 实施顺序建议

1. **Step 1**：后端 `agentServerRuntime.ts` 注入 onProgress 收集 progressEvents，写入 envelope
2. **Step 2**：前端 `agentRuntimeClient.ts` 保留 onProgress，回放 envelope.progressEvents
3. **Step 3**：`atomicCommandCapability.ts` 新增 `候选查询完成` trace
4. **Step 4**：`demoRuntimeFacade.ts` 新增 `候选查询完成` progress 分支，调整 `LLM 候选决策完成` 文案
5. **Step 5**：跑 vitest + agent:check + build
6. **Step 6**：浏览器冒烟验证

---

## 9. 待用户确认事项

1. **路径选择**：确认采用路径 B（响应体内嵌 progress 数组），还是路径 A（SSE 流式）？
2. **第 3 条气泡**：是否接受"已选择「XX」"（progress）和"已写入播单"（final decision）分两条气泡？还是希望合并为一条？
3. **气泡 2 的 0 候选场景**：0 候选时不推气泡 2，直接走拒绝流程，是否符合预期？
4. **文案细节**：气泡 2 文案是"已查到 4 个候选期次"还是"已查到 4 个候选节目"？用户原话用"期次"，但代码里用"候选"。
5. **Local 模式行为**：本次改动不应影响 Local 模式已有行为，是否需要为 Local 模式单独回归测试？

---

## 10. 附：关键代码引用

### 10.1 现有 progress 事件生成入口

`src/services/runtime/demoRuntimeFacade.ts:4990`
```typescript
onTraceStep: (step) => this.handleAgentTraceProgress(input, step),
```

### 10.2 现有 progress 事件分发

`src/services/runtime/demoRuntimeFacade.ts:5021-5029`
```typescript
private handleAgentTraceProgress(input: RuntimeSubmitInput, step: AgentTraceStep): void {
  const event = this.buildAgentTraceProgressEvent(input, step)
  if (!event) return
  try {
    input.onProgress?.(event)
  } catch {
    // Progress messages are explanatory only and must not block execution.
  }
}
```

### 10.3 前端多气泡渲染（已支持，无需改动）

`src/components/dialogue/ChatPanel.vue:1851-1874`
```typescript
const handleRuntimeProgress = (event: RuntimeProgressEvent) => {
  const progressContent = event.content.trim()
  if (!progressContent) return
  const progressKey = event.id || `${event.processTypeLabel}:${progressContent}`
  if (runtimeProgressKeys.has(progressKey)) return
  runtimeProgressKeys.add(progressKey)
  messages.value.push(buildAssistantMessage({...}))
  stepProgress.keepRunningAtBottom()
  void scrollToBottom()
}
```

### 10.4 SSE 端点（路径 A 备用，路径 B 不用）

`scripts/agent-server.mjs:337-345`
```javascript
const eventsMatch = url.pathname.match(/^\/api\/agent\/sessions\/([^/]+)\/events$/)
if (request.method === 'GET' && eventsMatch) {
  const sessionId = eventsMatch[1]
  writeSse(request, response, runtime.getSessionEvents(sessionId), {
    follow: url.searchParams.get('follow') === '1' || url.searchParams.get('follow') === 'true',
    sessionId,
  })
  return
}
```
