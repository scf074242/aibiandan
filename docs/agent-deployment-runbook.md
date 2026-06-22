# AI编审助手部署与办公网试用说明

## 目标

让 AI编审助手可以从本机开发逐步走向办公网试用和长期运行。前台仍然是 `ChatPanel / broadcast-plan`，Agent Server 负责上下文、LLM、ReAct 状态、正式写入边界、事件流、素材证据和后续批量恢复。

## 本机启动

```bash
npm run dev:agent
```

如果希望重启服务后仍保留会话、正式播单快照、事件和素材证据，使用持久化启动：

```bash
npm run dev:agent:persist
```

默认地址：

- 前台页面：`http://127.0.0.1:5173`
- Agent Server：`http://127.0.0.1:3000`

## 办公网试用

```bash
npm run dev:lan
```

这会把前台和 Agent Server 绑定到 `0.0.0.0`。同一办公网内其他人可以访问这台机器的局域网 IP。

需要保留试用过程时，使用：

```bash
npm run dev:lan:persist
```

试用前确认：

- Windows 防火墙允许对应端口访问。
- 浏览器访问的是前台地址，不是 Agent Server 地址。
- 如果前台要走 HTTP runtime，需要配置 `VITE_AGENT_RUNTIME_MODE=http` 和 `VITE_AGENT_RUNTIME_BASE_URL`。

## 健康检查

```bash
npm run agent:health
```

指定地址：

```bash
npm run agent:health -- --url=http://127.0.0.1:3000
```

检查项：

- `/health`：服务是否存活。
- `/api/agent/status`：迁移阶段、服务端职责、事件流入口、可用 API 和 `sessionPersistence`。

`sessionPersistence` 为 `file` 表示已经启用文件持久化；为 `memory` 表示本次启动仍是内存态，重启会丢失 session。

## 长期运行建议

当前阶段可以先用系统进程管理工具托管：

- Windows：任务计划程序、PowerShell 后台任务或 NSSM。
- Linux：systemd、pm2 或容器。

长期运行时建议：

- API Key 只放在服务端环境变量里，不放浏览器。
- 每个试用用户独立 session，避免互相污染。
- 打开服务日志，保留健康检查结果。
- 使用 `npm run agent:server:persist` 或设置 `AGENT_SESSION_STORE_FILE=.agent-state/sessions.json`，让会话和正式播单状态可恢复。
- 限制办公网入口，不直接暴露公网。

## 性能迁移方向

前后台分开后，性能优化目标不是只换部署位置，而是把浏览器里的重活迁走：

- LLM prompt 构建和调用由服务端负责。
- ReAct 长程任务由服务端持续推进。
- 素材查证和候选证据由服务端记录。
- 正式播单写入、幂等、版本冲突和批量恢复由服务端控制。
- 前台只展示自然语言回复、弱系统过程、pending、进度和最终播单结果。

## 当前阶段边界

这里的“已经迁移”指服务端协议和运行边界已经具备，不表示完整商用级服务端化已经结束。

已经迁移：

- 服务端上下文重建。
- 服务端 ReAct task session。
- HTTP runtime client。
- 正式写入边界、幂等和版本元数据。
- 正式播单快照、版本检查和 patch 闭环。
- 事件流 `GET /api/agent/sessions/:sessionId/events?follow=1`。
- 素材证据事件记录。
- 可选文件持久化 session store，可保存 session、正式播单快照、事件和素材证据。

仍是渐进迁移：

- 旧原子命令执行器仍被复用。
- 未配置 `--session-store` 时仍是内存态。
- 服务端数据层和持久化审计日志尚未接入数据库。
