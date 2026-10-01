import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from '../src/server.mjs'
import { userRelay } from '../src/user-relay.mjs'
const config = {
  models: [{ id: 'image', kind: 'image', displayName: 'Fixture', upstreamModelId: 'fixture-image', enabled: true, verification: 'live-verified' }],
  gateway: 'http://fixture.invalid/v1', authOrigin: 'http://fixture.invalid', ledgerPath: ':memory:', allowGeneration: true,
  relayCredentialMode: 'user-token', relayRoutingMode: 'model', userTokenQuotaCap: 1000, userTokenLifetimeSeconds: 3600,
  accountInstanceId: '2c2792b0-84c4-465d-a176-67f4c1ad9b0e',
  normalRoutingEvidence: { sourceCommit: '0aec08fee811ec6136828fda790551b49e410301', retryTimes: 0, gatewayOrigin: 'http://fixture.invalid', operatorVerified: true, verifiedAt: '2026-09-30' },
}
const json = data => new Response(JSON.stringify({ success: true, data }))
function fixture() {
  const accounts = new Map([7, 8].map(id => [id, { id, status: 1, role: 1, group: 'default', quota: 1000, used_quota: 0, request_count: 0 }]))
  const tokens = new Map(), calls = []
  let tokenId = 0
  const fetch = async (url, init) => {
    const path = new URL(url).pathname, owner = Number(init.headers.Authorization.split('-').at(-1))
    calls.push({ path, owner, method: init.method ?? 'GET' })
    const account = accounts.get(owner)
    if (path === '/api/user/self') return json(account)
    if (path === '/api/user/models') return json(account.group === 'blocked' ? [] : ['fixture-image'])
    if (path === '/api/subscription/self') return json({ billing_preference: 'wallet_only', subscriptions: [], all_subscriptions: [] })
    if (path === '/api/token/search') return json({ items: tokens.has(owner) ? [tokens.get(owner)] : [], total: tokens.has(owner) ? 1 : 0 })
    if (path === '/api/token/') {
      const body = JSON.parse(init.body)
      assert.equal(body.unlimited_quota, false); assert.equal(body.group, ''); assert.equal(body.model_limits, 'fixture-image')
      tokens.set(owner, { ...body, user_id: owner, id: ++tokenId, status: 1, key: 'masked' })
      return new Response(JSON.stringify({ success: true, message: '' }))
    }
    if (/\/api\/token\/\d+\/key/.test(path)) { assert.equal(tokens.get(owner).id, Number(path.split('/')[3])); return json({ key: String(owner).repeat(48) }) }
    if (path === '/api/status') return json({ quota_per_unit: 1000, usd_exchange_rate: 1 })
    if (path === '/api/pricing') return new Response(JSON.stringify({ success: true, group_ratio: { default: 1 }, data: [{ model_name: 'fixture-image', quota_type: 1, model_price: 0.1 }] }))
    if (path === '/api/log/self') return json({ items: [{ request_id: 'fixture-native-' + owner, quota: 100, id: owner, model_name: 'fixture-image' }] })
    throw new Error('Unexpected native contract path')
  }
  return { accounts, tokens, calls, fetch }
}
const send = (app, owner, key = crypto.randomUUID()) => app.inject({ method: 'POST', url: '/api/studio/images', headers: { authorization: 'Bearer fixture-user-' + owner, 'idempotency-key': key, 'new-api-user': '7' }, payload: { prompt: 'fixture', model: 'image', payWithBalance: true } })
test('ordinary users get their own finite native tokens and charges; replay does not provision or charge again', async () => {
  const f = fixture(); let generated = 0
  const app = createServer(config, { fetch: f.fetch, generateImage: async context => {
    generated++; assert.equal(context.relayKey, String(context.relayOwnerId).repeat(48))
    context.onGatewayResponse({ requestId: 'fixture-native-' + context.relayOwnerId, status: 200 }); return { url: 'fixture-result' }
  } })
  try {
    assert.equal((await app.inject('/api/studio/models')).statusCode, 401)
    for (const owner of [7, 8]) {
      const key = crypto.randomUUID(), first = await send(app, owner, key)
      assert.equal(first.statusCode, 200, first.body); assert.deepEqual(first.json().data.usage.requestIds, ['fixture-native-' + owner]); assert.equal(first.json().data.usage.cost, 0.1)
      assert.equal((await send(app, owner, key)).body, first.body)
      const detail = await app.inject({ url: '/api/studio/requests/image/' + key, headers: { authorization: 'Bearer fixture-user-' + owner } })
      assert.equal(detail.json().data.attempts.length, 1)
      assert.equal((await app.inject({ url: '/api/studio/requests/image/' + key, headers: { authorization: 'Bearer fixture-user-' + (owner === 7 ? 8 : 7) } })).statusCode, 404)
    }
    assert.equal(generated, 2); assert.equal(f.calls.filter(c => c.path === '/api/token/').length, 2)
    assert.doesNotMatch((await app.inject({ url: '/api/studio/models', headers: { authorization: 'Bearer fixture-user-7' } })).body, /777777|888888|masked/)
  } finally { await app.close() }
})
test('zero/negative quota, disabled users and unavailable groups never provision or generate', async () => {
  for (const change of [{ quota: 0 }, { quota: -10 }, { status: 2 }, { group: 'blocked' }]) {
    const f = fixture(); Object.assign(f.accounts.get(7), change); let generated = 0
    const app = createServer(config, { fetch: f.fetch, generateImage: async () => { generated++; return {} } })
    try {
      const response = await send(app, 7); assert.ok([402, 403, 503].includes(response.statusCode), response.body); assert.equal(generated, 0); assert.equal(f.tokens.size, 0)
      if (change.quota === -10) { const bill = await app.inject({ url: '/api/studio/billing', headers: { authorization: 'Bearer fixture-user-7' } }); assert.equal(bill.statusCode, 200); assert.equal(bill.json().data.balance, -0.01) }
    } finally { await app.close() }
  }
})
test('lost token creation response is attempted once; its request remains unknown and cannot replay', async () => {
  const f = fixture(); let creates = 0, generates = 0
  const fetch = async (url, init) => { if (new URL(url).pathname === '/api/token/') { creates++; await f.fetch(url, init); throw new Error('response lost') } return f.fetch(url, init) }
  const app = createServer(config, { fetch, generateImage: async () => { generates++; return {} } }), key = crypto.randomUUID()
  try {
    assert.equal((await send(app, 7, key)).statusCode, 502); assert.equal((await send(app, 7, key)).statusCode, 409); assert.equal(creates, 1); assert.equal(generates, 0)
    const detail = (await app.inject({ url: '/api/studio/requests/image/' + key, headers: { authorization: 'Bearer fixture-user-7' } })).json().data
    assert.equal(detail.status, 'unknown'); assert.equal(detail.usage.state, 'pending')
  } finally { await app.close() }
})
test('existing token failures never auto renew quota, broaden permissions or accept another owner', async () => {
  for (const change of [{ user_id: 8 }, { status: 2 }, { expired_time: 1 }, { expired_time: Math.floor(Date.now() / 1000) + 86400 }, { remain_quota: 0 }, { unlimited_quota: true }, { group: 'auto' }, { model_limits: 'other-model' }, { cross_group_retry: true }]) {
    const f = fixture(); await userRelay(config, 'Bearer fixture-user-7', f.accounts.get(7), f.fetch); Object.assign(f.tokens.get(7), change)
    const before = f.calls.length; await assert.rejects(userRelay(config, 'Bearer fixture-user-7', f.accounts.get(7), f.fetch), /权限变化/)
    assert.ok(f.calls.slice(before).every(c => c.method === 'GET'))
  }
})

