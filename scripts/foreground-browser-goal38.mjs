import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '..')
const extraArgs = process.argv.slice(2).join(' ')

/**
 * Goal 38 browser regression entry.
 * Delegates to the shared Goal 37 runner with --goal=38 so that only the
 * recoverable-llm-retry-succeeds scenario is executed.
 */
execSync('node scripts/foreground-browser-goal37.mjs --goal=38 ' + extraArgs, {
  cwd: rootDir,
  stdio: 'inherit',
})