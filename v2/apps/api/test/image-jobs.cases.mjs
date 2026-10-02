import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import sharp from 'sharp'
import { createServer } from '../src/server.mjs'
import { digest, imageApproval } from '../src/image-jobs.mjs'
import { spawn } from 'node:child_process'
import { createServer as createHTTPServer } from 'node:http'

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
const plan = { price_amount: 0, total_amount: 10000, duration_unit: 'day', duration_value: 7, custom_seconds: 0, quota_reset_period: 'never', max_purchase_per_user: 1,
  allow_balance_pay: true, allow_wallet_overflow: false, upgrade_group: '', downgrade_group: '' }
const payload = { prompt: 'explicit fixture image', model: 'image', inputImages: [], payWithBalance: true }
const headers = owner => ({ authorization: 'Bearer fixture-account-secret-' + owner })
const get = (app, id, owner = 7) => app.inject({ url: '/api/studio/image-jobs/' + id, headers: headers(owner) })
const post = (app, id, body = payload, owner = 7) => app.inject({ method: 'POST', url: '/api/studio/image-jobs', headers: { ...headers(owner), 'idempotency-key': id }, payload: body })
const sync = (app, id, body = payload, owner = 7) => app.inject({ method: 'POST', url: '/api/studio/images', headers: { ...headers(owner), 'idempotency-key': id }, payload: body })
const operation = (app, id, action, owner = 7, body = { confirm: true }) => app.inject({ method: 'POST', url: `/api/studio/image-jobs/${id}/${action}`, headers: headers(owner), payload: body })
async function waitFor(app, id, state, owner = 7) {
  for (let i = 0; i < 100; i++) {
    const response = await get(app, id, owner)
    if (response.json().data?.status === state) return response.json().data
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  assert.fail('fixture did not reach ' + state)
}
function snapshot(db) {
  return db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(({ name }) => [name,
    db.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}" ORDER BY rowid`).all()])
}
async function fixture(t, options = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'gouo-image-jobs-')), path = join(directory, 'requests.sqlite')
  const png = await sharp({ create: { width: 2, height: 3, channels: 4, background: '#cc5577' } }).png().toBuffer()
  const image = { url: 'data:image/png;base64,' + png.toString('base64'), prompt: payload.prompt, mimeType: 'image/png', width: 2, height: 3 }
  const account = new Map([7,8].map(owner => [owner, { id: owner, status: 1, role: 1, group: 'default', quota: options.trial ? 0 : 1000 }]))
  const models = [
    { id: 'image', displayName: 'Fixture image', kind: 'image', upstreamModelId: 'fixture-image', enabled: true, verification: 'live-verified', operations: ['generate','edit'], qualities: ['high'], sizes: { '1:1': '1024x1024' } },
    { id: 'chat', displayName: 'Fixture chat', kind: 'chat', upstreamModelId: 'fixture-chat', enabled: true, verification: 'live-verified', toolCalling: false },
  ]
  const config = { ledgerPath: path, authOrigin: 'http://fixture.invalid', gateway: 'http://fixture.invalid/v1', allowGeneration: true, enableImageJobs: options.enabled !== false,
    relayCredentialMode: 'user-token', relayRoutingMode: 'model', accountInstanceId: 'cafdb7a7-58d9-4e6b-9707-91b38baed7ea', userTokenQuotaCap: 1000, userTokenLifetimeSeconds: 3600, models,
    normalRoutingEvidence: { sourceCommit: '0aec08fee811ec6136828fda790551b49e410301', retryTimes: 0, gatewayOrigin: 'http://fixture.invalid', operatorVerified: true, verifiedAt: '2026-10-02' },
    ...(options.trial ? { trial: { sourceCommit: '0aec08fee811ec6136828fda790551b49e410301', gatewayOrigin: 'http://fixture.invalid', instanceId: 'cafdb7a7-58d9-4e6b-9707-91b38baed7ea', minUserId: 7, planId: 3, relayIngress: 'studio-only', operatorVerified: true, plan } } : {}) }
  if (options.renewal) config.tokenRenewalPolicy = { sourceCommit: config.normalRoutingEvidence.sourceCommit, gatewayOrigin: 'http://fixture.invalid', instanceId: config.accountInstanceId,
    operatorVerified: true, relayIngress: 'studio-only', tokenWrites: 'studio-only', completeKeys: 'studio-only', redisEnabled: false, batchUpdateEnabled: false }
  const native = [], calls = [], tokens = new Map(), subscriptions = new Map(), preferences = new Map(), permissions = new Map()
  for (const owner of [7,8]) tokens.set(owner, { id: owner, user_id: owner, name: 'gouo-studio', status: 1, remain_quota: 1000, unlimited_quota: false,
    expired_time: Math.floor(Date.now() / 1000) + 3000, model_limits_enabled: true, model_limits: 'fixture-image,fixture-chat', group: '', cross_group_retry: false })
  const fetch = async (url, init) => {
    const parsed = new URL(url), route = parsed.pathname, owner = Number(init.headers.Authorization.split('-').at(-1))
    native.push({ route, method: init.method ?? 'GET', owner })
    if (options.beforeNative) await options.beforeNative(route, init, owner)
    let data
    if (route === '/api/user/self') data = account.get(owner)
    else if (route === '/api/user/models') data = permissions.get(owner) ?? ['fixture-image','fixture-chat']
    else if (route === '/api/subscription/plans') data = [{ plan: { id: 3, enabled: true, ...plan } }]
    else if (route === '/api/subscription/self') {
      const sub = subscriptions.get(owner)
      data = { billing_preference: preferences.get(owner) ?? 'wallet_only', all_subscriptions: sub ? [{ subscription: sub }] : [], subscriptions: sub ? [{ subscription: sub }] : [] }
    } else if (route === '/api/subscription/balance/pay') {
      assert.equal(subscriptions.has(owner), false)
      subscriptions.set(owner, { id: owner * 10, user_id: owner, plan_id: 3, amount_total: 10000, amount_used: 0, end_time: Math.floor(Date.now() / 1000) + 3000,
        status: 'active', allow_wallet_overflow: false, upgrade_group: '', downgrade_group: '' })
      if (options.lostPurchase) throw new Error('fixture purchase response lost')
    } else if (route === '/api/subscription/self/preference') {
      preferences.set(owner, JSON.parse(init.body).billing_preference)
      if (options.lostPreference) throw new Error('fixture native write response lost')
      data = { billing_preference: preferences.get(owner) }
    } else if (route === '/api/token/search') data = { total: tokens.has(owner) ? 1 : 0, items: tokens.has(owner) ? [tokens.get(owner)] : [] }
    else if (route === '/api/token/') {
      tokens.set(owner, { ...JSON.parse(init.body), id: owner, user_id: owner, status: 1 })
      if (options.lostToken) throw new Error('fixture token creation response lost')
    } else if (/\/api\/token\/\d+\/key/.test(route)) data = { key: String(owner).repeat(48) }
    else if (route === '/api/status') data = { quota_per_unit: 1000, usd_exchange_rate: 1 }
    else if (route === '/api/log/self') data = { page: 1, page_size: 2, total: 1, items: [{ type: 2, request_id: parsed.searchParams.get('request_id'), quota: 50 }] }
    else throw new Error('Unexpected native fixture route')
    return Response.json({ success: true, data })
  }
  const generateImage = async context => {
    await context.onGatewayRequest({ kind: 'image', modelId: 'image' })
    calls.push({ owner: context.relayOwnerId, kind: 'image', preference: preferences.get(context.relayOwnerId) ?? 'wallet_only' })
    context.onGatewayResponse({ requestId: 'fixture-' + calls.length, status: 200 })
    if (options.gate) await options.gate.promise
    if (options.failedModel) throw new Error('fixture-private-provider-secret')
    if (options.invalidImage) { await context.onImageOutput?.(Buffer.from('AAAA', 'base64')); return { url: 'data:image/png;base64,AAAA' } }
    await context.onImageOutput?.(png)
    return { ...image, provider: { key: 'fixture-private-provider-secret' } }
  }
  const overrides = { fetch, generateImage, runAgent: async (context, _model, body) => {
    await context.onGatewayRequest({ kind: 'chat', modelId: 'chat' })
    calls.push({ owner: context.relayOwnerId, kind: 'chat' }); context.onGatewayResponse({ requestId: 'fixture-' + calls.length, status: 200 })
    return { events: [{ type: 'run.completed', runId: body.runId }] }
  } }
  let app = createServer(config, overrides)
  const db = new DatabaseSync(path)
  t.after(async () => { options.gate?.resolve(); db.close(); await app.close(); rmSync(directory, { recursive: true, force: true }) })
  return { get app() { return app }, db, path, config, account, image, png, native, calls, tokens, permissions, subscriptions,
    restart: async () => { await app.close(); app = createServer(config, overrides) } }
}
function seedAccepted(f, id, state = 'accepted', extra = {}) {
  const body = { ...payload }, now = new Date().toISOString(), owner = extra.owner ?? 7
  f.db.prepare('INSERT INTO requests VALUES(?,?,?,?,?,?,?)').run(owner, 'image', id, digest(body), 'running', null, now)
  f.db.prepare('INSERT INTO image_jobs VALUES(?,?,?,?,?,?,?,?,?,NULL,NULL,?,?)').run(owner, id, JSON.stringify(body), digest(body), imageApproval(f.config, f.config.models[0], f.account.get(owner)), 'image', 'wallet', state, extra.nativePending ?? 0, now, now)
  f.db.prepare("INSERT INTO image_job_reservations VALUES(?,?,'held')").run(owner, id)
  f.db.prepare("INSERT INTO image_job_outbox VALUES(?,?,'pending')").run(owner, id)
  if (extra.submitted) f.db.prepare("INSERT INTO model_submissions VALUES(?,'image',?,1,'image','image','wallet',?)").run(owner, id, now)
}

