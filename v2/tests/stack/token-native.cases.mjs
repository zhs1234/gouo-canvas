// Real fixed Native token HTTP contract, isolated synthetic accounts only.
// Random loopback ingress is a test convenience, not prepared-edge exclusivity proof.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createServer } from '../../apps/api/src/server.mjs'
import { loadConfig } from '../../apps/api/src/config.mjs'

await mkdir(resolve('.local'), { recursive: true })
const directory = await mkdtemp(resolve('.local/native-token-'))
const project = 'gouo-native-token-' + process.pid + '-' + Date.now().toString(36)
const docker = process.env.GOUO_NATIVE_TEST_DOCKER ?? 'docker'
const file = join(directory, 'compose.yml'), env = join(directory, 'empty.env')
await mkdir(join(directory, 'data')); await writeFile(env, '')
await writeFile(file, `services:
  new-api:
    image: gouo-v2-new-api:latest
    environment:
      PORT: '3000'
      SQLITE_PATH: /data/new-api.db
      TRUSTED_PROXIES: none
      SESSION_SECRET: synthetic-token-test-session-secret
    ports: ['127.0.0.1::3000']
    volumes:
      - type: bind
        source: ${JSON.stringify(join(directory, 'data').replaceAll('\\', '/'))}
        target: /data
`)
function compose(...args) {
  return new Promise((res, reject) => {
    const child = spawn(docker, ['compose', '--env-file', env, '-p', project, '-f', file, ...args], { stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''; child.stdout.on('data', c => { output += c }); child.stderr.on('data', c => { output += c })
    child.on('error', reject); child.on('exit', code => code === 0 ? res(output.trim()) : reject(new Error('Isolated Docker operation failed: ' + code)))
  })
}
let origin, studio
const password = 'Synthetic_token_2026!', sourceCommit = '0aec08fee811ec6136828fda790551b49e410301'
async function native(path, auth, body) {
  const response = await fetch(origin + path, { method: body === undefined ? 'GET' : 'POST', headers: {
    Origin: origin, ...(auth ? { Authorization: 'Bearer ' + auth } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), redirect: 'error', signal: AbortSignal.timeout(15000) })
  const result = await response.json(); assert.equal(result.success, true, 'Synthetic Native API must succeed: ' + path)
  return result.data
}
const sqlite = async code => compose('exec', '-T', 'new-api', 'node', '-e', `const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync('/data/new-api.db');${code};db.close()`)
async function snapshot(owner) {
  return JSON.parse((await sqlite(`console.log(JSON.stringify({user:db.prepare('SELECT quota,used_quota,request_count FROM users WHERE id=?').get(${owner}),
    subscriptions:db.prepare('SELECT * FROM user_subscriptions WHERE user_id=?').all(${owner}),
    logs:db.prepare('SELECT COUNT(*) AS n FROM logs WHERE user_id=? AND type=2').get(${owner}).n}))`)).split('\n').find(l => l.startsWith('{')))
}
try {
  await compose('up', '-d')
  const published = await compose('port', 'new-api', '3000'); assert.match(published, /^127\.0\.0\.1:\d+$/); assert.notEqual(published, '127.0.0.1:8080')
  origin = 'http://' + published
  for (let i = 0; i < 60; i++) { try { if ((await fetch(origin + '/api/status')).ok) break } catch {} await new Promise(r => setTimeout(r, 500)) }
  const checksum = (await compose('exec', '-T', 'new-api', 'sha256sum', '/usr/local/bin/new-api')).split(' ')[0]
  assert.equal(checksum, 'a5fd598cc77e26ab2709305049fdd5fbbff722111be79f0ad89a493c3e094529')
  await native('/api/setup', undefined, { username: 'fixture-root', password, confirmPassword: password, SelfUseModeEnabled: false, DemoSiteEnabled: false })
  await sqlite(`for(const [key,value] of Object.entries({QuotaForNewUser:'0',RetryTimes:'0','payment_setting.compliance_confirmed':'true','payment_setting.compliance_terms_version':'v1'}))db.prepare('INSERT OR REPLACE INTO options(key,value) VALUES(?,?)').run(key,value)`)
  await compose('restart', 'new-api'); origin = 'http://' + await compose('port', 'new-api', '3000')
  for (let i = 0; i < 60; i++) { try { if ((await fetch(origin + '/api/status')).ok) break } catch {} await new Promise(r => setTimeout(r, 500)) }
  const admin = await native('/api/user/login', undefined, { username: 'fixture-root', password })
  // Synthetic channel establishes model permissions only. No provider endpoint exists.
  await native('/api/channel/', admin.access_token, { mode: 'single', channel: { type: 1, name: 'Token contract fixture; never invoked',
    key: 'synthetic-unused-provider-key', status: 1, base_url: 'http://127.0.0.1:1', models: 'fixture-chat', group: 'default' } })
  const instanceId = randomUUID(), routingPath = join(directory, 'routing.json'), policyPath = join(directory, 'policy.json'), modelsPath = join(directory, 'models.json')
  await writeFile(routingPath, JSON.stringify({ sourceCommit, gatewayOrigin: origin, retryTimes: 0, operatorVerified: true, verifiedAt: new Date().toISOString() }))
  await writeFile(policyPath, JSON.stringify({ sourceCommit, gatewayOrigin: origin, instanceId, operatorVerified: true, relayIngress: 'studio-only',
    tokenWrites: 'studio-only', completeKeys: 'studio-only', redisEnabled: false, batchUpdateEnabled: false }))
  // This synthetic config exercises the HTTP contract only. It is not a live model verification or public-edge attestation.
  await writeFile(modelsPath, JSON.stringify({ models: [{ id: 'fixture-chat', displayName: 'Synthetic permissions fixture', kind: 'chat',
    upstreamModelId: 'fixture-chat', enabled: true, verification: 'live-verified' }] }))
  const config = loadConfig({ GOUO_STUDIO_MODELS_FILE: modelsPath, GOUO_GATEWAY_BASE_URL: origin + '/v1', GOUO_BACKEND_DEV_TARGET: origin,
    GOUO_RELAY_CREDENTIAL_MODE: 'user-token', GOUO_RELAY_ROUTING_MODE: 'model', GOUO_USER_TOKEN_QUOTA_CAP: '100',
    GOUO_USER_TOKEN_LIFETIME_SECONDS: '3600', GOUO_ACCOUNT_INSTANCE_ID: instanceId, GOUO_NORMAL_ROUTING_EVIDENCE_FILE: routingPath,
    GOUO_ENABLE_TOKEN_RENEWAL: 'true', GOUO_TOKEN_RENEWAL_POLICY_FILE: policyPath, GOUO_ENABLE_GENERATION: 'true', GOUO_STUDIO_LEDGER_PATH: join(directory, 'studio.sqlite') })
  const calls = []
  studio = createServer(config, { fetch: async (url, options) => {
    assert.ok(url.pathname.startsWith('/api/') || url.pathname === '/v1/models', 'Test forbids model endpoints')
    calls.push({ path: url.pathname, method: options?.method ?? 'GET' }); return fetch(url, options)
  } })
  const evidence = []
  for (const kind of ['expired', 'exhausted']) {
    const username = 'fixture-' + kind
    await native('/api/user/register', undefined, { username, password })
    const login = await native('/api/user/login', undefined, { username, password }), owner = login.user.id, auth = login.access_token
    await sqlite(`db.prepare('UPDATE users SET quota=1000 WHERE id=?').run(${owner})`)
    const expiredTime = Math.floor(Date.now() / 1000) + (kind === 'expired' ? -120 : 3600)
    await native('/api/token/', auth, { name: 'gouo-studio', remain_quota: kind === 'expired' ? 50 : 0, expired_time: expiredTime,
      unlimited_quota: false, model_limits_enabled: true, model_limits: 'fixture-chat', group: '', cross_group_retry: false, allow_ips: '' })
    const old = (await native('/api/token/search?keyword=gouo-studio&p=1&page_size=100', auth)).items[0]
    const oldKey = (await native('/api/token/' + old.id + '/key', auth, {})).key
    const before = await snapshot(owner), headers = { authorization: 'Bearer ' + auth }
    const access = await studio.inject({ url: '/api/studio/access', headers }); assert.equal(access.statusCode, 200, access.body)
    assert.equal(access.json().data.state, kind); assert.equal(access.json().data.canRenew, true, access.body)
    const key = randomUUID(), payload = { version: access.json().data.version, confirm: true }, start = calls.length
    const renewed = await studio.inject({ method: 'POST', url: '/api/studio/access/renew', headers: { ...headers, 'idempotency-key': key }, payload })
    assert.equal(renewed.statusCode, 200, renewed.body)
    const operationCalls = calls.slice(start)
    assert.equal(operationCalls.filter(c => c.path === '/api/token/' && c.method === 'POST').length, 1)
    assert.equal(operationCalls.some(c => c.method === 'PUT' || c.method === 'DELETE'), false)
    assert.equal(operationCalls.filter(c => c.path === '/v1/models').length, kind === 'exhausted' ? 1 : 0)
    const finalOld = await native('/api/token/' + old.id, auth)
    for (const field of ['id', 'expired_time', 'remain_quota', 'used_quota']) assert.equal(finalOld[field], old[field], field)
    assert.equal(finalOld.status, kind === 'exhausted' ? 4 : old.status)
    assert.equal((await native('/api/token/' + old.id + '/key', auth, {})).key, oldKey)
    assert.deepEqual(await snapshot(owner), before)
    const finalAccess = await studio.inject({ url: '/api/studio/access', headers }); assert.equal(finalAccess.json().data.state, 'ready', finalAccess.body)
    const all = (await native('/api/token/', auth)).items; assert.equal(all.length, 2)
    const replacement = all.find(t => t.id !== old.id); assert.equal(replacement.remain_quota, 100); assert.equal(replacement.unlimited_quota, false)
    assert.equal(replacement.model_limits, 'fixture-chat'); assert.ok(replacement.expired_time > Math.floor(Date.now() / 1000))
    const beforeReplay = calls.length
    assert.equal((await studio.inject({ method: 'POST', url: '/api/studio/access/renew', headers: { ...headers, 'idempotency-key': key }, payload })).statusCode, 200)
    assert.equal(calls.slice(beforeReplay).some(c => c.path === '/api/token/' && c.method === 'POST'), false)
    evidence.push({ kind, owner, oldId: old.id, newId: replacement.id, oldKeyUnchanged: true, oldQuotaExpiryUsedUnchanged: true,
      walletSubscriptionUsageLogsUnchanged: true, pureNativeModelsAuthCalls: kind === 'exhausted' ? 1 : 0, nativeCreates: 1, replayCreates: 0 })
  }
  const report = { sourceCommit, binarySha256: checksum, modelCalls: 0, realPaidCost: 0, preparedEdgeExclusivityVerified: false, cases: evidence }
  await writeFile(join(directory, 'evidence.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2)); console.log('Evidence: ' + join(directory, 'evidence.json'))
} finally { if (studio) await studio.close(); await compose('down', '--volumes', '--remove-orphans') }
