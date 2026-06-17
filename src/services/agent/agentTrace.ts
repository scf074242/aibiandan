import type { AgentRuntimeStatus, AgentTraceRecorder, AgentTraceStep } from './types'

export class DefaultAgentTraceRecorder implements AgentTraceRecorder {
  private readonly steps: AgentTraceStep[] = []

  record(status: AgentRuntimeStatus, label: string, detail?: Record<string, unknown>): void {
    this.steps.push({
      status,
      label,
      detail,
      timestamp: new Date().toISOString(),
    })
  }

  getTrace(): AgentTraceStep[] {
    return [...this.steps]
  }
}
