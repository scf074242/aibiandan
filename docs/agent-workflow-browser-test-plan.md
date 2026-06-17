# Agent Workflow Browser Test Plan

更新时间：2026-06-14

## 目标

这份用例设计覆盖前台演示原型里的完整 agent 工作流，而不是只测试自然语言分类，也不是只测试版面草案展示。

当前主链路必须按以下闭环验收：

1. 用户在右侧 AI 助手输入自然语言。
2. 系统先判断是否为原子命令。
3. 非原子命令进入版面意图识别。
4. 生成或微调 `LayoutDraft`。
5. 结合节目库做候选可用性检查。
6. 用户确认版面后，草案注册为运行时版面。
7. 编排器按运行时版面查找候选、生成节目、补齐空窗。
8. 左侧实际编排单发生可验证变化。
9. 运行校验，确认无重叠、无非法时间、无负时长；如候选不足导致剩余空窗，必须明确列出待人工确认项。

当前开发阶段先收敛到播单创建、原子命令识别、电视/轮播策略分流、候选推荐确认/取消这条短链路；`补空窗` 与 `全天编排` 本质上都属于长流程，本轮不纳入 `agent:check` 的强制门禁。

## 审查结果页

### 审查结论

前一版方案存在明显偏差：B0 用例主要集中在“能否生成版面草案”，但没有把“版面草案到实际编排单”的过程作为强验收。因此该方案不能单独作为前台演示原型验收依据。

本次修订后，验收重心调整为：

- 草案生成只是前置步骤，不能算主流程完成。
- “按这个版面开始编排 / 确认版面”必须继续验证左侧实际编排单落表。
- “上传版面 Excel 后再对话”必须验证上传版面也能进入同一条实际编排链路。
- 原子命令必须在实际编排单存在后再测，避免只验证澄清和草案分流。
- 每条 B0 用例都要保留截图或 DOM 证据，失败后修复并重跑。

### 必须补强的问题

| 问题 | 风险 | 修订动作 |
|---|---|---|
| 只验证草案卡片，不验证左侧节目单 | 演示看起来有 AI 反馈，但没有真正生成编排单 | 增加 `draft-to-schedule-*` B0 强验收 |
| `layout_commit` 只验反馈文本 | 无法证明进入编排器和候选 materialize | 验证进度、候选类型、左侧新增节目 |
| 上传版面未进入 B0 | 真实业务常从版面 xls 开始，漏测主入口 | 增加 `uploaded-layout-to-schedule-*` |
| 原子命令只在无实际节目时测 | 无法证明实际编排后的二次编辑可用 | 增加 `atomic-after-generated-*` |
| 通过标准偏文字描述 | 难以复核 | 每个 B0 增加可观测断言 |

### 审查后准入标准

B0 用例通过必须同时满足：

1. 右侧对话区显示正确阶段反馈。
2. 草案卡片时段、类型、数量正确。
3. 确认草案后出现编排进度或完成反馈。
4. 左侧实际编排单新增、替换或保持范围外节目不变。
5. 新增节目来自当前节目库中对应类型候选。
6. 编排后校验没有重叠和非法时间。
7. 每条用例留存截图或 DOM 文本证据。

## 自动校验资产

- 自然语言结构化用例：`src/services/__tests__/fixtures/layoutIntentCommandCases.ts`
- 浏览器工作流用例：`src/services/__tests__/fixtures/agentWorkflowBrowserCases.ts`
- 浏览器上传版面样例：`test-fixtures/browser/smg-weekday-layout.xlsx`
- 参数化测试：`src/services/__tests__/layoutIntentCommandCases.test.ts`
- 自然语言用例数量：57
- 浏览器工作流用例数量：61
- 当前节目库候选数量：1667
- 非浏览器验证结果：61/61 通过

节目库覆盖：

| 类型 | 候选数 |
|---|---:|
| news | 323 |
| news_magazine | 114 |
| kids | 51 |
| drama | 848 |
| health | 63 |
| entertainment | 61 |
| commentary | 147 |
| documentary | 60 |

## 前置数据审查结果

本轮审查发现：浏览器用例不能只写“预期 UI 结果”，还必须明确页面状态、节目库数据、上传文件、草案上下文和实际编排单上下文。否则用例失败时无法判断是产品链路问题，还是测试数据没有准备好。

### 已补强的数据条件

| 用例类型 | 必备前置数据 | 准备方式 |
|---|---|---|
| 基础草案 | 东方卫视频道、固定测试日期、左侧节目单基线 | 每条用例执行前刷新页面，记录节目数量、时段和名称 |
| 草案微调 | 已存在待确认草案 | 不依赖上一条用例，执行本用例前先输入指定草案生成命令 |
| 草案删除 | 已存在包含目标时段的草案 | 本用例 setup 明确先生成包含 06:00 段的多段草案 |
| 草案确认落表 | 对应节目类型候选足够 | 每条用例声明候选数量阈值，例如 drama 不少于 250 条 |
| 上传版面 | 固定版面 Excel 文件 | 使用 `test-fixtures/browser/smg-weekday-layout.xlsx`，命中 `2026-03-25` 的 `Wednesday` 工作表 |
| 全天生成 | 左侧节目单为空 | 执行前通过页面清空或重置，确认节目数量为 0 |
| 局部补排 | 上午已有节目、下午有空窗 | setup 中要求记录上午基线并清出下午空窗 |
| 编排后原子命令 | 左侧已有实际节目 | setup 中先执行可复现的生成步骤，再执行删除或插入 |
| 编排后分析/校验 | 左侧实际节目不少于 3 条 | setup 中先完成多段或全天编排，再记录分析前节目数量 |

