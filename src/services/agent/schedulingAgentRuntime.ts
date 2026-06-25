import { DefaultAgentTraceRecorder } from './agentTrace'
import { AtomicCommandCapability } from './atomicCommandCapability'
import { buildAgentAuditSummary } from './agentAuditSummary'
import { auditSchedulingAgentOperationalReadiness, auditSchedulingAgentV1Readiness } from './agentReadinessAudit'
import { buildPendingLlmContext } from './agentSession'
import { LlmAgentCandidateJudge } from './candidateJudge'
import type { LLMClient } from '@/services/llm/llmClient'
import { getLLMClient } from '@/services/llm/llmClient'
import { CapabilityRegistry } from './capabilityRegistry'
import { buildAgentLlmContextPackage } from './llmContextPackage'
import { AgentPlaylistPolicy, type AgentCommandPolicy } from './playlistPolicy'
import { listProfessionalRules, type SchedulingAgentRuntimeProfessionalRule } from './professionalRules'
import type {
  SchedulingAgentOperationalReadinessAudit,
  SchedulingAgentOperationalReadinessInput,
  SchedulingAgentV1ReadinessAudit,
} from './agentReadinessAudit'
import type {
  AgentCandidateJudge,
  AgentCapability,
  AgentIntentInterpreter,
  AgentResult,
  AgentSubmitInput,
  AtomicCommandIntent,
  SchedulingContextSourceContext,
  SchedulingContext,
  SchedulingDataGateway,
  AgentTraceStep,
} from './types'

export interface SchedulingAgentRuntimeOptions {
  dataGateway: SchedulingDataGateway
  candidateJudge?: AgentCandidateJudge
  llmClient?: Pick<LLMClient, 'chat'>
  intentInterpreter?: AgentIntentInterpreter
  capabilities?: AgentCapability[]
  onTraceStep?: (step: AgentTraceStep) => void
}

export interface SchedulingAgentRuntimeCapabilitySummary {
  capabilityIds: string[]
  commandPolicies: AgentCommandPolicy[]
  dataRequirements: SchedulingAgentRuntimeDataRequirement[]
  safetyGates: SchedulingAgentRuntimeSafetyGate[]
  professionalRules: SchedulingAgentRuntimeProfessionalRule[]
}

export interface SchedulingAgentRuntimeDataRequirement {
  sourceKey: keyof SchedulingContextSourceContext
  requiredFor: AtomicCommandIntent[]
  missingBehavior: 'block_write' | 'audit_only'
  guardCode?: string
  description: string
}

export interface SchedulingAgentRuntimeSafetyGate {
  id: string
  appliesTo: AtomicCommandIntent[]
  mode: 'block' | 'confirm' | 'read_only' | 'reroute' | 'audit'
  description: string
}

export class SchedulingAgentRuntime {
  private readonly dataGateway: SchedulingDataGateway
  private readonly candidateJudge: AgentCandidateJudge
  private readonly intentInterpreter?: AgentIntentInterpreter
  private readonly onTraceStep?: (step: AgentTraceStep) => void
  private readonly registry = new CapabilityRegistry()
  private readonly playlistPolicy = new AgentPlaylistPolicy()

  constructor(options: SchedulingAgentRuntimeOptions) {
    this.dataGateway = options.dataGateway
    this.candidateJudge = options.candidateJudge
      ?? new LlmAgentCandidateJudge({ llmClient: options.llmClient ?? getLLMClient() })
    this.intentInterpreter = options.intentInterpreter
    this.onTraceStep = options.onTraceStep
    const capabilities = options.capabilities ?? [new AtomicCommandCapability()]
    capabilities.forEach((capability) => this.registry.register(capability))
  }