test('explicit opt-in returns 202 before completion, saves a verified private original, and recovers through owner GET without model replay', async t => {
  const gate = deferred(), f = await fixture(t, { gate }), id = crypto.randomUUID()
  const accepted = await post(f.app, id)
  assert.equal(accepted.statusCode, 202)
  assert.equal(accepted.json().data.jobId, id)
  const running = await waitFor(f.app, id, 'submission_started')
  assert.equal('result' in running, false)
  assert.equal((await post(f.app, id)).statusCode, 202)
  assert.equal((await post(f.app, id, { ...payload, prompt: 'changed' })).statusCode, 409)
  gate.resolve()
  const complete = await waitFor(f.app, id, 'completed')
  assert.equal(complete.result.url, f.image.url)
  assert.equal(complete.result.usage.state, 'recorded'); assert.equal(complete.result.usage.settlementState, 'unconfirmed')
  assert.deepEqual(complete.result.fundingSelection, { image: 'wallet' })
  const asset = (await f.app.inject({ url: '/api/studio/assets/' + complete.assetId, headers: headers(7) })).json().data
  assert.equal(asset.dataURL, f.image.url); assert.equal(asset.sha256, createHash('sha256').update(f.png).digest('hex'))
  assert.equal((await f.app.inject({ url: '/api/studio/assets/' + complete.assetId, headers: headers(8) })).statusCode, 404)
  const before = snapshot(f.db), calls = f.native.length
  assert.equal((await get(f.app, id)).statusCode, 200)
  const result = await f.app.inject({ url: '/api/studio/requests/image/' + id + '/result', headers: headers(7) })
  assert.equal(result.json().data.result.url, f.image.url)
  assert.equal((await get(f.app, id, 8)).statusCode, 404)
  assert.equal((await f.app.inject('/api/studio/image-jobs/' + id)).statusCode, 401)
  assert.deepEqual(snapshot(f.db), before)
  assert.ok(f.native.slice(calls).every(call => call.route === '/api/user/self' && call.method === 'GET'))
  assert.equal(f.calls.length, 1)
  assert.doesNotMatch(JSON.stringify(snapshot(f.db)), /fixture-account-secret|777777777777777777777777777777777777777777777777|fixture-private-provider-secret/)
  await f.restart()
  assert.equal((await get(f.app, id)).json().data.result.url, f.image.url)
  assert.equal(f.calls.length, 1)
})

