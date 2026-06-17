import { describe, expect, it, vi } from 'vitest'

import { LayoutDraftService } from '@/services/layoutDraftService'
import type { LayoutDraft } from '@/types/orchestration'

const createDraft = (): LayoutDraft => ({
  id: 'draft-1',
  channelId: 'dragon',
  date: '2026-03-25',
  version: 1,
  source: 'channel_default',
  userIntent: '当前版面',
  coverage: {
    start: '06:00:00',
    end: '23:59:59',
  },
  layoutReference: {
    id: 'layout-1',
    name: '测试版面',
    slots: [
      {
        id: 'slot-1',
        channelId: 'dragon',
        startTime: '2026-03-25T22:00:00+08:00',
        endTime: '2026-03-25T22:30:00+08:00',
        columnId: 'runtime-column:today',
      },
      {
        id: 'slot-2',
        channelId: 'dragon',
        startTime: '2026-03-25T22:30:00+08:00',
        endTime: '2026-03-25T23:00:00+08:00',
        columnId: 'runtime-column:focus',
      },
      {
        id: 'slot-3',
        channelId: 'dragon',
        startTime: '2026-03-25T23:00:00+08:00',
        endTime: '2026-03-25T23:30:00+08:00',
        columnId: 'runtime-column:talk',
      },
      {
        id: 'slot-4',
        channelId: 'dragon',
        startTime: '2026-03-25T23:30:00+08:00',
        endTime: '2026-03-25T23:59:59+08:00',
        columnId: 'runtime-column:dream',
      },
    ],
  },
  columns: [
    {
      columnId: 'runtime-column:today',
      columnName: '今晚',
      channelId: 'dragon',
      defaultProgramType: 'commentary',
      semanticLabel: '今晚',
      source: 'default',
    },
    {
      columnId: 'runtime-column:focus',
      columnName: '焦点',
      channelId: 'dragon',
      defaultProgramType: 'commentary',
      semanticLabel: '焦点',
      source: 'default',
    },
    {
      columnId: 'runtime-column:talk',
      columnName: '两说',
      channelId: 'dragon',
      defaultProgramType: 'commentary',
      semanticLabel: '两说',
      source: 'default',
    },
    {
      columnId: 'runtime-column:dream',
      columnName: '梦想剧场',
      channelId: 'dragon',
      defaultProgramType: 'drama',
      semanticLabel: '梦想剧场',
      source: 'default',
    },
  ],
})

const createLiveDraft = (): LayoutDraft => ({
  id: 'draft-live',
  channelId: 'dragon',
  date: '2026-03-25',
  version: 1,
  source: 'generated',
  userIntent: '静安寺户外直播',
  coverage: {
    start: '14:00:00',
    end: '15:00:00',
  },
  layoutReference: {
    id: 'layout-live',
    name: '直播草案',
    slots: [
      {
        id: 'slot-live',
        channelId: 'dragon',
        startTime: '2026-03-25T14:00:00+08:00',
        endTime: '2026-03-25T15:00:00+08:00',
        columnId: 'runtime-column:live',
      },
    ],
  },
  columns: [
    {
      columnId: 'runtime-column:live',
      columnName: '静安寺户外直播',
      channelId: 'dragon',
      defaultProgramType: 'news_magazine',
      semanticLabel: '静安寺户外直播',
      source: 'generated',
    },
  ],
})

