import { createPendingTask } from '@/services/agent/agentSession'
import { buildAgentPendingContextFingerprint, buildAgentPendingContextSourceSnapshots } from '@/services/agent/contextFingerprint'
import { InMemorySchedulingDataGateway } from '@/services/agent/inMemorySchedulingDataGateway'
import type { AgentLlmRuntimeEvaluationCase } from '@/services/agent/llmRuntimeEvaluation'
import type { AgentLlmRuntimeConversationCase } from '@/services/agent/llmRuntimeEvaluation'
import type { AgentIntentInterpretation } from '@/services/agent/types'
import {
  buildNlMatrixCandidate,
  buildNlMatrixItem,
  naturalLanguageAtomicCommandCases,
  nlMatrixChannelId,
  nlMatrixDate,
} from './naturalLanguageAtomicCommandCases'

export type AgentRealLlmRuntimeEvaluationCase = AgentLlmRuntimeEvaluationCase & {
  offlineInterpretation: AgentIntentInterpretation
}

export type AgentRealLlmConversationEvaluationCase = AgentLlmRuntimeConversationCase & {
  offlineInterpretations: AgentIntentInterpretation[]
}

export const buildAgentRealLlmRuntimeEvaluationCases = async (): Promise<AgentRealLlmRuntimeEvaluationCase[]> => {
  const cases: AgentRealLlmRuntimeEvaluationCase[] = [
    fromNaturalCase('move-name-to-time-tv', ['move', 'preview']),
    fromNaturalCase('move-destination-occupied-blocked', ['move', 'target_occupied', 'blocked']),
    fromNaturalCase('delete-name-tv-confirm', ['delete', 'pending_context']),
    fromNaturalCase('insert-destination-occupied-blocked', ['insert', 'target_occupied', 'blocked']),
    fromNaturalCase('insert-rotation-short-clip-confirm', ['insert', 'rotation_short_clip', 'pending_context']),
    fromNaturalCase('query-program-by-name', ['query']),
    fromNaturalCase('validate-current-schedule', ['validate']),
    fromNaturalCase('insert-material-not-ready-blocked', ['professional_refusal', 'blocked']),
    fromNaturalCase('insert-rights-not-ready-blocked', ['professional_refusal', 'blocked']),
    fromNaturalCase('insert-out-of-layout-bounds-blocked', ['professional_refusal', 'blocked']),
    buildTvSequenceCase(),
    await buildPendingMissingParameterCase(),
  ]

  return cases
}

export const buildAgentRealLlmConversationEvaluationCases = (): AgentRealLlmConversationEvaluationCase[] => [
  {
    id: 'conversation-insert-missing-time-then-fill',
    tags: ['pending_context', 'missing_param', 'insert', 'preview'],
    input: {
      channelId: nlMatrixChannelId,
      date: nlMatrixDate,
    },
    buildDataGateway: buildConversationGateway,
    turns: [
      {
        userInput: '插入东方新闻',
        expected: {
          status: 'needs_clarification',
          intent: 'insert',
          pendingIntent: 'insert',
          issueCode: 'missing_required_slot',
          committedCount: 2,
        },
      },
      {
        userInput: '放到11点',
        expected: {
          status: 'executed',
          commandIntent: 'insert',
          minPreviewSummaryItems: 3,
          committedCount: 3,
        },
      },
    ],
    expectedCommittedCount: 3,
    offlineInterpretations: [
      {
        intent: 'insert',
        confidence: 0.95,
        source: 'test',
        slots: { programHint: '东方新闻' },
      },
      {
        intent: 'insert',
        pendingAction: 'continue_pending',
        confidence: 0.95,
        source: 'test',
        slots: { targetTime: '11:00:00' },
      },
    ],
  },
  {
    id: 'conversation-delete-then-confirm',
    tags: ['pending_context', 'confirm', 'delete'],
    input: {
      channelId: nlMatrixChannelId,
      date: nlMatrixDate,
    },
    buildDataGateway: buildConversationGateway,
    turns: [
      {
        userInput: '删除看东方',
        expected: {
          status: 'needs_confirmation',
          commandIntent: 'delete',
          pendingIntent: 'delete',
          minPreviewSummaryItems: 3,
          committedCount: 2,
        },
      },
      {
        userInput: '确认',
        expected: {
          status: 'executed',
          commandIntent: 'delete',
          minPreviewSummaryItems: 3,
          committedCount: 1,
        },
      },
    ],
    expectedCommittedCount: 1,
    offlineInterpretations: [
      {
        intent: 'delete',
        confidence: 0.96,
        source: 'test',
        slots: { targetProgramName: '看东方' },
      },
      {
        intent: 'delete',
        pendingAction: 'confirm',
        confidence: 0.96,
        source: 'test',
      },
    ],
  },
]

