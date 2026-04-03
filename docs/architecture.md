# 架构说明

更新时间：2026-04-03

## 文档目的

这份文档描述的是仓库当前真实存在的代码结构，不是目标态蓝图。

## 总体结构

当前项目可以概括成 5 层：

1. 页面容器层
2. 页面级状态与接线层
3. 对话与命令编排层
4. 编排执行与校验层
5. 数据与 mock 支撑层

简化后的关系如下：

```text
create.vue
  -> useBroadcastPlanEditor.ts
  -> useBroadcastPlanOrchestration.ts
  -> broadcastPlanScheduleBridge.ts
  -> broadcastPlanGapState.ts
  -> broadcastPlanViewState.ts
  -> ChatPanel.vue

ChatPanel.vue
  -> chatPanelFormatting.ts
  -> chatPanelDetails.ts
  -> commandExecutor.ts
  -> scheduleCommandBus.ts
  -> layoutImportService.ts
  -> llm/* 与意图识别链路

useOrchestrator.ts
  -> orchestrator.ts
    -> dataService.ts
    -> candidateService.ts
    -> gapManager.ts
    -> materializer.ts
    -> validators/validationEngine.ts
```

## 1. 页面容器层

核心文件：
- [create.vue](/C:/Users/sucongfei/Documents/trae_projects/bigbiandan2/src/views/broadcast-plan/create.vue)
- [ChatPanel.vue](/C:/Users/sucongfei/Documents/trae_projects/bigbiandan2/src/components/dialogue/ChatPanel.vue)

职责：
- 页面模板与视图布局
- 组件组合
- 局部交互状态
- 把页面级 helper/composable 接到模板上

说明：
- 这两份文件仍偏大，但已经完成第一轮拆分
- 当前更适合作为“容器文件”继续收口，而不是再往里堆新逻辑

## 2. 页面级状态与接线层

核心文件：
- [useBroadcastPlanEditor.ts](/C:/Users/sucongfei/Documents/trae_projects/bigbiandan2/src/views/broadcast-plan/useBroadcastPlanEditor.ts)
- [useBroadcastPlanOrchestration.ts](/C:/Users/sucongfei/Documents/trae_projects/bigbiandan2/src/views/broadcast-plan/useBroadcastPlanOrchestration.ts)
- [broadcastPlanScheduleBridge.ts](/C:/Users/sucongfei/Documents/trae_projects/bigbiandan2/src/views/broadcast-plan/broadcastPlanScheduleBridge.ts)
- [broadcastPlanGapState.ts](/C:/Users/sucongfei/Documents/trae_projects/bigbiandan2/src/views/broadcast-plan/broadcastPlanGapState.ts)
- [broadcastPlanViewState.ts](/C:/Users/sucongfei/Documents/trae_projects/bigbiandan2/src/views/broadcast-plan/broadcastPlanViewState.ts)
- [broadcastPlanEditorHelpers.ts](/C:/Users/sucongfei/Documents/trae_projects/bigbiandan2/src/views/broadcast-plan/broadcastPlanEditorHelpers.ts)
- [broadcastPlanOrchestrationHelpers.ts](/C:/Users/sucongfei/Documents/trae_projects/bigbiandan2/src/views/broadcast-plan/broadcastPlanOrchestrationHelpers.ts)

职责：
- 页面数据与原子能力之间的结构转换
- gap 识别与展示状态计算
- 列表投影与计数计算
- 编辑弹窗、保存、删除和插入接线
- 编排运行时启动、取消和状态回写

说明：
- 这是本轮治理新增的主要结构层
- 后续页面逻辑优先进入这一层，不应直接回堆到 `create.vue`

## 3. 对话与命令编排层

