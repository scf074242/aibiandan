import { describe, expect, it } from 'vitest'

import { attachSchedulingContextBundle } from '@/services/agent/contextBundle'
import { AgentPlaylistPolicy, atomicCommandPolicyIntents } from '@/services/agent/playlistPolicy'
import type { SchedulingContext } from '@/services/agent/types'

const buildContext = (patch: Partial<Omit<SchedulingContext, 'bundle'>> = {}): SchedulingContext => attachSchedulingContextBundle({
  channelId: 'dragon',
  date: '2026-03-25',
  playlistType: 'tv',
  scheduleItems: [],
  programCandidates: [],
  broadcastReadiness: [],
  lockedItemIds: [],
  blockedTimeRanges: [],
  historySchedules: [],
  ...patch,
})

describe('AgentPlaylistPolicy', () => {
  it('declares the complete Scheduling Agent Core v1 atomic command policy matrix', () => {
    const policy = new AgentPlaylistPolicy()

    expect(atomicCommandPolicyIntents).toEqual([
      'move',
      'batch_move',
      'insert',
      'replace',
      'delete',
      'batch_delete',
      'query',
      'validate',
    ])
    expect(policy.listCommandPolicies()).toEqual([
      expect.objectContaining({
        intent: 'move',
        tvMode: 'direct_execute',
        rotationMode: 'direct_execute',
        usesCandidates: false,
      }),
      expect.objectContaining({
        intent: 'batch_move',
        tvMode: 'direct_execute',
        rotationMode: 'direct_execute',
        usesCandidates: false,
      }),
      expect.objectContaining({
        intent: 'insert',
        tvMode: 'direct_execute',
        rotationMode: 'confirm_before_commit',
        usesCandidates: true,
      }),
      expect.objectContaining({
        intent: 'replace',
        tvMode: 'direct_execute',
        rotationMode: 'confirm_before_commit',
        usesCandidates: true,
      }),
      expect.objectContaining({
        intent: 'delete',
        safety: 'sensitive',
        tvMode: 'confirm_before_commit',
        rotationMode: 'confirm_before_commit',
      }),
      expect.objectContaining({
        intent: 'batch_delete',
        safety: 'sensitive',
        tvMode: 'confirm_before_commit',
        rotationMode: 'confirm_before_commit',
      }),
      expect.objectContaining({
        intent: 'query',
        safety: 'read_only',
        tvMode: 'read_only',
        rotationMode: 'read_only',
      }),
      expect.objectContaining({
        intent: 'validate',
        safety: 'read_only',
        tvMode: 'read_only',
        rotationMode: 'read_only',
      }),
    ])
  })

  it('declares direct execution for deterministic move commands', () => {
    const policy = new AgentPlaylistPolicy()

    const decision = policy.decideCommand({
      intent: 'move',
      context: buildContext({ playlistType: 'rotation' }),
    })

    expect(decision).toMatchObject({
      action: 'execute',
      requiresConfirmation: false,
      policy: {
        intent: 'move',
        usesCandidates: false,
        safety: 'normal',
      },
    })
  })

  it('resolves execution modes from the declared command policy matrix', () => {
    const policy = new AgentPlaylistPolicy()
    const tvContext = buildContext({ playlistType: 'tv' })
    const rotationContext = buildContext({
      playlistType: 'rotation',
      rotationStrategy: 'rating',
    })

    for (const commandPolicy of policy.listCommandPolicies()) {
      expect(policy.getExecutionMode(commandPolicy.intent, tvContext)).toBe(commandPolicy.tvMode)
      expect(policy.getExecutionMode(commandPolicy.intent, rotationContext)).toBe(commandPolicy.rotationMode)
      expect(policy.decideCommand({
        intent: commandPolicy.intent,
        context: tvContext,
      }).policy).toMatchObject(commandPolicy)
      expect(policy.decideCommand({
        intent: commandPolicy.intent,
        context: rotationContext,
      }).policy).toMatchObject(commandPolicy)
    }
  })

  it('executes TV candidate writes after deterministic constraints pass', () => {
    const policy = new AgentPlaylistPolicy()

    const decision = policy.decideCandidateWrite({
      intent: 'insert',
      context: buildContext({ playlistType: 'tv' }),
    })

    expect(decision).toMatchObject({
      action: 'execute',
      requiresConfirmation: false,
    })
    expect(decision.reason).toContain('TV playlist')
  })

  it('requires confirmation before rotation candidate writes', () => {
    const policy = new AgentPlaylistPolicy()

    const decision = policy.decideCandidateWrite({
      intent: 'replace',
      context: buildContext({
        playlistType: 'rotation',
        rotationStrategy: 'rating',
      }),
    })

    expect(decision).toMatchObject({
      action: 'confirm',
      requiresConfirmation: true,
    })
    expect(decision.reason).toContain('rating priority')
  })

  it('executes rotation candidate writes only after the confirmation gate is satisfied', () => {
    const policy = new AgentPlaylistPolicy()

    const decision = policy.decideCandidateWrite({
      intent: 'insert',
      context: buildContext({
        playlistType: 'rotation',
        rotationStrategy: 'content_match',
      }),
      forceExecute: true,
    })

    expect(decision).toMatchObject({
      action: 'execute',
      requiresConfirmation: false,
    })
    expect(decision.reason).toContain('confirmed')
  })

  it('declares delete commands as sensitive confirmation-gated writes', () => {
    const policy = new AgentPlaylistPolicy()

    const decision = policy.decideCommand({
      intent: 'delete',
      context: buildContext({ playlistType: 'tv' }),
    })

    expect(decision).toMatchObject({
      action: 'confirm',
      requiresConfirmation: true,
      policy: {
        intent: 'delete',
        safety: 'sensitive',
        usesCandidates: false,
      },
    })
    expect(decision.reason).toContain('敏感操作')
  })

  it('allows sensitive writes only after their confirmation gate is satisfied', () => {
    const policy = new AgentPlaylistPolicy()

    const decision = policy.decideCommand({
      intent: 'batch_delete',
      context: buildContext({ playlistType: 'rotation' }),
      forceExecute: true,
    })

    expect(decision).toMatchObject({
      action: 'execute',
      requiresConfirmation: false,
      policy: {
        intent: 'batch_delete',
        safety: 'sensitive',
      },
    })
    expect(decision.reason).toContain('confirmation gate')
  })

  it('declares query and validate as read-only commands', () => {
    const policy = new AgentPlaylistPolicy()

    const queryDecision = policy.decideCommand({
      intent: 'query',
      context: buildContext({ playlistType: 'rotation' }),
    })
    const validateDecision = policy.decideCommand({
      intent: 'validate',
      context: buildContext({ playlistType: 'tv' }),
    })

    expect(queryDecision).toMatchObject({
      action: 'read',
      requiresConfirmation: false,
      policy: {
        safety: 'read_only',
      },
    })
    expect(validateDecision).toMatchObject({
      action: 'read',
      requiresConfirmation: false,
      policy: {
        safety: 'read_only',
      },
    })
  })
})
