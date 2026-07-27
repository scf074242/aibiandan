import type { ChatMessage } from '@/types/llm'

import type { LayoutAnalysisPromptContext } from './layoutAnalysisService'

/**
 * layoutAnalysis prompt 版本号（对齐 AGENTS.md Prompt 版本管理门禁）
 * - v1.0：初始版本
 */
export const LAYOUT_ANALYSIS_PROMPT_VERSION = 'v1.0' as const

const stringifySection = (value: unknown) => JSON.stringify(value, null, 2)

export const buildLayoutAnalysisPrompt = (context: LayoutAnalysisPromptContext): ChatMessage[] => {
  const systemPrompt = [
    `[prompt ${LAYOUT_ANALYSIS_PROMPT_VERSION}] 你是一名资深广电频道节目编辑与编排分析师。`,
    '你的任务是基于用户提供的真实节目单、版面结构、栏目定义和校验结果，输出一份自然中文分析报告。',
    '请像业务人员写分析结论一样表达，不要输出 JSON，不要使用代码块。',
    '分析时优先关注：整体版面骨架、栏目定位是否贴合、全天时段节奏是否顺畅、内容层次是否均衡、当前风险和后续优化方向。',
    '必须严格基于输入数据分析，不要编造不存在的节目、问题或外部事实。',
    '如果没有提供外部检索材料，即使用户提到联网或热点，也必须明确本次分析仍然基于本地节目单和版面数据，不要假装已经联网搜索。',
    '请做少量排版即可：输出 2 到 4 段短段落，段落之间空一行。',
    '建议每段以简短行首标签开头，例如“总评：”“观察：”“风险：”“建议：”；不要做复杂分级，不要列表符号，不要编号。',
    '总长度控制在 220 到 420 个中文字符以内，单段尽量不超过 2 到 3 句，避免冗长铺陈。',
    '第一段先给总体判断；中间段落展开关键观察和风险；最后一段自然带出“如果愿意，可以继续优化并生成新的版面草案”。',
  ].join('\n')

  const userPrompt = [
    `【用户诉求】\n${context.userIntent}`,
    `【分析模式】\n${context.analysisModeLabel}`,
    `【频道上下文】\n${stringifySection(context.channel)}`,
    `【事实摘要】\n${stringifySection(context.facts)}`,
    `【完整节目单】\n${stringifySection(context.schedule)}`,
    `【当前版面】\n${stringifySection(context.layout)}`,
    `【校验结果】\n${stringifySection(context.validation)}`,
    context.externalResearch && context.externalResearch.length > 0
      ? `【外部补充材料】\n${stringifySection(context.externalResearch)}`
      : '【外部补充材料】\n当前未提供外部检索材料。',
  ].join('\n\n')

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ]
}
