# 第一优先级 LLM-only 违规修复方案

## 概述

- **评估范围**：本次 review 识别出的 6 处第一优先级 LLM-only 违规（B4 / B5 / B6 / C1 / B3 / A9）。
- **评估原则**：严格遵循 `AGENTS.md` 的 LLM-first / LLM-only 主路径与"本地逻辑只能保护结果、不能替用户表达或改写意图"的判断标准，逐处判断是 bug（违反 LLM-only，需要修复）还是业务场景特殊逻辑（表面看违规，实则有合理业务原因，不应改）。**不随便改**——既不让违规借"业务逻辑"之名保留，也不为合规而破坏现有用户体验。
- **判断标准**（摘自 `AGENTS.md`）：
  - 代码如果是在"理解用户"，就是错误方向（bug）。
  - 代码如果是在"保护结果、校验写入、暴露失败、危险操作保护、模型返回结构校验"，就是允许保留（业务逻辑）。
  - "如果模型无法返回有效理解或可读解释，应像 Codex 一样暴露失败并允许用户重试或补充，不能由本地规则假装理解。"
- **修复目标**：让 6 处逻辑全部符合 AGENTS.md；属 bug 的给出具体修复方案并配套调整 LLM prompt 与回归 case；属业务逻辑的说明保留理由，必要时做最小优化。
- **结论速览**：

  | 违规 | 名称 | 结论 | 是否修复 |
  |------|------|------|----------|
  | B4 | normalizeIntentForPending 用 pendingIntent 覆盖 requestedIntent | 半 bug 半业务（偏 bug） | 修复（改 prompt + 本地改校验） |
  | B5 | normalizePendingAction 自动推断 start_new_task | bug | 修复（改 prompt + 删本地推断 + 调 case） |
  | B6 | sanitizeAssistantFeedback 本地正则切分句子 | 业务逻辑（保护结果） | 保留，优化兜底 |
  | C1 | normalizeConfidence 默认 0.75 | bug | 修复（漏字段即暴露失败） |
  | B3 | cleanInsertProgramHint 本地正则清洗 | 业务逻辑（检索校验） | 保留，长期改 prompt |
  | A9 | buildClarifyFeedback 本地兜底澄清 | bug | 修复（改中性暴露失败反馈） |

---

## 逐处评估

### 违规 1：B4 - normalizeIntentForPending 用 pendingIntent 覆盖 requestedIntent

- **文件:行号**：`src/services/agent/llmAgentIntentInterpreter.ts:239-247`
- **当前代码逻辑**：
  ```ts
  private normalizeIntentForPending(
    requestedIntent: AtomicCommandIntent,
    pendingAction?: AgentPendingAction,
    pendingIntent?: AtomicCommandIntent,
  ): AtomicCommandIntent {
    if (!pendingIntent) return requestedIntent
    if (!pendingAction || pendingAction === 'start_new_task') return requestedIntent
    return pendingIntent  // 当 pendingAction 是 confirm/reject/select_candidate/cancel_pending 时，强制把 intent 改成 pendingIntent
  }
  ```
  调用点在第 81 行：`const intent = this.normalizeIntentForPending(requestedIntent, pendingAction, input.pendingTask?.intent)`。即 LLM 返回的 `requestedIntent` 在 pending 上下文下被本地强制改写为 `pendingIntent`。
- **违规类型**：LLM 后强行改写 intent（hidden continuation switch 的变体）。
- **是 bug 还是业务逻辑**：**半 bug 半业务逻辑，偏 bug**。
  - **bug 依据**：LLM prompt 第 128 行已明确要求"Ordinary follow-up language should be interpreted from the full context as a fresh structured intent with slots, not as a hidden continuation switch"。本地在 `pendingAction ∈ {confirm, reject, select_candidate, cancel_pending}` 时无条件把 `requestedIntent` 覆盖为 `pendingIntent`，等价于一条"隐藏的续接开关"——LLM 怎么理解都不重要，本地替它决定 intent。这违反"本地逻辑只能保护结果、不能替用户表达或改写意图"。
  - **业务依据**：当 LLM 正确返回 `pendingAction=select_candidate` 时，intent 字段理应与 `pendingTask.intent` 一致（选候选是针对某条 insert/replace 命令的）。若 LLM 内部不一致（返回 `select_candidate` 但 `intent=insert` 而 `pendingIntent=replace`），本地覆盖能"纠正"这种不一致，避免下游路由混乱。这部分属于"模型返回结构校验"的灰色地带。
  - **结论**：业务原因存在但不构成"必须用覆盖实现"的理由。正确做法是让 LLM 在 prompt 约束下自己保证 intent 与 pendingAction 一致，本地只做"校验"而非"覆盖"。
