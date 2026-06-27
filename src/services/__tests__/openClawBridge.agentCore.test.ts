import { beforeEach, describe, expect, it } from 'vitest'

import { getAtomicCapabilities, resetAtomicCapabilities } from '@/services/atomicCapabilities'
import { OpenClawBridge } from '@/services/openclaw/openClawBridge'
import type { RuntimeScheduleItem } from '@/services/runtime/demoRuntimeFacade'

const baseInput = {
  channelId: 'dragon',
  channelName: '东方卫视',
  date: '2026-03-25',
  gapCount: 0,
  history: [],
  playlistType: 'tv' as const,
}

const buildScheduleItem = (patch: Partial<RuntimeScheduleItem> = {}): RuntimeScheduleItem => ({
  id: 'item-0900',
  programCode: 'KDF001',
  programName: '看东方',
  startTime: '09:00:00',
  endTime: '09:30:00',
  duration: 1800,
  programType: 'news',
  ...patch,
})

const buildSecondScheduleItem = (patch: Partial<RuntimeScheduleItem> = {}): RuntimeScheduleItem => ({
  id: 'item-0930',
  programCode: 'DFXW001',
  programName: '\u4e1c\u65b9\u65b0\u95fb',
  startTime: '09:30:00',
  endTime: '10:00:00',
  duration: 1800,
  programType: 'news',
  ...patch,
})

