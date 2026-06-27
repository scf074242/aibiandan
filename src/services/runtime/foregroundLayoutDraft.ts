import { getOrchestrationDemoLayout } from '@/mock/orchestrationMock'
import { toClockText } from '@/services/agent/time'
import { getLayoutDraftCompiler } from '@/services/layoutDraftCompiler'
import {
  getEffectiveColumnDefinition,
  getRuntimeLayoutEntry,
  type RuntimeLayoutEntry,
} from '@/services/orchestration/runtimeLayoutRegistry'
import type {
  ColumnDefinition,
  DraftSegmentSelectionPolicy,
  GeneratedColumnDefinition,
  LayoutDraft,
  LayoutDraftStrategyProfile,
  LayoutReference,
  LayoutSlot,
  PlaylistType,
} from '@/types/orchestration'

export interface ResolveForegroundLayoutDraftInput {
  channelId: string
  channelName: string
  date: string
  playlistType?: PlaylistType
  userIntent?: string
}

const columnSourceForDraft = (source: LayoutDraft['source']): GeneratedColumnDefinition['source'] => {
  if (source === 'uploaded') return 'imported'
  if (source === 'channel_default') return 'default'
  return 'generated'
}

const buildColumnMap = (entry?: RuntimeLayoutEntry | null) => new Map(
  (entry?.columns ?? []).map((column) => [column.columnId, column] as const),
)

const getSlotColumn = (
  slot: LayoutSlot,
  runtimeColumnMap: Map<string, ColumnDefinition>,
) => runtimeColumnMap.get(slot.columnId) ?? getEffectiveColumnDefinition(slot.columnId)

const buildTvSegmentPolicy = (isSequential: boolean | undefined): DraftSegmentSelectionPolicy => ({
  primary: 'sequence',
  fallback: ['content_match'],
  requiresPreviousSchedule: Boolean(isSequential),
  notes: isSequential
    ? ['连续栏目优先衔接历史播出进度。']
    : ['按栏目名称或具体节目名称匹配节目库。'],
})

const buildCarouselSegmentPolicy = (): DraftSegmentSelectionPolicy => ({
  primary: 'content_match',
  fallback: ['rating', 'trending'],
  requiresPreviousSchedule: false,
  notes: ['轮播单不沿用频道顺播进度，按上传草案中的名称、关键词或描述独立选片。'],
})

const defaultConstraintKindForSource = (
  source: LayoutDraft['source'],
): NonNullable<ColumnDefinition['draftConstraintKind']> =>
  source === 'uploaded' ? 'unspecified' : 'column'

const addMonthsToDateText = (date: string, months: number): string => {
  const [year = 0, month = 1, day = 1] = date.split('-').map((part) => Number(part))
  if (!year) return date
  const value = new Date(Date.UTC(year, month - 1, day))
  value.setUTCMonth(value.getUTCMonth() + months)
  return [
    value.getUTCFullYear(),
    String(value.getUTCMonth() + 1).padStart(2, '0'),
    String(value.getUTCDate()).padStart(2, '0'),
  ].join('-')
}

const buildDefaultTvStrategyProfile = (draft: LayoutDraft, channelName: string): LayoutDraftStrategyProfile => {
  const referenceDate = '上一播出日'
  const segmentPolicies = Object.fromEntries(
    draft.layoutReference.slots.map((slot, index) => [
      slot.id,
      buildTvSegmentPolicy(draft.columns[index]?.isSequential),
    ]),
  )

  return {
    kind: 'tv_channel',
    label: '电视播单编排策略',
    reasoning: `${channelName}按电视频道节目单处理，正式编排时优先遵守频道栏目版面。`,
    requiresPreviousSchedule: true,
    referenceDate,
    selectionPriority: 'sequence',
    strategyBasis: 'previous_schedule_sequence',
    contextSummary: `正式编排时读取${referenceDate}播出记录，检查连续剧顺序。`,
    selectionSummary: '按栏目名称或具体节目名称匹配节目库；连续剧场类栏目按历史进度续播。',
    constraintSummary: '电视播单草案不使用轮播关键词策略，缺集、冲突或候选不足时转人工确认或留空。',
    selectionRules: [
      `读取${referenceDate}编排记录，识别同系列已播进度。`,
      '栏目类时段按栏目名称匹配候选节目；具体节目名时段按节目名称精确优先。',
      '连续剧场类栏目优先选择下一集，缺集、跳集或倒序时进入人工确认。',
    ],
    keywordPolicy: 'soft_match',
    segmentPolicies,
  }
}

