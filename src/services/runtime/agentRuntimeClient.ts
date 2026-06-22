import {
  getSchedulingAgentRuntimeFacade,
  summarizeRuntimeCommand,
  type RuntimeAnalysisContext,
  type RuntimeDecision,
  type RuntimeExecutePendingCommandInput,
  type RuntimeExecutedResult,
  type RuntimeFeedback,
  type RuntimeOrchestrationRequest,
  type RuntimePendingCommand,
  type RuntimeResolveInsertRecommendationInput,
  type RuntimeResolveTargetSelectionInput,
  type RuntimeScheduleItem,
  type RuntimeSubmitInput,
} from './schedulingAgentRuntimeFacade'

export {
  summarizeRuntimeCommand,
  type RuntimeAnalysisContext,
  type RuntimeDecision,
  type RuntimeExecutePendingCommandInput,
  type RuntimeExecutedResult,
  type RuntimeFeedback,
  type RuntimeOrchestrationRequest,
  type RuntimePendingCommand,
  type RuntimeResolveInsertRecommendationInput,
  type RuntimeResolveTargetSelectionInput,
  type RuntimeScheduleItem,
  type RuntimeSubmitInput,
}

export interface AgentRuntimeClient {
  submitInstruction(input: RuntimeSubmitInput): Promise<RuntimeDecision>
  executePendingCommand(input: RuntimeExecutePendingCommandInput): Promise<RuntimeExecutedResult>
  resolvePendingTargetSelection(input: RuntimeResolveTargetSelectionInput): Promise<RuntimeDecision>
  resolvePendingInsertRecommendation(input: RuntimeResolveInsertRecommendationInput): Promise<RuntimeDecision>
}

export type AgentRuntimeMode = 'local' | 'http'

type RuntimeEnvelope<T> = {
  sessionId?: string
  decision?: T
  result?: T
}

const HTTP_SESSION_STORAGE_KEY = 'aibiandan_agent_session_id'

const readViteEnv = (key: string): string | undefined => {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env
  return env?.[key]
}

export function resolveAgentRuntimeMode(): AgentRuntimeMode {
  const mode = readViteEnv('VITE_AGENT_RUNTIME_MODE')?.trim().toLowerCase()
  return mode === 'http' || mode === 'server' ? 'http' : 'local'
}

export function isHttpAgentRuntimeEnabled(): boolean {
  return resolveAgentRuntimeMode() === 'http'
}

const resolveAgentRuntimeBaseUrl = (): string => (
  readViteEnv('VITE_AGENT_RUNTIME_BASE_URL')?.replace(/\/$/, '')
  ?? (typeof window !== 'undefined' && window.location?.hostname
    ? `${window.location.protocol}//${window.location.hostname}:3000`
    : 'http://127.0.0.1:3000')
)

export class LocalAgentRuntimeClient implements AgentRuntimeClient {
  private readonly runtime = getSchedulingAgentRuntimeFacade()

  submitInstruction(input: RuntimeSubmitInput): Promise<RuntimeDecision> {
    return this.runtime.submitInstruction(input)
  }

  executePendingCommand(input: RuntimeExecutePendingCommandInput): Promise<RuntimeExecutedResult> {
    return this.runtime.executePendingCommand(input)
  }

  resolvePendingTargetSelection(input: RuntimeResolveTargetSelectionInput): Promise<RuntimeDecision> {
    return this.runtime.resolvePendingTargetSelection(input)
  }

  resolvePendingInsertRecommendation(input: RuntimeResolveInsertRecommendationInput): Promise<RuntimeDecision> {
    return this.runtime.resolvePendingInsertRecommendation(input)
  }
}

export class HttpAgentRuntimeClient implements AgentRuntimeClient {
  private sessionId: string | null = this.readStoredSessionId()

  constructor(private readonly baseUrl: string = resolveAgentRuntimeBaseUrl()) {}

