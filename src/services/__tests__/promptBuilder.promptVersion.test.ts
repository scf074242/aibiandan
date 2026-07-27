import { describe, expect, it } from 'vitest'

import type {
  GapInfo,
  ProgramCandidate,
  PlanningStrategy,
  ValidationReport,
} from '@/types/orchestration'
import { PromptBuilder, PROMPT_BUILDER_VERSION } from '@/services/llm/promptBuilder'

/**
 * PromptBuilder prompt 版本号管理回归 case
 *
 * 对齐 docs/plans/prompt-version-gate-full-closure.md 第 6 章 case 6：
 *   - case id: c5-prompt-builder-version-annotated
 *   - 覆盖目标: 7 个 build 方法文本标注 + 版本号常量导出
 *   - 关键断言: 每个 build 返回的 system message 含 [prompt v1.0]
 *
 * case 字段（trace 类单元 case 在注释中声明 expectedDecision / mustNotHappen / verification）：
 *   - expectedDecision: 7 个 build 方法返回的 system message 首部含 [prompt v1.0] 标注
 *   - mustNotHappen: 任一 build 返回的 system message 不含 [prompt v1.0] 前缀
 *   - verification: messages[0].role === 'system' 且 messages[0].content.startsWith '[prompt v1.0]'
 */
