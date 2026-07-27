import type {
  RuntimeExecutePendingCommandInput,
  RuntimeExecutedResult,
} from './schedulingAgentRuntimeFacade'
import {
  buildFormalPlaylistWriteArtifacts,
  type FormalPlaylistPatch,
  type FormalPlaylistSnapshot,
} from './formalPlaylistState'
import {
  assertMutationAllowed,
  PreviewOnlyViolationError,
  PendingOnlyViolationError,
  type MutationContext,
} from '@/services/agent/mutationPolicy'

type VersionValue = string | number

export interface FormalPlaylistWriteContext {
  sessionId?: string
  workspaceKey?: string
  transport?: 'local' | 'agent-server'
  actualPlaylistVersion?: VersionValue | null
  currentSnapshot?: FormalPlaylistSnapshot | null
  /**
   * Mutation 策略上下文（方向 1 D2 写屏障）。
   * 传入后 execute 入口会调用 assertMutationAllowed 校验：
   * - preview_only 时拒绝写入并返回 blocked 结果
   * - pending_only 时拒绝写入正式播单并返回 blocked 结果
   * - formal_write 时放行
   * 未传入时保持原有行为（向后兼容）。
   */
  mutationContext: MutationContext
}

export interface FormalPlaylistWriteMetadata {
  boundary: 'formal-playlist-write-adapter'
  transport: 'local' | 'agent-server'
  writeRunId: string
  status: 'applied' | 'failed' | 'blocked' | 'reused'
  reused: boolean
  sessionId?: string
  workspaceKey?: string
  pendingId?: string
  idempotencyKey?: string
  foregroundStateVersion?: VersionValue
  expectedPlaylistVersion?: VersionValue
  actualPlaylistVersion?: VersionValue
  batch?: {
    commandCount: number
    completedCount?: number
    remainingCount?: number
    nextIndex?: number
    maxBatchCommands?: number
    requiresContinuation?: boolean
  }
  playlistPatch?: FormalPlaylistPatch
}

export interface FormalPlaylistWriteAdapterOptions {
  executePendingCommand: (input: RuntimeExecutePendingCommandInput) => Promise<RuntimeExecutedResult>
  prepareSnapshotForExecution?: (snapshot: FormalPlaylistSnapshot) => void | Promise<void>
  createRunId?: () => string
}