  async submitInstruction(input: RuntimeSubmitInput): Promise<RuntimeDecision> {
    const { foregroundContextPackage: _foregroundContextPackage, ...serverInput } = input
    const envelope = await this.post<RuntimeEnvelope<RuntimeDecision>>('/api/agent/submit', {
      sessionId: this.sessionId,
      input: serverInput,
    })
    this.syncSession(envelope.sessionId)
    if (!envelope.decision) throw new Error('Agent server did not return a runtime decision.')
    return envelope.decision
  }

  async executePendingCommand(input: RuntimeExecutePendingCommandInput): Promise<RuntimeExecutedResult> {
    const {
      pendingCommand,
      currentSchedule: _currentSchedule,
      ...restInput
    } = input
    const envelope = await this.post<RuntimeEnvelope<RuntimeExecutedResult>>('/api/agent/pending/execute', {
      sessionId: this.sessionId,
      input: {
        ...restInput,
        pendingId: input.pendingId ?? pendingCommand.pendingId,
      },
    })
    this.syncSession(envelope.sessionId)
    if (!envelope.result) throw new Error('Agent server did not return a pending command result.')
    return envelope.result
  }

  async resolvePendingTargetSelection(input: RuntimeResolveTargetSelectionInput): Promise<RuntimeDecision> {
    const {
      pendingTargetSelection,
      ...restInput
    } = input
    const envelope = await this.post<RuntimeEnvelope<RuntimeDecision>>('/api/agent/pending/target-selection', {
      sessionId: this.sessionId,
      input: {
        ...restInput,
        pendingId: pendingTargetSelection.pendingId,
        selectedItemId: pendingTargetSelection.selectedItemId,
      },
    })
    this.syncSession(envelope.sessionId)
    if (!envelope.decision) throw new Error('Agent server did not return a target-selection decision.')
    return envelope.decision
  }

  async resolvePendingInsertRecommendation(input: RuntimeResolveInsertRecommendationInput): Promise<RuntimeDecision> {
    const {
      pendingInsertRecommendation,
      currentSchedule: _currentSchedule,
      ...restInput
    } = input
    const envelope = await this.post<RuntimeEnvelope<RuntimeDecision>>('/api/agent/pending/insert-recommendation', {
      sessionId: this.sessionId,
      input: {
        ...restInput,
        pendingId: pendingInsertRecommendation.pendingId,
        selectedCandidateId: pendingInsertRecommendation.selectedCandidateId,
      },
    })
    this.syncSession(envelope.sessionId)
    if (!envelope.decision) throw new Error('Agent server did not return an insert-recommendation decision.')
    return envelope.decision
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    })
    if (!response.ok) {
      const message = await response.text().catch(() => '')
      throw new Error(message || `Agent server request failed: ${response.status}`)
    }
    return await response.json() as T
  }

  private syncSession(sessionId?: string): void {
    if (sessionId) {
      this.sessionId = sessionId
      this.writeStoredSessionId(sessionId)
    }
  }

  private readStoredSessionId(): string | null {
    if (typeof sessionStorage === 'undefined') return null
    return sessionStorage.getItem(HTTP_SESSION_STORAGE_KEY)
  }

  private writeStoredSessionId(sessionId: string): void {
    if (typeof sessionStorage === 'undefined') return
    sessionStorage.setItem(HTTP_SESSION_STORAGE_KEY, sessionId)
  }
}

let globalAgentRuntimeClient: AgentRuntimeClient | null = null

export function getAgentRuntimeClient(): AgentRuntimeClient {
  if (!globalAgentRuntimeClient) {
    globalAgentRuntimeClient = isHttpAgentRuntimeEnabled()
      ? new HttpAgentRuntimeClient()
      : new LocalAgentRuntimeClient()
  }
  return globalAgentRuntimeClient
}

export function setAgentRuntimeClientForTests(client: AgentRuntimeClient | null): void {
  globalAgentRuntimeClient = client
}
