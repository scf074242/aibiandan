# 广电节目串联单 LLM 自动编排 — 演示原型需求文档

> **版本**: v3.0\
> **日期**: 2026-03-23\
> **目标读者**: Trae AI IDE / 前端开发工程师\
> **定位**: 可直接交给 Trae 实现的、自包含的需求规格说明

***

## 1 项目概述

### 1.1 背景

广电播出机构每天需要为每个频道编制"串联单"（Rundown），即一天内所有节目、广告、宣传片的播出时间线。传统做法由编单员手工在表格中逐条排列，耗时且易出错。本项目旨在演示：**利用大语言模型（LLM）根据频道属性、节目库、版面参考模板和业务约束，自动生成一份完整的串联单草稿**，编单员仅需在此基础上微调即可送审。

### 1.2 演示目标

本原型需在单一 Web 应用中完成以下核心演示闭环：

1. 用户选择频道与日期，点击"AI 编排"按钮。
2. LLM 先制定编排计划（将全天拆分为时段块），再通过渐进式填充逐条填入节目，系统逐步执行并校验。
3. 用户可在编辑表格中实时观察填充进度，看到每个时段块逐步出现。
4. 系统对每次填充结果执行确定性校验（时间连续性、成品关联等），自动标记问题。
5. 用户可通过自然语言对话让 LLM 生成调整命令，修改已有编排。
6. 每次修改后系统自动重新校验，确保数据始终合规。
7. 最终可将编排结果导出或保存。

### 1.3 核心架构：三层分离

本项目的技术架构遵循\*\*"LLM 不做校验"\*\*原则，将系统拆分为三层：

```
┌──────────────────────────────────────────────────────────────────────┐
│                         用户交互层                                    │
│  自然语言输入 / 表格手动编辑 / 按钮操作                                  │
└───────────────┬──────────────────────────────────┬───────────────────┘
                │                                  │
                ▼                                  ▼
┌───────────────────────────┐    ┌─────────────────────────────────────┐
│  Layer 2: LLM 意图层       │    │  直接操作（手动编辑/拖拽/按钮）         │
│                           │    │  → 直接调用原子能力                    │
│  职责：                    │    └──────────────────┬──────────────────┘
│  · 理解用户自然语言意图     │                       │
│  · 转换为标准化命令 JSON    │                       │
│  · 分步规划 + 渐进式填充     │                       │
│  · 不做任何数据校验         │                       │
└───────────────┬───────────┘                       │
                │ 标准化命令                          │
                ▼                                    ▼
┌──────────────────────────────────────────────────────────────────────┐
│  Layer 1: 原子能力层（接口抽象）                                        │
│                                                                      │
│  查询类：getChannels / getProgramLibrary / getLayoutReference / ...   │
│  操作类：insertItems / deleteItems / replaceItem / swapItems / ...    │
│                                                                      │
│  所有对串联单数据的读写都必须通过这一层                                    │
└───────────────────────────────┬──────────────────────────────────────┘
                                │ 数据变更事件
                                ▼
┌──────────────────────────────────────────────────────────────────────┐
│  Layer 3: 系统校验层（确定性校验）                                       │
│                                                                      │
│  每次数据变更后自动触发，执行 6 条硬性校验规则：                            │
│  V1: 空窗检测       V2: 时间重叠检测    V3: 首尾时间匹配                 │
│  V4: 成品关联检测    V5: 成品素材关联    V6: 时长一致性                   │
│                                                                      │
│  输出：逐条标记 pass/error/warning → 驱动表格异常高亮                    │
└──────────────────────────────────────────────────────────────────────┘
```

**设计理由**：一份完整串联单通常有 200+ 条记录，Kimi K2.5 单次最大输出 32,768 tokens。因此采用\*\*"分步规划 + 渐进式填充"\*\*策略，每次 LLM 调用只处理单条记录（\~500-1000 tokens），确保输出质量和 JSON 格式完整性。校验职责完全交给系统层的确定性算法。

### 1.4 技术栈要求

| 层级      | 技术选型                              | 说明                                                    |
| ------- | --------------------------------- | ----------------------------------------------------- |
| 前端框架    | Vue 3 + TypeScript                | 与原项目保持一致                                              |
| 构建工具    | Vite                              | 快速开发                                                  |
| UI 组件库  | Element Plus 或 Ant Design Vue     | 表格/表单/对话框                                             |
| 状态管理    | Pinia                             | 轻量可选                                                  |
| LLM 接口  | Kimi K2.5（Moonshot API，OpenAI 兼容） | baseURL: `https://api.moonshot.cn/v1`，模型: `kimi-k2.5` |
| LLM SDK | openai npm 包                      | `npm install openai`，兼容 Moonshot API                  |
| 数据层     | 纯前端 Mock（基于种子数据生成脚本）              | 无需后端服务                                                |
| 样式      | Tailwind CSS 或组件库内置               | 简洁即可                                                  |

***

## 2 核心概念与数据模型

> Trae 实现时应在 `src/types/` 目录下统一声明以下类型。

### 2.1 概念关系图

```
频道(Channel) ──┬── 版面参考(LayoutReference)        ← 标准时间模板
                ├── 历史串联单(HistoricalSchedule)   ← 昨天/上周同日的编排参考
                ├── 演播室映射(ChannelStudioMap)     ← 直播条目可选演播室
                ├── 节目库(ProgramLibrary)           ← 可选节目/成品池
                └── 串联单(Schedule)                  ← 最终产物
                     ├── 串联单项(ScheduleItem)       ← 单条播出条目
                     │      ├── 关联成品(programCode/code18)
                     │      └── 关联素材(materialId/materialName)
                     └── 空窗信息(GapInfo)            ← 由系统校验层产出
```

### 2.2 频道（Channel）

```ts
// src/types/channel.ts

export interface BizChannelOption {
  id: 'news' | 'dragon' | 'finance' | 'sports' | 'doc' | 'cartoon'
  name: string // 中文展示名
}

export type ChannelStudioMap = Record<BizChannelOption['id'], string[]>
```

**种子数据（6 个频道）**：新闻综合、东方卫视、第一财经、五星体育、纪实人文、哈哈炫动。

### 2.3 节目库 / 成品库（ProgramLibrary）

```ts
// src/types/program.ts

export interface ProgramLibraryItem {
  id: string                    // 唯一标识，如 "PRG000001"
  name: string                  // 节目名称，如 "新闻报道"
  code: string                  // 18位编码（成品唯一标识）
  type: 'program' | 'promo' | 'advertisement'
  broadcastType: 'recorded' | 'live' | 'ad'
  channelId: string             // 所属频道 ID
  duration: number              // 秒（注意：单位为秒，非分钟）
  description: string
  hasLinkedMaterial: boolean     // 是否已关联素材（成品→素材的绑定状态）
  episodeInfo?: string          // 剧集信息，如 "第3集" "2025-06-15期"
  category: string              // 节目分类，如 "新闻" "电视剧" "广告"
}
```

**关键变更**：`duration` 单位为**秒**（非分钟），消除广告 15 秒、宣传片 30 秒等短条目的精度丢失问题。

### 2.4 版面参考（LayoutReference）

```ts
// src/types/layout.ts

export interface LayoutReferenceItem {
  startTime: string       // HH:mm:ss（统一为秒级精度）
  endTime: string         // HH:mm:ss
  programName: string
  type: 'program' | 'ad' | 'promo'
  sourceType: 'live' | 'record'
  code18?: string
}

export type LayoutReferenceData = Record<string, LayoutReferenceItem[]>
```

**关键变更**：版面参考的时间格式从 `HH:mm` 统一为 `HH:mm:ss`，避免 V3 校验时格式不匹配。

### 2.5 串联单原始数据（RundownItem）— LLM 输出格式

```ts
// src/types/rundown.ts

export interface RundownItem {
  id: string                // 格式 ITEM + 3~4位序号，如 ITEM001
  sequence: number          // 从1开始递增
  broadcastTime: string     // HH:mm:ss:00（开始时间，帧号固定00）
  endTime: string           // HH:mm:ss:00（结束时间，LLM必须填写）
  broadcastType: string     // 枚举：录播 | 直播 | 广告 | 宣传片
  programName: string       // 必须与节目库 name 完全一致
  relativePoint: string     // 相对入点，通常 00:00:00:00
  duration: string          // HH:mm:ss:00（持续时长）
  programCode: string       // 节目库中的 code 字段（18位成品编码）
  studioName?: string       // 直播时必填，从可用演播室列表选取
  deliveryStatus: string    // 新生成统一填 "待送播"
  remarks?: string
}
```

**关键变更**：新增 `endTime` 字段，LLM 必须同时输出开始和结束时间，避免转换时的计算偏差。

### 2.6 编辑页模型（ScheduleItem）— 前端渲染格式

```ts
// src/types/schedule.ts

export type BusinessType = 'program' | 'ad' | 'promo'
export type SourceType = 'record' | 'live'
export type MaterialStatus = 'ready' | 'pending'

export interface ScheduleItem {
  id: string
  scheduleId: string
  startTime: string         // HH:mm:ss
  endTime: string           // HH:mm:ss
  episodeName: string
  indexingSheetCode: string
  programCode12?: string
  keySlot?: string
  materialName?: string
  materialId?: string
  relativeStart?: string
  playLength?: string
  materialStatus: MaterialStatus
  studio?: string
  isOverdue?: boolean
  omniMediaRight?: boolean
  businessType: BusinessType
  programName: string
  sourceType: SourceType
  remark: string
  sortOrder: number
  duration: number          // 秒（注意：单位为秒）
  code18?: string           // 18位成品编码
  isUnlinkedProduct?: boolean    // 校验标记：未关联成品
  isMaterialInfoEmpty?: boolean  // 校验标记：成品未关联素材
}
```

**关键变更**：`duration` 单位为**秒**，与 ProgramLibraryItem 保持一致。

### 2.7 类型映射与转换规则

```ts
// src/services/scheduleTransformer.ts

import { RundownItem } from '@/types/rundown'
import { ScheduleItem } from '@/types/schedule'
import { ProgramLibraryItem } from '@/types/program'

/**
 * RundownItem → ScheduleItem 完整转换函数
 *
 * 转换映射（逐字段）：
 * - RundownItem.broadcastTime ("HH:mm:ss:00") → ScheduleItem.startTime ("HH:mm:ss") — 截掉帧号
 * - RundownItem.endTime ("HH:mm:ss:00")       → ScheduleItem.endTime ("HH:mm:ss")   — 截掉帧号
 * - RundownItem.duration ("HH:mm:ss:00")      → ScheduleItem.duration (number 秒)   — 解析为总秒数
 * - RundownItem.broadcastType                  → ScheduleItem.businessType + sourceType — 调用 mapTypes()
 * - RundownItem.programCode                    → ScheduleItem.code18
 * - RundownItem.deliveryStatus                 → ScheduleItem.materialStatus — 调用 mapMaterialStatus()
 * - RundownItem.studioName                     → ScheduleItem.studio
 * - RundownItem.remarks                        → ScheduleItem.remark
 * - RundownItem.sequence                       → ScheduleItem.sortOrder
 * - RundownItem.id                             → ScheduleItem.id（保持一致）
 *
 * 自动生成的字段：
 * - scheduleId: 由 generateProgramCode12(date, sequence) 生成
 * - episodeName: 从节目库中查找对应成品的 episodeInfo，未找到则为空
 * - indexingSheetCode: 与 code18 相同
 * - materialName / materialId: 从节目库查找，hasLinkedMaterial=true 时填充
 * - materialStatus: 默认 'pending'（新生成的条目）
 * - isUnlinkedProduct: 初始为 false，由 V4 校验设置
 * - isMaterialInfoEmpty: 初始为 false，由 V5 校验设置
 *
 * 附加映射（RundownItem → ScheduleItem 的可选字段）：
 * - RundownItem.relativePoint → ScheduleItem.relativeStart（可选，通常直接传递）
 * - ScheduleItem.playLength: 由 duration 格式化得到（显示用）
 *
 * 不由 LLM 填充的 ScheduleItem 字段（保留为空或由业务逻辑后续赋值）：
 * - keySlot, programCode12, isOverdue, omniMediaRight
 */
export function transformRundownToSchedule(
  item: RundownItem,
  date: string,
  programLibrary: ProgramLibraryItem[]
): ScheduleItem { /* ... */ }

// broadcastType → businessType + sourceType
export function mapTypes(broadcastType: string): {
  businessType: BusinessType
  sourceType: SourceType
} {
  const businessType: BusinessType =
    broadcastType === '广告' ? 'ad' : broadcastType === '宣传片' ? 'promo' : 'program'
  const sourceType: SourceType = broadcastType === '直播' ? 'live' : 'record'
  return { businessType, sourceType }
}

// deliveryStatus → materialStatus
export function mapMaterialStatus(deliveryStatus: string): MaterialStatus {
  return deliveryStatus === '已送播（已归档）' ? 'ready' : 'pending'
}

// programCode12 生成规则：YYMMDD + 6位序号
export function generateProgramCode12(date: string, seq: number): string {
  const ymd = date.replace(/-/g, '').slice(2)
  return ymd + String(seq).padStart(6, '0')
}

// RundownItem.duration ("HH:mm:ss:FF") → 总秒数
export function parseDurationToSeconds(duration: string): number {
  const parts = duration.split(':')
  return parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseInt(parts[2])
}
```

***

## 3 Layer 1：原子能力层 — 接口定义

> 原子能力是整个系统的基础操作单元。LLM 输出的标准化命令和用户的手动编辑，最终都通过调用原子能力来完成对串联单数据的修改。
>
> **本原型中原子能力以前端 TypeScript 函数形式实现**，操作 Pinia Store 中的内存数据。未来对接真实后端时，只需替换实现，上层逻辑无需改动。

### 3.1 接口定义

```ts
// src/services/atomicCapabilities.ts

import type { BizChannelOption, ChannelStudioMap } from '@/types/channel'
import type { ProgramLibraryItem } from '@/types/program'
import type { LayoutReferenceItem } from '@/types/layout'
import type { ScheduleItem, BusinessType } from '@/types/schedule'
import type { MutationResult } from '@/types/mutation'

/**
 * 原子能力接口
 * 所有对串联单数据的读写都通过此接口
 */
export interface AtomicCapabilities {

  // ═══════════════════════════════════════
  //  第一类：查询能力（只读）
  // ═══════════════════════════════════════

  /** Q01 - 获取可用频道列表 */
  getChannels(): BizChannelOption[]

  /** Q02 - 获取指定频道的可用演播室列表 */
  getStudios(channelId: string): string[]

  /**
   * Q03 - 获取节目库（返回全量数据，由调用方按需过滤）
   * 注：频道关联性过滤逻辑在 promptBuilder 中实现，此接口返回全量
   */
  getProgramLibrary(): ProgramLibraryItem[]

  /** Q04 - 获取指定频道的版面参考 */
  getLayoutReference(channelId: string): LayoutReferenceItem[]

  /** Q05 - 获取指定频道的播出时段配置（时间格式统一为 HH:mm:ss） */
  getChannelBroadcastConfig(channelId: string): {
    startTime: string  // HH:mm:ss
    endTime: string    // HH:mm:ss
  }

  /** Q06 - 获取当前串联单全部条目 */
  getScheduleItems(): ScheduleItem[]

  /** Q07 - 按条件查询串联单条目 */
  queryScheduleItems(query: {
    timeRange?: { start: string; end: string }
    businessType?: BusinessType
    programName?: string
    hasValidationError?: boolean
  }): ScheduleItem[]

  /** Q08 - 根据成品编码查询节目库中的成品信息 */
  getProgramByCode(code18: string): ProgramLibraryItem | null

  /** Q09 - 查询当前剩余空窗列表（渐进式填充核心接口） */
  queryRemainingGaps(): GapInfo[]

  /** Q10 - 多源检索候选节目（LLM 调用此接口获取候选列表） */
  queryCandidatesByMultiSource(params: {
    timeRange: { start: string; end: string }  // 空窗起止时间
    duration: number                            // 所需时长（秒）
    preferredTypes?: string[]                    // 偏好的节目类型（可为空）
    requiredChannelId?: string                  // 频道ID
    excludeProgramCodes?: string[]               // 排除的节目编码（已使用的）
    sourcePriority?: ('layout' | 'history' | 'channel')[]  // 多源融合策略优先级
  }): ProgramCandidate[]

  /** Q11 - 获取历史串联单参考数据 */
  getHistoricalSchedule(type: 'yesterday' | 'lastweek_same_day'): ScheduleItem[]

  // ═══════════════════════════════════════
  //  第二类：操作能力（写入）
  //  每次操作后自动触发 Layer 3 校验
  // ═══════════════════════════════════════

  /** M01 - 批量写入：用一组 ScheduleItem 完整替换当前串联单 */
  batchSetSchedule(items: ScheduleItem[]): MutationResult

  /** M02 - 追加条目：在已有数据末尾追加（用于渐进式填充） */
  appendItems(items: ScheduleItem[]): MutationResult

  /** M03 - 插入条目：在指定位置之后插入 */
  insertItems(params: {
    afterItemId: string | null  // null = 插入到最前面
    items: Partial<ScheduleItem>[]
  }): MutationResult

  /** M04 - 删除条目 */
  deleteItems(params: { itemIds: string[] }): MutationResult

  /** M05 - 替换条目 */
  replaceItems(params: {
    replacements: Array<{
      targetItemId: string
      newItem: Partial<ScheduleItem>
    }>
  }): MutationResult

  /** M06 - 交换条目位置 */
  swapItems(params: { itemIdA: string; itemIdB: string }): MutationResult

  /** M07 - 更新单条目字段 */
  updateItemFields(params: {
    itemId: string
    fields: Partial<ScheduleItem>
  }): MutationResult

  /** M08 - 移动条目 */
  moveItem(params: {
    itemId: string
    afterItemId: string | null
  }): MutationResult

  /** M09 - 时间级联重算 */
  recalculateTimesFrom(params: { fromItemId: string }): MutationResult
}
```

### 3.2 空窗查询与候选检索类型

```ts
// src/types/gap.ts

/**
 * 空窗信息 - 描述串联单中未被填充的时间段
 * 用于渐进式填充流程中查询剩余空窗
 */
export interface GapInfo {
  gapId: string           // 格式 GAP + 3位序号，如 GAP001
  startTime: string       // HH:mm:ss（空窗开始时间）
  endTime: string         // HH:mm:ss（空窗结束时间）
  duration: number        // 秒（空窗时长）
  adjacentBeforeId: string | null  // 前邻条目 ID（用于衔接校验）
  adjacentAfterId: string | null   // 后邻条目 ID（用于衔接校验）
  contextHints: {
    suggestedTypes?: string[]   // 建议的节目类型（基于版面）
    timeSlot?: string           // 时段标签，如 "早间"、"午间"、"黄金时段"
  }
}

/**
 * 候选节目 - 多源检索结果
 */
export interface ProgramCandidate {
  program: ProgramLibraryItem       // 节目库条目
  fusedScore: number               // 多源融合评分（0-1）
  sourceScores: {
    layout: number      // 版面数据得分
    yesterday: number   // 昨日串联单得分
    lastweek: number    // 上周同星期得分
  }
  temporalFit: boolean             // 时间衔接是否匹配
  typeDiversityBonus: number       // 类型多样性加分
}
```

### 3.3 操作结果类型

```ts
// src/types/mutation.ts

import type { ValidationReport } from '@/types/validation'

export interface MutationResult {
  success: boolean
  affectedItemIds: string[]
  validation: ValidationReport  // 操作后自动触发的全量校验报告
  error?: string
}
```

### 3.3 原子能力的实现约定

每个写入类原子能力（M01\~M09）的内部执行流程：

```
调用方（命令执行器 / 手动编辑事件）
  │
  ├─ Step 1: 参数合法性基础检查（ID 是否存在、必填字段是否齐全）
  │
  ├─ Step 2: 执行数据变更（修改 Pinia Store 中的 ScheduleItem[]）
  │
  ├─ Step 3: 自动重算序号（sortOrder 从 1 连续递增）
  │
  ├─ Step 4: 自动触发 Layer 3 全量校验 → 生成 ValidationReport
  │
  └─ Step 5: 返回 MutationResult（含校验报告）
```

**关键约定**：操作能力**不阻止**不合规的数据写入，而是写入后通过校验报告标记问题。LLM 的编排结果即使有瑕疵也能先渲染，用户可看到问题所在再修正。

***

## 4 Layer 2：LLM 意图层 — 分步规划与命令转换

> LLM 的职责是**理解用户意图，转换为标准化命令**。LLM 不做任何数据校验。
>
> **核心设计变更**：由于 Kimi K2.5 单次最大输出 32,768 tokens，无法一次性可靠生成 200+ 条记录的完整 JSON。因此全量编排采用\*\*"分步规划 + 渐进式填充"\*\*模式。

### 4.1 LLM 配置（Kimi K2.5）

```ts
// src/services/llmClient.ts
import OpenAI from 'openai'

const client = new OpenAI({
  baseURL: 'https://api.moonshot.cn/v1',
  apiKey: import.meta.env.VITE_MOONSHOT_API_KEY,
  dangerouslyAllowBrowser: true  // 演示原型允许前端直调
})

export interface LLMConfig {
  baseURL: string        // 默认 https://api.moonshot.cn/v1
  apiKey: string         // Moonshot API Key
  model: string          // 默认 kimi-k2.5
  temperature: number    // 默认 0.3
  maxTokens: number      // 默认 8192（单次调用输出上限，非模型上限）
}

export const DEFAULT_LLM_CONFIG: LLMConfig = {
  baseURL: 'https://api.moonshot.cn/v1',
  apiKey: '',
  model: 'kimi-k2.5',
  temperature: 0.3,
  maxTokens: 8192        // 保守值，确保每次调用输出完整
}
```

### 4.2 标准化命令协议（ScheduleCommand）

```ts
// src/types/command.ts

export type ScheduleCommand =
  | PlanCommand
  | QueryCandidatesCommand
  | FillItemCommand
  | FillBlockCommand
  | InsertCommand
  | DeleteCommand
  | ReplaceCommand
  | SwapCommand
  | MoveCommand
  | UpdateFieldCommand
  | ShiftTimeCommand
  | BatchUpdateCommand
  | BatchCommand

// ═════════════════════════════
//  全量编排阶段的命令（TodoList 模式）
// ═════════════════════════════

/** Phase 1 输出：编排计划（将全天拆分为时段块） */
export interface PlanCommand {
  action: 'plan'
  blocks: TimeBlock[]
  explanation: string
}

export interface TimeBlock {
  blockId: string         // 如 "BLK01"
  startTime: string       // HH:mm:ss
  endTime: string         // HH:mm:ss
  label: string           // 中文标签，如 "早间新闻时段"
  mainPrograms: string[]  // 计划安排的主要节目名称
  estimatedItems: number  // 预估条目数
}

/** Phase 2 输出：单个时段块的详细填充 */
export interface FillBlockCommand {
  action: 'fill_block'
  blockId: string
  items: RundownItem[]     // 该时段块内的全部条目（通常 5~15 条）
  explanation: string
}

/**
 * Phase 2 两阶段填充 - 阶段1：查询候选
 * LLM 输出此命令 → 系统解析 → 执行检索 → 返回候选列表 → LLM 再选择
 */
export interface QueryCandidatesCommand {
  action: 'query_candidates'
  blockId: string                    // 当前待填充的块ID
  searchCriteria: {
    timeRange: { start: string; end: string }  // 空窗起止时间
    duration: number                  // 所需时长（秒）
    preferredTypes?: string[]          // 偏好的节目类型
    excludeProgramCodes?: string[]     // 排除的节目编码（已使用的）
  }
  reasoning: string                  // LLM 说明为什么选择这些筛选条件
}

/**
 * Phase 2 两阶段填充 - 阶段2：填充条目
 * 在 query_candidates 之后，LLM 基于候选列表输出此命令
 */
export interface FillItemCommand {
  action: 'fill_item'
  blockId: string                    // 当前待填充的块ID
  selectedProgram: {
    programCode: string               // 节目库中的code
    programName: string              // 节目库中的名称
  }
  reasoning: string                  // 为什么选择这个节目
}

// ═════════════════════════════
//  微调阶段的命令
// ═════════════════════════════

export interface InsertCommand {
  action: 'insert'
  afterItemId: string | null
  items: RundownItem[]
  explanation: string
}

export interface DeleteCommand {
  action: 'delete'
  targetIds: string[]
  explanation: string
}

export interface ReplaceCommand {
  action: 'replace'
  replacements: Array<{
    targetId: string
    newItem: RundownItem
  }>
  explanation: string
}

export interface SwapCommand {
  action: 'swap'
  itemIdA: string
  itemIdB: string
  explanation: string
}

export interface MoveCommand {
  action: 'move'
  itemId: string
  afterItemId: string | null
  explanation: string
}

export interface UpdateFieldCommand {
  action: 'update_field'
  targetId: string
  fields: Partial<RundownItem>
  explanation: string
}

export interface BatchCommand {
  action: 'batch'
  commands: Exclude<ScheduleCommand, BatchCommand | PlanCommand>[]
  explanation: string
}
```

