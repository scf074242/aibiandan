# 对话区气泡流式实时推送（SSE 升级）技术方案

> 角色：solution-architect
> 状态：待用户确认（确认后由实施 agent 落地，再由 code-review-expert 复检并直接修复，不需用户介入代码评审）
> 范围：把"HTTP 模式进度事件回放"（路径 B）升级为"SSE 实时流式推送"（路径 A），并保留路径 B 作为降级 fallback
> 语言：中文

---

## 1. 问题与期望

### 1.1 用户原话
> "为什么是一口气吐出来4条信息？让你分信息的目的就是让用户看到过程"

### 1.2 行为缺口（问题）
当前 HTTP 模式（`VITE_AGENT_RUNTIME_MODE=http`）下，前端 `HttpAgentRuntimeClient.submitInstruction` 的链路是：

1. 前端把 `onProgress` 从 `input` 中解构出来，**不带任何回调**地 POST `/api/agent/submit`；
2. 后端 `AgentServerRuntime.submitInstruction` 用本地数组 `collectedProgressEvents.push(event)` 收集 4 条 progress（理解需求 / 查节目库 / 候选决策 / 写入播单），但这些事件**没有记入 session eventLog**，SSE 端点推不出去；
3. POST 返回 envelope 后，前端才一次性 `for (const event of envelope.progressEvents) onProgress(event)` 批量回放——视觉上就是"4 条气泡同时蹦出来"。

### 1.3 期望（可观察、可验证）
- HTTP 模式下，agent 执行过程中每完成一个阶段（理解需求 / 查节目库 / 候选决策 / 写入播单），前端对话区**立即**追加一条气泡，间隔肉眼可观察（数百毫秒到数秒）。
- Local 模式行为不变（继续走同步 `onProgress` 回调）。
- 路径 B 的 `progressEvents` 数组保留作为 SSE 不可用时的降级 fallback。
- 不重复推气泡、不丢气泡、不乱序。
- 不改写 LLM 主路径输出，progress 事件只用于过程展示。

### 1.4 前置数据 / 上下文状态
- 已实现的 SSE 基础设施：`scripts/agent-server.mjs` L99-104（CORS）、L126-157（`writeSse` + follow 订阅 + 15s 心跳 + `request.on('close')` 清理）、L337-345（`GET /api/agent/sessions/:sessionId/events?follow=1` 端点）。
- 已实现的路径 B 残留：
  - `agentServerRuntime.ts` L62-74 envelope 字段、L226-234 收集逻辑、L238-244 返回。
  - `agentRuntimeClient.ts` L45-54 envelope 类型、L111-135 回放逻辑。
- 已实现的 progress 事件源：`demoRuntimeFacade.ts` L90-97 `RuntimeProgressEvent` 类型、L5060-5160 各阶段事件分支（含"候选查询完成"分支）。
- 已有 sessionStorage 持久化：`HTTP_SESSION_STORAGE_KEY = 'aibiandan_agent_session_id'`，`HttpAgentRuntimeClient` 已能在多次调用间复用 sessionId。

---

## 2. 关键断点（代码探查结论）

| # | 文件 | 行号 | 现状 | 是否需改 |
|---|------|------|------|----------|
| 1 | `src/services/runtime/agentServerSessionStore.ts` | L53-59 | `AgentServerSessionEvent.type` 联合类型未包含 `'progress'`，progress 事件无法记入 eventLog | **是** |
| 2 | `src/services/runtime/agentServerRuntime.ts` | L226-234 | `onProgress` 只 push 本地数组，未调用 `this.sessions.appendEvent` | **是** |
| 3 | `src/services/runtime/agentRuntimeClient.ts` | L111-135 | `submitInstruction` 无 `EventSource` 订阅，只在 envelope 返回后批量回放 | **是** |
| 4 | `src/components/dialogue/ChatPanel.vue` | L1851-1874, L1969-1985 | `handleRuntimeProgress` 渲染逻辑、`onProgress` 透传链路 | **否**（透传链路不变，渲染逻辑复用） |
| 5 | `scripts/agent-server.mjs` | L131-157, L337-345 | SSE 端点已完整，CORS 已配，follow 订阅 + 心跳 + 清理已就绪 | **否** |
| 6 | `src/services/runtime/agentServerSessionStore.ts` | L123-141 | `appendEvent` 通用，加新 type 不破坏持久化（`AgentServerFileSessionStore` 不严格校验 type 字符串） | **否** |

