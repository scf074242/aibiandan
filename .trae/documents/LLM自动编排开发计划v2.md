# LLM 自动编排开发计划 v2.0

> 基于新技术方案《原技术方案书修订稿-LLM自动编排》制定
> 制定日期：2026-03-25

---

## 一、方案核心变化分析

### 1.1 新旧方案关键差异

| 维度 | 旧方案（已废弃） | 新方案（当前采用） |
|------|------------------|-------------------|
| **任务驱动** | 以"会话"为中心，LLM 自主决定循环 | 以"空窗"为核心驱动，系统控制循环 |
| **LLM 职责** | 输出完整节目块列表、自主决策 | 只做局部决策（选候选、选策略） |
| **数据生成** | LLM 直接生成业务对象 | 确定性物化器将选择转为业务对象 |
| **长程任务** | 依赖 LLM 持续自发执行 | 系统托管，LLM 单轮局部决策 |
| **回退机制** | 简单重试 | 三级回退（条目/空窗/会话） |
| **校验修复** | LLM 自主修复 | 有限轮次修补，超限转人工 |
| **入口设计** | 单一 AI 编排入口 | 统一任务判别器（6种模式） |

### 1.2 需要重构的模块

```
src/services/
├── llm/
│   ├── promptBuilder.ts      # 重构：适配新命令体系
│   ├── contextBuilder.ts     # 重构：聚焦局部上下文
│   └── taskClassifier.ts     # 新增：统一任务判别器
├── orchestrator.ts           # 重构：改为空窗驱动循环
├── materializer.ts           # 新增：确定性物化器
├── fallbackManager.ts        # 新增：三级回退管理器
├── repairManager.ts          # 新增：有限轮次修补管理器
└── commandExecutor.ts        # 重构：支持新命令类型
```

### 1.3 需要新增的接口层

```
src/services/orchestration/
├── interfaces/
│   ├── readInterfaces.ts     # 读取类接口
│   ├── previewInterfaces.ts  # 预演类接口
│   ├── executeInterfaces.ts  # 执行类接口
│   └── explainInterfaces.ts  # 解释类接口
└── validators/
    └── validationEngine.ts   # 确定性校验引擎
```

---

## 二、开发阶段规划（10天里程碑）

### 📌 阶段一：核心架构重构（第1-2天）

#### Day 1：任务判别器 + 空窗驱动框架

**目标**：建立统一入口和空窗驱动基础

**任务清单**：

1. **创建任务判别器** `src/services/llm/taskClassifier.ts`
   - 输入：节目单状态 + 用户语义 + 风险等级
   - 输出：6种任务模式之一
   - 集成 LLM 进行意图识别

2. **重构编排调度器** `src/services/orchestrator.ts`
   - 改为空窗驱动循环架构
   - 移除 LLM 自主循环逻辑
   - 添加 `PlanningSession` 状态管理

3. **创建空窗管理器** `src/services/gapManager.ts`
   - `queryRemainingGaps()` 接口实现
   - 空窗队列维护
   - 空窗切分/缩小/消除逻辑

**验收标准**：
- [ ] 任务判别器能正确识别6种模式
- [ ] 空窗管理器能返回当前待编排空窗列表
- [ ] 编排器能按空窗驱动执行单轮填充

#### Day 2：确定性物化器 + 两阶段候选检索

**目标**：实现 LLM 选择到业务对象的转换

**任务清单**：

1. **创建确定性物化器** `src/services/materializer.ts`
   - 输入：空窗 + LLM 选中节目 + 上下文
   - 输出：完整 `RundownItem` / `ScheduleItem`
   - 自动补齐系统字段（时间、序号等）

2. **实现两阶段候选检索**
   - `QueryCandidatesCommand` 生成
   - 候选检索接口调用
   - 候选结果过滤和排序

3. **重构 Prompt 构建器**
   - 适配新命令体系
   - 聚焦局部上下文构建
   - 移除完整节目单生成 Prompt

**验收标准**：
- [ ] 物化器能将候选选择转为完整业务对象
- [ ] 时间边界由系统计算，非 LLM 生成
- [ ] 两阶段检索流程跑通

---

### 📌 阶段二：命令体系与执行（第3-4天）

#### Day 3：新命令体系实现

**目标**：建立精简的命令体系

**任务清单**：

