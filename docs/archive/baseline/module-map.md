# 模块地图

更新时间：2026-04-03

## 目的

这份文档只回答一个问题：  
“现在这些新拆出来的模块分别负责什么，后续改代码应该先去哪一层找？”

## 命名约定

当前 `broadcast-plan` 目录统一采用以下命名规则：

- `broadcastPlan*.ts`
  纯 helper、状态映射、结构转换模块
- `useBroadcastPlan*.ts`
  页面级 composable，负责接线、事件流和副作用
- `create.vue`
  页面容器，负责模板、局部页面状态和模块组合

`dialogue` 目录当前采用：

- `chatPanel*.ts`
  `ChatPanel.vue` 的拆分 helper
- `ChatPanel.vue`
  对话面板容器与剩余流程拼装逻辑

## broadcast-plan 目录

### 页面容器

- [create.vue](./src/views/broadcast-plan/create.vue)
  页面模板、局部视图状态、模块拼装入口

### 结构桥接

- [broadcastPlanScheduleBridge.ts](./src/views/broadcast-plan/broadcastPlanScheduleBridge.ts)
  页面条目、原子能力快照、ChatPanel 输入之间的转换桥

### 运行时状态

- [broadcastPlanGapState.ts](./src/views/broadcast-plan/broadcastPlanGapState.ts)
  空窗识别、运行时 gap 映射、gap 展示状态

- [broadcastPlanViewState.ts](./src/views/broadcast-plan/broadcastPlanViewState.ts)
  排序、版面参考映射、显示列表、计数类派生数据

- [broadcastPlanOrchestrationHelpers.ts](./src/views/broadcast-plan/broadcastPlanOrchestrationHelpers.ts)
  编排任务分类前的状态组装与局部补排判断

### 编辑辅助

- [broadcastPlanEditorHelpers.ts](./src/views/broadcast-plan/broadcastPlanEditorHelpers.ts)
  缺口默认值、保存前条目归一化、待插入条目修正

### 页面级 composable

- [useBroadcastPlanOrchestration.ts](./src/views/broadcast-plan/useBroadcastPlanOrchestration.ts)
  `useOrchestrator` 的页面接线、AI 编排启动/取消、ChatPanel 编排请求承接

- [useBroadcastPlanEditor.ts](./src/views/broadcast-plan/useBroadcastPlanEditor.ts)
  新增、编辑、删除、保存、缺口补齐创建和弹窗状态接线

## dialogue 目录

### 组件容器

- [ChatPanel.vue](./src/components/dialogue/ChatPanel.vue)
  对话面板模板、消息流和剩余解释拼装逻辑

### 拆分 helper

- [chatPanelFormatting.ts](./src/components/dialogue/chatPanelFormatting.ts)
  格式化、摘要文案、基础映射与细节序列化

- [chatPanelDetails.ts](./src/components/dialogue/chatPanelDetails.ts)
  候选对比、风险提炼、明细摘要等展示辅助

## 测试对应关系

当前这些拆分模块都有对应的最小测试护栏：

- [broadcastPlanScheduleBridge.test.ts](./src/views/broadcast-plan/__tests__/broadcastPlanScheduleBridge.test.ts)
- [broadcastPlanGapState.test.ts](./src/views/broadcast-plan/__tests__/broadcastPlanGapState.test.ts)
- [broadcastPlanViewState.test.ts](./src/views/broadcast-plan/__tests__/broadcastPlanViewState.test.ts)
- [broadcastPlanEditorHelpers.test.ts](./src/views/broadcast-plan/__tests__/broadcastPlanEditorHelpers.test.ts)
- [broadcastPlanOrchestrationHelpers.test.ts](./src/views/broadcast-plan/__tests__/broadcastPlanOrchestrationHelpers.test.ts)
- [chatPanelFormatting.test.ts](./src/components/dialogue/__tests__/chatPanelFormatting.test.ts)
- [chatPanelDetails.test.ts](./src/components/dialogue/__tests__/chatPanelDetails.test.ts)

## 后续修改建议

1. 先改 helper，再改 composable，最后才改页面容器
2. 纯数据映射优先放在 `broadcastPlan*.ts`
3. 有副作用、会调消息提示或命令总线的逻辑优先放在 `useBroadcastPlan*.ts`
4. 不要再把新业务判断直接堆回 `create.vue` 或 `ChatPanel.vue`