### 4.3 全量编排：分步规划 + 渐进式填充

这是本项目最核心的 LLM 交互设计。

#### 4.3.1 为什么不能一次性生成

| 因素       | 单次全量生成                         | 渐进式填充                |
| -------- | ------------------------------ | -------------------- |
| 输出 token | \~35,000（超 Kimi K2.5 的 32K 上限） | 每次 \~500-1000（安全范围内） |
| JSON 完整性 | 高风险截断/格式错误                     | 每次只输出单条，质量可靠         |
| 后段质量     | 第 100+ 条开始质量严重衰减               | 每次只关注单条，质量稳定         |
| 错误修复     | 全部重来                           | 只重做出错的条目             |
| 用户体验     | 等 30-60 秒看不到任何内容               | 逐条渐进显示，几秒钟能看到首批结果    |

#### 4.3.2 完整调用链路（Phase 2 两阶段模式）

```
用户点击"AI智能编排"
  │
  │  ╔══════════════════════════════════════╗
  │  ║  Phase 0: 初始化与数据加载            ║
  │  ╚══════════════════════════════════════╝
  │
  ├─ 加载版面参考数据（LayoutReferenceData）
  ├─ 加载昨日串联单（YesterdaySchedule）
  ├─ 加载上周同星期串联单（LastWeekSameDaySchedule）
  └─ 初始化空窗列表（全天时间段减去已填充条目）

  │
  │  ╔══════════════════════════════════════╗
  │  ║  Phase 1: 规划（1 次 LLM 调用）      ║
  │  ╚══════════════════════════════════════╝
  │
  ├─ 1. 构建规划 Prompt（注入频道信息 + 版面参考摘要）
  ├─ 2. 调用 Kimi K2.5 → 返回 PlanCommand
  │      内含 ~15-20 个 TimeBlock
  └─ 3. 前端渲染"编排计划"进度面板

  │
  │  ╔══════════════════════════════════════════════════════════════════╗
  │  ║  Phase 2: 渐进式填充循环（N×2 次 LLM 调用，两阶段模式）        ║
  │  ╚══════════════════════════════════════════════════════════════════╝
  │
  │  while (仍有未填充空窗) {
  │    │
  │    │  【阶段1：查询候选】
  │    ├─ 4.1 系统构建检索上下文
  │    │      - 当前空窗信息（起止时间、时长）
  │    │      - 前邻后邻节目类型
  │    │      - 版面推荐类型
  │    │
  │    ├─ 4.2 调用 LLM → 输出 QueryCandidatesCommand
  │    │      LLM 分析空窗特征，输出筛选条件
  │    │
  │    ├─ 4.3 系统解析命令 → 调用 queryCandidatesByMultiSource()
  │    │
  │    ├─ 4.4 系统返回候选列表给 LLM
  │    │      格式: { candidates: ProgramCandidate[], totalCount: number }
  │    │
  │    │  【阶段2：选择填充】
  │    ├─ 4.5 调用 LLM → 输出 FillItemCommand
  │    │      LLM 从候选列表中选择最合适的节目
  │    │
  │    ├─ 4.6 系统解析命令 → 执行 fill
  │    │      - 调用 atomicCapabilities.appendItems()
  │    │      - 更新空窗列表（移除已填充部分）
  │    │      - 触发 V1-V6 校验
  │    │
  │    └─ 4.7 表格实时渲染，进度面板更新
  │  }

  │
  │  ╔══════════════════════════════════════╗
  │  ║  Phase 3: 修补（0~M 次 LLM 调用）      ║
  │  ╚══════════════════════════════════════╝
  │
  ├─ 5. 执行最终全量校验
  ├─ 6. 若存在错误 → LLM 生成修补命令
  └─ 7. 最多重试 3 次，仍有错误标记人工处理
```

**两阶段模式说明**：

| 阶段 | LLM 输出 | 系统行为 |
|------|---------|---------|
| 阶段1 | `QueryCandidatesCommand`（筛选条件） | 解析命令 → 执行检索 → 返回候选列表 |
| 阶段2 | `FillItemCommand`（选中的节目） | 解析命令 → 执行填充 → 更新串联单 |

**为什么需要两阶段？**
- LLM 不能直接调用函数，必须通过 JSON 命令交互
- 系统执行检索后，需要将结果返回给 LLM 上下文
- 保持 LLM 的可控性（每次只做单一决策）

#### 4.3.3 Phase 1 规划模式 — Prompt 设计

**System Prompt**：

```text
# 角色
你是一位资深的广电节目编排专家。现在需要你为指定频道制定一天的编排计划。

# 任务
根据版面参考模板，将全天播出时段拆分为 15~20 个时段块。每个块代表一个连续的节目段落（如"早间新闻时段"、"上午剧场时段"、"午间广告段"等）。

# 拆分原则
- 每个块的时长建议在 30 分钟 ~ 3 小时之间
- 相邻块的时间必须严格衔接，无空洞无重叠
- 第一个块的开始时间 = 频道开播时间，最后一个块的结束时间 = 频道收播时间
- 参照版面参考的时段划分来拆分
- 为每个块标注计划安排的主要节目名称（从节目库中选取）
- 预估每个块内的条目数（含节目 + 广告 + 宣传片）

# 输出格式
输出一个 JSON 对象：
{
  "action": "plan",
  "blocks": [
    {
      "blockId": "BLK01",
      "startTime": "06:00:00",
      "endTime": "08:00:00",
      "label": "早间新闻时段",
      "mainPrograms": ["上海早晨", "媒体大搜索"],
      "estimatedItems": 12
    }
  ],
  "explanation": "编排思路说明"
}

只输出 JSON，不要包含其他文字。
```

#### 4.3.4 Phase 2 渐进式填充 — 两阶段 Prompt 设计

Phase 2 采用两阶段模式：**阶段1** LLM 输出检索条件 → 系统执行检索 → **阶段2** LLM 基于候选列表选择节目。

---

##### 阶段1：查询候选

**System Prompt（阶段1）**：

```text
# 角色
你是一位广电节目编排专家。现在需要你为当前空窗确定合适的候选节目。

# 你的任务
1. 分析空窗的上下文（时段、前后节目类型）
2. 确定检索候选节目的筛选条件
3. 输出筛选条件，系统将返回匹配的候选列表

# 限制
- 筛选条件要合理，确保能找到合适的节目
- 考虑版面推荐、历史编排、频道特征等多维度因素

# 输出格式
{
  "action": "query_candidates",
  "blockId": "{blockId}",
  "searchCriteria": {
    "timeRange": { "start": "HH:mm:ss", "end": "HH:mm:ss" },
    "duration": 秒数,
    "preferredTypes": ["节目类型数组"],
    "excludeProgramCodes": ["已使用过的节目编码"]
  },
  "reasoning": "为什么选择这些筛选条件"
}

只输出 JSON，不要包含其他文字。
```

**User Prompt 模板（阶段1）**：

```text
请分析当前空窗特征，确定检索候选节目的筛选条件。

## 当前空窗
- 块ID: {blockId}
- 开始时间: {gapStartTime}
- 结束时间: {gapEndTime}
- 时长: {gapDuration}秒

## 上下文
- 前邻节目: {adjacentBeforeProgramName}（类型: {adjacentBeforeType}）
- 后邻节目: {adjacentAfterProgramName}（类型: {adjacentAfterType}）

## 版面推荐（该时段历史上通常放什么）
{layoutRecommendation}

## 历史编排参考
- 昨日此时段: {yesterdayPrograms}
- 上周同星期: {lastWeekPrograms}

请输出筛选条件，系统将返回候选节目列表。
```

**系统收到 QueryCandidatesCommand 后**：
```ts
// 1. 解析 searchCriteria
const { timeRange, duration, preferredTypes, excludeProgramCodes } = command.searchCriteria

// 2. 调用检索服务
const candidates = queryCandidatesByMultiSource({
  timeRange,
  duration,
  preferredTypes,
  requiredChannelId: channelId,
  excludeProgramCodes
})

// 3. 将候选列表注入 LLM 上下文，进入阶段2
return { candidates, totalCount: candidates.length }
```

---

##### 阶段2：选择填充

**System Prompt（阶段2）**：

```text
# 角色
你是一位广电节目编排专家。系统已返回候选节目列表，请从中选择最合适的节目填入当前空窗。

# 你的任务
1. 分析候选列表（已按多源评分排序）
2. 结合上下文（前后节目类型、版面推荐、历史编排）选择最合适的节目
3. 输出填充命令

# 选择原则
- 优先选择评分高的候选节目
- 考虑与前后节目的类型多样性
- 确保节目时长与空窗时长匹配

# 输出格式
{
  "action": "fill_item",
  "blockId": "{blockId}",
  "selectedProgram": {
    "programCode": "节目库中的code",
    "programName": "节目库中的名称"
  },
  "reasoning": "为什么选择这个节目"
}

只输出 JSON，不要包含其他文字。
```

**User Prompt 模板（阶段2）**：

```text
请从候选列表中选择最合适的节目填入当前空窗。

## 当前空窗
- 块ID: {blockId}
- 开始时间: {gapStartTime}
- 结束时间: {gapEndTime}
- 时长: {gapDuration}秒

## 上下文
- 前邻节目: {adjacentBeforeProgramName}
- 后邻节目: {adjacentAfterProgramName}

## 候选节目列表（按多源评分排序）
{candidatesJSON}

请选择最合适的节目。
```

---

##### 补充说明：无参考数据时的兜底策略

**场景**：版面数据为空、历史编排数据为空

**兜底策略流程**：

```
Phase 0 初始化时检测：
├─ 版面数据 → 如为空，layoutScore = null（不参与融合）
├─ 历史数据 → 如为空，historyScore = null（不参与融合）
└─ 频道特征 → 始终可用，作为兜底

融合评分计算（有权重数据时参与，无权重数据时重新分配）：
├─ 有版面 + 有历史：
│   fusedScore = 0.4×layout + 0.3×history + 0.3×channel
│
├─ 仅 有版面：
│   fusedScore = 0.6×layout + 0.4×channel
│
├─ 仅 有历史：
│   fusedScore = 0.5×history + 0.5×channel
│
└─ 版面+历史均无（兜底场景）：
    fusedScore = channelScore（直接使用频道特征评分）
```

**频道特征评分规则**：

| 频道类型 | 偏好节目类型 | 评分逻辑 |
|----------|-------------|---------|
| 新闻综合 | 新闻、资讯、专题 | 新闻类节目得分 0.9，其他 0.3 |
| 东方卫视 | 综艺、电视剧、新闻 | 综艺类 0.9，新闻 0.6，电视剧 0.7 |
| 电视剧 | 电视剧、电影、综艺 | 电视剧 0.9，电影 0.7 |
| 体育 | 体育赛事、体育新闻 | 体育类 0.9，其他 0.2 |

**LLM 决定是否填广告的指导**：

在阶段2的 System Prompt 中增加：

```text
# 广告填充指导
- 如果空窗时长 >= 30分钟，优先填充正式节目
- 如果空窗时长 < 30分钟，且候选节目中无合适类型，可考虑填入广告
- 广告应填补节目间隙，而非替代正式节目
- 如果LLM认为当前不需要广告，应在 reasoning 中说明
```

**无参考数据场景的完整流程示例**：

```
用户点击"AI智能编排"
  ↓
Phase 0: 初始化
  - 版面数据: 空
  - 历史数据: 空
  - 频道特征: 新闻综合频道
  ↓
Phase 1: 规划
  - LLM 生成 TimeBlock: ["08:00-09:00 早间时段"]
  ↓
Phase 2 循环:
  │
  ├─ 阶段1: QueryCandidates
  │   - LLM 分析: 空窗1小时，频道是新闻综合
  │   - 版面推荐: 无
  │   - 历史编排: 无
  │   - 输出: { duration: 3600, preferredTypes: ["新闻"] }
  │   - 系统执行检索:
  │     - 候选列表: 《新闻30分》《新闻联播》《新闻现场》...
  │     - 融合评分: 全部基于 channelScore（频道特征）
  │   - 系统返回候选列表
  │
  └─ 阶段2: FillItem
      - LLM 选择: 《新闻30分》
      - reasoning: "新闻综合频道首个时段，新闻类节目评分最高"
      - 输出: { action: "fill_item", selectedProgram: {...} }
  ↓
Phase 3: 校验
  - 无错误，完成
```

#### 4.3.5 Phase 3 修补模式 — Prompt 设计

**System Prompt**：

```text
# 角色
你是一位广电节目编排助手。系统校验发现当前串联单存在以下问题，需要你生成修补命令。

# 你的职责
根据校验错误信息，生成对应的修补命令。可用的命令格式与微调模式相同（insert / replace / delete / update_field / batch）。

# 限制
- 只修复报告中列出的问题，不要改动其他条目
- 节目必须从节目库中选取
- 修补后时间仍需严格衔接
```

### 4.4 对话微调模式

用户在对话面板输入自然语言修改指令时触发。

#### 4.4.1 意图识别与命令转换系统概述

> **设计目标**：将用户的自然语言指令准确转换为标准化命令（insert/replace/delete/shift\_time/batch\_update/swap/move/update\_field等），支持模糊表达、歧义消解、置信度评估和多轮对话。

**系统架构**：

```
用户自然语言输入
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│                    意图识别与命令转换管道                      │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐    │
│  │  意图分类器   │───▶│  参数提取器   │───▶│  实体链接器   │    │
│  │IntentClassifier│   │ParamExtractor│   │EntityLinker │    │
│  └──────┬──────┘    └──────┬──────┘    └──────┬──────┘    │
│         │                   │                   │           │
│         ▼                   ▼                   ▼           │
│  ┌─────────────────────────────────────────────────────┐    │
│  │              置信度评估器 (ConfidenceEvaluator)       │    │
│  └──────────────────────┬──────────────────────────────┘    │
│                         │                                  │
│                         ▼                                  │
│  ┌─────────────────────────────────────────────────────┐    │
│  │              命令生成器 (CommandGenerator)           │    │
│  └──────────────────────┬──────────────────────────────┘    │
│                         │                                  │
│                         ▼                                  │
│              ┌─────────────────────┐                       │
│              │  ScheduleCommand    │                       │
│              └─────────────────────┘                       │
└─────────────────────────────────────────────────────────────┘
```

**核心流程**：

1. **意图分类**：识别用户意图类型（如 insert/delete/replace 等）
2. **参数提取**：从用户输入中提取时间参数、节目参数、数量参数
3. **实体链接**：将模糊描述映射到具体的 ScheduleItem ID
4. **置信度评估**：判断意图是否明确，输出置信度
5. **命令生成**：生成标准化的 ScheduleCommand JSON

#### 4.4.2 意图分类体系

##### 4.4.2.1 意图类型定义

```ts
// src/types/intent.ts

/**
 * 意图类型枚举
 * 覆盖串联单编辑的所有操作类型
 */
export enum IntentType {
  // 基础CRUD操作
  INSERT = 'insert',           // 插入新节目
  DELETE = 'delete',           // 删除节目
  REPLACE = 'replace',        // 替换节目内容
  UPDATE_FIELD = 'update_field', // 更新单个字段

  // 高级操作
  SWAP = 'swap',              // 交换两个节目的位置
  MOVE = 'move',              // 移动节目到新位置
  SHIFT_TIME = 'shift_time',  // 时间偏移（整体或局部）

  // 批量操作
  BATCH_UPDATE = 'batch_update', // 批量修改（条件筛选）
  BATCH_REPLACE = 'batch_replace', // 批量替换

  // 元操作
  CLARIFICATION = 'clarification', // 请求澄清
  QUERY = 'query',            // 查询类操作（不修改数据）
  UNKNOWN = 'unknown'         // 无法识别
}

/**
 * 意图分类结果
 */
export interface IntentClassification {
  /** 主要意图类型 */
  primaryIntent: IntentType
  /** 次要意图类型（复合意图时） */
  secondaryIntents?: IntentType[]
  /** 置信度 0-1 */
  confidence: number
  /** 分类依据（匹配的关键词/模式） */
  matchedPatterns: string[]
  /** 歧义标识 */
  ambiguity: boolean
  /** 歧义候选项 */
  ambiguityCandidates?: IntentType[]
  /** 原始分类理由 */
  reasoning: string
}
```

##### 4.4.2.2 意图分类规则矩阵

| 意图类型               | 典型句式                          | 关键词            | 歧义风险  | 歧义消解策略           |
| ------------------ | ----------------------------- | -------------- | ----- | ---------------- |
| **INSERT**         | "在X插入Y" / "在X之后加Y" / "在X前面加Y" | 插入、增加、加、添加     | 低     | 依赖位置描述解析         |
| **DELETE**         | "删掉X" / "删除X" / "把X去掉"        | 删除、删掉、去掉、移除    | 低     | 依赖目标识别           |
| **REPLACE**        | "把X换成Y" / "将X改为Y" / "X变成Y"    | 换成、改为、变成、更换    | **高** | 需判断是否涉及条件批量      |
| **UPDATE\_FIELD**  | "把X的Y改成Z" / "X备注改成Z"          | 备注改、时间改、名称改    | 低     | 字段名识别            |
| **SWAP**           | "把X和Y对调" / "X和Y互换"            | 对调、互换、交换、调换    | 低     | 需两个明确目标          |
| **MOVE**           | "把X移到Y之后" / "X移动到Z"           | 移到、移动到、挪到      | 中     | 需位置描述解析          |
| **SHIFT\_TIME**    | "X后移30秒" / "X提前5分钟" / "X统一推迟" | 后移、提前、推迟、偏移、统一 | 中     | 需判断范围（单个/批量）     |
| **BATCH\_UPDATE**  | "把12:00以后全变成广告" / "所有新闻改成重播"  | 以后、之前、全部、所有、凡是 | **高** | 需判断是条件筛选还是范围     |
| **BATCH\_REPLACE** | "把所有新闻换成电视剧"                  | 所有...换成、批量替换   | 高     | 与BATCH\_UPDATE相似 |
| **QUERY**          | "看看X的时间" / "现在有哪些问题"          | 查看、看、查询、有哪些    | 低     | 不产生命令            |
| **CLARIFICATION**  | -                             | -              | -     | 低置信度时触发          |

##### 4.4.2.3 歧义消解策略

**歧义场景1："把XX变成广告"**

```ts
// 歧义分析：
// 场景A：单条替换 "把新闻联播变成广告" → replace
// 场景B：批量修改 "把12:00以后的全变成广告" → batch_update

// 消解规则：
// 1. 检查是否有时间范围限定词（以后、之前、所有...的）
//    - 有范围限定词 → batch_update
//    - 无范围限定词 → replace
// 2. 检查是否提及具体节目数量
//    - "所有新闻" → batch_update
//    - "这条新闻" → replace
```

**歧义场景2："把X后移30秒"**

```ts
// 歧义分析：
// 场景A：单条时间偏移 → shift_time（单条）
// 场景B：批量时间偏移 "12:00以后的后移30秒" → shift_time（批量）

// 消解规则：
// 1. 检查时间范围限定词
//    - 有范围 → shift_time 批量模式
//    - 无范围 → shift_time 单条模式
```

**歧义场景3："黄金时段多加些新闻"**

```ts
// 歧义分析：
// 无法直接映射到标准命令，需要：
// 1. 解析"黄金时段"为具体时间范围（19:00-22:00）
// 2. 解析"多加些新闻"为插入操作
// 3. 需要查询当前黄金时段有多少新闻，决定插入数量
// → 需要多轮对话或批量插入规划

// 消解策略：分类为clarification，要求LLM规划具体插入方案
```

#### 4.4.3 参数提取引擎

##### 4.4.3.1 参数类型定义

```ts
// src/types/intent.ts (续)

/**
 * 时间参数类型
 */
export type TimeValue =
  | { type: 'absolute'; time: string; format: 'HH:mm:ss' | 'HH:mm' }  // 精确时间
  | { type: 'relative'; anchor: string; offset: number; unit: 'second' | 'minute' }  // 相对时间
  | { type: 'range_start'; time: string; direction: 'after' | 'before' }  // 范围起点
  | { type: 'range'; start: string; end: string }  // 时间范围
  | { type: 'fuzzy'; label: string; mappedRange: { start: string; end: string } }  // 模糊时间

/**
 * 节目参数类型
 */
export type ProgramValue =
  | { type: 'by_id'; id: string }  // 按ITEM ID引用
  | { type: 'by_name'; name: string; fuzzy: boolean }  // 按节目名
  | { type: 'by_position'; position: number; relativeTo: 'start' | 'mention' }  // 按位置
  | { type: 'by_time'; time: string; nearest: boolean }  // 按时间定位
  | { type: 'by_description'; description: string }  // 按描述筛选

/**
 * 数量参数类型
 */
export type QuantityValue =
  | { type: 'duration'; value: number; unit: 'second' | 'minute' | 'hour' }  // 时长
  | { type: 'offset'; value: number; unit: 'second' | 'minute' }  // 偏移量
  | { type: 'count'; value: number }  // 数量

/**
 * 完整参数提取结果
 */
export interface ExtractedParams {
  /** 时间相关参数 */
  timeParams: {
    targetTime?: TimeValue          // 目标时间
    rangeStart?: TimeValue          // 范围起点
    rangeEnd?: TimeValue            // 范围终点
    offset?: QuantityValue           // 时间偏移量
    timeRange?: { start: string; end: string }  // 解析后的时间范围
  }

  /** 节目相关参数 */
  programParams: {
    target?: ProgramValue            // 目标节目
    targets?: ProgramValue[]        // 多个目标（批量操作）
    replacement?: ProgramValue       // 替换目标
    anchor?: ProgramValue           // 锚点（用于"在X之后"的X）
  }

  /** 数量参数 */
  quantityParams: {
    duration?: QuantityValue         // 时长
    offset?: QuantityValue           // 偏移量
    count?: number                 // 数量
  }

  /** 字段更新参数 */
  fieldParams?: {
    fieldName: string
    newValue: string
  }

  /** 原始文本保留 */
  rawText: string
  /** 提取过程中发现的问题 */
  warnings: string[]
}
```

##### 4.4.3.2 时间参数提取规则

