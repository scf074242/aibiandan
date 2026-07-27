# 对话提示信息精简优化 - 技术方案

> 角色：solution-architect
> 状态：待用户确认
> 范围：仅精简对话区给编排人员看的提示信息，不改变编排链路、不改变 LLM-only 主路径、不引入本地意图改写。

---

## 1. 问题分析

### 1.1 当前 feedback 生成链路（已通过代码探查确认）

所有 feedback.content 都在前端运行时 facade 内生成，并非后端 agent server 独立服务。实际入口：

```
用户输入
  └─ DemoRuntimeFacade（src/services/runtime/demoRuntimeFacade.ts）
       ├─ tryHandlePlaylistStateInstruction   ← 第1轮"新建电视播单"硬编码文案
       ├─ LlmAgentIntentInterpreter           ← 第2轮 LLM assistantFeedback（prompt 在 llmAgentIntentInterpreter.ts）
       │     └─ normalizeAssistantFeedback    ← 本地只清洗技术词/过早完成声明，不改写意图（合规）
       ├─ buildAgentAssistantUserFacingContent← "操作已完成，并已写入当前播单" 硬编码拼接
       └─ buildAgentAssistantProcessSummary   ← "已按当前播单规则收敛候选" 硬编码，塞进 details.assistantProcessSummary
            └─ buildAgentCoreDetails          ← 把 trace / llmRequestTraces / agentRunTraceSummary 塞进 details

前端 ChatPanel.vue
  ├─ appendRuntimeFeedback        ← 把 feedback.content 渲染为主气泡
  ├─ getAssistantProcessLines     ← 从 details.assistantProcessSummary 取出，渲染到 system-process-strip（主气泡下方第二行）
  ├─ step-timer-chip + formatStepMetric ← 每条 assistant 消息都显示 "18.15s" 耗时
  └─ getVisibleMessageDetails     ← "查看原始明细" 点开后用 <pre> 展示 details（含 trace 16 条）
```

关键事实：
- 第1轮文案是**本地硬编码**（`demoRuntimeFacade.ts:300-303`），不是 LLM 产出，改它不违反 LLM-only。
- 第2轮主气泡前半段是 **LLM assistantFeedback**，后半段 "操作已完成，并已写入当前播单" 是本地硬编码拼接（`demoRuntimeFacade.ts:5571/5573`）。
- "详情已按当前播单规则收敛候选" 实际是后端塞进 `details.assistantProcessSummary`、前端 `getAssistantProcessLines` 取出渲染到主气泡下方 process-strip 的第二行，与主气泡"已写入"语义重复。
- 耗时 chip 和 trace 明细在前端通过 `getVisibleMessageDetails` 暴露给用户（点"查看原始明细"）。

### 1.2 废话点 → 根因 → 改动层 映射

| # | 废话点 | 根因位置 | 类型 | 改动层 |
|---|--------|----------|------|--------|
| 1 | "已同时加载当前频道和日期的版面草案，后面可以按这份草案排全天" | `demoRuntimeFacade.ts:300` | 本地硬编码 | 改文案 |
| 2 | "后续将固定使用电视频道编排策略，非敏感原子命令在目标明确时会直接执行" | `demoRuntimeFacade.ts:303` | 本地硬编码 | 删除 |
| 3 | "我理解你想在10点插入《看东方》" | `llmAgentIntentInterpreter.ts:139-143` prompt examples 引导 | LLM 输出 | 改 prompt |
| 4 | "当前播单为空" | 同上，LLM 自行补充 | LLM 输出 | 改 prompt |
| 5 | "我会先定位到10:00，然后从候选库中筛选合适的《看东方》期次，确认后再写入" | 同上，且与实际"已写入"矛盾 | LLM 输出 | 改 prompt |
| 6 | "操作已完成，并已写入当前播单" | `demoRuntimeFacade.ts:5571/5573` | 本地硬编码拼接 | 改文案 |
| 7 | process-strip "已按当前播单规则收敛候选，并写入当前播单" | `demoRuntimeFacade.ts:5748` + `ChatPanel.vue:3738` 渲染 | 本地硬编码 + 前端展示 | 去重 |
| 8 | "18.15s" 耗时 chip | `ChatPanel.vue:44-49` + `formatStepMetric:3196` | 前端展示 | DEV 守卫 |
| 9 | trace 16 条技术步骤 | `demoRuntimeFacade.ts:6229` 塞 trace + `ChatPanel.vue:207-211` 展示 | 前端展示 | DEV 守卫 |

