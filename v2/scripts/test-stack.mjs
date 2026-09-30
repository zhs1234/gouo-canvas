import { spawn } from 'node:child_process'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import assert from 'node:assert/strict'

// 只管理本次创建的随机 Compose 项目，绝不接管已有实例或读取用户 .env。
// 每阶段回收该项目自动命名的构建镜像；不清理全局缓存、用户镜像或历史卷。
const directory = await mkdtemp(join(tmpdir(), 'gouo-stack-test-'))
const project = 'gouo-test-' + process.pid + '-' + Date.now().toString(36)
const port = process.env.GOUO_TEST_PORT || '18080'
const base = 'http://127.0.0.1:' + port
const environment = { ...process.env }
for (const name of Object.keys(environment)) if (name.startsWith('GOUO_') || name.startsWith('IMAGE_PROBE_')) delete environment[name]
Object.assign(environment, { GOUO_HTTP_PORT: port, GOUO_PUBLIC_ORIGIN: base, GOUO_STACK_URL: base, GOUO_ENABLE_GENERATION: 'false', GOUO_RUNTIME_DIR: directory, CI: 'true' })
const emptyEnv = join(directory, 'empty.env')
await writeFile(emptyEnv, '')
const args = ['compose', '--env-file', emptyEnv, '-p', project, '-f', 'deploy/compose.yml', '-f', 'tests/stack/compose.ephemeral.yml']
if (process.env.GOUO_STACK_BUILD_OVERRIDE) args.push('-f', resolve(process.env.GOUO_STACK_BUILD_OVERRIDE))
const buildArgs = ['--build-arg', 'HTTP_PROXY', '--build-arg', 'HTTPS_PROXY']
// CI 与受限开发环境可选官方原始仓库；digest 不变，不改为浮动标签。
if (process.env.GOUO_STACK_DOCKER_HUB === 'true') buildArgs.push(
  '--build-arg', 'NODE_IMAGE=docker.io/library/node:22-bookworm-slim@sha256:43ac6c60b8f89723f746e8a92ce91abd5017e627ce1ddfe4238355d3a30b772c',
  '--build-arg', 'NGINX_IMAGE=docker.io/library/nginx:stable-alpine@sha256:0985e772fb9f729e6fa0980da05fca5d9c468e870eed43071545afa9d2e27d94',
)
let fixture = false
let userMode = false
function run(command, argv) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, argv, { env: environment, stdio: 'inherit' })
    child.on('error', reject)
    child.on('exit', code => code === 0 ? resolvePromise() : reject(new Error(command + ' exited ' + code)))
  })
}
const compose = (...command) => run('docker', [...args, ...(fixture ? ['-f', 'tests/stack/compose.fixture.yml'] : []), ...(userMode ? ['-f', 'tests/stack/compose.users.yml'] : []), ...command])
async function request(path, init) {
  return fetch(base + path, { ...init, signal: AbortSignal.timeout(10000), redirect: 'manual' })
}
try {
  console.log('Phase 1: real pinned New API, uninitialized, no accounts/tokens/channels/providers')
  await compose('build', ...buildArgs)
  await compose('up', '-d', '--wait', '--wait-timeout', '180')
  assert.equal((await request('/')).status, 302)
  assert.equal((await request('/studio/')).status, 200)
  assert.equal((await request('/api/studio/health')).status, 200)
  const setup = await (await request('/api/setup')).json()
  assert.equal(setup.success, true)
  assert.equal(setup.data.status, false)
  assert.equal(setup.data.root_init, false)
  assert.equal((await request('/api/user/self')).status, 401)
  assert.equal((await (await request('/api/studio/models')).json()).data.generationEnabled, false)
  assert.equal((await request('/api/studio/runs', { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: '{}' })).status, 401)
  assert.equal((await request('/api/user/login', { method: 'POST', headers: { Origin: 'https://untrusted.invalid' } })).status, 403)
  assert.equal((await request('/v1/models')).status, 404)
  await run('node', ['scripts/stack-status.mjs'])
  await compose('down', '-v', '--remove-orphans', '--rmi', 'local')
  fixture = true
  console.log('Phase 2: explicit in-memory New API contract double, not real account/provider verification')
  await compose('build', ...buildArgs)
  await compose('up', '-d', '--wait', '--wait-timeout', '180')
  await run('npx', ['playwright', 'test', '--config', 'tests/stack/playwright.config.mjs'])
  await compose('down', '-v', '--remove-orphans')
  userMode = true
  environment.GOUO_STACK_PHASE = 'users'
  console.log('Phase 3: fresh ordinary users, explicit zero balance and fixture-only funding, native per-user token contract')
  await compose('up', '-d', '--wait', '--wait-timeout', '180')
  await run('npx', ['playwright', 'test', '--config', 'tests/stack/playwright.config.mjs'])
  console.log('Stack checks passed; no persistent credentials or paid calls were created')
} catch (error) {
  // 此随机栈只含公开 fixture 或未初始化服务，输出诊断不涉及用户配置。
  await compose('logs', '--no-color', '--tail', '60').catch(() => {})
  throw error
} finally {
  await compose('down', '-v', '--remove-orphans', '--rmi', 'local').catch(() => {})
  await rm(directory, { recursive: true, force: true })
}
