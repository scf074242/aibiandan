import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { agentWorkflowBrowserCases, agentWorkflowPreconditionAudits } from './fixtures/agentWorkflowBrowserCases'
import { LayoutImportService } from '@/services/layoutImportService'

const uploadFixturePath = resolve(process.cwd(), 'test-fixtures/browser/smg-weekday-layout.xlsx')

describe('agentWorkflowBrowserCases', () => {
  it('每条浏览器用例都有可复现的前置数据和准备步骤', () => {
    const ids = new Set<string>()

    agentWorkflowBrowserCases.forEach((browserCase) => {
      expect(ids.has(browserCase.id), `${browserCase.id} should be unique`).toBe(false)
      ids.add(browserCase.id)

      expect(browserCase.requiresBrowser).toBe(true)
      expect(browserCase.preconditions.length, `${browserCase.id} preconditions`).toBeGreaterThan(0)
      expect(browserCase.dataRequirements.length, `${browserCase.id} dataRequirements`).toBeGreaterThan(0)
      expect(browserCase.setupSteps.length, `${browserCase.id} setupSteps`).toBeGreaterThan(0)
      expect(browserCase.userSteps.length, `${browserCase.id} userSteps`).toBeGreaterThan(0)
      expect(browserCase.expectedDecisions.length, `${browserCase.id} expectedDecisions`).toBeGreaterThan(0)
      expect(browserCase.expectedUiAssertions.length, `${browserCase.id} expectedUiAssertions`).toBeGreaterThan(0)
      expect(browserCase.expectedDataAssertions.length, `${browserCase.id} expectedDataAssertions`).toBeGreaterThan(0)
    })
  })

  it('覆盖核心能力分类', () => {
    const categories = new Set(agentWorkflowBrowserCases.map((browserCase) => browserCase.category))

    expect(categories).toEqual(new Set([
      'atomic_intent',
      'layout_draft',
      'layout_plan_to_schedule',
      'special_combo',
      'context_management',
    ]))
  })

  it('每条浏览器用例都有明确的前置状态审查记录', () => {
    const caseIds = new Set(agentWorkflowBrowserCases.map((browserCase) => browserCase.id))
    const auditIds = new Set(agentWorkflowPreconditionAudits.map((audit) => audit.caseId))

    expect(auditIds).toEqual(caseIds)

    agentWorkflowPreconditionAudits.forEach((audit) => {
      expect(audit.blockingData.length, `${audit.caseId} blockingData`).toBeGreaterThan(0)
      expect(audit.setupRecipe.length, `${audit.caseId} setupRecipe`).toBeGreaterThan(0)
      expect(audit.verificationGate.trim(), `${audit.caseId} verificationGate`).not.toBe('')
      expect(['ready', 'needs_seed_data', 'tool_limited']).toContain(audit.readiness)

      audit.dependsOnCaseIds.forEach((dependencyId) => {
        expect(caseIds.has(dependencyId), `${audit.caseId} dependency ${dependencyId}`).toBe(true)
      })

      if (audit.canRunStandalone) {
        expect(audit.dependsOnCaseIds, `${audit.caseId} standalone dependency`).toHaveLength(0)
      } else {
        expect(audit.dependsOnCaseIds.length, `${audit.caseId} dependent setup`).toBeGreaterThan(0)
      }
    })
  })

  it('前置状态覆盖空表、上传版面、已生成节目和保护性局部补排', () => {
    const profiles = new Set(agentWorkflowPreconditionAudits.map((audit) => audit.stateProfile))

    expect(profiles).toEqual(new Set([
      'clean_page_baseline',
      'seeded_layout_draft',
      'uploaded_layout_pending',
      'empty_schedule',
      'generated_schedule',
      'protected_partial_schedule',
    ]))
  })

  it('前置审查区分已就绪、需造数和工具受限用例', () => {
    const readiness = new Set(agentWorkflowPreconditionAudits.map((audit) => audit.readiness))
    const toolLimitedCases = agentWorkflowPreconditionAudits
      .filter((audit) => audit.readiness === 'tool_limited')
      .map((audit) => audit.caseId)

    expect(readiness).toEqual(new Set(['ready', 'needs_seed_data', 'tool_limited']))
    expect(toolLimitedCases).toEqual([
      'uploaded-layout-to-schedule-current-date',
      'uploaded-layout-refine-to-schedule',
      'context-upload-clear-removes-layout-reference',
    ])
  })

  it('覆盖已有节目上下文阻止顺播倒序回填的真实浏览器用例', () => {
    const sequenceContextCase = agentWorkflowBrowserCases.find((browserCase) =>
      browserCase.id === 'context-sequence-backfill-before-existing-episode',
    )

    expect(sequenceContextCase).toBeTruthy()
    expect(sequenceContextCase?.requiresBrowser).toBe(true)
    expect(sequenceContextCase?.category).toBe('context_management')
    expect([
      ...(sequenceContextCase?.setupSteps ?? []),
      ...(sequenceContextCase?.expectedDataAssertions ?? []),
    ].join('\n')).toContain('09:00')
    expect(sequenceContextCase?.expectedDataAssertions.join('\n')).toContain('sequence_context_order_conflict')
    expect(sequenceContextCase?.expectedDataAssertions.join('\n')).toContain('08:00')
    expect(sequenceContextCase?.expectedDataAssertions.join('\n')).toContain('第2集')
  })

  it('覆盖原子插入命令读取当前节目单并阻止顺播倒序的真实浏览器用例', () => {
    const insertSequenceCase = agentWorkflowBrowserCases.find((browserCase) =>
      browserCase.id === 'context-atomic-insert-blocks-sequence-reverse-order',
    )
    const insertSequenceAudit = agentWorkflowPreconditionAudits.find((audit) =>
      audit.caseId === 'context-atomic-insert-blocks-sequence-reverse-order',
    )

    expect(insertSequenceCase).toBeTruthy()
    expect(insertSequenceAudit).toBeTruthy()
    expect(insertSequenceCase?.requiresBrowser).toBe(true)
    expect(insertSequenceCase?.category).toBe('context_management')
    expect(insertSequenceCase?.expectedDecisions.join('\n')).toContain('insert 原子命令')
    expect(insertSequenceCase?.expectedUiAssertions.join('\n')).toContain('顺播倒序')
    expect(insertSequenceCase?.expectedDataAssertions.join('\n')).toContain('preview.warnings')
    expect(insertSequenceAudit?.verificationGate).toContain('08:00 不写入第2集')
  })

  it('覆盖当前节目单进度优先于昨日顺播历史的真实浏览器用例', () => {
    const currentProgressCase = agentWorkflowBrowserCases.find((browserCase) =>
      browserCase.id === 'context-current-schedule-overrides-history-sequence',
    )
    const currentProgressAudit = agentWorkflowPreconditionAudits.find((audit) =>
      audit.caseId === 'context-current-schedule-overrides-history-sequence',
    )

    expect(currentProgressCase).toBeTruthy()
    expect(currentProgressAudit).toBeTruthy()
    expect(currentProgressCase?.requiresBrowser).toBe(true)
    expect(currentProgressCase?.category).toBe('context_management')
    expect(currentProgressCase?.setupSteps.join('\n')).toContain('09:00')
    expect(currentProgressCase?.expectedDecisions.join('\n')).toContain('今天左侧已有第5集')
    expect(currentProgressCase?.expectedDataAssertions.join('\n')).toContain('current_schedule_overrides_history')
    expect(currentProgressCase?.expectedDataAssertions.join('\n')).toContain('第6集')
    expect(currentProgressAudit?.verificationGate).toContain('不能重复第5集')
  })

  it('覆盖三小时电视剧长时段持续填充剩余空窗的真实浏览器用例', () => {
    const longDramaCase = agentWorkflowBrowserCases.find((browserCase) =>
      browserCase.id === 'draft-to-schedule-long-drama-continuous-fill',
    )

    expect(longDramaCase).toBeTruthy()
    expect(longDramaCase?.requiresBrowser).toBe(true)
    expect(longDramaCase?.category).toBe('layout_plan_to_schedule')
    expect(longDramaCase?.expectedDecisions.join('\n')).toContain('持续处理剩余空窗')
    expect(longDramaCase?.expectedUiAssertions.join('\n')).toContain('09:45')
    expect(longDramaCase?.expectedUiAssertions.join('\n')).toContain('12:00')
    expect(longDramaCase?.expectedDataAssertions.join('\n')).toContain('未被跳过到后续栏目之后')
    expect(longDramaCase?.expectedDataAssertions.join('\n')).toContain('第8集')
  })

  it('覆盖电视剧短尾时段不足一集时不得越界落表的真实浏览器用例', () => {
    const shortTailCase = agentWorkflowBrowserCases.find((browserCase) =>
      browserCase.id === 'draft-to-schedule-drama-short-tail-no-overflow',
    )
    const shortTailAudit = agentWorkflowPreconditionAudits.find((audit) =>
      audit.caseId === 'draft-to-schedule-drama-short-tail-no-overflow',
    )

    expect(shortTailCase).toBeTruthy()
    expect(shortTailAudit).toBeTruthy()
    expect(shortTailCase?.requiresBrowser).toBe(true)
    expect(shortTailCase?.category).toBe('layout_plan_to_schedule')
    expect(shortTailCase?.expectedDecisions.join('\n')).toContain('剩余 5 分钟不足一整集')
    expect(shortTailCase?.expectedUiAssertions.join('\n')).toContain('不出现“纵有疾风起 第8集”')
    expect(shortTailCase?.expectedDataAssertions.join('\n')).toContain('endTime <= 11:20:00')
    expect(shortTailAudit?.verificationGate).toContain('不能越界写入第8集')
  })

  it('覆盖同系列经验线索交由 LLM 综合判断而非绝对规则的真实浏览器用例', () => {
    const seriesEvidenceCase = agentWorkflowBrowserCases.find((browserCase) =>
      browserCase.id === 'context-series-evidence-llm-judgement',
    )

    expect(seriesEvidenceCase).toBeTruthy()
    expect(seriesEvidenceCase?.requiresBrowser).toBe(true)
    expect(seriesEvidenceCase?.category).toBe('context_management')
    expect(seriesEvidenceCase?.expectedDecisions.join('\n')).toContain('seriesEvidence')
    expect(seriesEvidenceCase?.expectedDecisions.join('\n')).toContain('不是把编号或标题相似当作绝对规则')
    expect(seriesEvidenceCase?.expectedDataAssertions.join('\n')).toContain('干扰候选')
    expect(seriesEvidenceCase?.expectedDataAssertions.join('\n')).toContain('保持空缺')
  })

  it('覆盖轮播单收视优先、热播优先和内容匹配优先的真实浏览器用例', () => {
    const ratingCase = agentWorkflowBrowserCases.find((browserCase) =>
      browserCase.id === 'carousel-rating-priority-to-schedule',
    )
    const trendingCase = agentWorkflowBrowserCases.find((browserCase) =>
      browserCase.id === 'carousel-trending-priority-to-schedule',
    )
    const contentCase = agentWorkflowBrowserCases.find((browserCase) =>
      browserCase.id === 'carousel-content-priority-to-schedule',
    )

    expect(ratingCase).toBeTruthy()
    expect(trendingCase).toBeTruthy()
    expect(contentCase).toBeTruthy()
    expect(ratingCase?.requiresBrowser).toBe(true)
    expect(trendingCase?.requiresBrowser).toBe(true)
    expect(contentCase?.requiresBrowser).toBe(true)
    expect(ratingCase?.expectedDecisions.join('\n')).toContain('selectionPriority=rating')
    expect(ratingCase?.expectedDataAssertions.join('\n')).toContain('editorialDecision.strategy=rating')
    expect(trendingCase?.expectedDecisions.join('\n')).toContain('selectionPriority=trending')
    expect(trendingCase?.expectedDataAssertions.join('\n')).toContain('editorialDecision.strategy=trending')
    expect(contentCase?.expectedDecisions.join('\n')).toContain('selectionPriority=content_match')
    expect(contentCase?.expectedDataAssertions.join('\n')).toContain('editorialDecision.strategy=content_match')
  })

  it('覆盖字段级编排关键词错配时确认也不得落表的真实浏览器用例', () => {
    const fieldMismatchCase = agentWorkflowBrowserCases.find((browserCase) =>
      browserCase.id === 'field-editorial-keyword-mismatch-blocks-commit',
    )
    const fieldMismatchAudit = agentWorkflowPreconditionAudits.find((audit) =>
      audit.caseId === 'field-editorial-keyword-mismatch-blocks-commit',
    )

    expect(fieldMismatchCase).toBeTruthy()
    expect(fieldMismatchAudit).toBeTruthy()
    expect(fieldMismatchCase?.requiresBrowser).toBe(true)
    expect(fieldMismatchCase?.category).toBe('special_combo')
    expect(fieldMismatchCase?.userSteps.join('\n')).toContain('所属栏目静安寺')
    expect(fieldMismatchCase?.userSteps.join('\n')).toContain('节目内容看东方')
    expect(fieldMismatchCase?.expectedDecisions.join('\n')).toContain('blockerKind=keyword')
    expect(fieldMismatchCase?.expectedDecisions.join('\n')).toContain('不得创建 orchestrationRequest')
    expect(fieldMismatchCase?.expectedDataAssertions.join('\n')).toContain('不新增实际节目')
    expect(fieldMismatchCase?.expectedDataAssertions.join('\n')).toContain('无 orchestrationRequest')
    expect(fieldMismatchAudit?.verificationGate).toContain('不得创建正式编排请求')
  })

  it('上传版面样例可被当前导入服务识别', async () => {
    const service = new LayoutImportService()
    const file = new File([readFileSync(uploadFixturePath)], 'smg-weekday-layout.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })

    const imported = await service.importFile(file, 'dragon', '2026-03-25')
    const importedTypes = new Set(imported.columns.map((column) => column.defaultProgramType))

    expect(imported.templateMode).toBe('weekday_sheet')
    expect(imported.matchedSheetName).toBe('Wednesday')
    expect(imported.matchedWeekday).toBe('wednesday')
    expect(imported.layoutReference.slots).toHaveLength(9)
    expect(importedTypes).toEqual(new Set([
      'documentary',
      'drama',
      'entertainment',
      'health',
      'news',
      'news_magazine',
    ]))
  })
})
