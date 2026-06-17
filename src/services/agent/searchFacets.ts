import type { AgentSubmitInput, SchedulingContextSourceQueryEvidence } from './types'

export const buildSearchFacets = (value: string): string[] => {
  const normalizedWhole = normalizeSearchFacet(value)
  const tokens = value
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fff]+/u)
    .map((token) => normalizeSearchFacet(token))
    .filter((token) => token.length > 1 && !isSearchStopword(token))
  const facets = tokens.length > 1 ? tokens : [normalizedWhole]
  return Array.from(new Set(facets.filter(Boolean)))
}

export const buildCandidateQueryEvidence = (
  input: AgentSubmitInput,
): SchedulingContextSourceQueryEvidence | undefined => {
  const interpretation = input.interpretation
  const keyword = resolveCandidateKeyword(input)
  if (!keyword) return undefined
  return {
    keyword,
    facets: Array.from(new Set([
      ...buildSearchFacets(keyword),
      ...(interpretation?.searchAlternatives ?? []).flatMap((alternative) => buildSearchFacets(alternative)),
    ])).slice(0, 12),
  }
}

const resolveCandidateKeyword = (input: AgentSubmitInput): string | undefined => {
  const interpretation = input.interpretation
  const slots = interpretation?.slots
  if (!interpretation?.intent) return undefined

  if (interpretation.intent === 'insert') return cleanKeyword(slots?.programHint)
  if (interpretation.intent === 'replace') return cleanKeyword(slots?.replacementHint)
  if (interpretation.intent === 'query' && interpretation.queryKind === 'candidate_lookup') {
    return cleanKeyword(interpretation.keyword ?? slots?.programHint ?? slots?.replacementHint ?? slots?.targetProgramName)
  }
  return undefined
}

const cleanKeyword = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

const isSearchStopword = (value: string): boolean => new Set([
  'a',
  'an',
  'the',
  'at',
  'to',
  'for',
  'of',
  'in',
  'on',
  'with',
  'and',
  'or',
  'insert',
  'add',
  'find',
  'search',
  'candidate',
  'candidates',
  'program',
  'episode',
  'item',
  'slot',
  'please',
  'need',
  'want',
]).has(value)

const normalizeSearchFacet = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '')
