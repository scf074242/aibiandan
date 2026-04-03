import { describe, expect, it, vi } from 'vitest'

import { AtomicCapabilities } from '@/services/atomicCapabilities'
import type { ScheduleItemSnapshot, ValidationReport } from '@/types/orchestration'

const baseDate = '2026-03-25'

const iso = (time: string) => `${baseDate}T${time}+08:00`

const createValidationReport = (): ValidationReport => ({
  id: 'validation-1',
  scope: 'full',
  targetId: 'schedule',
  timestamp: iso('00:00:00'),
  issues: [],
  summary: {
    totalIssues: 0,
    criticalCount: 0,
    warningCount: 0,
    infoCount: 0,
  },
  isValid: true,
})

const createItem = (overrides: Partial<ScheduleItemSnapshot> = {}): ScheduleItemSnapshot => ({
  id: 'item-1',
  programCode: 'CODE-001',
  programName: 'Test Program',
  startTime: iso('06:00:00'),
  endTime: iso('06:30:00'),
  duration: 1800,
  programType: 'news',
  sequence: 1,
  ...overrides,
})

describe('AtomicCapabilities', () => {
  it('appendItems normalizes sequence by start time and triggers full validation', async () => {
    const onValidation = vi.fn(async () => createValidationReport())
    const capabilities = new AtomicCapabilities(undefined, onValidation)

    const result = await capabilities.appendItems([
      createItem({
        id: 'item-late',
        startTime: iso('06:30:00'),
        endTime: iso('07:00:00'),
        sequence: 99,
      }),
      createItem({
        id: 'item-early',
        programCode: 'CODE-002',
        startTime: iso('06:00:00'),
        endTime: iso('06:30:00'),
        sequence: 99,
      }),
    ])

    expect(result.success).toBe(true)
    expect(capabilities.getAllItems().map((item) => item.id)).toEqual(['item-early', 'item-late'])
    expect(capabilities.getAllItems().map((item) => item.sequence)).toEqual([1, 2])
    expect(onValidation).toHaveBeenCalledWith('full')
  })

  it('moveItem updates time range and returns old/new affected ranges', async () => {
    const capabilities = new AtomicCapabilities({ enableAutoValidation: false })
    capabilities.loadItems([
      createItem(),
    ])

    const result = await capabilities.moveItem('item-1', iso('07:00:00'))

    expect(result.success).toBe(true)
    expect(result.data?.item.startTime).toBe(iso('07:00:00'))
    expect(result.data?.item.endTime).toBe(iso('07:30:00'))
    expect(result.data?.oldStartTime).toBe(iso('06:00:00'))
    expect(result.affectedTimeRanges).toEqual([
      { start: iso('06:00:00'), end: iso('06:30:00') },
      { start: iso('07:00:00'), end: iso('07:30:00') },
    ])
  })

  it('updateField recalculates endTime when duration changes', async () => {
    const capabilities = new AtomicCapabilities({ enableAutoValidation: false })
    capabilities.loadItems([
      createItem(),
    ])

    const result = await capabilities.updateField('item-1', 'duration', 3600)

    expect(result.success).toBe(true)
    expect(result.data?.oldValue).toBe(1800)
    expect(result.data?.newValue).toBe(3600)
    expect(result.data?.item.endTime).toBe(iso('07:00:00'))
  })

  it('deleteItem creates snapshot and restoreSnapshot rolls back deleted item', async () => {
    const capabilities = new AtomicCapabilities({ enableAutoValidation: false })
    capabilities.loadItems([
      createItem(),
    ])

    const deleteResult = await capabilities.deleteItem('item-1', { skipValidation: true })
    expect(deleteResult.success).toBe(true)
    expect(capabilities.getItem('item-1')).toBeUndefined()

    const restoreResult = capabilities.restoreSnapshot('item-1')
    expect(restoreResult.success).toBe(true)
    expect(capabilities.getItem('item-1')?.programName).toBe('Test Program')
  })

  it('isTimeRangeAvailable excludes the current item when item id is provided', async () => {
    const capabilities = new AtomicCapabilities({ enableAutoValidation: false })
    capabilities.loadItems([
      createItem(),
      createItem({
        id: 'item-2',
        programCode: 'CODE-002',
        startTime: iso('06:30:00'),
        endTime: iso('07:00:00'),
        sequence: 2,
      }),
    ])

    expect(capabilities.isTimeRangeAvailable(iso('06:00:00'), iso('06:30:00'), 'item-1')).toBe(true)
    expect(capabilities.isTimeRangeAvailable(iso('06:15:00'), iso('06:45:00'))).toBe(false)
  })
})
