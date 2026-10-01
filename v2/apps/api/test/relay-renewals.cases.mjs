import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { createServer } from '../src/server.mjs'
import { Ledger } from '../src/ledger.mjs'
import { Trial } from '../src/trial.mjs'
import { RelayRenewals } from '../src/relay-renewals.mjs'

const instance = '2c2792b0-84c4-465d-a176-67f4c1ad9b0e'
const config = { models: [{ id: 'chat', kind: 'chat', upstreamModelId: 'fixture-chat', displayName: 'Fixture', enabled: true, verification: 'live-verified' }],
  gateway: 'http://fixture.invalid/v1', authOrigin: 'http://fixture.invalid', ledgerPath: ':memory:', allowGeneration: true,
  relayCredentialMode: 'user-token', relayRoutingMode: 'model', userTokenQuotaCap: 1000, userTokenLifetimeSeconds: 3600, accountInstanceId: instance,
  tokenRenewalPolicy: { instanceId: instance, operatorVerified: true, sourceCommit: '0aec08fee811ec6136828fda790551b49e410301', gatewayOrigin: 'http://fixture.invalid',
    relayIngress: 'studio-only', tokenWrites: 'studio-only', completeKeys: 'studio-only', redisEnabled: false, batchUpdateEnabled: false },
}
function fixture(options = {}) {
  let now = Math.floor(Date.now() / 1000), nextId = 100
  const accounts = new Map([7, 8].map(id => [id, { id, status: 1, group: 'default', quota: 1000 }]))
  const tokens = new Map([7, 8].map(owner => [owner, [{ id: owner, user_id: owner, name: 'gouo-studio', status: 1, remain_quota: 400, used_quota: 17,
    expired_time: now - 60, unlimited_quota: false, model_limits_enabled: true, model_limits: 'fixture-chat', group: '', cross_group_retry: false, allow_ips: '', auto_groups: [], key: 'never-store-this-key' }]]))
  const calls = [], modelCalls = []
  const response = (data, status = 200, success = true) => Response.json({ success, message: '', data }, { status, headers: { Date: new Date(now * 1000).toUTCString() } })
  const fetch = async (url, init) => {
    const owner = Number(init.headers.Authorization?.split('-').at(-1)), path = new URL(url).pathname, method = init.method ?? 'GET'
    calls.push({ owner, path, method })
    if (path === '/v1/models') { const token = [...tokens.values()].flat().find(token => token.remain_quota <= 0 && token.status === 1); if (token) token.status = 4; return response({}, 401, false) }
    if (path === '/api/user/self') return response(accounts.get(owner))
    if (path === '/api/user/models') return response(['fixture-chat'])
    if (path === '/api/subscription/self') return response({ billing_preference: 'wallet_only', all_subscriptions: [], subscriptions: [] })
    if (path === '/api/token/search') {
      const name = new URL(url).searchParams.get('keyword'), items = tokens.get(owner).filter(t => t.name.includes(name)); return response({ items, total: items.length })
    }
    if (path === '/api/token/' && method === 'POST') {
      const body = JSON.parse(init.body); assert.equal(body.unlimited_quota, false)
      tokens.get(owner).push({ ...body, id: nextId++, user_id: owner, status: 1, auto_groups: [], used_quota: 0 })
      await options.onCreate?.(owner)
      if (options.lostCreate) throw new Error('fixture lost creation result')
      return response(undefined)
    }
    if (/^\/api\/token\/\d+\/key$/.test(path)) return response({ key: 'd'.repeat(48) })
    if (/^\/api\/token\/\d+$/.test(path)) {
      if (options.lostReadback && Number(path.split('/').at(-1)) >= 100) throw new Error('fixture lost readback')
      return response(tokens.get(owner).find(t => t.id === Number(path.split('/').at(-1))))
    }
    if (path === '/api/log/self') return response({ items: [] })
    if (path === '/api/status') return response({ quota_per_unit: 1000, usd_exchange_rate: 1 })
    throw new Error('unexpected fixture route ' + path)
  }
  return { accounts, tokens, calls, modelCalls, overrides: { fetch, runAgent: async (context) => {
    await context.onGatewayRequest({ kind: 'chat', modelId: 'chat' }); modelCalls.push(context.relayKey)
    context.onGatewayResponse({ requestId: 'fixture-renewed', status: 200 }); return { events: [{ type: 'run.completed' }] }
  } } }
}
const headers = (owner = 7, key) => ({ authorization: 'Bearer fixture-' + owner, ...(key ? { 'idempotency-key': key } : {}) })
const access = async (app, owner = 7) => (await app.inject({ url: '/api/studio/access', headers: headers(owner) })).json().data
const renew = (app, version, key = crypto.randomUUID(), owner = 7, extras = {}) => app.inject({ method: 'POST', url: '/api/studio/access/renew', headers: headers(owner, key), payload: { version, confirm: true, ...extras } })

