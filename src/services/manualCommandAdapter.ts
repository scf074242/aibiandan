import type {
  DeleteCommand,
  InsertCommand,
  MoveCommand,
  OrchestrationCommand,
  ReplaceCommand,
  UpdateFieldCommand,
} from '@/types/orchestration'
import type { ScheduleItem } from '@/views/broadcast-plan/scheduleData'

export interface ManualCommandContext {
  scheduleDate: string
  channelId: string
}

export class ManualCommandAdapter {
  buildDeleteCommand(item: Pick<ScheduleItem, 'id'>): DeleteCommand {
    return {
      action: 'delete',
      reasoning: '人工删除节目，转换为统一删除命令。',
      data: {
        itemId: item.id,
      },
    }
  }

  buildInsertCommand(item: Pick<ScheduleItem, 'startTime' | 'programCode' | 'code18' | 'programName'>, context: ManualCommandContext): InsertCommand | null {
    const candidateId = item.programCode || item.code18
    if (!candidateId) {
      return null
    }

    return {
      action: 'insert',
      reasoning: '人工新增节目，转换为统一插入命令。',
      data: {
        candidateId,
        candidateName: item.programName || '',
        insertTime: item.startTime,
        scheduleDate: context.scheduleDate,
        channelId: context.channelId,
      },
    }
  }

  buildUpdateCommands(originalItem: ScheduleItem, updatedItem: ScheduleItem, context: ManualCommandContext): OrchestrationCommand[] {
    const commands: OrchestrationCommand[] = []

    const originalCandidateId = originalItem.programCode || originalItem.code18 || ''
    const updatedCandidateId = updatedItem.programCode || updatedItem.code18 || ''

    if (originalCandidateId && updatedCandidateId && originalCandidateId !== updatedCandidateId) {
      commands.push(this.buildReplaceCommand(updatedItem.id, updatedCandidateId))
    }

    if (originalItem.startTime !== updatedItem.startTime) {
      commands.push(this.buildMoveCommand(updatedItem.id, updatedItem.startTime, context.scheduleDate))
    }

    if (originalItem.programName !== updatedItem.programName && originalCandidateId === updatedCandidateId) {
      commands.push(this.buildUpdateFieldCommand(updatedItem.id, 'programName', updatedItem.programName))
    }

    if (originalItem.endTime !== updatedItem.endTime) {
      commands.push(this.buildUpdateFieldCommand(updatedItem.id, 'endTime', this.toDateTime(context.scheduleDate, updatedItem.endTime)))
    }

    if (originalItem.duration !== updatedItem.duration) {
      commands.push(this.buildUpdateFieldCommand(updatedItem.id, 'duration', updatedItem.duration))
    }

    return commands
  }

  buildSortSwapCommands(firstItemId: string, firstSortOrder: number, secondItemId: string, secondSortOrder: number): UpdateFieldCommand[] {
    return [
      this.buildUpdateFieldCommand(firstItemId, 'sortOrder', firstSortOrder),
      this.buildUpdateFieldCommand(secondItemId, 'sortOrder', secondSortOrder),
    ]
  }

  private buildMoveCommand(itemId: string, newStartTime: string, scheduleDate: string): MoveCommand {
    return {
      action: 'move',
      reasoning: '人工修改了开始时间，转换为统一移动命令。',
      data: {
        itemId,
        newStartTime: this.toDateTime(scheduleDate, newStartTime),
      },
    }
  }

  private buildReplaceCommand(itemId: string, newCandidateId: string): ReplaceCommand {
    return {
      action: 'replace',
      reasoning: '人工修改了节目引用，转换为统一替换命令。',
      data: {
        itemId,
        newCandidateId,
      },
    }
  }

  private buildUpdateFieldCommand(itemId: string, field: string, value: any): UpdateFieldCommand {
    return {
      action: 'update_field',
      reasoning: `人工修改了字段 ${field}，转换为统一更新命令。`,
      data: {
        itemId,
        field,
        value,
      },
    }
  }

  private toDateTime(scheduleDate: string, timeText: string): string {
    if (timeText.includes('T')) return timeText
    const normalized = timeText.length === 5 ? `${timeText}:00` : timeText
    return `${scheduleDate}T${normalized}`
  }
}

let globalManualCommandAdapter: ManualCommandAdapter | null = null

export function getManualCommandAdapter(): ManualCommandAdapter {
  if (!globalManualCommandAdapter) {
    globalManualCommandAdapter = new ManualCommandAdapter()
  }
  return globalManualCommandAdapter
}
