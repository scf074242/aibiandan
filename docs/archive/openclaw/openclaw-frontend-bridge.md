# OpenClaw 前端桥接方案
更新时间：2026-04-07

## 文档定位

这份文档描述的是**当前实施中的纯前台演示方案**。

它的目标不是正式集成 OpenClaw，而是在不引入后台接口、不引入 Gateway 插件、不引入独立服务进程的前提下，验证下面这条边界：

- `OpenClaw` 只负责发出自然语言消息
- 本项目原型负责全部节目编排意图识别与执行

这份文档对应的是**当前可继续推进的实施路径**。

不适用范围：

- 不作为正式交付架构
- 不作为 OpenClaw 官方推荐集成方式
- 不作为后续生产化接入方案

未来正式化方向请看：

- [openclaw-formal-integration.md](./docs/openclaw-formal-integration.md)

## 1. 适用前提

仅在以下前提同时成立时使用本方案：

1. 当前阶段坚持纯前台演示
2. 不新增后台接口
3. 不做 OpenClaw Gateway Plugin / Hook
4. 允许使用前端页面间通信或前端内桥接模块

如果上述前提变化，这份文档就不再是主路径。

## 2. 核心结论

当前演示阶段采用：

```text
OpenClaw
  -> 前端消息桥接
  -> OpenClawBridge
  -> DemoRuntimeFacade
  -> Orchestrator / ScheduleCommandBus / AtomicCapabilities
  -> 页面更新与结果展示
```

也就是说：

- `OpenClaw` 不理解编单业务
- 本项目仍然是唯一业务运行时
- 页面桥接只负责把原始消息送进运行时，并回传状态

## 3. 职责边界

### 3.1 OpenClaw

负责：

- 接收用户输入
- 发送原始自然语言消息
- 展示返回结果

不负责：

- 任务分类
- 编排理解
- 命令生成
- 节目单状态维护

### 3.2 前端桥接层

负责：

- 接收来自 OpenClaw 的原始消息
- 维护 `conversationId -> runtime session` 映射
- 转发确认、目标选择、取消等动作
- 回推状态给 OpenClaw

不负责：

- 节目编排业务判断
- 命令决策
- 页面业务逻辑

### 3.3 本项目运行时

负责：

- 任务判别
- 意图识别
- 编排执行
- 命令执行
- 原子状态更新

## 4. 当前已落地的模块

当前演示方案已经具备以下模块：

- [demoRuntimeFacade.ts](./src/services/runtime/demoRuntimeFacade.ts)
- [runtimeSessionStore.ts](./src/services/runtime/runtimeSessionStore.ts)
- [openClawBridge.ts](./src/services/openclaw/openClawBridge.ts)
- [openClawHostAdapter.ts](./src/services/openclaw/openClawHostAdapter.ts)

页面侧接入点：

- [ChatPanel.vue](./src/components/dialogue/ChatPanel.vue)
- [create.vue](./src/views/broadcast-plan/create.vue)
- [useBroadcastPlanOrchestration.ts](./src/views/broadcast-plan/useBroadcastPlanOrchestration.ts)

## 5. 当前消息协议

当前前端桥接层支持的消息类型：

- `bigbiandan.ping`
- `bigbiandan.submit`
- `bigbiandan.confirm`
- `bigbiandan.selectTarget`
- `bigbiandan.cancel`
- `bigbiandan.getState`

回传类型：

- `bigbiandan.ready`
- `bigbiandan.result`
- `bigbiandan.state`
- `bigbiandan.orchestration`
- `bigbiandan.error`

这个协议的用途是：

- 做前台联调
- 模拟 OpenClaw 外部接入
- 验证业务运行时边界

不是正式交付协议。

## 6. 当前实施口径

当前团队应统一按下面这句话理解：

**这是一个纯前台演示方案，不是 OpenClaw 正式集成方案。**

进一步说：

- 可以继续写前端桥接代码
- 可以继续用它联调现有 OpenClaw
- 但不能把它描述为官方推荐接法
- 不能把它作为后续生产化承诺

## 7. 风险与限制

### 7.1 它依赖前端页面通信

这意味着：

- 更适合演示环境
- 更不适合长期稳定集成

### 7.2 它不是 OpenClaw 官方推荐扩展路径

所以：

- 可以演示
- 不应包装成正式接入结论

### 7.3 它仍然依赖当前原型页面运行

所以：

- 当前业务运行时仍偏页面原型形态
- 还没有演进到正式宿主级集成形态

## 8. 后续建议

当前阶段继续按这份文档推进时，建议只做两类事情：

1. 继续完善前端桥接联调体验
2. 继续把本项目业务运行时从页面组件里抽干净

不建议在纯前台阶段做的事情：

1. 把它包装成正式 OpenClaw 插件
2. 把它包装成 Gateway 官方接入
3. 把它包装成生产可交付架构

## 9. 一句话结论

这份文档对应的是“纯前台演示阶段的 OpenClaw 页面桥接方案”。当前可以继续实施，但它的定位仅限演示，不代表正式集成方向。
