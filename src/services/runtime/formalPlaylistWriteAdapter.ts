import type {
  RuntimeExecutePendingCommandInput,
  RuntimeExecutedResult,
} from './schedulingAgentRuntimeFacade'

type VersionValue = string | number

export interface FormalPlaylistWriteContext {
  sessionId?: string
  actualPlaylistVersion?: VersionValue | null
}

export interface FormalPlaylistWriteMetadata {
  boundary: 'agent-server'
  writeRunId: string
  status: 'applied' | 'failed' | 'blocked' | 'reused'
  reused: boolean
  sessionId?: string
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
  }
}

export interface FormalPlaylistWriteAdapterOptions {
  executePendingCommand: (input: RuntimeExecutePendingCommandInput) => Promise<RuntimeExecutedResult>
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
  }
}

const buildMetadata = (
  input: RuntimeExecutePendingCommandInput,
  context: FormalPlaylistWriteContext | undefined,
  overrides: Pick<FormalPlaylistWriteMetadata, 'writeRunId' | 'status' | 'reused'>,
): FormalPlaylistWriteMetadata => ({
  boundary: 'agent-server',
  sessionId: context?.sessionId,
  pendingId: input.pendingId,
  idempotencyKey: input.idempotencyKey,
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
  details: {
    ...(result.details ?? {}),
    formalWrite,
  },
})

export class FormalPlaylistWriteAdapter {
  private readonly executeDelegate: FormalPlaylistWriteAdapterOptions['executePendingCommand']
  private readonly createRunId: () => string
  private readonly completedByIdempotencyKey = new Map<string, RuntimeExecutedResult>()

  constructor(options: FormalPlaylistWriteAdapterOptions) {
    this.executeDelegate = options.executePendingCommand
    this.createRunId = options.createRunId ?? createDefaultRunId
  }

  async execute(
    input: RuntimeExecutePendingCommandInput,
    context: FormalPlaylistWriteContext = {},
  ): Promise<RuntimeExecutedResult> {
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

    const result = await this.executeDelegate(input)
    const resultWithMetadata = withFormalWriteDetails(result, buildMetadata(input, context, {
      writeRunId: this.createRunId(),
      status: result.success ? 'applied' : 'failed',
      reused: false,
    }))

    if (cacheKey) {
      this.completedByIdempotencyKey.set(cacheKey, resultWithMetadata)
    }
    return resultWithMetadata
  }

  private resolveIdempotencyCacheKey(
    input: RuntimeExecutePendingCommandInput,
    context: FormalPlaylistWriteContext,
  ): string | null {
    if (!input.idempotencyKey) return null
    return `${context.sessionId ?? 'anonymous'}:${input.idempotencyKey}`
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
}
