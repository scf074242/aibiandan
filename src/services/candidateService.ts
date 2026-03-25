/**
 * 候选检索服务
 * 负责从多源数据检索候选节目
 * 
 * 数据源：
 * 1. 节目库 (library)
 * 2. 历史编排 (history)
 * 3. 版面参考 (layout)
 * 4. 填充节目 (filler)
 */

import type {
  ProgramCandidate,
  CandidateQueryCriteria,
  CandidateQueryResult,
  CandidateQueryParams,
  GapInfo,
} from '@/types/orchestration'

/** 候选检索配置 */
export interface CandidateServiceConfig {
  defaultLimit: number
  maxLimit: number
  enableCache: boolean
  cacheTTL: number // 毫秒
}

/** 默认配置 */
const DEFAULT_CONFIG: CandidateServiceConfig = {
  defaultLimit: 10,
  maxLimit: 50,
  enableCache: true,
  cacheTTL: 5 * 60 * 1000, // 5分钟
}

/** 候选检索服务 */
export class CandidateService {
  private config: CandidateServiceConfig
  private cache: Map<string, { candidates: ProgramCandidate[]; timestamp: number }> = new Map()

  // 模拟数据源
  private libraryPrograms: ProgramCandidate[] = []
  private historyPrograms: ProgramCandidate[] = []
  private fillerPrograms: ProgramCandidate[] = []

  constructor(config?: Partial<CandidateServiceConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.initializeMockData()
  }

  /**
   * 查询候选节目
   */
  async queryCandidates(
    gap: GapInfo,
    criteria: CandidateQueryCriteria,
  ): Promise<CandidateQueryResult> {
    const cacheKey = this.generateCacheKey(gap, criteria)

    // 检查缓存
    if (this.config.enableCache) {
      const cached = this.cache.get(cacheKey)
      if (cached && Date.now() - cached.timestamp < this.config.cacheTTL) {
        return {
          gapId: gap.id,
          candidates: cached.candidates,
          totalCount: cached.candidates.length,
          queryTime: new Date().toISOString(),
        }
      }
    }

    // 从各数据源检索
    const allCandidates: ProgramCandidate[] = []

    // 1. 从节目库检索
    const libraryResults = await this.queryFromLibrary(gap, criteria)
    allCandidates.push(...libraryResults)

    // 2. 从历史编排检索
    if (criteria.sequentialPreference) {
      const historyResults = await this.queryFromHistory(gap, criteria)
      allCandidates.push(...historyResults)
    }

    // 3. 从版面参考检索
    const layoutResults = await this.queryFromLayout(gap, criteria)
    allCandidates.push(...layoutResults)

    // 4. 从填充节目检索（如果允许）
    if (criteria.allowShortFiller) {
      const fillerResults = await this.queryFromFiller(gap, criteria)
      allCandidates.push(...fillerResults)
    }

    // 去重
    const uniqueCandidates = this.deduplicateCandidates(allCandidates)

    // 排序
    const sortedCandidates = this.sortCandidates(uniqueCandidates, gap, criteria)

    // 限制数量
    const limit = criteria.programTypePreference?.length
      ? this.config.maxLimit
      : this.config.defaultLimit
    const limitedCandidates = sortedCandidates.slice(0, limit)

    // 缓存结果
    if (this.config.enableCache) {
      this.cache.set(cacheKey, {
        candidates: limitedCandidates,
        timestamp: Date.now(),
      })
    }

    return {
      gapId: gap.id,
      candidates: limitedCandidates,
      totalCount: uniqueCandidates.length,
      queryTime: new Date().toISOString(),
    }
  }

  /**
   * 从节目库检索
   */
  private async queryFromLibrary(
    gap: GapInfo,
    criteria: CandidateQueryCriteria,
  ): Promise<ProgramCandidate[]> {
    return this.libraryPrograms.filter((program) => {
      // 时长匹配
      if (program.duration < criteria.expectedDuration.min) return false
      if (program.duration > criteria.expectedDuration.max) return false

      // 类型匹配
      if (
        criteria.programTypePreference?.length &&
        !criteria.programTypePreference.includes(program.programType)
      ) {
        return false
      }

      return true
    })
  }

