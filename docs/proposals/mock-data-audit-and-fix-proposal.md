# 节目假数据核查与修正方案

> 文档性质：临时技术方案（待用户确认后实施），不作为长期约束依据。
> 实施完成后可移入 `docs/archive/proposal/`。

## 一、背景与目标

用户反馈：现有节目假数据的基本信息（尤其是时长、分类）未严格按真实电视编排情况填充，"看起来很有问题"。

**硬约束**：数据结构不得调整（不改 JSON 字段结构、不改 `ProgramDefinition` 等类型定义），仅修正字段值。

**目标**：在不破坏业务链路（候选检索、时长匹配、编排填充）的前提下，让每条假数据的 `programType` 分类与 `duration` 时长符合真实电视节目形态。

## 二、核查范围与数据规模

| 数据文件 | 路径 | 规模 | 关键字段 |
|---------|------|------|---------|
| 频道 | `src/mock/data/channels.json` | 1 条 | 东方卫视（dragon） |
| 栏目 | `src/mock/data/columns.json` | 19 个 | columnId / columnName / defaultProgramType / isSequential |
| 节目定义 | `src/mock/data/programDefinitions.json` | 135 条 | programId / programName / columnId / programType（**无 duration 字段**） |
| 成品节目 | `src/mock/data/finishedProducts.json` | 2029 条 | productId / programId / title / duration / issueNo（1923 program_instance + 106 short_video） |
| 版面时段 | `src/mock/data/layoutSlots.json` | 19 段 | 06:00–23:59，总时长 1050 分钟 |
| 历史编排 | `src/mock/data/historySchedules.json` | 2 天 | 已含 duration 字段 |

**关键事实**：
- `programDefinitions.json` 本身**没有 duration 字段**，时长只存在于 `finishedProducts.json` 的成品实例级别。所谓"节目时长"指成品 duration。
- `ProgramDefinition` 类型（`src/types/orchestration.ts` L358-363）也只有 4 个字段，与数据一致。

## 三、真实情况参照表（电视节目形态）

| programType | 真实时长规律 | 对应秒数 |
|-------------|-------------|---------|
| news 新闻 | 30 / 60 min | 1800 / 3600 |
| news_magazine 资讯/杂志 | 30 / 45 / 60 / 90 min | 1800 / 2700 / 3600 / 5400 |
| drama 电视剧（标准剧） | 45 min/集 | 2700 |
| drama 微短剧合集 | 30 min/期（含多集） | 1800 |
| entertainment 综艺/娱乐 | 30 / 60 / 90 / 120 min | 1800 / 3600 / 5400 / 7200 |
| entertainment 娱乐快讯 | 15 min | 900 |
| health 健康/养生 | 15 / 30 min | 900 / 1800 |
| commentary 评论/访谈 | 30 / 45 / 60 min | 1800 / 2700 / 3600 |
| kids 少儿 | 30 min | 1800 |
| documentary 纪录片 | 30 / 60 min | 1800 / 3600 |
| 导视/预告/暖场短片 | 10 min | 600 |

## 四、核查发现的问题清单

### 4.1 分类一致性（已通过）
- 节目 `programType` 与栏目 `defaultProgramType` **完全一致**（0 不一致）。
- 节目 `columnId` 全部存在于栏目表（0 孤儿）。
- 成品 `programId` 全部存在于节目定义表（0 孤儿）。

### 4.2 时长问题（核心）

按 programType 统计成品 duration 分布：

| programType | 期数 | duration 种类 | 评估 |
|-------------|------|--------------|------|
| news | 323 | 1800 | ✓ 合理 |
| news_magazine | 370 | 600 / 1800 / 2700 / 3000 / 3600 | ⚠ 含 600s 导视片与 3000s 直播，分类与时长搭配存疑 |
| kids | 51 | 1800 | ✓ 合理 |
| drama | 848 | 1800 / 2700 | ⚠ 112/113/119 长时段剧场为 2700s（合理）；120/121/124 为 1800s（待确认） |
| health | 63 | 900 / 1800 | ✓ 合理（对应 15/30min 时段） |
| entertainment | 61 | 900 / 1800 | ✓ 合理（对应 15/30min 时段） |
| commentary | 147 | 1800 | ✓ 合理 |
| documentary | 60 | 1800 | ✓ 合理 |

