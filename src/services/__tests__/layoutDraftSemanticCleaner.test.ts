import { describe, expect, it } from 'vitest'

import {
  cleanLayoutDraftActionNoise,
  cleanLayoutDraftSemanticLabel,
  stripRestartSemanticDaypart,
} from '@/services/layoutDraftSemanticCleaner'

describe('layoutDraftSemanticCleaner', () => {
  it('removes draft action noise without inventing a semantic label', () => {
    expect(cleanLayoutDraftSemanticLabel('生成版面草案')).toBeUndefined()
    expect(cleanLayoutDraftSemanticLabel('新建轮播版面草案')).toBeUndefined()
    expect(cleanLayoutDraftActionNoise('9点到12点，编排东方剧场，生成版面草案')).toBe('编排东方剧场')
  })

  it('keeps real TV column names while removing scheduling verbs', () => {
    expect(cleanLayoutDraftSemanticLabel('保留现有节目补齐东方剧场')).toBe('东方剧场')
    expect(cleanLayoutDraftSemanticLabel('补齐当前所有空窗电视剧')).toBe('电视剧')
    expect(cleanLayoutDraftSemanticLabel('下午剧场')).toBe('下午剧场')
  })

  it('strips daypart only when restart grammar explicitly asks for a new label', () => {
    expect(cleanLayoutDraftSemanticLabel(stripRestartSemanticDaypart('晚间新闻'))).toBe('新闻')
    expect(cleanLayoutDraftSemanticLabel('晚间新闻')).toBe('晚间新闻')
  })
})