test('access query creates nothing; explicit rotation binds a new finite token without changing old funds/token or running models', async t => {
  const f = fixture(), app = createServer(config, f.overrides); t.after(() => app.close())
  assert.equal((await app.inject('/api/studio/access')).statusCode, 401)
  const view = await access(app); assert.equal(view.state, 'expired'); assert.equal(view.canRenew, true)
  assert.ok(f.calls.every(c => c.method === 'GET'))
  const old = JSON.stringify(f.tokens.get(7)[0]), key = crypto.randomUUID()
  const first = await renew(app, view.version, key); assert.equal(first.statusCode, 200, first.body)
  assert.equal(JSON.stringify(f.tokens.get(7)[0]), old); assert.equal(f.accounts.get(7).quota, 1000)
  assert.equal(f.tokens.get(7).length, 2); assert.equal(f.tokens.get(7)[1].remain_quota, 1000)
  assert.equal(f.modelCalls.length, 0); assert.equal((await access(app)).state, 'ready')
  const created = f.calls.filter(c => c.path === '/api/token/' && c.method === 'POST').length
  assert.equal((await renew(app, view.version, key)).body, first.body)
  assert.equal((await renew(app, '0'.repeat(64), key)).statusCode, 409)
  assert.equal((await renew(app, view.version, key, 8)).statusCode, 409)
  assert.equal(f.calls.filter(c => c.path === '/api/token/' && c.method === 'POST').length, created)
  assert.ok(f.calls.every(c => c.method !== 'PUT'))
  const runId = crypto.randomUUID()
  const sent = await app.inject({ method: 'POST', url: '/api/studio/runs', headers: headers(7, runId), payload: { runId, prompt: 'explicit fixture send', model: 'chat', sessionId: 's', conversationId: 'c', payWithBalance: true } })
  assert.equal(sent.statusCode, 200, sent.body); assert.equal(f.modelCalls.length, 1)
  assert.equal(f.tokens.get(7).length, 2, 'generation uses committed binding, never creates another token')
})

test('zero remaining quota needs Native status4 proof, not a quota refill or old-token PUT', async t => {
  const f = fixture(), app = createServer(config, f.overrides); t.after(() => app.close())
  Object.assign(f.tokens.get(7)[0], { remain_quota: 0, expired_time: Math.floor(Date.now() / 1000) + 1800 })
  const view = await access(app); assert.equal(view.state, 'exhausted')
  assert.equal((await renew(app, view.version)).statusCode, 200)
  assert.equal(f.tokens.get(7)[0].status, 4); assert.equal(f.tokens.get(7)[0].remain_quota, 0)
  assert.equal(f.calls.filter(c => c.path === '/v1/models').length, 1)
  assert.equal(f.modelCalls.length, 0); assert.ok(f.calls.every(c => c.method !== 'PUT'))
})

test('no approval, disabled/changed rights, stale version, zero funding and injected fields never create a replacement', async () => {
  for (const mode of ['closed', 'disabled', 'permissions', 'stale', 'funds', 'fields']) {
    const f = fixture(), app = createServer({ ...config, ...(mode === 'closed' ? { tokenRenewalPolicy: undefined } : {}) }, f.overrides)
    try {
      if (mode === 'disabled') f.tokens.get(7)[0].status = 2
      if (mode === 'permissions') f.tokens.get(7)[0].model_limits += ',forbidden'
      const view = await access(app)
      if (mode === 'funds') f.accounts.get(7).quota = 0
      if (mode === 'stale') f.tokens.get(7)[0].remain_quota--
      const response = await renew(app, view.version ?? '0'.repeat(64), crypto.randomUUID(), 7, mode === 'fields' ? { owner: 8, quota: 999999, key: 'do-not-accept' } : {})
      assert.notEqual(response.statusCode, 200, mode)
      assert.equal(f.tokens.get(7).length, 1); assert.equal(f.modelCalls.length, 0)
      assert.ok(f.calls.every(c => c.method === 'GET'))
    } finally { await app.close() }
  }
})

