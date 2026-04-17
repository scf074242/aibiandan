# 原子命令上下文管理技术方案

更新时间：2026-04-15

## 文档定位

这份文档只覆盖 [atomic-command-clarification-requirements.md](/C:/Users/sucongfei/Documents/trae_projects/bigbiandan2/docs/atomic-command-clarification-requirements.md) 中的需求二：

- 原子命令需要具备持续上下文管理能力，用户补充信息后，应能沿着上一轮未完成命令继续执行。

文档目标有两个：

1. 给出可直接进入研发实施的技术方案。
2. 对当前实现做一轮设计评审，明确需要保留什么、重构什么、避免什么。

## 评审结论

结论：有条件通过，建议按“统一未完成态 + 结构化补参 + 续跑路由”方案实施，不建议继续在现有并行状态上叠加更多特例。

当前实现已经有一个可用起点：

1. 已有 `pendingAtomicClarification`，可以承接“缺参数时追问”。
2. 已有 `pendingTargetSelection` 和 `pendingInsertRecommendation`，可以承接列表选择。
3. 已有 `OpenClawBridge -> RuntimeSessionStore -> ChatPanel` 的会话透传链路。

但当前实现离需求二还有四个关键缺口：

1. 未完成状态被拆成多个并行结构，续跑入口不统一。
2. 补参仍主要依赖“把新输入拼回旧句子再重跑识别”，结构化上下文不足。
3. 插入推荐确认目前主要走按钮确认，尚未把“第一个 / 就这个 / 候选名”做成通用续跑能力。
4. 没有统一的失效、尝试次数、打断切换规则，后续继续叠加功能会越来越脆。

如果不先把这层收敛，后面的批量处理文件、自然语言确认和更多原子动作都会继续复制状态分支，维护成本会明显上升。

## 当前实现评审

## 1. 已有能力

当前代码里已经具备以下基础能力：

1. [demoRuntimeFacade.ts](/C:/Users/sucongfei/Documents/trae_projects/bigbiandan2/src/services/runtime/demoRuntimeFacade.ts) 有 `tryContinuePendingAtomicClarification()`，可以把补充输入接回上一轮。
2. [runtimeSessionStore.ts](/C:/Users/sucongfei/Documents/trae_projects/bigbiandan2/src/services/runtime/runtimeSessionStore.ts) 已能保存 `pendingAtomicClarification / pendingTargetSelection / pendingInsertRecommendation`。
3. [openClawBridge.ts](/C:/Users/sucongfei/Documents/trae_projects/bigbiandan2/src/services/openclaw/openClawBridge.ts) 已能在提交、取消、执行成功后维护这些状态。
4. [ChatPanel.vue](/C:/Users/sucongfei/Documents/trae_projects/bigbiandan2/src/components/dialogue/ChatPanel.vue) 已能展示追问态、目标选择态和插入推荐态。

这些能力说明现有链路不需要推翻重做，可以沿用。

## 2. 评审发现

### [P1] 未完成态拆散，续跑分支不统一

当前运行时把未完成原子命令拆成：

- `pendingAtomicClarification`
- `pendingTargetSelection`
- `pendingInsertRecommendation`

问题在于：

1. 每种状态都有自己的续跑入口和清理逻辑。
2. `submitInstruction()` 当前优先续跑的是 `pendingAtomicClarification`，而不是“任意未完成原子命令”。
3. 继续往上加批量处理、自然语言候选确认时，会继续复制更多 if/else 分支。

评审建议：

- 需求二实施时，不要继续新增新的平行 pending 字段。
- 应该引入统一的 `pendingAtomicContext` 作为原子命令未完成态主模型。

### [P1] 当前补参模型过度依赖字符串拼接

现有 `mergeAtomicClarificationInput()` 的核心做法是：

1. 把上一轮未完成输入和这一轮补充输入拼成一句新的自然语言。
2. 再把这句拼接后的话重新送回参数抽取和意图识别链路。

这个策略作为第一版原型可行，但有两个问题：

1. 它保存的是“拼好的句子”，不是“已经确认过的结构化槽位”。
2. 一旦用户多轮补参、补充纠正、或者补充很短的表达，例如“后移 5 分钟”“不是这个”“第一个”，模型解释会越来越不稳定。

评审建议：

- 续跑阶段应以结构化槽位为主，拼接自然语言只能作为兜底，不应作为主路径。

### [P1] 插入推荐确认还不是通用上下文续跑

目前插入推荐已经能进入 `pendingInsertRecommendation`，但主要续跑方式仍是：

1. 点击候选项
2. 通过 `selectInsertRecommendation()` 继续执行

这离需求二中的“用户补一句也能继续执行”还有差距，尤其缺：

1. `第一个 / 第二个`
2. `就这个 / 插这个`
3. 直接回复候选节目名
4. `都不对，我要看东方`

