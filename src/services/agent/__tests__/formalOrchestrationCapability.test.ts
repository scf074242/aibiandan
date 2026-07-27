import { describe, expect, it, vi } from 'vitest'

import { FormalOrchestrationCapability } from '@/services/agent/formalOrchestrationCapability'
import type { RuntimeSubmitInput } from '@/services/runtime/demoRuntimeFacade'
import type { LayoutDraft, ScheduleState, TaskClassification } from '@/types/orchestration'

function createMinimalScheduleState(overrides?: Partial<ScheduleState>): ScheduleState {
  return {
    playlistType: 'tv',
    channelId: 'test-channel',
    channelName: 'Test Channel',
    date: '2026-06-29',
    isEmpty: false,
    itemCount: 0,
    ...overrides,
  } as ScheduleState
}

function createCompleteLayoutDraft(overrides?: Partial<LayoutDraft>): LayoutDraft {
  return {
    id: 'draft-1',
    source: 'channel_default',
    channelId: 'test-channel',
    date: '2026-06-29',
    draftKind: 'time_slots',
    coverage: { start: '06:00:00', end: '23:59:59' },
    userIntent: '测试草案',
    layoutReference: {
      id: 'layout-1',
      name: 'Test Layout',
      channelId: 'test-channel',
      slots: [
        {
          id: 'slot-1',
          channelId: 'test-channel',
          columnId: 'column-1',
          startTime: '2026-06-29T06:00:00+08:00',
          endTime: '2026-06-29T10:00:00+08:00',
        },
        {
          id: 'slot-2',
          channelId: 'test-channel',
          columnId: 'column-2',
          startTime: '2026-06-29T10:00:00+08:00',
          endTime: '2026-06-29T14:00:00+08:00',
        },
        {
          id: 'slot-3',
          channelId: 'test-channel',
          columnId: 'column-3',
          startTime: '2026-06-29T14:00:00+08:00',
          endTime: '2026-06-29T23:59:59+08:00',
        },
      ],
    },
    columns: [
      { columnId: 'column-1', columnName: '早间', channelId: 'test-channel', defaultProgramType: 'news', source: 'default' },
      { columnId: 'column-2', columnName: '午间', channelId: 'test-channel', defaultProgramType: 'news', source: 'default' },
      { columnId: 'column-3', columnName: '晚间', channelId: 'test-channel', defaultProgramType: 'drama', source: 'default' },
    ],
    ...overrides,
  } as unknown as LayoutDraft
}

function createMinimalRuntimeInput(
  userInput: string,
  overrides?: Partial<RuntimeSubmitInput>,
): RuntimeSubmitInput {
  return {
    scheduleState: createMinimalScheduleState(),
    userInput,
    currentSchedule: [],
    currentLayoutDraft: null,
    ...overrides,
  } as RuntimeSubmitInput
}

const adapter = {
  resolveExistingLayoutDraft: () => null,
  parseCompactHourRange: () => null,
}

const reactTask = {
  objective: '完成正式编排',
  nextActions: [{ type: 'validate' as const }],
}

