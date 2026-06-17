import {
  getDemoRuntimeFacade,
  type RuntimeDecision,
  type RuntimeExecutedResult,
  type RuntimePendingAtomicClarification,
  type RuntimePendingCommand,
  type RuntimePendingInsertRecommendation,
  type RuntimePendingTargetSelection,
  type RuntimeScheduleItem,
} from '@/services/runtime/demoRuntimeFacade'
import type { RuntimePendingAtomicContext } from '@/services/runtime/pendingAtomicContext'
import type { SchedulingAgentRuntimeCapabilitySummary } from '@/services/agent/schedulingAgentRuntime'
import type { SchedulingAgentOperationalReadinessAudit } from '@/services/agent/agentReadinessAudit'
import type { AgentAuditSummary, AgentQueryResult, AgentValidationReport } from '@/services/agent/types'
import { buildPendingLlmContext, type AgentPendingLlmContext } from '@/services/agent/agentSession'
import {
  buildPendingAtomicContextFromClarification,
  buildPendingAtomicContextFromInsertRecommendation,
  buildPendingAtomicContextFromTargetSelection,
  rehydratePendingAtomicClarificationFromAtomicContext,
  rehydratePendingInsertRecommendationFromAtomicContext,
  rehydratePendingTargetSelectionFromAtomicContext,
} from '@/services/runtime/pendingAtomicContext'
import {
  getRuntimeSessionStore,
  type BridgeRuntimeStatus,
  type RuntimeBridgeSessionState,
  type RuntimeLayoutDraftStatus,
} from '@/services/runtime/runtimeSessionStore'
import { getPendingAtomicContextService } from '@/services/runtime/pendingAtomicContextService'
import { getLayoutDraftFeasibilityService } from '@/services/layoutDraftFeasibilityService'
import { getDataService } from '@/services/orchestration/dataService'
import type { DraftFeasibilityReport, LayoutDraft, PlaylistType, RotationPlaylistStrategy, ScheduleItemSnapshot, TaskMode } from '@/types/orchestration'
import type { ScheduleState } from '@/types/orchestration'
import {
  extractSpecificSearchKeywords,
  hasEditorialKeywordRequirements,
  hasExplicitSequenceRequirements,
  hasFunctionalSearchKeywords,
} from '@/services/candidateKeywordMatcher'

export interface OpenClawBridgeSubmitInput {
  conversationId: string
  channelId: string
  channelName: string
  date: string
  text: string
  currentSchedule: RuntimeScheduleItem[]
  gapCount?: number
  history?: string[]
  currentLayoutDraft?: LayoutDraft | null
  currentLayoutDraftMode?: Extract<TaskMode, 'full_generate' | 'partial_generate'> | null
  currentLayoutDraftFeasibility?: DraftFeasibilityReport | null
  playlistType?: PlaylistType
  rotationStrategy?: RotationPlaylistStrategy
}

export interface OpenClawBridgeResult {
  sessionId: string
  status: BridgeRuntimeStatus
  summary: string
  message?: string
  payload?: OpenClawBridgePayload
}

export interface OpenClawBridgePayloadCompatibility {
  sourceOfTruth: 'pendingAtomicContext'
  legacyPendingPayloads: true
}

export interface OpenClawBridgePayload {
  conversationId: string
  agentCapabilities?: SchedulingAgentRuntimeCapabilitySummary
  agentOperationalReadiness?: SchedulingAgentOperationalReadinessAudit
  agentAuditSummary?: AgentAuditSummary
  agentQueryResult?: AgentQueryResult
  agentValidationReport?: AgentValidationReport
  agentPendingLlmContext?: AgentPendingLlmContext
  agentLlmContextUsed?: AgentPendingLlmContext
  pendingCommand?: RuntimePendingCommand
  pendingAtomicContext?: RuntimePendingAtomicContext | null
  pendingLayoutDraft?: LayoutDraft
  layoutDraftStatus?: RuntimeLayoutDraftStatus
  layoutDraftMode?: Extract<TaskMode, 'full_generate' | 'partial_generate'>
  layoutDraftFeasibility?: DraftFeasibilityReport
  lastDecisionKind?: RuntimeDecision['kind']
  compatibility: OpenClawBridgePayloadCompatibility
  pendingTargetSelection?: RuntimePendingTargetSelection | null
  pendingInsertRecommendation?: RuntimePendingInsertRecommendation | null
  pendingAtomicClarification?: RuntimePendingAtomicClarification | null
}

export class OpenClawBridge {
  private readonly runtimeFacade = getDemoRuntimeFacade()
  private readonly sessionStore = getRuntimeSessionStore()
  private readonly pendingAtomicContextService = getPendingAtomicContextService()
  private readonly layoutDraftFeasibilityService = getLayoutDraftFeasibilityService()
  private readonly dataService = getDataService()

