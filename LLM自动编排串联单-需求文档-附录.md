# LLM 自动编排串联单 — 需求文档附录

> 本文档包含主需求文档中非核心的附录内容，包括种子数据规则、前端实现细节和验收标准。

---

## §6 种子数据：2000 条节目库生成规则

> 节目库数据不在本文档中内联，而是通过**生成脚本**（`src/mock/generateSeedData.ts`）按以下规则自动生成。生成结果写入 `src/mock/programLibrary.json`。

### 6.1 数据规模目标

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

#### 东方卫视（dragon）— 约 350 条 program

| 栏目名称        | 类型  | 播出类型 | 单集时长    | 生成条目数 |
| ----------- | --- | ---- | ------- | ----- |
| 东方新闻        | 新闻  | 直播   | 1800s   | 50    |
| 看东方         | 新闻  | 直播   | 5400s   | 30    |
| 金牌调解        | 综艺  | 录播   | 3600s   | 40    |
| 极限挑战（第12季）  | 综艺  | 录播   | 5400s   | 12 集  |
| 我们的歌（第6季）   | 综艺  | 录播   | 5400s   | 12 集  |
| 天赐的声音（第5季） | 综艺  | 录播   | 5400s   | 12 集  |
| 繁花         | 电视剧 | 录播   | 2700s×3 | 30 集  |
| 庆余年（第2季）    | 电视剧 | 录播   | 2700s×3 | 30 集  |
| 五月与我的警员男友   | 电视剧 | 录播   | 2700s×2 | 25 集  |
| 主持人风格大赛     | 综艺  | 录播   | 5400s   | 8 集   |
| 未来中国（第3季）   | 综艺  | 录播   | 5400s   | 10 集  |
| 梦想的声音（第4季）  | 综艺  | 录播   | 5400s   | 12 集  |
| 今日亚洲         | 新闻  | 直播   | 1800s   | 50    |
| 双城之声         | 新闻  | 录播   | 1800s   | 30    |
| 财道             | 财经  | 录播   | 1800s   | 40    |

#### 第一财经（finance）— 约 300 条 program

| 栏目名称       | 类型  | 播出类型 | 单集时长    | 生成条目数 |
| ---------- | --- | ---- | ------- | ----- |
| 财经早间新闻     | 财经  | 直播   | 3600s   | 250   |
| 财经早间新闻     | 财经  | 录播   | 3600s   | 50    |
| 交易日         | 财经  | 直播   | 9000s   | 250   |
| 首席评论        | 财经  | 录播   | 1800s   | 100   |
| 第一声音        | 财经  | 录播   | 1800s   | 80    |
| 直面股事人       | 财经  | 录播   | 1800s   | 60    |
| 公司与行业       | 财经  | 录播   | 1800s   | 100   |
| 读书             | 人文  | 录播   | 2700s   | 40    |

#### 五星体育（sports）— 约 300 条 program

| 栏目名称    | 类型  | 播出类型 | 单集时长    | 生成条目数 |
| ------- | --- | ---- | ------- | ----- |
| 体育新闻    | 体育  | 直播   | 1800s   | 200   |
| 今日体育    | 体育  | 录播   | 1800s   | 100   |
| 超级体育课   | 体育  | 录播   | 1800s   | 80    |
| 篮球相关    | 体育  | 录播   | 5400s   | 50    |
| 足球相关    | 体育  | 录播   | 5400s   | 80    |
| 体育频道其他 | 体育  | 录播   | 1800s   | 40    |

#### 纪实人文（doc）— 约 280 条 program

| 栏目名称       | 类型  | 播出类型 | 单集时长    | 生成条目数 |
| ---------- | --- | ---- | ------- | ----- |
| 档案         | 人文  | 录播   | 2700s   | 120   |
| 往事         | 人文  | 录播   | 2700s   | 80    |
| 眼界         | 人文  | 录播   | 2700s   | 60    |
| 纪录中国       | 纪录片 | 录播   | 3600s   | 80    |
| 自然影响力     | 纪录片 | 录播   | 3600s   | 50    |
| 医道         | 健康  | 录播   | 2700s   | 60    |
| 幸福学院       | 人文  | 录播   | 1800s   | 50    |

#### 哈哈炫动（cartoon）— 约 120 条 program

