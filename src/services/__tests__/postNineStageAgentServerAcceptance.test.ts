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
import type { LayoutDraft, ScheduleState } from '@/types/orchestration'

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

const canonicalHalfHourCandidates = canonicalSchedulingData.candidates
  .filter((candidate) => candidate.duration === 1800)
  .slice(0, 6)

if (canonicalHalfHourCandidates.length !== 6) {
  throw new Error('data_fixture_missing: post-nine-stage rotation compression requires six canonical half-hour candidates')
}

const formatRotationTime = (totalSeconds: number): string => {
  const hours = Math.floor(totalSeconds / 3600).toString().padStart(2, '0')
  const minutes = Math.floor((totalSeconds % 3600) / 60).toString().padStart(2, '0')
  const seconds = Math.floor(totalSeconds % 60).toString().padStart(2, '0')
  return `2026-03-25T${hours}:${minutes}:${seconds}`
}

const threeHourRotationSchedule: RuntimeScheduleItem[] = canonicalHalfHourCandidates.map((candidate, index) => ({
  id: candidate.id,
  programCode: candidate.programCode,
  programName: candidate.programName,
  startTime: formatRotationTime(index * 1800),
  endTime: formatRotationTime((index + 1) * 1800),
  duration: candidate.duration,
  programType: candidate.programType,
}))