  async submitInstruction(input: OpenClawBridgeSubmitInput): Promise<OpenClawBridgeResult> {
    const session = this.sessionStore.upsertSessionForConversation({
      conversationId: input.conversationId,
      channelId: input.channelId,
      channelName: input.channelName,
      date: input.date,
      currentSchedule: input.currentSchedule,
      playlistType: input.playlistType,
      rotationStrategy: input.rotationStrategy,
    })

    const pendingCommandDecision = await this.tryResolvePendingCommandReply(session.sessionId, session.pendingCommand, input.text)
    if (pendingCommandDecision) {
      return pendingCommandDecision
    }

    const activeLayoutDraft = input.currentLayoutDraft ?? session.pendingLayoutDraft ?? null
    const activeLayoutDraftMode = input.currentLayoutDraftMode ?? session.layoutDraftMode ?? null
    const activeLayoutDraftFeasibility = input.currentLayoutDraftFeasibility ?? session.layoutDraftFeasibility ?? null
    if (activeLayoutDraft && this.isLayoutDraftCommitText(input.text)) {
      const decision = await this.buildFreshLayoutDraftCommitDecision(
        input.text,
        activeLayoutDraft,
        activeLayoutDraftMode ?? 'full_generate',
        activeLayoutDraftFeasibility,
        input,
      )
      const nextState = this.updateSessionFromDecision(session.sessionId, decision, input.text)
      return this.toBridgeResult(nextState)
    }
    const shouldPrioritizeLayoutDraft = Boolean(
      activeLayoutDraft && /(?:\u8349\u6848|\u7248\u9762|\u65f6\u6bb5|\u6539\u6210|\u6539\u4e3a|\u8c03\u6574\u4e3a|\u6362\u6210|\u66ff\u6362|\u5220\u9664|\u5220\u6389|\u79fb\u9664|\u53bb\u6389)/u.test(input.text.replace(/\s+/g, '')),

    )
    const pendingAtomicContext = shouldPrioritizeLayoutDraft ? null : this.resolvePendingAtomicContext(session)

    const decision = await this.runtimeFacade.submitInstruction({
      scheduleState: buildBridgeScheduleState(input),
      userInput: input.text,
      currentSchedule: input.currentSchedule,
      currentLayoutDraft: activeLayoutDraft,
      currentLayoutDraftMode: activeLayoutDraftMode,
      pendingTargetSelection: null,
      pendingInsertRecommendation: null,
      pendingAtomicClarification: shouldPrioritizeLayoutDraft ? null : this.resolvePendingAtomicClarification(session),
      pendingAtomicContext,
      history: input.history,
      agentCoreEnabled: true,
    })

    if (decision.kind === 'execute_command') {
      const executed = await this.runtimeFacade.executePendingCommand({
        pendingCommand: {
          command: decision.execution.command,
          summary: summarizeExecutionCommand(decision.execution.command),
          successMessage: decision.execution.successMessage,
          reasoning: decision.execution.explanation || '',
          details: decision.execution.details,
        },
        scheduleDate: input.date,
        channelId: input.channelId,
      })
      const executedState = this.updateSessionFromExecution(session.sessionId, executed)
      return this.toBridgeResult(executedState)
    }

    const nextState = this.updateSessionFromDecision(session.sessionId, decision, input.text)
    return this.toBridgeResult(nextState)
  }

  private isLayoutDraftCommitText(text: string): boolean {
    const normalized = text.replace(/\s+/g, '')
    const directPhrases = [
      '\u6309\u5f53\u524d\u7248\u9762\u5f00\u59cb\u7f16\u6392',
      '\u6309\u8fd9\u4e2a\u7248\u9762\u5f00\u59cb\u7f16\u6392',
      '\u6309\u8be5\u7248\u9762\u5f00\u59cb\u7f16\u6392',
      '\u786e\u8ba4\u7248\u9762',
      '\u91c7\u7528\u8fd9\u4e2a\u7248\u9762',
      '\u7528\u8fd9\u4e2a\u7248\u9762\u7f16\u6392',
      '\u5c31\u6309\u8fd9\u4e2a\u7248\u9762',
      '\u5c31\u6309\u8fd9\u4e2a\u8349\u6848',
      '\u6309\u8fd9\u4e2a\u7248\u9762',
      '\u6309\u8fd9\u4e2a\u8349\u6848',
      '\u7167\u8fd9\u4e2a\u7248\u9762',
      '\u7167\u8fd9\u4e2a\u8349\u6848',
      '\u8fd9\u4e2a\u7248\u9762\u53ef\u4ee5',
      '\u8fd9\u4e2a\u8349\u6848\u53ef\u4ee5',
      '\u53ef\u4ee5\u5f00\u59cb\u7f16\u6392',
      '\u6ca1\u95ee\u9898\u5f00\u59cb\u7f16\u6392',
    ]
    return directPhrases.some((phrase) => normalized.includes(phrase))
      || (/(?:\u7248\u9762|\u8349\u6848|\u65b9\u6848)/u.test(normalized) && /(?:\u6309|\u786e\u8ba4|\u78ba\u8a8d|\u5f00\u59cb|\u958b\u59cb|\u6267\u884c|\u57f7\u884c|\u53ef\u4ee5)/u.test(normalized))
  }

