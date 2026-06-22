import http from 'node:http'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createJiti } from 'jiti'

const readArg = (name, fallback) => {
  const prefix = `--${name}=`
  const value = process.argv.find((item) => item.startsWith(prefix))?.slice(prefix.length)
  return value || process.env[name.toUpperCase()] || fallback
}

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const jiti = createJiti(import.meta.url, {
  alias: {
    '@': resolve(rootDir, 'src'),
  },
})
const { AgentServerRuntime, getAgentServerRuntime } = await jiti.import('../src/services/runtime/agentServerRuntime.ts')
const { AgentServerFileSessionStore } = await jiti.import('../src/services/runtime/agentServerFileSessionStore.ts')

const host = readArg('host', process.env.AGENT_HOST || '127.0.0.1')
const port = Number(readArg('port', process.env.AGENT_PORT || '3000'))
const sessionStoreFile = readArg('session-store', process.env.AGENT_SESSION_STORE_FILE || '')
const runtime = sessionStoreFile
  ? new AgentServerRuntime({ sessions: new AgentServerFileSessionStore(sessionStoreFile) })
  : getAgentServerRuntime()

const buildHeaders = (request) => ({
  'access-control-allow-origin': request.headers.origin || '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'content-type',
  'cache-control': 'no-store',
})

const json = (request, response, statusCode, payload) => {
  response.writeHead(statusCode, {
    ...buildHeaders(request),
    'content-type': 'application/json; charset=utf-8',
  })
  response.end(JSON.stringify(payload, null, 2))
}

