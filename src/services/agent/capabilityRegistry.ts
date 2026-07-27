import type { AgentCapability, AgentSubmitInput, CapabilityMetadata } from './types'

/**
 * Capability 路由冲突错误。
 *
 * 当多个 capability 以相同优先级同时命中同一意图时抛出，
 * 携带结构化 envelope 供上层生成 quick replies 或阻断提示。
 */
export class CapabilityRouteConflictError extends Error {
  readonly kind = 'capability_route_conflict'
  readonly intent: string
  readonly playlistType?: string
  readonly capabilityIds: string[]
  readonly envelope: {
    kind: 'capability_route_conflict'
    intent: string
    playlistType?: string
    capabilityIds: string[]
    recognizedSlots: Array<{ capabilityId: string; metadata: CapabilityMetadata | undefined }>
    missingSlots: string[]
    candidateEvidence: Array<{ capabilityId: string; priority: number }>
    retrySuggestions: string[]
  }

  constructor(options: {
    intent: string
    playlistType?: string
    capabilityIds: string[]
    recognizedSlots: Array<{ capabilityId: string; metadata: CapabilityMetadata | undefined }>
    missingSlots: string[]
    candidateEvidence: Array<{ capabilityId: string; priority: number }>
    retrySuggestions: string[]
  }) {
    const message = 'Capability route conflict for intent ' + options.intent + ': ' + options.capabilityIds.join(', ')
    super(message)
    this.name = 'CapabilityRouteConflictError'
    this.intent = options.intent
    this.playlistType = options.playlistType
    this.capabilityIds = options.capabilityIds
    this.envelope = {
      kind: 'capability_route_conflict',
      intent: options.intent,
      playlistType: options.playlistType,
      capabilityIds: options.capabilityIds,
      recognizedSlots: options.recognizedSlots,
      missingSlots: options.missingSlots,
      candidateEvidence: options.candidateEvidence,
      retrySuggestions: options.retrySuggestions,
    }
  }
}

interface RegisteredCapability {
  capability: AgentCapability
  metadata?: CapabilityMetadata
}

/**
 * Capability 注册表。
 *
 * 支持两种路由模式：
 * - 遗留模式：通过 capability.canHandle(input) 过滤
 * - 元数据模式：通过 intent + playlistType 匹配 CapabilityMetadata
 *
 * 元数据模式用于按 intent 拆分原子命令 capability 后的显式路由，
 * 可避免多个子 capability 同时命中同一条指令。
 */
export class CapabilityRegistry {
  private readonly capabilities: RegisteredCapability[] = []

  /**
   * 注册一个 capability。
   *
   * @param capability - 要注册的能力实例
   * @param metadata - 可选的显式元数据；若未提供，则读取 capability.metadata
   */
  register(capability: AgentCapability, metadata?: CapabilityMetadata): void {
    if (this.capabilities.some((registered) => registered.capability.id === capability.id)) {
      throw new Error('Agent capability already registered: ' + capability.id)
    }
    this.capabilities.push({
      capability,
      metadata: metadata ?? capability.metadata,
    })
  }

  /**
   * 列出所有已注册的 capability。
   */
  list(): AgentCapability[] {
    return this.capabilities.map((registered) => registered.capability)
  }

  /**
   * 遗留路由：返回第一个能处理输入的 capability。
   *
   * @param input - Agent 提交输入
   * @returns 命中的 capability，若无则返回 null
   */
  resolve(input: AgentSubmitInput): AgentCapability | null {
    return this.resolveAll(input)[0] ?? null
  }

