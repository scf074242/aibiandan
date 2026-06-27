const baseUrl = (process.argv.find((item) => item.startsWith('--url='))?.slice('--url='.length)
  || process.env.AGENT_BASE_URL
  || 'http://127.0.0.1:3000').replace(/\/$/, '')

const readJson = async (path) => {
  const response = await fetch(`${baseUrl}${path}`)
  const text = await response.text()
  let payload = null
  try {
    payload = text ? JSON.parse(text) : null
  } catch {
    payload = { raw: text }
  }
  return {
    ok: response.ok,
    status: response.status,
    payload,
  }
}

const writeJson = async (path, body) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await response.text()
  let payload = null
  try {
    payload = text ? JSON.parse(text) : null
  } catch {
    payload = { raw: text }
  }
  return {
    ok: response.ok,
    status: response.status,
    payload,
  }
}

const health = await readJson('/health')
const status = await readJson('/api/agent/status')
const llmConfig = await readJson('/api/agent/llm-config/status')
const endpoints = Array.isArray(status.payload?.endpoints) ? status.payload.endpoints : []
const probeSession = status.ok ? await writeJson('/api/agent/sessions', {}) : null
const probeSessionId = probeSession?.payload?.session?.id
const replayPackage = probeSessionId
  ? await readJson(`/api/agent/sessions/${encodeURIComponent(probeSessionId)}/replay`)
  : null
const checks = {
  serviceAlive: health.ok && health.payload?.ok === true,
  serverRuntime: status.ok && status.payload?.runtimeMode === 'server-runtime',
  pendingOwnedByServer: status.payload?.pendingOwner === 'agent-server-session',
  executionService: status.payload?.executionOwner === 'agent-server-execution-service',
  materialEvidenceService: status.payload?.materialEvidenceOwner === 'agent-server-material-evidence-service',
  eventStream: Boolean(status.payload?.eventStream?.snapshot && status.payload?.eventStream?.follow),
  replayPackageEndpoint: endpoints.includes('GET /api/agent/sessions/:sessionId/replay'),
  replayPackageReadable: Boolean(replayPackage?.ok && replayPackage.payload?.replayPackage?.session?.id === probeSessionId),
  llmConfigOwnedByServer: llmConfig.ok && llmConfig.payload?.llm?.owner === 'agent-server',
  llmConfigured: llmConfig.payload?.llm?.configured === true,
  sessionPersistence: status.payload?.sessionPersistence ?? 'unknown',
}

const report = {
  baseUrl,
  health,
  status,
  llmConfig,
  probeSession,
  replayPackage,
  checks,
  checkedAt: new Date().toISOString(),
}

console.log(JSON.stringify(report, null, 2))

if (!Object.entries(checks)
  .filter(([key]) => !['sessionPersistence', 'llmConfigured'].includes(key))
  .every(([, value]) => value === true)) {
  process.exitCode = 1
}
