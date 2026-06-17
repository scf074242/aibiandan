import { describe, expect, it, vi } from 'vitest'

import { CandidateSelectionService } from '@/services/candidateSelectionService'
import type { DialogueContext } from '@/services/dialogueContext'
import type { LLMClient } from '@/services/llm/llmClient'
import type { ProgramCandidate, ScheduleState } from '@/types/orchestration'

const scheduleState: ScheduleState = {
  channelId: 'dragon',
  channelName: '东方卫视',
  date: '2026-03-25',
  isEmpty: true,
  itemCount: 0,
  gapCount: 0,
  hasSelectedTimeRange: false,
}

const dialogueContext: DialogueContext = {
  scheduleState,
  userInput: '18:30 插入 LifeTree',
  currentSchedule: [],
  scheduleSummary: '当前节目单为空',
  scheduleNameCandidates: '当前节目单为空',
  nearbyScheduleSummary: '当前节目单为空',
  targetTimeHints: ['18:30:00'],
}

const createCandidate = (overrides: Partial<ProgramCandidate> = {}): ProgramCandidate => ({
  id: 'candidate-1',
  programId: 'P124001',
  programCode: '881120030001',
  programName: 'Return Road Episode 1',
  instanceName: 'Return Road Episode 1',
  channelId: 'dragon',
  duration: 1800,
  programType: 'drama',
  issueNo: '0001',
  ...overrides,
})

describe('CandidateSelectionService insert guard', () => {
  it('blocks the single-candidate shortcut when explicit insert keywords do not match', async () => {
    const service = new CandidateSelectionService({
      chat: vi.fn(),
    } as unknown as LLMClient)

    const result = await service.selectForInsert(
      dialogueContext,
      {
        targetTime: '18:30:00',
        programName: 'LifeTree',
        rawProgramText: 'LifeTree',
      },
      [createCandidate()],
    )

    expect(result.decision).toBe('none')
    expect(result.selectedCandidate).toBeUndefined()
    expect(result.riskFlags).toContain('insert_selection_blocked')
  })

  it('blocks an LLM-selected insert candidate when explicit keywords do not match', async () => {
    const service = new CandidateSelectionService({
      chat: vi.fn(async () => ({
        content: JSON.stringify({
          decision: 'select',
          selectedCandidateId: 'candidate-1',
          confidence: 0.91,
          reasoning: '模型误选了同类型电视剧。',
        }),
      })),
    } as unknown as LLMClient)

    const result = await service.selectForInsert(
      dialogueContext,
      {
        targetTime: '18:30:00',
        programName: 'LifeTree',
        rawProgramText: 'LifeTree',
      },
      [
        createCandidate(),
        createCandidate({
          id: 'candidate-2',
          programCode: '881120030002',
          programName: 'Wind Drama Episode 2',
          instanceName: 'Wind Drama Episode 2',
        }),
      ],
    )

    expect(result.decision).toBe('none')
    expect(result.selectedCandidate).toBeUndefined()
    expect(result.riskFlags).toContain('insert_selection_blocked')
  })

  it('allows a matching explicit insert candidate', async () => {
    const service = new CandidateSelectionService({
      chat: vi.fn(),
    } as unknown as LLMClient)

    const result = await service.selectForInsert(
      dialogueContext,
      {
        targetTime: '18:30:00',
        programName: 'LifeTree',
        rawProgramText: 'LifeTree',
      },
      [
        createCandidate({
          id: 'lifetree-1',
          programCode: 'LT0001',
          programName: 'LifeTree Episode 1',
          instanceName: 'LifeTree Episode 1',
        }),
      ],
    )

    expect(result.decision).toBe('select')
    expect(result.selectedCandidate?.id).toBe('lifetree-1')
  })

  it('blocks an insert candidate that matches content but misses an explicit column requirement', async () => {
    const service = new CandidateSelectionService({
      chat: vi.fn(),
    } as unknown as LLMClient)

    const result = await service.selectForInsert(
      dialogueContext,
      {
        targetTime: '18:30:00',
        programName: '所属栏目看东方 节目内容静安寺',
        rawProgramText: '所属栏目看东方 节目内容静安寺',
      },
      [
        createCandidate({
          id: 'content-only',
          programCode: 'JINGAN-ONLY',
          programName: '静安寺外场直播 第1期',
          instanceName: '静安寺外场直播 第1期',
          programType: 'news_magazine',
          columnName: 'ShanghaiEye',
          columnId: '104',
          contentTags: ['静安寺', '外场直播'],
        }),
      ],
    )

    expect(result.decision).toBe('none')
    expect(result.selectedCandidate).toBeUndefined()
    expect(result.missingRequirements).toContain('insert_editorial_keywords')
    expect(result.riskFlags).toContain('insert_selection_blocked')
  })
})
