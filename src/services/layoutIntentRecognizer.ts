import type { ChatMessage } from '@/types/llm'
import type { LayoutDraft, LayoutIntentSegment, ScheduleState } from '@/types/orchestration'
import type { LLMClient } from './llm/llmClient'

export type LayoutIntentMode = 'layout_prepare' | 'layout_refine' | 'layout_commit' | 'layout_analysis' | 'atomic_fallback' | 'clarify'

export interface LayoutIntentRecognition {
  mode: LayoutIntentMode
  confidence: number
  reasoning: string
  ignoreExistingLayout: boolean
  targetTimeRange?: { start: string; end: string }
  semanticLabel?: string
  programTypeHint?: string
  segments?: LayoutIntentSegment[]
}

export interface LayoutIntentRecognizerInput {
  scheduleState: ScheduleState
  userInput: string
  history?: string[]
  currentLayoutDraft?: LayoutDraft | null
  hasUploadedLayout?: boolean
  hasDefaultLayout?: boolean
}

const CONFIDENCE_THRESHOLD = 0.72
const PROTECTED_RULE_BASED_MODES: LayoutIntentMode[] = ['layout_analysis', 'layout_commit']

const looksLikeDirectOrchestrationIntent = (input: string): boolean => {
  return [
    '帮我全天编排',
    '全天编排',
    '整天编排',
    '帮我填充全天节目',
    '填充全天节目',
    '补齐当前所有空窗',
    '补齐当前空窗',
    '补齐空窗',
    '补齐当前所有空缺',
    '补齐当前空缺',
  ].some((keyword) => input.includes(keyword))
}

const normalizeInput = (value: string) => value.trim().toLowerCase().replace(/\s+/g, '')