---

## 3. 时序设计（核心，决定不丢事件 / 不重复 / 不乱序）

### 3.1 现有 SSE 端点的关键特性（来自 `writeSse` L131-157）
1. 先同步写出**全部历史 eventLog**（L137-139）；
2. 再写 `event: ready`（L140-141），作为"历史已发完，接下来是 live"的分界标记；
3. 之后 `subscribeSessionEvents` 订阅新事件（L146-148）；
4. 15s 心跳；`request.on('close')` 自动取消订阅（L153-156）。

### 3.2 三种时序方案对比

| 方案 | 流程 | 风险 |
|------|------|------|
| ❌ A. 先 POST 再开 SSE | POST 返回后开 SSE | 所有 progress 已在 eventLog 里，SSE 把它们当"历史"一次性吐出 → 回到"4 条一起蹦"的老问题 |
| ⚠️ B. POST 后开 SSE 且 follow=0 | 拿历史就走 | 同上，且仍是批量 |
| ✅ C. **先开 SSE → 等 `ready` → 再 POST** | 见下方时序图 | 历史事件在 `ready` 之前到达可被前端忽略；`ready` 之后的事件即 live progress |

### 3.3 选定方案 C 时序图

```
前端                                      后端 agent-server.mjs            AgentServerRuntime / SessionStore
 |                                          |                                |
 |--GET /events?follow=1------------------>|                                |
 |                                          | writeSse: 写历史 events        |
 |<--event: progress(历史, 忽略)------------|                                |
 |<--event: context(历史, 忽略)-------------|                                |
 |<--event: ready--------------------------|                                |
 |                                          | subscribeSessionEvents 订阅 --|
 | (收到 ready, 立即发起 POST)              |                                |
 |--POST /api/agent/submit---------------->|                                |
 |                                          |--submitInstruction----------->|
 |                                          |                                | runtime.submitInstruction 开始
 |                                          |                                | onProgress(理解需求)
 |                                          |                                |   appendEvent({type:'progress',...})
 |                                          |                                |   -> listeners 触发
 |<--event: progress(理解需求)-------------|<--writeSseEvent---------------|   |
 | (handleRuntimeProgress 推气泡 1)         |                                |   |
 |                                          |                                | onProgress(查节目库)
 |                                          |                                |   appendEvent(...)
 |<--event: progress(查节目库)-------------|<--writeSseEvent---------------|   |
 | (推气泡 2)                               |                                |   |
 |                                          |                                | onProgress(候选决策)
 |<--event: progress(候选决策)-------------|<--writeSseEvent---------------|   |
 | (推气泡 3)                               |                                |   |
 |                                          |                                | onProgress(写入播单)
 |<--event: progress(写入播单)-------------|<--writeSseEvent---------------|   |
 | (推气泡 4)                               |                                |   |
 |                                          |                                | submitInstruction 返回 decision
 |                                          |<--envelope {decision,...}-----|
 |<--200 {decision,...}--------------------|                                |
 | (EventSource.close())                    |                                |
 | (applyRuntimeDecision)                   |                                |
```

### 3.4 不丢事件保证
- 前端**等待 `ready` 才发 POST**：保证订阅已建立且后端 listener 已注册。
- 后端 `appendEvent` 是同步操作，调用 `runtime.submitInstruction` 内部第一个 `onProgress` 触发时，listener 已在线（POST 是 `ready` 之后才发的，比 `submitInstruction` 内部任何 `onProgress` 都早）。
- 后端 `appendEvent` 同步通知 listeners（L139），`writeSseEvent` 同步写 response 流，不存在事件丢失窗口。

### 3.5 不重复保证
- envelope 仍带 `progressEvents` 数组（路径 B 保留作为降级 fallback）。
- 前端维护 `deliveredProgressIds: Set<string>`，SSE 收到一条就记下 `event.id`。
- POST 返回后，envelope 内 `progressEvents` **只回放尚未通过 SSE 送达的**（按 `event.id` 去重；无 id 的用 `processTypeLabel + content` 做 fallback key）。
- 若 SSE 全程未建立成功，集合为空，envelope 内全部事件按序回放——自动回退到路径 B 行为。

### 3.6 不乱序保证
- SSE 是单连接顺序推送，浏览器 EventSource 按到达顺序触发 listener。
- envelope 内 `progressEvents` 数组本身按后端 push 顺序排列，去重回放时保持原顺序。
- 极端情况：SSE 事件晚于 POST 返回到达（网络抖动）——此时 envelope 回放已先推送剩余事件，后到的 SSE 事件因 id 已在集合内被忽略，**不会乱序、不会重复**。