```ts
// src/services/paramExtractor.ts

/**
 * 时间表达式正则模式
 */
const TIME_PATTERNS = {
  // 精确时间 HH:mm:ss 或 HH:mm
  absolute: /(\d{1,2}):(\d{2})(?::(\d{2}))?/,

  // 相对偏移 后移/前移/提前/推迟 + 数字 + 单位
  relativeOffset: /(?:后移|前移|提前|推迟|往后?|往前?)\s*(\d+)\s*(秒|分钟|分|钟|小时|时)/,

  // 范围起点 "12:00以后" / "12:00之前"
  rangeWithDirection: /(\d{1,2}:\d{2}(?::\d{2})?)\s*(?:以后?|之前?|之后?|后面?|前面?)/,

  // 带"在"的定位 "在10:00插入" / "在X之后"
  anchorTime: /在\s*(\d{1,2}:\d{2}(?::\d{2})?)\s*(?:插入|之后|前面|之后|以后|以前)?/,

  // 时长表达 "5分钟" / "30秒" / "2小时"
  duration: /(\d+)\s*(秒|分钟|分|钟|小时|时|min|s|hour|h)/
}

/**
 * 模糊时间标签映射
 */
const FUZZY_TIME_MAPPING: Record<string, { start: string; end: string; label: string }> = {
  '早间': { start: '06:00:00', end: '09:00:00', label: '早间时段' },
  '早上': { start: '06:00:00', end: '09:00:00', label: '早间时段' },
  '上午': { start: '06:00:00', end: '12:00:00', label: '上午时段' },
  '午间': { start: '11:30:00', end: '13:30:00', label: '午间时段' },
  '中午': { start: '11:30:00', end: '13:30:00', label: '午间时段' },
  '下午': { start: '12:00:00', end: '18:00:00', label: '下午时段' },
  '晚间': { start: '18:00:00', end: '24:00:00', label: '晚间时段' },
  '傍晚': { start: '17:00:00', end: '19:00:00', label: '傍晚时段' },
  '黄金时段': { start: '19:00:00', end: '22:00:00', label: '黄金时段' },
  '黄金时间': { start: '19:00:00', end: '22:00:00', label: '黄金时段' },
  '深夜': { start: '22:00:00', end: '24:00:00', label: '深夜时段' },
  '凌晨': { start: '00:00:00', end: '06:00:00', label: '凌晨时段' },
  '早高峰': { start: '07:00:00', end: '09:00:00', label: '早高峰' },
  '晚高峰': { start: '17:00:00', end: '19:00:00', label: '晚高峰' }
}

/**
 * 时间偏移量单位转换
 */
const TIME_UNIT_CONVERSION: Record<string, number> = {
  '秒': 1,
  '分': 60,
  '分钟': 60,
  '钟': 60,
  '时': 3600,
  '小时': 3600,
  's': 1,
  'min': 60,
  'h': 3600
}

/**
 * 提取时间参数的完整逻辑
 *
 * @param userInput - 用户原始输入
 * @returns 时间参数提取结果
 */
export function extractTimeParams(userInput: string): ExtractedParams['timeParams'] {
  const result: ExtractedParams['timeParams'] = {}
  const warnings: string[] = []

  // 1. 提取精确时间
  const absoluteMatches = userInput.match(/\d{1,2}:\d{2}(?::\d{2})?/g)
  if (absoluteMatches) {
    // 规范化时间格式
    const normalizedTimes = absoluteMatches.map(t => normalizeTimeFormat(t))
    // 根据上下文判断是目标时间还是范围起点
    if (userInput.includes('以后') || userInput.includes('之后') || userInput.includes('前面')) {
      result.rangeStart = { type: 'range_start', time: normalizedTimes[0], direction: 'after' }
      result.targetTime = { type: 'absolute', time: normalizedTimes[0], format: 'HH:mm:ss' }
    } else if (userInput.includes('之前') || userInput.includes('以前')) {
      result.rangeStart = { type: 'range_start', time: normalizedTimes[0], direction: 'before' }
    } else {
      // 默认作为目标时间
      result.targetTime = { type: 'absolute', time: normalizedTimes[0], format: 'HH:mm:ss' }
    }
  }

  // 2. 提取时间偏移量
  const offsetMatch = userInput.match(/(?:后移|前移|提前|推迟|往后?|往前?)\s*(\d+)\s*(秒|分钟|分|钟|小时|时|s|min|h)?/)
  if (offsetMatch) {
    const value = parseInt(offsetMatch[1])
    const unit = offsetMatch[2] || '秒'
    const unitSeconds = TIME_UNIT_CONVERSION[unit] || 1
    result.offset = {
      type: 'offset',
      value: value * unitSeconds,
      unit: 'second'
    }
  }

  // 3. 提取模糊时间
  for (const [label, range] of Object.entries(FUZZY_TIME_MAPPING)) {
    if (userInput.includes(label)) {
      result.targetTime = {
        type: 'fuzzy',
        label,
        mappedRange: { start: range.start, end: range.end }
      }
      result.timeRange = { start: range.start, end: range.end }
      break
    }
  }

  // 4. 提取时长（用于插入操作）
  const durationMatch = userInput.match(/(\d+)\s*(秒|分钟|分|钟|小时|时|s|min|h)/g)
  if (durationMatch) {
    // 解析最后一个时长（通常是节目时长）
    const lastDuration = durationMatch[durationMatch.length - 1]
    const durationParts = lastDuration.match(/(\d+)\s*(秒|分钟|分|钟|小时|时|s|min|h)?/)
    if (durationParts) {
      const value = parseInt(durationParts[1])
      const unit = durationParts[2] || '秒'
      const unitSeconds = TIME_UNIT_CONVERSION[unit] || 1
      result.offset = {
        type: 'duration',
        value: value * unitSeconds,
        unit: unitSeconds >= 3600 ? 'hour' : unitSeconds >= 60 ? 'minute' : 'second'
      }
    }
  }

  // 5. 提取时间范围（"从X到Y" / "X-Y"）
  const rangeMatch = userInput.match(/(\d{1,2}:\d{2}(?::\d{2})?)\s*[~-]\s*(\d{1,2}:\d{2}(?::\d{2})?)/)
  if (rangeMatch) {
    result.timeRange = {
      start: normalizeTimeFormat(rangeMatch[1]),
      end: normalizeTimeFormat(rangeMatch[2])
    }
  }

  return result
}

/**
 * 规范化时间格式为 HH:mm:ss
 */
function normalizeTimeFormat(time: string): string {
  const parts = time.split(':')
  const hh = parts[0].padStart(2, '0')
  const mm = parts[1].padStart(2, '0')
  const ss = parts[2]?.padStart(2, '0') || '00'
  return `${hh}:${mm}:${ss}`
}
```

##### 4.4.3.3 节目参数提取规则

```ts
// src/services/paramExtractor.ts (续)

/**
 * 节目名关键词提取
 * 识别"在X之后"、"把X换成"、"X的备注"等形式
 */
export function extractProgramParams(
  userInput: string,
  programLibrary: ProgramLibraryItem[]
): ExtractedParams['programParams'] {
  const result: ExtractedParams['programParams'] = {}
  const warnings: string[] = []

  // 1. 提取节目ID引用 "ITEM003" / "第3条"
  const itemIdMatch = userInput.match(/(?:ITEM|item)?(\d{3,4})/)
  if (itemIdMatch && userInput.match(/第?\d+条|ITEM\d+|item\d+/)) {
    const id = itemIdMatch[0].toUpperCase().startsWith('ITEM')
      ? itemIdMatch[0].toUpperCase()
      : `ITEM${itemIdMatch[1].padStart(3, '0')}`
    result.target = { type: 'by_id', id }
  }

  // 2. 提取位置引用 "第3条" / "第三条"
  const positionMatch = userInput.match(/第\s*(\d+)\s*条/)
  if (positionMatch) {
    result.target = {
      type: 'by_position',
      position: parseInt(positionMatch[1]),
      relativeTo: 'start'
    }
  }

  // 3. 提取节目名引用
  // 匹配 "新闻联播"、"早安上海" 等节目名
  const programNamePatterns = [
    /在(.+?)之后/,
    /在(.+?)前面/,
    /把(.+?)换成/,
    /将(.+?)改为/,
    /把(.+?)删掉/,
    /把(.+?)变成/,
    /把(.+?)后移/,
    /把(.+?)提前/
  ]

  for (const pattern of programNamePatterns) {
    const match = userInput.match(pattern)
    if (match && match[1]) {
      const programName = match[1].trim()
      // 检查是否是模糊时间标签
      if (!FUZZY_TIME_MAPPING[programName] && !programName.match(/^\d+:/)) {
        result.target = {
          type: 'by_name',
          name: programName,
          fuzzy: true  // 模糊匹配
        }
        break
      }
    }
  }

  // 4. 提取锚点节目（用于"在X之后加Y"）
  const anchorMatch = userInput.match(/在(.+?)(?:之后|前面|以后|以前)/)
  if (anchorMatch) {
    const anchorName = anchorMatch[1].trim()
    if (!FUZZY_TIME_MAPPING[anchorName] && !anchorName.match(/^\d+:/)) {
      result.anchor = {
        type: 'by_name',
        name: anchorName,
        fuzzy: true
      }
    }
  }

  // 5. 提取替换目标节目名
  const replacementMatch = userInput.match(/换成(.+?)(?:，|,|$)/)
  if (replacementMatch) {
    result.replacement = {
      type: 'by_name',
      name: replacementMatch[1].trim(),
      fuzzy: true
    }
  }

  // 6. 批量操作提取
  if (userInput.includes('所有') || userInput.includes('全部') || userInput.includes('凡是')) {
    // 提取批量筛选条件
    const batchTypeMatch = userInput.match(/所有(.+?)(?:的|换成|改成|变为)/)
    if (batchTypeMatch) {
      result.targets = [{
        type: 'by_description',
        description: batchTypeMatch[1]
      }]
    }
  }

  return result
}
```

#### 4.4.4 实体链接策略

##### 4.4.4.1 实体链接器设计

```ts
// src/services/entityLinker.ts

/**
 * 实体链接结果
 */
export interface EntityLinkResult {
  /** 成功链接的条目 */
  linkedItems: LinkedItem[]
  /** 未能链接的模糊描述 */
  unresolved: UnresolvedEntity[]
  /** 歧义警告 */
  ambiguities: AmbiguityWarning[]
}

export interface LinkedItem {
  /** 链接到的 ScheduleItem ID */
  itemId: string
  /** 原始引用描述 */
  originalRef: string
  /** 匹配方式 */
  matchType: 'exact_id' | 'exact_name' | 'fuzzy_name' | 'position' | 'time_nearest'
  /** 匹配得分 0-1 */
  confidence: number
  /** 关联的 ScheduleItem */
  item: ScheduleItem
}

export interface UnresolvedEntity {
  /** 原始描述 */
  original: string
  /** 描述类型 */
  entityType: 'program_name' | 'time_reference' | 'position'
  /** 搜索后最接近的候选 */
  nearestCandidates?: Array<{ id: string; name: string; score: number }>
}

export interface AmbiguityWarning {
  /** 原始描述 */
  original: string
  /** 歧义候选列表 */
  candidates: Array<{ itemId: string; item: ScheduleItem; score: number }>
  /** 建议的消解方式 */
  suggestion: string
}

/**
 * 实体链接器
 *
 * 职责：
 * 1. 将模糊描述（节目名、时间、位置）映射到具体 ScheduleItem ID
 * 2. 处理歧义（同名节目、不同时间段的新闻联播）
 * 3. 返回链接结果和未匹配描述
 */
export class EntityLinker {
  private scheduleItems: ScheduleItem[]
  private programLibrary: ProgramLibraryItem[]

  constructor(
    scheduleItems: ScheduleItem[],
    programLibrary: ProgramLibraryItem[]
  ) {
    this.scheduleItems = scheduleItems
    this.programLibrary = programLibrary
  }

  /**
   * 链接节目引用到具体条目
   *
   * @param programValue - 节目参数（可能是ID、名称、位置等）
   * @param timeContext - 时间上下文（用于消歧）
   * @returns 链接结果
   */
  linkProgram(
    programValue: ProgramValue,
    timeContext?: { start?: string; end?: string }
  ): EntityLinkResult {
    switch (programValue.type) {
      case 'by_id':
        return this.linkById(programValue.id)

      case 'by_name':
        return this.linkByName(programValue.name, programValue.fuzzy, timeContext)

      case 'by_position':
        return this.linkByPosition(programValue.position)

      case 'by_time':
        return this.linkByTime(programValue.time, programValue.nearest)

      case 'by_description':
        return this.linkByDescription(programValue.description, timeContext)

      default:
        return { linkedItems: [], unresolved: [], ambiguities: [] }
    }
  }

  /**
   * 按ID链接（精确匹配）
   */
  private linkById(id: string): EntityLinkResult {
    const item = this.scheduleItems.find(i => i.id === id)
    if (item) {
      return {
        linkedItems: [{
          itemId: id,
          originalRef: id,
          matchType: 'exact_id',
          confidence: 1.0,
          item
        }],
        unresolved: [],
        ambiguities: []
      }
    }
    return {
      linkedItems: [],
      unresolved: [{ original: id, entityType: 'program_name' }],
      ambiguities: []
    }
  }

  /**
   * 按节目名链接（支持模糊匹配）
   */
  private linkByName(
    name: string,
    fuzzy: boolean,
    timeContext?: { start?: string; end?: string }
  ): EntityLinkResult {
    const matched = this.scheduleItems.filter(item =>
      fuzzy
        ? item.programName.includes(name) || name.includes(item.programName)
        : item.programName === name
    )

    if (matched.length === 0) {
      return {
        linkedItems: [],
        unresolved: [{ original: name, entityType: 'program_name' }],
        ambiguities: []
      }
    }

    // 如果只有一个匹配，直接返回
    if (matched.length === 1) {
      return {
        linkedItems: [{
          itemId: matched[0].id,
          originalRef: name,
          matchType: fuzzy ? 'fuzzy_name' : 'exact_name',
          confidence: 0.9,
          item: matched[0]
        }],
        unresolved: [],
        ambiguities: []
      }
    }

    // 多个匹配：检查时间上下文进行消歧
    if (matched.length > 1 && timeContext?.start) {
      const timeContextSeconds = this.parseTimeToSeconds(timeContext.start)
      const withTimeDiff = matched.map(item => ({
        item,
        timeDiff: Math.abs(this.parseTimeToSeconds(item.startTime) - timeContextSeconds)
      }))
      withTimeDiff.sort((a, b) => a.timeDiff - b.timeDiff)

      // 如果最近的比第二近的差距足够大，使用最近
      if (withTimeDiff[1].timeDiff - withTimeDiff[0].timeDiff > 600) { // 10分钟
        return {
          linkedItems: [{
            itemId: withTimeDiff[0].item.id,
            originalRef: name,
            matchType: 'time_nearest',
            confidence: 0.85,
            item: withTimeDiff[0].item
          }],
          unresolved: [],
          ambiguities: []
        }
      }
    }

    // 仍有歧义，返回歧义警告
    return {
      linkedItems: [],
      unresolved: [],
      ambiguities: [{
        original: name,
        candidates: matched.map(item => ({
          itemId: item.id,
          item,
          score: 0.8
        })),
        suggestion: `检测到多个"${name}"，请指定具体时间或使用ID引用`
      }]
    }
  }

  /**
   * 按位置链接
   */
  private linkByPosition(position: number): EntityLinkResult {
    // 位置从1开始，转换为索引
    const sortedItems = [...this.scheduleItems].sort((a, b) => a.sortOrder - b.sortOrder)
    const index = position - 1

    if (index >= 0 && index < sortedItems.length) {
      const item = sortedItems[index]
      return {
        linkedItems: [{
          itemId: item.id,
          originalRef: `第${position}条`,
          matchType: 'position',
          confidence: 0.95,
          item
        }],
        unresolved: [],
        ambiguities: []
      }
    }

    return {
      linkedItems: [],
      unresolved: [{ original: `第${position}条`, entityType: 'position' }],
      ambiguities: []
    }
  }

  /**
   * 按时间链接（最近的条目）
   */
  private linkByTime(time: string, nearest: boolean): EntityLinkResult {
    if (!nearest) {
      // 精确时间匹配
      const matched = this.scheduleItems.filter(item => item.startTime === time)
      if (matched.length === 1) {
        return {
          linkedItems: [{
            itemId: matched[0].id,
            originalRef: time,
            matchType: 'exact_name',
            confidence: 1.0,
            item: matched[0]
          }],
          unresolved: [],
          ambiguities: []
        }
      }
    }

    // 找最近的条目
    const timeSeconds = this.parseTimeToSeconds(time)
    const withTimeDiff = this.scheduleItems.map(item => ({
      item,
      timeDiff: Math.abs(this.parseTimeToSeconds(item.startTime) - timeSeconds)
    }))
    withTimeDiff.sort((a, b) => a.timeDiff - b.timeDiff)

    const nearestItem = withTimeDiff[0]
    return {
      linkedItems: [{
        itemId: nearestItem.item.id,
        originalRef: time,
        matchType: 'time_nearest',
        confidence: nearest ? 0.7 : 0.8,
        item: nearestItem.item
      }],
      unresolved: [],
      ambiguities: []
    }
  }

  /**
   * 按描述筛选（批量操作）
   */
  private linkByDescription(
    description: string,
    timeContext?: { start?: string; end?: string }
  ): EntityLinkResult {
    const filtered = this.scheduleItems.filter(item => {
      // 按业务类型筛选
      if (description.includes('新闻')) {
        return item.businessType === 'program' && item.programName.includes('新闻')
      }
      if (description.includes('广告')) {
        return item.businessType === 'ad'
      }
      if (description.includes('宣传片')) {
        return item.businessType === 'promo'
      }
      // 按时间范围筛选
      if (timeContext?.start && item.startTime >= timeContext.start) {
        return true
      }
      if (timeContext?.end && item.startTime <= timeContext.end) {
        return true
      }
      return false
    })

    return {
      linkedItems: filtered.map(item => ({
        itemId: item.id,
        originalRef: description,
        matchType: 'fuzzy_name',
        confidence: 0.75,
        item
      })),
      unresolved: [],
      ambiguities: []
    }
  }

  private parseTimeToSeconds(time: string): number {
    const parts = time.split(':').map(Number)
    return parts[0] * 3600 + parts[1] * 60 + (parts[2] || 0)
  }
}
```

#### 4.4.5 置信度评估机制

##### 4.4.5.1 置信度等级定义

```ts
// src/types/intent.ts (续)

/**
 * 置信度等级
 */
export enum ConfidenceLevel {
  HIGH = 'high',     // >= 0.9 明确，无需澄清
  MEDIUM = 'medium', // 0.7-0.9 基本明确，可尝试执行
  LOW = 'low',       // 0.5-0.7 模糊，需要澄清
  VERY_LOW = 'very_low'  // < 0.5 无法识别，需重述
}

/**
 * 置信度评估结果
 */
export interface ConfidenceEvaluation {
  /** 置信度数值 0-1 */
  score: number
  /** 置信度等级 */
  level: ConfidenceLevel
  /** 是否需要澄清 */
  needsClarification: boolean
  /** 澄清问题列表 */
  clarificationQuestions?: ClarificationQuestion[]
  /** 风险提示 */
  warnings: string[]
  /** 评估理由 */
  reasoning: string
}

/**
 * 澄清问题
 */
export interface ClarificationQuestion {
  /** 问题ID */
  id: string
  /** 问题类型 */
  type: 'select' | 'confirm' | 'specify'
  /** 问题文本 */
  question: string
  /** 候选选项（用于select类型） */
  options?: Array<{ value: string; label: string }>
  /** 是否必答 */
  required: boolean
}
```

##### 4.4.5.2 置信度评估规则

```ts
// src/services/confidenceEvaluator.ts

/**
 * 置信度评估器
 *
 * 评估维度：
 * 1. 意图清晰度 - 是否有明确的意图关键词
 * 2. 参数完整性 - 必要参数是否齐全
 * 3. 实体可链接性 - 节目引用是否能链接到具体条目
 * 4. 歧义消解状态 - 是否存在未解决的歧义
 */
export class ConfidenceEvaluator {

  /**
   * 评估置信度
   */
  evaluate(
    classification: IntentClassification,
    params: ExtractedParams,
    linkResult: EntityLinkResult
  ): ConfidenceEvaluation {
    const warnings: string[] = []
    const reasoningParts: string[] = []

    // 1. 意图清晰度评分 (0-0.3)
    let intentScore = 0
    if (classification.confidence >= 0.9) {
      intentScore = 0.3
      reasoningParts.push('意图分类高置信度')
    } else if (classification.confidence >= 0.7) {
      intentScore = 0.2
      reasoningParts.push('意图分类中等置信度')
    } else {
      intentScore = 0.1
      warnings.push('意图分类置信度较低')
    }

    // 2. 参数完整性评分 (0-0.3)
    let paramScore = 0
    const requiredParams = this.getRequiredParamsForIntent(classification.primaryIntent)
    const hasRequiredParams = this.checkRequiredParams(params, requiredParams)
    if (hasRequiredParams) {
      paramScore = 0.3
      reasoningParts.push('必要参数齐全')
    } else {
      paramScore = 0.1
      warnings.push('必要参数不完整')
    }

    // 3. 实体可链接性评分 (0-0.3)
    let linkScore = 0
    if (linkResult.ambiguities.length > 0) {
      linkScore = 0.1
      warnings.push(`存在${linkResult.ambiguities.length}个歧义需要消解`)
    } else if (linkResult.unresolved.length > 0) {
      linkScore = 0.05
      warnings.push(`存在${linkResult.unresolved.length}个无法链接的实体`)
    } else if (linkResult.linkedItems.length > 0) {
      const avgConfidence = linkResult.linkedItems.reduce((sum, li) => sum + li.confidence, 0) / linkResult.linkedItems.length
      linkScore = avgConfidence * 0.3
      reasoningParts.push(`实体链接平均置信度: ${(avgConfidence * 100).toFixed(0)}%`)
    }

    // 4. 歧义消解状态评分 (0-0.1)
    let ambiguityScore = 0.1
    if (classification.ambiguity) {
      ambiguityScore = 0
      warnings.push('存在意图歧义')
    }

    // 计算总分
    const totalScore = intentScore + paramScore + linkScore + ambiguityScore

    // 判断是否需要澄清
    const needsClarification =
      totalScore < 0.7 ||
      warnings.length > 0 ||
      linkResult.ambiguities.length > 0 ||
      linkResult.unresolved.length > 0

    // 生成澄清问题
    const clarificationQuestions = this.generateClarificationQuestions(
      classification,
      params,
      linkResult
    )

    // 确定置信度等级
    let level: ConfidenceLevel
    if (totalScore >= 0.9) level = ConfidenceLevel.HIGH
    else if (totalScore >= 0.7) level = ConfidenceLevel.MEDIUM
    else if (totalScore >= 0.5) level = ConfidenceLevel.LOW
    else level = ConfidenceLevel.VERY_LOW

    return {
      score: Math.round(totalScore * 100) / 100,
      level,
      needsClarification,
      clarificationQuestions: needsClarification ? clarificationQuestions : undefined,
      warnings,
      reasoning: reasoningParts.join('；')
    }
  }

  /**
   * 获取意图必需的参数
   */
  private getRequiredParamsForIntent(intent: IntentType): string[] {
    const paramMap: Record<IntentType, string[]> = {
      [IntentType.INSERT]: ['anchor_or_time', 'program_name'],
      [IntentType.DELETE]: ['target'],
      [IntentType.REPLACE]: ['target', 'replacement'],
      [IntentType.UPDATE_FIELD]: ['target', 'field', 'new_value'],
      [IntentType.SWAP]: ['target_a', 'target_b'],
      [IntentType.MOVE]: ['target', 'new_position'],
      [IntentType.SHIFT_TIME]: ['target', 'offset'],
      [IntentType.BATCH_UPDATE]: ['condition', 'field', 'new_value'],
      [IntentType.BATCH_REPLACE]: ['condition', 'replacement'],
      [IntentType.QUERY]: ['query_target'],
      [IntentType.CLARIFICATION]: [],
      [IntentType.UNKNOWN]: []
    }
    return paramMap[intent] || []
  }

  /**
   * 检查必要参数
   */
  private checkRequiredParams(params: ExtractedParams, required: string[]): boolean {
    for (const req of required) {
      switch (req) {
        case 'anchor_or_time':
          if (!params.timeParams.targetTime && !params.programParams.anchor) return false
          break
        case 'program_name':
          if (!params.programParams.target && !params.programParams.replacement) return false
          break
        case 'target':
          if (params.programParams.targets?.length === 0 && !params.programParams.target) return false
          break
        case 'replacement':
          if (!params.programParams.replacement) return false
          break
        case 'field':
          if (!params.fieldParams?.fieldName) return false
          break
        case 'new_value':
          if (!params.fieldParams?.newValue) return false
          break
        case 'offset':
          if (!params.timeParams.offset) return false
          break
      }
    }
    return true
  }

  /**
   * 生成澄清问题
   */
  private generateClarificationQuestions(
    classification: IntentClassification,
    params: ExtractedParams,
    linkResult: EntityLinkResult
  ): ClarificationQuestion[] {
    const questions: ClarificationQuestion[] = []

    // 处理歧义
    if (linkResult.ambiguities.length > 0) {
      for (const amb of linkResult.ambiguities) {
        questions.push({
          id: `amb_${amb.original}`,
          type: 'select',
          question: amb.suggestion,
          options: amb.candidates.map((c, i) => ({
            value: c.itemId,
            label: `${c.item.startTime} ${c.item.programName}`
          })),
          required: true
        })
      }
    }

    // 处理未解析实体
    if (linkResult.unresolved.length > 0) {
      for (const unr of linkResult.unresolved) {
        questions.push({
          id: `unresolved_${unr.original}`,
          type: 'specify',
          question: `无法找到"${unr.original}"，请确认节目名称或使用ID引用`,
          required: true
        })
      }
    }

    // 处理意图歧义
    if (classification.ambiguity && classification.ambiguityCandidates) {
      questions.push({
        id: 'intent_ambiguity',
        type: 'select',
        question: '您的意图是执行哪种操作？',
        options: classification.ambiguityCandidates.map(c => ({
          value: c,
          label: this.getIntentDescription(c)
        })),
        required: true
      })
    }

    // 参数缺失
    if (classification.primaryIntent === IntentType.INSERT && !params.programParams.replacement) {
      questions.push({
        id: 'missing_program',
        type: 'specify',
        question: '请指定要插入的节目名称',
        required: true
      })
    }

    return questions
  }

  private getIntentDescription(intent: IntentType): string {
    const descriptions: Record<IntentType, string> = {
      [IntentType.INSERT]: '插入新节目',
      [IntentType.DELETE]: '删除节目',
      [IntentType.REPLACE]: '替换节目',
      [IntentType.UPDATE_FIELD]: '修改字段',
      [IntentType.SWAP]: '交换位置',
      [IntentType.MOVE]: '移动位置',
      [IntentType.SHIFT_TIME]: '时间偏移',
      [IntentType.BATCH_UPDATE]: '批量修改',
      [IntentType.BATCH_REPLACE]: '批量替换',
      [IntentType.QUERY]: '查询',
      [IntentType.CLARIFICATION]: '澄清',
      [IntentType.UNKNOWN]: '未知'
    }
    return descriptions[intent] || intent
  }
}
```

