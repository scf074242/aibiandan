# Agent Development Protocol

本文档把 Agent Harness 开发规范落成仓库内可执行流程。目标是让每次优化都能从用户意图进入 case、trace、实现和验证，而不是只靠临场判断。

注意：这里的 Agent Harness 是 aibiandan 项目内部工程方法，不是官方外部 skill，也不是已经筛选完成的通用标准。业务规则、工程边界和外部 skill 筛选结果见 `docs/aibiandan-agent-rules.md`。

## 1. Intake

开始前先写执行卡：

- 问题：用户命令、截图或现象中暴露的具体问题。
- 期望：正确结果必须能被页面、测试或导出文件验证。
- 前置数据：节目库、版面、当前编排单、历史编排、频道、日期、上下文状态。
- 风险：分类误判、候选误命中、顺播跳跃、时间冲突、上下文误续、字段缺失。
- 验证：命中的已有 case、新增 case、测试命令、浏览器验证。

禁止跳过执行卡，直接凭规则猜测改代码。

## 2. Case

最小 case 结构：

```json
{
  "id": "atomic-move-forward-hour",
  "category": "atomic_intent",
  "userInput": "把9点的节目向后移动1小时",
  "initialSchedule": [],
  "layoutContext": null,
  "programLibraryExpectation": "not_required",
  "expectedDecision": {},
  "expectedSchedule": [],
  "mustNotHappen": [],
  "verification": []
}
```

字段含义：

- `id`：稳定唯一标识。
- `category`：如 `atomic_intent`、`layout_draft`、`layout_to_schedule`、`context_management`、`special_combo`。
- `userInput`：用户真实或模拟自然语言命令。
- `initialSchedule`：执行前编排单状态。
- `layoutContext`：版面草案、频道策略、时段、栏目、关键词和历史上下文。
- `programLibraryExpectation`：节目库应存在、应不存在、应返回候选或无需检索。
- `expectedDecision`：分类、草案、候选选择、执行或拒绝的预期。
- `expectedSchedule`：最终编排单状态。
- `mustNotHappen`：明确禁止的结果。
- `verification`：自动化测试、浏览器步骤或人工审查点。

## 3. Trace

最小 trace 结构：

```json
{
  "classification": {},
  "draft": {},
  "retrieval": {},
  "candidateSummary": [],
  "selectionReasoning": "",
  "finalSchedule": [],
  "validationReport": {}
}
```

trace 必须能回答：命令被分到哪里、草案如何生成、检索条件是什么、候选为何被选中或拒绝、最终编排是否满足约束。

## 4. Implementation

实现顺序：

1. 先定位当前链路：分类器、草案、检索、候选选择、runtime 执行、UI 状态。
2. 先补或确认 case。
3. 用最小改动修正链路。
4. 若涉及 LLM，提示词必须明确“经验丰富编排人员”的选择顺序：硬条件、上下文连续性、内容匹配、时长适配、策略偏好、拒绝理由。
5. 若涉及规则兜底，只处理确定性强的窄场景，并保留 LLM 或候选选择路径。

## 4.1 Playlist State And Atomic Command Policy

后续“先接住全部原子命令”的计划，必须先引入播单状态机：

- 初始状态：左侧播单区域为空，不进入具体编排交互。
- `新建电视播单`：创建电视播单，只允许电视频道编排策略。
- `新建轮播单`：创建轮播单，默认策略为内容匹配优先。
- 未创建播单前，插入、删除、移动、替换等原子命令，以及补空窗、全天编排等长流程命令，必须拒绝并提示先创建播单。

原子命令执行策略：