---

## 4. 改动点清单（文件 + 函数 + 行号 + 改法）

### 4.1 `src/services/runtime/agentServerSessionStore.ts`
**L53-59 `AgentServerSessionEvent.type` 联合类型**

改法：在联合中加入 `'progress'`。

```typescript
export interface AgentServerSessionEvent {
  id: string
  type: 'session' | 'context' | 'decision' | 'pending' | 'react_task'
      | 'execution' | 'formal_write' | 'material_evidence'
      | 'task_progress' | 'execution_checkpoint' | 'error'
      | 'progress'   // 新增：用于实时推送 RuntimeProgressEvent
  summary: string
  createdAt: string
  data?: Record<string, unknown>
}
```

**风险**：`appendEvent` 通用、`eventLog.slice(-100)` 通用、`AgentServerFileSessionStore` 持久化不严格校验 type 字符串，加新 type 不破坏既有数据。schemaVersion 仍为 2，无需迁移。

### 4.2 `src/services/runtime/agentServerRuntime.ts`
**L226-234 `submitInstruction` 的 `onProgress` 回调**

改法：`onProgress` 同时做两件事——push 本地数组（保留路径 B 降级）+ 调用 `this.sessions.appendEvent`（用于 SSE 推送）。

```typescript
const collectedProgressEvents: RuntimeProgressEvent[] = []
const decision = await this.runtime.submitInstruction({
  ...input,
  pendingAtomicContext,
  activeReactTaskRun,
  foregroundContextPackage: contextPackage,
  agentCoreEnabled: input.agentCoreEnabled ?? true,
  onProgress: (event) => {
    collectedProgressEvents.push(event)  // 路径 B 降级保留
    // 新增：把 progress 事件记入 session eventLog，触发 SSE 订阅者推送
    this.sessions.appendEvent(session.id, {
      type: 'progress',
      summary: event.content,
      data: {
        progressId: event.id,
        content: event.content,
        thinking: event.thinking,
        processType: event.processType,
        processTypeLabel: event.processTypeLabel,
        details: event.details,
      },
    })
  },
})
```

**注意**：`eventLog.slice(-100)` 限制每个 session 最多 100 条事件，progress 事件占位但不会无限增长；session 既有事件类型足够稀疏，单轮 4 条 progress 不会挤掉关键历史事件。

### 4.3 `src/services/runtime/agentRuntimeClient.ts`
**`HttpAgentRuntimeClient` 类，新增 SSE 生命周期管理**

在类中新增私有字段和私有方法，修改 `submitInstruction`。

新增字段（约 L106-109 区域）：
```typescript
private sessionId: string | null = this.readStoredSessionId()
private llmConfigBridge: Promise<void> | null = null
private activeSse: { source: EventSource; deliveredIds: Set<string> } | null = null
```

新增私有方法 `openProgressStream`（在 `submitInstruction` 之前调用）：

```typescript
/**
 * 打开 SSE 订阅，实时接收后端 progress 事件并回调 onProgress。
 * 仅在浏览器环境且 baseUrl 为 http(s) 时启用；返回是否成功建立。
 * 失败时调用方应回退到路径 B 的 envelope.progressEvents 数组回放。
 */
private openProgressStream(
  sessionId: string,
  onProgress: (event: RuntimeProgressEvent) => void,
): boolean {
  if (typeof window === 'undefined' || typeof EventSource === 'undefined') return false
  // 关闭可能残留的上一轮订阅，避免重复推送
  this.closeProgressStream()
  const url = `${this.baseUrl}/api/agent/sessions/${encodeURIComponent(sessionId)}/events?follow=1`
  const source = new EventSource(url)
  const deliveredIds = new Set<string>()
  let ready = false
  // 历史事件阶段（ready 之前）全部忽略，避免重复推送上一轮 progress
  source.addEventListener('progress', (raw) => {
    if (!ready) return
    const payload = safeParseProgressEvent(raw.data)
    if (!payload) return
    const dedupeKey = payload.id || `${payload.processTypeLabel}:${payload.content}`
    if (deliveredIds.has(dedupeKey)) return
    deliveredIds.add(dedupeKey)
    try { onProgress(payload) } catch { /* 进度事件不能阻塞主流程 */ }
  })
  source.addEventListener('ready', () => { ready = true })
  source.onerror = () => { /* EventSource 会自动重连；不主动 close，让超时机制兜底 */ }
  this.activeSse = { source, deliveredIds }
  return true
}

/**
 * 关闭 SSE 订阅并释放资源。POST 返回后或超时后调用。
 */
private closeProgressStream(): void {
  if (!this.activeSse) return
  this.activeSse.source.close()
  this.activeSse = null
}
```