### 审查中发现并修正的问题

| 问题 | 原风险 | 修正 |
|---|---|---|
| “已存在草案”写得太笼统 | 用例依赖上一个用例执行结果，无法独立复现 | 每条草案微调用例增加独立 setupSteps |
| “已完成一次实际编排”写得太笼统 | 原子命令和分析类用例没有稳定上下文 | 明确先执行指定生成用例，并记录左侧节目单基线 |
| 上传版面缺少真实文件 | B0 上传用例无法实际跑通 | 新增固定样例 `smg-weekday-layout.xlsx` |
| 上传文件格式未验证 | 浏览器执行时才暴露格式错误 | 已用 `LayoutImportService` 验证可识别为 `weekday_sheet` |
| 左侧节目单“不变”缺少基线 | 无法证明没有被误改 | setup 要求记录执行前节目数量、时段和名称 |
| 局部补排缺少保护数据 | “上午保持不变”无法验证 | setup 要求记录上午节目 id、时间、名称 |

### 前置状态执行矩阵

为避免把“用例失败”和“测试数据没准备好”混在一起，浏览器用例按前置状态分层执行：

| 前置状态 | 可独立跑 | 覆盖用例 | 必须先确认 |
|---|---:|---|---|
| `clean_page_baseline` | 是 | 草案生成、模糊澄清、空草案提交、原子追问 | 固定频道日期；清空右侧上下文；记录左侧基线 |
| `seeded_layout_draft` | 是 | 草案微调、草案删除、微调后落表 | 本用例 setup 内先生成指定草案，不依赖上一条用例 |
| `uploaded_layout_pending` | 是 | 上传版面落表、上传版面微调后落表 | `smg-weekday-layout.xlsx` 可上传且命中 `Wednesday` |
| `empty_schedule` | 是 | 全天空表生成 | 左侧实际节目数量为 0，核心节目类型候选可用；候选不足时必须明确进入人工确认出口 |
| `generated_schedule` | 否 | 删除、插入、校验、分析 | 先完成指定生成用例，让左侧实际节目不少于 3 条 |
| `protected_partial_schedule` | 是，通过 setup 造数 | 局部补排与范围保护 | 本用例内先生成上午保护基线，再确认下午为空窗 |

### B0 前置条件二次审查

本次重点复核每条 B0 是否有可执行的前置路径。结论是：大部分用例可以独立刷新后执行；少数用例必须在本用例 setup 内先造出草案或实际编排单；上传类用例还受真实浏览器文件选择能力限制。

