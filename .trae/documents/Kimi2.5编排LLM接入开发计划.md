# Kimi 2.5 编排LLM接入开发计划

> **版本**: v1.0  
> **日期**: 2026-03-24  
> **目标**: 接入字节Code Plan中的Kimi 2.5作为编排底层LLM，实现完整的LLM自动编排功能

---

## 一、接入方案概述

### 1.1 Kimi 2.5 API 配置

根据字节Code Plan环境，Kimi 2.5的接入配置：

```typescript
// 字节Code Plan环境配置
const CODE_PLAN_LLM_CONFIG = {
  baseURL: process.env.VITE_CODE_PLAN_LLM_BASE_URL || 'https://api.moonshot.cn/v1',
  apiKey: process.env.VITE_CODE_PLAN_LLM_API_KEY || '',
  model: 'kimi-k2.5',  // 或根据Code Plan提供的模型ID
  temperature: 0.3,
  maxTokens: 8192,
  timeout: 60000  // 60秒超时
}
```

### 1.2 架构设计

```
┌─────────────────────────────────────────────────────────────────┐
│                    字节Code Plan环境                             │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              Kimi 2.5 LLM Service                       │   │
│  │  · 模型: kimi-k2.5                                      │   │
│  │  · 上下文: 32K tokens                                   │   │
│  │  · 输出: JSON结构化命令                                  │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              │                                  │
│                              ▼                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              LLM Client Adapter                         │   │
│  │  · OpenAI SDK兼容层                                     │   │
│  │  · 请求/响应拦截                                        │   │
│  │  · 错误重试机制                                         │   │
│  │  · Token使用量统计                                       │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              │                                  │
└──────────────────────────────┼──────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                    广电编排系统                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              Prompt Builder                             │   │
│  │  · Phase 1: 规划模式                                     │   │
│  │  · Phase 2: 渐进式填充（两阶段）                          │   │
│  │  · Phase 3: 修补模式                                     │   │
│  │  · 对话微调模式                                          │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              │                                  │
│                              ▼                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              Orchestrator（编排调度器）                   │   │
│  │  · Phase 0: 初始化                                       │   │
│  │  · Phase 1: 规划（1次LLM调用）                           │   │
│  │  · Phase 2: 渐进式填充（N×2次LLM调用）                    │   │
│  │  · Phase 3: 修补（0~M次LLM调用）                         │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

---

## 二、开发阶段规划

### 阶段一：LLM基础设施搭建（第1天）

#### 任务 1.1: LLM客户端封装
**优先级**: P0  
**预计耗时**: 4小时

**文件**: `src/services/llm/llmClient.ts`

**功能实现**:
- [ ] OpenAI SDK初始化（兼容Moonshot API）
- [ ] 字节Code Plan环境配置读取
- [ ] 请求拦截器（添加认证头）
- [ ] 响应拦截器（错误处理）
- [ ] 重试机制（指数退避，最多3次）
- [ ] Token使用量统计
- [ ] 流式响应支持（可选）

**配置读取优先级**:
1. 环境变量 `VITE_CODE_PLAN_LLM_API_KEY`
2. 环境变量 `VITE_CODE_PLAN_LLM_BASE_URL`
3. 用户手动配置（本地存储）

**代码结构**:
```typescript
export class LLMClient {
  private client: OpenAI
  private config: LLMConfig
  
  constructor(config?: Partial<LLMConfig>)
  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<LLMResponse>
  async chatStream(messages: ChatMessage[], options?: ChatOptions): AsyncGenerator<string>
  getTokenUsage(): TokenUsage
}
```

---

#### 任务 1.2: LLM配置管理
**优先级**: P0  
**预计耗时**: 2小时

**文件**: `src/services/llm/llmConfig.ts`

**功能实现**:
- [ ] 默认配置定义
- [ ] 环境变量读取
- [ ] 本地存储持久化
- [ ] 配置验证
- [ ] 连接测试功能

**配置界面**:
- API Key输入（密码框）
- Base URL输入
- 模型选择（kimi-k2.5 / kimi-k2.5-32k）
- 温度调节（0.0-1.0）
- 连接测试按钮

---

### 阶段二：Prompt工程（第2天）

#### 任务 2.1: 系统Prompt设计
**优先级**: P0  
**预计耗时**: 6小时

**文件**: `src/services/llm/prompts/systemPrompts.ts`

**四种系统Prompt**:

**1. 编排专家角色（Phase 1-3）**:
```
你是广电节目编排专家，负责为电视频道生成每日串联单。

