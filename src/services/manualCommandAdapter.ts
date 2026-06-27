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

  buildInsertCommand(
    item: Pick<ScheduleItem, 'startTime' | 'programCode' | 'code18' | 'programName'>,
    context: ManualCommandContext,
  ): InsertCommand | null {
    const candidateId = item.programCode || item.code18
    if (!candidateId) {
      return null
    }
    return this.buildInsertCommandForCandidate(candidateId, item, context)
  }

  buildInsertCommandForCandidate(
    candidateId: string,
    item: Pick<ScheduleItem, 'startTime' | 'programName'>,
    context: ManualCommandContext,
  ): InsertCommand {
    return {
      action: 'insert',
      reasoning: '人工新增节目，已解析到候选节目，转换为统一插入命令。',
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

    const derivedDuration = this.deriveDuration(updatedItem.startTime, updatedItem.endTime)
    const originalDuration = originalItem.duration ?? this.deriveDuration(originalItem.startTime, originalItem.endTime)
    if (derivedDuration !== originalDuration) {
      commands.push(this.buildUpdateFieldCommand(updatedItem.id, 'duration', derivedDuration))
    }

    if (originalItem.programName !== updatedItem.programName && originalCandidateId === updatedCandidateId) {
      commands.push(this.buildUpdateFieldCommand(updatedItem.id, 'programName', updatedItem.programName || ''))
    }

    if (originalItem.remark !== updatedItem.remark) {
      commands.push(this.buildUpdateFieldCommand(updatedItem.id, 'remark', updatedItem.remark || ''))
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

  private buildUpdateFieldCommand(itemId: string, field: string, value: unknown): UpdateFieldCommand {
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
    return `${scheduleDate}T${normalized}+08:00`
  }

  private deriveDuration(startTime: string, endTime: string): number {
    const start = this.toSeconds(startTime)
    const end = this.toSeconds(endTime)
    return Math.max(60, end - start)
  }

  private toSeconds(timeText: string): number {
    const clock = timeText.includes('T') ? timeText.split('T')[1]?.slice(0, 8) || timeText : timeText
    const [hours = 0, minutes = 0, seconds = 0] = clock.split(':').map(Number)
    return hours * 3600 + minutes * 60 + seconds
  }
}

let globalManualCommandAdapter: ManualCommandAdapter | null = null

export function getManualCommandAdapter(): ManualCommandAdapter {
  if (!globalManualCommandAdapter) {
    globalManualCommandAdapter = new ManualCommandAdapter()
  }
  return globalManualCommandAdapter
}