| 栏目名称  | 类型     | 播出类型 | 单集时长    | 生成条目数 |
| ----- | ------ | ---- | ------- | ----- |
| 新闻大嘴巴 | 儿童新闻 | 录播   | 1200s   | 80    |
| 少年说   | 儿童综艺  | 录播   | 1800s   | 60    |
| 翻滚吧！博士 | 儿童综艺  | 录播   | 1200s   | 50    |
| 琦喵喵日记  | 儿童综艺  | 录播   | 1200s   | 40    |
| 儿童相关其他 | 动漫/儿童 | 录播   | 1200s   | 70    |

### 6.3 广告库（约 350 条）

| 类型     | 规格         | 生成数量 |
| ------ | ---------- | ---- |
| 普通广告   | 30s        | 150  |
| 普通广告   | 60s        | 100  |
| 普通广告   | 90s        | 50   |
| 特殊广告   | 120s       | 30   |
| 品牌广告   | 180s       | 20   |

### 6.4 宣传片库（约 250 条）

| 类型   | 规格   | 生成数量 |
| ---- | ---- | ---- |
| 频道宣传片 | 30s  | 80    |
| 频道宣传片 | 60s  | 50    |
| 节目宣传片 | 30s  | 60    |
| 节目宣传片 | 60s  | 40    |
| 公益宣传片 | 30s  | 20    |

---

## §8 页面结构与布局

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

### 8.4 与 create.vue 的集成

详见主需求文档 §8.4。

---

## §9 前端文件结构

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
│   ├── promptBuilder.ts           # Layer 2: Prompt 拼装（规划/填充/修补/微调 4种模式）
│   ├── contextBuilder.ts           # Layer 2: 对话上下文摘要（含时间/节目名提取）
│   ├── responseParser.ts           # Layer 2: LLM 返回 → ScheduleCommand 解析
│   ├── commandExecutor.ts          # Layer 2→1: 命令执行器（含 PlanCommand 存储逻辑）
│   ├── orchestrator.ts             # Layer 2: 分步编排调度器（Phase 1→2→3 循环控制）
│   ├── validationEngine.ts          # Layer 3: 校验引擎（V1~V6）
│   └── scheduleTransformer.ts       # RundownItem ↔ ScheduleItem 转换（完整字段映射）
│
├── stores/
│   ├── scheduleStore.ts              # 串联单 + 校验报告 + 编排进度
│   ├── channelStore.ts               # 频道/节目库
│   └── llmConfigStore.ts            # LLM 配置
│
├── composables/
│   ├── useScheduleEditor.ts          # 编辑交互（调用原子能力）
│   ├── useOrchestrator.ts            # 分步编排流程控制
│   ├── useValidation.ts               # 校验结果消费（高亮/报告面板）
│   └── useLLMChat.ts                 # 对话微调
│
├── components/
│   ├── ChannelSelector.vue
│   ├── ScheduleTable.vue
│   ├── OrchestrationProgress.vue      # 编排进度面板（TodoList 式）
│   ├── ValidationPanel.vue
│   ├── LayoutReferencePanel.vue
│   ├── ChatPanel.vue                  # LLM 对话面板（浮窗式，参考现有浮层设计）
│   ├── CommandPreview.vue              # 变更预览（diff 高亮）
│   ├── ScheduleStats.vue
│   └── ValidationBadge.vue
│
├── views/
│   ├── HomePage.vue
│   ├── ScheduleEditorPage.vue
│   └── SettingsPage.vue
│
├── utils/
│   ├── timeUtils.ts                   # 时间解析/格式化（统一 HH:mm:ss）
│   └── typeMapper.ts                  # 类型映射
│
├── router/index.ts
└── App.vue
```

---

## §10 关键工具函数

### 10.1 timeUtils.ts

```ts
// src/utils/timeUtils.ts

/**
 * 时间字符串（HH:mm:ss）转秒数
 */
export function timeToSeconds(time: string): number {
  const parts = time.split(':').map(Number)
  return parts[0] * 3600 + parts[1] * 60 + parts[2]
}

/**
 * 秒数转时间字符串（HH:mm:ss）
 */
export function secondsToTime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/**
 * 时间差（秒）
 */
export function timeDiff(start: string, end: string): number {
  return timeToSeconds(end) - timeToSeconds(start)
}

