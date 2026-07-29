# aibiandan Code Wiki

## 业务数据入口

业务实体的唯一入口为 `src/services/agent/canonicalSchedulingData.ts`，底层数据位于
`src/mock/data/`。`src/mock/orchestrationMock.ts` 只负责把这些数据转换成编排运行时
所需的候选视图。测试与浏览器验收不得另建节目/素材 seed；缺失数据必须暴露
`data_fixture_missing`，以免把 LLM 协议 mock 误认为真实数据。

> 广电节目串联单 AI 自动编排前端工程的结构化技术文档。
> 生成时间：2026-06-25
> 适用仓库：`c:\Users\Administrator\Documents\Playground\aibiandan`（包名 `bigbiandan-ui`）

---

## 目录

1. [项目概览](#1-项目概览)
2. [技术栈与依赖关系](#2-技术栈与依赖关系)
3. [项目目录结构](#3-项目目录结构)
4. [整体架构](#4-整体架构)
5. [核心模块职责](#5-核心模块职责)
6. [关键类与函数说明](#6-关键类与函数说明)
7. [核心流程链路](#7-核心流程链路)
8. [项目运行方式](#8-项目运行方式)
9. [测试与验证体系](#9-测试与验证体系)
10. [配置与环境变量](#10-配置与环境变量)
11. [当前状态与路线图](#11-当前状态与路线图)
12. [文档索引](#12-文档索引)

---

## 1. 项目概览

### 1.1 一句话定位

aibiandan 是一个面向电视频道 / 轮播播单的 **AI 自动编排前端原型**，目标让编单员围绕频道、日期、版面参考与节目候选，通过自然语言对话驱动播单的创建、原子命令编排、候选推荐确认、版面草案生成与正式播单写入。

### 1.2 核心能力

| 能力域 | 说明 |
|--------|------|
| 播单管理 | 电视播单（时间格子）与轮播播单（内容队列）双轨；工作区多文档切换 |
| 自然语言编排 | LLM-first 意图理解、参数提取、原子命令执行、候选推荐确认 |
| 复合候选续接 | 批量替换等复合任务保留结构化 pending、候选 ID 与原任务，候选选择由 planner 的 `select_candidate` 继续 |
| 版面草案 | 自然语言生成/微调/提交版面草案；Excel 导入；可行性预检 |
| 全量/局部编排 | 空窗驱动三阶段流水线（规划→填充→修补），广告补位 |
| 校验与修补 | 7 条内置校验规则、顺播保护、有限轮次修补 |
| Agent 服务端 | Agent Server 持有 LLM Key、会话持久化、ReAct 长程任务、正式播单写入边界 |

### 1.3 工程定位

- 仍是**演示型前端工程**，业务数据来自 `src/mock/`，非生产化交付版本。
- 长流程恢复由 `formalOrchestrationRecovery.ts` 生成结构化恢复计划，`FormalOrchestrationRuntime` 使用原 `runId` 重建 checkpoint 上下文，`AgentServerRuntime` 持久化原始请求与播单版本并提供显式 recovery API。
- ReAct action 使用由 `runId + turn + actionIndex + action` 生成的稳定 key；半批次恢复据此跳过已完成 action，正式写入仍统一经过 `FormalPlaylistWriteAdapter`。
- 已建立工程质量基线（vue-tsc / eslint / vitest / vite build 通过）。
- 内置一套 **Agent Harness 工程方法**（见 `AGENTS.md`），约束 LLM-first 主路径与本地结果保护边界。

---

## 2. 技术栈与依赖关系

### 2.1 运行时依赖（dependencies）

| 依赖 | 版本 | 用途 |
|------|------|------|
| `vue` | ^3.5.30 | 视图框架 |
| `vue-router` | ^5.0.3 | 路由 |
| `pinia` | ^3.0.4 | 状态管理（仅示例 store，实际编排状态在 composable） |
| `element-plus` | ^2.13.6 | UI 组件库 |
| `@element-plus/icons-vue` | ^2.3.2 | 图标 |
| `openai` | ^6.32.0 | LLM 客户端 SDK（OpenAI 兼容协议） |
| `dayjs` | ^1.11.20 | 时间处理 |
| `lodash-es` | ^4.17.23 | 工具函数 |
| `uuid` | ^13.0.0 | 唯一 ID 生成 |
| `xlsx` | ^0.18.5 | Excel 版面导入（动态 import） |

### 2.2 开发依赖（关键 devDependencies）

| 依赖 | 用途 |
|------|------|
| `vite` ^7.3.1 + `@vitejs/plugin-vue` | 构建 |
| `vite-plugin-vue-devtools` | 开发工具 |
| `typescript` ~5.9.3 + `vue-tsc` ^3.2.5 | 类型检查 |
| `vitest` ^4.1.2 | 单测 |
| `oxlint` + `eslint` + `eslint-plugin-vue` + `prettier` | Lint / 格式化 |
| `sass-embedded` | SCSS |
| `jiti` ^2.6.1 | Agent Server 直接 import TS 源码，免预构建 |
| `npm-run-all2` | 脚本并行/串行 |

### 2.3 Node 版本要求

`engines.node`: `^20.19.0 || >=22.12.0`

### 2.4 依赖关系总览

```text
┌─────────────────────────────────────────────────────────────────┐
│  浏览器前端（Vue 3 + Element Plus）                              │
│  views/ ─ components/ ─ composables/ ─ stores/                   │
└───────────────────────────────┬─────────────────────────────────┘
                                │
┌───────────────────────────────▼─────────────────────────────────┐
│  服务层 services/                                                 │
│  ├─ agent/      Agent 核心（意图/能力/约束/候选评判/策略）         │
│  ├─ runtime/    前台 & 服务端运行时（会话/任务计划/写入边界）       │
│  ├─ llm/        LLM 基础设施（客户端/Prompt/解析/规划器）          │
│  ├─ orchestration/  编排数据与接口分类                             │
│  ├─ validators/ 校验引擎                                          │
│  └─ *.ts        编排核心、命令执行、候选、版面草案、意图识别        │
└───────────────┬───────────────────────────────┬─────────────────┘
                │                               │
┌───────────────▼───────────────┐   ┌───────────▼───────────────┐
│  mock/ + types/                │   │  scripts/agent-server.mjs  │
│  演示数据 + 领域类型            │   │  Agent Server（jiti + http）│
└────────────────────────────────┘   └────────────────────────────┘
```

---

## 3. 项目目录结构

```text
aibiandan/
├── AGENTS.md                     # Agent Harness 强制工作协议（开发必读）
├── README.md                     # 项目入口说明
├── package.json                  # 脚本与依赖
├── vite.config.ts                # Vite 构建配置
├── vitest.config.ts              # Vitest 测试配置
├── tsconfig*.json                # TypeScript 配置（app/node/根）
├── eslint.config.ts / .oxlintrc.json / .prettierrc.json
├── env.d.ts
├── .env.development              # 浏览器端 LLM 配置
├── .env.agent                    # Agent 运行时模式（http）
├── index.html                    # HTML 入口
│
├── docs/                         # 项目文档（架构/状态/技术债/路线图等）
│   ├── architecture.md
│   ├── module-map.md
│   ├── current-status.md
│   ├── tech-debt.md
│   ├── roadmap.md
│   ├── feature-alignment.md
│   ├── testing-baseline.md
│   ├── agent-deployment-runbook.md
│   ├── agent-development-protocol.md
│   ├── aibiandan-agent-rules.md
│   ├── scheduling-agent-natural-language-command-inventory.md
│   └── ...（设计/计划/周报）
│
├── scripts/                      # 运行脚本
│   ├── agent-server.mjs          # Agent Server 入口
│   ├── agent-env.mjs             # env 加载与 LLM 配置持久化
│   ├── agent-health-check.mjs    # 健康检查（11 项）
│   ├── agent-trial-start.mjs     # 办公网试用启动
│   ├── agent-real-llm-eval-strict.mjs
│   └── foreground-browser-goal37.mjs  # Playwright 浏览器测试
│
├── test-fixtures/                # 测试夹具
│   ├── agent-cases/
│   └── browser/smg-weekday-layout.xlsx
│
├── test-results/                 # 测试产物（截图/JSON）
│
└── src/                          # 源码
    ├── main.ts                   # 应用入口
    ├── App.vue                   # 根组件（仅 RouterView）
    ├── assets/                   # 样式与静态资源
    ├── router/index.ts           # 路由
    │
    ├── types/                    # 领域类型
    │   ├── orchestration.ts      # 编排核心类型（~900 行）
    │   └── llm.ts                # LLM 相关类型
    │
    ├── views/
    │   └── broadcast-plan/       # 串联单主页面
    │       ├── create.vue                # 主页面容器
    │       ├── useBroadcastPlan*.ts      # 页面级 composable
    │       ├── broadcastPlan*.ts         # 页面级 helper
    │       ├── scheduleData.ts           # ScheduleItem 类型与基础数据
    │       ├── layoutReferenceData.ts    # 版面参考
    │       ├── permissions.ts            # 权限模型
    │       └── components/               # 侧边栏/编辑弹窗
    │
    ├── components/
    │   ├── dialogue/             # 对话面板
    │   │   ├── ChatPanel.vue             # 对话主面板
    │   │   └── chatPanel*.ts             # 拆分 helper
    │   ├── llm/LLMConfigPanel.vue        # LLM 配置面板
    │   ├── orchestration/                # 编排可视化组件
    │   │   ├── GapVisualizer.vue
    │   │   ├── OrchestrationProgress.vue
    │   │   └── TaskModeSelector.vue
    │   └── icons/
    │
    ├── composables/
    │   └── useOrchestrator.ts    # 正式 ReAct 组合式封装
    │
    ├── stores/counter.ts         # Pinia 示例（未实际使用）
    │
    ├── data/channel-studio-map.ts
    │
    ├── mock/                     # 演示数据
    │   ├── demoData.ts
    │   ├── orchestrationMock.ts
    │   └── data/                 # JSON 数据源
    │       ├── channels.json
    │       ├── columns.json
    │       ├── layoutSlots.json
    │       ├── programDefinitions.json
    │       ├── finishedProducts.json
    │       └── historySchedules.json
    │
    └── services/                 # 核心服务层
        ├── orchestrator.ts              # 编排引擎核心
        ├── commandExecutor.ts           # 通用命令执行器
        ├── insertCommandExecutor.ts     # 插入命令执行器
        ├── replaceCommandExecutor.ts    # 替换命令执行器
        ├── scheduleCommandBus.ts        # 命令总线
        ├── intentRecognizer.ts          # 微调意图识别
        ├── layoutIntentRecognizer.ts    # 版面草案意图识别
        ├── paramExtractor.ts            # 命令参数提取
        ├── atomicCapabilities.ts        # 原子操作能力
        ├── atomicTimeParser.ts          # 原子时间解析
        ├── atomicOffsetParser.ts        # 原子偏移解析
        ├── candidateService.ts          # 候选检索与排序
        ├── candidateSelectionService.ts # 候选选择
        ├── candidateKeywordMatcher.ts   # 候选关键词匹配
        ├── insertCandidateResolver.ts   # 插入候选解析
        ├── gapManager.ts                # 空窗管理器
        ├── materializer.ts              # 物化器
        ├── adFillService.ts             # 广告补位
        ├── repairManager.ts             # 修补管理器
        ├── fallbackManager.ts           # 回退管理器
        ├── dialogueContext.ts           # 对话上下文
        ├── manualCommandAdapter.ts      # 人工操作适配
        ├── entityLinker.ts              # 实体链接器
        ├── queryIntentService.ts        # 查询意图服务
        ├── retrievalConstraintCompiler.ts
        ├── schedulingIntentHeuristics.ts
        ├── draftSegmentLabelMatcher.ts
        ├── layoutAnalysisService.ts
        ├── layoutAnalysisPromptBuilder.ts
        ├── layoutDraftService.ts
        ├── layoutDraftCompiler.ts
        ├── layoutDraftValidator.ts
        ├── layoutDraftCompleteness.ts
        ├── layoutDraftFeasibilityService.ts
        ├── layoutDraftSemanticCleaner.ts
        ├── layoutImportService.ts
        ├── orchestrationPromptBuilder.ts
        ├── orchestrationStrategyService.ts
        ├── scheduleValidationService.ts
        ├── scheduleSequenceGuard.ts
        ├── scheduleTargetResolver.ts
        ├── orchestrator.ts
        │
        ├── agent/               # Agent 核心运行时（22 文件）
        ├── runtime/             # 前台 & 服务端运行时（22 文件）
        ├── llm/                 # LLM 基础设施（10 文件）
        ├── orchestration/       # 编排数据与接口分类
        │   ├── dataService.ts
        │   ├── runtimeLayoutRegistry.ts
        │   └── interfaces/      # execute/explain/preview/read
        └── validators/validationEngine.ts
```

---

## 4. 整体架构

正式 ReAct 的原子 action 通过请求级 `CapabilityRegistry` 解析唯一 owner，再进入既有原子 capability 校验；路由冲突在执行前暴露结构化失败，避免长流程端口形成第二条 capability 分发路径。

敏感删除或轮播候选写入在 capability 层返回 `needs_confirmation` 时，原子端口会把既有 `pendingTask` 封装为带 `owner/workspaceKey/mutationId/mutationPolicy` 的正式 pending mutation；该封装不执行 commit，也不替用户确认。

正式 ReAct 内核检测到 pending mutation 后立即保存 `waiting_user` checkpoint 并停止当前批次。服务端返回 `waiting_user` outcome；前台独立审批条显式调用 `confirm_pending` 或 `cancel`，不重发自然语言。恢复计划复用原 run/pendingTask，把待确认 action 标为 `pendingAction: confirm + formal_write`，再走统一 capability 与 `FormalPlaylistWriteAdapter`。等待/恢复 outcome 携带最后 checkpoint 的 `scheduleItems`，页面与 session 同步快照及版本；原子输入会移除控制面 `orchestration` 字段，避免递归创建第二个 ReAct run。

已有正式节目执行整批重编时，第一次确认由 Local/Agent Server 边界转换为服务端持有的 `FormalOrchestrationGrant`，前台只接收 `authorizationGrantId`。Grant 绑定 session/workspace、来源 pending、播单版本、草案可执行指纹和任务范围；ReAct 启动、恢复及正式 mutation 分别校验，范围内不重复审批，范围漂移则停止。完整 Grant 不接受客户端提交，也不由 LLM 生成。

### 4.1 分层架构

项目可概括为 6 层：

```text
┌────────────────────────────────────────────────────────────────────┐
│ L1  页面容器层        create.vue / ChatPanel.vue / 组件             │
├────────────────────────────────────────────────────────────────────┤
│ L2  页面级状态与接线层 useBroadcastPlan*.ts / broadcastPlan*.ts     │
├────────────────────────────────────────────────────────────────────┤
│ L3  对话与命令编排层   commandExecutor / insert/replace/bus         │
│                      intentRecognizer / paramExtractor             │
├────────────────────────────────────────────────────────────────────┤
│ L4  编排执行与校验层   useOrchestrator / formalOrchestrationRuntime │
│                      gapManager / materializer / validators        │
├────────────────────────────────────────────────────────────────────┤
│ L5  Agent 运行时层     services/agent + services/runtime + llm      │
│                      （LLM-first 意图/任务计划/写入边界/会话）       │
├────────────────────────────────────────────────────────────────────┤
│ L6  数据与 mock 支撑层 services/orchestration + mock/ + types/      │
└────────────────────────────────────────────────────────────────────┘
```

### 4.2 双运行时模式

前端支持两种 Agent 运行时模式（`resolveAgentRuntimeMode`）：

| 模式 | 标识 | 说明 |
|------|------|------|
| `local` | `VITE_AGENT_RUNTIME_MODE=local` | 浏览器内直连 `SchedulingAgentRuntimeFacade`，LLM Key 在浏览器端 |
| `http` | `VITE_AGENT_RUNTIME_MODE=http` | 通过 fetch 调用 Agent Server，LLM Key 在服务端（**推荐**） |

### 4.3 Agent Server 服务端架构

```text
HTTP 客户端 (agentRuntimeClient)
        │  POST /api/agent/submit
        ▼
┌───────────────────────────────────────────────────┐
│  AgentServerRuntime                                │
│  - buildForegroundAgentContextPackage（客观现场状态：review / atomic / layout_reference / general）  │
│  - submitInstruction → runtime.submitInstruction   │
│  - syncDecision（记录事件流）                       │
│  - executePendingCommand                           │
│  - resolvePendingTargetSelection / InsertRecommend │
│  - stopReactTask / stopExecutionCheckpoint         │
└───────────────┬───────────────────────────────────┘
                │
   ┌────────────┼────────────┬──────────────┬───────────────┐
   ▼            ▼            ▼              ▼               ▼
SessionStore  Execution   FormalPlaylist  ReactTask     MaterialEvidence
（memory/file） Service    WriteAdapter    Runtime       Service
              （检查点）   （幂等/版本/批量）（maxTurns）   （素材证据）
```

### 4.4 Agent 核心运行时分层

```text
SchedulingAgentRuntime.submit(input)
        │
        ▼
LlmAgentIntentInterpreter（LLM-only，maxTokens 1100, temp 0）
        │  返回 AgentIntentInterpretation
        ▼
CapabilityRegistry.resolveAll（唯一匹配校验）
        │
        ▼
AtomicCommandCapability.handle*（8 种原子命令）
   ├─ ConstraintEngine（重叠/边界/顺播/锁定）
   ├─ TvSequenceCandidateSelector（仅 TV 顺播）
   ├─ LlmAgentCandidateJudge（LLM 候选决策）
   ├─ ProfessionalRules（11 条专业规则）
   ├─ AgentPlaylistPolicy（TV direct / Rotation confirm）
   └─ SchedulingDataGateway.commit（fingerprint 校验）
```

---

## 5. 核心模块职责

### 5.1 L1 / L2 页面层（`src/views/broadcast-plan/`）

| 文件 | 职责 |
|------|------|
| [create.vue](file:///./src/views/broadcast-plan/create.vue) | 主页面容器：工作区 tabs、时间轴表格、AI 侧边栏、focus 高亮、DEV Harness |
| [useBroadcastPlanEditor.ts](file:///./src/views/broadcast-plan/useBroadcastPlanEditor.ts) | 编辑器 composable：弹窗与增删改接线 |
| [useBroadcastPlanOrchestration.ts](file:///./src/views/broadcast-plan/useBroadcastPlanOrchestration.ts) | 正式 ReAct 编排 composable：封装 useOrchestrator + focusRuntime；缺少 reactTask 时失败暴露，不调用旧编排器 |
| [FormalOrchestrationApprovalBar.vue](file:///./src/views/broadcast-plan/components/FormalOrchestrationApprovalBar.vue) | 正式 ReAct 等待审批展示条；只发出 confirm/cancel UI 事件，workspace/version 校验和 recovery 调用由 composable 负责 |
| [useBroadcastPlanFocus.ts](file:///./src/views/broadcast-plan/useBroadcastPlanFocus.ts) | focus 运行时：高亮定位与回声 |
| [broadcastPlanScheduleBridge.ts](file:///./src/views/broadcast-plan/broadcastPlanScheduleBridge.ts) | 页面 ScheduleItem 与 atomic Snapshot 互转 |
| [broadcastPlanGapState.ts](file:///./src/views/broadcast-plan/broadcastPlanGapState.ts) | 空窗识别与展示状态 |
| [broadcastPlanViewState.ts](file:///./src/views/broadcast-plan/broadcastPlanViewState.ts) | 排序、版面参考映射、显示列表、计数 |
| [broadcastPlanEditorHelpers.ts](file:///./src/views/broadcast-plan/broadcastPlanEditorHelpers.ts) | 缺口默认值、保存前归一化、待插入修正 |
| [broadcastPlanOrchestrationHelpers.ts](file:///./src/views/broadcast-plan/broadcastPlanOrchestrationHelpers.ts) | 编排任务分类前状态组装与局部补排判断 |
| [scheduleData.ts](file:///./src/views/broadcast-plan/scheduleData.ts) | ScheduleItem 类型、频道选项、节目类型枚举（21 种） |
| [layoutReferenceData.ts](file:///./src/views/broadcast-plan/layoutReferenceData.ts) | dragon 频道版面参考（15 条） |
| [permissions.ts](file:///./src/views/broadcast-plan/permissions.ts) | admin/editor/viewer 三种角色权限 |

**命名约定**：`broadcastPlan*.ts` = 纯 helper；`useBroadcastPlan*.ts` = 页面级 composable（含副作用）；`create.vue` = 页面容器。

### 5.2 对话组件层（`src/components/`）

| 文件 | 职责 |
|------|------|
| [ChatPanel.vue](file:///./src/components/dialogue/ChatPanel.vue) | 对话主面板：消息流、待确认面板、扩展详情、候选对比、Agent 审计卡片、17 个 quickActions；消息过滤只读结构化标签/payload/details，不按回复正文关键词隐藏终态 |
| [chatPanelActiveRequestController.ts](file:///./src/components/dialogue/chatPanelActiveRequestController.ts) | 短链请求活动状态、5 秒可停止门槛与服务端停止接线状态 |
| [agentLlmStreamProgress.ts](file:///./src/services/runtime/agentLlmStreamProgress.ts) | LLM 首 token/增量的业务化安全进度映射；原始结构内容与 `structured_complete` 协议事件不进入用户对话 |
| [chatPanelFormatting.ts](file:///./src/components/dialogue/chatPanelFormatting.ts) | 格式化、摘要文案、programType/selectionMode 中文映射 |
| [chatPanelDetails.ts](file:///./src/components/dialogue/chatPanelDetails.ts) | 候选对比、风险提炼、明细摘要、各种标签映射表 |
| [LLMConfigPanel.vue](file:///./src/components/llm/LLMConfigPanel.vue) | LLM 配置面板：http 模式显示"由服务端管理"，否则显示表单 |
| [GapVisualizer.vue](file:///./src/components/orchestration/GapVisualizer.vue) | 空窗时间轴可视化 |
| [OrchestrationProgress.vue](file:///./src/components/orchestration/OrchestrationProgress.vue) | 编排进度面板（phase 映射） |
| [TaskModeSelector.vue](file:///./src/components/orchestration/TaskModeSelector.vue) | 6 种任务模式卡片选择 |

### 5.3 编排执行与校验层

| 文件 | 职责 |
|------|------|
| [useOrchestrator.ts](file:///./src/composables/useOrchestrator.ts) | 正式 ReAct Vue 组合式封装，暴露启动、恢复、中止与响应式状态；不再暴露旧 full/partial 直启入口 |
| [orchestrator.ts](file:///./src/services/orchestrator.ts) | 编排引擎核心：三阶段流水线、事件驱动、空窗驱动填充 |
| [gapManager.ts](file:///./src/services/gapManager.ts) | 空窗生命周期管理（minGapDuration=60s） |
| [materializer.ts](file:///./src/services/materializer.ts) | 候选物化为 ScheduleItemSnapshot，处理广告破口切分 |
| [adFillService.ts](file:///./src/services/adFillService.ts) | 广告插入机会识别与计划（AD_DURATIONS=[1800,900,300]） |
| [repairManager.ts](file:///./src/services/repairManager.ts) | 有限轮次修补（最多 3 轮） |
| [fallbackManager.ts](file:///./src/services/fallbackManager.ts) | 三级回退（条目级/空窗级/会话级） |
| [validationEngine.ts](file:///./src/services/validators/validationEngine.ts) | 7 条内置校验规则 |
| [scheduleSequenceGuard.ts](file:///./src/services/scheduleSequenceGuard.ts) | 顺播顺序违规检测（reverse_order/sequence_gap/duplicate_episode） |
| [orchestrationStrategyService.ts](file:///./src/services/orchestrationStrategyService.ts) | 基于版面命中的栏目生成 GapPlanningThought |
| [scheduleValidationService.ts](file:///./src/services/scheduleValidationService.ts) | 当前编排单校验薄封装 |
| [scheduleTargetResolver.ts](file:///./src/services/scheduleTargetResolver.ts) | 定位用户指令指向的具体条目（LLM + 本地安全校验） |

### 5.4 对话与命令链路层

| 文件 | 职责 |
|------|------|
| [commandExecutor.ts](file:///./src/services/commandExecutor.ts) | 通用命令执行器（10 种 action） |
| [insertCommandExecutor.ts](file:///./src/services/insertCommandExecutor.ts) | 插入命令执行器 |
| [replaceCommandExecutor.ts](file:///./src/services/replaceCommandExecutor.ts) | 替换命令执行器 |
| [scheduleCommandBus.ts](file:///./src/services/scheduleCommandBus.ts) | 命令总线（按 action 分发） |
| [intentRecognizer.ts](file:///./src/services/intentRecognizer.ts) | LLM 微调意图识别（6 类，LLM-first 不兜底） |
| [layoutIntentRecognizer.ts](file:///./src/services/layoutIntentRecognizer.ts) | 版面草案意图识别（6 种模式） |
| [paramExtractor.ts](file:///./src/services/paramExtractor.ts) | LLM 命令参数提取（insert/move/delete/replace） |
| [atomicCapabilities.ts](file:///./src/services/atomicCapabilities.ts) | 原子操作能力（维护工作快照并执行校验；失败保留现场，不自动回滚） |
| [atomicTimeParser.ts](file:///./src/services/atomicTimeParser.ts) | 原子时间解析（中英文钟点/点半刻） |
| [atomicOffsetParser.ts](file:///./src/services/atomicOffsetParser.ts) | 原子偏移解析（前/后移 N 小时/分钟） |
| [candidateService.ts](file:///./src/services/candidateService.ts) | 候选检索与排序（顺播/非顺播策略） |
| [candidateSelectionService.ts](file:///./src/services/candidateSelectionService.ts) | 候选选择（LLM + 本地守卫 + 编辑决策） |
| [candidateKeywordMatcher.ts](file:///./src/services/candidateKeywordMatcher.ts) | 候选关键词匹配核心规则库（5 层关键词） |
| [insertCandidateResolver.ts](file:///./src/services/insertCandidateResolver.ts) | 插入候选解析（直接执行/推荐列表/追问） |
| [dialogueContext.ts](file:///./src/services/dialogueContext.ts) | 对话上下文构建 |
| [manualCommandAdapter.ts](file:///./src/services/manualCommandAdapter.ts) | 人工 UI 操作转统一编排命令 |
| [entityLinker.ts](file:///./src/services/entityLinker.ts) | 插入参数转候选检索命令与插入命令 |
| [queryIntentService.ts](file:///./src/services/queryIntentService.ts) | 基于空窗生成候选查询条件 |
| [retrievalConstraintCompiler.ts](file:///./src/services/retrievalConstraintCompiler.ts) | 栏目约束转关键词 |
| [schedulingIntentHeuristics.ts](file:///./src/services/schedulingIntentHeuristics.ts) | 编排意图启发式（时间范围解析、是否编排请求） |
| [draftSegmentLabelMatcher.ts](file:///./src/services/draftSegmentLabelMatcher.ts) | 版面草案片段标签匹配 |

### 5.5 版面草案工作流层

| 文件 | 职责 |
|------|------|
| [layoutDraftService.ts](file:///./src/services/layoutDraftService.ts) | 版面草案生成与微调（LLM 驱动，生成 LayoutDraftSpec） |
| [layoutDraftCompiler.ts](file:///./src/services/layoutDraftCompiler.ts) | LayoutDraftSpec 编译为 LayoutDraft（columns + slots） |
| [layoutDraftValidator.ts](file:///./src/services/layoutDraftValidator.ts) | 草案校验（spec 级 + draft 级）；模型 spec 缺失或畸形时返回 `invalid_spec`，不补造草案 |
| [layoutDraftCompleteness.ts](file:///./src/services/layoutDraftCompleteness.ts) | 草案完整度评估（missing/empty/partial/complete） |
| [layoutDraftFeasibilityService.ts](file:///./src/services/layoutDraftFeasibilityService.ts) | 草案可行性预检（每栏目段能否找到候选） |
| [layoutDraftSemanticCleaner.ts](file:///./src/services/layoutDraftSemanticCleaner.ts) | 草案语义清洗（去噪声词/动作词/时段词） |
| [layoutImportService.ts](file:///./src/services/layoutImportService.ts) | Excel 版面导入（3 种模板模式） |
| [layoutAnalysisService.ts](file:///./src/services/layoutAnalysisService.ts) | 版面编排分析（LLM 生成自然语言报告） |
| [layoutAnalysisPromptBuilder.ts](file:///./src/services/layoutAnalysisPromptBuilder.ts) | 版面分析 LLM Prompt 构建 |
| [orchestrationPromptBuilder.ts](file:///./src/services/orchestrationPromptBuilder.ts) | 编排相关 LLM Prompt 构建 |

### 5.6 Agent 核心层（`src/services/agent/`）

| 文件 | 职责 |
|------|------|
| [schedulingAgentRuntime.ts](file:///./src/services/agent/schedulingAgentRuntime.ts) | Agent 核心运行时入口，submit 主流程 |
| [llmAgentIntentInterpreter.ts](file:///./src/services/agent/llmAgentIntentInterpreter.ts) | LLM-only 意图解释器（~100 条规则，maxTokens 1100, temp 0） |
| [agentLlmStreaming.ts](file:///./src/services/agent/agentLlmStreaming.ts) | intent/candidate 流式事件类型与结构化完成边界；`structured_complete` 仅供内部状态机与 trace |
| [atomicCommandCapability.ts](file:///./src/services/agent/atomicCommandCapability.ts) | 原子命令能力包（8 种 intent 的 handle/continue/confirm） |
| [playlistPolicy.ts](file:///./src/services/agent/playlistPolicy.ts) | 8 个原子命令策略表（TV vs Rotation 分流） |
| [capabilityRegistry.ts](file:///./src/services/agent/capabilityRegistry.ts) | 能力注册表（register/list/resolve/resolveAll） |
| [constraintEngine.ts](file:///./src/services/agent/constraintEngine.ts) | 约束引擎（重叠/边界/顺播/锁定/禁排） |
| [candidateJudge.ts](file:///./src/services/agent/candidateJudge.ts) | LLM 候选决策（LLM 自判 auto_select/needs_clarification/unable_to_decide，本地仅校验结构 + 顺播后置校验）。Prompt v1.3：v1.1 移除"时长适配"硬条件，v1.2 对齐顺播文案，v1.3 移除候选数量阈值；候选数量和本地编辑评分不再覆盖证据充分的 LLM 唯一选择。 |
| [tvSequenceCandidateSelector.ts](file:///./src/services/agent/tvSequenceCandidateSelector.ts) | TV 顺播候选选择器（仅 TV） |
| [professionalRules.ts](file:///./src/services/agent/professionalRules.ts) | 11 条专业规则（block/confirm/prefer/warn/audit/pass） |
| [contextBundle.ts](file:///./src/services/agent/contextBundle.ts) | SchedulingContext 转 Bundle |
| [contextFingerprint.ts](file:///./src/services/agent/contextFingerprint.ts) | FNV-1a 哈希上下文指纹 |
| [inMemorySchedulingDataGateway.ts](file:///./src/services/agent/inMemorySchedulingDataGateway.ts) | 内存数据网关 |
| [runtimeSchedulingDataGateway.ts](file:///./src/services/agent/runtimeSchedulingDataGateway.ts) | 运行时数据网关；成功提交后检查外部 reader 是否已反映新状态，未反映时仅在当前请求内使用最近提交快照，保证 ReAct 连续 mutation 不被旧前台现场覆盖。 |
| [runtimeSchedulingDataAdapters.ts](file:///./src/services/agent/runtimeSchedulingDataAdapters.ts) | 5 个数据适配器接口 |
| [searchFacets.ts](file:///./src/services/agent/searchFacets.ts) | 中文领域词典 + 噪声词剔除 |
| [time.ts](file:///./src/services/agent/time.ts) | 时间工具 |
| [types.ts](file:///./src/services/agent/types.ts) | Agent 核心类型定义 |
| [agentSession.ts](file:///./src/services/agent/agentSession.ts) | 待处理任务管理 |
| [agentTrace.ts](file:///./src/services/agent/agentTrace.ts) | Trace 记录器 |
| [agentAuditSummary.ts](file:///./src/services/agent/agentAuditSummary.ts) | 审计摘要生成 |
| [agentReadinessAudit.ts](file:///./src/services/agent/agentReadinessAudit.ts) | 静态/动态就绪审计 |
| [llmContextPackage.ts](file:///./src/services/agent/llmContextPackage.ts) | LLM 证据包构建（TV/Rotation 区分） |
| [llmIntentEvaluation.ts](file:///./src/services/agent/llmIntentEvaluation.ts) | 单轮意图识别评估 |
| [llmRuntimeEvaluation.ts](file:///./src/services/agent/llmRuntimeEvaluation.ts) | 端到端 runtime 评估 |

### 5.7 运行时层（`src/services/runtime/`）

| 文件 | 职责 |
|------|------|
| [schedulingAgentRuntimeFacade.ts](file:///./src/services/runtime/schedulingAgentRuntimeFacade.ts) | Facade 单例，继承 DemoRuntimeFacade；正式 ReAct 返回 completed/waiting_user/cancelled/failed outcome，等待与完成结果携带正式播单工作快照，失败保留 recoverable envelope；同一请求的后续轮次读取最近成功提交现场。 |
| [demoRuntimeFacade.ts](file:///./src/services/runtime/demoRuntimeFacade.ts) | 运行时核心（RuntimeDecision/RuntimePendingCommand 等类型 + 主流程） |
| [compositeInsertCandidatePreflight.ts](file:///./src/services/runtime/compositeInsertCandidatePreflight.ts) | 复合插入计划的候选硬条件预检；时长冲突阻断，单候选绑定，多候选进入选择 pending。 |
| [agentServerRuntime.ts](file:///./src/services/runtime/agentServerRuntime.ts) | 服务端运行时核心类；`executeReactOrchestration` 按 session/workspace 执行正式长流程，持久化逐轮 checkpoint，并将任务规划、查节目库、候选决策与可恢复失败投影到 session SSE。 |
| [agentServerExecutionService.ts](file:///./src/services/runtime/agentServerExecutionService.ts) | 服务端执行服务（检查点提取） |
| [agentServerSessionStore.ts](file:///./src/services/runtime/agentServerSessionStore.ts) | 内存会话存储 |
| [agentServerFileSessionStore.ts](file:///./src/services/runtime/agentServerFileSessionStore.ts) | 文件会话存储（schemaVersion 2） |
| [agentRuntimeClient.ts](file:///./src/services/runtime/agentRuntimeClient.ts) | 双模式客户端（Local/Http）；正式 ReAct 在 HTTP 模式先订阅 session SSE，再调用 `/api/agent/orchestration`，POST 按稳定事件 id 补回断流期间遗漏进度；Local/Http 均支持显式 checkpoint recovery，停止复用 session instruction stop。 |
| [reactTaskRuntime.ts](file:///./src/services/runtime/reactTaskRuntime.ts) | ReAct 任务运行时（maxTurns 1-5） |
| [reactDraftDecision.ts](file:///./src/services/runtime/reactDraftDecision.ts) | 整表草案 research observation 后的结构化 LLM decide；只接受完整目标时长的草案 action，不执行正式写入。 |
| [formalOrchestrationRuntime.ts](file:///./src/services/runtime/formalOrchestrationRuntime.ts) | 正式编排真 ReAct 批次内核；强制 act 后 observe/decide，保存 checkpoint，失败或中止立即停止。生产请求只允许由 FormalOrchestrationCapability 携带显式 `reactTask` 接入；缺失时返回 `react_plan_invalid`，不再调用旧 Orchestrator。 |
| [formalOrchestrationContextCompactor.ts](file:///./src/services/runtime/formalOrchestrationContextCompactor.ts) | ReAct decide 历史压缩纯函数；保留最近两轮 raw observation、全部已决动作摘要与失败原因，输出确定性压缩 trace 供 checkpoint/replay 审计。 |
| [formalOrchestrationActionAdapter.ts](file:///./src/services/runtime/formalOrchestrationActionAdapter.ts) | ReAct action 到业务端口的执行边界；阻断控制动作递归、缺失 mutationPolicy、跨 workspace 证据和只读 mutation。 |
| [formalOrchestrationReadPorts.ts](file:///./src/services/runtime/formalOrchestrationReadPorts.ts) | 真实 `SchedulingDataGateway` 只读端口；候选检索、当前正式播单分析和约束校验形成可供下一轮 decide 的 observation，并原样透传收视率、播放量、热度分和编辑判断，不执行 commit 或本地排序。 |
| [formalOrchestrationAtomicPort.ts](file:///./src/services/runtime/formalOrchestrationAtomicPort.ts) | ReAct 原子 action 端口；复用原子 capability 校验，分别实现 preview、pending capture 与经 FormalPlaylistWriteAdapter 的正式写入。 |
| [formalOrchestrationGrant.ts](file:///./src/services/runtime/formalOrchestrationGrant.ts) | 已有正式播单整批重编的可信任务级授权；签发并校验 session/workspace、播单版本、草案指纹、任务范围、TTL 与 intent，前台只传 grantId。 |
| [formalOrchestrationDecider.ts](file:///./src/services/agent/formalOrchestrationDecider.ts) | 长流程 observation 后的 LLM decide 适配器；prompt `v1.6` 只读取当前 observation、`compactedHistory` 与运行时解析的最小 Grant 摘要，提供合法 `atomic_command` 结构并执行 `mutationPolicy` 约束和非法响应失败暴露。 |
| [reactTaskTypes.ts](file:///./src/services/runtime/reactTaskTypes.ts) | ReAct 任务类型 |
| [schedulingTaskPlan.ts](file:///./src/services/runtime/schedulingTaskPlan.ts) | 任务计划类型 |
| [schedulingTaskPlanCompiler.ts](file:///./src/services/runtime/schedulingTaskPlanCompiler.ts) | 任务计划编译（batch/shift） |
| [schedulingTaskPlanConflict.ts](file:///./src/services/runtime/schedulingTaskPlanConflict.ts) | 任务计划冲突检测 |
| [formalPlaylistState.ts](file:///./src/services/runtime/formalPlaylistState.ts) | 正式播单快照与 Patch 计算 |
| [formalPlaylistWriteAdapter.ts](file:///./src/services/runtime/formalPlaylistWriteAdapter.ts) | 写入边界（幂等/版本/批量保护）；delegate 异常结构化为可重试失败，保留 pending 与正式快照且不缓存失败 |
| [foregroundAgentContextPackage.ts](file:///./src/services/runtime/foregroundAgentContextPackage.ts) | 前台上下文包（仅提供客观现场状态，不做用户意图分类） |
| [pendingAtomicContext.ts](file:///./src/services/runtime/pendingAtomicContext.ts) | 待处理原子上下文（5 种 phase） |
| [pendingAtomicContextService.ts](file:///./src/services/runtime/pendingAtomicContextService.ts) | 待处理上下文生命周期（TTL 10min, maxAttempts 3） |
| [playlistPolicy.ts](file:///./src/services/runtime/playlistPolicy.ts) | 运行时播单策略派生（TV/Rotation） |
| [foregroundWorkspaceState.ts](file:///./src/services/runtime/foregroundWorkspaceState.ts) | 工作区 key、切换检测与首次建单会话绑定；对话线程连续可见，pending/快照/mutation 仍按工作区隔离 |
| [foregroundLayoutDraft.ts](file:///./src/services/runtime/foregroundLayoutDraft.ts) | 前台版面草案状态 |
| [agentMaterialEvidenceService.ts](file:///./src/services/runtime/agentMaterialEvidenceService.ts) | 素材证据收集 |
| [agentSessionReplayPackage.ts](file:///./src/services/runtime/agentSessionReplayPackage.ts) | 会话回放包 |
| [runtimeSessionStore.ts](file:///./src/services/runtime/runtimeSessionStore.ts) | 旧版会话存储 |

### 5.8 LLM 基础设施层（`src/services/llm/`）

| 文件 | 职责 |
|------|------|
| [llmClient.ts](file:///./src/services/llm/llmClient.ts) | LLM 客户端（重试/统一 deadline 超时/流式/JSON object 输出/Token/Trace/浏览器 Mock），不再隐藏截断调用方的 60s transport timeout。 |
| [llmConfig.ts](file:///./src/services/llm/llmConfig.ts) | LLM 配置多源加载（默认/localStorage/Cookie/env） |
| [llmFailure.ts](file:///./src/services/llm/llmFailure.ts) | LLM 失败归一化（timeout/network/unavailable） |
| [localDemoLlm.ts](file:///./src/services/llm/localDemoLlm.ts) | 无 API Key 时演示回退 |
| [promptBuilder.ts](file:///./src/services/llm/promptBuilder.ts) | 编排各阶段 Prompt 构建 |
| [contextBuilder.ts](file:///./src/services/llm/contextBuilder.ts) | LLM 业务上下文构建 |
| [responseParser.ts](file:///./src/services/llm/responseParser.ts) | LLM JSON 响应解析与校验 |
| [taskClassifier.ts](file:///./src/services/llm/taskClassifier.ts) | 遗留任务分类器接口壳（LLM-only 后退化为默认模式） |
| [agentPlanner.ts](file:///./src/services/llm/agentPlanner.ts) | Agent Planner（多动作计划，single/react） |
| [prompts/systemPrompts.ts](file:///./src/services/llm/prompts/systemPrompts.ts) | 5 个角色系统 Prompt 常量 |

### 5.9 数据与 mock 支撑层

| 文件 | 职责 |
|------|------|
| [orchestration/dataService.ts](file:///./src/services/orchestration/dataService.ts) | 编排数据访问层（频道/节目/版面/历史/固定项） |
| [orchestration/runtimeLayoutRegistry.ts](file:///./src/services/orchestration/runtimeLayoutRegistry.ts) | 运行时版面注册中心（上传版面 > 默认版面） |
| [orchestration/interfaces/](file:///./src/services/orchestration/interfaces) | execute/explain/preview/read 四类接口 |
| [orchestrationMock.ts](file:///./src/mock/orchestrationMock.ts) | mock 数据加载与派生计算 |
| [demoData.ts](file:///./src/mock/demoData.ts) | demo 数据汇总入口 |
| [types/orchestration.ts](file:///./src/types/orchestration.ts) | 编排核心类型（~900 行） |
| [types/llm.ts](file:///./src/types/llm.ts) | LLM 相关类型 |

---

## 6. 关键类与函数说明

### 6.1 编排引擎

#### `Orchestrator`（历史独立实现，[orchestrator.ts](file:///./src/services/orchestrator.ts)）

历史空窗驱动三阶段流水线，当前仅保留独立回归与迁移参照，不再由前台、`SchedulingAgentRuntimeFacade` 或 `FormalOrchestrationCapability` 生产入口调用。正式长流程统一走 `formalOrchestrationRuntime` 真 ReAct 内核；禁止重新接回下列入口作为兼容回退。

| 成员 | 类型 | 说明 |
|------|------|------|
| `createSession` | 方法 | 创建编排会话，初始化 PlanningSession + GapManager |
| `startFullGeneration` | 方法 | 全天编排入口 |
| `startPartialGeneration` | 方法 | 局部补排入口（targetGapIds/targetTimeRange/searchKeywords） |
| `phase1Planning` | 方法 | LLM 生成全局策略（PlanCommand），超时回退默认 |
| `phase2Filling` | 方法 | 空窗驱动填充主循环 |
| `phase3Repair` | 方法 | 编排校验与修补（默认 1 轮） |
| `prepareGapPlan` | 方法 | 单空窗规划（查询→检索→填充→选择） |
| `executePreparedPlan` | 方法 | 执行单空窗写入（物化→意图校验→策略校验→冲突校验→顺播校验→appendItems） |
| `fillRemainingGapsWithAds` | 方法 | 广告补位（保护 hard_keyword_no_match 空窗） |
| `detectSelectedCandidateIntentMismatch` | 方法 | 检测候选是否命中明确编排关键词 |
| `detectAppendSequenceOrderViolation` | 方法 | 检测顺播倒序/跳集 |

**事件**：`status-change` / `gap-start` / `gap-complete` / `gap-failed` / `command-execute` / `validation-complete` / `repair-start` / `repair-complete` / `log` / `error` / `complete`

#### `useOrchestrator`（[useOrchestrator.ts](file:///./src/composables/useOrchestrator.ts)）

正式 ReAct 编排的 Vue 组合式封装。

- **响应式状态**：`isRunning` / `session` / `currentGap` / `logs` / `progress` / `progressPercentage` / `status` / `gapStats`
- **方法**：`initialize` / `classifyTask` / `startReactOrchestration` / `recoverReactOrchestration` / `cancel` / `reset`

#### `GapManager`（[gapManager.ts](file:///./src/services/gapManager.ts)）

空窗生命周期管理。关键配置 `minGapDuration=60`、`defaultPriority=100`。

- 初始化：`initializeFromLayout` / `initializeFromLayoutBands` / `alignGapsToLayoutBands` / `calculateGapsFromItems`
- 查询：`queryRemainingGaps` / `getNextGap` / `hasRemainingGaps` / `getTotalGapDuration`
- 更新：`onGapFilled` / `checkAndSplitGap` / `onItemDeleted` / `onItemTimeChanged`

#### `ValidationEngine`（[validationEngine.ts](file:///./src/services/validators/validationEngine.ts)）

7 条内置校验规则：

| 规则 | 严重级别 | 说明 |
|------|----------|------|
| `gap-check` | warning | 空窗检查 |
| `overlap-check` | critical | 时间重叠 |
| `boundary-check` | warning | 版面边界 |
| `duration-check` | warning | 时长检查 |
| `layout-check` | warning | 版面栏目 |
| `continuity-check` | info | 连续性 |
| `sequence-order-check` | critical | 顺播顺序 |

### 6.2 Agent 核心

#### `SchedulingAgentRuntime`（[schedulingAgentRuntime.ts](file:///./src/services/agent/schedulingAgentRuntime.ts)）

Agent 核心运行时入口。

- `submit(input)`：构建 effectiveInput（调 LLM 解释意图）→ `CapabilityRegistry.resolveAll` → 唯一匹配校验 → `capability.handle`
- `describeCapabilities()`：能力描述
- **LLM 失败不走本地兜底，直接返回 failed**（AGENTS.md 硬约束）

#### `LlmAgentIntentInterpreter`（[llmAgentIntentInterpreter.ts](file:///./src/services/agent/llmAgentIntentInterpreter.ts)）

LLM-only 意图解释器，`usesLlm=true`。

- 调 `llmClient.chat`（maxTokens 1100, temperature 0, `responseFormat: json_object`）；timeout 从同一请求级 `AgentDeadline` 的整体剩余预算推导，并把该 deadline 的 `AbortSignal` 传到底层请求。短链默认整体 180s（可配置），单个 LLM stage 最多 90s，意图阶段为后续阶段保留 60s，候选判断为写入保留 15s，不再使用独立 8s、隐藏 60s 或固定 30s 截断真实模型。
- System prompt 含约 100 条规则
- 当前 prompt `v2.5`；返回 JSON：`intent` / `confidence` / `slots` / `pendingAction` / `taskPlanDraft` / `assistantFeedback` / `searchAlternatives`。`queryKind` 应由模型置于顶层；解释器仅兼容模型已明确返回但误置于 `slots.queryKind` 的合法枚举，不从用户文本推断。`program_lookup` 可从可读的 `slots.targetProgramName` 取得节目名，不要求模型重复技术字段。
- `normalizeInterpretation`：校验 confidence≥0.5、合法 intent/pendingAction，过滤早完成声明，`sanitizeAssistantFeedback` 限 180 字

#### `AtomicCommandCapability`（[atomicCommandCapability.ts](file:///./src/services/agent/atomicCommandCapability.ts)）

原子命令能力包（约 5900 行），实现 8 种 AtomicCommandIntent 的完整链路。

- 8 个 handle：`handleMove/Insert/Replace/Delete/BatchMove/BatchDelete/Validate/Query`
- 8 个 continue：持续待处理
- 4 个 confirm：确认执行
- 内含候选选择、TV 顺播、专业评分、约束检查、写入提交

8 种 AtomicCommandIntent：`move` / `insert` / `replace` / `delete` / `batch_move` / `batch_delete` / `query` / `validate`

#### `AgentPlaylistPolicy`（[playlistPolicy.ts](file:///./src/services/agent/playlistPolicy.ts)）

TV vs Rotation 策略分流核心。

| 命令 | TV 模式 | Rotation 模式 |
|------|---------|---------------|
| move / batch_move | direct_execute | direct_execute |
| insert / replace | direct_execute | confirm_before_commit |
| delete / batch_delete | confirm_before_commit | confirm_before_commit |
| query / validate | read | read |

#### `AgentConstraintEngine`（[constraintEngine.ts](file:///./src/services/agent/constraintEngine.ts)）

约束引擎，检查 move/insert/replace/delete/batch 合法性、validateSchedule、validateContext。检测重叠、版面边界、禁排范围、锁定项、顺播倒序/跳集（中文集数解析，仅 TV）、历史顺播违反、素材/版权未就绪。

#### `AgentTvSequenceCandidateSelector`（[tvSequenceCandidateSelector.ts](file:///./src/services/agent/tvSequenceCandidateSelector.ts)）

TV 顺播候选选择器（仅 TV）。从 today + history 收集 SequenceFact，按 programId/name(去集数)/codePrefix 建 seriesKey；today 优先，期望集数 = max+1；多候选命中时二次打分唯一化；未命中返回 candidateOptions 让用户选。

#### `ProfessionalRules`（[professionalRules.ts](file:///./src/services/agent/professionalRules.ts)）

11 条专业规则：

1. material_readiness（素材就绪）
2. rights_readiness（版权就绪）
3. playlist_policy（播单策略）
4. content_alignment（内容对齐）
5. time_slot_fit（时段适配）
6. neighbor_column_fit（邻栏适配）
7. replacement_duty_fit（替换职责适配）
8. duration_fit（时长适配）
9. same_day_duplicate（同日重复）
10. recent_replay_interval（近期重播间隔）
11. rotation_priority（轮播优先级）

按 tvMode/rotationMode 设置 `block` / `confirm` / `prefer` / `warn` / `audit` / `pass`。

### 6.3 命令执行器

#### `ScheduleCommandBus`（[scheduleCommandBus.ts](file:///./src/services/scheduleCommandBus.ts)）

命令总线，按 action 分发：

```typescript
command.action === 'insert'
  ? await getInsertCommandExecutor().execute(command)
  : command.action === 'replace'
    ? await getReplaceCommandExecutor().execute(command, context)
    : await getCommandExecutor().execute(command)
```

#### `InsertCommandExecutor`（[insertCommandExecutor.ts](file:///./src/services/insertCommandExecutor.ts)）

工作流：参数校验 → 获取候选 → 时间可用性检查 → 顺播顺序检查 → 物化器物化 → `appendItems` → 校验。

#### `ReplaceCommandExecutor`（[replaceCommandExecutor.ts](file:///./src/services/replaceCommandExecutor.ts)）

工作流：查找原条目 → 查找候选 → preview 检查 → `replaceItem` → 校验 → 不通过则 `restoreSnapshot`。

#### `AtomicCapabilities`（[atomicCapabilities.ts](file:///./src/services/atomicCapabilities.ts)）

编排单基本操作能力，每操作自动快照。

- 原子操作：`appendItems` / `replaceItem` / `deleteItem` / `moveItem` / `updateField` / `batchDelete` / `clearAll` / `replaceAllItems`
- 快照：`createSnapshot` / `restoreSnapshot`
- `validateOrRollback`：操作后触发校验，未通过则回滚

### 6.4 候选选择

#### `CandidateService`（[candidateService.ts](file:///./src/services/candidateService.ts)）

候选节目库检索与排序。

- 检索链：`sourcePool` → `columnMatched` → `durationMatched` → `typeMatched` → `usageMatched` → `historyMatched` → `keywordMatched`
- 顺播策略 `sortSequentialCandidates`：基于历史+当前编排进度，按 `isAhead + distance` 排序
- 非顺播策略 `sortNonSequentialCandidates`：按 `selectionPolicy.primary`（rating/trending/content_match/default）切换
- 诊断输出 `rejectionReasons`：11 种拒绝原因

#### `CandidateSelectionService`（[candidateSelectionService.ts](file:///./src/services/candidateSelectionService.ts)）

候选选择三层架构：LLM + 本地守卫 + 编辑决策。

- `selectForInsert`：插入场景，候选唯一直接选中
- `selectForGap`：空窗场景，LLM 超时 8000ms
- 7 维度评分：content_match / duration_fit / rating / trend / sequence / type_fit / schedule_context
- `guardGapSelection`：硬关键词、时长、顺播、当前编排上下文守卫
- `CONTENT_MATCH_MIN_AUTO_SCORE = 70`、`CONTENT_MATCH_MIN_MATCHED_INTENT_KEYWORDS = 2`

#### `CandidateKeywordMatcher`（[candidateKeywordMatcher.ts](file:///./src/services/candidateKeywordMatcher.ts)）

5 层关键词体系：

| 层级 | 说明 | 示例 |
|------|------|------|
| specific（硬关键词） | 剥离通用/功能/时段/集数词后的具体内容 | 东方快报、潮童天下 |
| explicit_sequence | 显式集数 | 第X集/期 |
| editorial | 编辑型 | 栏目:X / 节目标题:X / 节目内容:X |
| functional | 功能型（21 个） | 预热/预告/导视/垫片/暖场 |
| soft | 软关键词 | 归一化通用匹配 |

#### `InsertCandidateResolver`（[insertCandidateResolver.ts](file:///./src/services/insertCandidateResolver.ts)）

插入候选解析，决定直接执行还是推荐列表。

- `DIRECT_EXECUTE_SCORE_THRESHOLD = 85`、`DIRECT_EXECUTE_SCORE_DELTA = 15`
- 结果：`resolved`（直接执行）/ `needs_recommendation`（推荐列表）/ `needs_clarification`（追问）

### 6.5 Agent Server 运行时

#### `AgentServerRuntime`（[agentServerRuntime.ts](file:///./src/services/runtime/agentServerRuntime.ts)）

服务端运行时核心类。

| 方法 | 说明 |
|------|------|
| `createSession` / `getSession` | 会话管理 |
| `submitInstruction` | 提交指令（构建上下文包 + formalPlaylistSnapshot + workspaceKey） |
| `executePendingCommand` | 执行待确认命令（经 ExecutionService + WriteAdapter） |
| `resolvePendingTargetSelection` | 解决目标选择 |
| `resolvePendingInsertRecommendation` | 解决插入推荐 |
| `stopReactTask` / `stopExecutionCheckpoint` | 停止长程任务 |
| `subscribeSessionEvents` | SSE 事件订阅 |

#### `FormalPlaylistWriteAdapter`（[formalPlaylistWriteAdapter.ts](file:///./src/services/runtime/formalPlaylistWriteAdapter.ts)）

正式播单写入边界，四层保护：

1. **Mutation policy 写屏障**：缺失 `mutationContext`、`preview_only`、`pending_only` 均在 delegate 前阻断
2. **幂等缓存**：按 `sessionId + workspaceKey + idempotencyKey` 隔离（status: applied/reused），切换播单后不复用上一工作区结果
3. **版本冲突阻断**：`formal_playlist_version_conflict`
4. **批量上限阻断**：`formal_playlist_batch_limit_exceeded`
- `metadata.boundary = 'formal-playlist-write-adapter'`，并以 `transport = 'local' | 'agent-server'` 区分调用通道

#### `AgentRuntimeClient`（[agentRuntimeClient.ts](file:///./src/services/runtime/agentRuntimeClient.ts)）

双模式客户端：

- `LocalAgentRuntimeClient`：直接调用 facade
- `HttpAgentRuntimeClient`：fetch 调 Agent Server，sessionStorage 存 sessionId，首次请求自动 bridge 本地 LLM 配置到服务端
- `resolveAgentRuntimeMode`：读 `VITE_AGENT_RUNTIME_MODE`

### 6.6 LLM 基础设施

#### `LLMClient`（[llmClient.ts](file:///./src/services/llm/llmClient.ts)）

OpenAI SDK 兼容客户端。

| 方法 | 说明 |
|------|------|
| `chat(messages, options)` | 同步聊天 |
| `chatStream` | 流式响应 |
| `testConnection` | 连接测试（maxTokens 10） |
| `updateConfig` | 更新配置 |
| `getTokenUsage` / `getRecentRequestTraces` | Token 与 Trace |

特性：重试（指数退避）、超时、Token 统计、请求追踪（保留最近 20 条）、浏览器 Mock（DEV 读 `window.__AIBIANDAN_LLM_MOCK__`）、`normalizeError`（401/429/5xx/ETIMEDOUT 翻译）。

#### `AgentPlanner`（[agentPlanner.ts](file:///./src/services/llm/agentPlanner.ts)）

Agent Planner，调用 LLM 编译多动作计划；当前 system prompt 版本为 `v1.13`，正式 ReAct 首批 `research_check` 必须由模型给出 2-6 个保留用户硬条件的受控查询；`formal_orchestration` 与正式 `commit_layout_draft` 必须同时返回顶层 `mode="react"` 和 `reactTask`。有限、可定位目标集合保持复合原子路径，覆盖整表/全部空窗/完整目标时长才进入正式长流程，所需草案不完整时先引导完善草案。轮播时长压缩先消解“减少 N 小时/压缩到 N 小时”歧义；完整队尾范围必须输出带范围与 `pending_only` 的 `batch_delete`，不得降成单条删除或直接正式写入；按策略整表压缩先调整目标时长一致的草案，禁止按平移处理或裁切节目。有顺序依赖的多动作由同一 ReAct task 逐轮执行，运行时完整保留 action，并在每轮 observation 后重新决定下一步；`create_playlist` 排在正式 action 前时先真实创建工作区，不能因后续正式 action 误报计划无效。前台恢复时旧未执行步骤标记为 `blocked/superseded`，自然语言确认则回到 planner，只有显式确认控件调用写入 API。

整表轮播压缩的草案观察后决定由 [demoRuntimeFacade.ts](file:///./src/services/runtime/demoRuntimeFacade.ts) 承接，prompt 版本为 `v1.1`：当前正式编单、当前草案与候选 observation 一并交给 LLM，响应只能是覆盖完整目标时长的 `prepare_layout_draft` / `refine_layout_draft`。合法 action 继续走 `LayoutDraftService` 与 validator，并标记 `noFormalPlaylistWrite`；无效 decide 以 `llm_decide_unavailable` 暴露，不回退本地评分。轮播 `replaceAll` 草案允许 coverage 收缩到新 segments，电视版面仍保留原 coverage 规则。

- `plan(input, deadline?)`：调 `llmClient.chat`（temperature 0.2, maxTokens 1100, maxRetries 1, traceLabel `agent_planner`），stage timeout 从共享 `AgentDeadline` 的剩余预算推导，并把 `AbortSignal` 传到底层请求。
- 输出 `AgentPlan`：`mode`（single/react）+ `actions`（10 种 type）+ `reactTask` + `assistantReplyDraft`
- 10 种动作：`create_playlist` / `prepare_layout_draft` / `refine_layout_draft` / `commit_layout_draft` / `formal_orchestration` / `atomic_command` / `read_only_analysis` / `research_check` / `validate` / `clarify`
- `formal_orchestration` 的 `mode` / `taskKind` / `useLayoutDraft` / `targetTimeRange` / `searchKeywords` 由 LLM action 直接给出并透传到 capability；本地只校验枚举、模式组合和字段结构，不从用户原话正则回填。缺失或冲突的必需语义会使 action 失效，并进入可恢复澄清路径。
- 顶层与 atomic `pendingAction` 都是结构化模型输出；同工作区 pending 只有 `start_new_task` / `cancel_pending` 等显式 action 才改变，不按用户文本自然过期。
- formal rebuild review 向 planner 透传原 `actionKind/mode/useLayoutDraft`；确认轮由 LLM 显式返回匹配动作和 `confirmExistingRebuild:true`，本地只做 pending 一致性校验，不从“确认”文本补字段。
- `assistantReplyDraft` 只提供流式进度或安全可见文案。没有有效执行 action 时，runtime 会阻断“已/将创建播单”及其他虚假执行承诺，保留 `noMutation` 现场并提示重试，不在本地补意图。
- “我先整理草案，再创建播单”等将来执行措辞同样受无 action 安全校验；这属于模型输出与执行事实的一致性保护，不是用户文本分类器。终态是否展示由 ChatPanel 的结构化消息元数据决定。

#### `loadLLMConfig`（[llmConfig.ts](file:///./src/services/llm/llmConfig.ts)）

LLM 配置多源加载优先级：

```
DEFAULT_CONFIG（SiliconFlow / DeepSeek-V4-Flash / temp 0.3 / maxTokens 8192）
  → localStorage('llm_config')
  → 共享 Cookie('llm_config_shared')
  → 运行时 env（VITE_CODE_PLAN_LLM_* > CODE_PLAN_LLM_* > AGENT_LLM_*）
```

---

## 7. 核心流程链路

### 7.1 对话命令从识别到执行的完整链路

```text
用户在 ChatPanel 输入自然语言
        │
        ▼
buildDialogueContext（构建对话上下文：scheduleState/currentSchedule/附近节目/时间提示）
        │
        ▼
意图识别（LLM-first 主路径）
  ├─ IntentRecognizer.recognize → 6 类（insert/move/delete/replace/unsupported/clarify）
  │   └─ LLM 失败 → buildUnusableModelIntent（confidence 0, type clarify），不做本地兜底
  ├─ LayoutIntentRecognizer.recognize → 6 种模式（prepare/refine/commit/analysis/atomic_fallback/clarify）
  └─ TaskClassifier.classify（遗留接口壳，LLM-only 后退化为默认）
        │
        ▼
参数提取 ParamExtractor.extract{Insert/Move/Delete/Replace}Params（LLM）
  └─ canAcceptLlmTargetTime：仅显式时间或指代词才接受 LLM 时间
        │
        ▼
命令构建与分发 ScheduleCommandBus.execute
  ├─ insert  → InsertCommandExecutor
  ├─ replace → ReplaceCommandExecutor
  └─ 其他    → CommandExecutor（plan/query_candidates/fill_item/repair/delete/move/update_field/clarification）
        │
        ▼
执行器内部
  ├─ InsertCommandExecutor：参数校验→获取候选→时间检查→顺播检查→物化→appendItems→校验
  └─ ReplaceCommandExecutor：查找原条目→查找候选→preview→replaceItem→校验→不通过 restoreSnapshot
        │
        ▼
AtomicCapabilities（每操作自动 createSnapshot，操作后 triggerValidation，未通过 validateOrRollback）
        │
        ▼
ValidationEngine（7 条规则）+ scheduleSequenceGuard（顺播保护）
        │
        ▼
失败处理
  ├─ FallbackManager：三级回退（条目级 snapshot/空窗级批量/会话级转人工）
  └─ RepairManager：有限轮次修补（最多 3 轮，LLM 生成修复命令）
```

### 7.2 编排引擎三阶段流水线

```text
createSession（初始化 PlanningSession + GapManager）
        │
        ▼
Phase 1 - 规划（phase1Planning）
  ├─ dataService.getGenerationContext 加载上下文
  ├─ 空窗初始化策略：
  │   ├─ 已有 items → calculateGapsFromItems + alignGapsToLayoutBands
  │   ├─ 无 items 有版面 → initializeFromLayoutBands
  │   └─ 无 items 无版面 → 抛错
  └─ LLM 生成 PlanCommand（全局策略），超时回退默认
        │
        ▼
Phase 2 - 填充（phase2Filling）
  ├─ collectPlanningBatch（顺播偏好强制并发 1）
  ├─ prepareBatchPlans（并行规划每个空窗）
  │   └─ prepareGapPlan：generateQueryCandidatesCommand → queryCandidates → generateFillItemCommand
  ├─ 顺序执行 executePreparedPlan：
  │   ├─ materializer.materialize 物化
  │   ├─ detectSelectedCandidateIntentMismatch（硬关键词命中检查）
  │   ├─ detectSelectedCandidateStrategyMismatch（策略首选检查）
  │   ├─ detectAppendConflict（时间冲突）
  │   ├─ detectAppendSequenceOrderViolation（顺播倒序/跳集）
  │   └─ atomicCapabilities.appendItems 写入
  ├─ fillRemainingGapsWithAds（广告补位，保护 hard_keyword_no_match）
  └─ 剩余空窗保留为 manual_review
        │
        ▼
Phase 3 - 修补（phase3Repair）
  ├─ validateSchedule
  ├─ 发出 validation-complete / repair-start / repair-complete 事件
  └─ resolveTerminalStatus：有剩余空窗/失败/校验不通过 → manual_review，否则 completed
```

### 7.3 Agent 服务端主流程

```text
POST /api/agent/submit
        │
        ▼
AgentServerRuntime.submitInstruction
  ├─ buildForegroundAgentContextPackage（7 种 scenario 注入）
  ├─ formalPlaylistSnapshot + workspaceKey
  ├─ attachServerPendingOwnership（给 pendingId 加 serverPendingId/serverOwned）
  ├─ runtime.submitInstruction
  └─ syncDecision（记录 decision/pending/react_task/execution_checkpoint 事件）
        │
        ▼
SchedulingAgentRuntime.submit
  ├─ buildInterpreterInput（buildAgentLlmContextPackage 按 TV/Rotation 区分）
  ├─ LlmAgentIntentInterpreter.interpret（LLM, temp 0）
  │   └─ LLM 失败不兜底，直接 failed
  ├─ CapabilityRegistry.resolveAll（唯一匹配）
  └─ AtomicCommandCapability.handle*
      ├─ ConstraintEngine.check*（约束）
      ├─ TvSequenceCandidateSelector（仅 TV 顺播）
      ├─ LlmAgentCandidateJudge.selectBestCandidate（LLM 决策）
      ├─ ProfessionalRules（11 条专业规则）
      ├─ AgentPlaylistPolicy.decideCommand（TV direct / Rotation confirm）
      └─ SchedulingDataGateway.commit（fingerprint 校验）
        │
        ▼
确认后 executePendingCommand
  ├─ AgentServerExecutionService.executePendingCommand
  ├─ FormalPlaylistWriteAdapter.execute（幂等/版本/批量保护）
  ├─ buildFormalPlaylistWriteArtifacts（计算下一状态 + Patch）
  └─ extractCheckpointFromDecision（4 种 checkpoint：waiting_continue/failed_retryable/blocked/completed）
        │
        ▼
AgentServerSessionStore 更新
  ├─ pendingCommand / pendingAtomicContext
  ├─ formalPlaylistSnapshot / formalPlaylistVersion
  ├─ activeReactTaskRun / activeExecutionCheckpoint
  ├─ materialEvidence（限 50 条）
  └─ eventLog（限 100 条）
```

### 7.4 版面草案工作流

```text
layout_prepare（草案生成）
  ├─ LayoutIntentRecognizer 识别 segments/semanticLabel/programTypeHint
  ├─ LayoutDraftService.generateSpec
  │   ├─ 有结构化 segments → buildSpecFromStructuredIntent
  │   └─ 否则 LLM 生成 LayoutDraftSpec（coverage + segments[]）
  ├─ LayoutDraftCompiler.compile → LayoutDraft（columns + slots）
  ├─ LayoutDraftValidator.validateDraft
  ├─ LayoutDraftFeasibilityService.previewFeasibility（ready/warning/blocked）
  ├─ evaluateLayoutDraftCompleteness（missing/empty/partial/complete）
  └─ runtimeLayoutRegistry.setRuntimeLayout 注册

layout_refine（草案微调）
  └─ LayoutDraftService.refineSpec
      ├─ 默认：单段或多段均按时间范围合并，保留未命中的既有时段并扩展 coverage
      └─ replaceAll=true：仅由 planner 的 ignoreExistingLayout=true 映射，整份替换现有 segments

layout_commit（草案提交）
  └─ 注册到 runtimeLayoutRegistry，作为正式编排依据

layout_analysis（版面分析）
  └─ LayoutAnalysisService.analyze（LLM 生成自然语言报告，失败回退 buildFallbackAnalysisText）

版面导入
  └─ LayoutImportService.importFile（3 种模板：visual_weekday_grid/weekday_columns/weekday_sheet）
```

### 7.5 电视播单与轮播单策略分流

策略分流贯穿 7 层：

| 层 | TV（时间格子） | Rotation（内容队列） |
|----|----------------|----------------------|
| LLM 上下文包 | 含 latestHistory/layoutBounds/blockedTimeRanges；time_grid | 不含；content_queue |
| Agent Playlist Policy | insert/replace direct_execute | confirm_before_commit |
| 约束引擎 | 版面边界/禁排/锁定 + 顺播倒序/跳集（中文集数） | 时长适配 |
| TV 顺播选择器 | 使用（today 优先，期望集数=max+1） | 不使用 |
| Runtime Playlist Policy | fixed_time_slot + preserve_slot + leave_gap + fixed_clock | continuous_sequence + compact_sequence + target/flexible_total_duration |
| Agent Planner Policy | 时间格子；精准原子命令不激活 ReAct | 内容队列；模糊命令可激活 ReAct |
| 前台工作区 key | `tv:channelId:date` | `rotation:strategy:duration` |

---

## 8. 项目运行方式

### 8.1 环境准备

- Node.js `^20.19.0` 或 `>=22.12.0`
- 安装依赖：`npm install`

### 8.2 开发模式

| 命令 | 说明 |
|------|------|
| `npm run dev` | 纯前端开发（Vite 默认） |
| `npm run dev:web` | 前端 + host 127.0.0.1 |
| `npm run dev:web:agent` | 前端 Agent 模式（VITE_AGENT_RUNTIME_MODE=http） |
| `npm run dev:web:lan` | 局域网可访问 |
| `npm run agent:server` | 启动 Agent Server（默认 3000 端口，内存会话） |
| `npm run agent:server:persist` | Agent Server + 文件会话持久化 |
| `npm run dev:agent` | **并行启动前端（agent 模式）+ Agent Server**（推荐） |
| `npm run dev:agent:persist` | 并行启动 + 文件持久化 |
| `npm run dev:lan` | 局域网并行启动 |
| `npm run agent:trial` | 办公网试用启动（spawn server + vite） |

### 8.3 构建

| 命令 | 说明 |
|------|------|
| `npm run build` | type-check + vite build（并行） |
| `npm run build-only` | 仅 vite build |
| `npm run type-check` | vue-tsc --build |
| `npm run preview` | vite preview |

### 8.4 Agent Server HTTP 端点

| 方法 | 路径 | 用途 |
|------|------|------|
| GET | `/health` | 健康检查 |
| GET | `/api/agent/status` | 运行时状态（migrationStep=goal-51-office-trial-hardening） |
| GET | `/api/agent/llm-config/status` | LLM 配置状态 |
| GET | `/api/agent/sessions/:sessionId` | 获取 session 公共状态 |
| GET | `/api/agent/sessions/:sessionId/events` | 事件流（SSE，`?follow=1` 长连接，15s heartbeat） |
| GET | `/api/agent/sessions/:sessionId/replay` | 回放包 |
| POST | `/api/agent/sessions` | 创建 session |
| POST | `/api/agent/submit` | 提交指令 |
| POST | `/api/agent/sessions/:sessionId/messages` | 追加消息 |
| POST | `/api/agent/pending/execute` | 执行待确认命令 |
| POST | `/api/agent/pending/target-selection` | 解决目标选择 |
| POST | `/api/agent/pending/insert-recommendation` | 解决插入推荐 |
| POST | `/api/agent/sessions/:sessionId/tasks/:taskId/continue` | 继续 ReAct 任务 |
| POST | `/api/agent/sessions/:sessionId/tasks/:taskId/stop` | 停止 ReAct 任务 |
| POST | `/api/agent/orchestration` | 执行正式 ReAct；POST 返回完整结果和补偿进度，实时进度由 session SSE 投影 |
| POST | `/api/agent/sessions/:sessionId/orchestration/recover` | 显式检查、继续、重试、缩小范围或取消正式 ReAct checkpoint |
| POST | `/api/agent/sessions/:sessionId/execution/stop` | 停止执行 checkpoint |
| POST | `/api/agent/llm-config/import` | 导入前台 LLM 配置 |

### 8.5 推荐启动顺序

1. 开发：`npm run dev:agent`（前端 + Agent Server 并行）
2. 访问 `http://localhost:5173`
3. 在 LLM 配置面板配置 API Key（http 模式下由服务端管理）
4. 健康检查：`npm run agent:health`

---

## 9. 测试与验证体系

### 9.1 测试命令

| 命令 | 说明 |
|------|------|
| `npm run test` | 运行全部 Vitest |
| `npm run test:watch` | watch 模式 |
| `npm run agent:check:tests` | Agent 编排链路指定测试清单（30+ 文件） |
| `npm run agent:check` | tests + build（Agent 编排链路强制门禁） |
| `npm run agent:browser:goal37` | Playwright 前台浏览器测试 |
| `npm run agent:browser:goal38` | Playwright 前台浏览器测试（Goal 38 可恢复失败重试） |
| `npm run agent:eval:llm` | 真实 LLM 评估 |
| `npm run agent:eval:llm:strict` | 严格真实 LLM 评估 |
| `npm run agent:health` | Agent Server 健康检查（11 项） |

### 9.2 测试配置

- 配置文件：[vitest.config.ts](file:///./vitest.config.ts)
- environment：`node`
- include：`src/**/__tests__/*.test.ts`
- clearMocks / restoreMocks：true
- 排除 openClaw 相关 3 个测试

### 9.3 测试覆盖范围

- **Agent 运行时**：`agentRuntimeClient` / `agentServerRuntime` / `agentServerEnvLoader` / `schedulingAgentRuntime.*`
- **意图与策略**：`intentRecognizer` / `agentLlmIntentEvaluation` / `agentPlaylistPolicy` / `runtimePlaylistPolicy`
- **候选与约束**：`candidateSelectionService` / `candidateService` / `candidateKeywordMatcher` / `candidateSelectionFallback` / `candidateSelectionInsertGuard`
- **原子命令**：`atomicOffsetParser` / `atomicCapabilities` / `atomicConversationScenarios` / `commandExecutor` / `insertCommandExecutor` / `replaceCommandExecutor`
- **编排**：`orchestrator` / `gapManager` / `layoutDraft*` / `layoutImportService` / `layoutAnalysisService`
- **前台**：`foregroundAgentFlow` / `foregroundAgentContextPackage` / `foregroundWorkspaceState` / `foregroundVisualTheme` / `useBroadcastPlanOrchestration`

### 9.4 Verification Gates（来自 AGENTS.md）

| 变化类型 | 验证方式 |
|----------|----------|
| 行为变化 | 运行相关 Vitest case |
| Agent 编排链路变化 | `npm run agent:check` |
| 前台可见交互变化 | 刷新 `http://localhost:5173`，浏览器真实冒烟 |
| 构建相关变化 | 项目构建检查 |

### 9.5 Lint

| 命令 | 说明 |
|------|------|
| `npm run lint` | oxlint + eslint（顺序） |
| `npm run lint:oxlint` | `oxlint . --fix` |
| `npm run lint:eslint` | `eslint . --fix --cache` |
| `npm run format` | `prettier --write src/` |

---

## 10. 配置与环境变量

### 10.1 TypeScript 配置

| 文件 | 说明 |
|------|------|
| [tsconfig.json](file:///./tsconfig.json) | 根，references 指向 app/node |
| [tsconfig.app.json](file:///./tsconfig.app.json) | extends `@vue/tsconfig/tsconfig.dom.json`；`noUncheckedIndexedAccess=true`；paths `@/*` → `./src/*` |
| [tsconfig.node.json](file:///./tsconfig.node.json) | extends `@tsconfig/node24`；module='preserve'；types=['node'] |

### 10.2 构建配置

- [vite.config.ts](file:///./vite.config.ts)：vue + vueDevTools 插件；alias `@` → `./src`
- [eslint.config.ts](file:///./eslint.config.ts)：defineConfigWithVueTs + pluginVue essential + vueTsConfigs.recommended + pluginOxlint + skipFormatting

### 10.3 环境变量

| 变量 | 作用 | 出处 |
|------|------|------|
| `VITE_AGENT_RUNTIME_MODE` | `local` / `http`，决定前台 runtime client | `.env.agent` |
| `VITE_AGENT_RUNTIME_BASE_URL` | http runtime base url，否则 `${hostname}:3000` | `agentRuntimeClient.ts` |
| `VITE_CODE_PLAN_LLM_BASE_URL` / `_API_KEY` / `_MODEL` | 浏览器端直连 LLM 配置（旧路径） | `.env.development` |
| `AGENT_LLM_BASE_URL` / `_API_KEY` / `_MODEL` | Agent Server 服务端 LLM 配置 | `agent-env.mjs` |
| `AGENT_SESSION_STORE_FILE` | session 持久化文件路径 | `agent-trial-start.mjs` |
| `RUN_AGENT_REAL_LLM_EVAL` / `_STRICT` | 真实 LLM 评估开关 | `agent-real-llm-eval-strict.mjs` |
| `PLAYWRIGHT_MODULE_PATH` / `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` | Playwright 自定义路径 | `foreground-browser-goal37.mjs` |

### 10.4 Agent env 加载顺序

`AGENT_ENV_FILES`（[agent-env.mjs](file:///./scripts/agent-env.mjs)）：

```
.env.agent.local → .env.agent → .env.local → .env.development → .env
```

不覆盖已存在的环境变量。

### 10.5 LLM 配置

默认配置（DEFAULT_CONFIG）：
- baseURL：SiliconFlow
- model：DeepSeek-V4-Flash
- temperature：0.3
- maxTokens：8192

多源加载优先级：DEFAULT_CONFIG → localStorage(`llm_config`) → 共享 Cookie(`llm_config_shared`) → 运行时 env。占位符 API Key 被 `isPlaceholderApiKey` 识别并跳过。

---

## 11. 当前状态与路线图

### 11.1 当前状态（基于代码现状；原 [docs/current-status.md](file:///./docs/archive/baseline/current-status.md) 已归档）

- 前端原型可运行、可构建、可演示
- 工程基线已建立（vue-tsc / eslint / vitest / vite build 通过）
- 当前阶段：**Goal 51 `office-trial-hardening`**（办公网试用硬化）
- 重点：Agent Server 服务端持有 LLM Key、session 持久化、ReAct 长程任务、正式播单写入边界

### 11.2 主要技术债（详见 [docs/agent-evolution-roadmap-proposal.md](file:///./docs/agent-evolution-roadmap-proposal.md) A1-A16 缺陷清单；原 [docs/tech-debt.md](file:///./docs/archive/baseline/tech-debt.md) 已归档）

| 编号 | 优先级 | 内容 |
|------|--------|------|
| TD-01 | P0 | 大文件：ChatPanel.vue（5222 行）、create.vue（2333 行）、orchestrator.ts |
| TD-02 | P0 | 浏览器端直连 LLM 旧路径仍存在（已被 Agent Server 覆盖为推荐路径） |
| TD-03 | P1 | mock 数据为主，缺乏真实接口对接 |
| TD-04 | P1 | 测试护栏需进一步补强 |
| TD-05 | P1 | 文档与代码同步滞后 |
| TD-06 | P2 | 构建产物清理 |

### 11.3 路线图（详见 [docs/agent-evolution-roadmap-proposal.md](file:///./docs/agent-evolution-roadmap-proposal.md) v2 修订版；原 [docs/roadmap.md](file:///./docs/archive/roadmap/roadmap.md) 已归档）

| 阶段 | 目标 |
|------|------|
| Phase A | 文档基线建立 |
| Phase B | 主流程减重（拆 ChatPanel.vue / create.vue / orchestrator.ts） |
| Phase C | 补核心缺口面板（对齐 F01-F09 / AC01-AC24） |
| Phase D | 数据闭环（替换 mock，接真实接口） |

### 11.4 关键设计原则（AGENTS.md 对齐）

1. **LLM-first / LLM-only 主路径**：开放自然语言理解必须保持 LLM 主路径；删除所有在 LLM 前后强行改写用户意图的本地逻辑。LLM 失败不兜底，直接暴露失败。
2. **本地逻辑只保护结果，不改写意图**：时间换算、写入校验、草案完整度判断、危险操作保护、正式播单与草案隔离、模型返回结构校验、执行边界和失败报错。
3. **原子命令与草案完整度解耦**：已打开播单时，明确的正式插入、删除、移动、替换不因草案为空/部分完成而转入草案或整体编排；缺少原子槽位时在 formal playlist owner 内追问或给候选。
4. **Pending 状态归属**：`AgentServerRuntime` 在保存/返回 pending 时补齐 owner、workspaceKey、mutationId、mutationPolicy，并在跨工作区时 fail closed。
3. **TV vs Rotation 双轨**：从 LLM 上下文包、约束引擎、候选选择器、策略表、任务计划编译、前台工作区、Planner policy 七层贯穿分流。
4. **删除敏感类豁免**：delete/batch_delete 在 TV 和 Rotation 均需 confirm_before_commit，不受"电视播单可直接执行"豁免。
5. **正式播单与草案隔离**：正式写入统一经过 `FormalPlaylistWriteAdapter`，metadata 以 `boundary='formal-playlist-write-adapter'` 标识边界、以 `transport` 区分 Local/Server；`refine_layout_draft` 只改草案；`commit_layout_draft` 才进入正式编排。
6. **幂等与版本保护**：FormalPlaylistWriteAdapter 幂等缓存、版本冲突阻断、批量上限阻断。
7. **Case First**：新增能力或修复缺陷时，优先把用户命令落到可执行 case，纳入 `npm run agent:check`。

---

## 12. 文档索引

> 登记仓库根目录、`docs/` 根目录的活跃文档及仍用于实现追溯的修复报告；已归档文件见 [docs/archive/ARCHIVED.md](file:///./docs/archive/ARCHIVED.md)。

| 文档 | 路径 | 核心内容 |
|------|------|----------|
| Agent 工作协议 | [AGENTS.md](file:///./AGENTS.md) | 强制工作协议、Scheduling Guardrails、Verification Gates |
| 开发协议 | [docs/agent-development-protocol.md](file:///./docs/agent-development-protocol.md) | Case 结构、Trace 结构、Verification Gates |
| 业务规则 | [docs/aibiandan-agent-rules.md](file:///./docs/aibiandan-agent-rules.md) | 工作区、播单策略、写入确认 |
| 命令清单 | [docs/scheduling-agent-natural-language-command-inventory.md](file:///./docs/scheduling-agent-natural-language-command-inventory.md) | 144 条自然语言命令 |
| 部署手册 | [docs/agent-deployment-runbook.md](file:///./docs/agent-deployment-runbook.md) | dev:agent / agent:trial / agent:health |
| 演进路线 | [docs/agent-evolution-roadmap-proposal.md](file:///./docs/agent-evolution-roadmap-proposal.md) | Agent 演进技术方案 v2 |
| 服务端迁移 | [docs/agent-server-migration-plan.md](file:///./docs/agent-server-migration-plan.md) | Goal 42-49 落地记录 |
| 方向 1 执行卡 | [docs/agent-direction-1-execution-card.md](file:///./docs/agent-direction-1-execution-card.md) | 方向 1 执行卡 |
| 九阶段计划 | `AGENTS.md` 与当前任务执行卡 | 当前唯一阶段依据；历史下一步方向草案已归档到 `docs/archive/plans/` |
| 九阶段后验收执行卡 | [docs/agent-post-nine-stage-acceptance-execution-card.md](file:///./docs/agent-post-nine-stage-acceptance-execution-card.md) | 真实复杂场景矩阵、黑盒状态核验与故障注入的执行依据 |
| Browser Goal 37 修复方案 | [docs/browser-goal37-fix-proposal.md](file:///./docs/browser-goal37-fix-proposal.md) | 浏览器自动化测试失败根因分析与最小修复方案 |
| Canonical 数据修复报告 | [docs/proposals/mock-data-audit-and-fix-proposal.md](file:///./docs/proposals/mock-data-audit-and-fix-proposal.md) | 节目库数据审计、修正结果与验证记录 |
| 无基线顺播修复报告 | [docs/proposals/no-baseline-earliest-episode-fix-proposal.md](file:///./docs/proposals/no-baseline-earliest-episode-fix-proposal.md) | 无历史基线时最早一期选择的根因、决策与验证记录 |
| 归档索引 | [docs/archive/ARCHIVED.md](file:///./docs/archive/ARCHIVED.md) | 历史归档文件索引与重新激活原则 |

---

> 本 Wiki 基于对项目约 120+ 个源文件的系统分析生成，覆盖项目整体架构、主要模块职责、关键类与函数说明、依赖关系以及项目运行方式。如需补充某模块的更深层实现细节，可定向阅读对应源文件。