test('disabled flag, invalid UUID/body/options/references and failed acceptance transaction never submit or leave intent/slot rows', async t => {
  const f = await fixture(t, { enabled: false }), id = crypto.randomUUID()
  assert.equal((await post(f.app, id)).statusCode, 503)
  f.config.enableImageJobs = true // Server config is copied: this remains disabled.
  assert.equal((await post(f.app, id)).statusCode, 503)
  const enabled = await fixture(t)
  for (const [key, body] of [['short', payload], [crypto.randomUUID(), { ...payload, key: 'not allowed' }], [crypto.randomUUID(), { ...payload, quality: 'unsupported' }],
    [crypto.randomUUID(), { ...payload, aspectRatio: '9:7' }], [crypto.randomUUID(), { ...payload, inputImages: ['https://fixture.invalid/image'] }]]) {
    assert.ok([400,422].includes((await post(enabled.app, key, body)).statusCode))
  }
  enabled.db.exec("CREATE TRIGGER reject_job BEFORE INSERT ON image_jobs BEGIN SELECT RAISE(ABORT,'fixture transaction failure'); END")
  assert.equal((await post(enabled.app, crypto.randomUUID())).statusCode, 500)
  for (const table of ['requests','image_jobs','image_job_reservations','image_job_outbox','model_submissions']) assert.equal(enabled.db.prepare('SELECT COUNT(*) AS n FROM ' + table).get().n, 0)
  assert.equal(enabled.calls.length, 0)
  assert.ok(enabled.native.every(call => call.method === 'GET'))
})

test('default global capacity accepts two owners and rejects a third before creating intent, slot, token or submission', async t => {
  const gate = deferred(), f = await fixture(t, { gate }), first = crypto.randomUUID(), second = crypto.randomUUID(), third = crypto.randomUUID()
  f.account.set(9, { id: 9, status: 1, role: 1, group: 'default', quota: 1000 })
  assert.equal((await post(f.app, first)).statusCode, 202)
  assert.equal((await post(f.app, second, payload, 8)).statusCode, 202)
  await waitFor(f.app, first, 'submission_started')
  await waitFor(f.app, second, 'submission_started', 8)
  assert.equal((await post(f.app, third, payload, 9)).statusCode, 429)
  for (const table of ['requests','image_jobs','image_job_reservations','image_job_outbox','model_submissions']) {
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM ' + table + ' WHERE key=?').get(third).n, 0)
  }
  assert.ok(f.native.filter(call => call.owner === 9).every(call => call.method === 'GET'))
  assert.equal((await post(f.app, first)).statusCode, 202)
  assert.equal(f.calls.length, 2)
  gate.resolve()
  await waitFor(f.app, first, 'completed')
  await waitFor(f.app, second, 'completed', 8)
  assert.equal((await post(f.app, third, payload, 9)).statusCode, 202)
  await waitFor(f.app, third, 'completed', 9)
  assert.equal(f.calls.length, 3)
})

test('job/synchronous image share the exact original key domain and durable owner gate covers chat, profile and renewal while other owner is independent', async t => {
  const gate = deferred(), f = await fixture(t, { gate, renewal: true }), id = crypto.randomUUID()
  assert.equal((await post(f.app, id)).statusCode, 202)
  await waitFor(f.app, id, 'submission_started')
  assert.equal((await sync(f.app, id)).statusCode, 409)
  const newId = crypto.randomUUID()
  assert.equal((await sync(f.app, newId)).statusCode, 409)
  const chatId = crypto.randomUUID()
  assert.equal((await f.app.inject({ method: 'POST', url: '/api/studio/runs', headers: { ...headers(7), 'idempotency-key': chatId }, payload: { runId: chatId, sessionId: 's', conversationId: 'c', model: 'chat', prompt: 'fixture', payWithBalance: true } })).statusCode, 409)
  assert.equal((await f.app.inject({ method: 'PUT', url: '/api/studio/profile', headers: headers(7), payload: { display_name: 'owner' } })).statusCode, 409)
  assert.equal((await f.app.inject({ method: 'PUT', url: '/api/user/self', headers: headers(7), payload: { display_name: 'owner' } })).statusCode, 409)
  assert.equal((await f.app.inject({ method: 'POST', url: '/api/studio/access/renew', headers: { ...headers(7), 'idempotency-key': crypto.randomUUID() }, payload: { confirm: true, version: '0'.repeat(64) } })).statusCode, 409)
  assert.equal((await operation(f.app, id, 'cancel')).statusCode, 409)
  assert.equal((await post(f.app, crypto.randomUUID(), payload, 8)).statusCode, 202)
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM requests WHERE key IN (?,?)').get(newId, chatId).n, 0)
  gate.resolve()
  await waitFor(f.app, id, 'completed')
  const oldSync = crypto.randomUUID()
  assert.equal((await sync(f.app, oldSync)).statusCode, 200)
  const before = f.calls.length
  assert.equal((await post(f.app, oldSync)).statusCode, 409)
  assert.equal(f.calls.length, before)
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM image_jobs WHERE key=?').get(oldSync).n, 0)
})