test('unknown creation/readback survives restart, blocks new keys and generation even if the token later appears', async () => {
  for (const mode of ['lostCreate', 'lostReadback']) {
    const directory = mkdtempSync(join(tmpdir(), 'gouo-renewal-')), path = join(directory, 'ledger.sqlite'), f = fixture({ [mode]: true }), c = { ...config, ledgerPath: path }
    let app = createServer(c, f.overrides)
    try {
      const view = await access(app), key = crypto.randomUUID()
      assert.notEqual((await renew(app, view.version, key)).statusCode, 200)
      assert.equal(f.tokens.get(7).length, 2)
      await app.close(); app = createServer(c, f.overrides)
      assert.equal((await access(app)).state, 'unknown')
      assert.equal((await renew(app, view.version, key)).statusCode, 409)
      assert.equal((await renew(app, view.version)).statusCode, 409)
      const runId = crypto.randomUUID()
      assert.equal((await app.inject({ method: 'POST', url: '/api/studio/runs', headers: headers(7, runId), payload: { runId, prompt: 'blocked', model: 'chat', sessionId: 's', conversationId: 'c', payWithBalance: true } })).statusCode, 409)
      assert.equal(f.calls.filter(c => c.path === '/api/token/' && c.method === 'POST').length, 1)
      const db = new DatabaseSync(path, { readOnly: true })
      try {
        assert.equal(db.prepare('SELECT COUNT(*) AS n FROM relay_bindings').get().n, 0)
        assert.equal(db.prepare("SELECT status FROM relay_renewals WHERE owner=7").get().status, 'unknown')
        assert.doesNotMatch(JSON.stringify(db.prepare('SELECT * FROM relay_renewals').all()), /never-store-this-key|dddddddddddddddddddddddddddddddddddddddddddddddd/)
      } finally { db.close() }
    } finally { await app.close(); assert.equal(resolve(dirname(directory)), resolve(tmpdir())); rmSync(directory, { recursive: true, force: true }) }
  }
})

test('generation/held/failed history and startup pending are durable renewal barriers', () => {
  const ledger = new Ledger(':memory:'); new Trial(ledger.db, undefined, instance)
  const renewals = new RelayRenewals(ledger.db)
  try {
    ledger.begin(7, 'agent', 'fixture-unknown', {})
    assert.equal(renewals.unresolvedGeneration(7), true); assert.equal(renewals.unresolvedGeneration(8), false)
    ledger.complete(7, 'agent', 'fixture-unknown', { events: [{ type: 'run.failed' }] })
    assert.equal(renewals.unresolvedGeneration(7), true)
    ledger.complete(7, 'agent', 'fixture-unknown', { events: [{ type: 'run.completed' }] })
    assert.equal(renewals.unresolvedGeneration(7), false)
    renewals.begin(7, 'fixture-operation', { version: 'x' }, 7, { name: 'gouo-studio-fixture', quota: 100, expiredTime: 123 })
    new RelayRenewals(ledger.db)
    assert.equal(renewals.blocked(7), true); assert.equal(renewals.binding(7), undefined)
    assert.throws(() => renewals.begin(7, 'different-operation', {}, 7, {}), /待核对/)
  } finally { ledger.close() }
})

test('owner exclusion covers simultaneous renew, profile and generation while another owner remains independent', async t => {
  let release, entered
  const gate = new Promise(resolve => { release = resolve }), started = new Promise(resolve => { entered = resolve })
  const f = fixture({ onCreate: async owner => { if (owner === 7) { entered(); await gate } } }), app = createServer(config, f.overrides)
  t.after(() => app.close())
  const a = await access(app), b = await access(app, 8), first = renew(app, a.version)
  await started
  assert.equal((await renew(app, a.version)).statusCode, 409)
  assert.equal((await app.inject({ method: 'PUT', url: '/api/user/self', headers: headers(7), payload: { display_name: 'busy' } })).statusCode, 409)
  assert.equal((await renew(app, b.version, crypto.randomUUID(), 8)).statusCode, 200)
  release(); assert.equal((await first).statusCode, 200)
  assert.equal(f.tokens.get(7).length, 2); assert.equal(f.tokens.get(8).length, 2)
})