- 电视播单下：由于电视频道策略约束强，用户原子命令在目标清楚、候选唯一、规则校验通过时可以直接执行；删除等敏感操作除外。
- 轮播单下：由于节目选择自由度大，插入、替换等会引入节目候选的原子命令，应继续走候选推荐列表，让用户选择后再写入。
- 移动、前移、后移这类只作用于已有条目的命令，在目标唯一且校验通过时可直接执行；目标不唯一时进入目标选择。
- 节目线索不明确、缺少时间、节目、偏移量、候选不匹配、顺播冲突、时间冲突时，两种播单都不能强行执行。
- 轮播单策略只允许在轮播单内调整；电视播单不能切换为内容匹配、收视率或热播优先。

当前阶段范围：

- 强化播单创建、原子命令识别、电视/轮播策略分流、候选推荐确认/取消。
- 补空窗和全天编排本质上都是长流程，本阶段不作为原子命令接入目标，也不纳入 `agent:check` 强制门禁。

对应 case 必须覆盖：

- 未创建播单时原子命令被拒绝。
- 新建电视播单后，非敏感且目标清楚、规则校验通过的移动、插入、替换类命令按电视策略直接执行或进入必要的目标选择。
- 电视播单下删除命令保持确认。
- 新建轮播单后默认内容匹配优先。
- 轮播单下插入、替换返回候选推荐，不直接硬排；补空窗和全天编排留到长流程阶段处理。
- 轮播单可切换收视率优先和热播优先；电视播单切换这些策略必须拒绝。

## 5. Verification

初始门禁为：

- 原子偏移解析：`向后移动1小时` 必须是 `forward + 3600`。
- 参数抽取：`9点的节目向后移动1小时` 必须得到 `09:00 -> forward`。
- runtime 原子移动：实际命令 `newStartTime` 必须为 `10:00`。
- 候选选择上下文：9点已有第1集时，8点不能排第2集。
- 分类器边界：非编排产物不能误入编排流程。
- 构建检查：类型和前端构建必须通过。

统一入口：

```bash
npm run agent:check
```

前台可见 UI 问题还必须刷新 `http://localhost:5173`，在 Codex in-app browser 中完成一次真实冒烟或交互验证，并在汇报中说明页面观察结果。

前台浏览器回归入口：

```bash
npm run agent:browser:goal37
```

Goal 38 覆盖率回归入口：

```bash
npm run agent:browser:goal38
```

这两条命令会启动真实 Vite 页面，并在开发环境里注入可控的 LLM mock，用来稳定复现前台链路，不依赖 OpenClaw、真实 API key 或外部网络。它们不是产品逻辑，也不替代真实 LLM 验证；它们只用于确认 `ChatPanel` / `broadcast-plan` 是否能正确展示和承接：

- 轮播无草案整体编排先温和阻拦。
- 用户继续生成轮播草案并局部微调。
- 一句话同时新建轮播单和草案。
- LLM 失败时给出可恢复反馈且不改草案或播单。
- 电视播单原子插入进入候选确认，不直接写入。
- pending 被新话题打断后自然失效。
- 已有电视播单要求全天重编时先进入确认。
- 只读分析和连续追问优化只给建议，不写播单。
- 轮播局部草案、草案重写、草案素材核验都停留在草案层，正式编排前继续受门禁保护。

覆盖矩阵当前门槛：`supported + guarded_supported` 必须达到 80% 以上；无法真实覆盖的公共访问、真实素材库质量、文件上传等场景必须保留 rootCause，不能伪装成已完成。

## Goal 39 服务端迁移边界

Goal 39 是前端内嵌 runtime 的最后一条能力型扩展边界。ReAct 长程任务、素材查证、正式编排批量执行和失败恢复的状态机骨架落地后，新的长程业务能力不得继续堆进 `ChatPanel.vue` 或历史 `DemoRuntimeFacade` 总控文件。

从 Goal 39 起，新增能力必须优先落在正式 agent 组成部分：

- `schedulingAgentRuntimeFacade`：真实前台和未来外部访问方的正式入口。
- `reactTaskTypes` / `reactTaskRuntime`：长程任务状态、轮次、观察、恢复和上限。
- 后续服务端迁移 adapter：LLM 调用、素材库检索、正式播单写入、会话状态和审计日志必须能从浏览器内实现迁移到服务端实现。