- **用户体验影响分析**：
  - 若直接删除覆盖逻辑（不配套改 prompt）：当 LLM 偶发返回 `pendingAction=select_candidate` 但 `intent` 与 `pendingIntent` 不一致时，下游可能因 intent 不匹配而走错分支（例如把"选候选"误当成新 insert）。这会影响 pending 状态下的连续操作体验。
  - 因此**不能裸删**，必须配套改 prompt + 本地改成校验。
- **修复建议**：
  1. **改 LLM prompt**（`llmAgentIntentInterpreter.ts` 第 102-146 行 system message）：在 pendingAction 规则附近追加一条：
     > "When pendingAction is one of confirm, reject, select_candidate, or cancel_pending, the `intent` field MUST equal `pendingTask.intent`. If the user's follow-up does not match the pending task, return pendingAction=start_new_task (or omit pendingAction) with the fresh intent instead."
  2. **本地改成校验而非覆盖**：
     ```ts
     private normalizeIntentForPending(
       requestedIntent: AtomicCommandIntent,
       pendingAction?: AgentPendingAction,
       pendingIntent?: AtomicCommandIntent,
     ): AtomicCommandIntent {
       // 仅校验：当 pendingAction 是 pending 续接动作时，要求 intent 与 pendingIntent 一致；
       // 不一致视为 LLM 输出结构异常，交由上游 confidence 门禁/失败处理，本地不再强制覆盖。
       return requestedIntent
     }
     ```
     若担心 LLM 偶发不遵守 prompt，可保留一个"不一致时把 confidence 降到门禁以下"的保护性校验（属"模型返回结构校验"，允许保留），但不再改写 intent 值本身。
  3. 由于该函数改完后只剩透传，可考虑内联回调用点，但为最小改动建议保留函数并加注释说明"仅校验"。
- **回归 case**：
  - **新增**：`select_candidate` 场景下 LLM 返回 `intent` 与 `pendingIntent` 一致 → 正常路由到选候选流程。
  - **新增**：`select_candidate` 场景下 LLM 返回 `intent` 与 `pendingIntent` 不一致 → 视为结构异常，confidence 降级或失败，不本地覆盖成 `pendingIntent`。
  - **确认**：现有 case `uses structured pendingAction to confirm a pending task`（intentInterpreter.test.ts:1840）使用 mock interpreter 绕过 normalize，不受影响，但应补一条走真实 `LlmAgentIntentInterpreter` 的 confirm 路径 case。

---

### 违规 2：B5 - normalizePendingAction 自动推断 start_new_task

- **文件:行号**：`src/services/agent/llmAgentIntentInterpreter.ts:220-237`（核心 233-235）
- **当前代码逻辑**：
  ```ts
  if (pendingIntent && requestedIntent && requestedIntent !== pendingIntent
      && allowedActions.includes('start_new_task')) {
    return 'start_new_task'  // LLM 没返回 pendingAction 时，本地替它推断 start_new_task
  }
  ```
  即 LLM 未返回 `pendingAction`，但 `requestedIntent ≠ pendingIntent` 且 `allowedActions` 含 `start_new_task` 时，本地自动推断为 `start_new_task`。
- **违规类型**：LLM 后本地替模型决定 pendingAction（补意图 / hidden continuation switch）。
- **是 bug 还是业务逻辑**：**bug**。
  - **bug 依据**：prompt 第 128 行明确"set pendingAction only for explicit start_new_task, cancel_pending, select_candidate, confirm, or reject"——pendingAction 应由 LLM 基于上下文判断后显式返回。本地在 LLM 没返回时替它推断 `start_new_task`，是用本地规则替 LLM"理解用户在切换话题"，属于"补意图"，违反 LLM-only。
  - **业务依据**：用户在 pending insert 状态下说"今天排了什么"（query），LLM 返回 `intent=query` 但没返回 `pendingAction`。本地推断 `start_new_task` 是为了让下游正确路由到新查询、不误把 query 当成 pending insert 的续接。这个业务诉求合理，但**实现方式错了**——应该让 LLM 自己返回 `start_new_task`，而不是本地替它决定。
  - **结论**：业务诉求合理，但本地推断是 bug，需配套改 prompt 让 LLM 自己处理。
- **用户体验影响分析**：
  - **若裸删本地推断**：现有 case `treats a different pending-turn intent as a new task when the LLM omits start_new_task`（intentInterpreter.test.ts:1446）和 `bypasses a pending write when the LLM interprets the follow-up as a new read-only task`（:1484）会失败——`pendingAction` 变成 `undefined`，下游可能把"切换话题"误当成 pending 续接，导致用户在 pending 状态下无法正常切换到新查询/新命令。**这会破坏现有的"切换话题"体验**。
  - 因此**必须配套改 prompt + 调整 case mock**，不能裸删。