1. **定义新命令类型** `src/types/orchestration.ts`
   ```typescript
   type CommandType = 
     | 'plan'           // 策略初始化
     | 'query_candidates' // 候选检索
     | 'fill_item'      // 单条选择
     | 'repair'         // 修复策略
     | 'insert'
     | 'delete'
     | 'replace'
     | 'move'
     | 'update_field'
     | 'clarification'
   ```

2. **重构命令执行器** `src/services/commandExecutor.ts`
   - 支持新命令类型
   - 集成物化器
   - 自动触发校验

3. **实现策略初始化命令** `PlanCommand`
   - 输出编排策略描述
   - 不输出完整节目块

**验收标准**：
- [ ] 所有新命令类型定义完成
- [ ] 命令执行器能正确执行各类型命令
- [ ] PlanCommand 只输出策略，不输出节目单

#### Day 4：原子能力层 + 自动校验

**目标**：建立原子能力执行和校验机制

**任务清单**：

1. **创建原子能力服务** `src/services/atomicCapabilities.ts`
   - `append_items(items)`
   - `replace_item(params)`
   - `delete_item(params)`
   - `move_item(params)`

2. **实现确定性校验引擎** `src/services/validators/validationEngine.ts`
   - 空窗检测
   - 重叠检测
   - 首尾边界匹配
   - 成品/素材关联检测
   - 输出结构化 `ValidationReport`

3. **集成自动校验到执行链路**
   - 每次写入后自动触发
   - 校验结果反馈到编排器

**验收标准**：
- [ ] 原子能力接口全部实现
- [ ] 校验引擎能输出结构化报告
- [ ] 写入-校验链路跑通

---

### 📌 阶段三：回退与修补机制（第5-6天）

#### Day 5：三级回退机制

**目标**：实现健壮的错误恢复

**任务清单**：

1. **创建回退管理器** `src/services/fallbackManager.ts`
   - **条目级回退**：换候选重新写入
   - **空窗级回退**：回退空窗内最近若干条
   - **会话级回退**：暂停自动编排，转人工

2. **实现回退状态追踪**
   - 记录每次写入的快照
   - 支持按条目/空窗粒度回退
   - 回退后空窗重算

3. **集成到编排循环**
   - 写入失败时触发条目级回退
   - 连续失败时触发空窗级回退
   - 达到阈值时转人工

**验收标准**：
- [ ] 三级回退机制全部实现
- [ ] 回退后状态正确恢复
- [ ] 空窗列表正确重算

#### Day 6：有限轮次修补

**目标**：实现自动修复能力

**任务清单**：

1. **创建修补管理器** `src/services/repairManager.ts`
   - 配置最大修补轮次（默认3轮）
   - 修补轮次计数
   - 超限判定和人工接管

2. **实现修复策略选择**
   - 替换候选
   - 补短片
   - 调整一条
   - 局部回退
   - 请求人工确认

3. **创建 RepairCommand 处理逻辑**
   - 解析校验报告
   - 生成允许修复动作
   - LLM 选择修复策略
   - 执行修复并重新校验

**验收标准**：
- [ ] 修补管理器能控制轮次
- [ ] 达到上限正确转人工
- [ ] 修复策略选择流程跑通

---

### 📌 阶段四：接口层与数据（第7-8天）

#### Day 7：编排代理接口层

**目标**：建立 LLM 与系统的标准交互接口

**任务清单**：

1. **读取类接口** `src/services/orchestration/interfaces/readInterfaces.ts`
   - `get_generation_context(channelId, date)`
   - `get_program_details(programCode)`
   - `query_remaining_gaps()`
   - `query_candidates_by_multi_source(params)`
   - `get_recent_schedule_reference(channelId, date, days)`
   - `get_layout_reference(channelId, date)`

2. **预演类接口** `src/services/orchestration/interfaces/previewInterfaces.ts`
   - `materialize_fill_item(params)`
   - `preview_command(command)`
   - `simulate_batch_command(command)`

3. **执行类接口** `src/services/orchestration/interfaces/executeInterfaces.ts`
   - `execute_command(command)`
   - `validate_schedule(scope)`
   - `execute_repair_action(action)`

**验收标准**：
- [ ] 所有读取接口实现
- [ ] 预演接口能返回预览结果
- [ ] 执行接口正确调用原子能力

#### Day 8：解释类接口 + 数据服务

**目标**：实现可解释性和数据支持

**任务清单**：

