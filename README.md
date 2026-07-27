# bigbiandan-ui

广电节目串联单 AI 自动编排前端原型（包名 `bigbiandan-ui`，仓库目录 `aibiandan`）。

当前仓库基于 Vue 3、Vite、TypeScript、Element Plus 构建，聚焦一条完整演示链路：

- 串联单编辑
- AI 对话式微调
- AI 全量 / 局部编排
- 版面 Excel 导入
- 编排日志与校验反馈
- Agent Server（HTTP runtime）+ 服务端 LLM Key + 会话持久化

## 当前状态

- `vue-tsc --build`、`eslint . --cache`、`vite build` 已通过。
- 测试基线已建立，测试文件 100+，覆盖服务层、agent 链路、runtime、SSE 流式、候选检索重试、失败暴露等场景；最新规模请以 `npm run test -- --reporter=default` 实际输出为准。
- Agent Harness 强制工作协议见 [AGENTS.md](file:///./AGENTS.md)。
- 业务数据仍以 `src/mock/` 为主，演示型前端工程，不是生产化交付版本。

## 目录说明

```text
src/
  components/
    dialogue/                   对话面板及其拆分 helper
    llm/                         LLM 配置面板
    orchestration/               编排可视化组件
  composables/                  通用组合式逻辑
  mock/                         演示数据
  services/
    agent/                      Agent 核心（意图/能力/约束/候选评判/策略）
    runtime/                    前台 & 服务端运行时（会话/任务计划/写入边界）
    llm/                        LLM 基础设施（客户端/Prompt/解析/规划器）
    orchestration/             编排数据与接口分类
    validators/                 校验引擎
  types/                        领域类型
  views/broadcast-plan/         串联单主页面与页面级 helper/composable
docs/                           活跃文档（架构/状态/技术债/路线图等见下文）
  archive/                      历史归档文档（不再作为开发依据）
scripts/
  agent-server.mjs              Agent Server 入口
  agent-env.mjs                 env 加载与 LLM 配置持久化
  agent-health-check.mjs        健康检查
test-fixtures/                  测试夹具
test-results/                   测试产物（截图/JSON）
```

## 关键入口

- 页面入口：[create.vue](file:///./src/views/broadcast-plan/create.vue)
- 对话面板：[ChatPanel.vue](file:///./src/components/dialogue/ChatPanel.vue)
- Agent 总控 facade：[demoRuntimeFacade.ts](file:///./src/services/runtime/demoRuntimeFacade.ts)
- Agent 原子能力：[atomicCommandCapability.ts](file:///./src/services/agent/atomicCommandCapability.ts)
- Agent Server 入口：[agent-server.mjs](file:///./scripts/agent-server.mjs)

## 本地运行

建议使用 Node.js `20.19+` 或 `22.12+`。

```bash
npm install
npm run dev                 # 本地开发模式（local runtime）
npm run dev:agent            # 启动前台 + Agent Server（HTTP runtime，推荐）
npm run dev:lan              # 办公网试用（0.0.0.0）
npm run dev:agent:persist    # 启用文件 session store，支持跨重启恢复
npm run build
npm run test
npm run agent:check          # Agent 编排链路门禁
npm run agent:health         # Agent Server 健康检查
npm run agent:browser:goal37 # 前台浏览器回归（Goal 37）
npm run agent:browser:goal38 # 前台浏览器回归（Goal 38）
```

类型检查与 Lint：

```bash
cmd /c node_modules\.bin\vue-tsc.cmd --build
cmd /c node_modules\.bin\eslint.cmd . --cache
```

## LLM 配置

支持两类来源：

- 环境变量（推荐，配合 Agent Server）：`CODE_PLAN_LLM_API_KEY` / `AGENT_LLM_API_KEY` / `VITE_CODE_PLAN_LLM_BASE_URL` / `VITE_CODE_PLAN_LLM_MODEL`
- 浏览器本地存储：仅 `VITE_AGENT_RUNTIME_MODE=local` 时使用，由界面配置面板写入 `localStorage`

HTTP runtime 模式下，前台不再显示或保存 API Key，LLM Key 由服务端管理。

## 推荐阅读顺序

1. [AGENTS.md](file:///./AGENTS.md) — Agent Harness 强制工作协议
2. [docs/agent-development-protocol.md](file:///./docs/agent-development-protocol.md) — Agent Harness 开发规范
3. [docs/aibiandan-agent-rules.md](file:///./docs/aibiandan-agent-rules.md) — 业务规则与工程约束
4. [docs/code-wiki.md](file:///./docs/code-wiki.md) — 结构化技术文档（最新最全）
5. [docs/agent-evolution-roadmap-proposal.md](file:///./docs/agent-evolution-roadmap-proposal.md) — Agent 演进技术方案 v2
6. [docs/agent-server-migration-plan.md](file:///./docs/agent-server-migration-plan.md) — 服务端迁移落地记录
7. [docs/agent-deployment-runbook.md](file:///./docs/agent-deployment-runbook.md) — 部署与运维 runbook

历史归档文档见 [docs/archive/ARCHIVED.md](file:///./docs/archive/ARCHIVED.md)，归档文件不再作为开发依据。