---

## 2. 目标文案样例

### 场景 A：新建电视播单（第1轮）

当前：
> 已新建电视播单。已同时加载当前频道和日期的版面草案，后面可以按这份草案排全天。 后续将固定使用电视频道编排策略，非敏感原子命令在目标明确时会直接执行。

目标（草案已就绪）：
> 已新建电视播单，版面草案已就绪，可以直接排节目。

目标（草案缺失，保留引导）：
> 已新建电视播单。当前频道日期暂无版面草案，全天编排前请先上传、切换或生成草案。

> 说明：删除"后续将固定使用电视频道编排策略..."——该策略说明属于系统帮助文档范畴，不应每轮 feedback 重复；AGENTS.md 的策略分流由代码保证，不靠提示信息教育用户。

### 场景 B：插入/替换/移动等原子命令执行成功（第2轮）

当前：
> 我理解你想在10点插入《看东方》，当前播单为空，我会先定位到10:00，然后从候选库中筛选合适的《看东方》期次，确认后再写入。操作已完成，并已写入当前播单。

目标（LLM 主气泡，由 prompt 约束生成）：
> 已在 10:00 插入《看东方》第 N 期。

目标（本地拼接的兜底句，仅当 LLM 没给可读 feedback 时）：
> 已写入播单。

> 说明：
> - LLM prompt 增加约束：不重复用户输入、不陈述用户已知状态（如"播单为空"）、不描述过程、只说结果或还差什么。
> - 本地拼接的"操作已完成，并已写入当前播单"两段语义重复，精简为"已写入播单。"（保留"已写入"作为 audit 留痕，删"操作已完成"）。

### 场景 C：process-strip 第二行（详情区）

当前：主气泡下方再显示一行 "已按当前播单规则收敛候选，并写入当前播单"

目标：**默认不显示该行**。仅当主气泡没有体现"收敛依据"且存在候选选择证据时，才显示一行简短依据，例如：
> 已按期数顺播规则收敛到第 N 期。

> 说明：line 5748 的"已按当前播单规则收敛候选，并写入当前播单"与主气泡"已写入播单"重复，应改为只在"有具体收敛证据（如期数）"时给出非重复信息；无具体证据时返回空数组，前端 process-strip 自然不渲染。

### 场景 D：耗时与 trace

目标：
- 生产环境：隐藏每条消息的 "18.15s" 耗时 chip；隐藏"查看原始明细"入口（即不暴露 trace / llmRequestTraces / agentRunTraceSummary）。
- 开发环境（`import.meta.env.DEV`）：保留耗时 chip 和原始明细入口，便于调试。

---

## 3. 改动点清单

### 3.1 后端 facade 文案（`src/services/runtime/demoRuntimeFacade.ts`）

| 改动点 | 函数 | 行号 | 改法 |
|--------|------|------|------|
| C1 | `tryHandlePlaylistStateInstruction` | 300 | `draftStatusText` 成功分支改为 `'版面草案已就绪，可以直接排节目。'`；missing 分支文案保留 |
| C2 | `tryHandlePlaylistStateInstruction` | 303 | 拼接改为 `已新建电视播单。${draftStatusText}`（删除"后续将固定使用电视频道编排策略..."整段） |
| C3 | `buildAgentAssistantUserFacingContent`（含 line 5571/5573 的函数） | 5571 | 拼接后缀从 `操作已完成，并已写入当前播单。` 改为 `已写入播单。` |
| C4 | 同上 | 5573 | 兜底句从 `操作已完成，并已写入当前播单。` 改为 `已写入播单。` |
| C5 | `buildAgentAssistantProcessSummary` | 5744-5748 | executed 分支：仅当 `selectedSequence` 为正数时返回 `已按期数顺播规则收敛到第 N 期。`；否则返回空字符串（不 push），让 lines 为空 |
| C6 | `buildAgentCoreDetails` | 6229 | 保留 `trace` 字段塞入 details（前端层面控制不展示，后端 trace 仍可用于 audit/日志，不动） |

