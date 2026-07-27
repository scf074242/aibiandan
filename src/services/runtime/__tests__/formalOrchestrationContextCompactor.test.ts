import { describe, expect, it } from 'vitest'

import { compactFormalOrchestrationContext } from '../formalOrchestrationContextCompactor'

const checkpoint = (
  turn: number,
  decision: { kind: 'continue' | 'act_failed'; reason: string },
  failureReason?: string,
) => ({
  id: `checkpoint-${turn}`,
  runId: 'run-context-compaction',
  objective: '按草案补齐全天空窗',
  turn,
  actions: [{ type: 'research_check', purpose: 'candidate_precheck', query: `query-${turn}` }],
  observations: [{
    id: `observation-${turn}`,
    turn,
    type: 'asset_search' as const,
    summary: turn === 1 ? '候选 A 的版权原始字段缺失' : `第 ${turn} 轮原始观察`,
    data: { turn, verboseTrace: `trace-${turn}` },
    createdAt: `2026-07-19T00:0${turn}:00.000Z`,
  }],
  decision,
  failureReason,
  createdAt: `2026-07-19T00:0${turn}:30.000Z`,
})

const checkpoints = [
  checkpoint(1, { kind: 'continue', reason: '候选 A 因版权缺失被拒绝，继续检索候选 B' }),
  checkpoint(2, { kind: 'act_failed', reason: '素材库超时' }, '素材库超时'),
  checkpoint(3, { kind: 'continue', reason: '候选 B 可用，继续校验顺播' }),
  checkpoint(4, { kind: 'continue', reason: '顺播校验通过，继续下一批' }),
]

describe('formal orchestration context compactor', () => {
  /**
   * case formal-react-context-compaction-retains-rejection-evidence
   * - userInput: 按草案补齐全天空窗
   * - expectedDecision: 只保留最近两轮原始 observation，同时保留全部已决动作摘要和失败原因
   * - mustNotHappen: 丢失候选 A 被拒绝的原因；继续携带全部旧 raw trace；改写业务语义
   * - verification: recentTurns=3/4，摘要包含版权拒绝，failureReasons 包含素材库超时
   */
  it('retains recent raw observations and older rejection evidence', () => {
    const result = compactFormalOrchestrationContext({
      objective: '按草案补齐全天空窗',
      checkpoints,
      retainRecentTurns: 2,
    })

    expect(result.objective).toBe('按草案补齐全天空窗')
    expect(result.recentTurns.map((item) => item.turn)).toEqual([3, 4])
    expect(result.decidedActionSummaries).toHaveLength(4)
    expect(result.decidedActionSummaries[0]?.decisionReason).toContain('版权缺失被拒绝')
    expect(result.failureReasons).toContain('素材库超时')
    expect(JSON.stringify(result.recentTurns)).not.toContain('版权原始字段缺失')
    expect(result.trace).toMatchObject({
      before: { checkpointCount: 4, observationCount: 4, actionCount: 4 },
      after: { rawTurnCount: 2, rawObservationCount: 2, summarizedTurnCount: 4 },
      dropped: { rawTurnCount: 2, rawObservationCount: 2 },
    })
  })

  /**
   * case formal-react-context-compaction-idempotent-replay
   * - userInput: 恢复刚才的全天补排任务
   * - expectedDecision: 相同 checkpoint 重放得到完全相同的压缩上下文
   * - mustNotHappen: 使用当前时间或随机 id 导致 replay 漂移
   * - verification: 两次压缩结果 deepEqual
   */
  it('is deterministic and idempotent for replay', () => {
    const input = {
      objective: '按草案补齐全天空窗',
      checkpoints,
      retainRecentTurns: 2,
    }

    expect(compactFormalOrchestrationContext(input)).toEqual(compactFormalOrchestrationContext(input))
  })
})
