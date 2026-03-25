# 广电节目串联单 LLM 自动编排 — 开发计划

> **版本**: v1.0  
> **日期**: 2026-03-24  
> **目标**: 基于需求文档实现完整的LLM自动编排演示原型

---

## 一、项目概述

### 1.1 核心目标
实现一个基于LLM的广电节目串联单自动编排系统，支持：
- AI智能编排：分步规划 + 渐进式填充
- 实时校验：6条硬性校验规则
- 对话微调：自然语言指令修改编排
- 可视化进度：编排过程实时展示

### 1.2 技术栈
- **前端框架**: Vue 3 + TypeScript + Vite
- **UI组件库**: Element Plus
- **状态管理**: Pinia
- **LLM接口**: Kimi K2.5 (Moonshot API)
- **样式**: 组件库内置 + 自定义CSS

### 1.3 与现有系统集成
- 基于现有 `create.vue` 页面扩展
- 复用现有频道选择、日期选择、表格展示逻辑
- 新增AI编排按钮、进度面板、对话面板

---

## 二、开发阶段规划

### 阶段一：基础架构搭建（第1-2天）

#### 任务 1.1: 项目初始化与依赖安装
**优先级**: P0  
**预计耗时**: 2小时

**工作内容**:
1. 初始化项目结构
2. 安装核心依赖
3. 配置TypeScript路径别名
4. 设置开发环境变量

**依赖清单**:
```bash
# LLM SDK
npm install openai

# 状态管理
npm install pinia

# 工具库
npm install lodash-es dayjs uuid
npm install -D @types/lodash-es @types/uuid
```

**交付物**:
- [ ] `package.json` 更新
- [ ] `vite.config.ts` 路径配置
- [ ] `.env.development` 环境变量模板

---

#### 任务 1.2: 类型定义系统
**优先级**: P0  
**预计耗时**: 4小时

**工作内容**:
创建 `src/types/` 目录下的所有类型定义文件

**文件清单**:
```
src/types/
├── channel.ts          # 频道类型
├── program.ts          # 节目库类型
├── layout.ts           # 版面参考类型
├── rundown.ts          # RundownItem (LLM输出)
├── schedule.ts         # ScheduleItem (前端渲染)
├── command.ts          # ScheduleCommand 命令协议
├── validation.ts       # 校验规则类型
├── mutation.ts         # 操作结果类型
├── gap.ts              # 空窗信息类型
└── intent.ts           # 意图识别类型
```

**关键类型**:
- `duration` 单位统一为**秒**（number）
- 时间格式统一为 `HH:mm:ss`
- RundownItem 必须包含 `endTime` 字段

**交付物**:
- [ ] 9个类型定义文件
- [ ] 类型导出索引 `src/types/index.ts`

---

#### 任务 1.3: Mock数据生成系统
**优先级**: P0  
**预计耗时**: 6小时

**工作内容**:
创建种子数据生成脚本，生成2000+条节目库数据

**文件清单**:
```
src/mock/
├── generateSeedData.ts     # 主生成脚本
├── seedData.ts             # 静态种子数据
├── channelData.ts          # 频道配置
├── layoutData.ts           # 版面参考数据
└── utils.ts                # 生成工具函数
```

**生成规则**:
- 6个频道：新闻综合、东方卫视、第一财经、五星体育、纪实人文、哈哈炫动
- 节目库约2000条（按频道分布）
- 广告库约150条（15s/30s/60s规格）
- 宣传片库约250条

**交付物**:
- [ ] 数据生成脚本
- [ ] `npm run seed` 命令配置
- [ ] 生成的JSON数据文件（gitignore）

---

### 阶段二：Layer 1 - 原子能力层（第3-4天）

#### 任务 2.1: 原子能力接口实现
**优先级**: P0  
**预计耗时**: 8小时

**工作内容**:
实现所有原子能力接口，操作Pinia Store中的内存数据

**文件**: `src/services/atomicCapabilities.ts`

**接口清单**:

**查询类 (Q01-Q11)**:
- [ ] `getChannels()` - 获取频道列表
- [ ] `getStudios(channelId)` - 获取演播室列表
- [ ] `getProgramLibrary()` - 获取节目库
- [ ] `getLayoutReference(channelId)` - 获取版面参考
- [ ] `getChannelBroadcastConfig(channelId)` - 获取播出时段配置
- [ ] `getScheduleItems()` - 获取当前串联单
- [ ] `queryScheduleItems(query)` - 条件查询
- [ ] `getProgramByCode(code18)` - 按编码查询节目
- [ ] `queryRemainingGaps()` - 查询剩余空窗
- [ ] `queryCandidatesByMultiSource(params)` - 多源检索候选节目
- [ ] `getHistoricalSchedule(type)` - 获取历史串联单