你的职责：
1. 根据频道属性、版面参考、历史数据制定编排计划
2. 将全天拆分为15-20个时段块
3. 为每个时段块选择合适的节目
4. 确保编排符合业务规则和约束

约束条件：
- 黄金时段（19:00-22:00）必须安排高收视率节目
- 广告必须成组出现，每组2-5条
- 直播节目必须匹配可用演播室
- 节目时长必须匹配时段块

输出格式：
你必须输出JSON格式的命令，不要输出任何解释性文字。
```

**2. 对话助手角色（对话微调）**:
```
你是广电编排助手，帮助用户通过自然语言修改串联单。

你的职责：
1. 理解用户的自然语言意图
2. 识别涉及的节目、时间、操作类型
3. 将意图转换为标准化的ScheduleCommand
4. 在不确定时提出澄清问题

支持的意图类型：
- INSERT: 插入节目
- DELETE: 删除节目
- REPLACE: 替换节目
- SWAP: 交换位置
- MOVE: 移动位置
- UPDATE_FIELD: 更新字段
- SHIFT_TIME: 调整时间

输出格式：
你必须输出JSON格式的命令或澄清问题。
```

---

#### 任务 2.2: 上下文构建器
**优先级**: P0  
**预计耗时**: 4小时

**文件**: `src/services/llm/contextBuilder.ts`

**功能实现**:
- [ ] 版面参考摘要生成
- [ ] 历史串联单摘要
- [ ] 节目库过滤（按频道+时段）
- [ ] 当前串联单摘要
- [ ] 空窗列表格式化
- [ ] Token预算管理

**上下文压缩策略**:
```typescript
interface ContextBudget {
  maxTokens: number
  reservedForOutput: number
  availableForInput: number
}

// 优先级排序（高→低）
// 1. 当前空窗信息（必须）
// 2. 版面参考摘要（高优先级）
// 3. 候选节目列表（高优先级）
// 4. 历史数据摘要（中优先级）
// 5. 完整节目库（低优先级，按需加载）
```

---

#### 任务 2.3: Prompt构建器
**优先级**: P0  
**预计耗时**: 6小时

**文件**: `src/services/llm/promptBuilder.ts`

**四种Prompt模式**:

**1. Phase 1 - 规划模式**:
```typescript
buildPlanningPrompt(context: PlanningContext): ChatMessage[]
// 输入：频道信息、版面参考、历史数据
// 输出：PlanCommand（15-20个TimeBlock）
```

**2. Phase 2 - 渐进式填充（两阶段）**:
```typescript
// 阶段1：查询候选
buildQueryCandidatesPrompt(gap: GapInfo, context: Context): ChatMessage[]
// 输出：QueryCandidatesCommand

// 阶段2：选择填充
buildFillItemPrompt(gap: GapInfo, candidates: ProgramCandidate[], context: Context): ChatMessage[]
// 输出：FillItemCommand
```

**3. Phase 3 - 修补模式**:
```typescript
buildRepairPrompt(errors: ValidationError[], items: ScheduleItem[]): ChatMessage[]
// 输出：修补命令（insert/replace/delete等）
```

**4. 对话微调模式**:
```typescript
buildDialoguePrompt(userInput: string, context: DialogueContext): ChatMessage[]
// 输出：ScheduleCommand 或 ClarificationQuestion
```

---

### 阶段三：响应解析与命令执行（第3天）

#### 任务 3.1: 响应解析器
**优先级**: P0  
**预计耗时**: 4小时

**文件**: `src/services/llm/responseParser.ts`

**功能实现**:
- [ ] 去除代码块包裹（```json）
- [ ] JSON解析错误处理
- [ ] action字段合法性校验
- [ ] 字段完整性校验
- [ ] 类型转换和默认值填充
- [ ] 错误分类和报告

