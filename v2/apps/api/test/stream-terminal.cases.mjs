import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import Fastify from 'fastify'
import sharp from 'sharp'
import { createServer } from '../src/server.mjs'

const sourceCommit = '0aec08fee811ec6136828fda790551b49e410301'
const instanceId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const plan = { price_amount: 0, total_amount: 10000, duration_unit: 'day', duration_value: 7, custom_seconds: 0, quota_reset_period: 'never', max_purchase_per_user: 1, allow_balance_pay: true, allow_wallet_overflow: false, upgrade_group: '', downgrade_group: '' }
const models = [
  { id: 'chat', kind: 'chat', upstreamModelId: 'fixture-chat', enabled: true, verification: 'live-verified', toolCalling: true, maxChatCalls: 2 },
  { id: 'image', kind: 'image', upstreamModelId: 'fixture-image', enabled: true, verification: 'live-verified', operations: ['generate'], qualities: [], sizes: {} },
]
const parse = text => text.split('\n\n').filter(frame => frame.startsWith('data: ')).map(frame => JSON.parse(frame.slice(6)))
const pngHash = url => createHash('sha256').update(Buffer.from(url.split(',')[1], 'base64')).digest('hex')

// Real SDK + loopback HTTP model contracts. Accounts/funding are explicit
// in-memory fixtures; no Native service, operator key, or paid API is used.
async function fixture(t, options = {}) {
  const calls = { chat: 0, image: 0, native: [] }, tokens = new Map(), subscriptions = new Map(), preferences = new Map()
  const upstream = Fastify()
  const png = await sharp({ create: { width: 12, height: 9, channels: 3, background: '#5599aa' } }).png().toBuffer()
  upstream.post('/v1/chat/completions', async (request, reply) => {
    calls.chat++
    assert.equal(request.headers.authorization, 'Bearer ' + '7'.repeat(48))
    assert.equal(request.body.model, 'fixture-chat')
    const planning = options.tool && calls.chat === 1
    const toolCalls = [{ id: 'fixture-tool', type: 'function', function: { name: 'generate_image', arguments: JSON.stringify({ prompt: 'explicit synthetic image' }) } }]
    const finish = options.missingAt === calls.chat ? undefined : options.reason ?? (planning ? 'tool_calls' : 'stop')
    const usage = { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 }
    if (!request.body.stream) {
      reply.header('X-Oneapi-Request-Id', 'chat-' + calls.chat)
      return { id: 'fixture-response-' + calls.chat, object: 'chat.completion', created: 1, model: 'fixture-chat', usage,
        choices: [{ index: 0, ...(finish === undefined ? {} : { finish_reason: finish }), message: { role: 'assistant', content: planning ? '' : '已收到的部分文字', ...(planning ? { tool_calls: toolCalls } : {}) } }] }
    }
    reply.hijack()
    reply.raw.writeHead(200, { 'content-type': 'text/event-stream', 'x-oneapi-request-id': 'chat-' + calls.chat })
    const chunk = (delta, finish_reason = null) => reply.raw.write('data: ' + JSON.stringify({ id: 'fixture-response-' + calls.chat, object: 'chat.completion.chunk', created: 1, model: 'fixture-chat', choices: [{ index: 0, delta, finish_reason }] }) + '\n\n')
    chunk({ role: 'assistant', ...(planning ? { tool_calls: toolCalls.map((call, index) => ({ index, ...call })) } : { content: '已收到的部分文字' }) })
    if (finish !== undefined) chunk({}, finish)
    // Pinned Native can synthesize usage + DONE after upstream scanner errors.
    // A successful HTTP status/usage frame/DONE is not a model finish marker.
    reply.raw.write('data: ' + JSON.stringify({ id: 'fixture-response-' + calls.chat, object: 'chat.completion.chunk', created: 1, model: 'fixture-chat', choices: [], usage }) + '\n\n')
    reply.raw.end('data: [DONE]\n\n')
  })
  upstream.post('/v1/images/generations', async (request, reply) => {
    assert.equal(request.headers.authorization, 'Bearer ' + '7'.repeat(48))
    calls.image++; reply.header('X-Oneapi-Request-Id', 'image-' + calls.image)
    return { data: [{ b64_json: png.toString('base64') }] }
  })
  await upstream.listen({ host: '127.0.0.1', port: 0 })
  const origin = upstream.listeningOrigin
  const accountFetch = async (url, init) => {
    const parsed = new URL(url), path = parsed.pathname, owner = Number(init.headers.Authorization.split('-').at(-1))
    calls.native.push({ path, method: init.method ?? 'GET' })
    let data
    if (path === '/api/user/self') data = { id: owner, status: 1, role: 1, group: 'default', quota: 0 }
    else if (path === '/api/user/models') data = ['fixture-chat', 'fixture-image']
    else if (path === '/api/subscription/plans') data = [{ plan: { id: 3, enabled: true, ...plan } }]
    else if (path === '/api/subscription/self') {
      const subscription = subscriptions.get(owner)
      data = { billing_preference: preferences.get(owner) ?? 'subscription_first', subscriptions: subscription ? [{ subscription }] : [], all_subscriptions: subscription ? [{ subscription }] : [] }
    } else if (path === '/api/subscription/balance/pay') {
      assert.equal(subscriptions.has(owner), false, 'one synthetic grant only')
      subscriptions.set(owner, { id: owner * 10, user_id: owner, plan_id: 3, amount_total: 10000, amount_used: 0, end_time: Math.floor(Date.now() / 1000) + 3600, status: 'active', allow_wallet_overflow: false, upgrade_group: '', downgrade_group: '' })
    } else if (path === '/api/subscription/self/preference') { preferences.set(owner, JSON.parse(init.body).billing_preference); data = { billing_preference: preferences.get(owner) } }
    else if (path === '/api/token/search') data = { items: tokens.has(owner) ? [tokens.get(owner)] : [], total: tokens.has(owner) ? 1 : 0 }
    else if (path === '/api/token/') tokens.set(owner, { ...JSON.parse(init.body), id: owner, user_id: owner, status: 1 })
    else if (/\/api\/token\/\d+\/key/.test(path)) data = { key: String(owner).repeat(48) }
    else if (path === '/api/status') data = { quota_per_unit: 1000, usd_exchange_rate: 1 }
    else if (path === '/api/log/self') data = { page: 1, page_size: 2, total: 1, items: [{ type: 2, request_id: parsed.searchParams.get('request_id'), quota: 100 }] }
    else throw new Error('Unexpected synthetic account contract')
    return Response.json({ success: true, data })
  }
  const app = createServer({ models, gateway: origin + '/v1', authOrigin: origin, ledgerPath: ':memory:', allowGeneration: true,
    relayCredentialMode: 'user-token', relayRoutingMode: 'model', userTokenQuotaCap: 1000, userTokenLifetimeSeconds: 3600, accountInstanceId: instanceId,
    normalRoutingEvidence: { sourceCommit, retryTimes: 0, gatewayOrigin: origin, operatorVerified: true, verifiedAt: '2026-10-02' },
    trial: { sourceCommit, gatewayOrigin: origin, instanceId, minUserId: 7, planId: 3, relayIngress: 'studio-only', operatorVerified: true, plan },
  }, { fetch: accountFetch })
  t.after(async () => { await app.close(); upstream.server.closeAllConnections(); await upstream.close() })
  const headers = { authorization: 'Bearer fixture-user-7' }
  const thread = options.batch ? null : (await app.inject({ method: 'POST', url: '/api/studio/threads', headers, payload: {} })).json().data
  const body = { runId: crypto.randomUUID(), model: 'chat', sessionId: 'synthetic-session', conversationId: 'synthetic-conversation', prompt: 'explicit fixture', ...(thread ? { threadId: thread.id } : {}) }
  const send = (payload = body, extra = {}) => app.inject({ method: 'POST', url: options.batch ? '/api/studio/runs' : '/api/studio/runs/stream', headers: { ...headers, 'idempotency-key': payload.runId, ...extra }, payload })
  const events = response => options.batch ? response.json().data.events : parse(response.body)
  const read = path => app.inject({ url: path, headers })
  const trial = async () => (await read('/api/studio/trial')).json().data
  return { calls, app, body, send, events, read, trial, thread, originalPngHash: createHash('sha256').update(png).digest('hex') }
}

