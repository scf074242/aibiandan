import { mkdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  buildAgentRealLlmAcceptanceCoverage,
  buildFailedAgentRealLlmEvaluationSections,
  buildSkippedAgentRealLlmEvaluationSections,
  summarizeAgentRealLlmEvaluationStatus,
  writeAgentRealLlmEvaluationReport,
} from './fixtures/agentRealLlmEvaluationReport'

const reportPath = join(process.cwd(), 'test-results', 'agent-real-llm-evaluation.unit.json')

describe('Agent real LLM evaluation report', () => {
  afterEach(() => {
    rmSync(reportPath, { force: true })
  })

  it('writes a skipped report with an explicit skip reason', () => {
    const sections = buildSkippedAgentRealLlmEvaluationSections('placeholder API key')
    mkdirSync(dirname(reportPath), { recursive: true })

    writeAgentRealLlmEvaluationReport(reportPath, {
      generatedAt: '2026-03-25T00:00:00.000Z',
      status: summarizeAgentRealLlmEvaluationStatus(sections),
      config: {
        runRequested: true,
        strict: false,
        apiKeyPresent: true,
        apiKeyUsable: false,
        model: 'deepseek-ai/DeepSeek-V4-Flash',
        baseURL: 'https://api.siliconflow.cn/v1',
        skipReason: 'placeholder API key',
      },
      acceptanceCoverage: buildAgentRealLlmAcceptanceCoverage(sections),
      sections,
    })

    const report = JSON.parse(readFileSync(reportPath, 'utf8')) as {
      status: string
      config: { strict: boolean; skipReason?: string }
      acceptanceCoverage: Array<{ tag: string; covered: boolean }>
      sections: Array<{ status: string; skippedReason?: string; tagCoverage: unknown[] }>
    }

    expect(report.status).toBe('skipped')
    expect(report.config.strict).toBe(false)
    expect(report.config.skipReason).toBe('placeholder API key')
    expect(report.acceptanceCoverage.every((coverage) => coverage.covered === false)).toBe(true)
    expect(report.sections).toHaveLength(3)
    expect(report.sections.every((section) => section.status === 'skipped')).toBe(true)
    expect(report.sections.every((section) => section.skippedReason === 'placeholder API key')).toBe(true)
    expect(report.sections.every((section) => section.tagCoverage.length === 0)).toBe(true)
  })

  it('writes a failed report when strict real LLM acceptance cannot run', () => {
    const sections = buildFailedAgentRealLlmEvaluationSections('placeholder API key')
    mkdirSync(dirname(reportPath), { recursive: true })

    writeAgentRealLlmEvaluationReport(reportPath, {
      generatedAt: '2026-03-25T00:00:00.000Z',
      status: summarizeAgentRealLlmEvaluationStatus(sections),
      config: {
        runRequested: true,
        strict: true,
        apiKeyPresent: true,
        apiKeyUsable: false,
        model: 'deepseek-ai/DeepSeek-V4-Flash',
        baseURL: 'https://api.siliconflow.cn/v1',
        skipReason: 'placeholder API key',
      },
      acceptanceCoverage: buildAgentRealLlmAcceptanceCoverage(sections),
      sections,
    })

    const report = JSON.parse(readFileSync(reportPath, 'utf8')) as {
      status: string
      config: { strict: boolean; skipReason?: string }
      acceptanceCoverage: Array<{ tag: string; covered: boolean }>
      sections: Array<{ status: string; skippedReason?: string }>
    }

    expect(report.status).toBe('failed')
    expect(report.config.strict).toBe(true)
    expect(report.config.skipReason).toBe('placeholder API key')
    expect(report.acceptanceCoverage.every((coverage) => coverage.covered === false)).toBe(true)
    expect(report.sections).toHaveLength(3)
    expect(report.sections.every((section) => section.status === 'failed')).toBe(true)
    expect(report.sections.every((section) => section.skippedReason === 'placeholder API key')).toBe(true)
  })

  it('fails a non-skipped report when a required acceptance tag is missing', () => {
    const sections = [{
      id: 'runtime_loop',
      title: 'Runtime preview and constraint loop',
      status: 'passed' as const,
      threshold: 0.8,
      total: 1,
      passed: 1,
      failed: 0,
      passRate: 1,
      tagCoverage: [
        { tag: 'tv_sequence', total: 1, passed: 1, failed: 0 },
      ],
      failures: [],
    }]

    expect(summarizeAgentRealLlmEvaluationStatus(sections)).toBe('failed')
    expect(buildAgentRealLlmAcceptanceCoverage(sections)).toEqual(expect.arrayContaining([
      expect.objectContaining({ tag: 'tv_sequence', covered: true }),
      expect.objectContaining({ tag: 'rotation_short_clip', covered: false }),
      expect.objectContaining({ tag: 'missing_param', covered: false }),
      expect.objectContaining({ tag: 'target_occupied', covered: false }),
      expect.objectContaining({ tag: 'professional_refusal', covered: false }),
      expect.objectContaining({ tag: 'pending_context', covered: false }),
    ]))
  })
})