- **修复建议**：
  1. **改 LLM prompt**：在 pendingAction 规则（第 128 行）后追加：
     > "If the user's follow-up starts a different task that does not continue the pendingTask (for example a read-only query, or a new insert/delete/move against a different target while pendingTask.intent differs), you MUST return pendingAction=start_new_task along with the fresh intent and slots. Do not omit pendingAction in this case."
  2. **删除本地推断**：
     ```ts
     private normalizePendingAction(
       value: unknown,
       allowedActions?: AgentPendingAction[],
       _requestedIntent?: AtomicCommandIntent,  // 不再使用
       _pendingIntent?: AtomicCommandIntent,    // 不再使用
     ): AgentPendingAction | undefined {
       if (!allowedActions?.length) return undefined
       const explicit = typeof value === 'string'
         && PENDING_ACTIONS.includes(value as AgentPendingAction)
         && allowedActions.includes(value as AgentPendingAction)
         ? value as AgentPendingAction
         : undefined
       return explicit  // 只透传 LLM 显式返回且在 allowedActions 内的值，不再本地推断
     }
     ```
     调用点（第 75-80 行）相应简化，不再传 `requestedIntent` / `pendingIntent`。
  3. **调整现有 case**：把 intentInterpreter.test.ts:1446 和 :1484 的 mock LLM 返回里显式加上 `pendingAction: 'start_new_task'`，case 描述改为"LLM explicitly marks a different pending-turn intent as start_new_task"。
- **回归 case**：
  - **调整**：:1446 / :1484 两条 case 的 mock 与描述（见上）。
  - **新增**：LLM 在 pending 状态下对"续接同意图"的跟进返回 `pendingAction` 缺省（或 `continue_pending` 等非 start_new_task 值）→ 不被本地误推断成 start_new_task，按 LLM 返回处理。
  - **新增**：LLM 在 pending 状态下返回 `pendingAction=start_new_task` 且 intent 与 pendingIntent 不同 → 正常路由到新任务，pendingTask 被清空。

---

### 违规 3：B6 - sanitizeAssistantFeedback 用本地正则切分句子

- **文件:行号**：`src/services/agent/llmAgentIntentInterpreter.ts:275-286`（`sanitizeAssistantFeedback`），同文件 `hasPrematureCompletionClaim` 在 270-273
- **当前代码逻辑**：
  ```ts
  private sanitizeAssistantFeedback(value: string): string | undefined {
    if (!ASSISTANT_FEEDBACK_TECHNICAL_PATTERN.test(value)) return value
    const sentenceChunks = value.match(/[^。！？!?；;]+[。！？!?；;]?/gu) ?? [value]
    const readableChunks = sentenceChunks
      .map((item) => item.trim())
      .filter((item) => item && !ASSISTANT_FEEDBACK_TECHNICAL_PATTERN.test(item))
    const readableText = readableChunks.join('')
    if (readableText.length >= 8) return readableText
    return undefined  // 整体丢弃
  }
  ```
  `ASSISTANT_FEEDBACK_TECHNICAL_PATTERN`（第 44 行）匹配 `intent=|slots=|pendingAction|confidence|JSON|Agent Core|needs_|...` 等技术词。当 LLM 反馈含技术词时，按句切分、过滤含技术词的句子、剩余 ≥8 字重组，否则整体丢弃（返回 undefined）。`hasPrematureCompletionClaim` 用正则识别"已插入/已删除/已改好"等谎报已写入的措辞，命中则丢弃反馈。
- **违规类型**：LLM 后本地正则改写/丢弃 LLM 反馈文本。
- **是 bug 还是业务逻辑**：**业务逻辑，保留**。
  - **业务依据**：
    1. `assistantFeedback` 是 LLM 对用户说的话，**不是用户意图**。AGENTS.md 禁止的是"改写用户意图"，而清洗 LLM 输出给用户看的反馈文本属于"保护结果"——防止 LLM 违反 prompt（prompt 第 139-140 行已明确要求"Do not include internal field names, JSON keys, policy ids, or technical terms"）时技术词泄漏给编辑人员。
    2. `hasPrematureCompletionClaim` 是"危险操作保护"——防止 LLM 谎报"已写入/已插入"误导用户以为播单已改动。AGENTS.md 明确允许"危险操作保护"和"暴露失败"。
    3. AGENTS.md 允许"模型返回结构校验"。技术词清洗本质是对 LLM 反馈字段的结构性校验/过滤，不是在"理解用户"。
  - **结论**：两段逻辑都是"保护结果"，符合 AGENTS.md 允许保留的本地逻辑范畴，**不应删除**。
- **用户体验影响分析**：
  - 若删除 `sanitizeAssistantFeedback`：LLM 偶发把 `intent=insert slots=...` 写进 assistantFeedback 时，技术词会直接展示给编辑人员，体验差且暴露内部字段。
  - 若删除 `hasPrematureCompletionClaim`：LLM 谎报"已插入"时用户会误以为播单已改动，属严重体验/安全问题。**必须保留**。
