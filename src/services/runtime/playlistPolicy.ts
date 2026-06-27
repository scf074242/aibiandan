import type { PlaylistType, RotationPlaylistStrategy, ScheduleState } from '@/types/orchestration'

export type RuntimePlaylistPlacementMode = 'fixed_time_slot' | 'continuous_sequence'
export type RuntimePlaylistReplaceMode = 'preserve_slot' | 'compact_sequence'
export type RuntimePlaylistDeleteMode = 'leave_gap' | 'compact_sequence'
export type RuntimePlaylistGapPolicy = 'preserve_gaps' | 'compact_sequence'
export type RuntimePlaylistDurationMode = 'fixed_clock' | 'strict_total_duration' | 'target_total_duration' | 'flexible_total_duration'

export interface RuntimePlaylistPolicy {
  playlistType: Exclude<PlaylistType, 'none'>
  placementMode: RuntimePlaylistPlacementMode
  replaceMode: RuntimePlaylistReplaceMode
  deleteMode: RuntimePlaylistDeleteMode
  gapPolicy: RuntimePlaylistGapPolicy
  durationMode: RuntimePlaylistDurationMode
  rotationStrategy?: RotationPlaylistStrategy
  targetDurationSeconds?: number
  userFacingSummary: string
  validationFocus: string[]
}

export const deriveRuntimePlaylistPolicy = (scheduleState: Pick<ScheduleState, 'playlistType' | 'rotationStrategy' | 'rotationDurationSeconds'>): RuntimePlaylistPolicy => {
  if (scheduleState.playlistType === 'rotation') {
    const targetDurationSeconds = scheduleState.rotationDurationSeconds
    return {
      playlistType: 'rotation',
      placementMode: 'continuous_sequence',
      replaceMode: 'compact_sequence',
      deleteMode: 'compact_sequence',
      gapPolicy: 'compact_sequence',
      durationMode: targetDurationSeconds ? 'target_total_duration' : 'flexible_total_duration',
      rotationStrategy: scheduleState.rotationStrategy ?? 'content_match',
      targetDurationSeconds,
      userFacingSummary: targetDurationSeconds
        ? '轮播单按内容队列处理，节目会自然串联；本单有目标总时长，操作后需要检查时长差额。'
        : '轮播单按内容队列处理，插入、删除、替换后节目会自然串联，不生成电视式空窗。',
      validationFocus: ['总时长差额', '内容比例', '重复度', '用途和主题', '候选是否足够'],
    }
  }

  return {
    playlistType: 'tv',
    placementMode: 'fixed_time_slot',
    replaceMode: 'preserve_slot',
    deleteMode: 'leave_gap',
    gapPolicy: 'preserve_gaps',
    durationMode: 'fixed_clock',
    userFacingSummary: '电视播单按固定时间格子处理，替换默认保留原时段，删除默认留下空窗。',
    validationFocus: ['空窗', '时间冲突', '后续节目占用', '连续剧顺序', '栏目匹配'],
  }
}

export const describeRuntimePlaylistStrategy = (strategy?: RotationPlaylistStrategy): string => {
  if (strategy === 'rating') return '收视率优先'
  if (strategy === 'trending') return '热播优先'
  return '内容匹配优先'
}