  private async buildFreshLayoutDraftCommitDecision(
    text: string,
    draft: LayoutDraft,
    mode: Extract<TaskMode, 'full_generate' | 'partial_generate'>,
    fallbackFeasibility: DraftFeasibilityReport | null,
    input: OpenClawBridgeSubmitInput,
  ): Promise<RuntimeDecision> {
    const latestFeasibility = await this.previewLatestLayoutDraftFeasibility(draft, input)
    const effectiveFeasibility = latestFeasibility ?? fallbackFeasibility
    const blockedSegments = effectiveFeasibility?.segments.filter((segment) => (
      segment.status === 'blocked' && this.hasConcreteDraftSegmentRequirement(draft, segment.segmentId)
    )) ?? []

    if (blockedSegments.length > 0 && effectiveFeasibility) {
      const blockedText = blockedSegments
        .map((segment) => `${segment.startTime}-${segment.endTime} ${segment.label}`)
        .join('\uFF1B')
      return {
        kind: 'layout_draft',
        feedback: {
          content: `\u5f53\u524d\u7248\u9762\u8349\u6848\u8fd8\u6709 ${blockedSegments.length} \u4e2a\u6bb5\u843d\u6ca1\u6709\u53ef\u7528\u8282\u76ee\u652f\u6491\uff0c\u5df2\u4fdd\u7559\u8349\u6848\uff0c\u4e0d\u4f1a\u8fdb\u5165\u6b63\u5f0f\u7f16\u6392\u3002${blockedText ? `\u8bf7\u8c03\u6574\uff1a${blockedText}` : ''}`,
          processType: 'planning',
          processTypeLabel: '\u7248\u9762\u8349\u6848\u5f85\u8c03\u6574',
          explanation: '\u5f00\u59cb\u7f16\u6392\u524d\u5df2\u6309\u6700\u65b0\u8282\u76ee\u5355\u91cd\u65b0\u9884\u68c0\uff0c\u53d1\u73b0\u8349\u6848\u5b58\u5728\u4e0d\u53ef\u7f16\u6392\u6bb5\u843d\uff0c\u5df2\u963b\u6b62\u63d0\u4ea4\u6b63\u5f0f\u7f16\u6392\u3002',
          details: {
            draftId: draft.id,
            layoutSource: draft.source,
            feasibilitySummary: effectiveFeasibility.summary,
            blockedSegments,
          },
        },
        draft,
        feasibilityReport: effectiveFeasibility,
        orchestrationMode: mode,
      }
    }

    return {
      kind: 'layout_commit',
      feedback: {
        content: '\u5df2\u786e\u8ba4\u5f53\u524d\u7248\u9762\u8349\u6848\uff0c\u51c6\u5907\u6309\u8be5\u7248\u9762\u5f00\u59cb\u7f16\u6392\u3002',
        processType: 'planning',
        processTypeLabel: '\u7248\u9762\u8349\u6848\u786e\u8ba4',
        explanation: '\u7528\u6237\u786e\u8ba4\u5f53\u524d\u5f85\u786e\u8ba4\u7248\u9762\u8349\u6848\uff0c\u51c6\u5907\u8fdb\u5165\u6b63\u5f0f\u7f16\u6392\u3002',
        details: {
          draftId: draft.id,
          layoutSource: draft.source,
        },
      },
      draft,
      orchestrationRequest: {
        userInput: text,
        mode,
        reasoning: '\u7528\u6237\u786e\u8ba4\u5f53\u524d\u5f85\u786e\u8ba4\u7248\u9762\u8349\u6848\uff0c\u51c6\u5907\u8fdb\u5165\u6b63\u5f0f\u7f16\u6392\u3002',
        layoutDraft: draft,
      },
    }
  }

  private async previewLatestLayoutDraftFeasibility(
    draft: LayoutDraft,
    input: Pick<OpenClawBridgeSubmitInput, 'channelId' | 'date' | 'currentSchedule'>,
  ): Promise<DraftFeasibilityReport> {
    const historyReference = await this.dataService.getRecentScheduleReference(input.channelId, input.date)
    return this.layoutDraftFeasibilityService.previewFeasibility(
      draft,
      this.buildCurrentScheduleSnapshots(input.currentSchedule, input.date),
      historyReference,
    )
  }

  private buildCurrentScheduleSnapshots(items: RuntimeScheduleItem[], date: string): ScheduleItemSnapshot[] {
    return items.map((item, index) => ({
      id: item.id,
      programCode: item.programCode ?? item.id,
      programName: item.programName ?? item.id,
      startTime: this.normalizeRuntimeTime(date, item.startTime),
      endTime: this.normalizeRuntimeTime(date, item.endTime),
      duration: item.duration ?? this.resolveDurationSeconds(date, item.startTime, item.endTime),
      programType: item.programType ?? 'unknown',
      sequence: index + 1,
    }))
  }

  private normalizeRuntimeTime(date: string, value: string): string {
    return value.includes('T') ? value : `${date}T${value}+08:00`
  }

  private resolveDurationSeconds(date: string, startTime: string, endTime: string): number {
    const start = new Date(this.normalizeRuntimeTime(date, startTime)).getTime()
    const end = new Date(this.normalizeRuntimeTime(date, endTime)).getTime()
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0
    return Math.floor((end - start) / 1000)
  }


