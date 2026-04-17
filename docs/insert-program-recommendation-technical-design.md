# 插入节目推荐确认技术方案

更新时间：2026-04-15

## 文档定位

这份文档只覆盖 [atomic-command-clarification-requirements.md](/C:/Users/sucongfei/Documents/trae_projects/bigbiandan2/docs/atomic-command-clarification-requirements.md) 中的需求一：

- 插入节目时，如果未识别到明确节目，或节目识别置信度过低，需要先给出推荐候选，由用户确认后再执行插入。

目标是把需求补成可以直接进入研发实施的技术方案。

## 目标

本轮技术方案要解决四件事：

1. `insert` 命令不再要求一次性必须识别出高置信度节目。
2. 当节目识别不稳定时，运行时能进入“推荐候选并等待确认”的中间态。
3. 用户确认候选后，可以沿用原时间点继续执行插入。
4. 现有 `OpenClawBridge -> DemoRuntimeFacade -> ChatPanel` 链路保持统一，不新开平行机制。

## 非目标

本轮不做以下内容：

1. 不做后端持久化会话。
2. 不做生产级推荐排序体系。
3. 不改动删除、移动、替换的主链路。
4. 不处理批量处理文件需求。

## 当前实现现状

当前插入节目链路如下：

```text
ChatPanel.sendMessage
  -> OpenClawBridge.submitInstruction
  -> DemoRuntimeFacade.submitInstruction
  -> buildMicroEditCommand(insert)
  -> ParamExtractor.extractInsertParams
  -> CandidateService.searchPrograms
  -> CandidateSelectionService.selectForInsert
  -> EntityLinker.createInsertCommand
  -> InsertCommandExecutor.preview
```

关键现状：

1. [paramExtractor.ts](/C:/Users/sucongfei/Documents/trae_projects/bigbiandan2/src/services/paramExtractor.ts) 中的 `extractInsertParams()` 当前要求必须同时抽出 `targetTime + programName`。
2. [demoRuntimeFacade.ts](/C:/Users/sucongfei/Documents/trae_projects/bigbiandan2/src/services/runtime/demoRuntimeFacade.ts) 中的插入分支在拿到候选后，会直接进入 `CandidateSelectionService.selectForInsert()`，最终总是选中一个候选。
3. [candidateSelectionService.ts](/C:/Users/sucongfei/Documents/trae_projects/bigbiandan2/src/services/candidateSelectionService.ts) 当前只有“选一个”的能力，没有“建议多个并等待确认”的状态输出。
4. [runtimeSessionStore.ts](/C:/Users/sucongfei/Documents/trae_projects/bigbiandan2/src/services/runtime/runtimeSessionStore.ts) 当前只有 `pendingAtomicClarification` 和 `pendingTargetSelection`，没有插入候选确认态。

这意味着：

1. 用户说“9 点插一个新闻”时，系统缺少进入推荐态的能力。
2. 用户说“在 9 点插入《东方新闻》”，但候选有多个近似节目时，系统也会被迫直接选一个。
3. 当前桥接会话无法保存“待确认的插入候选列表”。

## 设计原则

本轮方案遵循以下原则：

1. 高置信度唯一命中继续走快速直执行路径。
2. 低置信度、无明确节目名、或多候选接近时，必须进入推荐确认态。
3. 推荐确认态属于原子命令链路的一种未完成状态，不单独开一条特殊通道。
4. 候选确认优先使用确定性评分，不把“是否直接执行”完全交给 LLM。

## 总体方案

## 1. 总体流程

新的插入流程如下：

```text
用户输入插入命令
  -> 提取时间 + 节目线索
  -> 构建插入候选解析结果
    -> 高置信度唯一命中: 直接生成 insert command
    -> 低置信度 / 无明确节目 / 候选接近: 返回推荐候选列表
    -> 无法推荐: 返回澄清消息
  -> 用户确认候选
  -> 继续执行 insert command preview
  -> preview 通过后真正执行
```

## 2. 方案分层

建议把能力拆成三层：