#### 4.4.6 多轮对话支持

##### 4.4.6.1 对话上下文管理

```ts
// src/services/dialogueContext.ts

/**
 * 对话上下文条目
 */
export interface DialogueTurn {
  /** 轮次ID */
  turnId: number
  /** 用户原始输入 */
  userInput: string
  /** 意图分类结果 */
  classification?: IntentClassification
  /** 参数提取结果 */
  extractedParams?: ExtractedParams
  /** 实体链接结果 */
  linkResult?: EntityLinkResult
  /** 置信度评估 */
  confidence?: ConfidenceEvaluation
  /** 生成的命令 */
  generatedCommand?: ScheduleCommand
  /** 命令执行结果 */
  executionResult?: CommandExecutionResult
  /** 时间戳 */
  timestamp: number
}

/**
 * 对话上下文状态
 */
export interface DialogueContext {
  /** 会话ID */
  sessionId: string
  /** 对话历史 */
  turns: DialogueTurn[]
  /** 当前待确认的命令 */
  pendingCommand?: ScheduleCommand
  /** 当前轮次 */
  currentTurnId: number
  /** 澄清问题栈 */
  clarificationStack: ClarificationQuestion[]
  /** 元信息 */
  meta: {
    channelId: string
    date: string
    itemCount: number
  }
}

/**
 * 对话上下文管理器
 */
export class DialogueContextManager {
  private context: DialogueContext
  private maxHistoryLength = 50  // 最多保留50轮对话

  constructor(sessionId: string, channelId: string, date: string, itemCount: number) {
    this.context = {
      sessionId,
      turns: [],
      currentTurnId: 0,
      clarificationStack: [],
      meta: { channelId, date, itemCount }
    }
  }

  /**
   * 添加一轮对话
   */
  addTurn(turn: Omit<DialogueTurn, 'turnId' | 'timestamp'>): number {
    const turnId = this.context.currentTurnId + 1
    const newTurn: DialogueTurn = {
      ...turn,
      turnId,
      timestamp: Date.now()
    }

    this.context.turns.push(newTurn)
    this.context.currentTurnId = turnId

    // 限制历史长度
    if (this.context.turns.length > this.maxHistoryLength) {
      this.context.turns = this.context.turns.slice(-this.maxHistoryLength)
    }

    return turnId
  }

  /**
   * 更新当前轮次
   */
  updateCurrentTurn(updates: Partial<DialogueTurn>): void {
    const currentIndex = this.context.turns.findIndex(
      t => t.turnId === this.context.currentTurnId
    )
    if (currentIndex >= 0) {
      this.context.turns[currentIndex] = {
        ...this.context.turns[currentIndex],
        ...updates
      }
    }
  }

  /**
   * 获取当前轮次
   */
  getCurrentTurn(): DialogueTurn | undefined {
    return this.context.turns.find(t => t.turnId === this.context.currentTurnId)
  }

  /**
   * 推送澄清问题
   */
  pushClarification(question: ClarificationQuestion): void {
    this.context.clarificationStack.push(question)
  }

  /**
   * 弹出澄清问题
   */
  popClarification(): ClarificationQuestion | undefined {
    return this.context.clarificationStack.pop()
  }

  /**
   * 获取最近的澄清问题
   */
  getCurrentClarification(): ClarificationQuestion | undefined {
    return this.context.clarificationStack[this.context.clarificationStack.length - 1]
  }

  /**
   * 检查是否有待回答的澄清
   */
  hasPendingClarification(): boolean {
    return this.context.clarificationStack.length > 0
  }

  /**
   * 获取对话历史摘要（用于Prompt构建）
   */
  getHistorySummary(): string {
    if (this.context.turns.length === 0) {
      return '（暂无对话历史）'
    }

    const recentTurns = this.context.turns.slice(-5)  // 最近5轮
    const lines: string[] = []

    for (const turn of recentTurns) {
      if (turn.executionResult) {
        lines.push(`用户: ${turn.userInput}`)
        lines.push(`AI: ${turn.executionResult.explanation}`)
      }
    }

    return lines.join('\n')
  }

  /**
   * 获取上下文用于Prompt
   */
  getContextForPrompt(): {
    historySummary: string
    hasPendingClarification: boolean
    currentQuestion?: ClarificationQuestion
    lastCommand?: ScheduleCommand
  } {
    return {
      historySummary: this.getHistorySummary(),
      hasPendingClarification: this.hasPendingClarification(),
      currentQuestion: this.getCurrentClarification(),
      lastCommand: this.context.pendingCommand
    }
  }
}
```

##### 4.4.6.2 多轮对话处理流程

```ts
// src/services/intentRecognizer.ts

/**
 * 意图识别与命令转换器
 * 整合分类器、参数提取器、实体链接器、置信度评估器
 */
export class IntentRecognizer {
  private entityLinker: EntityLinker
  private confidenceEvaluator: ConfidenceEvaluator
  private dialogueManager: DialogueContextManager

  constructor(
    scheduleItems: ScheduleItem[],
    programLibrary: ProgramLibraryItem[],
    dialogueManager: DialogueContextManager
  ) {
    this.entityLinker = new EntityLinker(scheduleItems, programLibrary)
    this.confidenceEvaluator = new ConfidenceEvaluator()
    this.dialogueManager = dialogueManager
  }

  /**
   * 处理用户输入
   * 返回识别结果或澄清请求
   */
  async recognize(
    userInput: string,
    options?: {
      forceIntent?: IntentType  // 用于澄清后的强制意图
      clarificationAnswer?: any  // 澄清问题的回答
    }
  ): Promise<RecognitionResult> {

    // 1. 如果有待回答的澄清问题，先处理澄清
    if (this.dialogueManager.hasPendingClarification() && options?.clarificationAnswer) {
      return this.handleClarification(options.clarificationAnswer)
    }

    // 2. 意图分类
    const classification = await this.classifyIntent(userInput)

    // 3. 参数提取
    const params = this.extractAllParams(userInput, classification)

    // 4. 实体链接
    const timeContext = params.timeParams.timeRange
    const linkResult = this.linkAllEntities(params, timeContext)

    // 5. 置信度评估
    const confidence = this.confidenceEvaluator.evaluate(
      classification,
      params,
      linkResult
    )

    // 6. 保存当前识别结果到上下文
    const turnId = this.dialogueManager.addTurn({
      userInput,
      classification,
      extractedParams: params,
      linkResult,
      confidence
    })

    // 7. 判断是否需要澄清
    if (confidence.needsClarification) {
      // 保存当前轮次ID，返回澄清请求
      this.dialogueManager.updateCurrentTurn({ turnId })
      return {
        type: 'clarification_required',
        confidence,
        questions: confidence.clarificationQuestions,
        turnId
      }
    }

    // 8. 生成命令
    const command = this.generateCommand(classification, params, linkResult)

    // 9. 保存待确认命令
    this.dialogueManager.updateCurrentTurn({
      turnId,
      generatedCommand: command
    })
    this.dialogueManager['context'].pendingCommand = command

    return {
      type: 'command_ready',
      command,
      confidence,
      explanation: this.generateExplanation(classification, params, linkResult)
    }
  }

  /**
   * 处理澄清回答
   */
  private async handleClarification(answer: any): Promise<RecognitionResult> {
    const question = this.dialogueManager.popClarification()
    if (!question) {
      return {
        type: 'error',
        error: '没有待回答的澄清问题'
      }
    }

    // 根据问题类型处理答案
    const currentTurn = this.dialogueManager.getCurrentTurn()
    if (!currentTurn) {
      return {
        type: 'error',
        error: '对话上下文丢失'
      }
    }

    // 更新参数或分类
    if (question.type === 'select' && question.options) {
      // 选择类问题：更新链接结果
      const selectedItem = question.options.find(o => o.value === answer)
      if (selectedItem) {
        // 重新生成命令
        const command = this.generateCommand(
          currentTurn.classification!,
          currentTurn.extractedParams!,
          currentTurn.linkResult!
        )
        return {
          type: 'command_ready',
          command,
          confidence: { ...currentTurn.confidence!, score: 0.9, level: ConfidenceLevel.HIGH },
          explanation: `已根据您的选择生成命令`
        }
      }
    }

    return {
      type: 'error',
      error: '无法处理此澄清回答'
    }
  }

  /**
   * 完整的意图识别结果
   */
  private async classifyIntent(userInput: string): Promise<IntentClassification> {
    // 调用LLM进行意图分类
    const classificationPrompt = buildClassificationPrompt(userInput)
    const response = await callLLM(classificationPrompt)
    return parseClassificationResponse(response)
  }

  private extractAllParams(userInput: string, classification: IntentClassification): ExtractedParams {
    // 提取时间参数
    const timeParams = extractTimeParams(userInput)

    // 提取节目参数
    const programParams = extractProgramParams(userInput, [])

    // 提取字段更新参数
    const fieldParams = extractFieldParams(userInput)

    return {
      timeParams,
      programParams,
      quantityParams: {},  // 从timeParams中派生
      fieldParams,
      rawText: userInput,
      warnings: []
    }
  }

  private linkAllEntities(
    params: ExtractedParams,
    timeContext?: { start?: string; end?: string }
  ): EntityLinkResult {
    const result: EntityLinkResult = {
      linkedItems: [],
      unresolved: [],
      ambiguities: []
    }

    // 链接目标节目
    if (params.programParams.target) {
      const targetLink = this.entityLinker.linkProgram(params.programParams.target, timeContext)
      result.linkedItems.push(...targetLink.linkedItems)
      result.unresolved.push(...targetLink.unresolved)
      result.ambiguities.push(...targetLink.ambiguities)
    }

    // 链接锚点节目
    if (params.programParams.anchor) {
      const anchorLink = this.entityLinker.linkProgram(params.programParams.anchor, timeContext)
      result.linkedItems.push(...anchorLink.linkedItems)
      result.unresolved.push(...anchorLink.unresolved)
      result.ambiguities.push(...anchorLink.ambiguities)
    }

    // 链接替换节目
    if (params.programParams.replacement) {
      const replacementLink = this.entityLinker.linkProgram(params.programParams.replacement, timeContext)
      result.linkedItems.push(...replacementLink.linkedItems)
      result.unresolved.push(...replacementLink.unresolved)
      result.ambiguities.push(...replacementLink.ambiguities)
    }

    return result
  }

  private generateCommand(
    classification: IntentClassification,
    params: ExtractedParams,
    linkResult: EntityLinkResult
  ): ScheduleCommand {
    const linkedItems = linkResult.linkedItems
    const primaryLinked = linkedItems[0]

    switch (classification.primaryIntent) {
      case IntentType.INSERT: {
        const anchorLinked = linkedItems.find(li =>
          li.originalRef === params.programParams.anchor?.toString()
        )
        return {
          action: 'insert',
          afterItemId: anchorLinked?.itemId || primaryLinked?.itemId || null,
          items: [this.buildRundownItemFromParams(params)],
          explanation: `在${params.programParams.anchor?.toString() || '末尾'}插入${params.programParams.replacement?.toString()}`
        }
      }

      case IntentType.DELETE: {
        return {
          action: 'delete',
          targetIds: linkedItems.map(li => li.itemId),
          explanation: `删除${linkedItems.length}个节目`
        }
      }

      case IntentType.REPLACE: {
        const targetLinked = linkedItems.find(li =>
          li.originalRef === params.programParams.target?.toString()
        )
        return {
          action: 'replace',
          replacements: [{
            targetId: targetLinked?.itemId || primaryLinked.itemId,
            newItem: this.buildRundownItemFromParams(params)
          }],
          explanation: `将${params.programParams.target?.toString()}替换为${params.programParams.replacement?.toString()}`
        }
      }

      case IntentType.SHIFT_TIME: {
        const targetIds = linkedItems.map(li => li.itemId)
        const offsetSeconds = params.timeParams.offset?.value || 0
        return {
          action: 'batch',  // 时间偏移作为批量操作处理
          commands: [{
            action: 'update_field',
            targetId: targetIds[0],
            fields: { startTime: this.calculateShiftedTime(primaryLinked.item.startTime, offsetSeconds) },
            explanation: ''
          } as UpdateFieldCommand],
          explanation: `将${targetIds.length}个节目的时间后移${offsetSeconds}秒`
        }
      }

      case IntentType.BATCH_UPDATE: {
        return {
          action: 'batch_update',
          filter: this.buildFilterFromParams(params),
          updates: params.fieldParams || {},
          explanation: `批量更新符合条件的节目`
        }
      }

      default:
        throw new Error(`未支持的意图类型: ${classification.primaryIntent}`)
    }
  }

  private buildRundownItemFromParams(params: ExtractedParams): Partial<RundownItem> {
    // 从参数构建RundownItem
    return {
      programName: params.programParams.replacement?.toString() || '新节目',
      broadcastType: '录播',
      duration: params.timeParams.offset?.type === 'duration'
        ? this.secondsToDuration(params.timeParams.offset.value)
        : '00:30:00:00'
    }
  }

  private buildFilterFromParams(params: ExtractedParams): any {
    const filter: any = {}
    if (params.timeParams.timeRange) {
      filter.timeRange = params.timeParams.timeRange
    }
    return filter
  }

  private calculateShiftedTime(time: string, offsetSeconds: number): string {
    const parts = time.split(':').map(Number)
    const totalSeconds = parts[0] * 3600 + parts[1] * 60 + parts[2] + offsetSeconds
    const hh = Math.floor(totalSeconds / 3600) % 24
    const mm = Math.floor((totalSeconds % 3600) / 60)
    const ss = totalSeconds % 60
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
  }

  private secondsToDuration(seconds: number): string {
    const hh = Math.floor(seconds / 3600)
    const mm = Math.floor((seconds % 3600) / 60)
    const ss = seconds % 60
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}:00`
  }

  private generateExplanation(
    classification: IntentClassification,
    params: ExtractedParams,
    linkResult: EntityLinkResult
  ): string {
    const intentDesc = this.getIntentDescription(classification.primaryIntent)
    const targetCount = linkResult.linkedItems.length
    return `${intentDesc}，涉及${targetCount}个节目`
  }

  private getIntentDescription(intent: IntentType): string {
    const descriptions: Record<IntentType, string> = {
      [IntentType.INSERT]: '插入节目',
      [IntentType.DELETE]: '删除节目',
      [IntentType.REPLACE]: '替换节目',
      [IntentType.UPDATE_FIELD]: '更新字段',
      [IntentType.SWAP]: '交换位置',
      [IntentType.MOVE]: '移动位置',
      [IntentType.SHIFT_TIME]: '时间偏移',
      [IntentType.BATCH_UPDATE]: '批量更新',
      [IntentType.BATCH_REPLACE]: '批量替换',
      [IntentType.QUERY]: '查询',
      [IntentType.CLARIFICATION]: '澄清',
      [IntentType.UNKNOWN]: '未知'
    }
    return descriptions[intent] || intent
  }
}

/**
 * 识别结果类型
 */
export type RecognitionResult =
  | {
      type: 'command_ready'
      command: ScheduleCommand
      confidence: ConfidenceEvaluation
      explanation: string
    }
  | {
      type: 'clarification_required'
      confidence: ConfidenceEvaluation
      questions: ClarificationQuestion[]
      turnId: number
    }
  | {
      type: 'error'
      error: string
    }
```

#### 4.4.7 LLM 调用策略

##### 4.4.7.1 两阶段 vs 单阶段对比

| 策略      | 适用场景    | 优点          | 缺点        |
| ------- | ------- | ----------- | --------- |
| **单阶段** | 简单明确指令  | 1次LLM调用，低延迟 | 复杂指令准确率低  |
| **两阶段** | 复杂/模糊指令 | 高准确率，可澄清    | 2次调用，稍高延迟 |

**推荐策略**：默认使用**两阶段模式**，当意图分类置信度>=0.9时跳过参数提取阶段直接生成命令。

##### 4.4.7.2 两阶段 Prompt 设计

**阶段1：意图分类 + 参数提取（联合调用）**

```text
# 角色
你是一位广电节目串联单编辑助手，擅长理解用户的修改意图。

# 任务
分析用户输入，输出结构化的意图和参数。

# 输入格式
用户：[用户输入]

# 节目库上下文
[节目库摘要，最多20个最相关的节目]

# 串联单当前上下文（部分）
[按时间排序的节目列表，最多显示前后各3条]

# 输出格式（严格JSON）
{
  "intent": "insert|delete|replace|update_field|swap|move|shift_time|batch_update|batch_replace|query|unknown",
  "confidence": 0.0-1.0,
  "reasoning": "分类理由",
  "ambiguity": true|false,
  "ambiguityCandidates": ["可能的意图1", "可能的意图2"],
  "params": {
    "targetTime": "HH:mm:ss或null",
    "targetProgram": "节目名或null",
    "targetId": "ITEMXXX或null",
    "replacementProgram": "节目名或null",
    "offset": "30秒、5分钟等或null",
    "duration": "5分钟、30秒等或null",
    "fieldName": "字段名或null",
    "newValue": "新值或null",
    "timeRangeStart": "HH:mm:ss或null",
    "timeRangeEnd": "HH:mm:ss或null",
    "batchCondition": "筛选条件描述或null"
  },
  "warnings": ["警告信息列表"]
}

# 分类规则
- "在X插入Y" → intent: insert
- "把X换成Y" → intent: replace
- "删掉X" → intent: delete
- "把X的Y改成Z" → intent: update_field
- "把X和Y对调" → intent: swap
- "把X移到Y之后" → intent: move
- "X后移30秒" → intent: shift_time
- "把12:00以后的全变成广告" → intent: batch_update
- "把所有新闻换成电视剧" → intent: batch_replace

# 歧义检测
- "把XX变成广告"：检查是否有多时段/多匹配
  - 有时间范围 → batch_update
  - 无时间范围，单个目标 → replace
- "后移30秒"：检查是否有时间范围限定
  - "XX以后的后移" → 批量shift_time
  - "XX后移" → 单条shift_time

只输出JSON，不要包含其他文字。
```

**阶段2：命令生成（基于提取的参数）**

```text
# 角色
你是一位广电节目串联单命令生成专家。

# 任务
基于提取的参数和串联单上下文，生成标准化的ScheduleCommand。

# 当前串联单上下文
[按时间排序的节目列表，包含ID、时间、节目名]

# 用户原始输入
[原始输入]

# 提取的参数
[阶段1输出的参数]

# 可用节目库（按频道过滤）
[节目库JSON]

# 输出格式（严格JSON）
{
  "action": "命令类型",
  // 根据action类型包含相应字段
  "explanation": "执行说明"
}

# 命令生成规则

## insert
{
  "action": "insert",
  "afterItemId": "ITEMXXX或null",
  "items": [{
    "id": "ITEM{下一个序号}",
    "sequence": 序号,
    "broadcastTime": "HH:mm:ss:00",
    "endTime": "HH:mm:ss:00",
    "broadcastType": "录播|直播|广告|宣传片",
    "programName": "节目库中的名称",
    "relativePoint": "00:00:00:00",
    "duration": "HH:mm:ss:00",
    "programCode": "节目库中的code",
    "studioName": "仅直播需要",
    "deliveryStatus": "待送播",
    "remarks": ""
  }],
  "explanation": "说明"
}

## delete
{
  "action": "delete",
  "targetIds": ["ITEM001", "ITEM002"],
  "explanation": "说明"
}

## replace
{
  "action": "replace",
  "replacements": [{
    "targetId": "ITEMXXX",
    "newItem": { RundownItem }
  }],
  "explanation": "说明"
}

## swap
{
  "action": "swap",
  "itemIdA": "ITEMXXX",
  "itemIdB": "ITEMYYY",
  "explanation": "说明"
}

## move
{
  "action": "move",
  "itemId": "ITEMXXX",
  "afterItemId": "ITEMYYY或null",
  "explanation": "说明"
}

## update_field
{
  "action": "update_field",
  "targetId": "ITEMXXX",
  "fields": { "字段名": "新值" },
  "explanation": "说明"
}

## shift_time
{
  "action": "shift_time",
  "targetIds": ["ITEMXXX"],  // 或 ["*"] 表示全部
  "offsetSeconds": 30,
  "rangeStart": "HH:mm:ss或null",  // 批量时指定范围起点
  "explanation": "说明"
}

## batch_update
{
  "action": "batch_update",
  "filter": {
    "timeRange": { "start": "HH:mm:ss", "end": "HH:mm:ss" },
    "programTypes": ["新闻"],
    "businessTypes": ["program"]
  },
  "updates": { "字段名": "新值" },
  "explanation": "说明"
}