迁移启动线：

- Goal 39 完成 ReAct 基础闭环后，不再新增前端专属的长程编排逻辑。
- Goal 40 应开始拆服务端可访问边界：Agent API、会话状态、服务端 LLM key、素材检索 adapter、正式写入 adapter、匿名演示/权限边界。
- Goal 40 的阶段 2/3 迁移方向已经落在 `AgentServerRuntime` / `AgentServerSessionStore` / `HttpAgentRuntimeClient`：
  - LLM prompt/context 必须优先在服务端重建，前台传入的 context 只能作为过渡材料。
  - ReAct task run 必须进入服务端 session，前台只负责展示和继续/停止事件。
  - 新增服务端能力优先扩展 Agent API 和 session store，不继续扩大 `ChatPanel.vue` 或 `DemoRuntimeFacade` 的总控职责。
- 前台 `ChatPanel` 只负责展示、输入、确认和工作区状态，不承担新的长程业务判断。
- OpenClaw 仍只是外部访问方，不能成为服务端迁移或真实前台验证的阻塞条件。

Goal 39 的“差不多完成”判定：

- LLM planner 可以返回顶层 `mode="react"` 和 `reactTask`，而不是把长程目标塞进普通 action 或本地分类器。
- 正式前台入口 `schedulingAgentRuntimeFacade` 可以创建受限 `ReactTaskRun`，执行第一轮可验证动作，记录 observation，并把后续判断交回任务状态。
- 已有草案的素材查证路径能走通：查证前不写正式播单，查证后进入 pending 或给出可恢复反馈。
- 批量/长程任务有轮次和批量上限，失败时有恢复信息，不允许无限重试。
- `agent:check:tests` 和 `build` 通过。

达到以上条件后，Goal 40 必须开始服务端边界迁移；后续新增 ReAct 场景应优先通过 Agent API、session store、LLM/tool adapter 扩展，而不是继续扩大前端总控文件。

长程任务恢复边界：

- 当前阶段不做复杂事务、跨多步补偿或任意历史回滚。
- ReAct 恢复只保留当前任务目标、轮次、最近 observation、可重试状态和下一步建议，让 LLM 能在下一轮继续判断。
- 网络、模型或素材工具失败时，只允许重试上一小步一次；仍失败则停止并要求用户缩小范围、换关键词或重新发起。
- 批量正式写入只按已确认批次推进：每批完成后反馈已处理数量和剩余数量，用户说“继续”才处理下一批。
- 批量写入失败时，必须说明已完成数量、本批是否写入、剩余数量和可恢复动作；不能静默继续。

## 6. Report

最终汇报格式：

- 新增或命中的 case。
- 修复路径。
- 验证命令。
- 浏览器观察结果。
- 残余风险。

## Must Refuse, Leave Blank, Or Ask

以下情况不能强行编排：

- 时间段重叠或节目越出版面边界。
- 连续剧、系列节目出现倒序、跳集、重复或从未来集数回填到更早时段。
- 用户给出明确节目名、栏目或内容关键词，但候选节目库字段级不匹配。
- 候选不足，且没有允许垫播、填充或相似替代。
- 多轮上下文中待处理目标不唯一，继续执行会污染当前编排单。
- 用户命令与电视、广播、新媒体轮播、演播室或节目编排产物无关。

## First Regression Case

第一条强制回归 case：

- 输入：`把9点的节目向后移动1小时`
- 前置：09:00 有节目。
- 期望：新开始时间为 10:00。
- 禁止：移动到 08:00，或进入不必要的追问态。
- 自动化：`src/services/__tests__/atomicOffsetParser.test.ts`、`src/services/__tests__/paramExtractor.test.ts`、`src/services/__tests__/demoRuntimeFacade.atomicFallback.test.ts`。