test('unsubmitted restart needs explicit same-task authorization; drift/foreign/implicit approvals are denied and safe cancellation only releases new slot', async t => {
  const f = await fixture(t), id = crypto.randomUUID()
  seedAccepted(f, id)
  await f.restart()
  assert.equal((await get(f.app, id)).json().data.status, 'needs_authorization')
  assert.equal(f.calls.length, 0)
  assert.equal((await post(f.app, id)).statusCode, 409)
  assert.equal((await sync(f.app, id)).statusCode, 409)
  assert.equal((await operation(f.app, id, 'authorize', 8)).statusCode, 404)
  assert.equal((await operation(f.app, id, 'authorize', 7, {})).statusCode, 400)
  assert.equal((await operation(f.app, id, 'authorize', 7, { confirm: true, payWithBalance: false })).statusCode, 400)
  f.config.models[0].qualities.push('changed')
  assert.equal((await operation(f.app, id, 'authorize')).statusCode, 409)
  f.config.models[0].qualities.pop()
  assert.equal((await operation(f.app, id, 'authorize')).statusCode, 202)
  await waitFor(f.app, id, 'completed')
  assert.equal(f.calls.length, 1)
  assert.equal((await operation(f.app, id, 'authorize')).statusCode, 409)
  const cancelled = crypto.randomUUID(), oldHeld = crypto.randomUUID()
  seedAccepted(f, cancelled)
  f.db.prepare("INSERT INTO trial_reservations VALUES(7,'agent',?,'chat','unknown')").run(oldHeld)
  assert.equal((await operation(f.app, cancelled, 'cancel')).statusCode, 200)
  assert.equal((await operation(f.app, cancelled, 'cancel')).statusCode, 200)
  assert.equal((await get(f.app, cancelled)).json().data.status, 'cancelled_before_submission')
  assert.equal((await sync(f.app, cancelled)).statusCode, 409)
  assert.equal(f.db.prepare('SELECT status FROM trial_reservations WHERE key=?').get(oldHeld).status, 'unknown')
  assert.equal(f.db.prepare('SELECT status FROM image_job_reservations WHERE key=?').get(cancelled).status, 'released_before_submission')
})

test('submitted crash evidence cannot authorize/cancel or rePOST and model unknown does not block a distinct explicitly paid send', async t => {
  const f = await fixture(t), id = crypto.randomUUID()
  seedAccepted(f, id, 'submission_started', { submitted: true })
  await f.restart()
  assert.equal((await get(f.app, id)).json().data.status, 'unknown')
  const before = snapshot(f.db)
  for (const action of ['authorize','cancel']) assert.equal((await operation(f.app, id, action)).statusCode, 409)
  assert.equal((await post(f.app, id)).statusCode, 409)
  assert.equal((await sync(f.app, id)).statusCode, 409)
  assert.deepEqual(snapshot(f.db), before)
  const next = crypto.randomUUID()
  assert.equal((await post(f.app, next)).statusCode, 202)
  await waitFor(f.app, next, 'completed')
  assert.equal(f.calls.length, 1)
})

test('actual provider error/invalid output retain submission and held trial without retry, refund or success', async t => {
  for (const mode of ['failedModel','invalidImage']) {
    const f = await fixture(t, { trial: true, [mode]: true }), id = crypto.randomUUID(), body = { ...payload, payWithBalance: false }
    assert.equal((await post(f.app, id, body)).statusCode, 202)
    const unknown = await waitFor(f.app, id, 'unknown')
    assert.equal('result' in unknown, false)
    assert.equal((await post(f.app, id, body)).statusCode, 409)
    assert.equal((await operation(f.app, id, 'cancel')).statusCode, 409)
    assert.equal(f.db.prepare('SELECT status FROM trial_reservations WHERE key=?').get(id).status, 'unknown')
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM studio_assets').get().n, 0)
    assert.equal(f.native.filter(call => call.route === '/api/subscription/balance/pay').length, 1)
    assert.equal(f.calls.length, 1)
    assert.doesNotMatch(JSON.stringify(snapshot(f.db)), /fixture-private-provider-secret/)
  }
})

test('native funding/key writes unknown keep global owner protection across restart, while model unknown remains original-key-only', async t => {
  for (const options of [{ trial: true, lostPreference: true }, { trial: true, lostPurchase: true }, { lostToken: true }]) {
    const f = await fixture(t, options), id = crypto.randomUUID()
    if (options.lostToken) f.tokens.delete(7)
    const body = options.trial ? { ...payload, payWithBalance: false } : payload
    assert.equal((await post(f.app, id, body)).statusCode, 202)
    const unknown = await waitFor(f.app, id, 'unknown')
    assert.equal(unknown.pendingNativeOperation, true)
    assert.equal(f.calls.length, 0)
    await f.restart()
    const before = snapshot(f.db), native = f.native.length
    assert.equal((await post(f.app, crypto.randomUUID())).statusCode, 409)
    assert.equal((await sync(f.app, crypto.randomUUID())).statusCode, 409)
    assert.equal((await operation(f.app, id, 'cancel')).statusCode, 409)
    assert.equal((await operation(f.app, id, 'authorize')).statusCode, 409)
    assert.deepEqual(snapshot(f.db), before)
    assert.ok(f.native.slice(native).every(call => call.route === '/api/user/self'))
  }
})

test('missing-bound/disabled/expired/exhausted tokens and failed read-only token operations need authorization without an owner-wide unknown write barrier', async t => {
  for (const failure of ['missing-bound','disabled','expired','exhausted','search','key']) {
    let blocked = true
    const f = await fixture(t, { beforeNative: async route => {
      if (blocked && ((failure === 'search' && route === '/api/token/search') || (failure === 'key' && /\/api\/token\/\d+\/key/.test(route)))) throw new Error('fixture read-only failure')
    } }), id = crypto.randomUUID(), original = { ...f.tokens.get(7) }
    if (failure === 'missing-bound') { f.db.prepare('INSERT INTO relay_bindings VALUES(?,?,?)').run(7, 7, 'gouo-studio'); f.tokens.delete(7) }
    if (failure === 'disabled') f.tokens.get(7).status = 2
    if (failure === 'expired') f.tokens.get(7).expired_time = 1
    if (failure === 'exhausted') f.tokens.get(7).remain_quota = 0
    assert.equal((await post(f.app, id)).statusCode, 202)
    const status = await waitFor(f.app, id, 'needs_authorization')
    assert.equal(status.pendingNativeOperation, undefined)
    assert.equal(f.db.prepare('SELECT native_pending FROM image_jobs WHERE key=?').get(id).native_pending, 0)
    assert.equal(f.calls.length, 0)
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM model_submissions WHERE key=?').get(id).n, 0)
    assert.ok(f.native.every(call => call.method === 'GET' || /\/api\/token\/\d+\/key/.test(call.route)))
    await f.restart()
    assert.equal((await get(f.app, id)).json().data.status, 'needs_authorization')
    assert.equal((await post(f.app, id)).statusCode, 409)
    assert.equal((await sync(f.app, id)).statusCode, 409)
    blocked = false; f.tokens.set(7, original)
    const next = crypto.randomUUID()
    assert.equal((await post(f.app, next)).statusCode, 202)
    await waitFor(f.app, next, 'completed')
    assert.equal((await operation(f.app, id, 'authorize')).statusCode, 202)
    await waitFor(f.app, id, 'completed')
    assert.equal(f.calls.length, 2)
  }
})

