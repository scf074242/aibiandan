import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ScheduleState } from '@/types/orchestration'
import { getAtomicCapabilities, resetAtomicCapabilities } from '@/services/atomicCapabilities'
import { resetCandidateService } from '@/services/candidateService'

const mockIntentRecognize = vi.fn()
const mockExtractInsertParams = vi.fn()
const mockLayoutRecognize = vi.fn()

vi.mock('@/services/llm/llmClient', () => ({
  getLLMClient: () => ({}),
}))

vi.mock('@/services/llm/taskClassifier', () => ({
  getTaskClassifier: () => ({
    classify: vi.fn(async () => ({
      mode: 'clarify',
      confidence: 0.1,
      reasoning: 'unused',
    })),
  }),
}))

vi.mock('@/services/intentRecognizer', () => ({
  getIntentRecognizer: () => ({
    recognize: mockIntentRecognize,
  }),
}))

vi.mock('@/services/paramExtractor', () => ({
  getParamExtractor: () => ({
    extractInsertParams: mockExtractInsertParams,
    extractDeleteParams: vi.fn(),
    extractMoveParams: vi.fn(),
    extractReplaceParams: vi.fn(),
  }),
}))

vi.mock('@/services/layoutIntentRecognizer', () => ({
  getLayoutIntentRecognizer: () => ({
    recognize: mockLayoutRecognize,
  }),
}))

import { DemoRuntimeFacade } from '@/services/runtime/demoRuntimeFacade'

const scheduleState: ScheduleState = {
  channelId: 'dragon',
  channelName: '东方卫视',
  date: '2026-03-25',
  isEmpty: false,
  itemCount: 1,
  gapCount: 1,
  hasSelectedTimeRange: false,
}

describe('DemoRuntimeFacade insert sequence context guard', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    mockIntentRecognize.mockReset()
    mockExtractInsertParams.mockReset()
    mockLayoutRecognize.mockReset()
    resetCandidateService()
    resetAtomicCapabilities()
    await getAtomicCapabilities().clearAll()
  })

  it('blocks a natural-language insert that would backfill a later episode before an existing earlier episode', async () => {
    const existingEpisode = {
      id: 'existing-0900-episode-1',
      programCode: '881120030001',
      programName: '品质剧场：纵有疾风起 第1集',
      startTime: '2026-03-25T09:00:00+08:00',
      endTime: '2026-03-25T09:45:00+08:00',
      duration: 2700,
      programType: 'drama',
      sequence: 1,
    }
    await getAtomicCapabilities().appendItems([existingEpisode], { skipValidation: true })
    mockIntentRecognize.mockResolvedValue({
      type: 'insert',
      confidence: 0.96,
      reasoning: 'insert drama episode before existing sequence',
    })
    mockExtractInsertParams.mockResolvedValue({
      targetTime: '08:00:00',
      programName: '纵有疾风起 第2集',
      rawProgramText: '纵有疾风起 第2集',
    })
    mockLayoutRecognize.mockResolvedValue({
      mode: 'clarify',
      confidence: 0.2,
      reasoning: 'unused',
      ignoreExistingLayout: false,
    })

    const facade = new DemoRuntimeFacade()
    const result = await facade.submitInstruction({
      scheduleState,
      userInput: '08:00 插入纵有疾风起第2集',
      currentSchedule: [existingEpisode],
      history: [],
    })

    expect(result.kind).toBe('message')
    if (result.kind !== 'message') {
      throw new Error('expected blocked insert message')
    }
    expect(result.feedback.content).toContain('顺播倒序')
    expect(result.feedback.details?.targetTime).toBe('08:00:00')
    expect(getAtomicCapabilities().getAllItems()).toHaveLength(1)
  })
})