  private hasConcreteDraftSegmentRequirement(draft: LayoutDraft, segmentId: string): boolean {
    const index = draft.layoutReference.slots.findIndex((slot) => slot.id === segmentId)
    const column = index >= 0 ? draft.columns[index] : undefined
    if (!column) return false
    const specificKeywords = extractSpecificSearchKeywords(column.queryHints ?? [])
    const sequenceRequired = hasExplicitSequenceRequirements(column.queryHints ?? [])
    const editorialRequired = hasEditorialKeywordRequirements(column.queryHints ?? [])
    const functionalRequired = hasFunctionalSearchKeywords(column.queryHints ?? [])
    if (specificKeywords.length === 0 && !sequenceRequired && !editorialRequired && !functionalRequired) return false
    if (!sequenceRequired && !editorialRequired && !functionalRequired && (column.source === 'default' || column.source === 'imported')) {
      const labelKeywords = extractSpecificSearchKeywords([
        column.semanticLabel ?? '',
        column.columnName,
      ])
      if (specificKeywords.every((keyword) => labelKeywords.includes(keyword))) {
        return false
      }
    }
    return true
  }

  private async tryResolvePendingCommandReply(
    sessionId: string,
    pendingCommand: RuntimePendingCommand | undefined,
    text: string,
  ): Promise<OpenClawBridgeResult | null> {
    if (!pendingCommand) return null
    const normalized = text.replace(/\s+/g, '')
    if (/^(\u53d6\u6d88|\u4e0d\u7528\u4e86|\u7b97\u4e86|\u5148\u4e0d\u7528|\u505c\u6b62|\u7ed3\u675f|\u5173\u95ed|\u4e0d\u6267\u884c|\u522b\u5220\u4e86|\u522b\u5220\u9664|\u522b\u52a8|\u4e0d\u7528\u6267\u884c)$/u.test(normalized)) {
      return this.cancel(sessionId)
    }
    if (/^(\u786e\u8ba4|\u786e\u8ba4\u6267\u884c|\u6267\u884c|\u53ef\u4ee5|\u662f\u7684|\u5bf9|\u786e\u8ba4\u5220\u9664|\u5220\u9664\u5427|\u5220\u5427|\u5c31\u8fd9\u6837|\u6ca1\u95ee\u9898)$/u.test(normalized)) {
      return this.confirm(sessionId)
    }
    return null
  }

  async confirm(sessionId: string): Promise<OpenClawBridgeResult> {
    const session = this.requireSession(sessionId)
    if (session.pendingLayoutDraft && session.layoutDraftStatus === 'ready') {
      return this.submitInstruction({
        conversationId: session.conversationId,
        channelId: session.context.channelId,
        channelName: session.context.channelName,
        date: session.context.date,
        text: '确认版面',
        currentSchedule: session.context.currentSchedule,
        gapCount: 0,
        history: [],
        currentLayoutDraft: session.pendingLayoutDraft,
        currentLayoutDraftMode: session.layoutDraftMode,
        currentLayoutDraftFeasibility: session.layoutDraftFeasibility,
        playlistType: session.context.playlistType,
        rotationStrategy: session.context.rotationStrategy,
      })
    }
    const pendingCommand = session.pendingCommand
    if (!pendingCommand) {
      return this.toBridgeResult(this.sessionStore.updateSession(sessionId, {
        status: 'failed',
        summary: '\u5f53\u524d\u6ca1\u6709\u5f85\u786e\u8ba4\u547d\u4ee4',
      }))
    }

    const executed = await this.runtimeFacade.executePendingCommand({
      pendingCommand,
      scheduleDate: session.context.date,
      channelId: session.context.channelId,
    })

    const nextState = this.updateSessionFromExecution(sessionId, executed)
    return this.toBridgeResult(nextState)
  }

  async selectTarget(sessionId: string, targetId: string): Promise<OpenClawBridgeResult> {
    const session = this.requireSession(sessionId)
    const pendingTargetSelection = this.resolvePendingTargetSelection(session)
    if (!pendingTargetSelection) {
      return this.toBridgeResult(this.sessionStore.updateSession(sessionId, {
        status: 'failed',
        summary: '\u5f53\u524d\u6ca1\u6709\u5f85\u9009\u62e9\u76ee\u6807',
      }))
    }

    const decision = await this.runtimeFacade.resolvePendingTargetSelection({
      channelId: session.context.channelId,
      date: session.context.date,
      scheduleState: {
        channelId: session.context.channelId,
        channelName: session.context.channelName,
        date: session.context.date,
        isEmpty: session.context.currentSchedule.length === 0,
        itemCount: session.context.currentSchedule.length,
        gapCount: 0,
        hasSelectedTimeRange: false,
        playlistType: session.context.playlistType,
        rotationStrategy: session.context.rotationStrategy,
      },
      pendingTargetSelection: {
        ...pendingTargetSelection,
        selectedItemId: targetId,
      },
    })

    if (decision.kind === 'execute_command') {
      const executed = await this.runtimeFacade.executePendingCommand({
        pendingCommand: {
          command: decision.execution.command,
          summary: summarizeExecutionCommand(decision.execution.command),
          successMessage: decision.execution.successMessage,
          reasoning: decision.execution.explanation || '',
          details: decision.execution.details,
        },
        scheduleDate: session.context.date,
        channelId: session.context.channelId,
      })
      const executedState = this.updateSessionFromExecution(sessionId, executed)
      return this.toBridgeResult(executedState)
    }

    const nextState = this.updateSessionFromDecision(sessionId, decision, pendingTargetSelection.summary)
    return this.toBridgeResult(nextState)
  }