**操作类 (M01-M09)**:
- [ ] `batchSetSchedule(items)` - 批量写入
- [ ] `appendItems(items)` - 追加条目
- [ ] `insertItems(params)` - 插入条目
- [ ] `deleteItems(params)` - 删除条目
- [ ] `replaceItems(params)` - 替换条目
- [ ] `swapItems(params)` - 交换条目
- [ ] `updateItemFields(params)` - 更新字段
- [ ] `moveItem(params)` - 移动条目
- [ ] `recalculateTimesFrom(params)` - 时间级联重算

**交付物**:
- [ ] 完整的AtomicCapabilities接口实现
- [ ] 每个操作后自动触发校验
- [ ] 返回MutationResult（含校验报告）

---

#### 任务 2.2: Pinia Store实现
**优先级**: P0  
**预计耗时**: 6小时

**文件清单**:
```
src/stores/
├── scheduleStore.ts        # 串联单 + 校验报告 + 编排进度
├── channelStore.ts         # 频道/节目库
└── llmConfigStore.ts       # LLM配置
```

**scheduleStore核心状态**:
```typescript
interface ScheduleState {
  items: ScheduleItem[]           # 当前串联单条目
  validationReport: ValidationReport | null  # 最新校验报告
  orchestrationProgress: {
    phase: 'idle' | 'planning' | 'filling' | 'repairing' | 'completed'
    currentBlockId: string | null
    completedBlocks: string[]
    totalBlocks: number
    errors: string[]
  }
  gaps: GapInfo[]                 # 当前空窗列表
}
```

**交付物**:
- [ ] 3个Store实现
- [ ] Store间依赖关系处理
- [ ] 持久化配置（可选）

---

### 阶段三：Layer 3 - 系统校验层（第5天）

#### 任务 3.1: 校验引擎实现
**优先级**: P0  
**预计耗时**: 8小时

**文件**: `src/services/validationEngine.ts`

**六条校验规则实现**:

**V1 - 空窗检测**:
```typescript
function checkV1_NoGap(items: ScheduleItem[]): ValidationError[]
// 检测相邻条目间是否存在时间间隙
// severity: error
```

**V2 - 时间重叠检测**:
```typescript
function checkV2_Overlap(items: ScheduleItem[]): ValidationError[]
// 检测相邻条目是否存在时间重叠
// severity: error
// 注意：与V1互斥，不重复检测
```

**V3 - 首尾时间匹配**:
```typescript
function checkV3_BoundaryMatch(
  items: ScheduleItem[],
  channelConfig: { startTime: string; endTime: string }
): ValidationError[]
// 检测第一条startTime和最后一条endTime是否匹配频道配置
// severity: error
```

**V4 - 成品关联检测**:
```typescript
function checkV4_ProductLinked(
  items: ScheduleItem[],
  programLibrary: ProgramLibraryItem[]
): ValidationError[]
// program类型必须关联有效成品
// severity: program→error, ad/promo→warning
// 失败时设置 item.isUnlinkedProduct = true
```

**V5 - 成品素材关联**:
```typescript
function checkV5_MaterialLinked(
  items: ScheduleItem[],
  programLibrary: ProgramLibraryItem[]
): ValidationError[]
// 已关联成品的条目，成品必须已关联素材
// severity: warning
// 失败时设置 item.isMaterialInfoEmpty = true
```

**V6 - 时长一致性**:
```typescript
function checkV6_DurationMatch(items: ScheduleItem[]): ValidationError[]
// endTime - startTime 必须等于 duration
// 允许1秒舍入误差
// severity: error
```

**交付物**:
- [ ] 6条校验规则实现
- [ ] `validateSchedule()` 主函数
- [ ] 校验报告生成
- [ ] 按条目ID索引的错误查询

---

#### 任务 3.2: 校验结果与UI联动
**优先级**: P1  
**预计耗时**: 4小时

**文件**: `src/composables/useValidation.ts`

