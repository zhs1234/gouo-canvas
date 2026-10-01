import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Fastify from 'fastify'
import sharp from 'sharp'
import { createServer } from '../src/server.mjs'

const plan = { price_amount: 0, total_amount: 10000, duration_unit: 'day', duration_value: 7, custom_seconds: 0, quota_reset_period: 'never', max_purchase_per_user: 1, allow_balance_pay: true, allow_wallet_overflow: false, upgrade_group: '', downgrade_group: '' }
const config = {
  models: [
    { id: 'chat', displayName: 'Fixture chat', kind: 'chat', upstreamModelId: 'fixture-chat', enabled: true, verification: 'live-verified', toolCalling: true, maxChatCalls: 3, maxTokens: 128 },
    { id: 'image', displayName: 'Fixture image', kind: 'image', upstreamModelId: 'fixture-image', enabled: true, verification: 'live-verified', operations: ['generate', 'edit'], qualities: [], sizes: {} },
  ],
  gateway: 'http://fixture.invalid/v1', authOrigin: 'http://fixture.invalid', ledgerPath: ':memory:', allowGeneration: true,
  relayCredentialMode: 'user-token', relayRoutingMode: 'model', userTokenQuotaCap: 1000, userTokenLifetimeSeconds: 3600,
  normalRoutingEvidence: { sourceCommit: '0aec08fee811ec6136828fda790551b49e410301', retryTimes: 0, gatewayOrigin: 'http://fixture.invalid', operatorVerified: true, verifiedAt: '2026-10-01' },
  trial: { sourceCommit: '0aec08fee811ec6136828fda790551b49e410301', gatewayOrigin: 'http://fixture.invalid', instanceId: 'b6770961-570c-40ad-92f9-963846a15ed0', minUserId: 7, planId: 3, relayIngress: 'studio-only', operatorVerified: true, plan },
}
function fixture(options = {}) {
  const accounts = new Map([7, 8].map(id => [id, { id, status: 1, role: 1, group: 'default', quota: 0 }]))
  const subscriptions = new Map(), preferences = new Map(), tokens = new Map(), calls = [], models = []
  const fetch = async (url, init) => {
    const path = new URL(url).pathname, owner = Number(init.headers.Authorization.split('-').at(-1))
    calls.push({ path, owner, method: init.method ?? 'GET' })
    const account = accounts.get(owner)
    let data
    if (path === '/api/user/self') data = account
    else if (path === '/api/user/models') data = account.group === 'blocked' ? [] : ['fixture-chat', 'fixture-image']
    else if (path === '/api/subscription/plans') data = [{ plan: { id: 3, enabled: true, ...plan } }]
    else if (path === '/api/subscription/self') {
      const sub = subscriptions.get(owner)
      data = { billing_preference: preferences.get(owner) ?? 'subscription_first', all_subscriptions: sub ? [{ subscription: sub }] : [], subscriptions: sub?.status === 'active' && sub.end_time > Date.now() / 1000 ? [{ subscription: sub }] : [] }
    } else if (path === '/api/subscription/balance/pay') {
      assert.equal(JSON.parse(init.body).plan_id, 3)
      assert.equal(subscriptions.has(owner), false, 'never purchase twice')
      if (!options.noReceipt) subscriptions.set(owner, { id: owner * 10, user_id: owner, plan_id: 3, amount_total: 10000, amount_used: 0, end_time: Math.floor(Date.now() / 1000) + 3600, status: 'active', allow_wallet_overflow: false, upgrade_group: '', downgrade_group: '' })
      if (options.lostPurchase) throw new Error('fixture lost purchase response')
    } else if (path === '/api/subscription/self/preference') {
      assert.equal(init.method, 'PUT')
      const preference = JSON.parse(init.body).billing_preference
      assert.ok(['subscription_only', 'wallet_only'].includes(preference))
      preferences.set(owner, preference); data = { billing_preference: preference }
      if (options.lostPreference || options.failPreference === preference) throw new Error('fixture lost preference response')
    } else if (path === '/api/token/search') data = { items: tokens.has(owner) ? [tokens.get(owner)] : [], total: tokens.has(owner) ? 1 : 0 }
    else if (path === '/api/token/') {
      const token = JSON.parse(init.body)
      assert.equal(token.remain_quota, 1000); assert.equal(token.unlimited_quota, false)
      tokens.set(owner, { ...token, id: owner, user_id: owner, status: 1 })
    } else if (/\/api\/token\/\d+\/key/.test(path)) data = { key: String(owner).repeat(48) }
    else if (path === '/api/status') data = { quota_per_unit: 1000, usd_exchange_rate: 1 }
    else if (path === '/api/log/self') data = { items: [] }
    else throw new Error('unexpected native fixture endpoint ' + path)
    return Response.json({ success: true, data })
  }
  const submit = async (context, kind) => {
    await context.onGatewayRequest?.({ kind })
    models.push({ owner: context.relayOwnerId, kind, preference: preferences.get(context.relayOwnerId) })
    context.onGatewayResponse({ requestId: 'fixture-' + models.length, status: 200 })
    if (options.failedModel) throw new Error('fixture model outcome unknown')
  }
  const overrides = { fetch, runAgent: async (context, _model, payload) => {
    await submit(context, 'chat')
    if (payload.prompt === 'with image') { await submit(context, 'image'); await submit(context, 'chat') }
    return { events: [{ type: 'run.completed' }] }
  }, generateImage: async context => { await submit(context, 'image'); return { url: 'explicit-fixture' } }, runImage: async context => { await submit(context, 'image'); return { events: [{ type: 'run.completed' }] } } }
  return { accounts, subscriptions, preferences, tokens, calls, models, overrides }
}
const headers = (owner, id) => ({ authorization: 'Bearer fixture-user-' + owner, ...(id ? { 'idempotency-key': id } : {}) })
const send = (app, owner = 7, prompt = 'text', id = crypto.randomUUID(), model = 'chat', url = '/api/studio/runs', consent) => app.inject({ method: 'POST', url, headers: headers(owner, id), payload: { runId: id, prompt, model, sessionId: 's', conversationId: 'c', ...(consent === undefined ? {} : { payWithBalance: consent }) } })
const status = async (app, owner = 7) => (await app.inject({ url: '/api/studio/trial', headers: headers(owner) })).json().data

