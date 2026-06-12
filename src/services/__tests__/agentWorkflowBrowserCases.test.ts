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
