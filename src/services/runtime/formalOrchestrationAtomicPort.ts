import { AtomicCommandCapability } from '@/services/agent/atomicCommandCapability'
import { CapabilityRegistry, CapabilityRouteConflictError } from '@/services/agent/capabilityRegistry'
import type { AgentDeadline } from '@/services/agent/agentDeadline'
import type {
  AgentCandidateJudge,
  AgentCapabilityResolver,
  AgentExecutionResult,
  AgentSubmitInput,
  AgentTraceRecorder,
  SchedulingDataGateway,
} from '@/services/agent/types'
import { buildFormalWriteContext } from '@/services/agent/mutationPolicy'
import type { AgentPlannerAction } from '@/services/llm/agentPlanner'
import type { OrchestrationCommand } from '@/types/orchestration'
import { FormalPlaylistWriteAdapter, type FormalPlaylistWriteMetadata } from './formalPlaylistWriteAdapter'
import type { RuntimeExecutedResult, RuntimePendingCommand } from './schedulingAgentRuntimeFacade'
import {
  assertFormalOrchestrationGrantScope,
  type FormalOrchestrationGrant,
} from './formalOrchestrationGrant'
import type {
  FormalActionPortResult,
  FormalOrchestrationActionPortContext,
  FormalOrchestrationActionPorts,
} from './formalOrchestrationActionAdapter'

type AtomicAction = Extract<AgentPlannerAction, { type: 'atomic_command' }> & {
  mutationPolicy: 'preview_only' | 'pending_only' | 'formal_write'
}

export interface FormalOrchestrationAtomicPortOptions {
  workspaceKey: string
  authorization?: FormalOrchestrationGrant
  dataGateway: SchedulingDataGateway
  baseInput: AgentSubmitInput
  candidateJudge: AgentCandidateJudge
  deadline?: AgentDeadline
  capabilityRegistry?: AgentCapabilityResolver
  writeAdapterFactory?: (commitInput: Parameters<SchedulingDataGateway['commitScheduleItems']>[0]) => FormalPlaylistWriteAdapter
}

class PendingCommitCapture extends Error {
  constructor(readonly commitInput: Parameters<SchedulingDataGateway['commitScheduleItems']>[0]) {
    super('pending_only commit captured before formal write')
  }
}

const createTraceRecorder = (): AgentTraceRecorder => {
  const steps: ReturnType<AgentTraceRecorder['getTrace']> = []
  return {
    record: (status, label, detail) => steps.push({ status, label, detail, timestamp: new Date().toISOString() }),
    getTrace: () => [...steps],
  }
}

export function createFormalOrchestrationAtomicPort(
  options: FormalOrchestrationAtomicPortOptions,
): Pick<FormalOrchestrationActionPorts, 'atomicCommand'> {
  if (!options.workspaceKey.trim()) throw new Error('Formal orchestration atomic port requires workspaceKey.')
  const defaultWriteBridge = createDefaultWriteBridge(options.dataGateway)
  const capabilityRegistry = options.capabilityRegistry ?? createDefaultAtomicCapabilityRegistry()

  return {
    atomicCommand: async (action, portContext) => executeAtomicAction(
      options,
      action,
      portContext,
      defaultWriteBridge,
      capabilityRegistry,
    ),
  }
}

interface DefaultWriteBridge {
  adapter: FormalPlaylistWriteAdapter
  setCommitInput: (input: Parameters<SchedulingDataGateway['commitScheduleItems']>[0] | null) => void
}

