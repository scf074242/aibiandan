import { beforeEach, describe, expect, it } from 'vitest'

import { getAtomicCapabilities, resetAtomicCapabilities } from '@/services/atomicCapabilities'
import { resetCandidateService } from '@/services/candidateService'
import { InsertCommandExecutor } from '@/services/insertCommandExecutor'
import type { InsertCommand, ScheduleItemSnapshot } from '@/types/orchestration'

const baseDate = '2026-03-25'
const iso = (time: string) => `${baseDate}T${time}+08:00`

const createExistingItem = (overrides: Partial<ScheduleItemSnapshot> = {}): ScheduleItemSnapshot => ({
  id: 'existing-0900',
  programCode: '002601120001',
  programName: '品质剧场：纵有疾风起 第1集',
  startTime: iso('09:00:00'),
  endTime: iso('09:45:00'),
  duration: 2700,
  programType: 'drama',
  sequence: 1,
  ...overrides,
})

const createInsertCommand = (overrides: Partial<InsertCommand['data']> = {}): InsertCommand => ({
  action: 'insert',
  reasoning: 'test insert',
  data: {
    candidateId: 'I112001-0002',
    candidateName: '品质剧场：纵有疾风起 第2集',
    insertTime: '08:00:00',
    scheduleDate: baseDate,
    channelId: 'dragon',
    ...overrides,
  },
})

describe('InsertCommandExecutor sequence context guard', () => {
  beforeEach(async () => {
    resetCandidateService()
    resetAtomicCapabilities()
    await getAtomicCapabilities().clearAll()
  })

  it('preview blocks inserting a later episode before an existing earlier episode', async () => {
    await getAtomicCapabilities().appendItems([createExistingItem()], { skipValidation: true })
    const executor = new InsertCommandExecutor()

    const preview = executor.preview(createInsertCommand())

    expect(preview.canExecute).toBe(false)
    expect(preview.warnings.some((warning) => warning.includes('顺播倒序'))).toBe(true)
  })

  it('execute blocks inserting a later episode before an existing earlier episode', async () => {
    await getAtomicCapabilities().appendItems([createExistingItem()], { skipValidation: true })
    const executor = new InsertCommandExecutor()

    const result = await executor.execute(createInsertCommand())

    expect(result.success).toBe(false)
    expect(result.message).toContain('顺播倒序')
    expect(getAtomicCapabilities().getAllItems()).toHaveLength(1)
  })

  it('execute blocks title-based reverse order even when program codes do not share a prefix', async () => {
    await getAtomicCapabilities().appendItems([
      createExistingItem({
        programCode: 'LEGACY-DRAMA-A',
        programName: '品质剧场：纵有疾风起 第1集',
      }),
    ], { skipValidation: true })
    const executor = new InsertCommandExecutor()

    const result = await executor.execute(createInsertCommand({
      candidateId: 'I112001-0002',
      insertTime: '08:00:00',
    }))

    expect(result.success).toBe(false)
    expect(result.message).toContain('顺播倒序')
    expect(getAtomicCapabilities().getAllItems()).toHaveLength(1)
  })

  it('execute blocks inserting an earlier episode after an existing later episode', async () => {
    await getAtomicCapabilities().appendItems([
      createExistingItem({
        id: 'existing-0900-episode-2',
        programCode: '002601120002',
        programName: '品质剧场：纵有疾风起 第2集',
        sequence: 2,
      }),
    ], { skipValidation: true })
    const executor = new InsertCommandExecutor()

    const result = await executor.execute(createInsertCommand({
      candidateId: 'I112001-0001',
      candidateName: '品质剧场：纵有疾风起 第1集',
      insertTime: '10:00:00',
    }))

    expect(result.success).toBe(false)
    expect(result.message).toContain('顺播倒序')
    expect(getAtomicCapabilities().getAllItems()).toHaveLength(1)
  })

  it('execute blocks inserting a later episode that skips the next expected episode', async () => {
    await getAtomicCapabilities().appendItems([
      createExistingItem({
        id: 'existing-0900-episode-1',
        programCode: '002601120001',
        programName: '品质剧场：纵有疾风起 第1集',
        sequence: 1,
      }),
    ], { skipValidation: true })
    const executor = new InsertCommandExecutor()

    const result = await executor.execute(createInsertCommand({
      candidateId: 'I112001-0003',
      candidateName: '品质剧场：纵有疾风起 第3集',
      insertTime: '10:00:00',
    }))

    expect(result.success).toBe(false)
    expect(result.message).toContain('顺播跳集')
    expect(getAtomicCapabilities().getAllItems()).toHaveLength(1)
  })

  it('execute allows inserting the next expected episode after an existing episode', async () => {
    await getAtomicCapabilities().appendItems([
      createExistingItem({
        id: 'existing-0900-episode-1',
        programCode: '002601120001',
        programName: '品质剧场：纵有疾风起 第1集',
        sequence: 1,
      }),
    ], { skipValidation: true })
    const executor = new InsertCommandExecutor()

    const result = await executor.execute(createInsertCommand({
      candidateId: 'I112001-0002',
      candidateName: '品质剧场：纵有疾风起 第2集',
      insertTime: '10:00:00',
    }))

    expect(result.success).toBe(true)
    expect(getAtomicCapabilities().getAllItems().some((item) => item.programCode === '002601120002')).toBe(true)
  })
})