  async selectInsertRecommendation(sessionId: string, candidateId: string): Promise<OpenClawBridgeResult> {
    const session = this.requireSession(sessionId)
    const pendingInsertRecommendation = this.resolvePendingInsertRecommendation(session)
    if (!pendingInsertRecommendation) {
      return this.toBridgeResult(this.sessionStore.updateSession(sessionId, {
        status: 'failed',
        summary: '\u5f53\u524d\u6ca1\u6709\u5f85\u786e\u8ba4\u7684\u63d2\u5165\u63a8\u8350',
      }))
    }

    const decision = await this.runtimeFacade.resolvePendingInsertRecommendation({
      scheduleState: {
        channelId: session.context.channelId,
        channelName: session.context.channelName,
        date: session.context.date,
        isEmpty: session.context.currentSchedule.length === 0,
        itemCount: session.context.currentSchedule.length,
        gapCount: 0,
        hasSelectedTimeRange: false,
        playlistType: session.context.playlistType,
        rotationStrategy: session.context.rotationStrategy,
      },
      pendingInsertRecommendation: {
        ...pendingInsertRecommendation,
        selectedCandidateId: candidateId,
      },
    })

    if (decision.kind === 'execute_command') {
      const executed = await this.runtimeFacade.executePendingCommand({
        pendingCommand: {
          command: decision.execution.command,
          summary: summarizeExecutionCommand(decision.execution.command),
          successMessage: decision.execution.successMessage,
          reasoning: decision.execution.explanation || '',
          details: decision.execution.details,
        },
        scheduleDate: session.context.date,
        channelId: session.context.channelId,
      })
      const executedState = this.updateSessionFromExecution(sessionId, executed)
      return this.toBridgeResult(executedState)
    }

    const nextState = this.updateSessionFromDecision(sessionId, decision, pendingInsertRecommendation.summary)
    return this.toBridgeResult(nextState)
  }

  async cancel(sessionId: string): Promise<OpenClawBridgeResult> {
    const nextState = this.sessionStore.updateSession(sessionId, {
      status: 'cancelled',
      summary: '\u5df2\u53d6\u6d88\u5f53\u524d\u4f1a\u8bdd\u4e2d\u7684\u5f85\u5904\u7406\u64cd\u4f5c',
      lastExecution: undefined,
      pendingCommand: undefined,
      pendingAtomicContext: undefined,
      pendingLayoutDraft: undefined,
      layoutDraftStatus: undefined,
      layoutDraftMode: undefined,
      layoutDraftFeasibility: undefined,
    })
    return this.toBridgeResult(nextState)
  }

  getSessionState(sessionId: string): RuntimeBridgeSessionState | null {
    return this.sessionStore.getSession(sessionId)
  }

  clearLayoutDraft(sessionId: string): RuntimeBridgeSessionState {
    return this.sessionStore.clearLayoutDraft(sessionId)
  }

  findSessionByConversationId(conversationId: string): RuntimeBridgeSessionState | null {
    return this.sessionStore.findSessionByConversationId(conversationId)
  }

  subscribe(sessionId: string, listener: (state: RuntimeBridgeSessionState) => void): () => void {
    return this.sessionStore.subscribe(sessionId, listener)
  }

  private requireSession(sessionId: string): RuntimeBridgeSessionState {
    const session = this.sessionStore.getSession(sessionId)
    if (!session) {
      throw new Error(`\u672a\u627e\u5230\u6865\u63a5\u4f1a\u8bdd ${sessionId}`)
    }
    return session
  }

  private resolvePendingAtomicContext(session: RuntimeBridgeSessionState) {
    return session.pendingAtomicContext
      ? this.pendingAtomicContextService.initialize(session.pendingAtomicContext)
      : null
  }

  private resolvePendingAtomicClarification(session: RuntimeBridgeSessionState) {
    if (!session.pendingAtomicContext) return null
    return rehydratePendingAtomicClarificationFromAtomicContext(session.pendingAtomicContext)
  }

  private resolvePendingTargetSelection(session: RuntimeBridgeSessionState) {
    if (!session.pendingAtomicContext) return null
    return rehydratePendingTargetSelectionFromAtomicContext(session.pendingAtomicContext)
  }

  private resolvePendingInsertRecommendation(session: RuntimeBridgeSessionState) {
    if (!session.pendingAtomicContext) return null
    return rehydratePendingInsertRecommendationFromAtomicContext(session.pendingAtomicContext)
  }