评审建议：

- 插入推荐确认要纳入统一续跑框架，而不是保持为按钮专用流程。

### [P2] 缺少统一失效与打断规则

当前已支持部分清理：

1. 用户取消会清理状态
2. 切换频道/日期会清理状态
3. 命令执行成功后会清理状态

但还缺：

1. 明确的 `attemptCount`
2. 连续多轮补参失败后的重置策略
3. 通用的“用户是否在发起新任务”判断器
4. `expired` 态的统一建模

评审建议：

- 在上下文技术方案里把这些规则做成统一状态机，不要继续散落在各模块里用字符串判断。

### [P2] Bridge 状态部分依赖文案反推

当前 [openClawBridge.ts](/C:/Users/sucongfei/Documents/trae_projects/bigbiandan2/src/services/openclaw/openClawBridge.ts) 中的 `resolveStatusFromFeedback()` 仍有一部分依赖文案内容判断状态。

这在需求二中风险更高，因为：

1. 追问文案会越来越多样。
2. 自然语言确认、拒绝、打断都不适合靠文案关键词反推状态。

评审建议：

- 需求二实施时，应优先使用显式 phase/status，而不是继续扩大文案匹配范围。

## 目标

本轮技术方案需要解决五件事：

1. 原子命令有统一的未完成态，而不是多个平行的临时状态。
2. 用户补一句短输入时，系统能判断是在继续旧任务、取消旧任务，还是切换新任务。
3. 系统能把补充信息结构化合并回上下文，而不是只做自然语言拼接。
4. 删除、移动、替换、插入四类命令都能沿用同一套续跑框架。
5. 这套框架能为后续批量处理文件和自然语言选择继续复用。

## 非目标

本轮不做以下内容：

1. 不做跨天、跨页面、跨用户的长期持久化记忆。
2. 不做后端会话存储。
3. 不做多条未完成原子命令并行管理。
4. 不做批量处理文件本身。
5. 不做最终生产级对话策略模型。

## 总体方案

## 1. 设计原则

采用以下四条原则：

1. 一个会话同一时刻只允许存在一条“未完成原子命令上下文”。
2. 未完成态必须保存结构化槽位，而不是只保存自然语言。
3. 所有续跑先走规则判断，再走必要的轻量模型补判，不直接把短输入当全新命令。
4. 打断、取消、成功、失败、过期都必须是显式状态迁移，而不是靠散落的清空逻辑。

## 2. 核心思路

建议把当前三种未完成态：

- `pendingAtomicClarification`
- `pendingTargetSelection`
- `pendingInsertRecommendation`

收敛成一个统一主模型：

```ts
type PendingAtomicPhase =
  | 'clarifying'
  | 'selecting_target'
  | 'recommending_insert'

type AtomicMissingField =
  | 'target_time'
  | 'program_name'
  | 'offset'
  | 'direction'
  | 'replacement_program'
  | 'selection'

interface AtomicSlotBag {
  targetTime?: string
  targetTimeHint?: string
  programName?: string
  rawProgramText?: string
  semanticLabel?: string
  programTypeHint?: string
  direction?: 'forward' | 'backward'
  offsetSeconds?: number
  replacementProgramName?: string
}

interface RuntimePendingAtomicContext {
  action: 'insert' | 'move' | 'delete' | 'replace'
  phase: PendingAtomicPhase
  summary: string
  reasoning: string
  originalUserInput: string
  collectedUserInput: string
  slots: AtomicSlotBag
  missingFields: AtomicMissingField[]
  followUpQuestion: string
  targetCandidates?: RuntimeScheduleItem[]
  insertRecommendations?: RuntimeInsertRecommendationCandidate[]
  selectedItemId?: string | null
  selectedCandidateId?: string | null
  attemptCount: number
  createdAt: string
  updatedAt: string
  expiresAt?: string
}
```

这个模型是需求二的主状态。

为了控制改造风险，实施时不建议一次性删除现有类型，而是分两阶段：

1. 第一阶段新增 `pendingAtomicContext`，并让现有状态成为它的兼容视图。
2. 第二阶段再逐步移除 `pendingAtomicClarification / pendingTargetSelection / pendingInsertRecommendation`。

## 模块设计

## 1. 新增 AtomicContinuationClassifier

建议新增：

- `src/services/atomicContinuationClassifier.ts`

职责：

1. 判断新输入是不是在继续上一条未完成原子命令。
2. 判断是不是取消。
3. 判断是不是明确打断并切到新任务。
4. 判断是不是选择型回复，例如“第一个”。

建议输出：

```ts
type AtomicContinuationDecision =
  | { kind: 'continue' }
  | { kind: 'cancel' }
  | { kind: 'interrupt_as_new_task' }
  | { kind: 'selection_reply'; selection: 'first' | 'second' | 'third' | 'explicit_id' | 'explicit_name'; value?: string }
  | { kind: 'unclear' }
```