**支持的Command类型验证**:
```typescript
const COMMAND_VALIDATORS: Record<string, (data: any) => boolean> = {
  'plan': (d) => Array.isArray(d.blocks) && d.blocks.length > 0,
  'fill_item': (d) => d.selectedProgram?.programCode && d.blockId,
  'insert': (d) => Array.isArray(d.items) && d.items.length > 0,
  'delete': (d) => Array.isArray(d.targetIds) && d.targetIds.length > 0,
  // ... 其他命令
}
```

---

#### 任务 3.2: 命令执行器
**优先级**: P0  
**预计耗时**: 4小时

**文件**: `src/services/llm/commandExecutor.ts`

**功能实现**:
- [ ] Command到原子能力的映射
- [ ] 批量命令处理
- [ ] 执行结果收集
- [ ] 错误回滚机制
- [ ] 执行日志记录

**映射关系**:
| Command | 原子能力 |
|---------|---------|
| plan | store.setOrchestrationProgress |
| fill_item | atomicCapabilities.appendItems |
| insert | atomicCapabilities.insertItems |
| delete | atomicCapabilities.deleteItems |
| replace | atomicCapabilities.replaceItems |
| swap | atomicCapabilities.swapItems |
| move | atomicCapabilities.moveItem |
| update_field | atomicCapabilities.updateItemFields |
| batch | 递归执行子命令 |

---

### 阶段四：编排调度器（第4-5天）

#### 任务 4.1: 编排调度器核心
**优先级**: P0  
**预计耗时**: 12小时

**文件**: `src/services/orchestrator.ts`

**功能实现**:

**Phase 0 - 初始化**:
- [ ] 加载版面参考数据
- [ ] 加载历史串联单数据
- [ ] 初始化空窗列表
- [ ] 验证LLM配置

**Phase 1 - 规划**:
- [ ] 构建规划Prompt
- [ ] 调用LLM获取PlanCommand
- [ ] 验证规划结果
- [ ] 渲染编排计划进度面板
- [ ] 等待用户确认（可选）

**Phase 2 - 渐进式填充循环**:
```typescript
async function phase2Filling(gaps: GapInfo[]) {
  for (const gap of gaps) {
    // 阶段1：查询候选
    const queryCmd = await llm.generateQueryCandidates(gap, context)
    const candidates = await atomicCapabilities.queryCandidatesByMultiSource(queryCmd.searchCriteria)
    
    // 阶段2：选择填充
    const fillCmd = await llm.generateFillItem(gap, candidates, context)
    const program = await atomicCapabilities.getProgramByCode(fillCmd.selectedProgram.programCode)
    
    // 构建并执行
    const scheduleItem = buildScheduleItem(program, gap)
    await atomicCapabilities.appendItems([scheduleItem])
    
    // 更新进度
    updateProgress(gap.gapId, 'completed')
    
    // 检查用户中断
    if (isCancelled) break
  }
}
```

**Phase 3 - 修补**:
- [ ] 执行最终全量校验
- [ ] 若存在错误，生成修补Prompt
- [ ] 调用LLM获取修补命令
- [ ] 执行修补（最多3轮）
- [ ] 报告修补结果

---

#### 任务 4.2: 进度管理
**优先级**: P1  
**预计耗时**: 4小时

**文件**: `src/composables/useOrchestrator.ts`

**功能实现**:
- [ ] 编排状态管理
- [ ] 进度计算
- [ ] 错误收集
- [ ] 用户中断处理
- [ ] 重试机制

**状态流转**:
```
idle → planning → filling → repairing → completed
       ↓           ↓          ↓
     error      error      error
       ↓           ↓          ↓
     cancelled  cancelled  cancelled
```

---

### 阶段五：对话微调系统（第6天）

#### 任务 5.1: 意图识别系统
**优先级**: P1  
**预计耗时**: 6小时

**文件**: `src/services/dialogue/intentRecognizer.ts`

