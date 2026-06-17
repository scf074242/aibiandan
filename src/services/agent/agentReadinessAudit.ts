import { atomicCommandPolicyIntents } from './playlistPolicy'
import { requiredProfessionalRuleIds } from './professionalRules'
import type { SchedulingAgentRuntimeCapabilitySummary } from './schedulingAgentRuntime'
import type {
  AgentSubmitInput,
  AtomicCommandIntent,
  SchedulingContext,
  SchedulingContextSourceContext,
  SchedulingContextSourceEvidence,
  SchedulingContextSourceKey,
} from './types'

export type AgentReadinessDimensionId = 'commands' | 'playlist_modes' | 'data_sources' | 'safety_gates' | 'professional_rules'
export type AgentReadinessStatus = 'ready' | 'incomplete'

export interface AgentReadinessDimension {
  id: AgentReadinessDimensionId
  ready: number
  total: number
  percent: number
  missing: string[]
}

export interface AgentReadinessCoverage<T extends string> {
  ready: number
  total: number
  required: T[]
  present: T[]
  missing: T[]
}

export interface SchedulingAgentV1ReadinessAudit {
  status: AgentReadinessStatus
  percent: number
  commandCoverage: {
    ready: number
    total: number
    intents: AtomicCommandIntent[]
    missing: AtomicCommandIntent[]
  }
  playlistModeCoverage: AgentReadinessCoverage<string>
  dataSourceCoverage: AgentReadinessCoverage<SchedulingContextSourceKey>
  safetyGateCoverage: AgentReadinessCoverage<string>
  professionalRuleCoverage: AgentReadinessCoverage<string>
  dimensions: AgentReadinessDimension[]
  gaps: string[]
}

export type SchedulingAgentOperationalStatus = 'ready' | 'limited' | 'blocked'
export type SchedulingAgentCommandOperationalStatus = 'ready' | 'advisory' | 'blocked'

export type SchedulingAgentOperationalReadinessInput =
  Pick<AgentSubmitInput, 'channelId' | 'date' | 'playlistId' | 'conversationId'>
  & Partial<Pick<AgentSubmitInput, 'userInput'>>

export interface SchedulingAgentSourceOperationalReadiness {
  sourceKey: SchedulingContextSourceKey
  available: boolean
  status: SchedulingContextSourceEvidence['status']
  source: SchedulingContextSourceEvidence['source']
  recordCount: number
  version?: string
  errorCode?: string
  errorMessage?: string
}

export interface SchedulingAgentCommandOperationalReadiness {
  intent: AtomicCommandIntent
  status: SchedulingAgentCommandOperationalStatus
  executionMode: string
  blockingSources: SchedulingContextSourceKey[]
  advisorySources: SchedulingContextSourceKey[]
}

export type SchedulingAgentCommandRequirementStatus = 'ready' | 'blocking' | 'advisory'

export interface SchedulingAgentCommandSourceRequirementReadiness {
  sourceKey: SchedulingContextSourceKey
  status: SchedulingAgentCommandRequirementStatus
  missingBehavior: SchedulingAgentRuntimeCapabilitySummary['dataRequirements'][number]['missingBehavior']
  guardCode?: string
  description: string
  source: SchedulingContextSourceEvidence['source']
  sourceStatus: SchedulingContextSourceEvidence['status']
  available: boolean
  recordCount: number
}

export interface SchedulingAgentCommandRequirementReadiness {
  intent: AtomicCommandIntent
  executionMode: string
  status: SchedulingAgentCommandOperationalStatus
  requirements: SchedulingAgentCommandSourceRequirementReadiness[]
}

export type SchedulingAgentProfessionalRuleRuntimeEffect =
  | 'blocking_guard'
  | 'confirmation_guard'
  | 'preference'
  | 'warning'
  | 'audit'
  | 'pass'

export type SchedulingAgentProfessionalRuleEvidenceStatus = 'ready' | 'partial'

export interface SchedulingAgentProfessionalRuleReadiness {
  ruleId: string
  effect: SchedulingAgentProfessionalRuleRuntimeEffect
  evidenceStatus: SchedulingAgentProfessionalRuleEvidenceStatus
  sourceKeys: SchedulingContextSourceKey[]
  missingSourceKeys: SchedulingContextSourceKey[]
  description: string
}

