import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { createServer } from '../src/server.mjs'

const image = { url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1sAAAAASUVORK5CYII=', prompt: 'fixture image', mimeType: 'image/png', width: 1, height: 1 }
const usage = { state: 'recorded', settlementState: 'unconfirmed', requestCount: 1, requestIds: ['fixture-native'], currency: 'CNY', quota: 50, cost: 0.05 }
const headers = { authorization: 'Bearer owner' }
const payload = (runId = crypto.randomUUID()) => ({ runId, sessionId: 'session', conversationId: 'conversation', prompt: 'fixture', model: 'chat' })
const events = runId => [{ type: 'run.started', runId }, { type: 'message.delta', runId, delta: 'saved text' },
  { type: 'tool.started', runId, toolCallId: 'image-call', toolName: 'generate_image', input: { prompt: image.prompt, model: 'image' } },
  { type: 'tool.completed', runId, toolCallId: 'image-call', toolName: 'generate_image', outputSummary: 'saved image', artifacts: [{ type: 'image', ...image }] },
  { type: 'run.completed', runId }]
const sendAgent = (app, body) => app.inject({ method: 'POST', url: '/api/studio/runs', headers: { ...headers, 'idempotency-key': body.runId }, payload: body })
const sendImage = (app, key) => app.inject({ method: 'POST', url: '/api/studio/images', headers: { ...headers, 'idempotency-key': key }, payload: { prompt: 'fixture image', model: 'image' } })
const get = (app, kind, key, token = 'owner', suffix = '/result') => app.inject({ url: `/api/studio/requests/${kind}/${key}${suffix}`, headers: { authorization: 'Bearer ' + token } })
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { resolve, promise } }