**功能实现**:
- [ ] 意图分类（规则+LLM混合）
- [ ] 参数提取（时间、节目、数量）
- [ ] 实体链接（节目名→ScheduleItem ID）
- [ ] 置信度评估
- [ ] 多轮对话支持

**意图分类体系**:
```typescript
enum IntentType {
  INSERT = 'insert',           // "在X之后加Y"
  DELETE = 'delete',           // "删掉X"
  REPLACE = 'replace',         // "把X换成Y"
  UPDATE_FIELD = 'update_field', // "把X的备注改成Y"
  SWAP = 'swap',               // "把X和Y对调"
  MOVE = 'move',               // "把X移到Y之后"
  SHIFT_TIME = 'shift_time',   // "X后移30秒"
  BATCH_UPDATE = 'batch_update', // "把12:00以后的全变成广告"
  QUERY = 'query',             // "查询X"
  CLARIFICATION = 'clarification', // 需要澄清
  UNKNOWN = 'unknown'          // 未知意图
}
```

---

#### 任务 5.2: 对话上下文管理
**优先级**: P1  
**预计耗时**: 4小时

**文件**: `src/services/dialogue/dialogueContext.ts`

**功能实现**:
- [ ] 对话历史存储
- [ ] 上下文窗口管理
- [ ] 澄清状态跟踪
- [ ] 意图确认机制

---

### 阶段六：UI组件开发（第7-9天）

#### 任务 6.1: LLM配置面板
**优先级**: P0  
**预计耗时**: 4小时

**文件**: `src/components/llm/LLMConfigPanel.vue`

**功能实现**:
- [ ] API Key输入（密码框）
- [ ] Base URL输入
- [ ] 模型选择下拉框
- [ ] 温度滑块
- [ ] 连接测试按钮
- [ ] 配置保存/加载

---

#### 任务 6.2: 编排进度面板
**优先级**: P0  
**预计耗时**: 6小时

**文件**: `src/components/orchestration/OrchestrationProgress.vue`

**功能实现**:
- [ ] 时段块列表（TodoList样式）
- [ ] 状态标识（待填充/进行中/完成/错误）
- [ ] 当前执行块高亮
- [ ] 错误块标记
- [ ] 总体进度百分比
- [ ] 取消编排按钮
- [ ] 实时日志输出

---

#### 任务 6.3: LLM对话面板
**优先级**: P0  
**预计耗时**: 8小时

**文件**: `src/components/dialogue/ChatPanel.vue`

**功能实现**:
- [ ] 消息列表（用户/AI）
- [ ] 命令预览卡片
- [ ] 确认/取消按钮
- [ ] 澄清问题展示
- [ ] 快捷指令按钮
- [ ] 输入框 + 发送
- [ ] 对话历史

---

#### 任务 6.4: 校验报告面板
**优先级**: P1  
**预计耗时**: 4小时

**文件**: `src/components/validation/ValidationPanel.vue`

**功能实现**:
- [ ] 统计概览
- [ ] 按规则分组错误列表
- [ ] 点击定位
- [ ] 一键修复按钮

---

### 阶段七：与现有系统集成（第10天）

#### 任务 7.1: 集成到create.vue
**优先级**: P0  
**预计耗时**: 6小时

**修改文件**: `src/views/broadcast-plan/create.vue`

**集成内容**:
- [ ] 顶部工具栏添加"AI智能编排"按钮
- [ ] 编排确认对话框
- [ ] 编排进度抽屉
- [ ] 对话面板Tab页
- [ ] 校验报告Tab页

---

#### 任务 7.2: 表格异常高亮
**优先级**: P0  
**预计耗时**: 4小时

**修改文件**: `src/components/ScheduleTable.vue`

**功能实现**:
- [ ] 行级CSS类动态绑定
- [ ] 单元格级异常标记
- [ ] Tooltip错误信息
- [ ] 多错误叠加样式

---

### 阶段八：测试与优化（第11-12天）

#### 任务 8.1: 端到端测试
**优先级**: P0  
**预计耗时**: 6小时

**测试场景**:
- [ ] 完整编排流程（新闻综合频道）
- [ ] 对话微调流程
- [ ] 校验错误自动修复
- [ ] 边界情况处理

