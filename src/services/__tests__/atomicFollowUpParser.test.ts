import { describe, expect, it } from 'vitest'

import { AtomicFollowUpParser } from '@/services/atomicFollowUpParser'
import type { RuntimePendingAtomicContext } from '@/services/runtime/pendingAtomicContext'

const createPendingInsertContext = (): RuntimePendingAtomicContext => ({
  action: 'insert',
  phase: 'clarifying',
  summary: '请补充插入参数',
  reasoning: 'mock insert clarification',
  originalUserInput: '插入',
  collectedUserInput: '插入',
  slots: {},
  missingFields: ['target_time', 'program_name'],
  followUpQuestion: '请补充目标时间点和节目名称。',
  attemptCount: 0,
  createdAt: '2026-04-17T07:00:00.000Z',
  updatedAt: '2026-04-17T07:00:00.000Z',
})

const createPendingDeleteContext = (): RuntimePendingAtomicContext => ({
  action: 'delete',
  phase: 'clarifying',
  summary: '请补充删除参数',
  reasoning: 'mock delete clarification',
  originalUserInput: '删除看东方',
  collectedUserInput: '删除看东方',
  slots: {
    programName: '看东方',
    rawProgramText: '看东方',
  },
  missingFields: ['target_time'],
  followUpQuestion: '请补充目标时间点。',
  attemptCount: 0,
  createdAt: '2026-04-17T07:00:00.000Z',
  updatedAt: '2026-04-17T07:00:00.000Z',
})

describe('AtomicFollowUpParser', () => {
  it('不会把无法识别的时间短语兜底成 09:00:00', () => {
    const parser = new AtomicFollowUpParser()

    const result = parser.parse({
      pendingContext: createPendingInsertContext(),
      userInput: '稍后',
    })

    expect(result?.slots.targetTime).toBeUndefined()
  })

  it('能从更口语化的插入补参里提取节目名', () => {
    const parser = new AtomicFollowUpParser()

    const result = parser.parse({
      pendingContext: createPendingInsertContext(),
      userInput: '我想要看东方',
    })

    expect(result?.slots.programName).toBe('看东方')
    expect(result?.slots.rawProgramText).toBe('看东方')
  })

  it('删除补参改口时不会把删除动词写进节目名', () => {
    const parser = new AtomicFollowUpParser()

    const result = parser.parse({
      pendingContext: createPendingDeleteContext(),
      userInput: '删除东方新闻',
    })

    expect(result?.slots.programName).toBe('东方新闻')
    expect(result?.slots.rawProgramText).toBe('东方新闻')
  })
})