| ID | 前置判定 | 需要先准备什么 | 审查结论 |
|---|---|---|---|
| layout-draft-prepare-afternoon-drama | 已就绪 | 固定频道日期、记录左侧基线、drama 候选 | 可独立跑 |
| layout-draft-refine-evening-news | 需造草案 | 先输入“晚间排入综艺节目”生成待确认草案 | setup 内造数，不依赖上一条用例残留 |
| layout-draft-remove-segment | 需造草案 | 先输入“上午新闻，下午剧场，晚间综艺” | setup 内造数，删除对象限定为草案段 |
| layout-draft-clarify-vague | 已就绪 | 无待确认草案、无上传版面 | 可独立跑 |
| draft-to-schedule-afternoon-drama | 已就绪 | drama 候选、13:00-18:00 可写入 | 可独立跑，必须验证左侧落表 |
| draft-to-schedule-multi-segment | 已就绪 | news/drama/entertainment 候选 | 可独立跑，必须验证三段实际落表 |
| draft-to-schedule-documentary | 已就绪 | documentary 候选、22:00-23:00 可写入 | 可独立跑，可作为删除原子命令种子 |
| draft-refine-to-schedule-news | 需造草案 | 先生成晚间综艺草案，再微调为新闻 | setup 内造数，必须验证最终落表类型为新闻 |
| uploaded-layout-to-schedule-current-date | 工具受限 | `smg-weekday-layout.xlsx`、浏览器能选择本地文件 | 服务层已验文件可解析；真实浏览器需单独确认上传动作 |
| uploaded-layout-refine-to-schedule | 工具受限 | 上传版面待确认、health 候选 | 同上，还要验证上传后微调再落表 |
| full-fill-all-day-to-schedule | 已就绪 | 左侧节目单为 0、核心节目类型候选 | 可独立跑；候选不足时必须有人工确认出口 |
| partial-gap-fill-to-schedule | 需造实际节目 | 先生成上午新闻实际节目并记录保护基线，下午保持空窗 | 已修正为 setup 内造数，不再依赖上一条用例残留 |
| commit-without-draft | 已就绪 | 无待确认草案、无上传版面 | 可独立跑 |
| atomic-after-generated-delete | 需造实际节目 | 先生成 22:00-23:00 纪录片实际节目 | 删除对象限定为实际节目，不是草案 |
| atomic-after-generated-insert | 需造实际节目 | 先生成一份实际节目单，确认 10:00 附近可插入 | 插入必须命中实际编排上下文 |
| validate-after-generated | 需造实际节目 | 先完成多段或全天编排，记录节目数量 | 校验对象必须是左侧实际编排单 |
| analysis-after-generated | 需造实际节目 | 先完成多段或全天编排，记录节目数量 | 分析对象必须是左侧实际编排单 |
| clarify-vague-layout | 已就绪 | 无待确认草案、无上传版面 | 与 layout-draft-clarify-vague 重复覆盖，可保留作回归哨兵 |
| atomic-fallback-shift | 已就绪 | 无草案；若目标不明确则允许追问 | 可独立跑，重点验证不误进草案 |
| playlist-state-chat-create-tv | 已就绪 | 页面处于未创建播单空态，AI 助手快捷命令可见 | 验证聊天入口创建播单后父页面切换为电视播单状态 |
| playlist-state-reject-atomic-before-create | 已就绪 | 页面处于未创建播单空态，AI 助手快捷命令可见，且不要先创建播单 | 直接点击插入节目时必须拒绝，提示先新建播单，左侧空态保持不变 |
| playlist-state-chat-create-rotation | 已就绪 | 页面处于未创建播单空态，AI 助手快捷命令可见 | 验证聊天入口创建轮播单后父页面切换为轮播单状态并默认内容匹配优先 |
| playlist-policy-rotation-switch-rating | 已就绪 | 先通过 AI 助手创建轮播单，输入框可用 | 轮播单允许切换为收视率优先，不改左侧节目单，不进入候选推荐 |
| playlist-policy-rotation-switch-trending | 已就绪 | 先通过 AI 助手创建轮播单，输入框可用 | 轮播单允许切换为热播优先，不改左侧节目单，不进入候选推荐 |
| playlist-policy-tv-reject-rotation-strategy | 已就绪 | 先通过 AI 助手创建电视播单，输入框可用 | 电视播单拒绝切换热播/收视率/内容匹配等轮播策略，左侧不变 |
| playlist-policy-tv-insert-direct | 已就绪 | 先通过 AI 助手创建电视播单，看东方候选可检索 | 电视播单插入节目直接落表，不展示候选确认 |
| playlist-policy-rotation-insert-recommendation | 已就绪 | 先通过 AI 助手创建轮播单，看东方相似候选可检索 | 轮播单插入节目返回候选推荐，确认前不落表 |
| playlist-policy-rotation-insert-cancel | 已就绪 | 先通过 AI 助手创建轮播单并触发看东方插入推荐 | 点击取消后不写入左侧节目单，推荐上下文清空 |
| playlist-policy-tv-replace-direct | 已就绪 | 先通过 AI 助手创建电视播单并插入 09:00 看东方，东方新闻候选可检索 | 电视播单替换节目直接落表，不展示候选确认 |
| playlist-policy-rotation-replace-recommendation | 已就绪 | 先通过 AI 助手创建轮播单并确认插入 09:00 看东方，东方新闻相似候选可检索 | 轮播单替换节目返回候选推荐，确认前不落表 |
| playlist-policy-rotation-replace-confirm-execute | 已就绪 | 先通过 AI 助手创建轮播单并确认插入 09:00 看东方，再触发东方新闻替换推荐 | 点击确认替换后真正替换左侧节目，推荐上下文清空 |
| playlist-policy-rotation-replace-cancel | 已就绪 | 先通过 AI 助手创建轮播单并确认插入 09:00 看东方，再触发东方新闻替换推荐 | 点击取消后不替换左侧节目单，推荐上下文清空 |
| playlist-policy-tv-delete-confirmation | 已就绪 | 先通过 AI 助手创建电视播单并插入 09:00 看东方 | 电视播单删除节目保持敏感确认，确认前不删除 |
| playlist-policy-rotation-delete-confirmation | 已就绪 | 先通过 AI 助手创建轮播单并确认插入 09:00 看东方 | 轮播单删除节目保持敏感确认，确认前不删除 |
| playlist-policy-tv-delete-confirm-execute | 已就绪 | 先通过 AI 助手创建电视播单并插入 09:00 看东方，再触发删除确认 | 点击确认执行后才真正删除节目，删除后待确认上下文清空 |
| playlist-policy-rotation-delete-cancel | 已就绪 | 先通过 AI 助手创建轮播单并确认插入 09:00 看东方，再触发删除确认 | 点击取消后不删除节目，取消后待确认上下文清空 |
| playlist-policy-tv-move-forward-direct | 已就绪 | 先通过 AI 助手创建电视播单并插入 09:00 看东方 | 电视播单移动节目直接落表，09:00 后移到 10:00，不得变为 08:00 |
| playlist-policy-rotation-move-forward-direct | 已就绪 | 先通过 AI 助手创建轮播单并确认插入 09:00 看东方 | 轮播单移动节目直接落表，09:00 后移到 10:00，不进入候选推荐 |
| playlist-policy-tv-move-backward-direct | 已就绪 | 先通过 AI 助手创建电视播单并插入 09:00 看东方，再后移到 10:00 | 电视播单前移节目直接落表，10:00 前移回 09:00，不得变为 11:00 |
| playlist-policy-rotation-move-backward-direct | 已就绪 | 先通过 AI 助手创建轮播单并确认插入 09:00 看东方，再后移到 10:00 | 轮播单前移节目直接落表，10:00 前移回 09:00，不进入候选推荐 |
| context-draft-persists-for-refine | 需造草案 | 先生成晚间综艺待确认草案 | 确认前草案上下文必须保留给下一轮微调 |
| context-commit-clears-layout-draft | 需造实际节目 | 先生成上午新闻实际节目，确认旧草案卡片消失 | 确认编排后 draft context 清空，schedule context 保留 |
| context-generated-schedule-used-after-commit | 需造实际节目 | 先完成一次编排并确认无待确认草案 | 后续校验/分析读取实际节目单上下文 |
| context-atomic-recommendation-clears-after-confirm | 需造实际节目 | 先触发插入推荐并确认候选 | 原子推荐上下文执行后必须清空 |
| context-upload-clear-removes-layout-reference | 工具受限 | 上传样例、清除当前版面参考 | 上传版面清除后 runtime layout context 必须消失 |

依赖型用例的默认执行顺序：