export interface SchedulingAgentCommandProfessionalRuleReadiness {
  intent: AtomicCommandIntent
  executionMode: string
  rules: SchedulingAgentProfessionalRuleReadiness[]
}

export interface SchedulingAgentProfessionalRuleEffectSummary {
  blockingGuardCount: number
  confirmationGuardCount: number
  warningCount: number
  preferenceCount: number
  auditCount: number
  passCount: number
  partialEvidenceCount: number
  commandCountWithRules: number
}

export interface SchedulingAgentOperationalReadinessAudit {
  status: SchedulingAgentOperationalStatus
  executablePercent: number
  executableCommands: number
  totalCommands: number
  playlistType: SchedulingContext['playlistType']
  sourceCoverage: SchedulingAgentSourceOperationalReadiness[]
  commandReadiness: SchedulingAgentCommandOperationalReadiness[]
  commandRequirementReadiness: SchedulingAgentCommandRequirementReadiness[]
  commandProfessionalRuleReadiness: SchedulingAgentCommandProfessionalRuleReadiness[]
  professionalRuleEffectSummary: SchedulingAgentProfessionalRuleEffectSummary
  gaps: string[]
}

const requiredSourceKeys: Array<keyof SchedulingContextSourceContext> = [
  'today',
  'candidates',
  'readiness',
  'history',
  'constraints',
  'policy',
]

const requiredSafetyGateIds = [
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
]

const requiredPlaylistModeCoverage = [
  'tv:direct_execute',
  'tv:confirm_before_commit',
  'tv:read_only',
  'rotation:direct_execute',
  'rotation:confirm_before_commit',
  'rotation:read_only',
]

export const auditSchedulingAgentV1Readiness = (
  summary: SchedulingAgentRuntimeCapabilitySummary,
): SchedulingAgentV1ReadinessAudit => {
  const commandIntents = summary.commandPolicies.map((policy) => policy.intent)
  const commandMissing = atomicCommandPolicyIntents.filter((intent) => !commandIntents.includes(intent))

  const sourceKeys = summary.dataRequirements.map((requirement) => requirement.sourceKey)
  const sourceMissing = requiredSourceKeys.filter((sourceKey) => !sourceKeys.includes(sourceKey))

  const safetyGateIds = summary.safetyGates.map((gate) => gate.id)
  const safetyGateMissing = requiredSafetyGateIds.filter((gateId) => !safetyGateIds.includes(gateId))

  const professionalRuleIds = summary.professionalRules.map((rule) => rule.id)
  const professionalRuleMissing = requiredProfessionalRuleIds.filter((ruleId) => !professionalRuleIds.includes(ruleId))

  const modeKeys = new Set(summary.commandPolicies.flatMap((policy) => [
    `tv:${policy.tvMode}`,
    `rotation:${policy.rotationMode}`,
  ]))
  const playlistModeMissing = requiredPlaylistModeCoverage.filter((modeKey) => !modeKeys.has(modeKey))

  const dimensions: AgentReadinessDimension[] = [
    buildDimension('commands', atomicCommandPolicyIntents.length - commandMissing.length, atomicCommandPolicyIntents.length, commandMissing),
    buildDimension('playlist_modes', requiredPlaylistModeCoverage.length - playlistModeMissing.length, requiredPlaylistModeCoverage.length, playlistModeMissing),
    buildDimension('data_sources', requiredSourceKeys.length - sourceMissing.length, requiredSourceKeys.length, sourceMissing.map(String)),
    buildDimension('safety_gates', requiredSafetyGateIds.length - safetyGateMissing.length, requiredSafetyGateIds.length, safetyGateMissing),
    buildDimension('professional_rules', requiredProfessionalRuleIds.length - professionalRuleMissing.length, requiredProfessionalRuleIds.length, professionalRuleMissing),
  ]

  const gaps = dimensions.flatMap((dimension) =>
    dimension.missing.map((missing) => `${dimension.id}:${missing}`),
  )

  return {
    status: gaps.length === 0 ? 'ready' : 'incomplete',
    percent: calculateWeightedPercent(dimensions),
    commandCoverage: {
      ready: atomicCommandPolicyIntents.length - commandMissing.length,
      total: atomicCommandPolicyIntents.length,
      intents: atomicCommandPolicyIntents.map((intent) => intent),
      missing: commandMissing,
    },
    playlistModeCoverage: buildCoverage(requiredPlaylistModeCoverage, Array.from(modeKeys), playlistModeMissing),
    dataSourceCoverage: buildCoverage(requiredSourceKeys, sourceKeys, sourceMissing),
    safetyGateCoverage: buildCoverage(requiredSafetyGateIds, safetyGateIds, safetyGateMissing),
    professionalRuleCoverage: buildCoverage(requiredProfessionalRuleIds, professionalRuleIds, professionalRuleMissing),
    dimensions,
    gaps,
  }
}