- **修复建议**：
  1. **保留** `sanitizeAssistantFeedback` 与 `hasPrematureCompletionClaim` 主体逻辑。
  2. **优化兜底**：当前"整体丢弃返回 undefined"会导致用户收不到任何反馈（LLM 给了反馈但被全部过滤）。建议兜底改为返回中性反馈而非 undefined：
     ```ts
     // readableText 不足 8 字时，不再返回 undefined，而是回退到一条中性提示，
     // 避免用户收不到任何反馈（仍属"保护结果"，不是替 LLM 表达意图）。
     return '我已收到这条指令，但还需要更明确的信息才能继续。'
     ```
     注意：该中性文案是固定的"暴露未就绪"提示，不针对用户具体意图做正则猜测，不违反 LLM-only。
  3. 加注释明确：此函数是"LLM 反馈字段的技术词过滤/谎报保护"，不是意图改写。
- **回归 case**：
  - **新增**：LLM 返回 assistantFeedback 含 `intent=` 等技术词 → 清洗后不含技术词，且保留可读部分。
  - **新增**：LLM 返回 assistantFeedback 全是技术词（无可读句子）→ 兜底返回中性提示（不返回 undefined）。
  - **新增**：LLM 返回 assistantFeedback 含"已插入/已改好"等谎报措辞 → 命中 `hasPrematureCompletionClaim`，反馈被丢弃/降级，不展示给用户。

---

### 违规 4：C1 - normalizeConfidence 默认 0.75

- **文件:行号**：`src/services/agent/llmAgentIntentInterpreter.ts:255-258`
- **当前代码逻辑**：
  ```ts
  private normalizeConfidence(value: unknown, requestedIntent?: AtomicCommandIntent): number {
    if (typeof value !== 'number' || Number.isNaN(value)) return requestedIntent ? 0.75 : 0
    return Math.max(0, Math.min(1, value))
  }
  ```
  LLM 未返回 confidence（或非数字）时：若 `requestedIntent` 存在则默认 `0.75`，否则 `0`。门禁 `MIN_STRUCTURED_CONFIDENCE = 0.5`（第 43 行），`0.75 > 0.5` 能通过门禁。
- **违规类型**：LLM 漏字段时本地补默认值让不完整理解通过门禁。
- **是 bug 还是业务逻辑**：**bug**。
  - **bug 依据**：prompt 第 127 行明确要求"Return confidence as a number from 0 to 1 whenever you return an intent"。LLM 漏 confidence 属于"模型返回不完整"。AGENTS.md 要求"如果模型无法返回有效理解或可读解释，应像 Codex 一样暴露失败并允许用户重试或补充，不能由本地规则假装理解"。默认 `0.75` 让一个"LLM 自己都没信心评估"的理解通过门禁进入执行，是"本地规则假装理解"。
  - **业务依据**：默认 0.75 的初衷可能是"LLM 偶发漏字段时不让整条理解失败"。但这恰恰是 AGENTS.md 禁止的——偶发漏字段就该暴露失败让用户重试，而不是本地兜底通过。
  - **结论**：bug。
- **用户体验影响分析**：
  - 若改为 0 或 return null：LLM 偶发漏 confidence 字段时，该次理解会被门禁拒绝（< 0.5），用户会收到"模型未稳定返回/请重试或补充"的提示。短期看是体验下降（偶发重试），但符合 AGENTS.md"暴露失败"原则，且 prompt 已强制要求返回 confidence，漏字段属异常不应兜底。
  - 长期看：暴露失败能倒逼 prompt/模型稳定性，避免"低质量理解被静默放行"导致的误编排（误编排比偶发重试体验更差）。
- **修复建议**：
  1. **改为暴露失败**。两种实现，推荐第二种（更严格）：
     - 方案 A（保守）：`return requestedIntent ? 0 : 0`（即漏字段一律 0，低于门禁 0.5，被拒绝）。
     - 方案 B（推荐）：在 `normalizeInterpretation` 中，confidence 非合法数字时直接 `return null`（整个 interpretation 失败，交由上游走重试/澄清），与"LLM 未返回有效结构"统一处理：
       ```ts
       private normalizeConfidence(value: unknown): number | null {
         if (typeof value !== 'number' || Number.isNaN(value)) return null
         return Math.max(0, Math.min(1, value))
       }
       ```
       调用点（第 73-74 行）相应调整：
       ```ts
       const confidence = this.normalizeConfidence(record.confidence)
       if (confidence === null) return null
       if (confidence < MIN_STRUCTURED_CONFIDENCE) return null
       ```
  2. **不需要改 prompt**（prompt 已要求返回 confidence），但可在 prompt 末尾强化一句："Returning an intent without a numeric confidence field is treated as an invalid response."
