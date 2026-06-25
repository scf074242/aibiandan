import type { AgentRuntimeStatus, AgentTraceRecorder, AgentTraceStep } from './types'

export class DefaultAgentTraceRecorder implements AgentTraceRecorder {
  private readonly steps: AgentTraceStep[] = []
  private readonly startedAt = Date.now()

  constructor(private readonly onRecord?: (step: AgentTraceStep) => void) {}

  record(status: AgentRuntimeStatus, label: string, detail?: Record<string, unknown>): void {
    const step = {
      status,
      label,
      detail,
      timestamp: new Date().toISOString(),
      elapsedMs: Date.now() - this.startedAt,
      sequence: this.steps.length + 1,
    }
    this.steps.push(step)
    this.onRecord?.(step)
  }

  getTrace(): AgentTraceStep[] {
    return [...this.steps]
  }
}