  describeCapabilities(): SchedulingAgentRuntimeCapabilitySummary {
    return {
      capabilityIds: this.registry.list().map((capability) => capability.id),
      commandPolicies: this.playlistPolicy.listCommandPolicies(),
      dataRequirements: [
        {
          sourceKey: 'today',
          requiredFor: ['move', 'batch_move', 'insert', 'replace', 'delete', 'batch_delete', 'query', 'validate'],
          missingBehavior: 'block_write',
          guardCode: 'schedule_source_missing',
          description: 'Current playlist items are mandatory evidence for write safety, schedule queries, and validation diagnostics.',
        },
        {
          sourceKey: 'candidates',
          requiredFor: ['insert', 'replace', 'query'],
          missingBehavior: 'block_write',
          guardCode: 'candidate_source_missing',
          description: 'Candidate programme source must be configured before programme writes can be selected or committed; query reports missing evidence for candidate lookups.',
        },
        {
          sourceKey: 'readiness',
          requiredFor: ['insert', 'replace'],
          missingBehavior: 'audit_only',
          description: 'Broadcast readiness can be provided by material, rights, or technical review systems and overrides candidate readiness fields when available.',
        },
        {
          sourceKey: 'history',
          requiredFor: ['insert', 'replace'],
          missingBehavior: 'audit_only',
          description: 'History is used as sequence and continuity evidence when available.',
        },
        {
          sourceKey: 'constraints',
          requiredFor: ['move', 'batch_move', 'insert', 'replace', 'delete', 'batch_delete', 'validate'],
          missingBehavior: 'audit_only',
          description: 'Constraint sources provide layout bounds, locked items, blocked ranges, and validation evidence.',
        },
        {
          sourceKey: 'policy',
          requiredFor: ['move', 'batch_move', 'insert', 'replace', 'delete', 'batch_delete', 'query', 'validate'],
          missingBehavior: 'audit_only',
          description: 'Playlist policy separates TV and rotation execution modes and confirmation gates.',
        },
      ],
      safetyGates: [
        {
          id: 'playlist_policy',
          appliesTo: ['insert', 'replace', 'delete', 'batch_delete', 'query', 'validate'],
          mode: 'confirm',
          description: 'Rotation candidate writes and sensitive delete operations require confirmation before commit; query and validate stay read-only.',
        },
        {
          id: 'constraint_engine',
          appliesTo: ['move', 'batch_move', 'insert', 'replace', 'delete', 'batch_delete', 'validate'],
          mode: 'block',
          description: 'Hard constraints block overlapping, locked, out-of-bounds, blocked-range, sequence, readiness, and source-missing writes.',
        },
        {
          id: 'source_coverage',
          appliesTo: ['move', 'batch_move', 'insert', 'replace', 'delete', 'batch_delete', 'query', 'validate'],
          mode: 'block',
          description: 'Write commands block on missing mandatory sources; read-only query and validate commands report missing source evidence in their audit.',
        },
        {
          id: 'pending_lifecycle',
          appliesTo: ['move', 'batch_move', 'insert', 'replace', 'delete', 'batch_delete'],
          mode: 'reroute',
          description: 'Pending tasks can be continued, cancelled, confirmed, rejected, or bypassed when the LLM starts a new task.',
        },
        {
          id: 'llm_intent_contract',
          appliesTo: ['move', 'batch_move', 'insert', 'replace', 'delete', 'batch_delete', 'query', 'validate'],
          mode: 'block',
          description: 'LLM interpretation must return structured intent, confidence, slots, and only pending actions allowed by the current pending task; low-confidence or failed output stops before capability execution.',
        },
        {
          id: 'capability_route_conflict',
          appliesTo: ['move', 'batch_move', 'insert', 'replace', 'delete', 'batch_delete', 'query', 'validate'],
          mode: 'block',
          description: 'Capability routing must resolve to one command owner; ambiguous matches are blocked before any capability package can execute.',
        },
        {
          id: 'pending_llm_context',
          appliesTo: ['move', 'batch_move', 'insert', 'replace', 'delete', 'batch_delete'],
          mode: 'audit',
          description: 'Pending-turn LLM interpretation receives the current user turn plus structured pending context, collected slots, missing slots, allowed actions, context fingerprint, and source snapshots.',
        },
        {
          id: 'llm_usage_audit',
          appliesTo: ['move', 'batch_move', 'insert', 'replace', 'delete', 'batch_delete', 'query', 'validate'],
          mode: 'audit',
          description: 'Agent results record LLM intent-interpreter call attempts, successes, rejections, and failures so LLM usage stays bounded and reviewable.',
        },
        {
          id: 'context_fingerprint',
          appliesTo: ['batch_move', 'insert', 'replace', 'delete', 'batch_delete'],
          mode: 'block',
          description: 'Pending writes are blocked when the scheduling context, source evidence, or playlist items change before confirmation.',
        },
        {
          id: 'commit_fingerprint',
          appliesTo: ['move', 'batch_move', 'insert', 'replace', 'delete', 'batch_delete'],
          mode: 'block',
          description: 'Write commits include the planning-time playlist fingerprint and are rejected if the playlist changed before commit.',
        },
        {
          id: 'tv_sequence_selector',
          appliesTo: ['insert', 'replace'],
          mode: 'block',
          description: 'TV playlist candidate writes use today and history evidence to avoid skipping or reversing episode order.',
        },
        {
          id: 'candidate_query_facets',
          appliesTo: ['insert', 'replace', 'query'],
          mode: 'audit',
          description: 'Candidate lookup derives auditable keyword facets from structured intent instead of forwarding whole natural-language requests as one opaque search string.',
        },
        {
          id: 'professional_slot_policy',
          appliesTo: ['insert', 'replace'],
          mode: 'audit',
          description: 'Professional slot-duty and replacement continuity rules score candidates and explain risks; explicit atomic writes are not blocked by layout-draft or slot-duty preferences.',
        },
        {
          id: 'evidence_audit_chain',
          appliesTo: ['move', 'batch_move', 'insert', 'replace', 'delete', 'batch_delete', 'query', 'validate'],
          mode: 'audit',
          description: 'Every decision records a multi-source evidence chain covering current playlist, candidates, readiness, history, constraints, and policy.',
        },
      ],
      professionalRules: listProfessionalRules(),
    }
  }

