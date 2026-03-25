/**
 * 编排数据服务
 * 负责获取编排所需的所有数据
 *
 * 数据源：
 * 1. 频道信息
 * 2. 播出版面
 * 3. 历史编排
 * 4. 节目库
 * 5. 固定播出项
 */

import type {
  ChannelContext,
  LayoutReference,
  LayoutSlot,
  ScheduleSummary,
  ProgramCandidate,
  FixedItem,
  GenerationContext,
  ScheduleConstraints,
} from '@/types/orchestration'

/** 频道信息 */
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

/** 数据服务配置 */
export interface DataServiceConfig {
  enableCache: boolean
  cacheTTL: number // 毫秒
}

/** 默认配置 */
const DEFAULT_CONFIG: DataServiceConfig = {
  enableCache: true,
  cacheTTL: 5 * 60 * 1000, // 5分钟
}

/** 编排数据服务 */
export class DataService {
  private config: DataServiceConfig
  private cache: Map<string, { data: any; timestamp: number }> = new Map()

  // 模拟数据存储
  private channels: Map<string, ChannelInfo> = new Map()
  private layouts: Map<string, LayoutReference> = new Map()
  private historySchedules: Map<string, ScheduleSummary[]> = new Map()
  private programLibrary: Map<string, ProgramCandidate> = new Map()
  private fixedItems: Map<string, FixedItem[]> = new Map()

  constructor(config?: Partial<DataServiceConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.initializeMockData()
  }

  // ==================== 频道信息 ====================

  /**
   * 获取频道信息
   */
  async getChannelInfo(channelId: string): Promise<ChannelInfo | null> {
    const cacheKey = `channel_${channelId}`
    const cached = this.getFromCache(cacheKey)
    if (cached) return cached

    // 模拟API调用
    const channel = this.channels.get(channelId)
    if (channel) {
      this.setCache(cacheKey, channel)
    }
    return channel || null
  }

  /**
   * 获取所有频道
   */
  async getAllChannels(): Promise<ChannelInfo[]> {
    const cacheKey = 'channels_all'
    const cached = this.getFromCache(cacheKey)
    if (cached) return cached

    const channels = Array.from(this.channels.values())
    this.setCache(cacheKey, channels)
    return channels
  }

  // ==================== 版面参考 ====================

  /**
   * 获取版面参考
   */
  async getLayoutReference(channelId: string, date: string): Promise<LayoutReference | null> {
    const cacheKey = `layout_${channelId}_${date}`
    const cached = this.getFromCache(cacheKey)
    if (cached) return cached

    const layout = this.layouts.get(`${channelId}_${date}`)
    if (layout) {
      this.setCache(cacheKey, layout)
    }
    return layout || null
  }

  /**
   * 获取版面时段
   */
  async getLayoutSlots(channelId: string, date: string): Promise<LayoutSlot[]> {
    const layout = await this.getLayoutReference(channelId, date)
    return layout?.slots || []
  }

  // ==================== 历史编排 ====================

  /**
   * 获取历史编排
   */
  async getHistorySchedules(
    channelId: string,
    date: string,
    days: number = 7,
  ): Promise<ScheduleSummary[]> {
    const cacheKey = `history_${channelId}_${date}_${days}`
    const cached = this.getFromCache(cacheKey)
    if (cached) return cached

    const key = `${channelId}_${date}`
    const histories = this.historySchedules.get(key) || []
    const result = histories.slice(0, days)

    this.setCache(cacheKey, result)
    return result
  }

  /**
   * 获取最近编排参考
   */
  async getRecentScheduleReference(
    channelId: string,
    date: string,
    days: number = 7,
  ): Promise<{ dates: string[]; schedules: ScheduleSummary[] }> {
    const histories = await this.getHistorySchedules(channelId, date, days)
    return {
      dates: histories.map((h) => h.date),
      schedules: histories,
    }
  }

  // ==================== 节目库 ====================

