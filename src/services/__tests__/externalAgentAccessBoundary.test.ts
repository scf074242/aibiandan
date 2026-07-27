import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

describe('external agent access boundary', () => {
  it('external-agent-does-not-own-an-in-process-runtime-bridge', () => {
    const testCase = {
      id: 'external-agent-does-not-own-an-in-process-runtime-bridge',
      userInput: '由外部桌面 Agent 调用编排系统',
      expectedDecision: '外部 Agent 未来只调用统一 CLI/API 契约，skill 仅承载适配，不进入编排内核',
      mustNotHappen: '恢复 OpenClawBridge 或让某个桌面 Agent 直接持有 DemoRuntimeFacade',
      verification: '生产源码与 public 目录不存在 OpenClaw 进程内桥或 userscript',
    }
    const root = process.cwd()
    const forbiddenPaths = [
      'src/services/openclaw/openClawBridge.ts',
      'src/services/openclaw/openClawHostAdapter.ts',
      'public/openclaw-demo-bridge.user.js',
    ]
    const foregroundSources = [
      'src/components/dialogue/ChatPanel.vue',
      'src/views/broadcast-plan/create.vue',
    ].map((path) => readFileSync(resolve(root, path), 'utf8')).join('\n')

    expect(testCase).toMatchObject({ expectedDecision: expect.any(String), mustNotHappen: expect.any(String), verification: expect.any(String) })
    expect(forbiddenPaths.every((path) => !existsSync(resolve(root, path)))).toBe(true)
    expect(foregroundSources).not.toMatch(/OpenClawBridge|openClawHostAdapter|bigbiandan\.openclaw/)
  })
})