export const auditSchedulingAgentOperationalReadiness = (
  summary: SchedulingAgentRuntimeCapabilitySummary,
  context: SchedulingContext,
): SchedulingAgentOperationalReadinessAudit => {
  const sourceCoverage = requiredSourceKeys.map((sourceKey) =>
    buildSourceOperationalReadiness(sourceKey, context.bundle.sources[sourceKey]),
  )

  const commandRequirementReadiness: SchedulingAgentCommandRequirementReadiness[] = summary.commandPolicies.map((policy) => {
    const requirements = summary.dataRequirements.filter((requirement) =>
      requirement.requiredFor.includes(policy.intent),
    )
    const executionMode = context.playlistType === 'rotation' ? policy.rotationMode : policy.tvMode
    const requirementReadiness = requirements.map((requirement) => {
      const source = context.bundle.sources[requirement.sourceKey]
      return buildCommandSourceRequirementReadiness(requirement, source, executionMode)
    })
    const blockingSources = requirementReadiness
      .filter((requirement) => requirement.status === 'blocking')
      .map((requirement) => requirement.sourceKey)
    const advisorySources = requirementReadiness
      .filter((requirement) => requirement.status === 'advisory')
      .map((requirement) => requirement.sourceKey)

    const status: SchedulingAgentCommandOperationalStatus = blockingSources.length > 0
      ? 'blocked'
      : advisorySources.length > 0
        ? 'advisory'
        : 'ready'

    return {
      intent: policy.intent,
      status,
      executionMode,
      requirements: requirementReadiness,
    }
  })

  const commandReadiness: SchedulingAgentCommandOperationalReadiness[] = commandRequirementReadiness.map((command) => {
    const blockingSources = command.requirements
      .filter((requirement) => requirement.status === 'blocking')
      .map((requirement) => requirement.sourceKey)
    const advisorySources = command.requirements
      .filter((requirement) => requirement.status === 'advisory')
      .map((requirement) => requirement.sourceKey)

    return {
      intent: command.intent,
      status: command.status,
      executionMode: command.executionMode,
      blockingSources,
      advisorySources,
    }
  })

  const commandProfessionalRuleReadiness: SchedulingAgentCommandProfessionalRuleReadiness[] = summary.commandPolicies.map((policy) => {
    const executionMode = context.playlistType === 'rotation' ? policy.rotationMode : policy.tvMode
    const rules = summary.professionalRules
      .filter((rule) => rule.appliesTo.includes(policy.intent as Extract<AtomicCommandIntent, 'insert' | 'replace'>))
      .map((rule) => {
        const missingSourceKeys = rule.sourceKeys.filter((sourceKey) =>
          !isSourceOperational(context.bundle.sources[sourceKey]),
        )
        const mode = context.playlistType === 'rotation' ? rule.rotationMode : rule.tvMode
        return {
          ruleId: rule.id,
          effect: mapProfessionalRuleRuntimeEffect(mode),
          evidenceStatus: missingSourceKeys.length > 0 ? 'partial' as const : 'ready' as const,
          sourceKeys: rule.sourceKeys.map((sourceKey) => sourceKey),
          missingSourceKeys,
          description: rule.description,
        }
      })

    return {
      intent: policy.intent,
      executionMode,
      rules,
    }
  })

  const executableCommands = commandReadiness.filter((command) => command.status !== 'blocked').length
  const professionalRuleEffectSummary = buildProfessionalRuleEffectSummary(commandProfessionalRuleReadiness)
  const gaps = commandReadiness.flatMap((command) => [
    ...command.blockingSources.map((sourceKey) => `${command.intent}:blocked:${sourceKey}`),
    ...command.advisorySources.map((sourceKey) => `${command.intent}:advisory:${sourceKey}`),
  ])

  return {
    status: commandReadiness.some((command) => command.status === 'blocked')
      ? 'blocked'
      : commandReadiness.some((command) => command.status === 'advisory')
        ? 'limited'
        : 'ready',
    executablePercent: Math.round((executableCommands / commandReadiness.length) * 100),
    executableCommands,
    totalCommands: commandReadiness.length,
    playlistType: context.playlistType,
    sourceCoverage,
    commandReadiness,
    commandRequirementReadiness,
    commandProfessionalRuleReadiness,
    professionalRuleEffectSummary,
    gaps,
  }
}