**功能**:
- [ ] 根据校验报告生成行级CSS类
- [ ] 错误tooltip内容生成
- [ ] 校验报告面板数据转换
- [ ] 点击错误定位到表格行

**异常高亮规则**:
| 规则 | CSS类 | 样式 |
|------|-------|------|
| V1 | `row-error-gap` | 红色虚线下边框 |
| V2 | `row-error-overlap` | 红色底色 |
| V3 | `row-error-boundary` | 红色边框 |
| V4 | `row-error-product` | 编码列橙色边框 |
| V5 | `row-warning-material` | 素材列黄色底色 |
| V6 | `row-error-duration` | 时长列红色文字 |

**交付物**:
- [ ] useValidation composable
- [ ] 表格行样式联动
- [ ] 校验报告面板组件

---

### 阶段四：Layer 2 - LLM意图层（第6-9天）

#### 任务 4.1: LLM客户端封装
**优先级**: P0  
**预计耗时**: 4小时

**文件**: `src/services/llmClient.ts`

**功能**:
- [ ] OpenAI SDK封装（兼容Moonshot API）
- [ ] 配置管理（API Key、模型、温度等）
- [ ] 请求/响应拦截
- [ ] 错误重试机制
- [ ] Token使用量统计

**配置**:
```typescript
const DEFAULT_LLM_CONFIG = {
  baseURL: 'https://api.moonshot.cn/v1',
  apiKey: '',
  model: 'kimi-k2.5',
  temperature: 0.3,
  maxTokens: 8192
}
```

**交付物**:
- [ ] LLM客户端实现
- [ ] 流式响应支持（可选）
- [ ] 错误处理

---

#### 任务 4.2: Prompt构建器
**优先级**: P0  
**预计耗时**: 8小时

**文件**: `src/services/promptBuilder.ts`

**四种Prompt模式**:

**1. Phase 1 - 规划模式**:
- 输入：频道信息 + 版面参考摘要
- 输出：PlanCommand（15-20个TimeBlock）
- System Prompt：编排专家角色定义

**2. Phase 2 - 渐进式填充（两阶段）**:

*阶段1 - 查询候选*:
- 输入：空窗信息 + 上下文
- 输出：QueryCandidatesCommand（筛选条件）

*阶段2 - 选择填充*:
- 输入：候选列表 + 上下文
- 输出：FillItemCommand（选中的节目）

**3. Phase 3 - 修补模式**:
- 输入：校验错误信息 + 当前串联单
- 输出：修补命令（insert/replace/delete等）

**4. 对话微调模式**:
- 输入：用户自然语言 + 上下文摘要
- 输出：ScheduleCommand

**交付物**:
- [ ] 4种Prompt构建函数
- [ ] 上下文摘要生成（避免全量200+条注入）
- [ ] 节目库过滤（按频道+时段）

---

#### 任务 4.3: 响应解析器
**优先级**: P0  
**预计耗时**: 4小时

**文件**: `src/services/responseParser.ts`

