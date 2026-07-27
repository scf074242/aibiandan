import type { AgentLlmStreamEvent, AgentLlmStreamObserver } from '@/services/agent/agentLlmStreaming'
import type { RuntimeProgressEvent } from './demoRuntimeFacade'

const stageLabel = (stage: AgentLlmStreamEvent['stage']) => (
  stage === 'candidate_judge' ? '候选决策' : stage === 'planner' ? '编排计划' : '理解需求'
)

const nextStepLabel = (stage: AgentLlmStreamEvent['stage'], kind: AgentLlmStreamEvent['kind']) => {
  if (kind === 'structured_invalid') return '本轮停止，等待你重试或补充信息。'
  if (stage === 'planner') return '计划完成后会继续检查草案、候选和正式写入边界。'
  if (stage === 'candidate_judge') return '候选结果完整后才会进入写入边界。'
  return '意图完整后才会进入对应能力。'
}

const firstTokenContent = (stage: AgentLlmStreamEvent['stage']) => {
  if (stage === 'planner') return '正在整理可执行的编排步骤，随后会检查当前播单和执行边界。'
  if (stage === 'candidate_judge') return '正在比较候选节目，选定后还会经过业务门禁。'
  return '正在理解你的需求，确认完整后再进入对应操作。'
}

const tokenDeltaContent = (stage: AgentLlmStreamEvent['stage']) => {
  if (stage === 'planner') return '正在继续完善编排步骤。'
  if (stage === 'candidate_judge') return '正在继续比较候选节目。'
  return '正在继续梳理你的需求。'
}

export function createAgentLlmStreamProgressEmitter(input: {
  playlistKey: string
  onProgress?: (event: RuntimeProgressEvent) => void
  throttleMs?: number
}): AgentLlmStreamObserver {
  const lastDeltaAt = new Map<AgentLlmStreamEvent['stage'], number>()
  const throttleMs = input.throttleMs ?? 400

  return (event) => {
    if (!input.onProgress) return
    // 完整结构只推进内部状态机；最终业务反馈会说明真实执行结果。
    if (event.kind === 'structured_complete') return
    if (event.kind === 'token_delta') {
      const previousAt = lastDeltaAt.get(event.stage) ?? 0
      if (event.elapsedMs - previousAt < throttleMs) return
      lastDeltaAt.set(event.stage, event.elapsedMs)
    }

    const label = stageLabel(event.stage)
    const content = event.kind === 'first_token'
      ? firstTokenContent(event.stage)
      : event.kind === 'token_delta'
        ? tokenDeltaContent(event.stage)
        : `${label}结果没有形成有效结构，本轮不会据此执行；${nextStepLabel(event.stage, event.kind)}`
    const progressStage = event.kind === 'first_token'
      ? 'llm_first_token'
      : event.kind === 'token_delta'
        ? 'llm_token_delta'
        : event.kind

    input.onProgress({
      id: `agent-llm-stream:${input.playlistKey}:${event.stage}:${event.kind}:${event.sequence}`,
      content,
      processType: event.kind === 'structured_invalid' ? 'error' : 'planning',
      processTypeLabel: label,
      details: {
        progressStage,
        streamId: `agent-llm-stream:${input.playlistKey}:${event.stage}`,
        streamMode: 'replace',
        stage: event.stage,
        sequence: event.sequence,
        receivedChars: event.receivedChars,
        elapsedMs: event.elapsedMs,
        firstTokenLatencyMs: event.firstTokenLatencyMs,
        nextStep: nextStepLabel(event.stage, event.kind),
        noMutation: true,
      },
    })
  }
}