新增私有方法 `awaitProgressStreamReady`（等待 `ready` 事件，带超时）：

```typescript
/**
 * 等待 SSE 连接就绪（收到 ready 事件），超时则降级到路径 B。
 * 超时阈值 1500ms：后端本地响应极快，1.5s 足以覆盖跨域握手。
 */
private awaitProgressStreamReady(timeoutMs = 1500): Promise<boolean> {
  if (!this.activeSse) return Promise.resolve(false)
  return new Promise((resolve) => {
    const source = this.activeSse!.source
    let settled = false
    const onReady = () => {
      if (settled) return
      settled = true
      cleanup()
      resolve(true)
    }
    const onTimeout = () => {
      if (settled) return
      settled = true
      cleanup()
      resolve(false)
    }
    const cleanup = () => {
      source.removeEventListener('ready', onReady)
      clearTimeout(timer)
    }
    source.addEventListener('ready', onReady)
    const timer = setTimeout(onTimeout, timeoutMs)
  })
}
```

修改 `submitInstruction`（L111-135）：

```typescript
async submitInstruction(input: RuntimeSubmitInput): Promise<RuntimeDecision> {
  await this.ensureServerLlmConfig()
  const {
    foregroundContextPackage: _foregroundContextPackage,
    onProgress,
    ...serverInput
  } = input

  // 先确保有 sessionId（无则建一个），用于 SSE 订阅
  const sessionId = await this.ensureServerSessionId()
  let sseReady = false
  if (onProgress && sessionId) {
    sseReady = this.openProgressStream(sessionId, onProgress)
    if (sseReady) sseReady = await this.awaitProgressStreamReady()
  }

  const envelope = await this.post<RuntimeEnvelope<RuntimeDecision>>('/api/agent/submit', {
    sessionId: this.sessionId,
    input: serverInput,
  })
  this.syncSession(envelope.sessionId)

  // SSE 成功时按 id 去重回放；SSE 失败时全量回放（路径 B 降级）
  if (onProgress && Array.isArray(envelope.progressEvents)) {
    const delivered = this.activeSse?.deliveredIds ?? new Set<string>()
    for (const event of envelope.progressEvents) {
      const dedupeKey = event.id || `${event.processTypeLabel}:${event.content}`
      if (delivered.has(dedupeKey)) continue
      try { onProgress(event) } catch { /* 进度事件不能阻塞主流程 */ }
    }
  }
  this.closeProgressStream()

  if (!envelope.decision) throw new Error('Agent server did not return a runtime decision.')
  return envelope.decision
}
```

新增私有方法 `ensureServerSessionId`（复用已有 sessionId 或 POST `/api/agent/sessions` 新建）：

```typescript
/**
 * 确保前端持有有效 sessionId。
 * 优先复用 sessionStorage 中的；不存在则 POST /api/agent/sessions 新建并落盘。
 */
private async ensureServerSessionId(): Promise<string | null> {
  if (this.sessionId) return this.sessionId
  try {
    const envelope = await this.post<{ session: { id: string } }>('/api/agent/sessions', {})
    this.syncSession(envelope.session.id)
    return this.sessionId
  } catch {
    return null
  }
}
```

新增纯函数 `safeParseProgressEvent`（解析 SSE data 字段）：

```typescript
/**
 * 安全解析 SSE 推送的 progress 事件 payload。
 * data 结构来自 agentServerRuntime.appendEvent 写入的 event.data 字段。
 */
function safeParseProgressEvent(raw: string | null): RuntimeProgressEvent | null {
  if (!raw) return null
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>
    const data = (obj.data ?? obj) as Record<string, unknown>
    if (typeof data.content !== 'string') return null
    return {
      id: typeof data.progressId === 'string' ? data.progressId : undefined,
      content: data.content,
      thinking: typeof data.thinking === 'string' ? data.thinking : undefined,
      details: (data.details ?? undefined) as Record<string, unknown> | undefined,
      processType: (data.processType as RuntimeProgressEvent['processType']) ?? 'general',
      processTypeLabel: (data.processTypeLabel as string) ?? '进度',
    }
  } catch {
    return null
  }
}
```

