import { describe, expect, it } from 'vitest'

import { AtomicContinuationClassifier } from '@/services/atomicContinuationClassifier'
import type { RuntimePendingAtomicContext } from '@/services/runtime/pendingAtomicContext'

const createPendingContext = (
  overrides: Partial<RuntimePendingAtomicContext> = {},
): RuntimePendingAtomicContext => ({
  action: 'insert',
  phase: 'clarifying',
  summary: '请补充插入参数',
  reasoning: 'mock pending context',
  originalUserInput: '插入节目',
  collectedUserInput: '插入节目',
  slots: {},
  missingFields: ['target_time', 'program_name'],
  followUpQuestion: '请补充目标时间点和节目名称。',
  attemptCount: 0,
  createdAt: '2026-04-17T07:00:00.000Z',
  updatedAt: '2026-04-17T07:00:00.000Z',
  ...overrides,
})

describe('AtomicContinuationClassifier', () => {
  it('未完成上下文里遇到新的完整原子命令时会切到新任务', () => {
    const classifier = new AtomicContinuationClassifier()

    const result = classifier.classify({
      pendingContext: createPendingContext(),
      userInput: '删除9点的节目',
    })

    expect(result).toEqual({
      kind: 'interrupt_as_new_task',
    })
  })

  it('明确的移动补参仍会继续旧上下文', () => {
    const classifier = new AtomicContinuationClassifier()

    const result = classifier.classify({
      pendingContext: createPendingContext({
        action: 'move',
        slots: {
          targetTime: '09:00:00',
        },
        missingFields: ['offset'],
      }),
      userInput: '后移30分钟',
    })

    expect(result).toEqual({
      kind: 'continue',
    })
  })

  it('插入推荐阶段遇到不同动作的部分新命令时会打断旧上下文', () => {
    const classifier = new AtomicContinuationClassifier()

    const result = classifier.classify({
      pendingContext: createPendingContext({
        action: 'insert',
        phase: 'recommending_insert',
        slots: {
          targetTime: '09:00:00',
          programName: '看东方',
        },
        missingFields: ['selection'],
      }),
      userInput: '删除看东方',
    })

    expect(result).toEqual({
      kind: 'interrupt_as_new_task',
    })
  })

  it('插入推荐阶段说换成东方新闻时仍按节目纠正处理', () => {
    const classifier = new AtomicContinuationClassifier()

    const result = classifier.classify({
      pendingContext: createPendingContext({
        action: 'insert',
        phase: 'recommending_insert',
        slots: {
          targetTime: '09:00:00',
          programName: '看东方',
        },
        missingFields: ['selection'],
      }),
      userInput: '换成东方新闻',
    })

    expect(result).toEqual({
      kind: 'correction_reply',
      value: '东方新闻',
    })
  })

  it('未完成原子上下文里遇到新的开放编排命令时会切到新任务', () => {
    const classifier = new AtomicContinuationClassifier()

    const result = classifier.classify({
      pendingContext: createPendingContext(),
      userInput: '麻烦来个14-15点静安寺外场直播播单',
    })

    expect(result).toEqual({
      kind: 'interrupt_as_new_task',
    })
  })

  it.each([
    '10点加一档东方新闻',
    '撤掉10点那条节目',
    '10点那档往后挪15分钟',
    '九点那档往后挪十五分钟',
    '两点半加一档社区提醒',
  ])('未完成上下文里遇到口语化完整原子命令时会切到新任务: %s', (userInput) => {
    const classifier = new AtomicContinuationClassifier()

    const result = classifier.classify({
      pendingContext: createPendingContext(),
      userInput,
    })

    expect(result).toEqual({
      kind: 'interrupt_as_new_task',
    })
  })

  it('插入推荐阶段遇到新的服务提醒版面命令时也会打断旧上下文', () => {
    const classifier = new AtomicContinuationClassifier()

    const result = classifier.classify({
      pendingContext: createPendingContext({
        action: 'insert',
        phase: 'recommending_insert',
        slots: {
          targetTime: '09:00:00',
          programName: '看东方',
        },
        missingFields: ['selection'],
      }),
      userInput: '两点到三点做社区服务提醒',
    })

    expect(result).toEqual({
      kind: 'interrupt_as_new_task',
    })
  })
})