  private updateSessionFromDecision(sessionId: string, decision: RuntimeDecision, fallbackSummary: string): RuntimeBridgeSessionState {
    switch (decision.kind) {
      case 'agent_execution':
        return this.sessionStore.updateSession(sessionId, {
          status: 'completed',
          summary: decision.feedback.content || fallbackSummary,
          lastDecision: decision,
          lastExecution: undefined,
          pendingCommand: undefined,
          pendingAtomicContext: undefined,
          pendingLayoutDraft: undefined,
          layoutDraftStatus: undefined,
          layoutDraftMode: undefined,
          layoutDraftFeasibility: undefined,
        })
      case 'pending_atomic_context':
        return this.sessionStore.updateSession(sessionId, {
          status: resolveStatusFromAtomicContext(decision.pendingAtomicContext),
          summary: decision.feedback.content || fallbackSummary,
          lastDecision: decision,
          lastExecution: undefined,
          pendingCommand: undefined,
          pendingAtomicContext: this.pendingAtomicContextService.initialize(decision.pendingAtomicContext),
          pendingLayoutDraft: undefined,
          layoutDraftStatus: undefined,
          layoutDraftMode: undefined,
          layoutDraftFeasibility: undefined,
        })
      case 'message':
        return this.sessionStore.updateSession(sessionId, {
          status: resolveStatusFromMessageDecision(decision),
          summary: decision.feedback.content || fallbackSummary,
          lastDecision: decision,
          lastExecution: undefined,
          pendingCommand: undefined,
          pendingAtomicContext: decision.pendingAtomicClarification
            ? this.pendingAtomicContextService.initialize(
                buildPendingAtomicContextFromClarification(decision.pendingAtomicClarification),
              )
            : undefined,
          pendingLayoutDraft: undefined,
          layoutDraftStatus: undefined,
          layoutDraftMode: undefined,
          layoutDraftFeasibility: undefined,
        })
      case 'pending_command':
        return this.sessionStore.updateSession(sessionId, {
          status: 'needs_confirmation',
          summary: decision.feedback.content || decision.pendingCommand.summary,
          lastDecision: decision,
          lastExecution: undefined,
          pendingCommand: decision.pendingCommand,
          pendingAtomicContext: undefined,
          pendingLayoutDraft: undefined,
          layoutDraftStatus: undefined,
          layoutDraftMode: undefined,
          layoutDraftFeasibility: undefined,
        })
      case 'pending_target_selection':
        return this.sessionStore.updateSession(sessionId, {
          status: 'needs_selection',
          summary: decision.feedback.content || decision.pendingTargetSelection.summary,
          lastDecision: decision,
          lastExecution: undefined,
          pendingCommand: undefined,
          pendingAtomicContext: this.pendingAtomicContextService.initialize(
            buildPendingAtomicContextFromTargetSelection(decision.pendingTargetSelection),
          ),
          pendingLayoutDraft: undefined,
          layoutDraftStatus: undefined,
          layoutDraftMode: undefined,
          layoutDraftFeasibility: undefined,
        })
      case 'pending_insert_recommendation':
        return this.sessionStore.updateSession(sessionId, {
          status: 'needs_selection',
          summary: decision.feedback.content || decision.pendingInsertRecommendation.summary,
          lastDecision: decision,
          lastExecution: undefined,
          pendingCommand: undefined,
          pendingAtomicContext: this.pendingAtomicContextService.initialize(
            buildPendingAtomicContextFromInsertRecommendation(decision.pendingInsertRecommendation),
          ),
          pendingLayoutDraft: undefined,
          layoutDraftStatus: undefined,
          layoutDraftMode: undefined,
          layoutDraftFeasibility: undefined,
        })
      case 'execute_command':
        return this.sessionStore.updateSession(sessionId, {
          status: 'in_progress',
          summary: decision.execution.successMessage || summarizeExecutionCommand(decision.execution.command),
          lastDecision: decision,
          lastExecution: undefined,
          pendingCommand: undefined,
          pendingAtomicContext: undefined,
          pendingLayoutDraft: undefined,
          layoutDraftStatus: undefined,
          layoutDraftMode: undefined,
          layoutDraftFeasibility: undefined,
        })
      case 'orchestration':
        return this.sessionStore.updateSession(sessionId, {
          status: 'accepted',
          summary: decision.feedback.content || fallbackSummary,
          lastDecision: decision,
          lastExecution: undefined,
          pendingCommand: undefined,
          pendingAtomicContext: undefined,
          pendingLayoutDraft: undefined,
          layoutDraftStatus: undefined,
          layoutDraftMode: undefined,
          layoutDraftFeasibility: undefined,
        })
      case 'layout_draft':
        return this.sessionStore.updateSession(sessionId, {
          status: 'accepted',
          summary: decision.feedback.content || fallbackSummary,
          lastDecision: decision,
          lastExecution: undefined,
          pendingCommand: undefined,
          pendingAtomicContext: undefined,
          pendingLayoutDraft: decision.draft,
          layoutDraftStatus: 'ready',
          layoutDraftMode: decision.orchestrationMode,
          layoutDraftFeasibility: decision.feasibilityReport,
        })
      case 'layout_draft_clear':
        return this.sessionStore.updateSession(sessionId, {
          status: 'cancelled',
          summary: decision.feedback.content || fallbackSummary,
          lastDecision: decision,
          lastExecution: undefined,
          pendingCommand: undefined,
          pendingAtomicContext: undefined,
          pendingLayoutDraft: undefined,
          layoutDraftStatus: undefined,
          layoutDraftMode: undefined,
          layoutDraftFeasibility: undefined,
        })
      case 'layout_commit':
        return this.sessionStore.updateSession(sessionId, {
          status: 'accepted',
          summary: decision.feedback.content || fallbackSummary,
          lastDecision: decision,
          lastExecution: undefined,
          pendingCommand: undefined,
          pendingAtomicContext: undefined,
          pendingLayoutDraft: undefined,
          layoutDraftStatus: undefined,
          layoutDraftMode: undefined,
          layoutDraftFeasibility: undefined,
        })
    }
  }

