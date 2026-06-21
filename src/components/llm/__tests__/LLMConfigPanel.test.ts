import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const currentDir = dirname(fileURLToPath(import.meta.url))
const panelSource = readFileSync(resolve(currentDir, '../LLMConfigPanel.vue'), 'utf-8')

describe('LLMConfigPanel', () => {
  it('keeps DeepSeek V4 Flash as the only DeepSeek 3.2 successor exposed in the UI', () => {
    expect(panelSource).toContain('DeepSeek V4 Flash')
    expect(panelSource).toContain('deepseek-ai/DeepSeek-V4-Flash')
    expect(panelSource).not.toContain('DeepSeek V3.2')
    expect(panelSource).not.toContain('deepseek-ai/DeepSeek-V3.2')
  })

  it('uses the shared LLM config service instead of writing a separate local key copy', () => {
    expect(panelSource).toContain("import { getDefaultConfig, loadLLMConfig, saveLLMConfig } from '@/services/llm/llmConfig'")
    expect(panelSource).toContain('Object.assign(config, loadLLMConfig())')
    expect(panelSource).toContain('saveLLMConfig({ ...config })')
    expect(panelSource).not.toContain('localStorage.setItem')
    expect(panelSource).not.toContain('localStorage.getItem')
  })

  it('hides browser API key editing when the Agent runtime is server-managed', () => {
    expect(panelSource).toContain("import { isHttpAgentRuntimeEnabled } from '@/services/runtime/agentRuntimeClient'")
    expect(panelSource).toContain('const serverManagedLlm = isHttpAgentRuntimeEnabled()')
    expect(panelSource).toContain('v-if="serverManagedLlm"')
    expect(panelSource).toContain('LLM 配置由 Agent 服务端管理')
    expect(panelSource).toContain('v-else ref="formRef"')
  })
})