const buildConversationGateway = () => new InMemorySchedulingDataGateway([{
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
      id: 'item-dfxw-1030',
      programCode: 'DFXW1030',
      programName: '东方新闻',
      instanceName: '东方新闻',
      startTime: '10:30:00',
      endTime: '11:00:00',
      issueNo: '1030',
      sequence: 1030,
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
  ],
  layoutBounds: { start: '06:00:00', end: '23:59:59' },
}])

const fromNaturalCase = (id: string, tags: string[]): AgentRealLlmRuntimeEvaluationCase => {
  const testCase = naturalLanguageAtomicCommandCases.find((item) => item.id === id)
  if (!testCase) {
    throw new Error(`Missing natural-language atomic case: ${id}`)
  }

  return {
    id: `runtime-${testCase.id}`,
    userInput: testCase.utterance,
    tags,
    input: {
      channelId: nlMatrixChannelId,
      date: nlMatrixDate,
    },
    buildDataGateway: () => new InMemorySchedulingDataGateway([{
      channelId: nlMatrixChannelId,
      date: nlMatrixDate,
      playlistType: testCase.playlistType,
      rotationStrategy: testCase.rotationStrategy,
      scheduleItems: testCase.items ?? [buildNlMatrixItem()],
      programCandidates: testCase.candidates,
      broadcastReadiness: [],
      historySchedules: [],
      lockedItemIds: testCase.lockedItemIds ?? [],
      blockedTimeRanges: testCase.blockedTimeRanges ?? [],
      layoutBounds: { start: '06:00:00', end: '23:59:59' },
    }]),
    expected: {
      status: testCase.expected.status,
      intent: testCase.expected.intent,
      commandIntent: testCase.expected.commandIntent,
      pendingIntent: testCase.expected.pendingIntent,
      issueCode: testCase.expected.issueCode,
      queryKind: testCase.expected.queryKind,
      minPreviewSummaryItems: testCase.expected.commandIntent ? 3 : undefined,
      committedCount: testCase.expected.committedCount,
    },
    offlineInterpretation: testCase.interpretation,
  }
}