test('read failure before purchase does not mark Native unknown; confirmed purchase clears its marker before later token read failure', async t => {
  for (const purchased of [false,true]) {
    let blocked = true, planReads = 0
    const f = await fixture(t, { trial: true, beforeNative: async route => {
      if (blocked && ((!purchased && route === '/api/subscription/plans' && ++planReads === 4)
        || (purchased && route === '/api/token/search'))) throw new Error('fixture read-only failure')
    } }), id = crypto.randomUUID(), body = { ...payload, payWithBalance: false }
    assert.equal((await post(f.app, id, body)).statusCode, 202)
    await waitFor(f.app, id, 'needs_authorization')
    assert.equal(f.db.prepare('SELECT native_pending FROM image_jobs WHERE key=?').get(id).native_pending, 0)
    assert.equal(f.calls.length, 0)
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM trial_reservations WHERE key=?').get(id).n, 0)
    assert.equal(f.native.filter(call => call.route === '/api/subscription/balance/pay').length, purchased ? 1 : 0)
    assert.equal(f.db.prepare('SELECT status FROM trial_grants WHERE owner=7').get()?.status, purchased ? 'active' : undefined)
    blocked = false
    await f.restart()
    assert.equal((await operation(f.app, id, 'authorize')).statusCode, 202)
    await waitFor(f.app, id, 'completed')
    assert.equal(f.native.filter(call => call.route === '/api/subscription/balance/pay').length, 1)
    assert.equal(f.calls.length, 1)
  }
})

test('fresh account/model/group checks prevent the accepted job from external submission after permissions change', async t => {
  const authGate = deferred(), f = await fixture(t, { beforeNative: async (route, _init, owner) => {
    if (route === '/api/user/self' && owner === 7 && authGate.blocked) await authGate.promise
  } }), id = crypto.randomUUID()
  authGate.blocked = true
  // Seed an accepted record; explicit authorization must use the same immutable approval after restart.
  seedAccepted(f, id)
  authGate.blocked = false
  await f.restart()
  f.account.get(7).group = 'different'
  assert.equal((await operation(f.app, id, 'authorize')).statusCode, 409)
  f.account.get(7).group = 'default'; f.permissions.set(7, ['fixture-chat'])
  assert.equal((await operation(f.app, id, 'authorize')).statusCode, 403)
  assert.equal(f.calls.length, 0)
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM model_submissions WHERE key=?').get(id).n, 0)
})

test('validated original survives final transaction failure and local finalize/restart performs no new provider or Native billing operation', async t => {
  const f = await fixture(t, { trial: true }), id = crypto.randomUUID()
  f.db.exec("CREATE TRIGGER fail_completion BEFORE UPDATE ON requests WHEN NEW.status='completed' BEGIN SELECT RAISE(ABORT,'fixture full disk'); END")
  assert.equal((await post(f.app, id, { ...payload, payWithBalance: false })).statusCode, 202)
  const saved = await waitFor(f.app, id, 'output_saved')
  assert.ok(saved.assetId)
  assert.equal(f.db.prepare('SELECT status FROM trial_reservations WHERE key=?').get(id).status, 'reserved')
  const oldHeld = crypto.randomUUID()
  f.db.prepare("INSERT INTO trial_reservations VALUES(7,'agent',?,'chat','unknown')").run(oldHeld)
  f.db.exec('DROP TRIGGER fail_completion')
  const native = f.native.length
  await f.restart()
  const complete = (await get(f.app, id)).json().data
  assert.equal(complete.status, 'completed'); assert.equal(complete.result.url, f.image.url)
  assert.equal(f.db.prepare('SELECT status FROM trial_reservations WHERE key=?').get(id).status, 'used')
  assert.equal(f.db.prepare('SELECT status FROM trial_reservations WHERE key=?').get(oldHeld).status, 'unknown')
  assert.ok(f.native.slice(native).every(call => call.route === '/api/user/self'))
  assert.equal(f.calls.length, 1)
})

test('a just-accepted job can really cancel while fresh authorization is waiting, and runner cannot later submit it', async t => {
  const gate = deferred(), entered = deferred()
  t.after(() => gate.resolve())
  let selfReads = 0
  const f = await fixture(t, { beforeNative: async route => {
    if (route === '/api/user/self' && ++selfReads === 3) { entered.resolve(); await gate.promise }
  } }), id = crypto.randomUUID()
  assert.equal((await post(f.app, id)).statusCode, 202)
  await entered.promise
  assert.equal((await operation(f.app, id, 'cancel')).statusCode, 200)
  gate.resolve()
  assert.equal((await get(f.app, id)).json().data.status, 'cancelled_before_submission')
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(f.calls.length, 0)
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM model_submissions WHERE key=?').get(id).n, 0)
  assert.ok(f.native.every(call => call.method === 'GET'))
})

