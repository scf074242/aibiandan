import type { LlmFailureInfo, LlmFailureReason, LlmFailureStage } from '@/types/orchestration'

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return ''
}

const resolveFailureReason = (message: string): LlmFailureReason => {
  const normalized = message.toLowerCase()
  if (/超时|timeout|timed out|aborted/.test(normalized)) return 'timeout'
  if (/network|fetch|econn|socket|dns|连接|网络/.test(normalized)) return 'network'
  if (/not initialized|not configured|api key|configuration|配置|密钥/.test(normalized)) return 'unavailable'
  return 'unknown'
}

const buildVisibleMessage = (reason: LlmFailureReason): string => {
  if (reason === 'timeout') return '模型这次没有及时返回。'
  if (reason === 'network') return '模型服务这次没有连上。'
  if (reason === 'unavailable') return '模型服务现在还不能正常使用。'
  return '模型服务这次没有正常返回。'
}

export const buildLlmFailureInfo = (stage: LlmFailureStage, error: unknown): LlmFailureInfo => {
  const rawMessage = getErrorMessage(error)
  const reason = resolveFailureReason(rawMessage)
  return {
    stage,
    reason,
    message: buildVisibleMessage(reason),
    rawMessage: rawMessage || undefined,
    canRetry: true,
  }
}

export class RecoverableLlmError extends Error {
  readonly llmFailure: LlmFailureInfo

  constructor(llmFailure: LlmFailureInfo, cause?: unknown) {
    super(llmFailure.message)
    this.name = 'RecoverableLlmError'
    this.llmFailure = llmFailure
    if (cause !== undefined) {
      ;(this as Error & { cause?: unknown }).cause = cause
    }
  }
}

export const createRecoverableLlmError = (
  stage: LlmFailureStage,
  error: unknown,
): RecoverableLlmError => new RecoverableLlmError(buildLlmFailureInfo(stage, error), error)

export const isRecoverableLlmError = (error: unknown): error is RecoverableLlmError => (
  error instanceof RecoverableLlmError
  || (
    typeof error === 'object'
    && error !== null
    && 'llmFailure' in error
  )
)
