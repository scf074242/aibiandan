import { AgentConstraintEngine } from '@/services/agent/constraintEngine'
import type { AgentSubmitInput, SchedulingDataGateway } from '@/services/agent/types'
import type { AgentPlannerAction } from '@/services/llm/agentPlanner'
import type {
  FormalActionPortResult,
  FormalOrchestrationActionPortContext,
  FormalOrchestrationActionPorts,
} from './formalOrchestrationActionAdapter'

type ResearchAction = Extract<AgentPlannerAction, { type: 'research_check' }>

export interface FormalOrchestrationReadPortsOptions {
  workspaceKey: string
  dataGateway: SchedulingDataGateway
  baseInput: AgentSubmitInput
  constraintEngine?: AgentConstraintEngine
}

export function createFormalOrchestrationReadPorts(
  options: FormalOrchestrationReadPortsOptions,
): Pick<FormalOrchestrationActionPorts, 'researchCheck' | 'validate'> {
  if (!options.workspaceKey.trim()) throw new Error('Formal orchestration read ports require workspaceKey.')
  const constraintEngine = options.constraintEngine ?? new AgentConstraintEngine()

  const assertActive = (context: FormalOrchestrationActionPortContext) => {
    if (context.workspaceKey !== options.workspaceKey) {
      throw new Error(`Formal read port workspace mismatch: expected ${options.workspaceKey}, received ${context.workspaceKey}.`)
    }
    if (context.signal?.aborted) throw new Error('Formal orchestration read aborted.')
  }

  const load = async (input: AgentSubmitInput, context: FormalOrchestrationActionPortContext) => {
    assertActive(context)
    const schedulingContext = await options.dataGateway.loadContext(input)
    assertActive(context)
    return schedulingContext
  }

  return {
    researchCheck: async (action, portContext): Promise<FormalActionPortResult> => {
      const queries = collectExplicitQueries(action)
      if (!queries.length) throw new Error('research_check requires explicit LLM-provided queries or labels.')
      const context = await load({
        ...options.baseInput,
        userInput: queries.join(' '),
        interpretation: {
          intent: 'query',
          confidence: 1,
          source: 'llm',
          slots: { programHint: queries[0] },
          keyword: queries[0],
          searchAlternatives: queries,
          reasoning: '长流程 LLM decide 返回的只读候选查询。',
        },
      }, portContext)
      const candidateSource = context.bundle.sources.candidates
      const candidates = context.programCandidates.slice(0, 20).map((candidate) => ({
        id: candidate.id,
        programId: candidate.programId,
        programCode: candidate.programCode,
        programName: candidate.programName,
        instanceName: candidate.instanceName,
        programType: candidate.programType,
        duration: candidate.duration,
        issueNo: candidate.issueNo,
        columnName: candidate.columnName,
        contentTags: candidate.contentTags,
        materialStatus: candidate.materialStatus,
        rightsStatus: candidate.rightsStatus,
      }))
      return {
        workspaceKey: options.workspaceKey,
        summary: candidateSource.available
          ? `按模型提供的 ${queries.length} 组查询读取到 ${context.programCandidates.length} 个候选。`
          : '候选数据源当前不可用，未获得可供下一轮决策的候选证据。',
        noMutation: true,
        mutationPolicy: 'preview_only',
        risk: candidateSource.available ? undefined : candidateSource.errorMessage ?? candidateSource.errorCode ?? 'candidate_source_unavailable',
        data: {
          queries,
          candidateCount: context.programCandidates.length,
          candidates,
          sourceEvidence: context.bundle.sources,
          contextIdentity: context.bundle.identity,
        },
      }
    },

    validate: async (_action, portContext): Promise<FormalActionPortResult> => {
      const context = await load({
        ...options.baseInput,
        interpretation: {
          intent: 'validate',
          confidence: 1,
          source: 'llm',
          reasoning: '长流程 LLM decide 请求校验当前真实编排上下文。',
        },
      }, portContext)
      const validationReport = constraintEngine.validateContext(context)
      return {
        workspaceKey: options.workspaceKey,
        summary: validationReport.ok
          ? `当前播单 ${context.scheduleItems.length} 条节目通过约束校验。`
          : `当前播单发现 ${validationReport.issues.length} 个约束问题，需要下一轮决定如何处理。`,
        noMutation: true,
        mutationPolicy: 'preview_only',
        risk: validationReport.ok ? undefined : validationReport.issues[0]?.message,
        data: {
          validationReport,
          scheduleItemCount: context.scheduleItems.length,
          sourceEvidence: context.bundle.sources,
          contextIdentity: context.bundle.identity,
        },
      }
    },
  }
}

function collectExplicitQueries(action: ResearchAction): string[] {
  return [
    ...(action.queries ?? []),
    action.semanticLabel,
    action.targetSegmentLabel,
    action.programTypeHint,
  ]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map((value) => value.trim())
    .filter((value, index, values) => values.indexOf(value) === index)
}