describe('LayoutDraftService', () => {
  it('enriches LLM-generated outdoor live hints after parsing spec JSON', async () => {
    const chat = vi.fn(async () => ({
      content: JSON.stringify({
        coverage: { start: '14:00:00', end: '15:00:00' },
        segments: [
          {
            id: 'live',
            label: '静安寺户外直播',
            startTime: '14:00:00',
            endTime: '15:00:00',
            programType: 'news',
            queryHints: ['静安寺户外直播'],
          },
        ],
      }),
    }))
    const service = new LayoutDraftService({ chat } as never)

    const spec = await service.generateSpec({
      channelId: 'dragon',
      channelName: '东方卫视',
      date: '2026-03-25',
      userInput: '我准备在静安寺进行户外直播，准备一个14:00到15:00的轮播单',
      coverage: { start: '14:00:00', end: '15:00:00' },
      semanticLabel: '静安寺户外直播',
      programTypeHint: 'news_magazine',
    })

    expect(spec.segments[0]?.label).toBe('静安寺户外直播')
    expect(spec.segments[0]?.programType).toBe('news_magazine')
    expect(spec.segments[0]?.queryHints).toEqual(expect.arrayContaining([
      '静安寺户外直播',
      '静安寺',
      '直播',
      '外场直播',
    ]))
  })

  it('明确节目标题和集数时会纠正为电视剧顺播草案', async () => {
    const chat = vi.fn(async () => ({
      content: JSON.stringify({
        coverage: { start: '09:30:00', end: '10:15:00' },
        segments: [
          {
            id: 'explicit-title',
            label: '节目标题纵有疾风起第5集',
            startTime: '09:30:00',
            endTime: '10:15:00',
            programType: 'news_magazine',
            queryHints: ['节目标题纵有疾风起第5集'],
          },
        ],
      }),
    }))
    const service = new LayoutDraftService({ chat } as never)

    const spec = await service.generateSpec({
      channelId: 'dragon',
      channelName: '东方卫视',
      date: '2026-03-25',
      userInput: '09:30到10:15安排节目标题纵有疾风起第5集',
      coverage: { start: '09:30:00', end: '10:15:00' },
    })

    expect(spec.segments[0]?.programType).toBe('drama')
    expect(spec.segments[0]?.queryHints).toEqual(expect.arrayContaining([
      '节目标题纵有疾风起第5集',
      '电视剧',
      '剧场',
    ]))
  })

  it('在回退生成时保留自由业务短语标签', async () => {
    const service = new LayoutDraftService({
      chat: vi.fn(async () => {
        throw new Error('mock llm unavailable')
      }),
    } as never)

    const spec = await service.generateSpec({
      channelId: 'dragon',
      channelName: '东方卫视',
      date: '2026-03-25',
      userInput: '不参考当前版面参考，下午编入下午剧场节目',
    })

    expect(spec.coverage).toEqual({
      start: '13:00:00',
      end: '18:00:00',
    })
    expect(spec.segments).toHaveLength(1)
    expect(spec.segments[0]?.label).toBe('下午剧场')
    expect(spec.segments[0]?.programType).toBe('drama')
    expect(spec.segments[0]?.queryHints).toContain('下午剧场')
  })

  it('在回退微调时能删除命中的版面时段', async () => {
    const service = new LayoutDraftService({
      chat: vi.fn(async () => {
        throw new Error('mock llm unavailable')
      }),
    } as never)

    const spec = await service.refineSpec({
      channelId: 'dragon',
      channelName: '东方卫视',
      date: '2026-03-25',
      userInput: '去掉23点的两说',
      currentDraft: createDraft(),
    })

    expect(spec.segments.map((segment) => segment.label)).not.toContain('两说')
    expect(spec.segments.map((segment) => `${segment.startTime}-${segment.endTime}`)).toContain('22:30:00-23:00:00')
    expect(spec.segments.map((segment) => `${segment.startTime}-${segment.endTime}`)).toContain('23:30:00-23:59:59')
  })

  it('删除草案时段时不会把草案泛称当作栏目名', async () => {
    const chat = vi.fn(async () => {
      throw new Error('mock llm unavailable')
    })
    const service = new LayoutDraftService({
      chat,
    } as never)

    const spec = await service.refineSpec({
      channelId: 'dragon',
      channelName: '东方卫视',
      date: '2026-03-25',
      userInput: '删除22点的草案',
      currentDraft: createDraft(),
    })

    expect(chat).not.toHaveBeenCalled()
    expect(spec.segments.map((segment) => segment.label)).not.toContain('今晚')
    expect(spec.segments.map((segment) => `${segment.startTime}-${segment.endTime}`)).not.toContain('22:00:00-22:30:00')
    expect(spec.segments.map((segment) => `${segment.startTime}-${segment.endTime}`)).toContain('22:30:00-23:00:00')
  })

  it('短句微调没有显式新时间时不会采纳 LLM 扩大的覆盖范围', async () => {
    const chat = vi.fn(async () => ({
      content: JSON.stringify({
        coverage: { start: '13:30:00', end: '15:00:00' },
        segments: [
          {
            id: 'preheat',
            label: '静安寺户外直播预热',
            startTime: '13:30:00',
            endTime: '14:00:00',
            programType: 'news_magazine',
            queryHints: ['预热'],
          },
          {
            id: 'live',
            label: '静安寺户外直播',
            startTime: '14:00:00',
            endTime: '15:00:00',
            programType: 'news_magazine',
            queryHints: ['直播'],
          },
        ],
      }),
    }))
    const service = new LayoutDraftService({
      chat,
    } as never)

    const spec = await service.refineSpec({
      channelId: 'dragon',
      channelName: '东方卫视',
      date: '2026-03-25',
      userInput: '就按刚才那个主题加一点预热',
      currentDraft: createLiveDraft(),
      coverage: { start: '14:00:00', end: '15:00:00' },
      semanticLabel: '预热',
      programTypeHint: 'news_magazine',
    })

    expect(chat).toHaveBeenCalledTimes(1)
    expect(spec.coverage).toEqual({
      start: '14:00:00',
      end: '15:00:00',
    })
    expect(spec.segments).toHaveLength(1)
    expect(spec.segments[0]).toMatchObject({
      label: '预热',
      startTime: '14:00:00',
      endTime: '15:00:00',
      programType: 'news_magazine',
    })
  })
})