test('unknown result retains native request IDs across restart; read-only reconciliation never calls a model or refunds', async () => {
  const { mkdtempSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const directory = mkdtempSync(join(tmpdir(), 'gouo-user-reconcile-')), f = fixture(), key = crypto.randomUUID()
  const c = { ...config, ledgerPath: join(directory, 'requests.sqlite') }
  let generates = 0
  const overrides = { fetch: f.fetch, generateImage: async context => {
    generates++; context.onGatewayResponse({ requestId: 'fixture-native-7', status: 200 }); throw new Error('image save failed after charge')
  } }
  let app = createServer(c, overrides)
  try {
    assert.equal((await send(app, 7, key)).statusCode, 500)
    await app.close(); app = createServer(c, overrides)
    assert.equal((await send(app, 7, key)).statusCode, 409)
    const detail = (await app.inject({ url: '/api/studio/requests/image/' + key, headers: { authorization: 'Bearer fixture-user-7' } })).json().data
    assert.equal(detail.status, 'unknown'); assert.equal(detail.usage.state, 'settled'); assert.equal(detail.usage.cost, 0.1)
    assert.deepEqual(detail.attempts.map(row => row.requestId), ['fixture-native-7'])
    assert.equal(generates, 1)
    assert.ok(f.calls.every(row => ['GET', 'POST'].includes(row.method)))
    assert.ok(f.calls.filter(row => row.method === 'POST').every(row => row.path === '/api/token/' || /\/api\/token\/\d+\/key/.test(row.path)))
  } finally { await app.close(); rmSync(directory, { recursive: true, force: true }) }
})

test('per-user mode rejects shared secrets, mismatched authorities and implicit quota/lifetime before reading any key file', async () => {
  const { loadConfig } = await import('../src/config.mjs')
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const dir = mkdtempSync(join(tmpdir(), 'gouo-user-config-'))
  try {
    const models = join(dir, 'models.json'), evidence = join(dir, 'routing.json')
    writeFileSync(models, JSON.stringify({ models: config.models })); writeFileSync(evidence, JSON.stringify(config.normalRoutingEvidence))
    const env = { GOUO_STUDIO_MODELS_FILE: models, GOUO_GATEWAY_BASE_URL: config.gateway, GOUO_NORMAL_ROUTING_EVIDENCE_FILE: evidence,
      GOUO_RELAY_ROUTING_MODE: 'model', GOUO_RELAY_CREDENTIAL_MODE: 'user-token', GOUO_ACCOUNT_INSTANCE_ID: config.accountInstanceId, GOUO_USER_TOKEN_QUOTA_CAP: '1000', GOUO_USER_TOKEN_LIFETIME_SECONDS: '3600' }
    assert.equal(loadConfig(env).relayCredentialMode, 'user-token')
    for (const change of [{ GOUO_RELAY_API_KEY: 'fixture' }, { GOUO_RELAY_OWNER_ID: '7' }, { GOUO_RELAY_ROUTING_MODE: 'pinned' }, { GOUO_ACCOUNT_INSTANCE_ID: '' }, { GOUO_ACCOUNT_INSTANCE_ID: 'invalid' }, { GOUO_USER_TOKEN_QUOTA_CAP: '' }, { GOUO_USER_TOKEN_LIFETIME_SECONDS: '' }, { GOUO_BACKEND_DEV_TARGET: 'https://other.invalid' }]) assert.throws(() => loadConfig({ ...env, ...change }))
    assert.throws(() => loadConfig({ ...env, GOUO_RELAY_API_KEY_FILE: '/fixture/must-not-read' }), /共享令牌/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('SSE token preflight failure returns the account error before starting a stream, without inventing a provider run', async () => {
  const f = fixture(); await userRelay(config, 'Bearer fixture-user-7', f.accounts.get(7), f.fetch)
  f.tokens.get(7).status = 2
  const app = createServer(config, { fetch: f.fetch }), id = crypto.randomUUID()
  try {
    const response = await app.inject({ method: 'POST', url: '/api/studio/runs/stream', headers: { authorization: 'Bearer fixture-user-7', 'idempotency-key': id }, payload: { runId: id, prompt: 'fixture', model: 'image', sessionId: 'fixture', conversationId: 'fixture', payWithBalance: true } })
    assert.equal(response.statusCode, 403); assert.match(response.json().message, /令牌已停用/)
    assert.doesNotMatch(response.headers['content-type'], /event-stream/)
  } finally { await app.close() }
})

test('native disabled and unavailable account states remain distinct and never invoke token or model endpoints', async () => {
  for (const [nativeStatus, expected] of [[403, 403], [503, 502], [401, 401]]) {
    let reads = 0
    const app = createServer(config, { fetch: async () => { reads++; return new Response('{}', { status: nativeStatus }) } })
    try { assert.equal((await send(app, 7)).statusCode, expected); assert.equal(reads, 1) }
    finally { await app.close() }
  }
})

test('completed replay survives exhausted balance and changed model permissions without new native operations', async () => {
  const f = fixture(); let generates = 0
  const app = createServer(config, { fetch: f.fetch, generateImage: async () => { generates++; return { url: 'original-owner-result' } } }), key = crypto.randomUUID()
  try {
    const original = await send(app, 7, key); assert.equal(original.statusCode, 200)
    const reads = f.calls.length
    Object.assign(f.accounts.get(7), { quota: 0, group: 'blocked' })
    assert.equal((await send(app, 7, key)).body, original.body); assert.equal(generates, 1)
    assert.deepEqual(f.calls.slice(reads).map(row => row.path), ['/api/user/self'])
    assert.equal((await send(app, 8, key)).statusCode, 200)
    f.accounts.get(7).status = 2
    assert.equal((await send(app, 7, key)).statusCode, 403)
  } finally { await app.close() }
})

test('known zero-balance preflight does not reserve an unknown paid request; same ID can execute after native funding', async () => {
  const f = fixture(); f.accounts.get(7).quota = 0
  let generates = 0
  const app = createServer(config, { fetch: f.fetch, generateImage: async () => { generates++; return {} } }), key = crypto.randomUUID()
  try {
    assert.equal((await send(app, 7, key)).statusCode, 402); assert.equal(f.tokens.size, 0)
    f.accounts.get(7).quota = 1000
    assert.equal((await send(app, 7, key)).statusCode, 200); assert.equal(generates, 1)
  } finally { await app.close() }
})
