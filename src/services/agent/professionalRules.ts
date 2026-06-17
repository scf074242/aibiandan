import type { AtomicCommandIntent, SchedulingContextSourceContext } from './types'

export interface SchedulingAgentRuntimeProfessionalRule {
  id: string
  appliesTo: Extract<AtomicCommandIntent, 'insert' | 'replace'>[]
  sourceKeys: Array<keyof SchedulingContextSourceContext>
  tvMode: 'block' | 'prefer' | 'pass' | 'warn' | 'audit'
  rotationMode: 'confirm' | 'prefer' | 'pass' | 'warn' | 'audit'
  description: string
}

const professionalRuleCatalog: SchedulingAgentRuntimeProfessionalRule[] = [
  {
    id: 'material_readiness',
    appliesTo: ['insert', 'replace'],
    sourceKeys: ['readiness', 'candidates'],
    tvMode: 'block',
    rotationMode: 'confirm',
    description: 'Material readiness must be ready before candidate writes can be committed or confirmed.',
  },
  {
    id: 'rights_readiness',
    appliesTo: ['insert', 'replace'],
    sourceKeys: ['readiness', 'candidates'],
    tvMode: 'block',
    rotationMode: 'confirm',
    description: 'Rights readiness must be ready before candidate writes can be committed or confirmed.',
  },
  {
    id: 'playlist_policy',
    appliesTo: ['insert', 'replace'],
    sourceKeys: ['policy', 'constraints'],
    tvMode: 'pass',
    rotationMode: 'confirm',
    description: 'TV candidate writes may commit after deterministic checks; rotation candidate writes require confirmation.',
  },
  {
    id: 'content_alignment',
    appliesTo: ['insert', 'replace'],
    sourceKeys: ['candidates'],
    tvMode: 'prefer',
    rotationMode: 'prefer',
    description: 'Candidate metadata is scored against the structured user intent and search facets.',
  },
  {
    id: 'time_slot_fit',
    appliesTo: ['insert', 'replace'],
    sourceKeys: ['candidates', 'policy'],
    tvMode: 'warn',
    rotationMode: 'warn',
    description: 'Candidate type is scored against morning information slots, prime time, and late-night slot duties; explicit atomic commands are not blocked by slot-duty preferences.',
  },
  {
    id: 'neighbor_column_fit',
    appliesTo: ['insert', 'replace'],
    sourceKeys: ['today', 'candidates'],
    tvMode: 'warn',
    rotationMode: 'warn',
    description: 'Neighboring programmes provide column and programme-type continuity evidence.',
  },
  {
    id: 'replacement_duty_fit',
    appliesTo: ['replace'],
    sourceKeys: ['today', 'candidates', 'policy'],
    tvMode: 'warn',
    rotationMode: 'warn',
    description: 'Replacement candidates should preserve the target slot column or programme-type responsibility; mismatches are ranking evidence, not hard blockers for explicit replacement.',
  },
  {
    id: 'duration_fit',
    appliesTo: ['insert', 'replace'],
    sourceKeys: ['today', 'candidates'],
    tvMode: 'warn',
    rotationMode: 'warn',
    description: 'Candidate duration is compared with same-type items already scheduled today.',
  },
  {
    id: 'same_day_duplicate',
    appliesTo: ['insert', 'replace'],
    sourceKeys: ['today', 'candidates', 'policy'],
    tvMode: 'block',
    rotationMode: 'warn',
    description: 'Exact same-day programme asset duplicates are blocked for TV and reviewed for rotation.',
  },
  {
    id: 'recent_replay_interval',
    appliesTo: ['insert', 'replace'],
    sourceKeys: ['history', 'candidates', 'policy'],
    tvMode: 'block',
    rotationMode: 'warn',
    description: 'Recent historical exact replays are blocked for TV and reviewed for rotation.',
  },
  {
    id: 'rotation_priority',
    appliesTo: ['insert', 'replace'],
    sourceKeys: ['policy', 'candidates'],
    tvMode: 'audit',
    rotationMode: 'prefer',
    description: 'Rotation candidate ranking can prefer rating, trending, or content-match strategy signals.',
  },
]

export const professionalRuleIds = professionalRuleCatalog.map((rule) => rule.id)

export const requiredProfessionalRuleIds = [...professionalRuleIds]

export const listProfessionalRules = (): SchedulingAgentRuntimeProfessionalRule[] =>
  professionalRuleCatalog.map((rule) => ({
    ...rule,
    appliesTo: [...rule.appliesTo],
    sourceKeys: [...rule.sourceKeys],
  }))
