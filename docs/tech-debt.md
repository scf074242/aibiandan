# 技术债台账

更新时间：2026-04-03

## 当前判断

项目最危险的阶段已经过去了一部分：`lint`、类型检查和最小测试基线都已经打通，`create.vue` 与 `ChatPanel.vue` 也完成了第一轮拆分。  
当前技术债的重点，已经从“没有护栏”转成“结构还不够彻底、原型边界仍然偏重”。

## 当前主要技术债

### TD-01 大文件仍然偏重

涉及文件：
- [ChatPanel.vue](/C:/Users/sucongfei/Documents/trae_projects/bigbiandan2/src/components/dialogue/ChatPanel.vue)
- [create.vue](/C:/Users/sucongfei/Documents/trae_projects/bigbiandan2/src/views/broadcast-plan/create.vue)
- [orchestrator.ts](/C:/Users/sucongfei/Documents/trae_projects/bigbiandan2/src/services/orchestrator.ts)

现状：
- `create.vue` 和 `ChatPanel.vue` 已经拆出第一轮 helper/composable
- 但主文件仍然承担页面容器和部分业务拼装职责
- `orchestrator.ts` 仍是最重的业务聚合点

优先级：P0

### TD-02 浏览器端直连 LLM

涉及文件：
- [llmClient.ts](/C:/Users/sucongfei/Documents/trae_projects/bigbiandan2/src/services/llm/llmClient.ts)
- [llmConfig.ts](/C:/Users/sucongfei/Documents/trae_projects/bigbiandan2/src/services/llm/llmConfig.ts)

现状：
- 仍存在浏览器端模型调用
- 仍依赖本地存储配置
- 适合原型演示，不适合生产

优先级：P0

### TD-03 数据边界仍偏 mock

涉及文件：
- [demoData.ts](/C:/Users/sucongfei/Documents/trae_projects/bigbiandan2/src/mock/demoData.ts)
- [orchestrationMock.ts](/C:/Users/sucongfei/Documents/trae_projects/bigbiandan2/src/mock/orchestrationMock.ts)
- [dataService.ts](/C:/Users/sucongfei/Documents/trae_projects/bigbiandan2/src/services/orchestration/dataService.ts)

现状：
- 主链路可以演示，但仍不是生产级数据流
- 很多边界条件还没有经过真实数据校验

优先级：P1

### TD-04 测试基线已建立，但组件护栏仍薄

现状：
- 已有 13 个测试文件、57 个用例
- 已覆盖服务层和拆分后的多组 helper
- 仍缺少关键页面交互测试和端到端回归

说明：
- “测试完全缺失”这条债已经不成立
- 现在的问题是“测试有了，但还不够覆盖 UI 行为”

优先级：P1

### TD-05 文档状态需要持续同步

现状：
- 旧文档里关于 lint 未通过、没有测试、尚未拆分的描述已经过时
- 如果后续不持续同步，文档很容易再次误导开发

优先级：P1

### TD-06 构建产物仍偏大

现状：
- 构建已通过
- 但仍存在 chunk 体积告警

优先级：P2

## 已清理的历史债

以下问题已不再应被当作“当前状态”描述：

- `eslint` 113 个错误
- 仓库完全没有自动化测试
- `create.vue` / `ChatPanel.vue` 完全未拆分

这些问题已经完成第一轮治理，后续文档与沟通不应再沿用旧说法。

## 推荐治理顺序

1. 继续拆 `ChatPanel.vue`
2. 继续拆 `orchestrator.ts`
3. 补关键组件交互测试
4. 收口文档和模块命名
5. 明确 mock 到真实数据服务的迁移边界
