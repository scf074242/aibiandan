import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const root = process.cwd()
const readSource = (path: string) => readFileSync(resolve(root, path), 'utf-8')

const foregroundSources = {
  baseTokens: readSource('src/assets/base.css'),
  xnewsTokens: readSource('src/assets/styles/variables.scss'),
  chatPanel: readSource('src/components/dialogue/ChatPanel.vue'),
  broadcastPlan: readSource('src/views/broadcast-plan/create.vue'),
  orchestrationProgress: readSource('src/components/orchestration/OrchestrationProgress.vue'),
}

const foregroundBundle = Object.values(foregroundSources).join('\n')

describe('foreground visual theme', () => {
  it('keeps the foreground product path on the Vite blue accent tokens', () => {
    expect(foregroundSources.baseTokens).toContain('--app-accent: #646cff;')
    expect(foregroundSources.baseTokens).toContain('--app-accent-soft: #747bff;')
    expect(foregroundSources.baseTokens).toContain('--app-accent-deep: #535bf2;')
    expect(foregroundSources.baseTokens).toContain('--app-bg: #f8f9ff;')
    expect(foregroundSources.xnewsTokens).toContain('--xnews-color-primary: #646CFF;')
    expect(foregroundSources.xnewsTokens).toContain('--xnews-color-success: #646CFF;')
    expect(foregroundSources.xnewsTokens).toContain('--xnews-color-warning: #646CFF;')
    expect(foregroundSources.xnewsTokens).toContain('--xnews-gray-50: #F8F9FF;')
    expect(foregroundSources.xnewsTokens).toContain('--xnews-gray-100: #EEF2FF;')
  })

  it('does not reintroduce Vue green or Element warning/success colors into foreground surfaces', () => {
    const forbiddenPalette = [
      '#42b883',
      '#35495e',
      '#67c23a',
      '#85ce61',
      '#95d475',
      '#e1f3d8',
      '#f0f9eb',
      '#e6a23c',
      '#eebe77',
      '#f3d19e',
      '#fdf6ec',
    ]

    forbiddenPalette.forEach((color) => {
      expect(foregroundBundle.toLowerCase()).not.toContain(color)
    })
    expect(foregroundBundle).not.toContain('var(--el-color-success')
    expect(foregroundBundle).not.toContain('var(--el-color-warning')
  })

  it('keeps assistant workspace and send controls using app accent tokens', () => {
    expect(foregroundSources.chatPanel).toContain('class="send-action-button"')
    expect(foregroundSources.chatPanel).toContain('.send-action-button {\n  width: 32px;')
    expect(foregroundSources.chatPanel).toContain('background: var(--app-accent);')
    expect(foregroundSources.chatPanel).toContain('.send-action-button:hover:not(:disabled) {\n  background: var(--app-accent-deep);')
    expect(foregroundSources.broadcastPlan).toContain('class="assistant-workspace-chip"')
    expect(foregroundSources.broadcastPlan).toContain('.assistant-workspace-dot')
    expect(foregroundSources.broadcastPlan).toContain('background: var(--app-accent);')
    expect(foregroundSources.broadcastPlan).toContain('border: 1px solid var(--app-line);')
  })
})