  auditV1Readiness(): SchedulingAgentV1ReadinessAudit {
    return auditSchedulingAgentV1Readiness(this.describeCapabilities())
  }

  async auditOperationalReadiness(
    input: SchedulingAgentOperationalReadinessInput,
  ): Promise<SchedulingAgentOperationalReadinessAudit> {
    const context = await this.dataGateway.loadContext({
      ...input,
      userInput: input.userInput ?? 'audit operational readiness',
    })
    return auditSchedulingAgentOperationalReadiness(this.describeCapabilities(), context)
  }

  async submit(input: AgentSubmitInput): Promise<AgentResult> {
    const trace = new DefaultAgentTraceRecorder(this.onTraceStep)
    trace.record('idle', '接收 agent 指令', {
      channelId: input.channelId,
      date: input.date,
      playlistId: input.playlistId,
    })

    const effectiveInput = await this.buildEffectiveInput(input, trace)
    if (this.intentInterpreter && !effectiveInput.interpretation) {
      trace.record('failed', 'LLM interpretation did not produce a structured command; capability fallback is disabled.', {
        userInput: effectiveInput.userInput,
        pendingIntent: effectiveInput.pendingTask?.intent,
      })
      return {
        status: 'failed',
        input: effectiveInput,
        decision: {
          constraintReport: {
            ok: false,
            issues: [{
              code: 'llm_intent_unavailable',
              severity: 'critical',
              message: '这次模型没有正常理解这条指令，系统不会用本地关键词规则代替模型继续执行。',
            }],
          },
        },
        explanation: '这次模型没有正常理解这条指令，我没有改动播单。你可以直接说“重试”，或者把时间、节目名再说一遍。',
        trace: trace.getTrace(),
      }
    }
    const capabilityMatches = this.registry.resolveAll(effectiveInput)
    if (capabilityMatches.length === 0) {
      trace.record('needs_clarification', '没有匹配到可处理的 capability', {
        userInput: effectiveInput.userInput,
        interpretation: effectiveInput.interpretation,
      })
      return {
        status: 'needs_clarification',
        input: effectiveInput,
        decision: {
          constraintReport: {
            ok: false,
            issues: [{
              code: 'unsupported_intent',
              severity: 'critical',
              message: '当前 Agent Core v1 只处理节目单原子命令，请补充插入、删除、移动、替换、查询或校验类指令。',
            }],
          },
        },
        explanation: '当前 Agent Core v1 还没有匹配到可执行能力，请换成明确的节目单原子命令。',
        trace: trace.getTrace(),
      }
    }

    if (capabilityMatches.length > 1) {
      const capabilityIds = capabilityMatches.map((match) => match.id)
      trace.record('blocked', 'Multiple Agent capabilities matched one request; routing is ambiguous.', {
        capabilityIds,
        intent: effectiveInput.interpretation?.intent,
        pendingIntent: effectiveInput.pendingTask?.intent,
      })
      return {
        status: 'blocked',
        input: effectiveInput,
        decision: {
          constraintReport: {
            ok: false,
            issues: [{
              code: 'capability_route_conflict',
              severity: 'critical',
              message: 'Multiple Agent capabilities matched the same request; the runtime blocked execution to avoid choosing the wrong command owner.',
              detail: {
                capabilityIds,
                intent: effectiveInput.interpretation?.intent,
                pendingIntent: effectiveInput.pendingTask?.intent,
              },
            }],
          },
        },
        explanation: '多个 Agent 能力同时匹配了这次请求，系统已阻断执行，请先收窄能力路由或补充命令边界。',
        trace: trace.getTrace(),
      }
    }
    const capability = capabilityMatches[0]!

    trace.record('planning', 'Agent capability selected for execution.', {
      capabilityId: capability.id,
      intent: effectiveInput.interpretation?.intent,
      pendingIntent: effectiveInput.pendingTask?.intent,
    })

    let lastContext: SchedulingContext | undefined
    let lastContextSources: SchedulingContextSourceContext | undefined
    const auditingDataGateway: SchedulingDataGateway = {
      loadContext: async (contextInput) => {
        const context = await this.dataGateway.loadContext(contextInput)
        lastContext = context
        lastContextSources = context.bundle.sources
        return context
      },
      commitScheduleItems: (commitInput) => this.dataGateway.commitScheduleItems(commitInput),
    }

    const capabilityResult = await capability.handle(effectiveInput, {
      dataGateway: auditingDataGateway,
      candidateJudge: this.candidateJudge,
      trace,
    })
    const result: AgentResult = {
      ...capabilityResult,
      decision: {
        ...capabilityResult.decision,
        auditSummary: buildAgentAuditSummary(capabilityResult, lastContextSources, lastContext),
      },
    }

    trace.record(result.status === 'executed' ? 'completed' : result.status, 'agent 指令处理结束', {
      resultStatus: result.status,
    })

    return {
      ...result,
      trace: trace.getTrace(),
    }
  }

