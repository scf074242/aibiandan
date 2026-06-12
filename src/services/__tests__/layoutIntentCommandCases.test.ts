import { describe, expect, it, vi } from 'vitest'

import { orchestrationDemoCandidates } from '@/mock/orchestrationMock'
import { LayoutIntentRecognizer } from '@/services/layoutIntentRecognizer'
import { layoutIntentCommandCases } from './fixtures/layoutIntentCommandCases'
import type { LayoutDraft, ScheduleState } from '@/types/orchestration'

const createScheduleState = (overrides: Partial<ScheduleState> = {}): ScheduleState => ({
  channelId: 'dragon',
  channelName: '东方卫视',
  date: '2026-03-25',
  isEmpty: false,
  itemCount: 10,
  gapCount: 1,
  hasSelectedTimeRange: false,
  ...overrides,
})

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
        startTime: '2026-03-25T18:00:00',
        endTime: '2026-03-25T23:00:00',
        columnId: 'runtime-column:test-evening',
      },
    ],
  },
  columns: [
    {
      columnId: 'runtime-column:test-evening',
      columnName: '晚间时段',
      defaultProgramType: 'drama',
      source: 'default',
      semanticLabel: '晚间剧场',
    },
  ],
})

const candidateCountByType = orchestrationDemoCandidates.reduce<Record<string, number>>((acc, candidate) => {
  acc[candidate.programType] = (acc[candidate.programType] ?? 0) + 1
  return acc
}, {})

describe('layout intent command cases', () => {
  it.each(layoutIntentCommandCases)('$id: $input', async (commandCase) => {
    const recognizer = new LayoutIntentRecognizer({
      chat: vi.fn(async () => {
        throw new Error('skip llm')
      }),
    } as never)

    const result = await recognizer.recognize({
      scheduleState: createScheduleState(commandCase.emptySchedule ? { isEmpty: true, itemCount: 0 } : {}),
      userInput: commandCase.input,
      currentLayoutDraft: commandCase.withDraft ? createDraft() : undefined,
      hasUploadedLayout: commandCase.hasUploadedLayout,
    })

    expect(result.mode).toBe(commandCase.expected.mode)
    if (typeof commandCase.expected.ignoreExistingLayout === 'boolean') {
      expect(result.ignoreExistingLayout).toBe(commandCase.expected.ignoreExistingLayout)
    }
    if (commandCase.expected.targetTimeRange) {
      expect(result.targetTimeRange).toEqual(commandCase.expected.targetTimeRange)
    }
    if (commandCase.expected.semanticLabel) {
      expect(result.semanticLabel).toBe(commandCase.expected.semanticLabel)
    }
    if (commandCase.expected.programTypeHint) {
      expect(result.programTypeHint).toBe(commandCase.expected.programTypeHint)
    }
    if (typeof commandCase.expected.segmentCount === 'number') {
      expect(result.segments).toHaveLength(commandCase.expected.segmentCount)
    }
    if (commandCase.expected.segmentTypes) {
      expect(result.segments?.map((segment) => segment.programTypeHint)).toEqual(commandCase.expected.segmentTypes)
    }
    if (commandCase.library) {
      expect(candidateCountByType[commandCase.library.programType] ?? 0).toBeGreaterThanOrEqual(commandCase.library.minCandidates)
    }
  })
})