test('turning the flag off denies acceptance/authorization but allows GET and explicit proven local finalize/cancel without generation', async t => {
  const f = await fixture(t), id = crypto.randomUUID()
  f.db.exec("CREATE TRIGGER keep_output BEFORE UPDATE ON requests WHEN NEW.status='completed' BEGIN SELECT RAISE(ABORT,'fixture disk failure'); END")
  assert.equal((await post(f.app, id)).statusCode, 202)
  await waitFor(f.app, id, 'output_saved')
  const unsubmitted = crypto.randomUUID()
  seedAccepted(f, unsubmitted, 'accepted', { owner: 8 })
  f.config.enableImageJobs = false
  await f.restart()
  assert.equal((await get(f.app, unsubmitted, 8)).json().data.status, 'needs_authorization')
  assert.equal((await post(f.app, crypto.randomUUID())).statusCode, 503)
  assert.equal((await operation(f.app, unsubmitted, 'authorize', 8)).statusCode, 503)
  const calls = f.native.length
  f.db.exec('DROP TRIGGER keep_output')
  assert.equal((await operation(f.app, id, 'finalize')).statusCode, 200)
  assert.equal((await get(f.app, id)).json().data.result.url, f.image.url)
  assert.equal((await operation(f.app, unsubmitted, 'cancel', 8)).statusCode, 200)
  assert.ok(f.native.slice(calls).every(call => call.route === '/api/user/self'))
  assert.equal(f.calls.length, 1)
})

test('late group change after HTTP202 moves this unsubmitted task to needs_authorization without keys/funds/provider mutation', async t => {
  const gate = deferred(), entered = deferred()
  t.after(() => gate.resolve())
  let selfReads = 0
  const f = await fixture(t, { beforeNative: async route => {
    if (route === '/api/user/self' && ++selfReads === 3) { entered.resolve(); await gate.promise }
  } }), id = crypto.randomUUID()
  assert.equal((await post(f.app, id)).statusCode, 202)
  await entered.promise
  f.account.get(7).group = 'different'
  gate.resolve()
  await waitFor(f.app, id, 'needs_authorization')
  assert.equal(f.calls.length, 0)
  assert.ok(f.native.every(call => call.method === 'GET'))
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM model_submissions WHERE key=?').get(id).n, 0)
})

test('raw staging transaction failure stays model unknown and cannot release held benefits or repeat submission', async t => {
  const f = await fixture(t, { trial: true }), id = crypto.randomUUID()
  f.db.exec("CREATE TRIGGER reject_raw BEFORE INSERT ON image_job_staging BEGIN SELECT RAISE(ABORT,'fixture disk full'); END")
  assert.equal((await post(f.app, id, { ...payload, payWithBalance: false })).statusCode, 202)
  await waitFor(f.app, id, 'unknown')
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM image_job_staging').get().n, 0)
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM studio_assets').get().n, 0)
  assert.equal(f.db.prepare('SELECT status FROM trial_reservations WHERE key=?').get(id).status, 'unknown')
  assert.equal((await post(f.app, id, { ...payload, payWithBalance: false })).statusCode, 409)
  assert.equal((await operation(f.app, id, 'authorize')).statusCode, 409)
  assert.equal((await operation(f.app, id, 'finalize')).statusCode, 409)
  assert.equal(f.calls.length, 1)
})

test('asset persistence failure keeps private raw bytes, owner/capacity barriers and local recovery while the job flag is off', async t => {
  const f = await fixture(t, { trial: true }), id = crypto.randomUUID(), oldHeld = crypto.randomUUID()
  f.db.exec("CREATE TRIGGER reject_asset BEFORE INSERT ON studio_assets BEGIN SELECT RAISE(ABORT,'fixture disk full'); END")
  assert.equal((await post(f.app, id, { ...payload, payWithBalance: false })).statusCode, 202)
  const received = await waitFor(f.app, id, 'output_received')
  assert.equal('result' in received, false); assert.equal('assetId' in received, false)
  const raw = f.db.prepare('SELECT bytes,sha256 FROM image_job_staging WHERE key=?').get(id)
  assert.deepEqual(Buffer.from(raw.bytes), f.png)
  assert.equal(raw.sha256, createHash('sha256').update(f.png).digest('hex'))
  assert.equal((await get(f.app, id, 8)).statusCode, 404)
  assert.equal((await f.app.inject({ url: '/api/studio/requests/image/' + id + '/result', headers: headers(7) })).json().data.result, undefined)
  assert.equal((await sync(f.app, crypto.randomUUID())).statusCode, 409)
  assert.equal((await f.app.inject({ method: 'PUT', url: '/api/studio/profile', headers: headers(7), payload: { display_name: 'blocked' } })).statusCode, 409)
  f.account.set(9, { id: 9, status: 1, role: 1, group: 'default', quota: 1000 })
  seedAccepted(f, crypto.randomUUID(), 'accepted', { owner: 8 })
  const third = crypto.randomUUID()
  assert.equal((await post(f.app, third, payload, 9)).statusCode, 429)
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM requests WHERE key=?').get(third).n, 0)
  f.db.prepare("INSERT INTO trial_reservations VALUES(7,'agent',?,'chat','unknown')").run(oldHeld)
  f.db.prepare("INSERT INTO funding_writes VALUES(7,'subscription_only','unknown',?) ON CONFLICT(owner) DO UPDATE SET status='unknown'").run(new Date().toISOString())
  f.config.enableImageJobs = false
  const native = f.native.length
  await f.restart()
  await waitFor(f.app, id, 'output_received')
  // Wait for the local-only startup validation to release the in-process guard.
  for(let i=0;i<100;i++) {
    const attempt=await operation(f.app,id,'finalize')
    if(attempt.statusCode!==409) { assert.equal(attempt.statusCode,502); break }
    await new Promise(resolve=>setTimeout(resolve,5))
    if(i===99)assert.fail('local startup processing did not settle')
  }
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM studio_assets').get().n, 0)
  assert.deepEqual(Buffer.from(f.db.prepare('SELECT bytes FROM image_job_staging WHERE key=?').get(id).bytes), f.png)
  f.db.exec('DROP TRIGGER reject_asset')
  const complete = await operation(f.app, id, 'finalize')
  assert.equal(complete.statusCode, 200)
  const saved = (await get(f.app, id)).json().data
  assert.equal(saved.result.url, f.image.url)
  assert.equal(saved.result.usage.state, 'pending'); assert.equal(saved.result.usage.settlementState, 'unconfirmed')
  assert.deepEqual(Buffer.from(f.db.prepare('SELECT bytes FROM studio_assets WHERE id=?').get(saved.assetId).bytes), f.png)
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM image_job_staging WHERE key=?').get(id).n, 0)
  assert.equal(f.db.prepare('SELECT status FROM trial_reservations WHERE key=?').get(id).status, 'used')
  assert.equal(f.db.prepare('SELECT status FROM trial_reservations WHERE key=?').get(oldHeld).status, 'unknown')
  assert.equal(f.db.prepare('SELECT status FROM funding_writes WHERE owner=7').get().status, 'unknown')
  assert.ok(f.native.slice(native).every(call => call.route === '/api/user/self' && call.method === 'GET'))
  assert.equal(f.calls.length, 1)
})