async function executeAtomicAction(
  options: FormalOrchestrationAtomicPortOptions,
  action: AtomicAction,
  portContext: FormalOrchestrationActionPortContext,
  defaultWriteBridge: DefaultWriteBridge,
  capabilityRegistry: AgentCapabilityResolver,
): Promise<FormalActionPortResult> {
  assertPortContext(options.workspaceKey, portContext)
  if (!action.intent) throw new Error('Atomic ReAct action requires intent.')
  if (action.mutationPolicy === 'formal_write' && options.authorization) {
    assertFormalOrchestrationGrantScope(options.authorization, {
      workspaceKey: options.workspaceKey,
      intent: action.intent,
    })
  }

  const trace = createTraceRecorder()
  let formalWriteMetadata: FormalPlaylistWriteMetadata | undefined
  const gateway: SchedulingDataGateway = {
    loadContext: (input) => options.dataGateway.loadContext(input),
    commitScheduleItems: async (commitInput) => {
      assertPortContext(options.workspaceKey, portContext)
      if (action.mutationPolicy === 'preview_only') {
        throw new Error(`preview_only action ${action.intent} reached the formal commit boundary.`)
      }
      if (action.mutationPolicy === 'pending_only') throw new PendingCommitCapture(commitInput)

      const adapter = options.writeAdapterFactory?.(commitInput) ?? defaultWriteBridge.adapter
      defaultWriteBridge.setCommitInput(commitInput)
      const mutationId = portContext.actionKey
      const writeResult = await adapter.execute(buildRuntimePendingCommand(action, options.baseInput, mutationId), {
        sessionId: options.baseInput.conversationId,
        workspaceKey: options.workspaceKey,
        mutationContext: buildFormalWriteContext(`${portContext.runId}:message`, options.workspaceKey, mutationId),
      }).finally(() => defaultWriteBridge.setCommitInput(null))
      formalWriteMetadata = writeResult.details?.formalWrite as FormalPlaylistWriteMetadata | undefined
      return toAgentExecutionResult(writeResult, commitInput)
    },
  }
  const input = buildAtomicInput(options.baseInput, action)
  const capabilityMatches = capabilityRegistry.resolveAll(input)
  if (capabilityMatches.length === 0) {
    throw new Error(`No capability found for ReAct atomic intent: ${action.intent}`)
  }
  if (capabilityMatches.length > 1) {
    throw new CapabilityRouteConflictError({
      intent: action.intent,
      capabilityIds: capabilityMatches.map((capability) => capability.id),
      recognizedSlots: capabilityMatches.map((capability) => ({
        capabilityId: capability.id,
        metadata: capability.metadata,
      })),
      missingSlots: ['distinct_capability_owner'],
      candidateEvidence: capabilityMatches.map((capability) => ({
        capabilityId: capability.id,
        priority: capability.metadata?.priority ?? 0,
      })),
      retrySuggestions: ['Resolve the capability ownership conflict before retrying this action.'],
    })
  }
  const capability = capabilityMatches[0]!

  try {
    const result = await capability.handle(input, {
      dataGateway: gateway,
      candidateJudge: options.candidateJudge,
      trace,
      deadline: options.deadline,
    })
    const readOnly = action.intent === 'query' || action.intent === 'validate'
    const pendingMutation = action.mutationPolicy === 'pending_only' && result.decision.pendingTask
      ? {
          owner: 'formal_playlist' as const,
          workspaceKey: options.workspaceKey,
          mutationId: portContext.actionKey,
          mutationPolicy: 'pending_only' as const,
          intent: action.intent,
          pendingTask: result.decision.pendingTask,
        }
      : undefined
    return {
      workspaceKey: options.workspaceKey,
      summary: result.explanation,
      noMutation: readOnly || result.executionResult?.committed !== true,
      mutationPolicy: action.mutationPolicy,
      risk: result.status === 'blocked' || result.status === 'failed' ? result.explanation : undefined,
      data: {
        agentResultStatus: result.status,
        decision: result.decision,
        executionResult: result.executionResult,
        validationReport: result.validationReport,
        pendingMutation,
        trace: result.trace,
        formalWrite: formalWriteMetadata,
      },
    }
  } catch (error) {
    if (!(error instanceof PendingCommitCapture)) throw error
    return {
      workspaceKey: options.workspaceKey,
      summary: `原子动作 ${action.intent} 已通过业务校验并停在待确认写入边界。`,
      noMutation: true,
      mutationPolicy: 'pending_only',
      data: {
        pendingMutation: {
          owner: 'formal_playlist',
          workspaceKey: options.workspaceKey,
          mutationId: portContext.actionKey,
          mutationPolicy: 'pending_only',
          intent: action.intent,
          proposedItemCount: error.commitInput.items.length,
          reason: error.commitInput.reason,
          expectedContextFingerprint: error.commitInput.expectedContextFingerprint,
        },
        trace: trace.getTrace(),
      },
    }
  }
}

function createDefaultAtomicCapabilityRegistry(): AgentCapabilityResolver {
  const registry = new CapabilityRegistry()
  registry.register(new AtomicCommandCapability())
  return registry
}

