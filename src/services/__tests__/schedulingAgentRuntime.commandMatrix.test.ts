import { describe, expect, it } from 'vitest'

import { InMemorySchedulingDataGateway } from '@/services/agent/inMemorySchedulingDataGateway'
import { auditSchedulingAgentV1Readiness } from '@/services/agent/agentReadinessAudit'
import { buildPendingLlmContext } from '@/services/agent/agentSession'
import { RuntimeSchedulingDataGateway } from '@/services/agent/runtimeSchedulingDataGateway'
import { SchedulingAgentRuntime } from '@/services/agent/schedulingAgentRuntime'
import type { AgentBroadcastReadinessEvidence, AgentCapability, AgentIntentInterpretation, AgentProgramCandidate, SchedulingDataGateway } from '@/services/agent/types'
import type { PlaylistType, RotationPlaylistStrategy, ScheduleItemSnapshot, ScheduleState, ScheduleSummary } from '@/types/orchestration'

const date = '2026-03-25'
const channelId = 'dragon'

const buildItem = (patch: Partial<ScheduleItemSnapshot> = {}): ScheduleItemSnapshot => ({
  id: 'item-0900',
  programCode: 'NEWS0900',
  programName: 'Morning News',
  startTime: '09:00:00',
  endTime: '09:30:00',
  duration: 1800,
  programType: 'news',
  columnId: 'news',
  columnName: 'News',
  sequence: 1,
  ...patch,
})

const buildCandidate = (patch: Partial<AgentProgramCandidate> = {}): AgentProgramCandidate => ({
  id: 'candidate-news',
  programId: 'program-news',
  programCode: 'NEWS1000',
  programName: 'Replacement News',
  instanceName: 'Replacement News',
  channelId,
  columnId: 'news',
  columnName: 'News',
  duration: 1800,
  programType: 'news',
  contentTags: ['news'],
  materialStatus: 'ready',
  rightsStatus: 'ready',
  ...patch,
})

const buildScheduleState = (patch: Partial<ScheduleState> = {}): ScheduleState => ({
  channelId,
  channelName: 'Dragon TV',
  date,
  isEmpty: false,
  itemCount: 1,
  gapCount: 0,
  hasSelectedTimeRange: false,
  playlistType: 'tv',
  ...patch,
})

const buildRuntime = (options: {
  playlistType: PlaylistType
  rotationStrategy?: RotationPlaylistStrategy
  items?: ScheduleItemSnapshot[]
  candidates?: AgentProgramCandidate[]
  broadcastReadiness?: AgentBroadcastReadinessEvidence[]
  historySchedules?: ScheduleSummary[]
  lockedItemIds?: string[]
}) => {
  const dataGateway = new InMemorySchedulingDataGateway([{
    channelId,
    date,
    playlistType: options.playlistType,
    rotationStrategy: options.rotationStrategy,
    scheduleItems: options.items ?? [],
    programCandidates: options.candidates ?? [],
    broadcastReadiness: options.broadcastReadiness ?? [],
    historySchedules: options.historySchedules ?? [],
    lockedItemIds: options.lockedItemIds ?? [],
    layoutBounds: options.playlistType === 'rotation'
      ? { start: '00:00:00', end: '23:59:59' }
      : { start: '06:00:00', end: '23:59:59' },
  }])

  return {
    dataGateway,
    runtime: new SchedulingAgentRuntime({ dataGateway }),
  }
}

const submit = (
  runtime: SchedulingAgentRuntime,
  userInput: string,
  interpretation: AgentIntentInterpretation,
) => runtime.submit({
  userInput,
  channelId,
  date,
  interpretation,
})