test('trial reads never grant; zero-wallet send gets one native grant and four send benefits, not four model calls', async () => {
  const f = fixture(), app = createServer(config, f.overrides)
  try {
    assert.equal((await app.inject('/api/studio/trial')).statusCode, 401)
    assert.equal((await status(app)).state, 'eligible')
    assert.ok(f.calls.every(c => c.method === 'GET'))
    const id = crypto.randomUUID(), first = await send(app, 7, 'with image', id)
    assert.equal(first.statusCode, 200, first.body)
    assert.equal(f.accounts.get(7).quota, 0)
    assert.equal(f.preferences.get(7), 'subscription_only')
    assert.deepEqual((await status(app)).chat, { limit: 4, remaining: 3, used: 1, held: 0 })
    assert.deepEqual((await status(app)).image, { limit: 1, remaining: 0, used: 1, held: 0 })
    assert.equal((await send(app, 7, 'with image', id)).body, first.body)
    assert.equal((await send(app, 7, 'changed', id)).statusCode, 409)
    for (let i = 0; i < 3; i++) assert.equal((await send(app)).statusCode, 200)
    assert.equal((await send(app)).statusCode, 402)
    assert.equal(f.models.length, 6)
    assert.equal(f.calls.filter(c => c.path === '/api/subscription/balance/pay').length, 1)
    assert.equal((await status(app)).state, 'exhausted')
    assert.equal((await send(app, 8)).statusCode, 200)
    assert.equal((await status(app, 8)).chat.remaining, 3)
    assert.equal((await status(app, 7)).chat.remaining, 0)
  } finally { await app.close() }
})

