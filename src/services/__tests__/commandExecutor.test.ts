import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AtomicCapabilities, resetAtomicCapabilities } from '@/services/atomicCapabilities'
import { CommandExecutor } from '@/services/commandExecutor'
import { resetCandidateService } from '@/services/candidateService'
import type {
  DeleteCommand,
  FillItemCommand,
  GapInfo,
  MoveCommand,
  PlanCommand,
  ScheduleItemSnapshot,
  UpdateFieldCommand,
  ValidationReport,
} from '@/types/orchestration'

const baseDate = '2026-03-25'

const iso = (time: string) => `${baseDate}T${time}+08:00`

const createValidationReport = (scope: 'item' | 'full'): ValidationReport => ({
  id: `validation-${scope}`,
  scope,
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

const createGap = (overrides: Partial<GapInfo> = {}): GapInfo => ({
  id: 'gap-1',
  startTime: iso('09:30:00'),
  endTime: iso('10:15:00'),
  duration: 2700,
  constraints: {},
  metadata: {
    source: 'generated',
    priority: 1,
    createdAt: iso('00:00:00'),
    updatedAt: iso('00:00:00'),
  },
  ...overrides,
})

describe('CommandExecutor', () => {
  beforeEach(() => {
    resetCandidateService()
    resetAtomicCapabilities()
  })

  it('preview(move) reports overlap risk when target range is occupied', async () => {
    const atomicCapabilities = new AtomicCapabilities({ enableAutoValidation: false })
    atomicCapabilities.loadItems([
      createItem(),
      createItem({
        id: 'item-2',
        programCode: 'CODE-002',
        startTime: iso('06:30:00'),
        endTime: iso('07:00:00'),
        sequence: 2,
      }),
    ])
    const executor = new CommandExecutor(atomicCapabilities, { enableAutoValidation: false })

    const command: MoveCommand = {
      action: 'move',
      data: {
        itemId: 'item-1',
        newStartTime: iso('06:15:00'),
      },
    }

    const preview = await executor.preview(command)

    expect(preview.affectedItems).toEqual(['item-1'])
    expect(preview.risks).toContain('目标时间段与其他条目重叠')
    expect(preview.canExecute).toBe(false)
  })

  it('execute(move) blocks occupied target ranges before changing the schedule', async () => {
    const atomicCapabilities = new AtomicCapabilities({ enableAutoValidation: false })
    atomicCapabilities.loadItems([
      createItem(),
      createItem({
        id: 'item-2',
        programCode: 'CODE-002',
        startTime: iso('06:30:00'),
        endTime: iso('07:00:00'),
        sequence: 2,
      }),
    ])
    const executor = new CommandExecutor(atomicCapabilities, { enableAutoValidation: false })

    const result = await executor.execute({
      action: 'move',
      data: {
        itemId: 'item-1',
        newStartTime: iso('06:15:00'),
      },
    })

    expect(result.success).toBe(false)
    expect(result.error).toBe('time_range_overlap')
    expect(atomicCapabilities.getItem('item-1')?.startTime).toBe(iso('06:00:00'))
  })

  it('preview(move) reports sequence risk when moving a later episode before an earlier one', async () => {
    const atomicCapabilities = new AtomicCapabilities({ enableAutoValidation: false })
    atomicCapabilities.loadItems([
      createItem({
        id: 'episode-1',
        programCode: '881120030001',
        programName: '品质剧场：纵有疾风起 第1集',
        startTime: iso('09:00:00'),
        endTime: iso('09:45:00'),
        duration: 2700,
        programType: 'drama',
        sequence: 1,
      }),
      createItem({
        id: 'episode-2',
        programCode: '881120030002',
        programName: '品质剧场：纵有疾风起 第2集',
        startTime: iso('10:00:00'),
        endTime: iso('10:45:00'),
        duration: 2700,
        programType: 'drama',
        sequence: 2,
      }),
    ])
    const executor = new CommandExecutor(atomicCapabilities, { enableAutoValidation: false })

    const command: MoveCommand = {
      action: 'move',
      data: {
        itemId: 'episode-2',
        newStartTime: iso('08:00:00'),
      },
    }

    const preview = await executor.preview(command)

    expect(preview.risks.some((risk) => risk.includes('顺播倒序'))).toBe(true)
    expect(preview.canExecute).toBe(false)
  })

  it('execute(move) blocks moving a later episode before an earlier one', async () => {
    const atomicCapabilities = new AtomicCapabilities({ enableAutoValidation: false })
    atomicCapabilities.loadItems([
      createItem({
        id: 'episode-1',
        programCode: '881120030001',
        programName: '品质剧场：纵有疾风起 第1集',
        startTime: iso('09:00:00'),
        endTime: iso('09:45:00'),
        duration: 2700,
        programType: 'drama',
        sequence: 1,
      }),
      createItem({
        id: 'episode-2',
        programCode: '881120030002',
        programName: '品质剧场：纵有疾风起 第2集',
        startTime: iso('10:00:00'),
        endTime: iso('10:45:00'),
        duration: 2700,
        programType: 'drama',
        sequence: 2,
      }),
    ])
    const executor = new CommandExecutor(atomicCapabilities, { enableAutoValidation: false })

    const result = await executor.execute({
      action: 'move',
      data: {
        itemId: 'episode-2',
        newStartTime: iso('08:00:00'),
      },
    })

    expect(result.success).toBe(false)
    expect(result.message).toContain('顺播倒序')
    expect(atomicCapabilities.getItem('episode-2')?.startTime).toBe(iso('10:00:00'))
  })

  it('preview(fill_item) warns when gap is missing', async () => {
    const executor = new CommandExecutor(new AtomicCapabilities({ enableAutoValidation: false }))

    const command: FillItemCommand = {
      action: 'fill_item',
      data: {
        gapId: 'missing-gap',
        selectedCandidateId: 'candidate-1',
        selectionReason: 'test',
      },
    }

    const preview = await executor.preview(command)
    expect(preview.warnings).toContain('Gap not found: missing-gap')
    expect(preview.canExecute).toBe(false)
  })

  it('execute(delete) removes item and returns full validation report', async () => {
    const onValidation = vi.fn(async (scope: 'item' | 'full') => createValidationReport(scope))
    const atomicCapabilities = new AtomicCapabilities(undefined, onValidation)
    atomicCapabilities.loadItems([
      createItem(),
    ])
    const executor = new CommandExecutor(atomicCapabilities, undefined, onValidation)

    const command: DeleteCommand = {
      action: 'delete',
      data: {
        itemId: 'item-1',
      },
    }

    const result = await executor.execute(command)

    expect(result.success).toBe(true)
    expect(result.validationReport?.scope).toBe('full')
    expect(atomicCapabilities.getItem('item-1')).toBeUndefined()
  })

  it('execute(update_field) updates field and recalculates end time', async () => {
    const onValidation = vi.fn(async (scope: 'item' | 'full') => createValidationReport(scope))
    const atomicCapabilities = new AtomicCapabilities(undefined, onValidation)
    atomicCapabilities.loadItems([
      createItem(),
    ])
    const executor = new CommandExecutor(atomicCapabilities, undefined, onValidation)

    const command: UpdateFieldCommand = {
      action: 'update_field',
      data: {
        itemId: 'item-1',
        field: 'duration',
        value: 3600,
      },
    }

    const result = await executor.execute(command)

    expect(result.success).toBe(true)
    expect(result.validationReport?.scope).toBe('item')
    expect(atomicCapabilities.getItem('item-1')?.endTime).toBe(iso('07:00:00'))
  })

  it('preview(update_field) reports overlap when duration extends into the next item', async () => {
    const atomicCapabilities = new AtomicCapabilities({ enableAutoValidation: false })
    atomicCapabilities.loadItems([
      createItem(),
      createItem({
        id: 'item-2',
        programCode: 'CODE-002',
        startTime: iso('06:30:00'),
        endTime: iso('07:00:00'),
        sequence: 2,
      }),
    ])
    const executor = new CommandExecutor(atomicCapabilities, { enableAutoValidation: false })

    const preview = await executor.preview({
      action: 'update_field',
      data: {
        itemId: 'item-1',
        field: 'duration',
        value: 3600,
      },
    })

    expect(preview.risks).toContain('目标时间段与其他条目重叠')
    expect(preview.canExecute).toBe(false)
  })

  it('execute(update_field) blocks duration updates that would overlap the next item', async () => {
    const atomicCapabilities = new AtomicCapabilities({ enableAutoValidation: false })
    atomicCapabilities.loadItems([
      createItem(),
      createItem({
        id: 'item-2',
        programCode: 'CODE-002',
        startTime: iso('06:30:00'),
        endTime: iso('07:00:00'),
        sequence: 2,
      }),
    ])
    const executor = new CommandExecutor(atomicCapabilities, { enableAutoValidation: false })

    const result = await executor.execute({
      action: 'update_field',
      data: {
        itemId: 'item-1',
        field: 'duration',
        value: 3600,
      },
    })

    expect(result.success).toBe(false)
    expect(result.error).toBe('time_range_overlap')
    expect(atomicCapabilities.getItem('item-1')?.duration).toBe(1800)
  })

  it('execute(update_field) blocks startTime updates that would break episode order', async () => {
    const atomicCapabilities = new AtomicCapabilities({ enableAutoValidation: false })
    atomicCapabilities.loadItems([
      createItem({
        id: 'episode-1',
        programCode: '881120030001',
        programName: '品质剧场：纵有疾风起 第1集',
        startTime: iso('09:00:00'),
        endTime: iso('09:45:00'),
        duration: 2700,
        programType: 'drama',
        sequence: 1,
      }),
      createItem({
        id: 'episode-2',
        programCode: '881120030002',
        programName: '品质剧场：纵有疾风起 第2集',
        startTime: iso('10:00:00'),
        endTime: iso('10:45:00'),
        duration: 2700,
        programType: 'drama',
        sequence: 2,
      }),
    ])
    const executor = new CommandExecutor(atomicCapabilities, { enableAutoValidation: false })

    const result = await executor.execute({
      action: 'update_field',
      data: {
        itemId: 'episode-2',
        field: 'startTime',
        value: iso('08:00:00'),
      },
    })

    expect(result.success).toBe(false)
    expect(result.message).toContain('顺播倒序')
    expect(atomicCapabilities.getItem('episode-2')?.startTime).toBe(iso('10:00:00'))
  })

  it('execute(plan) returns selected strategy information', async () => {
    const executor = new CommandExecutor(new AtomicCapabilities({ enableAutoValidation: false }))
    const command: PlanCommand = {
      action: 'plan',
      data: {
        strategy: {
          target: 'daily-plan',
          referencePriority: ['layout', 'history', 'library'],
          allowFiller: true,
          sequentialPreference: true,
          riskPreference: 'balanced',
        },
        initialGapCount: 3,
        estimatedSteps: 5,
      },
    }

    const result = await executor.execute(command)

    expect(result.success).toBe(true)
    expect(result.message).toContain('daily-plan')
  })

  it('preview(insert) marks occupied range as risky', async () => {
    const atomicCapabilities = new AtomicCapabilities({ enableAutoValidation: false })
    atomicCapabilities.loadItems([
      createItem({
        startTime: iso('13:00:00'),
        endTime: iso('13:30:00'),
      }),
    ])
    const executor = new CommandExecutor(atomicCapabilities, { enableAutoValidation: false })
    executor.setGaps([
      createGap(),
    ])

    const preview = await executor.preview({
      action: 'insert',
      data: {
        candidateId: '002601050001',
        insertTime: '13:00',
        scheduleDate: baseDate,
      },
    })

    expect(preview.risks).toContain('目标时间段已被占用')
    expect(preview.canExecute).toBe(false)
  })
})