### 4.4 `src/components/dialogue/ChatPanel.vue`
**不需要改动**。`processMessage` L1851-1874 的 `handleRuntimeProgress` 渲染逻辑、L1969-1985 的 `submitInstruction({ onProgress: handleRuntimeProgress })` 透传链路完全复用——只要 `HttpAgentRuntimeClient.submitInstruction` 在收到 SSE progress 时回调 `onProgress`，气泡就会立即追加。

### 4.5 `scripts/agent-server.mjs`
**不需要改动**。SSE 端点、CORS、心跳、清理已就绪。`writeSse` 写出的 `event: progress\ndata: {...}\n\n` 会被 `EventSource.addEventListener('progress', ...)` 自动接收（因为 `event` 字段就是事件名）。

---

## 5. 风险评估

| # | 风险 | 影响 | 缓解 |
|---|------|------|------|
| 1 | EventSource 浏览器兼容性 | 现代浏览器全支持；IE 不支持（项目无 IE 兼容要求） | `typeof EventSource === 'undefined'` 检测，缺失时直接返回 false，自动走路径 B |
| 2 | 跨域 EventSource（前端 5173 → 后端 3000） | EventSource 不支持自定义 header，但支持 CORS | 后端 L99-104 已配 `access-control-allow-origin: request.headers.origin \|\| '*'`；EventSource 默认带 `credentials: false`，与 `*` origin 兼容 |
| 3 | 多次 submitInstruction 时 SSE 复用 / 关闭 | 上一轮 SSE 未关闭会重复推送 | `openProgressStream` 内部先 `closeProgressStream()`；POST 返回后必 `closeProgressStream()`；类销毁时也应 close（项目无销毁时机，单例 client 跨调用复用，故每次 submit 内开闭即可） |
| 4 | SSE 连接慢 / 握手超时 | POST 早于 SSE ready 发出 → 漏早期 progress（事件已在 eventLog，但前端 SSE 还在历史阶段忽略） | `awaitProgressStreamReady(1500)` 强制等 ready；超时则降级路径 B 全量回放 |
| 5 | SSE 中断 / 重连 | EventSource 默认自动重连；可能重复发历史事件 | `ready` 标志位仅在首次收到时置 true；重连后历史事件再次到达时 `ready` 已为 true 会被错误推送。**对策**：在 `onerror` 时把 `ready` 重置为 false，并清空 `deliveredIds`？——但清空会导致 envelope 回放阶段重复推送。**最终对策**：`onerror` 直接 `closeProgressStream()`，本轮后续走路径 B 回放（envelope 已含全部 progress） |
| 6 | envelope 返回时 SSE 仍有事件未送达 | 极少数情况下 POST 已返回但 SSE 缓冲未 flush | envelope 回放按 id 去重，未送达的会被补推；SSE 后到的会被 `deliveredIds` 跳过 |
| 7 | Local 模式行为变化 | Local 模式不走 HTTP，不应受影响 | `LocalAgentRuntimeClient` 完全不改动，继续走同步 `onProgress` |
| 8 | eventLog 撑爆 100 条上限 | 单轮 4 条 progress + 既有 context/decision/error 事件 | `appendEvent` 已 `slice(-100)` 自动截断；单 session 多轮调用会丢失最早的非关键事件，但 `material_evidence`、`formal_write` 等关键事件由独立字段保存，不受 eventLog 截断影响 |
| 9 | LLM 意图被本地逻辑改写 | 违反 AGENTS.md | 不改：progress 事件内容来自 `demoRuntimeFacade.ts` 既有分支，appendEvent 只搬运不改写；前端 `safeParseProgressEvent` 只解 JSON 不改文本 |
| 10 | file session store 持久化兼容 | 加 `'progress'` type 后旧数据无此类型 | `AgentServerFileSessionStore` 解析时不严格校验 type 字符串，旧数据无 progress 类型即可；新数据写入新 type 不破坏 schemaVersion=2 |

---

## 6. 验证方式

### 6.1 单元测试（新增/扩展）
- `src/services/__tests__/agentRuntimeClient.test.ts`：
  - 新增 case：stub `EventSource`，验证 `submitInstruction` 在收到 SSE `progress` 事件时按序调用 `onProgress`。
  - 新增 case：SSE 未就绪（无 EventSource）时，回退到 envelope.progressEvents 回放（路径 B 行为不变）。
  - 新增 case：SSE 已送达的 id，在 envelope 回放阶段被跳过（去重）。
