import { afterEach, describe, expect, it } from 'vitest'

import { clearRuntimeLayout, setRuntimeLayout } from '@/services/orchestration/runtimeLayoutRegistry'
import { ValidationEngine, type ValidationContext } from '@/services/validators/validationEngine'
import type { FixedItem, GapInfo, LayoutSlot, ScheduleItemSnapshot } from '@/types/orchestration'

const baseDate = '2026-03-25'

const iso = (time: string) => `${baseDate}T${time}+08:00`

afterEach(() => {
  clearRuntimeLayout('dragon', baseDate)
})

const createItem = (overrides: Partial<ScheduleItemSnapshot> = {}): ScheduleItemSnapshot => ({
  id: 'item-1',
  programCode: 'CODE-001',
  programName: '测试节目',
  startTime: iso('06:00:00'),
  endTime: iso('06:30:00'),
  duration: 1800,
  programType: 'news',
  sequence: 1,
  ...overrides,
})

const createGap = (overrides: Partial<GapInfo> = {}): GapInfo => ({
  id: 'gap-1',
  startTime: iso('06:30:00'),
  endTime: iso('06:45:00'),
  duration: 900,
  constraints: {},
  metadata: {
    source: 'generated',
    priority: 1,
    createdAt: iso('00:00:00'),
    updatedAt: iso('00:00:00'),
  },
  ...overrides,
})

const createSlot = (overrides: Partial<LayoutSlot> = {}): LayoutSlot => ({
  id: 'slot-1',
  channelId: 'dragon',
  columnId: '115',
  startTime: iso('06:00:00'),
  endTime: iso('07:00:00'),
  ...overrides,
})

const createContext = (overrides: Partial<ValidationContext> = {}): ValidationContext => ({
  items: [],
  gaps: [],
  fixedItems: [] as FixedItem[],
  layoutSlots: [] as LayoutSlot[],
  dayStartTime: iso('06:00:00'),
  dayEndTime: iso('08:00:00'),
  ...overrides,
})

