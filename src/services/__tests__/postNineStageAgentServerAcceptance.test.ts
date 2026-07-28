import { describe, expect, it, vi } from 'vitest'

import { canonicalSchedulingData } from '@/services/agent/canonicalSchedulingData'
import { AgentServerRuntime } from '@/services/runtime/agentServerRuntime'
import { AgentServerSessionStore } from '@/services/runtime/agentServerSessionStore'
import type {
  RuntimeDecision,
  RuntimeExecutePendingCommandInput,
  RuntimeExecutedResult,
  RuntimeResolveInsertRecommendationInput,
  RuntimeResolveTargetSelectionInput,
  RuntimeScheduleItem,
  RuntimeSubmitInput,
} from '@/services/runtime/schedulingAgentRuntimeFacade'
import type { ScheduleState } from '@/types/orchestration'

const canonicalCandidates = canonicalSchedulingData.candidates.filter((candidate) => candidate.programName.startsWith('看东方'))
const primaryCandidate = canonicalCandidates[0]
const adjacentCandidate = canonicalSchedulingData.candidates.find((candidate) => candidate.programName !== '看东方')

if (!primaryCandidate || !adjacentCandidate) {
  throw new Error('data_fixture_missing: post-nine-stage acceptance requires canonical 看东方 and adjacent candidates')
}

const toScheduleItem = (
  candidate: typeof primaryCandidate,
  startTime: string,
): RuntimeScheduleItem => {
  const startMs = new Date(startTime).getTime()
  return {
    id: candidate.id,
    programCode: candidate.programCode,
    programName: candidate.programName,
    startTime,
    endTime: new Date(startMs + candidate.duration * 1000).toISOString().replace('.000Z', ''),
    duration: candidate.duration,
    programType: candidate.programType,
  }
}

const targetItem = toScheduleItem(primaryCandidate, '2026-03-25T09:00:00')
const neighborItem = toScheduleItem(adjacentCandidate, '2026-03-25T10:00:00')

const tvState: ScheduleState = {
  playlistId: 'post9-tv-1',
  playlistType: 'tv',
  channelId: primaryCandidate.channelId,
  channelName: '九阶段后验收电视播单',
  date: '2026-03-25',
  isEmpty: false,
  itemCount: 2,
  gapCount: 1,
  hasSelectedTimeRange: false,
}

const rotationState: ScheduleState = {
  playlistId: 'post9-rotation-1',
  playlistType: 'rotation',
  channelId: 'rotation',
  channelName: '九阶段后验收轮播单',
  date: '2026-03-25',
  isEmpty: true,
  itemCount: 0,
  gapCount: 1,
  hasSelectedTimeRange: false,
  rotationStrategy: 'content_match',
  rotationDurationSeconds: 3600,
}

const submitInput = (
  userInput: string,
  scheduleState: ScheduleState = tvState,
  currentSchedule: RuntimeScheduleItem[] = [targetItem, neighborItem],
): RuntimeSubmitInput => ({
  userInput,
  scheduleState,
  currentSchedule,
  history: [],
  layoutDraftEnabled: true,
})

const pendingDeleteDecision = (): Extract<RuntimeDecision, { kind: 'pending_command' }> => ({
  kind: 'pending_command',
  feedback: {
    content: '删除节目需要确认。',
    processType: 'selection',
    processTypeLabel: '待确认修改',
  },
  pendingCommand: {
    command: { action: 'delete', data: { itemId: targetItem.id }, reasoning: '用户确认后删除。' },
    summary: `删除${targetItem.programName}`,
    reasoning: '用户确认后删除。',
  },
})

const createServer = (
  executePendingCommand: (input: RuntimeExecutePendingCommandInput) => Promise<RuntimeExecutedResult>,
  sessions = new AgentServerSessionStore(),
) => new AgentServerRuntime({
  sessions,
  runtime: {
    submitInstruction: vi.fn(async () => pendingDeleteDecision()),
    executePendingCommand,
    resolvePendingTargetSelection: vi.fn(async (_input: RuntimeResolveTargetSelectionInput) => pendingDeleteDecision()),
    resolvePendingInsertRecommendation: vi.fn(async (_input: RuntimeResolveInsertRecommendationInput) => pendingDeleteDecision()),
    startReactOrchestration: vi.fn(),
  },
})

const executeInput = (
  submitted: Awaited<ReturnType<AgentServerRuntime['submitInstruction']>>,
  overrides: Partial<RuntimeExecutePendingCommandInput> = {},
): RuntimeExecutePendingCommandInput => {
  if (submitted.decision?.kind !== 'pending_command') throw new Error('expected server pending command')
  return {
    pendingCommand: submitted.decision.pendingCommand,
    pendingId: submitted.decision.pendingCommand.pendingId,
    idempotencyKey: submitted.decision.pendingCommand.pendingId,
    workspaceKey: submitted.session.formalPlaylistWorkspaceKey ?? undefined,
    scheduleDate: tvState.date,
    channelId: tvState.channelId,
    expectedPlaylistVersion: submitted.session.formalPlaylistVersion,
    ...overrides,
  }
}

