import { describe, expect, it } from 'vitest'

import {
  CANDIDATE_QUERY_EXPERT_PROMPT,
  CANDIDATE_QUERY_EXPERT_PROMPT_VERSION,
  DIALOGUE_ASSISTANT_PROMPT,
  DIALOGUE_ASSISTANT_PROMPT_VERSION,
  ORCHESTRATION_EXPERT_PROMPT,
  ORCHESTRATION_EXPERT_PROMPT_VERSION,
  PROGRAM_SELECTOR_PROMPT,
  PROGRAM_SELECTOR_PROMPT_VERSION,
  REPAIR_EXPERT_PROMPT,
  REPAIR_EXPERT_PROMPT_VERSION,
} from '@/services/llm/prompts/systemPrompts'

describe('systemPrompts prompt 版本号管理', () => {
  /**
   * case c4-system-prompts-version-exported
   * - expectedDecision: 5 个 prompt 常量均声明独立版本号且初始为 v1.0
   * - mustNotHappen: 版本号常量缺失；版本号非 'v1.0'
   * - verification: 5 个 *_PROMPT_VERSION 常量均 === 'v1.0'
   */
  it('c4-system-prompts-version-exported: 5 个版本号常量均导出且为 v1.0', () => {
    expect(ORCHESTRATION_EXPERT_PROMPT_VERSION).toBe('v1.0')
    expect(DIALOGUE_ASSISTANT_PROMPT_VERSION).toBe('v1.0')
    expect(CANDIDATE_QUERY_EXPERT_PROMPT_VERSION).toBe('v1.0')
    expect(PROGRAM_SELECTOR_PROMPT_VERSION).toBe('v1.0')
    expect(REPAIR_EXPERT_PROMPT_VERSION).toBe('v1.0')
  })

  /**
   * case c4-system-prompts-text-annotated
   * - expectedDecision: 5 个 prompt 字符串首部均含 [prompt v1.0] 标注
   * - mustNotHappen: 任一 prompt 不含 [prompt v1.0] 前缀
   * - verification: 5 个 prompt 字符串均 startsWith '[prompt v1.0]'
   */
  it('c4-system-prompts-text-annotated: 5 个 prompt 文本首部含 [prompt v1.0] 标注', () => {
    expect(ORCHESTRATION_EXPERT_PROMPT).toMatch(/^\[prompt v1\.0\] /)
    expect(DIALOGUE_ASSISTANT_PROMPT).toMatch(/^\[prompt v1\.0\] /)
    expect(CANDIDATE_QUERY_EXPERT_PROMPT).toMatch(/^\[prompt v1\.0\] /)
    expect(PROGRAM_SELECTOR_PROMPT).toMatch(/^\[prompt v1\.0\] /)
    expect(REPAIR_EXPERT_PROMPT).toMatch(/^\[prompt v1\.0\] /)
  })

  /**
   * case c4-system-prompts-version-consistency
   * - expectedDecision: prompt 文本中的版本号标注与导出的版本号常量保持一致
   * - mustNotHappen: 文本标注与常量值不一致
   * - verification: prompt 字符串含 `[prompt ${VERSION}]` 拼接结果
   */
  it('c4-system-prompts-version-consistency: 文本标注版本号与常量一致', () => {
    expect(ORCHESTRATION_EXPERT_PROMPT).toContain(`[prompt ${ORCHESTRATION_EXPERT_PROMPT_VERSION}]`)
    expect(DIALOGUE_ASSISTANT_PROMPT).toContain(`[prompt ${DIALOGUE_ASSISTANT_PROMPT_VERSION}]`)
    expect(CANDIDATE_QUERY_EXPERT_PROMPT).toContain(`[prompt ${CANDIDATE_QUERY_EXPERT_PROMPT_VERSION}]`)
    expect(PROGRAM_SELECTOR_PROMPT).toContain(`[prompt ${PROGRAM_SELECTOR_PROMPT_VERSION}]`)
    expect(REPAIR_EXPERT_PROMPT).toContain(`[prompt ${REPAIR_EXPERT_PROMPT_VERSION}]`)
  })
})