const buildDefaultCarouselStrategyProfile = (draft: LayoutDraft): LayoutDraftStrategyProfile => {
  const segmentPolicies = Object.fromEntries(
    draft.layoutReference.slots.map((slot) => [
      slot.id,
      buildCarouselSegmentPolicy(),
    ]),
  )

  return {
    kind: 'carousel',
    label: '轮播单编排策略',
    reasoning: '轮播单草案仅在用户上传或生成后存在；正式编排时按草案中的名称、关键词或描述独立匹配节目库。',
    requiresPreviousSchedule: false,
    selectionPriority: 'content_match',
    strategyBasis: 'content_match',
    contextSummary: '不读取电视频道上一播出日顺播进度，候选选择只围绕当前轮播单目标。',
    selectionSummary: '按上传草案中的名称、关键词或描述匹配节目库；命中不足时保留空缺或请求人工确认。',
    constraintSummary: '轮播草案允许关键词和描述语句，不自动套用电视栏目顺播规则。',
    selectionRules: [
      '先满足草案名称、关键词或描述的内容匹配。',
      '候选不足时可回退到收视率或热度排序，但不虚构节目。',
      '时长不满足当前空窗时保留空缺或进入人工确认。',
    ],
    keywordPolicy: 'soft_match',
    segmentPolicies,
  }
}

const buildDraftFromReference = (input: {
  channelId: string
  channelName: string
  date: string
  userIntent: string
  source: LayoutDraft['source']
  playlistType: Exclude<PlaylistType, 'none'>
  layoutReference: LayoutReference
  runtimeEntry?: RuntimeLayoutEntry | null
}): LayoutDraft => {
  const runtimeColumnMap = buildColumnMap(input.runtimeEntry)
  const spec = {
    coverage: {
      start: toClockText(input.layoutReference.slots[0]?.startTime ?? '00:00:00'),
      end: toClockText(input.layoutReference.slots.at(-1)?.endTime ?? '23:59:59'),
    },
    segments: input.layoutReference.slots.map((slot, index) => {
      const column = getSlotColumn(slot, runtimeColumnMap)
      const label = column?.semanticLabel ?? column?.columnName ?? `时段${index + 1}`
      return {
        id: slot.id,
        label,
        startTime: toClockText(slot.startTime),
        endTime: toClockText(slot.endTime),
        programType: column?.defaultProgramType ?? 'news_magazine',
        constraintKind: column?.draftConstraintKind ?? defaultConstraintKindForSource(input.source),
        queryHints: column?.queryHints ?? (/[\u4e00-\u9fa5]/u.test(label) ? [label] : []),
        sequential: column?.isSequential,
      }
    }),
  }
  const compiler = getLayoutDraftCompiler()
  const draft = compiler.compile(spec, {
    channelId: input.channelId,
    channelName: input.channelName,
    date: input.date,
    userIntent: input.userIntent,
    source: input.source,
    version: input.runtimeEntry?.version,
  })
  draft.effectiveFrom = input.runtimeEntry?.effectiveFrom
    ?? (input.source === 'channel_default' ? input.date : undefined)
  draft.effectiveTo = input.runtimeEntry?.effectiveTo
    ?? (input.source === 'channel_default' ? addMonthsToDateText(input.date, 3) : undefined)
  draft.warnings = input.runtimeEntry?.warnings
  draft.columns = draft.columns.map((column) => ({
    ...column,
    draftConstraintKind: column.draftConstraintKind ?? defaultConstraintKindForSource(input.source),
    source: columnSourceForDraft(input.source),
  }))
  draft.strategyProfile = input.playlistType === 'rotation'
    ? buildDefaultCarouselStrategyProfile(draft)
    : buildDefaultTvStrategyProfile(draft, input.channelName)
  return draft
}

export const resolveForegroundLayoutDraft = (
  input: ResolveForegroundLayoutDraftInput,
): LayoutDraft | null => {
  const playlistType = input.playlistType === 'rotation' ? 'rotation' : 'tv'
  const userIntent = input.userIntent ?? (
    playlistType === 'rotation'
      ? '前台轮播单读取上传版面草案'
      : '前台电视播单自动读取版面草案'
  )
  const runtimeEntry = getRuntimeLayoutEntry(input.channelId, input.date)
  if (runtimeEntry?.templateMode) {
    return buildDraftFromReference({
      channelId: input.channelId,
      channelName: input.channelName,
      date: input.date,
      userIntent,
      source: 'uploaded',
      playlistType,
      layoutReference: runtimeEntry.layoutReference,
      runtimeEntry,
    })
  }

  if (playlistType === 'rotation') return null

  const defaultLayout = getOrchestrationDemoLayout(input.channelId, input.date)
  if (!defaultLayout) return null
  return buildDraftFromReference({
    channelId: input.channelId,
    channelName: input.channelName,
    date: input.date,
    userIntent,
    source: 'channel_default',
    playlistType,
    layoutReference: defaultLayout,
  })
}
