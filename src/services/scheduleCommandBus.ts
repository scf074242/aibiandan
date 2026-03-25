import type { OrchestrationCommand, ValidationReport } from '@/types/orchestration'
import { getCommandExecutor } from './commandExecutor'
import { getInsertCommandExecutor } from './insertCommandExecutor'
import { getReplaceCommandExecutor } from './replaceCommandExecutor'
import { getScheduleValidationService } from './scheduleValidationService'

export interface CommandBusContext {
  scheduleDate: string
  channelId: string
}

export interface CommandBusResult {
  success: boolean
  message: string
  validationReport?: ValidationReport
  error?: string
}

export class ScheduleCommandBus {
  validate(context: CommandBusContext): ValidationReport {
    return getScheduleValidationService().validateCurrentSchedule(context.scheduleDate, context.channelId)
  }

  async execute(command: OrchestrationCommand, context: CommandBusContext): Promise<CommandBusResult> {
    const result =
      command.action === 'insert'
        ? await getInsertCommandExecutor().execute(command)
        : command.action === 'replace'
          ? await getReplaceCommandExecutor().execute(command, context)
        : await getCommandExecutor().execute(command)

    const validationReport =
      result.validationReport ?? getScheduleValidationService().validateCurrentSchedule(context.scheduleDate, context.channelId)

    return {
      success: result.success,
      message: result.message,
      error: result.error,
      validationReport,
    }
  }

  async executeBatch(commands: OrchestrationCommand[], context: CommandBusContext): Promise<CommandBusResult> {
    let lastMessage = '未执行命令'

    for (const command of commands) {
      const result = await this.execute(command, context)
      lastMessage = result.message
      if (!result.success) {
        return result
      }
    }

    return {
      success: true,
      message: lastMessage,
      validationReport: getScheduleValidationService().validateCurrentSchedule(context.scheduleDate, context.channelId),
    }
  }
}

let globalScheduleCommandBus: ScheduleCommandBus | null = null

export function getScheduleCommandBus(): ScheduleCommandBus {
  if (!globalScheduleCommandBus) {
    globalScheduleCommandBus = new ScheduleCommandBus()
  }
  return globalScheduleCommandBus
}
