# Agent Development Protocol

本文档把 Agent Harness 开发规范落成仓库内可执行流程。目标是让每次优化都能从用户意图进入 case、trace、实现和验证，而不是只靠临场判断。

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

- 电视播单下：由于电视频道策略约束强，用户原子命令只要识别出且置信度不是极低，原则上直接执行；删除等敏感操作除外。
- 轮播单下：由于节目选择自由度大，插入、替换等会引入节目候选的原子命令，应继续走候选推荐列表，让用户选择后再写入。
- 移动、前移、后移这类只作用于已有条目的命令，在目标唯一且校验通过时可直接执行；目标不唯一时进入目标选择。
- 低置信度、缺少时间、节目、偏移量、候选不匹配、顺播冲突、时间冲突时，两种播单都不能强行执行。
- 轮播单策略只允许在轮播单内调整；电视播单不能切换为内容匹配、收视率或热播优先。

当前阶段范围：

- 强化播单创建、原子命令识别、电视/轮播策略分流、候选推荐确认/取消。
- 补空窗和全天编排本质上都是长流程，本阶段不作为原子命令接入目标，也不纳入 `agent:check` 强制门禁。

对应 case 必须覆盖：

- 未创建播单时原子命令被拒绝。
- 新建电视播单后，非敏感且高置信度的移动、插入、替换类命令按电视策略直接执行或进入必要的目标选择。
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