function fixture(t, changes = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'gouo-request-recovery-'))
  const config = { authOrigin: 'http://fixture.invalid', gateway: 'http://fixture.invalid/v1', relayKey: 'fixture-key', relayOwnerId: 7,
    allowGeneration: true, ledgerPath: join(directory, 'requests.sqlite'), models: [
      { id: 'chat', kind: 'chat', enabled: true, verification: 'live-verified' },
      { id: 'image', kind: 'image', enabled: true, verification: 'live-verified' },
    ] }
  const nativeCalls = [], generated = []
  const overrides = { fetch: async (url, init) => {
    const path = new URL(url).pathname
    nativeCalls.push({ path, method: init.method ?? 'GET' })
    if (path === '/api/user/self') return Response.json({ success: true, data: { id: init.headers.Authorization === 'Bearer owner' ? 7 : 8 } })
    if (path === '/api/status') return Response.json({ success: true, data: { quota_per_unit: 1000, usd_exchange_rate: 1 } })
    if (path === '/api/log/self') return Response.json({ success: true, data: { page: 1, page_size: 2, total: 1, items: [{ type: 2, request_id: 'fixture-native', quota: 50 }] } })
    throw new Error('Unexpected native operation')
  }, runAgent: async (context, _model, body) => {
    generated.push('agent')
    await context.onGatewayRequest({ kind: 'chat', modelId: 'private-upstream-model' })
    context.onGatewayResponse({ requestId: 'fixture-native', status: 200 })
    return { events: events(body.runId) }
  }, generateImage: async context => {
    generated.push('image')
    await context.onGatewayRequest({ kind: 'image', modelId: 'private-upstream-model' })
    context.onGatewayResponse({ requestId: 'fixture-native', status: 200 })
    return { ...image }
  }, ...changes }
  let app = createServer(config, overrides)
  const db = new DatabaseSync(config.ledgerPath)
  t.after(async () => { db.close(); await app.close(); rmSync(directory, { recursive: true, force: true }) })
  return { get app() { return app }, db, nativeCalls, generated, restart: async () => { await app.close(); app = createServer(config, overrides) } }
}
function snapshot(db) {
  return db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(({ name }) => ({ name,
    rows: db.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}" ORDER BY rowid`).all() }))
}
function seed(db, kind, key, status, result) {
  db.prepare('INSERT INTO requests VALUES(?,?,?,?,?,?,?)').run(7, kind, key, 'fixture-hash', status, result === undefined ? null : JSON.stringify(result), new Date().toISOString())
}

test('completed agent without threadId and direct image recover through GET with stored usage and no native billing or writes', async t => {
  const f = fixture(t), body = payload(), imageKey = crypto.randomUUID()
  assert.equal((await sendAgent(f.app, body)).statusCode, 200)
  assert.equal((await sendImage(f.app, imageKey)).statusCode, 200)
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM studio_runs').get().n, 0)
  const before = snapshot(f.db), calls = f.nativeCalls.length
  for (const [kind, key, expected] of [['agent', body.runId, { events: events(body.runId), usage }], ['image', imageKey, { ...image, usage }]]) {
    const response = await get(f.app, kind, key)
    assert.equal(response.statusCode, 200)
    assert.equal(response.headers['cache-control'], 'private, no-store')
    const result = response.json().data
    assert.deepEqual(Object.keys(result).sort(), ['createdAt', 'kind', 'requestId', 'result', 'status'])
    assert.equal(result.kind, kind); assert.equal(result.requestId, key); assert.equal(result.status, 'completed')
    assert.match(result.createdAt, /^\d{4}-\d{2}-\d{2}T/)
    assert.deepEqual(result.result, expected)
    assert.doesNotMatch(response.body, /private-upstream-model|submissions|attempts|fixture-key|authOrigin|gateway|channelId/)
  }
  assert.ok(f.nativeCalls.slice(calls).every(call => call.path === '/api/user/self' && call.method === 'GET'))
  assert.deepEqual(snapshot(f.db), before)
  assert.deepEqual(f.generated, ['agent', 'image'])
})

test('recovery rejects anonymous, cross-owner, missing records and invalid kind/key without creating ledger rows', async t => {
  const f = fixture(t), body = payload()
  assert.equal((await sendAgent(f.app, body)).statusCode, 200)
  const before = snapshot(f.db), calls = f.nativeCalls.length
  assert.equal((await f.app.inject(`/api/studio/requests/agent/${body.runId}/result`)).statusCode, 401)
  assert.equal((await get(f.app, 'agent', body.runId, 'other')).statusCode, 404)
  assert.equal((await get(f.app, 'agent', crypto.randomUUID())).statusCode, 404)
  for (const [kind, key, status] of [['video', body.runId, 400], ['Agent', body.runId, 400], ['agent', 'short', 400],
    ['image', 'a'.repeat(101), 414], ['agent', 'invalid%21key', 400]]) {
    // Fastify rejects parameters above its own 100-character limit first.
    assert.equal((await get(f.app, kind, key)).statusCode, status)
  }
  assert.deepEqual(snapshot(f.db), before)
  assert.ok(f.nativeCalls.slice(calls).every(call => call.path === '/api/user/self'))
  assert.deepEqual(f.generated, ['agent'])
})

test('running request reads actual state, then recovery sees the stored terminal after completion without posting again', async t => {
  const gate = deferred(), started = deferred()
  t.after(() => gate.resolve())
  const f = fixture(t, { runAgent: async (_context, _model, body) => { started.resolve(); await gate.promise; return { events: events(body.runId) } } })
  const body = payload(), sending = sendAgent(f.app, body)
  await started.promise
  const before = snapshot(f.db)
  const running = (await get(f.app, 'agent', body.runId)).json().data
  assert.equal(running.status, 'running'); assert.equal('result' in running, false)
  assert.deepEqual(snapshot(f.db), before)
  gate.resolve()
  assert.equal((await sending).statusCode, 200)
  const completed = (await get(f.app, 'agent', body.runId)).json().data
  assert.equal(completed.status, 'completed'); assert.deepEqual(completed.result.events, events(body.runId))
})

test('unknown recovery remains read only across restart and old key stays blocked without releasing held benefits', async t => {
  let calls = 0
  const f = fixture(t, { generateImage: async () => { calls++; throw new Error('fixture response lost') } }), key = crypto.randomUUID()
  assert.equal((await sendImage(f.app, key)).statusCode, 500)
  f.db.prepare("INSERT INTO trial_reservations VALUES(7,'image',?,'image','unknown')").run(key)
  const before = snapshot(f.db)
  let record = (await get(f.app, 'image', key)).json().data
  assert.equal(record.status, 'unknown'); assert.equal('result' in record, false)
  assert.deepEqual(snapshot(f.db), before)
  await f.restart()
  const restarted = snapshot(f.db)
  record = (await get(f.app, 'image', key)).json().data
  assert.equal(record.status, 'unknown'); assert.equal('result' in record, false)
  assert.deepEqual(snapshot(f.db), restarted)
  assert.equal((await sendImage(f.app, key)).statusCode, 409)
  assert.equal(calls, 1)
  assert.equal(f.db.prepare('SELECT status FROM trial_reservations WHERE owner=7 AND key=?').get(key).status, 'unknown')
})

test('same key separates agent/image; completed stored results survive restart and history endpoint keeps its original scope', async t => {
  const f = fixture(t), body = payload()
  assert.equal((await sendAgent(f.app, body)).statusCode, 200)
  assert.equal((await sendImage(f.app, body.runId)).statusCode, 200)
  await f.restart()
  const before = snapshot(f.db)
  assert.deepEqual((await get(f.app, 'agent', body.runId)).json().data.result, { events: events(body.runId), usage })
  assert.deepEqual((await get(f.app, 'image', body.runId)).json().data.result, { ...image, usage })
  assert.equal((await f.app.inject({ url: '/api/studio/runs/' + body.runId, headers })).statusCode, 404)
  assert.deepEqual(snapshot(f.db), before)
  assert.deepEqual(f.generated, ['agent', 'image'])
})

test('saved failed terminal and legacy usage are projected truthfully without rewriting rows or leaking nested metadata', async t => {
  const f = fixture(t), key = crypto.randomUUID(), secret = 'fixture-private-secret'
  const savedEvents = events(key)
  savedEvents[0].channelId = secret
  savedEvents[2].input.token = secret
  savedEvents[3].artifacts[0].baseURL = secret
  savedEvents[3].output = { key: secret }
  savedEvents[4] = { type: 'run.failed', runId: key, error: { code: 'gateway_failed', message: 'actual failed summary', requestHeaders: secret },
    usage: { ...usage, state: 'settled', relayKey: secret } }
  seed(f.db, 'agent', key, 'completed', { events: savedEvents, usage: { ...usage, state: 'settled', relayKey: secret },
    fundingSelection: { chat: 'wallet', image: 'trial', provider: secret }, provider: { token: secret }, model_submissions: [secret] })
  const before = snapshot(f.db), response = await get(f.app, 'agent', key), record = response.json().data
  assert.equal(response.statusCode, 200)
  assert.equal(record.status, 'completed')
  assert.equal(record.result.events.at(-1).type, 'run.failed')
  assert.deepEqual(record.result.events.at(-1).error, { code: 'gateway_failed', message: 'actual failed summary' })
  assert.deepEqual(record.result.usage, usage); assert.deepEqual(record.result.events.at(-1).usage, usage)
  assert.deepEqual(record.result.fundingSelection, { chat: 'wallet', image: 'trial' })
  assert.equal(record.result.events[3].artifacts[0].url, image.url)
  assert.doesNotMatch(response.body, /fixture-private-secret|model_submissions|provider|relayKey|channelId|baseURL|requestHeaders/)
  assert.deepEqual(snapshot(f.db), before)
})

test('unknown/running never expose even an existing result; corrupt state, JSON and unsupported result shapes fail closed without raw details', async t => {
  const f = fixture(t), secret = 'fixture-private-secret', beforeCalls = f.nativeCalls.length
  for (const status of ['unknown', 'running']) {
    const key = crypto.randomUUID()
    seed(f.db, 'image', key, status, { ...image, provider: secret })
    const before = snapshot(f.db), response = await get(f.app, 'image', key)
    assert.equal(response.statusCode, 200); assert.equal(response.json().data.status, status)
    assert.equal('result' in response.json().data, false); assert.doesNotMatch(response.body, /fixture-private-secret|data:image/)
    assert.deepEqual(snapshot(f.db), before)
  }
  for (const invalid of [
    { status: secret, result: JSON.stringify(image) },
    { status: 'completed', result: JSON.stringify(image), createdAt: secret },
    { status: 'completed', result: '{"private":"' + secret },
    { status: 'completed', result: null },
    { status: 'completed', result: JSON.stringify({ url: 'https://private.invalid/' + secret }) },
    { status: 'completed', result: JSON.stringify({ events: [{ type: 'run.canceled', secret }] }) },
  ]) {
    const kind = invalid.result?.includes('run.canceled') ? 'agent' : 'image', key = crypto.randomUUID()
    seed(f.db, kind, key, invalid.status)
    f.db.prepare('UPDATE requests SET result=? WHERE key=?').run(invalid.result, key)
    if (invalid.createdAt) f.db.prepare('UPDATE requests SET created_at=? WHERE key=?').run(invalid.createdAt, key)
    const before = snapshot(f.db), response = await get(f.app, kind, key)
    assert.equal(response.statusCode, 502)
    assert.match(response.json().message, /无法安全读取/)
    assert.doesNotMatch(response.body, /fixture-private-secret|private.invalid|SELECT|resultBytes|JSON|SQL|run.canceled/)
    assert.deepEqual(snapshot(f.db), before)
  }
  assert.ok(f.nativeCalls.slice(beforeCalls).every(call => call.path === '/api/user/self'))
  assert.deepEqual(f.generated, [])
})

test('oversized stored result is rejected before JSON materialization and remains intact', async t => {
  const f = fixture(t), key = crypto.randomUUID()
  seed(f.db, 'image', key, 'completed')
  const saved = '{"private":"' + 'x'.repeat(48 * 1024 * 1024) + '"}'
  f.db.prepare('UPDATE requests SET result=? WHERE key=?').run(saved, key)
  const response = await get(f.app, 'image', key)
  assert.equal(response.statusCode, 502)
  assert.doesNotMatch(response.body, /private|resultBytes|SELECT|JSON/)
  assert.equal(f.db.prepare('SELECT result FROM requests WHERE key=?').get(key).result, saved)
  assert.deepEqual(f.generated, [])
})

test('existing accounting GET retains submissions/attempts/native evidence separately from stored-result recovery', async t => {
  const f = fixture(t), key = crypto.randomUUID()
  assert.equal((await sendImage(f.app, key)).statusCode, 200)
  const before = snapshot(f.db), calls = f.nativeCalls.length
  const legacy = (await get(f.app, 'image', key, 'owner', '')).json().data
  assert.equal(legacy.status, 'completed')
  assert.equal(legacy.submissions[0].modelId, 'private-upstream-model')
  assert.deepEqual(legacy.attempts, [{ attempt: 1, requestId: 'fixture-native', status: 200 }])
  assert.deepEqual(legacy.usage, usage)
  assert.ok(f.nativeCalls.slice(calls).some(call => call.path === '/api/status'))
  assert.ok(f.nativeCalls.slice(calls).some(call => call.path === '/api/log/self'))
  const count = f.nativeCalls.length, recovered = (await get(f.app, 'image', key)).json().data
  assert.equal('submissions' in recovered, false); assert.equal('attempts' in recovered, false)
  assert.ok(f.nativeCalls.slice(count).every(call => call.path === '/api/user/self'))
  assert.deepEqual(snapshot(f.db), before)
})
