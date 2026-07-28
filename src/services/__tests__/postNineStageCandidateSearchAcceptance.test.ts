import { describe, expect, it, vi } from 'vitest'

import { canonicalSchedulingData } from '@/services/agent/canonicalSchedulingData'
import { InMemorySchedulingDataGateway } from '@/services/agent/inMemorySchedulingDataGateway'
import { SchedulingAgentRuntime } from '@/services/agent/schedulingAgentRuntime'
import type {
  AgentCandidateJudge,
  AgentProgramCandidate,
  AgentTraceStep,
} from '@/services/agent/types'

const date = '2026-03-25'
const channelId = 'rotation'
const canonicalCandidates = canonicalSchedulingData.candidates as AgentProgramCandidate[]
const expectedCandidate = canonicalCandidates.find((candidate) => (
  candidate.programName.includes('出行')
  || candidate.instanceName.includes('出行')
  || candidate.contentTags?.includes('出行')
))

if (!expectedCandidate) {
  throw new Error('data_fixture_missing: post-nine-stage search acceptance requires a canonical 出行 candidate')
}

describe('post-nine-stage canonical candidate search acceptance', () => {
  it('post9-search-broadened-query-finds-existing-canonical-program: searches LLM-provided strategies until a canonical candidate is found without writing early', async () => {
    const traces: AgentTraceStep[] = []
    const candidateJudge: AgentCandidateJudge = {
      selectBestCandidate: vi.fn(async ({ candidates }) => ({
        candidate: null,
        decisionType: 'needs_clarification',
        reasoning: '检索已命中多个真实节目，需由用户确认具体候选。',
        candidateOptions: candidates.slice(0, 3),
      })),
    }
    const gateway = new InMemorySchedulingDataGateway([{
      channelId,
      date,
      playlistId: 'post9-search-rotation',
      playlistType: 'rotation',
      rotationStrategy: 'content_match',
      rotationDurationSeconds: 3600,
      scheduleItems: [],
      programCandidates: canonicalCandidates,
    }])
    const runtime = new SchedulingAgentRuntime({
      dataGateway: gateway,
      candidateJudge,
      onTraceStep: (step) => traces.push(step),
    })

    const result = await runtime.submit({
      conversationId: 'post9-search-session',
      userInput: '插入与申城出行服务相关的短内容',
      channelId,
      date,
      playlistId: 'post9-search-rotation',
      interpretation: {
        intent: 'insert',
        confidence: 0.98,
        source: 'llm',
        slots: { targetTime: '00:00:00', programHint: '申城出行服务相关的短内容' },
        keywordStrategies: [
          { strategy: 'original', keywords: ['申城出行服务相关的短内容'], reason: '保留用户原始主题约束' },
          { strategy: 'paraphrase', keywords: ['城市出行服务'], reason: '改写为节目库常用主题表达' },
          { strategy: 'broaden', keywords: ['出行'], reason: '保留核心主题并放宽修饰词' },
        ],
        reasoning: '用户要求向正式轮播队列插入出行服务内容。',
      },
    })

    expect(result.status).toBe('needs_selection')
    expect(result.executionResult).toBeUndefined()
    expect(candidateJudge.selectBestCandidate).toHaveBeenCalledTimes(1)
    const judgeCandidates = vi.mocked(candidateJudge.selectBestCandidate).mock.calls[0]?.[0].candidates ?? []
    expect(judgeCandidates.some((candidate) => candidate.id === expectedCandidate.id)).toBe(true)
    expect(traces).toEqual(expect.arrayContaining([
      expect.objectContaining({
        label: '查节目库-重试',
        detail: expect.objectContaining({ strategyLabel: 'broaden', candidateCount: 0 }),
      }),
      expect.objectContaining({
        label: '候选查询完成',
        detail: expect.objectContaining({ strategyLabel: 'broaden' }),
      }),
    ]))
  })
})
