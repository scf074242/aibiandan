/**
 * 预演类接口
 * 提供命令执行前的预览能力
 */

import type {
  OrchestrationCommand,
  MaterializeInput,
  MaterializeResult,
  CommandPreview,
  ScheduleItemSnapshot,
} from '@/types/orchestration'
import type { CommandExecutor } from '@/services/commandExecutor'
import { getMaterializer } from '@/services/materializer'

/** 预演接口 */
export class PreviewInterfaces {
  private commandExecutor: CommandExecutor

  constructor(commandExecutor: CommandExecutor) {
    this.commandExecutor = commandExecutor
  }

  /**
   * 预演物化填充条目
   */
  previewMaterializeFillItem(input: MaterializeInput): MaterializeResult {
    const materializer = getMaterializer()
    return materializer.previewMaterialize(input)
  }

  /**
   * 预演命令
   */
  async previewCommand(command: OrchestrationCommand): Promise<CommandPreview> {
    return this.commandExecutor.preview(command)
  }

  /**
   * 模拟批量命令
   */
  async simulateBatchCommand(commands: OrchestrationCommand[]): Promise<{
    canExecute: boolean
    totalAffectedItems: string[]
    totalAffectedTimeRanges: { start: string; end: string }[]
    warnings: string[]
    risks: string[]
  }> {
    const previews = await Promise.all(
      commands.map((cmd) => this.commandExecutor.preview(cmd))
    )

    const allAffectedItems: string[] = []
    const allAffectedTimeRanges: { start: string; end: string }[] = []
    const allWarnings: string[] = []
    const allRisks: string[] = []

    for (const preview of previews) {
      allAffectedItems.push(...preview.affectedItems)
      allAffectedTimeRanges.push(...preview.affectedTimeRanges)
      allWarnings.push(...preview.warnings)
      allRisks.push(...preview.risks)
    }

    return {
      canExecute: previews.every((p) => p.canExecute),
      totalAffectedItems: [...new Set(allAffectedItems)],
      totalAffectedTimeRanges: this.mergeTimeRanges(allAffectedTimeRanges),
      warnings: [...new Set(allWarnings)],
      risks: [...new Set(allRisks)],
    }
  }

  /**
   * 合并时间范围
   */
  private mergeTimeRanges(
    ranges: { start: string; end: string }[]
  ): { start: string; end: string }[] {
    if (ranges.length === 0) return []

    // 排序
    const sorted = [...ranges].sort(
      (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime()
    )

    const merged: { start: string; end: string }[] = [sorted[0]!]

    for (let i = 1; i < sorted.length; i++) {
      const current = sorted[i]!
      const last = merged[merged.length - 1]!

      const currentStart = new Date(current.start).getTime()
      const lastEnd = new Date(last.end).getTime()

      if (currentStart <= lastEnd) {
        // 有重叠，合并
        const currentEnd = new Date(current.end).getTime()
        if (currentEnd > lastEnd) {
          last.end = current.end
        }
      } else {
        // 无重叠，添加新段
        merged.push(current)
      }
    }

    return merged
  }
}

// 导出工厂函数
let globalPreviewInterfaces: PreviewInterfaces | null = null

export function getPreviewInterfaces(commandExecutor?: CommandExecutor): PreviewInterfaces {
  if (!globalPreviewInterfaces) {
    if (!commandExecutor) {
      throw new Error('Command executor is required for first initialization')
    }
    globalPreviewInterfaces = new PreviewInterfaces(commandExecutor)
  }
  return globalPreviewInterfaces
}

export function resetPreviewInterfaces(): void {
  globalPreviewInterfaces = null
}