for (const batch of [false, true]) for (const tool of [false, true]) test(`truthful ${tool ? 'tool_calls then stop' : 'stop'} metadata completes ${batch ? 'batch' : 'SSE'} without extra model calls`, async t => {
  const f = await fixture(t, { batch, tool }), response = await f.send(), events = f.events(response)
  assert.equal(response.statusCode, 200)
  assert.equal(events.at(-1).type, 'run.completed')
  assert.equal(events.some(event => event.type === 'run.failed'), false)
  assert.equal(f.calls.chat, tool ? 2 : 1); assert.equal(f.calls.image, tool ? 1 : 0)
  if (tool) assert.equal(pngHash(events.find(event => event.type === 'tool.completed').artifacts[0].url), f.originalPngHash)
  const benefits = await f.trial()
  assert.equal(benefits.chat.used, 1); assert.equal(benefits.chat.held, 0)
  assert.equal(benefits.image.used, tool ? 1 : 0); assert.equal(benefits.image.held, 0)
})

for (const batch of [false, true]) test(`missing model finish metadata with usage and transport DONE fails ${batch ? 'batch' : 'SSE'}, preserves partial text and holds usage`, async t => {
  const f = await fixture(t, { batch, missingAt: 1 }), response = await f.send(), events = f.events(response)
  assert.equal(response.statusCode, 200)
  assert.equal(events.at(-1).type, 'run.failed'); assert.match(events.at(-1).error.message, /完成标记.*费用待确认/)
  assert.equal(events.some(event => event.type === 'run.completed'), false)
  assert.equal(events.filter(event => event.type === 'message.delta').map(event => event.delta).join(''), '已收到的部分文字')
  const benefits = await f.trial()
  assert.equal(benefits.pendingReconciliation, true); assert.equal(benefits.chat.held, 1); assert.equal(benefits.chat.used, 0)
  assert.equal(f.calls.chat, 1); assert.equal(f.calls.image, 0)
})

