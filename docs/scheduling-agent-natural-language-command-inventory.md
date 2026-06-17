# Scheduling Agent 自然语言命令清单

目标：从专业节目编排员视角沉淀 Agent Core v1 需要兜住的自然语言说法，并把说法收敛到可评测的原子命令组合。清单用于后续 LLM 意图评测、回归用例、提示词样例和产品验收。

范围边界：这里只覆盖 `move`、`insert`、`replace`、`delete`、`batch_move`、`batch_delete`、`query`、`validate` 八类原子命令，以及多轮确认/选择/取消动作。不覆盖草案生成，不覆盖全天自动编排。

## 原子命令组合矩阵

| 组合 | 自然语言模式 | intent | 关键槽位 | 播单类型 | 执行门 |
| --- | --- | --- | --- | --- | --- |
| C001 | 把《节目名》移到 10 点 | move | targetProgramName, newStartTime | tv/rotation | direct_execute |
| C002 | 9 点那档移到 10 点 | move | targetTime, newStartTime | tv/rotation | direct_execute |
| C003 | 《节目名》后移半小时 | move | targetProgramName, offsetSeconds, direction | tv/rotation | direct_execute |
| C004 | 09:00-09:30 后移 1 小时 | move | targetRange, offsetSeconds | tv/rotation | direct_execute |
| C005 | 找到多个同名目标后选择第一个 | move | pendingAction=select_candidate, targetItemId | tv/rotation | needs_selection |
| C006 | 删除《节目名》 | delete | targetProgramName | tv/rotation | confirm_before_commit |
| C007 | 删除 9 点那条 | delete | targetTime | tv/rotation | confirm_before_commit |
| C008 | 删除 10 点到 12 点之间的轮播短片 | batch_delete | targetRange, typeHint | rotation | confirm_before_commit |
| C009 | 删除多个选中节目 | batch_delete | targetItemIds | tv/rotation | confirm_before_commit |
| C010 | 确认删除 | delete/batch_delete | pendingAction=confirm | tv/rotation | execute_after_confirm |
| C011 | 10 点插入《节目名》 | insert | targetTime, programHint | tv | direct_execute |
| C012 | 10 点插入《节目名》 | insert | targetTime, programHint | rotation | confirm_before_commit |
| C013 | 继续排下一集 | insert | targetTime, programHint/seriesHint | tv | tv_sequence_selector |
| C014 | 多个下一集版本让我选 | insert | candidateOptions | tv | needs_selection |
| C015 | 轮播单插入无节目编号短片 | insert | targetTime, programHint/contentTags | rotation | confirm_before_commit |
| C016 | 用《候选》替换《目标》 | replace | targetProgramName, replacementHint | tv | direct_execute |
| C017 | 用《候选》替换 9 点节目 | replace | targetTime, replacementHint | tv | direct_execute |
| C018 | 轮播单替换为短片素材 | replace | targetTime/targetProgramName, replacementHint | rotation | confirm_before_commit |
| C019 | 替换为下一集 | replace | target selector, seriesHint | tv | tv_sequence_selector |
| C020 | 09:00-12:00 整体后移 | batch_move | targetRange, offsetSeconds | tv/rotation | direct_execute |
| C021 | 查询 10 点排了什么 | query | queryKind=time_lookup, targetTime | tv/rotation | read_only |
| C022 | 查询候选库短片 | query | queryKind=candidate_lookup, keyword/facets | tv/rotation | read_only |
| C023 | 查询当前播单概览 | query | queryKind=schedule_summary | tv/rotation | read_only |
| C024 | 校验当前播单 | validate | queryKind/current context | tv/rotation | read_only |
| C025 | 检查顺播/重叠/禁排/版权 | validate | validationFocus | tv/rotation | read_only |
| C026 | 用户取消 pending | any | pendingAction=cancel_pending | tv/rotation | cancel_without_commit |
| C027 | 用户开始新任务 | any | pendingAction=start_new_task | tv/rotation | reroute |
| C028 | pending 证据变化 | any write | contextFingerprint mismatch | tv/rotation | context_conflict |
| C029 | 低置信度理解 | any | confidence below threshold | tv/rotation | fallback_or_clarify |
| C030 | 多能力包同时匹配 | any | capabilityIds | tv/rotation | capability_route_conflict |
| C031 | 移动/插入目的地已有节目 | move/insert | target destination time | tv/rotation | time_overlap; block and ask scheduler to decide |

## 移动节目

1. 把《看东方》移到 10 点。
2. 《看东方》往后挪半小时。
3. 9 点那档移到 10 点。
4. 把 09:00-09:30 的节目后移 1 小时。
5. 早高峰版放到 8 点半。
6. 将午间 30 分提前到 11:30。
7. 把第一个新闻栏目挪到东方快报后面。
8. 把这条节目挪到空档开始处。
9. 把 10 点的节目和 11 点的节目对调。
10. 把今天上午所有新闻节目整体后移 15 分钟。
11. 从 14 点开始的节目整体提前半小时。
12. 把选中的 3 条节目统一移到 16 点以后。
13. 把《东方新闻》移到晚间档。
14. 把当前冲突的节目挪到最近可用空档。
15. 把 18:00 后的轮播条目顺延 5 分钟。

## 删除节目

16. 删除《看东方》。
17. 删掉 9 点那条。
18. 把 09:00-10:00 之间的节目删掉。
19. 删除所有测试占位节目。
20. 把重复的《东方快报》删掉一条。
21. 清掉下午的空播占位。
22. 删除当前选中的节目。
23. 删掉今天所有已过期素材。
24. 删除 10 点到 12 点之间的轮播短片。
25. 把没有版权的候选节目从编排里移除。
26. 删除第 2 条和第 4 条。
27. 把这个栏目下面的临时垫片删掉。
28. 清空晚间轮播单。
29. 删除《城市微短片：春日花路》。
30. 取消刚才准备删除的节目。