const buildTvSequenceCase = (): AgentRealLlmRuntimeEvaluationCase => ({
  id: 'runtime-insert-tv-next-episode',
  userInput: '11点接着排东方新闻下一集',
  tags: ['insert', 'tv_sequence', 'preview'],
  input: {
    channelId: nlMatrixChannelId,
    date: nlMatrixDate,
  },
  buildDataGateway: () => new InMemorySchedulingDataGateway([{
    channelId: nlMatrixChannelId,
    date: nlMatrixDate,
    playlistType: 'tv',
    scheduleItems: [
      buildNlMatrixItem(),
      buildNlMatrixItem({
        id: 'item-dfxw-1030',
        programCode: 'DFXW1030',
        programName: '东方新闻',
        instanceName: '东方新闻',
        startTime: '10:30:00',
        endTime: '11:00:00',
        issueNo: '1030',
        sequence: 1030,
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
    ],
    historySchedules: [{
      date: '2026-03-24',
      itemCount: 1,
      programTypes: { news: 1 },
      items: [
        buildNlMatrixItem({
          id: 'history-dfxw-1029',
          issueNo: '1029',
          programName: '东方新闻',
          programCode: 'DFXW1029',
          sequence: 1029,
        }),
      ],
    }],
    layoutBounds: { start: '06:00:00', end: '23:59:59' },
  }]),
  expected: {
    status: 'executed',
    commandIntent: 'insert',
    minPreviewSummaryItems: 3,
    committedCount: 3,
  },
  offlineInterpretation: {
    intent: 'insert',
    confidence: 0.95,
    source: 'test',
    slots: { targetTime: '11:00:00', programHint: '东方新闻下一集' },
  },
})

const buildPendingMissingParameterCase = async (): Promise<AgentRealLlmRuntimeEvaluationCase> => {
  const seedGateway = new InMemorySchedulingDataGateway([{
    channelId: nlMatrixChannelId,
    date: nlMatrixDate,
    playlistType: 'tv',
    scheduleItems: [
      buildNlMatrixItem(),
      buildNlMatrixItem({
        id: 'item-dfxw-1030',
        programCode: 'DFXW1030',
        programName: '东方新闻',
        instanceName: '东方新闻',
        startTime: '10:30:00',
        endTime: '11:00:00',
        issueNo: '1030',
        sequence: 1030,
      }),
    ],
    programCandidates: [
      buildNlMatrixCandidate({
        id: 'candidate-dfxw-1031',
        programCode: 'DFXW1031',
        programName: '东方新闻',
        instanceName: '东方新闻',
        issueNo: '1031',
      }),
    ],
    layoutBounds: { start: '06:00:00', end: '23:59:59' },
  }])
  const context = await seedGateway.loadContext({
    userInput: '',
    channelId: nlMatrixChannelId,
    date: nlMatrixDate,
  })
  const pendingTask = createPendingTask({
    intent: 'insert',
    phase: 'needs_clarification',
    originalInput: '插入东方新闻',
    collectedSlots: {
      programHint: { value: '东方新闻', source: 'user_initial', confidence: 0.92 },
    },
    missingSlots: ['targetTime'],
    contextFingerprint: buildAgentPendingContextFingerprint(context),
    contextSources: buildAgentPendingContextSourceSnapshots(context),
  })

  return {
    id: 'runtime-pending-continue-missing-time',
    userInput: '放到11点',
    tags: ['pending_context', 'missing_param', 'insert'],
    input: {
      channelId: nlMatrixChannelId,
      date: nlMatrixDate,
      pendingTask,
    },
    buildDataGateway: () => new InMemorySchedulingDataGateway([{
      channelId: nlMatrixChannelId,
      date: nlMatrixDate,
      playlistType: 'tv',
      scheduleItems: [
        buildNlMatrixItem(),
        buildNlMatrixItem({
          id: 'item-dfxw-1030',
          programCode: 'DFXW1030',
          programName: '东方新闻',
          instanceName: '东方新闻',
          startTime: '10:30:00',
          endTime: '11:00:00',
          issueNo: '1030',
          sequence: 1030,
        }),
      ],
      programCandidates: [
        buildNlMatrixCandidate({
          id: 'candidate-dfxw-1031',
          programCode: 'DFXW1031',
          programName: '东方新闻',
          instanceName: '东方新闻',
          issueNo: '1031',
        }),
      ],
      layoutBounds: { start: '06:00:00', end: '23:59:59' },
    }]),
    expected: {
      status: 'executed',
      commandIntent: 'insert',
      minPreviewSummaryItems: 3,
      committedCount: 3,
    },
    offlineInterpretation: {
      intent: 'insert',
      pendingAction: 'continue_pending',
      confidence: 0.95,
      source: 'test',
      slots: { targetTime: '11:00:00' },
    },
  }
}