1. 参数层：负责提取 `targetTime` 和节目线索。
2. 候选解析层：负责判断是“直接命中”还是“进入推荐态”。
3. 会话状态层：负责保存待确认候选，等待用户下一轮确认。

## 类型与状态设计

## 1. 参数模型扩展

当前 `InsertParams` 过于刚性，建议升级为“显式节目名 + 模糊节目线索”并存的结构。

建议调整为：

```ts
export interface InsertParams {
  targetTime: string
  programName?: string
  rawProgramText?: string
  semanticLabel?: string
  programTypeHint?: string
}
```

含义：

- `programName`：较明确的节目名，例如 `看东方`
- `rawProgramText`：用户原始节目描述，例如 `一个新闻节目`
- `semanticLabel`：更偏栏目语义，例如 `新闻`
- `programTypeHint`：更偏结构化类型，例如 `news`

这样可以支持两类输入：

1. 明确节目名：`在 9 点插入《东方新闻》`
2. 模糊节目描述：`在 9 点插一个新闻节目`

## 2. 新增推荐候选类型

建议新增：

```ts
export interface InsertRecommendationCandidate {
  candidateId: string
  programName: string
  programCode: string
  duration: number
  programType: string
  score: number
  confidence: number
  reasonTags: string[]
}
```

`reasonTags` 初版建议只用短标签，例如：

- `名称接近`
- `栏目匹配`
- `类型匹配`
- `时段常见`

## 3. 新增待确认状态

建议在运行时增加专用状态：

```ts
export interface RuntimePendingInsertRecommendation {
  action: 'insert'
  summary: string
  reasoning: string
  originalUserInput: string
  collectedUserInput: string
  targetTime: string
  rawProgramText?: string
  semanticLabel?: string
  programTypeHint?: string
  recommendedCandidates: InsertRecommendationCandidate[]
  selectedCandidateId: string | null
}
```

说明：

1. 这和 `pendingTargetSelection` 不同。
2. `pendingTargetSelection` 面向“从现有已排节目里选目标条目”。
3. `pendingInsertRecommendation` 面向“从节目候选库里确认插入哪一个候选节目”。

## 4. RuntimeDecision 扩展

建议在 [demoRuntimeFacade.ts](/C:/Users/sucongfei/Documents/trae_projects/bigbiandan2/src/services/runtime/demoRuntimeFacade.ts) 中新增：

```ts
| { kind: 'pending_insert_recommendation'; feedback: RuntimeFeedback; pendingInsertRecommendation: RuntimePendingInsertRecommendation }
```

这样可以保持和现有 `pending_command / pending_target_selection / layout_draft` 同一层级。

## 5. Bridge 状态复用策略

`BridgeRuntimeStatus` 不建议新加一个 `needs_program_confirmation`。

建议继续复用现有 `needs_selection`，原因是：

1. 语义上仍然属于“等待用户从列表中做选择”。
2. 可以减少桥接层和页面状态枚举的连锁修改。
3. 页面可以通过 `pendingInsertRecommendation` 是否存在来区分具体展示哪种选择面板。

## 模块改造方案

## 1. ParamExtractor 改造

目标模块：

- [paramExtractor.ts](/C:/Users/sucongfei/Documents/trae_projects/bigbiandan2/src/services/paramExtractor.ts)

改造点：

1. `extractInsertParams()` 不再把 `programName` 设为强必填。
2. 规则提取优先识别时间。
3. 节目名无法稳定识别时，尝试提取 `rawProgramText / semanticLabel / programTypeHint`。

示例：

- `在 09:00 插入《东方新闻》`
  期望得到：`targetTime=09:00:00, programName=东方新闻`

- `在 09:00 插一个新闻节目`
  期望得到：`targetTime=09:00:00, rawProgramText=新闻节目, semanticLabel=新闻, programTypeHint=news`

## 2. CandidateService 扩造

目标模块：

- [candidateService.ts](/C:/Users/sucongfei/Documents/trae_projects/bigbiandan2/src/services/candidateService.ts)

