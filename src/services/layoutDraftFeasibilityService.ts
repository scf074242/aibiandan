import type { DraftFeasibilityReport, DraftFeasibilitySegmentReport, LayoutDraft } from '@/types/orchestration'
import {
  orchestrationDemoColumns,
  orchestrationDemoProgramDefinitions,
} from '@/mock/orchestrationMock'

const normalizeText = (value: string) => value.trim().toLowerCase()

export class LayoutDraftFeasibilityService {
  previewFeasibility(draft: LayoutDraft): DraftFeasibilityReport {
    const channelPrograms = orchestrationDemoProgramDefinitions.filter((program) => {
      const column = orchestrationDemoColumns.find((item) => item.columnId === program.columnId)
      return column?.channelId === draft.channelId
    })

    const segments: DraftFeasibilitySegmentReport[] = draft.columns.map((column, index) => {
      const slot = draft.layoutReference.slots[index]
      const hints = column.queryHints?.map(normalizeText) ?? []
      const matches = channelPrograms.filter((program) => {
        if (program.programType !== column.defaultProgramType) {
          return false
        }

        if (hints.length === 0) {
          return true
        }

        const haystack = normalizeText(`${program.programName} ${column.columnName}`)
        return hints.some((hint) => haystack.includes(hint))
      })

      const status: DraftFeasibilitySegmentReport['status'] =
        matches.length === 0 ? 'blocked' : matches.length < 2 ? 'warning' : 'ready'

      const reasons: string[] = []
      if (matches.length === 0) {
        reasons.push('当前频道下未找到可用于该栏目语义的候选节目。')
      } else if (matches.length < 2) {
        reasons.push('可选候选较少，正式编排时可能需要人工确认。')
      } else {
        reasons.push('已有足够候选可支持后续编排。')
      }

      if (!column.queryHints?.length) {
        reasons.push('当前栏目主要依赖节目类型匹配，建议补充语义关键词提升精度。')
      }

      return {
        segmentId: slot?.id ?? column.columnId,
        label: column.semanticLabel ?? column.columnName,
        startTime: slot?.startTime.split('T')[1]?.slice(0, 8) ?? draft.coverage.start,
        endTime: slot?.endTime.split('T')[1]?.slice(0, 8) ?? draft.coverage.end,
        status,
        matchedCandidateCount: matches.length,
        reasons,
      }
    })

    return {
      ok: !segments.some((segment) => segment.status === 'blocked'),
      summary: {
        readyCount: segments.filter((segment) => segment.status === 'ready').length,
        warningCount: segments.filter((segment) => segment.status === 'warning').length,
        blockedCount: segments.filter((segment) => segment.status === 'blocked').length,
      },
      segments,
    }
  }
}

let globalLayoutDraftFeasibilityService: LayoutDraftFeasibilityService | null = null

export function getLayoutDraftFeasibilityService(): LayoutDraftFeasibilityService {
  if (!globalLayoutDraftFeasibilityService) {
    globalLayoutDraftFeasibilityService = new LayoutDraftFeasibilityService()
  }
  return globalLayoutDraftFeasibilityService
}