/**
 * 时间衔接校验：end === nextStart
 */
export function isTemporalFit(end: string, nextStart: string): boolean {
  return end === nextStart
}
```

### 10.2 typeMapper.ts

```ts
// src/utils/typeMapper.ts

import type { RundownItem } from '@/types/rundown'
import type { ScheduleItem } from '@/types/schedule'

/**
 * RundownItem → ScheduleItem 转换
 * LLM 输出的 RundownItem 转换为前端渲染用的 ScheduleItem
 */
export function rundownToSchedule(item: RundownItem): ScheduleItem {
  return {
    id: item.id,
    scheduleId: '',
    startTime: item.broadcastTime,  // broadcastTime → startTime
    endTime: item.endTime,
    episodeName: item.programName,  // programName → episodeName
    programCode: item.programCode,
    materialStatus: 'pending',
    businessType: mapBroadcastTypeToBusinessType(item.broadcastType),
    sourceType: mapBroadcastTypeToSourceType(item.broadcastType),
    // ... 其他字段映射
  }
}

function mapBroadcastTypeToBusinessType(type: string): 'program' | 'ad' | 'promo' {
  if (type === '广告') return 'ad'
  if (type === '宣传片') return 'promo'
  return 'program'
}
```

---

## §11 LLM API 配置页

### 11.1 配置项

| 配置项 | 类型 | 默认值 | 说明 |
| ------| ---- | ------ | ---- |
| API Endpoint | string | `https://api.moonshot.cn/v1` | Kimi API 地址 |
| API Key | string | 空 | API 密钥（密文展示） |
| Model | string | `moonshot-v1-32k` | 模型名称 |
| Max Tokens | number | 32000 | 最大输出 token |
| Temperature | number | 0.3 | 随机性参数 |

### 11.2 连接测试

点击"测试连接"按钮，发送一个简单的 completion 请求验证配置是否正确。

---

## §12 演示场景脚本

### 12.1 完整编排流程

```
1. 用户打开首页
   → 选择频道：新闻综合
   → 选择日期：明天
   → 点击"AI智能编排"

2. Phase 1：规划（~5秒）
   → AI 返回 PlanCommand（18个时段块）
   → 前端展示编排计划确认弹窗
   → 用户点击"确认"

3. Phase 2：渐进填充（~60秒）
   → 表格逐步新增行
   → 进度面板：BLK01✓ BLK02✓ ... BLK12进行中

4. Phase 3：自动修补（~15秒）
   → AI 自动修复2个校验错误
   → 8个警告需人工确认

5. 完成
   → 串联单完整填充
   → 用户可手动微调
```

### 12.2 对话微调流程

```
1. 用户在 LLM助手 Tab 输入：
   "把19:00的节目换成中超直播"

2. AI 识别为 replace 命令
   → 展示命令预览

3. 用户点击"确认"

4. 系统执行替换
   → 更新串联单
   → 触发校验

5. 表格高亮显示变更行
```

---

## §13 非功能性需求

### 13.1 性能需求

| 指标 | 要求 |
| ---- | ---- |
| 页面加载 | < 2秒 |
| LLM 单次调用 | < 10秒 |
| 全量编排（200条） | < 2分钟 |
| 前端交互响应 | < 100ms |

### 13.2 兼容性需求

- 浏览器：Chrome 90+、Firefox 88+、Safari 14+、Edge 90+
- 屏幕分辨率：1920×1080 及以上

### 13.3 可用性需求

- 操作可撤销
- 错误信息明确
- 支持键盘导航

---

## §14 种子数据文件引用

| 数据文件 | 导出名称 | 用途 |
| -------- | -------- | ---- |
| 频道配置 | `broadcastChannels` | 频道下拉选择 |
| 版面模板 | `layoutTemplates` | 版面参考 |
| 版面列表 | `broadcastLayout` | 参考 |
| 版面节目 | `broadcastLayoutPrograms` | 参考 |
| 节目库（2000条） | `programLibrary.json` | LLM 可选节目池 + V4/V5 校验源 |
| 角色权限 | `broadcastPlanPermissionByRole` | 广告编辑权限 |

---

## §15 验收标准

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

---

*文档版本：v1.0*
*编写日期：2026-03-23*