## 插入节目

31. 10 点插入《东方新闻》。
32. 在《看东方》后面加一条新闻。
33. 09:30 插入候选库里的《午间30分》。
34. 给 10 点空档补一个 30 分钟新闻节目。
35. 下午 2 点插入一条健康类内容。
36. 在晚间档加一条收视更高的剧集。
37. 在轮播单 10 点插入城市形象短片。
38. 找一个静安寺外场直播短片插到 15:00。
39. 20:00 继续排《人文中国》。
40. 今天 10 点接着排下一集。
41. 把昨天之后的下一集补到 19 点。
42. 插入一个 15 秒活动预热视频。
43. 找一条暴雨出行提醒短片插到整点前。
44. 在 12 点前插一个导视。
45. 10 点插入一条最合适的轮播素材。

## 替换节目

46. 把 9 点的节目换成《东方新闻》。
47. 用《Replacement News》替换《Morning News》。
48. 把这条换成同栏目新闻。
49. 把不可播素材替换成可播素材。
50. 把 10 点档换成下一集电视剧。
51. 用收视更高的候选替换当前轮播。
52. 把《看东方》换成午间新闻。
53. 11 点这条换成 30 秒城市宣传片。
54. 把健康节目替换成同长度健康节目。
55. 把晚间剧场替换成《人文中国》下一集。
56. 把版权 blocked 的节目换掉。
57. 把素材 missing 的节目换成 ready 的。
58. 把这条短片换成静安夜景版本。
59. 替换成同类型但更短的素材。
60. 把当前候选换成第二个推荐。

## 批量操作

61. 把 9 点到 12 点的节目整体后移 30 分钟。
62. 将上午新闻块整体提前 15 分钟。
63. 删除 14:00-16:00 所有轮播短片。
64. 批量删除所有不可播条目。
65. 把所有短片统一挪到广告后。
66. 清理所有重复节目。
67. 把选中的节目都延后 10 分钟。
68. 将下午专题节目整体移到晚间。
69. 批量替换版权过期素材。
70. 把今天所有垫片换成正式素材。

## 查询与检索

71. 查一下 10 点现在排了什么。
72. 看一下当前播单概览。
73. 找《看东方》在哪个时段。
74. 查询候选库里的城市形象短片。
75. 找静安寺相关素材。
76. 找没有节目编号的轮播短片。
77. 搜索 30 秒以内的短片。
78. 找 ready 状态的新闻候选。
79. 查一下今天有没有重复排同一节目。
80. 看一下昨天播到《人文中国》第几集。
81. 查候选库里下一集有哪些版本。
82. 查 10 点空档可用素材。
83. 查找内容关键词包含“发布会”的导视。
84. 找适合轮播单的短片。
85. 查一下当前节目是否锁定。

## 校验与诊断

86. 校验当前播单。
87. 检查有没有时间重叠。
88. 检查有没有超出版面边界。
89. 看看有没有禁排时段冲突。
90. 校验电视剧顺播有没有跳集。
91. 检查今天有没有重复播同一节目。
92. 校验候选素材版权是否 ready。
93. 检查素材状态是否可播。
94. 看看这个替换是否符合栏目职责。
95. 检查这个短片能不能放进轮播单。
96. 评估 10 点这个插入是否可执行。
97. 检查历史播出间隔是否太短。
98. 看一下为什么这条不能排。
99. 给我解释这次阻断原因。
100. 校验当前 pending 任务还能不能继续。

## 电视播单专业规则

101. 电视播单 20 点继续排下一集。
102. 不要跳集，按昨天播出顺序接着排。
103. 如果今天已经排过同系列，就按今天最后一集继续。
104. 如果今天没有，就按昨天最新记录继续。
105. 多个版本都符合下一集时让我选。
106. 如果下一集没有，不要自动跳到后面一集。
107. 新闻时段优先排新闻内容。
108. 替换时保持原栏目职责。
109. 不要把电视剧放到早间新闻槽。
110. 不要把同一节目当天重复排。
111. 最近播过的节目不要再插入。
112. 没有历史证据时不要自行判断下一集。

## 轮播单与短片

113. 轮播单先给推荐，不要直接提交。
114. 这个短片没有节目编号，也可以按标题找到。
115. 找内容标签里有“城市形象”的素材。
116. 找 15 秒活动预热视频。
117. 找 30 秒以内的静安寺短片。
118. 找便民服务类短片插到整点前。
119. 按内容关键词“春日花路”找素材。
120. 轮播单确认后再把短片落表。
121. 如果短片没有节目编号，落表时保留素材 ID。
122. 不要把无节目编号短片当作电视播单剧集。

## 多轮上下文

123. 就用第一个。
124. 换第二个推荐。
125. 不是这条，选另一个《看东方》。
126. 继续刚才那个插入，时间改成 10:30。
127. 确认。
128. 取消刚才的操作。
129. 不要继续，重新开始查候选。
130. 这个 pending 过期了就重新规划。
131. 如果候选库变了，重新让我确认。
132. 如果约束变了，不要沿用旧确认。
133. 如果历史记录变了，重新判断下一集。
134. 如果用户说的是新任务，不要继续旧任务。

## 边界与拒绝

135. 目标节目找不到时先问我。
136. 找到多个同名节目时让我选。
137. 锁定节目不要移动或删除。
138. 超出版面边界就阻断。
139. 禁排时段内不要插入。
140. 缺候选库时不要硬排。
141. 缺当前播单时不要写入。
142. 缺历史证据时不要推测电视下一集。
143. 低置信度理解不要直接执行。
144. 多个能力包都能处理时不要抢跑。
