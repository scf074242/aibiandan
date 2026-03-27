import type { InsertCommand, QueryCandidatesCommand } from '@/types/orchestration'
import type { DialogueContext } from './dialogueContext'
import type { InsertParams } from './paramExtractor'

export interface InsertQueryContext {
  queryCommand: QueryCandidatesCommand
  searchParams: {
    channelId: string
    channelName: string
    programName: string
    targetTime: string
  }
}

export class EntityLinker {
  createInsertQuery(context: DialogueContext, params: InsertParams): InsertQueryContext {
    return {
      queryCommand: {
        action: 'query_candidates',
        reasoning: '已根据当前频道和节目名生成候选检索命令，下一步将调用节目检索接口。',
        data: {
          gapId: `insert-${params.targetTime}`,
          criteria: {
            targetTimeRange: {
              start: `${context.scheduleState.date}T${params.targetTime}`,
              end: `${context.scheduleState.date}T${params.targetTime}`,
            },
            expectedDuration: {
              min: 60,
              max: 4 * 3600,
            },
            channelId: context.scheduleState.channelId,
            columnId: '',
            excludeUsed: false,
            programTypePreference: ['news', 'variety', 'drama', 'documentary'],
          },
        },
      },
      searchParams: {
        channelId: context.scheduleState.channelId,
        channelName: context.scheduleState.channelName,
        programName: params.programName,
        targetTime: params.targetTime,
      },
    }
  }

  createInsertCommand(context: DialogueContext, params: InsertParams, candidateId: string, candidateName: string): InsertCommand {
    return {
      action: 'insert',
      reasoning: '已基于候选检索结果选择目标节目，待你确认后通过原子能力层执行插入。',
      data: {
        candidateId,
        candidateName,
        insertTime: params.targetTime,
        scheduleDate: context.scheduleState.date,
        channelId: context.scheduleState.channelId,
      },
    }
  }
}

let globalEntityLinker: EntityLinker | null = null

export function getEntityLinker(): EntityLinker {
  if (!globalEntityLinker) {
    globalEntityLinker = new EntityLinker()
  }
  return globalEntityLinker
}