function buildAtomicInput(baseInput: AgentSubmitInput, action: AtomicAction): AgentSubmitInput {
  return {
    ...baseInput,
    orchestration: undefined,
    userInput: baseInput.userInput,
    pendingTask: baseInput.pendingTask,
    interpretation: {
      intent: action.intent,
      confidence: 1,
      source: 'llm',
      slots: {
        targetTime: action.targetTime,
        newStartTime: action.newStartTime,
        rangeStart: action.rangeStart,
        rangeEnd: action.rangeEnd,
        programHint: action.programHint,
        replacementHint: action.replacementHint,
        offsetSeconds: action.offsetSeconds,
        direction: action.direction,
        candidateId: action.candidateId,
        targetItemId: action.targetItemId,
        targetProgramName: action.targetProgramName,
      },
      queryKind: action.intent === 'query' ? 'candidate_lookup' : undefined,
      pendingAction: action.pendingAction,
      keyword: action.keyword ?? action.programHint,
      searchAlternatives: action.searchAlternatives,
      reasoning: '正式长流程 LLM decide 返回的原子动作。',
    },
  }
}

function buildRuntimePendingCommand(
  action: AtomicAction,
  baseInput: AgentSubmitInput,
  mutationId: string,
): Parameters<FormalPlaylistWriteAdapter['execute']>[0] {
  const command = toOrchestrationCommand(action)
  const pendingCommand: RuntimePendingCommand = {
    command,
    summary: `ReAct ${action.intent} 正式写入`,
    reasoning: 'LLM decide 已显式授权 formal_write，仍需经过正式写入边界。',
  }
  return {
    pendingCommand,
    scheduleDate: baseInput.date,
    channelId: baseInput.channelId,
    idempotencyKey: `react:${mutationId}:${action.targetItemId ?? action.targetTime ?? action.candidateId ?? 'command'}`,
  }
}

function toOrchestrationCommand(action: AtomicAction): OrchestrationCommand {
  const reasoning = 'ReAct formal_write adapter bridge'
  if (action.intent === 'insert') {
    return { action: 'insert', reasoning, data: { candidateId: action.candidateId ?? '', insertTime: action.targetTime } }
  }
  if (action.intent === 'delete') {
    return { action: 'delete', reasoning, data: { itemId: action.targetItemId ?? '' } }
  }
  if (action.intent === 'replace') {
    return { action: 'replace', reasoning, data: { itemId: action.targetItemId ?? '', newCandidateId: action.candidateId ?? '' } }
  }
  if (action.intent === 'move') {
    return { action: 'move', reasoning, data: { itemId: action.targetItemId ?? '', newStartTime: action.newStartTime ?? '' } }
  }
  return {
    action: 'update_field',
    reasoning,
    data: { itemId: action.targetItemId ?? 'batch', field: 'reactAtomicIntent', value: action.intent },
  }
}

function createDefaultWriteBridge(dataGateway: SchedulingDataGateway): DefaultWriteBridge {
  let activeCommitInput: Parameters<SchedulingDataGateway['commitScheduleItems']>[0] | null = null
  const adapter = new FormalPlaylistWriteAdapter({
    executePendingCommand: async (input): Promise<RuntimeExecutedResult> => {
      if (!activeCommitInput) throw new Error('Formal write adapter lost the validated commit input.')
      const execution = await dataGateway.commitScheduleItems(activeCommitInput)
      return {
        success: execution.committed,
        command: input.pendingCommand.command,
        message: execution.committed ? '正式播单写入完成。' : '正式播单写入被数据网关拒绝。',
        error: execution.committed ? undefined : 'formal_playlist_commit_rejected',
        summary: input.pendingCommand.summary,
        explanation: input.pendingCommand.reasoning,
        data: execution,
      }
    },
  })
  return {
    adapter,
    setCommitInput: (input) => { activeCommitInput = input },
  }
}

function toAgentExecutionResult(
  result: RuntimeExecutedResult,
  commitInput: Parameters<SchedulingDataGateway['commitScheduleItems']>[0],
): AgentExecutionResult {
  const data = result.data as AgentExecutionResult | undefined
  return {
    committed: result.success && data?.committed === true,
    operationId: data?.operationId ?? (result.success ? 'formal-write-adapter' : result.error ?? 'formal-write-blocked'),
    affectedItemIds: data?.affectedItemIds ?? [],
    scheduleItems: data?.scheduleItems ?? commitInput.items,
  }
}

function assertPortContext(workspaceKey: string, context: FormalOrchestrationActionPortContext): void {
  if (context.workspaceKey !== workspaceKey) {
    throw new Error(`Formal atomic port workspace mismatch: expected ${workspaceKey}, received ${context.workspaceKey}.`)
  }
  if (!context.actionKey?.trim()) {
    throw new Error('Formal atomic port requires a stable actionKey.')
  }
  if (context.signal?.aborted) throw new Error('Formal orchestration atomic action aborted.')
}
