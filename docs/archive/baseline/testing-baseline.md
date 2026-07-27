# 测试基线

更新时间：2026-04-03

## 目标

当前项目仍处于原型治理阶段，测试基线的目标不是追求高覆盖率，而是先给核心服务层和新拆分模块建立可重复执行的自动验证护栏，支撑后续重构与迭代。

## 当前基线

- 测试框架：`Vitest`
- 入口命令：`npm run test`
- 观察模式：`npm run test:watch`
- 测试目录：`src/**/__tests__/*.test.ts`

## 当前覆盖范围

### 服务层

- `validationEngine`
- `candidateService`
- `atomicCapabilities`
- `commandExecutor`
- `layoutImportService`
- `orchestrator`

### 页面拆分 helper

- `broadcastPlanScheduleBridge`
- `broadcastPlanGapState`
- `broadcastPlanViewState`
- `broadcastPlanEditorHelpers`
- `broadcastPlanOrchestrationHelpers`
- `chatPanelFormatting`
- `chatPanelDetails`

## 当前规模

- 测试文件数：13
- 用例数：57

## 暂未覆盖

- `create.vue` 组件交互
- `ChatPanel.vue` 组件交互
- 端到端场景
- 更深的编排主链路集成测试

## 建议的下一步

1. 补关键组件交互测试
2. 增加更深的 `orchestrator` 场景测试
3. 为高风险用户路径补端到端回归
