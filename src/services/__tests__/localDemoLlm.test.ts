import { describe, expect, it } from 'vitest'

import { createLocalDemoLlmResponse, isPlaceholderApiKey } from '@/services/llm/localDemoLlm'

const layoutIntentPrompt = (userInput: string) => [
  {
    role: 'system' as const,
    content: '你是广播节目版面意图识别器，只输出 JSON。',
  },
  {
    role: 'user' as const,
    content: `用户输入：${userInput}`,
  },
]

const layoutDraftPrompt = (userInput: string) => [
  {
    role: 'system' as const,
    content: '你是版面草案生成器，只输出 JSON。',
  },
  {
    role: 'user' as const,
    content: `用户需求：${userInput}`,
  },
]

describe('localDemoLlm', () => {
  it.each([
    ['', true],
    ['YOUR_API_KEY', true],
    ['your_siliconflow_key', true],
    ['real-key', false],
  ])('识别占位 API key: %s', (apiKey, expected) => {
    expect(isPlaceholderApiKey(apiKey)).toBe(expected)
  })

  it.each([
    {
      input: '我准备在静安寺进行户外直播，准备一个14:00到15:00的轮播单',
      range: { start: '14:00:00', end: '15:00:00' },
      label: '静安寺户外直播轮播',
      programType: 'news_magazine',
    },
    {
      input: '帮我做一份中午商圈活动预热的节目单',
      range: { start: '12:00:00', end: '14:00:00' },
      label: '商圈活动预热',
      programType: 'news_magazine',
    },
    {
      input: '两点到三点做社区服务提醒',
      range: { start: '14:00:00', end: '15:00:00' },
      label: '社区服务提醒',
      programType: 'news_magazine',
    },
    {
      input: '下午以城市服务为主',
      range: { start: '13:00:00', end: '18:00:00' },
      label: '城市服务',
      programType: 'news_magazine',
    },
    {
      input: '黄金档主打综艺',
      range: { start: '19:00:00', end: '20:00:00' },
      label: '综艺',
      programType: 'entertainment',
    },
    {
      input: '晚间垫个暖场短片',
      range: { start: '18:00:00', end: '23:00:00' },
      label: '暖场短片',
      programType: 'news_magazine',
    },
    {
      input: '14:00到15:00做直播花絮集锦',
      range: { start: '14:00:00', end: '15:00:00' },
      label: '直播花絮集锦',
      programType: 'news_magazine',
    },
  ])('占位 key 时把开放编排话术映射为版面意图 JSON: $input', ({ input, range, label, programType }) => {
    const response = createLocalDemoLlmResponse(layoutIntentPrompt(input))

    expect(response).not.toBeNull()
    const parsed = JSON.parse(response!.content)
    expect(parsed.mode).toBe('layout_prepare')
    expect(parsed.targetTimeRange).toEqual(range)
    expect(parsed.semanticLabel).toBe(label)
    expect(parsed.programTypeHint).toBe(programType)
  })

  it('为版面草案生成器返回可执行 segment', () => {
    const response = createLocalDemoLlmResponse(layoutDraftPrompt('14点开始排一个小时纪录片'))

    expect(response).not.toBeNull()
    const parsed = JSON.parse(response!.content)
    expect(parsed.coverage).toEqual({ start: '14:00:00', end: '15:00:00' })
    expect(parsed.segments[0]).toMatchObject({
      label: '纪录片',
      programType: 'documentary',
      startTime: '14:00:00',
      endTime: '15:00:00',
    })
  })

  it('当前已有草案时将替换类开放话术识别为草案微调', () => {
    const response = createLocalDemoLlmResponse([
      {
        role: 'system',
        content: '你是广播节目版面意图识别器，只输出 JSON。',
      },
      {
        role: 'user',
        content: [
          '当前已有版面草案，覆盖 06:00:00-23:59:59。',
          '用户输入：晚上全部替换成新闻栏目',
        ].join('\n'),
      },
    ])

    expect(response).not.toBeNull()
    const parsed = JSON.parse(response!.content)
    expect(parsed.mode).toBe('layout_refine')
    expect(parsed.targetTimeRange).toEqual({ start: '18:00:00', end: '23:00:00' })
    expect(parsed.semanticLabel).toBe('新闻栏目')
    expect(parsed.programTypeHint).toBe('news')
  })

  it('缺少可执行时段时不强行生成演示结果', () => {
    const response = createLocalDemoLlmResponse(layoutIntentPrompt('周末社区活动，先出一份播单'))

    expect(response).toBeNull()
  })

  it('非编排 prompt 不会被本地演示模型接管', () => {
    const response = createLocalDemoLlmResponse([
      { role: 'system', content: '普通聊天助手' },
      { role: 'user', content: '用户输入：14:00到15:00写一段宣传文案' },
    ])

    expect(response).toBeNull()
  })
})