现状上，`searchPrograms()` 已经支持空关键字检索，这意味着候选推荐不一定需要新接口。

本轮建议增加一个薄封装方法，例如：

```ts
recommendProgramsForInsert(params: {
  channelId: string
  targetTime: string
  columnId?: string
  programName?: string
  semanticLabel?: string
  programTypeHint?: string
  limit?: number
}): Promise<ProgramCandidate[]>
```

内部策略建议：

1. 有明确 `programName` 时先按名称搜索。
2. 若结果不足，再按 `programTypeHint` 或 `semanticLabel` 放宽搜索。
3. 若仍不足，则在同频道同栏目下给出默认推荐。

这样可以把“候选推荐”与“严格按名字搜索”分开，避免后续在调用方里堆太多分支。

## 3. 新增 InsertCandidateResolver

建议新增服务：

- `src/services/insertCandidateResolver.ts`

职责：

1. 接收 `InsertParams + ProgramCandidate[]`
2. 输出“直接命中”还是“进入推荐态”

建议接口：

```ts
type InsertCandidateResolution =
  | { status: 'resolved'; selectedCandidate: ProgramCandidate; confidence: number; reasoning: string }
  | { status: 'needs_recommendation'; candidates: InsertRecommendationCandidate[]; confidence: number; reasoning: string; trigger: 'missing_program_name' | 'low_confidence' | 'ambiguous_candidates' | 'no_direct_match' }
  | { status: 'needs_clarification'; reasoning: string }
```

这是本轮技术方案的核心改造点。

## 4. 评分与判定规则

插入候选判定不建议直接沿用当前 `CandidateSelectionService.selectForInsert()`。

建议在 `InsertCandidateResolver` 中显式区分“能不能直执行”和“要不要推荐确认”。

初版评分项建议：

1. 名称精确命中
2. 名称前缀命中
3. 名称包含命中
4. 栏目匹配
5. 类型匹配
6. 当前频道已排使用状态过滤

初版直执行建议规则：

1. 用户给出了明确 `programName`
2. Top1 候选分数达到直执行阈值
3. Top1 和 Top2 分差足够大

否则进入推荐态。

建议默认阈值：

- `directExecuteScoreThreshold = 85`
- `directExecuteScoreDelta = 15`

这些值应放在 resolver 内常量区，后续再做配置化。

## 5. DemoRuntimeFacade 改造

目标模块：

- [demoRuntimeFacade.ts](/C:/Users/sucongfei/Documents/trae_projects/bigbiandan2/src/services/runtime/demoRuntimeFacade.ts)

改造点分两部分。

### 5.1 新建插入推荐分支

当前插入分支是：

1. 提参
2. 搜候选
3. 直接选一个
4. preview
5. 执行

新分支建议改成：

1. 提参
2. 搜候选 / 推荐候选
3. 调 `InsertCandidateResolver.resolve()`
4. `resolved` 时继续走原执行链
5. `needs_recommendation` 时返回 `pending_insert_recommendation`
6. `needs_clarification` 时返回插入澄清消息

### 5.2 继续执行待确认插入候选

新增一个 continuation 入口，优先级与 `pendingAtomicClarification` 类似。

建议顺序：

1. `tryContinuePendingInsertRecommendation`
2. `tryContinuePendingAtomicClarification`
3. `tryHandleAtomicInstruction`

这样用户在推荐态回复“第一个”“就这个”“插东方新闻”时，能优先接回上一条插入命令。

## 6. OpenClawBridge / SessionStore 改造

目标模块：

- [runtimeSessionStore.ts](/C:/Users/sucongfei/Documents/trae_projects/bigbiandan2/src/services/runtime/runtimeSessionStore.ts)
- [openClawBridge.ts](/C:/Users/sucongfei/Documents/trae_projects/bigbiandan2/src/services/openclaw/openClawBridge.ts)

改造要求：