test('corrupt/hash/size/format/pixel raw output remains private and retained, fails closed, and never replays or locks unrelated new model keys', async t => {
  const huge = await sharp({ create: { width: 6001, height: 4000, channels: 3, background: '#5533aa' } }).png().toBuffer()
  const gif = await sharp({ create: { width: 2, height: 3, channels: 3, background: '#5533aa' } }).gif().toBuffer()
  for (const failure of ['hash','format','pixels','truncated','oversized']) {
    const f = await fixture(t, { trial: true }), id = crypto.randomUUID()
    f.db.exec("CREATE TRIGGER reject_asset BEFORE INSERT ON studio_assets BEGIN SELECT RAISE(ABORT,'fixture disk full'); END")
    assert.equal((await post(f.app, id, { ...payload, payWithBalance: false })).statusCode, 202)
    await waitFor(f.app, id, 'output_received')
    for(let i=0;i<100;i++) {
      const attempt=await operation(f.app,id,'finalize')
      if(attempt.statusCode!==409) { assert.equal(attempt.statusCode,502); break }
      await new Promise(resolve=>setTimeout(resolve,5))
      if(i===99)assert.fail('initial local validation did not settle')
    }
    // The API exposes no raw-write route. Simulate corruption in this temp DB.
    const replacement = failure === 'format' ? gif : failure === 'pixels' ? huge : failure === 'truncated' ? f.png.subarray(0, f.png.length - 25) : f.png
    if (failure === 'oversized') f.db.prepare('UPDATE image_job_staging SET bytes=zeroblob(?),sha256=? WHERE key=?').run(30 * 1024 * 1024 + 1, '0'.repeat(64), id)
    else f.db.prepare('UPDATE image_job_staging SET bytes=?,sha256=? WHERE key=?').run(replacement, failure === 'hash' ? '0'.repeat(64) : createHash('sha256').update(replacement).digest('hex'), id)
    const before = f.db.prepare('SELECT length(bytes) AS size,sha256 FROM image_job_staging WHERE key=?').get(id)
    f.db.exec('DROP TRIGGER reject_asset')
    const response = await operation(f.app, id, 'finalize')
    assert.equal(response.statusCode, 502); assert.doesNotMatch(response.body, /data:image|fixture-private|SELECT|INSERT/)
    const status = (await get(f.app, id)).json().data
    assert.equal(status.status, 'unknown'); assert.equal('result' in status, false)
    assert.deepEqual(f.db.prepare('SELECT length(bytes) AS size,sha256 FROM image_job_staging WHERE key=?').get(id), before)
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM studio_assets WHERE run_id=?').get(id).n, 0)
    assert.equal(f.db.prepare('SELECT status FROM trial_reservations WHERE key=?').get(id).status, 'unknown')
    assert.equal((await post(f.app, id, { ...payload, payWithBalance: false })).statusCode, 409)
    assert.equal((await operation(f.app, id, 'authorize')).statusCode, 409)
    assert.equal((await operation(f.app, id, 'finalize')).statusCode, 409)
    await f.restart()
    assert.equal((await get(f.app, id)).json().data.status, 'unknown')
    f.account.get(7).quota = 1000
    const next = crypto.randomUUID()
    assert.equal((await post(f.app, next)).statusCode, 202)
    await waitFor(f.app, next, 'completed')
    assert.equal(f.calls.length, 2)
  }
})

