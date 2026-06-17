# Scheduling Agent v1 前台验收清单

更新时间：2026-06-17

## 验收边界

本清单只验收前台真实产品路径：

1. 用户在 `broadcast-plan` 页面右侧 `AI 助手` 输入自然语言。
2. `ChatPanel` 把请求送入 `Scheduling Agent runtime`。
3. Runtime 使用 LLM-first 结构化意图和当前播单证据包进行判断。
4. 本地确定性逻辑执行预演、约束校验、确认门禁、阻断或写入。
5. 写入结果回到左侧真实播单表格。

本版本继续排除：

- 版面草案生成或确认落表
- 全天自动编排
- 多人协作
- 目标位置占用后的自动下移、自动替换、自动重排
- OpenClaw 独立链路验收

## 必验场景

| 编号 | 场景 | 输入示例 | 期望结果 | 当前证据 |
|---|---|---|---|---|
| A1 | 创建电视播单 | `新建电视播单` | 左侧进入电视播单工作区，显示频道、日期、编排内容/版面草案标签；右侧生成可打开文件卡片 | 前台浏览器已验证 |
| A2 | 创建轮播单 | `新建轮播单` | 左侧进入轮播单工作区，只显示时长制和 0 点起算，不显示版面草案标签 | 前台浏览器已验证 |
| A3 | 轮播短片无节目编号插入 | `0点插入城市形象春日花路短片` + `确认执行` | 先进入确认门禁；确认后左侧写入短片，节目编号为空并显示 `-` | 前台浏览器已验证；`foregroundAgentFlow.test.ts` 覆盖 |
| A4 | 电视顺播继续 | `9点45分插入品质剧场：纵有疾风起` | 根据当前播单或历史基线选择下一集，不跳集 | `foregroundAgentFlow.test.ts` 覆盖 |
| A5 | 电视明确跳集阻断 | `10点插入品质剧场：纵有疾风起 第3集` | 若缺少第2集基线，阻断写入并说明顺播规则 | 前台和服务测试已验证 |
| A6 | 移动节目 | `把9点的节目移到10点` | 目标空闲时写入移动结果；目标占用时阻断 | 前台浏览器已验证占用阻断；测试覆盖空闲移动 |
| A7 | 插入节目 | `在9点插入节目看东方` | 候选检索后写入电视节目；左侧真实表格新增节目 | 前台浏览器已验证 |
| A8 | 替换节目 | `把9点的节目替换成东方新闻` | 用户明确替换时允许跨栏目写入；版面草案只作为候选加权，不作为强制阻断 | 前台浏览器已验证；`foregroundAgentFlow.test.ts` 覆盖 |
| A9 | 删除节目 | `删除9点的节目` + `确认执行/取消` | 删除先进入确认门禁；确认后删除，取消不改表 | 前台浏览器已验证；`foregroundAgentFlow.test.ts` 覆盖 |
| A10 | 查询节目 | `9点是什么节目` | 只返回查询结果，不写入左侧播单 | `foregroundAgentFlow.test.ts` 覆盖 |
| A11 | 校验播单 | `请校验当前节目单` | 只读校验，不写入；顺播问题使用中文业务话术说明 | 前台浏览器已验证；`foregroundAgentFlow.test.ts` 覆盖 |
| A12 | 参数缺失多轮补齐 | `插入看东方` -> `9点` | 第二轮基于上一轮结构化 pending 上下文和本轮自然语言继续判断 | `foregroundAgentFlow.test.ts` 与 runtime intent tests 覆盖 |
| A13 | 新任务打断 pending | 待确认时输入查询或新建播单 | 不把新输入误当成确认；旧 pending 清理或保留在安全边界内 | `foregroundAgentFlow.test.ts` 与 runtime intent tests 覆盖 |
| A14 | 上下文变化防写入 | pending 后左侧播单变化再确认 | 阻断旧预演，不写入过期结果 | `foregroundAgentFlow.test.ts` 覆盖 |
| A15 | 多播单文件卡片切换 | 连续创建轮播单和电视播单，点击文件卡片 | 左侧能在不同播单文档间切换；轮播单保留短片，电视播单保留频道/日期 | 前台浏览器已验证 |
| A16 | 调试信息默认收起 | 任何 Agent 回复 | 默认不铺开候选检索和 LLM 上下文预算；需要时从详情查看 | 前台浏览器已验证；`chatPanelQuickActions.test.ts` 覆盖 |

## 验收命令

快速前台核心回归：

```bash
npm test -- --run src/services/__tests__/foregroundAgentFlow.test.ts src/services/__tests__/schedulingAgentRuntime.commandMatrix.test.ts src/services/__tests__/schedulingAgentRuntime.intentInterpreter.test.ts src/components/dialogue/__tests__/chatPanelQuickActions.test.ts src/services/__tests__/llmConfig.test.ts src/components/llm/__tests__/LLMConfigPanel.test.ts
npm run type-check
```

完整 Agent 默认门禁：

```bash
npm run agent:check:tests
npm run build
```

真实 LLM 验收可选执行：

```bash
$env:RUN_AGENT_REAL_LLM_EVAL='1'
npm run agent:eval:llm
```

## 当前前台实测记录

2026-06-17 在 `http://localhost:5173/` 已完成以下真实前台验证：

- 电视播单创建、插入《看东方》、删除确认文案、确认卡片精简。
- 电视播单查询 `9点是什么节目` 只读返回 `09:00:00 命中 1 个节目`，不出现确认卡，左侧节目数保持不变。
- 电视播单校验 `校验当前播单` 只读返回业务化校验结论，不出现确认卡，左侧节目数保持不变。
- LLM 配置弹窗默认显示 `DeepSeek V4 Flash`，不再暴露或回落到 DeepSeek 3.2。
- 电视播单顺播上下文、校验顺播跳集中文反馈、占用目标移动阻断。
- 电视播单明确替换《东方新闻》，不因跨栏目或版面草案被强制阻断。
- 轮播单创建后无版面草案标签，按时长制和 0 点起算展示。
- 轮播短片《城市微短片：春日花路 30秒》确认后写入，节目编号为空并显示 `-`。
- 轮播单和电视播单文件卡片可以双向打开切换。
- 默认对话流不再铺开候选检索/LLM 上下文预算卡片，详情仍可查。

2026-06-17 补充：删除/替换/插入等待确认卡片已改为优先展示 runtime 传入的面向用户确认说明。该说明来自 Agent 的用户反馈链路，LLM `assistantFeedback` 可直接进入前台卡片；本地“已定位/确认后删除”只保留为兜底。相关回归：`foregroundAgentFlow.test.ts`、`chatPanelQuickActions.test.ts`。

前台轻验记录：刷新 `http://localhost:5173/` 后创建电视播单，执行 `在9点插入节目看东方` 再执行 `删除9点的节目`，确认卡片显示“我已经定位到09:00:00 的《看东方 早高峰版》……请你确认后我再执行”，不再显示“提交前需要确认”或“我会先定位”。