1. `draft-to-schedule-documentary` 先跑通后，再执行 `atomic-after-generated-delete`。
2. `draft-to-schedule-multi-segment` 先跑通后，再执行 `atomic-after-generated-insert`、`validate-after-generated`、`analysis-after-generated`。
3. `partial-gap-fill-to-schedule` 不再依赖上一条用例残留；本用例 setup 内先生成“上午新闻”实际节目作为保护基线，再执行下午补排。

### 当前工具限制说明

上传版面 B0 用例需要真实浏览器选择本地 xlsx 文件。服务层已经验证样例文件可解析，并补充验证了“上传版面确认提交”和“上传版面先微调再生成草案”的运行时链路；真实浏览器页面也能看到 `.xls/.xlsx` 上传入口。当前 Codex 浏览器运行时只发现 `Codex In-app Browser` 一个后端，没有可替代的 Chrome/CDP 后端；该 `iab` 后端对文件上传能力有限制，实测文件选择能力返回 `File uploads are not supported by Codex In-app Browser.`，不能自动把本地文件注入系统文件选择器。因此该动作不能被标记为产品失败，应记录为“浏览器工具上传动作受限”，并用服务层导入、提交、微调验证加页面入口可见证据补充。

### 上传样例文件说明

`test-fixtures/browser/smg-weekday-layout.xlsx` 是浏览器上传用例的固定样例：

- 工作表：`Wednesday`
- 测试日期：`2026-03-25`
- 解析模式：`weekday_sheet`
- 版面段数：9
- 覆盖类型：`news`、`news_magazine`、`drama`、`health`、`entertainment`、`documentary`

该文件中的栏目名用于测试导入链路，节目类型以 `programtype` 列为准；实际生成节目仍必须来自当前节目库候选。

## 能力分类视图

用例采用双维度管理：

- 执行维度：B0 必须真实浏览器执行，B1 浏览器抽样，B2 服务层自动回归。
- 能力维度：原子命令意图、版面草案、基于版面计划生成实际编排、特殊组合场景、上下文管理。

### C1：基础原子命令意图识别

目标是确认“插入、删除、移动、顺延、替换”等话术优先走原子命令链路，不被误判为版面草案。

代表用例：

| ID | 输入 | 验收重点 |
|---|---|---|
| atomic-fallback-shift | 把9点后那段顺一个 | 进入原子参数追问，不生成版面草案，不触发编排器 |
| atomic-after-generated-delete | 删除22点的节目 | 实际编排单存在后命中删除，不误走草案 |
| atomic-after-generated-insert | 在10点插入看东方 | 实际编排单存在后命中插入，目标节目类型正确 |
| atomic-fallback-delete | 删除那个节目 | 服务层保持原子参数澄清，不静默删除错误节目 |

### C2：版面草案能力

目标是确认自然语言能形成可编辑、可确认、可拒绝的草案，但草案阶段不能直接改左侧实际节目单。

代表用例：

| ID | 输入 | 验收重点 |
|---|---|---|
| layout-draft-prepare-afternoon-drama | 不参考版面，下午排入电视剧 | 只出现 13:00-18:00 草案，左侧不变 |
| layout-draft-refine-evening-news | 晚上全部替换成新闻栏目 | 已有草案时只更新草案晚间段 |
| layout-draft-remove-segment | 删除6点的草案 | 删除草案段，不删除实际节目 |
| layout-draft-clarify-vague | 帮我做一个版面 | 信息不足时澄清，不生成错误草案 |

### C3：基于版面计划生成实际编排

目标是确认“版面计划”能真正进入运行时编排器，最终让左侧实际编排单落表。

代表用例：

| ID | 输入 | 验收重点 |
|---|---|---|
| draft-to-schedule-afternoon-drama | 不参考版面，下午排入电视剧；按这个版面开始编排 | 13:00-18:00 实际生成电视剧节目 |
| draft-to-schedule-multi-segment | 上午新闻，下午剧场，晚间综艺；确认版面 | 三段草案分别生成对应类型节目 |
| uploaded-layout-to-schedule-current-date | 上传版面 Excel；按这个版面开始编排 | 上传版面也能驱动实际编排 |
| full-fill-all-day-to-schedule | 帮我填充全天节目；确认版面 | 空表全天生成实际节目单；如未全自动填满，必须列出待人工确认空窗 |

### C4：特殊组合场景

目标是考察真实演示中更容易出问题的多轮、混合、范围保护和后置分析。

代表用例：

| ID | 输入 | 验收重点 |
|---|---|---|
| uploaded-layout-refine-to-schedule | 上传版面 Excel；下午改成健康养生；确认版面 | 上传版面可微调后再实际落表 |
| partial-gap-fill-to-schedule | 保留现有上午节目，下午补齐电视剧；确认版面 | 下午补排，上午保持不变 |
| validate-after-generated | 检查当前编排问题 | 基于实际节目单校验，不生成草案 |
| analysis-after-generated | 请分析当前版面编排，给我一份业务分析报告 | 基于实际编排输出分析 |

### C5：上下文管理

目标是确认 agent 在多轮流程里正确管理“记住”和“忘掉”的边界。上下文不是越多越好：草案确认前要保留给微调，确认进入实际编排后必须清理；实际编排单要成为后续原子命令、校验和分析的上下文；原子推荐、上传版面、待确认动作在完成、取消或清除后不能继续污染下一轮。

代表用例：

