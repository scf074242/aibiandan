import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  applyAgentLlmConfigToEnv,
  loadAgentEnv,
  loadAgentLlmConfigStore,
  parseAgentEnvLine,
  writeAgentLlmConfigStore,
} from '../../../scripts/agent-env.mjs'

let tempDir: string | null = null

afterEach(() => {
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true })
    tempDir = null
  }
})

const makeTempDir = () => {
  tempDir = mkdtempSync(join(tmpdir(), 'aibiandan-agent-env-'))
  return tempDir
}

describe('agent server env loader', () => {
  it('parses common env file lines without exposing secret values through logs', () => {
    expect(parseAgentEnvLine('VITE_CODE_PLAN_LLM_API_KEY=sk-existing')).toEqual({
      key: 'VITE_CODE_PLAN_LLM_API_KEY',
      value: 'sk-existing',
    })
    expect(parseAgentEnvLine('export AGENT_LLM_MODEL="deepseek-ai/DeepSeek-V4-Flash"')).toEqual({
      key: 'AGENT_LLM_MODEL',
      value: 'deepseek-ai/DeepSeek-V4-Flash',
    })
    expect(parseAgentEnvLine('# comment')).toBeNull()
  })

  it('loads backend LLM settings from local env files without overriding process env', () => {
    const root = makeTempDir()
    writeFileSync(join(root, '.env.development'), [
      'VITE_CODE_PLAN_LLM_API_KEY=sk-from-file',
      'VITE_CODE_PLAN_LLM_BASE_URL=https://api.siliconflow.cn/v1',
      'AGENT_LLM_MODEL=deepseek-ai/DeepSeek-V4-Flash',
    ].join('\n'), 'utf8')

    const env: Record<string, string | undefined> = {
      VITE_CODE_PLAN_LLM_API_KEY: 'sk-from-process',
    }
    const loaded = loadAgentEnv(root, { env })

    expect(env).toMatchObject({
      VITE_CODE_PLAN_LLM_API_KEY: 'sk-from-process',
      VITE_CODE_PLAN_LLM_BASE_URL: 'https://api.siliconflow.cn/v1',
      AGENT_LLM_MODEL: 'deepseek-ai/DeepSeek-V4-Flash',
    })
    expect(loaded).toEqual([{
      file: '.env.development',
      keys: ['VITE_CODE_PLAN_LLM_BASE_URL', 'AGENT_LLM_MODEL'],
    }])
  })

  it('persists an imported LLM config in the backend state directory', () => {
    const root = makeTempDir()
    const storeFile = join(root, 'llm-config.json')

    writeAgentLlmConfigStore(storeFile, {
      baseURL: 'https://api.siliconflow.cn/v1',
      apiKey: 'sk-imported',
      model: 'deepseek-ai/DeepSeek-V4-Flash',
    })

    const env: Record<string, string | undefined> = {}
    const loaded = loadAgentLlmConfigStore(storeFile, { env })

    expect(existsSync(storeFile)).toBe(true)
    expect(JSON.parse(readFileSync(storeFile, 'utf8'))).toMatchObject({
      schemaVersion: 1,
      config: {
        baseURL: 'https://api.siliconflow.cn/v1',
        apiKey: 'sk-imported',
        model: 'deepseek-ai/DeepSeek-V4-Flash',
      },
    })
    expect(loaded).toEqual({
      loaded: true,
      applied: ['AGENT_LLM_BASE_URL', 'AGENT_LLM_API_KEY', 'AGENT_LLM_MODEL'],
    })
    expect(env.AGENT_LLM_API_KEY).toBe('sk-imported')
  })

  it('does not overwrite existing backend env unless explicitly requested', () => {
    const env: Record<string, string | undefined> = {
      AGENT_LLM_API_KEY: 'sk-existing',
    }

    expect(applyAgentLlmConfigToEnv({ apiKey: 'sk-next' }, { env })).toEqual([])
    expect(env.AGENT_LLM_API_KEY).toBe('sk-existing')
    expect(applyAgentLlmConfigToEnv({ apiKey: 'sk-next' }, { env, overwrite: true })).toEqual(['AGENT_LLM_API_KEY'])
    expect(env.AGENT_LLM_API_KEY).toBe('sk-next')
  })
})