  /**
   * 从历史编排检索
   */
  private async queryFromHistory(
    gap: GapInfo,
    criteria: CandidateQueryCriteria,
  ): Promise<ProgramCandidate[]> {
    return this.historyPrograms.filter((program) => {
      // 时长匹配
      if (program.duration < criteria.expectedDuration.min) return false
      if (program.duration > criteria.expectedDuration.max) return false

      // 类型匹配
      if (
        criteria.programTypePreference?.length &&
        !criteria.programTypePreference.includes(program.programType)
      ) {
        return false
      }

      return true
    })
  }

  /**
   * 从版面参考检索
   */
  private async queryFromLayout(
    gap: GapInfo,
    criteria: CandidateQueryCriteria,
  ): Promise<ProgramCandidate[]> {
    // 版面参考通常有固定节目
    // 这里简化处理，返回空数组
    return []
  }

  /**
   * 从填充节目检索
   */
  private async queryFromFiller(
    gap: GapInfo,
    criteria: CandidateQueryCriteria,
  ): Promise<ProgramCandidate[]> {
    return this.fillerPrograms.filter((program) => {
      // 填充节目通常较短
      if (program.duration > 300) return false // 最多5分钟

      // 时长匹配
      if (program.duration < criteria.expectedDuration.min) return false
      if (program.duration > criteria.expectedDuration.max) return false

      return true
    })
  }