判定顺序建议：

1. 先判 `取消 / 不用了 / 算了`
2. 再判明显新任务，例如 `全天编排 / 补齐空窗 / 执行校验 / 按版面开始编排`
3. 再判选择回复，例如 `第一个 / 第二个 / 就这个 / 这个`
4. 再判参数补丁，例如时间、偏移量、新节目名
5. 最后才进入模型补判

## 2. 新增 AtomicFollowUpParser

建议新增：

- `src/services/atomicFollowUpParser.ts`

职责：

1. 从补充输入里抽取“增量参数”。
2. 只解析当前 action 所关心的字段。
3. 以结构化 patch 的形式回写上下文。

建议输出：

```ts
interface AtomicFollowUpPatch {
  targetTime?: string
  targetTimeHint?: string
  programName?: string
  rawProgramText?: string
  semanticLabel?: string
  programTypeHint?: string
  direction?: 'forward' | 'backward'
  offsetSeconds?: number
  replacementProgramName?: string
}
```

这里的重点是：

- 旧上下文保留
- 新输入只补缺字段
- 如果用户在修正已有字段，按最近一次明确输入覆盖

## 3. 新增 PendingAtomicContextService

建议新增：

- `src/services/pendingAtomicContextService.ts`

职责：

1. 创建未完成态
2. 合并补丁
3. 计算当前仍缺的字段
4. 生成 follow-up question
5. 维护 `attemptCount / updatedAt / expiresAt`

这层的目标是把“状态生成与状态迁移规则”从 `DemoRuntimeFacade` 中拆出来。

## 4. DemoRuntimeFacade 改造

目标模块：

- [demoRuntimeFacade.ts](/C:/Users/sucongfei/Documents/trae_projects/bigbiandan2/src/services/runtime/demoRuntimeFacade.ts)

建议改造为统一续跑入口：

```text
submitInstruction
  -> tryContinuePendingAtomicContext
    -> cancel
    -> interrupt_as_new_task
    -> continue clarifying
    -> continue selecting_target
    -> continue recommending_insert
  -> tryHandleAtomicInstruction
  -> existing layout / validate / orchestration flow
```

### 4.1 不再优先只续跑 `pendingAtomicClarification`

当前只优先续跑 `pendingAtomicClarification`，这不够。

应改为：

1. 如果存在 `pendingAtomicContext`，先统一尝试续跑
2. 根据 `phase` 分派到不同处理器

### 4.2 按 phase 处理

建议三类 phase：

#### `clarifying`

场景：

- 删除缺时间
- 移动缺偏移量
- 替换缺新节目名
- 插入缺明确节目或节目线索

处理：

1. 用 `AtomicFollowUpParser` 抽 patch
2. 合并到 `slots`
3. 若仍缺关键字段，继续追问
4. 若字段已齐，进入对应 action 的 resolver

#### `selecting_target`

场景：

- 删除 / 移动 / 替换 时命中了多个已编排节目

处理：

1. 支持 `第一个 / 第二个 / 节目名 / 时间` 四种选择方式
2. 若命中唯一候选，继续执行
3. 若仍无法确定，停留在 `selecting_target`

#### `recommending_insert`

场景：

- 插入时节目不明确、低置信、候选接近

处理：

1. 支持 `第一个 / 就这个 / 候选节目名`
2. 支持 `都不对，我要看东方`
3. 当用户给出新的节目名时，更新 `slots.programName` 并重新跑插入候选解析

## 5. 不建议继续把续跑主逻辑建立在字符串拼接上

这是一条实施边界要求。

可以保留：

- `collectedUserInput`
- `originalUserInput`

用于日志和调试。

但真正的续跑判断应基于：

- `action`
- `phase`
- `slots`
- `missingFields`

而不是把 `old input + follow-up input` 拼起来重新猜。

如果需要模型兜底，输入也应尽量是结构化 prompt，而不是只有长句拼接文本。

## 6. RuntimeSessionStore 改造

目标模块：

- [runtimeSessionStore.ts](/C:/Users/sucongfei/Documents/trae_projects/bigbiandan2/src/services/runtime/runtimeSessionStore.ts)

建议新增：

```ts
pendingAtomicContext?: RuntimePendingAtomicContext
```

同时建议补两个辅助方法：

1. `clearPendingAtomicContext(sessionId)`
2. `touchPendingAtomicContext(sessionId, patch)`

这样可以避免后续所有状态迁移都直接在 `updateSession()` 中散写。

## 7. OpenClawBridge 改造

目标模块：

- [openClawBridge.ts](/C:/Users/sucongfei/Documents/trae_projects/bigbiandan2/src/services/openclaw/openClawBridge.ts)

桥接层需要做两件事：