> 注意：C5 不能直接删整个 processSummary，因为 `needs_confirmation` 分支（line 5763 `写入前需要你确认。`）仍有用。仅收敛 executed 分支的冗余句。

### 3.2 LLM prompt（`src/services/agent/llmAgentIntentInterpreter.ts`）

| 改动点 | 位置 | 改法 |
|--------|------|------|
| P1 | line 139-143 | 在 assistantFeedback 指令段追加约束（不替换原有指令）：<br/>"assistantFeedback 只说结果或还差什么，不要重复用户原话，不要陈述用户已知状态（如播单是否为空），不要描述定位/检索/筛选过程。执行成功的命令直接说结果，例如『已在 10:00 插入《看东方》第 3 期。』" |
| P2 | line 143 | 把现有 examples 中"我理解你想把《看东方》移到10点，我会核对当前播单中的目标节目和10点是否空闲。"改为结果导向示例：`"已把《看东方》移到 10:00，写入前会核对目标节目和时段。"`（保留 needs_confirmation 语义，但去掉"我理解你想"开头） |

> 合规性：改 prompt 是约束 LLM 输出风格，不是本地改写意图，符合 AGENTS.md。`normalizeAssistantFeedback`（line 260-286）已有的技术词清洗/过早完成声明清洗保留不动（属于结果保护）。

### 3.3 前端展示（`src/components/dialogue/ChatPanel.vue`）

| 改动点 | 位置 | 改法 |
|--------|------|------|
| F1 | line 44-49（step-timer-chip 模板） | 外层加 `v-if="import.meta.env.DEV"`，生产隐藏耗时 chip |
| F2 | line 207-211（查看原始明细按钮 + pre 展示） | 外层加 `v-if="import.meta.env.DEV"`，生产隐藏原始明细入口（trace/llmRequestTraces 不再暴露给用户） |
| F3 | line 63-73（system-process-strip） | 不改逻辑：因 C5 已让 executed 场景 lines 多数为空，process-strip 自然不渲染；保留 needs_confirmation 场景的"写入前需要你确认。" |

> 说明：F1/F2 用 `import.meta.env.DEV` 守卫，与文件内已有的 DEV 守卫模式一致（`recordBrowserRuntimeTrace:1835` 就是 `if (!import.meta.env.DEV) return`）。

---

## 4. 风险评估

### 4.1 不能简单删除的点

| 风险点 | 说明 | 处置 |
|--------|------|------|
| 第1轮"版面草案已就绪" | 编排人员需要知道草案是否加载，否则全天编排会卡住 | **保留简短提示**（C1 改短不删）；missing 分支引导文案完整保留 |
| "已写入播单" | 是写入结果的 audit 留痕，删了用户无法确认操作是否真的落表 | **保留**"已写入播单"，只删冗余的"操作已完成"（C3/C4） |
| processSummary 候选收敛证据 | 当 LLM 选了具体期数时，"收敛到第 N 期"是编排人员复核的关键依据 | **有具体证据时保留**（C5 保留 selectedSequence 分支），仅删无证据时的空泛句 |
| trace / llmRequestTraces | 排障和 agent:check 需要 | **后端 details 仍保留 trace 字段**（C6 不动），仅前端生产隐藏入口（F2） |
| needs_confirmation / needs_clarification 文案 | 这些是引导用户补充信息的必要提示 | **完全不动**（line 5585-5664 全部保留） |

### 4.2 改动风险

| 风险 | 等级 | 缓解 |
|------|------|------|
| LLM prompt 改动导致 assistantFeedback 风格漂移，影响现有 case 断言 | 中 | 跑 `npm run agent:check` 和 `demoRuntimeFacade.playlistState.test.ts`；若 case 断言依赖旧文案，更新断言而非回退 prompt |
| F1/F2 用 `import.meta.env.DEV` 在 SSR/构建产物行为差异 | 低 | Vite 项目 `import.meta.env.DEV` 是标准守卫，文件内已有先例（line 1835） |
| C5 删空泛句后，executed 场景 process-strip 长期为空，UI 出现"空白条" | 低 | 模板 line 63 已有 `getAssistantProcessLines(message).length > 0` 守卫，空数组不渲染 |
| 删除"后续将固定使用电视频道编排策略"后，用户不知策略已切换 | 低 | 策略分流由代码强制保证（`playlistPolicy.ts` 等）；播单类型在左侧工作区已有标识；非靠 feedback 教育 |

