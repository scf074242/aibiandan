import { describe, expect, it, vi } from 'vitest'

import { buildPendingLlmContext, createPendingTask } from '@/services/agent/agentSession'
import { buildAgentPendingContextSourceSnapshots } from '@/services/agent/contextFingerprint'
import { InMemorySchedulingDataGateway } from '@/services/agent/inMemorySchedulingDataGateway'
import { LlmAgentIntentInterpreter } from '@/services/agent/llmAgentIntentInterpreter'
import { SchedulingAgentRuntime } from '@/services/agent/schedulingAgentRuntime'
import type { AgentIntentInterpreter, AgentProgramCandidate } from '@/services/agent/types'
import type { PlaylistType, RotationPlaylistStrategy, ScheduleItemSnapshot, ScheduleSummary } from '@/types/orchestration'

const date = '2026-03-25'

const buildItem = (patch: Partial<ScheduleItemSnapshot> = {}): ScheduleItemSnapshot => ({
  id: 'item-0900',
  programCode: 'P100001',
  programName: 'Morning Anchor',
  startTime: '09:00:00',
  endTime: '09:30:00',
  duration: 1800,
  programType: 'news',
  sequence: 1,
  ...patch,
})

const buildCandidate = (patch: Partial<AgentProgramCandidate> = {}): AgentProgramCandidate => ({
  id: 'candidate-news',
  programId: 'program-news',
  programCode: 'NEWS001',
  programName: 'Morning News',
  channelId: 'dragon',
  columnId: 'news',
  columnName: 'News',
  duration: 1800,
  programType: 'news',
  instanceName: 'Morning News',
  contentTags: ['news'],
  materialStatus: 'ready',
  rightsStatus: 'ready',
  ...patch,
})

const buildGateway = (
  items: ScheduleItemSnapshot[],
  candidates: AgentProgramCandidate[] = [],
  historySchedules: ScheduleSummary[] = [],
  options: {
    playlistType?: PlaylistType
    rotationStrategy?: RotationPlaylistStrategy
  } = {},
) => new InMemorySchedulingDataGateway([{
  channelId: 'dragon',
  date,
  playlistType: options.playlistType ?? 'tv',
  rotationStrategy: options.rotationStrategy,
  scheduleItems: items,
  programCandidates: candidates,
  historySchedules,
  layoutBounds: { start: '06:00:00', end: '23:59:59' },
}])

