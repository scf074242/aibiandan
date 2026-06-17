import {
  getOrchestrationDemoHistorySchedules,
  orchestrationDemoCandidates,
  orchestrationDemoChannels,
  orchestrationDemoColumns,
} from '@/mock/orchestrationMock'
import {
  getEffectiveColumnDefinition,
  getEffectiveLayoutReference,
  getEffectiveProgramsByColumn,
} from './runtimeLayoutRegistry'
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

export interface BroadcastReadinessRecord {
  candidateId?: string
  programId?: string
  programCode?: string
  materialStatus?: 'ready' | 'missing' | 'expired' | 'blocked'
  rightsStatus?: 'ready' | 'missing' | 'expired' | 'blocked'
  updatedAt?: string
  source?: string
}

export class DataService {
  private channels = new Map<string, ChannelInfo>()
  private programs = new Map<string, ProgramCandidate>()

  constructor() {
    for (const channel of orchestrationDemoChannels) {
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

    orchestrationDemoCandidates.forEach((program) => {
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
    return getEffectiveLayoutReference(channelId, date)
  }

  async getLayoutSlots(channelId: string, date: string) {
    return (await this.getLayoutReference(channelId, date))?.slots ?? []
  }

  async getHistorySchedules(channelId: string, date: string): Promise<ScheduleSummary[]> {
    return getOrchestrationDemoHistorySchedules(channelId, date)
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
    channelId?: string
    columnId?: string
    programTypes?: string[]
    minDuration?: number
    maxDuration?: number
    keyword?: string
    limit?: number
  }): Promise<ProgramCandidate[]> {
    let list = [...orchestrationDemoCandidates]

    if (query.channelId) {
      list = list.filter((item) => item.channelId === query.channelId)
    }

    if (query.columnId) {
      const column = getEffectiveColumnDefinition(query.columnId)
      if (!column) return []
      const allowedProgramIds = new Set(
        getEffectiveProgramsByColumn(column.channelId, query.columnId).map((item) => item.programId),
      )
      list = list.filter((item) => {
        const candidate = this.programs.get(item.id)
        return candidate?.channelId === column.channelId && allowedProgramIds.has(item.programId)
      })
    }

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
      const keyword = normalizeProgramLibraryKeywordStable(query.keyword)
      const facets = buildProgramLibraryKeywordFacetsStable(query.keyword)
      list = list.filter((item) => {
        const haystack = normalizeProgramLibraryKeywordStable([
          item.id,
          item.programId,
          item.programCode,
          item.programName,
          item.instanceName,
          item.columnId,
          item.columnName,
          item.programType,
          ...(item.contentTags ?? []),
        ].filter(Boolean).join(' '))
        return haystack.includes(keyword) || (facets.length > 0 && facets.every((facet) => haystack.includes(facet)))
      })
    }

    return query.limit ? list.slice(0, query.limit) : list
  }

  async getBroadcastReadiness(query: {
    channelId?: string
    programCodes?: string[]
    limit?: number
  }): Promise<BroadcastReadinessRecord[]> {
    let candidates = await this.queryProgramLibrary({
      channelId: query.channelId,
      limit: query.limit,
    })

    if (query.programCodes?.length) {
      const programCodes = new Set(query.programCodes)
      candidates = candidates.filter((candidate) => programCodes.has(candidate.programCode))
    }

    return candidates.map((candidate) => ({
      candidateId: candidate.id,
      programId: candidate.programId,
      programCode: candidate.programCode,
      materialStatus: 'ready',
      rightsStatus: 'ready',
      updatedAt: new Date('2026-03-25T00:00:00+08:00').toISOString(),
      source: 'demo_broadcast_readiness',
    }))
  }

  async getFixedItems(channelId: string, date: string): Promise<FixedItem[]> {
    void channelId
    void date
    return []
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

  getColumnName(columnId: string): string {
    return getEffectiveColumnDefinition(columnId)?.columnName
      ?? orchestrationDemoColumns.find((item) => item.columnId === columnId)?.columnName
      ?? columnId
  }
}

const normalizeProgramLibraryKeyword = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '')

const buildProgramLibraryKeywordFacets = (value: string): string[] => {
  const cleaned = value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/\d{1,2}[:：]\d{1,2}(?::\d{1,2})?/g, '')
    .replace(/\d{1,2}点(?:\d{1,2}分?)?/g, '')
    .replace(/没有节目编号|无节目编号|无节目号|无编号|没编号|无码/g, '无节目编号')
    .replace(/^(?:请|帮我|帮忙|在|到|给|把|将|一个|一条|一段)+/u, '')
    .replace(/(?:插入|添加|安排|排入|放置|加一条|加个|来一段|放一段|替换成|替换为|换成|改成|改为|换播|替换|查询|查找|查看|看看|找|搜索)/gu, '')
    .replace(/节目库|素材库|候选库|当前节目单|当前播单|节目单|播单|候选|可用|可播|有哪些|是什么|有什么|里面|情况|一下/gu, '')
    .replace(/节目|栏目|内容|素材/g, '')
    .replace(/[，。！？；：、,.!?;:]/gu, '')
    .trim()
  const directFacets = value
    .split(/[^\p{L}\p{N}]+/gu)
    .map((part) => normalizeProgramLibraryKeyword(part))
    .filter((part) => part.length > 1 && !isProgramLibraryStopFacet(part))
  const phraseFacets = [
    cleaned.includes('无节目编号') ? '无节目编号' : '',
    cleaned.includes('短片') ? '短片' : '',
    cleaned.includes('城市形象') ? '城市形象' : '',
    cleaned.includes('春日花路') ? '春日花路' : '',
  ].map((part) => normalizeProgramLibraryKeyword(part)).filter((part) => part.length > 1 && !isProgramLibraryStopFacet(part))
  const fallbackFacets = directFacets.length > 0 ? directFacets : [cleaned]
  return Array.from(new Set((phraseFacets.length > 0 ? phraseFacets : fallbackFacets)
    .map((part) => normalizeProgramLibraryKeyword(part))
    .filter((part) => part.length > 1 && !isProgramLibraryStopFacet(part))))
}

