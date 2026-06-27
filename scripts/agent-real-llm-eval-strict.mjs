import { spawnSync } from 'node:child_process'

const command = process.platform === 'win32' ? 'npx.cmd' : 'npx'
const result = spawnSync(command, [
  'vitest',
  'run',
  'src/services/__tests__/schedulingAgentRuntime.realLlmEvaluation.test.ts',
], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: {
    ...process.env,
    RUN_AGENT_REAL_LLM_EVAL: '1',
    RUN_AGENT_REAL_LLM_EVAL_STRICT: '1',
  },
})

if (result.error) {
  console.error(`Failed to start strict real LLM evaluation: ${result.error.message}`)
}

process.exit(result.status ?? 1)