核心文件：
- [chatPanelFormatting.ts](/C:/Users/sucongfei/Documents/trae_projects/bigbiandan2/src/components/dialogue/chatPanelFormatting.ts)
- [chatPanelDetails.ts](/C:/Users/sucongfei/Documents/trae_projects/bigbiandan2/src/components/dialogue/chatPanelDetails.ts)
- [commandExecutor.ts](/C:/Users/sucongfei/Documents/trae_projects/bigbiandan2/src/services/commandExecutor.ts)
- [insertCommandExecutor.ts](/C:/Users/sucongfei/Documents/trae_projects/bigbiandan2/src/services/insertCommandExecutor.ts)
- [replaceCommandExecutor.ts](/C:/Users/sucongfei/Documents/trae_projects/bigbiandan2/src/services/replaceCommandExecutor.ts)
- [scheduleCommandBus.ts](/C:/Users/sucongfei/Documents/trae_projects/bigbiandan2/src/services/scheduleCommandBus.ts)

职责：
- 自然语言理解后的命令执行
- 候选展示、风险摘要、消息解释
- 版面导入、命令确认、局部修改

说明：
- `ChatPanel.vue` 仍保留部分解释拼装与日志摘要逻辑
- 后续继续拆分时，优先往 `chatPanel*.ts` helper 方向推进

## 4. 编排执行与校验层

核心文件：
- [useOrchestrator.ts](/C:/Users/sucongfei/Documents/trae_projects/bigbiandan2/src/composables/useOrchestrator.ts)
- [orchestrator.ts](/C:/Users/sucongfei/Documents/trae_projects/bigbiandan2/src/services/orchestrator.ts)
- [validationEngine.ts](/C:/Users/sucongfei/Documents/trae_projects/bigbiandan2/src/services/validators/validationEngine.ts)

职责：
- 编排会话、进度、日志、gap 处理
- 阶段化执行与校验
- 编排事件到页面状态的桥接

说明：
- `orchestrator.ts` 仍是当前最重的业务聚合点
- 如果下一轮继续治理，这里是最值得拆的服务层入口

## 5. 数据与 mock 支撑层

核心文件：
- [dataService.ts](/C:/Users/sucongfei/Documents/trae_projects/bigbiandan2/src/services/orchestration/dataService.ts)
- [candidateService.ts](/C:/Users/sucongfei/Documents/trae_projects/bigbiandan2/src/services/candidateService.ts)
- [layoutImportService.ts](/C:/Users/sucongfei/Documents/trae_projects/bigbiandan2/src/services/layoutImportService.ts)
- [runtimeLayoutRegistry.ts](/C:/Users/sucongfei/Documents/trae_projects/bigbiandan2/src/services/orchestration/runtimeLayoutRegistry.ts)
- [demoData.ts](/C:/Users/sucongfei/Documents/trae_projects/bigbiandan2/src/mock/demoData.ts)
- [orchestrationMock.ts](/C:/Users/sucongfei/Documents/trae_projects/bigbiandan2/src/mock/orchestrationMock.ts)

职责：
- 提供频道、候选节目、历史参考、版面上下文
- 管理导入版面和运行时版面
- 为编排与对话链路提供原型数据支撑

说明：
- 这一层仍然强依赖 mock
- 如果未来接真实后端，优先替换这一层

## 当前结构判断

当前架构已经从“单文件堆逻辑”进入“页面容器 + helper/composable + 服务层”的状态。  
这说明结构治理已经起效，但还没有到彻底稳定的时候。

当前最值得继续治理的方向是：

1. 继续拆 `ChatPanel.vue`
2. 继续拆 `orchestrator.ts`
3. 继续保持文档与命名同步

## 配套文档

- [docs/current-status.md](/C:/Users/sucongfei/Documents/trae_projects/bigbiandan2/docs/current-status.md)
- [docs/module-map.md](/C:/Users/sucongfei/Documents/trae_projects/bigbiandan2/docs/module-map.md)
- [docs/tech-debt.md](/C:/Users/sucongfei/Documents/trae_projects/bigbiandan2/docs/tech-debt.md)
