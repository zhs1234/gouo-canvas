// Opt-in real Nginx + pinned New API integration. No fixture accounts or models.
// Run: node tests/stack/trial-edge.cases.mjs (Docker must already be running).
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { request as httpRequest } from 'node:http'

const docker = process.env.GOUO_EDGE_TEST_DOCKER ?? 'docker'
const directory = await mkdtemp(join(tmpdir(), 'gouo-trial-edge-'))
const project = 'gouo-edge-test-' + process.pid + '-' + Date.now().toString(36)
const port = process.env.GOUO_EDGE_TEST_PORT ?? '18081'
assert.match(port, /^[0-9]{4,5}$/)
assert.notEqual(port, '8080', 'never target the existing stack port')
const origin = 'http://127.0.0.1:' + port
const file = join(directory, 'compose.yml'), emptyEnv = join(directory, 'empty.env')
let contractFile
const configPath = resolve('deploy/nginx.studio-only.conf').replaceAll('\\', '/')
await writeFile(emptyEnv, '')
await writeFile(file, `services:
  new-api:
    image: gouo-v2-new-api:latest
    environment:
      PORT: '3000'
      SQLITE_PATH: /data/new-api.db
      TRUSTED_PROXIES: none
    tmpfs: ['/data']
    healthcheck:
      test: [CMD, node, -e, "fetch('http://127.0.0.1:3000/api/status').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
      interval: 1s
      retries: 60
  studio-api:
    image: gouo-v2-studio-api:latest
    environment:
      GOUO_STUDIO_HOST: 0.0.0.0
      GOUO_BACKEND_DEV_TARGET: http://new-api:3000
      GOUO_GATEWAY_BASE_URL: http://new-api:3000/v1
      GOUO_STUDIO_LEDGER_PATH: /data/requests.sqlite
      GOUO_ENABLE_GENERATION: 'false'
    tmpfs: ['/data:uid=1000,gid=1000,mode=0700']
  web:
    image: gouo-v2-web:latest
    environment:
      GOUO_PUBLIC_ORIGIN: '${origin}'
    ports: ['127.0.0.1:${port}:8080']
    volumes:
      - type: bind
        source: ${JSON.stringify(configPath)}
        target: /etc/nginx/templates/default.conf.template
        read_only: true
    depends_on:
      new-api: {condition: service_healthy}
      studio-api: {condition: service_started}
    healthcheck:
      test: [CMD, wget, -q, -O, /dev/null, http://127.0.0.1:8080/healthz]
      interval: 1s
      retries: 60
`)
function compose(...args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(docker, ['compose', '--env-file', emptyEnv, '-p', project, '-f', file, ...(contractFile ? ['-f', contractFile] : []), ...args], { stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.on('data', data => { output += data })
    child.stderr.on('data', data => { output += data })
    child.on('error', reject)
    child.on('exit', code => code === 0 ? resolvePromise(output) : reject(new Error(output)))
  })
}
// Raw path requests avoid the URL client's dot-segment normalization.
function request(path, method = 'GET', headers = {}) {
  return new Promise((resolvePromise, reject) => {
    const req = httpRequest({ hostname: '127.0.0.1', port, path, method,
      headers: { Origin: origin, ...headers }, timeout: 10_000 }, response => {
      let body = ''; response.on('data', data => { body += data })
      response.on('end', () => resolvePromise({ status: response.statusCode, body }))
    })
    req.on('timeout', () => req.destroy(new Error('edge request timed out')))
    req.on('error', reject); req.end()
  })
}
try {
  await compose('up', '-d', '--wait', '--wait-timeout', '90')
  await compose('exec', '-T', 'web', 'nginx', '-t')
  const status = await request('/api/status')
  assert.equal(status.status, 200); assert.equal(JSON.parse(status.body).success, true)
  assert.equal((await request('/api/user/self')).status, 401)
  assert.notEqual((await request('/api/user/auth/refresh', 'POST')).status, 404)
  assert.notEqual((await request('/api/user/self', 'PUT')).status, 404)
  for (const path of ['/sign-in', '/sign-up', '/forgot-password', '/reset', '/otp', '/oauth/github', '/profile', '/security', '/keys', '/wallet', '/usage-logs']) {
    assert.equal((await request(path)).status, 200, path)
  }
  const html = (await request('/sign-in')).body
  const assets = [...html.matchAll(/(?:src|href)="(\/[^"?]+)"/g)].map(match => match[1]).filter(path => /\.(js|css)$/.test(path))
  assert.ok(assets.length > 0, 'actual native HTML contains static JS/CSS')
  for (const path of assets) assert.equal((await request(path)).status, 200, path)
  assert.equal((await request('/studio/')).status, 200)
  assert.equal((await request('/api/studio/health')).status, 200)
  const denied = ['/v1', '/v1/models', '/v1/chat/completions', '/v1/realtime', '/v1beta/models', '/pg/chat/completions',
    '/mj/task/123/fetch', '/fast/mj/task/123/fetch', '/dashboard/billing/usage', '/dynamic-plugin/run', '/api/dynamic-plugin/run',
    '/api/setup', '/api/user/', '/api/channel/test', '/api/subscription/admin/plans', '/api/plugin/task', '/api/unknown', '/users', '/channels',
    '/api/status/extra', '/api//status', '/api/./status', '/api/x/../status', '/api/%73tatus', '/%76%31/models', '/studio/../v1/models', '/api\\status',
    '/setup', '/dashboard', '/task-plugins', '/api/channel/1/key', '/api/subscription/balance/pay']
  for (const path of denied) for (const method of ['GET', 'POST']) {
    assert.equal((await request(path, method)).status, 404, method + ' ' + path)
  }
  for (const path of ['/api/user/setting', '/api/subscription/self/preference']) {
    assert.equal((await request(path, 'PUT')).status, 404, path)
  }
  assert.equal((await request('/api/status', 'POST')).status, 404)
  assert.equal((await request('/sign-in', 'POST')).status, 404)
  assert.equal((await request('/api/status?encoded=%2f%2f')).status, 200)
  assert.equal((await request('/api/status', 'GET', { Upgrade: 'websocket', Connection: 'Upgrade' })).status, 404)
  assert.equal((await request('/v1/realtime', 'GET', { Upgrade: 'websocket', Connection: 'Upgrade' })).status, 404)
  const internal = await compose('exec', '-T', 'studio-api', 'node', '-e',
    "Promise.all(['/api/status','/v1/models'].map(async p=>[p,(await fetch('http://new-api:3000'+p)).status])).then(v=>console.log(JSON.stringify(v)))")
  assert.deepEqual(JSON.parse(internal.trim()), [['/api/status', 200], ['/v1/models', 401]])
  const resolved = await compose('config', '--format', 'json')
  const services = JSON.parse(resolved).services
  assert.equal(services['new-api'].ports, undefined)
  assert.equal(services['studio-api'].ports, undefined)
  console.log('Real isolated Nginx/New API checks passed: ordinary account paths reachable; relay/admin/unknown/preference paths blocked; internal gateway reachable without host publishing. Empty native plugin registry; no accounts or model calls created.')
  await compose('down', '-v', '--remove-orphans')
  // Explicit contract echo only: proves Nginx credential/query stripping.
  // This does not install or live-verify any native task plugin.
  contractFile = join(directory, 'contract.yml')
  const echo = "require('node:http').createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({fixture:true,path:req.url,headers:req.headers}))}).listen(3000,'0.0.0.0')"
  await writeFile(contractFile, JSON.stringify({ services: { 'new-api': { entrypoint: ['node'], command: ['-e', echo] } } }))
  await compose('up', '-d', '--wait', '--wait-timeout', '90')
  const fixtureHeaders = {
    Authorization: 'Bearer fixture-not-a-real-token', Cookie: 'fixture=not-a-real-cookie',
    'x-api-key': 'fixture-key', 'x-goog-api-key': 'fixture-key', 'mj-api-secret': 'fixture-key',
    'Sec-WebSocket-Protocol': 'openai-insecure-api-key.fixture-key',
  }
  for (const path of ['/sign-in?redirect=%2Fstudio%2F&key=fixture-key', '/assets/fixture.js?api_key=fixture-key']) {
    const response = await request(path, 'GET', fixtureHeaders)
    assert.equal(response.status, 200)
    const record = JSON.parse(response.body)
    assert.equal(record.fixture, true)
    assert.equal(record.path, path.split('?')[0])
    for (const header of ['authorization', 'cookie', 'x-api-key', 'x-goog-api-key', 'mj-api-secret', 'sec-websocket-protocol', 'upgrade']) {
      assert.equal(record.headers[header], undefined, header)
    }
  }
  const account = JSON.parse((await request('/api/user/self', 'GET', fixtureHeaders)).body)
  assert.equal(account.headers.authorization, fixtureHeaders.Authorization, 'registered native account API retains its authentication')
  console.log('Explicit Nginx echo contract passed: HTML/static upstream sees no caller credentials or query; native account API still receives its Bearer. This is not live plugin/MFA verification.')
} catch (error) {
  console.error(await compose('logs', '--no-color', '--tail', '25').catch(() => ''))
  throw error
} finally {
  await compose('down', '-v', '--remove-orphans').catch(error => console.error(error.message))
  await rm(directory, { recursive: true, force: true })
}
