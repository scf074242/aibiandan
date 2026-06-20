import { describe, expect, it } from 'vitest'

import {
  buildColumnRetrievalConstraintKeyword,
  compileSearchKeywordsWithColumnConstraint,
  parseDraftConstraintText,
  resolveFormalOrchestrationSearchKeywords,
} from '@/services/retrievalConstraintCompiler'

describe('retrievalConstraintCompiler', () => {
  it('parses explicit uploaded draft constraint prefixes without inventing missing kind', () => {
    expect(parseDraftConstraintText('栏目：看东方')).toEqual({ name: '看东方', kind: 'column' })
    expect(parseDraftConstraintText('节目=看东方111期新春特别行动')).toEqual({
      name: '看东方111期新春特别行动',
      kind: 'program',
    })
    expect(parseDraftConstraintText('ShanghaiEye')).toEqual({ name: 'ShanghaiEye' })
  })

  it('builds field-scoped retrieval keywords from draft column constraint kind', () => {
    expect(buildColumnRetrievalConstraintKeyword({
      columnName: '看东方',
      draftConstraintKind: 'column',
    })).toBe('栏目=看东方')
    expect(buildColumnRetrievalConstraintKeyword({
      columnName: '看东方111期新春特别行动',
      draftConstraintKind: 'program',
    })).toBe('节目=看东方111期新春特别行动')
    expect(buildColumnRetrievalConstraintKeyword({
      columnName: 'ShanghaiEye',
      draftConstraintKind: 'unspecified',
    })).toBe('ShanghaiEye')
  })

  it('prepends the structured constraint and deduplicates downstream keywords', () => {
    expect(compileSearchKeywordsWithColumnConstraint(
      ['用户补充', '用户补充', ''],
      {
        columnName: '看东方',
        draftConstraintKind: 'column',
      },
    )).toEqual(['栏目=看东方', '用户补充'])
  })

  it('compiles formal orchestration natural language into column, program, or bare-name constraints', () => {
    expect(resolveFormalOrchestrationSearchKeywords('9点排入栏目看东方')).toEqual(['栏目=看东方'])
    expect(resolveFormalOrchestrationSearchKeywords('下午排入节目看东方111期新春特别行动')).toEqual(['节目=看东方111期新春特别行动'])
    expect(resolveFormalOrchestrationSearchKeywords('12点半安排ShanghaiEye')).toEqual(['ShanghaiEye'])
    expect(resolveFormalOrchestrationSearchKeywords('9点到12点编排东方剧场')).toEqual(['东方剧场'])
    expect(resolveFormalOrchestrationSearchKeywords('下午改成新闻')).toEqual(['新闻'])
    expect(resolveFormalOrchestrationSearchKeywords('下午补齐当前所有空窗')).toEqual([])
  })
})