| ID | 输入 | 验收重点 |
|---|---|---|
| context-draft-persists-for-refine | 晚间排入综艺节目；晚上全部替换成新闻栏目 | 确认前草案上下文保留，可被下一轮微调读取 |
| context-commit-clears-layout-draft | 上午新闻确认编排后；保留现有上午节目，下午补齐电视剧 | 确认编排后旧草案上下文清空，实际节目上下文保留 |
| context-generated-schedule-used-after-commit | 完成一次实际编排后；检查当前编排问题 | 后续校验读取左侧实际编排单，不回读已确认草案 |
| context-atomic-recommendation-clears-after-confirm | 在10点插入看东方；确认候选；再校验 | 原子推荐确认后清空，不阻塞下一轮命令 |
| context-upload-clear-removes-layout-reference | 上传版面；清除；下午排入电视剧 | 上传版面清除后不再影响后续 AI 草案 |

## 真实 Codex 浏览器测试分级

### B0：必须浏览器端执行

这些用例需要确认真实 UI 状态、右侧 AI 消息、草案卡片、编排进度、左侧表格、高亮或校验结果是否出现。

| 分类 | ID | 用户输入 | 主验收点 |
|---|---|---|---|
| 版面草案 | layout-draft-prepare-afternoon-drama | 不参考版面，下午排入电视剧 | 只出现草案；左侧节目单不变 |
| 版面草案 | layout-draft-refine-evening-news | 晚上全部替换成新闻栏目 | 已有草案时只更新草案；左侧不变 |
| 版面草案 | layout-draft-remove-segment | 删除6点的草案 | 删除草案段，不删除实际节目 |
| 版面草案 | layout-draft-clarify-vague | 帮我做一个版面 | 出现澄清问题，不生成错误草案 |
| 基于版面计划 | draft-to-schedule-afternoon-drama | 不参考版面，下午排入电视剧；再输入：按这个版面开始编排 | 草案覆盖 13:00-18:00；确认后左侧生成电视剧/剧场节目 |
| 基于版面计划 | draft-to-schedule-multi-segment | 上午新闻，下午剧场，晚间综艺；再输入：确认版面 | 草案 3 段正确；确认后左侧分别填入新闻、电视剧、综艺候选 |
| 基于版面计划 | draft-to-schedule-documentary | 22:00到23:00排入纪录片；再输入：确认版面 | 22:00-23:00 实际生成纪录片节目 |
| 基于版面计划 | draft-refine-to-schedule-news | 晚间排入综艺节目；再输入：晚上全部替换成新闻栏目；再输入：确认版面 | 微调后再落表，晚间生成新闻节目 |
| 基于版面计划 | uploaded-layout-to-schedule-current-date | 上传版面 Excel 后输入：按这个版面开始编排 | 上传版面命中当前日期或星期；确认后按上传版面生成左侧实际编排单 |
| 特殊组合 | uploaded-layout-refine-to-schedule | 上传版面 Excel 后输入：下午改成健康养生；再输入：确认版面 | 上传版面可被自然语言微调；确认后下午实际节目变为健康类型 |
| 基于版面计划 | full-fill-all-day-to-schedule | 帮我填充全天节目；再输入：确认版面 | 从空表生成全天草案；确认后左侧节目数明显增加，流程必须退出思考中/中止状态 |
| 特殊组合 | partial-gap-fill-to-schedule | 保留现有上午节目，下午补齐电视剧；再输入：确认版面 | 只改下午空窗；上午已有节目保持不变 |
| 版面草案 | commit-without-draft | 按这个版面开始编排 | 当前没有草案时拒绝提交；左侧节目单不变 |
| 原子命令 | atomic-after-generated-delete | 先完成一次实际编排；再输入：删除22点的节目 | 命中原子删除；不误走草案 |
| 原子命令 | atomic-after-generated-insert | 先完成一次实际编排；再输入：在10点插入看东方 | 命中原子插入；左侧 10 点附近出现相关节目 |
| 特殊组合 | validate-after-generated | 先完成一次实际编排；再输入：检查当前编排问题 | 输出实际编排校验/业务问题；不生成新版面草案 |
| 特殊组合 | analysis-after-generated | 先完成一次实际编排；再输入：请分析当前版面编排，给我一份业务分析报告 | 基于实际节目单输出分析；不只分析草案 |
| 版面草案 | clarify-vague-layout | 帮我做一个版面 | 出现澄清问题，不静默生成错误草案，不改左侧节目单 |
| 原子命令 | atomic-fallback-shift | 把9点后那段顺一个 | 出现原子参数澄清，不进入版面草案，不改左侧节目单 |
| 原子命令 | playlist-state-chat-create-tv | 点击 AI 助手里的“新建电视播单”快捷命令 | AI 返回电视播单创建结果；左侧空态消失并展示时间轴 |
| 原子命令 | playlist-state-reject-atomic-before-create | 未创建播单时点击 AI 助手里的“插入节目”快捷命令 | AI 提示先新建电视播单或轮播单；左侧仍显示“先创建播单”；不出现候选卡或实际节目 |
| 原子命令 | playlist-state-chat-create-rotation | 点击 AI 助手里的“新建轮播单”快捷命令 | AI 返回轮播单创建结果；左侧空态消失并展示时间轴，默认内容匹配优先 |
| 原子命令 | playlist-policy-rotation-switch-rating | 新建轮播单后输入“按收视率优先” | AI 返回收视率优先策略切换结果；左侧节目数不变；不出现候选卡 |
| 原子命令 | playlist-policy-rotation-switch-trending | 新建轮播单后输入“后面按热播优先” | AI 返回热播优先策略切换结果；左侧节目数不变；不出现候选卡 |
| 原子命令 | playlist-policy-tv-reject-rotation-strategy | 新建电视播单后输入“按热播优先” | AI 拒绝切换轮播策略；左侧节目数不变；不进入草案或候选 |
| 原子命令 | playlist-policy-tv-insert-direct | 新建电视播单后点击“插入节目”快捷命令 | 直接在左侧 09:00 写入看东方相关节目，不出现候选确认 |
| 原子命令 | playlist-policy-rotation-insert-recommendation | 新建轮播单后点击“插入节目”快捷命令 | 右侧展示插入推荐和确认按钮，左侧节目数保持 0 |
| 原子命令 | playlist-policy-rotation-insert-cancel | 新建轮播单并触发看东方插入推荐后点击“取消” | 左侧节目数保持 0，插入推荐卡片消失 |
| 原子命令 | playlist-policy-tv-replace-direct | 新建电视播单并插入 09:00 看东方后点击“替换节目”快捷命令 | 直接将左侧 09:00 节目替换为东方新闻，不出现候选确认 |
| 原子命令 | playlist-policy-rotation-replace-recommendation | 新建轮播单并确认插入 09:00 看东方后点击“替换节目”快捷命令 | 右侧展示替换推荐和确认按钮，确认前左侧 09:00 原节目不变 |
| 原子命令 | playlist-policy-rotation-replace-confirm-execute | 新建轮播单并触发替换推荐后选择东方新闻候选，再点击“确认替换” | 左侧 09:00 节目变为东方新闻，替换推荐卡片消失 |
| 原子命令 | playlist-policy-rotation-replace-cancel | 新建轮播单并触发替换推荐后点击“取消” | 左侧 09:00 原节目保留，替换推荐卡片消失 |
| 原子命令 | playlist-policy-tv-delete-confirmation | 新建电视播单并插入 09:00 看东方后点击“删除节目”快捷命令 | 右侧展示删除确认，确认前左侧 09:00 原节目不变 |
| 原子命令 | playlist-policy-rotation-delete-confirmation | 新建轮播单并确认插入 09:00 看东方后点击“删除节目”快捷命令 | 右侧展示删除确认，确认前左侧 09:00 原节目不变 |
| 原子命令 | playlist-policy-tv-delete-confirm-execute | 新建电视播单并触发 09:00 删除确认后点击“确认执行” | 左侧节目数从 1 变为 0，确认卡片消失 |
| 原子命令 | playlist-policy-rotation-delete-cancel | 新建轮播单并触发 09:00 删除确认后点击“取消” | 左侧 09:00 原节目保留，确认卡片消失 |
| 原子命令 | playlist-policy-tv-move-forward-direct | 新建电视播单并插入 09:00 看东方后点击“后移节目”快捷命令 | 左侧节目起始时间变为 10:00，不出现候选或确认卡片 |
| 原子命令 | playlist-policy-rotation-move-forward-direct | 新建轮播单并确认插入 09:00 看东方后点击“后移节目”快捷命令 | 左侧节目起始时间变为 10:00，不进入节目候选推荐 |
| 原子命令 | playlist-policy-tv-move-backward-direct | 新建电视播单并把 09:00 看东方后移到 10:00，再点击“前移节目”快捷命令 | 左侧节目起始时间变回 09:00，不出现候选或确认卡片 |
| 原子命令 | playlist-policy-rotation-move-backward-direct | 新建轮播单并把 09:00 看东方后移到 10:00，再点击“前移节目”快捷命令 | 左侧节目起始时间变回 09:00，不进入节目候选推荐 |
| 上下文管理 | context-draft-persists-for-refine | 晚间排入综艺节目；再输入：晚上全部替换成新闻栏目 | 确认前草案上下文保留，第二轮能微调同一草案 |
| 上下文管理 | context-commit-clears-layout-draft | 上午新闻并确认编排；再输入：保留现有上午节目，下午补齐电视剧 | 旧草案上下文清空，上午实际节目作为保护基线，下午生成电视剧草案或补排 |
| 上下文管理 | context-generated-schedule-used-after-commit | 完成一次实际编排；再输入：检查当前编排问题 | 后续校验读取实际节目单，不回读已确认草案 |
| 上下文管理 | context-atomic-recommendation-clears-after-confirm | 在10点插入看东方；确认候选；再输入：检查当前编排问题 | 原子推荐确认后清空，下一轮命令不被旧推荐阻塞 |
| 上下文管理 | context-upload-clear-removes-layout-reference | 上传版面 Excel；清除当前版面参考；再输入：下午排入电视剧 | 上传版面上下文清除后不再影响后续 AI 草案 |

