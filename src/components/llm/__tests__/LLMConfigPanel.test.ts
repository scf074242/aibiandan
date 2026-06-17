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
})
