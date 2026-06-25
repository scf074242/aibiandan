import type {
  RiskAssessment,
  RiskLevel,
  ScheduleState,
  TaskClassification,
} from '@/types/orchestration'
import type { ForegroundAgentContextPackage } from '@/services/runtime/foregroundAgentContextPackage'
import type { LLMClient } from './llmClient'

export interface TaskClassifierInput {
  scheduleState: ScheduleState
  userInput: string
  history?: string[]
  contextPackage?: ForegroundAgentContextPackage
}

export interface TaskClassifierConfig {
  confidenceThreshold: number
  defaultMode: TaskClassification['mode']
  enableClarification: boolean
}

export class TaskClassifier {
  constructor(
    _llmClient: LLMClient,
    private readonly config: Partial<TaskClassifierConfig> = {},
  ) {}

  async classify(input: TaskClassifierInput): Promise<TaskClassification> {
    const userIntent = input.userInput.trim()
    return {
      mode: this.config.defaultMode ?? 'clarify',
      confidence: 0,
      reasoning: 'LLM-only 理解层已启用；旧任务分类器只保留接口壳，不再参与自然语言理解。',
      suggestedParams: userIntent ? { userIntent } : undefined,
    }
  }

  assessRisk(input: TaskClassifierInput): RiskAssessment {
    const normalized = input.userInput.replace(/\s+/g, '')
    const factors: string[] = []
    let level: RiskLevel = 'low'

    if (/(全部|所有|整天|全天|批量)/u.test(normalized)) {
      factors.push('涉及较大范围的批量操作')
      level = 'high'
    }

    if (/(删除|清空|覆盖|重排|重新编排)/u.test(normalized)) {
      factors.push('包含高影响操作')
      level = 'high'
    }

    return {
      level,
      factors: factors.length > 0 ? factors : ['未发现明显高风险因素'],
    }
  }
}

let globalClassifier: TaskClassifier | null = null

export function getTaskClassifier(llmClient?: LLMClient): TaskClassifier {
  if (!globalClassifier) {
    if (!llmClient) {
      throw new Error('LLM client is required for first initialization')
    }
    globalClassifier = new TaskClassifier(llmClient)
  }
  return globalClassifier
}

export function resetTaskClassifier(): void {
  globalClassifier = null
}