1. `RuntimeBridgeSessionState` 增加 `pendingInsertRecommendation`
2. `submitInstruction()` 把该状态传回 `DemoRuntimeFacade`
3. `updateSessionFromDecision()` 支持 `pending_insert_recommendation`
4. `cancel()` 时清空该状态
5. `toBridgeResult()` 把状态透传到 payload

## 7. ChatPanel UI 改造

目标模块：

- [ChatPanel.vue](/C:/Users/sucongfei/Documents/trae_projects/bigbiandan2/src/components/dialogue/ChatPanel.vue)

UI 初版建议不复杂化，复用当前等待面板的视觉结构。

建议新增一块“插入候选推荐面板”，展示：

1. 目标时间
2. 用户原始节目描述
3. 推荐候选列表
4. 候选时长与类型
5. 候选推荐标签
6. “确认插入”按钮
7. “重新描述”按钮

同时继续支持自然语言确认，不强依赖按钮点击。

## 用户确认策略

用户确认候选时，建议支持两种入口：

1. 点击候选项
2. 直接继续输入

自然语言确认匹配规则建议支持：

1. `第一个 / 第二个 / 1 / 2`
2. `就这个 / 插这个 / 用这个`
3. 直接回复候选节目名
4. `都不对`

匹配失败时：

1. 保持在 `pendingInsertRecommendation`
2. 提示用户从列表中明确选择，或重新描述节目

## 冲突与预演

插入推荐确认完成后，不应直接执行。

仍然必须复用现有：

- `EntityLinker.createInsertCommand`
- `InsertCommandExecutor.preview`

也就是说：

1. 候选确认只解决“插什么节目”
2. 时间冲突、预演失败仍由原 preview 逻辑兜底

这样可以避免把推荐确认和时间校验混到一起。

## 推荐文案生成

初版建议不要再引入一次 LLM 生成长推荐文案。

推荐理由直接走本地短标签拼接即可，例如：

- `名称接近，栏目匹配`
- `同栏目常见节目，类型匹配`
- `未找到精确名称，先按新闻类节目推荐`

这样可控，也便于测试。

## 实施步骤

建议按以下顺序实施：

1. 扩展 `InsertParams`，允许模糊节目线索。
2. 新增 `InsertRecommendationCandidate` 和 `RuntimePendingInsertRecommendation` 类型。
3. 新增 `insertCandidateResolver.ts`。
4. 改造 `DemoRuntimeFacade` 插入分支和 continuation 分支。
5. 改造 `runtimeSessionStore / openClawBridge` 透传推荐态。
6. 在 `ChatPanel.vue` 新增推荐候选面板。
7. 补单测和桥接回归测试。

## 测试方案

至少补以下测试：

### ParamExtractor

1. `在 09:00 插入《东方新闻》` 能提取明确节目名
2. `在 09:00 插一个新闻节目` 能提取时间和类型线索

### InsertCandidateResolver

1. 明确名称且高分唯一候选时返回 `resolved`
2. 无明确节目名时返回 `needs_recommendation`
3. 多候选分差过小时返回 `needs_recommendation`
4. 候选为空时返回 `needs_clarification`

### DemoRuntimeFacade

1. 推荐态能生成 `pending_insert_recommendation`
2. 用户回复“第一个”后能继续执行插入
3. 用户回复“都不对”后能要求重新描述

### OpenClawBridge

1. 推荐态能正确落到 session store
2. 下一轮输入能复用 `pendingInsertRecommendation`

### ChatPanel

1. 推荐面板能展示候选信息
2. 点击确认后能把选中候选回传

## 风险与回退

本轮最大风险有两个：

1. 类型扩展会影响现有插入分支的测试基线
2. 推荐态如果和 `pendingAtomicClarification` 处理顺序不对，容易造成状态抢占

回退策略：

1. 保留当前高置信度直执行快路径
2. 只有命中模糊条件时才进入新推荐态
3. 如果推荐态实现不完整，至少不要破坏当前明确节目名插入能力

## 一句话结论

第一个需求的实施关键，不是“多给几个候选”，而是把插入命令从“必须一次性识别成功”改造成“允许先推荐、再确认、再继续执行”的状态化链路。