### B1：服务层已验证，浏览器抽样即可

这些用例在服务层已验证识别与节目库联动；浏览器中按类型抽样执行即可。

- 时间范围类：`prepare-*by-clock-range`
- 内容类型类：新闻、资讯、少儿、剧场、健康、综艺、评论、纪录片
- 多段草案类：`segments-*`
- 草案微调类：`refine-*`
- 版面确认类：`commit-*`
- 分析/优化类：`analysis-*`、`optimize-*`

### B2：非浏览器自动回归

这些适合稳定留在参数化测试里，作为快速回归：

- 每条用例的 `mode`
- `ignoreExistingLayout`
- `targetTimeRange`
- `programTypeHint`
- `segments`
- 节目库候选数量阈值

## 草案到实际编排强验收

每个 `draft-to-schedule-*` 和 `uploaded-layout-to-schedule-*` 用例都按同一执行协议验证：

1. 重置页面到固定频道、固定日期、固定初始节目单。
2. 输入第一条自然语言，生成或导入版面草案。
3. 记录右侧草案卡片中的覆盖范围、栏目段、节目类型。
4. 输入“确认版面”或点击“开始编排”。
5. 观察运行时编排进度，至少出现开始、补排、完成或错误反馈中的有效状态。
6. 等待左侧实际编排单刷新。
7. 校验新增节目时间范围与草案覆盖范围一致。
8. 校验新增节目类型与草案类型一致。
9. 校验草案范围外节目未被误删或误改。
10. 触发或观察校验结果，确认没有重叠、非法时间、负时长。
11. 若候选不足导致剩余空窗，确认页面已退出运行态，并明确显示待人工确认空窗。

