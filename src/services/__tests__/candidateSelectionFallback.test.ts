import { describe, expect, it, vi } from 'vitest'

import { CandidateSelectionService } from '@/services/candidateSelectionService'
import type { LLMClient } from '@/services/llm/llmClient'
import type { GapInfo, ProgramCandidate } from '@/types/orchestration'

const baseDate = '2026-03-25'
const iso = (time: string) => `${baseDate}T${time}+08:00`

const createGap = (overrides: Partial<GapInfo> = {}): GapInfo => ({
  id: 'gap-1',
  startTime: iso('12:45:00'),
  endTime: iso('13:00:00'),
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

const createCandidate = (overrides: Partial<ProgramCandidate> = {}): ProgramCandidate => ({
  id: 'candidate-1',
  programId: 'P124001',
  programCode: '881120030001',
  programName: '品质剧场：纵有疾风起 第1集',
  instanceName: '品质剧场：纵有疾风起 第1集',
  channelId: 'dragon',
  duration: 900,
  programType: 'drama',
  issueNo: '0001',
  ...overrides,
})

const unavailableLlm = {
  chat: vi.fn(async () => {
    throw new Error('LLM unavailable')
  }),
} as unknown as LLMClient

describe('CandidateSelectionService deterministic fallback', () => {
  it('leaves a gap empty when hard title keywords are not matched', async () => {
    const service = new CandidateSelectionService(unavailableLlm)

    const result = await service.selectForGap(
      createGap(),
      '东方卫视',
      baseDate,
      [
        createCandidate({
          id: 'wrong-drama',
          programName: '梦想剧场：归路 第1集',
          instanceName: '梦想剧场：归路 第1集',
        }),
      ],
      {
        summary: '12:45-13:00 编排生命树电视剧',
        targetProgramTypes: ['drama'],
        targetSlotLabel: '生命树电视剧',
        durationPreference: { min: 60, max: 900 },
        searchKeywords: ['生命树电视剧'],
        allowFiller: false,
        sequentialPreference: true,
      },
    )

    expect(result.decision).toBe('none')
    expect(result.selectedCandidate).toBeUndefined()
    expect(result.riskFlags).toContain('fallback_selection_blocked')
  })

  it('asks for review instead of skipping the expected sequential episode', async () => {
    const service = new CandidateSelectionService(unavailableLlm)
    const skippedEpisode = {
      ...createCandidate({
        id: 'episode-6',
        programCode: '881120030006',
        programName: '品质剧场：纵有疾风起 第6集',
        instanceName: '品质剧场：纵有疾风起 第6集',
        issueNo: '0006',
      }),
      sequenceNo: 6,
      expectedSequenceNo: 5,
    } as ProgramCandidate & { sequenceNo: number; expectedSequenceNo: number }

    const result = await service.selectForGap(
      createGap(),
      '东方卫视',
      baseDate,
      [skippedEpisode],
      {
        summary: '电视频道顺播，昨天播到第4集，今天应从第5集开始',
        targetProgramTypes: ['drama'],
        targetSlotLabel: '品质剧场',
        durationPreference: { min: 60, max: 900 },
        searchKeywords: ['纵有疾风起'],
        allowFiller: false,
        sequentialPreference: true,
        selectionPolicy: {
          primary: 'sequence',
          fallback: ['content_match'],
          requiresPreviousSchedule: true,
        },
      },
    )

    expect(result.decision).toBe('clarify')
    expect(result.selectedCandidate).toBeUndefined()
    expect(result.riskFlags).toContain('sequence_gap_or_order_risk')
  })

  it('blocks reverse sequence when backfilling before an existing item', async () => {
    const service = new CandidateSelectionService(unavailableLlm)

    const result = await service.selectForGap(
      createGap({
        id: 'gap-0800',
        startTime: iso('08:00:00'),
        endTime: iso('08:45:00'),
        duration: 2700,
      }),
      '东方卫视',
      baseDate,
      [
        createCandidate({
          id: 'episode-2',
          programCode: '881120030002',
          programName: '品质剧场：纵有疾风起 第2集',
          instanceName: '品质剧场：纵有疾风起 第2集',
          issueNo: '0002',
          duration: 2700,
        }),
      ],
      {
        summary: '回填 8 点空窗',
        targetProgramTypes: ['drama'],
        targetSlotLabel: '品质剧场',
        durationPreference: { min: 60, max: 2700 },
        searchKeywords: ['纵有疾风起'],
        allowFiller: false,
        sequentialPreference: true,
      },
      {
        existingItems: [
          {
            id: 'existing-0900',
            programCode: '881120030001',
            programName: '品质剧场：纵有疾风起 第1集',
            startTime: iso('09:00:00'),
            endTime: iso('09:45:00'),
            duration: 2700,
            programType: 'drama',
            sequence: 1,
          },
        ],
      },
    )

    expect(result.decision).toBe('none')
    expect(result.selectedCandidate).toBeUndefined()
    expect(result.riskFlags).toContain('fallback_selection_blocked')
  })

  it('blocks an LLM-selected candidate that misses hard title keywords', async () => {
    const llmClient = {
      chat: vi.fn(async () => ({
        content: JSON.stringify({
          decision: 'select',
          selectedCandidateId: 'wrong-drama',
          confidence: 0.91,
          reasoning: '模型误以为同为电视剧即可替代。',
        }),
      })),
    } as unknown as LLMClient
    const service = new CandidateSelectionService(llmClient)

    const result = await service.selectForGap(
      createGap(),
      '东方卫视',
      baseDate,
      [
        createCandidate({
          id: 'wrong-drama',
          programName: 'Return Road Episode 1',
          instanceName: 'Return Road Episode 1',
        }),
      ],
      {
        summary: '12:45-13:00 编排 LifeTree',
        targetProgramTypes: ['drama'],
        targetSlotLabel: 'LifeTree',
        durationPreference: { min: 60, max: 900 },
        searchKeywords: ['LifeTree'],
        allowFiller: false,
        sequentialPreference: true,
      },
    )

    expect(result.decision).toBe('none')
    expect(result.selectedCandidate).toBeUndefined()
    expect(result.riskFlags).toContain('llm_selection_blocked')
  })

  it('blocks an LLM-selected candidate that is too long for the gap', async () => {
    const llmClient = {
      chat: vi.fn(async () => ({
        content: JSON.stringify({
          decision: 'select',
          selectedCandidateId: 'long-program',
          confidence: 0.89,
          reasoning: '模型忽略了空窗时长。',
        }),
      })),
    } as unknown as LLMClient
    const service = new CandidateSelectionService(llmClient)

    const result = await service.selectForGap(
      createGap(),
      '东方卫视',
      baseDate,
      [
        createCandidate({
          id: 'long-program',
          duration: 3600,
        }),
      ],
      {
        summary: '12:45-13:00 填入电视剧',
        targetProgramTypes: ['drama'],
        durationPreference: { min: 60, max: 900 },
        searchKeywords: [],
        allowFiller: false,
        sequentialPreference: false,
      },
    )

    expect(result.decision).toBe('none')
    expect(result.selectedCandidate).toBeUndefined()
    expect(result.riskFlags).toContain('llm_selection_blocked')
  })

  it('turns an LLM-selected skipped sequential episode into manual review', async () => {
    const llmClient = {
      chat: vi.fn(async () => ({
        content: JSON.stringify({
          decision: 'select',
          selectedCandidateId: 'episode-6',
          confidence: 0.9,
          reasoning: '模型选择了后续集数。',
        }),
      })),
    } as unknown as LLMClient
    const service = new CandidateSelectionService(llmClient)
    const skippedEpisode = {
      ...createCandidate({
        id: 'episode-6',
        programCode: '881120030006',
        issueNo: '0006',
      }),
      sequenceNo: 6,
      expectedSequenceNo: 5,
    } as ProgramCandidate & { sequenceNo: number; expectedSequenceNo: number }

    const result = await service.selectForGap(
      createGap(),
      '东方卫视',
      baseDate,
      [skippedEpisode],
      {
        summary: '电视频道顺播，昨天播到第4集，今天应从第5集开始',
        targetProgramTypes: ['drama'],
        targetSlotLabel: '品质剧场',
        durationPreference: { min: 60, max: 900 },
        searchKeywords: [],
        allowFiller: false,
        sequentialPreference: true,
        selectionPolicy: {
          primary: 'sequence',
          fallback: ['content_match'],
          requiresPreviousSchedule: true,
        },
      },
    )

    expect(result.decision).toBe('clarify')
    expect(result.selectedCandidate).toBeUndefined()
    expect(result.riskFlags).toContain('sequence_gap_or_order_risk')
  })

  it('blocks an LLM-selected reverse sequence before an existing scheduled episode', async () => {
    const llmClient = {
      chat: vi.fn(async () => ({
        content: JSON.stringify({
          decision: 'select',
          selectedCandidateId: 'episode-2',
          confidence: 0.9,
          reasoning: '模型忽略了后面已有第1集。',
        }),
      })),
    } as unknown as LLMClient
    const service = new CandidateSelectionService(llmClient)

    const result = await service.selectForGap(
      createGap({
        id: 'gap-0800',
        startTime: iso('08:00:00'),
        endTime: iso('08:45:00'),
        duration: 2700,
      }),
      '东方卫视',
      baseDate,
      [
        createCandidate({
          id: 'episode-2',
          programCode: '881120030002',
          programName: '品质剧场：纵有疾风起 第2集',
          instanceName: '品质剧场：纵有疾风起 第2集',
          issueNo: '0002',
          duration: 2700,
        }),
      ],
      {
        summary: '回填 8 点空窗',
        targetProgramTypes: ['drama'],
        targetSlotLabel: '品质剧场',
        durationPreference: { min: 60, max: 2700 },
        searchKeywords: [],
        allowFiller: false,
        sequentialPreference: true,
      },
      {
        existingItems: [
          {
            id: 'existing-0900',
            programCode: '881120030001',
            programName: '品质剧场：纵有疾风起 第1集',
            startTime: iso('09:00:00'),
            endTime: iso('09:45:00'),
            duration: 2700,
            programType: 'drama',
            sequence: 1,
          },
        ],
      },
    )

    expect(result.decision).toBe('none')
    expect(result.selectedCandidate).toBeUndefined()
    expect(result.riskFlags).toContain('llm_selection_blocked')
  })
})