1. **解释类接口** `src/services/orchestration/interfaces/explainInterfaces.ts`
   - `explain_candidate_selection(candidateId)`
   - `summarize_validation_issues(scope)`
   - `explain_command(command)`

2. **创建编排数据服务** `src/services/orchestration/dataService.ts`
   - 频道信息获取
   - 播出版面获取
   - 历史编排获取
   - 节目库查询
   - 固定播出项获取

3. **集成到 UI 展示**
   - 候选选择解释展示
   - 校验问题汇总展示
   - 命令解释展示

**验收标准**：
- [ ] 解释接口能生成自然语言说明
- [ ] 数据服务能获取所有必要上下文
- [ ] UI 能展示解释信息

---

### 📌 阶段五：UI 重构与集成（第9-10天）

#### Day 9：UI 组件重构

**目标**：适配新架构的界面组件

**任务清单**：

1. **重构编排进度组件** `src/components/orchestration/OrchestrationProgress.vue`
   - 显示空窗处理进度
   - 显示当前处理空窗
   - 显示三级回退状态
   - 显示修补轮次

2. **创建任务模式选择器** `src/components/orchestration/TaskModeSelector.vue`
   - 6种任务模式选择
   - 模式说明和推荐
   - 智能模式推荐（基于当前状态）

3. **创建空窗可视化组件** `src/components/orchestration/GapVisualizer.vue`
   - 时间轴展示空窗
   - 空窗状态（待处理/处理中/已完成）
   - 点击跳转到对应位置

4. **重构对话面板** `src/components/dialogue/ChatPanel.vue`
   - 支持澄清模式交互
   - 显示命令预览
   - 显示解释信息

**验收标准**：
- [ ] 进度组件能显示空窗级进度
- [ ] 任务模式选择器可用
- [ ] 空窗可视化正确展示

#### Day 10：集成测试与优化

**目标**：端到端集成和性能优化

**任务清单**：

1. **集成测试**
   - 完整生成流程测试
   - 局部补排流程测试
   - 微调命令测试
   - 回退机制测试
   - 修补机制测试

2. **性能优化**
   - Prompt 缓存优化
   - 候选检索缓存
   - 上下文复用

3. **边界情况处理**
   - 空节目单处理
   - 全天空窗处理
   - 无候选情况处理
   - 连续校验失败处理

4. **文档更新**
   - API 文档更新
   - 使用手册更新
   - 架构图更新

**验收标准**：
- [ ] 所有核心流程端到端跑通
- [ ] 性能满足使用要求
- [ ] 文档同步更新

---

## 三、技术架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                        用户交互层                                 │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────┐ │
│  │ 编排页面    │  │ 对话面板    │  │ 任务模式   │  │ 空窗可视│ │
│  │ (create.vue)│  │ (ChatPanel) │  │ 选择器     │  │ 化组件  │ │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └────┬────┘ │
└─────────┼────────────────┼────────────────┼──────────────┼──────┘
          │                │                │              │
          └────────────────┴────────────────┴──────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      统一任务判别器                               │
│              (TaskClassifier - 6种模式识别)                      │
└─────────────────────────────┬───────────────────────────────────┘
                              │
          ┌───────────────────┼───────────────────┐
          ▼                   ▼                   ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│  full_generate  │  │ partial_generate│  │   micro_edit    │
│   (完整生成)     │  │   (局部补排)     │  │   (局部微调)     │
└────────┬────────┘  └────────┬────────┘  └────────┬────────┘
         │                    │                    │
         └────────────────────┼────────────────────┘
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      编排控制器 (Orchestrator)                   │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────┐ │
│  │ Planning    │  │   空窗管理   │  │   状态机    │  │  进度追踪│ │
│  │ Session     │  │  (GapQueue) │  │             │  │         │ │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────┘ │
└─────────────────────────────┬───────────────────────────────────┘
                              │
                              ▼ (空窗驱动循环)
┌─────────────────────────────────────────────────────────────────┐
│                      LLM 决策层 (单轮局部决策)                    │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────┐ │
│  │ PlanCommand │  │QueryCandidates│ │ FillItem   │  │ Repair  │ │
│  │  (策略初始化)│  │  (候选检索)   │  │ (单条选择) │  │(修复策略)│ │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────┘ │
└─────────────────────────────┬───────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      编排代理接口层                               │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────┐ │
│  │  读取接口   │  │  预演接口   │  │  执行接口   │  │ 解释接口│ │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────┘ │
└─────────────────────────────┬───────────────────────────────────┘
                              │
          ┌───────────────────┼───────────────────┐
          ▼                   ▼                   ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│   确定性物化器   │  │    原子能力层    │  │   校验引擎      │