describe('post-nine-stage Agent Server black-box acceptance', () => {
  it('commits a canonical pending delete once and publishes formal state evidence', async () => {
    const delegate = vi.fn(async (input: RuntimeExecutePendingCommandInput): Promise<RuntimeExecutedResult> => ({
      success: true,
      command: input.pendingCommand.command,
      message: '已删除。',
      summary: input.pendingCommand.summary,
      data: { deletedItem: targetItem },
    }))
    const server = createServer(delegate)
    const submitted = await server.submitInstruction(submitInput('删除当前播单里的看东方，确认后执行'))
    const beforeVersion = submitted.session.formalPlaylistVersion

    const executed = await server.executePendingCommand(executeInput(submitted), submitted.sessionId)

    expect(delegate).toHaveBeenCalledTimes(1)
    expect(executed.result).toMatchObject({ success: true })
    expect(executed.session).toMatchObject({
      hasPendingCommand: false,
      formalPlaylistItemCount: 1,
      formalPlaylistWorkspaceKey: submitted.session.formalPlaylistWorkspaceKey,
    })
    expect(executed.session.formalPlaylistVersion).not.toBe(beforeVersion)
    expect(server.getSessionEvents(submitted.sessionId)).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'formal_write', data: expect.objectContaining({
        formalWrite: expect.objectContaining({ status: 'applied' }),
      }) }),
    ]))
  })

  it('rejects an old-workspace pending without replacing the server formal snapshot', async () => {
    const delegate = vi.fn()
    const server = createServer(delegate)
    const submitted = await server.submitInstruction(submitInput('删除当前播单里的看东方'))
    const oldVersion = submitted.session.formalPlaylistVersion
    const oldCount = submitted.session.formalPlaylistItemCount
    const oldWorkspace = submitted.session.formalPlaylistWorkspaceKey
    if (submitted.decision?.kind !== 'pending_command') throw new Error('expected pending command')

    const rejected = await server.submitInstruction({
      ...submitInput('切到另一张播单后继续刚才的确认', rotationState, []),
      pendingAtomicContext: {
        action: 'delete',
        phase: 'clarifying',
        summary: '继续旧工作区删除',
        reasoning: '旧工作区 pending',
        originalUserInput: '删除看东方',
        collectedUserInput: '继续',
        slots: { programName: targetItem.programName },
        missingFields: ['selection'],
        followUpQuestion: '是否继续？',
        attemptCount: 0,
        createdAt: '2026-03-25T00:00:00.000Z',
        updatedAt: '2026-03-25T00:00:00.000Z',
        owner: 'formal_playlist',
        workspaceKey: oldWorkspace ?? 'none',
        mutationId: submitted.decision.pendingCommand.pendingId ?? 'missing',
        mutationPolicy: 'pending_only',
      },
    }, submitted.sessionId)

    expect(delegate).not.toHaveBeenCalled()
    expect(rejected.decision).toMatchObject({ kind: 'message', feedback: { details: expect.objectContaining({ noMutation: true }) } })
    expect(rejected.session.formalPlaylistVersion).toBe(oldVersion)
    expect(rejected.session.formalPlaylistItemCount).toBe(oldCount)
    expect(rejected.session.formalPlaylistWorkspaceKey).toBe(oldWorkspace)
  })

  it('blocks a stale confirmation after the formal playlist version drifts', async () => {
    const delegate = vi.fn()
    const sessions = new AgentServerSessionStore()
    const server = createServer(delegate, sessions)
    const submitted = await server.submitInstruction(submitInput('确认执行刚才的删除'))
    const session = sessions.getSession(submitted.sessionId)
    if (!session?.formalPlaylistSnapshot) throw new Error('expected formal snapshot')
    sessions.updateSession(submitted.sessionId, { formalPlaylistVersion: 'formal_concurrent_change' })

    const result = await server.executePendingCommand(executeInput(submitted), submitted.sessionId)

    expect(delegate).not.toHaveBeenCalled()
    expect(result.result).toMatchObject({ success: false, error: 'formal_playlist_version_conflict' })
    expect(result.session).toMatchObject({
      hasPendingCommand: true,
      formalPlaylistVersion: 'formal_concurrent_change',
      formalPlaylistItemCount: 2,
    })
  })

  it('exposes a thrown write failure and lets the same mutation retry', async () => {
    const delegate = vi.fn()
      .mockRejectedValueOnce(new Error('injected network disconnect'))
      .mockImplementationOnce(async (input: RuntimeExecutePendingCommandInput): Promise<RuntimeExecutedResult> => ({
        success: true,
        command: input.pendingCommand.command,
        message: '重试成功。',
        summary: input.pendingCommand.summary,
        data: { deletedItem: targetItem },
      }))
    const server = createServer(delegate)
    const submitted = await server.submitInstruction(submitInput('正式写入时网络断开，恢复后重试刚才的确认'))
    const input = executeInput(submitted)

    const failed = await server.executePendingCommand(input, submitted.sessionId)
    const retried = await server.executePendingCommand(input, submitted.sessionId)

    expect(failed.result).toMatchObject({ success: false, error: 'formal_playlist_write_failed' })
    expect(failed.session).toMatchObject({ hasPendingCommand: true, formalPlaylistItemCount: 2 })
    expect(retried.result).toMatchObject({ success: true })
    expect(retried.session).toMatchObject({ hasPendingCommand: false, formalPlaylistItemCount: 1 })
    expect(delegate).toHaveBeenCalledTimes(2)
  })
})