### 4.3 具体问题节目（32 组，按 programId 聚合）

#### 问题组 A：G132xxx 户外直播系列（4 个节目 × 6 期 = 24 条成品）
- 现状：`programType=news_magazine`，`duration=3000`（50min）
- 问题：50 分钟不是标准时长；户外直播/慢直播真实情况为 60 分钟。
- 栏目：101 看东方（07:00–09:00，120min 时段）。

#### 问题组 B：G131xxx 导视/预告系列（8 个节目 × 8 期 = 64 条成品）
- 现状：`programType=news_magazine`，`duration=600`（10min）
- 问题：导视/预告/暖场短片归为"新闻杂志"分类不准确；时长 10min 本身符合短片形态。
- 栏目：101 看东方。

#### 问题组 C：G120xxx 东方看大剧系列（4 个节目 × 12 期 = 48 条成品）
- 现状：`programType=drama`，`duration=1800`（30min）
- 问题：30 分钟时段放不下标准 45 分钟电视剧；"东方看大剧"本质是剧集资讯/幕后类栏目，非标准剧播放。
- 栏目：120 东方看大剧（21:00–21:30，30min）。

#### 问题组 D：G121xxx 品质东方微短剧系列（5 个节目 × 16 期 = 80 条成品）
- 现状：`programType=drama`，`duration=1800`（30min）
- 评估：微短剧每集 1–10 分钟，30 分钟"一期合集"形态可接受；分类 drama（微短剧也是剧）可保留。
- 栏目：121 品质东方微短剧（21:30–22:00，30min）。

#### 问题组 E：G124xxx 梦想剧场系列（5 个节目 × 24 期 = 120 条成品）
- 现状：`programType=drama`，`duration=1800`（30min）
- 评估：深夜 30 分钟剧场，播剪辑版/精华版，1800s 时长匹配时段；分类 drama 可保留。
- 栏目：124 梦想剧场（23:30–24:00，30min）。

#### 问题组 F：P105001 名医话养生（3 期）、P106001 东方新娱乐（1 期）
- 现状：含 900s（15min）期。
- 评估：对应版面 17:30–17:45（entertainment）、17:45–18:00（health）15 分钟时段，**合理保留**。

### 4.4 历史编排对照（已合理）
`historySchedules.json` 中 drama 节目 duration 已为 2700s（如"品质剧场：纵有疾风起 第4集" 09:30–10:15=45min），证明 2700s 是项目已采用的标准电视剧时长。修正方向应与之对齐。

## 五、修正方案（推荐）

### 5.1 时长修正（`finishedProducts.json`）

| 修正项 | 现状 | 修正值 | 影响条数 | 理由 |
|--------|------|--------|---------|------|
| G132xxx 户外直播 | 3000s | **3600s** | 24 | 对齐 60min 标准直播时长 |
| G120xxx 东方看大剧 | 1800s | 保留 | 48 | 30min 栏目时段匹配，配合分类修正 |
| G121xxx 微短剧 | 1800s | 保留 | 80 | 30min 微短剧合集形态合理 |
| G124xxx 梦想剧场 | 1800s | 保留 | 120 | 30min 深夜剪辑版，时长匹配时段 |
| G131xxx 导视系列 | 600s | 保留 | 64 | 10min 导视短片时长合理，配合分类修正 |
| P105001 / P106001 900s 期 | 900s | 保留 | 少量 | 15min 时段合理 |

### 5.2 分类修正（`programDefinitions.json` + `columns.json` 联动）

