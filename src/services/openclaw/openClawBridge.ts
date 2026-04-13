import {
  getDemoRuntimeFacade,
  type RuntimeDecision,
  type RuntimeExecutedResult,
  type RuntimePendingCommand,
  type RuntimePendingTargetSelection,
  type RuntimeScheduleItem,
} from '@/services/runtime/demoRuntimeFacade'
import {
  getRuntimeSessionStore,
  type BridgeRuntimeStatus,
  type RuntimeBridgeSessionState,
} from '@/services/runtime/runtimeSessionStore'
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
  payload?: Record<string, unknown>
}

export class OpenClawBridge {
  private readonly runtimeFacade = getDemoRuntimeFacade()
  private readonly sessionStore = getRuntimeSessionStore()

  async submitInstruction(input: OpenClawBridgeSubmitInput): Promise<OpenClawBridgeResult> {
    const session = this.sessionStore.upsertSessionForConversation({
      conversationId: input.conversationId,
      channelId: input.channelId,
      channelName: input.channelName,
      date: input.date,
      currentSchedule: input.currentSchedule,
    })

    const decision = await this.runtimeFacade.submitInstruction({
      scheduleState: buildBridgeScheduleState(input),
      userInput: input.text,
      currentSchedule: input.currentSchedule,
      currentLayoutDraft: session.pendingLayoutDraft ?? null,
      currentLayoutDraftMode: session.layoutDraftMode ?? null,
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
    const pendingTargetSelection = session.pendingTargetSelection
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

  async cancel(sessionId: string): Promise<OpenClawBridgeResult> {
    const nextState = this.sessionStore.updateSession(sessionId, {
      status: 'cancelled',
      summary: '已取消当前会话中的待处理操作',
      lastExecution: undefined,
      pendingCommand: undefined,
      pendingTargetSelection: undefined,
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

  private updateSessionFromDecision(sessionId: string, decision: RuntimeDecision, fallbackSummary: string): RuntimeBridgeSessionState {
    switch (decision.kind) {
      case 'message':
      return this.sessionStore.updateSession(sessionId, {
        status: resolveStatusFromFeedback(decision.feedback.content),
        summary: decision.feedback.content || fallbackSummary,
        lastDecision: decision,
        lastExecution: undefined,
        pendingCommand: undefined,
        pendingTargetSelection: undefined,
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
        pendingTargetSelection: undefined,
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
        pendingTargetSelection: decision.pendingTargetSelection,
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
        pendingTargetSelection: undefined,
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
        pendingTargetSelection: undefined,
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
        pendingTargetSelection: undefined,
        pendingLayoutDraft: decision.draft,
        layoutDraftStatus: 'ready',
        layoutDraftMode: decision.orchestrationMode,
        layoutDraftFeasibility: decision.feasibilityReport,
      })
      case 'layout_commit':
      return this.sessionStore.updateSession(sessionId, {
        status: 'accepted',
        summary: decision.feedback.content || fallbackSummary,
        lastDecision: decision,
        lastExecution: undefined,
        pendingCommand: undefined,
        pendingTargetSelection: undefined,
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
      pendingTargetSelection: undefined,
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
        pendingCommand: state.pendingCommand,
        pendingTargetSelection: state.pendingTargetSelection,
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

const resolveStatusFromFeedback = (content: string): BridgeRuntimeStatus => {
  if (content.includes('不能完全确定') || content.includes('请明确')) return 'needs_clarification'
  if (content.includes('执行异常') || content.includes('失败')) return 'failed'
  if (content.includes('校验完成') || content.includes('校验通过')) return 'completed'
  return 'completed'
}

let globalOpenClawBridge: OpenClawBridge | null = null

export function getOpenClawBridge(): OpenClawBridge {
  if (!globalOpenClawBridge) {
    globalOpenClawBridge = new OpenClawBridge()
  }
  return globalOpenClawBridge
}