test('direct, image-only and tool image share one benefit; completed replay ignores exhaustion', async () => {
  const f = fixture(), app = createServer(config, f.overrides)
  try {
    const id = crypto.randomUUID(), first = await send(app, 7, 'image only', id, 'image')
    assert.equal(first.statusCode, 200)
    const direct = await app.inject({ method: 'POST', url: '/api/studio/images', headers: headers(7, crypto.randomUUID()), payload: { prompt: 'fixture', model: 'image' } })
    assert.equal(direct.statusCode, 402)
    assert.equal((await send(app, 7, 'image only', id, 'image')).body, first.body)
    assert.equal(f.models.filter(m => m.kind === 'image').length, 1)
    assert.equal((await status(app)).chat.remaining, 4)
  } finally { await app.close() }
})

test('unknown model intent holds benefit across restart and reconciliation never retries/refunds', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gouo-trial-')), f = fixture({ failedModel: true }), c = { ...config, ledgerPath: join(dir, 'requests.sqlite') }, id = crypto.randomUUID()
  let app = createServer(c, f.overrides)
  try {
    assert.equal((await send(app, 7, 'text', id)).statusCode, 500)
    await app.close(); app = createServer(c, f.overrides)
    assert.equal((await send(app, 7, 'text', id)).statusCode, 409)
    const s = await status(app)
    assert.equal(s.state, 'pending'); assert.deepEqual(s.chat, { limit: 4, remaining: 3, used: 0, held: 1 })
    const before = f.calls.length
    await app.inject({ url: '/api/studio/requests/agent/' + id, headers: headers(7) })
    assert.ok(f.calls.slice(before).every(c => c.method === 'GET'))
    assert.equal(f.models.length, 1)
  } finally { await app.close(); rmSync(dir, { recursive: true, force: true }) }
})

test('ambiguous purchase can recover from receipt; ambiguous preference blocks all new sends without retry', async () => {
  for (const options of [{ lostPurchase: true }, { lostPreference: true }, { lostPurchase: true, noReceipt: true }]) {
    const f = fixture(options), app = createServer(config, f.overrides), id = crypto.randomUUID()
    try {
      assert.equal((await send(app, 7, 'text', id)).statusCode, 502)
      assert.equal((await send(app, 7, 'text', id)).statusCode, 409)
      assert.equal(f.models.length, 0)
      const next = await send(app)
      const blocked = options.noReceipt || options.lostPreference
      assert.equal(next.statusCode, blocked ? 409 : 200, next.body)
      assert.equal(f.calls.filter(c => c.path === '/api/subscription/balance/pay').length, 1)
      assert.equal(f.models.length, blocked ? 0 : 1)
      if (options.lostPreference) assert.equal(f.calls.filter(c => c.path.endsWith('/preference')).length, 1)
    } finally { await app.close() }
  }
})

test('disabled trial, unavailable models, old users and changed funding never issue model intents', async () => {
  for (const change of [{ trial: undefined }, { models: config.models.map(m => ({ ...m, verification: 'pending' })) }, { trial: { ...config.trial, minUserId: 9 } }]) {
    const f = fixture(), app = createServer({ ...config, ...change }, f.overrides)
    try { assert.ok([402, 503].includes((await send(app)).statusCode)); assert.equal(f.models.length, 0); assert.equal(f.subscriptions.size, 0) }
    finally { await app.close() }
  }
  const f = fixture(), app = createServer(config, f.overrides)
  try {
    assert.equal((await send(app)).statusCode, 200)
    f.subscriptions.get(7).end_time = 1
    assert.equal((await send(app)).statusCode, 402)
    assert.equal(f.models.length, 1)
    assert.equal((await status(app)).state, 'expired')
  } finally { await app.close() }
})

test('two concurrent sends competing for the last chat benefit submit at most one intent', async () => {
  const f = fixture(), app = createServer(config, f.overrides)
  try {
    for (let i = 0; i < 3; i++) assert.equal((await send(app)).statusCode, 200)
    const responses = await Promise.all([send(app), send(app)])
    assert.equal(responses.filter(r => r.statusCode === 200).length, 1)
    assert.ok(responses.every(r => [200, 402, 409].includes(r.statusCode)))
    assert.equal(f.models.length, 4)
  } finally { await app.close() }
})