│  (Materializer) │  │(AtomicCapabilities)│ │(ValidationEngine)│
│                 │  │                 │  │                 │
│ • 补齐系统字段  │  │ • append_items  │  │ • 空窗检测      │
│ • 计算时间边界  │  │ • replace_item  │  │ • 重叠检测      │
│ • 生成业务对象  │  │ • delete_item   │  │ • 边界匹配      │
│                 │  │ • move_item     │  │ • 关联检测      │
└─────────────────┘  └─────────────────┘  └─────────────────┘
          │                    │                    │
          └────────────────────┼────────────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                      回退与修补机制                               │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │ 条目级回退  │  │ 空窗级回退  │  │      有限轮次修补        │  │
│  │ (换候选)    │  │ (回退若干条)│  │  (最多3轮，超限转人工)    │  │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 四、关键数据结构

### 4.1 任务判别结果

```typescript
interface TaskClassification {
  mode: 'full_generate' | 'partial_generate' | 'micro_edit' 
      | 'validate_only' | 'repair_only' | 'clarify'
  confidence: number           // 置信度
  reasoning: string            // 判别理由
  suggestedParams?: {
    targetGaps?: string[]      // 目标空窗ID列表
    targetItems?: string[]     // 目标条目ID列表
    userIntent?: string        // 解析后的用户意图
  }
}
```

### 4.2 空窗信息

```typescript
interface GapInfo {
  id: string                   // 空窗唯一标识
  startTime: string            // 开始时间 (ISO 8601)
  endTime: string              // 结束时间
  duration: number             // 时长（秒）
  precedingItemId?: string     // 前邻条目ID
  followingItemId?: string     // 后邻条目ID
  constraints: {
    allowedTypes?: string[]    // 允许的节目类型
    minDuration?: number       // 最小时长
    maxDuration?: number       // 最大时长
    fixedStart?: boolean       // 开始时间是否固定
    fixedEnd?: boolean         // 结束时间是否固定
  }
  metadata: {
    source: 'layout' | 'fixed' | 'manual' | 'generated'
    priority: number           // 处理优先级
  }
}
```

### 4.3 编排会话

```typescript
interface PlanningSession {
  id: string
  channelId: string
  date: string
  status: 'initializing' | 'planning' | 'filling' | 'repairing' | 'completed' | 'failed'
  
  // 策略配置
  strategy: {
    target: string
    referencePriority: string[]
    allowFiller: boolean
    riskPreference: 'conservative' | 'balanced' | 'aggressive'
  }
  
  // 状态追踪
  gaps: {
    pending: GapInfo[]         // 待处理空窗
    processing?: GapInfo       // 当前处理中
    completed: string[]        // 已处理空窗ID
  }
  
  // 执行追踪
  execution: {
    totalCommands: number
    successfulCommands: number
    failedCommands: number
    fallbackCount: number
    repairRounds: number
  }
  
  // 日志
  logs: PlanningLogEntry[]
}
```

### 4.4 校验报告

```typescript
interface ValidationReport {
  scope: 'item' | 'gap' | 'full'
  targetId: string
  timestamp: string
  
  issues: ValidationIssue[]
  
  summary: {
    totalIssues: number
    criticalCount: number
    warningCount: number
    infoCount: number
  }
  
  // 修复建议
  repairActions: RepairAction[]
}

interface ValidationIssue {
  type: 'gap' | 'overlap' | 'boundary_mismatch' | 'material_missing' 
      | 'product_missing' | 'duration_mismatch'
  severity: 'critical' | 'warning' | 'info'
  message: string
  location: {
    itemId?: string
    gapId?: string
    timeRange?: { start: string; end: string }
  }
  suggestion?: string
}
```

---

## 五、Prompt 模板设计

### 5.1 任务判别 Prompt

```
你是一位电视节目编排助手。请分析当前节目单状态和用户需求，判断任务类型。

【当前节目单状态】
- 频道：{channelName}
- 日期：{date}
- 节目单状态：{empty|partial|complete}
- 当前空窗数：{gapCount}
- 已编排条目数：{itemCount}

【用户输入】
{userInput}

【可选模式】
1. full_generate: 从零生成完整编排单
2. partial_generate: 对当前空窗自动补排
3. micro_edit: 局部增删改查
4. validate_only: 只执行校验
5. repair_only: 只执行修复
6. clarify: 语义不明确，需澄清

请输出 JSON 格式：
{
  "mode": "模式名称",
  "confidence": 0.95,
  "reasoning": "判别理由",
  "suggestedParams": { ... }
}
```

