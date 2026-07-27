import type { MutationPolicy } from '@/services/agent/mutationPolicy'
import type { AgentPlannerAction } from '@/services/llm/agentPlanner'
import type { FormalOrchestrationActorContext } from './formalOrchestrationRuntime'
import type { ReactTaskObservationDraft } from './reactTaskRuntime'
import {
  assertFormalOrchestrationGrantScope,
  type FormalOrchestrationGrant,
} from './formalOrchestrationGrant'

type ResearchAction = Extract<AgentPlannerAction, { type: 'research_check' }>
type ValidateAction = Extract<AgentPlannerAction, { type: 'validate' }>
type AnalysisAction = Extract<AgentPlannerAction, { type: 'read_only_analysis' }>
type AtomicAction = Extract<AgentPlannerAction, { type: 'atomic_command' }>
type ClarifyAction = Extract<AgentPlannerAction, { type: 'clarify' }>

export interface FormalActionPortResult {
  workspaceKey: string
  summary: string
  noMutation: boolean
  mutationPolicy?: MutationPolicy
  data?: Record<string, unknown>
  risk?: string
}

export interface FormalOrchestrationActionPorts {
  researchCheck?: (action: ResearchAction, context: FormalOrchestrationActionPortContext) => Promise<FormalActionPortResult>
  validate?: (action: ValidateAction, context: FormalOrchestrationActionPortContext) => Promise<FormalActionPortResult>
  readOnlyAnalysis?: (action: AnalysisAction, context: FormalOrchestrationActionPortContext) => Promise<FormalActionPortResult>
  atomicCommand?: (action: AtomicAction & { mutationPolicy: MutationPolicy }, context: FormalOrchestrationActionPortContext) => Promise<FormalActionPortResult>
  clarify?: (action: ClarifyAction, context: FormalOrchestrationActionPortContext) => Promise<FormalActionPortResult>
}

export interface FormalOrchestrationActionPortContext {
  workspaceKey: string
  runId: string
  turn: number
  actionKey: string
  signal?: AbortSignal
}

export interface FormalOrchestrationActionAdapterOptions {
  workspaceKey: string
  authorization?: FormalOrchestrationGrant
  ports: FormalOrchestrationActionPorts
}

const CONTROL_PLANE_ACTIONS = new Set<AgentPlannerAction['type']>([
  'create_playlist',
  'prepare_layout_draft',
  'refine_layout_draft',
  'commit_layout_draft',
  'formal_orchestration',
])

export class FormalOrchestrationActionAdapter {
  private readonly workspaceKey: string
  private readonly authorization?: FormalOrchestrationGrant
  private readonly ports: FormalOrchestrationActionPorts

  constructor(options: FormalOrchestrationActionAdapterOptions) {
    if (!options.workspaceKey.trim()) throw new Error('Formal orchestration action adapter requires workspaceKey.')
    this.workspaceKey = options.workspaceKey
    this.authorization = options.authorization
    this.ports = options.ports
  }

  async execute(
    action: AgentPlannerAction,
    context: FormalOrchestrationActorContext<AgentPlannerAction>,
  ): Promise<ReactTaskObservationDraft> {
    if (context.signal?.aborted) throw new Error('Formal orchestration action aborted before execution.')
    if (CONTROL_PLANE_ACTIONS.has(action.type)) {
      throw new Error(`Action ${action.type} is control-plane only and cannot enter the ReAct batch actor.`)
    }

    const portContext: FormalOrchestrationActionPortContext = {
      workspaceKey: this.workspaceKey,
      runId: context.run.id,
      turn: context.turn,
      actionKey: context.actionKey,
      signal: context.signal,
    }

    let result: FormalActionPortResult
    let observationType: ReactTaskObservationDraft['type']
    let expectedPolicy: MutationPolicy | undefined

    if (action.type === 'research_check') {
      result = await this.requirePort('researchCheck')(action, portContext)
      observationType = 'asset_search'
      this.assertReadOnly(result, action.type)
    } else if (action.type === 'validate') {
      result = await this.requirePort('validate')(action, portContext)
      observationType = 'validation'
      this.assertReadOnly(result, action.type)
    } else if (action.type === 'read_only_analysis') {
      result = await this.requirePort('readOnlyAnalysis')(action, portContext)
      observationType = 'validation'
      this.assertReadOnly(result, action.type)
    } else if (action.type === 'clarify') {
      result = await this.requirePort('clarify')(action, portContext)
      observationType = 'user_feedback'
      this.assertReadOnly(result, action.type)
    } else if (action.type === 'atomic_command') {
      if (!action.mutationPolicy) throw new Error('Atomic ReAct action requires an explicit mutationPolicy.')
      if (action.mutationPolicy === 'formal_write' && this.authorization) {
        assertFormalOrchestrationGrantScope(this.authorization, {
          workspaceKey: this.workspaceKey,
          intent: action.intent,
        })
      }
      expectedPolicy = action.mutationPolicy
      result = await this.requirePort('atomicCommand')({ ...action, mutationPolicy: action.mutationPolicy }, portContext)
      observationType = 'atomic_execution'
      if (result.mutationPolicy !== expectedPolicy) {
        throw new Error(`Atomic action mutationPolicy mismatch: expected ${expectedPolicy}, received ${result.mutationPolicy ?? 'missing'}.`)
      }
      if (expectedPolicy === 'preview_only' && !result.noMutation) {
        throw new Error('preview_only atomic action reported a mutation.')
      }
    } else {
      throw new Error(`Unsupported ReAct action type: ${(action as AgentPlannerAction).type}.`)
    }

    if (result.workspaceKey !== this.workspaceKey) {
      throw new Error(`Formal orchestration workspace mismatch: expected ${this.workspaceKey}, received ${result.workspaceKey || 'missing'}.`)
    }
    if (context.signal?.aborted) throw new Error('Formal orchestration action aborted after port execution.')

    return {
      type: observationType,
      summary: result.summary,
      risk: result.risk,
      data: {
        ...result.data,
        workspaceKey: result.workspaceKey,
        actionType: action.type,
        noMutation: result.noMutation,
        mutationPolicy: result.mutationPolicy,
      },
    }
  }

  private requirePort<Key extends keyof FormalOrchestrationActionPorts>(key: Key): NonNullable<FormalOrchestrationActionPorts[Key]> {
    const port = this.ports[key]
    if (!port) throw new Error(`Formal orchestration action port is not configured: ${key}.`)
    return port as NonNullable<FormalOrchestrationActionPorts[Key]>
  }

  private assertReadOnly(result: FormalActionPortResult, actionType: AgentPlannerAction['type']): void {
    if (!result.noMutation) throw new Error(`Read-only action ${actionType} reported a mutation.`)
    if (result.mutationPolicy && result.mutationPolicy !== 'preview_only') {
      throw new Error(`Read-only action ${actionType} returned unsafe mutationPolicy ${result.mutationPolicy}.`)
    }
  }
}
