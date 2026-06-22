import type {
  RuntimeDecision,
  RuntimeExecutePendingCommandInput,
  RuntimeExecutedResult,
  RuntimeFeedback,
} from './schedulingAgentRuntimeFacade'
import type { SchedulingTaskRun } from './schedulingTaskPlan'
import type {
  AgentExecutionCheckpoint,
} from './agentServerSessionStore'
import {
  FormalPlaylistWriteAdapter,
  type FormalPlaylistWriteContext,
  type FormalPlaylistWriteMetadata,
} from './formalPlaylistWriteAdapter'
import type { FormalPlaylistSnapshot } from './formalPlaylistState'

export interface AgentServerExecutionOutcome {
  result: RuntimeExecutedResult
  resultSnapshot: FormalPlaylistSnapshot | null
  checkpoint: AgentExecutionCheckpoint | null
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null
)

const createCheckpointId = (): string => `agent_checkpoint_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

const nowIso = (): string => new Date().toISOString()

const getRuntimeDecisionFeedback = (decision: RuntimeDecision): RuntimeFeedback | null => (
  'feedback' in decision ? decision.feedback : null
)

const isSchedulingTaskRun = (value: unknown): value is SchedulingTaskRun => (
  isRecord(value)
  && typeof value.id === 'string'
  && typeof value.goal === 'string'
  && typeof value.status === 'string'
  && Array.isArray(value.stages)
)

const toNumber = (value: unknown): number | undefined => (
  typeof value === 'number' && Number.isFinite(value) ? value : undefined
)

const buildCheckpoint = (
  input: Omit<AgentExecutionCheckpoint, 'id' | 'createdAt' | 'updatedAt' | 'suggestedActions'> & {
    suggestedActions?: string[]
  },
): AgentExecutionCheckpoint => {
  const now = nowIso()
  return {
    id: createCheckpointId(),
    createdAt: now,
    updatedAt: now,
    suggestedActions: input.suggestedActions ?? ['继续', '停止'],
    ...input,
  }
}

export class AgentServerExecutionService {
  constructor(private readonly formalPlaylistWrites: FormalPlaylistWriteAdapter) {}

  async executePendingCommand(
    input: RuntimeExecutePendingCommandInput,
    context: FormalPlaylistWriteContext,
  ): Promise<AgentServerExecutionOutcome> {
    const result = await this.formalPlaylistWrites.execute(input, context)
    return {
      result,
      resultSnapshot: this.resolveResultSnapshot(result),
      checkpoint: this.buildCheckpointFromFormalWrite(input, result),
    }
  }

  extractCheckpointFromDecision(decision: RuntimeDecision): AgentExecutionCheckpoint | null {
    if (decision.kind !== 'agent_execution') return null
    const feedback = getRuntimeDecisionFeedback(decision)
    const details = feedback?.details
    if (!isRecord(details)) return null

    const nextTaskRun = isSchedulingTaskRun(details.nextTaskRun) ? details.nextTaskRun : null
    if (nextTaskRun?.batch) {
      return buildCheckpoint({
        kind: 'composite_task',
        status: 'waiting_continue',
        taskId: nextTaskRun.id,
        summary: `已处理 ${nextTaskRun.batch.processedCount} 条，还剩 ${nextTaskRun.batch.remainingCount} 条，等待继续确认。`,
        completedCount: nextTaskRun.batch.processedCount,
        remainingCount: nextTaskRun.batch.remainingCount,
        batchIndex: nextTaskRun.batch.batchIndex,
        commandCount: nextTaskRun.batch.totalMatched,
        details: {
          goal: nextTaskRun.goal,
          matchKind: nextTaskRun.batch.matchKind,
          targetLabel: nextTaskRun.batch.targetLabel,
        },
      })
    }

    const retryTaskRun = isSchedulingTaskRun(details.retryTaskRun) ? details.retryTaskRun : null
    if (retryTaskRun?.batch) {
      const recovery = isRecord(details.recovery) ? details.recovery : {}
      return buildCheckpoint({
        kind: 'composite_task',
        status: 'failed_retryable',
        taskId: retryTaskRun.id,
        summary: `本批没有完成。前面已处理 ${retryTaskRun.batch.processedCount} 条，还剩 ${retryTaskRun.batch.remainingCount} 条，可以重试或停止。`,
        completedCount: retryTaskRun.batch.processedCount,
        remainingCount: retryTaskRun.batch.remainingCount,
        batchIndex: retryTaskRun.batch.batchIndex,
        commandCount: retryTaskRun.batch.totalMatched,
        lastError: typeof recovery.lastFailure === 'string' ? recovery.lastFailure : undefined,
        suggestedActions: ['继续重试', '停止'],
        details: {
          goal: retryTaskRun.goal,
          matchKind: retryTaskRun.batch.matchKind,
          targetLabel: retryTaskRun.batch.targetLabel,
          recovery,
        },
      })
    }

    const taskRun = isSchedulingTaskRun(details.taskRun) ? details.taskRun : null
    if (taskRun?.batch && taskRun.status === 'completed') {
      return buildCheckpoint({
        kind: 'composite_task',
        status: 'completed',
        taskId: taskRun.id,
        summary: `批量任务已完成，共处理 ${taskRun.batch.processedCount} 条。`,
        completedCount: taskRun.batch.processedCount,
        remainingCount: 0,
        batchIndex: taskRun.batch.batchIndex,
        commandCount: taskRun.batch.totalMatched,
        suggestedActions: [],
        details: {
          goal: taskRun.goal,
          matchKind: taskRun.batch.matchKind,
          targetLabel: taskRun.batch.targetLabel,
        },
      })
    }

    return null
  }

  stopCheckpoint(checkpoint: AgentExecutionCheckpoint): AgentExecutionCheckpoint {
    return {
      ...checkpoint,
      status: 'stopped',
      summary: `${checkpoint.summary.replace(/[，,。.!！?？]+$/u, '')}，已停止后续处理。`,
      suggestedActions: [],
      updatedAt: nowIso(),
    }
  }

  private buildCheckpointFromFormalWrite(
    input: RuntimeExecutePendingCommandInput,
    result: RuntimeExecutedResult,
  ): AgentExecutionCheckpoint | null {
    const formalWrite = result.details?.formalWrite as FormalPlaylistWriteMetadata | undefined
    const batch = formalWrite?.batch
    if (!formalWrite || !batch) return null

    const completedCount = toNumber(batch.completedCount)
    const remainingCount = toNumber(batch.remainingCount)
    const hasRemaining = typeof remainingCount === 'number'
      ? remainingCount > 0
      : batch.requiresContinuation === true
    const status: AgentExecutionCheckpoint['status'] = result.success
      ? hasRemaining ? 'waiting_continue' : 'completed'
      : formalWrite.status === 'blocked' ? 'blocked' : 'failed_retryable'
    return buildCheckpoint({
      kind: 'formal_write_batch',
      status,
      pendingId: input.pendingId ?? input.pendingCommand.pendingId,
      summary: this.formatFormalWriteCheckpointSummary(result, batch, status),
      completedCount,
      remainingCount,
      nextIndex: batch.nextIndex,
      commandCount: batch.commandCount,
      lastError: result.error,
      suggestedActions: status === 'completed'
        ? []
        : status === 'blocked'
          ? ['缩小范围后重新发起', '停止']
          : ['继续', '停止'],
      details: {
        formalWrite,
        commandSummary: input.pendingCommand.summary,
      },
    })
  }

  private formatFormalWriteCheckpointSummary(
    result: RuntimeExecutedResult,
    batch: NonNullable<FormalPlaylistWriteMetadata['batch']>,
    status: AgentExecutionCheckpoint['status'],
  ): string {
    if (status === 'completed') {
      return `本批操作已完成，共处理 ${batch.commandCount} 条。`
    }
    if (status === 'waiting_continue') {
      const completedText = typeof batch.completedCount === 'number' ? `已处理 ${batch.completedCount} 条，` : ''
      const remainingText = typeof batch.remainingCount === 'number' ? `还剩 ${batch.remainingCount} 条` : '还有剩余操作'
      return `${completedText}${remainingText}，等待继续确认。`
    }
    if (status === 'blocked') return result.message
    return `本批执行失败，可以重试或停止。${result.error ? `原因：${result.error}` : ''}`
  }

  private resolveResultSnapshot(result: RuntimeExecutedResult): FormalPlaylistSnapshot | null {
    const snapshot = result.scheduleSnapshot
    if (!snapshot || !isRecord(snapshot)) return null
    if (typeof snapshot.version !== 'string' || !Array.isArray(snapshot.items)) return null
    return snapshot as unknown as FormalPlaylistSnapshot
  }
}