describe('SchedulingAgentRuntime intent interpreter', () => {
  it('uses structured interpretation before local text parsing', async () => {
    const dataGateway = buildGateway([buildItem()])
    const interpreter: AgentIntentInterpreter = {
      interpret: vi.fn(async () => ({
        intent: 'move',
        confidence: 0.94,
        source: 'test',
        slots: {
          targetTime: '09:00:00',
          offsetSeconds: 1800,
          direction: 'forward',
        },
        reasoning: 'planner structured move command',
      })),
    }
    const runtime = new SchedulingAgentRuntime({
      dataGateway,
      intentInterpreter: interpreter,
    })

    const result = await runtime.submit({
      userInput: 'planner says shift the morning anchor later',
      channelId: 'dragon',
      date,
    })

    expect(interpreter.interpret).toHaveBeenCalledTimes(1)
    expect(result.status).toBe('executed')
    expect(result.input.interpretation).toMatchObject({
      intent: 'move',
      source: 'test',
    })
    expect(result.decision.command).toMatchObject({
      intent: 'move',
      itemId: 'item-0900',
      newStartTime: '2026-03-25T09:30:00+08:00',
      newEndTime: '2026-03-25T10:00:00+08:00',
    })
    expect(result.trace.some((step) => step.label.includes('interpreter'))).toBe(true)
  })

  it('keeps LLM-only delete intent and does not recover a missed target time locally', async () => {
    const dataGateway = buildGateway([])
    const interpreter: AgentIntentInterpreter = {
      interpret: vi.fn(async () => ({
        intent: 'delete',
        confidence: 0.91,
        source: 'test',
        slots: {},
        reasoning: 'planner understood delete but missed the explicit time slot',
        assistantFeedback: '我理解你想删除9点的节目，我会先查当前播单里是否存在这条节目。',
      })),
    }
    const runtime = new SchedulingAgentRuntime({
      dataGateway,
      intentInterpreter: interpreter,
    })

    const result = await runtime.submit({
      userInput: '删除9点的节目',
      channelId: 'dragon',
      date,
    })

    expect(interpreter.interpret).toHaveBeenCalledTimes(1)
    expect(result.status).toBe('needs_clarification')
    expect(result.decision.command).toBeUndefined()
    expect(result.decision.pendingTask).toMatchObject({
      intent: 'delete',
      phase: 'needs_clarification',
      missingSlots: ['targetTime'],
    })
  })

  it('uses structured absolute move target time without adding local parsing rules', async () => {
    const dataGateway = buildGateway([buildItem()])
    const interpreter: AgentIntentInterpreter = {
      interpret: vi.fn(async () => ({
        intent: 'move',
        confidence: 0.95,
        source: 'test',
        slots: {
          targetTime: '09:00:00',
          newStartTime: '10:00:00',
        },
        reasoning: 'planner structured absolute move command',
      })),
    }
    const runtime = new SchedulingAgentRuntime({
      dataGateway,
      intentInterpreter: interpreter,
    })

    const result = await runtime.submit({
      userInput: 'move the morning anchor to the next hour',
      channelId: 'dragon',
      date,
    })

    expect(result.status).toBe('executed')
    expect(result.decision.command).toMatchObject({
      intent: 'move',
      itemId: 'item-0900',
      newStartTime: '2026-03-25T10:00:00+08:00',
      newEndTime: '2026-03-25T10:30:00+08:00',
      offsetSeconds: 3600,
    })
    expect(result.input.interpretation?.slots).toMatchObject({
      targetTime: '09:00:00',
      newStartTime: '10:00:00',
    })
  })

  it('uses structured targetProgramName to resolve a move target', async () => {
    const dataGateway = buildGateway([
      buildItem({
        id: 'item-morning-anchor',
        programName: 'Morning Anchor',
        startTime: '09:00:00',
        endTime: '09:30:00',
      }),
    ])
    const interpreter: AgentIntentInterpreter = {
      interpret: vi.fn(async () => ({
        intent: 'move',
        confidence: 0.95,
        source: 'test',
        slots: {
          targetProgramName: 'Morning Anchor',
          newStartTime: '10:00:00',
        },
      })),
    }
    const runtime = new SchedulingAgentRuntime({
      dataGateway,
      intentInterpreter: interpreter,
    })

    const result = await runtime.submit({
      userInput: 'move Morning Anchor to ten',
      channelId: 'dragon',
      date,
    })

    expect(result.status).toBe('executed')
    expect(result.decision.command).toMatchObject({
      intent: 'move',
      itemId: 'item-morning-anchor',
      targetTime: '2026-03-25T09:00:00+08:00',
      newStartTime: '2026-03-25T10:00:00+08:00',
    })
  })

  it('uses LLM-extracted Chinese targetProgramName to move an existing programme', async () => {
    const dataGateway = buildGateway([
      buildItem({
        id: 'item-kan-dongfang',
        programName: '看东方',
        startTime: '09:00:00',
        endTime: '09:30:00',
      }),
    ])
    const interpreter: AgentIntentInterpreter = {
      interpret: vi.fn(async () => ({
        intent: 'move',
        confidence: 0.96,
        source: 'test',
        slots: {
          targetProgramName: '看东方',
          newStartTime: '10:00:00',
        },
      })),
    }
    const runtime = new SchedulingAgentRuntime({
      dataGateway,
      intentInterpreter: interpreter,
    })

    const result = await runtime.submit({
      userInput: '把《看东方》移到 10 点',
      channelId: 'dragon',
      date,
    })

    expect(result.status).toBe('executed')
    expect(result.decision.command).toMatchObject({
      intent: 'move',
      itemId: 'item-kan-dongfang',
      targetTime: '2026-03-25T09:00:00+08:00',
      newStartTime: '2026-03-25T10:00:00+08:00',
    })
  })

  it('uses structured targetProgramName for sensitive delete but still requires confirmation', async () => {
    const dataGateway = buildGateway([
      buildItem({
        id: 'item-morning-anchor',
        programName: 'Morning Anchor',
      }),
    ])
    const interpreter: AgentIntentInterpreter = {
      interpret: vi.fn(async () => ({
        intent: 'delete',
        confidence: 0.95,
        source: 'test',
        slots: {
          targetProgramName: 'Morning Anchor',
        },
      })),
    }
    const runtime = new SchedulingAgentRuntime({
      dataGateway,
      intentInterpreter: interpreter,
    })

    const result = await runtime.submit({
      userInput: 'remove Morning Anchor',
      channelId: 'dragon',
      date,
    })

    expect(result.status).toBe('needs_confirmation')
    expect(result.decision.pendingTask).toMatchObject({
      intent: 'delete',
      phase: 'needs_confirmation',
      collectedSlots: {
        targetItemId: {
          value: 'item-morning-anchor',
        },
      },
    })
    expect(result.executionResult).toBeUndefined()
  })

  it('uses LLM-extracted Chinese targetProgramName for delete and keeps the confirmation gate', async () => {
    const dataGateway = buildGateway([
      buildItem({
        id: 'item-kan-dongfang',
        programName: '看东方',
      }),
    ])
    const interpreter: AgentIntentInterpreter = {
      interpret: vi.fn(async () => ({
        intent: 'delete',
        confidence: 0.96,
        source: 'test',
        slots: {
          targetProgramName: '看东方',
        },
      })),
    }
    const runtime = new SchedulingAgentRuntime({
      dataGateway,
      intentInterpreter: interpreter,
    })

    const result = await runtime.submit({
      userInput: '删除看东方',
      channelId: 'dragon',
      date,
    })

    expect(result.status).toBe('needs_confirmation')
    expect(result.decision.resolvedTargets).toMatchObject([
      { id: 'item-kan-dongfang', programName: '看东方' },
    ])
    expect(result.decision.pendingTask).toMatchObject({
      intent: 'delete',
      phase: 'needs_confirmation',
      collectedSlots: {
        targetItemId: {
          value: 'item-kan-dongfang',
        },
      },
    })
    expect(result.executionResult).toBeUndefined()
  })

  it('requires clarification when structured targetProgramName matches multiple move targets', async () => {
    const dataGateway = buildGateway([
      buildItem({
        id: 'item-morning-anchor-1',
        programName: 'Morning Anchor',
        startTime: '09:00:00',
        endTime: '09:30:00',
      }),
      buildItem({
        id: 'item-morning-anchor-2',
        programName: 'Morning Anchor',
        startTime: '11:00:00',
        endTime: '11:30:00',
      }),
    ])
    const interpreter: AgentIntentInterpreter = {
      interpret: vi.fn(async () => ({
        intent: 'move',
        confidence: 0.95,
        source: 'test',
        slots: {
          targetProgramName: 'Morning Anchor',
          newStartTime: '10:00:00',
        },
      })),
    }
    const runtime = new SchedulingAgentRuntime({
      dataGateway,
      intentInterpreter: interpreter,
    })

    const result = await runtime.submit({
      userInput: 'move Morning Anchor to ten',
      channelId: 'dragon',
      date,
    })

    expect(result.status).toBe('needs_clarification')
    expect(result.decision.resolvedTargets).toHaveLength(2)
    expect(result.decision.constraintReport?.issues[0]).toMatchObject({
      code: 'target_ambiguous',
      severity: 'critical',
    })
    expect(result.decision.command).toBeUndefined()
    expect(result.executionResult).toBeUndefined()
  })

  it('continues an ambiguous structured move after the user selects a target time', async () => {
    const dataGateway = buildGateway([
      buildItem({
        id: 'item-morning-anchor-1',
        programName: 'Morning Anchor',
        startTime: '09:00:00',
        endTime: '09:30:00',
      }),
      buildItem({
        id: 'item-morning-anchor-2',
        programName: 'Morning Anchor',
        startTime: '11:00:00',
        endTime: '11:30:00',
      }),
    ])
    const interpreter: AgentIntentInterpreter = {
      interpret: vi.fn(async (input) => input.pendingTask
        ? {
            intent: 'move',
            pendingAction: 'continue_pending',
            confidence: 0.95,
            source: 'test',
            slots: {
              targetTime: '09:00:00',
            },
          }
        : {
            intent: 'move',
            confidence: 0.95,
            source: 'test',
            slots: {
              targetProgramName: 'Morning Anchor',
              newStartTime: '10:00:00',
            },
          }),
    }
    const runtime = new SchedulingAgentRuntime({
      dataGateway,
      intentInterpreter: interpreter,
    })

    const first = await runtime.submit({
      userInput: 'move Morning Anchor to ten',
      channelId: 'dragon',
      date,
    })

    expect(first.status).toBe('needs_clarification')
    expect(first.decision.pendingTask).toMatchObject({
      intent: 'move',
      phase: 'needs_clarification',
      missingSlots: ['targetItemId'],
      targetOptions: [
        { itemId: 'item-morning-anchor-1' },
        { itemId: 'item-morning-anchor-2' },
      ],
      collectedSlots: {
        newStartTime: {
          value: '10:00:00',
        },
      },
    })

    const second = await runtime.submit({
      userInput: 'the one at nine',
      channelId: 'dragon',
      date,
      pendingTask: first.decision.pendingTask,
    })

    expect(second.status).toBe('executed')
    expect(second.decision.command).toMatchObject({
      intent: 'move',
      itemId: 'item-morning-anchor-1',
      newStartTime: '2026-03-25T10:00:00+08:00',
    })
    const context = await dataGateway.loadContext({
      userInput: '',
      channelId: 'dragon',
      date,
    })
    expect(context.scheduleItems.find((item) => item.id === 'item-morning-anchor-1')).toMatchObject({
      startTime: '2026-03-25T10:00:00+08:00',
    })
  })

  it('requires clarification when structured targetProgramName matches multiple delete targets', async () => {
    const dataGateway = buildGateway([
      buildItem({
        id: 'item-morning-anchor-1',
        programName: 'Morning Anchor',
        startTime: '09:00:00',
        endTime: '09:30:00',
      }),
      buildItem({
        id: 'item-morning-anchor-2',
        programName: 'Morning Anchor',
        startTime: '11:00:00',
        endTime: '11:30:00',
      }),
    ])
    const interpreter: AgentIntentInterpreter = {
      interpret: vi.fn(async () => ({
        intent: 'delete',
        confidence: 0.95,
        source: 'test',
        slots: {
          targetProgramName: 'Morning Anchor',
        },
      })),
    }
    const runtime = new SchedulingAgentRuntime({
      dataGateway,
      intentInterpreter: interpreter,
    })

    const result = await runtime.submit({
      userInput: 'remove Morning Anchor',
      channelId: 'dragon',
      date,
    })

    expect(result.status).toBe('needs_clarification')
    expect(result.decision.resolvedTargets).toHaveLength(2)
    expect(result.decision.constraintReport?.issues[0]).toMatchObject({
      code: 'target_ambiguous',
      severity: 'critical',
    })
    expect(result.decision.pendingTask).toMatchObject({
      intent: 'delete',
      phase: 'needs_clarification',
      missingSlots: ['targetItemId'],
    })
    expect(result.decision.auditSummary).toMatchObject({
      outcome: 'pending',
      pendingTask: {
        intent: 'delete',
        phase: 'needs_clarification',
        collectedSlotKeys: ['targetProgramName'],
        missingSlots: ['targetItemId'],
        allowedActions: ['start_new_task', 'cancel_pending'],
        attemptCount: 0,
        maxAttempts: 3,
        targetOptionCount: 2,
      },
    })
    expect(result.decision.auditSummary?.keyPoints).toEqual(
      expect.arrayContaining([
        expect.stringContaining('待处理任务：阶段=needs_clarification'),
        expect.stringContaining('缺少=targetItemId'),
        expect.stringContaining('已收集=targetProgramName'),
      ]),
    )
    expect(result.executionResult).toBeUndefined()
  })

  it('continues an ambiguous structured delete into confirmation after target selection', async () => {
    const dataGateway = buildGateway([
      buildItem({
        id: 'item-morning-anchor-1',
        programName: 'Morning Anchor',
        startTime: '09:00:00',
        endTime: '09:30:00',
      }),
      buildItem({
        id: 'item-morning-anchor-2',
        programName: 'Morning Anchor',
        startTime: '11:00:00',
        endTime: '11:30:00',
      }),
    ])
    const interpreter: AgentIntentInterpreter = {
      interpret: vi.fn(async (input) => {
        if (!input.pendingTask) {
          return {
            intent: 'delete',
            confidence: 0.95,
            source: 'test',
            slots: {
              targetProgramName: 'Morning Anchor',
            },
          }
        }
        if (input.userInput === 'confirm') {
          return {
            intent: 'delete',
            pendingAction: 'confirm',
            confidence: 0.95,
            source: 'test',
          }
        }
        return {
          intent: 'delete',
          pendingAction: 'continue_pending',
          confidence: 0.95,
          source: 'test',
          slots: {
            targetTime: '11:00:00',
          },
        }
      }),
    }
    const runtime = new SchedulingAgentRuntime({
      dataGateway,
      intentInterpreter: interpreter,
    })

    const first = await runtime.submit({
      userInput: 'remove Morning Anchor',
      channelId: 'dragon',
      date,
    })

    expect(first.status).toBe('needs_clarification')
    expect(first.decision.pendingTask).toMatchObject({
      intent: 'delete',
      phase: 'needs_clarification',
      missingSlots: ['targetItemId'],
      targetOptions: [
        { itemId: 'item-morning-anchor-1' },
        { itemId: 'item-morning-anchor-2' },
      ],
    })

    const second = await runtime.submit({
      userInput: 'the one at eleven',
      channelId: 'dragon',
      date,
      pendingTask: first.decision.pendingTask,
    })

    expect(second.status).toBe('needs_confirmation')
    expect(second.decision.pendingTask).toMatchObject({
      intent: 'delete',
      phase: 'needs_confirmation',
      collectedSlots: {
        targetItemId: {
          value: 'item-morning-anchor-2',
        },
      },
    })
    expect(second.executionResult).toBeUndefined()

    const third = await runtime.submit({
      userInput: 'confirm',
      channelId: 'dragon',
      date,
      pendingTask: second.decision.pendingTask,
    })

    expect(third.status).toBe('executed')
    const context = await dataGateway.loadContext({
      userInput: '',
      channelId: 'dragon',
      date,
    })
    expect(context.scheduleItems.map((item) => item.id)).toEqual(['item-morning-anchor-1'])
  })

  it('blocks instead of falling back to capability parsing when the interpreter fails', async () => {
    const dataGateway = buildGateway([buildItem()])
    const interpreter: AgentIntentInterpreter = {
      interpret: vi.fn(async () => {
        throw new Error('mock interpreter unavailable')
      }),
    }
    const runtime = new SchedulingAgentRuntime({
      dataGateway,
      intentInterpreter: interpreter,
    })

    const result = await runtime.submit({
      userInput: '把9点的节目整体后移30分钟',
      channelId: 'dragon',
      date,
    })

    expect(interpreter.interpret).toHaveBeenCalledTimes(1)
    expect(result.status).toBe('failed')
    expect(result.decision.constraintReport?.issues[0]?.code).toBe('llm_intent_unavailable')
    expect(result.explanation).toContain('没有改动播单')
    expect(result.trace.some((step) => String(step.detail?.error ?? '').includes('mock interpreter unavailable'))).toBe(true)
  })

  it('records failed LLM interpreter calls and blocks without deterministic fallback execution', async () => {
    const dataGateway = buildGateway([buildItem()])
    const pendingTask = createPendingTask({
      intent: 'insert',
      phase: 'needs_clarification',
      originalInput: 'insert Morning News',
      collectedSlots: {
        programHint: {
          value: 'Morning News',
          source: 'user_initial',
          confidence: 0.9,
        },
      },
      missingSlots: ['targetTime'],
    })
    const chat = vi.fn(async () => {
      throw new Error('llm unavailable')
    })
    const runtime = new SchedulingAgentRuntime({
      dataGateway,
      intentInterpreter: new LlmAgentIntentInterpreter({ chat }),
    })

    const result = await runtime.submit({
      userInput: '鎶?鐐圭殑鑺傜洰鏁翠綋鍚庣Щ30鍒嗛挓',
      channelId: 'dragon',
      date,
      pendingTask,
    })

    expect(result.status).toBe('failed')
    expect(result.decision.constraintReport?.issues[0]?.code).toBe('llm_intent_unavailable')
    expect(result.explanation).toContain('没有改动播单')
    expect(result.trace.some((step) => (
      step.detail?.llmCall
      && (step.detail.llmCall as { status?: string }).status === 'failed'
    ))).toBe(true)
  })

  it('blocks when the LLM returns structure but no editor-readable understanding', async () => {
    const dataGateway = buildGateway([], [buildCandidate()])
    const interpreter: AgentIntentInterpreter = {
      usesLlm: true,
      interpret: vi.fn(async () => ({
        intent: 'insert',
        confidence: 0.92,
        source: 'llm',
        slots: {
          targetTime: '10:00:00',
          programHint: 'Morning News',
        },
        reasoning: 'intent=insert slots.targetTime=10:00 slots.programHint=Morning News',
      })),
    }
    const runtime = new SchedulingAgentRuntime({
      dataGateway,
      intentInterpreter: interpreter,
    })

    const result = await runtime.submit({
      userInput: '10点插入Morning News',
      channelId: 'dragon',
      date,
    })

    expect(interpreter.interpret).toHaveBeenCalledTimes(1)
    expect(result.status).toBe('failed')
    expect(result.decision.constraintReport?.issues[0]?.code).toBe('llm_intent_unavailable')
    expect(result.explanation).toContain('没有改动播单')
    expect(result.trace.some((step) => (
      step.detail?.llmCall
      && (step.detail.llmCall as { reason?: string }).reason === 'missing_user_readable_understanding'
    ))).toBe(true)
  })

  it('passes pending structured context to the interpreter and consumes follow-up slots', async () => {
    const dataGateway = buildGateway([], [buildCandidate()])
    const pendingTask = createPendingTask({
      intent: 'insert',
      phase: 'needs_clarification',
      originalInput: 'insert a news program',
      collectedSlots: {
        programHint: {
          value: 'Morning News',
          source: 'user_initial',
          confidence: 0.9,
        },
      },
      missingSlots: ['targetTime'],
    })
    const interpreter: AgentIntentInterpreter = {
      interpret: vi.fn(async (input) => {
        expect(input.pendingTask).toMatchObject({
          intent: 'insert',
          missingSlots: ['targetTime'],
        })
        return {
          intent: 'insert',
          pendingAction: 'continue_pending',
          confidence: 0.96,
          source: 'test',
          slots: {
            targetTime: '09:00:00',
          },
        }
      }),
    }
    const runtime = new SchedulingAgentRuntime({
      dataGateway,
      intentInterpreter: interpreter,
    })

    const result = await runtime.submit({
      userInput: 'put it at nine',
      channelId: 'dragon',
      date,
      pendingTask,
    })

    expect(interpreter.interpret).toHaveBeenCalledTimes(1)
    expect(result.status).toBe('executed')
    expect(result.input.interpretation).toMatchObject({
      pendingAction: 'continue_pending',
      slots: { targetTime: '09:00:00' },
    })
    expect(result.decision.command).toMatchObject({
      intent: 'insert',
      candidateId: 'candidate-news',
      insertTime: '2026-03-25T09:00:00+08:00',
    })
  })

  it('keeps the previous insert programme hint when a follow-up only supplies time', async () => {
    const shanghaiCandidate = buildCandidate({
      id: 'candidate-shanghai-news',
      programId: 'program-shanghai-news',
      programCode: 'SHNEWS001',
      programName: '上海早新闻',
      instanceName: '上海早新闻',
      contentTags: ['上海', '早新闻'],
    })
    const dataGateway = buildGateway([], [
      shanghaiCandidate,
      buildCandidate({
        id: 'candidate-kan-dongfang',
        programId: 'program-kan-dongfang',
        programCode: 'KDF001',
        programName: '看东方',
        instanceName: '看东方 早高峰版',
        contentTags: ['看东方'],
      }),
    ])
    const pendingTask = createPendingTask({
      intent: 'insert',
      phase: 'needs_clarification',
      originalInput: '插入上海早新闻',
      collectedSlots: {
        programHint: {
          value: '上海早新闻',
          source: 'user_initial',
          confidence: 0.9,
        },
      },
      missingSlots: ['targetTime'],
    })
    const interpreter: AgentIntentInterpreter = {
      interpret: vi.fn(async () => ({
        intent: 'insert',
        pendingAction: 'continue_pending',
        confidence: 0.96,
        source: 'test',
        slots: {
          targetTime: '16:00:00',
          programHint: '航吧',
        },
      })),
    }
    const runtime = new SchedulingAgentRuntime({
      dataGateway,
      intentInterpreter: interpreter,
    })

    const result = await runtime.submit({
      userInput: '就16点吧',
      channelId: 'dragon',
      date,
      pendingTask,
    })

    expect(result.status).toBe('needs_clarification')
    expect(result.decision.command).toBeUndefined()
    expect(result.decision.pendingTask).toMatchObject({
      intent: 'insert',
      phase: 'needs_clarification',
      collectedSlots: {
        targetTime: expect.objectContaining({
          value: '16:00:00',
        }),
        programHint: expect.objectContaining({
          value: '航吧',
        }),
      },
    })
  })

  it('serializes pending lifecycle and context fingerprint for the LLM interpreter', async () => {
    let serializedUserPayload: Record<string, unknown> | undefined
    const chat = vi.fn(async (messages) => {
      const userMessage = messages.find((message: { role: string }) => message.role === 'user')
      serializedUserPayload = JSON.parse(String(userMessage?.content ?? '{}'))
      return {
        content: JSON.stringify({
          intent: 'insert',
          pendingAction: 'confirm',
          confidence: 0.9,
        }),
      }
    })
    const interpreter = new LlmAgentIntentInterpreter({ chat })
    const pendingTask = {
      ...createPendingTask({
        intent: 'insert',
        phase: 'needs_confirmation',
        originalInput: 'insert Morning News at 09:00',
        collectedSlots: {
          targetTime: {
            value: '09:00:00',
            source: 'user_initial',
            confidence: 0.9,
          },
          programHint: {
            value: 'Morning News',
            source: 'user_initial',
            confidence: 0.9,
          },
        },
        missingSlots: ['confirmation'],
        contextFingerprint: 'schedule:abc123',
        contextSources: [{
          sourceKey: 'candidates',
          source: 'in_memory_seed',
          available: true,
          recordCount: 1,
          status: 'available',
          digest: 'candidate-source-digest',
          samples: ['Morning News NEWS001 news material=ready rights=ready'],
        }],
      }),
      attemptCount: 2,
      expiresAt: '2099-03-25T09:05:00.000Z',
    }

    const result = await interpreter.interpret({
      userInput: 'confirm',
      channelId: 'dragon',
      date,
      pendingTask,
    })

    expect(result).toMatchObject({
      intent: 'insert',
      pendingAction: 'confirm',
    })
    expect(serializedUserPayload?.pendingTask).toMatchObject({
      intent: 'insert',
      phase: 'needs_confirmation',
      originalInput: 'insert Morning News at 09:00',
      collectedInput: 'insert Morning News at 09:00',
      latestUserInput: 'confirm',
      attemptCount: 2,
      maxAttempts: 3,
      expiresAt: '2099-03-25T09:05:00.000Z',
      contextFingerprint: 'schedule:abc123',
      collectedSlots: {
        targetTime: '09:00:00',
        programHint: 'Morning News',
      },
      missingSlots: ['confirmation'],
      allowedActions: ['confirm', 'reject', 'start_new_task', 'cancel_pending'],
      contextSources: [
        expect.objectContaining({
          sourceKey: 'candidates',
          source: 'in_memory_seed',
          recordCount: 1,
          digest: 'candidate-source-digest',
          samples: ['Morning News NEWS001 news material=ready rights=ready'],
        }),
      ],
      evidenceSummary: [
        expect.objectContaining({
          sourceKey: 'candidates',
          recordCount: 1,
          status: 'available',
          samples: ['Morning News NEWS001 news material=ready rights=ready'],
        }),
      ],
    })
    expect(serializedUserPayload?.pendingEvidenceSummary).toEqual([
      expect.objectContaining({
        sourceKey: 'candidates',
        samples: ['Morning News NEWS001 news material=ready rights=ready'],
      }),
    ])
    expect(serializedUserPayload?.currentTurn).toMatchObject({
      userInput: 'confirm',
      channelId: 'dragon',
      date,
    })
    expect(serializedUserPayload?.pendingLlmContext).toMatchObject({
      latestUserInput: 'confirm',
      evidenceSummary: [
        expect.objectContaining({
          sourceKey: 'candidates',
          samples: ['Morning News NEWS001 news material=ready rights=ready'],
        }),
      ],
      allowedActions: ['confirm', 'reject', 'start_new_task', 'cancel_pending'],
      pendingContext: {
        intent: 'insert',
        phase: 'needs_confirmation',
        originalInput: 'insert Morning News at 09:00',
        collectedInput: 'insert Morning News at 09:00',
        contextFingerprint: 'schedule:abc123',
        collectedSlots: {
          targetTime: '09:00:00',
          programHint: 'Morning News',
        },
        missingSlots: ['confirmation'],
      },
    })
  })

  it('parses taskPlanDraft from the same LLM interpretation call without treating it as execution', async () => {
    const chat = vi.fn(async () => ({
      content: JSON.stringify({
        intent: 'batch_delete',
        confidence: 0.92,
        slots: {
          targetProgramName: '看东方',
        },
        missing: [],
        riskHints: ['批量删除需要确认后写入'],
        assistantReplyDraft: '我找到了多条看东方，会先拆成批量删除任务，确认后再写入播单。',
        taskPlanDraft: {
          isComposite: true,
          goal: '删除全部看东方',
          stages: [
            {
              type: 'batch_atomic',
              summary: '删除当前播单里的看东方',
              action: 'delete',
              requiresConfirmation: true,
            },
            {
              type: 'verify',
              summary: '检查当前播单里是否还剩看东方',
              requiresConfirmation: false,
            },
          ],
        },
      }),
    }))
    const interpreter = new LlmAgentIntentInterpreter({ chat })

    const result = await interpreter.interpret({
      userInput: '把全部看东方节目删除掉',
      channelId: 'dragon',
      date,
    })

    expect(chat).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({
      intent: 'batch_delete',
      assistantFeedback: '我找到了多条看东方，会先拆成批量删除任务，确认后再写入播单。',
      taskPlanDraft: {
        isComposite: true,
        goal: '删除全部看东方',
        stages: [
          expect.objectContaining({
            type: 'batch_atomic',
            action: 'delete',
            requiresConfirmation: true,
          }),
          expect.objectContaining({
            type: 'verify',
            requiresConfirmation: false,
          }),
        ],
      },
    })
  })

  it('passes a compact current evidence package to real LLM intent interpretation', async () => {
    let serializedUserPayload: Record<string, unknown> | undefined
    const chat = vi.fn(async (messages) => {
      const userMessage = messages.find((message: { role: string }) => message.role === 'user')
      serializedUserPayload = JSON.parse(String(userMessage?.content ?? '{}'))
      return {
        content: JSON.stringify({
          intent: 'query',
          confidence: 0.92,
          queryKind: 'program_lookup',
          keyword: 'Morning Anchor',
          assistantFeedback: '我理解你想查询《Morning Anchor》在当前轮播单里的位置。',
        }),
      }
    })
    const dataGateway = buildGateway(
      [buildItem({ id: 'item-anchor', programName: 'Morning Anchor' })],
      [buildCandidate({ id: 'candidate-short', programCode: '', programName: 'City Image Clip', programType: 'short_clip' })],
      [{
        date: '2026-03-24',
        itemCount: 1,
        programTypes: { news: 1 },
        items: [buildItem({ id: 'history-anchor', programCode: 'P100000', sequence: 0 })],
      }],
      { playlistType: 'rotation', rotationStrategy: 'content_match' },
    )
    const runtime = new SchedulingAgentRuntime({
      dataGateway,
      intentInterpreter: new LlmAgentIntentInterpreter({ chat }),
    })

    const result = await runtime.submit({
      userInput: 'where is Morning Anchor scheduled?',
      channelId: 'dragon',
      date,
    })

    expect(result.status).toBe('executed')
    expect(serializedUserPayload?.evidencePackage).toMatchObject({
      identity: {
        playlistType: 'rotation',
        rotationStrategy: 'content_match',
        positionBasis: 'relative_from_zero',
      },
      playlistSemantics: {
        model: 'content_queue',
        positionMeaning: expect.stringContaining('内容队列'),
        draftBoundary: expect.stringContaining('整体编排和整体补排需要草案'),
        writeBoundary: expect.stringContaining('候选或待确认'),
      },
      currentSchedule: [
        expect.objectContaining({
          itemId: 'item-anchor',
          programName: 'Morning Anchor',
          positionBasis: 'relative_from_zero',
        }),
      ],
      candidateSummary: [
        expect.objectContaining({
          candidateId: 'candidate-short',
          programCode: '',
          programName: 'City Image Clip',
        }),
      ],
      policy: {
        playlistType: 'rotation',
        rotationCandidateWritesRequireConfirmation: true,
      },
      guardrails: expect.arrayContaining([
        expect.stringContaining('Destination occupation'),
        expect.stringContaining('layout drafts, full-day auto scheduling, and multi-user collaboration are out of scope'),
        expect.stringContaining('blocked instead of shifting, replacing, or reordering automatically'),
      ]),
    })
    expect(serializedUserPayload?.evidencePackage).toMatchObject({
      sourceSummary: expect.arrayContaining([
        expect.objectContaining({ sourceKey: 'today', recordCount: 1 }),
        expect.objectContaining({ sourceKey: 'candidates', recordCount: 1 }),
        expect.objectContaining({ sourceKey: 'history', recordCount: 1 }),
      ]),
    })
    expect(serializedUserPayload?.channelId).toBeUndefined()
    expect(serializedUserPayload?.date).toBeUndefined()
    expect(serializedUserPayload?.currentTurn.channelId).toBeUndefined()
    expect(serializedUserPayload?.currentTurn.date).toBeUndefined()
    expect(serializedUserPayload?.currentTurn).toMatchObject({
      playlistType: 'rotation',
      positionBasis: 'relative_from_zero',
    })
    expect(serializedUserPayload?.evidencePackage.identity).not.toHaveProperty('channelId')
    expect(serializedUserPayload?.evidencePackage.identity).not.toHaveProperty('date')
    expect(serializedUserPayload?.evidencePackage.latestHistory).toBeUndefined()
    expect(serializedUserPayload?.evidencePackage.budget.latestHistoryItems).toBeUndefined()
    expect(result.input.llmContextPackage).toBeDefined()
    expect(result.trace.some((step) => step.label.includes('compact evidence package'))).toBe(true)
  })

  it('uses the unified contextual interpreter for precise atomic commands', async () => {
    let systemPrompt = ''
    let userPayload: Record<string, unknown> | undefined
    const chat = vi.fn(async (messages) => {
      systemPrompt = String(messages.find((message: { role: string }) => message.role === 'system')?.content ?? '')
      const userMessage = messages.find((message: { role: string }) => message.role === 'user')
      userPayload = JSON.parse(String(userMessage?.content ?? '{}'))
      return {
        content: JSON.stringify({
          intent: 'insert',
          confidence: 0.94,
          slots: {
            targetTime: '09:00:00',
            programHint: '看东方',
          },
          assistantFeedback: '我理解你想在9点插入《看东方》，我会先核对候选节目和当前时段。',
        }),
      }
    })
    const interpreter = new LlmAgentIntentInterpreter({ chat })

    const result = await interpreter.interpret({
      userInput: '在9点插入节目看东方',
      channelId: 'dragon',
      date,
    })

    expect(chat).toHaveBeenCalledTimes(1)
    expect(systemPrompt).toContain('broadcast scheduling agent that supports both TV playlists and rotation playlists')
    expect(systemPrompt).toContain('evidencePackage.playlistSemantics')
    expect(systemPrompt).not.toContain('atomic-command context interpreter')
    expect(userPayload).toMatchObject({
      userInput: '在9点插入节目看东方',
    })
    expect(result).toMatchObject({
      intent: 'insert',
      confidence: 0.94,
      contextMode: 'scenario_context',
      slots: {
        targetTime: '09:00:00',
        programHint: '看东方',
      },
    })
  })

  it('drops premature completion wording from LLM drafts instead of rewriting it locally', async () => {
    const chat = vi.fn(async () => ({
      content: JSON.stringify({
        intent: 'insert',
        confidence: 0.94,
        slots: {
          targetTime: '09:00:00',
          programHint: '看东方',
        },
        assistantFeedback: '好的，已在9点插入节目《看东方》。',
      }),
    }))
    const interpreter = new LlmAgentIntentInterpreter({ chat })

    const result = await interpreter.interpret({
      userInput: '在9点插入节目看东方',
      channelId: 'dragon',
      date,
    })

    expect(result?.assistantFeedback).toBeUndefined()
  })

  it('handles composite commands in the same contextual pass', async () => {
    const systemPrompts: string[] = []
    const chat = vi.fn(async (messages) => {
      systemPrompts.push(String(messages.find((message: { role: string }) => message.role === 'system')?.content ?? ''))
      return {
        content: JSON.stringify({
          intent: 'insert',
          confidence: 0.91,
          slots: {
            targetTime: '09:00:00',
            programHint: '看东方',
          },
          taskPlanDraft: {
            isComposite: true,
            goal: '插入看东方并后移后续节目',
            stages: [
              {
                type: 'atomic',
                action: 'insert',
                target: {
                  targetTime: '09:00:00',
                  replacementHint: '看东方',
                },
                summary: '在9点插入看东方',
              },
              {
                type: 'atomic',
                action: 'move',
                target: {
                  rangeStart: '09:00:00',
                },
                summary: '后续节目按需后移',
              },
            ],
          },
          assistantFeedback: '我理解这是先插入《看东方》，再处理后续节目位置，我会按顺序核对。',
        }),
      }
    })
    const interpreter = new LlmAgentIntentInterpreter({ chat })

    const result = await interpreter.interpret({
      userInput: '9点插入看东方，其余节目后移',
      channelId: 'dragon',
      date,
    })

    expect(chat).toHaveBeenCalledTimes(1)
    expect(systemPrompts[0]).toContain('broadcast scheduling agent that supports both TV playlists and rotation playlists')
    expect(systemPrompts[0]).not.toContain('atomic-command context interpreter')
    expect(result).toMatchObject({
      intent: 'insert',
      contextMode: 'scenario_context',
      taskPlanDraft: {
        isComposite: true,
        stages: [
          expect.objectContaining({ type: 'atomic', action: 'insert' }),
          expect.objectContaining({ type: 'atomic', action: 'move' }),
        ],
      },
    })
  })

  it('prompts the full LLM to extract programme-name targets for Chinese move and delete commands', async () => {
    let systemPrompt = ''
    const chat = vi.fn(async (messages) => {
      systemPrompt = String(messages.find((message: { role: string }) => message.role === 'system')?.content ?? '')
      return {
        content: JSON.stringify({
          intent: 'move',
          confidence: 0.95,
          slots: {
            targetProgramName: '看东方',
            newStartTime: '10:00:00',
          },
        }),
      }
    })
    const interpreter = new LlmAgentIntentInterpreter({ chat })

    const result = await interpreter.interpret({
      userInput: '参考草案后，把《看东方》移到 10 点',
      channelId: 'dragon',
      date,
    })

    expect(result).toMatchObject({
      intent: 'move',
      contextMode: 'scenario_context',
      slots: {
        targetProgramName: '看东方',
        newStartTime: '10:00:00',
      },
    })
    expect(systemPrompt).toContain('把《看东方》移到10点')
    expect(systemPrompt).toContain('slots.targetProgramName')
    expect(systemPrompt).toContain('删除看东方')
    expect(systemPrompt).toContain('pendingEvidenceSummary')
    expect(systemPrompt).toContain('broadcast scheduling agent that supports both TV playlists and rotation playlists')
    expect(systemPrompt).toContain('TV playlists are strict broadcast time grids')
    expect(systemPrompt).toContain('rotation playlists are content queues')
    expect(systemPrompt).toContain('return low confidence and explain in assistantFeedback what is missing')
    expect(systemPrompt).toContain('only covers atomic playlist commands')
    expect(systemPrompt).toContain('layout drafts, full-day auto scheduling, or multi-user collaboration')
    expect(systemPrompt).toContain('do not infer auto-shift, auto-replace, or auto-reorder')
    expect(systemPrompt).toContain('assistantFeedback')
    expect(systemPrompt).toContain('one short Chinese sentence addressed to the scheduling editor')
    expect(systemPrompt).toContain('Write like a scheduling colleague, not like a system log')
    expect(systemPrompt).toContain('why I cannot continue yet, what is missing, and what the editor can say next')
    expect(systemPrompt).toContain('searchAlternatives')
  })

  it('keeps LLM assistant feedback with the structured command interpretation', async () => {
    const chat = vi.fn(async () => ({
      content: JSON.stringify({
        intent: 'insert',
        confidence: 0.92,
        slots: {
          targetTime: '10:00:00',
          programHint: '上海景点视频',
        },
        searchAlternatives: ['上海 旅游景点', '城市形象 短片', '上海 宣传片'],
        assistantFeedback: '我理解你想在10点插入上海景点相关视频，我会先从轮播素材库里按地点和内容关键词找候选。',
        streamingHint: 'thinking',
        reasoning: 'user provided target time and material hint',
      }),
    }))
    const interpreter = new LlmAgentIntentInterpreter({ chat })

    const result = await interpreter.interpret({
      userInput: '10点插入上海景点的视频',
      channelId: 'dragon',
      date,
    })

    expect(result).toMatchObject({
      intent: 'insert',
      confidence: 0.92,
      assistantFeedback: '我理解你想在10点插入上海景点相关视频，我会先从轮播素材库里按地点和内容关键词找候选。',
      streamingHint: 'thinking',
      searchAlternatives: ['上海 旅游景点', '城市形象 短片', '上海 宣传片'],
      slots: {
        targetTime: '10:00:00',
        programHint: '上海景点视频',
      },
    })
  })

  it('cleans technical words from assistant feedback before showing it to editors', async () => {
    const chat = vi.fn(async () => ({
      content: JSON.stringify({
        intent: 'insert',
        confidence: 0.92,
        slots: {
          targetTime: '10:00:00',
          programHint: '上海景点视频',
        },
        assistantReplyDraft: 'taskPlan stage 已生成，runtime 会按置信度和匹配度写入。请确认后我再改当前播单。',
        reasoning: 'technical wording should stay out of the main reply',
      }),
    }))
    const interpreter = new LlmAgentIntentInterpreter({ chat })

    const result = await interpreter.interpret({
      userInput: '10点插入上海景点的视频',
      channelId: 'dragon',
      date,
    })

    expect(result?.assistantFeedback).toBe('请确认后我再改当前播单。')
    expect(result?.slots).toMatchObject({
      targetTime: '10:00:00',
      programHint: '上海景点视频',
    })
  })

  it('keeps confirmation actions bound to the current pending intent even if the LLM drifts', async () => {
    const chat = vi.fn(async () => ({
      content: JSON.stringify({
        intent: 'delete',
        pendingAction: 'confirm',
        confidence: 0.91,
        reasoning: 'misread the pending task as a deletion',
      }),
    }))
    const interpreter = new LlmAgentIntentInterpreter({ chat })
    const pendingTask = createPendingTask({
      intent: 'insert',
      phase: 'needs_confirmation',
      originalInput: 'insert Morning News at 09:00',
      collectedSlots: {
        targetTime: {
          value: '09:00:00',
          source: 'user_initial',
          confidence: 0.9,
        },
        programHint: {
          value: 'Morning News',
          source: 'user_initial',
          confidence: 0.9,
        },
      },
      missingSlots: ['confirmation'],
    })

    const result = await interpreter.interpret({
      userInput: 'yes',
      channelId: 'dragon',
      date,
      pendingTask,
    })

    expect(result).toMatchObject({
      intent: 'insert',
      pendingAction: 'confirm',
    })
  })

  it('treats a different pending-turn intent as a new task when the LLM omits start_new_task', async () => {
    const chat = vi.fn(async () => ({
      content: JSON.stringify({
        intent: 'query',
        queryKind: 'schedule_summary',
        confidence: 0.88,
        reasoning: 'the user changed the topic to a read-only question',
      }),
    }))
    const interpreter = new LlmAgentIntentInterpreter({ chat })
    const pendingTask = createPendingTask({
      intent: 'insert',
      phase: 'needs_clarification',
      originalInput: 'insert Morning News',
      collectedSlots: {
        programHint: {
          value: 'Morning News',
          source: 'user_initial',
          confidence: 0.9,
        },
      },
      missingSlots: ['targetTime'],
    })

    const result = await interpreter.interpret({
      userInput: 'what is already scheduled today?',
      channelId: 'dragon',
      date,
      pendingTask,
    })

    expect(result).toMatchObject({
      intent: 'query',
      pendingAction: 'start_new_task',
      queryKind: 'schedule_summary',
    })
  })

  it('bypasses a pending write when the LLM interprets the follow-up as a new read-only task', async () => {
    const dataGateway = buildGateway([buildItem()], [buildCandidate()])
    const pendingTask = createPendingTask({
      intent: 'insert',
      phase: 'needs_clarification',
      originalInput: 'insert Morning News',
      collectedSlots: {
        programHint: {
          value: 'Morning News',
          source: 'user_initial',
          confidence: 0.9,
        },
      },
      missingSlots: ['targetTime'],
    })
    const chat = vi.fn(async () => ({
      content: JSON.stringify({
        intent: 'query',
        confidence: 0.93,
        queryKind: 'schedule_summary',
        assistantFeedback: '我理解你现在想先查看今天已经排了什么节目，这会作为新的查询处理。',
      }),
    }))
    const interpreter = new LlmAgentIntentInterpreter({ chat })
    const runtime = new SchedulingAgentRuntime({
      dataGateway,
      intentInterpreter: interpreter,
    })

    const result = await runtime.submit({
      userInput: 'what is already scheduled today?',
      channelId: 'dragon',
      date,
      pendingTask,
    })

    expect(result.status).toBe('executed')
    expect(result.decision.pendingTask).toBeUndefined()
    expect(result.decision.command).toMatchObject({
      intent: 'query',
      queryKind: 'schedule_summary',
    })
    expect(result.decision.queryResult).toMatchObject({
      kind: 'schedule_summary',
      totalCount: 1,
    })
    expect(result.decision.auditSummary).toMatchObject({
      intentInterpretation: {
        source: 'llm',
        confidence: 0.93,
        llmUsed: true,
        pendingAction: 'start_new_task',
        slotKeys: [],
        queryKind: 'schedule_summary',
      },
      llmUsage: {
        callsAttempted: 1,
        callsSucceeded: 1,
        callsRejected: 0,
        callsFailed: 0,
        calls: [
          { stage: 'intent_interpreter', status: 'attempted' },
          { stage: 'intent_interpreter', status: 'succeeded' },
        ],
      },
    })
    expect(result.decision.auditSummary?.keyPoints).toEqual(
      expect.arrayContaining([
        expect.stringContaining('意图理解：来源=llm'),
        expect.stringContaining('LLM 调用：尝试=1，成功=1，拒绝=0，失败=0'),
        expect.stringContaining('待处理动作=start_new_task'),
        expect.stringContaining('查询类型=schedule_summary'),
      ]),
    )
    expect(result.trace.some((step) => step.label.includes('starts a new scheduling command'))).toBe(true)

    const context = await dataGateway.loadContext({ userInput: '', channelId: 'dragon', date })
    expect(context.scheduleItems).toHaveLength(1)
    expect(context.scheduleItems[0]?.programName).toBe('Morning Anchor')
  })

  it('rejects low-confidence LLM intent outputs before they reach execution', async () => {
    const chat = vi.fn(async () => ({
      content: JSON.stringify({
        intent: 'insert',
        confidence: 0.2,
        slots: {
          targetTime: '09:00:00',
          programHint: 'Morning News',
        },
        reasoning: 'not enough context',
      }),
    }))
    const interpreter = new LlmAgentIntentInterpreter({ chat })

    const result = await interpreter.interpret({
      userInput: 'maybe do something with the morning programme',
      channelId: 'dragon',
      date,
    })

    expect(result).toBeNull()
  })

  it('accepts pending actions only when the current pending task allows them', async () => {
    const chat = vi.fn(async () => ({
      content: JSON.stringify({
        intent: 'insert',
        pendingAction: 'confirm',
        confidence: 0.9,
        slots: {
          targetTime: '09:00:00',
        },
      }),
    }))
    const interpreter = new LlmAgentIntentInterpreter({ chat })
    const pendingTask = createPendingTask({
      intent: 'insert',
      phase: 'needs_clarification',
      originalInput: 'insert Morning News',
      collectedSlots: {
        programHint: {
          value: 'Morning News',
          source: 'user_initial',
          confidence: 0.9,
        },
      },
      missingSlots: ['targetTime'],
    })

    const withoutPending = await interpreter.interpret({
      userInput: 'confirm',
      channelId: 'dragon',
      date,
    })
    const disallowedForPending = await interpreter.interpret({
      userInput: 'confirm',
      channelId: 'dragon',
      date,
      pendingTask,
    })

    expect(withoutPending).toMatchObject({
      intent: 'insert',
      pendingAction: undefined,
    })
    expect(disallowedForPending).toMatchObject({
      intent: 'insert',
      pendingAction: undefined,
      slots: {
        targetTime: '09:00:00',
      },
    })
  })

  it('builds pending LLM context with lifecycle metadata and context fingerprint', () => {
    const pendingTask = {
      ...createPendingTask({
        intent: 'delete',
        phase: 'needs_confirmation',
        originalInput: 'delete 09:00',
        collectedSlots: {
          targetTime: {
            value: '09:00:00',
            source: 'user_initial',
            confidence: 0.9,
          },
        },
        missingSlots: ['confirmation'],
        contextFingerprint: 'schedule:delete-context',
      }),
      attemptCount: 1,
      expiresAt: '2099-03-25T09:05:00.000Z',
    }

    expect(buildPendingLlmContext(pendingTask, 'confirm')).toMatchObject({
      pendingContext: {
        intent: 'delete',
        phase: 'needs_confirmation',
        originalInput: 'delete 09:00',
        collectedInput: 'delete 09:00',
        attemptCount: 1,
        maxAttempts: 3,
        expiresAt: '2099-03-25T09:05:00.000Z',
        contextFingerprint: 'schedule:delete-context',
        collectedSlots: {
          targetTime: '09:00:00',
        },
        missingSlots: ['confirmation'],
      },
      latestUserInput: 'confirm',
      allowedActions: ['confirm', 'reject', 'start_new_task', 'cancel_pending'],
    })
  })

  it('builds pending LLM context with candidate recommendations for selection turns', () => {
    const pendingTask = createPendingTask({
      intent: 'insert',
      phase: 'needs_selection',
      originalInput: 'insert Prime Drama at 10:00',
      collectedSlots: {
        targetTime: {
          value: '10:00:00',
          source: 'user_initial',
          confidence: 0.9,
        },
        programHint: {
          value: 'Prime Drama',
          source: 'user_initial',
          confidence: 0.85,
        },
      },
      missingSlots: ['candidateId'],
      recommendations: [{
        candidateId: 'candidate-drama-5-clean',
        programName: 'Prime Drama Episode 5 Clean Version',
        programCode: 'DRAMA0005',
        duration: 2700,
        programType: 'drama',
        score: 95,
        reason: 'matches the next episode rule',
      }, {
        candidateId: 'candidate-drama-5-subtitled',
        programName: 'Prime Drama Episode 5 Subtitled Version',
        programCode: 'DRAMA0005',
        duration: 2700,
        programType: 'drama',
        score: 87,
        reason: 'also matches the next episode rule',
      }],
      contextFingerprint: 'agent_context:selection',
    })

    expect(buildPendingLlmContext(pendingTask, 'use the subtitled version')).toMatchObject({
      pendingContext: {
        intent: 'insert',
        phase: 'needs_selection',
        collectedSlots: {
          targetTime: '10:00:00',
          programHint: 'Prime Drama',
        },
        missingSlots: ['candidateId'],
        recommendations: [
          expect.objectContaining({
            candidateId: 'candidate-drama-5-clean',
            programName: 'Prime Drama Episode 5 Clean Version',
          }),
          expect.objectContaining({
            candidateId: 'candidate-drama-5-subtitled',
            programName: 'Prime Drama Episode 5 Subtitled Version',
          }),
        ],
      },
      latestUserInput: 'use the subtitled version',
      allowedActions: ['select_candidate', 'start_new_task', 'cancel_pending'],
    })
  })

  it('adds compact multi-source evidence samples to pending LLM context snapshots', async () => {
    const context = await buildGateway([
      buildItem({
        id: 'today-episode-4',
        programCode: 'DRAMA0004',
        programName: 'Prime Drama Episode 4',
        startTime: '09:00:00',
        endTime: '09:45:00',
        programType: 'drama',
      }),
    ], [
      buildCandidate({
        id: 'candidate-episode-5',
        programCode: 'DRAMA0005',
        programName: 'Prime Drama Episode 5',
        programType: 'drama',
      }),
    ], [{
      date: '2026-03-24',
      itemCount: 1,
      items: [buildItem({
        id: 'history-episode-3',
        programCode: 'DRAMA0003',
        programName: 'Prime Drama Episode 3',
        startTime: '21:00:00',
        endTime: '21:45:00',
        programType: 'drama',
      })],
    }]).loadContext({
      userInput: 'insert Prime Drama at 10:00',
      channelId: 'dragon',
      date,
    })
    const contextSources = buildAgentPendingContextSourceSnapshots(context)
    const pendingTask = createPendingTask({
      intent: 'insert',
      phase: 'needs_clarification',
      originalInput: 'insert Prime Drama',
      collectedSlots: {
        programHint: {
          value: 'Prime Drama',
          source: 'user_initial',
          confidence: 0.9,
        },
      },
      missingSlots: ['targetTime'],
      contextSources,
    })

    const pendingLlmContext = buildPendingLlmContext(pendingTask, '10:00')

    expect(pendingLlmContext.pendingContext.contextSources).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceKey: 'today',
        samples: expect.arrayContaining([
          expect.stringContaining('Prime Drama Episode 4'),
        ]),
      }),
      expect.objectContaining({
        sourceKey: 'candidates',
        samples: expect.arrayContaining([
          expect.stringContaining('Prime Drama Episode 5'),
        ]),
      }),
      expect.objectContaining({
        sourceKey: 'history',
        samples: expect.arrayContaining([
          expect.stringContaining('latest=2026-03-24'),
          expect.stringContaining('Prime Drama Episode 3'),
        ]),
      }),
      expect.objectContaining({
        sourceKey: 'policy',
        samples: expect.arrayContaining(['playlist=tv']),
      }),
    ]))
    expect(pendingLlmContext.evidenceSummary).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceKey: 'today',
        samples: expect.arrayContaining([
          expect.stringContaining('Prime Drama Episode 4'),
        ]),
      }),
      expect.objectContaining({
        sourceKey: 'candidates',
        samples: expect.arrayContaining([
          expect.stringContaining('Prime Drama Episode 5'),
        ]),
      }),
      expect.objectContaining({
        sourceKey: 'history',
        samples: expect.arrayContaining([
          expect.stringContaining('latest=2026-03-24'),
        ]),
      }),
    ]))
  })

  it('uses structured pendingAction to confirm a pending task', async () => {
    const dataGateway = buildGateway([], [buildCandidate()])
    const pendingTask = createPendingTask({
      intent: 'insert',
      phase: 'needs_confirmation',
      originalInput: 'insert Morning News at 09:00',
      collectedSlots: {
        targetTime: {
          value: '09:00:00',
          source: 'user_initial',
          confidence: 0.9,
        },
        programHint: {
          value: 'Morning News',
          source: 'user_initial',
          confidence: 0.9,
        },
        candidateId: {
          value: 'candidate-news',
          source: 'system_inferred',
          confidence: 1,
        },
      },
      missingSlots: ['confirmation'],
      recommendations: [{
        candidateId: 'candidate-news',
        programName: 'Morning News',
        programCode: 'NEWS001',
        duration: 1800,
        programType: 'news',
        score: 95,
        reason: 'test candidate',
      }],
    })
    const interpreter: AgentIntentInterpreter = {
      interpret: vi.fn(async () => ({
        intent: 'insert',
        pendingAction: 'confirm',
        confidence: 0.97,
        source: 'test',
      })),
    }
    const runtime = new SchedulingAgentRuntime({
      dataGateway,
      intentInterpreter: interpreter,
    })

    const result = await runtime.submit({
      userInput: 'yes, go ahead',
      channelId: 'dragon',
      date,
      pendingTask,
    })

    expect(interpreter.interpret).toHaveBeenCalledTimes(1)
    expect(result.status).toBe('executed')
    expect(result.input.interpretation).toMatchObject({
      pendingAction: 'confirm',
    })
    expect(result.executionResult?.scheduleItems).toHaveLength(1)
  })

  it('uses history to choose the next TV episode when today has no same-series item', async () => {
    const history: ScheduleSummary[] = [{
      date: '2026-03-24',
      itemCount: 1,
      programTypes: { drama: 1 },
      items: [buildItem({
        id: 'history-episode-1',
        programId: 'program-drama',
        programCode: '881120030001',
        programName: 'Quality Theater: Storm 第1集',
        instanceName: 'Quality Theater: Storm 第1集',
        startTime: '20:00:00',
        endTime: '20:45:00',
        duration: 2700,
        programType: 'drama',
      })],
    }]
    const dataGateway = buildGateway([], [
      buildCandidate({
        id: 'candidate-episode-3',
        programId: 'program-drama',
        programCode: '881120030003',
        programName: 'Quality Theater: Storm 第3集',
        instanceName: 'Quality Theater: Storm 第3集',
        programType: 'drama',
        duration: 2700,
        issueNo: '0003',
      }),
      buildCandidate({
        id: 'candidate-episode-2',
        programId: 'program-drama',
        programCode: '881120030002',
        programName: 'Quality Theater: Storm 第2集',
        instanceName: 'Quality Theater: Storm 第2集',
        programType: 'drama',
        duration: 2700,
        issueNo: '0002',
      }),
    ], history)
    const interpreter: AgentIntentInterpreter = {
      interpret: vi.fn(async () => ({
        intent: 'insert',
        confidence: 0.95,
        source: 'test',
        slots: {
          targetTime: '20:00:00',
          programHint: 'Quality Theater',
        },
      })),
    }
    const runtime = new SchedulingAgentRuntime({ dataGateway, intentInterpreter: interpreter })

    const result = await runtime.submit({
      userInput: 'insert the next Quality Theater episode',
      channelId: 'dragon',
      date,
    })

    expect(result.status).toBe('executed')
    expect(result.decision.command).toMatchObject({
      intent: 'insert',
      candidateId: 'candidate-episode-2',
      candidateName: 'Quality Theater: Storm 第2集',
    })
    expect(result.decision.candidateSelection).toMatchObject({
      method: 'tv_sequence',
      source: 'history',
      selectedCandidateId: 'candidate-episode-2',
      expectedSequence: 2,
      selectedSequence: 2,
      professionalAssessment: {
        hardBlockCodes: [],
      },
    })
    expect(result.decision.candidateSelection?.professionalAssessment?.signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'playlist_policy', verdict: 'pass' }),
        expect.objectContaining({ code: 'material_readiness', verdict: 'pass' }),
        expect.objectContaining({ code: 'rights_readiness', verdict: 'pass' }),
      ]),
    )
    expect(result.trace.some((step) =>
      step.label.includes('续集候选')
      && (step.detail?.diagnostics as { source?: string } | undefined)?.source === 'history',
    )).toBe(true)
  })

  it('lets today schedule override history when choosing the next TV episode', async () => {
    const history: ScheduleSummary[] = [{
      date: '2026-03-24',
      itemCount: 1,
      programTypes: { drama: 1 },
      items: [buildItem({
        id: 'history-episode-5',
        programId: 'program-drama',
        programCode: '881120030005',
        programName: 'Quality Theater: Storm 第5集',
        instanceName: 'Quality Theater: Storm 第5集',
        startTime: '20:00:00',
        endTime: '20:45:00',
        duration: 2700,
        programType: 'drama',
      })],
    }]
    const dataGateway = buildGateway([
      buildItem({
        id: 'today-episode-2',
        programId: 'program-drama',
        programCode: '881120030002',
        programName: 'Quality Theater: Storm 第2集',
        instanceName: 'Quality Theater: Storm 第2集',
        startTime: '19:00:00',
        endTime: '19:45:00',
        duration: 2700,
        programType: 'drama',
      }),
    ], [
      buildCandidate({
        id: 'candidate-episode-6',
        programId: 'program-drama',
        programCode: '881120030006',
        programName: 'Quality Theater: Storm 第6集',
        instanceName: 'Quality Theater: Storm 第6集',
        programType: 'drama',
        duration: 2700,
        issueNo: '0006',
      }),
      buildCandidate({
        id: 'candidate-episode-3',
        programId: 'program-drama',
        programCode: '881120030003',
        programName: 'Quality Theater: Storm 第3集',
        instanceName: 'Quality Theater: Storm 第3集',
        programType: 'drama',
        duration: 2700,
        issueNo: '0003',
      }),
    ], history)
    const interpreter: AgentIntentInterpreter = {
      interpret: vi.fn(async () => ({
        intent: 'insert',
        confidence: 0.95,
        source: 'test',
        slots: {
          targetTime: '20:00:00',
          programHint: 'Quality Theater',
        },
      })),
    }
    const runtime = new SchedulingAgentRuntime({ dataGateway, intentInterpreter: interpreter })

    const result = await runtime.submit({
      userInput: 'insert the next Quality Theater episode',
      channelId: 'dragon',
      date,
    })

    expect(result.status).toBe('executed')
    expect(result.decision.command).toMatchObject({
      intent: 'insert',
      candidateId: 'candidate-episode-3',
      candidateName: 'Quality Theater: Storm 第3集',
    })
    expect(result.decision.candidateSelection).toMatchObject({
      method: 'tv_sequence',
      source: 'today',
      selectedCandidateId: 'candidate-episode-3',
      expectedSequence: 3,
      selectedSequence: 3,
      professionalAssessment: {
        hardBlockCodes: [],
      },
    })
    expect(result.trace.some((step) =>
      step.label.includes('续集候选')
      && (step.detail?.diagnostics as { source?: string } | undefined)?.source === 'today',
    )).toBe(true)
  })

  it('uses todays scheduled episode as the sequence baseline even when episode ids differ', async () => {
    const history: ScheduleSummary[] = [{
      date: '2026-03-24',
      itemCount: 1,
      programTypes: { drama: 1 },
      items: [buildItem({
        id: 'history-episode-2',
        programId: 'asset-history-episode-2',
        programCode: '881120030002',
        programName: 'Quality Theater: Storm',
        instanceName: 'Quality Theater: Storm',
        startTime: '20:00:00',
        endTime: '20:45:00',
        duration: 2700,
        programType: 'drama',
      })],
    }]
    const dataGateway = buildGateway([
      buildItem({
        id: 'today-episode-3',
        programId: 'asset-today-episode-3',
        programCode: '881120030003',
        programName: 'Quality Theater: Storm',
        instanceName: 'Quality Theater: Storm',
        startTime: '19:00:00',
        endTime: '19:45:00',
        duration: 2700,
        programType: 'drama',
      }),
    ], [
      buildCandidate({
        id: 'candidate-episode-3',
        programId: 'asset-candidate-episode-3',
        programCode: '881120030003',
        programName: 'Quality Theater: Storm',
        instanceName: 'Quality Theater: Storm',
        programType: 'drama',
        duration: 2700,
        issueNo: '0003',
      }),
      buildCandidate({
        id: 'candidate-episode-4',
        programId: 'asset-candidate-episode-4',
        programCode: '881120030004',
        programName: 'Quality Theater: Storm',
        instanceName: 'Quality Theater: Storm',
        programType: 'drama',
        duration: 2700,
        issueNo: '0004',
      }),
    ], history)
    const interpreter: AgentIntentInterpreter = {
      interpret: vi.fn(async () => ({
        intent: 'insert',
        confidence: 0.95,
        source: 'test',
        slots: {
          targetTime: '20:00:00',
          programHint: 'Quality Theater',
        },
      })),
    }
    const runtime = new SchedulingAgentRuntime({ dataGateway, intentInterpreter: interpreter })

    const result = await runtime.submit({
      userInput: 'insert the next Quality Theater episode',
      channelId: 'dragon',
      date,
    })

    expect(result.status).toBe('executed')
    expect(result.decision.command).toMatchObject({
      intent: 'insert',
      candidateId: 'candidate-episode-4',
      candidateName: 'Quality Theater: Storm',
    })
    expect(result.decision.candidateSelection).toMatchObject({
      method: 'tv_sequence',
      source: 'today',
      selectedCandidateId: 'candidate-episode-4',
      expectedSequence: 4,
      selectedSequence: 4,
    })
  })

  it('still lets constraints block a selected TV episode that violates sequence order', async () => {
    const dataGateway = buildGateway([
      buildItem({
        id: 'today-episode-2',
        programId: 'program-drama',
        programCode: '881120030002',
        programName: 'Quality Theater: Storm 第2集',
        instanceName: 'Quality Theater: Storm 第2集',
        startTime: '10:00:00',
        endTime: '10:45:00',
        duration: 2700,
        programType: 'drama',
      }),
    ], [
      buildCandidate({
        id: 'candidate-episode-3',
        programId: 'program-drama',
        programCode: '881120030003',
        programName: 'Quality Theater: Storm 第3集',
        instanceName: 'Quality Theater: Storm 第3集',
        programType: 'drama',
        duration: 2700,
        issueNo: '0003',
      }),
    ])
    const interpreter: AgentIntentInterpreter = {
      interpret: vi.fn(async () => ({
        intent: 'insert',
        confidence: 0.95,
        source: 'test',
        slots: {
          targetTime: '09:00:00',
          programHint: 'Quality Theater',
        },
      })),
    }
    const runtime = new SchedulingAgentRuntime({ dataGateway, intentInterpreter: interpreter })

    const result = await runtime.submit({
      userInput: 'insert the next Quality Theater episode before the existing one',
      channelId: 'dragon',
      date,
    })

    expect(result.status).toBe('blocked')
    expect(result.decision.command).toMatchObject({
      intent: 'insert',
      candidateId: 'candidate-episode-3',
    })
    expect(result.decision.candidateSelection).toMatchObject({
      method: 'tv_sequence',
      source: 'today',
      selectedCandidateId: 'candidate-episode-3',
      expectedSequence: 3,
      selectedSequence: 3,
    })
    expect(result.decision.constraintReport?.issues.some((issue) => issue.code === 'sequence_violation')).toBe(true)
  })

  it('asks for editorial selection when multiple rotation candidates remain available', async () => {
    const dataGateway = buildGateway([], [
      buildCandidate({
        id: 'candidate-low-rating',
        programId: 'program-doc-low',
        programCode: 'DOC001',
        programName: 'City Documentary',
        columnName: 'Documentary',
        contentTags: ['documentary'],
        programType: 'documentary',
        estimatedRating: 1.2,
      }),
      buildCandidate({
        id: 'candidate-high-rating',
        programId: 'program-doc-high',
        programCode: 'DOC002',
        programName: 'City Documentary Prime',
        columnName: 'Documentary',
        contentTags: ['documentary'],
        programType: 'documentary',
        estimatedRating: 3.8,
      }),
    ], [], {
      playlistType: 'rotation',
      rotationStrategy: 'rating',
    })
    const interpreter: AgentIntentInterpreter = {
      interpret: vi.fn(async () => ({
        intent: 'insert',
        confidence: 0.95,
        source: 'test',
        slots: {
          targetTime: '12:00:00',
          programHint: 'Documentary',
        },
      })),
    }
    const runtime = new SchedulingAgentRuntime({ dataGateway, intentInterpreter: interpreter })

    const result = await runtime.submit({
      userInput: 'insert a Documentary item at noon',
      channelId: 'dragon',
      date,
    })

    expect(result.status).toBe('needs_selection')
    expect(result.decision.candidateSelection).toMatchObject({
      method: 'candidate_judge_llm',
      source: 'none',
      candidateOptionIds: ['candidate-low-rating', 'candidate-high-rating'],
    })
    expect(result.decision.pendingTask).toMatchObject({
      intent: 'insert',
      phase: 'needs_selection',
      missingSlots: ['candidateId'],
      recommendations: [
        expect.objectContaining({ candidateId: 'candidate-low-rating' }),
        expect.objectContaining({ candidateId: 'candidate-high-rating' }),
      ],
    })
    expect(result.executionResult).toBeUndefined()
  })

  it('prefers playable rotation candidates over higher scoring blocked candidates', async () => {
    const dataGateway = buildGateway([], [
      buildCandidate({
        id: 'candidate-ready',
        programId: 'program-doc-ready',
        programCode: 'DOC010',
        programName: 'City Documentary Ready',
        columnName: 'Documentary',
        contentTags: ['documentary'],
        programType: 'documentary',
        estimatedRating: 1.5,
      }),
      buildCandidate({
        id: 'candidate-blocked',
        programId: 'program-doc-blocked',
        programCode: 'DOC099',
        programName: 'City Documentary Blocked',
        columnName: 'Documentary',
        contentTags: ['documentary'],
        programType: 'documentary',
        estimatedRating: 99,
        materialStatus: 'missing',
      }),
    ], [], {
      playlistType: 'rotation',
      rotationStrategy: 'rating',
    })
    const interpreter: AgentIntentInterpreter = {
      interpret: vi.fn(async () => ({
        intent: 'insert',
        confidence: 0.95,
        source: 'test',
        slots: {
          targetTime: '12:00:00',
          programHint: 'Documentary',
        },
      })),
    }
    const runtime = new SchedulingAgentRuntime({ dataGateway, intentInterpreter: interpreter })

    const result = await runtime.submit({
      userInput: 'insert a Documentary item at noon',
      channelId: 'dragon',
      date,
    })

    expect(result.status).toBe('needs_confirmation')
    expect(result.decision.candidateSelection).toMatchObject({
      method: 'candidate_judge_llm',
      source: 'fallback',
      selectedCandidateId: 'candidate-ready',
      professionalAssessment: {
        hardBlockCodes: [],
      },
    })
  })

  it('blocks TV sequence fill instead of skipping an unavailable expected episode', async () => {
    const history: ScheduleSummary[] = [{
      date: '2026-03-24',
      itemCount: 1,
      programTypes: { drama: 1 },
      items: [buildItem({
        id: 'history-episode-2',
        programId: 'program-drama',
        programCode: '881120030002',
        programName: 'Quality Theater Storm Episode 2',
        instanceName: 'Quality Theater Storm Episode 2',
        startTime: '20:00:00',
        endTime: '20:45:00',
        duration: 2700,
        programType: 'drama',
      })],
    }]
    const dataGateway = buildGateway([], [
      buildCandidate({
        id: 'candidate-episode-4',
        programId: 'program-drama',
        programCode: '881120030004',
        programName: 'Quality Theater Storm Episode 4',
        instanceName: 'Quality Theater Storm Episode 4',
        programType: 'drama',
        duration: 2700,
        issueNo: '0004',
      }),
    ], history)
    const interpreter: AgentIntentInterpreter = {
      interpret: vi.fn(async () => ({
        intent: 'insert',
        confidence: 0.95,
        source: 'test',
        slots: {
          targetTime: '20:00:00',
          programHint: 'Quality Theater',
        },
      })),
    }
    const runtime = new SchedulingAgentRuntime({ dataGateway, intentInterpreter: interpreter })

    const result = await runtime.submit({
      userInput: 'insert the next Quality Theater episode',
      channelId: 'dragon',
      date,
    })

    expect(result.status).toBe('blocked')
    expect(result.decision.command).toBeUndefined()
    expect(result.decision.candidateSelection).toMatchObject({
      method: 'tv_sequence',
      source: 'history',
      expectedSequence: 3,
      selectedSequence: 4,
    })
    expect(result.decision.auditSummary).toMatchObject({
      outcome: 'blocked',
      candidate: {
        method: 'tv_sequence',
        source: 'history',
      },
      constraintIssueCodes: ['sequence_violation'],
    })
    expect(result.decision.auditSummary?.blockers.length).toBeGreaterThan(0)
  })

  it('asks for editorial selection when a morning TV hint leaves multiple candidates', async () => {
    const dataGateway = buildGateway([], [
      buildCandidate({
        id: 'candidate-morning-drama',
        programId: 'program-morning-drama',
        programCode: 'DRAMA0800',
        programName: 'Morning Drama',
        instanceName: 'Morning Drama',
        columnId: 'drama',
        columnName: 'Drama',
        contentTags: ['morning'],
        programType: 'drama',
      }),
      buildCandidate({
        id: 'candidate-morning-news',
        programId: 'program-morning-news',
        programCode: 'NEWS0800',
        programName: 'Morning News Desk',
        instanceName: 'Morning News Desk',
        columnId: 'news',
        columnName: 'News',
        contentTags: ['morning', 'news'],
        programType: 'news',
      }),
    ])
    const interpreter: AgentIntentInterpreter = {
      interpret: vi.fn(async () => ({
        intent: 'insert',
        confidence: 0.95,
        source: 'test',
        slots: {
          targetTime: '08:00:00',
          programHint: 'Morning',
        },
      })),
    }
    const runtime = new SchedulingAgentRuntime({ dataGateway, intentInterpreter: interpreter })

    const result = await runtime.submit({
      userInput: 'insert Morning at 08:00',
      channelId: 'dragon',
      date,
    })

    expect(result.status).toBe('needs_selection')
    expect(result.decision.candidateSelection).toMatchObject({
      method: 'candidate_judge_llm',
      source: 'none',
      candidateOptionIds: ['candidate-morning-drama', 'candidate-morning-news'],
    })
    expect(result.decision.pendingTask).toMatchObject({
      intent: 'insert',
      phase: 'needs_selection',
      missingSlots: ['candidateId'],
    })
    expect(result.executionResult).toBeUndefined()
  })

  it('keeps neighboring-column matches as selection evidence when multiple candidates remain', async () => {
    const dataGateway = buildGateway([
      buildItem({
        id: 'sports-before',
        programCode: 'SPORTS1400',
        programName: 'Sports Daily',
        columnId: 'sports',
        columnName: 'Sports',
        startTime: '14:00:00',
        endTime: '14:30:00',
        duration: 1800,
        programType: 'sports',
      }),
      buildItem({
        id: 'sports-after',
        programCode: 'SPORTS1500',
        programName: 'Sports Replay',
        columnId: 'sports',
        columnName: 'Sports',
        startTime: '15:00:00',
        endTime: '15:30:00',
        duration: 1800,
        programType: 'sports',
        sequence: 2,
      }),
    ], [
      buildCandidate({
        id: 'candidate-documentary-special',
        programId: 'program-doc-special',
        programCode: 'DOC1430',
        programName: 'Afternoon Special Documentary',
        instanceName: 'Afternoon Special Documentary',
        columnId: 'documentary',
        columnName: 'Documentary',
        contentTags: ['special'],
        programType: 'documentary',
      }),
      buildCandidate({
        id: 'candidate-sports-special',
        programId: 'program-sports-special',
        programCode: 'SPORTS1430',
        programName: 'Afternoon Special Sports',
        instanceName: 'Afternoon Special Sports',
        columnId: 'sports',
        columnName: 'Sports',
        contentTags: ['special'],
        programType: 'sports',
      }),
    ])
    const interpreter: AgentIntentInterpreter = {
      interpret: vi.fn(async () => ({
        intent: 'insert',
        confidence: 0.95,
        source: 'test',
        slots: {
          targetTime: '14:30:00',
          programHint: 'Special',
        },
      })),
    }
    const runtime = new SchedulingAgentRuntime({ dataGateway, intentInterpreter: interpreter })

    const result = await runtime.submit({
      userInput: 'insert Special at 14:30',
      channelId: 'dragon',
      date,
    })

    expect(result.status).toBe('needs_selection')
    expect(result.decision.candidateSelection).toMatchObject({
      method: 'candidate_judge_llm',
      source: 'none',
      candidateOptionIds: ['candidate-documentary-special', 'candidate-sports-special'],
    })
    expect(result.decision.pendingTask).toMatchObject({
      intent: 'insert',
      phase: 'needs_selection',
      missingSlots: ['candidateId'],
    })
    expect(result.executionResult).toBeUndefined()
  })

  it('asks for editorial selection when replacement duty still leaves multiple candidates', async () => {
    const dataGateway = buildGateway([
      buildItem({
        id: 'target-news-slot',
        programCode: 'NEWS1000',
        programName: 'News Bulletin',
        columnId: 'news',
        columnName: 'News',
        startTime: '10:00:00',
        endTime: '10:30:00',
        duration: 1800,
        programType: 'news',
      }),
    ], [
      buildCandidate({
        id: 'candidate-replacement-drama',
        programId: 'program-replacement-drama',
        programCode: 'DRAMA1000',
        programName: 'Replacement Drama',
        instanceName: 'Replacement Drama',
        columnId: 'drama',
        columnName: 'Drama',
        contentTags: ['replacement'],
        programType: 'drama',
      }),
      buildCandidate({
        id: 'candidate-replacement-news',
        programId: 'program-replacement-news',
        programCode: 'NEWS1000R',
        programName: 'Replacement News',
        instanceName: 'Replacement News',
        columnId: 'news',
        columnName: 'News',
        contentTags: ['replacement'],
        programType: 'news',
      }),
    ])
    const interpreter: AgentIntentInterpreter = {
      interpret: vi.fn(async () => ({
        intent: 'replace',
        confidence: 0.95,
        source: 'test',
        slots: {
          targetTime: '10:00:00',
          replacementHint: 'Replacement',
        },
      })),
    }
    const runtime = new SchedulingAgentRuntime({ dataGateway, intentInterpreter: interpreter })

    const result = await runtime.submit({
      userInput: 'replace the 10:00 item with Replacement',
      channelId: 'dragon',
      date,
    })

    expect(result.status).toBe('needs_selection')
    expect(result.decision.candidateSelection).toMatchObject({
      method: 'candidate_judge_llm',
      source: 'none',
      candidateOptionIds: ['candidate-replacement-drama', 'candidate-replacement-news'],
    })
    expect(result.decision.pendingTask).toMatchObject({
      intent: 'replace',
      phase: 'needs_selection',
      missingSlots: ['candidateId'],
    })
    expect(result.executionResult).toBeUndefined()
  })

  /**
   * C1 回归 case：LLM 漏返回 confidence 字段时，normalizeConfidence 应返回 0，
   * 让 normalizeInterpretation 的 confidence < MIN_STRUCTURED_CONFIDENCE(0.5) 判断触发 return null，
   * 整体暴露失败，不本地"盖章"默认 0.75 让不完整理解静默通过门禁。
   *
   * 业务场景：LLM 偶发漏字段属于未遵守 prompt 的异常情况（prompt 第 127 行已强制要求返回 confidence），
   * 应让用户重试或补充，而不是假装理解通过。
   */
  it('returns null when LLM omits confidence field instead of defaulting to 0.75', async () => {
    const chat = vi.fn(async () => ({
      content: JSON.stringify({
        intent: 'insert',
        // 故意不返回 confidence 字段
        slots: {
          targetTime: '10:00:00',
          programHint: '看东方',
        },
      }),
    }))
    const interpreter = new LlmAgentIntentInterpreter({ chat })

    const result = await interpreter.interpret({
      userInput: '10点插入看东方',
      channelId: 'dragon',
      date,
    })

    expect(result).toBeNull()
  })

  /**
   * C1 回归 case：LLM 返回非数字 confidence（如字符串）时，同样返回 null 暴露失败。
   */
  it('returns null when LLM returns non-numeric confidence', async () => {
    const chat = vi.fn(async () => ({
      content: JSON.stringify({
        intent: 'insert',
        confidence: 'high', // 非数字
        slots: {
          targetTime: '10:00:00',
          programHint: '看东方',
        },
      }),
    }))
    const interpreter = new LlmAgentIntentInterpreter({ chat })

    const result = await interpreter.interpret({
      userInput: '10点插入看东方',
      channelId: 'dragon',
      date,
    })

    expect(result).toBeNull()
  })

  /**
   * Q3 回归 case A：LLM 返回 confidence:0 + assistantFeedback 时，
   * normalizeInterpretation 不丢弃 assistantFeedback，返回 intent=undefined 的失败结构，
   * 让上层 schedulingAgentRuntime 能把分类引导话术透传给用户。
   *
   * 业务场景：用户说"插个节目"不给时间不给节目名，LLM 按 prompt 返回
   * {"confidence":0,"assistantFeedback":"你想插到几点？"}，
   * 用户应看到分类引导而非统一兜底"请换一种说法"。
   */
  it('透传 confidence:0 时的 assistantFeedback 分类引导话术', async () => {
    const chat = vi.fn(async () => ({
      content: JSON.stringify({
        confidence: 0,
        reasoning: '用户没有给出插入时间和节目名',
        assistantFeedback: '你想插到几点？',
      }),
    }))
    const interpreter = new LlmAgentIntentInterpreter({ chat })

    const result = await interpreter.interpret({
      userInput: '插个节目',
      channelId: 'dragon',
      date,
    })

    expect(result).not.toBeNull()
    expect(result?.intent).toBeUndefined()
    expect(result?.confidence).toBe(0)
    expect(result?.source).toBe('llm')
    expect(result?.assistantFeedback).toBe('你想插到几点？')
  })

  /**
   * Q3 回归 case B：LLM 返回 confidence:0 但不带 assistantFeedback 时，
   * normalizeInterpretation 保持原行为返回 null（无话术可透传，暴露失败）。
   */
  it('confidence:0 无 assistantFeedback 时仍返回 null 暴露失败', async () => {
    const chat = vi.fn(async () => ({
      content: JSON.stringify({
        confidence: 0,
        reasoning: '无法理解',
      }),
    }))
    const interpreter = new LlmAgentIntentInterpreter({ chat })

    const result = await interpreter.interpret({
      userInput: '某个不可解析的输入',
      channelId: 'dragon',
      date,
    })

    expect(result).toBeNull()
  })

  /**
   * Q3 回归 case C：schedulingAgentRuntime submit 在 LLM 返回 confidence:0 + assistantFeedback 时，
   * 返回 failed 状态，且 explanation 是 LLM 的分类引导话术，而非硬编码兜底。
   *
   * 业务场景：用户只说"插个节目"，LLM 返回"你想插到几点？"，
   * 用户在前端看到的是"你想插到几点？"而不是"这次模型没有正常理解这条指令..."。
   */
  it('submit 透传 LLM 分类引导话术到 explanation', async () => {
    const dataGateway = buildGateway([buildItem()])
    const chat = vi.fn(async () => ({
      content: JSON.stringify({
        confidence: 0,
        reasoning: '用户没有给出插入时间',
        assistantFeedback: '你想插到几点？',
      }),
    }))
    const runtime = new SchedulingAgentRuntime({
      dataGateway,
      intentInterpreter: new LlmAgentIntentInterpreter({ chat }),
    })

    const result = await runtime.submit({
      userInput: '插个节目',
      channelId: 'dragon',
      date,
    })

    expect(result.status).toBe('failed')
    expect(result.decision.constraintReport?.issues[0]?.code).toBe('llm_intent_unavailable')
    expect(result.explanation).toBe('你想插到几点？')
  })
})