  private updateSessionFromExecution(sessionId: string, executed: RuntimeExecutedResult): RuntimeBridgeSessionState {
    return this.sessionStore.updateSession(sessionId, {
      status: executed.success ? 'completed' : 'failed',
      summary: executed.message,
      lastExecution: executed,
      pendingCommand: undefined,
      pendingAtomicContext: undefined,
      pendingLayoutDraft: undefined,
      layoutDraftStatus: undefined,
      layoutDraftMode: undefined,
      layoutDraftFeasibility: undefined,
    })
  }

  private toBridgeResult(state: RuntimeBridgeSessionState): OpenClawBridgeResult {
    return {
      sessionId: state.sessionId,
      status: state.status,
      summary: state.summary,
      message: state.lastExecution?.message,
      payload: {
        conversationId: state.conversationId,
        compatibility: {
          sourceOfTruth: 'pendingAtomicContext',
          legacyPendingPayloads: true,
        },
        pendingCommand: state.pendingCommand,
        pendingTargetSelection: this.resolvePendingTargetSelection(state),
        pendingInsertRecommendation: this.resolvePendingInsertRecommendation(state),
        pendingAtomicClarification: this.resolvePendingAtomicClarification(state),
        pendingAtomicContext: this.resolvePendingAtomicContext(state),
        pendingLayoutDraft: state.pendingLayoutDraft,
        layoutDraftStatus: state.layoutDraftStatus,
        layoutDraftMode: state.layoutDraftMode,
        layoutDraftFeasibility: state.layoutDraftFeasibility,
        agentCapabilities: resolveAgentCapabilities(state.lastDecision),
        agentOperationalReadiness: resolveAgentOperationalReadiness(state.lastDecision),
        agentAuditSummary: resolveAgentAuditSummary(state.lastDecision),
        agentQueryResult: resolveAgentQueryResult(state.lastDecision),
        agentValidationReport: resolveAgentValidationReport(state.lastDecision),
        agentPendingLlmContext: resolveAgentPendingLlmContext(state),
        agentLlmContextUsed: resolveAgentLlmContextUsed(state.lastDecision),
        lastDecisionKind: state.lastDecision?.kind,
      },
    }
  }
}

const resolveAgentCapabilities = (
  decision?: RuntimeDecision,
): SchedulingAgentRuntimeCapabilitySummary | undefined => {
  if (!decision || !('feedback' in decision)) return undefined
  const details = decision.feedback.details
  const capabilitySummary = details?.agentCapabilities
  return isAgentCapabilitySummary(capabilitySummary) ? capabilitySummary : undefined
}

const resolveAgentOperationalReadiness = (
  decision?: RuntimeDecision,
): SchedulingAgentOperationalReadinessAudit | undefined => {
  if (!decision || !('feedback' in decision)) return undefined
  const details = decision.feedback.details
  const readiness = details?.agentOperationalReadiness
  return isAgentOperationalReadiness(readiness) ? readiness : undefined
}

const resolveAgentAuditSummary = (
  decision?: RuntimeDecision,
): AgentAuditSummary | undefined => {
  if (!decision || !('feedback' in decision)) return undefined
  const details = decision.feedback.details
  const auditSummary = details?.auditSummary
  return isAgentAuditSummary(auditSummary) ? auditSummary : undefined
}

const resolveAgentQueryResult = (
  decision?: RuntimeDecision,
): AgentQueryResult | undefined => {
  if (!decision || !('feedback' in decision)) return undefined
  const details = decision.feedback.details
  const queryResult = details?.queryResult
  return isAgentQueryResult(queryResult) ? queryResult : undefined
}

const resolveAgentValidationReport = (
  decision?: RuntimeDecision,
): AgentValidationReport | undefined => {
  if (!decision || !('feedback' in decision)) return undefined
  const details = decision.feedback.details
  const validationReport = details?.validationReport
  return isAgentValidationReport(validationReport) ? validationReport : undefined
}

const resolveAgentPendingLlmContext = (
  state: RuntimeBridgeSessionState,
): AgentPendingLlmContext | undefined => {
  const pendingTask = state.pendingAtomicContext?.agentPendingTask
  return pendingTask ? buildPendingLlmContext(pendingTask, '') : undefined
}

const resolveAgentLlmContextUsed = (
  decision?: RuntimeDecision,
): AgentPendingLlmContext | undefined => {
  if (!decision || !('feedback' in decision)) return undefined
  const details = decision.feedback.details
  const trace = Array.isArray(details?.trace) ? details.trace : []
  const contexts = trace
    .map((step) => toDetailRecord(step)?.detail)
    .map((detail) => toDetailRecord(detail)?.pendingLlmContext)
    .filter(isAgentPendingLlmContext)
  return contexts.at(-1)
}