## batch
{
  "action": "batch",
  "commands": [上述命令数组],
  "explanation": "说明"
}

只输出JSON，不要包含其他文字。
```

##### 4.4.7.3 置信度阈值策略

```ts
// src/services/intentRecognizer.ts (续)

/**
 * 置信度阈值配置
 */
const CONFIDENCE_THRESHOLDS = {
  /** 直接执行，无需确认 */
  HIGH_CONFIRM: 0.9,
  /** 执行但显示预览 */
  MEDIUM_CONFIRM: 0.7,
  /** 需要用户确认 */
  LOW_CONFIRM: 0.5,
  /** 必须澄清 */
  CLARIFICATION: 0.5
}

/**
 * 执行策略
 */
export type ExecutionStrategy =
  | 'direct_execute'   // 直接执行
  | 'preview_then_execute'  // 预览后执行
  | 'user_confirm'     // 用户确认后执行
  | 'need_clarification'  // 需要澄清

/**
 * 根据置信度决定执行策略
 */
export function determineExecutionStrategy(
  confidence: ConfidenceEvaluation
): ExecutionStrategy {
  if (confidence.score >= CONFIDENCE_THRESHOLDS.HIGH_CONFIRM) {
    return 'direct_execute'
  }
  if (confidence.score >= CONFIDENCE_THRESHOLDS.MEDIUM_CONFIRM) {
    return 'preview_then_execute'
  }
  if (confidence.score >= CONFIDENCE_THRESHOLDS.LOW_CONFIRM) {
    return 'user_confirm'
  }
  return 'need_clarification'
}
```

#### 4.4.8 Prompt 设计完整模板

##### 4.4.8.1 综合 System Prompt（推荐方案）

将所有能力整合到一个 System Prompt 中，让 LLM 一次性完成分类、提取、消歧：

````text
# 角色
你是一位广电节目串联单编辑专家，代号 Broca。

## 你的专长
1. 理解用户的自然语言修改指令
2. 准确识别意图类型
3. 提取关键参数（时间、节目、数量）
4. 处理歧义和模糊表达
5. 生成标准化的修改命令

## 意图分类体系

### 8种基础操作
| 意图 | 典型句式 | 必要参数 |
|------|---------|---------|
| insert | "在X之后加Y" / "插入Y" | 锚点位置+新节目 |
| delete | "删掉X" / "删除X" | 目标节目 |
| replace | "把X换成Y" / "X变成Y" | 目标+替换节目 |
| update_field | "把X的备注改成Y" | 目标+字段名+新值 |
| swap | "把X和Y对调" | 两个目标 |
| move | "把X移到Y之后" | 目标+新位置 |
| shift_time | "X后移30秒" | 目标+偏移量 |
| query | "看看X" | 查询条件 |

### 2种批量操作
| 意图 | 典型句式 | 必要参数 |
|------|---------|---------|
| batch_update | "把12:00以后的全变成广告" | 时间范围+更新内容 |
| batch_replace | "把所有新闻换成电视剧" | 筛选条件+替换内容 |

### 复合操作
| 意图 | 说明 |
|------|------|
| batch | 包含多个子命令的批量操作 |

## 参数提取规则

### 时间参数
- 精确时间：09:30:00 / 09:30
- 模糊时间：黄金时段(19:00-22:00) / 午间(11:30-13:30) / 早间/晚间等
- 相对时间：后移30秒 / 提前5分钟 / 推迟10分钟
- 范围表达：12:00以后 / 12:00之前 / 从09:00到12:00

### 节目参数
- ID引用：ITEM003 / 第3条
- 名称引用：新闻联播 / 早安上海
- 位置引用：第3条 / 最后一条
- 时间定位：12:00的节目 / 19:00那个

### 歧义消解规则
1. "把XX变成广告"
   - 有时间范围限定词(以后/所有) → batch_update
   - 无范围限定，单个目标 → replace

2. "把XX后移30秒"
   - "XX以后的后移" → shift_time 批量
   - 单独"XX后移" → shift_time 单条

3. "黄金时段多加些新闻"
   - 意图不完整，需要澄清"加多少？"、"加在什么位置？"
   - → 返回clarification类型

4. 同名节目歧义
   - 返回多个候选，要求用户指定时间

## 输出格式

### 标准识别输出
```json
{
  "type": "recognition",
  "intent": "意图类型",
  "confidence": 0.0-1.0,
  "reasoning": "分类和参数提取的理由",
  "ambiguity": true或false,
  "params": {
    "targetTime": "HH:mm:ss或fuzzy:时段名",
    "targetProgram": "节目名",
    "targetId": "ITEMXXX或null",
    "replacementProgram": "节目名或null",
    "offset": "数字+单位或null",
    "duration": "数字+单位或null",
    "fieldName": "字段名或null",
    "newValue": "新值或null",
    "timeRange": {"start": "HH:mm:ss", "end": "HH:mm:ss"}或null,
    "targetIds": ["ITEMXXX"]或null
  },
  "warnings": ["警告列表"],
  "needsClarification": true或false,
  "clarificationQuestion": "如果需要澄清，输出问题"或null
}
````

### 命令输出（confidence >= 0.7时）

```json
{
  "type": "command",
  "action": "命令类型",
  "explanation": "执行说明",
  "preview": {
    "affectedItems": ["ITEMXXX"],
    "changes": "变更摘要"
  }
}
```

### 澄清输出（confidence < 0.7时）

```json
{
  "type": "clarification",
  "question": "澄清问题",
  "options": [
    {"value": "选项1", "label": "选项1说明"},
    {"value": "选项2", "label": "选项2说明"}
  ]或null,
  "reasoning": "为什么需要澄清"
}
```

## 限制

- 只从节目库中选择节目，不编造
- 时间格式统一为 HH:mm:ss
- duration 格式为 HH:mm:ss:00
- 不修改未明确指定的内容
- 批量操作需要明确的时间范围或筛选条件

## 节目库

\[在此注入当前频道的节目库JSON，最多50条最相关的]

## 当前串联单上下文

\[在此注入按时间排序的节目列表，每条包含：ID、时间、节目名、业务类型]

只输出JSON，不要包含其他文字。

````

##### 4.4.8.2 用户输入示例与预期输出对照

| # | 用户输入 | 预期意图 | 预期输出关键字段 |
|---|---------|---------|-----------------|
| 1 | "在10:00插入新闻联播" | insert | targetTime: 10:00:00, replacementProgram: 新闻联播 |
| 2 | "把ITEM003的时间改为09:30:00" | update_field | targetId: ITEM003, fieldName: startTime, newValue: 09:30:00 |
| 3 | "把ITEM005的时间后移30秒" | shift_time | targetId: ITEM005, offset: 30秒 |
| 4 | "将12:00以后的所有内容变为广告" | batch_update | timeRange.start: 12:00:00, fieldName: businessType, newValue: ad |
| 5 | "把19:00的节目换成中超直播" | replace | targetTime: 19:00:00(nearest), replacementProgram: 中超直播 |
| 6 | "在早安上海之后加5分钟宣传片" | insert | targetProgram: 早安上海(anchor), duration: 5分钟, replacementProgram: 宣传片 |
| 7 | "删掉08:00那段空节目" | delete | targetTime: 08:00:00(nearest) |
| 8 | "把12:00和12:30的节目对调" | swap | targetIds: [12:00条目, 12:30条目] |
| 9 | "把第3条备注改成重播" | update_field | targetId: 第3条, fieldName: remark, newValue: 重播 |
| 10 | "黄金时段多加些新闻" | clarification | needsClarification: true, question: "加多少条？加在黄金时段哪里？" |

#### 4.4.9 完整命令转换服务

##### 4.4.9.1 服务接口

```ts
// src/services/intentCommandService.ts

/**
 * 意图识别与命令转换服务
 * 对外暴露的统一接口
 */
export class IntentCommandService {
  private recognizer: IntentRecognizer
  private dialogueManager: DialogueContextManager

  constructor(
    scheduleItems: ScheduleItem[],
    programLibrary: ProgramLibraryItem[],
    channelId: string,
    date: string
  ) {
    this.dialogueManager = new DialogueContextManager(
      `session_${Date.now()}`,
      channelId,
      date,
      scheduleItems.length
    )
    this.recognizer = new IntentRecognizer(
      scheduleItems,
      programLibrary,
      this.dialogueManager
    )
  }

  /**
   * 处理用户输入
   * @param userInput - 用户自然语言输入
   * @param options - 可选参数
   * @returns 识别结果或澄清请求
   */
  async process(
    userInput: string,
    options?: {
      clarificationAnswer?: any
    }
  ): Promise<ProcessResult> {
    try {
      const result = await this.recognizer.recognize(userInput, options)

      if (result.type === 'command_ready') {
        return {
          success: true,
          command: result.command,
          confidence: result.confidence,
          explanation: result.explanation,
          requiresConfirmation: result.confidence.score < 0.9,
          preview: this.buildPreview(result.command)
        }
      }

      if (result.type === 'clarification_required') {
        return {
          success: true,
          needsClarification: true,
          questions: result.questions,
          confidence: result.confidence
        }
      }

      return {
        success: false,
        error: (result as any).error || '未知错误'
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '处理失败'
      }
    }
  }

  /**
   * 构建变更预览
   */
  private buildPreview(command: ScheduleCommand): ChangePreview {
    switch (command.action) {
      case 'insert':
        return {
          type: 'insert',
          afterItemId: command.afterItemId,
          itemCount: command.items.length,
          summary: `在${command.afterItemId || '末尾'}插入${command.items.length}个节目`
        }
      case 'delete':
        return {
          type: 'delete',
          targetIds: command.targetIds,
          itemCount: command.targetIds.length,
          summary: `删除${command.targetIds.length}个节目`
        }
      case 'replace':
        return {
          type: 'replace',
          targetIds: command.replacements.map(r => r.targetId),
          itemCount: command.replacements.length,
          summary: `替换${command.replacements.length}个节目`
        }
      // ... 其他类型
      default:
        return { type: 'unknown', summary: '' }
    }
  }

  /**
   * 获取对话历史
   */
  getDialogueHistory(): DialogueTurn[] {
    return this.dialogueManager.context.turns
  }

  /**
   * 清除对话历史
   */
  clearHistory(): void {
    this.dialogueManager = new DialogueContextManager(
      `session_${Date.now()}`,
      this.dialogueManager.context.meta.channelId,
      this.dialogueManager.context.meta.date,
      this.dialogueManager.context.meta.itemCount
    )
  }
}

/**
 * 处理结果类型
 */
export interface ProcessResult {
  success: boolean
  command?: ScheduleCommand
  confidence?: ConfidenceEvaluation
  explanation?: string
  requiresConfirmation?: boolean
  preview?: ChangePreview
  needsClarification?: boolean
  questions?: ClarificationQuestion[]
  error?: string
}

/**
 * 变更预览
 */
export interface ChangePreview {
  type: 'insert' | 'delete' | 'replace' | 'swap' | 'move' | 'update_field' | 'batch' | 'unknown'
  afterItemId?: string | null
  targetIds?: string[]
  itemCount: number
  summary: string
}
````

#### 4.4.10 模糊时的澄清策略

##### 4.4.10.1 澄清问题类型

| 类型      | 触发条件     | 问题示例                                          |
| ------- | -------- | --------------------------------------------- |
| **选择类** | 存在多个歧义候选 | "检测到多个'新闻联播'，请选择：(A) 06:00新闻联播 (B) 20:00新闻联播" |
| **确认类** | 意图模糊     | "您是想替换这个节目还是批量修改这类节目？"                        |
| **补全类** | 参数缺失     | "请指定要插入的节目名称"                                 |
| **数量类** | 数量不明确    | "黄金时段多加些新闻" → "您想加几条新闻？"                      |

##### 4.4.10.2 澄清Prompt模板

```text
# 澄清请求

您的输入「{{userInput}}」存在以下不明确之处：