### 4.3 合规性自检（对照 AGENTS.md）

- ✅ 不在本地用关键词过滤/改写 LLM feedback：P1/P2 改的是 prompt，不是本地过滤。
- ✅ 本地逻辑只保护结果不改意图：C1-C5 改的是本地硬编码拼接文案和兜底句，属于"结果展示层"，不触碰意图理解。
- ✅ `normalizeAssistantFeedback` 的技术词清洗保留不动（结果保护）。
- ✅ trace 后端保留，仅前端隐藏（暴露失败/排障能力不丢）。
- ✅ 删除"后续将固定使用电视频道编排策略"不违反策略分流——策略由代码执行，不靠提示。

---

## 5. 验证方式

### 5.1 自动化验证

```bash
# Agent 编排链路变化（必须）
npm run agent:check

# 行为变化：feedback 文案相关 case
npm test -- demoRuntimeFacade.playlistState.test
npm test -- chatPanelQuickActions.test

# 构建（前端改动必须）
npm run build
```

需更新的断言（预判）：
- `src/services/__tests__/demoRuntimeFacade.playlistState.test.ts:169` 断言 `toContain('已同时加载当前频道和日期的版面草案')` → 改为 `toContain('版面草案已就绪')`。
- `src/services/__tests__/demoRuntimeFacade.playlistState.test.ts:757` 断言 `not.toContain('操作已完成')` → 该断言本来就禁止"操作已完成"，C3/C4 后仍成立，无需改。
- `src/components/dialogue/__tests__/chatPanelQuickActions.test.ts:318` 断言源码包含 `getAssistantProcessLines(message).length > 0` → F3 不改该逻辑，断言仍成立。

### 5.2 浏览器冒烟（前台可见交互变化）

在 `http://localhost:5173` 跑：
1. 点"新建电视播单" → 对话区应只显示"已新建电视播单，版面草案已就绪，可以直接排节目。"，无策略说明长句。
2. 输入"在10点插入看东方" → 主气泡应为结果导向短句（如"已在 10:00 插入《看东方》第 N 期。"或 LLM 等价结果句）+ "已写入播单。"，无"我理解你想"/"当前播单为空"/"我会先定位"。
3. 主气泡下方不再出现"已按当前播单规则收敛候选"重复行（除非有期数证据）。
4. 生产构建下：消息无"18.15s"耗时 chip；无"查看原始明细"按钮。
5. DEV 下：耗时 chip 和原始明细入口仍在。

### 5.3 验证门禁对照（AGENTS.md）

- 行为变化 → Vitest case：✅ 5.1
- Agent 编排链路变化 → `npm run agent:check`：✅ 5.1
- 前台可见交互变化 → 浏览器冒烟：✅ 5.2
- 构建相关变化 → `npm run build`：✅ 5.1

---

## 6. 实施顺序建议

1. **先改后端文案**（C1-C5）：影响面最小，case 断言更新后即可验证。
2. **再改 LLM prompt**（P1-P2）：跑 agent:check 确认无回归。
3. **最后改前端展示**（F1-F3）：跑构建 + 浏览器冒烟。

每步独立可验证，任一步骤失败不影响其他步骤回退。

---

## 7. 待用户确认事项

1. 场景 A 目标文案"版面草案已就绪，可以直接排节目。"是否合适？或更短为"已新建电视播单，草案已就绪。"？
2. 场景 B 兜底句"已写入播单。"是否足够？还是保留"已写入当前播单。"？
3. F1/F2 用 `import.meta.env.DEV` 守卫隐藏耗时和原始明细——是否同意生产环境完全隐藏？还是希望保留耗时 chip 仅隐藏 trace 明细？
4. 删除"后续将固定使用电视频道编排策略..."整段——是否同意？该信息是否需要在别处（如左侧工作区角标）补展示？

确认后即可按第 6 节顺序实施。