describe('FormalOrchestrationCapability', () => {
  it('exposes orchestration capability id and metadata', () => {
    const capability = new FormalOrchestrationCapability()
    expect(capability.id).toBe('orchestration')
    expect(capability.metadata.intents).toContain('full_generate')
    expect(capability.metadata.intents).toContain('partial_generate')
    expect(capability.metadata.intents).toContain('formal_orchestration')
  })

  it('claims full_generate orchestration input', () => {
    const capability = new FormalOrchestrationCapability()
    const input = {
      userInput: '全天编排',
      channelId: 'c1',
      date: '2026-06-29',
      orchestration: {
        mode: 'full_generate' as const,
        channelId: 'c1',
        date: '2026-06-29',
      },
    }
    expect(capability.canHandle(input)).toBe(true)
  })

  it('claims partial_generate orchestration input', () => {
    const capability = new FormalOrchestrationCapability()
    const input = {
      userInput: '补空窗',
      channelId: 'c1',
      date: '2026-06-29',
      orchestration: {
        mode: 'partial_generate' as const,
        channelId: 'c1',
        date: '2026-06-29',
      },
    }
    expect(capability.canHandle(input)).toBe(true)
  })

  it('does not claim atomic input', () => {
    const capability = new FormalOrchestrationCapability()
    const input = {
      userInput: '删除 09:00 的节目',
      channelId: 'c1',
      date: '2026-06-29',
      interpretation: { intent: 'delete', confidence: 1, source: 'deterministic' },
    }
    expect(capability.canHandle(input)).toBe(false)
  })

  it('builds a full_generate orchestration decision when draft is complete', () => {
    const capability = new FormalOrchestrationCapability()
    const input = createMinimalRuntimeInput('全天编排', {
      currentLayoutDraft: createCompleteLayoutDraft(),
    })
    const decision = capability.buildFormalOrchestrationDecisionForMode(
      input,
      adapter,
      'full_generate',
      '用户要求全天编排',
      { reactTask },
    )
    expect(decision.kind).toBe('orchestration')
    if (decision.kind === 'orchestration') {
      expect(decision.orchestrationRequest.mode).toBe('full_generate')
      expect(decision.orchestrationRequest.lifecycle.taskKind).toBe('full_day')
      expect(decision.orchestrationRequest.lifecycle.writesFormalPlaylist).toBe(true)
      expect(decision.orchestrationRequest.lifecycle.canInterrupt).toBe(true)
    }
  })

  it('builds a partial_generate orchestration decision for explicit time range', () => {
    const capability = new FormalOrchestrationCapability()
    const input = createMinimalRuntimeInput('补齐 09:00-12:00 空窗', {
      currentLayoutDraft: createCompleteLayoutDraft(),
    })
    const decision = capability.buildFormalOrchestrationDecisionForMode(
      input,
      adapter,
      'partial_generate',
      '用户要求局部补排',
      { reactTask, plannerSemantics: { taskKind: 'local_refill', useLayoutDraft: true, targetTimeRange: { start: '09:00:00', end: '12:00:00' }, searchKeywords: [] } },
    )
    expect(decision.kind).toBe('orchestration')
    if (decision.kind === 'orchestration') {
      expect(decision.orchestrationRequest.mode).toBe('partial_generate')
      expect(decision.orchestrationRequest.lifecycle.taskKind).toBe('local_refill')
    }
  })

  it('requires confirmation before rebuilding a non-empty playlist in full_generate', () => {
    const capability = new FormalOrchestrationCapability()
    const input = createMinimalRuntimeInput('全天编排', {
      scheduleState: createMinimalScheduleState({ itemCount: 3 }),
      currentSchedule: [
        { id: '1', startTime: '06:00:00', endTime: '07:00:00' },
        { id: '2', startTime: '07:00:00', endTime: '08:00:00' },
        { id: '3', startTime: '08:00:00', endTime: '09:00:00' },
      ],
      currentLayoutDraft: createCompleteLayoutDraft(),
    })
    const decision = capability.buildFormalOrchestrationDecisionForMode(
      input,
      adapter,
      'full_generate',
      '用户要求全天编排',
    )
    expect(decision.kind).toBe('pending_atomic_context')
    if (decision.kind === 'pending_atomic_context') {
      expect(decision.pendingAtomicContext.phase).toBe('formal_rebuild_confirmation')
    }
  })

  it('skips rebuild confirmation when skipFormalRebuildGate is true', () => {
    const capability = new FormalOrchestrationCapability()
    const input = createMinimalRuntimeInput('全天编排', {
      scheduleState: createMinimalScheduleState({ itemCount: 3 }),
      currentSchedule: [{ id: '1', startTime: '06:00:00', endTime: '09:00:00' }],
      currentLayoutDraft: createCompleteLayoutDraft(),
    })
    const decision = capability.buildFormalOrchestrationDecisionForMode(
      input,
      adapter,
      'full_generate',
      '用户要求全天编排',
      { skipFormalRebuildGate: true, reactTask },
    )
    expect(decision.kind).toBe('orchestration')
  })

  it('blocks tv full_generate when no layout draft is available', () => {
    const capability = new FormalOrchestrationCapability()
    const input = createMinimalRuntimeInput('按版面草案全天编排', {
      scheduleState: createMinimalScheduleState({ playlistType: 'tv', isEmpty: true }),
    })
    expect(capability.buildFormalOrchestrationDecision(input, adapter)).toBeNull()
  })

  it('builds a layout_commit decision from a confirmed draft', () => {
    const capability = new FormalOrchestrationCapability()
    const draft = createCompleteLayoutDraft({ id: 'draft-confirmed' })
    const input = createMinimalRuntimeInput('确认草案并编排', {
      currentLayoutDraft: draft,
      scheduleState: createMinimalScheduleState({ isEmpty: true }),
    })
    const classification: TaskClassification = {
      mode: 'formal_orchestration',
      reasoning: '用户确认草案',
      suggestedParams: { orchestrationMode: 'full_generate' },
    }
    const decision = capability.buildCommitLayoutDraftDecision(
      input,
      adapter,
      'full_generate',
      classification,
      { reactTask },
    )
    expect(decision.kind).toBe('layout_commit')
    if (decision.kind === 'layout_commit') {
      expect(decision.draft.id).toBe('draft-confirmed')
      expect(decision.orchestrationRequest.layoutDraft).toBe(draft)
    }
  })
})