const readJsonBody = async (request) => {
  const chunks = []
  for await (const chunk of request) {
    chunks.push(chunk)
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim()
  if (!raw) return {}
  return JSON.parse(raw)
}

const unwrapInput = (body) => body?.input ?? body

const writeSseEvent = (response, event) => {
  response.write(`event: ${event.type}\n`)
  response.write(`data: ${JSON.stringify(event)}\n\n`)
}

const writeSse = (request, response, events, options = {}) => {
  response.writeHead(200, {
    ...buildHeaders(request),
    'content-type': 'text/event-stream; charset=utf-8',
    connection: 'keep-alive',
  })
  for (const event of events) {
    writeSseEvent(response, event)
  }
  response.write('event: ready\n')
  response.write(`data: ${JSON.stringify({ ok: true, time: new Date().toISOString() })}\n\n`)
  if (!options.follow || !options.sessionId) {
    response.end()
    return
  }
  const unsubscribe = runtime.subscribeSessionEvents(options.sessionId, (event) => {
    writeSseEvent(response, event)
  })
  const heartbeat = setInterval(() => {
    response.write('event: heartbeat\n')
    response.write(`data: ${JSON.stringify({ ok: true, time: new Date().toISOString() })}\n\n`)
  }, 15000)
  request.on('close', () => {
    clearInterval(heartbeat)
    unsubscribe()
  })
}

const handlePost = async (request, response, url) => {
  const body = await readJsonBody(request)
  const sessionMessageMatch = url.pathname.match(/^\/api\/agent\/sessions\/([^/]+)\/messages$/)
  const sessionContinueMatch = url.pathname.match(/^\/api\/agent\/sessions\/([^/]+)\/tasks\/([^/]+)\/continue$/)
  const sessionStopMatch = url.pathname.match(/^\/api\/agent\/sessions\/([^/]+)\/tasks\/([^/]+)\/stop$/)

  if (url.pathname === '/api/agent/sessions') {
    json(request, response, 200, {
      session: runtime.createSession(),
    })
    return
  }

  if (url.pathname === '/api/agent/submit') {
    const result = await runtime.submitInstruction(unwrapInput(body), body.sessionId)
    json(request, response, 200, result)
    return
  }

  if (sessionMessageMatch) {
    const [, sessionId] = sessionMessageMatch
    const result = await runtime.submitInstruction(unwrapInput(body), sessionId)
    json(request, response, 200, result)
    return
  }

  if (url.pathname === '/api/agent/pending/execute') {
    const result = await runtime.executePendingCommand(unwrapInput(body), body.sessionId)
    json(request, response, 200, result)
    return
  }

  if (url.pathname === '/api/agent/pending/target-selection') {
    const result = await runtime.resolvePendingTargetSelection(unwrapInput(body), body.sessionId)
    json(request, response, 200, result)
    return
  }

  if (url.pathname === '/api/agent/pending/insert-recommendation') {
    const result = await runtime.resolvePendingInsertRecommendation(unwrapInput(body), body.sessionId)
    json(request, response, 200, result)
    return
  }

  if (sessionContinueMatch) {
    const [, sessionId] = sessionContinueMatch
    const input = unwrapInput(body)
    if (!input?.scheduleState || !input?.currentSchedule) {
      json(request, response, 400, {
        error: 'missing_runtime_input',
        message: '继续任务需要携带当前播单状态。',
      })
      return
    }
    const result = await runtime.submitInstruction({
      ...input,
      userInput: input.userInput || '继续',
    }, sessionId)
    json(request, response, 200, result)
    return
  }

  if (sessionStopMatch) {
    const [, sessionId] = sessionStopMatch
    const session = runtime.stopReactTask(sessionId)
    if (!session) {
      json(request, response, 404, {
        error: 'session_not_found',
        message: '没有找到这次 AI 编审助手会话。',
      })
      return
    }
    json(request, response, 200, { session })
    return
  }

  json(request, response, 404, {
    error: 'not_found',
    message: 'Agent service endpoint not found.',
  })
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url || '/', `http://${request.headers.host || `${host}:${port}`}`)

    if (request.method === 'OPTIONS') {
      response.writeHead(204, buildHeaders(request))
      response.end()
      return
    }

    if (request.method === 'GET' && url.pathname === '/health') {
      json(request, response, 200, {
        ok: true,
        service: 'aibiandan-agent',
        stage: 'formal-playlist-and-event-stream-migration',
        time: new Date().toISOString(),
      })
      return
    }

    if (request.method === 'GET' && url.pathname === '/api/agent/status') {
      json(request, response, 200, {
        service: 'aibiandan-agent',
        migrationStep: 'phase-4-to-phase-6-formal-playlist-events-batch-evidence-deployment',
        runtimeMode: 'server-runtime',
        llmContextOwner: 'agent-server',
        reactTaskOwner: 'agent-server-session',
        formalPlaylistOwner: 'agent-server-session',
        sessionPersistence: sessionStoreFile ? 'file' : 'memory',
        eventStream: {
          snapshot: 'GET /api/agent/sessions/:sessionId/events',
          follow: 'GET /api/agent/sessions/:sessionId/events?follow=1',
        },
        endpoints: [
          'GET /health',
          'GET /api/agent/status',
          'POST /api/agent/sessions',
          'POST /api/agent/submit',
          'POST /api/agent/sessions/:sessionId/messages',
          'POST /api/agent/pending/execute',
          'POST /api/agent/pending/target-selection',
          'POST /api/agent/pending/insert-recommendation',
          'POST /api/agent/sessions/:sessionId/tasks/:taskId/continue',
          'POST /api/agent/sessions/:sessionId/tasks/:taskId/stop',
          'GET /api/agent/sessions/:sessionId/events',
        ],
      })
      return
    }

    const sessionMatch = url.pathname.match(/^\/api\/agent\/sessions\/([^/]+)$/)
    if (request.method === 'GET' && sessionMatch) {
      const session = runtime.getSession(sessionMatch[1])
      json(request, response, session ? 200 : 404, session ? { session } : {
        error: 'session_not_found',
        message: '没有找到这次 AI 编审助手会话。',
      })
      return
    }

    const eventsMatch = url.pathname.match(/^\/api\/agent\/sessions\/([^/]+)\/events$/)
    if (request.method === 'GET' && eventsMatch) {
      const sessionId = eventsMatch[1]
      writeSse(request, response, runtime.getSessionEvents(sessionId), {
        follow: url.searchParams.get('follow') === '1' || url.searchParams.get('follow') === 'true',
        sessionId,
      })
      return
    }

    if (request.method === 'POST') {
      await handlePost(request, response, url)
      return
    }

    json(request, response, 404, {
      error: 'not_found',
      message: 'Agent service endpoint not found.',
    })
  } catch (error) {
    json(request, response, 500, {
      error: 'agent_server_error',
      message: error instanceof Error ? error.message : 'Agent service failed.',
    })
  }
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