- **回归 case**：
  - **新增**：LLM 返回 intent + slots 但漏 confidence 字段 → interpretation 返回 null / 失败，不进入执行（断言 status=failed 且 reason 指向结构异常）。
  - **新增**：LLM 返回 confidence 为非数字字符串（如 "0.9"）→ 同样失败（不本地 coerce）。
  - **确认**：现有 case `rejects low-confidence LLM intent outputs`（:1565，confidence=0.2 被拒）不受影响，仍通过。

---

### 违规 5：B3 - cleanInsertProgramHint 本地正则清洗

- **文件:行号**：`src/services/agent/atomicCommandCapability.ts:4085-4109`（`cleanInsertProgramHint`），调用点 `parseInsert` 第 4090 行
- **当前代码逻辑**：
  ```ts
  private cleanInsertProgramHint(value?: string): string | undefined {
    const cleaned = value
      ?.replace(/\s+/g, ' ')
      .replace(/[，。！？；：、,.!?;:]/gu, '')
      .replace(/^(?:请|帮我|帮忙|在|到|给|把|将|的|一个|一条|一段|节目|栏目|内容|素材|候选|可用|可播)+/u, '')
      .replace(/^(?:一期|一集|最新一期|最新一集|最大一期|最大一集|期数最大的一期|期数最高的一期)+/u, '')
      .replace(/(?:期数最大(?:的)?|期数最高(?:的)?|最大期(?:的)?|最高期(?:的)?|最新(?:一)?期(?:的)?|最新(?:一)?集(?:的)?|最大(?:的)?一期|最大(?:的)?一集)/gu, '')
      .replace(/(?:节目|栏目|内容|素材|候选|可用|可播|一下)$/u, '')
      .trim()
    if (!cleaned || cleaned.length < 2) return undefined
    if (this.isAtomicActionOnlyHint(cleaned)) return undefined
    return cleaned
  }
  ```
  对 LLM 已提取的 `programHint` 再做本地正则清洗，去掉"请/帮我/期数最大/最新一期/节目/栏目"等修饰词。
- **违规类型**：LLM 后本地正则改写 LLM 提取的 slot 值。
- **是 bug 还是业务逻辑**：**业务逻辑，保留**（属"检索校验/写入校验"）。
  - **业务依据**：
    1. `resolveInsertCandidates`（同文件 4116-4139）用 `programHint` 做 `includes` 匹配：`haystack.includes(normalizedHint)`。候选库的 `haystack` 是 `programName/instanceName/programCode/...`，不含"期数最大/最新一期"等修饰词。若 `programHint="东方快报 期数最大"` 直接 includes，**主检索会失败**（haystack 没有"期数最大"）。`cleanInsertProgramHint` 把它清洗成"东方快报"是为了让主检索能命中——这是"写入/检索校验"，属 AGENTS.md 允许保留的本地逻辑。
    2. **意图细节由 `searchAlternatives` 承载**：prompt 第 117 行让 LLM 同时返回 `searchAlternatives=["东方快报 期数最大","东方快报 最新一期","东方快报"]`，第 133 行要求"return searchAlternatives as 2-5 short Chinese keyword rewrites"。`searchAlternatives` 由 `normalizeSearchAlternatives`（288-297）处理，只过滤技术词、不去"期数最大"，因此"期数最大"的意图通过 alternatives 保留，不会被 cleanInsertProgramHint 丢失。
    3. AGENTS.md 判断标准："代码如果是在保护结果、校验写入或暴露失败，就是允许保留。" cleanInsertProgramHint 是在"校验/规整检索关键词"，不是在"理解用户"——用户意图已由 LLM 的 intent + searchAlternatives 表达，本地只是让关键词能匹配候选库。
  - **结论**：业务逻辑，**不应删除**。但当前清洗规则偏激进（直接去掉"期数最大"等意图词），长期应通过改 prompt 让 LLM 返回干净 programHint 来消除本地清洗的必要性。
- **用户体验影响分析**：
  - 若裸删 cleanInsertProgramHint：LLM 按 prompt 第 117 行返回 `programHint="东方快报 期数最大"`，主检索 includes 失败，候选列表为空，用户会收到"未找到候选"——**插入流程直接中断**。这是明确的体验回归。
  - 因此短期必须保留。
