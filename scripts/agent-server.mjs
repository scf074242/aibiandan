import http from 'node:http'

const readArg = (name, fallback) => {
  const prefix = `--${name}=`
  const value = process.argv.find((item) => item.startsWith(prefix))?.slice(prefix.length)
  return value || process.env[name.toUpperCase()] || fallback
}

const host = readArg('host', process.env.AGENT_HOST || '127.0.0.1')
const port = Number(readArg('port', process.env.AGENT_PORT || '3000'))

const json = (response, statusCode, payload) => {
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  response.end(JSON.stringify(payload, null, 2))
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url || '/', `http://${request.headers.host || `${host}:${port}`}`)

  if (request.method === 'GET' && url.pathname === '/health') {
    json(response, 200, {
      ok: true,
      service: 'aibiandan-agent',
      stage: 'runtime-client-boundary',
      time: new Date().toISOString(),
    })
    return
  }

  if (request.method === 'GET' && url.pathname === '/api/agent/status') {
    json(response, 200, {
      service: 'aibiandan-agent',
      migrationStep: 'phase-1-protocol-freeze',
      runtimeMode: 'local-client-wrapper',
      nextBoundary: 'http-runtime-client',
      endpoints: [
        'GET /health',
        'GET /api/agent/status',
      ],
    })
    return
  }

  json(response, 404, {
    error: 'not_found',
    message: 'Agent service endpoint not found.',
  })
})

server.listen(port, host, () => {
  console.log(`AI编审助手 Agent service listening on http://${host}:${port}`)
})

const shutdown = () => {
  server.close(() => {
    process.exit(0)
  })
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
