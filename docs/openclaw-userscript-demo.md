# OpenClaw 侧 Userscript 演示说明
更新时间：2026-04-07

## 定位

这份说明只服务于**纯前台演示阶段**。

对应脚本：

- [openclaw-demo-bridge.user.js](/C:/Users/sucongfei/Documents/trae_projects/bigbiandan2/public/openclaw-demo-bridge.user.js)

作用：

- 运行在 OpenClaw 聊天页
- 以纯前台方式把用户消息转发到 BigBiandan 原型页
- 不引入后台接口

## 脚本安装地址

如果你当前是用 Vite 本地开发服务启动本项目，脚本可直接从下面地址安装：

- `http://127.0.0.1:5173/openclaw-demo-bridge.user.js`

如果你的前端开发端口不是 `5173`，请把上面的端口替换成你实际启动的端口。

## 使用方式

1. 先打开 BigBiandan 原型页
2. 再打开 OpenClaw 聊天页
3. 在浏览器里通过 Userscript 管理器加载 `openclaw-demo-bridge.user.js`
4. OpenClaw 页面右下角会出现“BigBiandan 前台桥接”面板
5. 点击“打开原型页”完成握手
6. 后续可用两种方式发消息：
   - 点击脚本面板里的 `Submit`
   - 开启“自动转发”后，跟随回车键或发送按钮自动转发

## 一次联调的最小步骤

### 0. 前置条件

确认两个页面都能访问：

- BigBiandan 原型页，例如 `http://127.0.0.1:5173/broadcast-plan/create`
- OpenClaw 聊天页，例如 `http://127.0.0.1:18789/chat?session=agent%3Amain%3Amain`

### 1. 安装 userscript

在浏览器 userscript 管理器里打开：

- `http://127.0.0.1:5173/openclaw-demo-bridge.user.js`

完成安装后刷新 OpenClaw 聊天页。

### 2. 打开 OpenClaw 页面右下角桥接面板

刷新后，OpenClaw 页面右下角应出现：

- `BigBiandan 前台桥接`

如果没出现，优先检查：

- userscript 是否启用
- URL 是否命中 `http://127.0.0.1:18789/chat*`

### 3. 打开原型页并握手

在桥接面板里点击：

- `打开原型页`
- 再点一次 `Ping`

成功后桥接状态应变成：

- `原型页已握手`

### 4. 发第一条消息

在 OpenClaw 页面聊天框输入：

- `补齐当前空窗`

然后：

- 用桥接面板点击 `Submit`
- 或打开“自动转发”后直接按回车发送

### 5. 观察返回

如果链路打通，你会看到：

- OpenClaw 桥接面板里出现最近响应摘要
- 原型页侧边栏或节目单状态发生变化
- 如果命中确认流或目标选择流，可以继续在桥接面板点 `Confirm` 或 `Select`

## 典型演示话术

建议按下面顺序演示：

1. 在 OpenClaw 输入一句自然语言
2. 说明 OpenClaw 只负责发消息，不做业务理解
3. 通过桥接面板把消息转给 BigBiandan 原型
4. 由原型侧完成意图识别、编排或命令执行
5. 再把状态回到 OpenClaw 侧显示

## 常见问题

### 1. 点了 Submit 没反应

排查顺序：

1. 原型页是否已经打开
2. 是否先执行过 `Ping`
3. OpenClaw 页右下角桥接状态是否仍是“未连接”
4. 原型页地址是否填对

### 2. 自动转发没有触发

这是因为自动转发依赖对 OpenClaw 当前聊天输入框和发送按钮的前端识别。演示阶段可以接受，但如果识别不到，直接用桥接面板里的 `Submit` 即可。

### 3. Confirm / Select 失败

通常说明当前会话里没有待确认命令或待选择目标。先用 `GetState` 看一下当前会话状态，再决定后续动作。

## 当前脚本能力

- `Ping`
- `Submit`
- `GetState`
- `Confirm`
- `Select`
- `Cancel`

## 注意事项

1. 这是演示脚本，不是正式集成插件
2. 默认原型页地址是 `http://127.0.0.1:5173/broadcast-plan/create`
3. 如果你的原型页地址不同，需要在脚本面板里修改
4. 自动转发依赖对 OpenClaw 聊天输入框和发送按钮的前端识别，适合演示，不保证长期稳定

## 一句话结论

这套 userscript 是“从 OpenClaw 侧发起”的纯前台演示桥接脚本，用来验证 OpenClaw 发消息、本项目原型负责识别和执行这条链路。
