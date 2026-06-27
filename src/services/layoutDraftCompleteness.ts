import type { LayoutDraft } from '@/types/orchestration'

export type LayoutDraftCompletenessStatus = 'missing' | 'empty' | 'partial' | 'complete'

export interface LayoutDraftCompleteness {
  status: LayoutDraftCompletenessStatus
  slotCount: number
  coverageSeconds: number
  reason: string
}

const toClockText = (value: string | undefined): string => {
  if (!value) return '00:00:00'
  const text = value.includes('T') ? value.split('T')[1]?.slice(0, 8) : value
  if (!text) return '00:00:00'
  return text.length === 5 ? `${text}:00` : text.slice(0, 8)
}

const clockToSeconds = (value: string | undefined): number => {
  const [hours = '0', minutes = '0', seconds = '0'] = toClockText(value).split(':')
  return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds)
}

export const evaluateLayoutDraftCompleteness = (
  draft?: LayoutDraft | null,
): LayoutDraftCompleteness => {
  if (!draft) {
    return {
      status: 'missing',
      slotCount: 0,
      coverageSeconds: 0,
      reason: '未读取到当前播单可用的版面草案。',
    }
  }

  if (draft.draftKind === 'duration_segments' || draft.targetDurationSeconds || draft.durationSegments?.length) {
    const segmentCount = draft.durationSegments?.length ?? draft.layoutReference.slots.length
    const targetDurationSeconds = draft.targetDurationSeconds
      ?? draft.durationSegments?.reduce((sum, segment) => sum + segment.targetDurationSeconds, 0)
      ?? 0
    const plannedDurationSeconds = draft.durationSegments?.reduce((sum, segment) => sum + segment.targetDurationSeconds, 0)
      ?? targetDurationSeconds

    if (segmentCount === 0 || targetDurationSeconds <= 0 || plannedDurationSeconds <= 0) {
      return {
        status: 'empty',
        slotCount: segmentCount,
        coverageSeconds: 0,
        reason: '轮播草案还没有可用于选片的内容块或目标时长。',
      }
    }

    if (plannedDurationSeconds < targetDurationSeconds) {
      return {
        status: 'partial',
        slotCount: segmentCount,
        coverageSeconds: plannedDurationSeconds,
        reason: '轮播草案只覆盖部分目标时长，可以继续补充内容块。',
      }
    }

    return {
      status: 'complete',
      slotCount: segmentCount,
      coverageSeconds: plannedDurationSeconds,
      reason: '轮播草案已经给出内容块和目标总时长，可作为整体编排依据。',
    }
  }

  const slotCount = draft.layoutReference.slots.length
  const startSeconds = clockToSeconds(draft.coverage.start)
  const endSeconds = clockToSeconds(draft.coverage.end)
  const coverageSeconds = Math.max(0, endSeconds - startSeconds)

  if (slotCount === 0 || coverageSeconds === 0) {
    return {
      status: 'empty',
      slotCount,
      coverageSeconds,
      reason: '版面草案没有可用于编排的时段。',
    }
  }

  if (slotCount < 3 || startSeconds > 7 * 3600 || endSeconds < 23 * 3600 || coverageSeconds < 12 * 3600) {
    return {
      status: 'partial',
      slotCount,
      coverageSeconds,
      reason: '版面草案只覆盖部分时段，暂不足以作为全天编排依据。',
    }
  }

  return {
    status: 'complete',
    slotCount,
    coverageSeconds,
    reason: '版面草案覆盖全天主要播出窗口，可作为全天编排依据。',
  }
}