describe('ValidationEngine', () => {
  it('识别节目重叠并标记为 critical', () => {
    const engine = new ValidationEngine()
    const report = engine.validate(createContext({
      items: [
        createItem({
          id: 'item-a',
          programName: '早间新闻',
          startTime: iso('06:00:00'),
          endTime: iso('06:40:00'),
          duration: 2400,
        }),
        createItem({
          id: 'item-b',
          programCode: 'CODE-002',
          programName: '晨间观察',
          startTime: iso('06:35:00'),
          endTime: iso('07:00:00'),
          duration: 1500,
          sequence: 2,
        }),
      ],
      dayEndTime: iso('07:00:00'),
    }))

    expect(report.summary.criticalCount).toBe(1)
    const overlapIssue = report.issues.find((issue) => issue.type === 'overlap')
    expect(overlapIssue).toBeTruthy()
    expect(overlapIssue?.location.relatedItemIds).toEqual(['item-a', 'item-b'])
    expect(report.isValid).toBe(false)
  })

  it('识别首尾边界未对齐', () => {
    const engine = new ValidationEngine()
    const report = engine.validate(createContext({
      items: [
        createItem({
          startTime: iso('06:10:00'),
          endTime: iso('07:40:00'),
          duration: 5400,
        }),
      ],
    }))

    const boundaryIssues = report.issues.filter((issue) => issue.type === 'boundary_mismatch')
    expect(boundaryIssues).toHaveLength(2)
  })

  it('validateItem 会识别时长不一致', () => {
    const engine = new ValidationEngine()
    const item = createItem({
      duration: 1200,
      endTime: iso('06:30:00'),
    })

    const report = engine.validateItem(item, createContext({ items: [item] }))

    expect(report.issues.some((issue) => issue.type === 'duration_mismatch')).toBe(true)
    expect(report.summary.warningCount).toBeGreaterThan(0)
  })

  it('validateItem 会结合上下文识别单条节目造成的顺播倒序', () => {
    const engine = new ValidationEngine()
    const movedEpisode = createItem({
      id: 'episode-2-at-0800',
      programCode: '002601120002',
      programName: '品质剧场：纵有疾风起 第2集',
      startTime: iso('08:00:00'),
      endTime: iso('08:45:00'),
      duration: 2700,
      programType: 'drama',
    })
    const existingEpisode = createItem({
      id: 'episode-1-at-0900',
      programCode: '002601120001',
      programName: '品质剧场：纵有疾风起 第1集',
      startTime: iso('09:00:00'),
      endTime: iso('09:45:00'),
      duration: 2700,
      programType: 'drama',
    })

    const report = engine.validateItem(
      movedEpisode,
      createContext({
        items: [movedEpisode, existingEpisode],
        dayStartTime: iso('08:00:00'),
        dayEndTime: iso('09:45:00'),
      }),
    )

    expect(report.isValid).toBe(false)
    expect(report.issues.some((issue) => issue.message.includes('顺播倒序'))).toBe(true)
  })

  it('根据版面栏目识别节目类型不匹配', () => {
    const engine = new ValidationEngine()
    const report = engine.validate(createContext({
      items: [
        createItem({
          programType: 'drama',
        }),
      ],
      layoutSlots: [
        createSlot({
          columnId: '115',
        }),
      ],
      dayEndTime: iso('06:30:00'),
    }))

    expect(report.issues.some((issue) => issue.type === 'constraint_violation')).toBe(true)
  })

  it('识别同一剧集在既有编排单中的顺播倒序', () => {
    const engine = new ValidationEngine()
    const report = engine.validate(createContext({
      items: [
        createItem({
          id: 'episode-2-at-0800',
          programCode: '002601120002',
          programName: '品质剧场：纵有疾风起 第2集',
          startTime: iso('08:00:00'),
          endTime: iso('08:45:00'),
          duration: 2700,
          programType: 'drama',
          sequence: 1,
        }),
        createItem({
          id: 'episode-1-at-0900',
          programCode: '002601120001',
          programName: '品质剧场：纵有疾风起 第1集',
          startTime: iso('09:00:00'),
          endTime: iso('09:45:00'),
          duration: 2700,
          programType: 'drama',
          sequence: 2,
        }),
      ],
      dayStartTime: iso('08:00:00'),
      dayEndTime: iso('09:45:00'),
    }))

    const issue = report.issues.find((entry) =>
      entry.type === 'constraint_violation' && entry.message.includes('顺播倒序'),
    )
    expect(issue).toBeTruthy()
    expect(issue?.severity).toBe('critical')
    expect(issue?.location.relatedItemIds).toEqual(['episode-2-at-0800', 'episode-1-at-0900'])
    expect(report.isValid).toBe(false)
  })

  it('同一剧集按正常集数递增播出时不会触发顺播倒序', () => {
    const engine = new ValidationEngine()
    const report = engine.validate(createContext({
      items: [
        createItem({
          id: 'episode-1-at-0800',
          programCode: '002601120001',
          programName: '品质剧场：纵有疾风起 第1集',
          startTime: iso('08:00:00'),
          endTime: iso('08:45:00'),
          duration: 2700,
          programType: 'drama',
          sequence: 1,
        }),
        createItem({
          id: 'episode-2-at-0900',
          programCode: '002601120002',
          programName: '品质剧场：纵有疾风起 第2集',
          startTime: iso('09:00:00'),
          endTime: iso('09:45:00'),
          duration: 2700,
          programType: 'drama',
          sequence: 2,
        }),
      ],
      dayStartTime: iso('08:00:00'),
      dayEndTime: iso('09:45:00'),
    }))

    expect(report.issues.some((entry) => entry.message.includes('顺播倒序'))).toBe(false)
  })

  it('识别同一剧集在既有编排单中的顺播跳集', () => {
    const engine = new ValidationEngine()
    const report = engine.validate(createContext({
      items: [
        createItem({
          id: 'episode-1-at-0800',
          programCode: '002601120001',
          programName: '品质剧场：纵有疾风起 第1集',
          startTime: iso('08:00:00'),
          endTime: iso('08:45:00'),
          duration: 2700,
          programType: 'drama',
          sequence: 1,
        }),
        createItem({
          id: 'episode-3-at-0900',
          programCode: '002601120003',
          programName: '品质剧场：纵有疾风起 第3集',
          startTime: iso('09:00:00'),
          endTime: iso('09:45:00'),
          duration: 2700,
          programType: 'drama',
          sequence: 2,
        }),
      ],
      dayStartTime: iso('08:00:00'),
      dayEndTime: iso('09:45:00'),
    }))

    const issue = report.issues.find((entry) =>
      entry.type === 'constraint_violation' && entry.message.includes('顺播跳集'),
    )
    expect(issue).toBeTruthy()
    expect(issue?.severity).toBe('critical')
    expect(issue?.location.relatedItemIds).toEqual(['episode-1-at-0800', 'episode-3-at-0900'])
    expect(report.isValid).toBe(false)
  })

  it('只把超过 60 秒的空窗记为待处理问题', () => {
    const engine = new ValidationEngine()
    const report = engine.validate(createContext({
      gaps: [
        createGap({ id: 'gap-short', duration: 60, endTime: iso('06:31:00') }),
        createGap({ id: 'gap-long', startTime: iso('06:31:00'), endTime: iso('06:35:00'), duration: 240 }),
      ],
      dayEndTime: iso('06:35:00'),
    }))

    const gapIssues = report.issues.filter((issue) => issue.type === 'gap')
    expect(gapIssues).toHaveLength(1)
    expect(gapIssues[0]?.location.gapId).toBe('gap-long')
  })

  it('blocks a program that misses concrete layout intent keywords', () => {
    const columnId = 'runtime-column:dragon:2026-03-25:life-tree'
    setRuntimeLayout({
      sourceFileName: 'intent-keyword-test.xlsx',
      channelId: 'dragon',
      date: baseDate,
      warnings: [],
      layoutReference: {
        id: 'layout:intent-keyword-test',
        name: 'intent keyword test',
        slots: [createSlot({ columnId })],
      },
      columns: [{
        columnId,
        columnName: '生命树电视剧',
        channelId: 'dragon',
        defaultProgramType: 'drama',
        semanticLabel: '生命树电视剧',
        queryHints: ['生命树电视剧'],
        source: 'generated',
      }],
    })

    const engine = new ValidationEngine()
    const report = engine.validate(createContext({
      items: [
        createItem({
          id: 'wrong-drama',
          programCode: '002601240001',
          programName: '梦想剧场：归路 第1集',
          programType: 'drama',
        }),
      ],
      layoutSlots: [createSlot({ columnId })],
      dayEndTime: iso('06:30:00'),
    }))

    const issue = report.issues.find((entry) =>
      entry.type === 'constraint_violation' && entry.message.includes('明确关键词'),
    )
    expect(issue).toBeTruthy()
    expect(issue?.severity).toBe('critical')
    expect(report.isValid).toBe(false)
  })

  it('blocks a program that matches the title but misses the explicit episode requirement', () => {
    const columnId = 'runtime-column:dragon:2026-03-25:episode-5'
    setRuntimeLayout({
      sourceFileName: 'explicit-episode-test.xlsx',
      channelId: 'dragon',
      date: baseDate,
      warnings: [],
      layoutReference: {
        id: 'layout:explicit-episode-test',
        name: 'explicit episode test',
        slots: [createSlot({ columnId })],
      },
      columns: [{
        columnId,
        columnName: '纵有疾风起第5集',
        channelId: 'dragon',
        defaultProgramType: 'drama',
        semanticLabel: '纵有疾风起第5集',
        queryHints: ['纵有疾风起 第5集'],
        source: 'generated',
      }],
    })

    const engine = new ValidationEngine()
    const report = engine.validate(createContext({
      items: [
        createItem({
          id: 'wrong-episode',
          programCode: '881120030006',
          programName: '品质剧场：纵有疾风起 第6集',
          programType: 'drama',
        }),
      ],
      layoutSlots: [createSlot({ columnId })],
      dayEndTime: iso('06:30:00'),
    }))

    const issue = report.issues.find((entry) =>
      entry.type === 'constraint_violation' && entry.message.includes('指定集数/期数'),
    )
    expect(issue).toBeTruthy()
    expect(issue?.severity).toBe('critical')
    expect(report.isValid).toBe(false)
  })

  it('blocks a program that misses functional layout intent such as guide or preheat', () => {
    const columnId = 'runtime-column:dragon:2026-03-25:live-guide'
    setRuntimeLayout({
      sourceFileName: 'functional-keyword-test.xlsx',
      channelId: 'dragon',
      date: baseDate,
      warnings: [],
      layoutReference: {
        id: 'layout:functional-keyword-test',
        name: 'functional keyword test',
        slots: [createSlot({ columnId })],
      },
      columns: [{
        columnId,
        columnName: '现场导视',
        channelId: 'dragon',
        defaultProgramType: 'news_magazine',
        semanticLabel: '现场导视',
        queryHints: ['现场导视'],
        source: 'generated',
      }],
    })

    const engine = new ValidationEngine()
    const report = engine.validate(createContext({
      items: [
        createItem({
          id: 'generic-news',
          programCode: '002601030001',
          programName: '东方新闻',
          programType: 'news_magazine',
        }),
      ],
      layoutSlots: [createSlot({ columnId })],
      dayEndTime: iso('06:30:00'),
    }))

    const issue = report.issues.find((entry) =>
      entry.type === 'constraint_violation' && entry.message.includes('功能型内容要求'),
    )
    expect(issue).toBeTruthy()
    expect(issue?.severity).toBe('critical')
    expect(report.isValid).toBe(false)
  })

  it('blocks a program when structured column evidence appears only in title or content fields', () => {
    const columnId = 'runtime-column:dragon:2026-03-25:structured-field-keywords'
    setRuntimeLayout({
      sourceFileName: 'structured-field-keyword-test.xlsx',
      channelId: 'dragon',
      date: baseDate,
      warnings: [],
      layoutReference: {
        id: 'layout:structured-field-keyword-test',
        name: 'structured field keyword test',
        slots: [createSlot({ columnId })],
      },
      columns: [{
        columnId,
        columnName: '静安寺轮播',
        channelId: 'dragon',
        defaultProgramType: 'news_magazine',
        semanticLabel: '静安寺轮播',
        queryHints: ['所属栏目看东方', '节目内容静安寺'],
        source: 'generated',
      }],
    })

    const engine = new ValidationEngine()
    const report = engine.validate(createContext({
      items: [
        createItem({
          id: 'wrong-field-live',
          programCode: 'LIVE-WRONG-FIELD-001',
          programName: '看东方：静安寺外场直播 第1期',
          instanceName: '看东方：静安寺外场直播 第1期',
          columnName: 'ShanghaiEye',
          contentTags: ['看东方', '静安寺', '外场直播'],
          programType: 'news_magazine',
        }),
      ],
      layoutSlots: [createSlot({ columnId })],
      dayEndTime: iso('06:30:00'),
    }))

    const issue = report.issues.find((entry) =>
      entry.type === 'constraint_violation' && entry.message.includes('column:看东方'),
    )
    expect(issue).toBeTruthy()
    expect(issue?.severity).toBe('critical')
    expect(report.isValid).toBe(false)
  })

  it('does not hard-block generic layout labels without concrete keywords', () => {
    const columnId = 'runtime-column:dragon:2026-03-25:generic-drama'
    setRuntimeLayout({
      sourceFileName: 'generic-keyword-test.xlsx',
      channelId: 'dragon',
      date: baseDate,
      warnings: [],
      layoutReference: {
        id: 'layout:generic-keyword-test',
        name: 'generic keyword test',
        slots: [createSlot({ columnId })],
      },
      columns: [{
        columnId,
        columnName: '电视剧',
        channelId: 'dragon',
        defaultProgramType: 'drama',
        semanticLabel: '电视剧',
        queryHints: ['电视剧'],
        source: 'generated',
      }],
    })

    const engine = new ValidationEngine()
    const report = engine.validate(createContext({
      items: [
        createItem({
          id: 'any-drama',
          programCode: '002601240001',
          programName: '梦想剧场：归路 第1集',
          programType: 'drama',
        }),
      ],
      layoutSlots: [createSlot({ columnId })],
      dayEndTime: iso('06:30:00'),
    }))

    expect(report.issues.some((entry) => entry.message.includes('明确关键词'))).toBe(false)
    expect(report.isValid).toBe(true)
  })
})
