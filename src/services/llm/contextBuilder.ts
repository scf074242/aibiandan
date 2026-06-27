/**
 * 上下文构建器
 * 负责构建 LLM 请求所需的上下文信息
 */
import type {
  PlanningContext,
  FillingContext,
  RepairContext,
  DialogueContext,
  GapInfo,
  ScheduleItem,
  ValidationError,
  ProgramCandidate,
  ChatMessage,
} from '@/types/llm'

export class ContextBuilder {
  /**
   * 构建规划上下文
   */
  buildPlanningContext(
    channelId: string,
    channelName: string,
    date: string,
    layoutReference?: string,
    historyData?: ScheduleItem[],
  ): PlanningContext {
    const historySummary = this.summarizeHistory(historyData || [])

    return {
      channelId,
      channelName,
      date,
      layoutReference: layoutReference || '无版面参考',
      historySummary,
      constraints: this.getDefaultConstraints(),
    }
  }

  /**
   * 构建填充上下文
   */
  buildFillingContext(
    gap: GapInfo,
    currentSchedule: ScheduleItem[],
    availablePrograms: ProgramCandidate[],
  ): FillingContext {
    return {
      gap,
      currentSchedule: this.formatSchedule(currentSchedule),
      availablePrograms,
    }
  }

  /**
   * 构建修复上下文
   */
  buildRepairContext(errors: ValidationError[], items: ScheduleItem[]): RepairContext {
    return {
      errors,
      items,
    }
  }

  /**
   * 构建对话上下文
   */
  buildDialogueContext(
    userInput: string,
    history: ChatMessage[],
    currentSchedule: ScheduleItem[],
  ): DialogueContext {
    return {
      userInput,
      history,
      currentSchedule: this.formatSchedule(currentSchedule),
    }
  }

  /**
   * 生成空窗列表
   */
  generateGapList(startTime: string, endTime: string, blockDuration: number = 3600): GapInfo[] {
    const gaps: GapInfo[] = []
    const start = this.timeToSeconds(startTime)
    const end = this.timeToSeconds(endTime)

    let currentTime = start
    let blockIndex = 1

    while (currentTime < end) {
      const blockEnd = Math.min(currentTime + blockDuration, end)
      gaps.push({
        gapId: `block-${blockIndex}`,
        startTime: this.secondsToTime(currentTime),
        endTime: this.secondsToTime(blockEnd),
        duration: blockEnd - currentTime,
        programType: this.inferProgramType(currentTime),
      })
      currentTime = blockEnd
      blockIndex++
    }

    return gaps
  }

  /**
   * 根据时间推断节目类型
   */
  private inferProgramType(seconds: number): string {
    const hour = Math.floor(seconds / 3600)

    if (hour >= 6 && hour < 9) return 'morning_news'
    if (hour >= 9 && hour < 12) return 'daytime_program'
    if (hour >= 12 && hour < 14) return 'noon_news'
    if (hour >= 14 && hour < 18) return 'afternoon_program'
    if (hour >= 18 && hour < 19) return 'evening_news'
    if (hour >= 19 && hour < 22) return 'prime_time'
    if (hour >= 22 && hour < 24) return 'late_night'
    return 'night_program'
  }

  /**
   * 格式化串联单为文本
   */
  private formatSchedule(items: ScheduleItem[]): string {
    if (items.length === 0) {
      return '当前串联单为空'
    }

    return items
      .map(
        (item, index) =>
          `${index + 1}. ${item.programName} (${item.programCode}) - ${item.startTime}~${item.endTime} [${item.programType}]`,
      )
      .join('\n')
  }

  /**
   * 总结历史数据
   */
  private summarizeHistory(historyData: ScheduleItem[]): string {
    if (historyData.length === 0) {
      return '无历史数据'
    }

    const typeCount: Record<string, number> = {}
    historyData.forEach((item) => {
      typeCount[item.programType] = (typeCount[item.programType] || 0) + 1
    })

    const typeSummary = Object.entries(typeCount)
      .map(([type, count]) => `${type}: ${count}个`)
      .join(', ')

    return `历史串联单共${historyData.length}个节目，类型分布：${typeSummary}`
  }

  /**
   * 获取默认约束条件
   */
  private getDefaultConstraints(): string[] {
    return [
      '黄金时段（19:00-22:00）必须安排高收视率节目',
      '广告必须成组出现，每组2-5条',
      '直播节目必须匹配可用演播室',
      '节目时长必须匹配时段块',
      '相邻节目类型不宜重复',
      '整点/半点优先安排整点节目',
    ]
  }

  /**
   * 时间字符串转秒数
   */
  private timeToSeconds(time: string): number {
    const [hours = 0, minutes = 0, seconds = 0] = time.split(':').map(Number)
    return hours * 3600 + minutes * 60 + seconds
  }

  /**
   * 秒数转时间字符串
   */
  private secondsToTime(seconds: number): string {
    const hours = Math.floor(seconds / 3600)
    const mins = Math.floor((seconds % 3600) / 60)
    const secs = seconds % 60
    return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  }

  /**
   * 压缩上下文以适应 Token 限制
   */
  compressContext(context: string, maxTokens: number = 4000): string {
    // 简单估算：1 token ≈ 4 字符
    const maxChars = maxTokens * 4

    if (context.length <= maxChars) {
      return context
    }

    // 截断并添加提示
    return (
      context.slice(0, maxChars - 100) +
      '\n...[内容已截断，仅显示部分信息]'
    )
  }
}

// 导出单例实例
export const contextBuilder = new ContextBuilder()
