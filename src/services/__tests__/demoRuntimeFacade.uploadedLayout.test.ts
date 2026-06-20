import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { LayoutImportService } from '@/services/layoutImportService'
import { clearRuntimeLayout, setRuntimeLayout } from '@/services/orchestration/runtimeLayoutRegistry'
import { DemoRuntimeFacade } from '@/services/runtime/demoRuntimeFacade'
import type { ScheduleState } from '@/types/orchestration'

vi.mock('@/services/llm/llmClient', () => ({
  getLLMClient: () => ({
    chat: vi.fn(async () => {
      throw new Error('skip llm')
    }),
  }),
}))

const channelId = 'dragon'
const channelName = '东方卫视'
const date = '2026-03-25'
const uploadFixturePath = resolve(process.cwd(), 'test-fixtures/browser/smg-weekday-layout.xlsx')

const createScheduleState = (overrides: Partial<ScheduleState> = {}): ScheduleState => ({
  channelId,
  channelName,
  date,
  isEmpty: true,
  itemCount: 0,
  gapCount: 1,
  hasSelectedTimeRange: false,
  ...overrides,
})

const importUploadedLayout = async (options: { effectiveFrom?: string; effectiveTo?: string; version?: number } = {}) => {
  const service = new LayoutImportService()
  const file = new File([readFileSync(uploadFixturePath)], 'smg-weekday-layout.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const imported = await service.importFile(file, channelId, date)
  setRuntimeLayout({ ...imported, ...options })
  return imported
}

describe('DemoRuntimeFacade uploaded layout context', () => {
  beforeEach(() => {
    clearRuntimeLayout(channelId, date)
  })

  afterEach(() => {
    clearRuntimeLayout(channelId, date)
  })

  it('commits an uploaded layout when the user confirms this layout', async () => {
    await importUploadedLayout()
    const facade = new DemoRuntimeFacade()

    const result = await facade.submitInstruction({
      scheduleState: createScheduleState(),
      userInput: '按这个版面开始编排',
      currentSchedule: [],
      history: [],
    })

    expect(result.kind).toBe('layout_commit')
    if (result.kind !== 'layout_commit') {
      throw new Error('expected uploaded layout commit')
    }

    expect(result.draft.source).toBe('uploaded')
    expect(result.draft.layoutReference.slots).toHaveLength(9)
    expect(result.orchestrationRequest.layoutDraft?.source).toBe('uploaded')
  })

  it('refines an uploaded layout only when the user explicitly edits the draft', async () => {
    await importUploadedLayout()
    const facade = new DemoRuntimeFacade()

    const result = await facade.submitInstruction({
      scheduleState: createScheduleState(),
      userInput: '把草案下午改成健康养生',
      currentSchedule: [],
      history: [],
    })

    expect(result.kind).toBe('layout_draft')
    if (result.kind !== 'layout_draft') {
      throw new Error('expected uploaded layout draft refinement')
    }

    expect(result.draft.source).toBe('uploaded')
    const afternoonSlots = result.draft.layoutReference.slots.filter((slot) => {
      const start = slot.startTime.split('T')[1]?.slice(0, 8)
      const end = slot.endTime.split('T')[1]?.slice(0, 8)
      return start === '13:00:00' && end === '18:00:00'
    })
    expect(afternoonSlots).toHaveLength(1)

    const afternoonColumn = result.draft.columns.find((column) => column.columnId === afternoonSlots[0]?.columnId)
    expect(afternoonColumn?.defaultProgramType).toBe('health')
    expect(result.draft.layoutReference.slots.length).toBeGreaterThan(1)
  })

  it('treats normal daypart changes as formal playlist orchestration after uploading a draft', async () => {
    await importUploadedLayout()
    const facade = new DemoRuntimeFacade()

    const result = await facade.submitInstruction({
      scheduleState: createScheduleState({
        playlistType: 'tv',
        isEmpty: false,
        itemCount: 2,
        gapCount: 1,
      }),
      userInput: '下午改成新闻栏目',
      currentSchedule: [],
      history: [],
      layoutDraftEnabled: true,
    })

    expect(result.kind).toBe('orchestration')
    if (result.kind !== 'orchestration') {
      throw new Error('expected normal formal orchestration')
    }

    expect(result.orchestrationRequest.mode).toBe('partial_generate')
    expect(result.orchestrationRequest.layoutDraft).toBeUndefined()
    expect(result.orchestrationRequest.targetTimeRange).toEqual({ start: '13:00:00', end: '18:00:00' })
    expect(result.feedback.details?.usesLayoutDraft).toBe(false)
  })

  it('does not attach an uploaded layout to normal gap filling unless the user references the draft', async () => {
    await importUploadedLayout()
    const facade = new DemoRuntimeFacade()

    const result = await facade.submitInstruction({
      scheduleState: createScheduleState({
        playlistType: 'tv',
        isEmpty: false,
        itemCount: 2,
        gapCount: 1,
      }),
      userInput: '补齐当前所有空窗',
      currentSchedule: [],
      history: [],
      layoutDraftEnabled: true,
    })

    expect(result.kind).toBe('orchestration')
    if (result.kind !== 'orchestration') {
      throw new Error('expected normal formal orchestration')
    }

    expect(result.orchestrationRequest.mode).toBe('partial_generate')
    expect(result.orchestrationRequest.layoutDraft).toBeUndefined()
    expect(result.feedback.details?.usesLayoutDraft).toBe(false)
  })

  it('does attach an uploaded layout when normal gap filling explicitly references the draft', async () => {
    await importUploadedLayout()
    const facade = new DemoRuntimeFacade()

    const result = await facade.submitInstruction({
      scheduleState: createScheduleState({
        playlistType: 'tv',
        isEmpty: false,
        itemCount: 2,
        gapCount: 1,
      }),
      userInput: '参考草案补齐当前所有空窗',
      currentSchedule: [],
      history: [],
      layoutDraftEnabled: true,
    })

    expect(result.kind).toBe('layout_commit')
    if (result.kind !== 'layout_commit') {
      throw new Error('expected uploaded layout-backed orchestration')
    }

    expect(result.orchestrationRequest.mode).toBe('partial_generate')
    expect(result.orchestrationRequest.layoutDraft?.source).toBe('uploaded')
    expect(result.draft.source).toBe('uploaded')
  })

  it('uses a television channel layout across dates while it is still effective', async () => {
    await importUploadedLayout({
      effectiveFrom: '2026-01-01',
      effectiveTo: '2026-06-30',
      version: 3,
    })
    const facade = new DemoRuntimeFacade()

    const result = await facade.submitInstruction({
      scheduleState: createScheduleState({
        playlistType: 'tv',
        date: '2026-06-17',
      }),
      userInput: '按这个版面开始编排',
      currentSchedule: [],
      history: [],
    })

    expect(result.kind).toBe('layout_commit')
    if (result.kind !== 'layout_commit') {
      throw new Error('expected effective television layout commit')
    }

    expect(result.draft.source).toBe('uploaded')
    expect(result.draft.effectiveFrom).toBe('2026-01-01')
    expect(result.draft.effectiveTo).toBe('2026-06-30')
    expect(result.draft.version).toBe(3)
  })

  it('does not let a rotation playlist commit the television channel layout', async () => {
    await importUploadedLayout({
      effectiveFrom: '2026-01-01',
      effectiveTo: '2026-06-30',
      version: 3,
    })
    const facade = new DemoRuntimeFacade()

    const result = await facade.submitInstruction({
      scheduleState: createScheduleState({
        playlistType: 'rotation',
        rotationStrategy: 'content_match',
        rotationDurationSeconds: 60 * 60,
        date: '2026-06-17',
      }),
      userInput: '按这个版面开始编排',
      currentSchedule: [],
      history: [],
    })

    expect(result.kind).toBe('message')
    if (result.kind !== 'message') {
      throw new Error('expected no television layout commit for rotation playlist')
    }
    expect(result.feedback.details?.draftId).toBeUndefined()
  })
})
