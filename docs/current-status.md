# 当前项目状态

更新时间：2026-04-03

## 一句话结论

这是一个可运行、可构建、可演示的广电串联单 AI 编排前端原型，当前已经具备稳定的工程基线，但业务数据仍以 mock 为主，距离生产化仍有明显距离。

## 当前确认的工程状态

### 1. 工程基线

- `vue-tsc --build` 已通过
- `eslint . --cache` 已通过
- `npm run test` 已通过
- `vite build` 已通过

说明：
- 在受限沙箱或部分 Windows 环境里，`vite`/`npm-run-all` 相关命令可能出现 `spawn EPERM`
- 这类问题已经确认主要是环境限制，不代表仓库本身无法构建

### 2. 测试状态

- 已建立 `Vitest` 测试基线
- 当前已有 13 个测试文件、57 个用例
- 已覆盖服务层、导入链路、部分页面辅助逻辑和结构拆分出的 helper

已覆盖的主要范围：
- `validationEngine`
- `candidateService`
- `atomicCapabilities`
- `commandExecutor`
- `layoutImportService`
- `orchestrator`
- `ChatPanel` 拆分出的 formatting/details helper
- `broadcast-plan` 拆分出的 bridge/gap/view/editor/orchestration helper

暂未覆盖的范围：
- `ChatPanel.vue` 与 `create.vue` 的组件交互测试
- 端到端测试
- 复杂编排链路的深场景回归

### 3. 代码结构状态

当前两块大文件已经完成第一轮拆分，不再是“所有逻辑都塞在单文件里”的状态。

`src/views/broadcast-plan/` 当前已拆出：
- `broadcastPlanScheduleBridge.ts`
- `broadcastPlanGapState.ts`
- `broadcastPlanViewState.ts`
- `broadcastPlanEditorHelpers.ts`
- `broadcastPlanOrchestrationHelpers.ts`
- `useBroadcastPlanEditor.ts`
- `useBroadcastPlanOrchestration.ts`

`src/components/dialogue/` 当前已拆出：
- `chatPanelFormatting.ts`
- `chatPanelDetails.ts`

说明：
- 页面主文件仍然存在，但职责已经开始分层
- 目前更接近“页面容器 + helper/composable”的结构，而不是“单文件堆满所有逻辑”

## 当前功能落地情况

### 已实现或已可稳定演示

- 串联单编辑主页面
- 频道与日期切换
- 节目项新增、编辑、删除
- AI 对话式微调
- AI 全量/局部编排主流程
- 编排日志与运行状态同步
- Excel 版面导入
- 基础校验链路

### 已实现但仍偏原型态

- 候选节目检索与选择
- 历史参考、版面参考、上下文装配
- 浏览器端 LLM 配置与调用
- 前端内存态的编排状态管理

### 仍未落地或未形成闭环

- 真实后端数据接入
- 导出与历史归档闭环
- 更完整的校验报告页/验收页
- 端到端自动化回归体系

## 当前真实边界

- 核心数据仍主要来自 `src/mock/`
- 页面与编排主链路已经能跑，但不是生产数据流
- 浏览器端仍直接持有和使用 LLM 配置
- `orchestrator.ts` 仍然是较重的业务聚合点

## 当前主要风险

### 1. 仍有大文件

- [ChatPanel.vue](/C:/Users/sucongfei/Documents/trae_projects/bigbiandan2/src/components/dialogue/ChatPanel.vue)
- [create.vue](/C:/Users/sucongfei/Documents/trae_projects/bigbiandan2/src/views/broadcast-plan/create.vue)
- [orchestrator.ts](/C:/Users/sucongfei/Documents/trae_projects/bigbiandan2/src/services/orchestrator.ts)

虽然已经拆出第一轮辅助模块，但主文件本体仍偏大，后续继续迭代时仍有维护压力。

### 2. 业务边界仍偏原型

- mock 数据仍是主数据源
- LLM 仍在浏览器端直连
- 数据持久化、权限、多人协作边界还没有进入真实实现

### 3. 测试还不是“完整护栏”

虽然现在已经有测试基线，但它主要保护核心服务与新拆分 helper，不代表页面交互和整条用户链路已经被完整覆盖。

## 推荐的下一步

1. 继续拆 `ChatPanel.vue` 剩余的解释拼装与日志摘要逻辑
2. 继续拆 `orchestrator.ts` 的聚合职责
3. 把这轮新模块的职责文档化并保持命名一致
4. 逐步补关键组件交互测试
5. 明确 mock 原型与真实后端接入的边界
