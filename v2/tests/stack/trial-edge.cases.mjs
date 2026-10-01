// Opt-in real Nginx + pinned New API integration. No fixture accounts or models.
// Run: node tests/stack/trial-edge.cases.mjs (Docker must already be running).
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { request as httpRequest } from 'node:http'
import { createServer as createSocketServer } from 'node:net'

const docker = process.env.GOUO_EDGE_TEST_DOCKER ?? 'docker'
const directory = await mkdtemp(join(tmpdir(), 'gouo-trial-edge-'))
const project = 'gouo-edge-test-' + process.pid + '-' + Date.now().toString(36)
const socket = createSocketServer()
await new Promise(res => socket.listen(0, '127.0.0.1', res))
const selectedPort = socket.address().port
await new Promise(res => socket.close(res))
const port = process.env.GOUO_EDGE_TEST_PORT ?? String(selectedPort)
assert.match(port, /^[0-9]{4,5}$/)
assert.notEqual(port, '8080', 'never target the existing stack port')
const origin = 'http://127.0.0.1:' + port
const file = join(directory, 'compose.yml'), emptyEnv = join(directory, 'empty.env')
let contractFile
const configPath = resolve('deploy/nginx.studio-only.conf').replaceAll('\\', '/')
const apiSourcePath = resolve('apps/api/src').replaceAll('\\', '/')
const studioDistPath = resolve('apps/studio/dist').replaceAll('\\', '/')
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
    volumes:
      - type: bind
        source: ${JSON.stringify(apiSourcePath)}
        target: /app/apps/api/src
        read_only: true
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
      - type: bind
        source: ${JSON.stringify(studioDistPath)}
        target: /usr/share/nginx/html/studio
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
function request(path, method = 'GET', headers = {}, body) {
  return new Promise((resolvePromise, reject) => {
    const req = httpRequest({ hostname: '127.0.0.1', port, path, method,
      headers: { Origin: origin, ...headers }, timeout: 10_000 }, response => {
      let body = ''; response.on('data', data => { body += data })
      response.on('end', () => resolvePromise({ status: response.statusCode, body, headers: response.headers }))
    })
    req.on('timeout', () => req.destroy(new Error('edge request timed out')))
    req.on('error', reject); req.end(body)
  })
}
try {
  await compose('up', '-d', '--wait', '--wait-timeout', '90')
  await compose('exec', '-T', 'web', 'nginx', '-t')
  const checksum = await compose('exec', '-T', 'new-api', 'sha256sum', '/usr/local/bin/new-api')
  assert.equal(checksum.split(' ')[0], 'a5fd598cc77e26ab2709305049fdd5fbbff722111be79f0ad89a493c3e094529')
  const studioRedirect = await request('/studio')
  assert.equal(studioRedirect.status, 301); assert.equal(studioRedirect.headers.location, '/studio/')
  assert.equal((await request('/')).headers.location, '/studio/')
  const status = await request('/api/status')
  assert.equal(status.status, 200); assert.equal(JSON.parse(status.body).success, true)
  assert.equal((await request('/api/user/self')).status, 401)
  assert.notEqual((await request('/api/user/auth/refresh', 'POST')).status, 404)
  assert.equal((await request('/api/user/self', 'DELETE')).status, 401)
  for (const path of ['/sign-in', '/sign-up', '/forgot-password', '/reset', '/otp', '/oauth/github', '/profile', '/security', '/keys', '/wallet', '/usage-logs']) {
    assert.equal((await request(path)).status, 200, path)
  }
  const html = (await request('/sign-in')).body
  assert.equal((html.match(/<script src="\/studio\/native-navigation\.js"><\/script>/g) ?? []).length, 1)
  const navigationScript = await request('/studio/native-navigation.js')
  assert.equal(navigationScript.status, 200)
  assert.match(navigationScript.body, /studio/)
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
  const protectedTokenRoutes = ['/api/token/', '/api/token/1', '/api/token/batch', '/api/token/1/key', '/api/token/batch/keys']
  const tokenAliases = ['/api//token/1/key', '/api/token/./1/key', '/api/token/x/../1/key', '/api/token/1/%6bey', '/api/token/1/key/', '/api/token/1/key%2f', '/api/token/1/key;extract=true', '/api/token%2f1/key']
  const assertTokenProtection = async (headers = {}) => {
    for (const path of protectedTokenRoutes) for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']) {
      assert.equal((await request(path, method, headers)).status, 404, method + ' ' + path)
    }
    for (const path of ['/api/token/1/key', '/api/token/batch/keys', ...tokenAliases]) for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']) {
      assert.equal((await request(path, method, headers)).status, 404, method + ' ' + path)
    }
    for (const path of ['/api/token/?id=1', '/api/token/1/key?extract=true', '/api/token/batch/keys?ids=1']) {
      assert.equal((await request(path, 'POST', headers)).status, 404, path)
    }
  }
  await assertTokenProtection()
  for (const path of ['/api/token/', '/api/token/search', '/api/token/1', '/api/user/token/status']) assert.equal((await request(path)).status, 401, 'masked/native status read remains reachable: ' + path)
  // /api/user/token creates a dashboard account PAT, not a model relay key.
  // It remains Native-owned and requires its narrower security proof.
  for (const method of ['GET', 'POST', 'DELETE']) assert.equal((await request('/api/user/token', method)).status, 401)
  const profileWriteAliases = ['/api/user/self/', '/api//user/self', '/api/user/./self', '/api/user/x/../self',
    '/api/user/%73elf', '/api/user/self%2f', '/api/user/self//', '/api/user/self;language=zh']
  for (const path of profileWriteAliases) for (const method of ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
    assert.equal((await request(path, method)).status, 404, method + ' ' + path)
  }
  assert.equal((await request('/api/user/self', 'PUT')).status, 401)
  for (const method of ['HEAD', 'POST', 'PATCH', 'OPTIONS']) {
    assert.equal((await request('/api/user/self', method)).status, 404, method + ' exact self')
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
  const echo = "let puts=0,protectedTokenCalls=0;require('node:http').createServer((req,res)=>{res.setHeader('Content-Type','application/json');if(req.url==='/fixture-stats'){res.end(JSON.stringify({puts,protectedTokenCalls}));return}if(req.url.startsWith('/api/token/')&&(req.method!=='GET'||req.url.includes('/key')))protectedTokenCalls++;if(req.method==='PUT')puts++;const record={fixture:true,path:req.url,headers:req.headers,success:true,message:'',data:{id:7,status:1,group:'default',quota:0}};res.end(JSON.stringify(record))}).listen(3000,'0.0.0.0')"
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
  const stats = async () => JSON.parse((await compose('exec', '-T', 'studio-api', 'node', '-e', "fetch('http://new-api:3000/fixture-stats').then(r=>r.text()).then(console.log)")).trim())
  await assertTokenProtection(fixtureHeaders)
  assert.equal((await stats()).protectedTokenCalls, 0, 'caller credentials cannot forward a token write or complete-key request')
  for (const path of ['/api/token/', '/api/token/search', '/api/token/1', '/api/user/token/status']) {
    const record = JSON.parse((await request(path, 'GET', fixtureHeaders)).body)
    assert.equal(record.headers.authorization, fixtureHeaders.Authorization)
  }
  for (const body of [{ language: 'zh' }, { sidebar_modules: '{}' }, { role: 100 }, { password_encrypted: 'fixture', encryption_key_id: 'fixture' }, { display_name: 'fixture', password: 'fixture-password' }]) {
    for (const path of ['/api/user/self', '/api/user/self?language=zh']) {
      assert.equal((await request(path, 'PUT', { ...fixtureHeaders, 'Content-Type': 'application/json' }, JSON.stringify(body))).status, 422, path)
    }
    for (const path of profileWriteAliases) {
      assert.equal((await request(path, 'PUT', { ...fixtureHeaders, 'Content-Type': 'application/json' }, JSON.stringify(body))).status, 404, path)
    }
  }
  assert.equal((await stats()).puts, 0, 'invalid update bodies never reach Native PUT')
  const profile = await request('/api/user/self', 'PUT', { ...fixtureHeaders, 'Content-Type': 'application/json' }, JSON.stringify({ display_name: 'fixture profile' }))
  assert.equal(profile.status, 200)
  const forwarded = JSON.parse(profile.body)
  assert.equal(forwarded.fixture, true); assert.equal(forwarded.path, '/api/user/self')
  assert.equal(forwarded.headers.authorization, fixtureHeaders.Authorization)
  assert.equal(forwarded.headers.cookie, undefined)
  assert.equal((await stats()).puts, 1, 'valid profile body reaches exactly one Native PUT')
  console.log('Prepared token boundary passed: model token writes/full keys blocked with and without caller credentials and alternate paths; masked reads and Native account-PAT/status remain separate. Relative Studio redirect and actual Native HTML navigation injection verified.')
  console.log('Explicit Nginx echo contract passed: HTML/static strips credentials/query; account GET retains Bearer; exact PUT uses current Studio bridge, invalid bodies reach zero Native PUTs and valid profile reaches one. This is not live plugin/MFA verification.')
} catch (error) {
  console.error(await compose('logs', '--no-color', '--tail', '25').catch(() => ''))
  throw error
} finally {
  await compose('down', '-v', '--remove-orphans').catch(error => console.error(error.message))
  await rm(directory, { recursive: true, force: true })
}