  /**
   * 查询节目库
   */
  async queryProgramLibrary(query: {
    programTypes?: string[]
    minDuration?: number
    maxDuration?: number
    keyword?: string
    limit?: number
  }): Promise<ProgramCandidate[]> {
    const cacheKey = `library_${JSON.stringify(query)}`
    const cached = this.getFromCache(cacheKey)
    if (cached) return cached

    let programs = Array.from(this.programLibrary.values())

    // 应用过滤条件
    if (query.programTypes?.length) {
      programs = programs.filter((p) => query.programTypes!.includes(p.programType))
    }

    if (query.minDuration !== undefined) {
      programs = programs.filter((p) => p.duration >= query.minDuration!)
    }

    if (query.maxDuration !== undefined) {
      programs = programs.filter((p) => p.duration <= query.maxDuration!)
    }

    if (query.keyword) {
      const keyword = query.keyword.toLowerCase()
      programs = programs.filter(
        (p) =>
          p.programName.toLowerCase().includes(keyword) ||
          p.programCode.toLowerCase().includes(keyword),
      )
    }

    if (query.limit) {
      programs = programs.slice(0, query.limit)
    }

    this.setCache(cacheKey, programs)
    return programs
  }

  /**
   * 获取节目详情
   */
  async getProgramDetails(programCode: string): Promise<ProgramCandidate | null> {
    const cacheKey = `program_${programCode}`
    const cached = this.getFromCache(cacheKey)
    if (cached) return cached

    const program = this.programLibrary.get(programCode)
    if (program) {
      this.setCache(cacheKey, program)
    }
    return program || null
  }

  // ==================== 固定播出项 ====================

  /**
   * 获取固定播出项
   */
  async getFixedItems(channelId: string, date: string): Promise<FixedItem[]> {
    const cacheKey = `fixed_${channelId}_${date}`
    const cached = this.getFromCache(cacheKey)
    if (cached) return cached

    const key = `${channelId}_${date}`
    const items = this.fixedItems.get(key) || []

    this.setCache(cacheKey, items)
    return items
  }

  // ==================== 生成上下文 ====================

  /**
   * 获取生成上下文
   */
  async getGenerationContext(channelId: string, date: string): Promise<GenerationContext | null> {
    const cacheKey = `context_${channelId}_${date}`
    const cached = this.getFromCache(cacheKey)
    if (cached) return cached

    const channel = await this.getChannelInfo(channelId)
    if (!channel) return null

    const layout = await this.getLayoutReference(channelId, date)
    const history = await this.getRecentScheduleReference(channelId, date, 7)
    const fixedItems = await this.getFixedItems(channelId, date)

    const context: GenerationContext = {
      channel: {
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
      },
      date,
      layoutReference: layout,
      historyReference: history,
      constraints: {
        fixedItems,
        lockedItems: [],
        blockedTimeRanges: [],
        mandatoryPrograms: [],
      },
    }

    this.setCache(cacheKey, context)
    return context
  }

  // ==================== 缓存管理 ====================

  /**
   * 从缓存获取
   */
  private getFromCache(key: string): any | null {
    if (!this.config.enableCache) return null

    const cached = this.cache.get(key)
    if (!cached) return null

    // 检查是否过期
    if (Date.now() - cached.timestamp > this.config.cacheTTL) {
      this.cache.delete(key)
      return null
    }

    return cached.data
  }

  /**
   * 设置缓存
   */
  private setCache(key: string, data: any): void {
    if (!this.config.enableCache) return

    this.cache.set(key, {
      data,
      timestamp: Date.now(),
    })
  }

  /**
   * 清除缓存
   */
  clearCache(): void {
    this.cache.clear()
  }

  /**
   * 清除指定缓存
   */
  clearCacheByPattern(pattern: string): void {
    for (const key of this.cache.keys()) {
      if (key.includes(pattern)) {
        this.cache.delete(key)
      }
    }
  }

  // ==================== 数据更新（供外部调用）====================

  /**
   * 更新频道信息
   */
  updateChannel(channel: ChannelInfo): void {
    this.channels.set(channel.id, channel)
    this.clearCacheByPattern(`channel_${channel.id}`)
  }

  /**
   * 更新版面
   */
  updateLayout(channelId: string, date: string, layout: LayoutReference): void {
    this.layouts.set(`${channelId}_${date}`, layout)
    this.clearCacheByPattern(`layout_${channelId}_${date}`)
  }