  private async buildEffectiveInput(
    input: AgentSubmitInput,
    trace: DefaultAgentTraceRecorder,
  ): Promise<AgentSubmitInput> {
    if (input.interpretation || !this.intentInterpreter) {
      return input
    }
    const buildLlmCallTrace = (
      status: 'attempted' | 'succeeded' | 'rejected' | 'failed',
      reason?: string,
    ) => this.intentInterpreter?.usesLlm
      ? {
          llmCall: {
            stage: 'intent_interpreter',
            status,
            reason,
          },
          pendingLlmContext: input.pendingTask
            ? buildPendingLlmContext(input.pendingTask, input.userInput)
            : undefined,
        }
      : {}

    try {
      trace.record('understanding', '调用 Agent intent interpreter 生成结构化意图', {
        source: 'llm_only',
        ...buildLlmCallTrace('attempted'),
      })
      const interpreterInput = await this.buildInterpreterInput(input, trace)
      const interpretation = await this.intentInterpreter.interpret(interpreterInput)
      if (!interpretation?.intent) {
        trace.record('understanding', 'Agent intent interpreter 未返回可执行意图，本轮停止，不走本地关键词兜底', {
          interpretation,
          ...buildLlmCallTrace('rejected', 'no_structured_intent'),
        })
        return input
      }
      if (interpretation.source === 'llm' && !this.hasUserReadableLlmUnderstanding(interpretation)) {
        trace.record('understanding', 'Agent intent interpreter 未返回可读理解说明，本轮停止，不走本地话术兜底', {
          interpretation,
          ...buildLlmCallTrace('rejected', 'missing_user_readable_understanding'),
        })
        return input
      }
      trace.record('understanding', 'Agent intent interpreter 返回结构化意图', {
        intent: interpretation.intent,
        confidence: interpretation.confidence,
        source: interpretation.source,
        contextMode: interpretation.contextMode,
        slots: interpretation.slots,
        assistantFeedback: interpretation.assistantFeedback,
        streamingHint: interpretation.streamingHint,
        ...buildLlmCallTrace('succeeded'),
      })
      return {
        ...interpreterInput,
        interpretation,
      }
    } catch (error) {
      trace.record('understanding', 'Agent intent interpreter 调用失败，本轮停止，不走本地关键词兜底', {
        error: error instanceof Error ? error.message : String(error),
        ...buildLlmCallTrace('failed', error instanceof Error ? error.message : String(error)),
      })
      return input
    }
  }

