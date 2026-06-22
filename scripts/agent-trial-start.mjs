import { spawn } from 'node:child_process'
import { createWriteStream, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { loadAgentEnv } from './agent-env.mjs'

const readArg = (name, fallback) => {
  const prefix = `--${name}=`
  const value = process.argv.find((item) => item.startsWith(prefix))?.slice(prefix.length)
  return value || process.env[name.toUpperCase().replaceAll('-', '_')] || fallback
}

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
loadAgentEnv(rootDir)
const dataDir = resolve(rootDir, readArg('data-dir', '.agent-state/trial'))
const logsDir = resolve(dataDir, 'logs')
const host = readArg('host', '0.0.0.0')
const webHost = readArg('web-host', '0.0.0.0')
const port = readArg('port', '3000')
const webPort = readArg('web-port', '5173')
const sessionStore = resolve(dataDir, 'sessions.json')
const viteCli = resolve(rootDir, 'node_modules/vite/bin/vite.js')

mkdirSync(logsDir, { recursive: true })

const processes = []

const startProcess = (label, command, args, logFile) => {
  const log = createWriteStream(resolve(logsDir, logFile), { flags: 'a' })
  log.write(`\n\n[${new Date().toISOString()}] start ${label}: ${command} ${args.join(' ')}\n`)
  const child = spawn(command, args, {
    cwd: rootDir,
    env: {
      ...process.env,
      AGENT_SESSION_STORE_FILE: sessionStore,
      VITE_AGENT_RUNTIME_MODE: 'http',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  processes.push(child)
  child.stdout.on('data', (chunk) => {
    process.stdout.write(`[${label}] ${chunk}`)
    log.write(chunk)
  })
  child.stderr.on('data', (chunk) => {
    process.stderr.write(`[${label}] ${chunk}`)
    log.write(chunk)
  })
  child.on('exit', (code, signal) => {
    log.write(`\n[${new Date().toISOString()}] exit ${label}: code=${code} signal=${signal}\n`)
    log.end()
  })
  return child
}

console.log('AI编审助手办公网试用环境启动中...')
console.log(`前台地址: http://127.0.0.1:${webPort}/`)
console.log(`办公网访问: http://<本机局域网IP>:${webPort}/`)
console.log(`Agent Server: http://127.0.0.1:${port}`)
console.log(`状态文件: ${sessionStore}`)
console.log(`日志目录: ${logsDir}`)

startProcess('agent-server', 'node', [
  'scripts/agent-server.mjs',
  `--host=${host}`,
  `--port=${port}`,
  `--session-store=${sessionStore}`,
], 'agent-server.log')

startProcess('foreground', 'node', [
  viteCli,
  '--mode',
  'agent',
  '--host',
  webHost,
  '--port',
  webPort,
], 'foreground.log')

const shutdown = () => {
  console.log('\n正在停止 AI编审助手试用环境...')
  for (const child of processes) {
    if (!child.killed) child.kill('SIGTERM')
  }
  setTimeout(() => process.exit(0), 1000).unref()
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