- **修复建议**：
  1. **短期保留** cleanInsertProgramHint，加注释说明："本函数是对 LLM 提取的检索关键词做规整，让 includes 匹配能命中候选库；意图细节（如期数最大）由 searchAlternatives 承载，不在此丢失。属检索校验，非意图改写。"
  2. **长期优化（非本次必做）**：改 prompt 第 117 行，让 LLM 返回干净的 `programHint`（只含节目名/栏目名/关键词，如"东方快报"），把"期数最大/最新一期"等排序偏好放到 `searchAlternatives` 或新增 `sortPreference` 字段；同步调整 `resolveInsertCandidates` 让 facets 机制能处理纯关键词。届时可删除 cleanInsertProgramHint。
  3. **最小优化**：`isAtomicActionOnlyHint`（4111-4114）的判断是合理的"无效 hint 保护"（防止"就/好/排"等无意义词进入检索），保留。
- **回归 case**：
  - **确认**：`atomicCapabilities.test.ts` / `insertCandidateResolver.test.ts` 中 programHint 含"期数最大/最新一期"的检索 case 仍能命中候选（需在实现阶段核对这些 case 是否存在；若缺需补一条）。
  - **新增**：LLM 返回 `programHint="请帮我找最新一期的东方快报"` → 清洗为"东方快报"，主检索命中，且 searchAlternatives 保留"最新一期"意图。

---

### 违规 6：A9 - buildClarifyFeedback 本地兜底澄清

- **文件:行号**：`src/services/runtime/demoRuntimeFacade.ts:10412-10421`（定义），调用点 `:2111`
- **当前代码逻辑**：
  ```ts
  private buildClarifyFeedback(input: RuntimeSubmitInput, explanation?: string): RuntimeFeedback {
    const normalized = input.userInput.replace(/\s+/g, '')
    if (/(改|调整|换|替换|移动|删除|插入|添加|顺一下|挪一下)/.test(normalized)
        && !/(版面|栏目|剧场|时段|上午|下午|晚间|晚上|全天)/.test(normalized)) {
      return createFeedback('这句话更像是在调整具体节目。请补充明确的时间点或节目名称...', 'general', '需要澄清', { explanation })
    }
    if (/(编排|补齐|补全|填充|排表|排期|空窗|空缺)/.test(normalized)) {
      return createFeedback('这条指令更像是在描述编排需求。请补充版面范围和内容偏好...', 'general', '需要澄清', { explanation })
    }
    return createFeedback('我还不能稳定理解这条指令。你可以直接说"下午改成新闻栏目"...', 'general', '需要澄清', { explanation })
  }
  ```
  调用点 2111 行：`return { kind: 'message', feedback: this.buildClarifyFeedback(effectiveInput, classification.reasoning || layoutRecognition?.reasoning) }`。
- **违规类型**：LLM 后本地正则"假装理解"用户在调整节目还是编排需求，生成兜底澄清。
- **是 bug 还是业务逻辑**：**bug**。
  - **bug 依据**：
    1. **调用点不是 LLM 失败兜底**。LLM 失败已在 2075-2081 行由 `buildRecoverableLlmFailureDecision` 处理（`classification.suggestedParams?.llmFailure` 分支）。2111 行是 `taskClassifier.classify` 已返回 classification，但其 `mode` 未匹配任何已知分支（micro_edit / validate_only / repair_only / layout_* / full_generate / partial_generate）时的兜底。即 LLM 已返回结果，只是 mode 未识别。
    2. 此时用本地正则 `/改|调整|换|.../` 判断"用户在调整具体节目"还是"在描述编排需求"，是典型的"由本地规则假装理解"——违反 AGENTS.md"不能由本地规则假装理解"。第三条中性反馈"我还不能稳定理解这条指令"本身是合规的，违规的是前两条正则分支在替 LLM 分类用户意图。
    3. `buildRecoverableLlmFailureDecision`（:610）已存在且多处复用（:650 / :2076 / :8176），但它是给"LLM 服务未返回"用的文案（"这次模型服务没有正常返回"），不适用于"LLM 返回了未知 mode"的场景，不能直接套用。
  - **业务依据**：无明显业务依据。LLM 既已返回 classification，未知 mode 应视为"LLM 未给出可执行分类"，应暴露失败让用户重试/补充，而非本地正则猜意图。
  - **结论**：bug。
- **用户体验影响分析**：
  - 若删除前两条正则分支：用户在 mode 未匹配时会收到中性"我还不能稳定理解这条指令，你可以直接说'下午改成新闻栏目'，或补充更明确的时间范围和目标内容"提示。相比当前"这句话更像是在调整具体节目"的猜测式反馈，中性反馈更诚实（不假装理解），且仍给出可操作的补充示例，体验不会实质下降。
  - 风险：极少数情况下，用户原本能从"更像是在调整具体节目"获得方向性提示。但这种方向性提示本质是本地正则猜的，可能猜错（如用户说"调整版面"会被第一条正则误判为"调整具体节目"），猜错反而误导。中性反馈更安全。