describe('SchedulingAgentRuntime v1 atomic command matrix', () => {
  it('exposes the registered capability package and atomic command policies', () => {
    const { runtime } = buildRuntime({
      playlistType: 'tv',
    })
    const capabilities = runtime.describeCapabilities()

    expect(capabilities).toMatchObject({
      capabilityIds: ['atomic_command'],
      commandPolicies: [
        { intent: 'move', tvMode: 'direct_execute', rotationMode: 'direct_execute' },
        { intent: 'batch_move', tvMode: 'direct_execute', rotationMode: 'direct_execute' },
        { intent: 'insert', tvMode: 'direct_execute', rotationMode: 'confirm_before_commit' },
        { intent: 'replace', tvMode: 'direct_execute', rotationMode: 'confirm_before_commit' },
        { intent: 'delete', tvMode: 'confirm_before_commit', rotationMode: 'confirm_before_commit' },
        { intent: 'batch_delete', tvMode: 'confirm_before_commit', rotationMode: 'confirm_before_commit' },
        { intent: 'query', tvMode: 'read_only', rotationMode: 'read_only' },
        { intent: 'validate', tvMode: 'read_only', rotationMode: 'read_only' },
      ],
      dataRequirements: expect.arrayContaining([
        {
          sourceKey: 'today',
          requiredFor: ['move', 'batch_move', 'insert', 'replace', 'delete', 'batch_delete', 'query', 'validate'],
          missingBehavior: 'block_write',
          guardCode: 'schedule_source_missing',
          description: expect.stringContaining('mandatory evidence'),
        },
        {
          sourceKey: 'candidates',
          requiredFor: ['insert', 'replace', 'query'],
          missingBehavior: 'block_write',
          guardCode: 'candidate_source_missing',
          description: expect.stringContaining('Candidate programme source must be configured'),
        },
        {
          sourceKey: 'policy',
          requiredFor: ['move', 'batch_move', 'insert', 'replace', 'delete', 'batch_delete', 'query', 'validate'],
          missingBehavior: 'audit_only',
          description: expect.stringContaining('TV and rotation execution modes'),
        },
      ]),
      safetyGates: expect.arrayContaining([
        {
          id: 'pending_lifecycle',
          appliesTo: ['move', 'batch_move', 'insert', 'replace', 'delete', 'batch_delete'],
          mode: 'reroute',
          description: expect.stringContaining('bypassed when the LLM starts a new task'),
        },
        {
          id: 'context_fingerprint',
          appliesTo: ['batch_move', 'insert', 'replace', 'delete', 'batch_delete'],
          mode: 'block',
          description: expect.stringContaining('source evidence'),
        },
        {
          id: 'commit_fingerprint',
          appliesTo: ['move', 'batch_move', 'insert', 'replace', 'delete', 'batch_delete'],
          mode: 'block',
          description: expect.stringContaining('changed before commit'),
        },
        {
          id: 'source_coverage',
          appliesTo: ['move', 'batch_move', 'insert', 'replace', 'delete', 'batch_delete', 'query', 'validate'],
          mode: 'block',
          description: expect.stringContaining('read-only query and validate commands report missing source evidence'),
        },
        {
          id: 'tv_sequence_selector',
          appliesTo: ['insert', 'replace'],
          mode: 'block',
          description: expect.stringContaining('today and history evidence'),
        },
        {
          id: 'llm_intent_contract',
          appliesTo: ['move', 'batch_move', 'insert', 'replace', 'delete', 'batch_delete', 'query', 'validate'],
          mode: 'block',
          description: expect.stringContaining('low-confidence or failed output stops'),
        },
        {
          id: 'capability_route_conflict',
          appliesTo: ['move', 'batch_move', 'insert', 'replace', 'delete', 'batch_delete', 'query', 'validate'],
          mode: 'block',
          description: expect.stringContaining('ambiguous matches are blocked'),
        },
        {
          id: 'pending_llm_context',
          appliesTo: ['move', 'batch_move', 'insert', 'replace', 'delete', 'batch_delete'],
          mode: 'audit',
          description: expect.stringContaining('structured pending context'),
        },
        {
          id: 'llm_usage_audit',
          appliesTo: ['move', 'batch_move', 'insert', 'replace', 'delete', 'batch_delete', 'query', 'validate'],
          mode: 'audit',
          description: expect.stringContaining('LLM intent-interpreter call attempts'),
        },
        {
          id: 'candidate_query_facets',
          appliesTo: ['insert', 'replace', 'query'],
          mode: 'audit',
          description: expect.stringContaining('keyword facets'),
        },
        {
          id: 'professional_slot_policy',
          appliesTo: ['insert', 'replace'],
          mode: 'audit',
          description: expect.stringContaining('score candidates'),
        },
        {
          id: 'evidence_audit_chain',
          appliesTo: ['move', 'batch_move', 'insert', 'replace', 'delete', 'batch_delete', 'query', 'validate'],
          mode: 'audit',
          description: expect.stringContaining('multi-source evidence chain'),
        },
      ]),
      professionalRules: expect.arrayContaining([
        {
          id: 'time_slot_fit',
          appliesTo: ['insert', 'replace'],
          sourceKeys: ['candidates', 'policy'],
          tvMode: 'warn',
          rotationMode: 'warn',
          description: expect.stringContaining('prime time'),
        },
        {
          id: 'replacement_duty_fit',
          appliesTo: ['replace'],
          sourceKeys: ['today', 'candidates', 'policy'],
          tvMode: 'warn',
          rotationMode: 'warn',
          description: expect.stringContaining('target slot column'),
        },
        {
          id: 'same_day_duplicate',
          appliesTo: ['insert', 'replace'],
          sourceKeys: ['today', 'candidates', 'policy'],
          tvMode: 'block',
          rotationMode: 'warn',
          description: expect.stringContaining('same-day programme asset'),
        },
        {
          id: 'recent_replay_interval',
          appliesTo: ['insert', 'replace'],
          sourceKeys: ['history', 'candidates', 'policy'],
          tvMode: 'block',
          rotationMode: 'warn',
          description: expect.stringContaining('historical exact replays'),
        },
      ]),
    })

    expect(runtime.auditV1Readiness()).toMatchObject({
      status: 'ready',
      percent: 100,
      commandCoverage: {
        ready: 8,
        total: 8,
        missing: [],
        intents: ['move', 'batch_move', 'insert', 'replace', 'delete', 'batch_delete', 'query', 'validate'],
      },
      playlistModeCoverage: {
        ready: 6,
        total: 6,
        required: [
          'tv:direct_execute',
          'tv:confirm_before_commit',
          'tv:read_only',
          'rotation:direct_execute',
          'rotation:confirm_before_commit',
          'rotation:read_only',
        ],
        missing: [],
      },
      dataSourceCoverage: {
        ready: 6,
        total: 6,
        required: ['today', 'candidates', 'readiness', 'history', 'constraints', 'policy'],
        missing: [],
      },
      safetyGateCoverage: {
        ready: 14,
        total: 14,
        required: [
          'playlist_policy',
          'constraint_engine',
          'source_coverage',
          'pending_lifecycle',
          'llm_intent_contract',
          'capability_route_conflict',
          'pending_llm_context',
          'llm_usage_audit',
          'context_fingerprint',
          'commit_fingerprint',
          'tv_sequence_selector',
          'candidate_query_facets',
          'professional_slot_policy',
          'evidence_audit_chain',
        ],
        missing: [],
      },
      professionalRuleCoverage: {
        ready: 11,
        total: 11,
        required: [
          'material_readiness',
          'rights_readiness',
          'playlist_policy',
          'content_alignment',
          'time_slot_fit',
          'neighbor_column_fit',
          'replacement_duty_fit',
          'duration_fit',
          'same_day_duplicate',
          'recent_replay_interval',
          'rotation_priority',
        ],
        missing: [],
      },
      dimensions: expect.arrayContaining([
        { id: 'commands', ready: 8, total: 8, percent: 100, missing: [] },
        { id: 'playlist_modes', ready: 6, total: 6, percent: 100, missing: [] },
        { id: 'data_sources', ready: 6, total: 6, percent: 100, missing: [] },
        { id: 'safety_gates', ready: 14, total: 14, percent: 100, missing: [] },
        { id: 'professional_rules', ready: 11, total: 11, percent: 100, missing: [] },
      ]),
      gaps: [],
    })

    const professionalRuleIds = capabilities.professionalRules.map((rule) => rule.id)
    expect(new Set(professionalRuleIds).size).toBe(professionalRuleIds.length)
    expect(runtime.auditV1Readiness().professionalRuleCoverage.required).toEqual(professionalRuleIds)
  })

  it('reports v1 readiness gaps when a required source, gate, or professional rule is missing', () => {
    const { runtime } = buildRuntime({
      playlistType: 'tv',
    })
    const summary = runtime.describeCapabilities()

    const audit = auditSchedulingAgentV1Readiness({
      ...summary,
      dataRequirements: summary.dataRequirements.filter((requirement) => requirement.sourceKey !== 'readiness'),
      safetyGates: summary.safetyGates.filter((gate) => gate.id !== 'commit_fingerprint'),
      professionalRules: summary.professionalRules.filter((rule) => rule.id !== 'same_day_duplicate'),
    })

    expect(audit.status).toBe('incomplete')
    expect(audit.percent).toBe(93)
    expect(audit.gaps).toEqual(['data_sources:readiness', 'safety_gates:commit_fingerprint', 'professional_rules:same_day_duplicate'])
    expect(audit.dataSourceCoverage).toMatchObject({
      ready: 5,
      total: 6,
      required: ['today', 'candidates', 'readiness', 'history', 'constraints', 'policy'],
      missing: ['readiness'],
    })
    expect(audit.safetyGateCoverage).toMatchObject({
      ready: 13,
      total: 14,
      missing: ['commit_fingerprint'],
    })
    expect(audit.professionalRuleCoverage).toMatchObject({
      ready: 10,
      total: 11,
      missing: ['same_day_duplicate'],
    })
    expect(audit.dimensions).toEqual(expect.arrayContaining([
      { id: 'data_sources', ready: 5, total: 6, percent: 83, missing: ['readiness'] },
      { id: 'safety_gates', ready: 13, total: 14, percent: 93, missing: ['commit_fingerprint'] },
      { id: 'professional_rules', ready: 10, total: 11, percent: 91, missing: ['same_day_duplicate'] },
    ]))
  })

  it('accepts injected capability packages and rejects duplicate capability ids', async () => {
    const { dataGateway } = buildRuntime({
      playlistType: 'tv',
      items: [buildItem()],
    })
    const customCapability: AgentCapability = {
      id: 'custom_audit_command',
      canHandle: (input) => input.userInput === 'custom audit',
      handle: async (input, runtime) => {
        runtime.trace.record('planning', 'custom capability handled scheduling request', {
          capabilityId: 'custom_audit_command',
        })
        return {
          status: 'executed',
          input,
          decision: {
            intent: 'query',
            constraintReport: { ok: true, issues: [] },
          },
          explanation: 'custom capability executed',
          trace: runtime.trace.getTrace(),
        }
      },
    }

    const runtime = new SchedulingAgentRuntime({
      dataGateway,
      capabilities: [customCapability],
    })

    expect(runtime.describeCapabilities().capabilityIds).toEqual(['custom_audit_command'])
    const result = await runtime.submit({
      userInput: 'custom audit',
      channelId,
      date,
    })

    expect(result.status).toBe('executed')
    expect(result.explanation).toBe('custom capability executed')
    expect(result.trace).toEqual(expect.arrayContaining([
      expect.objectContaining({
        status: 'planning',
        label: 'Agent capability selected for execution.',
        detail: expect.objectContaining({
          capabilityId: 'custom_audit_command',
        }),
      }),
    ]))
    expect(result.trace.some((step) => step.detail?.capabilityId === 'custom_audit_command')).toBe(true)
    expect(() => new SchedulingAgentRuntime({
      dataGateway,
      capabilities: [customCapability, customCapability],
    })).toThrow('Agent capability already registered: custom_audit_command')
  })

  it('blocks ambiguous capability routing before executing a capability package', async () => {
    const { dataGateway } = buildRuntime({
      playlistType: 'tv',
      items: [buildItem()],
    })
    const handledCapabilityIds: string[] = []
    const buildCustomCapability = (id: string): AgentCapability => ({
      id,
      canHandle: (input) => input.userInput === 'custom audit',
      handle: async (input) => {
        handledCapabilityIds.push(id)
        return {
          status: 'executed',
          input,
          decision: {
            intent: 'query',
            constraintReport: { ok: true, issues: [] },
          },
          explanation: `${id} executed`,
          trace: [],
        }
      },
    })
    const runtime = new SchedulingAgentRuntime({
      dataGateway,
      capabilities: [
        buildCustomCapability('custom_audit_command_a'),
        buildCustomCapability('custom_audit_command_b'),
      ],
    })

    const result = await runtime.submit({
      userInput: 'custom audit',
      channelId,
      date,
    })

    expect(result.status).toBe('blocked')
    expect(handledCapabilityIds).toEqual([])
    expect(result.decision.constraintReport?.issues).toEqual([
      expect.objectContaining({
        code: 'capability_route_conflict',
        severity: 'critical',
        detail: expect.objectContaining({
          capabilityIds: ['custom_audit_command_a', 'custom_audit_command_b'],
        }),
      }),
    ])
    expect(result.trace).toEqual(expect.arrayContaining([
      expect.objectContaining({
        status: 'blocked',
        label: 'Multiple Agent capabilities matched one request; routing is ambiguous.',
        detail: expect.objectContaining({
          capabilityIds: ['custom_audit_command_a', 'custom_audit_command_b'],
        }),
      }),
    ]))
  })

  it('audits operational readiness from the actual loaded scheduling sources', async () => {
    const dataGateway = new InMemorySchedulingDataGateway([{
      channelId,
      date,
      playlistType: 'tv',
      scheduleItems: [buildItem()],
      programCandidates: [buildCandidate()],
      broadcastReadiness: [],
      historySchedules: [],
      layoutBounds: { start: '00:00:00', end: '23:59:59' },
    }])
    const runtime = new SchedulingAgentRuntime({ dataGateway })

    const audit = await runtime.auditOperationalReadiness({ channelId, date })

    expect(audit).toMatchObject({
      status: 'ready',
      executablePercent: 100,
      executableCommands: 8,
      totalCommands: 8,
      playlistType: 'tv',
      gaps: [],
    })
    expect(audit.commandReadiness).toEqual(expect.arrayContaining([
      { intent: 'move', status: 'ready', executionMode: 'direct_execute', blockingSources: [], advisorySources: [] },
      { intent: 'insert', status: 'ready', executionMode: 'direct_execute', blockingSources: [], advisorySources: [] },
      { intent: 'delete', status: 'ready', executionMode: 'confirm_before_commit', blockingSources: [], advisorySources: [] },
      { intent: 'query', status: 'ready', executionMode: 'read_only', blockingSources: [], advisorySources: [] },
    ]))
    expect(audit.commandRequirementReadiness).toEqual(expect.arrayContaining([
      expect.objectContaining({
        intent: 'insert',
        executionMode: 'direct_execute',
        status: 'ready',
        requirements: expect.arrayContaining([
          expect.objectContaining({
            sourceKey: 'candidates',
            status: 'ready',
            missingBehavior: 'block_write',
            sourceStatus: 'available',
            recordCount: 1,
          }),
          expect.objectContaining({
            sourceKey: 'history',
            status: 'ready',
            missingBehavior: 'audit_only',
            sourceStatus: 'empty',
          }),
        ]),
      }),
      expect.objectContaining({
        intent: 'query',
        executionMode: 'read_only',
        status: 'ready',
        requirements: expect.arrayContaining([
          expect.objectContaining({
            sourceKey: 'candidates',
            status: 'ready',
            missingBehavior: 'block_write',
          }),
        ]),
      }),
    ]))
    expect(audit.commandProfessionalRuleReadiness).toEqual(expect.arrayContaining([
      expect.objectContaining({
        intent: 'insert',
        executionMode: 'direct_execute',
        rules: expect.arrayContaining([
          expect.objectContaining({
            ruleId: 'time_slot_fit',
            effect: 'warning',
            evidenceStatus: 'ready',
            sourceKeys: ['candidates', 'policy'],
            missingSourceKeys: [],
          }),
          expect.objectContaining({
            ruleId: 'same_day_duplicate',
            effect: 'blocking_guard',
            evidenceStatus: 'ready',
            sourceKeys: ['today', 'candidates', 'policy'],
            missingSourceKeys: [],
          }),
          expect.objectContaining({
            ruleId: 'rotation_priority',
            effect: 'audit',
            evidenceStatus: 'ready',
          }),
        ]),
      }),
      expect.objectContaining({
        intent: 'query',
        executionMode: 'read_only',
        rules: [],
      }),
    ]))
    expect(audit.professionalRuleEffectSummary).toEqual({
      blockingGuardCount: 8,
      confirmationGuardCount: 0,
      warningCount: 7,
      preferenceCount: 2,
      auditCount: 2,
      passCount: 2,
      partialEvidenceCount: 0,
      commandCountWithRules: 2,
    })
    expect(audit.sourceCoverage).toEqual(expect.arrayContaining([
      { sourceKey: 'today', available: true, status: 'available', source: 'in_memory_seed', recordCount: 1 },
      { sourceKey: 'candidates', available: true, status: 'available', source: 'in_memory_seed', recordCount: 1 },
      { sourceKey: 'readiness', available: true, status: 'empty', source: 'in_memory_seed', recordCount: 0 },
      { sourceKey: 'history', available: true, status: 'empty', source: 'in_memory_seed', recordCount: 0 },
    ]))
  })

  it('audits rotation operational readiness with confirmation-oriented professional rules', async () => {
    const dataGateway = new InMemorySchedulingDataGateway([{
      channelId,
      date,
      playlistType: 'rotation',
      rotationStrategy: 'content_match',
      scheduleItems: [buildItem()],
      programCandidates: [buildCandidate()],
      broadcastReadiness: [],
      historySchedules: [],
      layoutBounds: { start: '06:00:00', end: '23:59:59' },
    }])
    const runtime = new SchedulingAgentRuntime({ dataGateway })

    const audit = await runtime.auditOperationalReadiness({ channelId, date })

    expect(audit).toMatchObject({
      status: 'ready',
      executablePercent: 100,
      executableCommands: 8,
      totalCommands: 8,
      playlistType: 'rotation',
      gaps: [],
    })
    expect(audit.commandReadiness).toEqual(expect.arrayContaining([
      { intent: 'move', status: 'ready', executionMode: 'direct_execute', blockingSources: [], advisorySources: [] },
      { intent: 'insert', status: 'ready', executionMode: 'confirm_before_commit', blockingSources: [], advisorySources: [] },
      { intent: 'replace', status: 'ready', executionMode: 'confirm_before_commit', blockingSources: [], advisorySources: [] },
      { intent: 'query', status: 'ready', executionMode: 'read_only', blockingSources: [], advisorySources: [] },
    ]))
    expect(audit.commandProfessionalRuleReadiness).toEqual(expect.arrayContaining([
      expect.objectContaining({
        intent: 'insert',
        executionMode: 'confirm_before_commit',
        rules: expect.arrayContaining([
          expect.objectContaining({
            ruleId: 'playlist_policy',
            effect: 'confirmation_guard',
            evidenceStatus: 'ready',
          }),
          expect.objectContaining({
            ruleId: 'time_slot_fit',
            effect: 'warning',
            evidenceStatus: 'ready',
          }),
          expect.objectContaining({
            ruleId: 'rotation_priority',
            effect: 'preference',
            evidenceStatus: 'ready',
          }),
        ]),
      }),
    ]))
    expect(audit.professionalRuleEffectSummary).toEqual({
      blockingGuardCount: 0,
      confirmationGuardCount: 6,
      warningCount: 11,
      preferenceCount: 4,
      auditCount: 0,
      passCount: 0,
      partialEvidenceCount: 0,
      commandCountWithRules: 2,
    })
  })

  it('blocks only candidate write commands when the candidate source is not configured', async () => {
    const dataGateway = new RuntimeSchedulingDataGateway({
      playlistType: 'tv',
      reader: {
        getScheduleItems: () => [buildItem()],
        getLayoutBounds: () => ({ start: '06:00:00', end: '23:59:59' }),
      },
    })
    const runtime = new SchedulingAgentRuntime({ dataGateway })

    const audit = await runtime.auditOperationalReadiness({ channelId, date })

    expect(audit).toMatchObject({
      status: 'blocked',
      executablePercent: 75,
      executableCommands: 6,
      totalCommands: 8,
      gaps: expect.arrayContaining([
        'insert:blocked:candidates',
        'insert:advisory:readiness',
        'insert:advisory:history',
        'replace:blocked:candidates',
        'replace:advisory:readiness',
        'replace:advisory:history',
        'query:advisory:candidates',
      ]),
    })
    expect(audit.commandReadiness).toEqual(expect.arrayContaining([
      { intent: 'move', status: 'ready', executionMode: 'direct_execute', blockingSources: [], advisorySources: [] },
      { intent: 'insert', status: 'blocked', executionMode: 'direct_execute', blockingSources: ['candidates'], advisorySources: ['readiness', 'history'] },
      { intent: 'replace', status: 'blocked', executionMode: 'direct_execute', blockingSources: ['candidates'], advisorySources: ['readiness', 'history'] },
      { intent: 'query', status: 'advisory', executionMode: 'read_only', blockingSources: [], advisorySources: ['candidates'] },
    ]))
    expect(audit.commandRequirementReadiness).toEqual(expect.arrayContaining([
      expect.objectContaining({
        intent: 'insert',
        status: 'blocked',
        requirements: expect.arrayContaining([
          expect.objectContaining({
            sourceKey: 'candidates',
            status: 'blocking',
            missingBehavior: 'block_write',
            guardCode: 'candidate_source_missing',
            source: 'none',
            sourceStatus: 'missing',
          }),
          expect.objectContaining({
            sourceKey: 'readiness',
            status: 'advisory',
            missingBehavior: 'audit_only',
            sourceStatus: 'missing',
          }),
        ]),
      }),
      expect.objectContaining({
        intent: 'query',
        status: 'advisory',
        executionMode: 'read_only',
        requirements: expect.arrayContaining([
          expect.objectContaining({
            sourceKey: 'candidates',
            status: 'advisory',
            missingBehavior: 'block_write',
            sourceStatus: 'missing',
          }),
        ]),
      }),
    ]))
    expect(audit.commandProfessionalRuleReadiness).toEqual(expect.arrayContaining([
      expect.objectContaining({
        intent: 'insert',
        executionMode: 'direct_execute',
        rules: expect.arrayContaining([
          expect.objectContaining({
            ruleId: 'time_slot_fit',
            effect: 'warning',
            evidenceStatus: 'partial',
            missingSourceKeys: ['candidates'],
          }),
          expect.objectContaining({
            ruleId: 'recent_replay_interval',
            effect: 'blocking_guard',
            evidenceStatus: 'partial',
            missingSourceKeys: ['history', 'candidates'],
          }),
        ]),
      }),
    ]))
    expect(audit.professionalRuleEffectSummary).toMatchObject({
      blockingGuardCount: 8,
      confirmationGuardCount: 0,
      warningCount: 7,
      preferenceCount: 2,
      auditCount: 2,
      passCount: 2,
      partialEvidenceCount: 19,
      commandCountWithRules: 2,
    })
    expect(audit.sourceCoverage).toEqual(expect.arrayContaining([
      { sourceKey: 'candidates', available: false, status: 'missing', source: 'none', recordCount: 0, errorCode: 'source_not_configured' },
      { sourceKey: 'readiness', available: false, status: 'missing', source: 'none', recordCount: 0, errorCode: 'source_not_configured' },
      { sourceKey: 'history', available: false, status: 'missing', source: 'none', recordCount: 0, errorCode: 'source_not_configured' },
    ]))
  })

  it('executes deterministic move commands for TV playlists and records an audit summary', async () => {
    const { dataGateway, runtime } = buildRuntime({
      playlistType: 'tv',
      items: [buildItem()],
    })

    const result = await submit(runtime, 'move Morning News to 10:00', {
      intent: 'move',
      confidence: 1,
      source: 'test',
      slots: {
        targetTime: '09:00:00',
        newStartTime: '10:00:00',
      },
    })

    expect(result.status).toBe('executed')
    expect(result.decision.command).toMatchObject({
      intent: 'move',
      itemId: 'item-0900',
      newStartTime: '2026-03-25T10:00:00+08:00',
    })
    expect(result.decision.auditSummary).toMatchObject({
      outcome: 'executed',
      operation: {
        committed: true,
        commitAttempted: true,
        commitGuardStatus: 'passed',
        commandIntent: 'move',
        affectedItemIds: ['item-0900'],
        affectedCount: 1,
        previewAffectedItemIds: ['item-0900'],
        previewAffectedCount: 1,
        validationOk: true,
        reason: expect.stringContaining('写入当前工作播单'),
      },
      constraintIssueCodes: [],
      contextSources: {
        today: {
          source: 'in_memory_seed',
          recordCount: 1,
        },
        constraints: {
          source: 'in_memory_seed',
          recordCount: 1,
        },
        policy: {
          source: 'in_memory_seed',
          recordCount: 1,
        },
      },
    })
    expect(result.decision.auditSummary?.keyPoints).toEqual(
      expect.arrayContaining([
        expect.stringContaining('写入状态：已写入'),
        expect.stringContaining('提交门禁=passed'),
        expect.stringContaining('上下文来源：today=in_memory_seed:1'),
      ]),
    )

    const context = await dataGateway.loadContext({ userInput: '', channelId, date })
    expect(context.scheduleItems[0]?.startTime).toBe('2026-03-25T10:00:00+08:00')
  })

  it('records commit guard blocking when the playlist changes during a write commit', async () => {
    const baseGateway = new InMemorySchedulingDataGateway([{
      channelId,
      date,
      playlistType: 'tv',
      scheduleItems: [buildItem()],
      programCandidates: [],
      broadcastReadiness: [],
      historySchedules: [],
      layoutBounds: { start: '06:00:00', end: '23:59:59' },
    }])
    let injectedExternalChange = false
    const conflictGateway: SchedulingDataGateway = {
      loadContext: (input) => baseGateway.loadContext(input),
      commitScheduleItems: async (input) => {
        if (!injectedExternalChange) {
          injectedExternalChange = true
          await baseGateway.commitScheduleItems({
            channelId: input.channelId,
            date: input.date,
            playlistId: input.playlistId,
            items: [buildItem({
              id: 'external-1030',
              programName: 'External Update',
              startTime: '10:30:00',
              endTime: '11:00:00',
            })],
            reason: 'external:concurrent_edit',
          })
        }
        return baseGateway.commitScheduleItems(input)
      },
    }
    const runtime = new SchedulingAgentRuntime({ dataGateway: conflictGateway })

    const result = await submit(runtime, 'move Morning News to 10:00', {
      intent: 'move',
      confidence: 1,
      source: 'test',
      slots: {
        targetTime: '09:00:00',
        newStartTime: '10:00:00',
      },
    })

    expect(result.status).toBe('blocked')
    expect(result.executionResult).toMatchObject({
      committed: false,
      affectedItemIds: [],
    })
    expect(result.decision.constraintReport?.issues[0]).toMatchObject({
      code: 'context_conflict',
      detail: {
        operationId: expect.stringMatching(/^agent_conflict_/),
      },
    })
    expect(result.decision.auditSummary).toMatchObject({
      outcome: 'blocked',
      operation: {
        committed: false,
        commitAttempted: true,
        commitGuardStatus: 'blocked',
        commandIntent: 'move',
        affectedItemIds: [],
      },
    })
    expect(result.decision.auditSummary?.keyPoints).toEqual(
      expect.arrayContaining([
        expect.stringContaining('写入状态：未写入'),
        expect.stringContaining('提交门禁=blocked'),
        expect.stringContaining('约束处理：context_conflict=block'),
      ]),
    )

    const context = await baseGateway.loadContext({ userInput: '', channelId, date })
    expect(context.scheduleItems).toHaveLength(1)
    expect(context.scheduleItems[0]?.id).toBe('external-1030')
  })

  it('continues pending move commands after destination clarification', async () => {
    const { dataGateway, runtime } = buildRuntime({
      playlistType: 'tv',
      items: [buildItem()],
    })

    const first = await submit(runtime, 'move Morning News', {
      intent: 'move',
      confidence: 1,
      source: 'test',
      slots: {
        targetProgramName: 'Morning News',
      },
    })

    expect(first.status).toBe('needs_clarification')
    expect(first.executionResult).toBeUndefined()
    expect(first.decision.pendingTask).toMatchObject({
      intent: 'move',
      phase: 'needs_clarification',
      missingSlots: ['newStartTime'],
      collectedSlots: {
        targetProgramName: expect.objectContaining({ value: 'Morning News' }),
      },
      contextFingerprint: expect.any(String),
    })

    const result = await runtime.submit({
      userInput: 'to 10:00',
      channelId,
      date,
      pendingTask: first.decision.pendingTask,
      interpretation: {
        intent: 'move',
        pendingAction: 'continue_pending',
        confidence: 1,
        source: 'test',
        slots: {
          newStartTime: '10:00:00',
        },
      },
    })

    expect(result.status).toBe('executed')
    expect(result.decision.command).toMatchObject({
      intent: 'move',
      itemId: 'item-0900',
      newStartTime: '2026-03-25T10:00:00+08:00',
    })

    const context = await dataGateway.loadContext({ userInput: '', channelId, date })
    expect(context.scheduleItems[0]?.startTime).toBe('2026-03-25T10:00:00+08:00')
  })

  it('continues LLM-only natural multi-turn move utterances by carrying the target programme into the destination follow-up', async () => {
    const { dataGateway, runtime } = buildRuntime({
      playlistType: 'tv',
      items: [buildItem({
        id: 'item-kan-dongfang',
        programCode: 'KDF0900',
        programName: '看东方',
        startTime: '09:00:00',
        endTime: '10:00:00',
        duration: 3600,
      })],
    })

    const first = await runtime.submit({
      userInput: '移动看东方',
      channelId,
      date,
      interpretation: {
        intent: 'move',
        confidence: 1,
        source: 'test',
        slots: {
          targetProgramName: '看东方',
        },
      },
    })

    expect(first.status).toBe('needs_clarification')
    expect(first.decision.pendingTask).toMatchObject({
      intent: 'move',
      phase: 'needs_clarification',
      missingSlots: ['newStartTime'],
      collectedSlots: {
        targetProgramName: expect.objectContaining({ value: '看东方' }),
      },
    })

    const result = await runtime.submit({
      userInput: '到10点',
      channelId,
      date,
      pendingTask: first.decision.pendingTask,
      interpretation: {
        intent: 'move',
        pendingAction: 'continue_pending',
        confidence: 1,
        source: 'test',
        slots: {
          newStartTime: '10:00:00',
        },
      },
    })

    expect(result.status).toBe('executed')
    expect(result.decision.command).toMatchObject({
      intent: 'move',
      itemId: 'item-kan-dongfang',
      newStartTime: '2026-03-25T10:00:00+08:00',
    })

    const context = await dataGateway.loadContext({ userInput: '', channelId, date })
    expect(context.scheduleItems[0]).toMatchObject({
      id: 'item-kan-dongfang',
      startTime: '2026-03-25T10:00:00+08:00',
      endTime: '2026-03-25T11:00:00+08:00',
    })
  })

  it('blocks LLM-only natural move utterances when the destination already has scheduled content', async () => {
    const { dataGateway, runtime } = buildRuntime({
      playlistType: 'tv',
      items: [
        buildItem({
          id: 'item-kan-dongfang',
          programCode: 'KDF0900',
          programName: '看东方',
          startTime: '09:00:00',
          endTime: '09:30:00',
          duration: 1800,
        }),
        buildItem({
          id: 'item-dongfang-news',
          programCode: 'DFNEWS1000',
          programName: '东方新闻',
          startTime: '10:00:00',
          endTime: '10:30:00',
          duration: 1800,
          sequence: 2,
        }),
      ],
    })

    const result = await runtime.submit({
      userInput: '把看东方移到10点',
      channelId,
      date,
      interpretation: {
        intent: 'move',
        confidence: 1,
        source: 'test',
        slots: {
          targetProgramName: '看东方',
          newStartTime: '10:00:00',
        },
      },
    })

    expect(result.status).toBe('blocked')
    expect(result.decision.command).toMatchObject({
      intent: 'move',
      itemId: 'item-kan-dongfang',
      newStartTime: '2026-03-25T10:00:00+08:00',
    })
    expect(result.decision.constraintReport?.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'time_overlap',
        }),
      ]),
    )

    const context = await dataGateway.loadContext({ userInput: '', channelId, date })
    expect(context.scheduleItems).toEqual([
      expect.objectContaining({
        id: 'item-kan-dongfang',
        startTime: '2026-03-25T09:00:00+08:00',
      }),
      expect.objectContaining({
        id: 'item-dongfang-news',
        startTime: '2026-03-25T10:00:00+08:00',
      }),
    ])
  })

  it('does not continue missing-destination move commands after playlist evidence changes', async () => {
    const { dataGateway, runtime } = buildRuntime({
      playlistType: 'tv',
      items: [buildItem()],
    })

    const first = await submit(runtime, 'move Morning News', {
      intent: 'move',
      confidence: 1,
      source: 'test',
      slots: {
        targetProgramName: 'Morning News',
      },
    })

    await dataGateway.commitScheduleItems({
      channelId,
      date,
      items: [buildItem({
        id: 'external-1000',
        programCode: 'EXT1000',
        programName: 'External Update',
        startTime: '10:00:00',
        endTime: '10:30:00',
        duration: 1800,
      })],
      reason: 'external:user_edit',
    })

    const result = await runtime.submit({
      userInput: 'to 10:00',
      channelId,
      date,
      pendingTask: first.decision.pendingTask,
      interpretation: {
        intent: 'move',
        pendingAction: 'continue_pending',
        confidence: 1,
        source: 'test',
        slots: {
          newStartTime: '10:00:00',
        },
      },
    })

    expect(result.status).toBe('needs_clarification')
    expect(result.executionResult).toBeUndefined()
    expect(result.decision.constraintReport?.issues[0]).toMatchObject({
      code: 'context_conflict',
    })

    const context = await dataGateway.loadContext({ userInput: '', channelId, date })
    expect(context.scheduleItems.map((item) => item.id)).toEqual(['external-1000'])
  })

  it('continues pending move commands after target clarification', async () => {
    const { dataGateway, runtime } = buildRuntime({
      playlistType: 'tv',
      items: [buildItem()],
    })

    const first = await submit(runtime, 'move something to 10:00', {
      intent: 'move',
      confidence: 1,
      source: 'test',
      slots: {
        newStartTime: '10:00:00',
      },
    })

    expect(first.status).toBe('needs_clarification')
    expect(first.executionResult).toBeUndefined()
    expect(first.decision.pendingTask).toMatchObject({
      intent: 'move',
      phase: 'needs_clarification',
      missingSlots: ['targetItemId'],
      collectedSlots: {
        newStartTime: expect.objectContaining({ value: '10:00:00' }),
      },
      contextFingerprint: expect.any(String),
    })

    const result = await runtime.submit({
      userInput: 'Morning News',
      channelId,
      date,
      pendingTask: first.decision.pendingTask,
      interpretation: {
        intent: 'move',
        pendingAction: 'continue_pending',
        confidence: 1,
        source: 'test',
        slots: {
          targetProgramName: 'Morning News',
        },
      },
    })

    expect(result.status).toBe('executed')
    expect(result.decision.command).toMatchObject({
      intent: 'move',
      itemId: 'item-0900',
      newStartTime: '2026-03-25T10:00:00+08:00',
    })

    const context = await dataGateway.loadContext({ userInput: '', channelId, date })
    expect(context.scheduleItems[0]).toMatchObject({
      id: 'item-0900',
      startTime: '2026-03-25T10:00:00+08:00',
    })
  })

  it('does not continue missing-target move commands after playlist evidence changes', async () => {
    const { dataGateway, runtime } = buildRuntime({
      playlistType: 'tv',
      items: [buildItem()],
    })

    const first = await submit(runtime, 'move something to 10:00', {
      intent: 'move',
      confidence: 1,
      source: 'test',
      slots: {
        newStartTime: '10:00:00',
      },
    })

    await dataGateway.commitScheduleItems({
      channelId,
      date,
      items: [buildItem({
        id: 'external-0930',
        programCode: 'EXT0930',
        programName: 'External Update',
        startTime: '09:30:00',
        endTime: '10:00:00',
        duration: 1800,
      })],
      reason: 'external:user_edit',
    })

    const result = await runtime.submit({
      userInput: 'Morning News',
      channelId,
      date,
      pendingTask: first.decision.pendingTask,
      interpretation: {
        intent: 'move',
        pendingAction: 'continue_pending',
        confidence: 1,
        source: 'test',
        slots: {
          targetProgramName: 'Morning News',
        },
      },
    })

    expect(result.status).toBe('needs_clarification')
    expect(result.executionResult).toBeUndefined()
    expect(result.decision.constraintReport?.issues[0]).toMatchObject({
      code: 'context_conflict',
    })

    const context = await dataGateway.loadContext({ userInput: '', channelId, date })
    expect(context.scheduleItems.map((item) => item.id)).toEqual(['external-0930'])
  })

  it('does not continue ambiguous move target selections after playlist evidence changes', async () => {
    const { dataGateway, runtime } = buildRuntime({
      playlistType: 'tv',
      items: [
        buildItem({
          id: 'morning-news-0900',
          programCode: 'NEWS0900A',
          programName: 'Morning News',
          endTime: '09:30:00',
          duration: 1800,
        }),
        buildItem({
          id: 'morning-news-0930',
          programCode: 'NEWS0930A',
          programName: 'Morning News',
          startTime: '09:30:00',
          endTime: '10:00:00',
          duration: 1800,
          sequence: 2,
        }),
      ],
    })

    const first = await submit(runtime, 'move Morning News to 11:00', {
      intent: 'move',
      confidence: 1,
      source: 'test',
      slots: {
        targetProgramName: 'Morning News',
        newStartTime: '11:00:00',
      },
    })

    expect(first.status).toBe('needs_clarification')
    expect(first.decision.pendingTask).toMatchObject({
      intent: 'move',
      missingSlots: ['targetItemId'],
      targetOptions: [
        expect.objectContaining({ itemId: 'morning-news-0900' }),
        expect.objectContaining({ itemId: 'morning-news-0930' }),
      ],
    })
    expect(first.decision.pendingTask?.contextFingerprint).toEqual(expect.stringMatching(/^agent_context:/))

    await dataGateway.commitScheduleItems({
      channelId,
      date,
      items: [buildItem({
        id: 'external-1000',
        programCode: 'EXT1000',
        programName: 'External Update',
        startTime: '10:00:00',
        endTime: '10:30:00',
        duration: 1800,
      })],
      reason: 'external:user_edit',
    })

    const result = await runtime.submit({
      userInput: 'use the first one',
      channelId,
      date,
      pendingTask: first.decision.pendingTask,
      interpretation: {
        intent: 'move',
        pendingAction: 'continue_pending',
        confidence: 1,
        source: 'test',
        slots: {
          targetItemId: 'morning-news-0900',
        },
      },
    })

    expect(result.status).toBe('needs_clarification')
    expect(result.executionResult).toBeUndefined()
    expect(result.explanation).toContain('pending task context changed')
    expect(result.decision.constraintReport?.issues[0]).toMatchObject({
      code: 'context_conflict',
      detail: {
        changedSourceKeys: ['today'],
      },
    })

    const context = await dataGateway.loadContext({ userInput: '', channelId, date })
    expect(context.scheduleItems).toHaveLength(1)
    expect(context.scheduleItems[0]?.id).toBe('external-1000')
  })

  it('resolves move targets from programme code when the displayed name differs', async () => {
    const { dataGateway, runtime } = buildRuntime({
      playlistType: 'tv',
      items: [
        buildItem({
          id: 'morning-news-0900',
          programCode: 'NEWS0900A',
          programName: 'Morning Edition',
          instanceName: 'Morning News Local Edition',
          endTime: '09:30:00',
          duration: 1800,
        }),
      ],
    })

    const result = await submit(runtime, 'move NEWS0900A to 10:00', {
      intent: 'move',
      confidence: 1,
      source: 'test',
      slots: {
        targetProgramName: 'NEWS0900A',
        newStartTime: '10:00:00',
      },
    })

    expect(result.status).toBe('executed')
    expect(result.decision.command).toMatchObject({
      intent: 'move',
      itemId: 'morning-news-0900',
      newStartTime: '2026-03-25T10:00:00+08:00',
    })

    const context = await dataGateway.loadContext({ userInput: '', channelId, date })
    expect(context.scheduleItems[0]).toMatchObject({
      id: 'morning-news-0900',
      startTime: '2026-03-25T10:00:00+08:00',
    })
  })

  it('does not continue ambiguous replace target selections outside the pending target options', async () => {
    const { dataGateway, runtime } = buildRuntime({
      playlistType: 'tv',
      items: [
        buildItem({
          id: 'morning-news-0900',
          programCode: 'NEWS0900A',
          programName: 'Morning News',
          endTime: '09:30:00',
          duration: 1800,
        }),
        buildItem({
          id: 'morning-news-0930',
          programCode: 'NEWS0930A',
          programName: 'Morning News',
          startTime: '09:30:00',
          endTime: '10:00:00',
          duration: 1800,
          sequence: 2,
        }),
        buildItem({
          id: 'sports-1000',
          programCode: 'SPORTS1000',
          programName: 'Sports Bulletin',
          startTime: '10:00:00',
          endTime: '10:30:00',
          duration: 1800,
          programType: 'sports',
          sequence: 3,
        }),
      ],
      candidates: [buildCandidate()],
    })

    const first = await submit(runtime, 'replace Morning News with Replacement News', {
      intent: 'replace',
      confidence: 1,
      source: 'test',
      slots: {
        targetProgramName: 'Morning News',
        replacementHint: 'Replacement News',
      },
    })

    expect(first.status).toBe('needs_clarification')
    expect(first.decision.pendingTask).toMatchObject({
      intent: 'replace',
      missingSlots: ['targetItemId'],
      targetOptions: [
        expect.objectContaining({ itemId: 'morning-news-0900' }),
        expect.objectContaining({ itemId: 'morning-news-0930' }),
      ],
    })

    const result = await runtime.submit({
      userInput: 'replace sports instead',
      channelId,
      date,
      pendingTask: first.decision.pendingTask,
      interpretation: {
        intent: 'replace',
        pendingAction: 'continue_pending',
        confidence: 1,
        source: 'test',
        slots: {
          targetItemId: 'sports-1000',
        },
      },
    })

    expect(result.status).toBe('needs_clarification')
    expect(result.executionResult).toBeUndefined()
    expect(result.decision.constraintReport?.issues[0]).toMatchObject({
      code: 'target_ambiguous',
      detail: {
        targetItemId: 'sports-1000',
        allowedTargetItemIds: ['morning-news-0900', 'morning-news-0930'],
      },
    })

    const context = await dataGateway.loadContext({ userInput: '', channelId, date })
    expect(context.scheduleItems.map((item) => [item.id, item.programName])).toEqual([
      ['morning-news-0900', 'Morning News'],
      ['morning-news-0930', 'Morning News'],
      ['sports-1000', 'Sports Bulletin'],
    ])
  })

  it('executes deterministic batch_move commands for rotation playlists without candidate confirmation', async () => {
    const { dataGateway, runtime } = buildRuntime({
      playlistType: 'rotation',
      rotationStrategy: 'content_match',
      items: [
        buildItem({ endTime: '09:30:00', duration: 1800 }),
        buildItem({
          id: 'item-0930',
          programCode: 'NEWS0930',
          programName: 'Mid Morning News',
          startTime: '09:30:00',
          endTime: '10:00:00',
          duration: 1800,
          sequence: 2,
        }),
      ],
    })

    const result = await submit(runtime, 'shift 09:00-10:00 later', {
      intent: 'batch_move',
      confidence: 1,
      source: 'test',
      slots: {
        rangeStart: '09:00:00',
        rangeEnd: '10:00:00',
        offsetSeconds: 3600,
        direction: 'forward',
      },
    })

    expect(result.status).toBe('executed')
    expect(result.decision.command).toMatchObject({
      intent: 'batch_move',
      itemIds: ['item-0900', 'item-0930'],
      offsetSeconds: 3600,
    })
    expect(result.decision.auditSummary?.outcome).toBe('executed')

    const context = await dataGateway.loadContext({ userInput: '', channelId, date })
    expect(context.scheduleItems.map((item) => item.startTime)).toEqual([
      '2026-03-25T10:00:00+08:00',
      '2026-03-25T10:30:00+08:00',
    ])
  })

  it('continues pending batch_move commands after range clarification', async () => {
    const { dataGateway, runtime } = buildRuntime({
      playlistType: 'rotation',
      rotationStrategy: 'content_match',
      items: [
        buildItem({ endTime: '09:30:00', duration: 1800 }),
        buildItem({
          id: 'item-0930',
          programCode: 'NEWS0930',
          programName: 'Mid Morning News',
          startTime: '09:30:00',
          endTime: '10:00:00',
          duration: 1800,
          sequence: 2,
        }),
      ],
    })

    const first = await submit(runtime, 'shift the whole block later by 30 minutes', {
      intent: 'batch_move',
      confidence: 1,
      source: 'test',
      slots: {
        offsetSeconds: 1800,
        direction: 'forward',
      },
    })

    expect(first.status).toBe('needs_clarification')
    expect(first.executionResult).toBeUndefined()
    expect(first.decision.pendingTask).toMatchObject({
      intent: 'batch_move',
      missingSlots: ['rangeStart', 'rangeEnd'],
      collectedSlots: {
        offsetSeconds: expect.objectContaining({ value: 1800 }),
      },
      contextFingerprint: expect.any(String),
    })

    const result = await runtime.submit({
      userInput: 'from 09:00 to 10:00',
      channelId,
      date,
      pendingTask: first.decision.pendingTask,
      interpretation: {
        intent: 'batch_move',
        pendingAction: 'continue_pending',
        confidence: 1,
        source: 'test',
        slots: {
          rangeStart: '09:00:00',
          rangeEnd: '10:00:00',
        },
      },
    })

    expect(result.status).toBe('executed')
    expect(result.decision.command).toMatchObject({
      intent: 'batch_move',
      itemIds: ['item-0900', 'item-0930'],
      offsetSeconds: 1800,
    })

    const context = await dataGateway.loadContext({ userInput: '', channelId, date })
    expect(context.scheduleItems.map((item) => item.startTime)).toEqual([
      '2026-03-25T09:30:00+08:00',
      '2026-03-25T10:00:00+08:00',
    ])
  })

  it('does not continue pending batch_move commands after playlist evidence changes', async () => {
    const { dataGateway, runtime } = buildRuntime({
      playlistType: 'rotation',
      rotationStrategy: 'content_match',
      items: [
        buildItem({ endTime: '09:30:00', duration: 1800 }),
        buildItem({
          id: 'item-0930',
          programCode: 'NEWS0930',
          programName: 'Mid Morning News',
          startTime: '09:30:00',
          endTime: '10:00:00',
          duration: 1800,
          sequence: 2,
        }),
      ],
    })

    const first = await submit(runtime, 'shift the whole block later by 30 minutes', {
      intent: 'batch_move',
      confidence: 1,
      source: 'test',
      slots: {
        offsetSeconds: 1800,
        direction: 'forward',
      },
    })

    await dataGateway.commitScheduleItems({
      channelId,
      date,
      items: [
        buildItem({
          id: 'external-0900',
          programCode: 'EXT0900',
          programName: 'External Edit',
          endTime: '09:30:00',
          duration: 1800,
        }),
      ],
      reason: 'external:user_edit',
    })

    const result = await runtime.submit({
      userInput: 'from 09:00 to 10:00',
      channelId,
      date,
      pendingTask: first.decision.pendingTask,
      interpretation: {
        intent: 'batch_move',
        pendingAction: 'continue_pending',
        confidence: 1,
        source: 'test',
        slots: {
          rangeStart: '09:00:00',
          rangeEnd: '10:00:00',
        },
      },
    })

    expect(result.status).toBe('needs_clarification')
    expect(result.executionResult).toBeUndefined()
    expect(result.decision.constraintReport?.issues[0]).toMatchObject({
      code: 'context_conflict',
    })

    const context = await dataGateway.loadContext({ userInput: '', channelId, date })
    expect(context.scheduleItems.map((item) => item.id)).toEqual(['external-0900'])
  })

  it('continues pending batch_delete commands after range clarification and waits for confirmation', async () => {
    const { dataGateway, runtime } = buildRuntime({
      playlistType: 'tv',
      items: [
        buildItem({ endTime: '09:30:00', duration: 1800 }),
        buildItem({
          id: 'item-0930',
          programCode: 'NEWS0930',
          programName: 'Mid Morning News',
          startTime: '09:30:00',
          endTime: '10:00:00',
          duration: 1800,
          sequence: 2,
        }),
      ],
    })

    const first = await submit(runtime, 'delete the whole block', {
      intent: 'batch_delete',
      confidence: 1,
      source: 'test',
      slots: {},
    })

    expect(first.status).toBe('needs_clarification')
    expect(first.executionResult).toBeUndefined()
    expect(first.decision.pendingTask).toMatchObject({
      intent: 'batch_delete',
      phase: 'needs_clarification',
      missingSlots: ['rangeStart', 'rangeEnd'],
      contextFingerprint: expect.any(String),
    })

    const second = await runtime.submit({
      userInput: 'from 09:00 to 10:00',
      channelId,
      date,
      pendingTask: first.decision.pendingTask,
      interpretation: {
        intent: 'batch_delete',
        pendingAction: 'continue_pending',
        confidence: 1,
        source: 'test',
        slots: {
          rangeStart: '09:00:00',
          rangeEnd: '10:00:00',
        },
      },
    })

    expect(second.status).toBe('needs_confirmation')
    expect(second.executionResult).toBeUndefined()
    expect(second.decision.command).toMatchObject({
      intent: 'batch_delete',
      itemIds: ['item-0900', 'item-0930'],
    })
    expect(second.decision.pendingTask).toMatchObject({
      intent: 'batch_delete',
      phase: 'needs_confirmation',
      collectedSlots: {
        targetItemIds: expect.objectContaining({ value: ['item-0900', 'item-0930'] }),
      },
    })

    const context = await dataGateway.loadContext({ userInput: '', channelId, date })
    expect(context.scheduleItems.map((item) => item.id)).toEqual(['item-0900', 'item-0930'])
  })

  it('does not continue pending batch_delete commands after playlist evidence changes', async () => {
    const { dataGateway, runtime } = buildRuntime({
      playlistType: 'tv',
      items: [
        buildItem({ endTime: '09:30:00', duration: 1800 }),
        buildItem({
          id: 'item-0930',
          programCode: 'NEWS0930',
          programName: 'Mid Morning News',
          startTime: '09:30:00',
          endTime: '10:00:00',
          duration: 1800,
          sequence: 2,
        }),
      ],
    })

    const first = await submit(runtime, 'delete the whole block', {
      intent: 'batch_delete',
      confidence: 1,
      source: 'test',
      slots: {},
    })

    await dataGateway.commitScheduleItems({
      channelId,
      date,
      items: [
        buildItem({
          id: 'external-0900',
          programCode: 'EXT0900',
          programName: 'External Edit',
          endTime: '09:30:00',
          duration: 1800,
        }),
      ],
      reason: 'external:user_edit',
    })

    const result = await runtime.submit({
      userInput: 'from 09:00 to 10:00',
      channelId,
      date,
      pendingTask: first.decision.pendingTask,
      interpretation: {
        intent: 'batch_delete',
        pendingAction: 'continue_pending',
        confidence: 1,
        source: 'test',
        slots: {
          rangeStart: '09:00:00',
          rangeEnd: '10:00:00',
        },
      },
    })

    expect(result.status).toBe('needs_clarification')
    expect(result.executionResult).toBeUndefined()
    expect(result.decision.constraintReport?.issues[0]).toMatchObject({
      code: 'context_conflict',
    })

    const context = await dataGateway.loadContext({ userInput: '', channelId, date })
    expect(context.scheduleItems.map((item) => item.id)).toEqual(['external-0900'])
  })

  it('executes TV insert commands directly after candidate and constraint checks', async () => {
    const { dataGateway, runtime } = buildRuntime({
      playlistType: 'tv',
      candidates: [buildCandidate()],
    })

    const result = await submit(runtime, 'insert Replacement News at 10:00', {
      intent: 'insert',
      confidence: 1,
      source: 'test',
      slots: {
        targetTime: '10:00:00',
        programHint: 'Replacement News',
      },
    })

    expect(result.status).toBe('executed')
    expect(result.decision.command).toMatchObject({
      intent: 'insert',
      candidateId: 'candidate-news',
      insertTime: '2026-03-25T10:00:00+08:00',
    })
    expect(result.decision.auditSummary).toMatchObject({
      outcome: 'executed',
      candidate: {
        candidateId: 'candidate-news',
      },
      contextSources: {
        candidates: {
          source: 'in_memory_seed',
          recordCount: 1,
        },
        policy: {
          source: 'in_memory_seed',
          recordCount: 1,
        },
      },
      playlistPolicy: {
        playlistType: 'tv',
        commandIntent: 'insert',
        executionMode: 'direct_execute',
        policyAction: 'execute',
        requiresConfirmation: false,
        reason: expect.stringContaining('TV playlist follows strict channel rules'),
      },
      professionalRuleSummary: {
        total: 10,
        blockingRuleIds: [],
        warningRuleIds: [],
        positiveRuleIds: expect.arrayContaining([
          'content_alignment',
          'material_readiness',
          'playlist_policy',
          'rights_readiness',
        ]),
        evidenceSourceKeys: expect.arrayContaining(['candidates', 'policy', 'readiness']),
      },
    })
    expect(result.decision.auditSummary?.keyPoints).toEqual(
      expect.arrayContaining([
        expect.stringContaining('candidates=in_memory_seed:1'),
        expect.stringContaining('播单策略：类型=tv, 命令=insert, 执行模式=direct_execute, 动作=execute, 需确认=否'),
        expect.stringContaining('证据链：'),
        expect.stringContaining('专业规则：总数=10'),
      ]),
    )
    expect(result.decision.auditSummary?.evidenceChain).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceKey: 'candidates',
          role: expect.stringContaining('candidate programme lookup'),
          recordCount: 1,
          signalCodes: expect.arrayContaining(['content_alignment', 'time_slot_fit']),
        }),
        expect.objectContaining({
          sourceKey: 'readiness',
          role: expect.stringContaining('broadcast readiness'),
          signalCodes: expect.arrayContaining(['material_readiness', 'rights_readiness']),
        }),
        expect.objectContaining({
          sourceKey: 'policy',
          signalCodes: expect.arrayContaining(['playlist_policy']),
        }),
      ]),
    )
    const catalogRuleIds = runtime.describeCapabilities().professionalRules.map((rule) => rule.id)
    const emittedRuleIds = result.decision.auditSummary?.professionalSignals.map((signal) => signal.code) ?? []
    expect(emittedRuleIds.length).toBeGreaterThan(0)
    expect(emittedRuleIds.filter((ruleId) => !catalogRuleIds.includes(ruleId))).toEqual([])
    expect(result.decision.auditSummary?.professionalRuleSummary?.total).toBe(emittedRuleIds.length)

    const context = await dataGateway.loadContext({ userInput: '', channelId, date })
    expect(context.scheduleItems).toHaveLength(1)
  })

  it('continues pending insert commands after target time clarification', async () => {
    const { dataGateway, runtime } = buildRuntime({
      playlistType: 'tv',
      candidates: [buildCandidate()],
    })

    const first = await submit(runtime, 'insert Replacement News', {
      intent: 'insert',
      confidence: 1,
      source: 'test',
      slots: {
        programHint: 'Replacement News',
      },
    })

    expect(first.status).toBe('needs_clarification')
    expect(first.decision.pendingTask).toMatchObject({
      intent: 'insert',
      phase: 'needs_clarification',
      missingSlots: ['targetTime'],
      collectedSlots: {
        programHint: expect.objectContaining({ value: 'Replacement News' }),
      },
    })
    expect(first.decision.auditSummary?.pendingTask).toMatchObject({
      phase: 'needs_clarification',
      contextFingerprint: expect.stringMatching(/^agent_context:/),
      contextSourceSummary: expect.arrayContaining([
        expect.stringMatching(/^candidates=in_memory_seed:1#/),
        expect.stringMatching(/^today=in_memory_seed:0#/),
      ]),
    })
    expect(first.decision.auditSummary?.keyPoints).toEqual(
      expect.arrayContaining([
        expect.stringContaining('待处理任务：'),
        expect.stringContaining('上下文来源='),
      ]),
    )

    const result = await runtime.submit({
      userInput: 'put it at 10:00',
      channelId,
      date,
      pendingTask: first.decision.pendingTask,
      interpretation: {
        intent: 'insert',
        pendingAction: 'continue_pending',
        confidence: 1,
        source: 'test',
        slots: {
          targetTime: '10:00:00',
        },
      },
    })

    expect(result.status).toBe('executed')
    expect(result.decision.command).toMatchObject({
      intent: 'insert',
      candidateId: 'candidate-news',
      insertTime: '2026-03-25T10:00:00+08:00',
    })

    const context = await dataGateway.loadContext({ userInput: '', channelId, date })
    expect(context.scheduleItems.map((item) => item.programName)).toEqual(['Replacement News'])
  })

  it('continues LLM-only multi-turn rotation short-clip insert without programme code and waits for confirmation', async () => {
    const clipCandidate = buildCandidate({
      id: 'asset-short-city-flower',
      programId: 'asset-short-city-flower',
      programCode: '',
      programName: '城市微短片：春日花路 30秒',
      instanceName: '城市微短片：春日花路 30秒',
      columnId: 'rotation-promo',
      columnName: '轮播短片',
      duration: 30,
      programType: 'short_clip',
      contentTags: ['城市形象', '春日花路', '短片', '无节目编号', '轮播'],
    })
    const { dataGateway, runtime } = buildRuntime({
      playlistType: 'rotation',
      rotationStrategy: 'content_match',
      candidates: [clipCandidate],
    })

    const first = await runtime.submit({
      userInput: '插入城市形象春日花路短片',
      channelId,
      date,
      interpretation: {
        intent: 'insert',
        confidence: 1,
        source: 'test',
        slots: {
          programHint: '城市形象春日花路短片',
        },
      },
    })

    expect(first.status).toBe('needs_clarification')
    expect(first.decision.pendingTask).toMatchObject({
      intent: 'insert',
      phase: 'needs_clarification',
      missingSlots: ['targetTime'],
      collectedSlots: {
        programHint: expect.objectContaining({
          value: '城市形象春日花路短片',
        }),
      },
    })

    const second = await runtime.submit({
      userInput: '0点',
      channelId,
      date,
      pendingTask: first.decision.pendingTask,
      interpretation: {
        intent: 'insert',
        pendingAction: 'continue_pending',
        confidence: 1,
        source: 'test',
        slots: {
          targetTime: '00:00:00',
        },
      },
    })

    expect(second.status).toBe('needs_confirmation')
    expect(second.decision.command).toMatchObject({
      intent: 'insert',
      candidateId: 'asset-short-city-flower',
      insertTime: '2026-03-25T00:00:00+08:00',
    })
    expect(second.decision.pendingTask).toMatchObject({
      intent: 'insert',
      phase: 'needs_confirmation',
      collectedSlots: {
        programHint: expect.objectContaining({ value: '城市形象春日花路短片' }),
        targetTime: expect.objectContaining({ value: '00:00:00' }),
        candidateId: expect.objectContaining({ value: 'asset-short-city-flower' }),
      },
    })
    expect(second.decision.recommendations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          candidateId: 'asset-short-city-flower',
          programName: '城市微短片：春日花路 30秒',
        }),
      ]),
    )

    const context = await dataGateway.loadContext({ userInput: '', channelId, date })
    expect(context.scheduleItems).toHaveLength(0)
  })

  it('blocks LLM-only natural rotation short-clip insert when the relative destination is already occupied', async () => {
    const clipCandidate = buildCandidate({
      id: 'asset-short-city-flower',
      programId: 'asset-short-city-flower',
      programCode: '',
      programName: '城市微短片：春日花路 30秒',
      instanceName: '城市微短片：春日花路 30秒',
      columnId: 'rotation-promo',
      columnName: '轮播短片',
      duration: 30,
      programType: 'short_clip',
      contentTags: ['城市形象', '春日花路', '短片', '无节目编号', '轮播'],
    })
    const { dataGateway, runtime } = buildRuntime({
      playlistType: 'rotation',
      rotationStrategy: 'content_match',
      items: [buildItem({
        id: 'existing-rotation-clip',
        programCode: '',
        programName: '既有轮播短片',
        startTime: '00:00:00',
        endTime: '00:00:30',
        duration: 30,
        programType: 'short_clip',
      })],
      candidates: [clipCandidate],
    })

    const result = await runtime.submit({
      userInput: '0点插入城市形象春日花路短片',
      channelId,
      date,
      interpretation: {
        intent: 'insert',
        confidence: 1,
        source: 'test',
        slots: {
          targetTime: '00:00:00',
          programHint: '城市形象春日花路短片',
        },
      },
    })

    expect(result.status).toBe('blocked')
    expect(result.decision.constraintReport?.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'time_overlap',
          detail: expect.objectContaining({
            blockedPolicy: 'no_auto_shift_replace_reorder',
          }),
        }),
      ]),
    )

    const context = await dataGateway.loadContext({ userInput: '', channelId, date })
    expect(context.scheduleItems).toHaveLength(1)
    expect(context.scheduleItems[0]).toMatchObject({
      id: 'existing-rotation-clip',
      programName: '既有轮播短片',
    })
  })

  it('continues pending insert commands after programme clarification', async () => {
    const { dataGateway, runtime } = buildRuntime({
      playlistType: 'tv',
      candidates: [buildCandidate()],
    })

    const first = await submit(runtime, 'insert at 10:00', {
      intent: 'insert',
      confidence: 1,
      source: 'test',
      slots: {
        targetTime: '10:00:00',
      },
    })

    expect(first.status).toBe('needs_clarification')
    expect(first.decision.pendingTask).toMatchObject({
      intent: 'insert',
      phase: 'needs_clarification',
      missingSlots: ['programHint'],
      collectedSlots: {
        targetTime: expect.objectContaining({ value: '10:00:00' }),
      },
    })

    const result = await runtime.submit({
      userInput: 'Replacement News',
      channelId,
      date,
      pendingTask: first.decision.pendingTask,
      interpretation: {
        intent: 'insert',
        pendingAction: 'continue_pending',
        confidence: 1,
        source: 'test',
        slots: {
          programHint: 'Replacement News',
        },
      },
    })

    expect(result.status).toBe('executed')
    expect(result.decision.command).toMatchObject({
      intent: 'insert',
      candidateId: 'candidate-news',
      insertTime: '2026-03-25T10:00:00+08:00',
    })

    const context = await dataGateway.loadContext({ userInput: '', channelId, date })
    expect(context.scheduleItems.map((item) => item.programName)).toEqual(['Replacement News'])
  })

  it('allows explicit TV insert candidates that break information slot duty with a weighting warning', async () => {
    const { dataGateway, runtime } = buildRuntime({
      playlistType: 'tv',
      candidates: [buildCandidate({
        id: 'candidate-morning-movie',
        programCode: 'MOVIE0800',
        programName: 'Morning Movie',
        instanceName: 'Morning Movie',
        columnId: 'movie',
        columnName: 'Movie',
        programType: 'movie',
        contentTags: ['movie'],
      })],
    })

    const result = await submit(runtime, 'insert Morning Movie at 08:00', {
      intent: 'insert',
      confidence: 1,
      source: 'test',
      slots: {
        targetTime: '08:00:00',
        programHint: 'Morning Movie',
      },
    })

    expect(result.status).toBe('executed')
    expect(result.executionResult?.committed).toBe(true)
    expect(result.decision.constraintReport?.ok).toBe(true)
    expect(result.decision.candidateSelection?.professionalAssessment?.hardBlockCodes).toEqual([])
    expect(result.decision.candidateSelection?.professionalAssessment?.signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'time_slot_fit',
          verdict: 'warn',
          sourceKeys: ['candidates', 'policy'],
        }),
      ]),
    )
    expect(result.decision.auditSummary?.evidenceChain).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceKey: 'candidates',
          signalCodes: expect.arrayContaining(['time_slot_fit']),
        }),
        expect.objectContaining({
          sourceKey: 'policy',
          signalCodes: expect.arrayContaining(['time_slot_fit']),
        }),
      ]),
    )

    const context = await dataGateway.loadContext({ userInput: '', channelId, date })
    expect(context.scheduleItems[0]?.programName).toBe('Morning Movie')
  })

  it('keeps rotation insert time-slot mismatches as recommendations instead of direct commits', async () => {
    const { dataGateway, runtime } = buildRuntime({
      playlistType: 'rotation',
      rotationStrategy: 'content_match',
      candidates: [buildCandidate({
        id: 'candidate-morning-drama',
        programCode: 'DRAMA0800',
        programName: 'Morning Drama',
        instanceName: 'Morning Drama',
        columnId: 'drama',
        columnName: 'Drama',
        programType: 'drama',
        contentTags: ['drama', 'series'],
      })],
    })

    const result = await submit(runtime, 'insert Morning Drama at 08:00', {
      intent: 'insert',
      confidence: 1,
      source: 'test',
      slots: {
        targetTime: '08:00:00',
        programHint: 'Morning Drama',
      },
    })

    expect(result.status).toBe('needs_confirmation')
    expect(result.decision.pendingTask).toMatchObject({
      intent: 'insert',
      phase: 'needs_confirmation',
      missingSlots: ['confirmation'],
    })
    expect(result.decision.candidateSelection?.professionalAssessment?.signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'time_slot_fit',
          verdict: 'warn',
        }),
      ]),
    )

    const context = await dataGateway.loadContext({ userInput: '', channelId, date })
    expect(context.scheduleItems).toHaveLength(0)
  })

  it('allows explicit TV insert candidates that break prime-time slot duty with a weighting warning', async () => {
    const { dataGateway, runtime } = buildRuntime({
      playlistType: 'tv',
      candidates: [buildCandidate({
        id: 'candidate-prime-news-brief',
        programCode: 'NEWS-BRIEF-2000',
        programName: 'Prime Time News Brief',
        instanceName: 'Prime Time News Brief',
        columnId: 'news',
        columnName: 'News',
        programType: 'news',
        contentTags: ['news', 'service'],
      })],
    })

    const result = await submit(runtime, 'insert Prime Time News Brief at 20:00', {
      intent: 'insert',
      confidence: 1,
      source: 'test',
      slots: {
        targetTime: '20:00:00',
        programHint: 'Prime Time News Brief',
      },
    })

    expect(result.status).toBe('executed')
    expect(result.executionResult?.committed).toBe(true)
    expect(result.decision.constraintReport?.ok).toBe(true)
    expect(result.decision.candidateSelection?.professionalAssessment?.hardBlockCodes).toEqual([])
    expect(result.decision.candidateSelection?.professionalAssessment?.signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'time_slot_fit',
          verdict: 'warn',
          sourceKeys: ['candidates', 'policy'],
        }),
      ]),
    )

    const context = await dataGateway.loadContext({ userInput: '', channelId, date })
    expect(context.scheduleItems[0]?.programName).toBe('Prime Time News Brief')
  })

  it('keeps rotation prime-time slot duty mismatches as confirmation warnings', async () => {
    const { dataGateway, runtime } = buildRuntime({
      playlistType: 'rotation',
      rotationStrategy: 'content_match',
      candidates: [buildCandidate({
        id: 'candidate-prime-news-brief',
        programCode: 'NEWS-BRIEF-2000',
        programName: 'Prime Time News Brief',
        instanceName: 'Prime Time News Brief',
        columnId: 'news',
        columnName: 'News',
        programType: 'news',
        contentTags: ['news', 'service'],
      })],
    })

    const result = await submit(runtime, 'insert Prime Time News Brief at 20:00', {
      intent: 'insert',
      confidence: 1,
      source: 'test',
      slots: {
        targetTime: '20:00:00',
        programHint: 'Prime Time News Brief',
      },
    })

    expect(result.status).toBe('needs_confirmation')
    expect(result.decision.pendingTask).toMatchObject({
      intent: 'insert',
      phase: 'needs_confirmation',
      missingSlots: ['confirmation'],
    })
    expect(result.decision.candidateSelection?.professionalAssessment?.hardBlockCodes).toEqual([])
    expect(result.decision.candidateSelection?.professionalAssessment?.signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'time_slot_fit',
          verdict: 'warn',
        }),
      ]),
    )

    const context = await dataGateway.loadContext({ userInput: '', channelId, date })
    expect(context.scheduleItems).toHaveLength(0)
  })

  it('blocks TV insert candidates that duplicate a same-day programme asset', async () => {
    const { dataGateway, runtime } = buildRuntime({
      playlistType: 'tv',
      items: [buildItem({
        id: 'item-news-0900',
        programCode: 'NEWS-DUPLICATE',
        programName: 'Replacement News',
      })],
      candidates: [buildCandidate({ programCode: 'NEWS-DUPLICATE' })],
    })

    const result = await submit(runtime, 'insert Replacement News at 10:00', {
      intent: 'insert',
      confidence: 1,
      source: 'test',
      slots: {
        targetTime: '10:00:00',
        programHint: 'Replacement News',
      },
    })

    expect(result.status).toBe('blocked')
    expect(result.executionResult).toBeUndefined()
    expect(result.decision.constraintReport?.issues[0]).toMatchObject({
      code: 'same_day_duplicate_violation',
      severity: 'critical',
      detail: {
        selectedCandidateId: 'candidate-news',
        hardBlockCodes: ['same_day_duplicate'],
        signalCode: 'same_day_duplicate',
        sourceKeys: ['today', 'candidates', 'policy'],
      },
    })
    expect(result.decision.candidateSelection?.professionalAssessment?.signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'same_day_duplicate',
          verdict: 'block',
          sourceKeys: ['today', 'candidates', 'policy'],
        }),
      ]),
    )

    const context = await dataGateway.loadContext({ userInput: '', channelId, date })
    expect(context.scheduleItems.map((item) => item.id)).toEqual(['item-news-0900'])
  })

  it('keeps rotation same-day duplicates as confirmation warnings', async () => {
    const { dataGateway, runtime } = buildRuntime({
      playlistType: 'rotation',
      rotationStrategy: 'content_match',
      items: [buildItem({
        id: 'item-news-0900',
        programCode: 'NEWS-DUPLICATE',
        programName: 'Replacement News',
      })],
      candidates: [buildCandidate({ programCode: 'NEWS-DUPLICATE' })],
    })

    const result = await submit(runtime, 'insert Replacement News at 10:00', {
      intent: 'insert',
      confidence: 1,
      source: 'test',
      slots: {
        targetTime: '10:00:00',
        programHint: 'Replacement News',
      },
    })

    expect(result.status).toBe('needs_confirmation')
    expect(result.decision.pendingTask).toMatchObject({
      intent: 'insert',
      phase: 'needs_confirmation',
      missingSlots: ['confirmation'],
    })
    expect(result.decision.constraintReport?.ok).toBe(true)
    expect(result.decision.candidateSelection?.professionalAssessment?.hardBlockCodes).toEqual([])
    expect(result.decision.candidateSelection?.professionalAssessment?.signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'same_day_duplicate',
          verdict: 'warn',
          sourceKeys: ['today', 'candidates'],
        }),
      ]),
    )

    const context = await dataGateway.loadContext({ userInput: '', channelId, date })
    expect(context.scheduleItems.map((item) => item.id)).toEqual(['item-news-0900'])
  })

  it('blocks TV insert candidates that violate recent replay interval history', async () => {
    const { dataGateway, runtime } = buildRuntime({
      playlistType: 'tv',
      candidates: [buildCandidate({ programCode: 'NEWS-REPLAY' })],
      historySchedules: [{
        date: '2026-03-24',
        itemCount: 1,
        programTypes: { news: 1 },
        items: [buildItem({
          id: 'history-news-1000',
          programId: 'program-news',
          programCode: 'NEWS-REPLAY',
          programName: 'Replacement News',
          startTime: '2026-03-24T10:00:00+08:00',
          endTime: '2026-03-24T10:30:00+08:00',
        })],
      }],
    })

    const result = await submit(runtime, 'insert Replacement News at 10:00', {
      intent: 'insert',
      confidence: 1,
      source: 'test',
      slots: {
        targetTime: '10:00:00',
        programHint: 'Replacement News',
      },
    })

    expect(result.status).toBe('blocked')
    expect(result.executionResult).toBeUndefined()
    expect(result.decision.constraintReport?.issues[0]).toMatchObject({
      code: 'recent_replay_violation',
      severity: 'critical',
      detail: {
        selectedCandidateId: 'candidate-news',
        hardBlockCodes: ['recent_replay_interval'],
        signalCode: 'recent_replay_interval',
        sourceKeys: ['history', 'candidates', 'policy'],
      },
    })
    expect(result.decision.candidateSelection?.professionalAssessment?.signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'recent_replay_interval',
          verdict: 'block',
          sourceKeys: ['history', 'candidates', 'policy'],
        }),
      ]),
    )

    const context = await dataGateway.loadContext({ userInput: '', channelId, date })
    expect(context.scheduleItems).toHaveLength(0)
  })

  it('keeps rotation recent replay intervals as confirmation warnings instead of direct commits', async () => {
    const { dataGateway, runtime } = buildRuntime({
      playlistType: 'rotation',
      rotationStrategy: 'content_match',
      candidates: [buildCandidate({ programCode: 'NEWS-REPLAY' })],
      historySchedules: [{
        date: '2026-03-24',
        itemCount: 1,
        programTypes: { news: 1 },
        items: [buildItem({
          id: 'history-news-1000',
          programId: 'program-news',
          programCode: 'NEWS-REPLAY',
          programName: 'Replacement News',
          startTime: '2026-03-24T10:00:00+08:00',
          endTime: '2026-03-24T10:30:00+08:00',
        })],
      }],
    })

    const result = await submit(runtime, 'insert Replacement News at 10:00', {
      intent: 'insert',
      confidence: 1,
      source: 'test',
      slots: {
        targetTime: '10:00:00',
        programHint: 'Replacement News',
      },
    })

    expect(result.status).toBe('needs_confirmation')
    expect(result.decision.pendingTask).toMatchObject({
      intent: 'insert',
      phase: 'needs_confirmation',
      missingSlots: ['confirmation'],
      recommendations: [
        expect.objectContaining({
          candidateId: 'candidate-news',
          warningCodes: ['recent_replay_interval'],
          blockingCodes: [],
          evidenceSourceKeys: expect.arrayContaining(['history', 'candidates', 'policy']),
          professionalSignals: expect.arrayContaining([
            expect.objectContaining({
              code: 'recent_replay_interval',
              verdict: 'warn',
              sourceKeys: ['history', 'candidates', 'policy'],
            }),
          ]),
        }),
      ],
    })
    expect(result.decision.recommendations?.[0]).toMatchObject({
      candidateId: 'candidate-news',
      warningCodes: ['recent_replay_interval'],
      blockingCodes: [],
      evidenceSourceKeys: expect.arrayContaining(['history', 'candidates', 'policy']),
    })
    expect(result.decision.pendingTask).toBeDefined()
    const pendingLlmContext = buildPendingLlmContext(result.decision.pendingTask!, '')
    expect(pendingLlmContext).toMatchObject({
      pendingContext: {
        phase: 'needs_confirmation',
        recommendations: [
          expect.objectContaining({
            candidateId: 'candidate-news',
            warningCodes: ['recent_replay_interval'],
            evidenceSourceKeys: expect.arrayContaining(['history', 'candidates', 'policy']),
            professionalSignals: expect.arrayContaining([
              expect.objectContaining({
                code: 'recent_replay_interval',
                verdict: 'warn',
              }),
            ]),
          }),
        ],
      },
      allowedActions: expect.arrayContaining(['confirm', 'reject']),
    })
    expect(result.decision.constraintReport?.ok).toBe(true)
    expect(result.decision.candidateSelection?.professionalAssessment?.hardBlockCodes).toEqual([])
    expect(result.decision.candidateSelection?.professionalAssessment?.signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'recent_replay_interval',
          verdict: 'warn',
          sourceKeys: ['history', 'candidates', 'policy'],
        }),
      ]),
    )

    const context = await dataGateway.loadContext({ userInput: '', channelId, date })
    expect(context.scheduleItems).toHaveLength(0)
  })

  it('blocks TV insert candidates that skip the previous-day episode baseline', async () => {
    const historyEpisode4 = buildItem({
      id: 'history-drama-4',
      programId: 'series-drama',
      programCode: 'DRAMA0004',
      programName: 'Prime Drama Episode 4',
      startTime: '2026-03-24T21:00:00+08:00',
      endTime: '2026-03-24T21:45:00+08:00',
      duration: 2700,
      programType: 'drama',
      sequence: 4,
    })
    const { dataGateway, runtime } = buildRuntime({
      playlistType: 'tv',
      candidates: [buildCandidate({
        id: 'candidate-drama-6',
        programId: 'series-drama',
        programCode: 'DRAMA0006',
        programName: 'Prime Drama Episode 6',
        instanceName: 'Prime Drama Episode 6',
        duration: 2700,
        programType: 'drama',
        sequence: 6,
      })],
      historySchedules: [{
        date: '2026-03-24',
        itemCount: 1,
        programTypes: { drama: 1 },
        items: [historyEpisode4],
      }],
    })

    const result = await submit(runtime, 'insert Prime Drama at 10:00', {
      intent: 'insert',
      confidence: 1,
      source: 'test',
      slots: {
        targetTime: '10:00:00',
        programHint: 'Prime Drama',
      },
    })

    expect(result.status).toBe('blocked')
    expect(result.executionResult).toBeUndefined()
    expect(result.decision.candidateSelection).toMatchObject({
      method: 'tv_sequence',
      source: 'history',
      expectedSequence: 5,
      selectedSequence: 6,
    })
    expect(result.decision.constraintReport?.issues[0]).toMatchObject({
      code: 'sequence_violation',
      detail: {
        source: 'history',
        expectedSequence: 5,
        selectedSequence: 6,
      },
    })

    const context = await dataGateway.loadContext({ userInput: '', channelId, date })
    expect(context.scheduleItems).toHaveLength(0)
  })

  it('uses the latest history schedule, not the largest historical episode, as the TV baseline', async () => {
    const olderEpisode10 = buildItem({
      id: 'history-drama-10',
      programId: 'series-drama',
      programCode: 'DRAMA0010',
      programName: 'Prime Drama Episode 10',
      startTime: '2026-03-23T21:00:00+08:00',
      endTime: '2026-03-23T21:45:00+08:00',
      duration: 2700,
      programType: 'drama',
      sequence: 10,
    })
    const latestEpisode4 = buildItem({
      id: 'history-drama-4',
      programId: 'series-drama',
      programCode: 'DRAMA0004',
      programName: 'Prime Drama Episode 4',
      startTime: '2026-03-24T21:00:00+08:00',
      endTime: '2026-03-24T21:45:00+08:00',
      duration: 2700,
      programType: 'drama',
      sequence: 4,
    })
    const { dataGateway, runtime } = buildRuntime({
      playlistType: 'tv',
      candidates: [
        buildCandidate({
          id: 'candidate-drama-5',
          programId: 'series-drama',
          programCode: 'DRAMA0005',
          programName: 'Prime Drama Episode 5',
          instanceName: 'Prime Drama Episode 5',
          duration: 2700,
          programType: 'drama',
          sequence: 5,
        }),
        buildCandidate({
          id: 'candidate-drama-11',
          programId: 'series-drama',
          programCode: 'DRAMA0011',
          programName: 'Prime Drama Episode 11',
          instanceName: 'Prime Drama Episode 11',
          duration: 2700,
          programType: 'drama',
          sequence: 11,
        }),
      ],
      historySchedules: [
        {
          date: '2026-03-23',
          itemCount: 1,
          programTypes: { drama: 1 },
          items: [olderEpisode10],
        },
        {
          date: '2026-03-24',
          itemCount: 1,
          programTypes: { drama: 1 },
          items: [latestEpisode4],
        },
      ],
    })

    const result = await submit(runtime, 'insert Prime Drama at 10:00', {
      intent: 'insert',
      confidence: 1,
      source: 'test',
      slots: {
        targetTime: '10:00:00',
        programHint: 'Prime Drama',
      },
    })

    expect(result.status).toBe('executed')
    expect(result.decision.candidateSelection).toMatchObject({
      method: 'tv_sequence',
      source: 'history',
      expectedSequence: 5,
      selectedSequence: 5,
      selectedCandidateId: 'candidate-drama-5',
    })
    expect(result.decision.command).toMatchObject({
      intent: 'insert',
      candidateId: 'candidate-drama-5',
    })

    const context = await dataGateway.loadContext({ userInput: '', channelId, date })
    expect(context.scheduleItems).toHaveLength(1)
    expect(context.scheduleItems[0]).toMatchObject({
      programName: 'Prime Drama Episode 5',
    })
  })

  it('uses Chinese episode names from latest history to select the next TV episode', async () => {
    const humanitiesTitle = '\u4eba\u6587\u4e2d\u56fd'
    const episode12 = `${humanitiesTitle} \u7b2c\u5341\u4e8c\u96c6`
    const episode13 = `${humanitiesTitle} \u7b2c\u5341\u4e09\u96c6`
    const episode14 = `${humanitiesTitle} \u7b2c\u5341\u56db\u96c6`
    const yesterdayEpisode12 = buildItem({
      id: 'history-humanities-12',
      programId: undefined,
      programCode: 'RENWEN-A',
      programName: '人文中国 第十二集',
      instanceName: '人文中国 第十二集',
      startTime: '2026-03-24T20:00:00+08:00',
      endTime: '2026-03-24T20:30:00+08:00',
      duration: 1800,
      programType: 'documentary',
    })
    const { dataGateway, runtime } = buildRuntime({
      playlistType: 'tv',
      candidates: [
        buildCandidate({
          id: 'candidate-humanities-14',
          programId: undefined,
          programCode: 'RENWEN-B',
          programName: '人文中国 第十四集',
          instanceName: '人文中国 第十四集',
          duration: 1800,
          programType: 'documentary',
        }),
        buildCandidate({
          id: 'candidate-humanities-13',
          programId: undefined,
          programCode: 'RENWEN-C',
          programName: '人文中国 第十三集',
          instanceName: '人文中国 第十三集',
          duration: 1800,
          programType: 'documentary',
        }),
      ],
      historySchedules: [{
        date: '2026-03-24',
        itemCount: 1,
        programTypes: { documentary: 1 },
        items: [yesterdayEpisode12],
      }],
    })

    const result = await submit(runtime, '今天 10 点接着排人文中国', {
      intent: 'insert',
      confidence: 1,
      source: 'test',
      slots: {
        targetTime: '10:00:00',
        programHint: '人文中国',
      },
    })

    expect(result.status).toBe('executed')
    expect(result.decision.candidateSelection).toMatchObject({
      method: 'tv_sequence',
      source: 'history',
      expectedSequence: 13,
      selectedSequence: 13,
      selectedCandidateId: 'candidate-humanities-13',
    })
    expect(result.decision.command).toMatchObject({
      intent: 'insert',
      candidateId: 'candidate-humanities-13',
    })

    const context = await dataGateway.loadContext({ userInput: '', channelId, date })
    expect(context.scheduleItems).toHaveLength(1)
    expect(context.scheduleItems[0]).toMatchObject({
      programName: '人文中国 第十三集',
    })
  })

  it('selects the next TV episode from real Chinese escaped titles', async () => {
    const seriesTitle = '\u4eba\u6587\u4e2d\u56fd'
    const episode12 = `${seriesTitle} \u7b2c\u5341\u4e8c\u96c6`
    const episode13 = `${seriesTitle} \u7b2c\u5341\u4e09\u96c6`
    const episode14 = `${seriesTitle} \u7b2c\u5341\u56db\u96c6`
    const yesterdayEpisode12 = buildItem({
      id: 'history-humanities-clean-12',
      programId: undefined,
      programCode: 'RENWEN-A',
      programName: episode12,
      instanceName: episode12,
      startTime: '2026-03-24T20:00:00+08:00',
      endTime: '2026-03-24T20:30:00+08:00',
      duration: 1800,
      programType: 'documentary',
    })
    const { dataGateway, runtime } = buildRuntime({
      playlistType: 'tv',
      candidates: [
        buildCandidate({
          id: 'candidate-humanities-clean-14',
          programId: undefined,
          programCode: 'RENWEN-B',
          programName: episode14,
          instanceName: episode14,
          duration: 1800,
          programType: 'documentary',
        }),
        buildCandidate({
          id: 'candidate-humanities-clean-13',
          programId: undefined,
          programCode: 'RENWEN-C',
          programName: episode13,
          instanceName: episode13,
          duration: 1800,
          programType: 'documentary',
        }),
      ],
      historySchedules: [{
        date: '2026-03-24',
        itemCount: 1,
        programTypes: { documentary: 1 },
        items: [yesterdayEpisode12],
      }],
    })

    const result = await submit(runtime, `today at 10 continue ${seriesTitle}`, {
      intent: 'insert',
      confidence: 1,
      source: 'test',
      slots: {
        targetTime: '10:00:00',
        programHint: seriesTitle,
      },
    })

    expect(result.status).toBe('executed')
    expect(result.decision.candidateSelection).toMatchObject({
      method: 'tv_sequence',
      source: 'history',
      expectedSequence: 13,
      selectedSequence: 13,
      selectedCandidateId: 'candidate-humanities-clean-13',
    })

    const context = await dataGateway.loadContext({ userInput: '', channelId, date })
    expect(context.scheduleItems[0]).toMatchObject({
      programName: episode13,
    })
  })

  it('blocks TV sequential candidate fallback when no today or latest-history baseline exists', async () => {
    const { dataGateway, runtime } = buildRuntime({
      playlistType: 'tv',
      candidates: [
        buildCandidate({
          id: 'candidate-drama-5',
          programId: 'series-drama',
          programCode: 'DRAMA0005',
          programName: 'Prime Drama Episode 5',
          instanceName: 'Prime Drama Episode 5',
          duration: 2700,
          programType: 'drama',
          issueNo: '0005',
        }),
        buildCandidate({
          id: 'candidate-drama-6',
          programId: 'series-drama',
          programCode: 'DRAMA0006',
          programName: 'Prime Drama Episode 6',
          instanceName: 'Prime Drama Episode 6',
          duration: 2700,
          programType: 'drama',
          issueNo: '0006',
        }),
      ],
      historySchedules: [],
    })

    const result = await submit(runtime, 'insert Prime Drama at 10:00', {
      intent: 'insert',
      confidence: 1,
      source: 'test',
      slots: {
        targetTime: '10:00:00',
        programHint: 'Prime Drama',
      },
    })

    expect(result.status).toBe('blocked')
    expect(result.executionResult).toBeUndefined()
    expect(result.decision.candidateSelection).toMatchObject({
      method: 'tv_sequence',
      source: 'none',
      candidateOptionIds: ['candidate-drama-5', 'candidate-drama-6'],
    })
    expect(result.decision.constraintReport?.issues[0]).toMatchObject({
      code: 'history_source_missing',
      severity: 'critical',
      detail: {
        candidateOptionIds: ['candidate-drama-5', 'candidate-drama-6'],
      },
    })

    const context = await dataGateway.loadContext({ userInput: '', channelId, date })
    expect(context.scheduleItems).toHaveLength(0)
  })

  it('blocks explicitly selected TV sequential candidates when no sequence baseline exists', async () => {
    const { dataGateway, runtime } = buildRuntime({
      playlistType: 'tv',
      candidates: [
        buildCandidate({
          id: 'candidate-drama-5',
          programId: 'series-drama',
          programCode: 'DRAMA0005',
          programName: 'Prime Drama Episode 5',
          instanceName: 'Prime Drama Episode 5',
          duration: 2700,
          programType: 'drama',
          issueNo: '0005',
        }),
      ],
      historySchedules: [],
    })

    const result = await submit(runtime, 'insert Prime Drama episode 5 at 10:00', {
      intent: 'insert',
      confidence: 1,
      source: 'test',
      slots: {
        targetTime: '10:00:00',
        programHint: 'Prime Drama',
        candidateId: 'candidate-drama-5',
      },
    })

    expect(result.status).toBe('blocked')
    expect(result.executionResult).toBeUndefined()
    expect(result.decision.candidateSelection).toMatchObject({
      method: 'tv_sequence',
      source: 'none',
      selectedCandidateId: 'candidate-drama-5',
      candidateOptionIds: ['candidate-drama-5'],
    })
    expect(result.decision.constraintReport?.issues[0]).toMatchObject({
      code: 'history_source_missing',
      severity: 'critical',
    })

    const context = await dataGateway.loadContext({ userInput: '', channelId, date })
    expect(context.scheduleItems).toHaveLength(0)
  })

  it('asks for editorial selection when multiple TV candidates satisfy the next episode rule', async () => {
    const historyEpisode4 = buildItem({
      id: 'history-drama-4',
      programId: 'series-drama',
      programCode: 'DRAMA0004',
      programName: 'Prime Drama Episode 4',
      startTime: '2026-03-24T21:00:00+08:00',
      endTime: '2026-03-24T21:45:00+08:00',
      duration: 2700,
      programType: 'drama',
      sequence: 4,
    })
    const { dataGateway, runtime } = buildRuntime({
      playlistType: 'tv',
      candidates: [
        buildCandidate({
          id: 'candidate-drama-5-clean',
          programId: 'series-drama',
          programCode: 'DRAMA0005',
          programName: 'Prime Drama Episode 5 Clean Version',
          instanceName: 'Prime Drama Episode 5 Clean Version',
          duration: 2700,
          programType: 'drama',
          sequence: 5,
        }),
        buildCandidate({
          id: 'candidate-drama-5-subtitled',
          programId: 'series-drama',
          programCode: 'DRAMA0005',
          programName: 'Prime Drama Episode 5 Subtitled Version',
          instanceName: 'Prime Drama Episode 5 Subtitled Version',
          duration: 2700,
          programType: 'drama',
          sequence: 5,
        }),
        buildCandidate({
          id: 'candidate-breaking-news',
          programId: 'program-breaking-news',
          programCode: 'NEWS1100',
          programName: 'Breaking News Special',
          instanceName: 'Breaking News Special',
          duration: 1800,
          programType: 'news',
        }),
      ],
      historySchedules: [{
        date: '2026-03-24',
        itemCount: 1,
        programTypes: { drama: 1 },
        items: [historyEpisode4],
      }],
    })

    const first = await submit(runtime, 'insert Prime Drama at 10:00', {
      intent: 'insert',
      confidence: 1,
      source: 'test',
      slots: {
        targetTime: '10:00:00',
        programHint: 'Prime Drama',
      },
    })

    expect(first.status).toBe('needs_selection')
    expect(first.executionResult).toBeUndefined()
    expect(first.decision.candidateSelection).toMatchObject({
      method: 'tv_sequence',
      source: 'history',
      expectedSequence: 5,
      candidateOptionIds: ['candidate-drama-5-clean', 'candidate-drama-5-subtitled'],
    })
    expect(first.decision.pendingTask).toMatchObject({
      intent: 'insert',
      phase: 'needs_selection',
      missingSlots: ['candidateId'],
      recommendations: [
        expect.objectContaining({ candidateId: 'candidate-drama-5-clean' }),
        expect.objectContaining({ candidateId: 'candidate-drama-5-subtitled' }),
      ],
    })
    expect(first.decision.constraintReport?.issues[0]).toMatchObject({
      code: 'program_ambiguous',
      detail: {
        expectedSequence: 5,
        candidateOptionIds: ['candidate-drama-5-clean', 'candidate-drama-5-subtitled'],
      },
    })

    const invalidSelection = await runtime.submit({
      userInput: 'use the breaking news one',
      channelId,
      date,
      pendingTask: first.decision.pendingTask,
      interpretation: {
        intent: 'insert',
        pendingAction: 'select_candidate',
        confidence: 1,
        source: 'test',
        slots: {
          candidateId: 'candidate-breaking-news',
        },
      },
    })

    expect(invalidSelection.status).toBe('needs_selection')
    expect(invalidSelection.executionResult).toBeUndefined()
    expect(invalidSelection.decision.candidateSelection).toMatchObject({
      method: 'tv_sequence',
      candidateOptionIds: ['candidate-drama-5-clean', 'candidate-drama-5-subtitled'],
    })

    await expect(dataGateway.loadContext({ userInput: '', channelId, date })).resolves.toMatchObject({
      scheduleItems: [],
    })

    const result = await runtime.submit({
      userInput: 'use the subtitled version',
      channelId,
      date,
      pendingTask: first.decision.pendingTask,
      interpretation: {
        intent: 'insert',
        pendingAction: 'select_candidate',
        confidence: 1,
        source: 'test',
        slots: {
          candidateId: 'candidate-drama-5-subtitled',
        },
      },
    })

    expect(result.status).toBe('executed')
    expect(result.decision.command).toMatchObject({
      intent: 'insert',
      candidateId: 'candidate-drama-5-subtitled',
    })

    const context = await dataGateway.loadContext({ userInput: '', channelId, date })
    expect(context.scheduleItems).toHaveLength(1)
    expect(context.scheduleItems[0]).toMatchObject({
      programName: 'Prime Drama Episode 5 Subtitled Version',
      startTime: '2026-03-25T10:00:00+08:00',
    })
  })

  it('continues foreground candidate card selections as confirmation-ready Agent context', async () => {
    const historyEpisode4 = buildItem({
      id: 'history-drama-4',
      programId: 'series-drama',
      programCode: 'DRAMA0004',
      programName: 'Prime Drama Episode 4',
      startTime: '2026-03-24T21:00:00+08:00',
      endTime: '2026-03-24T21:45:00+08:00',
      duration: 2700,
      programType: 'drama',
      sequence: 4,
    })
    const { dataGateway, runtime } = buildRuntime({
      playlistType: 'tv',
      candidates: [
        buildCandidate({
          id: 'candidate-drama-5-clean',
          programId: 'series-drama',
          programCode: 'DRAMA0005',
          programName: 'Prime Drama Episode 5 Clean Version',
          instanceName: 'Prime Drama Episode 5 Clean Version',
          duration: 2700,
          programType: 'drama',
          sequence: 5,
        }),
        buildCandidate({
          id: 'candidate-drama-5-subtitled',
          programId: 'series-drama',
          programCode: 'DRAMA0005',
          programName: 'Prime Drama Episode 5 Subtitled Version',
          instanceName: 'Prime Drama Episode 5 Subtitled Version',
          duration: 2700,
          programType: 'drama',
          sequence: 5,
        }),
      ],
      historySchedules: [{
        date: '2026-03-24',
        itemCount: 1,
        programTypes: { drama: 1 },
        items: [historyEpisode4],
      }],
    })

    const first = await submit(runtime, 'insert Prime Drama at 10:00', {
      intent: 'insert',
      confidence: 1,
      source: 'test',
      slots: {
        targetTime: '10:00:00',
        programHint: 'Prime Drama',
      },
    })
    expect(first.status).toBe('needs_selection')
    expect(first.decision.pendingTask?.phase).toBe('needs_selection')

    const selectedPendingTask = {
      ...first.decision.pendingTask!,
      phase: 'needs_confirmation' as const,
      allowedActions: ['confirm', 'reject', 'start_new_task', 'cancel_pending'] as const,
      collectedSlots: {
        ...first.decision.pendingTask!.collectedSlots,
        candidateId: {
          value: 'candidate-drama-5-subtitled',
          source: 'candidate_selection' as const,
          confidence: 0.95,
          rawText: 'foreground candidate card selection',
        },
      },
      missingSlots: ['confirmation'],
    }

    const result = await runtime.submit({
      userInput: '确认',
      channelId,
      date,
      pendingTask: selectedPendingTask,
      interpretation: {
        intent: 'insert',
        pendingAction: 'confirm',
        confidence: 1,
        source: 'test',
        slots: {},
      },
    })

    expect(result.status).toBe('executed')
    expect(result.decision.command).toMatchObject({
      intent: 'insert',
      candidateId: 'candidate-drama-5-subtitled',
    })
    const context = await dataGateway.loadContext({ userInput: '', channelId, date })
    expect(context.scheduleItems).toEqual([
      expect.objectContaining({
        programName: 'Prime Drama Episode 5 Subtitled Version',
      }),
    ])
  })

  it('does not continue TV sequence selections after history episode evidence changes', async () => {
    const historyEpisode4 = buildItem({
      id: 'history-drama-shared-code',
      programId: 'series-drama',
      programCode: 'DRAMA',
      programName: 'Prime Drama Episode 4',
      startTime: '2026-03-24T21:00:00+08:00',
      endTime: '2026-03-24T21:45:00+08:00',
      duration: 2700,
      programType: 'drama',
      sequence: 4,
    })
    const candidateDrama5Clean = buildCandidate({
      id: 'candidate-drama-5-clean',
      programId: 'series-drama',
      programCode: 'DRAMA',
      programName: 'Prime Drama Episode 5 Clean Version',
      instanceName: 'Prime Drama Episode 5 Clean Version',
      duration: 2700,
      programType: 'drama',
      sequence: 5,
    })
    const candidateDrama5Subtitled = buildCandidate({
      id: 'candidate-drama-5-subtitled',
      programId: 'series-drama',
      programCode: 'DRAMA',
      programName: 'Prime Drama Episode 5 Subtitled Version',
      instanceName: 'Prime Drama Episode 5 Subtitled Version',
      duration: 2700,
      programType: 'drama',
      sequence: 5,
    })
    const { dataGateway, runtime } = buildRuntime({
      playlistType: 'tv',
      candidates: [candidateDrama5Clean, candidateDrama5Subtitled],
      historySchedules: [{
        date: '2026-03-24',
        itemCount: 1,
        programTypes: { drama: 1 },
        items: [historyEpisode4],
      }],
    })

    const first = await submit(runtime, 'insert Prime Drama at 10:00', {
      intent: 'insert',
      confidence: 1,
      source: 'test',
      slots: {
        targetTime: '10:00:00',
        programHint: 'Prime Drama',
      },
    })

    expect(first.status).toBe('needs_selection')
    expect(first.decision.candidateSelection).toMatchObject({
      method: 'tv_sequence',
      source: 'history',
      expectedSequence: 5,
      candidateOptionIds: ['candidate-drama-5-clean', 'candidate-drama-5-subtitled'],
    })

    dataGateway.seed({
      channelId,
      date,
      playlistType: 'tv',
      scheduleItems: [],
      programCandidates: [candidateDrama5Clean, candidateDrama5Subtitled],
      broadcastReadiness: [],
      historySchedules: [{
        date: '2026-03-24',
        itemCount: 1,
        programTypes: { drama: 1 },
        items: [buildItem({
          ...historyEpisode4,
          programName: 'Prime Drama Episode 5',
          sequence: 5,
        })],
      }],
      layoutBounds: { start: '06:00:00', end: '23:59:59' },
    })

    const result = await runtime.submit({
      userInput: 'use the subtitled version',
      channelId,
      date,
      pendingTask: first.decision.pendingTask,
      interpretation: {
        intent: 'insert',
        pendingAction: 'select_candidate',
        confidence: 1,
        source: 'test',
        slots: {
          candidateId: 'candidate-drama-5-subtitled',
        },
      },
    })

    expect(result.status).toBe('needs_clarification')
    expect(result.executionResult).toBeUndefined()
    expect(result.decision.constraintReport?.issues[0]).toMatchObject({
      code: 'context_conflict',
      detail: {
        changedSourceKeys: ['history'],
        sourceChangeSummary: [
          expect.objectContaining({
            sourceKey: 'history',
            previousSamples: expect.arrayContaining([
              expect.stringContaining('Prime Drama Episode 4'),
            ]),
            currentSamples: expect.arrayContaining([
              expect.stringContaining('Prime Drama Episode 5'),
            ]),
          }),
        ],
      },
    })

    const context = await dataGateway.loadContext({ userInput: '', channelId, date })
    expect(context.scheduleItems).toHaveLength(0)
  })

  it('blocks an explicitly selected TV insert candidate that skips the previous-day episode baseline', async () => {
    const historyEpisode4 = buildItem({
      id: 'history-drama-4',
      programId: 'series-drama',
      programCode: 'DRAMA0004',
      programName: 'Prime Drama Episode 4',
      startTime: '2026-03-24T21:00:00+08:00',
      endTime: '2026-03-24T21:45:00+08:00',
      duration: 2700,
      programType: 'drama',
      sequence: 4,
    })
    const { dataGateway, runtime } = buildRuntime({
      playlistType: 'tv',
      candidates: [
        buildCandidate({
          id: 'candidate-drama-5',
          programId: 'series-drama',
          programCode: 'DRAMA0005',
          programName: 'Prime Drama Episode 5',
          instanceName: 'Prime Drama Episode 5',
          duration: 2700,
          programType: 'drama',
          sequence: 5,
        }),
        buildCandidate({
          id: 'candidate-drama-6',
          programId: 'series-drama',
          programCode: 'DRAMA0006',
          programName: 'Prime Drama Episode 6',
          instanceName: 'Prime Drama Episode 6',
          duration: 2700,
          programType: 'drama',
          sequence: 6,
        }),
      ],
      historySchedules: [{
        date: '2026-03-24',
        itemCount: 1,
        programTypes: { drama: 1 },
        items: [historyEpisode4],
      }],
    })

    const result = await submit(runtime, 'insert Prime Drama episode 6 at 10:00', {
      intent: 'insert',
      confidence: 1,
      source: 'test',
      slots: {
        targetTime: '10:00:00',
        programHint: 'Prime Drama',
        candidateId: 'candidate-drama-6',
      },
    })

    expect(result.status).toBe('blocked')
    expect(result.executionResult).toBeUndefined()
    expect(result.decision.candidateSelection).toMatchObject({
      method: 'tv_sequence',
      source: 'history',
      selectedCandidateId: 'candidate-drama-6',
    })
    expect(result.decision.constraintReport?.issues[0]).toMatchObject({
      code: 'sequence_violation',
      detail: {
        source: 'history',
        expectedSequence: 5,
        selectedSequence: 6,
      },
    })

    const context = await dataGateway.loadContext({ userInput: '', channelId, date })
    expect(context.scheduleItems).toHaveLength(0)
  })

  it('blocks an explicitly selected TV replacement candidate that skips the previous-day episode baseline', async () => {
    const historyEpisode4 = buildItem({
      id: 'history-drama-4',
      programId: 'series-drama',
      programCode: 'DRAMA0004',
      programName: 'Prime Drama Episode 4',
      startTime: '2026-03-24T21:00:00+08:00',
      endTime: '2026-03-24T21:45:00+08:00',
      duration: 2700,
      programType: 'drama',
      sequence: 4,
    })
    const { dataGateway, runtime } = buildRuntime({
      playlistType: 'tv',
      items: [buildItem({
        id: 'target-special-1000',
        programCode: 'SPECIAL1000',
        programName: 'Morning Special',
        startTime: '10:00:00',
        endTime: '10:30:00',
        duration: 1800,
        programType: 'news_magazine',
        sequence: 1,
      })],
      candidates: [
        buildCandidate({
          id: 'candidate-drama-5',
          programId: 'series-drama',
          programCode: 'DRAMA0005',
          programName: 'Prime Drama Episode 5',
          instanceName: 'Prime Drama Episode 5',
          duration: 2700,
          programType: 'drama',
          sequence: 5,
        }),
        buildCandidate({
          id: 'candidate-drama-6',
          programId: 'series-drama',
          programCode: 'DRAMA0006',
          programName: 'Prime Drama Episode 6',
          instanceName: 'Prime Drama Episode 6',
          duration: 2700,
          programType: 'drama',
          sequence: 6,
        }),
      ],
      historySchedules: [{
        date: '2026-03-24',
        itemCount: 1,
        programTypes: { drama: 1 },
        items: [historyEpisode4],
      }],
    })

    const result = await submit(runtime, 'replace Morning Special with Prime Drama episode 6', {
      intent: 'replace',
      confidence: 1,
      source: 'test',
      slots: {
        targetItemId: 'target-special-1000',
        targetTime: '10:00:00',
        replacementHint: 'Prime Drama',
        candidateId: 'candidate-drama-6',
      },
    })

    expect(result.status).toBe('blocked')
    expect(result.executionResult).toBeUndefined()
    expect(result.decision.candidateSelection).toMatchObject({
      method: 'tv_sequence',
      source: 'history',
      selectedCandidateId: 'candidate-drama-6',
    })
    expect(result.decision.constraintReport?.issues[0]).toMatchObject({
      code: 'sequence_violation',
      detail: {
        source: 'history',
        expectedSequence: 5,
        selectedSequence: 6,
      },
    })

    const context = await dataGateway.loadContext({ userInput: '', channelId, date })
    expect(context.scheduleItems).toHaveLength(1)
    expect(context.scheduleItems[0]?.programName).toBe('Morning Special')
  })

  it('preserves an explicit TV insert candidate across clarification and still blocks sequence skips', async () => {
    const historyEpisode4 = buildItem({
      id: 'history-drama-4',
      programId: 'series-drama',
      programCode: 'DRAMA0004',
      programName: 'Prime Drama Episode 4',
      startTime: '2026-03-24T21:00:00+08:00',
      endTime: '2026-03-24T21:45:00+08:00',
      duration: 2700,
      programType: 'drama',
      sequence: 4,
    })
    const { dataGateway, runtime } = buildRuntime({
      playlistType: 'tv',
      candidates: [
        buildCandidate({
          id: 'candidate-drama-5',
          programId: 'series-drama',
          programCode: 'DRAMA0005',
          programName: 'Prime Drama Episode 5',
          instanceName: 'Prime Drama Episode 5',
          duration: 2700,
          programType: 'drama',
          sequence: 5,
        }),
        buildCandidate({
          id: 'candidate-drama-6',
          programId: 'series-drama',
          programCode: 'DRAMA0006',
          programName: 'Prime Drama Episode 6',
          instanceName: 'Prime Drama Episode 6',
          duration: 2700,
          programType: 'drama',
          sequence: 6,
        }),
      ],
      historySchedules: [{
        date: '2026-03-24',
        itemCount: 1,
        programTypes: { drama: 1 },
        items: [historyEpisode4],
      }],
    })

    const first = await submit(runtime, 'insert the chosen Prime Drama episode', {
      intent: 'insert',
      confidence: 1,
      source: 'test',
      slots: {
        programHint: 'Prime Drama',
        candidateId: 'candidate-drama-6',
      },
    })

    expect(first.status).toBe('needs_clarification')
    expect(first.decision.pendingTask?.collectedSlots.candidateId).toMatchObject({
      value: 'candidate-drama-6',
    })

    const result = await runtime.submit({
      userInput: 'put it at 10:00',
      channelId,
      date,
      pendingTask: first.decision.pendingTask,
      interpretation: {
        intent: 'insert',
        pendingAction: 'continue_pending',
        confidence: 1,
        source: 'test',
        slots: {
          targetTime: '10:00:00',
        },
      },
    })

    expect(result.status).toBe('blocked')
    expect(result.executionResult).toBeUndefined()
    expect(result.decision.candidateSelection).toMatchObject({
      method: 'tv_sequence',
      source: 'history',
      selectedCandidateId: 'candidate-drama-6',
    })
    expect(result.decision.constraintReport?.issues[0]).toMatchObject({
      code: 'sequence_violation',
      detail: {
        expectedSequence: 5,
        selectedSequence: 6,
      },
    })

    const context = await dataGateway.loadContext({ userInput: '', channelId, date })
    expect(context.scheduleItems).toHaveLength(0)
  })

  it('preserves an explicit TV replacement candidate across clarification and still blocks sequence skips', async () => {
    const historyEpisode4 = buildItem({
      id: 'history-drama-4',
      programId: 'series-drama',
      programCode: 'DRAMA0004',
      programName: 'Prime Drama Episode 4',
      startTime: '2026-03-24T21:00:00+08:00',
      endTime: '2026-03-24T21:45:00+08:00',
      duration: 2700,
      programType: 'drama',
      sequence: 4,
    })
    const { dataGateway, runtime } = buildRuntime({
      playlistType: 'tv',
      items: [buildItem({
        id: 'target-special-1000',
        programCode: 'SPECIAL1000',
        programName: 'Morning Special',
        startTime: '10:00:00',
        endTime: '10:30:00',
        duration: 1800,
        programType: 'news_magazine',
        sequence: 1,
      })],
      candidates: [
        buildCandidate({
          id: 'candidate-drama-5',
          programId: 'series-drama',
          programCode: 'DRAMA0005',
          programName: 'Prime Drama Episode 5',
          instanceName: 'Prime Drama Episode 5',
          duration: 2700,
          programType: 'drama',
          sequence: 5,
        }),
        buildCandidate({
          id: 'candidate-drama-6',
          programId: 'series-drama',
          programCode: 'DRAMA0006',
          programName: 'Prime Drama Episode 6',
          instanceName: 'Prime Drama Episode 6',
          duration: 2700,
          programType: 'drama',
          sequence: 6,
        }),
      ],
      historySchedules: [{
        date: '2026-03-24',
        itemCount: 1,
        programTypes: { drama: 1 },
        items: [historyEpisode4],
      }],
    })

    const first = await submit(runtime, 'replace with the chosen Prime Drama episode', {
      intent: 'replace',
      confidence: 1,
      source: 'test',
      slots: {
        replacementHint: 'Prime Drama',
        candidateId: 'candidate-drama-6',
      },
    })

    expect(first.status).toBe('needs_clarification')
    expect(first.decision.pendingTask?.collectedSlots.candidateId).toMatchObject({
      value: 'candidate-drama-6',
    })

    const result = await runtime.submit({
      userInput: 'replace Morning Special',
      channelId,
      date,
      pendingTask: first.decision.pendingTask,
      interpretation: {
        intent: 'replace',
        pendingAction: 'continue_pending',
        confidence: 1,
        source: 'test',
        slots: {
          targetItemId: 'target-special-1000',
        },
      },
    })

    expect(result.status).toBe('blocked')
    expect(result.executionResult).toBeUndefined()
    expect(result.decision.candidateSelection).toMatchObject({
      method: 'tv_sequence',
      source: 'history',
      selectedCandidateId: 'candidate-drama-6',
    })
    expect(result.decision.constraintReport?.issues[0]).toMatchObject({
      code: 'sequence_violation',
      detail: {
        expectedSequence: 5,
        selectedSequence: 6,
      },
    })

    const context = await dataGateway.loadContext({ userInput: '', channelId, date })
    expect(context.scheduleItems).toHaveLength(1)
    expect(context.scheduleItems[0]?.programName).toBe('Morning Special')
  })

  it('keeps insert clarifications recoverable when candidate source evidence changes before the programme is fixed', async () => {
    const initialCandidate = buildCandidate({
      id: 'candidate-original',
      programCode: 'ORIGINAL1000',
      programName: 'Original Candidate',
    })
    const { dataGateway, runtime } = buildRuntime({
      playlistType: 'tv',
      candidates: [initialCandidate],
    })

    const first = await submit(runtime, 'insert Original Candidate', {
      intent: 'insert',
      confidence: 1,
      source: 'test',
      slots: {
        programHint: 'Original Candidate',
        candidateId: 'candidate-original',
      },
    })

    expect(first.status).toBe('needs_clarification')
    expect(first.decision.pendingTask?.contextFingerprint).toEqual(expect.stringMatching(/^agent_context:/))
    expect(first.decision.pendingTask?.contextSources).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceKey: 'candidates',
        recordCount: 1,
      }),
    ]))

    dataGateway.seed({
      channelId,
      date,
      playlistType: 'tv',
      scheduleItems: [],
      programCandidates: [buildCandidate({
        id: 'candidate-replacement',
        programCode: 'REPLACEMENT1000',
        programName: 'Replacement Candidate',
      })],
      broadcastReadiness: [],
      historySchedules: [],
      layoutBounds: { start: '06:00:00', end: '23:59:59' },
    })

    const result = await runtime.submit({
      userInput: 'put it at 10:00',
      channelId,
      date,
      pendingTask: first.decision.pendingTask,
      interpretation: {
        intent: 'insert',
        pendingAction: 'continue_pending',
        confidence: 1,
        source: 'test',
        slots: {
          targetTime: '10:00:00',
        },
      },
    })

    expect(result.status).toBe('needs_clarification')
    expect(result.executionResult).toBeUndefined()
    expect(result.explanation).toContain('保留这次插入任务')
    expect(result.decision.constraintReport?.issues[0]).toMatchObject({
      code: 'program_not_found',
      detail: expect.objectContaining({
        searchedKeyword: 'Original Candidate',
      }),
    })

    const context = await dataGateway.loadContext({ userInput: '', channelId, date })
    expect(context.scheduleItems).toHaveLength(0)
  })

  it('does not continue insert clarifications after current playlist evidence changes', async () => {
    const { dataGateway, runtime } = buildRuntime({
      playlistType: 'tv',
      candidates: [buildCandidate()],
    })

    const first = await submit(runtime, 'insert at 10:00', {
      intent: 'insert',
      confidence: 1,
      source: 'test',
      slots: {
        targetTime: '10:00:00',
      },
    })

    expect(first.status).toBe('needs_clarification')
    expect(first.decision.pendingTask?.contextFingerprint).toEqual(expect.stringMatching(/^agent_context:/))
    expect(first.decision.pendingTask?.contextSources).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceKey: 'today',
        recordCount: 0,
      }),
    ]))

    dataGateway.seed({
      channelId,
      date,
      playlistType: 'tv',
      scheduleItems: [buildItem({
        id: 'external-1100',
        programCode: 'EXTERNAL1100',
        programName: 'External Update',
        startTime: '11:00:00',
        endTime: '11:30:00',
      })],
      programCandidates: [buildCandidate()],
      broadcastReadiness: [],
      historySchedules: [],
      layoutBounds: { start: '06:00:00', end: '23:59:59' },
    })

    const result = await runtime.submit({
      userInput: 'Replacement News',
      channelId,
      date,
      pendingTask: first.decision.pendingTask,
      interpretation: {
        intent: 'insert',
        pendingAction: 'continue_pending',
        confidence: 1,
        source: 'test',
        slots: {
          programHint: 'Replacement News',
        },
      },
    })

    expect(result.status).toBe('needs_clarification')
    expect(result.executionResult).toBeUndefined()
    expect(result.explanation).toContain('pending task context changed')
    expect(result.decision.constraintReport?.issues[0]).toMatchObject({
      code: 'context_conflict',
      detail: {
        changedSourceKeys: ['today'],
      },
    })

    const context = await dataGateway.loadContext({ userInput: '', channelId, date })
    expect(context.scheduleItems.map((item) => item.id)).toEqual(['external-1100'])
  })

  it('does not continue replace clarifications after current playlist evidence changes', async () => {
    const selectedCandidate = buildCandidate({
      id: 'candidate-selected',
      programCode: 'SELECTED1000',
      programName: 'Selected Candidate',
    })
    const { dataGateway, runtime } = buildRuntime({
      playlistType: 'tv',
      items: [],
      candidates: [selectedCandidate],
    })

    const first = await submit(runtime, 'replace with Selected Candidate', {
      intent: 'replace',
      confidence: 1,
      source: 'test',
      slots: {
        replacementHint: 'Selected Candidate',
        candidateId: 'candidate-selected',
      },
    })

    expect(first.status).toBe('needs_clarification')
    expect(first.decision.pendingTask?.contextFingerprint).toEqual(expect.stringMatching(/^agent_context:/))
    expect(first.decision.pendingTask?.contextSources).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceKey: 'today',
        recordCount: 0,
      }),
    ]))

    dataGateway.seed({
      channelId,
      date,
      playlistType: 'tv',
      scheduleItems: [buildItem({
        id: 'new-target-1000',
        programCode: 'TARGET1000',
        programName: 'New Target',
        startTime: '10:00:00',
        endTime: '10:30:00',
        duration: 1800,
      })],
      programCandidates: [selectedCandidate],
      broadcastReadiness: [],
      historySchedules: [],
      layoutBounds: { start: '06:00:00', end: '23:59:59' },
    })

    const result = await runtime.submit({
      userInput: 'replace New Target',
      channelId,
      date,
      pendingTask: first.decision.pendingTask,
      interpretation: {
        intent: 'replace',
        pendingAction: 'continue_pending',
        confidence: 1,
        source: 'test',
        slots: {
          targetItemId: 'new-target-1000',
        },
      },
    })

    expect(result.status).toBe('needs_clarification')
    expect(result.executionResult).toBeUndefined()
    expect(result.explanation).toContain('pending task context changed')
    expect(result.decision.constraintReport?.issues[0]).toMatchObject({
      code: 'context_conflict',
      detail: {
        changedSourceKeys: ['today'],
      },
    })

    const context = await dataGateway.loadContext({ userInput: '', channelId, date })
    expect(context.scheduleItems).toHaveLength(1)
    expect(context.scheduleItems[0]?.programName).toBe('New Target')
  })

  it('continues pending replace commands after target programme clarification', async () => {
    const { dataGateway, runtime } = buildRuntime({
      playlistType: 'tv',
      items: [buildItem()],
      candidates: [buildCandidate()],
    })

    const first = await submit(runtime, 'replace with Replacement News', {
      intent: 'replace',
      confidence: 1,
      source: 'test',
      slots: {
        replacementHint: 'Replacement News',
      },
    })

    expect(first.status).toBe('needs_clarification')
    expect(first.executionResult).toBeUndefined()
    expect(first.decision.pendingTask).toMatchObject({
      intent: 'replace',
      missingSlots: ['targetItemId'],
      collectedSlots: {
        replacementHint: expect.objectContaining({ value: 'Replacement News' }),
      },
      contextFingerprint: expect.any(String),
    })

    const result = await runtime.submit({
      userInput: 'replace Morning News',
      channelId,
      date,
      pendingTask: first.decision.pendingTask,
      interpretation: {
        intent: 'replace',
        pendingAction: 'continue_pending',
        confidence: 1,
        source: 'test',
        slots: {
          targetProgramName: 'Morning News',
        },
      },
    })

    expect(result.status).toBe('executed')
    expect(result.decision.command).toMatchObject({
      intent: 'replace',
      itemId: 'item-0900',
      candidateId: 'candidate-news',
    })

    const context = await dataGateway.loadContext({ userInput: '', channelId, date })
    expect(context.scheduleItems[0]).toMatchObject({
      id: 'item-0900',
      programName: 'Replacement News',
    })
  })

  it('keeps replace clarifications recoverable when candidate evidence changes before the replacement is fixed', async () => {
    const originalCandidate = buildCandidate({
      id: 'candidate-original',
      programCode: 'ORIGINAL1000',
      programName: 'Original Candidate',
    })
    const { dataGateway, runtime } = buildRuntime({
      playlistType: 'tv',
      items: [buildItem()],
      candidates: [originalCandidate],
    })

    const first = await submit(runtime, 'replace with Original Candidate', {
      intent: 'replace',
      confidence: 1,
      source: 'test',
      slots: {
        replacementHint: 'Original Candidate',
        candidateId: 'candidate-original',
      },
    })

    expect(first.status).toBe('needs_clarification')
    expect(first.decision.pendingTask?.contextSources).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceKey: 'candidates',
        recordCount: 1,
      }),
    ]))

    dataGateway.seed({
      channelId,
      date,
      playlistType: 'tv',
      scheduleItems: [buildItem()],
      programCandidates: [buildCandidate({
        id: 'candidate-replacement',
        programCode: 'REPLACEMENT1000',
        programName: 'Replacement Candidate',
      })],
      broadcastReadiness: [],
      historySchedules: [],
      layoutBounds: { start: '06:00:00', end: '23:59:59' },
    })

    const result = await runtime.submit({
      userInput: 'replace Morning News',
      channelId,
      date,
      pendingTask: first.decision.pendingTask,
      interpretation: {
        intent: 'replace',
        pendingAction: 'continue_pending',
        confidence: 1,
        source: 'test',
        slots: {
          targetProgramName: 'Morning News',
        },
      },
    })

    expect(result.status).toBe('needs_clarification')
    expect(result.executionResult).toBeUndefined()
    expect(result.decision.constraintReport?.issues[0]).toMatchObject({
      code: 'program_not_found',
      detail: expect.objectContaining({
        searchedKeyword: 'Original Candidate',
      }),
    })

    const context = await dataGateway.loadContext({ userInput: '', channelId, date })
    expect(context.scheduleItems[0]?.programName).toBe('Morning News')
  })

  it('returns rotation insert commands as recommendations before committing candidates', async () => {
    const { dataGateway, runtime } = buildRuntime({
      playlistType: 'rotation',
      rotationStrategy: 'rating',
      candidates: [
        buildCandidate({ id: 'candidate-low', estimatedRating: 1.1 }),
        buildCandidate({ id: 'candidate-high', programCode: 'NEWS1001', estimatedRating: 3.8 }),
      ],
    })

    const result = await submit(runtime, 'insert Replacement News at 10:00', {
      intent: 'insert',
      confidence: 1,
      source: 'test',
      slots: {
        targetTime: '10:00:00',
        programHint: 'Replacement News',
      },
    })

    expect(result.status).toBe('needs_selection')
    expect(result.decision.pendingTask).toMatchObject({
      intent: 'insert',
      phase: 'needs_selection',
      missingSlots: ['candidateId'],
      recommendations: [
        expect.objectContaining({ candidateId: 'candidate-low' }),
        expect.objectContaining({ candidateId: 'candidate-high' }),
      ],
    })
    expect(result.decision.candidateSelection).toMatchObject({
      method: 'candidate_judge_llm',
      source: 'none',
      candidateOptionIds: ['candidate-low', 'candidate-high'],
    })
    expect(result.executionResult).toBeUndefined()

    const context = await dataGateway.loadContext({ userInput: '', channelId, date })
    expect(context.scheduleItems).toHaveLength(0)
  })

  it('does not let pending confirmation switch away from the planned candidate', async () => {
    const { dataGateway, runtime } = buildRuntime({
      playlistType: 'rotation',
      rotationStrategy: 'rating',
      candidates: [
        buildCandidate({ id: 'candidate-low', estimatedRating: 1.1 }),
        buildCandidate({ id: 'candidate-high', programCode: 'NEWS1001', estimatedRating: 3.8 }),
      ],
    })

    const first = await submit(runtime, 'insert Replacement News at 10:00', {
      intent: 'insert',
      confidence: 1,
      source: 'test',
      slots: {
        targetTime: '10:00:00',
        programHint: 'Replacement News',
      },
    })

    expect(first.status).toBe('needs_selection')
    expect(first.decision.pendingTask).toMatchObject({
      intent: 'insert',
      phase: 'needs_selection',
      recommendations: [
        expect.objectContaining({ candidateId: 'candidate-low' }),
        expect.objectContaining({ candidateId: 'candidate-high' }),
      ],
    })

    const selected = await runtime.submit({
      userInput: 'use the higher-rated one',
      channelId,
      date,
      pendingTask: first.decision.pendingTask,
      interpretation: {
        intent: 'insert',
        pendingAction: 'select_candidate',
        confidence: 1,
        source: 'test',
        slots: {
          candidateId: 'candidate-high',
        },
      },
    })

    expect(selected.status).toBe('needs_confirmation')
    expect(selected.decision.pendingTask).toMatchObject({
      intent: 'insert',
      phase: 'needs_confirmation',
      collectedSlots: {
        candidateId: {
          value: 'candidate-high',
        },
      },
    })

    const differentRecommendedCandidate = await runtime.submit({
      userInput: 'confirm the lower-rated one instead',
      channelId,
      date,
      pendingTask: selected.decision.pendingTask,
      interpretation: {
        intent: 'insert',
        pendingAction: 'confirm',
        confidence: 1,
        source: 'test',
        slots: {
          candidateId: 'candidate-low',
        },
      },
    })

    expect(differentRecommendedCandidate.status).toBe('needs_confirmation')
    expect(differentRecommendedCandidate.executionResult).toBeUndefined()
    expect(differentRecommendedCandidate.decision.constraintReport?.issues[0]).toMatchObject({
      code: 'program_ambiguous',
      detail: {
        candidateId: 'candidate-low',
        allowedCandidateIds: ['candidate-high'],
        plannedCandidateId: 'candidate-high',
      },
    })

    const invalid = await runtime.submit({
      userInput: 'confirm candidate outsider',
      channelId,
      date,
      pendingTask: selected.decision.pendingTask,
      interpretation: {
        intent: 'insert',
        pendingAction: 'confirm',
        confidence: 1,
        source: 'test',
        slots: {
          candidateId: 'candidate-outsider',
        },
      },
    })

    expect(invalid.status).toBe('needs_confirmation')
    expect(invalid.executionResult).toBeUndefined()
    expect(invalid.decision.constraintReport?.issues[0]).toMatchObject({
      code: 'program_ambiguous',
      detail: {
        candidateId: 'candidate-outsider',
        allowedCandidateIds: ['candidate-high'],
        plannedCandidateId: 'candidate-high',
      },
    })

    const context = await dataGateway.loadContext({ userInput: '', channelId, date })
    expect(context.scheduleItems).toHaveLength(0)
  })

  it('rejects pending rotation insert confirmations without committing the recommendation', async () => {
    const { dataGateway, runtime } = buildRuntime({
      playlistType: 'rotation',
      rotationStrategy: 'rating',
      candidates: [buildCandidate()],
    })

    const first = await submit(runtime, 'insert Replacement News at 10:00', {
      intent: 'insert',
      confidence: 1,
      source: 'test',
      slots: {
        targetTime: '10:00:00',
        programHint: 'Replacement News',
      },
    })

    expect(first.status).toBe('needs_confirmation')

    const rejected = await runtime.submit({
      userInput: 'do not use it',
      channelId,
      date,
      pendingTask: first.decision.pendingTask,
      interpretation: {
        intent: 'insert',
        pendingAction: 'reject',
        confidence: 1,
        source: 'test',
      },
    })

    expect(rejected.status).toBe('needs_clarification')
    expect(rejected.decision.pendingTask).toBeUndefined()
    expect(rejected.executionResult).toBeUndefined()

    const context = await dataGateway.loadContext({ userInput: '', channelId, date })
    expect(context.scheduleItems).toHaveLength(0)
  })

  it('executes a confirmed rotation insert while preserving its confirmation-gated policy mode', async () => {
    const { dataGateway, runtime } = buildRuntime({
      playlistType: 'rotation',
      rotationStrategy: 'rating',
      candidates: [buildCandidate()],
    })

    const first = await submit(runtime, 'insert Replacement News at 10:00', {
      intent: 'insert',
      confidence: 1,
      source: 'test',
      slots: {
        targetTime: '10:00:00',
        programHint: 'Replacement News',
      },
    })

    expect(first.status).toBe('needs_confirmation')

    const result = await runtime.submit({
      userInput: 'confirm',
      channelId,
      date,
      pendingTask: first.decision.pendingTask,
      interpretation: {
        intent: 'insert',
        pendingAction: 'confirm',
        confidence: 1,
        source: 'test',
      },
    })

    expect(result.status).toBe('executed')
    expect(result.executionResult).toMatchObject({
      committed: true,
      affectedItemIds: [expect.stringContaining('agent_insert_candidate_news')],
    })
    expect(result.decision.auditSummary).toMatchObject({
      playlistPolicy: {
        playlistType: 'rotation',
        rotationStrategy: 'rating',
        commandIntent: 'insert',
        executionMode: 'confirm_before_commit',
        policyAction: 'execute',
        requiresConfirmation: false,
        reason: expect.stringContaining('confirmed'),
      },
      operation: {
        committed: true,
        commandIntent: 'insert',
      },
    })
    expect(result.decision.auditSummary?.keyPoints).toEqual(
      expect.arrayContaining([
        expect.stringContaining('播单策略：类型=rotation, 策略=rating, 命令=insert, 执行模式=confirm_before_commit, 动作=execute, 需确认=否'),
        expect.stringContaining('写入状态：已写入'),
      ]),
    )

    const context = await dataGateway.loadContext({ userInput: '', channelId, date })
    expect(context.scheduleItems).toHaveLength(1)
    expect(context.scheduleItems[0]).toMatchObject({
      programName: 'Replacement News',
      startTime: '2026-03-25T10:00:00+08:00',
    })
  })

  it('starts a new structured task instead of continuing an existing pending task', async () => {
    const { dataGateway, runtime } = buildRuntime({
      playlistType: 'rotation',
      rotationStrategy: 'content_match',
      candidates: [buildCandidate()],
    })

    const first = await submit(runtime, 'insert Replacement News at 10:00', {
      intent: 'insert',
      confidence: 1,
      source: 'test',
      slots: {
        targetTime: '10:00:00',
        programHint: 'Replacement News',
      },
    })

    expect(first.status).toBe('needs_confirmation')

    const result = await runtime.submit({
      userInput: 'find Replacement News candidates',
      channelId,
      date,
      pendingTask: first.decision.pendingTask,
      interpretation: {
        intent: 'query',
        pendingAction: 'start_new_task',
        confidence: 1,
        source: 'test',
        queryKind: 'candidate_lookup',
        keyword: 'Replacement News',
      },
    })

    expect(result.status).toBe('executed')
    expect(result.decision.pendingTask).toBeUndefined()
    expect(result.decision.queryResult).toMatchObject({
      kind: 'candidate_lookup',
      totalCount: 1,
      candidates: [{ id: 'candidate-news' }],
    })
    expect(result.trace.some((step) => step.label.includes('starts a new scheduling command'))).toBe(true)

    const context = await dataGateway.loadContext({ userInput: '', channelId, date })
    expect(context.scheduleItems).toHaveLength(0)
  })

  it('cancels a pending task without letting stale gates or confirmation commit it', async () => {
    const { dataGateway, runtime } = buildRuntime({
      playlistType: 'rotation',
      rotationStrategy: 'content_match',
      candidates: [buildCandidate()],
    })

    const first = await submit(runtime, 'insert Replacement News at 10:00', {
      intent: 'insert',
      confidence: 1,
      source: 'test',
      slots: {
        targetTime: '10:00:00',
        programHint: 'Replacement News',
      },
    })

    const stalePendingTask = {
      ...first.decision.pendingTask!,
      expiresAt: '2020-01-01T00:00:00.000Z',
    }

    const result = await runtime.submit({
      userInput: 'cancel that',
      channelId,
      date,
      pendingTask: stalePendingTask,
      interpretation: {
        intent: 'insert',
        pendingAction: 'cancel_pending',
        confidence: 1,
        source: 'test',
      },
    })

    expect(result.status).toBe('needs_clarification')
    expect(result.decision.pendingTask).toBeUndefined()
    expect(result.executionResult).toBeUndefined()
    expect(result.explanation).toContain('cancelled')
    expect(result.explanation).not.toContain('expired')

    const context = await dataGateway.loadContext({ userInput: '', channelId, date })
    expect(context.scheduleItems).toHaveLength(0)
  })

  it('does not continue expired pending confirmations into playlist writes', async () => {
    const { dataGateway, runtime } = buildRuntime({
      playlistType: 'rotation',
      rotationStrategy: 'content_match',
      candidates: [buildCandidate()],
    })

    const first = await submit(runtime, 'insert Replacement News at 10:00', {
      intent: 'insert',
      confidence: 1,
      source: 'test',
      slots: {
        targetTime: '10:00:00',
        programHint: 'Replacement News',
      },
    })

    const expiredPendingTask = {
      ...first.decision.pendingTask!,
      expiresAt: '2020-01-01T00:00:00.000Z',
    }

    const result = await runtime.submit({
      userInput: 'confirm',
      channelId,
      date,
      pendingTask: expiredPendingTask,
      interpretation: {
        intent: 'insert',
        pendingAction: 'confirm',
        confidence: 1,
        source: 'test',
      },
    })

    expect(result.status).toBe('needs_clarification')
    expect(result.decision.pendingTask).toBeUndefined()
    expect(result.executionResult).toBeUndefined()
    expect(result.decision.constraintReport?.issues[0]).toMatchObject({
      severity: 'info',
      detail: {
        pendingTaskId: expiredPendingTask.id,
        expiresAt: '2020-01-01T00:00:00.000Z',
      },
    })
    expect(result.explanation).toContain('pending task expired')

    const context = await dataGateway.loadContext({ userInput: '', channelId, date })
    expect(context.scheduleItems).toHaveLength(0)
  })

  it('does not continue pending confirmations after the max attempt gate is reached', async () => {
    const { dataGateway, runtime } = buildRuntime({
      playlistType: 'rotation',
      rotationStrategy: 'content_match',
      candidates: [buildCandidate()],
    })

    const first = await submit(runtime, 'insert Replacement News at 10:00', {
      intent: 'insert',
      confidence: 1,
      source: 'test',
      slots: {
        targetTime: '10:00:00',
        programHint: 'Replacement News',
      },
    })

    const exhaustedPendingTask = {
      ...first.decision.pendingTask!,
      attemptCount: first.decision.pendingTask!.maxAttempts,
    }

    const result = await runtime.submit({
      userInput: 'confirm',
      channelId,
      date,
      pendingTask: exhaustedPendingTask,
      interpretation: {
        intent: 'insert',
        pendingAction: 'confirm',
        confidence: 1,
        source: 'test',
      },
    })

    expect(result.status).toBe('needs_clarification')
    expect(result.executionResult).toBeUndefined()
    expect(result.decision.constraintReport?.issues[0]).toMatchObject({
      severity: 'info',
      detail: {
        attemptCount: exhaustedPendingTask.attemptCount,
        maxAttempts: exhaustedPendingTask.maxAttempts,
      },
    })
    expect(result.explanation).toContain('pending task reached max attempts')

    const context = await dataGateway.loadContext({ userInput: '', channelId, date })
    expect(context.scheduleItems).toHaveLength(0)
  })

  it('does not commit pending rotation insert confirmations after the playlist context changes', async () => {
    const { dataGateway, runtime } = buildRuntime({
      playlistType: 'rotation',
      rotationStrategy: 'content_match',
      candidates: [buildCandidate()],
    })

    const first = await submit(runtime, 'insert Replacement News at 10:00', {
      intent: 'insert',
      confidence: 1,
      source: 'test',
      slots: {
        targetTime: '10:00:00',
        programHint: 'Replacement News',
      },
    })

    expect(first.status).toBe('needs_confirmation')
    expect(first.decision.pendingTask?.contextFingerprint).toEqual(expect.stringMatching(/^agent_context:/))
    expect(first.decision.pendingTask?.contextSources).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceKey: 'candidates',
        digest: expect.any(String),
        recordCount: 1,
      }),
    ]))

    await dataGateway.commitScheduleItems({
      channelId,
      date,
      items: [buildItem({
        id: 'external-1200',
        startTime: '12:00:00',
        endTime: '12:30:00',
      })],
      reason: 'external:user_edit',
    })

    const result = await runtime.submit({
      userInput: 'confirm',
      channelId,
      date,
      pendingTask: first.decision.pendingTask,
      interpretation: {
        intent: 'insert',
        pendingAction: 'confirm',
        confidence: 1,
        source: 'test',
      },
    })

    expect(result.status).toBe('needs_clarification')
    expect(result.executionResult).toBeUndefined()
    expect(result.explanation).toContain('pending task context changed')
    expect(result.decision.constraintReport?.issues[0]?.detail).toMatchObject({
      pendingTaskId: first.decision.pendingTask?.id,
      expectedContextFingerprint: first.decision.pendingTask?.contextFingerprint,
    })

    const context = await dataGateway.loadContext({ userInput: '', channelId, date })
    expect(context.scheduleItems).toHaveLength(1)
    expect(context.scheduleItems[0]?.id).toBe('external-1200')
  })

  it('does not commit pending rotation insert confirmations after readiness evidence changes', async () => {
    const readyCandidate = buildCandidate()
    const { dataGateway, runtime } = buildRuntime({
      playlistType: 'rotation',
      rotationStrategy: 'content_match',
      items: [buildItem()],
      candidates: [readyCandidate],
      broadcastReadiness: [{
        candidateId: readyCandidate.id,
        materialStatus: 'ready',
        rightsStatus: 'ready',
        source: 'rights-system',
        updatedAt: '2026-03-25T08:00:00+08:00',
      }],
    })

    const first = await submit(runtime, 'insert Replacement News at 10:00', {
      intent: 'insert',
      confidence: 1,
      source: 'test',
      slots: {
        targetTime: '10:00:00',
        programHint: 'Replacement News',
      },
    })

    expect(first.status).toBe('needs_confirmation')
    expect(first.decision.pendingTask?.contextFingerprint).toEqual(expect.stringMatching(/^agent_context:/))

    dataGateway.seed({
      channelId,
      date,
      playlistType: 'rotation',
      rotationStrategy: 'content_match',
      scheduleItems: [buildItem()],
      programCandidates: [readyCandidate],
      broadcastReadiness: [{
        candidateId: readyCandidate.id,
        materialStatus: 'ready',
        rightsStatus: 'blocked',
        source: 'rights-system',
        updatedAt: '2026-03-25T09:00:00+08:00',
      }],
      historySchedules: [],
      layoutBounds: { start: '00:00:00', end: '23:59:59' },
    })

    const result = await runtime.submit({
      userInput: 'confirm',
      channelId,
      date,
      pendingTask: first.decision.pendingTask,
      interpretation: {
        intent: 'insert',
        pendingAction: 'confirm',
        confidence: 1,
        source: 'test',
      },
    })

    expect(result.status).toBe('needs_clarification')
    expect(result.executionResult).toBeUndefined()
    expect(result.explanation).toContain('pending task context changed')
    expect(result.decision.constraintReport?.issues[0]).toMatchObject({
      code: 'context_conflict',
      detail: {
        pendingTaskId: first.decision.pendingTask?.id,
        expectedContextFingerprint: first.decision.pendingTask?.contextFingerprint,
        currentContextFingerprint: expect.stringMatching(/^agent_context:/),
        changedSourceKeys: ['readiness'],
        sourceChanges: [
          expect.objectContaining({
            sourceKey: 'readiness',
            previous: expect.objectContaining({
              sourceKey: 'readiness',
              digest: first.decision.pendingTask?.contextSources?.find((source) => source.sourceKey === 'readiness')?.digest,
            }),
            current: expect.objectContaining({
              sourceKey: 'readiness',
              digest: expect.any(String),
            }),
          }),
        ],
      },
    })

    const context = await dataGateway.loadContext({ userInput: '', channelId, date })
    expect(context.scheduleItems).toHaveLength(1)
    expect(context.scheduleItems[0]?.id).toBe('item-0900')
  })

  it('does not commit pending rotation insert confirmations after constraint evidence changes', async () => {
    const candidate = buildCandidate()
    const { dataGateway, runtime } = buildRuntime({
      playlistType: 'rotation',
      rotationStrategy: 'content_match',
      candidates: [candidate],
    })

    const first = await submit(runtime, 'insert Replacement News at 10:00', {
      intent: 'insert',
      confidence: 1,
      source: 'test',
      slots: {
        targetTime: '10:00:00',
        programHint: 'Replacement News',
      },
    })

    expect(first.status).toBe('needs_confirmation')
    expect(first.decision.pendingTask?.contextFingerprint).toEqual(expect.stringMatching(/^agent_context:/))
    expect(first.decision.pendingTask?.contextSources).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceKey: 'constraints',
        digest: expect.any(String),
      }),
    ]))

    dataGateway.seed({
      channelId,
      date,
      playlistType: 'rotation',
      rotationStrategy: 'content_match',
      scheduleItems: [],
      programCandidates: [candidate],
      broadcastReadiness: [],
      historySchedules: [],
      layoutBounds: { start: '06:00:00', end: '23:59:59' },
      blockedTimeRanges: [{ start: '10:00:00', end: '10:30:00' }],
    })

    const result = await runtime.submit({
      userInput: 'confirm',
      channelId,
      date,
      pendingTask: first.decision.pendingTask,
      interpretation: {
        intent: 'insert',
        pendingAction: 'confirm',
        confidence: 1,
        source: 'test',
      },
    })

    expect(result.status).toBe('needs_clarification')
    expect(result.executionResult).toBeUndefined()
    expect(result.explanation).toContain('pending task context changed')
    expect(result.decision.constraintReport?.issues[0]).toMatchObject({
      code: 'context_conflict',
      detail: {
        pendingTaskId: first.decision.pendingTask?.id,
        expectedContextFingerprint: first.decision.pendingTask?.contextFingerprint,
        currentContextFingerprint: expect.stringMatching(/^agent_context:/),
        changedSourceKeys: ['constraints'],
        sourceChangeSummary: [
          expect.objectContaining({
            sourceKey: 'constraints',
            currentSamples: expect.arrayContaining([
              expect.stringContaining('blocked=10:00:00-10:30:00'),
            ]),
          }),
        ],
      },
    })

    const context = await dataGateway.loadContext({ userInput: '', channelId, date })
    expect(context.scheduleItems).toHaveLength(0)
  })

  it('blocks infeasible insert commands with a professional blocker reason', async () => {
    const { dataGateway, runtime } = buildRuntime({
      playlistType: 'tv',
      items: [buildItem({
        id: 'item-1000',
        startTime: '10:00:00',
        endTime: '10:30:00',
      })],
      candidates: [buildCandidate()],
    })

    const result = await submit(runtime, 'insert Replacement News at 10:00', {
      intent: 'insert',
      confidence: 1,
      source: 'test',
      slots: {
        targetTime: '10:00:00',
        programHint: 'Replacement News',
      },
    })

    expect(result.status).toBe('blocked')
    expect(result.decision.auditSummary).toMatchObject({
      outcome: 'blocked',
      professionalConclusion: expect.stringContaining('阻断级编排风险'),
      blockerReason: expect.stringContaining('目标位置已有节目占用'),
      constraintIssueCodes: ['time_overlap'],
    })
    expect(result.decision.auditSummary?.blockers).toEqual(
      expect.arrayContaining([
        expect.stringContaining('目标位置已有节目占用'),
      ]),
    )

    const context = await dataGateway.loadContext({ userInput: '', channelId, date })
    expect(context.scheduleItems).toHaveLength(1)
    expect(context.scheduleItems[0]?.id).toBe('item-1000')
  })

  it('blocks candidate writes when rights are not ready and audits constraint handling', async () => {
    const { dataGateway, runtime } = buildRuntime({
      playlistType: 'tv',
      candidates: [buildCandidate({ rightsStatus: 'missing' })],
    })

    const result = await submit(runtime, 'insert Replacement News at 10:00', {
      intent: 'insert',
      confidence: 1,
      source: 'test',
      slots: {
        targetTime: '10:00:00',
        programHint: 'Replacement News',
      },
    })

    expect(result.status).toBe('blocked')
    expect(result.decision.constraintReport?.issues[0]).toMatchObject({
      code: 'rights_not_ready',
      severity: 'critical',
      detail: {
        rightsStatus: 'missing',
      },
    })
    expect(result.decision.auditSummary).toMatchObject({
      outcome: 'blocked',
      blockerReason: expect.stringContaining('播出权利尚未满足'),
      constraintIssueCodes: ['rights_not_ready'],
      constraintHandling: [
        {
          code: 'rights_not_ready',
          severity: 'critical',
          action: 'block',
          reason: expect.stringContaining('权利可播'),
        },
      ],
    })
    expect(result.decision.auditSummary?.keyPoints).toEqual(
      expect.arrayContaining([
        expect.stringContaining('约束处理：rights_not_ready=block'),
      ]),
    )

    const context = await dataGateway.loadContext({ userInput: '', channelId, date })
    expect(context.scheduleItems).toHaveLength(0)
  })

  it('uses independent broadcast readiness evidence to block candidate writes', async () => {
    const { runtime } = buildRuntime({
      playlistType: 'tv',
      candidates: [buildCandidate({
        materialStatus: 'ready',
        rightsStatus: 'ready',
      })],
      broadcastReadiness: [{
        candidateId: 'candidate-news',
        materialStatus: 'ready',
        rightsStatus: 'blocked',
        source: 'rights-system',
      }],
    })

    const result = await submit(runtime, 'insert Replacement News at 10:00', {
      intent: 'insert',
      confidence: 1,
      source: 'test',
      slots: {
        targetTime: '10:00:00',
        programHint: 'Replacement News',
      },
    })

    expect(result.status).toBe('blocked')
    expect(result.decision.constraintReport?.issues[0]).toMatchObject({
      code: 'rights_not_ready',
      severity: 'critical',
      detail: {
        rightsStatus: 'blocked',
      },
    })
    expect(result.decision.auditSummary).toMatchObject({
      constraintIssueCodes: ['rights_not_ready'],
      contextSources: {
        readiness: {
          source: 'in_memory_seed',
          available: true,
          recordCount: 1,
        },
      },
    })
    expect(result.decision.candidateSelection?.professionalAssessment?.signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'rights_readiness',
          verdict: 'block',
          sourceKeys: ['readiness'],
        }),
      ]),
    )
  })

  it('blocks candidate writes when the candidate programme source is missing', async () => {
    const dataGateway = new InMemorySchedulingDataGateway([{
      channelId,
      date,
      playlistType: 'tv',
      scheduleItems: [],
      layoutBounds: { start: '06:00:00', end: '23:59:59' },
    }])
    const runtime = new SchedulingAgentRuntime({ dataGateway })

    const result = await submit(runtime, 'insert Replacement News at 10:00', {
      intent: 'insert',
      confidence: 1,
      source: 'test',
      slots: {
        targetTime: '10:00:00',
        programHint: 'Replacement News',
      },
    })

    expect(result.status).toBe('blocked')
    expect(result.decision.constraintReport?.issues[0]).toMatchObject({
      code: 'candidate_source_missing',
      severity: 'critical',
      detail: {
        source: 'none',
        recordCount: 0,
        available: false,
      },
    })
    expect(result.decision.auditSummary).toMatchObject({
      outcome: 'blocked',
      blockerReason: expect.stringContaining('缺少候选节目库'),
      constraintIssueCodes: ['candidate_source_missing'],
      contextSources: {
        candidates: {
          source: 'none',
          available: false,
          recordCount: 0,
        },
      },
    })
    expect(result.decision.auditSummary?.keyPoints).toEqual(
      expect.arrayContaining([
        expect.stringContaining('candidates=missing:0'),
      ]),
    )
    expect(result.decision.auditSummary?.blockers).toEqual(
      expect.arrayContaining([
        expect.stringContaining('候选节目库未配置'),
      ]),
    )

    const context = await dataGateway.loadContext({ userInput: '', channelId, date })
    expect(context.scheduleItems).toHaveLength(0)
  })

  it('keeps the replace target evidence when the candidate programme source is missing', async () => {
    const dataGateway = new InMemorySchedulingDataGateway([{
      channelId,
      date,
      playlistType: 'tv',
      scheduleItems: [buildItem()],
      layoutBounds: { start: '06:00:00', end: '23:59:59' },
    }])
    const runtime = new SchedulingAgentRuntime({ dataGateway })

    const result = await submit(runtime, 'replace Morning News with Replacement News', {
      intent: 'replace',
      confidence: 1,
      source: 'test',
      slots: {
        targetTime: '09:00:00',
        replacementHint: 'Replacement News',
      },
    })

    expect(result.status).toBe('blocked')
    expect(result.decision.resolvedTargets).toEqual([
      expect.objectContaining({
        id: 'item-0900',
        programName: 'Morning News',
      }),
    ])
    expect(result.decision.constraintReport?.issues[0]).toMatchObject({
      code: 'candidate_source_missing',
      severity: 'critical',
    })
    expect(result.decision.auditSummary).toMatchObject({
      outcome: 'blocked',
      blockerReason: expect.stringContaining('缺少候选节目库'),
      constraintIssueCodes: ['candidate_source_missing'],
    })

    const context = await dataGateway.loadContext({ userInput: '', channelId, date })
    expect(context.scheduleItems).toHaveLength(1)
    expect(context.scheduleItems[0]?.id).toBe('item-0900')
  })

  it('keeps an empty candidate source distinct from a missing candidate source', async () => {
    const { dataGateway, runtime } = buildRuntime({
      playlistType: 'tv',
      candidates: [],
    })

    const result = await submit(runtime, 'insert Replacement News at 10:00', {
      intent: 'insert',
      confidence: 1,
      source: 'test',
      slots: {
        targetTime: '10:00:00',
        programHint: 'Replacement News',
      },
    })

    expect(result.status).toBe('needs_clarification')
    expect(result.decision.constraintReport?.issues[0]).toMatchObject({
      code: 'program_not_found',
      severity: 'critical',
      detail: expect.objectContaining({
        searchedKeyword: 'Replacement News',
        candidateRecordCount: 0,
        nextAction: 'rewrite_keywords_and_retry',
      }),
    })
    expect(result.decision.auditSummary?.contextSources?.candidates).toMatchObject({
      source: 'in_memory_seed',
      available: true,
      recordCount: 0,
    })
    expect(result.decision.auditSummary?.keyPoints).toEqual(
      expect.arrayContaining([
        expect.stringContaining('candidates=in_memory_seed:0'),
      ]),
    )
    expect(result.decision.auditSummary?.keyPoints).not.toEqual(
      expect.arrayContaining([
        expect.stringContaining('Data source missing: candidate programme source is not configured'),
      ]),
    )

    const context = await dataGateway.loadContext({ userInput: '', channelId, date })
    expect(context.scheduleItems).toHaveLength(0)
  })

  it('executes TV replace commands directly and keeps the original item identity', async () => {
    const { dataGateway, runtime } = buildRuntime({
      playlistType: 'tv',
      items: [buildItem()],
      candidates: [buildCandidate()],
    })

    const result = await submit(runtime, 'replace 09:00 with Replacement News', {
      intent: 'replace',
      confidence: 1,
      source: 'test',
      slots: {
        targetTime: '09:00:00',
        replacementHint: 'Replacement News',
      },
    })

    expect(result.status).toBe('executed')
    expect(result.decision.command).toMatchObject({
      intent: 'replace',
      itemId: 'item-0900',
      candidateId: 'candidate-news',
    })
    expect(result.decision.auditSummary?.outcome).toBe('executed')

    const context = await dataGateway.loadContext({ userInput: '', channelId, date })
    expect(context.scheduleItems[0]).toMatchObject({
      id: 'item-0900',
      programName: 'Replacement News',
    })
  })

  it('explains the remaining gap when a TV replacement is shorter than the original slot', async () => {
    const { dataGateway, runtime } = buildRuntime({
      playlistType: 'tv',
      items: [buildItem({
        endTime: '09:45:00',
        duration: 2700,
      })],
      candidates: [buildCandidate({
        duration: 1800,
      })],
    })

    const result = await submit(runtime, 'replace 09:00 with Replacement News', {
      intent: 'replace',
      confidence: 1,
      source: 'test',
      slots: {
        targetTime: '09:00:00',
        replacementHint: 'Replacement News',
      },
    })

    expect(result.status).toBe('executed')
    expect(result.explanation).toContain('短15分钟')
    expect(result.explanation).toContain('电视播单会留下15分钟空窗')

    const context = await dataGateway.loadContext({ userInput: '', channelId, date })
    expect(context.scheduleItems[0]).toMatchObject({
      id: 'item-0900',
      programName: 'Replacement News',
      endTime: '2026-03-25T09:30:00+08:00',
      duration: 1800,
    })
  })

  it('asks for selection before replacing when multiple non-sequential TV candidates remain', async () => {
    const { dataGateway, runtime } = buildRuntime({
      playlistType: 'tv',
      items: [buildItem({
        columnId: 'morning-news',
        columnName: 'Morning News',
        programType: 'news',
      })],
      candidates: [
        buildCandidate({
          id: 'candidate-drama-replacement',
          programCode: 'DRAMA1000',
          programName: 'Replacement Drama',
          instanceName: 'Replacement Drama',
          columnId: 'drama',
          columnName: 'Drama',
          programType: 'drama',
          contentTags: ['replacement'],
        }),
        buildCandidate({
          id: 'candidate-news-replacement',
          programCode: 'NEWS1001',
          programName: 'Replacement Bulletin',
          instanceName: 'Replacement Bulletin',
          columnId: 'morning-news',
          columnName: 'Morning News',
          programType: 'news',
          contentTags: ['replacement'],
        }),
      ],
    })

    const result = await submit(runtime, 'replace 09:00 with Replacement', {
      intent: 'replace',
      confidence: 1,
      source: 'test',
      slots: {
        targetTime: '09:00:00',
        replacementHint: 'Replacement',
      },
    })

    expect(result.status).toBe('needs_selection')
    expect(result.decision.command).toBeUndefined()
    expect(result.decision.candidateSelection).toMatchObject({
      method: 'candidate_judge_llm',
      source: 'none',
      candidateOptionIds: ['candidate-drama-replacement', 'candidate-news-replacement'],
    })
    expect(result.decision.pendingTask).toMatchObject({
      intent: 'replace',
      phase: 'needs_selection',
      missingSlots: ['candidateId'],
    })

    let context = await dataGateway.loadContext({ userInput: '', channelId, date })
    expect(context.scheduleItems[0]).toMatchObject({
      id: 'item-0900',
      programName: 'Morning News',
      columnId: 'morning-news',
    })

    const selected = await runtime.submit({
      userInput: 'use the news replacement',
      channelId,
      date,
      pendingTask: result.decision.pendingTask,
      interpretation: {
        intent: 'replace',
        pendingAction: 'select_candidate',
        confidence: 1,
        source: 'test',
        slots: {
          candidateId: 'candidate-news-replacement',
        },
      },
    })

    expect(selected.status).toBe('executed')
    expect(selected.decision.command).toMatchObject({
      intent: 'replace',
      itemId: 'item-0900',
      candidateId: 'candidate-news-replacement',
    })
    expect(selected.decision.candidateSelection).toMatchObject({
      method: 'explicit',
      selectedCandidateId: 'candidate-news-replacement',
    })
    expect(selected.decision.candidateSelection?.professionalAssessment?.signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'replacement_duty_fit',
          verdict: 'prefer',
        }),
      ]),
    )

    context = await dataGateway.loadContext({ userInput: '', channelId, date })
    expect(context.scheduleItems[0]).toMatchObject({
      id: 'item-0900',
      programName: 'Replacement Bulletin',
      columnId: 'morning-news',
    })
  })

  it('uses latest history to choose the next Chinese TV episode for replace commands', async () => {
    const seriesTitle = '\u4eba\u6587\u4e2d\u56fd'
    const episode12 = `${seriesTitle} \u7b2c\u5341\u4e8c\u96c6`
    const episode13 = `${seriesTitle} \u7b2c\u5341\u4e09\u96c6`
    const episode14 = `${seriesTitle} \u7b2c\u5341\u56db\u96c6`
    const historyEpisode12 = buildItem({
      id: 'history-humanities-replace-12',
      programId: undefined,
      programCode: 'RENWEN-HISTORY',
      programName: episode12,
      instanceName: episode12,
      startTime: '2026-03-24T20:00:00+08:00',
      endTime: '2026-03-24T20:30:00+08:00',
      duration: 1800,
      programType: 'documentary',
      columnId: 'humanities',
      columnName: 'Humanities',
    })
    const { dataGateway, runtime } = buildRuntime({
      playlistType: 'tv',
      items: [buildItem({
        programCode: 'HUMANITIES-SLOT',
        programName: 'Humanities Placeholder',
        instanceName: 'Humanities Placeholder',
        duration: 1800,
        programType: 'documentary',
        columnId: 'humanities',
        columnName: 'Humanities',
      })],
      candidates: [
        buildCandidate({
          id: 'candidate-humanities-replace-14',
          programId: undefined,
          programCode: 'RENWEN-B',
          programName: episode14,
          instanceName: episode14,
          duration: 1800,
          programType: 'documentary',
          columnId: 'humanities',
          columnName: 'Humanities',
        }),
        buildCandidate({
          id: 'candidate-humanities-replace-13',
          programId: undefined,
          programCode: 'RENWEN-C',
          programName: episode13,
          instanceName: episode13,
          duration: 1800,
          programType: 'documentary',
          columnId: 'humanities',
          columnName: 'Humanities',
        }),
      ],
      historySchedules: [{
        date: '2026-03-24',
        itemCount: 1,
        programTypes: { documentary: 1 },
        items: [historyEpisode12],
      }],
    })

    const result = await submit(runtime, `replace 09:00 with ${seriesTitle}`, {
      intent: 'replace',
      confidence: 1,
      source: 'test',
      slots: {
        targetTime: '09:00:00',
        replacementHint: seriesTitle,
      },
    })

    expect(result.status).toBe('executed')
    expect(result.decision.candidateSelection).toMatchObject({
      method: 'tv_sequence',
      source: 'history',
      expectedSequence: 13,
      selectedSequence: 13,
      selectedCandidateId: 'candidate-humanities-replace-13',
    })
    expect(result.decision.command).toMatchObject({
      intent: 'replace',
      itemId: 'item-0900',
      candidateId: 'candidate-humanities-replace-13',
    })

    const context = await dataGateway.loadContext({ userInput: '', channelId, date })
    expect(context.scheduleItems[0]).toMatchObject({
      id: 'item-0900',
      programName: episode13,
      columnId: 'humanities',
    })
  })

  it('blocks explicit TV replace candidates that skip the latest history episode baseline', async () => {
    const seriesTitle = '\u4eba\u6587\u4e2d\u56fd'
    const episode12 = `${seriesTitle} \u7b2c\u5341\u4e8c\u96c6`
    const episode14 = `${seriesTitle} \u7b2c\u5341\u56db\u96c6`
    const historyEpisode12 = buildItem({
      id: 'history-humanities-skip-12',
      programId: undefined,
      programCode: 'RENWEN-HISTORY',
      programName: episode12,
      instanceName: episode12,
      startTime: '2026-03-24T20:00:00+08:00',
      endTime: '2026-03-24T20:30:00+08:00',
      duration: 1800,
      programType: 'documentary',
      columnId: 'humanities',
      columnName: 'Humanities',
    })
    const { dataGateway, runtime } = buildRuntime({
      playlistType: 'tv',
      items: [buildItem({
        programCode: 'HUMANITIES-SLOT',
        programName: 'Humanities Placeholder',
        instanceName: 'Humanities Placeholder',
        duration: 1800,
        programType: 'documentary',
        columnId: 'humanities',
        columnName: 'Humanities',
      })],
      candidates: [buildCandidate({
        id: 'candidate-humanities-skip-14',
        programId: undefined,
        programCode: 'RENWEN-B',
        programName: episode14,
        instanceName: episode14,
        duration: 1800,
        programType: 'documentary',
        columnId: 'humanities',
        columnName: 'Humanities',
      })],
      historySchedules: [{
        date: '2026-03-24',
        itemCount: 1,
        programTypes: { documentary: 1 },
        items: [historyEpisode12],
      }],
    })

    const result = await submit(runtime, `replace 09:00 with ${seriesTitle} episode 14`, {
      intent: 'replace',
      confidence: 1,
      source: 'test',
      slots: {
        targetTime: '09:00:00',
        replacementHint: seriesTitle,
        candidateId: 'candidate-humanities-skip-14',
      },
    })

    expect(result.status).toBe('blocked')
    expect(result.executionResult).toBeUndefined()
    expect(result.decision.candidateSelection).toMatchObject({
      method: 'tv_sequence',
      source: 'history',
      expectedSequence: 13,
      selectedSequence: 14,
      selectedCandidateId: 'candidate-humanities-skip-14',
    })
    expect(result.decision.constraintReport?.issues[0]).toMatchObject({
      code: 'sequence_violation',
      severity: 'critical',
      detail: {
        source: 'history',
        expectedSequence: 13,
        selectedSequence: 14,
      },
    })

    const context = await dataGateway.loadContext({ userInput: '', channelId, date })
    expect(context.scheduleItems[0]).toMatchObject({
      id: 'item-0900',
      programName: 'Humanities Placeholder',
    })
  })

  it('allows explicit TV replacement candidates that break the target slot responsibility with a weighting warning', async () => {
    const { dataGateway, runtime } = buildRuntime({
      playlistType: 'tv',
      items: [buildItem({
        columnId: 'morning-news',
        columnName: 'Morning News',
        programType: 'news',
      })],
      candidates: [buildCandidate({
        id: 'candidate-movie-replacement',
        programCode: 'MOVIE1000',
        programName: 'Replacement Movie',
        instanceName: 'Replacement Movie',
        columnId: 'movie',
        columnName: 'Movie',
        programType: 'movie',
      })],
    })

    const result = await submit(runtime, 'replace 09:00 with Replacement Movie', {
      intent: 'replace',
      confidence: 1,
      source: 'test',
      slots: {
        targetTime: '09:00:00',
        replacementHint: 'Replacement Movie',
        candidateId: 'candidate-movie-replacement',
      },
    })

    expect(result.status).toBe('executed')
    expect(result.executionResult?.committed).toBe(true)
    expect(result.decision.constraintReport?.ok).toBe(true)
    expect(result.decision.candidateSelection?.professionalAssessment?.hardBlockCodes).toEqual([])
    expect(result.decision.candidateSelection?.professionalAssessment?.signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'replacement_duty_fit',
          verdict: 'warn',
          sourceKeys: ['today', 'candidates', 'policy'],
        }),
      ]),
    )

    const context = await dataGateway.loadContext({ userInput: '', channelId, date })
    expect(context.scheduleItems[0]).toMatchObject({
      id: 'item-0900',
      programName: 'Replacement Movie',
    })
  })

  it('returns rotation replace commands as recommendations before replacing items', async () => {
    const { dataGateway, runtime } = buildRuntime({
      playlistType: 'rotation',
      rotationStrategy: 'content_match',
      items: [buildItem()],
      candidates: [buildCandidate()],
    })

    const result = await submit(runtime, 'replace 09:00 with Replacement News', {
      intent: 'replace',
      confidence: 1,
      source: 'test',
      slots: {
        targetTime: '09:00:00',
        replacementHint: 'Replacement News',
      },
    })

    expect(result.status).toBe('needs_confirmation')
    expect(result.decision.pendingTask).toMatchObject({
      intent: 'replace',
      phase: 'needs_confirmation',
      missingSlots: ['confirmation'],
    })
    expect(result.decision.auditSummary?.outcome).toBe('pending')
    expect(result.decision.auditSummary).toMatchObject({
      professionalConclusion: expect.stringContaining('写入前需要编排人员确认'),
      confirmationReason: expect.stringContaining('已进入预演'),
    })

    const context = await dataGateway.loadContext({ userInput: '', channelId, date })
    expect(context.scheduleItems[0]?.programName).toBe('Morning News')
  })

  it('keeps rotation replacements confirmed while explaining total-duration change', async () => {
    const { dataGateway, runtime } = buildRuntime({
      playlistType: 'rotation',
      rotationStrategy: 'content_match',
      items: [buildItem({
        startTime: '00:00:00',
        endTime: '00:45:00',
        duration: 2700,
        programName: '城市宣传片45分钟版',
      })],
      candidates: [buildCandidate({
        duration: 1800,
        programName: '城市宣传片30分钟版',
        instanceName: '城市宣传片30分钟版',
      })],
    })

    const first = await submit(runtime, 'replace 00:00 with 城市宣传片30分钟版', {
      intent: 'replace',
      confidence: 1,
      source: 'test',
      slots: {
        targetTime: '00:00:00',
        replacementHint: '城市宣传片30分钟版',
      },
    })

    expect(first.status).toBe('needs_confirmation')
    expect(first.explanation).toContain('替换《城市宣传片30分钟版》前需要确认')
    expect(first.explanation).toContain('总时长会减少15分钟')

    const confirmed = await runtime.submit({
      userInput: '确认',
      channelId,
      date,
      pendingTask: first.decision.pendingTask,
      interpretation: {
        intent: 'replace',
        pendingAction: 'confirm',
        confidence: 1,
        source: 'test',
      },
    })

    expect(confirmed.status).toBe('executed')
    expect(confirmed.explanation).toContain('轮播队列会继续串联')
    expect(confirmed.explanation).toContain('总时长会减少15分钟')

    const context = await dataGateway.loadContext({ userInput: '', channelId, date })
    expect(context.scheduleItems[0]).toMatchObject({
      id: 'item-0900',
      programName: '城市宣传片30分钟版',
      startTime: '2026-03-25T00:00:00+08:00',
      endTime: '2026-03-25T00:30:00+08:00',
      duration: 1800,
    })
  })

  it('gates sensitive delete commands behind confirmation for TV playlists', async () => {
    const { dataGateway, runtime } = buildRuntime({
      playlistType: 'tv',
      items: [buildItem()],
    })

    const result = await submit(runtime, 'delete 09:00', {
      intent: 'delete',
      confidence: 1,
      source: 'test',
      slots: {
        targetTime: '09:00:00',
      },
    })

    expect(result.status).toBe('needs_confirmation')
    expect(result.decision.command).toMatchObject({
      intent: 'delete',
      itemId: 'item-0900',
    })
    expect(result.decision.auditSummary?.outcome).toBe('pending')
    expect(result.decision.auditSummary).toMatchObject({
      professionalConclusion: expect.stringContaining('写入前需要编排人员确认'),
      confirmationReason: expect.stringContaining('删除会改变正式播单记录'),
    })

    const context = await dataGateway.loadContext({ userInput: '', channelId, date })
    expect(context.scheduleItems).toHaveLength(1)
  })

  it('continues pending delete commands after target clarification and waits for confirmation', async () => {
    const { dataGateway, runtime } = buildRuntime({
      playlistType: 'tv',
      items: [buildItem()],
    })

    const first = await submit(runtime, 'delete a programme', {
      intent: 'delete',
      confidence: 1,
      source: 'test',
      slots: {},
    })

    expect(first.status).toBe('needs_clarification')
    expect(first.executionResult).toBeUndefined()
    expect(first.decision.pendingTask).toMatchObject({
      intent: 'delete',
      phase: 'needs_clarification',
      missingSlots: ['targetTime'],
      contextFingerprint: expect.any(String),
    })

    const result = await runtime.submit({
      userInput: 'the 09:00 one',
      channelId,
      date,
      pendingTask: first.decision.pendingTask,
      interpretation: {
        intent: 'delete',
        pendingAction: 'continue_pending',
        confidence: 1,
        source: 'test',
        slots: {
          targetTime: '09:00:00',
        },
      },
    })

    expect(result.status).toBe('needs_confirmation')
    expect(result.executionResult).toBeUndefined()
    expect(result.decision.command).toMatchObject({
      intent: 'delete',
      itemId: 'item-0900',
    })
    expect(result.decision.pendingTask).toMatchObject({
      intent: 'delete',
      phase: 'needs_confirmation',
      missingSlots: ['confirmation'],
    })

    const context = await dataGateway.loadContext({ userInput: '', channelId, date })
    expect(context.scheduleItems).toHaveLength(1)
  })

  it('does not continue missing-target delete commands after playlist evidence changes', async () => {
    const { dataGateway, runtime } = buildRuntime({
      playlistType: 'tv',
      items: [buildItem()],
    })

    const first = await submit(runtime, 'delete a programme', {
      intent: 'delete',
      confidence: 1,
      source: 'test',
      slots: {},
    })

    await dataGateway.commitScheduleItems({
      channelId,
      date,
      items: [buildItem({
        id: 'external-1000',
        programCode: 'EXT1000',
        programName: 'External Update',
        startTime: '10:00:00',
        endTime: '10:30:00',
        duration: 1800,
      })],
      reason: 'external:user_edit',
    })

    const result = await runtime.submit({
      userInput: 'the 09:00 one',
      channelId,
      date,
      pendingTask: first.decision.pendingTask,
      interpretation: {
        intent: 'delete',
        pendingAction: 'continue_pending',
        confidence: 1,
        source: 'test',
        slots: {
          targetTime: '09:00:00',
        },
      },
    })

    expect(result.status).toBe('needs_clarification')
    expect(result.executionResult).toBeUndefined()
    expect(result.decision.constraintReport?.issues[0]).toMatchObject({
      code: 'context_conflict',
    })

    const context = await dataGateway.loadContext({ userInput: '', channelId, date })
    expect(context.scheduleItems.map((item) => item.id)).toEqual(['external-1000'])
  })

  it('rejects pending sensitive delete confirmations without deleting the item', async () => {
    const { dataGateway, runtime } = buildRuntime({
      playlistType: 'tv',
      items: [buildItem()],
    })

    const first = await submit(runtime, 'delete 09:00', {
      intent: 'delete',
      confidence: 1,
      source: 'test',
      slots: {
        targetTime: '09:00:00',
      },
    })

    expect(first.status).toBe('needs_confirmation')

    const rejected = await runtime.submit({
      userInput: 'keep it',
      channelId,
      date,
      pendingTask: first.decision.pendingTask,
      interpretation: {
        intent: 'delete',
        pendingAction: 'reject',
        confidence: 1,
        source: 'test',
      },
    })

    expect(rejected.status).toBe('needs_clarification')
    expect(rejected.decision.pendingTask).toBeUndefined()
    expect(rejected.executionResult).toBeUndefined()

    const context = await dataGateway.loadContext({ userInput: '', channelId, date })
    expect(context.scheduleItems).toHaveLength(1)
    expect(context.scheduleItems[0]?.id).toBe('item-0900')
  })

  it('does not commit pending delete confirmations after the target playlist context changes', async () => {
    const { dataGateway, runtime } = buildRuntime({
      playlistType: 'tv',
      items: [buildItem()],
    })

    const first = await submit(runtime, 'delete 09:00', {
      intent: 'delete',
      confidence: 1,
      source: 'test',
      slots: {
        targetTime: '09:00:00',
      },
    })

    expect(first.status).toBe('needs_confirmation')
    expect(first.decision.pendingTask?.contextFingerprint).toEqual(expect.stringMatching(/^agent_context:/))

    await dataGateway.commitScheduleItems({
      channelId,
      date,
      items: [buildItem({
        startTime: '09:30:00',
        endTime: '10:00:00',
      })],
      reason: 'external:user_edit',
    })

    const result = await runtime.submit({
      userInput: 'confirm',
      channelId,
      date,
      pendingTask: first.decision.pendingTask,
      interpretation: {
        intent: 'delete',
        pendingAction: 'confirm',
        confidence: 1,
        source: 'test',
      },
    })

    expect(result.status).toBe('needs_clarification')
    expect(result.executionResult).toBeUndefined()
    expect(result.explanation).toContain('pending task context changed')

    const context = await dataGateway.loadContext({ userInput: '', channelId, date })
    expect(context.scheduleItems).toHaveLength(1)
    expect(context.scheduleItems[0]).toMatchObject({
      id: 'item-0900',
      startTime: '2026-03-25T09:30:00+08:00',
    })
  })

  it('does not continue ambiguous delete target selections after playlist evidence changes', async () => {
    const { dataGateway, runtime } = buildRuntime({
      playlistType: 'tv',
      items: [
        buildItem({
          id: 'morning-news-0900',
          programCode: 'NEWS0900A',
          programName: 'Morning News',
          endTime: '09:30:00',
          duration: 1800,
        }),
        buildItem({
          id: 'morning-news-0930',
          programCode: 'NEWS0930A',
          programName: 'Morning News',
          startTime: '09:30:00',
          endTime: '10:00:00',
          duration: 1800,
          sequence: 2,
        }),
      ],
    })

    const first = await submit(runtime, 'delete Morning News', {
      intent: 'delete',
      confidence: 1,
      source: 'test',
      slots: {
        targetProgramName: 'Morning News',
      },
    })

    expect(first.status).toBe('needs_clarification')
    expect(first.decision.pendingTask).toMatchObject({
      intent: 'delete',
      missingSlots: ['targetItemId'],
      targetOptions: [
        expect.objectContaining({ itemId: 'morning-news-0900' }),
        expect.objectContaining({ itemId: 'morning-news-0930' }),
      ],
    })
    expect(first.decision.pendingTask?.contextFingerprint).toEqual(expect.stringMatching(/^agent_context:/))

    await dataGateway.commitScheduleItems({
      channelId,
      date,
      items: [buildItem({
        id: 'external-1030',
        programCode: 'EXT1030',
        programName: 'External Update',
        startTime: '10:30:00',
        endTime: '11:00:00',
        duration: 1800,
      })],
      reason: 'external:user_edit',
    })

    const result = await runtime.submit({
      userInput: 'delete the first one',
      channelId,
      date,
      pendingTask: first.decision.pendingTask,
      interpretation: {
        intent: 'delete',
        pendingAction: 'continue_pending',
        confidence: 1,
        source: 'test',
        slots: {
          targetItemId: 'morning-news-0900',
        },
      },
    })

    expect(result.status).toBe('needs_clarification')
    expect(result.executionResult).toBeUndefined()
    expect(result.explanation).toContain('pending task context changed')
    expect(result.decision.constraintReport?.issues[0]).toMatchObject({
      code: 'context_conflict',
      detail: {
        changedSourceKeys: ['today'],
      },
    })

    const context = await dataGateway.loadContext({ userInput: '', channelId, date })
    expect(context.scheduleItems).toHaveLength(1)
    expect(context.scheduleItems[0]?.id).toBe('external-1030')
  })

  it('resolves delete targets from column metadata and asks for selection when multiple items match', async () => {
    const { dataGateway, runtime } = buildRuntime({
      playlistType: 'tv',
      items: [
        buildItem({
          id: 'news-0900',
          programCode: 'NEWS0900',
          programName: 'Morning Edition',
          columnId: 'dragon-news',
          columnName: 'Dragon News',
          endTime: '09:30:00',
          duration: 1800,
        }),
        buildItem({
          id: 'news-0930',
          programCode: 'NEWS0930',
          programName: 'City Bulletin',
          columnId: 'dragon-news',
          columnName: 'Dragon News',
          startTime: '09:30:00',
          endTime: '10:00:00',
          duration: 1800,
          sequence: 2,
        }),
      ],
    })

    const first = await submit(runtime, 'delete Dragon News', {
      intent: 'delete',
      confidence: 1,
      source: 'test',
      slots: {
        targetProgramName: 'Dragon News',
      },
    })

    expect(first.status).toBe('needs_clarification')
    expect(first.executionResult).toBeUndefined()
    expect(first.decision.pendingTask).toMatchObject({
      intent: 'delete',
      missingSlots: ['targetItemId'],
      targetOptions: [
        expect.objectContaining({ itemId: 'news-0900' }),
        expect.objectContaining({ itemId: 'news-0930' }),
      ],
    })

    const context = await dataGateway.loadContext({ userInput: '', channelId, date })
    expect(context.scheduleItems.map((item) => item.id)).toEqual(['news-0900', 'news-0930'])
  })

  it('continues foreground delete target card selections from structured pending context', async () => {
    const { dataGateway, runtime } = buildRuntime({
      playlistType: 'tv',
      items: [
        buildItem({
          id: 'news-0900',
          programCode: 'NEWS0900',
          programName: 'Morning Edition',
          columnId: 'dragon-news',
          columnName: 'Dragon News',
          endTime: '09:30:00',
          duration: 1800,
        }),
        buildItem({
          id: 'news-0930',
          programCode: 'NEWS0930',
          programName: 'City Bulletin',
          columnId: 'dragon-news',
          columnName: 'Dragon News',
          startTime: '09:30:00',
          endTime: '10:00:00',
          duration: 1800,
          sequence: 2,
        }),
      ],
    })

    const first = await submit(runtime, 'delete Dragon News', {
      intent: 'delete',
      confidence: 1,
      source: 'test',
      slots: {
        targetProgramName: 'Dragon News',
      },
    })
    expect(first.status).toBe('needs_clarification')
    expect(first.decision.pendingTask?.targetOptions?.map((option) => option.itemId)).toEqual(['news-0900', 'news-0930'])

    const selectedPendingTask = {
      ...first.decision.pendingTask!,
      collectedSlots: {
        ...first.decision.pendingTask!.collectedSlots,
        targetItemId: {
          value: 'news-0930',
          source: 'user_followup' as const,
          confidence: 0.95,
          rawText: 'foreground card target selection',
        },
      },
      missingSlots: [],
    }

    const preview = await runtime.submit({
      userInput: '确认',
      channelId,
      date,
      pendingTask: selectedPendingTask,
      interpretation: {
        intent: 'delete',
        pendingAction: 'confirm',
        confidence: 1,
        source: 'test',
        slots: {},
      },
    })

    expect(preview.status).toBe('needs_confirmation')
    expect(preview.decision.resolvedTargets).toEqual([
      expect.objectContaining({ id: 'news-0930' }),
    ])
    expect(preview.decision.pendingTask).toMatchObject({
      phase: 'needs_confirmation',
      collectedSlots: {
        targetItemId: expect.objectContaining({ value: 'news-0930' }),
      },
    })

    const committed = await runtime.submit({
      userInput: '确认',
      channelId,
      date,
      pendingTask: preview.decision.pendingTask,
      interpretation: {
        intent: 'delete',
        pendingAction: 'confirm',
        confidence: 1,
        source: 'test',
        slots: {},
      },
    })

    expect(committed.status).toBe('executed')
    const context = await dataGateway.loadContext({ userInput: '', channelId, date })
    expect(context.scheduleItems.map((item) => item.id)).toEqual(['news-0900'])
  })

  it('resolves an LLM-only natural delete utterance to programme-name target resolution', async () => {
    const { dataGateway, runtime } = buildRuntime({
      playlistType: 'tv',
      items: [buildItem({
        id: 'item-kan-dongfang',
        programCode: 'KDF0900',
        programName: '看东方',
      })],
    })

    const result = await runtime.submit({
      userInput: '删除看东方',
      channelId,
      date,
      interpretation: {
        intent: 'delete',
        confidence: 1,
        source: 'test',
        slots: {
          targetProgramName: '看东方',
        },
      },
    })

    expect(result.status).toBe('needs_confirmation')
    expect(result.decision.intent).toBe('delete')
    expect(result.decision.resolvedTargets).toEqual([
      expect.objectContaining({
        id: 'item-kan-dongfang',
        programName: '看东方',
      }),
    ])
    expect(result.decision.pendingTask).toMatchObject({
      intent: 'delete',
      phase: 'needs_confirmation',
      collectedSlots: {
        targetItemId: expect.objectContaining({ value: 'item-kan-dongfang' }),
      },
    })

    const context = await dataGateway.loadContext({ userInput: '', channelId, date })
    expect(context.scheduleItems).toHaveLength(1)
  })

  it('uses LLM-only natural replace utterance slots for target programme and replacement candidate', async () => {
    const { dataGateway, runtime } = buildRuntime({
      playlistType: 'tv',
      items: [buildItem({
        id: 'item-kan-dongfang',
        programCode: 'KDF0900',
        programName: '看东方',
      })],
      candidates: [buildCandidate({
        id: 'candidate-dongfang-news',
        programId: 'program-dongfang-news',
        programCode: 'DFNEWS0900',
        programName: '东方新闻',
        instanceName: '东方新闻',
        duration: 1800,
        programType: 'news',
        contentTags: ['新闻', '东方卫视'],
      })],
    })

    const result = await runtime.submit({
      userInput: '把看东方换成东方新闻',
      channelId,
      date,
      interpretation: {
        intent: 'replace',
        confidence: 1,
        source: 'test',
        slots: {
          targetProgramName: '看东方',
          replacementHint: '东方新闻',
        },
      },
    })

    expect(result.status).toBe('executed')
    expect(result.decision.command).toMatchObject({
      intent: 'replace',
      itemId: 'item-kan-dongfang',
      candidateId: 'candidate-dongfang-news',
    })
    expect(result.decision.resolvedTargets).toEqual([
      expect.objectContaining({
        id: 'item-kan-dongfang',
        programName: '看东方',
      }),
    ])

    const context = await dataGateway.loadContext({ userInput: '', channelId, date })
    expect(context.scheduleItems).toHaveLength(1)
    expect(context.scheduleItems[0]).toMatchObject({
      id: 'item-kan-dongfang',
      programName: '东方新闻',
      programCode: 'DFNEWS0900',
    })
  })

  it('does not reverse target and replacement for natural replace utterances that start with the new programme', async () => {
    const { dataGateway, runtime } = buildRuntime({
      playlistType: 'tv',
      items: [buildItem({
        id: 'item-kan-dongfang',
        programCode: 'KDF0900',
        programName: '看东方',
      })],
      candidates: [buildCandidate({
        id: 'candidate-dongfang-news',
        programId: 'program-dongfang-news',
        programCode: 'DFNEWS0900',
        programName: '东方新闻',
        instanceName: '东方新闻',
        duration: 1800,
        programType: 'news',
        contentTags: ['新闻', '东方卫视'],
      })],
    })

    const result = await runtime.submit({
      userInput: '用东方新闻替换看东方',
      channelId,
      date,
      interpretation: {
        intent: 'replace',
        confidence: 1,
        source: 'test',
        slots: {
          targetProgramName: '看东方',
          replacementHint: '东方新闻',
        },
      },
    })

    expect(result.status).toBe('executed')
    expect(result.decision.command).toMatchObject({
      intent: 'replace',
      itemId: 'item-kan-dongfang',
      candidateId: 'candidate-dongfang-news',
    })

    const context = await dataGateway.loadContext({ userInput: '', channelId, date })
    expect(context.scheduleItems[0]).toMatchObject({
      id: 'item-kan-dongfang',
      programName: '东方新闻',
      programCode: 'DFNEWS0900',
    })
  })

  it('uses LLM-only natural programme-location query slots for read-only programme lookup', async () => {
    const { dataGateway, runtime } = buildRuntime({
      playlistType: 'tv',
      items: [buildItem({
        id: 'item-kan-dongfang',
        programCode: 'KDF0900',
        programName: '看东方',
      })],
    })

    const result = await runtime.submit({
      userInput: '看看看东方在哪',
      channelId,
      date,
      interpretation: {
        intent: 'query',
        confidence: 1,
        source: 'test',
        queryKind: 'program_lookup',
        slots: {
          targetProgramName: '看东方',
        },
        keyword: '看东方',
      },
    })

    expect(result.status).toBe('executed')
    expect(result.decision.intent).toBe('query')
    expect(result.decision.queryResult).toMatchObject({
      kind: 'program_lookup',
      keyword: '看东方',
      totalCount: 1,
      scheduleItems: [
        expect.objectContaining({
          id: 'item-kan-dongfang',
          programName: '看东方',
        }),
      ],
    })

    const context = await dataGateway.loadContext({ userInput: '', channelId, date })
    expect(context.scheduleItems).toHaveLength(1)
  })

  it('gates sensitive batch_delete commands behind confirmation for rotation playlists', async () => {
    const { dataGateway, runtime } = buildRuntime({
      playlistType: 'rotation',
      rotationStrategy: 'content_match',
      items: [
        buildItem({ endTime: '09:30:00', duration: 1800 }),
        buildItem({
          id: 'item-0930',
          programCode: 'NEWS0930',
          programName: 'Mid Morning News',
          startTime: '09:30:00',
          endTime: '10:00:00',
          duration: 1800,
          sequence: 2,
        }),
      ],
    })

    const result = await submit(runtime, 'delete 09:00-10:00', {
      intent: 'batch_delete',
      confidence: 1,
      source: 'test',
      slots: {
        rangeStart: '09:00:00',
        rangeEnd: '10:00:00',
      },
    })

    expect(result.status).toBe('needs_confirmation')
    expect(result.decision.command).toMatchObject({
      intent: 'batch_delete',
      itemIds: ['item-0900', 'item-0930'],
    })
    expect(result.decision.auditSummary?.outcome).toBe('pending')

    const context = await dataGateway.loadContext({ userInput: '', channelId, date })
    expect(context.scheduleItems).toHaveLength(2)
  })

  it('keeps query commands read-only while returning schedule and candidate data', async () => {
    const { dataGateway, runtime } = buildRuntime({
      playlistType: 'rotation',
      rotationStrategy: 'content_match',
      items: [buildItem()],
      candidates: [buildCandidate()],
    })

    const result = await submit(runtime, 'find Replacement News candidates', {
      intent: 'query',
      confidence: 1,
      source: 'test',
      queryKind: 'candidate_lookup',
      keyword: 'Replacement News',
    })

    expect(result.status).toBe('executed')
    expect(result.decision.queryResult).toMatchObject({
      kind: 'candidate_lookup',
      playlistType: 'rotation',
      totalCount: 1,
      candidates: [{ id: 'candidate-news' }],
    })
    expect(result.decision.auditSummary?.outcome).toBe('read_only')

    const context = await dataGateway.loadContext({ userInput: '', channelId, date })
    expect(context.scheduleItems).toHaveLength(1)
  })

  it('distinguishes missing candidate sources from empty candidate query results', async () => {
    const missingSourceGateway = new RuntimeSchedulingDataGateway({
      scheduleState: buildScheduleState({ playlistType: 'tv' }),
      reader: {
        getScheduleItems: () => [buildItem()],
      },
    })
    const missingSourceRuntime = new SchedulingAgentRuntime({ dataGateway: missingSourceGateway })

    const missingSourceResult = await submit(missingSourceRuntime, 'find Replacement News candidates', {
      intent: 'query',
      confidence: 1,
      source: 'test',
      queryKind: 'candidate_lookup',
      keyword: 'Replacement News',
    })

    expect(missingSourceResult.status).toBe('executed')
    expect(missingSourceResult.decision.queryResult).toMatchObject({
      kind: 'candidate_lookup',
      totalCount: 0,
      candidates: [],
    })
    expect(missingSourceResult.decision.constraintReport).toMatchObject({
      ok: false,
      issues: [
        expect.objectContaining({
          code: 'candidate_source_missing',
          severity: 'critical',
          detail: expect.objectContaining({
            source: 'none',
            available: false,
            recordCount: 0,
          }),
        }),
      ],
    })
    expect(missingSourceResult.explanation).toContain('Candidate programme source is missing')
    expect(missingSourceResult.decision.auditSummary).toMatchObject({
      outcome: 'read_only',
      constraintIssueCodes: ['candidate_source_missing'],
      contextSources: {
        candidates: {
          source: 'none',
          available: false,
          recordCount: 0,
        },
      },
    })

    const emptySourceGateway = new RuntimeSchedulingDataGateway({
      scheduleState: buildScheduleState({ playlistType: 'tv' }),
      reader: {
        getScheduleItems: () => [buildItem()],
        getProgramCandidates: () => [],
      },
    })
    const emptySourceRuntime = new SchedulingAgentRuntime({ dataGateway: emptySourceGateway })

    const emptySourceResult = await submit(emptySourceRuntime, 'find Replacement News candidates', {
      intent: 'query',
      confidence: 1,
      source: 'test',
      queryKind: 'candidate_lookup',
      keyword: 'Replacement News',
    })

    expect(emptySourceResult.status).toBe('executed')
    expect(emptySourceResult.decision.queryResult).toMatchObject({
      kind: 'candidate_lookup',
      totalCount: 0,
      candidates: [],
    })
    expect(emptySourceResult.decision.constraintReport).toMatchObject({
      ok: true,
      issues: [],
    })
    expect(emptySourceResult.decision.auditSummary).toMatchObject({
      outcome: 'read_only',
      contextSources: {
        candidates: {
          source: 'program_candidate_reader',
          available: true,
          recordCount: 0,
        },
      },
    })
  })

  it('reports missing schedule source evidence for schedule queries without treating it as an empty playlist', async () => {
    const dataGateway = new RuntimeSchedulingDataGateway({
      scheduleState: buildScheduleState({ playlistType: 'tv' }),
      reader: {
        getScheduleItems: async () => {
          throw new Error('schedule reader timeout')
        },
        getProgramCandidates: () => [buildCandidate()],
      },
    })
    const runtime = new SchedulingAgentRuntime({ dataGateway })

    const result = await submit(runtime, 'show current schedule', {
      intent: 'query',
      confidence: 1,
      source: 'test',
      queryKind: 'schedule_summary',
    })

    expect(result.status).toBe('executed')
    expect(result.decision.queryResult).toMatchObject({
      kind: 'schedule_summary',
      totalCount: 0,
      scheduleItems: [],
    })
    expect(result.decision.constraintReport).toMatchObject({
      ok: false,
      issues: [
        expect.objectContaining({
          code: 'schedule_source_missing',
          severity: 'critical',
          detail: expect.objectContaining({
            source: 'none',
            available: false,
            recordCount: 0,
            errorCode: 'read_failed',
          }),
        }),
      ],
    })
    expect(result.explanation).toContain('Current playlist source is missing')
    expect(result.decision.auditSummary).toMatchObject({
      outcome: 'read_only',
      constraintIssueCodes: ['schedule_source_missing'],
      contextSources: {
        today: {
          source: 'none',
          available: false,
          recordCount: 0,
          errorCode: 'read_failed',
        },
      },
    })
  })

  it('matches candidate hints through searchable facets across candidate metadata fields', async () => {
    const { dataGateway, runtime } = buildRuntime({
      playlistType: 'tv',
      candidates: [
        buildCandidate({
          id: 'candidate-city-lens',
          programCode: 'PROMO001',
          programName: 'City Lens',
          instanceName: 'City Lens',
          columnName: 'Tourism',
          programType: 'promo',
          contentTags: ['Shanghai', 'famous tourist attractions', 'promotional video'],
        }),
        buildCandidate({
          id: 'candidate-city-weather',
          programCode: 'WEATHER001',
          programName: 'City Weather',
          instanceName: 'City Weather',
          columnName: 'Weather',
          programType: 'service',
          contentTags: ['Shanghai', 'forecast'],
        }),
      ],
    })

    const result = await submit(runtime, 'insert Shanghai famous tourist attractions promotional video at 10:00', {
      intent: 'insert',
      confidence: 1,
      source: 'test',
      slots: {
        targetTime: '10:00:00',
        programHint: 'Shanghai famous tourist attractions promotional video',
      },
    })

    expect(result.status).toBe('executed')
    expect(result.decision.command).toMatchObject({
      intent: 'insert',
      candidateId: 'candidate-city-lens',
    })
    expect(result.decision.candidateSelection).toMatchObject({
      method: 'candidate_judge_llm',
      source: 'fallback',
      selectedCandidateId: 'candidate-city-lens',
    })
    expect(result.decision.auditSummary?.contextSources?.candidates.query).toMatchObject({
      keyword: 'Shanghai famous tourist attractions promotional video',
      facets: ['shanghai', 'famous', 'tourist', 'attractions', 'promotional', 'video'],
    })
    expect(result.decision.auditSummary?.keyPoints).toEqual(
      expect.arrayContaining([
        expect.stringContaining('facets=shanghai|famous|tourist|attractions|promotional|video'),
      ]),
    )

    const context = await dataGateway.loadContext({ userInput: '', channelId, date })
    expect(context.scheduleItems).toHaveLength(1)
    expect(context.scheduleItems[0]).toMatchObject({
      programCode: 'PROMO001',
      programName: 'City Lens',
    })
  })

  it('uses searchable facets for candidate lookup without committing schedule changes', async () => {
    const { dataGateway, runtime } = buildRuntime({
      playlistType: 'rotation',
      rotationStrategy: 'content_match',
      items: [buildItem()],
      candidates: [
        buildCandidate({
          id: 'candidate-city-lens',
          programCode: 'PROMO001',
          programName: 'City Lens',
          instanceName: 'City Lens',
          columnName: 'Tourism',
          programType: 'promo',
          contentTags: ['Shanghai', 'famous tourist attractions', 'promotional video'],
        }),
        buildCandidate({
          id: 'candidate-city-weather',
          programCode: 'WEATHER001',
          programName: 'City Weather',
          instanceName: 'City Weather',
          columnName: 'Weather',
          programType: 'service',
          contentTags: ['Shanghai', 'forecast'],
        }),
      ],
    })

    const result = await submit(runtime, 'find Shanghai famous tourist attractions promotional video', {
      intent: 'query',
      confidence: 1,
      source: 'test',
      queryKind: 'candidate_lookup',
      keyword: 'Shanghai famous tourist attractions promotional video',
    })

    expect(result.status).toBe('executed')
    expect(result.decision.queryResult).toMatchObject({
      kind: 'candidate_lookup',
      totalCount: 1,
      candidates: [{ id: 'candidate-city-lens' }],
    })
    expect(result.decision.auditSummary?.outcome).toBe('read_only')
    expect(result.decision.auditSummary?.contextSources?.candidates.query).toMatchObject({
      keyword: 'Shanghai famous tourist attractions promotional video',
      facets: ['shanghai', 'famous', 'tourist', 'attractions', 'promotional', 'video'],
    })

    const context = await dataGateway.loadContext({ userInput: '', channelId, date })
    expect(context.scheduleItems).toHaveLength(1)
  })

  it('finds program-code-less short clips by title and content tags for rotation playlists', async () => {
    const clipCandidate = buildCandidate({
      id: 'asset-short-city-flower',
      programId: 'asset-short-city-flower',
      programCode: '',
      programName: '城市微短片：春日花路 30秒',
      instanceName: '城市微短片：春日花路 30秒',
      columnId: 'rotation-promo',
      columnName: '轮播短片',
      duration: 30,
      programType: 'short_clip',
      contentTags: ['城市形象', '春日花路', '短片', '无节目编号', '轮播'],
    })
    const { dataGateway, runtime } = buildRuntime({
      playlistType: 'rotation',
      rotationStrategy: 'content_match',
      candidates: [
        clipCandidate,
        buildCandidate({
          id: 'candidate-regular-news',
          programCode: 'NEWS1000',
          programName: 'Regular News',
          instanceName: 'Regular News',
          contentTags: ['news'],
        }),
      ],
    })

    const lookup = await submit(runtime, '找城市形象春日花路短片', {
      intent: 'query',
      confidence: 1,
      source: 'test',
      queryKind: 'candidate_lookup',
      keyword: '城市形象春日花路短片',
    })

    expect(lookup.status).toBe('executed')
    expect(lookup.decision.queryResult).toMatchObject({
      kind: 'candidate_lookup',
      totalCount: 1,
      candidates: [{
        id: 'asset-short-city-flower',
        programCode: '',
      }],
    })

    const first = await submit(runtime, '10点插入城市形象春日花路短片', {
      intent: 'insert',
      confidence: 1,
      source: 'test',
      slots: {
        targetTime: '10:00:00',
        programHint: '城市形象春日花路短片',
      },
    })

    expect(first.status).toBe('needs_confirmation')
    expect(first.decision.command).toMatchObject({
      intent: 'insert',
      candidateId: 'asset-short-city-flower',
    })
    expect(first.decision.candidateSelection).toMatchObject({
      method: 'candidate_judge_llm',
      source: 'fallback',
      selectedCandidateId: 'asset-short-city-flower',
    })
    expect(first.decision.auditSummary?.contextSources?.candidates.query).toMatchObject({
      keyword: '城市形象春日花路短片',
    })

    const result = await runtime.submit({
      userInput: '确认',
      channelId,
      date,
      pendingTask: first.decision.pendingTask,
      interpretation: {
        intent: 'insert',
        pendingAction: 'confirm',
        confidence: 1,
        source: 'test',
      },
    })

    expect(result.status).toBe('executed')
    expect(result.decision.command).toMatchObject({
      intent: 'insert',
      candidateId: 'asset-short-city-flower',
    })

    const context = await dataGateway.loadContext({ userInput: '', channelId, date })
    expect(context.scheduleItems).toHaveLength(1)
    expect(context.scheduleItems[0]).toMatchObject({
      programCode: '',
      programName: '城市微短片：春日花路 30秒',
      programType: 'short_clip',
      duration: 30,
      contentTags: expect.arrayContaining(['无节目编号', '轮播']),
    })
  })

  it('keeps validate commands read-only while returning constraint evidence', async () => {
    const { dataGateway, runtime } = buildRuntime({
      playlistType: 'tv',
      items: [
        buildItem({ endTime: '09:45:00', duration: 2700 }),
        buildItem({
          id: 'item-0930',
          programCode: 'NEWS0930',
          programName: 'Mid Morning News',
          startTime: '09:30:00',
          endTime: '10:00:00',
          duration: 1800,
          sequence: 2,
        }),
      ],
    })

    const result = await submit(runtime, 'validate current schedule', {
      intent: 'validate',
      confidence: 1,
      source: 'test',
    })

    expect(result.status).toBe('executed')
    expect(result.validationReport?.ok).toBe(false)
    expect(result.decision.auditSummary).toMatchObject({
      outcome: 'read_only',
      constraintIssueCodes: ['time_overlap'],
    })

    const context = await dataGateway.loadContext({ userInput: '', channelId, date })
    expect(context.scheduleItems).toHaveLength(2)
  })

  it('reports incomplete validation evidence when runtime history and constraint sources are missing', async () => {
    const dataGateway = new RuntimeSchedulingDataGateway({
      scheduleState: buildScheduleState({ playlistType: 'tv' }),
      reader: {
        getScheduleItems: () => [buildItem()],
      },
    })
    const runtime = new SchedulingAgentRuntime({ dataGateway })

    const result = await submit(runtime, 'validate current schedule', {
      intent: 'validate',
      confidence: 1,
      source: 'test',
    })

    expect(result.status).toBe('executed')
    expect(result.validationReport?.ok).toBe(true)
    expect(result.validationReport?.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'constraint_source_missing',
        severity: 'warning',
        detail: expect.objectContaining({
          source: 'none',
          available: false,
          recordCount: 0,
        }),
      }),
      expect.objectContaining({
        code: 'history_source_missing',
        severity: 'warning',
        detail: expect.objectContaining({
          source: 'none',
          available: false,
          recordCount: 0,
        }),
      }),
    ]))
    expect(result.decision.auditSummary).toMatchObject({
      outcome: 'read_only',
      contextSources: {
        today: {
          source: 'runtime_schedule_reader',
          available: true,
          recordCount: 1,
        },
        history: {
          source: 'none',
          available: false,
          recordCount: 0,
        },
        constraints: {
          source: 'none',
          available: false,
          recordCount: 0,
        },
      },
      constraintIssueCodes: ['constraint_source_missing', 'history_source_missing'],
    })

    const context = await dataGateway.loadContext({ userInput: '', channelId, date })
    expect(context.scheduleItems).toHaveLength(1)
  })
})