for (const stage of ['accepted','submitted','output_received','output_saved']) test(`real API child-process crash at ${stage} resumes only proven local work and never replays a submitted model`, { timeout: 20000 }, async t => {
  const directory = mkdtempSync(join(tmpdir(), 'gouo-job-crash-')), path = join(directory, 'ledger.sqlite'), providerReached = deferred()
  const png = await sharp({ create: { width: 2, height: 3, channels: 4, background: '#5533aa' } }).png().toBuffer()
  let providerCalls = 0, child, app, db
  const provider = createHTTPServer(async (request, response) => {
    for await (const _chunk of request) { /* Consume the actual image generation body. */ }
    providerCalls++
    providerReached.resolve()
    if (stage === 'submitted') return // The supplier received the one request; no response reaches Studio.
    response.writeHead(200, { 'content-type': 'application/json', 'x-oneapi-request-id': 'fixture-child-request' })
    response.end(JSON.stringify({ data: [{ b64_json: png.toString('base64') }] }))
  })
  await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve))
  t.after(async () => {
    if (child && child.exitCode === null && child.signalCode === null) { const ended = new Promise(resolve => child.once('exit', resolve)); child.kill('SIGKILL'); await ended }
    db?.close(); if (app) await app.close()
    provider.closeAllConnections(); await new Promise(resolve => provider.close(resolve))
    rmSync(directory, { recursive: true, force: true })
  })
  const config = { ledgerPath: path, authOrigin: 'http://fixture.invalid', gateway: `http://127.0.0.1:${provider.address().port}/v1`, allowGeneration: true,
    enableImageJobs: true, relayOwnerId: 7, relayKey: 'fixture-child-private-key', models: [{ id: 'image', kind: 'image', upstreamModelId: 'fixture-image', enabled: true,
      verification: 'live-verified', operations: ['generate'], qualities: [], sizes: {} }] }
  const source = `
    import { createServer } from './apps/api/src/server.mjs';
    import { generateImage } from './apps/api/src/images.mjs';
    import { DatabaseSync } from 'node:sqlite';
    let reads=0;
    const app=createServer(${JSON.stringify(config)}, {fetch: async (url, init) => {
      const path=new URL(url).pathname;
      if(path==='/api/user/self') {
        if(${JSON.stringify(stage)}==='accepted' && ++reads===2) await new Promise(()=>{});
        return Response.json({success:true,data:{id:init.headers.Authorization==='Bearer owner'?7:8,status:1,group:'default'}});
      }
      if(path==='/api/status')return Response.json({success:true,data:{quota_per_unit:1000,usd_exchange_rate:1}});
      return Response.json({success:true,data:{page:1,page_size:2,total:0,items:[]}});
    },generateImage:async(context,model,payload)=>generateImage({...context,onImageOutput:async bytes=>{
      await context.onImageOutput(bytes);
      if(${JSON.stringify(stage)}==='output_received') await new Promise(()=>{});
    }},model,payload)});
    if(${JSON.stringify(stage)}==='output_saved') {
      const db=new DatabaseSync(${JSON.stringify(path)});
      db.exec("CREATE TRIGGER fail_final BEFORE UPDATE ON requests WHEN NEW.status='completed' BEGIN SELECT RAISE(ABORT,'fixture disk failure'); END");db.close();
    }
    await app.listen({host:'127.0.0.1',port:0});
    console.log(JSON.stringify({origin:app.listeningOrigin}));
  `
  child = spawn(process.execPath, ['--input-type=module','-e', source], { cwd: new URL('../../../', import.meta.url), stdio: ['ignore','pipe','pipe'], windowsHide: true })
  let stdout = '', stderr = ''
  child.stderr.on('data', data => { stderr += data.toString() })
  const ready = new Promise((resolve, reject) => {
    child.stdout.on('data', data => { stdout += data.toString(); if (stdout.includes('\n')) resolve(JSON.parse(stdout.split('\n')[0]).origin) })
    child.once('exit', code => reject(new Error('fixture child exited before ready: ' + code + ', ' + stderr)))
  })
  const origin = await ready, id = crypto.randomUUID(), body = { prompt: 'fixture crash image', model: 'image', inputImages: [] }
  const accepted = await fetch(origin + '/api/studio/image-jobs', { method: 'POST', headers: { authorization: 'Bearer owner', 'content-type': 'application/json', 'idempotency-key': id }, body: JSON.stringify(body) })
  assert.equal(accepted.status, 202)
  await accepted.json()
  if (stage !== 'accepted') await providerReached.promise
  if (['output_received','output_saved'].includes(stage)) {
    for (let i=0;i<100;i++) {
      const data=(await (await fetch(origin+'/api/studio/image-jobs/'+id,{headers:{authorization:'Bearer owner'}})).json()).data
      if(data.status===stage)break
      if(i===99)assert.fail('child output was not saved')
      await new Promise(resolve=>setTimeout(resolve,5))
    }
  }
  const ended = new Promise(resolve => child.once('exit', resolve))
  child.kill('SIGKILL'); await ended
  let accidentalModels=0
  app=createServer(config,{fetch:async (_url,init)=>Response.json({success:true,data:{id:init.headers.Authorization==='Bearer owner'?7:8,status:1,group:'default'}}),
    generateImage:async ()=>{accidentalModels++;throw new Error('unexpected replay')}})
  db=new DatabaseSync(path)
  let status=(await app.inject({url:'/api/studio/image-jobs/'+id,headers:{authorization:'Bearer owner'}})).json().data
  if(stage==='accepted') {
    assert.equal(status.status,'needs_authorization');assert.equal(providerCalls,0)
    assert.equal((await app.inject({method:'POST',url:'/api/studio/images',headers:{authorization:'Bearer owner','idempotency-key':id},payload:body})).statusCode,409)
  } else if(stage==='submitted') {
    assert.equal(status.status,'unknown');assert.equal(providerCalls,1)
    assert.equal((await app.inject({method:'POST',url:'/api/studio/image-jobs/'+id+'/authorize',headers:{authorization:'Bearer owner'},payload:{confirm:true}})).statusCode,409)
  } else if(stage==='output_received') {
    for(let i=0;i<100 && status.status!=='completed';i++) {
      await new Promise(resolve=>setTimeout(resolve,5))
      status=(await app.inject({url:'/api/studio/image-jobs/'+id,headers:{authorization:'Bearer owner'}})).json().data
    }
    assert.equal(status.status,'completed')
    const original=db.prepare('SELECT sha256,bytes FROM studio_assets WHERE id=?').get(status.assetId)
    assert.equal(original.sha256,createHash('sha256').update(png).digest('hex'))
    assert.deepEqual(Buffer.from(original.bytes),png)
    assert.equal(status.result.url,'data:image/png;base64,'+png.toString('base64'))
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM image_job_staging WHERE key=?').get(id).n,0)
    assert.equal(providerCalls,1)
  } else {
    assert.equal(status.status,'output_saved')
    const original=db.prepare('SELECT sha256,bytes FROM studio_assets WHERE id=?').get(status.assetId)
    assert.equal(original.sha256,createHash('sha256').update(png).digest('hex'))
    assert.deepEqual(Buffer.from(original.bytes),png)
    db.exec('DROP TRIGGER fail_final')
    assert.equal((await app.inject({method:'POST',url:'/api/studio/image-jobs/'+id+'/finalize',headers:{authorization:'Bearer owner'}})).statusCode,200)
    status=(await app.inject({url:'/api/studio/image-jobs/'+id,headers:{authorization:'Bearer owner'}})).json().data
    assert.equal(status.status,'completed');assert.equal(status.result.url,'data:image/png;base64,'+png.toString('base64'))
    assert.equal(providerCalls,1)
  }
  assert.equal((await app.inject({url:'/api/studio/image-jobs/'+id,headers:{authorization:'Bearer other'}})).statusCode,404)
  assert.equal(accidentalModels,0)
})
