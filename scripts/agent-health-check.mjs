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

const health = await readJson('/health')
const status = await readJson('/api/agent/status')

const report = {
  baseUrl,
  health,
  status,
  checkedAt: new Date().toISOString(),
}

console.log(JSON.stringify(report, null, 2))

if (!health.ok || !status.ok) {
  process.exitCode = 1
}
