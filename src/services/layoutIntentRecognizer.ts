import type { ChatMessage } from '@/types/llm'
import type { LayoutDraft, LayoutIntentSegment, ScheduleState } from '@/types/orchestration'
import type { LLMClient } from './llm/llmClient'
import { cleanLayoutDraftSemanticLabel } from './layoutDraftSemanticCleaner'

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

const cleanRecognizedSemanticLabel = cleanLayoutDraftSemanticLabel

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

const normalizeSegments = (segments: unknown): LayoutIntentSegment[] | undefined => {
  if (!Array.isArray(segments)) {
    return undefined
  }

  return segments
    .filter((segment): segment is LayoutIntentSegment => Boolean(segment?.start && segment?.end))
    .map((segment) => ({
      ...segment,
      semanticLabel: cleanRecognizedSemanticLabel(segment.semanticLabel),
    }))
}

export class LayoutIntentRecognizer {
  constructor(private llmClient: LLMClient) {}

  async recognize(input: LayoutIntentRecognizerInput): Promise<LayoutIntentRecognition> {
    try {
      const response = await this.llmClient.chat(this.buildPrompt(input), {
        temperature: 0.1,
        maxTokens: 400,
        timeout: 8000,
        maxRetries: 1,
        traceLabel: 'layout_intent',
      })
      const parsed = this.parseResponse(response.content)
      if (!parsed) {
        return this.buildUnusableModelRecognition()
      }
      return parsed
    } catch {
      return this.buildUnusableModelRecognition()
    }
  }

  private buildUnusableModelRecognition(): LayoutIntentRecognition {
    return {
      mode: 'clarify',
      confidence: 0,
      reasoning: '模型没有返回有效版面意图，已停止本地规则兜底。',
      ignoreExistingLayout: false,
    }
  }

  private buildPrompt(input: LayoutIntentRecognizerInput): ChatMessage[] {
    const currentDraftSummary = summarizeDraft(input.currentLayoutDraft)
    const systemPrompt = [
      '你是广播节目版面意图识别器，主要负责识别版面草案相关意图。',
      '如果输入明显更像在调整具体节目条目，但信息不足以直接形成插入、删除、移动、替换命令，请返回 atomic_fallback。',
      '请只在以下模式中选择一个：layout_prepare、layout_refine、layout_commit、layout_analysis、atomic_fallback、clarify。',
      '业务短语是开放的，不要把“下午剧场”“新闻栏目”“城市剧场”这类短语硬套成固定词表，请尽量原样保留到 semanticLabel。',
      '如果用户说“准备一个/制作一份/生成一份”某个时间范围的轮播单、播单、直播单、户外直播单，应理解为 layout_prepare：先生成该时间范围的待确认版面草案。',
      '对户外直播、活动直播、地点直播这类场景，可把 semanticLabel 保留为原始业务短语；若没有更精确类型，programTypeHint 可用 news_magazine。',
      '如果用户说的是节目单、编排单、串联单、特别报道、主题活动、商圈/会场直播、节庆/赛事预热等开放业务话术，只要是在请求排播、生成、补排、调整或分析，都必须映射到已有模式，不要因为栏目词不在固定词表里就放弃。',
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
        semanticLabel: cleanRecognizedSemanticLabel(parsed.semanticLabel),
        programTypeHint: parsed.programTypeHint,
        segments: normalizeSegments((parsed as { segments?: unknown }).segments),
      }
    } catch {
      return null
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