**功能**:
- [ ] 去除代码块包裹（```json）
- [ ] JSON.parse解析
- [ ] action字段合法性校验
- [ ] 根据action类型校验必要字段
- [ ] 返回类型安全的ScheduleCommand

**支持的Command类型**:
- plan, fill_block, fill_item, query_candidates
- insert, delete, replace, swap, move, update_field
- shift_time, batch_update, batch

**交付物**:
- [ ] 响应解析器实现
- [ ] 错误处理（格式错误、字段缺失）
- [ ] 解析结果类型定义

---

#### 任务 4.4: 编排调度器（核心）
**优先级**: P0  
**预计耗时**: 12小时

**文件**: `src/services/orchestrator.ts`

**功能**: 控制Phase 1→2→3的完整流程

**Phase 0 - 初始化**:
- [ ] 加载版面参考数据
- [ ] 加载历史串联单数据
- [ ] 初始化空窗列表

**Phase 1 - 规划**:
- [ ] 构建规划Prompt
- [ ] 调用LLM获取PlanCommand
- [ ] 渲染编排计划进度面板
- [ ] 等待用户确认

**Phase 2 - 渐进式填充循环**:
```typescript
while (仍有未填充空窗) {
  // 阶段1：查询候选
  const queryCmd = await llm.generateQueryCandidates(context)
  const candidates = await atomicCapabilities.queryCandidatesByMultiSource(queryCmd.searchCriteria)
  
  // 阶段2：选择填充
  const fillCmd = await llm.generateFillItem(context, candidates)
  const program = await atomicCapabilities.getProgramByCode(fillCmd.selectedProgram.programCode)
  
  // 构建RundownItem并转换
  const rundownItem = buildRundownItem(program, gap)
  const scheduleItem = transformRundownToSchedule(rundownItem, date, programLibrary)
  
  // 执行填充
  await atomicCapabilities.appendItems([scheduleItem])
  
  // 更新进度
  updateProgress(blockId, 'completed')
}
```

**Phase 3 - 修补**:
- [ ] 执行最终全量校验
- [ ] 若存在错误，生成修补Prompt
- [ ] 调用LLM获取修补命令
- [ ] 执行修补（最多3轮）

**交付物**:
- [ ] 编排调度器实现
- [ ] 进度更新机制
- [ ] 错误重试逻辑
- [ ] 用户中断处理

---

#### 任务 4.5: 对话微调 - 意图识别系统
**优先级**: P1  
**预计耗时**: 12小时

**文件清单**:
```
src/services/
├── intentRecognizer.ts       # 意图识别主入口
├── paramExtractor.ts         # 参数提取引擎
├── entityLinker.ts           # 实体链接器
├── confidenceEvaluator.ts    # 置信度评估
└── dialogueContext.ts        # 对话上下文管理
```

**意图分类体系**:
- INSERT, DELETE, REPLACE, UPDATE_FIELD
- SWAP, MOVE, SHIFT_TIME
- BATCH_UPDATE, BATCH_REPLACE
- QUERY, CLARIFICATION, UNKNOWN

**核心流程**:
1. 意图分类（LLM或规则）
2. 参数提取（时间、节目、数量）
3. 实体链接（节目名→ScheduleItem ID）
4. 置信度评估
5. 命令生成

**交付物**:
- [ ] 意图识别系统
- [ ] 多轮对话支持
- [ ] 澄清问题生成

---

#### 任务 4.6: 命令执行器
**优先级**: P0  
**预计耗时**: 6小时

**文件**: `src/services/commandExecutor.ts`

**功能**: 将ScheduleCommand映射到原子能力

**映射关系**:
| Command | 原子能力 |
|---------|---------|
| plan | 存储计划到store |
| fill_block/fill_item | appendItems() |
| insert | insertItems() |
| delete | deleteItems() |
| replace | replaceItems() |
| swap | swapItems() |
| move | moveItem() |
| update_field | updateItemFields() |
| batch | 依次执行子命令 |

**交付物**:
- [ ] 命令执行器实现
- [ ] 批量命令处理
- [ ] 执行结果返回

---

### 阶段五：UI组件开发（第10-13天）

#### 任务 5.1: 编排进度面板
**优先级**: P0  
**预计耗时**: 8小时

**文件**: `src/components/OrchestrationProgress.vue`

**设计**: TodoList式进度展示

**功能**:
- [ ] 时段块列表展示（BLK01-BLK20）
- [ ] 状态标识：待填充/进行中/完成/错误
- [ ] 当前执行块高亮
- [ ] 错误块标记和重试按钮
- [ ] 总体进度百分比
- [ ] 取消编排按钮

**交付物**:
- [ ] 进度面板组件
- [ ] 与orchestrator状态联动

---

#### 任务 5.2: LLM对话面板
**优先级**: P0  
**预计耗时**: 10小时

**文件**: `src/components/ChatPanel.vue`

**设计**: 类ChatGPT对话界面

**功能**:
- [ ] 消息列表（用户/AI）
- [ ] 命令预览卡片（确认/取消）
- [ ] 澄清问题展示（选择/输入）
- [ ] 输入框 + 发送按钮
- [ ] 快捷指令按钮
- [ ] 对话历史

**集成位置**:
在现有 `BroadcastPlanSidebar` 基础上增加Tab页签：
- [播出计划] [LLM助手] [校验报告]

**交付物**:
- [ ] 对话面板组件
- [ ] 消息类型定义
- [ ] 与intentRecognizer集成

---

#### 任务 5.3: 校验报告面板
**优先级**: P1  
**预计耗时**: 6小时

**文件**: `src/components/ValidationPanel.vue`

**功能**:
- [ ] 统计概览（总条目/错误数/警告数）
- [ ] 按规则分组的错误列表
- [ ] 点击错误定位到表格行
- [ ] 一键修复按钮（触发Phase 3）
- [ ] 导出校验报告

**交付物**:
- [ ] 校验报告面板组件
- [ ] 与validationReport联动

---

#### 任务 5.4: 表格异常高亮
**优先级**: P0  
**预计耗时**: 6小时

**文件**: 修改 `create.vue` 中的表格渲染逻辑

**功能**:
- [ ] 行级CSS类动态绑定
- [ ] 单元格级异常标记
- [ ] Tooltip显示详细错误信息
- [ ] 多错误叠加样式

**交付物**:
- [ ] 表格高亮逻辑
- [ ] CSS样式定义

---

#### 任务 5.5: AI编排入口集成
**优先级**: P0  
**预计耗时**: 4小时

**文件**: 修改 `create.vue`

**功能**:
- [ ] 顶部工具栏新增"AI智能编排"按钮
- [ ] 编排确认对话框
- [ ] 编排进度浮层/抽屉
- [ ] 与orchestrator集成

**交付物**:
- [ ] AI编排入口
- [ ] 编排流程触发

---

### 阶段六：数据转换与工具函数（第14天）

#### 任务 6.1: 数据转换器
**优先级**: P0  
**预计耗时**: 6小时

**文件**: `src/services/scheduleTransformer.ts`

**功能**:
- [ ] `transformRundownToSchedule()` - RundownItem → ScheduleItem
- [ ] `transformScheduleToRundown()` - ScheduleItem → RundownItem（可选）
- [ ] `mapTypes()` - broadcastType映射
- [ ] `mapMaterialStatus()` - deliveryStatus映射
- [ ] `generateProgramCode12()` - 生成12位编码
- [ ] `parseDurationToSeconds()` - 时长解析

**字段映射完整性**:
- broadcastTime → startTime
- endTime → endTime
- duration → duration（秒）
- broadcastType → businessType + sourceType
- programCode → code18
- deliveryStatus → materialStatus
- studioName → studio
- remarks → remark
- sequence → sortOrder

**交付物**:
- [ ] 完整的数据转换器
- [ ] 单元测试

---

#### 任务 6.2: 时间工具函数
**优先级**: P0  
**预计耗时**: 4小时

**文件**: `src/utils/timeUtils.ts`

**功能**:
- [ ] `parseTimeToSeconds(time: string): number` - 时间转秒数
- [ ] `formatSecondsToTime(seconds: number): string` - 秒数转时间
- [ ] `normalizeTimeFormat(time: string): string` - 规范化时间格式
- [ ] `calculateEndTime(startTime: string, duration: number): string` - 计算结束时间
- [ ] `timeRangeOverlap(range1, range2): boolean` - 时间范围重叠检测
- [ ] `isValidTimeFormat(time: string): boolean` - 时间格式校验

**交付物**:
- [ ] 时间工具函数库
- [ ] 边界情况处理

---

### 阶段七：集成测试与优化（第15-17天）

#### 任务 7.1: 端到端流程测试
**优先级**: P0  
**预计耗时**: 8小时

**测试场景**:
1. 完整编排流程（新闻综合频道）
2. 对话微调流程（插入/删除/替换）
3. 校验错误自动修复
4. 边界情况（空数据、网络错误）

**交付物**:
- [ ] 测试用例文档
- [ ] 问题修复

---

#### 任务 7.2: 性能优化
**优先级**: P1  
**预计耗时**: 6小时

**优化方向**:
- [ ] LLM响应缓存
- [ ] 节目库预加载
- [ ] 表格虚拟滚动（如条目过多）
- [ ] 并行填充优化

**交付物**:
- [ ] 性能优化实现
- [ ] 性能测试报告

---

#### 任务 7.3: 错误处理与兜底
**优先级**: P1  
**预计耗时**: 6小时

**功能**:
- [ ] LLM调用失败重试
- [ ] 解析失败降级处理
- [ ] 用户确认机制
- [ ] 操作撤销支持

**交付物**:
- [ ] 完善的错误处理
- [ ] 用户提示优化

---

### 阶段八：文档与交付（第18天）

#### 任务 8.1: 开发文档
**优先级**: P1  
**预计耗时**: 4小时

**文档清单**:
- [ ] 架构设计文档
- [ ] API接口文档
- [ ] 组件使用文档
- [ ] 部署说明

---

#### 任务 8.2: 用户操作手册
**优先级**: P2  
**预计耗时**: 4小时

**内容**:
- [ ] AI编排功能使用指南
- [ ] 对话微调示例
- [ ] 常见问题解答

---

## 三、项目文件结构

```
src/
├── types/                      # 类型定义
│   ├── index.ts
│   ├── channel.ts
│   ├── program.ts
│   ├── layout.ts
│   ├── rundown.ts
│   ├── schedule.ts
│   ├── command.ts
│   ├── validation.ts
│   ├── mutation.ts
│   ├── gap.ts
│   └── intent.ts
│
├── mock/                       # Mock数据
│   ├── generateSeedData.ts
│   ├── seedData.ts
│   ├── channelData.ts
│   ├── layoutData.ts
│   └── utils.ts
│
├── services/                   # 核心服务
│   ├── atomicCapabilities.ts   # Layer 1
│   ├── llmClient.ts           # LLM客户端
│   ├── promptBuilder.ts       # Prompt构建
│   ├── contextBuilder.ts      # 上下文摘要
│   ├── responseParser.ts      # 响应解析
│   ├── commandExecutor.ts     # 命令执行
│   ├── orchestrator.ts        # 编排调度器
│   ├── validationEngine.ts    # Layer 3
│   ├── scheduleTransformer.ts # 数据转换
│   ├── intentRecognizer.ts    # 意图识别
│   ├── paramExtractor.ts      # 参数提取
│   ├── entityLinker.ts        # 实体链接
│   ├── confidenceEvaluator.ts # 置信度评估
│   └── dialogueContext.ts     # 对话上下文
│
├── stores/                     # Pinia状态管理
│   ├── scheduleStore.ts
│   ├── channelStore.ts
│   └── llmConfigStore.ts
│
├── composables/                # Vue组合式函数
│   ├── useScheduleEditor.ts
│   ├── useOrchestrator.ts
│   ├── useValidation.ts
│   └── useLLMChat.ts
│
├── components/                 # UI组件
│   ├── ChannelSelector.vue
│   ├── ScheduleTable.vue
│   ├── OrchestrationProgress.vue
│   ├── ValidationPanel.vue
│   ├── LayoutReferencePanel.vue
│   ├── ChatPanel.vue
│   ├── CommandPreview.vue
│   ├── ScheduleStats.vue
│   └── ValidationBadge.vue
│
├── utils/                      # 工具函数
│   ├── timeUtils.ts
│   └── typeMapper.ts
│
├── views/                      # 页面
│   └── broadcast-plan/         # 与现有create.vue集成
│       └── components/
│           ├── ChatPanel.vue
│           └── OrchestrationProgress.vue
│
└── App.vue / main.ts / router  # 已有文件
```

---

## 四、里程碑与验收标准

### 里程碑1：基础架构完成（第2天）
- [ ] 所有类型定义完成
- [ ] Mock数据生成脚本可运行
- [ ] 项目可正常启动

### 里程碑2：核心服务完成（第9天）
- [ ] 原子能力层全部接口实现
- [ ] 校验引擎6条规则实现
- [ ] LLM编排调度器可运行
- [ ] 意图识别系统实现

### 里程碑3：UI组件完成（第13天）
- [ ] 编排进度面板
- [ ] 对话面板
- [ ] 校验报告面板
- [ ] 表格异常高亮

### 里程碑4：集成测试完成（第17天）
- [ ] 端到端流程测试通过
- [ ] 性能优化完成
- [ ] 错误处理完善

### 里程碑5：项目交付（第18天）
- [ ] 所有功能验收通过
- [ ] 文档完整
- [ ] 代码审查通过

---

## 五、风险与应对

| 风险 | 概率 | 影响 | 应对措施 |
|------|------|------|---------|
| LLM响应质量不稳定 | 中 | 高 | 增加重试机制，提供兜底规则 |
| 21次LLM调用时间过长 | 中 | 中 | 并行填充，增加缓存 |
| 意图识别准确率不足 | 中 | 中 | 增加置信度阈值，强制确认 |
| 与现有系统集成冲突 | 低 | 高 | 提前分析create.vue结构，渐进集成 |

---

## 六、资源需求

- **开发人员**: 1-2名前端工程师
- **开发周期**: 18个工作日
- **LLM API**: Moonshot API Key（预估126K tokens/次编排）
- **测试环境**: 本地开发环境即可

---

*计划版本: v1.0*  
*最后更新: 2026-03-24*
