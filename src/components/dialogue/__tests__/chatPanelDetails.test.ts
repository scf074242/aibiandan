import { describe, expect, it } from 'vitest'

import {
  buildCandidateComparisonItems,
  buildDetailsSummary,
  extractWarnings,
} from '../chatPanelDetails'
import type { DetailMap } from '../chatPanelFormatting'

const summaryDeps = {
  formatDisplayTime: (value: string) => `fmt:${value}`,
  formatDisplayTimeRange: (start: string, end?: string) => end ? `range:${start}-${end}` : `range:${start}`,
  formatProgramLabel: (value: unknown) => {
    const record = value as { programName?: string; programCode?: string } | undefined
    return record?.programName ?? record?.programCode ?? ''
  },
  resolveMatchedColumnInfo: () => ({
    columnId: 'col-101',
    columnName: 'News Column',
  }),
  buildQueryCriteriaSummary: (_criteria: DetailMap) => 'query: news column, 1800-3600 seconds',
  formatOffset: (offsetSeconds: number) => `${offsetSeconds / 60} minutes`,
}

describe('chatPanelDetails', () => {
  it('deduplicates runtime warnings', () => {
    const warnings = extractWarnings({
      preview: {
        warnings: ['existing-risk', 'existing-risk'],
        canExecute: true,
      },
    })

    expect(warnings).toEqual(['existing-risk'])
  })

  it('builds candidate comparison items and marks the selected item', () => {
    const items = buildCandidateComparisonItems({
      selectedCandidateId: 'b',
      selectionReason: 'Strong content match for the current slot.',
      candidateOptions: [
        {
          id: 'a',
          programName: 'Morning Magazine',
          duration: 3600,
          programType: 'news_magazine',
          selectionMode: 'sequential',
          issueNo: '12',
        },
        {
          id: 'b',
          programName: 'Morning News',
          duration: 1800,
          programType: 'news',
          selectionMode: 'rerun',
        },
      ],
    })

    expect(items).toHaveLength(2)
    expect(items[0]?.selected).toBe(false)
    expect(items[1]).toMatchObject({
      id: 'b',
      name: 'Morning News',
      selected: true,
    })
    expect(items[1]?.note).toContain('Strong content match')
  })

  it('shows editorial decision and dimensions in generic details summary', () => {
    const summary = buildDetailsSummary({
      selectedCandidate: {
        programName: 'City Service Live Guide',
        editorialDecision: {
          strategy: 'content_match',
          totalScore: 91.5,
          summary: 'Professional judgment: content match is strong for this rotation slot.',
          dimensions: [
            { key: 'content_match', score: 96, weight: 0.4, note: 'Keyword match.' },
            { key: 'duration_fit', score: 90, weight: 0.18, note: 'Duration fit.' },
          ],
        },
      },
      candidateCount: 2,
    }, summaryDeps)

    expect(summary.some((item) =>
      item.value.includes('Professional judgment: content match is strong'),
    )).toBe(true)
    expect(summary.some((item) =>
      item.value.includes('96') && item.value.includes('90'),
    )).toBe(true)
  })

  it('surfaces Agent Core audit summary as scheduling basis and risks', () => {
    const details: DetailMap = {
      auditSummary: {
        outcome: 'blocked',
        title: 'Blocked by schedule risk',
        professionalConclusion: 'Professional conclusion: the plan should not be committed until the blocking scheduling risk is resolved.',
        confirmationReason: 'Confirmation reason: candidate write is ready for review.',
        keyPoints: ['intent: insert', 'sequence: expected 3, candidate 4'],
        warnings: ['playlist_policy: rotation writes require confirmation'],
        blockers: ['No usable next episode candidate was available.'],
        contextSources: {
          today: { source: 'runtime_schedule_reader', available: true, recordCount: 3, version: 'playlist-v1' },
          candidates: { source: 'program_candidate_reader', available: true, recordCount: 12, query: { limit: 100 } },
          history: { source: 'history_schedule_reader', available: true, recordCount: 1 },
          constraints: { source: 'constraint_reader', available: true, recordCount: 2 },
          policy: { source: 'schedule_state', available: true, recordCount: 1 },
        },
        signalSourceSummary: [
          'candidates:content_alignment|material_readiness',
          'today:neighbor_column_fit|replacement_duty_fit',
          'policy:playlist_policy',
        ],
        pendingTask: {
          id: 'pending-1',
          intent: 'insert',
          phase: 'needs_confirmation',
          collectedSlotKeys: ['programHint', 'targetTime'],
          missingSlots: ['confirmation'],
          allowedActions: ['confirm', 'reject', 'start_new_task', 'cancel_pending'],
          attemptCount: 1,
          maxAttempts: 3,
          recommendationCount: 1,
          targetOptionCount: 0,
        },
        operation: {
          committed: false,
          commandIntent: 'insert',
          affectedItemIds: [],
          affectedCount: 0,
          previewAffectedItemIds: ['agent_insert_candidate-news_2026_03_25T10_00_00_08_00'],
          previewAffectedCount: 1,
          reason: 'Operation is pending confirmation and has not been committed.',
        },
        professionalSignals: [],
        professionalRuleSummary: {
          total: 10,
          blockingRuleIds: ['recent_replay_interval'],
          warningRuleIds: ['duration_fit'],
          positiveRuleIds: ['content_alignment', 'playlist_policy'],
          neutralRuleIds: ['replacement_duty_fit'],
          evidenceSourceKeys: ['candidates', 'history', 'policy'],
        },
        constraintIssueCodes: ['program_not_found'],
        constraintHandling: [
          {
            code: 'rights_not_ready',
            severity: 'critical',
            action: 'block',
            reason: 'Rights readiness is mandatory before a programme can be committed.',
          },
        ],
      },
      agentCapabilities: {
        capabilityIds: ['atomic_command'],
        commandPolicies: [],
        dataRequirements: [
          {
            sourceKey: 'today',
            requiredFor: ['move', 'batch_move', 'insert', 'replace', 'delete', 'batch_delete', 'query', 'validate'],
            missingBehavior: 'block_write',
            guardCode: 'schedule_source_missing',
          },
          {
            sourceKey: 'candidates',
            requiredFor: ['insert', 'replace'],
            missingBehavior: 'block_write',
            guardCode: 'candidate_source_missing',
          },
        ],
        safetyGates: [
          { id: 'playlist_policy', mode: 'confirm', appliesTo: ['insert', 'replace'] },
          { id: 'source_coverage', mode: 'block', appliesTo: ['move', 'batch_move', 'insert', 'replace', 'delete', 'batch_delete'] },
          { id: 'pending_lifecycle', mode: 'reroute', appliesTo: ['insert'] },
          { id: 'context_fingerprint', mode: 'block', appliesTo: ['insert'] },
          { id: 'commit_fingerprint', mode: 'block', appliesTo: ['move', 'batch_move', 'insert', 'replace', 'delete', 'batch_delete'] },
          { id: 'tv_sequence_selector', mode: 'block', appliesTo: ['insert', 'replace'] },
          { id: 'llm_intent_contract', mode: 'reroute', appliesTo: ['insert', 'replace'] },
          { id: 'pending_llm_context', mode: 'audit', appliesTo: ['insert', 'replace'] },
          { id: 'llm_usage_audit', mode: 'audit', appliesTo: ['insert', 'replace'] },
          { id: 'candidate_query_facets', mode: 'audit', appliesTo: ['insert', 'replace', 'query'] },
          { id: 'professional_slot_policy', mode: 'block', appliesTo: ['insert', 'replace'] },
        ],
        professionalRules: [
          { id: 'time_slot_fit', appliesTo: ['insert', 'replace'], sourceKeys: ['candidates', 'policy'], tvMode: 'block', rotationMode: 'warn' },
          { id: 'replacement_duty_fit', appliesTo: ['replace'], sourceKeys: ['today', 'candidates', 'policy'], tvMode: 'block', rotationMode: 'warn' },
          { id: 'same_day_duplicate', appliesTo: ['insert', 'replace'], sourceKeys: ['today', 'candidates', 'policy'], tvMode: 'block', rotationMode: 'warn' },
          { id: 'recent_replay_interval', appliesTo: ['insert', 'replace'], sourceKeys: ['history', 'candidates', 'policy'], tvMode: 'block', rotationMode: 'warn' },
          { id: 'rotation_priority', appliesTo: ['insert', 'replace'], sourceKeys: ['policy', 'candidates'], tvMode: 'audit', rotationMode: 'prefer' },
        ],
      },
      agentOperationalReadiness: {
        status: 'limited',
        executablePercent: 100,
        executableCommands: 8,
        totalCommands: 8,
        playlistType: 'tv',
        sourceCoverage: [
          { sourceKey: 'today', available: true, status: 'available', source: 'runtime_schedule_reader', recordCount: 3 },
          { sourceKey: 'candidates', available: true, status: 'available', source: 'program_candidate_reader', recordCount: 12 },
          { sourceKey: 'readiness', available: false, status: 'missing', source: 'none', recordCount: 0 },
        ],
        commandReadiness: [
          { intent: 'move', status: 'ready', executionMode: 'direct_execute', blockingSources: [], advisorySources: [] },
          { intent: 'insert', status: 'advisory', executionMode: 'direct_execute', blockingSources: [], advisorySources: ['readiness'] },
          { intent: 'replace', status: 'advisory', executionMode: 'direct_execute', blockingSources: [], advisorySources: ['readiness'] },
        ],
        professionalRuleEffectSummary: {
          blockingGuardCount: 6,
          confirmationGuardCount: 0,
          warningCount: 2,
          preferenceCount: 0,
          auditCount: 0,
          passCount: 0,
          partialEvidenceCount: 1,
          commandCountWithRules: 2,
        },
        commandProfessionalRuleReadiness: [
          {
            intent: 'insert',
            executionMode: 'direct_execute',
            rules: [
              { ruleId: 'time_slot_fit', effect: 'blocking_guard', evidenceStatus: 'ready' },
              { ruleId: 'same_day_duplicate', effect: 'blocking_guard', evidenceStatus: 'ready' },
              { ruleId: 'recent_replay_interval', effect: 'blocking_guard', evidenceStatus: 'partial' },
              { ruleId: 'duration_fit', effect: 'warning', evidenceStatus: 'ready' },
            ],
          },
          {
            intent: 'replace',
            executionMode: 'direct_execute',
            rules: [
              { ruleId: 'time_slot_fit', effect: 'blocking_guard', evidenceStatus: 'ready' },
              { ruleId: 'replacement_duty_fit', effect: 'blocking_guard', evidenceStatus: 'ready' },
              { ruleId: 'same_day_duplicate', effect: 'blocking_guard', evidenceStatus: 'ready' },
              { ruleId: 'duration_fit', effect: 'warning', evidenceStatus: 'ready' },
            ],
          },
        ],
        gaps: ['insert:advisory:readiness', 'replace:advisory:readiness'],
      },
      constraintReport: {
        ok: false,
        issues: [{
          code: 'program_not_found',
          severity: 'critical',
          message: 'No insert candidate matched the request.',
          detail: {
            searchedKeyword: '上海景点的视频',
            searchedFacets: ['上海', '景点', '视频'],
            candidateSourceStatus: 'available',
            candidateRecordCount: 26,
            suggestedKeywords: ['上海 旅游景点', '城市形象 短片', '上海 宣传片'],
            nextAction: 'rewrite_keywords_and_retry',
          },
        }],
      },
    }

    expect(extractWarnings(details)).toEqual([
      'No usable next episode candidate was available.',
      'playlist_policy: rotation writes require confirmation',
      '插入需注意：播出就绪需注意',
    ])

    const summary = buildDetailsSummary(details, summaryDeps)
    expect(summary.some((item) =>
      item.value.includes('Professional conclusion: the plan should not be committed'),
    )).toBe(true)
    expect(summary.some((item) =>
      item.value.includes('未写入')
      && item.value.includes('预演 1 条'),
    )).toBe(true)
    expect(summary.some((item) =>
      item.value.includes('Blocked by schedule risk')
      && item.value.includes('已检查 10 条专业规则')
      && item.value.includes('阻断 1 条')
    )).toBe(true)
    expect(summary.some((item) =>
      item.value.includes('Blocked by schedule risk')
      && item.value.includes('intent: insert')
      && item.value.includes('sequence: expected 3, candidate 4'),
    )).toBe(true)
    expect(summary.some((item) =>
      item.value.includes('待确认执行')
      && item.value.includes('还需：确认')
      && item.value.includes('已收集：节目线索、目标时间'),
    )).toBe(true)
    expect(summary.some((item) =>
      item.value.includes('rights_not_ready：已阻断'),
    )).toBe(true)
    expect(summary.some((item) =>
      item.value.includes('今日编排已读取 3 条')
      && item.value.includes('候选节目已读取 12 条')
      && item.value.includes('播单策略已读取 1 条'),
    )).toBe(true)
    expect(summary.some((item) =>
      item.value.includes('版本 playlist-v1')
      && item.value.includes('上限 100'),
    )).toBe(true)
    expect(summary.some((item) =>
      item.value.includes('candidates:content_alignment')
      && item.value.includes('today:neighbor_column_fit'),
    )).toBe(true)
    expect(summary.some((item) =>
      item.value.includes('Confirmation reason: candidate write is ready'),
    )).toBe(true)
    expect(summary.some((item) =>
      item.value === 'No usable next episode candidate was available.',
    )).toBe(true)
    expect(summary.some((item) =>
      item.value.includes('playlist_policy: rotation writes require'),
    )).toBe(true)
    expect(summary.some((item) =>
      item.value.includes('今日编排支撑写入/查询/校验')
      && item.value.includes('候选节目支撑插入、替换')
      && item.value.includes('数据完整性')
      && item.value.includes('多轮上下文')
      && item.value.includes('上下文变更校验')
      && item.value.includes('提交前复核')
      && item.value.includes('电视顺播判断'),
    )).toBe(true)
    expect(summary.some((item) =>
      item.value.includes('候选节目支撑插入、替换')
      && item.value.includes('多轮上下文')
      && item.value.includes('上下文变更校验')
      && item.value.includes('电视顺播判断'),
    )).toBe(true)
    expect(summary.some((item) =>
      item.value.includes('LLM结构化意图')
      && item.value.includes('待办上下文合并')
      && item.value.includes('LLM调用留痕')
      && item.value.includes('关键词拆分检索')
      && item.value.includes('专业时段规则'),
    )).toBe(true)
    expect(summary.some((item) =>
      item.value.includes('时段匹配')
      && item.value.includes('替换职责匹配')
      && item.value.includes('同日重复阻断')
      && item.value.includes('近期重播间隔')
      && item.value.includes('轮播素材优先级'),
    )).toBe(true)
    expect(summary.some((item) =>
      item.value.includes('状态：有限可用')
      && item.value.includes('可执行：8/8（100%）')
      && item.value.includes('受限：插入：需注意、替换：需注意')
      && item.value.includes('缺少：播出就绪：缺失'),
    )).toBe(true)
    expect(summary.some((item) =>
      item.value.includes('规则：阻断6,提醒2,依据不足1'),
    )).toBe(true)
    expect(summary.some((item) =>
      item.label === '检索动作'
      && item.value.includes('主关键词：上海景点的视频')
      && item.value.includes('拆分词：上海、景点、视频')
      && item.value.includes('候选源返回 26 条'),
    )).toBe(true)
    expect(summary.some((item) =>
      item.label === '继续检索'
      && item.value.includes('保留任务，换关键词继续找')
      && item.value.includes('上海 旅游景点、城市形象 短片、上海 宣传片'),
    )).toBe(true)
  })

  it('formats occupied destination checks through the playlist display range formatter', () => {
    const summary = buildDetailsSummary({
      constraintReport: {
        issues: [{
          code: 'time_overlap',
          detail: {
            conflictProgramName: 'Morning News',
            conflictRange: {
              start: '2026-03-25T00:00:00+08:00',
              end: '2026-03-25T03:00:00+08:00',
            },
            blockedPolicy: 'no_auto_shift_replace_reorder',
          },
        }],
      },
    }, summaryDeps)

    expect(summary).toEqual(expect.arrayContaining([
      expect.objectContaining({
        label: '占用检查',
        value: expect.stringContaining('range:00:00:00-03:00:00'),
      }),
    ]))
  })

  it('shows missing Agent Core context sources in generic details summary', () => {
    const summary = buildDetailsSummary({
      auditSummary: {
        outcome: 'blocked',
        title: 'Blocked by missing source',
        keyPoints: ['context sources: today=runtime_schedule_reader:1, candidates=missing:0'],
        warnings: [],
        blockers: ['Data source missing: candidate programme source is not configured.'],
        contextSources: {
          today: { source: 'runtime_schedule_reader', available: true, recordCount: 1 },
          candidates: { source: 'none', available: false, recordCount: 0 },
          history: { source: 'history_schedule_reader', available: true, recordCount: 0 },
          constraints: { source: 'none', available: false, recordCount: 0 },
          policy: { source: 'schedule_state', available: true, recordCount: 1 },
        },
        signalSourceSummary: [],
        operation: {
          committed: false,
          affectedItemIds: [],
          affectedCount: 0,
          previewAffectedItemIds: [],
          previewAffectedCount: 0,
          reason: 'Operation was blocked before commit.',
        },
        professionalSignals: [],
        constraintIssueCodes: ['program_not_found'],
      },
    }, summaryDeps)

    expect(summary.some((item) =>
      item.value.includes('候选节目缺失 0 条')
      && item.value.includes('编排约束缺失 0 条'),
    )).toBe(true)
  })

  it('surfaces stale pending context evidence changes in generic details summary', () => {
    const summary = buildDetailsSummary({
      auditSummary: {
        outcome: 'blocked',
        title: 'Pending context changed',
        keyPoints: ['pending task: insert'],
        warnings: [],
        blockers: ['The candidate source changed before confirmation.'],
        constraintIssueCodes: ['context_conflict'],
        constraintHandling: [{
          code: 'context_conflict',
          severity: 'info',
          action: 'block',
          reason: 'source evidence changed',
        }],
        operation: {
          committed: false,
          commitAttempted: false,
          affectedCount: 0,
          previewAffectedCount: 0,
          reason: 'pending task context changed',
        },
      },
      constraintReport: {
        ok: false,
        issues: [{
          code: 'context_conflict',
          severity: 'info',
          message: 'pending task context changed',
          detail: {
            changedSourceKeys: ['candidates'],
            sourceChangeSummary: [{
              sourceKey: 'candidates',
              previousSamples: ['Original Candidate ORIGINAL1000 news material=ready rights=ready'],
              currentSamples: ['Replacement Candidate REPLACEMENT1000 news material=ready rights=ready'],
            }],
          },
        }],
      },
    }, summaryDeps)

    expect(summary.some((item) =>
      item.value.includes('candidates: Original Candidate')
      && item.value.includes('Replacement Candidate'),
    )).toBe(true)
  })

  it('surfaces occupied target details in generic Agent Core summaries', () => {
    const summary = buildDetailsSummary({
      constraintReport: {
        ok: false,
        issues: [{
          code: 'time_overlap',
          severity: 'critical',
          message: '移动后会与《东方新闻》发生时间重叠。',
          detail: {
            conflictItemId: 'item-1000',
            conflictProgramName: '东方新闻',
            conflictRange: {
              start: '2026-03-25T10:00:00+08:00',
              end: '2026-03-25T11:00:00+08:00',
            },
            proposedRange: {
              start: '2026-03-25T10:00:00+08:00',
              end: '2026-03-25T11:00:00+08:00',
            },
            blockedPolicy: 'no_auto_shift_replace_reorder',
          },
        }],
      },
    }, summaryDeps)

    expect(summary.some((item) =>
      item.label === '占用检查'
      && item.value.includes('占用：东方新闻')
      && item.value.includes('10:00:00-11:00:00')
      && item.value.includes('不自动下移/替换/重排'),
    )).toBe(true)
  })

  it('surfaces operational readiness blockers as risks', () => {
    const details: DetailMap = {
      agentOperationalReadiness: {
        status: 'blocked',
        executablePercent: 75,
        executableCommands: 6,
        totalCommands: 8,
        playlistType: 'tv',
        sourceCoverage: [
          { sourceKey: 'today', available: true, status: 'available', source: 'runtime_schedule_reader', recordCount: 1 },
          { sourceKey: 'candidates', available: false, status: 'missing', source: 'none', recordCount: 0 },
          { sourceKey: 'readiness', available: false, status: 'missing', source: 'none', recordCount: 0 },
        ],
        commandReadiness: [
          { intent: 'move', status: 'ready', executionMode: 'direct_execute', blockingSources: [], advisorySources: [] },
          { intent: 'insert', status: 'blocked', executionMode: 'direct_execute', blockingSources: ['candidates'], advisorySources: ['readiness'] },
          { intent: 'replace', status: 'blocked', executionMode: 'direct_execute', blockingSources: ['candidates'], advisorySources: ['readiness'] },
        ],
        gaps: ['insert:blocked:candidates', 'replace:blocked:candidates'],
      },
    }

    expect(extractWarnings(details)).toEqual([
      '插入已阻断：缺少候选节目',
      '替换已阻断：缺少候选节目',
    ])

    const summary = buildDetailsSummary(details, summaryDeps)
    expect(summary.some((item) =>
      item.value.includes('状态：已阻断')
      && item.value.includes('可执行：6/8（75%）')
      && item.value.includes('受限：插入：已阻断、替换：已阻断')
      && item.value.includes('缺少：候选节目：缺失、播出就绪：缺失'),
    )).toBe(true)
  })

  it('surfaces rotation professional rule confirmation summary', () => {
    const summary = buildDetailsSummary({
      agentOperationalReadiness: {
        status: 'ready',
        executablePercent: 100,
        executableCommands: 8,
        totalCommands: 8,
        playlistType: 'rotation',
        sourceCoverage: [],
        commandReadiness: [
          { intent: 'insert', status: 'ready', executionMode: 'confirm_before_commit', blockingSources: [], advisorySources: [] },
        ],
        professionalRuleEffectSummary: {
          blockingGuardCount: 0,
          confirmationGuardCount: 6,
          warningCount: 11,
          preferenceCount: 4,
          auditCount: 0,
          passCount: 0,
          partialEvidenceCount: 0,
          commandCountWithRules: 2,
        },
        commandProfessionalRuleReadiness: [],
        gaps: [],
      },
    }, summaryDeps)

    expect(summary.some((item) =>
      item.value.includes('播单：轮播单')
      && item.value.includes('规则：提醒11,确认6'),
    )).toBe(true)
  })

  it('surfaces pending LLM context for the next scheduling turn', () => {
    const summary = buildDetailsSummary({
      agentPendingLlmContext: {
        pendingContext: {
          intent: 'insert',
          phase: 'needs_confirmation',
          originalInput: 'insert Replacement News at 10:00',
          collectedInput: 'insert Replacement News at 10:00',
          attemptCount: 1,
          maxAttempts: 3,
          collectedSlots: {
            targetTime: '2026-03-25T10:00:00+08:00',
            programHint: 'Replacement News',
            candidateId: 'candidate-news',
          },
          missingSlots: ['confirmation'],
          recommendations: [{ candidateId: 'candidate-news', programName: 'Replacement News' }],
          contextSources: [
            { sourceKey: 'today', source: 'runtime_schedule_reader', available: true, recordCount: 2, samples: ['09:00:00-09:30:00 Morning News NEWS0900 news'] },
            { sourceKey: 'candidates', source: 'program_candidate_reader', available: true, recordCount: 8, samples: ['Replacement News NEWS1000 news material=ready rights=ready'] },
            { sourceKey: 'history', source: 'history_schedule_reader', available: true, recordCount: 1, samples: ['latest=2026-03-24 items=1'] },
            { sourceKey: 'policy', source: 'schedule_state', available: true, recordCount: 1, samples: ['playlist=rotation'] },
          ],
        },
        latestUserInput: '',
        allowedActions: ['confirm', 'reject', 'start_new_task', 'cancel_pending'],
      },
    }, summaryDeps)

    expect(summary).toContainEqual(expect.objectContaining({
      label: 'LLM上下文',
      value: expect.stringContaining('下一轮将合并'),
    }))
    const llmContext = summary.find((item) => item.label === 'LLM上下文')?.value ?? ''
    expect(llmContext).toContain('插入')
    expect(llmContext).toContain('待确认执行')
    expect(llmContext).toContain('还需：确认')
    expect(llmContext).toContain('已收集：目标时间、节目线索、候选节目')
    expect(llmContext).toContain('候选 1 个')
    expect(llmContext).toContain('上下文：今日编排、候选节目、历史编排、播单策略')
    expect(llmContext).toContain('今日编排示例：09:00:00-09:30:00 Morning News NEWS0900 news')
    expect(llmContext).toContain('候选节目示例：Replacement News')
    expect(llmContext).toContain('可选：确认、拒绝、开始新任务、取消当前任务')
  })

  it('surfaces the pending LLM context that was used by the current turn', () => {
    const summary = buildDetailsSummary({
      agentLlmContextUsed: {
        pendingContext: {
          intent: 'replace',
          phase: 'needs_clarification',
          originalInput: 'replace with Oriental News',
          collectedInput: 'replace with Oriental News',
          attemptCount: 1,
          maxAttempts: 3,
          collectedSlots: {
            replacementHint: 'Oriental News',
          },
          missingSlots: ['targetTime'],
          targetOptions: [{ itemId: 'item-0900', programName: 'Morning News' }],
          contextSources: {
            today: { source: 'runtime_schedule_reader', available: true, recordCount: 2 },
            candidates: { source: 'program_candidate_reader', available: true, recordCount: 8 },
          },
        },
        latestUserInput: 'use the 9 AM one',
        allowedActions: ['continue_pending', 'start_new_task', 'cancel_pending'],
      },
    }, summaryDeps)

    const llmContext = summary.find((item) => item.label === 'LLM上下文')?.value ?? ''
    expect(llmContext).toContain('本轮已合并')
    expect(llmContext).toContain('替换')
    expect(llmContext).toContain('还需：目标时间')
    expect(llmContext).toContain('目标 1 个')
    expect(llmContext).toContain('已结合本轮输入')
  })

  it('surfaces successful candidate search keywords from Agent audit context', () => {
    const summary = buildDetailsSummary({
      auditSummary: {
        contextSources: {
          candidates: {
            source: 'program_candidate_reader',
            available: true,
            recordCount: 12,
            status: 'available',
            query: {
              keyword: '城市形象春日花路短片',
              facets: ['城市形象', '春日花路', '短片'],
              limit: 1000,
            },
          },
        },
      },
      candidateCount: 3,
    }, summaryDeps)

    expect(summary).toContainEqual(expect.objectContaining({
      label: '检索动作',
      value: expect.stringContaining('主关键词：城市形象春日花路短片'),
    }))
    const searchAction = summary.find((item) => item.label === '检索动作')?.value ?? ''
    expect(searchAction).toContain('拆分词：城市形象、春日花路、短片')
    expect(searchAction).toContain('候选源返回 12 条')
  })
})
