import type { ChatMessage, LLMResponse } from '@/types/llm'
import { looksLikeProgramSchedulingRequest, parseSchedulingTimeRange } from '@/services/schedulingIntentHeuristics'

const normalizeInput = (value: string) => value.trim().replace(/\s+/g, '')

const normalizeClock = (value: string): string => {
  const [hourText, minuteText = '00', secondText = '00'] = value.split(':')
  const hour = Math.max(0, Math.min(23, Number(hourText)))
  const minute = Math.max(0, Math.min(59, Number(minuteText)))
  const second = Math.max(0, Math.min(59, Number(secondText)))
  return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}:${second.toString().padStart(2, '0')}`
}

const extractTimeRange = (text: string): { start: string; end: string } | undefined => {
  const parsed = parseSchedulingTimeRange(text)
  if (parsed) {
    return parsed
  }

  const normalized = normalizeInput(text)
  const colonRange = normalized.match(/(\d{1,2}:\d{2})(?:到|至|-)(\d{1,2}:\d{2})/)
  if (colonRange) {
    return {
      start: normalizeClock(colonRange[1]!),
      end: normalizeClock(colonRange[2]!),
    }
  }

  const pointRange = normalized.match(/(\d{1,2})(?::(\d{1,2}))?(?:点|點)?(?:到|至|-)(\d{1,2})(?::(\d{1,2}))?(?:点|點)?/)
  if (pointRange) {
    return {
      start: normalizeClock(`${pointRange[1]}:${pointRange[2] ?? '00'}:00`),
      end: normalizeClock(`${pointRange[3]}:${pointRange[4] ?? '00'}:00`),
    }
  }

  return undefined
}

const jsonResponse = (value: unknown): LLMResponse => ({
  content: JSON.stringify(value),
})

const extractUserInput = (promptText: string): string => {
  const explicit = promptText.match(/用户输入[:：]\s*([^\n]+)/)
    ?? promptText.match(/用户需求[:：]\s*([^\n]+)/)
    ?? promptText.match(/用户新要求[:：]\s*([^\n]+)/)
  return explicit?.[1]?.trim() ?? promptText
}

const isOutdoorLiveCarousel = (text: string): boolean => {
  const normalized = normalizeInput(text)
  return /(轮播单|播单|直播单)/.test(normalized)
    && /(直播|户外|现场|活动|静安寺)/.test(normalized)
    && Boolean(extractTimeRange(normalized))
}

const isOpenSchedulingPrompt = (promptText: string): boolean => {
  return promptText.includes('版面意图识别器')
    || promptText.includes('版面草案生成器')
    || promptText.includes('版面草案微调器')
    || promptText.includes('任务分类助手')
}

const inferTimeRange = (input: string): { start: string; end: string } | undefined => {
  const parsed = extractTimeRange(input)
  if (parsed) return parsed

  const normalized = normalizeInput(input)
  if (/(跨年|晚会|灯光秀|夜游|夜间活动)/.test(normalized)) {
    return { start: '18:00:00', end: '23:00:00' }
  }
  return undefined
}

const extractSemanticLabel = (input: string): string | undefined => {
  const normalized = normalizeInput(input)

  const preference = normalized.match(/以(.+?)为主/)
    ?? normalized.match(/主打(.+)$/)
    ?? normalized.match(/围绕(.+)$/)
    ?? normalized.match(/侧重(.+)$/)
  if (preference?.[1]) {
    return cleanSemanticLabel(preference[1])
  }

  const verbTail = normalized.match(/(?:替换成|替换为|改成|改为|换成|调整为|统一成|变成|安排|编排|排入|排|做成|做个|做一段|做|准备|制作|生成|创建|来个|来一份|来一版|来一段|搞一版|弄一版|补上|补一段|加个|加一段|加一点|垫个|垫一点|垫一段|串场|衔接|过渡|收个)(.+)$/)
  const raw = verbTail?.[1] ?? normalized
  return cleanSemanticLabel(raw)
}

const cleanSemanticLabel = (value: string): string | undefined => {
  const cleaned = value
    .replace(/^\d{1,2}[:：]\d{2}(?:到|至|-|~|～)\d{1,2}[:：]\d{2}的?/g, '')
    .replace(/\d{1,2}[:：]\d{2}(?:到|至|-|~|～)\d{1,2}[:：]\d{2}/g, '')
    .replace(/\d{1,2}(?:点|點)(?:半|一刻|三刻)?(?:到|至|-|~|～)\d{1,2}(?:点|點)?(?:半|一刻|三刻)?/g, '')
    .replace(/[零〇一二两三四五六七八九十]{1,3}(?:点|點)(?:半|一刻|三刻)?(?:到|至|-|~|～)[零〇一二两三四五六七八九十]{1,3}(?:点|點)?(?:半|一刻|三刻)?/g, '')
    .replace(/\d{1,2}(?:[:：]\d{1,2})?(?:点半|点一刻|点三刻|點一刻|點三刻|点|點)(?:开始|起|起播|开播|左右|前后|附近|以后|之后|往后|后)?/g, '')
    .replace(/[零〇一二两三四五六七八九十]{1,3}(?:点半|点一刻|点三刻|點一刻|點三刻|点|點)(?:开始|起|起播|开播|左右|前后|附近|以后|之后|往后|后)?/g, '')
    .replace(/(?:一刻钟|三刻钟|(?:(?:\d+(?:\.\d+)?)|[零〇一二两三四五六七八九十]{1,3})(?:个)?半小时|(?:(?:\d+(?:\.\d+)?)|[零〇一二两三四五六七八九十]{1,3})(?:个)?小时半|半个?小时|(?:(?:\d+(?:\.\d+)?)|[零〇一二两三四五六七八九十]{1,3})(?:个)?小时|(?:(?:\d+)|[零〇一二两三四五六七八九十]{1,3})分钟)/g, '')
    .replace(/(?:全天|整天|全日|上午|中午|午间|下午|晚间|晚上|夜间|深夜|凌晨|早间|清晨|白天|傍晚|黄金时段|黄金档|七点档|八点档|周末|今晚|明晚|今天|明天)/g, '')
    .replace(/(?:按)?(?:纯电视频道|电视频道|频道编排|常规频道)/g, '')
    .replace(/(?:接昨天进度|接昨日进度|接昨天|接昨日|昨天进度|昨日进度|顺播|续播|继续播|接着播|顺着排)/g, '')
    .replace(/(?:顺着|按照|根据)?(?:当前|现有|今天)?(?:版面|节目单|编排单)?(?:补中间集|补缺集|补空档|补空窗|补空缺)/g, '')
    .replace(/^(?:我准备在|请|给我|帮我|帮忙|麻烦|需要|想要|先|全部|都|整体|统一|一个|一份|一版|一段|加个|加一段|加一点|垫个|垫一点|垫一段|做个|做一段|的)+/g, '')
    .replace(/(?:节目单|编排单|串联单|排单|直播单|轮播单|播单|节目|版面|单子)+$/g, '')
    .replace(/[，,。；;、]/g, '')
    .replace(/进行/g, '')
    .replace(/(?:的)+$/g, '')
    .trim()

  if (!cleaned) return undefined
  if (/静安寺/.test(cleaned) && /户外|外场|直播/.test(cleaned)) {
    return '静安寺户外直播轮播'
  }
  if (/户外|外场/.test(cleaned) && /直播/.test(cleaned)) {
    return '户外直播轮播'
  }
  return cleaned
}

const inferProgramTypeHint = (label: string | undefined, input: string): string => {
  const text = `${label ?? ''}${input}`
  if (/(电视剧|剧场|连续剧|影视|微短剧|短剧)/.test(text)) return 'drama'
  if (/(新闻|快报|快讯|播报)/.test(text)) return 'news'
  if (/(健康|养生)/.test(text)) return 'health'
  if (/(娱乐|综艺)/.test(text)) return 'entertainment'
  if (/(少儿|动画)/.test(text)) return 'kids'
  if (/(纪录片|纪实)/.test(text)) return 'documentary'
  if (/(评论|观察|访谈|民生)/.test(text)) return 'commentary'
  if (/(预热|预告|导视|垫片|暖场|串场|过渡|集锦|精编|精选|回看|短片|片花|花絮|宣推|互动|轻松|收尾)/.test(text)) return 'news_magazine'
  return 'news_magazine'
}

const buildSegmentQueryHints = (semanticLabel: string, programTypeHint: string): string[] => {
  const text = `${semanticLabel}${programTypeHint}`
  const hints = [semanticLabel, programTypeHint]

  ;[
    '直播',
    '户外',
    '现场',
    '活动',
    '静安寺',
    '商圈',
    '会场',
    '发布会',
    '预热',
    '预告',
    '导视',
    '服务',
    '提醒',
    '集锦',
    '回看',
    '花絮',
    '短片',
    '暖场',
  ].forEach((keyword) => {
    if (text.includes(keyword)) {
      hints.push(keyword)
    }
  })

  return Array.from(new Set(hints))
}

const buildDemoSchedulingDecision = (userInput: string): {
  targetTimeRange: { start: string; end: string }
  semanticLabel: string
  programTypeHint: string
} | null => {
  const targetTimeRange = inferTimeRange(userInput)
  if (!targetTimeRange) {
    return null
  }

  const semanticLabel = extractSemanticLabel(userInput)
  if (!semanticLabel) {
    return null
  }

  return {
    targetTimeRange,
    semanticLabel,
    programTypeHint: inferProgramTypeHint(semanticLabel, userInput),
  }
}

const shouldRefineCurrentDraft = (promptText: string, userInput: string): boolean => {
  return promptText.includes('当前已有版面草案')
    && /(替换|改成|换成|调整|统一成|变成|全部|都)/.test(userInput)
}

export function isPlaceholderApiKey(apiKey?: string): boolean {
  const normalized = apiKey?.trim() ?? ''
  return !normalized
    || /^your[_-]/i.test(normalized)
    || normalized === 'YOUR_SILICONFLOW_API_KEY'
    || normalized === 'YOUR_API_KEY'
}

export function createLocalDemoLlmResponse(messages: ChatMessage[]): LLMResponse | null {
  const promptText = messages.map((message) => message.content).join('\n')
  const userInput = extractUserInput(promptText)

  if (!isOpenSchedulingPrompt(promptText)) {
    return null
  }

  const decision = buildDemoSchedulingDecision(userInput)
  if (!decision || (!isOutdoorLiveCarousel(userInput) && !looksLikeProgramSchedulingRequest(userInput))) {
    return null
  }

  const { targetTimeRange, semanticLabel, programTypeHint } = decision

  if (promptText.includes('版面草案生成器') || promptText.includes('版面草案微调器')) {
    return jsonResponse({
      coverage: targetTimeRange,
      segments: [
        {
          id: 'draft-segment-outdoor-live-carousel',
          label: semanticLabel,
          startTime: targetTimeRange.start,
          endTime: targetTimeRange.end,
          programType: programTypeHint,
          queryHints: buildSegmentQueryHints(semanticLabel, programTypeHint),
          sequential: programTypeHint === 'drama',
        },
      ],
    })
  }

  if (promptText.includes('版面意图识别器')) {
    const mode = shouldRefineCurrentDraft(promptText, userInput) ? 'layout_refine' : 'layout_prepare'
    return jsonResponse({
      mode,
      confidence: 0.88,
      reasoning: mode === 'layout_refine'
        ? '演示 LLM 识别到用户正在基于当前版面草案调整局部时段，应更新待确认版面草案。'
        : '演示 LLM 识别到用户正在为指定时间范围创建节目编排产物，应先生成待确认版面草案。',
      ignoreExistingLayout: false,
      targetTimeRange,
      semanticLabel,
      programTypeHint,
    })
  }

  if (promptText.includes('任务分类助手')) {
    return jsonResponse({
      mode: 'layout_prepare',
      confidence: 0.86,
      reasoning: '演示 LLM 识别到指定地点、时间范围和轮播单产物，应进入版面草案流程。',
      suggestedParams: {
        userIntent: semanticLabel,
        targetTimeRange,
        semanticLabel,
        programTypeHint,
      },
    })
  }

  return null
}