---

#### 任务 8.2: 性能优化
**优先级**: P1  
**预计耗时**: 4小时

**优化方向**:
- [ ] LLM响应缓存
- [ ] 并行填充优化
- [ ] 上下文压缩

---

## 三、字节Code Plan环境配置

### 3.1 环境变量

```bash
# .env.development
VITE_CODE_PLAN_LLM_BASE_URL=https://api.moonshot.cn/v1
VITE_CODE_PLAN_LLM_API_KEY=your_api_key_here
VITE_CODE_PLAN_LLM_MODEL=kimi-k2.5
```

### 3.2 配置读取代码

```typescript
// src/services/llm/llmConfig.ts
export function loadCodePlanConfig(): LLMConfig {
  return {
    baseURL: import.meta.env.VITE_CODE_PLAN_LLM_BASE_URL || 'https://api.moonshot.cn/v1',
    apiKey: import.meta.env.VITE_CODE_PLAN_LLM_API_KEY || '',
    model: import.meta.env.VITE_CODE_PLAN_LLM_MODEL || 'kimi-k2.5',
    temperature: 0.3,
    maxTokens: 8192
  }
}
```

---

## 四、项目文件结构

```
src/
├── services/
│   ├── llm/
│   │   ├── llmClient.ts           # LLM客户端
│   │   ├── llmConfig.ts           # 配置管理
│   │   ├── promptBuilder.ts       # Prompt构建器
│   │   ├── contextBuilder.ts      # 上下文构建
│   │   ├── responseParser.ts      # 响应解析
│   │   └── prompts/
│   │       ├── systemPrompts.ts   # 系统Prompt
│   │       └── templates.ts       # Prompt模板
│   ├── dialogue/
│   │   ├── intentRecognizer.ts    # 意图识别
│   │   ├── entityLinker.ts        # 实体链接
│   │   └── dialogueContext.ts     # 对话上下文
│   ├── orchestrator.ts            # 编排调度器
│   └── commandExecutor.ts         # 命令执行器
├── components/
│   ├── llm/
│   │   └── LLMConfigPanel.vue     # LLM配置面板
│   ├── orchestration/
│   │   └── OrchestrationProgress.vue  # 编排进度
│   ├── dialogue/
│   │   └── ChatPanel.vue          # 对话面板
│   └── validation/
│       └── ValidationPanel.vue    # 校验报告
├── composables/
│   ├── useOrchestrator.ts         # 编排组合式函数
│   └── useLLMChat.ts              # 对话组合式函数
└── ...
```

---

## 五、里程碑

### 里程碑1：LLM基础设施（第1天）
- [ ] LLM客户端封装完成
- [ ] 配置管理实现
- [ ] 连接测试通过

### 里程碑2：Prompt工程（第2天）
- [ ] 四种Prompt模式实现
- [ ] 上下文构建器完成
- [ ] Token预算管理

### 里程碑3：编排核心（第5天）
- [ ] 编排调度器实现
- [ ] Phase 1-3流程跑通
- [ ] 进度管理完成

### 里程碑4：对话系统（第6天）
- [ ] 意图识别实现
- [ ] 多轮对话支持
- [ ] 命令执行完成

### 里程碑5：UI组件（第9天）
- [ ] 所有UI组件完成
- [ ] 与create.vue集成
- [ ] 表格高亮实现

### 里程碑6：测试交付（第12天）
- [ ] 端到端测试通过
- [ ] 性能优化完成
- [ ] 文档完善

---

## 六、风险与应对

| 风险 | 概率 | 影响 | 应对 |
|------|------|------|------|
| Code Plan环境API限制 | 中 | 高 | 提前申请权限，准备备用方案 |
| Kimi 2.5响应不稳定 | 中 | 中 | 增加重试机制，降级处理 |
| Token限制导致上下文截断 | 高 | 中 | 上下文压缩，分页加载 |
| 编排质量不达标 | 中 | 高 | 增加人工确认环节，迭代优化Prompt |

---

*计划版本: v1.0*  
*最后更新: 2026-03-24*
