import type { AgentIntentInterpretation, AgentProgramCandidate } from '@/services/agent/types'
import type { PlaylistType, RotationPlaylistStrategy, ScheduleItemSnapshot, TimeRange } from '@/types/orchestration'

export const nlMatrixDate = '2026-03-25'
export const nlMatrixChannelId = 'dragon'

export const buildNlMatrixItem = (patch: Partial<ScheduleItemSnapshot> = {}): ScheduleItemSnapshot => ({
  id: 'item-kdf-0900',
  programCode: 'KDF0900',
  programName: '看东方',
  instanceName: '看东方',
  startTime: '09:00:00',
  endTime: '09:30:00',
  duration: 1800,
  programType: 'news',
  columnId: 'news',
  columnName: '新闻',
  sequence: 1,
  ...patch,
})

export const buildNlMatrixCandidate = (patch: Partial<AgentProgramCandidate> = {}): AgentProgramCandidate => ({
  id: 'candidate-dfxw',
  programId: 'program-dfxw',
  programCode: 'DFXW1000',
  programName: '东方新闻',
  instanceName: '东方新闻',
  channelId: nlMatrixChannelId,
  columnId: 'news',
  columnName: '新闻',
  duration: 1800,
  programType: 'news',
  contentTags: ['新闻'],
  materialStatus: 'ready',
  rightsStatus: 'ready',
  ...patch,
})

export interface NaturalLanguageAtomicCase {
  id: string
  utterance: string
  playlistType: PlaylistType
  rotationStrategy?: RotationPlaylistStrategy
  items?: ScheduleItemSnapshot[]
  candidates?: AgentProgramCandidate[]
  lockedItemIds?: string[]
  blockedTimeRanges?: TimeRange[]
  interpretation: AgentIntentInterpretation
  expected: {
    status: 'executed' | 'needs_confirmation' | 'needs_selection' | 'needs_clarification' | 'blocked'
    intent?: AgentIntentInterpretation['intent']
    commandIntent?: AgentIntentInterpretation['intent']
    pendingIntent?: AgentIntentInterpretation['intent']
    issueCode?: string
    queryKind?: string
    committedCount?: number
    selectedCandidateId?: string
  }
}

const baseItems = [
  buildNlMatrixItem(),
  buildNlMatrixItem({
    id: 'item-news-1030',
    programCode: 'NEWS1030',
    programName: '东方新闻',
    instanceName: '东方新闻',
    startTime: '10:30:00',
    endTime: '11:00:00',
    sequence: 2,
  }),
]

const rotationItems = [
  buildNlMatrixItem({
    id: 'item-clip-0900',
    programCode: 'CLIP0900',
    programName: '早间轮播短片',
    instanceName: '早间轮播短片',
    startTime: '09:00:00',
    endTime: '09:00:30',
    duration: 30,
    programType: 'short_clip',
    columnId: 'rotation',
    columnName: '轮播',
  }),
]

const standardCandidates = [
  buildNlMatrixCandidate(),
  buildNlMatrixCandidate({
    id: 'candidate-lunch-news',
    programId: 'program-lunch-news',
    programCode: 'LUNCH1130',
    programName: '午间30分',
    instanceName: '午间30分',
    contentTags: ['新闻', '午间'],
  }),
  buildNlMatrixCandidate({
    id: 'asset-short-city-flower',
    programId: 'asset-short-city-flower',
    programCode: '',
    programName: '城市微短片：春日花路 30秒',
    instanceName: '城市微短片：春日花路 30秒',
    columnId: 'rotation',
    columnName: '轮播短片',
    duration: 30,
    programType: 'short_clip',
    contentTags: ['城市形象', '春日花路', '短片', '无节目编号', '轮播'],
  }),
]