const isProgramLibraryStopFacet = (value: string): boolean => new Set([
  '节目',
  '栏目',
  '内容',
  '素材',
  '候选',
  '可用',
  '可播',
  '插入',
  '添加',
  '安排',
  '排入',
  '放置',
  '替换',
  '换成',
  '查询',
  '查找',
  '查看',
  '看看',
]).has(value)

const normalizeProgramLibraryKeywordStable = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '')

const buildProgramLibraryKeywordFacetsStable = (value: string): string[] => {
  const cleaned = value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/\d{1,2}[:\uff1a]\d{1,2}(?::\d{1,2})?/g, '')
    .replace(/\d{1,2}\u70b9(?:\d{1,2}\u5206?)?/g, '')
    .replace(/\u6ca1\u6709\u8282\u76ee\u7f16\u53f7|\u65e0\u8282\u76ee\u7f16\u53f7|\u65e0\u8282\u76ee\u53f7|\u65e0\u7f16\u53f7|\u6ca1\u7f16\u53f7|\u65e0\u7801/g, '\u65e0\u8282\u76ee\u7f16\u53f7')
    .replace(/^(?:\u8bf7|\u5e2e\u6211|\u5e2e\u5fd9|\u5728|\u5230|\u7ed9|\u628a|\u5c06|\u4e00\u4e2a|\u4e00\u6761|\u4e00\u6bb5)+/u, '')
    .replace(/(?:\u63d2\u5165|\u6dfb\u52a0|\u5b89\u6392|\u6392\u5165|\u653e\u7f6e|\u52a0\u4e00\u6761|\u52a0\u4e2a|\u6765\u4e00\u6bb5|\u653e\u4e00\u6bb5|\u66ff\u6362\u6210|\u66ff\u6362\u4e3a|\u6362\u6210|\u6539\u6210|\u6539\u4e3a|\u6362\u64ad|\u66ff\u6362|\u67e5\u8be2|\u67e5\u627e|\u67e5\u770b|\u770b\u770b|\u627e|\u641c\u7d22)/gu, '')
    .replace(/\u8282\u76ee\u5e93|\u7d20\u6750\u5e93|\u5019\u9009\u5e93|\u5f53\u524d\u8282\u76ee\u5355|\u5f53\u524d\u64ad\u5355|\u8282\u76ee\u5355|\u64ad\u5355|\u5019\u9009|\u53ef\u7528|\u53ef\u64ad|\u6709\u54ea\u4e9b|\u662f\u4ec0\u4e48|\u6709\u4ec0\u4e48|\u91cc\u9762|\u60c5\u51b5|\u4e00\u4e0b/gu, '')
    .replace(/\u8282\u76ee|\u680f\u76ee|\u5185\u5bb9|\u7d20\u6750/g, '')
    .replace(/[\uff0c\u3002\uff01\uff1f\uff1b\uff1a\u3001,.!?;:]/gu, '')
    .trim()
  const directFacets = value
    .split(/[^\p{L}\p{N}]+/gu)
    .map((part) => normalizeProgramLibraryKeywordStable(part))
    .filter((part) => part.length > 1 && !isProgramLibraryStopFacetStable(part))
  const phraseFacets = [
    cleaned.includes('\u65e0\u8282\u76ee\u7f16\u53f7') ? '\u65e0\u8282\u76ee\u7f16\u53f7' : '',
    cleaned.includes('\u57ce\u5e02\u5f62\u8c61') ? '\u57ce\u5e02\u5f62\u8c61' : '',
    cleaned.includes('\u6625\u65e5\u82b1\u8def') ? '\u6625\u65e5\u82b1\u8def' : '',
    cleaned.includes('\u4e0a\u6d77') ? '\u4e0a\u6d77' : '',
    cleaned.includes('\u65c5\u6e38\u666f\u70b9') ? '\u65c5\u6e38\u666f\u70b9' : '',
    cleaned.includes('\u666f\u70b9') ? '\u666f\u70b9' : '',
    cleaned.includes('\u5ba3\u4f20\u7247') ? '\u5ba3\u4f20\u7247' : '',
    cleaned.includes('\u77ed\u7247') ? '\u77ed\u7247' : '',
    cleaned.includes('\u89c6\u9891') ? '\u89c6\u9891' : '',
  ].map((part) => normalizeProgramLibraryKeywordStable(part)).filter((part) => part.length > 1 && !isProgramLibraryStopFacetStable(part))
  const fallbackFacets = directFacets.length > 0 ? directFacets : [cleaned]
  return Array.from(new Set((phraseFacets.length > 0 ? phraseFacets : fallbackFacets)
    .map((part) => normalizeProgramLibraryKeywordStable(part))
    .filter((part) => part.length > 1 && !isProgramLibraryStopFacetStable(part))))
}

const isProgramLibraryStopFacetStable = (value: string): boolean => new Set([
  '\u8282\u76ee',
  '\u680f\u76ee',
  '\u5185\u5bb9',
  '\u7d20\u6750',
  '\u5019\u9009',
  '\u53ef\u7528',
  '\u53ef\u64ad',
  '\u63d2\u5165',
  '\u6dfb\u52a0',
  '\u5b89\u6392',
  '\u6392\u5165',
  '\u653e\u7f6e',
  '\u66ff\u6362',
  '\u6362\u6210',
  '\u67e5\u8be2',
  '\u67e5\u627e',
  '\u67e5\u770b',
  '\u770b\u770b',
]).has(value)

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
