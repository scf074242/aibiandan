import { describe, expect, it } from 'vitest'

import { LayoutDraftValidator } from '@/services/layoutDraftValidator'
import type { LayoutDraftSpec } from '@/types/orchestration'

describe('LayoutDraftValidator', () => {
  it('对模型缺失的 spec 返回结构化失败而不是抛出异常', () => {
    const regressionCase = {
      id: 'layout-draft-invalid-spec-exposes-failure',
      userInput: '生成一份下午版面草案',
      expectedDecision: '返回 invalid_spec 校验错误并保留现场',
      mustNotHappen: '抛出空指针或本地补造 coverage/segments',
      verification: 'validateSpec(undefined) 返回 ok=false 且错误码为 invalid_spec',
    }
    const validator = new LayoutDraftValidator()

    const result = validator.validateSpec(undefined)

    expect(regressionCase.id).toBe('layout-draft-invalid-spec-exposes-failure')
    expect(result.ok).toBe(false)
    expect(result.errors).toEqual([
      expect.objectContaining({
        code: 'invalid_spec',
        message: expect.stringContaining('本轮未生成或修改草案'),
      }),
    ])
  })

  it('会接受覆盖完整且无重叠的 spec', () => {
    const validator = new LayoutDraftValidator()
    const spec: LayoutDraftSpec = {
      coverage: {
        start: '06:00:00',
        end: '12:00:00',
      },
      segments: [
        {
          label: '新闻',
          startTime: '06:00:00',
          endTime: '09:00:00',
          programType: 'news',
        },
        {
          label: '资讯',
          startTime: '09:00:00',
          endTime: '12:00:00',
          programType: 'news_magazine',
        },
      ],
    }

    const result = validator.validateSpec(spec)
    expect(result.ok).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('会拒绝存在重叠和覆盖空洞的 spec', () => {
    const validator = new LayoutDraftValidator()
    const spec: LayoutDraftSpec = {
      coverage: {
        start: '06:00:00',
        end: '12:00:00',
      },
      segments: [
        {
          label: '新闻',
          startTime: '06:00:00',
          endTime: '09:30:00',
          programType: 'news',
        },
        {
          label: '资讯',
          startTime: '09:00:00',
          endTime: '11:00:00',
          programType: 'news_magazine',
        },
      ],
    }

    const result = validator.validateSpec(spec)
    expect(result.ok).toBe(false)
    expect(result.errors.some((issue) => issue.code === 'segment_overlap')).toBe(true)
    expect(result.errors.some((issue) => issue.code === 'segment_gap')).toBe(true)
  })
})