describe('PromptBuilder prompt 版本号管理', () => {
  /**
   * case c5-prompt-builder-version-exported
   * - expectedDecision: PROMPT_BUILDER_VERSION 常量已导出且初始为 v1.0
   * - mustNotHappen: 常量缺失；常量值非 'v1.0'
   * - verification: PROMPT_BUILDER_VERSION === 'v1.0'
   */
  it('c5-prompt-builder-version-exported: PROMPT_BUILDER_VERSION 导出且为 v1.0', () => {
    expect(PROMPT_BUILDER_VERSION).toBe('v1.0')
  })

  /**
   * case c5-prompt-builder-version-annotated
   * - expectedDecision: 7 个 build 方法返回的 system message 首部均含 [prompt v1.0] 标注
   * - mustNotHappen: 任一 build 返回的 system message 缺失 [prompt v1.0] 前缀
   * - verification: 每个方法返回数组的首元素 role === 'system' 且 content 匹配 /^[prompt v1.0] /
   */
  it('c5-prompt-builder-version-annotated: 7 个 build 方法返回 system message 含 [prompt v1.0] 标注', () => {
    const builder = new PromptBuilder()

    const gap: GapInfo = {
      id: 'gap-test',
      startTime: '2026-03-25T22:00:00+08:00',
      endTime: '2026-03-25T22:30:00+08:00',
      duration: 1800,
      constraints: { allowedTypes: ['commentary'] },
    }
    const candidate: ProgramCandidate = {
      id: 'c-1',
      programName: '测试节目',
      programCode: 'P001',
      duration: 1800,
      programType: 'commentary',
    }
    const strategy: PlanningStrategy = {
      target: '补空窗',
      referencePriority: ['layout', 'history', 'library'],
      allowFiller: true,
      sequentialPreference: true,
      riskPreference: 'balanced',
    }
    const validationReport: ValidationReport = {
      scope: 'item',
      summary: { totalIssues: 1, criticalCount: 0, warningCount: 1, infoCount: 0 },
      issues: [
        {
          id: 'issue-1',
          severity: 'warning',
          type: 'duration_mismatch',
          message: '时长不匹配',
        },
      ],
    }

    // 1. buildPlanningPrompt
    const planningMessages = builder.buildPlanningPrompt({
      channelId: 'dragon',
      channelName: '东方卫视',
      date: '2026-03-25',
      gapCount: 1,
      strategy,
    })
    expect(planningMessages[0]?.role).toBe('system')
    expect(planningMessages[0]?.content).toMatch(/^\[prompt v1\.0\] /)

    // 2. buildQueryCandidatesPrompt
    const queryMessages = builder.buildQueryCandidatesPrompt({
      gap,
      strategy,
      usedProgramCodes: [],
    })
    expect(queryMessages[0]?.role).toBe('system')
    expect(queryMessages[0]?.content).toMatch(/^\[prompt v1\.0\] /)

    // 3. buildFillItemPrompt
    const fillMessages = builder.buildFillItemPrompt({
      gap,
      candidates: [candidate],
      strategy,
    })
    expect(fillMessages[0]?.role).toBe('system')
    expect(fillMessages[0]?.content).toMatch(/^\[prompt v1\.0\] /)

    // 4. buildRepairPrompt
    const repairMessages = builder.buildRepairPrompt({
      validationReport,
      currentItems: [],
      availableCandidates: [candidate],
      repairRound: 1,
      maxRepairRounds: 3,
    })
    expect(repairMessages[0]?.role).toBe('system')
    expect(repairMessages[0]?.content).toMatch(/^\[prompt v1\.0\] /)

    // 5. buildClarificationPrompt
    const clarificationMessages = builder.buildClarificationPrompt({
      userInput: '帮我排个节目',
      scheduleState: { isEmpty: true, itemCount: 0, gapCount: 0 },
    })
    expect(clarificationMessages[0]?.role).toBe('system')
    expect(clarificationMessages[0]?.content).toMatch(/^\[prompt v1\.0\] /)

    // 6. buildExplanationPrompt - candidate_selection 分支
    const explainCandidateMessages = builder.buildExplanationPrompt({
      type: 'candidate_selection',
      targetId: 'c-1',
      targetName: '测试节目',
      context: { gapDuration: 1800, candidateDuration: 1800, candidateType: 'commentary' },
    })
    expect(explainCandidateMessages[0]?.role).toBe('system')
    expect(explainCandidateMessages[0]?.content).toMatch(/^\[prompt v1\.0\] /)

    // 7. buildExplanationPrompt - validation_issue 分支（覆盖两分支场景）
    const explainIssueMessages = builder.buildExplanationPrompt({
      type: 'validation_issue',
      targetId: 'issue-1',
      targetName: '时长不匹配',
      context: { issueType: 'duration_mismatch', severity: 'warning' },
    })
    expect(explainIssueMessages[0]?.role).toBe('system')
    expect(explainIssueMessages[0]?.content).toMatch(/^\[prompt v1\.0\] /)

    // 8. buildTaskClassificationPrompt
    const taskClassifyMessages = builder.buildTaskClassificationPrompt({
      userInput: '帮我排个节目',
      scheduleState: {
        channelId: 'dragon',
        channelName: '东方卫视',
        date: '2026-03-25',
        isEmpty: true,
        itemCount: 0,
        gapCount: 0,
        hasSelectedTimeRange: false,
      },
    })
    expect(taskClassifyMessages[0]?.role).toBe('system')
    expect(taskClassifyMessages[0]?.content).toMatch(/^\[prompt v1\.0\] /)
  })

  /**
   * case c5-prompt-builder-version-consistency
   * - expectedDecision: 文本中的版本号标注与导出的版本号常量保持一致
   * - mustNotHappen: 文本标注与常量值不一致（如常量升版后文本未同步）
   * - verification: 每个 build 返回的 system message 含 `[prompt ${PROMPT_BUILDER_VERSION}]`
   */
  it('c5-prompt-builder-version-consistency: 文本标注版本号与常量一致', () => {
    const builder = new PromptBuilder()

    const gap: GapInfo = {
      id: 'gap-test',
      startTime: '2026-03-25T22:00:00+08:00',
      endTime: '2026-03-25T22:30:00+08:00',
      duration: 1800,
      constraints: {},
    }
    const strategy: PlanningStrategy = {
      target: '补空窗',
      referencePriority: ['layout'],
      allowFiller: true,
      sequentialPreference: false,
      riskPreference: 'balanced',
    }

    const planningMessages = builder.buildPlanningPrompt({
      channelId: 'dragon',
      channelName: '东方卫视',
      date: '2026-03-25',
      gapCount: 1,
    })
    expect(planningMessages[0]?.content).toContain(`[prompt ${PROMPT_BUILDER_VERSION}]`)

    const queryMessages = builder.buildQueryCandidatesPrompt({
      gap,
      strategy,
      usedProgramCodes: [],
    })
    expect(queryMessages[0]?.content).toContain(`[prompt ${PROMPT_BUILDER_VERSION}]`)
  })
})
