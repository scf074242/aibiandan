import { describe, expect, it } from 'vitest'

import { ValidationEngine, type ValidationContext } from '@/services/validators/validationEngine'
import type { FixedItem, GapInfo, LayoutSlot, ScheduleItemSnapshot } from '@/types/orchestration'

const baseDate = '2026-03-25'

const iso = (time: string) => `${baseDate}T${time}+08:00`

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
})
