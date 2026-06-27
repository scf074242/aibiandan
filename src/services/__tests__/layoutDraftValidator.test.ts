import { describe, expect, it } from 'vitest'

import { LayoutDraftValidator } from '@/services/layoutDraftValidator'
import type { LayoutDraftSpec } from '@/types/orchestration'

describe('LayoutDraftValidator', () => {
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