失败判定：

- 只出现草案但左侧节目单没有变化，失败。
- 只出现“准备编排”文本但没有运行时进度或表格刷新，失败。
- 生成节目类型与草案类型明显不一致，失败。
- 草案范围外节目被重写，失败。
- 校验出现重叠、非法时间、负时长，失败。
- 候选不足时仍停留在“思考中”或“中止”状态，失败。
- 剩余空窗没有明确人工确认提示，失败。

## 浏览器执行协议

审查通过后，按以下流程在真实 Codex 浏览器中执行：

1. 启动本地前台原型。
2. 打开编排页面。
3. 确认频道为东方卫视、日期为测试日期。
4. 对 B0 用例逐条输入 AI 助手。
5. 每条用例记录：
   - 输入文本
   - 前置数据是否满足
   - setupSteps 是否已完成
   - AI 反馈文本
   - 是否出现草案卡片
   - 草案时段与类型是否正确
   - 是否进入运行时编排
   - 左侧节目单新增、删除、替换或保持不变的证据
   - 生成节目是否来自对应节目库候选
   - 是否出现确认、澄清、分析、原子追问或校验反馈
   - 截图或 DOM 证据
6. 任一用例失败：
   - 先判断是前置数据、识别、运行时还是 UI 展示问题。
   - 修复后重新跑该用例。
   - 最后重跑全量 B0。

## 本轮真实浏览器执行记录

执行环境：Codex 内置浏览器，`http://localhost:5173/`，东方卫视 `dragon`，日期 `2026-03-25`。

已跑通用例：