test('missing native receipt cannot make a previously granted user eligible again', async () => {
  const f = fixture(), app = createServer(config, f.overrides)
  try {
    assert.equal((await send(app)).statusCode, 200)
    f.subscriptions.delete(7)
    const before = f.calls.length, s = await status(app)
    assert.equal(s.state, 'pending'); assert.equal(s.chat.remaining, 0)
    assert.match(s.message, /领取记录待核对/)
    assert.equal((await send(app)).statusCode, 409)
    assert.ok(f.calls.slice(before).every(c => c.method === 'GET'))
    assert.equal(f.models.length, 1)
  } finally { await app.close() }
})

test('changed native subscription binding is refused before preference mutation or a new model', async () => {
  const f = fixture(), app = createServer(config, f.overrides)
  try {
    assert.equal((await send(app)).statusCode, 200)
    f.subscriptions.get(7).id = 999
    f.preferences.set(7, 'subscription_first')
    const before = f.calls.length
    assert.equal((await send(app)).statusCode, 409)
    assert.ok(f.calls.slice(before).every(c => c.method === 'GET'))
    assert.equal(f.models.length, 1)
  } finally { await app.close() }
})

test('installation identity and plan rotation cannot reset previously granted benefits', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gouo-trial-identity-')), f = fixture(), c = { ...config, ledgerPath: join(dir, 'requests.sqlite') }
  let app = createServer(c, f.overrides)
  try {
    assert.equal((await send(app)).statusCode, 200)
    await app.close()
    assert.throws(() => createServer({ ...c, trial: { ...c.trial, instanceId: crypto.randomUUID() } }, f.overrides), /另一 New API 实例/)
    app = createServer({ ...c, trial: { ...c.trial, planId: 4 } }, f.overrides)
    const before = f.calls.length
    assert.equal((await send(app)).statusCode, 409)
    assert.deepEqual(f.calls.slice(before).map(c => c.path), ['/api/user/self', '/api/user/models'])
    assert.equal(f.models.length, 1)
  } finally { await app.close(); rmSync(dir, { recursive: true, force: true }) }
})

test('local invalid image input never reserves an image benefit', async () => {
  const f = fixture(), app = createServer(config, { fetch: f.overrides.fetch })
  try {
    const reply = await app.inject({ method: 'POST', url: '/api/studio/images', headers: headers(7, crypto.randomUUID()), payload: { prompt: 'fixture', model: 'image', inputImages: ['data:image/png;base64,bm90LWFuLWltYWdl'] } })
    assert.equal(reply.statusCode, 422)
    assert.deepEqual((await status(app)).image, { limit: 1, remaining: 1, used: 0, held: 0 })
  } finally { await app.close() }
})

test('real SDK loop uses two chats and one image while consuming one send and one image benefit', async t => {
  const f = fixture(), upstream = Fastify(), calls = { chat: 0, image: 0 }
  const png = await sharp({ create: { width: 12, height: 9, channels: 3, background: '#789abc' } }).png().toBuffer()
  upstream.post('/v1/chat/completions', (req, reply) => {
    calls.chat++; assert.equal(req.headers.authorization, 'Bearer ' + '7'.repeat(48))
    reply.header('X-Oneapi-Request-Id', 'chat-' + calls.chat)
    const message = calls.chat === 1 ? { role: 'assistant', content: '', tool_calls: [{ id: 'fixture-tool', type: 'function', function: { name: 'generate_image', arguments: JSON.stringify({ prompt: 'fixture' }) } }] } : { role: 'assistant', content: 'fixture summary' }
    return { id: 'fixture-' + calls.chat, object: 'chat.completion', created: 1, model: 'fixture-chat', choices: [{ index: 0, finish_reason: message.tool_calls ? 'tool_calls' : 'stop', message }] }
  })
  upstream.post('/v1/images/generations', (_req, reply) => { calls.image++; reply.header('X-Oneapi-Request-Id', 'image-1'); return { data: [{ b64_json: png.toString('base64') }] } })
  await upstream.listen({ host: '127.0.0.1', port: 0 }); t.after(() => upstream.close())
  const c = { ...config, gateway: upstream.listeningOrigin + '/v1', normalRoutingEvidence: { ...config.normalRoutingEvidence, gatewayOrigin: upstream.listeningOrigin } }
  const app = createServer(c, { fetch: f.overrides.fetch }); t.after(() => app.close())
  const response = await send(app)
  assert.equal(response.statusCode, 200, response.body)
  assert.equal(response.json().data.events.at(-1).type, 'run.completed')
  assert.equal(response.json().data.events.find(e => e.type === 'tool.completed').artifacts[0].width, 12)
  assert.deepEqual(calls, { chat: 2, image: 1 })
  assert.equal((await status(app)).chat.remaining, 3)
  assert.equal((await status(app)).image.remaining, 0)
})