  /**
   * 路由查询。
   *
   * - 传入 {@link AgentSubmitInput} 时，使用遗留 canHandle 模式，返回所有命中的 capability 列表。
   * - 传入 intent 字符串时，使用 CapabilityMetadata 模式，返回唯一胜出 capability。
   *
   * @param inputOrIntent - 输入对象或意图字符串
   * @param playlistType - 仅在传入 intent 字符串时有效，用于元数据路由
   * @returns 遗留模式下返回 capability 数组；元数据模式下返回唯一 capability
   * @throws {CapabilityRouteConflictError} 元数据模式下出现同优先级冲突时抛出
   */
  resolveAll(input: AgentSubmitInput): AgentCapability[]
  resolveAll(intent: string, playlistType?: string): AgentCapability
  resolveAll(inputOrIntent: AgentSubmitInput | string, playlistType?: string): AgentCapability[] | AgentCapability {
    if (typeof inputOrIntent === 'string') {
      return this.resolveByMetadata(inputOrIntent, playlistType)
    }
    return this.capabilities
      .filter((registered) => registered.capability.canHandle(inputOrIntent))
      .map((registered) => registered.capability)
  }

  /**
   * 获取指定意图下存在路由冲突的所有 capability。
   *
   * @param intent - 原子命令意图
   * @param playlistType - 可选的播单类型
   * @returns 若存在多个同优先级命中 capability 则全部返回，否则返回空数组
   */
  getRouteConflicts(intent: string, playlistType?: string): AgentCapability[] {
    const matches = this.findMetadataMatches(intent, playlistType)
    if (matches.length <= 1) {
      return []
    }
    const sorted = [...matches].sort((a, b) => this.getPriority(b) - this.getPriority(a))
    const highestPriority = this.getPriority(sorted[0]!)
    const tied = sorted.filter((registered) => this.getPriority(registered) === highestPriority)
    return tied.length > 1 ? tied.map((registered) => registered.capability) : []
  }

  private resolveByMetadata(intent: string, playlistType?: string): AgentCapability {
    const matches = this.findMetadataMatches(intent, playlistType)
    if (matches.length === 0) {
      throw new Error('No capability found for intent: ' + intent)
    }
    const sorted = [...matches].sort((a, b) => this.getPriority(b) - this.getPriority(a))
    const highestPriority = this.getPriority(sorted[0]!)
    const tied = sorted.filter((registered) => this.getPriority(registered) === highestPriority)
    if (tied.length > 1) {
      const capabilityIds = tied.map((registered) => registered.capability.id)
      throw new CapabilityRouteConflictError({
        intent,
        playlistType,
        capabilityIds,
        recognizedSlots: tied.map((registered) => ({
          capabilityId: registered.capability.id,
          metadata: registered.metadata,
        })),
        missingSlots: ['distinct_capability_owner'],
        candidateEvidence: tied.map((registered) => ({
          capabilityId: registered.capability.id,
          priority: this.getPriority(registered),
        })),
        retrySuggestions: [
          '请明确指定要使用的原子命令能力',
          '或调整 capability 的 priority 以消除路由冲突',
        ],
      })
    }
    return sorted[0]!.capability
  }

  private findMetadataMatches(intent: string, playlistType?: string): RegisteredCapability[] {
    const normalizedPlaylistType = playlistType ? normalizePlaylistType(playlistType) : undefined
    return this.capabilities.filter((registered) => {
      const metadata = registered.metadata
      if (!metadata) {
        // 遗留 capability 没有元数据时，默认匹配所有意图（保持向后兼容）
        return true
      }
      if (!metadata.intents.includes(intent)) {
        return false
      }
      if (!normalizedPlaylistType) {
        return true
      }
      const types = metadata.playlistTypes ?? ['all']
      return types.includes('all') || types.includes(normalizedPlaylistType as 'tv' | 'carousel' | 'all')
    })
  }

  private getPriority(registered: RegisteredCapability): number {
    return registered.metadata?.priority ?? 0
  }
}

/**
 * 将运行时播单类型归一化为 capability 元数据使用的术语。
 * 当前代码库 PlaylistType 为 'rotation'，元数据层使用 'carousel' 作为同义词。
 */
function normalizePlaylistType(playlistType: string): 'tv' | 'carousel' | undefined {
  if (playlistType === 'rotation') {
    return 'carousel'
  }
  if (playlistType === 'tv' || playlistType === 'carousel') {
    return playlistType
  }
  return undefined
}