  /**
   * 更新历史编排
   */
  updateHistorySchedules(channelId: string, date: string, schedules: ScheduleSummary[]): void {
    this.historySchedules.set(`${channelId}_${date}`, schedules)
    this.clearCacheByPattern(`history_${channelId}_${date}`)
  }

  /**
   * 更新节目库
   */
  updateProgramLibrary(programs: ProgramCandidate[]): void {
    for (const program of programs) {
      this.programLibrary.set(program.programCode, program)
    }
    this.clearCacheByPattern('library_')
  }

  /**
   * 更新固定播出项
   */
  updateFixedItems(channelId: string, date: string, items: FixedItem[]): void {
    this.fixedItems.set(`${channelId}_${date}`, items)
    this.clearCacheByPattern(`fixed_${channelId}_${date}`)
  }

  // ==================== 初始化模拟数据 ====================

  private initializeMockData(): void {
    // 频道数据
    this.channels.set('news', {
      id: 'news',
      name: '新闻综合',
      code: 'NEWS',
      timeZone: 'Asia/Shanghai',
      broadcastRules: {
        defaultStartTime: '06:00:00',
        defaultEndTime: '26:00:00',
        minProgramDuration: 60,
        maxProgramDuration: 7200,
      },
    })

    this.channels.set('dragon', {
      id: 'dragon',
      name: '东方卫视',
      code: 'DRAGON',
      timeZone: 'Asia/Shanghai',
      broadcastRules: {
        defaultStartTime: '06:00:00',
        defaultEndTime: '26:00:00',
        minProgramDuration: 60,
        maxProgramDuration: 7200,
      },
    })

    // 版面数据
    this.layouts.set('news_2026-03-25', {
      id: 'layout_news_2026-03-25',
      name: '新闻综合频道版面',
      slots: [
        { id: 'slot1', startTime: '06:00:00', endTime: '08:00:00', programType: 'news' },
        { id: 'slot2', startTime: '08:00:00', endTime: '12:00:00', programType: 'variety' },
        { id: 'slot3', startTime: '12:00:00', endTime: '14:00:00', programType: 'news' },
        { id: 'slot4', startTime: '14:00:00', endTime: '18:00:00', programType: 'drama' },
        { id: 'slot5', startTime: '18:00:00', endTime: '20:00:00', programType: 'news' },
        { id: 'slot6', startTime: '20:00:00', endTime: '22:00:00', programType: 'drama' },
        { id: 'slot7', startTime: '22:00:00', endTime: '24:00:00', programType: 'variety' },
      ],
    })

    // 节目库数据
    const programs: ProgramCandidate[] = [
      {
        id: 'prog_001',
        programCode: 'NEWS_MORNING',
        programName: '早间新闻',
        duration: 3600,
        programType: 'news',
        rating: 8.5,
        source: 'library',
      },
      {
        id: 'prog_002',
        programCode: 'NEWS_NOON',
        programName: '午间新闻',
        duration: 1800,
        programType: 'news',
        rating: 8.0,
        source: 'library',
      },
      {
        id: 'prog_003',
        programCode: 'NEWS_EVENING',
        programName: '晚间新闻',
        duration: 3600,
        programType: 'news',
        rating: 9.0,
        source: 'library',
      },
      {
        id: 'prog_004',
        programCode: 'DRAMA_001',
        programName: '电视剧A',
        duration: 2700,
        programType: 'drama',
        rating: 8.2,
        source: 'library',
      },
      {
        id: 'prog_005',
        programCode: 'VARIETY_001',
        programName: '综艺节目A',
        duration: 5400,
        programType: 'variety',
        rating: 7.5,
        source: 'library',
      },
    ]

    for (const program of programs) {
      this.programLibrary.set(program.programCode, program)
    }
  }
}

// 导出工厂函数
let globalDataService: DataService | null = null

export function getDataService(config?: Partial<DataServiceConfig>): DataService {
  if (!globalDataService) {
    globalDataService = new DataService(config)
  }
  return globalDataService
}

export function resetDataService(): void {
  globalDataService = null
}
