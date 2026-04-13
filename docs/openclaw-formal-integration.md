# OpenClaw 正式集成预研方案
更新时间：2026-04-07

## 文档定位

这份文档描述的是**未来正式开发阶段的预研方向**。

它当前的定位是：

- 预研文档
- 未来架构参考
- 非当前实施路径

它不是：

- 当前阶段要落地的方案
- 当前纯前台演示的工作依据
- 当前版本的交付口径

当前实施中的演示方案请看：

- [openclaw-frontend-bridge.md](/C:/Users/sucongfei/Documents/trae_projects/bigbiandan2/docs/openclaw-frontend-bridge.md)

## 1. 结论

如果未来不再坚持“纯前台演示”，而是转向正式开发与可维护集成，那么推荐采用：

```text
OpenClaw Channel / Dashboard
  -> OpenClaw Gateway Plugin / Hook
  -> 本项目业务运行时模块
  -> 执行结果与会话状态回写
  -> OpenClaw 展示
  -> 页面订阅同一运行时状态
```

这意味着：

- `OpenClaw` 仍然不承担节目编排业务理解
- 本项目仍然负责意图识别与编排执行
- 但对接点不再是前端页面，而是 `OpenClaw Gateway Plugin / Hook`

## 2. 为什么这份文档不是当前主路径

因为当前项目已经明确选择：

- 先坚持纯前台演示
- 不引入后台接口
- 不引入 Gateway 插件
- 不引入宿主级正式集成

所以这份文档只做提前收口，避免以后团队重复争论“正式集成该怎么做”。

## 3. 为什么未来正式方案不应继续使用页面桥接

未来正式化时，不建议继续依赖：

- Dashboard 页面注入
- 用户脚本修改聊天页
- 纯浏览器 `postMessage` 作为正式集成链路

原因：

1. 这类方案依赖前端页面结构
2. 不符合 OpenClaw 官方扩展边界
3. 可维护性差
4. 不利于交付稳定性

所以正式阶段应把集成点上移到 Gateway 扩展层。

## 4. 正式方案的职责划分

### 4.1 OpenClaw

负责：

- 接收用户消息
- 管理会话
- 展示结果

不负责：

- 节目编排理解
- 命令生成
- 页面状态逻辑

### 4.2 OpenClaw Gateway Plugin / Hook

负责：

- 捕获 OpenClaw 消息生命周期事件
- 调用本项目运行时模块
- 管理 `openclawConversationId -> runtimeSessionId`
- 回写结果和状态

不负责：

- 节目编排业务判断
- 具体命令推理

### 4.3 本项目业务运行时

负责：

- 任务分类
- 意图识别
- 编排执行
- 命令执行
- 原子状态更新

## 5. 当前仓库可复用的业务基础

未来正式化时，可继续复用当前仓库中这些模块：

- [taskClassifier.ts](/C:/Users/sucongfei/Documents/trae_projects/bigbiandan2/src/services/llm/taskClassifier.ts)
- [intentRecognizer.ts](/C:/Users/sucongfei/Documents/trae_projects/bigbiandan2/src/services/intentRecognizer.ts)
- [demoRuntimeFacade.ts](/C:/Users/sucongfei/Documents/trae_projects/bigbiandan2/src/services/runtime/demoRuntimeFacade.ts)
- [runtimeSessionStore.ts](/C:/Users/sucongfei/Documents/trae_projects/bigbiandan2/src/services/runtime/runtimeSessionStore.ts)
- [scheduleCommandBus.ts](/C:/Users/sucongfei/Documents/trae_projects/bigbiandan2/src/services/scheduleCommandBus.ts)
- [orchestrator.ts](/C:/Users/sucongfei/Documents/trae_projects/bigbiandan2/src/services/orchestrator.ts)
- [atomicCapabilities.ts](/C:/Users/sucongfei/Documents/trae_projects/bigbiandan2/src/services/atomicCapabilities.ts)

## 6. 未来需要补的能力

### 6.1 把运行时进一步从页面里解耦

未来正式方案要求：

- 运行时不依赖 Vue 页面组件即可被调用
- OpenClaw 插件侧可以直接驱动业务运行时

### 6.2 把“启动编排”从页面接线中下沉

当前编排启动仍有页面接线痕迹，未来需要把这部分下沉为真正的运行时服务入口。

### 6.3 降低全局单例耦合

未来建议逐步演进到按会话或按频道/日期隔离的运行时容器。

## 7. OpenClaw 侧未来需要的配置

未来正式方案需要的是：

1. 插件启用配置
2. Hook 注册配置
3. 插件 allowlist 配置

也就是说，未来真正进入正式集成时，OpenClaw 内需要的是**插件级配置**，而不是聊天页脚本配置。

## 8. 当前团队应如何使用这份文档

当前只能把它当作：

- 架构预研
- 未来方向
- 需求变更后的迁移参考

当前不应据此启动：

- Gateway 插件开发
- Hook 对接开发
- 正式交付口径变更

除非项目明确从“纯前台演示”切换到“正式可集成架构”。

## 9. 一句话结论

这份文档描述的是未来正式化时应采用的 OpenClaw 集成方向，不是当前纯前台演示阶段的实施依据。