test('missing summary finish marker preserves the original PNG and failed terminal; GET and exact replay make no new model or funding write', async t => {
  const f = await fixture(t, { tool: true, missingAt: 2 })
  assert.equal((await f.send(f.body, { authorization: 'Bearer fixture-user-8' })).statusCode, 404)
  assert.equal(f.calls.chat, 0); assert.equal(f.calls.image, 0)
  const response = await f.send(), events = f.events(response)
  assert.equal(response.statusCode, 200); assert.equal(events.at(-1).type, 'run.failed')
  assert.equal(events.some(event => event.type === 'run.completed'), false)
  const artifacts = events.filter(event => event.type === 'tool.completed').flatMap(event => event.artifacts)
  assert.equal(artifacts.length, 1); assert.equal(pngHash(artifacts[0].url), f.originalPngHash)
  assert.equal(events.filter(event => event.type === 'message.delta').map(event => event.delta).join(''), '已收到的部分文字')
  assert.equal(events.at(-1).usage.settlementState, 'unconfirmed')
  const before = f.calls.native.length, counts = [f.calls.chat, f.calls.image]
  const stored = (await f.read('/api/studio/requests/agent/' + f.body.runId + '/result')).json().data
  assert.equal(stored.status, 'completed', 'ledger completion means the failed result was saved')
  assert.equal(stored.result.events.at(-1).type, 'run.failed')
  assert.equal(pngHash(stored.result.events.find(event => event.type === 'tool.completed').artifacts[0].url), f.originalPngHash)
  const history = (await f.read('/api/studio/threads/' + f.thread.id)).json().data.runs[0]
  assert.equal(history.status, 'failed'); assert.equal(history.runId, f.body.runId)
  const benefits = await f.trial()
  assert.equal(benefits.chat.held, 1); assert.equal(benefits.image.held, 1)
  assert.equal(benefits.chat.used, 0); assert.equal(benefits.image.used, 0)
  assert.deepEqual(f.events(await f.send()), events)
  assert.equal((await f.send({ ...f.body, prompt: 'changed' })).statusCode, 409)
  assert.deepEqual([f.calls.chat, f.calls.image], counts)
  assert.ok(f.calls.native.slice(before).every(call => call.method === 'GET'))
})

test('a planning tool call without a finish marker cannot start an image or another chat call', async t => {
  const f = await fixture(t, { tool: true, missingAt: 1 }), events = f.events(await f.send())
  assert.equal(events.at(-1).type, 'run.failed')
  assert.equal(events.some(event => event.type === 'tool.started' || event.type === 'tool.completed'), false)
  assert.equal(f.calls.chat, 1); assert.equal(f.calls.image, 0)
  assert.equal((await f.trial()).chat.held, 1)
})

for (const reason of ['length', 'content_filter', 'unsupported-private-reason'.repeat(5)]) test(`non-complete finish metadata ${reason.length <= 32 ? reason : 'oversized'} never becomes successful generation`, async t => {
  const f = await fixture(t, { reason }), response = await f.send(), events = f.events(response)
  assert.equal(events.at(-1).type, 'run.failed'); assert.equal(events.some(event => event.type === 'run.completed'), false)
  assert.equal(f.calls.chat, 1); assert.equal(f.calls.image, 0)
  assert.equal((await f.trial()).chat.held, 1)
  assert.ok(!response.body.includes(reason), 'raw finish metadata does not become a public error')
})