  private hasUserReadableLlmUnderstanding(interpretation: NonNullable<AgentSubmitInput['interpretation']>): boolean {
    const candidates = [interpretation.assistantFeedback, interpretation.reasoning]
      .map((value) => typeof value === 'string' ? value.trim() : '')
      .filter(Boolean)
    return candidates.some((value) => {
      if (value.length < 4) return false
      if (/^(?:\{|\[)/u.test(value)) return false
      if (/intent|slots|confidence|pendingAction|taskPlan|runtime|JSON/i.test(value)) return false
      return /[\u4e00-\u9fa5]/u.test(value)
    })
  }

  private async buildInterpreterInput(
    input: AgentSubmitInput,
    trace: DefaultAgentTraceRecorder,
  ): Promise<AgentSubmitInput> {
    if (!this.intentInterpreter?.usesLlm || input.llmContextPackage) {
      return input
    }

    try {
      const context = await this.dataGateway.loadContext(input)
      const llmContextPackage = buildAgentLlmContextPackage(context, input)
      trace.record('resolving_context', 'Prepared compact evidence package for LLM intent interpretation.', {
        sourceCount: llmContextPackage.sourceSummary.length,
        scheduleItemCount: llmContextPackage.currentSchedule.length,
        scheduleItemTotalCount: llmContextPackage.budget.scheduleItems.total,
        scheduleItemTruncated: llmContextPackage.budget.scheduleItems.truncated,
        candidateCount: llmContextPackage.candidateSummary.length,
        candidateTotalCount: llmContextPackage.budget.candidates.total,
        candidateTruncated: llmContextPackage.budget.candidates.truncated,
        latestHistoryItemCount: llmContextPackage.budget.latestHistoryItems?.included,
        latestHistoryItemTotalCount: llmContextPackage.budget.latestHistoryItems?.total,
        latestHistoryItemTruncated: llmContextPackage.budget.latestHistoryItems?.truncated,
        hasLatestHistory: Boolean(llmContextPackage.latestHistory),
        playlistType: llmContextPackage.identity.playlistType,
      })
      return {
        ...input,
        llmContextPackage,
      }
    } catch (error) {
      trace.record('resolving_context', 'Failed to prepare LLM evidence package; continuing with user and pending context only.', {
        error: error instanceof Error ? error.message : String(error),
      })
      return input
    }
  }
}
