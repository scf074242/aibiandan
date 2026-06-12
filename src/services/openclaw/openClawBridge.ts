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
import type { DraftFeasibilityReport, LayoutDraft, TaskMode } from '@/types/orchestration'
import type { ScheduleState } from '@/types/orchestration'

export interface OpenClawBridgeSubmitInput {
  conversationId: string
  channelId: string
  channelName: string
  date: string
  text: string
  currentSchedule: RuntimeScheduleItem[]
  gapCount?: number
  history?: string[]
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

  async submitInstruction(input: OpenClawBridgeSubmitInput): Promise<OpenClawBridgeResult> {
    const session = this.sessionStore.upsertSessionForConversation({
      conversationId: input.conversationId,
      channelId: input.channelId,
      channelName: input.channelName,
      date: input.date,
      currentSchedule: input.currentSchedule,
    })

    const pendingCommandDecision = await this.tryResolvePendingCommandReply(session.sessionId, session.pendingCommand, input.text)
    if (pendingCommandDecision) {
      return pendingCommandDecision
    }

    const pendingAtomicContext = this.resolvePendingAtomicContext(session)

    const decision = await this.runtimeFacade.submitInstruction({
      scheduleState: buildBridgeScheduleState(input),
      userInput: input.text,
      currentSchedule: input.currentSchedule,
      currentLayoutDraft: session.pendingLayoutDraft ?? null,
      currentLayoutDraftMode: session.layoutDraftMode ?? null,
      pendingTargetSelection: null,
      pendingInsertRecommendation: null,
      pendingAtomicClarification: this.resolvePendingAtomicClarification(session),
      pendingAtomicContext,
      history: input.history,
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

  private async tryResolvePendingCommandReply(
    sessionId: string,
    pendingCommand: RuntimePendingCommand | undefined,
    text: string,
  ): Promise<OpenClawBridgeResult | null> {
    if (!pendingCommand) return null
    const normalized = text.replace(/\s+/g, '')
    if (/^(取消|不用了|算了|先不用|停止|结束|关闭|不执行|别删了|别删除)$/.test(normalized)) {
      return this.cancel(sessionId)
    }
    if (/^(确认|确认执行|执行|可以|是的|对|确认删除|删除吧|删吧|就这样)$/.test(normalized)) {
      return this.confirm(sessionId)
    }
    return null
  }

  async confirm(sessionId: string): Promise<OpenClawBridgeResult> {
    const session = this.requireSession(sessionId)
    const pendingCommand = session.pendingCommand
    if (!pendingCommand) {
      return this.toBridgeResult(this.sessionStore.updateSession(sessionId, {
        status: 'failed',
        summary: '当前没有待确认命令',
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
        summary: '当前没有待选择目标',
      }))
    }

    const decision = await this.runtimeFacade.resolvePendingTargetSelection({
      channelId: session.context.channelId,
      date: session.context.date,
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
        summary: '当前没有待确认的插入推荐',
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
      summary: '已取消当前会话中的待处理操作',
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
      throw new Error(`未找到桥接会话 ${sessionId}`)
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
        lastDecisionKind: state.lastDecision?.kind,
      },
    }
  }
}

const buildBridgeScheduleState = (input: OpenClawBridgeSubmitInput): ScheduleState => ({
  channelId: input.channelId,
  channelName: input.channelName,
  date: input.date,
  isEmpty: input.currentSchedule.length === 0,
  itemCount: input.currentSchedule.length,
  gapCount: input.gapCount ?? 0,
  hasSelectedTimeRange: false,
})

const summarizeExecutionCommand = (command: RuntimePendingCommand['command']): string => {
  switch (command.action) {
    case 'delete':
      return '删除已编排节目'
    case 'replace':
      return '替换已编排节目'
    case 'move':
      return '修改节目开始时间'
    case 'insert':
      return '插入节目'
    default:
      return `执行 ${command.action} 命令`
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
