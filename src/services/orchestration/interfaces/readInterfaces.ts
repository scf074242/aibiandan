/**
 * 读取类接口
 * 提供编排所需的数据查询能力
 */

import type {
  GenerationContext,
  ProgramCandidate,
  GapInfo,
  ScheduleSummary,
  LayoutReference,
  CandidateQueryParams,
  CandidateQueryResult,
} from '@/types/orchestration'
import type { DataService } from '../dataService'
import type { GapManager } from '@/services/gapManager'
import type { CandidateService } from '@/services/candidateService'

/** 读取接口 */
export class ReadInterfaces {
  private dataService: DataService
  private gapManager?: GapManager
  private candidateService?: CandidateService

  constructor(
    dataService: DataService,
    gapManager?: GapManager,
    candidateService?: CandidateService,
  ) {
    this.dataService = dataService
    this.gapManager = gapManager
    this.candidateService = candidateService
  }

  /**
   * 获取生成上下文
   */
  async getGenerationContext(
    channelId: string,
    date: string,
  ): Promise<GenerationContext | null> {
    return this.dataService.getGenerationContext(channelId, date)
  }

  /**
   * 获取节目详情
   */
  async getProgramDetails(programCode: string): Promise<ProgramCandidate | null> {
    return this.dataService.getProgramDetails(programCode)
  }

  /**
   * 查询剩余空窗
   */
  queryRemainingGaps(): GapInfo[] {
    if (!this.gapManager) {
      throw new Error('Gap manager not initialized')
    }
    return this.gapManager.queryRemainingGaps()
  }

  /**
   * 多源检索候选
   */
  async queryCandidatesByMultiSource(
    params: CandidateQueryParams,
  ): Promise<CandidateQueryResult> {
    if (!this.candidateService) {
      throw new Error('Candidate service not initialized')
    }

    // 构建查询条件
    const gap = this.gapManager?.getGap(params.gapId)
    if (!gap) {
      throw new Error(`Gap not found: ${params.gapId}`)
    }

    const criteria = {
      targetTimeRange: params.timeRange,
      expectedDuration: params.durationRange,
      programTypePreference: params.programTypes,
      sequentialPreference: true,
      excludeUsed: true,
      considerRatings: true,
      allowShortFiller: true,
    }

    return this.candidateService.queryCandidates(gap, criteria)
  }

  /**
   * 获取最近编排参考
   */
  async getRecentScheduleReference(
    channelId: string,
    date: string,
    days: number = 7,
  ): Promise<{ dates: string[]; schedules: ScheduleSummary[] }> {
    return this.dataService.getRecentScheduleReference(channelId, date, days)
  }

  /**
   * 获取版面参考
   */
  async getLayoutReference(
    channelId: string,
    date: string,
  ): Promise<LayoutReference | null> {
    return this.dataService.getLayoutReference(channelId, date)
  }

  /**
   * 获取版面时段
   */
  async getLayoutSlots(channelId: string, date: string) {
    return this.dataService.getLayoutSlots(channelId, date)
  }

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
    return this.dataService.queryProgramLibrary(query)
  }

  /**
   * 获取固定播出项
   */
  async getFixedItems(channelId: string, date: string) {
    return this.dataService.getFixedItems(channelId, date)
  }
}

// 导出工厂函数
let globalReadInterfaces: ReadInterfaces | null = null

export function getReadInterfaces(
  dataService?: DataService,
  gapManager?: GapManager,
  candidateService?: CandidateService,
): ReadInterfaces {
  if (!globalReadInterfaces) {
    if (!dataService) {
      throw new Error('Data service is required for first initialization')
    }
    globalReadInterfaces = new ReadInterfaces(dataService, gapManager, candidateService)
  }
  return globalReadInterfaces
}

export function resetReadInterfaces(): void {
  globalReadInterfaces = null
}