test('one-send consent pays only exhausted categories and preserves the unused image benefit', async () => {
  const f = fixture(), app = createServer(config, f.overrides)
  try {
    // Consent cannot force a wallet debit while the relevant trial remains.
    assert.equal((await send(app, 7, 'text', crypto.randomUUID(), 'chat', '/api/studio/runs', true)).statusCode, 200)
    for (let i = 0; i < 3; i++) assert.equal((await send(app)).statusCode, 200)
    assert.ok(f.models.every(m => m.preference === 'subscription_only'))
    const before = f.calls.length
    assert.equal((await send(app, 7, 'text', crypto.randomUUID(), 'chat', '/api/studio/runs', true)).statusCode, 402)
    assert.ok(f.calls.slice(before).every(c => c.method === 'GET'))
    f.accounts.get(7).quota = 10000
    assert.equal((await send(app)).statusCode, 402, '充值不等于付款授权')
    const id = crypto.randomUUID(), result = await send(app, 7, 'with image', id, 'chat', '/api/studio/runs', true)
    assert.equal(result.statusCode, 200, result.body)
    assert.deepEqual(result.json().data.fundingSelection, { chat: 'wallet', image: 'trial' })
    assert.deepEqual(f.models.slice(-3).map(m => m.preference), ['wallet_only', 'subscription_only', 'wallet_only'])
    const s = await status(app)
    assert.deepEqual(s.chat, { limit: 4, remaining: 0, used: 4, held: 0 })
    assert.deepEqual(s.image, { limit: 1, remaining: 0, used: 1, held: 0 })
    const record = (await app.inject({ url: '/api/studio/requests/agent/' + id, headers: headers(7) })).json().data
    assert.deepEqual(record.submissions.map(r => [r.modelKind, r.selectedFundingSource]), [['chat', 'wallet'], ['image', 'trial'], ['chat', 'wallet']])
    assert.equal((await send(app, 7, 'with image', id, 'chat', '/api/studio/runs', true)).body, result.body)
    assert.equal((await send(app, 7, 'with image', id)).statusCode, 409)
    assert.equal((await send(app)).statusCode, 402)
    const paidImage = await send(app, 7, 'image only', crypto.randomUUID(), 'image', '/api/studio/runs', true)
    assert.equal(paidImage.statusCode, 200)
    assert.equal(f.models.at(-1).preference, 'wallet_only')
    assert.equal(f.calls.filter(c => c.path === '/api/subscription/balance/pay').length, 1)
    assert.equal(f.calls.filter(c => c.path === '/api/token/').length, 1)
    assert.equal((await send(app, 8)).statusCode, 200)
    assert.equal(f.models.at(-1).owner, 8)
    assert.equal(f.models.at(-1).preference, 'subscription_only')
  } finally { await app.close() }
})

test('omitted and false consent preserve earlier idempotency hashes; true is distinct and non-booleans rejected', async () => {
  const f = fixture(), app = createServer(config, f.overrides), id = crypto.randomUUID()
  try {
    const result = await send(app, 7, 'text', id)
    assert.equal((await send(app, 7, 'text', id, 'chat', '/api/studio/runs', false)).body, result.body)
    assert.equal((await send(app, 7, 'text', id, 'chat', '/api/studio/runs', true)).statusCode, 409)
    assert.equal((await send(app, 7, 'text', crypto.randomUUID(), 'chat', '/api/studio/runs', 'true')).statusCode, 400)
    const imageId = crypto.randomUUID(), payload = { prompt: 'fixture', model: 'image' }
    const first = await app.inject({ method: 'POST', url: '/api/studio/images', headers: headers(7, imageId), payload })
    const replay = await app.inject({ method: 'POST', url: '/api/studio/images', headers: headers(7, imageId), payload: { ...payload, payWithBalance: false } })
    assert.equal(replay.body, first.body)
    assert.equal(f.models.length, 2)
  } finally { await app.close() }
})