| 修正项 | 现状 | 修正值 | 影响范围 | 理由 |
|--------|------|--------|---------|------|
| 120 东方看大剧栏目 | defaultProgramType=`drama` | **`entertainment`** | columns.json 1 条 + programDefinitions.json 5 条（P120001, G120001–004） | 剧集资讯/幕后类栏目，非标准剧播放；对齐"剧集娱乐"定位 |
| G131xxx 导视系列节目 | programType=`news_magazine` | **保留 `news_magazine`**（推荐） | — | 栏目 101 即 news_magazine，保持栏目内分类一致；导视属资讯大类可接受 |
| 121 微短剧 / 124 梦想剧场 | `drama` | 保留 | — | 微短剧/深夜剪辑版归 drama 可接受 |

> 备选：若用户认为 G131xxx 应更精确，可改为 `commentary`（导视/预告偏评论解说性质），但会与栏目 101 的 `defaultProgramType=news_magazine` 不一致（打破 4.1 的一致性）。不推荐。

### 5.3 不改动的部分（已合理）
- news / kids / commentary / documentary 全部时长。
- 112 品质剧场、113 经典剧场、119 东方剧场 的 drama 2700s（已合理）。
- health / entertainment 的 900s / 1800s（对应 15/30min 时段）。
- 数据结构、字段、类型定义。

## 六、影响范围与风险评估

### 6.1 业务链路影响
- **候选检索 `matchesDuration`**（`src/services/candidateService.ts` L1482-1491）：有 columnId 时只要求 `candidate.duration <= expectedDuration.max`。
  - G132 改 3600s 后：101 栏目时段 120min（max=7200s），3600 ≤ 7200 ✓ 可检索。
  - G120 改 entertainment 后：120 栏目 30min（max=1800s），候选 1800 ≤ 1800 ✓ 可检索。
  - 无候选被过滤风险。
- **人气评分 `buildCandidatePopularityMetrics`**（`src/mock/orchestrationMock.ts` L206）：`durationBonus` 要求 1800–3600。
  - G132 改 3600s 后进入 bonus 区间（原 3000s 也在区间，无负面影响）。
  - G131 600s 不在 bonus 区间（保持原状，无变化）。
- **历史编排对照**：historySchedules 已用 2700s，修正方向与之对齐，无冲突。

### 6.2 测试影响
- `src/mock/__tests__/orchestrationMock.test.ts`：仅检查 `duration > 0` 与 short_clip `duration <= 60`，不硬编码具体值。✓ 不破坏。
- `src/services/__tests__/` 全目录：无对 1800/2700/3000/600/900 的硬编码断言。✓ 不破坏。
- 仍需在实现后运行 `npm run agent:check` 与 mock 测试复核。

### 6.3 风险点
1. **G132 改 3600s**：101 栏目 120min 时段，若编排需要 4 个 30min 节目填满，改为 60min 后只需 2 个，可能影响编排密度——但这是真实形态，编排逻辑应能处理。
2. **120 改 entertainment**：需同步改 `columns.json` 与 `programDefinitions.json`，若遗漏会导致分类不一致（4.1 检查会失败）。实现时需联动校验。
3. **不动结构**：本方案严格不改字段结构，符合用户约束。

## 七、验证方式

1. **数据一致性校验**：重跑核查脚本，确认：
   - 节目 programType 与栏目 defaultProgramType 一致性 = 100%。
   - 各 programType 的 duration 分布符合真实情况参照表。
   - 无孤儿节目 / 孤儿成品。
2. **业务测试**：`npm run agent:check`（含 `orchestrationMock.test.ts`）通过。
3. **编排冒烟**：在 `http://localhost:5173` 触发一次黄金档剧场编排，确认 119/112/113 剧场能用 2700s 候选正常填充。
4. **构建检查**：`npm run build` 通过（JSON 改动不涉及 TS 编译，但需确认导入正常）。

## 八、用户确认的关键决策（已确认）