### 5.2 候选检索 Prompt

```
请为当前空窗生成候选检索条件。

【当前空窗】
- 时间段：{startTime} - {endTime}
- 时长：{duration}分钟
- 前邻节目：{precedingItem}
- 后邻节目：{followingItem}

【频道上下文】
- 频道：{channelName}
- 时段类型：{timeSlotType}

【检索条件模板】
请输出 JSON 格式：
{
  "action": "query_candidates",
  "data": {
    "targetTimeRange": { "start": "...", "end": "..." },
    "expectedDuration": { "min": ..., "max": ... },
    "programTypePreference": [...],
    "sequentialPreference": true|false,
    "excludeUsed": true|false,
    "considerRatings": true|false,
    "allowShortFiller": true|false
  },
  "reasoning": "检索策略说明"
}
```

### 5.3 单条选择 Prompt

```
请从候选节目中选择最适合当前空窗的一项。

【当前空窗】
- 时间段：{startTime} - {endTime}
- 时长：{duration}分钟
- 约束：{constraints}

【候选节目】
{candidates}

【选择标准】
1. 时长匹配度
2. 类型适宜性
3. 收视率表现
4. 与前后节目的衔接
5. 是否符合版面要求

请输出 JSON 格式：
{
  "action": "fill_item",
  "data": {
    "gapId": "空窗ID",
    "selectedCandidateId": "候选ID",
    "selectionReason": "选择理由（简短）"
  },
  "reasoning": "详细选择逻辑"
}
```

---

## 六、风险与应对

| 风险 | 影响 | 应对措施 |
|------|------|----------|
| LLM 响应不稳定 | 编排中断 | 增加重试机制，超时降级 |
| 候选质量差 | 编排效果差 | 多源检索 + 人工候选池 |
| 校验频繁失败 | 陷入修补循环 | 有限轮次 + 及时转人工 |
| 上下文过长 | 性能下降 | 局部上下文 + 缓存优化 |
| 用户意图理解错误 | 执行错误操作 | 命令预览 + 确认机制 |

---

## 七、里程碑检查点

### Checkpoint 1（Day 2 结束）
- [ ] 任务判别器能正确识别模式
- [ ] 空窗驱动框架跑通
- [ ] 物化器能生成正确业务对象

### Checkpoint 2（Day 4 结束）
- [ ] 新命令体系全部实现
- [ ] 原子能力层可用
- [ ] 校验引擎输出结构化报告

### Checkpoint 3（Day 6 结束）
- [ ] 三级回退机制可用
- [ ] 有限轮次修补跑通
- [ ] 端到端单空窗填充成功

### Checkpoint 4（Day 8 结束）
- [ ] 所有接口层实现
- [ ] 数据服务集成完成
- [ ] 解释功能可用

### Checkpoint 5（Day 10 结束）
- [ ] 完整生成流程跑通
- [ ] UI 重构完成
- [ ] 集成测试通过

---

## 八、与现有代码的兼容策略

1. **类型定义兼容**：新类型定义扩展而非替换
2. **服务层并行**：新服务与旧服务并存，逐步迁移
3. **UI 组件渐进**：新组件开发完成后替换旧组件
4. **数据层复用**：复用现有 `ScheduleItem` 等数据结构
5. **API 兼容**：新接口层封装现有 API，不直接修改

---

## 九、总结

本开发计划基于新技术方案，采用**空窗驱动、系统控制、LLM 局部决策**的架构，通过10天里程碑式开发，逐步实现：

1. **核心架构**：任务判别器 + 空窗驱动 + 确定性物化
2. **命令体系**：精简的命令类型 + 原子能力执行
3. **健壮机制**：三级回退 + 有限轮次修补
4. **标准接口**：读取/预演/执行/解释四层接口
5. **用户界面**：任务模式选择 + 空窗可视化 + 对话交互

该方案确保 LLM 只参与"理解、筛选、选择和解释"，而精确执行、规则判定和状态控制由确定性系统完成，实现可控、可验证、可修复的自动编排体系。