const createDefaultRunId = (): string => `formal_write_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

const hasVersionValue = (value: unknown): value is VersionValue => (
  typeof value === 'string' || typeof value === 'number'
)

const stringifyVersion = (value: VersionValue): string => String(value)

const buildBatchMetadata = (input: RuntimeExecutePendingCommandInput): FormalPlaylistWriteMetadata['batch'] | undefined => {
  const commandCount = input.pendingCommand.commands?.length ?? 1
  if (commandCount <= 1 && !input.batchCursor) return undefined
  return {
    commandCount,
    completedCount: input.batchCursor?.completedCount,
    remainingCount: input.batchCursor?.remainingCount,
    nextIndex: input.batchCursor?.nextIndex,
    maxBatchCommands: input.maxBatchCommands,
    requiresContinuation: typeof input.maxBatchCommands === 'number' && commandCount > input.maxBatchCommands,
  }
}

const buildMetadata = (
  input: RuntimeExecutePendingCommandInput,
  context: FormalPlaylistWriteContext | undefined,
  overrides: Pick<FormalPlaylistWriteMetadata, 'writeRunId' | 'status' | 'reused'> & {
    playlistPatch?: FormalPlaylistPatch
  },
): FormalPlaylistWriteMetadata => ({
  boundary: 'formal-playlist-write-adapter',
  transport: context?.transport ?? 'agent-server',
  sessionId: context?.sessionId,
  workspaceKey: context?.workspaceKey ?? context?.mutationContext?.workspaceKey,
  pendingId: input.pendingId,
  idempotencyKey: input.idempotencyKey ?? input.pendingId ?? input.pendingCommand.pendingId,
  foregroundStateVersion: input.foregroundStateVersion,
  expectedPlaylistVersion: input.expectedPlaylistVersion,
  actualPlaylistVersion: context?.actualPlaylistVersion ?? undefined,
  batch: buildBatchMetadata(input),
  ...overrides,
})

const withFormalWriteDetails = (
  result: RuntimeExecutedResult,
  formalWrite: FormalPlaylistWriteMetadata,
): RuntimeExecutedResult => ({
  ...result,
  playlistPatch: formalWrite.playlistPatch ?? result.playlistPatch,
  details: {
    ...result.details,
    formalWrite,
  },
})

export class FormalPlaylistWriteAdapter {
  private readonly executeDelegate: FormalPlaylistWriteAdapterOptions['executePendingCommand']
  private readonly prepareSnapshotForExecution?: FormalPlaylistWriteAdapterOptions['prepareSnapshotForExecution']
  private readonly createRunId: () => string
  private readonly completedByIdempotencyKey = new Map<string, RuntimeExecutedResult>()
  private readonly inFlightByIdempotencyKey = new Map<string, Promise<RuntimeExecutedResult>>()

  constructor(options: FormalPlaylistWriteAdapterOptions) {
    this.executeDelegate = options.executePendingCommand
    this.prepareSnapshotForExecution = options.prepareSnapshotForExecution
    this.createRunId = options.createRunId ?? createDefaultRunId
  }

  async execute(
    input: RuntimeExecutePendingCommandInput,
    context: FormalPlaylistWriteContext,
  ): Promise<RuntimeExecutedResult> {
    if (!context.mutationContext) {
      return withFormalWriteDetails({
        success: false,
        command: input.pendingCommand.command,
        message: '正式写入缺少 mutation policy，已拒绝执行。',
        error: 'mutation_policy_required',
        summary: input.pendingCommand.summary,
        thinking: '写屏障拦截：正式播单写入必须显式声明 mutation policy。',
        explanation: 'FormalPlaylistWriteAdapter requires mutationContext for every formal write.',
        details: {
          mutationPolicy: null,
          mutationId: null,
        },
      }, buildMetadata(input, context, {
        writeRunId: this.createRunId(),
        status: 'blocked',
        reused: false,
      }))
    }

    // 写屏障校验：preview_only / pending_only 违反时返回 blocked 结果，不抛错。
    {
      try {
        assertMutationAllowed(context.mutationContext, 'formal')
      } catch (error) {
        const isKnownViolation = error instanceof PreviewOnlyViolationError
          || error instanceof PendingOnlyViolationError
        const policyLabel = context.mutationContext.policy === 'preview_only' ? '预览' : '待确认'
        return withFormalWriteDetails({
          success: false,
          command: input.pendingCommand.command,
          message: `当前为${policyLabel}模式，不能写入正式播单。`,
          error: isKnownViolation ? `${context.mutationContext.policy}_violation` : 'mutation_policy_violation',
          summary: input.pendingCommand.summary,
          thinking: `写屏障拦截：${context.mutationContext.policy} 模式下不能写入正式播单。`,
          explanation: error instanceof Error ? error.message : String(error),
          details: {
            mutationPolicy: context.mutationContext.policy,
            mutationId: context.mutationContext.mutationId,
          },
        }, buildMetadata(input, context, {
          writeRunId: this.createRunId(),
          status: 'blocked',
          reused: false,
        }))
      }
    }

    const cacheKey = this.resolveIdempotencyCacheKey(input, context)
    if (cacheKey) {
      const previous = this.completedByIdempotencyKey.get(cacheKey)
      if (previous) {
        const priorFormalWrite = previous.details?.formalWrite as FormalPlaylistWriteMetadata | undefined
        return withFormalWriteDetails(previous, {
          ...buildMetadata(input, context, {
            writeRunId: priorFormalWrite?.writeRunId ?? this.createRunId(),
            status: 'reused',
            reused: true,
          }),
        })
      }
      const inFlight = this.inFlightByIdempotencyKey.get(cacheKey)
      if (inFlight) {
        const previous = await inFlight
        const priorFormalWrite = previous.details?.formalWrite as FormalPlaylistWriteMetadata | undefined
        return withFormalWriteDetails(previous, {
          ...buildMetadata(input, context, {
            writeRunId: priorFormalWrite?.writeRunId ?? this.createRunId(),
            status: 'reused',
            reused: true,
          }),
        })
      }
    }

    const conflict = this.resolveVersionConflict(input, context)
    if (conflict) {
      return withFormalWriteDetails({
        success: false,
        command: input.pendingCommand.command,
        message: '当前播单已经变化，请刷新后重新确认。',
        error: 'formal_playlist_version_conflict',
        summary: input.pendingCommand.summary,
        thinking: '正式写入前发现播单版本不一致，已停止本次写入。',
        explanation: input.pendingCommand.reasoning,
        details: {
          expectedPlaylistVersion: conflict.expectedPlaylistVersion,
          actualPlaylistVersion: conflict.actualPlaylistVersion,
        },
      }, buildMetadata(input, context, {
        writeRunId: this.createRunId(),
        status: 'blocked',
        reused: false,
      }))
    }

    const batchLimitBlock = this.resolveBatchLimitBlock(input, context)
    if (batchLimitBlock) {
      return batchLimitBlock
    }

    if (context.currentSnapshot && this.prepareSnapshotForExecution) {
      try {
        await this.prepareSnapshotForExecution(context.currentSnapshot)
      } catch (error) {
        return withFormalWriteDetails({
          success: false,
          command: input.pendingCommand.command,
          message: '正式写入前同步播单状态失败，请稍后重试。',
          error: 'formal_playlist_snapshot_prepare_failed',
          summary: input.pendingCommand.summary,
          thinking: '正式写入前未能把服务端播单快照同步到执行器，已停止本次写入。',
          explanation: (error as Error).message,
          details: {
            prepareError: (error as Error).message,
          },
        }, buildMetadata(input, context, {
          writeRunId: this.createRunId(),
          status: 'failed',
          reused: false,
        }))
      }
    }

    const delegatePromise = this.executeDelegate(input)
    if (cacheKey) this.inFlightByIdempotencyKey.set(cacheKey, delegatePromise)
    let result: RuntimeExecutedResult
    try {
      result = await delegatePromise
    } finally {
      if (cacheKey && this.inFlightByIdempotencyKey.get(cacheKey) === delegatePromise) {
        this.inFlightByIdempotencyKey.delete(cacheKey)
      }
    }
    const artifacts = buildFormalPlaylistWriteArtifacts(input, result, context.currentSnapshot)
    const resultWithMetadata = withFormalWriteDetails(result, buildMetadata(input, context, {
      writeRunId: this.createRunId(),
      status: result.success ? 'applied' : 'failed',
      reused: false,
      playlistPatch: artifacts?.patch,
    }))
    const resultWithSnapshot = artifacts
      ? {
          ...resultWithMetadata,
          scheduleSnapshot: artifacts.snapshot,
          playlistPatch: artifacts.patch,
        }
      : resultWithMetadata

    // 只有已成功应用的正式写入才具备可安全复用的幂等结果。
    // 失败/阻断结果必须允许用户沿用同一 mutation 重试，不能把临时故障固化进缓存。
    if (cacheKey && resultWithSnapshot.success) {
      this.completedByIdempotencyKey.set(cacheKey, resultWithSnapshot)
    }
    return resultWithSnapshot
  }

  private resolveIdempotencyCacheKey(
    input: RuntimeExecutePendingCommandInput,
    context: FormalPlaylistWriteContext,
  ): string | null {
    const idempotencyKey = input.idempotencyKey ?? input.pendingId ?? input.pendingCommand.pendingId
    if (!idempotencyKey) return null
    const workspaceKey = context.workspaceKey ?? context.mutationContext?.workspaceKey ?? 'workspace:unknown'
    return JSON.stringify([
      context.sessionId ?? 'anonymous',
      workspaceKey,
      idempotencyKey,
    ])
  }

  private resolveVersionConflict(
    input: RuntimeExecutePendingCommandInput,
    context: FormalPlaylistWriteContext,
  ): { expectedPlaylistVersion: VersionValue; actualPlaylistVersion: VersionValue } | null {
    if (!hasVersionValue(input.expectedPlaylistVersion) || !hasVersionValue(context.actualPlaylistVersion)) {
      return null
    }
    if (stringifyVersion(input.expectedPlaylistVersion) === stringifyVersion(context.actualPlaylistVersion)) {
      return null
    }
    return {
      expectedPlaylistVersion: input.expectedPlaylistVersion,
      actualPlaylistVersion: context.actualPlaylistVersion,
    }
  }

  private resolveBatchLimitBlock(
    input: RuntimeExecutePendingCommandInput,
    context: FormalPlaylistWriteContext,
  ): RuntimeExecutedResult | null {
    const commandCount = input.pendingCommand.commands?.length ?? 1
    if (typeof input.maxBatchCommands !== 'number' || commandCount <= input.maxBatchCommands) {
      return null
    }
    return withFormalWriteDetails({
      success: false,
      command: input.pendingCommand.command,
      message: `这次包含 ${commandCount} 条操作，建议分批确认后执行。`,
      error: 'formal_playlist_batch_limit_exceeded',
      summary: input.pendingCommand.summary,
      thinking: '正式写入边界发现批量操作超过本次允许的执行数量，已停在写入前。',
      explanation: input.pendingCommand.reasoning,
      details: {
        commandCount,
        maxBatchCommands: input.maxBatchCommands,
      },
    }, buildMetadata(input, context, {
      writeRunId: this.createRunId(),
      status: 'blocked',
      reused: false,
    }))
  }
}
