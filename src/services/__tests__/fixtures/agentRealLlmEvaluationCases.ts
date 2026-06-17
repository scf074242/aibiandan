import { createPendingTask } from '@/services/agent/agentSession'
import { buildAgentPendingContextFingerprint, buildAgentPendingContextSourceSnapshots } from '@/services/agent/contextFingerprint'
import { InMemorySchedulingDataGateway } from '@/services/agent/inMemorySchedulingDataGateway'
import { buildAgentLlmContextPackage } from '@/services/agent/llmContextPackage'
import type { AgentLlmIntentEvaluationCase } from '@/services/agent/llmIntentEvaluation'
import {
  buildNlMatrixCandidate,
  buildNlMatrixItem,
  nlMatrixChannelId,
  nlMatrixDate,
} from './naturalLanguageAtomicCommandCases'

export const buildAgentRealLlmEvaluationCases = async (): Promise<AgentLlmIntentEvaluationCase[]> => {
  const tvGateway = new InMemorySchedulingDataGateway([{
    channelId: nlMatrixChannelId,
    date: nlMatrixDate,
    playlistType: 'tv',
    scheduleItems: [
      buildNlMatrixItem({
        id: 'item-kdf-0900',
        programName: '看东方',
        instanceName: '看东方',
        startTime: '09:00:00',
        endTime: '09:30:00',
      }),
      buildNlMatrixItem({
        id: 'item-news-1030',
        programName: '上午新闻',
        instanceName: '上午新闻',
        startTime: '10:30:00',
        endTime: '11:00:00',
        issueNo: '1030',
        sequence: 2,
      }),
    ],
    programCandidates: [
      buildNlMatrixCandidate({
        id: 'candidate-dfxw-1031',
        issueNo: '1031',
        programCode: 'DFXW1031',
        programName: '东方新闻',
        instanceName: '东方新闻',
      }),
      buildNlMatrixCandidate({
        id: 'candidate-dfxw-material-missing',
        programCode: 'DFXW1031',
        programName: '东方新闻 素材未就绪版',
        instanceName: '东方新闻 素材未就绪版',
        materialStatus: 'missing',
      }),
      buildNlMatrixCandidate({
        id: 'candidate-dfxw-rights-blocked',
        programCode: 'DFXW1031',
        programName: '东方新闻 版权阻断版',
        instanceName: '东方新闻 版权阻断版',
        rightsStatus: 'blocked',
      }),
    ],
    historySchedules: [{
      date: '2026-03-24',
      itemCount: 1,
      programTypes: { news: 1 },
      items: [
        buildNlMatrixItem({
          id: 'history-dfxw-1030',
          issueNo: '1030',
          programName: '东方新闻',
          programCode: 'DFXW1030',
          sequence: 1030,
        }),
      ],
    }],
    layoutBounds: { start: '06:00:00', end: '23:59:59' },
  }])
  const rotationGateway = new InMemorySchedulingDataGateway([{
    channelId: nlMatrixChannelId,
    date: nlMatrixDate,
    playlistType: 'rotation',
    rotationStrategy: 'content_match',
    scheduleItems: [
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
    ],
    programCandidates: [
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
      buildNlMatrixCandidate({
        id: 'candidate-dfxw',
        programCode: 'DFXW1000',
        programName: '东方新闻',
        instanceName: '东方新闻',
      }),
    ],
    layoutBounds: { start: '06:00:00', end: '23:59:59' },
  }])

  const tvContext = await tvGateway.loadContext({ userInput: '', channelId: nlMatrixChannelId, date: nlMatrixDate })
  const rotationContext = await rotationGateway.loadContext({ userInput: '', channelId: nlMatrixChannelId, date: nlMatrixDate })
  const tvInput = {
    channelId: nlMatrixChannelId,
    date: nlMatrixDate,
    llmContextPackage: buildAgentLlmContextPackage(tvContext),
  }
  const rotationInput = {
    channelId: nlMatrixChannelId,
    date: nlMatrixDate,
    llmContextPackage: buildAgentLlmContextPackage(rotationContext),
  }
  const pendingContextSources = buildAgentPendingContextSourceSnapshots(tvContext)
  const pendingContextFingerprint = buildAgentPendingContextFingerprint(tvContext)
  const pendingInsertMissingTime = createPendingTask({
    intent: 'insert',
    phase: 'needs_clarification',
    originalInput: '插入东方新闻',
    collectedSlots: {
      programHint: { value: '东方新闻', source: 'user_initial', confidence: 0.92 },
    },
    missingSlots: ['targetTime'],
    contextFingerprint: pendingContextFingerprint,
    contextSources: pendingContextSources,
  })
  const pendingDeleteConfirm = createPendingTask({
    intent: 'delete',
    phase: 'needs_confirmation',
    originalInput: '删除看东方',
    collectedSlots: {
      targetProgramName: { value: '看东方', source: 'user_initial', confidence: 0.94 },
      targetItemId: { value: 'item-kdf-0900', source: 'system_inferred', confidence: 0.98 },
    },
    missingSlots: ['confirmation'],
    contextFingerprint: pendingContextFingerprint,
    contextSources: pendingContextSources,
  })

  return [
    { id: 'move-program-name-to-time', tags: ['move', 'tv'], userInput: '把《看东方》移到10点', input: tvInput, expected: { intent: 'move', requiredSlotKeys: ['targetProgramName', 'newStartTime'], minConfidence: 0.75 } },
    { id: 'move-time-to-time', tags: ['move', 'tv'], userInput: '9点那档移到10点', input: tvInput, expected: { intent: 'move', requiredSlotKeys: ['targetTime', 'newStartTime'], minConfidence: 0.75 } },
    { id: 'move-destination-occupied', tags: ['move', 'target_occupied'], userInput: '把《看东方》移到10点半', input: tvInput, expected: { intent: 'move', requiredSlotKeys: ['targetProgramName', 'newStartTime'], minConfidence: 0.75 } },
    { id: 'delete-program-name', tags: ['delete', 'tv'], userInput: '删除看东方', input: tvInput, expected: { intent: 'delete', requiredSlotKeys: ['targetProgramName'], minConfidence: 0.75 } },
    { id: 'delete-time-slot', tags: ['delete', 'tv'], userInput: '删掉9点那条', input: tvInput, expected: { intent: 'delete', requiredSlotKeys: ['targetTime'], minConfidence: 0.75 } },
    { id: 'insert-tv-next-episode', tags: ['insert', 'tv_sequence'], userInput: '11点接着排东方新闻下一集', input: tvInput, expected: { intent: 'insert', requiredSlotKeys: ['targetTime', 'programHint'], minConfidence: 0.75 } },
    { id: 'insert-tv-occupied', tags: ['insert', 'target_occupied'], userInput: '10点半插入东方新闻', input: tvInput, expected: { intent: 'insert', requiredSlotKeys: ['targetTime', 'programHint'], minConfidence: 0.75 } },
    { id: 'insert-material-missing', tags: ['insert', 'professional_refusal'], userInput: '11点插入素材未就绪的东方新闻', input: tvInput, expected: { intent: 'insert', requiredSlotKeys: ['targetTime', 'programHint'], minConfidence: 0.7 } },
    { id: 'insert-rights-blocked', tags: ['insert', 'professional_refusal'], userInput: '11点插入版权阻断版东方新闻', input: tvInput, expected: { intent: 'insert', requiredSlotKeys: ['targetTime', 'programHint'], minConfidence: 0.7 } },
    { id: 'insert-out-of-bounds', tags: ['insert', 'professional_refusal'], userInput: '23点50插入东方新闻', input: tvInput, expected: { intent: 'insert', requiredSlotKeys: ['targetTime', 'programHint'], minConfidence: 0.75 } },
    { id: 'insert-rotation-short-clip', tags: ['insert', 'rotation_short_clip'], userInput: '10点插入城市形象春日花路短片', input: rotationInput, expected: { intent: 'insert', requiredSlotKeys: ['targetTime', 'programHint'], minConfidence: 0.75 } },
    { id: 'replace-tv-slot', tags: ['replace', 'tv'], userInput: '把9点的节目换成东方新闻', input: tvInput, expected: { intent: 'replace', requiredSlotKeys: ['targetTime', 'replacementHint'], minConfidence: 0.75 } },
    { id: 'replace-rotation-short-clip', tags: ['replace', 'rotation_short_clip'], userInput: '把9点轮播换成春日花路短片', input: rotationInput, expected: { intent: 'replace', requiredSlotKeys: ['targetTime', 'replacementHint'], minConfidence: 0.75 } },
    { id: 'batch-move-range', tags: ['batch_move', 'tv'], userInput: '9点到11点的节目整体后移半小时', input: tvInput, expected: { intent: 'batch_move', requiredSlotKeys: ['rangeStart', 'rangeEnd', 'offsetSeconds'], minConfidence: 0.75 } },
    { id: 'batch-delete-range', tags: ['batch_delete', 'tv'], userInput: '删除9点到11点之间的节目', input: tvInput, expected: { intent: 'batch_delete', requiredSlotKeys: ['rangeStart', 'rangeEnd'], minConfidence: 0.75 } },
    { id: 'query-time', tags: ['query', 'tv'], userInput: '查一下10点半排了什么', input: tvInput, expected: { intent: 'query', queryKind: 'time_lookup', requiredSlotKeys: ['targetTime'], minConfidence: 0.75 } },
    { id: 'query-program', tags: ['query', 'tv'], userInput: '找《看东方》在哪个时段', input: tvInput, expected: { intent: 'query', queryKind: 'program_lookup', minConfidence: 0.75 } },
    { id: 'query-short-clip-candidates', tags: ['query', 'rotation_short_clip'], userInput: '找没有节目编号的城市形象短片', input: rotationInput, expected: { intent: 'query', queryKind: 'candidate_lookup', minConfidence: 0.75 } },
    { id: 'validate-current-schedule', tags: ['validate', 'tv'], userInput: '校验当前播单', input: tvInput, expected: { intent: 'validate', minConfidence: 0.75 } },
    { id: 'pending-continue-missing-time', tags: ['pending_context', 'missing_param'], userInput: '放到11点', input: { ...tvInput, pendingTask: pendingInsertMissingTime }, expected: { intent: 'insert', pendingAction: 'continue_pending', requiredSlotKeys: ['targetTime'], minConfidence: 0.7 } },
    { id: 'pending-confirm-delete', tags: ['pending_context', 'confirm'], userInput: '确认', input: { ...tvInput, pendingTask: pendingDeleteConfirm }, expected: { intent: 'delete', pendingAction: 'confirm', minConfidence: 0.7 } },
    { id: 'pending-cancel-delete', tags: ['pending_context', 'cancel'], userInput: '取消刚才的删除', input: { ...tvInput, pendingTask: pendingDeleteConfirm }, expected: { intent: 'delete', pendingAction: 'cancel_pending', minConfidence: 0.7 } },
    { id: 'pending-start-new-query', tags: ['pending_context', 'start_new_task'], userInput: '先查一下东方新闻候选', input: { ...tvInput, pendingTask: pendingInsertMissingTime }, expected: { intent: 'query', pendingAction: 'start_new_task', queryKind: 'candidate_lookup', minConfidence: 0.7 } },
  ]
}