describe('OpenClawBridge Agent Core integration', () => {
  beforeEach(async () => {
    resetAtomicCapabilities()
    await getAtomicCapabilities().clearAll()
  })

  it('电视播单常规新闻栏目插入不会被剧集顺播基线误阻断', async () => {
    const bridge = new OpenClawBridge()
    const result = await bridge.submitInstruction({
      ...baseInput,
      conversationId: 'conv-agent-core-tv-news-insert',
      text: '在9点插入节目看东方',
      currentSchedule: [],
    })

    expect(result.status).toBe('completed')
    expect(result.payload?.lastDecisionKind).toBe('agent_execution')
    expect(result.payload?.pendingAtomicContext).toBeNull()
    expect(result.payload?.agentAuditSummary).toMatchObject({
      outcome: 'executed',
      playlistPolicy: {
        playlistType: 'tv',
        commandIntent: 'insert',
        executionMode: 'direct_execute',
        policyAction: 'execute',
      },
      operation: {
        committed: true,
        commandIntent: 'insert',
      },
    })
    expect(result.payload?.agentAuditSummary?.constraintIssueCodes ?? []).not.toContain('history_source_missing')
    expect(getAtomicCapabilities().getAllItems()).toHaveLength(1)
    expect(getAtomicCapabilities().getAllItems()[0]).toMatchObject({
      startTime: '2026-03-25T09:00:00+08:00',
      programName: expect.stringContaining('看东方'),
    })
  })

  it('电视播单明确移动命令会由 Agent Core 直接执行并回写节目单', async () => {
    const bridge = new OpenClawBridge()
    const result = await bridge.submitInstruction({
      ...baseInput,
      conversationId: 'conv-agent-core-tv-move',
      text: '把9点的节目整体后移30分钟',
      currentSchedule: [buildScheduleItem()],
    })

    expect(result.status).toBe('completed')
    expect(result.payload?.lastDecisionKind).toBe('agent_execution')
    expect(result.payload?.pendingAtomicContext).toBeNull()
    expect(result.payload?.agentCapabilities).toMatchObject({
      capabilityIds: ['atomic_command'],
      dataRequirements: expect.arrayContaining([
        expect.objectContaining({
          sourceKey: 'candidates',
          missingBehavior: 'block_write',
          guardCode: 'candidate_source_missing',
        }),
      ]),
      safetyGates: expect.arrayContaining([
        expect.objectContaining({
          id: 'pending_lifecycle',
          mode: 'reroute',
        }),
        expect.objectContaining({
          id: 'context_fingerprint',
          mode: 'block',
        }),
      ]),
    })
    expect(result.payload?.agentOperationalReadiness).toMatchObject({
      status: 'ready',
      executablePercent: 100,
      executableCommands: 8,
      totalCommands: 8,
      playlistType: 'tv',
      gaps: [],
      commandReadiness: expect.arrayContaining([
        expect.objectContaining({
          intent: 'move',
          status: 'ready',
          executionMode: 'direct_execute',
          blockingSources: [],
          advisorySources: [],
        }),
        expect.objectContaining({
          intent: 'insert',
          status: 'ready',
          executionMode: 'direct_execute',
          blockingSources: [],
          advisorySources: [],
        }),
      ]),
      sourceCoverage: expect.arrayContaining([
        expect.objectContaining({
          sourceKey: 'today',
          status: 'available',
          recordCount: 1,
        }),
        expect.objectContaining({
          sourceKey: 'readiness',
          status: 'available',
          source: 'readiness_reader',
          recordCount: expect.any(Number),
        }),
      ]),
    })
    expect(result.payload?.agentAuditSummary).toMatchObject({
      outcome: 'executed',
      playlistPolicy: {
        playlistType: 'tv',
        commandIntent: 'move',
        executionMode: 'direct_execute',
        policyAction: 'execute',
      },
      operation: {
        committed: true,
        commandIntent: 'move',
      },
    })
    expect(result.payload?.agentAuditSummary?.keyPoints).toEqual(
      expect.arrayContaining([
        expect.stringContaining('播单策略：类型=tv'),
        expect.stringContaining('写入状态：已写入'),
      ]),
    )

    expect(getAtomicCapabilities().getAllItems()[0]).toMatchObject({
      id: 'item-0900',
      startTime: '2026-03-25T09:30:00+08:00',
      endTime: '2026-03-25T10:00:00+08:00',
    })
  })

  it('敏感删除命令会保存 Agent 结构化上下文，并在下一轮确认后执行', async () => {
    const bridge = new OpenClawBridge()
    const currentSchedule = [buildScheduleItem()]

    const first = await bridge.submitInstruction({
      ...baseInput,
      conversationId: 'conv-agent-core-delete-confirm',
      text: '删除9点的节目',
      currentSchedule,
    })

    expect(first.status).toBe('needs_confirmation')
    expect(first.payload?.lastDecisionKind).toBe('pending_atomic_context')
    expect(first.payload?.agentCapabilities).toMatchObject({
      commandPolicies: expect.arrayContaining([
        expect.objectContaining({
          intent: 'delete',
          tvMode: 'confirm_before_commit',
          rotationMode: 'confirm_before_commit',
        }),
      ]),
      safetyGates: expect.arrayContaining([
        expect.objectContaining({
          id: 'playlist_policy',
          mode: 'confirm',
        }),
      ]),
    })
    expect(first.payload?.agentOperationalReadiness).toMatchObject({
      status: 'ready',
      executablePercent: 100,
      commandReadiness: expect.arrayContaining([
        expect.objectContaining({
          intent: 'delete',
          status: 'ready',
          executionMode: 'confirm_before_commit',
        }),
      ]),
    })
    expect(first.payload?.pendingAtomicContext).toMatchObject({
      action: 'delete',
      agentIntent: 'delete',
      agentPendingTask: {
        intent: 'delete',
        phase: 'needs_confirmation',
      },
    })
    expect(first.payload?.agentAuditSummary).toMatchObject({
      outcome: 'pending',
      playlistPolicy: {
        playlistType: 'tv',
        commandIntent: 'delete',
        executionMode: 'confirm_before_commit',
        policyAction: 'confirm',
      },
      pendingTask: {
        intent: 'delete',
        phase: 'needs_confirmation',
      },
    })
    expect(first.payload?.agentAuditSummary?.keyPoints).toEqual(
      expect.arrayContaining([
        expect.stringContaining('播单策略：类型=tv, 命令=delete, 执行模式=confirm_before_commit, 动作=confirm'),
        expect.stringContaining('待处理任务：阶段=needs_confirmation'),
      ]),
    )
    expect(getAtomicCapabilities().getAllItems()).toHaveLength(0)

    const second = await bridge.submitInstruction({
      ...baseInput,
      conversationId: 'conv-agent-core-delete-confirm',
      text: '确认',
      currentSchedule,
    })

    expect(second.status).toBe('completed')
    expect(second.payload?.lastDecisionKind).toBe('agent_execution')
    expect(second.payload?.pendingAtomicContext).toBeNull()
    expect(second.payload?.agentAuditSummary).toMatchObject({
      outcome: 'executed',
      playlistPolicy: {
        playlistType: 'tv',
        commandIntent: 'delete',
        executionMode: 'confirm_before_commit',
        policyAction: 'execute',
      },
      operation: {
        committed: true,
        commandIntent: 'delete',
      },
    })
    expect(second.payload?.agentAuditSummary?.keyPoints).toEqual(
      expect.arrayContaining([
        expect.stringContaining('播单策略：类型=tv, 命令=delete, 执行模式=confirm_before_commit, 动作=execute'),
        expect.stringContaining('写入状态：已写入'),
      ]),
    )
    expect(getAtomicCapabilities().getAllItems()).toHaveLength(0)
  })

  it('空电视播单多轮删除到明确时间后会阻断为目标不存在，而不是继续追问', async () => {
    const bridge = new OpenClawBridge()
    const conversationId = 'conv-agent-core-delete-empty-target'

    const first = await bridge.submitInstruction({
      ...baseInput,
      conversationId,
      text: '删除节目',
      currentSchedule: [],
    })

    expect(first.status).toBe('needs_clarification')
    expect(first.payload?.pendingAtomicContext).toMatchObject({
      action: 'delete',
      agentIntent: 'delete',
      agentPendingTask: {
        intent: 'delete',
        phase: 'needs_clarification',
      },
    })

    const second = await bridge.submitInstruction({
      ...baseInput,
      conversationId,
      text: '删除9点的节目',
      currentSchedule: [],
    })

    expect(second.status).toBe('failed')
    expect(second.payload?.lastDecisionKind).toBe('message')
    expect(second.payload?.pendingAtomicContext).toBeNull()
    expect(second.summary).toContain('09:00:00')
    expect(second.summary).toContain('没有已编排节目')
    expect(second.summary).toContain('无法删除')
    expect(second.payload?.agentAuditSummary?.constraintIssueCodes).toContain('target_not_found')
    expect(second.payload?.agentLlmContextUsed).toMatchObject({
      latestUserInput: '删除9点的节目',
      pendingContext: expect.objectContaining({
        intent: 'delete',
      }),
    })
  })

  it('轮播单候选插入会先保存确认上下文，并在确认后通过 Agent Core 写回节目单', async () => {
    const bridge = new OpenClawBridge()
    const rotationInput = {
      ...baseInput,
      playlistType: 'rotation' as const,
      rotationStrategy: 'rating' as const,
      conversationId: 'conv-agent-core-rotation-insert',
      currentSchedule: [],
    }

    const first = await bridge.submitInstruction({
      ...rotationInput,
      text: '在10点插入看东方',
    })

    expect(first.status).toBe('needs_confirmation')
    expect(first.payload?.lastDecisionKind).toBe('pending_atomic_context')
    expect(first.payload?.pendingAtomicContext).toMatchObject({
      action: 'insert',
      agentIntent: 'insert',
      agentPendingTask: {
        intent: 'insert',
        phase: 'needs_confirmation',
      },
    })
    expect(first.payload?.agentAuditSummary).toMatchObject({
      outcome: 'pending',
      playlistPolicy: {
        playlistType: 'rotation',
        rotationStrategy: 'rating',
        commandIntent: 'insert',
        executionMode: 'confirm_before_commit',
        policyAction: 'confirm',
      },
      pendingTask: {
        intent: 'insert',
        phase: 'needs_confirmation',
      },
    })
    expect(first.payload?.agentAuditSummary?.keyPoints).toEqual(
      expect.arrayContaining([
        expect.stringContaining('播单策略：类型=rotation, 策略=rating, 命令=insert, 执行模式=confirm_before_commit, 动作=confirm'),
        expect.stringContaining('待处理任务：阶段=needs_confirmation'),
      ]),
    )
    expect(getAtomicCapabilities().getAllItems()).toHaveLength(0)

    const second = await bridge.submitInstruction({
      ...rotationInput,
      text: '确认',
    })

    expect(second.status).toBe('completed')
    expect(second.payload?.lastDecisionKind).toBe('agent_execution')
    expect(second.payload?.pendingAtomicContext).toBeNull()
    expect(second.payload?.agentAuditSummary).toMatchObject({
      outcome: 'executed',
      playlistPolicy: {
        playlistType: 'rotation',
        rotationStrategy: 'rating',
        commandIntent: 'insert',
        executionMode: 'confirm_before_commit',
        policyAction: 'execute',
      },
      operation: {
        committed: true,
        commandIntent: 'insert',
      },
    })
    expect(second.payload?.agentAuditSummary?.keyPoints).toEqual(
      expect.arrayContaining([
        expect.stringContaining('播单策略：类型=rotation, 策略=rating, 命令=insert, 执行模式=confirm_before_commit, 动作=execute'),
        expect.stringContaining('写入状态：已写入'),
      ]),
    )
    expect(getAtomicCapabilities().getAllItems()).toHaveLength(1)
    expect(getAtomicCapabilities().getAllItems()[0]?.programName).toContain('看东方')
  })

  it('rotation replace keeps candidate writes behind confirmation and preserves the target item id', async () => {
    const bridge = new OpenClawBridge()
    const currentSchedule = [buildScheduleItem()]
    const rotationInput = {
      ...baseInput,
      playlistType: 'rotation' as const,
      rotationStrategy: 'rating' as const,
      conversationId: 'conv-agent-core-rotation-replace',
      currentSchedule,
    }

    const first = await bridge.submitInstruction({
      ...rotationInput,
      text: '\u628a9\u70b9\u7684\u8282\u76ee\u6362\u6210\u4e1c\u65b9\u65b0\u95fb',
    })

    expect(first.status).toBe('needs_confirmation')
    expect(first.payload?.lastDecisionKind).toBe('pending_atomic_context')
    expect(first.payload?.pendingAtomicContext).toMatchObject({
      action: 'replace',
      agentIntent: 'replace',
      agentPendingTask: {
        intent: 'replace',
        phase: 'needs_confirmation',
      },
    })
    expect(first.payload?.agentAuditSummary).toMatchObject({
      outcome: 'pending',
      playlistPolicy: {
        playlistType: 'rotation',
        rotationStrategy: 'rating',
        commandIntent: 'replace',
        executionMode: 'confirm_before_commit',
        policyAction: 'confirm',
      },
      pendingTask: {
        intent: 'replace',
        phase: 'needs_confirmation',
      },
    })
    expect(getAtomicCapabilities().getAllItems()).toHaveLength(0)

    const second = await bridge.submitInstruction({
      ...rotationInput,
      text: '\u786e\u8ba4',
    })

    expect(second.status).toBe('completed')
    expect(second.payload?.lastDecisionKind).toBe('agent_execution')
    expect(second.payload?.pendingAtomicContext).toBeNull()
    expect(second.payload?.agentAuditSummary).toMatchObject({
      outcome: 'executed',
      playlistPolicy: {
        playlistType: 'rotation',
        rotationStrategy: 'rating',
        commandIntent: 'replace',
        executionMode: 'confirm_before_commit',
        policyAction: 'execute',
      },
      operation: {
        committed: true,
        commandIntent: 'replace',
      },
    })
    expect(getAtomicCapabilities().getAllItems()).toHaveLength(1)
    expect(getAtomicCapabilities().getAllItems()[0]).toMatchObject({
      id: 'item-0900',
      programName: expect.stringContaining('\u4e1c\u65b9\u65b0\u95fb'),
    })
  })

  it('blocks TV move when the destination is occupied', async () => {
    const bridge = new OpenClawBridge()
    const result = await bridge.submitInstruction({
      ...baseInput,
      conversationId: 'conv-agent-core-tv-move-occupied',
      text: '\u628a9\u70b9\u7684\u8282\u76ee\u540e\u79fb30\u5206\u949f',
      currentSchedule: [buildScheduleItem(), buildSecondScheduleItem()],
    })

    expect(result.status).toBe('failed')
    expect(result.payload?.lastDecisionKind).toBe('message')
    expect(result.payload?.pendingAtomicContext).toBeNull()
    expect(result.payload?.agentAuditSummary).toMatchObject({
      outcome: 'blocked',
      playlistPolicy: {
        playlistType: 'tv',
        commandIntent: 'move',
        executionMode: 'direct_execute',
        policyAction: 'execute',
      },
      operation: {
        committed: false,
        commandIntent: 'move',
      },
      constraintIssueCodes: ['time_overlap'],
    })
    expect(getAtomicCapabilities().getAllItems()).toHaveLength(0)
  })

  it('keeps TV delete behind explicit confirmation', async () => {
    const bridge = new OpenClawBridge()
    const first = await bridge.submitInstruction({
      ...baseInput,
      conversationId: 'conv-agent-core-tv-delete-confirm-real',
      text: '\u5220\u96649\u70b9\u7684\u8282\u76ee',
      currentSchedule: [buildScheduleItem(), buildSecondScheduleItem()],
    })

    expect(first.status).toBe('needs_confirmation')
    expect(first.payload?.lastDecisionKind).toBe('pending_atomic_context')
    expect(getAtomicCapabilities().getAllItems()).toHaveLength(0)

    const second = await bridge.submitInstruction({
      ...baseInput,
      conversationId: 'conv-agent-core-tv-delete-confirm-real',
      text: '\u786e\u8ba4',
      currentSchedule: [buildScheduleItem(), buildSecondScheduleItem()],
    })

    expect(second.status).toBe('completed')
    expect(second.payload?.lastDecisionKind).toBe('agent_execution')
    expect(second.payload?.pendingAtomicContext).toBeNull()
    expect(getAtomicCapabilities().getAllItems()).toHaveLength(1)
    expect(getAtomicCapabilities().getAllItems()[0]).toMatchObject({
      id: 'item-0930',
      programName: '\u4e1c\u65b9\u65b0\u95fb',
    })
  })

  it('blocks TV replace when the replacement is already scheduled today', async () => {
    const bridge = new OpenClawBridge()
    const result = await bridge.submitInstruction({
      ...baseInput,
      conversationId: 'conv-agent-core-tv-replace-duplicate',
      text: '\u628a9\u70b9\u7684\u8282\u76ee\u6362\u6210\u4e1c\u65b9\u65b0\u95fb',
      currentSchedule: [buildScheduleItem(), buildSecondScheduleItem()],
    })

    expect(result.status).toBe('failed')
    expect(result.payload?.lastDecisionKind).toBe('message')
    expect(result.payload?.agentAuditSummary).toMatchObject({
      outcome: 'blocked',
      playlistPolicy: {
        playlistType: 'tv',
        commandIntent: 'replace',
        executionMode: 'direct_execute',
        policyAction: 'execute',
      },
      operation: {
        committed: false,
        commandIntent: 'replace',
      },
      constraintIssueCodes: ['same_day_duplicate_violation'],
    })
    expect(getAtomicCapabilities().getAllItems()).toHaveLength(0)
  })

  it('executes TV replace when the replacement is not already scheduled today', async () => {
    const bridge = new OpenClawBridge()
    const result = await bridge.submitInstruction({
      ...baseInput,
      conversationId: 'conv-agent-core-tv-replace-ok',
      text: '\u628a9\u70b9\u7684\u8282\u76ee\u6362\u6210\u5348\u95f430\u5206',
      currentSchedule: [buildScheduleItem(), buildSecondScheduleItem()],
    })

    expect(result.status).toBe('completed')
    expect(result.payload?.lastDecisionKind).toBe('agent_execution')
    expect(result.payload?.agentAuditSummary).toMatchObject({
      outcome: 'executed',
      playlistPolicy: {
        playlistType: 'tv',
        commandIntent: 'replace',
        executionMode: 'direct_execute',
        policyAction: 'execute',
      },
      operation: {
        committed: true,
        commandIntent: 'replace',
      },
    })
    expect(getAtomicCapabilities().getAllItems()).toHaveLength(2)
    expect(getAtomicCapabilities().getAllItems()[0]).toMatchObject({
      id: 'item-0900',
      programName: '\u5348\u95f430\u5206',
    })
  })

  it('executes explicit TV cross-column replace because layout slot duty is only ranking evidence', async () => {
    const bridge = new OpenClawBridge()
    const result = await bridge.submitInstruction({
      ...baseInput,
      conversationId: 'conv-agent-core-tv-replace-cross-column-ok',
      text: '\u628a9\u70b9\u7684\u8282\u76ee\u6362\u6210\u4e1c\u65b9\u65b0\u95fb',
      currentSchedule: [buildScheduleItem({
        programName: '\u770b\u4e1c\u65b9 \u65e9\u9ad8\u5cf0\u7248',
        endTime: '10:00:00',
        duration: 3600,
        programType: 'news_magazine',
      })],
    })

    expect(result.status).toBe('completed')
    expect(result.payload?.lastDecisionKind).toBe('agent_execution')
    expect(result.payload?.agentAuditSummary).toMatchObject({
      outcome: 'executed',
      playlistPolicy: {
        playlistType: 'tv',
        commandIntent: 'replace',
        executionMode: 'direct_execute',
        policyAction: 'execute',
      },
      operation: {
        committed: true,
        commandIntent: 'replace',
      },
    })
    expect(result.payload?.agentAuditSummary?.constraintIssueCodes ?? []).not.toContain('replacement_duty_mismatch')
    expect(getAtomicCapabilities().getAllItems()).toHaveLength(1)
    expect(getAtomicCapabilities().getAllItems()[0]).toMatchObject({
      id: 'item-0900',
      programName: '\u4e1c\u65b9\u65b0\u95fb',
    })
  })

  it('batch move executes directly through OpenClawBridge while keeping the Agent audit policy visible', async () => {
    const bridge = new OpenClawBridge()
    const result = await bridge.submitInstruction({
      ...baseInput,
      conversationId: 'conv-agent-core-batch-move',
      text: '\u628a9\u70b9\u523010\u70b9\u7684\u8282\u76ee\u6574\u4f53\u540e\u79fb1\u5c0f\u65f6',
      currentSchedule: [buildScheduleItem(), buildSecondScheduleItem()],
    })

    expect(result.status).toBe('completed')
    expect(result.payload?.lastDecisionKind).toBe('agent_execution')
    expect(result.payload?.pendingAtomicContext).toBeNull()
    expect(result.payload?.agentAuditSummary).toMatchObject({
      outcome: 'executed',
      playlistPolicy: {
        playlistType: 'tv',
        commandIntent: 'batch_move',
        executionMode: 'direct_execute',
        policyAction: 'execute',
      },
      operation: {
        committed: true,
        commandIntent: 'batch_move',
      },
    })
    expect(getAtomicCapabilities().getAllItems()).toHaveLength(2)
    expect(getAtomicCapabilities().getAllItems().map((item) => item.startTime)).toEqual([
      '2026-03-25T10:00:00+08:00',
      '2026-03-25T10:30:00+08:00',
    ])
  })

  it('batch delete saves confirmation context first and commits only after the next confirmation turn', async () => {
    const bridge = new OpenClawBridge()
    const currentSchedule = [buildScheduleItem(), buildSecondScheduleItem()]
    const deleteInput = {
      ...baseInput,
      conversationId: 'conv-agent-core-batch-delete',
      currentSchedule,
    }

    const first = await bridge.submitInstruction({
      ...deleteInput,
      text: '\u5220\u96649\u70b9\u523010\u70b9\u7684\u8282\u76ee',
    })

    expect(first.status).toBe('needs_confirmation')
    expect(first.payload?.lastDecisionKind).toBe('pending_atomic_context')
    expect(first.payload?.pendingAtomicContext).toMatchObject({
      action: 'delete',
      agentIntent: 'batch_delete',
      agentPendingTask: {
        intent: 'batch_delete',
        phase: 'needs_confirmation',
      },
    })
    expect(first.payload?.agentAuditSummary).toMatchObject({
      outcome: 'pending',
      playlistPolicy: {
        playlistType: 'tv',
        commandIntent: 'batch_delete',
        executionMode: 'confirm_before_commit',
        policyAction: 'confirm',
      },
      pendingTask: {
        intent: 'batch_delete',
        phase: 'needs_confirmation',
      },
    })
    expect(getAtomicCapabilities().getAllItems()).toHaveLength(0)

    const second = await bridge.submitInstruction({
      ...deleteInput,
      text: '\u786e\u8ba4',
    })

    expect(second.status).toBe('completed')
    expect(second.payload?.lastDecisionKind).toBe('agent_execution')
    expect(second.payload?.pendingAtomicContext).toBeNull()
    expect(second.payload?.agentAuditSummary).toMatchObject({
      outcome: 'executed',
      playlistPolicy: {
        playlistType: 'tv',
        commandIntent: 'batch_delete',
        executionMode: 'confirm_before_commit',
        policyAction: 'execute',
      },
      operation: {
        committed: true,
        commandIntent: 'batch_delete',
      },
    })
    expect(getAtomicCapabilities().getAllItems()).toHaveLength(0)
  })

  it('query stays read-only through OpenClawBridge while exposing Agent audit policy', async () => {
    const bridge = new OpenClawBridge()
    const result = await bridge.submitInstruction({
      ...baseInput,
      conversationId: 'conv-agent-core-query',
      text: '\u67e5\u770b\u5f53\u524d\u8282\u76ee\u5355',
      currentSchedule: [buildScheduleItem(), buildSecondScheduleItem()],
    })

    expect(result.status).toBe('completed')
    expect(result.payload?.lastDecisionKind).toBe('message')
    expect(result.payload?.pendingAtomicContext).toBeNull()
    expect(result.payload?.agentAuditSummary).toMatchObject({
      outcome: 'read_only',
      playlistPolicy: {
        playlistType: 'tv',
        commandIntent: 'query',
        executionMode: 'read_only',
        policyAction: 'read',
      },
      operation: {
        committed: false,
        commandIntent: 'query',
      },
    })
    expect(result.payload?.agentQueryResult).toMatchObject({
      kind: 'schedule_summary',
      playlistType: 'tv',
      totalCount: 2,
      scheduleItems: [
        expect.objectContaining({ id: 'item-0900' }),
        expect.objectContaining({ id: 'item-0930' }),
      ],
    })
    expect(result.payload?.agentValidationReport).toBeUndefined()
    expect(getAtomicCapabilities().getAllItems()).toHaveLength(0)
  })

  it('validate stays read-only through OpenClawBridge and returns constraint evidence in the audit', async () => {
    const bridge = new OpenClawBridge()
    const result = await bridge.submitInstruction({
      ...baseInput,
      conversationId: 'conv-agent-core-validate',
      text: '\u6821\u9a8c\u5f53\u524d\u8282\u76ee\u5355',
      currentSchedule: [
        buildScheduleItem({
          endTime: '09:45:00',
          duration: 2700,
        }),
        buildSecondScheduleItem(),
      ],
    })

    expect(result.status).toBe('completed')
    expect(result.payload?.lastDecisionKind).toBe('message')
    expect(result.payload?.pendingAtomicContext).toBeNull()
    expect(result.payload?.agentAuditSummary).toMatchObject({
      outcome: 'read_only',
      playlistPolicy: {
        playlistType: 'tv',
        commandIntent: 'validate',
        executionMode: 'read_only',
        policyAction: 'read',
      },
      operation: {
        committed: false,
        commandIntent: 'validate',
      },
      constraintIssueCodes: expect.arrayContaining(['time_overlap']),
    })
    expect(result.payload?.agentValidationReport).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([
        expect.objectContaining({
          code: 'time_overlap',
        }),
      ]),
    })
    expect(result.payload?.agentQueryResult).toBeUndefined()
    expect(getAtomicCapabilities().getAllItems()).toHaveLength(0)
  })

  it('exposes TV sequence evidence from history when blocking an unsafe episode skip', async () => {
    const bridge = new OpenClawBridge()
    const result = await bridge.submitInstruction({
      ...baseInput,
      conversationId: 'conv-agent-core-tv-sequence-history',
      text: '\u572810\u70b9\u63d2\u5165\u7eb5\u6709\u75be\u98ce\u8d77\u7b2c3\u96c6',
      currentSchedule: [],
    })

    expect(result.status).toBe('failed')
    expect(result.payload?.lastDecisionKind).toBe('message')
    expect(result.payload?.pendingAtomicContext).toBeNull()
    expect(result.payload?.agentAuditSummary).toMatchObject({
      outcome: 'blocked',
      blockerReason: expect.stringContaining('顺播顺序'),
      candidate: {
        method: 'tv_sequence',
        source: 'history',
        expectedSequence: 5,
        selectedSequence: 3,
        seriesKey: 'name:\u7eb5\u6709\u75be\u98ce\u8d77',
      },
      playlistPolicy: {
        playlistType: 'tv',
        commandIntent: 'insert',
        executionMode: 'direct_execute',
        policyAction: 'execute',
      },
      operation: {
        committed: false,
        commandIntent: 'insert',
      },
      constraintIssueCodes: ['sequence_violation'],
    })
    expect(result.payload?.agentOperationalReadiness?.sourceCoverage).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceKey: 'history',
          status: 'available',
          recordCount: expect.any(Number),
        }),
      ]),
    )
    expect(result.payload?.agentAuditSummary?.evidenceChain).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceKey: 'history',
          available: true,
          recordCount: expect.any(Number),
          signalCodes: expect.arrayContaining(['issue:sequence_violation']),
        }),
        expect.objectContaining({
          sourceKey: 'today',
          available: true,
          signalCodes: expect.arrayContaining(['issue:sequence_violation']),
        }),
      ]),
    )
    expect(result.payload?.agentAuditSummary?.blockers).toEqual(
      expect.arrayContaining([
        expect.stringContaining('顺播顺序'),
        expect.stringContaining('第 5 集'),
      ]),
    )
    expect(getAtomicCapabilities().getAllItems()).toHaveLength(0)
  })

  it('exposes the structured pending context that the next LLM turn will combine with the user reply', async () => {
    const bridge = new OpenClawBridge()
    const rotationInput = {
      ...baseInput,
      playlistType: 'rotation' as const,
      rotationStrategy: 'content_match' as const,
      conversationId: 'conv-agent-core-pending-llm-context',
      currentSchedule: [],
    }
    const first = await bridge.submitInstruction({
      ...rotationInput,
      text: '\u63d2\u5165\u770b\u4e1c\u65b9',
    })

    expect(first.status).toBe('needs_clarification')
    expect(first.payload?.pendingAtomicContext).toMatchObject({
      action: 'insert',
      agentIntent: 'insert',
      agentPendingTask: {
        intent: 'insert',
        phase: 'needs_clarification',
      },
    })
    expect(first.payload?.agentPendingLlmContext).toMatchObject({
      latestUserInput: '',
      allowedActions: expect.arrayContaining(['continue_pending', 'start_new_task', 'cancel_pending']),
      pendingContext: {
        intent: 'insert',
        phase: 'needs_clarification',
        originalInput: '\u63d2\u5165\u770b\u4e1c\u65b9',
        collectedInput: '\u63d2\u5165\u770b\u4e1c\u65b9',
        collectedSlots: {
          programHint: '\u770b\u4e1c\u65b9',
        },
        missingSlots: ['targetTime'],
      },
    })
    expect(first.payload?.agentLlmContextUsed).toBeUndefined()

    const second = await bridge.submitInstruction({
      ...rotationInput,
      text: '10\u70b9',
    })

    expect(second.status).toBe('needs_confirmation')
    expect(second.payload?.lastDecisionKind).toBe('pending_atomic_context')
    expect(second.payload?.agentLlmContextUsed).toMatchObject({
      latestUserInput: '10\u70b9',
      pendingContext: {
        intent: 'insert',
        phase: 'needs_clarification',
        originalInput: '\u63d2\u5165\u770b\u4e1c\u65b9',
        collectedInput: '\u63d2\u5165\u770b\u4e1c\u65b9',
        collectedSlots: {
          programHint: '\u770b\u4e1c\u65b9',
        },
        missingSlots: ['targetTime'],
      },
    })
    expect(second.payload?.agentPendingLlmContext).toMatchObject({
      latestUserInput: '',
      pendingContext: {
        intent: 'insert',
        phase: 'needs_confirmation',
        collectedInput: '\u63d2\u5165\u770b\u4e1c\u65b9\n10\u70b9',
        missingSlots: ['confirmation'],
      },
      allowedActions: expect.arrayContaining(['confirm', 'reject', 'start_new_task', 'cancel_pending']),
    })
    expect(getAtomicCapabilities().getAllItems()).toHaveLength(0)
  })
})