- `src/services/__tests__/agentServerRuntime.test.ts`：
  - 新增 case：`submitInstruction` 收到 `onProgress` 时，`session.eventLog` 包含 `type: 'progress'` 事件，且 `data.content === event.content`。
  - 新增 case：`subscribeSessionEvents` 订阅者能在 `submitInstruction` 执行期间收到 progress 事件。

### 6.2 验证门禁
- `npm run agent:check`（含 vitest run + build）。
- `npm run test`（vitest run）。
- `npm run build`（type-check + vite build）。

### 6.3 浏览器冒烟（前台交互验证）
1. `npm run dev` 起前端 5173；`npm run agent:server` 起后端 3000；`.env` 设 `VITE_AGENT_RUNTIME_MODE=http`。
2. 打开 `http://localhost:5173`，在对话区输入需要多阶段的指令（例如"在 09:00-10:00 编排一段新闻"）。
3. 观察：气泡应**逐条**出现（理解需求 → 查节目库 → 候选决策 → 写入播单），间隔数百毫秒到数秒可观察，**不是 4 条同时蹦出**。
4. DevTools Network 面板应能看到一个 `events?follow=1` 的 EventSource 连接，状态为 `pending`（流式），消息按阶段到达；POST `/api/agent/submit` 在第一条 progress 之前发出。
5. 关闭后端 3000 模拟 SSE 失败：前端应能在 POST 返回后批量回放 envelope.progressEvents（降级路径 B），不阻塞主流程。

---

## 7. 实施顺序建议

1. **后端先行**：改 `agentServerSessionStore.ts`（加 `'progress'` type）→ 改 `agentServerRuntime.ts`（appendEvent）→ 加 agentServerRuntime 测试 → 跑 `npm run test` 确认后端单测通过。
2. **前端跟进**：改 `agentRuntimeClient.ts`（EventSource 生命周期 + 去重回放）→ 加 agentRuntimeClient 测试 → 跑 `npm run test`。
3. **联调**：`npm run agent:check` + `npm run build` + 浏览器冒烟。
4. **code-review-expert 复检并直接修复**（不需用户介入）。

---

## 8. 与 AGENTS.md 的对齐审查

| AGENTS.md 要求 | 本方案是否遵守 |
|----------------|----------------|
| LLM-first / LLM-only 主路径，本地逻辑不改写意图 | ✅ progress 事件源在 `demoRuntimeFacade.ts` 既有分支，appendEvent 只搬运，前端 `safeParseProgressEvent` 只解析不改文本 |
| 确定性逻辑只用于保护结果、校验写入、暴露失败 | ✅ SSE 去重、超时降级、close 清理都是"保护结果"，不改意图 |
| 失败时暴露失败并允许重试，不假装理解 | ✅ SSE 失败直接降级到路径 B 全量回放，不伪造 progress |
| 不保存密钥 | ✅ 无密钥涉及 |
| 最小实现改动 | ✅ 后端改 2 处（type + appendEvent），前端改 1 个文件（agentRuntimeClient.ts），ChatPanel.vue / agent-server.mjs 不动 |
| Case First | ✅ 第 6.1 节列出新增 case 字段（intent、assertion） |

---

## 9. 待用户确认事项

1. **超时阈值 1500ms 是否合适？**（后端本地响应极快，1.5s 足够；过短可能误降级，过长可能让用户多等）。
2. **是否允许在 envelope.progressEvents 数组之外，再保留 sessionId 在 sessionStorage 中预创建？**（当前方案在首次 submit 时若 sessionStorage 无 sessionId，会先 POST `/api/agent/sessions` 新建——这会多一次 HTTP 往返，但只发生在首次；后续复用）。若不希望多这次往返，可改为"先 POST submit（不带 sessionId）让后端建 session→ envelope 返回 sessionId → 后续调用才走 SSE"——但这样首条消息无法实时流式，违背需求。**建议保留方案**：首次多一次 POST `/api/agent/sessions`（< 10ms 本地响应），换取首条消息也能流式。
3. **eventLog 100 条上限是否需要上调？**（单轮 4 条 progress，约可保留 25 轮历史；足够调试。如需更长历史可改为 200，但会增加 file store 体积）。

确认后即可进入实施。
