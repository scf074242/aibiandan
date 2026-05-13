import { describe, expect, it, vi } from 'vitest'

import {
  LayoutAnalysisService,
  type LayoutAnalysisRequest,
} from '@/services/layoutAnalysisService'
import type { LayoutReference, ValidationReport } from '@/types/orchestration'

const createValidationReport = (): ValidationReport => ({
  id: 'validation-1',
  scope: 'full',
  targetId: 'dragon_2026-03-25',
  timestamp: '2026-03-25T10:00:00+08:00',
  issues: [
    {
      id: 'issue-1',
      type: 'layout_constraint',
      severity: 'warning',
      message: '晚间栏目定位与版面预期不完全一致',
      suggestion: '建议复核晚间内容定位',
      location: {
        timeRange: {
          start: '21:00:00',
          end: '22:00:00',
        },
      },
      createdAt: '2026-03-25T10:00:00+08:00',
    },
  ],
  summary: {
    totalIssues: 1,
    criticalCount: 0,
    warningCount: 1,
    infoCount: 0,
  },
  isValid: false,
})

const createLayoutReference = (): LayoutReference => ({
  id: 'layout-1',
  name: '测试版面',
  slots: [
    {
      id: 'slot-0700',
      channelId: 'dragon',
      startTime: '2026-03-25T07:00:00+08:00',
      endTime: '2026-03-25T09:00:00+08:00',
      columnId: '101',
    },
    {
      id: 'slot-2100',
      channelId: 'dragon',
      startTime: '2026-03-25T21:00:00+08:00',
      endTime: '2026-03-25T22:00:00+08:00',
      columnId: '120',
    },
  ],
})

const createRequest = (overrides: Partial<LayoutAnalysisRequest> = {}): LayoutAnalysisRequest => ({
  channelId: 'dragon',
  channelName: '东方卫视',
  date: '2026-03-25',
  userInput: '请分析当前版面编排，给我一份编辑视角的文字版报告',
  currentSchedule: [
    {
      id: 'item-0700',
      programName: '看东方',
      startTime: '07:00:00',
      endTime: '09:00:00',
      duration: 7200,
      programType: 'news_magazine',
    },
    {
      id: 'item-2100',
      programName: '东方看大剧',
      startTime: '21:00:00',
      endTime: '21:30:00',
      duration: 1800,
      programType: 'drama',
    },
  ],
  validationReport: createValidationReport(),
  layoutReference: createLayoutReference(),
  ...overrides,
})

describe('LayoutAnalysisService', () => {
  it('会把完整节目单、版面和校验结果一起交给 LLM 生成自然分析', async () => {
    const chat = vi.fn(async () => ({
      content: '从当前编排看，上午资讯带相对稳定，但晚间内容承接仍需优化。如果愿意，我可以继续生成新的版面草案。',
    }))
    const service = new LayoutAnalysisService({ chat } as never)

    const result = await service.analyze(createRequest())

    expect(result.content).toContain('上午资讯带相对稳定')
    expect(result.details.summaryKind).toBe('layout_analysis')
    expect(Array.isArray(result.details.strengths)).toBe(true)
    expect((result.details.strengths as string[]).length).toBeGreaterThan(0)
    expect(chat).toHaveBeenCalledTimes(1)

    const prompt = chat.mock.calls[0]?.[0]?.map((message: { content: string }) => message.content).join('\n')
    expect(prompt).toContain('看东方')
    expect(prompt).toContain('东方看大剧')
    expect(prompt).toContain('测试版面')
    expect(prompt).toContain('晚间栏目定位与版面预期不完全一致')
    expect(prompt).toContain('输出 2 到 4 段短段落')
    expect(prompt).toContain('建议每段以简短行首标签开头')
    expect(prompt).toContain('总长度控制在 220 到 420 个中文字符以内')
  })

  it('LLM 不可用时会回退到本地自然文本分析', async () => {
    const chat = vi.fn(async () => {
      throw new Error('LLM unavailable')
    })
    const service = new LayoutAnalysisService({ chat } as never)

    const result = await service.analyze(createRequest({
      userInput: '请分析当前版面编排',
      currentSchedule: [
        {
          id: 'item-0700',
          programName: '看东方',
          startTime: '07:00:00',
          endTime: '09:00:00',
          duration: 7200,
          programType: 'news_magazine',
        },
      ],
    }))

    expect(result.content).toContain('广电节目编辑视角')
    expect(result.content).toContain('如果你愿意')
    expect(result.content).toContain('\n\n')
    expect(result.details.analysisSource).toBe('fallback')
  })

  it('混合时段不会再被算成完全命中', async () => {
    const chat = vi.fn(async () => ({
      content: '请重点查看晨间栏目结构。',
    }))
    const service = new LayoutAnalysisService({ chat } as never)

    const result = await service.analyze(createRequest({
      currentSchedule: [
        {
          id: 'item-0700',
          programName: '看东方',
          startTime: '07:00:00',
          endTime: '08:00:00',
          duration: 3600,
          programType: 'news_magazine',
        },
        {
          id: 'item-0800',
          programName: '晨间剧场',
          startTime: '08:00:00',
          endTime: '09:00:00',
          duration: 3600,
          programType: 'drama',
        },
      ],
    }))

    expect(result.details.alignedSlotCount).toBe(0)
    expect(result.details.mismatchSlotCount).toBeGreaterThanOrEqual(1)
  })

  it('用户要求联网分析但没有检索材料时会明确标注为本地分析', async () => {
    const chat = vi.fn(async () => ({
      content: '从节目节奏看，晚间结构仍需调整。',
    }))
    const service = new LayoutAnalysisService({ chat } as never)

    const result = await service.analyze(createRequest({
      userInput: '请结合网络和热点分析当前版面编排',
    }))

    expect(result.content).toContain('说明：')
    expect(result.content).toContain('当前系统没有提供外部检索材料')
    expect(result.details.analysisSource).toBe('llm_local_only')
    expect(result.details.webResearchStatus).toBe('unavailable')
    expect(result.details.webResearchNotice).toBeTruthy()
  })

  it('午间节目不会再被重复统计到下午时段', async () => {
    const chat = vi.fn(async () => {
      throw new Error('LLM unavailable')
    })
    const service = new LayoutAnalysisService({ chat } as never)

    const result = await service.analyze(createRequest({
      currentSchedule: [
        {
          id: 'item-1330',
          programName: '午间观察',
          startTime: '13:30:00',
          endTime: '14:00:00',
          duration: 1800,
          programType: 'news_magazine',
        },
      ],
    }))

    expect(result.details.daypartObservations).toEqual(['午间以资讯为主，涉及 1 条节目'])
  })
})