const twoHourRotationDraft: LayoutDraft = {
  id: 'post9-rotation-compression-draft',
  channelId: 'rotation',
  date: '2026-03-25',
  version: 1,
  source: 'generated',
  userIntent: '按热播优先把当前3小时轮播单压缩到2小时',
  draftKind: 'duration_segments',
  targetDurationSeconds: 7200,
  coverage: { start: '00:00:00', end: '02:00:00' },
  layoutReference: {
    id: 'post9-rotation-compression-layout',
    name: '2小时轮播压缩草案',
    slots: [{
      id: 'post9-rotation-compression-slot',
      channelId: 'rotation',
      columnId: 'post9-rotation-compression-column',
      startTime: '00:00:00',
      endTime: '02:00:00',
    }],
  },
  columns: [{
    columnId: 'post9-rotation-compression-column',
    columnName: '热播内容压缩方案',
    channelId: 'rotation',
    defaultProgramType: 'mixed',
    source: 'generated',
    semanticLabel: '热播内容',
    queryHints: ['热播内容'],
  }],
  durationSegments: [{
    id: 'post9-rotation-compression-segment',
    label: '热播内容',
    contentHint: '从当前正式轮播现场中按热播策略选择完整节目',
    targetDurationSeconds: 7200,
    selectionPriority: 'trending',
    repeatPolicy: 'avoid_repeat',
    fallbackPolicy: 'ask_user',
  }],
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
  it('post9-rotation-compression-staged-react: publishes a canonical 7200-second formal snapshot in the granted session', async () => {
    const sessions = new AgentServerSessionStore()
    const session = sessions.createSession()
    const workspaceKey = 'rotation:post9-rotation-1'
    const pendingId = 'post9-rotation-compression-confirmation'
    const input: RuntimeSubmitInput = {
      ...submitInput(
        '确认按刚才的2小时压缩草案正式重新编排',
        {
          ...rotationState,
          isEmpty: false,
          itemCount: threeHourRotationSchedule.length,
          gapCount: 0,
          rotationStrategy: 'trending',
          rotationDurationSeconds: 10800,
        },
        threeHourRotationSchedule,
      ),
      currentLayoutDraft: twoHourRotationDraft,
    }
    sessions.updateSession(session.id, {
      pendingAtomicContext: {
        pendingId,
        action: null,
        phase: 'formal_rebuild_confirmation',
        summary: '待确认按2小时草案重新编排轮播单',
        reasoning: '当前正式轮播单已有3小时节目',
        originalUserInput: '分析当前3小时轮播单，按热播优先形成压缩到2小时的方案',
        collectedUserInput: input.userInput,
        slots: {},
        missingFields: ['selection'],
        followUpQuestion: '确认按该草案正式重新编排吗？',
        attemptCount: 0,
        formalRebuildConfirmation: {
          actionKind: 'formal_orchestration',
          mode: 'full_generate',
          existingItemCount: threeHourRotationSchedule.length,
          playlistType: 'rotation',
          userInput: input.userInput,
        },
        owner: 'formal_playlist',
        workspaceKey,
        mutationId: pendingId,
        mutationPolicy: 'pending_only',
        createdAt: '2026-03-25T00:00:00.000Z',
        updatedAt: '2026-03-25T00:00:00.000Z',
      },
    })
    const finalSchedule = threeHourRotationSchedule.slice(0, 4)
    const startReactOrchestration = vi.fn(async (_request, _input, _deadline, onCheckpoint) => {
      onCheckpoint?.({
        id: 'post9-compression-run:checkpoint:1:continue',
        runId: 'post9-compression-run',
        objective: '按已确认草案将轮播单压缩到2小时',
        turn: 1,
        actions: [{ type: 'research_check', queries: ['热播内容'] }],
        observations: [{
          actionType: 'research_check',
          success: true,
          summary: '已核验当前正式节目与候选证据。',
          data: { candidateCount: canonicalHalfHourCandidates.length, noMutation: true },
        }],
        decision: { kind: 'continue', reason: '候选证据充分，继续正式编排。', nextActions: [{ type: 'validate' }] },
        createdAt: '2026-03-25T00:00:01.000Z',
      })
      onCheckpoint?.({
        id: 'post9-compression-run:checkpoint:2:complete',
        runId: 'post9-compression-run',
        objective: '按已确认草案将轮播单压缩到2小时',
        turn: 2,
        actions: [{ type: 'validate' }],
        observations: [{
          actionType: 'validate',
          success: true,
          summary: '正式结果总时长7200秒且节目边界完整。',
          data: { durationSeconds: 7200, noMutation: false },
        }],
        decision: { kind: 'complete', reason: '正式结果满足已确认的2小时草案。' },
        createdAt: '2026-03-25T00:00:02.000Z',
      })
      return { status: 'completed' as const, checkpointCount: 2, scheduleItems: finalSchedule }
    })
    const server = new AgentServerRuntime({
      sessions,
      runtime: {
        submitInstruction: vi.fn(async () => ({
          kind: 'orchestration' as const,
          feedback: { content: '开始按已确认草案正式重编。', processType: 'planning' as const, processTypeLabel: '任务规划' },
          orchestrationRequest: {
            userInput: input.userInput,
            mode: 'full_generate' as const,
            reasoning: '用户已确认完整2小时草案。',
            layoutDraft: twoHourRotationDraft,
            reactTask: {
              objective: '按已确认草案将轮播单压缩到2小时',
              nextActions: [{ type: 'research_check' as const, queries: ['热播内容'] }],
            },
            authorizationRequest: {
              sourcePendingId: pendingId,
              workspaceKey,
              mode: 'full_generate' as const,
              existingItemCount: threeHourRotationSchedule.length,
            },
          },
        })),
        executePendingCommand: vi.fn(),
        resolvePendingTargetSelection: vi.fn(),
        resolvePendingInsertRecommendation: vi.fn(),
        startReactOrchestration,
      },
    })

    const submitted = await server.submitInstruction(input, session.id)
    expect(submitted.decision?.kind).toBe('orchestration')
    if (submitted.decision?.kind !== 'orchestration') throw new Error('expected orchestration decision')
    const beforeVersion = submitted.session.formalPlaylistVersion

    const executed = await server.executeReactOrchestration(
      submitted.decision.orchestrationRequest,
      input,
      session.id,
    )

    const replay = server.getSessionReplayPackage(session.id)
    const formalItems = sessions.getSession(session.id)?.formalPlaylistSnapshot?.items ?? []
    const canonicalIds = new Set(canonicalSchedulingData.candidates.map((candidate) => candidate.id))
    expect(startReactOrchestration).toHaveBeenCalledWith(
      expect.objectContaining({
        authorizationGrantId: expect.stringMatching(/^formal_rebuild_grant_/),
        resolvedAuthorization: expect.objectContaining({ sourcePendingId: pendingId, workspaceKey }),
      }),
      expect.anything(),
      expect.anything(),
      expect.any(Function),
    )
    expect(executed.result).toMatchObject({ status: 'completed', checkpointCount: 2 })
    expect(executed.session).toMatchObject({
      formalPlaylistWorkspaceKey: workspaceKey,
      formalPlaylistItemCount: 4,
      formalOrchestrationCheckpointCount: 2,
    })
    expect(executed.session.formalPlaylistVersion).not.toBe(beforeVersion)
    expect(formalItems.reduce((total, item) => total + (item.duration ?? 0), 0)).toBe(7200)
    expect(formalItems.every((item) => canonicalIds.has(item.id))).toBe(true)
    expect(replay?.formalOrchestration?.grant).toMatchObject({
      sourcePendingId: pendingId,
      workspaceKey,
      status: 'consumed',
    })
    expect(server.getSessionEvents(session.id)).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'react_checkpoint', data: expect.objectContaining({ workspaceKey }) }),
      expect.objectContaining({ type: 'progress', data: expect.objectContaining({ processTypeLabel: '查节目库' }) }),
      expect.objectContaining({ type: 'progress', data: expect.objectContaining({ processTypeLabel: '候选决策' }) }),
    ]))
  })

  it('post9-server-pending-delete-commits-once: commits a canonical pending delete once and publishes formal state evidence', async () => {
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

  it('post9-server-workspace-mismatch-preserves-formal: rejects an old-workspace pending without replacing the server formal snapshot', async () => {
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

  it('post9-formal-version-drift-blocks-stale-confirmation: blocks a stale confirmation after the formal playlist version drifts', async () => {
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

  it('post9-server-write-exception-remains-retryable: exposes a thrown write failure and lets the same mutation retry', async () => {
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