  /**
   * 去重候选
   */
  private deduplicateCandidates(candidates: ProgramCandidate[]): ProgramCandidate[] {
    const seen = new Set<string>()
    return candidates.filter((candidate) => {
      const key = `${candidate.programCode}_${candidate.duration}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }

  /**
   * 排序候选
   */
  private sortCandidates(
    candidates: ProgramCandidate[],
    gap: GapInfo,
    criteria: CandidateQueryCriteria,
  ): ProgramCandidate[] {
    return candidates.sort((a, b) => {
      // 1. 时长匹配度（越接近空窗时长越好）
      const gapDuration = gap.duration
      const aDurationDiff = Math.abs(a.duration - gapDuration)
      const bDurationDiff = Math.abs(b.duration - gapDuration)

      if (aDurationDiff !== bDurationDiff) {
        return aDurationDiff - bDurationDiff
      }

      // 2. 收视率（越高越好）
      if (criteria.considerRatings) {
        const aRating = a.rating || 0
        const bRating = b.rating || 0
        if (aRating !== bRating) {
          return bRating - aRating
        }
      }

      // 3. 类型匹配度
      if (criteria.programTypePreference?.length) {
        const aTypeMatch = criteria.programTypePreference.includes(a.programType) ? 1 : 0
        const bTypeMatch = criteria.programTypePreference.includes(b.programType) ? 1 : 0
        if (aTypeMatch !== bTypeMatch) {
          return bTypeMatch - aTypeMatch
        }
      }

      // 4. 默认按名称排序
      return a.programName.localeCompare(b.programName)
    })
  }

  /**
   * 生成缓存键
   */
  private generateCacheKey(gap: GapInfo, criteria: CandidateQueryCriteria): string {
    return `${gap.id}_${criteria.expectedDuration.min}_${criteria.expectedDuration.max}_${criteria.programTypePreference?.join(',') || 'all'}`
  }

  /**
   * 清除缓存
   */
  clearCache(): void {
    this.cache.clear()
  }

  // ==================== 数据管理 ====================

  /**
   * 更新节目库
   */
  updateLibrary(programs: ProgramCandidate[]): void {
    this.libraryPrograms = programs
    this.clearCache()
  }

  /**
   * 更新历史编排
   */
  updateHistory(programs: ProgramCandidate[]): void {
    this.historyPrograms = programs
    this.clearCache()
  }

  /**
   * 更新填充节目
   */
  updateFiller(programs: ProgramCandidate[]): void {
    this.fillerPrograms = programs
    this.clearCache()
  }

  /**
   * 添加节目到节目库
   */
  addToLibrary(program: ProgramCandidate): void {
    this.libraryPrograms.push(program)
    this.clearCache()
  }

  /**
   * 从节目库移除
   */
  removeFromLibrary(programCode: string): void {
    this.libraryPrograms = this.libraryPrograms.filter((p) => p.programCode !== programCode)
    this.clearCache()
  }

  // ==================== 初始化模拟数据 ====================

  private initializeMockData(): void {
    // 节目库数据
    this.libraryPrograms = [
      {
        id: 'lib_001',
        programCode: 'NEWS001',
        programName: '新闻联播',
        duration: 1800,
        programType: 'news',
        rating: 8.5,
        source: 'library',
      },
      {
        id: 'lib_002',
        programCode: 'TVS001',
        programName: '电视剧：人世间',
        duration: 2700,
        programType: 'drama',
        rating: 8.8,
        source: 'library',
      },
      {
        id: 'lib_003',
        programCode: 'TVS002',
        programName: '电视剧：狂飙',
        duration: 2700,
        programType: 'drama',
        rating: 9.0,
        source: 'library',
      },
      {
        id: 'lib_004',
        programCode: 'VAR001',
        programName: '综艺节目：快乐大本营',
        duration: 5400,
        programType: 'variety',
        rating: 7.5,
        source: 'library',
      },
      {
        id: 'lib_005',
        programCode: 'DOC001',
        programName: '纪录片：舌尖上的中国',
        duration: 3000,
        programType: 'documentary',
        rating: 8.2,
        source: 'library',
      },
      {
        id: 'lib_006',
        programCode: 'MOV001',
        programName: '电影：流浪地球2',
        duration: 10320,
        programType: 'movie',
        rating: 8.9,
        source: 'library',
      },
      {
        id: 'lib_007',
        programCode: 'KID001',
        programName: '动画片：熊出没',
        duration: 900,
        programType: 'kids',
        rating: 7.0,
        source: 'library',
      },
      {
        id: 'lib_008',
        programCode: 'SPO001',
        programName: '体育赛事：NBA直播',
        duration: 7200,
        programType: 'sports',
        rating: 8.0,
        source: 'library',
      },
    ]

    // 历史编排数据
    this.historyPrograms = [
      {
        id: 'his_001',
        programCode: 'NEWS001',
        programName: '新闻联播',
        duration: 1800,
        programType: 'news',
        rating: 8.5,
        source: 'history',
      },
      {
        id: 'his_002',
        programCode: 'TVS003',
        programName: '电视剧：三体',
        duration: 2700,
        programType: 'drama',
        rating: 8.6,
        source: 'history',
      },
    ]

    // 填充节目数据
    this.fillerPrograms = [
      {
        id: 'fil_001',
        programCode: 'AD001',
        programName: '广告时段',
        duration: 120,
        programType: 'ad',
        source: 'filler',
      },
      {
        id: 'fil_002',
        programCode: 'PRO001',
        programName: '节目预告',
        duration: 60,
        programType: 'promo',
        source: 'filler',
      },
      {
        id: 'fil_003',
        programCode: 'MV001',
        programName: 'MV欣赏',
        duration: 180,
        programType: 'music',
        source: 'filler',
      },
    ]
  }
}

// 导出工厂函数
let globalCandidateService: CandidateService | null = null

export function getCandidateService(config?: Partial<CandidateServiceConfig>): CandidateService {
  if (!globalCandidateService) {
    globalCandidateService = new CandidateService(config)
  }
  return globalCandidateService
}

export function resetCandidateService(): void {
  globalCandidateService = null
}

// 导出便捷函数
export async function queryCandidates(
  gap: GapInfo,
  criteria: CandidateQueryCriteria,
): Promise<CandidateQueryResult> {
  return getCandidateService().queryCandidates(gap, criteria)
}