{{#each questions}}
{{loop.index}}. {{this}}
{{/each}}

请回复：
- 选择对应选项的字母（A/B/C...）
- 或直接补充信息

当前串联单上下文：
[最近的3条节目]

[节目库相关条目]
```

##### 4.4.10.3 澄清回复解析

```ts
// src/services/clarificationHandler.ts

/**
 * 澄清回复处理器
 */
export class ClarificationHandler {
  /**
   * 解析用户的澄清回复
   */
  parseClarificationResponse(
    response: string,
    question: ClarificationQuestion
  ): any {
    const normalizedResponse = response.trim().toUpperCase()

    // 处理选择类问题
    if (question.type === 'select' && question.options) {
      // 尝试匹配选项字母或值
      const letterMatch = normalizedResponse.match(/^([A-Z])/)
      if (letterMatch) {
        const index = letterMatch[1].charCodeAt(0) - 65
        if (index >= 0 && index < question.options.length) {
          return question.options[index].value
        }
      }

      // 直接匹配值
      for (const option of question.options) {
        if (normalizedResponse.includes(option.label.toUpperCase()) ||
            normalizedResponse.includes(option.value.toUpperCase())) {
          return option.value
        }
      }
    }

    // 处理补全类问题
    if (question.type === 'specify') {
      return response.trim()
    }

    // 处理确认类问题
    if (question.type === 'confirm') {
      const positivePatterns = ['是', '对的', '正确', 'yes', 'y', '确定']
      const negativePatterns = ['不', '否', '不是', 'no', 'n', '取消']
      for (const pattern of positivePatterns) {
        if (normalizedResponse.includes(pattern)) return true
      }
      for (const pattern of negativePatterns) {
        if (normalizedResponse.includes(pattern)) return false
      }
    }

    return response
  }
}
```

#### 4.4.11 完整对话流程示例

**示例：用户输入 "把新闻联播换成广告"**

```
用户: 把新闻联播换成广告
  │
  ├─► LLM意图分类
  │     intent: replace
  │     confidence: 0.6
  │     ambiguity: true
  │     reasoning: "新闻联播"在串联单中存在多个时间段
  │
  ├─► 实体链接
  │     ambiguities: [
  │       {
  │         original: "新闻联播",
  │         candidates: [
  │           { id: "ITEM003", startTime: "06:00", programName: "新闻联播" },
  │           { id: "ITEM156", startTime: "20:00", programName: "新闻联播" }
  │         ],
  │         suggestion: "检测到多个'新闻联播'，请选择具体时间"
  │       }
  │     ]
  │
  ├─► 置信度评估
  │     score: 0.5
  │     level: LOW
  │     needsClarification: true
  │
  └─► 返回澄清请求
        type: clarification_required
        questions: [
          {
            id: "amb_news",
            type: "select",
            question: "检测到多个'新闻联播'，请选择：",
            options: [
              { value: "ITEM003", label: "06:00 新闻联播" },
              { value: "ITEM156", label: "20:00 新闻联播" }
            ],
            required: true
          }
        ]

用户: B
  │
  ├─► 解析澄清回复
  │     selectedValue: "ITEM156"
  │
  ├─► 更新上下文，重新执行
  │     targetId: ITEM156
  │
  └─► 生成命令
        {
          "action": "replace",
          "replacements": [{
            "targetId": "ITEM156",
            "newItem": {
              "programName": "广告",
              "businessType": "ad",
              ...
            }
          }],
          "explanation": "将20:00新闻联播替换为广告"
        }
```

***

#### 4.4.2 上下文摘要策略

```ts
// src/services/contextBuilder.ts

/**
 * 为对话微调构建上下文摘要
 *
 * 策略（避免全量 200+ 条注入 Prompt）：
 * 1. 全量统计信息（总条目数、各类型数量、总时长）
 * 2. 与用户意图相关的时段条目（全量展开）
 * 3. 相关时段前后各 2 条上下文条目
 * 4. 节目库中与用户提及的节目名相关的条目
 *
 * 时间关键词提取规则：
 * - 正则匹配 HH:mm 或 HH:mm:ss 格式
 * - 关键词映射："早间/早上" → 06:00-09:00, "黄金时段" → 19:00-22:00,
 *   "午间/中午" → 11:30-13:00, "晚间" → 18:00-24:00
 *
 * 节目名关键词提取规则：
 * - 用户输入与 programLibrary 中每条的 name 做模糊匹配（包含即命中）
 * - 与串联单中节目名做模糊匹配
 */
export function buildContextSummary(
  allItems: ScheduleItem[],
  userInput: string,
  programLibrary: ProgramLibraryItem[]
): string {
  const lines: string[] = []

  // 1. 全量统计
  const totalItems = allItems.length
  const programCount = allItems.filter(i => i.businessType === 'program').length
  const adCount = allItems.filter(i => i.businessType === 'ad').length
  const promoCount = allItems.filter(i => i.businessType === 'promo').length
  const totalDuration = allItems.reduce((sum, i) => sum + i.duration, 0)

  lines.push(`【统计】共${totalItems}条，节目${programCount}条/广告${adCount}条/宣传片${promoCount}条，总时长${formatDuration(totalDuration)}`)

  // 2. 时间关键词提取
  const timeKeywords = extractTimeKeywords(userInput)
  const fuzzyRanges = timeKeywords
    .filter(t => t.type === 'fuzzy')
    .map(t => (t as any).range)

  // 3. 节目名关键词提取
  const programKeywords = extractProgramKeywords(userInput, programLibrary)

  // 4. 筛选相关条目
  let relevantItems: ScheduleItem[] = []
  if (fuzzyRanges.length > 0) {
    // 有模糊时间 → 提取该时段的条目
    for (const range of fuzzyRanges) {
      relevantItems = relevantItems.concat(
        allItems.filter(item => item.startTime >= range.start && item.startTime <= range.end)
      )
    }
  } else if (timeKeywords.length > 0) {
    // 有精确时间 → 提取该时间点附近 ±30分钟 的条目
    const targetTime = timeKeywords[0].time
    const targetSeconds = parseTimeToSeconds(targetTime)
    relevantItems = allItems.filter(item => {
      const itemSeconds = parseTimeToSeconds(item.startTime)
      return Math.abs(itemSeconds - targetSeconds) < 1800 // 30分钟
    })
  } else if (programKeywords.length > 0) {
    // 有节目名 → 提取匹配的条目
    for (const kw of programKeywords) {
      relevantItems = relevantItems.concat(
        allItems.filter(item =>
          item.programName.includes(kw) || kw.includes(item.programName)
        )
      )
    }
    // 去重
    relevantItems = [...new Map(relevantItems.map(i => [i.id, i])).values()]
  }

  // 5. 如果没有相关条目，取前10条和后10条作为上下文
  if (relevantItems.length === 0) {
    const sortedItems = [...allItems].sort((a, b) => a.sortOrder - b.sortOrder)
    relevantItems = sortedItems.slice(0, 10).concat(sortedItems.slice(-10))
  }

  // 6. 按时间排序并输出
  relevantItems.sort((a, b) => a.sortOrder - b.sortOrder)

  lines.push('\n【相关节目】')
  for (const item of relevantItems) {
    lines.push(`${item.id} | ${item.startTime}-${item.endTime} | ${item.programName} | ${item.businessType}`)
  }

  // 7. 节目库相关条目
  if (programKeywords.length > 0) {
    lines.push('\n【节目库匹配】')
    const matchedPrograms = programLibrary.filter(p =>
      programKeywords.some(kw => p.name.includes(kw) || kw.includes(p.name))
    ).slice(0, 10)

    for (const p of matchedPrograms) {
      lines.push(`${p.id} | ${p.name} | ${p.type} | ${p.duration}秒`)
    }
  }

  return lines.join('\n')
}

/**
 * 提取时间关键词
 */
function extractTimeKeywords(input: string): Array<{ type: string; time?: string; range?: any }> {
  const keywords: Array<{ type: string; time?: string; range?: any }> = []

  // 精确时间
  const absoluteMatches = input.match(/\d{1,2}:\d{2}(?::\d{2})?/g)
  if (absoluteMatches) {
    for (const match of absoluteMatches) {
      keywords.push({ type: 'absolute', time: normalizeTime(match) })
    }
  }

  // 模糊时间
  const fuzzyMap: Record<string, any> = {
    '早间': { start: '06:00:00', end: '09:00:00' },
    '早上': { start: '06:00:00', end: '09:00:00' },
    '上午': { start: '06:00:00', end: '12:00:00' },
    '午间': { start: '11:30:00', end: '13:30:00' },
    '中午': { start: '11:30:00', end: '13:30:00' },
    '下午': { start: '12:00:00', end: '18:00:00' },
    '晚间': { start: '18:00:00', end: '24:00:00' },
    '黄金时段': { start: '19:00:00', end: '22:00:00' },
    '深夜': { start: '22:00:00', end: '24:00:00' },
    '凌晨': { start: '00:00:00', end: '06:00:00' }
  }

  for (const [label, range] of Object.entries(fuzzyMap)) {
    if (input.includes(label)) {
      keywords.push({ type: 'fuzzy', range })
    }
  }

  return keywords
}

/**
 * 提取节目名关键词
 */
function extractProgramKeywords(input: string, programLibrary: ProgramLibraryItem[]): string[] {
  const keywords: string[] = []

  // 移除时间相关词汇
  const cleanedInput = input
    .replace(/\d{1,2}:\d{2}(?::\d{2})?/g, '')
    .replace(/(?:早间|早上|上午|午间|中午|下午|晚间|黄金时段|深夜|凌晨)/g, '')
    .trim()

  // 与节目库匹配
  for (const program of programLibrary) {
    if (cleanedInput.includes(program.name) || program.name.includes(cleanedInput)) {
      keywords.push(program.name)
    }
  }

  // 提取引号内的内容
  const quotedMatches = cleanedInput.match(/[""]([^""]+)[""]/g)
  if (quotedMatches) {
    for (const match of quotedMatches) {
      keywords.push(match.replace(/[""]/g, ''))
    }
  }

  return [...new Set(keywords)]
}

/**
 * 规范化时间格式
 */
function normalizeTime(time: string): string {
  const parts = time.split(':')
  const hh = parts[0].padStart(2, '0')
  const mm = parts[1].padStart(2, '0')
  const ss = parts[2]?.padStart(2, '0') || '00'
  return `${hh}:${mm}:${ss}`
}

/**
 * 解析时间为秒数
 */
function parseTimeToSeconds(time: string): number {
  const parts = time.split(':').map(Number)
  return parts[0] * 3600 + parts[1] * 60 + (parts[2] || 0)
}

/**
 * 格式化时长
 */
function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  return `${hours}小时${minutes}分钟`
}
```

### 4.5 命令执行器

```ts
// src/services/commandExecutor.ts

import type { ScheduleCommand, PlanCommand, FillBlockCommand } from '@/types/command'
import type { AtomicCapabilities } from '@/services/atomicCapabilities'
import type { ProgramLibraryItem } from '@/types/program'
import type { ValidationReport } from '@/types/validation'

export interface CommandExecutionResult {
  success: boolean
  validation: ValidationReport
  explanation: string
  affectedItemIds: string[]
  error?: string
}

/**
 * 执行 LLM 输出的标准化命令
 *
 * 命令类型与原子能力的映射：
 * - plan          → 不调用原子能力，仅存储计划到 store，供 Phase 2 循环使用
 * - fill_block    → RundownItem[] 转换 → appendItems()
 * - insert        → RundownItem[] 转换 → insertItems()
 * - delete        → deleteItems()
 * - replace       → RundownItem 转换 → replaceItems()
 * - swap          → swapItems()
 * - move          → moveItem()
 * - update_field  → updateItemFields()
 * - batch         → 按顺序依次执行子命令
 */
export async function executeCommand(
  command: ScheduleCommand,
  context: {
    capabilities: AtomicCapabilities
    programLibrary: ProgramLibraryItem[]
    date: string
  }
): Promise<CommandExecutionResult> { /* ... */ }
```

### 4.6 LLM 返回解析

````ts
// src/services/responseParser.ts

export interface ParseResult {
  success: boolean
  command: ScheduleCommand | null
  error?: string
  rawResponse: string
}

/**
 * 解析 LLM 的原始文本返回为 ScheduleCommand
 *
 * 解析流程：
 * 1. 兼容处理：去除 ```json 代码块包裹（LLM 可能添加，也可能不添加）
 * 2. JSON.parse 解析
 * 3. 校验 action 字段是否为合法枚举值
 * 4. 根据 action 类型校验必要字段是否存在
 * 5. 返回类型安全的 ScheduleCommand
 *
 * 注意：这里只做"格式校验"（JSON 是否合法、字段是否齐全），
 * 不做"业务校验"——那是 Layer 3 的职责。
 */
export function parseLLMResponse(rawText: string): ParseResult { /* ... */ }
````

### 4.7 节目库注入策略

```ts
// src/services/promptBuilder.ts

/**
 * 根据频道类型 + 时段块过滤节目库，减少 token 消耗
 *
 * 过滤规则：
 * 1. 所有 advertisement 和 promo 类型始终包含（通用素材）
 * 2. program 类型按频道关联性过滤（channelId 匹配或关键词匹配）
 * 3. 对于渐进式填充，额外按时段过滤（直播节目匹配标准播出时段）
 */
function filterProgramLibrary(
  library: ProgramLibraryItem[],
  channelId: string,
  timeRange?: { start: string; end: string }
): ProgramLibraryItem[] {
  // 第一层：频道过滤
  const channelFiltered = library.filter(item =>
    item.type !== 'program' || item.channelId === channelId
  )
  // 第二层：如果指定了时段，进一步精简（保留该时段常播的节目）
  if (!timeRange) return channelFiltered
  return channelFiltered // 时段过滤为可选优化
}
```

### 4.8 Token 预算（Kimi K2.5，单次调用）

| 调用场景         | 输入 Token                    | 输出 Token                        | 安全性 |
| ------------ | --------------------------- | ------------------------------- | --- |
| Phase 1 规划   | \~1500（Prompt + 版面参考摘要）     | \~2000（15-20 个 TimeBlock）       | 极安全 |
| Phase 2 单块填充 | \~2500（Prompt + 节目库 + 上下文）  | \~2000-5000（5-15 条 RundownItem） | 安全  |
| Phase 3 修补   | \~2000（Prompt + 错误信息 + 上下文） | \~1000-3000                     | 安全  |
| 对话微调         | \~2000（Prompt + 摘要 + 节目库）   | \~500-2000                      | 极安全 |

全量编排一天的串联单：1 次规划 + \~18 次填充 + \~2 次修补 ≈ **21 次 LLM 调用**。按 Kimi K2.5 定价，每次约 3000 输入 + 3000 输出 token，总计 \~126K tokens。

***

## 5 Layer 3：系统校验层 — 确定性校验

> **每次数据变更后自动触发**，对全量数据执行 6 条硬性校验规则。
>
> 设计原则：LLM 是"不可靠的创作者"，系统是"可靠的审核员"。200+ 条记录的逐条严格校验必须由确定性算法完成。

### 5.1 校验规则定义

```ts
// src/types/validation.ts

export enum ValidationRule {
  V1_NO_GAP = 'V1',           // 空窗检测
  V2_OVERLAP = 'V2',          // 时间重叠检测（注意：与 V1 互斥，不再检测空窗）
  V3_BOUNDARY_MATCH = 'V3',   // 首尾时间匹配
  V4_PRODUCT_LINKED = 'V4',   // 成品关联检测
  V5_MATERIAL_LINKED = 'V5',  // 成品素材关联
  V6_DURATION_MATCH = 'V6'    // 时长一致性
}

export interface ValidationError {
  rule: ValidationRule
  severity: 'error' | 'warning'
  itemId: string
  relatedItemId?: string      // V1/V2 涉及前后两条
  field: string
  message: string
  expected?: string
  actual?: string
}

export interface ValidationReport {
  valid: boolean              // error 数量为 0 时为 true（warning 不影响）
  totalItems: number
  errorCount: number
  warningCount: number
  errors: ValidationError[]
  errorsByItemId: Record<string, ValidationError[]>
  summaryByRule: Record<ValidationRule, { count: number; itemIds: string[] }>
}
```

### 5.2 六条校验规则详细规格

#### V1 — 空窗检测（仅检测间隙）

```ts
/**
 * 规则：串联单中不得存在未被任何条目覆盖的时间段。
 *
 * 校验逻辑：
 *   sorted = items.sortBy(startTime)
 *   for i in 0..sorted.length-2:
 *     gap = parseTime(sorted[i+1].startTime) - parseTime(sorted[i].endTime)
 *     if gap > 0:
 *       → error: 两条记录之间存在 {gap} 秒空窗
 *
 * 注意：V1 只检测 gap > 0（空窗），重叠由 V2 负责，两者互不重复。
 *
 * severity: error
 * field: 前一条的 endTime + 后一条的 startTime
 */
function checkV1_NoGap(items: ScheduleItem[]): ValidationError[]
```

#### V2 — 时间重叠检测（仅检测重叠）

```ts
/**
 * 规则：相邻两条记录不得存在时间重叠。
 *
 * 校验逻辑：
 *   sorted = items.sortBy(startTime)
 *   for i in 0..sorted.length-2:
 *     overlap = parseTime(sorted[i].endTime) - parseTime(sorted[i+1].startTime)
 *     if overlap > 0:
 *       → error: 两条记录存在 {overlap} 秒时间重叠
 *
 * 注意：V2 只检测 overlap > 0（重叠），空窗由 V1 负责，两者互不重复。
 *
 * severity: error
 * field: 前一条的 endTime + 后一条的 startTime
 */
function checkV2_Overlap(items: ScheduleItem[]): ValidationError[]
```

#### V3 — 首尾时间匹配

```ts
/**
 * 规则：第一条 startTime = 频道开播时间，最后一条 endTime = 频道收播时间。
 *
 * 校验逻辑（时间格式已统一为 HH:mm:ss）：
 *   firstItem.startTime === channelConfig.startTime  // 字符串直接比较
 *   lastItem.endTime === channelConfig.endTime
 *
 * 注意：channelConfig 和 ScheduleItem 的时间格式都是 HH:mm:ss，无需转换。
 *
 * severity: error
 */
function checkV3_BoundaryMatch(
  items: ScheduleItem[],
  channelConfig: { startTime: string; endTime: string }
): ValidationError[]
```

#### V4 — 成品关联检测

```ts
/**
 * 规则：每条 businessType='program' 的记录必须关联有效成品。
 *
 * 校验逻辑：
 *   对每条 businessType === 'program' 的条目：
 *     1. code18 不为空/undefined
 *     2. programLibrary.find(p => p.code === item.code18) 存在
 *   对 'ad' / 'promo' 类型：同样检查但 severity 降为 warning
 *
 * severity: program → error, ad/promo → warning
 * 联动：校验失败时设置 item.isUnlinkedProduct = true
 */
function checkV4_ProductLinked(
  items: ScheduleItem[],
  programLibrary: ProgramLibraryItem[]
): ValidationError[]
```

#### V5 — 成品素材关联检测

```ts
/**
 * 规则：已关联成品的条目，其成品必须已关联素材。
 *
 * 校验逻辑：
 *   对每条有有效 code18 的条目：
 *     program = programLibrary.find(p => p.code === item.code18)
 *     if program && program.hasLinkedMaterial === false → warning
 *
 * 前置条件：仅对 V4 通过的条目执行（code18 有效且在库中存在）
 * severity: warning
 * 联动：校验失败时设置 item.isMaterialInfoEmpty = true
 */
function checkV5_MaterialLinked(
  items: ScheduleItem[],
  programLibrary: ProgramLibraryItem[]
): ValidationError[]
```

#### V6 — 时长一致性

```ts
/**
 * 规则：每条记录的 endTime - startTime 必须等于 duration。
 *
 * 校验逻辑（单位统一为秒）：
 *   calculatedDuration = parseTime(endTime) - parseTime(startTime)
 *   if abs(calculatedDuration - item.duration) > 1:  // 允许 1 秒舍入误差
 *     → error
 *
 * 注意：duration 单位为秒（ScheduleItem.duration: number 秒），无需转换。
 *
 * severity: error
 * expected: calculatedDuration 秒
 * actual: item.duration 秒
 */
function checkV6_DurationMatch(items: ScheduleItem[]): ValidationError[]
```

### 5.3 校验引擎

```ts
// src/services/validationEngine.ts

export function validateSchedule(
  items: ScheduleItem[],
  channelConfig: { startTime: string; endTime: string },
  programLibrary: ProgramLibraryItem[]
): ValidationReport {
  const errors: ValidationError[] = []
  const sorted = [...items].sort((a, b) => a.sortOrder - b.sortOrder)

  errors.push(...checkV1_NoGap(sorted))
  errors.push(...checkV2_Overlap(sorted))
  errors.push(...checkV3_BoundaryMatch(sorted, channelConfig))
  errors.push(...checkV4_ProductLinked(sorted, programLibrary))
  errors.push(...checkV5_MaterialLinked(sorted, programLibrary))
  errors.push(...checkV6_DurationMatch(sorted))

  // 构建按条目 ID 的快查索引
  const errorsByItemId: Record<string, ValidationError[]> = {}
  for (const err of errors) {
    if (!errorsByItemId[err.itemId]) errorsByItemId[err.itemId] = []
    errorsByItemId[err.itemId].push(err)
  }

  // 构建按规则分组的统计
  const summaryByRule = {} as ValidationReport['summaryByRule']
  for (const rule of Object.values(ValidationRule)) {
    const ruleErrors = errors.filter(e => e.rule === rule)
    summaryByRule[rule] = {
      count: ruleErrors.length,
      itemIds: [...new Set(ruleErrors.map(e => e.itemId))]
    }
  }

  return {
    valid: errors.filter(e => e.severity === 'error').length === 0,
    totalItems: items.length,
    errorCount: errors.filter(e => e.severity === 'error').length,
    warningCount: errors.filter(e => e.severity === 'warning').length,
    errors,
    errorsByItemId,
    summaryByRule
  }
}
```

### 5.4 校验结果与表格联动

```ts
/**
 * 根据校验报告为每一行生成所有适用的 CSS class（多错误叠加，非互斥）
 */
function getRowValidationClasses(itemId: string, report: ValidationReport): string[] {
  const errors = report.errorsByItemId[itemId] || []
  const classes: string[] = []

  if (errors.some(e => e.rule === ValidationRule.V1_NO_GAP))
    classes.push('row-error-gap')          // 红色虚线下边框
  if (errors.some(e => e.rule === ValidationRule.V2_OVERLAP))
    classes.push('row-error-overlap')      // 红色底色
  if (errors.some(e => e.rule === ValidationRule.V3_BOUNDARY_MATCH))
    classes.push('row-error-boundary')     // 红色边框
  if (errors.some(e => e.rule === ValidationRule.V6_DURATION_MATCH))
    classes.push('row-error-duration')     // 时长列红色文字
  if (errors.some(e => e.rule === ValidationRule.V4_PRODUCT_LINKED))
    classes.push('row-error-product')      // 编码列橙色边框
  if (errors.some(e => e.rule === ValidationRule.V5_MATERIAL_LINKED))
    classes.push('row-warning-material')   // 素材列黄色底色

  return classes
}
```

**异常高亮规则**：

| 校验规则  | 表格样式        | 颜色       | tooltip 内容                        |
| ----- | ----------- | -------- | --------------------------------- |
| V1 空窗 | 两行之间插入虚线分隔行 | 红色虚线     | "此处存在 N 秒空窗"                      |
| V2 重叠 | 涉及的两行底色高亮   | 红色底色     | "与下一条重叠 N 秒"                      |
| V3 首尾 | 第一行/最后一行边框  | 红色边框     | "期望 {expected}，实际 {actual}"       |
| V4 成品 | "节目编码"列标记   | 橙色边框+感叹号 | "未关联成品"                           |
| V5 素材 | "素材状态"列标记   | 黄色底色     | "成品未关联素材"                         |
| V6 时长 | "时长"列标记     | 红色文字+删除线 | "声明 {declared}s，计算 {calculated}s" |

---

## §6 附录与参考资料

以下非核心内容已拆分到附录文档：

| 附录文档 | 内容 |
|----------|------|
| [LLM自动编排串联单-需求文档-附录.md](LLM自动编排串联单-需求文档-附录.md) | §6 种子数据规则、§8 页面布局、§9 前端文件结构、§10 工具函数、§11 LLM配置、§12 演示脚本、§13 非功能性需求、§14 数据引用、§15 验收标准 |

---

## §7 策略规划引擎（新增）

> 本节为 P0 优先级补充模块，用于支持多策略选择和优化编排决策。

### 7.1 策略规划引擎概述

当前 Phase 1 仅做时间块划分，缺乏策略层面的规划。策略规划引擎（StrategyPlanner）将赋予 Agent：

1. **多策略评估**：法规遵从 > 广告合同 > 收视率优化 > 节目多样性
2. **约束满足**：硬约束（法规）必须满足，软约束（优化目标）尽量满足
3. **多目标优化**：在多个目标间进行权衡和优化

### 7.2 策略类型定义

```ts
// src/types/strategy.ts

/**
 * 策略优先级枚举
 * 数值越高优先级越高
 */
export enum StrategyPriority {
  REGULATION = 100,      // 法规遵从（硬约束）
  AD_CONTRACT = 80,     // 广告合同（硬约束）
  BROADCAST_RULE = 60,  // 播出规则（硬约束）
  RATING_OPTIMIZE = 40, // 收视率优化（软约束）
  PROGRAM_DIVERSITY = 30 // 节目多样性（软约束）
}

/**
 * 策略评估结果
 */
export interface StrategyScore {
  strategy: StrategyType
  score: number           // 0-100
  passed: boolean        // 是否满足硬约束
  details: string         // 评分理由
}

/**
 * 策略类型
 */
export type StrategyType =
  | 'regulation'           // 法规遵从
  | 'ad_contract'         // 广告合同
  | 'broadcast_rule'       // 播出规则
  | 'rating_optimize'      // 收视率优化
  | 'program_diversity'     // 节目多样性
  | 'channel_consistency'  // 频道一致性
```

### 7.3 策略评估规则

```ts
// src/services/strategyRules.ts

export const STRATEGY_RULES = {
  /**
   * 法规遵从策略
   * 优先级: 100（硬约束）
   */
  regulation: {
    name: '法规遵从',
    priority: StrategyPriority.REGULATION,
    isHardConstraint: true,
    rules: [
      {
        id: 'REG-001',
        description: '未成年人频道（哈哈炫动）22:00前不得播放成人内容',
        check: (item: ScheduleItem, context: PlanningContext) => {
          if (context.channelId === 'cartoon' && isAdultContent(item)) {
            return item.startTime < '22:00:00' ? 0 : 100
          }
          return 100
        }
      },
      {
        id: 'REG-002',
        description: '新闻类节目不得插入商业广告',
        check: (item: ScheduleItem) => {
          if (isNewsProgram(item) && item.businessType === 'ad') {
            return 0
          }
          return 100
        }
      },
      {
        id: 'REG-003',
        description: '同一节目连续播放不超过3集需间隔24小时',
        check: (item: ScheduleItem, context: PlanningContext) => {
          const sameProgramBefore = context.scheduleItems.filter(
            i => i.programCode === item.programCode
          )
          if (sameProgramBefore.length >= 3) {
            const lastItem = sameProgramBefore[sameProgramBefore.length - 1]
            const hoursSinceLast = timeDiff(lastItem.endTime, item.startTime) / 3600
            return hoursSinceLast >= 24 ? 100 : 0
          }
          return 100
        }
      }
    ]
  },

  /**
   * 广告合同策略
   * 优先级: 80（硬约束）
   */
  ad_contract: {
    name: '广告合同',
    priority: StrategyPriority.AD_CONTRACT,
    isHardConstraint: true,
    rules: [
      {
        id: 'AD-001',
        description: '黄金时段广告时长占比不超过20%',
        check: (item: ScheduleItem, context: PlanningContext) => {
          if (!isGoldenSlot(item.startTime)) return 100
          const goldenSlotAds = context.scheduleItems.filter(
            i => isGoldenSlot(i.startTime) && i.businessType === 'ad'
          )
          const totalDuration = context.scheduleItems
            .filter(i => isGoldenSlot(i.startTime))
            .reduce((sum, i) => sum + i.duration, 0)
          const adRatio = goldenSlotAds.reduce((sum, i) => sum + i.duration, 0) / totalDuration
          return adRatio <= 0.2 ? 100 : 0
        }
      },
      {
        id: 'AD-002',
        description: '特定广告位必须保留给签约广告商',
        check: (item: ScheduleItem, context: PlanningContext) => {
          const reservedSlots = context.adContractReservedSlots || []
          const matched = reservedSlots.find(
            slot => slot.startTime === item.startTime && slot.businessType === item.businessType
          )
          return matched ? 100 : 50  // 保留给特定广告商得满分，否则50分
        }
      }
    ]
  },

  /**
   * 播出规则策略
   * 优先级: 60（硬约束）
   */
  broadcast_rule: {
    name: '播出规则',
    priority: StrategyPriority.BROADCAST_RULE,
    isHardConstraint: true,
    rules: [
      {
        id: 'BR-001',
        description: '直播节目必须分配可用演播室',
        check: (item: ScheduleItem, context: PlanningContext) => {
          if (item.sourceType !== 'live') return 100
          const studioAvailable = context.availableStudios.includes(item.studio || '')
          return studioAvailable ? 100 : 0
        }
      },
      {
        id: 'BR-002',
        description: '录播节目素材必须就绪才能播出',
        check: (item: ScheduleItem) => {
          if (item.sourceType !== 'record') return 100
          return item.materialStatus === 'ready' ? 100 : 50
        }
      }
    ]
  },

  /**
   * 收视率优化策略
   * 优先级: 40（软约束）
   */
  rating_optimize: {
    name: '收视率优化',
    priority: StrategyPriority.RATING_OPTIMIZE,
    isHardConstraint: false,
    scoringMethod: 'historical_rating_based',
    rules: [
      {
        id: 'RT-001',
        description: '黄金时段优先安排高收视率预期的节目类型',
        check: (item: ScheduleItem, context: PlanningContext) => {
          if (!isGoldenSlot(item.startTime)) return 50  // 非黄金时段不给分
          const historicalRating = getHistoricalRating(item.programType, context.channelId)
          return historicalRating * 100  // 0-100分
        }
      },
      {
        id: 'RT-002',
        description: '首播节目优先于重播节目',
        check: (item: ScheduleItem) => {
          return item.isFirstBroadcast ? 100 : 60
        }
      }
    ]
  },

  /**
   * 节目多样性策略
   * 优先级: 30（软约束）
   */
  program_diversity: {
    name: '节目多样性',
    priority: StrategyPriority.PROGRAM_DIVERSITY,
    isHardConstraint: false,
    scoringMethod: 'entropy_based',
    rules: [
      {
        id: 'PD-001',
        description: '同一类型节目连续播放不超过3个',
        check: (item: ScheduleItem, context: PlanningContext) => {
          const beforeItems = getPreviousItems(context.scheduleItems, item, 3)
          const sameTypeCount = beforeItems.filter(i => i.programType === item.programType).length
          return sameTypeCount >= 3 ? 30 : 70
        }
      },
      {
        id: 'PD-002',
        description: '每小时节目类型变化次数',
        check: (item: ScheduleItem, context: PlanningContext) => {
          const hourItems = getItemsInHour(context.scheduleItems, item.startTime)
          const typeChanges = countTypeChanges(hourItems)
          return typeChanges >= 2 ? 100 : typeChanges * 40
        }
      }
    ]
  }
}
```

### 7.4 StrategyPlanner 服务设计

```ts
// src/services/strategyPlanner.ts

import { STRATEGY_RULES } from './strategyRules'
import type { ScheduleItem, PlanningContext } from '@/types/schedule'
import type { StrategyScore, StrategyType } from '@/types/strategy'

class StrategyPlanner {
  /**
   * 评估单个条目的策略得分
   */
  async evaluateItem(
    item: ScheduleItem,
    context: PlanningContext
  ): Promise<StrategyScore[]> {
    const scores: StrategyScore[] = []

    for (const [strategyType, strategy] of Object.entries(STRATEGY_RULES)) {
      let totalScore = 0
      let ruleCount = 0

      for (const rule of strategy.rules) {
        const ruleScore = rule.check(item, context)
        totalScore += ruleScore
        ruleCount++
      }

      const avgScore = totalScore / ruleCount
      const passed = strategy.isHardConstraint ? avgScore >= 60 : true

      scores.push({
        strategy: strategyType as StrategyType,
        score: avgScore,
        passed,
        details: `${strategy.name}: ${avgScore.toFixed(1)}分`
      })
    }

    return scores
  }

  /**
   * 评估整个编排计划的策略得分
   */
  async evaluatePlan(
    items: ScheduleItem[],
    context: PlanningContext
  ): Promise<{
    overallScore: number
    strategyScores: StrategyScore[]
    hardConstraintPassed: boolean
    failedHardConstraints: string[]
  }> {
    const allScores: StrategyScore[] = []
    const hardConstraintFails: string[] = []

    for (const item of items) {
      const itemScores = await this.evaluateItem(item, context)
      allScores.push(...itemScores)
    }

    // 按策略类型聚合
    const strategyAggregated = this.aggregateByStrategy(allScores)

    // 计算加权总分
    let overallScore = 0
    let totalWeight = 0
    for (const [strategy, score] of Object.entries(strategyAggregated)) {
      const strategyInfo = STRATEGY_RULES[strategy as StrategyType]
      const weight = strategyInfo.priority
      overallScore += score * weight
      totalWeight += weight

      if (strategyInfo.isHardConstraint && score < 60) {
        hardConstraintFails.push(strategyInfo.name)
      }
    }
    overallScore = overallScore / totalWeight

    return {
      overallScore,
      strategyScores: allScores,
      hardConstraintPassed: hardConstraintFails.length === 0,
      failedHardConstraints: hardConstraintFails
    }
  }

  /**
   * 生成策略优化建议
   */
  async generateOptimizationSuggestions(
    items: ScheduleItem[],
    context: PlanningContext
  ): Promise<OptimizationSuggestion[]> {
    const { overallScore, failedHardConstraints } = await this.evaluatePlan(items, context)
    const suggestions: OptimizationSuggestion[] = []

    // 针对失败的硬约束生成建议
    for (const failed of failedHardConstraints) {
      suggestions.push({
        priority: 'high',
        strategy: failed,
        suggestion: `建议调整${failed}相关的节目安排`
      })
    }

    // 针对低分软约束生成建议
    const strategyAvgScores = this.getAverageScoresByStrategy(items)
    for (const [strategy, score] of Object.entries(strategyAvgScores)) {
      if (score < 60) {
        suggestions.push({
          priority: 'medium',
          strategy: strategy,
          suggestion: `建议优化${strategy}策略评分`
        })
      }
    }

    return suggestions.sort((a, b) => (a.priority === 'high' ? -1 : 1))
  }

  private aggregateByStrategy(scores: StrategyScore[]): Record<string, number> {
    const aggregated: Record<string, number[]> = {}
    for (const score of scores) {
      if (!aggregated[score.strategy]) {
        aggregated[score.strategy] = []
      }
      aggregated[score.strategy].push(score.score)
    }

    const result: Record<string, number> = {}
    for (const [strategy, scoreList] of Object.entries(aggregated)) {
      result[strategy] = scoreList.reduce((a, b) => a + b, 0) / scoreList.length
    }
    return result
  }
}

export interface OptimizationSuggestion {
  priority: 'high' | 'medium' | 'low'
  strategy: string
  suggestion: string
}
```

---

## §8 领域知识库（新增）

> 本节为 P0 优先级补充模块，用于存储广电行业专业知识、法规和版权规则。

### 8.1 领域知识库概述

领域知识库（DomainKnowledge）存储 Agent 需要的专业领域知识：

1. **法规规则**：广电法规、未成年人保护等
2. **版权规则**：同一节目播放限制、版权保护期等
3. **行业规范**：节目分类标准、播出标准等

### 8.2 知识库类型定义

```ts
// src/types/domainKnowledge.ts

/**
 * 知识库条目类型
 */
export enum KnowledgeType {
  REGULATION = 'regulation',     // 法规
  COPYRIGHT = 'copyright',        // 版权
  INDUSTRY_STANDARD = 'industry_standard', // 行业标准
  CHANNEL_RULE = 'channel_rule'  // 频道规则
}

/**
 * 严重级别
 */
export enum Severity {
  ERROR = 'error',    // 错误（硬约束）
  WARNING = 'warning', // 警告（软约束）
  INFO = 'info'       // 信息
}

/**
 * 领域知识条目
 */
export interface DomainRule {
  id: string
  type: KnowledgeType
  category: string           // 子类别
  description: string         // 规则描述
  check: (item: ScheduleItem, context: PlanningContext) => RuleCheckResult
  severity: Severity
  relatedItems?: string[]     // 相关节目列表
}

/**
 * 规则检查结果
 */
export interface RuleCheckResult {
  passed: boolean
  score: number              // 0-100
  message: string
  suggestedFix?: string       // 建议修复方式
}
```

### 8.3 知识库规则定义

```ts
// src/services/domainKnowledge.ts

import type { DomainRule, RuleCheckResult, KnowledgeType, Severity } from '@/types/domainKnowledge'
import type { ScheduleItem, PlanningContext } from '@/types/schedule'

class DomainKnowledge {
  private rules: DomainRule[] = []

  constructor() {
    this.initializeRules()
  }

  private initializeRules() {
    this.rules = [
      // ═══════════════════════════════════════════
      // 法规规则
      // ═══════════════════════════════════════════
      {
        id: 'DK-REG-001',
        type: KnowledgeType.REGULATION,
        category: '未成年人保护',
        description: '哈哈炫动频道22:00前不得播放成人内容',
        severity: Severity.ERROR,
        check: (item: ScheduleItem, ctx: PlanningContext): RuleCheckResult => {
          if (ctx.channelId !== 'cartoon') {
            return { passed: true, score: 100, message: '非儿童频道，不受此规则限制' }
          }
          if (isAdultContent(item) && item.startTime < '22:00:00') {
            return {
              passed: false,
              score: 0,
              message: '成人内容不得在22:00前播放',
              suggestedFix: '延后至22:00后播放或替换为儿童适宜内容'
            }
          }
          return { passed: true, score: 100, message: '符合未成年人保护规定' }
        }
      },
      {
        id: 'DK-REG-002',
        type: KnowledgeType.REGULATION,
        category: '内容分级',
        description: '新闻节目不得插入商业广告',
        severity: Severity.ERROR,
        check: (item: ScheduleItem): RuleCheckResult => {
          if (isNewsProgram(item) && item.businessType === 'ad') {
            return {
              passed: false,
              score: 0,
              message: '新闻节目禁止插入商业广告',
              suggestedFix: '将广告移至其他非新闻节目时段'
            }
          }
          return { passed: true, score: 100, message: '符合内容分级规定' }
        }
      },
      {
        id: 'DK-REG-003',
        type: KnowledgeType.REGULATION,
        category: '广告时长',
        description: '每小时广告时长不超过12分钟（20%）',
        severity: Severity.WARNING,
        check: (item: ScheduleItem, ctx: PlanningContext): RuleCheckResult => {
          const hourItems = getItemsInHour(ctx.scheduleItems, item.startTime)
          const adDuration = hourItems
            .filter(i => i.businessType === 'ad')
            .reduce((sum, i) => sum + i.duration, 0)
          const adRatio = adDuration / 3600

          if (adRatio > 0.2) {
            return {
              passed: false,
              score: Math.max(0, 100 - (adRatio - 0.2) * 500),
              message: `广告占比${(adRatio * 100).toFixed(1)}%，超过20%限制`,
              suggestedFix: '减少广告或增加节目内容'
            }
          }
          return { passed: true, score: 100, message: '符合广告时长规定' }
        }
      },

      // ═══════════════════════════════════════════
      // 版权规则
      // ═══════════════════════════════════════════
      {
        id: 'DK-COP-001',
        type: KnowledgeType.COPYRIGHT,
        category: '连续播放限制',
        description: '同一节目连续播放不超过3集需间隔24小时',
        severity: Severity.ERROR,
        check: (item: ScheduleItem, ctx: PlanningContext): RuleCheckResult => {
          const sameProgramBefore = ctx.scheduleItems
            .filter(i => i.programCode === item.programCode)
            .sort((a, b) => timeToSeconds(b.endTime) - timeToSeconds(a.endTime))

          const recentItems = sameProgramBefore.slice(0, 3)
          for (const prev of recentItems) {
            const hoursGap = timeDiff(prev.endTime, item.startTime) / 3600
            if (hoursGap < 24) {
              return {
                passed: false,
                score: 0,
                message: `距上次播放仅${hoursGap.toFixed(1)}小时，需间隔24小时`,
                suggestedFix: '延后至24小时后播放'
              }
            }
          }
          return { passed: true, score: 100, message: '符合版权播放间隔规定' }
        }
      },
      {
        id: 'DK-COP-002',
        type: KnowledgeType.COPYRIGHT,
        category: '版权保护期',
        description: '未获得版权的内容不得播出',
        severity: Severity.ERROR,
        check: (item: ScheduleItem): RuleCheckResult => {
          if (item.copyrightExpired) {
            return {
              passed: false,
              score: 0,
              message: '版权已过期，不得播出',
              suggestedFix: '获取新版版权或替换其他内容'
            }
          }
          return { passed: true, score: 100, message: '版权有效' }
        }
      },

      // ═══════════════════════════════════════════
      // 行业标准
      // ═══════════════════════════════════════════
      {
        id: 'DK-IND-001',
        type: KnowledgeType.INDUSTRY_STANDARD,
        category: '节目分类',
        description: '节目类型必须符合频道定位',
        severity: Severity.WARNING,
        check: (item: ScheduleItem, ctx: PlanningContext): RuleCheckResult => {
          const channelAllowedTypes = CHANNEL_PROGRAM_TYPES[ctx.channelId] || []
          if (!channelAllowedTypes.includes(item.programType)) {
            return {
              passed: false,
              score: 50,
              message: `${item.programType}与频道定位不完全匹配`,
              suggestedFix: '考虑替换为频道主类型节目'
            }
          }
          return { passed: true, score: 100, message: '符合频道定位' }
        }
      },
      {
        id: 'DK-IND-002',
        type: KnowledgeType.INDUSTRY_STANDARD,
        category: '首播重播',
        description: '黄金时段优先安排首播内容',
        severity: Severity.INFO,
        check: (item: ScheduleItem): RuleCheckResult => {
          if (isGoldenSlot(item.startTime) && !item.isFirstBroadcast) {
            return {
              passed: true,
              score: 70,
              message: '黄金时段重播，收视效果可能下降'
            }
          }
          return { passed: true, score: 100, message: '符合首播重播规则' }
        }
      },

      // ═══════════════════════════════════════════
      // 频道规则
      // ═══════════════════════════════════════════
      {
        id: 'DK-CHN-001',
        type: KnowledgeType.CHANNEL_RULE,
        category: '新闻频道',
        description: '新闻综合频道应以新闻类节目为主',
        severity: Severity.WARNING,
        check: (item: ScheduleItem, ctx: PlanningContext): RuleCheckResult => {
          if (ctx.channelId !== 'news') {
            return { passed: true, score: 100, message: '非新闻频道' }
          }
          const newsCount = ctx.scheduleItems.filter(i => isNewsProgram(i)).length
          const newsRatio = newsCount / ctx.scheduleItems.length
          if (newsRatio < 0.5) {
            return {
              passed: false,
              score: 50,
              message: `新闻节目占比${(newsRatio * 100).toFixed(1)}%，低于50%`
            }
          }
          return { passed: true, score: 100, message: '符合新闻频道定位' }
        }
      }
    ]
  }

  /**
   * 检查单个条目是否符合所有知识库规则
   */
  checkItem(item: ScheduleItem, context: PlanningContext): DomainCheckResult {
    const results: RuleCheckResult[] = []
    let hasError = false
    let hasWarning = false

    for (const rule of this.rules) {
      const result = rule.check(item, context)
      results.push(result)
      if (!result.passed) {
        if (rule.severity === Severity.ERROR) hasError = true
        if (rule.severity === Severity.WARNING) hasWarning = true
      }
    }

    return {
      itemId: item.id,
      results,
      hasError,
      hasWarning,
      overallScore: results.reduce((sum, r) => sum + r.score, 0) / results.length
    }
  }

  /**
   * 检查整个串联单
   */
  checkSchedule(items: ScheduleItem[], context: PlanningContext): DomainCheckReport {
    const itemResults = items.map(item => this.checkItem(item, context))
    const errorItems = itemResults.filter(r => r.hasError)
    const warningItems = itemResults.filter(r => r.hasWarning && !r.hasError)

    return {
      totalItems: items.length,
      errorCount: errorItems.length,
      warningCount: warningItems.length,
      itemResults,
      recommendations: this.generateRecommendations(itemResults)
    }
  }

  private generateRecommendations(results: DomainCheckResult[]): string[] {
    const recommendations: string[] = []
    for (const result of results) {
      if (!result.hasError && !result.hasWarning) continue
      for (const ruleResult of result.results) {
        if (!ruleResult.passed && ruleResult.suggestedFix) {
          recommendations.push(`${result.itemId}: ${ruleResult.suggestedFix}`)
        }
      }
    }
    return recommendations
  }
}

interface DomainCheckResult {
  itemId: string
  results: RuleCheckResult[]
  hasError: boolean
  hasWarning: boolean
  overallScore: number
}

interface DomainCheckReport {
  totalItems: number
  errorCount: number
  warningCount: number
  itemResults: DomainCheckResult[]
  recommendations: string[]
}

// 辅助函数
const CHANNEL_PROGRAM_TYPES: Record<string, string[]> = {
  news: ['新闻', '资讯', '深度', '法制', '军事', '健康', '人文'],
  dragon: ['新闻', '综艺', '电视剧', '财经', '娱乐'],
  finance: ['财经', '资讯', '人文'],
  sports: ['体育', '赛事'],
  doc: ['人文', '纪录片', '健康', '历史'],
  cartoon: ['动漫', '儿童', '亲子']
}

function isAdultContent(item: ScheduleItem): boolean {
  return item.tags?.includes('adult') || item.tags?.includes('成人')
}

function isNewsProgram(item: ScheduleItem): boolean {
  return item.programType?.includes('新闻') || item.programType?.includes('资讯')
}

function isGoldenSlot(time: string): boolean {
  const hour = parseInt(time.split(':')[0])
  return hour >= 19 && hour <= 22
}

function timeDiff(start: string, end: string): number {
  const toSeconds = (t: string) => {
    const parts = t.split(':').map(Number)
    return parts[0] * 3600 + parts[1] * 60 + parts[2]
  }
  return toSeconds(end) - toSeconds(start)
}
```

### 8.4 与现有系统的集成

```ts
// src/services/domainKnowledgeIntegration.ts

import { DomainKnowledge } from './domainKnowledge'
import { StrategyPlanner } from './strategyPlanner'

/**
 * 知识库与策略规划引擎集成
 */
class IntelligentOrchestrator {
  private domainKnowledge: DomainKnowledge
  private strategyPlanner: StrategyPlanner

  constructor() {
    this.domainKnowledge = new DomainKnowledge()
    this.strategyPlanner = new StrategyPlanner()
  }

  /**
   * 编排前检查
   */
  async preCheck(
    items: ScheduleItem[],
    context: PlanningContext
  ): Promise<{
    canProceed: boolean
    domainReport: DomainCheckReport
    strategyReport: StrategyReport
    blockers: string[]
  }> {
    // 1. 知识库检查
    const domainReport = this.domainKnowledge.checkSchedule(items, context)

    // 2. 策略规划检查
    const strategyReport = await this.strategyPlanner.evaluatePlan(items, context)

    // 3. 汇总阻塞项
    const blockers: string[] = []
    if (!strategyReport.hardConstraintPassed) {
      blockers.push(...strategyReport.failedHardConstraints)
    }
    if (domainReport.errorCount > 0) {
      blockers.push(`${domainReport.errorCount}个法规/版权错误`)
    }

    return {
      canProceed: blockers.length === 0,
      domainReport,
      strategyReport,
      blockers
    }
  }

  /**
   * 生成优化建议
   */
  async generateOptimizations(
    items: ScheduleItem[],
    context: PlanningContext
  ): Promise<OptimizationPlan> {
    const strategySuggestions = await this.strategyPlanner.generateOptimizationSuggestions(items, context)
    const domainReport = this.domainKnowledge.checkSchedule(items, context)

    return {
      blockers: domainReport.recommendations,
      suggestions: strategySuggestions,
      overallScore: domainReport.overallScore
    }
  }
}

export { DomainKnowledge, StrategyPlanner }
```

---

## 附录引用

以下非核心内容已拆分到附录文档：

| 附录文档 | 内容 |
|----------|------|
| [LLM自动编排串联单-需求文档-附录.md](LLM自动编排串联单-需求文档-附录.md) | 种子数据规则、页面布局、前端文件结构、工具函数、LLM配置、演示脚本、非功能性需求、数据引用、验收标准 |

---

*文档版本：v1.1*
*编写日期：2026-03-23*
*状态：核心内容已完成，策略规划引擎和领域知识库已补充，附录已拆分*

| 维度   | 数量                                                     |
| ---- | ------------------------------------------------------ |
| 总条目数 | 2000 条 ProgramLibraryItem                              |
| 时间跨度 | 2025-03-01 \~ 2026-03-23（过去一年）                         |
| 覆盖频道 | 6 个频道                                                  |
| 节目类型 | program \~1400 条, advertisement \~350 条, promo \~250 条 |

### 6.2 各频道节目清单（来源：上海广播电视台真实栏目）

#### 新闻综合频道（news）— 约 380 条 program

| 栏目名称  | 类型 | 播出类型 | 单集时长          | 频次 | 生成条目数      |
| ----- | -- | ---- | ------------- | -- | ---------- |
| 上海早晨  | 新闻 | 直播   | 7200s (2h)    | 每日 | 365 期→取 80 |
| 新闻坊   | 新闻 | 直播   | 3600s (1h)    | 每日 | 365→取 60   |
| 新闻报道  | 新闻 | 直播   | 2700s (45min) | 每日 | 365→取 50   |
| 新闻夜线  | 新闻 | 直播   | 3600s (1h)    | 每日 | 365→取 40   |
| 午间新闻  | 新闻 | 直播   | 1800s (30min) | 每日 | 365→取 30   |
| 案件聚焦  | 法制 | 录播   | 1800s (30min) | 每日 | 365→取 30   |
| 庭审纪实  | 法制 | 录播   | 1800s (30min) | 每日 | 取 20       |
| 媒体大搜索 | 资讯 | 录播   | 1800s (30min) | 每日 | 取 15       |
| 新闻透视  | 深度 | 录播   | 900s (15min)  | 每日 | 取 15       |
| 七分之一  | 深度 | 录播   | 2700s (45min) | 每周 | 52→取 15    |
| 防务新时空 | 军事 | 录播   | 3300s (55min) | 每日 | 取 10       |
| 名医话养生 | 健康 | 录播   | 3300s (55min) | 每日 | 取 10       |
| 上海故事  | 人文 | 录播   | 1680s (28min) | 每日 | 取 5        |

（注：每个栏目按"取 N"随机选取 N 个日期的期号生成，确保总计约 380 条）

#### 东方卫视（dragon）— 约 350 条 program

| 栏目名称        | 类型  | 播出类型 | 单集时长    | 生成条目数 |
| ----------- | --- | ---- | ------- | ----- |
| 东方新闻        | 新闻  | 直播   | 1800s   | 50    |
| 看东方         | 新闻  | 直播   | 5400s   | 30    |
| 金牌调解        | 综艺  | 录播   | 3600s   | 40    |
| 极限挑战（第12季）  | 综艺  | 录播   | 5400s   | 12 集  |
| 我们的歌（第6季）   | 综艺  | 录播   | 5400s   | 12 集  |
| 欢乐喜剧人（第10季） | 综艺  | 录播   | 5400s   | 12 集  |
| 梦想改造家（第11季） | 纪实  | 录播   | 3600s   | 12 集  |
| 闪亮的日子（第4季）  | 综艺  | 录播   | 5400s   | 12 集  |
| 东方110       | 法制  | 录播   | 1800s   | 30    |
| 繁花（重播）      | 电视剧 | 录播   | 2700s/集 | 30 集  |
| 人世间（重播）     | 电视剧 | 录播   | 2700s/集 | 58 集  |
| 其他电视剧轮播     | 电视剧 | 录播   | 2700s/集 | 52 条  |

#### 第一财经（finance）— 约 250 条 program

| 栏目名称  | 类型 | 播出类型 | 单集时长  | 生成条目数 |
| ----- | -- | ---- | ----- | ----- |
| 财经早班车 | 财经 | 直播   | 5400s | 40    |
| 财经夜行线 | 财经 | 直播   | 3600s | 40    |
| 谈股论金  | 财经 | 直播   | 7200s | 30    |
| 今日股市  | 财经 | 直播   | 3600s | 30    |
| 市场零距离 | 财经 | 直播   | 3600s | 25    |
| 公司与行业 | 财经 | 录播   | 1800s | 25    |
| 解码财商  | 财经 | 录播   | 1800s | 20    |
| 头脑风暴  | 财经 | 录播   | 3600s | 20    |
| 中国经营者 | 财经 | 录播   | 1800s | 20    |

#### 五星体育（sports）— 约 200 条 program

| 栏目名称        | 类型 | 播出类型 | 单集时长          | 生成条目数 |
| ----------- | -- | ---- | ------------- | ----- |
| 五星足球        | 体育 | 录播   | 3600s         | 30    |
| 弈棋耍大牌       | 棋牌 | 录播   | 3600s         | 40    |
| 健身时代        | 健身 | 录播   | 2160s (36min) | 20    |
| 体育新闻        | 体育 | 直播   | 1800s         | 30    |
| 中超联赛直播      | 赛事 | 直播   | 7200s         | 20    |
| CBA 联赛直播    | 赛事 | 直播   | 7200s         | 20    |
| NBA 录播      | 赛事 | 录播   | 7200s         | 20    |
| 上海浪琴环球马术冠军赛 | 赛事 | 录播   | 5400s         | 5     |
| 实况录像        | 赛事 | 录播   | 5400s\~7200s  | 15    |

#### 纪实人文（doc）— 约 150 条 program

| 栏目名称   | 类型 | 播出类型 | 单集时长  | 生成条目数 |
| ------ | -- | ---- | ----- | ----- |
| 档案     | 纪录 | 录播   | 1800s | 40    |
| 寰宇地理   | 纪录 | 录播   | 3600s | 30    |
| 纪录片编辑室 | 纪录 | 录播   | 3600s | 25    |
| 往事     | 人文 | 录播   | 1800s | 15    |
| 大师     | 人文 | 录播   | 2700s | 15    |
| 纵横经典   | 纪录 | 录播   | 3600s | 15    |
| 真实纪录   | 纪录 | 录播   | 1800s | 10    |

#### 哈哈炫动（cartoon）— 约 70 条 program

| 栏目名称  | 类型 | 播出类型 | 单集时长         | 生成条目数 |
| ----- | -- | ---- | ------------ | ----- |
| 动画片剧场 | 动画 | 录播   | 1200s\~1800s | 20    |
| 炫动酷地带 | 少儿 | 录播   | 2700s        | 15    |
| 欢乐蹦蹦跳 | 少儿 | 录播   | 1800s        | 15    |
| 哈哈大冒险 | 少儿 | 录播   | 1800s        | 10    |
| 炫动梦工厂 | 少儿 | 录播   | 1800s        | 10    |

#### 广告（advertisement）— 约 350 条（全频道共享）

| 名称模板        | 时长范围            | 生成规则             |
| ----------- | --------------- | ---------------- |
| {品牌名}{品类}广告 | 15s / 30s / 60s | 品牌名从预设池（50个）随机选取 |
| 公益广告-{主题}   | 30s / 60s       | 主题从预设池（20个）随机选取  |

品牌名预设池：汽车（上汽大众、蔚来、特斯拉、宝马、奔驰），食品（伊利、蒙牛、农夫山泉、康师傅、旺旺），金融（招商银行、中国平安、支付宝、微信支付），科技（华为、小米、OPPO、苹果），日化（宝洁、联合利华、欧莱雅），地产（万科、恒大、碧桂园），电商（天猫、京东、拼多多、抖音商城），医药（同仁堂、片仔癀、云南白药）等。

公益广告主题预设池：节能减排、文明城市、垃圾分类、健康生活、关爱老人、交通安全、未成年人保护、节约粮食、全民健身、平安建设等。

#### 宣传片（promo）— 约 250 条（全频道共享）

| 名称模板         | 时长范围      | 生成规则                 |
| ------------ | --------- | -------------------- |
| {频道名}频道宣传片   | 15s / 30s | 每频道 10 条             |
| 《{节目名}》节目预告  | 15s / 30s | 从 program 条目中随机选取节目名 |
| {节目名}精彩回顾    | 30s / 60s | 从 program 条目中随机选取    |
| 上海广播电视台形象宣传片 | 30s / 60s | 10 条                 |

### 6.3 ID 和编码生成规则

```ts
// ID 格式：PRG + 6位序号，如 PRG000001
const id = `PRG${String(index + 1).padStart(6, '0')}`

// 18位 code 格式：SMGYYYYMMDD + 频道缩写(3位) + 5位序号
// 如 SMG20250601NEW00001（SMG + 日期 + 频道 + 序号）
const code = `SMG${date}${channelAbbr}${String(seq).padStart(5, '0')}`
```

### 6.4 hasLinkedMaterial 分布

| 条件          | hasLinkedMaterial | 比例  |
| ----------- | ----------------- | --- |
| 3 个月以内的条目   | true              | 90% |
| 3\~6 个月的条目  | true              | 70% |
| 6\~12 个月的条目 | true              | 50% |
| 广告          | true              | 95% |
| 宣传片         | true              | 80% |

这样 V5 校验在演示时会有合理比例的 warning。

### 6.5 生成脚本规格

```ts
// src/mock/generateSeedData.ts

/**
 * 执行后在 src/mock/ 目录下生成：
 * - programLibrary.json  (2000 条 ProgramLibraryItem)
 * - seedDataStats.json   (统计摘要：各频道/类型/时长分布)
 *
 * 运行方式：npx ts-node src/mock/generateSeedData.ts
 *
 * 生成逻辑：
 * 1. 按 §6.2 的频道×栏目矩阵，循环生成每条记录
 * 2. 为每条记录生成随机日期（在指定频次范围内）
 * 3. episodeInfo 格式："YYYY-MM-DD期"（日播）或 "第N集"（剧集/季播）
 * 4. hasLinkedMaterial 按 §6.4 的时间衰减规则赋值
 * 5. 最终按 id 排序输出
 */
```

***

## 7 功能需求详细说明

### 7.1 功能模块总览

| 模块编号 | 模块名称     | 优先级 | 说明                                     |
| ---- | -------- | --- | -------------------------------------- |
| F01  | 频道与日期选择  | P0  | 入口页                                    |
| F02  | LLM 分步编排 | P0  | 核心功能：Phase0→Phase1→Phase2渐进填充→Phase3修补 |
| F03  | 编排进度面板   | P0  | 显示 TodoList 式的分步填充进度                   |
| F04  | 串联单编辑表格  | P0  | 展示+手动微调，实时校验联动                         |
| F05  | 校验报告面板   | P0  | 展示全量校验结果                               |
| F06  | 版面参考对比面板 | P1  | 标准版面对照                                 |
| F07  | 对话式微调    | P1  | 自然语言→命令→执行→校验                          |
| F08  | 编排结果导出   | P2  | JSON / CSV                             |
| F09  | 编排历史记录   | P2  | 快照对比                                   |

### 7.2 F01 — 频道与日期选择

- **频道下拉选择器**：6 个频道，显示中文名称。
- **日期选择器**：默认明天，允许未来 7 天。
- **"AI 智能编排"按钮**：点击后触发分步编排流程，带 loading 态。
- **业务校验**：未选频道/日期时按钮置灰；已存在草稿时二次确认。

### 7.3 F02 — LLM 分步编排（核心）

详见 §4.3。补充 UI 需求：

- **Phase 1 完成后**：弹出"编排计划"确认弹窗，展示 LLM 规划的时段块列表，用户可确认或要求重新规划。
- **Phase 2 进行中**：进度面板实时更新（见 F03），表格逐步填充。
- **Phase 3 修补**：自动执行，修补过程在对话面板中展示。
- **全流程可取消**：任意阶段可点击"停止编排"，保留已填充的部分。

### 7.4 F03 — 编排进度面板（TodoList 式）

**页面位置**：编辑页顶部或侧边浮动面板。

**展示内容**：

```
┌─ 编排进度 ─────────────────────────────────┐
│                                             │
│  ✓ Phase 1: 编排规划完成                     │
│                                             │
│  Phase 2: 渐进式填充 (12/18)                  │
│  ✓ BLK01  06:00-08:00 早间新闻    12条  ✓    │
│  ✓ BLK02  08:00-09:00 早间广告段   5条  ✓    │
│  ✓ BLK03  09:00-11:30 上午剧场    8条  ✓    │
│  ...                                        │
│  ● BLK12  18:30-19:30 晚间新闻    填充中...  │
│  ○ BLK13  19:30-21:30 黄金剧场    待填充     │
│  ...                                        │
│                                             │
│  ○ Phase 3: 校验修补                待执行   │
│                                             │
│  [停止编排]                                  │
└─────────────────────────────────────────────┘
```

每个块的状态：○ 待填充 → ● 填充中（loading 动画）→ ✓ 已完成 → ✗ 有错误（红色）

### 7.5 F04 — 串联单编辑表格

**表格列定义**：

| 列名   | 字段             | 宽度    | 可编辑 | 说明            |
| ---- | -------------- | ----- | --- | ------------- |
| 序号   | sortOrder      | 60px  | 否   | 自动编号          |
| 播出时间 | startTime      | 100px | 是   | HH:mm:ss      |
| 结束时间 | endTime        | 100px | 是   | HH:mm:ss      |
| 节目名称 | programName    | 200px | 是   | 文本输入/节目库下拉    |
| 业务类型 | businessType   | 100px | 是   | 下拉：节目/广告/宣传片  |
| 源类型  | sourceType     | 80px  | 是   | 下拉：录播/直播      |
| 时长   | duration       | 80px  | 否   | 自动计算，显示 mm:ss |
| 节目编码 | code18         | 160px | 否   | 节目库自动填充       |
| 演播室  | studio         | 140px | 条件  | 仅直播时可编辑       |
| 素材状态 | materialStatus | 100px | 否   | 标签            |
| 校验   | —              | 40px  | 否   | 图标：✓/✗/⚠      |
| 备注   | remark         | 150px | 是   | 自由文本          |

**表格交互**（所有写操作均通过原子能力 → 自动校验）：

- **行拖拽排序** → `moveItem()`
- **行操作按钮**："插入/删除/复制" → `insertItems()` / `deleteItems()`
- **异常高亮**：根据 `ValidationReport.errorsByItemId`，CSS class 叠加（§5.4）
- **时间级联**：修改 startTime/endTime 后 → `recalculateTimesFrom()`
- **广告权限**：editor 角色不可编辑 ad 行

### 7.6 F05 — 校验报告面板

- **总览卡片**：通过/错误/警告数量 + 按规则分组统计
- **错误列表**：逐条展示，含规则编号、严重级别、描述
- **点击定位**：点击错误条目 → 表格滚动到对应行并闪烁
- **一键修复**：V6 时长不一致可自动修复（duration = endTime - startTime）
- **自动刷新**：数据变更后自动更新

### 7.7 F06 — 版面参考对比面板

- 按频道 ID 读取 `layoutReferenceData`
- 时间轴列表展示，色块区分 program/ad/promo
- "一键应用参考" → `batchSetSchedule()`
- 与编辑表格联动滚动

### 7.8 F07 — 对话式微调

详见 §4.4。补充交互细节：

- 变更预览：删除行红色删除线、新增行绿色底色、修改字段黄色高亮
- 用户确认后执行，拒绝则丢弃
- 对话历史保留在面板中

**输入示例与命令映射**：

| 用户输入                | 预期命令          | LLM 上下文             |
| ------------------- | ------------- | ------------------- |
| "把19:00的节目换成中超直播"   | replace       | 19:00附近条目 + 体育节目库   |
| "在早安上海之后加5分钟宣传片"    | insert        | "早安上海"条目 + 宣传片库     |
| "删掉08:00那段空节目"      | delete        | 08:00时段条目           |
| "把12:00和12:30的节目对调" | swap          | 12:00/12:30条目       |
| "把第3条备注改成重播"        | update\_field | 第3条数据               |
| "黄金时段多加些新闻"         | batch         | 19:00-22:00全部 + 新闻库 |

### 7.9 F08/F09 — 导出与历史

- **导出**：JSON / CSV / 打印视图，可附加校验报告
- **历史**：Pinia store 快照，版本 diff 对比

***

## 8 页面结构与布局

### 8.1 页面路由

| 路由                           | 页面  | 说明                   |
| ---------------------------- | --- | -------------------- |
| `/`                          | 首页  | 频道卡片 + 日期选择 + AI编排入口 |
| `/schedule/:channelId/:date` | 编辑页 | 核心页面                 |
| `/settings`                  | 设置页 | LLM 配置               |

### 8.2 编辑页布局（基于现有 create.vue）

**现有 create.vue 布局**：
- 左侧：主内容区（时间轴表格）
- 右侧：`BroadcastPlanSidebar` 侧边栏（浮层式，可展开/收起）

**LLM 对话框整合方案**：

在现有 `BroadcastPlanSidebar` 的基础上增加 **LLM ChatPanel**，通过 Tab 页签切换：

```
┌─────────────────────────────────────────────────────────────────────────┐
│  顶部操作栏                                                              │
│  [编单名称] [所属频道▼] [日期▼] [AI智能编排] [显示版面] 共X个节目...    │
├─────────────────────────────────────────┬───────────────────────────────┤
│                                         │  侧边栏 (320px, 可收起)        │
│  串联单编辑表格 (create.vue)             │  ┌─────────────────────────┐ │
│  ┌─────────────────────────────┐       │  │ [播出计划] [LLM助手] [校验]│ │
│  │ 序号 | 起始时间 | 结束时间 | ...│       │  ├─────────────────────────┤ │
│  │  1  |  06:00   |  08:00   | ...│       │  │                         │ │
│  │  2  |  08:00   |  08:01   | ...│       │  │  Tab 1: 播出计划         │ │
│  │  ...                            │       │  │  Tab 2: LLM助手 (新增)    │ │
│  └─────────────────────────────┘       │  │  Tab 3: 校验报告         │ │
│                                         │  │                         │ │
│                                         │  └─────────────────────────┘ │
│                                         │                                │
│                                         │  [浮层按钮] 播出计划/AI助手    │
└─────────────────────────────────────────┴────────────────────────────────┘
```

**新增 Tab 页签**：

| Tab 页签 | 功能 | 对应组件 |
|----------|------|----------|
| 播出计划 | 现有 BroadcastPlanSidebar 功能 | `BroadcastPlanSidebar.vue` |
| **LLM助手** | LLM 对话微调（新增） | `ChatPanel.vue` |
| 校验报告 | 显示校验错误 | `ValidationPanel.vue` |

**浮层按钮调整**：

现有浮层按钮显示"播出计划"，点击切换侧边栏。调整为：
- 显示当前 Tab 名称
- 点击循环切换 Tab 或直接弹出 Tab 选择菜单

### 8.3 ChatPanel 组件设计

**组件位置**：`src/views/broadcast-plan/components/ChatPanel.vue`

**组件结构**：

```
┌─────────────────────────────────────┐
│  LLM助手                      [×]  │
├─────────────────────────────────────┤
│  ┌─────────────────────────────────┐│
│  │ AI: 您好，我可以帮您调整串联单。 ││
│  │    请输入您的需求...            ││
│  └─────────────────────────────────┘│
│  ┌─────────────────────────────────┐│
│  │ 用户: 将12点以后变成广告         ││
│  └─────────────────────────────────┘│
│  ┌─────────────────────────────────┐│
│  │ AI: 已识别为 batch_update 命令  ││
│  │    目标: 12:00 之后所有条目      ││
│  │    操作: businessType → ad     ││
│  │    [确认] [取消]               ││
│  └─────────────────────────────────┘│
├─────────────────────────────────────┤
│  [请输入需求...]              [发送] │
└─────────────────────────────────────┘
```

**组件 Props/Emits**：

```ts
interface ChatPanelProps {
  visible: boolean          // 控制显示
  scheduleItems: ScheduleItem[]  // 当前串联单数据
  channelId: string         // 频道ID
  date: string              // 编单日期
}

interface ChatPanelEmits {
  (e: 'update:visible', value: boolean): void
  (e: 'command-confirmed', command: ScheduleCommand): void  // 用户确认执行命令
}
```

**ChatPanel 内部状态**：

```ts
const messageList = ref<ChatMessage[]>([])      // 对话消息列表
const currentIntent = ref<IntentResult | null>(null)  // 当前识别到的意图
const isProcessing = ref(false)                  // 处理中状态
```

**ChatPanel 核心方法**：

```ts
// 发送用户消息
const handleSend = async (text: string) => {
  // 1. 添加用户消息
  messageList.value.push({ role: 'user', content: text })

  // 2. 调用 IntentCommandService 识别意图
  isProcessing.value = true
  const intentResult = await intentCommandService.process(text, {
    scheduleItems: props.scheduleItems,
    channelId: props.channelId,
    date: props.date
  })

  // 3. 根据置信度决定下一步
  if (intentResult.confidence >= CONFIDENCE_THRESHOLD) {
    // 高置信度：直接显示命令预览
    currentIntent.value = intentResult
    messageList.value.push({ role: 'assistant', content: `已识别为 ${intentResult.action} 命令` })
  } else {
    // 低置信度：显示澄清问题
    messageList.value.push({ role: 'assistant', content: intentResult.clarificationQuestion })
  }

  isProcessing.value = false
}

// 确认执行命令
const handleConfirm = () => {
  if (currentIntent.value?.command) {
    emit('command-confirmed', currentIntent.value.command)
    currentIntent.value = null
  }
}
```

### 8.4 与 create.vue 的集成

**集成方式**：在 `create.vue` 中引入 ChatPanel，通过 Tab 页签切换

**create.vue 修改点**：

```vue
<!-- 现有代码 -->
<BroadcastPlanSidebar
  v-model:visible="sidebarOpen"
  :current-channel="scheduleForm.channelId"
  @select-plan="handleSelectPlan"
/>

<!-- 新增：Tab 切换逻辑 -->
<div class="sidebar-tabs">
  <el-tabs v-model="activeSidebarTab" class="sidebar-tabs-inner">
    <el-tab-pane label="播出计划" name="plan">
      <BroadcastPlanSidebar ... />
    </el-tab-pane>
    <el-tab-pane label="LLM助手" name="chat">
      <ChatPanel
        :visible="activeSidebarTab === 'chat'"
        :schedule-items="scheduleItems"
        :channel-id="scheduleForm.channelId"
        :date="scheduleForm.date"
        @command-confirmed="handleLLMCommand"
      />
    </el-tab-pane>
    <el-tab-pane label="校验报告" name="validation">
      <ValidationPanel ... />
    </el-tab-pane>
  </el-tabs>
</div>
```

**浮动按钮调整**：

```vue
<!-- 现有浮层按钮 -->
<div class="floating-toggle-btn" @click="toggleSidebar">
  <el-icon><ArrowLeft /></el-icon>
  <span>{{ sidebarTabLabelMap[activeSidebarTab] }}</span>
</div>
```

**命令执行回调**：

```ts
// 处理 LLM 确认的命令
const handleLLMCommand = (command: ScheduleCommand) => {
  // 调用 commandExecutor 执行命令
  commandExecutor.execute(command)
  // 更新 scheduleItems
  scheduleItems.value = scheduleStore.items
  ElMessage.success('已完成修改')
}
```

***

## 9 前端文件结构

```
src/
├── types/
│   ├── channel.ts                # 频道类型
│   ├── program.ts                # 节目库/成品类型（duration 单位秒）
│   ├── layout.ts                 # 版面参考类型（时间 HH:mm:ss）
│   ├── rundown.ts                # RundownItem（LLM 输出，含 endTime）
│   ├── schedule.ts               # ScheduleItem（前端渲染，duration 秒）
│   ├── command.ts                # ScheduleCommand 命令协议（含 PlanCommand/FillBlockCommand）
│   ├── validation.ts             # 校验规则、报告类型（V1空窗/V2重叠 互斥）
│   └── mutation.ts               # MutationResult
│
├── mock/
│   ├── generateSeedData.ts       # 2000条节目库生成脚本（按§6规则）
│   ├── programLibrary.json       # 生成结果（gitignore，首次 npm run seed 生成）
│   └── seedData.ts               # 其他种子数据（频道/版面参考/演播室等）
│
├── services/
│   ├── atomicCapabilities.ts     # Layer 1: AtomicCapabilities 接口实现
│   ├── llmClient.ts              # Layer 2: Kimi K2.5 API 封装（openai SDK）
│   ├── promptBuilder.ts          # Layer 2: Prompt 拼装（规划/填充/修补/微调 4种模式）
│   ├── contextBuilder.ts         # Layer 2: 对话上下文摘要（含时间/节目名提取）
│   ├── responseParser.ts         # Layer 2: LLM 返回 → ScheduleCommand 解析
│   ├── commandExecutor.ts        # Layer 2→1: 命令执行器（含 PlanCommand 存储逻辑）
│   ├── orchestrator.ts           # Layer 2: 分步编排调度器（Phase 1→2→3 循环控制）
│   ├── validationEngine.ts       # Layer 3: 校验引擎（V1~V6）
│   └── scheduleTransformer.ts    # RundownItem ↔ ScheduleItem 转换（完整字段映射）
│
├── stores/
│   ├── scheduleStore.ts          # 串联单 + 校验报告 + 编排进度
│   ├── channelStore.ts           # 频道/节目库
│   └── llmConfigStore.ts         # LLM 配置
│
├── composables/
│   ├── useScheduleEditor.ts      # 编辑交互（调用原子能力）
│   ├── useOrchestrator.ts        # 分步编排流程控制
│   ├── useValidation.ts          # 校验结果消费（高亮/报告面板）
│   └── useLLMChat.ts             # 对话微调
│
├── components/
│   ├── ChannelSelector.vue
│   ├── ScheduleTable.vue
│   ├── OrchestrationProgress.vue # 编排进度面板（TodoList 式）
│   ├── ValidationPanel.vue
│   ├── LayoutReferencePanel.vue
│   ├── ChatPanel.vue              # LLM 对话面板（浮窗式，参考现有浮层设计）
│   ├── CommandPreview.vue        # 变更预览（diff 高亮）
│   ├── ScheduleStats.vue
│   └── ValidationBadge.vue
│
├── views/
│   ├── HomePage.vue
│   ├── ScheduleEditorPage.vue
│   └── SettingsPage.vue
│
├── utils/
│   ├── timeUtils.ts              # 时间解析/格式化（统一 HH:mm:ss）
│   └── typeMapper.ts             # 类型映射
│
├── router/index.ts
└── App.vue
```

***

## 10 关键工具函数

### 10.1 时间工具（timeUtils.ts）

```ts
/** 解析 HH:mm:ss:FF → 总秒数（忽略帧） */
export function parseRundownTime(time: string): number

/** 解析 HH:mm:ss → 总秒数 */
export function parseScheduleTime(time: string): number

/** 秒数 → HH:mm:ss:00 */
export function toRundownTimeString(seconds: number): string

/** 秒数 → HH:mm:ss */
export function toScheduleTimeString(seconds: number): string

/** 秒数差 */
export function timeDiffSeconds(start: string, end: string): number

/** 时间加法 */
export function addDuration(startTime: string, durationSeconds: number): string

/** 秒数 → 显示用 mm:ss 或 HH:mm:ss（表格时长列用） */
export function formatDuration(seconds: number): string
```

***

## 11 LLM API 配置页

| 设置项           | 类型       | 默认值                          | 说明                                   |
| ------------- | -------- | ---------------------------- | ------------------------------------ |
| API Base URL  | string   | `https://api.moonshot.cn/v1` | Kimi K2.5 端点                         |
| API Key       | password | 空                            | Moonshot API Key                     |
| 模型名称          | select   | `kimi-k2.5`                  | 可选 kimi-k2.5 / kimi-k2-turbo-preview |
| Temperature   | slider   | `0.3`                        | 0\~1                                 |
| 单次 Max Tokens | number   | `8192`                       | 建议不超过 16384                          |

提供"测试连接"按钮和"Kimi K2.5 推荐配置"一键填充。

***

## 12 演示场景脚本

### 场景 1：分步编排全流程

1. 首页选择"新闻综合"频道 + 明天日期。
2. 点击"AI 智能编排"。
3. **Phase 1**（\~3 秒）：LLM 返回编排计划，进度面板显示 18 个时段块。
4. 弹窗展示编排计划，用户确认。
5. **Phase 2**（\~60 秒）：渐进式填充，每填充一条，表格实时新增一行，进度面板更新。
6. **Phase 3**（\~10 秒）：自动修补 V1/V2/V3 错误。
7. 最终校验报告："196 条通过，2 条 V4 错误（节目库无匹配），8 条 V5 警告（素材未关联）"。
8. 表格中 V4 错误行橙色高亮，V5 警告行黄色高亮。

### 场景 2：对话微调

1. 场景 1 基础上，输入"把 19:00 的节目换成中超直播，时长 2 小时"。
2. Kimi K2.5 返回 ReplaceCommand → diff 预览。
3. 确认 → 执行 → 自动校验 → 表格更新。

### 场景 3：手动编辑 + 实时校验

1. 手动改某行 endTime 为不合理值。
2. 自动触发校验 → V6 标红 + V2 标红后续行。
3. 校验面板同步更新。

### 场景 4：校验驱动修复

1. 场景 1 后校验有 2 条 V4 错误。
2. 对话面板提示"是否需要 AI 修复？"
3. 确认 → LLM 返回 BatchCommand → 预览 → 执行 → 重新校验。

***

## 13 非功能性需求

| 项目       | 要求                                       |
| -------- | ---------------------------------------- |
| 性能       | 页面操作 <200ms；校验 300 条 <50ms；表格 300 行流畅滚动  |
| 兼容       | Chrome/Edge/Firefox 90+                  |
| 错误处理     | LLM 调用失败支持单块重试（不影响已填充部分）；JSON 解析失败展示原始文本 |
| 国际化      | 仅中文                                      |
| 安全       | API Key 仅存本地 localStorage                |
| 校验实时性    | 数据变更后 100ms 内完成校验并刷新高亮                   |
| LLM 调用容错 | 单块填充失败最多重试 2 次；Phase 3 修补最多 3 轮          |

***

## 14 种子数据文件引用

| 数据集        | 变量名/文件                            | 用途                          |
| ---------- | --------------------------------- | --------------------------- |
| 业务频道列表     | `bizChannels`                     | 频道下拉                        |
| 频道演播室映射    | `channelStudioMap`                | 直播演播室                       |
| OPS 频道配置   | `opsChannelConfigs`               | 播出时段（时间格式需统一为 HH:mm:ss）     |
| 版面参考       | `layoutReferenceData`             | LLM 编排骨架（时间格式需统一为 HH:mm:ss） |
| 协同编单原始数据   | `collaborativeEditingList`        | 已有串联单样本                     |
| 协同编单页面模型   | `collaborativeScheduleList`       | 列表展示                        |
| 编单详情       | `collaborativeScheduleDetailById` | 编辑页回填                       |
| 播出版面列表     | `broadcastLayout`                 | 参考                          |
| 播出版面节目     | `broadcastLayoutPrograms`         | 参考                          |
| 节目库（2000条） | `programLibrary.json`             | LLM 可选节目池 + V4/V5 校验源       |
| 角色权限       | `broadcastPlanPermissionByRole`   | 广告编辑权限                      |

***

## 15 验收标准

| 编号   | 验收项              | 通过条件                                                   |
| ---- | ---------------- | ------------------------------------------------------ |
| AC01 | 频道与日期            | 6 频道可选，日期默认明天                                          |
| AC02 | Phase 1 规划       | LLM 返回 PlanCommand，进度面板显示时段块列表                         |
| AC03 | Phase 2 渐进式填充    | 每条 LLM 调用 queryCandidates 获取候选，选择后返回单条 RundownItem     |
| AC04 | 编排进度面板           | TodoList 式展示每块状态（待填充/进行中/完成/错误）                        |
| AC05 | Phase 3 修补       | 自动修复 V1/V2/V3 错误，最多 3 轮                                |
| AC06 | 数据转换             | RundownItem→ScheduleItem 转换正确（含 endTime 计算、duration 秒） |
| AC07 | V1 空窗校验          | 检测并标记时间间隙（不与 V2 重复报告）                                  |
| AC08 | V2 重叠校验          | 检测并标记时间重叠（不与 V1 重复报告）                                  |
| AC09 | V3 首尾匹配          | 时间格式 HH:mm:ss 统一，正确比较                                  |
| AC10 | V4 成品关联          | 检测未关联成品（program→error, ad/promo→warning）               |
| AC11 | V5 素材关联          | 检测成品未关联素材并标记                                           |
| AC12 | V6 时长一致性         | duration(秒) vs endTime-startTime，允许 1 秒误差              |
| AC13 | 校验报告面板           | 统计+错误列表+点击定位                                           |
| AC14 | 表格异常高亮           | 多错误 CSS class 叠加（非互斥）                                  |
| AC15 | 编辑后自动校验          | 手动编辑→原子能力→自动校验→刷新高亮                                    |
| AC16 | 对话微调             | 自然语言→命令→预览→确认→执行→校验                                    |
| AC17 | update\_field 命令 | 微调 Prompt 包含所有 7 种命令类型                                 |
| AC18 | 原子能力调用链          | 所有写入经 AtomicCapabilities 接口                            |
| AC19 | 节目库 2000 条       | generateSeedData 脚本可运行，输出数据覆盖 6 频道                     |
| AC20 | 版面参考展示           | 正确展示+一键应用                                              |
| AC21 | 导出               | JSON/CSV 完整                                            |
| AC22 | 设置页              | Kimi K2.5 配置可修改+连接测试                                   |
| AC23 | 加载态              | 分步编排有进度展示                                              |
| AC24 | 错误处理             | 单块失败可重试，不影响已填充部分                                       |