const buildDimension = (
  id: AgentReadinessDimensionId,
  ready: number,
  total: number,
  missing: string[],
): AgentReadinessDimension => ({
  id,
  ready,
  total,
  percent: total > 0 ? Math.round((ready / total) * 100) : 100,
  missing,
})

const buildCoverage = <T extends string>(
  required: readonly T[],
  present: readonly T[],
  missing: readonly T[],
): AgentReadinessCoverage<T> => ({
  ready: required.length - missing.length,
  total: required.length,
  required: required.map((item) => item),
  present: present.filter((item): item is T => required.includes(item as T)),
  missing: missing.map((item) => item),
})

const calculateWeightedPercent = (dimensions: AgentReadinessDimension[]): number => {
  const total = dimensions.reduce((sum, dimension) => sum + dimension.total, 0)
  if (!total) return 100

  const ready = dimensions.reduce((sum, dimension) => sum + dimension.ready, 0)
  return Math.round((ready / total) * 100)
}

const buildSourceOperationalReadiness = (
  sourceKey: SchedulingContextSourceKey,
  source: SchedulingContextSourceEvidence,
): SchedulingAgentSourceOperationalReadiness => ({
  sourceKey,
  available: source.available,
  status: source.status,
  source: source.source,
  recordCount: source.recordCount,
  version: source.version,
  errorCode: source.errorCode,
  errorMessage: source.errorMessage,
})

const buildCommandSourceRequirementReadiness = (
  requirement: SchedulingAgentRuntimeCapabilitySummary['dataRequirements'][number],
  source: SchedulingContextSourceEvidence,
  executionMode: string,
): SchedulingAgentCommandSourceRequirementReadiness => {
  const operational = isSourceOperational(source)
  const status: SchedulingAgentCommandRequirementStatus = operational
    ? 'ready'
    : requirement.missingBehavior === 'block_write' && executionMode !== 'read_only'
      ? 'blocking'
      : 'advisory'

  return {
    sourceKey: requirement.sourceKey,
    status,
    missingBehavior: requirement.missingBehavior,
    guardCode: requirement.guardCode,
    description: requirement.description,
    source: source.source,
    sourceStatus: source.status,
    available: source.available,
    recordCount: source.recordCount,
  }
}

const isSourceOperational = (source: SchedulingContextSourceEvidence): boolean =>
  source.available && source.status !== 'missing' && source.status !== 'unavailable'

const buildProfessionalRuleEffectSummary = (
  commands: SchedulingAgentCommandProfessionalRuleReadiness[],
): SchedulingAgentProfessionalRuleEffectSummary => {
  const rules = commands.flatMap((command) => command.rules)
  return {
    blockingGuardCount: rules.filter((rule) => rule.effect === 'blocking_guard').length,
    confirmationGuardCount: rules.filter((rule) => rule.effect === 'confirmation_guard').length,
    warningCount: rules.filter((rule) => rule.effect === 'warning').length,
    preferenceCount: rules.filter((rule) => rule.effect === 'preference').length,
    auditCount: rules.filter((rule) => rule.effect === 'audit').length,
    passCount: rules.filter((rule) => rule.effect === 'pass').length,
    partialEvidenceCount: rules.filter((rule) => rule.evidenceStatus === 'partial').length,
    commandCountWithRules: commands.filter((command) => command.rules.length > 0).length,
  }
}

const mapProfessionalRuleRuntimeEffect = (
  mode: SchedulingAgentRuntimeCapabilitySummary['professionalRules'][number]['tvMode']
    | SchedulingAgentRuntimeCapabilitySummary['professionalRules'][number]['rotationMode'],
): SchedulingAgentProfessionalRuleRuntimeEffect => {
  switch (mode) {
    case 'block':
      return 'blocking_guard'
    case 'confirm':
      return 'confirmation_guard'
    case 'prefer':
      return 'preference'
    case 'warn':
      return 'warning'
    case 'audit':
      return 'audit'
    case 'pass':
    default:
      return 'pass'
  }
}