const normalizeClock = (clock: string): string => {
  const [hourText, minuteText = '00', secondText = '00'] = clock.split(':')
  const hour = Math.max(0, Math.min(23, Number(hourText)))
  const minute = Math.max(0, Math.min(59, Number(minuteText)))
  const second = Math.max(0, Math.min(59, Number(secondText)))
  return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}:${second.toString().padStart(2, '0')}`
}

const extractTimeRange = (input: string): { start: string; end: string } | undefined => {
  const colonRange = input.match(/(\d{1,2}:\d{2})(?:到|至|-)(\d{1,2}:\d{2})/)
  if (colonRange) {
    return {
      start: normalizeClock(colonRange[1]!),
      end: normalizeClock(colonRange[2]!),
    }
  }

  const pointRange = input.match(/(\d{1,2})(?::(\d{1,2}))?点(?:到|至|-)(\d{1,2})(?::(\d{1,2}))?点?/)
  if (pointRange) {
    return {
      start: normalizeClock(`${pointRange[1]}:${pointRange[2] ?? '00'}:00`),
      end: normalizeClock(`${pointRange[3]}:${pointRange[4] ?? '00'}:00`),
    }
  }

  if (input.includes('全天') || input.includes('整天') || input.includes('全日')) {
    return { start: '06:00:00', end: '23:59:59' }
  }
  if (input.includes('上午')) {
    return { start: '06:00:00', end: '12:00:00' }
  }
  if (input.includes('中午') || input.includes('午间')) {
    return { start: '12:00:00', end: '14:00:00' }
  }
  if (input.includes('下午')) {
    return { start: '13:00:00', end: '18:00:00' }
  }
  if (input.includes('晚间') || input.includes('晚上') || input.includes('夜间')) {
    return { start: '18:00:00', end: '23:00:00' }
  }
  if (input.includes('深夜') || input.includes('凌晨')) {
    return { start: '23:00:00', end: '23:59:59' }
  }

  return undefined
}

const matchesIgnoreExistingLayout = (input: string): boolean => {
  return [
    '不参考当前版面参考',
    '不要参考当前版面参考',
    '不参考当前版面',
    '不要参考当前版面',
    '不参考当前频道版面',
    '不要参考当前频道版面',
    '不参考版面',
    '不要参考版面',
    '忽略当前版面',
    '忽略当前版面参考',
    '忽略现有版面',
  ].some((keyword) => input.includes(keyword))
}

const matchesLayoutCommit = (input: string): boolean => {
  return [
    '按这个版面开始编排',
    '按这个版面开始排',
    '按该版面开始编排',
    '确认版面',
    '采用这个版面',
    '用这个版面编排',
  ].some((keyword) => input.includes(keyword))
}

const matchesLayoutAnalysis = (input: string): boolean => {
  const hasAnalysisVerb = ['分析', '评估', '研判', '诊断', '梳理'].some((keyword) => input.includes(keyword))
  const hasLayoutTarget = ['当前版面', '版面编排', '当前编排', '当前节目单', '节目单编排', '节目编排', '编排情况']
    .some((keyword) => input.includes(keyword))
  const hasEditorialCue = /编辑视角|业务分析|文字版报告|分析报告/.test(input)
  return (hasAnalysisVerb && hasLayoutTarget) || (hasLayoutTarget && hasEditorialCue) || (hasAnalysisVerb && hasEditorialCue)
}

const matchesLayoutOptimization = (input: string): boolean => {
  const hasOptimizeVerb = ['优化', '调优', '重构', '重新梳理', '重做'].some((keyword) => input.includes(keyword))
  const hasTarget = ['当前版面', '版面', '当前编排', '编排', '节目单'].some((keyword) => input.includes(keyword))
  return hasOptimizeVerb && hasTarget
}

const matchesLayoutDraftRemove = (input: string): boolean => {
  const hasRemoveVerb = ['删除', '删掉', '移除', '去掉'].some((keyword) => input.includes(keyword))
  const hasDraftCue = ['草案', '版面草案', '当前版面', '版面', '时段'].some((keyword) => input.includes(keyword))
  const hasTargetCue = Boolean(extractTimeRange(input))
    || /(\d{1,2})(点半|点(\d{1,2})分?|[:：]\d{2})/.test(input)
    || /《[^》]+》/.test(input)
    || !['草案', '版面', '时段'].some((keyword) => input === `删除${keyword}` || input === `去掉${keyword}`)
  return hasRemoveVerb && hasDraftCue && hasTargetCue
}

const matchesLayoutRefineVerb = (input: string): boolean => {
  return ['改成', '换成', '替换成', '替换为', '改为', '调整为', '统一成', '变成'].some((keyword) => input.includes(keyword))
}

const matchesLayoutPrepareVerb = (input: string): boolean => {
  return ['排入', '编入', '铺成', '安排成', '都排', '全部排入', '全部编入', '整体排成'].some((keyword) => input.includes(keyword))
}

const looksLikeAtomicFallback = (input: string, options: { hasContent: boolean }): boolean => {
  const hasAtomicVerb = ['移动', '删除', '插入', '添加', '替换', '改', '调整', '顺一下', '挪一下', '后移', '前移', '顺延', '延后', '提前']
    .some((keyword) => input.includes(keyword))
  const hasAtomicAnchor = /(\d{1,2})(点半|点(\d{1,2})分?|[:：]\d{2})/.test(input)
    || /《[^》]+》/.test(input)
    || ['那个', '那条', '那段', '后面', '前面', '刚才', '这个节目', '这条节目'].some((keyword) => input.includes(keyword))
  const hasLayoutCue = ['版面', '栏目', '剧场', '时段', '上午', '下午', '晚间', '晚上', '全天', '整天', '全日']
    .some((keyword) => input.includes(keyword))
  const hasExplicitRange = /(到|至|-)/.test(input) && /(\d{1,2})(点半|点(\d{1,2})分?|[:：]\d{2})/.test(input)
  if (hasExplicitRange && options.hasContent) {
    return false
  }
  return hasAtomicVerb && hasAtomicAnchor && !hasLayoutCue
}

const extractSemanticLabel = (input: string): string | undefined => {
  const normalized = input
    .replace(/^(?:不参考当前版面参考|不要参考当前版面参考|不参考当前版面|不要参考当前版面|不参考版面|不要参考版面|忽略当前版面参考|忽略当前版面)[,，、\s]*/u, '')
    .trim()
  const verbMatch = normalized.match(/(?:排入|编入|铺成|安排成|改成|换成|替换成|替换为|改为|调整为|统一成|变成)(.+)$/u)
  const rawLabel = verbMatch?.[1]?.trim()
  if (!rawLabel) {
    return undefined
  }

  const cleaned = rawLabel
    .replace(/^(?:全部|都|统一|整体)+/u, '')
    .replace(/(?:节目|版面|内容)+$/u, '')
    .trim()

  return cleaned || undefined
}

const stripLayoutPrefix = (input: string): string => input
  .replace(/^(?:不参考当前版面参考|不要参考当前版面参考|不参考当前版面|不要参考当前版面|不参考当前频道版面|不要参考当前频道版面|不参考版面|不要参考版面|忽略当前版面|忽略当前版面参考|忽略现有版面)[,，、\s]*/u, '')
  .replace(/^(?:上午|中午|午间|下午|晚间|晚上|夜间|深夜|凌晨|全天|整天|全日)/u, '')
  .replace(/^(?:\d{1,2}:\d{2}|\d{1,2}(?::\d{1,2})?点(?:半)?)(?:到|至|-)(?:\d{1,2}:\d{2}|\d{1,2}(?::\d{1,2})?点(?:半)?)/u, '')
  .replace(/^(?:全部|都|统一|整体)+/u, '')
  .replace(/^(?:改成|换成|替换成|替换为|改为|调整为|统一成|变成|排入|编入|铺成|安排成|做成)+/u, '')
  .replace(/(?:节目|栏目|版面|内容)+$/u, '')
  .trim()

const extractSegmentSemanticLabel = (input: string): string | undefined => {
  const fromVerb = extractSemanticLabel(input)
  if (fromVerb) return fromVerb
  const cleaned = stripLayoutPrefix(input)
  return cleaned || undefined
}

const extractProgramTypeHint = (semanticLabel: string | undefined, input: string): string | undefined => {
  const text = `${semanticLabel ?? ''}${input}`
  if (/(电视剧|剧场|连续剧|影视|微短剧|短剧)/u.test(text)) {
    return 'drama'
  }
  if (/(新闻|快报|播报)/u.test(text)) {
    return 'news'
  }
  if (/(资讯|专题)/u.test(text)) {
    return 'news_magazine'
  }
  if (/(评论|观察|访谈|民生)/u.test(text)) {
    return 'commentary'
  }
  if (/(健康|养生)/u.test(text)) {
    return 'health'
  }
  if (/(娱乐|综艺)/u.test(text)) {
    return 'entertainment'
  }
  if (/(少儿|动画)/u.test(text)) {
    return 'kids'
  }
  if (/(纪录片|纪实)/u.test(text)) {
    return 'documentary'
  }
  return undefined
}

const extractStructuredSegments = (input: string): LayoutIntentSegment[] | undefined => {
  const parts = input
    .split(/[，,；;、]/u)
    .map((part) => normalizeInput(part))
    .filter(Boolean)

  if (parts.length < 2) return undefined

  const segments = parts
    .map((part): LayoutIntentSegment | null => {
      const range = extractTimeRange(part)
      const semanticLabel = extractSegmentSemanticLabel(part)
      const programTypeHint = extractProgramTypeHint(semanticLabel, part)
      if (!range || (!semanticLabel && !programTypeHint)) {
        return null
      }
      return {
        start: range.start,
        end: range.end,
        semanticLabel,
        programTypeHint,
        sequential: programTypeHint === 'drama' || /剧场|电视剧|连续剧/u.test(semanticLabel ?? ''),
      }
    })
    .filter((segment): segment is LayoutIntentSegment => Boolean(segment))

  return segments.length >= 2 ? segments : undefined
}

const isVagueLayoutRequest = (
  input: string,
  hasScope: boolean,
  semanticLabel?: string,
  programTypeHint?: string,
): boolean => {
  const hasLayoutWord = ['版面', '排单', '排一下', '排一版'].some((keyword) => input.includes(keyword))
  if (!hasLayoutWord) {
    return false
  }

  return !hasScope && !semanticLabel && !programTypeHint
}

const summarizeDraft = (draft?: LayoutDraft | null): string => {
  if (!draft) {
    return '当前没有待确认的版面草案。'
  }

  const slots = draft.layoutReference.slots
    .slice(0, 6)
    .map((slot) => {
      const column = draft.columns.find((item) => item.columnId === slot.columnId)
      const label = column?.semanticLabel ?? column?.columnName ?? slot.id
      const start = slot.startTime.split('T')[1]?.slice(0, 8) ?? draft.coverage.start
      const end = slot.endTime.split('T')[1]?.slice(0, 8) ?? draft.coverage.end
      return `${start}-${end} ${label}`
    })

  return `当前已有版面草案，覆盖 ${draft.coverage.start}-${draft.coverage.end}。前几个时段：${slots.join('；') || '无'}`
}

export class LayoutIntentRecognizer {
  constructor(private llmClient: LLMClient) {}

  async recognize(input: LayoutIntentRecognizerInput): Promise<LayoutIntentRecognition> {
    const fallback = this.ruleBasedRecognize(input)
    if (!this.shouldUseLlm(input, fallback)) {
      return fallback
    }

    try {
      const response = await this.llmClient.chat(this.buildPrompt(input), {
        temperature: 0.1,
        maxTokens: 400,
      })
      const parsed = this.parseResponse(response.content)
      if (!parsed) {
        return fallback
      }
      return this.mergeRecognitions(fallback, parsed)
    } catch {
      return fallback
    }
  }

  private shouldUseLlm(
    input: LayoutIntentRecognizerInput,
    fallback: LayoutIntentRecognition,
  ): boolean {
    const normalized = normalizeInput(input.userInput)
    if (looksLikeDirectOrchestrationIntent(normalized)) {
      return false
    }
    if (fallback.mode === 'atomic_fallback') {
      return false
    }
    if (matchesLayoutDraftRemove(normalized)) {
      return false
    }
    if (PROTECTED_RULE_BASED_MODES.includes(fallback.mode)) {
      return false
    }
    if (input.currentLayoutDraft) {
      return true
    }
    if (fallback.mode !== 'clarify') {
      return true
    }
    return /版面|排单|剧场|栏目|全天|上午|下午|晚上|晚间|不参考/.test(input.userInput)
  }

  private ruleBasedRecognize(input: LayoutIntentRecognizerInput): LayoutIntentRecognition {
    const normalized = normalizeInput(input.userInput)
    const structuredSegments = extractStructuredSegments(input.userInput)
    const targetTimeRange = extractTimeRange(normalized)
    const semanticLabel = extractSemanticLabel(normalized)
    const programTypeHint = extractProgramTypeHint(semanticLabel, normalized)
    const ignoreExistingLayout = matchesIgnoreExistingLayout(normalized)
    const hasScope = Boolean(targetTimeRange)
    const hasContent = Boolean(semanticLabel || programTypeHint)

    if (matchesLayoutCommit(normalized) && input.currentLayoutDraft) {
      return {
        mode: 'layout_commit',
        confidence: 0.95,
        reasoning: '检测到用户正在确认当前版面草案并准备开始编排。',
        ignoreExistingLayout,
        targetTimeRange,
        semanticLabel,
        programTypeHint,
      }
    }

    if (matchesLayoutAnalysis(normalized)) {
      return {
        mode: 'layout_analysis',
        confidence: 0.94,
        reasoning: '检测到用户想分析当前实际编排效果，应先输出文字版业务分析报告。',
        ignoreExistingLayout,
        targetTimeRange,
        semanticLabel,
        programTypeHint,
      }
    }

    if (matchesLayoutOptimization(normalized)) {
      return {
        mode: 'layout_prepare',
        confidence: 0.9,
        reasoning: '检测到用户想优化当前版面编排，应先生成新的待确认版面草案。',
        ignoreExistingLayout: true,
        targetTimeRange,
        semanticLabel,
        programTypeHint,
        segments: structuredSegments,
      }
    }

    if (input.currentLayoutDraft && matchesLayoutDraftRemove(normalized)) {
      return {
        mode: 'layout_refine',
        confidence: 0.93,
        reasoning: '当前已有版面草案，用户正在删除草案中的某个版面时段，应作为草案微调处理。',
        ignoreExistingLayout,
        targetTimeRange,
        semanticLabel,
        programTypeHint,
      }
    }

    if (looksLikeDirectOrchestrationIntent(normalized)) {
      return {
        mode: 'layout_prepare',
        confidence: 0.92,
        reasoning: '检测到用户正在发起编排或补排流程，按产品规则应先生成可确认的版面草案。',
        ignoreExistingLayout,
        targetTimeRange: targetTimeRange ?? (input.scheduleState.isEmpty ? { start: '06:00:00', end: '23:59:59' } : undefined),
        semanticLabel,
        programTypeHint,
        segments: structuredSegments,
      }
    }

    if (looksLikeAtomicFallback(normalized, { hasContent })) {
      return {
        mode: 'atomic_fallback',
        confidence: 0.9,
        reasoning: '当前输入更像是在调整具体节目条目，但信息还不足以形成可执行的原子命令。',
        ignoreExistingLayout,
        targetTimeRange,
        semanticLabel,
        programTypeHint,
      }
    }

    if (isVagueLayoutRequest(normalized, hasScope, semanticLabel, programTypeHint)) {
      return {
        mode: 'clarify',
        confidence: 0.9,
        reasoning: '检测到版面相关表达，但缺少明确范围或内容偏好，需要补充说明。',
        ignoreExistingLayout,
        targetTimeRange,
        semanticLabel,
        programTypeHint,
      }
    }

    if (
      input.currentLayoutDraft
      && hasContent
      && (matchesLayoutRefineVerb(normalized) || hasScope || normalized.includes('时段'))
    ) {
      return {
        mode: 'layout_refine',
        confidence: 0.9,
        reasoning: '当前已有版面草案，本轮输入更像是对草案局部时段的微调。',
        ignoreExistingLayout,
        targetTimeRange,
        semanticLabel,
        programTypeHint,
      }
    }

    if (
      structuredSegments
      && structuredSegments.length >= 2
    ) {
      return {
        mode: 'layout_prepare',
        confidence: 0.93,
        reasoning: '检测到用户正在一次性描述多个时段的版面需求，应先生成多段版面草案。',
        ignoreExistingLayout,
        targetTimeRange: {
          start: structuredSegments[0]!.start,
          end: structuredSegments.at(-1)!.end,
        },
        semanticLabel: structuredSegments[0]?.semanticLabel,
        programTypeHint: structuredSegments[0]?.programTypeHint,
        segments: structuredSegments,
      }
    }

    if (
      hasContent
      && (ignoreExistingLayout || hasScope || matchesLayoutPrepareVerb(normalized) || normalized.includes('版面'))
    ) {
      return {
        mode: 'layout_prepare',
        confidence: 0.88,
        reasoning: '检测到用户在描述新的版面结构要求，应先生成或调整版面草案。',
        ignoreExistingLayout,
        targetTimeRange,
        semanticLabel,
        programTypeHint,
        segments: structuredSegments,
      }
    }

    return {
      mode: 'clarify',
      confidence: 0.3,
      reasoning: '当前输入更像是通用编排、校验或其他指令，不强行解释为版面意图。',
      ignoreExistingLayout,
      targetTimeRange,
      semanticLabel,
      programTypeHint,
      segments: structuredSegments,
    }
  }

  private buildPrompt(input: LayoutIntentRecognizerInput): ChatMessage[] {
    const currentDraftSummary = summarizeDraft(input.currentLayoutDraft)
    const systemPrompt = [
      '你是广播节目版面意图识别器，主要负责识别版面草案相关意图。',
      '如果输入明显更像在调整具体节目条目，但信息不足以直接形成插入、删除、移动、替换命令，请返回 atomic_fallback。',
      '请只在以下模式中选择一个：layout_prepare、layout_refine、layout_commit、layout_analysis、atomic_fallback、clarify。',
      '业务短语是开放的，不要把“下午剧场”“新闻栏目”“城市剧场”这类短语硬套成固定词表，请尽量原样保留到 semanticLabel。',
      '如果用户明确要求“分析当前版面编排/当前节目单编排”，返回 layout_analysis。',
      '如果用户明确要求“优化当前版面/优化当前编排”，优先返回 layout_prepare，并把 ignoreExistingLayout 设为 true。',
      '如果用户明确表示“不参考当前版面/忽略版面”，请把 ignoreExistingLayout 设为 true。',
      '如果用户只提到了分类标签，比如“电视剧”“新闻”，也要给出 programTypeHint。',
      '如果输入仍然过于模糊，就返回 clarify，不要过度猜测。',
      '如果用户一次性描述了多个时段，请输出 segments 数组，每个元素包含 start、end、semanticLabel、programTypeHint。',
      '只输出 JSON，格式为：{"mode":"layout_prepare","confidence":0.92,"reasoning":"...","ignoreExistingLayout":false,"targetTimeRange":{"start":"13:00:00","end":"18:00:00"},"semanticLabel":"下午剧场","programTypeHint":"drama","segments":[{"start":"06:00:00","end":"12:00:00","semanticLabel":"新闻","programTypeHint":"news"}]}',
    ].join('\n')

    const userPrompt = [
      `频道：${input.scheduleState.channelName} (${input.scheduleState.channelId})`,
      `日期：${input.scheduleState.date}`,
      `当前节目单状态：${input.scheduleState.isEmpty ? '空表' : '已有内容'}`,
      `是否已有上传版面：${input.hasUploadedLayout ? '是' : '否'}`,
      `是否已有频道版面：${input.hasDefaultLayout ? '是' : '否'}`,
      currentDraftSummary,
      `用户输入：${input.userInput}`,
      input.history?.length ? `历史对话：\n${input.history.join('\n')}` : '',
    ].filter(Boolean).join('\n')

    return [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ]
  }

  private parseResponse(content: string): LayoutIntentRecognition | null {
    try {
      const match = content.match(/\{[\s\S]*\}/)
      if (!match) {
        return null
      }
      const parsed = JSON.parse(match[0]) as Partial<LayoutIntentRecognition>
      if (!parsed.mode || !['layout_prepare', 'layout_refine', 'layout_commit', 'layout_analysis', 'atomic_fallback', 'clarify'].includes(parsed.mode)) {
        return null
      }
      return {
        mode: parsed.mode,
        confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
        reasoning: parsed.reasoning || '',
        ignoreExistingLayout: parsed.ignoreExistingLayout === true,
        targetTimeRange: parsed.targetTimeRange,
        semanticLabel: parsed.semanticLabel,
        programTypeHint: parsed.programTypeHint,
        segments: Array.isArray((parsed as { segments?: unknown[] }).segments)
          ? ((parsed as { segments?: LayoutIntentSegment[] }).segments?.filter((segment) => segment?.start && segment?.end) ?? [])
          : undefined,
      }
    } catch {
      return null
    }
  }

  private mergeRecognitions(
    fallback: LayoutIntentRecognition,
    parsed: LayoutIntentRecognition,
  ): LayoutIntentRecognition {
    if (parsed.confidence >= CONFIDENCE_THRESHOLD) {
      return {
        ...fallback,
        ...parsed,
        targetTimeRange: parsed.targetTimeRange ?? fallback.targetTimeRange,
        semanticLabel: parsed.semanticLabel ?? fallback.semanticLabel,
        programTypeHint: parsed.programTypeHint ?? fallback.programTypeHint,
        segments: parsed.segments?.length ? parsed.segments : fallback.segments,
        ignoreExistingLayout: parsed.ignoreExistingLayout || fallback.ignoreExistingLayout,
      }
    }

    if (fallback.mode !== 'clarify') {
      return fallback
    }

    return {
      ...parsed,
      targetTimeRange: parsed.targetTimeRange ?? fallback.targetTimeRange,
      semanticLabel: parsed.semanticLabel ?? fallback.semanticLabel,
      programTypeHint: parsed.programTypeHint ?? fallback.programTypeHint,
      segments: parsed.segments?.length ? parsed.segments : fallback.segments,
      ignoreExistingLayout: parsed.ignoreExistingLayout || fallback.ignoreExistingLayout,
    }
  }
}

let globalLayoutIntentRecognizer: LayoutIntentRecognizer | null = null

export function getLayoutIntentRecognizer(llmClient: LLMClient): LayoutIntentRecognizer {
  if (!globalLayoutIntentRecognizer) {
    globalLayoutIntentRecognizer = new LayoutIntentRecognizer(llmClient)
  }
  return globalLayoutIntentRecognizer
}

export function resetLayoutIntentRecognizer(): void {
  globalLayoutIntentRecognizer = null
}