| ID | 结果 | 证据摘要 |
|---|---|---|
| layout-draft-prepare-afternoon-drama | 通过 | 右侧出现 13:00-18:00 电视剧草案，左侧保持 0 条 |
| layout-draft-refine-evening-news | 通过 | 先生成晚间综艺草案，再微调为新闻栏目，左侧不变 |
| layout-draft-remove-segment | 通过 | 删除 06:00 草案段，不删除实际节目 |
| layout-draft-clarify-vague | 通过 | 信息不足时提出澄清，不生成草案 |
| commit-without-draft | 通过 | 无草案时拒绝提交，左侧节目单不变 |
| atomic-fallback-shift | 通过 | 进入原子参数追问，不进入版面草案 |
| playlist-state-chat-create-tv | 通过 | 点击 AI 助手快捷命令“新建电视播单”后，右侧显示电视频道策略反馈，左侧空态消失并出现“时间轴与素材清单”“添加节目” |
| playlist-state-reject-atomic-before-create | 通过 | 真实浏览器已验证：未创建播单空态直接点击“插入节目”后，右侧提示“当前还没有创建播单”，要求先新建电视播单或轮播单；左侧仍显示“先创建播单”，未出现插入推荐或实际节目写入 |
| playlist-state-chat-create-rotation | 通过 | 点击 AI 助手快捷命令“新建轮播单”后，右侧显示内容匹配默认策略，左侧空态消失并出现“时间轴与素材清单”“添加节目” |
| playlist-policy-rotation-switch-rating | 通过 | 真实浏览器已验证：创建轮播单后输入“按收视率优先”，右侧显示已切换为收视率优先；左侧仍为 0 个节目，未出现插入/替换候选卡或草案 |
| playlist-policy-rotation-switch-trending | 通过 | 真实浏览器已验证：创建轮播单后输入“后面按热播优先”，右侧显示已切换为热播优先；左侧仍为 0 个节目，未出现插入/替换候选卡或草案 |
| playlist-policy-tv-reject-rotation-strategy | 通过 | 真实浏览器已验证：创建电视播单后输入“按热播优先”，右侧提示电视播单只允许电视频道编排策略，不能切换为轮播策略；左侧仍为 0 个节目，未出现候选卡或草案 |
| playlist-policy-tv-insert-direct | 通过 | 电视播单下点击“插入节目”后，左侧从 0 条变为 1 条，09:00-09:30 写入《看东方 特别策划：申城更新》，右侧无候选确认 |
| playlist-policy-rotation-insert-recommendation | 通过 | 轮播单下点击“插入节目”后，右侧显示 3 个看东方候选和“确认插入”，左侧保持 0 条未直接落表 |
| playlist-policy-rotation-insert-cancel | 通过 | 轮播单下触发 09:00 看东方插入推荐后点击“取消”，右侧显示已取消选择，左侧节目数保持 0，插入推荐卡片消失 |
| playlist-policy-tv-replace-direct | 通过 | 电视播单下先插入 09:00《看东方 特别策划：申城更新》，再点击“替换节目”，左侧 09:00 直接变为《东方新闻》，右侧无候选确认 |
| playlist-policy-rotation-replace-recommendation | 通过 | 轮播单下先确认插入 09:00 看东方，再点击“替换节目”，右侧显示 3 个东方新闻候选和“确认替换”，左侧 09:00 原节目保持不变 |
| playlist-policy-rotation-replace-confirm-execute | 通过 | 轮播单下先插入并确认 09:00《看东方 特别策划：申城更新》，再触发替换推荐并确认《东方新闻》，左侧 09:00 实际节目变为《东方新闻》，推荐卡片消失 |
| playlist-policy-rotation-replace-cancel | 通过 | 真实浏览器已验证：轮播单确认插入 09:00《看东方 特别策划：申城更新》后，触发东方新闻替换推荐并点击取消，左侧 09:00 仍保持原节目，未替换为东方新闻，推荐卡片消失 |
| playlist-policy-tv-delete-confirmation | 通过 | 电视播单下先插入 09:00《看东方 特别策划：申城更新》，再点击“删除节目”，右侧进入高风险确认，左侧仍保留 1 条节目 |
| playlist-policy-rotation-delete-confirmation | 通过 | 轮播单下先确认插入 09:00《看东方 特别策划：申城更新》，再点击“删除节目”，右侧进入高风险确认且不展示候选推荐，左侧仍保留 1 条节目 |
| playlist-policy-tv-delete-confirm-execute | 通过 | 电视播单下先触发 09:00《看东方 特别策划：申城更新》删除确认，再点击“确认执行”，左侧节目数变为 0，确认卡片消失 |
| playlist-policy-rotation-delete-cancel | 通过 | 轮播单下先触发 09:00《看东方 特别策划：申城更新》删除确认，再点击“取消”，左侧仍保留 1 条节目，确认卡片消失且无空对象错误 |
| playlist-policy-tv-move-forward-direct | 通过 | 电视播单下先插入 09:00《看东方 特别策划：申城更新》，再点击“后移节目”，左侧起始时间变为 10:00，未出现候选或确认卡 |
| playlist-policy-rotation-move-forward-direct | 通过 | 轮播单下先确认插入 09:00《看东方 特别策划：申城更新》，再点击“后移节目”，左侧起始时间变为 10:00，未进入候选推荐 |
| playlist-policy-tv-move-backward-direct | 通过 | 电视播单下先把 09:00《看东方 特别策划：申城更新》后移到 10:00，再点击“前移节目”，左侧起始时间变回 09:00，未出现候选或确认卡 |
| playlist-policy-rotation-move-backward-direct | 通过 | 轮播单下先把 09:00《看东方 特别策划：申城更新》后移到 10:00，再点击“前移节目”，左侧起始时间变回 09:00，未进入候选推荐 |
| draft-to-schedule-afternoon-drama | 通过 | 确认草案后左侧 13:00-18:00 生成 21 条实际节目/广告 |
| full-fill-all-day-to-schedule | 通过，带人工确认出口 | 空表生成全天草案；确认后左侧 0 条变 57 条；流程退出思考中/中止状态；剩余 1 个空窗明确提示待人工确认 |
| validate-after-generated | 通过 | 基于 57 条实际节目单输出校验结果，节目数量不变 |
| analysis-after-generated | 通过 | 基于 57 条实际节目单输出业务分析，节目数量不变 |
| atomic-after-generated-delete | 通过到确认态 | 定位 22:00 实际节目《今晚观察 第1期》，展示高风险确认卡片，未误进草案 |
| draft-to-schedule-multi-segment | 通过 | 确认草案后左侧生成 51 条节目，上午新闻、下午电视剧、晚间综艺均落表，无硬性时间问题 |
| draft-to-schedule-documentary | 通过 | 22:00-23:00 生成 2 条《东方纪实》纪录片节目，无递归更新错误 |
| draft-refine-to-schedule-news | 通过 | 晚间综艺草案微调为新闻后确认，左侧 18:00-23:00 生成 18 条新闻节目 |
| atomic-after-generated-insert | 通过 | 选择“看东方 特别策划：申城更新”后确认插入，左侧出现 10:00-10:30 实际节目 |
| context-commit-clears-layout-draft | 通过 | 上午新闻确认编排后旧草案卡片消失；下一轮“下午补齐电视剧”不复用旧上午草案 |
| partial-gap-fill-to-schedule | 通过 | 先生成上午 20 条新闻保护基线，再补下午电视剧；上午节目 id/时间/名称不变，下午新增 21 条电视剧/广告节目 |
| context-generated-schedule-used-after-commit | 通过 | 编排完成后输入“检查当前编排问题”，无草案卡片和插入推荐阻塞，基于 41 条实际节目单校验 |
| context-atomic-recommendation-clears-after-confirm | 通过 | 12:00 插入《看东方 特别策划：申城更新》后推荐卡片消失；下一轮校验正常执行，节目数保持 42 条 |

待继续执行或需工具能力确认：

| ID | 状态 | 原因 |
|---|---|---|
| uploaded-layout-to-schedule-current-date | 工具受限，服务层通过 | 真实浏览器页面存在 `.xls/.xlsx` 上传入口；当前内置浏览器不支持自动文件上传；服务层已验证样例 xlsx 可解析，并可生成 uploaded layout_commit |
| uploaded-layout-refine-to-schedule | 工具受限，服务层通过 | 同上；服务层已验证上传版面可先把下午微调为 health uploaded 草案；落表需在可驱动文件选择的浏览器或人工演示中补验 |
| context-upload-clear-removes-layout-reference | 工具受限，服务层通过 | 依赖真实浏览器上传动作；上传入口可见，样例文件服务层可解析；上传清除上下文需在可上传浏览器中补验 |

## 审查点

请重点审查：

1. 五类能力划分是否符合你预期：原子命令、版面草案、基于版面计划、特殊组合、上下文管理。
2. B0 用例是否已经覆盖“草案到实际编排单”的真实演示路径。
3. 上传版面 Excel 后再对话、再确认、再落表的路径是否符合你的业务预期。
4. “确认版面后实际填充左侧节目单”的强验收是否足够严格。
5. 原子命令是否应该继续扩大到移动、替换、顺延等二次编辑。
6. 上下文边界是否足够严格：确认后清草案、执行后清原子推荐、清除上传版面后不再影响下一轮。
7. 是否要把某些 B1 抽样用例提升为 B0 必跑。
