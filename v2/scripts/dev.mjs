import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
const vite = join(dirname(createRequire(import.meta.url).resolve('vite/package.json')), 'bin/vite.js')
const studioEnv = { ...process.env }
delete studioEnv.GOUO_RELAY_API_KEY
const children = [
  spawn(process.execPath, ['--env-file-if-exists=../../.env', 'src/main.mjs'], { cwd: fileURLToPath(new URL('../apps/api', import.meta.url)), stdio: 'inherit' }),
  spawn(process.execPath, [vite, '--host', '127.0.0.1'], { cwd: fileURLToPath(new URL('../apps/studio', import.meta.url)), stdio: 'inherit', env: studioEnv }),
]
let stopping = false
function stop(code = 0) { if (stopping) return; stopping = true; for (const child of children) child.kill('SIGTERM'); process.exitCode = code }
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => stop())
for (const child of children) child.on('exit', code => stop(code ?? 1))
for (const child of children) child.on('error', () => stop(1))