const isAgentCapabilitySummary = (value: unknown): value is SchedulingAgentRuntimeCapabilitySummary => {
  if (!value || typeof value !== 'object') return false
  const record = value as Partial<SchedulingAgentRuntimeCapabilitySummary>
  return Array.isArray(record.capabilityIds)
    && Array.isArray(record.commandPolicies)
    && Array.isArray(record.dataRequirements)
    && Array.isArray(record.safetyGates)
}

const isAgentOperationalReadiness = (value: unknown): value is SchedulingAgentOperationalReadinessAudit => {
  if (!value || typeof value !== 'object') return false
  const record = value as Partial<SchedulingAgentOperationalReadinessAudit>
  return typeof record.status === 'string'
    && typeof record.executablePercent === 'number'
    && Array.isArray(record.sourceCoverage)
    && Array.isArray(record.commandReadiness)
    && Array.isArray(record.gaps)
}

const isAgentAuditSummary = (value: unknown): value is AgentAuditSummary => {
  if (!value || typeof value !== 'object') return false
  const record = value as Partial<AgentAuditSummary>
  return typeof record.outcome === 'string'
    && typeof record.title === 'string'
    && Array.isArray(record.keyPoints)
    && Array.isArray(record.warnings)
    && Array.isArray(record.blockers)
    && Array.isArray(record.professionalSignals)
    && Array.isArray(record.evidenceChain)
    && Boolean(record.operation)
    && Boolean(record.llmUsage)
}

const isAgentQueryResult = (value: unknown): value is AgentQueryResult => {
  if (!value || typeof value !== 'object') return false
  const record = value as Partial<AgentQueryResult>
  return typeof record.kind === 'string'
    && typeof record.queryText === 'string'
    && typeof record.playlistType === 'string'
    && typeof record.totalCount === 'number'
    && Array.isArray(record.scheduleItems)
    && Array.isArray(record.candidates)
}

const isAgentValidationReport = (value: unknown): value is AgentValidationReport => {
  if (!value || typeof value !== 'object') return false
  const record = value as Partial<AgentValidationReport>
  return typeof record.ok === 'boolean'
    && Array.isArray(record.issues)
}

const isAgentPendingLlmContext = (value: unknown): value is AgentPendingLlmContext => {
  if (!value || typeof value !== 'object') return false
  const record = value as Partial<AgentPendingLlmContext>
  const pendingContext = toDetailRecord(record.pendingContext)
  if (!pendingContext) return false
  return typeof pendingContext.phase === 'string'
    && typeof pendingContext.intent === 'string'
    && typeof pendingContext.originalInput === 'string'
    && typeof pendingContext.collectedInput === 'string'
    && typeof pendingContext.attemptCount === 'number'
    && typeof pendingContext.maxAttempts === 'number'
    && typeof pendingContext.collectedSlots === 'object'
    && Array.isArray(pendingContext.missingSlots)
    && typeof record.latestUserInput === 'string'
    && Array.isArray(record.allowedActions)
}

const toDetailRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' ? value as Record<string, unknown> : undefined

const buildBridgeScheduleState = (input: OpenClawBridgeSubmitInput): ScheduleState => ({
  channelId: input.channelId,
  channelName: input.channelName,
  date: input.date,
  isEmpty: input.currentSchedule.length === 0,
  itemCount: input.currentSchedule.length,
  gapCount: input.gapCount ?? 0,
  hasSelectedTimeRange: false,
  playlistType: input.playlistType,
  rotationStrategy: input.rotationStrategy,
})

const summarizeExecutionCommand = (command: RuntimePendingCommand['command']): string => {
  switch (command.action) {
    case 'delete':
      return '\u5220\u9664\u5df2\u7f16\u6392\u8282\u76ee'
    case 'replace':
      return '\u66ff\u6362\u5df2\u7f16\u6392\u8282\u76ee'
    case 'move':
      return '\u4fee\u6539\u8282\u76ee\u5f00\u59cb\u65f6\u95f4'
    case 'insert':
      return '\u63d2\u5165\u8282\u76ee'
    default:
      return `\u6267\u884c ${command.action} \u547d\u4ee4`
  }
}

const resolveStatusFromMessageDecision = (
  decision: Extract<RuntimeDecision, { kind: 'message' }>,
): BridgeRuntimeStatus => {
  if (decision.statusHint) return decision.statusHint
  if (decision.pendingAtomicClarification) return 'needs_clarification'
  return 'completed'
}

const resolveStatusFromAtomicContext = (
  pendingAtomicContext: NonNullable<RuntimeBridgeSessionState['pendingAtomicContext']>,
): BridgeRuntimeStatus => {
  if (pendingAtomicContext.agentPendingTask?.phase === 'needs_confirmation') {
    return 'needs_confirmation'
  }
  if (pendingAtomicContext.agentPendingTask?.phase === 'needs_selection') {
    return 'needs_selection'
  }
  switch (pendingAtomicContext.phase) {
    case 'clarifying':
      return 'needs_clarification'
    case 'selecting_target':
    case 'recommending_insert':
      return 'needs_selection'
  }
}

let globalOpenClawBridge: OpenClawBridge | null = null

export function getOpenClawBridge(): OpenClawBridge {
  if (!globalOpenClawBridge) {
    globalOpenClawBridge = new OpenClawBridge()
  }
  return globalOpenClawBridge
}