- **修复建议**：
  1. **删除前两条正则分支**，只保留中性暴露失败反馈，并强化"可重试/可补充"语义：
     ```ts
     private buildClarifyFeedback(input: RuntimeSubmitInput, explanation?: string): RuntimeFeedback {
       // LLM 已返回 classification 但 mode 未匹配任何可执行分支时，不本地猜测用户意图，
       // 统一返回中性"未稳定理解"反馈，暴露失败并给出可操作示例，允许用户重试或补充。
       return createFeedback(
         '我还不能稳定理解这条指令，还没有修改草案或播单。你可以直接说"下午改成新闻栏目"，或补充更明确的时间范围和目标内容；也可以直接说"重试"让我再试一次。',
         'general',
         '需要澄清',
         { explanation },
       )
     }
     ```
  2. `input` 参数若不再使用可移除（保留也无副作用，最小改动建议保留签名以减少调用点改动）。
  3. **不需要改 LLM prompt**——这是 runtime 层兜底，不是 interpreter 层。但应确认 `taskClassifier` 的 mode 枚举是否完整，未知 mode 是否应扩充（属长期优化，非本次必做）。
- **回归 case**：
  - **新增**：`taskClassifier` 返回未知 mode（或 mode 缺省）→ `buildClarifyFeedback` 返回中性反馈，文案含"还不能稳定理解"且**不含**"更像是在调整具体节目" / "更像是在描述编排需求"。
  - **新增**：用户输入含"调整"但 classification.mode 已匹配（如 micro_edit）→ 走对应分支，不进入 buildClarifyFeedback（确认 2111 只是兜底）。
  - **确认**：LLM 失败（llmFailure）→ 仍走 `buildRecoverableLlmFailureDecision`，不被 buildClarifyFeedback 截胡。

---

## 修复顺序与依赖关系

按"独立性 + 风险 + 依赖"排序，建议分 4 批：

### 第 1 批：独立、低风险、不需改 prompt
1. **违规 4（C1 normalizeConfidence 默认 0.75）**：纯本地改动，无依赖，最高优先级（防低质量理解静默通过）。
2. **违规 6（A9 buildClarifyFeedback）**：纯本地改动，无依赖，删除正则分支即可。

### 第 2 批：需配套改 prompt，但彼此独立
3. **违规 2（B5 normalizePendingAction 自动推断）**：改 prompt + 删本地推断 + 调整 case 1446/1484。是违规 1 的前置（先让 LLM 自己负责 pendingAction 判断）。
4. **违规 1（B4 normalizeIntentForPending 覆盖 intent）**：改 prompt + 本地改校验。依赖违规 2 的 prompt 调整已完成（两者都改 prompt 的 pendingAction 段落，宜一起改避免冲突）。

**建议违规 1 + 违规 2 同批实施**，因为它们改的是同一段 prompt（pendingAction 规则）和同一组 normalize 函数，分开改容易产生中间态不一致。

### 第 3 批：业务逻辑保留，仅优化兜底
5. **违规 3（B6 sanitizeAssistantFeedback）**：保留主体，优化"整体丢弃"兜底为中性反馈。低风险。

### 第 4 批：业务逻辑保留，仅加注释 / 长期优化
6. **违规 5（B3 cleanInsertProgramHint）**：保留，加注释说明属检索校验。长期改 prompt + 检索机制属后续优化，不纳入本次。

**依赖关系图**：
```
违规 4（独立） ──┐
违规 6（独立） ──┼─> 第 1 批
                 │
违规 2 ──> 违规 1（同批，共用 prompt 段落）──> 第 2 批
                 │
违规 3（独立优化）──> 第 3 批
                 │
违规 5（保留+注释）──> 第 4 批
```

---

## 风险评估

### 整体风险
- **中风险**：违规 1 + 违规 2 涉及 pending 上下文路由，是 agent 编排链路的核心。改 prompt + 删本地推断后，若 LLM 不稳定遵守 prompt，可能导致 pending 状态下的续接/切换话题路由错乱。需重点回归。
- **低风险**：违规 4 / 违规 6 是兜底行为收紧，最坏情况是用户偶发收到"请重试"，不会误编排。
- **极低风险**：违规 3 / 违规 5 是保留 + 优化，不改变主路径。

### 具体风险与缓解

| 风险 | 影响范围 | 缓解措施 |
|------|----------|----------|
| 删除 B5 本地推断后 LLM 不返回 start_new_task → pending 状态下切换话题被误当续接 | pending 上下文路由 | prompt 强约束 + 调整 case 1446/1484 mock + 新增"LLM 漏返回 start_new_task"的回归 case 监控 |
| 删除 B4 覆盖后 LLM 返回 intent 与 pendingAction 不一致 → 下游路由混乱 | pending 续接（confirm/select_candidate） | 保留"不一致时降级 confidence"的校验式保护（属结构校验，允许） |
| C1 改为漏字段即失败 → LLM 偶发漏 confidence 时用户需重试 | 偶发体验下降 | prompt 已强制要求返回 confidence；漏字段属异常，暴露失败优于静默放行 |
| A9 删除正则分支 → 用户失去"方向性提示" | mode 未匹配兜底 | 中性反馈仍给可操作示例（"下午改成新闻栏目"）；正则猜测本身可能误判，删除反而减少误导 |
| B6 兜底改中性反馈 → 反馈不再完全忠于 LLM 原文 | LLM 反馈全被过滤时 | 仅在"全被过滤"兜底场景生效，正常场景仍用 LLM 原文；中性文案是固定提示非意图猜测 |

