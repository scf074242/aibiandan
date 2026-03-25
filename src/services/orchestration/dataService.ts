import {
  demoChannels,
  demoFixedItems,
  demoHistorySchedules,
  demoLayouts,
  demoPrograms,
} from '@/mock/demoData'
import type {
  ChannelContext,
  FixedItem,
  GenerationContext,
  LayoutReference,
  ProgramCandidate,
  ScheduleSummary,
} from '@/types/orchestration'

export interface ChannelInfo {
  id: string
  name: string
  code: string
  timeZone: string
  broadcastRules: {
    defaultStartTime: string
    defaultEndTime: string
    minProgramDuration: number
    maxProgramDuration: number
  }
}

export class DataService {
  private channels = new Map<string, ChannelInfo>()
  private layouts = new Map<string, LayoutReference>()
  private programs = new Map<string, ProgramCandidate>()

  constructor() {
    for (const channel of demoChannels) {
      this.channels.set(channel.id, {
        id: channel.id,
        name: channel.name,
        code: channel.code,
        timeZone: channel.timeZone,
        broadcastRules: {
          defaultStartTime: channel.defaultStartTime,
          defaultEndTime: channel.defaultEndTime,
          minProgramDuration: 60,
          maxProgramDuration: 7200,
        },
      })
    }

    Object.values(demoLayouts).forEach((layout) => {
      this.layouts.set(layout.id.replace('layout_', ''), layout)
    })

    demoPrograms.forEach((program) => {
      this.programs.set(program.programCode, program)
      this.programs.set(program.id, program)
    })
  }

  async getChannelInfo(channelId: string): Promise<ChannelInfo | null> {
    return this.channels.get(channelId) ?? null
  }

  async getAllChannels(): Promise<ChannelInfo[]> {
    return Array.from(this.channels.values())
  }

  async getLayoutReference(channelId: string, date: string): Promise<LayoutReference | null> {
    return demoLayouts[`${channelId}_${date}`] ?? null
  }

  async getLayoutSlots(channelId: string, date: string) {
    return (await this.getLayoutReference(channelId, date))?.slots ?? []
  }

  async getHistorySchedules(channelId: string, date: string): Promise<ScheduleSummary[]> {
    return demoHistorySchedules[`${channelId}_${date}`] ?? []
  }

  async getRecentScheduleReference(channelId: string, date: string, _days = 7): Promise<{ dates: string[]; schedules: ScheduleSummary[] }> {
    const schedules = await this.getHistorySchedules(channelId, date)
    return {
      dates: schedules.map((item) => item.date),
      schedules,
    }
  }

  async getProgramDetails(programCode: string): Promise<ProgramCandidate | null> {
    return this.programs.get(programCode) ?? null
  }

  async queryProgramLibrary(query: {
    programTypes?: string[]
    minDuration?: number
    maxDuration?: number
    keyword?: string
    limit?: number
  }): Promise<ProgramCandidate[]> {
    let list = Array.from(new Map(demoPrograms.map((item) => [item.programCode, item])).values())

    if (query.programTypes?.length) {
      list = list.filter((item) => query.programTypes!.includes(item.programType))
    }
    if (query.minDuration !== undefined) {
      list = list.filter((item) => item.duration >= query.minDuration!)
    }
    if (query.maxDuration !== undefined) {
      list = list.filter((item) => item.duration <= query.maxDuration!)
    }
    if (query.keyword) {
      list = list.filter((item) => item.programName.includes(query.keyword!) || item.programCode.includes(query.keyword!))
    }

    return query.limit ? list.slice(0, query.limit) : list
  }

  async getFixedItems(channelId: string, date: string): Promise<FixedItem[]> {
    return demoFixedItems[`${channelId}_${date}`] ?? []
  }

  async getGenerationContext(channelId: string, date: string): Promise<GenerationContext | null> {
    const channel = await this.getChannelInfo(channelId)
    if (!channel) return null

    const layoutReference = await this.getLayoutReference(channelId, date)
    const historyReference = await this.getRecentScheduleReference(channelId, date)
    const fixedItems = await this.getFixedItems(channelId, date)

    const channelContext: ChannelContext = {
      channelId: channel.id,
      channelName: channel.name,
      date,
      timeZone: channel.timeZone,
      broadcastRules: {
        defaultStartTime: channel.broadcastRules.defaultStartTime,
        defaultEndTime: channel.broadcastRules.defaultEndTime,
        minProgramDuration: channel.broadcastRules.minProgramDuration,
        maxProgramDuration: channel.broadcastRules.maxProgramDuration,
        allowedTransitions: {},
      },
    }

    return {
      channel: channelContext,
      date,
      layoutReference: layoutReference ?? undefined,
      historyReference,
      constraints: {
        fixedItems,
        lockedItems: fixedItems.filter((item) => item.isLocked).map((item) => item.id),
        blockedTimeRanges: fixedItems.map((item) => ({ start: item.startTime, end: item.endTime })),
        mandatoryPrograms: fixedItems.map((item) => item.programCode),
      },
    }
  }
}

let globalDataService: DataService | null = null

export function getDataService(): DataService {
  if (!globalDataService) {
    globalDataService = new DataService()
  }
  return globalDataService
}

export function resetDataService(): void {
  globalDataService = null
}
