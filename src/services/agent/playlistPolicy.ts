import type { AtomicCommandIntent, SchedulingContext } from './types'

export type AgentCandidateWriteIntent = Extract<AtomicCommandIntent, 'insert' | 'replace'>
export type AgentCommandPolicyAction = 'execute' | 'confirm' | 'read'
export type AgentCommandExecutionMode = 'direct_execute' | 'confirm_before_commit' | 'read_only'
export type AgentCommandSafety = 'normal' | 'sensitive' | 'read_only'

export interface AgentCommandPolicy {
  intent: AtomicCommandIntent
  safety: AgentCommandSafety
  usesCandidates: boolean
  tvMode: AgentCommandExecutionMode
  rotationMode: AgentCommandExecutionMode
}

export interface AgentCommandPolicyInput {
  intent: AtomicCommandIntent
  context: SchedulingContext
  forceExecute?: boolean
}

export interface AgentCommandPolicyDecision {
  action: AgentCommandPolicyAction
  policy: AgentCommandPolicy
  reason: string
  requiresConfirmation: boolean
}

export interface AgentCandidateWritePolicyInput {
  intent: AgentCandidateWriteIntent
  context: SchedulingContext
  forceExecute?: boolean
}

export interface AgentCandidateWritePolicyDecision {
  action: Exclude<AgentCommandPolicyAction, 'read'>
  reason: string
  requiresConfirmation: boolean
}

export const atomicCommandPolicyIntents: readonly AtomicCommandIntent[] = [
  'move',
  'batch_move',
  'insert',
  'replace',
  'delete',
  'batch_delete',
  'query',
  'validate',
]

const commandPolicies: Record<AtomicCommandIntent, AgentCommandPolicy> = {
  move: {
    intent: 'move',
    safety: 'normal',
    usesCandidates: false,
    tvMode: 'direct_execute',
    rotationMode: 'direct_execute',
  },
  batch_move: {
    intent: 'batch_move',
    safety: 'normal',
    usesCandidates: false,
    tvMode: 'direct_execute',
    rotationMode: 'direct_execute',
  },
  insert: {
    intent: 'insert',
    safety: 'normal',
    usesCandidates: true,
    tvMode: 'direct_execute',
    rotationMode: 'confirm_before_commit',
  },
  replace: {
    intent: 'replace',
    safety: 'normal',
    usesCandidates: true,
    tvMode: 'direct_execute',
    rotationMode: 'confirm_before_commit',
  },
  delete: {
    intent: 'delete',
    safety: 'sensitive',
    usesCandidates: false,
    tvMode: 'confirm_before_commit',
    rotationMode: 'confirm_before_commit',
  },
  batch_delete: {
    intent: 'batch_delete',
    safety: 'sensitive',
    usesCandidates: false,
    tvMode: 'confirm_before_commit',
    rotationMode: 'confirm_before_commit',
  },
  query: {
    intent: 'query',
    safety: 'read_only',
    usesCandidates: false,
    tvMode: 'read_only',
    rotationMode: 'read_only',
  },
  validate: {
    intent: 'validate',
    safety: 'read_only',
    usesCandidates: false,
    tvMode: 'read_only',
    rotationMode: 'read_only',
  },
}

export class AgentPlaylistPolicy {
  listCommandPolicies(): AgentCommandPolicy[] {
    return atomicCommandPolicyIntents.map((intent) => ({ ...commandPolicies[intent] }))
  }

  getCommandPolicy(intent: AtomicCommandIntent): AgentCommandPolicy {
    return { ...commandPolicies[intent] }
  }

  getExecutionMode(intent: AtomicCommandIntent, context: SchedulingContext): AgentCommandExecutionMode {
    const policy = this.getCommandPolicy(intent)
    return context.bundle.identity.playlistType === 'rotation' ? policy.rotationMode : policy.tvMode
  }

  decideCommand(input: AgentCommandPolicyInput): AgentCommandPolicyDecision {
    const policy = this.getCommandPolicy(input.intent)
    const mode = this.getExecutionMode(input.intent, input.context)

    if (mode === 'read_only') {
      return {
        action: 'read',
        policy,
        requiresConfirmation: false,
        reason: `${input.intent} is read-only and never commits playlist changes.`,
      }
    }

    if (mode === 'confirm_before_commit' && !input.forceExecute) {
      return {
        action: 'confirm',
        policy,
        requiresConfirmation: true,
        reason: this.describeConfirmationReason(policy, input),
      }
    }

    return {
      action: 'execute',
      policy,
      requiresConfirmation: false,
      reason: this.describeExecutionReason(policy, input),
    }
  }

  decideCandidateWrite(input: AgentCandidateWritePolicyInput): AgentCandidateWritePolicyDecision {
    const decision = this.decideCommand(input)

    return {
      action: decision.action === 'confirm' ? 'confirm' : 'execute',
      requiresConfirmation: decision.requiresConfirmation,
      reason: decision.reason,
    }
  }

  private describeConfirmationReason(policy: AgentCommandPolicy, input: AgentCommandPolicyInput): string {
    if (policy.safety === 'sensitive') {
      return `${input.intent} 属于敏感操作，提交前需要明确确认。`
    }
    if (input.context.bundle.identity.playlistType === 'rotation' && policy.usesCandidates) {
      const strategyText = this.describeRotationStrategy(input.context)
      return `轮播单 ${input.intent} 使用${strategyText}策略，候选写入前需要用户确认。`
    }
    return `${input.intent} 提交前需要确认。`
  }

  private describeExecutionReason(policy: AgentCommandPolicy, input: AgentCommandPolicyInput): string {
    if (input.context.bundle.identity.playlistType === 'rotation' && policy.usesCandidates) {
      return 'Rotation playlist candidate has been confirmed and can be committed.'
    }
    if (input.context.bundle.identity.playlistType === 'tv' && policy.usesCandidates) {
      return 'TV playlist follows strict channel rules and can commit after deterministic constraints pass.'
    }
    if (policy.safety === 'sensitive') {
      return `${input.intent} confirmation gate has been satisfied and can be committed.`
    }
    return `${input.intent} can commit after deterministic constraints pass.`
  }

  private describeRotationStrategy(context: SchedulingContext): string {
    const strategy = context.bundle.identity.rotationStrategy ?? 'content_match'
    return strategy === 'rating'
      ? 'rating priority'
      : strategy === 'trending'
        ? 'trending priority'
        : 'content match'
  }
}
