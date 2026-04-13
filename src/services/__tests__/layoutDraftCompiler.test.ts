import { describe, expect, it } from 'vitest'

import { LayoutDraftCompiler } from '@/services/layoutDraftCompiler'
import type { LayoutDraftSpec } from '@/types/orchestration'

describe('LayoutDraftCompiler', () => {
  it('会把显式时间 spec 编译成 runtime layout draft', () => {
    const compiler = new LayoutDraftCompiler()
    const spec: LayoutDraftSpec = {
      coverage: {
        start: '06:00:00',
        end: '23:59:59',
      },
      segments: [
        {
          label: '上午新闻',
          startTime: '06:00:00',
          endTime: '12:00:00',
          programType: 'news',
          queryHints: ['新闻'],
        },
        {
          label: '黄金剧场',
          startTime: '12:00:00',
          endTime: '23:59:59',
          programType: 'drama',
          queryHints: ['黄金剧场', '电视剧'],
          sequential: true,
        },
      ],
    }

    const draft = compiler.compile(spec, {
      channelId: 'dragon',
      channelName: '东方卫视',
      date: '2026-04-09',
      userIntent: '全天都排电视剧，上午新闻',
      source: 'generated',
    })

    expect(draft.columns).toHaveLength(2)
    expect(draft.layoutReference.slots).toHaveLength(2)
    expect(draft.layoutReference.slots[0]?.startTime).toBe('2026-04-09T06:00:00+08:00')
    expect(draft.layoutReference.slots[1]?.endTime).toBe('2026-04-09T23:59:59+08:00')
    expect(draft.columns[1]?.columnId.startsWith('runtime-column:dragon:2026-04-09:')).toBe(true)
    expect(draft.columns[1]?.isSequential).toBe(true)
    expect(draft.columns[1]?.queryHints).toContain('黄金剧场')
  })
})
