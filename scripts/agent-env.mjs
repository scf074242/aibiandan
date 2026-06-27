import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

export const AGENT_ENV_FILES = [
  '.env.agent.local',
  '.env.agent',
  '.env.local',
  '.env.development',
  '.env',
]

const stripOuterQuotes = (value) => {
  if (value.length < 2) return value
  const quote = value[0]
  if ((quote !== '"' && quote !== "'") || value[value.length - 1] !== quote) return value
  const inner = value.slice(1, -1)
  return quote === '"'
    ? inner.replaceAll('\\n', '\n').replaceAll('\\"', '"')
    : inner
}

export const parseAgentEnvLine = (line) => {
  const normalized = line.replace(/^\uFEFF/, '').trim()
  if (!normalized || normalized.startsWith('#')) return null
  const withoutExport = normalized.startsWith('export ')
    ? normalized.slice('export '.length).trim()
    : normalized
  const separatorIndex = withoutExport.indexOf('=')
  if (separatorIndex <= 0) return null

  const key = withoutExport.slice(0, separatorIndex).trim()
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return null

  const rawValue = withoutExport.slice(separatorIndex + 1).trim()
  const value = rawValue.startsWith('"') || rawValue.startsWith("'")
    ? stripOuterQuotes(rawValue)
    : rawValue.replace(/\s+#.*$/, '').trim()

  return { key, value }
}

export const loadAgentEnv = (rootDir, options = {}) => {
  const targetEnv = options.env ?? process.env
  const files = options.files ?? AGENT_ENV_FILES
  const loaded = []

  for (const file of files) {
    const filePath = resolve(rootDir, file)
    if (!existsSync(filePath)) continue

    const loadedKeys = []
    const content = readFileSync(filePath, 'utf8')
    for (const line of content.split(/\r?\n/)) {
      const parsed = parseAgentEnvLine(line)
      if (!parsed) continue
      if (targetEnv[parsed.key]) continue
      targetEnv[parsed.key] = parsed.value
      loadedKeys.push(parsed.key)
    }

    if (loadedKeys.length > 0) {
      loaded.push({ file, keys: loadedKeys })
    }
  }

  return loaded
}

export const applyAgentLlmConfigToEnv = (config, options = {}) => {
  const targetEnv = options.env ?? process.env
  const overwrite = options.overwrite === true
  const applied = []
  const pairs = [
    ['AGENT_LLM_BASE_URL', config?.baseURL],
    ['AGENT_LLM_API_KEY', config?.apiKey],
    ['AGENT_LLM_MODEL', config?.model],
  ]

  for (const [key, value] of pairs) {
    const normalized = typeof value === 'string' ? value.trim() : ''
    if (!normalized) continue
    if (!overwrite && targetEnv[key]) continue
    targetEnv[key] = normalized
    applied.push(key)
  }

  return applied
}

export const readAgentLlmConfigStore = (filePath) => {
  if (!filePath || !existsSync(filePath)) return null
  const parsed = JSON.parse(readFileSync(filePath, 'utf8'))
  return parsed?.config && typeof parsed.config === 'object' ? parsed.config : null
}

export const loadAgentLlmConfigStore = (filePath, options = {}) => {
  const config = readAgentLlmConfigStore(filePath)
  if (!config) return { loaded: false, applied: [] }
  return {
    loaded: true,
    applied: applyAgentLlmConfigToEnv(config, options),
  }
}

export const writeAgentLlmConfigStore = (filePath, config) => {
  mkdirSync(dirname(filePath), { recursive: true })
  const payload = {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    config: {
      baseURL: config.baseURL,
      apiKey: config.apiKey,
      model: config.model,
    },
  }
  const tempPath = `${filePath}.tmp`
  writeFileSync(tempPath, JSON.stringify(payload, null, 2), 'utf8')
  renameSync(tempPath, filePath)
}
