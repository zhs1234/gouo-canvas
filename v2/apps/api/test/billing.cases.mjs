import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from '../src/server.mjs'
import { priceCard, quotaToMoney, settledUsage } from '../src/billing.mjs'
import { relayKey } from '../src/relay.mjs'

const image = { id: 'image', displayName: 'Fixture image', kind: 'image', upstreamModelId: 'fixture-image', enabled: true, verification: 'live-verified', operations: ['generate'] }
const config = { models: [image], relayKey: 'fixture-secret', relayOwnerId: 7, allowGeneration: true, gateway: 'http://fixture.invalid/v1', authOrigin: 'http://fixture.invalid', ledgerPath: ':memory:' }
const headers = { authorization: 'Bearer fixture-user-7', 'idempotency-key': 'billing-fixture-123' }
const json = data => new Response(JSON.stringify({ success: true, data }), { status: 200 })
function accountFetch(calls) {
  return async (url, init) => {
    const parsed = new URL(url); const owner = init.headers.Authorization.endsWith('-8') ? 8 : 7
    calls.push({ path: parsed.pathname, owner })
    if (parsed.pathname === '/api/user/self') return json({ id: owner, group: 'default', quota: owner * 500000, used_quota: 1234, request_count: 3, secret: 'fixture-profile-secret' })
    if (parsed.pathname === '/api/status') return json({ quota_per_unit: 500000, usd_exchange_rate: 7.3, key: 'fixture-status-secret' })
    if (parsed.pathname === '/api/pricing') return new Response(JSON.stringify({ success: true, group_ratio: { default: 1 }, data: [{ model_name: 'fixture-image', model_ratio: 2.5, completion_ratio: 6, internal_url: 'fixture-hidden' }] }))
    if (parsed.pathname === '/api/log/self') {
      const id = parsed.searchParams.get('request_id')
      return json({ items: id ? [{ request_id: 'unrelated-id', quota: 99999999 }, { request_id: id, quota: id === 'fixture-call-1' ? 12345 : 67890 }] : [
        { id: 1, model_name: 'fixture-image', token_name: 'owner-token', quota: 1234, prompt_tokens: 20, completion_tokens: 30, created_at: 1, content: 'fixture-private-prompt', other: 'fixture-log-secret' },
        { id: 2, model_name: 'fixture-image', token_name: '模型测试', quota: 9999999, created_at: 1 },
      ] })
    }
    throw new Error('unexpected native API')
  }
}

test('billing uses real account authorization, scopes another account correctly and strips private metadata', async () => {
  const calls = []; const app = createServer(config, { fetch: accountFetch(calls) })
  try {
    assert.equal((await app.inject('/api/studio/billing')).statusCode, 401); assert.equal(calls.length, 0)
    const own = await app.inject({ url: '/api/studio/billing?user_id=8', headers })
    assert.equal(own.statusCode, 200)
    assert.equal(own.json().data.balance, 7 * 7.3); assert.equal(own.json().data.groupRatio, 1)
    assert.equal(own.json().data.recentCalls.length, 1)
    assert.doesNotMatch(own.body, /secret|private-prompt|fixture-hidden|user_id/)
    const other = await app.inject({ url: '/api/studio/billing?user_id=7', headers: { authorization: 'Bearer fixture-user-8', 'new-api-user': '7' } })
    assert.equal(other.statusCode, 200); assert.equal(other.json().data.balance, 8 * 7.3)
    assert.equal(calls.at(-1).owner, 8)
  } finally { await app.close() }
})

test('authoritative native charge is saved with the result and idempotent replay does not charge or settle again', async () => {
  let generated = 0; const calls = []
  const app = createServer(config, { fetch: accountFetch(calls), generateImage: async context => {
    generated++
    context.onGatewayResponse({ requestId: 'fixture-call-1', status: 200 })
    context.onGatewayResponse({ requestId: 'fixture-call-2', status: 200 })
    return { url: 'fixture-only', width: 32, height: 24 }
  } })
  const send = () => app.inject({ method: 'POST', url: '/api/studio/images', headers, payload: { prompt: 'fixture' } })
  try {
    const first = await send(); assert.equal(first.statusCode, 200)
    assert.equal(first.json().data.usage.state, 'settled')
    assert.equal(first.json().data.usage.quota, 80235)
    assert.equal(first.json().data.usage.cost, 80235 / 500000 * 7.3)
    const logReads = calls.filter(c => c.path === '/api/log/self').length
    assert.deepEqual((await send()).json(), first.json()); assert.equal(generated, 1)
    assert.equal(calls.filter(c => c.path === '/api/log/self').length, logReads)
  } finally { await app.close() }
})

test('pending or unavailable native billing never becomes a fake zero charge or discards the image', async () => {
  const missing = async url => new URL(url).pathname === '/api/user/self' ? json({ id: 7 }) : json({ items: [] })
  const app = createServer(config, { fetch: missing, generateImage: async context => {
    context.onGatewayResponse({ requestId: 'fixture-id', status: 200 }); return { url: 'fixture-result', width: 32 }
  } })
  try {
    const result = await app.inject({ method: 'POST', url: '/api/studio/images', headers, payload: { prompt: 'fixture' } })
    assert.equal(result.statusCode, 200); assert.equal(result.json().data.url, 'fixture-result')
    assert.equal(result.json().data.usage.state, 'pending'); assert.equal(result.json().data.usage.cost, undefined)
    const duplicate = await settledUsage(config, headers.authorization, [{ requestId: 'same', status: 200 }, { requestId: 'same', status: 200 }], () => { throw new Error('must not query') })
    assert.equal(duplicate.state, 'pending')
  } finally { await app.close() }
})

test('price display preserves native token tiers and unknown expressions cannot silently turn into rates', () => {
  const card = priceCard({ billing_mode: 'tiered_expr', billing_expr: 'len <= 272000 ? tier("standard", p * 10 + c * 50 + cr * 1) : tier("long_context", p * 20 + c * 75)' }, image, 1)
  assert.equal(card.longContextAfter, 272000); assert.equal(card.tiers[1].rates.c, 75)
  assert.equal(priceCard({ billing_mode: 'tiered_expr', billing_expr: 'unknown(p) + tier("standard", p * 10 + c * 50)' }, image, 1).mode, 'gateway-defined')
  assert.equal(priceCard({ model_ratio: 2.5, completion_ratio: 6 }, image, 1).tiers[0].rates.c, 30)
  assert.throws(() => quotaToMoney(-1, { quotaPerUnit: 500000, usdExchangeRate: 7.3 }))
  assert.equal(relayKey(config, { channelId: 2 }), 'fixture-secret-2')
  assert.throws(() => relayKey({ ...config, relayKey: 'fixture-secret-1' }, { channelId: 2 }))
})
