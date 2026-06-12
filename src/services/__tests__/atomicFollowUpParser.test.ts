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

  it('能从中文时间补参中提取目标时间', () => {
    const parser = new AtomicFollowUpParser()

    const result = parser.parse({
      pendingContext: createPendingInsertContext(),
      userInput: '两点半',
    })

    expect(result?.slots.targetTime).toBe('14:30:00')
    expect(result?.slots.targetTimeHint).toBe('两点半')
  })

  it('能从中文数字移动补参中提取偏移量', () => {
    const parser = new AtomicFollowUpParser()

    const result = parser.parse({
      pendingContext: {
        ...createPendingInsertContext(),
        action: 'move',
        slots: {
          targetTime: '09:00:00',
        },
        missingFields: ['offset'],
      },
      userInput: '后移五分钟',
    })

    expect(result?.slots.direction).toBe('forward')
    expect(result?.slots.offsetSeconds).toBe(300)
  })

  it('移动上下文里能把节目名补参保留下来继续等待时间', () => {
    const parser = new AtomicFollowUpParser()

    const result = parser.parse({
      pendingContext: {
        ...createPendingInsertContext(),
        action: 'move',
        originalUserInput: '后移30分钟',
        collectedUserInput: '后移30分钟',
        slots: {
          direction: 'forward',
          offsetSeconds: 1800,
        },
        missingFields: ['target_time'],
      },
      userInput: '看东方',
    })

    expect(result?.slots.programName).toBe('看东方')
    expect(result?.slots.offsetSeconds).toBeUndefined()
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