test('unknown wallet preference blocks every new key across restart and even a matching read cannot unlock it', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gouo-paid-unknown-')), f = fixture({ failPreference: 'wallet_only' }), c = { ...config, ledgerPath: join(dir, 'requests.sqlite') }
  let app = createServer(c, f.overrides)
  try {
    for (let i = 0; i < 4; i++) assert.equal((await send(app)).statusCode, 200)
    f.accounts.get(7).quota = 10000
    const id = crypto.randomUUID()
    assert.equal((await send(app, 7, 'text', id, 'chat', '/api/studio/runs', true)).statusCode, 502)
    await app.close(); app = createServer(c, f.overrides)
    const before = f.calls.length
    assert.equal((await status(app)).state, 'unavailable')
    assert.equal((await send(app, 7, 'text', crypto.randomUUID(), 'chat', '/api/studio/runs', true)).statusCode, 409)
    assert.equal((await send(app, 7, 'image only', crypto.randomUUID(), 'image')).statusCode, 409)
    assert.ok(f.calls.slice(before).every(c => c.method === 'GET'))
    assert.equal(f.models.length, 4)
    const record = (await app.inject({ url: '/api/studio/requests/agent/' + id, headers: headers(7) })).json().data
    assert.deepEqual(record.submissions, [])
    // A late old handler can still write wallet_only after a read. No new send
    // reaches the gateway, and another owner is unaffected.
    f.preferences.set(7, 'wallet_only')
    assert.equal((await send(app, 7, 'image only', crypto.randomUUID(), 'image')).statusCode, 409)
    assert.equal((await send(app, 8)).statusCode, 200)
  } finally { await app.close(); rmSync(dir, { recursive: true, force: true }) }
})

test('paid consent never revives a disabled, expired, exhausted or broadened native token', async () => {
  for (const tokenChange of [{ status: 2 }, { expired_time: 1 }, { remain_quota: 0 }, { unlimited_quota: true }, { cross_group_retry: true }]) {
    const f = fixture(), app = createServer(config, f.overrides)
    try {
      for (let i = 0; i < 4; i++) assert.equal((await send(app)).statusCode, 200)
      f.accounts.get(7).quota = 10000
      Object.assign(f.tokens.get(7), tokenChange)
      const before = f.calls.length
      assert.equal((await send(app, 7, 'text', crypto.randomUUID(), 'chat', '/api/studio/runs', true)).statusCode, 403)
      assert.equal(f.models.length, 4)
      assert.ok(f.calls.slice(before).every(c => c.method === 'GET'))
      assert.equal(f.calls.filter(c => c.path === '/api/token/').length, 1)
    } finally { await app.close() }
  }
})

test('ambiguous paid model records source intent and never retries or returns a trial benefit', async () => {
  const f = fixture(), app = createServer(config, f.overrides)
  try {
    for (let i = 0; i < 4; i++) assert.equal((await send(app)).statusCode, 200)
    f.accounts.get(7).quota = 10000
    f.overrides.runAgent = async context => { await context.onGatewayRequest({ kind: 'chat', modelId: 'chat' }); throw new Error('fixture ambiguous paid response') }
    // Overrides are read dynamically by the route.
    const id = crypto.randomUUID()
    assert.equal((await send(app, 7, 'text', id, 'chat', '/api/studio/runs', true)).statusCode, 500)
    assert.equal((await send(app, 7, 'text', id, 'chat', '/api/studio/runs', true)).statusCode, 409)
    const record = (await app.inject({ url: '/api/studio/requests/agent/' + id, headers: headers(7) })).json().data
    assert.equal(record.status, 'unknown')
    assert.equal(record.submissions[0].selectedFundingSource, 'wallet')
    assert.deepEqual(record.attempts, [])
    assert.equal((await status(app)).chat.used, 4)
  } finally { await app.close() }
})