1. 不再只透传“某一种 pending 字段”，而是优先透传统一 `pendingAtomicContext`
2. 在 `updateSessionFromDecision()` 中根据显式 phase/status 更新 session，而不是继续扩大文案推断

评审建议：

- `resolveStatusFromFeedback()` 在需求二里只保留兜底，不再作为主状态来源。

## 8. ChatPanel 改造

目标模块：

- [ChatPanel.vue](/C:/Users/sucongfei/Documents/trae_projects/bigbiandan2/src/components/dialogue/ChatPanel.vue)

页面不需要把需求二做成非常复杂的新交互，但需要满足两个目标：

1. 用户能看懂当前卡在哪一步
2. 用户既可以点选，也可以直接说一句话继续

建议把当前多个面板适配到统一渲染模型：

```text
pendingAtomicContext.phase === clarifying
  -> 展示缺失字段卡片

pendingAtomicContext.phase === selecting_target
  -> 展示目标候选卡片

pendingAtomicContext.phase === recommending_insert
  -> 展示插入推荐卡片
```

UI 至少展示：

1. 当前动作
2. 已识别槽位
3. 仍缺字段
4. 当前候选列表
5. 取消按钮

## 状态迁移

建议状态迁移如下：

```text
idle
  -> clarifying
  -> selecting_target
  -> recommending_insert

clarifying
  -> clarifying
  -> selecting_target
  -> recommending_insert
  -> execute_command
  -> cancelled
  -> expired
  -> interrupt_as_new_task

selecting_target
  -> selecting_target
  -> execute_command / pending_command
  -> cancelled
  -> expired
  -> interrupt_as_new_task

recommending_insert
  -> recommending_insert
  -> execute_command
  -> cancelled
  -> expired
  -> interrupt_as_new_task
```

## 失效与清理规则

需求二建议补足以下规则：

1. 执行成功立即清空
2. 显式取消立即清空
3. 切换频道或日期立即清空
4. 连续 `attemptCount >= 3` 且仍无有效补丁时，转 `expired`
5. `expired` 后提示用户重新完整描述

初版不要求跨页面长时间保留，因此 `expiresAt` 可以先只用于当前线程会话内判断，不需要后端持久化。

## 实施顺序

建议按以下顺序推进：

1. 定义 `RuntimePendingAtomicContext / AtomicSlotBag / AtomicMissingField`
2. 新增 `AtomicContinuationClassifier`
3. 新增 `AtomicFollowUpParser`
4. 在 `DemoRuntimeFacade` 中接入统一 `tryContinuePendingAtomicContext`
5. 让 `insert` 推荐确认接入这套续跑路由
6. 让 `pendingTargetSelection` 接入“第一个 / 节目名”自然语言确认
7. 最后再把 UI 和桥接层收敛到统一 pending 模型

这个顺序的好处是：

1. 先把续跑逻辑稳定下来
2. 再减少状态数量
3. 风险更可控

## 测试方案

至少补以下测试：

### ContinuationClassifier

1. `后移 30 分钟` 在 pending move 下判定为 `continue`
2. `第一个` 在 selection/recommendation 下判定为 `selection_reply`
3. `取消` 判定为 `cancel`
4. `全天编排` 判定为 `interrupt_as_new_task`

### FollowUpParser

1. 删除补时间
2. 移动补偏移量
3. 替换补新节目名
4. 插入补节目名

### DemoRuntimeFacade

1. 删除类补时间后继续执行
2. 移动类补幅度后继续执行
3. 替换类补节目后继续执行
4. 插入推荐态回复 `第一个` 后继续执行
5. 插入推荐态回复 `都不对，我要看东方` 后重新推荐或直执行
6. 未完成态发 `全天编排` 后退出上下文并进入编排流程

### RuntimeSessionStore / OpenClawBridge

1. `pendingAtomicContext` 能保存、更新、清理
2. `cancel / success / channel-date switch` 能正确清空
3. 过期后不会继续错误复用旧上下文

## 风险与规避

本轮最大的风险有三个：

1. 把三个 pending 状态合并时，容易影响现有 UI 渲染逻辑
2. 续跑优先级如果处理不好，会和全天编排、版面草案等流程抢路由
3. 结构化补丁解析如果做得太激进，可能误把新任务当成补参

规避策略：

1. 先保留兼容字段，再逐步切到统一状态
2. 明确 `interrupt_as_new_task` 的判定优先级
3. 规则优先，模型补判只用于边界场景

## 最终建议

需求二不建议继续做成“多加几个 pending 字段、多补几个 if/else”。

更稳的方向是：

1. 统一一个 `pendingAtomicContext`
2. 统一一个续跑分类器
3. 统一一个补丁解析器
4. 统一一套显式状态迁移规则

这样才能把“补一句就继续执行”从个别特例，真正升级成原子命令链路的基础能力。