| 决策点 | 用户决策 |
|--------|---------|
| G132 户外直播时长 | **改 3600s（60min）** |
| 120 东方看大剧分类 | **改 entertainment** |
| G131 导视系列 | **改为 short_video（短视频，用于轮播单，无编号，不排入电视播单）**；duration 保持 600s（业务上短视频该时长合理） |
| 121 微短剧 / 124 梦想剧场 | **保留 drama + 1800s** |

> 用户明确：短视频时长 600s 业务上无问题，且绝对不会被排入电视播单（无编号，只有轮播单会检索到）。现有测试 `duration <= 60` 约束需放宽以适配业务现实。

## 九、实施清单

- [x] 修正 `finishedProducts.json`：
  - G132xxx 系列 24 条：duration 3000 → 3600（保持 program_instance）。
  - G131xxx 系列 64 条：productKind `program_instance` → `short_video`；productId 改为 `asset-short-guide-{slug}-NN` 前缀；移除 programId/programCode/issueNo；补充 contentTags/descriptionText/visualDescription/shotBreakdown；duration 保持 600。
- [x] 修正 `programDefinitions.json`：删除 G131001–G131008 共 8 条；P120001、G120001–G120004 共 5 条 programType `drama` → `entertainment`。
- [x] 修正 `columns.json`：120 栏目 defaultProgramType `drama` → `entertainment`。
- [x] 修正 `src/mock/__tests__/orchestrationMock.test.ts`：short_video duration 上限 `<= 60` → `<= 600`（容纳 10 分钟轮播导视短片）。
- [x] 修正 `src/services/__tests__/demoRuntimeFacade.playlistState.test.ts`：测试关键词由 `静安寺外场直播导视`（原匹配 G131，已转 short_video）改为 `发布会预热导视`（匹配 G101009，仍为 program_instance）。
- [x] 重跑核查脚本，确认一致性与类型分布。
- [x] 运行 `npm run agent:check` 与 mock 测试。
- [x] 清理临时脚本（`scripts/tmp-mock-data-fix.mjs`、`scripts/tmp-mock-data-audit.mjs`）。
- [x] code-review-expert 检查并修复。

## 十、最终报告

### 10.1 修正结果

| 修正项 | 影响条数 | 结果 |
|--------|---------|------|
| G132 户外直播时长 3000→3600 | 24 | ✓ 全部 3600s |
| G131 导视系列转 short_video | 64 | ✓ 全部合规（contentTags≥12、shotBreakdown≥4、无节目编号/轮播/开场远景/远景/特写） |
| G131 节目定义删除 | 8 | ✓ programDefinitions 127 条，无孤儿 |
| 120 东方看大剧分类 drama→entertainment | 5 定义 + 1 栏目 | ✓ 分类一致性 100% |
| short_video duration 上限 60→600 | 测试 1 处 | ✓ |
| demoRuntimeFacade 测试关键词替换 | 测试 1 处 | ✓ needs_clarification 行为验证通过 |

### 10.2 验证结果

- **数据一致性校验**：分类一致性 100%（0 不一致），孤儿 program_instance 0 条，孤儿成品 0 条。
- **mock 测试**：10 passed / 0 failed。
- **agent:check**：730 passed / 1 failed / 32 skipped。
  - 唯一失败 `orchestrator.test.ts > 正式编排内容证据不足的开放意图时会保留空缺并记录专业门槛原因` 为**预存失败**（git stash 验证：本次数据修改前已失败），非本次改动引起。
- **code-review-expert**：65 passed / 0 failed，数据一致性✓、测试约束✓、无结构变更✓、业务逻辑✓。

### 10.3 残余风险

1. **预存测试失败**：`orchestrator.test.ts` 中"正式编排内容证据不足"测试在本次修改前已失败，根因与 `candidateJudge.ts` 的既有改动相关，不在本次 mock 数据修正范围内。
2. **浏览器冒烟未执行**：本次改动为数据字段值修正，未涉及前台交互逻辑，未运行浏览器冒烟。如需验证可刷新 `http://localhost:5173` 触发一次编排。