### 不变性保证
- 修复不触碰 `AGENTS.md` 的 Scheduling Guardrails（时间重叠、顺播、候选字段级匹配等）。
- 修复不引入任何"LLM 前的本地关键词分类"。
- 所有保留的本地逻辑（B6 / B3 / hasPrematureCompletionClaim / isAtomicActionOnlyHint）均归入"保护结果/校验写入/危险操作保护"范畴，加注释明确边界。

---

## 验证计划

### 每处修复的验证方式

| 违规 | 单元测试 | agent:check | 浏览器冒烟 |
|------|----------|-------------|------------|
| B4 | 新增/确认 case（见上） | 必跑（pending 链路） | pending 状态下 confirm/select_candidate 实操 |
| B5 | 调整 case 1446/1484 + 新增 case | 必跑（pending 链路） | pending 状态下切换到查询/新命令实操 |
| B6 | 新增技术词清洗 + 谎报保护 case | 必跑 | LLM 违规输出技术词时的反馈展示 |
| C1 | 新增漏 confidence 失败 case | 必跑 | 偶发重试提示 |
| B3 | 确认/新增 programHint 清洗检索 case | 必跑 | "期数最大"类插入候选命中 |
| A9 | 新增 mode 未匹配中性反馈 case | 必跑 | 边界输入的澄清反馈文案 |

### 验证命令
- 行为变化相关 Vitest case：
  ```bash
  npx vitest run src/services/__tests__/schedulingAgentRuntime.intentInterpreter.test.ts
  npx vitest run src/services/__tests__/demoRuntimeFacade.test.ts
  npx vitest run src/services/__tests__/atomicCapabilities.test.ts
  npx vitest run src/services/__tests__/insertCandidateResolver.test.ts
  ```
- Agent 编排链路门禁：
  ```bash
  npm run agent:check
  ```
- 构建检查：
  ```bash
  npm run build
  ```
- 前台可见交互变化（B6 / A9 涉及反馈文案）：刷新 `http://localhost:5173`，在 Codex in-app browser 中跑：
  1. pending 状态下 confirm / select_candidate / 切换话题 三条路径
  2. 输入一条会触发 mode 未匹配的边界指令，确认反馈文案为中性"还不能稳定理解"
  3. 触发一次 LLM 偶发漏字段（如可用 mock），确认收到"请重试"而非误执行

### 门禁失败处理
- 若 `agent:check` 失败：说明 pending 链路或 candidate 链路回归，优先排查违规 1/2 的 prompt 调整是否被 LLM mock 测试覆盖。
- 若构建失败：排查 normalizePendingAction / normalizeConfidence 签名调整是否漏改调用点。
- 若浏览器冒烟发现 pending 路由错乱：回滚违规 1/2，重新评估 prompt 强约束是否足够，必要时保留"结构校验式"保护（降级 confidence）而非裸删。

---

## 附：未覆盖点与残余风险

1. **违规 1/2 的 LLM 遵守度**：修复后依赖 LLM 严格遵守 prompt 中"pendingAction 必须显式返回"和"select_candidate 时 intent 必须 = pendingTask.intent"两条约束。真实 LLM 偶发不遵守时，靠"结构校验降级 confidence"兜底，但无法 100% 消除。建议在 `agentRealLlmEvaluationCases.test.ts` / `agentLlmIntentEvaluation.test.ts` 中补充真实 LLM 评测 case 长期监控。
2. **违规 5 的长期优化**：cleanInsertProgramHint 当前保留是因检索机制（includes）限制。长期改 prompt + 检索机制（让 facets 支持"期数最大"等排序偏好）才能彻底消除本地清洗。本次不做，列为后续迭代。
3. **taskClassifier mode 枚举完整性**：违规 6 修复后，mode 未匹配走中性反馈。若未知 mode 频繁出现，应排查 taskClassifier 的 mode 枚举是否需要扩充（如新增 `needs_clarification` mode 让 LLM 显式表达"需澄清"），属长期优化。
4. **本方案未改任何实现代码**，仅产出评估与方案。实现阶段需按 `AGENTS.md` Mandatory Flow 先确认 case 再改实现，并按 Verification Gates 跑 `agent:check` + 浏览器冒烟。