export const naturalLanguageAtomicCommandCases: NaturalLanguageAtomicCase[] = [
  {
    id: 'move-name-to-time-tv',
    utterance: '把《看东方》移到10点',
    playlistType: 'tv',
    items: baseItems,
    interpretation: {
      intent: 'move',
      confidence: 0.96,
      source: 'test',
      slots: { targetProgramName: '看东方', newStartTime: '10:00:00' },
    },
    expected: { status: 'executed', commandIntent: 'move', committedCount: 2 },
  },
  {
    id: 'move-time-to-time-tv',
    utterance: '9点那档移到10点',
    playlistType: 'tv',
    items: baseItems,
    interpretation: {
      intent: 'move',
      confidence: 0.94,
      source: 'test',
      slots: { targetTime: '09:00:00', newStartTime: '10:00:00' },
    },
    expected: { status: 'executed', commandIntent: 'move', committedCount: 2 },
  },
  {
    id: 'move-name-offset-tv',
    utterance: '《看东方》往后挪半小时',
    playlistType: 'tv',
    items: baseItems,
    interpretation: {
      intent: 'move',
      confidence: 0.94,
      source: 'test',
      slots: { targetProgramName: '看东方', offsetSeconds: 1800, direction: 'forward' },
    },
    expected: { status: 'executed', commandIntent: 'move', committedCount: 2 },
  },
  {
    id: 'move-destination-occupied-blocked',
    utterance: '把《看东方》移到10点半',
    playlistType: 'tv',
    items: [
      buildNlMatrixItem(),
      buildNlMatrixItem({
        id: 'item-news-1000',
        programCode: 'NEWS1000',
        programName: '上午新闻',
        instanceName: '上午新闻',
        startTime: '10:00:00',
        endTime: '10:30:00',
        sequence: 2,
      }),
      buildNlMatrixItem({
        id: 'item-lunch-1030',
        programCode: 'LUNCH1030',
        programName: '午间30分',
        instanceName: '午间30分',
        startTime: '10:30:00',
        endTime: '11:00:00',
        sequence: 3,
      }),
    ],
    interpretation: {
      intent: 'move',
      confidence: 0.95,
      source: 'test',
      slots: { targetProgramName: '看东方', newStartTime: '10:30:00' },
    },
    expected: { status: 'blocked', commandIntent: 'move', issueCode: 'time_overlap', committedCount: 3 },
  },
  {
    id: 'move-locked-blocked',
    utterance: '把锁定的《看东方》移到10点',
    playlistType: 'tv',
    items: baseItems,
    lockedItemIds: ['item-kdf-0900'],
    interpretation: {
      intent: 'move',
      confidence: 0.95,
      source: 'test',
      slots: { targetProgramName: '看东方', newStartTime: '10:00:00' },
    },
    expected: { status: 'blocked', commandIntent: 'move', issueCode: 'locked_item', committedCount: 2 },
  },
  {
    id: 'move-ambiguous-target-needs-selection',
    utterance: '把《看东方》移到10点',
    playlistType: 'tv',
    items: [
      buildNlMatrixItem(),
      buildNlMatrixItem({
        id: 'item-kdf-1030',
        startTime: '10:30:00',
        endTime: '11:00:00',
        sequence: 2,
      }),
    ],
    interpretation: {
      intent: 'move',
      confidence: 0.93,
      source: 'test',
      slots: { targetProgramName: '看东方', newStartTime: '10:00:00' },
    },
    expected: { status: 'needs_clarification', pendingIntent: 'move', issueCode: 'target_ambiguous', committedCount: 2 },
  },
  {
    id: 'delete-name-tv-confirm',
    utterance: '删除看东方',
    playlistType: 'tv',
    items: baseItems,
    interpretation: {
      intent: 'delete',
      confidence: 0.96,
      source: 'test',
      slots: { targetProgramName: '看东方' },
    },
    expected: { status: 'needs_confirmation', commandIntent: 'delete', pendingIntent: 'delete', committedCount: 2 },
  },
  {
    id: 'delete-time-tv-confirm',
    utterance: '删掉9点那条',
    playlistType: 'tv',
    items: baseItems,
    interpretation: {
      intent: 'delete',
      confidence: 0.94,
      source: 'test',
      slots: { targetTime: '09:00:00' },
    },
    expected: { status: 'needs_confirmation', commandIntent: 'delete', pendingIntent: 'delete', committedCount: 2 },
  },
  {
    id: 'insert-tv-direct',
    utterance: '10点插入东方新闻',
    playlistType: 'tv',
    items: [buildNlMatrixItem()],
    candidates: standardCandidates,
    interpretation: {
      intent: 'insert',
      confidence: 0.95,
      source: 'test',
      slots: { targetTime: '10:00:00', programHint: '东方新闻' },
    },
    expected: { status: 'executed', commandIntent: 'insert', selectedCandidateId: 'candidate-dfxw', committedCount: 2 },
  },
  {
    id: 'insert-destination-occupied-blocked',
    utterance: '10点半插入东方新闻',
    playlistType: 'tv',
    items: [
      buildNlMatrixItem(),
      buildNlMatrixItem({
        id: 'item-news-1000',
        programCode: 'NEWS1000',
        programName: '上午新闻',
        instanceName: '上午新闻',
        startTime: '10:00:00',
        endTime: '10:30:00',
        sequence: 2,
      }),
      buildNlMatrixItem({
        id: 'item-lunch-1030',
        programCode: 'LUNCH1030',
        programName: '午间30分',
        instanceName: '午间30分',
        startTime: '10:30:00',
        endTime: '11:00:00',
        sequence: 3,
      }),
    ],
    candidates: standardCandidates,
    interpretation: {
      intent: 'insert',
      confidence: 0.95,
      source: 'test',
      slots: { targetTime: '10:30:00', programHint: '东方新闻' },
    },
    expected: { status: 'blocked', intent: 'insert', issueCode: 'time_overlap', committedCount: 3 },
  },
  {
    id: 'insert-rotation-confirm',
    utterance: '轮播单10点插入东方新闻',
    playlistType: 'rotation',
    rotationStrategy: 'content_match',
    items: rotationItems,
    candidates: standardCandidates,
    interpretation: {
      intent: 'insert',
      confidence: 0.94,
      source: 'test',
      slots: { targetTime: '10:00:00', programHint: '东方新闻' },
    },
    expected: { status: 'needs_confirmation', commandIntent: 'insert', pendingIntent: 'insert', selectedCandidateId: 'candidate-dfxw', committedCount: 1 },
  },
  {
    id: 'insert-rotation-short-clip-confirm',
    utterance: '10点插入城市形象春日花路短片',
    playlistType: 'rotation',
    rotationStrategy: 'content_match',
    items: rotationItems,
    candidates: standardCandidates,
    interpretation: {
      intent: 'insert',
      confidence: 0.95,
      source: 'test',
      slots: { targetTime: '10:00:00', programHint: '城市形象春日花路短片' },
    },
    expected: { status: 'needs_confirmation', commandIntent: 'insert', pendingIntent: 'insert', selectedCandidateId: 'asset-short-city-flower', committedCount: 1 },
  },
  {
    id: 'replace-tv-direct',
    utterance: '把9点的节目换成东方新闻',
    playlistType: 'tv',
    items: [buildNlMatrixItem()],
    candidates: standardCandidates,
    interpretation: {
      intent: 'replace',
      confidence: 0.95,
      source: 'test',
      slots: { targetTime: '09:00:00', replacementHint: '东方新闻' },
    },
    expected: { status: 'executed', commandIntent: 'replace', selectedCandidateId: 'candidate-dfxw', committedCount: 1 },
  },
  {
    id: 'replace-rotation-confirm',
    utterance: '把9点轮播换成春日花路短片',
    playlistType: 'rotation',
    rotationStrategy: 'content_match',
    items: rotationItems,
    candidates: standardCandidates,
    interpretation: {
      intent: 'replace',
      confidence: 0.94,
      source: 'test',
      slots: { targetTime: '09:00:00', replacementHint: '春日花路短片' },
    },
    expected: { status: 'needs_confirmation', commandIntent: 'replace', pendingIntent: 'replace', selectedCandidateId: 'asset-short-city-flower', committedCount: 1 },
  },
  {
    id: 'replace-overlap-blocked',
    utterance: '把9点节目换成一小时东方新闻',
    playlistType: 'tv',
    items: [
      buildNlMatrixItem(),
      buildNlMatrixItem({
        id: 'item-news-0930',
        programCode: 'NEWS0930',
        programName: '上午新闻',
        instanceName: '上午新闻',
        startTime: '09:30:00',
        endTime: '10:00:00',
        sequence: 2,
      }),
    ],
    candidates: [buildNlMatrixCandidate({
      id: 'candidate-dfxw-long',
      programCode: 'DFXW-LONG',
      duration: 3600,
      programName: '一小时东方新闻',
      instanceName: '一小时东方新闻',
    })],
    interpretation: {
      intent: 'replace',
      confidence: 0.95,
      source: 'test',
      slots: { targetTime: '09:00:00', replacementHint: '一小时东方新闻' },
    },
    expected: { status: 'blocked', commandIntent: 'replace', issueCode: 'time_overlap', committedCount: 2 },
  },
  {
    id: 'batch-move-range',
    utterance: '9点到11点的节目整体后移半小时',
    playlistType: 'tv',
    items: baseItems,
    interpretation: {
      intent: 'batch_move',
      confidence: 0.93,
      source: 'test',
      slots: { rangeStart: '09:00:00', rangeEnd: '11:00:00', offsetSeconds: 1800, direction: 'forward' },
    },
    expected: { status: 'executed', commandIntent: 'batch_move', committedCount: 2 },
  },
  {
    id: 'batch-delete-range-confirm',
    utterance: '删除9点到11点之间的节目',
    playlistType: 'tv',
    items: baseItems,
    interpretation: {
      intent: 'batch_delete',
      confidence: 0.93,
      source: 'test',
      slots: { rangeStart: '09:00:00', rangeEnd: '11:00:00' },
    },
    expected: { status: 'needs_confirmation', commandIntent: 'batch_delete', pendingIntent: 'batch_delete', committedCount: 2 },
  },
  {
    id: 'query-time',
    utterance: '查一下10点半排了什么',
    playlistType: 'tv',
    items: baseItems,
    interpretation: {
      intent: 'query',
      confidence: 0.95,
      source: 'test',
      queryKind: 'time_lookup',
      slots: { targetTime: '10:30:00' },
    },
    expected: { status: 'executed', intent: 'query', queryKind: 'time_lookup', committedCount: 2 },
  },
  {
    id: 'query-candidate-short-clip',
    utterance: '找没有节目编号的城市形象短片',
    playlistType: 'rotation',
    rotationStrategy: 'content_match',
    items: rotationItems,
    candidates: standardCandidates,
    interpretation: {
      intent: 'query',
      confidence: 0.95,
      source: 'test',
      queryKind: 'candidate_lookup',
      keyword: '城市形象短片',
    },
    expected: { status: 'executed', intent: 'query', queryKind: 'candidate_lookup', committedCount: 1 },
  },
  {
    id: 'query-program-by-name',
    utterance: '找《看东方》在哪个时段',
    playlistType: 'tv',
    items: baseItems,
    interpretation: {
      intent: 'query',
      confidence: 0.95,
      source: 'test',
      queryKind: 'program_lookup',
      keyword: '看东方',
    },
    expected: { status: 'executed', intent: 'query', queryKind: 'program_lookup', committedCount: 2 },
  },
  {
    id: 'query-summary',
    utterance: '看一下当前播单概览',
    playlistType: 'tv',
    items: baseItems,
    interpretation: {
      intent: 'query',
      confidence: 0.95,
      source: 'test',
      queryKind: 'schedule_summary',
    },
    expected: { status: 'executed', intent: 'query', queryKind: 'schedule_summary', committedCount: 2 },
  },
  {
    id: 'validate-current-schedule',
    utterance: '校验当前播单',
    playlistType: 'tv',
    items: baseItems,
    interpretation: {
      intent: 'validate',
      confidence: 0.96,
      source: 'test',
      slots: {},
    },
    expected: { status: 'executed', intent: 'validate', committedCount: 2 },
  },
  {
    id: 'insert-blocked-range',
    utterance: '10点插入东方新闻',
    playlistType: 'tv',
    items: [buildNlMatrixItem()],
    candidates: standardCandidates,
    blockedTimeRanges: [{ start: '10:00:00', end: '10:30:00' }],
    interpretation: {
      intent: 'insert',
      confidence: 0.95,
      source: 'test',
      slots: { targetTime: '10:00:00', programHint: '东方新闻' },
    },
    expected: { status: 'blocked', commandIntent: 'insert', issueCode: 'blocked_time_range', committedCount: 1 },
  },
  {
    id: 'insert-material-not-ready-blocked',
    utterance: '11点插入东方新闻',
    playlistType: 'tv',
    items: baseItems,
    candidates: [buildNlMatrixCandidate({
      programCode: 'DFXW1031',
      materialStatus: 'missing',
    })],
    interpretation: {
      intent: 'insert',
      confidence: 0.95,
      source: 'test',
      slots: { targetTime: '11:00:00', programHint: '东方新闻' },
    },
    expected: { status: 'blocked', intent: 'insert', issueCode: 'material_not_ready', committedCount: 2 },
  },
  {
    id: 'insert-rights-not-ready-blocked',
    utterance: '11点插入东方新闻',
    playlistType: 'tv',
    items: baseItems,
    candidates: [buildNlMatrixCandidate({
      programCode: 'DFXW1031',
      rightsStatus: 'blocked',
    })],
    interpretation: {
      intent: 'insert',
      confidence: 0.95,
      source: 'test',
      slots: { targetTime: '11:00:00', programHint: '东方新闻' },
    },
    expected: { status: 'blocked', intent: 'insert', issueCode: 'rights_not_ready', committedCount: 2 },
  },
  {
    id: 'insert-out-of-layout-bounds-blocked',
    utterance: '23点50插入东方新闻',
    playlistType: 'tv',
    items: baseItems,
    candidates: [buildNlMatrixCandidate({ programCode: 'DFXW1031' })],
    interpretation: {
      intent: 'insert',
      confidence: 0.95,
      source: 'test',
      slots: { targetTime: '23:50:00', programHint: '东方新闻' },
    },
    expected: { status: 'blocked', intent: 'insert', issueCode: 'out_of_layout_bounds', committedCount: 2 },
  },
  {
    id: 'insert-candidate-source-missing',
    utterance: '10点插入东方新闻',
    playlistType: 'tv',
    items: [buildNlMatrixItem()],
    interpretation: {
      intent: 'insert',
      confidence: 0.94,
      source: 'test',
      slots: { targetTime: '10:00:00', programHint: '东方新闻' },
    },
    expected: { status: 'blocked', intent: 'insert', issueCode: 'candidate_source_missing', committedCount: 1 },
  },
]
